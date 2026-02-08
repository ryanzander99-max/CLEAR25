import datetime
import secrets
from django.db import models
from django.contrib.auth.models import User
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone


PLAN_CHOICES = [
    ("free", "Free"),
    ("pro", "Pro"),
    ("business", "Business"),
]

PLAN_LIMITS = {
    "free":     {"rate_limit": 100,   "max_keys": 1},
    "pro":      {"rate_limit": 1000,  "max_keys": 5},
    "business": {"rate_limit": 10000, "max_keys": 20},
}


class UserProfile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")
    last_fetch_time = models.DateTimeField(null=True, blank=True)
    last_fetch_results = models.JSONField(null=True, blank=True)
    plan = models.CharField(max_length=10, choices=PLAN_CHOICES, default="free")
    plan_expires = models.DateTimeField(null=True, blank=True)

    @property
    def active_plan(self):
        if self.plan == "free":
            return "free"
        if self.plan_expires and self.plan_expires < timezone.now():
            return "free"  # Expired
        return self.plan

    @property
    def rate_limit(self):
        return PLAN_LIMITS[self.active_plan]["rate_limit"]

    @property
    def max_api_keys(self):
        return PLAN_LIMITS[self.active_plan]["max_keys"]

    def can_fetch(self):
        if self.last_fetch_time is None:
            return True
        return timezone.now() - self.last_fetch_time > datetime.timedelta(minutes=30)

    def minutes_until_fetch(self):
        if self.can_fetch():
            return 0
        elapsed = timezone.now() - self.last_fetch_time
        remaining = datetime.timedelta(minutes=30) - elapsed
        return max(0, int(remaining.total_seconds() / 60) + 1)

    def seconds_until_fetch(self):
        if self.can_fetch():
            return 0
        elapsed = timezone.now() - self.last_fetch_time
        remaining = datetime.timedelta(minutes=30) - elapsed
        return max(0, int(remaining.total_seconds()))


class APIKey(models.Model):
    """API key for public API access."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="api_keys")
    key = models.CharField(max_length=64, unique=True, db_index=True)
    name = models.CharField(max_length=100, blank=True)  # Optional label
    created_at = models.DateTimeField(auto_now_add=True)
    last_used = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    # Rate limiting (per key)
    requests_this_hour = models.IntegerField(default=0)
    hour_started = models.DateTimeField(null=True, blank=True)
    total_requests = models.IntegerField(default=0)

    def save(self, *args, **kwargs):
        if not self.key:
            self.key = secrets.token_hex(32)  # 64-char hex string
        super().save(*args, **kwargs)

    def get_rate_limit(self):
        """Get rate limit based on user's plan."""
        try:
            return self.user.profile.rate_limit
        except UserProfile.DoesNotExist:
            return PLAN_LIMITS["free"]["rate_limit"]

    def check_rate_limit(self):
        """Check and update rate limit. Returns (allowed, remaining, reset_seconds)."""
        now = timezone.now()
        rate_limit = self.get_rate_limit()

        # Reset if hour has passed
        if not self.hour_started or (now - self.hour_started).total_seconds() >= 3600:
            self.hour_started = now
            self.requests_this_hour = 0

        remaining = max(0, rate_limit - self.requests_this_hour)
        reset_seconds = int(3600 - (now - self.hour_started).total_seconds())

        if self.requests_this_hour >= rate_limit:
            return False, 0, reset_seconds

        self.requests_this_hour += 1
        self.total_requests += 1
        self.last_used = now
        self.save(update_fields=["requests_this_hour", "hour_started", "last_used", "total_requests"])
        return True, remaining - 1, reset_seconds

    def __str__(self):
        return f"{self.name or 'API Key'} ({self.key[:8]}...)"


class ReadingSnapshot(models.Model):
    """Stores the most recent readings per city for Rule 2 (dual-station sustained check)."""
    city = models.CharField(max_length=50, unique=True)
    readings = models.JSONField(default=dict)
    timestamp = models.DateTimeField(auto_now=True)


class CachedResult(models.Model):
    """Stores the latest server-side refresh results. Single row (key='latest')."""
    key = models.CharField(max_length=20, unique=True, default="latest")
    results = models.JSONField(default=list)
    city_alerts = models.JSONField(default=dict)
    readings = models.JSONField(default=dict)
    timestamp = models.DateTimeField(auto_now=True)


class Suggestion(models.Model):
    """User suggestion/feedback for the improvement board."""
    author = models.ForeignKey(User, on_delete=models.CASCADE, related_name="suggestions")
    title = models.CharField(max_length=200)
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=['-created_at']),  # For list sorting
            models.Index(fields=['author']),  # For user filtering
        ]

    def vote_score(self):
        return self.votes.filter(value=1).count() - self.votes.filter(value=-1).count()

    def comment_count(self):
        return self.comments.count()


class SuggestionVote(models.Model):
    """Upvote/downvote on a suggestion."""
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    suggestion = models.ForeignKey(Suggestion, on_delete=models.CASCADE, related_name="votes")
    value = models.SmallIntegerField()  # 1 = upvote, -1 = downvote

    class Meta:
        unique_together = ("user", "suggestion")
        indexes = [
            models.Index(fields=['suggestion', 'value']),  # For vote counting
            models.Index(fields=['user']),  # For user vote lookups
        ]


class Comment(models.Model):
    """Comment on a suggestion."""
    author = models.ForeignKey(User, on_delete=models.CASCADE, related_name="comments")
    suggestion = models.ForeignKey(Suggestion, on_delete=models.CASCADE, related_name="comments")
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=['suggestion']),  # For comment counting
            models.Index(fields=['created_at']),  # For sorting
        ]


class DeviceToken(models.Model):
    """Push notification device tokens for iOS/Android."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="devices", null=True, blank=True)
    token = models.CharField(max_length=255, unique=True, db_index=True)
    platform = models.CharField(max_length=10, default="ios")  # ios, android, web
    created_at = models.DateTimeField(auto_now_add=True)
    last_used = models.DateTimeField(auto_now=True)
    is_active = models.BooleanField(default=True)
    # Subscription preferences
    cities = models.JSONField(default=list)  # List of cities to get alerts for, empty = all

    class Meta:
        indexes = [
            models.Index(fields=['is_active', 'platform']),
        ]

    def __str__(self):
        return f"{self.platform}: {self.token[:20]}..."


BILLING_PERIOD_CHOICES = [("monthly", "Monthly"), ("yearly", "Yearly")]


class Payment(models.Model):
    """Tracks crypto payments via NOWPayments."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="payments")
    plan = models.CharField(max_length=10, choices=PLAN_CHOICES)
    billing_period = models.CharField(max_length=10, choices=BILLING_PERIOD_CHOICES, default="monthly")
    amount_usd = models.DecimalField(max_digits=10, decimal_places=2)
    nowpayments_id = models.CharField(max_length=100, unique=True)
    status = models.CharField(max_length=20, default="waiting")  # waiting, confirming, confirmed, failed
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user.email} - {self.plan} - {self.status}"


@receiver(post_save, sender=User)
def create_user_profile(sender, instance, created, **kwargs):
    if created:
        UserProfile.objects.create(user=instance)

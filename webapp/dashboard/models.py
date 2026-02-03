import datetime
from django.db import models
from django.contrib.auth.models import User
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone


class UserProfile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")
    last_fetch_time = models.DateTimeField(null=True, blank=True)
    last_fetch_results = models.JSONField(null=True, blank=True)

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


@receiver(post_save, sender=User)
def create_user_profile(sender, instance, created, **kwargs):
    if created:
        UserProfile.objects.create(user=instance)

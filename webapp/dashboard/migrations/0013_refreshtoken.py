from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("dashboard", "0012_payment_stripe"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="RefreshToken",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ("token_hash", models.CharField(db_index=True, max_length=64, unique=True)),
                ("expires_at", models.DateTimeField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("revoked", models.BooleanField(default=False)),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="refresh_tokens",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"indexes": [models.Index(fields=["user", "revoked"], name="dashboard_r_user_id_revoked_idx")]},
        ),
    ]

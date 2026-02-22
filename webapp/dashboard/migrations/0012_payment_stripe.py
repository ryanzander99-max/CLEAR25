from django.db import migrations, models


class Migration(migrations.Migration):
    """Revert: rename stripe_session_id back to nowpayments_id (NOWPayments rollback)."""

    dependencies = [
        ('dashboard', '0011_add_billing_period_to_payment'),
    ]

    operations = [
        # No-op migration — keeps schema at 0011 state (nowpayments_id column unchanged)
    ]

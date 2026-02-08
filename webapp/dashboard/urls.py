from django.urls import path
from . import views

urlpatterns = [
    path("", views.landing_page, name="landing"),
    path("privacy/", views.privacy_page, name="privacy"),
    path("dashboard/", views.index, name="dashboard"),
    path("health/", views.health_check, name="health"),  # Health check for monitoring
    path("api/stations/", views.api_stations),
    path("api/demo/", views.api_demo),
    path("api/live/", views.api_live),
    path("api/refresh/", views.api_refresh),
    path("api/auth-status/", views.api_auth_status),
    path("accounts/logout/", views.logout_view, name="logout"),
    # Feedback board
    path("api/suggestions/", views.api_suggestions),
    path("api/suggestions/create/", views.api_suggestion_create),
    path("api/suggestions/<int:suggestion_id>/", views.api_suggestion_detail),
    path("api/suggestions/<int:suggestion_id>/vote/", views.api_suggestion_vote),
    path("api/suggestions/<int:suggestion_id>/comments/", views.api_comment_create),
    path("api/suggestions/<int:suggestion_id>/delete/", views.api_suggestion_delete),
    # Settings
    path("settings/", views.settings_page, name="settings"),
    path("api/settings/profile/", views.api_update_profile),
    path("api/settings/downgrade/", views.api_downgrade_plan),
    path("api/settings/delete-account/", views.api_delete_account),
    # Public API v1
    path("developers/", views.api_docs, name="api_docs"),
    path("api/v1/live/", views.api_v1_live),
    path("api/v1/stations/", views.api_v1_stations),
    path("api/v1/cities/", views.api_v1_cities),
    path("api/v1/keys/create/", views.api_create_key),
    path("api/v1/keys/revoke/", views.api_revoke_key),
    # Push notifications
    path("api/push/register/", views.api_register_device),
    path("api/push/unregister/", views.api_unregister_device),
    # Subscriptions
    path("api/v1/subscribe/", views.api_create_payment),
    path("api/v1/subscribe/webhook/", views.api_payment_webhook),
    path("api/v1/subscribe/status/", views.api_subscription_status),
    path("api/v1/subscribe/test/", views.api_test_upgrade),  # TEST: simulate upgrade
    # Billing page
    path("billing/", views.billing_page, name="billing"),
]

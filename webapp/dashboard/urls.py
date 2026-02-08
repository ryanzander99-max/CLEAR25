from django.urls import path
from . import views

urlpatterns = [
    path("", views.landing_page, name="landing"),
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
    path("api/settings/delete-account/", views.api_delete_account),
]

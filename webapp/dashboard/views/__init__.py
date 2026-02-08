"""
Dashboard views package.

Re-exports all views for backwards compatibility with urls.py.
"""

# Core views
from .core import (
    index,
    api_stations,
    api_demo,
    api_live,
    api_refresh,
    api_auth_status,
    logout_view,
)

# Landing page
from .landing import landing_page

# Feedback board views
from .feedback import (
    api_suggestions,
    api_suggestion_create,
    api_suggestion_vote,
    api_suggestion_detail,
    api_comment_create,
    api_suggestion_delete,
)

# Account/settings views
from .account import (
    settings_page,
    api_update_profile,
    api_delete_account,
)

# Health check
from .health import health_check

# Export all for `from dashboard.views import *`
__all__ = [
    # Landing
    "landing_page",
    # Core
    "index",
    "api_stations",
    "api_demo",
    "api_live",
    "api_refresh",
    "api_auth_status",
    "logout_view",
    # Feedback
    "api_suggestions",
    "api_suggestion_create",
    "api_suggestion_vote",
    "api_suggestion_detail",
    "api_comment_create",
    "api_suggestion_delete",
    # Account
    "settings_page",
    "api_update_profile",
    "api_delete_account",
    # Health
    "health_check",
]

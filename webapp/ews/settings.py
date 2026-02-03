import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
SECRET_KEY = os.environ.get("SECRET_KEY", "dev-only-key-change-in-production")
DEBUG = os.environ.get("DEBUG", "true").lower() == "true"
ALLOWED_HOSTS = ["*"]

INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.staticfiles",
    "whitenoise.runserver_nostatic",
    "dashboard",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
]

ROOT_URLCONF = "ews.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
            ],
        },
    },
]

WSGI_APPLICATION = "ews.wsgi.application"

# Database — Supabase PostgreSQL via DATABASE_URL, fallback to SQLite for local dev
DATABASE_URL = os.environ.get("DATABASE_URL", "")
if DATABASE_URL:
    # URL-encode the password portion to handle special characters
    import urllib.parse as _urlparse
    _parsed = _urlparse.urlparse(DATABASE_URL)
    if _parsed.password:
        _safe_password = _urlparse.quote(_parsed.password, safe="")
        _netloc = f"{_parsed.username}:{_safe_password}@{_parsed.hostname}"
        if _parsed.port:
            _netloc += f":{_parsed.port}"
        DATABASE_URL = _urlparse.urlunparse(
            (_parsed.scheme, _netloc, _parsed.path, _parsed.params, _parsed.query, _parsed.fragment)
        )
    import dj_database_url
    DATABASES = {
        "default": dj_database_url.parse(DATABASE_URL, conn_max_age=600)
    }
    DATABASES["default"].setdefault("OPTIONS", {})
    DATABASES["default"]["OPTIONS"]["sslmode"] = "require"
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": os.path.join(BASE_DIR, "db.sqlite3"),
        }
    }

STATIC_URL = "static/"
STATIC_ROOT = os.path.join(BASE_DIR, "staticfiles")

# Use basic whitenoise (no manifest) so it works without collectstatic on Vercel
WHITENOISE_USE_FINDERS = True

# Path to the shared data/ folder
DATA_DIR = os.path.join(BASE_DIR.parent, "data")

# Auth
LOGIN_URL = "/accounts/login/"
LOGIN_REDIRECT_URL = "/"
LOGOUT_REDIRECT_URL = "/"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

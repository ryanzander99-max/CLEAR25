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
    # Parse the URL manually to avoid urlparse issues with special chars in passwords.
    # Expected format: postgresql://user:password@host:port/dbname
    import re as _re
    # Use last @ as delimiter: password may contain @
    # Username stops at first : after scheme://
    # Password is everything between user: and the last @
    _m = _re.match(r'^(\w+)://([^:]+):(.+)@([^@]+)$', DATABASE_URL)
    if _m:
        _scheme, _user, _pw, _hostpath = _m.groups()
        # Split host:port/dbname
        _hp, _, _dbname = _hostpath.partition("/")
        _host, _, _port = _hp.partition(":")
        DATABASES = {
            "default": {
                "ENGINE": "django.db.backends.postgresql",
                "NAME": _dbname or "postgres",
                "USER": _user,
                "PASSWORD": _pw,
                "HOST": _host,
                "PORT": _port or "5432",
                "CONN_MAX_AGE": 600,
                "OPTIONS": {"sslmode": "require"},
            }
        }
    else:
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

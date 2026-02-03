import os
import sys

# Ensure the webapp directory is on the Python path
webapp_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if webapp_dir not in sys.path:
    sys.path.insert(0, webapp_dir)

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "ews.settings")

from django.core.wsgi import get_wsgi_application
app = get_wsgi_application()

# Run migrations at runtime if tables are missing (Vercel serverless)
_migrated = False
def _ensure_migrated():
    global _migrated
    if _migrated:
        return
    _migrated = True
    try:
        from django.contrib.sites.models import Site
        Site.objects.count()
    except Exception:
        from django.core.management import call_command
        call_command("migrate", "--noinput")
        # Also ensure the Site record exists
        from django.contrib.sites.models import Site
        Site.objects.update_or_create(id=1, defaults={"domain": "clear25.xyz", "name": "C.L.E.A.R."})

_ensure_migrated()

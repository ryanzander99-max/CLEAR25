"""
Health check endpoint for monitoring and load balancers.
"""

from django.core.cache import cache
from django.db import connection
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods


@require_http_methods(["GET"])
def health_check(request):
    """Health check endpoint for monitoring and load balancers.

    Returns database and cache status for observability.
    """
    status = {
        "status": "healthy",
        "timestamp": timezone.now().isoformat(),
        "checks": {},
    }

    # Check database connectivity
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        status["checks"]["database"] = "ok"
    except Exception as e:
        status["checks"]["database"] = f"error: {str(e)}"
        status["status"] = "unhealthy"

    # Check cache connectivity
    try:
        cache.set("health_check", "ok", 10)
        if cache.get("health_check") == "ok":
            status["checks"]["cache"] = "ok"
        else:
            status["checks"]["cache"] = "error: cache read failed"
            status["status"] = "degraded"
    except Exception as e:
        status["checks"]["cache"] = f"error: {str(e)}"
        status["status"] = "degraded"

    http_status = 200 if status["status"] == "healthy" else 503
    return JsonResponse(status, status=http_status)

"""
Device token registration for push notifications.
"""

import json

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from .. import services
from ..models import DeviceToken


@csrf_exempt
@require_http_methods(["POST"])
def api_register_device(request):
    """Register a device for push notifications."""
    try:
        data = json.loads(request.body) if request.body else {}
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    token = data.get("token", "").strip()
    platform = data.get("platform", "ios")
    cities = data.get("cities", [])  # Empty list = all cities

    if not token:
        return JsonResponse({"error": "Token is required"}, status=400)

    if platform not in ["ios", "android", "web"]:
        return JsonResponse({"error": "Invalid platform"}, status=400)

    # Validate cities if provided
    if cities:
        valid_cities = set(services.CITIES.keys())
        invalid = [c for c in cities if c not in valid_cities]
        if invalid:
            return JsonResponse({
                "error": f"Invalid cities: {', '.join(invalid)}",
                "valid_cities": list(valid_cities)
            }, status=400)

    # Create or update device token
    device, created = DeviceToken.objects.update_or_create(
        token=token,
        defaults={
            "platform": platform,
            "cities": cities,
            "is_active": True,
            "user": request.user if request.user.is_authenticated else None,
        }
    )

    return JsonResponse({
        "ok": True,
        "created": created,
        "cities": device.cities or list(services.CITIES.keys()),
    })


@csrf_exempt
@require_http_methods(["POST"])
def api_unregister_device(request):
    """Unregister a device from push notifications."""
    try:
        data = json.loads(request.body) if request.body else {}
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    token = data.get("token", "").strip()
    if not token:
        return JsonResponse({"error": "Token is required"}, status=400)

    try:
        device = DeviceToken.objects.get(token=token)
        device.is_active = False
        device.save()
        return JsonResponse({"ok": True})
    except DeviceToken.DoesNotExist:
        return JsonResponse({"ok": True})  # Idempotent

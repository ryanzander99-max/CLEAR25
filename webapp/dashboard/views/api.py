"""
Public API v1 endpoints for CLEAR25.
"""

from functools import wraps

from django.http import JsonResponse
from django.shortcuts import render
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from .. import services
from ..models import APIKey, CachedResult, DeviceToken


# Level name to integer mapping
LEVEL_MAP = {
    "NONE": 1,
    "MODERATE": 2,
    "HIGH": 3,
    "VERY HIGH": 4,
    "EXTREME": 5,
}


def require_api_key(view_func):
    """Decorator to require valid API key in Authorization header."""
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return JsonResponse({
                "error": "Missing or invalid Authorization header",
                "hint": "Use 'Authorization: Bearer YOUR_API_KEY'"
            }, status=401)

        key = auth_header[7:]  # Strip "Bearer "
        try:
            api_key = APIKey.objects.get(key=key, is_active=True)
        except APIKey.DoesNotExist:
            return JsonResponse({"error": "Invalid API key"}, status=401)

        # Check rate limit
        allowed, remaining, reset = api_key.check_rate_limit()
        if not allowed:
            response = JsonResponse({
                "error": "Rate limit exceeded",
                "retry_after": reset
            }, status=429)
            response["X-RateLimit-Limit"] = str(APIKey.RATE_LIMIT)
            response["X-RateLimit-Remaining"] = "0"
            response["X-RateLimit-Reset"] = str(reset)
            return response

        request.api_key = api_key
        response = view_func(request, *args, **kwargs)

        # Add rate limit headers to successful responses
        response["X-RateLimit-Limit"] = str(APIKey.RATE_LIMIT)
        response["X-RateLimit-Remaining"] = str(remaining)
        response["X-RateLimit-Reset"] = str(reset)
        return response
    return wrapper


def _format_station_for_api(station_result):
    """Format a station result for API response with integer level."""
    level_name = station_result.get("level_name", "NONE")
    return {
        "id": station_result.get("id"),
        "name": station_result.get("station"),
        "city": station_result.get("target_city"),
        "lat": station_result.get("lat"),
        "lon": station_result.get("lon"),
        "pm25": round(station_result.get("pm25", 0), 1),
        "predicted": round(station_result.get("predicted", 0), 1),
        "level": LEVEL_MAP.get(level_name, 0),
        "level_name": level_name,
        "health_advisory": station_result.get("health", ""),
    }


@require_http_methods(["GET"])
@require_api_key
def api_v1_live(request):
    """Get current PM2.5 readings and predictions for all stations."""
    try:
        cached = CachedResult.objects.get(key="latest")
        results = cached.results or []
        timestamp = cached.timestamp.isoformat()
        age_seconds = int((timezone.now() - cached.timestamp).total_seconds())
    except CachedResult.DoesNotExist:
        results = []
        timestamp = None
        age_seconds = None

    # Format stations for API
    stations = [_format_station_for_api(r) for r in results]

    return JsonResponse({
        "stations": stations,
        "count": len(stations),
        "timestamp": timestamp,
        "age_seconds": age_seconds,
    })


@require_http_methods(["GET"])
@require_api_key
def api_v1_stations(request):
    """Get list of all monitoring stations."""
    city_filter = request.GET.get("city")

    if city_filter and city_filter not in services.CITIES:
        return JsonResponse({
            "error": f"Invalid city. Valid options: {', '.join(services.CITIES.keys())}"
        }, status=400)

    if city_filter:
        stations = services.load_stations(city_filter)
    else:
        stations = services.load_all_stations()

    formatted = []
    for st in stations:
        formatted.append({
            "id": st.get("id"),
            "name": st.get("station"),
            "city": st.get("target_city"),
            "lat": st.get("lat"),
            "lon": st.get("lon"),
            "tier": st.get("tier"),
        })

    return JsonResponse({
        "stations": formatted,
        "count": len(formatted),
        "cities": list(services.CITIES.keys()),
    })


@require_http_methods(["GET"])
@require_api_key
def api_v1_cities(request):
    """Get list of supported cities."""
    cities = []
    for key, data in services.CITIES.items():
        cities.append({
            "id": key,
            "name": data["label"],
            "lat": data["lat"],
            "lon": data["lon"],
        })

    return JsonResponse({
        "cities": cities,
        "count": len(cities),
    })


def api_docs(request):
    """Render the API documentation page."""
    # Get user's API keys if authenticated
    api_keys = []
    if request.user.is_authenticated:
        api_keys = list(request.user.api_keys.filter(is_active=True).values(
            "key", "name", "created_at", "last_used"
        ))

    return render(request, "dashboard/api_docs.html", {
        "api_keys": api_keys,
        "cities": list(services.CITIES.keys()),
    })


@csrf_exempt
@require_http_methods(["GET", "POST"])
def api_create_key(request):
    """List API keys (GET) or create a new one (POST)."""
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Authentication required"}, status=401)

    # GET: List user's API keys with rate limit info
    if request.method == "GET":
        api_keys = request.user.api_keys.filter(is_active=True)
        keys = []
        for ak in api_keys:
            # Calculate remaining requests
            now = timezone.now()
            if ak.hour_started and (now - ak.hour_started).total_seconds() < 3600:
                requests_used = ak.requests_this_hour
                reset_seconds = int(3600 - (now - ak.hour_started).total_seconds())
            else:
                requests_used = 0
                reset_seconds = 3600
            remaining = max(0, APIKey.RATE_LIMIT - requests_used)

            keys.append({
                "key": ak.key,
                "name": ak.name,
                "created_at": ak.created_at.isoformat() if ak.created_at else None,
                "last_used": ak.last_used.isoformat() if ak.last_used else None,
                "rate_limit": APIKey.RATE_LIMIT,
                "requests_used": requests_used,
                "requests_remaining": remaining,
                "reset_seconds": reset_seconds,
            })
        return JsonResponse({"keys": keys})

    # POST: Create new key
    # Limit to 5 keys per user
    if request.user.api_keys.filter(is_active=True).count() >= 5:
        return JsonResponse({"error": "Maximum 5 API keys allowed"}, status=400)

    import json
    try:
        data = json.loads(request.body) if request.body else {}
    except json.JSONDecodeError:
        data = {}

    name = data.get("name", "")[:100]
    api_key = APIKey.objects.create(user=request.user, name=name)

    return JsonResponse({
        "key": api_key.key,
        "name": api_key.name,
        "created_at": api_key.created_at.isoformat(),
    })


@csrf_exempt
@require_http_methods(["POST"])
def api_revoke_key(request):
    """Revoke an API key."""
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Authentication required"}, status=401)

    import json
    try:
        data = json.loads(request.body) if request.body else {}
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    key = data.get("key", "")
    try:
        api_key = APIKey.objects.get(key=key, user=request.user)
        api_key.is_active = False
        api_key.save()
        return JsonResponse({"ok": True})
    except APIKey.DoesNotExist:
        return JsonResponse({"error": "API key not found"}, status=404)


@csrf_exempt
@require_http_methods(["POST"])
def api_register_device(request):
    """Register a device for push notifications."""
    import json
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
    import json
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

from django.contrib import auth
from django.http import JsonResponse
from django.shortcuts import render, redirect
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from . import services
from .models import ReadingSnapshot


def index(request):
    cities = list(services.CITIES.keys())
    return render(request, "dashboard/index.html", {"cities": cities})


def api_stations(request, city=None):
    if city:
        stations = services.load_stations(city)
    else:
        stations = services.load_all_stations()
    return JsonResponse({
        "stations": stations,
        "cities": services.CITIES,
    })


def api_demo(request, city=None):
    if city:
        stations = services.load_stations(city)
        readings = services.DEMO_DATA.get(city, {})
    else:
        stations = services.load_all_stations()
        readings = services.get_all_demo_data()
    # Demo uses same readings as "previous" to simulate sustained conditions
    result = services.evaluate(stations, readings, previous_readings=readings)
    return JsonResponse({"results": result["stations"], "city_alerts": result["city_alerts"]})


@csrf_exempt
def api_fetch(request, city=None):
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Login required to fetch live data", "auth_required": True}, status=401)

    profile = request.user.profile
    if not profile.can_fetch():
        return JsonResponse({
            "error": f"Rate limited. Try again in {profile.minutes_until_fetch()} minutes.",
            "rate_limited": True,
            "seconds_remaining": profile.seconds_until_fetch(),
        }, status=429)

    config = services.load_config()
    api_key = config.get("api_key", "")

    if not api_key:
        return JsonResponse({"error": "No WAQI API token configured"}, status=400)

    if city:
        stations = services.load_stations(city)
    else:
        stations = services.load_all_stations()
    readings = services.fetch_latest_pm25(api_key, stations)

    # Load previous readings for Rule 2 (dual-station sustained check)
    previous_readings = {}
    for city_key in services.CITIES:
        try:
            snap = ReadingSnapshot.objects.get(city=city_key)
            previous_readings.update(snap.readings)
        except ReadingSnapshot.DoesNotExist:
            pass

    result = services.evaluate(stations, readings, previous_readings=previous_readings)

    # Save current readings as the new snapshot for next fetch
    city_readings = {}
    for st in stations:
        sid = st["id"]
        if sid in readings:
            tc = st.get("target_city", "")
            city_readings.setdefault(tc, {})[sid] = readings[sid]
    for city_key, cr in city_readings.items():
        ReadingSnapshot.objects.update_or_create(city=city_key, defaults={"readings": cr})

    profile.last_fetch_time = timezone.now()
    profile.last_fetch_results = result
    profile.save(update_fields=["last_fetch_time", "last_fetch_results"])

    return JsonResponse({"results": result["stations"], "city_alerts": result["city_alerts"]})


def api_auth_status(request):
    if request.user.is_authenticated:
        profile = request.user.profile
        return JsonResponse({
            "authenticated": True,
            "username": request.user.get_full_name() or request.user.email or request.user.username,
            "can_fetch": profile.can_fetch(),
            "seconds_remaining": profile.seconds_until_fetch(),
            "has_cached_results": profile.last_fetch_results is not None,
        })
    return JsonResponse({"authenticated": False})


def api_last_results(request):
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Login required"}, status=401)
    profile = request.user.profile
    if profile.last_fetch_results:
        cached = profile.last_fetch_results
        # Handle both old format (list) and new format (dict with stations/city_alerts)
        if isinstance(cached, dict) and "stations" in cached:
            return JsonResponse({"results": cached["stations"], "city_alerts": cached.get("city_alerts", {})})
        return JsonResponse({"results": cached})
    return JsonResponse({"results": None})


def logout_view(request):
    auth.logout(request)
    return redirect("/")

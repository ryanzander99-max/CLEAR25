"""
Core views: index, stations, demo, live data, refresh, authentication.
"""

import datetime
import os

from django.contrib import auth
from django.core.cache import cache
from django.http import JsonResponse
from django.shortcuts import render, redirect
from django.utils import timezone
from django.views.decorators.cache import cache_page
from django.views.decorators.http import require_http_methods

from .. import services
from ..models import ReadingSnapshot, CachedResult


def index(request):
    """Render the main dashboard page."""
    cities = list(services.CITIES.keys())
    current_plan = "free"
    plan_expires = None
    if request.user.is_authenticated:
        try:
            profile = request.user.profile
            current_plan = profile.active_plan
            plan_expires = profile.plan_expires
        except Exception:
            pass
    return render(request, "dashboard/index.html", {
        "cities": cities,
        "current_plan": current_plan,
        "plan_expires": plan_expires,
    })


@cache_page(60 * 5)  # Cache for 5 minutes
@require_http_methods(["GET"])
def api_stations(request, city=None):
    """Get station data. Cached for 5 minutes."""
    if city and city not in services.CITIES:
        return JsonResponse({"error": "Invalid city"}, status=400)

    if city:
        stations = services.load_stations(city)
    else:
        stations = services.load_all_stations()

    return JsonResponse({
        "stations": stations,
        "cities": services.CITIES,
    })


@cache_page(60 * 5)  # Cache for 5 minutes
@require_http_methods(["GET"])
def api_demo(request, city=None):
    """Get demo data. Cached for 5 minutes."""
    if city and city not in services.CITIES:
        return JsonResponse({"error": "Invalid city"}, status=400)

    if city:
        stations = services.load_stations(city)
        readings = services.DEMO_DATA.get(city, {})
    else:
        stations = services.load_all_stations()
        readings = services.get_all_demo_data()

    result = services.evaluate(stations, readings, previous_readings=readings)
    return JsonResponse({"results": result["stations"], "city_alerts": result["city_alerts"]})


@require_http_methods(["GET"])
def api_live(request):
    """Return the latest cached results from the server-side refresh.

    Public endpoint with short-term caching to reduce DB hits.
    """
    cache_key = "api_live_response"
    cached_response = cache.get(cache_key)

    if cached_response:
        return JsonResponse(cached_response)

    try:
        cached = CachedResult.objects.get(key="latest")
        age_seconds = (timezone.now() - cached.timestamp).total_seconds()
        response_data = {
            "results": cached.results,
            "city_alerts": cached.city_alerts,
            "timestamp": cached.timestamp.isoformat(),
            "age_seconds": int(age_seconds),
        }
        cache.set(cache_key, response_data, 30)
        return JsonResponse(response_data)
    except CachedResult.DoesNotExist:
        return JsonResponse({"results": None, "city_alerts": {}, "timestamp": None})


def api_refresh(request):
    """Cron endpoint: fetch WAQI data, evaluate, store in DB.

    Protected by CRON_SECRET environment variable.
    """
    cron_secret = os.environ.get("CRON_SECRET", "")
    auth_header = request.headers.get("Authorization", "")
    if not cron_secret or auth_header != f"Bearer {cron_secret}":
        return JsonResponse({"error": "Unauthorized"}, status=401)

    config = services.load_config()
    api_key = config.get("api_key", "")
    if not api_key:
        return JsonResponse({"error": "No WAQI API token configured"}, status=400)

    try:
        stations = services.load_all_stations()
        readings = services.fetch_latest_pm25(api_key, stations)

        # Load previous readings for Rule 2 (dual-station sustained check)
        now = timezone.now()
        previous_readings = {}
        for city_key in services.CITIES:
            try:
                snap = ReadingSnapshot.objects.get(city=city_key)
                age = now - snap.timestamp
                if datetime.timedelta(minutes=20) <= age <= datetime.timedelta(hours=3):
                    previous_readings.update(snap.readings)
            except ReadingSnapshot.DoesNotExist:
                pass

        result = services.evaluate(stations, readings, previous_readings=previous_readings)

        # Save current readings as snapshots for next refresh
        city_readings = {}
        for st in stations:
            sid = st["id"]
            if sid in readings:
                tc = st.get("target_city", "")
                city_readings.setdefault(tc, {})[sid] = readings[sid]
        for city_key, cr in city_readings.items():
            ReadingSnapshot.objects.update_or_create(city=city_key, defaults={"readings": cr})

        # Store evaluated results in CachedResult
        CachedResult.objects.update_or_create(
            key="latest",
            defaults={
                "results": result["stations"],
                "city_alerts": result["city_alerts"],
                "readings": readings,
            },
        )

        return JsonResponse({
            "ok": True,
            "stations_fetched": len(readings),
            "stations_evaluated": len(result["stations"]),
        })
    except Exception as e:
        import traceback
        return JsonResponse({"error": str(e), "trace": traceback.format_exc()}, status=500)


def api_auth_status(request):
    """Return current authentication status."""
    if request.user.is_authenticated:
        return JsonResponse({
            "authenticated": True,
            "username": request.user.get_full_name() or request.user.email or request.user.username,
        })
    return JsonResponse({"authenticated": False})


def logout_view(request):
    """Log out the current user and redirect to home."""
    auth.logout(request)
    return redirect("/")

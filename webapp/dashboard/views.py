from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import csrf_exempt

from . import services


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
    results = services.evaluate(stations, readings)
    return JsonResponse({"results": results})


@csrf_exempt
def api_fetch(request, city=None):
    config = services.load_config()
    api_key = config.get("api_key", "")

    if not api_key:
        return JsonResponse({"error": "No PurpleAir API key configured"}, status=400)

    if city:
        stations = services.load_stations(city)
    else:
        stations = services.load_all_stations()
    readings = services.fetch_latest_pm25(api_key, stations)
    results = services.evaluate(stations, readings)
    return JsonResponse({"results": results})

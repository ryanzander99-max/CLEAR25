"""
Public API v1 endpoints for CLEAR25.
"""

import datetime
from functools import wraps

from django.http import JsonResponse
from django.shortcuts import render
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from django.conf import settings

from .. import services
from ..models import APIKey, CachedResult, DeviceToken, Payment, PLAN_LIMITS


# Level name to integer mapping (matches Toronto PM2.5 Methodology v3.0)
LEVEL_MAP = {
    "LOW": 1,
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
            rate_limit = api_key.get_rate_limit()
            response = JsonResponse({
                "error": "Rate limit exceeded",
                "retry_after": reset
            }, status=429)
            response["X-RateLimit-Limit"] = str(rate_limit)
            response["X-RateLimit-Remaining"] = "0"
            response["X-RateLimit-Reset"] = str(reset)
            return response

        request.api_key = api_key
        response = view_func(request, *args, **kwargs)

        # Add rate limit headers to successful responses
        rate_limit = api_key.get_rate_limit()
        response["X-RateLimit-Limit"] = str(rate_limit)
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


def billing_page(request):
    """Render the billing/subscription page."""
    if not request.user.is_authenticated:
        from django.shortcuts import redirect
        return redirect("/accounts/google/login/")
    profile = request.user.profile
    return render(request, "dashboard/billing.html", {
        "current_plan": profile.active_plan,
        "plan_expires": profile.plan_expires,
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
        profile = request.user.profile
        api_keys = request.user.api_keys.filter(is_active=True)
        rate_limit = profile.rate_limit
        keys = []
        for ak in api_keys:
            now = timezone.now()
            has_active_window = ak.hour_started and (now - ak.hour_started).total_seconds() < 3600
            if has_active_window:
                requests_used = ak.requests_this_hour
                reset_seconds = int(3600 - (now - ak.hour_started).total_seconds())
            else:
                requests_used = 0
                reset_seconds = 0
            remaining = max(0, rate_limit - requests_used)

            keys.append({
                "key": ak.key,
                "name": ak.name,
                "created_at": ak.created_at.isoformat() if ak.created_at else None,
                "last_used": ak.last_used.isoformat() if ak.last_used else None,
                "rate_limit": rate_limit,
                "requests_used": requests_used,
                "requests_remaining": remaining,
                "reset_seconds": reset_seconds,
                "has_active_window": has_active_window,
                "total_requests": ak.total_requests,
            })
        return JsonResponse({
            "keys": keys,
            "plan": profile.active_plan,
            "max_keys": profile.max_api_keys,
        })

    # POST: Create new key
    max_keys = request.user.profile.max_api_keys
    if request.user.api_keys.filter(is_active=True).count() >= max_keys:
        return JsonResponse({"error": f"Maximum {max_keys} API key{'s' if max_keys > 1 else ''} allowed on your plan"}, status=400)

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


# ── Subscription / Payment endpoints ────────────────────────────────

PLAN_PRICES = {"pro": 29, "business": 99}


@csrf_exempt
@require_http_methods(["POST"])
def api_create_payment(request):
    """Create a NOWPayments invoice for a plan upgrade."""
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Authentication required"}, status=401)

    import json
    try:
        data = json.loads(request.body) if request.body else {}
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    plan = data.get("plan", "")
    if plan not in PLAN_PRICES:
        return JsonResponse({"error": f"Invalid plan. Choose: {', '.join(PLAN_PRICES.keys())}"}, status=400)

    amount = PLAN_PRICES[plan]
    api_key = getattr(settings, "NOWPAYMENTS_API_KEY", "")
    if not api_key:
        return JsonResponse({"error": "Payment system not configured"}, status=503)

    import requests as http_requests
    try:
        resp = http_requests.post(
            "https://api.nowpayments.io/v1/invoice",
            headers={
                "x-api-key": api_key,
                "Content-Type": "application/json",
            },
            json={
                "price_amount": amount,
                "price_currency": "usd",
                "order_id": f"{request.user.id}_{plan}_{int(timezone.now().timestamp())}",
                "order_description": f"CLEAR25 {plan.title()} Plan - 30 days",
                "success_url": "https://clear25.xyz/billing/?status=success",
                "cancel_url": "https://clear25.xyz/billing/?status=cancelled",
                "ipn_callback_url": "https://clear25.xyz/api/v1/subscribe/webhook/",
            },
            timeout=15,
        )
        resp.raise_for_status()
        invoice = resp.json()
    except Exception as e:
        return JsonResponse({"error": f"Payment service error: {str(e)}"}, status=502)

    # Save payment record
    Payment.objects.create(
        user=request.user,
        plan=plan,
        amount_usd=amount,
        nowpayments_id=str(invoice.get("id", "")),
        status="waiting",
    )

    return JsonResponse({
        "invoice_url": invoice.get("invoice_url"),
        "invoice_id": invoice.get("id"),
    })


@csrf_exempt
@require_http_methods(["POST"])
def api_payment_webhook(request):
    """NOWPayments IPN callback — verifies and upgrades plan."""
    import json
    import hashlib
    import hmac

    ipn_secret = getattr(settings, "NOWPAYMENTS_IPN_SECRET", "")
    if not ipn_secret:
        return JsonResponse({"error": "Not configured"}, status=503)

    # Verify HMAC signature
    sig = request.headers.get("x-nowpayments-sig", "")
    try:
        body = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    # NOWPayments signature: HMAC-SHA512 of sorted JSON body
    sorted_body = json.dumps(body, sort_keys=True, separators=(",", ":"))
    expected_sig = hmac.new(
        ipn_secret.encode(), sorted_body.encode(), hashlib.sha512
    ).hexdigest()

    if not hmac.compare_digest(sig, expected_sig):
        return JsonResponse({"error": "Invalid signature"}, status=403)

    # Process payment
    payment_status = body.get("payment_status", "")
    invoice_id = str(body.get("invoice_id", "") or body.get("order_id", ""))

    if payment_status in ("finished", "confirmed"):
        try:
            payment = Payment.objects.get(nowpayments_id=invoice_id)
            payment.status = "confirmed"
            payment.save()

            # Upgrade user plan
            profile = payment.user.profile
            profile.plan = payment.plan
            profile.plan_expires = timezone.now() + datetime.timedelta(days=30)
            profile.save(update_fields=["plan", "plan_expires"])
        except Payment.DoesNotExist:
            pass

    elif payment_status in ("failed", "expired"):
        try:
            payment = Payment.objects.get(nowpayments_id=invoice_id)
            payment.status = "failed"
            payment.save()
        except Payment.DoesNotExist:
            pass

    return JsonResponse({"ok": True})


@require_http_methods(["GET"])
def api_subscription_status(request):
    """Get current subscription status."""
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Authentication required"}, status=401)

    profile = request.user.profile
    plan = profile.active_plan
    limits = PLAN_LIMITS[plan]

    return JsonResponse({
        "plan": plan,
        "plan_expires": profile.plan_expires.isoformat() if profile.plan_expires else None,
        "rate_limit": limits["rate_limit"],
        "max_keys": limits["max_keys"],
    })

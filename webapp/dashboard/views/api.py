"""
Public API v1 endpoints for CLEAR25.
"""

import datetime
import logging
import os
from functools import wraps

logger = logging.getLogger(__name__)

from django.http import JsonResponse
from django.shortcuts import render
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from django.conf import settings

import jwt as _jwt

from .. import services
from ..jwt_auth import create_access_token, decode_access_token
from ..models import APIKey, CachedResult, DeviceToken, Payment, PLAN_LIMITS, RefreshToken
from .utils import safe_redirect


# Level name to integer mapping (matches Toronto PM2.5 Methodology v3.0)
LEVEL_MAP = {
    "LOW": 1,
    "MODERATE": 2,
    "HIGH": 3,
    "VERY HIGH": 4,
    "EXTREME": 5,
}


def require_api_key(view_func):
    """Decorator: accept either a JWT access token or a raw API key.

    Priority:
    1. Try to decode the bearer value as a JWT access token.
       If valid, look up the embedded ``key_id`` for rate-limiting.
    2. Fall back to treating it as a plain API key (backward-compat).
    """
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return JsonResponse({
                "error": "Missing or invalid Authorization header",
                "hint": "Use 'Authorization: Bearer YOUR_API_KEY_OR_JWT'",
            }, status=401)

        token = auth_header[7:]
        api_key = None

        # ── 1. Try JWT access token ──────────────────────────────────────────
        try:
            payload = decode_access_token(token)
            try:
                api_key = APIKey.objects.get(id=payload["key_id"], is_active=True)
            except APIKey.DoesNotExist:
                return JsonResponse({"error": "API key associated with this token has been revoked"}, status=401)
        except _jwt.ExpiredSignatureError:
            return JsonResponse({"error": "Access token has expired", "hint": "Use /api/v1/auth/refresh/ to get a new one"}, status=401)
        except _jwt.InvalidTokenError:
            # Not a JWT — fall through to raw API key check
            pass

        # ── 2. Fall back to raw API key ──────────────────────────────────────
        if api_key is None:
            try:
                api_key = APIKey.objects.get(key=token, is_active=True)
            except APIKey.DoesNotExist:
                return JsonResponse({"error": "Invalid API key or token"}, status=401)

        # ── Rate limit ───────────────────────────────────────────────────────
        allowed, remaining, reset = api_key.check_rate_limit()
        if not allowed:
            rate_limit = api_key.get_rate_limit()
            response = JsonResponse({"error": "Rate limit exceeded", "retry_after": reset}, status=429)
            response["X-RateLimit-Limit"] = str(rate_limit)
            response["X-RateLimit-Remaining"] = "0"
            response["X-RateLimit-Reset"] = str(reset)
            return response

        request.api_key = api_key
        response = view_func(request, *args, **kwargs)

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

    # Filter out excluded stations
    results = [r for r in results if r.get("id") not in services.EXCLUDED_STATION_IDS]

    # Allow filtering by station ID via ?station=<id>
    station_id = request.GET.get("station")
    if station_id:
        results = [r for r in results if r.get("id") == station_id]
        if not results:
            return JsonResponse({"error": f"Station '{station_id}' not found"}, status=404)

    # Format stations for API (limit to 1 per request)
    stations = [_format_station_for_api(r) for r in results[:1]]

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
        return safe_redirect("/accounts/google/login/")
    try:
        profile = request.user.profile
        current_plan = profile.active_plan
        plan_expires = profile.plan_expires
    except Exception:
        current_plan = "free"
        plan_expires = None
    return render(request, "dashboard/billing.html", {
        "current_plan": current_plan,
        "plan_expires": plan_expires,
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

PLAN_PRICES = {
    "pro":      {"monthly": 29,  "yearly": 290},   # yearly ≈ $24/mo, save 17%
    "business": {"monthly": 99,  "yearly": 948},   # yearly ≈ $79/mo, save 20%
}


@csrf_exempt
@require_http_methods(["POST"])
def api_create_payment(request):
    """Create a NOWPayments invoice for a plan upgrade."""
    try:
        if not request.user.is_authenticated:
            return JsonResponse({"error": "Authentication required"}, status=401)

        import json
        try:
            data = json.loads(request.body) if request.body else {}
        except json.JSONDecodeError:
            return JsonResponse({"error": "Invalid JSON"}, status=400)

        plan = data.get("plan", "")
        period = data.get("period", "monthly")
        if plan not in PLAN_PRICES:
            return JsonResponse({"error": f"Invalid plan. Choose: {', '.join(PLAN_PRICES.keys())}"}, status=400)
        if period not in ("monthly", "yearly"):
            return JsonResponse({"error": "Invalid period. Choose: monthly, yearly"}, status=400)

        amount = PLAN_PRICES[plan][period]
        days = 365 if period == "yearly" else 30
        period_label = "12 months" if period == "yearly" else "30 days"

        api_key = getattr(settings, "NOWPAYMENTS_API_KEY", "")
        if not api_key:
            return JsonResponse({"error": "Payment system not configured"}, status=503)

        import requests as http_requests
        base_url = getattr(settings, "NOWPAYMENTS_API_URL", "https://api.nowpayments.io")
        resp = http_requests.post(
            f"{base_url}/v1/invoice",
            headers={
                "x-api-key": api_key,
                "Content-Type": "application/json",
            },
            json={
                "price_amount": amount,
                "price_currency": "usd",
                "order_id": f"{request.user.id}_{plan}_{period}_{int(timezone.now().timestamp())}",
                "order_description": f"CLEAR25 {plan.title()} Plan - {period_label}",
                "success_url": "https://clear25.xyz/dashboard/?tab=billing&status=success",
                "cancel_url": "https://clear25.xyz/dashboard/?tab=billing&status=cancelled",
                "ipn_callback_url": "https://clear25.xyz/api/v1/subscribe/webhook/",
            },
            timeout=15,
        )
        resp.raise_for_status()
        invoice = resp.json()

        # Save payment record
        Payment.objects.create(
            user=request.user,
            plan=plan,
            billing_period=period,
            amount_usd=amount,
            nowpayments_id=str(invoice.get("id", "")),
            status="waiting",
        )

        return JsonResponse({
            "invoice_url": invoice.get("invoice_url"),
            "invoice_id": invoice.get("id"),
        })
    except Exception:
        logger.exception("api_create_payment: unexpected error for user %s", request.user.id)
        return JsonResponse({"error": "Payment service unavailable. Please try again."}, status=500)


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
            days = 365 if payment.billing_period == "yearly" else 30
            profile = payment.user.profile
            profile.plan = payment.plan
            profile.plan_expires = timezone.now() + datetime.timedelta(days=days)
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


@csrf_exempt
@require_http_methods(["POST"])
def api_test_upgrade(request):
    """TEST ONLY: Simulate a plan upgrade without payment.

    Protected by CRON_SECRET. Usage:
      curl -X POST https://clear25.xyz/api/v1/subscribe/test/ \
           -H "Authorization: Bearer <CRON_SECRET>" \
           -H "Content-Type: application/json" \
           -d '{"user_id": 1, "plan": "pro"}'
    """
    cron_secret = os.environ.get("CRON_SECRET", "")
    auth_header = request.headers.get("Authorization", "")
    if not cron_secret or auth_header != f"Bearer {cron_secret}":
        return JsonResponse({"error": "Unauthorized"}, status=401)

    import json
    try:
        data = json.loads(request.body) if request.body else {}
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    plan = data.get("plan", "")
    if plan not in ("pro", "business"):
        return JsonResponse({"error": "plan must be 'pro' or 'business'"}, status=400)

    user_id = data.get("user_id")
    if not user_id:
        return JsonResponse({"error": "user_id required"}, status=400)

    from django.contrib.auth.models import User
    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return JsonResponse({"error": f"User {user_id} not found"}, status=404)

    profile = user.profile
    profile.plan = plan
    profile.plan_expires = timezone.now() + datetime.timedelta(days=30)
    profile.save(update_fields=["plan", "plan_expires"])

    return JsonResponse({
        "ok": True,
        "user": user.email or user.username,
        "plan": plan,
        "expires": profile.plan_expires.isoformat(),
    })


# ── JWT Auth endpoints ────────────────────────────────────────────────────────

@csrf_exempt
@require_http_methods(["POST"])
def api_v1_get_token(request):
    """Exchange an API key for a JWT access token + refresh token.

    Request body:
      { "api_key": "<your_api_key>" }

    Response:
      {
        "access_token":  "<jwt>",           // valid 1 hour
        "refresh_token": "<opaque_token>",  // valid 7 days
        "expires_in":    3600,
        "token_type":    "Bearer"
      }
    """
    import json
    try:
        data = json.loads(request.body) if request.body else {}
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    raw_key = data.get("api_key", "").strip()
    if not raw_key:
        return JsonResponse({"error": "api_key is required"}, status=400)

    try:
        api_key = APIKey.objects.select_related("user").get(key=raw_key, is_active=True)
    except APIKey.DoesNotExist:
        return JsonResponse({"error": "Invalid API key"}, status=401)

    # Revoke any expired refresh tokens for this user to keep the table clean
    RefreshToken.objects.filter(user=api_key.user, expires_at__lt=timezone.now()).update(revoked=True)

    access_token = create_access_token(api_key.user_id, api_key.id)
    raw_refresh, _ = RefreshToken.create_for_user(api_key.user)

    from ..jwt_auth import ACCESS_TOKEN_LIFETIME
    return JsonResponse({
        "access_token":  access_token,
        "refresh_token": raw_refresh,
        "expires_in":    int(ACCESS_TOKEN_LIFETIME.total_seconds()),
        "token_type":    "Bearer",
    })


@csrf_exempt
@require_http_methods(["POST"])
def api_v1_refresh_token(request):
    """Rotate a refresh token — invalidates the old one and issues a new pair.

    Request body:
      { "refresh_token": "<current_refresh_token>" }

    Response: same shape as /api/v1/auth/token/
    """
    import json
    try:
        data = json.loads(request.body) if request.body else {}
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    raw_refresh = data.get("refresh_token", "").strip()
    if not raw_refresh:
        return JsonResponse({"error": "refresh_token is required"}, status=400)

    rt = RefreshToken.verify(raw_refresh)
    if rt is None:
        return JsonResponse({"error": "Invalid or expired refresh token"}, status=401)

    # Rotation: revoke the used token immediately
    rt.revoked = True
    rt.save(update_fields=["revoked"])

    # Get an active API key for this user (needed to embed key_id in access token)
    api_key = rt.user.api_keys.filter(is_active=True).first()
    if not api_key:
        return JsonResponse({"error": "No active API key on account"}, status=401)

    access_token = create_access_token(rt.user_id, api_key.id)
    raw_new_refresh, _ = RefreshToken.create_for_user(rt.user)

    from ..jwt_auth import ACCESS_TOKEN_LIFETIME
    return JsonResponse({
        "access_token":  access_token,
        "refresh_token": raw_new_refresh,
        "expires_in":    int(ACCESS_TOKEN_LIFETIME.total_seconds()),
        "token_type":    "Bearer",
    })


@csrf_exempt
@require_http_methods(["POST"])
def api_v1_revoke_token(request):
    """Revoke a refresh token, ending the token family.

    Request body:
      { "refresh_token": "<refresh_token_to_revoke>" }
    """
    import json
    try:
        data = json.loads(request.body) if request.body else {}
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    raw_refresh = data.get("refresh_token", "").strip()
    if not raw_refresh:
        return JsonResponse({"error": "refresh_token is required"}, status=400)

    rt = RefreshToken.verify(raw_refresh)
    if rt is not None:
        rt.revoked = True
        rt.save(update_fields=["revoked"])

    # Always return ok — don't leak whether the token existed
    return JsonResponse({"ok": True})

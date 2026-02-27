"""
JWT token endpoints: exchange, refresh, revoke.
"""

import json

from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from ..jwt_auth import ACCESS_TOKEN_LIFETIME, create_access_token
from ..models import APIKey, RefreshToken


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

"""
JWT utilities for the CLEAR25 public API.

Access tokens  — HS256, 1 hour lifetime, signed with SECRET_KEY.
Refresh tokens — opaque random bytes, SHA-256 hashed before storage,
                 7-day lifetime, rotated on every use.
"""

import uuid

import jwt

from django.conf import settings
from django.utils import timezone

from datetime import timedelta

# ── Constants ─────────────────────────────────────────────────────────────────

ACCESS_TOKEN_LIFETIME  = timedelta(hours=1)
REFRESH_TOKEN_LIFETIME = timedelta(days=7)
JWT_ALGORITHM          = "HS256"


# ── Access token ──────────────────────────────────────────────────────────────

def create_access_token(user_id: int, api_key_id: int) -> str:
    """Return a signed JWT access token valid for 1 hour.

    Embeds ``key_id`` so that the rate-limit counter for the originating
    API key is reused on JWT-authenticated requests.
    """
    now = timezone.now()
    payload = {
        "sub":    user_id,
        "key_id": api_key_id,
        "iat":    int(now.timestamp()),
        "exp":    int((now + ACCESS_TOKEN_LIFETIME).timestamp()),
        "jti":    uuid.uuid4().hex,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> dict:
    """Decode and verify a JWT access token.

    Raises ``jwt.InvalidTokenError`` (or a subclass) on any failure:
    expired, bad signature, missing fields, etc.
    """
    return jwt.decode(
        token,
        settings.SECRET_KEY,
        algorithms=[JWT_ALGORITHM],
        options={"require": ["sub", "key_id", "exp", "iat", "jti"]},
    )

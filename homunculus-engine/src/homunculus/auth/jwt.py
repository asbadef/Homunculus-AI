"""
JWT access and refresh token utilities.
Secrets are read from environment variables — never hardcoded.
"""
from __future__ import annotations
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from jose import JWTError, jwt

# Y1/Y4: there is NO fallback secret. A publicly known or short secret would let anyone mint tokens
# (including mfa_verified=true), so the app refuses to start in every environment without a real one.
_KNOWN_PLACEHOLDERS = {"CHANGE_ME_IN_PRODUCTION_USE_32_CHARS_MIN", "dev-insecure-seed-change-me"}
JWT_SECRET = os.getenv("JWT_SECRET", "")
if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET must be set (generate with: openssl rand -hex 32).")
if JWT_SECRET in _KNOWN_PLACEHOLDERS or len(JWT_SECRET) < 32:
    raise RuntimeError("JWT_SECRET is a known placeholder or shorter than 32 characters.")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))


def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_access_token(subject: str, extra: dict[str, Any] | None = None) -> str:
    payload = {
        "sub": subject,
        "iat": _now(),
        "exp": _now() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
        "jti": str(uuid.uuid4()),
        "type": "access",
        **(extra or {}),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def create_refresh_token(subject: str, extra: dict[str, Any] | None = None) -> str:
    payload = {
        "sub": subject,
        "iat": _now(),
        "exp": _now() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
        "jti": str(uuid.uuid4()),
        "type": "refresh",
        **(extra or {}),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict[str, Any]:
    """Raises JWTError on invalid/expired token."""
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])

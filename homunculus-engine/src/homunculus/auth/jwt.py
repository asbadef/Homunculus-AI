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

_DEFAULT_SECRET = "CHANGE_ME_IN_PRODUCTION_USE_32_CHARS_MIN"

JWT_SECRET = os.getenv("JWT_SECRET", _DEFAULT_SECRET)
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))


def jwt_secret_problem(secret: str | None) -> str | None:
    """Why a signing key is unfit for a real deployment, or None. The token is the only
    authority for `perms` and `tenant`, so whoever knows the key can mint an administrator.
    The reason never quotes the key."""
    if not secret:
        return "JWT_SECRET is not set"
    if secret == _DEFAULT_SECRET:
        return "JWT_SECRET is the public default"
    if len(secret) < 32:
        return "JWT_SECRET is shorter than 32 characters"
    return None


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
    """The refresh token carries `mfa_verified` (set after a TOTP step) so that the hourly
    transparent refresh does not send a verified clinician back to the MFA gate. It never
    carries `tv`: a rights change must survive a refresh, not end the session."""
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
    """Raises JWTError on invalid/expired token, or one missing `exp`/`sub`."""
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM],
                       options={"require_exp": True, "require_sub": True})

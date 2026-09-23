"""
FastAPI dependencies for authentication and authorisation.

    get_principal_pre_mfa   decode the access token, load the user, check is_active and the
                            token version -> Principal (401 on any failure)
    get_principal           + the MFA gate: 403 `mfa_required` while a TOTP step is pending
    get_current_user        the User behind get_principal
    get_current_user_pre_mfa the User behind get_principal_pre_mfa — ONLY for /auth/totp/*, /auth/me
    require_permission(*k)  any-of check against the token's `perms` -> 403 naming the keys

The permission check reads the token, not the database: the token was minted from the user's
groups, and `token_version` guarantees it still reflects them (a change bumps the version and
this dependency refuses the old token, so the client's transparent refresh mints a current one).
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.auth.jwt import decode_token
from homunculus.auth.models import User
from homunculus.auth.permissions import validate_permissions
from homunculus.auth.service import get_user_by_id
from homunculus.db import get_db

_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class Principal:
    """Who is calling, as the signed token says — plus the freshly loaded User row."""
    user: User
    tenant: str | None
    groups: tuple[str, ...]
    perms: frozenset[str]
    mfa_required: bool
    mfa_verified: bool


def _unauthorized(detail: str = "Invalid or missing authentication credentials") -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail,
                         headers={"WWW-Authenticate": "Bearer"})


def access_claims(token: str) -> dict:
    """Decode an ACCESS token or raise 401. A refresh token (same secret) is refused by `type`."""
    try:
        claims = decode_token(token)
    except JWTError:
        raise _unauthorized()
    if claims.get("type") != "access" or not claims.get("sub"):
        raise _unauthorized()
    return claims


async def get_principal_pre_mfa(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> Principal:
    if not credentials:
        raise _unauthorized()
    claims = access_claims(credentials.credentials)
    try:
        user_id = uuid.UUID(str(claims["sub"]))
    except ValueError:
        raise _unauthorized()
    user = await get_user_by_id(db, user_id)
    if user is None or not user.is_active:
        raise _unauthorized()
    if int(claims.get("tv", 0)) != int(user.token_version):
        # The user's rights changed after this token was minted. The client refreshes and gets
        # a token built from the current groups; nothing is lost but one round trip.
        raise _unauthorized("token_version")
    return Principal(
        user=user,
        tenant=claims.get("tenant"),
        groups=tuple(claims.get("groups") or ()),
        perms=frozenset(claims.get("perms") or ()),
        mfa_required=bool(claims.get("mfa_required")),
        mfa_verified=bool(claims.get("mfa_verified")),
    )


async def get_principal(principal: Principal = Depends(get_principal_pre_mfa)) -> Principal:
    if principal.mfa_required and not principal.mfa_verified:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="mfa_required")
    return principal


async def get_current_user(principal: Principal = Depends(get_principal)) -> User:
    return principal.user


async def get_current_user_pre_mfa(
    principal: Principal = Depends(get_principal_pre_mfa),
) -> User:
    return principal.user


# Existing routers import this name; it is the MFA-gated user, exactly as before.
get_current_active_user = get_current_user


def require_permission(*keys: str):
    """Dependency factory: the caller must hold ANY of `keys`. Unknown keys fail here, at
    import time, so a typo in a route guard stops the service from starting."""
    wanted = frozenset(validate_permissions(keys))

    async def _check(principal: Principal = Depends(get_principal)) -> User:
        if not (principal.perms & wanted):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"permission required: {' or '.join(sorted(wanted))}",
            )
        return principal.user

    return _check


# --------------------------------------------------------------------------------------------
# TEMPORARY SHIM — deleted in Task 7 together with UserRole. Routers still import it; the
# tokens issued from Task 6 on carry no `roles` claim, so this refuses everything until each
# router is moved to require_permission. Nothing ships between those two tasks.
# --------------------------------------------------------------------------------------------
def require_roles(*roles):
    async def _check(principal: Principal = Depends(get_principal)) -> User:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="role guards are being replaced by permissions")
    return _check

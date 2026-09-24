"""
FastAPI dependencies for authentication and authorisation.

    get_principal_pre_mfa   decode the access token, load the user, check is_active and the
                            token version -> Principal (401 on any failure)
    get_principal           + the MFA gate: 403 `mfa_required` while a TOTP step is pending
    get_current_user        the User behind get_principal
    get_current_user_pre_mfa the User behind get_principal_pre_mfa — ONLY for /auth/me
                            (/auth/totp/verify takes get_principal_pre_mfa itself, for the tenant)
    get_user_for_enrolment  the User behind get_principal_pre_mfa, but an already-enrolled user
                            may only pass it once MFA is verified — see its docstring
    require_permission(*k)  any-of check against the token's `perms` -> 403 naming the keys

The permission check reads the token, not the database: the token was minted from the user's
groups, and `token_version` guarantees it still reflects them (a change bumps the version and
this dependency refuses the old token, so the client's transparent refresh mints a current one).

Claims are read strictly: a token is signed, but nothing stops a claim inside it being the wrong
shape (a hand-built token, a future bug in the issuer). A malformed claim must fail closed — 401
or 403, never a 500, and never be coerced into meaning something it didn't say.
"""
from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

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


def _strings(value: object) -> tuple[str, ...]:
    """The string items of `value` if it is a list, else `()`. A malformed `groups`/`perms`
    claim (wrong type, or a list with junk in it) degrades to "no groups/perms" rather than
    raising or being read loosely."""
    if isinstance(value, list):
        return tuple(v for v in value if isinstance(v, str))
    return ()


def access_claims(token: str) -> dict[str, Any]:
    """Decode an ACCESS token or raise 401. A refresh token (same secret) is refused by `type`."""
    try:
        claims = decode_token(token)
    except JWTError:
        raise _unauthorized() from None
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
        raise _unauthorized() from None
    user = await get_user_by_id(db, user_id)
    if user is None or not user.is_active:
        raise _unauthorized()
    tv = claims.get("tv")
    if type(tv) is not int or tv != user.token_version:
        # The user's rights changed after this token was minted, or the claim is malformed or
        # missing (a token from before `tv` existed carries no `perms` either).
        # The client refreshes and gets a token built from the current groups; nothing is lost
        # but one round trip.
        raise _unauthorized("token_version")
    tenant = claims.get("tenant")
    return Principal(
        user=user,
        tenant=tenant if isinstance(tenant, str) else None,
        groups=_strings(claims.get("groups")),
        perms=frozenset(_strings(claims.get("perms"))),
        mfa_required=claims.get("mfa_required") is True,
        mfa_verified=claims.get("mfa_verified") is True,
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


async def get_user_for_enrolment(principal: Principal = Depends(get_principal_pre_mfa)) -> User:
    """/auth/totp/setup. A user WITHOUT an authenticator may enrol from a pending-MFA session (that
    is how first sign-in works). A user who already has one may replace it only from an
    MFA-verified session; otherwise the password alone would let anyone swap the authenticator
    and pass the gate. Lost device: an administrator resets MFA."""
    if principal.user.totp_enabled and not principal.mfa_verified:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="mfa_reset_required")
    return principal.user


# Existing routers import this name; it is the MFA-gated user, exactly as before.
get_current_active_user = get_current_user


def require_permission(*keys: str) -> Callable[..., Awaitable[User]]:
    """Dependency factory: the caller must hold ANY of `keys`. Unknown keys fail here, at
    import time, so a typo in a route guard stops the service from starting."""
    if not keys:
        raise ValueError("require_permission needs at least one key")
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
# TEMPORARY SHIM — deleted in Task 7 together with UserRole. Routers still import it, and from
# THIS commit it refuses every role-guarded route (tokens no longer carry a `roles` claim): no
# build of this branch is deployable until Task 7 moves each router to require_permission.
# --------------------------------------------------------------------------------------------
def require_roles(*roles):
    async def _check(principal: Principal = Depends(get_principal)) -> User:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="role guards are being replaced by permissions")
    return _check

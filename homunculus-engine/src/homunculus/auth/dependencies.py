"""
FastAPI dependencies for authentication and authorisation.

    get_principal_pre_mfa   decode the access token, load the user, check is_active and the
                            token version -> Principal (401 on any failure)
    get_principal_pre_password  + the MFA gate: 403 `mfa_required` while a TOTP step is pending —
                            ONLY for POST /auth/password
    get_principal           + the password gate: 403 `password_change_required` while the account
                            holds a temporary password (users.must_change_password, local only)
    get_current_user        the User behind get_principal
    get_current_user_pre_mfa the User behind get_principal_pre_mfa — ONLY for /auth/me
                            (/auth/totp/verify takes get_principal_pre_mfa itself, for the tenant)
    get_user_for_enrolment  the User behind get_principal_pre_mfa, but an already-enrolled user
                            may only pass it once MFA is verified — see its docstring
    require_permission(*k)  any-of check against the token's `perms` -> 403 naming the keys
    caller_tenant_id        the id of the tenant the token's `tenant` claim names, checked against
                            an active membership in an active tenant -> 401 / 403 otherwise
    require_platform_operator  an MFA-VERIFIED principal of a `users.is_platform_support` account

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

from homunculus.auth.groups import TENANT_UNKNOWN, resolve_tenant_claim
from homunculus.auth.jwt import decode_token
from homunculus.auth.models import User
from homunculus.auth.permissions import validate_permissions
from homunculus.auth.service import get_user_by_id, password_change_due
from homunculus.db import get_db

_bearer = HTTPBearer(auto_error=False)

NO_TENANT = "Hesabınıza kurum tanımlanmamış"
MEMBERSHIP_INACTIVE = "Bu kurumdaki üyeliğiniz etkin değil"
PLATFORM_ONLY = "Platform operatörü yetkisi gerekli"
# A temporary password an administrator gave the account must be replaced first (POST /auth/password).
PASSWORD_CHANGE_REQUIRED = "password_change_required"


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
        # A blank slug names no tenant (403 NO_TENANT), exactly as on the board resolver.
        tenant=tenant if isinstance(tenant, str) and tenant.strip() else None,
        groups=_strings(claims.get("groups")),
        perms=frozenset(_strings(claims.get("perms"))),
        mfa_required=claims.get("mfa_required") is True,
        mfa_verified=claims.get("mfa_verified") is True,
    )


async def get_principal_pre_password(
    principal: Principal = Depends(get_principal_pre_mfa),
) -> Principal:
    """The MFA gate. POST /auth/password alone stops here: a session whose account must replace
    its temporary password reaches the change and nothing else. MFA comes first, so a password
    reset by an administrator never lets the temporary password alone choose the next one for an
    account that has an authenticator."""
    if principal.mfa_required and not principal.mfa_verified:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="mfa_required")
    return principal


async def get_principal(principal: Principal = Depends(get_principal_pre_password)) -> Principal:
    """Every route's principal: MFA done, and no temporary password left to replace. The flag is
    read from the user row get_principal_pre_mfa loaded anyway, so it takes effect at once — no
    token claim to go stale, no extra query."""
    if password_change_due(principal.user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=PASSWORD_CHANGE_REQUIRED)
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


def require_permission(*keys: str) -> Callable[..., Awaitable[User]]:
    """Dependency factory: the caller must hold ANY of `keys`. Unknown keys fail here, at
    import time, so a typo in a route guard stops the service from starting.

    The returned dependency carries the keys as `.permissions` (a frozenset): tests read it to
    map routes to keys."""
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

    _check.permissions = wanted  # type: ignore[attr-defined]
    return _check


async def caller_tenant_id(
    principal: Principal = Depends(get_principal),
    db: AsyncSession = Depends(get_db),
) -> uuid.UUID:
    """The tenant the caller acts in: the one the token's `tenant` claim names. A permission is
    held in that tenant only, so every admission, escalation and structure route takes this next
    to its permission guard and acts on that tenant's objects alone.

    The claim is not trusted by name alone (spec §5): one query (`resolve_tenant_claim`) confirms
    that the slug's tenant exists and is active and that the caller holds an active membership
    in it — so this also establishes the CALLER's own membership for the route. A slug unknown
    to the caller (renamed, perhaps reused by another tenant) is 401, so the client refreshes
    and gets its current slug; a deactivated tenant or membership is 403. `get_principal` is
    cached per request, so the token is decoded once."""
    if principal.tenant is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=NO_TENANT)
    tenant_id, verdict = await resolve_tenant_claim(db, principal.user.id, principal.tenant)
    if verdict == TENANT_UNKNOWN:
        raise _unauthorized("tenant")
    if tenant_id is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=MEMBERSHIP_INACTIVE)
    return tenant_id


async def require_platform_operator(principal: Principal = Depends(get_principal)) -> User:
    """A vendor-side platform operator (`users.is_platform_support`, set in SQL; no group grants
    it). Creating a tenant is theirs alone: a tenant a hospital administrator created would have no
    members and could not be administered through `/admin`, which works inside the caller's own
    tenant only.

    The operator is ALWAYS MFA-verified, whatever their groups say: `get_principal` gates only
    on the token's `mfa_required`, which a token minted before the flag was set would not carry
    (sign-in sets it for every operator, see `auth.service.build_context`).

    Carries `.platform_only = True` so the route map test can tell this guard from a missing one."""
    if not principal.user.is_platform_support:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=PLATFORM_ONLY)
    if not principal.mfa_verified:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="mfa_required")
    return principal.user


require_platform_operator.platform_only = True  # type: ignore[attr-defined]

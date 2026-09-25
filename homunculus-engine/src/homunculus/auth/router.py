"""
Auth API routes.
POST /auth/login        — username or e-mail + password; returns tokens (requires_mfa when a
                          TOTP step is still pending, mfa_enrolled when the user has one)
POST /auth/totp/setup   — generate TOTP secret + QR provisioning URI (allowed before MFA)
POST /auth/totp/verify  — verify 6-digit code; re-issues tokens with mfa_verified=True
POST /auth/refresh      — exchange refresh token for new tokens built from the CURRENT groups
GET  /auth/me           — profile, tenant, groups, permissions (allowed before MFA)
POST /auth/password     — change own password (local accounts)

Every sign-in, MFA and password event goes to the audit trail (never a password or a code).
"""
from __future__ import annotations
import hmac
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.auth.audit import append_audit
from homunculus.auth.dependencies import (
    Principal, get_current_user_pre_mfa, get_principal, get_principal_pre_mfa,
    get_user_for_enrolment,
)
from homunculus.auth.groups import tenant_of_user
from homunculus.auth.jwt import decode_token
from homunculus.auth.limits import totp_failures
from homunculus.auth.models import AUTH_LDAP, User
from homunculus.auth.schemas import (
    GroupBrief, LoginRequest, PasswordChangeRequest, RefreshRequest, TOTPSetupResponse,
    TOTPVerifyRequest, TokenResponse, UserMeResponse,
)
from homunculus.auth.service import (
    PasswordError, build_context, change_password, credential_fingerprint, enable_totp,
    find_user_by_login, get_user_by_id, issue_tokens, mark_login, normalize_login, run_bcrypt,
    setup_totp, verify_local_password,
)
from homunculus.auth.totp import accepted_step
from homunculus.db import get_db

router = APIRouter(prefix="/auth", tags=["auth"])

# The last TOTP time step accepted per user: a code at or before it is refused, so a code that
# was seen once (over a shoulder, in a proxy log) cannot be used again. In memory, like the
# attempt limit in `auth/limits.py` — the engine is a single process.
_last_step: dict[uuid.UUID, int] = {}

_TOTP_LOCKED = "Çok fazla hatalı kod. 5 dakika sonra tekrar deneyin."
_TOTP_REPLAYED = "Bu kod zaten kullanıldı; yeni kodu bekleyin."
_NO_USER = uuid.UUID(int=0)


async def _login_failed(request: Request, db: AsyncSession, user: User | None, key: str,
                        reason: str) -> None:
    """Audit a failed sign-in. A known account's failure is filed under its hospital, so the
    hospital's own (tenant-scoped) audit shows attempts on its accounts; an unknown login has
    no hospital and is filed under "-".

    The tenant lookup runs for an unknown login too (with the nil UUID, which matches nothing):
    a failure then costs the same queries whether or not the account exists."""
    ref = await tenant_of_user(db, user.id if user is not None else _NO_USER)
    append_audit(request, tenant=ref.slug if ref is not None else None, event_type="auth",
                 subject="login.fail", payload={"login": key, "reason": reason})


@router.post("/login", response_model=TokenResponse, summary="Sign in with username or e-mail")
async def login(body: LoginRequest, request: Request,
                db: AsyncSession = Depends(get_db)) -> TokenResponse:
    key = normalize_login(body.identifier)
    user = await find_user_by_login(db, key)

    if user is not None and user.auth_source == AUTH_LDAP:
        # Plan 2 wires the directory in here. Until then an AD account cannot sign in, and the
        # reason is the directory — a 503 the clinician should report, never a 401.
        await _login_failed(request, db, user, key, "directory_unavailable")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail="Dizin sunucusuna ulaşılamıyor")

    # bcrypt is ~0.2 s of CPU: off the event loop, or every sign-in stalls ingest and SSE. The
    # account's fields are read here, on the loop; the worker thread gets plain values.
    source = user.auth_source if user is not None else None
    hashed = user.hashed_password if user is not None else None
    if not await run_bcrypt(verify_local_password, source, hashed, body.password):
        await _login_failed(request, db, user, key, "bad_credentials")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not user.is_active:
        await _login_failed(request, db, user, key, "inactive")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    ctx = await build_context(db, user)
    mark_login(user)
    await db.commit()
    tokens = issue_tokens(user, ctx, mfa_verified=False)
    append_audit(request, tenant=ctx.tenant, event_type="auth", subject="login.ok",
                 payload={"login": key, "user": user.username, "source": user.auth_source,
                          "mfa_pending": tokens["requires_mfa"]})
    return TokenResponse(**tokens)


@router.post("/totp/setup", response_model=TOTPSetupResponse, summary="Setup TOTP authenticator")
async def totp_setup(
    request: Request,
    current_user: User = Depends(get_user_for_enrolment),
    principal: Principal = Depends(get_principal_pre_mfa),   # same cached instance; for the tenant
    db: AsyncSession = Depends(get_db),
) -> TOTPSetupResponse:
    replace = bool(current_user.totp_enabled)
    _secret, uri = await setup_totp(db, current_user)
    # A new secret starts a new code sequence; steps accepted under the old one say nothing
    # about it (and would hold a replacement's first code back until the next step).
    _last_step.pop(current_user.id, None)
    append_audit(request, tenant=principal.tenant, event_type="auth", subject="mfa.enrol",
                 payload={"user": current_user.username, "replace": replace})
    return TOTPSetupResponse(provisioning_uri=uri)


@router.post("/totp/verify", response_model=TokenResponse,
             summary="Verify TOTP and get MFA-verified tokens")
async def totp_verify(
    body: TOTPVerifyRequest,
    request: Request,
    principal: Principal = Depends(get_principal_pre_mfa),
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    user = principal.user
    if not user.totp_secret:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="TOTP not set up")

    def audit(subject: str, **payload) -> None:
        append_audit(request, tenant=principal.tenant, event_type="auth", subject=subject,
                     payload={"user": user.username, **payload})

    key = str(user.id)
    if totp_failures.locked(key):
        # No audit row per refusal: the lock was recorded once, as `mfa.locked`, when it engaged.
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=_TOTP_LOCKED)

    # The code is checked exactly once, here, for a first enrolment and a routine sign-in alike.
    # No await between the check and recording the step: two concurrent requests carrying the
    # same code cannot both pass.
    step = accepted_step(user.totp_secret, body.code)
    if step is None:
        audit("mfa.fail", reason="bad_code")
        if totp_failures.failed(key):
            audit("mfa.locked", lock_seconds=totp_failures.lock_seconds)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid TOTP code")
    if step <= _last_step.get(user.id, -1):
        # A genuine code, already used — the clinician re-typed it, or someone replayed it. Not a
        # guess (it had to be right), so it does not count toward the lock; it is refused and
        # recorded all the same.
        audit("mfa.fail", reason="replayed_code")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_TOTP_REPLAYED)
    _last_step[user.id] = step
    totp_failures.succeeded(key)

    first = not user.totp_enabled
    if first:
        await enable_totp(db, user)
    audit("mfa.ok", first_enrolment=first)
    ctx = await build_context(db, user)
    return TokenResponse(**issue_tokens(user, ctx, mfa_verified=True))


@router.post("/refresh", response_model=TokenResponse,
             summary="Exchange refresh token for tokens built from the current groups")
async def refresh_token(body: RefreshRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token"
    )
    try:
        payload = decode_token(body.refresh_token)
        if payload.get("type") != "refresh":
            raise credentials_exc
        user_id = uuid.UUID(payload["sub"])
    except (JWTError, ValueError, KeyError):
        raise credentials_exc

    user = await get_user_by_id(db, user_id)
    if not user or not user.is_active:
        raise credentials_exc
    revoked = user.sessions_revoked_at
    iat = payload.get("iat")
    if revoked is not None and (type(iat) is not int or iat <= revoked.timestamp()):
        # Issued before the account's last deactivation: reactivating it must not revive the
        # sessions it had ("phone stolen, deactivate, reactivate tomorrow").
        raise credentials_exc
    cv = payload.get("cv")
    # Compared as bytes: `compare_digest` raises TypeError on a non-ASCII str, which a claim
    # can hold — that must be a 401, not a 500.
    if not isinstance(cv, str) or not hmac.compare_digest(
            cv.encode(), credential_fingerprint(user).encode()):
        # The password or the authenticator changed since this session opened: sign in again.
        raise credentials_exc

    ctx = await build_context(db, user)
    # Verified only if the refresh token says so AND an authenticator still exists (an MFA reset
    # must send the user back through enrolment, not keep a stale "verified").
    verified = payload.get("mfa_verified") is True and user.totp_enabled
    return TokenResponse(**issue_tokens(user, ctx, mfa_verified=verified))


@router.get("/me", response_model=UserMeResponse, summary="Current user profile")
async def me(current_user: User = Depends(get_current_user_pre_mfa),
             db: AsyncSession = Depends(get_db)) -> UserMeResponse:
    ctx = await build_context(db, current_user)
    return UserMeResponse(
        id=current_user.id, username=current_user.username, email=current_user.email,
        full_name=current_user.full_name, auth_source=current_user.auth_source,
        totp_enabled=current_user.totp_enabled, is_active=current_user.is_active,
        created_at=current_user.created_at, tenant=ctx.tenant,
        groups=[GroupBrief(slug=s, name=n) for s, n in zip(ctx.groups, ctx.group_names)],
        perms=sorted(ctx.perms),
    )


@router.post("/password", response_model=TokenResponse,
             summary="Change own password (local accounts); returns fresh tokens")
async def password(body: PasswordChangeRequest, request: Request,
                   principal: Principal = Depends(get_principal),
                   db: AsyncSession = Depends(get_db)) -> TokenResponse:
    """The change retires every existing session (token version and credential fingerprint
    both move), so the caller receives a fresh pair and keeps working."""
    current_user = principal.user
    try:
        await change_password(db, current_user, body.current_password, body.new_password)
    except PasswordError as exc:
        append_audit(request, tenant=principal.tenant, event_type="auth",
                     subject="password.change.fail",
                     payload={"user": current_user.username, "reason": exc.reason})
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    append_audit(request, tenant=principal.tenant, event_type="auth", subject="password.change",
                 payload={"user": current_user.username})
    ctx = await build_context(db, current_user)
    verified = principal.mfa_verified and current_user.totp_enabled
    return TokenResponse(**issue_tokens(current_user, ctx, mfa_verified=verified))

"""
Auth API routes.
POST /auth/login        — username or e-mail + password; returns tokens (requires_mfa when a
                          TOTP step is still pending, mfa_enrolled when the user has one)
POST /auth/totp/setup   — generate TOTP secret + QR provisioning URI (allowed before MFA)
POST /auth/totp/verify  — verify 6-digit code; re-issues tokens with mfa_verified=True
POST /auth/refresh      — exchange refresh token for new tokens built from the CURRENT groups
GET  /auth/me           — profile, tenant, groups, permissions (allowed before MFA)
POST /auth/password     — change own password (local accounts)
"""
from __future__ import annotations
import hmac
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.auth.audit import append_audit
from homunculus.auth.dependencies import (
    Principal, get_current_user_pre_mfa, get_principal, get_user_for_enrolment,
)
from homunculus.auth.jwt import decode_token
from homunculus.auth.models import AUTH_LDAP, User
from homunculus.auth.schemas import (
    GroupBrief, LoginRequest, PasswordChangeRequest, RefreshRequest, TOTPSetupResponse,
    TOTPVerifyRequest, TokenResponse, UserMeResponse,
)
from homunculus.auth.service import (
    PasswordError, build_context, change_password, credential_fingerprint, enable_totp,
    find_user_by_login, get_user_by_id, issue_tokens, mark_login, normalize_login, setup_totp,
    verify_local_password,
)
from homunculus.auth.totp import verify_totp
from homunculus.db import get_db

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse, summary="Sign in with username or e-mail")
async def login(body: LoginRequest, request: Request,
                db: AsyncSession = Depends(get_db)) -> TokenResponse:
    key = normalize_login(body.identifier)
    user = await find_user_by_login(db, key)

    if user is not None and user.auth_source == AUTH_LDAP:
        # Plan 2 wires the directory in here. Until then an AD account cannot sign in, and the
        # reason is the directory — a 503 the clinician should report, never a 401.
        append_audit(request, tenant=None, event_type="auth", subject="login.fail",
                     payload={"login": key, "reason": "directory_unavailable"})
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail="Dizin sunucusuna ulaşılamıyor")

    if not verify_local_password(user, body.password):
        append_audit(request, tenant=None, event_type="auth", subject="login.fail",
                     payload={"login": key, "reason": "bad_credentials"})
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not user.is_active:
        append_audit(request, tenant=None, event_type="auth", subject="login.fail",
                     payload={"login": key, "reason": "inactive"})
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    ctx = await build_context(db, user)
    mark_login(user)
    await db.commit()
    append_audit(request, tenant=ctx.tenant, event_type="auth", subject="login.ok",
                 payload={"login": key, "user": user.username, "source": user.auth_source})
    return TokenResponse(**issue_tokens(user, ctx, mfa_verified=False))


@router.post("/totp/setup", response_model=TOTPSetupResponse, summary="Setup TOTP authenticator")
async def totp_setup(
    current_user: User = Depends(get_user_for_enrolment),
    db: AsyncSession = Depends(get_db),
) -> TOTPSetupResponse:
    _secret, uri = await setup_totp(db, current_user)
    return TOTPSetupResponse(provisioning_uri=uri)


@router.post("/totp/verify", response_model=TokenResponse,
             summary="Verify TOTP and get MFA-verified tokens")
async def totp_verify(
    body: TOTPVerifyRequest,
    current_user: User = Depends(get_current_user_pre_mfa),
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    if not current_user.totp_secret:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="TOTP not set up")

    if not current_user.totp_enabled:
        # First-time activation.
        if not await enable_totp(db, current_user, body.code):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid TOTP code")
    elif not verify_totp(current_user.totp_secret, body.code):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid TOTP code")

    ctx = await build_context(db, current_user)
    return TokenResponse(**issue_tokens(current_user, ctx, mfa_verified=True))


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
    if not hmac.compare_digest(str(payload.get("cv", "")), credential_fingerprint(user)):
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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    append_audit(request, tenant=principal.tenant, event_type="auth", subject="password.change",
                 payload={"user": current_user.username})
    ctx = await build_context(db, current_user)
    return TokenResponse(**issue_tokens(current_user, ctx, mfa_verified=principal.mfa_verified))

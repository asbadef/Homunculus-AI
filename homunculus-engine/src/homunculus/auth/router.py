"""
Auth API routes.
POST /auth/login        — password auth; returns tokens (mfa_required flag if TOTP enabled)
POST /auth/totp/setup   — generate TOTP secret + QR provisioning URI
POST /auth/totp/verify  — verify 6-digit code; re-issues tokens with mfa_verified=True
POST /auth/refresh      — exchange refresh token for new access token
GET  /auth/me           — return current user profile
"""
from __future__ import annotations
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.auth.dependencies import get_current_active_user
from homunculus.auth.jwt import decode_token
from homunculus.auth.models import User
from homunculus.auth.schemas import (
    LoginRequest, RefreshRequest, TOTPSetupResponse,
    TOTPVerifyRequest, TokenResponse, UserMeResponse,
)
from homunculus.auth.service import (
    authenticate_user, enable_totp, get_user_by_id,
    get_user_memberships, issue_mfa_verified_tokens, issue_tokens, setup_totp,
)
from homunculus.db import get_db

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse, summary="Password login")
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    user = await authenticate_user(db, body.email, body.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    memberships = await get_user_memberships(db, user.id)
    tokens = issue_tokens(user, memberships)
    return TokenResponse(**tokens)


@router.post("/totp/setup", response_model=TOTPSetupResponse, summary="Setup TOTP authenticator")
async def totp_setup(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> TOTPSetupResponse:
    _secret, uri = await setup_totp(db, current_user)
    return TOTPSetupResponse(provisioning_uri=uri)


@router.post("/totp/verify", response_model=TokenResponse, summary="Verify TOTP and get MFA-verified tokens")
async def totp_verify(
    body: TOTPVerifyRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    if not current_user.totp_secret:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="TOTP not set up")

    # If not yet enabled, this is the first-time activation
    if not current_user.totp_enabled:
        ok = await enable_totp(db, current_user, body.code)
        if not ok:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid TOTP code")
    else:
        from homunculus.auth.totp import verify_totp
        if not verify_totp(current_user.totp_secret, body.code):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid TOTP code")

    memberships = await get_user_memberships(db, current_user.id)
    tokens = issue_mfa_verified_tokens(current_user, memberships)
    return TokenResponse(**tokens)


@router.post("/refresh", response_model=TokenResponse, summary="Exchange refresh token for new access token")
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

    memberships = await get_user_memberships(db, user.id)
    tokens = issue_tokens(user, memberships)
    return TokenResponse(**tokens)


@router.get("/me", response_model=UserMeResponse, summary="Current user profile")
async def me(current_user: User = Depends(get_current_active_user)) -> UserMeResponse:
    return UserMeResponse.model_validate(current_user)

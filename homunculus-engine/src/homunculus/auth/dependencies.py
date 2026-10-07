"""
FastAPI dependency injection for authentication.
Provides get_current_user and role-checking dependencies.
"""
from __future__ import annotations
import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from homunculus.auth.jwt import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.auth.jwt import decode_token
from homunculus.auth.models import User, UserRole
from homunculus.auth.service import get_user_by_id, user_needs_mfa
from homunculus.db import get_db

_bearer = HTTPBearer(auto_error=False)


async def get_password_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Valid access token -> User, WITHOUT the MFA gate.

    Only for the MFA endpoints themselves (/auth/totp/*), which a password-only token must reach.
    Everything else goes through get_current_user.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or missing authentication credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not credentials:
        raise credentials_exception
    try:
        payload = decode_token(credentials.credentials)
        user_id_str: str | None = payload.get("sub")
        token_type: str | None = payload.get("type")
        if not user_id_str or token_type != "access":
            raise credentials_exception
        user_id = uuid.UUID(user_id_str)
    except (JWTError, ValueError):
        raise credentials_exception

    user = await get_user_by_id(db, user_id)
    if not user or not user.is_active:
        raise credentials_exception
    user._mfa_verified = payload.get("mfa_verified") is True  # request-scoped, not persisted
    return user


async def get_current_user(
    user: User = Depends(get_password_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Valid access token AND, for MFA roles / enrolled users, a completed TOTP step (Y1)."""
    if not user._mfa_verified and await user_needs_mfa(db, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="MFA required: complete the TOTP step (/auth/totp/verify) first.",
        )
    return user


async def get_current_active_user(
    current_user: User = Depends(get_current_user),
) -> User:
    if not current_user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Inactive user")
    return current_user


def require_roles(*roles: UserRole):
    """Dependency factory: COARSE gate — the user holds one of the roles in SOME hospital.

    This alone is not authorisation for a record: callers must also check the role in the hospital
    that owns the record (homunculus.auth.access.ensure_role_in_tenant). K2.
    """
    async def _check(
        credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
        db: AsyncSession = Depends(get_db),
    ) -> User:
        user = await get_current_user(await get_password_user(credentials, db), db)
        try:
            payload = decode_token(credentials.credentials)
            user_roles: dict = payload.get("roles", {})
        except JWTError:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

        # Coarse check only: any hospital. The per-record hospital check is done by the caller.
        user_role_values = set(user_roles.values())
        required_role_values = {r.value for r in roles}
        if not user_role_values.intersection(required_role_values):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Required role(s): {required_role_values}",
            )
        return user
    return _check

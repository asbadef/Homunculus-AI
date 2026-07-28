"""
FastAPI dependency injection for authentication.
Provides get_current_user and role-checking dependencies.
"""
from __future__ import annotations
import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.auth.jwt import decode_token
from homunculus.auth.models import User, UserRole
from homunculus.auth.service import get_user_by_id
from homunculus.db import get_db

_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Extract and validate JWT; return the User object."""
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
    except JWTError:
        raise credentials_exception

    user = await get_user_by_id(db, uuid.UUID(user_id_str))
    if not user or not user.is_active:
        raise credentials_exception
    return user


async def get_current_active_user(
    current_user: User = Depends(get_current_user),
) -> User:
    if not current_user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Inactive user")
    return current_user


def require_roles(*roles: UserRole):
    """Dependency factory: enforce that the current user holds one of the given roles in the request's tenant context."""
    async def _check(
        credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
        db: AsyncSession = Depends(get_db),
    ) -> User:
        user = await get_current_user(credentials, db)
        try:
            payload = decode_token(credentials.credentials)
            user_roles: dict = payload.get("roles", {})
        except JWTError:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

        # Check if user holds any of the required roles in ANY tenant
        user_role_values = set(user_roles.values())
        required_role_values = {r.value for r in roles}
        if not user_role_values.intersection(required_role_values):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Required role(s): {required_role_values}",
            )
        return user
    return _check

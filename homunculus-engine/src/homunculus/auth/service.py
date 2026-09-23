"""
Authentication business logic.
Password hashing, token generation, MFA setup.
"""
from __future__ import annotations
import uuid

import bcrypt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.auth.jwt import create_access_token, create_refresh_token
from homunculus.auth.models import MFA_REQUIRED_ROLES, TenantMembership, User, UserRole
from homunculus.auth.totp import generate_provisioning_uri, generate_totp_secret, verify_totp

# bcrypt is used directly: passlib has been unmaintained since 2020 and is incompatible with
# bcrypt >= 4.1 (it raised "password cannot be longer than 72 bytes" for every password, which
# made user creation and login impossible).
_BCRYPT_MAX_BYTES = 72


def _secret(plain: str) -> bytes:
    """Encode for bcrypt, which hashes at most 72 bytes. Longer secrets are truncated — bcrypt's
    own long-standing behaviour, made explicit here instead of left to the driver to reject."""
    return plain.encode("utf-8")[:_BCRYPT_MAX_BYTES]


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(_secret(plain), bcrypt.gensalt()).decode("ascii")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_secret(plain), hashed.encode("ascii"))
    except (ValueError, TypeError):
        return False   # malformed stored hash must fail the login, not crash it


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


async def get_user_by_id(db: AsyncSession, user_id: uuid.UUID) -> User | None:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def authenticate_user(db: AsyncSession, email: str, password: str) -> User | None:
    user = await get_user_by_email(db, email)
    if not user or not user.is_active:
        return None
    if not verify_password(password, user.hashed_password):
        return None
    return user


async def get_user_memberships(
    db: AsyncSession, user_id: uuid.UUID
) -> list[TenantMembership]:
    result = await db.execute(
        select(TenantMembership).where(
            TenantMembership.user_id == user_id,
            TenantMembership.is_active == True,  # noqa: E712
        )
    )
    return list(result.scalars().all())


def requires_mfa(role: UserRole) -> bool:
    return role in MFA_REQUIRED_ROLES


async def setup_totp(db: AsyncSession, user: User) -> tuple[str, str]:
    """
    Generate and store a new TOTP secret for the user.
    Returns (secret, provisioning_uri).
    NOTE: Secret is stored in plaintext here for MVP; in production encrypt with Fernet.
    """
    secret = generate_totp_secret()
    user.totp_secret = secret
    user.totp_enabled = False  # Only enabled after first successful verify
    await db.commit()
    uri = generate_provisioning_uri(secret, user.email)
    return secret, uri


async def enable_totp(db: AsyncSession, user: User, code: str) -> bool:
    """Verify a TOTP code and mark TOTP as enabled."""
    if not user.totp_secret:
        return False
    if not verify_totp(user.totp_secret, code):
        return False
    user.totp_enabled = True
    await db.commit()
    return True


def issue_tokens(user: User, memberships: list[TenantMembership]) -> dict:
    """
    Issue access + refresh tokens.
    Access token carries: user_id, roles per tenant, mfa_verified flag.
    """
    tenant_roles = {
        str(m.tenant_id): m.role for m in memberships if m.role
    }
    access = create_access_token(
        subject=str(user.id),
        extra={"roles": tenant_roles, "mfa_verified": False},
    )
    refresh = create_refresh_token(subject=str(user.id))
    return {
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "bearer",
        "requires_mfa": user.totp_enabled,
    }


def issue_mfa_verified_tokens(user: User, memberships: list[TenantMembership]) -> dict:
    """Issue tokens after successful TOTP verification."""
    tenant_roles = {str(m.tenant_id): m.role for m in memberships if m.role}
    access = create_access_token(
        subject=str(user.id),
        extra={"roles": tenant_roles, "mfa_verified": True},
    )
    refresh = create_refresh_token(subject=str(user.id))
    return {
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "bearer",
        "requires_mfa": False,
    }

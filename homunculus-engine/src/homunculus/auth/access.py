"""
Hospital (tenant) scoped authorisation helpers.

Roles are held PER HOSPITAL (TenantMembership). A check therefore always names the hospital of
the record being touched; holding a role somewhere else grants nothing here. Memberships are read
from the database on every call, so a revoked membership takes effect immediately instead of when
the access token expires.

Records of a hospital the caller does not belong to answer 404 (not 403): existence is not leaked.
"""
from __future__ import annotations

import uuid

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.auth.models import User, UserRole
from homunculus.auth.service import get_user_memberships

# Roles that act on live clinical records (alerts, break-glass, patient identity).
CLINICAL_ROLES = frozenset({
    UserRole.ATTENDING, UserRole.ASSOCIATE_PHYSICIAN, UserRole.ONCALL_PHYSICIAN,
    UserRole.UNIT_PHYSICIAN, UserRole.CHARGE_NURSE, UserRole.NURSE, UserRole.RAPID_RESPONSE,
})


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")


async def roles_by_tenant(db: AsyncSession, user: User) -> dict[uuid.UUID, set[UserRole]]:
    roles: dict[uuid.UUID, set[UserRole]] = {}
    for m in await get_user_memberships(db, user.id):
        roles.setdefault(m.tenant_id, set()).add(m.role)
    return roles


async def member_tenant_ids(db: AsyncSession, user: User) -> set[uuid.UUID]:
    return set(await roles_by_tenant(db, user))


async def roles_in_tenant(db: AsyncSession, user: User, tenant_id: uuid.UUID) -> set[UserRole]:
    return (await roles_by_tenant(db, user)).get(tenant_id, set())


async def ensure_member(db: AsyncSession, user: User, tenant_id: uuid.UUID) -> set[UserRole]:
    """Caller must belong to `tenant_id`; otherwise 404. Returns the caller's roles there."""
    roles = await roles_in_tenant(db, user, tenant_id)
    if not roles:
        raise _not_found()
    return roles


async def ensure_role_in_tenant(
    db: AsyncSession, user: User, tenant_id: uuid.UUID, *allowed: UserRole,
) -> set[UserRole]:
    """Caller must hold one of `allowed` IN `tenant_id`; otherwise 403."""
    roles = await roles_in_tenant(db, user, tenant_id)
    if not roles.intersection(allowed):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Required role(s) in this hospital: {sorted(r.value for r in allowed)}",
        )
    return roles

"""
Action-level permission resolution and grant helpers.

Resolution (action_allowed): within a tenant, over active grants for the action —
user-DENY > user-ALLOW > role-ALLOW; no match => False (fail-closed). Roles come from
auth.access.roles_in_tenant, so the hospital boundary is enforced here.
"""
from __future__ import annotations
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.auth import access
from homunculus.auth.models import User, UserRole
from homunculus.permissions.models import PermissionEffect, PermissionGrant


async def action_allowed(db: AsyncSession, user: User, tenant_id: uuid.UUID, action: str) -> bool:
    roles = await access.roles_in_tenant(db, user, tenant_id)
    result = await db.execute(
        select(PermissionGrant).where(
            PermissionGrant.tenant_id == tenant_id,
            PermissionGrant.action == action,
            PermissionGrant.is_active.is_(True),
        )
    )
    grants = result.scalars().all()
    user_allow = False
    role_allow = False
    for g in grants:
        if g.user_id == user.id:
            if g.effect == PermissionEffect.DENY.value:
                return False  # kullanıcı DENY her şeyi ezer
            if g.effect == PermissionEffect.ALLOW.value:
                user_allow = True
        elif g.role is not None and g.role in roles and g.effect == PermissionEffect.ALLOW.value:
            role_allow = True
    return bool(user_allow or role_allow)


async def grant_role_permission(db: AsyncSession, *, tenant_id: uuid.UUID, role: UserRole,
                                action: str, granted_by: User) -> PermissionGrant:
    grant = PermissionGrant(
        tenant_id=tenant_id, role=role, action=action,
        effect=PermissionEffect.ALLOW.value, granted_by_id=granted_by.id,
    )
    db.add(grant)
    await db.flush()
    return grant


async def grant_user_permission(db: AsyncSession, *, tenant_id: uuid.UUID, user_id: uuid.UUID,
                                action: str, effect: PermissionEffect, granted_by: User) -> PermissionGrant:
    grant = PermissionGrant(
        tenant_id=tenant_id, user_id=user_id, action=action,
        effect=effect.value, granted_by_id=granted_by.id,
    )
    db.add(grant)
    await db.flush()
    return grant

"""
Permission admin API — a HOSPITAL_ADMIN grants/revokes/lists permissions for their hospital.

K2: the admin of hospital A can only manage hospital A's permissions; being an admin
elsewhere grants nothing (the tenant is the one in the URL). Managing permissions is
gated by the HOSPITAL_ADMIN role itself, never by the permission table (no bootstrap loop).

PHI RULE: authorization config only — no patient data.
"""
from __future__ import annotations
import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.auth.access import ensure_role_in_tenant
from homunculus.auth.dependencies import require_roles
from homunculus.auth.models import User, UserRole
from homunculus.db import get_db
from homunculus.permissions import service
from homunculus.permissions.schemas import PermissionGrantOut, RoleGrantIn, UserGrantIn

router = APIRouter(prefix="/tenant/tenants/{tenant_id}/permissions", tags=["permissions"])


async def _perm_admin(
    tenant_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(UserRole.HOSPITAL_ADMIN)),
) -> User:
    # Bu hastanede HOSPITAL_ADMIN olmak şart; başka hastanede admin olmak saymaz.
    await ensure_role_in_tenant(db, user, tenant_id, UserRole.HOSPITAL_ADMIN)
    return user


@router.get("", response_model=list[PermissionGrantOut], summary="İzinleri listele")
async def list_grants(tenant_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                      _admin: User = Depends(_perm_admin)) -> list[PermissionGrantOut]:
    grants = await service.list_permissions(db, tenant_id)
    return [PermissionGrantOut.model_validate(g) for g in grants]


@router.post("/roles", response_model=PermissionGrantOut, status_code=status.HTTP_201_CREATED,
             summary="Role izin ver")
async def grant_role(tenant_id: uuid.UUID, body: RoleGrantIn, db: AsyncSession = Depends(get_db),
                     admin: User = Depends(_perm_admin)) -> PermissionGrantOut:
    grant = await service.grant_role_permission(
        db, tenant_id=tenant_id, role=body.role, action=body.action, granted_by=admin)
    await db.commit()
    await db.refresh(grant)
    return PermissionGrantOut.model_validate(grant)


@router.post("/users", response_model=PermissionGrantOut, status_code=status.HTTP_201_CREATED,
             summary="Kullanıcıya izin/istisna ver")
async def grant_user(tenant_id: uuid.UUID, body: UserGrantIn, db: AsyncSession = Depends(get_db),
                     admin: User = Depends(_perm_admin)) -> PermissionGrantOut:
    grant = await service.grant_user_permission(
        db, tenant_id=tenant_id, user_id=body.user_id, action=body.action,
        effect=body.effect, granted_by=admin)
    await db.commit()
    await db.refresh(grant)
    return PermissionGrantOut.model_validate(grant)


@router.delete("/{grant_id}", status_code=status.HTTP_204_NO_CONTENT, summary="İzni kaldır")
async def revoke_grant(tenant_id: uuid.UUID, grant_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                       _admin: User = Depends(_perm_admin)) -> None:
    await service.revoke_permission(db, tenant_id=tenant_id, grant_id=grant_id)
    await db.commit()

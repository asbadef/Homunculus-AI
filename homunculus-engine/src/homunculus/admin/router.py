"""
/admin — users and groups of the caller's tenant.

  GET    /admin/permissions               groups.manage
  GET    /admin/groups                    groups.manage
  POST   /admin/groups                    groups.manage
  PATCH  /admin/groups/{id}               groups.manage
  DELETE /admin/groups/{id}               groups.manage
  GET    /admin/users                     users.manage
  POST   /admin/users                     users.manage
  PATCH  /admin/users/{id}                users.manage
  PUT    /admin/users/{id}/groups         users.manage
  POST   /admin/users/{id}/reset-password users.manage
  POST   /admin/users/{id}/reset-mfa      users.manage

Everything is scoped to the tenant in the caller's token (`caller_tenant_id`, which also checks
the caller's active membership in an active tenant); a user or group of another tenant is a 404,
the same answer as an id that names nothing. Every write starts by taking the tenant's
admin-guard lock (`service.serialise`), and every successful mutation is audited as event_type
"admin" with {actor, target, before, after} — never a password, hash or TOTP secret.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admin import service
from homunculus.admin.schemas import (
    GroupCreate, GroupOut, GroupPatch, PasswordResetIn, PermissionOut, UserCreate,
    UserGroupOut, UserGroupsIn, UserOut, UserPatch,
)
from homunculus.admin.service import AdminError
from homunculus.auth.audit import append_audit
from homunculus.auth.dependencies import (
    Principal, caller_tenant_id, get_principal, require_permission,
)
from homunculus.auth.models import Group, User
from homunculus.auth.permissions import ALL_PERMISSIONS, PERMISSIONS
from homunculus.db import get_db

router = APIRouter(prefix="/admin", tags=["admin"])

_groups = [Depends(require_permission("groups.manage"))]
_users = [Depends(require_permission("users.manage"))]


def _http(exc: AdminError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.detail)


def _group_out(group: Group, count: int) -> GroupOut:
    return GroupOut(id=group.id, slug=group.slug, name=group.name,
                    description=group.description, mfa_required=group.mfa_required,
                    is_system=group.is_system,
                    # A system group's rights are the whole catalogue by rule (spec §3); report
                    # that, not the rows seeded when the tenant was created.
                    permissions=sorted(ALL_PERMISSIONS) if group.is_system else group.permission_keys,
                    member_count=count)


def _user_out(user: User, tenant_id: uuid.UUID) -> UserOut:
    links = sorted((l for l in user.group_links if l.group.tenant_id == tenant_id),
                   key=lambda l: l.group.slug)
    return UserOut(
        id=user.id, username=user.username, email=user.email, full_name=user.full_name,
        auth_source=user.auth_source, is_active=user.is_active, totp_enabled=user.totp_enabled,
        last_login_at=user.last_login_at,
        groups=[UserGroupOut(id=l.group.id, slug=l.group.slug, name=l.group.name,
                             source=l.source) for l in links],
    )


def _audit(request: Request, principal: Principal, kind: str, target: str, *,
           before=None, after=None) -> None:
    append_audit(request, tenant=principal.tenant, event_type="admin", subject=kind,
                 payload={"actor": principal.user.username, "target": target,
                          "before": before, "after": after})


async def _run(db: AsyncSession, coro):
    """Await a service call; on AdminError roll back so a refused change leaves nothing."""
    try:
        return await coro
    except AdminError as exc:
        await db.rollback()
        raise _http(exc) from None


# ---------------------------------------------------------------- permissions & groups

@router.get("/permissions", response_model=list[PermissionOut],
            dependencies=[*_groups, Depends(caller_tenant_id)])
async def list_permissions() -> list[PermissionOut]:
    return [PermissionOut(key=k, description=d) for k, d in PERMISSIONS.items()]


@router.get("/groups", response_model=list[GroupOut], dependencies=_groups)
async def list_groups(tenant_id: uuid.UUID = Depends(caller_tenant_id),
                      db: AsyncSession = Depends(get_db)) -> list[GroupOut]:
    return [_group_out(g, n) for g, n in await service.list_groups(db, tenant_id)]


@router.post("/groups", response_model=GroupOut, status_code=status.HTTP_201_CREATED,
             dependencies=_groups)
async def create_group(body: GroupCreate, request: Request,
                       principal: Principal = Depends(get_principal),
                       tenant_id: uuid.UUID = Depends(caller_tenant_id),
                       db: AsyncSession = Depends(get_db)) -> GroupOut:
    await service.serialise(db, tenant_id)
    group = await _run(db, service.create_group(
        db, tenant_id, slug=body.slug, name=body.name, description=body.description,
        mfa_required=body.mfa_required, permissions=body.permissions))
    await db.commit()
    _audit(request, principal, "group.create", str(group.id),
           after={"slug": group.slug, "name": group.name, "permissions": group.permission_keys,
                  "mfa_required": group.mfa_required})
    return _group_out(group, 0)


@router.patch("/groups/{group_id}", response_model=GroupOut, dependencies=_groups)
async def update_group(group_id: uuid.UUID, body: GroupPatch, request: Request,
                       principal: Principal = Depends(get_principal),
                       tenant_id: uuid.UUID = Depends(caller_tenant_id),
                       db: AsyncSession = Depends(get_db)) -> GroupOut:
    await service.serialise(db, tenant_id)
    group = await _run(db, service.get_group(db, tenant_id, group_id, for_update=True))
    before = {"name": group.name, "description": group.description,
              "permissions": group.permission_keys, "mfa_required": group.mfa_required}
    group = await _run(db, service.update_group(
        db, tenant_id, group, name=body.name, description=body.description,
        mfa_required=body.mfa_required, permissions=body.permissions))
    await db.commit()
    _audit(request, principal, "group.update", str(group.id), before=before,
           after={"name": group.name, "description": group.description,
                  "permissions": group.permission_keys, "mfa_required": group.mfa_required})
    return _group_out(group, await service.member_count(db, group.id))


@router.delete("/groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT,
               dependencies=_groups)
async def delete_group(group_id: uuid.UUID, request: Request,
                       principal: Principal = Depends(get_principal),
                       tenant_id: uuid.UUID = Depends(caller_tenant_id),
                       db: AsyncSession = Depends(get_db)) -> Response:
    await service.serialise(db, tenant_id)
    group = await _run(db, service.get_group(db, tenant_id, group_id, for_update=True))
    before = {"slug": group.slug, "name": group.name, "permissions": group.permission_keys}
    await _run(db, service.delete_group(db, tenant_id, group))
    await db.commit()
    _audit(request, principal, "group.delete", str(group_id), before=before)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------- users

@router.get("/users", response_model=list[UserOut], dependencies=_users)
async def list_users(tenant_id: uuid.UUID = Depends(caller_tenant_id),
                     db: AsyncSession = Depends(get_db)) -> list[UserOut]:
    return [_user_out(u, tenant_id) for u in await service.list_users(db, tenant_id)]


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED,
             dependencies=_users)
async def create_user(body: UserCreate, request: Request,
                      principal: Principal = Depends(get_principal),
                      tenant_id: uuid.UUID = Depends(caller_tenant_id),
                      db: AsyncSession = Depends(get_db)) -> UserOut:
    await service.serialise(db, tenant_id)
    user = await _run(db, service.create_local_user(
        db, tenant_id, username=body.username, email=body.email, full_name=body.full_name,
        password=body.password, group_ids=body.group_ids, actor_id=principal.user.id))
    await db.commit()
    out = _user_out(user, tenant_id)
    _audit(request, principal, "user.create", str(user.id),
           after={"username": out.username, "email": out.email, "full_name": out.full_name,
                  "groups": [g.slug for g in out.groups]})
    return out


@router.patch("/users/{user_id}", response_model=UserOut, dependencies=_users)
async def update_user(user_id: uuid.UUID, body: UserPatch, request: Request,
                      principal: Principal = Depends(get_principal),
                      tenant_id: uuid.UUID = Depends(caller_tenant_id),
                      db: AsyncSession = Depends(get_db)) -> UserOut:
    await service.serialise(db, tenant_id)
    user = await _run(db, service.get_tenant_user(db, tenant_id, user_id))
    before = {"full_name": user.full_name, "email": user.email, "is_active": user.is_active}
    user = await _run(db, service.patch_user(
        db, tenant_id, user, full_name=body.full_name, email=body.email,
        is_active=body.is_active))
    await db.commit()
    _audit(request, principal, "user.update", str(user.id), before=before,
           after={"full_name": user.full_name, "email": user.email, "is_active": user.is_active})
    return _user_out(await service.get_tenant_user(db, tenant_id, user.id), tenant_id)


@router.put("/users/{user_id}/groups", response_model=UserOut, dependencies=_users)
async def set_user_groups(user_id: uuid.UUID, body: UserGroupsIn, request: Request,
                          principal: Principal = Depends(get_principal),
                          tenant_id: uuid.UUID = Depends(caller_tenant_id),
                          db: AsyncSession = Depends(get_db)) -> UserOut:
    await service.serialise(db, tenant_id)
    user = await _run(db, service.get_tenant_user(db, tenant_id, user_id))
    before = [g.slug for g in _user_out(user, tenant_id).groups]
    user = await _run(db, service.set_user_groups(db, tenant_id, user, body.group_ids,
                                                  principal.user.id))
    await db.commit()
    out = _user_out(user, tenant_id)
    _audit(request, principal, "user.groups", str(user.id), before=before,
           after=[g.slug for g in out.groups])
    return out


@router.post("/users/{user_id}/reset-password", dependencies=_users)
async def reset_password(user_id: uuid.UUID, body: PasswordResetIn, request: Request,
                         principal: Principal = Depends(get_principal),
                         tenant_id: uuid.UUID = Depends(caller_tenant_id),
                         db: AsyncSession = Depends(get_db)) -> dict:
    await service.serialise(db, tenant_id)
    user = await _run(db, service.get_tenant_user(db, tenant_id, user_id))
    await _run(db, service.reset_password(db, user, body.password))
    await db.commit()
    _audit(request, principal, "user.password_reset", str(user.id))
    return {"ok": True}


@router.post("/users/{user_id}/reset-mfa", dependencies=_users)
async def reset_mfa(user_id: uuid.UUID, request: Request,
                    principal: Principal = Depends(get_principal),
                    tenant_id: uuid.UUID = Depends(caller_tenant_id),
                    db: AsyncSession = Depends(get_db)) -> dict:
    await service.serialise(db, tenant_id)
    user = await _run(db, service.get_tenant_user(db, tenant_id, user_id))
    before = {"totp_enabled": user.totp_enabled}
    await _run(db, service.reset_mfa(db, user))
    await db.commit()
    _audit(request, principal, "user.mfa_reset", str(user.id), before=before,
           after={"totp_enabled": False})
    return {"ok": True}

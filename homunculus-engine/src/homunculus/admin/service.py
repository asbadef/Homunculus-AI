"""Administration logic: groups and users of ONE tenant, with the guards that keep a tenant
administrable. Every function raises AdminError(status, detail); the router turns that into
the HTTP response and rolls the session back, so a refused change leaves nothing behind.

Concurrency (spec §6, Guards):
  * The router calls `serialise` first in every write: the tenant's admin-guard lock, held to
    the end of the transaction, so writes to one tenant's users and groups run one at a time.
    Their before/after snapshots are then exact, and two token bumps over overlapping members
    cannot deadlock.
  * Every change that can take administrator rights away ends with `count_admins` (which takes
    the same lock) and is refused on 0 — so the guard holds for any caller of these functions,
    through the router or not.
  * A group being edited or deleted is read with `get_group(..., for_update=True)`: the row lock
    serialises two edits of one group, and it blocks anyone adding a member to the group (the
    foreign key takes a KEY SHARE lock on it) while its member count is checked.

The caller's tenant comes from `auth.dependencies.caller_tenant_id` (Task 7b), which also checks
the membership and the tenant are active. A user or group of another tenant is never found here:
the answer is the same 404 as for an id that names nothing.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from homunculus.auth.groups import (
    GroupError, bump_group_members, bump_user, count_admins, lock_admin_guard, set_manual_groups,
)
from homunculus.auth.models import (
    AUTH_LOCAL, Group, GroupPermission, LdapGroupMapping, TenantMembership, User, UserGroup,
)
from homunculus.auth.permissions import UnknownPermission, validate_permissions
from homunculus.auth.service import hash_password, normalize_login, run_bcrypt

LAST_ADMIN = "Son yönetici yetkisi kaldırılamaz"
LAST_ADMIN_DEACTIVATE = "Son yönetici pasifleştirilemez"
GROUP_NOT_FOUND = "Group not found"
USER_NOT_FOUND = "User not found"
SLUG_TAKEN = "Bu kısa ad zaten kullanılıyor"
LOGIN_TAKEN = "Bu kullanıcı adı veya e-posta zaten kayıtlı"
CONCURRENT_CHANGE = "Kayıt aynı anda değiştirildi; lütfen tekrar deneyin"
DIRECTORY_PASSWORD = "Parola Active Directory tarafından yönetiliyor"


class AdminError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


async def serialise(db: AsyncSession, tenant_id: uuid.UUID) -> None:
    """Start an /admin write: take the tenant's admin-guard lock for this transaction."""
    await lock_admin_guard(db, tenant_id)


# ---------------------------------------------------------------- groups

async def list_groups(db: AsyncSession, tenant_id: uuid.UUID) -> list[tuple[Group, int]]:
    counts = (
        select(UserGroup.group_id, func.count().label("n")).group_by(UserGroup.group_id)
    ).subquery()
    stmt = (
        select(Group, func.coalesce(counts.c.n, 0))
        .outerjoin(counts, counts.c.group_id == Group.id)
        .where(Group.tenant_id == tenant_id)
        .order_by(Group.slug)
    )
    return [(group, int(n)) for group, n in (await db.execute(stmt)).all()]


async def get_group(db: AsyncSession, tenant_id: uuid.UUID, group_id: uuid.UUID, *,
                    for_update: bool = False) -> Group:
    """The tenant's group, or 404. `for_update` locks its row to the end of the transaction —
    take it before editing or deleting the group (see the module docstring)."""
    stmt = select(Group).where(Group.id == group_id, Group.tenant_id == tenant_id)
    if for_update:
        stmt = stmt.with_for_update().execution_options(populate_existing=True)
    group = (await db.execute(stmt)).scalar_one_or_none()
    if group is None:
        raise AdminError(404, GROUP_NOT_FOUND)
    return group


async def member_count(db: AsyncSession, group_id: uuid.UUID) -> int:
    return int((await db.execute(
        select(func.count()).select_from(UserGroup).where(UserGroup.group_id == group_id)
    )).scalar_one())


def _keys(permissions: list[str]) -> list[str]:
    try:
        return list(dict.fromkeys(validate_permissions(permissions)))
    except UnknownPermission as exc:
        raise AdminError(422, str(exc)) from None


async def create_group(db: AsyncSession, tenant_id: uuid.UUID, *, slug: str, name: str,
                       description: str | None, mfa_required: bool,
                       permissions: list[str]) -> Group:
    keys = _keys(permissions)
    exists = (await db.execute(
        select(Group.id).where(Group.tenant_id == tenant_id, Group.slug == slug)
    )).scalar_one_or_none()
    if exists is not None:
        raise AdminError(409, SLUG_TAKEN)
    group = Group(tenant_id=tenant_id, slug=slug, name=name.strip(), description=description,
                  mfa_required=mfa_required, is_system=False)
    group.permissions = [GroupPermission(permission=k) for k in keys]
    db.add(group)
    try:
        await db.flush()
    except IntegrityError:
        raise AdminError(409, SLUG_TAKEN) from None   # a concurrent create took the slug
    return group


async def update_group(db: AsyncSession, tenant_id: uuid.UUID, group: Group, *,
                       name: str | None, description: str | None, mfa_required: bool | None,
                       permissions: list[str] | None) -> Group:
    """Labels and rights of a group. A change of rights (permissions or the MFA rule) retires
    every member's access tokens, and is refused if it would leave the tenant without an
    administrator — an edit to the group the administrators hold their rights through is the
    other way, besides their own memberships, to take those rights away."""
    if group.is_system and (permissions is not None or mfa_required is not None):
        # The system group's rights are a rule, not rows (spec §3); only its labels may change.
        raise AdminError(409, "Sistem grubunun izinleri ve MFA kuralı değiştirilemez")
    rights_changed = False
    if name is not None:
        group.name = name.strip()
    if description is not None:
        group.description = description
    if mfa_required is not None and mfa_required != group.mfa_required:
        group.mfa_required = mfa_required
        rights_changed = True
    if permissions is not None:
        new = set(_keys(permissions))
        old = set(group.permission_keys)
        if new != old:
            for gp in list(group.permissions):
                if gp.permission not in new:
                    group.permissions.remove(gp)
            for key in sorted(new - old):
                group.permissions.append(GroupPermission(permission=key))
            rights_changed = True
    if rights_changed:
        group.updated_at = datetime.now(timezone.utc)   # onupdate never fires for a rows-only change
    await db.flush()
    if rights_changed:
        await bump_group_members(db, group.id)
        if await count_admins(db, tenant_id) == 0:
            raise AdminError(409, LAST_ADMIN)
    return group


async def delete_group(db: AsyncSession, tenant_id: uuid.UUID, group: Group) -> None:
    """Only an empty, unmapped, non-system group. Read it with `for_update=True`: with its row
    locked nobody can join it between the member count and the DELETE, whose cascade would
    otherwise remove that fresh membership silently. The administrator count at the end is the
    backstop for a caller that did not lock."""
    if group.is_system:
        raise AdminError(409, "Sistem grubu silinemez")
    if await member_count(db, group.id) > 0:
        raise AdminError(409, "Üyesi olan grup silinemez")
    mappings = int((await db.execute(
        select(func.count()).select_from(LdapGroupMapping)
        .where(LdapGroupMapping.group_id == group.id)
    )).scalar_one())
    if mappings > 0:
        raise AdminError(409, "AD eşlemesi olan grup silinemez")
    await db.delete(group)
    await db.flush()
    if await count_admins(db, tenant_id) == 0:
        raise AdminError(409, LAST_ADMIN)


# ---------------------------------------------------------------- users

def _tenant_users(tenant_id: uuid.UUID):
    """Users with an ACTIVE membership in the tenant (EXISTS, so a duplicate membership row
    cannot duplicate the user), their group links and groups loaded."""
    member = select(TenantMembership.id).where(
        TenantMembership.user_id == User.id,
        TenantMembership.tenant_id == tenant_id,
        TenantMembership.is_active == True,  # noqa: E712
    ).exists()
    return (
        select(User)
        .where(member)
        .options(selectinload(User.group_links).selectinload(UserGroup.group))
        # A re-fetch after set_manual_groups must show the rows it added/deleted, not the
        # collection the identity map already holds.
        .execution_options(populate_existing=True)
    )


async def list_users(db: AsyncSession, tenant_id: uuid.UUID) -> list[User]:
    return list((await db.execute(_tenant_users(tenant_id).order_by(User.username))).scalars().all())


async def get_tenant_user(db: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID) -> User:
    user = (await db.execute(_tenant_users(tenant_id).where(User.id == user_id))).scalars().first()
    if user is None:
        raise AdminError(404, USER_NOT_FOUND)
    return user


async def _refuse_duplicate_login(db: AsyncSession, *, username: str | None, email: str | None,
                                  except_id: uuid.UUID | None = None) -> None:
    """Sign-in matches a login against usernames AND e-mails, so a new value may be neither
    another account's username nor its e-mail, in either direction."""
    clauses = []
    if username:
        clauses.append(User.username == username)
        clauses.append(User.email == username)      # a username may not be someone's e-mail
    if email:
        clauses.append(User.email == email)
        clauses.append(User.username == email)      # an e-mail may not be someone's username
    if not clauses:
        return
    stmt = select(User.id).where(or_(*clauses))
    if except_id is not None:
        stmt = stmt.where(User.id != except_id)
    if (await db.execute(stmt)).first() is not None:
        raise AdminError(409, LOGIN_TAKEN)


async def _set_groups(db: AsyncSession, *, user: User, tenant_id: uuid.UUID,
                      group_ids: list[uuid.UUID], actor_id: uuid.UUID | None) -> None:
    try:
        await set_manual_groups(db, user=user, tenant_id=tenant_id, group_ids=group_ids,
                                granted_by_id=actor_id)
    except GroupError as exc:
        raise AdminError(422, str(exc)) from None     # a group of another tenant, or none
    except IntegrityError:
        # A group deleted, or the same membership added, by a concurrent request.
        raise AdminError(409, CONCURRENT_CHANGE) from None


async def create_local_user(db: AsyncSession, tenant_id: uuid.UUID, *, username: str,
                            email: str | None, full_name: str, password: str,
                            group_ids: list[uuid.UUID], actor_id: uuid.UUID) -> User:
    key = normalize_login(username)
    mail = normalize_login(email) or None
    if not key:
        raise AdminError(422, "Kullanıcı adı zorunludur")
    await _refuse_duplicate_login(db, username=key, email=mail)
    hashed = await run_bcrypt(hash_password, password)   # bcrypt off the event loop, bounded
    user = User(username=key, email=mail, full_name=full_name.strip(),
                hashed_password=hashed, auth_source=AUTH_LOCAL)
    db.add(user)
    try:
        await db.flush()
    except IntegrityError:
        raise AdminError(409, LOGIN_TAKEN) from None   # a concurrent create took the name
    db.add(TenantMembership(user_id=user.id, tenant_id=tenant_id, granted_by_id=actor_id))
    await db.flush()
    await _set_groups(db, user=user, tenant_id=tenant_id, group_ids=group_ids,
                      actor_id=actor_id)
    return await get_tenant_user(db, tenant_id, user.id)


async def patch_user(db: AsyncSession, tenant_id: uuid.UUID, user: User, *,
                     full_name: str | None, email: str | None, is_active: bool | None) -> User:
    if full_name is not None:
        user.full_name = full_name.strip()
    if email is not None:
        mail = normalize_login(email) or None
        await _refuse_duplicate_login(db, username=None, email=mail, except_id=user.id)
        user.email = mail
    if is_active is not None and is_active != user.is_active:
        user.is_active = is_active
        if not is_active:
            # Refresh tokens issued before now stay dead even if the account is reactivated
            # later ("phone stolen, deactivate, reactivate tomorrow").
            user.sessions_revoked_at = datetime.now(timezone.utc)
        await db.flush()
        await bump_user(db, user)
        if not is_active and await count_admins(db, tenant_id) == 0:
            raise AdminError(409, LAST_ADMIN_DEACTIVATE)
    try:
        await db.flush()
    except IntegrityError:
        raise AdminError(409, LOGIN_TAKEN) from None   # a concurrent change took the e-mail
    return user


async def set_user_groups(db: AsyncSession, tenant_id: uuid.UUID, user: User,
                          group_ids: list[uuid.UUID], actor_id: uuid.UUID | None) -> User:
    """Replace the user's MANUAL memberships (directory-held ones stay). Refused if the tenant
    would be left without an administrator — the user's own change of groups included."""
    await _set_groups(db, user=user, tenant_id=tenant_id, group_ids=group_ids, actor_id=actor_id)
    if await count_admins(db, tenant_id) == 0:
        raise AdminError(409, LAST_ADMIN)
    return await get_tenant_user(db, tenant_id, user.id)


async def reset_password(db: AsyncSession, user: User, password: str) -> None:
    """A temporary password for a LOCAL account. The hash changes, so the credential
    fingerprint in every refresh token no longer matches (all sessions end), and the token
    version moves (every access token ends)."""
    if user.auth_source != AUTH_LOCAL:
        raise AdminError(400, DIRECTORY_PASSWORD)
    user.hashed_password = await run_bcrypt(hash_password, password)
    await db.flush()
    await bump_user(db, user)


async def reset_mfa(db: AsyncSession, user: User) -> None:
    """Clear the authenticator (a lost phone); the user enrols again at the next sign-in. The
    TOTP secret is part of the credential fingerprint, so every session ends with it."""
    user.totp_secret = None
    user.totp_enabled = False
    await db.flush()
    await bump_user(db, user)

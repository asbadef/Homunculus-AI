"""Administration logic: groups and users of ONE tenant, with the guards that keep a tenant
administrable. Every function raises AdminError(status, detail); the router turns that into
the HTTP response and rolls the session back, so a refused change leaves nothing behind.

No grant beyond your own rights (403). `Actor.perms` are the caller's rights (the token's
`perms`, confirmed current by `serialise`). A right is what a token minted from the group would
carry: the whole catalogue for a system group, else its keys (`group_rights`); a user's rights
are the union over their groups in this tenant (`user_rights`, as `summarize` computes them).
  * A write that targets a user (PATCH, PUT groups, password or MFA reset) needs the target's
    current rights within the caller's: nobody edits, demotes or takes over an account that can
    do more than they can.
  * A group given to a user (PUT groups, create) needs its rights within the caller's.
  * Creating a group needs its permissions within the caller's; editing or deleting one needs
    its rights before AND after within the caller's.
So a `users.manage`-only desk cannot make anyone (itself included) more than it is, and a
`groups.manage`-only desk cannot widen any group, its own included. A caller holding the whole
catalogue (the system group) is not restricted.

Accounts are global (409). `is_active`, the password, the TOTP secret, the e-mail and the name
live on the one `users` row every tenant shares. They are not changed here for a platform
operator or for an account with an active membership in ANOTHER tenant: one hospital must not
be able to deactivate, take over or re-key an account another hospital (or the vendor) relies
on. Its groups in THIS tenant may still be set. Nor does an administrator reset their own
password or MFA, or deactivate themselves, here (409): their own password goes through
/auth/password, which checks the current one.

Concurrency (spec §6, Guards):
  * The router calls `serialise` first in every write: the tenant's admin-guard lock, held to
    the end of the transaction, so writes to one tenant's users and groups run one at a time.
    Their before/after snapshots are then exact, and two token bumps over overlapping members
    cannot deadlock. Under the lock it re-reads the caller: a request that waited behind a
    change to the caller's own rights is refused (401 `token_version`) instead of acting with
    the rights the caller had when the request arrived.
  * Every change that can take administrator rights away ends with `count_admins` (which takes
    the same lock) and is refused on 0 — so the guard holds for any caller of these functions,
    through the router or not. `count_admins` counts LOCAL administrators only.
  * A group being edited or deleted is read with `get_group(..., for_update=True)`: the row lock
    serialises two edits of one group, and it blocks anyone adding a member to the group (the
    foreign key takes a KEY SHARE lock on it) while its member count is checked.

The caller's tenant comes from `auth.dependencies.caller_tenant_id` (Task 7b), which also checks
the membership and the tenant are active. A user or group of another tenant is never found here:
the answer is the same 404 as for an id that names nothing.
"""
from __future__ import annotations

import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from homunculus.auth.dependencies import MEMBERSHIP_INACTIVE
from homunculus.auth.groups import (
    GroupError, bump_group_members, bump_user, count_admins, lock_admin_guard, set_manual_groups,
    summarize,
)
from homunculus.auth.models import (
    AUTH_LOCAL, Group, GroupPermission, LdapGroupMapping, TenantMembership, User, UserGroup,
)
from homunculus.auth.permissions import ALL_PERMISSIONS, UnknownPermission, validate_permissions
from homunculus.auth.service import hash_password, normalize_login, run_bcrypt

LAST_ADMIN = "Son yönetici yetkisi kaldırılamaz"
LAST_ADMIN_DEACTIVATE = "Son yönetici pasifleştirilemez"
GROUP_NOT_FOUND = "Group not found"
USER_NOT_FOUND = "User not found"
UNKNOWN_GROUP = "unknown group for this tenant"
SLUG_TAKEN = "Bu kısa ad zaten kullanılıyor"
LOGIN_TAKEN = "Bu kullanıcı adı veya e-posta zaten kayıtlı"
CONCURRENT_CHANGE = "Kayıt aynı anda değiştirildi; lütfen tekrar deneyin"
DIRECTORY_PASSWORD = "Parola Active Directory tarafından yönetiliyor"
BEYOND_OWN_RIGHTS = "Kendi yetkilerinizi aşan bir işlem yapılamaz"
PLATFORM_ACCOUNT = ("Platform operatörü hesabı kurum yönetiminden değiştirilemez; "
                    "yalnızca bu kurumdaki grupları ayarlanabilir")
SHARED_ACCOUNT = ("Bu hesap başka bir kurumda da etkin; parola, MFA, e-posta, ad ve etkinlik "
                  "buradan değiştirilemez, yalnızca bu kurumdaki grupları ayarlanabilir")
SELF_CREDENTIALS = ("Kendi parolanızı veya MFA'nızı buradan sıfırlayamazsınız; parola için "
                    "Hesabım > Parola değiştir'i kullanın")
SELF_DEACTIVATE = "Kendi hesabınızı pasifleştiremezsiniz"
NOT_AUTHENTICATED = "Invalid or missing authentication credentials"
TOKEN_VERSION = "token_version"


class AdminError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True)
class Actor:
    """Who makes the change: their account, the rights their token carries and the token's
    version (checked against the database under the lock by `serialise`)."""
    id: uuid.UUID
    perms: frozenset[str]
    token_version: int


async def serialise(db: AsyncSession, tenant_id: uuid.UUID, actor: Actor) -> None:
    """Start an /admin write: take the tenant's admin-guard lock for this transaction, then
    re-read the caller. The permission guard ran before the lock; a change to the caller's own
    rights committed while this request waited (a demotion, a deactivation) bumps their token
    version, and the request is refused as the dependency would refuse it now."""
    await lock_admin_guard(db, tenant_id)
    member = select(TenantMembership.id).where(
        TenantMembership.user_id == User.id,
        TenantMembership.tenant_id == tenant_id,
        TenantMembership.is_active == True,  # noqa: E712
    ).exists()
    row = (await db.execute(
        select(User.token_version, User.is_active, member.label("member"))
        .where(User.id == actor.id)
    )).first()
    if row is None or not row.is_active:
        raise AdminError(401, NOT_AUTHENTICATED)
    if row.token_version != actor.token_version:
        raise AdminError(401, TOKEN_VERSION)
    if not row.member:
        raise AdminError(403, MEMBERSHIP_INACTIVE)


# ---------------------------------------------------------------- rights

def group_rights(group: Group) -> frozenset[str]:
    """What a token minted from this group carries (see `auth.groups.summarize`)."""
    if group.is_system:
        return ALL_PERMISSIONS
    return frozenset(group.permission_keys) & ALL_PERMISSIONS


def user_rights(user: User, tenant_id: uuid.UUID) -> frozenset[str]:
    """The user's rights in this tenant: the union over their groups here (group links loaded)."""
    return summarize(link for link in user.group_links if link.group.tenant_id == tenant_id).perms


def _within(actor: Actor, rights: Iterable[str]) -> None:
    beyond = frozenset(rights) - actor.perms
    if beyond:
        raise AdminError(403, f"{BEYOND_OWN_RIGHTS}: {', '.join(sorted(beyond))}")


async def _grantable(db: AsyncSession, tenant_id: uuid.UUID, actor: Actor,
                     group_ids: Iterable[uuid.UUID]) -> None:
    """Every group about to be given is this tenant's, and grants nothing beyond the caller."""
    wanted = set(group_ids)
    if not wanted:
        return
    groups = (await db.execute(
        select(Group).where(Group.tenant_id == tenant_id, Group.id.in_(wanted))
    )).scalars().all()
    if len(groups) != len(wanted):
        raise AdminError(422, UNKNOWN_GROUP)
    for group in groups:
        _within(actor, group_rights(group))


async def _refuse_global_account(db: AsyncSession, tenant_id: uuid.UUID, user: User) -> None:
    if user.is_platform_support:
        raise AdminError(409, PLATFORM_ACCOUNT)
    elsewhere = (await db.execute(
        select(TenantMembership.id).where(
            TenantMembership.user_id == user.id,
            TenantMembership.tenant_id != tenant_id,
            TenantMembership.is_active == True,  # noqa: E712
        ).limit(1)
    )).first()
    if elsewhere is not None:
        raise AdminError(409, SHARED_ACCOUNT)


async def _flush(db: AsyncSession, detail: str) -> None:
    try:
        await db.flush()
    except IntegrityError:
        raise AdminError(409, detail) from None


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


async def create_group(db: AsyncSession, tenant_id: uuid.UUID, actor: Actor, *, slug: str,
                       name: str, description: str | None, mfa_required: bool,
                       permissions: list[str]) -> Group:
    keys = _keys(permissions)
    _within(actor, keys)
    exists = (await db.execute(
        select(Group.id).where(Group.tenant_id == tenant_id, Group.slug == slug)
    )).scalar_one_or_none()
    if exists is not None:
        raise AdminError(409, SLUG_TAKEN)
    group = Group(tenant_id=tenant_id, slug=slug, name=name.strip(), description=description,
                  mfa_required=mfa_required, is_system=False)
    group.permissions = [GroupPermission(permission=k) for k in keys]
    db.add(group)
    await _flush(db, SLUG_TAKEN)                        # a concurrent create took the slug
    return group


async def update_group(db: AsyncSession, tenant_id: uuid.UUID, group: Group, actor: Actor, *,
                       name: str | None, description: str | None, mfa_required: bool | None,
                       permissions: list[str] | None) -> bool:
    """Labels and rights of a group; True if anything changed. A change of rights (permissions
    or the MFA rule) retires every member's access tokens, and is refused if it would leave the
    tenant without an administrator — an edit to the group the administrators hold their rights
    through is the other way, besides their own memberships, to take those rights away."""
    _within(actor, group_rights(group))                 # before ...
    if group.is_system and (permissions is not None or mfa_required is not None):
        # The system group's rights are a rule, not rows (spec §3); only its labels may change.
        raise AdminError(409, "Sistem grubunun izinleri ve MFA kuralı değiştirilemez")
    new = None
    if permissions is not None:
        new = set(_keys(permissions))
        _within(actor, new)                             # ... and after
    changed = rights_changed = False
    if name is not None and name.strip() != group.name:
        group.name = name.strip()
        changed = True
    if description is not None and description != group.description:
        group.description = description
        changed = True
    if mfa_required is not None and mfa_required != group.mfa_required:
        group.mfa_required = mfa_required
        rights_changed = True
    if new is not None:
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
    await _flush(db, CONCURRENT_CHANGE)
    if rights_changed:
        await bump_group_members(db, group.id)
        if await count_admins(db, tenant_id) == 0:
            raise AdminError(409, LAST_ADMIN)
    return changed or rights_changed


async def delete_group(db: AsyncSession, tenant_id: uuid.UUID, group: Group,
                       actor: Actor) -> None:
    """Only an empty, unmapped, non-system group. Read it with `for_update=True`: with its row
    locked nobody can join it between the member count and the DELETE, whose cascade would
    otherwise remove that fresh membership silently. The administrator count at the end is the
    backstop for a caller that did not lock."""
    _within(actor, group_rights(group))
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
    await _flush(db, CONCURRENT_CHANGE)
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
                      group_ids: list[uuid.UUID], actor: Actor) -> None:
    try:
        await set_manual_groups(db, user=user, tenant_id=tenant_id, group_ids=group_ids,
                                granted_by_id=actor.id)
    except GroupError as exc:
        raise AdminError(422, str(exc)) from None     # a group of another tenant, or none
    except IntegrityError:
        # A group deleted, or the same membership added, by a concurrent request.
        raise AdminError(409, CONCURRENT_CHANGE) from None


async def create_local_user(db: AsyncSession, tenant_id: uuid.UUID, actor: Actor, *,
                            username: str, email: str | None, full_name: str, password: str,
                            group_ids: list[uuid.UUID]) -> User:
    key = normalize_login(username)
    mail = normalize_login(email) or None
    if not key:
        raise AdminError(422, "Kullanıcı adı zorunludur")
    await _grantable(db, tenant_id, actor, group_ids)
    await _refuse_duplicate_login(db, username=key, email=mail)
    hashed = await run_bcrypt(hash_password, password)   # bcrypt off the event loop, bounded
    user = User(username=key, email=mail, full_name=full_name.strip(),
                hashed_password=hashed, auth_source=AUTH_LOCAL)
    db.add(user)
    await _flush(db, LOGIN_TAKEN)                        # a concurrent create took the name
    db.add(TenantMembership(user_id=user.id, tenant_id=tenant_id, granted_by_id=actor.id))
    await db.flush()
    await _set_groups(db, user=user, tenant_id=tenant_id, group_ids=group_ids, actor=actor)
    return await get_tenant_user(db, tenant_id, user.id)


async def update_user(db: AsyncSession, tenant_id: uuid.UUID, user: User, actor: Actor, *,
                      full_name: str | None, email: str | None, is_active: bool | None) -> bool:
    """Name, e-mail, active flag; True if anything changed. `email=""` clears the e-mail."""
    _within(actor, user_rights(user, tenant_id))
    changes: dict = {}
    if full_name is not None and full_name.strip() != user.full_name:
        changes["full_name"] = full_name.strip()
    if email is not None:
        mail = normalize_login(email) or None
        if mail != user.email:
            changes["email"] = mail
    if is_active is not None and is_active != user.is_active:
        changes["is_active"] = is_active
    if not changes:
        return False
    if changes.get("is_active") is False and user.id == actor.id:
        raise AdminError(409, SELF_DEACTIVATE)
    await _refuse_global_account(db, tenant_id, user)
    if "email" in changes:
        await _refuse_duplicate_login(db, username=None, email=changes["email"],
                                      except_id=user.id)
        user.email = changes["email"]
    if "full_name" in changes:
        user.full_name = changes["full_name"]
    if "is_active" in changes:
        user.is_active = is_active
        if not is_active:
            # Refresh tokens issued before now stay dead even if the account is reactivated
            # later ("phone stolen, deactivate, reactivate tomorrow").
            user.sessions_revoked_at = datetime.now(timezone.utc)
        await _flush(db, LOGIN_TAKEN)                    # the e-mail, if it changed too
        await bump_user(db, user)
        if not is_active and await count_admins(db, tenant_id) == 0:
            raise AdminError(409, LAST_ADMIN_DEACTIVATE)
    await _flush(db, LOGIN_TAKEN)                        # a concurrent change took the e-mail
    return True


async def set_user_groups(db: AsyncSession, tenant_id: uuid.UUID, user: User,
                          group_ids: list[uuid.UUID], actor: Actor) -> User:
    """Replace the user's MANUAL memberships (directory-held ones stay). Refused if the tenant
    would be left without an administrator — the user's own change of groups included."""
    _within(actor, user_rights(user, tenant_id))
    await _grantable(db, tenant_id, actor, group_ids)
    await _set_groups(db, user=user, tenant_id=tenant_id, group_ids=group_ids, actor=actor)
    if await count_admins(db, tenant_id) == 0:
        raise AdminError(409, LAST_ADMIN)
    return await get_tenant_user(db, tenant_id, user.id)


async def _may_reset(db: AsyncSession, tenant_id: uuid.UUID, user: User, actor: Actor) -> None:
    _within(actor, user_rights(user, tenant_id))
    if user.id == actor.id:
        raise AdminError(409, SELF_CREDENTIALS)
    await _refuse_global_account(db, tenant_id, user)


async def reset_password(db: AsyncSession, tenant_id: uuid.UUID, user: User, actor: Actor,
                         password: str) -> None:
    """A temporary password for a LOCAL account. The hash changes, so the credential
    fingerprint in every refresh token no longer matches (all sessions end), and the token
    version moves (every access token ends)."""
    await _may_reset(db, tenant_id, user, actor)
    if user.auth_source != AUTH_LOCAL:
        raise AdminError(400, DIRECTORY_PASSWORD)
    user.hashed_password = await run_bcrypt(hash_password, password)
    await db.flush()
    await bump_user(db, user)


async def reset_mfa(db: AsyncSession, tenant_id: uuid.UUID, user: User, actor: Actor) -> None:
    """Clear the authenticator (a lost phone); the user enrols again at the next sign-in. The
    TOTP secret is part of the credential fingerprint, so every session ends with it."""
    await _may_reset(db, tenant_id, user, actor)
    user.totp_secret = None
    user.totp_enabled = False
    await db.flush()
    await bump_user(db, user)

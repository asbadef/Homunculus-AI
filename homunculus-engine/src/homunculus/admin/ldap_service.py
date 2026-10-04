"""The /admin/ldap logic (spec §7, "Import and mapping"). The same rules as the rest of /admin
(`admin/service.py`): the tenant lock first (`serialise`, which the router calls), nobody grants
beyond their own rights, and every change that can take administrator rights away ends with
`count_admins`, which counts LOCAL administrators only. Errors are AdminError; the router turns
them into HTTP and rolls back.

The mapping table is tenant-wide policy: a row regroups every member of its AD group at their
next sign-in or refresh. Writing it (create, delete) therefore needs the WHOLE catalogue — the
system group — not `users.manage` alone (`_full_administrator`, 403 MAPPING_ADMIN_ONLY): a user
desk that may not regroup a nurse directly must not regroup every nurse through a mapping, nor
pool its rights with theirs. Reading it needs `users.manage`, as every /admin/ldap route.

It borrows `admin/service.py`'s private helpers (`_within`, `_grantable`, `_rights_by_user`,
`_union`, `_flush`) on purpose: one implementation of the rights rule, not two — and
`admin/schemas.py`'s `_USERNAME`, the one username rule."""
from __future__ import annotations

import asyncio
import time
import uuid
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from homunculus.admin.schemas import _USERNAME
from homunculus.admin.service import (
    LAST_ADMIN, LOGIN_TAKEN, UNKNOWN_GROUP, Actor, AdminError, _flush, _grantable,
    _rights_by_user, _union, _within, get_group, group_rights,
)
from homunculus.auth.groups import count_admins, lock_admin_guard, set_manual_groups
from homunculus.auth.ldap import LdapIdentity, LdapRuntime, LdapUnavailable, account_expired
from homunculus.auth.ldap3_directory import canonical_dn
from homunculus.auth.ldap_sync import dn_key, login_in_use, mapped_group_ids, sync_ldap_groups
from homunculus.auth.models import (
    AUTH_LDAP, SOURCE_LDAP, Group, LdapGroupMapping, TenantMembership, User, UserGroup,
)
from homunculus.auth.permissions import ALL_PERMISSIONS
from homunculus.auth.service import normalize_login

RESULT_CAP = 50


async def imported_ids(db: AsyncSession, external_ids: Iterable[str]) -> set[str]:
    """Which of these objectGUIDs already have a Homunculus account (in any tenant)."""
    ids = [i for i in external_ids if i]
    if not ids:
        return set()
    rows = await db.execute(select(User.external_id).where(User.external_id.in_(ids)))
    return {value for value in rows.scalars().all() if value is not None}


# ---------------------------------------------------------------- import (plan decision D12)
async def lookup_accounts(ldap: LdapRuntime,
                          external_ids: list[str]) -> dict[str, LdapIdentity | None]:
    """Each objectGUID's account as the directory reports it, every lookup through the admin
    lane (`LdapRuntime.admin_lane`): at most ADMIN_LANE_SLOTS at once across every request, so
    an import of 50 accounts against a slow domain controller leaves the directory's other
    threads to sign-ins. The first LdapUnavailable cancels the lookups still waiting or running
    — no queue of doomed calls is left in front of sign-ins — and is raised once they have
    stopped; the caller answers 503 with nothing written."""
    tasks: list[asyncio.Task] = []

    async def lookup(external_id: str) -> LdapIdentity | None:
        try:
            return await ldap.directory.find_by_external_id(external_id, lane=ldap.admin_lane)
        except LdapUnavailable:
            # The others are cancelled HERE, in the step that saw the failure: the TaskGroup
            # would only do it a step later, after the lane place this lookup gave back had
            # already let one more lookup start.
            for task in tasks:
                if task is not asyncio.current_task():
                    task.cancel()
            raise

    try:
        async with asyncio.TaskGroup() as group:
            tasks.extend(group.create_task(lookup(external_id)) for external_id in external_ids)
    except BaseExceptionGroup as failed:
        outages, others = failed.split(LdapUnavailable)
        if others is not None or outages is None:
            raise
        raise _first(outages) from None
    return {external_id: task.result() for external_id, task in zip(external_ids, tasks)}


def _first(group: BaseExceptionGroup) -> BaseException:
    first = group.exceptions[0]
    return _first(first) if isinstance(first, BaseExceptionGroup) else first


SKIP_EXISTS = "exists"
SKIP_NOT_FOUND = "not_found"
SKIP_DISABLED = "disabled"
SKIP_EXPIRED = "expired"
SKIP_LOGIN_TAKEN = "login_taken"
SKIP_NO_USERNAME = "no_username"
SKIP_INVALID_LOGIN = "invalid_login"
_EMAIL_MAX = 254       # users.email
_NAME_MAX = 200        # users.full_name


@dataclass(frozen=True)
class Imported:
    external_id: str
    user_id: uuid.UUID


@dataclass
class ImportReport:
    imported: list[Imported] = field(default_factory=list)
    skipped: list[tuple[str, str]] = field(default_factory=list)


async def import_users(db: AsyncSession, tenant_id: uuid.UUID, actor: Actor,
                       external_ids: list[str], identities: Mapping[str, LdapIdentity | None],
                       *, extra_group_ids: list[uuid.UUID]) -> ImportReport:
    """Spec §7 import, in the order given (ids already canonical). Call under the tenant lock
    (`serialise`). `identities` holds the directory's answer for every id that had no account
    when the request began (fetched before the lock); an id imported since is caught by the
    re-check here. Each created account: auth_source ldap, no password, username = the
    sAMAccountName lower-cased, email = mail (dropped when another account uses it),
    full_name = displayName, a membership in this tenant, the mapped groups as `ldap` rows and
    `extra_group_ids` as `manual` rows — every one of those groups within the caller's rights,
    or 403 for the whole request.

    An account disabled in AD, or past its end date (accountExpires — how HR often off-boards,
    and the default LDAP_USER_FILTER lets it through), could never sign in: it is skipped
    (`disabled`, `expired`), not created. So is one whose sAMAccountName, through
    `normalize_login`, breaks the rule every local username follows (`admin/schemas.py`
    `_USERNAME`: a-z 0-9 . _ @ -, 2-128) — a Turkish letter the fold leaves (`ş`), or a
    look-alike from another script that would read as someone else's name: `invalid_login`."""
    await _grantable(db, tenant_id, actor, extra_group_ids)
    existing = await imported_ids(db, external_ids)
    now = time.time()
    report = ImportReport()
    for external_id in external_ids:
        identity = identities.get(external_id)
        if external_id in existing:
            report.skipped.append((external_id, SKIP_EXISTS))
            continue
        if identity is None:
            report.skipped.append((external_id, SKIP_NOT_FOUND))
            continue
        if identity.disabled:
            report.skipped.append((external_id, SKIP_DISABLED))
            continue
        if account_expired(identity.account_expires, now):
            report.skipped.append((external_id, SKIP_EXPIRED))
            continue
        username = normalize_login(identity.username)
        if not username:
            report.skipped.append((external_id, SKIP_NO_USERNAME))
            continue
        if not _USERNAME.fullmatch(username):
            report.skipped.append((external_id, SKIP_INVALID_LOGIN))
            continue
        if await login_in_use(db, username):
            report.skipped.append((external_id, SKIP_LOGIN_TAKEN))
            continue
        await _grantable(db, tenant_id, actor,
                         await mapped_group_ids(db, tenant_id, identity.group_dns))
        mail = normalize_login(identity.email) or None
        if mail is not None and (len(mail) > _EMAIL_MAX or await login_in_use(db, mail)):
            mail = None
        name = ((identity.display_name or "").strip() or identity.username)[:_NAME_MAX]
        user = User(username=username, email=mail, full_name=name, hashed_password=None,
                    auth_source=AUTH_LDAP, external_id=external_id, ldap_dn=identity.dn)
        db.add(user)
        await _flush(db, LOGIN_TAKEN)              # a concurrent create took the name
        db.add(TenantMembership(user_id=user.id, tenant_id=tenant_id, granted_by_id=actor.id))
        await db.flush()
        await sync_ldap_groups(db, user=user, tenant_id=tenant_id, group_dns=identity.group_dns)
        if extra_group_ids:
            await set_manual_groups(db, user=user, tenant_id=tenant_id,
                                    group_ids=extra_group_ids, granted_by_id=actor.id)
        existing.add(external_id)
        report.imported.append(Imported(external_id=external_id, user_id=user.id))
    return report


# ---------------------------------------------------------------- mappings (plan decision D13)
MAPPING_EXISTS = "Bu AD grubu bu gruba zaten eşlenmiş"
MAPPING_NOT_FOUND = "Mapping not found"
MAPPING_ADMIN_ONLY = "AD grup eşlemesini yalnız sistem yöneticisi değiştirebilir"


def _full_administrator(actor: Actor) -> None:
    """403 unless the caller holds the whole catalogue in this tenant (the system group; the
    rights `serialise` read under the lock). Checked before anything is looked up, so a refused
    caller learns nothing about the group or the mapping it named."""
    if not ALL_PERMISSIONS <= actor.perms:
        raise AdminError(403, MAPPING_ADMIN_ONLY)


async def list_mappings(db: AsyncSession,
                        tenant_id: uuid.UUID) -> list[tuple[LdapGroupMapping, Group]]:
    rows = await db.execute(
        select(LdapGroupMapping, Group).join(Group, Group.id == LdapGroupMapping.group_id)
        .where(LdapGroupMapping.tenant_id == tenant_id)
        .order_by(LdapGroupMapping.ad_group_dn, Group.slug))
    return [(mapping, group) for mapping, group in rows.all()]


async def create_mapping(db: AsyncSession, tenant_id: uuid.UUID, actor: Actor, *,
                         ad_group_dn: str, group_id: uuid.UUID) -> tuple[LdapGroupMapping, Group]:
    """AD group (DN) → this tenant's group. Only a full administrator (403 otherwise). The group
    must be this tenant's (422, as for any group named in a body) and within the caller's rights
    (403). The DN is stored in its canonical spelling (`canonical_dn`, what the sign-in compares
    AD's memberOf in; the body's validator has already refused a value that is not a DN), and
    another spelling of a DN already mapped to the group — a row stored before DNs were
    canonicalised included — is the 409 duplicate. It changes nobody now: each account picks it
    up at its next sign-in or token refresh, and at import."""
    _full_administrator(actor)
    group = (await db.execute(select(Group).where(
        Group.id == group_id, Group.tenant_id == tenant_id))).scalar_one_or_none()
    if group is None:
        raise AdminError(422, UNKNOWN_GROUP)
    _within(actor, group_rights(group))
    dn = canonical_dn(ad_group_dn)
    mapped = (await db.execute(select(LdapGroupMapping.ad_group_dn).where(
        LdapGroupMapping.tenant_id == tenant_id, LdapGroupMapping.group_id == group.id)
    )).scalars().all()
    if any(dn_key(stored) == dn for stored in mapped):
        raise AdminError(409, MAPPING_EXISTS)
    mapping = LdapGroupMapping(tenant_id=tenant_id, ad_group_dn=dn, group_id=group.id,
                               created_by_id=actor.id)
    db.add(mapping)
    await _flush(db, MAPPING_EXISTS)                 # a concurrent create took the row
    return mapping, group


@dataclass(frozen=True)
class RemovedMapping:
    ad_group_dn: str
    group_slug: str
    removed_from: tuple[str, ...]


async def delete_mapping(db: AsyncSession, tenant_id: uuid.UUID, actor: Actor,
                         mapping_id: uuid.UUID) -> RemovedMapping:
    """Remove the row AND, now, every `ldap`-sourced membership of its group in this tenant,
    retiring those users' tokens — also for users entitled to the group through another
    mapping, who get it back at their next sign-in or refresh (fail closed). Only a full
    administrator (403 otherwise, before the mapping is looked up); the group and every such
    member within the caller's rights (a deletion takes rights away from them, as a group edit
    would), then the local-administrator guard (409 only from some local administrators to
    none).

    The tenant's admin lock is taken FIRST, by this function itself (re-entrant: the router's
    `serialise` already holds it), before anything is read or deleted. A sign-in or refresh
    sync that read the mapping before this transaction commits, and decided to add its group,
    must then wait for the lock and decide again (`sync_ldap_groups`) — it cannot insert a row
    no mapping accounts for any more, which would linger until that user's next sync."""
    await lock_admin_guard(db, tenant_id)
    _full_administrator(actor)
    mapping = (await db.execute(select(LdapGroupMapping).where(
        LdapGroupMapping.id == mapping_id, LdapGroupMapping.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if mapping is None:
        raise AdminError(404, MAPPING_NOT_FOUND)
    group = await get_group(db, tenant_id, mapping.group_id, for_update=True)
    _within(actor, group_rights(group))
    link = aliased(UserGroup)
    holders = select(link.user_id).where(link.group_id == group.id, link.source == SOURCE_LDAP)
    for groups in (await _rights_by_user(db, tenant_id,
                                         UserGroup.user_id.in_(holders))).values():
        _within(actor, _union(groups))
    dn = mapping.ad_group_dn
    # The guard refuses only a deletion that takes the tenant from some active LOCAL
    # administrators to none, as the sign-in sync's does: in a tenant that has none already,
    # "none after" would hold for every deletion and freeze the mapping table.
    admins_before = await count_admins(db, tenant_id)
    await db.delete(mapping)
    removed = list((await db.execute(
        delete(UserGroup)
        .where(UserGroup.group_id == group.id, UserGroup.source == SOURCE_LDAP)
        .returning(UserGroup.user_id)
        .execution_options(synchronize_session=False))).scalars().all())
    if removed:
        await db.execute(
            update(User).where(User.id.in_(removed))
            .values(token_version=User.token_version + 1)
            .execution_options(synchronize_session=False))
    await db.flush()
    if admins_before > 0 and await count_admins(db, tenant_id) == 0:
        raise AdminError(409, LAST_ADMIN)
    names: list[str] = []
    if removed:
        names = list((await db.execute(select(User.username).where(User.id.in_(removed))
                                       .order_by(User.username))).scalars().all())
    return RemovedMapping(ad_group_dn=dn, group_slug=group.slug, removed_from=tuple(names))

"""The /admin/ldap logic (spec §7, "Import and mapping"). The same rules as the rest of /admin
(`admin/service.py`): the tenant lock first (`serialise`, which the router calls), nobody grants
beyond their own rights, and every change that can take administrator rights away ends with
`count_admins`, which counts LOCAL administrators only. Errors are AdminError; the router turns
them into HTTP and rolls back.

It borrows `admin/service.py`'s private helpers (`_within`, `_grantable`, `_rights_by_user`,
`_union`, `_flush`) on purpose: one implementation of the rights rule, not two."""
from __future__ import annotations

import time
import uuid
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admin.service import LOGIN_TAKEN, Actor, _flush, _grantable
from homunculus.auth.groups import set_manual_groups
from homunculus.auth.ldap import LdapIdentity, account_expired
from homunculus.auth.ldap_sync import login_in_use, mapped_group_ids, sync_ldap_groups
from homunculus.auth.models import AUTH_LDAP, TenantMembership, User
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
SKIP_EXISTS = "exists"
SKIP_NOT_FOUND = "not_found"
SKIP_DISABLED = "disabled"
SKIP_EXPIRED = "expired"
SKIP_LOGIN_TAKEN = "login_taken"
SKIP_NO_USERNAME = "no_username"
_USERNAME_MAX = 128    # users.username
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
    (`disabled`, `expired`), not created."""
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
        if not username or len(username) > _USERNAME_MAX:
            report.skipped.append((external_id, SKIP_NO_USERNAME))
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

"""What a directory sign-in writes (spec §7, "Sign-in for an AD user", steps 4–5): the account's
profile as AD has it now, and its AD-mapped groups.

  apply_directory_profile   full_name, email, ldap_dn from AD (plan decision D11)
  mapped_group_ids          the tenant's groups these AD group DNs map to
  sync_ldap_groups          make the account's `ldap` rows equal to the mapping; `manual` rows
                            are never touched (plan decision D10)
  login_in_use              whether a value is already some account's username or e-mail

The sync keeps the §6 guard: a removal that would take the tenant from some active LOCAL
administrators to none is rolled back in its savepoint and reported (`SyncOutcome.guarded`);
the rest of the transaction (the profile update the sign-in makes after the sync) stands. The
sync runs BEFORE the profile update: see the lock order in `sync_ldap_groups`. In a tenant that has no local administrator at
all, removals apply (there is no one left to keep) and a WARNING says the tenant needs one. The
caller writes the audit rows (actor LDAP_SYNC_ACTOR) after its commit.
"""
from __future__ import annotations

import logging
import uuid
from collections.abc import Iterable
from dataclasses import dataclass

from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.auth.groups import bump_user, count_admins, groups_of, lock_admin_guard
from homunculus.auth.ldap import LdapIdentity
from homunculus.auth.models import SOURCE_LDAP, Group, LdapGroupMapping, User, UserGroup
from homunculus.auth.service import normalize_login

logger = logging.getLogger(__name__)

LDAP_SYNC_ACTOR = "ldap-sync"
_EMAIL_MAX = 254       # users.email
_NAME_MAX = 200        # users.full_name


def normalise_dn(dn: str) -> str:
    """How a DN is stored in `ldap_group_mappings` and compared: trimmed, lower-cased."""
    return dn.strip().lower()


async def login_in_use(db: AsyncSession, value: str, *,
                       except_id: uuid.UUID | None = None) -> bool:
    """Whether `value` is already some account's username or e-mail (sign-in matches both)."""
    stmt = select(User.id).where(or_(User.username == value, User.email == value))
    if except_id is not None:
        stmt = stmt.where(User.id != except_id)
    return (await db.execute(stmt.limit(1))).first() is not None


async def apply_directory_profile(db: AsyncSession, user: User,
                                  identity: LdapIdentity) -> list[str]:
    """Spec §7 step 4: the account's name, e-mail and DN as AD has them now. Returns the fields
    that changed. `username` never changes. An AD `mail` that another account already uses as
    its username or e-mail is not copied (the old e-mail stays): a sign-in must not fail on a
    unique constraint. An account without `mail` in AD loses its e-mail here."""
    changed: list[str] = []
    name = (identity.display_name or "").strip()[:_NAME_MAX]
    if name and name != user.full_name:
        user.full_name = name
        changed.append("full_name")
    mail = normalize_login(identity.email) or None
    if mail != user.email and (mail is None or (
            len(mail) <= _EMAIL_MAX and not await login_in_use(db, mail, except_id=user.id))):
        user.email = mail
        changed.append("email")
    if identity.dn and identity.dn != user.ldap_dn:
        user.ldap_dn = identity.dn
        changed.append("ldap_dn")
    return changed


async def mapped_group_ids(db: AsyncSession, tenant_id: uuid.UUID,
                           group_dns: Iterable[str]) -> set[uuid.UUID]:
    """The tenant's groups that these AD group DNs map to (DNs compared lower-cased)."""
    dns = {normalise_dn(dn) for dn in group_dns if dn and dn.strip()}
    if not dns:
        return set()
    rows = await db.execute(select(LdapGroupMapping.group_id).where(
        LdapGroupMapping.tenant_id == tenant_id, LdapGroupMapping.ad_group_dn.in_(dns)))
    return set(rows.scalars().all())


@dataclass(frozen=True)
class SyncOutcome:
    """The account's groups in the tenant (slugs, manual and AD alike) before and after the
    sync, and the AD groups the administrator guard kept (their removal would have left the
    tenant without a LOCAL administrator)."""
    before: tuple[str, ...]
    after: tuple[str, ...]
    guarded: tuple[str, ...] = ()

    @property
    def changed(self) -> bool:
        return self.before != self.after


async def _slugs(db: AsyncSession, user_id: uuid.UUID, tenant_id: uuid.UUID) -> tuple[str, ...]:
    rows = await db.execute(
        select(Group.slug).join(UserGroup, UserGroup.group_id == Group.id)
        .where(UserGroup.user_id == user_id, Group.tenant_id == tenant_id)
        .order_by(Group.slug))
    return tuple(rows.scalars().all())


async def _difference(db: AsyncSession, user_id: uuid.UUID, tenant_id: uuid.UUID,
                      group_dns: Iterable[str]) -> tuple[set[uuid.UUID], set[uuid.UUID]]:
    """(groups to add as `ldap` rows, `ldap` rows to remove). A group the user already holds
    through a MANUAL row is left as it is (one row per user and group)."""
    target = await mapped_group_ids(db, tenant_id, group_dns)
    links = await groups_of(db, user_id, tenant_id)
    held_ldap = {link.group_id for link in links if link.source == SOURCE_LDAP}
    held_other = {link.group_id for link in links if link.source != SOURCE_LDAP}
    return target - held_ldap - held_other, held_ldap - target


async def sync_ldap_groups(db: AsyncSession, *, user: User, tenant_id: uuid.UUID,
                           group_dns: Iterable[str]) -> SyncOutcome:
    """Spec §7 step 5: the account's `ldap` rows in this tenant become the mapped set. Bumps
    the token version when something changed. Does not commit.

    Call it BEFORE changing the account's row in this transaction (the sign-in applies the
    profile after it): it may take the tenant's admin lock, and every writer takes that lock
    before the row. An UPDATE of `users` flushed first would hold the row while waiting for the
    lock — a deadlock against an /admin write that holds the lock and waits for the row."""
    group_dns = list(group_dns)
    await db.flush()          # anything pending stays outside the savepoint below
    user_id = user.id
    to_add, to_remove = await _difference(db, user_id, tenant_id, group_dns)
    if not to_add and not to_remove:
        current = await _slugs(db, user_id, tenant_id)
        return SyncOutcome(before=current, after=current)
    # Serialise with every /admin write of the tenant, and decide again under the lock: a
    # mapping deleted meanwhile must not be re-applied. The lock is taken BEFORE the savepoint:
    # a lock taken inside a savepoint is released when the savepoint is rolled back.
    await lock_admin_guard(db, tenant_id)
    to_add, to_remove = await _difference(db, user_id, tenant_id, group_dns)
    before = await _slugs(db, user_id, tenant_id)
    for group_id in sorted(to_add):
        db.add(UserGroup(user_id=user_id, group_id=group_id, source=SOURCE_LDAP))
    await db.flush()
    guarded: tuple[str, ...] = ()
    removed = False
    if to_remove:
        # The guard refuses only a removal that takes the tenant from some active LOCAL
        # administrators to none. `count_admins` counts local accounts only, so in a tenant
        # that has none already (the last one deactivated outside the API) "after == 0" would
        # hold for every removal, and every AD-side removal would be rolled back at every
        # sign-in and refresh — rights nobody can trace to AD would linger. There it applies.
        admins_before = await count_admins(db, tenant_id)
        savepoint = await db.begin_nested()
        # A Core DELETE: no ORM object changes inside the savepoint, so rolling it back leaves
        # nothing stale in the session.
        await db.execute(
            delete(UserGroup)
            .where(UserGroup.user_id == user_id, UserGroup.group_id.in_(to_remove),
                   UserGroup.source == SOURCE_LDAP)
            .execution_options(synchronize_session=False))
        if admins_before > 0 and await count_admins(db, tenant_id) == 0:
            await savepoint.rollback()
            guarded = tuple(sorted((await db.execute(
                select(Group.slug).where(Group.id.in_(to_remove)))).scalars().all()))
        else:
            await savepoint.commit()
            removed = True
            if admins_before == 0:
                logger.warning(
                    "tenant %s has no active local administrator: AD group removals for user "
                    "%s applied without the administrator guard. Restore a local "
                    "hospital_admin account so an AD outage cannot lock administration out.",
                    tenant_id, user_id)
    if to_add or removed:
        await bump_user(db, user)
    return SyncOutcome(before=before, after=await _slugs(db, user_id, tenant_id),
                       guarded=guarded)

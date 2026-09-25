"""Group persistence: seeding the defaults, a user's groups, manual membership, token-version
bumps, the administrator count that guards the last admin, a user's tenant, and the check of a
token's tenant claim (`resolve_tenant_claim`).

Pure decisions (union of permissions, which tenant wins) are in `permissions.py` and
`api/identity.py`; this module is the part that touches the database.
"""
from __future__ import annotations

import uuid
from collections.abc import Iterable
from dataclasses import dataclass

from sqlalchemy import Select, and_, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import set_committed_value

from homunculus.api.identity import hospital_for_slugs
from homunculus.auth.models import (
    AUTH_LOCAL, SOURCE_MANUAL, Group, GroupPermission, TenantMembership, User, UserGroup,
)
from homunculus.auth.permissions import ALL_PERMISSIONS, DEFAULT_GROUPS, effective_permissions
from homunculus.tenant.models import Tenant


class GroupError(ValueError):
    """A group operation that cannot be carried out (unknown group, wrong tenant)."""


@dataclass(frozen=True)
class GroupSummary:
    slugs: tuple[str, ...]
    names: tuple[str, ...]
    perms: frozenset[str]
    mfa_required: bool


@dataclass(frozen=True)
class TenantRef:
    id: uuid.UUID
    slug: str


async def ensure_default_groups(db: AsyncSession, tenant_id: uuid.UUID) -> dict[str, Group]:
    """Create any default group this tenant is missing. Idempotent. Returns every group of the
    tenant (custom ones too) keyed by slug. Not safe against a concurrent call for the same
    tenant — callers are tenant creation (fresh id) and the single-process boot seed."""
    result = await db.execute(select(Group).where(Group.tenant_id == tenant_id))
    existing = {g.slug: g for g in result.scalars().all()}
    for spec in DEFAULT_GROUPS:
        if spec["slug"] in existing:
            continue
        group = Group(
            tenant_id=tenant_id, slug=spec["slug"], name=spec["name"],
            description=spec["description"], mfa_required=spec["mfa_required"],
            is_system=spec["is_system"],
        )
        group.permissions = [GroupPermission(permission=p) for p in spec["permissions"]]
        db.add(group)
        existing[spec["slug"]] = group
    await db.flush()
    return existing


async def groups_of(db: AsyncSession, user_id: uuid.UUID, tenant_id: uuid.UUID) -> list[UserGroup]:
    """The user's group links in one tenant, with `link.group` loaded."""
    stmt = (
        select(UserGroup)
        .join(Group, Group.id == UserGroup.group_id)
        .where(UserGroup.user_id == user_id, Group.tenant_id == tenant_id)
    )
    return list((await db.execute(stmt)).scalars().all())


def summarize(links: Iterable[UserGroup]) -> GroupSummary:
    """What a token is minted from. A SYSTEM group grants the whole catalogue by rule, so an
    administrator never falls behind a catalogue that grew after the tenant was seeded."""
    groups = sorted((link.group for link in links), key=lambda g: g.slug)
    if any(g.is_system for g in groups):
        perms = ALL_PERMISSIONS
    else:
        # Intersected with ALL_PERMISSIONS so a key retired from the catalogue, but still sitting
        # in a group's rows from before it was retired, never reaches a token.
        perms = effective_permissions(g.permission_keys for g in groups) & ALL_PERMISSIONS
    return GroupSummary(
        slugs=tuple(g.slug for g in groups),
        names=tuple(g.name for g in groups),
        perms=perms,
        mfa_required=any(g.mfa_required for g in groups),
    )


async def bump_user(db: AsyncSession, user: User) -> int:
    """Increment the user's token_version IN SQL and keep the loaded object in step. A
    Python-side `+= 1` loses a bump when the in-memory value is stale (e.g. after
    `bump_group_members`), and races with a concurrent edit; this cannot."""
    tv = (await db.execute(
        update(User).where(User.id == user.id)
        .values(token_version=User.token_version + 1)
        .returning(User.token_version)
        .execution_options(synchronize_session=False)
    )).scalar_one()
    set_committed_value(user, "token_version", tv)
    return tv


async def set_manual_groups(
    db: AsyncSession, *, user: User, tenant_id: uuid.UUID,
    group_ids: Iterable[uuid.UUID], granted_by_id: uuid.UUID | None,
) -> list[UserGroup]:
    """Make the user's MANUAL memberships in this tenant exactly `group_ids`. LDAP-sourced rows
    are never touched here: a group held through the AD mapping stays that single row, and
    requesting it manually is a no-op — the primary key is (user_id, group_id), so inserting a
    second, manual row for the same group would violate it. Bumps the user's token version,
    unless nothing actually changed."""
    wanted = set(group_ids)
    if wanted:
        rows = (await db.execute(
            select(Group.id).where(Group.tenant_id == tenant_id, Group.id.in_(wanted))
        )).scalars().all()
        if set(rows) != wanted:
            raise GroupError("unknown group for this tenant")
    current = await groups_of(db, user.id, tenant_id)
    manual = {link.group_id: link for link in current if link.source == SOURCE_MANUAL}
    held_otherwise = {link.group_id for link in current if link.source != SOURCE_MANUAL}
    to_delete = [link for gid, link in manual.items() if gid not in wanted]
    to_add = wanted - set(manual) - held_otherwise
    if not to_delete and not to_add:
        return current
    for link in to_delete:
        await db.delete(link)
    for group_id in to_add:
        db.add(UserGroup(user_id=user.id, group_id=group_id, source=SOURCE_MANUAL,
                         granted_by_id=granted_by_id))
    await db.flush()
    await bump_user(db, user)
    return await groups_of(db, user.id, tenant_id)


async def bump_group_members(db: AsyncSession, group_id: uuid.UUID) -> int:
    """Invalidate every member's access tokens after the group itself changed. User objects
    already loaded in this session keep their old token_version; re-read them if you need the
    value."""
    members = select(UserGroup.user_id).where(UserGroup.group_id == group_id)
    result = await db.execute(
        update(User).where(User.id.in_(members)).values(token_version=User.token_version + 1)
        .execution_options(synchronize_session=False)
    )
    return result.rowcount or 0


def _holds(tenant_id: uuid.UUID, permission: str):
    """EXISTS: the outer User has `permission` through some group of the tenant. A system group
    counts for every permission, matching the rule in `summarize`."""
    stmt = (
        select(UserGroup.user_id)
        .join(Group, Group.id == UserGroup.group_id)
        .outerjoin(GroupPermission, GroupPermission.group_id == Group.id)
        .where(UserGroup.user_id == User.id, Group.tenant_id == tenant_id,
               (GroupPermission.permission == permission) | (Group.is_system == True))  # noqa: E712
    )
    return stmt.exists()


async def lock_admin_guard(db: AsyncSession, tenant_id: uuid.UUID) -> None:
    """Take the tenant's admin-guard lock: a transaction-scoped advisory lock, held until the
    caller commits or rolls back. Re-entrant within one transaction (Postgres stacks it), so a
    caller that already holds it may still call `count_admins`. The /admin API takes it at the
    start of every write, so writes to one tenant's users and groups run one at a time."""
    await db.execute(select(func.pg_advisory_xact_lock(
        func.hashtextextended(f"homunculus.admin-guard:{tenant_id}", 0))))


async def count_admins(db: AsyncSession, tenant_id: uuid.UUID) -> int:
    """Active LOCAL ADMINISTRATORS of the tenant: local accounts with a password, holding both
    `users.manage` and `groups.manage` through any of their groups, with an active membership in
    this tenant. The last one is protected (spec §6).

    Local only: an administrator who signs in through the directory is of no use while the
    directory is down, and local accounts exist precisely so that an AD outage never locks the
    hospital out of administration. An AD administrator therefore never counts toward the guard.

    Call this AFTER applying the change you want to guard, in the same transaction: it takes a
    per-tenant advisory lock so two concurrent demotions cannot both see the guard pass, and
    holds it until the caller commits or rolls back — under READ COMMITTED the count then sees
    the other transaction's committed change. Roll back on 0."""
    await lock_admin_guard(db, tenant_id)
    stmt = (
        select(func.count(User.id))
        .where(User.is_active == True)  # noqa: E712
        .where(User.auth_source == AUTH_LOCAL, User.hashed_password.is_not(None))
        .where(_holds(tenant_id, "users.manage"))
        .where(_holds(tenant_id, "groups.manage"))
        .where(select(TenantMembership.id).where(
            TenantMembership.user_id == User.id, TenantMembership.tenant_id == tenant_id,
            TenantMembership.is_active == True).exists())  # noqa: E712
    )
    return int((await db.execute(stmt)).scalar_one())


async def tenant_of_user(db: AsyncSession, user_id: uuid.UUID) -> TenantRef | None:
    """The tenant a user's session runs in: the lowest slug among active memberships in active
    tenants — the same deterministic rule the board resolver applied per request until now."""
    rows = (await db.execute(
        select(Tenant.id, Tenant.slug)
        .join(TenantMembership, TenantMembership.tenant_id == Tenant.id)
        .where(TenantMembership.user_id == user_id,
               TenantMembership.is_active == True,  # noqa: E712
               Tenant.is_active == True)  # noqa: E712
    )).all()
    slug = hospital_for_slugs([row.slug for row in rows])
    if slug is None:
        return None
    return next(TenantRef(id=row.id, slug=row.slug) for row in rows if row.slug == slug)


# ---------------------------------------------------------------- the tenant claim
TENANT_OK = "ok"              # an active tenant the user holds an active membership in
TENANT_UNKNOWN = "unknown"    # no tenant with that slug, or the user was never a member of it
TENANT_INACTIVE = "inactive"  # the tenant, or the user's membership in it, is deactivated


def tenant_claim_query(user_id: uuid.UUID, slug: str) -> Select:
    """ONE query behind every check of a token's `tenant` claim: the slug's tenant, whether it
    is active, and whether `user_id` holds an active membership in it. At most one row (slugs
    are unique); none when no tenant has the slug. `member_active` is NULL when the user has no
    membership row there, True when any membership row is active, else False.

    Exposed so a caller that already runs its own per-request query (the board resolver, Task 9)
    can embed the same condition instead of copying it; read the row with `tenant_claim_verdict`."""
    return (
        select(Tenant.id.label("tenant_id"),
               Tenant.is_active.label("tenant_active"),
               func.bool_or(TenantMembership.is_active).label("member_active"))
        .outerjoin(TenantMembership, and_(TenantMembership.tenant_id == Tenant.id,
                                          TenantMembership.user_id == user_id))
        .where(Tenant.slug == slug)
        .group_by(Tenant.id, Tenant.is_active)
    )


def tenant_claim_verdict(row) -> tuple[uuid.UUID | None, str]:
    """Read a `tenant_claim_query` row (or None): `(tenant_id, TENANT_OK)`,
    `(None, TENANT_UNKNOWN)` or `(None, TENANT_INACTIVE)`."""
    if row is None or row.member_active is None:
        return None, TENANT_UNKNOWN
    if not row.tenant_active or not row.member_active:
        return None, TENANT_INACTIVE
    return row.tenant_id, TENANT_OK


async def resolve_tenant_claim(
    db: AsyncSession, user_id: uuid.UUID, slug: str,
) -> tuple[uuid.UUID | None, str]:
    """Check a token's `tenant` claim against the database, in one query (spec §5: the claim is
    not trusted by name alone). The signature proves who minted the token, but within its hour a
    slug can be renamed and reused by another tenant, a tenant can be deactivated, and a
    membership can be deactivated.

    Returns:
      (tenant_id, "ok")    the slug names an ACTIVE tenant in which the user holds an ACTIVE
                           membership — act in `tenant_id`.
      (None, "unknown")    no tenant has the slug, or the user has no membership in it (a renamed
                           slug, perhaps reused by another tenant). Answer 401: the client's
                           refresh mints a token carrying the current slug.
      (None, "inactive")   the tenant or the user's membership in it is deactivated. Answer 403.

    Used by `auth.dependencies.caller_tenant_id` on every admission, escalation and structure
    request; the board resolver (Task 9) applies the same condition."""
    row = (await db.execute(tenant_claim_query(user_id, slug))).first()
    return tenant_claim_verdict(row)

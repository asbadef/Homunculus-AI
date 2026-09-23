"""Group persistence: seeding the defaults, a user's groups, manual membership, token-version
bumps, the administrator count that guards the last admin, and a user's tenant.

Pure decisions (union of permissions, which tenant wins) are in `permissions.py` and
`api/identity.py`; this module is the part that touches the database.
"""
from __future__ import annotations

import uuid
from collections.abc import Iterable
from dataclasses import dataclass

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import set_committed_value

from homunculus.api.identity import hospital_for_slugs
from homunculus.auth.models import (
    SOURCE_MANUAL, Group, GroupPermission, TenantMembership, User, UserGroup,
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


async def count_admins(db: AsyncSession, tenant_id: uuid.UUID) -> int:
    """Active ADMINISTRATORS of the tenant: users holding both `users.manage` and
    `groups.manage`, through any of their groups, with an active membership in this tenant.
    The last one is protected (spec §6).

    Call this AFTER applying the change you want to guard, in the same transaction: it takes a
    per-tenant advisory lock so two concurrent demotions cannot both see the guard pass, and
    holds it until the caller commits or rolls back — under READ COMMITTED the count then sees
    the other transaction's committed change. Roll back on 0."""
    await db.execute(select(func.pg_advisory_xact_lock(
        func.hashtextextended(f"homunculus.admin-guard:{tenant_id}", 0))))
    stmt = (
        select(func.count(User.id))
        .where(User.is_active == True)  # noqa: E712
        .where(_holds(tenant_id, "users.manage"))
        .where(_holds(tenant_id, "groups.manage"))
        .where(select(TenantMembership.id).where(
            TenantMembership.user_id == User.id, TenantMembership.tenant_id == tenant_id,
            TenantMembership.is_active == True).exists())  # noqa: E712
    )
    return int((await db.execute(stmt)).scalar_one())


async def tenant_of_user(db: AsyncSession, user_id: uuid.UUID) -> TenantRef | None:
    """The tenant a user's session runs in: the lowest slug among active memberships — the
    same deterministic rule the board resolver applied per request until now."""
    rows = (await db.execute(
        select(Tenant.id, Tenant.slug)
        .join(TenantMembership, TenantMembership.tenant_id == Tenant.id)
        .where(TenantMembership.user_id == user_id,
               TenantMembership.is_active == True)  # noqa: E712
    )).all()
    slug = hospital_for_slugs([row.slug for row in rows])
    if slug is None:
        return None
    return next(TenantRef(id=row.id, slug=row.slug) for row in rows if row.slug == slug)

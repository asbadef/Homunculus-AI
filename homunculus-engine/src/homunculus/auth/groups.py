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
    """Create any default group this tenant is missing. Idempotent. Returns slug -> Group."""
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
        perms = effective_permissions(g.permission_keys for g in groups)
    return GroupSummary(
        slugs=tuple(g.slug for g in groups),
        names=tuple(g.name for g in groups),
        perms=perms,
        mfa_required=any(g.mfa_required for g in groups),
    )


async def set_manual_groups(
    db: AsyncSession, *, user: User, tenant_id: uuid.UUID,
    group_ids: Iterable[uuid.UUID], granted_by_id: uuid.UUID | None,
) -> list[UserGroup]:
    """Make the user's MANUAL memberships in this tenant exactly `group_ids`. LDAP-sourced rows
    are never touched here. Bumps the user's token version."""
    wanted = set(group_ids)
    if wanted:
        rows = (await db.execute(
            select(Group.id).where(Group.tenant_id == tenant_id, Group.id.in_(wanted))
        )).scalars().all()
        if set(rows) != wanted:
            raise GroupError("unknown group for this tenant")
    current = await groups_of(db, user.id, tenant_id)
    manual = {link.group_id: link for link in current if link.source == SOURCE_MANUAL}
    for group_id, link in manual.items():
        if group_id not in wanted:
            await db.delete(link)
    for group_id in wanted - set(manual):
        db.add(UserGroup(user_id=user.id, group_id=group_id, source=SOURCE_MANUAL,
                         granted_by_id=granted_by_id))
    user.token_version += 1
    await db.flush()
    return await groups_of(db, user.id, tenant_id)


async def bump_group_members(db: AsyncSession, group_id: uuid.UUID) -> int:
    """Invalidate every member's access tokens after the group itself changed."""
    members = select(UserGroup.user_id).where(UserGroup.group_id == group_id)
    result = await db.execute(
        update(User).where(User.id.in_(members)).values(token_version=User.token_version + 1)
        .execution_options(synchronize_session=False)
    )
    return result.rowcount or 0


def _holds(tenant_id: uuid.UUID, permission: str, excluding_group_id: uuid.UUID | None):
    """EXISTS: the outer User has `permission` through some group of the tenant. A system group
    counts for every permission, matching the rule in `summarize`."""
    stmt = (
        select(UserGroup.user_id)
        .join(Group, Group.id == UserGroup.group_id)
        .outerjoin(GroupPermission, GroupPermission.group_id == Group.id)
        .where(UserGroup.user_id == User.id, Group.tenant_id == tenant_id,
               (GroupPermission.permission == permission) | (Group.is_system == True))  # noqa: E712
    )
    if excluding_group_id is not None:
        stmt = stmt.where(Group.id != excluding_group_id)
    return stmt.exists()


async def count_admins(
    db: AsyncSession, tenant_id: uuid.UUID, *,
    excluding_user_id: uuid.UUID | None = None, excluding_group_id: uuid.UUID | None = None,
) -> int:
    """Active ADMINISTRATORS of the tenant: users holding both `users.manage` and
    `groups.manage`, through any of their groups. The last one is protected (spec §6)."""
    stmt = (
        select(func.count(User.id))
        .where(User.is_active == True)  # noqa: E712
        .where(_holds(tenant_id, "users.manage", excluding_group_id))
        .where(_holds(tenant_id, "groups.manage", excluding_group_id))
    )
    if excluding_user_id is not None:
        stmt = stmt.where(User.id != excluding_user_id)
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

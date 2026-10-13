"""Reading and writing staff scope.

Kept apart from the router so the board path — which needs to read a scope on every request and
has no FastAPI dependency graph to lean on — can call the same function the API does. Two
implementations of "what may this user see" would be the NEWS2 mistake again, one number under
two names.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission.models import Admission, CareTeamMember
from homunculus.auth.models import Group, TenantMembership, User, UserGroup
from homunculus.scope.models import StaffScope


async def read_grants(db: AsyncSession, user_id: uuid.UUID,
                      tenant_id: uuid.UUID) -> list[StaffScope]:
    """This user's active grants in one tenant, newest last.

    Per tenant because unit and bed ids are plain strings: a grant in another hospital must not
    narrow (or widen) this hospital's board.
    """
    result = await db.execute(
        select(StaffScope)
        .where(StaffScope.user_id == user_id, StaffScope.tenant_id == tenant_id,
               StaffScope.is_active == True)  # noqa: E712
        .order_by(StaffScope.created_at)
    )
    return list(result.scalars().all())


async def read_all_grants(db: AsyncSession, user_id: uuid.UUID,
                          tenant_id: uuid.UUID) -> list[StaffScope]:
    """Every grant this user has ever held in this tenant, revoked ones included.

    The administrator's screen shows only the active ones; an inspection asks about the rest.
    """
    result = await db.execute(
        select(StaffScope)
        .where(StaffScope.user_id == user_id, StaffScope.tenant_id == tenant_id)
        .order_by(StaffScope.created_at)
    )
    return list(result.scalars().all())


async def read_role(db: AsyncSession, user_id: uuid.UUID, tenant_id: uuid.UUID) -> str | None:
    """The user's scope class IN THIS TENANT: HOSPITAL_ADMIN, PLATFORM_SUPPORT, MEMBER or None.

    Needs an active account and an active membership in `tenant_id`; otherwise None. Callers
    must not treat None as "unassigned": the resolver maps it to UNKNOWN (sees nothing).
    HOSPITAL_ADMIN = member of that tenant's system group (`is_system`); PLATFORM_SUPPORT = the
    platform-operator flag. A legacy PLATFORM_SUPPORT *membership* became the `platform_support`
    group (migration 0010) and reads as MEMBER; that group does not carry `board.view`.
    """
    from homunculus.auth.models import Group, UserGroup

    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        return None
    member = (await db.execute(
        select(TenantMembership.id).where(
            TenantMembership.user_id == user_id, TenantMembership.tenant_id == tenant_id,
            TenantMembership.is_active.is_(True)).limit(1)
    )).first()
    if member is None:
        return None
    if user.is_platform_support:
        return "PLATFORM_SUPPORT"
    admin = (await db.execute(
        select(UserGroup.user_id).join(Group, Group.id == UserGroup.group_id).where(
            UserGroup.user_id == user_id, Group.tenant_id == tenant_id,
            Group.is_system.is_(True)).limit(1)
    )).first()
    return "HOSPITAL_ADMIN" if admin else "MEMBER"


async def read_own_patient_ids(
    db: AsyncSession, user_id: uuid.UUID, tenant_id: uuid.UUID, *, now: datetime | None = None
) -> list[str]:
    """Patients whose care team names this user, in the identifier the board uses.

    The board keys a patient by the hospital's own identifier — the value that arrives in the
    ADT's PID segment — and here that is `Patient.his_patient_reference`. It cannot be filtered
    in SQL because it is encrypted at rest, so it is selected and compared in Python; that is
    why this returns a list rather than a subquery.

    ⚠️ **This rule is only as good as that column.** An admission created without a HIS
    reference produces no identifier to match, so its care team gets no own-patient exemption
    and the clinician sees that patient only if their unit or bed grant reaches them. That is a
    gap in the admission path, not here, and it is silent by nature — which is why the caller
    publishes `own_patients` as a count the screen can show.

    An ON-CALL link carries a window (§3.3). A window that has closed is not coverage, so an
    expired row grants nothing; `is_active` alone would keep yesterday's on-call physician
    looking at a patient they handed over.
    """
    from homunculus.admission.models import Patient

    moment = now or datetime.now(timezone.utc)
    result = await db.execute(
        select(Patient.his_patient_reference,
               CareTeamMember.window_start, CareTeamMember.window_end)
        .select_from(CareTeamMember)
        .join(Admission, CareTeamMember.admission_id == Admission.id)
        .join(Patient, Admission.patient_id == Patient.id)
        .where(
            CareTeamMember.user_id == user_id,
            CareTeamMember.is_active == True,  # noqa: E712
            Admission.tenant_id == tenant_id,
            Patient.tenant_id == tenant_id,
        )
    )
    return [ref for ref, start, end in result.all()
            if ref and _window_open(start, end, moment)]


def _window_open(start: datetime | None, end: datetime | None, now: datetime) -> bool:
    """Whether a time-boxed care-team link is in force. No window means permanent."""
    if start is not None and now < start:
        return False
    return not (end is not None and now > end)


def grant_pairs(grants) -> set[tuple[str, str]]:
    """Grants as the set of (unit_id, bed_id) pairs they name, each stripped as `replace_grants`
    stores it: what a scope write's expectation and the stored scope are compared as. Takes the
    stored rows and a body's `ScopeGrantIn`s alike — both carry the two strings. A set, because the
    order a screen listed them in and a repeated entry say nothing about what it read."""
    return {(g.unit_id.strip(), g.bed_id.strip()) for g in grants}


async def replace_grants(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    grants: list[tuple[str, str]],
    granted_by_id: uuid.UUID | None,
) -> list[StaffScope]:
    """Make this user's active scope exactly `grants` — a list of (unit_id, bed_id) pairs.

    Existing rows are revoked, not deleted. "This physician's access to the NICU was removed on
    the 14th" is a fact an inspection can ask about, and a deleted row cannot answer it. A grant
    that survives the replacement keeps its original row, so its `created_at` still says when
    that door was actually opened rather than when the form was last saved.
    """
    now = datetime.now(timezone.utc)
    wanted = {(u.strip(), b.strip()) for u, b in grants}
    existing = await read_grants(db, user_id, tenant_id)

    kept: list[StaffScope] = []
    for row in existing:
        if (row.unit_id, row.bed_id) in wanted:
            kept.append(row)
            wanted.discard((row.unit_id, row.bed_id))
        else:
            row.is_active = False
            row.revoked_at = now

    for unit_id, bed_id in sorted(wanted):
        row = StaffScope(tenant_id=tenant_id, user_id=user_id, unit_id=unit_id, bed_id=bed_id,
                         granted_by_id=granted_by_id)
        db.add(row)
        kept.append(row)

    await db.commit()
    return await read_grants(db, user_id, tenant_id)


async def count_unassigned(db: AsyncSession, tenant_id: uuid.UUID) -> int:
    """How many active members of this tenant hold no scope at all — AND would need one.

    The number the administrator's screen needs in order to know there is work here. Without it,
    "everyone sees everything because nobody has been assigned" is indistinguishable from
    "everyone sees everything because that is the policy".

    A member whose scope is unrestricted BY ROLE is not counted: a hospital administrator (the
    tenant's system group) or a platform operator needs no grant and `build_scope` gives them the
    whole board before it looks at grants (`SCOPE_UNRESTRICTED_ROLES`). Counting them made this
    number read "1" forever on a pilot with one administrator — a permanent "there is work here"
    about a person for whom there is none, on the one figure that exists to say whether the scope
    table has ever been filled in.
    """
    unrestricted = (
        select(UserGroup.user_id)
        .join(Group, UserGroup.group_id == Group.id)
        .where(Group.tenant_id == tenant_id, Group.is_system == True)  # noqa: E712
    )
    members = await db.execute(
        select(TenantMembership.user_id)
        .select_from(TenantMembership)
        .join(User, TenantMembership.user_id == User.id)
        .where(
            TenantMembership.tenant_id == tenant_id,
            TenantMembership.is_active == True,  # noqa: E712
            User.is_active == True,  # noqa: E712
            User.is_platform_support == False,  # noqa: E712
            TenantMembership.user_id.not_in(unrestricted),
        )
    )
    member_ids = {row[0] for row in members.all()}
    if not member_ids:
        return 0
    scoped = await db.execute(
        select(StaffScope.user_id).where(
            StaffScope.tenant_id == tenant_id,
            StaffScope.is_active == True,  # noqa: E712
        )
    )
    return len(member_ids - {row[0] for row in scoped.all()})

"""
Tenant isolation lookups (spec §5 "Tenant isolation", plan Task 7b).

A permission is held in ONE tenant, the token's `tenant` claim (`auth.dependencies.caller_tenant_id`
resolves it to an id). The admission, escalation and structure routers use these helpers to act on
that tenant's objects only:

* `tenant_of_<kind>(db, id)` returns the id of the tenant that owns the object, or None when there
  is no such object. A route compares it with the caller's tenant through `ensure_owned`, so an
  object of another tenant and a missing one take the SAME line and get the SAME 404: the answer
  never confirms that an id exists elsewhere.
* `ensure_admissions` checks a whole list of admission ids in one query (a handover's
  `admission_ids`).
* `ensure_members` checks that every user named in a payload holds an active membership in the
  caller's tenant, in one query, and answers 422 otherwise.

Every check runs before the route writes anything.

PHI RULE: ids only; no patient data is read here.
"""
from __future__ import annotations

import uuid
from collections.abc import Iterable

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission.models import Admission, Handover, Patient
from homunculus.auth.models import TenantMembership
from homunculus.tenant.models import Bed, Room, Site, Unit

NOT_A_MEMBER = "Kullanıcı bu kurumun üyesi değil"


async def _scalar(db: AsyncSession, stmt) -> uuid.UUID | None:
    return (await db.execute(stmt)).scalar_one_or_none()


# ---------------------------------------------------------------- who owns what
async def tenant_of_site(db: AsyncSession, site_id: uuid.UUID) -> uuid.UUID | None:
    return await _scalar(db, select(Site.tenant_id).where(Site.id == site_id))


async def tenant_of_unit(db: AsyncSession, unit_id: uuid.UUID) -> uuid.UUID | None:
    return await _scalar(db, select(Site.tenant_id)
                         .join(Unit, Unit.site_id == Site.id)
                         .where(Unit.id == unit_id))


async def tenant_of_room(db: AsyncSession, room_id: uuid.UUID) -> uuid.UUID | None:
    return await _scalar(db, select(Site.tenant_id)
                         .join(Unit, Unit.site_id == Site.id)
                         .join(Room, Room.unit_id == Unit.id)
                         .where(Room.id == room_id))


async def tenant_of_bed(db: AsyncSession, bed_id: uuid.UUID) -> uuid.UUID | None:
    return await _scalar(db, select(Site.tenant_id)
                         .join(Unit, Unit.site_id == Site.id)
                         .join(Room, Room.unit_id == Unit.id)
                         .join(Bed, Bed.room_id == Room.id)
                         .where(Bed.id == bed_id))


async def tenant_of_patient(db: AsyncSession, patient_id: uuid.UUID) -> uuid.UUID | None:
    return await _scalar(db, select(Patient.tenant_id).where(Patient.id == patient_id))


async def tenant_of_admission(db: AsyncSession, admission_id: uuid.UUID) -> uuid.UUID | None:
    return await _scalar(db, select(Admission.tenant_id).where(Admission.id == admission_id))


async def tenant_of_handover(db: AsyncSession, handover_id: uuid.UUID) -> uuid.UUID | None:
    """A handover has no tenant column: it belongs to its unit's tenant."""
    return await _scalar(db, select(Site.tenant_id)
                         .join(Unit, Unit.site_id == Site.id)
                         .join(Handover, Handover.unit_id == Unit.id)
                         .where(Handover.id == handover_id))


# ---------------------------------------------------------------- the checks
def ensure_owned(owner: uuid.UUID | None, tenant_id: uuid.UUID, detail: str) -> None:
    """404 unless the object's owner is the caller's tenant. `owner` is None for a missing
    object, so a missing object and another tenant's one get the same answer."""
    if owner != tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


async def ensure_admissions(
    db: AsyncSession, tenant_id: uuid.UUID, admission_ids: Iterable[uuid.UUID], detail: str,
) -> None:
    """404 unless every id names an admission of the caller's tenant. One query for the list."""
    wanted = set(admission_ids)
    if not wanted:
        return
    found = set((await db.execute(
        select(Admission.id).where(Admission.id.in_(wanted), Admission.tenant_id == tenant_id)
    )).scalars())
    if found != wanted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


async def ensure_members(
    db: AsyncSession, tenant_id: uuid.UUID, user_ids: Iterable[uuid.UUID | None],
) -> None:
    """422 unless every user named holds an ACTIVE membership in the caller's tenant (None
    entries — an optional field left empty — are skipped). One query for all of them."""
    wanted = {user_id for user_id in user_ids if user_id is not None}
    if not wanted:
        return
    found = set((await db.execute(
        select(TenantMembership.user_id).where(
            TenantMembership.tenant_id == tenant_id,
            TenantMembership.is_active == True,  # noqa: E712
            TenantMembership.user_id.in_(wanted),
        )
    )).scalars())
    if wanted - found:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=NOT_A_MEMBER)

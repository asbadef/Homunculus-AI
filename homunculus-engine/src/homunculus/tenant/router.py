"""
Tenant hierarchy API routes (Tenant → Site → Unit → Room → Bed).
Design doc §1.1 – §1.3.

Structural configuration is guarded by the `structure.manage` permission (held by the
`hospital_admin` group by default), on reads as well as mutations. Bed state transitions are
validated against the bed lifecycle state machine (§1.3).

Tenant isolation (spec §5): every route acts on the caller's own tenant only (`caller_tenant_id`,
the token's `tenant` claim). A tenant, site, unit, room or bed of another tenant named in the path
is a 404 identical to a missing one, and a list under it is refused the same way (see
tenant/scope.py). `GET /tenant/tenants` lists the caller's own tenant; a platform operator sees
every tenant. Creating a tenant is a platform operator's action alone
(`require_platform_operator`): a tenant a hospital administrator created would have no members
and could not be administered through `/admin`. Its first administrator comes from
`scripts/seed_admin.py`.

PHI RULE: infrastructure only — no patient data.
"""
from __future__ import annotations
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.auth.dependencies import (
    caller_tenant_id, require_permission, require_platform_operator,
)
from homunculus.auth.groups import ensure_default_groups
from homunculus.auth.models import User
from homunculus.db import get_db
from homunculus.tenant import scope
from homunculus.tenant.models import Bed, Room, Site, Tenant, Unit
from homunculus.tenant.schemas import (
    BedCreate, BedResponse, BedStateTransitionRequest,
    RoomCreate, RoomResponse, SiteCreate, SiteResponse,
    TenantCreate, TenantResponse, UnitCreate, UnitResponse,
)

router = APIRouter(prefix="/tenant", tags=["tenant"])

# The physical hierarchy is configured by whoever holds structure.manage (hospital_admin by
# default). Mutations AND reads: the tree names units and beds, which is operational data.
_admin = Depends(require_permission("structure.manage"))
# ... and only inside the caller's own tenant (the token's `tenant` claim).
_tenant = Depends(caller_tenant_id)


async def _get_or_404(db: AsyncSession, model, obj_id: uuid.UUID, name: str):
    obj = await db.get(model, obj_id)
    if obj is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{name} not found")
    return obj


# ---------------------------------------------------------------- Tenants
@router.post("/tenants", response_model=TenantResponse, status_code=status.HTTP_201_CREATED,
             summary="Create a tenant (hospital) — platform operators only")
async def create_tenant(
    body: TenantCreate, db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_platform_operator),
) -> TenantResponse:
    taken = HTTPException(status_code=status.HTTP_409_CONFLICT,
                          detail=f"A tenant with slug {body.slug!r} already exists")
    if (await db.execute(select(Tenant.id).where(Tenant.slug == body.slug))).first():
        raise taken
    tenant = Tenant(
        name=body.name, slug=body.slug,
        country_code=body.country_code, timezone=body.timezone,
    )
    db.add(tenant)
    try:
        await db.flush()
    except IntegrityError:
        # A concurrent request took the slug between the check and the insert.
        await db.rollback()
        raise taken from None
    # A tenant without its default groups could never be administered.
    await ensure_default_groups(db, tenant.id)
    await db.commit()
    await db.refresh(tenant)
    return TenantResponse.model_validate(tenant)


@router.get("/tenants", response_model=list[TenantResponse], summary="List tenants")
async def list_tenants(
    db: AsyncSession = Depends(get_db), user: User = _admin,
    caller_tenant: uuid.UUID = _tenant,
) -> list[TenantResponse]:
    """The caller's own tenant; a platform operator sees every tenant."""
    stmt = select(Tenant)
    if not user.is_platform_support:
        stmt = stmt.where(Tenant.id == caller_tenant)
    result = await db.execute(stmt)
    return [TenantResponse.model_validate(t) for t in result.scalars().all()]


# ---------------------------------------------------------------- Sites
@router.post("/tenants/{tenant_id}/sites", response_model=SiteResponse,
             status_code=status.HTTP_201_CREATED, summary="Create a site under a tenant")
async def create_site(
    tenant_id: uuid.UUID, body: SiteCreate,
    db: AsyncSession = Depends(get_db), _user=_admin, caller_tenant: uuid.UUID = _tenant,
) -> SiteResponse:
    scope.ensure_owned(tenant_id, caller_tenant, "Tenant not found")
    site = Site(tenant_id=tenant_id, name=body.name, address=body.address)
    db.add(site)
    await db.commit()
    await db.refresh(site)
    return SiteResponse.model_validate(site)


@router.get("/tenants/{tenant_id}/sites", response_model=list[SiteResponse], summary="List sites")
async def list_sites(
    tenant_id: uuid.UUID, db: AsyncSession = Depends(get_db), _user=_admin,
    caller_tenant: uuid.UUID = _tenant,
) -> list[SiteResponse]:
    scope.ensure_owned(tenant_id, caller_tenant, "Tenant not found")
    result = await db.execute(select(Site).where(Site.tenant_id == tenant_id))
    return [SiteResponse.model_validate(s) for s in result.scalars().all()]


# ---------------------------------------------------------------- Units
@router.post("/sites/{site_id}/units", response_model=UnitResponse,
             status_code=status.HTTP_201_CREATED, summary="Create a unit under a site")
async def create_unit(
    site_id: uuid.UUID, body: UnitCreate,
    db: AsyncSession = Depends(get_db), _user=_admin, caller_tenant: uuid.UUID = _tenant,
) -> UnitResponse:
    scope.ensure_owned(await scope.tenant_of_site(db, site_id), caller_tenant, "Site not found")
    unit = Unit(
        site_id=site_id, name=body.name,
        unit_type=body.unit_type, max_beds_per_nurse=body.max_beds_per_nurse,
    )
    db.add(unit)
    await db.commit()
    await db.refresh(unit)
    return UnitResponse.model_validate(unit)


@router.get("/sites/{site_id}/units", response_model=list[UnitResponse], summary="List units")
async def list_units(
    site_id: uuid.UUID, db: AsyncSession = Depends(get_db), _user=_admin,
    caller_tenant: uuid.UUID = _tenant,
) -> list[UnitResponse]:
    scope.ensure_owned(await scope.tenant_of_site(db, site_id), caller_tenant, "Site not found")
    result = await db.execute(select(Unit).where(Unit.site_id == site_id))
    return [UnitResponse.model_validate(u) for u in result.scalars().all()]


# ---------------------------------------------------------------- Rooms
@router.post("/units/{unit_id}/rooms", response_model=RoomResponse,
             status_code=status.HTTP_201_CREATED, summary="Create a room under a unit")
async def create_room(
    unit_id: uuid.UUID, body: RoomCreate,
    db: AsyncSession = Depends(get_db), _user=_admin, caller_tenant: uuid.UUID = _tenant,
) -> RoomResponse:
    scope.ensure_owned(await scope.tenant_of_unit(db, unit_id), caller_tenant, "Unit not found")
    room = Room(
        unit_id=unit_id, name=body.name,
        room_number=body.room_number, is_isolation=body.is_isolation,
    )
    db.add(room)
    await db.commit()
    await db.refresh(room)
    return RoomResponse.model_validate(room)


@router.get("/units/{unit_id}/rooms", response_model=list[RoomResponse], summary="List rooms")
async def list_rooms(
    unit_id: uuid.UUID, db: AsyncSession = Depends(get_db), _user=_admin,
    caller_tenant: uuid.UUID = _tenant,
) -> list[RoomResponse]:
    scope.ensure_owned(await scope.tenant_of_unit(db, unit_id), caller_tenant, "Unit not found")
    result = await db.execute(select(Room).where(Room.unit_id == unit_id))
    return [RoomResponse.model_validate(r) for r in result.scalars().all()]


# ---------------------------------------------------------------- Beds
@router.post("/rooms/{room_id}/beds", response_model=BedResponse,
             status_code=status.HTTP_201_CREATED, summary="Create a bed under a room")
async def create_bed(
    room_id: uuid.UUID, body: BedCreate,
    db: AsyncSession = Depends(get_db), _user=_admin, caller_tenant: uuid.UUID = _tenant,
) -> BedResponse:
    scope.ensure_owned(await scope.tenant_of_room(db, room_id), caller_tenant, "Room not found")
    bed = Bed(room_id=room_id, label=body.label, device_location_id=body.device_location_id)
    db.add(bed)
    await db.commit()
    await db.refresh(bed)
    return BedResponse.model_validate(bed)


@router.get("/rooms/{room_id}/beds", response_model=list[BedResponse], summary="List beds")
async def list_beds(
    room_id: uuid.UUID, db: AsyncSession = Depends(get_db), _user=_admin,
    caller_tenant: uuid.UUID = _tenant,
) -> list[BedResponse]:
    scope.ensure_owned(await scope.tenant_of_room(db, room_id), caller_tenant, "Room not found")
    result = await db.execute(select(Bed).where(Bed.room_id == room_id))
    return [BedResponse.model_validate(b) for b in result.scalars().all()]


@router.post("/beds/{bed_id}/transition", response_model=BedResponse,
             summary="Transition a bed to a new lifecycle state (§1.3)")
async def transition_bed(
    bed_id: uuid.UUID, body: BedStateTransitionRequest,
    db: AsyncSession = Depends(get_db), _user=_admin, caller_tenant: uuid.UUID = _tenant,
) -> BedResponse:
    scope.ensure_owned(await scope.tenant_of_bed(db, bed_id), caller_tenant, "Bed not found")
    bed = await _get_or_404(db, Bed, bed_id, "Bed")
    try:
        bed.transition_to(body.new_state)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    await db.commit()
    await db.refresh(bed)
    return BedResponse.model_validate(bed)

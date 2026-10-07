"""
Tenant hierarchy API routes (Tenant → Site → Unit → Room → Bed).
Design doc §1.1 – §1.3.

Structural configuration is a HOSPITAL_ADMIN responsibility (§2). Every mutating
endpoint requires the HOSPITAL_ADMIN role. Bed state transitions are validated
against the bed lifecycle state machine (§1.3).

PHI RULE: infrastructure only — no patient data.
"""
from __future__ import annotations
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.auth.access import ensure_role_in_tenant
from homunculus.auth.dependencies import get_current_active_user, require_roles
from homunculus.auth.models import User, UserRole
from homunculus.db import get_db
from homunculus.tenant.models import Bed, Room, Site, Tenant, Unit
from homunculus.tenant.schemas import (
    BedCreate, BedResponse, BedStateTransitionRequest,
    RoomCreate, RoomResponse, SiteCreate, SiteResponse,
    TenantCreate, TenantResponse, UnitCreate, UnitResponse,
)

router = APIRouter(prefix="/tenant", tags=["tenant"])

# K2: only the HOSPITAL_ADMIN OF THAT HOSPITAL may configure its physical hierarchy (§2). The
# hospital is derived from the record in the URL; being an admin elsewhere grants nothing.
# Creating / listing hospitals themselves is a platform (vendor staff) operation.


async def _tenant_of_path(db: AsyncSession, params: dict) -> uuid.UUID:
    if "tenant_id" in params:
        await _get_or_404(db, Tenant, uuid.UUID(params["tenant_id"]), "Tenant")
        return uuid.UUID(params["tenant_id"])
    if "bed_id" in params:
        bed = await _get_or_404(db, Bed, uuid.UUID(params["bed_id"]), "Bed")
        params = {"room_id": str(bed.room_id)}
    if "room_id" in params:
        room = await _get_or_404(db, Room, uuid.UUID(params["room_id"]), "Room")
        params = {"unit_id": str(room.unit_id)}
    if "unit_id" in params:
        unit = await _get_or_404(db, Unit, uuid.UUID(params["unit_id"]), "Unit")
        params = {"site_id": str(unit.site_id)}
    site = await _get_or_404(db, Site, uuid.UUID(params["site_id"]), "Site")
    return site.tenant_id


async def _hospital_admin(
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(UserRole.HOSPITAL_ADMIN)),
) -> User:
    tenant_id = await _tenant_of_path(db, request.path_params)
    await ensure_role_in_tenant(db, user, tenant_id, UserRole.HOSPITAL_ADMIN)
    return user


async def _platform_admin(user: User = Depends(get_current_active_user)) -> User:
    if not user.is_platform_support:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Platform staff only.")
    return user


_admin = Depends(_hospital_admin)
_platform = Depends(_platform_admin)


async def _get_or_404(db: AsyncSession, model, obj_id: uuid.UUID, name: str):
    obj = await db.get(model, obj_id)
    if obj is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{name} not found")
    return obj


# ---------------------------------------------------------------- Tenants
@router.post("/tenants", response_model=TenantResponse, status_code=status.HTTP_201_CREATED,
             summary="Create a tenant (hospital)")
async def create_tenant(
    body: TenantCreate, db: AsyncSession = Depends(get_db), _user=_platform,
) -> TenantResponse:
    tenant = Tenant(
        name=body.name, slug=body.slug,
        country_code=body.country_code, timezone=body.timezone,
    )
    db.add(tenant)
    await db.commit()
    await db.refresh(tenant)
    return TenantResponse.model_validate(tenant)


@router.get("/tenants", response_model=list[TenantResponse], summary="List tenants")
async def list_tenants(db: AsyncSession = Depends(get_db), _user=_platform) -> list[TenantResponse]:
    result = await db.execute(select(Tenant))
    return [TenantResponse.model_validate(t) for t in result.scalars().all()]


# ---------------------------------------------------------------- Sites
@router.post("/tenants/{tenant_id}/sites", response_model=SiteResponse,
             status_code=status.HTTP_201_CREATED, summary="Create a site under a tenant")
async def create_site(
    tenant_id: uuid.UUID, body: SiteCreate,
    db: AsyncSession = Depends(get_db), _user=_admin,
) -> SiteResponse:
    await _get_or_404(db, Tenant, tenant_id, "Tenant")
    site = Site(tenant_id=tenant_id, name=body.name, address=body.address)
    db.add(site)
    await db.commit()
    await db.refresh(site)
    return SiteResponse.model_validate(site)


@router.get("/tenants/{tenant_id}/sites", response_model=list[SiteResponse], summary="List sites")
async def list_sites(
    tenant_id: uuid.UUID, db: AsyncSession = Depends(get_db), _user=_admin,
) -> list[SiteResponse]:
    result = await db.execute(select(Site).where(Site.tenant_id == tenant_id))
    return [SiteResponse.model_validate(s) for s in result.scalars().all()]


# ---------------------------------------------------------------- Units
@router.post("/sites/{site_id}/units", response_model=UnitResponse,
             status_code=status.HTTP_201_CREATED, summary="Create a unit under a site")
async def create_unit(
    site_id: uuid.UUID, body: UnitCreate,
    db: AsyncSession = Depends(get_db), _user=_admin,
) -> UnitResponse:
    await _get_or_404(db, Site, site_id, "Site")
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
) -> list[UnitResponse]:
    result = await db.execute(select(Unit).where(Unit.site_id == site_id))
    return [UnitResponse.model_validate(u) for u in result.scalars().all()]


# ---------------------------------------------------------------- Rooms
@router.post("/units/{unit_id}/rooms", response_model=RoomResponse,
             status_code=status.HTTP_201_CREATED, summary="Create a room under a unit")
async def create_room(
    unit_id: uuid.UUID, body: RoomCreate,
    db: AsyncSession = Depends(get_db), _user=_admin,
) -> RoomResponse:
    await _get_or_404(db, Unit, unit_id, "Unit")
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
) -> list[RoomResponse]:
    result = await db.execute(select(Room).where(Room.unit_id == unit_id))
    return [RoomResponse.model_validate(r) for r in result.scalars().all()]


# ---------------------------------------------------------------- Beds
@router.post("/rooms/{room_id}/beds", response_model=BedResponse,
             status_code=status.HTTP_201_CREATED, summary="Create a bed under a room")
async def create_bed(
    room_id: uuid.UUID, body: BedCreate,
    db: AsyncSession = Depends(get_db), _user=_admin,
) -> BedResponse:
    await _get_or_404(db, Room, room_id, "Room")
    bed = Bed(room_id=room_id, label=body.label, device_location_id=body.device_location_id)
    db.add(bed)
    await db.commit()
    await db.refresh(bed)
    return BedResponse.model_validate(bed)


@router.get("/rooms/{room_id}/beds", response_model=list[BedResponse], summary="List beds")
async def list_beds(
    room_id: uuid.UUID, db: AsyncSession = Depends(get_db), _user=_admin,
) -> list[BedResponse]:
    result = await db.execute(select(Bed).where(Bed.room_id == room_id))
    return [BedResponse.model_validate(b) for b in result.scalars().all()]


@router.post("/beds/{bed_id}/transition", response_model=BedResponse,
             summary="Transition a bed to a new lifecycle state (§1.3)")
async def transition_bed(
    bed_id: uuid.UUID, body: BedStateTransitionRequest,
    db: AsyncSession = Depends(get_db), _user=_admin,
) -> BedResponse:
    bed = await _get_or_404(db, Bed, bed_id, "Bed")
    try:
        bed.transition_to(body.new_state)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    await db.commit()
    await db.refresh(bed)
    return BedResponse.model_validate(bed)

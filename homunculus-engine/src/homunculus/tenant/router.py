"""
Tenant hierarchy API routes (Tenant → Site → Unit → Room → Bed).
Design doc §1.1 – §1.3.

Structural configuration is guarded by the `structure.manage` permission (held by the
`hospital_admin` group by default), on reads as well as mutations. Bed state transitions are
validated against the bed lifecycle state machine (§1.3).

Two exceptions since Group 2 · B1a (Hasta Kabul): `GET /tenant/structure` — the names of the
caller's own units and beds, which every clinical screen needs and no screen may print as a UUID —
is open to `admissions.view`, `admissions.admit`, `beds.release`, `structure.manage` and
`users.manage` (the scope editor names the units and beds it grants); and
`POST /tenant/beds/{id}/release` (cleaning done, bed free) to `beds.release`, the ward's nurses, in
their own units. Their refusals, and those of the create / rename / close / reopen routes, carry a
stable code (admission/errors.py).

Every structure write — create a site, unit, room or bed; rename, close or reopen one — writes one
audit row per change (`structure.create|rename|close|reopen`: the kind, the id, the unit, the old
and new name or `is_active`, the actor; never a patient) through admission/trail.py, after its
commit; a refused write writes none. A bed's label is unique in its whole unit (any room, closed
beds included, trimmed and case-insensitive: `bed_label_taken`), and a room's name in its unit
(`name_taken`). Writes inside one unit take a lock on its row first, so two at once cannot both
pass a check.

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
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission import trail, unitscope
from homunculus.admission.errors import (
    BED_IN_USE, BED_LABEL_TAKEN, HAS_OPEN_BEDS, INVALID_TRANSITION, NAME_TAKEN, Refusal,
    field_invalid,
)
from homunculus.auth.dependencies import (
    Principal, caller_tenant_id, get_principal, require_permission, require_platform_operator,
)
from homunculus.auth.groups import ensure_default_groups
from homunculus.auth.models import User
from homunculus.db import get_db
from homunculus.tenant import scope
from homunculus.tenant.models import Bed, BedState, Room, Site, Tenant, Unit
from homunculus.tenant.schemas import (
    BedCreate, BedPatch, BedResponse, BedStateTransitionRequest,
    RoomCreate, RoomPatch, RoomResponse, SiteCreate, SiteResponse,
    StructureBed, StructureResponse, StructureRoom, StructureSite, StructureUnit,
    TenantCreate, TenantResponse, UnitCreate, UnitPatch, UnitResponse,
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


# ---------------------------------------------------------------- G2-B1a: the writes' common parts
_ROOM_NAME_TAKEN = Refusal(409, NAME_TAKEN, "Another room of this unit has that name.")
_BED_LABEL_TAKEN = Refusal(409, BED_LABEL_TAKEN, "Another bed of this unit has that label.")


async def _lock_unit(db: AsyncSession, unit_id: uuid.UUID) -> None:
    """Take the unit's row lock for the rest of the transaction. Every structure write inside a
    unit takes it first, so two writes at once run one after the other and the second sees what
    the first committed: two beds cannot both take one label, a bed cannot be reopened under a
    unit that is being closed (amendment A-5). Lock order: the unit, then its bed."""
    await db.execute(select(Unit.id).where(Unit.id == unit_id).with_for_update())


async def _unit_of_room(db: AsyncSession, room_id: uuid.UUID) -> uuid.UUID:
    return (await db.execute(select(Room.unit_id).where(Room.id == room_id))).scalar_one()


async def _unit_of_bed(db: AsyncSession, bed_id: uuid.UUID) -> uuid.UUID:
    return (await db.execute(select(Room.unit_id).join(Bed, Bed.room_id == Room.id)
                             .where(Bed.id == bed_id))).scalar_one()


async def _room_name_taken(db: AsyncSession, unit_id: uuid.UUID, name: str,
                           other_than: uuid.UUID | None = None) -> bool:
    """Whether another room of the unit has this name (exactly: `uq_room_name_per_unit`)."""
    return (await db.execute(select(Room.id).where(
        Room.unit_id == unit_id, Room.name == name, Room.id != other_than).limit(1))).first() \
        is not None


def _label_key(label: str) -> str:
    return label.strip().casefold()


async def _bed_label_taken(db: AsyncSession, unit_id: uuid.UUID, label: str,
                           other_than: uuid.UUID | None = None) -> bool:
    """Whether another bed of the unit — in any room, closed or open — has this label, both
    sides trimmed and compared case-insensitively (amendment A-5: the board names a bed by its
    label alone, so two beds "1" in one unit would read alike). Compared here rather than in
    SQL, so a letter folds the same way whatever the database's collation. A unit has a few
    dozen beds."""
    key = _label_key(label)
    rows = (await db.execute(select(Bed.id, Bed.label).join(Room, Room.id == Bed.room_id)
                             .where(Room.unit_id == unit_id))).all()
    return any(bed_id != other_than and _label_key(other) == key for bed_id, other in rows)


async def _commit_unless_taken(db: AsyncSession, taken: Refusal) -> None:
    """Commit; a unique constraint that still fires (a writer outside these routes) is the same
    409 the check gives, never a 500 (amendment A-13)."""
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise taken.http() from None


def _changes(*, old_name: str, new_name: str, was_active: bool, is_active: bool,
             renamed_too: dict | None = None) -> list[tuple[str, dict]]:
    """The audit rows one PATCH owes (amendment A-4): a rename and a close sent together are two
    changes and two rows; what did not change writes nothing."""
    out: list[tuple[str, dict]] = []
    rename = {"old_name": old_name, "new_name": new_name} if new_name != old_name else {}
    rename.update(renamed_too or {})
    if rename:
        out.append(("structure.rename", rename))
    if is_active != was_active:
        out.append(("structure.reopen" if is_active else "structure.close",
                    {"old_is_active": was_active, "new_is_active": is_active}))
    return out


def _audit(request: Request, hospital: str, event_type: str, actor: User, *, kind: str,
           obj_id: uuid.UUID, unit_id: uuid.UUID | None, change: dict) -> None:
    """One `structure.*` row: what, where (its unit; a site has none), the change, who. No
    patient. Written after the commit, so a row stands for a change that happened."""
    trail.record(request, hospital, event_type, payload={
        "kind": kind, "id": str(obj_id), "unit_id": None if unit_id is None else str(unit_id),
        **change, "actor": actor.username})


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
    tenant_id: uuid.UUID, body: SiteCreate, request: Request,
    db: AsyncSession = Depends(get_db), user: User = _admin, caller_tenant: uuid.UUID = _tenant,
) -> SiteResponse:
    scope.ensure_owned(tenant_id, caller_tenant, "Tenant not found")
    hospital = await trail.hospital_of(db, caller_tenant)
    site = Site(tenant_id=tenant_id, name=body.name, address=body.address)
    db.add(site)
    await db.commit()
    await db.refresh(site)
    _audit(request, hospital, "structure.create", user, kind="site", obj_id=site.id,
           unit_id=None, change={"name": site.name})
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
    site_id: uuid.UUID, body: UnitCreate, request: Request,
    db: AsyncSession = Depends(get_db), user: User = _admin, caller_tenant: uuid.UUID = _tenant,
) -> UnitResponse:
    scope.ensure_owned(await scope.tenant_of_site(db, site_id), caller_tenant, "Site not found")
    hospital = await trail.hospital_of(db, caller_tenant)
    unit = Unit(
        site_id=site_id, name=body.name,
        unit_type=body.unit_type, max_beds_per_nurse=body.max_beds_per_nurse,
    )
    db.add(unit)
    await db.commit()
    await db.refresh(unit)
    _audit(request, hospital, "structure.create", user, kind="unit", obj_id=unit.id,
           unit_id=unit.id, change={"name": unit.name})
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
    unit_id: uuid.UUID, body: RoomCreate, request: Request,
    db: AsyncSession = Depends(get_db), user: User = _admin, caller_tenant: uuid.UUID = _tenant,
) -> RoomResponse:
    scope.ensure_owned(await scope.tenant_of_unit(db, unit_id), caller_tenant, "Unit not found")
    await _lock_unit(db, unit_id)
    if await _room_name_taken(db, unit_id, body.name):
        raise _ROOM_NAME_TAKEN.http()
    hospital = await trail.hospital_of(db, caller_tenant)
    room = Room(
        unit_id=unit_id, name=body.name,
        room_number=body.room_number, is_isolation=body.is_isolation,
    )
    db.add(room)
    await _commit_unless_taken(db, _ROOM_NAME_TAKEN)
    await db.refresh(room)
    _audit(request, hospital, "structure.create", user, kind="room", obj_id=room.id,
           unit_id=unit_id, change={"name": room.name})
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
    room_id: uuid.UUID, body: BedCreate, request: Request,
    db: AsyncSession = Depends(get_db), user: User = _admin, caller_tenant: uuid.UUID = _tenant,
) -> BedResponse:
    scope.ensure_owned(await scope.tenant_of_room(db, room_id), caller_tenant, "Room not found")
    unit_id = await _unit_of_room(db, room_id)
    await _lock_unit(db, unit_id)
    if await _bed_label_taken(db, unit_id, body.label):
        raise _BED_LABEL_TAKEN.http()
    hospital = await trail.hospital_of(db, caller_tenant)
    bed = Bed(room_id=room_id, label=body.label, device_location_id=body.device_location_id)
    db.add(bed)
    await _commit_unless_taken(db, _BED_LABEL_TAKEN)
    await db.refresh(bed)
    _audit(request, hospital, "structure.create", user, kind="bed", obj_id=bed.id,
           unit_id=unit_id, change={"name": bed.label})
    return BedResponse.model_validate(bed)


@router.get("/rooms/{room_id}/beds", response_model=list[BedResponse], summary="List beds")
async def list_beds(
    room_id: uuid.UUID, db: AsyncSession = Depends(get_db), _user=_admin,
    caller_tenant: uuid.UUID = _tenant,
) -> list[BedResponse]:
    scope.ensure_owned(await scope.tenant_of_room(db, room_id), caller_tenant, "Room not found")
    result = await db.execute(select(Bed).where(Bed.room_id == room_id))
    return [BedResponse.model_validate(b) for b in result.scalars().all()]


# ---------------------------------------------------------------- G2-B1a (Hasta Kabul)
# The ward's own structure as every screen reads it, the administrator's rename / close / reopen,
# and a nurse's "cleaning done, bed free". Refusals carry a stable code (admission/errors.py).
_FREE_TO_CLOSE = {BedState.AVAILABLE, BedState.HOUSEKEEPING, BedState.BLOCKED}


def _natural(text: str) -> list:
    """Sort key that puts bed "2" before bed "10". `re.split` with one group alternates text and
    digits, so position i compares like with like: text at even i, a number at odd i."""
    return [int(part) if i % 2 else part.casefold()
            for i, part in enumerate(re.split(r"(\d+)", text))]


@router.get("/structure", response_model=StructureResponse,
            summary="Sites, units, rooms and beds, with names and states, in the caller's units")
async def structure(
    db: AsyncSession = Depends(get_db), caller_tenant: uuid.UUID = _tenant,
    principal: Principal = Depends(get_principal),
    _user: User = Depends(require_permission("admissions.view", "admissions.admit",
                                             "beds.release", "structure.manage", "users.manage")),
) -> StructureResponse:
    """The tree a screen resolves every unit and bed NAME from (spec D9: no UUID on a screen).
    `users.manage` too: the scope editor names the units and beds it grants (plan X52).

    Limited to the caller's units: a unit she is granted with all its rooms and beds, a bed she is
    granted with its room and unit around it. An unrestricted caller sees every unit, and so does
    a holder of `structure.manage` — the one who builds the structure must see all of it. Closed
    units, rooms and beds are listed (`is_active: false`): a screen dims them with the reason."""
    everything = "structure.manage" in principal.perms
    scope_ = None if everything else await unitscope.caller_scope(db, principal.user.id,
                                                                   caller_tenant)
    sites = (await db.execute(select(Site).where(Site.tenant_id == caller_tenant))).scalars().all()
    units = (await db.execute(
        select(Unit).where(Unit.site_id.in_([s.id for s in sites])))).scalars().all()
    rooms = (await db.execute(
        select(Room).where(Room.unit_id.in_([u.id for u in units])))).scalars().all()
    beds = (await db.execute(
        select(Bed).where(Bed.room_id.in_([r.id for r in rooms])))).scalars().all()
    room_unit = {r.id: r.unit_id for r in rooms}

    def shown(bed: Bed) -> bool:
        return scope_ is None or unitscope.reaches(scope_, unit_id=room_unit[bed.room_id],
                                                   bed_id=bed.id)

    def unit_shown(unit: Unit) -> bool:
        # The unit whole: a unit grant (or no limit). A bed grant alone shows only its bed.
        return scope_ is None or unitscope.reaches(scope_, unit_id=unit.id, bed_id=None)

    out_sites = []
    for site in sorted(sites, key=lambda s: _natural(s.name)):
        out_units = []
        for unit in sorted((u for u in units if u.site_id == site.id),
                           key=lambda u: _natural(u.name)):
            whole = unit_shown(unit)
            out_rooms = []
            for room in sorted((r for r in rooms if r.unit_id == unit.id),
                               key=lambda r: _natural(r.name)):
                room_beds = [StructureBed(id=b.id, label=b.label, state=b.state,
                                          is_active=b.is_active)
                             for b in sorted((b for b in beds if b.room_id == room.id),
                                             key=lambda b: _natural(b.label))
                             if whole or shown(b)]
                if whole or room_beds:
                    out_rooms.append(StructureRoom(
                        id=room.id, name=room.name, room_number=room.room_number,
                        is_isolation=room.is_isolation, is_active=room.is_active, beds=room_beds))
            if whole or out_rooms:
                out_units.append(StructureUnit(id=unit.id, name=unit.name, unit_type=unit.unit_type,
                                               is_active=unit.is_active, rooms=out_rooms))
        if everything or out_units:
            out_sites.append(StructureSite(id=site.id, name=site.name, is_active=site.is_active,
                                           units=out_units))
    return StructureResponse(tenant_id=caller_tenant, sites=out_sites)


async def _has_open_bed(db: AsyncSession, *conditions) -> bool:
    stmt = (select(Bed.id).join(Room, Room.id == Bed.room_id)
            .where(Bed.is_active.is_(True), *conditions).limit(1))
    return (await db.execute(stmt)).first() is not None


@router.patch("/units/{unit_id}", response_model=UnitResponse,
              summary="Rename, close or reopen a unit (G2-B1a)")
async def patch_unit(
    unit_id: uuid.UUID, body: UnitPatch, request: Request,
    db: AsyncSession = Depends(get_db), user: User = _admin, caller_tenant: uuid.UUID = _tenant,
) -> UnitResponse:
    scope.ensure_owned(await scope.tenant_of_unit(db, unit_id), caller_tenant, "Unit not found")
    unit = (await db.execute(select(Unit).where(Unit.id == unit_id).with_for_update())).scalar_one()
    name = unit.name if body.name is None else body.name.strip()
    if not name:
        raise field_invalid("name", "A unit needs a name.").http()
    is_active = unit.is_active if body.is_active is None else body.is_active
    if unit.is_active and not is_active and await _has_open_bed(db, Room.unit_id == unit_id):
        raise Refusal(409, HAS_OPEN_BEDS, "Close every bed of this unit first.").http()
    changes = _changes(old_name=unit.name, new_name=name, was_active=unit.is_active,
                       is_active=is_active)
    hospital = await trail.hospital_of(db, caller_tenant)
    unit.name, unit.is_active = name, is_active
    await db.commit()
    await db.refresh(unit)
    for event_type, change in changes:
        _audit(request, hospital, event_type, user, kind="unit", obj_id=unit.id, unit_id=unit.id,
               change=change)
    return UnitResponse.model_validate(unit)


@router.patch("/rooms/{room_id}", response_model=RoomResponse,
              summary="Rename, close or reopen a room (G2-B1a)")
async def patch_room(
    room_id: uuid.UUID, body: RoomPatch, request: Request,
    db: AsyncSession = Depends(get_db), user: User = _admin, caller_tenant: uuid.UUID = _tenant,
) -> RoomResponse:
    scope.ensure_owned(await scope.tenant_of_room(db, room_id), caller_tenant, "Room not found")
    unit_id = await _unit_of_room(db, room_id)
    await _lock_unit(db, unit_id)
    room = await _get_or_404(db, Room, room_id, "Room")
    name = room.name if body.name is None else body.name.strip()
    if not name:
        raise field_invalid("name", "A room needs a name.").http()
    if name != room.name and await _room_name_taken(db, unit_id, name, other_than=room.id):
        raise _ROOM_NAME_TAKEN.http()
    number = room.room_number if body.room_number is None else (body.room_number.strip() or None)
    is_active = room.is_active if body.is_active is None else body.is_active
    if room.is_active and not is_active and await _has_open_bed(db, Bed.room_id == room_id):
        raise Refusal(409, HAS_OPEN_BEDS, "Close every bed of this room first.").http()
    renumbered = ({"old_room_number": room.room_number, "new_room_number": number}
                  if number != room.room_number else {})
    changes = _changes(old_name=room.name, new_name=name, was_active=room.is_active,
                       is_active=is_active, renamed_too=renumbered)
    hospital = await trail.hospital_of(db, caller_tenant)
    room.name, room.room_number, room.is_active = name, number, is_active
    await _commit_unless_taken(db, _ROOM_NAME_TAKEN)
    await db.refresh(room)
    for event_type, change in changes:
        _audit(request, hospital, event_type, user, kind="room", obj_id=room.id, unit_id=unit_id,
               change=change)
    return RoomResponse.model_validate(room)


@router.patch("/beds/{bed_id}", response_model=BedResponse,
              summary="Rename, close or reopen a bed (G2-B1a)")
async def patch_bed(
    bed_id: uuid.UUID, body: BedPatch, request: Request,
    db: AsyncSession = Depends(get_db), user: User = _admin, caller_tenant: uuid.UUID = _tenant,
) -> BedResponse:
    scope.ensure_owned(await scope.tenant_of_bed(db, bed_id), caller_tenant, "Bed not found")
    unit_id = await _unit_of_bed(db, bed_id)
    await _lock_unit(db, unit_id)
    bed = (await db.execute(select(Bed).where(Bed.id == bed_id).with_for_update())).scalar_one()
    label = bed.label if body.label is None else body.label.strip()
    if not label:
        raise field_invalid("label", "A bed needs a label.").http()
    if label != bed.label and await _bed_label_taken(db, unit_id, label, other_than=bed.id):
        raise _BED_LABEL_TAKEN.http()
    is_active = bed.is_active if body.is_active is None else body.is_active
    if bed.is_active and not is_active and bed.state not in _FREE_TO_CLOSE:
        raise Refusal(409, BED_IN_USE, f"A bed that is {bed.state.value} cannot be closed.").http()
    changes = _changes(old_name=bed.label, new_name=label, was_active=bed.is_active,
                       is_active=is_active)
    hospital = await trail.hospital_of(db, caller_tenant)
    bed.label, bed.is_active = label, is_active
    await _commit_unless_taken(db, _BED_LABEL_TAKEN)
    await db.refresh(bed)
    for event_type, change in changes:
        _audit(request, hospital, event_type, user, kind="bed", obj_id=bed.id, unit_id=unit_id,
               change=change)
    return BedResponse.model_validate(bed)


@router.post("/beds/{bed_id}/release", response_model=BedResponse,
             summary="Cleaning done: a HOUSEKEEPING bed becomes AVAILABLE (G2-B1a)")
async def release_bed(
    bed_id: uuid.UUID, request: Request,
    db: AsyncSession = Depends(get_db), caller_tenant: uuid.UUID = _tenant,
    user: User = Depends(require_permission("beds.release")),
) -> BedResponse:
    """Spec D8 and §3.4: the ward's nurses turn a bed over without an administrator — in their
    own units only (the bed's room's unit, read here). Audited `bed.release` (who, which bed)
    after the commit."""
    scope.ensure_owned(await scope.tenant_of_bed(db, bed_id), caller_tenant, "Bed not found")
    bed = (await db.execute(select(Bed).where(Bed.id == bed_id).with_for_update())).scalar_one()
    unit_id = await _unit_of_bed(db, bed_id)
    try:
        unitscope.require_reach(await unitscope.caller_scope(db, user.id, caller_tenant),
                                unit_id=unit_id, bed_id=bed.id)
    except Refusal as exc:
        raise exc.http() from None
    if bed.state != BedState.HOUSEKEEPING:
        raise Refusal(409, INVALID_TRANSITION,
                      f"Only a bed in cleaning can be released (it is {bed.state.value}).").http()
    bed.transition_to(BedState.AVAILABLE)
    hospital = await trail.hospital_of(db, caller_tenant)
    await db.commit()
    await db.refresh(bed)
    trail.record(request, hospital, "bed.release",
                 payload={"bed_id": str(bed.id), "unit_id": str(unit_id), "actor": user.username})
    return BedResponse.model_validate(bed)


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

"""
Tenant hierarchy API routes (Tenant → Site → Unit → Room → Bed).
Design doc §1.1 – §1.3.

Structural configuration is guarded by the `structure.manage` permission (held by the
`hospital_admin` group by default), on reads as well as mutations. Bed state transitions are
validated against the bed lifecycle state machine (§1.3).

Two exceptions since Group 2 · B1a (Hasta Kabul): `GET /tenant/structure` — the names of the
caller's own units and beds, which every clinical screen needs and no screen may print as a UUID —
is open to `admissions.view`, `admissions.admit`, `beds.release`, `structure.manage`,
`users.manage` (the scope editor names the units and beds it grants), `devices.map_beds` (the
monitor→bed editor's picker) and, since G2-B3a, `admissions.discharge.confirm` (Doluluk, D2); and
`POST /tenant/beds/{id}/release` (cleaning done, bed free) to `beds.release`, the ward's nurses, in
their own units. Their refusals, and those of the create / rename / close / reopen routes, carry a
stable code (admission/errors.py). A bed is never freed — by the release, or by the
administrator's raw move to AVAILABLE (`POST /tenant/beds/{id}/transition`) — while the card of
one of its discharged patients still stands on the board (a discharge whose board step failed):
both take every such card off first (`_last_card_off`, `BoardLink.take_off`), and are refused
`board_not_cleared` when they cannot. The raw move frees no bed whose admission is still open
either (`bed_in_use`); the release needs no such check, as only cleaning is released.

Every structure write — create a site, unit, room or bed; rename, close or reopen one — writes one
audit row per change (`structure.create|rename|close|reopen`: the kind, the id, the unit, the old
and new name or `is_active`, the actor; never a patient) through admission/trail.py, after its
commit; a refused write writes none. A bed's label is unique in its whole unit (any room, closed
beds included, trimmed and case-insensitive: `bed_label_taken`), and a room's name in its unit
(`name_taken`). Writes inside one unit take a lock on its row first, so two at once cannot both
pass a check. The unit and bed locks are FOR NO KEY UPDATE, which lets an insert of a row
pointing at the unit or bed (an admission) through (amendment A-26). A bed relabel does not keep
it so: `label` is in the unique index `uq_bed_label_per_room`, so the relabel's UPDATE upgrades
the bed's lock to FOR UPDATE until the commit. Code that writes a row pointing at a bed must
therefore lock that bed first (see `_lock_bed`). An audit store that fails after the commit is
logged, never a 500 for the committed change (trail.record, A-26).

Yapı follows the monitor→bed mapping (Group 2 · G2-ESLEME, devicebeds/writes.py, inside
`patch_bed`'s transaction, after its unit and bed locks): a bed with a monitor bound is not closed
(`bed_has_monitor`); a rename of one relabels the monitor's current mapping row — a close and a new
row, in the rename's commit — and is audited `device_bed.relabel` beside `structure.rename`.

Tenant isolation (spec §5): every route acts on the caller's own tenant only (`caller_tenant_id`,
the token's `tenant` claim). A tenant, site, unit, room or bed of another tenant named in the path
is a 404 identical to a missing one, and a list under it is refused the same way (see
tenant/scope.py). `GET /tenant/tenants` lists the caller's own tenant; a platform operator sees
every tenant. Creating a tenant is a platform operator's action alone
(`require_platform_operator`): a tenant a hospital administrator created would have no members
and could not be administered through `/admin`. Its first administrator comes from
`scripts/seed_admin.py`.

PHI RULE. The structure is infrastructure and carries no patient data. Since G2-B3a (Doluluk,
spec R1, R8) two kinds of route here touch it, and nothing else does:
- The four bed moves — `POST /tenant/beds/{id}/reserve`, `/unreserve`, `/out-of-service` and
  `/return-to-service` (`beds.manage_state`) — write or clear `beds.state_note`. A note may name
  the expected patient, so it is stored encrypted (`EncryptedString`). Their audit rows carry the
  reason and only whether a note was written, never its words.
- `GET /tenant/occupancy` returns the short names of the patients in the caller's beds (R7) and the
  notes, decrypted. Only D2's readers get them (`admissions.view`, `admissions.admit`,
  `admissions.discharge.confirm`, `beds.release`), and only for their own units.
`GET /tenant/structure` never decrypts a note: the column is not even loaded
(`defer(..., raiseload=True)`), and the tree names no patient.
"""
from __future__ import annotations
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer

from homunculus.admission import trail, transfer, unitscope
from homunculus.admission.boardkey import board_key
from homunculus.admission.boardlink import board_link_of
from homunculus.admission.errors import (
    BED_CLOSED, BED_IN_USE, BED_LABEL_TAKEN, BOARD_NOT_CLEARED, HAS_OPEN_BEDS, INVALID_TRANSITION,
    NAME_TAKEN, Refusal, field_invalid,
)
from homunculus.admission.models import OPEN_ADMISSION_STATES, Admission, AdmissionState, Patient
from homunculus.auth.dependencies import (
    Principal, caller_tenant_id, get_principal, require_permission, require_platform_operator,
)
from homunculus.auth.groups import ensure_default_groups
from homunculus.auth.models import User
from homunculus.db import get_db
from homunculus.devicebeds import writes as device_beds   # G2-ESLEME: Yapı follows the mapping (D18)
from homunculus.tenant import scope
from homunculus.tenant.shortname import short_name          # G2-B3a (R7)
from homunculus.tenant.models import (
    BED_STATE_TRANSITIONS, Bed, BedState, BedStateReason, Room, Site, Tenant, Unit,
)
from homunculus.tenant.schemas import (
    BedCreate, BedOutOfService, BedPatch, BedReserve, BedResponse, BedStateTransitionRequest,
    RoomCreate, RoomPatch, RoomResponse, SiteCreate, SiteResponse,
    OccupancyBed, OccupancyResponse,
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
    unit that is being closed (amendment A-5). Lock order: the unit, then its bed.

    FOR NO KEY UPDATE, not FOR UPDATE (amendment A-26, I-1): it still excludes every other
    structure write, but not the FOR KEY SHARE that Postgres takes on the unit when a row
    pointing at it is inserted. Under FOR UPDATE an admission holding its bed and inserting its
    `admitting_unit_id` would wait here while a bed PATCH holding the unit waits for that bed: a
    deadlock, and a 500. The lock stays NO KEY UPDATE through `patch_unit`'s UPDATE: a unit row
    has no unique index but its primary key, which no route changes."""
    await db.execute(select(Unit.id).where(Unit.id == unit_id).with_for_update(key_share=True))


async def _lock_bed(db: AsyncSession, bed_id: uuid.UUID) -> Bed:
    """The bed's row, locked for the rest of the transaction — FOR NO KEY UPDATE, as the unit
    (see `_lock_unit`), so taking it does not hold an insert of a row pointing at the bed (an
    admission, a nurse's bed assignment).

    A relabel changes that. `label` is in the unique index `uq_bed_label_per_room`, and Postgres
    counts a column of a unique index (one that is neither partial nor on an expression) as part
    of the row's key for locking: `patch_bed`'s UPDATE of a new label upgrades this lock to FOR
    UPDATE until the commit, and an insert pointing at the bed then waits. A state or
    `is_active` change keeps NO KEY UPDATE. So any code that writes a row pointing at a bed takes
    THIS lock on that bed first: it then waits for a relabel here, holding nothing a relabel
    needs, instead of waiting inside its insert while holding other locks.

    Read afresh under the lock (`populate_existing`): a bed already in the session must not come
    back as it was when it was loaded, or a move that waited here would act on a stale state."""
    return (await db.execute(
        select(Bed).where(Bed.id == bed_id).with_for_update(key_share=True)
        .execution_options(populate_existing=True))).scalar_one()


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
        room_number=body.room_number or None, is_isolation=body.is_isolation,
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
    # G2-B3a (R1): BedResponse has no note, so the note is never loaded, let alone decrypted.
    result = await db.execute(select(Bed).options(defer(Bed.state_note, raiseload=True))
                              .where(Bed.room_id == room_id))
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
                                             "admissions.discharge.confirm",
                                             "beds.release", "structure.manage", "users.manage",
                                             "devices.map_beds")),
) -> StructureResponse:
    """The tree a screen resolves every unit and bed NAME from (spec D9: no UUID on a screen).
    `users.manage` too: the scope editor names the units and beds it grants (plan X52).
    `devices.map_beds` too: the monitor→bed editor's picker names the beds (G2-ESLEME).
    `admissions.discharge.confirm` too: D2 opens Doluluk to it, and the screen is built from this
    tree (G2-B3a, final review M-3). The tree carries no patient data (R1), so no right reaches a
    name through it.

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
    # G2-B3a (R1): the structure never holds a note's plaintext. The column is not loaded, so it
    # is not decrypted either: a note that cannot be read must not take the tree every screen
    # reads down with it, and a later change cannot leak the note by touching the attribute.
    beds = (await db.execute(
        select(Bed).options(defer(Bed.state_note, raiseload=True))
        .where(Bed.room_id.in_([r.id for r in rooms])))).scalars().all()
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
                                          is_active=b.is_active, state_since=b.state_updated_at)
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
    await _lock_unit(db, unit_id)
    unit = await _get_or_404(db, Unit, unit_id, "Unit")
    name = unit.name if body.name is None else body.name     # trimmed by UnitPatch
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
    name = room.name if body.name is None else body.name     # trimmed by RoomPatch
    if not name:
        raise field_invalid("name", "A room needs a name.").http()
    if name != room.name and await _room_name_taken(db, unit_id, name, other_than=room.id):
        raise _ROOM_NAME_TAKEN.http()
    number = room.room_number if body.room_number is None else (body.room_number or None)
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
    bed = await _lock_bed(db, bed_id)
    label = bed.label if body.label is None else body.label     # trimmed by BedPatch
    if not label:
        raise field_invalid("label", "A bed needs a label.").http()
    if label != bed.label and await _bed_label_taken(db, unit_id, label, other_than=bed.id):
        raise _BED_LABEL_TAKEN.http()
    is_active = bed.is_active if body.is_active is None else body.is_active
    if bed.is_active and not is_active and bed.state not in _FREE_TO_CLOSE:
        raise Refusal(409, BED_IN_USE, f"A bed that is {bed.state.value} cannot be closed.").http()
    if bed.is_active and not is_active:
        await device_beds.refuse_close_if_bound(db, caller_tenant, bed.id)          # G2-ESLEME (O7)
    changes = _changes(old_name=bed.label, new_name=label, was_active=bed.is_active,
                       is_active=is_active)
    hospital = await trail.hospital_of(db, caller_tenant)
    # G2-ESLEME (O3): the bound monitor's row follows the rename, in this transaction — before the
    # bed's own UPDATE is pending, so the relabel's flush carries no UPDATE of the bed (its lock stays
    # NO KEY UPDATE until the commit) and a label race still ends in `bed_label_taken` at the commit,
    # which rolls the relabel back with the rename.
    relabelled = (await device_beds.relabel_bed(db, caller_tenant, bed.id, label, user)
                  if label != bed.label else None)
    bed.label, bed.is_active = label, is_active
    await _commit_unless_taken(db, _BED_LABEL_TAKEN)
    await db.refresh(bed)
    for event_type, change in changes:
        _audit(request, hospital, event_type, user, kind="bed", obj_id=bed.id, unit_id=unit_id,
               change=change)
    if relabelled is not None:
        closed, opened = relabelled
        trail.record(request, hospital, "device_bed.relabel", subject=closed.source, payload={
            "source": closed.source, "group": closed.group_address,
            "device_bed_label": closed.device_bed_label, "bed_id": str(bed.id), "unit_id": str(unit_id),
            "old": {"row_id": closed.id, "bed_label": closed.bed_label},
            "new": {"row_id": opened.id, "bed_label": opened.bed_label}, "actor": user.username})
        reset = getattr(request.app.state, "shadow_table_reset", None)
        if reset is not None:
            reset()
    return BedResponse.model_validate(bed)


async def _last_card_off(request: Request, db: AsyncSession, hospital: str, bed_id: uuid.UUID,
                         actor: str, *, via: str = "bed.release") -> None:
    """The bed's discharged patients off the board before the bed is freed (review I-2): a
    discharge whose board step failed leaves that patient's card standing as admitted on this
    bed, and a bed freed under it would take a second card. EVERY DISCHARGED admission of the bed
    whose identity is not a tombstone is checked, not only the row written last (the final
    review): an older admission's row may be written after a newer one's (`updated_at`), and the
    newer card would stand behind it. For each, the step runs again (`BoardLink.take_off`:
    idempotent; it ends the patient's alerts, which no longer hold it), audited
    `admission.discharge_board_retry` with `via` — the release (`bed.release`), the
    administrator's raw move (`bed.transition`) or the Doluluk's return to service
    (`bed.return_to_service`); when one still fails, the bed is refused
    `board_not_cleared` with that patient's number and board key — the newest such, by
    `updated_at` — (the caller's units hold this bed, or the caller administers the structure).
    Called under the bed's lock. An app without its BoardLink has no board, so no card can
    stand.

    Each check reads the identity store once: one read per DISCHARGED admission the bed ever
    held, a tombstone among them read and passed over.

    G2-B1b (spec §5.5, T9): the bed's TRANSFERRED admissions too. Each is followed forward
    (`transfer.where_now`) to the patient's admission now. While her card still stands as admitted
    on THIS bed (`BoardLink.stands_on`: the move's board step failed), it is moved to her bed now
    (`transfer.move_card`), audited `admission.transfer_board_retry` with `via`; when it still
    fails, the bed is refused `board_not_cleared` with her number. It is never taken off: she is
    still admitted (A-37, O8). A card already elsewhere, or a tombstone, is passed over. One
    exception (X4): when her stay has ended since and her discharge's board step failed too, the
    card is a discharged patient's, and is taken off as above."""
    link = board_link_of(request)
    if link is None:
        return
    discharged = (await db.execute(
        select(Admission.id, Admission.protocol_no, Patient.patient_number)
        .join(Patient, Patient.id == Admission.patient_id)
        .where(Admission.bed_id == bed_id, Admission.state == AdmissionState.DISCHARGED)
        .order_by(Admission.updated_at.desc()))).all()
    standing = None
    for admission_id, protocol_no, number in discharged:
        key = board_key(protocol_no, number)          # G2-B1d: the card is under its key (E3)
        if link.is_discharged(hospital, key):
            continue
        board, alerts = await link.take_off(hospital, key)
        trail.record(request, hospital, "admission.discharge_board_retry", patient_id=key,
                     payload={"admission_id": str(admission_id), "bed_id": str(bed_id),
                              "board": board, "alerts": alerts, "via": via, "actor": actor})
        if board != "ok" and standing is None:
            standing = {"patient_number": number, "board_key": key}
    # G2-B1b (spec §5.5, T9): the patients who moved FROM this bed. A move whose board step failed
    # left the card standing as admitted here, though she lies elsewhere now.
    transferred = (await db.execute(
        select(Admission.id)
        .where(Admission.bed_id == bed_id, Admission.state == AdmissionState.TRANSFERRED)
        .order_by(Admission.updated_at.desc()))).scalars().all()
    here = None
    for source_id in transferred:
        now_at = await transfer.where_now(db, source_id)
        if now_at is None:
            continue                                   # a move the closed routes left half done
        now_id, now_state = now_at
        card = await transfer.card_of(db, now_id)
        key = card["key"]
        if link.is_discharged(hospital, key) or not link.stands_on(hospital, key, str(bed_id)):
            continue                                   # a tombstone, or a card already elsewhere
        if now_state in OPEN_ADMISSION_STATES:         # still admitted: moved, never taken off
            if here is None:
                here = await transfer.unit_of(db, bed_id)
            board = await transfer.move_card(request, hospital, card, left=(bed_id, here))
            trail.record(request, hospital, "admission.transfer_board_retry", patient_id=key,
                         payload={"source_admission_id": str(source_id),
                                  "admission_id": str(now_id), "bed_id": str(bed_id),
                                  "board": board, "via": via, "actor": actor})
        else:                                          # X4: her stay ended since; the card is a
            board, alerts = await link.take_off(hospital, key)      # discharged patient's
            trail.record(request, hospital, "admission.discharge_board_retry", patient_id=key,
                         payload={"admission_id": str(now_id), "bed_id": str(bed_id),
                                  "board": board, "alerts": alerts, "via": via,
                                  "actor": actor})
        if board != "ok" and standing is None:
            standing = {"patient_number": card["patient_number"], "board_key": key}
    if standing is not None:
        raise Refusal(409, BOARD_NOT_CLEARED, "A patient's card still stands on this bed: the "
                      "board refused to move it or to take it off.", extra=standing)   # X11


@router.post("/beds/{bed_id}/release", response_model=BedResponse,
             summary="Cleaning done: a HOUSEKEEPING bed becomes AVAILABLE (G2-B1a)")
async def release_bed(
    bed_id: uuid.UUID, request: Request,
    db: AsyncSession = Depends(get_db), caller_tenant: uuid.UUID = _tenant,
    user: User = Depends(require_permission("beds.release")),
) -> BedResponse:
    """Spec D8 and §3.4: the ward's nurses turn a bed over without an administrator — in their
    own units only (the bed's room's unit, read here). Refused `board_not_cleared` while its last
    discharged patient's card cannot be taken off the board (`_last_card_off`). Audited
    `bed.release` (who, which bed) after the commit."""
    scope.ensure_owned(await scope.tenant_of_bed(db, bed_id), caller_tenant, "Bed not found")
    bed = await _lock_bed(db, bed_id)
    unit_id = await _unit_of_bed(db, bed_id)
    try:
        unitscope.require_reach(await unitscope.caller_scope(db, user.id, caller_tenant),
                                unit_id=unit_id, bed_id=bed.id)
    except Refusal as exc:
        raise exc.http() from None
    if bed.state != BedState.HOUSEKEEPING:
        raise Refusal(409, INVALID_TRANSITION,
                      f"Only a bed in cleaning can be released (it is {bed.state.value}).").http()
    hospital = await trail.hospital_of(db, caller_tenant)
    try:
        await _last_card_off(request, db, hospital, bed.id, user.username)
    except Refusal as exc:
        raise exc.http() from None
    bed.transition_to(BedState.AVAILABLE)
    await db.commit()
    await db.refresh(bed)
    trail.record(request, hospital, "bed.release",
                 payload={"bed_id": str(bed.id), "unit_id": str(unit_id), "actor": user.username})
    return BedResponse.model_validate(bed)


async def _holds_open_admission(db: AsyncSession, bed_id: uuid.UUID) -> bool:
    """Whether an admission on the bed is still open (DRAFT, ACTIVE or PENDING_*)."""
    return (await db.execute(select(Admission.id).where(
        Admission.bed_id == bed_id, Admission.state.in_(list(OPEN_ADMISSION_STATES)))
        .limit(1))).first() is not None


async def _free_guards(request: Request, db: AsyncSession, hospital: str, bed: Bed, actor: str,
                       *, via: str) -> None:
    """What every move that FREES a bed checks first, under the bed's lock (B1a's final review;
    G2-B3a R6): no admission on it still open (`bed_in_use`), and its discharged patients' cards
    off the board (`_last_card_off`, `board_not_cleared`). The raw move and the Doluluk's return
    to service share it, so neither frees a bed the release would not. Raises Refusal."""
    if await _holds_open_admission(db, bed.id):
        raise Refusal(409, BED_IN_USE, "An admission on this bed is still open: it is "
                      "discharged before the bed is freed.")
    await _last_card_off(request, db, hospital, bed.id, actor, via=via)


#: G2-B3a (X4): states the raw move neither sets nor leaves. Each comes with a note or a reason,
#: which only the Doluluk's routes take; and a bed in one leaves it only through its own audited
#: moves (unreserve, return to service, or an admission that confirms the reservation).
_NOT_RAW = frozenset({BedState.RESERVED, BedState.BLOCKED})


@router.post("/beds/{bed_id}/transition", response_model=BedResponse,
             summary="Transition a bed to a new lifecycle state (§1.3)")
async def transition_bed(
    bed_id: uuid.UUID, body: BedStateTransitionRequest, request: Request,
    db: AsyncSession = Depends(get_db), user: User = _admin, caller_tenant: uuid.UUID = _tenant,
) -> BedResponse:
    """The administrator's raw move along the bed's state machine (§1.3; a move it does not allow
    is a 400). A move that FREES the bed — to AVAILABLE, from cleaning or maintenance (a block
    goes back by `return-to-service`, X4) — frees none the release would not (the final review): it is refused `bed_in_use` while an
    admission on the bed is still open (it is discharged first), and it runs the release's check
    first (`_last_card_off`: every discharged patient's card still standing is taken off the
    board, or the move is refused `board_not_cleared` with that patient's number). Under the
    bed's lock, as the release.

    G2-B3a (X4), two rules, each a 400: it never SETS RESERVED or BLOCKED (both come with a note
    or a reason, which only the bed's own routes take), and it never LEAVES a bed that is
    RESERVED or BLOCKED now — such a bed goes back only through `unreserve` or `return-to-service`,
    or into an admission that confirms the reservation, each audited."""
    scope.ensure_owned(await scope.tenant_of_bed(db, bed_id), caller_tenant, "Bed not found")
    bed = await _lock_bed(db, bed_id)
    if body.new_state in _NOT_RAW:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"{body.new_state.value} is set on the bed's own routes "
                                   "(reserve, out-of-service), with its note or reason.")
    if bed.state in _NOT_RAW:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"The bed is {bed.state.value}: it leaves that state on its "
                                   "own routes (unreserve, return-to-service), which are audited.")
    if body.new_state == BedState.AVAILABLE and \
            body.new_state in BED_STATE_TRANSITIONS.get(bed.state, set()):
        try:
            await _free_guards(request, db, await trail.hospital_of(db, caller_tenant), bed,
                               user.username, via="bed.transition")
        except Refusal as exc:
            raise exc.http() from None
    try:
        bed.transition_to(body.new_state)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    await db.commit()
    await db.refresh(bed)
    return BedResponse.model_validate(bed)


# ---------------------------------------------------------------- G2-B3a (Doluluk)
# A free bed reserved for an expected patient or taken out of service with a reason, and either
# undone (spec §4, D4). Every route follows the same steps:
#   1. the bed is proven the caller's tenant's, and its row is locked (R6);
#   2. the caller's units must reach it, and a closed bed is refused (X6);
#   3. the state is checked;
#   4. one transition runs, which clears the old reason and note (`Bed.transition_to`), and the
#      new ones are written.
# Each move is audited after the commit, with the reason and whether a note was written — never
# its words (R8).
_manage_state = Depends(require_permission("beds.manage_state"))


async def _bed_in_reach(db: AsyncSession, bed_id: uuid.UUID, caller_tenant: uuid.UUID,
                        user: User) -> tuple[Bed, uuid.UUID]:
    """The bed, locked, and its unit — or the refusal: 404 when the bed is another tenant's or
    does not exist; 403 `out_of_scope` outside the caller's units; 409 `bed_closed` for a closed
    bed (X6)."""
    scope.ensure_owned(await scope.tenant_of_bed(db, bed_id), caller_tenant, "Bed not found")
    bed = await _lock_bed(db, bed_id)
    unit_id = await _unit_of_bed(db, bed_id)
    try:
        unitscope.require_reach(await unitscope.caller_scope(db, user.id, caller_tenant),
                                unit_id=unit_id, bed_id=bed.id)
    except Refusal as exc:
        raise exc.http() from None
    if not bed.is_active:
        raise Refusal(409, BED_CLOSED, "The bed is closed: it is reopened first.").http()
    return bed, unit_id


def _must_be(bed: Bed, states: frozenset[BedState], what: str) -> BedState:
    """The bed's state, if it is one of `states`; else 409 `invalid_transition`."""
    if bed.state not in states:
        raise Refusal(409, INVALID_TRANSITION, f"{what} (it is {bed.state.value}).").http()
    return bed.state


async def _state_written(request: Request, db: AsyncSession, hospital: str, bed: Bed,
                         unit_id: uuid.UUID, user: User, event_type: str, *, was: BedState,
                         reason: str | None, note: bool) -> BedResponse:
    """Commit the move, then audit it: who, the bed, from → to, the reason, and whether a note
    was written — never the note (R8). The row is written right after the commit and before the
    refresh, so a refresh that fails cannot leave a committed move without its audit row; what
    the payload needs is read before the commit."""
    bed_id, to = str(bed.id), bed.state
    await db.commit()
    trail.record(request, hospital, event_type, payload={
        "bed_id": bed_id, "unit_id": str(unit_id), "from": was.value, "to": to.value,
        "reason": reason, "note": note, "actor": user.username})
    await db.refresh(bed)
    return BedResponse.model_validate(bed)


@router.post("/beds/{bed_id}/reserve", response_model=BedResponse,
             summary="Hold a free bed for an expected patient (G2-B3a)")
async def reserve_bed(
    bed_id: uuid.UUID, body: BedReserve, request: Request,
    db: AsyncSession = Depends(get_db), caller_tenant: uuid.UUID = _tenant,
    user: User = _manage_state,
) -> BedResponse:
    bed, unit_id = await _bed_in_reach(db, bed_id, caller_tenant, user)
    was = _must_be(bed, frozenset({BedState.AVAILABLE}), "Only a free bed can be reserved")
    hospital = await trail.hospital_of(db, caller_tenant)
    note = body.note or None
    bed.transition_to(BedState.RESERVED)
    bed.state_note = note
    return await _state_written(request, db, hospital, bed, unit_id, user, "bed.reserve",
                                was=was, reason=None, note=note is not None)


@router.post("/beds/{bed_id}/unreserve", response_model=BedResponse,
             summary="Cancel a bed's reservation (G2-B3a)")
async def unreserve_bed(
    bed_id: uuid.UUID, request: Request,
    db: AsyncSession = Depends(get_db), caller_tenant: uuid.UUID = _tenant,
    user: User = _manage_state,
) -> BedResponse:
    bed, unit_id = await _bed_in_reach(db, bed_id, caller_tenant, user)
    was = _must_be(bed, frozenset({BedState.RESERVED}), "Only a reserved bed can be unreserved")
    hospital = await trail.hospital_of(db, caller_tenant)
    bed.transition_to(BedState.AVAILABLE)
    return await _state_written(request, db, hospital, bed, unit_id, user, "bed.unreserve",
                                was=was, reason=None, note=False)


@router.post("/beds/{bed_id}/out-of-service", response_model=BedResponse,
             summary="Take a free bed out of service, with a reason (G2-B3a)")
async def bed_out_of_service(
    bed_id: uuid.UUID, body: BedOutOfService, request: Request,
    db: AsyncSession = Depends(get_db), caller_tenant: uuid.UUID = _tenant,
    user: User = _manage_state,
) -> BedResponse:
    bed, unit_id = await _bed_in_reach(db, bed_id, caller_tenant, user)
    was = _must_be(bed, frozenset({BedState.AVAILABLE}),
                   "Only a free bed can be taken out of service")
    note = body.note or None
    if body.reason is BedStateReason.OTHER and note is None:
        raise field_invalid("note", "The reason 'other' needs a note.").http()      # X3
    hospital = await trail.hospital_of(db, caller_tenant)
    bed.transition_to(BedState.BLOCKED)
    bed.state_reason, bed.state_note = body.reason.value, note
    return await _state_written(request, db, hospital, bed, unit_id, user, "bed.out_of_service",
                                was=was, reason=body.reason.value, note=note is not None)


@router.post("/beds/{bed_id}/return-to-service", response_model=BedResponse,
             summary="Free a bed out of service or in maintenance (G2-B3a)")
async def bed_return_to_service(
    bed_id: uuid.UUID, request: Request,
    db: AsyncSession = Depends(get_db), caller_tenant: uuid.UUID = _tenant,
    user: User = _manage_state,
) -> BedResponse:
    """R3, R6: BLOCKED or MAINTENANCE → AVAILABLE, after the guards every freeing move runs."""
    bed, unit_id = await _bed_in_reach(db, bed_id, caller_tenant, user)
    was = _must_be(bed, frozenset({BedState.BLOCKED, BedState.MAINTENANCE}),
                   "Only a bed out of service or in maintenance returns to service")
    reason = bed.state_reason
    hospital = await trail.hospital_of(db, caller_tenant)
    try:
        await _free_guards(request, db, hospital, bed, user.username, via="bed.return_to_service")
    except Refusal as exc:
        raise exc.http() from None
    bed.transition_to(BedState.AVAILABLE)
    return await _state_written(request, db, hospital, bed, unit_id, user,
                                "bed.return_to_service", was=was, reason=reason, note=False)


#: D2: whoever may open the Doluluk screen reads its names and notes; nobody else does (R1).
_OCCUPANCY_READERS = ("admissions.view", "admissions.admit", "admissions.discharge.confirm",
                      "beds.release")


@router.get("/occupancy", response_model=OccupancyResponse,
            summary="The short names and the notes of the caller's beds (G2-B3a)")
async def occupancy(
    db: AsyncSession = Depends(get_db), caller_tenant: uuid.UUID = _tenant,
    user: User = Depends(require_permission(*_OCCUPANCY_READERS)),
) -> OccupancyResponse:
    """R1: the patient data of the bed screen, apart from GET /tenant/structure. The structure
    is read by the scope editor (`users.manage`) and the monitor→bed editor (`devices.map_beds`)
    as well, and they must not get patient names.
    For each of the caller's beds (her units; her tenant), it lists:
    - the short name of the patient whose admission is still open on it (R7);
    - the out-of-service reason;
    - the note, decrypted (R8).
    A bed with none of the three is left out; the screen joins the rest to the structure by
    `bed_id`."""
    reach = await unitscope.caller_scope(db, user.id, caller_tenant)
    stmt = (select(Bed).join(Room, Room.id == Bed.room_id).join(Unit, Unit.id == Room.unit_id)
            .join(Site, Site.id == Unit.site_id).where(Site.tenant_id == caller_tenant))
    # `reach_clause` is None for an unrestricted caller (an administrator; an unassigned one while
    # SCOPE_ENFORCE_UNASSIGNED is off). It must not reach `.where()`: SQLAlchemy reads None there
    # as NULL, and the unrestricted caller would see no bed at all.
    within = unitscope.reach_clause(reach, unit_id=Unit.id, bed_id=Bed.id)
    if within is not None:
        stmt = stmt.where(within)
    beds = (await db.execute(stmt)).scalars().all()
    ids = [b.id for b in beds]
    # Oldest first, so `dict()` keeps the newest admission of a bed (no index forbids two open ones).
    names = dict((await db.execute(
        select(Admission.bed_id, Patient.display_name)
        .join(Patient, Patient.id == Admission.patient_id)
        .where(Admission.tenant_id == caller_tenant, Admission.bed_id.in_(ids),
               Admission.state.in_(list(OPEN_ADMISSION_STATES)))
        .order_by(Admission.created_at))).all()) if ids else {}
    return OccupancyResponse(beds=[
        OccupancyBed(bed_id=b.id, occupant_short=short_name(names.get(b.id)),
                     state_reason=b.state_reason, state_note=b.state_note)
        for b in sorted(beds, key=lambda b: str(b.id))
        if b.id in names or b.state_reason is not None or b.state_note is not None
    ])

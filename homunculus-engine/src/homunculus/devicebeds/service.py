# homunculus-engine/src/homunculus/devicebeds/service.py
"""Bind, move, replace and unbind (spec §4.4) — one transaction on the request's session, in five steps
that `change()` runs in order:

  1. `_resolve`        steps 2-4   the device, the target bed, the device's current row (no lock)
  2. `_lock_and_check` steps 5-7   the beds, the rows; `changed:false`; `expected`; the unit scope
  3. `_occupancy`      step 8      an admitted patient on the target bed or the bed left (O5); after the unit
                                   scope (a caller out of reach learns nothing of who lies there), before `t`
                                   and before any write, so a refusal needs no rollback
  4. `_write`          steps 9-11  `t`, every close, every insert, the commit, the strip's table reset
  5. `_audit`          steps 12-13 one audit row per device's change, after the commit; the fresh list

Locks follow B1a's rules (A-26): the beds touched, FOR NO KEY UPDATE through `tenant.router._lock_bed`
(imported, so the rule is one — E3), in id order; then the current rows involved, FOR UPDATE, in id
order (`rows.current_rows`, the one reader of current rows — A-19). A request asking for what already
holds answers `changed: false` BEFORE the device's bed is compared with the one read at step 4 and before
`expected` (§4.3, §4.4 step 6: a request sent twice at once finds its own change made). `t` is the
database's `clock_timestamp()`, read once after the locks (§4.4). All closes are flushed before any
insert, so the partial unique indexes never see two current rows; one of OUR two that fires anyway is
`mapping_changed`, anything else is an error. The unit of a new row is the bed's own (its room's unit,
read under the bed lock), never the request's (A-8). Audit rows after the commit, never raising
(trail.record)."""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission import trail, unitscope
from homunculus.admission.errors import (
    BED_CLOSED, BED_OCCUPIED, DEVICE_UNKNOWN, MAPPING_CHANGED, Refusal, field_invalid,
)
from homunculus.admission.models import OPEN_ADMISSION_STATES, Admission, Patient
from homunculus.api.infinity_device_beds import PORT, unicast_ipv4
from homunculus.auth.dependencies import Principal
from homunculus.auth.models import User
from homunculus.devicebeds import listing
from homunculus.devicebeds.models import DeviceBed
from homunculus.devicebeds.rows import brief, current_rows, db_time, editor_row
from homunculus.scope.rules import normalise_id
from homunculus.tenant import scope
from homunculus.tenant.models import Bed, Room, Unit
from homunculus.tenant.router import _lock_bed

_CHANGED = Refusal(409, MAPPING_CHANGED, "The mapping changed meanwhile; read it again.")
_UNIQUE_VIOLATION = "23505"
#: The two partial unique indexes of migration 0014 (one current row per device, one per bed): the only
#: constraints whose firing means "somebody else's change got in first".
_OUR_INDEXES = frozenset({"uq_device_beds_current_source", "uq_device_beds_current_bed"})


@dataclass(frozen=True)
class Ask:
    source: str
    bed_id: uuid.UUID | None            # None: unbind
    expected_device: int | None
    expected_bed: int | None            # bind only
    confirm_occupied: bool


@dataclass(frozen=True)
class _Seen:
    """What steps 2-4 learned, with no lock held."""
    views: dict                         # the worker's devices now, by source (ShadowStore.devices)
    device_row: DeviceBed | None        # the device's current row as step 4 read it
    leaving: uuid.UUID | None           # the bed that row put the device on


@dataclass(frozen=True)
class _Held:
    """What steps 5-7 hold when a change is to be written: the locked rows and the beds' own places
    — each `_place`: (label, bed open, room open, unit open, unit id)."""
    mine: DeviceBed | None              # the device's current row, locked
    on_bed: DeviceBed | None            # the target bed's current row, locked (another device's, or None)
    leaving: uuid.UUID | None           # the bed the device leaves (also locked), or None
    target_place: tuple | None          # the target bed's place (bind)
    leaving_place: tuple | None         # the bed the device leaves


@dataclass(frozen=True)
class _Written:
    t: datetime
    group: str
    label: str | None                   # the device's central-station name, carried
    new: DeviceBed
    displaced: DeviceBed | None         # the closed row of the monitor the bind pushed off the bed
    new_displaced: DeviceBed | None     # that monitor's new, unbound row


async def _place(db: AsyncSession, bed_id: uuid.UUID):
    """(label, bed open, room open, unit open, unit id) — read as columns, so a value committed
    after an earlier ORM load of the bed is seen (the session's identity map is not consulted)."""
    return (await db.execute(
        select(Bed.label, Bed.is_active, Room.is_active, Unit.is_active, Room.unit_id)
        .join(Room, Room.id == Bed.room_id).join(Unit, Unit.id == Room.unit_id)
        .where(Bed.id == bed_id))).one()


def _open(place) -> None:
    if not (place[1] and place[2] and place[3]):
        raise Refusal(409, BED_CLOSED, "This bed, its room or its unit is closed.").http()


def _constraint_of(orig) -> str | None:
    """The violated constraint's name, wherever the driver keeps it: on asyncpg's exception behind
    SQLAlchemy's adapter (`orig.__cause__`), on psycopg2's `diag`, or on the exception itself."""
    for holder in (orig, getattr(orig, "__cause__", None), getattr(orig, "diag", None)):
        name = getattr(holder, "constraint_name", None)
        if isinstance(name, str) and name:
            return name
    return None


def _current_row_index_fired(error: IntegrityError) -> bool:
    """True only for a unique violation (SQLSTATE 23505) of one of OUR two current-row indexes — the
    answer to which is `mapping_changed` (spec §4.4 step 9). Any other unique violation, a CHECK (the
    interval), a foreign key, or a driver that does not name the constraint is a bug of ours or an unknown,
    and stays an error (a 500): a refusal would tell the user to repeat a request that can never work."""
    code = getattr(error.orig, "sqlstate", None) or getattr(error.orig, "pgcode", None)
    return code == _UNIQUE_VIOLATION and _constraint_of(error.orig) in _OUR_INDEXES


async def change(request: Request, db: AsyncSession, tenant_id: uuid.UUID, user: User,
                 principal: Principal, hospital: str, ask: Ask) -> dict:
    state = request.app.state
    seen = await _resolve(state, db, tenant_id, ask)
    held = await _lock_and_check(db, tenant_id, principal, ask, seen)
    if held is None:                                                  # asked for what already holds
        return await _answer(state, db, tenant_id, principal, changed=False)
    occupied = await _occupancy(state, db, principal, hospital, ask, held)      # 8: refuses before `t`, before any write
    written = await _write(db, tenant_id, user, ask, seen, held)
    state.shadow_table_reset()                                        # 11
    _audit(request, hospital, user, ask, held, written, occupied)
    return await _answer(state, db, tenant_id, principal, changed=True,
                         replaced=written.displaced.source if written.displaced is not None else None)   # 13


async def _resolve(state, db: AsyncSession, tenant_id: uuid.UUID, ask: Ask) -> _Seen:
    """Steps 2-4: the device (a unicast IPv4 the worker reports or a row of this tenant holds — D8), the
    target bed (this tenant's, a missing or foreign one the same 404, and open), the device's current row."""
    if unicast_ipv4(ask.source) != ask.source:
        raise field_invalid("source", "Not a monitor's unicast IPv4 address.").http()
    views = state.shadow_store.devices(state.shadow_clock())
    device_row = (await current_rows(db, tenant_id, sources=[ask.source])).get(ask.source)      # 4, no lock
    if ask.source not in views and device_row is None:
        raise Refusal(404, DEVICE_UNKNOWN, "This monitor is not one the worker reports.").http()
    if ask.bed_id is not None:                                                                    # 3
        scope.ensure_owned(await scope.tenant_of_bed(db, ask.bed_id), tenant_id, "Bed not found")
        _open(await _place(db, ask.bed_id))
    return _Seen(views, device_row, device_row.bed_id if device_row is not None else None)


async def _lock_and_check(db: AsyncSession, tenant_id: uuid.UUID, principal: Principal, ask: Ask,
                          seen: _Seen) -> _Held | None:
    """Steps 5-7. None: the request asks for what already holds (`changed: false`, §4.3) — judged before the
    device's bed is compared with step 4's and before `expected`. Raises `mapping_changed` when the rows are
    not what the request expects, `out_of_scope` when a bed is outside the caller's units."""
    leaving = seen.leaving
    # 5. the beds, in id order
    for bed in sorted({b for b in (ask.bed_id, leaving) if b is not None}):
        await _lock_bed(db, bed)
    # 6. the current rows involved, in id order, then what holds now
    locked = await current_rows(db, tenant_id, sources=[ask.source],
                                bed_ids=None if ask.bed_id is None else [ask.bed_id], lock=True)
    mine = locked.get(ask.source)
    on_bed = next((r for r in locked.values() if ask.bed_id is not None and r.bed_id == ask.bed_id), None)
    target_place = None
    if ask.bed_id is not None:
        target_place = await _place(db, ask.bed_id)
        _open(target_place)                                           # a close committed meanwhile
        if mine is not None and mine.bed_id == ask.bed_id:
            return None
    elif mine is None or mine.bed_id is None:                         # no row, or one on no bed (A-22 M3)
        return None
    # Defence in depth: `expected` below already subsumes this check (row ids are immutable, so the id the screen
    # saw is the row step 4 read, and a device whose bed changed has another row). It stays as the cheap local test.
    if (mine.bed_id if mine is not None else None) != leaving:
        raise _CHANGED.http()                                         # it moved between 4 and 6
    if mine is None and ask.source not in seen.views:
        raise _CHANGED.http()                                         # E33: no row left, and no worker to name its group
    if (mine.id if mine is not None else None) != ask.expected_device:
        raise _CHANGED.http()
    if ask.bed_id is not None and (on_bed.id if on_bed is not None else None) != ask.expected_bed:
        raise _CHANGED.http()
    # 7. unit scope: the target bed and the bed the device leaves (each by its own room's unit)
    caller = await unitscope.caller_scope(db, principal.user.id, tenant_id)
    leaving_place = None if leaving is None else await _place(db, leaving)
    for bed, place in ((ask.bed_id, target_place), (leaving, leaving_place)):
        if bed is None:
            continue
        try:
            unitscope.require_reach(caller, unit_id=place[4], bed_id=bed)
        except Refusal as refusal:
            raise refusal.http() from None
    return _Held(mine, on_bed, leaving, target_place, leaving_place)


async def _open_admission_number(db: AsyncSession, bed_id: uuid.UUID) -> str | None:
    """The patient number of an open admission on the bed, or None when there is none — exactly
    `tenant.router._holds_open_admission`'s condition (`Admission.bed_id`, `OPEN_ADMISSION_STATES`), but it
    returns the number (E9): the audit and the refusal need it, and the helper answers a bool. A column, not
    an entity, so a row committed after an earlier load is seen. `patient_number` is NOT NULL: None here is
    never an admission without a number."""
    return (await db.execute(
        select(Patient.patient_number).join(Admission, Admission.patient_id == Patient.id)
        .where(Admission.bed_id == bed_id, Admission.state.in_(list(OPEN_ADMISSION_STATES))).limit(1)
    )).scalar_one_or_none()


async def _occupancy(state, db: AsyncSession, principal: Principal, hospital: str, ask: Ask,
                     held: _Held) -> list[dict]:
    """Step 8 (spec D4, §4.4, O5). A bed is occupied when an open admission holds it (read now, under the bed
    lock) or the board puts an admitted patient on it (`app.state.bed_occupants`, the strip's rule read fresh —
    HIS-fed records included). The beds that count are the TARGET bed (a bind: where the monitor's vitals will
    start to flow — a monitor replaced there is on that same bed) and the bed the device LEAVES (a move or an
    unbind: where they stop); target first. The monitor of a replace is not a third bed.

    Returns the occupied beds the change goes over, `[{bed_id, patient_id?, patient_ids?}]`, for the audit —
    [] when none. Raises 409 `bed_occupied` unless `confirm_occupied` is true. The audit keeps every
    `patient_id`; the answer shows it only to a `board.view` holder (a key-only holder learns that a patient
    is there, not who).

    Who is named when the board holds two or more patients on one bed: with an admission made here, that
    admission's patient (the one the hospital recorded here); with none, no one — either board patient would
    be a guess, so the row's `patient_id` stays "" and the answer names no one. The audit still keeps the
    trail: that hit carries `patient_ids` (all of them, sorted), which only the audit payload sees; the
    answer drops it. No name anywhere."""
    on_board = state.bed_occupants(hospital)
    occupied: list[dict] = []
    for bed in (ask.bed_id, held.leaving):
        if bed is None:
            continue
        present = on_board.get(normalise_id(str(bed)), [])
        number = await _open_admission_number(db, bed)
        if not present and number is None:
            continue
        hit = {"bed_id": str(bed)}
        patient = present[0] if len(present) == 1 else number
        if patient:
            hit["patient_id"] = patient
        elif len(present) > 1:
            hit["patient_ids"] = sorted(present)
        occupied.append(hit)
    if occupied and not ask.confirm_occupied:
        may_name = "board.view" in principal.perms
        shown = [{key: value for key, value in hit.items()
                  if key == "bed_id" or (key == "patient_id" and may_name)} for hit in occupied]
        raise Refusal(409, BED_OCCUPIED, "An admitted patient is on this bed; confirm to go on.",
                      {"occupied": shown}).http()
    return occupied


async def _write(db: AsyncSession, tenant_id: uuid.UUID, user: User, ask: Ask, seen: _Seen,
                 held: _Held) -> _Written:
    """Steps 9-10: `t`, then every close, then every insert, then the commit. The group of a row is the
    worker's when it reports the device, else the device's own last row's (§5.3) — the displaced monitor's
    new row included."""
    mine, on_bed = held.mine, held.on_bed
    t = await db_time(db)
    view = seen.views.get(ask.source)
    group = view.group if view is not None else mine.group_address
    label = mine.device_bed_label if mine is not None else None
    displaced = on_bed if on_bed is not None and on_bed.source != ask.source else None
    for row in (mine, displaced):
        if row is not None:
            row.valid_to = t
    place = held.target_place
    bed_label, unit_id = (place[0], place[4]) if place is not None else (None, None)
    try:
        await db.flush()
        new_displaced = None
        if displaced is not None:
            reported = seen.views.get(displaced.source)
            new_displaced = editor_row(tenant_id, displaced.source,
                                       reported.group if reported is not None else displaced.group_address,
                                       PORT, displaced.device_bed_label, None, None, None, t, user)
            db.add(new_displaced)
        new = editor_row(tenant_id, ask.source, group, PORT, label, bed_label, ask.bed_id, unit_id, t, user)
        db.add(new)
        await db.flush()
        await db.commit()                                             # 10
    except IntegrityError as error:
        await db.rollback()
        if not _current_row_index_fired(error):
            raise
        raise _CHANGED.http() from None
    return _Written(t, group, label, new, displaced, new_displaced)


def _audit(request: Request, hospital: str, user: User, ask: Ask, held: _Held, written: _Written,
           occupied: list[dict]) -> None:
    """Step 12: one audit row per device's change (B1a A-4), after the commit, never raising."""
    mine, displaced = held.mine, written.displaced
    common = {"occupied_confirmed": bool(occupied), "occupied": occupied, "actor": user.username}
    kind = "device_bed.bind" if ask.bed_id is not None else "device_bed.unbind"
    payload = {"source": ask.source, "group": written.group, "device_bed_label": written.label,
               "old": brief(mine), "new": brief(written.new),
               "replaced_source": displaced.source if displaced is not None else None, **common}
    if ask.bed_id is None:
        payload["reason"] = "unbound"
    trail.record(request, hospital, kind, patient_id=_patient_of(occupied, ask.bed_id, held.leaving),
                 subject=ask.source, payload=payload)
    if displaced is not None:
        trail.record(request, hospital, "device_bed.unbind",
                     patient_id=_patient_of(occupied, ask.bed_id, None), subject=displaced.source,
                     payload={"source": displaced.source, "group": written.new_displaced.group_address,
                              "device_bed_label": displaced.device_bed_label, "old": brief(displaced),
                              "new": brief(written.new_displaced), "reason": "replaced", "by_source": ask.source,
                              "replaced_source": None, **common})


def _patient_of(occupied: list[dict], first: uuid.UUID | None, second: uuid.UUID | None) -> str:
    """The audit row's `patient_id` (spec §4.7, O5): the confirmed occupied bed's patient — `first`
    (the target bed) before `second` (the bed left) — or ""."""
    for bed in (first, second):
        for hit in occupied:
            if bed is not None and hit["bed_id"] == str(bed) and hit.get("patient_id"):
                return hit["patient_id"]
    return ""


async def _answer(state, db, tenant_id, principal, *, changed: bool, replaced: str | None = None) -> dict:
    return {"changed": changed, "replaced_source": replaced,
            "list": await listing.build(state, db, tenant_id, principal)}

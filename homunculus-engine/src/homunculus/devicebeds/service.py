# homunculus-engine/src/homunculus/devicebeds/service.py
"""Bind, move, replace and unbind (spec §4.4) — one transaction on the request's session.

Locks follow B1a's rules (A-26): the beds touched, FOR NO KEY UPDATE through `tenant.router._lock_bed`
(imported, so the rule is one — E3), in id order; then the current rows involved, FOR UPDATE, in id
order (`rows.current_rows`, the one reader of current rows — A-19). A request asking for what already
holds answers `changed: false` before `expected` is compared (§4.3). `t` is the database's
`clock_timestamp()`, read once after the locks (§4.4). All closes are flushed before any insert, so
the partial unique indexes never see two current rows; one that fires anyway is `mapping_changed`.
The unit of a new row is the bed's own (its room's unit, read under the bed lock), never the request's
(A-8). Audit rows after the commit, never raising (trail.record)."""
from __future__ import annotations

import uuid
from dataclasses import dataclass

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission import trail, unitscope
from homunculus.admission.errors import BED_CLOSED, DEVICE_UNKNOWN, MAPPING_CHANGED, Refusal, field_invalid
from homunculus.api.infinity_device_beds import PORT, unicast_ipv4
from homunculus.auth.dependencies import Principal
from homunculus.auth.models import User
from homunculus.devicebeds import listing
from homunculus.devicebeds.rows import brief, current_rows, db_time, editor_row
from homunculus.tenant import scope
from homunculus.tenant.models import Bed, Room, Unit
from homunculus.tenant.router import _lock_bed

_CHANGED = Refusal(409, MAPPING_CHANGED, "The mapping changed meanwhile; read it again.")
_UNIQUE_VIOLATION = "23505"


@dataclass(frozen=True)
class Ask:
    source: str
    bed_id: uuid.UUID | None            # None: unbind
    expected_device: int | None
    expected_bed: int | None            # bind only
    confirm_occupied: bool


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


def _is_other_than_a_unique_violation(error: IntegrityError) -> bool:
    """The index guard answers `mapping_changed`; a CHECK or a foreign key that fires is a bug of ours
    and must be loud (a 500), not a refusal the screen would tell the user to retry. A driver that does
    not say which constraint fired is given the benefit of the doubt (spec §4.4 step 9)."""
    code = getattr(error.orig, "pgcode", None) or getattr(error.orig, "sqlstate", None)
    return code is not None and code != _UNIQUE_VIOLATION


async def change(request: Request, db: AsyncSession, tenant_id: uuid.UUID, user: User,
                 principal: Principal, hospital: str, ask: Ask) -> dict:
    state = request.app.state
    # 2. the device: a unicast IPv4 the worker reports or a row of this tenant holds (D8)
    if unicast_ipv4(ask.source) != ask.source:
        raise field_invalid("source", "Not a monitor's unicast IPv4 address.").http()
    view = state.shadow_store.devices(state.shadow_clock()).get(ask.source)
    # 4. the device's current row, without a lock, to learn the bed it sits at now
    device_row = (await current_rows(db, tenant_id, sources=[ask.source])).get(ask.source)
    if view is None and device_row is None:
        raise Refusal(404, DEVICE_UNKNOWN, "This monitor is not one the worker reports.").http()
    # 3. the target bed: this tenant's (a missing or foreign bed is the same 404), and open
    if ask.bed_id is not None:
        scope.ensure_owned(await scope.tenant_of_bed(db, ask.bed_id), tenant_id, "Bed not found")
        _open(await _place(db, ask.bed_id))
    leaving = device_row.bed_id if device_row is not None else None
    # 5. the beds, in id order
    for bed in sorted({b for b in (ask.bed_id, leaving) if b is not None}):
        await _lock_bed(db, bed)
    # 6. the current rows involved, in id order, then what holds now
    locked = await current_rows(db, tenant_id, sources=[ask.source],
                                bed_ids=None if ask.bed_id is None else [ask.bed_id], lock=True)
    mine = locked.get(ask.source)
    on_bed = next((r for r in locked.values() if ask.bed_id is not None and r.bed_id == ask.bed_id), None)
    if (mine.bed_id if mine is not None else None) != leaving or (mine is None and view is None):
        raise _CHANGED.http()                                         # it moved between 4 and 6
    place = None
    if ask.bed_id is not None:
        place = await _place(db, ask.bed_id)
        _open(place)                                                  # a close committed meanwhile
        if mine is not None and mine.bed_id == ask.bed_id:
            return await _answer(state, db, tenant_id, principal, changed=False)
    elif mine is None or mine.bed_label is None:
        return await _answer(state, db, tenant_id, principal, changed=False)
    if (mine.id if mine is not None else None) != ask.expected_device:
        raise _CHANGED.http()
    if ask.bed_id is not None and (on_bed.id if on_bed is not None else None) != ask.expected_bed:
        raise _CHANGED.http()
    # 7. unit scope: the target bed and the bed the device leaves (each by its own room's unit)
    caller = await unitscope.caller_scope(db, principal.user.id, tenant_id)
    if ask.bed_id is not None:
        try:
            unitscope.require_reach(caller, unit_id=place[4], bed_id=ask.bed_id)
        except Refusal as refusal:
            raise refusal.http() from None
    if leaving is not None:
        try:
            unitscope.require_reach(caller, unit_id=(await _place(db, leaving))[4], bed_id=leaving)
        except Refusal as refusal:
            raise refusal.http() from None
    # 8. occupancy — Task 10
    occupied: list[dict] = []
    # 9. t, then every close, then every insert
    t = await db_time(db)
    group = view.group if view is not None else mine.group_address
    label = mine.device_bed_label if mine is not None else None
    displaced = on_bed if on_bed is not None and on_bed.source != ask.source else None
    for row in (mine, displaced):
        if row is not None:
            row.valid_to = t
    bed_label, unit_id = (place[0], place[4]) if ask.bed_id is not None else (None, None)
    try:
        await db.flush()
        new_displaced = None
        if displaced is not None:
            new_displaced = editor_row(tenant_id, displaced.source, displaced.group_address, PORT,
                                       displaced.device_bed_label, None, None, None, t, user)
            db.add(new_displaced)
        new = editor_row(tenant_id, ask.source, group, PORT, label, bed_label, ask.bed_id, unit_id, t, user)
        db.add(new)
        await db.flush()
        await db.commit()                                             # 10
    except IntegrityError as error:
        await db.rollback()
        if _is_other_than_a_unique_violation(error):
            raise
        raise _CHANGED.http() from None
    state.shadow_table_reset()                                        # 11
    # 12. one audit row per device's change (B1a A-4)
    common = {"occupied_confirmed": bool(occupied), "occupied": occupied, "actor": user.username}
    kind = "device_bed.bind" if ask.bed_id is not None else "device_bed.unbind"
    payload = {"source": ask.source, "group": group, "device_bed_label": label,
               "old": brief(mine), "new": brief(new),
               "replaced_source": displaced.source if displaced is not None else None, **common}
    if ask.bed_id is None:
        payload["reason"] = "unbound"
    trail.record(request, hospital, kind, patient_id=_patient_of(occupied, ask.bed_id, leaving),
                 subject=ask.source, payload=payload)
    if displaced is not None:
        trail.record(request, hospital, "device_bed.unbind",
                     patient_id=_patient_of(occupied, ask.bed_id, None), subject=displaced.source,
                     payload={"source": displaced.source, "group": displaced.group_address,
                              "device_bed_label": displaced.device_bed_label, "old": brief(displaced),
                              "new": brief(new_displaced), "reason": "replaced", "by_source": ask.source,
                              "replaced_source": None, **common})
    return await _answer(state, db, tenant_id, principal, changed=True,
                         replaced=displaced.source if displaced is not None else None)   # 13


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

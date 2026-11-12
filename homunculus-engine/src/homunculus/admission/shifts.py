# homunculus-engine/src/homunculus/admission/shifts.py
"""G4-04 «İş yükü» (spec docs/superpowers/specs/2026-11-12-g4-is-yuku-design.md D3, D4 and §5): who looks after which
bed this shift — the charge nurse's assignment, and its read for the workload page.

  GET  /shift-schedule?shift=current|next[&unit_id=]   shifts.manage or workload.view
  GET  /shift-schedule/nurses?unit_id=                 shifts.manage
  PUT  /shift-schedule                                 shifts.manage

THE WINDOW. One of the tenant's two daily shifts (api/shiftclock.py `shift_windows`: local wall-clock starts), by
Görevlerim's two starts and the tenant's zone read as GET /tasks reads them: «current» holds now, «next» follows it. A
row belongs to the window whose start is its `shift_start` (the window's key). The PUT names its window by that key
(`shift_start`, from the GET the form read) and takes it only while it is still the current or the next window: a form
read at 19:50 and saved at 20:00:30 is a 409 `shift_changed`, never a write into the window after the one it showed
(§5 A1); the check is made under the unit's lock, so a save that waited on it past the change is refused too (A14). A
row of another window that overlaps the one read (the hours were changed meanwhile) is counted (`other_rows`), and the
next save of the window ends it (A3) — but never a row of one of the two live windows, and never one whose shift has
ended (A14: shortened hours must not let one live window end the other's rows, nor a save rewrite a finished night).

THE UNIT. A row is the unit of its BED (bed → room → unit), and is read so: the retired POST let a row name a bed of
another unit (A8). The caller's reach is her UNIT grants (`unitscope.unit_clause`): a bed grant names one bed, not the
unit around it, so it reaches no unit here; an unrestricted caller (the administrator) reaches every unit of her
tenant.

THE WRITE. One unit and one window at a time: in one transaction, under the unit's row lock — the lock every structure
write in the unit takes first (tenant/router.py `_lock_unit`, FOR NO KEY UPDATE) — the window's active rows are read
again and must equal `expected` (required; else 409 with the words the dashboard knows, `CONCURRENT_CHANGE`, as PUT
/scope/{user_id}); a row the save leaves out goes `is_active = false` with `closed_at` (kept: the history), a pair it
keeps stays as it is, a new pair is inserted after the ends are flushed (the partial unique index of migration 0022 —
one active nurse per bed per window — cannot be deferred). A unique violation is the coded 409 `assignment_conflict`,
never a 500. Audited `shift.assign` after the commit, ids only, the unit its subject.

WHO. The offered people are `service.nurse_ids` (the default nurse and charge-nurse groups, A10). A new pair names an
offered person; a person no longer offered (her account or membership ended mid-shift) keeps a pair she already holds.
One whose own scope does not reach every bed she is given (her unit, or the bed itself) is saved with a soft warning
(`unit_not_reached`, read after the commit, A14). No beds-per-nurse warning (A12).

No patient anywhere: beds, units and staff names."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admin.service import CONCURRENT_CHANGE
from homunculus.admission import service, trail, unitscope
from homunculus.admission.errors import ASSIGNMENT_CONFLICT, OUT_OF_SCOPE, SHIFT_CHANGED, Refusal, field_invalid
from homunculus.admission.models import NURSE_BED_ACTIVE_INDEX, NurseBedAssignment
from homunculus.admission.router import _broken_constraint
from homunculus.admission.schemas import (
    ShiftItem, ShiftNurse, ShiftSchedule, ShiftSchedulePut, ShiftScheduleSaved, ShiftUnit, ShiftWarning, ShiftWindow,
)
from homunculus.api.shiftclock import Shift, shift_windows
from homunculus.api.tasks import DEFAULT_SETTINGS, zone_of
from homunculus.auth.dependencies import caller_tenant_id, require_permission
from homunculus.auth.models import User
from homunculus.auth.permissions import validate_permissions
from homunculus.db import get_db
from homunculus.scope import Scope
from homunculus.tenant import scope
from homunculus.tenant.models import Bed, Room, Site, Unit

SHIFTS_MANAGE, WORKLOAD_VIEW = validate_permissions(("shifts.manage", "workload.view"))
SHIFT_ASSIGN = "shift.assign"
#: How far before a window another window's row may start and still be looked at (`_others`, §5 A14 M1): no window
#: is longer than a day (25 hours the night a clock goes back), so two days holds every row that can overlap it.
OTHERS_LOOKBACK = timedelta(days=2)
UNIT_NOT_FOUND = "Unit not found."
BED_NOT_FOUND = "Bed not found."

router = APIRouter(prefix="/shift-schedule", tags=["shift-schedule"])
_tenant = Depends(caller_tenant_id)


def _now() -> datetime:
    """The server's clock (a test sets it)."""
    return datetime.now(timezone.utc)


def _windows(request: Request, hospital: str, now: datetime) -> tuple[Shift, Shift]:
    """(current, next), by Görevlerim's two starts and the tenant's zone, read from the app's task store as GET /tasks
    reads them (§5 M4): the defaults (08 and 20, UTC) for a tenant that saved none, or an app without a store."""
    store = getattr(request.app.state, "tasks", None)
    settings = (store.settings(hospital) if store is not None else None) or DEFAULT_SETTINGS
    zone = zone_of(store.timezone(hospital) if store is not None else None)
    return shift_windows(now, zone, settings.shift_start_a, settings.shift_start_b)


async def _own_unit(db: AsyncSession, caller_tenant: uuid.UUID, unit_id: uuid.UUID) -> None:
    """404 unless the unit is the caller's tenant's: another tenant's is exactly a missing one (tenant/scope.py)."""
    scope.ensure_owned(await scope.tenant_of_unit(db, unit_id), caller_tenant, UNIT_NOT_FOUND)


def _in_reach(reach: Scope, unit_id: uuid.UUID) -> None:
    """403 `out_of_scope` unless the unit is one of the caller's: a unit grant, or an unrestricted caller. A bed grant
    names one bed, not its unit (D4)."""
    if not unitscope.reaches(reach, unit_id=unit_id, bed_id=None):
        raise Refusal(403, OUT_OF_SCOPE, "This unit is not one of your units.").http()


def _on_beds(columns, unit_ids: list[uuid.UUID]):
    """SELECT `columns` from the ACTIVE rows on the beds of `unit_ids` — a row is its bed's unit's (A8)."""
    return (select(*columns).select_from(NurseBedAssignment)
            .join(Bed, Bed.id == NurseBedAssignment.bed_id).join(Room, Room.id == Bed.room_id)
            .where(Room.unit_id.in_(unit_ids), NurseBedAssignment.is_active.is_(True)))


def _rows(unit_ids: list[uuid.UUID], start: datetime):
    """The active rows of the window keyed `start` on the beds of `unit_ids`, with the nurse's names."""
    return (_on_beds((NurseBedAssignment.id, NurseBedAssignment.bed_id, NurseBedAssignment.nurse_id, Room.unit_id,
                      User.full_name, User.username), unit_ids)
            .join(User, User.id == NurseBedAssignment.nurse_id)
            .where(NurseBedAssignment.shift_start == start))


def _others(columns, unit_ids: list[uuid.UUID], window: Shift, live: tuple[Shift, Shift], now: datetime):
    """The active rows of ANOTHER window that overlap `window` (A3: the shift hours changed meanwhile), as the code
    review bounded them (§5 A14): never a row of one of the two LIVE windows — the current or the next one, `window`
    itself included — whatever its stored end says (I1: shortened hours must not let one live window end the other's
    rows), and never a row whose shift has ended (M1: a finished night is history, not rewritten by a later save). The
    lower bound keeps the search to the days around the window: no window is longer than a day."""
    return _on_beds(columns, unit_ids).where(NurseBedAssignment.shift_start.notin_([w.start for w in live]),
                                             NurseBedAssignment.shift_start >= window.start - OTHERS_LOOKBACK,
                                             NurseBedAssignment.shift_start < window.end,
                                             NurseBedAssignment.shift_end > window.start,
                                             NurseBedAssignment.shift_end > now)


async def _held(db: AsyncSession, unit_id: uuid.UUID, window: Shift, live: tuple[Shift, Shift],
                now: datetime) -> tuple[list, list]:
    """The unit's active rows of the window and of the windows overlapping it, read under its lock: the PUT's `before`,
    what `expected` must equal, and the rows it ends."""
    rows = list((await db.execute(_rows([unit_id], window.start))).all())
    others = list((await db.execute(_others((NurseBedAssignment.id, NurseBedAssignment.bed_id,
                                             NurseBedAssignment.nurse_id), [unit_id], window, live, now))).all())
    return rows, others


async def _schedule(db: AsyncSession, units: list[tuple[uuid.UUID, str]], window: Shift,
                    live: tuple[Shift, Shift], now: datetime) -> ShiftSchedule:
    """The answer for `units` (id, name), in that order, each with its active rows of the window by bed id and the count
    of the overlapping rows of another window (`_others`)."""
    ids = [uid for uid, _ in units]
    rows = (await db.execute(_rows(ids, window.start))).all() if ids else []
    others = dict((await db.execute(_others((Room.unit_id, func.count(NurseBedAssignment.id)), ids, window, live, now)
                                    .group_by(Room.unit_id))).all()) if ids else {}
    items: dict[uuid.UUID, list[ShiftItem]] = {}
    for _, bed_id, nurse_id, unit_id, full_name, username in rows:
        items.setdefault(unit_id, []).append(ShiftItem(bed_id=bed_id, nurse_id=nurse_id,
                                                       nurse_name=full_name or username, nurse_username=username))
    return ShiftSchedule(
        shift=ShiftWindow(start=window.start, end=window.end, which=window.which),
        units=[ShiftUnit(unit_id=uid, unit_name=name, other_rows=others.get(uid, 0),
                         items=sorted(items.get(uid, []), key=lambda item: str(item.bed_id)))
               for uid, name in units],
        generated_at=now)


async def _reaching(db: AsyncSession, people: set[uuid.UUID], caller_tenant: uuid.UUID,
                    unit_id: uuid.UUID) -> dict[uuid.UUID, bool]:
    """Whether each person's own scope reaches the unit (A10), read as the board's resolver reads it: the picker's
    mark (`reaches_unit`)."""
    return {person: unitscope.reaches(await unitscope.caller_scope(db, person, caller_tenant), unit_id=unit_id,
                                      bed_id=None) for person in people}


async def _unreached(db: AsyncSession, asked: list[tuple[uuid.UUID, uuid.UUID]], caller_tenant: uuid.UUID,
                     unit_id: uuid.UUID) -> list[ShiftWarning]:
    """The PUT's soft warnings (A10; per bed since the code review, §5 A14 M6): one `unit_not_reached` for each nurse of
    the saved pairs whose own scope does not reach EVERY bed she is given — neither her unit nor the bed itself — so
    her board will not show that bed's patient. A nurse whose bed grants cover her beds is not warned. By id. One scope
    read per person (`unitscope.caller_scope`, the board's resolver's own reading): read after the commit, never under
    the unit's lock (M3)."""
    beds_of: dict[uuid.UUID, list[uuid.UUID]] = {}
    for bed, nurse in asked:
        beds_of.setdefault(nurse, []).append(bed)
    warnings = []
    for nurse in sorted(beds_of, key=str):
        reach = await unitscope.caller_scope(db, nurse, caller_tenant)
        if not all(unitscope.reaches(reach, unit_id=unit_id, bed_id=bed) for bed in beds_of[nurse]):
            warnings.append(ShiftWarning(code="unit_not_reached", nurse_id=nurse))
    return warnings


def _pairs(pairs) -> list[list[str]]:
    """(bed, nurse) pairs as the audit row writes them: ids as text, sorted."""
    return sorted([str(bed), str(nurse)] for bed, nurse in pairs)


@router.get("", response_model=ShiftSchedule)
async def read_shift_schedule(
    request: Request,
    shift: Literal["current", "next"] = Query(default="current"),
    unit_id: uuid.UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission(SHIFTS_MANAGE, WORKLOAD_VIEW)),
    caller_tenant: uuid.UUID = _tenant,
) -> ShiftSchedule:
    """D4: the window and the units in the caller's reach — her unit grants, every unit of her tenant when unrestricted
    — by name, each with its active rows of the window (a unit with none is listed with no item) and `other_rows`.
    `unit_id` asks for one unit: another tenant's or a missing one is a 404, one outside her units a 403 (§5 M3). Staff
    names only; no patient."""
    if unit_id is not None:
        await _own_unit(db, caller_tenant, unit_id)
    reach = await unitscope.caller_scope(db, user.id, caller_tenant)
    if unit_id is not None:
        _in_reach(reach, unit_id)
    stmt = (select(Unit.id, Unit.name).join(Site, Site.id == Unit.site_id)
            .where(Site.tenant_id == caller_tenant).order_by(Unit.name, Unit.id))
    within = unitscope.unit_clause(reach, unit_id=Unit.id)
    if within is not None:
        stmt = stmt.where(within)
    if unit_id is not None:
        stmt = stmt.where(Unit.id == unit_id)
    units = [(uid, name) for uid, name in (await db.execute(stmt)).all()]
    now = _now()
    live = _windows(request, await trail.hospital_of(db, caller_tenant), now)
    return await _schedule(db, units, live[0] if shift == "current" else live[1], live, now)


@router.get("/nurses", response_model=list[ShiftNurse])
async def shift_nurses(
    unit_id: uuid.UUID = Query(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission(SHIFTS_MANAGE)),
    caller_tenant: uuid.UUID = _tenant,
) -> list[ShiftNurse]:
    """§5 A10: whom the form offers for that unit — the tenant's active nurses and charge nurses (`service.nurse_ids`),
    whatever their grants, each with whether her own scope reaches the unit; the unit is checked as the PUT checks it.
    `name` is the full name, else the user name; sorted by it (case-folded), then the id."""
    await _own_unit(db, caller_tenant, unit_id)
    _in_reach(await unitscope.caller_scope(db, user.id, caller_tenant), unit_id)
    rows = (await db.execute(select(User.id, User.full_name, User.username)
                             .where(User.id.in_(service.nurse_ids(caller_tenant))))).all()
    reaching = await _reaching(db, {uid for uid, _, _ in rows}, caller_tenant, unit_id)
    people = [ShiftNurse(id=uid, name=full_name or username, username=username, reaches_unit=reaching[uid])
              for uid, full_name, username in rows]
    return sorted(people, key=lambda person: (person.name.casefold(), str(person.id)))


@router.put("", response_model=ShiftScheduleSaved)
async def put_shift_schedule(
    body: ShiftSchedulePut, request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission(SHIFTS_MANAGE)),
    caller_tenant: uuid.UUID = _tenant,
) -> ShiftScheduleSaved:
    """D4, §5 A1, A7, A10, M3, A14: replace one unit's assignment for one window (the module's docstring). Every check
    before anything is written, in this order: the unit and the beds are the caller's tenant's (404); the unit is one of
    her units (403); a bed is named once, and a person in a new pair is an active member of the tenant (422); then,
    under the unit's lock, the window is still the current or the next one (409 `shift_changed` — decided after the
    lock, A14 M2, so a save that waited on it past a shift change is refused), `expected` is what holds (409), and every
    NEW pair's bed is an open bed of that unit (the bed, its room and the unit open) and its person an offered one (422
    `field_invalid:items`). An empty `items` clears the window. The warnings are read after the commit (A14 M3)."""
    beds = [item.bed_id for item in body.items]
    expected = {(pair.bed_id, pair.nurse_id) for pair in body.expected}
    asked = [(item.bed_id, item.nurse_id) for item in body.items]
    await _own_unit(db, caller_tenant, body.unit_id)
    await scope.ensure_beds(db, caller_tenant, beds, BED_NOT_FOUND)
    _in_reach(await unitscope.caller_scope(db, user.id, caller_tenant), body.unit_id)
    if len(set(beds)) != len(beds):
        raise field_invalid("items", "A bed is named once.").http()
    await scope.ensure_members(db, caller_tenant, (nurse for bed, nurse in asked if (bed, nurse) not in expected))
    hospital, actor, user_id = await trail.hospital_of(db, caller_tenant), user.username, user.id
    # The unit's row lock (tenant/router.py `_lock_unit`), read afresh: what is read below holds until the commit.
    unit = (await db.execute(select(Unit).where(Unit.id == body.unit_id).with_for_update(key_share=True)
                             .execution_options(populate_existing=True))).scalar_one()
    unit_name, unit_open = unit.name, unit.is_active
    # The clock is read under the lock (A14 M2): the window named is checked as of the write, not of the request.
    now = _now()
    live = _windows(request, hospital, now)
    window = next((w for w in live if w.start == body.shift_start), None)
    if window is None:
        await db.rollback()                       # nothing written; the lock goes with it
        raise Refusal(409, SHIFT_CHANGED, "That shift is no longer the current or the next one.").http()
    rows, others = await _held(db, body.unit_id, window, live, now)
    held = {(row.bed_id, row.nurse_id) for row in rows}
    if expected != held:
        await db.rollback()                       # nothing written; the lock goes with it
        raise HTTPException(status.HTTP_409_CONFLICT, detail=CONCURRENT_CHANGE)
    new = [pair for pair in asked if pair not in held]
    open_beds = set((await db.execute(
        select(Bed.id).join(Room, Room.id == Bed.room_id)
        .where(Room.unit_id == body.unit_id, Bed.is_active.is_(True), Room.is_active.is_(True)))).scalars()
    ) if unit_open else set()
    if any(bed not in open_beds for bed, _ in new):
        await db.rollback()                       # nothing written; the lock goes with it
        raise field_invalid("items", "A bed is not an open bed of this unit.").http()
    people = {nurse for _, nurse in new}
    if people and people - set((await db.execute(service.nurse_ids(caller_tenant).where(User.id.in_(people))))
                               .scalars()):
        await db.rollback()                       # nothing written; the lock goes with it
        raise field_invalid("items", "A person is not one of this hospital's nurses.").http()
    ended = [row.id for row in rows if (row.bed_id, row.nurse_id) not in set(asked)] + [row.id for row in others]
    if ended:                                     # flushed before the inserts: the index cannot be deferred
        await db.execute(update(NurseBedAssignment).where(NurseBedAssignment.id.in_(ended))
                         .values(is_active=False, closed_at=now))
    db.add_all(NurseBedAssignment(unit_id=body.unit_id, bed_id=bed, nurse_id=nurse, charge_nurse_id=user_id,
                                  shift_start=window.start, shift_end=window.end) for bed, nurse in new)
    try:
        await db.flush()
    except IntegrityError as exc:                 # the index (bed, window) WHERE active: a coded 409, never a 500
        await db.rollback()
        if _broken_constraint(exc) == NURSE_BED_ACTIVE_INDEX:     # told apart by name, as the care team's two
            raise Refusal(409, ASSIGNMENT_CONFLICT, "Another save of this window came first.").http() from None
        raise                                     # anything else is not a lost race: raised as it is
    await db.commit()
    trail.record(request, hospital, SHIFT_ASSIGN, subject=str(body.unit_id), payload={
        "unit_id": str(body.unit_id), "shift_start": window.start.isoformat(), "shift_end": window.end.isoformat(),
        "before": _pairs(held), "after": _pairs(asked),
        "other": _pairs((row.bed_id, row.nurse_id) for row in others), "actor": actor})
    warnings = await _unreached(db, asked, caller_tenant, body.unit_id)
    saved = await _schedule(db, [(body.unit_id, unit_name)], window, live, now)
    return ShiftScheduleSaved(**saved.model_dump(), warnings=warnings)

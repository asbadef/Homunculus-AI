"""
FastAPI routes for the patient admission workflow (§4, §5).

Permission guards (see auth/permissions.py):
  * admissions.admit           open an admission
  * admissions.admit           print an admission's protocol label (G2-B1d)
  * admissions.view            list / read admissions, patients and care teams
  * admissions.sign_off        physician sign-off
  * admissions.move.initiate   initiate a transfer or discharge
  * admissions.transfer.confirm   confirm a transfer arrival
  (the two transfer routes are closed for now — 409 `transfer_unavailable`, A-37; see below)
  * admissions.discharge.confirm  confirm a discharge, release the bed
  * care_team.claim / .assign  claim or assign a care-team role
  * shifts.manage              shift schedules
  * handover.sign              open, sign, countersign a handover; read my handovers and the
                               colleagues I can hand over to (G2-B3b)

Tenant isolation (spec §5): every route also takes `caller_tenant_id` and acts on the caller's
tenant only. An admission, unit, bed or handover of another tenant, named in the path or in the
body, is a 404 identical to a missing one; a user of another tenant named in the body is a 422
(see tenant/scope.py). Every check runs before anything is written.

PHI: patient identity is returned by the patient-detail endpoint (`GET /admissions/{id}/patient`)
and — since Group 2 · B1a, for the Taburcu list — as the display name on each row of
`GET /admissions`, to holders of `admissions.view` in the patient's own tenant, as the board shows
it to `board.view`. Since G2-B3b, `GET /handovers` names the patient of each handover too — to its
two parties only, holders of `handover.sign`. Reads of these are not audited yet.

Group 2 · B3b (Vardiya devri): a handover is one patient. Opening one checks the patient's state
and the caller's units; the outgoing signature is held by an unacknowledged critical alert on the
LIVE board (`BoardLink.open_critical`, as the discharge is), stores the D-Ö-D-Ö note and seals the
board's summary (`BoardLink.handover_summary`); each step writes its audit row (`handover.*`).

Group 2 · B1a (Hasta Kabul): the admission, sign-off and discharge routes check the target bed's
unit against the caller's grants (admission/unitscope.py), write their audit row
(admission/trail.py) and reach the board only through `BoardLink` (admission/boardlink.py). Every
refusal carries a stable code beside its words (admission/errors.py).
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from contextlib import suppress
from datetime import date, datetime, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus import crypto
from homunculus.admission import form, service, trail, unitscope
from homunculus.admission.boardlink import board_link_of, kabul_record
from homunculus.admission.models import (
    OPEN_ADMISSION_STATES, OPEN_IDENTITY_INDEX, Admission, AdmissionState, CareTeamMember,
    DischargeDisposition, Handover, HandoverStatus, Patient,
)
from homunculus.admission.schemas import (
    AdmissionCreate, AdmissionDetail, AdmissionNoteFields, AdmissionResponse, AdmissionRow,
    AdmitResponse,
    AlertRetire, CareTeamAdd, CareTeamMemberResponse, Colleague, DischargeConfirmResponse,
    DischargeStart, EngineWrite, EngineWrites, HandoverNote, HandoverNoteOut, HandoverOpen,
    HandoverPatient, HandoverPerson, HandoverResponse, HandoverRow, HandoverSign, LabelAsk,
    PendingHandovers, PendingUnit,
    LabelResponse, LabelSettings, NurseBedAssignmentResponse, PatientResponse,
    ShiftScheduleCreate, ShiftScheduleResponse, TransferInitiate,
)
from homunculus.admission.errors import (
    BED_CLOSED, BED_RESERVED, DUPLICATE_OPEN_ADMISSION, INVALID_TRANSITION, NO_PROTOCOL,
    REQUEST_CONFLICT, TRANSFER_UNAVAILABLE, Refusal, field_invalid,
)
from homunculus.admission.numbers import next_patient_number
from homunculus.admission.boardkey import board_key
from homunculus.protocol.models import ProtocolSettings
from homunculus.protocol.numbers import next_protocol_no
from homunculus.admission.service import WorkflowError
from homunculus.auth.dependencies import caller_tenant_id, require_permission
from homunculus.auth.models import Group, GroupPermission, TenantMembership, User, UserGroup
from homunculus.db import get_db
from homunculus.api.patient_identity import IdentityRecord
from homunculus.scope import Scope
from homunculus.tenant import scope
from homunculus.tenant.models import Bed, BedState, Room, Site, Tenant, Unit

log = logging.getLogger(__name__)

router = APIRouter(prefix="/admissions", tags=["admissions"])

# The caller's tenant (the token's `tenant` claim); every route below takes it.
_tenant = Depends(caller_tenant_id)

ADMISSION_NOT_FOUND = "Admission not found."
PATIENT_NOT_FOUND = "Patient not found."
UNIT_NOT_FOUND = "Unit not found."
BED_NOT_FOUND = "Bed not found."
HANDOVER_NOT_FOUND = "Handover not found."


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _wf(exc: WorkflowError) -> HTTPException:
    """A business-rule refusal: 409, its stable code beside its words (admission/errors.py)."""
    return HTTPException(status_code=status.HTTP_409_CONFLICT,
                         detail={"code": exc.code, "message": str(exc)})


async def _get_admission_or_404(
    db: AsyncSession, admission_id: uuid.UUID, caller_tenant: uuid.UUID,
) -> Admission:
    """The admission, if it is the caller's tenant's; another tenant's is exactly as absent."""
    return await scope.get_owned(db, Admission, admission_id, caller_tenant, ADMISSION_NOT_FOUND)


async def _ensure_unit_and_bed(
    db: AsyncSession, unit_id: uuid.UUID, bed_id: uuid.UUID, caller_tenant: uuid.UUID,
) -> None:
    """The unit (unit → site → tenant) and the bed named in a body are the caller's tenant's."""
    scope.ensure_owned(await scope.tenant_of_unit(db, unit_id), caller_tenant, UNIT_NOT_FOUND)
    scope.ensure_owned(await scope.tenant_of_bed(db, bed_id), caller_tenant, BED_NOT_FOUND)


async def _get_handover_or_404(
    db: AsyncSession, handover_id: uuid.UUID, caller_tenant: uuid.UUID,
) -> Handover:
    """The handover, if its unit is the caller's tenant's."""
    scope.ensure_owned(await scope.tenant_of_handover(db, handover_id), caller_tenant,
                       HANDOVER_NOT_FOUND)
    return await db.get(Handover, handover_id)


# ---------------------------------------------------------------------------
# Create DRAFT admission (§4.1; Group 2 · B1a, spec §3.1)
# ---------------------------------------------------------------------------
#: Admissions committed whose answer is still being made — the board writes after the commit and
#: the engine report — by admission id (amendment A-19). A send of the same form that finds one
#: waits for that answer (`_answer_again`) instead of answering before it exists. One process
#: holds the engine and the board (uvicorn runs one worker), so this holds every such admission.
_ANSWERING: dict[uuid.UUID, asyncio.Event] = {}
#: How long a send of the same form waits for the first send's answer before it answers with what
#: was recorded. The board writes are in memory and take milliseconds.
ANSWER_WAIT_S = 10.0


def _now() -> datetime:
    """The server's clock for an admission: its form's `today` and `now`, its number's year."""
    return datetime.now(timezone.utc)


def hospital_today(zone_name: str | None, now: datetime) -> date:
    """The hospital's own date at `now`, which a date of birth is checked against (amendment A-10).

    `zone_name` is `Tenant.timezone`: "UTC" by default and unchecked when written (A-16). A name
    this server's time zone database does not hold is read as UTC, with a warning, never a 500;
    the form's day of slack (`form.BIRTH_SLACK`) still takes a child born in the hospital's early
    morning then. "UTC" needs no database: Windows has none without the `tzdata` package."""
    if not zone_name or zone_name == "UTC":
        return now.astimezone(timezone.utc).date()
    try:
        zone = ZoneInfo(zone_name)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        log.warning("the tenant's time zone %r is not known here: its date is read in UTC",
                    zone_name)
        return now.astimezone(timezone.utc).date()
    return now.astimezone(zone).date()


def _request_digest(payload: AdmissionCreate) -> str:
    """What tells two sends of one form apart (amendment A-19): the keyed digest
    (`crypto.phi_digest`: the body holds PHI) of the body as the server read it — every field,
    defaults written out, `request_id` and `confirm_reserved` left out — as one canonical JSON.
    A body that reads the same (keys in another order, a default sent or left out) is the same
    form; any field changed makes it another. So does the server: a resend that straddles a deploy
    changing the schema's defaults, or a rotation of the PHI key, reads as another form — a 409
    `request_conflict`."""
    # G2-B3a (X2): `confirm_reserved` is the nurse's answer about the bed, not the form.
    body = payload.model_dump(mode="json", exclude={"request_id", "confirm_reserved"})
    return crypto.phi_digest(json.dumps(body, sort_keys=True, separators=(",", ":"),
                                        ensure_ascii=False))


def _strip(value: str | None) -> str | None:
    """A form text as stored: trimmed, and None rather than empty."""
    return value.strip() or None if value is not None else None


async def _bed_of(db: AsyncSession, bed_id: uuid.UUID) -> tuple[Bed, Room, Unit]:
    """The bed with its room and unit, the bed row LOCKED for this transaction (spec §3.1) before
    anything pointing at it is written. FOR NO KEY UPDATE, the strength of every bed lock
    (tenant/router.py `_lock_bed`, amendment A-26): it lets an insert of a row pointing at the bed
    through. Read afresh under the lock (`populate_existing`): a bed this session had loaded before
    would otherwise come back as it was, and a second admission that waited here would read the
    bed AVAILABLE. The unit is the bed's room's, read here — the one the caller's grants are
    checked against (A-12, A-15)."""
    bed = (await db.execute(
        select(Bed).where(Bed.id == bed_id).with_for_update(key_share=True)
        .execution_options(populate_existing=True))).scalar_one()
    room = await db.get(Room, bed.room_id)
    return bed, room, await db.get(Unit, room.unit_id)


def _not_reached(*, weight_asked: bool, profile_asked: bool) -> EngineWrites:
    """Nothing is known to have reached the engine: every part the form asked for is `failed` —
    which sends the nurse to look — and a part it did not ask for is `skipped` (X53: `skipped`
    means "not asked", never "not done"). The card is always asked for."""
    return EngineWrites(weight="failed" if weight_asked else "skipped",
                        profile="failed" if profile_asked else "skipped", board="failed")


async def _attempt(key: str, what: str, write) -> EngineWrite:
    """One engine write, on its own: `ok`, or `failed` and logged with the board key, never a
    name."""
    try:
        await write()
        return "ok"
    except Exception:
        log.exception("admission %s: the %s did not reach the engine", key, what)
        return "failed"


def _card(*, key: str, display_name: str, date_of_birth: str, sex: str, bed_label: str,
          bed_id: uuid.UUID, unit_id: uuid.UUID) -> IdentityRecord:
    """The admission's board identity: the card on its bed (`kabul_record`), under its board key
    (`board_key`: the protocol number; a legacy admission's H-number)."""
    return kabul_record(patient_number=key, display_name=display_name,
                        birth_date=date.fromisoformat(date_of_birth), sex=sex,
                        bed_label=bed_label, bed_id=str(bed_id), unit_id=str(unit_id),
                        at=datetime.now(timezone.utc))


async def _to_board(request: Request, hospital: str, *, card: dict, note: AdmissionNoteFields,
                    actor: str) -> EngineWrites:
    """After the admission is committed (spec §3.1 step 3): the card, the weight, the profile —
    each on its own. One that does not land leaves the admission standing and is reported, so the
    screen can say which part to enter by hand (X53). `chart_weight` and `apply_profile` raise on
    any failure, an unwired door included (A-20, A-23, A-25). An app built without its BoardLink
    reached nothing: the parts asked for are `failed`, logged at ERROR. Logged with the board key,
    never a name.

    `card` is `_card`'s keywords as plain values, taken before the commit: nothing here reads the
    session, which a failure after the commit may have rolled back (and so expired)."""
    key = card["key"]
    link = board_link_of(request)
    if link is None:
        log.error("admission %s: this app has no BoardLink; the card, the weight and the "
                  "comorbidities did not reach the engine", key)
        return _not_reached(weight_asked=note.weight_kg is not None,
                            profile_asked=bool(note.comorbidity_codes))
    board = await _attempt(key, "identity",
                           lambda: link.put_identity(hospital, _card(**card)))
    weight = ("skipped" if note.weight_kg is None else await _attempt(
        key, "weight", lambda: link.chart_weight(hospital, key, note.weight_kg, actor=actor)))
    profile = ("skipped" if not note.comorbidity_codes else await _attempt(
        key, "profile", lambda: link.apply_profile(hospital, key, note.comorbidity_codes,
                                                   actor=actor)))
    return EngineWrites(weight=weight, profile=profile, board=board)


async def _keep_report(db: AsyncSession, admission_id: uuid.UUID, engine: EngineWrites) -> None:
    """Record on the admission what reached the engine, for a send of the same form to answer
    with (A-19). After the commit, as the audit row is: a failure here is logged, and never turns
    the committed admission into an error (A-26)."""
    try:
        await db.execute(update(Admission).where(Admission.id == admission_id)
                         .values(engine_writes=engine.model_dump())
                         .execution_options(synchronize_session=False))
        await db.commit()
    except Exception:  # noqa: BLE001 — the admission has committed already
        log.exception("admission %s: what reached the engine was not recorded", admission_id)
        with suppress(Exception):
            await db.rollback()


async def _earlier(db: AsyncSession, tenant_id: uuid.UUID,
                   request_id: uuid.UUID) -> Admission | None:
    """The admission an earlier send of this form made, if one did."""
    return (await db.execute(select(Admission).where(
        Admission.tenant_id == tenant_id, Admission.request_id == request_id))).scalar_one_or_none()


async def _open_admission_of(db: AsyncSession, tenant_id: uuid.UUID, identity: str):
    """The patient number, protocol, bed and unit (the bed's room's, A-12) of the open admission
    of the person `identity` names (`form.identity_digest`) in the tenant, if she has one (A-37)."""
    return (await db.execute(
        select(Patient.patient_number, Admission.protocol_no, Admission.bed_id, Room.unit_id)
        .select_from(Admission)
        .join(Patient, Patient.id == Admission.patient_id)
        .join(Bed, Bed.id == Admission.bed_id)
        .join(Room, Room.id == Bed.room_id)
        .where(Admission.tenant_id == tenant_id, Admission.identity_digest == identity,
               Admission.state.in_(list(OPEN_ADMISSION_STATES)))
        .limit(1))).first()


def _duplicate(found, reach: Scope) -> Refusal:
    """409 `duplicate_open_admission` (A-37): the person already has an open admission in this
    tenant, and it is discharged before another is opened. Its number goes beside the code only
    when the caller's units hold its bed (A-12: the bed's room's unit), so the screen can name it
    — never a name. The refusal stands either way, and stands when that admission is not found
    any more (the index saw it at the flush; it has closed since)."""
    known = found is not None and unitscope.reaches(reach, unit_id=found.unit_id,
                                                    bed_id=found.bed_id)
    return Refusal(409, DUPLICATE_OPEN_ADMISSION, "This person already has an open admission: "
                   "it is discharged before another is opened.",
                   extra=_numbers(found.patient_number, found.protocol_no) if known else None)


def _numbers(patient_number: str, protocol_no: str | None) -> dict:
    """What a refusal names an admission by, beside its code (E6): its H-number and its board key
    — the number the screen sends the nurse to look for. Never a name."""
    return {"patient_number": patient_number, "board_key": board_key(protocol_no, patient_number)}


def _broken_constraint(exc: IntegrityError) -> str | None:
    """The name of the constraint or unique index an insert broke, as PostgreSQL reports it:
    asyncpg's `constraint_name` (under SQLAlchemy's adapter, the adapted error's cause), else read
    from the message. None when neither names one."""
    for error in (exc.orig, getattr(exc.orig, "__cause__", None)):
        name = getattr(error, "constraint_name", None)
        if name:
            return name
    named = re.search(r'constraint "([^"]+)"', str(exc.orig))
    return named.group(1) if named else None


async def _board_again(db: AsyncSession, request: Request, hospital: str, admission_id: uuid.UUID,
                       *, weight_asked: bool, actor: str) -> EngineWrites:
    """The board writes of an admission whose first send died between its commit and its board
    writes — no report recorded and no send writing now (the coordinator's decision on Task 8's
    review). The two that are idempotent are written again: the card on its bed and the
    comorbidities. The weight is not: charting it again could chart it twice, so it is answered
    `failed` and the nurse checks it. Only for an admission still open — a discharged or
    transferred one keeps the board it has. The transaction is ended before the writes."""
    row = (await db.execute(
        select(Admission.state, Admission.comorbidity_codes, Admission.protocol_no,
               Patient.patient_number, Patient.display_name, Patient.date_of_birth, Patient.sex,
               Bed.id, Bed.label, Room.unit_id)
        .join(Patient, Patient.id == Admission.patient_id)
        .join(Bed, Bed.id == Admission.bed_id)
        .join(Room, Room.id == Bed.room_id)
        .where(Admission.id == admission_id))).one()
    await db.commit()
    (state, codes, protocol_no, number, display_name, date_of_birth, sex, bed_id, bed_label,
     unit_id) = row
    key = board_key(protocol_no, number)
    link = board_link_of(request)
    if state not in OPEN_ADMISSION_STATES or link is None:
        log.error("admission %s (%s): its board writes are not known and are not written again "
                  "(%s)", key, state.value, "no BoardLink" if link is None else "not open")
        return _not_reached(weight_asked=weight_asked, profile_asked=bool(codes))
    log.warning("admission %s: its first send stopped before the board; the card and the "
                "comorbidities are written again, the weight is not", key)
    board = await _attempt(key, "identity (again)", lambda: link.put_identity(hospital, _card(
        key=key, display_name=display_name, date_of_birth=date_of_birth, sex=sex,
        bed_label=bed_label, bed_id=bed_id, unit_id=unit_id)))
    profile = ("skipped" if not codes else await _attempt(
        key, "profile (again)", lambda: link.apply_profile(hospital, key, codes, actor=actor)))
    return EngineWrites(weight="failed" if weight_asked else "skipped", profile=profile,
                        board=board)


#: How many times a resend looks again when another send of the form took up the board writes
#: while it read (`_engine_of`), before it answers what is not known as not reached.
_ROUNDS = 3


async def _engine_of(db: AsyncSession, request: Request, hospital: str, admission_id: uuid.UUID,
                     key: str, *, weight_asked: bool, profile_asked: bool,
                     actor: str) -> EngineWrites:
    """What reached the engine for an admission a resend found (A-19), once nobody is writing it.

    A send still writing to the board (`_ANSWERING`) is waited for, up to `ANSWER_WAIT_S`, with
    no transaction open. If it is still at it then, nothing is known yet: the parts asked for are
    `failed`, nothing is written again (that send may land them), and a WARNING says so. Then the
    recorded report is the answer. With none recorded and nobody writing, this send writes the
    idempotent parts again (`_board_again`) under its own `_ANSWERING` entry — so another resend
    waits for it — and records what it did."""
    for _ in range(_ROUNDS):
        answering = _ANSWERING.get(admission_id)
        if answering is not None:
            try:
                await asyncio.wait_for(answering.wait(), ANSWER_WAIT_S)
            except TimeoutError:
                log.warning("admission %s: a resend of its form waited %ss for the first send's "
                            "board writes and answers the parts asked for as failed", key,
                            ANSWER_WAIT_S)
                return _not_reached(weight_asked=weight_asked, profile_asked=profile_asked)
        report = (await db.execute(select(Admission.engine_writes)
                                   .where(Admission.id == admission_id))).scalar_one()
        await db.commit()
        if report:
            return EngineWrites.model_validate(report)
        if admission_id not in _ANSWERING:     # nobody took the writes up while this one read
            break
    else:
        return _not_reached(weight_asked=weight_asked, profile_asked=profile_asked)
    retrying = _ANSWERING[admission_id] = asyncio.Event()
    try:
        engine = await _board_again(db, request, hospital, admission_id,
                                    weight_asked=weight_asked, actor=actor)
        await _keep_report(db, admission_id, engine)
    finally:
        retrying.set()
        _ANSWERING.pop(admission_id, None)
    return engine


async def _answer_again(db: AsyncSession, request: Request, response: Response, *,
                        hospital: str, tenant_id: uuid.UUID, request_id: uuid.UUID, digest: str,
                        reach: Scope, actor: str) -> AdmitResponse:
    """A send of a form already admitted (amendment A-19). The same form — the same digest — is
    answered with that admission's answer: 200, the first answer's body, its engine report as
    `_engine_of` finds it. Another form under the same id is refused `request_conflict`, the
    earlier admission's number beside the code when the caller's units hold its bed (so the screen
    can name it; never a name). The caller has rolled this send's transaction back: it keeps no
    lock and gives back any number it took; this one ends its reads before it waits."""
    earlier = (await db.execute(select(Admission).where(
        Admission.tenant_id == tenant_id, Admission.request_id == request_id))).scalar_one()
    number = (await db.execute(select(Patient.patient_number)
                               .where(Patient.id == earlier.patient_id))).scalar_one()
    if earlier.request_digest != digest:
        unit_id = (await db.execute(select(Room.unit_id).join(Bed, Bed.room_id == Room.id)
                                    .where(Bed.id == earlier.bed_id))).scalar_one()
        known = unitscope.reaches(reach, unit_id=unit_id, bed_id=earlier.bed_id)
        extra = _numbers(number, earlier.protocol_no) if known else None
        raise Refusal(409, REQUEST_CONFLICT, "This request id came before with another admission "
                      "form.", extra=extra).http()
    first = AdmissionResponse.model_validate(earlier)
    key = board_key(earlier.protocol_no, number)
    admission_id, weight_asked = earlier.id, earlier.weight_kg is not None
    profile_asked = bool(earlier.comorbidity_codes)
    await db.commit()                  # no transaction, and no pooled connection, while it waits
    engine = await _engine_of(db, request, hospital, admission_id, key,
                              weight_asked=weight_asked, profile_asked=profile_asked, actor=actor)
    log.info("admission %s: the same form sent again, answered with its admission", key)
    response.status_code = status.HTTP_200_OK
    return AdmitResponse(**first.model_dump(), patient_number=number, board_key=key, engine=engine)


@router.post("", response_model=AdmitResponse, status_code=201,
             responses={200: {"model": AdmitResponse,
                              "description": "The form was sent before under this request_id: "
                                             "the admission it made (amendment A-19)."}})
async def create_admission(
    payload: AdmissionCreate, request: Request, response: Response,
    db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = _tenant,
    user: User = Depends(require_permission("admissions.admit")),
):
    """Group 2 · B1a (spec §3.1): one request, one transaction. The form is checked
    (admission/form.py) against the hospital's own date; the bed row is locked and must be in the
    unit the form names, in the caller's units, open, and AVAILABLE, or RESERVED with
    `confirm_reserved` (G2-B3a, D5); the admission takes the
    tenant's next protocol number (protocol/numbers.py — none set: `protocol_not_configured`,
    G2-B1d D5) and the patient a fresh H-number (admission/numbers.py); the admission is DRAFT and
    the bed OCCUPIED. After the commit the board gets its card under the admission's board key
    (the protocol, `board_key`) and the engine the weight and the comorbidities (`_to_board`); the
    answer says which of those landed.

    A form sent again under its `request_id` (A-19) is looked for once the bed is locked — a second
    send of the same form waits there for the first to commit — and answered by `_answer_again`.
    One that gets past that look-up (another form under the id, so another bed and no lock between
    the two) is stopped by the unique `(tenant_id, request_id)` at its flush and answered the same
    way.

    Then, before `bed_closed` and the rest, one open admission per person (A-37): a form for
    someone — the same name and birth date (`form.identity_digest`) — who already has an open
    admission in the tenant is refused `duplicate_open_admission` (`_duplicate`). The look-up under
    the bed lock gives the friendly answer; two sends for one person to two beds are not ordered
    by one bed lock, and the open-identity index stops the second at its flush — the same refusal,
    told apart from the request id's constraint by the index's name."""
    # The admitting unit and the bed belong to the caller's tenant and the attending is a member
    # of it, all checked before the patient row is written.
    await _ensure_unit_and_bed(db, payload.note.admitting_unit_id, payload.note.bed_id,
                               caller_tenant)
    await scope.ensure_members(db, caller_tenant, [payload.note.attending_physician_id])

    hospital, zone = (await db.execute(select(Tenant.slug, Tenant.timezone)
                                       .where(Tenant.id == caller_tenant))).one()
    now = _now()
    digest = None if payload.request_id is None else _request_digest(payload)
    identity = form.identity_digest(payload.patient.display_name, payload.patient.date_of_birth)
    # The caller as plain values: a rollback below expires every object of this session, the
    # caller's own `User` (loaded by the permission check) included.
    actor, user_id = user.username, user.id

    async def answer_again() -> AdmitResponse:
        return await _answer_again(db, request, response, hospital=hospital,
                                   tenant_id=caller_tenant, request_id=payload.request_id,
                                   digest=digest, reach=reach, actor=actor)

    try:
        form.check_admission(payload, today=hospital_today(zone, now), now=now)
        bed, room, unit = await _bed_of(db, payload.note.bed_id)
        if unit.id != payload.note.admitting_unit_id:
            raise field_invalid("admitting_unit_id", "The bed is not in that unit.")
        reach = await unitscope.caller_scope(db, user_id, caller_tenant)
        unitscope.require_reach(reach, unit_id=unit.id, bed_id=bed.id)
        if payload.request_id is not None and \
                await _earlier(db, caller_tenant, payload.request_id) is not None:
            await db.rollback()
            return await answer_again()
        if identity is not None and \
                (found := await _open_admission_of(db, caller_tenant, identity)) is not None:
            raise _duplicate(found, reach)
        if not (bed.is_active and room.is_active and unit.is_active):
            raise Refusal(409, BED_CLOSED, "The bed, its room or its unit is closed.")
        # G2-B3a (D5, X1): a reserved bed takes the patient only when the form says the nurse
        # saw the reservation. The refusal names the bed, never the note (`Refusal`'s rule); the
        # form reads the note from GET /tenant/occupancy. Before the protocol is issued: nothing
        # is spent on a refusal. The bed is locked here (`_bed_of`), so the state holds.
        if bed.state == BedState.RESERVED and not payload.confirm_reserved:
            raise Refusal(409, BED_RESERVED, "The bed is reserved: the admission must confirm it.",
                          extra={"bed_id": str(bed.id)})
        was_reserved = bed.state == BedState.RESERVED
        # G2-B1d (spec §3, D1, D5): the protocol first, then the H-number — one lock order for
        # every admission. No start number set: `protocol_not_configured`, nothing written.
        protocol_no = await next_protocol_no(db, caller_tenant)
        number = await next_patient_number(db, caller_tenant, now=now)
    except Refusal as exc:
        raise exc.http() from None
    p = payload.patient
    patient = Patient(
        tenant_id=caller_tenant,
        patient_number=number,
        display_name=p.display_name.strip(),
        date_of_birth=p.date_of_birth.isoformat(),
        sex=p.sex.value,
        his_patient_reference=_strip(p.his_patient_reference),
        father_name=_strip(p.father_name), nationality=_strip(p.nationality),
        national_id=(_strip(p.national_id) or "").upper() or None,
        passport_no=_strip(p.passport_no), phone=_strip(p.phone),
        relative_name=_strip(p.relative_name), relative_relation=_strip(p.relative_relation),
        relative_phone=_strip(p.relative_phone), companion_name=_strip(p.companion_name),
        consent=p.consent, sms_permitted=p.sms_permitted,
    )
    db.add(patient)
    await db.flush()

    note = payload.note.model_dump()
    note["allergies_text"] = _strip(note["allergies_text"])
    note["comorbidities_text"] = _strip(note["comorbidities_text"])
    try:
        admission = await service.create_draft_admission(
            db, tenant_id=caller_tenant, patient=patient, note_fields=note,
            request_id=payload.request_id, request_digest=digest, identity_digest=identity,
            protocol_no=protocol_no, reserved_ok=payload.confirm_reserved,
        )
    except WorkflowError as exc:
        raise _wf(exc)
    except IntegrityError as exc:
        broken = _broken_constraint(exc)
        await db.rollback()
        # In the look-ups' order: an earlier send under this id first (A-19), then the person.
        if payload.request_id is not None and \
                await _earlier(db, caller_tenant, payload.request_id) is not None:
            return await answer_again()
        if broken == OPEN_IDENTITY_INDEX:
            raise _duplicate(await _open_admission_of(db, caller_tenant, identity),
                             reach).http() from None
        raise

    # Everything the answer, the audit row and the card need is taken before the commit, as plain
    # values: what can still fail after it (reading the row back, the board) loses none of them.
    admission_id, written = admission.id, AdmissionResponse.model_validate(admission)
    key = board_key(protocol_no, number)
    card = {"key": key, "display_name": patient.display_name,
            "date_of_birth": patient.date_of_birth, "sex": patient.sex, "bed_label": bed.label,
            "bed_id": bed.id, "unit_id": unit.id}
    # Registered before the commit, so a send of the same form that sees this admission sees it.
    answered = _ANSWERING[admission_id] = asyncio.Event()
    try:
        await db.commit()
        # E4: the row's patient is the card's key; both numbers stay on record, never a name.
        trail.record(request, hospital, "admission.admit", patient_id=key,
                     payload={"admission_id": str(admission_id), "bed_id": str(card["bed_id"]),
                              "unit_id": str(card["unit_id"]), "actor": actor,
                              "protocol_no": protocol_no, "patient_number": number,
                              **({"bed_was_reserved": True} if was_reserved else {})})   # X9
        try:
            # Read back, so this answer and a resend's (read from the row) are the same body.
            await db.refresh(admission)
            written = AdmissionResponse.model_validate(admission)
            await db.commit()        # no transaction held across the board writes
        except Exception:  # noqa: BLE001 — the admission and its audit row are written already
            log.exception("admission %s: committed, but not read back; answered as written", key)
            with suppress(Exception):
                await db.rollback()
        engine = await _to_board(request, hospital, card=card, note=payload.note, actor=actor)
        answer = AdmitResponse(**written.model_dump(), patient_number=number, board_key=key,
                               engine=engine)
        await _keep_report(db, admission_id, engine)
    finally:
        answered.set()
        _ANSWERING.pop(admission_id, None)
    return answer


# ---------------------------------------------------------------------------
# List / detail
# ---------------------------------------------------------------------------
#: The most rows `GET /admissions` answers (newest first). One ward's open admissions are a few
#: dozen; the cap keeps a closed-state query from reading a hospital's history in one answer.
ADMISSION_LIST_CAP = 500
#: The header a list cut at `ADMISSION_LIST_CAP` carries, so a screen can say the list is not whole
#: (Task 8 re-review). A browser on another origin reads it only once the app's CORS exposes it.
TRUNCATED_HEADER = "X-Result-Truncated"


@router.get("", response_model=list[AdmissionRow])
async def list_admissions(
    response: Response,
    unit_id: uuid.UUID | None = None,
    state: list[AdmissionState] | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = _tenant,
    user: User = Depends(require_permission("admissions.view")),
):
    """Newest first, each row with the names a screen shows (G2-B1a, X61: the Taburcu and Yataklar
    lists, the sign-off badge). `state` narrows to those states (repeatable); without it, the open
    ones (`OPEN_ADMISSION_STATES`: DRAFT, ACTIVE, PENDING_DISCHARGE, PENDING_TRANSFER). At most
    `ADMISSION_LIST_CAP` rows: one more is read to know whether the list goes on, and a list cut
    there answers `X-Result-Truncated: 1` and logs a WARNING (the cap, the caller and the tenant;
    never a patient). A list of exactly the cap is whole. The rows are limited to the caller's
    units in the query (`unitscope.reach_clause`), the unit being the bed's room's, never the
    admission's `admitting_unit_id` (A-12). Of the patient, the query reads the number and the
    name, the two the row shows — no other encrypted column is read or decrypted."""
    reach = await unitscope.caller_scope(db, user.id, caller_tenant)
    stmt = (select(Admission, Patient.patient_number, Patient.display_name, Bed.label, Room.name,
                   Unit.name)
            .join(Patient, Patient.id == Admission.patient_id)
            .join(Bed, Bed.id == Admission.bed_id)
            .join(Room, Room.id == Bed.room_id)
            .join(Unit, Unit.id == Room.unit_id)
            .where(Admission.tenant_id == caller_tenant,
                   Admission.state.in_(list(state or OPEN_ADMISSION_STATES))))
    within = unitscope.reach_clause(reach, unit_id=Unit.id, bed_id=Bed.id)
    if within is not None:
        stmt = stmt.where(within)
    if unit_id is not None:
        stmt = stmt.where(Admission.admitting_unit_id == unit_id)
    cap = ADMISSION_LIST_CAP
    rows = (await db.execute(stmt.order_by(Admission.created_at.desc()).limit(cap + 1))).all()
    if len(rows) > cap:
        rows = rows[:cap]
        response.headers[TRUNCATED_HEADER] = "1"
        log.warning("GET /admissions: the list was cut at its cap (%d) for %s in tenant %s; older "
                    "rows were left out", cap, user.username, caller_tenant)
    return [AdmissionRow(**AdmissionResponse.model_validate(a).model_dump(),
                         patient_number=number, board_key=board_key(a.protocol_no, number),
                         display_name=name, bed_label=label, room_name=room, unit_name=unit)
            for a, number, name, label, room, unit in rows]


@router.get("/{admission_id}", response_model=AdmissionDetail,
            dependencies=[Depends(require_permission("admissions.view"))])
async def get_admission(
    admission_id: uuid.UUID, db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = _tenant,
):
    """The admission, its H-number and its board key (G2-B1d, E5)."""
    admission = await _get_admission_or_404(db, admission_id, caller_tenant)
    number = (await db.execute(select(Patient.patient_number)
                               .where(Patient.id == admission.patient_id))).scalar_one()
    return AdmissionDetail(**AdmissionResponse.model_validate(admission).model_dump(),
                           patient_number=number,
                           board_key=board_key(admission.protocol_no, number))


@router.get("/{admission_id}/patient", response_model=PatientResponse,
            dependencies=[Depends(require_permission("admissions.view"))])
async def get_admission_patient(
    admission_id: uuid.UUID, db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = _tenant,
):
    """PHI detail. Patient identity is returned only by this endpoint, to holders of
    `admissions.view` in the patient's own tenant. Reads of it are not audited yet."""
    admission = await _get_admission_or_404(db, admission_id, caller_tenant)
    return await scope.get_owned(db, Patient, admission.patient_id, caller_tenant,
                                 PATIENT_NOT_FOUND)


# ---------------------------------------------------------------------------
# Sign-off and discharge: what the three routes share (Group 2 · B1a, spec §3.2, §3.3)
# ---------------------------------------------------------------------------
async def _reach_admission(db: AsyncSession, user_id: uuid.UUID, caller_tenant: uuid.UUID,
                           admission: Admission) -> uuid.UUID:
    """403 `out_of_scope` unless the admission's bed is in the caller's units (spec §4.5). The
    unit is the bed's room's, read here — never the row's `admitting_unit_id`, which a transfer
    sets from its request body (A-12). The admission is the caller's tenant's already
    (`_get_admission_or_404`), and so is its bed. Returns that unit: the one a handover of the
    admission is stored under (G4-02 review), so the rule has one reader."""
    unit_id = (await db.execute(select(Room.unit_id).join(Bed, Bed.room_id == Room.id)
                                .where(Bed.id == admission.bed_id))).scalar_one()
    try:
        unitscope.require_reach(await unitscope.caller_scope(db, user_id, caller_tenant),
                                unit_id=unit_id, bed_id=admission.bed_id)
    except Refusal as exc:
        raise exc.http() from None
    return unit_id


async def _locked(db: AsyncSession, admission: Admission, *also: uuid.UUID) -> Admission:
    """The admission's bed row and then its own, locked for the rest of the transaction and read
    afresh (A-10, A-26): two sign-offs, starts, confirmations or transfers of one admission at
    once run one after the other, and the second reads what the first committed — refused by the
    state machine as `invalid_transition` — instead of both passing a check made on a stale read.

    `also`: other beds the transaction writes or must find free — a transfer's target (review
    M-1), checked AVAILABLE only once it is locked, so an admission into it at the same moment is
    waited for. No route passes one while the transfer routes are closed (A-37); it is kept for
    the slice that reopens them. Every bed is locked in the order of its id, then the admission:
    two transactions that both need two beds take them in the same order and cannot wait on each
    other in a circle.

    Both locks are FOR NO KEY UPDATE, the strength of every unit and bed lock (tenant/router.py
    `_lock_bed`): an insert of a row pointing at the bed, or at the admission (a care-team
    member), still goes through. The bed first, then the admission row that points at it: a row
    pointing at a bed is written only under that bed's lock, as the admission route writes its
    own (A-26), so a relabel holding the bed is waited for here, holding nothing.
    `populate_existing`: the rows this session read before the locks would otherwise come back as
    they were then. An admission's bed never changes (a transfer makes a new admission), so the
    bed read before the lock is the bed."""
    for bed_id in sorted({admission.bed_id, *also}):
        await db.execute(select(Bed).where(Bed.id == bed_id)
                         .with_for_update(key_share=True)
                         .execution_options(populate_existing=True))
    return (await db.execute(select(Admission).where(Admission.id == admission.id)
                             .with_for_update(key_share=True)
                             .execution_options(populate_existing=True))).scalar_one()


def _not_now(exc: ValueError) -> HTTPException:
    """A state machine's own refusal (`Admission`/`Bed.transition_to`) — a bed moved by hand
    under a discharge — as the 409 `invalid_transition` it is, never a 500 (A-10)."""
    return Refusal(409, INVALID_TRANSITION, str(exc)).http()


async def _key_of(db: AsyncSession, admission: Admission) -> str:
    """The admission's board key (`board_key`: its protocol, a legacy admission's H-number) — the
    card the board steps act on, the key they log, and the audit row's patient (E4)."""
    number = (await db.execute(select(Patient.patient_number)
                               .where(Patient.id == admission.patient_id))).scalar_one()
    return board_key(admission.protocol_no, number)


def _open_critical(request: Request, hospital: str, key: str) -> int:
    """The critical alerts on this patient's board nobody acknowledged (`BoardLink.open_critical`:
    firing or latched, the alerts the clinician sees), which hold a discharge's start and its
    confirmation, and a handover's outgoing signature (G2-B3b, D3). Only an app assembled without
    its board (a test mounting the routers alone) has no BoardLink; it has no engine either, so no
    alert — logged at ERROR, and none counted."""
    link = board_link_of(request)
    if link is None:
        log.error("patient %s: this app has no BoardLink; no critical alarm could be read", key)
        return 0
    return link.open_critical(hospital, key)


def _board_summary(request: Request, hospital: str, key: str) -> dict | None:
    """What the board shows of this patient now (`BoardLink.handover_summary`, G2-B3b D6), for a
    handover to seal at its outgoing signature — or None from an app assembled without its board,
    logged at ERROR as `_open_critical` logs it. Never a name."""
    link = board_link_of(request)
    if link is None:
        log.error("patient %s: this app has no BoardLink; no handover summary could be read", key)
        return None
    return link.handover_summary(hospital, key)


# ---------------------------------------------------------------------------
# Sign-off DRAFT → ACTIVE (§4.1 steps 4–5)
# ---------------------------------------------------------------------------
@router.post("/{admission_id}/sign-off", response_model=AdmissionResponse)
async def sign_off(
    admission_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("admissions.sign_off")),
    caller_tenant: uuid.UUID = _tenant,
):
    """G2-B1a (spec §3.2): the physician who signs a DRAFT with no attending becomes its
    attending — no physician picker in this slice (and no care-team row: O45). The bed must be in
    her units. The answer is made before the commit from what was written; after it, only the
    audit row `admission.sign_off`, which never raises (A-26)."""
    admission = await _get_admission_or_404(db, admission_id, caller_tenant)
    await _reach_admission(db, user.id, caller_tenant, admission)
    admission = await _locked(db, admission)
    if admission.state == AdmissionState.DRAFT and admission.attending_physician_id is None:
        admission.attending_physician_id = user.id
    try:
        await service.sign_off_admission(db, admission, signing_user_id=user.id)
    except WorkflowError as exc:
        raise _wf(exc)
    except ValueError as exc:
        raise _not_now(exc) from None
    key = await _key_of(db, admission)
    hospital = await trail.hospital_of(db, caller_tenant)
    written, actor = AdmissionResponse.model_validate(admission), user.username
    await db.commit()
    trail.record(request, hospital, "admission.sign_off", patient_id=key,
                 payload={"admission_id": str(written.id), "actor": actor})
    return written


# ---------------------------------------------------------------------------
# The protocol label (Group 2 · B1d, spec §6)
# ---------------------------------------------------------------------------
#: The label a tenant with no settings row prints (spec D6): 50×30 mm, 203 dpi.
_DEFAULT_LABEL = LabelSettings(width_mm=50, height_mm=30, printer_dpi=203)


@router.post("/{admission_id}/label", response_model=LabelResponse)
async def admission_label(
    admission_id: uuid.UUID,
    request: Request,
    payload: LabelAsk | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("admissions.admit")),
    caller_tenant: uuid.UUID = _tenant,
):
    """G2-B1d (spec §6, D11): the label's fields, for a holder of `admissions.admit` whose units
    hold the admission's bed (the unit is the bed's room's, A-12). An admission without a protocol
    (one opened before 0015) has no label: 409 `no_protocol`. A discharged admission's label can
    still be printed (amendment A-2), audited like any other. Every print is audited
    `admission.label_print` — who, the admission, its protocol, `reprint` — never the name, after
    the read (it never raises, A-26). Nothing is written in the database."""
    admission = await _get_admission_or_404(db, admission_id, caller_tenant)
    await _reach_admission(db, user.id, caller_tenant, admission)
    if admission.protocol_no is None:
        raise Refusal(409, NO_PROTOCOL,
                      "This admission has no protocol number, so no label.").http()
    name, born, sex, bed_label, unit_name = (await db.execute(
        select(Patient.display_name, Patient.date_of_birth, Patient.sex, Bed.label, Unit.name)
        .select_from(Admission)
        .join(Patient, Patient.id == Admission.patient_id)
        .join(Bed, Bed.id == Admission.bed_id)
        .join(Room, Room.id == Bed.room_id)
        .join(Unit, Unit.id == Room.unit_id)
        .where(Admission.id == admission.id))).one()
    settings = await db.get(ProtocolSettings, caller_tenant)
    label = _DEFAULT_LABEL if settings is None else LabelSettings(
        width_mm=settings.label_width_mm, height_mm=settings.label_height_mm,
        printer_dpi=settings.printer_dpi)
    answer = LabelResponse(protocol_no=admission.protocol_no, display_name=name,
                           date_of_birth=born, sex=sex, unit_name=unit_name, bed_label=bed_label,
                           label=label)
    hospital = await trail.hospital_of(db, caller_tenant)
    reprint, actor = bool(payload and payload.reprint), user.username
    await db.commit()
    trail.record(request, hospital, "admission.label_print", patient_id=answer.protocol_no,
                 payload={"admission_id": str(admission.id), "protocol_no": answer.protocol_no,
                          "reprint": reprint, "actor": actor})
    return answer


# ---------------------------------------------------------------------------
# Care team (§4.2–4.3)
# ---------------------------------------------------------------------------
@router.post("/{admission_id}/care-team/claim", response_model=CareTeamMemberResponse)
async def claim_attending(
    admission_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("care_team.claim")),
    caller_tenant: uuid.UUID = _tenant,
):
    admission = await _get_admission_or_404(db, admission_id, caller_tenant)
    # The caller becomes the attending of record. There is no claiming on someone else's
    # behalf here: adding another clinician goes through POST .../care-team (care_team.assign).
    member = await service.claim_attending(
        db, admission, attending_id=user.id, granted_by_id=user.id,
    )
    await db.commit()
    await db.refresh(member)
    return member


@router.post("/{admission_id}/care-team", response_model=CareTeamMemberResponse, status_code=201)
async def add_care_team_member(
    admission_id: uuid.UUID,
    payload: CareTeamAdd,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("care_team.assign")),
    caller_tenant: uuid.UUID = _tenant,
):
    admission = await _get_admission_or_404(db, admission_id, caller_tenant)
    await scope.ensure_members(db, caller_tenant, [payload.user_id])
    try:
        member = await service.add_care_team_member(
            db, admission, user_id=payload.user_id, role=payload.role,
            granted_by_id=user.id, window_start=payload.window_start,
            window_end=payload.window_end,
        )
    except WorkflowError as exc:
        raise _wf(exc)
    await db.commit()
    await db.refresh(member)
    return member


@router.get("/{admission_id}/care-team", response_model=list[CareTeamMemberResponse],
            dependencies=[Depends(require_permission("admissions.view"))])
async def list_care_team(
    admission_id: uuid.UUID, db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = _tenant,
):
    await _get_admission_or_404(db, admission_id, caller_tenant)
    result = await db.execute(
        select(CareTeamMember).where(CareTeamMember.admission_id == admission_id)
    )
    return list(result.scalars().all())


# ---------------------------------------------------------------------------
# Transfer (§4.6) — CLOSED (amendment A-37, the user's decision of 2026-10-27)
# ---------------------------------------------------------------------------
# Both routes answer 409 `transfer_unavailable` and write nothing. They keep their permission
# guards (tests/test_route_permissions.py) and their tenant checks — another tenant's admission,
# unit or bed is the 404 a missing one is (tests/test_tenant_isolation.py); the refusal comes
# after those, before any lock or read. The service's transfer code (admission/service.py
# `initiate_transfer`, `confirm_transfer_arrival`) is kept for the slice that reopens them.
#
# Why (the final review's C-1 and C-2): an arrival closed the source admission and sent its bed to
# cleaning while the card stayed on that bed, so the bed could be released and admitted into
# again — two cards on one bed, and the monitor's link broken; and a physician of one unit could
# move another unit's patient into her own unit and then discharge her. No client calls them.
#
# A transfer slice reopens them only with:
#   * `_reach_admission` on the source bed and `require_reach` on the target bed's REAL unit;
#   * `target_unit_id` taken from the target bed, or refused when it differs;
#   * the confirm bound to the bed named at initiate;
#   * the card moved with `put_identity`;
#   * `_last_card_off` (tenant/router.py) covering TRANSFERRED as well — but it reads the card's key
#     from the closed row's `protocol_no`, which a TRANSFERRED row no longer holds (O8, below): for a
#     transfer it must check that the card moved, never take a card off (that card is the patient's,
#     still admitted at the target bed; taking it off would end that patient's alerts);
#   * a transfer UI;
#   * the arrival's audit row carrying the moved `protocol_no` — the service moves it to the arriving
#     row (O8), so the TRANSFERRED row no longer holds it, and the card keeps its key across the move.
# And the arrival's new admission must carry the source's `identity_digest` — flushed once the
# source has left its open state, as the open-identity index holds one open row per person — or
# the person's open admission is invisible to the duplicate refusal (A-37).
def _transfer_closed() -> HTTPException:
    return Refusal(409, TRANSFER_UNAVAILABLE, "Transfers are closed until a transfer slice "
                   "brings their checks and their screen.").http()


@router.post("/{admission_id}/transfer/initiate", response_model=AdmissionResponse)
async def transfer_initiate(
    admission_id: uuid.UUID,
    payload: TransferInitiate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_permission("admissions.move.initiate")),
    caller_tenant: uuid.UUID = _tenant,
):
    """Closed (A-37): 409 `transfer_unavailable` once the admission and the body's unit and bed
    are found to be the caller's tenant's. Nothing is locked, read further or written."""
    await _get_admission_or_404(db, admission_id, caller_tenant)
    await _ensure_unit_and_bed(db, payload.target_unit_id, payload.target_bed_id, caller_tenant)
    raise _transfer_closed()


@router.post("/{admission_id}/transfer/confirm", response_model=AdmissionResponse, status_code=201)
async def transfer_confirm(
    admission_id: uuid.UUID,
    payload: TransferInitiate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_permission("admissions.transfer.confirm")),
    caller_tenant: uuid.UUID = _tenant,
):
    """Closed (A-37): 409 `transfer_unavailable` once the admission and the body's unit and bed
    are found to be the caller's tenant's — a transfer pending from before included. Nothing is
    locked, read further or written."""
    await _get_admission_or_404(db, admission_id, caller_tenant)
    await _ensure_unit_and_bed(db, payload.target_unit_id, payload.target_bed_id, caller_tenant)
    raise _transfer_closed()


# ---------------------------------------------------------------------------
# Discharge (§4.7, S-28)
# ---------------------------------------------------------------------------
@router.post("/{admission_id}/discharge/initiate", response_model=AdmissionResponse)
async def discharge_initiate(
    admission_id: uuid.UUID,
    payload: DischargeStart,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("admissions.move.initiate")),
    caller_tenant: uuid.UUID = _tenant,
):
    """G2-B1a (spec D7, §3.3 step 1): the physician's decision, checked (admission/form.py) for a
    bed in her units. Refused `critical_alarm_open` while the board shows this patient a critical
    alert nobody acknowledged — firing or latched, the alerts the clinician sees
    (`BoardLink.open_critical`), not the escalation tables, which nothing on the ward writes. An
    exitus is reported by the caller (her full name, else her user name) unless another name is
    written. Audited `admission.discharge_start` (the disposition; never the note)."""
    admission = await _get_admission_or_404(db, admission_id, caller_tenant)
    await _reach_admission(db, user.id, caller_tenant, admission)
    try:
        form.check_discharge(payload, now=datetime.now(timezone.utc),
                             admitted_at=admission.admission_datetime)
    except Refusal as exc:
        raise exc.http() from None
    admission = await _locked(db, admission)
    key = await _key_of(db, admission)
    hospital = await trail.hospital_of(db, caller_tenant)
    reported_by = _strip(payload.reported_by)
    if payload.disposition == DischargeDisposition.EXITUS and reported_by is None:
        reported_by = user.full_name or user.username
    try:
        await service.initiate_discharge(
            db, admission, disposition=payload.disposition,
            institution=_strip(payload.institution), reported_by=reported_by,
            discharge_at=payload.discharge_at, note=_strip(payload.note),
            unacknowledged_critical_count=_open_critical(request, hospital, key),
        )
    except WorkflowError as exc:
        raise _wf(exc)
    except ValueError as exc:
        raise _not_now(exc) from None
    written, actor = AdmissionResponse.model_validate(admission), user.username
    await db.commit()
    trail.record(request, hospital, "admission.discharge_start", patient_id=key,
                 payload={"admission_id": str(written.id),
                          "disposition": payload.disposition.value, "actor": actor})
    return written


async def _off_the_board(request: Request, hospital: str, key: str) -> tuple[EngineWrite,
                                                                             AlertRetire]:
    """After the discharge has committed (A-11d, A-23, A-25), and at its retry: the patient taken
    off the board and out of the alert world — `BoardLink.take_off`, which says what it answers
    and never raises. An app without its BoardLink did neither: `failed`, `failed`, logged at
    ERROR (X53). The discharge stands either way. Logged with the board key, never a name."""
    link = board_link_of(request)
    if link is None:
        log.error("discharge %s: this app has no BoardLink; the card did not leave the board and "
                  "the patient's alerts were not ended", key)
        return "failed", "failed"
    return await link.take_off(hospital, key)


@router.post("/{admission_id}/discharge/confirm", response_model=DischargeConfirmResponse)
async def discharge_confirm(
    admission_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("admissions.discharge.confirm")),
    caller_tenant: uuid.UUID = _tenant,
):
    """G2-B1a (§3.3 step 2): the charge nurse confirms the patient has left, for a bed in her
    units. The admission is DISCHARGED, the bed goes to cleaning and the care team is closed, in
    one transaction. After the commit, the audit row `admission.discharge_confirm` (it never
    raises), then the card leaves every screen and the patient the alert world
    (`_off_the_board`); `board` and `alerts` say how that went. The answer is made before the
    commit from what was written.

    Refused `critical_alarm_open`, writing nothing, while the board shows the patient a critical
    alert nobody acknowledged — read again here, under the locks, as the start reads it (the
    user's decision, 2026-10-26): the retirement ends every alert of the patient with the reason
    "discharged", so one that fired after the start is seen and acknowledged first. An exitus is
    not exempt: after a death, someone acknowledges the monitor's last critical alarms before the
    confirmation.

    A confirmation of an admission already DISCHARGED is the nurse's retry of the board step
    (review I-2): when the first one answered `board: failed`, the card still stands and its
    alerts still run. It runs `_off_the_board` again (idempotent) and answers its outcome, with
    the same permission and unit scope, writing nothing in the database and no second
    `admission.discharge_confirm` row — its own `admission.discharge_board_retry`. It is decided
    BEFORE the critical-alarm read and is not held by it (the dashboard review's ordering): that
    hold belongs to the real PENDING_DISCHARGE → DISCHARGED confirmation, which this patient has
    passed, and a card left standing could carry an alert that would otherwise keep it on the
    board for good. The retirement ends that alert with the card."""
    admission = await _get_admission_or_404(db, admission_id, caller_tenant)
    await _reach_admission(db, user.id, caller_tenant, admission)
    admission = await _locked(db, admission)
    key = await _key_of(db, admission)
    hospital = await trail.hospital_of(db, caller_tenant)
    if admission.state == AdmissionState.DISCHARGED:
        written, actor = AdmissionResponse.model_validate(admission), user.username
        await db.rollback()                   # nothing is written; the locks go before the step
        board, alerts = await _off_the_board(request, hospital, key)
        trail.record(request, hospital, "admission.discharge_board_retry", patient_id=key,
                     payload={"admission_id": str(written.id), "board": board, "alerts": alerts,
                              "via": "discharge.confirm", "actor": actor})
        return DischargeConfirmResponse(**written.model_dump(), board=board, alerts=alerts)
    try:
        await service.confirm_discharge(
            db, admission,
            unacknowledged_critical_count=_open_critical(request, hospital, key))
    except WorkflowError as exc:
        raise _wf(exc)
    except ValueError as exc:
        raise _not_now(exc) from None
    written, actor = AdmissionResponse.model_validate(admission), user.username
    await db.commit()
    trail.record(request, hospital, "admission.discharge_confirm", patient_id=key,
                 payload={"admission_id": str(written.id), "bed_id": str(written.bed_id),
                          "actor": actor})
    board, alerts = await _off_the_board(request, hospital, key)
    return DischargeConfirmResponse(**written.model_dump(), board=board, alerts=alerts)


# ---------------------------------------------------------------------------
# Shift scheduling (§4.4)
# ---------------------------------------------------------------------------
sched_router = APIRouter(prefix="/shift-schedule", tags=["shift-schedule"])


@sched_router.post("", response_model=ShiftScheduleResponse, status_code=201)
async def create_shift_schedule(
    payload: ShiftScheduleCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("shifts.manage")),
    caller_tenant: uuid.UUID = _tenant,
):
    # The unit and every assigned bed belong to the caller's tenant, and every nurse is a member
    # of it. The charge nurse is the caller, whose membership `caller_tenant_id` established.
    scope.ensure_owned(await scope.tenant_of_unit(db, payload.unit_id), caller_tenant,
                       UNIT_NOT_FOUND)
    await scope.ensure_beds(db, caller_tenant, (a.bed_id for a in payload.assignments),
                            BED_NOT_FOUND)
    await scope.ensure_members(db, caller_tenant, (a.nurse_id for a in payload.assignments))
    assignments = [a.model_dump() for a in payload.assignments]
    try:
        created, warnings = await service.create_shift_schedule(
            db, unit_id=payload.unit_id, charge_nurse_id=user.id, assignments=assignments,
        )
    except WorkflowError as exc:
        raise _wf(exc)
    await db.commit()
    for row in created:
        await db.refresh(row)
    return ShiftScheduleResponse(
        assignments=[NurseBedAssignmentResponse.model_validate(r) for r in created],
        warnings=warnings,
    )


# ---------------------------------------------------------------------------
# Handover (§4.5, S-07, S-24; Group 2 · B3b «Vardiya devri»)
# ---------------------------------------------------------------------------
handover_router = APIRouter(prefix="/handovers", tags=["handovers"])

#: G2-B3b (D4): the states a patient is handed over in — open and signed off: ACTIVE, or a
#: discharge or transfer pending. A DRAFT has not been taken on yet; a closed one has left.
HANDOVER_STATES = frozenset(OPEN_ADMISSION_STATES - {AdmissionState.DRAFT})
#: G2-B3b (D7): how long a closed handover (COMPLETED, EXPIRED) stays in its parties' boxes.
HANDOVER_BOX_WINDOW = timedelta(hours=24)
#: G2-B3b (D7): the most rows one box answers, newest first.
HANDOVER_BOX_CAP = 100
#: G2-B3b (D7): the permission a colleague holds to be handed over to.
HANDOVER_SIGN = "handover.sign"
#: G4-02 (spec D3, D4): the Yönetici özeti's key — the page, and the units' handovers waiting for a countersignature.
SUMMARY_VIEW = "summary.view"
#: The D-Ö-D-Ö note's parts, in their order (D5).
_NOTE_PARTS = ("situation", "background", "assessment", "recommendation")


def _note_text(note: HandoverNote) -> str:
    """D5: the D-Ö-D-Ö note as JSON text in `narrative_note` (no migration), marked `v: 1`."""
    return json.dumps({"v": 1, **note.model_dump()}, ensure_ascii=False)


def _note_of(text: str | None) -> HandoverNoteOut | None:
    """D5: the stored note back as its four parts. A legacy plain-text note — anything that is not
    the `v: 1` JSON `_note_text` writes — is its `situation`. Read back without the input's
    validator: a legacy note may be shorter than a new one must be. Whatever an older client
    stored, it never fails the box: a text the JSON reader cannot hold — nested past its recursion
    limit (`RecursionError`), or not JSON at all — is a legacy note (review)."""
    if not text:
        return None
    try:
        data = json.loads(text)
    except (ValueError, RecursionError):
        data = None
    if isinstance(data, dict) and data.get("v") == 1:
        return HandoverNoteOut(**{part: data.get(part) if isinstance(data.get(part), str) else None
                                  for part in _NOTE_PARTS})
    return HandoverNoteOut(situation=text)


def _admission_ids_of(handover: Handover) -> list[uuid.UUID]:
    """The handover's admissions, in its order, each once (the column holds their ids as text)."""
    return list(dict.fromkeys(uuid.UUID(str(a)) for a in (handover.admission_ids or [])))


async def _handover_keys(db: AsyncSession, handover: Handover) -> list[str]:
    """The board keys of the handover's admissions (`board_key`), in its order, each once: what
    its critical gate reads, its summary is taken from, and its audit rows name (D3, D6, D8)."""
    ids = _admission_ids_of(handover)
    if not ids:
        return []
    keys = {admission_id: board_key(protocol_no, number) for admission_id, protocol_no, number in
            (await db.execute(select(Admission.id, Admission.protocol_no, Patient.patient_number)
                              .join(Patient, Patient.id == Admission.patient_id)
                              .where(Admission.id.in_(ids)))).all()}
    return list(dict.fromkeys(keys[i] for i in ids if i in keys))


async def _locked_handover(db: AsyncSession, handover_id: uuid.UUID,
                           caller_tenant: uuid.UUID) -> Handover:
    """The handover, if it is the caller's tenant's (`_get_handover_or_404`), its row locked for the
    rest of the transaction and read afresh: two signatures of one handover at once run one after
    the other, and the second reads what the first committed — refused by the state machine —
    instead of writing over a sealed note and summary."""
    await _get_handover_or_404(db, handover_id, caller_tenant)
    return (await db.execute(select(Handover).where(Handover.id == handover_id)
                             .with_for_update()
                             .execution_options(populate_existing=True))).scalar_one()


def _signers(caller_tenant: uuid.UUID):
    """D2, D7: the people of this tenant a handover can go to — `(id, full_name, username)` of
    the active accounts with an active membership in the tenant whose groups there grant
    `handover.sign`, a system group by rule (as at sign-in: `auth/groups.summarize`). One query,
    which `GET /handovers/colleagues` lists (leaving the caller out) and `POST /handovers` asks of
    its receiver (`.where(User.id == …)`), so the screen's list and the server's rule are one."""
    signs = or_(Group.is_system.is_(True),
                select(GroupPermission.group_id)
                .where(GroupPermission.group_id == Group.id,
                       GroupPermission.permission == HANDOVER_SIGN)
                .exists())
    return (select(User.id, User.full_name, User.username).distinct()
            .join(TenantMembership, TenantMembership.user_id == User.id)
            .join(UserGroup, UserGroup.user_id == User.id)
            .join(Group, Group.id == UserGroup.group_id)
            .where(TenantMembership.tenant_id == caller_tenant,
                   TenantMembership.is_active.is_(True),
                   User.is_active.is_(True),
                   Group.tenant_id == caller_tenant,
                   signs))


@handover_router.post("", response_model=HandoverResponse, status_code=201)
async def open_handover(
    payload: HandoverOpen,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("handover.sign")),
    caller_tenant: uuid.UUID = _tenant,
):
    """Open a handover to the colleague the outgoing person chose (D2). The unit, the admissions
    and the receiver are the caller's tenant's (404 / 422, before anything else). G2-B3b:

    * D2 — the receiver is one of the caller's colleagues (`_signers`: an active member of the
      tenant whose groups grant `handover.sign`), never the caller herself: otherwise 422
      `field_invalid:incoming_user_id`. The server holds the rule, not only the screen's list;
    * D4 — each admission's bed is in the caller's units (403 `out_of_scope`) and the admission is
      open and signed off (`HANDOVER_STATES`; otherwise 409 `invalid_transition`);
    * G4-02 review — the handover's unit is its admissions' beds' (bed → room → unit, as
      `_reach_admission` reads it, A-12), never the body's: the body's `unit_id` is still checked
      to be the tenant's (404) and a different unit there is not refused — a stale unit on the
      screen never stops a nurse handing over — but it is not stored. `GET /handovers/pending`
      groups and scopes by the stored unit, so it is the one the patients lie in. Admissions whose
      beds lie in more than one unit are not one handover: 422 `field_invalid:admission_ids`.
      Handovers opened before this rule keep the unit they were opened with.

    The body is the one it always was, a list of admissions — at least one (422) — which the
    screen fills with one (D1). Audited `handover.open` after the commit, under the first
    admission's board key, every admission and key in its payload (D8)."""
    scope.ensure_owned(await scope.tenant_of_unit(db, payload.unit_id), caller_tenant,
                       UNIT_NOT_FOUND)
    await scope.ensure_admissions(db, caller_tenant, payload.admission_ids, ADMISSION_NOT_FOUND)
    await scope.ensure_members(db, caller_tenant, [payload.incoming_user_id])
    if payload.incoming_user_id == user.id:
        raise field_invalid("incoming_user_id", "A handover goes to someone other than the "
                            "person handing over.").http()
    if (await db.execute(_signers(caller_tenant)
                         .where(User.id == payload.incoming_user_id))).first() is None:
        raise field_invalid("incoming_user_id", "The receiver does not sign handovers in this "
                            "hospital (handover.sign).").http()
    admissions = [await _get_admission_or_404(db, admission_id, caller_tenant)
                  for admission_id in dict.fromkeys(payload.admission_ids)]
    units: set[uuid.UUID] = set()
    for admission in admissions:
        units.add(await _reach_admission(db, user.id, caller_tenant, admission))
        if admission.state not in HANDOVER_STATES:
            raise Refusal(409, INVALID_TRANSITION,
                          f"Only an open admission is handed over (ACTIVE, PENDING_DISCHARGE or "
                          f"PENDING_TRANSFER); this one is {admission.state.value}.").http()
    if len(units) > 1:
        raise field_invalid("admission_ids", f"A handover is of one unit; these admissions' beds lie "
                            f"in {len(units)} units. Hand each unit's patients over separately.").http()
    (unit_id,) = units
    keys = [await _key_of(db, admission) for admission in admissions]
    hospital = await trail.hospital_of(db, caller_tenant)
    admission_ids = [str(admission.id) for admission in admissions]
    actor = user.username
    handover = await service.open_handover(
        db, unit_id=unit_id, outgoing_user_id=user.id,
        incoming_user_id=payload.incoming_user_id, admission_ids=payload.admission_ids,
    )
    await db.commit()
    await db.refresh(handover)
    trail.record(request, hospital, "handover.open", patient_id=keys[0],
                 payload={"handover_id": str(handover.id), "admission_id": admission_ids[0],
                          "admission_ids": admission_ids, "patients": keys,
                          "incoming_user_id": str(payload.incoming_user_id), "actor": actor})
    return handover


@handover_router.post("/{handover_id}/sign-outgoing", response_model=HandoverResponse)
async def sign_outgoing(
    handover_id: uuid.UUID,
    payload: HandoverSign,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("handover.sign")),
    caller_tenant: uuid.UUID = _tenant,
):
    """The outgoing signature (S-07, S-24). G2-B3b:

    * D3 — refused 409 `critical_alarm_open` while the LIVE board shows one of the handover's
      patients a critical alert nobody acknowledged, firing or latched (`_open_critical`, as the
      discharge reads it) — never the Postgres escalation table, which nothing on the ward writes;
    * D5 — `note` (the D-Ö-D-Ö note) is stored as JSON text in `narrative_note`; the legacy
      `narrative_note` text is still taken, as it comes, when no `note` is sent;
    * D6 — the board's summary of each patient (`_board_summary`) is sealed beside it: the summary
      itself for one patient, `{"patients": {key: summary}}` for more. Nothing changes either after.

    Audited `handover.sign_outgoing` after the commit (D8): never the note. A refused signature
    writes nothing: the handover stays OPEN, to be signed again."""
    handover = await _locked_handover(db, handover_id, caller_tenant)
    keys = await _handover_keys(db, handover)
    hospital = await trail.hospital_of(db, caller_tenant)
    note = _note_text(payload.note) if payload.note is not None else payload.narrative_note
    # One synchronous step, no await inside it (review): the board the gate counts is the board
    # the summary seals — the one process holding the board runs nothing else in between.
    critical = sum(_open_critical(request, hospital, key) for key in keys)
    summaries = {key: _board_summary(request, hospital, key) for key in keys}
    try:
        await service.sign_handover_outgoing(
            db, handover, user_id=user.id, narrative_note=note,
            unacknowledged_critical_count=critical,
        )
    except WorkflowError as exc:
        raise _wf(exc)
    handover.auto_populated_summary = (
        None if not keys or None in summaries.values()
        else summaries[keys[0]] if len(keys) == 1 else {"patients": summaries})
    actor = user.username
    await db.commit()
    await db.refresh(handover)
    trail.record(request, hospital, "handover.sign_outgoing", patient_id=keys[0] if keys else "",
                 payload={"handover_id": str(handover.id), "patients": keys, "actor": actor})
    return handover


@handover_router.post("/{handover_id}/countersign", response_model=HandoverResponse)
async def countersign(
    handover_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("handover.sign")),
    caller_tenant: uuid.UUID = _tenant,
):
    """The receiver's countersignature: only the person the outgoing one named (D2), only after
    the outgoing signature (409 `invalid_transition` otherwise). Audited `handover.countersign`
    after the commit (D8)."""
    handover = await _locked_handover(db, handover_id, caller_tenant)
    keys = await _handover_keys(db, handover)
    hospital = await trail.hospital_of(db, caller_tenant)
    try:
        await service.countersign_handover_incoming(db, handover, user_id=user.id)
    except WorkflowError as exc:
        raise _wf(exc)
    actor = user.username
    await db.commit()
    await db.refresh(handover)
    trail.record(request, hospital, "handover.countersign", patient_id=keys[0] if keys else "",
                 payload={"handover_id": str(handover.id), "patients": keys, "actor": actor})
    return handover


@handover_router.get("/colleagues", response_model=list[Colleague])
async def handover_colleagues(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission(HANDOVER_SIGN)),
    caller_tenant: uuid.UUID = _tenant,
):
    """G2-B3b (D2, D7): the people the caller can hand over to (`_signers`, which `POST
    /handovers` asks of its receiver too), the caller left out. `name` is the full name, else the
    user name; sorted by it."""
    rows = (await db.execute(_signers(caller_tenant).where(User.id != user.id))).all()
    people = [Colleague(id=user_id, name=full_name or username)
              for user_id, full_name, username in rows]
    return sorted(people, key=lambda person: (person.name.casefold(), str(person.id)))


@handover_router.get("/pending", response_model=PendingHandovers)
async def pending_handovers(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission(SUMMARY_VIEW)),
    caller_tenant: uuid.UUID = _tenant,
):
    """G4-02 (spec D4): per unit, the handovers the outgoing person signed that wait for the
    countersignature (OUTGOING_SIGNED) — how many, and when the oldest was signed; then the server's
    time. Units with none are left out; the rest by name. In the caller's tenant (the unit's site) and
    the caller's units (`unitscope.unit_clause`: a handover belongs to a unit, so a bed grant alone
    reaches none) — today only an unrestricted administrator holds the key, the rule is written for the
    group a hospital may give it to later. Counts and times only: no patient, no note, no person.
    OUTGOING_SIGNED never expires (service.py), so the oldest can be days old."""
    reach = await unitscope.caller_scope(db, user.id, caller_tenant)
    stmt = (select(Unit.id, Unit.name, func.count(Handover.id), func.min(Handover.outgoing_signed_at))
            .select_from(Handover)
            .join(Unit, Unit.id == Handover.unit_id)
            .join(Site, Site.id == Unit.site_id)
            .where(Site.tenant_id == caller_tenant, Handover.status == HandoverStatus.OUTGOING_SIGNED)
            .group_by(Unit.id, Unit.name)
            .order_by(Unit.name, Unit.id))
    within = unitscope.unit_clause(reach, unit_id=Unit.id)
    if within is not None:
        stmt = stmt.where(within)
    rows = (await db.execute(stmt)).all()
    return PendingHandovers(
        units=[PendingUnit(unit_id=unit_id, unit_name=name, pending=count, oldest_outgoing_signed_at=oldest)
               for unit_id, name, count, oldest in rows],
        generated_at=_now())


@handover_router.get("", response_model=list[HandoverRow])
async def my_handovers(
    box: Literal["incoming", "outgoing"],
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission(HANDOVER_SIGN)),
    caller_tenant: uuid.UUID = _tenant,
):
    """G2-B3b (D7): the caller's own handovers — `incoming`, the ones handed to her; `outgoing`,
    the ones she handed over. By person, not by unit: nobody sees a handover she is not a party
    to. In the caller's tenant (the handover's unit's site). The ones still in hand — OPEN while
    its bridge runs, OUTGOING_SIGNED — and, for `HANDOVER_BOX_WINDOW`, the ones that ended:
    COMPLETED (counted from its countersignature), EXPIRED, and an OPEN one past its bridge
    (S-24), read as the EXPIRED it is (the signature would refuse it so). Newest first, at most
    `HANDOVER_BOX_CAP`.

    Each row names its two parties (full name, else user name), its patients as the screen shows
    them (board key, name, bed, unit), its note (D5, read back in its four parts) and the summary
    sealed at the outgoing signature (D6)."""
    now = _now()
    party = Handover.incoming_user_id if box == "incoming" else Handover.outgoing_user_id
    # A closed one's day runs from its end where it has one: a COMPLETED handover from its
    # countersignature, so one countersigned late does not leave the box at once (review).
    ended = func.coalesce(Handover.incoming_signed_at, Handover.created_at)
    held = or_(Handover.status == HandoverStatus.OUTGOING_SIGNED,
               and_(Handover.status == HandoverStatus.OPEN, Handover.bridge_expires_at > now),
               ended >= now - HANDOVER_BOX_WINDOW)
    handovers = (await db.execute(
        select(Handover)
        .join(Unit, Unit.id == Handover.unit_id)
        .join(Site, Site.id == Unit.site_id)
        .where(Site.tenant_id == caller_tenant, party == user.id, held)
        .order_by(Handover.created_at.desc(), Handover.id)
        .limit(HANDOVER_BOX_CAP))).scalars().all()
    if not handovers:
        return []

    people = {user_id: full_name or username for user_id, full_name, username in
              (await db.execute(select(User.id, User.full_name, User.username).where(
                  User.id.in_({h.outgoing_user_id for h in handovers}
                              | {h.incoming_user_id for h in handovers})))).all()}
    wanted = {admission_id for h in handovers for admission_id in _admission_ids_of(h)}
    patients = {} if not wanted else {
        admission_id: HandoverPatient(admission_id=admission_id,
                                      board_key=board_key(protocol_no, number),
                                      display_name=name, bed_label=label, unit_name=unit)
        for admission_id, protocol_no, number, name, label, unit in (await db.execute(
            select(Admission.id, Admission.protocol_no, Patient.patient_number,
                   Patient.display_name, Bed.label, Unit.name)
            .join(Patient, Patient.id == Admission.patient_id)
            .join(Bed, Bed.id == Admission.bed_id)
            .join(Room, Room.id == Bed.room_id)
            .join(Unit, Unit.id == Room.unit_id)
            .where(Admission.id.in_(wanted), Admission.tenant_id == caller_tenant))).all()}

    def person(user_id: uuid.UUID) -> HandoverPerson:
        return HandoverPerson(id=user_id, name=people.get(user_id, ""))

    def status_of(h: Handover) -> HandoverStatus:
        lapsed = h.status == HandoverStatus.OPEN and now >= h.bridge_expires_at
        return HandoverStatus.EXPIRED if lapsed else h.status

    return [HandoverRow(id=h.id, status=status_of(h), created_at=h.created_at,
                        bridge_expires_at=h.bridge_expires_at,
                        outgoing_signed_at=h.outgoing_signed_at,
                        incoming_signed_at=h.incoming_signed_at,
                        outgoing=person(h.outgoing_user_id), incoming=person(h.incoming_user_id),
                        patients=[patients[a] for a in _admission_ids_of(h) if a in patients],
                        note=_note_of(h.narrative_note), summary=h.auto_populated_summary)
            for h in handovers]

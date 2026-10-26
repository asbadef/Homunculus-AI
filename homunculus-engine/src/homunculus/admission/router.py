"""
FastAPI routes for the patient admission workflow (§4, §5).

Permission guards (see auth/permissions.py):
  * admissions.admit           open an admission
  * admissions.view            list / read admissions, patients and care teams
  * admissions.sign_off        physician sign-off
  * admissions.move.initiate   initiate a transfer or discharge
  * admissions.transfer.confirm   confirm a transfer arrival
  * admissions.discharge.confirm  confirm a discharge, release the bed
  * care_team.claim / .assign  claim or assign a care-team role
  * shifts.manage              shift schedules
  * handover.sign              open, sign, countersign a handover

Tenant isolation (spec §5): every route also takes `caller_tenant_id` and acts on the caller's
tenant only. An admission, unit, bed or handover of another tenant, named in the path or in the
body, is a 404 identical to a missing one; a user of another tenant named in the body is a 422
(see tenant/scope.py). Every check runs before anything is written.

PHI: patient identity is returned by the patient-detail endpoint (`GET /admissions/{id}/patient`)
and — since Group 2 · B1a, for the Taburcu list — as the display name on each row of
`GET /admissions`, to holders of `admissions.view` in the patient's own tenant, as the board shows
it to `board.view`. Reads of either are not audited yet.

Group 2 · B1a (Hasta Kabul): the admission, sign-off and discharge routes check the target bed's
unit against the caller's grants (admission/unitscope.py), write their audit row
(admission/trail.py) and reach the board only through `BoardLink` (admission/boardlink.py). Every
refusal carries a stable code beside its words (admission/errors.py).
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from contextlib import suppress
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus import crypto
from homunculus.admission import form, service, trail, unitscope
from homunculus.admission.boardlink import board_link_of, kabul_record
from homunculus.admission.models import (
    Admission, AdmissionState, CareTeamMember, Handover, Patient,
)
from homunculus.admission.schemas import (
    AdmissionCreate, AdmissionNoteFields, AdmissionResponse, AdmissionRow, AdmitResponse,
    CareTeamAdd, CareTeamMemberResponse, DischargeInitiate, EngineWrites, HandoverOpen,
    HandoverResponse, HandoverSign, NurseBedAssignmentResponse, PatientResponse,
    ShiftScheduleCreate, ShiftScheduleResponse, TransferInitiate,
)
from homunculus.admission.errors import BED_CLOSED, REQUEST_CONFLICT, Refusal, field_invalid
from homunculus.admission.numbers import next_patient_number
from homunculus.admission.service import WorkflowError
from homunculus.escalation import service as escalation_service
from homunculus.auth.dependencies import caller_tenant_id, require_permission
from homunculus.auth.models import User
from homunculus.db import get_db
from homunculus.tenant import scope
from homunculus.tenant.models import Bed, Room, Tenant, Unit

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
    defaults written out, `request_id` left out — as one canonical JSON. A body that reads the
    same (keys in another order, a default sent or left out) is the same form; any field changed
    makes it another."""
    body = payload.model_dump(mode="json", exclude={"request_id"})
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


async def _to_board(request: Request, hospital: str, *, patient: Patient, bed: Bed, unit: Unit,
                    note: AdmissionNoteFields, actor: str) -> EngineWrites:
    """After the admission is committed (spec §3.1 step 3): the card, the weight, the profile —
    each on its own. One that does not land leaves the admission standing and is reported, so the
    screen can say which part to enter by hand (X53). `chart_weight` and `apply_profile` raise on
    any failure, an unwired door included (A-20, A-23, A-25). Logged with the patient number, never
    a name."""
    link = board_link_of(request)
    if link is None:
        return EngineWrites(weight="skipped", profile="skipped", board="skipped")

    async def attempt(what: str, write) -> str:
        try:
            await write()
            return "ok"
        except Exception:
            log.exception("admission %s: the %s did not reach the engine",
                          patient.patient_number, what)
            return "failed"

    async def put_card() -> None:
        await link.put_identity(hospital, kabul_record(
            patient_number=patient.patient_number, display_name=patient.display_name,
            birth_date=date.fromisoformat(patient.date_of_birth), sex=patient.sex,
            bed_label=bed.label, bed_id=str(bed.id), unit_id=str(unit.id),
            at=datetime.now(timezone.utc)))

    board = await attempt("identity", put_card)
    weight = ("skipped" if note.weight_kg is None else await attempt(
        "weight", lambda: link.chart_weight(hospital, patient.patient_number, note.weight_kg,
                                            actor=actor)))
    profile = ("skipped" if not note.comorbidity_codes else await attempt(
        "profile", lambda: link.apply_profile(hospital, patient.patient_number,
                                              note.comorbidity_codes, actor=actor)))
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


def _unrecorded(admission: Admission) -> EngineWrites:
    """The engine report of an admission with none recorded: its writes after the commit did not
    finish (the answer failed on its way, the process stopped) or their report was not kept. No
    part the form asked for is claimed to have landed — `failed`, which sends the nurse to look —
    and a part it did not ask for stays `skipped`."""
    return EngineWrites(weight="skipped" if admission.weight_kg is None else "failed",
                        profile="skipped" if not admission.comorbidity_codes else "failed",
                        board="failed")


async def _answer_again(db: AsyncSession, response: Response, tenant_id: uuid.UUID,
                        request_id: uuid.UUID, digest: str) -> AdmitResponse:
    """A send of a form already admitted (amendment A-19). The same form — the same digest — is
    answered with that admission's answer: 200, the first answer's body, once the first send has
    finished writing to the board if it is still at it. Another form under the same id is refused
    `request_conflict`. The caller has rolled this send's transaction back: it keeps no lock and
    gives back any number it took."""
    earlier = (await db.execute(select(Admission).where(
        Admission.tenant_id == tenant_id, Admission.request_id == request_id))).scalar_one()
    if earlier.request_digest != digest:
        raise Refusal(409, REQUEST_CONFLICT,
                      "This request id came before with another admission form.").http()
    answering = _ANSWERING.get(earlier.id)
    if answering is not None:
        with suppress(TimeoutError):
            await asyncio.wait_for(answering.wait(), ANSWER_WAIT_S)
    report = (await db.execute(select(Admission.engine_writes)
                               .where(Admission.id == earlier.id))).scalar_one()
    number = (await db.execute(select(Patient.patient_number)
                               .where(Patient.id == earlier.patient_id))).scalar_one()
    log.info("admission %s: the same form sent again, answered with its admission", number)
    response.status_code = status.HTTP_200_OK
    engine = EngineWrites.model_validate(report) if report else _unrecorded(earlier)
    return AdmitResponse(**AdmissionResponse.model_validate(earlier).model_dump(),
                         patient_number=number, engine=engine)


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
    unit the form names, in the caller's units, open and AVAILABLE; the patient gets a fresh
    number (admission/numbers.py); the admission is DRAFT and the bed OCCUPIED. After the commit
    the board gets its card and the engine the weight and the comorbidities (`_to_board`); the
    answer says which of those landed.

    A form sent again under its `request_id` (A-19) is looked for once the bed is locked — a second
    send of the same form waits there for the first to commit — and answered by `_answer_again`.
    One that gets past that look-up (another form under the id, so another bed and no lock between
    the two) is stopped by the unique `(tenant_id, request_id)` at its flush and answered the same
    way."""
    # The admitting unit and the bed belong to the caller's tenant and the attending is a member
    # of it, all checked before the patient row is written.
    await _ensure_unit_and_bed(db, payload.note.admitting_unit_id, payload.note.bed_id,
                               caller_tenant)
    await scope.ensure_members(db, caller_tenant, [payload.note.attending_physician_id])

    hospital, zone = (await db.execute(select(Tenant.slug, Tenant.timezone)
                                       .where(Tenant.id == caller_tenant))).one()
    now = _now()
    digest = None if payload.request_id is None else _request_digest(payload)
    try:
        form.check_admission(payload, today=hospital_today(zone, now), now=now)
        bed, room, unit = await _bed_of(db, payload.note.bed_id)
        if unit.id != payload.note.admitting_unit_id:
            raise field_invalid("admitting_unit_id", "The bed is not in that unit.")
        unitscope.require_reach(await unitscope.caller_scope(db, user.id, caller_tenant),
                                unit_id=unit.id, bed_id=bed.id)
        if payload.request_id is not None and \
                await _earlier(db, caller_tenant, payload.request_id) is not None:
            await db.rollback()
            return await _answer_again(db, response, caller_tenant, payload.request_id, digest)
        if not (bed.is_active and room.is_active and unit.is_active):
            raise Refusal(409, BED_CLOSED, "The bed, its room or its unit is closed.")
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
            request_id=payload.request_id, request_digest=digest,
        )
    except WorkflowError as exc:
        raise _wf(exc)
    except IntegrityError:
        await db.rollback()
        if payload.request_id is None or \
                await _earlier(db, caller_tenant, payload.request_id) is None:
            raise
        return await _answer_again(db, response, caller_tenant, payload.request_id, digest)

    # Registered before the commit, so a send of the same form that sees this admission sees it.
    answered = _ANSWERING[admission.id] = asyncio.Event()
    try:
        await db.commit()
        await db.refresh(admission)
        trail.record(request, hospital, "admission.admit", patient_id=number,
                     payload={"admission_id": str(admission.id), "bed_id": str(bed.id),
                              "unit_id": str(unit.id), "actor": user.username})
        engine = await _to_board(request, hospital, patient=patient, bed=bed, unit=unit,
                                 note=payload.note, actor=user.username)
        answer = AdmitResponse(**AdmissionResponse.model_validate(admission).model_dump(),
                               patient_number=number, engine=engine)
        await _keep_report(db, admission.id, engine)
    finally:
        answered.set()
        _ANSWERING.pop(admission.id, None)
    return answer


# ---------------------------------------------------------------------------
# List / detail
# ---------------------------------------------------------------------------
@router.get("", response_model=list[AdmissionRow])
async def list_admissions(
    unit_id: uuid.UUID | None = None,
    state: list[AdmissionState] | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = _tenant,
    user: User = Depends(require_permission("admissions.view")),
):
    """Newest first, each row with the names a screen shows (G2-B1a: the Taburcu and Yataklar
    lists, the sign-off badge). `state` narrows to those states (repeatable); the rows are limited
    to the caller's units, as the structure is (admission/unitscope.py) — the unit being the bed's
    room's, read here, never the admission's `admitting_unit_id` (A-12)."""
    stmt = (select(Admission, Patient, Bed, Room, Unit)
            .join(Patient, Patient.id == Admission.patient_id)
            .join(Bed, Bed.id == Admission.bed_id)
            .join(Room, Room.id == Bed.room_id)
            .join(Unit, Unit.id == Room.unit_id)
            .where(Admission.tenant_id == caller_tenant))
    if unit_id is not None:
        stmt = stmt.where(Admission.admitting_unit_id == unit_id)
    if state:
        stmt = stmt.where(Admission.state.in_(state))
    reach = await unitscope.caller_scope(db, user.id, caller_tenant)
    rows = (await db.execute(stmt.order_by(Admission.created_at.desc()))).all()
    return [AdmissionRow(**AdmissionResponse.model_validate(a).model_dump(),
                         patient_number=p.patient_number, display_name=p.display_name,
                         bed_label=b.label, room_name=r.name, unit_name=u.name)
            for a, p, b, r, u in rows if unitscope.reaches(reach, unit_id=u.id, bed_id=b.id)]


@router.get("/{admission_id}", response_model=AdmissionResponse,
            dependencies=[Depends(require_permission("admissions.view"))])
async def get_admission(
    admission_id: uuid.UUID, db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = _tenant,
):
    return await _get_admission_or_404(db, admission_id, caller_tenant)


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
# Sign-off DRAFT → ACTIVE (§4.1 steps 4–5)
# ---------------------------------------------------------------------------
@router.post("/{admission_id}/sign-off", response_model=AdmissionResponse)
async def sign_off(
    admission_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("admissions.sign_off")),
    caller_tenant: uuid.UUID = _tenant,
):
    admission = await _get_admission_or_404(db, admission_id, caller_tenant)
    try:
        await service.sign_off_admission(db, admission, signing_user_id=user.id)
    except WorkflowError as exc:
        raise _wf(exc)
    await db.commit()
    await db.refresh(admission)
    return admission


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
# Transfer (§4.6)
# ---------------------------------------------------------------------------
@router.post("/{admission_id}/transfer/initiate", response_model=AdmissionResponse)
async def transfer_initiate(
    admission_id: uuid.UUID,
    payload: TransferInitiate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("admissions.move.initiate")),
    caller_tenant: uuid.UUID = _tenant,
):
    admission = await _get_admission_or_404(db, admission_id, caller_tenant)
    await _ensure_unit_and_bed(db, payload.target_unit_id, payload.target_bed_id, caller_tenant)
    try:
        await service.initiate_transfer(
            db, admission, target_bed_id=payload.target_bed_id,
            target_unit_id=payload.target_unit_id,
        )
    except WorkflowError as exc:
        raise _wf(exc)
    await db.commit()
    await db.refresh(admission)
    return admission


@router.post("/{admission_id}/transfer/confirm", response_model=AdmissionResponse, status_code=201)
async def transfer_confirm(
    admission_id: uuid.UUID,
    payload: TransferInitiate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("admissions.transfer.confirm")),
    caller_tenant: uuid.UUID = _tenant,
):
    admission = await _get_admission_or_404(db, admission_id, caller_tenant)
    await _ensure_unit_and_bed(db, payload.target_unit_id, payload.target_bed_id, caller_tenant)
    try:
        new_admission = await service.confirm_transfer_arrival(
            db, admission, target_bed_id=payload.target_bed_id,
            target_unit_id=payload.target_unit_id,
        )
    except WorkflowError as exc:
        raise _wf(exc)
    await db.commit()
    await db.refresh(new_admission)
    return new_admission


# ---------------------------------------------------------------------------
# Discharge (§4.7, S-28)
# ---------------------------------------------------------------------------
@router.post("/{admission_id}/discharge/initiate", response_model=AdmissionResponse)
async def discharge_initiate(
    admission_id: uuid.UUID,
    payload: DischargeInitiate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("admissions.move.initiate")),
    caller_tenant: uuid.UUID = _tenant,
):
    admission = await _get_admission_or_404(db, admission_id, caller_tenant)
    unacked = await escalation_service.count_unacknowledged_critical(
        db, admission_id=admission.id
    )
    try:
        await service.initiate_discharge(
            db, admission, discharge_summary=payload.discharge_summary,
            unacknowledged_critical_count=unacked,  # wired to alert engine (PR #3)
        )
    except WorkflowError as exc:
        raise _wf(exc)
    await db.commit()
    await db.refresh(admission)
    return admission


@router.post("/{admission_id}/discharge/confirm", response_model=AdmissionResponse)
async def discharge_confirm(
    admission_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("admissions.discharge.confirm")),
    caller_tenant: uuid.UUID = _tenant,
):
    admission = await _get_admission_or_404(db, admission_id, caller_tenant)
    try:
        await service.confirm_discharge(db, admission)
    except WorkflowError as exc:
        raise _wf(exc)
    await db.commit()
    await db.refresh(admission)
    return admission


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
# Handover (§4.5, S-07, S-24)
# ---------------------------------------------------------------------------
handover_router = APIRouter(prefix="/handovers", tags=["handovers"])


@handover_router.post("", response_model=HandoverResponse, status_code=201)
async def open_handover(
    payload: HandoverOpen,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("handover.sign")),
    caller_tenant: uuid.UUID = _tenant,
):
    scope.ensure_owned(await scope.tenant_of_unit(db, payload.unit_id), caller_tenant,
                       UNIT_NOT_FOUND)
    await scope.ensure_admissions(db, caller_tenant, payload.admission_ids, ADMISSION_NOT_FOUND)
    await scope.ensure_members(db, caller_tenant, [payload.incoming_user_id])
    handover = await service.open_handover(
        db, unit_id=payload.unit_id, outgoing_user_id=user.id,
        incoming_user_id=payload.incoming_user_id, admission_ids=payload.admission_ids,
    )
    await db.commit()
    await db.refresh(handover)
    return handover


@handover_router.post("/{handover_id}/sign-outgoing", response_model=HandoverResponse)
async def sign_outgoing(
    handover_id: uuid.UUID,
    payload: HandoverSign,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("handover.sign")),
    caller_tenant: uuid.UUID = _tenant,
):
    handover = await _get_handover_or_404(db, handover_id, caller_tenant)
    admission_ids = [uuid.UUID(a) for a in (handover.admission_ids or [])]
    unacked = await escalation_service.count_unacknowledged_critical(
        db, admission_ids=admission_ids
    )
    try:
        await service.sign_handover_outgoing(
            db, handover, user_id=user.id, narrative_note=payload.narrative_note,
            unacknowledged_critical_count=unacked,  # wired to alert engine (PR #3)
        )
    except WorkflowError as exc:
        raise _wf(exc)
    await db.commit()
    await db.refresh(handover)
    return handover


@handover_router.post("/{handover_id}/countersign", response_model=HandoverResponse)
async def countersign(
    handover_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("handover.sign")),
    caller_tenant: uuid.UUID = _tenant,
):
    handover = await _get_handover_or_404(db, handover_id, caller_tenant)
    try:
        await service.countersign_handover_incoming(db, handover, user_id=user.id)
    except WorkflowError as exc:
        raise _wf(exc)
    await db.commit()
    await db.refresh(handover)
    return handover

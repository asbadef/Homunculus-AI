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

PHI: patient identity is returned only by the patient-detail endpoint
(`GET /admissions/{id}/patient`), to holders of `admissions.view` in the patient's own
tenant. Reads of it are not audited yet. List and board contexts never include patient
identity here.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission import service
from homunculus.admission.models import (
    Admission, CareTeamMember, Handover, Patient,
)
from homunculus.admission.schemas import (
    AdmissionCreate, AdmissionResponse, CareTeamAdd, CareTeamMemberResponse,
    DischargeInitiate, HandoverOpen, HandoverResponse, HandoverSign,
    NurseBedAssignmentResponse, PatientResponse, ShiftScheduleCreate,
    ShiftScheduleResponse, TransferInitiate,
)
from homunculus.admission.service import WorkflowError
from homunculus.escalation import service as escalation_service
from homunculus.auth.dependencies import caller_tenant_id, require_permission
from homunculus.auth.models import User
from homunculus.db import get_db
from homunculus.tenant import scope

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
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))


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
# Create DRAFT admission (§4.1)
# ---------------------------------------------------------------------------
@router.post("", response_model=AdmissionResponse, status_code=201,
             dependencies=[Depends(require_permission("admissions.admit"))])
async def create_admission(
    payload: AdmissionCreate, db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = _tenant,
):
    # The admitting unit and the bed belong to the caller's tenant and the attending is a member
    # of it, all checked before the patient row is written.
    await _ensure_unit_and_bed(db, payload.note.admitting_unit_id, payload.note.bed_id,
                               caller_tenant)
    await scope.ensure_members(db, caller_tenant, [payload.note.attending_physician_id])

    patient = Patient(
        tenant_id=caller_tenant,
        display_name=payload.patient.display_name,
        date_of_birth=payload.patient.date_of_birth.isoformat(),
        sex=payload.patient.sex.value,
        his_patient_reference=payload.patient.his_patient_reference,
    )
    db.add(patient)
    await db.flush()

    note = payload.note.model_dump()
    try:
        admission = await service.create_draft_admission(
            db, tenant_id=caller_tenant, patient=patient, note_fields=note,
        )
    except WorkflowError as exc:
        raise _wf(exc)
    await db.commit()
    await db.refresh(admission)
    return admission


# ---------------------------------------------------------------------------
# List / detail
# ---------------------------------------------------------------------------
@router.get("", response_model=list[AdmissionResponse],
            dependencies=[Depends(require_permission("admissions.view"))])
async def list_admissions(
    unit_id: uuid.UUID | None = None, db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = _tenant,
):
    stmt = select(Admission).where(Admission.tenant_id == caller_tenant)
    if unit_id is not None:
        stmt = stmt.where(Admission.admitting_unit_id == unit_id)
    result = await db.execute(stmt.order_by(Admission.created_at.desc()))
    return list(result.scalars().all())


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

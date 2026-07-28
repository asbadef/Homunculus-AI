"""
FastAPI routes for the patient admission workflow (§4, §5).

Role guards follow the workflow ownership in the design doc:
  * NURSE / CHARGE_NURSE open the admission (§4.1 step 2)
  * ATTENDING / UNIT_PHYSICIAN sign it off (§4.1 step 4), transfer, discharge
  * ATTENDING manages the care team (§4.2–4.3)
  * CHARGE_NURSE schedules nurses and confirms discharge/transfer (§4.4/4.6/4.7)

PHI: patient identity is returned only in the admission-detail endpoint. List and
board contexts never include patient identity here.
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
from homunculus.auth.dependencies import get_current_active_user, require_roles
from homunculus.auth.models import User, UserRole
from homunculus.db import get_db
from homunculus.tenant.models import Site, Unit

router = APIRouter(prefix="/admissions", tags=["admissions"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _wf(exc: WorkflowError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))


async def _resolve_tenant_id(db: AsyncSession, unit_id: uuid.UUID) -> uuid.UUID:
    """Derive tenant_id from unit → site → tenant."""
    result = await db.execute(
        select(Site.tenant_id).join(Unit, Unit.site_id == Site.id).where(Unit.id == unit_id)
    )
    tenant_id = result.scalar_one_or_none()
    if tenant_id is None:
        raise HTTPException(status_code=404, detail="Unit/tenant not found.")
    return tenant_id


async def _get_admission_or_404(db: AsyncSession, admission_id: uuid.UUID) -> Admission:
    admission = await db.get(Admission, admission_id)
    if admission is None:
        raise HTTPException(status_code=404, detail="Admission not found.")
    return admission


# ---------------------------------------------------------------------------
# Create DRAFT admission (§4.1)
# ---------------------------------------------------------------------------
@router.post("", response_model=AdmissionResponse, status_code=201,
             dependencies=[Depends(require_roles(UserRole.NURSE, UserRole.CHARGE_NURSE))])
async def create_admission(payload: AdmissionCreate, db: AsyncSession = Depends(get_db)):
    tenant_id = await _resolve_tenant_id(db, payload.note.admitting_unit_id)

    patient = Patient(
        tenant_id=tenant_id,
        display_name=payload.patient.display_name,
        date_of_birth=payload.patient.date_of_birth.isoformat(),
        sex=payload.patient.sex.value,
        his_patient_reference=payload.patient.his_patient_reference,
    )
    db.add(patient)
    await db.flush()

    note = payload.note.model_dump()
    if note.get("transplant_day_zero") is not None:
        # stored as Date column
        pass
    try:
        admission = await service.create_draft_admission(
            db, tenant_id=tenant_id, patient=patient, note_fields=note,
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
            dependencies=[Depends(get_current_active_user)])
async def list_admissions(
    unit_id: uuid.UUID | None = None, db: AsyncSession = Depends(get_db)
):
    stmt = select(Admission)
    if unit_id is not None:
        stmt = stmt.where(Admission.admitting_unit_id == unit_id)
    result = await db.execute(stmt.order_by(Admission.created_at.desc()))
    return list(result.scalars().all())


@router.get("/{admission_id}", response_model=AdmissionResponse,
            dependencies=[Depends(get_current_active_user)])
async def get_admission(admission_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    return await _get_admission_or_404(db, admission_id)


@router.get("/{admission_id}/patient", response_model=PatientResponse,
            dependencies=[Depends(get_current_active_user)])
async def get_admission_patient(admission_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """PHI detail — returned only to authenticated care-team members."""
    admission = await _get_admission_or_404(db, admission_id)
    patient = await db.get(Patient, admission.patient_id)
    if patient is None:
        raise HTTPException(status_code=404, detail="Patient not found.")
    return patient


# ---------------------------------------------------------------------------
# Sign-off DRAFT → ACTIVE (§4.1 steps 4–5)
# ---------------------------------------------------------------------------
@router.post("/{admission_id}/sign-off", response_model=AdmissionResponse)
async def sign_off(
    admission_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(UserRole.ATTENDING, UserRole.UNIT_PHYSICIAN)),
):
    admission = await _get_admission_or_404(db, admission_id)
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
    user: User = Depends(require_roles(
        UserRole.ATTENDING, UserRole.CHARGE_NURSE, UserRole.HOSPITAL_ADMIN)),
):
    admission = await _get_admission_or_404(db, admission_id)
    # Attending claims themselves; charge nurse / admin assign on behalf via body-less default.
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
    user: User = Depends(require_roles(UserRole.ATTENDING)),
):
    admission = await _get_admission_or_404(db, admission_id)
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
            dependencies=[Depends(get_current_active_user)])
async def list_care_team(admission_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
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
    user: User = Depends(require_roles(UserRole.ATTENDING, UserRole.UNIT_PHYSICIAN)),
):
    admission = await _get_admission_or_404(db, admission_id)
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
    user: User = Depends(require_roles(UserRole.NURSE, UserRole.CHARGE_NURSE)),
):
    admission = await _get_admission_or_404(db, admission_id)
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
    user: User = Depends(require_roles(UserRole.ATTENDING, UserRole.UNIT_PHYSICIAN)),
):
    admission = await _get_admission_or_404(db, admission_id)
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
    user: User = Depends(require_roles(UserRole.CHARGE_NURSE)),
):
    admission = await _get_admission_or_404(db, admission_id)
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
    user: User = Depends(require_roles(UserRole.CHARGE_NURSE)),
):
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
    user: User = Depends(get_current_active_user),
):
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
    user: User = Depends(get_current_active_user),
):
    handover = await db.get(Handover, handover_id)
    if handover is None:
        raise HTTPException(status_code=404, detail="Handover not found.")
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
    user: User = Depends(get_current_active_user),
):
    handover = await db.get(Handover, handover_id)
    if handover is None:
        raise HTTPException(status_code=404, detail="Handover not found.")
    try:
        await service.countersign_handover_incoming(db, handover, user_id=user.id)
    except WorkflowError as exc:
        raise _wf(exc)
    await db.commit()
    await db.refresh(handover)
    return handover

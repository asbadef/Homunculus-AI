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
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission import service
from homunculus.admission.models import (
    Admission, CareTeamMember, Handover, NurseBedAssignment, Patient,
)
from homunculus.admission.schemas import (
    AdmissionCreate, AdmissionResponse, CareTeamAdd, CareTeamMemberResponse,
    DischargeInitiate, HandoverOpen, HandoverResponse, HandoverSign,
    NurseBedAssignmentResponse, PatientResponse, ShiftScheduleCreate,
    ShiftScheduleResponse, TransferInitiate,
)
from homunculus.admission.service import WorkflowError
from homunculus.escalation import service as escalation_service
from homunculus.auth.access import (
    ensure_member, ensure_role_in_tenant, member_tenant_ids, roles_in_tenant,
)
from homunculus.auth.dependencies import get_current_active_user, require_roles
from homunculus.auth.models import User, UserRole
from homunculus.db import get_db
from homunculus.escalation.models import BreakGlassSession
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


async def _user_or_404(db: AsyncSession, user_id: uuid.UUID) -> User:
    other = await db.get(User, user_id)
    if other is None:
        raise HTTPException(status_code=404, detail="User not found.")
    return other


async def _visible_admission_or_404(
    db: AsyncSession, admission_id: uuid.UUID, user: User,
) -> Admission:
    """K1: an admission is visible only to members of its hospital (others get 404)."""
    admission = await _get_admission_or_404(db, admission_id)
    await ensure_member(db, user, admission.tenant_id)
    return admission


def _admission_as(*roles: UserRole):
    """K2: load the admission and require one of `roles` IN THAT ADMISSION'S HOSPITAL (a role held
    in some other hospital counts for nothing)."""
    async def _dep(
        admission_id: uuid.UUID,
        db: AsyncSession = Depends(get_db),
        user: User = Depends(require_roles(*roles)),
    ) -> Admission:
        admission = await _get_admission_or_404(db, admission_id)
        await ensure_role_in_tenant(db, user, admission.tenant_id, *roles)
        return admission
    return _dep


async def _require_role_in_unit_hospital(
    db: AsyncSession, user: User, unit_id: uuid.UUID, *roles: UserRole,
) -> uuid.UUID:
    tenant_id = await _resolve_tenant_id(db, unit_id)
    await ensure_role_in_tenant(db, user, tenant_id, *roles)
    return tenant_id


async def _may_see_identity(db: AsyncSession, user: User, admission: Admission) -> bool:
    """Patient identity: care team, the nurse assigned to the bed this shift, the hospital's charge
    nurse, or the user's own live break-glass session for this patient."""
    now = datetime.now(timezone.utc)
    roles = await roles_in_tenant(db, user, admission.tenant_id)
    if UserRole.CHARGE_NURSE in roles:
        return True
    team = await db.execute(
        select(CareTeamMember.id).where(
            CareTeamMember.admission_id == admission.id,
            CareTeamMember.user_id == user.id,
            CareTeamMember.is_active == True,  # noqa: E712
            or_(CareTeamMember.window_start.is_(None), CareTeamMember.window_start <= now),
            or_(CareTeamMember.window_end.is_(None), CareTeamMember.window_end >= now),
        ).limit(1)
    )
    if team.first() is not None:
        return True
    shift = await db.execute(
        select(NurseBedAssignment.id).where(
            NurseBedAssignment.bed_id == admission.bed_id,
            NurseBedAssignment.nurse_id == user.id,
            NurseBedAssignment.is_active == True,  # noqa: E712
            NurseBedAssignment.shift_start <= now,
            NurseBedAssignment.shift_end >= now,
        ).limit(1)
    )
    if shift.first() is not None:
        return True
    bg = await db.execute(
        select(BreakGlassSession.id).where(
            BreakGlassSession.user_id == user.id,
            BreakGlassSession.patient_id == admission.patient_id,
            BreakGlassSession.closed_at.is_(None),
            BreakGlassSession.expires_at > now,
        ).limit(1)
    )
    return bg.first() is not None


# ---------------------------------------------------------------------------
# Create DRAFT admission (§4.1)
# ---------------------------------------------------------------------------
@router.post("", response_model=AdmissionResponse, status_code=201,
             dependencies=[Depends(require_roles(UserRole.NURSE, UserRole.CHARGE_NURSE))])
async def create_admission(
    payload: AdmissionCreate, db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    # K2: NURSE / CHARGE_NURSE role must be held in the hospital that owns the unit.
    tenant_id = await _require_role_in_unit_hospital(
        db, user, payload.note.admitting_unit_id, UserRole.NURSE, UserRole.CHARGE_NURSE)

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
@router.get("", response_model=list[AdmissionResponse])
async def list_admissions(
    unit_id: uuid.UUID | None = None, db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    # K1: server-side hospital filter; a foreign unit_id simply matches nothing.
    stmt = select(Admission).where(Admission.tenant_id.in_(await member_tenant_ids(db, user)))
    if unit_id is not None:
        stmt = stmt.where(Admission.admitting_unit_id == unit_id)
    result = await db.execute(stmt.order_by(Admission.created_at.desc()))
    return list(result.scalars().all())


@router.get("/{admission_id}", response_model=AdmissionResponse)
async def get_admission(
    admission_id: uuid.UUID, db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    return await _visible_admission_or_404(db, admission_id, user)


@router.get("/{admission_id}/patient", response_model=PatientResponse)
async def get_admission_patient(
    admission_id: uuid.UUID, db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    """PHI detail — returned only to the care team / assigned nurse / charge nurse / break-glass."""
    admission = await _visible_admission_or_404(db, admission_id, user)
    if not await _may_see_identity(db, user, admission):
        raise HTTPException(status_code=403, detail="Not on this patient's care team.")
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
    user: User = Depends(get_current_active_user),
    admission: Admission = Depends(_admission_as(UserRole.ATTENDING, UserRole.UNIT_PHYSICIAN)),
):
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
    user: User = Depends(get_current_active_user),
    admission: Admission = Depends(_admission_as(UserRole.ATTENDING, UserRole.CHARGE_NURSE, UserRole.HOSPITAL_ADMIN)),
):
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
    user: User = Depends(get_current_active_user),
    admission: Admission = Depends(_admission_as(UserRole.ATTENDING)),
):
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


@router.get("/{admission_id}/care-team", response_model=list[CareTeamMemberResponse])
async def list_care_team(
    admission_id: uuid.UUID, db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    await _visible_admission_or_404(db, admission_id, user)
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
    user: User = Depends(get_current_active_user),
    admission: Admission = Depends(_admission_as(UserRole.ATTENDING, UserRole.UNIT_PHYSICIAN)),
):
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
    user: User = Depends(get_current_active_user),
    admission: Admission = Depends(_admission_as(UserRole.NURSE, UserRole.CHARGE_NURSE)),
):
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
    user: User = Depends(get_current_active_user),
    admission: Admission = Depends(_admission_as(UserRole.ATTENDING, UserRole.UNIT_PHYSICIAN)),
):
    unacked = await escalation_service.count_unacknowledged_critical(
        db, admission_id=admission.id, tenant_id=admission.tenant_id
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
    user: User = Depends(get_current_active_user),
    admission: Admission = Depends(_admission_as(UserRole.CHARGE_NURSE)),
):
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
    await _require_role_in_unit_hospital(db, user, payload.unit_id, UserRole.CHARGE_NURSE)
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


async def _handover_or_404(db: AsyncSession, handover_id: uuid.UUID, user: User) -> tuple[Handover, uuid.UUID]:
    """K1: a handover is visible only to members of its unit's hospital; others get the same 404
    as for a missing record."""
    handover = await db.get(Handover, handover_id)
    if handover is None:
        raise HTTPException(status_code=404, detail="Handover not found.")
    try:
        tenant_id = await _resolve_tenant_id(db, handover.unit_id)
        await ensure_member(db, user, tenant_id)
    except HTTPException:
        raise HTTPException(status_code=404, detail="Handover not found.")
    return handover, tenant_id


@handover_router.post("", response_model=HandoverResponse, status_code=201)
async def open_handover(
    payload: HandoverOpen,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    tenant_id = await _resolve_tenant_id(db, payload.unit_id)
    await ensure_member(db, user, tenant_id)
    # Incoming clinician and every admission must belong to the same hospital as the unit.
    await ensure_member(db, await _user_or_404(db, payload.incoming_user_id), tenant_id)
    for admission_id in payload.admission_ids:
        admission = await _get_admission_or_404(db, admission_id)
        if admission.tenant_id != tenant_id:
            raise HTTPException(status_code=404, detail="Admission not found.")
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
    handover, tenant_id = await _handover_or_404(db, handover_id, user)
    admission_ids = [uuid.UUID(a) for a in (handover.admission_ids or [])]
    unacked = await escalation_service.count_unacknowledged_critical(
        db, admission_ids=admission_ids, tenant_id=tenant_id
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
    handover, _ = await _handover_or_404(db, handover_id, user)
    try:
        await service.countersign_handover_incoming(db, handover, user_id=user.id)
    except WorkflowError as exc:
        raise _wf(exc)
    await db.commit()
    await db.refresh(handover)
    return handover

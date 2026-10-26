"""
Admission workflow business logic.

Encapsulates the rules that the API layer and background jobs both depend on, so
they can be unit-tested without HTTP:

  * single-ACTIVE-admission-per-patient constraint (hard)
  * admission state machine (§1.4) with bed-state side effects (§4.1/4.6/4.7)
  * DRAFT 2-hour review timeout reminder (S-26)
  * transfer receiving-attending 1-hour confirmation deadline (S-27)
  * care-team assignment rules (§4.2–4.3), incl. ONCALL time-box (§3.3)
  * nurse–bed shift assignment with soft over-capacity warning (§4.4, S-25)
  * handover dual-signature + 30-min bridge (S-24) + CRITICAL-alert block (S-07)
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission import errors
from homunculus.admission.models import (
    Admission, AdmissionState, CareTeamMember, CareTeamRole, Handover,
    HandoverStatus, NurseBedAssignment, OPEN_ADMISSION_STATES, Patient,
)
from homunculus.tenant.models import Bed, BedState, Unit

# --- Settled timing decisions ---
DRAFT_REVIEW_TIMEOUT = timedelta(hours=2)        # S-26
TRANSFER_CONFIRM_TIMEOUT = timedelta(hours=1)    # S-27
HANDOVER_BRIDGE_WINDOW = timedelta(minutes=30)   # S-24
ONCALL_MAX_WINDOW = timedelta(hours=48)          # §3.3


def _now() -> datetime:
    return datetime.now(timezone.utc)


class WorkflowError(Exception):
    """Raised for business-rule violations; mapped to HTTP 409 by the router, with `code` beside
    the words (admission/errors.py) — the dashboard reads the code, never the words."""

    def __init__(self, message: str, code: str = errors.INVALID_TRANSITION) -> None:
        super().__init__(message)
        self.code = code


# ---------------------------------------------------------------------------
# Admission creation & the single-ACTIVE constraint
# ---------------------------------------------------------------------------
async def get_active_admission_for_patient(
    db: AsyncSession, patient_id: uuid.UUID
) -> Admission | None:
    result = await db.execute(
        select(Admission).where(
            Admission.patient_id == patient_id,
            Admission.state == AdmissionState.ACTIVE,
        )
    )
    return result.scalar_one_or_none()


async def get_open_admission_for_patient(
    db: AsyncSession, patient_id: uuid.UUID
) -> Admission | None:
    """Any non-terminal admission (DRAFT/ACTIVE/PENDING_*)."""
    result = await db.execute(
        select(Admission).where(
            Admission.patient_id == patient_id,
            Admission.state.in_(OPEN_ADMISSION_STATES),
        )
    )
    return result.scalars().first()


async def create_draft_admission(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    patient: Patient,
    note_fields: dict,
) -> Admission:
    """
    §4.1 steps 2–3: create a DRAFT admission and provisionally occupy the bed.

    Enforces the hard constraint: a patient may not have another open admission.
    """
    existing = await get_open_admission_for_patient(db, patient.id)
    if existing is not None:
        raise WorkflowError(
            f"Patient already has an open admission ({existing.state.value}); "
            f"a patient may have only one active admission at a time.",
            errors.OPEN_ADMISSION,
        )

    bed = await db.get(Bed, note_fields["bed_id"])
    if bed is None:
        raise WorkflowError("Target bed not found.")
    if bed.state != BedState.AVAILABLE:
        raise WorkflowError(
            f"Bed is not AVAILABLE (current state: {bed.state.value}); "
            f"cannot admit.",
            errors.BED_NOT_AVAILABLE,
        )

    admission = Admission(
        patient_id=patient.id,
        tenant_id=tenant_id,
        state=AdmissionState.DRAFT,
        **note_fields,
    )
    if admission.admission_datetime is None:
        admission.admission_datetime = _now()
    db.add(admission)

    # Bed transitions to OCCUPIED provisionally (§4.1 step 3).
    bed.transition_to(BedState.OCCUPIED)

    await db.flush()
    return admission


# ---------------------------------------------------------------------------
# DRAFT → ACTIVE sign-off (§4.1 steps 4–5)
# ---------------------------------------------------------------------------
async def sign_off_admission(
    db: AsyncSession, admission: Admission, *, signing_user_id: uuid.UUID
) -> Admission:
    if admission.state != AdmissionState.DRAFT:
        raise WorkflowError(
            f"Only a DRAFT admission can be signed off (current: {admission.state.value})."
        )
    if admission.attending_physician_id is None:
        raise WorkflowError(
            "attending_physician_id must be resolved before a DRAFT can become ACTIVE "
            "(§5.2 field 8).",
            errors.MISSING_ATTENDING,
        )
    # Re-check single-ACTIVE constraint at the moment of activation.
    active = await get_active_admission_for_patient(db, admission.patient_id)
    if active is not None and active.id != admission.id:
        raise WorkflowError("Patient already has an ACTIVE admission.")

    admission.transition_to(AdmissionState.ACTIVE)
    admission.signed_by = signing_user_id
    admission.signed_at = _now()
    await db.flush()
    return admission


# ---------------------------------------------------------------------------
# DRAFT review timeout — S-26
# ---------------------------------------------------------------------------
async def find_stale_draft_admissions(db: AsyncSession) -> list[Admission]:
    """
    Return DRAFT admissions older than the 2-hour review window that have not yet
    had a reminder emitted. Callers (background job) send the CHARGE_NURSE reminder
    and then mark `draft_reminder_sent = True`.
    """
    cutoff = _now() - DRAFT_REVIEW_TIMEOUT
    result = await db.execute(
        select(Admission).where(
            Admission.state == AdmissionState.DRAFT,
            Admission.created_at <= cutoff,
            Admission.draft_reminder_sent.is_(False),
        )
    )
    return list(result.scalars().all())


# ---------------------------------------------------------------------------
# Care team — §4.2–4.3, §3.3
# ---------------------------------------------------------------------------
async def claim_attending(
    db: AsyncSession, admission: Admission, *, attending_id: uuid.UUID,
    granted_by_id: uuid.UUID | None = None,
) -> CareTeamMember:
    """§4.2 — an attending takes the patient (or is assigned on their behalf)."""
    admission.attending_physician_id = attending_id
    member = CareTeamMember(
        admission_id=admission.id,
        user_id=attending_id,
        role=CareTeamRole.ATTENDING,
        granted_by_id=granted_by_id or attending_id,
    )
    db.add(member)
    await db.flush()
    return member


async def add_care_team_member(
    db: AsyncSession, admission: Admission, *, user_id: uuid.UUID,
    role: CareTeamRole, granted_by_id: uuid.UUID,
    window_start: datetime | None = None, window_end: datetime | None = None,
) -> CareTeamMember:
    """§4.3 — attending adds an associate or a time-boxed on-call physician."""
    if role == CareTeamRole.ONCALL_PHYSICIAN:
        if window_start is None or window_end is None:
            raise WorkflowError("ONCALL_PHYSICIAN requires window_start and window_end (§3.3).")
        if window_end <= window_start:
            raise WorkflowError("window_end must be after window_start.")
        if window_end - window_start > ONCALL_MAX_WINDOW:
            raise WorkflowError("On-call window cannot exceed 48 hours in a single grant (§3.3).")

    member = CareTeamMember(
        admission_id=admission.id,
        user_id=user_id,
        role=role,
        granted_by_id=granted_by_id,
        window_start=window_start,
        window_end=window_end,
    )
    db.add(member)
    await db.flush()
    return member


# ---------------------------------------------------------------------------
# Nurse–bed shift assignment — §4.4, S-25
# ---------------------------------------------------------------------------
async def create_shift_schedule(
    db: AsyncSession, *, unit_id: uuid.UUID, charge_nurse_id: uuid.UUID,
    assignments: list[dict],
) -> tuple[list[NurseBedAssignment], list[str]]:
    """
    Create bed–nurse assignments for a shift.

    S-25: exceeding the unit's max_beds_per_nurse is a SOFT warning (not a hard
    block); the over-capacity condition is surfaced and audit-logged by the caller.
    """
    unit = await db.get(Unit, unit_id)
    if unit is None:
        raise WorkflowError("Unit not found.")

    warnings: list[str] = []
    beds_per_nurse: dict[uuid.UUID, int] = {}
    for a in assignments:
        beds_per_nurse[a["nurse_id"]] = beds_per_nurse.get(a["nurse_id"], 0) + 1

    for nurse_id, count in beds_per_nurse.items():
        if count > unit.max_beds_per_nurse:
            warnings.append(
                f"Nurse {nurse_id} is assigned {count} beds, exceeding the unit "
                f"maximum of {unit.max_beds_per_nurse} (soft limit, S-25)."
            )

    created: list[NurseBedAssignment] = []
    for a in assignments:
        row = NurseBedAssignment(
            unit_id=unit_id,
            bed_id=a["bed_id"],
            nurse_id=a["nurse_id"],
            charge_nurse_id=charge_nurse_id,
            shift_start=a["shift_start"],
            shift_end=a["shift_end"],
        )
        db.add(row)
        created.append(row)

    await db.flush()
    return created, warnings


# ---------------------------------------------------------------------------
# Transfer — §4.6, S-27
# ---------------------------------------------------------------------------
async def initiate_transfer(
    db: AsyncSession, admission: Admission, *,
    target_bed_id: uuid.UUID, target_unit_id: uuid.UUID,
) -> Admission:
    if admission.state != AdmissionState.ACTIVE:
        raise WorkflowError("Only an ACTIVE admission can be transferred.")
    target_bed = await db.get(Bed, target_bed_id)
    if target_bed is None:
        raise WorkflowError("Target bed not found.")
    if target_bed.state != BedState.AVAILABLE:
        raise WorkflowError(
            f"Target bed is not AVAILABLE (state: {target_bed.state.value})."
        )

    admission.transition_to(AdmissionState.PENDING_TRANSFER)
    # Source bed transitions to PENDING_TRANSFER_OUT (§4.6 step 4).
    source_bed = await db.get(Bed, admission.bed_id)
    if source_bed is not None:
        source_bed.transition_to(BedState.PENDING_TRANSFER_OUT)
    await db.flush()
    return admission


async def confirm_transfer_arrival(
    db: AsyncSession, admission: Admission, *,
    target_bed_id: uuid.UUID, target_unit_id: uuid.UUID,
) -> Admission:
    """
    §4.6 steps 5–7: nurse confirms arrival; the source admission closes as
    TRANSFERRED and a new ACTIVE admission is created at the target bed, with
    care-team copied and a 1-hour attending-confirmation deadline (S-27).
    """
    if admission.state != AdmissionState.PENDING_TRANSFER:
        raise WorkflowError("Admission is not awaiting transfer confirmation.")

    target_bed = await db.get(Bed, target_bed_id)
    if target_bed is None or target_bed.state != BedState.AVAILABLE:
        raise WorkflowError("Target bed is no longer AVAILABLE.")

    # Close source.
    admission.transition_to(AdmissionState.TRANSFERRED)
    source_bed = await db.get(Bed, admission.bed_id)
    if source_bed is not None:
        source_bed.transition_to(BedState.HOUSEKEEPING)

    # Create new ACTIVE admission at target, copying the short note.
    new_admission = Admission(
        patient_id=admission.patient_id,
        tenant_id=admission.tenant_id,
        state=AdmissionState.ACTIVE,
        admission_datetime=_now(),
        admitting_unit_id=target_unit_id,
        bed_id=target_bed_id,
        attending_physician_id=admission.attending_physician_id,
        admission_diagnosis_free_text=admission.admission_diagnosis_free_text,
        icd10_codes=admission.icd10_codes,
        active_comorbidities=admission.active_comorbidities,
        active_medications_on_admission=admission.active_medications_on_admission,
        known_allergies=admission.known_allergies,
        baseline_spo2_range=admission.baseline_spo2_range,
        baseline_heart_rate_range=admission.baseline_heart_rate_range,
        baseline_blood_pressure_range=admission.baseline_blood_pressure_range,
        baseline_respiratory_rate_range=admission.baseline_respiratory_rate_range,
        baseline_temperature_range=admission.baseline_temperature_range,
        weight_kg=admission.weight_kg,
        height_cm=admission.height_cm,
        gestational_age_weeks=admission.gestational_age_weeks,
        postnatal_day=admission.postnatal_day,
        transplant_day_zero=admission.transplant_day_zero,
        cardiac_surgery_name=admission.cardiac_surgery_name,
        admission_note_narrative=admission.admission_note_narrative,
        source_of_admission=admission.source_of_admission,
        signed_by=admission.signed_by,
        signed_at=admission.signed_at,
        source_admission_id=admission.id,
        transfer_confirm_deadline=_now() + TRANSFER_CONFIRM_TIMEOUT,  # S-27
    )
    db.add(new_admission)
    target_bed.transition_to(BedState.OCCUPIED)

    # Copy active care-team assignments (§4.6 step 7).
    result = await db.execute(
        select(CareTeamMember).where(
            CareTeamMember.admission_id == admission.id,
            CareTeamMember.is_active.is_(True),
        )
    )
    for member in result.scalars().all():
        db.add(CareTeamMember(
            admission_id=new_admission.id,
            user_id=member.user_id,
            role=member.role,
            granted_by_id=member.granted_by_id,
            window_start=member.window_start,
            window_end=member.window_end,
        ))

    await db.flush()
    return new_admission


# ---------------------------------------------------------------------------
# Discharge — §4.7, S-28
# ---------------------------------------------------------------------------
async def initiate_discharge(
    db: AsyncSession, admission: Admission, *,
    discharge_summary: str, unacknowledged_critical_count: int = 0,
) -> Admission:
    if admission.state != AdmissionState.ACTIVE:
        raise WorkflowError("Only an ACTIVE admission can be discharged.")
    # §4.7 step 2 — block on unacknowledged CRITICAL alerts.
    if unacknowledged_critical_count > 0:
        raise WorkflowError(
            f"Discharge blocked: {unacknowledged_critical_count} unacknowledged "
            f"CRITICAL alert(s) must be acknowledged with a reason first (§4.7).",
            errors.CRITICAL_ALARM_OPEN,
        )
    admission.transition_to(AdmissionState.PENDING_DISCHARGE)
    admission.admission_note_narrative = (
        (admission.admission_note_narrative or "") + f"\n[DISCHARGE] {discharge_summary}"
    )
    bed = await db.get(Bed, admission.bed_id)
    if bed is not None:
        bed.transition_to(BedState.PENDING_DISCHARGE)
    await db.flush()
    return admission


async def confirm_discharge(db: AsyncSession, admission: Admission) -> Admission:
    """§4.7 steps 5–7: charge nurse confirms the patient has left the bed."""
    if admission.state != AdmissionState.PENDING_DISCHARGE:
        raise WorkflowError("Admission is not pending discharge.")
    admission.transition_to(AdmissionState.DISCHARGED)
    bed = await db.get(Bed, admission.bed_id)
    if bed is not None:
        bed.transition_to(BedState.HOUSEKEEPING)
    # Close all active care-team assignments (§4.7 step 7).
    result = await db.execute(
        select(CareTeamMember).where(
            CareTeamMember.admission_id == admission.id,
            CareTeamMember.is_active.is_(True),
        )
    )
    for member in result.scalars().all():
        member.is_active = False
        member.closed_at = _now()
    await db.flush()
    return admission


# ---------------------------------------------------------------------------
# Handover — §4.5, S-07, S-24
# ---------------------------------------------------------------------------
async def open_handover(
    db: AsyncSession, *, unit_id: uuid.UUID, outgoing_user_id: uuid.UUID,
    incoming_user_id: uuid.UUID, admission_ids: list[uuid.UUID],
    auto_populated_summary: dict | None = None,
) -> Handover:
    now = _now()
    handover = Handover(
        unit_id=unit_id,
        outgoing_user_id=outgoing_user_id,
        incoming_user_id=incoming_user_id,
        admission_ids=[str(a) for a in admission_ids],
        auto_populated_summary=auto_populated_summary,
        status=HandoverStatus.OPEN,
        bridge_opened_at=now,
        bridge_expires_at=now + HANDOVER_BRIDGE_WINDOW,  # S-24
    )
    db.add(handover)
    await db.flush()
    return handover


def is_bridge_active(handover: Handover, *, at: datetime | None = None) -> bool:
    """S-24: both parties have simultaneous read access while the bridge is open."""
    at = at or _now()
    if handover.status == HandoverStatus.COMPLETED:
        return False
    return at < handover.bridge_expires_at


async def sign_handover_outgoing(
    db: AsyncSession, handover: Handover, *, user_id: uuid.UUID,
    narrative_note: str | None, unacknowledged_critical_count: int = 0,
) -> Handover:
    if handover.status not in (HandoverStatus.OPEN,):
        raise WorkflowError(f"Handover is not open (status: {handover.status.value}).")
    if user_id != handover.outgoing_user_id:
        raise WorkflowError("Only the outgoing clinician can sign the outgoing side.")
    if _now() >= handover.bridge_expires_at:
        handover.status = HandoverStatus.EXPIRED
        await db.flush()
        raise WorkflowError("Handover bridge window has expired (S-24); reopen the handover.")
    # S-07: cannot sign off while an unacknowledged CRITICAL alert exists.
    if unacknowledged_critical_count > 0:
        raise WorkflowError(
            f"Handover blocked: {unacknowledged_critical_count} unacknowledged "
            f"CRITICAL alert(s). Acknowledge (with reason) or escalate first (S-07)."
        )
    handover.outgoing_signed_at = _now()
    if narrative_note is not None:
        handover.narrative_note = narrative_note
    handover.status = HandoverStatus.OUTGOING_SIGNED
    await db.flush()
    return handover


async def countersign_handover_incoming(
    db: AsyncSession, handover: Handover, *, user_id: uuid.UUID,
) -> Handover:
    if handover.status != HandoverStatus.OUTGOING_SIGNED:
        raise WorkflowError("Outgoing clinician must sign before countersignature.")
    if user_id != handover.incoming_user_id:
        raise WorkflowError("Only the incoming clinician can countersign.")
    handover.incoming_signed_at = _now()
    handover.status = HandoverStatus.COMPLETED
    await db.flush()
    return handover

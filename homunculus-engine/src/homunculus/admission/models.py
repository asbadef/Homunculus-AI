"""
Patient admission workflow ORM models.

Design doc:
  §1.4  Admission state machine
  §4.1–4.7  Assignment / transfer / discharge / handover workflows
  §5.2  Short Admission Note field table (28 fields)

Settled decisions:
  S-07  Handover requires dual signature; blocked while an unacknowledged CRITICAL
        alert exists.
  S-24  Handover access bridge = 30 minutes of simultaneous dual access.
  S-26  A DRAFT admission unreviewed for 2 hours triggers a CHARGE_NURSE reminder.
  S-27  After a transfer, the receiving attending must confirm within 1 hour.

PHI RULE (§5.2): patient-identifiable fields live on `Patient` and are stored
encrypted at rest via `EncryptedString`. Clinical note fields on `Admission` are
NOT PHI and are stored in the clear.

CLINICAL RULE: this module records context and workflow state only. It never
produces a diagnosis and never issues an imperative clinical instruction.
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, Date, DateTime, Enum, Float, ForeignKey, Integer,
    String, Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from homunculus.crypto import EncryptedString
from homunculus.db import Base


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------
class AdmissionState(str, enum.Enum):
    """§1.4 — Admission lifecycle."""
    DRAFT = "DRAFT"
    ACTIVE = "ACTIVE"
    PENDING_DISCHARGE = "PENDING_DISCHARGE"
    PENDING_TRANSFER = "PENDING_TRANSFER"
    DISCHARGED = "DISCHARGED"       # terminal
    TRANSFERRED = "TRANSFERRED"     # terminal


# Valid admission state transitions (§1.4 / §4.6 / §4.7).
ADMISSION_STATE_TRANSITIONS: dict[AdmissionState, set[AdmissionState]] = {
    AdmissionState.DRAFT: {AdmissionState.ACTIVE},
    AdmissionState.ACTIVE: {
        AdmissionState.PENDING_DISCHARGE,
        AdmissionState.PENDING_TRANSFER,
    },
    # Discharge can be cancelled back to ACTIVE before charge-nurse confirmation.
    AdmissionState.PENDING_DISCHARGE: {
        AdmissionState.DISCHARGED,
        AdmissionState.ACTIVE,
    },
    # Transfer can be rejected/cancelled back to ACTIVE before arrival confirmation.
    AdmissionState.PENDING_TRANSFER: {
        AdmissionState.TRANSFERRED,
        AdmissionState.ACTIVE,
    },
    AdmissionState.DISCHARGED: set(),
    AdmissionState.TRANSFERRED: set(),
}

# States in which an admission is considered "open" (occupies the patient).
OPEN_ADMISSION_STATES = {
    AdmissionState.DRAFT,
    AdmissionState.ACTIVE,
    AdmissionState.PENDING_DISCHARGE,
    AdmissionState.PENDING_TRANSFER,
}


class Sex(str, enum.Enum):
    male = "male"
    female = "female"
    other = "other"
    unknown = "unknown"


class SourceOfAdmission(str, enum.Enum):
    EMERGENCY = "EMERGENCY"
    ELECTIVE_SURGERY = "ELECTIVE_SURGERY"
    TRANSFER_INTERNAL = "TRANSFER_INTERNAL"
    TRANSFER_EXTERNAL = "TRANSFER_EXTERNAL"
    OTHER = "OTHER"


class CareTeamRole(str, enum.Enum):
    """§4.2–4.3 — care-team clinician roles scoped to an admission."""
    ATTENDING = "ATTENDING"
    ASSOCIATE_PHYSICIAN = "ASSOCIATE_PHYSICIAN"
    ONCALL_PHYSICIAN = "ONCALL_PHYSICIAN"


class HandoverStatus(str, enum.Enum):
    OPEN = "OPEN"                     # bridge active, no signatures yet
    OUTGOING_SIGNED = "OUTGOING_SIGNED"
    COMPLETED = "COMPLETED"           # both signatures done
    EXPIRED = "EXPIRED"               # bridge window elapsed before completion


# ---------------------------------------------------------------------------
# Patient — holds PHI (encrypted at rest)
# ---------------------------------------------------------------------------
class Patient(Base):
    """
    Patient identity. All PHI columns (§5.2 fields 1–4, 28) are encrypted at rest.

    The internal `id` is the system identifier (§5.2 field 1). It is never a real
    hospital MRN; the HIS reference (field 28) is encrypted separately.
    """
    __tablename__ = "patients"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # PHI — encrypted at rest (§5.2 fields 2, 3, 4, 28)
    display_name: Mapped[str] = mapped_column(EncryptedString(512), nullable=False)          # #2
    date_of_birth: Mapped[str] = mapped_column(EncryptedString(512), nullable=False)          # #3 (ISO-8601 date str)
    sex: Mapped[str] = mapped_column(EncryptedString(512), nullable=False)                     # #4
    his_patient_reference: Mapped[str | None] = mapped_column(EncryptedString(512), nullable=True)  # #28

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    admissions: Mapped[list[Admission]] = relationship(
        "Admission", back_populates="patient", cascade="all, delete-orphan"
    )


# ---------------------------------------------------------------------------
# Admission — the short admission note (non-PHI clinical context)
# ---------------------------------------------------------------------------
class Admission(Base):
    """
    A single ICU stay. Holds the short admission note (§5.2 fields 5–27; PHI
    fields live on Patient) and the lifecycle state.

    CONSTRAINT: a patient may have at most one ACTIVE admission at a time. Enforced
    by a partial unique index (see migration) and re-checked in the service layer.
    """
    __tablename__ = "admissions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("patients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    state: Mapped[AdmissionState] = mapped_column(
        Enum(AdmissionState), nullable=False, default=AdmissionState.DRAFT, index=True
    )

    # --- Short Admission Note, non-PHI fields (§5.2) ---
    admission_datetime: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)  # #5
    admitting_unit_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("units.id", ondelete="RESTRICT"), nullable=False, index=True
    )                                                                                              # #6
    bed_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("beds.id", ondelete="RESTRICT"), nullable=False, index=True
    )                                                                                              # #7
    attending_physician_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )                                                                                              # #8
    admission_diagnosis_free_text: Mapped[str] = mapped_column(String(500), nullable=False)        # #9
    icd10_codes: Mapped[list | None] = mapped_column(JSONB, nullable=True)                          # #10
    active_comorbidities: Mapped[list | None] = mapped_column(JSONB, nullable=True)                 # #11
    active_medications_on_admission: Mapped[list | None] = mapped_column(JSONB, nullable=True)      # #12
    known_allergies: Mapped[list | None] = mapped_column(JSONB, nullable=True)                      # #13
    baseline_spo2_range: Mapped[str | None] = mapped_column(String(64), nullable=True)              # #14
    baseline_heart_rate_range: Mapped[str | None] = mapped_column(String(64), nullable=True)        # #15
    baseline_blood_pressure_range: Mapped[str | None] = mapped_column(String(64), nullable=True)    # #16
    baseline_respiratory_rate_range: Mapped[str | None] = mapped_column(String(64), nullable=True)  # #17
    baseline_temperature_range: Mapped[str | None] = mapped_column(String(64), nullable=True)       # #18
    weight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)                           # #19
    height_cm: Mapped[float | None] = mapped_column(Float, nullable=True)                           # #20
    gestational_age_weeks: Mapped[float | None] = mapped_column(Float, nullable=True)               # #21
    postnatal_day: Mapped[int | None] = mapped_column(Integer, nullable=True)                       # #22
    transplant_day_zero: Mapped[datetime | None] = mapped_column(Date, nullable=True)               # #23
    cardiac_surgery_name: Mapped[str | None] = mapped_column(String(200), nullable=True)            # #24
    admission_note_narrative: Mapped[str | None] = mapped_column(Text, nullable=True)               # #25
    source_of_admission: Mapped[SourceOfAdmission | None] = mapped_column(
        Enum(SourceOfAdmission), nullable=True
    )                                                                                              # #26
    signed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )                                                                                              # #27
    signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # --- Workflow bookkeeping ---
    # S-26: reminder emitted once when a DRAFT is unreviewed for 2 hours.
    draft_reminder_sent: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # §4.6 transfer linkage + S-27 receiving-attending confirmation deadline (1 hour).
    source_admission_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("admissions.id", ondelete="SET NULL"), nullable=True
    )
    transfer_confirm_deadline: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    patient: Mapped[Patient] = relationship("Patient", back_populates="admissions")
    care_team: Mapped[list[CareTeamMember]] = relationship(
        "CareTeamMember", back_populates="admission", cascade="all, delete-orphan"
    )

    def transition_to(self, new_state: AdmissionState) -> None:
        """Validate and apply an admission state transition (§1.4)."""
        allowed = ADMISSION_STATE_TRANSITIONS.get(self.state, set())
        if new_state not in allowed:
            raise ValueError(
                f"Admission state transition {self.state} → {new_state} is not "
                f"permitted. Allowed: {allowed or '{} (terminal)'}"
            )
        self.state = new_state
        self.updated_at = datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Care team (Dimension A — §3.1, §4.2–4.3)
# ---------------------------------------------------------------------------
class CareTeamMember(Base):
    """A clinician linked to a specific admission for the duration of that stay."""
    __tablename__ = "care_team_members"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    admission_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("admissions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[CareTeamRole] = mapped_column(Enum(CareTeamRole), nullable=False)
    granted_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # §3.3 time-boxed ON-CALL coverage window (null for permanent care-team links).
    window_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    window_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    admission: Mapped[Admission] = relationship("Admission", back_populates="care_team")

    __table_args__ = (
        # A user holds at most one active care-team row per admission.
        UniqueConstraint("admission_id", "user_id", "is_active",
                         name="uq_care_team_active_member"),
    )


# ---------------------------------------------------------------------------
# Nurse–bed assignment for a shift (§4.4)
# ---------------------------------------------------------------------------
class NurseBedAssignment(Base):
    """CHARGE_NURSE assigns a nurse to a bed for a shift window."""
    __tablename__ = "nurse_bed_assignments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    unit_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("units.id", ondelete="CASCADE"), nullable=False, index=True
    )
    bed_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("beds.id", ondelete="CASCADE"), nullable=False, index=True
    )
    nurse_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    charge_nurse_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    shift_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    shift_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


# ---------------------------------------------------------------------------
# Shift handover (§4.5, S-07, S-24)
# ---------------------------------------------------------------------------
class Handover(Base):
    """
    Shift handover between an outgoing and an incoming clinician.

    S-24: a 30-minute bridge window grants both parties simultaneous read access
    from the moment the form is opened until both sign (or the window expires).
    S-07: cannot be signed off while an unacknowledged CRITICAL alert exists.
    """
    __tablename__ = "handovers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    unit_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("units.id", ondelete="CASCADE"), nullable=False, index=True
    )
    outgoing_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    incoming_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # Admissions covered by this handover (list of admission UUIDs as strings).
    admission_ids: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    # Auto-populated summary snapshot (§4.5 step 2): active alerts, tasks, vitals…
    auto_populated_summary: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    narrative_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[HandoverStatus] = mapped_column(
        Enum(HandoverStatus), nullable=False, default=HandoverStatus.OPEN
    )
    bridge_opened_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
    bridge_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    outgoing_signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    incoming_signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

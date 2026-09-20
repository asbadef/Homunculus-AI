"""
Alarm, escalation and break-glass ORM models.

Design doc:
  §6.1  Alert tiers (CRITICAL / HIGH / MEDIUM / LOW / INFO)
  §6.2  Per-signal snooze
  §6.3  Escalation chain
  §3.5  Break-glass emergency access

Settled decisions:
  S-05  Unacknowledged CRITICAL/HIGH auto-escalation: 3 min → CHARGE_NURSE,
        5 min → ON-CALL / ATTENDING physician, 10 min → RAPID_RESPONSE (RRT).
  S-06  RRT accesses only patients with an active escalation event (no standing
        unit-list access); an escalation event is created at tier 3.
  S-22  Snooze caps: HIGH ≤ 30 min, MEDIUM ≤ 120 min; CRITICAL cannot be snoozed
        (acknowledge with mandatory reason only).
  S-23  Break-glass auto-expiry = 30 minutes; may be extended by refreshing reason.

CLINICAL RULE: this module records alarm/workflow state only. It never produces a
diagnosis and never issues an imperative clinical instruction — an alert cites the
underlying rule/signal and is something a clinician evaluates.

PHI RULE: alerts reference patients by internal id only; no patient-identifiable
data is stored here.
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, DateTime, Enum, ForeignKey, Integer, String, Text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from homunculus.db import Base, JSON_COLUMN


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------
class AlertTier(str, enum.Enum):
    """§6.1 — clinical alarm severity tiers."""
    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"
    INFO = "INFO"


class AlertStatus(str, enum.Enum):
    """Lifecycle of a single alert instance."""
    FIRED = "FIRED"                  # active, unacknowledged
    ACKNOWLEDGED = "ACKNOWLEDGED"    # a clinician has taken ownership
    SNOOZED = "SNOOZED"              # notification suppressed (§6.2); data still visible
    ESCALATED = "ESCALATED"          # auto/manual escalation in progress, still unacknowledged
    CLOSED = "CLOSED"                # triggering condition resolved


class EscalationStep(str, enum.Enum):
    """§6.3 / S-05 — escalation chain steps."""
    NONE = "NONE"
    TIER_1_CHARGE_NURSE = "TIER_1_CHARGE_NURSE"     # 3 min
    TIER_2_PHYSICIAN = "TIER_2_PHYSICIAN"           # 5 min (on-call / attending)
    TIER_3_RRT = "TIER_3_RRT"                       # 10 min (rapid response)


# Ordinal ranking so we can tell whether a step is "further along" than another.
ESCALATION_STEP_ORDER: dict[EscalationStep, int] = {
    EscalationStep.NONE: 0,
    EscalationStep.TIER_1_CHARGE_NURSE: 1,
    EscalationStep.TIER_2_PHYSICIAN: 2,
    EscalationStep.TIER_3_RRT: 3,
}

# Role notified at each escalation step (for notification routing / audit).
ESCALATION_STEP_TARGET_ROLE: dict[EscalationStep, str] = {
    EscalationStep.TIER_1_CHARGE_NURSE: "CHARGE_NURSE",
    EscalationStep.TIER_2_PHYSICIAN: "ONCALL_PHYSICIAN",
    EscalationStep.TIER_3_RRT: "RAPID_RESPONSE",
}


class SnoozeReason(str, enum.Enum):
    """§6.2 — mandatory snooze reason list."""
    CLINICAL_DECISION_MADE = "CLINICAL_DECISION_MADE"
    ARTEFACT_OR_SIGNAL_NOISE = "ARTEFACT_OR_SIGNAL_NOISE"
    PROCEDURE_IN_PROGRESS = "PROCEDURE_IN_PROGRESS"
    PATIENT_BASELINE = "PATIENT_BASELINE"
    OTHER = "OTHER"                  # requires ≥ 15-character free text


class BreakGlassReason(str, enum.Enum):
    """§3.5 — mandatory break-glass reason list."""
    CARDIAC_ARREST = "CARDIAC_ARREST"
    RAPID_DETERIORATION = "RAPID_DETERIORATION"
    COVERING_ABSENT_TEAM = "COVERING_ABSENT_TEAM"
    OTHER = "OTHER"                  # requires ≥ 20-character free text


# ---------------------------------------------------------------------------
# Alert — a single clinical alarm instance
# ---------------------------------------------------------------------------
class Alert(Base):
    """
    A clinical alarm instance raised for a patient/admission.

    The tier drives escalation and snooze eligibility. An alert is something a
    clinician *evaluates*; it is never a diagnosis or an order.
    """
    __tablename__ = "alerts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # An alert is normally tied to an admission; patient/unit denormalised for routing.
    admission_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("admissions.id", ondelete="CASCADE"), nullable=True, index=True
    )
    patient_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("patients.id", ondelete="CASCADE"), nullable=True, index=True
    )
    unit_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("units.id", ondelete="SET NULL"), nullable=True, index=True
    )

    kind: Mapped[str] = mapped_column(String(64), nullable=False)          # e.g. "septic_shock"
    tier: Mapped[AlertTier] = mapped_column(Enum(AlertTier), nullable=False, index=True)
    status: Mapped[AlertStatus] = mapped_column(
        Enum(AlertStatus), nullable=False, default=AlertStatus.FIRED, index=True
    )
    # Human-readable, PHI-minimal (bed label + finding), mirrors the live board.
    summary: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    # The specific signal source this instance is bound to (§6.2), e.g. "SpO2/bed-4A".
    source_signal: Mapped[str | None] = mapped_column(String(200), nullable=True)

    current_escalation_step: Mapped[EscalationStep] = mapped_column(
        Enum(EscalationStep), nullable=False, default=EscalationStep.NONE, index=True
    )

    fired_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    acknowledged_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    ack_reason: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ack_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    snoozes: Mapped[list[AlertSnooze]] = relationship(
        "AlertSnooze", back_populates="alert", cascade="all, delete-orphan"
    )
    escalation_events: Mapped[list[EscalationEvent]] = relationship(
        "EscalationEvent", back_populates="alert", cascade="all, delete-orphan"
    )


# ---------------------------------------------------------------------------
# Snooze (§6.2, S-22)
# ---------------------------------------------------------------------------
class AlertSnooze(Base):
    """A bounded, reason-tagged suppression of an alert's notification (§6.2)."""
    __tablename__ = "alert_snoozes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    alert_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("alerts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    snoozed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reason: Mapped[SnoozeReason] = mapped_column(Enum(SnoozeReason), nullable=False)
    reason_text: Mapped[str | None] = mapped_column(Text, nullable=True)   # required when reason=OTHER
    snoozed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # Cleared when the snooze expires and the alert re-fires (§6.2 auto-expiry).
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    alert: Mapped[Alert] = relationship("Alert", back_populates="snoozes")


# ---------------------------------------------------------------------------
# Escalation event (§6.3, S-05, S-06)
# ---------------------------------------------------------------------------
class EscalationEvent(Base):
    """
    A single step in an alert's escalation chain, recorded for chain-of-custody
    (§6.3) and — at tier 3 — as the object that grants RRT access to the patient
    (S-06: RRT sees only patients with an active escalation event).
    """
    __tablename__ = "escalation_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    alert_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("alerts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    step: Mapped[EscalationStep] = mapped_column(Enum(EscalationStep), nullable=False)
    target_role: Mapped[str] = mapped_column(String(32), nullable=False)
    # NULL triggered_by = automatic (system) escalation; set = manual escalation.
    triggered_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    is_manual: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)         # for manual escalation
    # Closed when the escalation episode ends (alert acknowledged/closed).
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    alert: Mapped[Alert] = relationship("Alert", back_populates="escalation_events")


# ---------------------------------------------------------------------------
# Break-glass emergency access (§3.5, S-23)
# ---------------------------------------------------------------------------
class BreakGlassSession(Base):
    """
    A time-boxed emergency access grant (§3.5). Always audit-logged; the patient's
    attending and the unit charge nurse are notified (non-suppressible). Access
    auto-expires after 30 minutes (S-23) and can be extended by refreshing the
    reason.
    """
    __tablename__ = "break_glass_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    patient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("patients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    reason: Mapped[BreakGlassReason] = mapped_column(Enum(BreakGlassReason), nullable=False)
    reason_text: Mapped[str | None] = mapped_column(Text, nullable=True)    # required when reason=OTHER
    activated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    extension_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # System-captured list of records read/written during the window (§3.5).
    accessed_records: Mapped[list | None] = mapped_column(JSON_COLUMN, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

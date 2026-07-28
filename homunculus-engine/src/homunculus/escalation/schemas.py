"""Pydantic request/response schemas for the alarm, escalation and break-glass API."""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from homunculus.escalation.models import (
    AlertStatus, AlertTier, BreakGlassReason, EscalationStep, SnoozeReason,
)


# ---------------------------------------------------------------------------
# Alerts
# ---------------------------------------------------------------------------
class AlertCreate(BaseModel):
    admission_id: uuid.UUID | None = None
    patient_id: uuid.UUID | None = None
    unit_id: uuid.UUID | None = None
    kind: str = Field(min_length=1, max_length=64)
    tier: AlertTier
    summary: str = Field(default="", max_length=500)
    source_signal: str | None = Field(default=None, max_length=200)


class AlertAcknowledge(BaseModel):
    # CRITICAL requires reason + free-text note ≥ 20 chars (§6.2).
    reason: str | None = Field(default=None, max_length=64)
    note: str | None = None


class AlertSnoozeRequest(BaseModel):
    reason: SnoozeReason
    # Required (≥ 15 chars) when reason == OTHER (§6.2).
    reason_text: str | None = None
    duration_minutes: int = Field(gt=0, le=120)


class ManualEscalateRequest(BaseModel):
    reason: str = Field(min_length=1)


class AlertResponse(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    admission_id: uuid.UUID | None
    patient_id: uuid.UUID | None
    unit_id: uuid.UUID | None
    kind: str
    tier: AlertTier
    status: AlertStatus
    summary: str
    source_signal: str | None
    current_escalation_step: EscalationStep
    fired_at: datetime
    acknowledged_at: datetime | None
    acknowledged_by: uuid.UUID | None
    ack_reason: str | None
    ack_note: str | None
    closed_at: datetime | None

    model_config = {"from_attributes": True}


class EscalationEventResponse(BaseModel):
    id: uuid.UUID
    alert_id: uuid.UUID
    step: EscalationStep
    target_role: str
    triggered_by: uuid.UUID | None
    is_manual: bool
    reason: str | None
    is_active: bool
    created_at: datetime
    closed_at: datetime | None

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Break-glass
# ---------------------------------------------------------------------------
class BreakGlassActivate(BaseModel):
    patient_id: uuid.UUID
    reason: BreakGlassReason
    # Required (≥ 20 chars) when reason == OTHER (§3.5).
    reason_text: str | None = None


class BreakGlassResponse(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    user_id: uuid.UUID
    patient_id: uuid.UUID
    reason: BreakGlassReason
    reason_text: str | None
    activated_at: datetime
    expires_at: datetime
    extension_count: int
    closed_at: datetime | None

    model_config = {"from_attributes": True}

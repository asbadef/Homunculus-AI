"""
FastAPI routes for the alarm, escalation and break-glass subsystem.

Role guards follow the design doc:
  * Any active clinician may acknowledge/snooze/manually-escalate an alert they can
    see (§6.2/§6.3); CRITICAL acknowledgement enforces a mandatory reason + note.
  * Break-glass may be activated by any clinician with an active session (§3.5).

PHI: alerts carry only internal ids plus a PHI-minimal summary (bed label + finding),
never patient-identifiable data.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.auth.dependencies import get_current_active_user
from homunculus.auth.models import User
from homunculus.db import get_db
from homunculus.escalation import service
from homunculus.escalation.models import Alert, BreakGlassSession
from homunculus.escalation.schemas import (
    AlertAcknowledge, AlertCreate, AlertResponse, AlertSnoozeRequest,
    BreakGlassActivate, BreakGlassResponse, ManualEscalateRequest,
)
from homunculus.escalation.service import EscalationError

router = APIRouter(prefix="/alerts", tags=["alerts"])
break_glass_router = APIRouter(prefix="/break-glass", tags=["break-glass"])


def _err(exc: EscalationError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))


async def _get_alert_or_404(db: AsyncSession, alert_id: uuid.UUID) -> Alert:
    alert = await db.get(Alert, alert_id)
    if alert is None:
        raise HTTPException(status_code=404, detail="Alert not found.")
    return alert


# ---------------------------------------------------------------------------
# Alerts
# ---------------------------------------------------------------------------
@router.post("", response_model=AlertResponse, status_code=201)
async def create_alert(
    payload: AlertCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    """
    Create an alert. Alerts are normally raised by the rules/model engine; this
    endpoint exists for integration and manual clinical flagging.
    """
    tenant_id = await _resolve_tenant_id(db, payload)
    alert = await service.create_alert(
        db, tenant_id=tenant_id, kind=payload.kind, tier=payload.tier,
        admission_id=payload.admission_id, patient_id=payload.patient_id,
        unit_id=payload.unit_id, summary=payload.summary,
        source_signal=payload.source_signal,
    )
    await db.commit()
    await db.refresh(alert)
    return alert


@router.post("/{alert_id}/acknowledge", response_model=AlertResponse)
async def acknowledge_alert(
    alert_id: uuid.UUID,
    payload: AlertAcknowledge,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    alert = await _get_alert_or_404(db, alert_id)
    try:
        await service.acknowledge_alert(
            db, alert, user_id=user.id, reason=payload.reason, note=payload.note,
        )
    except EscalationError as exc:
        raise _err(exc)
    await db.commit()
    await db.refresh(alert)
    return alert


@router.post("/{alert_id}/snooze", response_model=AlertResponse)
async def snooze_alert(
    alert_id: uuid.UUID,
    payload: AlertSnoozeRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    alert = await _get_alert_or_404(db, alert_id)
    try:
        await service.snooze_alert(
            db, alert, user_id=user.id, reason=payload.reason,
            duration_minutes=payload.duration_minutes, reason_text=payload.reason_text,
        )
    except EscalationError as exc:
        raise _err(exc)
    await db.commit()
    await db.refresh(alert)
    return alert


@router.post("/{alert_id}/escalate", response_model=AlertResponse)
async def manual_escalate(
    alert_id: uuid.UUID,
    payload: ManualEscalateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    """§6.3 step 4 — manual escalation jumps straight to the RRT tier."""
    alert = await _get_alert_or_404(db, alert_id)
    try:
        await service.manual_escalate(db, alert, user_id=user.id, reason=payload.reason)
    except EscalationError as exc:
        raise _err(exc)
    await db.commit()
    await db.refresh(alert)
    return alert


# ---------------------------------------------------------------------------
# Break-glass (§3.5, S-23)
# ---------------------------------------------------------------------------
@break_glass_router.post("", response_model=BreakGlassResponse, status_code=201)
async def activate_break_glass(
    payload: BreakGlassActivate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    tenant_id = await _tenant_of_patient(db, payload.patient_id)
    try:
        session = await service.activate_break_glass(
            db, tenant_id=tenant_id, user_id=user.id, patient_id=payload.patient_id,
            reason=payload.reason, reason_text=payload.reason_text,
        )
    except EscalationError as exc:
        raise _err(exc)
    await db.commit()
    await db.refresh(session)
    return session


@break_glass_router.post("/{session_id}/extend", response_model=BreakGlassResponse)
async def extend_break_glass(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    session = await db.get(BreakGlassSession, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Break-glass session not found.")
    try:
        await service.extend_break_glass(db, session)
    except EscalationError as exc:
        raise _err(exc)
    await db.commit()
    await db.refresh(session)
    return session


@break_glass_router.post("/{session_id}/close", response_model=BreakGlassResponse)
async def close_break_glass(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    session = await db.get(BreakGlassSession, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Break-glass session not found.")
    await service.close_break_glass(db, session)
    await db.commit()
    await db.refresh(session)
    return session


# ---------------------------------------------------------------------------
# Tenant resolution helpers
# ---------------------------------------------------------------------------
async def _tenant_of_patient(db: AsyncSession, patient_id: uuid.UUID) -> uuid.UUID:
    from homunculus.admission.models import Patient as PatientModel
    patient = await db.get(PatientModel, patient_id)
    if patient is None:
        raise HTTPException(status_code=404, detail="Patient not found.")
    return patient.tenant_id


async def _resolve_tenant_id(db: AsyncSession, payload: AlertCreate) -> uuid.UUID:
    """Derive tenant_id from the alert's patient (preferred) or admission."""
    if payload.patient_id is not None:
        return await _tenant_of_patient(db, payload.patient_id)
    if payload.admission_id is not None:
        from homunculus.admission.models import Admission as AdmissionModel
        admission = await db.get(AdmissionModel, payload.admission_id)
        if admission is None:
            raise HTTPException(status_code=404, detail="Admission not found.")
        return admission.tenant_id
    raise HTTPException(
        status_code=400, detail="An alert requires a patient_id or admission_id."
    )

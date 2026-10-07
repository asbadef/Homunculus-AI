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
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus import security_audit
from homunculus.auth.access import CLINICAL_ROLES, roles_in_tenant
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


async def _deny(db: AsyncSession, *, action: str, user: User, tenant_id: uuid.UUID | None,
                resource_type: str, resource_id: object, status_code: int, detail: str) -> HTTPException:
    """Record the refused attempt (committed now, the request is about to fail) and build the error."""
    await security_audit.record(
        db, action=action, user_id=user.id, tenant_id=tenant_id, resource_type=resource_type,
        resource_id=resource_id, outcome="denied", commit=True,
    )
    return HTTPException(status_code=status_code, detail=detail)


async def _require_clinician(db: AsyncSession, user: User, tenant_id: uuid.UUID, *, action: str,
                             resource_type: str, resource_id: object) -> None:
    """Caller must hold a clinical role IN the hospital that owns the record.
    Not a member of that hospital -> 404 (existence not leaked); member without clinical role -> 403."""
    roles = await roles_in_tenant(db, user, tenant_id)
    if not roles:
        raise await _deny(db, action=action, user=user, tenant_id=tenant_id, resource_type=resource_type,
                          resource_id=resource_id, status_code=404, detail="Not found.")
    if not roles & CLINICAL_ROLES:
        raise await _deny(db, action=action, user=user, tenant_id=tenant_id, resource_type=resource_type,
                          resource_id=resource_id, status_code=403,
                          detail="A clinical role in this hospital is required.")


async def _alert_for(db: AsyncSession, user: User, alert_id: uuid.UUID, action: str) -> Alert:
    alert = await db.get(Alert, alert_id)
    if alert is None:
        raise HTTPException(status_code=404, detail="Not found.")
    await _require_clinician(db, user, alert.tenant_id, action=action, resource_type="alert",
                             resource_id=alert.id)
    return alert


async def _session_for(db: AsyncSession, user: User, session_id: uuid.UUID, action: str) -> BreakGlassSession:
    """A break-glass session is its owner's: hospital check first (404), then ownership (403)."""
    session = await db.get(BreakGlassSession, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Not found.")
    await _require_clinician(db, user, session.tenant_id, action=action, resource_type="break_glass",
                             resource_id=session.id)
    if session.user_id != user.id:
        raise await _deny(db, action=action, user=user, tenant_id=session.tenant_id,
                          resource_type="break_glass", resource_id=session.id, status_code=403,
                          detail="Only the session owner may do this.")
    return session


async def _allow(db: AsyncSession, *, action: str, user: User, tenant_id: uuid.UUID,
                 resource_type: str, resource_id: object, detail: dict | None = None) -> None:
    await security_audit.record(db, action=action, user_id=user.id, tenant_id=tenant_id,
                                resource_type=resource_type, resource_id=resource_id,
                                outcome="allowed", detail=detail)


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
    await _require_clinician(db, user, tenant_id, action="alert.create", resource_type="alert",
                             resource_id=payload.patient_id or payload.admission_id)
    await _require_same_hospital(db, user, payload, tenant_id)
    alert = await service.create_alert(
        db, tenant_id=tenant_id, kind=payload.kind, tier=payload.tier,
        admission_id=payload.admission_id, patient_id=payload.patient_id,
        unit_id=payload.unit_id, summary=payload.summary,
        source_signal=payload.source_signal,
    )
    await _allow(db, action="alert.create", user=user, tenant_id=tenant_id, resource_type="alert",
                 resource_id=alert.id, detail={"kind": payload.kind, "tier": payload.tier.value})
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
    alert = await _alert_for(db, user, alert_id, "alert.acknowledge")
    try:
        await service.acknowledge_alert(
            db, alert, user_id=user.id, reason=payload.reason, note=payload.note,
        )
    except EscalationError as exc:
        raise _err(exc)
    await _allow(db, action="alert.acknowledge", user=user, tenant_id=alert.tenant_id, resource_type="alert",
                 resource_id=alert.id)
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
    alert = await _alert_for(db, user, alert_id, "alert.snooze")
    try:
        await service.snooze_alert(
            db, alert, user_id=user.id, reason=payload.reason,
            duration_minutes=payload.duration_minutes, reason_text=payload.reason_text,
        )
    except EscalationError as exc:
        raise _err(exc)
    await _allow(db, action="alert.snooze", user=user, tenant_id=alert.tenant_id, resource_type="alert",
                 resource_id=alert.id)
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
    alert = await _alert_for(db, user, alert_id, "alert.escalate")
    try:
        await service.manual_escalate(db, alert, user_id=user.id, reason=payload.reason)
    except EscalationError as exc:
        raise _err(exc)
    await _allow(db, action="alert.escalate", user=user, tenant_id=alert.tenant_id, resource_type="alert",
                 resource_id=alert.id)
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
    await _require_clinician(db, user, tenant_id, action="break_glass.activate",
                             resource_type="break_glass", resource_id=payload.patient_id)
    try:
        session = await service.activate_break_glass(
            db, tenant_id=tenant_id, user_id=user.id, patient_id=payload.patient_id,
            reason=payload.reason, reason_text=payload.reason_text,
        )
    except EscalationError as exc:
        raise _err(exc)
    await _allow(db, action="break_glass.activate", user=user, tenant_id=tenant_id,
                 resource_type="break_glass", resource_id=session.id,
                 detail={"patient_id": str(payload.patient_id), "reason": payload.reason.value})
    await db.commit()
    await db.refresh(session)
    return session


@break_glass_router.post("/{session_id}/extend", response_model=BreakGlassResponse)
async def extend_break_glass(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    session = await _session_for(db, user, session_id, "break_glass.extend")
    try:
        await service.extend_break_glass(db, session)
    except EscalationError as exc:
        raise _err(exc)
    await _allow(db, action="break_glass.extend", user=user, tenant_id=session.tenant_id,
                 resource_type="break_glass", resource_id=session.id)
    await db.commit()
    await db.refresh(session)
    return session


@break_glass_router.post("/{session_id}/close", response_model=BreakGlassResponse)
async def close_break_glass(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    session = await _session_for(db, user, session_id, "break_glass.close")
    await service.close_break_glass(db, session)
    await _allow(db, action="break_glass.close", user=user, tenant_id=session.tenant_id,
                 resource_type="break_glass", resource_id=session.id)
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


async def _require_same_hospital(db: AsyncSession, user: User, payload: AlertCreate,
                                 tenant_id: uuid.UUID) -> None:
    """K1/O2: admission and unit named in the body must belong to the patient's hospital
    (and the admission to the named patient); otherwise 404 + denied audit record."""
    from homunculus.admission.models import Admission as AdmissionModel
    from homunculus.tenant.models import Site, Unit
    bad = False
    if payload.admission_id is not None:
        admission = await db.get(AdmissionModel, payload.admission_id)
        bad = (admission is None or admission.tenant_id != tenant_id
               or (payload.patient_id is not None and admission.patient_id != payload.patient_id))
    if not bad and payload.unit_id is not None:
        owner = (await db.execute(
            select(Site.tenant_id).join(Unit, Unit.site_id == Site.id).where(Unit.id == payload.unit_id)
        )).scalar_one_or_none()
        bad = owner != tenant_id
    if bad:
        raise await _deny(db, action="alert.create", user=user, tenant_id=tenant_id,
                          resource_type="alert", resource_id=payload.admission_id or payload.unit_id,
                          status_code=404, detail="Not found.")


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

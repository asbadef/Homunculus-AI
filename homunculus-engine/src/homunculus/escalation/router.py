"""
FastAPI routes for the alarm, escalation and break-glass subsystem.

Permission guards (see auth/permissions.py):
  * alerts.escalate   create an alert manually; escalate one to the RRT tier
  * alerts.ack        acknowledge or snooze (CRITICAL acknowledgement enforces reason + note)
  * break_glass.use   open, extend, close a break-glass session

Tenant isolation (spec §5): every route also takes `caller_tenant_id` and acts on the caller's
tenant only. An alert or break-glass session of another tenant named in the path, or a patient,
admission or unit of another tenant named in the body, is a 404 identical to a missing one (see
tenant/scope.py). A break-glass session is extended or closed by the user who opened it alone
(403 otherwise), and a closed or expired session can be neither extended nor closed again (409).
Every check runs before anything is written.

PHI: alerts carry only internal ids plus a PHI-minimal summary (bed label + finding),
never patient-identifiable data.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.auth.dependencies import caller_tenant_id, require_permission
from homunculus.auth.models import User
from homunculus.db import get_db
from homunculus.escalation import service
from homunculus.escalation.models import Alert, BreakGlassSession
from homunculus.escalation.schemas import (
    AlertAcknowledge, AlertCreate, AlertResponse, AlertSnoozeRequest,
    BreakGlassActivate, BreakGlassResponse, ManualEscalateRequest,
)
from homunculus.escalation.service import EscalationError
from homunculus.tenant import scope

router = APIRouter(prefix="/alerts", tags=["alerts"])
break_glass_router = APIRouter(prefix="/break-glass", tags=["break-glass"])

# The caller's tenant (the token's `tenant` claim); every route below takes it.
_tenant = Depends(caller_tenant_id)

NOT_YOUR_SESSION = "Bu acil erişim oturumu size ait değil"


def _err(exc: EscalationError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))


async def _get_alert_or_404(
    db: AsyncSession, alert_id: uuid.UUID, caller_tenant: uuid.UUID,
) -> Alert:
    """The alert, if it is the caller's tenant's; another tenant's is exactly as absent."""
    return await scope.get_owned(db, Alert, alert_id, caller_tenant, "Alert not found.")


async def _get_own_session(
    db: AsyncSession, session_id: uuid.UUID, caller_tenant: uuid.UUID, user: User,
) -> BreakGlassSession:
    """The caller's OWN break-glass session: another tenant's is a 404 like a missing one; a
    colleague's in the same tenant is a 403."""
    session = await scope.get_owned(db, BreakGlassSession, session_id, caller_tenant,
                                    "Break-glass session not found.")
    if session.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=NOT_YOUR_SESSION)
    return session


# ---------------------------------------------------------------------------
# Alerts
# ---------------------------------------------------------------------------
@router.post("", response_model=AlertResponse, status_code=201)
async def create_alert(
    payload: AlertCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("alerts.escalate")),
    caller_tenant: uuid.UUID = _tenant,
):
    """
    Create an alert. Alerts are normally raised by the rules/model engine; this
    endpoint exists for integration and manual clinical flagging.

    Every patient, admission and unit it names must be the caller's tenant's.
    """
    if payload.patient_id is None and payload.admission_id is None:
        raise HTTPException(
            status_code=400, detail="An alert requires a patient_id or admission_id."
        )
    if payload.patient_id is not None:
        scope.ensure_owned(await scope.tenant_of_patient(db, payload.patient_id),
                           caller_tenant, "Patient not found.")
    if payload.admission_id is not None:
        scope.ensure_owned(await scope.tenant_of_admission(db, payload.admission_id),
                           caller_tenant, "Admission not found.")
    if payload.unit_id is not None:
        scope.ensure_owned(await scope.tenant_of_unit(db, payload.unit_id),
                           caller_tenant, "Unit not found.")
    alert = await service.create_alert(
        db, tenant_id=caller_tenant, kind=payload.kind, tier=payload.tier,
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
    user: User = Depends(require_permission("alerts.ack")),
    caller_tenant: uuid.UUID = _tenant,
):
    alert = await _get_alert_or_404(db, alert_id, caller_tenant)
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
    user: User = Depends(require_permission("alerts.ack")),
    caller_tenant: uuid.UUID = _tenant,
):
    alert = await _get_alert_or_404(db, alert_id, caller_tenant)
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
    user: User = Depends(require_permission("alerts.escalate")),
    caller_tenant: uuid.UUID = _tenant,
):
    """§6.3 step 4 — manual escalation jumps straight to the RRT tier."""
    alert = await _get_alert_or_404(db, alert_id, caller_tenant)
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
    user: User = Depends(require_permission("break_glass.use")),
    caller_tenant: uuid.UUID = _tenant,
):
    scope.ensure_owned(await scope.tenant_of_patient(db, payload.patient_id), caller_tenant,
                       "Patient not found.")
    try:
        session = await service.activate_break_glass(
            db, tenant_id=caller_tenant, user_id=user.id, patient_id=payload.patient_id,
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
    user: User = Depends(require_permission("break_glass.use")),
    caller_tenant: uuid.UUID = _tenant,
):
    session = await _get_own_session(db, session_id, caller_tenant, user)
    try:
        # A closed or expired session is refused (409): extending never revives one.
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
    user: User = Depends(require_permission("break_glass.use")),
    caller_tenant: uuid.UUID = _tenant,
):
    session = await _get_own_session(db, session_id, caller_tenant, user)
    try:
        # Closed once: an already-closed or expired session is refused (409) and left as it is;
        # the row is the audit record of when access ended.
        await service.close_break_glass(db, session)
    except EscalationError as exc:
        raise _err(exc)
    await db.commit()
    await db.refresh(session)
    return session

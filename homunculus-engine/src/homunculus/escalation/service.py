"""
Alarm, escalation and break-glass business logic.

Kept independent of HTTP so it is unit-testable and reusable from background jobs.
Time is injected (``now``) everywhere so escalation/expiry logic is deterministic
in tests without waiting on a real clock.

Settled decisions implemented here:
  S-05  Escalation chain: 3 min → CHARGE_NURSE, 5 min → physician, 10 min → RRT.
  S-06  RRT access is granted only via an active tier-3 escalation event.
  S-22  Snooze caps (HIGH 30 min / MEDIUM 120 min); CRITICAL never snoozes.
  S-23  Break-glass window = 30 min, extendable by refreshing the reason.

CLINICAL RULE: nothing here diagnoses or issues an order; it manages alarm state.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.escalation.models import (
    Alert, AlertSnooze, AlertStatus, AlertTier, BreakGlassReason,
    BreakGlassSession, EscalationEvent, EscalationStep,
    ESCALATION_STEP_ORDER, ESCALATION_STEP_TARGET_ROLE, SnoozeReason,
)


# --- Settled timing decisions ---------------------------------------------
# S-05 — cumulative wall-clock thresholds measured from an alert's fired_at.
ESCALATION_TIER1_AFTER = timedelta(minutes=3)    # → CHARGE_NURSE
ESCALATION_TIER2_AFTER = timedelta(minutes=5)    # → ON-CALL / ATTENDING physician
ESCALATION_TIER3_AFTER = timedelta(minutes=10)   # → RAPID_RESPONSE (RRT)

# S-22 — maximum snooze duration per tier (minutes). Absent tiers cannot snooze.
SNOOZE_MAX_MINUTES: dict[AlertTier, int] = {
    AlertTier.HIGH: 30,
    AlertTier.MEDIUM: 120,
}

# S-23 — break-glass auto-expiry.
BREAK_GLASS_WINDOW = timedelta(minutes=30)

# Tiers that escalate automatically when left unacknowledged (§6.3).
AUTO_ESCALATING_TIERS = {AlertTier.CRITICAL, AlertTier.HIGH}

# Free-text minimums.
SNOOZE_OTHER_MIN_CHARS = 15          # §6.2
CRITICAL_ACK_NOTE_MIN_CHARS = 20     # §6.2
BREAK_GLASS_OTHER_MIN_CHARS = 20     # §3.5

# An alert is "open" (still demanding attention) in these statuses.
OPEN_ALERT_STATUSES = {AlertStatus.FIRED, AlertStatus.ESCALATED}


def _now() -> datetime:
    return datetime.now(timezone.utc)


class EscalationError(Exception):
    """Raised for business-rule violations; mapped to HTTP 4xx by the router."""


# ---------------------------------------------------------------------------
# Pure escalation-step computation (S-05) — no DB, easily unit-tested
# ---------------------------------------------------------------------------
def compute_escalation_step(
    tier: AlertTier, fired_at: datetime, now: datetime
) -> EscalationStep:
    """
    Given an unacknowledged alert's tier and fire time, return the escalation step
    that *should* be active at ``now`` per S-05. Only CRITICAL and HIGH escalate.
    """
    if tier not in AUTO_ESCALATING_TIERS:
        return EscalationStep.NONE
    elapsed = now - fired_at
    if elapsed >= ESCALATION_TIER3_AFTER:
        return EscalationStep.TIER_3_RRT
    if elapsed >= ESCALATION_TIER2_AFTER:
        return EscalationStep.TIER_2_PHYSICIAN
    if elapsed >= ESCALATION_TIER1_AFTER:
        return EscalationStep.TIER_1_CHARGE_NURSE
    return EscalationStep.NONE


# ---------------------------------------------------------------------------
# Alert lifecycle
# ---------------------------------------------------------------------------
async def create_alert(
    db: AsyncSession, *, tenant_id: uuid.UUID, kind: str, tier: AlertTier,
    admission_id: uuid.UUID | None = None, patient_id: uuid.UUID | None = None,
    unit_id: uuid.UUID | None = None, summary: str = "",
    source_signal: str | None = None, now: datetime | None = None,
) -> Alert:
    now = now or _now()
    alert = Alert(
        tenant_id=tenant_id, admission_id=admission_id, patient_id=patient_id,
        unit_id=unit_id, kind=kind, tier=tier, summary=summary,
        source_signal=source_signal, status=AlertStatus.FIRED,
        current_escalation_step=EscalationStep.NONE, fired_at=now,
    )
    db.add(alert)
    await db.flush()
    return alert


async def acknowledge_alert(
    db: AsyncSession, alert: Alert, *, user_id: uuid.UUID,
    reason: str | None = None, note: str | None = None, now: datetime | None = None,
) -> Alert:
    """
    Acknowledge an alert — the clinician takes ownership; escalation stops.

    §6.2: a CRITICAL alert requires a mandatory reason and a free-text note of
    ≥ 20 characters.
    """
    now = now or _now()
    if alert.status in (AlertStatus.ACKNOWLEDGED, AlertStatus.CLOSED):
        raise EscalationError("Alert is already acknowledged or closed.")

    if alert.tier == AlertTier.CRITICAL:
        if not reason:
            raise EscalationError(
                "Acknowledging a CRITICAL alert requires a mandatory reason."
            )
        if not note or len(note.strip()) < CRITICAL_ACK_NOTE_MIN_CHARS:
            raise EscalationError(
                "Acknowledging a CRITICAL alert requires a free-text note of at "
                f"least {CRITICAL_ACK_NOTE_MIN_CHARS} characters."
            )

    alert.status = AlertStatus.ACKNOWLEDGED
    alert.acknowledged_at = now
    alert.acknowledged_by = user_id
    alert.ack_reason = reason
    alert.ack_note = note
    alert.current_escalation_step = EscalationStep.NONE
    await _close_active_escalations(db, alert, now)
    await db.flush()
    return alert


async def close_alert(db: AsyncSession, alert: Alert, *, now: datetime | None = None) -> Alert:
    """Mark an alert closed (its triggering condition has resolved)."""
    now = now or _now()
    alert.status = AlertStatus.CLOSED
    alert.closed_at = now
    alert.current_escalation_step = EscalationStep.NONE
    await _close_active_escalations(db, alert, now)
    await db.flush()
    return alert


# ---------------------------------------------------------------------------
# Snooze (§6.2, S-22)
# ---------------------------------------------------------------------------
async def snooze_alert(
    db: AsyncSession, alert: Alert, *, user_id: uuid.UUID, reason: SnoozeReason,
    duration_minutes: int, reason_text: str | None = None, now: datetime | None = None,
) -> AlertSnooze:
    """
    Suppress an alert's notification for a bounded window (§6.2, S-22).

    CRITICAL cannot be snoozed. HIGH ≤ 30 min, MEDIUM ≤ 120 min. reason=OTHER
    requires a free-text reason of ≥ 15 characters. Snooze suppresses the
    notification only — the underlying data/alert record stays visible.
    """
    now = now or _now()
    if alert.status in (AlertStatus.ACKNOWLEDGED, AlertStatus.CLOSED):
        raise EscalationError("Cannot snooze an acknowledged or closed alert.")

    if alert.tier == AlertTier.CRITICAL:
        raise EscalationError(
            "A CRITICAL alert cannot be snoozed; it must be acknowledged (with a "
            "mandatory reason) or escalated."
        )

    cap = SNOOZE_MAX_MINUTES.get(alert.tier)
    if cap is None:
        raise EscalationError(f"Alerts of tier {alert.tier.value} do not support snooze.")
    if duration_minutes > cap:
        raise EscalationError(
            f"Snooze duration {duration_minutes} min exceeds the maximum of {cap} "
            f"min for tier {alert.tier.value}."
        )

    if reason == SnoozeReason.OTHER:
        if not reason_text or len(reason_text.strip()) < SNOOZE_OTHER_MIN_CHARS:
            raise EscalationError(
                "Snooze reason OTHER requires a free-text reason of at least "
                f"{SNOOZE_OTHER_MIN_CHARS} characters."
            )

    # Deactivate any prior active snooze on this alert (explicit query to avoid
    # async lazy-load on the relationship).
    prior_result = await db.execute(
        select(AlertSnooze).where(
            AlertSnooze.alert_id == alert.id, AlertSnooze.is_active.is_(True)
        )
    )
    for prior in prior_result.scalars().all():
        prior.is_active = False

    snooze = AlertSnooze(
        alert_id=alert.id, snoozed_by=user_id, reason=reason, reason_text=reason_text,
        snoozed_at=now, expires_at=now + timedelta(minutes=duration_minutes), is_active=True,
    )
    db.add(snooze)
    alert.status = AlertStatus.SNOOZED
    # Snoozing pauses escalation; the clock effectively restarts on re-fire.
    alert.current_escalation_step = EscalationStep.NONE
    await _close_active_escalations(db, alert, now)
    await db.flush()
    return snooze


async def expire_due_snoozes(db: AsyncSession, *, now: datetime | None = None) -> list[Alert]:
    """
    Re-fire any alert whose active snooze has expired (§6.2 auto-expiry). The alert
    re-fires at its original tier with a fresh fire time so the escalation clock
    restarts. Returns the re-fired alerts.
    """
    now = now or _now()
    result = await db.execute(
        select(AlertSnooze).where(
            AlertSnooze.is_active.is_(True), AlertSnooze.expires_at <= now
        )
    )
    refired: list[Alert] = []
    for snooze in result.scalars().all():
        snooze.is_active = False
        alert = await db.get(Alert, snooze.alert_id)
        if alert is None or alert.status != AlertStatus.SNOOZED:
            continue
        alert.status = AlertStatus.FIRED
        alert.fired_at = now
        alert.current_escalation_step = EscalationStep.NONE
        refired.append(alert)
    await db.flush()
    return refired


# ---------------------------------------------------------------------------
# Escalation chain (§6.3, S-05, S-06)
# ---------------------------------------------------------------------------
async def _close_active_escalations(
    db: AsyncSession, alert: Alert, now: datetime
) -> None:
    result = await db.execute(
        select(EscalationEvent).where(
            EscalationEvent.alert_id == alert.id, EscalationEvent.is_active.is_(True)
        )
    )
    for ev in result.scalars().all():
        ev.is_active = False
        ev.closed_at = now


async def run_escalation_cycle(
    db: AsyncSession, *, tenant_id: uuid.UUID | None = None, now: datetime | None = None,
) -> list[EscalationEvent]:
    """
    Advance every open, unacknowledged alert to the escalation step its elapsed
    time warrants (S-05). Emits a new EscalationEvent each time an alert crosses
    into a further step; the tier-3 event is what grants RRT access (S-06).

    Idempotent: calling twice within the same step produces no duplicate events.
    Returns the newly-created escalation events.
    """
    now = now or _now()
    stmt = select(Alert).where(Alert.status.in_(OPEN_ALERT_STATUSES))
    if tenant_id is not None:
        stmt = stmt.where(Alert.tenant_id == tenant_id)
    result = await db.execute(stmt)

    new_events: list[EscalationEvent] = []
    for alert in result.scalars().all():
        target_step = compute_escalation_step(alert.tier, alert.fired_at, now)
        if target_step == EscalationStep.NONE:
            continue
        current_order = ESCALATION_STEP_ORDER[alert.current_escalation_step]
        target_order = ESCALATION_STEP_ORDER[target_step]
        if target_order <= current_order:
            continue  # already at or past this step — no duplicate event

        # Emit an event for each step we cross (so tier-1 and tier-2 are recorded
        # even if the cycle first runs after 10 minutes).
        for order in range(current_order + 1, target_order + 1):
            step = next(s for s, o in ESCALATION_STEP_ORDER.items() if o == order)
            ev = EscalationEvent(
                alert_id=alert.id, tenant_id=alert.tenant_id, step=step,
                target_role=ESCALATION_STEP_TARGET_ROLE[step], triggered_by=None,
                is_manual=False, is_active=True, created_at=now,
            )
            db.add(ev)
            new_events.append(ev)
        alert.status = AlertStatus.ESCALATED
        alert.current_escalation_step = target_step

    await db.flush()
    return new_events


async def manual_escalate(
    db: AsyncSession, alert: Alert, *, user_id: uuid.UUID, reason: str,
    now: datetime | None = None,
) -> EscalationEvent:
    """
    §6.3 step 4: any care-team member may manually escalate, jumping straight to
    the RRT tier with the escalating user's reason recorded.
    """
    now = now or _now()
    if alert.status in (AlertStatus.ACKNOWLEDGED, AlertStatus.CLOSED):
        raise EscalationError("Cannot escalate an acknowledged or closed alert.")
    if not reason or not reason.strip():
        raise EscalationError("Manual escalation requires a reason.")

    ev = EscalationEvent(
        alert_id=alert.id, tenant_id=alert.tenant_id, step=EscalationStep.TIER_3_RRT,
        target_role=ESCALATION_STEP_TARGET_ROLE[EscalationStep.TIER_3_RRT],
        triggered_by=user_id, is_manual=True, reason=reason, is_active=True, created_at=now,
    )
    db.add(ev)
    alert.status = AlertStatus.ESCALATED
    alert.current_escalation_step = EscalationStep.TIER_3_RRT
    await db.flush()
    return ev


async def rrt_has_access(
    db: AsyncSession, *, user_role: str, patient_id: uuid.UUID, now: datetime | None = None,
) -> bool:
    """
    S-06: a RAPID_RESPONSE clinician may access a patient only while that patient
    has an active tier-3 escalation event. Other roles are not gated by this.
    """
    if user_role != "RAPID_RESPONSE":
        return True
    result = await db.execute(
        select(EscalationEvent)
        .join(Alert, Alert.id == EscalationEvent.alert_id)
        .where(
            Alert.patient_id == patient_id,
            EscalationEvent.step == EscalationStep.TIER_3_RRT,
            EscalationEvent.is_active.is_(True),
        )
    )
    return result.first() is not None


# ---------------------------------------------------------------------------
# PR #2 integration — unacknowledged CRITICAL count (S-07)
# ---------------------------------------------------------------------------
async def count_unacknowledged_critical(
    db: AsyncSession, *, admission_id: uuid.UUID | None = None,
    admission_ids: list[uuid.UUID] | None = None,
) -> int:
    """
    Count CRITICAL alerts that are still open (FIRED or ESCALATED — i.e. not
    acknowledged, snoozed-CRITICAL is impossible, not closed) for one admission or
    a set of admissions.

    This is the concrete implementation behind PR #2's ``unacknowledged_critical_count``
    parameter used to block discharge (§4.7) and handover sign-off (S-07).
    """
    ids: list[uuid.UUID] = []
    if admission_id is not None:
        ids.append(admission_id)
    if admission_ids:
        ids.extend(admission_ids)
    if not ids:
        return 0
    result = await db.execute(
        select(Alert).where(
            Alert.admission_id.in_(ids),
            Alert.tier == AlertTier.CRITICAL,
            Alert.status.in_(OPEN_ALERT_STATUSES),
        )
    )
    return len(result.scalars().all())


# ---------------------------------------------------------------------------
# Break-glass (§3.5, S-23)
# ---------------------------------------------------------------------------
async def activate_break_glass(
    db: AsyncSession, *, tenant_id: uuid.UUID, user_id: uuid.UUID,
    patient_id: uuid.UUID, reason: BreakGlassReason, reason_text: str | None = None,
    now: datetime | None = None,
) -> BreakGlassSession:
    """
    Grant immediate, time-boxed emergency access to a patient (§3.5). No approval
    gate. Expires after 30 minutes (S-23). reason=OTHER requires a free-text
    reason of ≥ 20 characters.
    """
    now = now or _now()
    if reason == BreakGlassReason.OTHER:
        if not reason_text or len(reason_text.strip()) < BREAK_GLASS_OTHER_MIN_CHARS:
            raise EscalationError(
                "Break-glass reason OTHER requires a free-text reason of at least "
                f"{BREAK_GLASS_OTHER_MIN_CHARS} characters."
            )
    session = BreakGlassSession(
        tenant_id=tenant_id, user_id=user_id, patient_id=patient_id, reason=reason,
        reason_text=reason_text, activated_at=now, expires_at=now + BREAK_GLASS_WINDOW,
        extension_count=0,
    )
    db.add(session)
    await db.flush()
    return session


def is_break_glass_active(session: BreakGlassSession, *, now: datetime | None = None) -> bool:
    now = now or _now()
    return session.closed_at is None and now < session.expires_at


async def extend_break_glass(
    db: AsyncSession, session: BreakGlassSession, *, reason_text: str | None = None,
    now: datetime | None = None,
) -> BreakGlassSession:
    """S-23: extend the window by another 30 minutes by refreshing the reason. Only a session
    still open is extended: a closed or expired one stays ended (open a new one instead)."""
    now = now or _now()
    if session.closed_at is not None:
        raise EscalationError("Cannot extend a closed break-glass session.")
    if now >= session.expires_at:
        raise EscalationError("Cannot extend an expired break-glass session; open a new one.")
    session.expires_at = now + BREAK_GLASS_WINDOW
    session.extension_count += 1
    if reason_text:
        session.reason_text = reason_text
    await db.flush()
    return session


async def close_break_glass(
    db: AsyncSession, session: BreakGlassSession, *, now: datetime | None = None,
) -> BreakGlassSession:
    now = now or _now()
    session.closed_at = now
    await db.flush()
    return session

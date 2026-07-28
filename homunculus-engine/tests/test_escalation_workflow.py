"""
DB-backed alarm / escalation / break-glass tests (§3.5, §6, S-05/S-06/S-22/S-23)
and the PR #2 integration (S-07 unacknowledged-CRITICAL count).

Requires PostgreSQL (see conftest.py). Synthetic data only (PHI rule).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from homunculus.escalation import service
from homunculus.escalation.models import (
    Alert, AlertStatus, AlertTier, BreakGlassReason, EscalationStep, SnoozeReason,
)
from homunculus.escalation.service import EscalationError
from homunculus.admission import service as adm_service
from homunculus.admission.models import Patient
from homunculus.auth.models import User
from homunculus.tenant.models import Bed, BedState, Room, Site, Tenant, Unit, UnitType
from tests.conftest import requires_db

pytestmark = [pytest.mark.asyncio, requires_db]

T0 = datetime(2026, 7, 29, 8, 0, 0, tzinfo=timezone.utc)


async def _env(db):
    tenant = Tenant(name="Test Hastanesi", slug=f"t-{uuid.uuid4().hex[:8]}", country_code="TR")
    db.add(tenant)
    await db.flush()
    site = Site(tenant_id=tenant.id, name="Ana Kampüs")
    db.add(site)
    await db.flush()
    unit = Unit(site_id=site.id, name="Erişkin YBÜ", unit_type=UnitType.ADULT_ICU,
                max_beds_per_nurse=2)
    db.add(unit)
    await db.flush()
    room = Room(unit_id=unit.id, name="Oda 1")
    db.add(room)
    await db.flush()
    bed = Bed(room_id=room.id, label="1A", state=BedState.AVAILABLE)
    db.add(bed)
    user = User(email=f"dr{uuid.uuid4().hex[:6]}@example.com", full_name="Dr. Test",
                hashed_password="x")
    db.add(user)
    await db.flush()
    patient = Patient(tenant_id=tenant.id, display_name="Synthetic Patient",
                      date_of_birth="1980-01-01", sex="male")
    db.add(patient)
    await db.flush()
    return tenant, unit, bed, user, patient


async def _admission(db, tenant, unit, bed, attending):
    note = {
        "admission_datetime": T0,
        "admitting_unit_id": unit.id,
        "bed_id": bed.id,
        "attending_physician_id": attending.id,
        "admission_diagnosis_free_text": "Septik şok kriterleri değerlendirilecek",
    }
    patient = Patient(tenant_id=tenant.id, display_name="Synthetic P2",
                      date_of_birth="1975-05-05", sex="female")
    db.add(patient)
    await db.flush()
    adm = await adm_service.create_draft_admission(
        db, tenant_id=tenant.id, patient=patient, note_fields=note,
    )
    await adm_service.sign_off_admission(db, adm, signing_user_id=attending.id)
    return adm


# ---------------------------------------------------------------------------
# Alert lifecycle + escalation cycle (S-05, S-06)
# ---------------------------------------------------------------------------
async def test_escalation_cycle_advances_and_is_idempotent(db_session):
    db = db_session
    tenant, unit, bed, user, patient = await _env(db)
    alert = await service.create_alert(
        db, tenant_id=tenant.id, patient_id=patient.id, unit_id=unit.id,
        kind="septic_shock", tier=AlertTier.CRITICAL, summary="1A: septik şok kriterleri",
        now=T0,
    )
    # At 4 minutes → tier 1 only.
    events = await service.run_escalation_cycle(db, now=T0 + timedelta(minutes=4))
    assert [e.step for e in events] == [EscalationStep.TIER_1_CHARGE_NURSE]
    assert alert.current_escalation_step is EscalationStep.TIER_1_CHARGE_NURSE
    assert alert.status is AlertStatus.ESCALATED

    # Running again at the same step → no duplicate events (idempotent).
    assert await service.run_escalation_cycle(db, now=T0 + timedelta(minutes=4)) == []

    # At 12 minutes → crosses tier 2 and tier 3 (two events).
    events = await service.run_escalation_cycle(db, now=T0 + timedelta(minutes=12))
    assert [e.step for e in events] == [
        EscalationStep.TIER_2_PHYSICIAN, EscalationStep.TIER_3_RRT
    ]
    assert alert.current_escalation_step is EscalationStep.TIER_3_RRT


async def test_acknowledge_stops_escalation(db_session):
    db = db_session
    tenant, unit, bed, user, patient = await _env(db)
    alert = await service.create_alert(
        db, tenant_id=tenant.id, patient_id=patient.id, unit_id=unit.id,
        kind="news2", tier=AlertTier.HIGH, now=T0,
    )
    await service.run_escalation_cycle(db, now=T0 + timedelta(minutes=6))
    assert alert.current_escalation_step is EscalationStep.TIER_2_PHYSICIAN
    # A HIGH alert acknowledges without a mandatory note.
    await service.acknowledge_alert(db, alert, user_id=user.id, now=T0 + timedelta(minutes=6))
    assert alert.status is AlertStatus.ACKNOWLEDGED
    assert alert.current_escalation_step is EscalationStep.NONE
    # No further escalation once acknowledged.
    assert await service.run_escalation_cycle(db, now=T0 + timedelta(minutes=20)) == []


async def test_critical_ack_requires_reason_and_note(db_session):
    db = db_session
    tenant, unit, bed, user, patient = await _env(db)
    alert = await service.create_alert(
        db, tenant_id=tenant.id, patient_id=patient.id, kind="septic_shock",
        tier=AlertTier.CRITICAL, now=T0,
    )
    with pytest.raises(EscalationError, match="mandatory reason"):
        await service.acknowledge_alert(db, alert, user_id=user.id)
    with pytest.raises(EscalationError, match="at least 20"):
        await service.acknowledge_alert(db, alert, user_id=user.id,
                                        reason="CLINICAL_DECISION_MADE", note="kısa")
    await service.acknowledge_alert(
        db, alert, user_id=user.id, reason="CLINICAL_DECISION_MADE",
        note="Hasta değerlendirildi ve müdahale planlandı.",
    )
    assert alert.status is AlertStatus.ACKNOWLEDGED


async def test_manual_escalate_jumps_to_rrt(db_session):
    db = db_session
    tenant, unit, bed, user, patient = await _env(db)
    alert = await service.create_alert(
        db, tenant_id=tenant.id, patient_id=patient.id, kind="acute_change",
        tier=AlertTier.HIGH, now=T0,
    )
    ev = await service.manual_escalate(db, alert, user_id=user.id,
                                       reason="Hasta hızla kötüleşiyor, RRT çağrılıyor.")
    assert ev.step is EscalationStep.TIER_3_RRT
    assert ev.is_manual is True
    assert alert.current_escalation_step is EscalationStep.TIER_3_RRT


async def test_rrt_access_only_with_active_escalation(db_session):
    db = db_session
    tenant, unit, bed, user, patient = await _env(db)
    # No escalation yet → RRT has no access.
    assert await service.rrt_has_access(db, user_role="RAPID_RESPONSE",
                                        patient_id=patient.id) is False
    # Non-RRT roles are not gated by this rule.
    assert await service.rrt_has_access(db, user_role="ATTENDING",
                                        patient_id=patient.id) is True
    alert = await service.create_alert(
        db, tenant_id=tenant.id, patient_id=patient.id, kind="septic_shock",
        tier=AlertTier.CRITICAL, now=T0,
    )
    await service.run_escalation_cycle(db, now=T0 + timedelta(minutes=11))
    assert await service.rrt_has_access(db, user_role="RAPID_RESPONSE",
                                        patient_id=patient.id) is True
    # Once acknowledged, the escalation episode closes → RRT access ends.
    await service.acknowledge_alert(
        db, alert, user_id=user.id, reason="CLINICAL_DECISION_MADE",
        note="RRT değerlendirdi, hasta stabilize edildi.", now=T0 + timedelta(minutes=12),
    )
    assert await service.rrt_has_access(db, user_role="RAPID_RESPONSE",
                                        patient_id=patient.id) is False


# ---------------------------------------------------------------------------
# Snooze (S-22)
# ---------------------------------------------------------------------------
async def test_critical_cannot_be_snoozed(db_session):
    db = db_session
    tenant, unit, bed, user, patient = await _env(db)
    alert = await service.create_alert(
        db, tenant_id=tenant.id, patient_id=patient.id, kind="septic_shock",
        tier=AlertTier.CRITICAL, now=T0,
    )
    with pytest.raises(EscalationError, match="cannot be snoozed"):
        await service.snooze_alert(db, alert, user_id=user.id,
                                   reason=SnoozeReason.PROCEDURE_IN_PROGRESS,
                                   duration_minutes=15)


async def test_high_snooze_cap_thirty_minutes(db_session):
    db = db_session
    tenant, unit, bed, user, patient = await _env(db)
    alert = await service.create_alert(
        db, tenant_id=tenant.id, patient_id=patient.id, kind="news2",
        tier=AlertTier.HIGH, now=T0,
    )
    with pytest.raises(EscalationError, match="exceeds the maximum"):
        await service.snooze_alert(db, alert, user_id=user.id,
                                   reason=SnoozeReason.PATIENT_BASELINE,
                                   duration_minutes=31)
    snooze = await service.snooze_alert(db, alert, user_id=user.id,
                                        reason=SnoozeReason.PATIENT_BASELINE,
                                        duration_minutes=30, now=T0)
    assert alert.status is AlertStatus.SNOOZED
    assert snooze.expires_at == T0 + timedelta(minutes=30)


async def test_medium_snooze_cap_and_other_reason_text(db_session):
    db = db_session
    tenant, unit, bed, user, patient = await _env(db)
    alert = await service.create_alert(
        db, tenant_id=tenant.id, patient_id=patient.id, kind="acute_change",
        tier=AlertTier.MEDIUM, now=T0,
    )
    with pytest.raises(EscalationError, match="exceeds the maximum"):
        await service.snooze_alert(db, alert, user_id=user.id,
                                   reason=SnoozeReason.CLINICAL_DECISION_MADE,
                                   duration_minutes=121)
    # reason=OTHER requires ≥ 15-char free text.
    with pytest.raises(EscalationError, match="at least 15"):
        await service.snooze_alert(db, alert, user_id=user.id, reason=SnoozeReason.OTHER,
                                   reason_text="kısa", duration_minutes=60)
    await service.snooze_alert(db, alert, user_id=user.id, reason=SnoozeReason.OTHER,
                               reason_text="Uzun bir klinik gerekçe metni burada.",
                               duration_minutes=120, now=T0)
    assert alert.status is AlertStatus.SNOOZED


async def test_snooze_expiry_refires_alert(db_session):
    db = db_session
    tenant, unit, bed, user, patient = await _env(db)
    alert = await service.create_alert(
        db, tenant_id=tenant.id, patient_id=patient.id, kind="news2",
        tier=AlertTier.HIGH, now=T0,
    )
    await service.snooze_alert(db, alert, user_id=user.id,
                               reason=SnoozeReason.PROCEDURE_IN_PROGRESS,
                               duration_minutes=30, now=T0)
    # Before expiry → nothing re-fires.
    assert await service.expire_due_snoozes(db, now=T0 + timedelta(minutes=20)) == []
    assert alert.status is AlertStatus.SNOOZED
    # After expiry → re-fires at original tier with a fresh fire time.
    refired = await service.expire_due_snoozes(db, now=T0 + timedelta(minutes=31))
    assert alert in refired
    assert alert.status is AlertStatus.FIRED
    assert alert.fired_at == T0 + timedelta(minutes=31)


# ---------------------------------------------------------------------------
# Break-glass (S-23)
# ---------------------------------------------------------------------------
async def test_break_glass_activation_and_expiry(db_session):
    db = db_session
    tenant, unit, bed, user, patient = await _env(db)
    session = await service.activate_break_glass(
        db, tenant_id=tenant.id, user_id=user.id, patient_id=patient.id,
        reason=BreakGlassReason.CARDIAC_ARREST, now=T0,
    )
    assert session.expires_at == T0 + timedelta(minutes=30)
    assert service.is_break_glass_active(session, now=T0 + timedelta(minutes=10)) is True
    assert service.is_break_glass_active(session, now=T0 + timedelta(minutes=31)) is False


async def test_break_glass_other_requires_reason_text(db_session):
    db = db_session
    tenant, unit, bed, user, patient = await _env(db)
    with pytest.raises(EscalationError, match="at least 20"):
        await service.activate_break_glass(
            db, tenant_id=tenant.id, user_id=user.id, patient_id=patient.id,
            reason=BreakGlassReason.OTHER, reason_text="kısa", now=T0,
        )
    session = await service.activate_break_glass(
        db, tenant_id=tenant.id, user_id=user.id, patient_id=patient.id,
        reason=BreakGlassReason.OTHER,
        reason_text="Ekip yok, acil müdahale gerekiyor ve erişim şart.", now=T0,
    )
    assert session.reason is BreakGlassReason.OTHER


async def test_break_glass_extend(db_session):
    db = db_session
    tenant, unit, bed, user, patient = await _env(db)
    session = await service.activate_break_glass(
        db, tenant_id=tenant.id, user_id=user.id, patient_id=patient.id,
        reason=BreakGlassReason.RAPID_DETERIORATION, now=T0,
    )
    await service.extend_break_glass(db, session, now=T0 + timedelta(minutes=25))
    assert session.extension_count == 1
    assert session.expires_at == T0 + timedelta(minutes=55)


# ---------------------------------------------------------------------------
# PR #2 integration — unacknowledged CRITICAL count (S-07)
# ---------------------------------------------------------------------------
async def test_count_unacknowledged_critical_for_admission(db_session):
    db = db_session
    tenant, unit, bed, user, patient = await _env(db)
    adm = await _admission(db, tenant, unit, bed, user)

    assert await service.count_unacknowledged_critical(db, admission_id=adm.id) == 0

    crit = await service.create_alert(
        db, tenant_id=tenant.id, admission_id=adm.id, kind="septic_shock",
        tier=AlertTier.CRITICAL, now=T0,
    )
    # A HIGH alert must not count.
    await service.create_alert(
        db, tenant_id=tenant.id, admission_id=adm.id, kind="news2",
        tier=AlertTier.HIGH, now=T0,
    )
    assert await service.count_unacknowledged_critical(db, admission_id=adm.id) == 1

    # Acknowledging the CRITICAL clears the count.
    await service.acknowledge_alert(
        db, crit, user_id=user.id, reason="CLINICAL_DECISION_MADE",
        note="Değerlendirildi ve gerekli müdahale yapıldı.",
    )
    assert await service.count_unacknowledged_critical(db, admission_id=adm.id) == 0


async def test_handover_blocked_by_unacknowledged_critical(db_session):
    """S-07 end-to-end: an unacknowledged CRITICAL blocks handover sign-off."""
    db = db_session
    tenant, unit, bed, user, patient = await _env(db)
    adm = await _admission(db, tenant, unit, bed, user)
    incoming = User(email=f"in{uuid.uuid4().hex[:6]}@example.com",
                    full_name="Dr. Devralan", hashed_password="x")
    db.add(incoming)
    await db.flush()

    handover = await adm_service.open_handover(
        db, unit_id=unit.id, outgoing_user_id=user.id, incoming_user_id=incoming.id,
        admission_ids=[adm.id],
    )
    await service.create_alert(
        db, tenant_id=tenant.id, admission_id=adm.id, kind="septic_shock",
        tier=AlertTier.CRITICAL, now=T0,
    )
    admission_ids = [uuid.UUID(a) for a in handover.admission_ids]
    unacked = await service.count_unacknowledged_critical(db, admission_ids=admission_ids)
    assert unacked == 1
    with pytest.raises(adm_service.WorkflowError, match="unacknowledged"):
        await adm_service.sign_handover_outgoing(
            db, handover, user_id=user.id, narrative_note="Devir notu.",
            unacknowledged_critical_count=unacked,
        )

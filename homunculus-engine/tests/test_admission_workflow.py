"""
DB-backed admission workflow tests (§4, §5, S-07/S-24/S-25/S-26/S-27).

Requires PostgreSQL (see conftest.py). Uses synthetic patient data only (PHI rule).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

from homunculus.admission import service
from homunculus.admission.models import (
    Admission, AdmissionState, CareTeamRole, HandoverStatus, Patient,
)
from homunculus.admission.service import WorkflowError
from homunculus.auth.models import User
from homunculus.tenant.models import (
    Bed, BedState, Room, Site, Tenant, Unit, UnitType,
)
from tests.conftest import requires_db

pytestmark = [pytest.mark.asyncio, requires_db]


def _now():
    return datetime.now(timezone.utc)


async def _fixture_env(db, *, max_beds_per_nurse=2, n_beds=2):
    """Create a minimal tenant→site→unit→room→beds + a couple of users."""
    tenant = Tenant(name="Test Hastanesi", slug=f"t-{uuid.uuid4().hex[:8]}", country_code="TR")
    db.add(tenant)
    await db.flush()
    site = Site(tenant_id=tenant.id, name="Ana Kampüs")
    db.add(site)
    await db.flush()
    unit = Unit(site_id=site.id, name="Erişkin YBÜ", unit_type=UnitType.ADULT_ICU,
                max_beds_per_nurse=max_beds_per_nurse)
    db.add(unit)
    await db.flush()
    room = Room(unit_id=unit.id, name="Oda 1")
    db.add(room)
    await db.flush()
    beds = []
    for i in range(n_beds):
        b = Bed(room_id=room.id, label=f"{i+1}A", state=BedState.AVAILABLE)
        db.add(b)
        beds.append(b)
    attending_email = f"dr{uuid.uuid4().hex[:6]}@example.com"
    attending = User(email=attending_email, username=attending_email,
                     full_name="Dr. Test", hashed_password="x")
    nurse_email = f"hem{uuid.uuid4().hex[:6]}@example.com"
    nurse = User(email=nurse_email, username=nurse_email,
                 full_name="Hemşire Test", hashed_password="x")
    db.add_all([attending, nurse])
    await db.flush()
    return tenant, unit, beds, attending, nurse


# Patient numbers are unique per tenant (migration 0012). A fixture's are `H99…`, outside the live
# range (`H` + the year's two digits), so they never take a number the generator will give.
_NUMBERS = iter(range(1, 100_000))


async def _new_patient(db, tenant):
    p = Patient(tenant_id=tenant.id, display_name="Synthetic Patient",
                date_of_birth="1980-01-01", sex="male", patient_number=f"H99{next(_NUMBERS):05d}")
    db.add(p)
    await db.flush()
    return p


def _note(unit, bed, attending=None):
    return {
        "admission_datetime": _now(),
        "admitting_unit_id": unit.id,
        "bed_id": bed.id,
        "attending_physician_id": attending.id if attending else None,
        "admission_diagnosis_free_text": "Solunum yetmezliği kriterleri değerlendirilecek",
    }


# ---------------------------------------------------------------------------
# PHI encryption at rest
# ---------------------------------------------------------------------------
async def test_patient_phi_is_encrypted_at_rest(db_session):
    tenant, unit, beds, attending, nurse = await _fixture_env(db_session)
    p = await _new_patient(db_session, tenant)
    await db_session.commit()
    # Read the raw ciphertext straight from the column.
    from sqlalchemy import text
    row = (await db_session.execute(
        text("SELECT display_name FROM patients WHERE id = :i"), {"i": str(p.id)}
    )).first()
    assert row[0].startswith("enc::v1::")
    assert "Synthetic Patient" not in row[0]


# ---------------------------------------------------------------------------
# Single ACTIVE admission constraint (hard)
# ---------------------------------------------------------------------------
async def test_single_open_admission_per_patient(db_session):
    tenant, unit, beds, attending, nurse = await _fixture_env(db_session)
    p = await _new_patient(db_session, tenant)
    await service.create_draft_admission(
        db_session, tenant_id=tenant.id, patient=p, note_fields=_note(unit, beds[0], attending))
    with pytest.raises(WorkflowError, match="only one active admission") as refused:
        await service.create_draft_admission(
            db_session, tenant_id=tenant.id, patient=p, note_fields=_note(unit, beds[1], attending))
    assert refused.value.code == "open_admission"


async def test_a_second_draft_cannot_be_signed_while_the_first_is_active(db_session):
    """The re-check at sign-off (two DRAFTs of one patient, written past the service) answers the
    same code as the check at admission."""
    tenant, unit, beds, attending, nurse = await _fixture_env(db_session)
    p = await _new_patient(db_session, tenant)
    first = await service.create_draft_admission(
        db_session, tenant_id=tenant.id, patient=p, note_fields=_note(unit, beds[0], attending))
    second = Admission(patient_id=p.id, tenant_id=tenant.id, state=AdmissionState.DRAFT,
                       **_note(unit, beds[1], attending))
    db_session.add(second)
    await db_session.flush()
    await service.sign_off_admission(db_session, first, signing_user_id=attending.id)
    with pytest.raises(WorkflowError, match="already has an ACTIVE admission") as refused:
        await service.sign_off_admission(db_session, second, signing_user_id=attending.id)
    assert refused.value.code == "open_admission"


async def test_bed_must_be_available(db_session):
    tenant, unit, beds, attending, nurse = await _fixture_env(db_session)
    beds[0].state = BedState.MAINTENANCE
    await db_session.flush()
    p = await _new_patient(db_session, tenant)
    with pytest.raises(WorkflowError, match="not AVAILABLE") as refused:
        await service.create_draft_admission(
            db_session, tenant_id=tenant.id, patient=p, note_fields=_note(unit, beds[0], attending))
    assert refused.value.code == "bed_not_available"


# ---------------------------------------------------------------------------
# DRAFT → ACTIVE sign-off + bed side effects
# ---------------------------------------------------------------------------
async def test_sign_off_activates_and_occupies_bed(db_session):
    tenant, unit, beds, attending, nurse = await _fixture_env(db_session)
    p = await _new_patient(db_session, tenant)
    adm = await service.create_draft_admission(
        db_session, tenant_id=tenant.id, patient=p, note_fields=_note(unit, beds[0], attending))
    assert beds[0].state == BedState.OCCUPIED  # provisional
    await service.sign_off_admission(db_session, adm, signing_user_id=attending.id)
    assert adm.state == AdmissionState.ACTIVE
    assert adm.signed_by == attending.id and adm.signed_at is not None


async def test_sign_off_requires_attending(db_session):
    tenant, unit, beds, attending, nurse = await _fixture_env(db_session)
    p = await _new_patient(db_session, tenant)
    adm = await service.create_draft_admission(
        db_session, tenant_id=tenant.id, patient=p, note_fields=_note(unit, beds[0], attending=None))
    with pytest.raises(WorkflowError, match="attending_physician_id") as refused:
        await service.sign_off_admission(db_session, adm, signing_user_id=attending.id)
    assert refused.value.code == "missing_attending"      # G2-B1a: the code a screen maps


# ---------------------------------------------------------------------------
# S-26 DRAFT review timeout
# ---------------------------------------------------------------------------
async def test_stale_draft_detected_after_two_hours(db_session):
    tenant, unit, beds, attending, nurse = await _fixture_env(db_session)
    p = await _new_patient(db_session, tenant)
    adm = await service.create_draft_admission(
        db_session, tenant_id=tenant.id, patient=p, note_fields=_note(unit, beds[0], attending))
    # Fresh draft: not stale.
    assert await service.find_stale_draft_admissions(db_session) == []
    # Backdate creation beyond the 2-hour window.
    adm.created_at = _now() - timedelta(hours=3)
    await db_session.flush()
    stale = await service.find_stale_draft_admissions(db_session)
    assert adm.id in [a.id for a in stale]


# ---------------------------------------------------------------------------
# Care team (§4.2–4.3, §3.3)
# ---------------------------------------------------------------------------
async def test_oncall_requires_window(db_session):
    tenant, unit, beds, attending, nurse = await _fixture_env(db_session)
    p = await _new_patient(db_session, tenant)
    adm = await service.create_draft_admission(
        db_session, tenant_id=tenant.id, patient=p, note_fields=_note(unit, beds[0], attending))
    with pytest.raises(WorkflowError, match="window"):
        await service.add_care_team_member(
            db_session, adm, user_id=nurse.id, role=CareTeamRole.ONCALL_PHYSICIAN,
            granted_by_id=attending.id)


async def test_oncall_window_max_48h(db_session):
    tenant, unit, beds, attending, nurse = await _fixture_env(db_session)
    p = await _new_patient(db_session, tenant)
    adm = await service.create_draft_admission(
        db_session, tenant_id=tenant.id, patient=p, note_fields=_note(unit, beds[0], attending))
    start = _now()
    with pytest.raises(WorkflowError, match="48 hours"):
        await service.add_care_team_member(
            db_session, adm, user_id=nurse.id, role=CareTeamRole.ONCALL_PHYSICIAN,
            granted_by_id=attending.id, window_start=start, window_end=start + timedelta(hours=49))


# ---------------------------------------------------------------------------
# Shift scheduling (§4.4, S-25 soft warning)
# ---------------------------------------------------------------------------
async def test_shift_schedule_soft_overcapacity_warning(db_session):
    tenant, unit, beds, attending, nurse = await _fixture_env(db_session, max_beds_per_nurse=1, n_beds=2)
    start, end = _now(), _now() + timedelta(hours=8)
    assignments = [
        {"bed_id": beds[0].id, "nurse_id": nurse.id, "shift_start": start, "shift_end": end},
        {"bed_id": beds[1].id, "nurse_id": nurse.id, "shift_start": start, "shift_end": end},
    ]
    created, warnings = await service.create_shift_schedule(
        db_session, unit_id=unit.id, charge_nurse_id=nurse.id, assignments=assignments)
    assert len(created) == 2          # NOT blocked (soft limit)
    assert any("exceeding" in w for w in warnings)


# ---------------------------------------------------------------------------
# Transfer (§4.6, S-27)
# ---------------------------------------------------------------------------
async def test_transfer_creates_new_active_and_closes_source(db_session):
    tenant, unit, beds, attending, nurse = await _fixture_env(db_session, n_beds=2)
    p = await _new_patient(db_session, tenant)
    adm = await service.create_draft_admission(
        db_session, tenant_id=tenant.id, patient=p, note_fields=_note(unit, beds[0], attending))
    await service.sign_off_admission(db_session, adm, signing_user_id=attending.id)
    await service.claim_attending(db_session, adm, attending_id=attending.id)

    await service.initiate_transfer(
        db_session, adm, target_bed_id=beds[1].id, target_unit_id=unit.id)
    assert adm.state == AdmissionState.PENDING_TRANSFER

    new_adm = await service.confirm_transfer_arrival(
        db_session, adm, target_bed_id=beds[1].id, target_unit_id=unit.id)
    assert adm.state == AdmissionState.TRANSFERRED
    assert new_adm.state == AdmissionState.ACTIVE
    assert new_adm.source_admission_id == adm.id
    assert new_adm.transfer_confirm_deadline is not None  # S-27
    assert beds[1].state == BedState.OCCUPIED
    # Care team copied.
    from sqlalchemy import select
    from homunculus.admission.models import CareTeamMember
    copied = (await db_session.execute(
        select(CareTeamMember).where(CareTeamMember.admission_id == new_adm.id))).scalars().all()
    assert len(copied) == 1


async def test_a_transfer_to_a_bed_that_is_not_available_is_refused_by_its_code(db_session):
    """Both checks — when the transfer starts and when the arrival is confirmed — answer
    `bed_not_available`, the code the admission's own bed check answers."""
    tenant, unit, beds, attending, nurse = await _fixture_env(db_session, n_beds=2)
    p = await _new_patient(db_session, tenant)
    adm = await service.create_draft_admission(
        db_session, tenant_id=tenant.id, patient=p, note_fields=_note(unit, beds[0], attending))
    await service.sign_off_admission(db_session, adm, signing_user_id=attending.id)

    beds[1].state = BedState.MAINTENANCE
    await db_session.flush()
    with pytest.raises(WorkflowError, match="not AVAILABLE") as refused:
        await service.initiate_transfer(
            db_session, adm, target_bed_id=beds[1].id, target_unit_id=unit.id)
    assert refused.value.code == "bed_not_available"

    beds[1].state = BedState.AVAILABLE
    await db_session.flush()
    await service.initiate_transfer(
        db_session, adm, target_bed_id=beds[1].id, target_unit_id=unit.id)
    beds[1].state = BedState.MAINTENANCE            # taken out of service before the arrival
    await db_session.flush()
    with pytest.raises(WorkflowError, match="no longer AVAILABLE") as refused:
        await service.confirm_transfer_arrival(
            db_session, adm, target_bed_id=beds[1].id, target_unit_id=unit.id)
    assert refused.value.code == "bed_not_available"


# ---------------------------------------------------------------------------
# Discharge (§4.7)
# ---------------------------------------------------------------------------
async def test_discharge_blocked_by_unacked_critical(db_session):
    tenant, unit, beds, attending, nurse = await _fixture_env(db_session)
    p = await _new_patient(db_session, tenant)
    adm = await service.create_draft_admission(
        db_session, tenant_id=tenant.id, patient=p, note_fields=_note(unit, beds[0], attending))
    await service.sign_off_admission(db_session, adm, signing_user_id=attending.id)
    with pytest.raises(WorkflowError, match="CRITICAL") as refused:
        await service.initiate_discharge(
            db_session, adm, discharge_summary="Taburcu özeti", unacknowledged_critical_count=1)
    assert refused.value.code == "critical_alarm_open"


async def test_discharge_happy_path(db_session):
    tenant, unit, beds, attending, nurse = await _fixture_env(db_session)
    p = await _new_patient(db_session, tenant)
    adm = await service.create_draft_admission(
        db_session, tenant_id=tenant.id, patient=p, note_fields=_note(unit, beds[0], attending))
    await service.sign_off_admission(db_session, adm, signing_user_id=attending.id)
    await service.initiate_discharge(db_session, adm, discharge_summary="Taburcu özeti")
    assert adm.state == AdmissionState.PENDING_DISCHARGE
    assert beds[0].state == BedState.PENDING_DISCHARGE
    await service.confirm_discharge(db_session, adm)
    assert adm.state == AdmissionState.DISCHARGED
    assert beds[0].state == BedState.HOUSEKEEPING


# ---------------------------------------------------------------------------
# Handover (§4.5, S-07, S-24)
# ---------------------------------------------------------------------------
async def test_handover_dual_signature_flow(db_session):
    tenant, unit, beds, attending, nurse = await _fixture_env(db_session)
    h = await service.open_handover(
        db_session, unit_id=unit.id, outgoing_user_id=attending.id,
        incoming_user_id=nurse.id, admission_ids=[])
    assert h.status == HandoverStatus.OPEN
    assert service.is_bridge_active(h)
    await service.sign_handover_outgoing(
        db_session, h, user_id=attending.id, narrative_note="Devir notu")
    assert h.status == HandoverStatus.OUTGOING_SIGNED
    await service.countersign_handover_incoming(db_session, h, user_id=nurse.id)
    assert h.status == HandoverStatus.COMPLETED
    assert not service.is_bridge_active(h)


async def test_handover_blocked_by_unacked_critical(db_session):
    tenant, unit, beds, attending, nurse = await _fixture_env(db_session)
    h = await service.open_handover(
        db_session, unit_id=unit.id, outgoing_user_id=attending.id,
        incoming_user_id=nurse.id, admission_ids=[])
    with pytest.raises(WorkflowError, match="CRITICAL") as refused:
        await service.sign_handover_outgoing(
            db_session, h, user_id=attending.id, narrative_note="x",
            unacknowledged_critical_count=2)
    assert refused.value.code == "critical_alarm_open"      # the discharge's block answers it too


async def test_handover_bridge_expiry_blocks_signature(db_session):
    tenant, unit, beds, attending, nurse = await _fixture_env(db_session)
    h = await service.open_handover(
        db_session, unit_id=unit.id, outgoing_user_id=attending.id,
        incoming_user_id=nurse.id, admission_ids=[])
    # Force the bridge window into the past.
    h.bridge_expires_at = _now() - timedelta(minutes=1)
    await db_session.flush()
    with pytest.raises(WorkflowError, match="expired"):
        await service.sign_handover_outgoing(
            db_session, h, user_id=attending.id, narrative_note="x")
    assert h.status == HandoverStatus.EXPIRED


async def test_only_incoming_can_countersign(db_session):
    tenant, unit, beds, attending, nurse = await _fixture_env(db_session)
    h = await service.open_handover(
        db_session, unit_id=unit.id, outgoing_user_id=attending.id,
        incoming_user_id=nurse.id, admission_ids=[])
    await service.sign_handover_outgoing(db_session, h, user_id=attending.id, narrative_note="x")
    with pytest.raises(WorkflowError, match="incoming"):
        await service.countersign_handover_incoming(db_session, h, user_id=attending.id)

"""
DB-backed admission workflow tests (§4, §5, S-07/S-24/S-25/S-26/S-27).

Requires PostgreSQL (see conftest.py). Uses synthetic patient data only (PHI rule).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy import select

from homunculus.admission import service
from homunculus.admission.boardkey import board_key
from homunculus.admission.models import (
    Admission, AdmissionState, AdmissionType, BloodGroup, CareTeamMember, CareTeamRole,
    DischargeDisposition, Handover, HandoverStatus, Patient,
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
# Transfer (§4.6) — one step (Group 2 · B1b, spec D1, D2, T3–T7, §5.3)
# ---------------------------------------------------------------------------
#: A synthetic protocol number (G2-B1d: twelve digits; each test's tenant is its own, so no clash).
PROTOCOL = "202600000001"
#: The columns each row keeps its own (spec T6, X8); every other column of the stay is carried.
#: The discharge's five stay with the row it was decided on (Task 2 review).
DISCHARGE = ("discharge_disposition", "discharge_institution", "discharge_reported_by",
             "discharge_at", "discharge_note")
OWN = frozenset({
    "id", "state", "bed_id", "admitting_unit_id", "admission_datetime", "request_id",
    "request_digest", "engine_writes", "draft_reminder_sent", "source_admission_id",
    "transfer_confirm_deadline", "transfer_reason", "transfer_note", "protocol_no",
    "created_at", "updated_at", *DISCHARGE,
})


async def _active(db, *, n_beds=3, protocol_no=None):
    """An ACTIVE admission on the first bed of a fresh tenant, with B1a's form fields and the
    person's identity digest set, as the admission route writes them."""
    tenant, unit, beds, attending, nurse = await _fixture_env(db, n_beds=n_beds)
    p = await _new_patient(db, tenant)
    note = {**_note(unit, beds[0], attending), "admission_type": AdmissionType.ICU,
            "blood_group": BloodGroup.A_POS, "allergies_text": "Sentetik alerji",
            "comorbidity_codes": ["copd"], "comorbidities_text": "Sentetik eşlik eden hastalık",
            "weight_kg": 50.0}
    adm = await service.create_draft_admission(
        db, tenant_id=tenant.id, patient=p, note_fields=note, identity_digest="d" * 64,
        protocol_no=protocol_no)
    await service.sign_off_admission(db, adm, signing_user_id=attending.id)
    return unit, beds, attending, nurse, p, adm


async def _move(db, adm, bed, unit, *, reason="CLINICAL_NEED", note=None, reserved_ok=False):
    """The arriving row and how many care-team rows moved. The ids of the handovers that followed
    her, the service's third answer (X17), are read by its own test below."""
    arriving, team, _handovers = await service.transfer_patient(
        db, adm, target_bed=bed, target_unit_id=unit.id, reason=reason, note=note,
        reserved_ok=reserved_ok)
    return arriving, team


async def _team(db, admission_id, *, active=None) -> list:
    stmt = select(CareTeamMember).where(CareTeamMember.admission_id == admission_id)
    if active is not None:
        stmt = stmt.where(CareTeamMember.is_active.is_(active))
    return list((await db.execute(stmt)).scalars().all())


def _shape(rows) -> list:
    """Who, in which role, for which window, granted by whom: what a copied row keeps."""
    return sorted(((r.user_id, r.role, r.window_start, r.window_end, r.granted_by_id)
                   for r in rows), key=repr)


async def test_a_transfer_moves_the_patient_in_one_step(db_session):
    """D1, T3: the source is TRANSFERRED and its bed in cleaning; the arriving row is ACTIVE on the
    target, in the unit the route read from the bed, now; the target is OCCUPIED. S-27's deadline
    is not written (T6)."""
    unit, beds, attending, nurse, p, adm = await _active(db_session)
    arriving, _ = await _move(db_session, adm, beds[1], unit)
    assert (adm.state, beds[0].state) == (AdmissionState.TRANSFERRED, BedState.HOUSEKEEPING)
    assert (arriving.state, arriving.bed_id, arriving.admitting_unit_id) == (
        AdmissionState.ACTIVE, beds[1].id, unit.id)
    assert beds[1].state == BedState.OCCUPIED
    assert (arriving.source_admission_id, arriving.transfer_confirm_deadline) == (adm.id, None)
    assert arriving.admission_datetime >= adm.admission_datetime
    assert service._OWN_TO_EACH_ROW == OWN


async def test_the_arriving_row_is_the_stay_whole_with_the_moves_own_reason_and_note(db_session):
    """T6, F4, D8, X8: every column of the stay is carried — the identity digest and B1a's form
    fields among them. The reason and the note are this move's: a later move writes its own and
    copies neither. The discharge's fields stay with the row they were decided on: a row that
    carries them (a discharge started, then cancelled) does not hand them to the arriving one."""
    unit, beds, attending, nurse, p, adm = await _active(db_session)
    adm.discharge_disposition, adm.discharge_note = DischargeDisposition.HOME, "Sentetik not"
    await db_session.flush()
    arriving, _ = await _move(db_session, adm, beds[1], unit, reason="OTHER",
                              note="Sentetik nakil notu")
    assert [getattr(arriving, c) for c in DISCHARGE] == [None] * len(DISCHARGE)
    assert (adm.discharge_disposition, adm.discharge_note) == (DischargeDisposition.HOME,
                                                               "Sentetik not")
    for column in Admission.__table__.columns:
        if column.key not in OWN:
            assert getattr(arriving, column.key) == getattr(adm, column.key), column.key
    assert arriving.identity_digest == "d" * 64
    assert (arriving.admission_type, arriving.blood_group, arriving.comorbidity_codes) == (
        AdmissionType.ICU, BloodGroup.A_POS, ["copd"])
    assert (arriving.transfer_reason, arriving.transfer_note) == ("OTHER", "Sentetik nakil notu")
    assert (adm.transfer_reason, adm.transfer_note) == (None, None)
    second, _ = await _move(db_session, arriving, beds[2], unit, reason="ISOLATION")
    assert (second.transfer_reason, second.transfer_note) == ("ISOLATION", None)
    assert second.source_admission_id == arriving.id


async def test_a_transfer_keeps_the_protocol_it_moves_to_the_arriving_admission(db_session):
    """O8 (spec D2): a transfer is inside one visit, so it keeps the visit's protocol. The number
    moves to the arriving row — `uq_admissions_tenant_protocol` allows one row per number — and the
    card's key (`board_key`) does not change: the label and the devices keep their number."""
    unit, beds, attending, nurse, p, adm = await _active(db_session, protocol_no=PROTOCOL)
    arriving, _ = await _move(db_session, adm, beds[1], unit)
    assert (arriving.protocol_no, adm.protocol_no) == (PROTOCOL, None)
    assert board_key(arriving.protocol_no, p.patient_number) == PROTOCOL
    holders = (await db_session.execute(
        select(Admission.state, Admission.protocol_no)
        .where(Admission.tenant_id == adm.tenant_id, Admission.protocol_no.is_not(None)))).all()
    assert [tuple(row) for row in holders] == [(AdmissionState.ACTIVE, PROTOCOL)]


async def test_a_transfer_of_a_legacy_admission_keeps_its_h_number_key(db_session):
    """O8: an admission from before G2-B1d has no protocol. Both rows stay without one, and the
    card's key is the H-number, as before."""
    unit, beds, attending, nurse, p, adm = await _active(db_session)
    arriving, _ = await _move(db_session, adm, beds[1], unit)
    assert (arriving.protocol_no, adm.protocol_no) == (None, None)
    assert board_key(arriving.protocol_no, p.patient_number) == p.patient_number


@pytest.mark.parametrize("state", [BedState.OCCUPIED, BedState.HOUSEKEEPING, BedState.MAINTENANCE,
                                   BedState.BLOCKED, BedState.RESERVED, BedState.PENDING_DISCHARGE,
                                   BedState.PENDING_TRANSFER_OUT])
async def test_a_target_that_is_not_free_is_refused_by_its_code(db_session, state):
    """T5: only an AVAILABLE bed, or a RESERVED one the route confirmed, takes the patient.
    Nothing moves."""
    unit, beds, attending, nurse, p, adm = await _active(db_session)
    beds[1].state = state
    await db_session.flush()
    with pytest.raises(WorkflowError) as refused:
        await _move(db_session, adm, beds[1], unit)
    assert refused.value.code == "bed_not_available"
    assert (adm.state, beds[0].state) == (AdmissionState.ACTIVE, BedState.OCCUPIED)


async def test_a_reserved_target_takes_the_patient_when_the_route_confirmed_it(db_session):
    """B3a R5: the confirmation is the route's. The transition clears the reservation's note
    (F10)."""
    unit, beds, attending, nurse, p, adm = await _active(db_session)
    beds[1].state, beds[1].state_note = BedState.RESERVED, "Sentetik planlı kabul"
    await db_session.flush()
    await _move(db_session, adm, beds[1], unit, reserved_ok=True)
    assert (beds[1].state, beds[1].state_note) == (BedState.OCCUPIED, None)


@pytest.mark.parametrize("started", [False, True])
async def test_only_an_active_admission_moves(db_session, started):
    """T4: a DRAFT is signed first; a patient whose discharge has started is not moved."""
    tenant, unit, beds, attending, nurse = await _fixture_env(db_session, n_beds=2)
    p = await _new_patient(db_session, tenant)
    adm = await service.create_draft_admission(
        db_session, tenant_id=tenant.id, patient=p, note_fields=_note(unit, beds[0], attending))
    if started:
        await service.sign_off_admission(db_session, adm, signing_user_id=attending.id)
        await service.initiate_discharge(db_session, adm, disposition=DischargeDisposition.HOME)
    with pytest.raises(WorkflowError) as refused:
        await _move(db_session, adm, beds[1], unit)
    assert refused.value.code == "invalid_transition"
    assert beds[1].state == BedState.AVAILABLE


async def test_a_source_bed_that_is_not_occupied_is_refused_before_anything_moves(db_session):
    """Task 2 review: the source bed is checked up front, so the house refusal (`WorkflowError`,
    not the bed machine's `ValueError`) comes before any in-memory transition: the admission, the
    protocol, the care team and the target are as they were."""
    unit, beds, attending, nurse, p, adm = await _active(db_session, protocol_no=PROTOCOL)
    beds[0].state = BedState.MAINTENANCE                # the patient's own bed, out of step
    db_session.add(CareTeamMember(admission_id=adm.id, user_id=nurse.id,
                                  role=CareTeamRole.ASSOCIATE_PHYSICIAN,
                                  granted_by_id=attending.id))
    await db_session.flush()
    with pytest.raises(WorkflowError) as refused:
        await _move(db_session, adm, beds[1], unit)
    assert refused.value.code == "invalid_transition"
    assert (adm.state, adm.protocol_no, beds[0].state, beds[1].state) == (
        AdmissionState.ACTIVE, PROTOCOL, BedState.MAINTENANCE, BedState.AVAILABLE)
    assert len(await _team(db_session, adm.id, active=True)) >= 1


async def test_the_care_team_is_closed_on_the_source_and_copied_onto_the_arriving_row(db_session):
    """T7: the source keeps no active row — its key is the H-number now (O8), and an open row on
    it would point the own-patient scope away from the card. The arriving row holds the same
    members, roles, windows and grantors, active; the count is answered. (B1c's sign-off route
    writes the attending's row, its service does not: one ATTENDING row is added only when none
    is there. B1c's indexes allow one active ATTENDING and one active row per member per
    admission; the copy keeps both true on the arriving row.)"""
    unit, beds, attending, nurse, p, adm = await _active(db_session)
    start = _now()
    if not any(r.role == CareTeamRole.ATTENDING
               for r in await _team(db_session, adm.id, active=True)):
        db_session.add(CareTeamMember(admission_id=adm.id, user_id=attending.id,
                                      role=CareTeamRole.ATTENDING, granted_by_id=attending.id))
    db_session.add(CareTeamMember(admission_id=adm.id, user_id=nurse.id,
                                  role=CareTeamRole.ONCALL_PHYSICIAN, granted_by_id=attending.id,
                                  window_start=start, window_end=start + timedelta(hours=12)))
    await db_session.flush()
    expected = _shape(await _team(db_session, adm.id, active=True))
    arriving, moved = await _move(db_session, adm, beds[1], unit)
    assert await _team(db_session, adm.id, active=True) == []
    assert all(r.closed_at is not None for r in await _team(db_session, adm.id))
    copied = await _team(db_session, arriving.id, active=True)
    assert _shape(copied) == expected
    assert moved == len(expected) >= 2


async def test_a_handover_in_hand_follows_the_patient_and_a_closed_one_stays(db_session):
    """Owner 2026-11-10 (X17): a handover still in hand — OPEN inside its bridge, or
    OUTGOING_SIGNED — names the arriving row after the move, in the source's place and nothing
    else changed. A COMPLETED one, an EXPIRED one and an OPEN one past its bridge (which reads
    EXPIRED, S-24) keep the source, as they were written. A handover in hand that names only
    another patient is left alone. The ids of the two that followed are answered, by handover id.
    What is read back is the database's, not the session's objects: a JSON list edited in place
    is not tracked, so the objects would show it and the row would never change."""
    unit, beds, attending, nurse, p, adm = await _active(db_session)
    beside = str(uuid.uuid4())                          # another admission the handovers name
    handovers = {name: await service.open_handover(
        db_session, unit_id=unit.id, outgoing_user_id=attending.id, incoming_user_id=nurse.id,
        admission_ids=[beside, adm.id]) for name in ("open", "signed", "completed", "expired",
                                                     "lapsed")}
    handovers["elsewhere"] = await service.open_handover(   # in hand, another patient's only
        db_session, unit_id=unit.id, outgoing_user_id=attending.id, incoming_user_id=nurse.id,
        admission_ids=[beside])
    handovers["signed"].status = HandoverStatus.OUTGOING_SIGNED
    handovers["completed"].status = HandoverStatus.COMPLETED
    handovers["expired"].status = HandoverStatus.EXPIRED
    handovers["lapsed"].bridge_expires_at = _now() - timedelta(minutes=1)
    await db_session.flush()
    source_id = str(adm.id)
    ids = {name: h.id for name, h in handovers.items()}
    arriving, _team_moved, followed = await service.transfer_patient(
        db_session, adm, target_bed=beds[1], target_unit_id=unit.id, reason="CLINICAL_NEED",
        note=None)
    stored = dict((await db_session.execute(
        select(Handover.id, Handover.admission_ids))).all())
    named = {name: list(stored[i]) for name, i in ids.items()}
    assert followed == sorted([ids["open"], ids["signed"]])
    assert named["open"] == named["signed"] == [beside, str(arriving.id)]
    assert named["completed"] == named["expired"] == named["lapsed"] == [beside, source_id]
    assert named["elsewhere"] == [beside]


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
            db_session, adm, disposition=DischargeDisposition.HOME, note="Taburcu özeti",
            unacknowledged_critical_count=1)
    assert refused.value.code == "critical_alarm_open"


async def test_discharge_happy_path(db_session):
    tenant, unit, beds, attending, nurse = await _fixture_env(db_session)
    p = await _new_patient(db_session, tenant)
    adm = await service.create_draft_admission(
        db_session, tenant_id=tenant.id, patient=p, note_fields=_note(unit, beds[0], attending))
    await service.sign_off_admission(db_session, adm, signing_user_id=attending.id)
    await service.initiate_discharge(
        db_session, adm, disposition=DischargeDisposition.OTHER_INSTITUTION,
        institution="Sentetik Klinika", note="Taburcu özeti")
    assert adm.state == AdmissionState.PENDING_DISCHARGE
    assert beds[0].state == BedState.PENDING_DISCHARGE
    assert (adm.discharge_disposition, adm.discharge_institution, adm.discharge_note) == \
        (DischargeDisposition.OTHER_INSTITUTION, "Sentetik Klinika", "Taburcu özeti")
    assert adm.discharge_at is not None
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

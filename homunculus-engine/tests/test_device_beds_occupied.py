# homunculus-engine/tests/test_device_beds_occupied.py
"""A bed with an admitted patient (spec D4, §4.4 step 8, O5) and tenant isolation of the device
routes. Synthetic patients («Ahmet Yılmaz», H2600042); their names must appear in no answer and no
audit row."""
from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest
from sqlalchemy import func, select

from homunculus.admission.models import Admission, AdmissionState, Patient
from homunculus.api.patient_identity import IdentityRecord, InMemoryIdentityStore
from homunculus.auth.groups import ensure_default_groups
from homunculus.auth.models import Group, GroupPermission
from homunculus.devicebeds.models import DeviceBed
from homunculus.tenant.bedmap import BedMap, BedRef
from tests.conftest import requires_db
from tests.esleme_v2 import tenant_only
from tests.esleme_world import URL, esleme_client, seed
from tests.kabul_world import SLUG
from tests.signed_in import add_user, bearer

pytestmark = [requires_db]
NOW = datetime(2026, 10, 30, 9, 0, tzinfo=timezone.utc)


async def _admit(db, ward, bed_key, number="H2600042", state=AdmissionState.ACTIVE, protocol_no=None):
    """An open admission on the bed. `protocol_no` (G2-B1d): the admission's protocol number, which is its
    board key; None is a legacy admission, keyed by `number` (the H-number)."""
    patient = Patient(tenant_id=ward.tenant.id, display_name="Ahmet Yılmaz", date_of_birth="1970-01-01",
                      sex="male", patient_number=number)
    db.add(patient)
    await db.flush()
    unit = ward.units["neo" if bed_key == "N1" else "rea"]
    db.add(Admission(tenant_id=ward.tenant.id, patient_id=patient.id, admitting_unit_id=unit.id,
                     bed_id=ward.beds[bed_key].id, admission_datetime=NOW, state=state,
                     protocol_no=protocol_no, admission_diagnosis_free_text="Sentetik tanı"))
    await db.commit()


def _bind(client, ward, who, source, bed_key, device_row=None, bed_row=None, confirm=False):
    return client.post(f"{URL}/bind", headers=ward.auth[who], json={
        "source": source, "bed_id": str(ward.beds[bed_key].id), "confirm_occupied": confirm,
        "expected": {"device_row_id": device_row, "bed_row_id": bed_row}})


def _on_board(identities, ward, bed_key, number, given="Ahmet", family="Yılmaz"):
    """A patient the BOARD puts on the bed (an identity record naming the bed), with no admission row."""
    identities.apply(SLUG, IdentityRecord(patient_id=number, given=given, family=family, source="test",
                                          updated_at=NOW, bed_id=str(ward.beds[bed_key].id)))


async def test_binding_to_an_admitted_patients_bed_asks_first_then_audits_the_patient(db_session):
    async with esleme_client(db_session) as (client, app, ward):
        await _admit(db_session, ward, "2")
        refused = await _bind(client, ward, "admin", "192.0.2.13", "2")
        done = await _bind(client, ward, "admin", "192.0.2.13", "2", confirm=True)
        [rec] = app.state.audit.records(event_type="device_bed.bind")
    assert refused.status_code == 409
    detail = refused.json()["detail"]
    assert detail["code"] == "bed_occupied"
    assert detail["occupied"] == [{"bed_id": str(ward.beds["2"].id), "patient_id": "H2600042"}]
    assert done.status_code == 200
    assert (rec.patient_id, rec.payload["occupied_confirmed"]) == ("H2600042", True)
    assert rec.payload["occupied"] == [{"bed_id": str(ward.beds["2"].id), "patient_id": "H2600042"}]
    everything = json.dumps([refused.json(), done.json(), rec.payload], ensure_ascii=False)
    assert "Ahmet" not in everything and "Yılmaz" not in everything          # given name and family name


async def test_a_protocol_admission_on_the_bed_is_named_by_its_protocol_not_its_h_number(db_session):
    """G2-B1d (O74): an admission made since 0015 is keyed on the board by its protocol number, so the bed's
    occupant - in the refusal the dialog finds the card by, and in the audit row's `patient_id` - is the
    protocol, not `Patient.patient_number`. The board shows nothing on the bed here (no identity record), so
    the answer comes from the open admission itself (`_open_admission_number`)."""
    async with esleme_client(db_session) as (client, app, ward):
        await _admit(db_session, ward, "2", number="H2600046", protocol_no="202600000001")
        refused = await _bind(client, ward, "admin", "192.0.2.13", "2")
        done = await _bind(client, ward, "admin", "192.0.2.13", "2", confirm=True)
        [rec] = app.state.audit.records(event_type="device_bed.bind")
    assert refused.status_code == 409
    detail = refused.json()["detail"]
    assert detail["code"] == "bed_occupied"
    assert detail["occupied"] == [{"bed_id": str(ward.beds["2"].id), "patient_id": "202600000001"}]
    assert done.status_code == 200
    assert (rec.patient_id, rec.payload["occupied_confirmed"]) == ("202600000001", True)
    assert rec.payload["occupied"] == [{"bed_id": str(ward.beds["2"].id), "patient_id": "202600000001"}]
    everything = json.dumps([refused.json(), done.json(), rec.payload], ensure_ascii=False)
    assert "H2600046" not in everything                                       # the H-number is not the key
    assert "Ahmet" not in everything and "Yılmaz" not in everything


async def test_a_move_names_a_protocol_admission_by_protocol_and_a_legacy_one_by_h_number(db_session):
    """One bed with an admission made since 0015 (target), one with a legacy admission (the bed the monitor
    leaves): each is named by its own board key."""
    async with esleme_client(db_session) as (client, _, ward):
        ids = await seed(db_session, ward, ("192.0.2.11", "1", "BED05"))
        await _admit(db_session, ward, "1", number="H2600044")                                    # legacy
        await _admit(db_session, ward, "2", number="H2600045", protocol_no="202600000002")        # protocol
        refused = await _bind(client, ward, "admin", "192.0.2.11", "2", ids["192.0.2.11"])
    assert [o["patient_id"] for o in refused.json()["detail"]["occupied"]] == ["202600000002", "H2600044"]


async def test_a_patient_the_board_puts_on_the_bed_counts_too_when_unbinding(db_session):
    identities = InMemoryIdentityStore()
    async with esleme_client(db_session, identities=identities) as (client, app, ward):
        ids = await seed(db_session, ward, ("192.0.2.11", "1", "BED05"))
        identities.apply(SLUG, IdentityRecord(patient_id="H2600043", given="Ahmet", family="Yılmaz",
                                              source="test", updated_at=NOW, bed_id=str(ward.beds["1"].id)))
        body = {"source": "192.0.2.11", "expected": {"device_row_id": ids["192.0.2.11"]}}
        refused = await client.post(f"{URL}/unbind", headers=ward.auth["admin"], json=body)
        done = await client.post(f"{URL}/unbind", headers=ward.auth["admin"], json={**body, "confirm_occupied": True})
        [rec] = app.state.audit.records(event_type="device_bed.unbind")
    assert refused.json()["detail"]["occupied"] == [{"bed_id": str(ward.beds["1"].id), "patient_id": "H2600043"}]
    assert done.status_code == 200 and rec.patient_id == "H2600043"
    everything = json.dumps([refused.json(), done.json(), rec.payload], ensure_ascii=False)
    assert "Ahmet" not in everything and "Yılmaz" not in everything          # the board record holds the name


async def test_a_move_lists_the_target_bed_first_then_the_bed_it_leaves(db_session):
    async with esleme_client(db_session) as (client, _, ward):
        ids = await seed(db_session, ward, ("192.0.2.11", "1", "BED05"))
        await _admit(db_session, ward, "1", "H2600044")
        await _admit(db_session, ward, "2", "H2600045")
        refused = await _bind(client, ward, "admin", "192.0.2.11", "2", ids["192.0.2.11"])
    assert [o["patient_id"] for o in refused.json()["detail"]["occupied"]] == ["H2600045", "H2600044"]


async def test_a_holder_without_board_view_learns_that_a_patient_is_there_not_who(db_session):
    async with esleme_client(db_session) as (client, app, ward):
        group = Group(tenant_id=ward.tenant.id, slug="esleme_only", name="Yalnız eşleme",
                      mfa_required=False, is_system=False)
        group.permissions = [GroupPermission(permission="devices.map_beds")]
        db_session.add(group)
        await db_session.flush()
        user = await add_user(db_session, username="map@kabul.example.com", tenant_id=ward.tenant.id, group=group)
        await db_session.commit()
        ward.auth["map"] = await bearer(db_session, user)
        await _admit(db_session, ward, "2")
        refused = await _bind(client, ward, "map", "192.0.2.13", "2")
        done = await _bind(client, ward, "map", "192.0.2.13", "2", confirm=True)
        [rec] = app.state.audit.records(event_type="device_bed.bind")
    assert refused.json()["detail"]["occupied"] == [{"bed_id": str(ward.beds["2"].id)}]
    assert "H2600042" not in json.dumps([refused.json(), done.json()])
    # the audit is written for the system, not for the caller: it keeps the id the caller was never shown
    assert (rec.patient_id, rec.payload["occupied"]) == (
        "H2600042", [{"bed_id": str(ward.beds["2"].id), "patient_id": "H2600042"}])


async def test_another_tenants_bed_is_the_same_404_as_a_missing_one(db_session):
    async with esleme_client(db_session) as (client, _, ward):
        other, _beds = await _other_with_bed(db_session)
        foreign = await client.post(f"{URL}/bind", headers=ward.auth["admin"], json={
            "source": "192.0.2.13", "bed_id": str(_beds), "expected": {"device_row_id": None, "bed_row_id": None}})
        missing = await client.post(f"{URL}/bind", headers=ward.auth["admin"], json={
            "source": "192.0.2.13", "bed_id": "00000000-0000-4000-8000-000000000000",
            "expected": {"device_row_id": None, "bed_row_id": None}})
    assert foreign.status_code == missing.status_code == 404
    assert foreign.json() == missing.json()


async def test_another_tenants_admitted_bed_reveals_nothing_even_with_the_confirmation(db_session):
    """A foreign bed that holds an admitted patient, asked with `confirm_occupied: true`: still the missing
    bed's 404, byte for byte - no `occupied`, no patient id, no hint that the bed exists."""
    async with esleme_client(db_session) as (client, app, ward):
        _other, foreign_bed = await _other_with_bed(db_session, admitted="H2600050")
        body = {"source": "192.0.2.13", "confirm_occupied": True, "expected": {"device_row_id": None, "bed_row_id": None}}
        foreign = await client.post(f"{URL}/bind", headers=ward.auth["admin"], json={**body, "bed_id": str(foreign_bed)})
        missing = await client.post(f"{URL}/bind", headers=ward.auth["admin"],
                                    json={**body, "bed_id": "00000000-0000-4000-8000-000000000000"})
        rows = (await db_session.execute(select(func.count()).select_from(DeviceBed))).scalar_one()
        written = [app.state.audit.records(event_type=kind) for kind in ("device_bed.bind", "device_bed.unbind")]
    assert foreign.status_code == missing.status_code == 404
    assert foreign.json() == missing.json()
    assert "H2600050" not in foreign.text and "occupied" not in foreign.text
    assert rows == 0 and written == [[], []]


async def test_another_tenants_administrator_gets_monitor_lane_off_on_all_three_routes(db_session):
    """The list, a bind and an unbind. The bind names the ward's own ADMITTED bed (and confirms): the lane
    guard answers first, so neither the bed nor its patient is touched, named or hinted at."""
    async with esleme_client(db_session) as (client, app, ward):
        await _admit(db_session, ward, "2", "H2600051")
        other = await tenant_only(db_session, "baska-hastane")
        groups = await ensure_default_groups(db_session, other.id)
        admin = await add_user(db_session, username="admin@baska.example.com", tenant_id=other.id,
                               group=groups["hospital_admin"])
        await db_session.commit()
        headers = await bearer(db_session, admin)
        answers = [
            await client.get(URL, headers=headers),
            await client.post(f"{URL}/bind", headers=headers, json={
                "source": "192.0.2.13", "bed_id": str(ward.beds["2"].id), "confirm_occupied": True,
                "expected": {"device_row_id": None, "bed_row_id": None}}),
            await client.post(f"{URL}/unbind", headers=headers, json={
                "source": "192.0.2.11", "confirm_occupied": True, "expected": {"device_row_id": None}})]
        rows = (await db_session.execute(select(func.count()).select_from(DeviceBed))).scalar_one()
        written = [app.state.audit.records(event_type=kind) for kind in ("device_bed.bind", "device_bed.unbind")]
    for answer in answers:
        assert answer.status_code == 409 and answer.json()["detail"]["code"] == "monitor_lane_off"
        assert "occupied" not in answer.text and "H2600051" not in answer.text
    assert rows == 0 and written == [[], []]


async def test_a_charge_nurse_out_of_reach_of_an_admitted_bed_learns_nothing_of_the_patient(db_session):
    """Step 7 (unit scope) runs before step 8 (occupancy): a bed in Neonatal, which she is not granted, is
    `out_of_scope` - with no `occupied` key and no patient id - whether it is the target or the bed left."""
    async with esleme_client(db_session) as (client, app, ward):
        ids = await seed(db_session, ward, ("192.0.2.11", "N1", "BED05"))
        await _admit(db_session, ward, "N1", "H2600052")
        target = await _bind(client, ward, "charge", "192.0.2.13", "N1", bed_row=ids["192.0.2.11"])   # a replace
        leaving = await client.post(f"{URL}/unbind", headers=ward.auth["charge"], json={
            "source": "192.0.2.11", "confirm_occupied": True, "expected": {"device_row_id": ids["192.0.2.11"]}})
        rows = (await db_session.execute(select(func.count()).select_from(DeviceBed))).scalar_one()
        written = [app.state.audit.records(event_type=kind) for kind in ("device_bed.bind", "device_bed.unbind")]
    for answer in (target, leaving):
        assert (answer.status_code, answer.json()["detail"]["code"]) == (403, "out_of_scope")
        assert "occupied" not in answer.json()["detail"] and "H2600052" not in answer.text
    assert rows == 1 and written == [[], []]                         # the seeded row only; nothing written


# ---- beyond the task file's six: what else the rule has to hold ------------------------------------------

async def test_a_refusal_writes_nothing_and_only_true_confirms(db_session):
    """`confirm_occupied` omitted and `false` are one refusal, and neither wrote a row or an audit."""
    async with esleme_client(db_session) as (client, app, ward):
        await _admit(db_session, ward, "2")
        omitted = await client.post(f"{URL}/bind", headers=ward.auth["admin"], json={
            "source": "192.0.2.13", "bed_id": str(ward.beds["2"].id),
            "expected": {"device_row_id": None, "bed_row_id": None}})
        explicit = await _bind(client, ward, "admin", "192.0.2.13", "2", confirm=False)
        rows = (await db_session.execute(select(func.count()).select_from(DeviceBed))).scalar_one()
        written = [app.state.audit.records(event_type=kind) for kind in ("device_bed.bind", "device_bed.unbind")]
    assert omitted.status_code == explicit.status_code == 409
    assert omitted.json() == explicit.json()
    assert rows == 0 and written == [[], []]


@pytest.mark.parametrize("state, asks", [
    (AdmissionState.DRAFT, True), (AdmissionState.ACTIVE, True), (AdmissionState.PENDING_DISCHARGE, True),
    (AdmissionState.PENDING_TRANSFER, True), (AdmissionState.DISCHARGED, False), (AdmissionState.TRANSFERRED, False)])
async def test_only_an_open_admission_makes_a_bed_occupied(db_session, state, asks):
    """`_holds_open_admission`'s condition: the four open states occupy the bed, the two terminal ones do not."""
    async with esleme_client(db_session) as (client, app, ward):
        await _admit(db_session, ward, "2", state=state)
        answer = await _bind(client, ward, "admin", "192.0.2.13", "2")
        binds = app.state.audit.records(event_type="device_bed.bind")
    if asks:
        assert (answer.status_code, answer.json()["detail"]["code"]) == (409, "bed_occupied")
        assert binds == []
    else:
        assert answer.status_code == 200 and [r.patient_id for r in binds] == [""]


async def test_confirming_on_a_free_bed_claims_no_patient(db_session):
    async with esleme_client(db_session) as (client, app, ward):
        done = await _bind(client, ward, "admin", "192.0.2.13", "3", confirm=True)
        [rec] = app.state.audit.records(event_type="device_bed.bind")
    assert done.status_code == 200
    assert (rec.patient_id, rec.payload["occupied_confirmed"], rec.payload["occupied"]) == ("", False, [])


async def test_moving_off_an_occupied_bed_asks_and_audits_that_patient_the_replaced_monitor_has_none(db_session):
    """The target bed (with the monitor it displaces) is free; the bed left holds a patient. The moving
    monitor's audit row carries the patient of the bed it leaves; the displaced monitor's, the target's: none."""
    async with esleme_client(db_session) as (client, app, ward):
        ids = await seed(db_session, ward, ("192.0.2.11", "1", "BED05"), ("192.0.2.12", "2", "BED06"))
        await _admit(db_session, ward, "1", "H2600044")
        args = ("admin", "192.0.2.11", "2", ids["192.0.2.11"], ids["192.0.2.12"])
        refused = await _bind(client, ward, *args)
        done = await _bind(client, ward, *args, confirm=True)
        [moved] = app.state.audit.records(event_type="device_bed.bind")
        [displaced] = app.state.audit.records(event_type="device_bed.unbind")
    assert refused.json()["detail"]["occupied"] == [{"bed_id": str(ward.beds["1"].id), "patient_id": "H2600044"}]
    assert done.status_code == 200 and done.json()["replaced_source"] == "192.0.2.12"
    assert moved.patient_id == "H2600044"
    assert (displaced.subject, displaced.payload["reason"], displaced.patient_id) == ("192.0.2.12", "replaced", "")


async def test_replacing_a_monitor_on_an_occupied_bed_names_the_target_patient_on_both_rows(db_session):
    """Both beds hold a patient: the target first; the moving monitor's row carries the TARGET bed's patient
    (it starts that link), the displaced monitor's too (its link there ends)."""
    async with esleme_client(db_session) as (client, app, ward):
        ids = await seed(db_session, ward, ("192.0.2.11", "1", "BED05"), ("192.0.2.12", "2", "BED06"))
        await _admit(db_session, ward, "1", "H2600044")
        await _admit(db_session, ward, "2", "H2600045")
        args = ("admin", "192.0.2.11", "2", ids["192.0.2.11"], ids["192.0.2.12"])
        refused = await _bind(client, ward, *args)
        done = await _bind(client, ward, *args, confirm=True)
        [moved] = app.state.audit.records(event_type="device_bed.bind")
        [displaced] = app.state.audit.records(event_type="device_bed.unbind")
    both = [{"bed_id": str(ward.beds["2"].id), "patient_id": "H2600045"},
            {"bed_id": str(ward.beds["1"].id), "patient_id": "H2600044"}]
    assert refused.json()["detail"]["occupied"] == both
    assert done.status_code == 200
    assert (moved.patient_id, moved.payload["occupied"]) == ("H2600045", both)
    assert (displaced.subject, displaced.patient_id) == ("192.0.2.12", "H2600045")


async def test_an_admission_made_here_and_the_board_record_of_it_name_the_bed_once(db_session):
    """A `kabul` admission is both a DB admission and a board record: one entry, not two."""
    identities = InMemoryIdentityStore()
    async with esleme_client(db_session, identities=identities) as (client, _, ward):
        await _admit(db_session, ward, "2", "H2600046")
        _on_board(identities, ward, "2", "H2600046")
        refused = await _bind(client, ward, "admin", "192.0.2.13", "2")
    assert refused.json()["detail"]["occupied"] == [{"bed_id": str(ward.beds["2"].id), "patient_id": "H2600046"}]


async def test_two_patients_the_board_puts_on_one_bed_are_never_guessed_between(db_session):
    """Two admitted records on one bed and no admission here: the bed is occupied, and no id is named to the
    caller or in the row's `patient_id` (it would be one of the two, at random). The audit PAYLOAD keeps
    the trail: both ids, in `patient_ids` - which the answer never shows."""
    identities = InMemoryIdentityStore()
    async with esleme_client(db_session, identities=identities) as (client, app, ward):
        _on_board(identities, ward, "2", "H2600048", given="Leyla", family="Sentetik")
        _on_board(identities, ward, "2", "H2600047")
        refused = await _bind(client, ward, "admin", "192.0.2.13", "2")
        done = await _bind(client, ward, "admin", "192.0.2.13", "2", confirm=True)
        [rec] = app.state.audit.records(event_type="device_bed.bind")
    bed = str(ward.beds["2"].id)
    assert refused.json()["detail"]["occupied"] == [{"bed_id": bed}]
    assert "H26" not in refused.text and "patient_ids" not in refused.text
    assert done.status_code == 200
    assert (rec.patient_id, rec.payload["occupied_confirmed"]) == ("", True)
    assert rec.payload["occupied"] == [{"bed_id": bed, "patient_ids": ["H2600047", "H2600048"]}]
    assert "Ahmet" not in json.dumps(rec.payload, ensure_ascii=False) and "Leyla" not in json.dumps(rec.payload)


async def test_two_board_patients_and_an_admission_here_name_the_admissions_patient(db_session):
    """The admission made here is the hospital's own record of who lies there: it is named, to the caller and
    in the row's `patient_id`, and there is no `patient_ids` trail (nothing was left unnamed)."""
    identities = InMemoryIdentityStore()
    async with esleme_client(db_session, identities=identities) as (client, app, ward):
        await _admit(db_session, ward, "2", "H2600049")
        _on_board(identities, ward, "2", "H2600047")
        _on_board(identities, ward, "2", "H2600048", given="Leyla", family="Sentetik")
        refused = await _bind(client, ward, "admin", "192.0.2.13", "2")
        done = await _bind(client, ward, "admin", "192.0.2.13", "2", confirm=True)
        [rec] = app.state.audit.records(event_type="device_bed.bind")
    named = [{"bed_id": str(ward.beds["2"].id), "patient_id": "H2600049"}]
    assert refused.json()["detail"]["occupied"] == named
    assert done.status_code == 200 and rec.patient_id == "H2600049"
    assert rec.payload["occupied"] == named


async def test_a_his_fed_patient_found_through_the_bed_map_counts_too(db_session):
    """The strip's other path (spec §4.4 8b): a HIS record names a location, not our bed; the site's bed map
    resolves it. Bound on the target bed here, so the answer is the strip's rule and not a `bed_id` look-up."""
    identities = InMemoryIdentityStore()

    def table(ward):
        return BedMap({"YB^304^2": BedRef(bed_id=str(ward.beds["2"].id), unit_id=str(ward.units["rea"].id),
                                          label="2")})

    async with esleme_client(db_session, identities=identities, bedmap=table) as (client, app, ward):
        identities.apply(SLUG, IdentityRecord(patient_id="S-100", given="Ahmet", family="Yılmaz", unit="YB",
                                              room="304", bed="2", source="adt", updated_at=NOW))
        refused = await _bind(client, ward, "admin", "192.0.2.13", "2")
        done = await _bind(client, ward, "admin", "192.0.2.13", "2", confirm=True)
        [rec] = app.state.audit.records(event_type="device_bed.bind")
    assert refused.json()["detail"]["occupied"] == [{"bed_id": str(ward.beds["2"].id), "patient_id": "S-100"}]
    assert done.status_code == 200 and rec.patient_id == "S-100"


async def _other_with_bed(db, admitted: str | None = None):
    """Another tenant's one bed; with `admitted` (a synthetic patient number), an open admission on it."""
    from homunculus.tenant.models import Bed, Room, Site, Unit, UnitType
    other = await tenant_only(db, "ucuncu-hastane")
    site = Site(tenant_id=other.id, name="Bina")
    db.add(site)
    await db.flush()
    unit = Unit(site_id=site.id, name="YBÜ", unit_type=UnitType.ADULT_ICU)
    db.add(unit)
    await db.flush()
    room = Room(unit_id=unit.id, name="Oda 1")
    db.add(room)
    await db.flush()
    bed = Bed(room_id=room.id, label="1")
    db.add(bed)
    await db.flush()
    if admitted is not None:
        patient = Patient(tenant_id=other.id, display_name="Sentetik Başqa", date_of_birth="1980-01-01",
                          sex="female", patient_number=admitted)
        db.add(patient)
        await db.flush()
        db.add(Admission(tenant_id=other.id, patient_id=patient.id, admitting_unit_id=unit.id, bed_id=bed.id,
                         admission_datetime=NOW, state=AdmissionState.ACTIVE,
                         admission_diagnosis_free_text="Sentetik tanı"))
    await db.commit()
    return other, bed.id

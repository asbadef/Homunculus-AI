# homunculus-engine/tests/test_tres_mapping.py
"""TRƏS-01 (spec §5, D5, D8, D10, D16, D17, D20, D22): the four mappers of phase F1 as golden tests —
each resource exactly as spec §5 shapes it, every time in the tenant's zone with its offset, every
skip with its catalogue reason — and the stay's bedside readings: the withdrawn ones left out, the
first and last by measurement time. Pure functions: no database, no network (the drift guards
against the engine's `/clinical` door run it in memory: `create_app` with an `InMemoryAuditLog`).
A synthetic stay of a synthetic person; the zone is a fixed +04:00 (Asia/Baku has had no DST since
2016), so the test needs no time zone database."""
from __future__ import annotations

import uuid
from dataclasses import replace
from pathlib import Path
from datetime import datetime, timedelta, timezone, tzinfo

import pytest
from fastapi.testclient import TestClient

from homunculus.api import clinical
from homunculus.api.app import create_app
from homunculus.api.audit import AuditRecord, InMemoryAuditLog
from homunculus.api.identity import Caller
from homunculus.api.rehydrate import retracted_entries
from homunculus.tres import codes, ids, stay as stay_module
from homunculus.tres.client import LOCAL_ID_EXTENSION
from homunculus.tres.mapping.common import DISCHARGE_MISSING, INSTANT_NAIVE, Built, Skip, instant
from homunculus.tres.mapping.encounter import encounter
from homunculus.tres.mapping.patient import patient
from homunculus.tres.mapping.practitioner import practitioner
from homunculus.tres.mapping.vitals import vitals
from homunculus.tres.stay import Clinician, Department, Person, Reading, Stay, first_and_last, readings_of

BAKU = timezone(timedelta(hours=4), "Asia/Baku")
ROOT = uuid.UUID("00000000-0000-4000-8000-000000000001")
LAST = uuid.UUID("00000000-0000-4000-8000-000000000002")
DOCTOR = uuid.UUID("00000000-0000-4000-8000-0000000000d1")
ADMITTED = datetime(2026, 11, 2, 6, 30, tzinfo=timezone.utc)        # 10:30 in Baku
DISCHARGED = datetime(2026, 11, 6, 11, 0, tzinfo=timezone.utc)      # 15:00 in Baku
PERSON = Person(fin="ab12c3d", display_name="Sentetikova Leyla Nur", father_name="Sentetik",
                sex="female", date_of_birth="1980-01-31", phone="050 123 45 67")
PATIENT_ID = ids.patient("AB12C3D")


def at(hours: float) -> datetime:
    return ADMITTED + timedelta(hours=hours)


def stay(**over) -> Stay:
    values = dict(root_id=ROOT, last_id=LAST, board_key="202600000001", admitted_at=ADMITTED,
                  discharged_at=DISCHARGED, finished=True, person=PERSON, zone=BAKU,
                  department=Department("RE-01", "Reanimasiya"),
                  clinicians=(Clinician(DOCTOR, "zz99yy8", "Sentetikov", "Elçin", known=True),),
                  weight_kg=72.5, height_cm=168.0,
                  readings=(Reading("heart_rate", 88.0, at(1), 11), Reading("heart_rate", 76.0, at(90), 41),
                            Reading("heart_rate", 92.0, at(40), 31), Reading("temperature", 37.2, at(2), 12),
                            Reading("spo2", 95.0, at(1), 13)))
    return Stay(**{**values, **over})


def local(resource: dict) -> str:
    return resource["extension"][0]["valueString"]


# ---------------------------------------------------------------- Patient (D20)
def test_a_patient_is_the_person_keyed_by_the_fin_digest():
    built = patient(PERSON, ROOT)
    assert isinstance(built, Built) and (built.resource_type, built.fhir_type, built.local_id) == (
        "patient", "Patient", PATIENT_ID)
    assert built.resource == {
        "resourceType": "Patient",
        "meta": {"profile": ["http://fhir.az/StructureDefinition/az-patient"]},
        "extension": [{"url": LOCAL_ID_EXTENSION, "valueString": PATIENT_ID},
                      {"url": "http://fhir.az/StructureDefinition/sex", "valueCode": "Q"},
                      {"url": "http://fhir.az/StructureDefinition/fathersName", "valueString": "Sentetik"}],
        "identifier": [{"type": {"coding": [{"system": "http://fhir.az/CodeSystem/identity-document-type",
                                             "code": "15"}]},
                        "system": "http://fhir.az/sid/fin", "value": "AB12C3D"}],
        "active": True,
        "name": [{"family": "Sentetikova", "given": ["Leyla", "Nur"]}],
        "birthDate": "1980-01-31",
        "telecom": [{"system": "phone", "value": "+994501234567"}],
    }
    assert "AB12C3D" not in built.local_id                      # the id says nothing about the FİN
    assert patient(replace(PERSON, display_name="Sentetik Ayşe", sex="male"), LAST).local_id == PATIENT_ID


def test_a_patient_without_a_phone_the_platform_reads_is_sent_without_one():
    built = patient(replace(PERSON, phone="+90 532 000 00 00"), ROOT)
    assert isinstance(built, Built) and "telecom" not in built.resource


def test_each_missing_requirement_is_a_skip_with_its_reason():
    placeholder = ids.patient_placeholder(ROOT)
    cases = [(replace(PERSON, fin=None), placeholder, "fin_missing"),
             (replace(PERSON, fin="AB12C3"), placeholder, "fin_format"),
             (replace(PERSON, display_name="Sentetik"), PATIENT_ID, "name_single"),
             (replace(PERSON, father_name="  "), PATIENT_ID, "father_name_missing"),
             (replace(PERSON, sex="unknown"), PATIENT_ID, "sex_unmapped"),
             (replace(PERSON, date_of_birth="31.01.1980"), PATIENT_ID, "birth_date_invalid")]
    for person, local_id, reason in cases:
        assert patient(person, ROOT) == Skip("patient", local_id, reason), reason


# ---------------------------------------------------------------- Practitioner (D16)
def test_a_practitioner_is_the_identity_the_tab_holds():
    built = practitioner(Clinician(DOCTOR, " zz99yy8 ", "Sentetikov", "Elçin Rəşad", known=True))
    assert built.resource == {
        "resourceType": "Practitioner",
        "meta": {"profile": ["http://fhir.az/StructureDefinition/az-practitioner"]},
        "extension": [{"url": LOCAL_ID_EXTENSION, "valueString": f"hmn-pr-{DOCTOR}."}],
        "identifier": [{"type": {"coding": [{"system": "http://fhir.az/CodeSystem/identity-document-type",
                                             "code": "15"}]},
                        "system": "http://fhir.az/sid/fin", "value": "ZZ99YY8"}],
        "active": True,
        "name": [{"family": "Sentetikov", "given": ["Elçin", "Rəşad"]}],
    }


def test_a_practitioner_without_a_whole_identity_is_skipped():
    local_id = f"hmn-pr-{DOCTOR}."
    assert practitioner(Clinician(DOCTOR)) == Skip("practitioner", local_id, "identity_missing")
    assert practitioner(Clinician(DOCTOR, None, "S", "E", known=True)) == Skip("practitioner", local_id, "fin_missing")
    assert practitioner(Clinician(DOCTOR, "ZZ99", "S", "E", known=True)) == Skip("practitioner", local_id, "fin_format")
    assert practitioner(Clinician(DOCTOR, "ZZ99YY8", "", "E", known=True)) == Skip("practitioner", local_id, "name_missing")
    assert practitioner(Clinician(DOCTOR, "ZZ99YY8", "S", "", known=True)) == Skip("practitioner", local_id, "name_missing")
    assert practitioner(Clinician(DOCTOR, "ZZ99YY8", "S", "   ", known=True)) == Skip("practitioner", local_id, "name_missing")
    assert practitioner(Clinician(DOCTOR, "ZZ99YY8", None, None, known=True)) == Skip("practitioner", local_id, "name_missing")


# ---------------------------------------------------------------- Encounter (D8, D17, D22)
def test_an_encounter_is_the_stay_from_its_root_in_the_tenants_zone():
    built = encounter(stay(), patient_id="7001", practitioner_ids=["7002"], organization_id="ORG-0001")
    assert built.local_id == f"hmn-e-{ROOT}."
    assert built.resource == {
        "resourceType": "Encounter",
        "meta": {"profile": ["http://fhir.az/StructureDefinition/az-encounter"]},
        "extension": [{"url": LOCAL_ID_EXTENSION, "valueString": f"hmn-e-{ROOT}."}],
        "status": "finished",
        "class": {"system": "http://terminology.hl7.org/CodeSystem/v3-ActCode", "code": "IMP",
                  "display": "inpatient encounter"},
        "type": [{"coding": [{"system": "http://fhir.az/CodeSystem/encounter-type", "code": "1"}]}],
        "subject": {"reference": "Patient/7001"},
        "period": {"start": "2026-11-02T10:30:00+04:00", "end": "2026-11-06T15:00:00+04:00"},
        "serviceType": {"coding": [{"system": "http://fhir.az/CodeSystem/hospital-departments",
                                    "code": "RE-01", "display": "Reanimasiya"}]},
        "serviceProvider": {"reference": "Organization/ORG-0001"},
        "participant": [{"individual": {"reference": "Practitioner/7002"}}],
    }


def test_a_stay_still_open_is_in_progress_with_no_end_and_no_participant_when_none_was_sent():
    built = encounter(stay(finished=False, discharged_at=None), patient_id="7001", practitioner_ids=[],
                      organization_id="ORG-0001")
    assert (built.resource["status"], built.resource["period"]) == ("in-progress", {"start": "2026-11-02T10:30:00+04:00"})
    assert "participant" not in built.resource


def test_a_utc_tenant_gets_a_plus_zero_offset_never_a_z():
    """D22: a time carries its offset; `Z` is never written — a tenant left on `UTC` reads `+00:00`."""
    built = encounter(stay(zone=timezone.utc), patient_id="7001", practitioner_ids=[], organization_id="ORG-0001")
    assert built.resource["period"] == {"start": "2026-11-02T06:30:00+00:00", "end": "2026-11-06T11:00:00+00:00"}
    observation = vitals(stay(zone=timezone.utc), patient_id="7001", encounter_id="7003")[0].resource
    assert observation["effectiveDateTime"] == "2026-11-02T07:30:00+00:00"
    assert instant(ADMITTED, timezone.utc) == "2026-11-02T06:30:00+00:00"
    assert "Z" not in str(built.resource["period"]) + observation["effectiveDateTime"]


class _NoOffset(tzinfo):
    """A tzinfo that is attached but knows no offset: as naive as no tzinfo at all (Python's own rule)."""

    def utcoffset(self, dt):
        return None

    def dst(self, dt):
        return None


def test_a_time_with_no_zone_is_refused_not_read_as_the_servers_local_time():
    for naive in (datetime(2026, 11, 2, 10, 30), datetime(2026, 11, 2, 10, 30, tzinfo=_NoOffset())):
        with pytest.raises(ValueError) as refused:
            instant(naive, BAKU)
        assert str(refused.value) == INSTANT_NAIVE and "2026" not in str(refused.value)
    assert instant(datetime(2026, 11, 2, 6, 30, tzinfo=timezone.utc), BAKU) == "2026-11-02T10:30:00+04:00"


def test_a_stay_finished_with_no_discharge_time_is_skipped_not_sent_open_ended():
    """A `finished` Encounter without `period.end` is a record that contradicts itself."""
    skipped = encounter(stay(finished=True, discharged_at=None), patient_id="7001", practitioner_ids=[],
                        organization_id="ORG-0001")
    assert skipped == Skip("encounter", f"hmn-e-{ROOT}.", "discharge_missing")
    assert skipped.reason == DISCHARGE_MISSING == "discharge_missing"


def test_an_encounter_without_its_department_organization_or_zone_is_skipped():
    local_id = f"hmn-e-{ROOT}."
    assert encounter(stay(department=None), patient_id="1", practitioner_ids=[], organization_id="O") == Skip(
        "encounter", local_id, "unit_unmapped")
    assert encounter(stay(), patient_id="1", practitioner_ids=[], organization_id=" ") == Skip(
        "encounter", local_id, "organization_missing")
    assert encounter(stay(zone=None), patient_id="1", practitioner_ids=[], organization_id="O") == Skip(
        "encounter", local_id, "timezone_unknown")


# ---------------------------------------------------------------- vital signs (D10, D12)
def test_each_signal_goes_as_its_first_and_last_then_weight_and_height():
    built = vitals(stay(), patient_id="7001", encounter_id="7003")
    assert [(b.resource_type, b.fhir_type) for b in built] == [("vital", "Observation")] * 6
    assert [b.local_id for b in built] == [
        f"hmn-v-{ROOT}-heart-rate-first.", f"hmn-v-{ROOT}-heart-rate-last.", f"hmn-v-{ROOT}-spo2-first.",
        f"hmn-v-{ROOT}-temperature-first.", f"hmn-v-{ROOT}-weight-first.", f"hmn-v-{ROOT}-height-first."]
    assert all(ids.is_local_id(b.local_id) and len(b.local_id) <= 64 for b in built)
    first_hr = built[0].resource
    assert first_hr == {
        "resourceType": "Observation",
        "meta": {"profile": ["http://fhir.az/StructureDefinition/az-observation"]},
        "extension": [{"url": LOCAL_ID_EXTENSION, "valueString": f"hmn-v-{ROOT}-heart-rate-first."}],
        "status": "final",
        "category": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/observation-category",
                                  "code": "vital-signs", "display": "Vital Signs"}]}],
        "code": {"coding": [{"system": "http://loinc.org", "code": "8867-4", "display": "Heart rate"}],
                 "text": "Heart rate"},
        "subject": {"reference": "Patient/7001"},
        "encounter": {"reference": "Encounter/7003"},
        "effectiveDateTime": "2026-11-02T11:30:00+04:00",
        "valueQuantity": {"value": 88, "unit": "/min", "system": "http://unitsofmeasure.org", "code": "/min"},
    }
    last_hr = built[1].resource
    assert (last_hr["effectiveDateTime"], last_hr["valueQuantity"]["value"]) == ("2026-11-06T04:30:00+04:00", 76)
    temperature = built[3].resource["valueQuantity"]
    assert temperature == {"value": 37.2, "unit": "Cel", "system": "http://unitsofmeasure.org", "code": "Cel"}
    weight = built[4].resource
    assert (weight["effectiveDateTime"], weight["valueQuantity"]["value"], weight["valueQuantity"]["code"]) == (
        "2026-11-02T10:30:00+04:00", 72.5, "kg")
    assert built[5].resource["valueQuantity"] == {"value": 168, "unit": "cm", "system": "http://unitsofmeasure.org",
                                                  "code": "cm"}


def test_a_changed_loinc_code_is_the_same_resource_under_the_same_local_id(monkeypatch):
    """O7: SpO2 may move from `2708-6` to `59408-5` (the ministry's answer). A sent local id never
    changes (amendment 1), so the code is not in it: the next round PUTs the same resource."""
    before = {b.local_id: b.resource for b in vitals(stay(), patient_id="7001", encounter_id="7003")}
    other = replace(codes.SIGNALS["spo2"], loinc=codes.Coded(
        codes.LOINC, "59408-5", "Oxygen saturation in Arterial blood by Pulse oximetry"))
    monkeypatch.setitem(codes.SIGNALS, "spo2", other)
    after = {b.local_id: b.resource for b in vitals(stay(), patient_id="7001", encounter_id="7003")}
    assert list(after) == list(before)
    spo2 = f"hmn-v-{ROOT}-spo2-first."
    assert before[spo2]["code"]["coding"][0]["code"] == "2708-6"
    assert after[spo2]["code"]["coding"][0]["code"] == "59408-5"


def test_no_readings_and_no_measurements_send_no_vitals():
    assert vitals(stay(readings=(), weight_kg=None, height_cm=None), patient_id="1", encounter_id="2") == []
    assert vitals(stay(zone=None), patient_id="1", encounter_id="2") == []


@pytest.mark.parametrize("bad", [0, 0.0, -1.0, -72.5, float("inf"), float("-inf"), float("nan")])
def test_a_weight_or_height_that_is_not_a_positive_finite_number_is_not_sent(bad):
    """`inf` must never reach `valueQuantity`; zero and negative values are not measurements."""
    assert vitals(stay(readings=(), weight_kg=bad, height_cm=bad), patient_id="1", encounter_id="2") == []
    only_height = vitals(stay(readings=(), weight_kg=bad), patient_id="1", encounter_id="2")
    assert [b.local_id for b in only_height] == [f"hmn-v-{ROOT}-height-first."]
    only_weight = vitals(stay(readings=(), height_cm=bad), patient_id="1", encounter_id="2")
    assert [b.local_id for b in only_weight] == [f"hmn-v-{ROOT}-weight-first."]


def test_first_and_last_are_by_measurement_time_and_one_value_is_first_only():
    chosen = first_and_last(stay().readings)
    assert {slug: (first.entry, last.entry if last else None) for slug, (first, last) in chosen.items()} == {
        "heart_rate": (11, 41), "temperature": (12, None), "spo2": (13, None)}
    tie = first_and_last([Reading("map", 70.0, at(1), 9), Reading("map", 72.0, at(1), 8)])
    assert (tie["map"][0].entry, tie["map"][1].entry) == (8, 9)


def _record(id_, event_type, subject, payload) -> AuditRecord:
    return AuditRecord(id=id_, ts="2026-11-02T07:00:00+00:00", tenant="sentetik", event_type=event_type,
                       patient_id="202600000001", subject=subject, payload=payload)


def test_the_readings_are_the_charted_ones_less_the_withdrawn_and_the_unreadable():
    obs = at(1).isoformat()
    records = [
        _record(1, "chart", "heart_rate", {"value": 88.0, "unit": "/min", "obs_ts": obs}),
        _record(2, "chart", "heart_rate", {"value": 180.0, "unit": "/min", "obs_ts": obs}),
        _record(3, "chart_retract", "heart_rate", {"entry": 2, "reason": "yanlış hasta seçilmiş"}),
        _record(4, "chart", "temperature", {"value": 99.0, "unit": "°F", "obs_ts": obs}),        # another unit
        _record(5, "chart", "spo2", {"value": True, "unit": "%", "obs_ts": obs}),                 # not a number
        _record(6, "chart", "resp_rate", {"value": 18.0, "unit": "/min", "obs_ts": "2026-11-02T07:00:00"}),  # no zone
        _record(7, "chart", "lactate", {"value": 2.0, "unit": "mmol/L", "obs_ts": obs}),         # not a vital (F4)
        _record(8, "ingest", "heart_rate", {"value": 90.0, "unit": "/min", "obs_ts": obs}),       # a monitor's: never
        _record(9, "chart", "map", {"value": 70.0, "unit": "mmHg", "obs_ts": obs}),
    ]
    assert readings_of(records) == (Reading("heart_rate", 88.0, at(1), 1), Reading("map", 70.0, at(1), 9))


def _chart_row(id_, slug, value, hours, **payload) -> AuditRecord:
    return _record(id_, "chart", slug, {"value": value, "unit": "/min", "obs_ts": at(hours).isoformat(), **payload})


def _retract_row(id_, entry) -> AuditRecord:
    return _record(id_, "chart_retract", "heart_rate", {"entry": entry, "reason": "yanlış hasta seçilmiş"})


@pytest.mark.parametrize("entry", [True, 1.0, [1], "1", None, {"id": 1}, 1.5])
def test_a_malformed_retract_withdraws_nothing_and_raises_nothing(entry):
    """The engine's own guard (api/rehydrate.py `retracted_entries`): only an `int` that is not a `bool`
    names a row. `True` and `1.0` equal 1 and would have withdrawn row 1; `[1]` is unhashable and
    would have raised."""
    records = [_chart_row(1, "heart_rate", 88.0, 1), _retract_row(2, entry)]
    assert retracted_entries(records) == frozenset()
    assert readings_of(records) == (Reading("heart_rate", 88.0, at(1), 1),)


def test_withdrawing_the_earliest_or_the_latest_reading_promotes_the_next():
    rows = [_chart_row(1, "heart_rate", 80.0, 1), _chart_row(2, "heart_rate", 82.0, 5),
            _chart_row(3, "heart_rate", 84.0, 9)]

    def ends(*withdrawn):
        chosen = first_and_last(readings_of([*rows, *(_retract_row(10 + n, n) for n in withdrawn)]))
        first, last = chosen["heart_rate"]
        return first.entry, last.entry if last else None

    assert ends() == (1, 3)
    assert ends(1) == (2, 3)             # the earliest withdrawn: the next is the first
    assert ends(3) == (1, 2)             # the latest withdrawn: the one before is the last
    assert ends(1, 3) == (2, None)       # both: one value left, first only
    assert "heart_rate" not in first_and_last(                    # all three: no reading, no vital sign
        readings_of([*rows, *(_retract_row(10 + n, n) for n in (1, 2, 3))]))


def test_a_row_the_device_token_charted_is_not_hand_charted_but_every_other_charter_is():
    """D10 sends hand-charted values only. `/clinical` also takes the tenant (device) token and then
    writes `charted_by` «tenant-token» (api/app.py): a machine's sample is unverified, so it is left out."""
    records = [_chart_row(1, "heart_rate", 88.0, 1, charted_by=stay_module.DEVICE_CHARTER),
               _chart_row(2, "heart_rate", 90.0, 2, charted_by="hem.ayse"),
               _chart_row(3, "heart_rate", 92.0, 3)]
    assert [r.entry for r in readings_of(records)] == [2, 3]
    assert stay_module.DEVICE_CHARTER == "tenant-token"


# ---------------------------------------------------------------- drift guards against the engine's doors
def test_the_trail_names_the_stay_reads_are_the_engines_own():
    """`chart_retract` is a constant of api/clinical.py; the `chart` row's type is a literal there, so the
    guard runs the real door: a hand entry and a device entry in, the withdrawal out, through
    `create_app` with an in-memory trail — a rename would leave `readings_of` silently empty."""
    assert stay_module.RETRACT == clinical.RETRACT

    async def resolve(credential):
        return {"nurse": Caller(hospital="h1", actor="hem.ayse", groups=("nurse",),
                                perms=frozenset({"board.view", "clinical.chart"}))}.get(credential)

    audit = InMemoryAuditLog()
    app = create_app({"tok": "h1"}, run_escalation_loop=False, resolve_jwt=resolve, audit=audit)
    when = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    nurse = {"Authorization": "Bearer nurse"}

    def chart(headers, value):
        answer = client.post("/clinical/bed-3", headers=headers, json={
            "entries": [{"code": "heart_rate", "value": value}], "recorded_at": when})
        assert answer.status_code == 200, answer.text
        return answer.json()["entries"][0]["entry"]

    with TestClient(app) as client:
        chart({"Authorization": "Bearer tok"}, 70)                    # the bridge's token: a device row
        hand, wrong = chart(nurse, 80), chart(nurse, 160)
        withdrawn = client.post(f"/clinical/bed-3/entries/{wrong}/retract", headers=nurse,
                                json={"reason": "yazım hatası — 160 değil 60"})
        assert withdrawn.status_code == 200, withdrawn.text
    records = audit.records(tenant="h1", limit=1000)
    assert {r.event_type for r in records} >= {stay_module.CHART, stay_module.RETRACT}
    assert [r.payload["charted_by"] for r in records if r.event_type == stay_module.CHART] == [
        stay_module.DEVICE_CHARTER, "hem.ayse", "hem.ayse"]
    assert [r.entry for r in readings_of(records)] == [hand]          # not the device's, not the withdrawn


def test_the_device_branch_of_charted_by_still_writes_the_literal_the_stay_skips():
    """api/app.py `_charted_by` records the token path as exactly the string `stay.DEVICE_CHARTER`; the
    engine's source is read, as the dashboard's tests read it, so a changed literal fails here."""
    source = (Path(clinical.__file__).parent / "app.py").read_text(encoding="utf-8")
    assert f'return "{stay_module.DEVICE_CHARTER}" if caller.is_device else caller.actor' in source


# ---------------------------------------------------------------- no identity in a repr
def test_a_persons_and_a_clinicians_repr_hold_none_of_their_identity():
    """A `Stay` ends up in a log line or a pytest diff: its repr must not carry a FİN, a name, a birth date…"""
    shown = repr(PERSON) + repr(stay().clinicians[0]) + repr(stay())
    for value in ("ab12c3d", "AB12C3D", "zz99yy8", "ZZ99YY8", "Sentetikova", "Leyla", "Nur", "Sentetik", "Sentetikov",
                  "Elçin", "female", "1980", "050 123 45 67"):
        assert value not in shown, value

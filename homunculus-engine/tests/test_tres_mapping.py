# homunculus-engine/tests/test_tres_mapping.py
"""TRƏS-01 (spec §5, D5, D8, D10, D16, D17, D20, D22): the four mappers of phase F1 as golden tests —
each resource exactly as spec §5 shapes it, every time in the tenant's zone with its offset, every
skip with its catalogue reason — and the stay's bedside readings: the withdrawn ones left out, the
first and last by measurement time. Pure functions: no database, no network. A synthetic stay of
a synthetic person; the zone is a fixed +04:00 (Asia/Baku has had no DST since 2016), so the test
needs no time zone database."""
from __future__ import annotations

import uuid
from dataclasses import replace
from datetime import datetime, timedelta, timezone

from homunculus.api.audit import AuditRecord
from homunculus.tres import ids
from homunculus.tres.client import LOCAL_ID_EXTENSION
from homunculus.tres.mapping.common import Built, Skip
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
        f"hmn-v-{ROOT}-8867-4-first.", f"hmn-v-{ROOT}-8867-4-last.", f"hmn-v-{ROOT}-2708-6-first.",
        f"hmn-v-{ROOT}-8310-5-first.", f"hmn-v-{ROOT}-29463-7-first.", f"hmn-v-{ROOT}-8302-2-first."]
    first_hr = built[0].resource
    assert first_hr == {
        "resourceType": "Observation",
        "meta": {"profile": ["http://fhir.az/StructureDefinition/az-observation"]},
        "extension": [{"url": LOCAL_ID_EXTENSION, "valueString": f"hmn-v-{ROOT}-8867-4-first."}],
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


def test_no_readings_and_no_measurements_send_no_vitals():
    assert vitals(stay(readings=(), weight_kg=None, height_cm=None), patient_id="1", encounter_id="2") == []
    assert vitals(stay(zone=None), patient_id="1", encounter_id="2") == []


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

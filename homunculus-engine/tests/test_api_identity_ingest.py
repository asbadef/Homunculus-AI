"""Identity through the API: /ingest accepts it, the board carries it, the audit does not.

Synthetic names. Mirrors the style of the other API tests: create_app with the escalation loop
off so nothing is timing-dependent.
"""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.audit import InMemoryAuditLog
from homunculus.api.patient_identity import InMemoryIdentityStore

TOKEN = "tok-1"
HEAD = {"Authorization": f"Bearer {TOKEN}"}
WHEN = datetime(2026, 9, 4, 14, 30, tzinfo=timezone.utc)
PATIENT = {
    "resourceType": "Patient",
    "identifier": [{"system": "http://homunculus.local/protocol-no", "value": "20239121"}],
    "name": [{"family": "YILMAZ", "given": ["AYSE"]}],
    "birthDate": "1980-01-15", "gender": "female", "active": True,
    "meta": {"lastUpdated": WHEN.isoformat(), "source": "comed"},
}
ENCOUNTER = {
    "resourceType": "Encounter", "status": "in-progress",
    "subject": {"reference": "Patient/20239121"},
    "location": [{"location": {"display": "YB^304^2"}}],
    "period": {"start": WHEN.isoformat()},
    "meta": {"lastUpdated": WHEN.isoformat(), "source": "comed"},
}
OBSERVATION = {
    "resourceType": "Observation", "status": "final",
    "code": {"coding": [{"system": "http://homunculus.local/obs", "code": "spo2"}]},
    "subject": {"reference": "Patient/20239121"},
    "effectiveDateTime": WHEN.isoformat(),
    "valueQuantity": {"value": 97.0, "unit": "%"},
    "device": {"display": "nce"},
}


@pytest.fixture
def client():
    audit = InMemoryAuditLog()
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False, audit=audit,
                     identities=InMemoryIdentityStore())
    with TestClient(app) as c:
        c.audit = audit
        yield c


def test_a_patient_resource_is_accepted_and_appears_on_the_board(client):
    assert client.post("/ingest", json=PATIENT, headers=HEAD).status_code == 200
    [entry] = client.get("/patients", headers=HEAD).json()["patients"]
    assert entry["patient_id"] == "20239121"
    assert entry["identity"]["display_name"] == "AYSE YILMAZ"
    assert entry["identity"]["source"] == "comed"
    assert entry["latest"]["spo2"] is None          # admitted, not yet measured


def test_an_encounter_adds_the_bed(client):
    client.post("/ingest", json=PATIENT, headers=HEAD)
    client.post("/ingest", json=ENCOUNTER, headers=HEAD)
    [entry] = client.get("/patients", headers=HEAD).json()["patients"]
    assert entry["identity"]["bed_label"] == "YB 304-2"


def test_a_reading_for_a_known_patient_lands_on_the_same_card(client):
    client.post("/ingest", json=PATIENT, headers=HEAD)
    client.post("/ingest", json=OBSERVATION, headers=HEAD)
    patients = client.get("/patients", headers=HEAD).json()["patients"]
    assert len(patients) == 1
    assert patients[0]["latest"]["spo2"] == 97.0
    assert patients[0]["identity"]["display_name"] == "AYSE YILMAZ"


def test_a_reading_without_an_identity_still_makes_a_card(client):
    client.post("/ingest", json=OBSERVATION, headers=HEAD)
    [entry] = client.get("/patients", headers=HEAD).json()["patients"]
    assert entry["identity"] is None
    assert entry["latest"]["spo2"] == 97.0


def test_the_audit_records_the_event_but_never_the_name(client):
    client.post("/ingest", json=PATIENT, headers=HEAD)
    records = client.get("/audit", headers=HEAD).json()
    events = records if isinstance(records, list) else next(
        v for v in records.values() if isinstance(v, list))
    identity_events = [e for e in events if e["event_type"] == "identity"]
    assert len(identity_events) == 1
    assert identity_events[0]["patient_id"] == "20239121"
    assert identity_events[0]["payload"] == {"source": "comed", "state": "admitted",
                                             "resource": "Patient"}
    assert "YILMAZ" not in str(records) and "AYSE" not in str(records)


def test_a_malformed_identity_resource_is_refused_with_400(client):
    broken = {**PATIENT, "identifier": []}
    response = client.post("/ingest", json=broken, headers=HEAD)
    assert response.status_code == 400
    assert "protocol number" in response.json()["detail"]


def test_one_hospital_never_sees_another_hospitals_identity():
    app = create_app({TOKEN: "h1", "tok-2": "h2"}, run_escalation_loop=False,
                     identities=InMemoryIdentityStore())
    with TestClient(app) as c:
        c.post("/ingest", json=PATIENT, headers=HEAD)
        assert c.get("/patients", headers={"Authorization": "Bearer tok-2"}).json()["patients"] == []


def test_retention_removes_unmeasured_cards_and_clears_names_on_live_stream():
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False)
    with TestClient(app) as client:
        client.post("/ingest", json={**PATIENT, "active": False}, headers=HEAD)
        queue = app.state.broadcaster.subscribe("h1")
        client.portal.call(app.state.escalation_cycle, WHEN + timedelta(hours=25))
        event = queue.get_nowait()
        assert event["removed"] is True and event["identity"] is None
        assert "YILMAZ" not in str(event)
        assert client.get("/patients", headers=HEAD).json()["patients"] == []


def test_retention_keeps_existing_measurements_but_removes_the_identity():
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False)
    with TestClient(app) as client:
        client.post("/ingest", json={**PATIENT, "active": False}, headers=HEAD)
        client.post("/ingest", json=OBSERVATION, headers=HEAD)
        queue = app.state.broadcaster.subscribe("h1")
        client.portal.call(app.state.escalation_cycle, WHEN + timedelta(hours=25))
        event = queue.get_nowait()
        assert event["identity"] is None and event["latest"]["spo2"] == 97.0
        assert event.get("removed") is not True


@pytest.mark.parametrize("broken", [
    {**PATIENT, "identifier": "bad"},
    {**PATIENT, "name": "bad"},
    {**PATIENT, "meta": {"lastUpdated": "not-a-date"}},
    {**ENCOUNTER, "status": "unknown"},
])
def test_invalid_identity_shapes_return_400_without_payload_content(client, broken):
    response = client.post("/ingest", json=broken, headers=HEAD)
    assert response.status_code == 400
    assert "YILMAZ" not in response.text

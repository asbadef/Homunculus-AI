# tests/test_api_discharge.py
"""G2-A11: a patient discharged through a Homunculus admission (a `kabul` tombstone in the identity
store) leaves the alert world. Synthetic numbers and values only (CLAUDE.md rule 6)."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.audit import InMemoryAuditLog
from homunculus.api.patient_identity import IdentityRecord, InMemoryIdentityStore

TOKEN = "tok-1"
HEAD = {"Authorization": f"Bearer {TOKEN}"}
WHEN = datetime(2026, 10, 26, 9, 0, tzinfo=timezone.utc)


def _obs(code, value, patient, when=WHEN):
    return {"resourceType": "Observation", "status": "final",
            "code": {"coding": [{"system": "http://homunculus.local/obs", "code": code}]},
            "subject": {"reference": f"Patient/{patient}"},
            "effectiveDateTime": when.isoformat(),
            "valueQuantity": {"value": value, "unit": "u"}, "device": {"display": "nce"}}


def _his_patient(patient, source="comed", active=True):
    return {"resourceType": "Patient",
            "identifier": [{"system": "http://homunculus.local/protocol-no", "value": patient}],
            "name": [{"family": "TEST", "given": ["SYNTH"]}],
            "birthDate": "1980-01-15", "gender": "female", "active": active,
            "meta": {"lastUpdated": WHEN.isoformat(), "source": source}}


def _kabul(store, patient, state="admitted"):
    """What Lane B's admission writes: a record whose source is `kabul`; discharged, a tombstone."""
    store.apply("h1", IdentityRecord(patient, family="TEST", given="SYNTH", state=state,
                                     source="kabul", updated_at=WHEN))


@pytest.fixture
def app():
    audit, identities = InMemoryAuditLog(), InMemoryIdentityStore()
    application = create_app({TOKEN: "h1"}, run_escalation_loop=False, audit=audit,
                             identities=identities)
    application.state.test_identities = identities
    return application


@pytest.fixture
def client(app):
    with TestClient(app) as c:
        yield c


def _rows(app, event_type, patient=None):
    return app.state.audit.records(tenant="h1", event_type=event_type, patient_id=patient, limit=1000)


class TestAReadingForADischargedNumber:
    def test_is_dropped_before_the_engine_with_one_audit_row(self, app, client):
        _kabul(app.state.test_identities, "H-1", state="discharged")
        queue = app.state.broadcaster.subscribe("h1")
        r = client.post("/ingest", json=_obs("heart_rate", 140, "H-1"), headers=HEAD)
        assert r.status_code == 200 and r.json() == {"patient_id": "H-1", "dropped": "discharged"}
        [row] = _rows(app, "reading_dropped_discharged")
        assert row.patient_id == "H-1" and row.subject == "heart_rate"
        assert row.payload == {"patient_id": "H-1", "code": "heart_rate"}
        assert _rows(app, "ingest", "H-1") == [] and _rows(app, "alert", "H-1") == []
        assert queue.empty(), "nothing is published for a dropped reading"
        assert client.get("/alerts/H-1", headers=HEAD).json()["alerts"] == []
        cards = client.get("/patients", headers=HEAD).json()["patients"]
        assert all(c["latest"]["heart_rate"] is None for c in cards if c["patient_id"] == "H-1")

    def test_is_dropped_at_clinical_too_one_row_per_entry(self, app, client):
        _kabul(app.state.test_identities, "H-1", state="discharged")
        r = client.post("/clinical/H-1", headers=HEAD, json={"entries": [
            {"code": "suspected_infection", "value": 1}, {"code": "lactate", "value": 3.1}],
            "recorded_at": WHEN.isoformat()})
        assert r.status_code == 200 and r.json() == {"patient_id": "H-1", "dropped": "discharged"}
        assert {row.subject for row in _rows(app, "reading_dropped_discharged")} == {"suspected_infection", "lactate"}
        assert _rows(app, "chart", "H-1") == []

    def test_a_malformed_chart_for_a_discharged_number_is_still_400(self, app, client):
        _kabul(app.state.test_identities, "H-1", state="discharged")
        r = client.post("/clinical/H-1", headers=HEAD, json={"entries": [{"code": "nope", "value": 1}]})
        assert r.status_code == 400
        assert _rows(app, "reading_dropped_discharged") == []

    def test_a_his_discharged_patient_is_still_evaluated(self, app, client):
        client.post("/ingest", json=_his_patient("20239121", active=False), headers=HEAD)
        r = client.post("/ingest", json=_obs("heart_rate", 140, "20239121"), headers=HEAD)
        assert r.status_code == 200 and "alerts" in r.json()
        assert len(_rows(app, "ingest", "20239121")) == 1

    def test_an_admitted_kabul_patient_is_evaluated_as_any_other(self, app, client):
        _kabul(app.state.test_identities, "H-2")
        r = client.post("/ingest", json=_obs("heart_rate", 140, "H-2"), headers=HEAD)
        assert r.status_code == 200 and [a["kind"] for a in r.json()["alerts"]] == ["news2"]


class TestIdentityResourcesAndKabul:
    def test_an_identity_resource_whose_source_is_kabul_is_refused(self, app, client):
        r = client.post("/ingest", json=_his_patient("H-3", source="kabul"), headers=HEAD)
        assert r.status_code == 400 and "kabul" in r.json()["detail"]
        assert app.state.test_identities.get("h1", "H-3") is None
        assert _rows(app, "identity") == []

    def test_a_his_resource_for_a_kabul_record_is_refused_and_changes_nothing(self, app, client):
        _kabul(app.state.test_identities, "H-2")
        before = app.state.test_identities.get("h1", "H-2")
        r = client.post("/ingest", json=_his_patient("H-2", active=False), headers=HEAD)
        assert r.status_code == 200
        assert r.json() == {"patient_id": "H-2", "identity": "refused", "reason": "kabul"}
        assert app.state.test_identities.get("h1", "H-2") == before
        assert _rows(app, "identity") == []

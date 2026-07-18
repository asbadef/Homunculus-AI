# tests/test_api_ingest.py
from pathlib import Path

from fastapi.testclient import TestClient

import homunculus.scenarios
from homunculus.api.app import create_app
from homunculus.scenarios.loader import load_scenario

SCEN = Path(homunculus.scenarios.__file__).parent
TENANTS = {"tok-hosp1": "HOSP1", "tok-hosp2": "HOSP2"}


def _client():
    return TestClient(create_app(TENANTS))


def _hdr(token):
    return {"Authorization": f"Bearer {token}"}


def _fhir(code, value, unit="", patient="bed-3", when="2026-07-14T10:00:00+00:00"):
    return {
        "resourceType": "Observation",
        "code": {"coding": [{"system": "x", "code": code}]},
        "subject": {"reference": f"Patient/{patient}"},
        "effectiveDateTime": when,
        "valueQuantity": {"value": value, "unit": unit},
    }


def test_ingest_requires_a_known_tenant_token():
    c = _client()
    assert c.post("/ingest", json=_fhir("heart_rate", 100)).status_code == 401
    assert c.post("/ingest", json=_fhir("heart_rate", 100), headers=_hdr("nope")).status_code == 401


def test_ingest_rejects_a_malformed_observation():
    c = _client()
    r = c.post("/ingest", json={"resourceType": "Patient"}, headers=_hdr("tok-hosp1"))
    assert r.status_code == 400


def test_ingest_accepts_a_valid_observation():
    c = _client()
    r = c.post("/ingest", json=_fhir("heart_rate", 100), headers=_hdr("tok-hosp1"))
    assert r.status_code == 200
    body = r.json()
    assert body["patient_id"] == "bed-3"
    assert isinstance(body["alerts"], list)


def test_full_scenario_raises_septic_shock_through_the_api():
    c = _client()
    events = load_scenario(SCEN / "septic_shock.yaml")
    patient = events[0][1]["subject"]["reference"].split("/", 1)[1]
    for _ts, fhir in events:
        assert c.post("/ingest", json=fhir, headers=_hdr("tok-hosp1")).status_code == 200
    r = c.get(f"/alerts/{patient}", headers=_hdr("tok-hosp1"))
    kinds = {a["kind"] for a in r.json()["alerts"]}
    assert "septic_shock" in kinds


def test_tenant_isolation_hosp2_cannot_see_hosp1_patient():
    c = _client()
    events = load_scenario(SCEN / "septic_shock.yaml")
    patient = events[0][1]["subject"]["reference"].split("/", 1)[1]
    for _ts, fhir in events:
        c.post("/ingest", json=fhir, headers=_hdr("tok-hosp1"))
    # Same patient id, different tenant -> a separate engine that never saw this patient.
    r = c.get(f"/alerts/{patient}", headers=_hdr("tok-hosp2"))
    assert r.status_code == 200
    assert r.json()["alerts"] == []


def test_patients_snapshot_lists_patients_with_risk_and_latest():
    c = _client()
    events = load_scenario(SCEN / "septic_shock.yaml")
    for _ts, fhir in events:
        c.post("/ingest", json=fhir, headers=_hdr("tok-hosp1"))
    r = c.get("/patients", headers=_hdr("tok-hosp1"))
    assert r.status_code == 200
    boards = {b["patient_id"]: b for b in r.json()["patients"]}
    assert "bed-3" in boards
    assert boards["bed-3"]["risk"] in ("high", "critical")
    assert boards["bed-3"]["latest"]["sofa"] >= 2


def test_patients_requires_a_tenant_token():
    c = _client()
    assert c.get("/patients").status_code == 401

# tests/test_api_persistence.py
"""State survives a 'restart': a new app over the same SQLite audit rehydrates the board."""
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.audit import SqliteAuditLog

TENANTS = {"tok": "HOSP1"}
_SHOCK = [("suspected_infection", 1.0), ("weight_kg", 100), ("crystalloid_bolus_ml", 3000),
          ("map", 60), ("norepinephrine_rate", 0.12), ("lactate", 3.1)]


def _fhir(code, value, patient="bed-3", when="2026-07-14T10:00:00+00:00"):
    return {"resourceType": "Observation", "code": {"coding": [{"code": code}]},
            "subject": {"reference": f"Patient/{patient}"}, "effectiveDateTime": when,
            "valueQuantity": {"value": value, "unit": ""}}


def _hdr():
    return {"Authorization": "Bearer tok"}


def test_board_survives_restart_via_audit_replay(tmp_path):
    db = str(tmp_path / "audit.db")
    app_a = create_app(TENANTS, run_escalation_loop=False, audit=SqliteAuditLog(db))
    ca = TestClient(app_a)
    for code, val in _SHOCK:
        ca.post("/ingest", json=_fhir(code, val), headers=_hdr())

    # "restart": a brand-new app over the SAME audit file
    app_b = create_app(TENANTS, run_escalation_loop=False, audit=SqliteAuditLog(db))
    cb = TestClient(app_b)
    boards = {b["patient_id"]: b for b in cb.get("/patients", headers=_hdr()).json()["patients"]}
    assert "bed-3" in boards
    assert any(a["kind"] == "septic_shock" for a in boards["bed-3"]["alerts"])


def test_ack_survives_restart(tmp_path):
    db = str(tmp_path / "audit.db")
    app_a = create_app(TENANTS, run_escalation_loop=False, audit=SqliteAuditLog(db))
    ca = TestClient(app_a)
    for code, val in _SHOCK:
        ca.post("/ingest", json=_fhir(code, val), headers=_hdr())
    ca.post("/ack", json={"patient_id": "bed-3", "kind": "septic_shock", "role": "doctor"}, headers=_hdr())

    app_b = create_app(TENANTS, run_escalation_loop=False, audit=SqliteAuditLog(db))
    cb = TestClient(app_b)
    boards = {b["patient_id"]: b for b in cb.get("/patients", headers=_hdr()).json()["patients"]}
    shock = next(a for a in boards["bed-3"]["alerts"] if a["kind"] == "septic_shock")
    assert shock["acknowledged"] is True and shock["acknowledged_by"] == "doctor"

# tests/test_api_ingest.py
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi.testclient import TestClient

import homunculus.scenarios
from homunculus.api.app import create_app
from homunculus.api.audit import InMemoryAuditLog
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


# --- G2-A1 (O17): an alert ends on the first reading that does not produce it ---------------------

def _alerts_of(c, patient="bed-3"):
    board = c.get("/patients", headers=_hdr("tok-hosp1")).json()["patients"]
    return [a["kind"] for b in board if b["patient_id"] == patient for a in b["alerts"]]


def _rows(c, kind, *types):
    rows = c.get("/audit", params={"patient_id": "bed-3", "limit": 10000},
                 headers=_hdr("tok-hosp1")).json()["records"]
    return [r for r in rows if r["subject"] == kind and r["event_type"] in types]


def test_a_moderate_alert_leaves_the_board_on_the_first_normal_reading():
    c = _client()
    c.post("/ingest", json=_fhir("heart_rate", 140, "/min"), headers=_hdr("tok-hosp1"))
    assert _alerts_of(c) == ["news2"], "140/min alone: a single red parameter, NEWS2 moderate"
    c.post("/ingest", json=_fhir("heart_rate", 80, "/min", when="2026-07-14T10:01:00+00:00"),
           headers=_hdr("tok-hosp1"))
    assert _alerts_of(c) == []
    (opened,) = _rows(c, "news2", "first_seen")
    (closed,) = _rows(c, "news2", "alert_cleared")
    assert (closed["payload"]["reason"], closed["payload"]["severity"]) == ("resolved", "moderate")
    assert closed["payload"]["first_seen"] == opened["payload"]["at"]


def test_a_kind_that_returns_after_it_ended_is_a_new_episode_and_a_nurse_is_told_again():
    c = _client()
    for _ts, fhir in load_scenario(SCEN / "septic_shock.yaml"):
        c.post("/ingest", json=fhir, headers=_hdr("tok-hosp1"))
    c.post("/ack", json={"patient_id": "bed-3", "kind": "septic_shock", "role": "nurse"},
           headers=_hdr("tok-hosp1"))
    for value, when in [(1.5, "2026-07-14T11:01:00+00:00"), (3.4, "2026-07-14T11:02:00+00:00")]:
        c.post("/ingest", json=_fhir("lactate", value, "mmol/L", when=when), headers=_hdr("tok-hosp1"))
    trail = [r["event_type"] for r in _rows(c, "septic_shock", "first_seen", "notification", "alert_cleared")]
    assert trail == ["first_seen", "notification", "alert_cleared", "first_seen", "notification"]
    shock = next(a for b in c.get("/patients", headers=_hdr("tok-hosp1")).json()["patients"]
                 for a in b["alerts"] if a["kind"] == "septic_shock")
    assert shock["acknowledged"] is False, "the old answer belongs to the old episode (D5)"


class _FailsOnce(InMemoryAuditLog):
    """An audit log whose next append of `fail_on` raises once — the database going away
    mid-request."""

    def __init__(self):
        super().__init__()
        self.fail_on = None

    def append(self, event):
        if event.event_type == self.fail_on:
            self.fail_on = None
            raise RuntimeError("audit down")
        return super().append(event)


def test_a_reading_stamped_in_the_future_does_not_age_the_others():
    """G2-A2 (X10): /ingest evaluates at min(observation time, wall clock). Judged at a heart rate
    stamped 30 min ahead, vitals taken 45 min ago would be 75 min old — stale — and the running
    NEWS2 alert held on them; at the wall clock they are fresh and it is scored as before. The
    audit row still carries the reading's own stamp: only the evaluation instant changes."""
    c = TestClient(create_app(TENANTS, run_escalation_loop=False))
    wall = datetime.now(timezone.utc)
    taken = (wall - timedelta(minutes=45)).isoformat()
    for code, value in (("resp_rate", 26), ("spo2", 91), ("sbp", 88)):     # NEWS2 9: high
        assert c.post("/ingest", json=_fhir(code, value, when=taken),
                      headers=_hdr("tok-hosp1")).status_code == 200
    ahead = wall + timedelta(minutes=30)
    r = c.post("/ingest", json=_fhir("heart_rate", 80, "/min", when=ahead.isoformat()),
               headers=_hdr("tok-hosp1"))
    assert r.status_code == 200
    (board,) = [b for b in c.get("/patients", headers=_hdr("tok-hosp1")).json()["patients"]
                if b["patient_id"] == "bed-3"]
    assert board["latest"]["news2"]["stale"] == []
    news2 = next(a for a in board["alerts"] if a["kind"] == "news2")
    assert (news2["severity"], news2["stale_inputs"]) == ("high", [])
    assert "Held while inputs are stale" not in news2["clinical_reasoning"]
    assert len(_rows(c, "news2", "first_seen")) == 1, "the running episode, not a new one"
    (row,) = _rows(c, "heart_rate", "ingest")
    assert row["payload"]["obs_ts"] == ahead.isoformat()


def test_an_ingest_row_that_fails_to_audit_does_not_take_a_critical_off_the_board():
    """The lifecycle hook follows the evaluation directly, before any audit write: the engine has
    already moved on when the audit fails, and an unacknowledged critical that cleared on that
    request must still be on the next read, latched — not missing until some later reading."""
    audit = _FailsOnce()
    c = TestClient(create_app(TENANTS, run_escalation_loop=False, audit=audit),
                   raise_server_exceptions=False)
    for _ts, fhir in load_scenario(SCEN / "septic_shock.yaml"):
        assert c.post("/ingest", json=fhir, headers=_hdr("tok-hosp1")).status_code == 200
    audit.fail_on = "ingest"
    r = c.post("/ingest", json=_fhir("lactate", 1.5, "mmol/L", when="2026-07-14T11:01:00+00:00"),
               headers=_hdr("tok-hosp1"))
    assert r.status_code == 500
    shock = next((a for b in c.get("/patients", headers=_hdr("tok-hosp1")).json()["patients"]
                  for a in b["alerts"] if a["kind"] == "septic_shock"), None)
    assert shock is not None, "an unacknowledged critical must not vanish (D2)"
    assert shock["resolved_at"] is not None and shock["acknowledged"] is False

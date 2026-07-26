# tests/test_first_seen_persistence.py
"""first_seen (the escalation clock) survives a restart, so a long-unacked alert escalates after one."""
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from homunculus.api.ackstore import AckStore
from homunculus.api.app import create_app
from homunculus.api.audit import AuditEvent, InMemoryAuditLog, SqliteAuditLog
from homunculus.api.rehydrate import rehydrate
from homunculus.pipeline import Engine

T0 = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)
TENANTS = {"tok": "HOSP1"}
_SHOCK = [("suspected_infection", 1.0), ("weight_kg", 100), ("crystalloid_bolus_ml", 3000),
          ("map", 60), ("norepinephrine_rate", 0.12), ("lactate", 3.1)]


def _fhir(code, value, patient="bed-3", when="2026-07-14T10:00:00+00:00"):
    return {"resourceType": "Observation", "code": {"coding": [{"code": code}]},
            "subject": {"reference": f"Patient/{patient}"}, "effectiveDateTime": when,
            "valueQuantity": {"value": value, "unit": ""}}


def test_stamp_first_seen_returns_true_only_when_newly_stamped():
    store = AckStore()
    assert store.stamp_first_seen("bed-3", "septic_shock", T0) is True
    assert store.stamp_first_seen("bed-3", "septic_shock", T0) is False   # already stamped


def test_rehydrate_replays_first_seen_events():
    audit = InMemoryAuditLog()
    audit.append(AuditEvent("HOSP1", "first_seen", "bed-3", "septic_shock", {"at": T0.isoformat()}))
    engine, store = Engine(), AckStore()
    rehydrate(engine, store, audit.records(tenant="HOSP1"))
    assert store.first_seen[("bed-3", "septic_shock")] == T0


def test_escalation_fires_after_restart_because_first_seen_persisted(tmp_path):
    db = str(tmp_path / "audit.db")
    app_a = create_app(TENANTS, run_escalation_loop=False, audit=SqliteAuditLog(db))
    ca = TestClient(app_a)
    for code, val in _SHOCK:
        ca.post("/ingest", json=_fhir(code, val), headers={"Authorization": "Bearer tok"})

    # "restart": new app over the same audit; escalate_after=0 so a persisted first_seen is past-threshold
    from datetime import timedelta
    app_b = create_app(TENANTS, escalate_after=timedelta(seconds=0), run_escalation_loop=False,
                       audit=SqliteAuditLog(db))
    cb = TestClient(app_b)
    cb.get("/patients", headers={"Authorization": "Bearer tok"})   # triggers rehydration
    import anyio
    anyio.run(app_b.state.escalation_cycle, datetime.now(timezone.utc))
    boards = {b["patient_id"]: b for b in cb.get("/patients", headers={"Authorization": "Bearer tok"}).json()["patients"]}
    shock = next(a for a in boards["bed-3"]["alerts"] if a["kind"] == "septic_shock")
    assert shock["escalated"] is True   # would be False if first_seen had not persisted

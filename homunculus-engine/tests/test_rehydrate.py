# tests/test_rehydrate.py
from datetime import datetime, timezone

from homunculus.api.ackstore import AckStore
from homunculus.api.audit import AuditEvent, InMemoryAuditLog
from homunculus.api.rehydrate import rehydrate
from homunculus.pipeline import Engine

T0 = "2026-07-14T10:00:00+00:00"

_SHOCK = [("suspected_infection", 1.0), ("weight_kg", 100.0), ("crystalloid_bolus_ml", 3000.0),
          ("map", 60.0), ("norepinephrine_rate", 0.12), ("lactate", 3.1)]


def _audit_with_shock(tenant="HOSP1", patient="bed-3"):
    audit = InMemoryAuditLog()
    for slug, val in _SHOCK:
        audit.append(AuditEvent(tenant, "ingest", patient, slug,
                                {"value": val, "unit": "", "obs_ts": T0, "device": "mon"}))
    return audit


def test_rehydrate_replays_ingests_into_alerts():
    audit = _audit_with_shock()
    engine, store = Engine(), AckStore()
    rehydrate(engine, store, audit.records(tenant="HOSP1"))
    kinds = {a.kind for a in engine.active_alerts("bed-3")}
    assert "septic_shock" in kinds


def test_rehydrate_replays_acks():
    audit = _audit_with_shock()
    audit.append(AuditEvent("HOSP1", "ack", "bed-3", "septic_shock",
                            {"role": "doctor", "at": T0}))
    engine, store = Engine(), AckStore()
    rehydrate(engine, store, audit.records(tenant="HOSP1"))
    assert ("bed-3", "septic_shock") in store.acks
    assert store.acks[("bed-3", "septic_shock")]["by"] == "doctor"


def test_rehydrate_ignores_non_replayable_events():
    audit = InMemoryAuditLog()
    audit.append(AuditEvent("HOSP1", "alert", "bed-3", "septic_shock", {"severity": "critical"}))
    audit.append(AuditEvent("HOSP1", "notification", "bed-3", "septic_shock", {"audience": "nurse"}))
    engine, store = Engine(), AckStore()
    rehydrate(engine, store, audit.records(tenant="HOSP1"))   # must not raise
    assert engine.active_alerts("bed-3") == []


def test_rehydrate_writes_no_new_audit_records():
    audit = _audit_with_shock()
    before = len(audit.records(tenant="HOSP1"))
    engine, store = Engine(), AckStore()
    rehydrate(engine, store, audit.records(tenant="HOSP1"))
    assert len(audit.records(tenant="HOSP1")) == before   # replay does not re-audit

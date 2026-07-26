# tests/test_audit_memory.py
from homunculus.api.audit import AuditEvent, InMemoryAuditLog


def _ev(tenant="HOSP1", et="alert", pid="bed-3", subject="septic_shock", **payload):
    return AuditEvent(tenant=tenant, event_type=et, patient_id=pid, subject=subject, payload=payload)


def test_append_returns_record_with_id_and_ts():
    log = InMemoryAuditLog()
    rec = log.append(_ev(severity="critical"))
    assert rec.id == 1
    assert rec.tenant == "HOSP1" and rec.event_type == "alert" and rec.subject == "septic_shock"
    assert rec.payload["severity"] == "critical"
    assert rec.ts.endswith("+00:00")


def test_ids_increment_and_records_return_in_order():
    log = InMemoryAuditLog()
    log.append(_ev(et="ingest", subject="heart_rate"))
    log.append(_ev(et="alert"))
    recs = log.records()
    assert [r.id for r in recs] == [1, 2]
    assert [r.event_type for r in recs] == ["ingest", "alert"]


def test_records_filter_by_tenant_patient_and_event_type():
    log = InMemoryAuditLog()
    log.append(_ev(tenant="HOSP1", et="ack", pid="bed-3"))
    log.append(_ev(tenant="HOSP2", et="ack", pid="bed-3"))
    log.append(_ev(tenant="HOSP1", et="alert", pid="bed-9"))
    assert [r.tenant for r in log.records(tenant="HOSP1")] == ["HOSP1", "HOSP1"]
    assert len(log.records(tenant="HOSP1", event_type="ack")) == 1
    assert len(log.records(tenant="HOSP1", patient_id="bed-9")) == 1


def test_records_respect_limit():
    log = InMemoryAuditLog()
    for _ in range(5):
        log.append(_ev())
    assert len(log.records(limit=3)) == 3

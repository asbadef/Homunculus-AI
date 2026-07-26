# tests/test_audit_sqlite.py
import sqlite3

import pytest

from homunculus.api.audit import AuditEvent, SqliteAuditLog


def _ev(tenant="HOSP1", et="alert", pid="bed-3", subject="septic_shock", **payload):
    return AuditEvent(tenant=tenant, event_type=et, patient_id=pid, subject=subject, payload=payload)


def test_append_and_read_round_trips_in_memory():
    log = SqliteAuditLog(":memory:")
    rec = log.append(_ev(severity="critical", urgency="immediate"))
    assert rec.id == 1
    got = log.records(tenant="HOSP1")[0]
    assert got.subject == "septic_shock" and got.payload["urgency"] == "immediate"


def test_update_is_rejected_by_trigger():
    log = SqliteAuditLog(":memory:")
    log.append(_ev())
    with pytest.raises(sqlite3.IntegrityError):
        log.connection.execute("UPDATE audit SET tenant='X' WHERE id=1")


def test_delete_is_rejected_by_trigger():
    log = SqliteAuditLog(":memory:")
    log.append(_ev())
    with pytest.raises(sqlite3.IntegrityError):
        log.connection.execute("DELETE FROM audit WHERE id=1")


def test_filters_and_order_and_limit():
    log = SqliteAuditLog(":memory:")
    log.append(_ev(tenant="HOSP1", et="ingest", subject="heart_rate"))
    log.append(_ev(tenant="HOSP2", et="alert"))
    log.append(_ev(tenant="HOSP1", et="alert", pid="bed-9"))
    assert [r.id for r in log.records(tenant="HOSP1")] == [1, 3]     # ordered by id, tenant-scoped
    assert len(log.records(event_type="alert")) == 2
    assert len(log.records(limit=1)) == 1


def test_file_backend_persists_across_reopen(tmp_path):
    path = str(tmp_path / "audit.db")
    SqliteAuditLog(path).append(_ev())
    assert len(SqliteAuditLog(path).records()) == 1     # reopen sees prior record

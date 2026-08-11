"""
Durable Postgres audit.

The pilot carries real data, and an audit that vanishes on the next deploy is worse than none —
it still looks like a record. These run against a real Postgres (TEST_DATABASE_URL); the
append-only triggers are part of what is being tested, so they cannot be faked in memory.
"""
from __future__ import annotations

import pytest
from sqlalchemy import text

from homunculus.api.audit import AuditEvent
from homunculus.api.audit_postgres import PostgresAuditLog, to_sync_url
from tests.conftest import TEST_DATABASE_URL, requires_db

pytestmark = requires_db

_DDL = """
CREATE TABLE IF NOT EXISTS audit (
    id BIGSERIAL PRIMARY KEY, ts TEXT NOT NULL, tenant TEXT NOT NULL,
    event_type TEXT NOT NULL, patient_id TEXT NOT NULL, subject TEXT NOT NULL,
    payload JSONB NOT NULL
);
CREATE OR REPLACE FUNCTION audit_is_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit is append-only'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS audit_no_update ON audit;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit
    FOR EACH ROW EXECUTE FUNCTION audit_is_append_only();
DROP TRIGGER IF EXISTS audit_no_delete ON audit;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit
    FOR EACH ROW EXECUTE FUNCTION audit_is_append_only();
"""


@pytest.fixture
def audit_log():
    log = PostgresAuditLog(TEST_DATABASE_URL)
    with log._engine.begin() as conn:                      # noqa: SLF001 — test setup
        conn.execute(text("DROP TABLE IF EXISTS audit CASCADE"))
        for statement in _DDL.split(";\n"):
            if statement.strip():
                conn.execute(text(statement))
    yield log
    with log._engine.begin() as conn:                      # noqa: SLF001
        conn.execute(text("DROP TABLE IF EXISTS audit CASCADE"))
    log.dispose()


def _event(**over) -> AuditEvent:
    base = dict(tenant="HOSP1", event_type="alert", patient_id="bed-3", subject="news2",
                payload={"severity": "moderate"})
    return AuditEvent(**{**base, **over})


def test_url_is_rewritten_for_the_sync_driver():
    """One DATABASE_URL configures the app; the audit derives its sync form so they cannot drift."""
    assert to_sync_url("postgresql+asyncpg://u:p@h:5432/db") == "postgresql+psycopg2://u:p@h:5432/db"


def test_appends_and_reads_back(audit_log):
    record = audit_log.append(_event())

    assert record.id > 0 and record.tenant == "HOSP1"
    (stored,) = audit_log.records(tenant="HOSP1")
    assert stored.subject == "news2"
    assert stored.payload == {"severity": "moderate"}       # JSONB round-trips


def test_filters_and_orders_and_limits(audit_log):
    audit_log.append(_event(event_type="ingest", subject="heart_rate"))
    audit_log.append(_event(tenant="HOSP2"))
    audit_log.append(_event(patient_id="bed-9"))

    assert len(audit_log.records(tenant="HOSP1")) == 2
    assert len(audit_log.records(event_type="ingest")) == 1
    assert len(audit_log.records(patient_id="bed-9")) == 1
    ids = [r.id for r in audit_log.records(limit=10)]
    assert ids == sorted(ids)
    assert len(audit_log.records(limit=1)) == 1


def test_the_trail_cannot_be_rewritten(audit_log):
    """An audit that can be edited after the fact is not an audit."""
    audit_log.append(_event())

    with pytest.raises(Exception, match="append-only"):
        with audit_log._engine.begin() as conn:            # noqa: SLF001
            conn.execute(text("UPDATE audit SET tenant='TAMPERED'"))

    with pytest.raises(Exception, match="append-only"):
        with audit_log._engine.begin() as conn:            # noqa: SLF001
            conn.execute(text("DELETE FROM audit"))

    assert audit_log.records()[0].tenant == "HOSP1"         # untouched


def test_survives_a_new_connection(audit_log):
    """The point of moving off local disk: the record outlives the process that wrote it."""
    audit_log.append(_event())

    reopened = PostgresAuditLog(TEST_DATABASE_URL)
    try:
        assert len(reopened.records(tenant="HOSP1")) == 1
    finally:
        reopened.dispose()

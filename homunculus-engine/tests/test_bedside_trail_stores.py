"""G3-01 (D10, D12): the withdrawal's two trail reads — one patient's rows of the rebuild's kinds and its
withdrawals, and the tenant's `chart_retract` rows — read alike from memory, SQLite and Postgres (Postgres
when TEST_DATABASE_URL is set). An `entry` survives the store as an integer. Synthetic values only."""
from __future__ import annotations

import pytest
from sqlalchemy import text

from homunculus.api.audit import AuditEvent, InMemoryAuditLog, SqliteAuditLog, iter_records_of
from homunculus.api.audit_postgres import PostgresAuditLog
from homunculus.api.clinical import RETRACT
from homunculus.api.rehydrate import REBUILD_EVENTS, retracted_entries
from tests.conftest import TEST_DATABASE_URL, requires_db
from tests.test_audit_postgres import _load_migration

AT = "2026-11-02T08:00:00+00:00"


def _exercise(log):
    chart = log.append(AuditEvent("h1", "chart", "bed-3", "heart_rate",
                                  {"value": 80, "unit": "/min", "obs_ts": AT, "charted_by": "hem.ayse"}))
    log.append(AuditEvent("h1", "alert", "bed-3", "news2", {}))
    log.append(AuditEvent("h1", "chart", "bed-4", "heart_rate",
                          {"value": 90, "unit": "/min", "obs_ts": AT, "charted_by": "hem.ayse"}))
    profile = log.append(AuditEvent("h1", "profile", "bed-3", "", {"comorbidities": ["copd"]}))
    withdrawal = log.append(AuditEvent("h1", RETRACT, "bed-3", "heart_rate",
                                       {"entry": chart.id, "value": 80, "obs_ts": AT,
                                        "reason": "yazım hatası", "retracted_by": "hem.ayse"}))
    rows = list(iter_records_of(log, tenant="h1", patient_id="bed-3", event_types=REBUILD_EVENTS | {RETRACT},
                                page=1))
    assert [r.id for r in rows] == [chart.id, profile.id, withdrawal.id]
    assert retracted_entries(iter_records_of(log, tenant="h1", event_types={RETRACT}, page=2)) == {chart.id}
    assert list(iter_records_of(log, tenant="h2", event_types={RETRACT}, page=2)) == []


def test_in_memory():
    _exercise(InMemoryAuditLog())


def test_sqlite():
    _exercise(SqliteAuditLog(":memory:"))


@pytest.fixture
def pg_log():
    log = PostgresAuditLog(TEST_DATABASE_URL)
    with log._engine.begin() as conn:                      # noqa: SLF001 — test setup
        conn.execute(text("DROP TABLE IF EXISTS audit CASCADE"))
        from alembic.migration import MigrationContext
        from alembic.operations import Operations
        for revision in ("0004", "0008"):
            migration, _ = _load_migration(revision)
            with Operations.context(MigrationContext.configure(conn)):
                migration.upgrade()
    yield log
    with log._engine.begin() as conn:                      # noqa: SLF001
        conn.execute(text("DROP TABLE IF EXISTS audit CASCADE"))
    log.dispose()


@requires_db
def test_postgres(pg_log):
    _exercise(pg_log)

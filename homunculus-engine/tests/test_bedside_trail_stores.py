"""G3-01 (D10, D12): the withdrawal's two trail reads — one patient's rows of the rebuild's kinds and its
withdrawals, and the tenant's `chart_retract` rows — read alike from memory, SQLite and Postgres (Postgres
when TEST_DATABASE_URL is set). An `entry` survives the store as an integer. The trends' read (kinds, one
patient, `since`) is held to the same account. Synthetic values only."""
from __future__ import annotations

import time
from datetime import datetime, timezone

import pytest
from sqlalchemy import text

from homunculus.api.audit import AuditEvent, InMemoryAuditLog, SqliteAuditLog, iter_records_of
from homunculus.api.audit_postgres import PostgresAuditLog
from homunculus.api.clinical import RETRACT
from homunculus.api.rehydrate import REBUILD_EVENTS, retracted_entries
from tests.conftest import TEST_DATABASE_URL, requires_db
from tests.test_audit_postgres import _load_migration

AT = "2026-11-02T08:00:00+00:00"


def _past(ts: str) -> None:
    """Wait until the wall clock has moved beyond `ts`. The Windows tick is coarse, so two appends in a row can
    share one `ts`; a read cut at an instant is only checked against rows strictly before or after it."""
    mark = datetime.fromisoformat(ts)
    while datetime.now(timezone.utc) <= mark:
        time.sleep(0.005)


def _exercise(log):
    chart = log.append(AuditEvent("h1", "chart", "bed-3", "heart_rate",
                                  {"value": 80, "unit": "/min", "obs_ts": AT, "charted_by": "hem.ayse"}))
    log.append(AuditEvent("h1", "alert", "bed-3", "news2", {}))
    chart4 = log.append(AuditEvent("h1", "chart", "bed-4", "heart_rate",
                                   {"value": 90, "unit": "/min", "obs_ts": AT, "charted_by": "hem.ayse"}))
    # Near misses of "bed-3": the same letters in another case, and "bed-3" followed by more. Neither is its rows.
    upper = log.append(AuditEvent("h1", "chart", "BED-3", "heart_rate",
                                  {"value": 70, "unit": "/min", "obs_ts": AT, "charted_by": "hem.ayse"}))
    longer = log.append(AuditEvent("h1", "chart", "bed-30", "heart_rate",
                                   {"value": 71, "unit": "/min", "obs_ts": AT, "charted_by": "hem.ayse"}))
    _past(longer.ts)             # every row above is strictly before the ones below (the `since` cuts)
    profile = log.append(AuditEvent("h1", "profile", "bed-3", "", {"comorbidities": ["copd"]}))
    withdrawal = log.append(AuditEvent("h1", RETRACT, "bed-3", "heart_rate",
                                       {"entry": chart.id, "value": 80, "obs_ts": AT,
                                        "reason": "yazım hatası", "retracted_by": "hem.ayse"}))
    withdrawal4 = log.append(AuditEvent("h1", RETRACT, "bed-4", "heart_rate",
                                        {"entry": chart4.id, "value": 90, "obs_ts": AT,
                                         "reason": "yanlış yatak", "retracted_by": "hem.ayse"}))
    # Another tenant's bed-3, charted and withdrawn: no read of h1 may carry it, and its own read is only its own.
    chart_h2 = log.append(AuditEvent("h2", "chart", "bed-3", "heart_rate",
                                     {"value": 60, "unit": "/min", "obs_ts": AT, "charted_by": "dr.elif"}))
    withdrawal_h2 = log.append(AuditEvent("h2", RETRACT, "bed-3", "heart_rate",
                                          {"entry": chart_h2.id, "value": 60, "obs_ts": AT,
                                           "reason": "yazım hatası", "retracted_by": "dr.elif"}))

    # The rebuild's read: one patient, the rebuild's kinds and the withdrawals, a page of one row.
    rows = list(iter_records_of(log, tenant="h1", patient_id="bed-3", event_types=REBUILD_EVENTS | {RETRACT},
                                page=1))
    assert [r.id for r in rows] == [chart.id, profile.id, withdrawal.id]
    assert [r.payload for r in rows] == [chart.payload, profile.payload, withdrawal.payload]
    assert type(rows[-1].payload["entry"]) is int          # `80 == 80.0`: the equality above would not tell
    for patient, near_miss in (("BED-3", upper), ("bed-30", longer)):
        assert [r.id for r in iter_records_of(log, tenant="h1", patient_id=patient,
                                              event_types={"chart"}, page=1)] == [near_miss.id]

    # The restart's read: every withdrawal of the tenant, a full page and then an empty read.
    assert [r.id for r in iter_records_of(log, tenant="h1", event_types={RETRACT}, page=2)] \
        == [withdrawal.id, withdrawal4.id]
    assert retracted_entries(iter_records_of(log, tenant="h1", event_types={RETRACT}, page=2)) \
        == {chart.id, chart4.id}
    assert [r.id for r in iter_records_of(log, tenant="h2", event_types={RETRACT}, page=2)] == [withdrawal_h2.id]
    assert retracted_entries(iter_records_of(log, tenant="h2", event_types={RETRACT}, page=2)) == {chart_h2.id}
    assert list(iter_records_of(log, tenant="h3", event_types={RETRACT}, page=2)) == []

    # The trends' read (`trends._manual`): the kinds and one patient, cut by `since`, which keeps the rows
    # written AT or after the instant (the memory store's rule, `audit.AuditLog`): every store must agree.
    def ids_since(instant):
        return [r.id for r in log.records(tenant="h1", patient_id="bed-3", event_types={"chart", RETRACT},
                                          since=instant)]

    assert ids_since(datetime.fromisoformat(chart.ts)) == [chart.id, withdrawal.id]
    assert ids_since(datetime.fromisoformat(profile.ts)) == [withdrawal.id]       # the chart is strictly before
    assert ids_since(datetime.fromisoformat(withdrawal.ts)) == [withdrawal.id]    # at: the row itself is kept
    _past(withdrawal_h2.ts)
    assert ids_since(datetime.now(timezone.utc)) == []


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

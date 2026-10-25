"""`records(…, newest=, after_id=)`: the newest N, and every row a page at a time (G2-A2, D11, D12).

Without either, a read is the OLDEST `limit` rows (`ORDER BY id ASC LIMIT n`). `/audit` asked that
and answered with the first 200 rows ever written; `/alarm-quality` read the first 20 000 and then
filtered by time in Python; a restart replayed the first million. `newest=True` is the newest N
matching rows, handed back oldest first; `after_id=n` is the rows after id n, oldest first — one
page of a read that must see every row (`iter_records`). Both at once is refused. Modelled on
test_audit_since.py: memory and SQLite here, Postgres when TEST_DATABASE_URL is set.
"""
from __future__ import annotations

import inspect
import time
from datetime import datetime, timezone

import pytest
from sqlalchemy import text

from homunculus.api.audit import (
    AuditEvent, AuditLog, InMemoryAuditLog, SqliteAuditLog, iter_records,
)
from homunculus.api.audit_postgres import PostgresAuditLog
from tests.conftest import TEST_DATABASE_URL, requires_db
from tests.test_audit_postgres import _load_migration


def _event(n: int, **over) -> AuditEvent:
    base = dict(tenant="HOSP1", event_type="ingest", patient_id="S-001", subject="heart_rate",
                payload={"n": n})
    return AuditEvent(**{**base, **over})


def _fill(log, count: int = 7) -> list:
    return [log.append(_event(n)) for n in range(count)]


def _after_last(log) -> datetime:
    """An instant strictly after every row written so far: on Windows the clock can tick at
    ~15.6 ms, and two rows a moment apart may share one `ts`."""
    last = max(datetime.fromisoformat(r.ts) for r in log.records(limit=10_000))
    while datetime.now(timezone.utc) <= last:
        time.sleep(0.001)
    return datetime.now(timezone.utc)


# --- the contract -------------------------------------------------------------------------------

@pytest.mark.parametrize("cls", [AuditLog, InMemoryAuditLog, SqliteAuditLog, PostgresAuditLog],
                         ids=lambda c: c.__name__)
def test_every_audit_log_takes_newest_and_after_id_as_keywords(cls):
    params = inspect.signature(cls.records).parameters
    assert params["newest"].kind is inspect.Parameter.KEYWORD_ONLY and params["newest"].default is False
    assert params["after_id"].kind is inspect.Parameter.KEYWORD_ONLY and params["after_id"].default is None


# --- in memory and SQLite -----------------------------------------------------------------------

@pytest.fixture(params=["memory", "sqlite"])
def log(request):
    return InMemoryAuditLog() if request.param == "memory" else SqliteAuditLog(":memory:")


def test_newest_is_the_last_rows_oldest_first(log):
    rows = _fill(log)
    assert [r.id for r in log.records(newest=True, limit=3)] == [r.id for r in rows[-3:]]
    assert [r.id for r in log.records(newest=True, limit=100)] == [r.id for r in rows]
    assert [r.id for r in log.records(limit=3)] == [r.id for r in rows[:3]]   # without it: as before


def test_newest_keeps_to_the_window_and_the_filters(log):
    _fill(log, 3)
    bound = _after_last(log)
    kept = [log.append(_event(n)) for n in (10, 11, 12)]
    log.append(_event(13, patient_id="S-002"))
    log.append(_event(14, tenant="HOSP2"))
    rows = log.records(tenant="HOSP1", patient_id="S-001", since=bound, newest=True, limit=2)
    assert [r.id for r in rows] == [r.id for r in kept[-2:]]
    rows = log.records(tenant="HOSP1", patient_id="S-001", since=bound, newest=True, limit=10)
    assert [r.id for r in rows] == [r.id for r in kept]          # the window's rows, none older


def test_a_newest_read_of_no_rows_is_empty_not_everything(log):
    _fill(log, 3)
    assert log.records(newest=True, limit=0) == []


def test_after_id_reads_the_rows_after_it_oldest_first(log):
    rows = _fill(log)
    assert [r.id for r in log.records(after_id=rows[2].id, limit=2)] == [rows[3].id, rows[4].id]
    assert log.records(after_id=rows[-1].id) == []


def test_newest_and_after_id_together_are_refused(log):
    _fill(log, 1)
    with pytest.raises(ValueError, match="newest and after_id"):
        log.records(newest=True, after_id=0)


def test_iter_records_reads_every_row_a_page_at_a_time(log):
    rows = _fill(log, 7)
    log.append(_event(99, tenant="HOSP2"))
    assert [r.id for r in iter_records(log, tenant="HOSP1", page=3)] == [r.id for r in rows]
    assert [r.id for r in iter_records(log, tenant="HOSP1", page=7)] == [r.id for r in rows]
    with pytest.raises(ValueError, match="page"):
        list(iter_records(log, page=0))


# --- Postgres -----------------------------------------------------------------------------------

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
def test_postgres_reads_the_newest_rows_oldest_first(pg_log):
    rows = _fill(pg_log)
    assert [r.id for r in pg_log.records(newest=True, limit=3)] == [r.id for r in rows[-3:]]
    assert [r.id for r in pg_log.records(limit=3)] == [r.id for r in rows[:3]]
    assert pg_log.records(newest=True, limit=0) == []


@requires_db
def test_postgres_keeps_newest_to_the_window_and_the_filters(pg_log):
    _fill(pg_log, 3)
    bound = _after_last(pg_log)
    kept = [pg_log.append(_event(n)) for n in (10, 11, 12)]
    pg_log.append(_event(13, patient_id="S-002"))
    rows = pg_log.records(tenant="HOSP1", patient_id="S-001", since=bound, newest=True, limit=2)
    assert [r.id for r in rows] == [r.id for r in kept[-2:]]
    rows = pg_log.records(tenant="HOSP1", patient_id="S-001", since=bound, newest=True, limit=10)
    assert [r.id for r in rows] == [r.id for r in kept]          # the window's rows, none older


@requires_db
def test_postgres_pages_by_id(pg_log):
    rows = _fill(pg_log, 7)
    assert [r.id for r in pg_log.records(after_id=rows[2].id, limit=2)] == [rows[3].id, rows[4].id]
    assert [r.id for r in iter_records(pg_log, tenant="HOSP1", page=3)] == [r.id for r in rows]


@requires_db
def test_postgres_refuses_newest_with_after_id(pg_log):
    with pytest.raises(ValueError, match="newest and after_id"):
        pg_log.records(newest=True, after_id=0)

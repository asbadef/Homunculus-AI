"""`records(…, since=)`: the audit read from an instant on, in every implementation.

The trends endpoint reads one patient's alarm episodes for a window. Without `since` every read is
the OLDEST N rows (`ORDER BY id ASC LIMIT n`), which on a busy pilot is the wrong end of the log; with
it the window is asked for directly. `ts` is stored as text, so the comparison must order instants,
not strings: the bound may come in any time zone, and a row stamped on a whole second
("…09:00:00+00:00") has no fraction at all where its neighbours have six digits.
"""
from __future__ import annotations

import inspect
import re
import time
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from homunculus.api.audit import AuditEvent, AuditLog, InMemoryAuditLog, SqliteAuditLog
from homunculus.api.audit_postgres import PostgresAuditLog
from tests.conftest import TEST_DATABASE_URL, requires_db
from tests.test_audit_postgres import _load_migration

BAKU = timezone(timedelta(hours=4))
# Three rows a second apart, the first on a whole second: isoformat() writes it with no fraction.
CRAFTED = ["2026-10-19T09:00:00+00:00", "2026-10-19T09:00:00.500000+00:00",
           "2026-10-19T09:00:01+00:00"]
# What `_now_iso()` writes: UTC, six fraction digits or none, always "+00:00" (never "Z").
TS_SHAPE = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{6})?\+00:00")


def _event(**over) -> AuditEvent:
    base = dict(tenant="HOSP1", event_type="first_seen", patient_id="S-001", subject="news2",
                payload={"at": "2026-10-19T09:00:00+00:00"})
    return AuditEvent(**{**base, **over})


def _two(log):
    """Two appends with a clear instant between them; returns their records."""
    first = log.append(_event())
    stamped = datetime.fromisoformat(first.ts)
    # Wait until the clock has strictly passed the first stamp rather than sleeping a fixed time:
    # on Windows the clock can tick at ~15.6 ms, and a short sleep may give both rows one `ts`.
    while datetime.now(timezone.utc) <= stamped:
        time.sleep(0.001)
    second = log.append(_event(subject="septic_shock"))
    return first, second


# --- the contract -------------------------------------------------------------------------------

@pytest.mark.parametrize("cls", [AuditLog, InMemoryAuditLog, SqliteAuditLog, PostgresAuditLog],
                         ids=lambda c: c.__name__)
def test_every_audit_log_takes_since_as_a_keyword(cls):
    param = inspect.signature(cls.records).parameters["since"]
    assert param.kind is inspect.Parameter.KEYWORD_ONLY and param.default is None


# --- in memory and SQLite -----------------------------------------------------------------------

@pytest.fixture(params=["memory", "sqlite"])
def log(request):
    return InMemoryAuditLog() if request.param == "memory" else SqliteAuditLog(":memory:")


def test_since_keeps_the_rows_at_or_after_it(log):
    first, second = _two(log)
    assert [r.id for r in log.records(since=datetime.fromisoformat(second.ts))] == [second.id]
    # Inclusive: the row stamped exactly at the bound is in.
    assert [r.id for r in log.records(since=datetime.fromisoformat(first.ts))] == [first.id, second.id]
    assert [r.id for r in log.records()] == [first.id, second.id]


def test_since_in_another_zone_is_the_same_instant(log):
    _first, second = _two(log)
    baku = datetime.fromisoformat(second.ts).astimezone(BAKU)
    assert [r.id for r in log.records(since=baku)] == [second.id]


def test_since_combines_with_the_other_filters(log):
    _first, second = _two(log)
    log.append(_event(patient_id="S-002"))
    log.append(_event(event_type="alert"))
    log.append(_event(tenant="HOSP2"))
    since = datetime.fromisoformat(second.ts)
    rows = log.records(tenant="HOSP1", patient_id="S-001", event_type="first_seen", since=since)
    assert [r.id for r in rows] == [second.id]


def test_a_since_without_a_zone_is_refused(log):
    log.append(_event())
    with pytest.raises(ValueError, match="time zone"):
        log.records(since=datetime(2026, 10, 19, 9, 0))


def test_append_stamps_ts_in_the_shape_the_sqlite_comparison_needs(log):
    # SQLite compares `ts` as text against `bound.isoformat()` (UTC, "+00:00"); a "Z" suffix or a
    # local offset written by `append` would silently break `since` there.
    record = log.append(_event())
    assert TS_SHAPE.fullmatch(record.ts), record.ts
    assert [TS_SHAPE.fullmatch(r.ts) is not None for r in log.records()] == [True]


def test_sqlite_orders_a_whole_second_against_its_fractions():
    log = SqliteAuditLog(":memory:")
    for ts in CRAFTED:      # unsealed rows (hash ''), as a log written before the chain would hold
        log.connection.execute(
            "INSERT INTO audit (ts, tenant, event_type, patient_id, subject, payload)"
            " VALUES (?, 'HOSP1', 'first_seen', 'S-001', 'news2', '{}')", (ts,))
    log.connection.commit()
    half = datetime(2026, 10, 19, 9, 0, 0, 500000, tzinfo=timezone.utc)
    assert [r.ts for r in log.records(since=half)] == CRAFTED[1:]
    assert [r.ts for r in log.records(since=datetime(2026, 10, 19, 9, 0, tzinfo=timezone.utc))] == CRAFTED


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
def test_postgres_keeps_the_rows_at_or_after_since(pg_log):
    first, second = _two(pg_log)
    assert [r.id for r in pg_log.records(since=datetime.fromisoformat(second.ts))] == [second.id]
    assert [r.id for r in pg_log.records(since=datetime.fromisoformat(first.ts))] == [first.id, second.id]
    baku = datetime.fromisoformat(second.ts).astimezone(BAKU)
    assert [r.id for r in pg_log.records(since=baku)] == [second.id]


@requires_db
def test_postgres_combines_since_with_the_other_filters(pg_log):
    _first, second = _two(pg_log)
    pg_log.append(_event(patient_id="S-002"))
    pg_log.append(_event(event_type="alert"))
    since = datetime.fromisoformat(second.ts)
    rows = pg_log.records(tenant="HOSP1", patient_id="S-001", event_type="first_seen", since=since)
    assert [r.id for r in rows] == [second.id]


@requires_db
def test_postgres_orders_instants_not_text(pg_log):
    with pg_log._engine.begin() as conn:                   # noqa: SLF001
        for ts in CRAFTED:
            conn.execute(text("INSERT INTO audit (ts, tenant, event_type, patient_id, subject, payload)"
                              " VALUES (:ts, 'HOSP1', 'first_seen', 'S-001', 'news2', '{}'::jsonb)"),
                         {"ts": ts})
    half = datetime(2026, 10, 19, 9, 0, 0, 500000, tzinfo=timezone.utc)
    assert [r.ts for r in pg_log.records(since=half)] == CRAFTED[1:]
    assert [r.ts for r in pg_log.records(since=half.astimezone(BAKU))] == CRAFTED[1:]


@requires_db
def test_postgres_stamps_ts_in_the_same_shape(pg_log):
    record = pg_log.append(_event())
    assert TS_SHAPE.fullmatch(record.ts), record.ts
    assert [TS_SHAPE.fullmatch(r.ts) is not None for r in pg_log.records()] == [True]


@requires_db
def test_postgres_compares_instants_where_the_text_would_say_otherwise(pg_log):
    """Pins the `timestamptz` cast, not a real row: no writer stores a non-UTC `ts`
    (`_now_iso`, `PostgresAuditLog.append`).

    "2026-10-20T12:30:00+04:00" is 08:30 UTC, before the 09:00 UTC bound, yet as text it sorts
    AFTER "2026-10-20T09:00:00+00:00" (the hour's "1" > "0", in every collation). Only comparing
    instants leaves it out.
    """
    stamps = ["2026-10-20T12:30:00+04:00", "2026-10-20T09:00:00+00:00"]
    with pg_log._engine.begin() as conn:                   # noqa: SLF001
        for ts in stamps:
            conn.execute(text("INSERT INTO audit (ts, tenant, event_type, patient_id, subject, payload)"
                              " VALUES (:ts, 'HOSP1', 'first_seen', 'S-001', 'news2', '{}'::jsonb)"),
                         {"ts": ts})
    bound = datetime(2026, 10, 20, 9, 0, tzinfo=timezone.utc)
    assert [r.ts for r in pg_log.records(since=bound)] == ["2026-10-20T09:00:00+00:00"]


@requires_db
def test_postgres_refuses_a_since_without_a_zone(pg_log):
    with pytest.raises(ValueError, match="time zone"):
        pg_log.records(since=datetime(2026, 10, 19, 9, 0))

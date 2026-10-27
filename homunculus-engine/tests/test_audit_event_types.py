"""`records(…, event_types=)`: the rows of a SET of kinds (Aşama B, T6 review).

`/alarm-quality` read the newest `cap + 1` rows of every kind, so at the stage `rules` the shadow
lane's own rows (`shadow_alert`, `shadow_alert_cleared`) took places under its cap and moved every
counter. A read of the kinds a report consumes is the backend's to do — under the cap, not after it:
`event_types` keeps the rows whose kind is in the set, `event_type` stays the one-kind filter, and
both at once keep the rows that satisfy both. An empty set matches nothing, never everything. The
kinds are bound parameters, never SQL. Memory and SQLite here, Postgres when TEST_DATABASE_URL is set.
"""
from __future__ import annotations

import inspect

import pytest
from sqlalchemy import text

from homunculus.api.audit import AuditEvent, AuditLog, InMemoryAuditLog, SqliteAuditLog
from homunculus.api.audit_postgres import PostgresAuditLog
from tests.conftest import TEST_DATABASE_URL, requires_db
from tests.test_audit_postgres import _load_migration

KINDS = ("first_seen", "alert", "shadow_alert", "ingest", "ack", "shadow_alert_cleared")
WANTED = frozenset({"first_seen", "alert", "ack"})


def _fill(log) -> list:
    rows = [log.append(AuditEvent("HOSP1", kind, "bed-1", "news2", {"n": n}))
            for n, kind in enumerate(KINDS * 2)]
    log.append(AuditEvent("HOSP2", "alert", "bed-1", "news2", {"n": 99}))
    return rows


def _exercise(log) -> None:
    rows = _fill(log)
    ids = [r.id for r in rows if r.event_type in WANTED]
    assert [r.id for r in log.records(tenant="HOSP1", event_types=WANTED, limit=100)] == ids
    # The newest N of those kinds: a row of another kind never takes a place under the cap.
    assert [r.id for r in log.records(tenant="HOSP1", event_types=WANTED, limit=2, newest=True)] == ids[-2:]
    assert [r.id for r in log.records(tenant="HOSP1", event_types=WANTED, limit=2)] == ids[:2]
    assert [r.id for r in log.records(tenant="HOSP1", event_types=WANTED, after_id=ids[2], limit=100)] == ids[3:]
    # Any iterable, read once (a generator); duplicates are one kind.
    assert [r.event_type for r in log.records(tenant="HOSP1", event_types=(k for k in ["ack", "ack"]),
                                              limit=100)] == ["ack", "ack"]
    # With `event_type`: both hold.
    assert [r.event_type for r in log.records(tenant="HOSP1", event_type="alert", event_types=WANTED,
                                              limit=100)] == ["alert", "alert"]
    assert log.records(tenant="HOSP1", event_type="ingest", event_types=WANTED, limit=100) == []
    # An empty set matches nothing — not every kind; None is no filter.
    assert log.records(tenant="HOSP1", event_types=set(), limit=100) == []
    assert log.records(tenant="HOSP1", event_types=frozenset(), newest=True, limit=100) == []
    assert len(log.records(tenant="HOSP1", event_types=None, limit=100)) == len(rows)
    # A kind is a value, never SQL.
    assert log.records(tenant="HOSP1", event_types={"x' OR '1'='1"}, limit=100) == []
    assert log.records(tenant="HOSP1", event_types={"alert) OR (1=1"}, limit=100) == []


@pytest.mark.parametrize("cls", [AuditLog, InMemoryAuditLog, SqliteAuditLog, PostgresAuditLog],
                         ids=lambda c: c.__name__)
def test_every_audit_log_takes_event_types_as_a_keyword(cls):
    param = inspect.signature(cls.records).parameters["event_types"]
    assert param.kind is inspect.Parameter.KEYWORD_ONLY and param.default is None


def test_in_memory_reads_a_set_of_kinds():
    _exercise(InMemoryAuditLog())


def test_sqlite_reads_a_set_of_kinds():
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
def test_postgres_reads_a_set_of_kinds(pg_log):
    _exercise(pg_log)

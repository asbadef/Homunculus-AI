"""Monitor samples: bulk rows that expire (spec D8). In memory for the API's tests; Postgres under
TEST_DATABASE_URL, through the migration the server runs."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from homunculus.api import infinity_rules
from homunculus.api.monitor_samples import (
    MEMORY_RETENTION_HOURS, RETENTION_DAYS, InMemorySamples, PostgresSamples, Sample, retention_bound,
)
from tests.conftest import TEST_DATABASE_URL, requires_db

T0 = datetime(2026, 10, 27, 9, 0, tzinfo=timezone.utc)


def _sample(i, pid="bed-1", at=None):
    at = at or (T0 + timedelta(minutes=i))
    return Sample(hospital="h1", patient_id=pid, bed_id="b-1", source="10.0.0.5", code="heart_rate",
                  via="hr", value=70.0 + i, unit="bpm", captured_at=at, received_at=at + timedelta(seconds=2))


def _exercise(store):
    store.append(_sample(0))
    store.append_many([])                                   # a pass that took nothing writes nothing
    store.append_many([_sample(1), _sample(2), _sample(0, pid="bed-2")])     # one pass's rows, one write
    rows = store.since("h1", T0 - timedelta(hours=1), now=T0 + timedelta(minutes=5))
    assert [(r.patient_id, r.value) for r in rows] == [("bed-1", 70.0), ("bed-2", 70.0), ("bed-1", 71.0), ("bed-1", 72.0)]
    assert store.since("h2", T0 - timedelta(hours=1), now=T0 + timedelta(minutes=5)) == []
    # Oldest first, and only what is newer than `since`.
    assert [r.value for r in store.since("h1", T0 + timedelta(minutes=1), now=T0 + timedelta(minutes=5))] == [71.0, 72.0]
    # `received_at` is captured_at + 2 s: the two samples at T0 were received at T0+2s, the next at T0+1m02s,
    # so a bound at T0+30s takes exactly the two oldest.
    old = store.prune(before=T0 + timedelta(seconds=30))
    assert old == 2
    assert [r.value for r in store.since("h1", T0 - timedelta(hours=1), now=T0 + timedelta(minutes=5))] == [71.0, 72.0]


def test_in_memory_samples():
    _exercise(InMemorySamples())


def test_the_retention_is_thirty_days():
    assert RETENTION_DAYS == 30
    assert retention_bound(T0) == T0 - timedelta(days=30)


def test_in_memory_the_retention_is_the_replay_window():
    """T6 review: in memory the store held 30 days though nothing reads a sample past the install's
    replay of the last REPLAY_HOURS. It keeps that window and no more — the durable table keeps 30 days."""
    assert MEMORY_RETENTION_HOURS == infinity_rules.REPLAY_HOURS == 24
    assert retention_bound(T0, durable=False) == T0 - timedelta(hours=24)
    assert retention_bound(T0, durable=True) == retention_bound(T0)


def test_only_the_table_is_durable():
    assert InMemorySamples.durable is False and PostgresSamples.durable is True


@requires_db
def test_postgres_samples_through_the_migration():
    from sqlalchemy import text
    store = PostgresSamples(TEST_DATABASE_URL)
    with store._engine.begin() as conn:                           # noqa: SLF001 — test setup
        conn.execute(text("DROP TABLE IF EXISTS monitor_samples"))
    # The migration is loaded and run the way tests/test_audit_postgres.py's `audit_log` fixture does it:
    # `upgrade()` under `Operations.context(MigrationContext.configure(conn))`, which binds alembic's `op`.
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    import importlib.util, pathlib
    path = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0013_monitor_samples.py"
    spec = importlib.util.spec_from_file_location("m0013", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with store._engine.begin() as conn:                           # noqa: SLF001
        with Operations.context(MigrationContext.configure(conn)):
            module.upgrade()
    try:
        _exercise(store)
    finally:
        with store._engine.begin() as conn:                       # noqa: SLF001
            conn.execute(text("DROP TABLE IF EXISTS monitor_samples"))
        store.dispose()

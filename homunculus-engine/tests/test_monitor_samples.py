"""Monitor samples: bulk rows that expire (spec D8). In memory for the API's tests; Postgres under
TEST_DATABASE_URL, through the migration the server runs."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from homunculus.api import infinity_rules
from homunculus.api.monitor_samples import (
    MEMORY_RETENTION_HOURS, RETENTION_DAYS, InMemorySamples, PostgresSamples, Sample, retention_bound,
)
from tests.conftest import TEST_DATABASE_URL, requires_db

MIGRATION_0013 = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0013_monitor_samples.py"

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


def _migration(revision: str):
    """A migration module by its revision, loaded as tests/test_audit_postgres.py loads one."""
    import importlib.util
    (path,) = MIGRATION_0013.parent.glob(f"{revision}_*.py")
    spec = importlib.util.spec_from_file_location(f"m{revision}", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _migrate(conn, *revisions: str, down: bool = False) -> None:
    """`upgrade()` (or `downgrade()`) of each revision, in order, under
    `Operations.context(MigrationContext.configure(conn))` — which binds alembic's `op` — the way
    tests/test_audit_postgres.py's `audit_log` fixture runs 0004 and 0008."""
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    for revision in revisions:
        module = _migration(revision)
        with Operations.context(MigrationContext.configure(conn)):
            (module.downgrade if down else module.upgrade)()


_INDEXES_0013 = {"ix_monitor_samples_hospital_patient_captured": "(hospital, patient_id, captured_at)",
                 "ix_monitor_samples_received": "(received_at)",
                 "ix_audit_tenant_event_id": "(tenant, event_type, id)"}


def _indexes(conn) -> dict[str, str]:
    from sqlalchemy import text
    rows = conn.execute(text("SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'"
                             " AND tablename IN ('monitor_samples', 'audit')")).all()
    return {name: definition for name, definition in rows}


@requires_db
@pytest.mark.skipif(not MIGRATION_0013.exists(), reason="migration 0013 lands after B1a's 0012")
def test_postgres_samples_through_the_migration():
    # Migration 0013 (alembic/versions/0013_monitor_samples.py, down_revision 0012) creates, for this
    # store and the lane:
    #   - `monitor_samples` with an `id` bigserial primary key (`since` orders by captured_at, id);
    #   - the columns the store reads and writes: hospital, patient_id, bed_id, source, code, via,
    #     value, unit, captured_at, received_at (both timestamptz), all NOT NULL;
    #   - an index on (hospital, patient_id, captured_at) — the install's 24 h replay;
    #   - an index on received_at — the hourly prune deletes by it;
    #   - on the `audit` table, an index on (tenant, event_type, id) — the lane reads its two kinds newest
    #     first and /alarm-quality its five (deploy/infinity/README.md, "Migration 0013").
    # The audit table is built first by 0004 and 0008, and dropped after, as the `audit_log` fixture of
    # tests/test_audit_postgres.py does in this same database: 0013 indexes it.
    from sqlalchemy import text
    store = PostgresSamples(TEST_DATABASE_URL)
    with store._engine.begin() as conn:                           # noqa: SLF001 — test setup
        conn.execute(text("DROP TABLE IF EXISTS monitor_samples"))
        conn.execute(text("DROP TABLE IF EXISTS audit CASCADE"))
        _migrate(conn, "0004", "0008", "0013")
    try:
        with store._engine.connect() as conn:                     # noqa: SLF001
            indexes = _indexes(conn)
            columns = {name: (data_type, nullable, default) for name, data_type, nullable, default in conn.execute(text(
                "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns"
                " WHERE table_schema = 'public' AND table_name = 'monitor_samples'")).all()}
        for name, key in _INDEXES_0013.items():
            assert key in indexes[name], (name, indexes.get(name))
        assert set(columns) == {"id", "hospital", "patient_id", "bed_id", "source", "code", "via", "value",
                                "unit", "captured_at", "received_at"}
        assert {nullable for _type, nullable, _default in columns.values()} == {"NO"}
        assert columns["id"][0] == "bigint" and "nextval" in (columns["id"][2] or "")
        assert {columns[c][0] for c in ("captured_at", "received_at")} == {"timestamp with time zone"}
        _exercise(store)
        # The downgrade takes all of it away and leaves the audit itself.
        with store._engine.begin() as conn:                       # noqa: SLF001
            _migrate(conn, "0013", down=True)
            assert not set(_indexes(conn)) & set(_INDEXES_0013)
            assert conn.execute(text("SELECT to_regclass('public.monitor_samples')")).scalar() is None
            assert conn.execute(text("SELECT to_regclass('public.audit')")).scalar() is not None
    finally:
        with store._engine.begin() as conn:                       # noqa: SLF001
            conn.execute(text("DROP TABLE IF EXISTS monitor_samples"))
            conn.execute(text("DROP TABLE IF EXISTS audit CASCADE"))
        store.dispose()

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

import homunculus.api.audit as audit_module
import homunculus.api.audit_postgres as audit_pg_module
from homunculus.api.audit import AuditEvent, AuditLog, InMemoryAuditLog, SqliteAuditLog, id_floor
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


# --- the id floor (G3-05 B10 review) --------------------------------------------------------------
# `records(since=)` casts every row's TEXT `ts` and no index serves it, so a read of "the last 48 hours" walks the
# primary key from the first row. The audit is append-only and its `ts` follows its `id`: `first_id_at_or_after`
# finds the id to read from by a binary search of point reads, and the read is `records(after_id=floor - 1)`.

FLOOR_BASE = datetime(2026, 10, 19, 9, 0, tzinfo=timezone.utc)


def _minutes(monkeypatch, *minutes):
    """The audit's clock (both backends' `_now_iso`), set: the next appends are written at FLOOR_BASE + these minutes."""
    stamps = iter((FLOOR_BASE + timedelta(minutes=m)).isoformat() for m in minutes)
    monkeypatch.setattr(audit_module, "_now_iso", lambda: next(stamps))
    monkeypatch.setattr(audit_pg_module, "_now_iso", lambda: next(stamps))


def _seeded(log, monkeypatch, *minutes):
    _minutes(monkeypatch, *minutes)
    return [log.append(_event()) for _ in minutes]


def _floor_cases(log, monkeypatch):
    """The same checks for every backend: 40 rows a minute apart (ids 1..40, minutes 0..39)."""
    rows = _seeded(log, monkeypatch, *range(40))
    at = lambda minute: FLOOR_BASE + timedelta(minutes=minute)                       # noqa: E731
    # The rows from minute 20 on are ids 21..40; the floor is the first row within the 5-minute margin before that,
    # minute 15 — id 16. Never above the first row wanted, so the read from it misses nothing.
    assert log.first_id_at_or_after(at(20)) == 16
    assert log.first_id_at_or_after(at(20).astimezone(BAKU)) == 16                 # any zone: the same instant
    assert log.first_id_at_or_after(at(5)) == 1                                      # the margin runs out before the start
    assert log.first_id_at_or_after(at(-600)) == 1                                   # older than the whole log
    assert log.first_id_at_or_after(at(39)) == 35                                    # the newest minute, minus the margin
    assert log.first_id_at_or_after(at(600)) == 41                                   # newer than the whole log: nothing
    for minute in (0, 7, 20, 38):                                                    # reading from it loses no row
        floor = log.first_id_at_or_after(at(minute))
        assert ([r.id for r in log.records(since=at(minute), after_id=floor - 1, limit=100)]
                == [r.id for r in log.records(since=at(minute), limit=100)] == [r.id for r in rows if r.id >= minute + 1])
    with pytest.raises(ValueError, match="time zone"):
        log.first_id_at_or_after(datetime(2026, 10, 19, 9, 0))


def test_the_floor_on_every_in_process_backend(log, monkeypatch):
    _floor_cases(log, monkeypatch)


def test_the_floor_of_an_empty_log_is_the_first_id(log):
    assert log.first_id_at_or_after(FLOOR_BASE) == 1


def test_a_row_stamped_a_little_before_its_neighbour_hides_nothing(log, monkeypatch):
    """Two appends racing swap their stamps by milliseconds: the margin keeps the floor under such a row."""
    _seeded(log, monkeypatch, 0, 1, 2, 12, 11, 13, 14)
    assert log.first_id_at_or_after(FLOOR_BASE + timedelta(minutes=12)) <= 4         # ids 4, 6, 7 are at or after 12


def test_sqlite_floor_reads_across_gaps_in_the_ids():
    log = SqliteAuditLog(":memory:")
    for row_id, minute in ((3, 0), (4, 1), (9, 2), (10, 30), (50, 31), (51, 60)):
        log.connection.execute(
            "INSERT INTO audit (id, ts, tenant, event_type, patient_id, subject, payload)"
            " VALUES (?, ?, 'HOSP1', 'first_seen', 'S-001', 'news2', '{}')",
            (row_id, (FLOOR_BASE + timedelta(minutes=minute)).isoformat()))
    log.connection.commit()
    assert log.first_id_at_or_after(FLOOR_BASE + timedelta(minutes=33)) == 10        # minute 28 and on: ids 10, 50, 51
    assert log.first_id_at_or_after(FLOOR_BASE + timedelta(minutes=70)) == 52


def test_the_search_costs_a_logarithm_of_the_log_not_its_length():
    """A thousand rows, a million: the probes are about twenty, never a scan."""
    for n in (1_000, 1_000_000):
        probes = []

        def first_from(mid, n=n):
            probes.append(mid)
            return None if mid > n else (mid, (FLOOR_BASE + timedelta(seconds=mid)).isoformat())
        floor = id_floor(first_from, n, FLOOR_BASE + timedelta(seconds=n // 2))
        assert floor == n // 2 - 300 and len(probes) <= n.bit_length() + 1


def test_the_search_over_ids_with_gaps_and_a_late_enough_unreadable_stamp():
    rows = {1: "2026-10-19T09:00:00+00:00", 5: "2026-10-19T09:10:00+00:00", 9: "nonsense", 12: "2026-10-19T10:00:00+00:00"}

    def first_from(mid):
        later = sorted(i for i in rows if i >= mid)
        return (later[0], rows[later[0]]) if later else None
    assert id_floor(first_from, 12, FLOOR_BASE + timedelta(minutes=30)) == 6         # id 9's stamp cannot be read: late enough


@requires_db
def test_postgres_floor_on_a_seeded_table(pg_log, monkeypatch):
    _floor_cases(pg_log, monkeypatch)


@requires_db
def test_postgres_floor_of_an_empty_table_and_across_gaps(pg_log):
    assert pg_log.first_id_at_or_after(FLOOR_BASE) == 1
    with pg_log._engine.begin() as conn:                   # noqa: SLF001
        for row_id, minute in ((3, 0), (4, 1), (9, 2), (10, 30), (50, 31), (51, 60)):
            conn.execute(text("INSERT INTO audit (id, ts, tenant, event_type, patient_id, subject, payload)"
                              " VALUES (:id, :ts, 'HOSP1', 'first_seen', 'S-001', 'news2', '{}'::jsonb)"),
                         {"id": row_id, "ts": (FLOOR_BASE + timedelta(minutes=minute)).isoformat()})
    assert pg_log.first_id_at_or_after(FLOOR_BASE + timedelta(minutes=33)) == 10
    assert pg_log.first_id_at_or_after(FLOOR_BASE + timedelta(minutes=70)) == 52

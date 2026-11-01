# homunculus-engine/tests/test_device_beds_concurrency.py
"""Two editors at once (spec D10, §4.4, A-22 a-g) and what a change does downstream (§4.8). Each request runs on
its own session (the world's `get_db` override opens one per request), so two requests sent together contend on the
database as two nurses would. Synthetic ward and patients.

THE ORDER IS THE LOCK'S, NOT THE SCHEDULER'S. A race here is `_race(first, second)`: `first` is sent alone and
paused at a fixed point of the transaction, holding what it holds; only then is `second` started, and `first` goes on
only once `second` is SEEN waiting on a lock (`pg_stat_activity`). So `first` wins and `second` meets the world it
left, every run — no sleep, no timing guess. `_queued` says whether `second` was really queued; a request that
slips past (a lock that no longer exists) is a failure of its own, named as such. After each race the rows are read
on a connection of their own: no partial write — one open row per monitor, the newest; every closed row ends where
its successor begins; no bed under two monitors — and the audit and the strip's table reset are those of the winner
alone. The `db_session` schema has no triggers; one test runs the same races on the migrated chain (A-12)."""
from __future__ import annotations

import asyncio
import time
from collections import defaultdict
from contextlib import contextmanager
from datetime import datetime, timezone

import pytest
from alembic import command
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from homunculus.api.patient_identity import IdentityRecord, InMemoryIdentityStore
from homunculus.devicebeds import service
from homunculus.devicebeds.rows import db_time, editor_row
from tests.conftest import TEST_DATABASE_URL, _sync_engine_url, requires_db
from tests.esleme_world import TOKEN, UNIT_OF, URL, esleme_client, group_of, readings, seed
from tests.kabul_world import BOARD, SLUG

pytestmark = [requires_db]
NOW = datetime(2026, 10, 30, 9, 0, tzinfo=timezone.utc)
X, Y, Z = "192.0.2.11", "192.0.2.12", "192.0.2.13"
KEPT = "keeps its history"

#: What a request waiting on a lock is running, as `pg_stat_activity.query` shows it.
BED_LOCK = "%FROM beds%beds.id%FOR NO KEY UPDATE%"       # tenant.router._lock_bed
ROW_LOCK = "%FROM device_beds%FOR UPDATE%"                # rows.current_rows(lock=True)
INSERT = "INSERT INTO device_beds%"                       # an insert held up by another transaction's uncommitted row

CHANGED, SAME, STALE = "changed", "unchanged", "409 mapping_changed"


def replaced(source: str) -> str:
    return f"changed, replaced {source}"


def _bind(client, ward, source, bed_key, device_row=None, bed_row=None, confirm=False):
    return client.post(f"{URL}/bind", headers=ward.auth["admin"], json={
        "source": source, "bed_id": str(ward.beds[bed_key].id), "confirm_occupied": confirm,
        "expected": {"device_row_id": device_row, "bed_row_id": bed_row}})


def _unbind(client, ward, source, device_row, confirm=False):
    return client.post(f"{URL}/unbind", headers=ward.auth["admin"], json={
        "source": source, "confirm_occupied": confirm, "expected": {"device_row_id": device_row}})


def _said(response) -> str:
    """A response in one comparable phrase: `changed`, `changed, replaced <source>`, `unchanged`, or `<status> <code>`."""
    body = response.json()
    if response.status_code != 200:
        return f"{response.status_code} {body['detail']['code']}"
    if not body["changed"]:
        return SAME
    return CHANGED if body["replaced_source"] is None else replaced(body["replaced_source"])


def _spy_reset(app):
    """Wrap `app.state.shadow_table_reset`: one entry per call."""
    calls, original = [], app.state.shadow_table_reset

    def reset():
        calls.append(True)
        original()

    app.state.shadow_table_reset = reset
    return calls


def _read_rows() -> list[tuple]:
    """Every row of `device_beds` — (source, bed_id, valid_from, valid_to) in id order — read on a connection of
    its own, so only what has committed is seen."""
    engine = create_engine(_sync_engine_url(TEST_DATABASE_URL))
    try:
        with engine.connect() as conn:
            return [tuple(r) for r in conn.execute(text(
                "SELECT source, bed_id, valid_from, valid_to FROM device_beds ORDER BY id"))]
    finally:
        engine.dispose()


def _assert_history(ward, expected: list[tuple]) -> None:
    """The database holds exactly `expected` — (source, bed key or None, "open" | "closed"), in any order — and no
    partial write: each monitor has one open row, its newest; each closed row ends where its successor begins; no
    bed is under two open rows."""
    keys = {str(bed.id): key for key, bed in ward.beds.items()}
    rows = _read_rows()
    shaped = [(s, None if b is None else keys[str(b)], "open" if to is None else "closed") for s, b, _, to in rows]
    assert sorted(shaped, key=str) == sorted(expected, key=str)
    chains = defaultdict(list)
    for source, _, valid_from, valid_to in rows:
        chains[source].append((valid_from, valid_to))
    for source, chain in chains.items():
        assert [to is None for _, to in chain] == [False] * (len(chain) - 1) + [True], f"{source}: one open row, the newest"
        assert all(a[1] == b[0] for a, b in zip(chain, chain[1:])), f"{source}: a closed row ends where its successor begins"
    open_beds = [b for _, b, _, to in rows if to is None and b is not None]
    assert len(open_beds) == len(set(open_beds)), "a bed is under two open rows"


async def _queued(db, pattern: str, second: asyncio.Future, timeout: float = 20.0) -> bool:
    """True once a statement like `pattern` is WAITING ON A LOCK in `pg_stat_activity` — `second` is queued. False if
    `second` finished first (it slipped past: nothing held it). The shared database is under contention, hence the
    generous timeout; it is reached only when `second` waits on something else than the lock we expect."""
    sql = text("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() "
               "AND wait_event_type = 'Lock' AND query LIKE :pattern")
    maker = async_sessionmaker(db.bind, expire_on_commit=False)
    try:
        async with asyncio.timeout(timeout):
            while not second.done():
                async with maker() as session:
                    if (await session.execute(sql, {"pattern": pattern})).scalar_one():
                        return True
                await asyncio.sleep(0.02)
    except TimeoutError:
        raise AssertionError(f"the second request neither queued behind a lock like {pattern!r} nor finished in "
                             f"{timeout} s: it waits on something else") from None
    return False


async def _race(db, first, second, *, behind: str = BED_LOCK, at: str = "write", timeout: float = 90.0):
    """Send `first()` alone, pause it at `at`, start `second()` from there and let `first` go on only once `second` is
    seen queued behind a lock like `behind`. `first` and `second` are zero-argument callables returning the awaitable.
    `at`: "write" - `first` holds every lock it takes and has written nothing; "first_bed_lock" - it holds its first
    bed lock and has asked for no other; "commit" - its rows are inserted and not committed.
    Returns `first`'s response, `second`'s, and whether `second` was seen queued."""
    tasks, seen = [], []

    async def start_and_wait():
        task = asyncio.ensure_future(second())
        tasks.append(task)
        seen.append(await _queued(db, behind, task))

    with pytest.MonkeyPatch.context() as patch:
        if at == "first_bed_lock":
            real_lock = service._lock_bed

            async def lock(session, bed_id):
                held = await real_lock(session, bed_id)
                if not tasks:
                    await start_and_wait()
                return held

            patch.setattr(service, "_lock_bed", lock)
        else:
            real_write = service._write

            async def write(session, *args, **kwargs):
                if not tasks:
                    if at == "write":
                        await start_and_wait()
                    else:
                        real_commit = session.commit

                        async def commit():
                            if not tasks:
                                await start_and_wait()
                            return await real_commit()

                        session.commit = commit          # this request's session alone: the pause is its commit
                return await real_write(session, *args, **kwargs)

            patch.setattr(service, "_write", write)
        try:
            one = await asyncio.wait_for(first(), timeout)
            assert tasks, f"the first request never reached its pause point ({at})"
            two = await asyncio.wait_for(tasks[0], timeout)
        finally:
            for task in tasks:
                if not task.done():
                    task.cancel()
    return one, two, seen[0]


async def _run(db, app, ward, first, second, *, said, history, audit, behind=BED_LOCK, at="write"):
    """A race, then everything that must hold after it: `second` was queued by the lock; each request said what
    `said` names; the rows are `history`, soundly; the audit and the strip's reset are the winner's alone."""
    resets = _spy_reset(app)
    one, two, queued = await _race(db, first, second, behind=behind, at=at)
    assert queued, "the second request was not queued behind the lock: the order was not the lock's"
    assert (_said(one), _said(two)) == said
    _assert_history(ward, history)
    assert sorted(r.event_type for r in app.state.audit.records()) == sorted(audit)
    assert len(resets) == (1 if said[0].startswith(CHANGED) else 0)


# --- the task's races, the order forced ---------------------------------------------------------------------------

@pytest.mark.parametrize("holder", [X, Y])
async def test_two_crossed_moves_over_the_same_two_beds_queue_on_the_bed_locks_and_one_wins(db_session, holder):
    """X on bed 1 moves to bed 2 while Y on bed 2 moves to bed 1. Both want the same two beds. Paused after its FIRST
    bed lock, the holder has locked the lower of the two, and the other — asking for the same lower one first, since
    the locks go in id order — queues behind it. Locked in each request's own order they would meet one lock apart
    and deadlock; here the holder takes the second bed, writes and commits, and the other finds the world changed."""
    other = Y if holder == X else X
    async with esleme_client(db_session) as (client, app, ward):
        ids = await seed(db_session, ward, (X, "1", "BED05"), (Y, "2", "BED06"))
        moves = {X: lambda: _bind(client, ward, X, "2", ids[X], ids[Y]),
                 Y: lambda: _bind(client, ward, Y, "1", ids[Y], ids[X])}
        await _run(db_session, app, ward, moves[holder], moves[other], at="first_bed_lock",
                   said=(replaced(other), STALE),
                   history=[(X, "1", "closed"), (Y, "2", "closed"), (other, None, "open"),
                            (holder, {X: "1", Y: "2"}[other], "open")],
                   audit=["device_bed.bind", "device_bed.unbind"])


async def test_two_first_binds_of_a_new_monitor_end_in_one_row_the_partial_index_decides(db_session):
    """Z has no row; one request binds it to bed 1, the other to bed 2 — no bed in common, no row to lock. Paused with
    its row inserted and not committed, the holder makes the other's insert wait on its transaction (the unique
    index on the monitor's current row); when it commits, that insert fires `uq_device_beds_current_source`, which
    is answered `mapping_changed` — with the loser's transaction rolled back."""
    async with esleme_client(db_session) as (client, app, ward):
        await _run(db_session, app, ward, lambda: _bind(client, ward, Z, "1"), lambda: _bind(client, ward, Z, "2"),
                   at="commit", behind=INSERT, said=(CHANGED, STALE), history=[(Z, "1", "open")],
                   audit=["device_bed.bind"])


# --- A-22 a: two monitors to one bed ------------------------------------------------------------------------------

@pytest.mark.parametrize("with_rows", [False, True], ids=["new monitors", "monitors with an unbound row"])
async def test_a_two_monitors_to_one_empty_bed_the_second_finds_a_monitor_there(db_session, with_rows):
    async with esleme_client(db_session) as (client, app, ward):
        ids = await seed(db_session, ward, *([(Y, None, None), (Z, None, None)] if with_rows else []))
        history = [(Y, None, "closed"), (Y, "1", "open"), (Z, None, "open")] if with_rows else [(Y, "1", "open")]
        await _run(db_session, app, ward, lambda: _bind(client, ward, Y, "1", ids.get(Y), None),
                   lambda: _bind(client, ward, Z, "1", ids.get(Z), None), said=(CHANGED, STALE),
                   history=history, audit=["device_bed.bind"])


async def test_a_two_monitors_to_one_held_bed_the_second_finds_the_first_there(db_session):
    """X holds bed 1. Y and Z both ask to replace it, each having seen X's row there. Y goes first, X is unbound; Z's
    `expected` bed row is X's, which is no longer the bed's."""
    async with esleme_client(db_session) as (client, app, ward):
        ids = await seed(db_session, ward, (X, "1", "BED05"), (Y, None, None), (Z, None, None))
        await _run(db_session, app, ward, lambda: _bind(client, ward, Y, "1", ids[Y], ids[X]),
                   lambda: _bind(client, ward, Z, "1", ids[Z], ids[X]), said=(replaced(X), STALE),
                   history=[(X, "1", "closed"), (X, None, "open"), (Y, None, "closed"), (Y, "1", "open"),
                            (Z, None, "open")],
                   audit=["device_bed.bind", "device_bed.unbind"])


# --- A-22 b: one monitor to two beds ------------------------------------------------------------------------------

async def test_b_one_bound_monitor_moved_to_two_beds_at_once_the_beds_it_leaves_serialises_them(db_session):
    """X is on bed 1 and is moved to bed 2 and to bed 3 at once. The targets differ; the bed it LEAVES is common, and
    the lock on it queues the second request, which then finds X already moved."""
    async with esleme_client(db_session) as (client, app, ward):
        ids = await seed(db_session, ward, (X, "1", "BED05"))
        await _run(db_session, app, ward, lambda: _bind(client, ward, X, "2", ids[X]),
                   lambda: _bind(client, ward, X, "3", ids[X]), said=(CHANGED, STALE),
                   history=[(X, "1", "closed"), (X, "2", "open")], audit=["device_bed.bind"])


async def test_b_one_unbound_monitor_moved_to_two_beds_at_once_the_row_lock_serialises_them(db_session):
    """X has a row on no bed: no bed is common to the two requests (2 and 3). What they share is X's current row —
    `FOR UPDATE` on it queues the second, whose locked read then no longer finds the row it expected."""
    async with esleme_client(db_session) as (client, app, ward):
        ids = await seed(db_session, ward, (X, None, None))
        await _run(db_session, app, ward, lambda: _bind(client, ward, X, "2", ids[X]),
                   lambda: _bind(client, ward, X, "3", ids[X]), behind=ROW_LOCK, said=(CHANGED, STALE),
                   history=[(X, None, "closed"), (X, "2", "open")], audit=["device_bed.bind"])


# --- A-22 c: an unbind against the others -------------------------------------------------------------------------

@pytest.mark.parametrize("holder, said, history, audit", [
    ("unbind", (CHANGED, STALE),
     [(X, "1", "closed"), (X, None, "open"), (Y, None, "open")], ["device_bed.unbind"]),
    ("bind", (replaced(X), SAME),
     [(X, "1", "closed"), (X, None, "open"), (Y, None, "closed"), (Y, "1", "open")],
     ["device_bed.bind", "device_bed.unbind"]),
], ids=["the unbind first: the bind finds an empty bed", "the bind first: the unbind finds X already unbound"])
async def test_c_an_unbind_of_x_against_a_bind_of_y_onto_xs_bed(db_session, holder, said, history, audit):
    async with esleme_client(db_session) as (client, app, ward):
        ids = await seed(db_session, ward, (X, "1", "BED05"), (Y, None, None))
        unbind = lambda: _unbind(client, ward, X, ids[X])
        bind = lambda: _bind(client, ward, Y, "1", ids[Y], ids[X])
        first, second = (unbind, bind) if holder == "unbind" else (bind, unbind)
        await _run(db_session, app, ward, first, second, said=said, history=history, audit=audit)


@pytest.mark.parametrize("holder, history, audit", [
    ("unbind", [(X, "1", "closed"), (X, None, "open")], ["device_bed.unbind"]),
    ("bind", [(X, "1", "closed"), (X, "2", "open")], ["device_bed.bind"]),
], ids=["the unbind first: the move finds X unbound", "the move first: the unbind finds X on bed 2"])
async def test_c_an_unbind_of_x_against_a_bind_of_x_elsewhere(db_session, holder, history, audit):
    async with esleme_client(db_session) as (client, app, ward):
        ids = await seed(db_session, ward, (X, "1", "BED05"))
        unbind = lambda: _unbind(client, ward, X, ids[X])
        move = lambda: _bind(client, ward, X, "2", ids[X])
        first, second = (unbind, move) if holder == "unbind" else (move, unbind)
        await _run(db_session, app, ward, first, second, said=(CHANGED, STALE), history=history, audit=audit)


async def test_c_two_identical_unbinds_the_second_answers_unchanged_and_writes_nothing(db_session):
    async with esleme_client(db_session) as (client, app, ward):
        ids = await seed(db_session, ward, (X, "1", "BED05"))
        unbind = lambda: _unbind(client, ward, X, ids[X])
        await _run(db_session, app, ward, unbind, unbind, said=(CHANGED, SAME),
                   history=[(X, "1", "closed"), (X, None, "open")], audit=["device_bed.unbind"])


# --- A-22 d: a replace against a move, and a chain ----------------------------------------------------------------

@pytest.mark.parametrize("holder, said, history, audit", [
    ("replace", (replaced(X), STALE),
     [(X, "1", "closed"), (Y, "2", "closed"), (X, None, "open"), (Y, "1", "open")],
     ["device_bed.bind", "device_bed.unbind"]),
    ("move", (CHANGED, STALE), [(X, "1", "closed"), (X, "3", "open"), (Y, "2", "open")], ["device_bed.bind"]),
], ids=["the replace first: X, now unbound, is not where its move expects", "the move first: bed 1 is empty for the replace"])
async def test_d_y_replaces_x_on_bed_1_while_x_moves_to_a_third_bed(db_session, holder, said, history, audit):
    async with esleme_client(db_session) as (client, app, ward):
        ids = await seed(db_session, ward, (X, "1", "BED05"), (Y, "2", "BED06"))
        replace = lambda: _bind(client, ward, Y, "1", ids[Y], ids[X])
        move = lambda: _bind(client, ward, X, "3", ids[X])
        first, second = (replace, move) if holder == "replace" else (move, replace)
        await _run(db_session, app, ward, first, second, said=said, history=history, audit=audit)


@pytest.mark.parametrize("holder, said, history, audit", [
    ("chain", (replaced(Y), STALE),
     [(X, "1", "closed"), (Y, "2", "closed"), (Y, None, "open"), (X, "2", "open")],
     ["device_bed.bind", "device_bed.unbind"]),
    ("y moves", (CHANGED, STALE), [(X, "1", "open"), (Y, "2", "closed"), (Y, "3", "open")], ["device_bed.bind"]),
], ids=["the chain first: Y, now unbound, is not where its move expects", "Y's move first: bed 2 is empty for the chain"])
async def test_d_the_chain_x_to_bed_2_replacing_y_while_y_moves_to_bed_3(db_session, holder, said, history, audit):
    async with esleme_client(db_session) as (client, app, ward):
        ids = await seed(db_session, ward, (X, "1", "BED05"), (Y, "2", "BED06"))
        chain = lambda: _bind(client, ward, X, "2", ids[X], ids[Y])
        y_moves = lambda: _bind(client, ward, Y, "3", ids[Y])
        first, second = (chain, y_moves) if holder == "chain" else (y_moves, chain)
        await _run(db_session, app, ward, first, second, said=said, history=history, audit=audit)


# --- A-22 e: the same bind twice at once --------------------------------------------------------------------------

@pytest.mark.parametrize("seeds, request_of, first_said, history, audit", [
    ([(X, "1", "BED05")], lambda c, w, i: _bind(c, w, X, "2", i[X]), CHANGED,
     [(X, "1", "closed"), (X, "2", "open")], ["device_bed.bind"]),
    ([], lambda c, w, i: _bind(c, w, Z, "2"), CHANGED, [(Z, "2", "open")], ["device_bed.bind"]),
    ([(X, "1", "BED05"), (Y, "2", "BED06")], lambda c, w, i: _bind(c, w, Y, "1", i[Y], i[X]), replaced(X),
     [(X, "1", "closed"), (Y, "2", "closed"), (X, None, "open"), (Y, "1", "open")],
     ["device_bed.bind", "device_bed.unbind"]),
], ids=["a move", "a first bind", "a replace"])
async def test_e_the_same_bind_twice_at_once_the_second_finds_its_own_change_made(
        db_session, seeds, request_of, first_said, history, audit):
    """A double submit: the second request, queued on the bed lock, finds the monitor already where it asks (spec §4.4
    step 6: judged before `expected`), so it answers `changed: false` — not `mapping_changed`, nothing written twice."""
    async with esleme_client(db_session) as (client, app, ward):
        ids = await seed(db_session, ward, *seeds)
        same = lambda: request_of(client, ward, ids)
        await _run(db_session, app, ward, same, same, said=(first_said, SAME), history=history, audit=audit)


# --- A-22 f: a writer outside the locks, between the locked read and the insert ------------------------------------

@contextmanager
def _slipping_in(db, action):
    """The first request to reach `service._write` - its bed and row locks held, nothing written - is met there by a
    second session that takes no lock: it runs `await action(session)` and commits before the request goes on. That is
    a writer outside these routes (A-22 f, spec §4.4 step 9). Yields a list that is non-empty once it has run."""
    maker, done, real = async_sessionmaker(db.bind, expire_on_commit=False), [], service._write

    async def write(*args, **kwargs):
        if not done:
            done.append(True)
            async with maker() as other:
                await action(other)
                await other.commit()
        return await real(*args, **kwargs)

    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(service, "_write", write)
        yield done


async def _raw_row(session, ward, source, bed_key):
    """An editor row for `source` (on `bed_key`, or on no bed), inserted with no lock taken."""
    t = await db_time(session)
    bed = ward.beds[bed_key] if bed_key else None
    session.add(editor_row(ward.tenant.id, source, group_of(source), 2050, None, bed.label if bed else None,
                           bed.id if bed else None, ward.units[UNIT_OF[bed_key]].id if bed else None, t,
                           ward.users["admin"]))


async def test_f_a_writer_outside_the_locks_takes_the_bed_first_the_move_is_mapping_changed_and_rolled_back(db_session):
    """X moves to bed 2; between the locked read (bed 2 empty) and the insert, Y takes bed 2 outside the locks. The
    insert fires `uq_device_beds_current_bed`: 409 `mapping_changed` - and the close of X's row, flushed before the
    insert, is rolled back with it: X is still on bed 1. No audit, no reset."""
    async with esleme_client(db_session) as (client, app, ward):
        ids = await seed(db_session, ward, (X, "1", "BED05"))
        resets = _spy_reset(app)
        with _slipping_in(db_session, lambda other: _raw_row(other, ward, Y, "2")) as done:
            response = await _bind(client, ward, X, "2", ids[X])
        assert done and _said(response) == STALE
        _assert_history(ward, [(X, "1", "open"), (Y, "2", "open")])
        assert app.state.audit.records() == [] and resets == []


async def test_f_a_writer_outside_the_locks_gives_the_monitor_a_row_first_the_first_bind_is_mapping_changed(db_session):
    """Z has no row, so the request locks none; between its read and its insert Z gets a row outside the locks. The
    insert fires `uq_device_beds_current_source`: 409 `mapping_changed`, nothing of the request's written."""
    async with esleme_client(db_session) as (client, app, ward):
        resets = _spy_reset(app)
        with _slipping_in(db_session, lambda other: _raw_row(other, ward, Z, None)) as done:
            response = await _bind(client, ward, Z, "1")
        assert done and _said(response) == STALE
        _assert_history(ward, [(Z, None, "open")])
        assert app.state.audit.records() == [] and resets == []


# --- A-22 g: a CHECK (or any other) violation is an error, not a refusal (E31) -------------------------------------

def _quiet(app):
    """A client that answers a crash as the 500 a browser would get, instead of raising it into the test."""
    return AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test")


async def _is_an_error_and_writes_nothing(app, ward, make_the_request, history):
    resets = _spy_reset(app)
    async with _quiet(app) as client:
        response = await make_the_request(client)
    assert response.status_code == 500, "an unexpected violation must not be answered as a refusal"
    _assert_history(ward, history)
    assert app.state.audit.records() == [] and resets == []


async def test_g_the_interval_check_firing_on_the_close_is_a_500_and_the_row_stays_open(db_session):
    """`ck_device_beds_interval` (valid_to > valid_from) fails when the close is dated before the row's start: a bug of
    ours or a bad row, never "someone else got in first". It must not tell the screen to read again and repeat."""
    async with esleme_client(db_session) as (_, app, ward):
        ids = await seed(db_session, ward, (X, "1", "BED05"))
        await db_session.execute(text("UPDATE device_beds SET valid_from = :f WHERE id = :i"),
                                 {"f": datetime(2099, 1, 1, tzinfo=timezone.utc), "i": ids[X]})
        await db_session.commit()
        await _is_an_error_and_writes_nothing(app, ward, lambda c: _bind(c, ward, X, "2", ids[X]), [(X, "1", "open")])


async def test_g_the_bed_and_unit_check_firing_on_the_insert_is_a_500_and_the_flushed_close_is_rolled_back(db_session):
    """`ck_device_beds_bed_unit` fails on a new row that has a bed and no unit. The close of the old row was flushed
    first: the error rolls it back, so X is still on bed 1."""
    real = service.editor_row

    def without_a_unit(*args, **kwargs):
        row = real(*args, **kwargs)
        row.unit_id = None
        return row

    async with esleme_client(db_session) as (_, app, ward):
        ids = await seed(db_session, ward, (X, "1", "BED05"))
        with pytest.MonkeyPatch.context() as patch:
            patch.setattr(service, "editor_row", without_a_unit)
            await _is_an_error_and_writes_nothing(app, ward, lambda c: _bind(c, ward, X, "2", ids[X]), [(X, "1", "open")])


async def test_g_a_unique_violation_that_is_not_ours_is_a_500_too(db_session):
    """The same SQLSTATE (23505) as our two indexes' - here the primary key, the id sequence having fallen behind its
    rows - is still not "somebody else's change got in first": only a violation NAMING one of our indexes is."""
    async with esleme_client(db_session) as (_, app, ward):
        await seed(db_session, ward, (X, "1", "BED05"))
        await db_session.execute(text("SELECT setval(pg_get_serial_sequence('device_beds', 'id'), 1, false)"))
        await db_session.commit()
        await _is_an_error_and_writes_nothing(app, ward, lambda c: _bind(c, ward, Z, "2"), [(X, "1", "open")])


# --- §4.8, downstream: the strip and Aşama B follow a change -----------------------------------------------------

def _device(response, source):
    return next(d for d in response.json()["list"]["devices"] if d["source"] == source)


async def test_the_strip_shows_the_move_at_its_next_read_and_a_replaced_monitor_among_the_unassigned(db_session):
    async with esleme_client(db_session) as (client, app, ward):
        ids = await seed(db_session, ward, (X, "1", "BED05"), (Y, "2", "BED06"))
        app.state.shadow_table_reset()          # the app read its (empty) table at start-up, before the rows existed
        board = lambda: client.get("/infinity-shadow/board", headers=BOARD)
        before = (await board()).json()
        moved = await _bind(client, ward, X, "3", ids[X])
        after = (await board()).json()
        replacing = await _bind(client, ward, Y, "3", ids[Y], _device(moved, X)["row_id"])      # X's row is bed 3's
        later = (await board()).json()

    def bed_of(body):
        return {c["source"]: (c["bed_id"], c["bed_label"], c["method"]) for c in body["beds"]}

    assert moved.status_code == replacing.status_code == 200
    assert bed_of(before)[X] == (str(ward.beds["1"].id), "BED05", "central_station_list")
    assert bed_of(after)[X] == (str(ward.beds["3"].id), "3", "editor")
    assert after["table"]["version"] > before["table"]["version"]
    assert after["table"]["sha256"] != before["table"]["sha256"]
    assert bed_of(later)[Y] == (str(ward.beds["3"].id), "3", "editor") and X not in bed_of(later)
    unassigned = {u["source"]: u["reason"] for u in later["unassigned"]}
    assert unassigned[X] == "table_unassigned" and Y not in unassigned              # X has a row on no bed; Z has none
    assert later["table"]["version"] > after["table"]["version"]


async def test_at_stage_rules_the_next_readings_body_links_the_beds_patient_and_an_unbind_ends_the_link(db_session):
    """Aşama B D5 (spec §4.8): the bed card's `link: one` starts the patient's link at the next forwarder body after
    a bind, and the body after the unbind ends it. E5: the real clock - the editor's rows start at the database's `t`,
    and a fake clock earlier than it would not see them. Only the store's SPACING clock (`monotonic`) is the test's:
    the forwarder's 1-s spacing (429 otherwise) is stepped past instead of slept through."""
    identities, tick = InMemoryIdentityStore(), [1000.0]
    async with esleme_client(db_session, stage="rules", sources=(), identities=identities,
                             monotonic=lambda: tick[0]) as (client, app, ward):
        identities.apply(SLUG, IdentityRecord(patient_id="H2600046", given="Ahmet", family="Yılmaz",
                                              source="test", updated_at=NOW, bed_id=str(ward.beds["2"].id)))
        await seed(db_session, ward, (X, "1", "BED05"))        # a valid table: with none, no pass would run at all
        app.state.shadow_table_reset()
        auth = {"Authorization": f"Bearer {TOKEN}"}

        async def forwarder_body():
            tick[0] += 2.0
            now = time.time()
            sent = readings([Z], now)
            sent["devices"][0]["readings"] = [{"parameter": "hr", "value": 72, "unit": "bpm", "valid": True,
                                               "captured_at": now - 0.4}]
            return await client.post("/infinity-shadow/readings", json=sent, headers=auth)

        def linked():
            return "H2600046" in app.state.shadow_lane.linked.get(SLUG, {})

        assert (await client.get("/infinity-shadow/board", headers=BOARD)).json()["table"]["status"] == "ok"
        assert (await forwarder_body()).status_code == 200
        assert not linked()                                                    # no monitor on bed 2 yet
        bound = await _bind(client, ward, Z, "2", confirm=True)
        assert bound.status_code == 200
        assert (await forwarder_body()).status_code == 200
        assert linked()                                                        # Aşama B D5: the link starts
        unbound = await _unbind(client, ward, Z, _device(bound, Z)["row_id"], confirm=True)
        assert unbound.status_code == 200
        assert (await forwarder_body()).status_code == 200
        assert not linked()                                                    # and ends with the unbind


# --- A-12: the races against the real triggers (the migrated chain) ---------------------------------------------

def test_the_races_commit_on_the_migrated_chain_and_the_history_stays_kept(clean_db):
    """The `db_session` schema comes from `create_all`: 0014's three triggers are absent there. Here the schema is built
    by `alembic upgrade head`. Two races run through the history trigger: the crossed replace (the most any race
    writes: two closes and two inserts for the winner), and two moves of an unbound monitor decided by its row lock -
    where, without `FOR UPDATE`, the loser would try to close a row already closed and meet the trigger: an error
    instead of `mapping_changed`. Afterwards what the trigger forbids must still raise."""
    engine, cfg = clean_db
    command.upgrade(cfg, "head")

    async def scenario():
        aengine = create_async_engine(TEST_DATABASE_URL)
        try:
            async with async_sessionmaker(aengine, expire_on_commit=False)() as db:
                async with esleme_client(db) as (client, app, ward):
                    ids = await seed(db, ward, (X, "1", "BED05"), (Y, "2", "BED06"), (Z, None, None))
                    await _run(db, app, ward, lambda: _bind(client, ward, X, "2", ids[X], ids[Y]),
                               lambda: _bind(client, ward, Y, "1", ids[Y], ids[X]), at="first_bed_lock",
                               said=(replaced(Y), STALE),
                               history=[(X, "1", "closed"), (Y, "2", "closed"), (Y, None, "open"), (X, "2", "open"),
                                        (Z, None, "open")],
                               audit=["device_bed.bind", "device_bed.unbind"])
                    one, two, queued = await _race(db, lambda: _bind(client, ward, Z, "3", ids[Z]),
                                                   lambda: _bind(client, ward, Z, "10", ids[Z]), behind=ROW_LOCK)
                    assert queued and (_said(one), _said(two)) == (CHANGED, STALE)
                    _assert_history(ward, [(X, "1", "closed"), (Y, "2", "closed"), (Y, None, "open"), (X, "2", "open"),
                                           (Z, None, "closed"), (Z, "3", "open")])
        finally:
            await aengine.dispose()

    asyncio.run(scenario())
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'device_beds_%'")).scalar_one() == 3
        open_id = conn.execute(text("SELECT id FROM device_beds WHERE valid_to IS NULL ORDER BY id LIMIT 1")).scalar_one()
        closed_id = conn.execute(text("SELECT id FROM device_beds WHERE valid_to IS NOT NULL ORDER BY id LIMIT 1")).scalar_one()
    with pytest.raises(DBAPIError, match=KEPT), engine.begin() as conn:                    # a close at t + 1 h
        conn.execute(text("UPDATE device_beds SET valid_to = clock_timestamp() + interval '1 hour' WHERE id = :i"), {"i": open_id})
    with pytest.raises(DBAPIError, match=KEPT), engine.begin() as conn:                    # an edit of a closed row
        conn.execute(text("UPDATE device_beds SET bed_label = 'x' WHERE id = :i"), {"i": closed_id})
    with pytest.raises(DBAPIError, match=KEPT), engine.begin() as conn:                    # a delete
        conn.execute(text("DELETE FROM device_beds WHERE id = :i"), {"i": closed_id})

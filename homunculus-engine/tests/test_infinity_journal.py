"""The journal's cost must not grow with its queue. Synthetic fixtures only.

On 14.10 both journals held ~50,000 rows (~85 MB of encrypted bodies) and every append,
pending and snapshot scanned the whole events table, two scans per batch on the hub alone
(~389 MB/s of page reads). The deeper the queue, the slower each batch, the deeper the queue:
once a hub outage had filled it, the worker never caught up again.
"""
import pytest

from test_infinity_transport import event, factory, inventory  # noqa: F401
from homunculus.edge.infinity_journal import CapacityError


def _work(journal, action):
    """SQLite virtual-machine steps an action takes, in units of 10. Wall time would flake."""
    steps = [0]
    def tick():
        steps[0] += 1
        return 0
    journal.db.set_progress_handler(tick, 10)
    try:
        action()
    finally:
        journal.db.set_progress_handler(None, 10)
    return steps[0]


def _filled(factory, rows, inv):
    journal = factory()
    for start in range(0, rows, 500):
        journal.append([event(inv, stamp=1000) for _ in range(min(500, rows - start))])
    return journal


def test_an_operation_costs_the_same_whatever_the_depth_of_the_queue(factory):
    inv = inventory()
    shallow, deep = _filled(factory, 20, inv), _filled(factory, 3000, inv)
    for name, action in (("append", lambda j: j.append([event(inv)])),
                         ("pending", lambda j: j.pending(32)),
                         ("ack", lambda j: j.ack([e["id"] for e in j.pending(1)])),
                         ("snapshot", lambda j: j.snapshot())):
        small, large = _work(shallow, lambda: action(shallow)), _work(deep, lambda: action(deep))
        # 150 times the rows; a scan makes this ratio about that large.
        assert large <= 2 * small + 50, (name, small, large)


def test_the_running_totals_always_equal_a_recount(factory):
    now = [1000.0]
    inv = inventory()
    journal = factory(clock=lambda: now[0], retention=60, max_rows=4)
    def recount():
        rows, size = journal.db.execute("SELECT COUNT(*), COALESCE(SUM(size),0) FROM events").fetchone()
        state = journal.snapshot()
        assert (state["rows"], state["encrypted_bytes"]) == (rows, size)
        return rows
    journal.append([event(inv), event(inv)])
    assert recount() == 2
    first = journal.pending(1)[0]["id"]
    journal.ack([first, "not-queued"])
    assert recount() == 1
    with pytest.raises(CapacityError):
        journal.append([event(inv) for _ in range(5)])      # over max_rows: nothing is kept
    assert recount() == 1
    now[0] += 61                                             # the remaining row expires
    journal.append([event(inv)])
    assert recount() == 1 and journal.snapshot()["counters"]["expired"] == 1


def test_an_existing_journal_gains_the_expiry_index_when_opened(tmp_path):
    from cryptography.fernet import Fernet
    from homunculus.edge.infinity_journal import Journal
    key = Fernet.generate_key()
    journal = Journal(tmp_path / "old.sqlite", key)
    journal.append([event()])
    journal.db.execute("DROP INDEX IF EXISTS events_created")    # as written by the old code
    journal.db.commit()
    journal.close()
    reopened = Journal(tmp_path / "old.sqlite", key)
    try:
        names = {row[0] for row in reopened.db.execute("SELECT name FROM sqlite_master WHERE type='index'")}
        assert "events_created" in names
        state = reopened.snapshot()
        assert state["rows"] == 1 and state["encrypted_bytes"] > 0     # totals rebuilt on open
    finally:
        reopened.close()

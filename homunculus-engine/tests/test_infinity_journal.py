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


def test_a_row_exactly_at_the_retention_cutoff_is_kept(factory):
    # Review of R2, M1: "<" against "<=" in the expiry survived every test.
    now = [1000.0]
    inv = inventory()
    journal = factory(clock=lambda: now[0], retention=60)
    journal.append([event(inv), event(inv)])
    journal.quarantine([journal.pending(1)[0]["id"]], 400)
    held = lambda: journal.db.execute("SELECT COUNT(*) FROM quarantine").fetchone()[0]
    now[0] = 1060.0                                           # exactly the retention: kept
    assert journal.snapshot()["rows"] == 1 and held() == 1
    now[0] = 1060.001                                         # a moment later: gone, both kinds
    assert journal.snapshot()["rows"] == 0 and held() == 0


def test_a_failure_after_the_commit_cannot_skew_the_totals(factory):
    # Review of R2, M2: the totals moved only after the commit's own bookkeeping, so anything
    # raising in between left committed rows uncounted, and the capacity check drifted for good.
    class FailsOnceAfterCommit:
        armed = True

        @staticmethod
        def clock():
            return 0.0

        def since(self, name, started):
            if name == "commit_ms" and self.armed:
                self.armed = False
                raise RuntimeError("synthetic failure after the commit")
    journal = factory(timings=FailsOnceAfterCommit())
    with pytest.raises(RuntimeError):
        journal.append([event()])
    rows, size = journal.db.execute("SELECT COUNT(*), COALESCE(SUM(size),0) FROM events").fetchone()
    assert rows == 1 and (journal.rows, journal.bytes) == (rows, size)


def test_set_aside_rows_count_against_the_caps_until_they_expire(tmp_path):
    # Review of R2, M3: the set-aside table sat outside the caps, so a hub refusing everything
    # could double the file. Its rows now count against the same caps until they expire.
    from cryptography.fernet import Fernet
    from homunculus.edge.infinity_journal import Journal
    now = [1000.0]
    inv = inventory()
    key = Fernet.generate_key()
    journal = Journal(tmp_path / "caps.sqlite", key, clock=lambda: now[0], retention=60, max_rows=3)
    def held():
        recount = journal.db.execute("SELECT COUNT(*), COALESCE(SUM(size),0) FROM quarantine").fetchone()
        assert (journal.held_rows, journal.held_bytes) == recount
        return recount[0]
    try:
        journal.append([event(inv), event(inv)])
        journal.quarantine([e["id"] for e in journal.pending(2)], 400)
        assert journal.snapshot()["rows"] == 0 and held() == 2    # the queue is empty, the file is not
        with pytest.raises(CapacityError):
            journal.append([event(inv), event(inv)])
        journal.append([event(inv)])
        journal.close()
        journal = Journal(tmp_path / "caps.sqlite", key, clock=lambda: now[0], retention=60, max_rows=3)
        assert held() == 2                                         # rebuilt on open
        with pytest.raises(CapacityError):
            journal.append([event(inv)])
        now[0] += 61                                               # everything expires
        journal.append([event(inv), event(inv), event(inv)])
        assert held() == 0 and journal.snapshot()["rows"] == 3
    finally:
        journal.close()


def test_the_journal_commits_through_a_wal_with_a_full_sync(factory):
    # dalga-perf-2: DELETE mode copied every changed page into a -journal file, synced it, wrote
    # the pages again and synced the database: 82.6 % of the VM's writes on 08.11 (IO-1). WAL
    # writes them once; FULL keeps «ack only after commit».
    journal = factory()
    assert journal.mode == "wal"
    assert journal.db.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    assert journal.db.execute("PRAGMA synchronous").fetchone()[0] == 2      # FULL
    journal.append([event()])
    assert journal.snapshot()["rows"] == 1


def test_a_journal_the_old_code_wrote_turns_wal_on_open_and_keeps_its_rows(tmp_path):
    import sqlite3
    from cryptography.fernet import Fernet
    from homunculus.edge.infinity_journal import Journal
    key = Fernet.generate_key()
    path = tmp_path / "archive.sqlite"
    journal = Journal(path, key)
    journal.append([event(), event()])
    journal.close()
    old = sqlite3.connect(path)                     # what the previous release does on open
    assert old.execute("PRAGMA journal_mode=DELETE").fetchone()[0] == "delete"
    old.close()
    assert not (tmp_path / "archive.sqlite-wal").exists()
    reopened = Journal(path, key)
    try:
        assert reopened.mode == "wal"
        assert reopened.snapshot()["rows"] == 2
    finally:
        reopened.close()


def test_the_old_code_takes_a_crash_left_wal_journal_back_with_every_committed_row(tmp_path):
    # The rollback (G-1) is the previous release: it sets DELETE on open. The hub may have been
    # stopped without a close, so the -wal still holds commits the database file has not got yet.
    import shutil
    import sqlite3
    from cryptography.fernet import Fernet
    from homunculus.edge.infinity_journal import Journal
    key = Fernet.generate_key()
    live, crashed = tmp_path / "live", tmp_path / "crashed"
    live.mkdir()
    crashed.mkdir()
    journal = Journal(live / "archive.sqlite", key)
    try:
        journal.db.execute("PRAGMA wal_autocheckpoint=0")    # every commit stays in the -wal
        for _ in range(3):
            journal.append([event()])
        assert (live / "archive.sqlite-wal").stat().st_size > 0
        for name in ("archive.sqlite", "archive.sqlite-wal"):  # the files as a kill leaves them
            shutil.copy(live / name, crashed / name)
    finally:
        journal.close()
    old = sqlite3.connect(crashed / "archive.sqlite")
    try:
        assert old.execute("PRAGMA journal_mode=DELETE").fetchone()[0] == "delete"
        assert old.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 3
    finally:
        old.close()
    assert not (crashed / "archive.sqlite-wal").exists()


def test_where_wal_is_not_available_the_journal_keeps_the_old_mode_and_says_so(caplog):
    from homunculus.edge.infinity_journal import _enter_wal

    class NoWal:                                     # SQLite answers with the mode it kept
        def execute(self, sql):
            assert sql == "PRAGMA journal_mode=WAL"
            return self

        def fetchone(self):
            return ("delete",)
    with caplog.at_level("WARNING", logger="homunculus.edge.infinity_journal"):
        assert _enter_wal(NoWal()) == "delete"
    assert "delete" in caplog.text and "WAL" in caplog.text

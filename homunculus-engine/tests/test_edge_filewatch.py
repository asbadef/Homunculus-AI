"""Finding unprocessed NCE session files, in the order they were written.

The share is mounted read-only, so progress cannot be recorded by moving or renaming a file the way
a file feeder normally would. The ledger here is the only record that a session was forwarded.
"""
from __future__ import annotations

from homunculus.edge.filewatch import ProcessedLedger, pending_files, session_epoch

REAL_NAME = "TCP_10.10.98.229_35900-1787921687-24464-DeviceSession.xml"


def test_epoch_is_read_from_the_session_filename():
    assert session_epoch(REAL_NAME) == 1787921687


def test_a_name_carrying_no_epoch_yields_none():
    """NCE's own config files live in the same tree; they are not sessions."""
    assert session_epoch("NCEConfig.xml") is None


def test_record_then_seen_round_trips(tmp_path):
    ledger = ProcessedLedger(tmp_path / "ledger.db")

    ledger.record(REAL_NAME, size=4096, mtime=1787921687)

    assert ledger.seen(REAL_NAME, size=4096, mtime=1787921687) is True


def test_the_ledger_survives_a_restart(tmp_path):
    path = tmp_path / "ledger.db"
    first = ProcessedLedger(path)
    first.record(REAL_NAME, size=4096, mtime=1787921687)
    first.close()

    second = ProcessedLedger(path)

    assert second.seen(REAL_NAME, size=4096, mtime=1787921687) is True


def test_first_start_epoch_is_sticky_across_restarts(tmp_path):
    path = tmp_path / "ledger.db"
    first = ProcessedLedger(path)
    assert first.first_start_epoch(1787921620) == 1787921620
    assert first.first_start_epoch(1787999999) == 1787921620   # later boots do not move it
    first.close()

    reopened = ProcessedLedger(path)
    assert reopened.first_start_epoch(1788000000) == 1787921620


def test_a_file_that_grew_after_we_read_it_is_offered_again(tmp_path):
    """Keying on the name alone would skip appended content forever, invisibly."""
    ledger = ProcessedLedger(tmp_path / "ledger.db")
    ledger.record(REAL_NAME, size=4096, mtime=1787921687)

    assert ledger.seen(REAL_NAME, size=8192, mtime=1787921700) is False


def _write(directory, name, body="<S/>"):
    path = directory / name
    path.write_text(body, encoding="utf-8")
    return path


def test_files_come_back_oldest_first(tmp_path):
    _write(tmp_path, "TCP_10.0.0.1_35900-1787921687-2-DeviceSession.xml")
    _write(tmp_path, "TCP_10.0.0.1_35900-1787921620-1-DeviceSession.xml")
    # the ledger lives OUTSIDE the scanned directory — in production it sits next to the buffer, not on the share
    ledger = ProcessedLedger(str(tmp_path) + "-ledger.db")

    found = pending_files(tmp_path, ledger)

    assert [f.epoch for f in found] == [1787921620, 1787921687]


def test_a_recorded_file_is_skipped(tmp_path):
    path = _write(tmp_path, "TCP_10.0.0.1_35900-1787921620-1-DeviceSession.xml")
    ledger = ProcessedLedger(str(tmp_path) + "-ledger.db")
    stat = path.stat()
    ledger.record(path.name, stat.st_size, int(stat.st_mtime))

    assert pending_files(tmp_path, ledger) == []


def test_since_excludes_older_sessions(tmp_path):
    _write(tmp_path, "TCP_10.0.0.1_35900-1787921620-1-DeviceSession.xml")
    _write(tmp_path, "TCP_10.0.0.1_35900-1787921687-2-DeviceSession.xml")
    ledger = ProcessedLedger(str(tmp_path) + "-ledger.db")

    found = pending_files(tmp_path, ledger, since_epoch=1787921687)

    assert [f.epoch for f in found] == [1787921687]


def test_a_file_with_no_epoch_sorts_last_but_is_not_dropped(tmp_path):
    """An unreadable name is not a reason to lose a reading."""
    _write(tmp_path, "TCP_10.0.0.1_35900-1787921620-1-DeviceSession.xml")
    _write(tmp_path, "odd-name.xml")
    ledger = ProcessedLedger(str(tmp_path) + "-ledger.db")

    found = pending_files(tmp_path, ledger)

    assert [f.name for f in found] == [
        "TCP_10.0.0.1_35900-1787921620-1-DeviceSession.xml",
        "odd-name.xml",
    ]


def test_a_missing_directory_yields_nothing_rather_than_raising(tmp_path):
    """A mount that has dropped must not kill the loop; it may come back on its own."""
    ledger = ProcessedLedger(str(tmp_path) + "-ledger.db")

    assert pending_files(tmp_path / "not-mounted", ledger) == []


def test_limit_keeps_the_oldest_not_an_arbitrary_slice(tmp_path):
    _write(tmp_path, "TCP_10.0.0.1_35900-1787921620-1-DeviceSession.xml")
    _write(tmp_path, "TCP_10.0.0.1_35900-1787921687-2-DeviceSession.xml")
    _write(tmp_path, "TCP_10.0.0.1_35900-1787921700-3-DeviceSession.xml")
    ledger = ProcessedLedger(str(tmp_path) + "-ledger.db")

    found = pending_files(tmp_path, ledger, limit=2)

    assert [f.epoch for f in found] == [1787921620, 1787921687]


def test_the_ledger_file_itself_is_never_offered(tmp_path):
    ledger = ProcessedLedger(tmp_path / "ledger.db")
    _write(tmp_path, "TCP_10.0.0.1_35900-1787921620-1-DeviceSession.xml")

    found = pending_files(tmp_path, ledger)

    assert [f.name for f in found] == ["TCP_10.0.0.1_35900-1787921620-1-DeviceSession.xml"]


def test_count_reflects_recorded_files(tmp_path):
    ledger = ProcessedLedger(str(tmp_path) + "-ledger.db")

    ledger.record("a.xml", size=1, mtime=1787921620)
    ledger.record("b.xml", size=2, mtime=1787921687)
    assert ledger.count() == 2

    ledger.record("a.xml", size=1, mtime=1787921620)
    assert ledger.count() == 2


def test_a_dropped_mount_warns(tmp_path, caplog):
    ledger = ProcessedLedger(str(tmp_path) + "-ledger.db")

    with caplog.at_level("WARNING"):
        pending_files(tmp_path / "not-mounted", ledger)

    assert any("unreadable" in record.message for record in caplog.records)

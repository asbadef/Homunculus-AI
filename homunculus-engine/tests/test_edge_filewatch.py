"""Finding unprocessed NCE session files, in the order they were written.

The share is mounted read-only, so progress cannot be recorded by moving or renaming a file the way
a file feeder normally would. The ledger here is the only record that a session was forwarded.
"""
from __future__ import annotations

from homunculus.edge.filewatch import ProcessedLedger, session_epoch

REAL_NAME = "TCP_10.10.98.229_35900-1787921687-24464-DeviceSession.xml"


def test_epoch_is_read_from_the_session_filename():
    assert session_epoch(REAL_NAME) == 1787921687


def test_a_name_carrying_no_epoch_yields_none():
    """NCE's own config files live in the same tree; they are not sessions."""
    assert session_epoch("NCEConfig.xml") is None


def test_a_recorded_file_is_not_offered_again(tmp_path):
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


def test_a_file_that_grew_after_we_read_it_is_offered_again(tmp_path):
    """Keying on the name alone would skip appended content forever, invisibly."""
    ledger = ProcessedLedger(tmp_path / "ledger.db")
    ledger.record(REAL_NAME, size=4096, mtime=1787921687)

    assert ledger.seen(REAL_NAME, size=8192, mtime=1787921700) is False

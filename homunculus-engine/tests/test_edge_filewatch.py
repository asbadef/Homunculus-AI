"""Finding unprocessed NCE session files, in the order they were written.

The share is mounted read-only, so progress cannot be recorded by moving or renaming a file the way
a file feeder normally would. The ledger here is the only record that a session was forwarded.
"""
from __future__ import annotations

from homunculus.edge.filewatch import session_epoch

REAL_NAME = "TCP_10.10.98.229_35900-1787921687-24464-DeviceSession.xml"


def test_epoch_is_read_from_the_session_filename():
    assert session_epoch(REAL_NAME) == 1787921687


def test_a_name_carrying_no_epoch_yields_none():
    """NCE's own config files live in the same tree; they are not sessions."""
    assert session_epoch("NCEConfig.xml") is None

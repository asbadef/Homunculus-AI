# tests/test_run_nce_bridge.py
"""parse_since: the runner's --since parsing. The default window (no --since, no --all) is decided
by ProcessedLedger.first_start_epoch, not here — see tests/test_edge_filewatch.py.

scripts/ is not an importable package, so the module is loaded by file path — the same technique
tests/test_audit_postgres.py uses for migration modules (tests/scripts_record_demo.py wraps it in a
reusable shim for two call sites; here there is only one, so the loading is inline).
"""
import importlib.util
import pathlib
from datetime import datetime, timezone

import pytest

_spec = importlib.util.spec_from_file_location(
    "run_nce_bridge", pathlib.Path(__file__).resolve().parents[1] / "scripts" / "run_nce_bridge.py")
run_nce_bridge = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(run_nce_bridge)
parse_since = run_nce_bridge.parse_since


def test_a_date_only_since_is_taken_as_utc():
    assert parse_since("2026-08-01") == int(
        datetime(2026, 8, 1, tzinfo=timezone.utc).timestamp()
    )


def test_an_explicit_offset_is_honoured_not_clobbered():
    assert parse_since("2026-08-01T00:00:00+03:00") == int(
        datetime(2026, 7, 31, 21, 0, 0, tzinfo=timezone.utc).timestamp()
    )


def test_no_flag_returns_none_so_the_ledger_decides():
    assert parse_since("") is None


def test_a_malformed_since_names_the_flag():
    with pytest.raises(SystemExit) as caught:
        parse_since("bugün")

    assert "--since" in str(caught.value)

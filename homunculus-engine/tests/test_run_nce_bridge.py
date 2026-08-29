# tests/test_run_nce_bridge.py
"""parse_since: the runner's --since / --all window logic.

scripts/ is not an importable package, so the module is loaded by file path — the same technique
tests/test_audit_postgres.py uses for migration modules (tests/scripts_record_demo.py wraps it in a
reusable shim for two call sites; here there is only one, so the loading is inline).
"""
import importlib.util
import pathlib
from datetime import datetime, timezone

_spec = importlib.util.spec_from_file_location(
    "run_nce_bridge", pathlib.Path(__file__).resolve().parents[1] / "scripts" / "run_nce_bridge.py")
run_nce_bridge = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(run_nce_bridge)
parse_since = run_nce_bridge.parse_since


def test_a_date_only_since_is_taken_as_utc():
    assert parse_since("2026-08-01", False) == int(
        datetime(2026, 8, 1, tzinfo=timezone.utc).timestamp()
    )


def test_an_explicit_offset_is_honoured_not_clobbered():
    assert parse_since("2026-08-01T00:00:00+03:00", False) == int(
        datetime(2026, 7, 31, 21, 0, 0, tzinfo=timezone.utc).timestamp()
    )


def test_default_is_now_and_all_lifts_the_bound():
    assert parse_since("", True) is None

    now = int(datetime.now(tz=timezone.utc).timestamp())
    assert abs(parse_since("", False) - now) <= 5

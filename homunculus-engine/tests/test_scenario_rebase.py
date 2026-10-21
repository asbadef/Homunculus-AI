"""`rebased()`: a scenario moved in time, for a replay the trend charts can draw.

The scenarios are written at fixed dates (2026-07-14, 2026-09-08) and the charts' window ends at the
server's now, so an unmoved replay into a local stack draws an empty chart. Moved, every gap between
two events is kept, only the dates change. Synthetic data only, like the scenarios themselves.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

import homunculus.scenarios
from homunculus.scenarios.loader import load_scenario, rebased

SCEN = Path(homunculus.scenarios.__file__).parent
SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "replay.py"
END = datetime(2026, 10, 19, 9, 0, tzinfo=timezone.utc)


def test_the_last_event_lands_at_the_end_and_every_gap_is_kept():
    events = load_scenario(SCEN / "news2_deterioration.yaml")
    moved = rebased(events, END)
    assert moved[-1][0] == END
    assert [b[0] - a[0] for a, b in zip(moved, moved[1:])] == [b[0] - a[0] for a, b in zip(events, events[1:])]


def test_the_resource_carries_the_moved_instant_and_the_original_is_untouched():
    events = load_scenario(SCEN / "septic_shock.yaml")
    before = events[0][1]["effectiveDateTime"]
    moved = rebased(events, END)
    assert moved[0][1]["effectiveDateTime"] == moved[0][0].isoformat()
    assert events[0][1]["effectiveDateTime"] == before
    assert moved[0][1]["valueQuantity"] == events[0][1]["valueQuantity"]


def test_an_empty_scenario_stays_empty_and_a_zone_less_end_is_refused():
    assert rebased([], END) == []
    with pytest.raises(ValueError, match="time zone"):
        rebased(load_scenario(SCEN / "stable_control.yaml"), datetime(2026, 10, 19, 9, 0))


def test_the_replay_script_reads_its_token_from_the_environment_never_its_command_line():
    """A token on a command line lands in a shell's history and in every process listing."""
    source = SCRIPT.read_text(encoding="utf-8")
    assert '"--token-env"' in source and '"--token"' not in source
    assert '"--now"' in source and "rebased(" in source

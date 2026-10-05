# homunculus-engine/tests/test_session_policy.py
"""SCREEN_LOCK_IDLE_MINUTES and SCREEN_LOCK_SIGNOUT_HOURS: the dashboard's idle lock, and how long
a browser may stay locked before it signs itself out — the hospital's to set (plan G1 Wave 2,
decision 2). A value the API cannot use falls back to the default with a warning — a typo must
neither stop the API nor leave a ward PC that never locks, or a lock that never ends."""
from __future__ import annotations

import logging

import pytest

from homunculus.auth.session_policy import (
    SCREEN_LOCK_DEFAULT_MINUTES, SCREEN_LOCK_MAX_MINUTES, SCREEN_LOCK_MIN_MINUTES,
    SCREEN_LOCK_SIGNOUT_DEFAULT_HOURS, SCREEN_LOCK_SIGNOUT_MAX_HOURS, SCREEN_LOCK_SIGNOUT_MIN_HOURS,
    lock_signout_hours, screen_lock_minutes,
)

SETTINGS = [
    ("SCREEN_LOCK_IDLE_MINUTES", screen_lock_minutes, SCREEN_LOCK_DEFAULT_MINUTES,
     SCREEN_LOCK_MIN_MINUTES, SCREEN_LOCK_MAX_MINUTES),
    ("SCREEN_LOCK_SIGNOUT_HOURS", lock_signout_hours, SCREEN_LOCK_SIGNOUT_DEFAULT_HOURS,
     SCREEN_LOCK_SIGNOUT_MIN_HOURS, SCREEN_LOCK_SIGNOUT_MAX_HOURS),
]


def test_the_defaults_and_ranges_are_the_plans():
    assert (SCREEN_LOCK_DEFAULT_MINUTES, SCREEN_LOCK_MIN_MINUTES,
            SCREEN_LOCK_MAX_MINUTES) == (10, 1, 60)
    assert (SCREEN_LOCK_SIGNOUT_DEFAULT_HOURS, SCREEN_LOCK_SIGNOUT_MIN_HOURS,
            SCREEN_LOCK_SIGNOUT_MAX_HOURS) == (12, 1, 72)


@pytest.mark.parametrize("name,read,default,low,high", SETTINGS)
def test_unset_or_blank_is_the_default_without_a_warning(name, read, default, low, high, caplog):
    with caplog.at_level(logging.WARNING):
        assert read({}) == default
        assert read({name: "  "}) == default
    assert caplog.records == []


@pytest.mark.parametrize("name,read,default,low,high", SETTINGS)
def test_a_whole_number_in_range_is_taken(name, read, default, low, high):
    assert read({name: str(low)}) == low
    assert read({name: f" {high} "}) == high
    assert read({name: str(default + 1)}) == default + 1


@pytest.mark.parametrize("name,read,default,low,high", SETTINGS)
@pytest.mark.parametrize("raw", ["0", "-5", "1440", "10.5", "on", "10m"])
def test_anything_else_is_the_default_and_a_warning(name, read, default, low, high, raw, caplog):
    with caplog.at_level(logging.WARNING, logger="homunculus.auth.session_policy"):
        assert read({name: raw}) == default
    [record] = caplog.records
    assert record.getMessage().startswith(name)
    assert f"{low} to {high}" in record.getMessage()


@pytest.mark.parametrize("name,read,default,low,high", SETTINGS)
def test_one_past_either_end_is_refused(name, read, default, low, high, caplog):
    with caplog.at_level(logging.WARNING, logger="homunculus.auth.session_policy"):
        assert read({name: str(low - 1)}) == default
        assert read({name: str(high + 1)}) == default
    assert len(caplog.records) == 2

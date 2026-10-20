"""`thin()`: at most N readings of a series, keeping its shape, for a chart and never for a rule.

Today's spot-check data never reaches the cap, and below it the series must come back untouched.
Stage B's 5-second data would be 51 840 readings per channel over 72 hours; thinned, each of
`max_points // 4` equal slices of the series' span keeps its first, last, lowest and highest
reading — the lowest because the reading a clinician must not lose is the worst one.
"""
from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone

import pytest

from homunculus.canonical import Observation, SignalCode
from homunculus.state.timeline import thin

T0 = datetime(2026, 10, 19, 9, 0, tzinfo=timezone.utc)


def _obs(seconds: float, value: float) -> Observation:
    return Observation("S-001", SignalCode.SPO2, value, "%", T0 + timedelta(seconds=seconds), "test")


def _slices(series: list[Observation], buckets: int) -> list[list[Observation]]:
    """The series cut into `buckets` equal slices of its time span, as the docstring defines them."""
    t0 = series[0].timestamp
    span = (series[-1].timestamp - t0).total_seconds()
    out: list[list[Observation]] = [[] for _ in range(buckets)]
    for obs in series:
        at = 0 if span <= 0 else min(buckets - 1,
                                     int((obs.timestamp - t0).total_seconds() / span * buckets))
        out[at].append(obs)
    return [part for part in out if part]


def test_at_or_below_the_cap_the_series_comes_back_whole():
    series = [_obs(i * 60, 96 + i % 3) for i in range(2000)]
    kept = thin(series, 2000)
    assert kept == series
    assert kept is not series                 # a copy: the caller may not mutate the state's list


def test_an_empty_series_stays_empty():
    assert thin([], 2000) == []


def test_a_cap_below_four_is_refused():
    with pytest.raises(ValueError, match="at least 4"):
        thin([_obs(0, 96)], 3)


@pytest.mark.parametrize("seed", range(10))
def test_a_long_series_keeps_its_shape(seed):
    rng = random.Random(seed)
    n = rng.randint(2001, 6000)
    seconds = sorted(rng.uniform(0, 72 * 3600) for _ in range(n))
    if seed % 2:                              # repeated instants happen (two channels, one message)
        seconds = sorted(seconds + seconds[: n // 10])
    series = [_obs(s, round(rng.uniform(80, 100), 1)) for s in seconds]

    kept = thin(series, 2000)

    assert len(kept) <= 2000
    # A subsequence of the series, in its order: no reading invented, none moved.
    positions = [next(i for i, o in enumerate(series) if o is k) for k in kept]
    assert positions == sorted(positions) and len(set(positions)) == len(positions)
    assert kept[0] is series[0] and kept[-1] is series[-1]
    held = {id(o) for o in kept}
    for part in _slices(series, 2000 // 4):
        assert id(part[0]) in held and id(part[-1]) in held
        assert min(o.value for o in part) in {o.value for o in part if id(o) in held}
        assert max(o.value for o in part) in {o.value for o in part if id(o) in held}


def test_a_desaturation_survives_three_days_of_five_second_data():
    """Acceptance 2 (spec §12): a synthetic 5 s series thins to at most 2 000 points — and the one
    reading that matters is still there."""
    series = [_obs(i * 5, 96.0) for i in range(72 * 3600 // 5)]
    assert len(series) == 51_840
    series[30_000] = _obs(30_000 * 5, 85.0)

    kept = thin(series, 2000)

    assert len(kept) <= 2000
    assert 85.0 in [o.value for o in kept]


def test_readings_that_share_one_instant_fall_in_one_slice():
    series = [_obs(0, 90 + i % 7) for i in range(3000)]
    kept = thin(series, 2000)
    assert len(kept) <= 4
    assert {o.value for o in kept} >= {90, 96}

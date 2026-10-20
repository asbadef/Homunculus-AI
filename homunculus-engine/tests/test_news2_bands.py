"""NEWS2's bands are data, and the score reads them.

The trend charts draw these rows as bands (api/trends.py); the rules score with them. ONE table, so
a band on a chart and a point in the score can never disagree. Moving the five scored vitals from
if-chains to that table must move no score at all, so the if-chains are kept below, verbatim, as
the reference: every value on a dense grid, every boundary and both sides of it, the infinities and
NaN score exactly what they scored before.
"""
from __future__ import annotations

import math
from pathlib import Path

import pytest

from homunculus.rules import news2
from homunculus.rules.news2 import BANDS_SOURCE, NEWS2_BANDS, Band

VAULT = Path(__file__).resolve().parents[2] / "Homunculus" / "wiki"


# --- the five functions as they were before the table (rules/news2.py at b6ed65d) ---------------

def _old_resp(rr):
    if rr <= 8:
        return 3
    if rr <= 11:
        return 1
    if rr <= 20:
        return 0
    if rr <= 24:
        return 2
    return 3


def _old_spo2(spo2):
    if spo2 <= 91:
        return 3
    if spo2 <= 93:
        return 2
    if spo2 <= 95:
        return 1
    return 0


def _old_sbp(sbp):
    if sbp <= 90:
        return 3
    if sbp <= 100:
        return 2
    if sbp <= 110:
        return 1
    if sbp <= 219:
        return 0
    return 3


def _old_pulse(hr):
    if hr <= 40:
        return 3
    if hr <= 50:
        return 1
    if hr <= 90:
        return 0
    if hr <= 110:
        return 1
    if hr <= 130:
        return 2
    return 3


def _old_temp(temp):
    if temp <= 35.0:
        return 3
    if temp <= 36.0:
        return 1
    if temp <= 38.0:
        return 0
    if temp <= 39.0:
        return 1
    return 2


# parameter, the function under test, its reference, and the range a dense grid covers
CASES = [
    ("respiration_rate", news2.resp_rate_points, _old_resp, (0, 60)),
    ("spo2", news2.spo2_scale1_points, _old_spo2, (50, 100)),
    ("systolic_bp", news2.systolic_bp_points, _old_sbp, (40, 300)),
    ("pulse", news2.pulse_points, _old_pulse, (0, 250)),
    ("temperature", news2.temperature_points, _old_temp, (30, 45)),
]
IDS = [name for name, *_ in CASES]


def test_the_table_holds_the_five_scored_vitals_and_scale_1_only():
    assert set(NEWS2_BANDS) == {"respiration_rate", "spo2", "systolic_bp", "pulse", "temperature"}
    assert set(NEWS2_BANDS) == set(news2._CORE_VITALS)
    # Scale 2 is deliberately not implemented (module docstring): no row of it may appear here.
    assert not [name for name in NEWS2_BANDS if "scale2" in name or "scale_2" in name]


@pytest.mark.parametrize("parameter", IDS)
def test_the_rows_tile_the_line_with_no_gap_and_no_overlap(parameter):
    rows = NEWS2_BANDS[parameter]
    assert rows[0].low is None and rows[-1].high is None
    for before, after in zip(rows, rows[1:]):
        assert after.low == before.high, (before, after)
    highs = [row.high for row in rows[:-1]]
    assert highs == sorted(highs) and len(set(highs)) == len(highs)


@pytest.mark.parametrize(("parameter", "fn", "reference", "span"), CASES, ids=IDS)
def test_every_value_scores_what_the_if_chain_scored(parameter, fn, reference, span):
    lo, hi = span
    grid = [i / 20 for i in range(lo * 20, hi * 20 + 1)]
    edges = [row.high for row in NEWS2_BANDS[parameter] if row.high is not None]
    around = [edge + d for edge in edges for d in (-1e-9, 0.0, 1e-9)]
    for value in grid + around + [-math.inf, math.inf]:
        assert fn(value) == reference(value), (parameter, value)
    # NaN satisfies no comparison: the if-chains fell through to their last line, and so must the
    # table, or a NaN reading would score differently after this change than before it.
    assert fn(math.nan) == reference(math.nan)


def test_the_functions_read_the_table(monkeypatch):
    monkeypatch.setitem(NEWS2_BANDS, "pulse", (Band(None, 200, 2), Band(200, None, 3)))
    assert news2.pulse_points(100) == 2
    assert news2.pulse_points(201) == 3


def test_the_source_is_the_vault_note():
    assert BANDS_SOURCE == "news2-rcp-2017"
    assert (VAULT / "sources" / "news2-rcp-2017.md").is_file()


def test_a_band_is_served_with_its_open_side_as_none():
    assert Band(None, 40, 3).as_dict() == {"low": None, "high": 40, "points": 3}
    assert NEWS2_BANDS["pulse"][-1].as_dict() == {"low": 130, "high": None, "points": 3}

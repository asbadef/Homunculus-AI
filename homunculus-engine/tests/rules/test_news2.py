# tests/rules/test_news2.py
"""NEWS2 (RCP 2017) scoring — boundaries verified against Homunculus/wiki/concepts/news2.md."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from homunculus.canonical import Observation, SignalCode
from homunculus.rules import news2
from homunculus.rules.finding import Severity, Urgency
from homunculus.state.timeline import PatientState

T0 = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)


def _state(**signals):
    st = PatientState("bed-9")
    for code, value in signals.items():
        st.ingest(Observation("bed-9", SignalCode[code], value, "u", T0, "dev"))
    return st


# --- Respiration rate: <=8->3 | 9-11->1 | 12-20->0 | 21-24->2 | >=25->3 ---
@pytest.mark.parametrize("rr,pts", [
    (8, 3), (9, 1), (11, 1), (12, 0), (20, 0), (21, 2), (24, 2), (25, 3), (30, 3),
])
def test_resp_rate_points(rr, pts):
    assert news2.resp_rate_points(rr) == pts


# --- SpO2 Scale 1: <=91->3 | 92-93->2 | 94-95->1 | >=96->0 ---
@pytest.mark.parametrize("spo2,pts", [
    (85, 3), (91, 3), (92, 2), (93, 2), (94, 1), (95, 1), (96, 0), (100, 0),
])
def test_spo2_scale1_points(spo2, pts):
    assert news2.spo2_scale1_points(spo2) == pts


# --- Air or oxygen: air->0 | supplemental O2->2 ---
def test_air_or_oxygen_points():
    assert news2.air_or_oxygen_points(on_oxygen=False) == 0
    assert news2.air_or_oxygen_points(on_oxygen=True) == 2


# --- Systolic BP: <=90->3 | 91-100->2 | 101-110->1 | 111-219->0 | >=220->3 ---
@pytest.mark.parametrize("sbp,pts", [
    (80, 3), (90, 3), (91, 2), (100, 2), (101, 1), (110, 1),
    (111, 0), (219, 0), (220, 3), (240, 3),
])
def test_systolic_bp_points(sbp, pts):
    assert news2.systolic_bp_points(sbp) == pts


# --- Pulse: <=40->3 | 41-50->1 | 51-90->0 | 91-110->1 | 111-130->2 | >=131->3 ---
@pytest.mark.parametrize("hr,pts", [
    (35, 3), (40, 3), (41, 1), (50, 1), (51, 0), (90, 0),
    (91, 1), (110, 1), (111, 2), (130, 2), (131, 3), (150, 3),
])
def test_pulse_points(hr, pts):
    assert news2.pulse_points(hr) == pts


# --- Temperature: <=35.0->3 | 35.1-36.0->1 | 36.1-38.0->0 | 38.1-39.0->1 | >=39.1->2 ---
@pytest.mark.parametrize("temp,pts", [
    (34.0, 3), (35.0, 3), (35.1, 1), (36.0, 1), (36.1, 0), (38.0, 0),
    (38.1, 1), (39.0, 1), (39.1, 2), (40.0, 2),
])
def test_temperature_points(temp, pts):
    assert news2.temperature_points(temp) == pts


# --- Consciousness (ACVPU ordinal 0=Alert..4=Unresponsive): Alert->0 | anything else->3 ---
@pytest.mark.parametrize("acvpu,pts", [
    (0, 0), (1, 3), (2, 3), (3, 3), (4, 3),
])
def test_consciousness_points(acvpu, pts):
    assert news2.consciousness_points(acvpu) == pts


# --- score(state): aggregate, breakdown, missing, red_param ----------------------

def test_score_all_normal_is_zero():
    r = news2.score(_state(RESP_RATE=16, SPO2=98, SBP=120, HEART_RATE=70, TEMPERATURE=37.0))
    assert r.total == 0
    assert r.red_param is False
    assert r.missing == []


def test_score_sums_parameters():
    # RR 26->3, SpO2 93->2, SBP 95->2, HR 120->2, Temp 38.5->1, on oxygen->2 = 12
    r = news2.score(_state(
        RESP_RATE=26, SPO2=93, SBP=95, HEART_RATE=120, TEMPERATURE=38.5,
        SUPPLEMENTAL_OXYGEN=1.0,
    ))
    assert r.total == 12
    assert r.red_param is True         # RR 26 scores 3
    assert r.breakdown["air_or_oxygen"] == 2


def test_score_defaults_air_and_alert_when_absent():
    # no SUPPLEMENTAL_OXYGEN and no ACVPU -> air (0) and Alert (0), not counted missing
    r = news2.score(_state(RESP_RATE=16, SPO2=98, SBP=120, HEART_RATE=70, TEMPERATURE=37.0))
    assert r.breakdown["air_or_oxygen"] == 0
    assert r.breakdown["consciousness"] == 0
    assert "air_or_oxygen" not in r.missing
    assert "consciousness" not in r.missing
    # G2-A2 (D7): assumed, and said so — but not partial.
    assert r.assumed == ["air_or_oxygen", "consciousness"]
    assert r.partial is False


def test_score_flags_missing_core_vitals():
    # only two of the five monitor channels present -> the rest are 'missing'
    r = news2.score(_state(RESP_RATE=16, HEART_RATE=70))
    assert set(r.missing) == {"spo2", "systolic_bp", "temperature"}


def test_score_new_confusion_scores_three():
    r = news2.score(_state(
        RESP_RATE=16, SPO2=98, SBP=120, HEART_RATE=70, TEMPERATURE=37.0, ACVPU=1,
    ))
    assert r.breakdown["consciousness"] == 3
    assert r.red_param is True


# --- evaluate(state) -> findings -------------------------------------------------

def test_evaluate_no_finding_when_low():
    # HR 95 -> 1 point only; total 1, no red param -> below escalation, no alert
    assert news2.evaluate(_state(
        RESP_RATE=16, SPO2=98, SBP=120, HEART_RATE=95, TEMPERATURE=37.0)) == []


def test_evaluate_high_band_is_immediate():
    findings = news2.evaluate(_state(
        RESP_RATE=26, SPO2=91, SBP=88, HEART_RATE=120, TEMPERATURE=39.5))
    assert len(findings) == 1
    f = findings[0]
    assert f.kind == "news2"
    assert f.severity == Severity.HIGH
    assert f.urgency == Urgency.IMMEDIATE
    assert f.citations[0].source == "news2-rcp-2017"


def test_evaluate_medium_band_is_soon():
    # RR 22->2, SpO2 92->2, HR 95->1 = 5 -> medium, no single param 3
    findings = news2.evaluate(_state(
        RESP_RATE=22, SPO2=92, SBP=120, HEART_RATE=95, TEMPERATURE=37.0))
    assert len(findings) == 1
    assert findings[0].severity == Severity.MODERATE
    assert findings[0].urgency == Urgency.SOON


def test_evaluate_single_red_param_escalates_below_five():
    # SBP 88 -> 3 (single red param), total 3 -> still surfaces for urgent review
    findings = news2.evaluate(_state(
        RESP_RATE=16, SPO2=98, SBP=88, HEART_RATE=70, TEMPERATURE=37.0))
    assert len(findings) == 1
    assert findings[0].severity == Severity.MODERATE


def test_evaluate_partial_score_is_flagged_in_reasoning():
    # only RR present but it alone hits a red 3 (RR 28) -> fires, reasoning notes partial
    findings = news2.evaluate(_state(RESP_RATE=28))
    assert len(findings) == 1
    assert "partial" in findings[0].reasoning.lower()


# --- G2-A2: a reading counts only inside its window; an uncharted input is assumed, out loud ----
#
# score(state, now) judges each input's age at `now` (D1): a vital older than its window (1 h; the
# temperature 2 h) scores 0 and is `stale`, and the score is partial. An air-or-oxygen or ACVPU
# value speaks for 8 h after it was charted (D8); uncharted or expired it is assumed — air, Alert —
# and listed in `assumed`, which does not make the score partial (D7). Without `now` nothing ages.

FIVE = dict(RESP_RATE=16, SPO2=98, SBP=120, HEART_RATE=70, TEMPERATURE=37.0)


def _aged(ages: dict, **values):
    """A state measured at T0, except each signal in `ages` ({code: how long before T0})."""
    st = PatientState("bed-9")
    for code, value in values.items():
        at = T0 - ages.get(code, timedelta(0))
        st.ingest(Observation("bed-9", SignalCode[code], value, "u", at, "dev"))
    return st


def test_a_stale_vital_scores_nothing_and_makes_the_score_partial():
    # SBP 88 would score 3; measured 61 min before `now` it is outside its 1 h window.
    r = news2.score(_aged({"SBP": timedelta(minutes=61)}, **{**FIVE, "SBP": 88}), T0)
    assert r.breakdown["systolic_bp"] == 0
    assert r.stale == ["systolic_bp"]
    assert r.missing == []
    assert r.partial is True
    assert (r.total, r.red_param) == (0, False)


def test_a_vital_never_measured_stays_missing_not_stale():
    r = news2.score(_aged({"SBP": timedelta(minutes=61)}, RESP_RATE=16, SBP=120), T0)
    assert r.missing == ["spo2", "pulse", "temperature"]
    assert r.stale == ["systolic_bp"]


@pytest.mark.parametrize("code,name,age,stale", [
    ("RESP_RATE", "respiration_rate", timedelta(minutes=60), False),
    ("RESP_RATE", "respiration_rate", timedelta(minutes=60, seconds=1), True),
    ("HEART_RATE", "pulse", timedelta(minutes=60), False),
    ("HEART_RATE", "pulse", timedelta(minutes=60, seconds=1), True),
    ("TEMPERATURE", "temperature", timedelta(hours=1, minutes=59), False),
    ("TEMPERATURE", "temperature", timedelta(hours=2), False),
    ("TEMPERATURE", "temperature", timedelta(hours=2, seconds=1), True),
])
def test_an_age_equal_to_the_window_is_still_fresh(code, name, age, stale):
    r = news2.score(_aged({code: age}, **FIVE), T0)
    assert (name in r.stale) is stale
    assert r.stale == ([name] if stale else [])


def test_a_reading_stamped_after_now_is_never_stale():
    r = news2.score(_aged({"SBP": -timedelta(hours=3)}, **{**FIVE, "SBP": 88}), T0)
    assert r.stale == [] and r.breakdown["systolic_bp"] == 3


def test_without_now_nothing_ages():
    st = _aged({"SBP": timedelta(hours=4), "SUPPLEMENTAL_OXYGEN": timedelta(hours=9)},
               **{**FIVE, "SBP": 88}, SUPPLEMENTAL_OXYGEN=1.0)
    r = news2.score(st)
    assert r.stale == [] and r.breakdown["systolic_bp"] == 3
    assert r.breakdown["air_or_oxygen"] == 2 and r.assumed == ["consciousness"]


def test_measured_at_and_fresh_until_name_all_seven_inputs():
    st = _aged({"TEMPERATURE": timedelta(minutes=30)}, **FIVE, SUPPLEMENTAL_OXYGEN=1.0)
    r = news2.score(st, T0)
    assert list(r.measured_at) == list(r.breakdown) == list(r.fresh_until)
    assert r.measured_at["temperature"] == T0 - timedelta(minutes=30)
    assert r.fresh_until["temperature"] == T0 + timedelta(minutes=90)     # its 2 h window
    assert r.fresh_until["pulse"] == T0 + timedelta(hours=1)
    assert r.fresh_until["air_or_oxygen"] == T0 + timedelta(hours=8)
    assert (r.measured_at["consciousness"], r.fresh_until["consciousness"]) == (None, None)


@pytest.mark.parametrize("age,points,assumed", [
    (timedelta(hours=7, minutes=59), 2, []),
    (timedelta(hours=8), 2, []),
    (timedelta(hours=8, minutes=1), 0, ["air_or_oxygen"]),
])
def test_charted_oxygen_speaks_for_eight_hours_then_air_is_assumed_again(age, points, assumed):
    st = _aged({"SUPPLEMENTAL_OXYGEN": age}, **FIVE, SUPPLEMENTAL_OXYGEN=1.0, ACVPU=0)
    r = news2.score(st, T0)
    assert r.breakdown["air_or_oxygen"] == points
    assert r.assumed == assumed
    assert r.partial is False


def test_an_acvpu_charted_nine_hours_ago_is_assumed_alert():
    st = _aged({"ACVPU": timedelta(hours=9)}, **FIVE, ACVPU=3, SUPPLEMENTAL_OXYGEN=0)
    r = news2.score(st, T0)
    assert r.breakdown["consciousness"] == 0
    assert r.assumed == ["consciousness"]
    assert (r.partial, r.red_param) == (False, False)


def test_the_alert_scores_what_the_board_scores():
    # D6: SBP 88 four hours old would be a single red parameter; judged at `now` it is out.
    st = _aged({"SBP": timedelta(hours=4)}, **{**FIVE, "SBP": 88})
    assert news2.evaluate(st, T0) == []
    assert [f.kind for f in news2.evaluate(st)] == ["news2"]     # without `now`, as before


def test_the_partial_note_names_a_stale_vital_with_the_missing_ones():
    [f] = news2.evaluate(_aged({"SBP": timedelta(hours=4)}, RESP_RATE=28, SBP=120), T0)
    assert "partial NEWS2: spo2, systolic_bp, pulse, temperature not recently recorded" in f.reasoning


def test_the_alert_says_what_it_assumed_and_is_not_partial_for_it():
    [f] = news2.evaluate(_state(**{**FIVE, "RESP_RATE": 28}), T0)
    assert f.reasoning.endswith(
        " Assumed, nothing current charted: air_or_oxygen as room air, consciousness as Alert.")
    assert "partial" not in f.reasoning.lower()

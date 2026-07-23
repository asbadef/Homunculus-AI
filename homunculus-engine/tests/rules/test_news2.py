# tests/rules/test_news2.py
"""NEWS2 (RCP 2017) scoring — boundaries verified against Homunculus/wiki/concepts/news2.md."""
from __future__ import annotations

from datetime import datetime, timezone

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

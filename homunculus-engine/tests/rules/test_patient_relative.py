# tests/rules/test_patient_relative.py
"""Patient-relative layer: downgrade chronic-normal, surface acute deviation from baseline."""
from __future__ import annotations

from datetime import datetime, timezone

from homunculus.canonical import Observation, SignalCode
from homunculus.rules import news2, patient_relative
from homunculus.rules.finding import Severity, Urgency
from homunculus.state.profile import BaselineRange, PatientProfile
from homunculus.state.timeline import PatientState

T0 = datetime(2026, 7, 23, 10, 0, tzinfo=timezone.utc)


def _state(**signals):
    st = PatientState("bed-3")
    for code, value in signals.items():
        st.ingest(Observation("bed-3", SignalCode[code], value, "u", T0, "dev"))
    return st


def test_no_profile_passes_findings_through_untouched():
    st = _state(RESP_RATE=26, SPO2=91, SBP=88, HEART_RATE=120, TEMPERATURE=39.5)
    findings = news2.evaluate(st)
    assert patient_relative.apply(findings, st, None) == findings


def test_all_chronic_baseline_downgrades_news2():
    # A chronically-abnormal patient (COPD + chronic AF) whose *baseline* already scores NEWS2:
    # RR 22 (base 21-24 ->2), HR 125 (base 120-130 ->2), SBP 105 (base 100-110 ->1) = 5, medium.
    # Every point is within the patient's charted baseline -> chronic-normal, downgrade.
    st = _state(RESP_RATE=22, HEART_RATE=125, SBP=105)
    profile = PatientProfile(
        "bed-3",
        comorbidities=frozenset({"copd", "chronic_af"}),
        baselines={
            SignalCode.RESP_RATE: BaselineRange(21, 24),
            SignalCode.HEART_RATE: BaselineRange(120, 130),
            SignalCode.SBP: BaselineRange(100, 110),
        },
    )
    findings = news2.evaluate(st)
    assert any(f.kind == "news2" for f in findings)   # it fired on population thresholds
    out = patient_relative.apply(findings, st, profile)
    news2_out = next(f for f in out if f.kind == "news2")
    assert news2_out.downgraded is True
    assert news2_out.severity == Severity.LOW
    assert news2_out.urgency == Urgency.ROUTINE
    assert "baseline" in news2_out.chronic_context.lower()


def test_acute_contributor_keeps_news2_alarming():
    # Same chronic baselines, but SpO2 90 (no baseline) is a NEW acute contributor -> stays alarming.
    st = _state(RESP_RATE=22, HEART_RATE=125, SBP=105, SPO2=90)
    profile = PatientProfile(
        "bed-3",
        baselines={
            SignalCode.RESP_RATE: BaselineRange(21, 24),
            SignalCode.HEART_RATE: BaselineRange(120, 130),
            SignalCode.SBP: BaselineRange(100, 110),
        },
    )
    findings = news2.evaluate(st)
    out = patient_relative.apply(findings, st, profile)
    news2_out = next(f for f in out if f.kind == "news2")
    assert news2_out.downgraded is False
    assert "spo2" in news2_out.chronic_context.lower()


def test_hypertensive_drop_surfaces_acute_change():
    # SBP 95 with a charted baseline of 150-170: population NEWS2 barely notices; we surface it.
    st = _state(SBP=95)
    profile = PatientProfile(
        "bed-3",
        comorbidities=frozenset({"chronic_hypertension"}),
        baselines={SignalCode.SBP: BaselineRange(150, 170)},
    )
    out = patient_relative.apply(news2.evaluate(st), st, profile)
    acute = [f for f in out if f.kind == "acute_change"]
    assert len(acute) == 1
    assert acute[0].citations[0].source == "news2-rcp-2017"
    assert "150" in acute[0].reasoning and "below" in acute[0].reasoning.lower()


def test_value_within_baseline_raises_no_acute_change():
    st = _state(HEART_RATE=105)
    profile = PatientProfile("bed-3", baselines={SignalCode.HEART_RATE: BaselineRange(100, 110)})
    out = patient_relative.apply(news2.evaluate(st), st, profile)
    assert [f for f in out if f.kind == "acute_change"] == []

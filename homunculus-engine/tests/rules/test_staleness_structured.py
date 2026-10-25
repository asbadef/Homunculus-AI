# tests/rules/test_staleness_structured.py
"""Structured staleness: findings carry a stale_inputs list; NEWS2 is staleness-aware too."""
from datetime import datetime, timedelta, timezone

from homunculus.canonical import Observation, SignalCode
from homunculus.rules import news2, septic_shock
from homunculus.reco.engine import to_alert
from homunculus.state.timeline import PatientState

NOW = datetime(2026, 7, 14, 12, 0, tzinfo=timezone.utc)


def _obs(st, code, value, age_h=0.0):
    st.ingest(Observation("bed-3", code, value, "u", NOW - timedelta(hours=age_h), "dev"))


# --- sepsis finding carries structured stale_inputs -------------------------------------------
def test_sepsis_finding_lists_stale_inputs_structured():
    st = PatientState("bed-3")
    _obs(st, SignalCode.SUSPECTED_INFECTION, 1.0)
    _obs(st, SignalCode.CREATININE, 3.0, age_h=30)     # stale (window ~26 h) -> renal SOFA 2
    sepsis = next(f for f in septic_shock.evaluate(st, NOW) if f.kind == "sepsis")
    assert any("creatinine" in s.lower() for s in sepsis.stale_inputs)


def test_to_alert_passes_stale_inputs_through():
    st = PatientState("bed-3")
    _obs(st, SignalCode.SUSPECTED_INFECTION, 1.0)
    _obs(st, SignalCode.CREATININE, 3.0, age_h=30)
    sepsis = next(f for f in septic_shock.evaluate(st, NOW) if f.kind == "sepsis")
    alert = to_alert(sepsis, "bed-3")
    assert alert.stale_inputs == sepsis.stale_inputs and alert.stale_inputs


# --- NEWS2 is staleness-aware when given `now` -------------------------------------------------
def test_news2_flags_stale_vital():
    st = PatientState("bed-3")
    # a firing NEWS2 (RR 26 ->3, SBP 88 ->3) but SBP is 4 h old (vital window ~1 h)
    _obs(st, SignalCode.RESP_RATE, 26, age_h=0)
    _obs(st, SignalCode.SBP, 88, age_h=4)
    findings = news2.evaluate(st, NOW)
    n = next(f for f in findings if f.kind == "news2")
    assert any("systolic" in s.lower() for s in n.stale_inputs)
    assert "recency" in n.reasoning.lower()
    # G2-A2 (D6): the four-hour-old pressure is out of the total — RR's 3 alone still fires it (a
    # single parameter at the maximum) — and the score says it is partial for it.
    assert n.summary.startswith("NEWS2 3 ")
    assert "partial NEWS2: spo2, systolic_bp, pulse, temperature" in n.reasoning


def test_news2_without_now_has_no_staleness():
    st = PatientState("bed-3")
    _obs(st, SignalCode.RESP_RATE, 26)
    _obs(st, SignalCode.SBP, 88)
    n = next(f for f in news2.evaluate(st) if f.kind == "news2")   # no `now` -> no staleness check
    assert n.stale_inputs == []

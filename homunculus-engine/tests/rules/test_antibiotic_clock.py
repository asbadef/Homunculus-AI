# tests/rules/test_antibiotic_clock.py
from datetime import datetime, timezone, timedelta
from homunculus.canonical import Observation, SignalCode
from homunculus.state.timeline import PatientState
from homunculus.rules.antibiotic_clock import evaluate

T0 = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)


def _state(**series):
    st = PatientState("bed-3")
    for code, points in series.items():
        for minute, value in points:
            st.ingest(Observation("bed-3", SignalCode[code], value, "u", T0 + timedelta(minutes=minute), "dev"))
    return st


def _now(minute):
    return T0 + timedelta(minutes=minute)


def test_no_finding_before_recognition():
    st = _state()
    assert evaluate(st, recognized_at=None, now=_now(0)) == []


def test_finding_within_window_is_soon():
    st = _state()  # no antibiotic given
    f = evaluate(st, recognized_at=T0, now=_now(30))[0]
    assert f.kind == "antibiotic_due"
    assert "30 min" in f.reasoning or "30" in f.reasoning

def test_finding_after_window_is_immediate_and_overdue():
    st = _state()
    f = evaluate(st, recognized_at=T0, now=_now(75))[0]
    assert f.kind == "antibiotic_overdue"

def test_no_finding_once_antibiotic_administered():
    st = _state(ANTIBIOTIC_ADMINISTERED=[(20, 1.0)])
    assert evaluate(st, recognized_at=T0, now=_now(75)) == []

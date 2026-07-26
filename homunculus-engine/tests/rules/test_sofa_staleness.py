# tests/rules/test_sofa_staleness.py
from datetime import datetime, timedelta, timezone

from homunculus.canonical import Observation, SignalCode
from homunculus.rules.sofa import DEFAULT_FRESHNESS, stale_inputs, stale_note
from homunculus.state.timeline import PatientState

NOW = datetime(2026, 7, 14, 12, 0, tzinfo=timezone.utc)


def _state(**ages_hours):
    """Each kwarg CODE=hours puts one observation `hours` before NOW."""
    st = PatientState("bed-3")
    for code, hours in ages_hours.items():
        ts = NOW - timedelta(hours=hours)
        st.ingest(Observation("bed-3", SignalCode[code], 1.0, "u", ts, "dev"))
    return st


def test_stale_inputs_flags_old_creatinine():
    st = _state(CREATININE=30)   # window is ~26 h
    assert SignalCode.CREATININE in stale_inputs(st, NOW)


def test_fresh_input_is_not_stale():
    st = _state(CREATININE=2)
    assert stale_inputs(st, NOW) == []


def test_missing_input_is_not_stale():
    assert stale_inputs(_state(), NOW) == []   # nothing present -> nothing stale


def test_boundary_exactly_at_window_is_not_stale():
    window_h = DEFAULT_FRESHNESS[SignalCode.CREATININE].total_seconds() / 3600
    st = _state(CREATININE=window_h)           # age == window -> not stale (strictly greater)
    assert SignalCode.CREATININE not in stale_inputs(st, NOW)


def test_stale_inputs_ordered_oldest_first():
    st = _state(CREATININE=30, MAP=5)          # both stale (MAP window ~1 h); creatinine older
    order = stale_inputs(st, NOW)
    assert order[0] == SignalCode.CREATININE and SignalCode.MAP in order


def test_stale_note_empty_when_all_fresh():
    assert stale_note(_state(CREATININE=1, MAP=0), NOW) == ""


def test_stale_note_mentions_recency_and_oldest():
    note = stale_note(_state(CREATININE=30), NOW)
    assert "recency" in note.lower() and "creatinine" in note.lower()


# --- staleness surfaced on the sepsis finding ---------------------------------------------------
from homunculus.rules import septic_shock  # noqa: E402


def _septic_state(creatinine_age_h):
    st = PatientState("bed-3")
    st.ingest(Observation("bed-3", SignalCode.SUSPECTED_INFECTION, 1.0, "", NOW, "ehr"))
    # creatinine 3.0 -> renal SOFA 2 -> sepsis fires; place it creatinine_age_h hours before NOW
    st.ingest(Observation("bed-3", SignalCode.CREATININE, 3.0, "mg/dL",
                          NOW - timedelta(hours=creatinine_age_h), "lab"))
    return st


def test_sepsis_finding_notes_stale_sofa_input():
    findings = septic_shock.evaluate(_septic_state(30), NOW)
    sepsis = next(f for f in findings if f.kind == "sepsis")
    assert "recency" in sepsis.reasoning.lower()


def test_sepsis_finding_has_no_recency_note_when_fresh():
    findings = septic_shock.evaluate(_septic_state(2), NOW)
    sepsis = next(f for f in findings if f.kind == "sepsis")
    assert "recency" not in sepsis.reasoning.lower()

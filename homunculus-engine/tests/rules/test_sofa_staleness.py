# tests/rules/test_sofa_staleness.py
from datetime import datetime, timedelta, timezone

from homunculus.canonical import Observation, SignalCode
from homunculus.rules.sofa import (
    DEFAULT_FRESHNESS, respiration_points, stale_input_labels, stale_inputs, stale_note,
)
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


# --- a charted respiratory-support flag ages like the reading it qualifies (G2-A4 review) --------
def test_a_support_flag_charted_9_h_ago_is_stale_and_1_h_ago_is_not():
    """Since G2-A4 a clinician charts support; a "yes" charted once must not count as current for
    ever. It is held to the PaO2/FiO2 window (~8 h), the reading it qualifies."""
    old = _state(ON_RESP_SUPPORT=9)
    assert SignalCode.ON_RESP_SUPPORT in stale_inputs(old, NOW)
    assert stale_input_labels(old, NOW) == ["respiratory support"]
    fresh = _state(ON_RESP_SUPPORT=1)
    assert stale_inputs(fresh, NOW) == [] and stale_input_labels(fresh, NOW) == []


def test_the_support_flag_shares_the_ratio_window():
    assert DEFAULT_FRESHNESS[SignalCode.ON_RESP_SUPPORT] == DEFAULT_FRESHNESS[SignalCode.PAO2_FIO2]


def test_a_stale_support_flag_is_named_in_the_note():
    note = stale_note(_state(ON_RESP_SUPPORT=9), NOW)
    assert "recency" in note.lower() and "respiratory support" in note


def test_a_stale_support_flag_is_surfaced_not_dropped():
    """Staleness only flags recency: the ratio of 150 still scores 3 on a support "yes" 9 h old."""
    st = PatientState("bed-3")
    st.ingest(Observation("bed-3", SignalCode.PAO2_FIO2, 150.0, "mmHg", NOW - timedelta(hours=1), "lab"))
    st.ingest(Observation("bed-3", SignalCode.ON_RESP_SUPPORT, 1.0, "bool", NOW - timedelta(hours=9),
                          "clinician"))
    assert respiration_points(st) == 3
    assert stale_input_labels(st, NOW) == ["respiratory support"]


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

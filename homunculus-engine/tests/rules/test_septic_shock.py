# tests/rules/test_septic_shock.py
from datetime import datetime, timezone, timedelta
from homunculus.canonical import Observation, SignalCode
from homunculus.state.timeline import PatientState
from homunculus.rules.septic_shock import evaluate

T0 = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)


def _state(now_min=0, **series):
    """series: code -> list of (minute, value) OR a scalar (at minute 0)."""
    st = PatientState("bed-3")
    for code, spec in series.items():
        points = spec if isinstance(spec, list) else [(0, spec)]
        for minute, value in points:
            st.ingest(Observation("bed-3", SignalCode[code], value, "u", T0 + timedelta(minutes=minute), "dev"))
    return st


def _now(minute):
    return T0 + timedelta(minutes=minute)


def test_no_infection_no_findings():
    st = _state(MAP=60, LACTATE=4.0, PLATELETS=90)
    assert evaluate(st, _now(0)) == []


def test_sepsis_when_infection_and_sofa_ge_2():
    # SOFA: MAP<70 (1) + platelets<100 (2) = 3 >= 2
    st = _state(SUSPECTED_INFECTION=1.0, MAP=64, PLATELETS=90)
    kinds = {f.kind for f in evaluate(st, _now(0))}
    assert "sepsis" in kinds
    assert "septic_shock" not in kinds


def test_septic_shock_when_pressor_lactate_and_adequate_fluid():
    # weight 100 kg -> 30 mL/kg = 3000 mL required; give 3000 within 3h
    st = _state(
        SUSPECTED_INFECTION=1.0,
        WEIGHT_KG=100,
        MAP=[(0, 60)],
        NOREPINEPHRINE_RATE=[(0, 0.12)],
        LACTATE=[(0, 3.1)],
        PLATELETS=[(0, 90)],
        CRYSTALLOID_BOLUS_ML=[(-120, 1500), (-60, 1500)],  # 3000 mL in last 3h
    )
    kinds = {f.kind for f in evaluate(st, _now(0))}
    assert "septic_shock" in kinds


def test_under_resuscitated_when_fluid_not_yet_adequate():
    # lactate high, hypotensive, infection, but only 500 mL given (need 3000)
    st = _state(
        SUSPECTED_INFECTION=1.0,
        WEIGHT_KG=100,
        MAP=[(0, 60)],
        LACTATE=[(0, 3.1)],
        CRYSTALLOID_BOLUS_ML=[(-30, 500)],
    )
    findings = evaluate(st, _now(0))
    kinds = {f.kind for f in findings}
    assert "under_resuscitated_sepsis" in kinds
    assert "septic_shock" not in kinds


def test_septic_shock_finding_cites_sepsis3():
    st = _state(
        SUSPECTED_INFECTION=1.0, WEIGHT_KG=100, MAP=60,
        NOREPINEPHRINE_RATE=0.12, LACTATE=3.1,
        CRYSTALLOID_BOLUS_ML=[(-60, 3000)],
    )
    shock = next(f for f in evaluate(st, _now(0)) if f.kind == "septic_shock")
    assert any(c.source == "sepsis-3-jama-2016" for c in shock.citations)


# --- K1: sepsis is a RISE of 2 SOFA points, not a total of 2 -------------------------------------
# Sepsis-3 defines sepsis as an acute increase over the patient's own pre-infection baseline. The
# rule used to compare the absolute total, which fired permanently on every chronically ill
# patient in the unit. These tests pin the criterion so it cannot silently revert.

from homunculus.state.profile import PatientProfile
from homunculus.rules.septic_shock import MAX_SOFA


def _profile(baseline_sofa=None):
    return PatientProfile(patient_id="bed-3", baseline_sofa=baseline_sofa)


def test_chronic_baseline_absorbs_the_score_no_sepsis():
    """Chronic dialysis patient: creatinine 3.5 scores renal 3, and that is their every day.
    Suspected infection alone must not make it sepsis."""
    st = _state(SUSPECTED_INFECTION=1.0, CREATININE=3.5)
    assert any(f.kind == "sepsis" for f in evaluate(st, _now(0))), "no baseline -> assumed 0, fires"
    kinds = {f.kind for f in evaluate(st, _now(0), _profile(baseline_sofa=3))}
    assert "sepsis" not in kinds


def test_rise_of_two_over_a_chronic_baseline_is_sepsis():
    """Same patient, now also hypotensive and thrombocytopenic: renal 3 + MAP<70 (1) +
    platelets<100 (2) = SOFA 6 against baseline 3 is a rise of 3 — that IS sepsis, and the
    alert must still fire. A baseline raises the bar; it must never remove it."""
    st = _state(SUSPECTED_INFECTION=1.0, CREATININE=3.5, MAP=64, PLATELETS=90)
    sepsis = next(f for f in evaluate(st, _now(0), _profile(baseline_sofa=3)) if f.kind == "sepsis")
    assert "SOFA 6" in sepsis.summary
    assert "baseline 3" in sepsis.summary
    assert "+3" in sepsis.summary


def test_missing_baseline_states_the_assumption():
    """Behaviour is unchanged when no baseline is charted (Sepsis-3 assumes 0) — but the
    reasoning has to say so, because only the bedside knows whether it holds."""
    st = _state(SUSPECTED_INFECTION=1.0, MAP=64, PLATELETS=90)
    sepsis = next(f for f in evaluate(st, _now(0), None) if f.kind == "sepsis")
    assert "taken as 0" in sepsis.reasoning
    assert "chart a baseline" in sepsis.reasoning
    assert any("assumed 0" in c.note for c in sepsis.citations)


def test_a_profile_without_a_baseline_sofa_still_assumes_zero():
    """A profile charted for comorbidities only must not be read as 'baseline 0 confirmed'."""
    st = _state(SUSPECTED_INFECTION=1.0, MAP=64, PLATELETS=90)
    prof = PatientProfile(patient_id="bed-3", comorbidities=frozenset({"copd"}))
    sepsis = next(f for f in evaluate(st, _now(0), prof) if f.kind == "sepsis")
    assert "taken as 0" in sepsis.reasoning


def test_baseline_never_suppresses_the_shock_branch():
    """Septic shock is defined on pressor + lactate + fluids, not on SOFA. A high charted
    baseline must not be able to silence it."""
    st = _state(
        SUSPECTED_INFECTION=1.0, WEIGHT_KG=100, MAP=60,
        NOREPINEPHRINE_RATE=0.12, LACTATE=3.1,
        CRYSTALLOID_BOLUS_ML=[(-60, 3000)],
    )
    kinds = {f.kind for f in evaluate(st, _now(0), _profile(baseline_sofa=MAX_SOFA))}
    assert "septic_shock" in kinds
    assert "sepsis" not in kinds

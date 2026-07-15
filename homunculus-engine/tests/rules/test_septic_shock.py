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

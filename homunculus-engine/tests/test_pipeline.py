# tests/test_pipeline.py
from datetime import datetime, timezone, timedelta
from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine

T0 = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)


def _obs(code, value, minute=0, patient="bed-3"):
    return Observation(patient, code, value, "u", T0 + timedelta(minutes=minute), "dev")


def test_engine_emits_septic_shock_alert():
    eng = Engine()
    for o in [
        _obs(SignalCode.SUSPECTED_INFECTION, 1.0),
        _obs(SignalCode.WEIGHT_KG, 100),
        _obs(SignalCode.CRYSTALLOID_BOLUS_ML, 3000, minute=-30),
        _obs(SignalCode.MAP, 60),
        _obs(SignalCode.NOREPINEPHRINE_RATE, 0.12),
        _obs(SignalCode.LACTATE, 3.1),
    ]:
        alerts = eng.ingest(o, now=o.timestamp)
    kinds = {a.kind for a in eng.active_alerts("bed-3")}
    assert "septic_shock" in kinds


def test_engine_sets_recognition_time_for_antibiotic_clock():
    eng = Engine()
    base = [
        _obs(SignalCode.SUSPECTED_INFECTION, 1.0),
        _obs(SignalCode.WEIGHT_KG, 100),
        _obs(SignalCode.CRYSTALLOID_BOLUS_ML, 3000, minute=-30),
        _obs(SignalCode.MAP, 60),
        _obs(SignalCode.NOREPINEPHRINE_RATE, 0.12),
        _obs(SignalCode.LACTATE, 3.1),
    ]
    for o in base:
        eng.ingest(o, now=o.timestamp)
    # 75 minutes later, no antibiotic -> overdue alert appears
    later = _obs(SignalCode.HEART_RATE, 110, minute=75)
    eng.ingest(later, now=later.timestamp)
    kinds = {a.kind for a in eng.active_alerts("bed-3")}
    assert "antibiotic_overdue" in kinds


def test_engine_exposes_patient_ids_and_state():
    from datetime import datetime, timezone
    from homunculus.canonical import Observation, SignalCode
    eng = Engine()
    ts = datetime(2026, 7, 18, 10, 0, tzinfo=timezone.utc)
    eng.ingest(Observation("bed-3", SignalCode.HEART_RATE, 118.0, "bpm", ts, "mon"), now=ts)
    assert eng.patient_ids() == ["bed-3"]
    assert eng.state("bed-3").latest(SignalCode.HEART_RATE).value == 118.0


def test_engine_emits_news2_alert_independent_of_infection():
    # NEWS2 is a general deterioration screen — fires with no suspected infection.
    eng = Engine()
    for o in [
        _obs(SignalCode.RESP_RATE, 26),      # 3
        _obs(SignalCode.SPO2, 91),           # 3
        _obs(SignalCode.SBP, 88),            # 3
        _obs(SignalCode.HEART_RATE, 120),    # 2
        _obs(SignalCode.TEMPERATURE, 39.5),  # 2  -> total 13, high band
    ]:
        eng.ingest(o, now=o.timestamp)
    alerts = {a.kind: a for a in eng.active_alerts("bed-3")}
    assert "news2" in alerts
    a = alerts["news2"]
    assert a.urgency == "immediate"
    assert a.supporting_evidence == ["news2-rcp-2017"]
    assert a.recommended_actions            # non-empty, review-register actions


def test_engine_downgrades_chronic_baseline_news2():
    from homunculus.state.profile import BaselineRange, PatientProfile
    from homunculus.canonical import SignalCode as SC
    eng = Engine()
    eng.set_profile(PatientProfile(
        "bed-3",
        comorbidities=frozenset({"copd", "chronic_af"}),
        baselines={SC.RESP_RATE: BaselineRange(21, 24),
                   SC.HEART_RATE: BaselineRange(120, 130),
                   SC.SBP: BaselineRange(100, 110)},
    ))
    for o in [_obs(SC.RESP_RATE, 22), _obs(SC.HEART_RATE, 125), _obs(SC.SBP, 105)]:
        eng.ingest(o, now=o.timestamp)
    alerts = {a.kind: a for a in eng.active_alerts("bed-3")}
    assert "news2" in alerts
    a = alerts["news2"]
    assert a.downgraded is True
    assert a.urgency == "routine"           # will not escalate
    assert "baseline" in a.chronic_context.lower()


def test_engine_surfaces_acute_change_from_baseline():
    from homunculus.state.profile import BaselineRange, PatientProfile
    from homunculus.canonical import SignalCode as SC
    eng = Engine()
    eng.set_profile(PatientProfile(
        "bed-3", comorbidities=frozenset({"chronic_hypertension"}),
        baselines={SC.SBP: BaselineRange(150, 170)},
    ))
    o = _obs(SC.SBP, 95)
    eng.ingest(o, now=o.timestamp)
    alerts = {a.kind: a for a in eng.active_alerts("bed-3")}
    assert "acute_change" in alerts
    assert alerts["acute_change"].supporting_evidence == ["news2-rcp-2017"]
    assert alerts["acute_change"].recommended_actions

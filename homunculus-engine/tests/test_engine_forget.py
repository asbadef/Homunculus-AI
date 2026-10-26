# tests/test_engine_forget.py
"""G2-A11 (D9): the engine forgets a discharged patient — state, alerts, anchors, held NEWS2, profile.
Synthetic bed and made-up values only (CLAUDE.md rule 6)."""
from datetime import datetime, timedelta, timezone

from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine
from homunculus.state.profile import PatientProfile

T0 = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)

# Suspected infection, 100 kg, 30 mL/kg given, MAP 60 on noradrenaline 0.12, lactate 3.1: septic
# shock (CRITICAL), sepsis (HIGH) and the antibiotic clock — the same bed as test_alert_lifecycle.
SHOCK = [(SignalCode.SUSPECTED_INFECTION, 1.0), (SignalCode.WEIGHT_KG, 100),
         (SignalCode.CRYSTALLOID_BOLUS_ML, 3000), (SignalCode.MAP, 60),
         (SignalCode.NOREPINEPHRINE_RATE, 0.12), (SignalCode.LACTATE, 3.1)]


def _reading(engine, code, value, minute=0, patient="bed-3"):
    o = Observation(patient, code, value, "u", T0 + timedelta(minutes=minute), "dev")
    return engine.ingest(o, now=o.timestamp)


def _shock(engine, patient="bed-3"):
    for code, value in SHOCK:
        _reading(engine, code, value, patient=patient)
    assert {a.kind for a in engine.active_alerts(patient)} >= {"septic_shock", "sepsis"}


def test_forget_drops_state_alerts_anchor_and_profile():
    engine = Engine()
    _shock(engine)
    engine.set_profile(PatientProfile(patient_id="bed-3"))
    assert engine.recognized_at("bed-3") is not None

    engine.forget("bed-3")

    assert "bed-3" not in engine.patient_ids()
    assert engine.active_alerts("bed-3") == []
    assert engine.recognized_at("bed-3") is None
    assert engine.profile("bed-3") is None


def test_forget_is_idempotent_and_leaves_other_patients_alone():
    engine = Engine()
    _shock(engine, patient="bed-3")
    _reading(engine, SignalCode.HEART_RATE, 140, patient="bed-4")      # NEWS2 on another bed
    engine.forget("bed-3")
    engine.forget("bed-3")                                              # nothing to drop: no error
    assert engine.patient_ids() == ["bed-4"]
    assert {a.kind for a in engine.active_alerts("bed-4")} == {"news2"}


def test_a_reading_after_forget_starts_a_fresh_patient():
    engine = Engine()
    _shock(engine)
    engine.forget("bed-3")
    # Infection absent and the anchor dropped: a recognition inside ANCHOR_RESTORE_S would have
    # restored the old anchor (X12). Forgotten, there is no anchor to restore: a new patient.
    alerts = _reading(engine, SignalCode.HEART_RATE, 80, minute=1)
    assert alerts == []
    assert engine.state("bed-3").latest(SignalCode.MAP) is None, "the old readings are gone"
    assert engine.recognized_at("bed-3") is None

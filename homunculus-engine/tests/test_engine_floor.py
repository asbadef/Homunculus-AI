# homunculus-engine/tests/test_engine_floor.py
"""G3-06 «Saat geri gitmez» (spec D1–D3): every rule judges a patient no earlier than the patient's last
judgement. A reading stamped in the past keeps its stamp — the state, freshness and the trail hold it there —
but it is judged at the patient's floor, so no time-based rule goes backwards: an overdue antibiotic stays
overdue, the 3 h fluid window and the model read the same instant, and an acknowledged episode does not end
on a late value. Synthetic patients and values only (CLAUDE.md rule 6)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from homunculus.api.ackstore import AckStore
from homunculus.api.alert_lifecycle import sync_alerts
from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine

T0 = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)
PID = "bed-3"


def _at(minute: float) -> datetime:
    return T0 + timedelta(minutes=minute)


def _obs(code, value, minute, patient=PID):
    return Observation(patient, code, value, "u", _at(minute), "dev")


def _door(eng, code, value, minute, *, wall=None, patient=PID):
    """One reading as a door hands it on: requested at min(its stamp, the wall clock) (G2-A2, X10). `wall`
    defaults to the stamp — a reading that arrives as it is measured."""
    o = _obs(code, value, minute, patient)
    return eng.ingest(o, now=min(o.timestamp, _at(minute if wall is None else wall)))


def _sepsis(eng, minute, *, wall=None):
    """Suspected infection, platelets 80 and creatinine 3.5: SOFA 5 over an assumed baseline of 0 — `sepsis`,
    and the antibiotic hour from the recognition (tests/test_pipeline.py `_sepsis_charted`)."""
    for code, value in [(SignalCode.PLATELETS, 80), (SignalCode.CREATININE, 3.5),
                        (SignalCode.SUSPECTED_INFECTION, 1.0)]:
        _door(eng, code, value, minute, wall=wall)


def _kinds(eng, patient=PID):
    return {a.kind for a in eng.active_alerts(patient)}


def _summary(eng, kind, patient=PID):
    return next(a.summary for a in eng.active_alerts(patient) if a.kind == kind)


class TestOverdueStaysOverdue:
    def test_a_reading_stamped_four_hours_back_leaves_an_overdue_antibiotic_overdue(self):
        # The reviewers' timeline (spec §1): sepsis at +0, overdue at +120, then a reading stamped -240. Judged
        # at its stamp it read «Antibiotic window: 300 min remaining» — false reassurance.
        eng = Engine()
        _sepsis(eng, 0)
        _door(eng, SignalCode.HEART_RATE, 80, 120)
        assert _summary(eng, "antibiotic_overdue") == "Antibiotic OVERDUE by 60 min"
        alerts = _door(eng, SignalCode.SPO2, 97, -240, wall=130)
        assert "antibiotic_due" not in {a.kind for a in alerts}
        assert _summary(eng, "antibiotic_overdue") == "Antibiotic OVERDUE by 60 min", "judged at +120, the floor"
        assert eng.state(PID).latest(SignalCode.SPO2).timestamp == _at(-240), "the value keeps its own stamp"
        assert eng._judged_at[PID] == _at(120)

    def test_an_acknowledged_overdue_keeps_its_acknowledgement_first_sight_and_episode(self):
        # The lifecycle hook (api/alert_lifecycle.py) ended the episode the back-dated reading's «due» replaced,
        # pruning its acknowledgement and first sight; the next current reading raised it as a NEW episode.
        eng, store = Engine(), AckStore()
        key = (PID, "antibiotic_overdue")

        def door(code, value, minute, wall):
            _door(eng, code, value, minute, wall=wall)
            cleared = sync_alerts(eng, store, PID, _at(wall))
            for a in eng.active_alerts(PID):
                store.stamp_first_seen(PID, a.kind, _at(wall))
            return cleared

        for code, value in [(SignalCode.PLATELETS, 80), (SignalCode.CREATININE, 3.5),
                            (SignalCode.SUSPECTED_INFECTION, 1.0)]:
            door(code, value, 0, 0)
        door(SignalCode.HEART_RATE, 80, 120, 120)
        first = store.first_seen[key]
        store.acknowledge(PID, "antibiotic_overdue", "nurse", _at(125))
        assert door(SignalCode.SPO2, 97, -240, 130) == [], "no episode ends"
        assert key in store.acks and key in store.firing
        assert store.first_seen[key] == first == _at(120)
        door(SignalCode.HEART_RATE, 82, 140, 140)
        assert store.first_seen[key] == first and key in store.acks, "the next reading continues the episode"


class TestEveryRuleJudgesAtTheFloor:
    def test_a_late_reading_that_completes_sepsis_on_a_judged_patient_is_overdue_at_once(self):
        # Infection charted at +0, the patient judged up to +360; a bilirubin of 3.0 (2 SOFA points) measured at
        # +0 arrives at +360. Its recognition is anchored at its requested instant, +0, and the clock is read at
        # +360: the hour ran out five hours ago.
        eng = Engine()
        _door(eng, SignalCode.SUSPECTED_INFECTION, 1.0, 0)
        _door(eng, SignalCode.HEART_RATE, 80, 360)
        assert "sepsis" not in _kinds(eng)
        _door(eng, SignalCode.BILIRUBIN, 3.0, 0, wall=360)
        assert eng.recognized_at(PID) == _at(0)
        assert "antibiotic_due" not in _kinds(eng)
        assert _summary(eng, "antibiotic_overdue") == "Antibiotic OVERDUE by 300 min"

    def test_a_fresh_patients_first_reading_is_judged_at_its_own_stamp_as_before(self):
        # No floor yet: a patient the engine has never judged is judged at the requested instant itself.
        eng = Engine()
        _door(eng, SignalCode.SUSPECTED_INFECTION, 1.0, -360, wall=0)
        _door(eng, SignalCode.BILIRUBIN, 3.0, -360, wall=0)
        assert eng.recognized_at(PID) == _at(-360)
        assert _summary(eng, "antibiotic_due") == "Antibiotic window: 60 min remaining"
        assert eng._judged_at[PID] == _at(-360)

    def test_the_three_hour_fluid_window_is_read_at_the_floor(self):
        # Septic shock at +0 on a bolus given at -30. At +200 the bolus is outside the 3 h window: the shock
        # criterion's «adequate fluid» no longer holds. A reading stamped +10 used to be judged at +10, where the
        # bolus counted again, and brought the shock back.
        eng = Engine()
        for code, value, minute in [(SignalCode.SUSPECTED_INFECTION, 1.0, 0), (SignalCode.WEIGHT_KG, 100, 0),
                                    (SignalCode.CRYSTALLOID_BOLUS_ML, 3000, -30), (SignalCode.MAP, 60, 0),
                                    (SignalCode.NOREPINEPHRINE_RATE, 0.12, 0), (SignalCode.LACTATE, 3.1, 0)]:
            _door(eng, code, value, minute, wall=0)
        assert "septic_shock" in _kinds(eng)
        _door(eng, SignalCode.HEART_RATE, 80, 200)
        assert "septic_shock" not in _kinds(eng)
        _door(eng, SignalCode.SPO2, 97, 10, wall=205)
        assert "septic_shock" not in _kinds(eng), "judged at +200: the bolus is still outside the window"
        assert "under_resuscitated_sepsis" in _kinds(eng)

    def test_the_model_is_scored_at_the_floor(self):
        # The optional model seam (`Engine.set_model`) takes the instant as a parameter too; a stand-in records
        # the instants it is asked at and never fires.
        class _Spy:
            threshold = 2.0

            def __init__(self):
                self.seen = []

            def score(self, state, now):
                self.seen.append(now)
                return 0.0, []

        eng, spy = Engine(), _Spy()
        eng._scorer = spy
        _door(eng, SignalCode.HEART_RATE, 80, 120)
        _door(eng, SignalCode.SPO2, 97, -240, wall=130)
        assert spy.seen == [_at(120), _at(120)]


class TestTheFloorIsPerPatientMemory:
    def test_it_is_listed_with_the_engines_per_patient_dicts(self):
        assert "_judged_at" in Engine._PER_PATIENT and "_news2_judged_at" not in Engine._PER_PATIENT

    def test_another_patients_floor_is_its_own(self):
        eng = Engine()
        _door(eng, SignalCode.HEART_RATE, 80, 120)
        _door(eng, SignalCode.HEART_RATE, 80, -240, patient="bed-4", wall=130)
        assert (eng._judged_at[PID], eng._judged_at["bed-4"]) == (_at(120), _at(-240))

    def test_copy_adopt_and_forget_move_it(self):
        real = Engine()
        _sepsis(real, 0)
        _door(real, SignalCode.HEART_RATE, 80, 120)
        twin = real.copy()
        assert twin._judged_at == real._judged_at
        _door(twin, SignalCode.SPO2, 97, -240, wall=130)
        assert _summary(twin, "antibiotic_overdue") == "Antibiotic OVERDUE by 60 min", "the copy's floor is +120"
        other = Engine()
        other.adopt(real, PID)
        assert other._judged_at[PID] == _at(120)
        other.forget(PID)
        assert PID not in other._judged_at

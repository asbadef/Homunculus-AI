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


# --- G2-A1 (O17): an alert lasts exactly as long as its rule fires -------------------------------
#
# The bucket is rebuilt from every evaluation: a kind the rules did not produce for this reading is
# gone at once — no quiet time, no hysteresis (the user's decision, 2026-10-25). A heart rate of
# 140/min alone is enough to raise one: 3 NEWS2 points, a single red parameter, a MODERATE `news2`.

def _kinds(eng, patient="bed-3"):
    return {a.kind for a in eng.active_alerts(patient)}


def test_an_alert_whose_rule_stops_firing_leaves_on_the_first_reading_that_does_not_produce_it():
    eng = Engine()
    fast = _obs(SignalCode.HEART_RATE, 140)
    assert {a.kind for a in eng.ingest(fast, now=fast.timestamp)} == {"news2"}
    calm = _obs(SignalCode.HEART_RATE, 80, minute=1)
    assert eng.ingest(calm, now=calm.timestamp) == []
    assert eng.active_alerts("bed-3") == [], "HR 80 scores 0: the single red parameter has resolved"


def test_an_alert_that_fires_again_is_back_and_another_patient_is_untouched():
    eng = Engine()
    for minute, (patient, rate) in enumerate([("bed-3", 140), ("bed-4", 140), ("bed-3", 80), ("bed-3", 140)]):
        o = _obs(SignalCode.HEART_RATE, rate, minute=minute, patient=patient)
        eng.ingest(o, now=o.timestamp)
    assert _kinds(eng) == {"news2"}, "140 → 80 → 140: the second 140 fires again"
    assert _kinds(eng, "bed-4") == {"news2"}, "bed-4 was not evaluated again: its alert stands"


def _sepsis_charted(eng, infection, minute):
    """Platelets 80 and creatinine 3.5 with suspected infection charted `infection`: SOFA 5 over an
    assumed baseline of 0, so `sepsis` fires while infection is 1, and `septic_shock.evaluate`
    returns nothing at its first line once the physician charts it 0."""
    for code, value in [(SignalCode.PLATELETS, 80), (SignalCode.CREATININE, 3.5),
                        (SignalCode.SUSPECTED_INFECTION, infection)]:
        o = _obs(code, value, minute=minute)
        eng.ingest(o, now=o.timestamp)


def test_when_sepsis_stops_the_antibiotic_alerts_leave_the_board_but_the_clock_keeps_counting():
    # X9 (Task 1 review): the antibiotic findings are emitted only while a recognition kind fires,
    # so they leave the board with the sepsis alert (D9) — but the anchor is NOT dropped, because
    # suspected infection is still charted. Sepsis that comes back finds the true elapsed time.
    eng = Engine()
    _sepsis_charted(eng, 1.0, minute=0)
    assert _kinds(eng) == {"sepsis", "antibiotic_due"}
    assert eng.recognized_at("bed-3") == T0
    for code, value in [(SignalCode.PLATELETS, 200), (SignalCode.CREATININE, 0.8)]:   # SOFA back to 0
        o = _obs(code, value, minute=20)
        eng.ingest(o, now=o.timestamp)
    assert _kinds(eng) == set(), "sepsis has stopped: it and its antibiotic clock are off the board"
    assert eng.recognized_at("bed-3") == T0, "infection is still charted: the clock keeps counting underneath"
    o = _obs(SignalCode.PLATELETS, 80, minute=90)
    eng.ingest(o, now=o.timestamp)
    o = _obs(SignalCode.CREATININE, 3.5, minute=90)
    eng.ingest(o, now=o.timestamp)
    assert {"sepsis", "antibiotic_overdue"} <= _kinds(eng)
    overdue = next(a for a in eng.active_alerts("bed-3") if a.kind == "antibiotic_overdue")
    assert overdue.summary == "Antibiotic OVERDUE by 30 min", \
        "sepsis back at +90: the hour that ran from +0 closed at +60, not an hour restarted at +90"
    assert eng.recognized_at("bed-3") == T0


def test_charting_infection_absent_ends_the_episode_and_its_clock():
    eng = Engine()
    _sepsis_charted(eng, 1.0, minute=0)
    assert _kinds(eng) == {"sepsis", "antibiotic_due"}
    assert eng.recognized_at("bed-3") == T0
    _sepsis_charted(eng, 0.0, minute=20)          # the physician charts: no infection after all
    assert _kinds(eng) == set(), "no recognition kind fires: sepsis and its antibiotic clock are gone"
    assert eng.recognized_at("bed-3") is None, "infection charted absent: the episode and its anchor end"
    _sepsis_charted(eng, 1.0, minute=90)          # a second episode, seventy minutes later
    assert eng.recognized_at("bed-3") == T0 + timedelta(minutes=90)
    due = next(a for a in eng.active_alerts("bed-3") if a.kind == "antibiotic_due")
    assert due.summary == "Antibiotic window: 60 min remaining", \
        "the second recognition has its own hour, not the first episode's overdue clock"


def _chart(eng, code, value, minute):
    o = _obs(code, value, minute=minute)
    eng.ingest(o, now=o.timestamp)


def _summary(eng, kind, patient="bed-3"):
    return next(a.summary for a in eng.active_alerts(patient) if a.kind == kind)


def test_a_corrected_infection_toggle_keeps_the_antibiotic_hour():
    # X12 (the reviewer's toggle): overdue by 10 min at +70, infection charted absent at +71 and
    # present again at +72. That is a correction, the same episode: before X12 the anchor dropped at
    # +71 was gone and +72 started a new hour — "Antibiotic window: 60 min remaining", on a patient
    # whose antibiotic was overdue.
    eng = Engine()
    _sepsis_charted(eng, 1.0, minute=0)
    _chart(eng, SignalCode.PLATELETS, 80, minute=70)
    assert _summary(eng, "antibiotic_overdue") == "Antibiotic OVERDUE by 10 min"
    _chart(eng, SignalCode.SUSPECTED_INFECTION, 0.0, minute=71)
    assert _kinds(eng) == set()
    assert eng.recognized_at("bed-3") is None, "charted absent: the anchor is dropped (X9)"
    _chart(eng, SignalCode.SUSPECTED_INFECTION, 1.0, minute=72)
    assert eng.recognized_at("bed-3") == T0, "re-recognised a minute after the drop: the old anchor"
    assert "antibiotic_due" not in _kinds(eng)
    assert _summary(eng, "antibiotic_overdue") == "Antibiotic OVERDUE by 12 min", \
        "the hour that ran from +0 is still the one that is overdue"


def test_a_recognition_more_than_15_minutes_after_infection_was_charted_absent_has_its_own_hour():
    eng = Engine()
    _sepsis_charted(eng, 1.0, minute=0)
    _chart(eng, SignalCode.PLATELETS, 80, minute=70)
    assert _summary(eng, "antibiotic_overdue") == "Antibiotic OVERDUE by 10 min"
    _chart(eng, SignalCode.SUSPECTED_INFECTION, 0.0, minute=71)
    _chart(eng, SignalCode.HEART_RATE, 80, minute=80)             # an evaluation in the gap
    _chart(eng, SignalCode.SUSPECTED_INFECTION, 1.0, minute=90)   # 19 min after the drop
    assert eng.recognized_at("bed-3") == T0 + timedelta(minutes=90), "past the restore window: a new anchor"
    assert "antibiotic_overdue" not in _kinds(eng)
    assert _summary(eng, "antibiotic_due") == "Antibiotic window: 60 min remaining"


def test_a_new_infection_recognised_within_the_hour_of_a_rule_out_does_not_inherit_its_doses():
    # X12 review: sepsis at +0, the antibiotic given at +20, infection ruled out at +40 and a new one
    # recognised at +90. With an hour's restore window the +90 recognition inherited the anchor of +0
    # and the dose of +20 with it: no antibiotic alert at all for the new infection. Fifty minutes is
    # no corrected toggle; the new episode has its own hour, and the old dose does not count.
    eng = Engine()
    _sepsis_charted(eng, 1.0, minute=0)
    _chart(eng, SignalCode.ANTIBIOTIC_ADMINISTERED, 1.0, minute=20)
    assert not _kinds(eng) & {"antibiotic_due", "antibiotic_overdue"}, "the first episode is treated"
    _chart(eng, SignalCode.SUSPECTED_INFECTION, 0.0, minute=40)   # ruled out
    assert eng.recognized_at("bed-3") is None
    _chart(eng, SignalCode.SUSPECTED_INFECTION, 1.0, minute=90)   # a new infection, 50 min later
    assert "sepsis" in _kinds(eng)
    assert eng.recognized_at("bed-3") == T0 + timedelta(minutes=90), "its own anchor"
    assert _summary(eng, "antibiotic_due") == "Antibiotic window: 60 min remaining", \
        "the dose of +20 was for the ruled-out episode"


def test_an_antibiotic_charted_while_infection_was_charted_absent_counts_against_the_restored_hour():
    eng = Engine()
    _sepsis_charted(eng, 1.0, minute=0)
    _chart(eng, SignalCode.SUSPECTED_INFECTION, 0.0, minute=30)
    _chart(eng, SignalCode.ANTIBIOTIC_ADMINISTERED, 1.0, minute=35)   # given during the gap
    _chart(eng, SignalCode.SUSPECTED_INFECTION, 1.0, minute=40)
    assert "sepsis" in _kinds(eng)
    assert eng.recognized_at("bed-3") == T0, "the toggle was corrected: the anchor of +0, restored"
    assert not _kinds(eng) & {"antibiotic_due", "antibiotic_overdue"}, \
        "the dose at +35 is after the restored anchor: the clock is satisfied"
    _chart(eng, SignalCode.PLATELETS, 80, minute=100)
    assert not _kinds(eng) & {"antibiotic_due", "antibiotic_overdue"}


def _flapping_map(eng, minute, value):
    o = _obs(SignalCode.MAP, value, minute=minute)
    eng.ingest(o, now=o.timestamp)


def test_a_map_flap_does_not_reset_the_antibiotic_clock():
    # SOFA reads the latest MAP: platelets 140 (1 point) plus MAP 69 (1 point) is a rise of 2, MAP 71
    # is not. One reading in ten at 71 stops sepsis for one evaluation each time; the untreated
    # patient's hour must run on regardless (X9). Before it, each flap dropped the anchor and
    # `antibiotic_overdue` never fired.
    eng = Engine()
    for code, value in [(SignalCode.SUSPECTED_INFECTION, 1.0), (SignalCode.PLATELETS, 140)]:
        o = _obs(code, value)
        eng.ingest(o, now=o.timestamp)
    first_overdue = None
    anchors = []                       # the engine's anchor after every reading from the first recognition on
    for minute in range(0, 121):
        _flapping_map(eng, minute, 69 if minute % 10 else 71)
        if minute == 0:
            assert "sepsis" not in _kinds(eng), "MAP 71 and platelets 140 are SOFA 1: no rise of 2"
        else:
            anchors.append(eng.recognized_at("bed-3"))
        if minute % 10 == 0:
            assert not _kinds(eng) & {"antibiotic_due", "antibiotic_overdue"}, \
                f"sepsis is not firing at +{minute} min: the antibiotic alerts are off the board"
        if first_overdue is None and "antibiotic_overdue" in _kinds(eng):
            first_overdue = minute
    assert first_overdue == 61, f"overdue one hour after the first recognition (+1 min), saw {first_overdue}"
    assert set(anchors) == {T0 + timedelta(minutes=1)}, "the anchor stayed at the first recognition throughout"
    assert _kinds(eng) == set(), "+120 min is a MAP-71 reading: sepsis and its overdue are off the board"
    _flapping_map(eng, 121, 69)
    overdue = next(a for a in eng.active_alerts("bed-3") if a.kind == "antibiotic_overdue")
    assert overdue.summary == "Antibiotic OVERDUE by 60 min", "sepsis back at +121: the true elapsed time"


def test_a_treated_patient_does_not_get_a_false_overdue_after_a_map_flap():
    eng = Engine()
    for o in [
        _obs(SignalCode.SUSPECTED_INFECTION, 1.0),
        _obs(SignalCode.PLATELETS, 140),
        _obs(SignalCode.MAP, 69),
        _obs(SignalCode.ANTIBIOTIC_ADMINISTERED, 1.0, minute=20),
        _obs(SignalCode.MAP, 71, minute=90),          # one off-reading: sepsis stops for an evaluation
        _obs(SignalCode.MAP, 69, minute=91),          # sepsis is back
        _obs(SignalCode.MAP, 69, minute=152),
    ]:
        eng.ingest(o, now=o.timestamp)
        if o.timestamp >= T0 + timedelta(minutes=20):
            assert not _kinds(eng) & {"antibiotic_due", "antibiotic_overdue"}, \
                "the antibiotic was given at +20 min: " \
                f"no clock finding at +{(o.timestamp - T0).seconds // 60}"
    assert "sepsis" in _kinds(eng)
    assert eng.recognized_at("bed-3") == T0, "the first recognition's anchor, not a restart at +91"


def test_the_antibiotic_clock_keeps_its_anchor_while_septic_shock_fires_without_the_sepsis_criterion():
    # Recognition is `sepsis` OR `septic_shock` (_RECOGNITION_KINDS). A baseline SOFA charted during
    # shock can take `sepsis` (a RISE of 2) away while the shock criterion still holds; resetting
    # the anchor then would restart an overdue antibiotic's hour in the middle of septic shock (X1).
    from homunculus.state.profile import PatientProfile
    eng = Engine()
    for o in [
        _obs(SignalCode.SUSPECTED_INFECTION, 1.0),
        _obs(SignalCode.WEIGHT_KG, 100),
        _obs(SignalCode.CRYSTALLOID_BOLUS_ML, 3000, minute=-30),
        _obs(SignalCode.MAP, 60),
        _obs(SignalCode.NOREPINEPHRINE_RATE, 0.12),
        _obs(SignalCode.LACTATE, 3.1),
    ]:
        eng.ingest(o, now=o.timestamp)
    assert {"septic_shock", "sepsis"} <= _kinds(eng)
    eng.set_profile(PatientProfile("bed-3", baseline_sofa=4))
    later = _obs(SignalCode.HEART_RATE, 110, minute=75)
    eng.ingest(later, now=later.timestamp)
    assert "sepsis" not in _kinds(eng), "SOFA 4 over a charted baseline of 4 is no rise"
    assert {"septic_shock", "antibiotic_overdue"} <= _kinds(eng)
    assert eng.recognized_at("bed-3") == T0


# --- G2-A2 (D6): the alert judges NEWS2 at the reading's own `now`, as the board does -------------

def test_a_pressure_four_hours_old_no_longer_raises_news2():
    eng = Engine()
    o = _obs(SignalCode.SBP, 88)                 # 3 points, a single red parameter, at T0
    assert {a.kind for a in eng.ingest(o, now=o.timestamp)} == {"news2"}
    o = _obs(SignalCode.HEART_RATE, 72, minute=240)
    assert eng.ingest(o, now=o.timestamp) == [], "at +4 h the pressure is out of the total"


def test_the_patient_relative_layer_judges_the_same_instant():
    # RR 26 inside the patient's charted 24-28 is chronic; the four-hour-old SBP 88 is no
    # contributor at `now`, so every point left is explained and the alert is downgraded. Judged
    # without `now`, the old pressure read as an acute contributor and kept the alert alarming.
    from homunculus.state.profile import BaselineRange, PatientProfile
    eng = Engine()
    eng.set_profile(PatientProfile("bed-3", baselines={SignalCode.RESP_RATE: BaselineRange(24, 28)}))
    for o in [_obs(SignalCode.SBP, 88), _obs(SignalCode.RESP_RATE, 26, minute=240)]:
        eng.ingest(o, now=o.timestamp)
    [alert] = eng.active_alerts("bed-3")
    assert (alert.kind, alert.severity, alert.downgraded) == ("news2", "low", True)

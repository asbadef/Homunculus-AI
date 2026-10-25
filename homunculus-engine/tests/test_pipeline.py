# tests/test_pipeline.py
from dataclasses import replace
from datetime import datetime, timezone, timedelta

import pytest

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

def test_a_pressure_four_hours_old_does_not_raise_a_new_news2_alert():
    # Kept by X9: staleness may withhold a NEW alert. The pressure is delivered four hours after it
    # was measured, so it is stale at the only `now` it is judged at, and no alert was running for
    # it to hold. (One that was running is held: the X9 tests below.)
    eng = Engine()
    o = _obs(SignalCode.SBP, 88)                 # 3 points, a single red parameter — measured at T0
    assert eng.ingest(o, now=T0 + timedelta(minutes=240)) == [], "out of the total at +4 h"
    o = _obs(SignalCode.HEART_RATE, 72, minute=240)
    assert eng.ingest(o, now=o.timestamp) == [], "a fresh normal pulse does not bring it in"


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


# --- G2-A2 (X9, X9b): a stale input may withhold a NEWS2 alert but cannot end a running one -------
#
# The bridge posts a vitals set one reading at a time, every reading stamped with the set's time.
# Judged at each reading, the first readings of a set taken more than an hour after the last saw the
# rest stale, fell below the band and ended the alert, which the next reading raised again as a new
# episode — a new nurse notification, the acknowledgement gone. A running alert the score at `now`
# no longer reaches is now held while a vital is stale, and says what it is held on. It is kept
# exactly as last scored (X9b): re-scored on the stale readings it climbed a band on a value hours
# old. It ends when no vital is stale and the score is below the band. Synthetic values throughout.

_SPOT_CHECK = [(SignalCode.HEART_RATE, 105), (SignalCode.RESP_RATE, 22), (SignalCode.SPO2, 95),
               (SignalCode.SBP, 105), (SignalCode.TEMPERATURE, 38.5)]     # NEWS2 1+2+1+1+1 = 6


def _news2(eng, patient="bed-3"):
    return {a.kind: a for a in eng.active_alerts(patient)}.get("news2")


_HELD_ON = ["resp rate, SpO2, systolic BP ", "SpO2, systolic BP ", "systolic BP "]


@pytest.mark.parametrize("second_set,numbers,held", [
    # The same set again. From the SpO2 on the score at `now` reaches the band by itself — partial,
    # the pressure still stale — and that live score is the alert.
    (_SPOT_CHECK, ["6", "6", "5", "6", "6"], 2),
    # A better pulse first (1 point to 0). Re-scored on the stale readings the alert dropped to 5 on
    # the pulse alone; kept as last scored it reads 6 until the fresh score reaches the band, at 5.
    ([(SignalCode.HEART_RATE, 85)] + _SPOT_CHECK[1:], ["6", "6", "6", "5", "5"], 3),
], ids=["same-set", "better-pulse"])
def test_a_vitals_set_posted_one_reading_at_a_time_neither_ends_nor_re_scores_the_running_alert(
        second_set, numbers, held):
    eng = Engine()
    for code, value in _SPOT_CHECK:
        o = _obs(code, value)
        eng.ingest(o, now=o.timestamp)
    before = _news2(eng)
    assert before.summary.startswith("NEWS2 6 ")
    seen = []
    for code, value in second_set:                    # the next set, 75 minutes later
        o = _obs(code, value, minute=75)
        eng.ingest(o, now=o.timestamp)
        alert = _news2(eng)
        assert alert is not None, f"news2 ended on the {code.name} reading of the second set"
        seen.append(alert)
    # The temperature's window is 2 h, so the first set's 38.5 still counts at +75 min.
    assert [a.summary.split()[1] for a in seen] == numbers
    assert {(a.severity, a.urgency) for a in seen} == {("moderate", "soon")}
    for alert, held_on in zip(seen[:held], _HELD_ON):
        assert "Held while inputs are stale: " + held_on in alert.clinical_reasoning
        assert alert.clinical_reasoning.startswith(before.clinical_reasoning)
        assert replace(alert, clinical_reasoning=before.clinical_reasoning,
                       stale_inputs=before.stale_inputs) == before, "kept as it was last scored"
    assert seen[0].stale_inputs == ["resp rate", "SpO2", "systolic BP"]
    assert all("Held" not in a.clinical_reasoning for a in seen[held:])
    last = seen[-1]
    assert "partial" not in last.clinical_reasoning and last.stale_inputs == []


def test_a_held_alert_does_not_climb_on_a_stale_value():
    # Re-scored on each input's last reading (X9) this alert went to NEWS2 7, high risk, immediate —
    # a nurse notification and an escalation clock — on the fresh temperature plus a pressure 70
    # minutes old, while the score at `now` was 4. Kept as last scored (X9b), it does not move.
    eng = Engine()
    for o in [_obs(SignalCode.SBP, 88), _obs(SignalCode.RESP_RATE, 22),
              _obs(SignalCode.HEART_RATE, 105)]:                             # 3 + 2 + 1 = 6
        eng.ingest(o, now=o.timestamp)
    before = _news2(eng)
    assert (before.summary.split()[1], before.severity, before.urgency) == ("6", "moderate", "soon")
    for code, value in [(SignalCode.RESP_RATE, 22), (SignalCode.HEART_RATE, 105),
                        (SignalCode.TEMPERATURE, 38.5)]:                     # fresh, one at a time
        o = _obs(code, value, minute=70)
        eng.ingest(o, now=o.timestamp)
        held = _news2(eng)
        assert (held.summary, held.severity, held.urgency) == (before.summary, "moderate", "soon"), \
            f"on the {code.name} reading"
        assert "Held while inputs are stale: systolic BP" in held.clinical_reasoning
    assert held.stale_inputs == ["systolic BP"]


def test_a_running_news2_alert_is_held_on_a_stale_pressure_until_a_fresh_one_scores_below_the_band():
    eng = Engine()
    o = _obs(SignalCode.SBP, 88)                      # 3 points, a single red parameter, at T0
    eng.ingest(o, now=o.timestamp)
    o = _obs(SignalCode.HEART_RATE, 72, minute=240)
    eng.ingest(o, now=o.timestamp)
    held = _news2(eng)
    assert held is not None, "a four-hour-old pressure cannot end the alert it raised"
    assert held.summary.startswith("NEWS2 3 "), "kept as last scored"
    assert "Held while inputs are stale: systolic BP " in held.clinical_reasoning
    assert held.stale_inputs == ["systolic BP"]
    o = _obs(SignalCode.SBP, 120, minute=241)
    assert eng.ingest(o, now=o.timestamp) == []
    assert _news2(eng) is None, "a fresh pressure scoring nothing ends it"


def test_a_held_alert_stays_as_last_scored_while_a_vital_is_stale_though_its_driver_is_normal():
    # X9b's price: not re-scored, the hold cannot see that the pulse which raised the alert is
    # normal again. It is kept, saying the pressure is stale, until the pressure is read again.
    eng = Engine()
    for o in [_obs(SignalCode.HEART_RATE, 140), _obs(SignalCode.SBP, 105)]:   # 3 + 1: a red pulse
        eng.ingest(o, now=o.timestamp)
    o = _obs(SignalCode.HEART_RATE, 80, minute=75)    # the pressure is stale by now
    eng.ingest(o, now=o.timestamp)
    held = _news2(eng)
    assert held.summary.startswith("NEWS2 4 ")
    assert "Held while inputs are stale: systolic BP " in held.clinical_reasoning
    o = _obs(SignalCode.SBP, 105, minute=76)
    assert eng.ingest(o, now=o.timestamp) == []
    assert _news2(eng) is None, "no vital is stale and the score (pressure 1) is below the band"


def test_a_held_alert_ends_on_the_reading_that_leaves_no_vital_stale_below_the_band():
    eng = Engine()
    for code, value in _SPOT_CHECK:
        o = _obs(code, value)
        eng.ingest(o, now=o.timestamp)
    present = []
    for code, value in [(SignalCode.HEART_RATE, 70), (SignalCode.RESP_RATE, 16),
                        (SignalCode.SPO2, 98), (SignalCode.SBP, 120),
                        (SignalCode.TEMPERATURE, 37.0)]:   # a normal set, 75 minutes later
        o = _obs(code, value, minute=75)
        eng.ingest(o, now=o.timestamp)
        present.append(_news2(eng) is not None)
    # Held while the SpO2 or the pressure is stale; with the pressure read nothing is (the first
    # set's temperature is inside its 2 h) and the score, 1, is below the band: it ends there.
    assert present == [True, True, True, False, False]


def test_a_held_alert_is_still_downgraded_by_the_baseline_that_explains_it():
    # Kept as last scored, the held alert keeps the downgrade it was scored with: the stale pressure
    # inside its charted range still explains it. Judged again at `now` the pressure would be no
    # contributor, nothing would be explained, and a chronic alert would start alarming because its
    # one input went stale.
    from homunculus.state.profile import BaselineRange, PatientProfile
    eng = Engine()
    eng.set_profile(PatientProfile("bed-3", baselines={SignalCode.SBP: BaselineRange(85, 95)}))
    o = _obs(SignalCode.SBP, 88)
    eng.ingest(o, now=o.timestamp)
    assert (_news2(eng).severity, _news2(eng).downgraded) == ("low", True)
    o = _obs(SignalCode.HEART_RATE, 72, minute=240)
    eng.ingest(o, now=o.timestamp)
    held = _news2(eng)
    assert "Held while inputs are stale: systolic BP " in held.clinical_reasoning
    assert (held.severity, held.urgency, held.downgraded) == ("low", "routine", True)
    assert "systolic BP 88 within charted baseline 85-95" in held.chronic_context


def test_a_held_alert_driven_by_a_stale_pressure_outside_its_baseline_is_not_downgraded():
    # The other side of the same judgement. Judged again at `now` the stale pressure would be no
    # contributor, the pulse inside its charted range would explain every point left, and the held
    # alert would be downgraded on the strength of the one input that is as expected.
    from homunculus.state.profile import BaselineRange, PatientProfile
    eng = Engine()
    eng.set_profile(PatientProfile("bed-3", baselines={SignalCode.HEART_RATE: BaselineRange(100, 115),
                                                       SignalCode.SBP: BaselineRange(110, 130)}))
    for o in [_obs(SignalCode.SBP, 88), _obs(SignalCode.HEART_RATE, 105)]:    # 3 + 1: a red pressure
        eng.ingest(o, now=o.timestamp)
    o = _obs(SignalCode.HEART_RATE, 105, minute=75)
    alerts = eng.ingest(o, now=o.timestamp)
    held = _news2(eng)
    assert "Held while inputs are stale: systolic BP " in held.clinical_reasoning
    assert (held.severity, held.urgency, held.downgraded) == ("moderate", "soon", False)
    assert held.chronic_context.startswith("Acute contributor(s): ")
    assert [a.kind for a in alerts].count("acute_change") == 1, "the hold adds no second one"


def test_a_charted_oxygen_past_its_shift_does_not_hold_the_alert_once_the_vitals_are_fresh():
    # The hold is on stale vitals (X9b). A charted oxygen past its 8 h is assumed air (D8), and the
    # alert says so; with every vital fresh the evaluation is complete, and below the band it ends.
    eng = Engine()
    for o in [_obs(SignalCode.SUPPLEMENTAL_OXYGEN, 1.0), _obs(SignalCode.RESP_RATE, 22),
              _obs(SignalCode.HEART_RATE, 105)]:                                # 2 + 2 + 1 = 5
        eng.ingest(o, now=o.timestamp)
    assert _news2(eng).summary.startswith("NEWS2 5 ")
    o = _obs(SignalCode.RESP_RATE, 22, minute=485)
    eng.ingest(o, now=o.timestamp)
    held = _news2(eng)
    assert "Held while inputs are stale: pulse " in held.clinical_reasoning, "the pulse is stale"
    assert held.summary.startswith("NEWS2 5 ")
    o = _obs(SignalCode.HEART_RATE, 105, minute=486)
    assert eng.ingest(o, now=o.timestamp) == [], "resp rate 2 + pulse 1, oxygen assumed air: 3"
    assert _news2(eng) is None

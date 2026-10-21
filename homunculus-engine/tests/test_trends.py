"""`patient_trends()`: everything a trend chart draws, decided by the engine.

The browser draws and never scores (spec §1, D1). So every fact a chart shows is built here and held
here: the series, how the latest value moved, its NEWS2 points, whether it sits inside the normal a
clinician charted, the NEWS2 rows as bands (the rules' own table, not a copy), and the moments an
alarm episode began or an antibiotic was charted. Synthetic patients only (`S-001`…).
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest

from homunculus.api.audit import AuditEvent, InMemoryAuditLog
from homunculus.api.board import _PUBLISHED_SIGNALS
from homunculus.api.trends import TRENDS_HOURS, TRENDS_MARKER_LIMIT, TRENDS_MAX_POINTS, patient_trends
from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine
from homunculus.rules.news2 import NEWS2_BANDS, score as news2_score
from homunculus.state.profile import BaselineRange, PatientProfile

NOW = datetime(2026, 10, 19, 9, 0, tzinfo=timezone.utc)
HOSPITAL = "HOSP1"


def _at(minutes_ago: float) -> datetime:
    return NOW - timedelta(minutes=minutes_ago)


def _engine(*readings: tuple[SignalCode, float, float], patient: str = "S-001") -> Engine:
    """An engine fed `(code, value, minutes_ago)` readings, oldest first, as the bridge would."""
    engine = Engine()
    for code, value, minutes_ago in sorted(readings, key=lambda r: -r[2]):
        ts = _at(minutes_ago)
        engine.ingest(Observation(patient, code, value, "u", ts, "test"), now=ts)
    return engine


def _trends(engine: Engine, audit=None, *, hours: int = 24, patient: str = "S-001") -> dict:
    return patient_trends(engine, audit or InMemoryAuditLog(), hospital=HOSPITAL,
                          patient_id=patient, hours=hours, now=NOW)


def _channel(answer: dict, key: str) -> dict:
    return next(c for c in answer["channels"] if c["key"] == key)


# --- shape --------------------------------------------------------------------------------------

def test_every_published_channel_is_listed_in_the_boards_order_even_when_empty():
    answer = _trends(_engine((SignalCode.HEART_RATE, 84, 30)))
    assert [c["key"] for c in answer["channels"]] == list(_PUBLISHED_SIGNALS)
    assert [c["key"] for c in answer["channels"]] == [
        "heart_rate", "map", "sbp", "spo2", "temperature", "resp_rate", "lactate"]
    empty = _channel(answer, "lactate")
    assert empty["points"] == [] and empty["latest"] is None
    assert (empty["thinned"], empty["total_points"]) == (False, 0)


def test_the_window_and_the_bands_source_are_stated():
    answer = _trends(_engine((SignalCode.HEART_RATE, 84, 30)), hours=6)
    assert answer["patient_id"] == "S-001" and answer["hours"] == 6
    assert answer["since"] == (NOW - timedelta(hours=6)).isoformat()
    assert answer["until"] == NOW.isoformat() and answer["generated_at"] == NOW.isoformat()
    assert (answer["bands_source"], answer["news2_scale"]) == ("news2-rcp-2017", 1)
    json.dumps(answer, allow_nan=False)        # nothing in it a JSON response cannot carry


# --- points -------------------------------------------------------------------------------------

def test_points_are_the_window_oldest_first_with_the_engines_points():
    engine = _engine((SignalCode.HEART_RATE, 80, 30 * 60), (SignalCode.HEART_RATE, 84, 120),
                     (SignalCode.HEART_RATE, 132, 60))
    hr = _channel(_trends(engine), "heart_rate")
    assert hr["points"] == [[_at(120).isoformat(), 84.0, 0], [_at(60).isoformat(), 132.0, 3]]
    assert (hr["thinned"], hr["total_points"]) == (False, 2)
    assert len(_channel(_trends(engine, hours=72), "heart_rate")["points"]) == 3


def test_a_reading_exactly_on_the_start_of_the_window_is_drawn():
    engine = _engine((SignalCode.HEART_RATE, 84, 6 * 60 + 1), (SignalCode.HEART_RATE, 86, 6 * 60),
                     (SignalCode.HEART_RATE, 88, 30))
    answer = _trends(engine, hours=6)
    hr = _channel(answer, "heart_rate")
    assert [value for _ts, value, _points in hr["points"]] == [86.0, 88.0]     # the minute before is out
    assert hr["points"][0][0] == answer["since"]


def test_a_reading_exactly_on_the_end_of_the_window_is_drawn():
    engine = _engine((SignalCode.HEART_RATE, 84, 30), (SignalCode.HEART_RATE, 86, 0))
    answer = _trends(engine, hours=6)
    hr = _channel(answer, "heart_rate")
    assert [value for _ts, value, _points in hr["points"]] == [84.0, 86.0]
    assert hr["points"][-1][0] == answer["until"] == hr["latest"]["ts"]


def test_map_and_lactate_points_carry_no_news2_points():
    engine = _engine((SignalCode.MAP, 58, 30), (SignalCode.LACTATE, 4.1, 20))
    answer = _trends(engine)
    assert _channel(answer, "map")["points"] == [[_at(30).isoformat(), 58.0, None]]
    assert _channel(answer, "lactate")["points"] == [[_at(20).isoformat(), 4.1, None]]


def test_a_channel_over_the_cap_is_thinned_and_says_so():
    engine = _engine(*[(SignalCode.SPO2, 96.0 if i != 1000 else 85.0, (2500 - i) * 0.5)
                       for i in range(2500)])
    spo2 = _channel(_trends(engine), "spo2")
    assert spo2["thinned"] is True and spo2["total_points"] == 2500
    assert len(spo2["points"]) <= TRENDS_MAX_POINTS
    assert 85.0 in [value for _ts, value, _points in spo2["points"]]
    assert spo2["latest"]["ts"] == _at(0.5).isoformat()


# --- latest -------------------------------------------------------------------------------------

def test_the_delta_spans_the_whole_history_not_the_window():
    engine = _engine((SignalCode.HEART_RATE, 80, 30 * 60), (SignalCode.HEART_RATE, 88, 60))
    hr = _channel(_trends(engine, hours=6), "heart_rate")
    assert len(hr["points"]) == 1                # the previous reading is outside the window …
    assert hr["latest"]["delta"] == 8.0          # … and is still the one the change is measured from


def test_one_measurement_has_no_delta():
    hr = _channel(_trends(_engine((SignalCode.HEART_RATE, 84, 30))), "heart_rate")
    assert hr["latest"] == {"ts": _at(30).isoformat(), "value": 84.0, "delta": None,
                            "news2_points": 0, "within_own_normal": None}


def test_a_reading_delivered_twice_is_not_the_previous_one():
    """The edge uplink delivers at least once (`edge/uplink.py` resends a POST that timed out after
    the hub had processed it), so the same reading can arrive twice and sort in at the same instant.
    118 then 130, the 130 twice, moved +12 — not 0 ("unchanged"), which would read as reassurance."""
    engine = _engine((SignalCode.HEART_RATE, 118, 120), (SignalCode.HEART_RATE, 130, 60),
                     (SignalCode.HEART_RATE, 130, 60))
    hr = _channel(_trends(engine), "heart_rate")
    assert len(engine.state("S-001").history(SignalCode.HEART_RATE)) == 3     # both copies are held
    assert hr["latest"]["value"] == 130.0
    assert hr["latest"]["delta"] == 12.0


def test_one_measurement_delivered_twice_still_has_no_delta():
    engine = _engine((SignalCode.HEART_RATE, 84, 30), (SignalCode.HEART_RATE, 84, 30))
    hr = _channel(_trends(engine), "heart_rate")
    assert len(engine.state("S-001").history(SignalCode.HEART_RATE)) == 2     # both copies are held
    assert hr["latest"]["delta"] is None


def test_the_delta_is_the_clinicians_number_not_floating_point_noise():
    engine = _engine((SignalCode.TEMPERATURE, 36.9, 120), (SignalCode.TEMPERATURE, 37.2, 60))
    assert _channel(_trends(engine), "temperature")["latest"]["delta"] == 0.3


def test_news2_points_are_the_engines_score_and_none_for_map_and_lactate():
    engine = _engine((SignalCode.HEART_RATE, 132, 10), (SignalCode.RESP_RATE, 22, 10),
                     (SignalCode.SPO2, 95, 10), (SignalCode.SBP, 120, 10),
                     (SignalCode.TEMPERATURE, 38.5, 10), (SignalCode.MAP, 60, 10),
                     (SignalCode.LACTATE, 4.0, 10))
    answer = _trends(engine)
    breakdown = news2_score(engine.state("S-001")).breakdown
    for key, parameter in (("heart_rate", "pulse"), ("resp_rate", "respiration_rate"),
                           ("spo2", "spo2"), ("sbp", "systolic_bp"), ("temperature", "temperature")):
        assert _channel(answer, key)["latest"]["news2_points"] == breakdown[parameter], key
    assert [_channel(answer, k)["latest"]["news2_points"] for k in ("heart_rate", "resp_rate", "spo2")] == [3, 2, 1]
    assert _channel(answer, "map")["latest"]["news2_points"] is None
    assert _channel(answer, "lactate")["latest"]["news2_points"] is None


# --- bands --------------------------------------------------------------------------------------

def test_the_bands_are_the_rules_own_rows_and_only_on_the_news2_channels():
    answer = _trends(_engine((SignalCode.HEART_RATE, 84, 30)))
    for key, parameter in (("heart_rate", "pulse"), ("resp_rate", "respiration_rate"),
                           ("spo2", "spo2"), ("sbp", "systolic_bp"), ("temperature", "temperature")):
        assert _channel(answer, key)["bands"]["news2"] == [b.as_dict() for b in NEWS2_BANDS[parameter]]
    for key in ("map", "lactate"):
        assert _channel(answer, key)["bands"]["news2"] is None
    assert {c["bands"]["device"] for c in answer["channels"]} == {None}     # Stage B's, reserved


def test_the_heart_rate_bands_as_the_screen_receives_them():
    hr = _channel(_trends(_engine((SignalCode.HEART_RATE, 84, 30))), "heart_rate")
    assert hr["bands"]["news2"] == [
        {"low": None, "high": 40, "points": 3}, {"low": 40, "high": 50, "points": 1},
        {"low": 50, "high": 90, "points": 0}, {"low": 90, "high": 110, "points": 1},
        {"low": 110, "high": 130, "points": 2}, {"low": 130, "high": None, "points": 3},
    ]


def test_the_patients_own_normal_is_served_and_judged_by_the_engine():
    engine = _engine((SignalCode.HEART_RATE, 108, 30), (SignalCode.SPO2, 96, 30))
    engine.set_profile(PatientProfile("S-001", baselines={
        SignalCode.HEART_RATE: BaselineRange(100, 115)}))
    answer = _trends(engine)
    hr = _channel(answer, "heart_rate")
    assert hr["bands"]["own_normal"] == {"low": 100, "high": 115}
    assert hr["latest"]["within_own_normal"] is True
    assert _channel(answer, "spo2")["bands"]["own_normal"] is None
    assert _channel(answer, "spo2")["latest"]["within_own_normal"] is None

    engine.ingest(Observation("S-001", SignalCode.HEART_RATE, 121, "u", _at(5), "test"), now=_at(5))
    assert _channel(_trends(engine), "heart_rate")["latest"]["within_own_normal"] is False


# --- markers ------------------------------------------------------------------------------------

def _first_seen(audit, kind: str, minutes_ago: float, *, patient: str = "S-001",
                tenant: str = HOSPITAL, event_type: str = "first_seen") -> None:
    audit.append(AuditEvent(tenant, event_type, patient, kind, {"at": _at(minutes_ago).isoformat()}))


def test_alarm_markers_are_episode_starts_inside_the_window_only():
    audit = InMemoryAuditLog()
    _first_seen(audit, "news2", 60)                              # in
    _first_seen(audit, "septic_shock", 30 * 60)                  # before the window
    _first_seen(audit, "news2", 60, patient="S-002")             # another patient
    _first_seen(audit, "news2", 60, tenant="HOSP2")              # another hospital
    _first_seen(audit, "news2", 50, event_type="alert")          # a re-emission, not an episode
    answer = _trends(_engine((SignalCode.SPO2, 85, 60)), audit)
    assert answer["markers"] == [{"ts": _at(60).isoformat(), "kind": "alarm", "label": "news2"}]


def test_antibiotic_markers_are_charted_doses_inside_the_window():
    engine = _engine((SignalCode.ANTIBIOTIC_ADMINISTERED, 1.0, 120),
                     (SignalCode.ANTIBIOTIC_ADMINISTERED, 0.0, 60),       # charted "not given"
                     (SignalCode.ANTIBIOTIC_ADMINISTERED, 1.0, 30 * 60))  # before the window
    assert _trends(engine)["markers"] == [
        {"ts": _at(120).isoformat(), "kind": "antibiotic", "label": "antibiotic_administered"}]


def test_markers_are_in_time_order():
    audit = InMemoryAuditLog()
    _first_seen(audit, "news2", 30)
    engine = _engine((SignalCode.ANTIBIOTIC_ADMINISTERED, 1.0, 90), (SignalCode.SPO2, 85, 30))
    assert [m["kind"] for m in _trends(engine, audit)["markers"]] == ["antibiotic", "alarm"]


def test_more_episodes_than_the_read_takes_are_flagged_not_cut_quietly():
    """Today the engine never drops an alert kind from `active_alerts` (pipeline.py:93–96), so
    `first_seen` is stamped once per (patient, kind) and a ▲ means "the first time this finding was
    raised for this patient"; a window holds a handful. IF alert episodes are ever cleared and
    re-raised, `AckStore.prune` would drop the stamp each time and a flapping alert would write a row
    each time it came back — about 30 an hour at one reading a minute, about 2 160 in the 72-hour
    window. The read is oldest-first, so past its limit the NEWEST marks — the end a clinician looks
    at — would be the missing ones; the answer says so instead of drawing a quiet end."""
    assert TRENDS_MARKER_LIMIT >= 72 * 30
    engine = _engine((SignalCode.SPO2, 85, 60))
    few = InMemoryAuditLog()
    _first_seen(few, "news2", 60)
    assert _trends(engine, few)["markers_truncated"] is False

    many = InMemoryAuditLog()
    for i in range(TRENDS_MARKER_LIMIT + 1):
        _first_seen(many, "news2", 600 - i * 0.1)
    answer = _trends(engine, many)
    assert answer["markers_truncated"] is True
    assert len(answer["markers"]) == TRENDS_MARKER_LIMIT
    assert answer["markers"][-1]["ts"] == _at(600 - (TRENDS_MARKER_LIMIT - 1) * 0.1).isoformat()


def test_exactly_the_limit_of_episodes_is_not_a_truncation():
    """Nothing was cut, so nothing is flagged: the flag means "the read stopped short", not "the
    read came back full"."""
    engine = _engine((SignalCode.SPO2, 85, 60))
    exact = InMemoryAuditLog()
    for i in range(TRENDS_MARKER_LIMIT):
        _first_seen(exact, "news2", 600 - i * 0.1)
    answer = _trends(engine, exact)
    assert answer["markers_truncated"] is False
    assert len(answer["markers"]) == TRENDS_MARKER_LIMIT
    assert answer["markers"][-1]["ts"] == _at(600 - (TRENDS_MARKER_LIMIT - 1) * 0.1).isoformat()


# --- readings that are not numbers ---------------------------------------------------------------

def test_a_reading_that_is_not_a_number_is_never_drawn_counted_or_latest():
    """Rows from before the gateways refused NaN and ±inf (Task 3b) still replay from the audit into
    PatientState, and `rehydrate` passes no gateway. Left in, a NaN would make this answer
    unserialisable — Starlette's JSONResponse refuses it, so the read would answer 500 — and a NaN
    first in a thinning slice would take that slice's minimum and maximum."""
    engine = _engine((SignalCode.HEART_RATE, 80, 120), (SignalCode.HEART_RATE, 84, 90),
                     (SignalCode.HEART_RATE, float("nan"), 60), (SignalCode.HEART_RATE, float("inf"), 30))
    engine.set_profile(PatientProfile("S-001", baselines={
        SignalCode.HEART_RATE: BaselineRange(70, 90)}))
    answer = _trends(engine)
    json.dumps(answer, allow_nan=False)          # what Starlette's JSONResponse does
    hr = _channel(answer, "heart_rate")
    assert hr["points"] == [[_at(120).isoformat(), 80.0, 0], [_at(90).isoformat(), 84.0, 0]]
    assert (hr["thinned"], hr["total_points"]) == (False, 2)
    assert (hr["latest"]["ts"], hr["latest"]["value"], hr["latest"]["delta"]) == (_at(90).isoformat(), 84.0, 4.0)
    # The engine's breakdown scored the newest reading — the inf — so its points are not 84's to print.
    # Nor is a verdict: 84 sits inside the charted 70–90, but the engine judges the newest reading,
    # and "within normal" printed beside that could contradict what it says.
    assert hr["latest"]["news2_points"] is None
    assert hr["latest"]["within_own_normal"] is None
    assert hr["bands"]["own_normal"] == {"low": 70, "high": 90}


def test_a_gap_of_not_a_number_mid_window_leaves_the_finite_newest_reading_scored_and_judged():
    """The `scored` guard must not over-reach: with a NaN in the MIDDLE of the history the newest
    reading is the engine's scored one, so its points and its own-normal verdict are served, and the
    delta is measured from the last finite reading before it."""
    engine = _engine((SignalCode.HEART_RATE, 80, 120), (SignalCode.HEART_RATE, float("nan"), 90),
                     (SignalCode.HEART_RATE, 132, 60))
    engine.set_profile(PatientProfile("S-001", baselines={
        SignalCode.HEART_RATE: BaselineRange(120, 140)}))
    hr = _channel(_trends(engine), "heart_rate")
    assert hr["points"] == [[_at(120).isoformat(), 80.0, 0], [_at(60).isoformat(), 132.0, 3]]
    assert (hr["thinned"], hr["total_points"]) == (False, 2)
    assert hr["latest"] == {"ts": _at(60).isoformat(), "value": 132.0, "delta": 52.0,
                            "news2_points": 3, "within_own_normal": True}


# --- what it refuses, and what it never does ----------------------------------------------------

def test_an_unmeasured_patient_is_read_without_being_created():
    engine = _engine((SignalCode.HEART_RATE, 84, 30))
    answer = _trends(engine, patient="S-009")
    assert {c["key"]: c["points"] for c in answer["channels"]} == {k: [] for k in _PUBLISHED_SIGNALS}
    assert "S-009" not in engine.patient_ids()


def test_a_charted_normal_with_no_readings_is_served_without_creating_the_patient():
    engine = _engine((SignalCode.HEART_RATE, 84, 30))
    engine.set_profile(PatientProfile("S-002", baselines={
        SignalCode.HEART_RATE: BaselineRange(100, 115)}))
    answer = _trends(engine, patient="S-002")
    hr = _channel(answer, "heart_rate")
    assert hr["bands"]["own_normal"] == {"low": 100, "high": 115}
    assert hr["points"] == [] and hr["latest"] is None
    assert answer["markers"] == []
    assert "S-002" not in engine.patient_ids()


def test_a_now_in_another_zone_is_answered_in_utc():
    audit = InMemoryAuditLog()
    audit.append(AuditEvent(HOSPITAL, "first_seen", "S-001", "news2",
                            {"at": "2026-10-19T12:00:00+04:00"}))      # 08:00 UTC
    engine = _engine((SignalCode.HEART_RATE, 84, 30))
    baku = timezone(timedelta(hours=4))
    answer = patient_trends(engine, audit, hospital=HOSPITAL, patient_id="S-001", hours=6,
                            now=NOW.astimezone(baku))                  # 13:00+04:00, the same instant
    assert (answer["since"], answer["until"], answer["generated_at"]) == (
        "2026-10-19T03:00:00+00:00", "2026-10-19T09:00:00+00:00", "2026-10-19T09:00:00+00:00")
    assert answer["markers"] == [{"ts": "2026-10-19T08:00:00+00:00", "kind": "alarm", "label": "news2"}]
    assert answer == _trends(engine, audit, hours=6)                   # nothing depends on the zone


@pytest.mark.parametrize("hours", [0, 12, 48, 168])
def test_a_window_other_than_the_three_is_refused(hours):
    assert hours not in TRENDS_HOURS
    with pytest.raises(ValueError, match="hours"):
        _trends(_engine((SignalCode.HEART_RATE, 84, 30)), hours=hours)


def test_a_now_without_a_zone_is_refused():
    with pytest.raises(ValueError, match="time zone"):
        patient_trends(Engine(), InMemoryAuditLog(), hospital=HOSPITAL, patient_id="S-001",
                       hours=24, now=datetime(2026, 10, 19, 9, 0))


def test_a_profile_row_with_a_bound_that_is_not_a_number_never_reaches_the_answer():
    """An audit row written before the profile door refused non-finite bounds replays through
    `rehydrate`. Refused there now, the row is skipped: the patient has no own normal from it (with
    an earlier profile row, the replay keeps that earlier profile) — not a NaN band that JSON
    cannot carry (Starlette's JSONResponse has allow_nan=False)."""
    from homunculus.api.ackstore import AckStore
    from homunculus.api.audit import AuditRecord
    from homunculus.api.rehydrate import rehydrate

    engine = _engine((SignalCode.HEART_RATE, 84, 30))
    row = AuditRecord(id=1, ts=NOW.isoformat(), tenant=HOSPITAL, event_type="profile", patient_id="S-001",
                      subject="", payload={"baselines": {"heart_rate": {"low": "nan", "high": 115}}})
    rehydrate(engine, AckStore(), [row])
    answer = _trends(engine)
    json.dumps(answer, allow_nan=False)
    assert _channel(answer, "heart_rate")["bands"]["own_normal"] is None

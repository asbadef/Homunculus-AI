# homunculus-engine/tests/test_tasks_schedule.py
"""G3-02 (spec D2–D5): the vital task is derived, never stored. These are the pure functions."""
from datetime import datetime, timedelta, timezone

from homunculus.api.tasks import (
    BAND_KEYS, DEFAULT_SETTINGS, NEWS2_HAND_CODES, TaskSettings, band_of, hand_state, shift_window,
    vital_task, zone_of,
)
from homunculus.canonical import SignalCode

BAKU = timezone(timedelta(hours=4))          # a fixed offset: no tzdata needed on Windows
UTC = timezone.utc
T0 = datetime(2026, 11, 9, 10, 0, tzinfo=UTC)   # 14:00 in Baku


class TestBandOf:
    def test_zero_without_a_red_parameter_is_b0(self):
        assert band_of(0, False) == "b0"

    def test_one_to_four_is_b1_4_unless_a_parameter_scored_three(self):
        assert band_of(1, False) == "b1_4"
        assert band_of(4, False) == "b1_4"
        assert band_of(3, True) == "b3_single"

    def test_five_six_and_seven_plus(self):
        assert band_of(5, False) == "b5_6"
        assert band_of(6, True) == "b5_6"          # a red parameter inside 5–6 keeps the higher band
        assert band_of(7, False) == "b7"
        assert band_of(12, True) == "b7"

    def test_the_keys_are_the_settings_keys(self):
        assert set(BAND_KEYS) == {"b0", "b1_4", "b3_single", "b5_6", "b7"}
        assert set(DEFAULT_SETTINGS.intervals) == set(BAND_KEYS)
        assert DEFAULT_SETTINGS.intervals == {"b0": 720, "b1_4": None, "b3_single": None, "b5_6": None, "b7": None}


class TestShiftWindow:
    def test_the_morning_shift_in_baku(self):
        start, end = shift_window(T0, BAKU, (8, 20))
        assert start == datetime(2026, 11, 9, 8, 0, tzinfo=BAKU)
        assert end == start + timedelta(hours=24)

    def test_the_night_shift_crosses_midnight(self):
        night = datetime(2026, 11, 9, 23, 30, tzinfo=UTC)        # 03:30 Baku, 10 Nov
        start, _ = shift_window(night, BAKU, (8, 20))
        assert start == datetime(2026, 11, 9, 20, 0, tzinfo=BAKU)

    def test_exactly_at_the_boundary_starts_the_new_shift(self):
        at = datetime(2026, 11, 9, 16, 0, tzinfo=UTC)          # 20:00 Baku
        start, _ = shift_window(at, BAKU, (8, 20))
        assert start == datetime(2026, 11, 9, 20, 0, tzinfo=BAKU)

    def test_the_starts_may_come_in_any_order(self):
        assert shift_window(T0, BAKU, (20, 8)) == shift_window(T0, BAKU, (8, 20))


class TestVitalTask:
    def test_plan_due_late(self):
        anchor = T0 - timedelta(minutes=100)
        v = vital_task(now=T0, anchor=anchor, admitted_at=None, interval_min=240, grace_min=30, skipped_until=None)
        assert v["state"] == "plan" and v["due_at"] == anchor + timedelta(minutes=240)
        v = vital_task(now=T0, anchor=T0 - timedelta(minutes=250), admitted_at=None, interval_min=240, grace_min=30, skipped_until=None)
        assert v["state"] == "due"
        v = vital_task(now=T0, anchor=T0 - timedelta(minutes=271), admitted_at=None, interval_min=240, grace_min=30, skipped_until=None)
        assert v["state"] == "late"

    def test_the_grace_edge_is_still_due(self):
        v = vital_task(now=T0, anchor=T0 - timedelta(minutes=270), admitted_at=None, interval_min=240, grace_min=30, skipped_until=None)
        assert v["state"] == "due"

    def test_no_interval_means_no_task(self):
        assert vital_task(now=T0, anchor=T0, admitted_at=None, interval_min=None, grace_min=30, skipped_until=None) is None

    def test_without_a_hand_entry_the_admission_is_the_anchor(self):
        admitted = T0 - timedelta(hours=13)
        v = vital_task(now=T0, anchor=None, admitted_at=admitted, interval_min=720, grace_min=30, skipped_until=None)
        assert v["anchor_at"] == admitted and v["state"] == "late"

    def test_neither_is_unknown(self):
        v = vital_task(now=T0, anchor=None, admitted_at=None, interval_min=720, grace_min=30, skipped_until=None)
        assert v["state"] == "unknown" and v["due_at"] is None and v["anchor_at"] is None

    def test_a_skip_hides_the_task_until_its_moment(self):
        v = vital_task(now=T0, anchor=T0 - timedelta(hours=5), admitted_at=None, interval_min=240, grace_min=30,
                       skipped_until=T0 + timedelta(hours=3))
        assert v["state"] == "skipped" and v["due_at"] == T0 + timedelta(hours=3) and v["skipped_until"] == T0 + timedelta(hours=3)
        v = vital_task(now=T0, anchor=T0 - timedelta(hours=5), admitted_at=None, interval_min=240, grace_min=30,
                       skipped_until=T0 - timedelta(minutes=1))
        assert v["state"] == "late"                      # a skip in the past no longer hides anything


class TestHandState:
    def test_open_is_late_only_after_the_grace(self):
        due = T0 - timedelta(minutes=31)
        assert hand_state("open", due, grace_min=30, now=T0) == ("open", True)
        assert hand_state("open", T0 - timedelta(minutes=30), grace_min=30, now=T0) == ("open", False)
        assert hand_state("done", due, grace_min=30, now=T0) == ("done", False)
        assert hand_state("skipped", due, grace_min=30, now=T0) == ("skipped", False)


class TestZoneOf:
    def test_utc_and_an_unknown_name_fall_back_to_utc(self):
        assert zone_of("UTC") is UTC
        assert zone_of(None) is UTC
        assert zone_of("Mars/Olympus") is UTC


def test_the_hand_codes_are_news2s_seven_inputs():
    assert NEWS2_HAND_CODES == frozenset({
        SignalCode.RESP_RATE.value, SignalCode.SPO2.value, SignalCode.SBP.value, SignalCode.HEART_RATE.value,
        SignalCode.TEMPERATURE.value, SignalCode.SUPPLEMENTAL_OXYGEN.value, SignalCode.ACVPU.value})


def test_settings_validation():
    ok = TaskSettings(shift_start_a=8, shift_start_b=20, grace_min=30, intervals=dict(DEFAULT_SETTINGS.intervals))
    assert ok.refusal() is None
    assert TaskSettings(8, 8, 30, dict(DEFAULT_SETTINGS.intervals)).refusal() == "task_settings_range"
    assert TaskSettings(8, 20, 241, dict(DEFAULT_SETTINGS.intervals)).refusal() == "task_settings_range"
    bad = dict(DEFAULT_SETTINGS.intervals)
    bad["b7"] = 4
    assert TaskSettings(8, 20, 30, bad).refusal() == "task_settings_range"
    bad["b7"] = 1441
    assert TaskSettings(8, 20, 30, bad).refusal() == "task_settings_range"

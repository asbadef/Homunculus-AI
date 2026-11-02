"""G3-01 (D5–D7, X6, X12): the chart door takes the bedside set — the five vitals and MAP — in the trend
endpoint's units, held to slip bounds, whole numbers where a monitor counts, MAP below the systolic within one
request, and a measurement time at most a day back and never ahead. Synthetic patients and values only
(CLAUDE.md rule 6)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api import trends
from homunculus.api.app import create_app
from homunculus.api.clinical import (
    AT_FUTURE, AT_TOO_OLD, BEDSIDE_VITALS, CHARTABLE, MAP_NOT_BELOW_SBP, ClinicalEntryError, build_entries,
)
from homunculus.canonical import SignalCode
from homunculus.rules.news2 import points_for

TOKEN = "tok"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
# A full bedside set, every value inside its bound (synthetic).
SET = [{"code": "resp_rate", "value": 22}, {"code": "spo2", "value": 95}, {"code": "sbp", "value": 104},
       {"code": "map", "value": 72}, {"code": "heart_rate", "value": 96}, {"code": "temperature", "value": 37.9}]


@pytest.fixture()
def client():
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False)
    with TestClient(app) as c:
        yield c


def _ago(minutes: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()


def _chart(client, entries, at=None, pid="bed-3"):
    body = {"entries": entries}
    if at is not None:
        body["recorded_at"] = at
    return client.post(f"/clinical/{pid}", json=body, headers=AUTH)


def _card(client, pid="bed-3"):
    return next(p for p in client.get("/patients", headers=AUTH).json()["patients"] if p["patient_id"] == pid)


class TestTheSixAreChartable:
    def test_the_bedside_set_is_the_six_codes_the_door_opened(self):
        assert BEDSIDE_VITALS == {SignalCode.RESP_RATE, SignalCode.SPO2, SignalCode.SBP, SignalCode.MAP,
                                  SignalCode.HEART_RATE, SignalCode.TEMPERATURE}
        assert BEDSIDE_VITALS <= set(CHARTABLE)

    def test_each_unit_is_the_trend_endpoints(self):
        """X6: one unit per channel for the door and the charts; no rule reads it."""
        for code in BEDSIDE_VITALS:
            assert CHARTABLE[code] == trends._UNITS[code.value], code

    def test_a_full_set_charts_in_one_request(self, client):
        r = _chart(client, SET, at=_ago(5))
        assert r.status_code == 200, r.text
        assert r.json()["charted"] == 6

    def test_the_card_scores_hand_entered_vitals_with_the_engines_points(self, client):
        assert _chart(client, SET, at=_ago(5)).status_code == 200
        breakdown = _card(client)["latest"]["news2"]["breakdown"]
        assert breakdown["respiration_rate"] == points_for("respiration_rate", 22)
        assert breakdown["spo2"] == points_for("spo2", 95)
        assert breakdown["systolic_bp"] == points_for("systolic_bp", 104)
        assert breakdown["pulse"] == points_for("pulse", 96)
        assert breakdown["temperature"] == points_for("temperature", 37.9)


class TestTheSlipBounds:
    @pytest.mark.parametrize("code,value", [("resp_rate", 81), ("spo2", 101), ("sbp", 301), ("map", 301),
                                            ("heart_rate", 301), ("temperature", 24.9), ("temperature", 45.1)])
    def test_a_slipped_digit_is_refused(self, client, code, value):
        r = _chart(client, [{"code": code, "value": value}])
        assert r.status_code == 400
        assert "aralığın" in r.json()["detail"]

    @pytest.mark.parametrize("code,value", [("resp_rate", 0), ("spo2", 100), ("sbp", 300), ("heart_rate", 0),
                                            ("temperature", 25), ("temperature", 45)])
    def test_the_bounds_are_inclusive(self, client, code, value):
        assert _chart(client, [{"code": code, "value": value}]).status_code == 200

    @pytest.mark.parametrize("code", ["resp_rate", "spo2", "sbp", "map", "heart_rate"])
    def test_a_counted_vital_is_a_whole_number(self, client, code):
        r = _chart(client, [{"code": code, "value": 88.5}])
        assert (r.status_code, r.json()["detail"]) == (400, f"{code}: tam sayı olmalı")

    def test_a_temperature_takes_a_decimal(self, client):
        assert _chart(client, [{"code": "temperature", "value": 36.8}]).status_code == 200


class TestMapBelowTheSystolic:
    @pytest.mark.parametrize("map_value", [90, 95])
    def test_map_at_or_above_the_systolic_in_one_request_is_refused(self, client, map_value):
        r = _chart(client, [{"code": "sbp", "value": 90}, {"code": "map", "value": map_value}])
        assert (r.status_code, r.json()["detail"]) == (400, MAP_NOT_BELOW_SBP)

    def test_map_below_the_systolic_is_charted(self, client):
        assert _chart(client, [{"code": "sbp", "value": 90}, {"code": "map", "value": 65}]).status_code == 200

    def test_a_map_alone_is_not_compared_with_an_older_systolic(self, client):
        """The rule is about one form's two numbers; a MAP charted on its own is a reading of its own."""
        assert _chart(client, [{"code": "sbp", "value": 90}]).status_code == 200
        assert _chart(client, [{"code": "map", "value": 95}]).status_code == 200


class TestTheMeasurementTime:
    def test_a_bedside_time_more_than_a_day_back_is_refused(self, client):
        r = _chart(client, [{"code": "heart_rate", "value": 80}], at=_ago(25 * 60))
        assert (r.status_code, r.json()["detail"]) == (400, AT_TOO_OLD)

    def test_a_bedside_time_within_the_day_is_charted(self, client):
        assert _chart(client, [{"code": "heart_rate", "value": 80}], at=_ago(23 * 60)).status_code == 200

    def test_a_bedside_time_ahead_of_the_clock_is_refused(self, client):
        r = _chart(client, [{"code": "heart_rate", "value": 80}], at=_ago(-10))
        assert (r.status_code, r.json()["detail"]) == (400, AT_FUTURE)

    def test_two_minutes_of_clock_skew_are_not_ahead(self, client):
        assert _chart(client, [{"code": "heart_rate", "value": 80}], at=_ago(-1)).status_code == 200

    def test_no_time_is_the_servers_clock(self, client):
        """X12: an untouched time is sent as none; nothing to bound."""
        assert _chart(client, [{"code": "heart_rate", "value": 80}]).status_code == 200

    def test_the_other_codes_keep_todays_rule(self, client):
        """D7: ACVPU, oxygen and the labs are charted at fixed past times by today's callers and tests."""
        old = datetime(2026, 9, 8, 9, 0, tzinfo=timezone.utc).isoformat()
        r = _chart(client, [{"code": "lactate", "value": 3.4}, {"code": "acvpu", "value": 0}], at=old)
        assert r.status_code == 200, r.text

    def test_build_entries_holds_the_rule_without_the_api(self):
        now = datetime(2026, 11, 2, 9, 0, tzinfo=timezone.utc)
        with pytest.raises(ClinicalEntryError, match="24 saat"):
            build_entries("bed-3", [{"code": "spo2", "value": 95}], charted_by="hem.ayse",
                          recorded_at=now - timedelta(hours=25), now=now)

"""The branch that can actually fire on the pilot ward, end to end.

Measured 07.09.2026: the three existing scenarios drive the sepsis branch from lactate,
platelets, vasopressor rates and fluid volumes — none of which the site's devices send. NEWS2,
the one rule that runs entirely on what a monitor produces, had no scenario, no end-to-end test
and no demo data. So the thing being tested could not happen on a ward, and the thing happening
on the ward was not being tested.

These two scenarios are the same deteriorating patient seen through two bridges: one with the
ventilator connected, one without. The gap between them is the measured argument for connecting
it — kept here as an assertion rather than a sentence, so it cannot quietly stop being true.
"""
from __future__ import annotations

from collections import OrderedDict
from pathlib import Path

import pytest

import homunculus.scenarios
from homunculus.gateway.fhir import parse_fhir_observation
from homunculus.pipeline import Engine
from homunculus.rules import news2
from homunculus.scenarios.loader import load_scenario

SCENARIOS = Path(homunculus.scenarios.__file__).parent
FULL = SCENARIOS / "news2_deterioration.yaml"
PARTIAL = SCENARIOS / "news2_partial_nce_only.yaml"


def _run(path: Path):
    """Replay a scenario, returning {minute: (News2Result, [alert kinds seen that minute])}."""
    frames = load_scenario(path)
    start = frames[0][0]
    engine = Engine()
    per_minute: OrderedDict[int, tuple] = OrderedDict()
    for ts, resource in frames:
        obs = parse_fhir_observation(resource)
        alerts = engine.ingest(obs, ts)
        minute = int((ts - start).total_seconds() // 60)
        per_minute[minute] = (news2.score(engine.state(obs.patient_id)),
                              [a.kind for a in alerts])
    return per_minute


@pytest.fixture(scope="module")
def full():
    return _run(FULL)


@pytest.fixture(scope="module")
def partial():
    return _run(PARTIAL)


class TestTheFullPicture:
    """Both bridges connected: five of five vitals."""

    @pytest.mark.parametrize("minute,expected", [(0, 0), (60, 1), (120, 6), (180, 10), (240, 13)])
    def test_the_score_follows_the_measured_trajectory(self, full, minute, expected):
        assert full[minute][0].total == expected

    def test_no_score_is_partial(self, full):
        assert all(not result.partial for result, _ in full.values())

    def test_nothing_fires_while_the_patient_is_settled(self, full):
        assert "news2" not in full[0][1]
        assert "news2" not in full[60][1]

    def test_the_first_alert_arrives_at_two_hours(self, full):
        assert "news2" in full[120][1]

    def test_respiration_alone_reaches_the_maximum_by_three_hours(self, full):
        """>=25 scores 3, which trips "one parameter at maximum" whatever the total is."""
        assert full[180][0].breakdown["respiration_rate"] == 3
        assert full[180][0].red_param is True


class TestWhatTheSiteActuallySeesToday:
    """NCE only: no respiration rate, so every score is partial and can only understate."""

    @pytest.mark.parametrize("minute,expected", [(0, 0), (60, 1), (120, 4), (180, 7), (240, 10)])
    def test_the_score_follows_the_measured_trajectory(self, partial, minute, expected):
        assert partial[minute][0].total == expected

    def test_every_score_is_declared_partial(self, partial):
        assert all(result.partial for result, _ in partial.values())

    def test_the_missing_parameter_is_named(self, partial):
        assert partial[120][0].missing == ["respiration_rate"]


class TestTheGapBetweenThem:
    """The measured case for plugging in the ventilator."""

    def test_the_first_alert_arrives_an_hour_later(self, full, partial):
        first_full = next(m for m, (_r, kinds) in full.items() if "news2" in kinds)
        first_partial = next(m for m, (_r, kinds) in partial.items() if "news2" in kinds)
        assert first_full == 120
        assert first_partial == 180
        assert first_partial - first_full == 60

    def test_at_two_hours_one_asks_for_review_and_the_other_asks_for_nothing(self, full, partial):
        assert "news2" in full[120][1]
        assert "news2" not in partial[120][1]

    def test_the_partial_score_never_exceeds_the_full_one(self, full, partial):
        """A missing parameter scores 0, so partial can only ever understate — never the
        reverse. If this ever fails, the honesty of the whole partial-score story is gone."""
        for minute in full:
            assert partial[minute][0].total <= full[minute][0].total

    def test_the_single_parameter_rule_is_lost_without_respiration(self, full, partial):
        assert full[180][0].red_param is True
        assert partial[180][0].red_param is False


class TestTheScenariosUseOnlyWhatDevicesSend:
    """A scenario built from signals no device produces cannot test the ward."""

    # What the site's two bridges emit, from deploy/local/nce-mapping.json and
    # medibus/medibus-mapping.example.json.
    DEVICE_SIGNALS = {"sbp", "map", "spo2", "heart_rate", "temperature",
                      "resp_rate", "fio2", "on_resp_support"}

    @pytest.mark.parametrize("path", [FULL, PARTIAL])
    def test_every_code_is_one_a_bridge_actually_emits(self, path):
        codes = {resource["code"]["coding"][0]["code"] for _ts, resource in load_scenario(path)}
        assert codes <= self.DEVICE_SIGNALS, f"not sent by any bridge: {codes - self.DEVICE_SIGNALS}"

    def test_the_nce_only_scenario_uses_nothing_the_ventilator_would_add(self):
        codes = {resource["code"]["coding"][0]["code"] for _ts, resource in load_scenario(PARTIAL)}
        assert not (codes & {"resp_rate", "fio2", "on_resp_support"})

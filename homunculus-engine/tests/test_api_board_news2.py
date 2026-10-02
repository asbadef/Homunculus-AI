"""The board publishes the engine's NEWS2, and publishes it honestly.

Until 07.09.2026 the board carried no NEWS2 at all and no systolic pressure. The dashboard
therefore scored NEWS2 itself, from mean arterial pressure with bands of its own invention and
with the oxygen and consciousness terms missing — so a clinician could read one number on the
bed card while the engine had fired an alert on a different one. These tests hold the single
source of truth in place.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from homunculus.api.ackstore import AckStore
from homunculus.api.board import patient_board
from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine

WHEN = datetime(2026, 9, 8, 9, 0, tzinfo=timezone.utc)

# The five continuous vitals NEWS2 scores, and a deteriorating value for each.
DETERIORATING = {
    SignalCode.RESP_RATE: (26.0, "/min"),      # >=25 -> 3
    SignalCode.SPO2: (91.0, "%"),              # <=91 -> 3
    SignalCode.SBP: (88.0, "mmHg"),            # <=90 -> 3
    SignalCode.HEART_RATE: (132.0, "/min"),    # >=131 -> 3
    SignalCode.TEMPERATURE: (39.4, "Cel"),     # >39 -> 2
}


def _engine(signals: dict[SignalCode, tuple[float, str]], at: datetime = WHEN) -> Engine:
    engine = Engine()
    for code, (value, unit) in signals.items():
        engine.ingest(Observation(patient_id="bed-1", code=code, value=value, unit=unit,
                                  timestamp=at, source_device="test"), at)
    return engine


def _board(engine: Engine) -> dict:
    return patient_board(engine, "bed-1", AckStore())


def test_board_carries_the_engines_news2_not_nothing():
    board = _board(_engine(DETERIORATING))
    news2 = board["latest"]["news2"]
    assert news2 is not None
    # 3+3+3+3+2 = 14, plus air (0) and Alert (0).
    assert news2["total"] == 14
    assert news2["partial"] is False
    assert news2["missing"] == []
    assert news2["red_param"] is True


def test_board_carries_systolic_pressure():
    """NEWS2's blood-pressure term is systolic. Without it on the board no consumer can check
    the score, and the dashboard substituted MAP."""
    board = _board(_engine(DETERIORATING))
    assert board["latest"]["sbp"] == 88.0
    assert "map" in board["latest"]  # MAP still travels; it is a SOFA input, just not NEWS2's


def test_a_missing_vital_is_declared_not_hidden():
    """The pilot's Welch Allyn bridge sends no respiration rate, so every score there is partial.
    A partial NEWS2 can only understate — the board has to say so."""
    without_rr = {c: v for c, v in DETERIORATING.items() if c is not SignalCode.RESP_RATE}
    news2 = _board(_engine(without_rr))["latest"]["news2"]

    assert news2["partial"] is True
    assert news2["missing"] == ["respiration_rate"]
    assert news2["total"] == 11  # the 3 points respiration would have added are simply absent


def test_breakdown_names_every_parameter_so_a_score_can_be_audited():
    news2 = _board(_engine(DETERIORATING))["latest"]["news2"]
    assert set(news2["breakdown"]) == {
        "respiration_rate", "spo2", "systolic_bp", "pulse", "temperature",
        "air_or_oxygen", "consciousness",
    }
    assert sum(news2["breakdown"].values()) == news2["total"]


def test_a_settled_patient_scores_zero_and_says_it_is_complete():
    settled = {
        SignalCode.RESP_RATE: (16.0, "/min"), SignalCode.SPO2: (98.0, "%"),
        SignalCode.SBP: (124.0, "mmHg"), SignalCode.HEART_RATE: (72.0, "/min"),
        SignalCode.TEMPERATURE: (36.8, "Cel"),
    }
    news2 = _board(_engine(settled))["latest"]["news2"]
    assert news2["total"] == 0
    assert news2["partial"] is False   # 0 measured is not the same as 0 for want of measuring
    assert news2["red_param"] is False


@pytest.mark.parametrize("code", list(DETERIORATING))
def test_every_core_vital_is_reported_missing_when_absent(code):
    present = {c: v for c, v in DETERIORATING.items() if c is not code}
    news2 = _board(_engine(present))["latest"]["news2"]
    assert news2["partial"] is True
    assert len(news2["missing"]) == 1


def test_the_new_chemistry_signals_can_be_carried():
    """APACHE II and its siblings read these. A value the engine cannot hold is a field a
    clinician has to go and look up by hand."""
    later = WHEN + timedelta(minutes=5)
    chemistry = {
        SignalCode.ARTERIAL_PH: (7.24, "pH"), SignalCode.BICARBONATE: (18.0, "mmol/L"),
        SignalCode.SODIUM: (131.0, "mmol/L"), SignalCode.POTASSIUM: (5.6, "mmol/L"),
        SignalCode.HAEMATOCRIT: (28.0, "%"), SignalCode.WHITE_CELL_COUNT: (18.4, "10^3/mm3"),
    }
    engine = _engine(chemistry, at=later)
    state = engine.state("bed-1")
    for code, (value, _unit) in chemistry.items():
        assert state.latest(code).value == value

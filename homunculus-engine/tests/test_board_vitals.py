"""The board payload has to carry every vital the dashboard renders.

Otherwise the screen shows a blank where a measured value exists, which reads as "not measured"
— a different clinical statement from the truth.
"""
from __future__ import annotations

from datetime import datetime, timezone

from homunculus.api.ackstore import AckStore
from homunculus.api.board import patient_board
from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine


def _obs(code: SignalCode, value: float, unit: str) -> Observation:
    return Observation(patient_id="bed-3", code=code, value=value, unit=unit,
                       timestamp=datetime(2026, 8, 27, 10, 0, tzinfo=timezone.utc),
                       source_device="TEST")


def test_every_displayed_vital_is_published():
    engine = Engine()
    at = datetime(2026, 8, 27, 10, 0, tzinfo=timezone.utc)
    for code, value, unit in [
        (SignalCode.HEART_RATE, 96.0, "bpm"),
        (SignalCode.MAP, 72.0, "mmHg"),
        (SignalCode.SPO2, 93.0, "%"),
        (SignalCode.TEMPERATURE, 38.2, "Cel"),
        (SignalCode.RESP_RATE, 22.0, "/min"),
    ]:
        engine.ingest(_obs(code, value, unit), now=at)   # `now` is required, not optional

    latest = patient_board(engine, "bed-3", AckStore())["latest"]

    assert latest["heart_rate"] == 96.0
    assert latest["map"] == 72.0
    assert latest["spo2"] == 93.0
    assert latest["temperature"] == 38.2
    assert latest["resp_rate"] == 22.0


def test_an_unmeasured_vital_is_null_not_absent():
    """The key must exist and be null: a missing key and a null read differently downstream,
    and the UI has to be able to say "not measured" rather than crash on undefined."""
    board = patient_board(Engine(), "bed-9", AckStore())

    for key in ("heart_rate", "map", "spo2", "temperature", "resp_rate", "lactate"):
        assert key in board["latest"]
        assert board["latest"][key] is None

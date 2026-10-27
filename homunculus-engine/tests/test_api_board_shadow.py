"""The board carries the shadow engine's picture under ONE key, `shadow`, and nothing else moves
(spec D6)."""
from __future__ import annotations

from datetime import datetime, timezone

from homunculus.api.ackstore import AckStore
from homunculus.api.board import board_snapshot, patient_board
from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine

T0 = datetime(2026, 10, 27, 9, 0, tzinfo=timezone.utc)


def test_patient_board_has_shadow_null_by_default_and_passes_a_given_one_through():
    engine, store = Engine(), AckStore()
    engine.ingest(Observation("bed-1", SignalCode.HEART_RATE, 70, "bpm", T0, "bridge"), now=T0)
    plain = patient_board(engine, "bed-1", store, now=T0)
    assert plain["shadow"] is None
    given = {"news2": {"total": 6}, "vitals": {}, "findings": []}
    with_shadow = patient_board(engine, "bed-1", store, now=T0, shadow=given)
    assert with_shadow["shadow"] == given
    assert {k: v for k, v in with_shadow.items() if k != "shadow"} == {k: v for k, v in plain.items() if k != "shadow"}


def test_board_snapshot_asks_shadow_for_once_per_measured_patient_and_defaults_to_none():
    engine, store = Engine(), AckStore()
    for pid in ("bed-1", "bed-2"):
        engine.ingest(Observation(pid, SignalCode.HEART_RATE, 70, "bpm", T0, "bridge"), now=T0)
    plain = {card["patient_id"]: card for card in board_snapshot(engine, store, now=T0)}
    assert set(plain) == {"bed-1", "bed-2"}
    assert all(card["shadow"] is None for card in plain.values())

    picture = {"findings": [], "news2": {"total": 0}, "vitals": {}}
    asked: list[str] = []

    def shadow_for(pid: str):
        asked.append(pid)
        return picture if pid == "bed-1" else None

    cards = {card["patient_id"]: card for card in board_snapshot(engine, store, now=T0, shadow_for=shadow_for)}
    assert cards["bed-1"]["shadow"] == picture
    assert cards["bed-2"]["shadow"] is None
    assert sorted(asked) == ["bed-1", "bed-2"]
    # Nothing but the one key moves.
    for pid in ("bed-1", "bed-2"):
        assert ({k: v for k, v in cards[pid].items() if k != "shadow"}
                == {k: v for k, v in plain[pid].items() if k != "shadow"})

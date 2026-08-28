"""The uplink drains the buffer in order and acks only what was delivered.

Extracted from run_bridge.py so the HL7 bridge and the NCE file bridge cannot drift into two
different delivery behaviours. Order is the property under test: delivering a later observation
past a stuck earlier one would let the engine read a past state as the present.
"""
from __future__ import annotations

import asyncio

from homunculus.edge.buffer import SqliteBuffer
from homunculus.edge.uplink import flush_once


def test_delivers_oldest_first_and_acks_them(tmp_path):
    buffer = SqliteBuffer(tmp_path / "b.db")
    for n in (1, 2, 3):
        buffer.append({"n": n})
    sent: list[dict] = []

    delivered = asyncio.run(flush_once(buffer, sender=sent.append))

    assert [p["n"] for p in sent] == [1, 2, 3]
    assert delivered == 3
    assert buffer.depth() == 0


def test_a_failure_stops_the_pass_and_leaves_the_rest_queued(tmp_path):
    buffer = SqliteBuffer(tmp_path / "b.db")
    for n in (1, 2, 3):
        buffer.append({"n": n})
    sent: list[dict] = []

    def sender(payload: dict) -> None:
        if payload["n"] == 2:
            raise RuntimeError("uplink down")
        sent.append(payload)

    delivered = asyncio.run(flush_once(buffer, sender=sender))

    assert [p["n"] for p in sent] == [1]
    assert delivered == 1
    assert buffer.depth() == 2       # 2 and 3 stay queued, in order

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

    asyncio.run(flush_once(buffer, sender=sent.append))
    assert [p["n"] for p in sent] == [1, 2, 3]
    assert buffer.depth() == 0


def test_a_refused_identity_record_is_dropped_so_the_readings_behind_it_flow(tmp_path, caplog):
    """A Patient the API refuses (a bridge one release ahead of its API, a bad key over there)
    must not sit at the head of the queue holding every observation behind it hostage: the next
    ADT resends it. It is acked and counted, not delivered."""
    from homunculus.edge.uplink import UplinkRefused

    buffer = SqliteBuffer(tmp_path / "b.db")
    buffer.append({"resourceType": "Patient", "n": 1})
    buffer.append({"resourceType": "Encounter", "n": 2})
    buffer.append({"resourceType": "Observation", "n": 3})
    sent: list[dict] = []

    def sender(payload: dict) -> None:
        if payload["resourceType"] != "Observation":
            raise UplinkRefused(400)
        sent.append(payload)

    with caplog.at_level("WARNING", logger="homunculus.edge.uplink"):
        delivered = asyncio.run(flush_once(buffer, sender=sender))
    assert [p["n"] for p in sent] == [3]
    assert delivered == 1
    assert buffer.depth() == 0
    assert any("HTTP 400" in r.getMessage() for r in caplog.records)


def test_a_refused_observation_still_stops_the_pass(tmp_path):
    """Readings are never dropped: a refusal on an observation waits, like an outage does."""
    from homunculus.edge.uplink import UplinkRefused

    buffer = SqliteBuffer(tmp_path / "b.db")
    buffer.append({"resourceType": "Observation", "n": 1})
    buffer.append({"resourceType": "Observation", "n": 2})

    def sender(payload: dict) -> None:
        raise UplinkRefused(500)

    assert asyncio.run(flush_once(buffer, sender=sender)) == 0
    assert buffer.depth() == 2


def test_an_outage_holds_identity_records_too(tmp_path):
    """Only a decision drops an identity row. An unreachable API is not a decision."""
    import urllib.error

    buffer = SqliteBuffer(tmp_path / "b.db")
    buffer.append({"resourceType": "Patient", "n": 1})

    def sender(payload: dict) -> None:
        raise urllib.error.URLError("connection refused")

    assert asyncio.run(flush_once(buffer, sender=sender)) == 0
    assert buffer.depth() == 1

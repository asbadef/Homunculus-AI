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


def test_an_identity_the_api_cannot_take_right_now_is_held_not_dropped(tmp_path):
    """500 while Postgres restarts, 401 while a token is fixed: a decision about the moment, not
    the record. The row waits for the next pass; the reading behind it does not wait at all."""
    from homunculus.edge.uplink import UplinkRefused, UplinkStats

    for status in (500, 503, 401, 403):
        buffer = SqliteBuffer(tmp_path / f"b{status}.db")
        buffer.append({"resourceType": "Patient", "n": 1})
        buffer.append({"resourceType": "Observation", "n": 2})
        sent: list[dict] = []
        stats = UplinkStats()

        def sender(payload: dict) -> None:
            if payload["resourceType"] == "Patient":
                raise UplinkRefused(status)
            sent.append(payload)

        assert asyncio.run(flush_once(buffer, sender=sender, stats=stats)) == 1
        assert [p["n"] for p in sent] == [2]
        assert buffer.depth() == 1                          # the Patient is still queued
        assert (stats.identity_dropped, stats.identity_held) == (0, 1)

        # ...and delivered on the next pass once the API takes it.
        assert asyncio.run(flush_once(buffer, sender=sent.append, stats=stats)) == 1
        assert buffer.depth() == 0 and stats.identity_held == 0


def test_the_held_head_is_bounded_so_it_cannot_starve_the_readings(tmp_path):
    from homunculus.edge.uplink import UplinkRefused, UplinkStats

    buffer = SqliteBuffer(tmp_path / "b.db")
    for n in range(1, 5):
        buffer.append({"resourceType": "Patient", "n": n})
    buffer.append({"resourceType": "Observation", "n": 5})
    stats = UplinkStats()

    def sender(payload: dict) -> None:
        if payload["resourceType"] == "Patient":
            raise UplinkRefused(503)

    assert asyncio.run(flush_once(buffer, sender=sender, stats=stats, hold_limit=2)) == 1
    assert (stats.identity_dropped, stats.identity_held) == (2, 2)     # oldest two went
    assert [p["n"] for _id, p in buffer.pending()] == [3, 4]


def test_a_payload_refusal_counts_as_dropped_in_the_stats(tmp_path):
    from homunculus.edge.uplink import UplinkRefused, UplinkStats

    buffer = SqliteBuffer(tmp_path / "b.db")
    buffer.append({"resourceType": "Encounter", "n": 1})
    stats = UplinkStats()

    def sender(payload: dict) -> None:
        raise UplinkRefused(422)

    assert asyncio.run(flush_once(buffer, sender=sender, stats=stats)) == 0
    assert (stats.identity_dropped, stats.identity_held, buffer.depth()) == (1, 0, 0)

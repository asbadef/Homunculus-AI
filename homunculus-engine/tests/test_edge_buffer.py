"""
Durable store-and-forward buffer.

The bridge holds real observations in transit. If the uplink drops mid-shift, they must survive
until it returns — including across a process restart, which is exactly when an in-memory queue
loses everything. Order matters: observations are a time series, and delivering them out of order
would make the engine read a past state as the current one.
"""
from __future__ import annotations

from homunculus.edge.buffer import SqliteBuffer


def _payload(n: int) -> dict:
    return {"resourceType": "Observation", "seq": n}


def test_appends_and_reads_back_in_order(tmp_path):
    buf = SqliteBuffer(tmp_path / "b.db")
    for i in range(3):
        buf.append(_payload(i))

    pending = buf.pending(limit=10)

    assert [p["seq"] for _id, p in pending] == [0, 1, 2]
    assert buf.depth() == 3


def test_acked_rows_are_gone_and_the_rest_keep_their_order(tmp_path):
    buf = SqliteBuffer(tmp_path / "b.db")
    for i in range(4):
        buf.append(_payload(i))
    first_two = buf.pending(limit=2)

    buf.ack([row_id for row_id, _p in first_two])

    assert [p["seq"] for _id, p in buf.pending(limit=10)] == [2, 3]
    assert buf.depth() == 2


def test_survives_a_process_restart(tmp_path):
    """The whole point: a crash mid-shift must not lose queued observations."""
    path = tmp_path / "b.db"
    first = SqliteBuffer(path)
    first.append(_payload(1))
    first.append(_payload(2))
    first.close()

    reopened = SqliteBuffer(path)          # as if the bridge had been restarted

    assert [p["seq"] for _id, p in reopened.pending(limit=10)] == [1, 2]


def test_pending_respects_the_limit(tmp_path):
    buf = SqliteBuffer(tmp_path / "b.db")
    for i in range(5):
        buf.append(_payload(i))

    assert len(buf.pending(limit=2)) == 2


def test_a_failed_flush_leaves_everything_queued_in_order(tmp_path):
    """Nothing is acked when delivery fails, so the next flush re-sends from the same point."""
    buf = SqliteBuffer(tmp_path / "b.db")
    for i in range(3):
        buf.append(_payload(i))

    batch = buf.pending(limit=3)
    # simulate an uplink that died before we could ack — no ack() call at all

    assert [p["seq"] for _id, p in buf.pending(limit=10)] == [0, 1, 2]
    assert buf.depth() == 3
    assert len(batch) == 3


def test_retention_cap_drops_oldest_and_counts_it(tmp_path):
    """Discarding clinical data silently is not acceptable — the drop must be visible."""
    buf = SqliteBuffer(tmp_path / "b.db", max_rows=3)
    for i in range(5):
        buf.append(_payload(i))

    assert buf.depth() == 3
    assert [p["seq"] for _id, p in buf.pending(limit=10)] == [2, 3, 4]   # oldest two dropped
    assert buf.dropped == 2


def test_payload_round_trips_unchanged(tmp_path):
    buf = SqliteBuffer(tmp_path / "b.db")
    original = {"resourceType": "Observation", "valueQuantity": {"value": 118.5, "unit": "bpm"},
                "subject": {"reference": "Patient/bed-3"}}

    buf.append(original)

    (_id, restored), = buf.pending(limit=1)
    assert restored == original

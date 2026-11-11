# homunculus-engine/tests/test_ingest_apply.py
"""G3-05 (spec D12): what one reading does at `/ingest` — its rows, their order, the frame, the answer — pinned
before the door's tail moved into `_apply_reading`, and held after it. From Task B6 the link of an unmatched
reading runs the same function. Synthetic numbers and values only (CLAUDE.md rule 6)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.audit import InMemoryAuditLog

HEAD = {"Authorization": "Bearer tok"}
# Five readings that together score an immediate NEWS2 (tests/test_api_discharge.py IMMEDIATE): the alert fires on
# the first, and turns immediate — the nurse is told — on the third.
IMMEDIATE = [("heart_rate", 140), ("resp_rate", 30), ("spo2", 88), ("sbp", 85), ("temperature", 39.5)]


def obs(code, value, patient="S-001", when=None, device="CONNEX-3A"):
    when = when or datetime.now(timezone.utc) - timedelta(minutes=5)
    return {"resourceType": "Observation", "status": "final",
            "code": {"coding": [{"system": "http://homunculus.local/obs", "code": code}]},
            "subject": {"reference": f"Patient/{patient}"}, "effectiveDateTime": when.isoformat(),
            "valueQuantity": {"value": value, "unit": "u"}, "device": {"display": device}}


def test_five_readings_write_their_rows_in_the_doors_order_and_one_frame_each():
    audit = InMemoryAuditLog()
    app = create_app({"tok": "h1"}, run_escalation_loop=False, audit=audit)
    when = datetime.now(timezone.utc) - timedelta(minutes=5)
    with TestClient(app) as client:
        queue = app.state.broadcaster.subscribe("h1")
        for code, value in IMMEDIATE:
            r = client.post("/ingest", json=obs(code, value, when=when), headers=HEAD)
            assert r.status_code == 200 and sorted(r.json()) == ["alerts", "patient_id"]
            assert [a["kind"] for a in r.json()["alerts"]] == ["news2"]
        frames = 0
        while not queue.empty():
            assert queue.get_nowait()["patient_id"] == "S-001"
            frames += 1
    assert frames == 5
    assert [(r.event_type, r.subject) for r in audit.records(tenant="h1", limit=100)] == [
        ("ingest", "heart_rate"), ("alert", "news2"), ("first_seen", "news2"),
        ("ingest", "resp_rate"), ("alert", "news2"),
        ("ingest", "spo2"), ("alert", "news2"), ("notification", "news2"),
        ("ingest", "sbp"), ("alert", "news2"),
        ("ingest", "temperature"), ("alert", "news2"),
    ]
    first = audit.records(tenant="h1", event_type="ingest", limit=1)[0]
    assert first.patient_id == "S-001"
    assert first.payload == {"value": 140.0, "unit": "u", "obs_ts": when.isoformat(), "device": "CONNEX-3A"}

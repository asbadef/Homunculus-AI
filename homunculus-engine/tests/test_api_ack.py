# tests/test_api_ack.py
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import homunculus.scenarios
from homunculus.api.app import create_app
from homunculus.scenarios.loader import load_scenario

SCEN = Path(homunculus.scenarios.__file__).parent


@pytest.fixture
def anyio_backend():
    return "asyncio"


def _client():
    return TestClient(create_app({"tok": "HOSP1", "tok2": "HOSP2"}, run_escalation_loop=False))


def _hdr(t):
    return {"Authorization": f"Bearer {t}"}


def _drive_shock(client, token="tok"):
    for _ts, fhir in load_scenario(SCEN / "septic_shock.yaml"):
        client.post("/ingest", json=fhir, headers=_hdr(token))
    return "bed-3"


def test_ack_marks_the_alert_acknowledged_in_the_board():
    c = _client()
    p = _drive_shock(c)
    r = c.post("/ack", json={"patient_id": p, "kind": "septic_shock", "role": "nurse"}, headers=_hdr("tok"))
    assert r.status_code == 200
    board = c.get("/patients", headers=_hdr("tok")).json()["patients"]
    shock = next(a for b in board if b["patient_id"] == p for a in b["alerts"] if a["kind"] == "septic_shock")
    assert shock["acknowledged"] is True
    assert shock["acknowledged_by"] == "nurse"


def test_ack_of_unknown_alert_is_404():
    c = _client()
    _drive_shock(c)
    r = c.post("/ack", json={"patient_id": "bed-3", "kind": "no_such_kind", "role": "nurse"}, headers=_hdr("tok"))
    assert r.status_code == 404


def test_ack_requires_a_tenant_token():
    c = _client()
    assert c.post("/ack", json={"patient_id": "bed-3", "kind": "septic_shock", "role": "nurse"}).status_code == 401


def test_ack_is_tenant_isolated():
    c = _client()
    _drive_shock(c, "tok")
    r = c.post("/ack", json={"patient_id": "bed-3", "kind": "septic_shock", "role": "nurse"}, headers=_hdr("tok2"))
    assert r.status_code == 404


@pytest.mark.anyio
async def test_escalation_cycle_flips_unacked_immediate_alert():
    app = create_app({"tok": "HOSP1"}, escalate_after=timedelta(minutes=5), run_escalation_loop=False)
    client = TestClient(app)
    for _ts, fhir in load_scenario(SCEN / "septic_shock.yaml"):
        client.post("/ingest", json=fhir, headers=_hdr("tok"))
    store = app.state.ack_stores["HOSP1"]
    key = ("bed-3", "septic_shock")
    store.first_seen[key] = datetime(2026, 7, 19, 10, 0, tzinfo=timezone.utc)
    await app.state.escalation_cycle(datetime(2026, 7, 19, 10, 6, tzinfo=timezone.utc))
    assert key in store.escalated
    board = client.get("/patients", headers=_hdr("tok")).json()["patients"]
    shock = next(a for b in board if b["patient_id"] == "bed-3" for a in b["alerts"] if a["kind"] == "septic_shock")
    assert shock["escalated"] is True


@pytest.mark.anyio
async def test_ack_clears_escalation():
    app = create_app({"tok": "HOSP1"}, escalate_after=timedelta(minutes=5), run_escalation_loop=False)
    client = TestClient(app)
    for _ts, fhir in load_scenario(SCEN / "septic_shock.yaml"):
        client.post("/ingest", json=fhir, headers=_hdr("tok"))
    store = app.state.ack_stores["HOSP1"]
    key = ("bed-3", "septic_shock")
    store.first_seen[key] = datetime(2026, 7, 19, 10, 0, tzinfo=timezone.utc)
    await app.state.escalation_cycle(datetime(2026, 7, 19, 10, 6, tzinfo=timezone.utc))
    assert key in store.escalated
    client.post("/ack", json={"patient_id": "bed-3", "kind": "septic_shock", "role": "doctor"}, headers=_hdr("tok"))
    assert key not in store.escalated

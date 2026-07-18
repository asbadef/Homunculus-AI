# tests/test_api_stream.py
import asyncio
import json
from pathlib import Path

import httpx
import pytest
from httpx import ASGITransport

import homunculus.scenarios
from homunculus.api.app import create_app, sse_board_frames
from homunculus.scenarios.loader import load_scenario

SCEN = Path(homunculus.scenarios.__file__).parent


@pytest.fixture
def anyio_backend():
    return "asyncio"


def _fhir(code, value, unit="", patient="bed-3", when="2026-07-14T10:00:00+00:00"):
    return {
        "resourceType": "Observation",
        "code": {"coding": [{"system": "x", "code": code}]},
        "subject": {"reference": f"Patient/{patient}"},
        "effectiveDateTime": when,
        "valueQuantity": {"value": value, "unit": unit},
    }


@pytest.mark.anyio
async def test_ingest_publishes_patient_board_to_subscribers():
    app = create_app({"tok": "HOSP1"})
    q = app.state.broadcaster.subscribe("HOSP1")
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
        for _ts, fhir in load_scenario(SCEN / "septic_shock.yaml"):
            await client.post("/ingest", json=fhir, headers={"Authorization": "Bearer tok"})
    boards = []
    while not q.empty():
        boards.append(q.get_nowait())
    assert boards, "ingest published nothing"
    assert any(a["kind"] == "septic_shock" for b in boards for a in b["alerts"])


@pytest.mark.anyio
async def test_publish_is_tenant_isolated():
    app = create_app({"t1": "HOSP1", "t2": "HOSP2"})
    q2 = app.state.broadcaster.subscribe("HOSP2")
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
        await client.post("/ingest", json=_fhir("heart_rate", 100),
                          headers={"Authorization": "Bearer t1"})
    assert q2.empty()


@pytest.mark.anyio
async def test_sse_frames_emits_a_data_frame_for_a_published_board():
    # httpx's ASGITransport cannot read an unbounded stream incrementally, so the SSE frame
    # generator is tested directly instead of over HTTP.
    q: asyncio.Queue = asyncio.Queue()
    await q.put({"patient_id": "bed-3", "risk": "critical"})
    frame = await sse_board_frames(q, keepalive=0.05).__anext__()
    assert frame.startswith("data: ")
    assert json.loads(frame[len("data: "):].strip()) == {"patient_id": "bed-3", "risk": "critical"}


@pytest.mark.anyio
async def test_sse_frames_emits_keepalive_when_idle():
    q: asyncio.Queue = asyncio.Queue()
    frame = await sse_board_frames(q, keepalive=0.05).__anext__()
    assert frame.strip() == ": keep-alive"


@pytest.mark.anyio
async def test_stream_rejects_unknown_token():
    app = create_app({"tok": "HOSP1"})
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
        r = await client.get("/stream?token=nope")
        assert r.status_code == 401

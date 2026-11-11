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
async def test_sse_frames_follow_the_keepalive_with_a_named_heartbeat_event():
    # EventSource never hands a comment to the page: a named event is what lets a client tell a
    # quiet stream from a dead (half-open) one. Named, so `onmessage` readers never see it.
    q: asyncio.Queue = asyncio.Queue()
    frames = sse_board_frames(q, keepalive=0.05)
    assert (await frames.__anext__()).strip() == ": keep-alive"
    assert await frames.__anext__() == "event: heartbeat\ndata: {}\n\n"
    assert (await frames.__anext__()).strip() == ": keep-alive"     # and again, on the same cadence


@pytest.mark.anyio
async def test_sse_frames_heartbeat_a_subscriber_whose_boards_are_all_out_of_scope():
    # A busy hospital publishes a board every few milliseconds; a nurse scoped to a quiet unit is
    # sent none of them. The keep-alive used to wait for an idle QUEUE, so she was sent nothing at
    # all — no heartbeat either, and her stream would look dead to the client's watchdog.
    q: asyncio.Queue = asyncio.Queue()

    async def busy_ward():
        while True:
            await q.put({"patient_id": "elsewhere"})
            await asyncio.sleep(0.005)

    publisher = asyncio.create_task(busy_ward())
    try:
        frames = sse_board_frames(q, keepalive=0.05, allow=lambda board: False)
        assert (await asyncio.wait_for(frames.__anext__(), timeout=1.0)).strip() == ": keep-alive"
        assert await asyncio.wait_for(frames.__anext__(), timeout=1.0) == "event: heartbeat\ndata: {}\n\n"
    finally:
        publisher.cancel()


@pytest.mark.anyio
async def test_sse_frames_send_no_heartbeat_while_boards_are_being_sent():
    q: asyncio.Queue = asyncio.Queue()
    for i in range(3):
        await q.put({"patient_id": f"bed-{i}"})
    frames = sse_board_frames(q, keepalive=0.05)
    sent = [await frames.__anext__() for _ in range(3)]
    assert all(frame.startswith("data: ") for frame in sent)


@pytest.mark.anyio
async def test_stream_rejects_unknown_token():
    app = create_app({"tok": "HOSP1"})
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
        r = await client.get("/stream?token=nope")
        assert r.status_code == 401


# --- G2 borç 1b: a live stream has a bounded life (owner: «Süre sınırı», 15 minutes) -------------
# The scope is resolved once, from the ticket, and kept for the connection's life: a nurse moved to
# another unit, or a bed map edited, would keep the old view on an open stream until it reconnected.
# So every stream ends after STREAM_MAX_AGE with one named `rotate` event, and the client reconnects
# with a fresh ticket — and so a freshly resolved scope.
ROTATE = "event: rotate\ndata: {}\n\n"


def test_a_stream_lives_fifteen_minutes_at_most():
    import homunculus.api.app as app_module
    assert app_module.STREAM_MAX_AGE == 900
    assert app_module.ROTATE_FRAME == ROTATE


@pytest.mark.anyio
async def test_sse_frames_end_an_idle_stream_past_its_age_with_one_rotate_event():
    q: asyncio.Queue = asyncio.Queue()
    frames = sse_board_frames(q, keepalive=5.0, max_age=0.05)
    assert await asyncio.wait_for(frames.__anext__(), timeout=1.0) == ROTATE
    with pytest.raises(StopAsyncIteration):
        await frames.__anext__()


@pytest.mark.anyio
async def test_sse_frames_rotate_a_busy_stream_too_by_the_clock_it_was_opened_on():
    # A stream that is sent a board every moment is never idle; its age is still its age.
    now = [100.0]
    q: asyncio.Queue = asyncio.Queue()
    for i in range(3):
        await q.put({"patient_id": f"bed-{i}"})
    frames = sse_board_frames(q, keepalive=1000.0, max_age=900, clock=lambda: now[0])
    assert (await frames.__anext__()).startswith("data: ")
    now[0] += 899.9
    assert (await frames.__anext__()).startswith("data: ")
    now[0] += 0.1
    assert await frames.__anext__() == ROTATE                # boards still queued: the life is over
    with pytest.raises(StopAsyncIteration):
        await frames.__anext__()


@pytest.mark.anyio
async def test_sse_frames_rotate_a_subscriber_whose_boards_are_all_out_of_scope():
    # The wait for the next board is bounded by the stream's remaining life, not only by the
    # keep-alive: a busy hospital never leaves the queue idle for a nurse it sends nothing to.
    q: asyncio.Queue = asyncio.Queue()

    async def busy_ward():
        while True:
            await q.put({"patient_id": "elsewhere"})
            await asyncio.sleep(0.005)

    publisher = asyncio.create_task(busy_ward())
    try:
        frames = sse_board_frames(q, keepalive=5.0, max_age=0.05, view=lambda board: None)
        assert await asyncio.wait_for(frames.__anext__(), timeout=1.0) == ROTATE
    finally:
        publisher.cancel()


@pytest.mark.anyio
async def test_the_stream_route_ends_with_rotate_and_unsubscribes(monkeypatch):
    """Over HTTP: the route passes STREAM_MAX_AGE (read when the stream opens), the response ends
    after the rotate event, and the `finally` that unsubscribes still runs."""
    import homunculus.api.app as app_module
    monkeypatch.setattr(app_module, "STREAM_MAX_AGE", 0.05)
    app = create_app({"tok": "HOSP1"}, run_escalation_loop=False)
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        r = await asyncio.wait_for(client.get("/stream?token=tok"), timeout=5.0)
    assert r.status_code == 200
    assert r.text.endswith(ROTATE) and r.text.count("event: rotate") == 1
    assert app.state.broadcaster._subs == {}                   # noqa: SLF001 — unsubscribed

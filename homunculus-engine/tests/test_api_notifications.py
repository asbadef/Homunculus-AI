# tests/test_api_notifications.py
import asyncio
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from httpx import ASGITransport

from homunculus.api.app import create_app, sse_notification_frames


@pytest.fixture
def anyio_backend():
    return "asyncio"


def _fhir(pid, slug, value, when):
    return {"resourceType": "Observation", "code": {"coding": [{"code": slug}]},
            "valueQuantity": {"value": value}, "effectiveDateTime": when.isoformat(),
            "subject": {"reference": f"Patient/{pid}"}}


_SHOCK = [("suspected_infection", 1.0), ("weight_kg", 100), ("crystalloid_bolus_ml", 3000),
          ("map", 60), ("norepinephrine_rate", 0.12), ("lactate", 3.1)]


@pytest.mark.anyio
async def test_sse_notification_frames_emits_data_then_keepalive():
    q = asyncio.Queue()
    await q.put({"body": "bed-3: x"})
    gen = sse_notification_frames(q, keepalive=0.01)
    first = await gen.__anext__()
    assert first.startswith("data:") and "bed-3" in first
    second = await gen.__anext__()
    assert second.startswith(": keep-alive")


@pytest.mark.anyio
async def test_ingest_publishes_nurse_notification():
    app = create_app({"tok": "HOSP1"}, run_escalation_loop=False)
    q = app.state.notification_hub.subscribe("HOSP1", "nurse")
    t = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        hdr = {"Authorization": "Bearer tok"}
        for slug, val in _SHOCK:
            await c.post("/ingest", json=_fhir("bed-3", slug, val, t), headers=hdr)
    assert q.qsize() >= 1
    n = q.get_nowait()
    assert n["audience"] == "nurse" and n["patient_id"] == "bed-3"


@pytest.mark.anyio
async def test_escalation_cycle_publishes_doctor_notification():
    app = create_app({"tok": "HOSP1"}, escalate_after=timedelta(seconds=0), run_escalation_loop=False)
    q = app.state.notification_hub.subscribe("HOSP1", "doctor")
    t = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        hdr = {"Authorization": "Bearer tok"}
        for slug, val in _SHOCK:
            await c.post("/ingest", json=_fhir("bed-3", slug, val, t), headers=hdr)
    await app.state.escalation_cycle(datetime.now(timezone.utc))
    assert q.qsize() >= 1
    assert q.get_nowait()["audience"] == "doctor"


@pytest.mark.anyio
async def test_notifications_are_tenant_isolated():
    app = create_app({"tok1": "HOSP1", "tok2": "HOSP2"}, run_escalation_loop=False)
    other = app.state.notification_hub.subscribe("HOSP2", "nurse")
    t = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        for slug, val in _SHOCK:
            await c.post("/ingest", json=_fhir("bed-3", slug, val, t),
                         headers={"Authorization": "Bearer tok1"})
    assert other.qsize() == 0

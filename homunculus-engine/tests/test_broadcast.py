# tests/test_broadcast.py
import pytest

from homunculus.api.broadcast import Broadcaster


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_subscriber_receives_published_message():
    b = Broadcaster()
    q = b.subscribe("HOSP1")
    await b.publish("HOSP1", {"x": 1})
    assert await q.get() == {"x": 1}


@pytest.mark.anyio
async def test_publish_is_tenant_isolated():
    b = Broadcaster()
    q1 = b.subscribe("HOSP1")
    q2 = b.subscribe("HOSP2")
    await b.publish("HOSP1", {"x": 1})
    assert q1.qsize() == 1
    assert q2.qsize() == 0


@pytest.mark.anyio
async def test_unsubscribe_stops_delivery():
    b = Broadcaster()
    q = b.subscribe("HOSP1")
    b.unsubscribe("HOSP1", q)
    await b.publish("HOSP1", {"x": 1})
    assert q.qsize() == 0

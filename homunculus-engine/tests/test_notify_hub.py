# tests/test_notify_hub.py
import pytest

from homunculus.api.notify import NotificationHub, Notification


@pytest.fixture
def anyio_backend():
    return "asyncio"


def _n(tenant, audience):
    return Notification(tenant, "bed-3", "septic_shock", "critical", "immediate",
                        audience, "new", "t", "b", "2026-07-25T10:00:00+00:00")


@pytest.mark.anyio
async def test_hub_delivers_only_to_matching_role():
    hub = NotificationHub()
    nurse_q = hub.subscribe("HOSP1", "nurse")
    doctor_q = hub.subscribe("HOSP1", "doctor")
    await hub.publish("HOSP1", _n("HOSP1", "nurse"))
    assert nurse_q.qsize() == 1 and doctor_q.qsize() == 0


@pytest.mark.anyio
async def test_hub_isolates_tenants():
    hub = NotificationHub()
    q1 = hub.subscribe("HOSP1", "nurse")
    q2 = hub.subscribe("HOSP2", "nurse")
    await hub.publish("HOSP1", _n("HOSP1", "nurse"))
    assert q1.qsize() == 1 and q2.qsize() == 0


@pytest.mark.anyio
async def test_unsubscribe_removes_queue():
    hub = NotificationHub()
    q = hub.subscribe("HOSP1", "nurse")
    hub.unsubscribe("HOSP1", "nurse", q)
    await hub.publish("HOSP1", _n("HOSP1", "nurse"))
    assert q.qsize() == 0

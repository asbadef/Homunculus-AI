"""Routes that arrived from main are permission-gated like every LDAP-branch route.

Each case: a JWT caller holding EVERY permission except the one the route names gets 403 naming
that key, which proves which key gates it; a caller holding ONLY that key gets the route's real
answer. Uses the injected `resolve_jwt` hook, so no database is needed.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest
from httpx import ASGITransport, AsyncClient

from homunculus.api.app import create_app
from homunculus.api.identity import Caller
from homunculus.auth.permissions import ALL_PERMISSIONS

pytestmark = pytest.mark.asyncio

HOSPITAL = "h1"
DEVICE = {"Authorization": "Bearer dev-token"}
JWT = {"Authorization": "Bearer jwt"}


def _app(perms):
    async def resolve_jwt(token: str):
        return Caller(hospital=HOSPITAL, actor="u1", groups=("g",), perms=frozenset(perms))
    return create_app({"dev-token": HOSPITAL}, run_escalation_loop=False,
                      resolve_jwt=resolve_jwt)


async def _seed(client: AsyncClient) -> None:
    """One reading for p1 through the bridge, so the patient-naming routes have a patient."""
    r = await client.post("/ingest", headers=DEVICE, json={
        "resourceType": "Observation",
        "subject": {"reference": "Patient/p1"},
        "effectiveDateTime": datetime.now(timezone.utc).isoformat(),
        "code": {"coding": [{"code": "spo2"}]},   # the gateway reads the SignalCode slug
        "valueQuantity": {"value": 97.0, "unit": "%"},
    })
    assert r.status_code == 200, r.text


# method, path, body, gating permission, the status a caller holding only that key gets
CASES = [
    ("POST", "/clinical/p1", {"entries": []}, "clinical.chart", 400),     # empty chart refused
    ("PUT", "/clinical/p1/profile", {}, "clinical.chart", 400),           # empty profile refused
    ("GET", "/scores/sofa/p1", None, "board.view", 200),
    ("POST", "/scores/sofa/p1", {"overrides": []}, "scores.sign", 200),
    ("GET", "/alarm-quality", None, "audit.view", 200),
    ("GET", "/audit/verify", None, "audit.view", 200),
]


@pytest.mark.parametrize("method,path,body,perm,admitted", CASES)
async def test_refused_without_exactly_that_permission(method, path, body, perm, admitted):
    async with AsyncClient(transport=ASGITransport(app=_app(ALL_PERMISSIONS - {perm})),
                           base_url="http://t") as c:
        await _seed(c)
        r = await c.request(method, path, json=body, headers=JWT)
    assert r.status_code == 403, (path, r.status_code, r.text)
    assert r.json()["detail"] == f"permission required: {perm}"


@pytest.mark.parametrize("method,path,body,perm,admitted", CASES)
async def test_admitted_with_that_permission_alone(method, path, body, perm, admitted):
    async with AsyncClient(transport=ASGITransport(app=_app({perm})), base_url="http://t") as c:
        await _seed(c)
        r = await c.request(method, path, json=body, headers=JWT)
    assert r.status_code == admitted, (path, r.status_code, r.text)


async def test_a_device_cannot_sign_a_score():
    async with AsyncClient(transport=ASGITransport(app=_app(set())), base_url="http://t") as c:
        await _seed(c)
        r = await c.post("/scores/sofa/p1", json={"overrides": []}, headers=DEVICE)
    assert r.status_code == 403, r.text
    assert r.json()["detail"] == "skor formunu yalnız bir kişi imzalayabilir"

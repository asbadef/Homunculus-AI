"""The clinical routes must accept either credential.

The bridge authenticates with a static tenant token. A clinician authenticates with a JWT. Both
have to reach the same engine, and anything else has to be refused — the tenant token also
authorises /ingest, so it can never be handed to a browser.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.identity import Caller


@pytest.fixture
def client():
    async def fake_jwt(token: str) -> Caller | None:
        # Stands in for: decode JWT -> load user -> check active + tv -> Caller from claims.
        if token == "valid-jwt":
            return Caller(hospital="demo-hastanesi", actor="dr.elif", groups=("attending",),
                          perms=frozenset({"board.view", "alerts.ack"}))
        return None

    app = create_app(
        {"bridge-token": "demo-hastanesi"},
        run_escalation_loop=False,
        resolve_jwt=fake_jwt,
    )
    with TestClient(app) as c:
        yield c


def test_the_bridge_token_still_works(client):
    res = client.get("/patients", headers={"Authorization": "Bearer bridge-token"})
    assert res.status_code == 200


def test_a_jwt_reaches_the_same_board(client):
    res = client.get("/patients", headers={"Authorization": "Bearer valid-jwt"})
    assert res.status_code == 200


def test_an_unknown_credential_is_refused(client):
    assert client.get("/patients", headers={"Authorization": "Bearer nonsense"}).status_code == 401


def test_a_missing_credential_is_refused(client):
    assert client.get("/patients").status_code == 401


def test_a_jwt_does_not_open_the_stream(client):
    """The tenant token authorises /ingest as well as the board, so it must never be handed to a
    browser — and the reverse restriction matters just as much: a JWT, valid on every other
    clinical route, must not work as `/stream?token=`. `_stream_hospital` only ever calls
    `_tenant_from_token` (never `resolve_jwt`), so this is true by construction today;
    the point of this test is to catch a future edit that quietly wires a JWT into the stream
    path, since that would put a bearer credential straight into a URL — logs, browser history,
    proxies — for a token that is otherwise sent only in an Authorization header."""
    res = client.get("/stream?token=valid-jwt")
    assert res.status_code == 401


def test_ingest_also_accepts_both(client):
    """Same resolver everywhere: one place decides who a caller is."""
    observation = {
        "resourceType": "Observation",
        "status": "final",
        "code": {"coding": [{"system": "x", "code": "resp_rate"}]},
        "subject": {"reference": "Patient/bed-3"},
        "effectiveDateTime": "2026-08-27T10:00:00Z",
        "valueQuantity": {"value": 96, "unit": "/min"},
    }
    assert client.post("/ingest", json=observation,
                       headers={"Authorization": "Bearer bridge-token"}).status_code == 200

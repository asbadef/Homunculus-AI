"""The clinical routes must accept either credential.

The bridge authenticates with a static tenant token. A clinician authenticates with a JWT. Both
have to reach the same engine, and anything else has to be refused — the tenant token also
authorises /ingest, so it can never be handed to a browser. /ingest is the device's alone: a JWT
is refused there.

Synthetic data only.
"""
from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient

import homunculus.scenarios
from homunculus.api.app import create_app
from homunculus.api.identity import Caller
from homunculus.scenarios.loader import load_scenario

SCEN = Path(homunculus.scenarios.__file__).parent
HOSPITAL = "demo-hastanesi"
ALL_BOARD = frozenset({"board.view", "alerts.ack", "audit.view"})

# What a faulty resolver might hand back. None of these is a signed-in person, so each is refused
# like an unknown credential. None is treated as a device: a device skips every permission check.
NOT_A_PERSON = {
    "no-actor-jwt": Caller(hospital=HOSPITAL, perms=ALL_BOARD),
    "empty-actor-jwt": Caller(hospital=HOSPITAL, actor="", groups=("nurse",), perms=ALL_BOARD),
    "blank-actor-jwt": Caller(hospital=HOSPITAL, actor="  ", groups=("nurse",), perms=ALL_BOARD),
    "device-jwt": Caller(hospital=HOSPITAL, actor="synth-device", device=True),
}


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


OBSERVATION = {
    "resourceType": "Observation",
    "status": "final",
    "code": {"coding": [{"system": "x", "code": "resp_rate"}]},
    "subject": {"reference": "Patient/bed-3"},
    "effectiveDateTime": "2026-08-27T10:00:00Z",
    "valueQuantity": {"value": 96, "unit": "/min"},
}
PATIENT = {
    "resourceType": "Patient",
    "identifier": [{"system": "http://homunculus.local/protocol-no", "value": "SYN-1"}],
    "name": [{"family": "SENTETIK", "given": ["TEST"]}],
    "birthDate": "1970-01-01", "gender": "other", "active": True,
    "meta": {"lastUpdated": "2026-08-27T10:00:00Z", "source": "synthetic"},
}


def _hdr(token):
    return {"Authorization": f"Bearer {token}"}


def _rows(client) -> int:
    return len(client.app.state.audit.records(tenant=HOSPITAL, limit=1_000_000))


def test_ingest_accepts_the_bridge_token(client):
    assert client.post("/ingest", json=OBSERVATION, headers=_hdr("bridge-token")).status_code == 200


def test_ingest_refuses_a_jwt_and_writes_nothing(client):
    """An observation raises alerts and a Patient resource overwrites demographics: the bridge's
    work, never a clinician's. The JWT here holds every board permission and is still refused."""
    for resource in (OBSERVATION, PATIENT):
        res = client.post("/ingest", json=resource, headers=_hdr("valid-jwt"))
        assert res.status_code == 403
        assert res.json()["detail"] == "ingest requires a device token"
    assert _rows(client) == 0
    assert client.get("/patients", headers=_hdr("bridge-token")).json()["patients"] == []


# ---------------------------------------------------------------- a resolver fault is refused
@pytest.fixture
def faulty():
    async def resolve(token: str) -> Caller | None:
        return NOT_A_PERSON.get(token)

    app = create_app({"bridge-token": HOSPITAL}, run_escalation_loop=False, resolve_jwt=resolve)
    with TestClient(app) as c:
        for _ts, fhir in load_scenario(SCEN / "septic_shock.yaml"):
            c.post("/ingest", json=fhir, headers=_hdr("bridge-token"))
        yield c


@pytest.mark.parametrize("token", sorted(NOT_A_PERSON))
def test_a_jwt_that_resolves_to_no_person_is_refused_and_writes_nothing(faulty, token):
    before = _rows(faulty)
    ack = faulty.post("/ack", json={"patient_id": "bed-3", "kind": "septic_shock",
                                    "role": "dr.spoofed"}, headers=_hdr(token))
    view = faulty.post("/view", json={"patient_id": "bed-3", "role": "dr.spoofed"},
                       headers=_hdr(token))
    assert ack.status_code == 401 and view.status_code == 401
    assert faulty.get("/audit", headers=_hdr(token)).status_code == 401
    assert faulty.get("/patients", headers=_hdr(token)).status_code == 401
    assert faulty.post("/ingest", json=OBSERVATION, headers=_hdr(token)).status_code == 401

    assert _rows(faulty) == before
    board = faulty.get("/patients", headers=_hdr("bridge-token")).json()["patients"]
    shock = next(a for b in board for a in b["alerts"] if a["kind"] == "septic_shock")
    assert shock["acknowledged_by"] is None


# ---------------------------------------------------------------- an empty token is no token
@pytest.fixture
def empty_token_configured():
    """A map holding "" as a token, as a `TENANTS` entry of `":HOSP2"` would once have parsed."""
    app = create_app({"": "HOSP2", "bridge-token": HOSPITAL}, run_escalation_loop=False)
    with TestClient(app) as c:
        yield c


def test_an_empty_bearer_is_refused(empty_token_configured):
    c = empty_token_configured
    assert c.get("/patients", headers={"Authorization": "Bearer "}).status_code == 401
    assert c.get("/patients", headers={"Authorization": "Bearer   "}).status_code == 401
    assert c.post("/ingest", json=OBSERVATION,
                  headers={"Authorization": "Bearer "}).status_code == 401
    assert c.get("/patients", headers=_hdr("bridge-token")).status_code == 200


async def test_the_streams_refuse_a_missing_or_empty_token():
    """Bounded: a stream that wrongly opened would never end, and must fail this, not hang it."""
    app = create_app({"": "HOSP2", "bridge-token": HOSPITAL}, run_escalation_loop=False)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        for path in ("/stream", "/stream?token=", "/notifications", "/notifications?token="):
            res = await asyncio.wait_for(ac.get(path), timeout=5)
            assert res.status_code == 401, path


def test_the_empty_token_is_ignored_even_if_the_resolver_is_absent():
    """No JWT resolver, "" configured: an empty bearer still reaches nobody."""
    app = create_app({"": "HOSP2"}, run_escalation_loop=False)
    with TestClient(app) as c:
        assert c.get("/audit", headers={"Authorization": "Bearer "}).status_code == 401
        assert c.post("/stream-ticket", headers={"Authorization": "Bearer "}).status_code == 401

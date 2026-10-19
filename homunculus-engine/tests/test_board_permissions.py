# homunculus-engine/tests/test_board_permissions.py
"""The board routes check the caller's permissions — for a JWT. The device path (static tenant
token) is a machine credential and is exempt, exactly as before.

A refused call writes nothing. /ack and /view say who acted: `via` "user" with the signed-in
`actor`, or `via` "device" with no actor and the body's self-declared `role`.

`BOARD_EXPECTED` names every route of `api/app.py` and what guards it. The guards are inline, so
the router-level structural tests cannot see them; this table, checked by behaviour, is what
catches a new board route that nobody guarded.

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
from homunculus.api.audit import InMemoryAuditLog
from homunculus.api.identity import Caller
from homunculus.auth.permissions import validate_permissions
from homunculus.scenarios.loader import load_scenario
from tests.route_walk import api_routes

SCEN = Path(homunculus.scenarios.__file__).parent

CALLERS = {
    "nurse-jwt": Caller(hospital="HOSP1", actor="ayse", groups=("nurse",),
                        perms=frozenset({"board.view", "alerts.ack"})),
    "auditor-jwt": Caller(hospital="HOSP1", actor="denetci", groups=("auditor",),
                          perms=frozenset({"board.view", "audit.view"})),
    "biomed-jwt": Caller(hospital="HOSP1", actor="ahmet", groups=("biomedical",),
                         perms=frozenset({"devices.manage"})),
}


async def _resolve(token):
    return CALLERS.get(token)


def _app(audit=None):
    return create_app({"tok": "HOSP1"}, run_escalation_loop=False, resolve_jwt=_resolve,
                      audit=audit)


@pytest.fixture
def client():
    with TestClient(_app()) as c:
        yield c


def _hdr(t):
    return {"Authorization": f"Bearer {t}"}


def _drive_shock(client):
    for _ts, fhir in load_scenario(SCEN / "septic_shock.yaml"):
        client.post("/ingest", json=fhir, headers=_hdr("tok"))
    return "bed-3"


def _rows(client, event_type=None):
    return client.app.state.audit.records(tenant="HOSP1", event_type=event_type, limit=1_000_000)


def _shock(client):
    board = client.get("/patients", headers=_hdr("tok")).json()["patients"]
    return next(a for b in board for a in b["alerts"] if a["kind"] == "septic_shock")


def test_board_view_opens_the_board_and_the_ticket(client):
    assert client.get("/patients", headers=_hdr("nurse-jwt")).status_code == 200
    assert client.get("/alerts/bed-3", headers=_hdr("nurse-jwt")).status_code == 200
    assert client.post("/stream-ticket", headers=_hdr("nurse-jwt")).status_code == 200


def test_without_board_view_the_board_is_forbidden_not_unauthorised(client):
    res = client.get("/patients", headers=_hdr("biomed-jwt"))
    assert res.status_code == 403 and "board.view" in res.json()["detail"]
    assert client.get("/alerts/bed-3", headers=_hdr("biomed-jwt")).status_code == 403
    assert client.post("/stream-ticket", headers=_hdr("biomed-jwt")).status_code == 403


def test_ack_needs_alerts_ack_and_is_attributed_to_the_token_not_the_body(client):
    p = _drive_shock(client)
    res = client.post("/ack", json={"patient_id": p, "kind": "septic_shock", "role": "doctor"},
                      headers=_hdr("nurse-jwt"))
    assert res.status_code == 200
    shock = next(a for a in res.json()["alerts"] if a["kind"] == "septic_shock")
    assert shock["acknowledged_by"] == "ayse"          # the signed-in user, not "doctor"

    audit = client.get("/audit?event_type=ack", headers=_hdr("auditor-jwt")).json()["records"]
    payload = audit[-1]["payload"]
    assert payload["role"] == "ayse" and payload["groups"] == ["nurse"]
    assert payload["via"] == "user" and payload["actor"] == "ayse"


def test_ack_is_forbidden_without_alerts_ack_and_writes_nothing(client):
    p = _drive_shock(client)
    before = len(_rows(client))
    res = client.post("/ack", json={"patient_id": p, "kind": "septic_shock"},
                      headers=_hdr("auditor-jwt"))
    assert res.status_code == 403
    assert len(_rows(client)) == before
    assert _shock(client)["acknowledged_by"] is None


def test_audit_needs_audit_view(client):
    assert client.get("/audit", headers=_hdr("auditor-jwt")).status_code == 200
    assert client.get("/audit", headers=_hdr("nurse-jwt")).status_code == 403


def test_view_is_recorded_for_the_signed_in_user_and_their_groups(client):
    assert client.post("/view", json={"patient_id": "bed-3", "role": "whatever"},
                       headers=_hdr("nurse-jwt")).status_code == 200
    rec = client.get("/audit?event_type=view", headers=_hdr("auditor-jwt")).json()["records"][-1]
    assert rec["payload"] == {"role": "ayse", "via": "user", "actor": "ayse",
                              "groups": ["nurse"]}


def test_view_is_forbidden_without_board_view_and_writes_nothing(client):
    res = client.post("/view", json={"patient_id": "bed-3"}, headers=_hdr("biomed-jwt"))
    assert res.status_code == 403
    assert _rows(client, "view") == []


def test_the_device_token_is_exempt_and_keeps_the_body_role(client):
    p = _drive_shock(client)
    res = client.post("/ack", json={"patient_id": p, "kind": "septic_shock", "role": "nurse"},
                      headers=_hdr("tok"))
    assert res.status_code == 200
    shock = next(a for a in res.json()["alerts"] if a["kind"] == "septic_shock")
    assert shock["acknowledged_by"] == "nurse"
    assert client.get("/audit", headers=_hdr("tok")).status_code == 200
    payload = _rows(client, "ack")[-1].payload
    assert payload["role"] == "nurse" and payload["via"] == "device"
    assert payload["actor"] is None and payload["groups"] == []


@pytest.mark.parametrize("role", [{"name": "dr.x"}, ["nurse"], 7, None, True, "", "   ",
                                  "r" * 65], ids=repr)
def test_a_device_role_that_is_not_a_short_string_is_recorded_as_unknown(role):
    """The device path's `role` is self-declared. Anything but a short string (a dict reached the
    audit row, and the legacy board's React render as `acknowledged_by`) is recorded as
    "unknown" — on the ack store, in the audit row, and after a restart."""
    audit = InMemoryAuditLog()
    with TestClient(_app(audit)) as c:
        p = _drive_shock(c)
        res = c.post("/ack", json={"patient_id": p, "kind": "septic_shock", "role": role},
                     headers=_hdr("tok"))
        assert res.status_code == 200
        shock = next(a for a in res.json()["alerts"] if a["kind"] == "septic_shock")
        assert shock["acknowledged_by"] == "unknown"
        assert c.post("/view", json={"patient_id": p, "role": role},
                      headers=_hdr("tok")).status_code == 200
        assert _rows(c, "ack")[-1].payload["role"] == "unknown"
        assert _rows(c, "view")[-1].payload["role"] == "unknown"
    with TestClient(_app(audit)) as again:
        assert _shock(again)["acknowledged_by"] == "unknown"


def test_roles_survive_a_restart_bounded_but_whole():
    """A restart replays the audit log. An old row's dict role (written before the device role
    was bounded) comes back as "unknown"; a signed-in username of the full 128 characters comes
    back whole, not cut to the device path's 64."""
    from datetime import datetime, timezone

    from homunculus.api.audit import AuditEvent

    long_name = "u" * 128

    async def resolve(token):
        if token == "long-name-jwt":
            return Caller(hospital="HOSP1", actor=long_name, groups=("nurse",),
                          perms=frozenset({"board.view", "alerts.ack"}))
        return None

    audit = InMemoryAuditLog()
    app = create_app({"tok": "HOSP1"}, run_escalation_loop=False, resolve_jwt=resolve, audit=audit)
    with TestClient(app) as first:
        p = _drive_shock(first)
        board = first.get("/patients", headers=_hdr("tok")).json()["patients"]
        kinds = sorted(a["kind"] for b in board for a in b["alerts"] if a["kind"] != "septic_shock")
        assert first.post("/ack", json={"patient_id": p, "kind": "septic_shock"},
                          headers=_hdr("long-name-jwt")).status_code == 200
    # What an app before this fix wrote for a device ack whose body role was a dict.
    audit.append(AuditEvent("HOSP1", "ack", p, kinds[0],
                            {"role": {"name": "dr.x"}, "via": "device", "actor": None,
                             "groups": [], "at": datetime.now(timezone.utc).isoformat()}))

    with TestClient(create_app({"tok": "HOSP1"}, run_escalation_loop=False, audit=audit)) as again:
        alerts = {a["kind"]: a for b in again.get("/patients", headers=_hdr("tok")).json()["patients"]
                  for a in b["alerts"]}
        assert alerts["septic_shock"]["acknowledged_by"] == long_name
        assert alerts[kinds[0]]["acknowledged_by"] == "unknown"


def test_a_device_role_of_up_to_64_characters_is_kept(client):
    p = _drive_shock(client)
    role = "r" * 64
    client.post("/ack", json={"patient_id": p, "kind": "septic_shock", "role": role},
                headers=_hdr("tok"))
    assert _shock(client)["acknowledged_by"] == role
    assert _rows(client, "ack")[-1].payload["role"] == role


def test_a_device_naming_a_user_never_reads_as_that_users_action(client):
    """The device token also sits in a browser URL (the legacy `?board=1` screen). Whatever name
    it puts in the body, its row says `via: device` and has no actor."""
    client.post("/view", json={"patient_id": "bed-3", "role": "ayse"}, headers=_hdr("tok"))
    client.post("/view", json={"patient_id": "bed-3"}, headers=_hdr("nurse-jwt"))
    device, user = (r.payload for r in _rows(client, "view"))
    assert device["role"] == user["role"] == "ayse"
    assert (device["via"], device["actor"]) == ("device", None)
    assert (user["via"], user["actor"]) == ("user", "ayse")


def test_a_signed_in_ack_survives_a_restart():
    """`rehydrate` replays `role` as `acknowledged_by`; a fresh app over the same audit log
    shows the signed-in user, not the body's role."""
    audit = InMemoryAuditLog()
    with TestClient(_app(audit)) as first:
        p = _drive_shock(first)
        first.post("/ack", json={"patient_id": p, "kind": "septic_shock", "role": "doctor"},
                   headers=_hdr("nurse-jwt"))
    with TestClient(_app(audit)) as second:
        shock = _shock(second)
        assert shock["acknowledged"] is True and shock["acknowledged_by"] == "ayse"


# ---------------------------------------------------------------- every board route, by table
DEVICE_ONLY = "device only"   # the bridge's static token alone
TICKET = "ticket"             # an SSE stream: a single-use ticket (or the device token), never a JWT
OPEN = "open"                 # no credential
# Aşama A. The forwarder's POST takes only the lane's own token — never a JWT, never a TENANTS
# token (tests/test_infinity_shadow_isolation.py) — and with the stage off (as here) answers 409
# before any credential is read. The board's GET opens for either of two permissions.
SHADOW_TOKEN = "shadow token"
BOARD_OR_DEVICES = "board.view or devices.manage"

BOARD_EXPECTED = {
    ("POST", "/ingest"): DEVICE_ONLY,
    ("POST", "/ack"): "alerts.ack",
    ("POST", "/view"): "board.view",
    ("GET", "/patients"): "board.view",
    ("GET", "/alerts/{patient_id}"): "board.view",
    ("POST", "/stream-ticket"): "board.view",
    ("GET", "/audit"): "audit.view",
    ("GET", "/stream"): TICKET,
    ("GET", "/notifications"): TICKET,
    ("GET", "/health"): OPEN,
    # Arrived from main; gated here like the rest.
    ("POST", "/clinical/{patient_id}"): "clinical.chart",
    ("PUT", "/clinical/{patient_id}/profile"): "clinical.chart",
    ("GET", "/scores/sofa/{patient_id}"): "board.view",
    # A device is additionally refused here: a signature names a person
    # (test_a_device_cannot_sign_a_score, below).
    ("POST", "/scores/sofa/{patient_id}"): "scores.sign",
    ("GET", "/alarm-quality"): "audit.view",
    ("GET", "/audit/verify"): "audit.view",
    ("POST", "/infinity-shadow/readings"): SHADOW_TOKEN,
    ("GET", "/infinity-shadow/board"): BOARD_OR_DEVICES,
}
KINDS = {DEVICE_ONLY, TICKET, OPEN, SHADOW_TOKEN, BOARD_OR_DEVICES}
PERMISSION_ROUTES = sorted(k for k, v in BOARD_EXPECTED.items() if v not in KINDS)


def test_the_table_names_every_board_route_and_only_those():
    routes = api_routes(_app())
    board = {(m, r.path) for r in routes for m in r.methods
             if r.endpoint.__module__ == "homunculus.api.app"}
    assert board == set(BOARD_EXPECTED)
    validate_permissions(BOARD_EXPECTED[k] for k in PERMISSION_ROUTES)


async def _resolve_any(token):
    """`none-jwt` holds no permission; `only:<key>` holds exactly that one."""
    if token == "none-jwt":
        return Caller(hospital="HOSP1", actor="synth-none")
    if token.startswith("only:"):
        return Caller(hospital="HOSP1", actor="synth-one", groups=("synth",),
                      perms=frozenset({token.removeprefix("only:")}))
    return None


async def _call(method, path, credential, query=None):
    """One request against a fresh app. Bounded: an SSE route that wrongly accepted the
    credential would stream forever, and it must fail this test, not hang it."""
    app = create_app({"tok": "HOSP1"}, run_escalation_loop=False, resolve_jwt=_resolve_any)
    url = path.replace("{patient_id}", "bed-3")
    # A body for every route that takes one: a missing body is a 422 from validation, which runs
    # before the route's own permission check and would hide it.
    body = {"json": {}} if method in ("POST", "PUT") else {}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        return await asyncio.wait_for(
            ac.request(method, url, headers=_hdr(credential), params=query, **body), timeout=5)


@pytest.mark.parametrize("route", sorted(BOARD_EXPECTED), ids=" ".join)
async def test_a_jwt_without_permissions_gets_nothing_but_the_open_routes(route):
    method, path = route
    guard = BOARD_EXPECTED[route]
    res = await _call(method, path, "none-jwt")
    if guard == OPEN:
        assert res.status_code == 200
    elif guard == TICKET:
        assert res.status_code == 401
        for jwt in ("none-jwt", "only:board.view"):
            assert (await _call(method, path, jwt, {"token": jwt})).status_code == 401
    elif guard == DEVICE_ONLY:
        assert res.status_code == 403
        assert res.json()["detail"] == "ingest requires a device token"
    elif guard == SHADOW_TOKEN:
        assert res.status_code == 409
        assert res.json()["detail"] == {"reason": "stage_off"}
    elif guard == BOARD_OR_DEVICES:
        assert res.status_code == 403
        assert res.json()["detail"] == f"permission required: {guard}"
    else:
        assert res.status_code == 403
        assert res.json()["detail"] == f"permission required: {guard}"


@pytest.mark.parametrize("route", PERMISSION_ROUTES, ids=" ".join)
async def test_the_listed_permission_alone_opens_the_route(route):
    method, path = route
    res = await _call(method, path, f"only:{BOARD_EXPECTED[route]}")
    assert res.status_code not in (401, 403), res.text


@pytest.mark.parametrize("permission", ["board.view", "devices.manage"])
async def test_either_permission_alone_opens_the_monitor_strip(permission):
    res = await _call("GET", "/infinity-shadow/board", f"only:{permission}")
    assert res.status_code == 200 and res.json() == {"stage": "off"}


async def test_the_device_token_opens_the_device_only_route():
    for (method, path), guard in BOARD_EXPECTED.items():
        if guard == DEVICE_ONLY:
            res = await _call(method, path, "tok")
            assert res.status_code not in (401, 403), res.text


async def test_a_device_cannot_sign_a_score():
    """The one permission a device does not get by being a device: a signature must name a
    person, and the bridge's token names nobody."""
    res = await _call("POST", "/scores/sofa/{patient_id}", "tok")
    assert res.status_code == 403
    assert res.json()["detail"] == "skor formunu yalnız bir kişi imzalayabilir"

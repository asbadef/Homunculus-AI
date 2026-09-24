# homunculus-engine/tests/test_board_permissions.py
"""The board routes check the caller's permissions — for a JWT. The device path (static tenant
token) is a machine credential and is exempt, exactly as before."""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import homunculus.scenarios
from homunculus.api.app import create_app
from homunculus.api.identity import Caller
from homunculus.scenarios.loader import load_scenario

SCEN = Path(homunculus.scenarios.__file__).parent

CALLERS = {
    "nurse-jwt": Caller(hospital="HOSP1", actor="ayse", groups=("nurse",),
                        perms=frozenset({"board.view", "alerts.ack"})),
    "auditor-jwt": Caller(hospital="HOSP1", actor="denetci", groups=("auditor",),
                          perms=frozenset({"board.view", "audit.view"})),
    "biomed-jwt": Caller(hospital="HOSP1", actor="ahmet", groups=("biomedical",),
                         perms=frozenset({"devices.manage"})),
}


@pytest.fixture
def client():
    async def resolve(token):
        return CALLERS.get(token)

    app = create_app({"tok": "HOSP1"}, run_escalation_loop=False, resolve_jwt=resolve)
    with TestClient(app) as c:
        yield c


def _hdr(t):
    return {"Authorization": f"Bearer {t}"}


def _drive_shock(client):
    for _ts, fhir in load_scenario(SCEN / "septic_shock.yaml"):
        client.post("/ingest", json=fhir, headers=_hdr("tok"))
    return "bed-3"


def test_board_view_opens_the_board_and_the_ticket(client):
    assert client.get("/patients", headers=_hdr("nurse-jwt")).status_code == 200
    assert client.get("/alerts/bed-3", headers=_hdr("nurse-jwt")).status_code == 200
    assert client.post("/stream-ticket", headers=_hdr("nurse-jwt")).status_code == 200


def test_without_board_view_the_board_is_forbidden_not_unauthorised(client):
    res = client.get("/patients", headers=_hdr("biomed-jwt"))
    assert res.status_code == 403 and "board.view" in res.json()["detail"]
    assert client.post("/stream-ticket", headers=_hdr("biomed-jwt")).status_code == 403


def test_ack_needs_alerts_ack_and_is_attributed_to_the_token_not_the_body(client):
    p = _drive_shock(client)
    res = client.post("/ack", json={"patient_id": p, "kind": "septic_shock", "role": "doctor"},
                      headers=_hdr("nurse-jwt"))
    assert res.status_code == 200
    shock = next(a for a in res.json()["alerts"] if a["kind"] == "septic_shock")
    assert shock["acknowledged_by"] == "ayse"          # the signed-in user, not "doctor"

    audit = client.get("/audit?event_type=ack", headers=_hdr("auditor-jwt")).json()["records"]
    assert audit[-1]["payload"]["role"] == "ayse" and audit[-1]["payload"]["groups"] == ["nurse"]


def test_ack_is_forbidden_without_alerts_ack(client):
    p = _drive_shock(client)
    res = client.post("/ack", json={"patient_id": p, "kind": "septic_shock"},
                      headers=_hdr("auditor-jwt"))
    assert res.status_code == 403


def test_audit_needs_audit_view(client):
    assert client.get("/audit", headers=_hdr("auditor-jwt")).status_code == 200
    assert client.get("/audit", headers=_hdr("nurse-jwt")).status_code == 403


def test_view_is_recorded_for_the_signed_in_user(client):
    assert client.post("/view", json={"patient_id": "bed-3", "role": "whatever"},
                       headers=_hdr("nurse-jwt")).status_code == 200
    rec = client.get("/audit?event_type=view", headers=_hdr("auditor-jwt")).json()["records"][-1]
    assert rec["payload"]["role"] == "ayse"


def test_the_device_token_is_exempt_and_keeps_the_body_role(client):
    p = _drive_shock(client)
    res = client.post("/ack", json={"patient_id": p, "kind": "septic_shock", "role": "nurse"},
                      headers=_hdr("tok"))
    assert res.status_code == 200
    shock = next(a for a in res.json()["alerts"] if a["kind"] == "septic_shock")
    assert shock["acknowledged_by"] == "nurse"
    assert client.get("/audit", headers=_hdr("tok")).status_code == 200

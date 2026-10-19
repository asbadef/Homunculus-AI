"""Aşama A's lane touches nothing clinical: by its imports, by spies, by its token and by its stage.

The equivalence test (`test_infinity_shadow_equivalence.py`) proves the outputs are identical;
this file proves the mechanism: the lane's modules cannot reach the clinical side, a shadow POST
and GET call none of the clinical writers, the lane's token opens no clinical route, a TENANTS
token does not open the lane, and a stage that is not `shadow` keeps the lane closed and empty.
"""
from __future__ import annotations

import ast
import inspect
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.infinity_shadow import SCHEMA, ShadowSettings, shadow_settings_from_env
from homunculus.api.patient_identity import IdentityRecord, InMemoryIdentityStore
from homunculus.pipeline import Engine
from homunculus.tenant.bedmap import BedMap, BedRef

SRC = Path(__file__).resolve().parents[1] / "src"
PACKAGE = SRC / "homunculus"
HOSPITAL, DEVICE, SHADOW = "HOSP1", "tok-device-00000000000000000000000000", "s" * 40
T0 = 1_800_000_000.0
TABLE = {"schema": "homunculus.infinity-device-beds.v1", "version": 1, "site": "synthetic",
         "approved_by": "test", "approved_at": "2026-07-14",
         "devices": [{"source": "192.0.2.10", "group": "239.20.1.10", "port": 2050, "bed_label": "B-1",
                      "bed_id": "bed-b1", "unit_id": "unit-1", "method": "monitor_screen",
                      "verified_at": "2026-07-14", "valid_from": "2026-07-01T00:00:00Z", "valid_to": None,
                      "note": ""}]}

# The clinical side: the engine and its rules, the gateway, and every API module that writes what
# a clinician, a notification or an auditor sees.
FORBIDDEN = ("homunculus.pipeline", "homunculus.rules", "homunculus.reco", "homunculus.state",
             "homunculus.canonical", "homunculus.gateway", "homunculus.api.audit",
             "homunculus.api.broadcast", "homunculus.api.notify", "homunculus.api.escalation",
             "homunculus.api.rehydrate", "homunculus.api.board")
LANE = ("api/infinity_shadow.py", "api/infinity_device_beds.py", "edge/infinity_shadow.py")


def _imports(path: Path) -> set[str]:
    """Every module a file imports, relative imports resolved against its package."""
    package = ".".join(("homunculus", *path.relative_to(PACKAGE).parent.parts))
    found: set[str] = set()
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"), filename=str(path))):
        if isinstance(node, ast.Import):
            found.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                base = package.split(".")[: len(package.split(".")) - (node.level - 1)]
                module = ".".join([*base, *([node.module] if node.module else [])])
            else:
                module = node.module or ""
            found.add(module)
            found.update(f"{module}.{alias.name}" for alias in node.names)
    return found


def _forbidden(name: str) -> bool:
    return any(name == f or name.startswith(f + ".") for f in FORBIDDEN)


# --- imports -----------------------------------------------------------------------------------

@pytest.mark.parametrize("relative", LANE)
def test_the_lanes_modules_import_nothing_clinical(relative):
    path = PACKAGE / relative
    if not path.exists():
        pytest.skip(f"{relative} is written by the plan's Task 6 (the hub forwarder)")
    imported = _imports(path)
    assert imported, "the scan went blind"
    assert not sorted(name for name in imported if _forbidden(name))
    if relative.startswith("edge/"):
        # The release packs only edge/: an import outside it would fail on the hub anyway.
        outside = sorted(n for n in imported if n.startswith("homunculus") and not n.startswith("homunculus.edge"))
        assert not outside, outside


def test_importing_the_lane_loads_nothing_clinical_even_indirectly():
    code = ("import sys; import homunculus.api.infinity_shadow, homunculus.api.infinity_device_beds; "
            "print('\\n'.join(sorted(m for m in sys.modules if m.startswith('homunculus'))))")
    loaded = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True,
                            env={"PYTHONPATH": str(SRC), "SYSTEMROOT": os.environ.get("SYSTEMROOT", "")},
                            ).stdout.split()
    assert "homunculus.api.infinity_shadow" in loaded
    assert not [m for m in loaded if _forbidden(m)], loaded


# --- spies -------------------------------------------------------------------------------------

class Clock:
    def __init__(self):
        self.t = T0

    def __call__(self):
        return self.t


def _app(tmp_path, settings=None, identities=None):
    path = tmp_path / "device-beds.json"
    path.write_text(json.dumps(TABLE), encoding="utf-8")
    settings = settings or ShadowSettings("shadow", "shadow", None, SHADOW, HOSPITAL, str(path))
    clock = Clock()
    app = create_app({DEVICE: HOSPITAL}, run_escalation_loop=False, shadow=settings, shadow_clock=clock,
                     bedmap=BedMap({"YB^1^1": BedRef("bed-b1", "unit-1", "B-1")}),
                     identities=identities if identities is not None else InMemoryIdentityStore())
    return TestClient(app), clock


def _body(now):
    return {"schema": SCHEMA, "sent_at": now,
            "forwarder": {"interval_s": 5, "sent": 1, "failed": 0, "decoder": "homunculus.infinity-preview.v3"},
            "hub": {"collector_age_s": 1.0, "accepted_packets": 1, "old_or_duplicate_packets": 0},
            "devices": [{"source": "192.0.2.10", "group": "239.20.1.10", "port": 2050, "status": "streaming",
                         "packet_age_ms": 100.0,
                         "readings": [{"parameter": "hr", "value": 180, "unit": "bpm", "valid": True,
                                       "captured_at": now - 0.5}]}]}


def _hdr(token):
    return {"Authorization": f"Bearer {token}"}


def test_a_shadow_post_and_get_call_no_clinical_writer(tmp_path, monkeypatch):
    identities = InMemoryIdentityStore()
    identities.apply(HOSPITAL, IdentityRecord(patient_id="p1", unit="YB", room="1", bed="1", source="test"))
    client, clock = _app(tmp_path, identities=identities)
    calls: list[str] = []

    def spy(owner, name):
        original = getattr(owner, name)

        def wrapper(*args, **kwargs):
            calls.append(name)
            return original(*args, **kwargs)

        async def awrapper(*args, **kwargs):
            calls.append(name)
            return await original(*args, **kwargs)

        monkeypatch.setattr(owner, name, awrapper if inspect.iscoroutinefunction(original) else wrapper)

    state = client.app.state
    spy(state.audit, "append")
    spy(state.broadcaster, "publish")
    spy(state.notification_hub, "publish")
    spy(Engine, "ingest")
    spy(InMemoryIdentityStore, "apply")
    spy(BedMap, "resolve")

    posted = client.post("/infinity-shadow/readings", json=_body(clock.t), headers=_hdr(SHADOW))
    board = client.get("/infinity-shadow/board", headers=_hdr(DEVICE))
    assert posted.status_code == 200 and posted.json()["accepted"] == 1
    assert board.status_code == 200 and board.json()["beds"][0]["link"] == "one"   # the lane really ran
    assert calls == []
    assert state.ack_stores == {}                    # not even an engine or an ack store was built
    assert state.audit.records(tenant=HOSPITAL, limit=10) == []
    # Control: the spies are wired. One real observation trips the engine, the audit and the stream.
    observation = {"resourceType": "Observation", "status": "final",
                   "code": {"coding": [{"code": "heart_rate"}]}, "subject": {"reference": "Patient/p1"},
                   "effectiveDateTime": "2026-07-14T10:00:00+00:00", "valueQuantity": {"value": 72, "unit": "/min"}}
    assert client.post("/ingest", json=observation, headers=_hdr(DEVICE)).status_code == 200
    assert {"ingest", "append", "publish"} <= set(calls)


# --- tokens ------------------------------------------------------------------------------------

CLINICAL_ROUTES = [
    ("POST", "/ingest", {"resourceType": "Observation"}),
    ("POST", "/ack", {"patient_id": "p1", "kind": "news2", "role": "nurse"}),
    ("POST", "/clinical/p1", {"entries": [{"code": "suspected_infection", "value": 1}]}),
    ("GET", "/patients", None),
    ("POST", "/stream-ticket", None),
    ("GET", "/audit", None),
]


@pytest.mark.parametrize(("method", "path", "body"), CLINICAL_ROUTES, ids=[p for _, p, _ in CLINICAL_ROUTES])
def test_the_shadow_token_opens_no_clinical_route(tmp_path, method, path, body):
    client, _ = _app(tmp_path)
    kwargs = {"json": body} if body is not None else {}
    response = client.request(method, path, headers=_hdr(SHADOW), **kwargs)
    assert response.status_code == 401, response.text
    assert client.app.state.audit.records(tenant=HOSPITAL, limit=10) == []


def test_a_tenants_token_does_not_open_the_lane(tmp_path):
    client, clock = _app(tmp_path)
    response = client.post("/infinity-shadow/readings", json=_body(clock.t), headers=_hdr(DEVICE))
    assert response.status_code == 401
    assert client.app.state.shadow_store.devices() == {}


# --- the stage ---------------------------------------------------------------------------------

def test_with_the_stage_off_a_post_is_409_and_the_store_stays_empty(tmp_path):
    client, clock = _app(tmp_path, settings=ShadowSettings())
    response = client.post("/infinity-shadow/readings", json=_body(clock.t), headers=_hdr(SHADOW))
    assert response.status_code == 409
    store = client.app.state.shadow_store
    assert store.devices() == {} and store.feed()["state"] == "never"
    assert client.get("/infinity-shadow/board", headers=_hdr(DEVICE)).json() == {"stage": "off"}


@pytest.mark.parametrize("stage", ["rules", "alarms"])
def test_rules_and_alarms_behave_as_off(tmp_path, stage):
    settings = shadow_settings_from_env({"INFINITY_CLINICAL_STAGE": stage, "INFINITY_SHADOW_TOKEN": SHADOW,
                                         "INFINITY_SHADOW_HOSPITAL": HOSPITAL,
                                         "INFINITY_DEVICE_BEDS_PATH": str(tmp_path / "device-beds.json")},
                                        {DEVICE: HOSPITAL})
    client, clock = _app(tmp_path, settings=settings)
    assert client.post("/infinity-shadow/readings", json=_body(clock.t), headers=_hdr(SHADOW)).status_code == 409
    assert client.app.state.shadow_store.devices() == {}
    assert client.get("/infinity-shadow/board", headers=_hdr(DEVICE)).json() == {
        "stage": "off", "configured_stage": stage, "problem": "stage_not_implemented"}

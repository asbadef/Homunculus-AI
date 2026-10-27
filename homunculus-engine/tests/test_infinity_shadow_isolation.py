"""Aşama A's lane touches nothing clinical: by its imports, by spies, by its token and by its stage.

The equivalence test (`test_infinity_shadow_equivalence.py`) proves the outputs are identical;
this file proves the mechanism: the lane's modules cannot reach the clinical side, a shadow POST
and GET call none of the clinical writers, the lane's token opens no clinical route, a TENANTS
token does not open the lane, and a stage that is neither `shadow` nor `rules` keeps the lane
closed and empty.

Aşama B (spec 2026-10-27, D11): `api/infinity_rules.py`, the bridge to the SHADOW engine, imports
the engine on purpose — it drives a second instance of it — but nothing that rings: not the
notifier, the ack store, the alert lifecycle, the alarm-quality counters, the escalation, the
broadcaster, the audit replay, the clinical door, the app or the board — neither directly nor
through what it imports. And it writes audit rows of its own two kinds only.
"""
from __future__ import annotations

import ast
import inspect
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.infinity_rules import SHADOW_ALERT, SHADOW_CLEARED
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
# Aşama B's bridge (api/infinity_rules.py) is held to its own set: it imports the engine to drive
# the shadow one, and must reach nothing that notifies, acknowledges, ends an episode, counts an
# alarm, escalates, builds or publishes a card, replays the audit into the real engine or charts
# a clinical entry — the frames its pictures go out in are the app's.
RULES_FORBIDDEN = ("homunculus.api.notify", "homunculus.api.ackstore", "homunculus.api.alert_lifecycle",
                   "homunculus.api.alarm_quality", "homunculus.api.app", "homunculus.api.board",
                   "homunculus.api.escalation", "homunculus.api.broadcast", "homunculus.api.rehydrate",
                   "homunculus.api.clinical")
BRIDGE = PACKAGE / "api" / "infinity_rules.py"


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
    assert path.is_file(), f"{relative} is part of the lane; a missing module must fail here, not skip"
    imported = _imports(path)
    assert imported, "the scan went blind"
    assert not sorted(name for name in imported if _forbidden(name))
    if relative.startswith("edge/"):
        # The release packs only edge/: an import outside it would fail on the hub anyway.
        outside = sorted(n for n in imported if n.startswith("homunculus") and not n.startswith("homunculus.edge"))
        assert not outside, outside


def test_the_trend_charts_import_nothing_of_the_lane():
    """The other direction (spec §5.5, D7): the clinical trends charts no Aşama A value. Its
    readings keep no history, are bound to no patient and are unvalidated; a chart of them would
    put an unvalidated number on a clinical axis."""
    imported = _imports(PACKAGE / "api" / "trends.py")
    assert imported, "the scan went blind"
    lane = ("homunculus.api.infinity_shadow", "homunculus.api.infinity_device_beds",
            "homunculus.edge")
    assert not sorted(n for n in imported if any(n == m or n.startswith(m + ".") for m in lane))


def _rules_forbidden(name: str) -> bool:
    return any(name == f or name.startswith(f + ".") for f in RULES_FORBIDDEN)


def test_the_forbidden_modules_of_the_bridge_exist():
    """A name in RULES_FORBIDDEN that names no module would hold the bridge to nothing."""
    for name in RULES_FORBIDDEN:
        assert (SRC / Path(*name.split("."))).with_suffix(".py").is_file(), name


def test_the_bridge_imports_nothing_that_rings():
    imported = _imports(BRIDGE)
    assert "homunculus.pipeline" in imported, "the scan went blind"
    assert not sorted(n for n in imported if _rules_forbidden(n))


def test_importing_the_bridge_loads_nothing_that_rings_even_indirectly():
    """The transitive check: what the bridge's imports import, in a fresh interpreter with no
    environment — the AST scan above sees only the bridge's own lines."""
    code = ("import sys; import homunculus.api.infinity_rules; "
            "print('\\n'.join(sorted(m for m in sys.modules if m.startswith('homunculus'))))")
    loaded = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True,
                            env={"PYTHONPATH": str(SRC), "SYSTEMROOT": os.environ.get("SYSTEMROOT", "")},
                            ).stdout.split()
    assert "homunculus.api.infinity_rules" in loaded and "homunculus.pipeline" in loaded, "the scan went blind"
    assert not [m for m in loaded if _rules_forbidden(m)], loaded


def test_the_bridge_writes_only_the_two_shadow_audit_kinds():
    """Every `AuditEvent(` in the bridge names its kind by SHADOW_ALERT or SHADOW_CLEARED, and those
    are the two shadow kinds. Counted against the calls themselves: a call whose kind is a string
    literal, or anything but a plain name, does not match the pattern and fails the count."""
    text = BRIDGE.read_text(encoding="utf-8")
    calls = re.findall(r"\bAuditEvent\(", text)
    kinds = re.findall(r"\bAuditEvent\(\s*\w+\s*,\s*(\w+)\s*,", text)
    assert calls and len(kinds) == len(calls), (len(calls), kinds)
    assert set(kinds) == {"SHADOW_ALERT", "SHADOW_CLEARED"}, kinds
    assert (SHADOW_ALERT, SHADOW_CLEARED) == ("shadow_alert", "shadow_alert_cleared")


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
                                       "captured_at": now - 0.5}]
                         + [{"parameter": name, "value": value, "unit": "mmHg", "valid": True,
                             "captured_at": now - 0.5, "changed_at": now - 120.0}
                            for name, value in (("nbp_systolic", 201), ("nbp_diastolic", 119), ("nbp_mean", 146))]}]}


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
    assert posted.status_code == 200 and posted.json()["accepted"] == 4
    assert board.status_code == 200 and board.json()["beds"][0]["link"] == "one"   # the lane really ran
    assert board.json()["beds"][0]["parameters"][-1]["systolic"] == 201              # NBP with it
    assert calls == []
    assert state.ack_stores == {}                    # not even an engine or an ack store was built
    assert state.audit.records(tenant=HOSPITAL, limit=10) == []
    # Control: the spies are wired. One real observation trips the engine, the audit and the stream.
    observation = {"resourceType": "Observation", "status": "final",
                   "code": {"coding": [{"code": "heart_rate"}]}, "subject": {"reference": "Patient/p1"},
                   "effectiveDateTime": "2026-07-14T10:00:00+00:00", "valueQuantity": {"value": 72, "unit": "/min"}}
    assert client.post("/ingest", json=observation, headers=_hdr(DEVICE)).status_code == 200
    assert {"ingest", "append", "publish"} <= set(calls)


def test_a_trends_read_never_reaches_the_shadow_store(tmp_path, monkeypatch):
    """The lane holds a heart rate of 180 and an NBP of 201/119 for p1's bed and the clinical chart
    holds 72; the trends of p1 must show the 72 and nothing of the lane — no pressure point at all —
    and must not even ask the shadow store."""
    identities = InMemoryIdentityStore()
    identities.apply(HOSPITAL, IdentityRecord(patient_id="p1", unit="YB", room="1", bed="1", source="test"))
    client, clock = _app(tmp_path, identities=identities)
    assert client.post("/infinity-shadow/readings", json=_body(clock.t), headers=_hdr(SHADOW)).status_code == 200
    # The clinical lane's own reading, stamped against the real clock: the route cuts its window at
    # the server's now. Without it "no points" would be trivially true of an empty patient.
    clinical = {"resourceType": "Observation", "status": "final",
                "code": {"coding": [{"code": "heart_rate"}]}, "subject": {"reference": "Patient/p1"},
                "effectiveDateTime": (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat(),
                "valueQuantity": {"value": 72, "unit": "/min"}}
    assert client.post("/ingest", json=clinical, headers=_hdr(DEVICE)).status_code == 200
    calls: list[str] = []
    store = client.app.state.shadow_store
    for name in ("devices", "feed"):
        original = getattr(store, name)
        monkeypatch.setattr(store, name, lambda *a, _n=name, _o=original, **k: (calls.append(_n), _o(*a, **k))[1])

    answer = client.get("/patients/p1/trends", headers=_hdr(DEVICE))

    assert answer.status_code == 200, answer.text
    channels = {channel["key"]: channel for channel in answer.json()["channels"]}
    assert [point[1] for point in channels["heart_rate"]["points"]] == [72.0]   # the clinical lane, not 180
    assert all(channel["points"] == [] for key, channel in channels.items() if key != "heart_rate")
    assert calls == []
    # Control: the spies are wired. The shadow board's own read does reach both store reads.
    assert client.get("/infinity-shadow/board", headers=_hdr(DEVICE)).status_code == 200
    assert {"devices", "feed"} <= set(calls)


# --- tokens ------------------------------------------------------------------------------------

CLINICAL_ROUTES = [
    ("POST", "/ingest", {"resourceType": "Observation"}),
    ("POST", "/ack", {"patient_id": "p1", "kind": "news2", "role": "nurse"}),
    ("POST", "/clinical/p1", {"entries": [{"code": "suspected_infection", "value": 1}]}),
    ("GET", "/patients", None),
    ("GET", "/patients/p1/trends", None),
    ("POST", "/stream-ticket", None),
    ("GET", "/audit", None),
    # Aşama B's «uyarsaydı» list names patients: the lane's key does not read it either. (A device
    # token passes every permission and reads it with the stage `rules`; below it, it is 409 —
    # `test_below_rules_the_findings_route_is_409`.)
    ("GET", "/infinity-shadow/findings", None),
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


def _stage(tmp_path, stage, **extra):
    return shadow_settings_from_env({"INFINITY_CLINICAL_STAGE": stage, "INFINITY_SHADOW_TOKEN": SHADOW,
                                     "INFINITY_SHADOW_HOSPITAL": HOSPITAL,
                                     "INFINITY_DEVICE_BEDS_PATH": str(tmp_path / "device-beds.json"), **extra},
                                    {DEVICE: HOSPITAL})


@pytest.mark.parametrize("stage", ["alarms"])
def test_alarms_behaves_as_off(tmp_path, stage):
    client, clock = _app(tmp_path, settings=_stage(tmp_path, stage))
    assert client.post("/infinity-shadow/readings", json=_body(clock.t), headers=_hdr(SHADOW)).status_code == 409
    assert client.app.state.shadow_store.devices() == {}
    assert client.get("/infinity-shadow/board", headers=_hdr(DEVICE)).json() == {
        "stage": "off", "configured_stage": stage, "problem": "stage_not_implemented"}


def test_rules_is_a_stage_and_its_lane_is_on(tmp_path):
    settings = _stage(tmp_path, "rules")                  # no INFINITY_RULES_PARAMETERS: the default list
    client, clock = _app(tmp_path, settings=settings)
    assert client.post("/infinity-shadow/readings", json=_body(clock.t), headers=_hdr(SHADOW)).status_code == 200
    board = client.get("/infinity-shadow/board", headers=_hdr(DEVICE)).json()
    assert board["stage"] == "rules" and board["feed"]["rules_state"] == "ok"
    assert board["beds"][0]["parameters"][0]["value"] == 180            # the strip runs within it


def test_rules_with_an_unknown_parameter_behaves_as_off(tmp_path):
    client, clock = _app(tmp_path, settings=_stage(tmp_path, "rules", INFINITY_RULES_PARAMETERS="hr,bogus"))
    assert client.post("/infinity-shadow/readings", json=_body(clock.t), headers=_hdr(SHADOW)).status_code == 409
    assert client.app.state.shadow_store.devices() == {}
    assert client.app.state.shadow_lane.engines == {}
    assert client.get("/infinity-shadow/board", headers=_hdr(DEVICE)).json() == {
        "stage": "off", "configured_stage": "rules", "problem": "parameters_unknown"}


@pytest.mark.parametrize("stage", ["off", "shadow"])
def test_below_rules_the_findings_route_is_409(tmp_path, stage):
    # The device token passes `board.view`, so it is not 401 here as the lane's token is: below the
    # stage `rules` the route answers 409 and reads nothing.
    settings = ShadowSettings() if stage == "off" else None
    client, _ = _app(tmp_path, settings=settings)
    response = client.get("/infinity-shadow/findings", headers=_hdr(DEVICE))
    assert response.status_code == 409 and response.json()["detail"] == {"reason": "stage_not_rules"}
    assert client.app.state.audit.records(tenant=HOSPITAL, limit=10) == []

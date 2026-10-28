"""Lane C (dalga): GET /infinity-waves/{device_id} — the hub behind one keep-alive client with a
250 ms single-flight cache, the allow-list, the strip board's gates, and nothing written.

The hub is never contacted: `HubWaves` gets an httpx.MockTransport. Synthetic addresses (TEST-NET
192.0.2.x), synthetic sample patterns, no patient anywhere."""
from __future__ import annotations

import ast
import asyncio
import json
import logging
import os
import subprocess
import sys
import tomllib
from contextlib import contextmanager
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from homunculus.api import infinity_waves
from homunculus.api.infinity_waves import (
    CACHE_S, MAX_BODY, REASONS, HubWaves, WaveSettings, answer, checked, wave_settings_from_env,
)
from homunculus.edge.infinity_waves import SCHEMA

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
VIEWER = "v" * 40
ON = WaveSettings(True, "https://hub.example:8766", VIEWER, "/etc/homunculus/infinity-ca.pem")
BED, OTHER_UNIT, UNLISTED = "192.0.2.10", "192.0.2.11", "192.0.2.13"
STARTED, RESTARTED = "2027-01-15T06:00:00.000Z", "2027-01-15T07:00:30.000Z"     # two hub processes


def block(seq, t, wave=0x0103, rate=200, samples="pattern"):
    values = ([(seq * 7 + i) % 300 - 150 for i in range(rate // 5)] if samples == "pattern" else samples)
    return {"seq": seq, "t": t, "recv": "2027-01-15T07:00:00.000Z", "id": wave, "rate": rate, "samples": values}


def window(blocks=None, *, device=BED, cursor=None, started=STARTED):
    # The hub lists blocks in DEVICE-TIME order (then wave id), so `seq` is not monotonic down the list.
    blocks = blocks if blocks is not None else [
        block(1, 1000.0), block(3, 1000.0, 0x0301, 100), block(2, 1000.2), block(4, 1000.2, 0x0301, 100, None)]
    return {"schema": SCHEMA, "device_id": device, "hub_now": "2027-01-15T07:00:00.500Z", "started": started,
            "cursor": cursor if cursor is not None else max((b["seq"] for b in blocks), default=0), "blocks": blocks}


class Hub:
    """A fake hub: answers the waves route with `payload` (default: a window for the monitor asked
    for), or `status`/`content`, or raises `error`; it keeps every request."""

    def __init__(self, *, status=200, payload=None, content=None, error=None, delay=0.0):
        self.status, self.payload, self.content, self.error, self.delay = status, payload, content, error, delay
        self.requests = []

    async def __call__(self, request):
        self.requests.append(request)
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.error is not None:
            raise self.error("synthetic", request=request)
        if self.content is not None:
            return httpx.Response(self.status, content=self.content)
        return httpx.Response(self.status, json=self.payload if self.payload is not None
                              else window(device=request.url.params["device"]))


# --- the settings ---------------------------------------------------------------------------------

def test_the_flag_reads_on_and_names_what_stops_it():
    hub = {"INFINITY_HUB_URL": "https://hub.example:8766/", "INFINITY_VIEWER_TOKEN": VIEWER,
           "INFINITY_HUB_CA_FILE": "/etc/homunculus/infinity-ca.pem"}
    assert wave_settings_from_env({}) == WaveSettings()
    assert wave_settings_from_env({**hub, "INFINITY_WAVES": "yes"}) == WaveSettings()
    on = wave_settings_from_env({**hub, "INFINITY_WAVES": " ON "})
    assert on.on and on.url == "https://hub.example:8766" and on.token == VIEWER
    assert wave_settings_from_env({"INFINITY_WAVES": "on"}).problem == "not_configured"
    assert wave_settings_from_env({**hub, "INFINITY_WAVES": "on", "INFINITY_HUB_URL": "http://hub"}).problem == "misconfigured"
    assert VIEWER not in repr(on)


def test_a_hub_url_httpx_cannot_parse_is_named_at_start_not_raised_per_request():
    env = {"INFINITY_WAVES": "on", "INFINITY_HUB_URL": "https://hub:abc", "INFINITY_VIEWER_TOKEN": VIEWER,
           "INFINITY_HUB_CA_FILE": "/etc/homunculus/infinity-ca.pem"}
    settings = wave_settings_from_env(env)
    assert settings.problem == "misconfigured" and settings.on is False


def test_httpx_is_a_runtime_dependency_of_the_api_image():
    project = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))["project"]
    assert any(dep.split(">")[0].split("=")[0].strip() == "httpx" for dep in project["dependencies"])


# --- the window and the browser's copy ------------------------------------------------------------

@pytest.mark.parametrize("raw", [
    [], {**window(), "cursor": -1}, {**window(), "cursor": True}, {**window(), "hub_now": "x" * 41},
    {key: value for key, value in window().items() if key != "started"},      # no hub process named
    {**window(), "started": ""}, {**window(), "started": 7}, {**window(), "started": "x" * 41},
    window([block(5, 1000.0)], cursor=4),                         # a block after the hub's own cursor
    window([dict(block(1, 1000.0), rate=True)]), window([dict(block(1, 1000.0), t=float("nan"))]),
    window([dict(block(1, 1000.0), t=10 ** 400)]), window([dict(block(1, 1000.0), t=2 ** 53)]),   # no OverflowError
    window([block(1, 1000.0, samples=[1] * 39)]), window([block(1, 1000.0, samples=[40000] * 40)]),
    window([block(1, 1000.0, samples=[1.5] * 40)]), window(["not a block"], cursor=1),
])
def test_checked_refuses_what_is_not_a_window(raw):
    with pytest.raises(ValueError):
        checked(raw, BED)


def test_checked_takes_an_integer_instant_a_float_holds_exactly():
    assert checked(window([dict(block(1, 1000.0), t=1000)]), BED)["blocks"][0]["t"] == 1000.0


def test_checked_drops_a_wave_the_catalogue_does_not_name():
    assert [b["id"] for b in checked(window([block(1, 1000.0), block(2, 1000.0, 0x7777, 100)]), BED)["blocks"]] == [0x0103]


def test_answer_drops_seq_and_starts_again_for_a_cursor_from_before_a_restart():
    checked_window = checked(window(), BED)
    assert checked_window["started"] == STARTED
    assert [b["id"] for b in answer(BED, checked_window, 3)["blocks"]] == [0x0301]
    assert len(answer(BED, checked_window, 10)["blocks"]) == 4
    copy = answer(BED, checked_window, 0)
    assert set(copy) == {"schema", "device_id", "cursor", "hub_now", "started", "blocks", "waves"}
    assert copy["started"] == STARTED                                # the hub process, passed on unchanged
    assert all(set(b) == {"t", "recv", "id", "rate", "samples"} for b in copy["blocks"])
    assert copy["waves"]["259"]["label"] is None and copy["waves"]["3585"]["label"] == "P1"


def test_the_cursor_is_the_answers_own_never_taken_from_a_block():
    # Blocks are in device-time order, so neither the last block's seq nor the largest is the hub's
    # cursor (which also counts other monitors' blocks and blocks since dropped).
    held = checked(window([block(9, 1000.0), block(6, 1000.2), block(7, 1000.4)], cursor=12), BED)
    assert held["cursor"] == 12
    copy = answer(BED, held, 6)
    assert copy["cursor"] == 12
    assert [b["t"] for b in copy["blocks"]] == [1000.0, 1000.4]         # filtered block by block, order kept


def test_a_cursor_ahead_of_the_hubs_is_served_whole_even_from_the_same_process():
    assert len(answer(BED, checked(window(), BED), 10, started=STARTED)["blocks"]) == 4


# --- the shared client: keep-alive, the cache, single-flight, the failures -----------------------

async def test_two_viewers_of_one_bed_cost_one_hub_request_and_two_beds_two():
    gate = asyncio.Event()
    calls = []

    async def handler(request):
        calls.append(request.url.params["device"])
        await gate.wait()
        return httpx.Response(200, json=window(device=request.url.params["device"]))

    feed = HubWaves(ON, transport=httpx.MockTransport(handler))
    first, second, other = (asyncio.ensure_future(feed.window(d)) for d in (BED, BED, OTHER_UNIT))
    await asyncio.sleep(0.01)
    gate.set()
    a, b, c = await asyncio.gather(first, second, other)
    assert a is b and a.status == 200 and c.status == 200
    assert sorted(calls) == [BED, OTHER_UNIT]


async def test_an_answer_is_reused_for_250_ms_then_asked_for_again_and_forgotten():
    now = [0.0]
    hub = Hub()
    feed = HubWaves(ON, transport=httpx.MockTransport(hub), clock=lambda: now[0])
    await feed.window(BED)
    await feed.window(BED)
    assert len(hub.requests) == 1
    request = hub.requests[0]
    assert request.url.path == "/infinity-research/waves"
    assert request.url.params.get_list("device") == [BED] and request.url.params["since"] == "0"
    assert request.headers["authorization"] == "Bearer " + VIEWER
    now[0] = CACHE_S + 0.05
    await feed.window(BED)
    assert len(hub.requests) == 2
    await asyncio.sleep(CACHE_S + 0.1)
    assert feed._cache == {}                                         # nothing outlives its 250 ms


async def test_a_failure_is_cached_too_so_a_dead_hub_is_not_hammered():
    hub = Hub(status=500)
    feed = HubWaves(ON, transport=httpx.MockTransport(hub), clock=lambda: 0.0)
    assert (await feed.window(BED)).status == 503
    assert (await feed.window(BED)).status == 503
    assert len(hub.requests) == 1


async def test_every_waiter_leaving_does_not_cancel_the_flight():
    gate = asyncio.Event()
    calls = []

    async def handler(request):
        calls.append(request)
        await gate.wait()
        return httpx.Response(200, json=window())

    feed = HubWaves(ON, transport=httpx.MockTransport(handler), clock=lambda: 0.0)
    waiters = [asyncio.ensure_future(feed.window(BED)) for _ in range(2)]
    await asyncio.sleep(0.01)
    for waiter in waiters:
        waiter.cancel()
    await asyncio.gather(*waiters, return_exceptions=True)
    gate.set()
    await asyncio.sleep(0.01)                                        # the flight finishes with nobody waiting
    assert feed._flights == {} and BED in feed._cache
    assert (await feed.window(BED)).status == 200 and len(calls) == 1


async def test_ten_polls_across_cache_expiry_use_one_client_and_one_hub_request_per_expiry():
    now = [0.0]
    hub = Hub()
    feed = HubWaves(ON, transport=httpx.MockTransport(hub), clock=lambda: now[0])
    await feed.window(BED)
    client = feed._client
    for n in range(1, 11):
        now[0] = n * (CACHE_S + 0.05)
        await feed.window(BED)
        await feed.window(BED)                                       # inside the 250 ms: the cache
        assert len(hub.requests) == n + 1 and feed._client is client


async def test_aclose_ends_the_client_and_a_later_request_makes_a_fresh_one():
    now = [0.0]
    hub = Hub()
    feed = HubWaves(ON, transport=httpx.MockTransport(hub), clock=lambda: now[0])
    await HubWaves(ON).aclose()                                      # never used: nothing to close
    await feed.window(BED)
    client = feed._client
    await feed.aclose()
    await feed.aclose()                                              # twice is fine
    assert client.is_closed and feed._client is None
    now[0] = CACHE_S + 0.05
    assert (await feed.window(BED)).status == 200
    assert feed._client is not client and not feed._client.is_closed and len(hub.requests) == 2
    await feed.aclose()


async def test_a_restarted_hub_is_served_whole_not_filtered_by_the_old_cursor():
    now = [0.0]
    hub = Hub()
    feed = HubWaves(ON, transport=httpx.MockTransport(hub), clock=lambda: now[0])
    before = answer(BED, (await feed.window(BED)).body, 0)           # a viewer, holding cursor 4 of hub STARTED
    assert (before["started"], before["cursor"]) == (STARTED, 4)
    # The hub restarts: its cursor counts from 0 again and has already passed the viewer's 4.
    hub.payload = window([block(i, 2000.0 + i / 5) for i in range(1, 7)], cursor=6, started=RESTARTED)
    now[0] = CACHE_S + 0.05
    after = await feed.window(BED)
    assert len(hub.requests) == 2 and after.body["started"] == RESTARTED
    assert len(answer(BED, after.body, 4)["blocks"]) == 2            # a cursor alone cannot tell: blocks 1-4 are lost
    whole = answer(BED, after.body, before["cursor"], started=before["started"])
    assert whole["started"] == RESTARTED and len(whole["blocks"]) == 6
    assert len(answer(BED, after.body, 4, started=RESTARTED)["blocks"]) == 2    # the same process: the cursor filters


@pytest.mark.parametrize("hub, status, detail", [
    (Hub(status=404), 503, {"reason": "hub_no_waves"}),            # a hub without the route (before R5)
    (Hub(status=409), 503, {"reason": "research_off"}),
    (Hub(status=401), 503, {"reason": "hub_unauthorized"}),
    (Hub(status=500), 503, {"reason": "hub_error", "status": 500}),
    (Hub(status=302), 503, {"reason": "hub_error", "status": 302}),     # no redirect is followed
    (Hub(error=httpx.ConnectTimeout), 503, {"reason": "hub_timeout"}),
    (Hub(error=httpx.ConnectError), 503, {"reason": "hub_unreachable"}),
    (Hub(content=b"x" * (MAX_BODY + 1)), 502, {"reason": "hub_too_large"}),
    (Hub(content=b"not json"), 502, {"reason": "hub_invalid"}),
    (Hub(payload=window(device="192.0.2.99")), 502, {"reason": "hub_invalid"}),   # another monitor's window
    (Hub(payload={**window(), "schema": "other"}), 502, {"reason": "hub_invalid"}),
    (Hub(payload={**window(), "started": ""}), 502, {"reason": "hub_invalid"}),    # a hub that names no process
    (Hub(payload=window([dict(block(1, 1000.0), t=10 ** 400)])), 502, {"reason": "hub_invalid"}),   # json.loads takes it
])
async def test_a_hub_failure_is_a_named_outcome(hub, status, detail):
    outcome = await HubWaves(ON, transport=httpx.MockTransport(hub)).window(BED)
    assert (outcome.status, outcome.body) == (status, detail)


async def test_a_slow_hub_is_a_timeout(monkeypatch):
    monkeypatch.setattr(infinity_waves, "TIMEOUT_S", 0.05)
    outcome = await HubWaves(ON, transport=httpx.MockTransport(Hub(delay=1.0))).window(BED)
    assert (outcome.status, outcome.body) == (503, {"reason": "hub_timeout"})


def test_the_client_is_one_follows_no_redirect_and_reads_no_proxy_from_the_environment():
    feed = HubWaves(ON, transport=httpx.MockTransport(Hub()))
    client = feed._http()
    assert feed._http() is client
    assert client.follow_redirects is False and client.trust_env is False


async def test_an_unreadable_ca_file_is_a_misconfiguration_not_a_crash(tmp_path):
    feed = HubWaves(WaveSettings(True, "https://hub.example:8766", VIEWER, str(tmp_path / "missing.pem")))
    outcome = await feed.window(BED)
    assert outcome.status == 503 and outcome.body == {"reason": "misconfigured"}


async def test_a_url_httpx_refuses_is_a_misconfiguration_not_a_crash():
    feed = HubWaves(WaveSettings(True, "https://hub:abc", VIEWER, "/x.pem"), transport=httpx.MockTransport(Hub()))
    outcome = await feed.window(BED)                                 # settings catch it first; this is the net
    assert (outcome.status, outcome.body) == (503, {"reason": "misconfigured"})


def test_every_reason_the_module_emits_is_in_the_one_set():
    found = set()
    for node in ast.walk(ast.parse((SRC / "homunculus/api/infinity_waves.py").read_text(encoding="utf-8"))):
        if isinstance(node, ast.Dict):
            found.update(value.value for key, value in zip(node.keys, node.values)
                         if isinstance(key, ast.Constant) and key.value == "reason" and isinstance(value, ast.Constant))
        elif isinstance(node, ast.keyword) and node.arg == "problem" and isinstance(node.value, ast.Constant):
            found.add(node.value.value)
        elif (isinstance(node, ast.Assign) and isinstance(node.value, ast.Dict)
              and any(isinstance(target, ast.Name) and target.id == "_UPSTREAM" for target in node.targets)):
            found.update(value.value for value in node.value.values)
    assert found == REASONS                                          # nothing emitted outside it, nothing stale in it


# --- isolation: nothing clinical ------------------------------------------------------------------

FORBIDDEN = ("homunculus.pipeline", "homunculus.rules", "homunculus.reco", "homunculus.state",
             "homunculus.canonical", "homunculus.gateway", "homunculus.api.audit", "homunculus.api.broadcast",
             "homunculus.api.notify", "homunculus.api.escalation", "homunculus.api.rehydrate",
             "homunculus.api.board", "homunculus.api.app", "homunculus.db")


def _forbidden(name):
    return any(name == f or name.startswith(f + ".") for f in FORBIDDEN)


def test_the_module_imports_nothing_clinical():
    found = set()
    for node in ast.walk(ast.parse((SRC / "homunculus/api/infinity_waves.py").read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            found.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            found.add(node.module or "")
    assert "homunculus.edge.infinity_waves" in found, "the scan went blind"
    assert not sorted(name for name in found if _forbidden(name))


def test_importing_it_loads_nothing_clinical_even_indirectly():
    code = ("import sys; import homunculus.api.infinity_waves; "
            "print('\\n'.join(sorted(m for m in sys.modules if m.startswith('homunculus'))))")
    loaded = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True,
                            env={"PYTHONPATH": str(SRC), "SYSTEMROOT": os.environ.get("SYSTEMROOT", "")}).stdout.split()
    assert "homunculus.api.infinity_waves" in loaded
    assert not [m for m in loaded if _forbidden(m)], loaded


# === the route: GET /infinity-waves/{device_id}, behind the strip board's own gates ===============

from homunculus.api.app import create_app  # noqa: E402
from homunculus.api.audit import InMemoryAuditLog  # noqa: E402
from homunculus.api.identity import Caller  # noqa: E402
from homunculus.api.infinity_shadow import SCHEMA as SHADOW_SCHEMA, ShadowSettings  # noqa: E402
from homunculus.api.patient_identity import InMemoryIdentityStore  # noqa: E402
from homunculus.scope import Scope, ScopeReason  # noqa: E402

HOSPITAL, DEVICE_TOKEN, SHADOW = "HOSP1", "tok-device-00000000000000000000000000", "s" * 40
T0 = 1_800_000_000.0


def _row(source, label, bed, unit):
    return {"source": source, "group": "239.20.1." + source.rsplit(".", 1)[1], "port": 2050, "bed_label": label,
            "bed_id": bed, "unit_id": unit, "method": "monitor_screen", "verified_at": "2026-07-14",
            "valid_from": "2026-07-01T00:00:00Z", "valid_to": None, "note": ""}


TABLE = {"schema": "homunculus.infinity-device-beds.v1", "version": 1, "site": "synthetic",
         "approved_by": "test", "approved_at": "2026-07-14",
         "devices": [_row(BED, "B-1", "bed-b1", "unit-1"), _row(OTHER_UNIT, "B-2", "bed-b2", "unit-2")]}
CALLERS = {
    "nurse-jwt": Caller(hospital=HOSPITAL, actor="ayse", groups=("nurse",), perms=frozenset({"board.view"})),
    "scoped-jwt": Caller(hospital=HOSPITAL, actor="elif", groups=("nurse",), perms=frozenset({"board.view"})),
    "biomed-jwt": Caller(hospital=HOSPITAL, actor="ahmet", groups=("biomedical",), perms=frozenset({"devices.manage"})),
    "none-jwt": Caller(hospital=HOSPITAL, actor="synth-none"),
    "elsewhere-jwt": Caller(hospital="HOSP2", actor="x", groups=("nurse",), perms=frozenset({"board.view"})),
}
SCOPES = {"scoped-jwt": Scope(False, ScopeReason.ASSIGNED, unit_ids=frozenset({"unit-1"}))}


async def _resolve_jwt(token):
    return CALLERS.get(token)


async def _resolve_scope(token):
    return SCOPES.get(token, Scope(True, ScopeReason.UNASSIGNED))


def _hdr(token):
    return {"Authorization": f"Bearer {token}"} if token else {}


def _readings(now):
    return {"schema": SHADOW_SCHEMA, "sent_at": now,
            "forwarder": {"interval_s": 5, "sent": 1, "failed": 0, "decoder": "homunculus.infinity-preview.v3"},
            "hub": {"collector_age_s": 1.0, "accepted_packets": 10, "old_or_duplicate_packets": 0},
            "devices": [{"source": s, "group": "239.20.1." + s.rsplit(".", 1)[1], "port": 2050,
                         "status": "streaming", "packet_age_ms": 120.0,
                         "readings": [{"parameter": "hr", "value": 72, "unit": "bpm", "valid": True,
                                       "captured_at": now - 0.4}]}
                        for s in (BED, OTHER_UNIT, UNLISTED)]}


@contextmanager
def _client(tmp_path, *, hub=None, settings=ON, stage=True, audit=None):
    path = tmp_path / "device-beds.json"
    path.write_text(json.dumps(TABLE), encoding="utf-8")
    shadow = ShadowSettings("shadow", "shadow", None, SHADOW, HOSPITAL, str(path)) if stage else ShadowSettings()
    app = create_app({DEVICE_TOKEN: HOSPITAL}, run_escalation_loop=False, resolve_jwt=_resolve_jwt,
                     resolve_scope=_resolve_scope, shadow=shadow, shadow_clock=lambda: T0,
                     audit=audit if audit is not None else InMemoryAuditLog(), identities=InMemoryIdentityStore())
    hub = hub if hub is not None else Hub()
    app.state.wave_feed = HubWaves(settings, transport=httpx.MockTransport(hub))
    with TestClient(app) as client:
        if stage:
            assert client.post("/infinity-shadow/readings", json=_readings(T0), headers=_hdr(SHADOW)).status_code == 200
        yield client, hub


def _get(client, device=BED, token="nurse-jwt", since="0", started=None):
    params = {"since": since} if started is None else {"since": since, "started": started}
    return client.get(f"/infinity-waves/{device}", params=params, headers=_hdr(token))


def test_a_permitted_caller_gets_the_monitors_blocks_and_the_catalogue(tmp_path):
    with _client(tmp_path) as (client, hub):
        response = _get(client)
    assert response.status_code == 200 and response.headers["cache-control"] == "no-store"
    body = response.json()
    assert set(body) == {"schema", "device_id", "cursor", "hub_now", "started", "blocks", "waves"}
    assert (body["schema"], body["device_id"], body["cursor"], body["started"]) == (SCHEMA, BED, 4, STARTED)
    assert [set(b) for b in body["blocks"]] == [{"t", "recv", "id", "rate", "samples"}] * 4
    assert body["blocks"][3]["samples"] is None
    assert body["waves"]["259"] == {"kind": "ecg", "label": None, "rate": 200, "unit": None, "scale": None,
                                    "evidence": "structural"}
    assert body["waves"]["769"]["label"] == "ART" and body["waves"]["3585"]["label"] == "P1"
    assert body["waves"]["769"]["unit"] == "mmHg" and body["waves"]["769"]["scale"] == 0.025
    assert [r.url.params["device"] for r in hub.requests] == [BED]


def test_each_caller_gets_the_blocks_after_its_own_cursor(tmp_path):
    with _client(tmp_path) as (client, _):
        assert [b["id"] for b in _get(client, since="2").json()["blocks"]] == [0x0301, 0x0301]   # seq 3, 4
        assert _get(client, since="4").json()["blocks"] == []
        assert len(_get(client, since="999").json()["blocks"]) == 4          # a cursor from before a hub restart
        for bad in ("-1", "x", "1" * 16):
            response = _get(client, since=bad)
            assert response.status_code == 400 and response.json()["detail"] == {"reason": "bad_since"}


def test_a_caller_names_the_hub_process_its_cursor_came_from(tmp_path):
    # The hub restarted and has already counted past the viewer's cursor 4: a cursor alone would
    # silently skip blocks 1-4; the process name makes the restart exact (R19, amendment A3).
    restarted = Hub(payload=window([block(i, 2000.0 + i / 5) for i in range(1, 7)], cursor=6, started=RESTARTED))
    with _client(tmp_path, hub=restarted) as (client, _):
        same = _get(client, since="4", started=RESTARTED)
        other = _get(client, since="4", started=STARTED)
        unsaid = _get(client, since="4")
        nothing = _get(client, since="4", started="")
    assert [b["t"] for b in same.json()["blocks"]] == [2000.0 + 5 / 5, 2000.0 + 6 / 5]      # same process: it filters
    assert len(other.json()["blocks"]) == 6 and other.json()["started"] == RESTARTED       # another: the whole window
    assert len(unsaid.json()["blocks"]) == 2                                                # no claim: the cursor alone
    assert nothing.status_code == 200 and len(nothing.json()["blocks"]) == 6                # names no process: whole


def test_a_started_longer_than_the_hubs_is_400_bad_started_after_the_cursor_and_before_the_hub(tmp_path):
    with _client(tmp_path) as (client, hub):
        too_long = _get(client, started="x" * 41)
        assert too_long.status_code == 400 and too_long.json()["detail"] == {"reason": "bad_started"}
        assert _get(client, started="x" * 1000).status_code == 400
        assert _get(client, since="x", started="x" * 41).json()["detail"] == {"reason": "bad_since"}   # the cursor first
        assert _get(client, "192.0.2.99", started="x" * 41).json()["detail"] == {"reason": "no_device"}  # the monitor first
        assert hub.requests == []
        assert _get(client, started="x" * 40).status_code == 200                # the hub's own bound
    assert len(hub.requests) == 1


def test_only_the_allow_list_reaches_the_browser(tmp_path):
    extra = window([dict(block(1, 1000.0), secret="no"), block(2, 1000.0, 0x7777, 100)])
    extra["internal"] = "no"
    with _client(tmp_path, hub=Hub(payload=extra)) as (client, _):
        body = _get(client).json()
    assert "internal" not in body
    assert body["blocks"] == [{key: block(1, 1000.0)[key] for key in ("t", "recv", "id", "rate", "samples")}]


def test_nothing_is_written_and_no_log_line_carries_a_sample(tmp_path, caplog):
    audit = InMemoryAuditLog()
    caplog.set_level(logging.DEBUG)
    marked = Hub(payload=window([block(1, 1000.0, samples=[4321] * 40)]))
    with _client(tmp_path, hub=marked, audit=audit) as (client, _):
        before = len(audit.records(tenant=HOSPITAL))
        assert _get(client).json()["blocks"][0]["samples"] == [4321] * 40
        assert len(audit.records(tenant=HOSPITAL)) == before
    assert "4321" not in caplog.text


def test_no_credential_is_401_and_no_permission_is_403_before_the_hub_is_asked(tmp_path):
    with _client(tmp_path) as (client, hub):
        assert _get(client, token=None).status_code == 401
        assert _get(client, token="none-jwt").status_code == 403
    assert hub.requests == []


@pytest.mark.parametrize("token", ["nurse-jwt", "biomed-jwt", DEVICE_TOKEN])
def test_board_view_devices_manage_and_the_device_token_are_let_in(tmp_path, token):
    with _client(tmp_path) as (client, _):
        assert _get(client, token=token).status_code == 200


def test_a_monitor_the_callers_scope_does_not_reach_is_a_404_like_an_unknown_one(tmp_path):
    with _client(tmp_path) as (client, hub):
        assert _get(client, BED, "scoped-jwt").status_code == 200
        for device in (OTHER_UNIT, UNLISTED, "192.0.2.99"):
            response = _get(client, device, "scoped-jwt")
            assert response.status_code == 404 and response.json()["detail"] == {"reason": "no_device"}
        assert _get(client, "192.0.2.99", "biomed-jwt").status_code == 404
    assert [r.url.params["device"] for r in hub.requests] == [BED]


def test_an_unassigned_monitor_is_served_to_those_the_board_shows_it(tmp_path):
    with _client(tmp_path) as (client, _):
        assert _get(client, UNLISTED, "biomed-jwt").status_code == 200
        assert _get(client, UNLISTED, "nurse-jwt").status_code == 200       # unrestricted


def test_another_hospital_sees_the_strip_off(tmp_path):
    with _client(tmp_path) as (client, hub):
        response = _get(client, token="elsewhere-jwt")
    assert response.status_code == 409 and response.json()["detail"] == {"reason": "stage_off"}
    assert hub.requests == []


def test_waves_off_is_409_and_a_flag_that_cannot_run_is_503_with_its_reason(tmp_path):
    with _client(tmp_path, settings=WaveSettings()) as (client, hub):
        response = _get(client)
        assert response.status_code == 409 and response.json()["detail"] == {"reason": "waves_off"}
    with _client(tmp_path, settings=WaveSettings(problem="not_configured")) as (client, hub):
        response = _get(client)
        assert response.status_code == 503 and response.json()["detail"] == {"reason": "not_configured"}
    assert hub.requests == []


def test_the_strip_off_is_409_stage_off(tmp_path):
    with _client(tmp_path, stage=False) as (client, hub):
        response = _get(client)
    assert response.status_code == 409 and response.json()["detail"] == {"reason": "stage_off"}


def test_every_refusal_the_route_makes_names_a_reason_from_the_one_set(tmp_path):
    seen = set()
    with _client(tmp_path) as (client, _):
        seen.update(r.json()["detail"]["reason"]
                    for r in (_get(client, "192.0.2.99"), _get(client, since="x"), _get(client, started="x" * 41)))
    for kwargs in ({"settings": WaveSettings()}, {"settings": WaveSettings(problem="not_configured")},
                   {"settings": WaveSettings(problem="misconfigured")}, {"stage": False}):
        with _client(tmp_path, **kwargs) as (client, _):
            response = _get(client)
            assert response.status_code in (409, 503)
            seen.add(response.json()["detail"]["reason"])
    assert seen == {"no_device", "bad_since", "bad_started", "waves_off", "not_configured", "misconfigured",
                    "stage_off"}
    assert seen <= REASONS


def test_a_hub_failure_reaches_the_browser_as_its_named_status_never_a_500(tmp_path):
    with _client(tmp_path, hub=Hub(status=404)) as (client, _):
        response = _get(client)
    assert response.status_code == 503 and response.json()["detail"] == {"reason": "hub_no_waves"}


def test_the_hub_client_is_closed_when_the_app_stops(tmp_path):
    with _client(tmp_path) as (client, _):
        feed = client.app.state.wave_feed
        assert _get(client).status_code == 200
        http = feed._client
        assert http is not None and not http.is_closed
    assert http.is_closed and feed._client is None                   # the lifespan's teardown closed it


def test_the_app_reads_the_flag_from_its_environment_at_start(monkeypatch):
    monkeypatch.setenv("INFINITY_WAVES", "on")
    for name in ("INFINITY_HUB_URL", "INFINITY_VIEWER_TOKEN", "INFINITY_HUB_CA_FILE"):
        monkeypatch.delenv(name, raising=False)
    app = create_app({DEVICE_TOKEN: HOSPITAL}, run_escalation_loop=False)
    assert app.state.wave_feed.settings.problem == "not_configured"
    monkeypatch.delenv("INFINITY_WAVES")
    assert create_app({DEVICE_TOKEN: HOSPITAL}, run_escalation_loop=False).state.wave_feed.settings == WaveSettings()

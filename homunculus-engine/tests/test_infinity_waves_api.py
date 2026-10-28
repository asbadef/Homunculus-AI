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

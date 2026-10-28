"""Lane C (dalga): a monitor's live waveform blocks, for the people the strip already shows it to.

UNVALIDATED research decoding of the bedside monitor's waveform blocks (edge/infinity_waves.py,
docs/INFINITY-DALGA-FORMU.md; the dalga spec §3.2). Display only: nothing here derives a number
from a sample, and nothing is written — no database row, no audit row, no log line that carries a
sample (tests/test_infinity_waves_api.py).

The gates are the strip board's, by construction: the route asks `GET /infinity-shadow/board`'s
own handler for this caller's board and serves a monitor only if it is on a card that board shows
them. So `board.view` or `devices.manage`, the shadow hospital and the same scope lambdas hold
here exactly as there, and a monitor the caller may not see is a 404, like one that does not exist.

Off unless INFINITY_WAVES=on. The hub is the research window's (INFINITY_HUB_URL, https only;
INFINITY_VIEWER_TOKEN; INFINITY_HUB_CA_FILE). One keep-alive client for the life of the process,
and a CACHE_S answer per monitor with single-flight, so several viewers of one bed cost one hub
request: the API always asks the hub for the monitor's last ANSWER_S and serves each caller the
blocks after its own cursor. A monitor is named by its address, the strip card's `source`.
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import ssl
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field

import httpx

from homunculus.edge.infinity_waves import RATES, SCHEMA, WAVES

log = logging.getLogger(__name__)

CACHE_S = 0.25
TIMEOUT_S = 2.0
MAX_BODY = 1024 * 1024
MAX_TEXT = 40                         # an ISO instant, with room
BLOCK_KEYS = ("t", "recv", "id", "rate", "samples")
_UPSTREAM = {401: "hub_unauthorized", 404: "hub_no_waves", 409: "research_off"}
#: Every `reason` this module puts in a settings problem or an error body: one set, so the tests
#: (and the panel's words) read the same list. A new reason is added here or the scan test fails.
REASONS = frozenset({
    "not_configured", "misconfigured", "hub_no_waves", "research_off", "hub_unauthorized",
    "hub_error", "hub_timeout", "hub_unreachable", "hub_too_large", "hub_invalid"})


@dataclass(frozen=True)
class WaveSettings:
    on: bool = False
    url: str = ""
    token: str = field(default="", repr=False)
    ca_file: str = ""
    problem: str | None = None         # INFINITY_WAVES=on was asked for, and why it cannot run


def wave_settings_from_env(env: Mapping[str, str]) -> WaveSettings:
    """Off unless INFINITY_WAVES is "on"; then the research window's three hub settings, all set,
    the URL https. A problem leaves it off and names itself; it never stops the API."""
    if (env.get("INFINITY_WAVES", "") or "").strip().lower() != "on":
        return WaveSettings()
    url = (env.get("INFINITY_HUB_URL", "") or "").strip().rstrip("/")
    token = (env.get("INFINITY_VIEWER_TOKEN", "") or "").strip()
    ca_file = (env.get("INFINITY_HUB_CA_FILE", "") or "").strip()
    if not (url and token and ca_file):
        return WaveSettings(problem="not_configured")
    if not url.startswith("https://"):
        # The viewer credential rides in a header: never over plain HTTP (infinity_research.py).
        return WaveSettings(problem="misconfigured")
    try:
        httpx.URL(url)                 # a typo ("https://hub:abc") is named here, not raised per request
    except httpx.InvalidURL:
        return WaveSettings(problem="misconfigured")
    return WaveSettings(True, url, token, ca_file)


@dataclass(frozen=True)
class Outcome:
    status: int                        # 200, or the status the route answers with
    body: dict                         # the checked hub window (200), or {"reason": ...}


def _number(value) -> bool:
    # Not math.isfinite(value) on an int: it converts to float first, and a 400-digit integer
    # (json.loads accepts one) raises OverflowError. An int must be one a float holds exactly.
    return (type(value) is float and math.isfinite(value)) or (type(value) is int and -2**53 < value < 2**53)


def checked(raw, device: str) -> dict:
    """The hub's answer for one monitor, checked type by type; ValueError for anything else. Blocks
    of a wave the catalogue does not name are dropped: the screen has no row for them. `started` —
    the hub process's start — must be a non-empty string: an answer without it is invalid. The
    cursor is the answer's own; blocks come in device-time order, so none of them carries it."""
    if (not isinstance(raw, dict) or raw.get("schema") != SCHEMA or raw.get("device_id") != device
            or type(raw.get("cursor")) is not int or raw["cursor"] < 0
            or not isinstance(raw.get("hub_now"), str) or len(raw["hub_now"]) > MAX_TEXT
            or not isinstance(raw.get("started"), str) or not 0 < len(raw["started"]) <= MAX_TEXT
            or not isinstance(raw.get("blocks"), list)):
        raise ValueError("not a waves window")
    blocks = []
    for block in raw["blocks"]:
        if not isinstance(block, dict):
            raise ValueError("block")
        seq, t, recv, wave, rate, samples = (block.get(k) for k in ("seq", "t", "recv", "id", "rate", "samples"))
        if (type(seq) is not int or not 0 < seq <= raw["cursor"] or not _number(t)
                or not isinstance(recv, str) or len(recv) > MAX_TEXT or type(wave) is not int
                or type(rate) is not int or rate not in RATES):
            raise ValueError("block")
        if samples is not None and (not isinstance(samples, list) or len(samples) != rate // 5
                                    or any(type(s) is not int or not -32768 <= s <= 32767 for s in samples)):
            raise ValueError("samples")
        if wave in WAVES:
            blocks.append({"seq": seq, "t": float(t), "recv": recv, "id": wave, "rate": rate, "samples": samples})
    return {"cursor": raw["cursor"], "hub_now": raw["hub_now"], "started": raw["started"], "blocks": blocks}


def answer(device: str, window: dict, since: int, started: str | None = None) -> dict:
    """The browser's copy of a checked window: the blocks after its cursor — all of them for a
    cursor from before a hub restart — through the allow-list, and the catalogue; `started` goes
    through unchanged. A cursor ahead of the hub's is from before a restart; but a restarted hub
    may already have counted past the caller's cursor, so a caller that says which hub process its
    cursor came from (`started`) and names another is served the whole window."""
    if since > window["cursor"] or (started is not None and started != window["started"]):
        since = 0
    return {"schema": SCHEMA, "device_id": device, "cursor": window["cursor"], "hub_now": window["hub_now"],
            "started": window["started"],
            "blocks": [{key: block[key] for key in BLOCK_KEYS} for block in window["blocks"] if block["seq"] > since],
            "waves": {str(wave): dict(entry) for wave, entry in sorted(WAVES.items())}}


class HubWaves:
    """One keep-alive client to the hub for the life of the process (no redirects, no proxy, the
    research window's CA); a CACHE_S answer per monitor, single-flight, forgotten CACHE_S after it
    was fetched. Every hub request asks for the monitor's last seconds (since=0); `answer` serves
    each caller the blocks after its own cursor. It trusts its caller to ask `window()` only about
    a device on the caller's board (which bounds the cache's keys) and only when `settings.on`.
    `aclose()` ends the client: the app's lifespan teardown calls it (Starlette ignores
    add_event_handler("shutdown") when a lifespan is set)."""

    def __init__(self, settings: WaveSettings, *, transport: httpx.AsyncBaseTransport | None = None,
                 clock: Callable[[], float] = time.monotonic):
        self.settings = settings
        self._transport, self._clock = transport, clock
        self._client: httpx.AsyncClient | None = None
        self._cache: dict[str, tuple[float, int, Outcome]] = {}
        self._flights: dict[str, asyncio.Future] = {}
        self._made = 0
        self.requests = 0                 # hub requests made: the tests and the acceptance read it

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            common = {"timeout": httpx.Timeout(TIMEOUT_S), "follow_redirects": False, "trust_env": False}
            if self._transport is not None:
                self._client = httpx.AsyncClient(transport=self._transport, **common)
            else:
                context = ssl.create_default_context(cafile=self.settings.ca_file)
                # keepalive_expiry < uvicorn's timeout_keep_alive (5 s): the client drops an idle socket
                # before the hub does, so a request is never sent into a connection that is closing.
                self._client = httpx.AsyncClient(
                    verify=context, **common,
                    limits=httpx.Limits(max_connections=8, max_keepalive_connections=8, keepalive_expiry=4.0))
        return self._client

    async def aclose(self) -> None:
        client, self._client = self._client, None
        if client is not None:
            await client.aclose()

    async def window(self, device: str) -> Outcome:
        held = self._cache.get(device)
        if held is not None and 0 <= self._clock() - held[0] < CACHE_S:
            return held[2]
        flight = self._flights.get(device)
        if flight is None:
            flight = asyncio.ensure_future(self._load(device))
            self._flights[device] = flight
            flight.add_done_callback(lambda _done, key=device: self._flights.pop(key, None))
        return await asyncio.shield(flight)

    async def _load(self, device: str) -> Outcome:
        outcome = await self._fetch(device)
        self._made += 1
        made = self._made
        self._cache[device] = (self._clock(), made, outcome)
        asyncio.get_running_loop().call_later(CACHE_S, self._forget, device, made)
        return outcome

    def _forget(self, device: str, made: int) -> None:
        held = self._cache.get(device)
        if held is not None and held[1] == made:
            del self._cache[device]

    async def _fetch(self, device: str) -> Outcome:
        self.requests += 1
        try:
            client = self._http()
        except (OSError, ssl.SSLError, ValueError):
            return Outcome(503, {"reason": "misconfigured"})
        body = bytearray()
        try:
            async with asyncio.timeout(TIMEOUT_S):
                async with client.stream("GET", self.settings.url + "/infinity-research/waves",
                                         params={"device": device, "since": "0"},
                                         headers={"Authorization": "Bearer " + self.settings.token}) as response:
                    if response.status_code != 200:
                        reason = _UPSTREAM.get(response.status_code)
                        return Outcome(503, {"reason": reason} if reason else
                                       {"reason": "hub_error", "status": response.status_code})
                    async for chunk in response.aiter_bytes():
                        body.extend(chunk)
                        if len(body) > MAX_BODY:
                            return Outcome(502, {"reason": "hub_too_large"})
        except (TimeoutError, httpx.TimeoutException):
            return Outcome(503, {"reason": "hub_timeout"})
        except httpx.InvalidURL:                  # not an HTTPError; settings catch it first, this is the net
            return Outcome(503, {"reason": "misconfigured"})
        except httpx.HTTPError:
            return Outcome(503, {"reason": "hub_unreachable"})
        try:
            return Outcome(200, checked(json.loads(body), device))
        except (ValueError, TypeError, RecursionError, OverflowError):
            return Outcome(502, {"reason": "hub_invalid"})

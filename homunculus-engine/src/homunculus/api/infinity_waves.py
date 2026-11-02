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
INFINITY_VIEWER_TOKEN; INFINITY_HUB_CA_FILE). One keep-alive client for the life of the process.
A monitor is named by its address, the strip card's `source`.

The hub is polled INCREMENTALLY (dalga-perf, lead note L-10). `HubWaves` keeps a ring per watched
monitor — the last WINDOW_S of blocks with their hub `seq`, the hub's cursor and process (`started`)
of its last answer — and asks the hub only for what came after its own cursor, once per POLL_S
tick per monitor, single-flight: N viewers of one bed cost one hub request of ≈15 blocks per tick,
where the first release asked for the whole 10 s window (≈100 blocks) four times a second per
viewer and made the hub's packet handler four times slower on the ward (L-9). Every viewer is
served from the ring through `answer`, the blocks after its own cursor; the browser contract
(dashboard/src/live/data/waveStore.js) is unchanged. A monitor nobody asks about for IDLE_S is
forgotten: the API never polls a monitor no browser is watching. `stats()` says what the hub cost.
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import re
import ssl
import time
from bisect import insort
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timezone

import httpx
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from homunculus.edge.infinity_waves import ANSWER_S, MAX_HELD, RATES, SCHEMA, WAVES, WINDOW_S, iso_z

log = logging.getLogger(__name__)

POLL_S = 0.75                         # the browser's cadence (waveStore.js WAVE_POLL_MS): one hub fetch per monitor per tick
IDLE_S = 20.0                         # nobody asked about a monitor for this long: it is forgotten
DROP_FAILURES = 4                     # this many failed polls in a row, or ...
STALE_S = WINDOW_S                    # ... this long without a good answer: the ring is dropped, the failure served.
                                      # At the browser's cadence DROP_FAILURES decides (4 ticks, ≈3 s) and STALE_S is
                                      # never reached; it is the belt-and-braces bound for a caller that polls rarely
                                      # (5–20 s apart: still known under IDLE_S, yet DROP_FAILURES would take 4× as
                                      # long), so nothing is served stale past WINDOW_S whatever the cadence.
TIMEOUT_S = 2.0
MAX_BODY = 1024 * 1024
MAX_TEXT = 40                         # an ISO instant, with room
MAX_CURSOR = 10 ** 15                 # the hub's cursor stays below it: the route's SINCE takes 15 digits back
BLOCK_KEYS = ("t", "recv", "id", "rate", "samples")
_UPSTREAM = {401: "hub_unauthorized", 404: "hub_no_waves", 409: "research_off"}
#: Every `reason` this module puts in a settings problem or an error body: one set, so the tests
#: (and the panel's words) read the same list. A new reason is added here or the scan test fails.
#: The route's own (waves_off … bad_started) are written as literal `{"reason": "…"}` dicts, which
#: is what the scan reads; only a settings problem, whose values the scan reads at their source,
#: is passed through.
REASONS = frozenset({
    "not_configured", "misconfigured", "hub_no_waves", "research_off", "hub_unauthorized",
    "hub_error", "hub_timeout", "hub_unreachable", "hub_too_large", "hub_invalid",
    "waves_off", "stage_off", "no_device", "bad_since", "bad_started"})


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
            or type(raw.get("cursor")) is not int or not 0 <= raw["cursor"] < MAX_CURSOR
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


def _ms_behind(newest: float, t: float) -> int:
    """How far device time `t` lies behind `newest`, in whole milliseconds — the hub compares integer
    t_ms, and the difference of two floats can land a hair off (1024.4 - 10 > 1014.4); the browser
    store rounds the same way."""
    return round((newest - t) * 1000)


def _moved_on(hub_now: str, by_s: float) -> str:
    """`hub_now` moved on by `by_s` seconds: the hub's clock as this process estimates it while the
    hub is not answering, so the newest block's age keeps growing in the browser (waveStore.sampleOf)
    and the trace stalls on screen (spec §5.3) instead of the head being held where the hub's clock
    stopped. Unchanged when it cannot be read as an instant."""
    if by_s <= 0:
        return hub_now
    try:
        instant = datetime.fromisoformat(hub_now)
        if instant.tzinfo is None:
            instant = instant.replace(tzinfo=timezone.utc)
        return iso_z(instant.timestamp() + by_s)
    except (ValueError, OverflowError, OSError):
        return hub_now


@dataclass
class _Monitor:
    """One watched monitor: its ring and what the hub's last answer said. `entries` are
    (t, wave id, held-at on this process's clock, the checked block with its `seq`), in device-time
    order then wave id — the hub's order — one per (t, wave id). `started` is None until a good
    answer (or after a drop): the next poll asks the hub from 0 and replaces the ring."""
    entries: list[tuple[float, int, float, dict]] = field(default_factory=list)
    keys: set[tuple[float, int]] = field(default_factory=set)
    cursor: int = 0
    started: str | None = None
    hub_now: str = ""
    good_at: float = 0.0              # the clock at the last good answer
    fetched_at: float = -math.inf     # the clock at the last fetch's end, good or failed: the tick
    streak: int = 0                   # failed polls in a row
    error: Outcome | None = None      # the last failure
    window: dict | None = None        # what window() serves, built once per fetch; None: nothing held
    timer: asyncio.TimerHandle | None = None
    requests: int = 0
    blocks: int = 0
    resets: int = 0
    failures: int = 0


def _key(entry):
    return entry[0], entry[1]


class HubWaves:
    """One keep-alive client to the hub for the life of the process (no redirects, no proxy, the
    research window's CA), and a ring per watched monitor (`_Monitor`), polled incrementally.

    `window(device)` serves the monitor's ring as a checked window — the blocks at most ANSWER_S
    behind its newest, with their `seq`, under the hub's cursor and process — and asks the hub at
    most once per POLL_S tick per monitor, single-flight, for the blocks after the ring's own cursor.
    The first poll, and a poll after the hub's process (`started`) changed or its cursor went back,
    asks from 0 and REPLACES the ring: a restarted hub counts from 0 again and may have passed the
    old cursor, so what it answers after it may be partial. A block more than ANSWER_S older than
    the ring's newest means the monitor's clock went back (the hub's R5; the browser store's rule
    6): the ring is replaced by what arrived. The ring keeps WINDOW_S by device time behind its
    newest, nothing held longer than WINDOW_S on this clock (as the hub prunes by receipt), and at
    most MAX_HELD entries, the oldest dropped — a couple of MB per watched monitor at the worst.

    A failed poll keeps the ring and serves it, status 200, with `hub_now` moved on by the time
    since the hub last answered (the browser ages the newest block from it) and retries at the
    next tick; after DROP_FAILURES failures in a row or STALE_S without a good answer the ring is
    dropped and the failure is served, so a browser sees "unavailable" rather than a frozen window
    dressed as current (at the browser's cadence DROP_FAILURES decides, in ≈3 s; STALE_S is the
    belt-and-braces bound for a caller that polls rarely, 5–20 s apart, so nothing is served stale
    past WINDOW_S whatever the cadence). A monitor nobody asks about for IDLE_S is forgotten with
    its ring; nothing here polls on its own. Phase 2's wall can share one hub request across
    monitors (the hub's cursor is hub-wide) and fill the same rings.

    The rings are this process's memory, and Dockerfile.api runs ONE uvicorn worker (its CMD says
    why; this is one more reason): with several, a viewer's polls would land on different workers,
    each with its own ring and cursor, so the viewer's cursor would leapfrog another worker's ring
    and that worker would serve the whole 10 s window on every switch.

    It trusts its caller to ask `window()` only about a device on the caller's board (which bounds
    the rings' keys) and only when `settings.on`. `aclose()` ends the client: the app's lifespan
    teardown calls it (Starlette ignores add_event_handler("shutdown") when a lifespan is set)."""

    def __init__(self, settings: WaveSettings, *, transport: httpx.AsyncBaseTransport | None = None,
                 clock: Callable[[], float] = time.monotonic):
        self.settings = settings
        self._transport, self._clock = transport, clock
        self._client: httpx.AsyncClient | None = None
        self._monitors: dict[str, _Monitor] = {}
        self._flights: dict[str, asyncio.Future] = {}
        self.requests = 0                 # hub requests made: the tests and the acceptance read it
        self.blocks = 0                   # blocks the hub answered with, all monitors
        self.resets = 0                   # rings replaced: hub restarts and monitor clock set-backs
        self.drops = 0                    # rings dropped after the hub stopped answering
        self.failures = 0                 # hub requests that failed

    def stats(self) -> dict:
        """What the hub cost, for a log line or a check: totals and per watched monitor."""
        return {"monitors": len(self._monitors), "requests": self.requests, "blocks": self.blocks,
                "resets": self.resets, "drops": self.drops, "failures": self.failures,
                "per_monitor": {device: {"requests": m.requests, "blocks": m.blocks, "resets": m.resets,
                                         "failures": m.failures} for device, m in self._monitors.items()}}

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
        for monitor in self._monitors.values():
            if monitor.timer is not None:
                monitor.timer.cancel()
        self._monitors.clear()
        if client is not None:
            await client.aclose()

    async def window(self, device: str) -> Outcome:
        monitor = self._monitors.get(device)
        if monitor is None:
            monitor = self._monitors[device] = _Monitor()
        if monitor.timer is not None:
            monitor.timer.cancel()
        monitor.timer = asyncio.get_running_loop().call_later(IDLE_S, self._forget, device, monitor)
        if 0 <= self._clock() - monitor.fetched_at < POLL_S:
            return self._serve(monitor)
        flight = self._flights.get(device)
        if flight is None:
            flight = asyncio.ensure_future(self._load(device, monitor))
            self._flights[device] = flight
            flight.add_done_callback(lambda _done, key=device: self._flights.pop(key, None))
        return await asyncio.shield(flight)

    def _forget(self, device: str, monitor: _Monitor) -> None:
        if self._monitors.get(device) is monitor:
            del self._monitors[device]
            log.debug("dalga: %s unutuldu — %d hub isteği, %d blok, %d sıfırlama, %d hata",
                      device, monitor.requests, monitor.blocks, monitor.resets, monitor.failures)

    async def _load(self, device: str, monitor: _Monitor) -> Outcome:
        since = monitor.cursor if monitor.started is not None else 0
        outcome = await self._fetch(device, since, monitor)
        if (outcome.status == 200 and since
                and (outcome.body["started"] != monitor.started or outcome.body["cursor"] < monitor.cursor)):
            # Another hub process, or a cursor gone back: what it answered after our cursor may be
            # partial. Its whole window, now, replaces the ring.
            outcome = await self._fetch(device, 0, monitor)
            since = 0
        now = self._clock()
        monitor.fetched_at = now
        if outcome.status == 200:
            self._merge(monitor, outcome.body, now, replace=since == 0)
        else:
            monitor.streak += 1
            monitor.error = outcome
            if monitor.window is not None and (monitor.streak >= DROP_FAILURES or now - monitor.good_at >= STALE_S):
                log.warning("dalga: %s için hub %d kez üst üste yanıt vermedi (%.0f sn); tutulan pencere bırakıldı",
                            device, monitor.streak, now - monitor.good_at)
                monitor.entries.clear()
                monitor.keys.clear()
                monitor.window, monitor.started, monitor.cursor = None, None, 0
                self.drops += 1
        return self._serve(monitor)

    def _merge(self, monitor: _Monitor, body: dict, now: float, *, replace: bool) -> None:
        blocks = body["blocks"]
        newest = monitor.entries[-1][0] if monitor.entries else None
        if replace or (newest is not None and any(_ms_behind(newest, b["t"]) > ANSWER_S * 1000 for b in blocks)):
            if monitor.started is not None:
                monitor.resets += 1
                self.resets += 1
            monitor.entries.clear()
            monitor.keys.clear()
        for b in blocks:
            key = (b["t"], b["id"])
            if key not in monitor.keys:
                insort(monitor.entries, (b["t"], b["id"], now, b), key=_key)
                monitor.keys.add(key)
        if monitor.entries:
            newest, stale = monitor.entries[-1][0], now - WINDOW_S
            kept = [e for e in monitor.entries if _ms_behind(newest, e[0]) <= WINDOW_S * 1000 and e[2] >= stale]
            kept = kept[max(0, len(kept) - MAX_HELD):]
            if len(kept) != len(monitor.entries):
                monitor.entries = kept
                monitor.keys = {_key(e) for e in kept}
        monitor.cursor, monitor.started, monitor.hub_now = body["cursor"], body["started"], body["hub_now"]
        monitor.good_at, monitor.streak, monitor.error = now, 0, None
        newest = monitor.entries[-1][0] if monitor.entries else 0.0
        monitor.window = {"cursor": monitor.cursor, "hub_now": monitor.hub_now, "started": monitor.started,
                          "blocks": [e[3] for e in monitor.entries if _ms_behind(newest, e[0]) <= ANSWER_S * 1000]}

    def _serve(self, monitor: _Monitor) -> Outcome:
        if monitor.window is None:
            return monitor.error if monitor.error is not None else Outcome(503, {"reason": "hub_unreachable"})
        if monitor.streak:
            return Outcome(200, {**monitor.window,
                                 "hub_now": _moved_on(monitor.hub_now, self._clock() - monitor.good_at)})
        return Outcome(200, monitor.window)

    async def _fetch(self, device: str, since: int, monitor: _Monitor) -> Outcome:
        self.requests += 1
        monitor.requests += 1
        outcome = await self._request(device, since)
        if outcome.status == 200:
            self.blocks += len(outcome.body["blocks"])
            monitor.blocks += len(outcome.body["blocks"])
        else:
            self.failures += 1
            monitor.failures += 1
        return outcome

    async def _request(self, device: str, since: int) -> Outcome:
        try:
            client = self._http()
        except (OSError, ssl.SSLError, ValueError):
            return Outcome(503, {"reason": "misconfigured"})
        body = bytearray()
        try:
            async with asyncio.timeout(TIMEOUT_S):
                async with client.stream("GET", self.settings.url + "/infinity-research/waves",
                                         params={"device": device, "since": str(since)},
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


# --- the route ------------------------------------------------------------------------------------

SINCE = re.compile(r"[0-9]{1,15}")        # a cursor: digits only, and few enough for an int


def register(app: FastAPI, *, board: Callable[[str | None], Awaitable[dict]],
             settings: WaveSettings | None = None) -> HubWaves:
    """Add GET /infinity-waves/{device_id}. `board(authorization)` is the strip board's own handler:
    its 401 and 403 are this route's, and its cards are what this caller may see. The hub client
    is `app.state.wave_feed` (a test puts a fake hub there); the app's lifespan closes it."""
    settings = settings if settings is not None else wave_settings_from_env(os.environ)
    if settings.problem:
        # Names the problem, never a token or the URL.
        log.error("INFINITY_WAVES=on çalıştırılamıyor (%s); dalga formu kapalı", settings.problem)
    app.state.wave_feed = HubWaves(settings)

    @app.get("/infinity-waves/{device_id}")
    async def infinity_waves(device_id: str, request: Request, since: str = "0", started: str | None = None,
                             authorization: str | None = Header(default=None)):
        shown = await board(authorization)
        feed: HubWaves = request.app.state.wave_feed
        if not feed.settings.on:
            if feed.settings.problem:
                raise HTTPException(503, {"reason": feed.settings.problem})
            raise HTTPException(409, {"reason": "waves_off"})
        if shown.get("stage", "off") == "off" or "beds" not in shown:
            raise HTTPException(409, {"reason": "stage_off"})
        cards = (*shown.get("beds", ()), *shown.get("unassigned", ()))
        if not any(card.get("source") == device_id for card in cards):
            raise HTTPException(404, {"reason": "no_device"})
        if not SINCE.fullmatch(since):
            raise HTTPException(400, {"reason": "bad_since"})
        if started is not None and len(started) > MAX_TEXT:      # the hub's own bound on its `started`
            raise HTTPException(400, {"reason": "bad_started"})
        outcome = await feed.window(device_id)
        if outcome.status != 200:
            raise HTTPException(outcome.status, outcome.body)
        # A JSONResponse, not a bare dict: FastAPI's jsonable_encoder on a first full window measured
        # 7.2 ms against 0.75 ms (the hub's route does the same). The header goes on it, not on `response`.
        return JSONResponse(answer(device_id, outcome.body, int(since), started=started),
                            headers={"Cache-Control": "no-store"})

    return app.state.wave_feed

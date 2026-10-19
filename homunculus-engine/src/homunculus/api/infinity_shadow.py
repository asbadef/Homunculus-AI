"""Aşama A: the shadow lane. Unvalidated monitor values, shown to clinicians, fed to nothing.

The values are research decoding of bedside-monitor traffic (`edge/infinity_records.py`). They
are displayed in a strip labelled "doğrulanmamış" and are never an observation: nothing here
calls the engine, the audit, the board's broadcaster, the notification hub or the identity
store. `tests/test_infinity_shadow_isolation.py` holds this module to that, by its imports and
by spies; `tests/test_infinity_shadow_equivalence.py` proves that every clinical output is the
same with the stage on or off.

Configuration never stops the API: a clinical service that will not boot over an optional
display feature is the worse failure. A problem makes the stage `off`, says why, and the
device screen shows it.
"""
from __future__ import annotations

import logging
import math
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from homunculus.api.infinity_device_beds import PORT, multicast_ipv4, unicast_ipv4

log = logging.getLogger(__name__)

STAGES = ("off", "shadow", "rules", "alarms")   # the design's switch (§5)
IMPLEMENTED = ("off", "shadow")                 # this build: Stage A only
MIN_TOKEN = 32
DEFAULT_TABLE_PATH = "/etc/homunculus/infinity-shadow/device-beds.json"


@dataclass(frozen=True)
class ShadowSettings:
    stage: str = "off"                 # what runs: "off" or "shadow"
    configured: str = "off"            # what the environment asked for
    problem: str | None = None
    token: str = field(default="", repr=False)
    hospital: str = ""
    table_path: str = DEFAULT_TABLE_PATH

    @property
    def on(self) -> bool:
        return self.stage == "shadow"


def shadow_settings_from_env(env: Mapping[str, str], tenants: Mapping[str, str]) -> ShadowSettings:
    configured = (env.get("INFINITY_CLINICAL_STAGE", "") or "").strip().lower() or "off"
    table_path = (env.get("INFINITY_DEVICE_BEDS_PATH", "") or "").strip() or DEFAULT_TABLE_PATH
    token = (env.get("INFINITY_SHADOW_TOKEN", "") or "").strip()
    hospital = (env.get("INFINITY_SHADOW_HOSPITAL", "") or "").strip()
    viewer = (env.get("INFINITY_VIEWER_TOKEN", "") or "").strip()

    def off(problem: str | None) -> ShadowSettings:
        if problem:
            # Names the stage and the problem, never a token.
            log.error("INFINITY_CLINICAL_STAGE=%s çalıştırılamıyor (%s); aşama off olarak çalışıyor",
                      configured, problem)
        return ShadowSettings("off", configured, problem, table_path=table_path)

    if configured == "off":
        return off(None)
    if configured not in STAGES:
        return off("stage_unknown")
    if configured not in IMPLEMENTED:
        return off("stage_not_implemented")
    if not token:
        return off("token_missing")
    if len(token) < MIN_TOKEN:
        return off("token_weak")
    if token in tenants or (viewer and token == viewer):
        return off("token_reused")
    if not hospital or hospital not in set(tenants.values()):
        return off("hospital_missing")
    return ShadowSettings("shadow", configured, None, token, hospital, table_path)


# --- the wire format and the store ---------------------------------------------------------------

SCHEMA = "homunculus.infinity-shadow.v1"
# parameter -> (wire unit, integrity bounds). Integrity, NOT clinical: a value outside what the
# record can mean is a decoding fault, rejected and counted; 0 is inside every bound.
PARAMETERS = {
    "hr": ("bpm", 0, 350), "pls": ("bpm", 0, 350), "spo2": ("%", 0, 100),
    "etco2": ("mmHg", 0, 150), "temperature": ("C", 0, 50),
    "art_systolic": ("mmHg", 0, 400), "art_diastolic": ("mmHg", 0, 400), "art_mean": ("mmHg", 0, 400),
    "respiration": ("/min", 0, 200),
}
# Design §4.1 / docs/INFINITY-PARAMETER-RECORDS.md:36-50. NBP and airway RESP are absent on purpose:
# NBP's measurement time is not decoded, airway RESP is not verified. N is recorded for none.
EVIDENCE = {
    "hr": "screen_match_two_devices", "pls": "screen_match_two_devices",
    "spo2": "screen_match_two_devices", "etco2": "screen_match_two_devices",
    "art_systolic": "screen_match", "temperature": "screen_match_site_unknown",
    "art_mean": "structural", "art_diastolic": "structural_trend", "respiration": "range_overlap",
}
PARTIAL = frozenset({"temperature", "art_mean", "art_diastolic", "respiration"})
DEVICE_STATUSES = ("streaming", "no_parameters", "stale", "waiting", "unsupported")
# The hub's words, renamed for the board once, here: "no_parameters" is a monitor in standby,
# "stale" is a monitor that went quiet. "unknown" is added by the store: not reported for 15 s.
SHOWN_STATUS = {"streaming": "streaming", "no_parameters": "standby", "stale": "silent",
                "waiting": "waiting", "unsupported": "unsupported"}
MAX_DEVICES, MAX_READINGS, MAX_BODY = 100, 16, 64 * 1024
ARRIVAL_MAX_AGE_S, ARRIVAL_MAX_AHEAD_S = 10.0, 2.0
DISPLAY_MAX_AGE_S, FORGET_AFTER_S, SILENT_AFTER_S = 15.0, 120.0, 15.0
MIN_POST_SPACING_S = 1.0
LAG_BUCKETS_MS = (10, 50, 100, 250, 500, 1000, 3000)      # the 0a histogram's edges
REJECTIONS = ("too_old", "clock", "unit", "range", "unknown_parameter", "duplicate")
_LIMIT = 10**15
_TOP = frozenset({"schema", "sent_at", "forwarder", "hub", "devices"})
_FORWARDER = frozenset({"interval_s", "sent", "failed", "decoder"})
_HUB = frozenset({"collector_age_s", "accepted_packets", "old_or_duplicate_packets"})
_DEVICE = frozenset({"source", "group", "port", "status", "packet_age_ms", "readings"})
_READING = frozenset({"parameter", "value", "unit", "valid", "captured_at"})


class ShadowRejected(ValueError):
    """The body breaks the wire schema: it is refused whole (400) and nothing of it is kept."""


class TooSoon(Exception):
    """A POST within MIN_POST_SPACING_S of the previous one (429)."""


@dataclass(frozen=True)
class DeviceView:
    source: str
    group: str
    port: int
    status: str                  # streaming | standby | silent | waiting | unsupported | unknown
    status_age_s: float
    packet_age_ms: float | None
    parameters: tuple[dict, ...]  # in PARAMETERS order


@dataclass
class _Held:
    value: float | int | None
    valid: bool
    unit: str
    captured_at: float
    received_at: float


@dataclass
class _Device:
    group: str
    status: str
    status_at: float
    packet_age_ms: float | None
    readings: dict[str, _Held] = field(default_factory=dict)


def _number(value: Any) -> bool:
    return type(value) in (int, float) and math.isfinite(value)


def _count(value: Any) -> bool:
    return type(value) is int and 0 <= value <= _LIMIT


def _closed(obj: Any, keys: frozenset) -> dict:
    if not isinstance(obj, dict) or set(obj) != keys:
        raise ShadowRejected("keys")
    return obj


def _iso(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat()


def _validate(body: Any) -> None:
    """The whole schema, before anything is kept: one violation refuses the body."""
    _closed(body, _TOP)
    if body["schema"] != SCHEMA or not _number(body["sent_at"]):
        raise ShadowRejected("schema")
    forwarder = _closed(body["forwarder"], _FORWARDER)
    decoder = forwarder["decoder"]
    if not (_number(forwarder["interval_s"]) and 0 <= forwarder["interval_s"] <= 3600
            and _count(forwarder["sent"]) and _count(forwarder["failed"])
            and (decoder is None or (isinstance(decoder, str) and len(decoder) <= 64))):
        raise ShadowRejected("forwarder")
    hub = _closed(body["hub"], _HUB)
    age = hub["collector_age_s"]
    if not ((age is None or (_number(age) and 0 <= age <= 1e9))
            and _count(hub["accepted_packets"]) and _count(hub["old_or_duplicate_packets"])):
        raise ShadowRejected("hub")
    devices = body["devices"]
    if not isinstance(devices, list) or len(devices) > MAX_DEVICES:
        raise ShadowRejected("devices")
    sources = set()
    for device in devices:
        _closed(device, _DEVICE)
        source = unicast_ipv4(device["source"])
        if (source is None or source in sources or multicast_ipv4(device["group"]) is None
                or type(device["port"]) is not int or device["port"] != PORT
                or device["status"] not in DEVICE_STATUSES):
            raise ShadowRejected("device")
        sources.add(source)
        packet_age = device["packet_age_ms"]
        if packet_age is not None and not (_number(packet_age) and 0 <= packet_age <= 1e12):
            raise ShadowRejected("packet_age_ms")
        readings = device["readings"]
        if not isinstance(readings, list) or len(readings) > MAX_READINGS:
            raise ShadowRejected("readings")
        names = set()
        for reading in readings:
            _closed(reading, _READING)
            name, valid = reading["parameter"], reading["valid"]
            if not (isinstance(name, str) and len(name) <= 64 and name not in names
                    and isinstance(reading["unit"], str) and len(reading["unit"]) <= 16
                    and type(valid) is bool and _number(reading["captured_at"]) and reading["captured_at"] > 0):
                raise ShadowRejected("reading")
            # valid <=> a finite number; a device's "***" travels as valid false, value null.
            if (valid and not _number(reading["value"])) or (not valid and reading["value"] is not None):
                raise ShadowRejected("value")
            names.add(name)


class ShadowStore:
    """The lane's only memory: the latest value per parameter per monitor, bounded and forgetting.

    In memory only, gone on restart (it refills within one forwarder cycle). It writes nothing
    else, anywhere, and holds no reference to the engine, the audit, the broadcaster, the
    notification hub or the identity store. `clock` is the API's wall clock (epoch seconds)."""

    def __init__(self, clock: Callable[[], float] = time.time):
        self._clock = clock
        self._devices: dict[str, _Device] = {}
        self._last_attempt: float | None = None
        self._last_post: float | None = None
        self._posts = 0
        self._forwarder: dict | None = None
        self._hub: dict | None = None
        self._collector_age: float | None = None
        self._rejected = dict.fromkeys(REJECTIONS, 0)
        self._lag = [0] * (2 + len(LAG_BUCKETS_MS) + 1)        # count, total, buckets (0a layout)

    def ingest(self, body: Any) -> dict:
        """Keep a forwarder body. `TooSoon` within 1 s of the last; `ShadowRejected` for a schema
        violation (nothing kept). Returns what was accepted and why the rest was not."""
        now = self._clock()
        if self._last_attempt is not None and now - self._last_attempt < MIN_POST_SPACING_S:
            raise TooSoon()
        self._last_attempt = now
        _validate(body)
        self._expire(now)
        counts, accepted = dict.fromkeys(REJECTIONS, 0), 0
        for item in body["devices"]:
            source = unicast_ipv4(item["source"])
            held = self._devices.get(source)
            if held is None:
                held = self._devices[source] = _Device(item["group"], item["status"], now, None)
            held.group, held.status, held.status_at = item["group"], item["status"], now
            held.packet_age_ms = None if item["packet_age_ms"] is None else float(item["packet_age_ms"])
            for reading in item["readings"]:
                reason = self._judge(held, reading, now)
                if reason:
                    counts[reason] += 1
                    continue
                held.readings[reading["parameter"]] = _Held(reading["value"], reading["valid"], reading["unit"],
                                                            float(reading["captured_at"]), now)
                self._count_lag((now - reading["captured_at"]) * 1000)
                accepted += 1
        while len(self._devices) > MAX_DEVICES:              # the least recently reported goes
            del self._devices[min(self._devices, key=lambda s: self._devices[s].status_at)]
        self._last_post, self._posts = now, self._posts + 1
        self._forwarder = dict(body["forwarder"])
        self._hub = {"accepted_packets": body["hub"]["accepted_packets"],
                     "old_or_duplicate_packets": body["hub"]["old_or_duplicate_packets"]}
        age = body["hub"]["collector_age_s"]
        self._collector_age = None if age is None else float(age)
        for reason, n in counts.items():
            self._rejected[reason] = min(_LIMIT, self._rejected[reason] + n)
        return {"accepted": accepted, "rejected": counts}

    def devices(self, now: float | None = None) -> dict[str, DeviceView]:
        now = self._clock() if now is None else now
        self._expire(now)
        views = {}
        for source, held in self._devices.items():
            age = now - held.status_at
            status = "unknown" if age > SILENT_AFTER_S else SHOWN_STATUS[held.status]
            parameters = tuple(self._view(name, held.readings[name], now)
                               for name in PARAMETERS if name in held.readings)
            views[source] = DeviceView(source, held.group, PORT, status, round(max(0.0, age), 1),
                                       held.packet_age_ms, parameters)
        return views

    def feed(self, now: float | None = None) -> dict:
        now = self._clock() if now is None else now
        rejected, lag = dict(self._rejected), list(self._lag)
        if self._last_post is None:
            return {"state": "never", "last_post_at": None, "last_post_age_s": None,
                    "collector_age_s": None, "collector_connected": None, "posts": 0,
                    "forwarder": None, "hub": None, "rejected": rejected, "lag_ms": lag}
        post_age = max(0.0, now - self._last_post)
        collector = None if self._collector_age is None else self._collector_age + post_age
        connected = collector is not None and collector <= SILENT_AFTER_S
        if post_age > SILENT_AFTER_S:
            state = "forwarder_silent"
        elif not connected:
            state = "collector_disconnected"
        else:
            state = "ok"
        return {"state": state, "last_post_at": _iso(self._last_post), "last_post_age_s": round(post_age, 1),
                "collector_age_s": None if collector is None else round(collector, 1),
                "collector_connected": connected, "posts": self._posts,
                "forwarder": dict(self._forwarder), "hub": dict(self._hub),
                "rejected": rejected, "lag_ms": lag}

    @staticmethod
    def _judge(held: _Device, reading: dict, now: float) -> str | None:
        spec = PARAMETERS.get(reading["parameter"])
        if spec is None:
            return "unknown_parameter"
        unit, low, high = spec
        if reading["unit"] != unit:
            return "unit"
        if reading["valid"] and not low <= reading["value"] <= high:
            return "range"
        captured = reading["captured_at"]
        if captured - now > ARRIVAL_MAX_AHEAD_S:
            return "clock"
        if now - captured > ARRIVAL_MAX_AGE_S:
            return "too_old"
        previous = held.readings.get(reading["parameter"])
        if previous is not None and captured <= previous.captured_at:
            return "duplicate"
        return None

    @staticmethod
    def _view(name: str, held: _Held, now: float) -> dict:
        age = now - held.captured_at
        if age > DISPLAY_MAX_AGE_S:
            state, value = "old", None                       # the number is withheld
        elif held.valid:
            state, value = "value", held.value
        else:
            state, value = "invalid", None                   # the monitor shows ***
        return {"parameter": name, "state": state, "value": value, "unit": held.unit,
                "age_s": round(max(0.0, age), 1), "last_at": _iso(held.captured_at),
                "evidence": EVIDENCE[name], "partial": name in PARTIAL}

    def _expire(self, now: float) -> None:
        for held in self._devices.values():
            for name in [n for n, r in held.readings.items() if now - r.captured_at > FORGET_AFTER_S]:
                del held.readings[name]

    def _count_lag(self, amount_ms: float) -> None:
        amount = min(_LIMIT, max(0, int(round(amount_ms))))
        slot = next((i for i, edge in enumerate(LAG_BUCKETS_MS) if amount <= edge), len(LAG_BUCKETS_MS))
        self._lag[0] += 1
        self._lag[1] += amount
        self._lag[2 + slot] += 1

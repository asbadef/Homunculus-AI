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

from homunculus.api.infinity_device_beds import PORT, TableState, multicast_ipv4, unicast_ipv4
from homunculus.scope.rules import normalise_id

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

    def __post_init__(self) -> None:
        # compare_digest(b"", b"") is True: an "on" lane with an empty or short token would take a
        # POST carrying no credential. The env reader never builds one; nothing else may either.
        if self.stage == "shadow" and len(self.token) < MIN_TOKEN:
            raise ValueError("a shadow stage needs a token of at least 32 characters")

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

SCHEMA_V1 = "homunculus.infinity-shadow.v1"     # the R3 hub's: no NBP
SCHEMA = "homunculus.infinity-shadow.v2"        # v1, and NBP's three readings with `changed_at`
SCHEMAS = (SCHEMA_V1, SCHEMA)                   # a tuple: a fuzzed list or dict compares, never hashes
# parameter -> (wire unit, integrity bounds). Integrity, NOT clinical: a value outside what the
# record can mean is a decoding fault, rejected and counted; 0 is inside every bound.
PARAMETERS = {
    "hr": ("bpm", 0, 350), "pls": ("bpm", 0, 350), "spo2": ("%", 0, 100),
    "etco2": ("mmHg", 0, 150), "temperature": ("C", 0, 50),
    "art_systolic": ("mmHg", 0, 400), "art_diastolic": ("mmHg", 0, 400), "art_mean": ("mmHg", 0, 400),
    "respiration": ("/min", 0, 200),
    "nbp_systolic": ("mmHg", 0, 400), "nbp_diastolic": ("mmHg", 0, 400), "nbp_mean": ("mmHg", 0, 400),
}
# NBP: the monitor repeats its last NBP in every packet, so the packet's time says nothing about the
# cuff. The hub sends the time the triple last CHANGED (`changed_at`, an upper bound of the
# measurement); the board shows the three as ONE entry, `nbp`, and withholds it once that time is
# more than NBP_MAX_MEASURED_AGE_S old. A tuple, for the same reason as SCHEMAS.
NBP = "nbp"
NBP_PARTS = ("nbp_systolic", "nbp_diastolic", "nbp_mean")
NBP_MAX_MEASURED_AGE_S = 7200.0
# Design §4.1 / docs/INFINITY-PARAMETER-RECORDS.md:36-50, by the name the board shows. Airway RESP
# is absent on purpose (not verified). N is recorded for none.
EVIDENCE = {
    "hr": "screen_match_two_devices", "pls": "screen_match_two_devices",
    "spo2": "screen_match_two_devices", "etco2": "screen_match_two_devices",
    "art_systolic": "screen_match", "temperature": "screen_match_site_unknown",
    "art_mean": "structural", "art_diastolic": "structural_trend", "respiration": "range_overlap",
    "nbp": "screen_match",
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
_NBP_READING = _READING | {"changed_at"}            # v2, and only for NBP_PARTS


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
    parameters: tuple[dict, ...]  # in PARAMETERS order; NBP's three folded into `nbp`, last


@dataclass
class _Held:
    value: float | int | None
    valid: bool
    unit: str
    captured_at: float
    received_at: float
    changed_at: float | None = None      # NBP only: when its value last changed, as the hub saw it


@dataclass
class _Device:
    group: str
    status: str
    status_at: float
    packet_age_ms: float | None
    readings: dict[str, _Held] = field(default_factory=dict)


def _number(value: Any) -> bool:
    if type(value) not in (int, float):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:          # an int too large for a float (JSON `1` and 400 zeros): not a number here
        return False


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
    if body["schema"] not in SCHEMAS or not _number(body["sent_at"]):
        raise ShadowRejected("schema")
    v2 = body["schema"] == SCHEMA
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
            # v2: an NBP reading carries the time its value last changed, and nothing else does.
            nbp = v2 and isinstance(reading, dict) and reading.get("parameter") in NBP_PARTS
            _closed(reading, _NBP_READING if nbp else _READING)
            name, valid = reading["parameter"], reading["valid"]
            if not (isinstance(name, str) and len(name) <= 64 and name not in names
                    and isinstance(reading["unit"], str) and len(reading["unit"]) <= 16
                    and type(valid) is bool and _number(reading["captured_at"]) and reading["captured_at"] > 0):
                raise ShadowRejected("reading")
            # valid <=> a finite number; a device's "***" travels as valid false, value null.
            if (valid and not _number(reading["value"])) or (not valid and reading["value"] is not None):
                raise ShadowRejected("value")
            # A change is seen in a packet, so it is never after that packet; with `_judge`'s clock
            # rule on `captured_at` it is never more than 2 s ahead of the API either.
            if nbp and not (_number(reading["changed_at"]) and 0 < reading["changed_at"] <= reading["captured_at"]):
                raise ShadowRejected("changed_at")
            names.add(name)


class ShadowStore:
    """The lane's only memory: the latest value per parameter per monitor, bounded and forgetting.

    In memory only, gone on restart (it refills within one forwarder cycle). It writes nothing
    else, anywhere, and holds no reference to the engine, the audit, the broadcaster, the
    notification hub or the identity store.

    Two clocks. `clock` is the API's wall clock (epoch seconds), for what is measured against the
    hub's own timestamps: a reading's age, too old, too far ahead. `monotonic` is for what is the
    API's alone — the 1 s spacing, how long ago the last POST came, how long a device has gone
    unreported — so a wall clock stepped back (an NTP step, a VM restore) neither refuses every
    POST as "too soon" nor shows a value frozen before the step as 0 s old. A test that injects
    only the wall clock gets it for both."""

    def __init__(self, clock: Callable[[], float] = time.time, monotonic: Callable[[], float] | None = None):
        self._clock = clock
        self._monotonic = monotonic or (time.monotonic if clock is time.time else clock)
        self._devices: dict[str, _Device] = {}
        self._last_attempt: float | None = None
        self._last_post: float | None = None
        self._last_post_wall: float | None = None
        self._posts = 0
        self._forwarder: dict | None = None
        self._hub: dict | None = None
        self._collector_age: float | None = None
        self._rejected = dict.fromkeys(REJECTIONS, 0)
        self._lag = [0] * (2 + len(LAG_BUCKETS_MS) + 1)        # count, total, buckets (0a layout)
        self._nbp_lane = False                 # the last body was v2: the hub can send NBP at all

    def ingest(self, body: Any) -> dict:
        """Keep a forwarder body. `TooSoon` within 1 s of the last; `ShadowRejected` for a schema
        violation (nothing kept). Returns what was accepted and why the rest was not."""
        now, tick = self._clock(), self._monotonic()
        if self._last_attempt is not None and 0 <= tick - self._last_attempt < MIN_POST_SPACING_S:
            raise TooSoon()
        self._last_attempt = tick
        _validate(body)
        self._expire(now)
        counts, accepted = dict.fromkeys(REJECTIONS, 0), 0
        for item in body["devices"]:
            source = unicast_ipv4(item["source"])
            held = self._devices.get(source)
            if held is None:
                held = self._devices[source] = _Device(item["group"], item["status"], tick, None)
            held.group, held.status, held.status_at = item["group"], item["status"], tick
            held.packet_age_ms = None if item["packet_age_ms"] is None else float(item["packet_age_ms"])
            for reading in item["readings"]:
                reason = self._judge(held, reading, now)
                if reason:
                    counts[reason] += 1
                    continue
                changed = reading.get("changed_at")
                held.readings[reading["parameter"]] = _Held(reading["value"], reading["valid"], reading["unit"],
                                                            float(reading["captured_at"]), now,
                                                            None if changed is None else float(changed))
                self._count_lag((now - reading["captured_at"]) * 1000)
                accepted += 1
        while len(self._devices) > MAX_DEVICES:              # the least recently reported goes
            del self._devices[min(self._devices, key=lambda s: self._devices[s].status_at)]
        self._last_post, self._last_post_wall, self._posts = tick, now, self._posts + 1
        self._forwarder = dict(body["forwarder"])
        self._nbp_lane = body["schema"] == SCHEMA
        self._hub = {"accepted_packets": body["hub"]["accepted_packets"],
                     "old_or_duplicate_packets": body["hub"]["old_or_duplicate_packets"]}
        age = body["hub"]["collector_age_s"]
        self._collector_age = None if age is None else float(age)
        for reason, n in counts.items():
            self._rejected[reason] = min(_LIMIT, self._rejected[reason] + n)
        return {"accepted": accepted, "rejected": counts}

    def devices(self, now: float | None = None) -> dict[str, DeviceView]:
        """As of wall time `now` for the readings' ages; a device's own report age is monotonic."""
        now = self._clock() if now is None else now
        tick = self._monotonic()
        self._expire(now)
        views = {}
        for source, held in self._devices.items():
            age = tick - held.status_at
            status = "unknown" if not 0 <= age <= SILENT_AFTER_S else SHOWN_STATUS[held.status]
            parameters = tuple(self._view(name, held.readings[name], now)
                               for name in PARAMETERS if name in held.readings and name not in NBP_PARTS)
            # A device showing anything says what its NBP is doing — while the hub speaks v2, or
            # while NBP readings from before are still held. An R3 hub cannot send NBP: nothing is
            # said of it then, rather than "awaiting a measurement".
            if held.readings and (self._nbp_lane or any(name in held.readings for name in NBP_PARTS)):
                parameters += (self._nbp_view(held.readings, now),)
            views[source] = DeviceView(source, held.group, PORT, status, round(max(0.0, age), 1),
                                       held.packet_age_ms, parameters)
        return views

    def feed(self, now: float | None = None) -> dict:
        """The forwarder's state. Its ages are monotonic; `now` is accepted for symmetry."""
        rejected, lag = dict(self._rejected), list(self._lag)
        if self._last_post is None:
            return {"state": "never", "last_post_at": None, "last_post_age_s": None,
                    "collector_age_s": None, "collector_connected": None, "posts": 0,
                    "forwarder": None, "hub": None, "rejected": rejected, "lag_ms": lag}
        post_age = max(0.0, self._monotonic() - self._last_post)
        collector = None if self._collector_age is None else self._collector_age + post_age
        connected = collector is not None and collector <= SILENT_AFTER_S
        if post_age > SILENT_AFTER_S:
            state = "forwarder_silent"
        elif not connected:
            state = "collector_disconnected"
        else:
            state = "ok"
        return {"state": state, "last_post_at": _iso(self._last_post_wall), "last_post_age_s": round(post_age, 1),
                "collector_age_s": None if collector is None else round(collector, 1),
                "collector_connected": connected, "posts": self._posts,
                "forwarder": dict(self._forwarder), "hub": dict(self._hub),
                "rejected": rejected, "lag_ms": lag}

    @staticmethod
    def _judge(held: _Device, reading: dict, now: float) -> str | None:
        spec = PARAMETERS.get(reading["parameter"])
        # A v1 body never carried NBP's change time, so its NBP stays unknown, as v1 always had it.
        if spec is None or (reading["parameter"] in NBP_PARTS and "changed_at" not in reading):
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
        if age < 0 or age > DISPLAY_MAX_AGE_S:
            # Withheld: too old, or "from the future" — a wall clock stepped back, and a value whose
            # age cannot be known must not read as fresh.
            state, value = "old", None
        elif held.valid:
            state, value = "value", held.value
        else:
            state, value = "invalid", None                   # the monitor shows ***
        return {"parameter": name, "state": state, "value": value, "unit": held.unit,
                "age_s": round(max(0.0, age), 1), "last_at": _iso(held.captured_at),
                "evidence": EVIDENCE[name], "partial": name in PARTIAL}

    @staticmethod
    def _nbp_view(readings: Mapping[str, _Held], now: float) -> dict:
        """NBP's three held readings as ONE entry. A number only when all three are held, came with
        one change time, are fresh and valid, and that change is at most NBP_MAX_MEASURED_AGE_S old.
        `age_s`/`last_at` are the packet's while it is shown and the change's once it is withheld;
        with no complete triple of one change there is no time at all: "awaiting a measurement"."""
        entry = {"parameter": NBP, "state": "old", "systolic": None, "diastolic": None, "mean": None,
                 "unit": PARAMETERS[NBP_PARTS[0]][0], "age_s": None, "last_at": None, "changed_at": None,
                 "measured_age_s": None, "evidence": EVIDENCE[NBP], "partial": NBP in PARTIAL}
        parts = [readings.get(name) for name in NBP_PARTS]
        if any(part is None for part in parts) or len({part.changed_at for part in parts}) != 1:
            return entry
        changed = parts[0].changed_at
        captured = min(part.captured_at for part in parts)
        age, measured = now - captured, now - changed
        entry.update(changed_at=_iso(changed), measured_age_s=round(max(0.0, measured), 1))
        if not (0 <= age <= DISPLAY_MAX_AGE_S and 0 <= measured <= NBP_MAX_MEASURED_AGE_S):
            entry.update(age_s=round(max(0.0, measured), 1), last_at=_iso(changed))
        elif not all(part.valid for part in parts):
            entry.update(state="invalid", age_s=round(age, 1), last_at=_iso(captured))      # the monitor shows ***
        else:
            entry.update(state="value", systolic=parts[0].value, diastolic=parts[1].value, mean=parts[2].value,
                         age_s=round(age, 1), last_at=_iso(captured))
        return entry

    def _expire(self, now: float) -> None:
        """Forget what is too old, and what is further ahead than any arrival is allowed to be: after
        a wall clock steps back, the values held from before would otherwise never age out, and a
        newer reading would be refused as "not newer" than them."""
        for held in self._devices.values():
            for name in [n for n, r in held.readings.items()
                         if now - r.captured_at > FORGET_AFTER_S or r.captured_at - now > ARRIVAL_MAX_AHEAD_S]:
                del held.readings[name]

    def _count_lag(self, amount_ms: float) -> None:
        amount = min(_LIMIT, max(0, int(round(amount_ms))))
        slot = next((i for i, edge in enumerate(LAG_BUCKETS_MS) if amount <= edge), len(LAG_BUCKETS_MS))
        self._lag[0] += 1
        self._lag[1] += amount
        self._lag[2 + slot] += 1


# --- the board's answer --------------------------------------------------------------------------

COUNTED_STATUSES = ("streaming", "standby", "silent", "waiting", "unsupported", "unknown")


def _address_key(source: str) -> tuple[int, ...]:
    return tuple(int(part) for part in source.split("."))


def board_view(devices: Mapping[str, DeviceView], feed: dict, table: TableState, *,
               occupants: Mapping[str, list[str]] | None,
               visible: Callable[[dict], bool],
               patient_visible: Callable[[dict], bool],
               show_unassigned: bool, now: float) -> dict:
    """`GET /infinity-shadow/board`'s body. Pure: everything it needs is handed in.

    - A device sits on a bed only through the approved table's row valid now. A device the table
      leaves unassigned, does not list, or a table that is missing or invalid, gives an
      "atanmamış cihaz" card instead — shown only when `show_unassigned` (an unrestricted caller,
      or `devices.manage`).
    - `occupants` maps a normalised bed id to the ADMITTED patients the bed map puts there; None
      means the caller may not see patients (`link: "hidden"`). Exactly one gives `link: "one"`
      and its id; two or more `"ambiguous"` and no id; none, or a row without `bed_id`, `"none"`.
      A link the caller's scope does not reach (`patient_visible`) is reported as hidden.
    - `visible(card)` decides each bed card (scope). Counts cover only what is shown.
    Parameters are in PARAMETERS order with NBP's three as one `nbp` entry last, beds by label,
    unassigned devices by address."""
    beds: list[dict] = []
    unassigned: list[dict] = []
    # How many devices the table puts on each bed right now. parse_table refuses two at once; this
    # holds anyway, because two monitors linked to one patient is the one wrong-patient path here.
    rows_now = [table.table.at(source, now) for source in devices] if table.status == "ok" else []
    per_bed: dict[str, int] = {}
    for row in rows_now:
        if row is not None and row.assigned and row.bed_id and normalise_id(row.bed_id):
            per_bed[normalise_id(row.bed_id)] = per_bed.get(normalise_id(row.bed_id), 0) + 1
    for source in sorted(devices, key=_address_key):
        view = devices[source]
        base = {"source": source, "group": view.group, "status": view.status,
                "status_age_s": view.status_age_s, "packet_age_ms": view.packet_age_ms,
                "parameters": [dict(p) for p in view.parameters]}
        row = table.table.at(source, now) if table.status == "ok" else None
        if table.status != "ok":
            reason = f"table_{table.status}"
        elif row is None:
            reason = "not_in_table"
        elif not row.assigned:
            reason = "table_unassigned"
        else:
            reason = None
        if reason is not None:
            if show_unassigned:
                unassigned.append({**base, "reason": reason, "note": row.note if row is not None else None})
            continue
        card = {"bed_label": row.bed_label, "bed_id": row.bed_id, "unit_id": row.unit_id,
                "method": row.method, "verified_at": row.verified_at, **base,
                "link": "none", "patient_id": None, "link_reason": None}
        if occupants is None:
            card["link"] = "hidden"
        elif row.bed_id and per_bed.get(normalise_id(row.bed_id), 0) > 1:
            card["link"], card["link_reason"] = "ambiguous", "two_monitors"
        elif row.bed_id:
            present = occupants.get(normalise_id(row.bed_id), [])
            if len(present) == 1:
                card["link"], card["patient_id"] = "one", present[0]
                if not patient_visible(card):
                    card["link"], card["patient_id"] = "hidden", None
            elif len(present) > 1:
                card["link"], card["link_reason"] = "ambiguous", "two_patients"
        if visible(card):
            beds.append(card)
    beds.sort(key=lambda c: (c["bed_label"].casefold(), _address_key(c["source"])))
    shown = beds + unassigned
    counts = {"total": len(shown), **{s: sum(1 for c in shown if c["status"] == s) for s in COUNTED_STATUSES}}
    approved_at = table.table.approved_at if table.status == "ok" else None
    site = table.table.site if table.status == "ok" else None
    return {"stage": "shadow", "display_max_age_s": DISPLAY_MAX_AGE_S, "generated_at": _iso(now),
            "table": {"status": table.status, "reason": table.reason, "version": table.version,
                      "sha256": table.sha256, "approved_at": approved_at, "site": site},
            "feed": {**feed, "devices": counts, "unassigned": len(unassigned)},
            "beds": beds, "unassigned": unassigned}

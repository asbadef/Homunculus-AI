"""Aşama B: the bridge from the monitor strip to the SHADOW engine (spec 2026-10-27, D1–D5).

What this module is: the only code that turns a monitor cell into an `Observation`, and the only
code that feeds the shadow engine. What it is not: a path to the real engine. It imports the
engine's classes to drive a second instance of them; it never imports the notifier, the ack
store, the alert lifecycle or the alarm-quality counters (tests/test_infinity_shadow_isolation.py
holds it to that), and the real engine is handed to it read-only, for copying.
"""
from __future__ import annotations

import logging
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timezone

from homunculus.api.infinity_shadow import DeviceView, PARAMETERS
from homunculus.canonical import Observation, SignalCode

log = logging.getLogger(__name__)

SAMPLE_INTERVAL_S = 60.0            # D4: one sample per (patient, code) per minute
NBP_MAX_FOR_RULES_S = 3600.0        # D3: an NBP measured more than an hour ago feeds nothing
REPLAY_HOURS = 24                   # D9: what the shadow engine is rebuilt from at start-up
DEFAULT_PARAMETERS = ("hr", "pls", "spo2", "art_systolic", "art_mean", "nbp")   # D2 (S1)
SOURCE_PREFIX = "infinity:"
# Engine code -> the monitor cells that may feed it, in priority order (D3): the first cell that
# is a value wins; the rest are ignored for that sample. Names not here (respiration,
# temperature, art_diastolic, etco2) never feed, whatever the allowlist says.
FEEDS: dict[SignalCode, tuple[str, ...]] = {
    SignalCode.HEART_RATE: ("hr", "pls"),
    SignalCode.SPO2: ("spo2",),
    SignalCode.SBP: ("art_systolic", "nbp"),
    SignalCode.MAP: ("art_mean", "nbp"),
}
# The unit the engine's rules read for each code (rules/news2.py, rules/septic_shock.py read the
# raw number; the unit travels for the audit and the card). A wire unit that is not this one
# feeds nothing: the lane never converts.
ENGINE_UNIT: dict[SignalCode, str] = {
    SignalCode.HEART_RATE: "bpm", SignalCode.SPO2: "%", SignalCode.SBP: "mmHg", SignalCode.MAP: "mmHg",
}
_NBP_FIELD = {SignalCode.SBP: "systolic", SignalCode.MAP: "mean"}
_VIA = {"hr": "hr", "pls": "pls", "spo2": "spo2", "art_systolic": "art", "art_mean": "art", "nbp": "nbp"}
# Every name the allowlist may hold: the strip's parameters, NBP as one name.
ALLOWED_NAMES = frozenset(set(PARAMETERS) - {"nbp_systolic", "nbp_diastolic", "nbp_mean"}) | {"nbp"}


@dataclass(frozen=True)
class RulesSettings:
    allowed: tuple[str, ...] = DEFAULT_PARAMETERS


def rules_from_env(env: Mapping[str, str]) -> RulesSettings:
    """`INFINITY_RULES_PARAMETERS`: comma-separated strip parameter names; empty is the default
    list. A name that is not a strip parameter is `ValueError("parameters_unknown")` — the caller
    turns the stage off with that problem code rather than guessing."""
    raw = (env.get("INFINITY_RULES_PARAMETERS", "") or "").strip()
    if not raw:
        return RulesSettings()
    names = tuple(dict.fromkeys(n.strip().lower() for n in raw.split(",") if n.strip()))
    if any(n not in ALLOWED_NAMES for n in names):
        raise ValueError("parameters_unknown")
    return RulesSettings(names)


@dataclass(frozen=True)
class Candidate:
    """One monitor cell that may feed one engine code now."""
    code: SignalCode
    value: float
    unit: str
    stamp: float            # epoch seconds: the cell's `last_at`, or NBP's `changed_at`
    source: str             # the device's address
    via: str                # hr | pls | spo2 | art | nbp — what the card shows

    @property
    def source_device(self) -> str:
        return f"{SOURCE_PREFIX}{self.source}:{self.via}"

    def observation(self, patient_id: str) -> Observation:
        return Observation(patient_id, self.code, float(self.value), self.unit,
                           datetime.fromtimestamp(self.stamp, timezone.utc), self.source_device)


def _epoch(iso: str | None) -> float | None:
    if not iso:
        return None
    return datetime.fromisoformat(iso).timestamp()


def pick(view: DeviceView, allowed: tuple[str, ...], *, now: float) -> list[Candidate]:
    """The candidates one device offers now, one per engine code at most (D3). Pure.

    `now` is accepted for signature stability (the sampler passes its clock); this pure step
    judges age from the cells' own `measured_age_s`, so it does not read it yet."""
    cells = {p["parameter"]: p for p in view.parameters}
    out: list[Candidate] = []
    for code, names in FEEDS.items():
        for name in names:
            cell = cells.get(name)
            if name not in allowed or cell is None or cell.get("state") != "value":
                continue
            if name == "nbp":
                measured = cell.get("measured_age_s")
                changed = _epoch(cell.get("changed_at"))
                if measured is None or changed is None or measured > NBP_MAX_FOR_RULES_S:
                    continue
                value, stamp = cell.get(_NBP_FIELD[code]), changed
            else:
                value, stamp = cell.get("value"), _epoch(cell.get("last_at"))
            if value is None or stamp is None or cell.get("unit") != ENGINE_UNIT[code]:
                continue
            out.append(Candidate(code, float(value), cell["unit"], stamp, view.source, _VIA[name]))
            break           # the first value in priority order feeds; the others are ignored
    return out

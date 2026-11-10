"""Sıvı dengesi (G3-03): the patient's intake/output ledger, summed by the server (spec D6, D7).

Every volume is a `chart` row G3-01's door wrote (`api/clinical.py` FLUID_CODES); a `chart_retract` row withdraws
one. This module reads the last 48 h of those rows for one patient — as `api/trends.py` `_manual` reads the hand
entries, with its rules for a row it cannot read — and computes the fluid day (from Görevlerim's first shift start,
in the tenant's zone), the shift subtotals, the hourly ledger, the last complete day, the urine rate. No rule reads
any of it; the only sourced numbers are the SOFA renal bands of Sepsis-3 (sepsis-3-jama-2016), returned as static
reference text — no points are computed (spec D8, D9)."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from homunculus.api.audit import AuditLog
from homunculus.api.clinical import BEDSIDE_SKEW, RETRACT
from homunculus.api.trends import _finite_number, _instant

INTAKE: tuple[str, ...] = ("iv_fluid_ml", "crystalloid_bolus_ml", "enteral_ml", "blood_product_ml", "other_intake_ml")
OUTPUT: tuple[str, ...] = ("urine_output_ml", "drain_output_ml", "other_output_ml")
URINE = "urine_output_ml"
#: One bounded read of the patient's `chart` and `chart_retract` rows, the newest kept (as trends `_manual`).
READ_LIMIT = 5000
#: Sepsis-3 (sepsis-3-jama-2016), the SOFA renal row's urine bands — reference text beside the last complete day's
#: urine total. The system awards no points (spec D8).
SOFA_RENAL_REFERENCE = {"source": "sepsis-3-jama-2016",
                        "bands": [{"below_ml_day": 500, "points": 3}, {"below_ml_day": 200, "points": 4}]}
HOUR = timedelta(hours=1)


@dataclass(frozen=True)
class FluidEntry:
    entry: int                     # the `chart` row's id — the one a «hatalı giriş» names
    code: str
    value: float
    at: datetime                   # the measurement time the door recorded (`obs_ts`)
    by: str
    retracted: dict | None = None  # {"reason", "by", "at"} once withdrawn


def _iso(at: datetime | None) -> str | None:
    return None if at is None else at.astimezone(timezone.utc).isoformat()


def read_entries(audit: AuditLog, hospital: str, patient_id: str, *, since: datetime,
                 until: datetime) -> list[FluidEntry]:
    """The patient's fluid entries measured in [since, until], oldest first, each with its withdrawal. The read
    starts `BEDSIDE_SKEW` before `since` (a row is written at or after the time it records, but the door lets a
    time run that far ahead of its write). A row the trail cannot read — not a finite number, a time with no zone —
    is left out, never counted as 0."""
    rows = audit.records(tenant=hospital, patient_id=patient_id, event_types={"chart", RETRACT},
                         since=since - BEDSIDE_SKEW, limit=READ_LIMIT, newest=True)
    withdrawn: dict[int, dict] = {}
    for rec in rows:
        entry = rec.payload.get("entry")
        if rec.event_type == RETRACT and isinstance(entry, int) and not isinstance(entry, bool):
            withdrawn[entry] = {"reason": str(rec.payload.get("reason") or ""),
                                "by": str(rec.payload.get("retracted_by") or ""), "at": _iso(_instant(rec.ts))}
    out = []
    for rec in rows:
        if rec.event_type != "chart" or rec.subject not in INTAKE + OUTPUT:
            continue
        at, value = _instant(rec.payload.get("obs_ts")), rec.payload.get("value")
        if at is None or not _finite_number(value) or not since <= at <= until:
            continue
        out.append(FluidEntry(rec.id, rec.subject, float(value), at, str(rec.payload.get("charted_by") or ""),
                              withdrawn.get(rec.id)))
    return sorted(out, key=lambda e: (e.at, e.entry))


def fluid_day(now: datetime, zone, start_a: int, start_b: int) -> dict:
    """The fluid day that holds `now` (spec D5): 24 h from the latest `start_a` o'clock at or before `now` in the
    tenant's zone — a boundary instant begins the new day — with its two shifts [start_a, start_b) and
    [start_b, next start_a), and the last complete day before it. The windows are UTC instants, so a day is 24
    hours and an hour is an hour whatever the zone's clock does."""
    local = now.astimezone(zone)
    today = datetime(local.year, local.month, local.day, start_a, 0, tzinfo=zone)
    start = (today if today <= local else today - timedelta(days=1)).astimezone(timezone.utc)
    split = start + timedelta(hours=(start_b - start_a) % 24)
    end = start + 24 * HOUR
    return {"day": (start, end), "last_day": (start - 24 * HOUR, start),
            "shift_a": (start, split), "shift_b": (split, end)}


def totals(entries: list[FluidEntry], since: datetime, until: datetime) -> dict:
    """Intake, output and balance of the entries measured in [since, until), withdrawn ones in no sum; `by_code`
    names only the codes charted in the window."""
    by_code: dict[str, float] = {}
    for e in entries:
        if e.retracted is None and since <= e.at < until:
            by_code[e.code] = by_code.get(e.code, 0.0) + e.value
    tin = sum(v for k, v in by_code.items() if k in INTAKE)
    tout = sum(v for k, v in by_code.items() if k in OUTPUT)
    return {"in": tin, "out": tout, "balance": tin - tout, "by_code": by_code}


def hourly(entries: list[FluidEntry], start: datetime) -> list[dict]:
    """The day's 24 rows from `start`: intake and output by code, and the balance accumulated through the row."""
    rows, cum = [], 0.0
    for h in range(24):
        a, b = start + h * HOUR, start + (h + 1) * HOUR
        t = totals(entries, a, b)
        cum += t["balance"]
        rows.append({"start": _iso(a), "in": {k: v for k, v in t["by_code"].items() if k in INTAKE},
                     "out": {k: v for k, v in t["by_code"].items() if k in OUTPUT}, "balance_cum": cum})
    return rows


def hours_with(entries: list[FluidEntry], code: str, since: datetime) -> int:
    """How many of the 24 hours from `since` carry a non-withdrawn entry of `code` (spec D8: an incomplete chart
    understates the total, so the screen says how much of the day is charted)."""
    return len({int((e.at - since) // HOUR) for e in entries
                if e.code == code and e.retracted is None and since <= e.at < since + 24 * HOUR})


def urine_rate(entries: list[FluidEntry], weight_kg: float | None, now: datetime) -> float | None:
    """mL/kg/h over (now − 6 h, now], rounded to 2 — None without a weight or without a urine entry in the window.
    A number with its window, never judged (spec D9: the vault holds no oliguria threshold)."""
    if not weight_kg:
        return None
    window = [e.value for e in entries if e.code == URINE and e.retracted is None and now - 6 * HOUR < e.at <= now]
    return round(sum(window) / 6 / weight_kg, 2) if window else None


def patient_fluids(audit: AuditLog, *, hospital: str, patient_id: str, now: datetime, zone, start_a: int,
                   start_b: int, weight_kg: float | None) -> dict:
    """The answer of `GET /patients/{id}/fluids` (spec §3)."""
    w = fluid_day(now, zone, start_a, start_b)
    entries = read_entries(audit, hospital, patient_id, since=w["last_day"][0], until=now + BEDSIDE_SKEW)
    day_start, last = w["day"][0], w["last_day"]
    last_totals = totals(entries, *last)
    return {
        "patient_id": patient_id, "now": _iso(now),
        "day": {"start": _iso(w["day"][0]), "end": _iso(w["day"][1])},
        "last_day": {"start": _iso(last[0]), "end": _iso(last[1])},
        "shifts": [{"start": _iso(w["shift_a"][0]), "end": _iso(w["shift_a"][1])},
                   {"start": _iso(w["shift_b"][0]), "end": _iso(w["shift_b"][1])}],
        "codes": {"intake": list(INTAKE), "output": list(OUTPUT)},
        "hours": hourly(entries, day_start),
        "totals": {"today": totals(entries, day_start, now + BEDSIDE_SKEW),
                   "shift_a": totals(entries, *w["shift_a"]), "shift_b": totals(entries, *w["shift_b"]),
                   "last_day": last_totals},
        "urine_last_day_ml": last_totals["by_code"].get(URINE, 0.0),
        "hours_with_urine_last_day": hours_with(entries, URINE, last[0]),
        "weight_kg": weight_kg, "urine_ml_kg_h_last_6h": urine_rate(entries, weight_kg, now),
        "sofa_renal_reference": SOFA_RENAL_REFERENCE,
        "entries": [{"entry": e.entry, "code": e.code, "value": e.value, "at": _iso(e.at), "by": e.by,
                     "retracted": e.retracted} for e in sorted(entries, key=lambda e: (e.at, e.entry), reverse=True)],
    }

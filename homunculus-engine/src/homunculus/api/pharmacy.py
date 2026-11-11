# homunculus-engine/src/homunculus/api/pharmacy.py
"""Eczane (G3-04): the pharmacist's ward page, built by the server from what the system already holds (spec D1, D4).

Pure builders, no route. A row is one scoped board card: its `identity` (bed, name) and its `meds` block
(`api/board.py` `_meds`: the vasopressor rates and when each was charted, the three-valued antibiotic record, the
antibiotic clock, creatinine and its time), with the current fluid day's intake − output from the fluid ledger
(`api/fluids.py`). The antibiotic state, the row order, the counters and the fluid totals are decided here: the
browser sums, sorts and judges nothing (G2-A3 Decision 1).

The one sourced number is the engine's own 1-hour antibiotic window (`rules/antibiotic_clock.py` WINDOW;
surviving-sepsis-campaign-2026 — a strong recommendation on very low certainty evidence), and the clock itself is
`_meds`': this module adds no window, no threshold and no judgement. Creatinine and the fluid balance are a number
and its time; the vault holds no renal-dosing threshold and no fluid-balance target. «Kayıt yok» is never
«verilmedi»: `antibiotic_given` travels three-valued, and a recognised patient with no counted administration is
worded by the clock (spec D8). Homunculus does not diagnose, order or advise a dose.

It reads the cards' `identity` and `meds` only and holds no reference to the engine."""
from __future__ import annotations

import re
import unicodedata
from datetime import datetime, timezone

from homunculus.api.audit import AuditLog
from homunculus.api.clinical import BEDSIDE_SKEW
from homunculus.api.fluids import FluidEntry, fluid_day, read_entries_by_patient, totals
from homunculus.rules.antibiotic_clock import WINDOW as ANTIBIOTIC_WINDOW

#: The vault's source note for the window, as `rules/antibiotic_clock.py` cites it. The page names it with both
#: halves — strong recommendation, very low certainty of evidence (spec D9).
ANTIBIOTIC_WINDOW_SOURCE = "surviving-sepsis-campaign-2026"
#: The two states whose clock is still unanswered: they lead the page and carry `remaining_sec` (spec D10, §3.1).
CLOCK_OPEN = ("running", "missed")
_DIGITS = re.compile(r"(\d+)")
_NO_DECOMPOSITION = str.maketrans({"ı": "i", "ə": "e"})


def _iso(at: datetime | None) -> str | None:
    return None if at is None else at.astimezone(timezone.utc).isoformat()


def _number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def antibiotic_of(meds: dict | None) -> dict:
    """The antibiotic state of one card, in `_meds`' own fields (spec §3.1). With C the clock, A the counted
    administration's time and G the three-valued record: C and no A is `running` while `remaining_sec > 0` — the
    rule's own boundary (`antibiotic_clock.evaluate`) — and `missed` from 0 down; C and A is `met` or `late` by the
    engine's `met`; A without C is `given`; neither is `none`, whether G is null (nobody charted) or false (a 0, or a
    dose stamped before recognition). `given` carries G unchanged, so a reader can still tell the two. No state says
    «verilmedi». A card without `meds` (never measured) is `none`."""
    meds = meds or {}
    clock = meds.get("antibiotic_clock") or None
    given_at = meds.get("antibiotic_at")
    if clock is not None and given_at is None:
        state = "running" if clock["remaining_sec"] > 0 else "missed"
    elif clock is not None:
        state = "met" if clock.get("met") is True else "late"
    else:
        state = "given" if given_at is not None else "none"
    return {"state": state, "given": meds.get("antibiotic_given"), "given_at": given_at,
            "recognized_at": None if clock is None else clock.get("recognized_at"),
            "deadline": None if clock is None else clock.get("deadline"),
            "remaining_sec": clock["remaining_sec"] if state in CLOCK_OPEN else None}


def pressors_of(meds: dict | None) -> list[dict]:
    """Every drug with a charted rate, in the card's own order (`api/board.py` `_PRESSORS`'), with the rate and when
    it was charted (spec D6). A 0 is listed — the screen says «durduruldu» — and a drug never charted is absent."""
    meds = meds or {}
    charted_at = meds.get("pressors_at") or {}
    return [{"drug": drug, "rate": rate, "at": charted_at.get(drug)}
            for drug, rate in (meds.get("pressors") or {}).items() if _number(rate)]


def fluid_of(entries: list[FluidEntry], day: tuple[datetime, datetime]) -> dict | None:
    """The fluid day's intake, output and balance of one patient (`fluids.totals` over [start, end)), the number of
    entries and the newest one's measurement time. None when the patient has no entry in the day that was not
    withdrawn: an uncharted day is not a balance of 0 (spec D13)."""
    start, end = day
    live = [e for e in entries if e.retracted is None and start <= e.at < end]
    if not live:
        return None
    summed = totals(live, start, end)
    return {"in_ml": summed["in"], "out_ml": summed["out"], "balance_ml": summed["balance"],
            "entries": len(live), "last_at": _iso(max(e.at for e in live))}


def row_of(card: dict, fluid: dict | None) -> dict:
    """One row of the page from one board card (spec D5, §3). `measured` is false for an identity-only card (an
    admitted patient the engine never measured: no `meds` block), whose row is all «Kayıt yok». A card the bed table
    places on no unit has `unit_id` None, and one with no identity an empty label and name."""
    identity = card.get("identity") or {}
    meds = card.get("meds") or None
    creatinine = None if meds is None else meds.get("creatinine")
    return {
        "patient_id": card["patient_id"],
        "bed_label": identity.get("bed_label") or "",
        "bed_id": identity.get("bed_id") or None,
        "unit_id": identity.get("unit_id") or None,
        "display_name": identity.get("display_name") or "",
        "measured": meds is not None,
        "on_pressor": bool(meds and meds.get("on_pressor")),
        "pressors": pressors_of(meds),
        "antibiotic": antibiotic_of(meds),
        "creatinine": None if creatinine is None else {"value": creatinine, "at": meds.get("creatinine_at")},
        "fluid": fluid,
    }


def _base(text: str) -> str:
    """Letters as the board's collator compares them at `sensitivity: "base"`: no diacritic and no case — «Ç» with
    «C», «Ö» with «O». The combining marks are dropped from the canonical decomposition, then the case is folded.
    «ı» and «ə» have no decomposition and would stay after «z»; the collator puts them beside i and e, so they are
    folded by hand (Turkish and Azerbaijani bed labels)."""
    folded = "".join(c for c in unicodedata.normalize("NFD", text) if not unicodedata.combining(c)).casefold()
    return folded.translate(_NO_DECOMPOSITION)


def _natural(label: str) -> tuple:
    """A bed label as the board orders it (`screens/beds/order.js` `byBed`,
    `localeCompare("en", {numeric: true, sensitivity: "base"})`): digit runs compared as numbers, the rest without
    diacritics and case-folded — «YBU 1-2» before «YBU 1-10», «ÇYB 2» before «YBU 1-1»."""
    return tuple((0, int(part), "") if part.isdecimal() else (1, 0, _base(part))
                 for part in _DIGITS.split(label) if part)


def sort_key(row: dict) -> tuple:
    """The page's order (spec D10, §3.2): the open clocks first, least `remaining_sec` first — the longest passed,
    then the least time left; then the other rows on a vasopressor; then the rest. Inside a group the board's bed
    order: unit id, a row on no unit last, the bed label (else the patient key) naturally, the patient key."""
    group = 0 if row["antibiotic"]["state"] in CLOCK_OPEN else 1 if row["on_pressor"] else 2
    unit = row["unit_id"] or ""
    return (group, row["antibiotic"]["remaining_sec"] if group == 0 else 0, unit == "", unit,
            _natural(row["bed_label"] or row["patient_id"]), row["patient_id"])


def counts_of(rows: list[dict]) -> dict:
    """The four counters (spec D11). By the engine's rules a recognised patient with no counted administration is
    exactly a `running` or `missed` row, so `recognized_no_record` is their sum."""
    running = sum(1 for row in rows if row["antibiotic"]["state"] == "running")
    missed = sum(1 for row in rows if row["antibiotic"]["state"] == "missed")
    return {"patients": len(rows), "clock_running": running, "clock_missed": missed,
            "on_pressor": sum(1 for row in rows if row["on_pressor"]),
            "recognized": sum(1 for row in rows if row["antibiotic"]["recognized_at"] is not None),
            "recognized_no_record": running + missed}


def ward_pharmacy(cards: list[dict], audit: AuditLog, *, hospital: str, now: datetime, zone, start_a: int,
                  start_b: int) -> dict:
    """The answer of `GET /pharmacy` without its scope block (spec §3). `cards` are the caller's scoped board cards;
    the fluid day is the one that holds `now` (`fluids.fluid_day`), read once for the whole tenant up to
    now + BEDSIDE_SKEW and summed per card over [day start, day end) — a row's balance equals «today» in that
    patient's Sıvı box. Only the cards handed in become rows: another patient's entries are read and dropped. A
    board with no card has no row to sum for, so the trail is not read at all (as `/tasks` skips its reads): the
    answer keeps its whole shape — the same fluid day, zeros, nothing cut."""
    day = fluid_day(now, zone, start_a, start_b)["day"]
    by_patient, truncated = (read_entries_by_patient(audit, hospital, since=day[0], until=now + BEDSIDE_SKEW)
                             if cards else ({}, False))
    rows = sorted((row_of(card, fluid_of(by_patient.get(card["patient_id"], []), day)) for card in cards),
                  key=sort_key)
    return {"now": _iso(now),
            "antibiotic_window_min": int(ANTIBIOTIC_WINDOW.total_seconds() // 60),
            "antibiotic_window_source": ANTIBIOTIC_WINDOW_SOURCE,
            "fluid_day": {"start": _iso(day[0]), "end": _iso(day[1])},
            "fluid_truncated": truncated,
            "counts": counts_of(rows),
            "rows": rows}

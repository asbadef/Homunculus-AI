# homunculus-engine/src/homunculus/api/infection.py
"""Enfeksiyon kontrol (G4-05): the infection-control page's answer, built by the server from the caller's scoped
board cards (spec D4, D10, as §5 S1, S2, A3, M3, M4 amend them). Pure: no route, no engine, no database.

A row is one scoped card: its bed and name (as Eczane's `row_of` reads them), its isolation as the card's `isolation`
block charted it (api/board.py `_isolation`, without the four raw flags), its three-valued suspected-infection mark,
its antibiotic state — `pharmacy.antibiotic_of(card["meds"])`, the very object GET /pharmacy answers for that card,
reused and not copied — and its alarms of the engine's three Sepsis-3 rule kinds, firing and latched, each with
whether it was acknowledged and until when it is snoozed. `isolated` lists the cards in isolation; `suspected` the
cards with suspected infection charted, or with an alarm of the three kinds (§5 M3: a latched one stays listed after
the mark was charted 0). `bed_occupants` says who lies on each bed the scoped cards hold, so the page can word the
isolation beds it draws from the structure tree (§5 S1). The counts are the server's. The ORDER of the lists is the
page's — by the unit and bed names it holds (§5 M4) — and the server sends them by patient key, with `sort_group`, the
one ordering field it decides: 0 an open antibiotic clock, 1 a firing alarm of the three kinds, 2 the rest.

Nothing here judges: no isolation is recommended, no type chosen, no threshold set, no rate computed. The one sourced
number is the 1-hour antibiotic window, `rules/antibiotic_clock.py`'s, as Eczane states it. Homunculus does not
diagnose."""
from __future__ import annotations

from datetime import datetime, timezone

from homunculus.api.pharmacy import ANTIBIOTIC_WINDOW_SOURCE, CLOCK_OPEN, antibiotic_of
from homunculus.rules.antibiotic_clock import WINDOW as ANTIBIOTIC_WINDOW

#: The engine's three Sepsis-3 rule kinds (rules/septic_shock.py), in the order a row lists them. Not `antibiotic_due`
#: / `antibiotic_overdue` (the antibiotic cell says it) and not the model's `sepsis_watch` (an early warning with its
#: own source, not one of the three rule kinds).
SEPSIS_KINDS = ("septic_shock", "sepsis", "under_resuscitated_sepsis")
#: The card's three isolation words (api/board.py `_isolation`).
ISOLATED, NOT_ISOLATED, UNRECORDED = "isolated", "not_isolated", "unrecorded"


def _iso(at: datetime) -> str:
    return at.astimezone(timezone.utc).isoformat()


def isolation_of(card: dict) -> dict:
    """The card's isolation as a row carries it: `{state, types, charted_at}`. An identity-only card's block is null,
    and a card with no block at all is read the same: `unrecorded` (§5 M4)."""
    block = card.get("isolation")
    if not isinstance(block, dict):
        return {"state": UNRECORDED, "types": [], "charted_at": None}
    return {"state": block.get("state") or UNRECORDED, "types": list(block.get("types") or []),
            "charted_at": block.get("charted_at")}


def suspected_of(card: dict) -> bool | None:
    """The three-valued suspected-infection mark; None for a card with no `sepsis` block (an identity-only card)."""
    sepsis = card.get("sepsis")
    return sepsis.get("suspected_infection") if isinstance(sepsis, dict) else None


def sepsis_alarms_of(card: dict) -> list[dict]:
    """The card's alarms of the three kinds, in SEPSIS_KINDS' order: a firing one (`resolved_at` null) and a latched one
    (a critical whose rule stopped while nobody acknowledged it; the board lists a kind once), each with whether it was
    acknowledged and the end of its snooze (§5 M3)."""
    alerts = [a for a in card.get("alerts") or [] if isinstance(a, dict) and a.get("kind") in SEPSIS_KINDS]
    alerts.sort(key=lambda a: SEPSIS_KINDS.index(a["kind"]))
    return [{"kind": a["kind"], "severity": a.get("severity"), "first_seen_at": a.get("first_seen_at"),
             "resolved_at": a.get("resolved_at"), "acknowledged": bool(a.get("acknowledged")),
             "snooze_until": (a.get("snooze") or {}).get("until")} for a in alerts]


def _firing(alarms: list[dict]) -> bool:
    return any(alarm["resolved_at"] is None for alarm in alarms)


def row_of(card: dict) -> dict:
    """One row from one scoped card (spec D10, §5 S2, M3, M4). A card the bed table places on no unit has `unit_id`
    None; a card with no identity an empty label and name."""
    identity = card.get("identity") or {}
    antibiotic = antibiotic_of(card.get("meds"))
    alarms = sepsis_alarms_of(card)
    return {
        "patient_id": card["patient_id"],
        "bed_label": identity.get("bed_label") or "",
        "bed_id": identity.get("bed_id") or None,
        "unit_id": identity.get("unit_id") or None,
        "display_name": identity.get("display_name") or "",
        "isolation": isolation_of(card),
        "suspected_infection": suspected_of(card),
        "antibiotic": antibiotic,
        "sepsis_alarms": alarms,
        "sort_group": 0 if antibiotic["state"] in CLOCK_OPEN else 1 if _firing(alarms) else 2,
    }


def counts_of(rows: list[dict]) -> dict:
    """The page's counters (spec D10, §5 A3, M3): the scoped cards; the cards in isolation and those with no isolation
    record at all; the cards with suspected infection charted TRUE and those with no mark at all (a card with no
    `sepsis` block among them); the passed antibiotic clocks; and the patients with a FIRING alarm of the three kinds,
    answered or not — a latched one is listed, not counted."""
    return {
        "patients": len(rows),
        "isolated": sum(1 for row in rows if row["isolation"]["state"] == ISOLATED),
        "isolation_unrecorded": sum(1 for row in rows if row["isolation"]["state"] == UNRECORDED),
        "suspected": sum(1 for row in rows if row["suspected_infection"] is True),
        "suspected_unrecorded": sum(1 for row in rows if row["suspected_infection"] is None),
        "clock_missed": sum(1 for row in rows if row["antibiotic"]["state"] == "missed"),
        "sepsis_open": sum(1 for row in rows if _firing(row["sepsis_alarms"])),
    }


def ward_infection(cards: list[dict], *, now: datetime) -> dict:
    """The answer of GET /infection without its scope block (spec D10 and the answer after §5). `cards` are the
    caller's scoped board cards; `units` names every unit a card is on, with that unit's counts (a card on no unit is
    counted only in the whole); a card with a bed is one `bed_occupants` entry. A board with no card answers the whole
    shape: zeros and empty lists."""
    rows = sorted((row_of(card) for card in cards), key=lambda row: row["patient_id"])
    units = sorted({row["unit_id"] for row in rows if row["unit_id"]})
    return {
        "now": _iso(now),
        "antibiotic_window_min": int(ANTIBIOTIC_WINDOW.total_seconds() // 60),
        "antibiotic_window_source": ANTIBIOTIC_WINDOW_SOURCE,
        "counts": counts_of(rows),
        "units": [{"unit_id": unit, "counts": counts_of([row for row in rows if row["unit_id"] == unit])}
                  for unit in units],
        "isolated": [row for row in rows if row["isolation"]["state"] == ISOLATED],
        "suspected": [row for row in rows if row["suspected_infection"] is True or row["sepsis_alarms"]],
        "bed_occupants": [{"bed_id": row["bed_id"], "patient_id": row["patient_id"],
                           "display_name": row["display_name"],
                           "isolation": {"state": row["isolation"]["state"], "types": list(row["isolation"]["types"])}}
                          for row in rows if row["bed_id"]],
    }

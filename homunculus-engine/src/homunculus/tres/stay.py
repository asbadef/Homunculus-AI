# homunculus-engine/src/homunculus/tres/stay.py
"""One stay as the mappers read it (TRƏS-01, spec D5, D8, D10) — plain values, no session, no I/O.

`tres/source.py` reads a stay from the database and the audit trail into a `Stay`; the mappers
(`tres/mapping/`) turn it into resources. Keeping the two apart keeps every mapper a pure function
a golden test can hold to spec §5 with synthetic people.

A STAY is a transfer chain of admissions (`Admission.source_admission_id`): its ROOT is the first
row — the Encounter's id (D5) and its start — and its LAST row is where it is now or ended — its
state, its discharge, its department and its board key. A transfer moves the protocol number to
the arriving row (admission/service.py, spec O8 of 2026-11-02) and keeps the patient row, so the
last row's board key is the key of every chart row of the stay: one read (plan F1, N2).

`readings_of` reads the hand-charted bedside values (D10) from the trail's `chart` rows, less the
ones a `chart_retract` withdrew; `first_and_last` picks each signal's first and last by the time it
was measured (the audit id breaks a tie). A row the trail cannot read — not a finite number, a time
with no zone, another unit than the door records — is left out, never sent as a guess."""
from __future__ import annotations

import math
import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime, tzinfo

from homunculus.tres.codes import SIGNALS

CHART = "chart"
RETRACT = "chart_retract"          # api/clinical.py RETRACT: the withdrawal of one `chart` row


@dataclass(frozen=True)
class Person:
    """The patient row's identity, decrypted (spec D20). `fin` is `Patient.national_id`."""
    fin: str | None
    display_name: str | None
    father_name: str | None
    sex: str | None
    date_of_birth: str | None
    phone: str | None


@dataclass(frozen=True)
class Clinician:
    """An attending of the stay and the identity the tab holds for them (D16); the identity's three
    fields are None when the tab has no row for this user."""
    user_id: uuid.UUID
    fin: str | None = None
    family_name: str | None = None
    given_name: str | None = None
    known: bool = False                # a `tres_practitioner_identity` row exists


@dataclass(frozen=True)
class Department:
    """The `hospital-departments` coding the tab maps the stay's unit to (D17)."""
    code: str
    display: str


@dataclass(frozen=True)
class Reading:
    """One hand-charted value: the engine's signal slug, the value, when it was measured, its audit id."""
    slug: str
    value: float
    at: datetime
    entry: int


@dataclass(frozen=True)
class Stay:
    root_id: uuid.UUID
    last_id: uuid.UUID
    board_key: str
    admitted_at: datetime
    discharged_at: datetime | None     # the last row's, once DISCHARGED
    finished: bool                     # the last row is DISCHARGED
    person: Person
    zone: tzinfo | None                # the tenant's zone; None: unknown to this server
    department: Department | None = None
    clinicians: tuple[Clinician, ...] = ()
    weight_kg: float | None = None
    height_cm: float | None = None
    readings: tuple[Reading, ...] = field(default_factory=tuple)


def _instant(text) -> datetime | None:
    try:
        at = datetime.fromisoformat(text)
    except (TypeError, ValueError):
        return None
    return at if at.tzinfo is not None and at.utcoffset() is not None else None


def _finite(value) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def readings_of(records: Iterable) -> tuple[Reading, ...]:
    """The bedside values of `records` (audit records of one stay's board key, `chart` and
    `chart_retract`): every `chart` row of the six signals that no `chart_retract` withdrew, in the
    door's unit, with a finite value and a zone-aware time."""
    records = list(records)
    withdrawn = {rec.payload.get("entry") for rec in records if rec.event_type == RETRACT}
    out = []
    for rec in records:
        signal = SIGNALS.get(rec.subject)
        if rec.event_type != CHART or signal is None or rec.id in withdrawn:
            continue
        value, at = rec.payload.get("value"), _instant(rec.payload.get("obs_ts"))
        if rec.payload.get("unit") != signal.charted_unit or not _finite(value) or at is None:
            continue
        out.append(Reading(rec.subject, float(value), at, rec.id))
    return tuple(out)


def first_and_last(readings: Iterable[Reading]) -> dict[str, tuple[Reading, Reading | None]]:
    """Per signal: (its first reading, its last — or None when there is only one) by measurement
    time, the audit id breaking a tie (D10)."""
    by_signal: dict[str, list[Reading]] = {}
    for reading in readings:
        by_signal.setdefault(reading.slug, []).append(reading)
    out = {}
    for slug, values in by_signal.items():
        ordered = sorted(values, key=lambda r: (r.at, r.entry))
        out[slug] = (ordered[0], ordered[-1] if len(ordered) > 1 else None)
    return out

# homunculus-engine/src/homunculus/api/readings.py
"""G3-05 «Cihaz ölçüm kaydı»: the per-admission record of what was measured (spec §3).

One row per measured value in `vital_readings` (migration 0021), written by both doors: every `/ingest`
observation (`origin` device) and the bedside set of `POST /clinical/{id}` (`origin` manual). A device reading
whose number matches nobody — unknown, or a discharged admission's — is a row too, in state `unmatched`, with
its value: an authorised person links it to the right admission or rejects it.

THE AUDIT TRAIL STAYS THE SOURCE OF TRUTH (spec D7). The engine, the restart's replay and «who did what» read the
audit; this table is its projection, written after the audit row, and every row can be derived again from audit
rows (`reconcile`, Task B10). The table exists for what the audit cannot answer cheaply: «this stay's
measurements, with their source», and «which readings wait for a patient».

This file: the row, the store protocol and the in-memory store (Task B1). The Postgres store is
`api/readings_postgres.py`. No name, no free text but the two reasons a person typed (≤ 200 characters): a
patient is the board's number, as in the audit."""
from __future__ import annotations

import logging
from collections.abc import Iterable
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from typing import Protocol

from homunculus.api.clinical import FLUID_CODES, RETRACTABLE_CODES
from homunculus.canonical import Observation

log = logging.getLogger(__name__)

#: «Since ever»: the start of a stay nobody gave a time for (the in-memory store), and a bound that excludes nothing.
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)

#: `origin`: who produced the value.
ORIGIN_DEVICE = "device"
ORIGIN_MANUAL = "manual"
#: `state`. `recorded`: filed under its patient at arrival. `unmatched`: waits in the list. `assigned`: an
#: unmatched reading a person linked — or, while `patient_key` is still NULL, one a link or a rejection is being
#: made for (the claim, spec D12). `rejected`: closed with a reason; the value is kept.
STATE_RECORDED = "recorded"
STATE_UNMATCHED = "unmatched"
STATE_ASSIGNED = "assigned"
STATE_REJECTED = "rejected"
#: `unmatched_reason`: no identity record under the number, or a discharged admission's number.
REASON_UNKNOWN = "unknown"
REASON_DISCHARGED = "discharged"
#: The audit rows of the list (spec §4). `reading_unmatched`: a device reading that matched nobody, WITH its value
#: — `{value, unit, obs_ts, device, reason}`, patient_id the number as received, subject the code (written by
#: `/ingest`, api/app.py). `reading_assigned` / `reading_rejected`: one row per set a person linked or rejected
#: (the router below, Task B6). The dashboard's «Denetim» page names all three (engineTypes.test.js reads these).
READING_UNMATCHED = "reading_unmatched"
READING_ASSIGNED = "reading_assigned"
READING_REJECTED = "reading_rejected"
#: D9: what `/ingest` does with a number no identity record exists for. `card`: today's behaviour — the reading
#: is applied and makes a nameless card (the default: the test suite, scripts/replay.py and the seed scripts
#: ingest without an identity). `unmatched`: the reading is listed, with no engine entry and no card (production).
POLICY_CARD = "card"
POLICY_UNMATCHED = "unmatched"
UNKNOWN_POLICIES = (POLICY_CARD, POLICY_UNMATCHED)
#: D6: the hand entries the record keeps — the bedside form's set, by the slug a `chart` row carries: what «hatalı
#: giriş» may withdraw (api/clinical.py RETRACTABLE_CODES) minus the fluid volumes, which have their own ledger.
MANUAL_CODES = RETRACTABLE_CODES - FLUID_CODES
#: The widths of the table's `source` and `unit` columns (migration 0021). A feed's text is cut to them at the
#: door, so no device name can make a row unwritable — and D14 compares the source as it was kept.
SOURCE_MAX = 64
UNIT_MAX = 16


@dataclass(frozen=True)
class Reading:
    """One measured value (a row of `vital_readings`). `received_key` is the number the door received;
    `patient_key` the card key the value is filed under — None while unmatched, claimed or rejected.
    `audit_id` is the arrival's audit row (`ingest`, `chart` or `reading_unmatched`); `entry_id` the row the
    engine replays and «hatalı giriş» names (`ingest` or `chart`) — the same row for a matched reading, the
    link's own `ingest` row for an assigned one, None for a reading the engine never took."""
    tenant: str
    received_key: str
    code: str
    value: float
    unit: str
    observed_at: datetime
    received_at: datetime
    origin: str
    source: str                          # the device as it named itself, or "clinician"
    state: str = STATE_RECORDED
    id: int = 0                          # the store's; 0 until added
    patient_key: str | None = None
    admission_id: str | None = None      # admissions.id as text; None for a HIS-fed patient
    recorded_by: str | None = None       # a hand entry's `charted_by`
    unmatched_reason: str | None = None
    audit_id: int | None = None
    entry_id: int | None = None
    resolved_at: datetime | None = None  # the claim: when and by whom it was linked or rejected
    resolved_by: str | None = None
    resolve_reason: str | None = None    # a rejection's reason
    voided_at: datetime | None = None    # «hatalı giriş»: when, by whom, why
    voided_by: str | None = None
    void_reason: str | None = None


class ReadingNotUnmatched(Exception):
    """`claim` on rows that are not all waiting: another hand linked or rejected one first, or an id is not a
    reading of this tenant. Nothing was claimed."""


class ReadingStore(Protocol):
    """What the doors, the list's routes and `reconcile` need. `tenant` is the hospital slug (the audit's key).

    `add` answers the stored row, or None when the table already holds it: the same audit row (`audit_id`), or —
    a device reading — the same number, code, time, device and value (spec D14).
    `claim` moves EVERY row named from `unmatched` to `assigned` (with `resolved_by`, `resolved_at`, and
    `patient_key` still None) or none of them: ReadingNotUnmatched. `release` puts a claim back; `finalize` files
    one under a patient; `reject` closes claims as `rejected`. The three touch claims only, so each is safe to
    repeat. `void` marks the row of an engine entry once: True when it did. `admission_of` is the open
    admission a card key belongs to (spec D8); `open_stays` every open admission's card key with the time the
    stay began (the backfill's bound, D19)."""
    durable: bool

    def add(self, row: Reading) -> Reading | None: ...
    def seen(self, tenant: str, received_key: str, code: str, observed_at: datetime, source: str,
             value: float) -> bool: ...
    def have(self, tenant: str, audit_ids: Iterable[int]) -> set[int]: ...
    def get(self, tenant: str, ids: Iterable[int]) -> list[Reading]: ...
    def for_patient(self, tenant: str, patient_key: str, *, since: datetime, until: datetime) -> list[Reading]: ...
    def unmatched(self, tenant: str, *, since: datetime) -> list[Reading]: ...
    def claim(self, tenant: str, ids: Iterable[int], *, by: str, at: datetime) -> list[Reading]: ...
    def claims(self, tenant: str) -> list[Reading]: ...
    def release(self, tenant: str, ids: Iterable[int]) -> None: ...
    def finalize(self, tenant: str, reading_id: int, *, patient_key: str, admission_id: str | None,
                 entry_id: int) -> None: ...
    def reject(self, tenant: str, ids: Iterable[int], *, reason: str) -> None: ...
    def void(self, tenant: str, entry_id: int, *, by: str, at: datetime, reason: str) -> bool: ...
    def admission_of(self, tenant: str, key: str) -> str | None: ...
    def open_stays(self, tenant: str) -> dict[str, datetime]: ...
    def close(self) -> None: ...


def _same_reading(row: Reading, tenant: str, received_key: str, code: str, observed_at: datetime, source: str,
                  value: float) -> bool:
    """D14's identity of a device reading: the columns of the table's unique index."""
    return (row.origin == ORIGIN_DEVICE and row.tenant == tenant and row.received_key == received_key
            and row.code == code and row.observed_at == observed_at and row.source == source
            and row.value == value)


def _is_claim(row: Reading) -> bool:
    return row.state == STATE_ASSIGNED and row.patient_key is None


class InMemoryReadingStore:
    """For tests and for a deployment without Postgres (rows vanish on restart). `admitted` lets a test say
    what the admissions table would — `{(tenant, key): admission id}` — and `admitted_at` when each of those
    stays began (EPOCH when the test does not say)."""
    durable = False

    def __init__(self, *, admitted: dict[tuple[str, str], str] | None = None,
                 admitted_at: dict[tuple[str, str], datetime] | None = None) -> None:
        self._rows: dict[int, Reading] = {}
        self._next = 1
        self._admitted = dict(admitted or {})
        self._admitted_at = dict(admitted_at or {})

    def _of(self, tenant: str) -> list[Reading]:
        return [r for r in self._rows.values() if r.tenant == tenant]

    def add(self, row: Reading) -> Reading | None:
        for held in self._of(row.tenant):
            if row.audit_id is not None and held.audit_id == row.audit_id:
                return None
            if row.origin == ORIGIN_DEVICE and _same_reading(held, row.tenant, row.received_key, row.code,
                                                             row.observed_at, row.source, row.value):
                return None
        saved = replace(row, id=self._next)
        self._rows[saved.id] = saved
        self._next += 1
        return saved

    def seen(self, tenant: str, received_key: str, code: str, observed_at: datetime, source: str,
             value: float) -> bool:
        return any(_same_reading(r, tenant, received_key, code, observed_at, source, value)
                   for r in self._rows.values())

    def have(self, tenant: str, audit_ids: Iterable[int]) -> set[int]:
        wanted = set(audit_ids)
        return {r.audit_id for r in self._of(tenant) if r.audit_id in wanted}

    def get(self, tenant: str, ids: Iterable[int]) -> list[Reading]:
        wanted = set(ids)
        return sorted((r for r in self._of(tenant) if r.id in wanted), key=lambda r: r.id)

    def for_patient(self, tenant: str, patient_key: str, *, since: datetime, until: datetime) -> list[Reading]:
        rows = [r for r in self._of(tenant) if r.patient_key == patient_key and since <= r.observed_at <= until]
        return sorted(rows, key=lambda r: (r.observed_at, r.id))

    def unmatched(self, tenant: str, *, since: datetime) -> list[Reading]:
        rows = [r for r in self._of(tenant) if r.state == STATE_UNMATCHED and r.received_at >= since]
        return sorted(rows, key=lambda r: (r.received_at, r.id))

    def claim(self, tenant: str, ids: Iterable[int], *, by: str, at: datetime) -> list[Reading]:
        wanted = sorted(set(ids))
        rows = [r for r in self.get(tenant, wanted) if r.state == STATE_UNMATCHED]
        if not wanted or len(rows) != len(wanted):
            raise ReadingNotUnmatched(wanted)
        for r in rows:
            self._rows[r.id] = replace(r, state=STATE_ASSIGNED, resolved_by=by, resolved_at=at)
        return self.get(tenant, wanted)

    def claims(self, tenant: str) -> list[Reading]:
        return sorted((r for r in self._of(tenant) if _is_claim(r)), key=lambda r: r.id)

    def release(self, tenant: str, ids: Iterable[int]) -> None:
        for r in self.get(tenant, ids):
            if _is_claim(r):
                self._rows[r.id] = replace(r, state=STATE_UNMATCHED, resolved_by=None, resolved_at=None)

    def finalize(self, tenant: str, reading_id: int, *, patient_key: str, admission_id: str | None,
                 entry_id: int) -> None:
        for r in self.get(tenant, [reading_id]):
            if _is_claim(r):
                self._rows[r.id] = replace(r, patient_key=patient_key, admission_id=admission_id, entry_id=entry_id)

    def reject(self, tenant: str, ids: Iterable[int], *, reason: str) -> None:
        for r in self.get(tenant, ids):
            if _is_claim(r):
                self._rows[r.id] = replace(r, state=STATE_REJECTED, resolve_reason=reason)

    def void(self, tenant: str, entry_id: int, *, by: str, at: datetime, reason: str) -> bool:
        hit = [r for r in self._of(tenant) if r.entry_id == entry_id and r.voided_at is None]
        for r in hit:
            self._rows[r.id] = replace(r, voided_at=at, voided_by=by, void_reason=reason)
        return bool(hit)

    def admission_of(self, tenant: str, key: str) -> str | None:
        return self._admitted.get((tenant, key))

    def open_stays(self, tenant: str) -> dict[str, datetime]:
        return {key: self._admitted_at.get((t, key), EPOCH) for (t, key) in self._admitted if t == tenant}

    def close(self) -> None:
        return None


# ----------------------------------------------------------------------------- the doors' rows

def device_source(obs: Observation) -> str:
    """The device as the table keeps it and D14 compares it: as sent, cut to the column."""
    return str(obs.source_device or "")[:SOURCE_MAX]


def device_reading(tenant: str, obs: Observation, *, received_at: datetime, audit_id: int,
                   reason: str | None = None) -> Reading:
    """A device reading's row. `reason` None: the engine took it — `recorded` under its own number, `audit_id` its
    `ingest` row, which is also the entry a withdrawal names. With a reason (REASON_UNKNOWN, REASON_DISCHARGED) it
    waits in the list: `unmatched`, under nobody, `audit_id` its `reading_unmatched` row and no entry."""
    matched = reason is None
    return Reading(tenant=tenant, received_key=obs.patient_id, code=obs.code.value, value=obs.value,
                   unit=str(obs.unit or "")[:UNIT_MAX], observed_at=obs.timestamp, received_at=received_at,
                   origin=ORIGIN_DEVICE, source=device_source(obs),
                   state=STATE_RECORDED if matched else STATE_UNMATCHED,
                   patient_key=obs.patient_id if matched else None, unmatched_reason=reason,
                   audit_id=audit_id, entry_id=audit_id if matched else None)


def manual_reading(tenant: str, obs: Observation, *, received_at: datetime, entry_id: int,
                   recorded_by: str) -> Reading:
    """A hand entry's row: `recorded` under the patient it was charted for, `entry_id` its `chart` row."""
    return Reading(tenant=tenant, received_key=obs.patient_id, code=obs.code.value, value=obs.value,
                   unit=str(obs.unit or "")[:UNIT_MAX], observed_at=obs.timestamp, received_at=received_at,
                   origin=ORIGIN_MANUAL, source="clinician", state=STATE_RECORDED, patient_key=obs.patient_id,
                   recorded_by=recorded_by, audit_id=entry_id, entry_id=entry_id)

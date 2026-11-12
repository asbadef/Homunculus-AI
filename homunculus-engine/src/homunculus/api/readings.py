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
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from typing import Protocol

from fastapi import APIRouter, Body, Header, HTTPException

from homunculus.api.audit import AuditEvent, AuditLog
from homunculus.api.clinical import FLUID_CODES, RETRACTABLE_CODES
from homunculus.api.identity import Caller
from homunculus.api.patient_identity import is_tombstone
from homunculus.auth.permissions import validate_permissions
from homunculus.canonical import Observation, SignalCode
from homunculus.gateway.fhir import PATIENT_ID_MAX

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

(CLINICAL_CHART,) = validate_permissions(("clinical.chart",))
#: The list shows what arrived in the last 7 days (spec §4); an older reading stays in the table.
UNMATCHED_WINDOW = timedelta(days=7)
#: D12, Q2: a reading measured longer ago than this cannot be linked, only rejected — G3-01 D7's back-dating
#: bound for a hand entry (api/clinical.py BEDSIDE_BACKDATE). An engineering bound on what may enter a score
#: late, not a clinical threshold.
LINK_MAX_AGE = timedelta(hours=24)
#: The most readings one link or rejection names: a set is one round's values of one patient.
SET_MAX = 50
#: The most sets the list answers: the newest arrivals; `count` still says how many there are, and `truncated`
#: that the answer is short of them (B6 review). A monitor left on a discharged number lists a set per round,
#: and the list is polled every minute by every nurse.
LIST_MAX = 200
#: The most ROWS the list reads from the table: the newest ones (B6 review). A set is one device round, far fewer
#: than SET_MAX values, so LIST_MAX sets fit; a week of a flooded list is cut in the database, never read whole.
#: When the cut bites, `truncated` is set and `count` is the number of sets among the rows read — a lower bound.
UNMATCHED_ROWS_MAX = LIST_MAX * SET_MAX
#: The reason a reading is closed with when the patient it was linked to already holds it (the device sent it
#: again under the corrected number, or a nurse typed it): linking it would put it in the engine twice.
RESOLVE_ALREADY_HELD = "the patient's record already holds this reading: it was not entered a second time"
#: A reading id is a 64-bit signed integer in the table: a larger one names no reading, and is refused as a
#: malformed body rather than left to the database.
ID_MAX = 2**63 - 1
REJECT_MIN_REASON_CHARS = 10
REJECT_MAX_REASON_CHARS = 200

# ----------------------------------------------------------------------------- refusal codes and words

READING_NOT_UNMATCHED = "reading_not_unmatched"
READING_SET_MIXED = "reading_set_mixed"
READING_TOO_OLD = "reading_too_old"
READING_TARGET_DISCHARGED = "reading_target_discharged"
READING_REASON_LENGTH = "reading_reason_length"
#: The server's words. The dashboard maps each code in `apiErrors.js` (Task W1).
WORDS = {
    READING_NOT_UNMATCHED: "The reading is no longer waiting: it was linked or rejected already.",
    READING_SET_MIXED: "The readings are not one set: one number, one device, one time.",
    READING_TOO_OLD: "A reading older than 24 hours cannot be linked; it can only be rejected.",
    READING_TARGET_DISCHARGED: "The patient is discharged: a reading cannot be linked to a closed stay.",
    READING_REASON_LENGTH: "The reason is 10–200 characters.",
}
READING_NEEDS_PERSON = "a person links or rejects a reading: this credential names no actor"
READING_BODY = "`readings` is a list of 1–50 reading ids"
READING_TARGET = "`patient_id` is required"


def reading_refusal(status: int, code: str) -> HTTPException:
    """A refusal with its code beside its words (`{"code", "message"}`), as the task queue answers one."""
    return HTTPException(status_code=status, detail={"code": code, "message": WORDS[code]})


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
    `seen` is D14's question asked of a number: does the record hold this device reading under it — as RECEIVED
    under that number, or FILED under that patient (a reading linked from a mistyped number keeps the wrong one as
    its `received_key`, and `patient_key` is where it counts: B6 review). `unmatched` with a `limit` answers only
    the newest `limit` rows (still oldest first), so the database never reads a week of a flooded list.
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
    def unmatched(self, tenant: str, *, since: datetime, limit: int | None = None) -> list[Reading]: ...
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


def _filed_as(row: Reading, tenant: str, patient_key: str, code: str, observed_at: datetime, source: str,
              value: float) -> bool:
    """The same device reading, FILED under `patient_key` — whatever number it arrived under. `seen` asks this
    as well as `_same_reading`; `add` does not (the unique index is on the number as received)."""
    return (row.origin == ORIGIN_DEVICE and row.tenant == tenant and row.patient_key == patient_key
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
                   or _filed_as(r, tenant, received_key, code, observed_at, source, value)
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

    def unmatched(self, tenant: str, *, since: datetime, limit: int | None = None) -> list[Reading]:
        rows = [r for r in self._of(tenant) if r.state == STATE_UNMATCHED and r.received_at >= since]
        rows.sort(key=lambda r: (r.received_at, r.id))
        return rows if limit is None else rows[max(len(rows) - limit, 0):]

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


# ----------------------------------------------------------------------------- the list's sets

def _iso(at: datetime) -> str:
    return at.astimezone(timezone.utc).isoformat()


def set_key(row: Reading) -> tuple[str, str, datetime]:
    """One set: one number, one device, one time (spec D10) — a round's values of one patient."""
    return (row.received_key, row.source, row.observed_at)


def unmatched_sets(rows: Iterable[Reading], now: datetime) -> list[dict]:
    """The waiting rows as the list answers them (spec §4): one entry per set, the newest arrival first, each
    reading by code. `linkable`: measured within LINK_MAX_AGE of `now` — the screen offers «bağla» only then
    (the engine refuses an older one, READING_TOO_OLD), so the browser judges no age itself."""
    grouped: dict[tuple, list[Reading]] = {}
    for row in rows:
        grouped.setdefault(set_key(row), []).append(row)
    sets = []
    for (received_key, source, observed_at), members in grouped.items():
        members.sort(key=lambda r: (r.code, r.id))
        sets.append({
            "received_key": received_key, "reason": members[0].unmatched_reason, "source": source,
            "observed_at": _iso(observed_at), "received_at": _iso(max(r.received_at for r in members)),
            "linkable": now - observed_at <= LINK_MAX_AGE,
            "readings": [{"id": r.id, "code": r.code, "value": r.value, "unit": r.unit} for r in members],
        })
    sets.sort(key=lambda s: (s["received_at"], s["received_key"], s["source"]), reverse=True)
    return sets


# ----------------------------------------------------------------------------- the router

def readings_router(*, caller: Callable[[str | None], Awaitable[Caller]],
                    sees: Callable[[Caller, str | None], Awaitable[Callable[[str], bool]]],
                    target: Callable[[Caller, str | None, str], Awaitable[object]],
                    identity: Callable[[str, str], object],
                    admission_for: Callable[[str, object], str | None],
                    apply: Callable[..., Awaitable[tuple[list, object]]],
                    audit: AuditLog, store: ReadingStore,
                    clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc)) -> APIRouter:
    """«Eşleşmeyen ölçümler» (spec §4, D10–D12), bound to the app as the task queue is: `caller` resolves the
    credential; `sees(caller, authorization)` resolves the caller's scope once (503 when it cannot be read) and
    answers «may this caller see the patient under this number» (D11); `target(caller, authorization, patient_id)`
    is the link's target check — in scope (404), not discharged (409), on the board (404) — answering the
    identity record; `identity(hospital, patient_id)` reads that record again, synchronously, before each reading
    of a set goes in (the target may be discharged between two of them — see `assign`); `admission_for(hospital,
    record)` is the stay a reading is stamped with (D8); `apply(hospital, obs, record, now, reading=id, actor=name,
    on_written=callback)` is the device door's own tail (`_apply_reading`): it names the reading and the person who
    linked it in the `ingest` row, and calls `on_written(row)` right after that row is written, so the table's row
    is filed before the rest of the tail can fail (B6 review)."""
    router = APIRouter(tags=["readings"])

    def _person(who: Caller) -> str:
        """`clinical.chart`, and a person: a device passes every permission check by being a device, and the
        list is a person's work, named in the trail (D10)."""
        if not who.can(CLINICAL_CHART):
            raise HTTPException(status_code=403, detail=f"permission required: {CLINICAL_CHART}")
        if who.is_device or not isinstance(who.actor, str) or not who.actor.strip():
            raise HTTPException(status_code=403, detail=READING_NEEDS_PERSON)
        return who.actor

    def _ids(body: dict) -> list[int]:
        raw = body.get("readings")
        if (not isinstance(raw, list) or not 1 <= len(raw) <= SET_MAX or len(set(map(repr, raw))) != len(raw)
                or any(not isinstance(i, int) or isinstance(i, bool) or not 1 <= i <= ID_MAX for i in raw)):
            raise HTTPException(status_code=422, detail=READING_BODY)
        return sorted(raw)

    def _once_per_number(visible: Callable[[str], bool]) -> Callable[[str], bool]:
        """`visible` asked once per number within one request (B6 review): the decision is an identity read — a
        synchronous SELECT and a decrypt on the event loop — and a monitor left on a discharged number lists
        thousands of rows under one number."""
        known: dict[str, bool] = {}

        def check(key: str) -> bool:
            if key not in known:
                known[key] = visible(key)
            return known[key]
        return check

    def _assigned_event(hospital: str, patient_id: str, first: Reading, ids: list[int], actor: str,
                        held: Iterable[int] = ()) -> AuditEvent:
        """The one row of a link: the readings of the set that went in, under the patient they went in for.
        `already_held` (present only when there are any): readings of the set the patient's record held already —
        closed, never entered a second time; they are among `readings` on a finished link."""
        payload = {"readings": ids, "received_key": first.received_key, "reason": first.unmatched_reason,
                   "device": first.source, "obs_ts": _iso(first.observed_at), "actor": actor}
        if held:
            payload["already_held"] = list(held)
        return AuditEvent(hospital, READING_ASSIGNED, patient_id, "reading", payload)

    def _note_partial(hospital: str, patient_id: str, first: Reading, linked: list[int], held: list[int],
                      actor: str) -> None:
        """A set that stopped part-way (a raise, or a discharge between two readings) is audited for what DID go
        in: one `reading_assigned` row listing only the readings linked, if there is one. The readings are in the
        engine with their `ingest` rows (which also name the person: `actor`); this row says it once for the set.
        Best effort — the request is already failing, and the answer it gives must not change: a failed append is
        logged with its class only, never the number or a value."""
        if not linked:
            return
        try:
            audit.append(_assigned_event(hospital, patient_id, first, linked, actor, held))
        except Exception as exc:
            log.error("vital_readings: kısmen bağlanan kümenin denetim satırı yazılamadı (hastane %s, %d ölçüm, %s)",
                      hospital, len(linked), type(exc).__name__)

    def _already_held(hospital: str, patient_id: str, row: Reading) -> bool:
        """Does the target's record hold this very reading — the same code, time, device and value, received
        under the corrected number or filed there already (D14's `seen`, asked of the target)? A store that cannot
        answer fails OPEN, as the door's does: the reading is linked."""
        try:
            return store.seen(hospital, patient_id, row.code, row.observed_at, row.source, row.value)
        except Exception as exc:
            log.error("vital_readings: yinelenen ölçüm denetimi yapılamadı (hastane %s, %s); ölçüm bağlanır",
                      hospital, type(exc).__name__)
            return False

    def _filer(hospital: str, patient_id: str, admission: str | None, row: Reading,
               linked: list[int]) -> Callable[[object], None]:
        """What `apply` calls right after it has written the reading's `ingest` row: the table's row is filed
        under the patient THEN, not at the end of the tail (B6 review) — so a failure later in the tail leaves a
        row a re-send is recognised by. It never raises: the audit row exists, so a table that cannot be written
        leaves the reading claimed for `reconcile` to file from that row."""
        def filed(written) -> None:
            try:
                store.finalize(hospital, row.id, patient_key=patient_id, admission_id=admission, entry_id=written.id)
            except Exception as exc:
                log.error("vital_readings: bağlanan ölçümün satırı yazılamadı (hastane %s, %s); reconcile tamamlar",
                          hospital, type(exc).__name__)
                return
            linked.append(row.id)
        return filed

    async def _one_set(who: Caller, authorization: str | None, ids: list[int]) -> list[Reading]:
        """The rows named, when every one is waiting, visible to this caller (D11) and of one set — else the
        refusal. A row the caller may not see answers as one that is not there."""
        visible = _once_per_number(await sees(who, authorization))
        rows = [r for r in store.get(who.hospital, ids) if r.state == STATE_UNMATCHED and visible(r.received_key)]
        if len(rows) != len(ids):
            raise reading_refusal(409, READING_NOT_UNMATCHED)
        if len({set_key(r) for r in rows}) != 1:
            raise reading_refusal(422, READING_SET_MIXED)
        return rows

    def _claim(hospital: str, ids: list[int], actor: str, now: datetime) -> list[Reading]:
        try:
            return store.claim(hospital, ids, by=actor, at=now)
        except ReadingNotUnmatched:                       # another hand got there between the read and the write
            raise reading_refusal(409, READING_NOT_UNMATCHED) from None

    def _release(hospital: str, ids: list[int]) -> None:
        """A claim put back after a failed write — best effort: if this fails too, `reconcile` releases it."""
        if not ids:
            return
        try:
            store.release(hospital, ids)
        except Exception as exc:
            log.error("vital_readings: %d ölçümün kilidi bırakılamadı (hastane %s, %s); reconcile bırakır",
                      len(ids), hospital, type(exc).__name__)

    @router.get("/readings/unmatched")
    async def list_unmatched(authorization: str | None = Header(default=None)):
        who = await caller(authorization)
        _person(who)
        visible = _once_per_number(await sees(who, authorization))
        now = clock()
        fetched = store.unmatched(who.hospital, since=now - UNMATCHED_WINDOW, limit=UNMATCHED_ROWS_MAX + 1)
        cut = len(fetched) > UNMATCHED_ROWS_MAX          # the database held more than it was asked for
        rows = [r for r in (fetched[1:] if cut else fetched) if visible(r.received_key)]
        sets = unmatched_sets(rows, now)
        if cut or len(sets) > LIST_MAX:                  # the newest LIST_MAX sets; `count` is what was read
            return {"count": len(sets), "sets": sets[:LIST_MAX], "truncated": True}
        return {"count": len(sets), "sets": sets}

    @router.post("/readings/unmatched/assign")
    async def assign(body: dict = Body(...), authorization: str | None = Header(default=None)):
        who = await caller(authorization)
        actor = _person(who)
        hospital = who.hospital
        ids = _ids(body)
        patient_id = body.get("patient_id")
        if not isinstance(patient_id, str) or not patient_id.strip() or len(patient_id) > PATIENT_ID_MAX:
            raise HTTPException(status_code=422, detail=READING_TARGET)
        record = await target(who, authorization, patient_id)
        rows = await _one_set(who, authorization, ids)
        now = clock()
        if now - rows[0].observed_at > LINK_MAX_AGE:
            raise reading_refusal(409, READING_TOO_OLD)
        claimed = _claim(hospital, ids, actor, now)
        # From here the rows are ours. Each reading goes into the engine as the device door would have put it
        # (D12): its own time, the device as its source, an ordinary `ingest` row that names it.
        #
        # `waiting` is what has NOT been attempted. A reading leaves it the moment its turn comes, BEFORE `apply`
        # runs, and from then on it is never released by this request: `apply` evaluates, then writes its
        # `ingest` row, then its alert / cleared / first-seen / notification rows and the frame — a raise at any
        # point after the first of those leaves the engine holding the value and, possibly, its `ingest` row
        # written. Released, the reading could be linked a second time (a retry, or a link elsewhere) and write a
        # second `ingest` row — replayed twice, or under two patients. It stays CLAIMED (`assigned`, no
        # `patient_key`) and `reconcile` (Task B10) finalizes it from its `ingest` row, or releases it when
        # CLAIM_STALE has passed with none (the B3 review). Readings of the set already applied stay linked.
        # Only the readings not yet attempted go back to the list; the failure goes up (500). A set that stops
        # part-way is audited for the readings that DID go in (`linked`: applied and filed — B6 review).
        #
        # The target is read again before EACH reading (the B3 review): `apply` awaits, and a discharge between
        # two readings of a set must not put the discharged patient back in the engine, publish a card or notify
        # (D4: no alert for a discharged number). The read is synchronous and the check immediately precedes the
        # `apply`, so a discharge can only land between two readings, never inside the decision.
        #
        # The target's record may already hold a reading of the set (B6 review): the device sent it again under the
        # corrected number, or the order was the other way round. Linking it would put it in the engine twice —
        # two `ingest` rows, both replayed. It is not applied: its row is closed (`rejected`, RESOLVE_ALREADY_HELD,
        # the value kept) and the link's audit row names it under `already_held`. The check precedes each
        # `apply` with no await between, as the door's `_resent` does.
        #
        # The table's row is filed by `apply` itself the moment the `ingest` row exists (`_filer`), so a failure
        # later in the tail leaves the reading filed and a re-send recognised. `linked` is what was applied AND
        # filed.
        waiting = [r.id for r in claimed]
        linked: list[int] = []
        held: list[int] = []
        alerts: list = []
        discharged = False
        try:
            admission = admission_for(hospital, record)
            for row in claimed:
                record = identity(hospital, patient_id)
                if is_tombstone(record):
                    discharged = True
                    break
                waiting.remove(row.id)
                if _already_held(hospital, patient_id, row):
                    store.reject(hospital, [row.id], reason=RESOLVE_ALREADY_HELD)
                    held.append(row.id)
                    continue
                obs = Observation(patient_id=patient_id, code=SignalCode(row.code), value=row.value, unit=row.unit,
                                  timestamp=row.observed_at, source_device=row.source)
                alerts, _ = await apply(hospital, obs, record, now, reading=row.id, actor=actor,
                                        on_written=_filer(hospital, patient_id, admission, row, linked))
        except Exception:
            _release(hospital, waiting)
            _note_partial(hospital, patient_id, claimed[0], linked, held, actor)
            raise
        if discharged:
            # What was applied stays applied and finalized and is audited as the part of the set that went in; the
            # rest return to the list; nothing more reaches the engine.
            _release(hospital, waiting)
            _note_partial(hospital, patient_id, claimed[0], linked, held, actor)
            raise reading_refusal(409, READING_TARGET_DISCHARGED)
        audit.append(_assigned_event(hospital, patient_id, claimed[0], ids, actor, held))
        return {"assigned": ids, "patient_id": patient_id, "alerts": [a.kind for a in alerts]}

    @router.post("/readings/unmatched/reject")
    async def reject(body: dict = Body(...), authorization: str | None = Header(default=None)):
        who = await caller(authorization)
        actor = _person(who)
        hospital = who.hospital
        ids = _ids(body)
        raw = body.get("reason")
        reason = raw.strip() if isinstance(raw, str) else ""
        if not REJECT_MIN_REASON_CHARS <= len(reason) <= REJECT_MAX_REASON_CHARS:
            raise reading_refusal(422, READING_REASON_LENGTH)
        rows = await _one_set(who, authorization, ids)
        _claim(hospital, ids, actor, clock())
        first = rows[0]
        # The audit row, then the table's (D7). An append that fails releases the claim: nothing was rejected.
        try:
            audit.append(AuditEvent(hospital, READING_REJECTED, first.received_key, "reading", {
                "readings": ids, "received_key": first.received_key, "device": first.source,
                "obs_ts": _iso(first.observed_at), "reason": reason, "actor": actor}))
        except Exception:
            _release(hospital, ids)
            raise
        store.reject(hospital, ids, reason=reason)
        return {"rejected": ids}

    return router

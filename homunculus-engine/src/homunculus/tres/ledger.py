# homunculus-engine/src/homunculus/tres/ledger.py
"""The delivery ledger's rules (TRƏS-01, spec D4, D6, D7, D21): what one resource's row says, and
what is asked of the platform because of it.

`deliver` takes ONE resource to the platform and writes the outcome on its row — the row of
(tenant, environment, resource type, local id), made on first use and LOCKED until the outcome is
committed, so that one key has one writer at a time (`_row`):

* mode `validate` — the platform checks the resource and stores nothing; the row reads `validated`.
* mode `send`, the same payload as the last `sent` — nothing is asked (D7: the digest is exact).
* mode `send`, a platform id on the row — PUT to it; a 404 or «Non-existent reference» means the
  id went stale, and falls back to the search (§4.2).
* mode `send`, no platform id — find by the local id, then PUT, or POST with the local id as the
  placeholder `id` (D4). Another sender never collides: the local ids carry `hmn-` (D5).
* a failure OF THIS RESOURCE (every status that is not an outage: a 4xx such as 400, 403, 404,
  409 or 422, a 500, a 501 or another 5xx, a `$validate` that holds an error, a search that cannot
  prove an absence) — the row reads `failed`, the attempt is counted, the platform's words are
  kept (encrypted: they may echo a value), and the same payload is not tried again for 30 minutes;
  the fifth failure in a row makes it `stuck`, which only `force` (the nightly retry, «Yeniden
  dene») or a changed payload tries again (D21). A 5xx among them is also RAISED AGAIN after it is
  recorded, so that the round counts it towards its five in a row (review I2).
* an OUTAGE (`client.is_outage`: no session, no answer at all, a 3xx, 408, 429, 502, 503, 504) is
  the platform's state, not this resource's (review #1, I2; open item O13, closed «no»): it is
  RE-RAISED, so the caller ends or counts its round, and the row is left as it was — its status,
  its attempts, its wait, its last words. A row made by this call stays `pending`.

`record_skip` writes why a resource was not built (`fin_missing`, `unit_unmapped`… — a catalogue
code, never text). `held` reads the platform's id of a row without locking it (a reference, a
preview); `forget_skip` removes a skip that stood for no record at all (a Patient's placeholder,
ids.patient_placeholder) once the resource has an id of its own.

A ROW SHARED BY A PERSON'S STAYS (plan F1, amendment 25, A1). The Patient's row is keyed by the
FİN, so every stay of one person reaches the same row — built from DIFFERENT patient rows (the
admission form makes one per admission: a phone typed once, a name corrected later). Were each to
send its own, the national Patient would flip between them every round. With `shared`, the
person's NEWEST stay is the row's authority: once the row is held for a stay (its `admission_id`)
whose last admission is newer than the caller's (`newer_stay`: the admission time, a tie broken by
the larger id) AND the row holds the platform's id (`yields`, batch-4 review), the call YIELDS —
nothing is asked, written or moved, the row comes back as it is (`row.yielded`) and the caller
refers to the platform's id on it. A newer stay the platform holds nothing for (its Patient refused,
skipped, never sent) does not hold the older one back: the older sends its own version and takes the
row, and the newer takes it back the next time it runs — after which the older yields (no flip-flop
in `send`). The comparison is made in `_row`, AFTER the row is locked, and the send that may follow
happens under the same lock: two stays' deliverers of the person (a round and a hand, two processes)
are serialised by the row, and the second always judges what the first left. A newer stay that has
not run yet owns nothing, so it does not hold the older one back either. (In `validate` a row holds
an id only from an earlier `send`; until then each stay validates its own version.)

`row.took_id` (A5): this `deliver` took the row's `remote_id` from None to a value, under its lock —
the one run that gave the resource its platform id, whichever deliverer it was.

A DELIVERER THAT MUST NOT WAIT (plan F1, N12): «Şimdi gönder» and «Yeniden dene» are a person's
request, and a round may hold the row they need for minutes (its transaction spans its HTTP
calls). With `lock_timeout_ms` the row is waited for that long at most, then `LedgerBusy` is
raised and nothing is written: the route answers «busy, try again». It is `SET LOCAL lock_timeout`,
not `FOR UPDATE NOWAIT`: a round that has INSERTED a new row and not committed makes the INSERT …
ON CONFLICT wait for its transaction, which NOWAIT would not bound. The bound is on TAKING the row
and nothing after it (review M3): once the row is held, `lock_timeout` is put back to the default,
so the write that follows the HTTP calls is not under it. `forget_skip` is under the same bound
(review M4). `LedgerBusy` ROLLS BACK THE CALLER'S WHOLE SESSION TRANSACTION, not just the call — a
caller must hold no pending write it wants to keep (review M8).

EVERY OUTCOME IS COMMITTED BEFORE THIS RETURNS: a POST the platform took must not be forgotten by
a crash a moment later, or the next round would look it up again for nothing — and a ledger that
forgot a failure would hammer the platform. No body is stored and none is logged (D6, D25)."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission.models import Admission
from homunculus.crypto import phi_digest
from homunculus.tres.client import TresClient, TresError, is_outage
from homunculus.tres.models import TresDelivery

#: The failures in a row after which a resource is `stuck` (D21).
MAX_ATTEMPTS = 5
#: How long a failed payload waits before it is tried again.
RETRY_AFTER = timedelta(minutes=30)
#: The platform's words for a reference to a resource it does not hold (§4.2), as a PUT to a stale
#: id may answer.
NO_REFERENCE = "Non-existent reference"
#: `last_error` is at most this long in characters AND in UTF-8 bytes, so that its Fernet
#: ciphertext (≈1430 characters for 1000 bytes) fits the column (PHI_COLUMN_LENGTH, 1536).
ERROR_MAX_CHARS = 500
ERROR_MAX_BYTES = 1000
#: How long a hand-started delivery waits for a row a round holds, in milliseconds (N12).
HAND_LOCK_TIMEOUT_MS = 2000
#: Postgres's SQLSTATE for a lock not had within `lock_timeout`.
LOCK_NOT_AVAILABLE = "55P03"


class LedgerBusy(Exception):
    """Another deliverer holds this resource's row: nothing was written; try again later.

    The session's transaction has been ROLLED BACK — all of it, not only this call's statements
    (review M8): whatever the caller had written and not committed is gone, and every object the
    session held is expired. Raised by `_row` (so by `deliver` and `record_skip`) and by
    `forget_skip`, and only when the caller passed a `lock_timeout_ms`."""


def is_lock_timeout(error: BaseException) -> bool:
    """A statement cancelled because its lock was not had within `lock_timeout`."""
    orig = getattr(error, "orig", None)
    return (getattr(orig, "sqlstate", None) or getattr(orig, "pgcode", None)) == LOCK_NOT_AVAILABLE


def payload_digest(resource: dict) -> str:
    """A keyed digest of the resource WITHOUT its `id` (D7): the canonical JSON — sorted keys,
    compact separators, no ASCII escapes — through `crypto.phi_digest`. The `id` is left out
    because it differs between a POST (the placeholder) and a PUT (the platform's)."""
    body = {key: value for key, value in resource.items() if key != "id"}
    return phi_digest(json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False))


def clip_error(message: str) -> str:
    """The platform's words, cut to what the column can hold once encrypted."""
    text = (message or "")[:ERROR_MAX_CHARS]
    return text.encode("utf-8")[:ERROR_MAX_BYTES].decode("utf-8", errors="ignore")


def newer_stay(owner: tuple[datetime, uuid.UUID], caller: tuple[datetime, uuid.UUID]) -> bool:
    """Is the stay that owns a shared row newer than the caller's? Each is (its last admission's
    `admission_datetime`, that admission's id): the later time wins, and on the same time the larger
    id — deterministic, so two stays never both take the row. Equal: not newer (the caller sends)."""
    return owner > caller


async def _owner_is_newer(db: AsyncSession, owner_id: uuid.UUID, admission_id: uuid.UUID) -> bool:
    """`newer_stay` of the two admissions, read in the caller's transaction. An admission that is
    not there (deleted since: the row's key is SET NULL with it) owns nothing."""
    rows = dict((await db.execute(select(Admission.id, Admission.admission_datetime).where(
        Admission.id.in_((owner_id, admission_id))))).all())
    if owner_id not in rows or admission_id not in rows:
        return False
    return newer_stay((rows[owner_id], owner_id), (rows[admission_id], admission_id))


async def yields(db: AsyncSession, *, owner_id: uuid.UUID | None, remote_id: str | None,
                 admission_id: uuid.UUID | None) -> bool:
    """Does the stay `admission_id` leave a SHARED row (the person's Patient) to the stay that owns
    it (A1, as the batch-4 review amends it)? Only to a NEWER stay whose row HOLDS the platform's id:
    an older stay never waits behind a newer one that the platform holds nothing for (its Patient
    refused, skipped, never sent) — it sends its own version and takes the row, and the newer stay
    takes it back the next time it runs (then the older yields: no flip-flop). `_row` asks this
    under the row's lock; the preview (package.PreviewSender) asks it of the row as it reads it."""
    return (admission_id is not None and owner_id is not None and owner_id != admission_id
            and remote_id is not None and await _owner_is_newer(db, owner_id, admission_id))


def due(row: TresDelivery, now: datetime) -> bool:
    """May an UNCHANGED payload be tried now? Not while `stuck`, and not while a `failed` row's
    wait has not run out. Every other row may."""
    if row.status == "stuck":
        return False
    if row.status == "failed" and row.next_attempt_at is not None:
        return now >= row.next_attempt_at
    return True


async def _row(db: AsyncSession, *, tenant_id: uuid.UUID, environment: str, resource_type: str,
               local_id: str, admission_id: uuid.UUID | None,
               lock_timeout_ms: int | None = None, shared: bool = False) -> TresDelivery:
    """The row of this key, made if there is none, and LOCKED until the caller's commit — ONE
    WRITER PER KEY (review #2). Two deliverers of one resource at once (a round and «Şimdi gönder»)
    would otherwise both look the local id up, both find nothing and both POST: two national
    records of one resource. `INSERT … ON CONFLICT DO NOTHING` on the key, then `SELECT … FOR
    UPDATE` (protocol/router.py's pattern): the second waits for the first's commit and then reads
    what it wrote — `populate_existing`, so a row this session already holds is read again, never
    trusted from memory. With `lock_timeout_ms`, a wait longer than that is `LedgerBusy` (the
    whole session transaction rolled back, nothing written); and once the row is held the bound is
    lifted (`SET LOCAL lock_timeout TO DEFAULT`, review M3): it covers the wait for the row and
    nothing the caller does with it afterwards — the write after the HTTP calls, minutes later.

    The row's `admission_id` follows the caller's stay — unless the row is `shared` (the person's
    Patient, amendment 25, A1) and held for a NEWER stay that the platform holds it for (`remote_id`;
    batch-4 review, `yields`): then nothing moves and `row.yielded` is set (the module's docstring).
    Judged here, under the lock. `row.took_id` and `row.yielded` are reset
    on every call (models.TresDelivery)."""
    key = (TresDelivery.tenant_id == tenant_id, TresDelivery.environment == environment,
           TresDelivery.resource_type == resource_type, TresDelivery.local_id == local_id)
    try:
        if lock_timeout_ms is not None:
            await db.execute(text(f"SET LOCAL lock_timeout = '{int(lock_timeout_ms)}ms'"))
        await db.execute(insert(TresDelivery).values(
            id=uuid.uuid4(), tenant_id=tenant_id, environment=environment, resource_type=resource_type,
            local_id=local_id, admission_id=admission_id, status="pending", attempts=0,
        ).on_conflict_do_nothing(constraint="uq_tres_deliveries_key"))
        row = (await db.execute(select(TresDelivery).where(*key).with_for_update()
                                .execution_options(populate_existing=True))).scalar_one()
        if lock_timeout_ms is not None:
            # The row is ours: the bound has done its work (review M3).
            await db.execute(text("SET LOCAL lock_timeout TO DEFAULT"))
    except DBAPIError as exc:
        if not is_lock_timeout(exc):
            raise
        await db.rollback()
        raise LedgerBusy(resource_type) from None
    row.took_id, row.yielded = False, False
    if admission_id is not None and row.admission_id != admission_id:
        if shared and await yields(db, owner_id=row.admission_id, remote_id=row.remote_id,
                                   admission_id=admission_id):
            row.yielded = True                 # the person's newest held stay is the row's authority (A1)
        else:
            row.admission_id = admission_id    # the row follows the caller's stay
    return row


async def _write(client: TresClient, fhir_type: str, local_id: str, resource: dict,
                 remote_id: str | None) -> tuple[str, str]:
    """PUT or POST (§4.2); answers the platform's id and which of the two it was."""
    if remote_id:
        try:
            await client.update(fhir_type, remote_id, resource)
            return remote_id, "update"
        except TresError as exc:
            if exc.status != 404 and NO_REFERENCE not in exc.message:
                raise
    # None only when the platform's answer proves it holds none; an answer that cannot (a next
    # page, an entry with no local id…) raises `TresSearchUnclear` and nothing is POSTed: the row
    # counts it as a refusal (review I1).
    found = await client.find(fhir_type, local_id)
    if found:
        await client.update(fhir_type, found, resource)
        return found, "update"
    return await client.create(fhir_type, {**resource, "id": local_id}), "create"


async def deliver(db: AsyncSession, client: TresClient, *, tenant_id: uuid.UUID, environment: str,
                  mode: str, resource_type: str, fhir_type: str, local_id: str, resource: dict,
                  admission_id: uuid.UUID | None = None, now: datetime | None = None,
                  force: bool = False, lock_timeout_ms: int | None = None,
                  shared: bool = False) -> TresDelivery:
    """One resource to the platform, its outcome on its ledger row (the module's docstring).
    `resource_type` is the ledger's key (`vital`, `lab`, `patient`…); `fhir_type` the platform's
    (`Observation`, `Patient`…). Returns the row; raises the `TresError` of an outage again
    (`client.is_outage`), the row left as it was; raises a counted 5xx again after recording it.

    `shared` (the person's Patient, A1): a row held for a newer stay of the person, with the
    platform's id on it (`yields`), is left as it is and returned with `row.yielded` — nothing
    validated, sent or moved. `row.took_id` (A5) says
    whether THIS call took the row's `remote_id` from None to a value, under the row's lock.

    The row is locked from `_row` to the commit, and the transaction SPANS THE HTTP CALLS — on
    purpose: the lock is what keeps a second deliverer of the same key from asking the platform
    while the first is still waiting for its answer. Each call has the client's overall deadline
    (`client.CALL_DEADLINE_S`, 60 s), but a delivery may make SEVERAL calls — a PUT to a stale id,
    its 404, the search, the POST, a new token on a 401 between them — and holds the lock across
    all of them: minutes at the very worst, never without end. It holds one row, never the tenant's
    ledger.

    With `lock_timeout_ms` a row held by another deliverer for longer raises `LedgerBusy`, which
    ROLLS BACK THE CALLER'S WHOLE SESSION TRANSACTION (review M8): the caller must hold no pending
    write it wants to keep. The bound is on taking the row only; the HTTP calls and the write after
    them run under the default (review M3)."""
    if mode not in ("validate", "send"):
        raise ValueError(f"deliver() is for the modes validate and send, not {mode!r}")
    now = now or datetime.now(timezone.utc)
    digest = payload_digest(resource)
    row = await _row(db, tenant_id=tenant_id, environment=environment, resource_type=resource_type,
                     local_id=local_id, admission_id=admission_id, lock_timeout_ms=lock_timeout_ms,
                     shared=shared)
    if row.yielded:
        await db.commit()
        return row
    before = row.remote_id
    same = row.payload_digest == digest
    done = ("sent", "validated") if mode == "validate" else ("sent",)
    if same and (row.status in done or (not force and not due(row, now))):
        await db.commit()
        return row
    try:
        if mode == "validate":
            await client.validate(fhir_type, {**resource, "id": local_id})
            remote_id, operation = row.remote_id, "validate"
        else:
            remote_id, operation = await _write(client, fhir_type, local_id, resource, row.remote_id)
    except TresError as exc:
        if is_outage(exc):
            # Nothing was learnt about this resource. The row is not written (a new one stays
            # `pending`); the commit ends the transaction all the same.
            await db.commit()
            raise
        # A corrected record starts its count again.
        row.attempts = (row.attempts if same else 0) + 1
        row.status = "stuck" if row.attempts >= MAX_ATTEMPTS else "failed"
        row.payload_digest = digest
        row.last_error = clip_error(exc.message)
        row.next_attempt_at = now + RETRY_AFTER
        await db.commit()
        if exc.status is not None and exc.status >= 500:
            # Counted against the row, AND raised again: the round counts a server error towards
            # its five in a row (worker.py), and the package stops here.
            raise
        return row
    row.status = "validated" if mode == "validate" else "sent"
    row.operation, row.remote_id, row.payload_digest = operation, remote_id, digest
    row.attempts, row.last_error, row.next_attempt_at, row.reason = 0, None, None, None
    row.took_id = before is None and remote_id is not None
    await db.commit()
    return row


async def record_skip(db: AsyncSession, *, tenant_id: uuid.UUID, environment: str,
                      resource_type: str, local_id: str, reason: str,
                      admission_id: uuid.UUID | None = None, keep_held: bool = False,
                      lock_timeout_ms: int | None = None, shared: bool = False) -> TresDelivery:
    """The resource was not built: its row reads `skipped` with the catalogue's reason code. With
    `keep_held`, a row the platform holds a record of (it has a `remote_id`) is left exactly as it
    is: a type switched off stops what is sent next, it does not rewrite what was sent (review M7).
    With `shared` (A1), a row held for a newer stay of the person, with the platform's id on it
    (`yields`), is left exactly as it is too, and comes back with `row.yielded`: an older stay's
    reason does not overwrite the newer one's record.
    With `lock_timeout_ms`, `LedgerBusy` rolls back the caller's WHOLE session transaction (review
    M8): the caller must hold no pending write it wants to keep."""
    row = await _row(db, tenant_id=tenant_id, environment=environment, resource_type=resource_type,
                     local_id=local_id, admission_id=admission_id, lock_timeout_ms=lock_timeout_ms,
                     shared=shared)
    if row.yielded or (keep_held and row.remote_id):
        await db.commit()
        return row
    if row.status != "skipped" or row.reason != reason:
        row.status, row.reason = "skipped", reason
        row.attempts, row.last_error, row.next_attempt_at = 0, None, None
    await db.commit()
    return row


async def held(db: AsyncSession, *, tenant_id: uuid.UUID, environment: str, resource_type: str,
               local_id: str) -> str | None:
    """The platform's id of this resource as the ledger holds it, or None — read, never locked."""
    return (await db.execute(select(TresDelivery.remote_id).where(
        TresDelivery.tenant_id == tenant_id, TresDelivery.environment == environment,
        TresDelivery.resource_type == resource_type, TresDelivery.local_id == local_id))).scalar_one_or_none()


async def forget_skip(db: AsyncSession, *, tenant_id: uuid.UUID, environment: str, resource_type: str,
                      local_id: str, lock_timeout_ms: int | None = None) -> None:
    """Removes a `skipped` row the platform holds no record of (no `remote_id`), and commits.

    For a person's request the delete is under the same bound as taking a row (review M4): a round
    holding the placeholder's row would otherwise make it wait for the round's whole transaction.
    With `lock_timeout_ms` a wait longer than that is `LedgerBusy` — the caller's WHOLE session
    transaction rolled back (review M8), the row untouched."""
    try:
        if lock_timeout_ms is not None:
            await db.execute(text(f"SET LOCAL lock_timeout = '{int(lock_timeout_ms)}ms'"))
        await db.execute(delete(TresDelivery).where(
            TresDelivery.tenant_id == tenant_id, TresDelivery.environment == environment,
            TresDelivery.resource_type == resource_type, TresDelivery.local_id == local_id,
            TresDelivery.status == "skipped", TresDelivery.remote_id.is_(None)))
    except DBAPIError as exc:
        if not is_lock_timeout(exc):
            raise
        await db.rollback()
        raise LedgerBusy(resource_type) from None
    await db.commit()

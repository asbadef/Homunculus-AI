# homunculus-engine/src/homunculus/tres/ledger.py
"""The delivery ledger's rules (TRƏS-01, spec D4, D6, D7, D21): what one resource's row says, and
what is asked of the platform because of it.

`deliver` takes ONE resource to the platform and writes the outcome on its row — the row of
(tenant, environment, resource type, local id), made on first use:

* mode `validate` — the platform checks the resource and stores nothing; the row reads `validated`.
* mode `send`, the same payload as the last `sent` — nothing is asked (D7: the digest is exact).
* mode `send`, a platform id on the row — PUT to it; a 404 or «Non-existent reference» means the
  id went stale, and falls back to the search (§4.2).
* mode `send`, no platform id — find by the local id, then PUT, or POST with the local id as the
  placeholder `id` (D4). Another sender never collides: the local ids carry `hmn-` (D5).
* a refusal OF THIS RESOURCE (a 4xx other than 401 and 429, or a `$validate` that holds an error)
  — the row reads `failed`, the attempt is counted, the platform's words are kept (encrypted: they
  may echo a value), and the same payload is not tried again for 30 minutes; the fifth failure in
  a row makes it `stuck`, which only `force` (the nightly retry, «Yeniden dene») or a changed
  payload tries again (D21).
* an OUTAGE (`client.is_outage`: no session, a 429, a 5xx, no answer at all) is the platform's
  state, not this resource's (review #1; open item O13, closed «no»): it is RE-RAISED, so the
  caller ends or counts its round, and the row is left as it was — its status, its attempts, its
  wait, its last words. A row made by this call stays `pending`.

`record_skip` writes why a resource was not built (`fin_missing`, `unit_unmapped`… — a catalogue
code, never text).

EVERY OUTCOME IS COMMITTED BEFORE THIS RETURNS: a POST the platform took must not be forgotten by
a crash a moment later, or the next round would look it up again for nothing — and a ledger that
forgot a failure would hammer the platform. No body is stored and none is logged (D6, D25)."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

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


def due(row: TresDelivery, now: datetime) -> bool:
    """May an UNCHANGED payload be tried now? Not while `stuck`, and not while a `failed` row's
    wait has not run out. Every other row may."""
    if row.status == "stuck":
        return False
    if row.status == "failed" and row.next_attempt_at is not None:
        return now >= row.next_attempt_at
    return True


async def _row(db: AsyncSession, *, tenant_id: uuid.UUID, environment: str, resource_type: str,
               local_id: str, admission_id: uuid.UUID | None) -> TresDelivery:
    row = (await db.execute(select(TresDelivery).where(
        TresDelivery.tenant_id == tenant_id, TresDelivery.environment == environment,
        TresDelivery.resource_type == resource_type,
        TresDelivery.local_id == local_id))).scalar_one_or_none()
    if row is None:
        row = TresDelivery(tenant_id=tenant_id, environment=environment, resource_type=resource_type,
                           local_id=local_id, admission_id=admission_id, status="pending", attempts=0)
        db.add(row)
        await db.flush()
    elif admission_id is not None and row.admission_id != admission_id:
        row.admission_id = admission_id        # a person's row follows their latest stay
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
    found = await client.find(fhir_type, local_id)
    if found:
        await client.update(fhir_type, found, resource)
        return found, "update"
    return await client.create(fhir_type, {**resource, "id": local_id}), "create"


async def deliver(db: AsyncSession, client: TresClient, *, tenant_id: uuid.UUID, environment: str,
                  mode: str, resource_type: str, fhir_type: str, local_id: str, resource: dict,
                  admission_id: uuid.UUID | None = None, now: datetime | None = None,
                  force: bool = False) -> TresDelivery:
    """One resource to the platform, its outcome on its ledger row (the module's docstring).
    `resource_type` is the ledger's key (`vital`, `lab`, `patient`…); `fhir_type` the platform's
    (`Observation`, `Patient`…). Returns the row; raises the `TresError` of an outage again
    (`client.is_outage`), the row left as it was."""
    if mode not in ("validate", "send"):
        raise ValueError(f"deliver() is for the modes validate and send, not {mode!r}")
    now = now or datetime.now(timezone.utc)
    digest = payload_digest(resource)
    row = await _row(db, tenant_id=tenant_id, environment=environment, resource_type=resource_type,
                     local_id=local_id, admission_id=admission_id)
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
        return row
    row.status = "validated" if mode == "validate" else "sent"
    row.operation, row.remote_id, row.payload_digest = operation, remote_id, digest
    row.attempts, row.last_error, row.next_attempt_at, row.reason = 0, None, None, None
    await db.commit()
    return row


async def record_skip(db: AsyncSession, *, tenant_id: uuid.UUID, environment: str,
                      resource_type: str, local_id: str, reason: str,
                      admission_id: uuid.UUID | None = None) -> TresDelivery:
    """The resource was not built: its row reads `skipped` with the catalogue's reason code."""
    row = await _row(db, tenant_id=tenant_id, environment=environment, resource_type=resource_type,
                     local_id=local_id, admission_id=admission_id)
    if row.status != "skipped" or row.reason != reason:
        row.status, row.reason = "skipped", reason
        row.attempts, row.last_error, row.next_attempt_at = 0, None, None
    await db.commit()
    return row

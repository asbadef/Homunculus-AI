# homunculus-engine/src/homunculus/tres/deliveries.py
"""Yönetim › TRƏS — what was sent, and a person's hand on it (TRƏS-01, spec §6, D9, D21, D24, D25;
plan F1, N12, N14, N15, O21). `tres.manage`, the caller's tenant only.

GET /admin/tres/deliveries?status=&type=&admission=&environment=&cursor= — the ledger, newest change
first, PAGE rows at a time (`next`: the cursor of the next page, or null), each row with its stay's
board key (the protocol number; the H-number of an older admission): status, skip reason,
attempts, operation, whether the platform holds it, when it is tried next. NO `last_error`: the
platform's words may echo a value — they are shown by the audited preview only (D25). The answer
also says which environment it lists and whether the platform refused the tenant's login
(`session_refused_at`, N15: the tab shows it at the top of the panel). `environment` defaults to
the selected one; `admission` is any admission of a stay — a person's Patient row is listed under
their NEWEST stay that has run (amendment 25, A1: the row's `admission_id`); a filter the ledger
cannot hold is 422 `tres_filter`, a cursor this route did not write 422 `tres_cursor`.

GET /admin/tres/admissions?key= — the stay a board key (protocol number, or an older admission's
H-number) belongs to: its last admission's id, the key, the state, the discharge. 404
`tres_stay_unknown`. What «Şimdi gönder» and the preview are asked for.

GET /admin/tres/admissions/{id}/preview — the stay's resources rebuilt as they would be sent
(package.PreviewSender: nothing is asked of the platform, nothing written to the ledger), each
with its ledger row's status and the platform's last words — PHI, so the read is audited
`tres.preview` `{"actor", "admission_id"}` (D25). Allowed whatever the locks say: an administrator
checks the mappings before turning the feed on. An older stay's Patient left to the person's newer
stay (amendment 25, A1) is shown as THIS stay builds it, with no status (the row is the newer
stay's); its references are the ones a send would use.

POST /admin/tres/admissions/{id}/send — «Şimdi gönder» (D9): the stay's package now, whether or not
it is due — an admitted patient goes as `in-progress`. POST /admin/tres/deliveries/{id}/retry —
«Yeniden dene» (D21, O21): the package of the row's stay with `force`, so a `stuck` row (or one in
its 30-minute wait) is tried now — a person's Patient row belongs to their newest stay (amendment
25, A1), so «Yeniden dene» on it runs that stay. Both:
* send a person's Patient only from their newest stay that has run and that the platform holds the
  person for (amendment 25, A1; batch-4 review): the hand on an older stay asks nothing for it and
  refers to the newer stay's Patient — a newer stay the platform holds nothing for does not hold it
  back (it sends its own version, and the newer stay takes the row back when it runs);
* leave the stay's one `tres.package` row to the source (`StaySource.package`): written only by the
  run whose delivery took the Encounter's platform id under its row's lock (amendment 25, A5) — a
  hand after a round, or a round after a hand, writes none;
* 409 `egress_off` (the install's lock), `tres_off` (the tenant's mode), `tres_account_incomplete`,
  `tres_live_closed` (the live platform, closed in this version), `tres_host_not_allowed`;
* run under a LOCK TIMEOUT (N12): a row a round holds is waited for HAND_LOCK_TIMEOUT_MS at most,
  then 409 `tres_busy` — try again — never a request that hangs behind a round;
* a login the platform refuses parks the tenant as a round would (worker.park, N15: only while
  the settings are the ones the request began on) — 409 `tres_login_refused`; an outage or a
  server error is 503 `tres_platform_unavailable`;
* answer the rows the package touched (type, local id, status, reason — no value);
* are audited AFTER the attempt (`tres.send`, `tres.retry`): the actor, the admission (and the
  delivery for a retry), the result's code and, when it ran to its end, the counts by type and
  status. A refused precondition (the 409s above, a 404) asked nothing and writes no row."""
from __future__ import annotations

import base64
import binascii
import uuid
from datetime import datetime, timezone
from functools import partial

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission import trail
from homunculus.admission.boardkey import board_key
from homunculus.admission.models import Admission, AdmissionState, Patient
from homunculus.auth.dependencies import caller_tenant_id, require_permission
from homunculus.auth.models import User
from homunculus.db import get_db
from homunculus.tres.client import TresError, TresLoginRefused
from homunculus.tres.egress import TresEgressRefused, live_closed, open_client
from homunculus.tres.errors import (
    EGRESS_OFF, TRES_ACCOUNT_INCOMPLETE, TRES_BUSY, TRES_CURSOR, TRES_FILTER, TRES_LIVE_CLOSED, TRES_LOGIN_REFUSED,
    TRES_OFF, TRES_PLATFORM_UNAVAILABLE, TRES_STAY_UNKNOWN, refusal,
)
from homunculus.tres.ledger import HAND_LOCK_TIMEOUT_MS, LedgerBusy
from homunculus.tres.models import ENVIRONMENTS, RESOURCE_TYPES, STATUSES, TresDelivery, TresSettings, account_of
from homunculus.tres.package import PreviewSender, run
from homunculus.tres.source import chain_of
from homunculus.tres.worker import Sender, park

router = APIRouter(prefix="/admin/tres", tags=["tres"])

#: Rows per page of the ledger's list.
PAGE = 50


class DeliveryOut(BaseModel):
    id: uuid.UUID
    resource_type: str
    local_id: str
    status: str
    reason: str | None
    attempts: int
    operation: str | None
    remote_id: str | None
    next_attempt_at: datetime | None
    updated_at: datetime
    admission_id: uuid.UUID | None
    board_key: str | None


class DeliveriesOut(BaseModel):
    environment: str
    session_refused_at: datetime | None
    items: list[DeliveryOut]
    next: str | None


class StayOut(BaseModel):
    admission_id: uuid.UUID
    board_key: str
    state: str
    discharge_at: datetime | None


class RowOut(BaseModel):
    resource_type: str
    local_id: str
    status: str
    reason: str | None


class HandOut(BaseModel):
    admission_id: uuid.UUID
    rows: list[RowOut]
    counts: dict[str, dict[str, int]]


class PreviewItem(BaseModel):
    resource_type: str
    local_id: str
    held: bool
    reason: str | None
    resource: dict | None
    status: str | None                 # the ledger row's, when there is one
    last_error: str | None             # the platform's last words for it (may echo a value: audited read)


class PreviewOut(BaseModel):
    admission_id: uuid.UUID
    board_key: str
    environment: str
    items: list[PreviewItem]


def _cursor(row_updated_at: datetime, row_id: uuid.UUID) -> str:
    raw = f"{row_updated_at.isoformat()}|{row_id}".encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _uncursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode()
        at, row_id = raw.split("|")
        when = datetime.fromisoformat(at)
        if when.tzinfo is None:
            raise ValueError("no zone")
        return when, uuid.UUID(row_id)
    except (ValueError, binascii.Error, UnicodeDecodeError):
        raise refusal(422, TRES_CURSOR).http() from None


async def _settings(db: AsyncSession, tenant_id: uuid.UUID) -> TresSettings | None:
    return await db.get(TresSettings, tenant_id, populate_existing=True)


async def _stay(db: AsyncSession, tenant_id: uuid.UUID, admission_id: uuid.UUID) -> list[Admission]:
    chain = await chain_of(db, tenant_id, admission_id)
    if not chain:
        raise refusal(404, TRES_STAY_UNKNOWN).http()
    return chain


async def _key_of(db: AsyncSession, last: Admission) -> str:
    number = (await db.execute(select(Patient.patient_number).where(Patient.id == last.patient_id))).scalar_one()
    return board_key(last.protocol_no, number)


@router.get("/deliveries", response_model=DeliveriesOut)
async def list_deliveries(
    status: str | None = None,
    type: str | None = Query(default=None),       # noqa: A002 — the query parameter's name (spec §6)
    admission: uuid.UUID | None = None,
    environment: str | None = None,
    cursor: str | None = None,
    db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = Depends(caller_tenant_id),
    _user: User = Depends(require_permission("tres.manage")),
) -> DeliveriesOut:
    if (status is not None and status not in STATUSES) or (type is not None and type not in RESOURCE_TYPES) \
            or (environment is not None and environment not in ENVIRONMENTS):
        raise refusal(422, TRES_FILTER).http()
    settings = await _settings(db, caller_tenant)
    env = environment or (settings.environment if settings is not None else "test")
    query = (select(TresDelivery, Admission.protocol_no, Patient.patient_number)
             .outerjoin(Admission, Admission.id == TresDelivery.admission_id)
             .outerjoin(Patient, Patient.id == Admission.patient_id)
             .where(TresDelivery.tenant_id == caller_tenant, TresDelivery.environment == env))
    if status is not None:
        query = query.where(TresDelivery.status == status)
    if type is not None:
        query = query.where(TresDelivery.resource_type == type)
    if admission is not None:
        query = query.where(TresDelivery.admission_id == (await _stay(db, caller_tenant, admission))[-1].id)
    if cursor is not None:
        at, row_id = _uncursor(cursor)
        query = query.where(or_(TresDelivery.updated_at < at,
                                and_(TresDelivery.updated_at == at, TresDelivery.id < row_id)))
    rows = (await db.execute(query.order_by(TresDelivery.updated_at.desc(), TresDelivery.id.desc())
                             .limit(PAGE + 1))).all()
    items = [DeliveryOut(id=row.id, resource_type=row.resource_type, local_id=row.local_id, status=row.status,
                         reason=row.reason, attempts=row.attempts, operation=row.operation, remote_id=row.remote_id,
                         next_attempt_at=row.next_attempt_at, updated_at=row.updated_at,
                         admission_id=row.admission_id,
                         board_key=board_key(protocol, number) if number is not None else None)
             for row, protocol, number in rows[:PAGE]]
    last = rows[PAGE - 1][0] if len(rows) > PAGE else None
    return DeliveriesOut(environment=env, items=items,
                         session_refused_at=settings.session_refused_at if settings is not None else None,
                         next=_cursor(last.updated_at, last.id) if last is not None else None)


@router.get("/admissions", response_model=StayOut)
async def find_stay(
    key: str,
    db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = Depends(caller_tenant_id),
    _user: User = Depends(require_permission("tres.manage")),
) -> StayOut:
    key = key.strip()
    found = (await db.execute(
        select(Admission.id).join(Patient, Patient.id == Admission.patient_id)
        .where(Admission.tenant_id == caller_tenant,
               or_(Admission.protocol_no == key,
                   and_(Admission.protocol_no.is_(None), Patient.patient_number == key)))
        .order_by(Admission.created_at, Admission.id))).scalars().first()
    if found is None:
        raise refusal(404, TRES_STAY_UNKNOWN).http()
    last = (await _stay(db, caller_tenant, found))[-1]
    return StayOut(admission_id=last.id, board_key=await _key_of(db, last), state=last.state.value,
                   discharge_at=last.discharge_at if last.state == AdmissionState.DISCHARGED else None)


@router.get("/admissions/{admission_id}/preview", response_model=PreviewOut)
async def preview(
    admission_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = Depends(caller_tenant_id),
    user: User = Depends(require_permission("tres.manage")),
) -> PreviewOut:
    actor = user.username
    last = (await _stay(db, caller_tenant, admission_id))[-1]
    settings = await _settings(db, caller_tenant)
    environment = settings.environment if settings is not None else "test"
    stay = await request.app.state.tres_source.load(db, caller_tenant, last.id)
    sender = PreviewSender(db, tenant_id=caller_tenant, environment=environment)
    organization = getattr(settings, f"{environment}_organization_id", None) if settings is not None else None
    await run(stay, sender, organization_id=organization)
    ledger = {(row.resource_type, row.local_id): row for row in (await db.execute(select(TresDelivery).where(
        TresDelivery.tenant_id == caller_tenant, TresDelivery.environment == environment,
        TresDelivery.admission_id == last.id))).scalars()}
    items = []
    for item in sender.items:
        row = ledger.get((item["resource_type"], item["local_id"]))
        items.append(PreviewItem(**item, status=row.status if row else None, last_error=row.last_error if row else None))
    hospital = await trail.hospital_of(db, caller_tenant)
    await db.commit()
    trail.record(request, hospital, "tres.preview", patient_id=stay.board_key,
                 payload={"actor": actor, "admission_id": str(last.id)})
    return PreviewOut(admission_id=last.id, board_key=stay.board_key, environment=environment, items=items)


async def _hand(request: Request, db: AsyncSession, tenant_id: uuid.UUID, admission_id: uuid.UUID, *,
                force: bool) -> tuple[HandOut | None, str, str, uuid.UUID]:
    """A person's run of one stay's package: (the answer or None, the result code, the board key,
    the stay's last admission). Raises the refusals that ask nothing."""
    egress = bool(getattr(request.app.state, "tres_egress", False))
    if not egress:
        raise refusal(409, EGRESS_OFF).http()
    settings = await _settings(db, tenant_id)
    if settings is None or settings.mode == "off":
        raise refusal(409, TRES_OFF).http()
    account = account_of(settings)
    if account is None:
        raise refusal(409, TRES_ACCOUNT_INCOMPLETE).http()
    if live_closed(settings.environment, account.base_url):
        raise refusal(409, TRES_LIVE_CLOSED).http()
    last = (await _stay(db, tenant_id, admission_id))[-1]
    # Plain values: a rollback below expires every object this session holds.
    key, last_id = await _key_of(db, last), last.id
    factory = getattr(request.app.state, "tres_client_factory", None) or partial(
        open_client, egress=egress, hosts=getattr(request.app.state, "tres_hosts", frozenset()))
    try:
        # Patient data: the factory's default, `patient_data=True`, keeps egress.open_client's own live
        # lock behind the check above (amendment 24, M10) — it would answer the same 409 `tres_live_closed`.
        client = factory(account)
    except TresEgressRefused as exc:
        raise refusal(409, exc.code).http() from None
    except ValueError:
        raise refusal(409, TRES_ACCOUNT_INCOMPLETE).http() from None
    version, now = settings.updated_at, datetime.now(timezone.utc)
    sender = Sender(db, client, tenant_id=tenant_id, environment=settings.environment, mode=settings.mode,
                    now=now, enabled_types=settings.enabled_types or (), lock_timeout_ms=HAND_LOCK_TIMEOUT_MS)
    package = request.app.state.tres_source.package(db, settings, last_id, force=force)
    try:
        outcome = await package(sender)
    except LedgerBusy:
        await db.rollback()
        return None, TRES_BUSY, key, last_id
    except TresLoginRefused as exc:
        await db.rollback()
        await park(db, tenant_id=tenant_id, now=now, status=exc.status, version=version)
        return None, TRES_LOGIN_REFUSED, key, last_id
    except TresError:
        await db.rollback()
        return None, TRES_PLATFORM_UNAVAILABLE, key, last_id
    finally:
        await client.aclose()
    rows = [RowOut(resource_type=t, local_id=i, status=s, reason=r) for t, i, s, r in (outcome.rows if outcome else [])]
    return HandOut(admission_id=last_id, rows=rows, counts=outcome.counts() if outcome else {}), "sent", key, last_id


#: The status each result answers with.
_RESULT_STATUS = {TRES_BUSY: 409, TRES_LOGIN_REFUSED: 409, TRES_PLATFORM_UNAVAILABLE: 503}


async def _answer(request: Request, db: AsyncSession, tenant_id: uuid.UUID, event: str, payload: dict,
                  key: str, result: str, answer: HandOut | None) -> HandOut:
    hospital = await trail.hospital_of(db, tenant_id)
    await db.commit()
    payload = {**payload, "result": result, **({"counts": answer.counts} if answer is not None else {})}
    if event == "tres.send":
        trail.record(request, hospital, "tres.send", patient_id=key, payload=payload)
    else:
        trail.record(request, hospital, "tres.retry", patient_id=key, payload=payload)
    if answer is None:
        raise refusal(_RESULT_STATUS[result], result).http()
    return answer


@router.post("/admissions/{admission_id}/send", response_model=HandOut)
async def send_now(
    admission_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = Depends(caller_tenant_id),
    user: User = Depends(require_permission("tres.manage")),
) -> HandOut:
    actor = user.username
    answer, result, key, last_id = await _hand(request, db, caller_tenant, admission_id, force=False)
    return await _answer(request, db, caller_tenant, "tres.send", {"actor": actor, "admission_id": str(last_id)},
                         key, result, answer)


@router.post("/deliveries/{delivery_id}/retry", response_model=HandOut)
async def retry(
    delivery_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = Depends(caller_tenant_id),
    user: User = Depends(require_permission("tres.manage")),
) -> HandOut:
    actor = user.username
    row = (await db.execute(select(TresDelivery.admission_id).where(
        TresDelivery.id == delivery_id, TresDelivery.tenant_id == caller_tenant))).first()
    if row is None or row.admission_id is None:
        raise refusal(404, TRES_STAY_UNKNOWN).http()
    answer, result, key, last_id = await _hand(request, db, caller_tenant, row.admission_id, force=True)
    return await _answer(request, db, caller_tenant, "tres.retry",
                         {"actor": actor, "delivery_id": str(delivery_id), "admission_id": str(last_id)},
                         key, result, answer)

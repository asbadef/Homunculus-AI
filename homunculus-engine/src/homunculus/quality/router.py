# homunculus-engine/src/homunculus/quality/router.py
"""G4-03 «Kalite göstergeleri» (spec 2026-11-11 D4): `GET /quality?days=1|7|30`, for `quality.view`.

THE READS, in the caller's tenant (`caller_tenant_id`; the audit trail under the token's tenant slug, the `tenant`
every row of the trail carries):
1. the audit trail since `now − days`, the newest rows, capped as `/alarm-quality` is (READ_CAP, and one row more to
   know), of the episode kinds and the two acts (`indicators.QUALITY_KINDS`); `truncated` when the cap was hit, and
   then `window_from` is the oldest row kept rather than the period's start;
2. the units the caller reaches, with their names (`unitscope.unit_clause`: a bed grant names a bed, not its unit);
3. the board key → unit map for the keys those rows name (`units_of_keys`);
4. the handovers opened in the window, of those units.
The answer is `indicators.build_report`'s. The audit store is not joinable in SQL on every backend (Postgres in
production, a separate SQLite file in dev, memory in tests), so the map is built from the admissions table here.

`days=1` is the last 24 hours, as on `/alarm-quality`. The page reads it on open, on a period change and on
«Yenile» — never on a timer.
"""
from __future__ import annotations

import asyncio
import uuid
from collections.abc import Iterable
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission import unitscope
from homunculus.admission.boardkey import board_key
from homunculus.admission.models import Admission, Handover, Patient
from homunculus.api.app import ALARM_QUALITY_LIMIT_MAX
from homunculus.auth.dependencies import Principal, caller_tenant_id, get_principal, require_permission
from homunculus.auth.models import User
from homunculus.db import get_db
from homunculus.quality.indicators import QUALITY_KINDS, HandoverFacts, Reach, build_report
from homunculus.tenant.models import Site, Unit

#: G4-03 (spec D3): the Kalite göstergeleri's key.
QUALITY_VIEW = "quality.view"
#: The periods the page offers, in days (spec D4): the last 24 hours, 7 days, 30 days.
QUALITY_DAYS = (1, 7, 30)
#: The most audit rows one answer reads — the newest — as `/alarm-quality` reads them (G2-A2, D12).
READ_CAP = ALARM_QUALITY_LIMIT_MAX
#: The keys one look-up names: asyncpg takes at most 32767 parameters, and each key is named twice.
KEYS_PER_QUERY = 2000

router = APIRouter(tags=["quality"])


async def units_of_keys(db: AsyncSession, tenant_id: uuid.UUID, keys: Iterable[str]) -> dict[str, uuid.UUID]:
    """Spec D4 §3: each board key → the unit its admission was admitted to (`admitting_unit_id`, always the bed's
    unit), in this tenant. The key is the protocol number (admissions since 0015) or, for a legacy admission with
    none, the patient's H-number (`boardkey.board_key`). Every state counts: a past alarm's patient is usually
    discharged. A key with no admission here is left out, and so is one whose admissions name two units (a legacy
    patient admitted twice: ambiguous). Time-invariant while transfers stay closed — an admission's bed never
    changes (spec D6)."""
    wanted = sorted({key for key in keys if isinstance(key, str) and key})
    found: dict[str, set[uuid.UUID]] = {}
    for at in range(0, len(wanted), KEYS_PER_QUERY):
        chunk = wanted[at:at + KEYS_PER_QUERY]
        rows = (await db.execute(
            select(Admission.protocol_no, Patient.patient_number, Admission.admitting_unit_id)
            .join(Patient, Patient.id == Admission.patient_id)
            .where(Admission.tenant_id == tenant_id,
                   or_(Admission.protocol_no.in_(chunk),
                       and_(Admission.protocol_no.is_(None), Patient.patient_number.in_(chunk)))))).all()
        for protocol_no, number, unit_id in rows:
            found.setdefault(board_key(protocol_no, number), set()).add(unit_id)
    return {key: next(iter(units)) for key, units in found.items() if len(units) == 1}


@router.get("/quality")
async def get_quality(
    request: Request,
    days: int = 7,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission(QUALITY_VIEW)),
    principal: Principal = Depends(get_principal),
    caller_tenant: uuid.UUID = Depends(caller_tenant_id),
) -> dict:
    """G4-03 (spec D4): per unit, over the last `days` (1, 7 or 30; 422 otherwise) — alarm response, snoozes, RRT
    calls, handover countersignatures — and the unplaced and the hospital's sums, cut to the caller's units.
    Counts and times only: no patient key, no person, no free text."""
    if days not in QUALITY_DAYS:
        raise HTTPException(status_code=422, detail="days 1, 7 ya da 30 olmalı")
    audit = getattr(request.app.state, "audit", None)
    if audit is None:
        raise HTTPException(status_code=503, detail="denetim kaydı okunamıyor")
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=days)
    cap = READ_CAP
    # On a worker thread: up to READ_CAP rows from the store, and the ward's screens keep the event loop meanwhile.
    rows = await asyncio.to_thread(audit.records, tenant=principal.tenant, since=since, limit=cap + 1,
                                   newest=True, event_types=QUALITY_KINDS)
    truncated = len(rows) > cap
    kept = rows[1:] if truncated else rows
    window_from = kept[0].ts if truncated and kept else since.isoformat()

    scope = await unitscope.caller_scope(db, user.id, caller_tenant)
    within = unitscope.unit_clause(scope, unit_id=Unit.id)
    units = select(Unit.id, Unit.name).join(Site, Site.id == Unit.site_id).where(Site.tenant_id == caller_tenant)
    handovers = (select(Handover.unit_id, Handover.status, Handover.bridge_expires_at, Handover.outgoing_signed_at,
                        Handover.incoming_signed_at)
                 .join(Unit, Unit.id == Handover.unit_id)
                 .join(Site, Site.id == Unit.site_id)
                 .where(Site.tenant_id == caller_tenant, Handover.bridge_opened_at >= since))
    if within is not None:
        units, handovers = units.where(within), handovers.where(within)
    reach = Reach(units={unit_id: name for unit_id, name in (await db.execute(units)).all()},
                  scoped=not scope.unrestricted)
    key_units = await units_of_keys(db, caller_tenant, {rec.patient_id for rec in kept})
    facts = [HandoverFacts(*row) for row in (await db.execute(handovers)).all()]
    return build_report(records=kept, key_units=key_units, reach=reach, handovers=facts, now=now, days=days,
                        window_from=window_from, truncated=truncated)

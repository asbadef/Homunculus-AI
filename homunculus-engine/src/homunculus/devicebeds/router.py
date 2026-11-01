# homunculus-engine/src/homunculus/devicebeds/router.py
"""The monitor→bed editor's routes (spec §4.1), beside the strip they change: the list, bind and
unbind. People only (a JWT; a device token is 401), and only while the strip runs for the caller's
own hospital — at stage `shadow` or `rules`, the tenant's slug equal to INFINITY_SHADOW_HOSPITAL —
otherwise 409 `monitor_lane_off` (D15). Refusals carry a stable code (admission/errors.py)."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission import trail
from homunculus.admission.errors import MONITOR_LANE_OFF, Refusal
from homunculus.auth.dependencies import Principal, caller_tenant_id, get_principal, require_permission
from homunculus.auth.models import User
from homunculus.db import get_db
from homunculus.devicebeds import listing, service
from homunculus.devicebeds.schemas import BindBody, UnbindBody

router = APIRouter(prefix="/infinity-shadow/device-beds", tags=["device-beds"])


async def lane_hospital(request: Request, db: AsyncSession, tenant_id: uuid.UUID) -> str:
    """The caller's hospital key (its tenant's slug), or 409 `monitor_lane_off`. The free check (the
    strip runs at all) comes first, so a strip that is off costs no query."""
    refusal = Refusal(409, MONITOR_LANE_OFF, "The monitor strip is not running for this hospital.")
    settings = getattr(request.app.state, "shadow_settings", None)
    if settings is None or not settings.on:
        raise refusal.http()
    hospital = await trail.hospital_of(db, tenant_id)
    if hospital != settings.hospital:
        raise refusal.http()
    return hospital


@router.get("", summary="Monitors and the beds they sit at (the Monitörler screen's editor)")
async def device_beds(
    request: Request, db: AsyncSession = Depends(get_db), caller_tenant: uuid.UUID = Depends(caller_tenant_id),
    principal: Principal = Depends(get_principal),
    _user: User = Depends(require_permission("devices.manage", "devices.map_beds")),
) -> dict:
    await lane_hospital(request, db, caller_tenant)
    return await listing.build(request.app.state, db, caller_tenant, principal)


_MAP = require_permission("devices.map_beds")


@router.post("/bind", summary="Bind a monitor to a bed (a move or a replace included)")
async def bind(
    body: BindBody, request: Request, db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = Depends(caller_tenant_id), principal: Principal = Depends(get_principal),
    user: User = Depends(_MAP),
) -> dict:
    hospital = await lane_hospital(request, db, caller_tenant)
    return await service.change(request, db, caller_tenant, user, principal, hospital, service.Ask(
        body.source, body.bed_id, body.expected.device_row_id, body.expected.bed_row_id, body.confirm_occupied))


@router.post("/unbind", summary="Unbind a monitor: it stays in the list, on no bed")
async def unbind(
    body: UnbindBody, request: Request, db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = Depends(caller_tenant_id), principal: Principal = Depends(get_principal),
    user: User = Depends(_MAP),
) -> dict:
    hospital = await lane_hospital(request, db, caller_tenant)
    return await service.change(request, db, caller_tenant, user, principal, hospital, service.Ask(
        body.source, None, body.expected.device_row_id, None, body.confirm_occupied))

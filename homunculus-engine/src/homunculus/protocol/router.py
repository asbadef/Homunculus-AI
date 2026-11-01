# homunculus-engine/src/homunculus/protocol/router.py
"""Yönetim › Protokol ve etiket (G2-B1d, spec §3, D5, D6, D11): the next protocol number and the
label, per tenant. `structure.manage`, the caller's tenant only.

PUT reads the body first — twelve digits and at least 000000000001 (`protocol_format`, A-1), then
the dpi, the size and the fit (`label_dpi`, `label_size`, `label_too_narrow`; protocol/fit.py) — all
422, nothing written. Then it makes the tenant's row if there is none and LOCKS it (the lock an
admission's counter takes, protocol/numbers.py), and refuses a start number that is not greater than
the last one issued (`protocol_not_forward`, 409): lowering it back towards `last_issued + 1` is
allowed, no number is reused either way. Under the lock, an admission issuing a number at that
moment is waited for. The change is audited `protocol.settings` after the commit — who, the old and
new start number, the old and new label (A-26: never a 500 for a committed change). No patient
data."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission import trail
from homunculus.admission.errors import (
    LABEL_DPI, LABEL_SIZE, LABEL_TOO_NARROW, PROTOCOL_FORMAT, PROTOCOL_NOT_FORWARD, Refusal,
)
from homunculus.auth.dependencies import caller_tenant_id, require_permission
from homunculus.auth.models import User
from homunculus.db import get_db
from homunculus.protocol.fit import label_refusal
from homunculus.protocol.models import ProtocolSettings
from homunculus.protocol.numbers import format_protocol_no, parse_start_no
from homunculus.protocol.schemas import ProtocolSettingsIn, ProtocolSettingsOut

router = APIRouter(prefix="/admin/protocol-settings", tags=["protocol"])

#: What a tenant with no row reads: no start number, the default label (spec D6).
_DEFAULT_LABEL = (50, 30, 203)
_WORDS = {
    LABEL_DPI: "The printer resolution is 203 or 300 dpi.",
    LABEL_SIZE: "The label is 30–110 mm wide and 20–80 mm high.",
    LABEL_TOO_NARROW: "The barcode does not fit a label this narrow at this resolution.",
}


def _text(number: int | None) -> str | None:
    return None if number is None else format_protocol_no(number)


def _label(row: ProtocolSettings | None) -> tuple[int, int, int]:
    if row is None:
        return _DEFAULT_LABEL
    return row.label_width_mm, row.label_height_mm, row.printer_dpi


def _out(row: ProtocolSettings | None) -> ProtocolSettingsOut:
    width, height, dpi = _label(row)
    return ProtocolSettingsOut(
        configured=row is not None and row.next_no is not None,
        next_no=_text(row.next_no) if row is not None else None,
        last_issued=_text(row.last_issued) if row is not None else None,
        label_width_mm=width, label_height_mm=height, printer_dpi=dpi,
        updated_at=row.updated_at if row is not None else None)


@router.get("", response_model=ProtocolSettingsOut)
async def read_settings(
    db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = Depends(caller_tenant_id),
    _user: User = Depends(require_permission("structure.manage")),
) -> ProtocolSettingsOut:
    return _out(await db.get(ProtocolSettings, caller_tenant))


@router.put("", response_model=ProtocolSettingsOut)
async def write_settings(
    payload: ProtocolSettingsIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = Depends(caller_tenant_id),
    user: User = Depends(require_permission("structure.manage")),
) -> ProtocolSettingsOut:
    start = parse_start_no(payload.next_no)
    if start is None:
        raise Refusal(422, PROTOCOL_FORMAT, "The protocol number start is exactly twelve digits, "
                      "000000000001 or more.").http()
    refused = label_refusal(payload.label_width_mm, payload.label_height_mm, payload.printer_dpi)
    if refused is not None:
        raise Refusal(422, refused, _WORDS[refused]).http()

    actor, user_id = user.username, user.id
    await db.execute(insert(ProtocolSettings).values(tenant_id=caller_tenant)
                     .on_conflict_do_nothing(index_elements=["tenant_id"]))
    row = (await db.execute(
        select(ProtocolSettings).where(ProtocolSettings.tenant_id == caller_tenant)
        .with_for_update().execution_options(populate_existing=True))).scalar_one()
    if row.last_issued is not None and start <= row.last_issued:
        await db.rollback()
        raise Refusal(409, PROTOCOL_NOT_FORWARD, "The next protocol number must be greater than "
                      "the last one issued.").http()
    before = (_text(row.next_no), list(_label(row)))
    row.next_no = start
    row.label_width_mm, row.label_height_mm = payload.label_width_mm, payload.label_height_mm
    row.printer_dpi = payload.printer_dpi
    row.updated_at, row.updated_by = datetime.now(timezone.utc), user_id
    answer = _out(row)
    hospital = await trail.hospital_of(db, caller_tenant)
    await db.commit()
    trail.record(request, hospital, "protocol.settings", payload={
        "actor": actor, "next_no": [before[0], answer.next_no],
        "label": [before[1], [answer.label_width_mm, answer.label_height_mm, answer.printer_dpi]]})
    return answer

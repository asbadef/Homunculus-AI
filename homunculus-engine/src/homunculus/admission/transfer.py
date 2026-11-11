# homunculus-engine/src/homunculus/admission/transfer.py
"""Group 2 · B1b — what a transfer needs beside its route (spec 2026-11-09 §5.4, §5.5).

* `unit_of`     the bed's real unit, its room's (A-12, T2) — never a unit a body names;
* `move_card`   the patient's card moved to the bed she now lies in, after the commit (D3): through
                the app's BoardLink, answering `ok` or `failed`, never raising.

The card is built from plain values taken before the commit, never from the session: a failure
after a commit may have expired it. A card carries the patient's name, as every `kabul` record does
(the identity store keeps it encrypted); nothing here logs or audits it — a log line names the
board key alone."""
from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timezone

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission.boardlink import board_link_of, kabul_record
from homunculus.admission.schemas import EngineWrite
from homunculus.api.patient_identity import IdentityRecord
from homunculus.tenant.models import Bed, Room

log = logging.getLogger(__name__)


async def unit_of(db: AsyncSession, bed_id: uuid.UUID) -> uuid.UUID:
    """The bed's real unit: its room's (A-12, T2)."""
    return (await db.execute(select(Room.unit_id).join(Bed, Bed.room_id == Room.id)
                             .where(Bed.id == bed_id))).scalar_one()


def _record(card: dict) -> IdentityRecord:
    """The card as the identity store keeps it (`kabul_record`), stamped now — built as the
    admission route's `_card` builds an admission's."""
    return kabul_record(patient_number=card["key"], display_name=card["display_name"],
                        birth_date=date.fromisoformat(card["date_of_birth"]), sex=card["sex"],
                        bed_label=card["bed_label"], bed_id=str(card["bed_id"]),
                        unit_id=str(card["unit_id"]), at=datetime.now(timezone.utc))


async def move_card(request: Request, hospital: str, card: dict) -> EngineWrite:
    """The card on the patient's new bed (D3): `ok`, or `failed` and logged with the board key —
    never a name, and never raising. An app built without its BoardLink moved nothing: `failed`,
    logged at ERROR (X53)."""
    link = board_link_of(request)
    if link is None:
        log.error("transfer %s: this app has no BoardLink; the card did not move", card["key"])
        return "failed"
    try:
        await link.put_identity(hospital, _record(card))
    except Exception:
        log.exception("transfer %s: the card did not move to its new bed", card["key"])
        return "failed"
    return "ok"

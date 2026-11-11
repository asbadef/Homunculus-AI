# homunculus-engine/src/homunculus/admission/transfer.py
"""Group 2 · B1b — what a transfer needs beside its route (spec 2026-11-09 §5.4, §5.5).

* `unit_of`      the bed's real unit, its room's (A-12, T2) — never a unit a body names;
* `card_of`      the card of an admission's place, as plain values: its board key, the H-number,
                 the name, birth date and sex, and its bed and real unit;
* `arriving_of`  the admission a transfer from this one opened (the retry's question, T9);
* `where_now`    the patient's admission now, from a TRANSFERRED one of hers: `source_admission_id`
                 followed forward (the bed release's question, §5.5), answered as its id, its
                 state, its board key and its H-number — no name is read, no column decrypted;
* `move_card`    the card moved to the bed she now lies in, the old place told first
                 (`BoardLink.move`, T8): `ok` or `failed`, never raising.

The card is built from plain values taken before the commit, or read here before the board step,
never from objects a failure after a commit may have expired. A card carries the patient's name,
as every `kabul` record does (the identity store keeps it encrypted); nothing here logs or audits
it — a log line names the board key alone."""
from __future__ import annotations

import logging
import uuid
from typing import NamedTuple

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission.boardkey import board_key
from homunculus.admission.boardlink import board_link_of, card_record
from homunculus.admission.models import Admission, AdmissionState, Patient
from homunculus.admission.schemas import EngineWrite
from homunculus.tenant.models import Bed, Room

log = logging.getLogger(__name__)

#: How far `where_now` follows one stay's moves. A ward never moves one patient this often in a
#: stay, and a chain that goes on (a row written wrong by hand) ends here instead of looping.
_MOST_MOVES = 64


async def unit_of(db: AsyncSession, bed_id: uuid.UUID) -> uuid.UUID:
    """The bed's real unit: its room's (A-12, T2)."""
    return (await db.execute(select(Room.unit_id).join(Bed, Bed.room_id == Room.id)
                             .where(Bed.id == bed_id))).scalar_one()


async def card_of(db: AsyncSession, admission_id: uuid.UUID) -> dict:
    """The card of an admission's place, as plain values: `key` (`board_key`: its protocol, a
    legacy admission's H-number), `patient_number`, the name, birth date and sex, the bed's id and
    label, and its real unit."""
    (protocol_no, number, name, born, sex, bed_id, label, unit_id) = (await db.execute(
        select(Admission.protocol_no, Patient.patient_number, Patient.display_name,
               Patient.date_of_birth, Patient.sex, Bed.id, Bed.label, Room.unit_id)
        .select_from(Admission)
        .join(Patient, Patient.id == Admission.patient_id)
        .join(Bed, Bed.id == Admission.bed_id)
        .join(Room, Room.id == Bed.room_id)
        .where(Admission.id == admission_id))).one()
    return {"key": board_key(protocol_no, number), "patient_number": number,
            "display_name": name, "date_of_birth": born, "sex": sex, "bed_label": label,
            "bed_id": bed_id, "unit_id": unit_id}


async def arriving_of(db: AsyncSession, admission_id: uuid.UUID) -> Admission | None:
    """The admission a transfer from this one opened (its `source_admission_id` is this one), or
    None."""
    return (await db.execute(
        select(Admission).where(Admission.source_admission_id == admission_id)
        .order_by(Admission.created_at.desc()).limit(1))).scalar_one_or_none()


class ChainEnd(NamedTuple):
    """Where a stay's chain of moves ends (`where_now`): the admission's id and state, the key its
    card stands under (`board_key`) and its H-number — what the bed release asks of a patient who
    moved, before it decides whether her card is one to move at all."""
    admission_id: uuid.UUID
    state: AdmissionState
    key: str
    patient_number: str


async def where_now(db: AsyncSession, admission_id: uuid.UUID) -> ChainEnd | None:
    """The patient's admission now, from a TRANSFERRED one of hers: `source_admission_id` followed
    forward to the first row that is not TRANSFERRED — open, or DISCHARGED since. None when the
    chain breaks off (a transfer the closed routes left half done). Reads the id, the state, the
    protocol and the H-number only: the name, birth date and sex (encrypted) are `card_of`'s, read
    for a card that is going to be moved."""
    current = admission_id
    for _ in range(_MOST_MOVES):
        found = (await db.execute(
            select(Admission.id, Admission.state, Admission.protocol_no, Patient.patient_number)
            .join(Patient, Patient.id == Admission.patient_id)
            .where(Admission.source_admission_id == current)
            .order_by(Admission.created_at.desc()).limit(1))).first()
        if found is None:
            return None
        if found.state != AdmissionState.TRANSFERRED:
            return ChainEnd(found.id, found.state, board_key(found.protocol_no,
                                                             found.patient_number),
                            found.patient_number)
        current = found.id
    return None


async def move_card(request: Request, hospital: str, card: dict, *,
                    left: tuple[uuid.UUID, uuid.UUID | None]) -> EngineWrite:
    """The card on the patient's new bed, the old place told first (`BoardLink.move`, T8): `ok`,
    or `failed` and logged with the board key — never a name, and never raising. `left` is the
    old bed's id and its unit's, which may be None: it goes to the removal frame as None, never as
    the text "None". An app built without its BoardLink moved nothing: `failed`, logged at ERROR
    (X53)."""
    link = board_link_of(request)
    if link is None:
        log.error("transfer %s: this app has no BoardLink; the card did not move", card["key"])
        return "failed"
    try:
        record = card_record(key=card["key"], display_name=card["display_name"],
                             date_of_birth=card["date_of_birth"], sex=card["sex"],
                             bed_label=card["bed_label"], bed_id=card["bed_id"],
                             unit_id=card["unit_id"])
    except Exception:
        log.exception("transfer %s: the card could not be built", card["key"])
        return "failed"
    old_bed, old_unit = left
    return await link.move(hospital, record, left=(str(old_bed),
                                                   None if old_unit is None else str(old_unit)))

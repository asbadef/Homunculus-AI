# homunculus-engine/src/homunculus/protocol/numbers.py
"""The protocol number (Group 2 · B1d, spec D1, D3, D5 and §3).

Twelve digits, all of them sequence, no check digit (D3): a single mistyped digit can give a
neighbour's valid number, so the name the device shows is the only safeguard — a found number is
always answered with the name (api/edge_query.py). One sequence per tenant, started where the
administrator says (`protocol_settings.next_no`, D5) and only ever moved forward.

It is taken with one UPDATE … RETURNING inside the admission's own transaction, as
admission/numbers.py takes the H-number: the settings row stays locked until that transaction ends,
so two admissions never share a number, and an admission that is refused or rolled back gives its
number back — the sequence has no gaps. Every admission takes this lock BEFORE the H-number's
counter, in that one order, so two admissions never wait on each other in a circle.
"""
from __future__ import annotations

import re
import uuid

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission.errors import PROTOCOL_EXHAUSTED, PROTOCOL_NOT_CONFIGURED, Refusal
from homunculus.protocol.models import ProtocolSettings

PROTOCOL_MAX = 999_999_999_999
#: Twelve ASCII digits — never `\d`, which takes any script's digits; the device sends ASCII.
_TWELVE = re.compile(r"[0-9]{12}")


def format_protocol_no(number: int) -> str:
    """The number on twelve digits, zero-padded."""
    return f"{number:012d}"


def parse_protocol_no(text: object) -> int | None:
    """The number twelve ASCII digits spell, or None for anything else (a string of another length,
    another script's digits, white space, not a string at all)."""
    if not isinstance(text, str) or not _TWELVE.fullmatch(text):
        return None
    return int(text)


async def next_protocol_no(db: AsyncSession, tenant_id: uuid.UUID) -> str:
    """The tenant's next protocol number. Call it inside the transaction that writes the admission:
    the settings row stays locked until that transaction commits or rolls back.

    No row, or no start number (`next_no` NULL): 409 `protocol_not_configured` (D5). A number past
    `PROTOCOL_MAX`: 409 `protocol_exhausted`, and the caller's rollback gives the row back as it
    was."""
    issued = (await db.execute(
        update(ProtocolSettings)
        .where(ProtocolSettings.tenant_id == tenant_id, ProtocolSettings.next_no.is_not(None))
        .values(last_issued=ProtocolSettings.next_no, next_no=ProtocolSettings.next_no + 1)
        .returning(ProtocolSettings.last_issued)
        .execution_options(synchronize_session=False)
    )).scalar_one_or_none()
    if issued is None:
        raise Refusal(409, PROTOCOL_NOT_CONFIGURED,
                      "No protocol number start is set: the administrator sets it in "
                      "Administration › Protocol and label before the first admission.")
    if issued > PROTOCOL_MAX:
        raise Refusal(409, PROTOCOL_EXHAUSTED,
                      f"No protocol number is left: {PROTOCOL_MAX} has been issued.")
    return format_protocol_no(issued)

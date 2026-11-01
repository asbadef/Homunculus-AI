# homunculus-engine/src/homunculus/devicebeds/writes.py
"""Yapı's two hooks into the mapping (spec D18, §4.10), called by `tenant/router.py` `patch_bed`
inside its transaction, after its unit and bed locks (the bind route takes the same bed lock,
`tenant.router._lock_bed`, so a bind and a Yapı write on one bed run one after the other — A-22 race
h). The bed's current bound row is read through `rows.current_rows`, the one reader of current
rows (A-19), `FOR UPDATE`.

* `refuse_close_if_bound` (O7): a bed with a monitor bound is not closed — 409 `bed_has_monitor`;
  the screen sends the user to «Monitörler» to unbind first.
* `relabel_bed` (O3): a rename that changes the label closes the bound row at the database's `t`
  and opens the same device on the same bed under the new label (`method` editor), so the strip
  follows renames. It is a close and an insert, never an UPDATE of the label: 0014's trigger
  allows nothing else (A-8). A label-only row (v2's BED01: a label, no bed) is no Yapı bed's and is
  never touched — it has no `bed_id` to be found by."""
from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission.errors import BED_HAS_MONITOR, Refusal
from homunculus.devicebeds.models import DeviceBed
from homunculus.devicebeds.rows import current_rows, db_time, editor_row


async def _bound_row(db: AsyncSession, tenant_id: uuid.UUID, bed_id: uuid.UUID) -> DeviceBed | None:
    """The bed's current row, locked — at most one: `uq_device_beds_current_bed`."""
    return next(iter((await current_rows(db, tenant_id, bed_ids=[bed_id], lock=True)).values()), None)


async def refuse_close_if_bound(db: AsyncSession, tenant_id: uuid.UUID, bed_id: uuid.UUID) -> None:
    if await _bound_row(db, tenant_id, bed_id) is not None:
        raise Refusal(409, BED_HAS_MONITOR,
                      "A monitor is bound to this bed; unbind it on the Monitors screen first.").http()


async def relabel_bed(db: AsyncSession, tenant_id: uuid.UUID, bed_id: uuid.UUID, label: str,
                      user) -> tuple[DeviceBed, DeviceBed] | None:
    """(closed row, new row), or None when no monitor is bound or its row already says `label`. The
    close is flushed before the insert, so the partial unique indexes never see two current rows."""
    row = await _bound_row(db, tenant_id, bed_id)
    if row is None or row.bed_label == label:
        return None
    t = await db_time(db)
    row.valid_to = t
    await db.flush()
    new = editor_row(tenant_id, row.source, row.group_address, row.port, row.device_bed_label,
                     label, row.bed_id, row.unit_id, t, user)
    db.add(new)
    await db.flush()
    return row, new

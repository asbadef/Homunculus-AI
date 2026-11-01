# homunculus-engine/src/homunculus/devicebeds/rows.py
"""A `device_beds` row as the strip's `Row` (spec §5.3's mapping table): `group_address` → `group`,
`bed_id`/`unit_id` as their text, times in UTC; the one reader of a tenant's CURRENT rows (the list
and the bind/unbind transaction both read through `current_rows`, A-19); the database's time; and
the rows the editor opens. Task 12 adds Yapı's relabel on top of these."""
from __future__ import annotations

import uuid
from collections.abc import Iterable
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.api.infinity_device_beds import Row
from homunculus.devicebeds.models import DeviceBed


def utc(moment: datetime | None) -> datetime | None:
    return None if moment is None else moment.astimezone(timezone.utc)


def iso_utc(moment: datetime) -> str:
    """An instant as an editor row's `verified_at` (D21): ISO-8601 with `+00:00`."""
    return moment.astimezone(timezone.utc).isoformat()


def to_row(r: Any) -> Row:
    """A `DeviceBed`, or a mapping row with the same column names, as a `Row`. The ids are built as
    `str(uuid)` (lower-case, hyphenated), never left a `uuid.UUID`: `rows_digest` and `check_current`
    read them as text, as the strip does (A-9)."""
    get = (lambda name: r[name]) if hasattr(r, "keys") else (lambda name: getattr(r, name))
    bed_id, unit_id = get("bed_id"), get("unit_id")
    return Row(get("source"), get("group_address"), get("port"), get("bed_label"),
               None if bed_id is None else str(bed_id), None if unit_id is None else str(unit_id),
               get("method"), get("verified_at"), utc(get("valid_from")), utc(get("valid_to")), get("note"))


async def current_rows(db: AsyncSession, tenant_id: uuid.UUID, *, sources: Iterable[str] | None = None,
                       bed_ids: Iterable[uuid.UUID] | None = None, lock: bool = False) -> dict[str, DeviceBed]:
    """The tenant's CURRENT rows (`valid_to IS NULL`) by source, in id order — the one reader of them
    (A-19): the list reads all of them; the transaction reads those of one device and one bed.

    `sources` / `bed_ids` narrow the read to the rows of those devices OR on those beds (an empty list
    matches nothing; None, both of them, means every current row). `lock` takes `FOR UPDATE` on what
    is read — rows are locked in the id order they come back in, so two transactions over the same
    rows queue instead of deadlocking. The rows are always refreshed from the database
    (`populate_existing`): a value committed after an earlier load in this session is seen, and a
    row read under a lock is the row as it is now."""
    stmt = select(DeviceBed).where(DeviceBed.tenant_id == tenant_id, DeviceBed.valid_to.is_(None))
    narrow = []
    if sources is not None:
        narrow.append(DeviceBed.source.in_(list(sources)))
    if bed_ids is not None:
        narrow.append(DeviceBed.bed_id.in_(list(bed_ids)))
    if narrow:
        stmt = stmt.where(or_(*narrow))
    stmt = stmt.order_by(DeviceBed.id).execution_options(populate_existing=True)
    if lock:
        stmt = stmt.with_for_update()
    return {row.source: row for row in (await db.execute(stmt)).scalars().all()}


async def db_time(db: AsyncSession) -> datetime:
    """`t` (spec §4.4): the database's own clock, `clock_timestamp()`, in UTC. Read once, after the
    locks, so it is later than the `valid_from` of every row the change closes."""
    return (await db.execute(select(func.clock_timestamp()))).scalar_one().astimezone(timezone.utc)


def editor_row(tenant_id: uuid.UUID, source: str, group: str, port: int, device_bed_label: str | None,
               bed_label: str | None, bed_id: uuid.UUID | None, unit_id: uuid.UUID | None,
               t: datetime, user) -> DeviceBed:
    """A row the editor (or Yapı's relabel) opens at `t` (spec §5.3, D21): `method` editor,
    `verified_at` = `t` in UTC ISO, `verified_by` = the user's id, approved by the user at `t`."""
    return DeviceBed(tenant_id=tenant_id, source=source, group_address=group, port=port,
                     device_bed_label=device_bed_label, bed_label=bed_label, bed_id=bed_id, unit_id=unit_id,
                     method="editor", verified_at=iso_utc(t), verified_by=user.id, note=None,
                     valid_from=t, valid_to=None, approved_by=user.username, approved_at=t)


def brief(row: DeviceBed | None) -> dict | None:
    """A row as an audit payload names it (spec §4.7): no patient, no free text."""
    if row is None:
        return None
    return {"row_id": row.id, "bed_id": None if row.bed_id is None else str(row.bed_id),
            "unit_id": None if row.unit_id is None else str(row.unit_id), "bed_label": row.bed_label}

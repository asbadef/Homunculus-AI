# homunculus-engine/src/homunculus/devicebeds/rows.py
"""A `device_beds` row as the strip's `Row` (spec §5.3's mapping table): `group_address` → `group`,
`bed_id`/`unit_id` as their text, times in UTC. Tasks 9 and 12 add the write helpers here."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from homunculus.api.infinity_device_beds import Row


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

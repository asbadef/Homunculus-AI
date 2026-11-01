# homunculus-engine/src/homunculus/devicebeds/listing.py
"""`GET /infinity-shadow/device-beds`'s body (spec §4.2). Devices: the worker's (the strip's store)
∪ the tenant's current rows, ordered by address. Identity from the worker when it reports the device,
else from its row; a bed named only when the caller's scope reaches it. No patient anywhere. The
current rows come from `rows.current_rows`, the reader the bind/unbind transaction locks through too
(A-19)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission import unitscope
from homunculus.api.infinity_device_beds import PORT
from homunculus.auth.dependencies import Principal
from homunculus.devicebeds.rows import current_rows
from homunculus.tenant.models import Bed, Room, Site, Unit

UNSEEN = (None, "unknown")


def _iso(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat()


def _address(source: str) -> tuple[tuple[int, ...], str]:
    """The sort key: the octets as numbers (`.9` before `.11` before `.100`). A source that is not
    dotted decimal (the column is free text; the import and the store check it, nothing else does)
    sorts last, by its text, rather than turning the whole list into a 500."""
    parts = source.split(".")
    if all(part.isascii() and part.isdigit() for part in parts):
        return tuple(int(part) for part in parts), source
    return (999,), source


async def bed_places(db: AsyncSession, tenant_id: uuid.UUID, bed_ids) -> dict[uuid.UUID, tuple[str, str, str, uuid.UUID]]:
    """Each bed's (label, room name, unit name, unit id) — the structure's current names. A bed has no
    `tenant_id` of its own (A-8): it is this tenant's only through its room, unit and site, so the
    join ends at `Site.tenant_id`, and a bed of another tenant is simply absent from the answer."""
    if not bed_ids:
        return {}
    rows = (await db.execute(select(Bed.id, Bed.label, Room.name, Unit.name, Unit.id)
                             .join(Room, Room.id == Bed.room_id).join(Unit, Unit.id == Room.unit_id)
                             .join(Site, Site.id == Unit.site_id)
                             .where(Bed.id.in_(list(bed_ids)), Site.tenant_id == tenant_id))).all()
    return {r[0]: (r[1], r[2], r[3], r[4]) for r in rows}


async def build(state, db: AsyncSession, tenant_id: uuid.UUID, principal: Principal) -> dict:
    settings, now = state.shadow_settings, state.shadow_clock()
    views = state.shadow_store.devices(now)
    rows = await current_rows(db, tenant_id)
    places = await bed_places(db, tenant_id, {r.bed_id for r in rows.values() if r.bed_id})
    everything = "structure.manage" in principal.perms
    scope = None if everything else await unitscope.caller_scope(db, principal.user.id, tenant_id)
    can_bind = "devices.map_beds" in principal.perms
    devices = []
    for source in sorted(set(views) | set(rows), key=_address):
        view, row = views.get(source), rows.get(source)
        bed = None
        if row is not None and row.bed_id is not None:
            place = places.get(row.bed_id)
            if place is None:                  # not this tenant's bed (or gone): no names, not editable
                bed = {"id": str(row.bed_id), "in_scope": False}
            else:
                label, room, unit, unit_id = place
                reached = scope is None or unitscope.reaches(scope, unit_id=unit_id, bed_id=row.bed_id)
                bed = ({"id": str(row.bed_id), "in_scope": True, "label": label, "room": room, "unit": unit}
                       if reached else {"id": str(row.bed_id), "in_scope": False})
        devices.append({
            "source": source,
            "group": view.group if view is not None else row.group_address,
            "port": PORT,
            "device_bed_label": row.device_bed_label if row is not None else None,
            "seen": view is not None and view.status not in UNSEEN,
            "status": view.status if view is not None else None,
            "last_seen_at": _iso(now - view.status_age_s) if view is not None else None,
            "row_id": row.id if row is not None else None,
            "bed": bed,
            "editable": can_bind and (bed is None or bed["in_scope"]),
        })
    return {"stage": "rules" if settings.rules else "shadow", "generated_at": _iso(now),
            "can_bind": can_bind, "devices": devices}

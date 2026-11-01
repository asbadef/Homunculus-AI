# homunculus-engine/tests/esleme_world.py
"""The monitor→bed editor's route-test world: kabul_world's ward + a biomedical user, the strip on
(stage `shadow` or `rules`) for the ward's hospital with PostgresDeviceBeds behind it, the worker's
devices in the store, and seeded `device_beds` rows. Synthetic everything.

    beds   1, 2, 10 (Otaq 1) and 3 (Otaq 2) in Reanimasiya — the charge nurse's unit
           N1 (N-1) in Neonatal — not hers
    users  admin (hospital_admin), charge (charge_nurse: devices.map_beds, board.view),
           nurse (no key), bio (biomedical: devices.manage only)
"""
from __future__ import annotations

import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from homunculus.api.app import create_app
from homunculus.api.audit import InMemoryAuditLog
from homunculus.api.device_beds_postgres import PostgresDeviceBeds
from homunculus.api.infinity_shadow import SCHEMA, ShadowSettings
from homunculus.auth.groups import ensure_default_groups
from homunculus.db import get_db
from homunculus.devicebeds.models import DeviceBed
from tests.conftest import TEST_DATABASE_URL
from tests.kabul_world import DEVICE, SLUG, Ward, build_ward
from tests.signed_in import add_user, bearer

TOKEN = "e" * 40
SOURCES = ("192.0.2.11", "192.0.2.12", "192.0.2.13")
UNIT_OF = {"1": "rea", "2": "rea", "10": "rea", "3": "rea", "N1": "neo"}
FROM = datetime(2026, 10, 19, tzinfo=timezone.utc)
APPROVED = datetime(2026, 10, 27, tzinfo=timezone.utc)
URL = "/infinity-shadow/device-beds"


def group_of(source: str) -> str:
    return "224.0.2." + source.rsplit(".", 1)[1]


def readings(sources, now: float) -> dict:
    """A forwarder body reporting `sources` streaming, with no readings (the editor needs presence)."""
    return {"schema": SCHEMA, "sent_at": now,
            "forwarder": {"interval_s": 5, "sent": 1, "failed": 0, "decoder": None},
            "hub": {"collector_age_s": 1.0, "accepted_packets": 1, "old_or_duplicate_packets": 0},
            "devices": [{"source": s, "group": group_of(s), "port": 2050, "status": "streaming",
                         "packet_age_ms": 100.0, "readings": []} for s in sources]}


async def seed(db: AsyncSession, ward: Ward, *rows: tuple[str, str | None, str | None]) -> dict[str, int]:
    """Current rows `(source, bed key or None, label or None)`, as the import would leave them."""
    ids = {}
    for source, bed_key, label in rows:
        bed = ward.beds[bed_key] if bed_key else None
        row = DeviceBed(tenant_id=ward.tenant.id, source=source, group_address=group_of(source), port=2050,
                        device_bed_label=label, bed_label=label, bed_id=bed.id if bed else None,
                        unit_id=ward.units[UNIT_OF[bed_key]].id if bed else None,
                        method="central_station_list" if label else None,
                        verified_at="2026-09-22" if label else None,
                        note=None if label else "atanmamış", valid_from=FROM,
                        approved_by="proje sahibi", approved_at=APPROVED)
        db.add(row)
        await db.flush()
        ids[source] = row.id
    await db.commit()
    return ids


@asynccontextmanager
async def esleme_client(db: AsyncSession, *, stage: str = "shadow", hospital: str = SLUG,
                        sources=SOURCES) -> AsyncIterator[tuple[AsyncClient, object, Ward]]:
    ward = await build_ward(db)
    groups = await ensure_default_groups(db, ward.tenant.id)
    bio = await add_user(db, username="bio@kabul.example.com", tenant_id=ward.tenant.id, group=groups["biomedical"])
    await db.commit()
    ward.users["bio"], ward.auth["bio"] = bio, await bearer(db, bio)
    settings = (ShadowSettings() if stage == "off" else
                ShadowSettings(stage, stage, None, TOKEN, hospital, parameters=("hr",) if stage == "rules" else ()))
    app = create_app({DEVICE: SLUG}, run_escalation_loop=False, shadow=settings, audit=InMemoryAuditLog(),
                     device_beds=PostgresDeviceBeds(TEST_DATABASE_URL, hospital=SLUG))
    maker = async_sessionmaker(db.bind, expire_on_commit=False)

    async def _db():
        async with maker() as session:
            yield session

    app.dependency_overrides[get_db] = _db
    if settings.on:
        app.state.shadow_store.ingest(readings(sources, time.time()))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client, app, ward

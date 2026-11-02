# homunculus-engine/tests/kabul_world.py
"""A ward for the Hasta Kabul route tests (Group 2 · B1a): one tenant with its default groups, two
units and five beds, staff in the groups the spec names with their unit grants (the tenant's own
UUIDs, spec D9), signed-in tokens for each, and a client on an app whose device token reads that
tenant's board (the engine's hospital key is the tenant slug). Synthetic everything.

    Ana bina
      Reanimasiya (ADULT_ICU)   Otaq 1: beds 1, 2, 10      Otaq 2: bed 3
      Neonatal (NICU)           N-1: bed N1

    admin      hospital_admin   unrestricted by role
    nurse      nurse            granted Reanimasiya
    nurse_b    nurse            granted Neonatal
    charge     charge_nurse     granted Reanimasiya
    doctor     attending        granted Reanimasiya
    auditor    auditor          no admission right at all
"""
from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from homunculus.api.app import create_app
from homunculus.auth.groups import ensure_default_groups
from homunculus.auth.models import User
from homunculus.db import get_db
from homunculus.scope.models import StaffScope
from homunculus.tenant.models import Bed, Room, Site, Tenant, Unit, UnitType
from tests.signed_in import add_user, bearer

SLUG = "kabul-hastane"
DEVICE = "kabul-device-token"
BOARD = {"Authorization": f"Bearer {DEVICE}"}


@dataclass
class Ward:
    tenant: Tenant
    site: Site
    units: dict[str, Unit]
    rooms: dict[str, Room]
    beds: dict[str, Bed]
    users: dict[str, User]
    auth: dict[str, dict[str, str]]


async def build_ward(db: AsyncSession) -> Ward:
    tenant = Tenant(name="Sentetik Kabul Hastanesi", slug=SLUG, country_code="AZ")
    db.add(tenant)
    await db.flush()
    groups = await ensure_default_groups(db, tenant.id)
    site = Site(tenant_id=tenant.id, name="Ana bina")
    db.add(site)
    await db.flush()
    units = {"rea": Unit(site_id=site.id, name="Reanimasiya", unit_type=UnitType.ADULT_ICU),
             "neo": Unit(site_id=site.id, name="Neonatal", unit_type=UnitType.NICU)}
    db.add_all(units.values())
    await db.flush()
    rooms = {"o1": Room(unit_id=units["rea"].id, name="Otaq 1"),
             "o2": Room(unit_id=units["rea"].id, name="Otaq 2"),
             "n1": Room(unit_id=units["neo"].id, name="N-1")}
    db.add_all(rooms.values())
    await db.flush()
    beds = {"1": Bed(room_id=rooms["o1"].id, label="1"), "2": Bed(room_id=rooms["o1"].id, label="2"),
            "10": Bed(room_id=rooms["o1"].id, label="10"), "3": Bed(room_id=rooms["o2"].id, label="3"),
            "N1": Bed(room_id=rooms["n1"].id, label="N1")}
    db.add_all(beds.values())
    await db.flush()

    staff = {"admin": ("hospital_admin", None), "nurse": ("nurse", "rea"),
             "nurse_b": ("nurse", "neo"), "charge": ("charge_nurse", "rea"),
             "doctor": ("attending", "rea"), "auditor": ("auditor", None)}
    users: dict[str, User] = {}
    for name, (group, unit) in staff.items():
        users[name] = await add_user(db, username=f"{name}@kabul.example.com",
                                     tenant_id=tenant.id, group=groups[group])
        if unit is not None:
            db.add(StaffScope(tenant_id=tenant.id, user_id=users[name].id,
                              unit_id=str(units[unit].id)))
    await db.commit()
    auth = {name: await bearer(db, user) for name, user in users.items()}
    return Ward(tenant=tenant, site=site, units=units, rooms=rooms, beds=beds, users=users, auth=auth)


def ward_app() -> FastAPI:
    """The app with a device token for the ward's tenant: `BOARD` reads its board."""
    return create_app({DEVICE: SLUG}, run_escalation_loop=False)


@asynccontextmanager
async def ward_client(db: AsyncSession) -> AsyncIterator[tuple[AsyncClient, FastAPI]]:
    app = ward_app()
    maker = async_sessionmaker(db.bind, expire_on_commit=False)

    async def _db():
        async with maker() as session:
            yield session

    app.dependency_overrides[get_db] = _db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client, app

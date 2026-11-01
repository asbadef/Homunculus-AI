# homunculus-engine/tests/esleme_v2.py
"""A tenant whose one unit and twelve beds carry the committed v2 table's UUIDs (spec §6, the
parity fixture): «Reanimasiya» with rooms «Otaq NN», one bed «bedNN» each — lower-case, as v2's
notes record the Yapı labels (O60). The default groups, so `charge_nurse` exists. Synthetic names.

By default the tenant is one SEEDED BEFORE THIS SLICE (`preslice=True`): none of its groups holds
`devices.map_beds`, which is the lane hospital's real state (spec §4.6, O11). `ensure_default_groups`
alone would give the key to `charge_nurse` and, as a row, to the system group `hospital_admin`, because
the key is now in `DEFAULT_GROUPS` — that is what a tenant created from now on holds, and
`preslice=False` builds it."""
from __future__ import annotations

import uuid
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.auth.groups import ensure_default_groups
from homunculus.tenant.models import Bed, Room, Site, Tenant, Unit, UnitType

V2 = Path(__file__).resolve().parents[2] / "deploy" / "infinity" / "device-beds.icu2.json"
V2_DIGEST = "e470d3342025100ad3dce0e6e42606aa37051d18f4bcac8f02a5abfa3b3b79af"
GRANT_KEY, GRANT_GROUP = "devices.map_beds", "charge_nurse"
UNIT = uuid.UUID("82ff93a0-4b67-4ccc-b326-77fa48524222")
BEDS = {
    "05": "ccbcafd3-0e2c-4c20-8960-e260cf02f3af", "06": "812c1447-e3c5-4993-a125-e9d1b99ad00f",
    "07": "78410869-6eff-4ba3-ad6f-c14f2d30854c", "08": "de98c201-c2d4-4a07-a983-ac6631627924",
    "09": "4f05102b-2b75-4d53-897a-c03ec57aa208", "10": "ad8fd1e6-7ad5-48b0-bf09-e15a8c50a1bd",
    "11": "ec5a3244-426b-4877-af3c-bb2bb829ce1f", "12": "7b8295b4-cdf2-4261-82e0-190b2027844d",
    "13": "756060d1-3bd4-4b0e-a8e8-03ae135f2229", "14": "94ac21da-f2c3-4fa6-9a50-f450510db771",
    "15": "0ffd2cf8-6fa0-41be-820b-5b4120961546", "25": "67f9ea20-db59-42ab-bfcb-0ff4d53728b0",
}


async def tenant_only(db: AsyncSession, slug: str, *, preslice: bool = True) -> Tenant:
    tenant = Tenant(name=f"Sentetik {slug}", slug=slug, country_code="AZ")
    db.add(tenant)
    await db.flush()
    groups = await ensure_default_groups(db, tenant.id)
    if preslice:
        for group in groups.values():                  # hospital_admin's seeded rows included
            group.permissions = [p for p in group.permissions if p.permission != GRANT_KEY]
        await db.flush()
    return tenant


async def v2_ward(db: AsyncSession, slug: str = "esleme-hastane", *,
                  preslice: bool = True) -> tuple[Tenant, dict[str, Bed]]:
    tenant = await tenant_only(db, slug, preslice=preslice)
    site = Site(tenant_id=tenant.id, name="Ana bina")
    db.add(site)
    await db.flush()
    db.add(Unit(id=UNIT, site_id=site.id, name="Reanimasiya", unit_type=UnitType.ADULT_ICU))
    await db.flush()
    beds = {}
    for nn, bed_id in BEDS.items():
        room = Room(unit_id=UNIT, name=f"Otaq {nn}")
        db.add(room)
        await db.flush()
        beds[nn] = Bed(id=uuid.UUID(bed_id), room_id=room.id, label=f"bed{nn}")
        db.add(beds[nn])
    await db.commit()
    return tenant, beds

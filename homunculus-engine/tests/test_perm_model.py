from sqlalchemy import select

from sec_harness import world  # noqa: F401
from homunculus.auth.models import UserRole
from homunculus.permissions.models import PermissionGrant, PermissionEffect


async def test_izin_satiri_yazilip_okunabilir(world):
    # Bir rol izni satırı yazılır ve geri okunabilir.
    async with world.maker() as s:
        s.add(PermissionGrant(
            tenant_id=world.a.tenant_id,
            action="lab_order.create",
            role=UserRole.ATTENDING,
            effect=PermissionEffect.ALLOW.value,
        ))
        await s.commit()
    async with world.maker() as s:
        rows = (await s.execute(select(PermissionGrant))).scalars().all()
    assert len(rows) == 1
    assert rows[0].action == "lab_order.create"
    assert rows[0].role is UserRole.ATTENDING
    assert rows[0].effect == "allow"

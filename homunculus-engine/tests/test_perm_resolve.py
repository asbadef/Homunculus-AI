from sec_harness import world  # noqa: F401
from homunculus.auth.models import UserRole, TenantMembership
from homunculus.permissions.models import PermissionEffect
from homunculus.permissions.service import (
    action_allowed, grant_role_permission, grant_user_permission,
)


async def test_rol_izni_verilince_serbest(world):
    u = await world.add_user(world.a, "hekim", UserRole.ATTENDING, totp=True)
    async with world.maker() as s:
        await grant_role_permission(s, tenant_id=world.a.tenant_id, role=UserRole.ATTENDING,
                                    action="lab_order.create", granted_by=u)
        await s.commit()
        assert await action_allowed(s, u, world.a.tenant_id, "lab_order.create") is True


async def test_izin_yoksa_kapali(world):
    # Fail-closed: tanımsız/izin verilmemiş eylem reddedilir.
    u = await world.add_user(world.a, "hekim2", UserRole.ATTENDING, totp=True)
    async with world.maker() as s:
        assert await action_allowed(s, u, world.a.tenant_id, "lab_order.create") is False


async def test_kullanici_deny_rol_allowu_ezer(world):
    u = await world.add_user(world.a, "istisna", UserRole.ATTENDING, totp=True)
    async with world.maker() as s:
        await grant_role_permission(s, tenant_id=world.a.tenant_id, role=UserRole.ATTENDING,
                                    action="exam.print", granted_by=u)
        await grant_user_permission(s, tenant_id=world.a.tenant_id, user_id=u.id,
                                    action="exam.print", effect=PermissionEffect.DENY, granted_by=u)
        await s.commit()
        assert await action_allowed(s, u, world.a.tenant_id, "exam.print") is False


async def test_baska_hastanedeki_izin_sayilmaz(world):
    u = await world.add_user(world.a, "sinir", UserRole.ATTENDING, totp=True)
    async with world.maker() as s:
        await grant_role_permission(s, tenant_id=world.b.tenant_id, role=UserRole.ATTENDING,
                                    action="lab_order.create", granted_by=u)
        await s.commit()
        assert await action_allowed(s, u, world.a.tenant_id, "lab_order.create") is False


async def test_rollerden_biri_izinliyse_serbest(world):
    u = await world.add_user(world.a, "cokrol", UserRole.NURSE, totp=True)
    async with world.maker() as s:
        s.add(TenantMembership(user_id=u.id, tenant_id=world.a.tenant_id, role=UserRole.CHARGE_NURSE))
        await grant_role_permission(s, tenant_id=world.a.tenant_id, role=UserRole.CHARGE_NURSE,
                                    action="sample.accept", granted_by=u)
        await s.commit()
        assert await action_allowed(s, u, world.a.tenant_id, "sample.accept") is True

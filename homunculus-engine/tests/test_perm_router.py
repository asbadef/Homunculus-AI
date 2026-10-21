from sec_harness import world  # noqa: F401
from homunculus.auth.models import UserRole


async def test_admin_izin_verir_ve_listeler(world):
    admin = await world.add_user(world.a, "yonetici", UserRole.HOSPITAL_ADMIN, totp=True)
    async with world.client() as c:
        h = await world.token(admin)
        r = await c.post(f"/tenant/tenants/{world.a.tenant_id}/permissions/roles",
                         json={"role": "ATTENDING", "action": "lab_order.create"}, headers=h)
        assert r.status_code == 201
        lst = await c.get(f"/tenant/tenants/{world.a.tenant_id}/permissions", headers=h)
        assert lst.status_code == 200
        assert any(g["action"] == "lab_order.create" for g in lst.json())


async def test_admin_baska_hastaneye_izin_veremez(world):
    admin = await world.add_user(world.a, "yonetici2", UserRole.HOSPITAL_ADMIN, totp=True)
    async with world.client() as c:
        r = await c.post(f"/tenant/tenants/{world.b.tenant_id}/permissions/roles",
                         json={"role": "ATTENDING", "action": "lab_order.create"},
                         headers=await world.token(admin))
    assert r.status_code == 403


async def test_admin_olmayan_izin_veremez(world):
    baci = await world.add_user(world.a, "baci", UserRole.NURSE, totp=True)
    async with world.client() as c:
        r = await c.post(f"/tenant/tenants/{world.a.tenant_id}/permissions/roles",
                         json={"role": "NURSE", "action": "sample.accept"},
                         headers=await world.token(baci))
    assert r.status_code == 403


async def test_baska_hastaneye_ait_izin_silinemez(world):
    admin_a = await world.add_user(world.a, "yon-a", UserRole.HOSPITAL_ADMIN, totp=True)
    admin_b = await world.add_user(world.b, "yon-b", UserRole.HOSPITAL_ADMIN, totp=True)
    async with world.client() as c:
        created = await c.post(f"/tenant/tenants/{world.b.tenant_id}/permissions/roles",
                               json={"role": "ATTENDING", "action": "exam.print"},
                               headers=await world.token(admin_b))
        assert created.status_code == 201
        gid = created.json()["id"]
        r = await c.delete(f"/tenant/tenants/{world.a.tenant_id}/permissions/{gid}",
                           headers=await world.token(admin_a))
    assert r.status_code == 404

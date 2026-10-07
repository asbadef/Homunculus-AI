"""K2 — rol kontrolü "bu kaydın hastanesinde" yapılır; başka hastanedeki rol hiçbir şey vermez."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sec_harness import world  # noqa: F401
from homunculus.auth.models import TenantMembership, UserRole


def _admission_payload(unit_id, bed_id):
    return {
        "patient": {"display_name": "Sentetik Hasta", "date_of_birth": "1980-02-02", "sex": "unknown"},
        "note": {"admitting_unit_id": str(unit_id), "bed_id": str(bed_id),
                 "admission_diagnosis_free_text": "sentetik"},
    }


async def test_admin_of_a_cannot_create_site_in_b(world):
    admin_a = await world.add_user(world.a, "yonetici-a", UserRole.HOSPITAL_ADMIN, totp=True)
    async with world.client() as c:
        r = await c.post(f"/tenant/tenants/{world.b.tenant_id}/sites", json={"name": "Sızma"},
                         headers=await world.token(admin_a))
    assert r.status_code == 403


async def test_admin_of_a_cannot_build_hierarchy_in_b(world):
    admin_a = await world.add_user(world.a, "yonetici-a", UserRole.HOSPITAL_ADMIN, totp=True)
    h = await world.token(admin_a)
    async with world.client() as c:
        unit = await c.post(f"/tenant/sites/{world.b.site_id}/units",
                            json={"name": "X", "unit_type": "ADULT_ICU"}, headers=h)
        room = await c.post(f"/tenant/units/{world.b.unit_id}/rooms", json={"name": "X"}, headers=h)
        bed = await c.post(f"/tenant/rooms/{world.b.room_id}/beds", json={"label": "X"}, headers=h)
        trans = await c.post(f"/tenant/beds/{world.b.bed_id}/transition",
                             json={"new_state": "OCCUPIED"}, headers=h)
        listing = await c.get(f"/tenant/tenants/{world.b.tenant_id}/sites", headers=h)
        units = await c.get(f"/tenant/sites/{world.b.site_id}/units", headers=h)
        rooms = await c.get(f"/tenant/units/{world.b.unit_id}/rooms", headers=h)
        beds = await c.get(f"/tenant/rooms/{world.b.room_id}/beds", headers=h)
    assert [r.status_code for r in (unit, room, bed, trans, listing, units, rooms, beds)] == [403] * 8


async def test_admin_of_a_can_still_build_hierarchy_in_a(world):
    admin_a = await world.add_user(world.a, "yonetici-a", UserRole.HOSPITAL_ADMIN, totp=True)
    async with world.client() as c:
        r = await c.post(f"/tenant/tenants/{world.a.tenant_id}/sites", json={"name": "Yeni Bina"},
                         headers=await world.token(admin_a))
    assert r.status_code == 201


async def test_tenant_list_and_create_are_platform_only(world):
    admin_a = await world.add_user(world.a, "yonetici-a", UserRole.HOSPITAL_ADMIN, totp=True)
    vendor = await world.add_user(world.a, "platform", UserRole.HOSPITAL_ADMIN, totp=True)
    async with world.maker() as s:
        db_vendor = await s.get(type(vendor), vendor.id)
        db_vendor.is_platform_support = True
        await s.commit()
    body = {"name": "Yeni Hastane", "slug": f"yeni-{uuid.uuid4().hex[:6]}", "country_code": "TR"}
    async with world.client() as c:
        ha, hv = await world.token(admin_a), await world.token(vendor)
        assert (await c.get("/tenant/tenants", headers=ha)).status_code == 403
        assert (await c.post("/tenant/tenants", json=body, headers=ha)).status_code == 403
        listed = await c.get("/tenant/tenants", headers=hv)
        assert listed.status_code == 200 and len(listed.json()) == 2
        assert (await c.post("/tenant/tenants", json=body, headers=hv)).status_code == 201


async def test_nurse_of_a_cannot_open_admission_in_b(world):
    nurse_a = await world.add_user(world.a, "hemsire-a", UserRole.NURSE)
    async with world.client() as c:
        r = await c.post("/admissions", json=_admission_payload(world.b.unit_id, world.b.bed_id),
                         headers=await world.token(nurse_a))
    assert r.status_code == 403


async def test_attending_of_a_cannot_sign_off_or_discharge_in_b(world):
    attending_a = await world.add_user(world.a, "hekim-a", UserRole.ATTENDING, totp=True)
    h = await world.token(attending_a)
    async with world.client() as c:
        sign = await c.post(f"/admissions/{world.b.admission_id}/sign-off", headers=h)
        discharge = await c.post(f"/admissions/{world.b.admission_id}/discharge/initiate",
                                 json={"discharge_summary": "sentetik"}, headers=h)
        team = await c.post(f"/admissions/{world.b.admission_id}/care-team/claim", headers=h)
    assert [sign.status_code, discharge.status_code, team.status_code] == [404, 404, 404]  # yabancı hastane: varlık sızmaz


async def test_role_held_in_another_hospital_does_not_count(world):
    # Hemşire A'da, hekim B'de. A'daki yatışı imzalayamaz (rolü o hastanede yok).
    user = await world.add_user(world.a, "karma", UserRole.NURSE, totp=True)
    async with world.maker() as s:
        s.add(TenantMembership(user_id=user.id, tenant_id=world.b.tenant_id, role=UserRole.ATTENDING))
        await s.commit()
    async with world.client() as c:
        h = await world.token(user)
        wrong = await c.post(f"/admissions/{world.a.admission_id}/sign-off", headers=h)
        right = await c.post(f"/admissions/{world.b.admission_id}/sign-off", headers=h)
    assert wrong.status_code == 403
    assert right.status_code != 403  # B'de yetkili: yetki geçer (iş kuralı sonucu başka olabilir)


async def test_charge_nurse_of_a_cannot_schedule_shifts_in_b(world):
    charge_a = await world.add_user(world.a, "basheme-a", UserRole.CHARGE_NURSE)
    now = datetime.now(timezone.utc).isoformat()
    payload = {"unit_id": str(world.b.unit_id), "assignments": [
        {"bed_id": str(world.b.bed_id), "nurse_id": str(charge_a.id),
         "shift_start": now, "shift_end": now}]}
    async with world.client() as c:
        r = await c.post("/shift-schedule", json=payload, headers=await world.token(charge_a))
    assert r.status_code == 403

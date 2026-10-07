"""K1 — hasta listesi / kimlik uç noktaları sunucu tarafında kullanıcının hastanesine göre süzülür.
Başka hastanenin kullanıcısı göremez; hasta kimliği yalnızca bakım ekibi / vardiya hemşiresi /
sorumlu başhemşire / kayıtlı break-glass oturumu için açıktır."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sec_harness import world  # noqa: F401
from homunculus.admission.models import CareTeamMember, CareTeamRole
from homunculus.auth.models import UserRole
from homunculus.escalation.models import BreakGlassReason, BreakGlassSession

A_PHI = "Sentetik Hasta A"


async def test_admission_list_shows_only_own_hospital(world):
    nurse_b = await world.add_user(world.b, "hemsire-b", UserRole.NURSE)
    async with world.client() as c:
        r = await c.get("/admissions", headers=await world.token(nurse_b))
    assert r.status_code == 200
    ids = {row["id"] for row in r.json()}
    assert str(world.b.admission_id) in ids
    assert str(world.a.admission_id) not in ids


async def test_admission_list_cannot_be_widened_with_foreign_unit_filter(world):
    nurse_b = await world.add_user(world.b, "hemsire-b", UserRole.NURSE)
    async with world.client() as c:
        r = await c.get("/admissions", params={"unit_id": str(world.a.unit_id)},
                        headers=await world.token(nurse_b))
    assert r.status_code == 200
    assert r.json() == []


async def test_foreign_user_cannot_read_admission_detail(world):
    nurse_b = await world.add_user(world.b, "hemsire-b", UserRole.NURSE)
    async with world.client() as c:
        r = await c.get(f"/admissions/{world.a.admission_id}", headers=await world.token(nurse_b))
    assert r.status_code == 404  # varlığı da sızdırılmaz


async def test_foreign_user_cannot_read_patient_identity(world):
    attending_b = await world.add_user(world.b, "hekim-b", UserRole.ATTENDING, totp=True)
    async with world.client() as c:
        r = await c.get(f"/admissions/{world.a.admission_id}/patient",
                        headers=await world.token(attending_b))
    assert r.status_code == 404
    assert A_PHI not in r.text


async def test_foreign_user_cannot_list_care_team(world):
    nurse_b = await world.add_user(world.b, "hemsire-b", UserRole.NURSE)
    async with world.client() as c:
        r = await c.get(f"/admissions/{world.a.admission_id}/care-team",
                        headers=await world.token(nurse_b))
    assert r.status_code == 404


async def test_same_hospital_user_outside_care_team_cannot_see_identity(world):
    # Aynı hastanede ama bakım ekibinde / vardiyada olmayan hemşire: kimlik yok.
    nurse_a = await world.add_user(world.a, "hemsire-a", UserRole.NURSE)
    async with world.client() as c:
        headers = await world.token(nurse_a)
        assert (await c.get(f"/admissions/{world.a.admission_id}", headers=headers)).status_code == 200
        r = await c.get(f"/admissions/{world.a.admission_id}/patient", headers=headers)
    assert r.status_code == 403
    assert A_PHI not in r.text


async def test_care_team_member_sees_identity(world):
    attending_a = await world.add_user(world.a, "hekim-a", UserRole.ATTENDING, totp=True)
    async with world.maker() as s:
        s.add(CareTeamMember(admission_id=world.a.admission_id, user_id=attending_a.id,
                             role=CareTeamRole.ATTENDING))
        await s.commit()
    async with world.client() as c:
        r = await c.get(f"/admissions/{world.a.admission_id}/patient",
                        headers=await world.token(attending_a))
    assert r.status_code == 200
    assert r.json()["display_name"] == A_PHI


async def test_active_break_glass_session_grants_identity(world):
    nurse_a = await world.add_user(world.a, "hemsire-a", UserRole.NURSE)
    now = datetime.now(timezone.utc)
    async with world.maker() as s:
        s.add(BreakGlassSession(tenant_id=world.a.tenant_id, user_id=nurse_a.id,
                                patient_id=world.a.patient_id, reason=BreakGlassReason.OTHER,
                                reason_text="sentetik acil erişim gerekçesi, yirmi karakterden uzun",
                                expires_at=now + timedelta(minutes=30)))
        await s.commit()
    async with world.client() as c:
        r = await c.get(f"/admissions/{world.a.admission_id}/patient",
                        headers=await world.token(nurse_a))
    assert r.status_code == 200


async def test_expired_break_glass_session_does_not_grant_identity(world):
    nurse_a = await world.add_user(world.a, "hemsire-a", UserRole.NURSE)
    now = datetime.now(timezone.utc)
    async with world.maker() as s:
        s.add(BreakGlassSession(tenant_id=world.a.tenant_id, user_id=nurse_a.id,
                                patient_id=world.a.patient_id, reason=BreakGlassReason.OTHER,
                                reason_text="sentetik acil erişim gerekçesi, yirmi karakterden uzun",
                                expires_at=now - timedelta(minutes=1)))
        await s.commit()
    async with world.client() as c:
        r = await c.get(f"/admissions/{world.a.admission_id}/patient",
                        headers=await world.token(nurse_a))
    assert r.status_code == 403

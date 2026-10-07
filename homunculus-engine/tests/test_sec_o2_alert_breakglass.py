"""O2 — alarm ve break-glass işlemlerinde kayıt sahipliği / hastane kontrolü + denetim kaydı."""
from __future__ import annotations

from sqlalchemy import select

from sec_harness import world  # noqa: F401
from homunculus.auth.models import UserRole
from homunculus.escalation.models import Alert, AlertStatus, BreakGlassSession
from homunculus.security_audit import SecurityAuditEvent

NOTE = "sentetik onay notu, yirmi karakterden uzun"
OTHER = "sentetik acil erişim gerekçesi, yirmi karakterden uzun"


async def _events(world, action=None):
    async with world.maker() as s:
        q = select(SecurityAuditEvent)
        if action:
            q = q.where(SecurityAuditEvent.action == action)
        return list((await s.execute(q)).scalars())


async def _alert(world, alert_id):
    async with world.maker() as s:
        return await s.get(Alert, alert_id)


async def test_foreign_user_cannot_acknowledge_snooze_or_escalate_alert(world):
    nurse_a = await world.add_user(world.a, "hemsire-a", UserRole.NURSE)
    h, target = await world.token(nurse_a), world.b.alert_id
    async with world.client() as c:
        ack = await c.post(f"/alerts/{target}/acknowledge", json={"reason": "gorüldü", "note": NOTE}, headers=h)
        snz = await c.post(f"/alerts/{target}/snooze",
                           json={"reason": "OTHER", "reason_text": "sentetik erteleme gerekçesi uzun", "duration_minutes": 10},
                           headers=h)
        esc = await c.post(f"/alerts/{target}/escalate", json={"reason": "sentetik"}, headers=h)
    assert (ack.status_code, snz.status_code, esc.status_code) == (404, 404, 404)
    assert (await _alert(world, target)).status == AlertStatus.FIRED  # dokunulmadı
    denied = [e for e in await _events(world) if e.outcome == "denied"]
    assert len(denied) == 3 and {e.user_id for e in denied} == {nurse_a.id}


async def test_foreign_user_cannot_create_alert_for_other_hospital(world):
    nurse_a = await world.add_user(world.a, "hemsire-a", UserRole.NURSE)
    async with world.client() as c:
        r = await c.post("/alerts", json={"patient_id": str(world.b.patient_id), "kind": "sepsis",
                                          "tier": "HIGH", "summary": "x"},
                         headers=await world.token(nurse_a))
    assert r.status_code == 404
    async with world.maker() as s:
        n = len((await s.execute(select(Alert).where(Alert.tenant_id == world.b.tenant_id))).scalars().all())
    assert n == 1  # yalnızca tohum alarm


async def test_non_clinical_role_in_own_hospital_cannot_act_on_alert(world):
    admin_a = await world.add_user(world.a, "yonetici-a", UserRole.HOSPITAL_ADMIN, totp=True)
    async with world.client() as c:
        r = await c.post(f"/alerts/{world.a.alert_id}/escalate", json={"reason": "sentetik"},
                         headers=await world.token(admin_a))
    assert r.status_code == 403
    assert any(e.outcome == "denied" for e in await _events(world))


async def test_own_hospital_acknowledge_works_and_is_audited(world):
    nurse_a = await world.add_user(world.a, "hemsire-a", UserRole.NURSE)
    async with world.client() as c:
        r = await c.post(f"/alerts/{world.a.alert_id}/acknowledge", json={"reason": "gorüldü", "note": NOTE},
                         headers=await world.token(nurse_a))
    assert r.status_code == 200
    (ev,) = await _events(world, "alert.acknowledge")
    assert (ev.outcome, ev.user_id, ev.tenant_id) == ("allowed", nurse_a.id, world.a.tenant_id)
    assert ev.resource_id == str(world.a.alert_id)


async def test_foreign_user_cannot_activate_break_glass_on_other_hospital_patient(world):
    nurse_a = await world.add_user(world.a, "hemsire-a", UserRole.NURSE)
    async with world.client() as c:
        r = await c.post("/break-glass", json={"patient_id": str(world.b.patient_id), "reason": "OTHER",
                                               "reason_text": OTHER}, headers=await world.token(nurse_a))
    assert r.status_code == 404
    async with world.maker() as s:
        assert (await s.execute(select(BreakGlassSession))).first() is None
    (ev,) = await _events(world, "break_glass.activate")
    assert (ev.outcome, ev.user_id) == ("denied", nurse_a.id)


async def test_own_hospital_break_glass_is_audited_with_reason(world):
    nurse_a = await world.add_user(world.a, "hemsire-a", UserRole.NURSE)
    async with world.client() as c:
        r = await c.post("/break-glass", json={"patient_id": str(world.a.patient_id), "reason": "OTHER",
                                               "reason_text": OTHER}, headers=await world.token(nurse_a))
    assert r.status_code == 201
    (ev,) = await _events(world, "break_glass.activate")
    assert ev.outcome == "allowed" and ev.resource_id == r.json()["id"]
    assert ev.detail["patient_id"] == str(world.a.patient_id) and ev.detail["reason"] == "OTHER"


async def _open_session(world, hospital, user):
    async with world.client() as c:
        r = await c.post("/break-glass", json={"patient_id": str(hospital.patient_id), "reason": "OTHER",
                                               "reason_text": OTHER}, headers=await world.token(user))
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def test_break_glass_session_belongs_to_its_owner(world):
    owner = await world.add_user(world.a, "hemsire-a", UserRole.NURSE)
    colleague = await world.add_user(world.a, "hemsire-a2", UserRole.NURSE)
    stranger = await world.add_user(world.b, "hemsire-b", UserRole.NURSE)
    sid = await _open_session(world, world.a, owner)
    async with world.client() as c:
        same_hosp = [await c.post(f"/break-glass/{sid}/{act}", headers=await world.token(colleague))
                     for act in ("extend", "close")]
        other_hosp = [await c.post(f"/break-glass/{sid}/{act}", headers=await world.token(stranger))
                      for act in ("extend", "close")]
        assert [r.status_code for r in same_hosp] == [403, 403]
        assert [r.status_code for r in other_hosp] == [404, 404]
        async with world.maker() as s:
            row = await s.get(BreakGlassSession, __import__("uuid").UUID(sid))
            assert row.closed_at is None and row.extension_count == 0
        assert (await c.post(f"/break-glass/{sid}/extend", headers=await world.token(owner))).status_code == 200
        assert (await c.post(f"/break-glass/{sid}/close", headers=await world.token(owner))).status_code == 200
    assert len(await _events(world, "break_glass.extend")) == 3  # 2 reddedilen + 1 izinli
    assert len(await _events(world, "break_glass.close")) == 3

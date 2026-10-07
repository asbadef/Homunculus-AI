"""K1/K2 — /handovers uçları hastane sınırına uyar; varlık sızıntısı yok (404)."""
from __future__ import annotations

from sec_harness import world  # noqa: F401
from homunculus.auth.models import UserRole


async def _open(world, c, outgoing, incoming, hospital=None, **over):
    h = hospital or world.a
    body = {"unit_id": str(h.unit_id), "incoming_user_id": str(incoming.id),
            "admission_ids": [str(h.admission_id)], **over}
    return await c.post("/handovers", json=body, headers=await world.token(outgoing))


async def test_b_user_cannot_sign_or_countersign_a_handover(world):
    out_a = await world.add_user(world.a, "cikan-a", UserRole.NURSE)
    in_a = await world.add_user(world.a, "gelen-a", UserRole.NURSE)
    nurse_b = await world.add_user(world.b, "hemsire-b", UserRole.NURSE)
    async with world.client() as c:
        r = await _open(world, c, out_a, in_a)
        assert r.status_code == 201
        hid = r.json()["id"]
        hb = await world.token(nurse_b)
        sign = await c.post(f"/handovers/{hid}/sign-outgoing", json={}, headers=hb)
        counter = await c.post(f"/handovers/{hid}/countersign", headers=hb)
        missing = await c.post(f"/handovers/00000000-0000-0000-0000-000000000001/sign-outgoing",
                               json={}, headers=hb)
    # yabancı hastane: kayıt yokmuş gibi 404; var olmayan kayıtla aynı yanıt
    assert sign.status_code == 404 and counter.status_code == 404
    assert missing.status_code == 404
    assert sign.json() == missing.json()


async def test_b_user_cannot_open_handover_on_a_unit(world):
    nurse_b = await world.add_user(world.b, "hemsire-b", UserRole.NURSE)
    other_b = await world.add_user(world.b, "diger-b", UserRole.NURSE)
    async with world.client() as c:
        r = await _open(world, c, nurse_b, other_b, hospital=world.a)
    assert r.status_code == 404


async def test_handover_rejects_foreign_incoming_user(world):
    out_a = await world.add_user(world.a, "cikan-a", UserRole.NURSE)
    nurse_b = await world.add_user(world.b, "hemsire-b", UserRole.NURSE)
    async with world.client() as c:
        r = await _open(world, c, out_a, nurse_b)
    assert r.status_code == 404


async def test_handover_rejects_foreign_admission(world):
    out_a = await world.add_user(world.a, "cikan-a", UserRole.NURSE)
    in_a = await world.add_user(world.a, "gelen-a", UserRole.NURSE)
    async with world.client() as c:
        r = await _open(world, c, out_a, in_a, admission_ids=[str(world.b.admission_id)])
    assert r.status_code == 404


async def test_unacked_critical_count_is_hospital_scoped(world):
    from homunculus.escalation import service
    async with world.maker() as s:
        n_a = await service.count_unacknowledged_critical(
            s, admission_ids=[world.a.admission_id], tenant_id=world.a.tenant_id)
        n_cross = await service.count_unacknowledged_critical(
            s, admission_ids=[world.b.admission_id], tenant_id=world.a.tenant_id)
    assert n_a == 1
    assert n_cross == 0

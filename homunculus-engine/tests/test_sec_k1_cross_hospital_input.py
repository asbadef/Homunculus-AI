"""O2/K1 — gövdedeki kimlikler (yatak, hemşire, birim, kabul, kullanıcı) aynı hastaneye ait olmalı;
yabancı hastane kayıtları var olmayan kayıt gibi 404 döner (varlık sızmaz)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from sec_harness import world  # noqa: F401
from homunculus.admission.models import CareTeamMember, NurseBedAssignment
from homunculus.auth.models import UserRole
from homunculus.escalation.models import Alert


def _shift(bed_id, nurse_id):
    now = datetime.now(timezone.utc)
    return {"bed_id": str(bed_id), "nurse_id": str(nurse_id),
            "shift_start": now.isoformat(), "shift_end": (now + timedelta(hours=8)).isoformat()}


async def test_create_alert_rejects_foreign_admission_or_unit(world):
    nurse_a = await world.add_user(world.a, "hemsire-a", UserRole.NURSE)
    h = await world.token(nurse_a)
    base = {"patient_id": str(world.a.patient_id), "kind": "sepsis", "tier": "HIGH", "summary": "x"}
    async with world.client() as c:
        adm = await c.post("/alerts", json={**base, "admission_id": str(world.b.admission_id)}, headers=h)
        unit = await c.post("/alerts", json={**base, "unit_id": str(world.b.unit_id)}, headers=h)
        ok = await c.post("/alerts", json={**base, "unit_id": str(world.a.unit_id),
                                           "admission_id": str(world.a.admission_id)}, headers=h)
    assert (adm.status_code, unit.status_code, ok.status_code) == (404, 404, 201)
    async with world.maker() as s:
        n = len((await s.execute(select(Alert).where(Alert.tenant_id == world.a.tenant_id))).scalars().all())
    assert n == 2  # tohum + geçerli olan


async def test_admission_patient_mismatch_is_rejected(world):
    nurse_a = await world.add_user(world.a, "hemsire-a", UserRole.NURSE)
    async with world.client() as c:
        r = await c.post("/alerts", json={"patient_id": str(world.a.patient_id), "kind": "x", "tier": "HIGH",
                                          "admission_id": str(world.b.admission_id)},
                         headers=await world.token(nurse_a))
    assert r.status_code == 404


async def test_shift_schedule_rejects_foreign_bed_or_nurse(world):
    charge_a = await world.add_user(world.a, "sorumlu-a", UserRole.CHARGE_NURSE)
    nurse_a = await world.add_user(world.a, "hemsire-a", UserRole.NURSE)
    nurse_b = await world.add_user(world.b, "hemsire-b", UserRole.NURSE)
    h = await world.token(charge_a)
    async with world.client() as c:
        bad_bed = await c.post("/shift-schedule", headers=h, json={
            "unit_id": str(world.a.unit_id), "assignments": [_shift(world.b.bed_id, nurse_a.id)]})
        bad_nurse = await c.post("/shift-schedule", headers=h, json={
            "unit_id": str(world.a.unit_id), "assignments": [_shift(world.a.bed_id, nurse_b.id)]})
    assert (bad_bed.status_code, bad_nurse.status_code) == (404, 404)
    async with world.maker() as s:
        assert (await s.execute(select(NurseBedAssignment))).first() is None


async def test_transfer_initiate_rejects_foreign_target(world):
    att_a = await world.add_user(world.a, "hekim-a", UserRole.ATTENDING, totp=True)
    h = await world.token(att_a)
    async with world.client() as c:
        r = await c.post(f"/admissions/{world.a.admission_id}/transfer/initiate", headers=h,
                         json={"target_bed_id": str(world.b.bed_id), "target_unit_id": str(world.b.unit_id)})
        mixed = await c.post(f"/admissions/{world.a.admission_id}/transfer/initiate", headers=h,
                             json={"target_bed_id": str(world.a.bed_id), "target_unit_id": str(world.b.unit_id)})
    assert (r.status_code, mixed.status_code) == (404, 404)


async def test_care_team_rejects_user_outside_hospital(world):
    att_a = await world.add_user(world.a, "hekim-a", UserRole.ATTENDING, totp=True)
    doc_b = await world.add_user(world.b, "hekim-b", UserRole.ATTENDING, totp=True)
    async with world.client() as c:
        r = await c.post(f"/admissions/{world.a.admission_id}/care-team", headers=await world.token(att_a),
                         json={"user_id": str(doc_b.id), "role": "ASSOCIATE_PHYSICIAN"})
    assert r.status_code == 404
    async with world.maker() as s:
        assert (await s.execute(select(CareTeamMember))).first() is None


async def test_foreign_admission_actions_answer_404_not_403(world):
    att_b = await world.add_user(world.b, "hekim-b", UserRole.ATTENDING, totp=True)
    h = await world.token(att_b)
    async with world.client() as c:
        signoff = await c.post(f"/admissions/{world.a.admission_id}/sign-off", headers=h)
        missing = await c.post("/admissions/00000000-0000-0000-0000-000000000001/sign-off", headers=h)
    assert signoff.status_code == 404
    assert signoff.json() == missing.json()

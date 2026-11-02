# homunculus-engine/tests/test_protocol_board_key.py
"""The board key everywhere an admission meets the board (G2-B1d, spec §4, D7, D9; E3, E4, E5):
sign-off and discharge act on the protocol-keyed card (its critical alarm holds the start, its
tombstone and retirement are under the protocol, the audit rows name it); the lists and the detail
answer `protocol_no` and `board_key`; the bed release finds a discharged card under its key and
refuses `board_not_cleared` naming it; the care team's own patients and break-glass name the key.
A legacy admission (no protocol, opened before 0015) keeps its H-number at each. Postgres.
Synthetic ward: tests/kabul_world.py."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy import select

from homunculus.admission import service
from homunculus.admission.boardlink import BoardLink, kabul_record
from homunculus.admission.models import Admission, CareTeamMember, CareTeamRole, Patient
from homunculus.escalation.models import BreakGlassReason, BreakGlassSession
from homunculus.scope.resolver import break_glass_in_tenant
from homunculus.scope.service import read_own_patient_ids
from tests.conftest import requires_db
from tests.kabul_world import BOARD, FIRST_PROTOCOL, SLUG, build_ward, ward_client
from tests.test_discharge_api import acknowledged, admit, audited, septic_shock, signed, started

pytestmark = [requires_db]
LEGACY = "H9900042"           # a fixture's H-number, far from the live range (test_unit_scope.py)


@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    built = await build_ward(db_session)
    async with ward_client(db_session) as (client, app):
        yield built, client, app


async def _legacy(db_session, app, w, bed: str = "2") -> Admission:
    """An admission opened before 0015: no protocol, its card under its H-number on its bed."""
    patient = Patient(tenant_id=w.tenant.id, display_name="Sentetik Eski", date_of_birth="1960-01-01",
                      sex="male", patient_number=LEGACY)
    db_session.add(patient)
    await db_session.flush()
    admission = await service.create_draft_admission(
        db_session, tenant_id=w.tenant.id, patient=patient,
        note_fields={"admitting_unit_id": w.units["rea"].id, "bed_id": w.beds[bed].id,
                     "admission_diagnosis_free_text": "Sentetik tanı"})
    await db_session.commit()
    await app.state.board_link.put_identity(SLUG, kabul_record(
        patient_number=LEGACY, display_name="Sentetik Eski", birth_date=date(1960, 1, 1), sex="male",
        bed_label=bed, bed_id=str(w.beds[bed].id), unit_id=str(w.units["rea"].id),
        at=datetime.now(timezone.utc)))
    return admission


async def _cards(client) -> list[str]:
    return [c["patient_id"] for c in (await client.get("/patients", headers=BOARD)).json()["patients"]]


async def test_sign_off_and_discharge_act_on_the_protocol_card(ward):
    w, client, app = ward
    admission = await started(w, client)
    assert admission["board_key"] == FIRST_PROTOCOL
    r = await client.post(f"/admissions/{admission['id']}/discharge/confirm", headers=w.auth["charge"])
    assert (r.status_code, r.json()["board"], r.json()["alerts"]) == (200, "ok", "ok"), r.text
    assert r.json()["protocol_no"] == FIRST_PROTOCOL
    link = app.state.board_link
    assert link.is_discharged(SLUG, FIRST_PROTOCOL)
    assert link._identities.get(SLUG, admission["patient_number"]) is None    # nothing under the H
    assert await _cards(client) == []
    for event in ("admission.sign_off", "admission.discharge_start", "admission.discharge_confirm"):
        assert [row.patient_id for row in audited(app, event)] == [FIRST_PROTOCOL], event


async def test_the_protocol_cards_critical_alarm_holds_the_discharge(ward):
    w, client, _ = ward
    admission = await signed(w, client)
    await septic_shock(client, FIRST_PROTOCOL)
    start = f"/admissions/{admission['id']}/discharge/initiate"
    r = await client.post(start, json={"disposition": "HOME"}, headers=w.auth["doctor"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "critical_alarm_open")
    await acknowledged(client, FIRST_PROTOCOL)
    r = await client.post(start, json={"disposition": "HOME"}, headers=w.auth["doctor"])
    assert r.status_code == 200, r.text


async def test_the_list_and_the_detail_carry_the_protocol_and_the_key(ward, db_session):
    w, client, app = ward
    admitted = await admit(w, client)
    legacy = await _legacy(db_session, app, w)
    rows = (await client.get("/admissions", headers=w.auth["nurse"])).json()
    got = {r["id"]: (r["protocol_no"], r["board_key"], r["patient_number"]) for r in rows}
    assert got == {admitted["id"]: (FIRST_PROTOCOL, FIRST_PROTOCOL, admitted["patient_number"]),
                   str(legacy.id): (None, LEGACY, LEGACY)}
    for admission_id, key in ((admitted["id"], FIRST_PROTOCOL), (str(legacy.id), LEGACY)):
        detail = (await client.get(f"/admissions/{admission_id}", headers=w.auth["nurse"])).json()
        assert detail["board_key"] == key and "display_name" not in detail


async def test_a_legacy_admission_is_signed_and_discharged_under_its_h_number(ward, db_session):
    w, client, app = ward
    legacy = await _legacy(db_session, app, w)
    base = f"/admissions/{legacy.id}"
    for path, body, who in (("/sign-off", None, "doctor"),
                            ("/discharge/initiate", {"disposition": "HOME"}, "doctor"),
                            ("/discharge/confirm", None, "charge")):
        r = await client.post(base + path, json=body, headers=w.auth[who])
        assert r.status_code == 200, r.text
    assert r.json()["protocol_no"] is None
    assert app.state.board_link.is_discharged(SLUG, LEGACY)
    assert [row.patient_id for row in audited(app, "admission.discharge_confirm")] == [LEGACY]


async def test_the_bed_release_finds_the_protocol_card_still_standing(ward, monkeypatch):
    """E3: a discharge whose board step failed leaves the protocol card on its bed; the release
    looks for it under its key, takes it off, and until that lands refuses naming it."""
    w, client, app = ward
    admission = await started(w, client)
    release = f"/tenant/beds/{w.beds['1'].id}/release"
    with monkeypatch.context() as patched:
        async def refused(self, tenant, patient_number):
            raise RuntimeError(f"the discharge of {patient_number} was refused")

        patched.setattr(BoardLink, "discharge_identity", refused)
        r = await client.post(f"/admissions/{admission['id']}/discharge/confirm", headers=w.auth["charge"])
        assert r.json()["board"] == "failed"
        r = await client.post(release, headers=w.auth["nurse"])
        detail = r.json()["detail"]
        assert (r.status_code, detail["code"], detail["board_key"], detail["patient_number"]) == \
            (409, "board_not_cleared", FIRST_PROTOCOL, admission["patient_number"])
        assert await _cards(client) == [FIRST_PROTOCOL]
    r = await client.post(release, headers=w.auth["nurse"])
    assert (r.status_code, r.json()["state"]) == (200, "AVAILABLE"), r.text
    assert await _cards(client) == []
    assert [row.patient_id for row in audited(app, "admission.discharge_board_retry")] == \
        [FIRST_PROTOCOL, FIRST_PROTOCOL]
    assert app.state.board_link._identities.get(SLUG, admission["patient_number"]) is None


async def test_the_care_teams_own_patients_and_break_glass_name_the_key(ward, db_session):
    """§4 and D9: the board shows a care team member her patients, and a break-glass session its
    patient, by the key the card carries — the protocol, or a legacy admission's H-number. A HIS
    reference stays beside it, as before."""
    w, client, app = ward
    admitted = await admit(w, client)
    legacy = await _legacy(db_session, app, w)
    doctor = w.users["doctor"]
    rows = (await db_session.execute(select(Admission))).scalars().all()
    for row in rows:
        db_session.add(CareTeamMember(admission_id=row.id, user_id=doctor.id, role=CareTeamRole.ATTENDING))
    await db_session.commit()
    assert sorted(await read_own_patient_ids(db_session, doctor.id, w.tenant.id)) == \
        sorted([FIRST_PROTOCOL, LEGACY])

    new_patient = (await db_session.execute(select(Admission.patient_id)
                                            .where(Admission.protocol_no == FIRST_PROTOCOL))).scalar_one()
    nurse = w.users["nurse"]
    for patient_id in (new_patient, legacy.patient_id):
        db_session.add(BreakGlassSession(
            tenant_id=w.tenant.id, user_id=nurse.id, patient_id=patient_id,
            reason=BreakGlassReason.CARDIAC_ARREST,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=30)))
    await db_session.commit()
    assert sorted(await break_glass_in_tenant(db_session, nurse.id, w.tenant.id)) == \
        sorted([FIRST_PROTOCOL, LEGACY])
    assert admitted["patient_number"] not in await break_glass_in_tenant(db_session, nurse.id, w.tenant.id)

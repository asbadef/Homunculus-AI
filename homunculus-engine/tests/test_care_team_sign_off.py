# homunculus-engine/tests/test_care_team_sign_off.py
"""The sign-off makes the attending (G2-B1c, spec D3, §5.3, T1, O45):
- the signer becomes the attending, or the attending the form named; her ATTENDING row is written
  in the sign-off's own transaction, granted by the signer, and a failure writes neither;
- she must be a physician: an administrator signing a DRAFT that names nobody, or a form that
  names a nurse, is refused `care_team_not_physician`, and nothing is written;
- the role group decides, not a care-team key: a unit physician, who assigns nobody, becomes the
  attending she signs for;
- the signer then sees the patient as her own (O45 closed);
- the same rule stands at admit (final review, T1): a form that names a non-physician as the
  attending is refused 422 `field_invalid:attending_physician_id`, so no new DRAFT names one.
Postgres. Synthetic ward: tests/kabul_world.py."""
from __future__ import annotations

import uuid

import pytest_asyncio
from sqlalchemy import func, select, update

from homunculus.admission import service
from homunculus.admission.models import (
    Admission, AdmissionState, CareTeamMember, CareTeamRole, Patient,
)
from homunculus.admission.service import WorkflowError
from homunculus.scope.service import read_own_patient_ids
from tests.conftest import requires_db
from tests.kabul_world import build_ward, ward_client
from tests.test_care_team_service import add_physician
from tests.test_discharge_api import admit, audited, form, signed

pytestmark = [requires_db]


@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    built = await build_ward(db_session)
    async with ward_client(db_session) as (client, app):
        yield built, client, app


async def _rows(db, admission_id: str) -> list[CareTeamMember]:
    return list((await db.execute(
        select(CareTeamMember).where(CareTeamMember.admission_id == uuid.UUID(admission_id))
        .execution_options(populate_existing=True))).scalars().all())


async def _signature(db, admission_id: str) -> tuple:
    return tuple((await db.execute(
        select(Admission.state, Admission.signed_by, Admission.attending_physician_id)
        .where(Admission.id == uuid.UUID(admission_id)))).one())


async def _admit_naming(w, client, attending: uuid.UUID) -> dict:
    """The Kabul form sent through the API with an attending named (the screen names none)."""
    body = form(w)
    body["note"]["attending_physician_id"] = str(attending)
    r = await client.post("/admissions", json=body, headers=w.auth["nurse"])
    assert r.status_code == 201, r.text
    return r.json()


async def test_the_signer_becomes_the_attending_and_her_row_is_written(ward, db_session):
    w, client, app = ward
    doctor = w.users["doctor"].id
    admission = await admit(w, client)
    r = await client.post(f"/admissions/{admission['id']}/sign-off", headers=w.auth["doctor"])
    assert r.status_code == 200, r.text
    assert r.json()["attending_physician_id"] == r.json()["signed_by"] == str(doctor)
    (row,) = await _rows(db_session, admission["id"])
    assert (row.user_id, row.role, row.is_active, row.granted_by_id) == (
        doctor, CareTeamRole.ATTENDING, True, doctor)
    (signature,) = audited(app, "admission.sign_off")
    assert signature.payload == {"admission_id": admission["id"],
                                 "actor": "doctor@kabul.example.com",
                                 "attending": "doctor@kabul.example.com",
                                 "member_id": str(row.id)}
    (made,) = audited(app, "care_team.attending")
    assert (made.patient_id, made.payload) == (admission["board_key"], {
        "admission_id": admission["id"], "member_id": str(row.id),
        "member": "doctor@kabul.example.com", "via": "sign_off", "ended": [],
        "actor": "doctor@kabul.example.com"})


async def test_the_attending_the_form_names_gets_the_row_and_the_signer_signs(ward, db_session):
    w, client, app = ward
    doctor = w.users["doctor"].id
    named = await add_physician(db_session, w, "adli")
    admission = await _admit_naming(w, client, named)
    r = await client.post(f"/admissions/{admission['id']}/sign-off", headers=w.auth["doctor"])
    assert r.status_code == 200, r.text
    assert (r.json()["attending_physician_id"], r.json()["signed_by"]) == (str(named), str(doctor))
    assert [(m.user_id, m.granted_by_id) for m in await _rows(db_session, admission["id"])] == [
        (named, doctor)]
    assert audited(app, "admission.sign_off")[0].payload["attending"] == "adli@kabul.example.com"


async def test_an_administrator_signing_a_draft_that_names_nobody_is_refused(ward, db_session):
    """T1, §5.3: she would become the attending, and she is no physician. Nothing is written:
    not the signature, not a row, not an audit row."""
    w, client, app = ward
    admission = await admit(w, client)
    r = await client.post(f"/admissions/{admission['id']}/sign-off", headers=w.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "care_team_not_physician")
    assert await _signature(db_session, admission["id"]) == (AdmissionState.DRAFT, None, None)
    assert await _rows(db_session, admission["id"]) == []
    assert audited(app, "admission.sign_off") == audited(app, "care_team.attending") == []


async def _counts(db) -> tuple[int, int]:
    """(admissions, patients) held: a refused admit writes neither."""
    return (await db.scalar(select(func.count()).select_from(Admission)),
            await db.scalar(select(func.count()).select_from(Patient)))


async def test_a_form_naming_a_nurse_as_attending_is_refused_at_admit(ward, db_session):
    """T1 at admit (final review): the route that makes the DRAFT refuses a non-physician
    attending, so the sign-off's refusal is only ever for old data. 422 naming the field;
    nothing is written: no admission, no patient."""
    w, client, app = ward
    nurse = w.users["nurse"].id
    before = await _counts(db_session)
    body = form(w)
    body["note"]["attending_physician_id"] = str(nurse)
    r = await client.post("/admissions", json=body, headers=w.auth["nurse"])
    assert (r.status_code, r.json()["detail"]["code"]) == (
        422, "field_invalid:attending_physician_id")
    assert await _counts(db_session) == before
    assert audited(app, "admission.admit") == []


async def test_a_form_naming_a_physician_as_attending_is_accepted_at_admit(ward, db_session):
    w, client, _ = ward
    named = await add_physician(db_session, w, "adli")
    admission = await _admit_naming(w, client, named)
    assert admission["state"] == "DRAFT"
    assert admission["attending_physician_id"] == str(named)


async def test_a_form_naming_nobody_is_accepted_at_admit(ward):
    """The Kabul screen names none; the signer becomes the attending."""
    w, client, _ = ward
    admission = await admit(w, client)
    assert (admission["state"], admission["attending_physician_id"]) == ("DRAFT", None)


async def test_a_draft_naming_a_nurse_is_refused_at_sign_off_whoever_signs(ward, db_session):
    """Old data. The admit route no longer lets a DRAFT name a non-physician (the test above),
    so this DRAFT is made naming nobody and then given the nurse directly in the database, as a
    DRAFT written before that rule would hold her. The sign-off still refuses it."""
    w, client, app = ward
    nurse = w.users["nurse"].id
    admission = await admit(w, client)
    await db_session.execute(update(Admission).where(Admission.id == uuid.UUID(admission["id"]))
                             .values(attending_physician_id=nurse))
    await db_session.commit()
    r = await client.post(f"/admissions/{admission['id']}/sign-off", headers=w.auth["doctor"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "care_team_not_physician")
    assert await _signature(db_session, admission["id"]) == (AdmissionState.DRAFT, None, nurse)
    assert await _rows(db_session, admission["id"]) == []
    assert audited(app, "admission.sign_off") == audited(app, "care_team.attending") == []


async def test_an_administrator_signs_a_draft_that_names_a_physician(ward, db_session):
    """T1, §5.3: the signer need not be a physician, the attending must be. The administrator
    signs; the ATTENDING row is the named physician's, granted by the administrator."""
    w, client, app = ward
    admin = w.users["admin"].id
    named = await add_physician(db_session, w, "adli")
    admission = await _admit_naming(w, client, named)
    r = await client.post(f"/admissions/{admission['id']}/sign-off", headers=w.auth["admin"])
    assert r.status_code == 200, r.text
    assert (r.json()["state"], r.json()["attending_physician_id"], r.json()["signed_by"]) == (
        "ACTIVE", str(named), str(admin))
    assert [(m.user_id, m.role, m.is_active, m.granted_by_id)
            for m in await _rows(db_session, admission["id"])] == [
        (named, CareTeamRole.ATTENDING, True, admin)]
    (signature,) = audited(app, "admission.sign_off")
    assert (signature.payload["actor"], signature.payload["attending"]) == (
        "admin@kabul.example.com", "adli@kabul.example.com")
    (made,) = audited(app, "care_team.attending")
    assert (made.payload["member"], made.payload["via"], made.payload["actor"]) == (
        "adli@kabul.example.com", "sign_off", "admin@kabul.example.com")


async def test_a_failure_writing_the_row_writes_no_signature_either(ward, db_session, monkeypatch):
    """§5.3: one transaction. The row's write fails after the signature's; neither stands."""
    w, client, app = ward
    admission = await admit(w, client)

    async def broken(*args, **kwargs):
        raise WorkflowError("Sentetik arıza")

    monkeypatch.setattr(service, "set_attending", broken)
    r = await client.post(f"/admissions/{admission['id']}/sign-off", headers=w.auth["doctor"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "invalid_transition")
    assert await _signature(db_session, admission["id"]) == (AdmissionState.DRAFT, None, None)
    assert await _rows(db_session, admission["id"]) == []
    assert audited(app, "admission.sign_off") == []


async def test_a_unit_physician_becomes_the_attending_she_signs_for(ward, db_session):
    """T1 reads the ROLE group, not a care-team key: `unit_physician` holds neither key."""
    w, client, _ = ward
    unit = await add_physician(db_session, w, "unite", group="unit_physician")
    admission = await admit(w, client)
    r = await client.post(f"/admissions/{admission['id']}/sign-off", headers=w.auth["unite"])
    assert r.status_code == 200, r.text
    assert [(m.user_id, m.role) for m in await _rows(db_session, admission["id"])] == [
        (unit, CareTeamRole.ATTENDING)]


async def test_the_signer_then_sees_the_patient_as_her_own(ward, db_session):
    """O45 closed: the row is what the board's own-patient rule reads (scope/service.py)."""
    w, client, _ = ward
    doctor, tenant = w.users["doctor"].id, w.tenant.id
    admission = await signed(w, client)
    assert admission["board_key"] in await read_own_patient_ids(db_session, doctor, tenant)

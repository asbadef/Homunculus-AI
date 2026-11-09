# homunculus-engine/tests/test_reserved_admission.py
"""An admission into a reserved bed (G2-B3a, spec D5, X1, X2, X9).
- Without `confirm_reserved`, it is refused `bed_reserved`, carrying the bed's id and never the
  note. Nothing is written and no protocol number is spent on the refusal.
- With the confirmation, the patient takes the bed, the note goes with the state, and the audit
  row says the bed was reserved.
- `confirm_reserved` is not part of the form's digest.
- A bed out of service or in maintenance takes no admission.
- A reservation racing an admission for one bed leaves exactly one winner.
Postgres; synthetic ward (tests/kabul_world.py)."""
from __future__ import annotations

import asyncio
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import func, select, text

from homunculus.admission import router as admission_router
from homunculus.admission.models import Patient
from homunculus.admission.schemas import AdmissionCreate
from homunculus.tenant.models import Bed, BedState
from tests.conftest import requires_db
from tests.kabul_world import FIRST_PROTOCOL, SLUG, build_ward, ward_client

pytestmark = [requires_db]
NOTE = "Sentetik planlı kabul"


@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    built = await build_ward(db_session)
    async with ward_client(db_session) as (client, app):
        yield built, client, app


def _form(w, bed: str, request_id: uuid.UUID | None = None, **top) -> dict:
    """The Kabul tab's body for bed `bed`, with `top` beside `patient` and `note`."""
    body = {
        "patient": {"display_name": f"Sentetik Hasta {bed}", "date_of_birth": "1970-05-05",
                    "sex": "female", "consent": "KVKK_SIGNED"},
        "note": {"admitting_unit_id": str(w.units["rea"].id), "bed_id": str(w.beds[bed].id),
                 "admission_type": "ICU", "admission_diagnosis_free_text": "Sentetik tanı",
                 "no_known_allergy": True},
        **top,
    }
    if request_id is not None:
        body["request_id"] = str(request_id)
    return body


async def _reserve(client, w, bed: str) -> None:
    r = await client.post(f"/tenant/beds/{w.beds[bed].id}/reserve", json={"note": NOTE},
                          headers=w.auth["charge"])
    assert r.status_code == 200, r.text


def _admit_rows(app) -> list:
    return [r for r in app.state.audit.records(tenant=SLUG, limit=100)
            if r.event_type == "admission.admit"]


async def test_a_reserved_bed_is_refused_without_the_confirmation_and_nothing_is_spent(ward, db_session):
    w, client, _ = ward
    # Read before `expire_all` below: an expired object would lazy-load outside the greenlet.
    bed_id = w.beds["3"].id
    reserved_form, free_form = _form(w, "3"), _form(w, "1")
    await _reserve(client, w, "3")
    r = await client.post("/admissions", json=reserved_form, headers=w.auth["charge"])
    assert r.status_code == 409, r.text
    detail = r.json()["detail"]
    assert (detail["code"], detail["bed_id"]) == ("bed_reserved", str(bed_id))
    assert NOTE not in r.text                                                      # X1
    db_session.expire_all()
    assert (await db_session.execute(select(func.count()).select_from(Patient))).scalar_one() == 0
    assert (await db_session.get(Bed, bed_id)).state == BedState.RESERVED
    r = await client.post("/admissions", json=free_form, headers=w.auth["charge"])
    assert r.status_code == 201, r.text
    assert r.json()["protocol_no"] == FIRST_PROTOCOL                    # no number was spent


async def test_with_the_confirmation_the_reserved_bed_takes_the_patient(ward, db_session):
    w, client, app = ward
    bed_id = w.beds["3"].id
    await _reserve(client, w, "3")
    r = await client.post("/admissions", json=_form(w, "3", confirm_reserved=True),
                          headers=w.auth["charge"])
    assert r.status_code == 201, r.text
    row = (await db_session.execute(text("SELECT state::text, state_note FROM beds WHERE id = :id"),
                                    {"id": bed_id})).one()
    assert tuple(row) == ("OCCUPIED", None)
    (audit,) = _admit_rows(app)
    assert audit.payload["bed_was_reserved"] is True                                # X9


async def test_a_free_bed_needs_no_confirmation_and_says_nothing_of_one(ward):
    w, client, app = ward
    r = await client.post("/admissions", json=_form(w, "3", confirm_reserved=True),
                          headers=w.auth["charge"])
    assert r.status_code == 201, r.text
    (audit,) = _admit_rows(app)
    assert "bed_was_reserved" not in audit.payload


@pytest.mark.parametrize("state", [BedState.BLOCKED, BedState.MAINTENANCE])
async def test_a_bed_out_of_service_or_in_maintenance_takes_no_admission(ward, db_session, state):
    w, client, _ = ward
    w.beds["3"].state = state
    db_session.add(w.beds["3"])
    await db_session.commit()
    r = await client.post("/admissions", json=_form(w, "3", confirm_reserved=True),
                          headers=w.auth["charge"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "bed_not_available")


async def test_the_confirmation_is_not_part_of_the_forms_digest(ward):
    """X2: one form, sent before and after the nurse's answer, is one form."""
    w, client, _ = ward
    body = _form(w, "3", request_id=uuid.uuid4())
    digest = admission_router._request_digest
    assert digest(AdmissionCreate.model_validate(body)) == \
        digest(AdmissionCreate.model_validate({**body, "confirm_reserved": True}))
    await _reserve(client, w, "3")
    r = await client.post("/admissions", json=body, headers=w.auth["charge"])
    assert r.json()["detail"]["code"] == "bed_reserved"
    r = await client.post("/admissions", json={**body, "confirm_reserved": True},
                          headers=w.auth["charge"])
    assert r.status_code == 201, r.text


async def test_a_reservation_and_an_admission_racing_for_one_bed_leave_one_winner(ward, db_session):
    """R6: both take the bed's row lock first; the second sees what the first committed."""
    w, client, _ = ward
    bed_id = w.beds["3"].id                       # read before `expire_all` below
    reserve, admit = await asyncio.gather(
        client.post(f"/tenant/beds/{bed_id}/reserve", json={"note": NOTE},
                    headers=w.auth["charge"]),
        client.post("/admissions", json=_form(w, "3"), headers=w.auth["nurse"]),
    )
    assert (reserve.status_code, admit.status_code) in {(200, 409), (409, 201)}, \
        (reserve.text, admit.text)
    db_session.expire_all()
    state = (await db_session.get(Bed, bed_id)).state
    if reserve.status_code == 200:
        assert state == BedState.RESERVED and admit.json()["detail"]["code"] == "bed_reserved"
    else:
        assert state == BedState.OCCUPIED and reserve.json()["detail"]["code"] == "invalid_transition"

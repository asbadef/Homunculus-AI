# homunculus-engine/tests/test_admission_time.py
"""G3-07 Kabul zamanı (spec 2026-11-12 §3, §4, §6): the admission form may say when the stay began.

- Sent nothing, the row's time is the save, as before; the audit row names that time and says nothing
  of a back-dating (D1, D6).
- Sent, the time is the row's and the answer's, and the audit row says `backdated`; the card's identity
  stamp stays the save's (D6, §4.2).
- Six hours back at most (D2): 422 `field_invalid:admission_datetime`, nothing spent.
- Not before the bed became free (D3): 409 `admitted_before_bed_free`, for a bed AVAILABLE or RESERVED.
- Not before this person's last discharge (D4): 409 `admitted_before_discharge`; a moved stay binds by its
  last row; another person and a row without a digest bind nothing.
- The new bounds run after the look-up of an earlier send (§3.1): a resend whose first send was admitted
  is answered with its admission, whatever the clock and the bed say now. The refusals keep their order.
- The readers of the stay's start take the back-dated time (§4, D7, D8); a device set measured in the
  window links to the stay end to end, one measured before it does not (G3-05).
Postgres (`db_session`). Synthetic ward: tests/kabul_world.py."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest_asyncio
from sqlalchemy import func, select, update

from homunculus.admission import router as admission_router
from homunculus.admission.models import Admission
from homunculus.tenant.models import Bed
from tests.conftest import requires_db
from tests.kabul_world import BOARD, FIRST_PROTOCOL, SLUG, build_ward, ward_client
from tests.test_admission_api import form, person

pytestmark = [requires_db]


def _ago(**span) -> datetime:
    return datetime.now(timezone.utc) - timedelta(**span)


async def _free_since(db, at: datetime, *beds: uuid.UUID) -> None:
    """The beds — every bed of the ward when none is named — free since `at`: `build_ward` stamps each
    bed's state at its creation, a moment before the test, and a back-dated kabul would meet that bound
    in every test that is not about it."""
    stmt = update(Bed).values(state_updated_at=at)
    if beds:
        stmt = stmt.where(Bed.id.in_(beds))
    await db.execute(stmt.execution_options(synchronize_session=False))
    await db.commit()


@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    built = await build_ward(db_session)
    await _free_since(db_session, _ago(days=1))
    async with ward_client(db_session) as (client, app):
        yield built, client, app


async def _admit(w, client, bed: str = "1", *, at: datetime | None = None, patient: dict | None = None,
                 note: dict | None = None, request_id: uuid.UUID | None = None, who: str = "nurse"):
    """POST /admissions with the Kabul tab's body for `bed`, «Kabul zamanı» `at` when given."""
    sent = {**({} if at is None else {"admission_datetime": at.isoformat()}), **(note or {})}
    return await client.post("/admissions", json=form(w, bed, patient=patient, note=sent, request_id=request_id),
                             headers=w.auth[who])


async def _admitted(w, client, bed: str = "1", **kw) -> dict:
    r = await _admit(w, client, bed, **kw)
    assert r.status_code == 201, r.text
    return r.json()


def _refusal(r) -> tuple[int, str]:
    return r.status_code, r.json()["detail"]["code"]


async def _row_time(db, admission_id: str) -> datetime:
    return (await db.execute(select(Admission.admission_datetime)
                             .where(Admission.id == uuid.UUID(admission_id)))).scalar_one()


async def _state_time(db, bed_id: uuid.UUID) -> datetime:
    return (await db.execute(select(Bed.state_updated_at).where(Bed.id == bed_id))).scalar_one()


def _admit_rows(app) -> list:
    return [r for r in app.state.audit.records(tenant=SLUG, limit=100) if r.event_type == "admission.admit"]


async def _signed(w, client, admission: dict) -> None:
    r = await client.post(f"/admissions/{admission['id']}/sign-off", headers=w.auth["doctor"])
    assert r.status_code == 200, r.text


async def _moved(w, client, admission: dict, bed: str) -> dict:
    r = await client.post(f"/admissions/{admission['id']}/transfer",
                          json={"target_bed_id": str(w.beds[bed].id), "reason": "CLINICAL_NEED"},
                          headers=w.auth["doctor"])
    assert r.status_code == 201, r.text
    return r.json()


async def _discharged(w, client, bed: str, *, admitted_at: datetime, discharge_at: datetime,
                      move_to: str | None = None) -> dict:
    """The person of `bed` admitted there at `admitted_at` (back-dated, so a discharge before now is after
    it), signed, moved to `move_to` when named, discharged at `discharge_at` and the discharge confirmed:
    the stay's last row DISCHARGED with that `discharge_at`, its bed in cleaning."""
    admission = await _admitted(w, client, bed, at=admitted_at)
    await _signed(w, client, admission)
    if move_to is not None:
        admission = await _moved(w, client, admission, move_to)
    r = await client.post(f"/admissions/{admission['id']}/discharge/initiate",
                          json={"disposition": "HOME", "discharge_at": discharge_at.isoformat()},
                          headers=w.auth["doctor"])
    assert r.status_code == 200, r.text
    r = await client.post(f"/admissions/{admission['id']}/discharge/confirm", headers=w.auth["charge"])
    assert r.status_code == 200, r.text
    return admission


# ---------------------------------------------------------------- the time, sent or not (D1, D6)
async def test_an_untouched_form_is_stamped_at_the_save_and_its_audit_row_names_that_time(ward, db_session):
    w, client, app = ward
    before = datetime.now(timezone.utc)
    admission = await _admitted(w, client)
    began = await _row_time(db_session, admission["id"])
    assert before <= began <= datetime.now(timezone.utc)
    (audit,) = _admit_rows(app)
    assert audit.payload["admission_datetime"] == began.isoformat()
    assert "backdated" not in audit.payload


async def test_a_time_two_hours_back_is_the_rows_and_the_answers_and_the_audit_row_says_so(ward, db_session):
    w, client, app = ward
    began = _ago(hours=2)
    before = datetime.now(timezone.utc)
    admission = await _admitted(w, client, at=began)
    assert datetime.fromisoformat(admission["admission_datetime"]) == began
    assert await _row_time(db_session, admission["id"]) == began
    (audit,) = _admit_rows(app)
    assert (audit.payload["admission_datetime"], audit.payload["backdated"]) == (began.isoformat(), True)
    (card,) = (await client.get("/patients", headers=BOARD)).json()["patients"]
    assert datetime.fromisoformat(card["identity"]["updated_at"]) >= before     # the card's stamp: the save


# ---------------------------------------------------------------- six hours (D2)
async def test_six_hours_less_a_minute_is_taken_and_a_minute_more_is_refused_spending_nothing(ward, db_session):
    w, client, _ = ward
    r = await _admit(w, client, at=_ago(hours=6, minutes=1))
    assert _refusal(r) == (422, "field_invalid:admission_datetime"), r.text
    assert (await db_session.execute(select(func.count()).select_from(Admission))).scalar_one() == 0
    admission = await _admitted(w, client, at=_ago(hours=5, minutes=59))
    assert (admission["protocol_no"], admission["patient_number"][-5:]) == (FIRST_PROTOCOL, "00001")


# ---------------------------------------------------------------- the bed (D3)
async def test_a_time_before_the_beds_release_is_refused_and_the_release_itself_is_taken(ward, db_session):
    w, client, _ = ward
    await _discharged(w, client, "1", admitted_at=_ago(hours=3), discharge_at=_ago(hours=1))
    r = await client.post(f"/tenant/beds/{w.beds['1'].id}/release", headers=w.auth["nurse"])
    assert r.status_code == 200, r.text
    released = await _state_time(db_session, w.beds["1"].id)
    other = {"display_name": "Sentetik Başqa"}
    r = await _admit(w, client, "1", at=released - timedelta(minutes=1), patient=other)
    assert _refusal(r) == (409, "admitted_before_bed_free"), r.text
    assert set(r.json()["detail"]) == {"code", "message"}                    # no time, no number, no bed
    admission = await _admitted(w, client, "1", at=released, patient=other)
    assert datetime.fromisoformat(admission["admission_datetime"]) == released


async def test_a_reserved_bed_is_bound_by_the_reservations_start(ward, db_session):
    w, client, _ = ward
    r = await client.post(f"/tenant/beds/{w.beds['3'].id}/reserve", json={"note": "Sentetik planlı kabul"},
                          headers=w.auth["charge"])
    assert r.status_code == 200, r.text
    reserved = await _state_time(db_session, w.beds["3"].id)
    for at, expected in ((reserved - timedelta(minutes=1), 409), (reserved, 201)):
        body = {**form(w, "3", note={"admission_datetime": at.isoformat()}), "confirm_reserved": True}
        r = await client.post("/admissions", json=body, headers=w.auth["charge"])
        assert r.status_code == expected, r.text
    assert r.json()["state"] == "DRAFT"


async def test_an_occupied_bed_is_refused_as_not_available_never_by_its_time(ward):
    w, client, _ = ward
    await _admitted(w, client, "1")
    r = await _admit(w, client, "1", at=_ago(hours=1), patient={"display_name": "Sentetik Başqa"})
    assert _refusal(r) == (409, "bed_not_available"), r.text


# ---------------------------------------------------------------- the person (D4)
async def test_a_time_before_her_last_discharge_is_refused_and_the_discharge_itself_is_taken(ward):
    w, client, _ = ward
    left = _ago(hours=1)
    await _discharged(w, client, "1", admitted_at=_ago(hours=3), discharge_at=left)
    she = {"display_name": person("1")}
    r = await _admit(w, client, "2", at=left - timedelta(minutes=1), patient=she)
    assert _refusal(r) == (409, "admitted_before_discharge"), r.text
    assert set(r.json()["detail"]) == {"code", "message"}                    # her other stay is not shown
    await _admitted(w, client, "2", at=left, patient=she)


async def test_a_moved_stay_binds_by_its_last_row(ward):
    w, client, _ = ward
    left = _ago(hours=1)
    await _discharged(w, client, "1", admitted_at=_ago(hours=3), discharge_at=left, move_to="3")
    r = await _admit(w, client, "2", at=left - timedelta(minutes=1), patient={"display_name": person("1")})
    assert _refusal(r) == (409, "admitted_before_discharge"), r.text


async def test_another_persons_discharge_binds_nothing(ward):
    w, client, _ = ward
    left = _ago(hours=1)
    await _discharged(w, client, "1", admitted_at=_ago(hours=3), discharge_at=left)
    await _admitted(w, client, "2", at=left - timedelta(minutes=1))           # bed 2's own person


async def test_a_row_without_a_digest_binds_nothing(ward, db_session):
    w, client, _ = ward
    left = _ago(hours=1)
    await _discharged(w, client, "1", admitted_at=_ago(hours=3), discharge_at=left)
    await db_session.execute(update(Admission).values(identity_digest=None)
                             .execution_options(synchronize_session=False))  # as written before 0012
    await db_session.commit()
    await _admitted(w, client, "2", at=left - timedelta(minutes=1), patient={"display_name": person("1")})


# ---------------------------------------------------------------- after the look-up (§3.1)
async def test_a_resend_after_the_six_hours_is_answered_with_its_admission(ward, monkeypatch):
    """The first send, 5 h 59 min back, admitted; its answer was lost. Ten minutes on, the same form is
    answered with that admission (200): the six hours and the bed — OCCUPIED since that send — are read
    after the look-up. Another form under the id is still `request_conflict` (A-19)."""
    w, client, _ = ward
    request_id = uuid.uuid4()
    began = _ago(hours=5, minutes=59)
    first = await _admit(w, client, at=began, request_id=request_id)
    assert first.status_code == 201, first.text
    later = datetime.now(timezone.utc) + timedelta(minutes=10)
    monkeypatch.setattr(admission_router, "_now", lambda: later)
    again = await _admit(w, client, at=began, request_id=request_id)
    assert again.status_code == 200, again.text
    assert again.json()["id"] == first.json()["id"]
    other = await _admit(w, client, at=began, request_id=request_id,
                         note={"admission_diagnosis_free_text": "Sentetik tanı, düzeltilmiş"})
    assert _refusal(other) == (409, "request_conflict"), other.text


async def test_a_non_physician_attending_is_said_before_a_time_seven_hours_back(ward):
    w, client, _ = ward
    r = await _admit(w, client, at=_ago(hours=7), note={"attending_physician_id": str(w.users["nurse"].id)})
    assert _refusal(r) == (422, "field_invalid:attending_physician_id"), r.text


async def test_her_open_admission_is_said_before_her_last_discharge(ward):
    w, client, _ = ward
    left = _ago(hours=1)
    await _discharged(w, client, "1", admitted_at=_ago(hours=3), discharge_at=left)
    she = {"display_name": person("1")}
    await _admitted(w, client, "2", patient=she)                              # open again
    r = await _admit(w, client, "10", at=left - timedelta(minutes=1), patient=she)
    assert _refusal(r) == (409, "duplicate_open_admission"), r.text


async def test_a_closed_bed_is_said_before_its_time(ward, db_session):
    w, client, _ = ward
    ten = w.beds["10"].id
    await _free_since(db_session, _ago(hours=1), ten)
    await db_session.execute(update(Bed).where(Bed.id == ten).values(is_active=False)
                             .execution_options(synchronize_session=False))
    await db_session.commit()
    r = await _admit(w, client, "10", at=_ago(hours=2))
    assert _refusal(r) == (409, "bed_closed"), r.text

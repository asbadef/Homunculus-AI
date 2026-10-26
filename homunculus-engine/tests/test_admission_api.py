# homunculus-engine/tests/test_admission_api.py
"""POST and GET /admissions as Group 2 · B1a makes them (spec §3.1, §4.1, §4.4, §4.5): the whole
form in one transaction, the bed locked, open, in the caller's units and AVAILABLE, a fresh
patient number, the card on its bed and the weight and comorbidities in the engine after the
commit — each reported, none undoing the admission — and every refusal with its code and nothing
written. A form sent again under its `request_id` is answered with the admission it made, never
admitted twice (amendment A-19); the birth date is checked against the hospital's own date
(A-10, A-16); the bed lock lets a row pointing at the bed through (A-26). Postgres (`db_session`).
Synthetic ward: tests/kabul_world.py."""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import pytest
import pytest_asyncio
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker

from homunculus.admission import router as admission_router
from homunculus.admission import service
from homunculus.admission.boardlink import BoardLink
from homunculus.admission.models import Admission, NurseBedAssignment, Patient
from homunculus.tenant.models import Bed, BedState
from tests.conftest import requires_db
from tests.kabul_world import BOARD, SLUG, build_ward, ward_client

pytestmark = [requires_db]


@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    built = await build_ward(db_session)
    async with ward_client(db_session) as (client, app):
        yield built, client, app


def form(w, bed: str = "1", unit: str = "rea", patient: dict | None = None,
         note: dict | None = None, request_id: uuid.UUID | None = None) -> dict:
    """The Kabul tab's body: every required field, the bed the picker chose."""
    body = {
        "patient": {"display_name": "Sentetik Hasta", "date_of_birth": "1970-05-05", "sex": "female",
                    "consent": "KVKK_SIGNED", "national_id": "5ab12cd", "phone": "+994 50 123 45 67",
                    "father_name": "Sentetik Ata", **(patient or {})},
        "note": {"admitting_unit_id": str(w.units[unit].id), "bed_id": str(w.beds[bed].id),
                 "admission_type": "ICU", "admission_diagnosis_free_text": "Sentetik tanı",
                 "allergies_text": "Penisilin", "blood_group": "A_POS", "weight_kg": 72.5,
                 "height_cm": 171, "comorbidity_codes": ["copd"], **(note or {})},
    }
    if request_id is not None:
        body["request_id"] = str(request_id)
    return body


async def _count(db, model) -> int:
    return (await db.execute(select(func.count()).select_from(model))).scalar_one()


async def test_an_admission_is_written_numbered_and_put_on_the_board(ward, db_session):
    w, client, app = ward
    bed_id, unit_id = w.beds["1"].id, w.units["rea"].id
    r = await client.post("/admissions", json=form(w), headers=w.auth["nurse"])
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["patient_number"] == f"H{body['created_at'][2:4]}00001"
    assert body["state"] == "DRAFT" and body["admission_type"] == "ICU"
    assert body["engine"] == {"weight": "ok", "profile": "ok", "board": "ok"}

    db_session.expire_all()
    bed_state = (await db_session.execute(select(Bed.state).where(Bed.id == bed_id))).scalar_one()
    assert bed_state == BedState.OCCUPIED
    patient = (await db_session.execute(select(Patient))).scalar_one()
    assert (patient.national_id, patient.consent.value, patient.father_name) == \
        ("5AB12CD", "KVKK_SIGNED", "Sentetik Ata")
    raw = (await db_session.execute(text("SELECT national_id, phone FROM patients"))).one()
    assert all(value.startswith("enc::") for value in raw)        # encrypted at rest

    (card,) = (await client.get("/patients", headers=BOARD)).json()["patients"]
    assert card["patient_id"] == body["patient_number"]
    assert (card["identity"]["bed_id"], card["identity"]["unit_id"]) == (str(bed_id), str(unit_id))
    assert (card["identity"]["bed_label"], card["identity"]["display_name"]) == ("1", "Sentetik Hasta")
    assert card["meds"]["weight_kg"] == 72.5
    engine = app.state.board_link._engine(SLUG)
    assert engine.profile(body["patient_number"]).comorbidities == frozenset({"copd"})

    rows = [r for r in app.state.audit.records(tenant=SLUG, limit=50) if r.event_type == "admission.admit"]
    assert [r.patient_id for r in rows] == [body["patient_number"]]
    assert rows[0].payload == {"admission_id": body["id"], "bed_id": str(bed_id),
                               "unit_id": str(unit_id), "actor": "nurse@kabul.example.com"}
    assert "Sentetik" not in repr([r.payload for r in app.state.audit.records(tenant=SLUG, limit=50)])


async def test_the_next_admission_takes_the_next_number(ward):
    w, client, _ = ward
    first = (await client.post("/admissions", json=form(w, "1"), headers=w.auth["nurse"])).json()
    second = (await client.post("/admissions", json=form(w, "2"), headers=w.auth["charge"])).json()
    assert int(second["patient_number"][3:]) == int(first["patient_number"][3:]) + 1


async def test_without_a_weight_or_a_code_those_engine_parts_are_skipped(ward):
    w, client, _ = ward
    body = form(w, note={"weight_kg": None, "comorbidity_codes": []})
    r = await client.post("/admissions", json=body, headers=w.auth["nurse"])
    assert r.status_code == 201
    assert r.json()["engine"] == {"weight": "skipped", "profile": "skipped", "board": "ok"}


async def test_an_engine_write_that_fails_leaves_the_admission_and_says_so(ward, db_session,
                                                                           monkeypatch):
    w, client, _ = ward

    async def broken(self, *args, **kwargs):
        raise RuntimeError("the engine is not answering")

    monkeypatch.setattr(BoardLink, "chart_weight", broken)
    r = await client.post("/admissions", json=form(w), headers=w.auth["nurse"])
    assert r.status_code == 201, r.text
    assert r.json()["engine"] == {"weight": "failed", "profile": "ok", "board": "ok"}
    assert await _count(db_session, Admission) == 1


@pytest.mark.parametrize(("who", "bed", "unit", "status", "code"), [
    ("nurse_b", "1", "rea", 403, "out_of_scope"),
    ("nurse", "1", "neo", 422, "field_invalid:admitting_unit_id"),
])
async def test_a_bed_outside_the_callers_units_or_its_own_unit_is_refused(ward, db_session, who,
                                                                         bed, unit, status, code):
    w, client, _ = ward
    r = await client.post("/admissions", json=form(w, bed, unit), headers=w.auth[who])
    assert (r.status_code, r.json()["detail"]["code"]) == (status, code)
    assert await _count(db_session, Patient) == 0


async def test_an_occupied_bed_and_a_closed_one_are_refused_with_their_codes(ward, db_session):
    w, client, _ = ward
    assert (await client.post("/admissions", json=form(w, "1"), headers=w.auth["nurse"])).status_code == 201
    r = await client.post("/admissions", json=form(w, "1"), headers=w.auth["nurse"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "bed_not_available")

    admin = w.auth["admin"]
    closings = [(f"/tenant/beds/{w.beds['2'].id}", False),
                (f"/tenant/beds/{w.beds['N1'].id}", False),
                (f"/tenant/rooms/{w.rooms['n1'].id}", False),
                (f"/tenant/beds/{w.beds['N1'].id}", True)]
    for path, active in closings:
        done = await client.patch(path, json={"is_active": active}, headers=admin)
        assert done.status_code == 200, done.text
    r = await client.post("/admissions", json=form(w, "2"), headers=w.auth["nurse"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "bed_closed")
    r = await client.post("/admissions", json=form(w, "N1", "neo"), headers=w.auth["nurse_b"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "bed_closed")    # its room is closed
    assert await _count(db_session, Patient) == 1


async def test_a_form_missing_a_required_field_is_refused_and_writes_nothing(ward, db_session):
    w, client, _ = ward
    bed_id = w.beds["1"].id
    for patient, note, field in (({"consent": None}, {}, "consent"),
                                 ({}, {"allergies_text": None}, "allergies_text"),
                                 ({"national_id": "12"}, {}, "national_id")):
        r = await client.post("/admissions", json=form(w, patient=patient, note=note),
                              headers=w.auth["nurse"])
        assert (r.status_code, r.json()["detail"]["code"]) == (422, f"field_invalid:{field}")
    assert await _count(db_session, Patient) == 0
    db_session.expire_all()
    assert (await db_session.execute(select(Bed.state).where(Bed.id == bed_id))).scalar_one() \
        == BedState.AVAILABLE


async def test_a_physician_does_not_admit(ward):
    w, client, _ = ward
    r = await client.post("/admissions", json=form(w), headers=w.auth["doctor"])
    assert r.status_code == 403 and r.json()["detail"] == "permission required: admissions.admit"


async def test_two_admissions_into_one_bed_at_once_admit_one_patient(ward, db_session):
    """The bed row is locked for the transaction: the second finds it OCCUPIED."""
    w, client, _ = ward
    answers = await asyncio.gather(
        client.post("/admissions", json=form(w, patient={"display_name": "Sentetik Bir"}),
                    headers=w.auth["nurse"]),
        client.post("/admissions", json=form(w, patient={"display_name": "Sentetik İki"}),
                    headers=w.auth["charge"]))
    assert sorted(r.status_code for r in answers) == [201, 409]
    refused = next(r for r in answers if r.status_code == 409)
    assert refused.json()["detail"]["code"] == "bed_not_available"
    assert await _count(db_session, Patient) == 1


async def test_the_list_carries_names_filters_by_state_and_keeps_to_the_callers_units(ward):
    w, client, _ = ward
    rea = (await client.post("/admissions", json=form(w, "1"), headers=w.auth["nurse"])).json()
    neo = (await client.post("/admissions", json=form(w, "N1", "neo"),
                             headers=w.auth["nurse_b"])).json()

    rows = (await client.get("/admissions", params={"state": ["DRAFT", "ACTIVE"]},
                             headers=w.auth["nurse"])).json()
    assert [(r["patient_number"], r["display_name"], r["bed_label"], r["room_name"], r["unit_name"])
            for r in rows] == [(rea["patient_number"], "Sentetik Hasta", "1", "Otaq 1", "Reanimasiya")]
    everyone = (await client.get("/admissions", headers=w.auth["admin"])).json()
    assert {r["patient_number"] for r in everyone} == {rea["patient_number"], neo["patient_number"]}
    none = (await client.get("/admissions", params={"state": "DISCHARGED"},
                             headers=w.auth["admin"])).json()
    assert none == []


async def test_an_audit_store_failing_after_the_commit_still_admits_and_logs(ward, db_session,
                                                                            monkeypatch, caplog):
    """Amendment A-26: the admission has committed before its row is written, so a failing audit
    store never turns it into a 500. The failure is logged at ERROR with the event, the ids, the
    number and the actor — never a name, never the store's own words."""
    w, client, app = ward

    def store_down(event):
        raise RuntimeError("audit store down while writing Sentetik Hasta")

    monkeypatch.setattr(app.state.audit, "append", store_down)
    caplog.set_level(logging.ERROR, logger="homunculus.admission.trail")
    r = await client.post("/admissions", json=form(w), headers=w.auth["nurse"])
    assert r.status_code == 201, r.text
    assert await _count(db_session, Admission) == 1

    (logged,) = [rec for rec in caplog.records
                 if rec.name == "homunculus.admission.trail" and rec.levelno == logging.ERROR]
    message = logged.getMessage()
    assert "admission.admit" in message and r.json()["id"] in message, message
    assert r.json()["patient_number"] in message and "nurse@kabul.example.com" in message, message
    assert "Sentetik" not in message, message


# ---------------------------------------------------------------- A-26: the bed lock's strength
async def test_the_admissions_bed_lock_lets_a_row_pointing_at_the_bed_through(ward, db_session,
                                                                             monkeypatch):
    """Amendment A-26: every bed lock the admission takes is FOR NO KEY UPDATE, as the structure
    routes' are. An insert of a row pointing at the bed (here a nurse's bed assignment) takes FOR
    KEY SHARE on it: it goes through while the admission holds its bed — where FOR UPDATE would
    hold it until the admission commits. The admission is paused after its rows are written and
    before its commit, so every lock it takes on the bed is held while the insert runs."""
    w, client, _ = ward
    reached, gate = asyncio.Event(), asyncio.Event()
    real = service.create_draft_admission

    async def paused(*args, **kwargs):
        admission = await real(*args, **kwargs)
        reached.set()
        await gate.wait()
        return admission

    monkeypatch.setattr(service, "create_draft_admission", paused)
    admitting = asyncio.create_task(
        client.post("/admissions", json=form(w), headers=w.auth["nurse"]))
    try:
        await asyncio.wait_for(reached.wait(), timeout=10)
        maker = async_sessionmaker(db_session.bind, expire_on_commit=False)
        start = datetime.now(timezone.utc)
        async with maker() as other:
            await other.execute(text("SET LOCAL lock_timeout = '2s'"))
            other.add(NurseBedAssignment(unit_id=w.units["rea"].id, bed_id=w.beds["1"].id,
                                         nurse_id=w.users["nurse"].id, shift_start=start,
                                         shift_end=start + timedelta(hours=8)))
            await other.commit()          # a lock timeout here under FOR UPDATE
    finally:
        gate.set()
    r = await admitting
    assert r.status_code == 201, r.text
    assert await _count(db_session, NurseBedAssignment) == 1


async def test_an_admission_and_structure_writes_in_its_unit_at_once_all_answer(ward):
    """A-26: an admission, a relabel of its bed and the close of another bed of its unit, sent at
    once, all answer — the unit and bed locks never wait on each other into a deadlock (a 500)."""
    w, client, _ = ward
    admin = w.auth["admin"]
    answers = await asyncio.gather(
        client.post("/admissions", json=form(w, "1"), headers=w.auth["nurse"]),
        client.patch(f"/tenant/beds/{w.beds['1'].id}", json={"label": "1A"}, headers=admin),
        client.patch(f"/tenant/beds/{w.beds['2'].id}", json={"is_active": False}, headers=admin))
    assert [r.status_code for r in answers] == [201, 200, 200], [r.text for r in answers]


# ---------------------------------------------------------------- A-19: the form sent again
async def test_a_form_sent_again_under_its_request_id_is_answered_with_its_admission(
        ward, db_session, monkeypatch):
    """The second send of one form (same `request_id`, same body) admits nobody: it answers 200
    with the first answer's body — the engine report as it was, a failed part included — and the
    next admission takes the next number, as if the resend had never come."""
    w, client, _ = ward

    async def broken(self, *args, **kwargs):
        raise RuntimeError("the engine is not answering")

    monkeypatch.setattr(BoardLink, "chart_weight", broken)
    body = form(w, request_id=uuid.uuid4())
    first = await client.post("/admissions", json=body, headers=w.auth["nurse"])
    assert first.status_code == 201, first.text
    assert first.json()["engine"] == {"weight": "failed", "profile": "ok", "board": "ok"}

    again = await client.post("/admissions", json=body, headers=w.auth["nurse"])
    assert again.status_code == 200, again.text
    assert again.json() == first.json()
    assert (await _count(db_session, Patient), await _count(db_session, Admission)) == (1, 1)

    nxt = await client.post("/admissions", json=form(w, "2"), headers=w.auth["nurse"])
    assert int(nxt.json()["patient_number"][3:]) == int(first.json()["patient_number"][3:]) + 1


async def test_a_resend_after_a_lost_answer_gives_the_same_number(ward, db_session, monkeypatch):
    """The first send commits and its answer never comes back (here the server fails after the
    commit, before it answers). The resend finds the admission and answers with its number. What
    reached the engine was never recorded, so no part asked for is claimed to have landed."""
    w, client, _ = ward
    body = form(w, request_id=uuid.uuid4())

    async def lost(*args, **kwargs):
        raise RuntimeError("the answer is lost on the way")

    to_board = admission_router._to_board
    monkeypatch.setattr(admission_router, "_to_board", lost)
    with pytest.raises(RuntimeError, match="lost on the way"):
        await client.post("/admissions", json=body, headers=w.auth["nurse"])
    monkeypatch.setattr(admission_router, "_to_board", to_board)
    (number,) = (await db_session.execute(select(Patient.patient_number))).scalars()

    again = await client.post("/admissions", json=body, headers=w.auth["nurse"])
    assert again.status_code == 200, again.text
    assert again.json()["patient_number"] == number
    assert again.json()["engine"] == {"weight": "failed", "profile": "failed", "board": "failed"}
    assert (await _count(db_session, Patient), await _count(db_session, Admission)) == (1, 1)


async def test_two_sends_of_one_form_at_once_admit_once_and_answer_alike(ward, db_session):
    """Sent twice at once under one `request_id`: one admission, one number; the send that came
    second waits for the first's answer and gives the same body (200 beside the first's 201)."""
    w, client, _ = ward
    body = form(w, request_id=uuid.uuid4())
    answers = await asyncio.gather(
        client.post("/admissions", json=body, headers=w.auth["nurse"]),
        client.post("/admissions", json=body, headers=w.auth["nurse"]))
    assert sorted(r.status_code for r in answers) == [200, 201], [r.text for r in answers]
    assert answers[0].json() == answers[1].json()
    assert answers[0].json()["engine"] == {"weight": "ok", "profile": "ok", "board": "ok"}
    assert (await _count(db_session, Patient), await _count(db_session, Admission)) == (1, 1)


@pytest.mark.parametrize(("bed", "patient"), [("2", {}), ("1", {"display_name": "Sentetik Başka"})],
                         ids=["another bed", "another name, same bed"])
async def test_one_request_id_with_another_form_is_refused(ward, db_session, bed, patient):
    w, client, _ = ward
    request_id, other_bed = uuid.uuid4(), w.beds["2"].id
    first = await client.post("/admissions", json=form(w, request_id=request_id),
                              headers=w.auth["nurse"])
    assert first.status_code == 201, first.text
    r = await client.post("/admissions", json=form(w, bed, patient=patient, request_id=request_id),
                          headers=w.auth["nurse"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "request_conflict")
    assert await _count(db_session, Patient) == 1
    db_session.expire_all()
    assert (await db_session.execute(select(Bed.state).where(Bed.id == other_bed))).scalar_one() \
        == BedState.AVAILABLE


async def test_one_request_id_sent_at_once_with_two_forms_admits_one(ward, db_session):
    """Two different forms under one `request_id` at once (two beds, so no bed lock orders them):
    one is admitted, the other refused `request_conflict` — never two admissions."""
    w, client, _ = ward
    request_id = uuid.uuid4()
    answers = await asyncio.gather(
        client.post("/admissions", json=form(w, "1", request_id=request_id), headers=w.auth["nurse"]),
        client.post("/admissions", json=form(w, "2", request_id=request_id), headers=w.auth["nurse"]))
    assert sorted(r.status_code for r in answers) == [201, 409], [r.text for r in answers]
    refused = next(r for r in answers if r.status_code == 409)
    assert refused.json()["detail"]["code"] == "request_conflict"
    assert (await _count(db_session, Patient), await _count(db_session, Admission)) == (1, 1)


async def test_forms_without_a_request_id_or_each_with_its_own_all_admit(ward, db_session):
    """`request_id` is optional: two forms with none are two admissions (the dashboard sends none
    until Task 19b); two forms with two ids, two admissions."""
    w, client, _ = ward
    for bed, request_id in (("1", None), ("2", None), ("10", uuid.uuid4()), ("3", uuid.uuid4())):
        r = await client.post("/admissions", json=form(w, bed, request_id=request_id),
                              headers=w.auth["nurse"])
        assert r.status_code == 201, r.text
    assert await _count(db_session, Admission) == 4


# ---------------------------------------------------------------- A-10, A-16: the hospital's date
NIGHT = datetime(2026, 3, 1, 21, 30, tzinfo=timezone.utc)   # 01:30 on 2 March in Baku (UTC+4)
#: Born on 3 March: one day after Baku's date (the form's day of slack), two after UTC's.
NEWBORN = {"date_of_birth": "2026-03-03"}


def _baku_only(name: str):
    """A time zone database holding Asia/Baku alone (no DST since 2016), so the test does not
    depend on the machine's own tz data — Windows has none without the `tzdata` package."""
    if name == "Asia/Baku":
        return timezone(timedelta(hours=4), "Asia/Baku")
    raise ZoneInfoNotFoundError(f"No time zone found with key {name}")


@pytest.mark.parametrize(("zone", "status"), [("Asia/Baku", 201), ("UTC", 422),
                                              ("Nowhere/Nada", 422)])
async def test_the_birth_date_is_checked_against_the_hospitals_own_date(ward, db_session,
                                                                       monkeypatch, caplog,
                                                                       zone, status):
    """At 21:30 UTC on 1 March it is 2 March in Baku: a child born on 3 March is one day ahead
    of Baku's date (allowed) and two ahead of UTC's (refused). A zone the server does not know is
    read as UTC, with a warning — never a 500."""
    w, client, _ = ward
    w.tenant.timezone = zone
    await db_session.commit()
    monkeypatch.setattr(admission_router, "ZoneInfo", _baku_only)
    monkeypatch.setattr(admission_router, "_now", lambda: NIGHT)
    caplog.set_level(logging.WARNING, logger="homunculus.admission.router")

    r = await client.post("/admissions", json=form(w, patient=NEWBORN, note={"weight_kg": 3.2}),
                          headers=w.auth["nurse"])
    assert r.status_code == status, r.text
    if status == 422:
        assert r.json()["detail"]["code"] == "field_invalid:date_of_birth"
    warned = [rec.getMessage() for rec in caplog.records if rec.levelno == logging.WARNING
              and rec.name == "homunculus.admission.router"]
    assert bool(warned) == (zone == "Nowhere/Nada"), warned


def test_the_hospitals_date_is_read_in_its_own_zone():
    """`hospital_today` with the real time zone database (skipped where there is none)."""
    try:
        ZoneInfo("Asia/Baku")
    except ZoneInfoNotFoundError:
        pytest.skip("no time zone data on this machine (Windows without the tzdata package)")
    assert admission_router.hospital_today("Asia/Baku", NIGHT) == date(2026, 3, 2)
    assert admission_router.hospital_today("UTC", NIGHT) == date(2026, 3, 1)
    assert admission_router.hospital_today("", NIGHT) == date(2026, 3, 1)

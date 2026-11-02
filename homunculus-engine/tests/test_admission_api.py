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
from sqlalchemy import event, func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from homunculus.admission import router as admission_router
from homunculus.admission import service
from homunculus.admission.boardlink import BoardLink
from homunculus.admission.models import Admission, AdmissionState, NurseBedAssignment, Patient
from homunculus.scope.models import StaffScope
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


def person(bed: str = "1") -> str:
    """The synthetic person `form` admits into a bed: bed 1's "Sentetik Hasta", bed 2's "Sentetik
    Hasta 2" … — one person per bed, as the server refuses a second open admission of one person
    (A-37). A test admitting one person twice names her."""
    return "Sentetik Hasta" if bed == "1" else f"Sentetik Hasta {bed}"


def form(w, bed: str = "1", unit: str = "rea", patient: dict | None = None,
         note: dict | None = None, request_id: uuid.UUID | None = None) -> dict:
    """The Kabul tab's body: every required field, the bed the picker chose, its own person."""
    body = {
        "patient": {"display_name": person(bed), "date_of_birth": "1970-05-05", "sex": "female",
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
    r = await client.post("/admissions", json=form(w, "1", patient={"display_name": "Sentetik Başqa"}),
                          headers=w.auth["nurse"])
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


async def test_the_list_holds_open_admissions_unless_asked_and_stops_at_its_cap(
        ward, db_session, monkeypatch, caplog):
    """Without `state` the list holds the open admissions only (DRAFT, ACTIVE and the two
    pending states); a closed one is listed when its state is asked for. Never more than
    `ADMISSION_LIST_CAP` rows, the newest first — and a list cut there says so (Task 8
    re-review): the header `X-Result-Truncated: 1` for the screen, a WARNING for the log. A list
    that holds exactly the cap is whole, and says nothing."""
    w, client, _ = ward
    gone = (await client.post("/admissions", json=form(w, "1"), headers=w.auth["nurse"])).json()
    here = (await client.post("/admissions", json=form(w, "2"), headers=w.auth["nurse"])).json()
    await db_session.execute(update(Admission).where(Admission.id == uuid.UUID(gone["id"]))
                             .values(state=AdmissionState.DISCHARGED))
    await db_session.commit()

    open_rows = await client.get("/admissions", headers=w.auth["nurse"])
    assert [r["id"] for r in open_rows.json()] == [here["id"]]
    assert "x-result-truncated" not in open_rows.headers
    closed = (await client.get("/admissions", params={"state": "DISCHARGED"},
                               headers=w.auth["nurse"])).json()
    assert [r["id"] for r in closed] == [gone["id"]]

    monkeypatch.setattr(admission_router, "ADMISSION_LIST_CAP", 1)
    caplog.set_level(logging.WARNING, logger="homunculus.admission.router")
    whole = await client.get("/admissions", headers=w.auth["nurse"])      # one row, the cap: whole
    assert [r["id"] for r in whole.json()] == [here["id"]]
    def warnings() -> list[str]:
        return [rec.getMessage() for rec in caplog.records if rec.levelno == logging.WARNING
                and rec.name == "homunculus.admission.router"]

    assert "x-result-truncated" not in whole.headers and warnings() == []
    capped = await client.get("/admissions", params={"state": ["DRAFT", "DISCHARGED"]},
                              headers=w.auth["nurse"])
    assert [r["id"] for r in capped.json()] == [here["id"]]
    assert capped.headers.get("x-result-truncated") == "1", capped.headers
    (warned,) = warnings()
    assert "cap (1)" in warned and "nurse@kabul.example.com" in warned, warned
    assert "Sentetik" not in warned


async def test_a_bed_grant_lists_that_beds_admission_beside_its_units(ward, db_session):
    """The caller's units and beds are filtered in the query: a Neonatal nurse granted bed 2 of
    Reanimasiya too sees the Neonatal admission and bed 2's, and not bed 1's."""
    w, client, _ = ward
    one = (await client.post("/admissions", json=form(w, "1"), headers=w.auth["nurse"])).json()
    two = (await client.post("/admissions", json=form(w, "2"), headers=w.auth["nurse"])).json()
    neo = (await client.post("/admissions", json=form(w, "N1", "neo"),
                             headers=w.auth["nurse_b"])).json()
    db_session.add(StaffScope(tenant_id=w.tenant.id, user_id=w.users["nurse_b"].id,
                              bed_id=str(w.beds["2"].id)))
    await db_session.commit()

    rows = (await client.get("/admissions", headers=w.auth["nurse_b"])).json()
    assert {r["id"] for r in rows} == {two["id"], neo["id"]}
    assert one["id"] not in {r["id"] for r in rows}


async def test_the_list_reads_no_encrypted_field_it_does_not_show(ward, db_session):
    """A row shows the patient's number and name: the query reads those two of the patient's
    columns and none of the other encrypted ones (the FİN, the phone …)."""
    w, client, _ = ward
    assert (await client.post("/admissions", json=form(w), headers=w.auth["nurse"])).status_code == 201
    seen: list[str] = []

    def spy(conn, cursor, statement, parameters, context, executemany):
        if "FROM admissions" in statement and "patients" in statement:
            seen.append(statement)

    engine = db_session.bind.sync_engine
    event.listen(engine, "before_cursor_execute", spy)
    try:
        rows = (await client.get("/admissions", headers=w.auth["nurse"])).json()
    finally:
        event.remove(engine, "before_cursor_execute", spy)
    assert [r["display_name"] for r in rows] == ["Sentetik Hasta"]
    (statement,) = seen
    assert "patients.patient_number" in statement and "patients.display_name" in statement
    for column in ("national_id", "phone", "father_name", "date_of_birth", "passport_no"):
        assert f"patients.{column}" not in statement, column


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


async def test_a_read_back_that_fails_after_the_commit_still_audits_and_admits(
        ward, db_session, monkeypatch, caplog):
    """The admission's audit row is written right after the commit, before anything that can
    still fail: a database that drops away when the admission is read back loses neither the
    admission nor its row. The answer is made from what was written, and the failure logged."""
    w, client, app = ward

    async def gone(self, *args, **kwargs):
        raise RuntimeError("the database went away")

    monkeypatch.setattr(AsyncSession, "refresh", gone)
    caplog.set_level(logging.ERROR, logger="homunculus.admission.router")
    r = await client.post("/admissions", json=form(w), headers=w.auth["nurse"])
    assert r.status_code == 201, r.text
    assert r.json()["engine"] == {"weight": "ok", "profile": "ok", "board": "ok"}

    (row,) = [rec for rec in app.state.audit.records(tenant=SLUG, limit=50)
              if rec.event_type == "admission.admit"]
    assert (row.patient_id, row.payload["admission_id"]) == (r.json()["patient_number"], r.json()["id"])
    stored = await db_session.get(Admission, uuid.UUID(r.json()["id"]))
    assert stored is not None and stored.state.value == r.json()["state"] == "DRAFT"
    assert any(r.json()["patient_number"] in rec.getMessage() for rec in caplog.records
               if rec.levelno == logging.ERROR and rec.name == "homunculus.admission.router")


async def test_without_a_board_link_the_asked_parts_are_failed_never_skipped(
        ward, monkeypatch, caplog):
    """An app built without its BoardLink reached nothing: every part the form asked for is
    `failed` (X53: `skipped` means "not asked"), and it is logged at ERROR. A part not asked for
    stays `skipped`; the card is always asked for."""
    w, client, app = ward
    monkeypatch.setattr(app.state, "board_link", None)
    caplog.set_level(logging.ERROR, logger="homunculus.admission.router")
    r = await client.post("/admissions", json=form(w, "1"), headers=w.auth["nurse"])
    assert r.status_code == 201, r.text
    assert r.json()["engine"] == {"weight": "failed", "profile": "failed", "board": "failed"}
    r = await client.post("/admissions", json=form(w, "2", note={"weight_kg": None,
                                                                 "comorbidity_codes": []}),
                          headers=w.auth["nurse"])
    assert r.json()["engine"] == {"weight": "skipped", "profile": "skipped", "board": "failed"}
    errors = [rec.getMessage() for rec in caplog.records
              if rec.levelno == logging.ERROR and rec.name == "homunculus.admission.router"]
    assert len(errors) == 2 and r.json()["patient_number"] in errors[1], errors


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


async def test_a_resend_after_a_lost_answer_gives_the_same_number_and_puts_the_card_up(
        ward, db_session, monkeypatch):
    """The first send commits and dies before its board writes (here the server fails after the
    commit, before `_to_board`): no card, no report. The resend finds the admission, answers with
    its number and writes the idempotent parts again — the card on its bed, the comorbidities —
    but not the weight, which it answers `failed` so the nurse checks it (charting it again could
    chart it twice). The outcome is recorded: a third send answers from it and writes nothing."""
    w, client, app = ward
    body = form(w, request_id=uuid.uuid4())

    async def lost(*args, **kwargs):
        raise RuntimeError("the answer is lost on the way")

    to_board = admission_router._to_board
    monkeypatch.setattr(admission_router, "_to_board", lost)
    with pytest.raises(RuntimeError, match="lost on the way"):
        await client.post("/admissions", json=body, headers=w.auth["nurse"])
    monkeypatch.setattr(admission_router, "_to_board", to_board)
    (number,) = (await db_session.execute(select(Patient.patient_number))).scalars()
    assert (await client.get("/patients", headers=BOARD)).json()["patients"] == []

    again = await client.post("/admissions", json=body, headers=w.auth["nurse"])
    assert again.status_code == 200, again.text
    assert again.json()["patient_number"] == number
    assert again.json()["engine"] == {"weight": "failed", "profile": "ok", "board": "ok"}
    assert (await _count(db_session, Patient), await _count(db_session, Admission)) == (1, 1)

    (card,) = (await client.get("/patients", headers=BOARD)).json()["patients"]
    assert (card["patient_id"], card["identity"]["bed_id"]) == (number, str(w.beds["1"].id))
    assert (card.get("meds") or {}).get("weight_kg") is None        # never charted twice
    assert app.state.board_link._engine(SLUG).profile(number).comorbidities == frozenset({"copd"})
    db_session.expire_all()
    assert (await db_session.execute(select(Admission.engine_writes))).scalar_one() == \
        again.json()["engine"]

    third = await client.post("/admissions", json=body, headers=w.auth["nurse"])
    assert third.content == again.content
    profiles = app.state.audit.records(tenant=SLUG, event_type="profile", limit=50)
    assert [r.patient_id for r in profiles] == [number]               # written once, by the resend


async def _lose_the_first_answer(client, monkeypatch, w, body) -> None:
    """The first send of `body` commits its admission and dies before its board writes: no card,
    no recorded report — what a resend then finds."""
    async def lost(*args, **kwargs):
        raise RuntimeError("the answer is lost on the way")

    with monkeypatch.context() as patched:
        patched.setattr(admission_router, "_to_board", lost)
        with pytest.raises(RuntimeError, match="lost on the way"):
            await client.post("/admissions", json=body, headers=w.auth["nurse"])


async def test_a_resend_after_the_patient_was_discharged_puts_no_card_up(ward, db_session,
                                                                         monkeypatch):
    """The resend's retry writes the board again only for an admission still open (Task 8
    re-review): one discharged since the lost answer keeps the board it has — no card — and every
    part the form asked for is answered `failed`, nothing being known to have landed."""
    w, client, _ = ward
    body = form(w, request_id=uuid.uuid4())
    await _lose_the_first_answer(client, monkeypatch, w, body)
    await db_session.execute(update(Admission).values(state=AdmissionState.DISCHARGED))
    await db_session.commit()

    again = await client.post("/admissions", json=body, headers=w.auth["nurse"])
    assert again.status_code == 200, again.text
    assert again.json()["engine"] == {"weight": "failed", "profile": "failed", "board": "failed"}
    assert (await client.get("/patients", headers=BOARD)).json()["patients"] == []


async def test_a_discharge_landing_while_a_resend_writes_the_card_again_keeps_the_card_off(
        ward, db_session, monkeypatch):
    """Task 8 re-review, A-29: the resend's retry has read the admission open and ended its
    transaction; before it writes the card again, the discharge commits and writes its tombstone.
    The card, stamped after the tombstone, would be taken by the identity store and the patient
    would lie on a bed in cleaning for good. BoardLink refuses it (`put_identity`); the resend
    answers the card `failed`, and no card is on the board."""
    w, client, app = ward
    body = form(w, request_id=uuid.uuid4())
    await _lose_the_first_answer(client, monkeypatch, w, body)
    (number,) = (await db_session.execute(select(Patient.patient_number))).scalars()

    reached, gate = asyncio.Event(), asyncio.Event()
    attempt = admission_router._attempt

    async def held(number_, what, write):
        if what == "identity (again)":        # past the "still open" read, the card not yet built
            reached.set()
            await gate.wait()
        return await attempt(number_, what, write)

    monkeypatch.setattr(admission_router, "_attempt", held)
    resend = asyncio.create_task(client.post("/admissions", json=body, headers=w.auth["nurse"]))
    try:
        await asyncio.wait_for(reached.wait(), timeout=10)
        await db_session.execute(update(Admission).values(state=AdmissionState.DISCHARGED))
        await db_session.commit()
        await app.state.board_link.discharge_identity(SLUG, number)
    finally:
        gate.set()
    again = await resend
    assert again.status_code == 200, again.text
    assert again.json()["engine"]["board"] == "failed"
    assert (await client.get("/patients", headers=BOARD)).json()["patients"] == []
    assert app.state.board_link.is_discharged(SLUG, number)


async def test_the_admission_and_a_resends_retry_reach_the_shadow_lanes_hooks(ward, monkeypatch):
    """Aşama B × B1a through the routes: the admission drops the monitor strip's cached occupants
    after its identity write, then mirrors its weight and its comorbidities to the shadow engine,
    and its card goes out as the app builds it, `shadow` key included (None: no shadow lane in this
    app). A resend's retry — the first send's answer lost — drops the occupants again after the card
    it writes again, and mirrors the comorbidities, never the weight it does not chart twice."""
    w, client, app = ward
    link = app.state.board_link
    heard: list[tuple] = []
    monkeypatch.setattr(link, "_occupancy_reset", lambda hospital: heard.append(("reset", hospital)))
    monkeypatch.setattr(link, "_mirror", lambda hospital, obs, now: heard.append(
        ("mirror", hospital, obs.code.value, obs.value)))
    monkeypatch.setattr(link, "_mirror_profile", lambda hospital, profile: heard.append(
        ("profile", hospital, profile.comorbidities)))
    queue = app.state.broadcaster.subscribe(SLUG)

    r = await client.post("/admissions", json=form(w), headers=w.auth["nurse"])
    assert r.status_code == 201, r.text
    assert heard == [("reset", SLUG), ("mirror", SLUG, "weight_kg", 72.5),
                     ("profile", SLUG, frozenset({"copd"}))]
    frame = queue.get_nowait()                                   # the card on its bed
    assert frame["patient_id"] == r.json()["patient_number"]
    assert "shadow" in frame and frame["shadow"] is None

    heard.clear()
    body = form(w, "2", request_id=uuid.uuid4())
    await _lose_the_first_answer(client, monkeypatch, w, body)
    assert heard == []                                           # no board write was reached
    again = await client.post("/admissions", json=body, headers=w.auth["nurse"])
    assert again.json()["engine"] == {"weight": "failed", "profile": "ok", "board": "ok"}
    assert heard == [("reset", SLUG), ("profile", SLUG, frozenset({"copd"}))]


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


class _Looked(dict):
    """`_ANSWERING` that says when a send found an admission still being answered."""

    def __init__(self) -> None:
        super().__init__()
        self.found = asyncio.Event()

    def get(self, key, default=None):
        value = super().get(key, default)
        if value is not None:
            self.found.set()
        return value


def _hold_the_card(monkeypatch) -> tuple[asyncio.Event, asyncio.Event]:
    """The first send's card write held until `gate` is set; `reached` once it is held."""
    reached, gate = asyncio.Event(), asyncio.Event()
    real = BoardLink.put_identity

    async def held(self, tenant, record):
        reached.set()
        await gate.wait()
        await real(self, tenant, record)

    monkeypatch.setattr(BoardLink, "put_identity", held)
    return reached, gate


async def test_a_resend_while_the_first_send_writes_to_the_board_waits_for_its_answer(
        ward, db_session, monkeypatch):
    """The first send has committed and is still writing to the board (its card write held). A
    resend of the form finds it in flight, waits — holding no database connection meanwhile —
    and answers with the first answer, byte for byte, once that is made."""
    w, client, _ = ward
    looked = _Looked()
    monkeypatch.setattr(admission_router, "_ANSWERING", looked)
    reached, gate = _hold_the_card(monkeypatch)
    body = form(w, request_id=uuid.uuid4())

    first = asyncio.create_task(client.post("/admissions", json=body, headers=w.auth["nurse"]))
    try:
        await asyncio.wait_for(reached.wait(), timeout=10)
        again = asyncio.create_task(client.post("/admissions", json=body, headers=w.auth["nurse"]))
        await asyncio.wait_for(looked.found.wait(), timeout=10)
        await db_session.commit()                       # the test's own session lets go of its own
        await asyncio.sleep(0.2)
        assert not again.done()
        assert db_session.bind.pool.checkedout() == 0   # neither send holds a connection
    finally:
        gate.set()
    first, again = await first, await again
    assert (first.status_code, again.status_code) == (201, 200), (first.text, again.text)
    assert again.content == first.content
    assert first.json()["engine"] == {"weight": "ok", "profile": "ok", "board": "ok"}


async def test_a_resend_that_waits_too_long_answers_the_asked_parts_failed_and_says_so(
        ward, db_session, monkeypatch, caplog):
    """The first send stays at its board writes past `ANSWER_WAIT_S`: the resend stops waiting,
    answers every part the form asked for `failed` (nothing is known to have landed), writes
    nothing again — the first send is still at it — and logs a warning with the number."""
    w, client, _ = ward
    monkeypatch.setattr(admission_router, "ANSWER_WAIT_S", 0.2)
    reached, gate = _hold_the_card(monkeypatch)
    caplog.set_level(logging.WARNING, logger="homunculus.admission.router")
    body = form(w, request_id=uuid.uuid4())

    first = asyncio.create_task(client.post("/admissions", json=body, headers=w.auth["nurse"]))
    try:
        await asyncio.wait_for(reached.wait(), timeout=10)
        again = await client.post("/admissions", json=body, headers=w.auth["nurse"])
    finally:
        gate.set()
    first = await first
    assert (first.status_code, again.status_code) == (201, 200), (first.text, again.text)
    assert again.json()["patient_number"] == first.json()["patient_number"]
    assert again.json()["engine"] == {"weight": "failed", "profile": "failed", "board": "failed"}
    assert first.json()["engine"] == {"weight": "ok", "profile": "ok", "board": "ok"}
    db_session.expire_all()
    assert (await db_session.execute(select(Admission.engine_writes))).scalar_one() == \
        first.json()["engine"]                          # the resend recorded nothing over it
    warned = [rec.getMessage() for rec in caplog.records if rec.levelno == logging.WARNING
              and rec.name == "homunculus.admission.router"]
    assert any(first.json()["patient_number"] in m for m in warned), warned
    assert not any("Sentetik" in m for m in warned), warned


@pytest.mark.parametrize(("bed", "patient"), [("2", {"display_name": "Sentetik Hasta"}),
                                              ("1", {"display_name": "Sentetik Başka"})],
                         ids=["the same person, another bed", "another name, same bed"])
async def test_one_request_id_with_another_form_is_refused(ward, db_session, bed, patient):
    """The replay's look-up runs before the duplicate refusal (A-37): the same person sent to
    another bed under the first form's id is that id's conflict, not a duplicate."""
    w, client, _ = ward
    request_id, other_bed = uuid.uuid4(), w.beds["2"].id
    first = await client.post("/admissions", json=form(w, request_id=request_id),
                              headers=w.auth["nurse"])
    assert first.status_code == 201, first.text
    r = await client.post("/admissions", json=form(w, bed, patient=patient, request_id=request_id),
                          headers=w.auth["nurse"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "request_conflict")
    # The earlier admission's number, so the screen can name it (Task 19b) — never a name.
    assert r.json()["detail"]["patient_number"] == first.json()["patient_number"]
    assert "Sentetik" not in r.text
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
    admitted, refused = sorted(answers, key=lambda r: r.status_code)
    assert refused.json()["detail"]["code"] == "request_conflict"
    assert refused.json()["detail"]["patient_number"] == admitted.json()["patient_number"]
    assert (await _count(db_session, Patient), await _count(db_session, Admission)) == (1, 1)


async def test_a_request_conflict_names_no_admission_outside_the_callers_units(ward):
    """The earlier admission's number travels with the conflict only to a caller whose units
    hold its bed: a Neonatal nurse who sends a form under a Reanimasiya admission's id learns that
    the id is taken, and not whose number it carries."""
    w, client, _ = ward
    request_id = uuid.uuid4()
    first = await client.post("/admissions", json=form(w, request_id=request_id),
                              headers=w.auth["nurse"])
    assert first.status_code == 201, first.text
    r = await client.post("/admissions", json=form(w, "N1", "neo", request_id=request_id),
                          headers=w.auth["nurse_b"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "request_conflict")
    assert "patient_number" not in r.json()["detail"]
    assert first.json()["patient_number"] not in r.text


async def test_forms_without_a_request_id_or_each_with_its_own_all_admit(ward, db_session):
    """`request_id` is optional: two forms with none are two admissions (the dashboard sends none
    until Task 19b); two forms with two ids, two admissions."""
    w, client, _ = ward
    for bed, request_id in (("1", None), ("2", None), ("10", uuid.uuid4()), ("3", uuid.uuid4())):
        r = await client.post("/admissions", json=form(w, bed, request_id=request_id),
                              headers=w.auth["nurse"])
        assert r.status_code == 201, r.text
    assert await _count(db_session, Admission) == 4


# ---------------------------------------------------------------- A-37: one open admission a person
#: The person bed 1's form admits, as another form may name her.
FIRST = {"display_name": "Sentetik Hasta", "date_of_birth": "1970-05-05"}


async def _bed_state(db_session, bed_id: uuid.UUID) -> BedState:
    db_session.expire_all()
    return (await db_session.execute(select(Bed.state).where(Bed.id == bed_id))).scalar_one()


@pytest.mark.parametrize("state", ["DRAFT", "ACTIVE", "PENDING_DISCHARGE"])
async def test_a_second_open_admission_of_one_person_is_refused(ward, db_session, state):
    """The same name and birth date in the tenant while her first admission is open — before it
    is signed, signed, or with its discharge started: 409 `duplicate_open_admission`, the first
    admission's number beside it (the caller's units hold its bed, so the screen can name it),
    never a name; nothing written, the other bed still free."""
    w, client, _ = ward
    bed_two = w.beds["2"].id
    first = await client.post("/admissions", json=form(w, "1"), headers=w.auth["nurse"])
    assert first.status_code == 201, first.text
    await db_session.execute(update(Admission).values(state=AdmissionState[state]))
    await db_session.commit()

    r = await client.post("/admissions", json=form(w, "2", patient=FIRST), headers=w.auth["charge"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "duplicate_open_admission"), r.text
    assert r.json()["detail"]["patient_number"] == first.json()["patient_number"]
    assert "Sentetik" not in r.text
    assert (await _count(db_session, Patient), await _count(db_session, Admission)) == (1, 1)
    assert await _bed_state(db_session, bed_two) == BedState.AVAILABLE


async def test_once_her_admission_is_discharged_the_person_is_admitted_again(ward, db_session):
    w, client, _ = ward
    first = await client.post("/admissions", json=form(w, "1"), headers=w.auth["nurse"])
    await db_session.execute(update(Admission).values(state=AdmissionState.DISCHARGED))
    await db_session.commit()
    again = await client.post("/admissions", json=form(w, "2", patient=FIRST),
                              headers=w.auth["nurse"])
    assert again.status_code == 201, again.text
    assert again.json()["patient_number"] != first.json()["patient_number"]


@pytest.mark.parametrize("other", [
    {"display_name": "Sentetik Əkiz İki", "date_of_birth": "2020-02-02"},
    {"display_name": "Sentetik Əkiz Bir", "date_of_birth": "2020-02-03"},
], ids=["twins: another name, the same birth date", "the same name, another birth date"])
async def test_another_name_or_another_birth_date_is_another_person(ward, other):
    w, client, _ = ward
    one = {"display_name": "Sentetik Əkiz Bir", "date_of_birth": "2020-02-02"}
    for bed, patient in (("1", one), ("2", other)):
        r = await client.post("/admissions", json=form(w, bed, patient=patient),
                              headers=w.auth["nurse"])
        assert r.status_code == 201, r.text


@pytest.mark.parametrize("written", ["sentetik  HASTA", " SENTETİK Hasta ", "Sentetık Hasta",
                                     "Sentétik Hâsta"])
async def test_the_same_name_written_otherwise_is_the_same_person(ward, db_session, written):
    """Case, İ/ı, accents and spacing (admission/form.py `person_name`) do not make another
    person of her."""
    w, client, _ = ward
    assert (await client.post("/admissions", json=form(w, "1"), headers=w.auth["nurse"])) \
        .status_code == 201
    r = await client.post("/admissions", json=form(w, "2", patient={**FIRST, "display_name": written}),
                          headers=w.auth["nurse"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "duplicate_open_admission")
    assert await _count(db_session, Admission) == 1


async def test_two_sends_for_one_person_to_two_beds_at_once_admit_one(ward, db_session):
    """Two forms for one person, two beds, two request ids, sent at once: no bed lock orders them,
    and each may look before the other has committed. One is admitted; the other is refused
    `duplicate_open_admission` — by the look-up or, at its flush, by the open-identity index —
    never `request_conflict`, never a 500, never two admissions."""
    w, client, _ = ward
    answers = await asyncio.gather(
        client.post("/admissions", json=form(w, "1", request_id=uuid.uuid4()),
                    headers=w.auth["nurse"]),
        client.post("/admissions", json=form(w, "2", patient=FIRST, request_id=uuid.uuid4()),
                    headers=w.auth["charge"]))
    assert sorted(r.status_code for r in answers) == [201, 409], [r.text for r in answers]
    admitted, refused = sorted(answers, key=lambda r: r.status_code)
    assert refused.json()["detail"]["code"] == "duplicate_open_admission"
    assert refused.json()["detail"]["patient_number"] == admitted.json()["patient_number"]
    assert (await _count(db_session, Patient), await _count(db_session, Admission)) == (1, 1)


async def test_a_send_the_look_up_missed_is_refused_by_the_index_at_its_flush(ward, db_session,
                                                                              monkeypatch):
    """The look-up of the first one's admission sees nothing (as when it read before the first
    committed): the open-identity index stops the insert, and the IntegrityError is told apart by
    the index's name — the same `duplicate_open_admission` with the number, not the request-id
    conflict, not a 500. The number the refused send took goes back with its transaction."""
    w, client, _ = ward
    first = await client.post("/admissions", json=form(w, "1", request_id=uuid.uuid4()),
                              headers=w.auth["nurse"])
    assert first.status_code == 201, first.text
    real, looks = admission_router._open_admission_of, []

    async def blind_once(*args, **kwargs):
        looks.append(1)
        return None if len(looks) == 1 else await real(*args, **kwargs)

    monkeypatch.setattr(admission_router, "_open_admission_of", blind_once)
    r = await client.post("/admissions", json=form(w, "2", patient=FIRST, request_id=uuid.uuid4()),
                          headers=w.auth["nurse"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "duplicate_open_admission"), r.text
    assert r.json()["detail"]["patient_number"] == first.json()["patient_number"]
    assert len(looks) == 2                         # the look-up, and the number after the index
    assert (await _count(db_session, Patient), await _count(db_session, Admission)) == (1, 1)
    nxt = await client.post("/admissions", json=form(w, "3"), headers=w.auth["nurse"])
    assert int(nxt.json()["patient_number"][3:]) == int(first.json()["patient_number"][3:]) + 1


async def test_a_duplicate_names_no_admission_outside_the_callers_units(ward, db_session):
    """A Neonatal nurse sending the form of a person who lies in Reanimasiya is refused all the
    same, and learns no number: the refusal stands, the number travels only to a caller whose
    units hold that bed (A-12: the bed's room's unit)."""
    w, client, _ = ward
    first = await client.post("/admissions", json=form(w, "1"), headers=w.auth["nurse"])
    r = await client.post("/admissions", json=form(w, "N1", "neo", patient=FIRST),
                          headers=w.auth["nurse_b"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "duplicate_open_admission")
    assert "patient_number" not in r.json()["detail"]
    assert first.json()["patient_number"] not in r.text
    assert await _count(db_session, Admission) == 1


async def test_a_resend_of_the_form_is_its_admission_never_a_duplicate(ward, db_session):
    """The replay's look-up runs first (A-19 before A-37): the same form sent again under its
    `request_id` — whose person has, of course, an open admission: the one it made — is answered
    with that admission, 200 and the same body."""
    w, client, _ = ward
    body = form(w, request_id=uuid.uuid4())
    first = await client.post("/admissions", json=body, headers=w.auth["nurse"])
    again = await client.post("/admissions", json=body, headers=w.auth["nurse"])
    assert (first.status_code, again.status_code) == (201, 200), again.text
    assert again.json() == first.json()
    assert await _count(db_session, Admission) == 1


async def test_an_admission_written_before_the_digest_is_never_in_conflict(ward, db_session):
    """A row with no digest — every admission written before 0012, and one made without the form
    (the service alone) — is not seen by the refusal, and the index lets it be."""
    w, client, _ = ward
    patient = Patient(tenant_id=w.tenant.id, display_name="Sentetik Hasta",
                      date_of_birth="1970-05-05", sex="female", patient_number="H9900001")
    db_session.add(patient)
    await db_session.flush()
    await service.create_draft_admission(db_session, tenant_id=w.tenant.id, patient=patient,
                                         note_fields={"admitting_unit_id": w.units["rea"].id,
                                                      "bed_id": w.beds["2"].id,
                                                      "admission_diagnosis_free_text": "Sentetik"})
    await db_session.commit()
    r = await client.post("/admissions", json=form(w, "1"), headers=w.auth["nurse"])
    assert r.status_code == 201, r.text
    digests = (await db_session.execute(select(Admission.identity_digest)
                                        .order_by(Admission.created_at))).scalars().all()
    assert digests[0] is None and digests[1] is not None


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

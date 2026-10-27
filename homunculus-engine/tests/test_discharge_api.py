# homunculus-engine/tests/test_discharge_api.py
"""Sign-off and discharge as Group 2 · B1a makes them (spec D3, D7, §3.2, §3.3), and the whole flow
of §8: admit → the card on its bed and unit → sign-off → discharge started → confirmed → the card
gone for scoped and unscoped screens, by exactly one removal frame → a reading for the number
dropped before the engine (A-11) → the bed in cleaning → released. Postgres (`db_session`).

Beside the plan's tests, the amendments': the caller's units are the bed's room's unit, never the
row's `admitting_unit_id` (A-12); two calls at once on one admission do it once, and a bed moved
under a discharge is a 409, never a 500 (A-10, A-26); an audit store failing after the commit
leaves the committed change and its success (A-26); what the confirm reports when the tombstone,
the retirement before its door, or the door itself fails (A-23, A-25); and a resend writing the
card again while the patient is discharged leaves no card (A-29). Synthetic ward:
tests/kabul_world.py."""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import async_sessionmaker

from homunculus.admission import router as admission_router
from homunculus.admission import service
from homunculus.admission.boardlink import BoardLink
from homunculus.admission.models import Admission, AdmissionState, DischargeDisposition
from homunculus.api.app import sse_board_frames
from homunculus.scope import build_scope, sees_patient
from homunculus.tenant.models import Bed, BedState
from tests.conftest import requires_db
from tests.kabul_world import BOARD, SLUG, build_ward, ward_client

pytestmark = [requires_db]
#: Where the discharge's board step logs (`BoardLink.take_off`).
LINK_LOG = "homunculus.admission.boardlink"


@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    built = await build_ward(db_session)
    async with ward_client(db_session) as (client, app):
        yield built, client, app


def form(w, bed: str = "1", unit: str = "rea", weight: float | None = 50,
         request_id: uuid.UUID | None = None) -> dict:
    """Each bed's form admits its own synthetic person ("Sentetik Hasta", "Sentetik Hasta 2" …):
    the server refuses a second open admission of one person (A-37)."""
    name = "Sentetik Hasta" if bed == "1" else f"Sentetik Hasta {bed}"
    body = {"patient": {"display_name": name, "date_of_birth": "1970-05-05",
                        "sex": "male", "consent": "UNCONSCIOUS_LATER"},
            "note": {"admitting_unit_id": str(w.units[unit].id), "bed_id": str(w.beds[bed].id),
                     "admission_type": "MEDICAL", "admission_diagnosis_free_text": "Sentetik tanı",
                     "no_known_allergy": True, "weight_kg": weight}}
    if request_id is not None:
        body["request_id"] = str(request_id)
    return body


async def admit(w, client, bed: str = "1", unit: str = "rea", who: str = "nurse") -> dict:
    r = await client.post("/admissions", json=form(w, bed, unit), headers=w.auth[who])
    assert r.status_code == 201, r.text
    return r.json()


async def signed(w, client, bed: str = "1") -> dict:
    admission = await admit(w, client, bed)
    r = await client.post(f"/admissions/{admission['id']}/sign-off", headers=w.auth["doctor"])
    assert r.status_code == 200, r.text
    return admission


async def started(w, client, bed: str = "1") -> dict:
    admission = await signed(w, client, bed)
    r = await client.post(f"/admissions/{admission['id']}/discharge/initiate",
                          json={"disposition": "HOME"}, headers=w.auth["doctor"])
    assert r.status_code == 200, r.text
    return admission


def audited(app, event: str) -> list:
    return [r for r in app.state.audit.records(tenant=SLUG, limit=200) if r.event_type == event]


def drain(queue: asyncio.Queue) -> list[dict]:
    frames = []
    while not queue.empty():
        frames.append(queue.get_nowait())
    return frames


async def septic_shock(client, number: str):
    """Charted as /clinical takes it: with the admission's 50 kg, septic shock — critical."""
    for entries in ([{"code": "suspected_infection", "value": 1}, {"code": "lactate", "value": 3.4},
                     {"code": "norepinephrine_rate", "value": 0.08}],
                    [{"code": "crystalloid_bolus_ml", "value": 1600}]):
        r = await client.post(f"/clinical/{number}", json={"entries": entries}, headers=BOARD)
        assert r.status_code == 200, r.text
    assert "septic_shock" in r.json()["alerts"]           # 1600 mL / 50 kg: septic shock, critical


async def acknowledged(client, number: str) -> None:
    ack = await client.post("/ack", json={"patient_id": number, "kind": "septic_shock"},
                            headers=BOARD)
    assert ack.status_code == 200, ack.text


def errors_of(caplog, logger: str) -> list[str]:
    return [rec.getMessage() for rec in caplog.records
            if rec.levelno == logging.ERROR and rec.name == logger]


async def _a_backend_waits_on_a_lock(db_session) -> None:
    """Until a session of the test database waits on a lock while it reads or writes an admission
    or a bed — not just any lock: another run waiting for the shared test database's advisory
    lock waits too. A fresh connection per look: a transaction would see `pg_stat_activity` as
    it was when it first read it."""
    for _ in range(200):
        async with db_session.bind.connect() as conn:
            waiting = (await conn.execute(text(
                "SELECT count(*) FROM pg_stat_activity "
                "WHERE datname = current_database() AND wait_event_type = 'Lock' "
                "AND query NOT ILIKE '%advisory%' "
                "AND (query ILIKE '%admissions%' OR query ILIKE '%beds%')"))).scalar_one()
        if waiting:
            return
        await asyncio.sleep(0.05)
    raise AssertionError("the second call never waited on a lock")


async def at_once(db_session, monkeypatch, step: str, first, second) -> tuple:
    """Two calls of one route that really overlap (A-10): `first` is held inside its transaction
    right after `service.<step>` has written — its row locks held, nothing committed — until
    `second` is seen waiting on a lock in the database; then both finish. With the route's locks
    the second waits before it reads, and reads what the first committed. Without them it reads
    the admission as it was and waits only at its UPDATE: a second signature then writes over the
    first (checked with the locks taken out: that test fails); a second start or confirmation is
    still stopped, later, by the bed's own state machine, whose ValueError the route answers 409
    — the two guards A-10 names, both kept."""
    reached, gate = asyncio.Event(), asyncio.Event()
    real, calls = getattr(service, step), []

    async def held(*args, **kwargs):
        done = await real(*args, **kwargs)
        calls.append(step)
        if len(calls) == 1:
            reached.set()
            await gate.wait()
        return done

    monkeypatch.setattr(service, step, held)
    one = asyncio.create_task(first())
    try:
        await asyncio.wait_for(reached.wait(), timeout=10)
        two = asyncio.create_task(second())
        await _a_backend_waits_on_a_lock(db_session)
    finally:
        gate.set()
    return await one, await two


# ---------------------------------------------------------------- sign-off
async def test_the_physician_who_signs_a_draft_becomes_its_attending(ward):
    w, client, app = ward
    admission = await admit(w, client)
    r = await client.post(f"/admissions/{admission['id']}/sign-off", headers=w.auth["doctor"])
    assert r.status_code == 200, r.text
    assert r.json()["state"] == "ACTIVE"
    assert r.json()["attending_physician_id"] == r.json()["signed_by"] == str(w.users["doctor"].id)
    (row,) = audited(app, "admission.sign_off")
    assert (row.patient_id, row.payload) == (admission["patient_number"],
                                             {"admission_id": admission["id"],
                                              "actor": "doctor@kabul.example.com"})


async def test_a_nurse_does_not_sign_and_a_physician_signs_only_in_her_units(ward):
    w, client, _ = ward
    rea = await admit(w, client)
    r = await client.post(f"/admissions/{rea['id']}/sign-off", headers=w.auth["nurse"])
    assert r.status_code == 403
    neo = await admit(w, client, "N1", "neo", who="nurse_b")
    r = await client.post(f"/admissions/{neo['id']}/sign-off", headers=w.auth["doctor"])
    assert (r.status_code, r.json()["detail"]["code"]) == (403, "out_of_scope")


async def test_a_signed_admission_is_not_signed_again(ward):
    w, client, _ = ward
    admission = await signed(w, client)
    r = await client.post(f"/admissions/{admission['id']}/sign-off", headers=w.auth["doctor"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "invalid_transition")


async def test_the_callers_units_are_the_beds_never_the_admitting_unit_on_the_row(ward, db_session):
    """A-12: a transfer body can set `admitting_unit_id`; the unit a caller's grants are checked
    against is the bed's room's, read from the database. A Reanimasiya bed whose row names
    Neonatal is the Reanimasiya physician's; a Neonatal bed whose row names Reanimasiya is not."""
    w, client, _ = ward
    rea = await admit(w, client)
    neo = await admit(w, client, "N1", "neo", who="nurse_b")
    for admission, named in ((rea, "neo"), (neo, "rea")):
        await db_session.execute(update(Admission)
                                 .where(Admission.id == uuid.UUID(admission["id"]))
                                 .values(admitting_unit_id=w.units[named].id))
    await db_session.commit()

    r = await client.post(f"/admissions/{rea['id']}/sign-off", headers=w.auth["doctor"])
    assert r.status_code == 200, r.text
    r = await client.post(f"/admissions/{neo['id']}/sign-off", headers=w.auth["doctor"])
    assert (r.status_code, r.json()["detail"]["code"]) == (403, "out_of_scope")


async def test_two_signatures_at_once_sign_once(ward, db_session, monkeypatch):
    """A-10, A-26: the admission's row is locked (its bed's first): the second signature waits for
    the first, reads it ACTIVE and is refused — one signer, one audit row."""
    w, client, app = ward
    admission = await admit(w, client)
    url = f"/admissions/{admission['id']}/sign-off"
    first, second = await at_once(
        db_session, monkeypatch, "sign_off_admission",
        lambda: client.post(url, headers=w.auth["doctor"]),
        lambda: client.post(url, headers=w.auth["admin"]))
    assert (first.status_code, second.status_code) == (200, 409), (first.text, second.text)
    assert second.json()["detail"]["code"] == "invalid_transition"
    assert first.json()["signed_by"] == str(w.users["doctor"].id)
    assert len(audited(app, "admission.sign_off")) == 1


# ---------------------------------------------------------------- discharge start
async def test_a_discharge_home_is_started_with_its_disposition(ward, db_session):
    w, client, app = ward
    bed_id = w.beds["1"].id
    admission = await signed(w, client)
    r = await client.post(f"/admissions/{admission['id']}/discharge/initiate",
                          json={"disposition": "HOME", "note": "Sentetik not"},
                          headers=w.auth["doctor"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["state"], body["discharge_disposition"], body["discharge_note"]) == \
        ("PENDING_DISCHARGE", "HOME", "Sentetik not")
    assert body["discharge_at"] is not None
    db_session.expire_all()
    assert (await db_session.execute(select(Bed.state).where(Bed.id == bed_id))).scalar_one() \
        == BedState.PENDING_DISCHARGE
    (row,) = audited(app, "admission.discharge_start")
    assert row.payload == {"admission_id": admission["id"], "disposition": "HOME",
                           "actor": "doctor@kabul.example.com"}
    assert "Sentetik" not in repr(row.payload)                       # never the note


async def test_an_exitus_is_reported_by_the_caller_unless_another_name_is_written(ward):
    w, client, _ = ward
    first, second = await signed(w, client, "1"), await signed(w, client, "2")
    r = await client.post(f"/admissions/{first['id']}/discharge/initiate",
                          json={"disposition": "EXITUS"}, headers=w.auth["doctor"])
    assert r.json()["discharge_reported_by"] == "doctor"
    r = await client.post(f"/admissions/{second['id']}/discharge/initiate",
                          json={"disposition": "EXITUS", "reported_by": "Dr. Sentetik"},
                          headers=w.auth["doctor"])
    assert r.json()["discharge_reported_by"] == "Dr. Sentetik"


async def test_the_dashboards_own_body_starts_a_discharge(ward):
    """What DischargeDialog.jsx sends: every key, the ones that do not apply as null, the time as
    the browser's ISO instant (`toISOString()`: milliseconds and a "Z")."""
    w, client, _ = ward
    admission = await signed(w, client)
    at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    r = await client.post(f"/admissions/{admission['id']}/discharge/initiate",
                          json={"disposition": "HOME", "institution": None, "reported_by": None,
                                "discharge_at": at, "note": None},
                          headers=w.auth["doctor"])
    assert r.status_code == 200, r.text
    assert (r.json()["discharge_institution"], r.json()["discharge_note"]) == (None, None)


async def test_an_incomplete_or_impossible_decision_is_refused(ward):
    w, client, _ = ward
    admission = await signed(w, client)
    url = f"/admissions/{admission['id']}/discharge/initiate"
    future = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    for body, code in (({"disposition": "OTHER_INSTITUTION"}, "field_invalid:institution"),
                       ({"disposition": "HOME", "discharge_at": future},
                        "field_invalid:discharge_at")):
        r = await client.post(url, json=body, headers=w.auth["doctor"])
        assert (r.status_code, r.json()["detail"]["code"]) == (422, code)


async def test_a_draft_cannot_be_discharged_before_it_is_signed(ward):
    w, client, _ = ward
    admission = await admit(w, client)
    r = await client.post(f"/admissions/{admission['id']}/discharge/initiate",
                          json={"disposition": "HOME"}, headers=w.auth["doctor"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "invalid_transition")


async def test_an_open_critical_alarm_blocks_the_start_until_it_is_acknowledged(ward):
    """The board's own alerts, as the clinician sees them (BoardLink.open_critical)."""
    w, client, _ = ward
    admission = await signed(w, client)
    number = admission["patient_number"]
    await septic_shock(client, number)

    url = f"/admissions/{admission['id']}/discharge/initiate"
    r = await client.post(url, json={"disposition": "HOME"}, headers=w.auth["doctor"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "critical_alarm_open")

    await acknowledged(client, number)
    r = await client.post(url, json={"disposition": "HOME"}, headers=w.auth["doctor"])
    assert r.status_code == 200, r.text


async def test_two_starts_at_once_start_once(ward, db_session, monkeypatch):
    """A-10: the second decision waits for the first and finds it taken — the first one stands,
    never overwritten by the second's disposition."""
    w, client, app = ward
    admission = await signed(w, client)
    url = f"/admissions/{admission['id']}/discharge/initiate"
    first, second = await at_once(
        db_session, monkeypatch, "initiate_discharge",
        lambda: client.post(url, json={"disposition": "HOME"}, headers=w.auth["doctor"]),
        lambda: client.post(url, json={"disposition": "EXITUS"}, headers=w.auth["admin"]))
    assert (first.status_code, second.status_code) == (200, 409), (first.text, second.text)
    assert second.json()["detail"]["code"] == "invalid_transition"
    assert len(audited(app, "admission.discharge_start")) == 1
    db_session.expire_all()
    assert (await db_session.execute(select(Admission.discharge_disposition))).scalar_one() \
        == DischargeDisposition.HOME


# ---------------------------------------------------------------- discharge confirm
async def test_a_critical_alarm_after_the_start_holds_the_confirmation_until_acknowledged(
        ward, db_session):
    """Review I-1 (the user's decision, 2026-10-26): the confirmation ends every alert of the
    patient (`retire`, reason "discharged"), so a critical alarm that fired after the start would
    be cleared unseen. The confirmation asks the board again, under its locks: refused
    `critical_alarm_open`, the start's own code, and nothing written — the admission and the bed
    as they were, no audit row, the card and its alarm still on the board, no frame sent. Once
    the alarm is acknowledged, the confirmation goes through."""
    w, client, app = ward
    bed_id = w.beds["1"].id
    admission = await started(w, client)
    number = admission["patient_number"]
    await septic_shock(client, number)
    queue = app.state.broadcaster.subscribe(SLUG)
    url = f"/admissions/{admission['id']}/discharge/confirm"

    r = await client.post(url, headers=w.auth["charge"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "critical_alarm_open")
    db_session.expire_all()
    assert (await db_session.execute(select(Admission.state))).scalar_one() == \
        AdmissionState.PENDING_DISCHARGE
    assert (await db_session.execute(select(Bed.state).where(Bed.id == bed_id))).scalar_one() \
        == BedState.PENDING_DISCHARGE
    assert audited(app, "admission.discharge_confirm") == []
    (card,) = (await client.get("/patients", headers=BOARD)).json()["patients"]
    assert card["patient_id"] == number
    assert "septic_shock" in [a["kind"] for a in card["alerts"]]
    assert drain(queue) == []

    await acknowledged(client, number)
    r = await client.post(url, headers=w.auth["charge"])
    assert r.status_code == 200, r.text
    assert (r.json()["board"], r.json()["alerts"]) == ("ok", "ok")


async def test_an_alarm_firing_while_an_exitus_is_started_is_caught_at_the_confirmation(
        ward, monkeypatch):
    """Review I-1: the start reads the board before it commits; a critical alarm that fires in
    between is the confirmation's to catch. An exitus is not exempt: after a death, someone
    acknowledges the monitor's last critical alarms before the charge nurse confirms."""
    w, client, _ = ward
    admission = await signed(w, client)
    number = admission["patient_number"]
    reached, gate = asyncio.Event(), asyncio.Event()
    real = service.initiate_discharge

    async def held(*args, **kwargs):
        done = await real(*args, **kwargs)      # written, the board already read, not committed
        reached.set()
        await gate.wait()
        return done

    monkeypatch.setattr(service, "initiate_discharge", held)
    start = asyncio.create_task(client.post(f"/admissions/{admission['id']}/discharge/initiate",
                                            json={"disposition": "EXITUS"},
                                            headers=w.auth["doctor"]))
    try:
        await asyncio.wait_for(reached.wait(), timeout=10)
        await septic_shock(client, number)
    finally:
        gate.set()
    r = await start
    assert r.status_code == 200, r.text

    url = f"/admissions/{admission['id']}/discharge/confirm"
    r = await client.post(url, headers=w.auth["charge"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "critical_alarm_open")
    await acknowledged(client, number)
    r = await client.post(url, headers=w.auth["charge"])
    assert r.status_code == 200, r.text
    assert (r.json()["discharge_disposition"], r.json()["board"]) == ("EXITUS", "ok")


async def test_only_the_charge_nurse_confirms_and_only_a_started_discharge(ward):
    w, client, _ = ward
    admission = await signed(w, client)
    url = f"/admissions/{admission['id']}/discharge/confirm"
    assert (await client.post(url, headers=w.auth["nurse"])).status_code == 403
    r = await client.post(url, headers=w.auth["charge"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "invalid_transition")


async def test_two_confirmations_at_once_discharge_once(ward, db_session, monkeypatch):
    """A-10: the second confirmation waits for the first under the locks and reads the admission
    DISCHARGED — never a 500 from the bed's own state machine, never a second discharge or a
    second `admission.discharge_confirm` row. Since review I-2 a confirmation of a discharged
    admission is the nurse's retry of the board step: it answers 200 with that step's outcome and
    writes nothing in the database; the step is idempotent, so its removal frame may come twice."""
    w, client, app = ward
    admission = await started(w, client)
    number = admission["patient_number"]
    queue = app.state.broadcaster.subscribe(SLUG)
    drain(queue)
    url = f"/admissions/{admission['id']}/discharge/confirm"
    first, second = await at_once(
        db_session, monkeypatch, "confirm_discharge",
        lambda: client.post(url, headers=w.auth["charge"]),
        lambda: client.post(url, headers=w.auth["admin"]))
    assert (first.status_code, second.status_code) == (200, 200), (first.text, second.text)
    for answer in (first, second):
        assert (answer.json()["state"], answer.json()["board"], answer.json()["alerts"]) == \
            ("DISCHARGED", "ok", "ok")
    assert len(audited(app, "admission.discharge_confirm")) == 1
    assert [row.payload["via"] for row in audited(app, "admission.discharge_board_retry")] == \
        ["discharge.confirm"]
    frames = drain(queue)
    assert frames and {(f["patient_id"], f["removed"]) for f in frames} == {(number, True)}


async def test_a_bed_moved_under_a_started_discharge_is_a_409_and_nothing_is_written(ward,
                                                                                    db_session):
    """A-10: the bed's own state machine refuses the confirmation (an administrator sent the bed
    to cleaning by hand): `invalid_transition`, a 409 — not a 500 — and the admission stays as it
    was."""
    w, client, _ = ward
    admission = await started(w, client)
    bed_id = w.beds["1"].id
    moved = await client.post(f"/tenant/beds/{bed_id}/transition",
                              json={"new_state": "HOUSEKEEPING"}, headers=w.auth["admin"])
    assert moved.status_code == 200, moved.text
    r = await client.post(f"/admissions/{admission['id']}/discharge/confirm",
                          headers=w.auth["charge"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "invalid_transition")
    db_session.expire_all()
    state = (await db_session.execute(select(Admission.state))).scalar_one()
    assert state == AdmissionState.PENDING_DISCHARGE


# ---------------------------------------------------------------- transfers: closed (A-37)
def _target(w, bed: str = "2", unit: str = "rea") -> dict:
    return {"target_bed_id": str(w.beds[bed].id), "target_unit_id": str(w.units[unit].id)}


async def _the_ward(db_session) -> tuple:
    """Every admission (its bed, unit and state) and every bed's state, as committed — read in a
    session of its own, so the test's ward objects are not expired under it."""
    async with async_sessionmaker(db_session.bind)() as fresh:
        admissions = sorted((await fresh.execute(select(
            Admission.id, Admission.bed_id, Admission.admitting_unit_id, Admission.state))).all())
        return admissions, dict((await fresh.execute(select(Bed.id, Bed.state))).all())


async def test_the_transfer_routes_answer_transfer_unavailable_and_write_nothing(ward, db_session):
    """A-37, the user's decision: the transfer API is closed until a transfer slice brings its
    checks and its screen. Both routes answer 409 `transfer_unavailable` to callers holding their
    permission — the unit's physician, its charge nurse, the administrator — and write nothing:
    no admission or bed moves, no audit row, no frame, the card stays on its bed."""
    w, client, app = ward
    admission = await signed(w, client)
    base = f"/admissions/{admission['id']}"
    before = await _the_ward(db_session)
    cards = (await client.get("/patients", headers=BOARD)).json()["patients"]
    rows = len(app.state.audit.records(tenant=SLUG, limit=500))
    queue = app.state.broadcaster.subscribe(SLUG)

    for path, who in (("/transfer/initiate", "doctor"), ("/transfer/initiate", "admin"),
                      ("/transfer/confirm", "charge"), ("/transfer/confirm", "admin")):
        r = await client.post(base + path, json=_target(w), headers=w.auth[who])
        assert (r.status_code, r.json()["detail"]["code"]) == (409, "transfer_unavailable"), r.text

    assert await _the_ward(db_session) == before
    assert (await client.get("/patients", headers=BOARD)).json()["patients"] == cards
    assert len(app.state.audit.records(tenant=SLUG, limit=500)) == rows
    assert drain(queue) == []


async def test_a_transfer_can_no_longer_leave_a_card_on_a_bed_freed_for_another_patient(
        ward, db_session):
    """The review's C-1: an arrival closed the source admission and sent its bed to cleaning while
    the card stayed on it, so the bed could be released and admitted into again — two cards on
    one bed, the monitor's link broken. A transfer already pending (here written by the service,
    as one started before the closure would be) cannot be confirmed either: the bed keeps its
    patient, it cannot be released, and nobody else is admitted into it."""
    w, client, _ = ward
    bed_one = w.beds["1"].id
    admission = await signed(w, client)
    async with async_sessionmaker(db_session.bind, expire_on_commit=False)() as fresh:
        row = await fresh.get(Admission, uuid.UUID(admission["id"]))
        await service.initiate_transfer(fresh, row, target_bed_id=w.beds["2"].id,
                                        target_unit_id=w.units["rea"].id)
        await fresh.commit()
    before = await _the_ward(db_session)

    r = await client.post(f"/admissions/{admission['id']}/transfer/confirm", json=_target(w),
                          headers=w.auth["charge"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "transfer_unavailable")
    assert await _the_ward(db_session) == before
    r = await client.post(f"/tenant/beds/{bed_one}/release", headers=w.auth["nurse"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "invalid_transition")
    other = form(w)
    other["patient"]["display_name"] = "Sentetik Başqa"
    r = await client.post("/admissions", json=other, headers=w.auth["nurse"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "bed_not_available")
    cards = (await client.get("/patients", headers=BOARD)).json()["patients"]
    assert [c["patient_id"] for c in cards if c["identity"]["bed_id"] == str(bed_one)] == \
        [admission["patient_number"]]


async def test_a_physician_can_no_longer_move_another_units_patient_into_her_own(ward,
                                                                              db_session):
    """The review's C-2: a Reanimasiya physician moved a Neonatal patient into a Reanimasiya bed
    and could then discharge her. Both steps of the move are refused `transfer_unavailable`; the
    patient stays on her Neonatal bed, out of that physician's reach (`out_of_scope`)."""
    w, client, _ = ward
    neo = await admit(w, client, "N1", "neo", who="nurse_b")
    await db_session.execute(update(Admission).where(Admission.id == uuid.UUID(neo["id"]))
                             .values(state=AdmissionState.ACTIVE))
    await db_session.commit()
    base = f"/admissions/{neo['id']}"
    before = await _the_ward(db_session)

    for path, who in (("/transfer/initiate", "doctor"), ("/transfer/confirm", "charge")):
        r = await client.post(base + path, json=_target(w), headers=w.auth[who])
        assert (r.status_code, r.json()["detail"]["code"]) == (409, "transfer_unavailable"), r.text
    assert await _the_ward(db_session) == before
    r = await client.post(base + "/discharge/initiate", json={"disposition": "HOME"},
                          headers=w.auth["doctor"])
    assert (r.status_code, r.json()["detail"]["code"]) == (403, "out_of_scope")


# ---------------------------------------------------------------- the confirm's board parts (A-25)
async def test_a_tombstone_the_store_refuses_reports_the_board_failed(ward, db_session,
                                                                      monkeypatch, caplog):
    """`discharge_identity` raising: the discharge is committed (DISCHARGED, the bed in cleaning),
    the card did not leave the board and the patient was not retired — both `failed`, logged with
    the number, and no frame sent."""
    w, client, app = ward
    bed_id = w.beds["1"].id
    admission = await started(w, client)
    number = admission["patient_number"]

    async def refused(self, tenant, patient_number):
        raise RuntimeError(f"the discharge of {patient_number} was refused")

    monkeypatch.setattr(BoardLink, "discharge_identity", refused)
    queue = app.state.broadcaster.subscribe(SLUG)
    caplog.set_level(logging.ERROR, logger=LINK_LOG)
    r = await client.post(f"/admissions/{admission['id']}/discharge/confirm",
                          headers=w.auth["charge"])
    assert r.status_code == 200, r.text
    assert (r.json()["state"], r.json()["board"], r.json()["alerts"]) == \
        ("DISCHARGED", "failed", "failed")
    assert drain(queue) == []
    assert [c["patient_id"] for c in (await client.get("/patients", headers=BOARD)).json()[
        "patients"]] == [number]
    assert any(number in m for m in errors_of(caplog, LINK_LOG))
    db_session.expire_all()
    assert (await db_session.execute(select(Bed.state).where(Bed.id == bed_id))).scalar_one() \
        == BedState.HOUSEKEEPING


@pytest.mark.parametrize("why", ["no door wired", "not this number's tombstone"])
async def test_a_retirement_refused_before_its_door_reports_the_board_failed(ward, monkeypatch,
                                                                             caplog, why):
    """`retire` raising before the door — a `RuntimeError("…not wired")` or a `ValueError` for a
    record that is not this number's tombstone: no removal was sent, so the card has not left the
    screens, and the patient's alerts were not ended. Both `failed`, logged with the number."""
    w, client, app = ward
    admission = await started(w, client)
    number = admission["patient_number"]
    link = app.state.board_link
    if why == "no door wired":
        monkeypatch.setattr(link, "_retire", None)
    else:
        admitted = link._identities.get(SLUG, number)

        async def not_a_tombstone(self, tenant, patient_number):
            return admitted

        monkeypatch.setattr(BoardLink, "discharge_identity", not_a_tombstone)
    queue = app.state.broadcaster.subscribe(SLUG)
    caplog.set_level(logging.ERROR, logger=LINK_LOG)
    r = await client.post(f"/admissions/{admission['id']}/discharge/confirm",
                          headers=w.auth["charge"])
    assert r.status_code == 200, r.text
    assert (r.json()["board"], r.json()["alerts"]) == ("failed", "failed")
    assert drain(queue) == []
    assert any(number in m for m in errors_of(caplog, LINK_LOG))


async def test_a_retirement_failing_inside_its_door_is_a_discharge_with_its_alerts_incomplete(
        ward, monkeypatch, caplog):
    """A-25: the door (Lane A's `retire_and_publish`) raises from inside, after the tombstone was
    written — here an `alert_cleared` row that does not get written, after the alerts were ended
    in memory. The discharge is not failed: the board is `ok` (every read leaves the card off),
    the alert retirement `incomplete`, logged with the number. In this failure the door's
    `finally` still sent the one removal frame; a door failing in its `finally` would not have."""
    w, client, app = ward
    admission = await signed(w, client)
    number = admission["patient_number"]
    await septic_shock(client, number)
    await acknowledged(client, number)
    r = await client.post(f"/admissions/{admission['id']}/discharge/initiate",
                          json={"disposition": "HOME"}, headers=w.auth["doctor"])
    assert r.status_code == 200, r.text

    store, append = app.state.audit, app.state.audit.append

    def cleared_rows_fail(event):
        if event.event_type == "alert_cleared":
            raise RuntimeError("audit store down")
        return append(event)

    monkeypatch.setattr(store, "append", cleared_rows_fail)
    queue = app.state.broadcaster.subscribe(SLUG)
    caplog.set_level(logging.ERROR, logger=LINK_LOG)
    r = await client.post(f"/admissions/{admission['id']}/discharge/confirm",
                          headers=w.auth["charge"])
    assert r.status_code == 200, r.text
    assert (r.json()["state"], r.json()["board"], r.json()["alerts"]) == \
        ("DISCHARGED", "ok", "incomplete")
    assert [(f["patient_id"], f["removed"]) for f in drain(queue)] == [(number, True)]
    assert (await client.get("/patients", headers=BOARD)).json()["patients"] == []
    assert number not in app.state.board_link._engine(SLUG).patient_ids()
    logged = errors_of(caplog, LINK_LOG)
    assert any(number in m for m in logged) and not any("Sentetik" in m for m in logged)


async def test_a_confirmation_whose_card_did_not_leave_is_retried_by_confirming_again(
        ward, db_session, monkeypatch):
    """Review I-2 (a): the tombstone refused once, the card still stands as admitted, its alerts
    still fire. The nurse confirms again: a confirmation of a DISCHARGED admission runs the board
    step again (tombstone, then retirement) and answers its outcome, writing nothing else — no
    second `admission.discharge_confirm`, one `admission.discharge_board_retry`. It is not held
    by a critical alarm on the card left standing (the dashboard review's ordering): the hold is
    the real confirmation's, which this patient passed; a retry held by it could never take the
    card off. The retirement ends the alarm with the card."""
    w, client, app = ward
    bed_id = w.beds["1"].id
    admission = await started(w, client)
    number = admission["patient_number"]
    real, refusals = BoardLink.discharge_identity, []

    async def refused_once(self, tenant, patient_number):
        if not refusals:
            refusals.append(patient_number)
            raise RuntimeError(f"the discharge of {patient_number} was refused")
        return await real(self, tenant, patient_number)

    monkeypatch.setattr(BoardLink, "discharge_identity", refused_once)
    url = f"/admissions/{admission['id']}/discharge/confirm"
    r = await client.post(url, headers=w.auth["charge"])
    assert (r.status_code, r.json()["board"], r.json()["alerts"]) == (200, "failed", "failed")
    (card,) = (await client.get("/patients", headers=BOARD)).json()["patients"]
    assert card["patient_id"] == number

    await septic_shock(client, number)                      # on the card still standing

    r = await client.post(url, headers=w.auth["charge"])
    assert r.status_code == 200, r.text
    assert (r.json()["state"], r.json()["board"], r.json()["alerts"]) == ("DISCHARGED", "ok", "ok")
    assert (await client.get("/patients", headers=BOARD)).json()["patients"] == []
    assert number not in app.state.board_link._engine(SLUG).patient_ids()     # its alarm ended
    assert len(audited(app, "admission.discharge_confirm")) == 1
    (retry,) = audited(app, "admission.discharge_board_retry")
    assert (retry.patient_id, retry.payload) == (number, {
        "admission_id": admission["id"], "board": "ok", "alerts": "ok", "via": "discharge.confirm",
        "actor": "charge@kabul.example.com"})
    db_session.expire_all()
    assert (await db_session.execute(select(Bed.state).where(Bed.id == bed_id))).scalar_one() \
        == BedState.HOUSEKEEPING


async def test_a_release_heals_a_card_left_standing_or_refuses_and_no_bed_holds_two_cards(
        ward, db_session, monkeypatch):
    """Review I-2 (b): a bed is never freed while its last discharged patient's card stands. The
    release runs the board step for that patient first; when it still fails, the release is
    refused `board_not_cleared` with that patient's number, the bed stays in cleaning, and no
    admission can take it — so one bed never shows two cards. Once the step lands, the release
    goes through and the bed takes its next patient, alone on it."""
    w, client, app = ward
    bed_id, next_form = w.beds["1"].id, form(w)
    admission = await started(w, client)
    number = admission["patient_number"]
    release = f"/tenant/beds/{bed_id}/release"

    async def on_bed_one() -> list[str]:
        cards = (await client.get("/patients", headers=BOARD)).json()["patients"]
        return [c["patient_id"] for c in cards if c["identity"]["bed_id"] == str(bed_id)]

    with monkeypatch.context() as patched:
        async def refused(self, tenant, patient_number):
            raise RuntimeError(f"the discharge of {patient_number} was refused")

        patched.setattr(BoardLink, "discharge_identity", refused)
        r = await client.post(f"/admissions/{admission['id']}/discharge/confirm",
                              headers=w.auth["charge"])
        assert (r.status_code, r.json()["board"]) == (200, "failed")
        r = await client.post(release, headers=w.auth["nurse"])
        assert (r.status_code, r.json()["detail"]["code"], r.json()["detail"]["patient_number"]) \
            == (409, "board_not_cleared", number)
        r = await client.post("/admissions", json=next_form, headers=w.auth["nurse"])
        assert (r.status_code, r.json()["detail"]["code"]) == (409, "bed_not_available")
        assert await on_bed_one() == [number]
    db_session.expire_all()
    assert (await db_session.execute(select(Bed.state).where(Bed.id == bed_id))).scalar_one() \
        == BedState.HOUSEKEEPING

    r = await client.post(release, headers=w.auth["nurse"])
    assert (r.status_code, r.json()["state"]) == (200, "AVAILABLE")
    assert await on_bed_one() == []
    assert [(row.payload["via"], row.payload["board"])
            for row in audited(app, "admission.discharge_board_retry")] == [("bed.release", "failed"),
                                                                             ("bed.release", "ok")]
    nxt = await client.post("/admissions", json=next_form, headers=w.auth["nurse"])
    assert nxt.status_code == 201, nxt.text
    assert await on_bed_one() == [nxt.json()["patient_number"]]


async def test_without_a_board_link_the_card_and_the_alerts_are_failed_never_skipped(
        ward, monkeypatch, caplog):
    """X53 (Task 8 re-review): `skipped` means "not asked". The card's removal is always asked
    for; an app built without its BoardLink did not do it: `failed`, logged at ERROR."""
    w, client, app = ward
    admission = await started(w, client)
    monkeypatch.setattr(app.state, "board_link", None)
    caplog.set_level(logging.ERROR, logger="homunculus.admission.router")
    r = await client.post(f"/admissions/{admission['id']}/discharge/confirm",
                          headers=w.auth["charge"])
    assert r.status_code == 200, r.text
    assert (r.json()["board"], r.json()["alerts"]) == ("failed", "failed")
    assert any(admission["patient_number"] in m
               for m in errors_of(caplog, "homunculus.admission.router"))


# ---------------------------------------------------------------- the audit after the commit (A-26)
async def test_an_audit_store_failing_after_the_commit_still_signs_starts_and_confirms(
        ward, db_session, monkeypatch, caplog):
    """A-26: each change has committed before its row is written; a failing store never turns it
    into a 500. Each failure is logged at ERROR with the event, the number and the actor — never a
    name."""
    w, client, app = ward
    admission = await admit(w, client)
    number = admission["patient_number"]
    append = app.state.audit.append

    def admission_rows_fail(event):
        if event.event_type.startswith("admission."):
            raise RuntimeError("audit store down while writing Sentetik Hasta")
        return append(event)

    monkeypatch.setattr(app.state.audit, "append", admission_rows_fail)
    caplog.set_level(logging.ERROR, logger="homunculus.admission.trail")
    base = f"/admissions/{admission['id']}"
    for path, body, who in (("/sign-off", None, "doctor"),
                            ("/discharge/initiate", {"disposition": "HOME"}, "doctor"),
                            ("/discharge/confirm", None, "charge")):
        r = await client.post(base + path, json=body, headers=w.auth[who])
        assert r.status_code == 200, r.text
    assert r.json()["board"] == "ok"
    db_session.expire_all()
    assert (await db_session.execute(select(Admission.state))).scalar_one() == \
        AdmissionState.DISCHARGED

    logged = errors_of(caplog, "homunculus.admission.trail")
    for event, actor in (("admission.sign_off", "doctor"), ("admission.discharge_start", "doctor"),
                         ("admission.discharge_confirm", "charge")):
        (line,) = [m for m in logged if f"event={event} " in m]
        assert number in line and f"{actor}@kabul.example.com" in line, line
    assert not any("Sentetik" in m for m in logged)


# ---------------------------------------------------------------- A-29: a resend and a discharge
async def test_a_resend_writing_the_card_again_while_the_patient_is_discharged_leaves_no_card(
        ward, db_session, monkeypatch):
    """The first send of a form commits and loses its answer before the board. Its resend reads
    the admission open and, before it writes the card again, the patient is signed, started and
    confirmed out through the routes. The resend's card is refused (BoardLink refuses a
    discharged number) and answered `failed`; the confirmation's board is `ok`; no card is on the
    board."""
    w, client, app = ward
    body = form(w, request_id=uuid.uuid4())

    async def lost(*args, **kwargs):
        raise RuntimeError("the answer is lost on the way")

    with monkeypatch.context() as patched:
        patched.setattr(admission_router, "_to_board", lost)
        with pytest.raises(RuntimeError, match="lost on the way"):
            await client.post("/admissions", json=body, headers=w.auth["nurse"])
    admission_id = (await db_session.execute(select(Admission.id))).scalar_one()

    reached, gate = asyncio.Event(), asyncio.Event()
    attempt = admission_router._attempt

    async def held(number, what, write):
        if what == "identity (again)":        # past the "still open" read, the card not yet built
            reached.set()
            await gate.wait()
        return await attempt(number, what, write)

    monkeypatch.setattr(admission_router, "_attempt", held)
    resend = asyncio.create_task(client.post("/admissions", json=body, headers=w.auth["nurse"]))
    try:
        await asyncio.wait_for(reached.wait(), timeout=10)
        base = f"/admissions/{admission_id}"
        for path, payload, who in (("/sign-off", None, "doctor"),
                                   ("/discharge/initiate", {"disposition": "HOME"}, "doctor"),
                                   ("/discharge/confirm", None, "charge")):
            r = await client.post(base + path, json=payload, headers=w.auth[who])
            assert r.status_code == 200, r.text
        assert r.json()["board"] == "ok"
    finally:
        gate.set()
    again = await resend
    assert again.status_code == 200, again.text
    assert again.json()["engine"]["board"] == "failed"
    assert (await client.get("/patients", headers=BOARD)).json()["patients"] == []
    assert app.state.board_link.is_discharged(SLUG, again.json()["patient_number"])


# ---------------------------------------------------------------- the whole flow (§8)
async def test_the_whole_flow_from_admission_to_a_free_bed(ward, db_session):
    w, client, app = ward
    bed_id, unit_id = w.beds["1"].id, w.units["rea"].id
    queue = app.state.broadcaster.subscribe(SLUG)
    rea_screen = build_scope("MEMBER", unit_ids=[str(unit_id)])
    neo_screen = build_scope("MEMBER", unit_ids=[str(w.units["neo"].id)])

    admission = await admit(w, client)
    number = admission["patient_number"]
    (card,) = (await client.get("/patients", headers=BOARD)).json()["patients"]
    assert (card["patient_id"], card["identity"]["bed_id"], card["identity"]["unit_id"]) == \
        (number, str(bed_id), str(unit_id))
    assert sees_patient(card, rea_screen) and not sees_patient(card, neo_screen)

    assert (await client.post(f"/admissions/{admission['id']}/sign-off",
                              headers=w.auth["doctor"])).status_code == 200
    assert (await client.post(f"/admissions/{admission['id']}/discharge/initiate",
                              json={"disposition": "HOME"},
                              headers=w.auth["doctor"])).status_code == 200
    drain(queue)
    r = await client.post(f"/admissions/{admission['id']}/discharge/confirm",
                          headers=w.auth["charge"])
    assert r.status_code == 200, r.text
    assert (r.json()["state"], r.json()["board"], r.json()["alerts"]) == ("DISCHARGED", "ok", "ok")

    assert (await client.get("/patients", headers=BOARD)).json()["patients"] == []
    (removal,) = drain(queue)                     # exactly one frame: the retirement's (A-11d)
    assert (removal["patient_id"], removal["removed"]) == (number, True)
    assert removal["identity"] == {"bed_id": str(bed_id), "unit_id": str(unit_id)}
    assert "Sentetik" not in repr(removal)
    assert number not in app.state.board_link._engine(SLUG).patient_ids()

    async def heard(scope) -> str:
        frames = asyncio.Queue()
        await frames.put(removal)
        return await anext(sse_board_frames(frames, keepalive=0.05,
                                            allow=lambda b: sees_patient(b, scope)))

    for screen in (rea_screen, build_scope("HOSPITAL_ADMIN")):
        assert json.loads((await heard(screen))[len("data: "):])["removed"] is True
    assert await heard(neo_screen) == ": keep-alive\n\n"

    # A-11: a reading still arriving for the number is dropped before the engine, shown nowhere.
    reading = {"resourceType": "Observation", "status": "final",
               "code": {"coding": [{"system": "http://homunculus.local/obs",
                                    "code": "heart_rate"}]},
               "subject": {"reference": f"Patient/{number}"},
               "effectiveDateTime": datetime.now(timezone.utc).isoformat(),
               "valueQuantity": {"value": 140, "unit": "/min"}, "device": {"display": "nce"}}
    r = await client.post("/ingest", json=reading, headers=BOARD)
    assert (r.status_code, r.json()) == (200, {"patient_id": number, "dropped": "discharged"})
    assert drain(queue) == []
    assert (await client.get("/patients", headers=BOARD)).json()["patients"] == []

    db_session.expire_all()
    assert (await db_session.execute(select(Bed.state).where(Bed.id == bed_id))).scalar_one() \
        == BedState.HOUSEKEEPING
    r = await client.post(f"/tenant/beds/{bed_id}/release", headers=w.auth["nurse"])
    assert (r.status_code, r.json()["state"]) == (200, "AVAILABLE")
    assert audited(app, "admission.discharge_board_retry") == []        # nothing left to heal
    assert [e.event_type for e in app.state.audit.records(tenant=SLUG, patient_id=number, limit=50)
            if e.event_type.startswith("admission.")] == [
        "admission.admit", "admission.sign_off", "admission.discharge_start",
        "admission.discharge_confirm"]
    (confirmed,) = audited(app, "admission.discharge_confirm")
    assert confirmed.payload == {"admission_id": admission["id"], "bed_id": str(bed_id),
                                 "actor": "charge@kabul.example.com"}
    state = (await db_session.execute(select(Admission.state))).scalar_one()
    assert state == AdmissionState.DISCHARGED

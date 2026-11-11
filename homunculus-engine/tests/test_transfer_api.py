# homunculus-engine/tests/test_transfer_api.py
"""Group 2 · B1b — Nakil, the one-step transfer (spec 2026-11-09 §5, §6). Postgres (`db_session`).
Synthetic ward: tests/kabul_world.py — Reanimasiya: beds 1, 2, 10 (Otaq 1) and 3 (Otaq 2);
Neonatal: bed N1.
- One request moves an ACTIVE patient: the source TRANSFERRED, its bed in cleaning, the target
  OCCUPIED, from AVAILABLE or from RESERVED with the clinician's confirmation. No pending state is
  ever committed (D1, T3, T5).
- Every refusal writes nothing: each source state that is not ACTIVE, each target that is not
  free, a closed bed, room or unit, the patient's own bed, each note rule, a body naming a unit
  (T2, T4, T5, D8).
- The arriving row: the moved protocol, the same board key, the person's identity digest (a new
  admission of her is refused), B1a's fields, the bed's own unit, the move's reason and its note
  encrypted at rest (T6, D8, O8).
- The care team moves (T7), and a handover in hand follows her (X17, the owner's answer of
  2026-11-10). The caller's units hold both beds (C-2, D6); either key moves (D5).
- A transfer racing an admission into the target, a reservation of it, a second transfer of the
  patient and a discharge start: one winner, the other refused by state (§5.2).
- The card follows (D3); the two-step routes are gone (T1)."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import async_sessionmaker

from homunculus.admission.models import Admission, AdmissionState, CareTeamMember, CareTeamRole
from homunculus.auth.groups import ensure_default_groups
from homunculus.scope import service as scope_service
from homunculus.scope.models import StaffScope
from homunculus.tenant.models import Bed, BedState, Room, Unit
from tests.conftest import requires_db
from tests.kabul_world import FIRST_PROTOCOL, SLUG, build_ward, ward_client
from tests.signed_in import add_user, bearer
from tests.test_discharge_api import (
    _cards_on, _the_ward, admit, at_once, drain, form, signed, started,
)

pytestmark = [requires_db]
NOTE = "Sentetik nakil notu"
RESERVED_NOTE = "Sentetik planlı kabul"


@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    built = await build_ward(db_session)
    async with ward_client(db_session) as (client, app):
        yield built, client, app


def move(w, bed: str = "2", reason: str = "CLINICAL_NEED", **top) -> dict:
    """The «Nakil» dialog's body: the new bed, the reason, and what `top` adds (a note, the
    reserved-bed answer)."""
    return {"target_bed_id": str(w.beds[bed].id), "reason": reason, **top}


async def transfer(w, client, admission: dict, bed: str = "2", who: str = "doctor",
                   reason: str = "CLINICAL_NEED", **top):
    return await client.post(f"/admissions/{admission['id']}/transfer",
                             json=move(w, bed, reason, **top), headers=w.auth[who])


async def moved(w, client, admission: dict, bed: str = "2", who: str = "doctor",
                reason: str = "CLINICAL_NEED", **top) -> dict:
    r = await transfer(w, client, admission, bed, who, reason, **top)
    assert r.status_code == 201, r.text
    return r.json()


async def _set(db, model, ident: uuid.UUID, **values) -> None:
    await db.execute(update(model).where(model.id == ident).values(**values)
                     .execution_options(synchronize_session=False))
    await db.commit()


async def _fresh(db_session, stmt) -> list:
    """Rows as committed, read in a session of its own (B3a lesson 2: the test's ward objects
    are never expired under it)."""
    async with async_sessionmaker(db_session.bind)() as fresh:
        return (await fresh.execute(stmt)).all()


def _audit_count(app) -> int:
    return len(app.state.audit.records(tenant=SLUG, limit=1000))


async def _refused_writing_nothing(db_session, app, call, status: int, code: str | None):
    """`call()` is refused with `status` (and `code`, when given) and writes nothing: no admission
    or bed moves, no audit row, no frame. Answers the refusal."""
    before, rows = await _the_ward(db_session), _audit_count(app)
    queue = app.state.broadcaster.subscribe(SLUG)
    r = await call()
    assert r.status_code == status, r.text
    if code is not None:
        assert r.json()["detail"]["code"] == code, r.text
    assert await _the_ward(db_session) == before
    assert _audit_count(app) == rows
    assert drain(queue) == []
    return r


# ---------------------------------------------------------------- one step (D1, T3, T5)
async def test_an_active_patient_moves_in_one_step_and_no_pending_state_is_committed(ward,
                                                                                    db_session):
    w, client, _ = ward
    one, two, rea = w.beds["1"].id, w.beds["2"].id, w.units["rea"].id
    source = await signed(w, client)
    answer = await moved(w, client, source)
    assert (answer["state"], answer["bed_id"], answer["admitting_unit_id"]) == (
        "ACTIVE", str(two), str(rea))
    assert (answer["source_admission_id"], answer["transfer_confirm_deadline"]) == (
        source["id"], None)
    assert (answer["transfer_reason"], answer["board"], answer["critical_alarm_open"]) == (
        "CLINICAL_NEED", "ok", False)
    assert "transfer_note" not in answer
    admissions, beds = await _the_ward(db_session)
    assert {(str(a.id), a.bed_id, a.state.value) for a in admissions} == {
        (source["id"], one, "TRANSFERRED"), (answer["id"], two, "ACTIVE")}
    assert (beds[one], beds[two]) == (BedState.HOUSEKEEPING, BedState.OCCUPIED)
    assert BedState.PENDING_TRANSFER_OUT not in beds.values()


async def test_a_reserved_target_needs_the_confirmation_and_the_refusal_names_the_bed_only(
        ward, db_session):
    """T5, B3a R5 and X1: an admission's rule and refusal, on the same bed."""
    w, client, app = ward
    two = w.beds["2"].id
    source = await signed(w, client)
    r = await client.post(f"/tenant/beds/{two}/reserve", json={"note": RESERVED_NOTE},
                          headers=w.auth["charge"])
    assert r.status_code == 200, r.text
    r = await _refused_writing_nothing(db_session, app, lambda: transfer(w, client, source),
                                       409, "bed_reserved")
    assert r.json()["detail"]["bed_id"] == str(two) and RESERVED_NOTE not in r.text
    await moved(w, client, source, confirm_reserved=True)
    row = (await db_session.execute(text("SELECT state::text, state_note FROM beds WHERE id = :id"),
                                    {"id": two})).one()
    assert tuple(row) == ("OCCUPIED", None)


# ---------------------------------------------------------------- refusals write nothing (T4, T5)
async def _draft(w, client) -> dict:
    return await admit(w, client)


async def _pending_discharge(w, client) -> dict:
    return await started(w, client)


async def _discharged(w, client) -> dict:
    admission = await started(w, client)
    r = await client.post(f"/admissions/{admission['id']}/discharge/confirm",
                          headers=w.auth["charge"])
    assert r.status_code == 200, r.text
    return admission


async def _moved_elsewhere(w, client) -> dict:
    """TRANSFERRED, its arriving row on bed 10 — not on the bed the test asks for."""
    admission = await signed(w, client)
    await moved(w, client, admission, "10")
    return admission


@pytest.mark.parametrize("setup", [_draft, _pending_discharge, _discharged, _moved_elsewhere])
async def test_only_an_active_patient_moves(ward, db_session, setup):
    w, client, app = ward
    admission = await setup(w, client)
    await _refused_writing_nothing(db_session, app, lambda: transfer(w, client, admission),
                                   409, "invalid_transition")


@pytest.mark.parametrize("state", [BedState.HOUSEKEEPING, BedState.MAINTENANCE, BedState.BLOCKED,
                                   BedState.PENDING_DISCHARGE, BedState.PENDING_TRANSFER_OUT])
async def test_a_target_that_is_not_free_is_refused(ward, db_session, state):
    w, client, app = ward
    two = w.beds["2"].id
    source = await signed(w, client)
    await _set(db_session, Bed, two, state=state)
    await _refused_writing_nothing(db_session, app, lambda: transfer(w, client, source),
                                   409, "bed_not_available")


async def test_an_occupied_target_is_refused(ward, db_session):
    w, client, app = ward
    source = await signed(w, client)
    await admit(w, client, "2")
    await _refused_writing_nothing(db_session, app, lambda: transfer(w, client, source),
                                   409, "bed_not_available")


@pytest.mark.parametrize("closed", ["bed", "room", "unit"])
async def test_a_closed_target_bed_room_or_unit_is_refused(ward, db_session, closed):
    w, client, app = ward
    model, ident = {"bed": (Bed, w.beds["N1"].id), "room": (Room, w.rooms["n1"].id),
                    "unit": (Unit, w.units["neo"].id)}[closed]
    source = await signed(w, client)
    await _set(db_session, model, ident, is_active=False)
    await _refused_writing_nothing(db_session, app,
                                   lambda: transfer(w, client, source, "N1", "admin"),
                                   409, "bed_closed")


async def test_the_patients_own_bed_is_not_a_target(ward, db_session):
    w, client, app = ward
    source = await signed(w, client)
    await _refused_writing_nothing(db_session, app, lambda: transfer(w, client, source, "1"),
                                   422, "field_invalid:target_bed_id")


@pytest.mark.parametrize(("reason", "note"), [("OTHER", None), ("OTHER", "   "),
                                              ("CLINICAL_NEED", "x" * 201)])
async def test_each_note_rule_is_a_coded_422(ward, db_session, reason, note):
    """D8, X3: «Diğer» needs a note — blank is none — and a note is at most 200 characters."""
    w, client, app = ward
    source = await signed(w, client)
    body = {} if note is None else {"note": note}
    await _refused_writing_nothing(
        db_session, app, lambda: transfer(w, client, source, reason=reason, **body),
        422, "field_invalid:note")


async def test_a_body_naming_a_unit_is_refused_the_unit_is_the_beds(ward, db_session):
    """T2, A-12: the old routes' `target_unit_id` is a field this body does not take."""
    w, client, app = ward
    source = await signed(w, client)
    body = {**move(w, "2"), "target_unit_id": str(w.units["neo"].id)}
    await _refused_writing_nothing(
        db_session, app,
        lambda: client.post(f"/admissions/{source['id']}/transfer", json=body,
                            headers=w.auth["doctor"]),
        422, None)


# ---------------------------------------------------------------- the arriving row (T6, D8, O8)
async def test_the_arriving_row_keeps_the_protocol_the_key_the_person_and_the_form(ward):
    w, client, _ = ward
    neo = w.units["neo"].id
    source = await signed(w, client)
    assert source["board_key"] == FIRST_PROTOCOL                       # the ward's synthetic one
    before = (await client.get(f"/admissions/{source['id']}", headers=w.auth["admin"])).json()
    answer = await moved(w, client, source, "N1", "admin")
    assert (answer["protocol_no"], answer["admitting_unit_id"]) == (FIRST_PROTOCOL, str(neo))
    after = (await client.get(f"/admissions/{source['id']}", headers=w.auth["admin"])).json()
    assert (after["state"], after["protocol_no"]) == ("TRANSFERRED", None)
    carried = ("admission_type", "blood_group", "allergies_text", "no_known_allergy",
               "comorbidity_codes", "comorbidities_text", "weight_kg",
               "admission_diagnosis_free_text", "attending_physician_id", "signed_by",
               "signed_at", "patient_id", "tenant_id")
    assert {f: answer[f] for f in carried} == {f: before[f] for f in carried}
    detail = (await client.get(f"/admissions/{answer['id']}", headers=w.auth["admin"])).json()
    assert detail["board_key"] == FIRST_PROTOCOL
    # A-37: the person's open admission is the arriving one; a new one of her is refused.
    again = form(w, "3")
    again["patient"]["display_name"] = "Sentetik Hasta"
    r = await client.post("/admissions", json=again, headers=w.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"], r.json()["detail"]["board_key"]) == (
        409, "duplicate_open_admission", FIRST_PROTOCOL)


async def test_the_reason_and_the_note_are_kept_on_the_arriving_row_the_note_encrypted(
        ward, db_session):
    w, client, _ = ward
    source = await signed(w, client)
    answer = await moved(w, client, source, reason="ISOLATION", note=f"  {NOTE}  ")
    arriving = uuid.UUID(answer["id"])
    raw = (await db_session.execute(text("SELECT transfer_reason, transfer_note FROM admissions "
                                         "WHERE id = :id"), {"id": arriving})).one()
    assert raw.transfer_reason == "ISOLATION" and raw.transfer_note and NOTE not in raw.transfer_note
    ((kept,),) = await _fresh(db_session, select(Admission.transfer_note)
                              .where(Admission.id == arriving))
    assert kept == NOTE                                                # trimmed, read back
    ((reason, note),) = await _fresh(db_session, select(Admission.transfer_reason,
                                                        Admission.transfer_note)
                                     .where(Admission.id == uuid.UUID(source["id"])))
    assert (reason, note) == (None, None)
    # A later move writes its own reason and note, and copies neither.
    second = await moved(w, client, answer, "10", reason="OTHER", note="Sentetik ikinci not")
    third = await moved(w, client, second, "3")
    rows = {str(i): (r, n) for i, r, n in await _fresh(db_session, select(
        Admission.id, Admission.transfer_reason, Admission.transfer_note))}
    assert rows[second["id"]] == ("OTHER", "Sentetik ikinci not")
    assert rows[third["id"]] == ("CLINICAL_NEED", None)


# ---------------------------------------------------------------- the care team (T7)
def _team(rows) -> list:
    return sorted(((r.user_id, r.role, r.window_start, r.window_end, r.granted_by_id)
                   for r in rows), key=repr)


async def test_the_care_team_is_closed_on_the_source_and_copied_onto_the_arriving_row(
        ward, db_session):
    """T7, B1c §5.4: the same members, roles, windows and grantors — active on the arriving row,
    closed on the source — so the own-patient scope reads the card's key, never the source's
    H-number."""
    w, client, _ = ward
    tenant_id, charge, doctor = w.tenant.id, w.users["charge"].id, w.users["doctor"].id
    source = await signed(w, client)
    now = datetime.now(timezone.utc)
    db_session.add(CareTeamMember(admission_id=uuid.UUID(source["id"]), user_id=charge,
                                  role=CareTeamRole.ONCALL_PHYSICIAN, granted_by_id=doctor,
                                  window_start=now - timedelta(hours=1),
                                  window_end=now + timedelta(hours=11)))
    await db_session.commit()
    members = select(CareTeamMember.user_id, CareTeamMember.role, CareTeamMember.window_start,
                     CareTeamMember.window_end, CareTeamMember.granted_by_id,
                     CareTeamMember.is_active, CareTeamMember.closed_at)
    before = await _fresh(db_session, members.where(
        CareTeamMember.admission_id == uuid.UUID(source["id"]),
        CareTeamMember.is_active.is_(True)))
    answer = await moved(w, client, source)
    closed = await _fresh(db_session, members.where(
        CareTeamMember.admission_id == uuid.UUID(source["id"])))
    copied = await _fresh(db_session, members.where(
        CareTeamMember.admission_id == uuid.UUID(answer["id"])))
    assert closed and all(not r.is_active and r.closed_at is not None for r in closed)
    assert all(r.is_active for r in copied) and _team(copied) == _team(before)
    async with async_sessionmaker(db_session.bind)() as fresh:
        assert await scope_service.read_own_patient_ids(fresh, charge, tenant_id) == [
            FIRST_PROTOCOL]


# ---------------------------------------------------------------- who, and where (D5, D6, C-2)
async def _two_units(db, w) -> dict[str, str]:
    """A nurse granted both units: her token."""
    tenant_id, rea, neo = w.tenant.id, w.units["rea"].id, w.units["neo"].id
    groups = await ensure_default_groups(db, tenant_id)
    user = await add_user(db, username="both@kabul.example.com", tenant_id=tenant_id,
                          group=groups["nurse"])
    db.add_all([StaffScope(tenant_id=tenant_id, user_id=user.id, unit_id=str(unit))
                for unit in (rea, neo)])
    await db.commit()
    return await bearer(db, user)


@pytest.mark.parametrize(("who", "bed", "status", "code"), [
    ("doctor", "N1", 403, "out_of_scope"),      # D6: the target outside her units
    ("nurse_b", "2", 403, "out_of_scope"),      # C-2: the patient's bed outside her units
    ("auditor", "2", 403, None),                # neither key
])
async def test_a_caller_needs_a_key_and_both_beds(ward, db_session, who, bed, status, code):
    w, client, app = ward
    source = await signed(w, client)
    await _refused_writing_nothing(db_session, app,
                                   lambda: transfer(w, client, source, bed, who), status, code)


@pytest.mark.parametrize(("who", "bed"), [
    ("doctor", "2"),       # admissions.move.initiate alone
    ("nurse", "2"),        # admissions.transfer.confirm alone
    ("charge", "2"),
    ("admin", "N1"),       # unrestricted
    ("both", "N1"),        # her units hold both beds
])
async def test_either_key_moves_a_patient_between_beds_the_caller_holds(ward, db_session, who,
                                                                        bed):
    w, client, _ = ward
    if who == "both":
        w.auth["both"] = await _two_units(db_session, w)
    source = await signed(w, client)
    await moved(w, client, source, bed, who)


async def test_a_physician_cannot_move_another_units_patient_into_her_own(ward, db_session):
    """The review's C-2: the patient lies in Neonatal; the Reanimasiya physician cannot move her
    into Reanimasiya."""
    w, client, app = ward
    neo = await admit(w, client, "N1", "neo", who="nurse_b")
    await _set(db_session, Admission, uuid.UUID(neo["id"]), state=AdmissionState.ACTIVE)
    await _refused_writing_nothing(db_session, app,
                                   lambda: transfer(w, client, neo, "2", "doctor"),
                                   403, "out_of_scope")


# ---------------------------------------------------------------- one after the other (§5.2)
async def _race(db_session, monkeypatch, w, client, second):
    """A transfer of bed 1's patient to bed 2, held inside its transaction once the service has
    written (its locks held), until `second(source)` waits on a lock; then both finish
    (test_discharge_api `at_once`)."""
    source = await signed(w, client)
    one, two = await at_once(db_session, monkeypatch, "transfer_patient",
                             lambda: transfer(w, client, source), lambda: second(source))
    assert one.status_code == 201, one.text
    return two


async def test_an_admission_into_the_target_waits_and_is_refused(ward, db_session, monkeypatch):
    w, client, _ = ward
    two = await _race(db_session, monkeypatch, w, client,
                      lambda s: client.post("/admissions", json=form(w, "2"),
                                            headers=w.auth["nurse"]))
    assert (two.status_code, two.json()["detail"]["code"]) == (409, "bed_not_available")


async def test_a_reservation_of_the_target_waits_and_is_refused(ward, db_session, monkeypatch):
    w, client, _ = ward
    bed_two = w.beds["2"].id
    two = await _race(db_session, monkeypatch, w, client,
                      lambda s: client.post(f"/tenant/beds/{bed_two}/reserve", json={},
                                            headers=w.auth["charge"]))
    assert (two.status_code, two.json()["detail"]["code"]) == (409, "invalid_transition")


async def test_a_second_transfer_of_the_patient_waits_and_is_refused(ward, db_session,
                                                                     monkeypatch):
    w, client, _ = ward
    two = await _race(db_session, monkeypatch, w, client, lambda s: transfer(w, client, s, "10"))
    assert (two.status_code, two.json()["detail"]["code"]) == (409, "invalid_transition")


async def test_a_discharge_start_waits_and_is_refused(ward, db_session, monkeypatch):
    w, client, _ = ward
    two = await _race(db_session, monkeypatch, w, client,
                      lambda s: client.post(f"/admissions/{s['id']}/discharge/initiate",
                                            json={"disposition": "HOME"},
                                            headers=w.auth["doctor"]))
    assert (two.status_code, two.json()["detail"]["code"]) == (409, "invalid_transition")


async def test_a_transfer_waits_for_an_admission_into_its_target_and_is_refused(ward, db_session,
                                                                                monkeypatch):
    w, client, _ = ward
    source = await signed(w, client)
    one, two = await at_once(db_session, monkeypatch, "create_draft_admission",
                             lambda: client.post("/admissions", json=form(w, "2"),
                                                 headers=w.auth["nurse"]),
                             lambda: transfer(w, client, source))
    assert one.status_code == 201, one.text
    assert (two.status_code, two.json()["detail"]["code"]) == (409, "bed_not_available")


# ---------------------------------------------------------------- the card follows; the old routes
async def test_the_card_follows_the_patient_to_her_new_bed_under_the_same_key(ward):
    """D3: the card on the new bed under the board key it had."""
    w, client, _ = ward
    one, two = w.beds["1"].id, w.beds["2"].id
    source = await signed(w, client)
    await moved(w, client, source)
    assert await _cards_on(client, one) == []
    assert await _cards_on(client, two) == [source["board_key"]]


@pytest.mark.parametrize("step", ["initiate", "confirm"])
async def test_the_two_step_routes_are_gone(ward, step):
    """T1: nothing to initiate or confirm any more."""
    w, client, _ = ward
    source = await signed(w, client)
    r = await client.post(f"/admissions/{source['id']}/transfer/{step}",
                          json={"target_bed_id": str(w.beds["2"].id),
                                "target_unit_id": str(w.units["rea"].id)},
                          headers=w.auth["admin"])
    assert r.status_code in (404, 405)

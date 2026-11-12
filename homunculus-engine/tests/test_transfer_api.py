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

import asyncio
import json
import uuid
from contextlib import aclosing
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import async_sessionmaker

from homunculus.admission import transfer as transfer_module
from homunculus.admission.boardlink import BoardLink
from homunculus.admission.models import (
    Admission, AdmissionState, CareTeamMember, CareTeamRole, Handover,
)
from homunculus.api.app import ScopedBoardView, sse_board_frames
from homunculus.auth.groups import ensure_default_groups
from homunculus.scope import build_scope
from homunculus.scope import service as scope_service
from homunculus.scope.models import StaffScope
from homunculus.tenant.models import Bed, BedState, Room, Unit
from tests.conftest import requires_db
from tests.kabul_world import BOARD, FIRST_PROTOCOL, SLUG, build_ward, ward_client
from tests.signed_in import add_user, bearer
from tests.test_discharge_api import (
    _cards_on, _refused_tombstone, _the_ward, acknowledged, admit, at_once, audited, drain, form,
    septic_shock, signed, started,
)

pytestmark = [requires_db]
NOTE = "Sentetik nakil notu"
RESERVED_NOTE = "Sentetik planlı kabul"
#: A D-Ö-D-Ö note as «Vardiya devri» sends it (G2-B3b D5), for the handover in hand (X17).
HANDOVER_NOTE = {"situation": "Sentetik durum: hemodinami stabil",
                 "background": "Sentetik öykü: postop 2. gün",
                 "assessment": "Sentetik değerlendirme: laktat düşüyor",
                 "recommendation": "Sentetik öneri: 2 saatte bir laktat"}


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


async def test_a_note_of_exactly_200_characters_is_accepted_and_kept(ward, db_session):
    """X3: the bound is inclusive — 200 characters pass, 201 are the coded 422 above."""
    w, client, _ = ward
    source = await signed(w, client)
    answer = await moved(w, client, source, note="x" * 200)
    ((kept,),) = await _fresh(db_session, select(Admission.transfer_note)
                              .where(Admission.id == uuid.UUID(answer["id"])))
    assert kept == "x" * 200


async def test_a_note_with_a_control_character_is_the_coded_422_and_is_never_echoed(
        ward, db_session):
    """The body's text rule (a control character other than tab and line breaks is not text) is
    answered as `field_invalid:note`, and the value is not repeated in the answer."""
    w, client, app = ward
    source = await signed(w, client)
    r = await _refused_writing_nothing(
        db_session, app, lambda: transfer(w, client, source, note=f"{NOTE}\x1b[31m"),
        422, "field_invalid:note")
    assert not any(part in r.text for part in ("\x1b", "\\u001b", "[31m", NOTE))


async def test_confirm_reserved_is_a_real_boolean_a_string_is_refused(ward, db_session):
    """B3a R5: the clinician's answer is `true`, not the text "true" (`StrictBool`)."""
    w, client, app = ward
    source = await signed(w, client)
    await _refused_writing_nothing(
        db_session, app, lambda: transfer(w, client, source, confirm_reserved="true"), 422, None)


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


# ---------------------------------------------------------------- the card (T8, T9, §5.4, §5.5)
async def _heard(frames: list[dict], scope, shown: set[str]) -> list[dict]:
    """The frames a screen of `scope` that shows the cards `shown` is sent, in order, until the
    stream falls quiet: what `/stream` sends a scoped subscriber (`sse_board_frames` with its
    `ScopedBoardView`, G2 borç 1; X19)."""
    queue: asyncio.Queue = asyncio.Queue()
    for frame in frames:
        await queue.put(frame)
    sent = []
    async with aclosing(sse_board_frames(queue, keepalive=0.05,
                                         view=ScopedBoardView(scope, shown))) as stream:
        async for chunk in stream:
            if not chunk.startswith("data: "):
                break
            sent.append(json.loads(chunk[len("data: "):]))
    return sent


async def test_the_card_moves_under_its_key_and_the_old_place_is_told_first(ward):
    """T8, F7: a removal for the old bed and unit, with no name, then the card at the new place.
    Through the stream's view (X19): a screen of the old unit, which showed her card, hears the
    move's own removal only; a screen of the new unit hears the card only; a screen of both hears
    the two, in that order."""
    w, client, app = ward
    one, rea = str(w.beds["1"].id), str(w.units["rea"].id)
    n1, neo = str(w.beds["N1"].id), str(w.units["neo"].id)
    source = await signed(w, client)
    key = source["board_key"]
    queue = app.state.broadcaster.subscribe(SLUG)
    answer = await moved(w, client, source, "N1", "admin")
    assert answer["board"] == "ok"
    removal, card = drain(queue)
    assert removal == {"patient_id": key, "removed": True,
                       "identity": {"bed_id": one, "unit_id": rea}}
    assert "Sentetik" not in repr(removal)
    assert (card["patient_id"], card["identity"]["bed_id"], card["identity"]["unit_id"]) == (
        key, n1, neo)
    assert await _cards_on(client, n1) == [key] and await _cards_on(client, one) == []
    old, new = build_scope("MEMBER", unit_ids=[rea]), build_scope("MEMBER", unit_ids=[neo])
    both = build_scope("MEMBER", unit_ids=[rea, neo])
    assert await _heard([removal, card], old, {key}) == [removal]          # its place, not the view's
    assert [f.get("removed", False) for f in await _heard([removal, card], new, set())] == [False]
    assert [f.get("removed", False) for f in await _heard([removal, card], both, {key})] == [
        True, False]


async def test_the_strips_occupants_are_dropped_when_the_card_moves(ward, monkeypatch):
    w, client, app = ward
    source = await signed(w, client)
    heard: list = []
    monkeypatch.setattr(app.state.board_link, "_occupancy_reset", heard.append)
    await moved(w, client, source)
    assert heard == [SLUG]


async def test_an_open_critical_alarm_holds_nothing_and_moves_with_the_patient(ward):
    """D7: the move succeeds and says so; the alarm is on her card at the new bed."""
    w, client, app = ward
    two = str(w.beds["2"].id)
    source = await signed(w, client)
    key = source["board_key"]
    await septic_shock(client, key)
    answer = await moved(w, client, source)
    assert (answer["critical_alarm_open"], answer["board"]) == (True, "ok")
    (card,) = [c for c in (await client.get("/patients", headers=BOARD)).json()["patients"]
               if c["patient_id"] == key]
    assert card["identity"]["bed_id"] == two
    assert "septic_shock" in {a["kind"] for a in card["alerts"]}
    assert key in app.state.board_link._engine(SLUG).patient_ids()


async def test_a_card_that_did_not_move_is_moved_by_the_same_request_writing_nothing(
        ward, db_session, monkeypatch):
    """T9, X1: the same request on the TRANSFERRED source whose arriving row is open on that bed
    moves the card again and answers 200. Nothing is written in the database."""
    w, client, app = ward
    one, two, rea = w.beds["1"].id, w.beds["2"].id, w.units["rea"].id
    source = await signed(w, client)
    key = source["board_key"]
    real, refusals = BoardLink.move, []

    async def refused_once(self, tenant, record, *, left):
        if not refusals:
            refusals.append(record.patient_id)
            return "failed"
        return await real(self, tenant, record, left=left)

    monkeypatch.setattr(BoardLink, "move", refused_once)
    first = await transfer(w, client, source)
    assert (first.status_code, first.json()["board"]) == (201, "failed")
    assert await _cards_on(client, one) == [key]                     # T9: never taken off
    after_first = await _the_ward(db_session)
    queue = app.state.broadcaster.subscribe(SLUG)
    again = await transfer(w, client, source)
    assert (again.status_code, again.json()["board"], again.json()["id"]) == (
        200, "ok", first.json()["id"])
    assert await _the_ward(db_session) == after_first
    assert await _cards_on(client, two) == [key] and await _cards_on(client, one) == []
    (retry,) = audited(app, "admission.transfer_board_retry")
    assert (retry.patient_id, retry.payload["via"], retry.payload["board"]) == (
        key, "transfer", "ok")
    # Task 4 review: the retry tells the OLD place — the patient's bed and its unit — then the card.
    removal, card = drain(queue)
    assert removal == {"patient_id": key, "removed": True,
                       "identity": {"bed_id": str(one), "unit_id": str(rea)}}
    assert (card["patient_id"], card["identity"]["bed_id"]) == (key, str(two))


async def test_a_resend_after_a_later_move_is_refused_and_puts_no_second_card(ward, db_session):
    """T9, Task 4 review: the first request sent again once the patient has moved on is not a
    retry. Her arriving row is no longer open, so the resend is the 409 any move of a TRANSFERRED
    admission is — and no phantom card (her H-number, her protocol gone from the source) appears
    on the bed she left."""
    w, client, app = ward
    two, ten = w.beds["2"].id, w.beds["10"].id
    source = await signed(w, client)
    key = source["board_key"]
    arriving = await moved(w, client, source, "2")
    await moved(w, client, arriving, "10")
    await _refused_writing_nothing(db_session, app, lambda: transfer(w, client, source, "2"),
                                   409, "invalid_transition")
    assert await _cards_on(client, ten) == [key] and await _cards_on(client, two) == []


async def test_a_resend_after_the_arriving_stay_was_discharged_is_refused_and_writes_nothing(
        ward, db_session):
    """T9, Task 4 review: the same, when the arriving row has been DISCHARGED since. The card is
    off the board for good (a tombstone), and the resend does not try to put it back."""
    w, client, app = ward
    one, two = w.beds["1"].id, w.beds["2"].id
    source = await signed(w, client)
    key = source["board_key"]
    arriving = await moved(w, client, source, "2")
    r = await client.post(f"/admissions/{arriving['id']}/discharge/initiate",
                          json={"disposition": "HOME"}, headers=w.auth["doctor"])
    assert r.status_code == 200, r.text
    r = await client.post(f"/admissions/{arriving['id']}/discharge/confirm",
                          headers=w.auth["charge"])
    assert (r.status_code, r.json()["board"]) == (200, "ok")
    assert app.state.board_link.is_discharged(SLUG, key)
    await _refused_writing_nothing(db_session, app, lambda: transfer(w, client, source, "2"),
                                   409, "invalid_transition")
    assert await _cards_on(client, two) == [] and await _cards_on(client, one) == []


async def test_the_old_beds_release_moves_a_card_left_on_it_or_refuses_and_never_takes_it_off(
        ward, db_session, monkeypatch):
    """T9, C-1: the old bed is not freed under a card left on it. Its release moves the card to
    the patient's bed now, or is refused `board_not_cleared` with her key while it cannot."""
    w, client, app = ward
    one, two, rea = w.beds["1"].id, w.beds["2"].id, w.units["rea"].id
    source = await signed(w, client)
    key = source["board_key"]
    release = f"/tenant/beds/{one}/release"
    with monkeypatch.context() as patched:
        async def refused(self, tenant, record, *, left):
            return "failed"

        patched.setattr(BoardLink, "move", refused)
        assert (await transfer(w, client, source)).json()["board"] == "failed"
        r = await client.post(release, headers=w.auth["nurse"])
        assert (r.status_code, r.json()["detail"]["code"], r.json()["detail"]["board_key"]) == (
            409, "board_not_cleared", key)
        state = (await db_session.execute(text("SELECT state::text FROM beds WHERE id = :id"),
                                          {"id": one})).scalar_one()
        assert state == "HOUSEKEEPING"
    queue = app.state.broadcaster.subscribe(SLUG)
    r = await client.post(release, headers=w.auth["nurse"])
    assert (r.status_code, r.json()["state"]) == (200, "AVAILABLE")
    assert await _cards_on(client, two) == [key] and await _cards_on(client, one) == []
    assert not app.state.board_link.is_discharged(SLUG, key)
    assert [(row.payload["via"], row.payload["board"])
            for row in audited(app, "admission.transfer_board_retry")] == [
        ("bed.release", "failed"), ("bed.release", "ok")]
    # Task 4 review: the release tells the OLD place — this bed and its unit — then the card.
    removal, card = drain(queue)
    assert removal == {"patient_id": key, "removed": True,
                       "identity": {"bed_id": str(one), "unit_id": str(rea)}}
    assert (card["patient_id"], card["identity"]["bed_id"]) == (key, str(two))


async def test_a_release_passes_over_a_patient_whose_card_moved_and_reads_no_name(
        ward, monkeypatch):
    """§5.5; Task 4 review: a card that is already elsewhere is passed over on its key alone —
    `card_of`, which decrypts the name, birth date and sex, is read for a card to be moved."""
    w, client, app = ward
    one = w.beds["1"].id
    source = await signed(w, client)
    await moved(w, client, source)
    reads = []
    real = transfer_module.card_of

    async def counted(db, admission_id):
        reads.append(admission_id)
        return await real(db, admission_id)

    monkeypatch.setattr(transfer_module, "card_of", counted)
    r = await client.post(f"/tenant/beds/{one}/release", headers=w.auth["nurse"])
    assert (r.status_code, r.json()["state"]) == (200, "AVAILABLE")
    assert audited(app, "admission.transfer_board_retry") == [] and reads == []


async def test_a_release_takes_off_the_card_of_a_patient_moved_and_discharged_since(
        ward, monkeypatch):
    """X4: her move's and then her discharge's board steps both failed, so her card still stands
    as admitted on the old bed though her stay has ended. The old bed's release takes it off, as a
    discharged patient's, and frees the bed."""
    w, client, app = ward
    one = w.beds["1"].id
    source = await signed(w, client)
    key = source["board_key"]
    with monkeypatch.context() as patched:
        async def refused_move(self, tenant, record, *, left):
            return "failed"

        patched.setattr(BoardLink, "move", refused_move)
        patched.setattr(BoardLink, "discharge_identity", _refused_tombstone)
        arriving = await moved(w, client, source)
        r = await client.post(f"/admissions/{arriving['id']}/discharge/initiate",
                              json={"disposition": "HOME"}, headers=w.auth["doctor"])
        assert r.status_code == 200, r.text
        r = await client.post(f"/admissions/{arriving['id']}/discharge/confirm",
                              headers=w.auth["charge"])
        assert (r.status_code, r.json()["board"]) == (200, "failed")
    assert await _cards_on(client, one) == [key]
    r = await client.post(f"/tenant/beds/{one}/release", headers=w.auth["nurse"])
    assert (r.status_code, r.json()["state"]) == (200, "AVAILABLE")
    assert await _cards_on(client, one) == [] and app.state.board_link.is_discharged(SLUG, key)
    (row,) = audited(app, "admission.discharge_board_retry")
    assert (row.payload["admission_id"], row.payload["via"], row.payload["board"]) == (
        arriving["id"], "bed.release", "ok")


# ---------------------------------------------------------------- audit (spec §5.6)
async def test_the_move_is_audited_with_its_places_protocol_and_reason_never_a_name_or_the_note(
        ward, db_session):
    w, client, app = ward
    one, rea = str(w.beds["1"].id), str(w.units["rea"].id)
    n1, neo = str(w.beds["N1"].id), str(w.units["neo"].id)
    source = await signed(w, client)
    answer = await moved(w, client, source, "N1", "admin", reason="OTHER", note=NOTE)
    copied = await _fresh(db_session, select(CareTeamMember.id).where(
        CareTeamMember.admission_id == uuid.UUID(answer["id"]),
        CareTeamMember.is_active.is_(True)))
    (row,) = audited(app, "admission.transfer")
    assert row.patient_id == FIRST_PROTOCOL
    assert row.payload == {
        "source_admission_id": source["id"], "admission_id": answer["id"],
        "from_bed_id": one, "from_unit_id": rea, "to_bed_id": n1, "to_unit_id": neo,
        "protocol_no": FIRST_PROTOCOL, "reason": "OTHER", "note": True,
        "critical_alarm_open": False, "care_team_moved": len(copied), "handovers_moved": 0,
        "handover_ids": [],                                                  # X21 (controller)
        "actor": "admin@kabul.example.com"}
    assert NOTE not in repr(row.payload) and "Sentetik Hasta" not in repr(row.payload)


async def test_the_audit_row_says_a_reserved_bed_and_an_open_critical_alarm(ward):
    w, client, app = ward
    two = w.beds["2"].id
    source = await signed(w, client)
    r = await client.post(f"/tenant/beds/{two}/reserve", json={"note": RESERVED_NOTE},
                          headers=w.auth["charge"])
    assert r.status_code == 200, r.text
    await septic_shock(client, source["board_key"])
    await moved(w, client, source, confirm_reserved=True)
    (row,) = audited(app, "admission.transfer")
    assert (row.payload["bed_was_reserved"], row.payload["critical_alarm_open"],
            row.payload["note"]) == (True, True, False)
    assert RESERVED_NOTE not in repr(row.payload)


async def test_a_card_moved_again_is_audited_as_a_retry_and_the_move_once(ward, monkeypatch):
    w, client, app = ward
    one = w.beds["1"].id
    source = await signed(w, client)
    key = source["board_key"]
    with monkeypatch.context() as patched:
        async def refused(self, tenant, record, *, left):
            return "failed"

        patched.setattr(BoardLink, "move", refused)
        first = (await transfer(w, client, source)).json()
        r = await client.post(f"/tenant/beds/{one}/release", headers=w.auth["nurse"])
        assert r.status_code == 409, r.text
    again = await transfer(w, client, source)
    assert again.status_code == 200, again.text
    assert len(audited(app, "admission.transfer")) == 1
    release, retry = audited(app, "admission.transfer_board_retry")
    assert (release.patient_id, release.payload) == (key, {
        "source_admission_id": source["id"], "admission_id": first["id"], "bed_id": str(one),
        "board": "failed", "via": "bed.release", "actor": "nurse@kabul.example.com"})
    assert (retry.patient_id, retry.payload) == (key, {
        "source_admission_id": source["id"], "admission_id": first["id"], "board": "ok",
        "via": "transfer", "actor": "doctor@kabul.example.com"})


# ---------------------------------------------------------------- a handover in hand (owner 2026-11-10, X17)
async def test_a_handover_in_hand_follows_the_patient_and_its_critical_gate_still_holds(ward):
    """The owner's answer of 2026-11-10 (X17). A handover the nurse opened on bed 1 names the
    arriving admission after the move. Her box shows the new bed and the key the card kept: what
    «Vardiya devri» locks the signature on, and what its dialog's "already open" check matches a
    second handover of the patient against (by `admission_id`; the server never refused a second
    one, G2-B3b). B3b's outgoing gate (D3) still counts the patient's open critical alarm under
    that key; acknowledged, the signature goes, seals her summary and is audited under her key.
    The move's own row counts the handover and names it (X21, the controller's addition: an
    inspection can tell which, possibly signed, handovers the move re-pointed)."""
    w, client, app = ward
    source = await signed(w, client)
    key = source["board_key"]
    r = await client.post("/handovers", json={
        "unit_id": str(w.units["rea"].id), "incoming_user_id": str(w.users["charge"].id),
        "admission_ids": [source["id"]]}, headers=w.auth["nurse"])
    assert r.status_code == 201, r.text
    handover = r.json()["id"]
    await septic_shock(client, key)
    answer = await moved(w, client, source)
    (row,) = audited(app, "admission.transfer")
    assert row.payload["handovers_moved"] == 1
    assert row.payload["handover_ids"] == [handover]                         # X21 (controller)

    async def outgoing() -> dict:
        r = await client.get("/handovers", params={"box": "outgoing"}, headers=w.auth["nurse"])
        assert r.status_code == 200, r.text
        (mine,) = r.json()
        return mine

    async def sign():
        return await client.post(f"/handovers/{handover}/sign-outgoing",
                                 json={"note": HANDOVER_NOTE}, headers=w.auth["nurse"])

    mine = await outgoing()
    assert (mine["status"], mine["patients"]) == ("OPEN", [{
        "admission_id": answer["id"], "board_key": key, "display_name": "Sentetik Hasta",
        "bed_label": "2", "unit_name": "Reanimasiya"}])
    r = await sign()
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "critical_alarm_open")
    await acknowledged(client, key)
    r = await sign()
    assert (r.status_code, r.json()["status"]) == (200, "OUTGOING_SIGNED")
    assert {"kind": "septic_shock", "severity": "critical", "acknowledged": True} \
        in (await outgoing())["summary"]["open_alerts"]
    (sealed,) = audited(app, "handover.sign_outgoing")
    assert sealed.patient_id == key


async def _handed(w, client, admission: dict) -> str:
    """The nurse opens a handover of this patient to the charge nurse (G2-B3b); its id."""
    r = await client.post("/handovers", json={
        "unit_id": str(w.units["rea"].id), "incoming_user_id": str(w.users["charge"].id),
        "admission_ids": [admission["id"]]}, headers=w.auth["nurse"])
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def test_the_audit_row_names_the_handovers_that_followed_in_handover_id_order(
        ward, db_session):
    """X21 (controller): two handovers in hand on the patient both follow her, and the row names
    them in the order of their ids — the order the service locks and answers them in — not the
    order they were opened in. Their ids are set here so the two orders differ: the first opened
    holds the larger id."""
    w, client, app = ward
    source = await signed(w, client)
    first, second = uuid.UUID(await _handed(w, client, source)), uuid.UUID(
        await _handed(w, client, source))
    high = uuid.UUID("ffffffff-0000-4000-8000-000000000001")
    low = uuid.UUID("00000000-0000-4000-8000-000000000002")
    await _set(db_session, Handover, first, id=high)
    await _set(db_session, Handover, second, id=low)
    await moved(w, client, source)
    (row,) = audited(app, "admission.transfer")
    assert row.payload["handovers_moved"] == 2
    assert row.payload["handover_ids"] == sorted([str(high), str(low)]) == [str(low), str(high)]


async def test_a_handover_in_hand_takes_the_patients_new_unit_and_the_waiting_count_follows(
        ward, db_session):
    """X22 (controller, on G4-02): a handover's unit is its patients' beds', and
    `GET /handovers/pending` counts by it. A handover the nurse signed on bed 1 waits for the
    countersignature in Reanimasiya; the patient moves to the neonatal unit, the handover follows
    her (X17) and is counted there, no longer in the old unit."""
    w, client, app = ward
    neo = w.units["neo"].id
    source = await signed(w, client)
    handover = await _handed(w, client, source)
    r = await client.post(f"/handovers/{handover}/sign-outgoing", json={"note": HANDOVER_NOTE},
                          headers=w.auth["nurse"])
    assert (r.status_code, r.json()["status"]) == (200, "OUTGOING_SIGNED")

    async def waiting() -> list:
        r = await client.get("/handovers/pending", headers=w.auth["admin"])
        assert r.status_code == 200, r.text
        return [(u["unit_name"], u["pending"]) for u in r.json()["units"]]

    assert await waiting() == [("Reanimasiya", 1)]
    answer = await moved(w, client, source, "N1", "admin")
    assert await waiting() == [("Neonatal", 1)]
    ((unit_id, named),) = await _fresh(db_session, select(Handover.unit_id, Handover.admission_ids)
                                       .where(Handover.id == uuid.UUID(handover)))
    assert (unit_id, list(named)) == (neo, [answer["id"]])


# ---------------------------------------------------------------- the kabul form sent again (final review I-1)
async def test_the_kabul_form_sent_again_after_a_move_answers_where_she_lies_now(ward):
    """Final review I-1 (A-19, A-21): the nurse's kabul answer was lost, a physician signed and the
    patient was moved before the nurse sent the same form again. The resend is answered with the
    stay where it is now — the arriving row, its bed, the protocol the move carried (O8) — never
    with the source the move closed, whose key is the H-number: a number entered on the device
    under it would go to a card nobody shows."""
    w, client, _ = ward
    two = str(w.beds["2"].id)
    body = form(w, "1", request_id=uuid.uuid4())
    first = await client.post("/admissions", json=body, headers=w.auth["nurse"])
    assert first.status_code == 201, first.text
    source = first.json()
    r = await client.post(f"/admissions/{source['id']}/sign-off", headers=w.auth["doctor"])
    assert r.status_code == 200, r.text
    arriving = await moved(w, client, source)
    again = await client.post("/admissions", json=body, headers=w.auth["nurse"])
    assert again.status_code == 200, again.text
    answer = again.json()
    assert (answer["id"], answer["bed_id"], answer["state"]) == (arriving["id"], two, "ACTIVE")
    assert (answer["protocol_no"], answer["board_key"]) == (FIRST_PROTOCOL, FIRST_PROTOCOL)
    assert answer["patient_number"] == source["patient_number"] != answer["board_key"]
    assert answer["engine"] == source["engine"]             # the first send's report, as recorded
    # Another form under the same id: the conflict names the number the card stands under now.
    r = await client.post("/admissions", json=form(w, "3", request_id=uuid.UUID(body["request_id"])),
                          headers=w.auth["nurse"])
    detail = r.json()["detail"]
    assert (r.status_code, detail["code"], detail["board_key"]) == (409, "request_conflict",
                                                                    FIRST_PROTOCOL)


# ---------------------------------------------------------------- the discharge time after a move (final review M-1)
async def test_a_discharge_after_moves_may_be_timed_back_to_the_stays_first_kabul_never_before(
        ward, db_session):
    """Final review M-1 (D1: the ward moves the patient, then records it). The arriving row's
    `admission_datetime` is the move's record time (T6), so a patient who died on her new bed
    before the move was recorded could not be given her exitus time. The discharge time's lower
    bound is the stay's first kabul, reached back along `source_admission_id` (X18's walk), over
    two moves here: a time between the first kabul and the moves' record is taken, one before the
    first kabul is still refused. The arriving row's own time stays the move's."""
    w, client, _ = ward
    source = await signed(w, client)
    now = datetime.now(timezone.utc)
    first_kabul, died = now - timedelta(hours=3), now - timedelta(hours=1)
    await _set(db_session, Admission, uuid.UUID(source["id"]), admission_datetime=first_kabul)
    second = await moved(w, client, source)
    arriving = await moved(w, client, second, "10")
    assert datetime.fromisoformat(arriving["admission_datetime"]) > now - timedelta(minutes=1)
    url = f"/admissions/{arriving['id']}/discharge/initiate"
    r = await client.post(url, json={"disposition": "EXITUS",
                                     "discharge_at": (first_kabul - timedelta(minutes=5)).isoformat()},
                          headers=w.auth["doctor"])
    assert (r.status_code, r.json()["detail"]["code"]) == (422, "field_invalid:discharge_at")
    r = await client.post(url, json={"disposition": "EXITUS", "discharge_at": died.isoformat()},
                          headers=w.auth["doctor"])
    assert r.status_code == 200, r.text
    assert datetime.fromisoformat(r.json()["discharge_at"]) == died
    assert r.json()["admission_datetime"] == arriving["admission_datetime"]

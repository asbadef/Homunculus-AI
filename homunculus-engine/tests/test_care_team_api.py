# homunculus-engine/tests/test_care_team_api.py
"""The care team's writes (G2-B1c, spec §5.2, §5.5, §5.6; D2, D4, D5, T1–T5, T7, T8; X4, X5, X9):
- claim: a physician of the unit becomes the attending, and the previous one steps down;
- add: a physician of the tenant, as associate, on-call (a window of at most 48 hours, ending in
  the future) or attending; an expired on-call row is renewed, never refused;
- end: an assigner ends a row in her units, a member ends her own from anywhere, and the
  attending's row never ends alone;
- each write checks reach, takes the locks, needs an ACTIVE or PENDING_DISCHARGE admission, and is
  audited after its commit: staff by user name, the patient never by name;
- a duplicate, or a writer that meets an index, is a coded 409, never a 500.
Postgres. Synthetic ward: tests/kabul_world.py, with physicians added (`add_physician`)."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from homunculus.admission import service
from homunculus.admission.models import Admission, AdmissionState, CareTeamMember, CareTeamRole
from tests.conftest import requires_db
from tests.kabul_world import SLUG, build_ward, ward_client
from tests.test_care_team_service import add_physician, team_of
from tests.test_discharge_api import at_once, audited, signed

pytestmark = [requires_db]
HOUR = timedelta(hours=1)
ATT, ASSOC, ONCALL = (CareTeamRole.ATTENDING, CareTeamRole.ASSOCIATE_PHYSICIAN,
                      CareTeamRole.ONCALL_PHYSICIAN)


@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    built = await build_ward(db_session)
    async with ward_client(db_session) as (client, app):
        yield built, client, app


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def _window(start: datetime, hours: float) -> dict:
    return {"window_start": start.isoformat(),
            "window_end": (start + timedelta(hours=hours)).isoformat()}


async def _row_of(db, admission_id: uuid.UUID, user_id: uuid.UUID) -> uuid.UUID:
    """The id of `user_id`'s ACTIVE row on the admission."""
    return (await db.execute(select(CareTeamMember.id).where(
        CareTeamMember.admission_id == admission_id, CareTeamMember.user_id == user_id,
        CareTeamMember.is_active.is_(True)))).scalar_one()


async def _attending(db, admission_id: uuid.UUID):
    return (await db.execute(select(Admission.attending_physician_id)
                             .where(Admission.id == admission_id))).scalar_one()


async def _expired_on_call(db, admission_id: uuid.UUID, user_id: uuid.UUID,
                           by: uuid.UUID) -> uuid.UUID:
    """An on-call row whose window passed two hours ago."""
    admission = await db.get(Admission, admission_id)
    now = _now()
    row = await service.add_care_team_member(db, admission, user_id=user_id, role=ONCALL,
                                             granted_by_id=by, window_start=now - 10 * HOUR,
                                             window_end=now - 2 * HOUR)
    row_id = row.id
    await db.commit()
    return row_id


def _care_team_audit(app) -> list:
    """Every `care_team.*` audit row so far (the sign-off's own `care_team.attending` among them)."""
    return [r for r in app.state.audit.records(tenant=SLUG, limit=200)
            if r.event_type.startswith("care_team.")]


async def _add(client, w, aid, user_id, role="ASSOCIATE_PHYSICIAN", who="doctor", **window):
    return await client.post(f"/admissions/{aid}/care-team",
                             json={"user_id": str(user_id), "role": role, **window},
                             headers=w.auth[who])


# ---------------------------------------------------------------- claim
async def test_a_physician_claims_and_the_previous_attending_steps_down(ward, db_session):
    """D4, T4: the claim ends the previous attending's row, names the claimer on the admission and
    writes her row; `care_team.attending` says so by user name (§5.5)."""
    w, client, app = ward
    doctor = w.users["doctor"].id
    second = await add_physician(db_session, w, "doctor2", group="attending")
    admission = await signed(w, client)
    aid = uuid.UUID(admission["id"])
    previous = await _row_of(db_session, aid, doctor)
    r = await client.post(f"/admissions/{aid}/care-team/claim", headers=w.auth["doctor2"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["user_id"], body["full_name"], body["role"], body["granted_by_name"],
            body["is_active"], body["in_force"], body["closed_at"]) == (
        str(second), "doctor2", "ATTENDING", "doctor2", True, True, None)
    assert await team_of(db_session, aid) == [(doctor, ATT, False, True), (second, ATT, True, False)]
    assert await _attending(db_session, aid) == second
    (row,) = [r for r in audited(app, "care_team.attending") if r.payload["via"] == "claim"]
    assert (row.patient_id, row.payload) == (admission["board_key"], {
        "admission_id": str(aid), "member_id": body["id"], "member": "doctor2@kabul.example.com",
        "via": "claim", "ended": [str(previous)], "actor": "doctor2@kabul.example.com"})


async def test_only_a_physician_of_the_unit_who_is_not_the_attending_claims(ward, db_session):
    """T1, T2, D7: an administrator holds the key and is no physician (409); a physician of
    another unit is out of scope (403); the attending herself is the attending already (409);
    the charge nurse no longer holds the key (403). None of them writes anything."""
    w, client, _ = ward
    await add_physician(db_session, w, "uzak", group="attending", unit="neo")
    admission = await signed(w, client)
    aid = uuid.UUID(admission["id"])
    url = f"/admissions/{aid}/care-team/claim"
    before = await team_of(db_session, aid)
    for who, status, code in (("admin", 409, "care_team_not_physician"),
                              ("uzak", 403, "out_of_scope"),
                              ("doctor", 409, "care_team_conflict")):
        r = await client.post(url, headers=w.auth[who])
        assert (r.status_code, r.json()["detail"]["code"]) == (status, code), (who, r.text)
    r = await client.post(url, headers=w.auth["charge"])
    assert (r.status_code, r.json()["detail"]) == (403, "permission required: care_team.claim")
    assert await team_of(db_session, aid) == before


async def test_one_physician_claiming_twice_at_once_claims_once(ward, db_session, monkeypatch):
    """T7, X5: the second claim waits for the first's locks, reads her as the attending and is
    refused `care_team_conflict`. One active ATTENDING row."""
    w, client, _ = ward
    second = await add_physician(db_session, w, "doctor2", group="attending")
    admission = await signed(w, client)
    aid = uuid.UUID(admission["id"])
    url = f"/admissions/{aid}/care-team/claim"
    one, two = await at_once(db_session, monkeypatch, "set_attending",
                             lambda: client.post(url, headers=w.auth["doctor2"]),
                             lambda: client.post(url, headers=w.auth["doctor2"]))
    assert (one.status_code, two.status_code) == (200, 409), (one.text, two.text)
    assert two.json()["detail"]["code"] == "care_team_conflict"
    assert [(u, role) for u, role, active, _ in await team_of(db_session, aid) if active] == [
        (second, ATT)]


async def test_two_physicians_claiming_at_once_take_it_in_turn(ward, db_session, monkeypatch):
    """X5, D4: the locks order the two claims, and the second ends the first's row. Both answers
    are 200; exactly one active ATTENDING stays, the later claimer's."""
    w, client, _ = ward
    second = await add_physician(db_session, w, "doctor2", group="attending")
    third = await add_physician(db_session, w, "doctor3", group="attending")
    admission = await signed(w, client)
    aid = uuid.UUID(admission["id"])
    url = f"/admissions/{aid}/care-team/claim"
    one, two = await at_once(db_session, monkeypatch, "set_attending",
                             lambda: client.post(url, headers=w.auth["doctor2"]),
                             lambda: client.post(url, headers=w.auth["doctor3"]))
    assert (one.status_code, two.status_code) == (200, 200), (one.text, two.text)
    team = await team_of(db_session, aid)
    assert [(u, role) for u, role, active, _ in team if active] == [(third, ATT)]
    assert (second, ATT, False, True) in team
    assert await _attending(db_session, aid) == third


# ---------------------------------------------------------------- add
async def test_an_assigner_adds_an_associate_by_name(ward, db_session):
    """§5.2, §5.5: 201 with the member named; `care_team.add` carries the role, no window and
    nothing renewed."""
    w, client, app = ward
    helper = await add_physician(db_session, w, "yardimci")
    admission = await signed(w, client)
    aid = uuid.UUID(admission["id"])
    r = await _add(client, w, aid, helper)
    assert r.status_code == 201, r.text
    body = r.json()
    assert (body["full_name"], body["role"], body["granted_by_name"], body["in_force"]) == (
        "yardimci", "ASSOCIATE_PHYSICIAN", "doctor", True)
    (row,) = audited(app, "care_team.add")
    assert (row.patient_id, row.payload) == (admission["board_key"], {
        "admission_id": str(aid), "member_id": body["id"], "member": "yardimci@kabul.example.com",
        "role": "ASSOCIATE_PHYSICIAN", "window_start": None, "window_end": None, "renewed": None,
        "actor": "doctor@kabul.example.com"})


async def test_an_on_call_physician_of_another_unit_is_added_for_her_window(ward, db_session):
    """D8, §5.2: any physician of the tenant; her window is kept as it was sent."""
    w, client, app = ward
    oncall = await add_physician(db_session, w, "nobetci", unit="neo")
    admission = await signed(w, client)
    start = _now()
    r = await _add(client, w, admission["id"], oncall, "ONCALL_PHYSICIAN", **_window(start, 12))
    assert r.status_code == 201, r.text
    assert r.json()["in_force"] is True
    (row,) = audited(app, "care_team.add")
    assert (row.payload["window_start"], row.payload["window_end"]) == (
        start.isoformat(), (start + 12 * HOUR).isoformat())


async def test_only_a_physician_is_added_and_a_duplicate_is_a_409_never_a_500(ward, db_session):
    """T1, T7: a nurse is a member of the tenant and no physician; a physician already on the
    team is refused by code, whatever role she is added with again."""
    w, client, app = ward
    nurse = w.users["nurse"].id
    helper = await add_physician(db_session, w, "yardimci")
    admission = await signed(w, client)
    aid = admission["id"]
    r = await _add(client, w, aid, nurse)
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "care_team_not_physician")
    assert (await _add(client, w, aid, helper)).status_code == 201
    r = await _add(client, w, aid, helper)
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "care_team_conflict")
    r = await _add(client, w, aid, helper, "ONCALL_PHYSICIAN", **_window(_now(), 8))
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "care_team_conflict")
    assert len(audited(app, "care_team.add")) == 1


@pytest.mark.parametrize("role", ["ASSOCIATE_PHYSICIAN", "ATTENDING"])
async def test_an_assigner_outside_the_beds_unit_adds_nobody(ward, db_session, role):
    """T2: the add checks reach as the claim and the end do. A physician of another unit holds
    `care_team.assign` and is out of scope (403 `out_of_scope`); nothing is written, nothing audited."""
    w, client, app = ward
    helper = await add_physician(db_session, w, "yardimci")
    await add_physician(db_session, w, "uzak", group="attending", unit="neo")
    admission = await signed(w, client)
    aid = uuid.UUID(admission["id"])
    before, trail = await team_of(db_session, aid), _care_team_audit(app)
    r = await _add(client, w, aid, helper, role, who="uzak")
    assert r.status_code == 403, r.text
    assert r.json()["detail"]["code"] == "out_of_scope", r.text
    assert await team_of(db_session, aid) == before
    assert audited(app, "care_team.add") == [] and _care_team_audit(app) == trail


async def test_adding_an_attending_promotes_her_into_one_row(ward, db_session):
    """T4: an add with role ATTENDING is `set_attending`, audited `care_team.attending` via
    `add`. Adding the attending as attending again is a conflict."""
    w, client, app = ward
    doctor = w.users["doctor"].id
    helper = await add_physician(db_session, w, "yardimci")
    admission = await signed(w, client)
    aid = uuid.UUID(admission["id"])
    assert (await _add(client, w, aid, helper)).status_code == 201
    ended = {str(await _row_of(db_session, aid, doctor)), str(await _row_of(db_session, aid, helper))}
    r = await _add(client, w, aid, helper, "ATTENDING")
    assert r.status_code == 201, r.text
    assert [(u, role) for u, role, active, _ in await team_of(db_session, aid) if active] == [
        (helper, ATT)]
    assert await _attending(db_session, aid) == helper
    (row,) = [r for r in audited(app, "care_team.attending") if r.payload["via"] == "add"]
    assert set(row.payload["ended"]) == ended
    r = await _add(client, w, aid, helper, "ATTENDING")
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "care_team_conflict")


@pytest.mark.parametrize(("role", "window", "field"), [
    ("ONCALL_PHYSICIAN", {}, "window_start"),
    ("ONCALL_PHYSICIAN", {"window_start": "S"}, "window_end"),
    ("ONCALL_PHYSICIAN", {"window_start": "S", "window_end": "S"}, "window_end"),
    ("ONCALL_PHYSICIAN", {"window_start": "S-10", "window_end": "S-2"}, "window_end"),
    ("ONCALL_PHYSICIAN", {"window_start": "S", "window_end": "S+49"}, "window_end"),
    ("ASSOCIATE_PHYSICIAN", {"window_start": "S", "window_end": "S+8"}, "window_start"),
    ("ATTENDING", {"window_end": "S+8"}, "window_end"),
], ids=["no-start", "no-end", "end-at-start", "in-the-past", "49-hours", "associate", "attending"])
async def test_the_window_rules_are_field_refusals(ward, db_session, role, window, field):
    """§5.2, X9: a window is the on-call row's alone; its end comes after its start, in the
    future, at most 48 hours later. Refused before anything is locked or written."""
    w, client, app = ward
    helper = await add_physician(db_session, w, "yardimci")
    admission = await signed(w, client)
    start = _now()
    at = {"S": start, "S-10": start - 10 * HOUR, "S-2": start - 2 * HOUR,
          "S+8": start + 8 * HOUR, "S+49": start + 49 * HOUR}
    r = await _add(client, w, admission["id"], helper, role,
                   **{key: at[value].isoformat() for key, value in window.items()})
    assert (r.status_code, r.json()["detail"]["code"]) == (422, f"field_invalid:{field}"), r.text
    assert audited(app, "care_team.add") == []


async def test_a_window_of_exactly_48_hours_is_allowed(ward, db_session):
    """§3.3, X9: "at most 48 hours". 49 hours is refused (above); 48 exactly is not, which pins
    the comparison as `>` and not `>=`."""
    w, client, app = ward
    oncall = await add_physician(db_session, w, "nobetci")
    admission = await signed(w, client)
    start = _now()
    r = await _add(client, w, admission["id"], oncall, "ONCALL_PHYSICIAN", **_window(start, 48))
    assert r.status_code == 201, r.text
    assert r.json()["in_force"] is True
    (row,) = audited(app, "care_team.add")
    assert (row.payload["window_start"], row.payload["window_end"]) == (
        start.isoformat(), (start + 48 * HOUR).isoformat())


async def test_a_window_without_an_offset_is_refused(ward, db_session):
    """X9: a naive time is never compared with the server's clock."""
    w, client, _ = ward
    oncall = await add_physician(db_session, w, "nobetci")
    admission = await signed(w, client)
    r = await _add(client, w, admission["id"], oncall, "ONCALL_PHYSICIAN",
                   window_start="2026-11-09T20:00:00", window_end="2026-11-10T08:00:00")
    assert r.status_code == 422, r.text


@pytest.mark.parametrize("role", ["ONCALL_PHYSICIAN", "ASSOCIATE_PHYSICIAN"])
async def test_an_expired_on_call_row_is_renewed_never_refused(ward, db_session, role):
    """T8, X4: the expired row ends and the new one is written in one transaction, whatever the
    new role; `renewed` names the old row."""
    w, client, app = ward
    doctor = w.users["doctor"].id
    oncall = await add_physician(db_session, w, "nobetci")
    admission = await signed(w, client)
    aid = uuid.UUID(admission["id"])
    old = await _expired_on_call(db_session, aid, oncall, doctor)
    window = _window(_now(), 12) if role == "ONCALL_PHYSICIAN" else {}
    r = await _add(client, w, aid, oncall, role, **window)
    assert r.status_code == 201, r.text
    mine = [(r_, active) for u, r_, active, _ in await team_of(db_session, aid) if u == oncall]
    assert mine == [(ONCALL, False), (CareTeamRole(role), True)]
    (row,) = audited(app, "care_team.add")
    assert row.payload["renewed"] == str(old)


async def test_a_write_that_meets_an_index_is_a_coded_409_never_a_500(ward, db_session, monkeypatch):
    """T7: a writer the look-up did not warn (here the look-up is made blind) meets a partial
    unique index, and the route names the conflict by the index. Nothing is written."""
    w, client, _ = ward
    doctor = w.users["doctor"].id
    await add_physician(db_session, w, "doctor2", group="attending")
    admission = await signed(w, client)
    aid = uuid.UUID(admission["id"])
    before = await team_of(db_session, aid)

    async def blind(db, admission_id):
        return []

    monkeypatch.setattr(service, "active_rows", blind)
    r = await _add(client, w, aid, doctor)                     # uq_care_team_active_member
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "care_team_conflict")
    r = await client.post(f"/admissions/{aid}/care-team/claim", headers=w.auth["doctor2"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "care_team_conflict")
    assert await team_of(db_session, aid) == before          # uq_care_team_one_attending held


class _OtherConstraint(Exception):
    """What the driver's error carries when it is not one of the two care-team indexes."""
    constraint_name = "ck_care_team_members_something_else"


async def test_an_integrity_error_naming_another_constraint_is_no_care_team_conflict(
        ward, db_session, monkeypatch):
    """T7: only the two partial unique indexes are the coded 409. Any other IntegrityError is
    raised as it is (through the test client: the 500 a server error is), after the rollback, and
    nothing is written or audited."""
    w, client, app = ward
    helper = await add_physician(db_session, w, "yardimci")
    await add_physician(db_session, w, "doctor2", group="attending")
    admission = await signed(w, client)
    aid = uuid.UUID(admission["id"])
    before, trail = await team_of(db_session, aid), _care_team_audit(app)

    async def other_constraint(*args, **kwargs):
        raise IntegrityError("INSERT INTO care_team_members", {}, _OtherConstraint("check failed"))

    monkeypatch.setattr(service, "add_care_team_member", other_constraint)
    monkeypatch.setattr(service, "set_attending", other_constraint)
    for call in (lambda: _add(client, w, aid, helper),
                 lambda: _add(client, w, aid, helper, "ATTENDING"),
                 lambda: client.post(f"/admissions/{aid}/care-team/claim",
                                     headers=w.auth["doctor2"])):
        with pytest.raises(IntegrityError) as raised:
            await call()
        assert raised.value.orig.constraint_name == "ck_care_team_members_something_else"
    assert await team_of(db_session, aid) == before
    assert audited(app, "care_team.add") == [] and _care_team_audit(app) == trail


# ---------------------------------------------------------------- end
async def test_an_assigner_ends_a_members_row(ward, db_session):
    w, client, app = ward
    helper = await add_physician(db_session, w, "yardimci")
    admission = await signed(w, client)
    aid = uuid.UUID(admission["id"])
    member_id = (await _add(client, w, aid, helper)).json()["id"]
    r = await client.post(f"/admissions/{aid}/care-team/{member_id}/end", headers=w.auth["doctor"])
    assert r.status_code == 200, r.text
    assert (r.json()["is_active"], r.json()["in_force"], r.json()["closed_at"] is not None) == (
        False, False, True)
    (row,) = audited(app, "care_team.end")
    assert (row.patient_id, row.payload) == (admission["board_key"], {
        "admission_id": str(aid), "member_id": member_id, "member": "yardimci@kabul.example.com",
        "role": "ASSOCIATE_PHYSICIAN", "self": False, "actor": "doctor@kabul.example.com"})


async def test_a_member_ends_her_own_row_from_outside_her_units(ward, db_session):
    """§5.2: ending her own row only narrows what she sees, so it needs no reach and no
    `care_team.assign`."""
    w, client, app = ward
    oncall = await add_physician(db_session, w, "nobetci", unit="neo")
    admission = await signed(w, client)
    aid = admission["id"]
    member_id = (await _add(client, w, aid, oncall, "ONCALL_PHYSICIAN",
                            **_window(_now(), 12))).json()["id"]
    r = await client.post(f"/admissions/{aid}/care-team/{member_id}/end", headers=w.auth["nobetci"])
    assert r.status_code == 200, r.text
    (row,) = audited(app, "care_team.end")
    assert (row.payload["self"], row.payload["actor"]) == (True, "nobetci@kabul.example.com")


async def test_the_end_refuses_what_it_must(ward, db_session):
    """§5.2, T5: another's row without `care_team.assign` (403); an assigner outside the unit
    (403 `out_of_scope`); the attending's row (409 `care_team_attending_required`); a row of
    another admission (404); a row already ended (409 `invalid_transition`)."""
    w, client, app = ward
    doctor = w.users["doctor"].id
    helper = await add_physician(db_session, w, "yardimci")
    await add_physician(db_session, w, "komsu")                       # a physician: no assign
    await add_physician(db_session, w, "uzak", group="attending", unit="neo")
    admission = await signed(w, client)
    other = await signed(w, client, "2")
    aid = uuid.UUID(admission["id"])
    helper_row = (await _add(client, w, aid, helper)).json()["id"]
    attending_row = await _row_of(db_session, aid, doctor)
    other_row = await _row_of(db_session, uuid.UUID(other["id"]), doctor)

    def end(row):
        return f"/admissions/{aid}/care-team/{row}/end"

    r = await client.post(end(helper_row), headers=w.auth["komsu"])
    assert (r.status_code, r.json()["detail"]) == (403, "permission required: care_team.assign")
    r = await client.post(end(helper_row), headers=w.auth["uzak"])
    assert (r.status_code, r.json()["detail"]["code"]) == (403, "out_of_scope")
    r = await client.post(end(attending_row), headers=w.auth["doctor"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "care_team_attending_required")
    r = await client.post(end(other_row), headers=w.auth["doctor"])
    assert (r.status_code, r.json()["detail"]) == (404, "Care-team member not found.")
    assert (await client.post(end(helper_row), headers=w.auth["doctor"])).status_code == 200
    r = await client.post(end(helper_row), headers=w.auth["doctor"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "invalid_transition")
    assert len(audited(app, "care_team.end")) == 1


# ---------------------------------------------------------------- every write
@pytest.mark.parametrize("state", [AdmissionState.DRAFT, AdmissionState.DISCHARGED,
                                   AdmissionState.TRANSFERRED], ids=lambda s: s.value)
async def test_a_draft_or_a_closed_admission_takes_no_care_team_write(ward, db_session, state):
    """T3: the team lives from the sign-off to the end of the stay. Every write is refused
    `invalid_transition`, and nothing is written."""
    w, client, app = ward
    doctor = w.users["doctor"].id
    second = await add_physician(db_session, w, "doctor2", group="attending")
    admission = await signed(w, client)
    aid = uuid.UUID(admission["id"])
    attending_row = await _row_of(db_session, aid, doctor)
    await db_session.execute(update(Admission).where(Admission.id == aid).values(state=state))
    await db_session.commit()
    base = f"/admissions/{aid}/care-team"
    for url, body, who in ((f"{base}/claim", None, "doctor2"),
                           (base, {"user_id": str(second), "role": "ASSOCIATE_PHYSICIAN"}, "doctor"),
                           (f"{base}/{attending_row}/end", None, "doctor")):
        r = await client.post(url, json=body, headers=w.auth[who])
        assert (r.status_code, r.json()["detail"]["code"]) == (409, "invalid_transition"), (url, r.text)
    assert await team_of(db_session, aid) == [(doctor, ATT, True, False)]
    assert audited(app, "care_team.add") == audited(app, "care_team.end") == []


async def test_a_member_added_and_ended_twice_keeps_two_closed_rows(ward, db_session):
    """F2, spec §6 "the old fault": add, end, add again, end again — two closed rows, no error."""
    w, client, _ = ward
    helper = await add_physician(db_session, w, "yardimci")
    admission = await signed(w, client)
    aid = uuid.UUID(admission["id"])
    for _ in range(2):
        r = await _add(client, w, aid, helper)
        assert r.status_code == 201, r.text
        r = await client.post(f"/admissions/{aid}/care-team/{r.json()['id']}/end",
                              headers=w.auth["doctor"])
        assert r.status_code == 200, r.text
    assert [(role, active) for u, role, active, _ in await team_of(db_session, aid)
            if u == helper] == [(ASSOC, False), (ASSOC, False)]


async def test_the_care_teams_audit_rows_name_staff_and_never_the_patient(ward, db_session):
    """§5.5: ids and user names; `patient_id` is the card's key; no patient name anywhere."""
    w, client, app = ward
    helper = await add_physician(db_session, w, "yardimci")
    await add_physician(db_session, w, "doctor2", group="attending")
    admission = await signed(w, client)
    aid = admission["id"]
    member_id = (await _add(client, w, aid, helper)).json()["id"]
    assert (await client.post(f"/admissions/{aid}/care-team/{member_id}/end",
                              headers=w.auth["doctor"])).status_code == 200
    assert (await client.post(f"/admissions/{aid}/care-team/claim",
                              headers=w.auth["doctor2"])).status_code == 200
    rows = [r for r in app.state.audit.records(tenant=SLUG, limit=200)
            if r.event_type.startswith("care_team.")]
    assert {r.event_type for r in rows} == {"care_team.attending", "care_team.add", "care_team.end"}
    assert {r.patient_id for r in rows} == {admission["board_key"]}
    assert not any("Sentetik" in repr(r.payload) for r in rows)


async def test_an_audit_store_failing_after_the_commit_still_writes_and_logs_the_member(
        ward, db_session, monkeypatch, caplog):
    """X14 (controller), A-26: the three care-team writes have committed before their audit rows
    are written, so a failing store never turns one into a 500. Each failure is logged at ERROR
    with the event and the ids, `member_id` among them (`trail.LOGGED_KEYS`) — and never a name,
    never the store's own words."""
    w, client, app = ward
    helper = await add_physician(db_session, w, "yardimci")
    await add_physician(db_session, w, "doctor2", group="attending")
    admission = await signed(w, client)
    aid = admission["id"]

    def store_down(event):
        raise RuntimeError("audit store down while writing Sentetik Hasta")

    monkeypatch.setattr(app.state.audit, "append", store_down)
    caplog.set_level(logging.ERROR, logger="homunculus.admission.trail")
    claimed = await client.post(f"/admissions/{aid}/care-team/claim", headers=w.auth["doctor2"])
    added = await _add(client, w, aid, helper, who="doctor2")
    ended = await client.post(f"/admissions/{aid}/care-team/{added.json()['id']}/end",
                              headers=w.auth["doctor2"])
    assert (claimed.status_code, added.status_code, ended.status_code) == (200, 201, 200), (
        claimed.text, added.text, ended.text)
    logged = [rec.getMessage() for rec in caplog.records
              if rec.name == "homunculus.admission.trail" and rec.levelno == logging.ERROR]
    assert len(logged) == 3, logged
    for message, event, answer in zip(logged, ("care_team.attending", "care_team.add",
                                               "care_team.end"), (claimed, added, ended)):
        assert event in message, message
        assert f"member_id={answer.json()['id']}" in message, message
        assert f"admission_id={aid}" in message and "doctor2@kabul.example.com" in message, message
        assert "Sentetik" not in message and "audit store down" not in message, message


# ---------------------------------------------------------------- the discharge (F6, §5.4)
async def test_the_discharge_closes_the_whole_team_and_keeps_every_closed_row(ward, db_session):
    """F6, §5.4: the discharge confirmation closes every active row, the attending's included. A
    member ended twice before keeps both rows and loses a third (F2: the old constraint broke
    here)."""
    w, client, _ = ward
    doctor = w.users["doctor"].id
    helper = await add_physician(db_session, w, "yardimci")
    admission = await signed(w, client)
    aid = admission["id"]
    for _ in range(2):
        member_id = (await _add(client, w, aid, helper)).json()["id"]
        assert (await client.post(f"/admissions/{aid}/care-team/{member_id}/end",
                                  headers=w.auth["doctor"])).status_code == 200
    assert (await _add(client, w, aid, helper)).status_code == 201
    r = await client.post(f"/admissions/{aid}/discharge/initiate", json={"disposition": "HOME"},
                          headers=w.auth["doctor"])
    assert r.status_code == 200, r.text
    r = await client.post(f"/admissions/{aid}/discharge/confirm", headers=w.auth["charge"])
    assert r.status_code == 200, r.text
    assert [(u, active, closed) for u, _, active, closed in
            await team_of(db_session, uuid.UUID(aid))] == [
        (doctor, False, True), (helper, False, True), (helper, False, True), (helper, False, True)]

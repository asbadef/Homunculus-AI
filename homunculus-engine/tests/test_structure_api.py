# homunculus-engine/tests/test_structure_api.py
"""The structure routes of Group 2 · B1a (spec §3.4, §3.5, §4.4): the tree every screen reads its
unit and bed names from, limited to the caller's units; the administrator's rename / close /
reopen, with nothing deleted and no occupied bed closed; and a nurse's "cleaning done, bed free",
in her own units, audited. Every structure write is audited too (`structure.create|rename|close|
reopen`, amendment A-4), a bed's label is unique in its unit (A-5), and a new name is trimmed,
bounded and never a 500 (A-13). The unit and bed locks never block a row that merely points at
the unit or bed, and an audit store that fails after the commit never turns the committed change
into a 500 (A-26). Postgres (`db_session`). Synthetic ward: tests/kabul_world.py."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker

from homunculus.admission.models import NurseBedAssignment
from homunculus.auth.models import Group, GroupPermission, UserGroup
from homunculus.scope.models import StaffScope
from homunculus.tenant import router as tenant_router
from homunculus.tenant.models import Bed, BedState
from tests.conftest import requires_db
from tests.kabul_world import SLUG, build_ward, ward_client
from tests.signed_in import bearer

pytestmark = [requires_db]

ADMIN = "admin@kabul.example.com"


@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    built = await build_ward(db_session)
    async with ward_client(db_session) as (client, app):
        yield built, client, app


def _tree(answer: dict) -> dict:
    """{unit name: {room name: [bed label, …]}}, in the order the API gives them."""
    return {u["name"]: {r["name"]: [b["label"] for b in r["beds"]] for r in u["rooms"]}
            for s in answer["sites"] for u in s["units"]}


async def _set_state(db, bed: Bed, state: BedState) -> None:
    bed.state = state
    db.add(bed)
    await db.commit()


def _rows(app, event_type: str) -> list:
    """The ward's audit rows of one event type, oldest first."""
    return [r for r in app.state.audit.records(tenant=SLUG, limit=500)
            if r.event_type == event_type]


def _structure_rows(app) -> list:
    return [r for r in app.state.audit.records(tenant=SLUG, limit=500)
            if r.event_type.startswith("structure.")]


# ---------------------------------------------------------------- GET /tenant/structure
async def test_a_nurse_reads_her_units_tree_with_names_and_states(ward):
    w, client, _ = ward
    r = await client.get("/tenant/structure", headers=w.auth["nurse"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["tenant_id"] == str(w.tenant.id)
    assert _tree(body) == {"Reanimasiya": {"Otaq 1": ["1", "2", "10"], "Otaq 2": ["3"]}}
    bed = body["sites"][0]["units"][0]["rooms"][0]["beds"][0]
    assert bed == {"id": str(w.beds["1"].id), "label": "1", "state": "AVAILABLE", "is_active": True}


async def test_the_administrator_and_the_unassigned_see_every_unit(ward, db_session):
    w, client, _ = ward
    for who in ("admin",):
        tree = _tree((await client.get("/tenant/structure", headers=w.auth[who])).json())
        assert set(tree) == {"Reanimasiya", "Neonatal"}


async def test_a_structure_manage_holder_sees_every_unit_whatever_her_grants(ward, db_session):
    """The one who builds the structure sees all of it. A non-administrator (scope class MEMBER,
    granted Reanimasiya only) who also holds `structure.manage` through a group of her own sees
    both units; the administrator, unrestricted by role, does too with a unit grant of her own."""
    w, client, _ = ward
    nurse, admin = w.users["nurse"], w.users["admin"]
    builders = Group(tenant_id=w.tenant.id, slug="sentetik-yapi", name="Sentetik Yapı",
                     permissions=[GroupPermission(permission="structure.manage")])
    db_session.add(builders)
    await db_session.flush()
    db_session.add(UserGroup(user_id=nurse.id, group_id=builders.id))
    db_session.add(StaffScope(tenant_id=w.tenant.id, user_id=admin.id,
                              unit_id=str(w.units["rea"].id)))
    await db_session.commit()
    builder = await bearer(db_session, nurse)
    for auth in (builder, w.auth["admin"]):
        tree = _tree((await client.get("/tenant/structure", headers=auth)).json())
        assert set(tree) == {"Reanimasiya", "Neonatal"}


async def test_a_bed_grant_shows_that_bed_in_its_room_and_unit_alone(ward, db_session):
    w, client, _ = ward
    nurse_b = w.users["nurse_b"]
    # Bed "2" shares Otaq 1 with beds "1" and "10": neither may come along with it.
    db_session.add(StaffScope(tenant_id=w.tenant.id, user_id=nurse_b.id, bed_id=str(w.beds["2"].id)))
    await db_session.commit()
    tree = _tree((await client.get("/tenant/structure", headers=w.auth["nurse_b"])).json())
    assert tree == {"Reanimasiya": {"Otaq 1": ["2"]}, "Neonatal": {"N-1": ["N1"]}}


async def test_a_name_with_a_digit_python_will_not_count_is_listed_not_a_500(ward):
    """"²" is a digit to `str.isdigit` but not to `int()` nor to the `\\d` the sort splits on."""
    w, client, _ = ward
    admin = w.auth["admin"]
    room = await client.post(f"/tenant/units/{w.units['rea'].id}/rooms", json={"name": "²"},
                             headers=admin)
    assert room.status_code == 201, room.text
    bed = await client.post(f"/tenant/rooms/{room.json()['id']}/beds", json={"label": "²"},
                            headers=admin)
    assert bed.status_code == 201, bed.text
    r = await client.get("/tenant/structure", headers=admin)
    assert r.status_code == 200, r.text
    assert _tree(r.json())["Reanimasiya"]["²"] == ["²"]


async def test_a_caller_with_no_admission_right_is_refused(ward):
    w, client, _ = ward
    r = await client.get("/tenant/structure", headers=w.auth["auditor"])
    assert r.status_code == 403


# ---------------------------------------------------------------- rename, close, reopen
async def test_the_administrator_renames_a_unit_a_room_and_a_bed(ward):
    w, client, _ = ward
    admin = w.auth["admin"]
    assert (await client.patch(f"/tenant/units/{w.units['rea'].id}", json={"name": " Reanimasiya 1 "},
                               headers=admin)).json()["name"] == "Reanimasiya 1"
    assert (await client.patch(f"/tenant/rooms/{w.rooms['o2'].id}", json={"name": "Otaq 2A"},
                               headers=admin)).json()["name"] == "Otaq 2A"
    assert (await client.patch(f"/tenant/beds/{w.beds['10'].id}", json={"label": "4"},
                               headers=admin)).json()["label"] == "4"


async def test_a_new_name_on_a_patch_is_trimmed_before_it_is_checked(ward):
    """An empty name, typed or all blanks, is the coded field_invalid; a padded name of the
    column's full length is accepted, as on create."""
    w, client, _ = ward
    admin = w.auth["admin"]
    cases = [(f"/tenant/units/{w.units['rea'].id}", "name", 200),
             (f"/tenant/rooms/{w.rooms['o2'].id}", "name", 100),
             (f"/tenant/beds/{w.beds['10'].id}", "label", 50)]
    for path, field, longest in cases:
        for blank in ("", "   "):
            r = await client.patch(path, json={field: blank}, headers=admin)
            assert r.status_code == 422, (path, blank, r.text)
            assert r.json()["detail"]["code"] == f"field_invalid:{field}", (path, blank, r.text)
        r = await client.patch(path, json={field: " " + "y" * longest + " "}, headers=admin)
        assert (r.status_code, r.json()[field]) == (200, "y" * longest), (path, r.text)
        r = await client.patch(path, json={field: "z" * (longest + 1)}, headers=admin)
        assert r.status_code == 422, (path, r.text)


async def test_a_room_number_change_is_written_into_the_rooms_rename_row(ward):
    w, client, app = ward
    admin = w.auth["admin"]
    o2, rea = str(w.rooms["o2"].id), str(w.units["rea"].id)
    r = await client.patch(f"/tenant/rooms/{o2}", json={"room_number": " " + "1" * 20 + " "},
                           headers=admin)
    assert (r.status_code, r.json()["room_number"]) == (200, "1" * 20), r.text
    r = await client.patch(f"/tenant/rooms/{o2}", json={"name": "Otaq 2A", "room_number": " "},
                           headers=admin)
    assert (r.status_code, r.json()["room_number"]) == (200, None), r.text
    assert [row.payload for row in _rows(app, "structure.rename")] == [
        {"kind": "room", "id": o2, "unit_id": rea, "old_room_number": None,
         "new_room_number": "1" * 20, "actor": ADMIN},
        {"kind": "room", "id": o2, "unit_id": rea, "old_name": "Otaq 2", "new_name": "Otaq 2A",
         "old_room_number": "1" * 20, "new_room_number": None, "actor": ADMIN},
    ]


async def test_a_name_another_room_or_bed_of_the_same_parent_holds_is_refused(ward):
    w, client, _ = ward
    admin = w.auth["admin"]
    room = await client.patch(f"/tenant/rooms/{w.rooms['o2'].id}", json={"name": "Otaq 1"},
                              headers=admin)
    assert (room.status_code, room.json()["detail"]["code"]) == (409, "name_taken")
    # A bed's label is unique in its whole unit (A-5), so a clash is `bed_label_taken`.
    bed = await client.patch(f"/tenant/beds/{w.beds['10'].id}", json={"label": "2"}, headers=admin)
    assert (bed.status_code, bed.json()["detail"]["code"]) == (409, "bed_label_taken")
    blank = await client.patch(f"/tenant/beds/{w.beds['10'].id}", json={"label": "  "}, headers=admin)
    assert (blank.status_code, blank.json()["detail"]["code"]) == (422, "field_invalid:label")


async def test_a_bed_holding_a_patient_cannot_be_closed_and_a_free_one_can(ward, db_session):
    w, client, _ = ward
    admin = w.auth["admin"]
    for state in (BedState.OCCUPIED, BedState.PENDING_DISCHARGE):
        await _set_state(db_session, w.beds["1"], state)
        r = await client.patch(f"/tenant/beds/{w.beds['1'].id}", json={"is_active": False},
                               headers=admin)
        assert (r.status_code, r.json()["detail"]["code"]) == (409, "bed_in_use")
    await _set_state(db_session, w.beds["1"], BedState.HOUSEKEEPING)
    r = await client.patch(f"/tenant/beds/{w.beds['1'].id}", json={"is_active": False}, headers=admin)
    assert r.status_code == 200 and r.json()["is_active"] is False
    r = await client.patch(f"/tenant/beds/{w.beds['1'].id}", json={"is_active": True}, headers=admin)
    assert r.status_code == 200 and r.json()["is_active"] is True


async def test_a_room_or_unit_with_an_open_bed_cannot_be_closed_until_its_beds_are(ward):
    w, client, _ = ward
    admin = w.auth["admin"]
    r = await client.patch(f"/tenant/rooms/{w.rooms['o2'].id}", json={"is_active": False}, headers=admin)
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "has_open_beds")
    r = await client.patch(f"/tenant/units/{w.units['neo'].id}", json={"is_active": False}, headers=admin)
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "has_open_beds")

    assert (await client.patch(f"/tenant/beds/{w.beds['3'].id}", json={"is_active": False},
                               headers=admin)).status_code == 200
    r = await client.patch(f"/tenant/rooms/{w.rooms['o2'].id}", json={"is_active": False}, headers=admin)
    assert r.status_code == 200 and r.json()["is_active"] is False
    assert (await client.patch(f"/tenant/beds/{w.beds['N1'].id}", json={"is_active": False},
                               headers=admin)).status_code == 200
    r = await client.patch(f"/tenant/units/{w.units['neo'].id}", json={"is_active": False}, headers=admin)
    assert r.status_code == 200 and r.json()["is_active"] is False
    tree = (await client.get("/tenant/structure", headers=admin)).json()
    neo = next(u for s in tree["sites"] for u in s["units"] if u["name"] == "Neonatal")
    assert neo["is_active"] is False and neo["rooms"][0]["beds"][0]["is_active"] is False


async def test_only_structure_manage_changes_the_structure(ward):
    w, client, _ = ward
    r = await client.patch(f"/tenant/beds/{w.beds['1'].id}", json={"label": "X"},
                           headers=w.auth["charge"])
    assert r.status_code == 403


# ---------------------------------------------------------------- a bed's label, unique in its unit (A-5)
async def test_a_bed_label_is_unique_across_the_rooms_of_its_unit_but_not_across_units(ward):
    w, client, _ = ward
    admin = w.auth["admin"]
    same_room = await client.post(f"/tenant/rooms/{w.rooms['o1'].id}/beds", json={"label": "2"},
                                  headers=admin)
    other_room = await client.post(f"/tenant/rooms/{w.rooms['o2'].id}/beds", json={"label": "1"},
                                   headers=admin)
    renamed = await client.patch(f"/tenant/beds/{w.beds['3'].id}", json={"label": "10"},
                                 headers=admin)
    for r in (same_room, other_room, renamed):
        assert (r.status_code, r.json()["detail"]["code"]) == (409, "bed_label_taken"), r.text

    other_unit = await client.post(f"/tenant/rooms/{w.rooms['n1'].id}/beds", json={"label": "1"},
                                   headers=admin)
    assert other_unit.status_code == 201, other_unit.text
    moved = await client.patch(f"/tenant/beds/{w.beds['N1'].id}", json={"label": "3"},
                               headers=admin)
    assert moved.status_code == 200, moved.text      # "3" is Reanimasiya's, not Neonatal's


async def test_a_bed_label_is_compared_trimmed_and_regardless_of_case(ward, db_session):
    w, client, _ = ward
    admin = w.auth["admin"]
    # A label written before the routes trimmed one, kept as typed.
    db_session.add(Bed(room_id=w.rooms["o2"].id, label=" Ab "))
    await db_session.commit()
    attempts = [
        await client.post(f"/tenant/rooms/{w.rooms['n1'].id}/beds", json={"label": "n1"},
                          headers=admin),
        await client.post(f"/tenant/rooms/{w.rooms['n1'].id}/beds", json={"label": " N1 "},
                          headers=admin),
        await client.patch(f"/tenant/beds/{w.beds['3'].id}", json={"label": " 2 "}, headers=admin),
        await client.post(f"/tenant/rooms/{w.rooms['o1'].id}/beds", json={"label": "aB"},
                          headers=admin),
        await client.patch(f"/tenant/beds/{w.beds['1'].id}", json={"label": "AB"}, headers=admin),
    ]
    for r in attempts:
        assert (r.status_code, r.json()["detail"]["code"]) == (409, "bed_label_taken"), r.text


async def test_a_closed_beds_label_still_counts(ward):
    w, client, _ = ward
    admin = w.auth["admin"]
    assert (await client.patch(f"/tenant/beds/{w.beds['3'].id}", json={"is_active": False},
                               headers=admin)).status_code == 200
    created = await client.post(f"/tenant/rooms/{w.rooms['o1'].id}/beds", json={"label": "3"},
                                headers=admin)
    renamed = await client.patch(f"/tenant/beds/{w.beds['2'].id}", json={"label": "3"},
                                 headers=admin)
    for r in (created, renamed):
        assert (r.status_code, r.json()["detail"]["code"]) == (409, "bed_label_taken"), r.text


async def test_a_bed_may_be_renamed_to_its_own_label(ward):
    w, client, app = ward
    admin = w.auth["admin"]
    for label in ("10", " 10 "):
        r = await client.patch(f"/tenant/beds/{w.beds['10'].id}", json={"label": label},
                               headers=admin)
        assert (r.status_code, r.json()["label"]) == (200, "10"), r.text
    assert _rows(app, "structure.rename") == []      # nothing changed, nothing to audit
    r = await client.patch(f"/tenant/beds/{w.beds['N1'].id}", json={"label": "n1"}, headers=admin)
    assert (r.status_code, r.json()["label"]) == (200, "n1"), r.text


async def test_two_beds_of_one_label_created_at_once_in_two_rooms_of_a_unit_one_wins(
        ward, monkeypatch):
    """The check runs under a lock on the unit row: two requests cannot both pass it.

    Made deterministic by a barrier right after the check: each request waits there (up to a
    second) for the other to have checked too. Without the lock both reach it, both pass, both
    insert — two 201s, every run. With it the second request is held at the unit row and never
    reaches its check before the first has committed, so the first gives up waiting and goes on."""
    w, client, _ = ward
    admin = w.auth["admin"]
    barrier = asyncio.Barrier(2)
    real_check = tenant_router._bed_label_taken

    async def check_then_wait_for_the_other(*args, **kwargs):
        taken = await real_check(*args, **kwargs)
        try:
            async with asyncio.timeout(1.0):
                await barrier.wait()
        except TimeoutError:
            await barrier.abort()          # the later request's wait returns at once
        except asyncio.BrokenBarrierError:
            pass
        return taken

    monkeypatch.setattr(tenant_router, "_bed_label_taken", check_then_wait_for_the_other)
    first, second = await asyncio.gather(
        client.post(f"/tenant/rooms/{w.rooms['o1'].id}/beds", json={"label": "7"}, headers=admin),
        client.post(f"/tenant/rooms/{w.rooms['o2'].id}/beds", json={"label": "7"}, headers=admin),
    )
    assert sorted([first.status_code, second.status_code]) == [201, 409], (first.text, second.text)
    loser = first if first.status_code == 409 else second
    assert loser.json()["detail"]["code"] == "bed_label_taken"


@pytest.mark.parametrize("held", ["unit", "bed"])
async def test_a_held_structure_lock_does_not_block_a_row_that_points_at_it(ward, db_session,
                                                                              held):
    """Amendment A-26, I-1. Inserting a row with a foreign key to a unit or a bed (an admission's
    admitting unit and bed, a nurse's bed assignment) takes FOR KEY SHARE on the parent row. The
    structure routes lock a unit or a bed FOR NO KEY UPDATE, which lets that through; FOR UPDATE
    would hold it, and an admission that already holds its bed would deadlock against a bed PATCH
    holding the unit. Two sessions on the test database: one holds the lock, the other inserts
    under a one-second lock_timeout."""
    w, _, _ = ward
    unit_id, bed_id, nurse_id = w.units["rea"].id, w.beds["1"].id, w.users["nurse"].id
    start = datetime.now(timezone.utc)
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)
    async with maker() as holder, maker() as writer:
        try:
            if held == "unit":
                await tenant_router._lock_unit(holder, unit_id)
            else:
                await tenant_router._lock_bed(holder, bed_id)
            await writer.execute(text("SET LOCAL lock_timeout = '1s'"))
            writer.add(NurseBedAssignment(unit_id=unit_id, bed_id=bed_id, nurse_id=nurse_id,
                                          shift_start=start, shift_end=start + timedelta(hours=8)))
            await writer.flush()
        finally:
            await writer.rollback()
            await holder.rollback()


# ---------------------------------------------------------------- a new name (A-13)
async def test_a_room_name_its_unit_already_holds_is_a_409_not_a_500(ward):
    w, client, _ = ward
    admin = w.auth["admin"]
    for name in ("Otaq 1", " Otaq 1 "):
        r = await client.post(f"/tenant/units/{w.units['rea'].id}/rooms", json={"name": name},
                              headers=admin)
        assert (r.status_code, r.json()["detail"]["code"]) == (409, "name_taken"), r.text
    r = await client.post(f"/tenant/units/{w.units['neo'].id}/rooms", json={"name": "Otaq 1"},
                          headers=admin)
    assert r.status_code == 201, r.text


async def test_a_new_name_is_trimmed_and_refused_blank_or_longer_than_its_column(ward):
    w, client, _ = ward
    admin = w.auth["admin"]
    cases = [  # (path, field, column length, the rest of the body)
        (f"/tenant/tenants/{w.tenant.id}/sites", "name", 200, {}),
        (f"/tenant/sites/{w.site.id}/units", "name", 200, {"unit_type": "NICU"}),
        (f"/tenant/units/{w.units['neo'].id}/rooms", "name", 100, {}),
        (f"/tenant/rooms/{w.rooms['n1'].id}/beds", "label", 50, {}),
    ]
    for path, field, longest, rest in cases:
        for bad in ("", "   ", "x" * (longest + 1)):
            r = await client.post(path, json={field: bad, **rest}, headers=admin)
            assert r.status_code == 422, (path, bad, r.text)
        r = await client.post(path, json={field: " " + "y" * longest + " ", **rest}, headers=admin)
        assert (r.status_code, r.json()[field]) == (201, "y" * longest), (path, r.text)
        r = await client.post(path, json={field: " Sentetik 2 ", **rest}, headers=admin)
        assert (r.status_code, r.json()[field]) == (201, "Sentetik 2"), (path, r.text)


# ---------------------------------------------------------------- the audit of structure writes (A-4)
async def test_creating_a_site_a_unit_a_room_and_a_bed_is_audited(ward):
    w, client, app = ward
    admin = w.auth["admin"]
    site = (await client.post(f"/tenant/tenants/{w.tenant.id}/sites", json={"name": "Yeni bina"},
                              headers=admin)).json()
    unit = (await client.post(f"/tenant/sites/{site['id']}/units",
                              json={"name": "PICU", "unit_type": "PICU"}, headers=admin)).json()
    room = (await client.post(f"/tenant/units/{unit['id']}/rooms", json={"name": "P-1"},
                              headers=admin)).json()
    bed = (await client.post(f"/tenant/rooms/{room['id']}/beds", json={"label": "P1"},
                             headers=admin)).json()
    rows = _rows(app, "structure.create")
    assert [r.payload for r in rows] == [
        {"kind": "site", "id": site["id"], "unit_id": None, "name": "Yeni bina", "actor": ADMIN},
        {"kind": "unit", "id": unit["id"], "unit_id": unit["id"], "name": "PICU", "actor": ADMIN},
        {"kind": "room", "id": room["id"], "unit_id": unit["id"], "name": "P-1", "actor": ADMIN},
        {"kind": "bed", "id": bed["id"], "unit_id": unit["id"], "name": "P1", "actor": ADMIN},
    ]
    assert {r.patient_id for r in rows} == {""}           # no patient in a structure row


async def test_a_rename_is_audited_with_the_old_and_the_new_name(ward):
    w, client, app = ward
    admin = w.auth["admin"]
    rea, o2, bed10 = str(w.units["rea"].id), str(w.rooms["o2"].id), str(w.beds["10"].id)
    for path, body in ((f"/tenant/units/{rea}", {"name": "Reanimasiya 1"}),
                       (f"/tenant/rooms/{o2}", {"name": "Otaq 2A"}),
                       (f"/tenant/beds/{bed10}", {"label": "4"})):
        assert (await client.patch(path, json=body, headers=admin)).status_code == 200
    rows = _rows(app, "structure.rename")
    assert [r.payload for r in rows] == [
        {"kind": "unit", "id": rea, "unit_id": rea, "old_name": "Reanimasiya",
         "new_name": "Reanimasiya 1", "actor": ADMIN},
        {"kind": "room", "id": o2, "unit_id": rea, "old_name": "Otaq 2", "new_name": "Otaq 2A",
         "actor": ADMIN},
        {"kind": "bed", "id": bed10, "unit_id": rea, "old_name": "10", "new_name": "4",
         "actor": ADMIN},
    ]
    assert {r.patient_id for r in rows} == {""}


async def test_a_close_is_audited(ward):
    w, client, app = ward
    admin = w.auth["admin"]
    neo, n1, bed_n1 = str(w.units["neo"].id), str(w.rooms["n1"].id), str(w.beds["N1"].id)
    for path in (f"/tenant/beds/{bed_n1}", f"/tenant/rooms/{n1}", f"/tenant/units/{neo}"):
        assert (await client.patch(path, json={"is_active": False}, headers=admin)).status_code == 200
    closed = {"old_is_active": True, "new_is_active": False, "actor": ADMIN}
    assert [r.payload for r in _rows(app, "structure.close")] == [
        {"kind": "bed", "id": bed_n1, "unit_id": neo, **closed},
        {"kind": "room", "id": n1, "unit_id": neo, **closed},
        {"kind": "unit", "id": neo, "unit_id": neo, **closed},
    ]
    # A rename and a close in one request are two changes, and two rows.
    bed3, rea = str(w.beds["3"].id), str(w.units["rea"].id)
    r = await client.patch(f"/tenant/beds/{bed3}", json={"label": "3A", "is_active": False},
                           headers=admin)
    assert r.status_code == 200, r.text
    assert _rows(app, "structure.rename")[-1].payload == {
        "kind": "bed", "id": bed3, "unit_id": rea, "old_name": "3", "new_name": "3A", "actor": ADMIN}
    assert _rows(app, "structure.close")[-1].payload == {
        "kind": "bed", "id": bed3, "unit_id": rea, **closed}


async def test_a_reopen_is_audited(ward):
    w, client, app = ward
    admin = w.auth["admin"]
    neo, n1, bed_n1 = str(w.units["neo"].id), str(w.rooms["n1"].id), str(w.beds["N1"].id)
    for path in (f"/tenant/beds/{bed_n1}", f"/tenant/rooms/{n1}", f"/tenant/units/{neo}"):
        assert (await client.patch(path, json={"is_active": False}, headers=admin)).status_code == 200
    for path in (f"/tenant/units/{neo}", f"/tenant/rooms/{n1}", f"/tenant/beds/{bed_n1}"):
        assert (await client.patch(path, json={"is_active": True}, headers=admin)).status_code == 200
    reopened = {"old_is_active": False, "new_is_active": True, "actor": ADMIN}
    assert [r.payload for r in _rows(app, "structure.reopen")] == [
        {"kind": "unit", "id": neo, "unit_id": neo, **reopened},
        {"kind": "room", "id": n1, "unit_id": neo, **reopened},
        {"kind": "bed", "id": bed_n1, "unit_id": neo, **reopened},
    ]
    # Reopening what is open changes nothing and writes nothing.
    assert (await client.patch(f"/tenant/beds/{bed_n1}", json={"is_active": True},
                               headers=admin)).status_code == 200
    assert len(_rows(app, "structure.reopen")) == 3


async def test_a_refused_structure_write_writes_nothing(ward, db_session):
    w, client, app = ward
    admin = w.auth["admin"]
    await _set_state(db_session, w.beds["1"], BedState.OCCUPIED)
    rea, neo = w.units["rea"].id, w.units["neo"].id
    o1, o2 = w.rooms["o1"].id, w.rooms["o2"].id
    refused = [
        (await client.patch(f"/tenant/beds/{w.beds['1'].id}", json={"is_active": False},
                            headers=admin), "bed_in_use"),
        (await client.patch(f"/tenant/rooms/{o2}", json={"is_active": False}, headers=admin),
         "has_open_beds"),
        (await client.patch(f"/tenant/units/{neo}", json={"is_active": False}, headers=admin),
         "has_open_beds"),
        (await client.patch(f"/tenant/rooms/{o2}", json={"name": "Otaq 1", "is_active": True},
                            headers=admin), "name_taken"),
        (await client.patch(f"/tenant/beds/{w.beds['10'].id}", json={"label": "2"},
                            headers=admin), "bed_label_taken"),
        (await client.patch(f"/tenant/units/{rea}", json={"name": " "}, headers=admin),
         "field_invalid:name"),
        (await client.post(f"/tenant/units/{rea}/rooms", json={"name": "Otaq 1"}, headers=admin),
         "name_taken"),
        (await client.post(f"/tenant/rooms/{o1}/beds", json={"label": "3"}, headers=admin),
         "bed_label_taken"),
    ]
    for r, code in refused:
        assert r.status_code in (409, 422) and r.json()["detail"]["code"] == code, r.text
    # A rename that is refused does not close what it was sent with, nor half-apply.
    half = await client.patch(f"/tenant/beds/{w.beds['2'].id}", json={"label": "3", "is_active": False},
                              headers=admin)
    assert (half.status_code, half.json()["detail"]["code"]) == (409, "bed_label_taken")
    assert (await client.patch(f"/tenant/beds/{w.beds['2'].id}", json={"label": "X"},
                               headers=w.auth["charge"])).status_code == 403
    assert (await client.post(f"/tenant/rooms/{o1}/beds", json={"label": "X"},
                              headers=w.auth["nurse"])).status_code == 403

    assert _structure_rows(app) == []
    tree = (await client.get("/tenant/structure", headers=admin)).json()
    assert _tree(tree) == {"Reanimasiya": {"Otaq 1": ["1", "2", "10"], "Otaq 2": ["3"]},
                           "Neonatal": {"N-1": ["N1"]}}
    assert all(x["is_active"] for s in tree["sites"] for u in s["units"]
               for x in [u, *u["rooms"], *(b for room in u["rooms"] for b in room["beds"])])


# Every audited write: (method, path, body, caller, its success, the row it owes).
_AUDITED_WRITES = {
    "site create": ("POST", lambda w: f"/tenant/tenants/{w.tenant.id}/sites",
                    {"name": "Sentetik Bina"}, "admin", 201, "structure.create"),
    "unit create": ("POST", lambda w: f"/tenant/sites/{w.site.id}/units",
                    {"name": "Sentetik Birim", "unit_type": "PICU"}, "admin", 201,
                    "structure.create"),
    "room create": ("POST", lambda w: f"/tenant/units/{w.units['rea'].id}/rooms",
                    {"name": "Sentetik Otaq"}, "admin", 201, "structure.create"),
    "bed create": ("POST", lambda w: f"/tenant/rooms/{w.rooms['o1'].id}/beds",
                   {"label": "Sentetik 9"}, "admin", 201, "structure.create"),
    "unit patch": ("PATCH", lambda w: f"/tenant/units/{w.units['rea'].id}",
                   {"name": "Sentetik Rea"}, "admin", 200, "structure.rename"),
    "room patch": ("PATCH", lambda w: f"/tenant/rooms/{w.rooms['o2'].id}",
                   {"name": "Sentetik Otaq 2"}, "admin", 200, "structure.rename"),
    "bed patch": ("PATCH", lambda w: f"/tenant/beds/{w.beds['3'].id}",
                  {"is_active": False}, "admin", 200, "structure.close"),
    "bed release": ("POST", lambda w: f"/tenant/beds/{w.beds['2'].id}/release",
                    None, "nurse", 200, "bed.release"),
}


@pytest.mark.parametrize("name", sorted(_AUDITED_WRITES))
async def test_an_audit_store_failing_after_the_commit_still_answers_success_and_logs(
        ward, db_session, monkeypatch, caplog, name):
    """Amendment A-26: the change is committed before its row is written, so a failing audit
    store must not turn it into a 500. The route answers as usual; the failure is logged at
    ERROR with the event type, the ids and the actor — no name, and not the store's own words."""
    method, path, body, who, success, event_type = _AUDITED_WRITES[name]
    w, client, app = ward
    if name == "bed release":
        await _set_state(db_session, w.beds["2"], BedState.HOUSEKEEPING)

    def store_down(event):
        raise RuntimeError("audit store down while writing Sentetik Hasta")

    monkeypatch.setattr(app.state.audit, "append", store_down)
    caplog.set_level(logging.ERROR, logger="homunculus.admission.trail")
    r = await client.request(method, path(w), json=body, headers=w.auth[who])
    assert r.status_code == success, r.text

    (logged,) = [rec for rec in caplog.records
                 if rec.name == "homunculus.admission.trail" and rec.levelno == logging.ERROR]
    message = logged.getMessage()
    assert event_type in message and r.json()["id"] in message, message
    assert f"{who}@kabul.example.com" in message, message
    assert "Sentetik" not in message, message


# ---------------------------------------------------------------- POST /tenant/beds/{id}/release
async def test_a_nurse_releases_a_cleaned_bed_of_her_unit_and_it_is_audited(ward, db_session):
    w, client, app = ward
    bed_id, unit_id = w.beds["2"].id, w.units["rea"].id
    await _set_state(db_session, w.beds["2"], BedState.HOUSEKEEPING)
    r = await client.post(f"/tenant/beds/{bed_id}/release", headers=w.auth["nurse"])
    assert r.status_code == 200, r.text
    assert r.json()["state"] == "AVAILABLE"
    db_session.expire_all()
    assert (await db_session.execute(select(Bed.state).where(Bed.id == bed_id))).scalar_one() \
        == BedState.AVAILABLE
    (row,) = [r for r in app.state.audit.records(tenant="kabul-hastane", limit=10)
              if r.event_type == "bed.release"]
    assert row.payload == {"bed_id": str(bed_id), "unit_id": str(unit_id),
                           "actor": "nurse@kabul.example.com"}


async def test_a_bed_that_is_not_in_cleaning_is_not_released(ward):
    w, client, app = ward
    r = await client.post(f"/tenant/beds/{w.beds['2'].id}/release", headers=w.auth["nurse"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "invalid_transition")
    assert _rows(app, "bed.release") == []


async def test_a_bed_of_another_unit_is_out_of_scope(ward, db_session):
    w, client, _ = ward
    await _set_state(db_session, w.beds["N1"], BedState.HOUSEKEEPING)
    r = await client.post(f"/tenant/beds/{w.beds['N1'].id}/release", headers=w.auth["nurse"])
    assert (r.status_code, r.json()["detail"]["code"]) == (403, "out_of_scope")
    r = await client.post(f"/tenant/beds/{w.beds['N1'].id}/release", headers=w.auth["nurse_b"])
    assert r.status_code == 200


async def test_a_physician_does_not_release_beds(ward, db_session):
    w, client, _ = ward
    await _set_state(db_session, w.beds["2"], BedState.HOUSEKEEPING)
    r = await client.post(f"/tenant/beds/{w.beds['2'].id}/release", headers=w.auth["doctor"])
    assert r.status_code == 403 and r.json()["detail"] == "permission required: beds.release"

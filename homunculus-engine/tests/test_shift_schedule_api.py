# homunculus-engine/tests/test_shift_schedule_api.py
"""G4-04 «İş yükü» (spec D3, D4 and §5): the nurse–bed assignment per shift.
- GET /shift-schedule answers the window and the units in the caller's reach — her unit grants (a bed grant reaches no
  unit), every unit for an unrestricted caller — each with its ACTIVE rows of that window (a row's unit is its bed's)
  and the count of its active rows of another window that overlap this one (`other_rows`: the shift hours changed);
  either key opens it; staff names, never a patient;
- GET /shift-schedule/nurses offers the tenant's active members of the default nurse and charge-nurse groups, each with
  whether her own scope reaches the unit;
- PUT /shift-schedule names its window by `shift_start` (a window no longer current or next is a 409 `shift_changed`)
  and replaces one unit's window under its lock: the rows it ends go inactive with `closed_at` and stay, the new ones are
  written, the rows of another window that overlap it end too; `expected` is required and must be what holds (409);
  a bed of another unit, a closed bed, a person not offered or a bed named twice is a 422 — a person no longer offered
  keeps the bed she holds; a unit outside her units is a 403; two saves on one read at once save one; a nurse who
  cannot see the unit is a warning; one `shift.assign` audit row, ids only, the unit its subject;
- the window is the tenant's own (its two starts, its zone); the POST is gone.
Postgres. Synthetic ward: tests/kabul_world.py."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy import select, text, update

from homunculus.admin.service import CONCURRENT_CHANGE
from homunculus.admission import shifts
from homunculus.admission.models import NurseBedAssignment
from homunculus.api.tasks import InMemoryTaskStore, TaskSettings
from homunculus.auth.groups import ensure_default_groups
from homunculus.auth.models import Group, GroupPermission, TenantMembership, User
from homunculus.scope.models import StaffScope
from homunculus.tenant.models import Bed, Tenant
from tests.conftest import requires_db
from tests.kabul_world import SLUG, build_ward, ward_client
from tests.signed_in import add_user, bearer
from tests.test_discharge_api import audited

pytestmark = [requires_db]
#: 10:00 UTC on 12 November: shift A of the default starts (08 and 20) in the ward's zone, UTC.
NOW = datetime(2026, 11, 12, 10, 0, tzinfo=timezone.utc)
A_START, A_END = datetime(2026, 11, 12, 8, tzinfo=timezone.utc), datetime(2026, 11, 12, 20, tzinfo=timezone.utc)
CURRENT = {"start": "2026-11-12T08:00:00Z", "end": "2026-11-12T20:00:00Z", "which": "A"}
NEXT = {"start": "2026-11-12T20:00:00Z", "end": "2026-11-13T08:00:00Z", "which": "B"}


@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    monkeypatch.setattr(shifts, "_now", lambda: NOW)
    built = await build_ward(db_session)
    async with ward_client(db_session) as (client, app):
        yield built, client, app


def _pairs(w, pairs):
    return [{"bed_id": str(w.beds[bed].id), "nurse_id": str(w.users[who].id)} for bed, who in pairs]


def _put(w, unit="rea", items=(), start=CURRENT["start"], expected=()) -> dict:
    """A PUT body: (bed label, user) pairs for the window starting at `start`; `expected` the pairs the form read."""
    return {"unit_id": str(w.units[unit].id), "shift_start": start, "items": _pairs(w, items),
            "expected": _pairs(w, expected)}


def _shown(w, answer) -> dict[str, list[tuple[str, str]]]:
    """The answer's units by name, each with its (bed label, nurse name) pairs."""
    label = {str(bed.id): name for name, bed in w.beds.items()}
    return {u["unit_name"]: sorted((label[i["bed_id"]], i["nurse_name"]) for i in u["items"]) for u in answer["units"]}


async def _rows(db, w) -> list[tuple[str, str, bool, datetime]]:
    """Every row of the table as (bed label, user, active, window start), sorted."""
    beds = {bed.id: name for name, bed in w.beds.items()}
    users = {user.id: name for name, user in w.users.items()}
    rows = (await db.execute(select(NurseBedAssignment.bed_id, NurseBedAssignment.nurse_id,
                                    NurseBedAssignment.is_active, NurseBedAssignment.shift_start))).all()
    return sorted((beds[bed], users.get(nurse, "?"), active, start) for bed, nurse, active, start in rows)


async def _holder(db, w, name: str, *keys: str, unit: str | None = None, bed: str | None = None) -> dict[str, str]:
    """A member of a group of the ward's own that holds `keys` alone, granted `unit` or `bed`; her bearer header."""
    group = Group(tenant_id=w.tenant.id, slug=f"g_{name}", name=name, is_system=False)
    group.permissions = [GroupPermission(permission=key) for key in keys]
    db.add(group)
    await db.flush()
    user = await add_user(db, username=f"{name}@kabul.example.com", tenant_id=w.tenant.id, group=group)
    if unit or bed:
        db.add(StaffScope(tenant_id=w.tenant.id, user_id=user.id, unit_id=str(w.units[unit].id) if unit else "",
                          bed_id=str(w.beds[bed].id) if bed else ""))
        await db.commit()
    return await bearer(db, user)


async def _nurse(db, w, username: str):
    """One more member of the ward's default nurse group (no grant)."""
    group = (await db.execute(select(Group).where(Group.tenant_id == w.tenant.id, Group.slug == "nurse"))).scalar_one()
    return await add_user(db, username=username, tenant_id=w.tenant.id, group=group)


async def _waits_on_the_unit(db_session) -> None:
    """Until a session of the test database waits on a lock while it reads the units table (the PUT's lock). A fresh
    connection per look: a transaction would see `pg_stat_activity` as it was when it first read it."""
    for _ in range(200):
        async with db_session.bind.connect() as conn:
            waiting = (await conn.execute(text(
                "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() "
                "AND wait_event_type = 'Lock' AND query NOT ILIKE '%advisory%' AND query ILIKE '%units%'"))).scalar_one()
        if waiting:
            return
        await asyncio.sleep(0.05)
    raise AssertionError("the second save never waited on the unit's lock")


# ---------------------------------------------------------------- GET /shift-schedule
async def test_the_shift_and_the_units_in_reach_with_their_active_rows(ward, db_session):
    """D3, D4: «Bu nöbet» holds now (10:00 UTC: A, 08–20); an unrestricted caller reads every unit, by name, a quiet one
    with no row; only the ACTIVE rows of THIS window — an ended row and the next window's are not."""
    w, client, _ = ward
    rea, b1, b2 = w.units["rea"].id, w.beds["1"].id, w.beds["2"].id
    nurse, charge = w.users["nurse"].id, w.users["charge"].id
    db_session.add_all([
        NurseBedAssignment(unit_id=rea, bed_id=b1, nurse_id=nurse, shift_start=A_START, shift_end=A_END),
        NurseBedAssignment(unit_id=rea, bed_id=b2, nurse_id=charge, shift_start=A_START, shift_end=A_END,
                           is_active=False),
        NurseBedAssignment(unit_id=rea, bed_id=b2, nurse_id=nurse, shift_start=A_END,
                           shift_end=A_END + timedelta(hours=12)),
    ])
    await db_session.commit()
    r = await client.get("/shift-schedule", headers=w.auth["admin"])
    assert r.status_code == 200, r.text
    assert r.json()["shift"] == CURRENT
    assert [(u["unit_name"], u["other_rows"]) for u in r.json()["units"]] == [("Neonatal", 0), ("Reanimasiya", 0)]
    assert _shown(w, r.json()) == {"Neonatal": [], "Reanimasiya": [("1", "nurse")]}
    r = await client.get("/shift-schedule?shift=next", headers=w.auth["admin"])
    assert (r.json()["shift"], _shown(w, r.json())) == (NEXT, {"Neonatal": [], "Reanimasiya": [("2", "nurse")]})


async def test_a_rows_unit_is_its_beds_and_the_answer_names_no_patient(ward, db_session):
    """§5 A8: a row the retired POST wrote under another unit is its bed's unit's. The keys are pinned, so a patient
    field cannot slip in; staff by full name and user name."""
    w, client, _ = ward
    db_session.add(NurseBedAssignment(unit_id=w.units["neo"].id, bed_id=w.beds["1"].id, nurse_id=w.users["nurse"].id,
                                      shift_start=A_START, shift_end=A_END))
    await db_session.commit()
    body = (await client.get("/shift-schedule", headers=w.auth["admin"])).json()
    assert _shown(w, body) == {"Neonatal": [], "Reanimasiya": [("1", "nurse")]}
    assert set(body) == {"shift", "units", "generated_at"} and set(body["shift"]) == {"start", "end", "which"}
    assert {key for unit in body["units"] for key in unit} == {"unit_id", "unit_name", "items", "other_rows"}
    (item,) = [i for unit in body["units"] for i in unit["items"]]
    assert item == {"bed_id": str(w.beds["1"].id), "nurse_id": str(w.users["nurse"].id), "nurse_name": "nurse",
                    "nurse_username": "nurse@kabul.example.com"}
    assert body["generated_at"] == "2026-11-12T10:00:00Z"


async def test_the_reach_is_the_callers_unit_grants(ward, db_session):
    """D4, §5 M3: a unit grant reaches its unit (the charge nurse: Reanimasiya); a bed grant reaches no unit; a unit asked
    for outside her units is a 403 (another tenant's or a missing one a 404: tests/test_tenant_isolation.py)."""
    w, client, _ = ward
    r = await client.get("/shift-schedule", headers=w.auth["charge"])
    assert [u["unit_name"] for u in r.json()["units"]] == ["Reanimasiya"]
    bed_only = await _holder(db_session, w, "bedonly", "workload.view", bed="1")
    r = await client.get("/shift-schedule", headers=bed_only)
    assert (r.status_code, r.json()["units"]) == (200, [])
    r = await client.get(f"/shift-schedule?unit_id={w.units['neo'].id}", headers=w.auth["charge"])
    assert (r.status_code, r.json()["detail"]["code"]) == (403, "out_of_scope")
    r = await client.get(f"/shift-schedule?shift=next&unit_id={w.units['rea'].id}", headers=w.auth["charge"])
    assert ([u["unit_name"] for u in r.json()["units"]], r.json()["shift"]) == (["Reanimasiya"], NEXT)


async def test_either_key_opens_the_read_and_the_writes_are_the_managers(ward, db_session):
    """D4: GET for `shifts.manage` or `workload.view`; the form's people and the PUT for `shifts.manage` alone."""
    w, client, _ = ward
    viewer = await _holder(db_session, w, "viewer", "workload.view", unit="rea")
    manager = await _holder(db_session, w, "manager", "shifts.manage", unit="rea")
    for headers in (viewer, manager):
        assert (await client.get("/shift-schedule", headers=headers)).status_code == 200
    rea = w.units["rea"].id
    r = await client.get(f"/shift-schedule/nurses?unit_id={rea}", headers=viewer)
    assert (r.status_code, r.json()["detail"]) == (403, "permission required: shifts.manage")
    assert (await client.put("/shift-schedule", json=_put(w), headers=viewer)).status_code == 403
    assert (await client.get(f"/shift-schedule/nurses?unit_id={rea}", headers=manager)).status_code == 200
    r = await client.get("/shift-schedule", headers=w.auth["auditor"])
    assert (r.status_code, r.json()["detail"]) == (403, "permission required: shifts.manage or workload.view")


async def test_the_window_is_the_tenants_own_starts_and_zone(ward, monkeypatch):
    """D3, §5 M4: Görevlerim's two starts and the tenant's zone, read from the app's task store as GET /tasks reads them."""
    w, client, app = ward
    app.state.tasks.save_settings(SLUG, TaskSettings(shift_start_a=7, shift_start_b=19), by="admin", now=NOW)
    r = await client.get("/shift-schedule", headers=w.auth["charge"])
    assert r.json()["shift"] == {"start": "2026-11-12T07:00:00Z", "end": "2026-11-12T19:00:00Z", "which": "A"}
    baku = timezone(timedelta(hours=4))       # tzdata is not on every test host (test_fluids.py)
    app.state.tasks = InMemoryTaskStore(zones={SLUG: "Asia/Baku"})
    monkeypatch.setattr(shifts, "zone_of", lambda name: baku if name == "Asia/Baku" else timezone.utc)
    r = await client.get("/shift-schedule", headers=w.auth["charge"])
    # 10:00 UTC is 14:00 in Baku: A, 08:00–20:00 Baku.
    assert r.json()["shift"] == {"start": "2026-11-12T04:00:00Z", "end": "2026-11-12T16:00:00Z", "which": "A"}


async def test_rows_of_shift_hours_changed_mid_shift_are_counted_and_the_next_save_ends_them(ward, db_session):
    """§5 A3: the hospital moves its hours to 07/19 at 10:00; the 08–20 rows no longer have the window's key — the GET
    counts them (`other_rows`), and a PUT for the new window ends them too, said in its audit row."""
    w, client, app = ward
    db_session.add(NurseBedAssignment(unit_id=w.units["rea"].id, bed_id=w.beds["1"].id, nurse_id=w.users["nurse"].id,
                                      shift_start=A_START, shift_end=A_END))
    await db_session.commit()
    app.state.tasks.save_settings(SLUG, TaskSettings(shift_start_a=7, shift_start_b=19), by="admin", now=NOW)
    r = await client.get("/shift-schedule", headers=w.auth["charge"])
    (unit,) = r.json()["units"]
    assert (unit["items"], unit["other_rows"]) == ([], 1)
    r = await client.put("/shift-schedule", json=_put(w, items=[("2", "nurse")], start="2026-11-12T07:00:00Z"),
                         headers=w.auth["charge"])
    assert r.status_code == 200, r.text
    assert r.json()["units"][0]["other_rows"] == 0
    seven = datetime(2026, 11, 12, 7, tzinfo=timezone.utc)
    assert await _rows(db_session, w) == [("1", "nurse", False, A_START), ("2", "nurse", True, seven)]
    (row,) = audited(app, "shift.assign")
    assert row.payload["other"] == [[str(w.beds["1"].id), str(w.users["nurse"].id)]]


# ---------------------------------------------------------------- GET /shift-schedule/nurses
async def test_the_form_offers_the_tenants_active_nurses_and_charge_nurses_and_says_who_reaches_the_unit(ward, db_session):
    """§5 A10: the members of the default `nurse` and `charge_nurse` groups — not the physician, the administrator or the
    auditor; not a deactivated account, a membership no longer active, or another tenant's nurse — by name, each with
    whether her own scope reaches the unit (the second nurse is granted Neonatal only). The unit is checked as the PUT
    checks it."""
    w, client, _ = ward
    gone = await _nurse(db_session, w, "gone@kabul.example.com")
    left = await _nurse(db_session, w, "left@kabul.example.com")
    await db_session.execute(update(User).where(User.id == gone.id).values(is_active=False))
    await db_session.execute(update(TenantMembership).where(TenantMembership.user_id == left.id).values(is_active=False))
    other = Tenant(name="Sentetik Başka Hastane", slug="baska-hastane", country_code="AZ")
    db_session.add(other)
    await db_session.flush()
    groups = await ensure_default_groups(db_session, other.id)
    await db_session.commit()
    await add_user(db_session, username="uzak@baska.example.com", tenant_id=other.id, group=groups["nurse"])
    r = await client.get(f"/shift-schedule/nurses?unit_id={w.units['rea'].id}", headers=w.auth["charge"])
    assert r.status_code == 200, r.text
    assert r.json() == [
        {"id": str(w.users[name].id), "name": name, "username": f"{name}@kabul.example.com", "reaches_unit": reaches}
        for name, reaches in (("charge", True), ("nurse", True), ("nurse_b", False))]
    r = await client.get(f"/shift-schedule/nurses?unit_id={w.units['neo'].id}", headers=w.auth["charge"])
    assert (r.status_code, r.json()["detail"]["code"]) == (403, "out_of_scope")


# ---------------------------------------------------------------- PUT /shift-schedule
async def test_a_save_replaces_the_units_window_and_keeps_the_rows_it_ended(ward, db_session):
    """D4, §5 M1: a row the save leaves out goes inactive with `closed_at` and stays; a pair it keeps is not touched; a
    new pair is written. The answer is the unit's new state."""
    w, client, _ = ward
    r = await client.put("/shift-schedule", json=_put(w, items=[("1", "nurse"), ("2", "nurse")]), headers=w.auth["charge"])
    assert r.status_code == 200, r.text
    assert (r.json()["shift"], _shown(w, r.json()), r.json()["warnings"]) == (
        CURRENT, {"Reanimasiya": [("1", "nurse"), ("2", "nurse")]}, [])
    kept = (await db_session.execute(select(NurseBedAssignment.id).where(
        NurseBedAssignment.bed_id == w.beds["2"].id))).scalar_one()
    r = await client.put("/shift-schedule", json=_put(w, items=[("1", "charge"), ("2", "nurse")],
                                                      expected=[("1", "nurse"), ("2", "nurse")]),
                         headers=w.auth["charge"])
    assert r.status_code == 200, r.text
    assert _shown(w, r.json()) == {"Reanimasiya": [("1", "charge"), ("2", "nurse")]}
    assert await _rows(db_session, w) == [("1", "charge", True, A_START), ("1", "nurse", False, A_START),
                                          ("2", "nurse", True, A_START)]
    closed = (await db_session.execute(select(NurseBedAssignment.closed_at).where(
        NurseBedAssignment.is_active.is_(False)))).scalar_one()
    assert closed == NOW
    still = (await db_session.execute(select(NurseBedAssignment.id).where(
        NurseBedAssignment.bed_id == w.beds["2"].id, NurseBedAssignment.is_active.is_(True)))).scalar_one()
    assert still == kept                                       # the kept pair's own row


async def test_the_next_shift_is_a_window_of_its_own(ward):
    w, client, _ = ward
    r = await client.put("/shift-schedule", json=_put(w, items=[("1", "nurse")], start=NEXT["start"]),
                         headers=w.auth["charge"])
    assert (r.status_code, r.json()["shift"]) == (200, NEXT)
    assert _shown(w, (await client.get("/shift-schedule", headers=w.auth["charge"])).json()) == {"Reanimasiya": []}
    r = await client.get("/shift-schedule?shift=next", headers=w.auth["charge"])
    assert _shown(w, r.json()) == {"Reanimasiya": [("1", "nurse")]}


async def test_a_save_across_the_shift_change_names_the_window_it_meant(ward, monkeypatch):
    """§5 A1: the form read at 19:50 and saves at 20:00:30. Its «Bu nöbet» (08:00) is neither current nor next any more:
    409 `shift_changed`, nothing written. Its «Sonraki nöbet» (20:00) is current now: saved there."""
    w, client, app = ward
    monkeypatch.setattr(shifts, "_now", lambda: datetime(2026, 11, 12, 20, 0, 30, tzinfo=timezone.utc))
    r = await client.put("/shift-schedule", json=_put(w, items=[("1", "nurse")]), headers=w.auth["charge"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "shift_changed")
    assert audited(app, "shift.assign") == []
    r = await client.put("/shift-schedule", json=_put(w, items=[("1", "nurse")], start=NEXT["start"]),
                         headers=w.auth["charge"])
    assert (r.status_code, r.json()["shift"]) == (200, NEXT)
    r = await client.put("/shift-schedule", json=_put(w, start="2026-11-12T07:00:00Z"), headers=w.auth["charge"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "shift_changed")     # never a window's start at all


async def test_an_empty_list_clears_the_window_and_expected_is_required(ward, db_session):
    """§5 A7: `expected` is required — a body without it is refused; an empty `items` ends every row of the window."""
    w, client, _ = ward
    await client.put("/shift-schedule", json=_put(w, items=[("1", "nurse")]), headers=w.auth["charge"])
    body = _put(w, items=[])
    del body["expected"]
    assert (await client.put("/shift-schedule", json=body, headers=w.auth["charge"])).status_code == 422
    r = await client.put("/shift-schedule", json=_put(w, items=[], expected=[("1", "nurse")]), headers=w.auth["charge"])
    assert (r.status_code, _shown(w, r.json())) == (200, {"Reanimasiya": []})
    assert await _rows(db_session, w) == [("1", "nurse", False, A_START)]


@pytest.mark.parametrize("case", ["another unit's bed", "a closed bed", "a person not offered", "a bed named twice"])
async def test_a_wrong_item_is_a_422_and_nothing_is_written(ward, db_session, case):
    """D4: every new pair's bed an open bed of THAT unit, its person an offered one, a bed once — else 422
    `field_invalid:items`, nothing written, nothing audited."""
    w, client, app = ward
    if case == "a closed bed":
        await db_session.execute(update(Bed).where(Bed.id == w.beds["10"].id).values(is_active=False))
        await db_session.commit()
    items = {"another unit's bed": [("N1", "nurse")], "a closed bed": [("10", "nurse")],
             "a person not offered": [("1", "doctor")], "a bed named twice": [("1", "nurse"), ("1", "charge")]}[case]
    r = await client.put("/shift-schedule", json=_put(w, items=items), headers=w.auth["charge"])
    assert (r.status_code, r.json()["detail"]["code"]) == (422, "field_invalid:items"), r.text
    assert await _rows(db_session, w) == [] and audited(app, "shift.assign") == []


async def test_a_nurse_no_longer_offered_keeps_her_bed_but_is_given_no_new_one(ward, db_session):
    """§5 A10: her account ends mid-shift; a save that keeps her pair as read is taken; one that gives her another bed is
    refused, nothing written."""
    w, client, _ = ward
    gone = await _nurse(db_session, w, "gone@kabul.example.com")
    w.users["gone"] = gone
    r = await client.put("/shift-schedule", json=_put(w, items=[("1", "gone")]), headers=w.auth["charge"])
    assert r.status_code == 200, r.text
    await db_session.execute(update(User).where(User.id == gone.id).values(is_active=False))
    await db_session.commit()
    r = await client.put("/shift-schedule", json=_put(w, items=[("1", "gone"), ("2", "nurse")], expected=[("1", "gone")]),
                         headers=w.auth["charge"])
    assert r.status_code == 200, r.text
    before = await _rows(db_session, w)
    r = await client.put("/shift-schedule", json=_put(w, items=[("1", "gone"), ("3", "gone")],
                                                      expected=[("1", "gone"), ("2", "nurse")]),
                         headers=w.auth["charge"])
    assert r.status_code == 422, r.text
    assert await _rows(db_session, w) == before


async def test_a_unit_outside_her_units_is_a_403_and_a_bed_grant_is_not_enough(ward, db_session):
    w, client, app = ward
    r = await client.put("/shift-schedule", json=_put(w, unit="neo", items=[("N1", "nurse_b")]),
                         headers=w.auth["charge"])
    assert (r.status_code, r.json()["detail"]["code"]) == (403, "out_of_scope")
    bed_only = await _holder(db_session, w, "bedonly", "shifts.manage", bed="1")
    r = await client.put("/shift-schedule", json=_put(w, items=[("1", "nurse")]), headers=bed_only)
    assert (r.status_code, r.json()["detail"]["code"]) == (403, "out_of_scope")
    assert await _rows(db_session, w) == [] and audited(app, "shift.assign") == []


async def test_a_save_on_an_old_read_is_a_409_and_writes_nothing(ward, db_session):
    """D4: `expected` is compared, as a set, with the rows read under the lock — the text the dashboard knows as
    `concurrentChange`, nothing written, nothing audited."""
    w, client, app = ward
    first = await client.put("/shift-schedule", json=_put(w, items=[("1", "nurse")]), headers=w.auth["charge"])
    assert first.status_code == 200, first.text
    before = await _rows(db_session, w)
    r = await client.put("/shift-schedule", json=_put(w, items=[("1", "nurse_b")]), headers=w.auth["admin"])
    assert (r.status_code, r.json()["detail"]) == (409, CONCURRENT_CHANGE)
    assert await _rows(db_session, w) == before
    assert len(audited(app, "shift.assign")) == 1


async def test_two_saves_on_one_read_at_once_save_one_and_refuse_the_other(ward, db_session, monkeypatch):
    """§5 A7: the second save waits on the unit's lock, then reads the first's rows and is refused 409; one audit row."""
    w, client, app = ward
    reached, gate = asyncio.Event(), asyncio.Event()
    real, calls = shifts._held, []

    async def held(*args, **kwargs):
        rows = await real(*args, **kwargs)
        calls.append(1)
        if len(calls) == 1:
            reached.set()
            await gate.wait()
        return rows

    monkeypatch.setattr(shifts, "_held", held)
    one = asyncio.create_task(client.put("/shift-schedule", json=_put(w, items=[("1", "nurse")]),
                                         headers=w.auth["charge"]))
    try:
        await asyncio.wait_for(reached.wait(), timeout=10)
        two = asyncio.create_task(client.put("/shift-schedule", json=_put(w, items=[("1", "nurse_b")]),
                                             headers=w.auth["admin"]))
        await _waits_on_the_unit(db_session)
    finally:
        gate.set()
    first, second = await one, await two
    assert (first.status_code, second.status_code) == (200, 409), (first.text, second.text)
    assert await _rows(db_session, w) == [("1", "nurse", True, A_START)]
    assert len(audited(app, "shift.assign")) == 1


async def test_a_nurse_who_cannot_see_the_unit_is_a_warning_not_a_refusal(ward):
    """§5 A10, A12: the second nurse is granted Neonatal only — assigned a Reanimasiya bed she is saved, and the answer
    warns (ids: the page names her). No beds-per-nurse warning (S-25): four beds to one nurse warn nothing."""
    w, client, _ = ward
    r = await client.put("/shift-schedule", json=_put(w, items=[("1", "nurse_b"), ("2", "nurse"), ("3", "nurse"),
                                                                ("10", "nurse")]), headers=w.auth["charge"])
    assert r.status_code == 200, r.text
    assert r.json()["warnings"] == [{"code": "unit_not_reached", "nurse_id": str(w.users["nurse_b"].id)}]
    assert len(_shown(w, r.json())["Reanimasiya"]) == 4


async def test_one_audit_row_names_the_window_and_the_pairs_before_and_after(ward, db_session):
    """D4, §5 M8: `shift.assign` after the commit — the unit (its subject too), the window's bounds, the (bed, nurse) ids
    before and after, the other windows' rows it ended, the actor's user name; no patient, no name. The rows name the
    charge nurse who saved them."""
    w, client, app = ward
    await client.put("/shift-schedule", json=_put(w, items=[("1", "nurse")]), headers=w.auth["charge"])
    await client.put("/shift-schedule", json=_put(w, items=[("2", "charge")], expected=[("1", "nurse")]),
                     headers=w.auth["charge"])
    rows = audited(app, "shift.assign")
    assert len(rows) == 2
    ids = lambda bed, who: [str(w.beds[bed].id), str(w.users[who].id)]       # noqa: E731
    assert (rows[-1].patient_id, rows[-1].subject, rows[-1].payload) == ("", str(w.units["rea"].id), {
        "unit_id": str(w.units["rea"].id), "shift_start": "2026-11-12T08:00:00+00:00",
        "shift_end": "2026-11-12T20:00:00+00:00", "before": [ids("1", "nurse")], "after": [ids("2", "charge")],
        "other": [], "actor": "charge@kabul.example.com"})
    by = (await db_session.execute(select(NurseBedAssignment.charge_nurse_id)
                                   .where(NurseBedAssignment.is_active.is_(True)))).scalars().all()
    assert by == [w.users["charge"].id]


async def test_the_retired_post_is_gone(ward):
    """D4: POST /shift-schedule is retired — the path answers GET and PUT only."""
    w, client, _ = ward
    r = await client.post("/shift-schedule", json={}, headers=w.auth["charge"])
    assert r.status_code == 405

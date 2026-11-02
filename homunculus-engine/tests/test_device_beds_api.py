# homunculus-engine/tests/test_device_beds_api.py
"""The editor's routes (spec §4): the list (Task 8); bind and unbind (Task 9). Synthetic ward."""
from __future__ import annotations

import asyncio
import time
import uuid
from datetime import datetime

import pytest
from alembic import command
from pydantic import ValidationError
from sqlalchemy import create_engine, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from homunculus.admission import trail
from homunculus.api.device_beds_postgres import PostgresDeviceBeds
from homunculus.devicebeds import service
from homunculus.devicebeds.models import DeviceBed
from homunculus.devicebeds.rows import current_rows, db_time, editor_row
from homunculus.devicebeds.schemas import BindBody, UnbindBody
from homunculus.tenant.models import Bed, Room, Site, Tenant, Unit, UnitType
from tests.conftest import TEST_DATABASE_URL, _sync_engine_url, requires_db
from tests.esleme_world import APPROVED, FROM, SOURCES, UNIT_OF, URL, esleme_client, group_of, seed
from tests.kabul_world import BOARD, build_ward

pytestmark = [requires_db]


def _by_source(body):
    return {d["source"]: d for d in body["devices"]}


async def _foreign_bed(db) -> tuple[Tenant, Unit, Bed]:
    """A bed of ANOTHER hospital (synthetic): its tenant, its unit and the bed."""
    other = Tenant(name="Sentetik Başqa Xəstəxana", slug="baska-hastane", country_code="AZ")
    db.add(other)
    await db.flush()
    site = Site(tenant_id=other.id, name="Başqa bina")
    db.add(site)
    await db.flush()
    unit = Unit(site_id=site.id, name="Başqa şöbə", unit_type=UnitType.ADULT_ICU)
    db.add(unit)
    await db.flush()
    room = Room(unit_id=unit.id, name="Başqa otaq")
    db.add(room)
    await db.flush()
    bed = Bed(room_id=room.id, label="X1")
    db.add(bed)
    await db.flush()
    return other, unit, bed


async def test_the_list_is_the_workers_devices_and_the_tables_rows_in_address_order(db_session):
    async with esleme_client(db_session) as (client, _, ward):
        ids = await seed(db_session, ward, ("192.0.2.11", "1", "BED05"), ("192.0.2.12", None, "BED01"),
                         ("192.0.2.20", "3", "BED07"))
        body = (await client.get(URL, headers=ward.auth["admin"])).json()
    assert body["stage"] == "shadow" and body["can_bind"] is True
    assert [d["source"] for d in body["devices"]] == ["192.0.2.11", "192.0.2.12", "192.0.2.13", "192.0.2.20"]
    d = _by_source(body)
    assert d["192.0.2.11"] | {"last_seen_at": None} == {
        "source": "192.0.2.11", "group": "224.0.2.11", "port": 2050, "device_bed_label": "BED05",
        "seen": True, "status": "streaming", "last_seen_at": None, "row_id": ids["192.0.2.11"],
        "bed": {"id": str(ward.beds["1"].id), "in_scope": True, "label": "1", "room": "Otaq 1",
                "unit": "Reanimasiya"},
        "editable": True}
    assert d["192.0.2.11"]["last_seen_at"].endswith("+00:00")
    assert (d["192.0.2.12"]["bed"], d["192.0.2.12"]["device_bed_label"]) == (None, "BED01")   # label-only
    assert (d["192.0.2.13"]["row_id"], d["192.0.2.13"]["bed"], d["192.0.2.13"]["editable"]) == (None, None, True)
    absent = d["192.0.2.20"]                                         # bound, not reported: kept (D9)
    assert (absent["seen"], absent["status"], absent["last_seen_at"]) == (False, None, None)
    assert absent["bed"]["label"] == "3" and absent["group"] == "224.0.2.20"


async def test_devices_are_ordered_by_address_as_numbers_not_as_text(db_session):
    """As text `.100` sorts before `.11` and `.9` last; the octets are compared as numbers.
    `.9` is a store device, `.100` a row the worker does not report."""
    async with esleme_client(db_session, sources=("192.0.2.9",) + SOURCES) as (client, _, ward):
        await seed(db_session, ward, ("192.0.2.100", None, None))
        body = (await client.get(URL, headers=ward.auth["admin"])).json()
    sources = [d["source"] for d in body["devices"]]
    assert sources == ["192.0.2.9", "192.0.2.11", "192.0.2.12", "192.0.2.13", "192.0.2.100"]
    assert sources != sorted(sources)                              # the test would be blind to a text sort


async def test_a_row_whose_source_is_not_an_address_sorts_last_and_is_not_a_500(db_session):
    async with esleme_client(db_session) as (client, _, ward):
        await seed(db_session, ward, ("host.example", None, None), ("a.b", None, None))
        response = await client.get(URL, headers=ward.auth["admin"])
    assert response.status_code == 200
    assert [d["source"] for d in response.json()["devices"]] == [
        "192.0.2.11", "192.0.2.12", "192.0.2.13", "a.b", "host.example"]


async def test_generated_at_is_an_aware_utc_time(db_session):
    async with esleme_client(db_session) as (client, _, ward):
        stamp = (await client.get(URL, headers=ward.auth["admin"])).json()["generated_at"]
    assert stamp.endswith("+00:00") and abs(datetime.fromisoformat(stamp).timestamp() - time.time()) < 60


async def test_a_silent_device_is_not_seen_but_still_says_when_it_was_last_seen(db_session):
    """After 15 s without a report the store shows `unknown`: unseen, yet this process held the device,
    so `last_seen_at` is set (spec §4.2) — about now minus the silence."""
    tick = [1000.0]
    async with esleme_client(db_session, monotonic=lambda: tick[0]) as (client, _, ward):
        tick[0] += 100.0                                           # the worker's reports stop
        body = (await client.get(URL, headers=ward.auth["admin"])).json()
    assert [d["status"] for d in body["devices"]] == ["unknown"] * 3
    assert [d["seen"] for d in body["devices"]] == [False] * 3
    gap = datetime.fromisoformat(body["generated_at"]) - datetime.fromisoformat(body["devices"][0]["last_seen_at"])
    assert abs(gap.total_seconds() - 100.0) < 1


async def test_biomedical_with_no_grants_sees_bed_names_under_the_default_unrestricted_scope(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    async with esleme_client(db_session) as (client, _, ward):
        await seed(db_session, ward, ("192.0.2.11", "1", "BED05"))
        body = (await client.get(URL, headers=ward.auth["bio"])).json()
    assert _by_source(body)["192.0.2.11"]["bed"] == {
        "id": str(ward.beds["1"].id), "in_scope": True, "label": "1", "room": "Otaq 1", "unit": "Reanimasiya"}


async def test_a_charge_nurse_sees_another_units_monitor_without_names_and_cannot_edit_it(db_session):
    async with esleme_client(db_session) as (client, _, ward):
        await seed(db_session, ward, ("192.0.2.11", "N1", "BEDN1"), ("192.0.2.12", "2", "BED02"))
        body = (await client.get(URL, headers=ward.auth["charge"])).json()
    d = _by_source(body)
    assert d["192.0.2.11"]["bed"] == {"id": str(ward.beds["N1"].id), "in_scope": False}
    assert d["192.0.2.11"]["editable"] is False
    assert d["192.0.2.12"]["bed"]["in_scope"] is True and d["192.0.2.12"]["editable"] is True
    assert d["192.0.2.13"]["editable"] is True                      # unbound: any holder may bind it


async def test_biomedical_reads_the_list_and_may_change_nothing(db_session):
    async with esleme_client(db_session) as (client, _, ward):
        await seed(db_session, ward, ("192.0.2.11", "1", "BED05"))
        body = (await client.get(URL, headers=ward.auth["bio"])).json()
    assert body["can_bind"] is False and not any(d["editable"] for d in body["devices"])


async def test_a_row_pointing_at_another_tenants_bed_names_nothing_even_to_the_administrator(db_session):
    """A bed has no tenant_id (A-8): the names come through room, unit and site, so a row that
    somehow names a bed of another hospital shows its id alone and is not editable."""
    async with esleme_client(db_session) as (client, _, ward):
        _, unit, foreign = await _foreign_bed(db_session)
        db_session.add(DeviceBed(tenant_id=ward.tenant.id, source="192.0.2.11", group_address=group_of("192.0.2.11"),
                                 port=2050, device_bed_label="BED05", bed_label="BED05", bed_id=foreign.id,
                                 unit_id=unit.id, valid_from=FROM, approved_by="proje sahibi", approved_at=APPROVED))
        await db_session.commit()
        body = (await client.get(URL, headers=ward.auth["admin"])).json()
    shown = _by_source(body)["192.0.2.11"]
    assert shown["bed"] == {"id": str(foreign.id), "in_scope": False} and shown["editable"] is False


@pytest.mark.parametrize("who, status", [("nurse", 403), ("auditor", 403)])
async def test_a_caller_without_either_key_is_refused(db_session, who, status):
    async with esleme_client(db_session) as (client, _, ward):
        assert (await client.get(URL, headers=ward.auth[who])).status_code == status


async def test_a_device_token_is_not_a_person(db_session):
    async with esleme_client(db_session) as (client, _, _ward):
        assert (await client.get(URL, headers=BOARD)).status_code == 401


@pytest.mark.parametrize("options", [{"stage": "off"}, {"hospital": "baska-hastane"}])
async def test_the_list_answers_monitor_lane_off_unless_the_strip_runs_for_this_hospital(db_session, options):
    async with esleme_client(db_session, **options) as (client, _, ward):
        response = await client.get(URL, headers=ward.auth["admin"])
    assert response.status_code == 409 and response.json()["detail"]["code"] == "monitor_lane_off"


async def test_with_the_strip_off_the_lane_check_asks_the_database_nothing(db_session, monkeypatch):
    async def must_not_run(*_args, **_kwargs):
        raise AssertionError("hospital_of ran although the strip is off")

    async with esleme_client(db_session, stage="off") as (client, _, ward):
        monkeypatch.setattr(trail, "hospital_of", must_not_run)
        response = await client.get(URL, headers=ward.auth["admin"])
    assert response.status_code == 409 and response.json()["detail"]["code"] == "monitor_lane_off"


async def test_at_stage_rules_the_list_says_rules(db_session):
    async with esleme_client(db_session, stage="rules") as (client, _, ward):
        assert (await client.get(URL, headers=ward.auth["admin"])).json()["stage"] == "rules"


# --- Task 9: bind and unbind (spec §4.3-§4.5, §4.7) -----------------------------------------------------------

async def _rows(db, source):
    return (await db.execute(select(DeviceBed).where(DeviceBed.source == source)
                             .order_by(DeviceBed.id).execution_options(populate_existing=True))).scalars().all()


async def _open_rows(db, tenant_id):
    return (await db.execute(select(DeviceBed).where(DeviceBed.tenant_id == tenant_id, DeviceBed.valid_to.is_(None))
                             .order_by(DeviceBed.id).execution_options(populate_existing=True))).scalars().all()


def _bind(client, ward, who, source, bed_key, device_row=None, bed_row=None, **extra):
    return client.post(f"{URL}/bind", headers=ward.auth[who], json={
        "source": source, "bed_id": str(ward.beds[bed_key].id) if bed_key in ward.beds else bed_key,
        "expected": {"device_row_id": device_row, "bed_row_id": bed_row}, **extra})


def _unbind(client, ward, who, source, device_row, **extra):
    return client.post(f"{URL}/unbind", headers=ward.auth[who],
                       json={"source": source, "expected": {"device_row_id": device_row}, **extra})


def _row_id(response, source):
    """The `row_id` the answer's list gives `source` — what the screen would send as `expected`."""
    return _by_source(response.json()["list"])[source]["row_id"]


def _committed_bed_of(source):
    """The bed the DATABASE holds for `source` right now, read on a connection of its own (so only what
    has committed is visible)."""
    engine = create_engine(_sync_engine_url(TEST_DATABASE_URL))
    try:
        with engine.connect() as conn:
            return conn.execute(text("SELECT bed_id FROM device_beds WHERE source = :s AND valid_to IS NULL"),
                                {"s": source}).scalar_one_or_none()
    finally:
        engine.dispose()


def _spy_reset(app, observe=lambda: None):
    """Wrap `app.state.shadow_table_reset`: each call records what `observe()` sees at that moment."""
    seen, original = [], app.state.shadow_table_reset

    def reset():
        seen.append(observe())
        original()

    app.state.shadow_table_reset = reset
    return seen


async def test_a_new_monitor_is_bound_to_an_empty_bed_as_an_editor_row(db_session):
    async with esleme_client(db_session) as (client, app, ward):
        primed = (await client.get("/infinity-shadow/board", headers=BOARD)).json()   # the strip has read its table
        response = await _bind(client, ward, "admin", "192.0.2.13", "2")
        assert response.status_code == 200, response.text
        body = response.json()
        [row] = await _rows(db_session, "192.0.2.13")
        audit = app.state.audit.records(event_type="device_bed.bind")
        board = (await client.get("/infinity-shadow/board", headers=BOARD)).json()
    assert [c for c in primed["beds"] if c["bed_id"] == str(ward.beds["2"].id)] == []
    assert body["changed"] is True and body["replaced_source"] is None
    assert (row.bed_id, row.bed_label, row.unit_id) == (ward.beds["2"].id, "2", ward.units["rea"].id)
    assert (row.group_address, row.port, row.device_bed_label, row.note) == ("224.0.2.13", 2050, None, None)
    assert (row.method, row.verified_by, row.approved_by) == ("editor", ward.users["admin"].id, ward.users["admin"].username)
    assert datetime.fromisoformat(row.verified_at) == row.valid_from == row.approved_at and row.verified_at.endswith("+00:00")
    [entry] = [d for d in body["list"]["devices"] if d["source"] == "192.0.2.13"]
    assert entry["row_id"] == row.id and entry["bed"]["label"] == "2"
    [rec] = audit
    assert (rec.subject, rec.patient_id, rec.payload["old"], rec.payload["new"]["row_id"]) == ("192.0.2.13", "", None, row.id)
    assert rec.payload["actor"] == ward.users["admin"].username
    assert [c["source"] for c in board["beds"] if c["bed_id"] == str(ward.beds["2"].id)] == ["192.0.2.13"]


async def test_the_unit_of_the_new_row_is_the_beds_own_never_the_requests(db_session):
    async with esleme_client(db_session) as (client, _, ward):
        assert (await _bind(client, ward, "admin", "192.0.2.13", "N1")).status_code == 200
        [row] = await _rows(db_session, "192.0.2.13")
    assert (row.bed_id, row.unit_id, row.bed_label) == (ward.beds["N1"].id, ward.units["neo"].id, "N1")


async def test_a_bound_monitor_moves_closing_its_row_and_opening_one(db_session):
    async with esleme_client(db_session) as (client, app, ward):
        ids = await seed(db_session, ward, ("192.0.2.11", "1", "BED05"))
        assert (await _bind(client, ward, "admin", "192.0.2.11", "2", ids["192.0.2.11"])).status_code == 200
        old, new = await _rows(db_session, "192.0.2.11")
        [rec] = app.state.audit.records(event_type="device_bed.bind")
    assert old.valid_to == new.valid_from and new.valid_to is None
    assert (new.bed_id, new.bed_label, new.device_bed_label) == (ward.beds["2"].id, "2", "BED05")
    assert rec.payload["old"] == {"row_id": old.id, "bed_id": str(ward.beds["1"].id),
                                  "unit_id": str(ward.units["rea"].id), "bed_label": "BED05"}


async def test_a_monitor_only_a_row_holds_can_be_moved_and_keeps_its_group(db_session):
    """Not reported by the worker, yet in the table (D8): the group is the last row's."""
    async with esleme_client(db_session) as (client, _, ward):
        ids = await seed(db_session, ward, ("192.0.2.20", "3", "BED07"))
        response = await _bind(client, ward, "admin", "192.0.2.20", "2", ids["192.0.2.20"])
        _, new = await _rows(db_session, "192.0.2.20")
    assert response.status_code == 200
    assert (new.bed_id, new.group_address, new.device_bed_label) == (ward.beds["2"].id, "224.0.2.20", "BED07")


async def test_a_bed_with_a_monitor_takes_the_new_one_and_the_old_one_is_unbound(db_session):
    async with esleme_client(db_session) as (client, app, ward):
        ids = await seed(db_session, ward, ("192.0.2.11", "1", "BED05"), ("192.0.2.12", "2", "BED06"))
        response = await _bind(client, ward, "admin", "192.0.2.11", "2", ids["192.0.2.11"], ids["192.0.2.12"])
        displaced = await _rows(db_session, "192.0.2.12")
        current = await _open_rows(db_session, ward.tenant.id)
        binds = app.state.audit.records(event_type="device_bed.bind")
        unbinds = app.state.audit.records(event_type="device_bed.unbind")
    assert response.json()["replaced_source"] == "192.0.2.12"
    assert [(r.bed_id, r.valid_to is None) for r in displaced] == [(ward.beds["2"].id, False), (None, True)]
    assert displaced[1].device_bed_label == "BED06" and displaced[1].bed_label is None
    assert displaced[0].valid_to == displaced[1].valid_from
    on_bed_two = [r.source for r in current if r.bed_id == ward.beds["2"].id]
    assert on_bed_two == ["192.0.2.11"]                                  # a bed never has two monitors, not even after
    assert sorted(r.source for r in current) == ["192.0.2.11", "192.0.2.12"]    # one current row per source
    [rec] = unbinds
    assert (rec.subject, rec.payload["reason"], rec.payload["by_source"]) == ("192.0.2.12", "replaced", "192.0.2.11")
    assert [(r.subject, r.payload["replaced_source"]) for r in binds] == [("192.0.2.11", "192.0.2.12")]
    entries = _by_source(response.json()["list"])
    assert (entries["192.0.2.12"]["bed"], entries["192.0.2.11"]["bed"]["label"]) == (None, "2")


async def test_an_unbind_closes_a_bound_row_and_opens_an_unbound_one(db_session):
    async with esleme_client(db_session) as (client, app, ward):
        ids = await seed(db_session, ward, ("192.0.2.11", "1", "BED05"))
        assert (await _unbind(client, ward, "admin", "192.0.2.11", ids["192.0.2.11"])).status_code == 200
        rows = await _rows(db_session, "192.0.2.11")
        [rec] = app.state.audit.records(event_type="device_bed.unbind")
    assert [(r.bed_label, r.valid_to is None) for r in rows] == [("BED05", False), (None, True)]
    assert (rows[1].method, rows[1].bed_id, rows[1].unit_id, rows[1].device_bed_label) == ("editor", None, None, "BED05")
    assert rec.payload["reason"] == "unbound" and rec.payload["new"]["bed_label"] is None


async def test_an_unbind_of_a_label_only_v2_row_is_changed_false_and_writes_nothing(db_session):
    """A-22 M3: a v2 row with a central-station label and no Yapı bed (BED01) is an unbound device (spec §4.3), and
    the dashboard offers no unbind there (E23). The expected row id is not even looked at."""
    async with esleme_client(db_session) as (client, app, ward):
        ids = await seed(db_session, ward, ("192.0.2.11", None, "BED01"))
        resets = _spy_reset(app)
        right = await _unbind(client, ward, "admin", "192.0.2.11", ids["192.0.2.11"])
        stale = await _unbind(client, ward, "admin", "192.0.2.11", 999)
        rows = await _rows(db_session, "192.0.2.11")
    assert [(r.status_code, r.json()["changed"]) for r in (right, stale)] == [(200, False), (200, False)]
    assert [(r.bed_label, r.valid_to is None) for r in rows] == [("BED01", True)]
    assert app.state.audit.records() == [] and resets == []


async def test_asking_for_what_already_holds_changes_nothing_even_with_a_stale_expected(db_session):
    async with esleme_client(db_session) as (client, app, ward):
        await seed(db_session, ward, ("192.0.2.11", "1", "BED05"), ("192.0.2.12", None, None))
        resets = _spy_reset(app)
        again = await _bind(client, ward, "admin", "192.0.2.11", "1", 999, 999)
        unbound = await _unbind(client, ward, "admin", "192.0.2.12", 999)
        never_had_a_row = await _unbind(client, ward, "admin", "192.0.2.13", 999)
        assert len(await _rows(db_session, "192.0.2.11")) == 1
        assert await _rows(db_session, "192.0.2.13") == []
    assert (again.json()["changed"], unbound.json()["changed"], never_had_a_row.json()["changed"]) == (False, False, False)
    assert again.json()["replaced_source"] is None and "devices" in again.json()["list"]
    assert app.state.audit.records() == []
    assert resets == []                                                  # nothing changed: the strip's table stays


async def test_a_request_sent_again_after_its_answer_was_lost_answers_changed_false_not_mapping_changed(db_session):
    async with esleme_client(db_session) as (client, app, ward):
        ids = await seed(db_session, ward, ("192.0.2.11", "1", "BED05"))
        first = await _bind(client, ward, "admin", "192.0.2.11", "2", ids["192.0.2.11"])
        again = await _bind(client, ward, "admin", "192.0.2.11", "2", ids["192.0.2.11"])   # the same body, byte for byte
        now_bound = _row_id(first, "192.0.2.11")
        unbound = await _unbind(client, ward, "admin", "192.0.2.11", now_bound)
        unbound_again = await _unbind(client, ward, "admin", "192.0.2.11", now_bound)
        rows = await _rows(db_session, "192.0.2.11")
        audit = app.state.audit.records()
    assert [r.status_code for r in (first, again, unbound, unbound_again)] == [200, 200, 200, 200]
    assert [r.json()["changed"] for r in (first, again, unbound, unbound_again)] == [True, False, True, False]
    assert len(rows) == 3                                               # the old row, the bound row, the unbound row
    assert [r.event_type for r in audit] == ["device_bed.bind", "device_bed.unbind"]


def _before_the_locks(db, monkeypatch, action):
    """Between the transaction's reads without a lock (steps 2-4) and its locks (steps 5-6), a second session runs
    `await action(session)` and commits. Done by wrapping `service._lock_bed`, which the transaction calls in
    between — once, before the first real lock, so nothing the request holds can wait for the other writer.
    Returns a list that is non-empty once the other writer has run."""
    maker, done = async_sessionmaker(db.bind, expire_on_commit=False), []
    real = service._lock_bed

    async def lock_after_the_other_writer(session, bed_id):
        if not done:
            done.append(True)
            async with maker() as other:
                await action(other)
                await other.commit()
        return await real(session, bed_id)

    monkeypatch.setattr(service, "_lock_bed", lock_after_the_other_writer)
    return done


async def _another_writer(db, ward, monkeypatch, source, bed_key, *, reopen=True):
    """The other writer closes `source`'s current row and, if `reopen`, opens one on `bed_key` (None: unbound)."""
    async def move(other):
        current = (await current_rows(other, ward.tenant.id, sources=[source]))[source]
        t = await db_time(other)
        current.valid_to = t
        await other.flush()
        if reopen:
            bed = ward.beds[bed_key] if bed_key else None
            other.add(editor_row(ward.tenant.id, source, current.group_address, 2050, current.device_bed_label,
                                 bed.label if bed else None, bed.id if bed else None,
                                 ward.units[UNIT_OF[bed_key]].id if bed else None, t, ward.users["admin"]))

    return _before_the_locks(db, monkeypatch, move)


async def test_two_identical_binds_in_flight_the_second_answers_changed_false_not_mapping_changed(db_session, monkeypatch):
    """A-22 M1, spec §4.4 step 6: the request asking for what already holds is answered `changed:false` BEFORE the
    'it moved between steps 4 and 6' comparison. Here the same bind commits between this one's read and its locks."""
    async with esleme_client(db_session) as (client, app, ward):
        ids = await seed(db_session, ward, ("192.0.2.11", "1", "BED05"))
        resets, audit = _spy_reset(app), app.state.audit
        done = await _another_writer(db_session, ward, monkeypatch, "192.0.2.11", "2")
        response = await _bind(client, ward, "admin", "192.0.2.11", "2", ids["192.0.2.11"])
        rows = await _rows(db_session, "192.0.2.11")
    assert done and (response.status_code, response.json()["changed"]) == (200, False)
    assert [(r.bed_id, r.valid_to is None) for r in rows] == [(ward.beds["1"].id, False), (ward.beds["2"].id, True)]
    assert audit.records() == [] and resets == []                          # this request wrote and announced nothing


async def test_two_identical_unbinds_in_flight_the_second_answers_changed_false_not_mapping_changed(db_session, monkeypatch):
    async with esleme_client(db_session) as (client, app, ward):
        ids = await seed(db_session, ward, ("192.0.2.11", "1", "BED05"))
        done = await _another_writer(db_session, ward, monkeypatch, "192.0.2.11", None)
        response = await _unbind(client, ward, "admin", "192.0.2.11", ids["192.0.2.11"])
        rows = await _rows(db_session, "192.0.2.11")
    assert done and (response.status_code, response.json()["changed"]) == (200, False)
    assert [(r.bed_id, r.valid_to is None) for r in rows] == [(ward.beds["1"].id, False), (None, True)]
    assert app.state.audit.records() == []


async def test_a_device_that_moved_to_a_third_bed_between_the_read_and_the_locks_is_mapping_changed(db_session, monkeypatch):
    """A-22 M4: the 'it moved between steps 4 and 6' branch. The request wants bed 2; the device meanwhile went to
    bed 3 — not what was asked, not what the screen saw: 409, and the other writer's row is untouched."""
    async with esleme_client(db_session) as (client, app, ward):
        ids = await seed(db_session, ward, ("192.0.2.11", "1", "BED05"))
        resets = _spy_reset(app)
        done = await _another_writer(db_session, ward, monkeypatch, "192.0.2.11", "3")
        response = await _bind(client, ward, "admin", "192.0.2.11", "2", ids["192.0.2.11"])
        rows = await _rows(db_session, "192.0.2.11")
    assert done and (response.status_code, response.json()["detail"]["code"]) == (409, "mapping_changed")
    assert [(r.bed_id, r.valid_to is None) for r in rows] == [(ward.beds["1"].id, False), (ward.beds["3"].id, True)]
    assert app.state.audit.records() == [] and resets == []


async def test_a_row_only_monitor_whose_row_vanished_under_the_locks_is_mapping_changed_not_an_error(db_session, monkeypatch):
    """A-22 M4, E33: the worker does not report the device and its only row was closed (with none opened) between
    the read and the locks — nothing is left to take a group from. The request is sent as by a client that saw NO
    row (`expected` null, null), so that the `expected` comparison passes and it is the E33 guard alone that
    refuses: with a real row id in `expected` that comparison answered 409 first and the guard never ran."""
    async with esleme_client(db_session) as (client, app, ward):
        await seed(db_session, ward, ("192.0.2.20", None, None))
        resets = _spy_reset(app)
        done = await _another_writer(db_session, ward, monkeypatch, "192.0.2.20", None, reopen=False)
        response = await _bind(client, ward, "admin", "192.0.2.20", "2", None, None)
        rows = await _rows(db_session, "192.0.2.20")
    assert done and (response.status_code, response.json()["detail"]["code"]) == (409, "mapping_changed")
    assert [r.valid_to is None for r in rows] == [False] and app.state.audit.records() == [] and resets == []


async def test_a_bed_closed_between_the_read_and_the_locks_is_bed_closed_and_nothing_is_written(db_session, monkeypatch):
    """Spec §4.4 step 6: the target bed's (and its room's and unit's) `is_active` is read again under the bed lock —
    step 3 read it before any lock, and a close may have committed since."""
    async with esleme_client(db_session) as (client, app, ward):
        resets = _spy_reset(app)

        async def close_the_bed(other):
            (await other.get(Bed, ward.beds["2"].id)).is_active = False

        done = _before_the_locks(db_session, monkeypatch, close_the_bed)
        response = await _bind(client, ward, "admin", "192.0.2.13", "2")
        rows = await _rows(db_session, "192.0.2.13")
    assert done and (response.status_code, response.json()["detail"]["code"]) == (409, "bed_closed")
    assert rows == [] and app.state.audit.records() == [] and resets == []


async def test_a_stale_expected_is_mapping_changed_and_writes_nothing(db_session):
    async with esleme_client(db_session) as (client, app, ward):
        ids = await seed(db_session, ward, ("192.0.2.11", "1", "BED05"), ("192.0.2.12", "2", "BED06"))
        resets = _spy_reset(app)
        stale_device = await _bind(client, ward, "admin", "192.0.2.11", "2", None, ids["192.0.2.12"])
        stale_bed = await _bind(client, ward, "admin", "192.0.2.11", "2", ids["192.0.2.11"], None)
        wrong_bed_row = await _bind(client, ward, "admin", "192.0.2.11", "2", ids["192.0.2.11"], ids["192.0.2.11"])
        stale_unbind = await _unbind(client, ward, "admin", "192.0.2.11", ids["192.0.2.12"])
        current = await _open_rows(db_session, ward.tenant.id)
    for response in (stale_device, stale_bed, wrong_bed_row, stale_unbind):
        assert response.status_code == 409 and response.json()["detail"]["code"] == "mapping_changed"
    assert [(r.source, r.bed_id) for r in current] == [("192.0.2.11", ward.beds["1"].id), ("192.0.2.12", ward.beds["2"].id)]
    assert app.state.audit.records() == [] and resets == []


async def test_the_refusals_carry_their_codes(db_session):
    async with esleme_client(db_session) as (client, _, ward):
        ward.beds["10"].is_active = False
        await db_session.commit()
        unknown = await _bind(client, ward, "admin", "192.0.2.99", "2")
        multicast = await _bind(client, ward, "admin", "224.0.2.13", "2")
        closed = await _bind(client, ward, "admin", "192.0.2.13", "10")
        missing = await _bind(client, ward, "admin", "192.0.2.13", str(uuid.uuid4()))
        extra = await _bind(client, ward, "admin", "192.0.2.13", "2", surplus=True)
        not_text = await client.post(f"{URL}/unbind", headers=ward.auth["admin"],
                                     json={"source": 7, "expected": {"device_row_id": None}})
    assert (unknown.status_code, unknown.json()["detail"]["code"]) == (404, "device_unknown")
    assert (multicast.status_code, multicast.json()["detail"]["code"]) == (422, "field_invalid:source")
    assert (closed.status_code, closed.json()["detail"]["code"]) == (409, "bed_closed")
    assert missing.status_code == 404 and extra.status_code == 422 and not_text.status_code == 422


async def test_a_displaced_monitor_that_the_worker_reports_takes_the_workers_group_for_its_new_row(db_session):
    """A-22 M7, spec §5.3: the group of ANY row the editor opens is the worker's when it reports the device."""
    async with esleme_client(db_session, device_groups={"192.0.2.12": "224.0.2.99"}) as (client, app, ward):
        ids = await seed(db_session, ward, ("192.0.2.11", "1", "BED05"), ("192.0.2.12", "2", "BED06"))   # its row: .12
        assert (await _bind(client, ward, "admin", "192.0.2.11", "2", ids["192.0.2.11"], ids["192.0.2.12"])).status_code == 200
        _, unbound = await _rows(db_session, "192.0.2.12")
        [_, bound] = await _rows(db_session, "192.0.2.11")
    assert (unbound.bed_id, unbound.group_address) == (None, "224.0.2.99")
    assert bound.group_address == "224.0.2.11"


async def test_a_displaced_monitor_the_worker_does_not_report_keeps_its_own_rows_group(db_session):
    async with esleme_client(db_session) as (client, _, ward):
        ids = await seed(db_session, ward, ("192.0.2.11", "1", "BED05"), ("192.0.2.20", "3", "BED07"))
        assert (await _bind(client, ward, "admin", "192.0.2.11", "3", ids["192.0.2.11"], ids["192.0.2.20"])).status_code == 200
        _, unbound = await _rows(db_session, "192.0.2.20")
    assert (unbound.bed_id, unbound.group_address, unbound.device_bed_label) == (None, "224.0.2.20", "BED07")


@pytest.mark.parametrize("closing", ["room", "unit"])
async def test_a_bed_whose_room_or_unit_is_closed_is_bed_closed(db_session, closing):
    async with esleme_client(db_session) as (client, _, ward):
        (ward.rooms["o2"] if closing == "room" else ward.units["rea"]).is_active = False
        await db_session.commit()
        response = await _bind(client, ward, "admin", "192.0.2.13", "3")
        assert await _rows(db_session, "192.0.2.13") == []
    assert (response.status_code, response.json()["detail"]["code"]) == (409, "bed_closed")


async def test_a_bed_of_another_hospital_is_the_same_404_as_a_bed_that_does_not_exist(db_session):
    """A-8: a bed has no tenant_id; the tenant is proved through room, unit and site. The refusal never
    confirms that the id exists elsewhere, and nothing is written."""
    async with esleme_client(db_session) as (client, app, ward):
        _, _, foreign = await _foreign_bed(db_session)
        await db_session.commit()
        elsewhere = await _bind(client, ward, "admin", "192.0.2.13", str(foreign.id))
        nowhere = await _bind(client, ward, "admin", "192.0.2.13", str(uuid.uuid4()))
        rows = await _rows(db_session, "192.0.2.13")
    assert elsewhere.status_code == nowhere.status_code == 404
    assert elsewhere.json() == nowhere.json() == {"detail": "Bed not found"}
    assert rows == [] and app.state.audit.records() == []


async def test_another_hospitals_row_for_the_same_address_is_neither_read_nor_closed(db_session):
    async with esleme_client(db_session) as (client, _, ward):
        other, unit, foreign = await _foreign_bed(db_session)
        theirs = DeviceBed(tenant_id=other.id, source="192.0.2.13", group_address="224.0.2.13", port=2050,
                           device_bed_label="BEDX", bed_label="X1", bed_id=foreign.id, unit_id=unit.id,
                           valid_from=FROM, approved_by="proje sahibi", approved_at=APPROVED)
        db_session.add(theirs)
        await db_session.commit()
        response = await _bind(client, ward, "admin", "192.0.2.13", "2")          # we have no row for it: expected null
        [ours] = [r for r in await _rows(db_session, "192.0.2.13") if r.tenant_id == ward.tenant.id]
        await db_session.refresh(theirs)
    assert response.status_code == 200 and ours.bed_id == ward.beds["2"].id
    assert (theirs.valid_to, theirs.bed_id) == (None, foreign.id)


async def test_a_charge_nurse_acts_only_in_her_units(db_session):
    async with esleme_client(db_session) as (client, _, ward):
        ids = await seed(db_session, ward, ("192.0.2.11", "N1", "BEDN1"))
        into_neo = await _bind(client, ward, "charge", "192.0.2.13", "N1", None, ids["192.0.2.11"])   # expected as it holds
        out_of_neo = await _bind(client, ward, "charge", "192.0.2.11", "2", ids["192.0.2.11"])
        unbind_neo = await _unbind(client, ward, "charge", "192.0.2.11", ids["192.0.2.11"])
        own = await _bind(client, ward, "charge", "192.0.2.13", "2")
    for response in (into_neo, out_of_neo, unbind_neo):
        assert response.status_code == 403 and response.json()["detail"]["code"] == "out_of_scope"
    assert own.status_code == 200


@pytest.mark.parametrize("who", ["nurse", "bio"])
async def test_without_the_key_nobody_writes(db_session, who):
    async with esleme_client(db_session) as (client, _, ward):
        assert (await _bind(client, ward, who, "192.0.2.13", "2")).status_code == 403
        assert (await _unbind(client, ward, who, "192.0.2.13", None)).status_code == 403


async def test_a_device_token_is_not_a_person_on_the_writes_either(db_session):
    async with esleme_client(db_session) as (client, _, ward):
        denied = await client.post(f"{URL}/bind", headers=BOARD, json={
            "source": "192.0.2.13", "bed_id": str(ward.beds["2"].id), "expected": {"device_row_id": None, "bed_row_id": None}})
    assert denied.status_code == 401


@pytest.mark.parametrize("options", [{"stage": "off"}, {"hospital": "baska-hastane"}])
async def test_the_writes_answer_monitor_lane_off_unless_the_strip_runs_for_this_hospital(db_session, options):
    async with esleme_client(db_session, **options) as (client, _, ward):
        bound = await _bind(client, ward, "admin", "192.0.2.13", "2")
        unbound = await _unbind(client, ward, "admin", "192.0.2.13", None)
        assert await _rows(db_session, "192.0.2.13") == []
    for response in (bound, unbound):
        assert response.status_code == 409 and response.json()["detail"]["code"] == "monitor_lane_off"


async def test_the_bodies_are_closed_a_unit_in_the_request_is_refused_not_dropped(db_session):
    """A-8: the bind path takes the unit from the bed's own room, so the body has no place for one. `extra="forbid"`
    makes a client that sends one hear about it (422) instead of a value silently ignored."""
    ok = {"source": "192.0.2.13", "bed_id": str(uuid.uuid4()), "expected": {"device_row_id": None, "bed_row_id": None}}
    BindBody.model_validate(ok)
    for body, model in ((ok | {"unit_id": str(uuid.uuid4())}, BindBody),
                        (ok | {"expected": {"device_row_id": None, "bed_row_id": None, "unit_id": "x"}}, BindBody),
                        ({"source": "192.0.2.13", "expected": {"device_row_id": None}, "bed_id": ok["bed_id"]}, UnbindBody),
                        ({k: v for k, v in ok.items() if k != "expected"}, BindBody),
                        (ok | {"expected": {"device_row_id": None}}, BindBody)):         # both expected keys are required
        with pytest.raises(ValidationError):
            model.model_validate(body)
    async with esleme_client(db_session) as (client, app, ward):
        sent = await _bind(client, ward, "admin", "192.0.2.13", "2", unit_id=str(ward.units["neo"].id))
        assert await _rows(db_session, "192.0.2.13") == []
    assert sent.status_code == 422 and app.state.audit.records() == []


@pytest.mark.parametrize("confirm", [1, 0, "yes", "true", "false", None, [], {}])
async def test_confirm_occupied_is_a_real_boolean_nothing_else_confirms_a_patients_bed(db_session, confirm):
    """A-22 M5: the second confirmation is the one that lets a monitor be moved off or onto an admitted patient's
    bed; `1` and `"yes"` are not it. Pydantic's lax bool would take both."""
    ok = {"source": "192.0.2.13", "bed_id": str(uuid.uuid4()), "expected": {"device_row_id": None, "bed_row_id": None}}
    for model, body in ((BindBody, ok), (UnbindBody, {"source": "192.0.2.13", "expected": {"device_row_id": None}})):
        for allowed in (True, False):
            assert model.model_validate(body | {"confirm_occupied": allowed}).confirm_occupied is allowed
        assert model.model_validate(body).confirm_occupied is False
        with pytest.raises(ValidationError):
            model.model_validate(body | {"confirm_occupied": confirm})
    async with esleme_client(db_session) as (client, app, ward):
        bound = await _bind(client, ward, "admin", "192.0.2.13", "2", confirm_occupied=confirm)
        unbound = await _unbind(client, ward, "admin", "192.0.2.13", None, confirm_occupied=confirm)
        assert await _rows(db_session, "192.0.2.13") == []
    assert (bound.status_code, unbound.status_code) == (422, 422) and app.state.audit.records() == []


def _fake_error(*, constraint=None, via="cause", sqlstate=None, pgcode=None):
    """An IntegrityError whose `orig` carries what a driver's does: a SQLSTATE under either name (`sqlstate`,
    `pgcode`), and the constraint's name on the exception's `__cause__` (asyncpg, behind SQLAlchemy's adapter), on
    psycopg2's `diag`, or on the exception itself."""
    from types import SimpleNamespace

    from sqlalchemy.exc import IntegrityError
    orig = SimpleNamespace()
    if sqlstate:
        orig.sqlstate = sqlstate
    if pgcode:
        orig.pgcode = pgcode
    if constraint and via == "cause":
        orig.__cause__ = SimpleNamespace(constraint_name=constraint)
    elif constraint and via == "diag":
        orig.diag = SimpleNamespace(constraint_name=constraint)
    elif constraint:
        orig.constraint_name = constraint
    return IntegrityError("INSERT", {}, orig)


@pytest.mark.parametrize("error, retry", [
    (_fake_error(sqlstate="23505", constraint="uq_device_beds_current_source"), True),
    (_fake_error(sqlstate="23505", constraint="uq_device_beds_current_bed"), True),
    (_fake_error(pgcode="23505", constraint="uq_device_beds_current_bed", via="diag"), True),
    (_fake_error(pgcode="23505", constraint="uq_device_beds_current_source", via="self"), True),
    (_fake_error(sqlstate="23505", constraint="uq_bed_label_per_room"), False),     # a unique violation, but not ours
    (_fake_error(sqlstate="23505"), False),                          # only a SQLSTATE: cannot be proved ours
    (_fake_error(pgcode="23505"), False),
    (_fake_error(), False),                                          # a driver that says nothing at all
    (_fake_error(sqlstate="23514", constraint="ck_device_beds_interval"), False),
    (_fake_error(sqlstate="23503", constraint="device_beds_bed_id_fkey"), False),
    (_fake_error(sqlstate="40P01"), False),
    (_fake_error(constraint="uq_device_beds_current_source"), False),   # a name with no 23505 beside it
])
def test_only_our_two_current_row_indexes_firing_is_a_retry_everything_else_is_loud(error, retry):
    """A-22 M2 (spec §4.4 step 9): `mapping_changed` is for the two partial unique indexes, by their names. Any other
    unique violation, a CHECK (the interval), a foreign key, or a driver that does not name the constraint is a bug
    or an unknown: it stays an error (a 500), never a refusal the screen would tell the user to repeat."""
    assert service._current_row_index_fired(error) is retry


@pytest.mark.parametrize("case, retry", [("source", True), ("bed", True), ("label", False)])
async def test_the_real_asyncpg_unique_violation_names_its_constraint_where_the_helper_reads_it(db_session, case, retry):
    """The attribute path is checked on REAL errors, not on fakes: a duplicate current row for one device, a second
    current row on one bed, and a unique violation that is not ours (two beds of one room with one label)."""
    from sqlalchemy.exc import IntegrityError
    ward = await build_ward(db_session)
    row = dict(tenant_id=ward.tenant.id, group_address="224.0.2.11", port=2050, valid_from=FROM,
               approved_by="proje sahibi", approved_at=APPROVED)
    bed, unit = ward.beds["1"], ward.units["rea"]
    if case == "source":
        db_session.add_all([DeviceBed(source="192.0.2.11", **row), DeviceBed(source="192.0.2.11", **row)])
    elif case == "bed":
        bound = dict(row, bed_label="1", bed_id=bed.id, unit_id=unit.id)
        db_session.add_all([DeviceBed(source="192.0.2.11", **bound), DeviceBed(source="192.0.2.12", **bound)])
    else:
        db_session.add(Bed(room_id=bed.room_id, label=bed.label))
    with pytest.raises(IntegrityError) as caught:
        await db_session.flush()
    await db_session.rollback()
    assert service._current_row_index_fired(caught.value) is retry
    assert caught.value.orig.__cause__.sqlstate == "23505"             # the path the helper walks, on the real thing


async def test_the_strips_table_is_reset_once_the_change_has_committed_and_only_then(db_session):
    """Spec §4.4 step 11: `shadow_table_reset` runs after the commit (the reset sees the new row on a
    connection of its own), once per change — a replace is one change — and not for a refusal."""
    async with esleme_client(db_session) as (client, app, ward):
        ids = await seed(db_session, ward, ("192.0.2.11", "1", "BED05"), ("192.0.2.12", "2", "BED06"))
        resets = _spy_reset(app, lambda: _committed_bed_of("192.0.2.11"))
        refused = await _bind(client, ward, "admin", "192.0.2.11", "2", None, None)
        assert resets == []
        moved = await _bind(client, ward, "admin", "192.0.2.11", "2", ids["192.0.2.11"], ids["192.0.2.12"])
    assert (refused.status_code, moved.status_code) == (409, 200)
    assert [str(bed) for bed in resets] == [str(ward.beds["2"].id)]


async def test_a_change_shows_on_the_strip_at_once_not_after_the_tables_ten_seconds(db_session):
    async with esleme_client(db_session) as (client, app, ward):
        ids = await seed(db_session, ward, ("192.0.2.11", "1", "BED05"))
        app.state.shadow_table_reset()          # the app read its (empty) table at start-up, before the rows existed
        before = (await client.get("/infinity-shadow/board", headers=BOARD)).json()       # primes the table's cache
        moved = await _bind(client, ward, "admin", "192.0.2.11", "2", ids["192.0.2.11"])
        after = (await client.get("/infinity-shadow/board", headers=BOARD)).json()
        await _unbind(client, ward, "admin", "192.0.2.11", _row_id(moved, "192.0.2.11"))
        gone = (await client.get("/infinity-shadow/board", headers=BOARD)).json()

    def beds_of(board, source):
        return [c["bed_id"] for c in board["beds"] if c["source"] == source]

    assert beds_of(before, "192.0.2.11") == [str(ward.beds["1"].id)]
    assert beds_of(after, "192.0.2.11") == [str(ward.beds["2"].id)]
    assert beds_of(gone, "192.0.2.11") == []


@pytest.mark.parametrize("fails", [False, True])
async def test_the_test_world_closes_the_pool_of_the_table_it_opens_even_when_the_test_fails(db_session, monkeypatch, fails):
    """A-22 I1: each `esleme_client` opens a sync engine (`PostgresDeviceBeds`); left undisposed it held one
    connection per test, 42 after 60 tests, against max_connections=100 on a database shared with Lane A."""
    disposed, original = [], PostgresDeviceBeds.dispose

    def dispose(self):
        disposed.append(type(self).__name__)
        original(self)

    monkeypatch.setattr(PostgresDeviceBeds, "dispose", dispose)
    try:
        async with esleme_client(db_session) as (client, _, ward):
            await client.get(URL, headers=ward.auth["admin"])        # the table is read: a connection is checked out
            if fails:
                raise RuntimeError("the test failed")
    except RuntimeError:
        assert fails
    assert disposed == ["PostgresDeviceBeds"]


# --- A-12: the writes against the real triggers (the migrated chain) ----------------------------------------

def test_bind_move_replace_and_unbind_commit_on_the_migrated_chain_and_the_history_stays_kept(clean_db):
    """The `db_session` schema comes from `create_all`, so 0014's three triggers are absent there. Here the schema
    is built by `alembic upgrade head`: every write of the editor (a first bind = an insert; a move = a close and an
    insert; a replace = two closes and two inserts; an unbind) must commit through the history trigger, and what the
    trigger forbids — a close in the future, an edit of a closed row — must still raise."""
    engine, cfg = clean_db
    command.upgrade(cfg, "head")

    async def scenario():
        aengine = create_async_engine(TEST_DATABASE_URL)
        try:
            async with async_sessionmaker(aengine, expire_on_commit=False)() as db:
                async with esleme_client(db) as (client, app, ward):
                    ids = await seed(db, ward, ("192.0.2.11", "1", "BED05"), ("192.0.2.12", "2", "BED06"))
                    first = await _bind(client, ward, "admin", "192.0.2.13", "3")                        # insert
                    move = await _bind(client, ward, "admin", "192.0.2.11", "10", ids["192.0.2.11"])     # close + insert
                    replace = await _bind(client, ward, "admin", "192.0.2.13", "2",
                                          _row_id(first, "192.0.2.13"), ids["192.0.2.12"])                  # 2 closes + 2 inserts
                    unbind = await _unbind(client, ward, "admin", "192.0.2.11", _row_id(move, "192.0.2.11"))   # close + insert
                    answers = (first, move, replace, unbind)
                    return [r.status_code for r in answers], [r.json()["changed"] for r in answers]
        finally:
            await aengine.dispose()

    statuses, changed = asyncio.run(scenario())

    assert statuses == [200, 200, 200, 200] and changed == [True] * 4
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'device_beds_%'")).scalar_one() == 3
        # inserts only (a close is an UPDATE): 2 seeded + 1 first + 1 move + 2 replace + 1 unbind
        assert conn.execute(text("SELECT count(*) FROM device_beds")).scalar_one() == 7
        assert conn.execute(text("SELECT count(*) FROM device_beds WHERE valid_to IS NULL")).scalar_one() == 3
        assert conn.execute(text("SELECT count(DISTINCT source) FROM device_beds WHERE valid_to IS NULL")).scalar_one() == 3
        assert conn.execute(text("SELECT count(*) FROM device_beds WHERE method = 'editor' AND verified_by IS NOT NULL "
                                 "AND approved_at = valid_from")).scalar_one() == 5
        assert conn.execute(text("SELECT count(*) FROM device_beds WHERE bed_id IS NOT NULL AND valid_to IS NULL")).scalar_one() == 1
        open_id = conn.execute(text("SELECT id FROM device_beds WHERE valid_to IS NULL ORDER BY id LIMIT 1")).scalar_one()
        closed_id = conn.execute(text("SELECT id FROM device_beds WHERE valid_to IS NOT NULL ORDER BY id LIMIT 1")).scalar_one()
    kept = "keeps its history"
    with pytest.raises(DBAPIError, match=kept), engine.begin() as conn:                    # a close at t + 1 h
        conn.execute(text("UPDATE device_beds SET valid_to = clock_timestamp() + interval '1 hour' WHERE id = :i"), {"i": open_id})
    with pytest.raises(DBAPIError, match=kept), engine.begin() as conn:                    # an edit of a closed row
        conn.execute(text("UPDATE device_beds SET bed_label = 'x' WHERE id = :i"), {"i": closed_id})
    with pytest.raises(DBAPIError, match=kept), engine.begin() as conn:                    # a delete
        conn.execute(text("DELETE FROM device_beds WHERE id = :i"), {"i": closed_id})

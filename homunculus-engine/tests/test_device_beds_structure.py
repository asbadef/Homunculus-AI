# homunculus-engine/tests/test_device_beds_structure.py
"""Yapı and the mapping (spec D18, O3, O7): a rename of a bound bed relabels its current row in the
same transaction and the strip follows; a bed with a monitor is not closed (`bed_has_monitor`); the
structure opens to `devices.map_beds`. The hooks run whatever the lane's stage, take the bed lock the way
bind does (A-22 race h, both directions) and commit through 0014's real triggers (A-12). Synthetic ward."""
from __future__ import annotations

import asyncio
import importlib

import pytest
from alembic import command
from sqlalchemy import create_engine, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from homunculus.auth.models import Group, GroupPermission
from homunculus.devicebeds.models import DeviceBed
from homunculus.tenant import router as tenant_router
from tests.conftest import TEST_DATABASE_URL, _sync_engine_url, requires_db
from tests.esleme_world import URL, esleme_client, seed
from tests.kabul_world import BOARD
from tests.signed_in import add_user, bearer

pytestmark = [requires_db]
KEPT = "keeps its history"
SERVICE, WRITES = "homunculus.devicebeds.service", "homunculus.devicebeds.writes"   # resolved late: red before Task 12 is a test's, not the file's


def _patch(client, ward, bed_key, **body):
    return client.patch(f"/tenant/beds/{ward.beds[bed_key].id}", headers=ward.auth["admin"], json=body)


def _bind(client, ward, source, bed_key, device_row=None, bed_row=None):
    return client.post(f"{URL}/bind", headers=ward.auth["admin"], json={
        "source": source, "bed_id": str(ward.beds[bed_key].id),
        "expected": {"device_row_id": device_row, "bed_row_id": bed_row}})


async def _rows(db, source=None):
    q = select(DeviceBed).order_by(DeviceBed.id).execution_options(populate_existing=True)
    return (await db.execute(q if source is None else q.where(DeviceBed.source == source))).scalars().all()


def _committed_label_of(source):
    """The label of the row the DATABASE holds open for `source` right now, read on a connection of its own (so only
    what has committed is visible)."""
    engine = create_engine(_sync_engine_url(TEST_DATABASE_URL))
    try:
        with engine.connect() as conn:
            return conn.execute(text("SELECT bed_label FROM device_beds WHERE source = :s AND valid_to IS NULL"),
                                {"s": source}).scalar_one_or_none()
    finally:
        engine.dispose()


def _spy_reset(app, observe=lambda: True):
    """Wrap `app.state.shadow_table_reset`: each call records what `observe()` sees at that moment."""
    calls, original = [], app.state.shadow_table_reset

    def reset():
        calls.append(observe())
        original()

    app.state.shadow_table_reset = reset
    return calls


async def test_renaming_a_bound_bed_relabels_its_row_and_the_strip_follows(db_session):
    async with esleme_client(db_session) as (client, app, ward):
        await seed(db_session, ward, ("192.0.2.11", "1", "BED05"))
        response = await _patch(client, ward, "1", label="Yatak 1")
        old, new = await _rows(db_session, "192.0.2.11")
        board = (await client.get("/infinity-shadow/board", headers=BOARD)).json()
        [rec] = app.state.audit.records(event_type="device_bed.relabel")
        renames = app.state.audit.records(event_type="structure.rename")
    assert response.status_code == 200
    assert old.valid_to == new.valid_from and new.valid_to is None
    assert (new.bed_id, new.bed_label, new.device_bed_label, new.method) == (ward.beds["1"].id, "Yatak 1", "BED05", "editor")
    assert new.verified_by == ward.users["admin"].id
    assert (new.unit_id, new.group_address, new.port) == (old.unit_id, old.group_address, old.port)
    assert (new.approved_by, new.approved_at, new.verified_at) == (
        ward.users["admin"].username, new.valid_from, new.valid_from.isoformat())
    assert rec.payload["old"] == {"row_id": old.id, "bed_label": "BED05"}
    assert rec.payload["new"] == {"row_id": new.id, "bed_label": "Yatak 1"} and rec.patient_id == ""
    assert (rec.subject, rec.payload["source"], rec.payload["bed_id"], rec.payload["unit_id"], rec.payload["actor"]) == (
        "192.0.2.11", "192.0.2.11", str(ward.beds["1"].id), str(ward.units["rea"].id), ward.users["admin"].username)
    assert (rec.payload["group"], rec.payload["device_bed_label"]) == (old.group_address, "BED05")     # as bind names them
    assert len(renames) == 1
    assert [c["bed_label"] for c in board["beds"] if c["source"] == "192.0.2.11"] == ["Yatak 1"]


async def test_the_relabel_resets_the_strips_table_once_and_after_the_commit(db_session):
    async with esleme_client(db_session) as (client, app, ward):
        await seed(db_session, ward, ("192.0.2.11", "1", "BED05"))
        resets = _spy_reset(app, lambda: _committed_label_of("192.0.2.11"))
        refused = await _patch(client, ward, "1", label="2")                      # bed 2's label: nothing written
        assert (refused.status_code, resets) == (409, [])
        unbound = await _patch(client, ward, "2", label="Yatak 2")                # no monitor: nothing to follow
        assert (unbound.status_code, resets) == (200, [])
        renamed = await _patch(client, ward, "1", label="Yatak 1")
    assert (renamed.status_code, resets) == (200, ["Yatak 1"])                    # the commit had happened when it ran


async def test_a_rename_writes_no_mapping_row_for_an_unbound_bed_or_an_unchanged_label(db_session):
    async with esleme_client(db_session) as (client, app, ward):
        await seed(db_session, ward, ("192.0.2.11", "1", "5"), ("192.0.2.12", None, "BED01"))
        assert (await _patch(client, ward, "2", label="Yatak 2")).status_code == 200    # no monitor
        assert (await _patch(client, ward, "1", label="5")).status_code == 200          # the row says "5" already
        assert (await _patch(client, ward, "1", is_active=True)).status_code == 200     # no rename at all
        assert len(await _rows(db_session)) == 2                                        # the label-only row is no bed's
        assert app.state.audit.records(event_type="device_bed.relabel") == []


async def test_a_refused_rename_writes_no_mapping_row(db_session):
    async with esleme_client(db_session) as (client, app, ward):
        await seed(db_session, ward, ("192.0.2.11", "1", "BED05"))
        response = await _patch(client, ward, "1", label="2")                          # bed 2's label
        assert response.json()["detail"]["code"] == "bed_label_taken"
        assert len(await _rows(db_session)) == 1
        assert app.state.audit.records(event_type="device_bed.relabel") == []


async def test_a_rename_against_a_v2_label_is_a_no_op_an_alignment_or_a_relabel(db_session):
    """O60 / A-26 as built: the VM's v2 rows say «BED05» where Yapı says «bed05», and the strip shows the ROW's label.
    (i) A PATCH that leaves Yapı's label alone never touches the row; (ii) a rename to the row's own label («BED05») is
    a Yapı rename only - the way to align a bed before the live try; (iii) any other rename, «bed05» included, closes
    the v2 row and opens an editor row (version + 1, a new sha, the strip follows). Pins the gate `label != bed.label`
    and the row's own comparison in `relabel_bed`."""
    async with esleme_client(db_session) as (client, app, ward):
        ward.beds["1"].label = "bed05"                                      # Yapı's label, set as a fixture (no audit)
        await db_session.commit()
        ids = await seed(db_session, ward, ("192.0.2.11", "1", "BED05"))
        real_reset = app.state.shadow_table_reset
        resets = _spy_reset(app)

        async def strip():
            """(version, sha, the strip's label of the monitor), the table read afresh - not through the spied reset."""
            real_reset()
            board = (await client.get("/infinity-shadow/board", headers=BOARD)).json()
            return (board["table"]["version"], board["table"]["sha256"],
                    [c["bed_label"] for c in board["beds"] if c["source"] == "192.0.2.11"])

        version, sha, shown = await strip()
        assert (version, shown) == (ids["192.0.2.11"], ["BED05"])           # the row's label, not Yapı's

        # (i) Yapı's label stays: `is_active` alone, and the same label (trimmed by BedPatch)
        for body in ({"is_active": True}, {"label": "bed05"}, {"label": " bed05 "}):
            assert (await _patch(client, ward, "1", **body)).status_code == 200
        assert (len(await _rows(db_session)), resets, await strip()) == (1, [], (version, sha, ["BED05"]))
        assert app.state.audit.records() == []                              # not even a structure.rename

        # (ii) a rename to the row's own label: Yapı renames, the mapping does not move
        assert (await _patch(client, ward, "1", label="BED05")).status_code == 200
        assert (len(await _rows(db_session)), resets, await strip()) == (1, [], (version, sha, ["BED05"]))
        assert [r.event_type for r in app.state.audit.records()] == ["structure.rename"]

        # (iii) any other label closes the v2 row and opens an editor row
        assert (await _patch(client, ward, "1", label="Yatak 5")).status_code == 200
        old, new = await _rows(db_session, "192.0.2.11")
        version_after, sha_after, shown_after = await strip()
        kinds = [r.event_type for r in app.state.audit.records()]
    assert (old.bed_label, old.method, old.valid_to == new.valid_from) == ("BED05", "central_station_list", True)
    assert (new.bed_label, new.method, new.valid_to) == ("Yatak 5", "editor", None)
    assert (version_after, shown_after) == (version + 1, ["Yatak 5"]) and sha_after != sha
    assert resets == [True]                                                 # the relabel's one (strip() calls the real reset)
    assert kinds == ["structure.rename", "structure.rename", "device_bed.relabel"]


async def test_a_label_race_only_the_commit_catches_rolls_the_relabel_back_with_the_rename(db_session, monkeypatch):
    """The unit-wide check is blind to a writer outside these routes; `uq_bed_label_per_room` is not. The relabel is
    flushed before the bed's own UPDATE, so the commit's unique violation is the same `bed_label_taken`, and the two
    mapping rows the relabel wrote go with it."""
    async def blind(*_args, **_kwargs):
        return False

    async with esleme_client(db_session) as (client, app, ward):
        await seed(db_session, ward, ("192.0.2.11", "1", "BED05"))
        resets = _spy_reset(app)
        monkeypatch.setattr(tenant_router, "_bed_label_taken", blind)
        response = await _patch(client, ward, "1", label="10")                         # bed 10 is in the same room
        rows = await _rows(db_session)
        await db_session.refresh(ward.beds["1"])
    assert (response.status_code, response.json()["detail"]["code"]) == (409, "bed_label_taken")
    assert [(r.bed_label, r.valid_to) for r in rows] == [("BED05", None)] and ward.beds["1"].label == "1"
    assert app.state.audit.records() == [] and resets == []


async def test_a_bed_with_a_monitor_is_not_closed_until_the_monitor_is_unbound(db_session):
    async with esleme_client(db_session) as (client, app, ward):
        ids = await seed(db_session, ward, ("192.0.2.11", "1", "BED05"))
        resets = _spy_reset(app)
        refused = await _patch(client, ward, "1", is_active=False)
        await db_session.refresh(ward.beds["1"])
        still_open = ward.beds["1"].is_active
        rows_after_the_refusal, audit_after_the_refusal = len(await _rows(db_session)), app.state.audit.records()
        await client.post(f"{URL}/unbind", headers=ward.auth["admin"],
                          json={"source": "192.0.2.11", "expected": {"device_row_id": ids["192.0.2.11"]}})
        closed = await _patch(client, ward, "1", is_active=False)
        await db_session.refresh(ward.beds["1"])
    assert refused.status_code == 409 and refused.json()["detail"]["code"] == "bed_has_monitor"
    assert still_open is True and closed.status_code == 200 and ward.beds["1"].is_active is False
    assert rows_after_the_refusal == 1 and audit_after_the_refusal == []        # nothing written, nothing audited
    assert resets == [True]                                                       # the unbind's, not the refusal's
    assert [r.event_type for r in app.state.audit.records()] == ["device_bed.unbind", "structure.close"]


async def test_a_bed_without_a_monitor_closes_and_writes_no_mapping_row(db_session):
    async with esleme_client(db_session) as (client, app, ward):
        await seed(db_session, ward, ("192.0.2.11", "1", "BED05"), ("192.0.2.12", None, "BED01"))
        closed = await _patch(client, ward, "2", is_active=False)                 # another bed's monitor does not hold it
        rows = await _rows(db_session)
    assert closed.status_code == 200 and closed.json()["is_active"] is False and len(rows) == 2


async def test_a_rename_and_a_close_sent_together_for_a_bed_with_a_monitor_change_nothing(db_session):
    async with esleme_client(db_session) as (client, app, ward):
        await seed(db_session, ward, ("192.0.2.11", "1", "BED05"))
        response = await _patch(client, ward, "1", label="Yatak 1", is_active=False)
        await db_session.refresh(ward.beds["1"])
        rows = await _rows(db_session)
    assert (response.status_code, response.json()["detail"]["code"]) == (409, "bed_has_monitor")
    assert (ward.beds["1"].label, ward.beds["1"].is_active, len(rows)) == ("1", True, 1)
    assert app.state.audit.records() == []


async def test_the_hooks_run_whatever_the_lanes_stage(db_session):
    """Spec §4.10: Yapı is not the strip, and a rename must not leave a stale label behind for when the stage
    comes on; nor may a bed with a monitor be closed while the stage is off."""
    async with esleme_client(db_session, stage="off") as (client, app, ward):
        await seed(db_session, ward, ("192.0.2.11", "1", "BED05"))
        closed = await _patch(client, ward, "1", is_active=False)
        renamed = await _patch(client, ward, "1", label="Yatak 1")
        rows = await _rows(db_session, "192.0.2.11")
    assert (closed.status_code, closed.json()["detail"]["code"]) == (409, "bed_has_monitor")
    assert renamed.status_code == 200 and [r.bed_label for r in rows] == ["BED05", "Yatak 1"]
    assert rows[1].valid_to is None


async def test_the_structure_opens_to_a_holder_of_devices_map_beds(db_session):
    async with esleme_client(db_session) as (client, _, ward):
        group = Group(tenant_id=ward.tenant.id, slug="esleme_only", name="Yalnız eşleme",
                      mfa_required=False, is_system=False)
        group.permissions = [GroupPermission(permission="devices.map_beds")]
        db_session.add(group)
        await db_session.flush()
        user = await add_user(db_session, username="map@kabul.example.com", tenant_id=ward.tenant.id, group=group)
        await db_session.commit()
        response = await client.get("/tenant/structure", headers=await bearer(db_session, user))
    assert response.status_code == 200 and response.json()["sites"]


# --- A-22 race h: a bind against a Yapı close or rename of the target bed -------------------------------------
#
# Each test makes the two requests meet at the bed lock for certain: the one that holds it is paused at the first
# point after its locks (the bind before it writes; the Yapı write before its hook) and goes on only once the other
# is queued behind that very lock (`pg_stat_activity`). So the outcome is the lock's, not the scheduler's.

async def _queued_behind_a_bed_lock(db, timeout: float = 15.0) -> None:       # the shared database is under contention
    sql = text("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() "
               "AND wait_event_type = 'Lock' AND query LIKE '%FROM beds%beds.id%FOR NO KEY UPDATE%'")
    maker = async_sessionmaker(db.bind, expire_on_commit=False)
    async with asyncio.timeout(timeout):
        while True:
            async with maker() as session:
                if (await session.execute(sql)).scalar_one():
                    return
            await asyncio.sleep(0.02)


def _hold_the_bed_while_the_other_queues(monkeypatch, db, module, name, other):
    """Wrap `module.name` (a module path, resolved here): when the holder reaches it, `other()` is started as a task
    and waited for until it is queued behind the bed lock; then the original runs. The task is returned in the list."""
    target = importlib.import_module(module)
    real, tasks = getattr(target, name), []

    async def hold(*args, **kwargs):
        task = asyncio.ensure_future(other())
        tasks.append(task)
        await _queued_behind_a_bed_lock(db)
        assert not task.done()
        return await real(*args, **kwargs)

    monkeypatch.setattr(target, name, hold)
    return tasks


async def test_a_close_queued_behind_a_bind_of_the_bed_sees_the_monitor_and_is_refused(db_session, monkeypatch):
    async with esleme_client(db_session) as (client, app, ward):
        await seed(db_session, ward, ("192.0.2.12", "2", "BED06"))
        tasks = _hold_the_bed_while_the_other_queues(
            monkeypatch, db_session, SERVICE, "_write", lambda: _patch(client, ward, "1", is_active=False))
        bound = await _bind(client, ward, "192.0.2.11", "1")
        refused = await tasks[0]
        await db_session.refresh(ward.beds["1"])
        rows = await _rows(db_session, "192.0.2.11")
    assert bound.status_code == 200 and bound.json()["changed"] is True
    assert (refused.status_code, refused.json()["detail"]["code"]) == (409, "bed_has_monitor")
    assert ward.beds["1"].is_active is True and [(r.bed_id, r.valid_to) for r in rows] == [(ward.beds["1"].id, None)]
    assert [r.event_type for r in app.state.audit.records()] == ["device_bed.bind"]


async def test_a_bind_queued_behind_a_close_of_the_bed_finds_it_closed_and_writes_nothing(db_session, monkeypatch):
    async with esleme_client(db_session) as (client, app, ward):
        await seed(db_session, ward, ("192.0.2.12", "2", "BED06"))
        resets = _spy_reset(app)
        tasks = _hold_the_bed_while_the_other_queues(
            monkeypatch, db_session, WRITES, "refuse_close_if_bound", lambda: _bind(client, ward, "192.0.2.11", "1"))
        closed = await _patch(client, ward, "1", is_active=False)
        refused = await tasks[0]
        await db_session.refresh(ward.beds["1"])
        rows = await _rows(db_session)
    assert closed.status_code == 200 and ward.beds["1"].is_active is False
    assert (refused.status_code, refused.json()["detail"]["code"]) == (409, "bed_closed")
    assert [r.source for r in rows] == ["192.0.2.12"]                          # no row for the monitor that lost
    assert [r.event_type for r in app.state.audit.records()] == ["structure.close"] and resets == []


async def test_a_rename_queued_behind_a_bind_of_the_bed_relabels_the_row_the_bind_wrote(db_session, monkeypatch):
    async with esleme_client(db_session) as (client, app, ward):
        await seed(db_session, ward, ("192.0.2.12", "2", "BED06"))
        tasks = _hold_the_bed_while_the_other_queues(
            monkeypatch, db_session, SERVICE, "_write", lambda: _patch(client, ward, "1", label="Yatak 1"))
        bound = await _bind(client, ward, "192.0.2.11", "1")
        renamed = await tasks[0]
        rows = await _rows(db_session, "192.0.2.11")
        board = (await client.get("/infinity-shadow/board", headers=BOARD)).json()
    assert (bound.status_code, renamed.status_code) == (200, 200)
    assert [(r.bed_label, r.valid_to is None) for r in rows] == [("1", False), ("Yatak 1", True)]
    assert rows[0].valid_to == rows[1].valid_from
    assert sorted(r.event_type for r in app.state.audit.records()) == ["device_bed.bind", "device_bed.relabel", "structure.rename"]
    assert [c["bed_label"] for c in board["beds"] if c["source"] == "192.0.2.11"] == ["Yatak 1"]


async def test_a_bind_queued_behind_a_rename_of_the_bed_writes_the_new_label(db_session, monkeypatch):
    async with esleme_client(db_session) as (client, app, ward):
        tasks = _hold_the_bed_while_the_other_queues(
            monkeypatch, db_session, WRITES, "relabel_bed", lambda: _bind(client, ward, "192.0.2.11", "2"))
        renamed = await _patch(client, ward, "2", label="Yatak 2")
        bound = await tasks[0]
        rows = await _rows(db_session, "192.0.2.11")
    assert (renamed.status_code, bound.status_code) == (200, 200)
    assert [(r.bed_id, r.bed_label, r.valid_to) for r in rows] == [(ward.beds["2"].id, "Yatak 2", None)]
    assert sorted(r.event_type for r in app.state.audit.records()) == ["device_bed.bind", "structure.rename"]


# --- A-12: the relabel against the real triggers (the migrated chain) ------------------------------------------

def test_the_relabel_commits_on_the_migrated_chain_and_the_history_stays_kept(clean_db):
    """The `db_session` schema comes from `create_all`, so 0014's three triggers are absent there. Here the schema is
    built by `alembic upgrade head`: a relabel (a close of the row and an insert of its successor) must commit through
    the history trigger — twice running, the second closing the first relabel's own editor row — and what the trigger
    forbids, a close in the future and an edit of a closed row, must still raise."""
    engine, cfg = clean_db
    command.upgrade(cfg, "head")

    async def scenario():
        aengine = create_async_engine(TEST_DATABASE_URL)
        try:
            async with async_sessionmaker(aengine, expire_on_commit=False)() as db:
                async with esleme_client(db) as (client, app, ward):
                    await seed(db, ward, ("192.0.2.11", "1", "BED05"))
                    first = await _patch(client, ward, "1", label="Yatak 1")           # close the v2 row + insert
                    second = await _patch(client, ward, "1", label="Yatak 1 A")        # close the editor row + insert
                    refused = await _patch(client, ward, "1", is_active=False)         # bed_has_monitor on the real schema
                    return (first.status_code, second.status_code, refused.status_code,
                            refused.json()["detail"]["code"], len(app.state.audit.records(event_type="device_bed.relabel")))
        finally:
            await aengine.dispose()

    assert asyncio.run(scenario()) == (200, 200, 409, "bed_has_monitor", 2)

    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'device_beds_%'")).scalar_one() == 3
        rows = conn.execute(text("SELECT id, bed_label, valid_from, valid_to, method FROM device_beds "
                                 "WHERE source = '192.0.2.11' ORDER BY id")).all()
        open_id = rows[2].id
        closed_id = rows[0].id
    assert [(r.bed_label, r.method) for r in rows] == [("BED05", "central_station_list"), ("Yatak 1", "editor"),
                                                      ("Yatak 1 A", "editor")]
    assert rows[0].valid_to == rows[1].valid_from and rows[1].valid_to == rows[2].valid_from and rows[2].valid_to is None
    with pytest.raises(DBAPIError, match=KEPT), engine.begin() as conn:                    # a close at t + 1 h
        conn.execute(text("UPDATE device_beds SET valid_to = clock_timestamp() + interval '1 hour' WHERE id = :i"),
                     {"i": open_id})
    with pytest.raises(DBAPIError, match=KEPT), engine.begin() as conn:                    # an edit of a closed row
        conn.execute(text("UPDATE device_beds SET bed_label = 'x' WHERE id = :i"), {"i": closed_id})
    with pytest.raises(DBAPIError, match=KEPT), engine.begin() as conn:                    # the relabel as an edit in place
        conn.execute(text("UPDATE device_beds SET bed_label = 'x' WHERE id = :i"), {"i": open_id})
    with pytest.raises(DBAPIError, match=KEPT), engine.begin() as conn:                    # a delete
        conn.execute(text("DELETE FROM device_beds WHERE id = :i"), {"i": closed_id})

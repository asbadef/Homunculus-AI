# homunculus-engine/tests/test_device_beds_import.py
"""The seed import (spec §5.4): the sha, the parse, the beds and units, the rows, the grant (O11),
the audit, the printed line; an untouched second run is `already`; an edited table is exit 3; and the
cross-check of A-9 — the file's rows digest equals the table's, or nothing is written."""
from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import time
import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from homunculus.api.audit import InMemoryAuditLog
from homunculus.api.device_beds_postgres import PostgresDeviceBeds
from homunculus.api.infinity_device_beds import parse_table, rows_digest
from homunculus.auth.models import Group, GroupPermission
from homunculus.devicebeds import seed
from homunculus.devicebeds.models import DeviceBed
from homunculus.devicebeds.rows import to_row
from homunculus.devicebeds.seed import APPROVED_V2_SHA256, ImportRefused, import_v2
from tests.conftest import TEST_DATABASE_URL, requires_db
from homunculus.tenant.models import Site, Tenant
from tests.esleme_v2 import GRANT_GROUP, GRANT_KEY, V2, V2_DIGEST, tenant_only, v2_ward

pytestmark = [requires_db]
SLUG = "esleme-hastane"


def _edited(edit) -> bytes:
    raw = json.loads(V2.read_bytes())
    edit(raw)
    return json.dumps(raw).encode()


async def _count(db, model=DeviceBed):
    return (await db.execute(select(func.count()).select_from(model))).scalar_one()


async def _granted(db, slug_tenant_id):
    return set((await db.execute(select(Group.slug).join(GroupPermission).where(
        Group.tenant_id == slug_tenant_id, GroupPermission.permission == GRANT_KEY))).scalars())


async def _revoke(db, tenant_id) -> None:
    """An administrator takes the key away from every group of the tenant (Rollar), by SQL: the session's
    own copy of a group's permissions is not the database's after the import's Core insert."""
    await db.execute(delete(GroupPermission).where(
        GroupPermission.permission == GRANT_KEY,
        GroupPermission.group_id.in_(select(Group.id).where(Group.tenant_id == tenant_id))))
    await db.commit()


async def _all_grants(db) -> set[tuple]:
    """Every (tenant, group, key) in the database: what the import may add to, and nothing else."""
    rows = await db.execute(select(Group.tenant_id, Group.slug, GroupPermission.permission)
                            .join(GroupPermission, GroupPermission.group_id == Group.id))
    return {tuple(row) for row in rows}


def test_the_approved_constant_is_the_committed_v2_files_sha256():
    assert hashlib.sha256(V2.read_bytes()).hexdigest() == APPROVED_V2_SHA256


def test_the_files_current_rows_digest_is_the_approved_one():
    """A-9: the cross-check's expected value is the digest of v2's current rows, not of its bytes."""
    table = parse_table(json.loads(V2.read_bytes().decode("utf-8-sig")))
    assert rows_digest(table.rows) == V2_DIGEST != APPROVED_V2_SHA256


async def test_v2_imports_as_thirteen_rows_grants_the_charge_nurse_and_audits(db_session):
    tenant, _ = await v2_ward(db_session)
    other = await tenant_only(db_session, "baska-hastane")
    audit = InMemoryAuditLog()
    result = await import_v2(db_session, tenant_slug=SLUG, data=V2.read_bytes(), audit=audit)
    assert (result.rows, result.with_bed, result.without_bed) == (13, 12, 1)
    assert result.granted == ["charge_nurse"] and result.already is False
    assert result.sha256 == V2_DIGEST
    assert result.version == (await db_session.execute(select(func.max(DeviceBed.id)))).scalar_one()
    assert await _granted(db_session, tenant.id) == {"charge_nurse"}
    assert await _granted(db_session, other.id) == set()
    [row] = audit.records(event_type="device_bed.import")
    assert (row.tenant, row.patient_id) == (SLUG, "")
    assert row.payload == {"file_sha256": APPROVED_V2_SHA256, "file_version": 2, "site": "ICU2 (VLAN 203)",
                           "rows": 13, "with_bed": 12, "without_bed": 1, "granted": ["charge_nurse"],
                           "version": result.version, "sha256": V2_DIGEST, "actor": "import"}
    line = result.line()
    assert line.startswith("ESLEME_ICE_AKTARIM ")
    assert json.loads(line.split(" ", 1)[1])["sha256"] == V2_DIGEST
    seeded = (await db_session.execute(select(DeviceBed).order_by(DeviceBed.id))).scalars().first()
    assert (seeded.device_bed_label, seeded.bed_label, seeded.verified_by) == ("BED05", "BED05", None)


async def test_the_rows_are_the_files_rows_in_file_order_with_method_and_verified_at_unchanged(db_session):
    """Spec D21/O9: the import copies v2's `method` and `verified_at` per row, `verified_by` stays null."""
    await v2_ward(db_session)
    await import_v2(db_session, tenant_slug=SLUG, data=V2.read_bytes(), audit=None)
    stored = (await db_session.execute(select(DeviceBed).order_by(DeviceBed.id))).scalars().all()
    raw = json.loads(V2.read_bytes().decode("utf-8-sig"))
    assert tuple(to_row(r) for r in stored) == parse_table(raw).rows
    assert [(r.source, r.group_address, r.port, r.method, r.verified_at, r.note) for r in stored] == [
        (d["source"], d["group"], d["port"], d["method"], d["verified_at"], d["note"]) for d in raw["devices"]]
    assert [None if r.bed_id is None else str(r.bed_id) for r in stored] == [d["bed_id"] for d in raw["devices"]]
    assert all(r.verified_by is None and r.valid_to is None for r in stored)
    assert {(r.approved_by, r.approved_at.date().isoformat()) for r in stored} == {("proje sahibi", "2026-10-27")}
    assert [r.bed_label for r in stored if r.bed_id is None] == ["BED01"]


async def test_after_the_import_the_accessors_digest_is_the_files_digest(db_session):
    """A-9 item 3 end to end: `PostgresDeviceBeds` reads the committed rows back and reports the file's
    rows digest, and the version the import printed."""
    await v2_ward(db_session)
    result = await import_v2(db_session, tenant_slug=SLUG, data=V2.read_bytes(), audit=None)
    accessor = PostgresDeviceBeds(TEST_DATABASE_URL, hospital=SLUG, clock=lambda: 0.0)
    try:
        state = accessor.current()
    finally:
        accessor.dispose()
    file_digest = rows_digest(parse_table(json.loads(V2.read_bytes().decode("utf-8-sig"))).rows)
    assert state.status == "ok" and state.sha256 == file_digest == V2_DIGEST
    assert (state.version, state.sha256) == (result.version, result.sha256)


async def test_a_digest_that_differs_from_the_files_rolls_everything_back_with_exit_2(db_session, monkeypatch):
    """A-9 item 3: whatever would make the table's rows hash differently from the file's — here every
    label gets a letter appended as it is seeded — nothing stays: no rows, no grant, no audit."""
    tenant, _ = await v2_ward(db_session)
    tenant_id = tenant.id
    real = seed._seeded

    def tampered(*args, **kwargs):
        row = real(*args, **kwargs)
        row.bed_label = f"{row.bed_label}X"
        return row

    monkeypatch.setattr(seed, "_seeded", tampered)
    audit = InMemoryAuditLog()
    with pytest.raises(ImportRefused, match="özet") as refused:
        await import_v2(db_session, tenant_slug=SLUG, data=V2.read_bytes(), audit=audit)
    assert refused.value.code == 2
    assert await _count(db_session) == 0 and await _granted(db_session, tenant_id) == set()
    assert audit.records() == []


async def test_an_untouched_second_run_is_already_done_and_writes_nothing(db_session):
    tenant, _ = await v2_ward(db_session)
    tenant_id = tenant.id
    first = await import_v2(db_session, tenant_slug=SLUG, data=V2.read_bytes(), audit=None)
    assert await _granted(db_session, tenant_id) == {GRANT_GROUP}
    await _revoke(db_session, tenant_id)                                                  # the admin took it away
    assert await _granted(db_session, tenant_id) == set()
    audit = InMemoryAuditLog()
    again = await import_v2(db_session, tenant_slug=SLUG, data=V2.read_bytes(), audit=audit)
    assert again.already is True and (again.version, again.sha256) == (first.version, first.sha256)
    assert again.granted == [] and again.line().startswith("ESLEME_ICE_AKTARIM ")
    assert await _count(db_session) == 13 and audit.records() == []
    assert await _granted(db_session, tenant_id) == set()                                 # not put back


async def test_a_table_edited_since_is_refused_with_exit_3(db_session):
    tenant, _ = await v2_ward(db_session)
    await import_v2(db_session, tenant_slug=SLUG, data=V2.read_bytes(), audit=None)
    first = (await db_session.execute(select(DeviceBed).order_by(DeviceBed.id))).scalars().first()
    db_session.add(DeviceBed(tenant_id=tenant.id, source="10.10.203.40", group_address="224.0.2.40", port=2050,
                             valid_from=first.valid_from, approved_by="x", approved_at=first.approved_at))
    await db_session.commit()
    with pytest.raises(ImportRefused) as refused:
        await import_v2(db_session, tenant_slug=SLUG, data=V2.read_bytes(), audit=None)
    assert refused.value.code == 3 and await _count(db_session) == 14


async def test_a_bind_made_by_the_editor_since_is_refused_with_exit_3_and_grants_nothing(db_session):
    """The editor closes a row and opens another (spec §4.4): the table is no longer the file's, and the
    re-run neither touches it nor puts a revoked key back."""
    tenant, _ = await v2_ward(db_session)
    tenant_id = tenant.id
    await import_v2(db_session, tenant_slug=SLUG, data=V2.read_bytes(), audit=None)
    await _revoke(db_session, tenant_id)
    open_row =(await db_session.execute(select(DeviceBed).where(DeviceBed.valid_to.is_(None))
                                         .order_by(DeviceBed.id))).scalars().first()
    closed_at = datetime.now(timezone.utc)
    open_row.valid_to = closed_at
    await db_session.flush()                                  # the close first: one open row per source
    db_session.add(DeviceBed(tenant_id=tenant_id, source=open_row.source, group_address=open_row.group_address,
                             port=2050, device_bed_label=open_row.device_bed_label, bed_label=None,
                             method="editor", verified_at=closed_at.isoformat(), note=None,
                             valid_from=closed_at, approved_by="admin.lbys", approved_at=closed_at))
    await db_session.commit()
    audit = InMemoryAuditLog()
    with pytest.raises(ImportRefused) as refused:
        await import_v2(db_session, tenant_slug=SLUG, data=V2.read_bytes(), audit=audit)
    assert refused.value.code == 3 and await _count(db_session) == 14
    assert audit.records() == [] and await _granted(db_session, tenant_id) == set()


def _swap_bed(raw):
    raw["devices"][0]["bed_id"] = str(uuid.uuid4())


def _swap_unit(raw):
    raw["devices"][0]["unit_id"] = str(uuid.uuid4())


@pytest.mark.parametrize("data, approved, words", [
    (V2.read_bytes() + b" ", None, "sha256"),
    (b"{not json", "own", "JSON"),
    (_edited(lambda raw: raw.update(approved_by="")), "own", "onaylanmamış"),
    (_edited(_swap_bed), "own", "yatak"),
    (_edited(_swap_unit), "own", "birim"),
])
async def test_each_refusal_is_exit_2_and_writes_nothing(db_session, data, approved, words):
    tenant, _ = await v2_ward(db_session)
    tenant_id = tenant.id
    sha = hashlib.sha256(data).hexdigest() if approved == "own" else APPROVED_V2_SHA256
    with pytest.raises(ImportRefused, match=words) as refused:
        await import_v2(db_session, tenant_slug=SLUG, data=data, audit=None, approved_sha=sha)
    assert refused.value.code == 2
    assert await _count(db_session) == 0 and await _granted(db_session, tenant_id) == set()


async def test_another_tenants_bed_is_refused_like_a_missing_one(db_session):
    await v2_ward(db_session, "ilk-hastane")
    await tenant_only(db_session, SLUG)
    with pytest.raises(ImportRefused, match="yatak") as refused:
        await import_v2(db_session, tenant_slug=SLUG, data=V2.read_bytes(), audit=None)
    assert refused.value.code == 2


async def test_a_tenant_that_does_not_exist_is_refused_with_exit_2(db_session):
    with pytest.raises(ImportRefused, match="kiracı") as refused:
        await import_v2(db_session, tenant_slug="yok-hastane", data=V2.read_bytes(), audit=None)
    assert refused.value.code == 2


async def test_a_dry_run_checks_everything_and_writes_nothing(db_session):
    tenant, _ = await v2_ward(db_session)
    tenant_id = tenant.id
    result = await import_v2(db_session, tenant_slug=SLUG, data=V2.read_bytes(), audit=None, dry_run=True)
    assert (result.rows, result.sha256, result.version, result.granted) == (13, V2_DIGEST, None, [])
    assert result.dry_run is True and result.already is False
    assert await _count(db_session) == 0 and await _granted(db_session, tenant_id) == set()


async def test_the_grant_adds_exactly_one_key_to_exactly_one_group_of_the_named_tenant(db_session):
    """O11/A-9 brief: no other key, no other group (the administrator's system group included), no
    other tenant."""
    tenant, _ = await v2_ward(db_session)
    await tenant_only(db_session, "baska-hastane")
    await db_session.commit()
    before = await _all_grants(db_session)
    await import_v2(db_session, tenant_slug=SLUG, data=V2.read_bytes(), audit=None)
    after = await _all_grants(db_session)
    assert after - before == {(tenant.id, GRANT_GROUP, GRANT_KEY)} and before <= after


async def test_a_tenant_that_already_holds_the_key_imports_and_is_granted_nothing(db_session):
    """A tenant created after this slice has the key from `DEFAULT_GROUPS`: the grant is a no-op, `granted`
    says so, and the import goes on."""
    tenant, _ = await v2_ward(db_session, preslice=False)
    held = await _granted(db_session, tenant.id)
    assert GRANT_GROUP in held
    result = await import_v2(db_session, tenant_slug=SLUG, data=V2.read_bytes(), audit=None)
    assert result.granted == [] and result.already is False and result.sha256 == V2_DIGEST
    assert await _count(db_session) == 13 and await _granted(db_session, tenant.id) == held


async def test_a_tenant_without_a_charge_nurse_group_imports_and_grants_nothing(db_session):
    tenant, _ = await v2_ward(db_session)
    tenant_id = tenant.id
    group = (await db_session.execute(select(Group).where(Group.tenant_id == tenant_id,
                                                           Group.slug == GRANT_GROUP))).scalar_one()
    await db_session.delete(group)
    await db_session.commit()
    result = await import_v2(db_session, tenant_slug=SLUG, data=V2.read_bytes(), audit=None)
    assert result.granted == [] and await _count(db_session) == 13
    assert await _granted(db_session, tenant_id) == set()


async def test_two_imports_at_once_run_one_after_the_other(db_session):
    """The tenant's row is locked (spec §5.4 step 3): the second import waits for the first, then finds
    the rows already there."""
    await v2_ward(db_session)
    engine = create_async_engine(TEST_DATABASE_URL)
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async def run():
        async with maker() as session:
            return await import_v2(session, tenant_slug=SLUG, data=V2.read_bytes(), audit=None)

    try:
        first, second = await asyncio.gather(run(), run())
    finally:
        await engine.dispose()
    assert sorted([first.already, second.already]) == [False, True]
    assert (first.version, first.sha256) == (second.version, second.sha256)
    assert await _count(db_session) == 13


class _BrokenAudit:
    def append(self, event):
        raise RuntimeError("secret-detail")


async def test_a_failing_audit_store_does_not_undo_the_committed_import(db_session, capsys):
    """A-26: the rows are committed, the import says so and the exit stays 0; the failure is named by its
    class only, on stderr — stdout stays the one `ESLEME_ICE_AKTARIM {…}` line the deploy blocks parse."""
    tenant, _ = await v2_ward(db_session)
    result = await import_v2(db_session, tenant_slug=SLUG, data=V2.read_bytes(), audit=_BrokenAudit())
    assert result.already is False and await _count(db_session) == 13
    assert await _granted(db_session, tenant.id) == {GRANT_GROUP}
    printed = capsys.readouterr()
    assert printed.out == ""
    assert "ESLEME_ICE_AKTARIM_DENETIM_YAZILAMADI RuntimeError" in printed.err and "secret-detail" not in printed.err


# ------------------------------------------------------------------ A-13 (Task 5 review)
@contextlib.asynccontextmanager
async def _tamper(db, assignment: str):
    """A test-local BEFORE INSERT trigger on `device_beds` that rewrites every row as the database stores it
    (`assignment` is one PL/pgSQL statement, e.g. `NEW.port := 2051`): what the session holds in memory is
    then NOT what the table holds. Dropped, with its function, whatever happens."""
    await db.execute(text("CREATE OR REPLACE FUNCTION esleme_test_tamper() RETURNS trigger LANGUAGE plpgsql "
                          f"AS $$ BEGIN {assignment}; RETURN NEW; END $$"))
    await db.execute(text("CREATE TRIGGER esleme_test_tamper BEFORE INSERT ON device_beds FOR EACH ROW "
                          "EXECUTE FUNCTION esleme_test_tamper()"))
    await db.commit()
    try:
        yield
    finally:
        await db.rollback()
        await db.execute(text("DROP TRIGGER IF EXISTS esleme_test_tamper ON device_beds"))
        await db.execute(text("DROP FUNCTION IF EXISTS esleme_test_tamper()"))
        await db.commit()


@pytest.mark.parametrize("assignment", [
    "NEW.port := 2051", "NEW.note := 'elle degisti'", "NEW.group_address := '224.0.2.250'"])
async def test_a_stored_row_that_differs_from_the_file_outside_the_digest_is_rolled_back_with_exit_2(
        db_session, assignment):
    """A-13 1: the digest holds source, bed and label only. The history trigger of 0014 would refuse a later
    correction of a wrong group, port, note, so the WHOLE row is compared before the grant."""
    tenant, _ = await v2_ward(db_session)
    tenant_id = tenant.id
    audit = InMemoryAuditLog()
    async with _tamper(db_session, assignment):
        with pytest.raises(ImportRefused, match="alan alan") as refused:
            await import_v2(db_session, tenant_slug=SLUG, data=V2.read_bytes(), audit=audit)
    assert refused.value.code == 2
    assert await _count(db_session) == 0 and await _granted(db_session, tenant_id) == set()
    assert audit.records() == []


async def test_the_cross_check_reads_the_database_and_not_the_sessions_memory(db_session):
    """A-13 2 (pins `populate_existing`): the seeded objects are still in the session, correct; the table holds a
    label with a letter added by a trigger. Only a read that refreshes the objects sees it."""
    tenant, _ = await v2_ward(db_session)
    tenant_id = tenant.id
    async with _tamper(db_session, "NEW.bed_label := NEW.bed_label || 'X'"):
        with pytest.raises(ImportRefused, match="özet") as refused:
            await import_v2(db_session, tenant_slug=SLUG, data=V2.read_bytes(), audit=None)
    assert refused.value.code == 2
    assert await _count(db_session) == 0 and await _granted(db_session, tenant_id) == set()


async def test_a_row_changed_behind_the_sessions_back_is_not_taken_for_the_files(db_session):
    """The same pin for the first read: the session still holds the seeded rows as they were; the table has
    moved on (an editor, another process). The re-run must see the table, not the memory."""
    await v2_ward(db_session)
    await import_v2(db_session, tenant_slug=SLUG, data=V2.read_bytes(), audit=None)
    held = (await db_session.execute(select(DeviceBed).order_by(DeviceBed.id))).scalars().all()
    await db_session.execute(text("UPDATE device_beds SET note = 'elle degisti' WHERE id = "
                                  "(SELECT min(id) FROM device_beds)"))
    await db_session.commit()
    assert held[0].note != "elle degisti"                                        # the memory is stale
    with pytest.raises(ImportRefused) as refused:
        await import_v2(db_session, tenant_slug=SLUG, data=V2.read_bytes(), audit=None)
    assert refused.value.code == 3


async def test_a_failing_read_back_after_the_commit_falls_back_to_the_pre_commit_values(
        db_session, monkeypatch, capsys):
    """A-13 3: the rows are committed; a failed read-back must not turn that into a traceback and no line.
    The pre-commit (version, digest) are identical by construction; the line and the audit still follow."""
    tenant, _ = await v2_ward(db_session)

    async def broken(*args, **kwargs):
        raise RuntimeError("secret-detail")

    monkeypatch.setattr(seed, "_read_back", broken)
    audit = InMemoryAuditLog()
    result = await import_v2(db_session, tenant_slug=SLUG, data=V2.read_bytes(), audit=audit)
    assert await _count(db_session) == 13 and await _granted(db_session, tenant.id) == {GRANT_GROUP}
    assert result.already is False and result.granted == ["charge_nurse"]
    assert result.version == (await db_session.execute(select(func.max(DeviceBed.id)))).scalar_one()
    assert result.sha256 == V2_DIGEST
    assert json.loads(result.line().split(" ", 1)[1])["sha256"] == V2_DIGEST
    [row] = audit.records(event_type="device_bed.import")
    assert (row.payload["version"], row.payload["sha256"]) == (result.version, V2_DIGEST)
    printed = capsys.readouterr()
    assert printed.out == "" and "RuntimeError" in printed.err and "secret-detail" not in printed.err


async def test_the_tenant_lock_is_key_share_so_inserts_that_reference_the_tenant_go_through(db_session, monkeypatch):
    """A-13 4: `FOR NO KEY UPDATE` still serialises two imports but does not block a row whose foreign key
    points at the tenant (a new site, an admission) - the old API keeps serving while the import runs."""
    tenant, _ = await v2_ward(db_session)
    tenant_id = tenant.id
    reached, release = asyncio.Event(), asyncio.Event()
    real = seed._check_beds

    async def paused(*args, **kwargs):                     # the import holds the lock and waits here
        reached.set()
        await release.wait()
        return await real(*args, **kwargs)

    monkeypatch.setattr(seed, "_check_beds", paused)
    engine = create_async_engine(TEST_DATABASE_URL)
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async def run():
        async with maker() as session:
            return await import_v2(session, tenant_slug=SLUG, data=V2.read_bytes(), audit=None)

    task = asyncio.create_task(run())
    try:
        await asyncio.wait_for(reached.wait(), 15)
        async with maker() as other:
            other.add(Site(tenant_id=tenant_id, name="Ikinci bina"))
            await asyncio.wait_for(other.commit(), 3)      # blocks (and times out) under a plain FOR UPDATE
    finally:
        release.set()
        result = await task
        await engine.dispose()
    assert result.already is False and await _count(db_session) == 13


async def test_a_tenant_row_held_by_someone_else_is_given_up_after_five_seconds(db_session):
    """A-13 4: `SET LOCAL lock_timeout = '5s'`. The import stops with the database's error instead of waiting for
    ever, and nothing is written."""
    await v2_ward(db_session)
    engine = create_async_engine(TEST_DATABASE_URL)
    try:
        async with engine.connect() as holder:
            await holder.execute(select(Tenant.id).where(Tenant.slug == SLUG).with_for_update())
            started = time.monotonic()
            with pytest.raises(DBAPIError):
                await asyncio.wait_for(import_v2(db_session, tenant_slug=SLUG, data=V2.read_bytes(), audit=None), 30)
            waited = time.monotonic() - started
            await holder.rollback()
    finally:
        await engine.dispose()
    await db_session.rollback()
    assert 4.0 <= waited < 15.0, f"waited {waited:.1f} s"
    assert await _count(db_session) == 0

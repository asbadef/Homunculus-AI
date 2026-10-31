# homunculus-engine/tests/test_device_beds_parity.py
"""C2, the parity proof (spec §6): after the import, PostgresDeviceBeds(...).current() answers what
TableFile(v2).current() answers — row for row, at every moment, and on the strip — and the CLI
(scripts/import_device_beds.py) prints the one line the blocks read: exit 0 / 1 / 2 / 3, stdout carries
that line and nothing else (E15), every refusal and every unexpected failure goes to stderr (A-13).

A-12: the same import and the same parity on the MIGRATED chain (`alembic upgrade head`, 0014's triggers
present), where a forbidden write still raises "keeps its history". Synthetic devices; v2's own rows."""
from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import subprocess
import sys
import time
import uuid
from datetime import timedelta
from pathlib import Path

import pytest
from alembic import command
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from homunculus.api.audit import InMemoryAuditLog
from homunculus.api.device_beds_postgres import PostgresDeviceBeds
from homunculus.api.infinity_device_beds import MAX_BYTES, TableFile
from homunculus.api.infinity_shadow import DeviceView, board_view
from homunculus.devicebeds import seed
from homunculus.devicebeds.models import DeviceBed
from homunculus.devicebeds.seed import import_v2
from homunculus.scope.rules import normalise_id
from tests.conftest import TEST_DATABASE_URL, requires_db
from tests.esleme_v2 import BEDS, GRANT_KEY, UNIT, V2, V2_DIGEST, v2_ward

pytestmark = [requires_db]
SLUG = "esleme-hastane"
ENGINE_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ENGINE_ROOT / "scripts" / "import_device_beds.py"
KEPT = "keeps its history"
MARKER = "SENTETIK-PARAMETRE"          # stands for a bound parameter a driver error would print


def _script():
    spec = importlib.util.spec_from_file_location("import_device_beds", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _line(out: str) -> dict:
    """E15: stdout is exactly one line, `ESLEME_ICE_AKTARIM {json}`; the deploy block parses it as such."""
    lines = out.splitlines()
    assert len(lines) == 1 and lines[0].startswith("ESLEME_ICE_AKTARIM {"), out
    return json.loads(lines[0].split(" ", 1)[1])


def _refusal(captured, code: int) -> str:
    """A refusal prints nothing on stdout and `ESLEME_ICE_AKTARIM_RED <code> …` on stderr; returns the stderr."""
    assert captured.out == "", captured.out
    assert captured.err.startswith(f"ESLEME_ICE_AKTARIM_RED {code} "), captured.err
    return captured.err


async def _both(db):
    await v2_ward(db)
    await import_v2(db, tenant_slug=SLUG, data=V2.read_bytes(), audit=None)
    source = PostgresDeviceBeds(TEST_DATABASE_URL, hospital=SLUG, clock=lambda: 0.0)
    try:
        database = source.current()
    finally:
        source.dispose()
    return TableFile(V2, clock=lambda: 0.0).current(), database


def _same_strip_and_rows(file, database) -> None:
    assert (file.status, database.status) == ("ok", "ok")
    assert database.table.rows == file.table.rows
    assert database.sha256 == V2_DIGEST
    sources = {row.source for row in file.table.rows} | {"10.10.203.99"}
    start = min(row.valid_from for row in file.table.rows)
    for source in sources:
        for moment in (start - timedelta(seconds=1), start, time.time(), 4102444800.0):   # 2100-01-01
            assert database.table.at(source, moment) == file.table.at(source, moment), (source, moment)


async def test_the_database_holds_the_files_rows_in_the_files_order(db_session):
    file, database = await _both(db_session)
    assert (file.status, database.status) == ("ok", "ok")
    assert database.table.rows == file.table.rows
    assert database.sha256 == V2_DIGEST


async def test_every_source_resolves_to_the_same_row_at_every_moment(db_session):
    file, database = await _both(db_session)
    _same_strip_and_rows(file, database)


async def test_the_strip_places_every_monitor_alike(db_session):
    file, database = await _both(db_session)
    sources = sorted({row.source for row in file.table.rows} | {"10.10.203.99"})
    devices = {s: DeviceView(s, "224.0.2." + s.rsplit(".", 1)[1], 2050, "streaming", 1.0, 120.0, ())
               for s in sources}
    occupants = {normalise_id(BEDS["05"]): ["H2600042"], normalise_id(BEDS["06"]): ["H2600043", "H2600044"]}

    def view(state):
        body = board_view(devices, {}, state, occupants=occupants, visible=lambda card: True,
                          patient_visible=lambda card: True, show_unassigned=True, now=time.time())
        return body["beds"], body["unassigned"]

    assert view(database) == view(file)
    beds, unassigned = view(database)
    assert [c["source"] for c in unassigned] == ["10.10.203.99"]
    links = {c["bed_label"]: c["link"] for c in beds}
    assert (links["BED05"], links["BED06"], links["BED01"]) == ("one", "ambiguous", "none")


async def test_the_command_line_prints_the_line_then_already(db_session, tmp_path, capsys):
    await v2_ward(db_session)
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)
    audit = InMemoryAuditLog()
    script = _script()
    assert await script.run(["--file", str(V2), "--tenant", SLUG], maker=maker, audit=audit) == 0
    captured = capsys.readouterr()
    first = _line(captured.out)
    assert captured.err == ""
    assert set(first) == {"tenant", "file_sha256", "rows", "with_bed", "without_bed", "granted", "version",
                          "sha256", "already", "dry_run"}
    assert (first["rows"], first["with_bed"], first["without_bed"], first["sha256"]) == (13, 12, 1, V2_DIGEST)
    assert (first["tenant"], first["already"], first["dry_run"]) == (SLUG, False, False)
    assert first["granted"] == ["charge_nurse"] and len(audit.records()) == 1
    assert await script.run(["--file", str(V2), "--tenant", SLUG], maker=maker, audit=audit) == 0
    again = _line(capsys.readouterr().out)
    assert again["already"] is True and again["version"] == first["version"] and again["sha256"] == V2_DIGEST
    assert again["granted"] == [] and len(audit.records()) == 1
    bad = tmp_path / "v2.json"
    bad.write_bytes(V2.read_bytes() + b"\n")
    assert await script.run(["--file", str(bad), "--tenant", SLUG], maker=maker, audit=audit) == 2
    assert "ESLEME_ICE_AKTARIM_RED 2" in capsys.readouterr().err
    assert await script.run(["--file", str(tmp_path / "yok.json"), "--tenant", SLUG], maker=maker) == 2
    assert await script.run(["--file", str(V2), "--tenant", " "], maker=maker) == 2


async def test_dry_run_checks_everything_and_writes_nothing(db_session, capsys):
    tenant, _ = await v2_ward(db_session)
    tenant_id = tenant.id
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)
    audit = InMemoryAuditLog()
    assert await _script().run(["--file", str(V2), "--tenant", SLUG, "--dry-run"], maker=maker, audit=audit) == 0
    captured = capsys.readouterr()
    line = _line(captured.out)
    assert captured.err == ""
    assert (line["dry_run"], line["already"], line["rows"], line["granted"], line["sha256"]) == (
        True, False, 13, [], V2_DIGEST)
    async with maker() as db:
        assert (await db.execute(select(DeviceBed).where(DeviceBed.tenant_id == tenant_id))).first() is None
        assert (await db.execute(text("SELECT count(*) FROM group_permissions WHERE permission = :k"),
                                 {"k": GRANT_KEY})).scalar_one() == 0
    assert audit.records() == []


async def test_every_refusal_is_on_stderr_with_its_code_and_stdout_stays_empty(db_session, tmp_path, capsys,
                                                                              monkeypatch):
    tenant, _ = await v2_ward(db_session)
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)
    script = _script()
    monkeypatch.delenv("INFINITY_SHADOW_HOSPITAL", raising=False)

    def edited(name: str, payload: bytes):
        path = tmp_path / name
        path.write_bytes(payload)
        return path

    exit_2 = [
        (["--file", str(V2)], "kiracı verilmedi"),                                         # no tenant at all
        (["--file", str(V2), "--tenant", "  "], "kiracı verilmedi"),
        (["--file", str(V2), "--tenant", "olmayan-hastane"], "kiracı yok"),
        (["--file", str(tmp_path / "yok.json"), "--tenant", SLUG], "dosya okunamadı"),
        (["--file", str(tmp_path), "--tenant", SLUG], "dosya okunamadı"),                    # a directory
        (["--file", str(edited("buyuk.json", b" " * (MAX_BYTES + 1))), "--tenant", SLUG], "büyük"),
        (["--file", str(edited("v2x.json", V2.read_bytes() + b"\n")), "--tenant", SLUG], "sha256"),
    ]
    for argv, reason in exit_2:
        assert await script.run(argv, maker=maker) == 2, argv
        assert reason in _refusal(capsys.readouterr(), 2), argv
    async with maker() as db:                                                              # nothing was written
        assert (await db.execute(select(DeviceBed).where(DeviceBed.tenant_id == tenant.id))).first() is None
    # the tenant can also come from the environment, as the deploy block's INFINITY_SHADOW_HOSPITAL
    monkeypatch.setenv("INFINITY_SHADOW_HOSPITAL", SLUG)
    assert await script.run(["--file", str(V2)], maker=maker) == 0
    assert _line(capsys.readouterr().out)["tenant"] == SLUG


async def test_a_table_edited_since_is_exit_3_on_stderr(db_session, capsys):
    tenant, _ = await v2_ward(db_session)
    tenant_id = tenant.id
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)
    script = _script()
    assert await script.run(["--file", str(V2), "--tenant", SLUG], maker=maker) == 0
    capsys.readouterr()
    first = (await db_session.execute(select(DeviceBed).order_by(DeviceBed.id))).scalars().first()
    db_session.add(DeviceBed(tenant_id=tenant_id, source="10.10.203.40", group_address="224.0.2.40", port=2050,
                             valid_from=first.valid_from, approved_by="x", approved_at=first.approved_at))
    await db_session.commit()
    assert await script.run(["--file", str(V2), "--tenant", SLUG], maker=maker) == 3
    assert "başka satırlar" in _refusal(capsys.readouterr(), 3)


class _FailsLikeADriver:
    """A session maker whose session cannot even open: it raises what a driver raises, with the
    statement and its parameters in the message — what a bare traceback would have printed. `pgcode` is the
    SQLSTATE the driver's own exception carries (or does not)."""

    def __init__(self, pgcode=None):
        orig = Exception(f"tuzak {MARKER}")
        orig.pgcode = pgcode
        self.error = DBAPIError("INSERT INTO device_beds (source) VALUES (%(source)s)", {"source": MARKER}, orig)

    def __call__(self):
        return self

    async def __aenter__(self):
        raise self.error

    async def __aexit__(self, *exc_info):
        return False


@pytest.mark.parametrize("pgcode, label", [
    ("28P01", "DBAPIError 28P01"),               # a failed login: the SQLSTATE tells it from a lock timeout
    (None, "DBAPIError"),                         # a driver that gave none
    (MARKER, "DBAPIError"),                       # not 5 characters: text, not a SQLSTATE - never printed
])
async def test_an_unexpected_failure_is_exit_1_with_the_class_and_sqlstate_only_and_no_traceback(
        capsys, pgcode, label):
    failing = _FailsLikeADriver(pgcode)
    assert MARKER in str(failing.error)                                 # what the default traceback would carry
    assert await _script().run(["--file", str(V2), "--tenant", SLUG], maker=failing) == 1
    err = _refusal(capsys.readouterr(), 1)
    assert err.startswith(f"ESLEME_ICE_AKTARIM_RED 1 {label} — satırlar yazılmış olabilir; yeniden çalıştırın "
                          "— already:true ise yazılmıştır"), err
    assert MARKER not in err and "INSERT" not in err and "Traceback" not in err and "tuzak" not in err
    assert err.count("\n") == 1


async def test_a_lock_timeout_is_exit_1_nothing_is_written_and_a_rerun_succeeds(db_session, capsys, monkeypatch):
    """The tenant's row is held (FOR UPDATE, as another importer or a tenant edit would): `import_v2`'s own
    `lock_timeout` ends the wait with a DBAPIError — not an ImportRefused. The CLI answers exit 1, and the
    advice it prints works: once the lock is gone the same command imports."""
    tenant, _ = await v2_ward(db_session)
    tenant_id = tenant.id
    monkeypatch.setattr(seed, "LOCK_TIMEOUT", "300ms")
    engine = db_session.bind
    maker = async_sessionmaker(engine, expire_on_commit=False)
    script = _script()
    async with engine.connect() as holder:
        await holder.execute(text("SELECT id FROM tenants WHERE slug = :s FOR UPDATE"), {"s": SLUG})
        assert await script.run(["--file", str(V2), "--tenant", SLUG], maker=maker) == 1
    err = _refusal(capsys.readouterr(), 1)
    assert err.startswith("ESLEME_ICE_AKTARIM_RED 1 DBAPIError 55P03 ")  # lock_not_available, by class and SQLSTATE
    assert "satırlar yazılmış olabilir" in err and "Traceback" not in err and "[SQL:" not in err
    async with maker() as db:
        assert (await db.execute(select(DeviceBed).where(DeviceBed.tenant_id == tenant_id))).first() is None
    assert await script.run(["--file", str(V2), "--tenant", SLUG], maker=maker) == 0
    assert _line(capsys.readouterr().out)["already"] is False


async def test_the_deployed_path_without_a_database_url_is_exit_2_not_a_traceback(capsys, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert await _script().run(["--file", str(V2), "--tenant", SLUG]) == 2          # maker=None: the app's own engine
    assert "DATABASE_URL" in _refusal(capsys.readouterr(), 2)


# --- A-12: the migrated chain (0014's triggers present) ----------------------------------------------------

def _migrated_ward(engine) -> uuid.UUID:
    """The v2 ward by raw SQL on the migrated schema: one tenant, one unit, twelve beds of v2's UUIDs, and
    the groups the grant looks for. Returns the tenant id."""
    tenant, site = uuid.uuid4(), uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO tenants (id, name, slug, country_code) VALUES (:i, 'Sentetik', :s, 'AZ')"),
                     {"i": tenant, "s": SLUG})
        conn.execute(text("INSERT INTO sites (id, tenant_id, name) VALUES (:i, :t, 'Ana bina')"),
                     {"i": site, "t": tenant})
        conn.execute(text("INSERT INTO units (id, site_id, name, unit_type) VALUES (:i, :s, 'Reanimasiya', 'ADULT_ICU')"),
                     {"i": UNIT, "s": site})
        for nn, bed in BEDS.items():
            room = uuid.uuid4()
            conn.execute(text("INSERT INTO rooms (id, unit_id, name) VALUES (:i, :u, :n)"),
                         {"i": room, "u": UNIT, "n": f"Otaq {nn}"})
            conn.execute(text("INSERT INTO beds (id, room_id, label) VALUES (:i, :r, :l)"),
                         {"i": bed, "r": room, "l": f"bed{nn}"})
        for slug, system in (("charge_nurse", False), ("hospital_admin", True)):      # no group holds the key: pre-slice
            conn.execute(text("INSERT INTO groups (id, tenant_id, slug, name, mfa_required, is_system, created_at, "
                              "updated_at) VALUES (:i, :t, :s, :s, false, :y, now(), now())"),
                         {"i": uuid.uuid4(), "t": tenant, "s": slug, "y": system})
    return tenant


async def _import_twice(*, audit):
    engine = create_async_engine(TEST_DATABASE_URL)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with maker() as db:
            first = await import_v2(db, tenant_slug=SLUG, data=V2.read_bytes(), audit=audit)
        async with maker() as db:
            again = await import_v2(db, tenant_slug=SLUG, data=V2.read_bytes(), audit=audit)
        return first, again
    finally:
        await engine.dispose()


def test_the_import_commits_on_the_migrated_chain_and_the_history_stays_kept(clean_db):
    """A-12: with the triggers present the import inserts its 13 rows, grants, and says `already` on a re-run;
    the database still refuses what the trigger forbids — an edit of a stored row, a close in the future and an
    edit of a closed row — and C2's parity holds on this schema (built by the migration, not by `create_all`)."""
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    _migrated_ward(engine)
    audit = InMemoryAuditLog()

    first, again = asyncio.run(_import_twice(audit=audit))

    assert (first.rows, first.already, first.granted, first.sha256) == (13, False, ["charge_nurse"], V2_DIGEST)
    assert again.already is True and again.granted == [] and (again.version, again.sha256) == (first.version, first.sha256)
    assert len(audit.records()) == 1
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM device_beds")).scalar_one() == 13
        assert conn.execute(text("SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'device_beds_%'")).scalar_one() == 3
        held = {r[0] for r in conn.execute(text(
            "SELECT g.slug FROM groups g JOIN group_permissions p ON p.group_id = g.id WHERE p.permission = :k"),
            {"k": GRANT_KEY})}
        assert held == {"charge_nurse"}                                    # not the system group
        first_id = conn.execute(text("SELECT min(id) FROM device_beds")).scalar_one()
        assert first.version == conn.execute(text("SELECT max(id) FROM device_beds")).scalar_one()

    # C2 on the migrated schema: the same Rows, the same placement at every moment
    accessor = PostgresDeviceBeds(TEST_DATABASE_URL, hospital=SLUG, clock=lambda: 0.0)
    try:
        database = accessor.current()
    finally:
        accessor.dispose()
    _same_strip_and_rows(TableFile(V2, clock=lambda: 0.0).current(), database)
    assert (database.version, database.sha256) == (first.version, first.sha256)

    # the forbidden variants still raise
    with pytest.raises(DBAPIError, match=KEPT), engine.begin() as conn:                 # an edit of a stored row
        conn.execute(text("UPDATE device_beds SET note = 'x' WHERE id = :id"), {"id": first_id})
    with pytest.raises(DBAPIError, match=KEPT), engine.begin() as conn:                 # a close at t + 1 h
        conn.execute(text("UPDATE device_beds SET valid_to = clock_timestamp() + interval '1 hour' WHERE id = :id"),
                     {"id": first_id})
    with engine.begin() as conn:                                                        # the editor's close: allowed
        conn.execute(text("UPDATE device_beds SET valid_to = now() WHERE id = :id"), {"id": first_id})
    with pytest.raises(DBAPIError, match=KEPT), engine.begin() as conn:                 # an edit of a closed row
        conn.execute(text("UPDATE device_beds SET note = 'x' WHERE id = :id"), {"id": first_id})
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM device_beds WHERE valid_to IS NULL")).scalar_one() == 12
        assert conn.execute(text("SELECT note FROM device_beds WHERE id = :id"), {"id": first_id}).scalar_one() != "x"


def _run_script(*args: str) -> subprocess.CompletedProcess:
    """The script as the deploy block runs it: a process of its own, the database from ITS environment."""
    env = {**os.environ, "DATABASE_URL": TEST_DATABASE_URL, "PYTHONPATH": str(ENGINE_ROOT / "src"),
           "PYTHONDONTWRITEBYTECODE": "1", "PYTHONUTF8": "1"}
    env.pop("INFINITY_SHADOW_HOSPITAL", None)
    return subprocess.run([sys.executable, str(SCRIPT), *args], env=env, cwd=ENGINE_ROOT, capture_output=True,
                          text=True, encoding="utf-8", timeout=120, stdin=subprocess.DEVNULL)


def test_the_script_as_a_process_on_the_migrated_chain_exit_0_0_3(clean_db):
    """The deployed path (`maker=None`: the app's own engine, the Postgres audit) in a process of its own:
    stdout is the one line (E15); the re-run is `already`; after the editor's first close the table is no
    longer the file's and the script says exit 3 and writes nothing."""
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    _migrated_ward(engine)

    first = _run_script("--file", str(V2), "--tenant", SLUG)
    assert first.returncode == 0, first.stderr
    body = _line(first.stdout)
    assert (body["rows"], body["granted"], body["already"], body["sha256"]) == (13, ["charge_nurse"], False, V2_DIGEST)
    assert "Traceback" not in first.stderr
    with engine.connect() as conn:
        [audited] = conn.execute(text("SELECT payload FROM audit WHERE tenant = :s AND event_type = 'device_bed.import'"),
                                 {"s": SLUG}).all()
        assert audited[0]["sha256"] == V2_DIGEST and audited[0]["version"] == body["version"]

    again = _run_script("--file", str(V2), "--tenant", SLUG)
    assert again.returncode == 0, again.stderr
    assert _line(again.stdout)["already"] is True and _line(again.stdout)["version"] == body["version"]
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM audit WHERE event_type = 'device_bed.import'")).scalar_one() == 1

    with engine.begin() as conn:                                                        # the editor closes one row
        conn.execute(text("UPDATE device_beds SET valid_to = now() WHERE id = (SELECT min(id) FROM device_beds)"))
    edited = _run_script("--file", str(V2), "--tenant", SLUG)
    assert edited.returncode == 3 and edited.stdout == ""
    assert edited.stderr.startswith("ESLEME_ICE_AKTARIM_RED 3 "), edited.stderr
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM device_beds")).scalar_one() == 13

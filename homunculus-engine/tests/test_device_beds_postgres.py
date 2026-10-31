# homunculus-engine/tests/test_device_beds_postgres.py
"""`PostgresDeviceBeds` on the test database (spec §5.3): the tenant's rows as `Row`s, `version` =
max(id), `sha256` = rows_digest of the current rows, `site` = the tenant's name; only rows valid now;
the 10-s cache and `invalidate()`; `missing` and `invalid` fail closed, a stalled database included
(A-10). Synthetic rows only."""
from __future__ import annotations

import contextlib
import logging
import socket
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine

from homunculus.api.audit_postgres import to_sync_url
from homunculus.api.device_beds_postgres import PostgresDeviceBeds
from homunculus.api.infinity_device_beds import DeviceBedSource, Row, rows_digest
from homunculus.devicebeds.models import DeviceBed
from homunculus.devicebeds.rows import to_row
from homunculus.tenant.models import Bed, Room, Site, Tenant, Unit, UnitType
from tests.conftest import TEST_DATABASE_URL, requires_db

pytestmark = [requires_db]
SLUG = "esleme-hastane"
LOGGER = "homunculus.api.device_beds_postgres"
FROM = datetime(2026, 10, 19, tzinfo=timezone.utc)
APPROVED = datetime(2026, 10, 27, tzinfo=timezone.utc)


async def _ward(db):
    tenant = Tenant(name="Sentetik Eşleme Hastanesi", slug=SLUG, country_code="AZ")
    db.add(tenant)
    await db.flush()
    site = Site(tenant_id=tenant.id, name="Ana bina")
    db.add(site)
    await db.flush()
    unit = Unit(site_id=site.id, name="Reanimasiya", unit_type=UnitType.ADULT_ICU)
    db.add(unit)
    await db.flush()
    room = Room(unit_id=unit.id, name="Otaq 05")
    db.add(room)
    await db.flush()
    bed = Bed(room_id=room.id, label="bed05")
    db.add(bed)
    await db.flush()
    return tenant, unit, bed


def _device(tenant, source, *, bed=None, unit=None, label=None, valid_to=None, approved_at=APPROVED):
    return DeviceBed(tenant_id=tenant.id, source=source, group_address="224.0.2." + source.rsplit(".", 1)[1],
                     port=2050, device_bed_label=label, bed_label=label,
                     bed_id=None if bed is None else bed.id, unit_id=None if unit is None else unit.id,
                     method="central_station_list" if label else None, verified_at="2026-09-22" if label else None,
                     note=None if label else "atanmamış", valid_from=FROM, valid_to=valid_to,
                     approved_by="proje sahibi", approved_at=approved_at)


def _source(clock=None):
    return PostgresDeviceBeds(TEST_DATABASE_URL, hospital=SLUG, clock=clock or (lambda: 0.0))


def _timed_current(source, patience=8.0):
    """`source.current()` on a daemon thread, so that a read that never returns fails the test instead
    of hanging the suite: (its state, or None if it had not returned after `patience`; seconds taken)."""
    box = []
    started = time.monotonic()
    worker = threading.Thread(target=lambda: box.append(source.current()), daemon=True)
    worker.start()
    worker.join(patience)
    return (box[0] if box else None), time.monotonic() - started


@contextlib.contextmanager
def _silent_server():
    """A TCP server that accepts and never answers: the port of a database that stalls."""
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.bind(("127.0.0.1", 0))
    server.listen(5)
    server.settimeout(0.2)
    held, stop = [], threading.Event()

    def accept_forever():
        while not stop.is_set():
            try:
                held.append(server.accept()[0])
            except socket.timeout:
                continue
            except OSError:
                return

    threading.Thread(target=accept_forever, daemon=True).start()
    try:
        yield server.getsockname()[1]
    finally:
        stop.set()
        server.close()
        for connection in held:
            connection.close()


async def test_a_tenant_without_rows_is_missing_and_places_nothing(db_session):
    await _ward(db_session)
    await db_session.commit()
    state = _source().current()
    assert isinstance(_source(), DeviceBedSource)
    assert (state.status, state.table, state.version, state.sha256) == ("missing", None, None, None)
    assert "satır yok" in state.reason
    assert PostgresDeviceBeds(TEST_DATABASE_URL, hospital="baska", clock=lambda: 0.0).current().status == "missing"


async def test_the_rows_are_the_strips_rows_with_version_digest_site_and_approval(db_session):
    tenant, unit, bed = await _ward(db_session)
    bound = _device(tenant, "10.10.203.23", bed=bed, unit=unit, label="BED05")
    label_only = _device(tenant, "10.10.203.25", label="BED01", approved_at=APPROVED + timedelta(days=1))
    db_session.add_all([bound, label_only])
    await db_session.commit()
    state = _source().current()
    assert state.status == "ok" and state.reason is None
    assert state.table.rows == (
        Row("10.10.203.23", "224.0.2.23", 2050, "BED05", str(bed.id), str(unit.id), "central_station_list",
            "2026-09-22", FROM, None, None),
        Row("10.10.203.25", "224.0.2.25", 2050, "BED01", None, None, "central_station_list",
            "2026-09-22", FROM, None, None),
    )
    assert state.version == state.table.version == label_only.id
    assert state.sha256 == rows_digest(state.table.rows)
    assert state.table.site == "Sentetik Eşleme Hastanesi"
    assert (state.table.approved_by, state.table.approved_at) == ("proje sahibi", "2026-10-28")
    assert all(r.valid_from.utcoffset() == timedelta(0) for r in state.table.rows)


async def test_the_ids_are_lower_case_hyphenated_text_never_a_uuid_object(db_session):
    """A-9 addendum: `rows_digest` and `check_current` raise on a `uuid.UUID`, and the strip tells beds
    apart by the text."""
    tenant, unit, bed = await _ward(db_session)
    db_session.add(_device(tenant, "10.10.203.23", bed=bed, unit=unit, label="BED05"))
    await db_session.commit()
    row = _source().current().table.rows[0]
    assert type(row.bed_id) is str and type(row.unit_id) is str
    assert row.bed_id == str(bed.id) == str(bed.id).lower() and len(row.bed_id) == 36
    assert row.unit_id == str(unit.id)


def test_to_row_builds_the_ids_as_text_from_a_uuid_or_a_mapping_row():
    bed_id, unit_id = uuid.uuid4(), uuid.uuid4()
    columns = dict(source="10.10.203.23", group_address="224.0.2.23", port=2050, bed_label="BED05",
                   bed_id=bed_id, unit_id=unit_id, method="editor", verified_at="2026-10-30T09:12:03+00:00",
                   valid_from=FROM, valid_to=None, note=None)
    row = to_row(columns)                                            # a mapping, as a SQLAlchemy RowMapping
    assert (type(row.bed_id), type(row.unit_id)) == (str, str)
    assert (row.bed_id, row.unit_id) == (str(bed_id), str(unit_id))
    assert row.group == "224.0.2.23" and row.valid_to is None
    unbound = to_row({**columns, "bed_id": None, "unit_id": None, "bed_label": None})
    assert (unbound.bed_id, unbound.unit_id, unbound.bed_label) == (None, None, None)


async def test_only_rows_valid_now_are_loaded_and_the_version_counts_history(db_session):
    tenant, unit, bed = await _ward(db_session)
    old = _device(tenant, "10.10.203.23", bed=bed, unit=unit, label="BED05",
                  valid_to=datetime.now(timezone.utc) - timedelta(hours=1))
    db_session.add(old)
    await db_session.flush()
    new = _device(tenant, "10.10.203.23", bed=bed, unit=unit, label="bed05")
    db_session.add(new)
    await db_session.commit()
    state = _source().current()
    assert [r.bed_label for r in state.table.rows] == ["bed05"]
    assert state.version == new.id > old.id


async def test_a_row_closed_ahead_of_the_api_clock_loads_beside_its_successor_and_resolves_by_time(db_session):
    """E4: a change closes the old row and opens the new one at the database's time t. While the API's wall
    clock is still behind t, both rows are loaded (`valid_to > :now`), `check_current` looks at the open row
    only, and `table.at()` resolves each moment to its own row; once the clock passes t the closed row is no
    longer loaded and the digest, which is of the current rows alone, has not changed."""
    tenant, unit, bed = await _ward(db_session)
    t = datetime.now(timezone.utc) - timedelta(seconds=30)
    old = _device(tenant, "10.10.203.23", bed=bed, unit=unit, label="BED05", valid_to=t)
    db_session.add(old)
    await db_session.flush()
    new = _device(tenant, "10.10.203.23", label="BED05")                # the unbind: no bed, opened at t
    new.valid_from = t
    db_session.add(new)
    await db_session.commit()

    behind = PostgresDeviceBeds(TEST_DATABASE_URL, hospital=SLUG, clock=lambda: 0.0,
                                wall=lambda: (t - timedelta(seconds=5)).timestamp())
    state = behind.current()
    assert state.status == "ok", state.reason                          # check_current stayed quiet
    assert [r.valid_to is None for r in state.table.rows] == [False, True]
    assert state.table.at("10.10.203.23", t - timedelta(seconds=5)).bed_id == str(bed.id)
    assert state.table.at("10.10.203.23", t + timedelta(seconds=5)).bed_id is None
    assert state.version == new.id

    ahead = PostgresDeviceBeds(TEST_DATABASE_URL, hospital=SLUG, clock=lambda: 0.0,
                               wall=lambda: (t + timedelta(seconds=5)).timestamp())
    later = ahead.current()
    assert later.status == "ok" and [r.valid_to is None for r in later.table.rows] == [True]
    assert later.sha256 == state.sha256 and later.version == state.version


async def test_a_tenant_whose_every_row_is_closed_is_missing(db_session):
    tenant, unit, bed = await _ward(db_session)
    db_session.add(_device(tenant, "10.10.203.23", bed=bed, unit=unit, label="BED05",
                           valid_to=datetime.now(timezone.utc) - timedelta(hours=1)))
    await db_session.commit()
    state = _source().current()
    assert (state.status, state.table, state.version, state.sha256) == ("missing", None, None, None)


async def test_the_read_is_cached_ten_seconds_and_invalidate_reads_again(db_session):
    tenant, unit, bed = await _ward(db_session)
    db_session.add(_device(tenant, "10.10.203.23", bed=bed, unit=unit, label="BED05"))
    await db_session.commit()
    now = [100.0]
    source = _source(lambda: now[0])
    first = source.current()
    db_session.add(_device(tenant, "10.10.203.26"))
    await db_session.commit()
    now[0] = 105.0
    assert source.current() is first                                   # inside RELOAD_EVERY_S
    source.invalidate()
    second = source.current()
    assert len(second.table.rows) == 2 and second.version > first.version
    assert second.sha256 != first.sha256
    db_session.add(_device(tenant, "10.10.203.27"))                    # a change the cache has not seen
    await db_session.commit()
    now[0] = 110.0
    assert source.current() is second                                  # still inside the window
    now[0] = 116.0
    third = source.current()                                           # past the window: a real re-read
    assert third is not second and len(third.table.rows) == 3 and third.version > second.version


async def test_dispose_closes_the_pool_and_the_source_still_reads(db_session):
    tenant, unit, bed = await _ward(db_session)
    db_session.add(_device(tenant, "10.10.203.23", bed=bed, unit=unit, label="BED05"))
    await db_session.commit()
    source = _source()
    assert source.current().status == "ok"
    source.dispose()
    source.invalidate()
    assert source.current().status == "ok"
    source.dispose()


async def test_a_broken_current_set_is_invalid_and_names_the_rule(db_session):
    """The database allows a bound row with a blank label; `check_current` does not, so the whole set
    is refused and no monitor is placed."""
    tenant, unit, bed = await _ward(db_session)
    blank = _device(tenant, "10.10.203.23", bed=bed, unit=unit, label=" ")
    db_session.add_all([blank, _device(tenant, "10.10.203.25", label="BED01")])
    await db_session.commit()
    state = _source().current()
    assert (state.status, state.table, state.version, state.sha256) == ("invalid", None, None, None)
    assert "10.10.203.23" in state.reason and "etiketi" in state.reason


async def test_a_change_of_state_is_logged_once(db_session, caplog):
    tenant, unit, bed = await _ward(db_session)
    db_session.add(_device(tenant, "10.10.203.23", bed=bed, unit=unit, label="BED05"))
    await db_session.commit()
    source = _source()
    with caplog.at_level(logging.INFO, logger=LOGGER):
        source.current()
        source.invalidate()
        assert source.current().status == "ok"                          # re-read, nothing changed
        said = [r for r in caplog.records if r.name == LOGGER]
        assert len(said) == 1 and said[0].levelno == logging.INFO
        db_session.add(_device(tenant, "10.10.203.26"))
        await db_session.commit()
        source.invalidate()
        source.current()
        said = [r for r in caplog.records if r.name == LOGGER]
        assert len(said) == 2                                            # the version moved: said again


def test_an_unreadable_database_is_invalid_and_places_nothing():
    state = PostgresDeviceBeds("postgresql://x:y@127.0.0.1:1/none", hospital=SLUG, clock=lambda: 0.0).current()
    assert (state.status, state.table) == ("invalid", None)
    assert "okunamadı" in state.reason


def test_an_outage_is_logged_once_with_the_error_class_only(caplog):
    """The same failure on every re-read is one line, not one per 10 s; the line names the exception's
    class, nothing from its message (a URL, a parameter)."""
    source = PostgresDeviceBeds("postgresql://x:y@127.0.0.1:1/none", hospital=SLUG, clock=lambda: 0.0)
    with caplog.at_level(logging.INFO, logger=LOGGER):
        first = source.current()
        source.invalidate()
        second = source.current()
    assert first.status == second.status == "invalid"
    said = [r for r in caplog.records if r.name == LOGGER]
    assert len(said) == 1 and said[0].levelno == logging.WARNING
    assert "[OperationalError]" in said[0].getMessage()                # a refused connection has no SQLSTATE
    assert "127.0.0.1" not in said[0].getMessage()


def test_the_failure_label_is_the_class_and_a_five_character_sqlstate_never_a_message():
    from homunculus.api.device_beds_postgres import _failure          # the module's private label

    class Failed(Exception):
        def __init__(self, pgcode):
            super().__init__("secret-detail")
            self.orig = type("Driver", (), {"pgcode": pgcode, "args": ("secret-detail",)})()

    assert _failure(Failed("57014")) == "Failed 57014"
    assert _failure(Failed(None)) == "Failed"
    assert _failure(Failed("57014 secret-detail")) == "Failed"          # not a SQLSTATE: nothing of it is kept
    assert _failure(Failed(57014)) == "Failed"
    assert _failure(RuntimeError("secret-detail")) == "RuntimeError"    # no `.orig` at all


def test_a_database_that_accepts_and_never_answers_is_invalid_within_seconds():
    """A-10: `current()` runs on the event loop; a server that takes the connection and stays silent must
    cost a few seconds, not the loop. The connect is bounded at 3 s."""
    with _silent_server() as port:
        source = PostgresDeviceBeds(f"postgresql://x:y@127.0.0.1:{port}/none", hospital=SLUG, clock=lambda: 0.0)
        state, elapsed = _timed_current(source)
    assert state is not None, "current() had not returned after 8 s"
    assert (state.status, state.table, state.version, state.sha256) == ("invalid", None, None, None)
    assert "okunamadı" in state.reason
    assert elapsed < 5.0, f"current() took {elapsed:.1f} s"


async def test_a_query_stalled_on_a_lock_is_cut_off_and_invalid(db_session, caplog):
    """A-10: past the connect, a statement is bounded too (statement_timeout 2 s): a table another session
    holds locked costs two seconds and a fail-closed answer. The log line carries the SQLSTATE, 57014
    (query_canceled), with the exception's class and nothing of its message (which holds the SQL)."""
    tenant, unit, bed = await _ward(db_session)
    db_session.add(_device(tenant, "10.10.203.23", bed=bed, unit=unit, label="BED05"))
    await db_session.commit()
    locker = create_engine(to_sync_url(TEST_DATABASE_URL))
    holder = locker.connect()
    try:
        holder.exec_driver_sql("LOCK TABLE device_beds IN ACCESS EXCLUSIVE MODE")
        with caplog.at_level(logging.INFO, logger=LOGGER):
            state, elapsed = _timed_current(_source())
    finally:
        holder.rollback()
        holder.close()
        locker.dispose()
    assert state is not None, "current() had not returned after 8 s"
    assert (state.status, state.table, state.version, state.sha256) == ("invalid", None, None, None)
    assert elapsed < 5.0, f"current() took {elapsed:.1f} s"
    said = [r.getMessage() for r in caplog.records if r.name == LOGGER]
    assert len(said) == 1 and "[OperationalError 57014]" in said[0]
    assert "device_beds" not in said[0] and "SELECT" not in said[0]


@pytest.mark.parametrize("broken", ["to_row", "check_current", "rows_digest"])
async def test_any_exception_in_the_read_fails_closed_and_the_old_state_is_not_served(
        db_session, caplog, monkeypatch, broken):
    """A-10: not only the database's errors. Whatever raises while the rows are built is `invalid` with
    no table, for the whole window too: the last `ok` is never kept, and nothing escapes into the loop."""
    tenant, unit, bed = await _ward(db_session)
    db_session.add(_device(tenant, "10.10.203.23", bed=bed, unit=unit, label="BED05"))
    await db_session.commit()
    source = _source()
    assert source.current().status == "ok"

    def boom(*args, **kwargs):
        raise RuntimeError("secret-detail")

    monkeypatch.setattr(f"{PostgresDeviceBeds.__module__}.{broken}", boom)
    source.invalidate()
    with caplog.at_level(logging.INFO, logger=LOGGER):
        state = source.current()
        again = source.current()                                       # inside the window: still the failure
    assert (state.status, state.table, state.version, state.sha256) == ("invalid", None, None, None)
    assert again is state
    said = " ".join(r.getMessage() for r in caplog.records if r.name == LOGGER)
    assert "RuntimeError" in said and "secret-detail" not in said

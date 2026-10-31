# homunculus-engine/tests/test_device_beds_postgres.py
"""`PostgresDeviceBeds` on the test database (spec §5.3): the tenant's rows as `Row`s, `version` =
max(id), `sha256` = rows_digest of the current rows, `site` = the tenant's name; only rows valid now;
the 10-s cache and `invalidate()`; `missing` and `invalid` fail closed. Synthetic rows only."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

from homunculus.api.device_beds_postgres import PostgresDeviceBeds
from homunculus.api.infinity_device_beds import DeviceBedSource, Row, rows_digest
from homunculus.devicebeds.models import DeviceBed
from homunculus.devicebeds.rows import to_row
from homunculus.tenant.models import Bed, Room, Site, Tenant, Unit, UnitType
from tests.conftest import TEST_DATABASE_URL, requires_db

pytestmark = [requires_db]
SLUG = "esleme-hastane"
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
    now[0] = 116.0
    assert len(source.current().table.rows) == 2                       # past the window: re-read


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
    with caplog.at_level(logging.INFO, logger="homunculus.api.device_beds_postgres"):
        source.current()
        source.invalidate()
        assert source.current().status == "ok"                          # re-read, nothing changed
        said = [r for r in caplog.records if r.name == "homunculus.api.device_beds_postgres"]
        assert len(said) == 1 and said[0].levelno == logging.INFO
        db_session.add(_device(tenant, "10.10.203.26"))
        await db_session.commit()
        source.invalidate()
        source.current()
        said = [r for r in caplog.records if r.name == "homunculus.api.device_beds_postgres"]
        assert len(said) == 2                                            # the version moved: said again


def test_an_unreadable_database_is_invalid_and_places_nothing():
    state = PostgresDeviceBeds("postgresql://x:y@127.0.0.1:1/none", hospital=SLUG, clock=lambda: 0.0).current()
    assert (state.status, state.table) == ("invalid", None)
    assert "okunamadı" in state.reason

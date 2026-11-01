# homunculus-engine/tests/test_migration_0015_protocol.py
"""Migration 0015 (G2-B1d, spec §3) on the real chain (`clean_db`, never `create_all`): purely
additive — `protocol_settings` (one row per tenant, none written by the migration: no admission
until the administrator sets the start number, D5) and `admissions.protocol_no`, which every row
written before it keeps NULL (D7: a legacy admission keeps its H-number key). Twelve ASCII digits
or NULL (a CHECK); one number per tenant, NULLs never colliding (a partial unique index); the dpi
203 or 300; the settings go with their tenant. The model agrees with the migration; 0013 → 0015 →
0013 → 0015 runs. Synthetic rows only."""
from __future__ import annotations

import uuid

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect, text
from sqlalchemy.exc import DBAPIError, IntegrityError

import homunculus.admission.models  # noqa: F401  (register every table on Base.metadata)
import homunculus.auth.models  # noqa: F401
import homunculus.escalation.models  # noqa: F401
import homunculus.protocol.models  # noqa: F401
import homunculus.tenant.models  # noqa: F401
from homunculus.db import Base
from tests.conftest import requires_db

pytestmark = [requires_db]
SETTINGS = "protocol_settings"
INDEX = "uq_admissions_tenant_protocol"
CHECK = "ck_admissions_protocol_no"


def _tenant(conn, slug: str) -> uuid.UUID:
    tid = uuid.uuid4()
    conn.execute(text("INSERT INTO tenants (id, name, slug, country_code) VALUES (:id, :n, :s, 'AZ')"),
                 {"id": tid, "n": f"Sentetik {slug}", "s": slug})
    return tid


def _bed(conn, tenant: uuid.UUID) -> uuid.UUID:
    site, unit, room, bed = (uuid.uuid4() for _ in range(4))
    conn.execute(text("INSERT INTO sites (id, tenant_id, name) VALUES (:id, :t, 'Ana bina')"),
                 {"id": site, "t": tenant})
    conn.execute(text("INSERT INTO units (id, site_id, name, unit_type) "
                      "VALUES (:id, :s, 'Reanimasiya', 'ADULT_ICU')"), {"id": unit, "s": site})
    conn.execute(text("INSERT INTO rooms (id, unit_id, name) VALUES (:id, :u, 'Otaq 1')"),
                 {"id": room, "u": unit})
    conn.execute(text("INSERT INTO beds (id, room_id, label) VALUES (:id, :r, '1')"),
                 {"id": bed, "r": room})
    return bed


def _admission(conn, tenant: uuid.UUID, bed: uuid.UUID, number: str, **columns) -> uuid.UUID:
    """A patient with its H-number and one DISCHARGED admission on `bed` (a closed state: the bed
    holds any number of them), with the other columns named."""
    patient, admission = uuid.uuid4(), uuid.uuid4()
    conn.execute(text("INSERT INTO patients (id, tenant_id, display_name, date_of_birth, sex, "
                      "patient_number, created_at) VALUES (:id, :t, 'x', 'x', 'x', :n, now())"),
                 {"id": patient, "t": tenant, "n": number})
    names = "".join(f", {name}" for name in columns)
    values = "".join(f", :{name}" for name in columns)
    conn.execute(text(
        "INSERT INTO admissions (id, patient_id, tenant_id, state, admission_datetime, "
        f"admitting_unit_id, bed_id, admission_diagnosis_free_text{names}) "
        f"SELECT :id, :p, :t, 'DISCHARGED', now(), r.unit_id, b.id, 'Sentetik tanı'{values} "
        "FROM beds b JOIN rooms r ON r.id = b.room_id WHERE b.id = :b"),
        {"id": admission, "p": patient, "t": tenant, "b": bed, **columns})
    return admission


def _columns(engine, table: str) -> set[str]:
    return {c["name"] for c in inspect(engine).get_columns(table)}


def test_0015_adds_the_settings_and_the_column_and_writes_no_row(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "0013")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        legacy = _admission(conn, tenant, _bed(conn, tenant), "H2600001")
    command.upgrade(cfg, "0015")
    with engine.connect() as conn:
        assert conn.execute(text("SELECT protocol_no FROM admissions WHERE id = :id"),
                            {"id": legacy}).scalar_one() is None              # D7: legacy stays
        assert conn.execute(text(f"SELECT count(*) FROM {SETTINGS}")).scalar_one() == 0   # D5
    assert "protocol_no" in _columns(engine, "admissions")
    command.downgrade(cfg, "0013")
    assert "protocol_no" not in _columns(engine, "admissions")
    assert SETTINGS not in inspect(engine).get_table_names()
    with engine.connect() as conn:
        assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0013"
        assert conn.execute(text("SELECT count(*) FROM admissions")).scalar_one() == 1


def test_one_protocol_number_per_tenant_and_nulls_never_collide(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        a, b = _tenant(conn, "hastane-a"), _tenant(conn, "hastane-b")
        bed_a, bed_b = _bed(conn, a), _bed(conn, b)
        _admission(conn, a, bed_a, "H2600001", protocol_no="202600000001")
        _admission(conn, a, bed_a, "H2600002")                      # NULL
        _admission(conn, a, bed_a, "H2600003")                      # NULL again: no collision
        _admission(conn, b, bed_b, "H2600001", protocol_no="202600000001")   # another tenant
    with pytest.raises(IntegrityError, match=INDEX), engine.begin() as conn:
        _admission(conn, a, bed_a, "H2600004", protocol_no="202600000001")


@pytest.mark.parametrize("value", [
    "20260000001",            # eleven digits
    "20260000000A",           # a letter
    "2026 0000001",           # a space
    "２０２６０００００００１",  # twelve full-width digits: digits to Unicode, not to the device
    "",
])
def test_a_protocol_number_is_twelve_ascii_digits(clean_db, value):
    if not value.isascii():
        # exactly twelve characters, so the CHECK's character class refuses it, not its length
        assert len(value) == 12
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        bed = _bed(conn, tenant)
    with pytest.raises(DBAPIError, match=CHECK), engine.begin() as conn:
        _admission(conn, tenant, bed, "H2600001", protocol_no=value)


def test_settings_default_to_a_50_by_30_label_at_203_dpi_and_take_no_other_dpi(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        conn.execute(text(f"INSERT INTO {SETTINGS} (tenant_id) VALUES (:t)"), {"t": tenant})
        row = conn.execute(text(f"SELECT next_no, last_issued, label_width_mm, label_height_mm, "
                                f"printer_dpi, updated_at IS NOT NULL FROM {SETTINGS}")).one()
    assert tuple(row) == (None, None, 50, 30, 203, True)
    with pytest.raises(IntegrityError), engine.begin() as conn:
        conn.execute(text(f"UPDATE {SETTINGS} SET printer_dpi = 600"))
    with engine.begin() as conn:
        conn.execute(text(f"UPDATE {SETTINGS} SET printer_dpi = 300, next_no = 202600000001"))
        conn.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tenant})
        assert conn.execute(text(f"SELECT count(*) FROM {SETTINGS}")).scalar_one() == 0   # CASCADE


def test_the_model_and_the_migration_agree_and_the_round_trip_runs(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    command.downgrade(cfg, "0013")
    command.upgrade(cfg, "0015")

    def only_0015(object_, name, type_, reflected, compare_to):
        if type_ == "table":
            return name in {SETTINGS, "admissions"}
        if type_ == "column":
            table = object_.table.name if object_ is not None else None
            return table == SETTINGS or (table == "admissions" and name == "protocol_no")
        if type_ == "index":
            return name == INDEX
        return False

    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn, opts={
            "compare_type": True, "compare_server_default": False, "include_object": only_0015})
        assert compare_metadata(ctx, Base.metadata) == []
        # compare_metadata reads no CHECK: both are read here, by name.
        checks = set(conn.execute(text(
            "SELECT conname FROM pg_constraint WHERE contype = 'c' AND conname IN "
            "('ck_admissions_protocol_no', 'ck_protocol_settings_dpi')")).scalars())
    assert checks == {CHECK, "ck_protocol_settings_dpi"}

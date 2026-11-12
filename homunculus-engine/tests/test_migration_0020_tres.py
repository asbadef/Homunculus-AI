# homunculus-engine/tests/test_migration_0020_tres.py
"""Migration 0020 (TRƏS-01, spec D3, D6, D23, D26) on the real chain (`clean_db`, never
`create_all`): purely additive — `tres_settings` (one row per tenant, none written: no row reads
as "off") and `tres_deliveries` (the ledger). The defaults, the CHECKs, the ledger's key with the
environment in it, the settings and the ledger gone with their tenant, a ledger row outliving its
admission; NO permission row for `tres.manage` (the system group holds it by rule); the model
agrees with the migration; 0019 → 0020 → 0019 → 0020 runs and the downgrade drops exactly the two
tables. The migration's two constants are the models' (no database for that one). Synthetic rows
only. F1–F5 extend this file with their tables (D26): F1 adds `tres_department_map` and
`tres_practitioner_identity` (each gone with its unit or user and with its tenant; the FİN is
ciphertext at rest) and the settings' `send_from` and `retried_at`."""
from __future__ import annotations

import importlib.util
import uuid
from pathlib import Path

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

import homunculus.admission.models  # noqa: F401  (register every table on Base.metadata)
import homunculus.auth.models  # noqa: F401
import homunculus.escalation.models  # noqa: F401
import homunculus.tenant.models  # noqa: F401
import homunculus.tres.models  # noqa: F401
from homunculus.admission.models import PHI_COLUMN_LENGTH
from homunculus.db import Base
from homunculus.tres.models import ALL_TYPES_JSON, RESOURCE_TYPES
from tests.conftest import requires_db

SETTINGS, DELIVERIES = "tres_settings", "tres_deliveries"
DEPARTMENTS, IDENTITIES = "tres_department_map", "tres_practitioner_identity"     # F1 (D16, D17)
DEPARTMENTS_INDEX = "ix_tres_department_map_tenant_id"
TABLES = {SETTINGS, DELIVERIES, DEPARTMENTS, IDENTITIES}
KEY, INDEX = "uq_tres_deliveries_key", "ix_tres_deliveries_tenant_status"
#: A stay's rows are read by its admission (the tab, the preview); and an admission's delete SETs NULL here.
ADMISSION_INDEX = "ix_tres_deliveries_admission_id"
CHECKS = {"ck_tres_settings_mode", "ck_tres_settings_environment", "ck_tres_settings_settle",
          "ck_tres_deliveries_environment", "ck_tres_deliveries_status", "ck_tres_deliveries_operation"}


def _migration():
    """The migration module, loaded by its path (its name starts with a digit)."""
    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0020_tres.py"
    spec = importlib.util.spec_from_file_location("migration_0020_tres", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_migrations_constants_are_the_models():
    """No database. The migration imports no model, so its copy of the default and of the
    ciphertext width is held to the models' here."""
    migration = _migration()
    assert migration.ALL_TYPES == ALL_TYPES_JSON
    assert migration.CIPHERTEXT == PHI_COLUMN_LENGTH
    assert (migration.revision, migration.down_revision) == ("0020", "0019")


def _tenant(conn, slug: str) -> uuid.UUID:
    tid = uuid.uuid4()
    conn.execute(text("INSERT INTO tenants (id, name, slug, country_code) VALUES (:id, :n, :s, 'AZ')"),
                 {"id": tid, "n": f"Sentetik {slug}", "s": slug})
    return tid


def _admission(conn, tenant: uuid.UUID) -> uuid.UUID:
    """A patient and one DISCHARGED admission on a bed of the tenant (as test_migration_0015)."""
    site, unit, room, bed, patient, admission = (uuid.uuid4() for _ in range(6))
    conn.execute(text("INSERT INTO sites (id, tenant_id, name) VALUES (:id, :t, 'Ana bina')"),
                 {"id": site, "t": tenant})
    conn.execute(text("INSERT INTO units (id, site_id, name, unit_type) "
                      "VALUES (:id, :s, 'Reanimasiya', 'ADULT_ICU')"), {"id": unit, "s": site})
    conn.execute(text("INSERT INTO rooms (id, unit_id, name) VALUES (:id, :u, 'Otaq 1')"),
                 {"id": room, "u": unit})
    conn.execute(text("INSERT INTO beds (id, room_id, label) VALUES (:id, :r, '1')"),
                 {"id": bed, "r": room})
    conn.execute(text("INSERT INTO patients (id, tenant_id, display_name, date_of_birth, sex, "
                      "patient_number, created_at) VALUES (:id, :t, 'x', 'x', 'x', 'H2600001', now())"),
                 {"id": patient, "t": tenant})
    conn.execute(text(
        "INSERT INTO admissions (id, patient_id, tenant_id, state, admission_datetime, "
        "admitting_unit_id, bed_id, admission_diagnosis_free_text) "
        "VALUES (:id, :p, :t, 'DISCHARGED', now(), :u, :b, 'Sentetik tanı')"),
        {"id": admission, "p": patient, "t": tenant, "u": unit, "b": bed})
    return admission


def _unit_of(conn, admission: uuid.UUID) -> uuid.UUID:
    return conn.execute(text("SELECT admitting_unit_id FROM admissions WHERE id = :id"),
                        {"id": admission}).scalar_one()


def _user(conn) -> uuid.UUID:
    uid = uuid.uuid4()
    conn.execute(text("INSERT INTO users (id, username, full_name, is_active, created_at, updated_at) "
                      "VALUES (:id, :u, 'Sentetik Hekim', true, now(), now())"),
                 {"id": uid, "u": f"hekim-{uid.hex[:8]}@sentetik.example.com"})
    return uid


def _delivery(conn, tenant: uuid.UUID, **columns) -> uuid.UUID:
    did = uuid.uuid4()
    values = {"id": did, "tenant_id": tenant, "environment": "test", "resource_type": "patient",
              "local_id": "hmn-p-0001", **columns}
    names = ", ".join(values)
    binds = ", ".join(f":{name}" for name in values)
    conn.execute(text(f"INSERT INTO {DELIVERIES} ({names}) VALUES ({binds})"), values)
    return did


@requires_db
def test_0020_adds_the_two_tables_and_writes_no_row_and_no_permission(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "0019")
    before = set(inspect(engine).get_table_names())
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        conn.execute(text(
            "INSERT INTO groups (id, tenant_id, slug, name, description, mfa_required, is_system, "
            "created_at, updated_at) VALUES (gen_random_uuid(), :t, 'hospital_admin', 'Sistem Yöneticisi', "
            "'', true, true, now(), now())"), {"t": tenant})
    command.upgrade(cfg, "0020")
    assert set(inspect(engine).get_table_names()) - before == TABLES
    with engine.connect() as conn:
        assert conn.execute(text(f"SELECT count(*) FROM {SETTINGS}")).scalar_one() == 0
        assert conn.execute(text(f"SELECT count(*) FROM {DELIVERIES}")).scalar_one() == 0
        # D23: the system group holds `tres.manage` by rule; no row is seeded for it.
        assert conn.execute(text(
            "SELECT count(*) FROM group_permissions WHERE permission = 'tres.manage'")).scalar_one() == 0
    command.downgrade(cfg, "0019")
    assert set(inspect(engine).get_table_names()) == before
    with engine.connect() as conn:
        assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0019"
        assert conn.execute(text("SELECT count(*) FROM tenants")).scalar_one() == 1


@requires_db
def test_settings_default_to_off_test_every_type_and_24_hours_and_the_checks_hold(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        conn.execute(text(f"INSERT INTO {SETTINGS} (tenant_id) VALUES (:t)"), {"t": tenant})
        row = conn.execute(text(
            f"SELECT mode, environment, settle_hours, enabled_types, test_password, live_base_url, "
            f"updated_at IS NOT NULL, updated_by, session_refused_at, send_from, retried_at FROM {SETTINGS}")).one()
    assert tuple(row) == ("off", "test", 24, list(RESOURCE_TYPES), None, None, True, None, None, None, None)
    for bad in ("mode = 'on'", "environment = 'prod'", "settle_hours = -1", "settle_hours = 169"):
        with pytest.raises(IntegrityError, match="ck_tres_settings_"), engine.begin() as conn:
            conn.execute(text(f"UPDATE {SETTINGS} SET {bad}"))
    with engine.begin() as conn:
        conn.execute(text(f"UPDATE {SETTINGS} SET mode = 'send', environment = 'live', settle_hours = 168"))
        conn.execute(text(f"UPDATE {SETTINGS} SET mode = 'validate', settle_hours = 0"))


@requires_db
def test_the_ledgers_key_holds_the_environment_and_its_checks_hold(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        a, b = _tenant(conn, "hastane-a"), _tenant(conn, "hastane-b")
        first = _delivery(conn, a)
        _delivery(conn, a, environment="live")            # a sandbox row never stands for live
        _delivery(conn, a, resource_type="practitioner")
        _delivery(conn, a, local_id="hmn-p-0002")
        _delivery(conn, b)                                # another tenant
        row = conn.execute(text(f"SELECT status, attempts, operation, remote_id, created_at IS NOT NULL, "
                                f"updated_at IS NOT NULL FROM {DELIVERIES} WHERE id = :id"), {"id": first}).one()
    assert tuple(row) == ("pending", 0, None, None, True, True)
    with pytest.raises(IntegrityError, match=KEY), engine.begin() as conn:
        _delivery(conn, a)
    for bad in ({"status": "done"}, {"operation": "patch"}, {"environment": "prod"}):
        with pytest.raises(IntegrityError, match="ck_tres_deliveries_"), engine.begin() as conn:
            _delivery(conn, a, local_id="hmn-p-0009", **bad)
    with engine.begin() as conn:
        for status in ("sent", "validated", "failed", "skipped", "stuck", "deleted", "pending"):
            conn.execute(text(f"UPDATE {DELIVERIES} SET status = :s WHERE id = :id"), {"s": status, "id": first})
        for operation in ("create", "update", "validate", "delete"):
            conn.execute(text(f"UPDATE {DELIVERIES} SET operation = :o WHERE id = :id"), {"o": operation, "id": first})


@requires_db
def test_a_ledger_row_outlives_its_admission_and_both_tables_go_with_the_tenant(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        admission = _admission(conn, tenant)
        delivery = _delivery(conn, tenant, admission_id=admission)
        conn.execute(text(f"INSERT INTO {SETTINGS} (tenant_id) VALUES (:t)"), {"t": tenant})
        conn.execute(text("DELETE FROM admissions WHERE id = :id"), {"id": admission})
        assert conn.execute(text(f"SELECT admission_id FROM {DELIVERIES} WHERE id = :id"),
                            {"id": delivery}).scalar_one() is None                 # SET NULL
        conn.execute(text("DELETE FROM patients WHERE tenant_id = :t"), {"t": tenant})
        conn.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tenant})
        assert conn.execute(text(f"SELECT count(*) FROM {DELIVERIES}")).scalar_one() == 0   # CASCADE
        assert conn.execute(text(f"SELECT count(*) FROM {SETTINGS}")).scalar_one() == 0


@requires_db
def test_the_model_and_the_migration_agree_and_the_round_trip_runs(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    command.downgrade(cfg, "0019")
    command.upgrade(cfg, "0020")

    def only_0020(object_, name, type_, reflected, compare_to):
        if type_ == "table":
            return name in TABLES
        if type_ == "column":
            return (object_.table.name if object_ is not None else None) in TABLES
        if type_ in ("index", "unique_constraint"):
            return name in {INDEX, KEY, ADMISSION_INDEX, DEPARTMENTS_INDEX}
        return False

    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn, opts={
            "compare_type": True, "compare_server_default": False, "include_object": only_0020})
        assert compare_metadata(ctx, Base.metadata) == []
        # compare_metadata reads no CHECK: they are read here, by name.
        checks = set(conn.execute(text(
            "SELECT conname FROM pg_constraint WHERE contype = 'c' AND conname LIKE 'ck_tres_%'")).scalars())
        indexes = set(conn.execute(text(
            "SELECT indexname FROM pg_indexes WHERE tablename = :t"), {"t": DELIVERIES}).scalars())
    assert checks == CHECKS
    assert {INDEX, KEY, ADMISSION_INDEX} <= indexes
    with engine.connect() as conn:
        assert DEPARTMENTS_INDEX in set(conn.execute(text(
            "SELECT indexname FROM pg_indexes WHERE tablename = :t"), {"t": DEPARTMENTS}).scalars())


@requires_db
def test_the_two_maps_go_with_their_unit_user_and_tenant_and_the_fin_is_ciphertext(clean_db):
    """F1 (D16, D17): one department row per unit, one identity per (tenant, user)."""
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        unit = _unit_of(conn, _admission(conn, tenant))
        doctor = _user(conn)
        conn.execute(text(f"INSERT INTO {DEPARTMENTS} (unit_id, tenant_id, code, display) "
                          "VALUES (:u, :t, 'RE-01', 'Reanimasiya')"), {"u": unit, "t": tenant})
        conn.execute(text(f"INSERT INTO {IDENTITIES} (tenant_id, user_id, fin, family_name, given_name) "
                          "VALUES (:t, :u, 'enc::v1::sentetik', 'Sentetikov', 'Elçin')"), {"t": tenant, "u": doctor})
        row = conn.execute(text(f"SELECT updated_at IS NOT NULL, updated_by FROM {DEPARTMENTS}")).one()
        assert tuple(row) == (True, None)
    with pytest.raises(IntegrityError), engine.begin() as conn:            # one row per unit
        conn.execute(text(f"INSERT INTO {DEPARTMENTS} (unit_id, tenant_id, code, display) "
                          "VALUES (:u, :t, 'X', 'Y')"), {"u": unit, "t": tenant})
    with pytest.raises(IntegrityError), engine.begin() as conn:            # one identity per (tenant, user)
        conn.execute(text(f"INSERT INTO {IDENTITIES} (tenant_id, user_id, family_name, given_name) "
                          "VALUES (:t, :u, 'A', 'B')"), {"t": tenant, "u": doctor})
    with pytest.raises(IntegrityError), engine.begin() as conn:            # the names are required
        conn.execute(text(f"INSERT INTO {IDENTITIES} (tenant_id, user_id, family_name) VALUES (:t, :u, 'A')"),
                     {"t": tenant, "u": _user(conn)})
    with engine.begin() as conn:
        width = conn.execute(text("SELECT character_maximum_length FROM information_schema.columns "
                                  "WHERE table_name = :t AND column_name = 'fin'"), {"t": IDENTITIES}).scalar_one()
        assert width == PHI_COLUMN_LENGTH
        conn.execute(text("DELETE FROM users WHERE id = :u"), {"u": doctor})
        assert conn.execute(text(f"SELECT count(*) FROM {IDENTITIES}")).scalar_one() == 0
        conn.execute(text("DELETE FROM admissions WHERE tenant_id = :t"), {"t": tenant})
        conn.execute(text("DELETE FROM beds"))
        conn.execute(text("DELETE FROM rooms"))
        conn.execute(text("DELETE FROM units WHERE id = :u"), {"u": unit})
        assert conn.execute(text(f"SELECT count(*) FROM {DEPARTMENTS}")).scalar_one() == 0

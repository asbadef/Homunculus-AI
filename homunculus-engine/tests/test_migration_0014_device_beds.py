# homunculus-engine/tests/test_migration_0014_device_beds.py
"""Migration 0014 (the monitor→bed editor, spec §5.1) on the real chain: purely additive — every
object and row that existed at 0013 is the same at 0014 and after the downgrade, and 0014 grants no
permission (O11); one current row per device and per bed; history kept (no delete, no edit but a
close); the model agrees with the migration; 0013 → 0014 → 0013 → 0014 runs. Synthetic rows only."""
from __future__ import annotations

import uuid

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError

import homunculus.devicebeds.models  # noqa: F401  (register device_beds on Base.metadata)
import homunculus.tenant.models  # noqa: F401
from homunculus.db import Base
from tests.conftest import requires_db

pytestmark = [requires_db]
OWN = {"device_beds"}


def _tenant(conn, slug: str) -> uuid.UUID:
    tid = uuid.uuid4()
    conn.execute(text("INSERT INTO tenants (id, name, slug, country_code) VALUES (:id, :n, :s, 'AZ')"),
                 {"id": tid, "n": f"Sentetik {slug}", "s": slug})
    return tid


def _ward(conn, tenant: uuid.UUID) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    """A site, a unit, a room and two beds; returns (unit, bed 1, bed 2)."""
    site, unit, room, bed1, bed2 = (uuid.uuid4() for _ in range(5))
    conn.execute(text("INSERT INTO sites (id, tenant_id, name) VALUES (:id, :t, 'Ana bina')"), {"id": site, "t": tenant})
    conn.execute(text("INSERT INTO units (id, site_id, name, unit_type) VALUES (:id, :s, 'Reanimasiya', 'ADULT_ICU')"),
                 {"id": unit, "s": site})
    conn.execute(text("INSERT INTO rooms (id, unit_id, name) VALUES (:id, :u, 'Otaq 05')"), {"id": room, "u": unit})
    for bed, label in ((bed1, "bed05"), (bed2, "bed06")):
        conn.execute(text("INSERT INTO beds (id, room_id, label) VALUES (:id, :r, :l)"), {"id": bed, "r": room, "l": label})
    conn.execute(text("INSERT INTO groups (id, tenant_id, slug, name, mfa_required, is_system, created_at, updated_at) "
                      "VALUES (:id, :t, 'charge_nurse', 'Sorumlu Hemşire', false, false, now(), now())"),
                 {"id": uuid.uuid4(), "t": tenant})
    return unit, bed1, bed2


def _row(conn, tenant, source, *, bed=None, unit=None, label=None, valid_to=None) -> int:
    return conn.execute(text(
        "INSERT INTO device_beds (tenant_id, source, group_address, port, device_bed_label, bed_label, bed_id, "
        "unit_id, method, verified_at, note, valid_from, valid_to, approved_by, approved_at) VALUES (:t, :s, "
        "'224.0.2.99', 2050, 'BED99', :label, :bed, :unit, 'central_station_list', '2026-09-22', NULL, "
        "'2026-10-19T00:00:00+00:00', :vt, 'proje sahibi', '2026-10-27T00:00:00+00:00') RETURNING id"),
        {"t": tenant, "s": source, "label": label, "bed": bed, "unit": unit, "vt": valid_to}).scalar_one()


def _snapshot(engine) -> dict:
    """Every column, index, function and row count of the schema, device_beds' own left out."""
    with engine.connect() as conn:
        tables = [r[0] for r in conn.execute(text(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")) if r[0] not in OWN]
        return {
            "columns": conn.execute(text(
                "SELECT table_name, column_name, data_type, is_nullable, character_maximum_length "
                "FROM information_schema.columns WHERE table_schema = 'public' AND table_name <> 'device_beds' "
                "ORDER BY 1, 2")).all(),
            "indexes": conn.execute(text(
                "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' "
                "AND tablename <> 'device_beds' ORDER BY 1")).all(),
            "functions": conn.execute(text(
                "SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
                "WHERE n.nspname = 'public' AND proname <> 'device_beds_history_kept' ORDER BY 1")).all(),
            "rows": {t: conn.execute(text(f'SELECT count(*) FROM "{t}"')).scalar_one() for t in tables},
            "grants": conn.execute(text("SELECT group_id, permission FROM group_permissions ORDER BY 1, 2")).all(),
        }


def test_0014_is_purely_additive_and_grants_nothing(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "0013")
    with engine.begin() as conn:
        _ward(conn, _tenant(conn, "hastane-a"))
    before = _snapshot(engine)
    command.upgrade(cfg, "0014")
    assert _snapshot(engine) == before
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM group_permissions WHERE permission = 'devices.map_beds'")).scalar_one() == 0
    command.downgrade(cfg, "0013")
    assert _snapshot(engine) == before
    with engine.connect() as conn:
        # R-2's checks (Lane A): the downgrade dropped the triggers before the table, and left neither
        assert conn.execute(text("SELECT to_regclass('public.device_beds')")).scalar_one() is None
        assert conn.execute(text("SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'device_beds_%'")).scalar_one() == 0
        assert conn.execute(text("SELECT count(*) FROM pg_proc WHERE proname = 'device_beds_history_kept'")).scalar_one() == 0
        assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0013"


def test_one_current_row_per_device_and_per_bed_while_closed_history_is_free(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        unit, bed1, bed2 = _ward(conn, tenant)
        first = _row(conn, tenant, "10.10.203.23", bed=bed1, unit=unit, label="BED05")
    for source, bed in (("10.10.203.23", bed2), ("10.10.203.24", bed1)):   # the device again; the bed again
        with pytest.raises(IntegrityError), engine.begin() as conn:
            _row(conn, tenant, source, bed=bed, unit=unit, label="bed06")
    with engine.begin() as conn:
        conn.execute(text("UPDATE device_beds SET valid_to = now() WHERE id = :id"), {"id": first})
        _row(conn, tenant, "10.10.203.23", bed=bed1, unit=unit, label="bed05")      # history, then a new one
        _row(conn, tenant, "10.10.203.25", label="BED01")                            # a label, no bed: no bed index
        _row(conn, tenant, "10.10.203.26")                                           # unbound


def test_history_is_kept_no_delete_and_no_edit_but_one_close(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        unit, bed1, _ = _ward(conn, tenant)
        row = _row(conn, tenant, "10.10.203.23", bed=bed1, unit=unit, label="BED05")
    refused = ["DELETE FROM device_beds WHERE id = :id",
               "UPDATE device_beds SET bed_label = 'bed05' WHERE id = :id",
               "UPDATE device_beds SET bed_label = 'bed05', valid_to = now() WHERE id = :id"]
    for sql in refused:
        with pytest.raises(DBAPIError, match="keeps its history"), engine.begin() as conn:
            conn.execute(text(sql), {"id": row})
    with engine.begin() as conn:
        conn.execute(text("UPDATE device_beds SET valid_to = now() WHERE id = :id"), {"id": row})
    with pytest.raises(DBAPIError, match="keeps its history"), engine.begin() as conn:
        conn.execute(text("UPDATE device_beds SET valid_to = now() + interval '1 day' WHERE id = :id"), {"id": row})


@pytest.mark.parametrize("columns", [
    {"bed": "BED", "unit": None, "label": "bed05"},       # a bed without its unit
    {"bed": "BED", "unit": "UNIT", "label": None},        # a bound row must name its bed
])
def test_the_checks_refuse_a_half_bound_row(clean_db, columns):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        unit, bed1, _ = _ward(conn, tenant)
    ids = {"BED": bed1, "UNIT": unit, None: None}
    with pytest.raises(IntegrityError), engine.begin() as conn:
        _row(conn, tenant, "10.10.203.23", bed=ids[columns["bed"]], unit=ids[columns["unit"]], label=columns["label"])
    with pytest.raises(IntegrityError), engine.begin() as conn:     # an empty interval
        _row(conn, tenant, "10.10.203.24", valid_to="2026-10-19T00:00:00+00:00")


def test_the_model_and_the_migration_agree_and_the_round_trip_runs(clean_db):
    engine, cfg = clean_db
    for target in ("head", "0013", "0014"):
        (command.upgrade if target != "0013" else command.downgrade)(cfg, target)
    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn, opts={
            "compare_type": True, "compare_server_default": False,
            "include_object": lambda obj, name, type_, reflected, compare_to: (
                name in OWN if type_ == "table" else
                getattr(getattr(obj, "table", None), "name", None) in OWN)})
        assert compare_metadata(ctx, Base.metadata) == []

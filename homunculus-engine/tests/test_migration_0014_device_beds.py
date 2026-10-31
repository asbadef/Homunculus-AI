# homunculus-engine/tests/test_migration_0014_device_beds.py
"""Migration 0014 (the monitor→bed editor, spec §5.1) on the real chain: purely additive — every
object and row that existed at 0013 is the same at 0014 and after the downgrade, and 0014 grants no
permission (O11); one current row per device and per bed; history kept (no delete, no truncate, no
edit but one close in the past, whatever the column — Lane A's A-8); the model agrees with the
migration, checks and index predicates included; 0013 → 0014 → 0013 → 0014 runs, with rows in the
table. Synthetic rows only."""
from __future__ import annotations

import re
import uuid

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import CheckConstraint, text
from sqlalchemy.exc import DBAPIError, IntegrityError

import homunculus.tenant.models  # noqa: F401
from homunculus.db import Base
from homunculus.devicebeds.models import DeviceBed
from tests.conftest import requires_db

pytestmark = [requires_db]
OWN = {"device_beds"}
KEPT = "keeps its history"
CHECKS = {"ck_device_beds_interval", "ck_device_beds_bed_unit", "ck_device_beds_bound_label"}
INDEXES = {"device_beds_pkey", "uq_device_beds_current_source", "uq_device_beds_current_bed",
           "ix_device_beds_tenant_source"}


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


def _full_row(conn, tenant, source, *, bed, unit, label, valid_to=None) -> int:
    """A row with no column left NULL but `valid_to` (when open), so that a change to ANY column is a real change."""
    return conn.execute(text(
        "INSERT INTO device_beds (tenant_id, source, group_address, port, device_bed_label, bed_label, bed_id, "
        "unit_id, method, verified_at, verified_by, note, valid_from, valid_to, approved_by, approved_at) VALUES "
        "(:t, :s, '224.0.2.99', 2050, 'BED99', :label, :bed, :unit, 'editor', '2026-10-30T10:00:00+00:00', :by, "
        "'sentetik not', '2026-10-19T00:00:00+00:00', :vt, 'proje sahibi', '2026-10-27T00:00:00+00:00') RETURNING id"),
        {"t": tenant, "s": source, "label": label, "bed": bed, "unit": unit, "by": uuid.uuid4(),
         "vt": valid_to}).scalar_one()


def _attempt(engine, sql: str, params: dict | None = None) -> str | None:
    """Run one statement in a transaction that is ALWAYS rolled back; the database's refusal, or None
    when it let the statement through."""
    params = {k: v for k, v in (params or {}).items() if f":{k}" in sql}
    with engine.connect() as conn:
        tx = conn.begin()
        try:
            conn.execute(text(sql), params)
        except DBAPIError as exc:
            return str(exc.orig)
        finally:
            tx.rollback()
    return None


def _snapshot(engine) -> dict:
    """Everything the schema holds outside device_beds: columns with their defaults, indexes,
    constraints, triggers, functions, sequences, types and enum labels, row counts and grants."""
    with engine.connect() as conn:
        tables = [r[0] for r in conn.execute(text(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")) if r[0] not in OWN]
        return {
            "columns": conn.execute(text(
                "SELECT table_name, column_name, data_type, is_nullable, character_maximum_length, column_default "
                "FROM information_schema.columns WHERE table_schema = 'public' AND table_name <> 'device_beds' "
                "ORDER BY 1, 2")).all(),
            "indexes": conn.execute(text(
                "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' "
                "AND tablename <> 'device_beds' ORDER BY 1")).all(),
            "constraints": [tuple(r) for r in conn.execute(text(
                "SELECT c.conrelid::regclass::text, c.conname, c.contype::text, pg_get_constraintdef(c.oid) "
                "FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace "
                "WHERE n.nspname = 'public' ORDER BY 1, 2")) if r[0] != "device_beds"],
            "triggers": [tuple(r) for r in conn.execute(text(
                "SELECT c.relname, t.tgname, pg_get_triggerdef(t.oid) FROM pg_trigger t "
                "JOIN pg_class c ON c.oid = t.tgrelid "
                "WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace ORDER BY 1, 2"))
                if r[0] != "device_beds"],
            "functions": conn.execute(text(
                "SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
                "WHERE n.nspname = 'public' AND proname <> 'device_beds_history_kept' ORDER BY 1")).all(),
            "sequences": conn.execute(text(
                "SELECT sequencename, data_type::text, start_value, min_value, max_value, increment_by, cycle, "
                "cache_size, last_value FROM pg_sequences "
                "WHERE schemaname = 'public' AND sequencename <> 'device_beds_id_seq' ORDER BY 1")).all(),
            "types": conn.execute(text(
                "SELECT typname, typtype::text FROM pg_type WHERE typnamespace = 'public'::regnamespace "
                "AND typtype IN ('e', 'd', 'r', 'm') ORDER BY 1")).all(),
            "enum_labels": conn.execute(text(
                "SELECT t.typname, e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid "
                "WHERE t.typnamespace = 'public'::regnamespace ORDER BY t.typname, e.enumsortorder")).all(),
            "rows": {t: conn.execute(text(f'SELECT count(*) FROM "{t}"')).scalar_one() for t in tables},
            "grants": conn.execute(text("SELECT group_id, permission FROM group_permissions ORDER BY 1, 2")).all(),
        }


def _squash(sql: str) -> str:
    return re.sub(r"[()\s]", "", sql)


def _assert_the_model_agrees(engine) -> None:
    """`compare_metadata` sees tables, columns and index columns, but NOT a CHECK or a partial index's
    predicate — those two are compared here directly, against the migration's own and against the model's."""
    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn, opts={
            "compare_type": True, "compare_server_default": False,
            "include_object": lambda obj, name, type_, reflected, compare_to: (
                name in OWN if type_ == "table" else
                getattr(getattr(obj, "table", None), "name", None) in OWN)})
        assert compare_metadata(ctx, Base.metadata) == []

        checks = {r[0] for r in conn.execute(text(
            "SELECT conname FROM pg_constraint WHERE conrelid = 'public.device_beds'::regclass AND contype = 'c'"))}
        assert checks == CHECKS
        assert checks == {c.name for c in DeviceBed.__table__.constraints if isinstance(c, CheckConstraint)}

        defs = dict(conn.execute(text(
            "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'device_beds'")).all())
        assert set(defs) == INDEXES
        assert "UNIQUE" in defs["uq_device_beds_current_source"] and "(tenant_id, source)" in defs["uq_device_beds_current_source"]
        assert defs["uq_device_beds_current_source"].endswith("WHERE (valid_to IS NULL)")
        assert "UNIQUE" in defs["uq_device_beds_current_bed"] and "(tenant_id, bed_id)" in defs["uq_device_beds_current_bed"]
        assert defs["uq_device_beds_current_bed"].endswith("WHERE ((valid_to IS NULL) AND (bed_id IS NOT NULL))")
        assert "WHERE" not in defs["ix_device_beds_tenant_source"]
        for index in DeviceBed.__table__.indexes:           # and the model says the same, whatever the rendering
            where = index.dialect_options["postgresql"]["where"]
            stored = defs[index.name].split(" WHERE ", 1)[1] if " WHERE " in defs[index.name] else None
            assert (stored is None) == (where is None), index.name
            if where is not None:
                assert _squash(stored) == _squash(str(where)), index.name
            assert ("UNIQUE" in defs[index.name]) == bool(index.unique), index.name


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
        # R-2's checks (Lane A): the downgrade dropped the triggers before the table, and left none of them
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
    for source, bed, index in (("10.10.203.23", bed2, "uq_device_beds_current_source"),   # the device again
                               ("10.10.203.24", bed1, "uq_device_beds_current_bed")):     # the bed again
        with pytest.raises(IntegrityError, match=index), engine.begin() as conn:
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
        with pytest.raises(DBAPIError, match=KEPT), engine.begin() as conn:
            conn.execute(text(sql), {"id": row})
    with engine.begin() as conn:
        conn.execute(text("UPDATE device_beds SET valid_to = now() WHERE id = :id"), {"id": row})
    for sql in ("UPDATE device_beds SET valid_to = valid_to - interval '1 second' WHERE id = :id",   # a closed row is never closed again
                "UPDATE device_beds SET valid_to = NULL WHERE id = :id",                                # nor reopened
                "DELETE FROM device_beds WHERE id = :id"):
        assert KEPT in (_attempt(engine, sql, {"id": row}) or ""), sql


def test_a_plain_close_passes_but_never_a_close_in_the_future(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        unit, bed1, bed2 = _ward(conn, tenant)
        by_now = _row(conn, tenant, "10.10.203.23", bed=bed1, unit=unit, label="BED05")
        by_clock = _row(conn, tenant, "10.10.203.24", bed=bed2, unit=unit, label="BED06")
        later = _row(conn, tenant, "10.10.203.25")
    for future in ("clock_timestamp() + interval '1 hour'", "now() + interval '1 hour'"):      # a close in the future
        assert KEPT in (_attempt(engine, f"UPDATE device_beds SET valid_to = {future} WHERE id = :id", {"id": later}) or ""), future
    # the database's own time (the transaction's start, or the clock) is never "in the future": the app closes with it
    with engine.begin() as conn:
        conn.execute(text("UPDATE device_beds SET valid_to = now() WHERE id = :id"), {"id": by_now})
        conn.execute(text("UPDATE device_beds SET valid_to = clock_timestamp() WHERE id = :id"), {"id": by_clock})
        conn.execute(text("UPDATE device_beds SET valid_to = valid_from + interval '1 day' WHERE id = :id"), {"id": later})
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM device_beds WHERE valid_to IS NULL")).scalar_one() == 0


def _new_value(column: str, data_type: str) -> str:
    """A SQL expression that differs from the column's value in the full rows below."""
    if column == "tenant_id":
        return ":tenant2"
    if column == "bed_id":
        return ":bed_other"
    if column == "unit_id":
        return ":unit2"
    if data_type == "uuid":
        return "gen_random_uuid()"
    if data_type == "bigint":
        return f"{column} + 1000000"
    if data_type == "integer":
        return f"{column} + 1"
    if data_type == "character varying":
        return f"COALESCE({column}, '') || 'x'"
    if data_type == "timestamp with time zone":
        return f"{column} - interval '1 day'"
    pytest.fail(f"device_beds.{column} ({data_type}) has no test value: teach _new_value about it, "
                f"and check that device_beds_history_kept() freezes it")


def test_every_column_but_valid_to_is_frozen_on_an_open_and_on_a_closed_row(clean_db):
    """For EACH column the table has, read from information_schema (so a column a later migration adds
    is covered, or this test fails asking for its value): an UPDATE that changes only that column
    raises, on an open and on a closed row — and so does one that changes it WHILE closing the open row,
    the edit a hand-made column list lets through."""
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        unit, bed1, bed2 = _ward(conn, tenant)
        tenant2 = _tenant(conn, "hastane-b")
        unit2, _, bed_other = _ward(conn, tenant2)
        rows = {"open": _full_row(conn, tenant, "10.10.203.23", bed=bed1, unit=unit, label="BED05"),
                "closed": _full_row(conn, tenant, "10.10.203.24", bed=bed2, unit=unit, label="BED06",
                                    valid_to="2026-10-20T00:00:00+00:00")}
        columns = conn.execute(text(
            "SELECT column_name, data_type FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = 'device_beds' AND column_name <> 'valid_to' "
            "ORDER BY ordinal_position")).all()
    assert len(columns) >= 16, columns          # not a vacuous loop
    other = {"tenant2": tenant2, "bed_other": bed_other, "unit2": unit2}
    leaks = {}
    for kind, row_id in rows.items():
        for mode in (("alone", "with a close") if kind == "open" else ("alone",)):
            for column, data_type in columns:
                new = _new_value(column, data_type)
                with engine.connect() as conn:      # the edit must be a real change, or the test proves nothing
                    changes = conn.execute(text(f"SELECT {new} IS DISTINCT FROM {column} FROM device_beds WHERE id = :id"),
                                           {"id": row_id, **{k: v for k, v in other.items() if f":{k}" in new}}).scalar_one()
                assert changes, f"{kind} row: the new value of {column} equals its old one"
                close = ", valid_to = now()" if mode == "with a close" else ""
                refusal = _attempt(engine, f"UPDATE device_beds SET {column} = {new}{close} WHERE id = :id",
                                   {"id": row_id, **other})
                if refusal is None or KEPT not in refusal:
                    leaks[(kind, mode, column)] = refusal
    assert leaks == {}
    with engine.connect() as conn:              # nothing stuck
        assert conn.execute(text("SELECT count(*) FROM device_beds WHERE valid_to IS NULL")).scalar_one() == 1


def test_a_column_a_later_migration_adds_is_frozen_too(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        unit, bed1, _ = _ward(conn, tenant)
        row = _row(conn, tenant, "10.10.203.23", bed=bed1, unit=unit, label="BED05")
        conn.execute(text("ALTER TABLE device_beds ADD COLUMN added_later varchar(20)"))
    for sql in ("UPDATE device_beds SET added_later = 'x' WHERE id = :id",
                "UPDATE device_beds SET added_later = 'x', valid_to = now() WHERE id = :id"):    # edit while closing
        assert KEPT in (_attempt(engine, sql, {"id": row}) or ""), sql
    with engine.begin() as conn:                # and the plain close still works with the extra column
        conn.execute(text("UPDATE device_beds SET valid_to = now() WHERE id = :id"), {"id": row})


def test_truncate_is_refused_and_so_is_a_cascade_into_the_table(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        unit, bed1, _ = _ward(conn, tenant)
        _row(conn, tenant, "10.10.203.23", bed=bed1, unit=unit, label="BED05")
    for sql in ("TRUNCATE device_beds", "TRUNCATE tenants CASCADE"):
        assert KEPT in (_attempt(engine, sql) or ""), sql
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM device_beds")).scalar_one() == 1


@pytest.mark.parametrize("columns, constraint", [
    ({"bed": "BED", "unit": None, "label": "bed05"}, "ck_device_beds_bed_unit"),       # a bed without its unit
    ({"bed": None, "unit": "UNIT", "label": "bed05"}, "ck_device_beds_bed_unit"),      # a unit without its bed
    ({"bed": "BED", "unit": "UNIT", "label": None}, "ck_device_beds_bound_label"),     # a bound row must name its bed
])
def test_the_checks_refuse_a_half_bound_row(clean_db, columns, constraint):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        unit, bed1, _ = _ward(conn, tenant)
    ids = {"BED": bed1, "UNIT": unit, None: None}
    with pytest.raises(IntegrityError, match=constraint), engine.begin() as conn:
        _row(conn, tenant, "10.10.203.23", bed=ids[columns["bed"]], unit=ids[columns["unit"]], label=columns["label"])


def test_the_interval_check_refuses_an_empty_interval(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
    with pytest.raises(IntegrityError, match="ck_device_beds_interval"), engine.begin() as conn:
        _row(conn, tenant, "10.10.203.24", valid_to="2026-10-19T00:00:00+00:00")        # valid_to == valid_from


def test_the_model_and_the_migration_agree_checks_and_predicates_included(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    _assert_the_model_agrees(engine)


def test_the_round_trip_runs_with_rows_in_the_table(clean_db):
    """R-2 runs with data: an open and a closed row, and neither the triggers nor the history rule may
    block the DROP — then 0014 again, from empty, still agrees with the model."""
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        unit, bed1, bed2 = _ward(conn, tenant)
        _row(conn, tenant, "10.10.203.23", bed=bed1, unit=unit, label="BED05")
        _row(conn, tenant, "10.10.203.24", bed=bed2, unit=unit, label="BED06", valid_to="2026-10-20T00:00:00+00:00")
    command.downgrade(cfg, "0013")
    with engine.connect() as conn:
        assert conn.execute(text("SELECT to_regclass('public.device_beds')")).scalar_one() is None
        assert conn.execute(text("SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'device_beds_%'")).scalar_one() == 0
        assert conn.execute(text("SELECT count(*) FROM pg_proc WHERE proname = 'device_beds_history_kept'")).scalar_one() == 0
        assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0013"
    command.upgrade(cfg, "0014")
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM device_beds")).scalar_one() == 0
    _assert_the_model_agrees(engine)

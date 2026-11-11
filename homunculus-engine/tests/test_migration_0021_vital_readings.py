# homunculus-engine/tests/test_migration_0021_vital_readings.py
"""Migration 0021 (G3-05, spec §3, D19, D20) on the real chain (`clean_db`, never `create_all`): the table with
its checks and its foreign key, the six indexes, the audit index that closes G3-01's O3; schema only — no row is
written; the downgrade drops exactly this, and 0019 → 0021 → 0019 → 0021 runs. Synthetic rows only."""
from __future__ import annotations

import importlib.util
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
from alembic import command
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

from tests.conftest import ENGINE_ROOT, requires_db

MIGRATION = ENGINE_ROOT / "alembic" / "versions" / "0021_vital_readings.py"
T0 = datetime(2026, 11, 11, 9, 0, tzinfo=timezone.utc)
INDEXES = {
    "ix_vital_readings_tenant_patient_observed", "ix_vital_readings_admission_observed",
    "ix_vital_readings_unmatched", "ix_vital_readings_tenant_entry",
    "uq_vital_readings_tenant_audit", "uq_vital_readings_device",
}
INSERT = text(
    "INSERT INTO vital_readings (tenant, received_key, patient_key, admission_id, code, value, unit, observed_at, "
    "received_at, origin, source, state, unmatched_reason, audit_id, entry_id) VALUES ('h1', :key, :patient, "
    ":admission, 'spo2', 97, '%', :at, :at, :origin, 'CONNEX-3A', :state, :reason, :audit, :audit)")


def _module():
    spec = importlib.util.spec_from_file_location("m0021", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_revision_follows_0019_on_this_branch():
    """No database: the file's own word. `"0020"` instead, at the merge, if Kalite's migration is on main first
    (spec §8) — then this line changes with it, and tests/test_audit_postgres.py still finds one head."""
    module = _module()
    assert (module.revision, module.down_revision) == ("0021", "0019")


def _row(conn, **over):
    values = {"key": "202600000001", "patient": "202600000001", "admission": None, "at": T0, "origin": "device",
              "state": "recorded", "reason": None, "audit": 1, **over}
    conn.execute(INSERT, values)


def _admission(conn) -> uuid.UUID:
    """A tenant, a bed and one ACTIVE admission on it (the columns migration 0018's test writes)."""
    tenant, site, unit, room, bed, patient, admission = (uuid.uuid4() for _ in range(7))
    conn.execute(text("INSERT INTO tenants (id, name, slug, country_code) VALUES (:id, 'Sentetik', 'h1', 'AZ')"),
                 {"id": tenant})
    conn.execute(text("INSERT INTO sites (id, tenant_id, name) VALUES (:id, :t, 'Ana bina')"), {"id": site, "t": tenant})
    conn.execute(text("INSERT INTO units (id, site_id, name, unit_type) VALUES (:id, :s, 'Reanimasiya', 'ADULT_ICU')"),
                 {"id": unit, "s": site})
    conn.execute(text("INSERT INTO rooms (id, unit_id, name) VALUES (:id, :u, 'Otaq 1')"), {"id": room, "u": unit})
    conn.execute(text("INSERT INTO beds (id, room_id, label) VALUES (:id, :r, '1')"), {"id": bed, "r": room})
    conn.execute(text("INSERT INTO patients (id, tenant_id, display_name, date_of_birth, sex, patient_number, "
                      "created_at) VALUES (:id, :t, 'x', 'x', 'x', 'H-0000001', now())"), {"id": patient, "t": tenant})
    conn.execute(text(
        "INSERT INTO admissions (id, patient_id, tenant_id, state, admission_datetime, admitting_unit_id, bed_id, "
        "admission_diagnosis_free_text, protocol_no) VALUES (:id, :p, :t, 'ACTIVE', now(), :u, :b, 'Sentetik tanı', "
        "'202600000001')"), {"id": admission, "p": patient, "t": tenant, "u": unit, "b": bed})
    return admission


@requires_db
def test_the_table_its_indexes_and_the_audit_index(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    names = inspect(engine)
    columns = {c["name"]: c for c in names.get_columns("vital_readings")}
    assert set(columns) == {
        "id", "tenant", "received_key", "patient_key", "admission_id", "code", "value", "unit", "observed_at",
        "received_at", "origin", "source", "recorded_by", "state", "unmatched_reason", "audit_id", "entry_id",
        "resolved_at", "resolved_by", "resolve_reason", "voided_at", "voided_by", "void_reason"}
    assert not columns["received_key"]["nullable"] and columns["patient_key"]["nullable"]
    assert columns["admission_id"]["nullable"] and columns["audit_id"]["nullable"]
    with engine.connect() as conn:
        found = {r[0] for r in conn.execute(text("SELECT indexname FROM pg_indexes WHERE tablename = 'vital_readings'"))}
        audit = {r[0] for r in conn.execute(text("SELECT indexname FROM pg_indexes WHERE tablename = 'audit'"))}
        device = conn.execute(text("SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_vital_readings_device'")).scalar_one()
        rows = conn.execute(text("SELECT count(*) FROM vital_readings")).scalar_one()
    assert INDEXES <= found
    assert "ix_audit_tenant_patient_id" in audit
    assert "UNIQUE" in device and "(tenant, received_key, code, observed_at, source, value)" in device
    assert "origin" in device and "device" in device                     # partial: the device's rows only
    assert rows == 0                                                     # schema only (D19)
    [fk] = names.get_foreign_keys("vital_readings")
    assert (fk["referred_table"], fk["constrained_columns"], fk["options"].get("ondelete")) == (
        "admissions", ["admission_id"], "RESTRICT")


@requires_db
def test_the_checks_and_the_two_unique_indexes_hold(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        _row(conn)
    for bad in ({"origin": "monitor"}, {"state": "open"}, {"reason": "typo", "state": "unmatched"}):
        with pytest.raises(IntegrityError), engine.begin() as conn:
            _row(conn, audit=2, at=T0.replace(minute=1), **bad)
    with pytest.raises(IntegrityError), engine.begin() as conn:
        _row(conn, audit=1, at=T0.replace(minute=2))                     # the same audit row twice
    with pytest.raises(IntegrityError), engine.begin() as conn:
        _row(conn, audit=3)                                              # the same device reading twice
    with engine.begin() as conn:
        _row(conn, audit=4, origin="manual")                             # … but a hand entry may equal it
        _row(conn, audit=None, at=T0.replace(minute=3))                  # and rows with no audit id never collide
        _row(conn, audit=None, at=T0.replace(minute=4))


@requires_db
def test_an_admission_with_a_reading_cannot_be_deleted(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        admission = _admission(conn)
        _row(conn, admission=admission)
    with pytest.raises(IntegrityError), engine.begin() as conn:
        conn.execute(text("DELETE FROM admissions WHERE id = :id"), {"id": admission})


@requires_db
def test_downgrade_drops_exactly_this_and_the_round_trip_runs(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    command.downgrade(cfg, "0019")
    with engine.connect() as conn:
        tables = {r[0] for r in conn.execute(text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'"))}
        audit = {r[0] for r in conn.execute(text("SELECT indexname FROM pg_indexes WHERE tablename = 'audit'"))}
        version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
    assert "vital_readings" not in tables and "tasks" in tables and "audit" in tables
    assert "ix_audit_tenant_patient_id" not in audit and "ix_audit_tenant_event_id" in audit
    assert version == "0019"
    command.upgrade(cfg, "head")
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM vital_readings")).scalar_one() == 0

# homunculus-engine/tests/test_migration_0018_transfer_columns.py
"""B1b's part of migration 0018 (G2-B1b, spec D8, §5.9), which B1c wrote (its spec §5.1 step 8),
on the real chain (`clean_db`, never `create_all`):
- `admissions.transfer_reason` and `admissions.transfer_note` exist, NULL, on every row the
  migration found;
- the CHECK takes exactly the six reasons the model names, or NULL; a seventh is refused;
- the note's column is as wide as every encrypted text;
- the downgrade to 0017 drops both columns, and the upgrade adds them again.
Synthetic rows only (tests/test_migration_0015_protocol.py's helpers)."""
from __future__ import annotations

import re

import pytest
from alembic import command
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

from homunculus.admission.models import PHI_COLUMN_LENGTH, TransferReason
from tests.conftest import requires_db
from tests.test_migration_0015_protocol import _admission, _bed, _tenant

pytestmark = [requires_db]
CHECK = "ck_admissions_transfer_reason"
COLUMNS = {"transfer_reason", "transfer_note"}


def _columns(engine) -> dict[str, dict]:
    return {c["name"]: c for c in inspect(engine).get_columns("admissions")}


def test_0018_adds_the_reason_and_the_note_null_on_every_row(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "0017")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        admission = _admission(conn, tenant, _bed(conn, tenant), "H2600001")
    command.upgrade(cfg, "head")
    columns = _columns(engine)
    assert COLUMNS <= set(columns)
    assert all(columns[name]["nullable"] for name in COLUMNS)
    assert columns["transfer_note"]["type"].length == PHI_COLUMN_LENGTH
    with engine.connect() as conn:
        row = conn.execute(text("SELECT transfer_reason, transfer_note FROM admissions "
                                "WHERE id = :id"), {"id": admission}).one()
    assert tuple(row) == (None, None)


def test_the_check_takes_the_six_reasons_and_null_and_refuses_a_seventh(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        bed = _bed(conn, tenant)
        for n, reason in enumerate([None, *(r.value for r in TransferReason)]):
            _admission(conn, tenant, bed, f"H26000{n:02d}", transfer_reason=reason)
    with pytest.raises(IntegrityError, match=CHECK):
        with engine.begin() as conn:
            _admission(conn, tenant, bed, "H2600099", transfer_reason="SEVENTH")


def test_the_checks_values_are_the_models_reasons(clean_db):
    """A seventh reason is a migration, as B3a's `ck_beds_state_reason` is: the model and 0018
    name the same six."""
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.connect() as conn:
        definition = conn.execute(text("SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                                       "WHERE conname = :n"), {"n": CHECK}).scalar_one()
    assert set(re.findall(r"'([A-Z_]+)'", definition)) == {r.value for r in TransferReason}


def test_the_downgrade_drops_both_and_the_upgrade_adds_them_again(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    command.downgrade(cfg, "0017")
    assert not COLUMNS & set(_columns(engine))
    command.upgrade(cfg, "head")
    assert COLUMNS <= set(_columns(engine))

# homunculus-engine/tests/test_migration_0016_bed_occupancy.py
"""Migration 0016 (G2-B3a, spec §4) on the real chain (`clean_db`, never `create_all`):
- `bedstate` gains RESERVED;
- `beds.state_reason` (CHECK: the four reasons or NULL) and `beds.state_note` (wide enough for a
  Fernet text) are added, NULL on every bed;
- `beds.manage_state` reaches every tenant's charge nurses and nobody else;
- the downgrade frees every reserved bed before it takes the rest away (X8), and
  0015 → 0016 → 0015 → 0016 runs.
The model agrees with the migration. Synthetic rows only."""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

import homunculus.admission.models  # noqa: F401  (register every table on Base.metadata)
import homunculus.auth.models  # noqa: F401
import homunculus.escalation.models  # noqa: F401
import homunculus.protocol.models  # noqa: F401
import homunculus.tenant.models  # noqa: F401
from homunculus.db import Base
from homunculus.tenant.models import BedState, BedStateReason
from tests.conftest import requires_db

pytestmark = [requires_db]
CHECK = "ck_beds_state_reason"
RESERVED_AT = datetime(2026, 1, 1, tzinfo=timezone.utc)   # an old stamp: the downgrade's must be later


def _tenant(conn, slug: str) -> uuid.UUID:
    tid = uuid.uuid4()
    conn.execute(text("INSERT INTO tenants (id, name, slug, country_code) VALUES (:id, :n, :s, 'AZ')"),
                 {"id": tid, "n": f"Sentetik {slug}", "s": slug})
    return tid


def _group(conn, tenant: uuid.UUID, slug: str) -> uuid.UUID:
    gid = uuid.uuid4()
    conn.execute(text(
        "INSERT INTO groups (id, tenant_id, slug, name, mfa_required, is_system, created_at, "
        "updated_at) VALUES (:id, :t, :s, :s, false, false, now(), now())"),
        {"id": gid, "t": tenant, "s": slug})
    return gid


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


def _columns(engine, table: str) -> dict[str, dict]:
    return {c["name"]: c for c in inspect(engine).get_columns(table)}


def test_0016_adds_the_state_the_columns_and_the_charge_nurses_right(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "0015")
    with engine.begin() as conn:
        a, b = _tenant(conn, "hastane-a"), _tenant(conn, "hastane-b")
        groups = {(t, s): _group(conn, t, s)
                  for t in (a, b) for s in ("charge_nurse", "nurse", "hospital_admin")}
        bed = _bed(conn, a)
    command.upgrade(cfg, "0016")
    with engine.connect() as conn:
        labels = set(conn.execute(text("SELECT unnest(enum_range(NULL::bedstate))::text")).scalars())
        holders = set(conn.execute(text(
            "SELECT group_id FROM group_permissions WHERE permission = 'beds.manage_state'")).scalars())
        row = conn.execute(text("SELECT state::text, state_reason, state_note FROM beds WHERE id = :id"),
                           {"id": bed}).one()
    # The type holds exactly the model's states: no label lost, none left over.
    assert labels == {s.name for s in BedState}
    # hospital_admin holds the whole catalogue by rule (auth/permissions.py): no row for it.
    assert holders == {groups[(t, "charge_nurse")] for t in (a, b)}
    assert tuple(row) == ("AVAILABLE", None, None)
    columns = _columns(engine, "beds")
    assert columns["state_reason"]["type"].length == 20 and columns["state_reason"]["nullable"]
    assert columns["state_note"]["type"].length == 1536 and columns["state_note"]["nullable"]


def test_a_reason_is_one_of_the_four_or_none(clean_db):
    # One chain build for all five (each costs seconds): one bed per reason, and one with none.
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    reasons = [r.value for r in BedStateReason] + [None]
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        beds = {_bed(conn, tenant): reason for reason in reasons}
        for bed, reason in beds.items():
            conn.execute(text("UPDATE beds SET state = 'BLOCKED', state_reason = :r WHERE id = :id"),
                         {"r": reason, "id": bed})
    with engine.connect() as conn:
        stored = dict(conn.execute(text("SELECT id, state_reason FROM beds")).all())
    assert stored == beds


def test_any_other_reason_is_refused(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        bed = _bed(conn, _tenant(conn, "hastane-a"))
    with pytest.raises(IntegrityError, match=CHECK), engine.begin() as conn:
        conn.execute(text("UPDATE beds SET state_reason = 'BROKEN' WHERE id = :id"), {"id": bed})


def test_the_downgrade_frees_reserved_beds_and_takes_the_rest_away(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "0015")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        _group(conn, tenant, "charge_nurse")
        reserved, blocked = _bed(conn, tenant), _bed(conn, tenant)
    command.upgrade(cfg, "0016")
    with engine.begin() as conn:
        conn.execute(text("UPDATE beds SET state = 'RESERVED', state_note = 'x', "
                          "state_updated_at = :t WHERE id = :id"), {"id": reserved, "t": RESERVED_AT})
        conn.execute(text("UPDATE beds SET state = 'BLOCKED', state_reason = 'FAULT' WHERE id = :id"),
                     {"id": blocked})
    command.downgrade(cfg, "0015")
    with engine.connect() as conn:
        states = dict(conn.execute(text("SELECT id, state::text FROM beds")).all())
        freed_at = conn.execute(text("SELECT state_updated_at FROM beds WHERE id = :id"),
                                {"id": reserved}).scalar_one()
        rights = conn.execute(text(
            "SELECT count(*) FROM group_permissions WHERE permission = 'beds.manage_state'")).scalar_one()
        version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
    # X8: no row holds RESERVED, so an image from before 0016 reads every bed; BLOCKED it knows.
    assert states == {reserved: "AVAILABLE", blocked: "BLOCKED"}
    assert rights == 0 and version == "0015"
    assert {"state_reason", "state_note"}.isdisjoint(_columns(engine, "beds"))
    # The freed bed is stamped: "how long has it been in this state" must not read the reservation's age.
    assert freed_at > RESERVED_AT
    command.upgrade(cfg, "0016")                     # ADD VALUE IF NOT EXISTS runs again
    with engine.connect() as conn:
        labels = list(conn.execute(text("SELECT unnest(enum_range(NULL::bedstate))::text")).scalars())
    assert labels.count("RESERVED") == 1             # the value stayed in the type: once, not twice
    assert {"state_reason", "state_note"} <= set(_columns(engine, "beds"))


def test_the_model_and_the_migration_agree(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")

    def only_0016(object_, name, type_, reflected, compare_to):
        if type_ == "table":
            return name == "beds"
        if type_ == "column":
            table = object_.table.name if object_ is not None else None
            return table == "beds" and name in {"state_reason", "state_note"}
        return False

    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn, opts={
            "compare_type": True, "compare_server_default": False, "include_object": only_0016})
        assert compare_metadata(ctx, Base.metadata) == []
        # compare_metadata reads no CHECK: it is read here, by name, with the reasons it lists.
        definition = conn.execute(text("SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                                       "WHERE conname = :n"), {"n": CHECK}).scalar_one()
    assert re.findall(r"'([A-Z_]+)'", definition) == [r.value for r in BedStateReason]

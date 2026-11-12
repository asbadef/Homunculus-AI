# homunculus-engine/tests/test_migration_0022_workload_view.py
"""G4-04 migration 0022 (spec D8, §5 A8, M1, M2). Without a database: its group is the one `DEFAULT_GROUPS` gives the key
to (the charge nurse's), its index is the model's, and it follows 0020 (plan note N12: 0021 when G3-05 lands first). On
the real chain (`clean_db`, never `create_all`): `workload.view` goes to every tenant's `charge_nurse` group and to no
other, a group already holding it is left as it is; `closed_at` is added; an active row whose `unit_id` is not its bed's
unit is ended, and of the active rows of one bed and one window the newest stays and the others are ended — kept, with
`closed_at`; then one active row per bed and window holds; the downgrade drops the index, the column and the key and
re-activates NO row; 0020 → 0022 → 0020 → 0022 runs; the head is not pinned. Synthetic rows only."""
from __future__ import annotations

import importlib.util
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from alembic import command
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

from homunculus.admission.models import NURSE_BED_ACTIVE_INDEX
from homunculus.auth.permissions import DEFAULT_GROUPS
from tests.conftest import requires_db

#: The rows migration 0022 writes, as (tenant slug, group slug).
GRANTS = ("SELECT t.slug, g.slug FROM group_permissions gp JOIN groups g ON g.id = gp.group_id "
          "JOIN tenants t ON t.id = g.tenant_id WHERE gp.permission = 'workload.view'")
CHARGE = {("h1", "charge_nurse"), ("h2", "charge_nurse")}
A = datetime(2026, 11, 12, 8, tzinfo=timezone.utc)        # a window's start


def _migration():
    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0022_workload_view.py"
    spec = importlib.util.spec_from_file_location("migration_0022_workload_view", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _tenant(conn, slug: str) -> uuid.UUID:
    """A tenant with a `charge_nurse`, a `nurse` and a group of the hospital's own (`bakim_ekibi`)."""
    tid = uuid.uuid4()
    conn.execute(text("INSERT INTO tenants (id, name, slug, country_code) VALUES (:id, :s, :s, 'AZ')"),
                 {"id": tid, "s": slug})
    for group in ("charge_nurse", "nurse", "bakim_ekibi"):
        conn.execute(text("INSERT INTO groups (id, tenant_id, slug, name, description, mfa_required, is_system, "
                          "created_at, updated_at) VALUES (gen_random_uuid(), :t, :g, :g, '', false, false, now(), "
                          "now())"), {"t": tid, "g": group})
    return tid


def _bed(conn, tenant: uuid.UUID) -> tuple[uuid.UUID, uuid.UUID]:
    """A site, a unit, a room and a bed of their own: (unit, bed)."""
    site, unit, room, bed = (uuid.uuid4() for _ in range(4))
    conn.execute(text("INSERT INTO sites (id, tenant_id, name) VALUES (:id, :t, 'Ana bina')"), {"id": site, "t": tenant})
    conn.execute(text("INSERT INTO units (id, site_id, name, unit_type) VALUES (:id, :s, 'Reanimasiya', 'ADULT_ICU')"),
                 {"id": unit, "s": site})
    conn.execute(text("INSERT INTO rooms (id, unit_id, name) VALUES (:id, :u, 'Otaq 1')"), {"id": room, "u": unit})
    conn.execute(text("INSERT INTO beds (id, room_id, label) VALUES (:id, :r, '1')"), {"id": bed, "r": room})
    return unit, bed


def _user(conn, name: str) -> uuid.UUID:
    uid = uuid.uuid4()
    conn.execute(text(
        "INSERT INTO users (id, username, email, full_name, hashed_password, auth_source, totp_enabled, is_active, "
        "is_platform_support) VALUES (:id, :u, :u, 'Sentetik', 'x', 'local', false, true, false)"),
        {"id": uid, "u": f"{name}@example.com"})
    return uid


def _row(conn, unit, bed, nurse, *, start: datetime = A, hours_ago: int = 0, active: bool = True,
         row_id: uuid.UUID | None = None) -> uuid.UUID:
    """One assignment row of the 12-hour window from `start`, as the table is before 0022 (no `closed_at`). Rows made
    in one transaction with the same `hours_ago` share their `created_at` (`now()` is the transaction's); `row_id`
    fixes the id."""
    rid = row_id or uuid.uuid4()
    conn.execute(text(
        "INSERT INTO nurse_bed_assignments (id, unit_id, bed_id, nurse_id, shift_start, shift_end, is_active, "
        "created_at) VALUES (:id, :u, :b, :n, :s, :e, :a, now() - make_interval(hours => :h))"),
        {"id": rid, "u": unit, "b": bed, "n": nurse, "s": start, "e": start + timedelta(hours=12), "a": active,
         "h": hours_ago})
    return rid


def _active(conn) -> set[uuid.UUID]:
    return set(conn.execute(text("SELECT id FROM nurse_bed_assignments WHERE is_active")).scalars())


def _closed(conn) -> set[uuid.UUID]:
    return set(conn.execute(text("SELECT id FROM nurse_bed_assignments WHERE closed_at IS NOT NULL")).scalars())


def _index(conn) -> list[str]:
    return list(conn.execute(text("SELECT indexdef FROM pg_indexes WHERE indexname = :i"),
                             {"i": NURSE_BED_ACTIVE_INDEX}).scalars())


def test_the_migration_names_the_group_and_the_index_the_code_names():
    """`DEFAULT_GROUPS` seeds a tenant made later, 0022 the ones seeded before: one group, the charge nurse's (the system
    group holds every key by rule). The index is the model's. No database: the file is loaded by its path (its name
    starts with a digit)."""
    migration = _migration()
    holders = {g["slug"] for g in DEFAULT_GROUPS if "workload.view" in g["permissions"] and not g["is_system"]}
    assert holders == {migration.GROUP} == {"charge_nurse"}
    assert migration.ACTIVE_INDEX == NURSE_BED_ACTIVE_INDEX
    assert (migration.revision, migration.down_revision, migration.KEY) == ("0022", "0020", "workload.view")


@requires_db
def test_0022_gives_the_key_to_every_charge_nurse_group_and_to_no_other(clean_db):
    """ON CONFLICT DO NOTHING: a hospital that gave its charge nurses the key by hand first is not refused."""
    engine, cfg = clean_db
    command.upgrade(cfg, "0020")
    with engine.begin() as conn:
        for slug in ("h1", "h2"):
            _tenant(conn, slug)
        conn.execute(text("INSERT INTO group_permissions (group_id, permission) SELECT g.id, 'workload.view' "
                          "FROM groups g JOIN tenants t ON t.id = g.tenant_id "
                          "WHERE g.slug = 'charge_nurse' AND t.slug = 'h1'"))
    command.upgrade(cfg, "0022")
    with engine.connect() as conn:
        assert {tuple(r) for r in conn.execute(text(GRANTS))} == CHARGE
    command.upgrade(cfg, "head")                              # at 0022 or past it: a later migration may follow (M2)
    with engine.connect() as conn:
        assert {tuple(r) for r in conn.execute(text(GRANTS))} == CHARGE
        assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() >= "0022"


@requires_db
def test_0022_ends_a_row_of_the_wrong_unit_and_all_but_the_newest_of_a_bed_and_window_then_holds_one(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "0020")
    with engine.begin() as conn:
        tenant = _tenant(conn, "h1")
        (unit, bed), (unit2, bed2) = _bed(conn, tenant), _bed(conn, tenant)
        n1, n2 = _user(conn, "n1"), _user(conn, "n2")
        older = _row(conn, unit, bed, n1, hours_ago=3)                 # the older of two active rows: ended
        newest = _row(conn, unit, bed, n2, hours_ago=1)                # the newest: stays
        ended = _row(conn, unit, bed, n1, hours_ago=5, active=False)   # history already: left as it is
        later = _row(conn, unit, bed, n1, start=A + timedelta(hours=12))   # another window: its own
        astray = _row(conn, unit2, bed, n2, start=A + timedelta(hours=24))   # bed of `unit`, written under `unit2`
        # A tie on `created_at` (one transaction, one `now()`): the greater id stays.
        low = _row(conn, unit2, bed2, n1, row_id=uuid.UUID(int=1))
        high = _row(conn, unit2, bed2, n2, row_id=uuid.UUID(int=2 ** 128 - 1))
    command.upgrade(cfg, "0022")
    with engine.connect() as conn:
        assert _active(conn) == {newest, later, high}
        assert _closed(conn) == {older, astray, low}                  # the rows 0022 ended, and only those
        assert conn.execute(text("SELECT count(*) FROM nurse_bed_assignments")).scalar_one() == 7   # none deleted
        assert ended not in _active(conn) | _closed(conn)
        (definition,) = _index(conn)
        assert "UNIQUE" in definition and "(bed_id, shift_start)" in definition and "WHERE is_active" in definition
    with pytest.raises(IntegrityError), engine.begin() as conn:
        _row(conn, unit, bed, n1)                                      # a second active row of that bed and window
    with engine.begin() as conn:
        _row(conn, unit, bed, n1, active=False)                        # an ended one is history: any number of them


@requires_db
def test_the_downgrade_drops_the_index_the_column_and_the_key_and_reactivates_nothing(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "0020")
    with engine.begin() as conn:
        tenant = _tenant(conn, "h1")
        unit, bed = _bed(conn, tenant)
        n1 = _user(conn, "n1")
        _row(conn, unit, bed, n1, hours_ago=2)
        kept = _row(conn, unit, bed, n1, hours_ago=1)
    command.upgrade(cfg, "0022")
    with engine.begin() as conn:                              # a hospital gives the key to its own group (Roles screen)
        conn.execute(text("INSERT INTO group_permissions (group_id, permission) SELECT id, 'workload.view' "
                          "FROM groups WHERE slug = 'bakim_ekibi'"))
    command.downgrade(cfg, "0020")
    with engine.connect() as conn:
        assert {tuple(r) for r in conn.execute(text(GRANTS))} == set()
        assert _index(conn) == []
        assert "closed_at" not in {c["name"] for c in inspect(conn).get_columns("nurse_bed_assignments")}
        assert _active(conn) == {kept}                        # the ended row stays ended
        assert conn.execute(text("SELECT count(*) FROM groups")).scalar_one() == 3     # the groups stay
    command.upgrade(cfg, "0022")                              # and again
    with engine.connect() as conn:
        assert {tuple(r) for r in conn.execute(text(GRANTS))} == {("h1", "charge_nurse")}
        assert len(_index(conn)) == 1

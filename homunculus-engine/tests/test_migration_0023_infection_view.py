# homunculus-engine/tests/test_migration_0023_infection_view.py
"""Migration 0023 (G4-05 Enfeksiyon kontrol, spec D2, D21, §5 A2, M5) on the real chain (`clean_db`, never
`create_all`):
- the tenants seeded before it get `infection.view` on their `attending`, `unit_physician`, `physician`,
  `charge_nurse` and `nurse` groups, in every tenant; a `pharmacist`, a `rapid_response`, an `auditor`, a hospital's
  own group and `hospital_admin` get no row (the system group holds the catalogue by rule);
- the statement is idempotent (a group that already holds the key, a second run);
- the downgrade removes the key's rows and leaves the groups and their other rows; 0021 → 0023 → 0021 → 0023 runs;
- the head is checked BY ANCESTRY, never by the names' order: TRƏS may renumber onto this one, or this onto it
  (plan note N16).
The first test needs no database: the migration's slugs, its statement and `DEFAULT_GROUPS` say the same five groups,
or a migrated hospital and a new one would differ. Synthetic rows only."""
from __future__ import annotations

import importlib.util
import re
import uuid
from pathlib import Path

from alembic import command
from alembic.script import ScriptDirectory
from sqlalchemy import text

from homunculus.auth.permissions import DEFAULT_GROUPS
from tests.conftest import requires_db

KEY = "infection.view"
#: (revision, down_revision) — the one line a renumber changes here (plan note N16).
CHAIN = ("0023", "0021")
HOLDERS = {"attending", "unit_physician", "physician", "charge_nurse", "nurse"}
_GRANTS = ("SELECT t.slug, g.slug FROM group_permissions gp JOIN groups g ON g.id = gp.group_id "
           "JOIN tenants t ON t.id = g.tenant_id WHERE gp.permission = 'infection.view'")


def _migration():
    """The migration module, loaded by its path (its name starts with a digit, so it is not importable)."""
    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0023_infection_view.py"
    spec = importlib.util.spec_from_file_location("migration_0023_infection_view", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_migration_names_the_groups_the_catalogue_gives_the_key_to():
    migration = _migration()
    assert (migration.revision, migration.down_revision, migration.KEY) == (*CHAIN, KEY)
    seeded = {g["slug"] for g in DEFAULT_GROUPS if KEY in g["permissions"] and not g["is_system"]}
    assert set(migration.GROUPS) == seeded == HOLDERS
    assert set(re.findall(r"'([a-z_]+)'", migration.GRANT.split("WHERE slug IN", 1)[1])) == HOLDERS
    assert "'infection.view'" in migration.GRANT and migration.GRANT.endswith("ON CONFLICT DO NOTHING")
    assert migration.REVOKE == "DELETE FROM group_permissions WHERE permission = 'infection.view'"
    assert ";" not in migration.GRANT + migration.REVOKE          # one statement per op.execute (asyncpg)


def _tenant(conn, slug: str) -> uuid.UUID:
    tid = uuid.uuid4()
    conn.execute(text("INSERT INTO tenants (id, name, slug, country_code) VALUES (:id, :n, :s, 'AZ')"),
                 {"id": tid, "n": f"Sentetik {slug}", "s": slug})
    return tid


def _group(conn, tenant: uuid.UUID, slug: str, *permissions: str, system: bool = False) -> uuid.UUID:
    gid = uuid.uuid4()
    conn.execute(text(
        "INSERT INTO groups (id, tenant_id, slug, name, description, mfa_required, is_system, "
        "created_at, updated_at) VALUES (:id, :t, :s, :s, '', false, :sys, now(), now())"),
        {"id": gid, "t": tenant, "s": slug, "sys": system})
    for key in permissions:
        conn.execute(text("INSERT INTO group_permissions (group_id, permission) VALUES (:g, :p)"),
                     {"g": gid, "p": key})
    return gid


def _ward(conn) -> None:
    """Two tenants seeded before 0023: hastane-a with the five holders, the three groups that do not hold it, the system
    group and a group of its own; hastane-b with a nurse and a pharmacist."""
    a, b = _tenant(conn, "hastane-a"), _tenant(conn, "hastane-b")
    _group(conn, a, "attending", "board.view")
    _group(conn, a, "unit_physician", "board.view")
    _group(conn, a, "physician", "board.view", "alerts.ack")
    _group(conn, a, "charge_nurse", "board.view")
    _group(conn, a, "nurse", "board.view", "alerts.ack")
    _group(conn, a, "pharmacist", "board.view", "pharmacy.view")
    _group(conn, a, "rapid_response", "board.view")
    _group(conn, a, "auditor", "board.view", "audit.view")
    _group(conn, a, "hospital_admin", "board.view", system=True)
    _group(conn, a, "gece_ekibi", "board.view")
    _group(conn, b, "nurse", "board.view")
    _group(conn, b, "pharmacist", "board.view")


def _grants(conn) -> set[tuple[str, str]]:
    return {tuple(row) for row in conn.execute(text(_GRANTS))}


def _other_rows(conn) -> int:
    return conn.execute(text("SELECT count(*) FROM group_permissions WHERE permission <> 'infection.view'")).scalar_one()


@requires_db
def test_the_upgrade_gives_the_key_to_the_five_groups_of_every_tenant_and_to_no_other(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, CHAIN[1])
    with engine.begin() as conn:
        _ward(conn)
        before = _other_rows(conn)
    command.upgrade(cfg, CHAIN[0])
    with engine.connect() as conn:
        grants, after = _grants(conn), _other_rows(conn)
    assert grants == {("hastane-a", slug) for slug in HOLDERS} | {("hastane-b", "nurse")}
    assert after == before == 16                                  # no other row was touched
    command.upgrade(cfg, "head")                                  # at 0023 or past it: a later migration may follow
    with engine.connect() as conn:
        assert _grants(conn) == grants
        version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
    # «At 0023 or past it» by the revision graph, never by the names' order (spec D21, §5 M5).
    assert CHAIN[0] in {s.revision for s in ScriptDirectory.from_config(cfg).iterate_revisions(version, "base")}


@requires_db
def test_the_statement_is_idempotent(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, CHAIN[1])
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        _group(conn, tenant, "nurse", "board.view", KEY)               # a hospital gave it by hand already
        _group(conn, tenant, "physician", "board.view")
    command.upgrade(cfg, CHAIN[0])
    with engine.begin() as conn:
        conn.execute(text(_migration().GRANT))
        conn.execute(text(_migration().GRANT))
        grants = _grants(conn)
        rows = conn.execute(text("SELECT count(*) FROM group_permissions WHERE permission = 'infection.view'")).scalar_one()
    assert grants == {("hastane-a", "nurse"), ("hastane-a", "physician")} and rows == 2


@requires_db
def test_the_downgrade_removes_the_keys_rows_and_leaves_the_groups_and_their_other_rows(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, CHAIN[1])
    with engine.begin() as conn:
        _ward(conn)
        before = _other_rows(conn)
    command.upgrade(cfg, CHAIN[0])
    with engine.begin() as conn:          # after the upgrade a hospital gives its own group the key
        conn.execute(text("INSERT INTO group_permissions (group_id, permission) "
                          "SELECT id, 'infection.view' FROM groups WHERE slug = 'gece_ekibi'"))
    command.downgrade(cfg, CHAIN[1])
    with engine.connect() as conn:
        grants, after = _grants(conn), _other_rows(conn)
        groups = conn.execute(text("SELECT count(*) FROM groups")).scalar_one()
        version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
    assert grants == set() and after == before == 16 and groups == 12 and version == CHAIN[1]
    command.upgrade(cfg, CHAIN[0])
    with engine.connect() as conn:
        assert len(_grants(conn)) == 6

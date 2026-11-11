# homunculus-engine/tests/test_migration_0020_quality_view.py
"""G4-03 migration 0020 (spec D7). Without a database: its group is the one `DEFAULT_GROUPS` gives the key to (the
auditor's), and it follows G3-04's 0019. On the real chain (`clean_db`, never `create_all`): `quality.view` goes to
every tenant's `auditor` group and to no other; a group already holding it is left as it is; the downgrade takes the
key from every group — one the hospital gave it to since included — and leaves the groups; 0019 → 0020 → 0019 → 0020
runs, and 0020 is the head. Synthetic rows only."""
from __future__ import annotations

import importlib.util
from pathlib import Path

from alembic import command
from sqlalchemy import create_engine, text

from homunculus.api.audit_postgres import to_sync_url
from homunculus.auth.permissions import DEFAULT_GROUPS
from tests.conftest import TEST_DATABASE_URL, requires_db

#: The rows migration 0020 writes, as (tenant slug, group slug).
GRANTS = ("SELECT t.slug, g.slug FROM group_permissions gp JOIN groups g ON g.id = gp.group_id "
          "JOIN tenants t ON t.id = g.tenant_id WHERE gp.permission = 'quality.view'")
AUDITORS = {("h1", "auditor"), ("h2", "auditor")}


def _tenants_with_groups(sync) -> None:
    """Two tenants, each with an `auditor`, a `nurse` and a group of the hospital's own (`kalite_birimi`)."""
    with sync.begin() as conn:
        for slug in ("h1", "h2"):
            conn.execute(text("INSERT INTO tenants (id, slug, name, country_code, timezone, created_at) "
                              "VALUES (gen_random_uuid(), :s, :s, 'AZ', 'Asia/Baku', now())"), {"s": slug})
            for group in ("auditor", "nurse", "kalite_birimi"):
                conn.execute(text("INSERT INTO groups (id, tenant_id, slug, name, description, mfa_required, "
                                  "is_system, created_at, updated_at) SELECT gen_random_uuid(), id, :g, :g, '', "
                                  "false, false, now(), now() FROM tenants WHERE slug = :s"), {"g": group, "s": slug})


def _grants(sync) -> set[tuple[str, str]]:
    with sync.connect() as conn:
        return {tuple(r) for r in conn.execute(text(GRANTS))}


def test_the_migration_names_the_group_the_catalogue_gives_the_key_to():
    """`DEFAULT_GROUPS` seeds a tenant made later, 0020 the ones seeded before: one group, the auditor's (the system
    group holds every key by rule). No database: the file is loaded by its path (its name starts with a digit)."""
    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0020_quality_view.py"
    spec = importlib.util.spec_from_file_location("migration_0020_quality_view", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    holders = {g["slug"] for g in DEFAULT_GROUPS if "quality.view" in g["permissions"] and not g["is_system"]}
    assert holders == {migration.GROUP} == {"auditor"}
    assert (migration.revision, migration.down_revision, migration.KEY) == ("0020", "0019", "quality.view")


@requires_db
def test_0020_gives_the_key_to_every_auditor_group_and_to_no_other(clean_db):
    _, cfg = clean_db
    command.upgrade(cfg, "0019")
    sync = create_engine(to_sync_url(TEST_DATABASE_URL))
    try:
        _tenants_with_groups(sync)
        command.upgrade(cfg, "0020")
        assert _grants(sync) == AUDITORS
        command.upgrade(cfg, "head")                          # nothing after it
        assert _grants(sync) == AUDITORS
        with sync.connect() as conn:                          # at 0020 or past it: a later migration may follow
            assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() >= "0020"
    finally:
        sync.dispose()


@requires_db
def test_an_auditor_group_already_holding_the_key_is_left_as_it_is(clean_db):
    """ON CONFLICT DO NOTHING: a hospital that gave its auditors the key by hand first is not refused."""
    _, cfg = clean_db
    command.upgrade(cfg, "0019")
    sync = create_engine(to_sync_url(TEST_DATABASE_URL))
    try:
        _tenants_with_groups(sync)
        with sync.begin() as conn:
            conn.execute(text("INSERT INTO group_permissions (group_id, permission) SELECT g.id, 'quality.view' "
                              "FROM groups g JOIN tenants t ON t.id = g.tenant_id "
                              "WHERE g.slug = 'auditor' AND t.slug = 'h1'"))
        command.upgrade(cfg, "0020")
        assert _grants(sync) == AUDITORS
    finally:
        sync.dispose()


@requires_db
def test_the_downgrade_takes_the_key_from_every_group_and_leaves_the_groups(clean_db):
    _, cfg = clean_db
    command.upgrade(cfg, "0019")
    sync = create_engine(to_sync_url(TEST_DATABASE_URL))
    try:
        _tenants_with_groups(sync)
        command.upgrade(cfg, "0020")
        with sync.begin() as conn:                            # a hospital gives it to its own group (Roles screen)
            conn.execute(text("INSERT INTO group_permissions (group_id, permission) SELECT id, 'quality.view' "
                              "FROM groups WHERE slug = 'kalite_birimi'"))
        command.downgrade(cfg, "0019")
        assert _grants(sync) == set()
        with sync.connect() as conn:
            assert conn.execute(text("SELECT count(*) FROM groups")).scalar_one() == 6     # the groups stay
        command.upgrade(cfg, "0020")                          # and again
        assert _grants(sync) == AUDITORS
    finally:
        sync.dispose()

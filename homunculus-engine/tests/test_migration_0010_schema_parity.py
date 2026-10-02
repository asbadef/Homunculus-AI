# homunculus-engine/tests/test_migration_0010_schema_parity.py
"""Alembic (production) and Base.metadata (tests) must agree on the schema migration 0010 owns:
the RBAC tables, the `users` columns it adds or alters, and `tenant_memberships`, whose `role` it
turns into a legacy `varchar(40)`. Scoped to those objects: older tables carry known, harmless
differences (nullable timestamps, index names) that are not this migration's business.

Column TYPES are compared for every table the models map, not only 0010's. An ORM insert names
every mapped column, bound with the model's type, so a column the migrations type differently
breaks every insert on a deployed database while the tests, built from the models with
`create_all`, never see it. That was deploy blocker B1: `tenant_memberships.role` stayed the enum
`userrole` while the model mapped `String(40)`, and PostgreSQL refused `role = NULL::VARCHAR`.

Scoping uses `include_object`, not `include_name`: Alembic's `include_name` hook only prunes
names on the *reflection* (DB) side of the comparison (see `AutogenContext.run_name_filters`'s
own docstring) — it is never consulted for the target `Base.metadata` side. Used here, that
asymmetry would make every excluded-but-already-existing table/column look "added" (present in
metadata, invisible on the filtered DB side), which is exactly backwards for a parity check.
`include_object` is consulted on both sides and gives the intended scoping."""
from __future__ import annotations

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext

import homunculus.admission.models  # noqa: F401  (register every table on Base.metadata)
import homunculus.auth.models  # noqa: F401
import homunculus.escalation.models  # noqa: F401
import homunculus.tenant.models  # noqa: F401
from homunculus.db import Base
from tests.conftest import requires_db

pytestmark = [requires_db]

OWNED_TABLES = {"groups", "group_permissions", "user_groups", "ldap_group_mappings", "users",
                "tenant_memberships"}
# In the older tables 0010 alters, only the columns it adds or alters are its business. The one
# column of `tenant_memberships` left out is `created_at`: nullable since 0001, NOT NULL in the
# model (the known timestamp difference; the ORM always writes it). Its TYPE is still compared,
# by the whole-schema type test below.
OWNED_COLUMNS = {
    "users": {"username", "email", "hashed_password", "auth_source", "external_id", "ldap_dn",
              "token_version", "last_login_at", "sessions_revoked_at"},
    "tenant_memberships": {"id", "user_id", "tenant_id", "role", "granted_by_id", "is_active"},
}


def _owned(object_, name, type_, reflected, compare_to):
    if type_ == "table":
        return name in OWNED_TABLES
    if type_ == "column":
        table_name = object_.table.name if object_ is not None else None
        if table_name in OWNED_COLUMNS:
            return name in OWNED_COLUMNS[table_name]
        return True
    return True


@pytest.fixture
def migrated(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    return engine


def _diffs(engine, **opts) -> list:
    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn, opts={
            "compare_type": True,
            "compare_server_default": False,   # text renderings differ; the values are tested elsewhere
            **opts,
        })
        return compare_metadata(ctx, Base.metadata)


def test_alembic_and_the_models_agree_on_the_rbac_schema(migrated):
    diffs = _diffs(migrated, include_object=_owned)
    assert diffs == [], diffs


def test_every_mapped_column_has_the_type_the_migrations_give_it(migrated):
    """Every table, every column: only the type. (A column-level change comes back as a list of
    `modify_*` tuples; tables and indexes as bare tuples, and those are the scoped test's job.)"""
    changes = [change for diff in _diffs(migrated) if isinstance(diff, list) for change in diff]
    mismatched = [change for change in changes if change[0] == "modify_type"]
    assert mismatched == [], mismatched

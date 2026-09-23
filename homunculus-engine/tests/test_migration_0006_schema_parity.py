# homunculus-engine/tests/test_migration_0006_schema_parity.py
"""Alembic (production) and Base.metadata (tests) must agree on the RBAC tables and the users
columns migration 0006 adds. Scoped to those objects: older tables carry known, harmless
differences (nullable timestamps) that are not this migration's business.

Scoping uses `include_object`, not `include_name`: Alembic's `include_name` hook only prunes
names on the *reflection* (DB) side of the comparison (see `AutogenContext.run_name_filters`'s
own docstring) — it is never consulted for the target `Base.metadata` side. Used here, that
asymmetry would make every excluded-but-already-existing table/column look "added" (present in
metadata, invisible on the filtered DB side), which is exactly backwards for a parity check.
`include_object` is consulted on both sides and gives the intended scoping."""
from __future__ import annotations

from pathlib import Path

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, text

import homunculus.admission.models  # noqa: F401  (register every table on Base.metadata)
import homunculus.auth.models  # noqa: F401
import homunculus.escalation.models  # noqa: F401
import homunculus.tenant.models  # noqa: F401
from homunculus.db import Base
from tests.conftest import TEST_DATABASE_URL, requires_db

pytestmark = [requires_db]

ROOT = Path(__file__).resolve().parents[1]
OWNED_TABLES = {"groups", "group_permissions", "user_groups", "ldap_group_mappings", "users"}
OWNED_USER_COLUMNS = {"username", "email", "hashed_password", "auth_source", "external_id",
                      "ldap_dn", "token_version", "last_login_at"}


def _sync_url() -> str:
    for scheme in ("postgresql+asyncpg://", "postgresql://"):
        if TEST_DATABASE_URL.startswith(scheme):
            return "postgresql+psycopg2://" + TEST_DATABASE_URL[len(scheme):]
    return TEST_DATABASE_URL


def _owned(object_, name, type_, reflected, compare_to):
    if type_ == "table":
        return name in OWNED_TABLES
    if type_ == "column":
        table_name = object_.table.name if object_ is not None else None
        if table_name == "users":
            return name in OWNED_USER_COLUMNS
        return True
    return True


@pytest.fixture
def migrated(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)
    engine = create_engine(_sync_url())
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "alembic"))
    command.upgrade(cfg, "head")
    yield engine
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    engine.dispose()


def test_alembic_and_the_models_agree_on_the_rbac_schema(migrated):
    with migrated.connect() as conn:
        ctx = MigrationContext.configure(conn, opts={
            "compare_type": True,
            "compare_server_default": False,   # text renderings differ; the values are tested elsewhere
            "include_object": _owned,
        })
        diffs = compare_metadata(ctx, Base.metadata)
    assert diffs == [], diffs

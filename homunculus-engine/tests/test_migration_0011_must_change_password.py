# homunculus-engine/tests/test_migration_0011_must_change_password.py
"""Migration 0011 on a database built by the real chain (`clean_db`, never `create_all`): every
LOCAL account that existed before it is flagged — it chooses its own password at its next sign-in
(the user's decision) — and no AD account is; the column is NOT NULL with a false default for
accounts made afterwards, agrees with the model, and the downgrade takes it away again. Sync tests
on purpose (alembic runs its own event loop, see `clean_db`). Synthetic accounts only."""
from __future__ import annotations

import uuid

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect, text

import homunculus.admission.models  # noqa: F401  (register every table on Base.metadata)
import homunculus.auth.models  # noqa: F401
import homunculus.escalation.models  # noqa: F401
import homunculus.tenant.models  # noqa: F401
from homunculus.db import Base
from tests.conftest import requires_db

pytestmark = [requires_db]


def _columns(engine) -> dict[str, dict]:
    return {c["name"]: c for c in inspect(engine).get_columns("users")}


def _add_account(conn, username: str, source: str = "local") -> uuid.UUID:
    """An account as 0010 left the table: no `must_change_password` named in the INSERT."""
    uid = uuid.uuid4()
    conn.execute(text(
        "INSERT INTO users (id, username, email, full_name, hashed_password, auth_source, "
        "totp_enabled, is_active, is_platform_support) VALUES (:id, :u, :u, 'Sentetik', "
        ":pw, :src, false, true, false)"),
        {"id": uid, "u": username, "pw": "x" if source == "local" else None, "src": source})
    return uid


def test_every_local_account_from_before_0011_is_flagged_and_no_ad_one(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "0010")
    with engine.begin() as conn:
        local = _add_account(conn, "yerel@example.com")
        seed = _add_account(conn, "admin")                 # the seed administrator is local too
        directory = _add_account(conn, "ad.hesap", source="ldap")
        other_ad = _add_account(conn, "ad.ikinci", source="ldap")
    command.upgrade(cfg, "0011")

    with engine.begin() as conn:
        flags = dict(conn.execute(text("SELECT id, must_change_password FROM users")).all())
    assert flags == {local: True, seed: True, directory: False, other_ad: False}
    column = _columns(engine)["must_change_password"]
    assert column["nullable"] is False
    assert "false" in str(column["default"]).lower()


def test_an_insert_that_does_not_name_the_flag_gets_false(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        uid = _add_account(conn, "sonra@example.com")
        assert conn.execute(text("SELECT must_change_password FROM users WHERE id = :id"),
                            {"id": uid}).scalar_one() is False


def test_the_downgrade_drops_the_column_and_the_upgrade_flags_again(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        uid = _add_account(conn, "gidip@example.com")
        directory = _add_account(conn, "ad.donus", source="ldap")
    command.downgrade(cfg, "0010")
    assert "must_change_password" not in _columns(engine)
    with engine.begin() as conn:                       # the accounts themselves survive
        assert conn.execute(text("SELECT count(*) FROM users")).scalar_one() == 2
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        flags = dict(conn.execute(text("SELECT id, must_change_password FROM users")).all())
    assert flags == {uid: True, directory: False}


def test_the_model_and_the_migration_agree_on_the_column(clean_db):
    """Type, nullability, presence: the scoped parity test of 0010 leaves this column out."""
    engine, cfg = clean_db
    command.upgrade(cfg, "head")

    def only_the_flag(object_, name, type_, reflected, compare_to):
        if type_ == "table":
            return name == "users"
        if type_ == "column":
            return name == "must_change_password"
        return False

    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn, opts={
            "compare_type": True, "compare_server_default": False,
            "include_object": only_the_flag})
        assert compare_metadata(ctx, Base.metadata) == []

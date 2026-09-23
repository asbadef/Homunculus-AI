# homunculus-engine/tests/test_migration_0006_conversion.py
"""Migration 0006 on a database that holds legacy roles: one user_groups row per active
membership, in the mapped group; usernames backfilled from e-mail; 11 default groups per tenant.

Runs the real Alembic chain, so it needs TEST_DATABASE_URL. It rebuilds the `public` schema —
the conftest guard already refuses any database whose name does not contain "test".
"""
from __future__ import annotations

import uuid
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text

from tests.conftest import TEST_DATABASE_URL, requires_db

pytestmark = [requires_db]

ROOT = Path(__file__).resolve().parents[1]
LEGACY = ["HOSPITAL_ADMIN", "ATTENDING", "UNIT_PHYSICIAN", "ASSOCIATE_PHYSICIAN",
          "ONCALL_PHYSICIAN", "CHARGE_NURSE", "NURSE", "RAPID_RESPONSE", "AUDITOR",
          "PLATFORM_SUPPORT"]
EXPECTED = {"HOSPITAL_ADMIN": "hospital_admin", "ATTENDING": "attending",
            "UNIT_PHYSICIAN": "unit_physician", "ASSOCIATE_PHYSICIAN": "physician",
            "ONCALL_PHYSICIAN": "physician", "CHARGE_NURSE": "charge_nurse", "NURSE": "nurse",
            "RAPID_RESPONSE": "rapid_response", "AUDITOR": "auditor",
            "PLATFORM_SUPPORT": "platform_support"}


def _sync_url() -> str:
    for scheme in ("postgresql+asyncpg://", "postgresql://"):
        if TEST_DATABASE_URL.startswith(scheme):
            return "postgresql+psycopg2://" + TEST_DATABASE_URL[len(scheme):]
    return TEST_DATABASE_URL


@pytest.fixture
def clean_db(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)   # alembic/env.py reads this
    engine = create_engine(_sync_url())
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "alembic"))
    yield engine, cfg
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    engine.dispose()


def test_legacy_roles_become_group_memberships(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "0005")

    demo, other = uuid.uuid4(), uuid.uuid4()
    with engine.begin() as conn:
        for tid, slug in ((demo, "demo-hastanesi"), (other, "other")):
            conn.execute(text("INSERT INTO tenants (id, name, slug, country_code, timezone, is_active) "
                              "VALUES (:id, :slug, :slug, 'TR', 'UTC', true)"), {"id": tid, "slug": slug})

        def add_user(email, name):
            uid = uuid.uuid4()
            conn.execute(text("INSERT INTO users (id, email, full_name, hashed_password, totp_enabled, "
                              "is_active, is_platform_support) VALUES (:id, :email, :name, 'x', false, "
                              "true, false)"), {"id": uid, "email": email, "name": name})
            return uid

        def add_membership(uid, tid, role, active=True):
            conn.execute(text("INSERT INTO tenant_memberships (id, user_id, tenant_id, role, is_active) "
                              "VALUES (:id, :uid, :tid, CAST(:role AS userrole), :active)"),
                         {"id": uuid.uuid4(), "uid": uid, "tid": tid, "role": role, "active": active})

        for role in LEGACY:
            add_membership(add_user(f"{role}@Example.com", role), demo, role)
        add_membership(add_user("inactive@example.com", "INACTIVE"), demo, "ATTENDING", active=False)
        add_membership(add_user("other-nurse@example.com", "OTHER_NURSE"), other, "NURSE")

    command.upgrade(cfg, "head")

    with engine.begin() as conn:
        per_tenant = dict(conn.execute(text("SELECT tenant_id, count(*) FROM groups GROUP BY tenant_id")).all())
        assert per_tenant == {demo: 11, other: 11}
        rows = conn.execute(text(
            "SELECT u.full_name AS who, g.slug, g.tenant_id AS group_tenant, m.tenant_id AS member_tenant, "
            "ug.source FROM user_groups ug JOIN users u ON u.id = ug.user_id "
            "JOIN groups g ON g.id = ug.group_id JOIN tenant_memberships m ON m.user_id = ug.user_id")).all()
        assert len(rows) == len(LEGACY) + 1                          # one row per ACTIVE membership
        assert {r.who: r.slug for r in rows if r.who != "OTHER_NURSE"} == EXPECTED
        assert next(r for r in rows if r.who == "OTHER_NURSE").slug == "nurse"
        assert all(r.group_tenant == r.member_tenant for r in rows)   # never across tenants
        assert all(r.source == "manual" for r in rows)
        assert "INACTIVE" not in {r.who for r in rows}                # inactive membership: no group
        users = conn.execute(text("SELECT username, email, auth_source, token_version FROM users")).all()
        assert all(r.username == r.email == r.email.lower() for r in users)
        assert all(r.auth_source == "local" and r.token_version == 0 for r in users)
        nullable = conn.execute(text(
            "SELECT is_nullable FROM information_schema.columns "
            "WHERE table_name = 'tenant_memberships' AND column_name = 'role'")).scalar_one()
        assert nullable == "YES"
        assert conn.execute(text("SELECT count(*) FROM tenant_memberships WHERE role IS NULL")).scalar_one() == 0


def test_email_case_collisions_block_the_upgrade_before_any_change(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "0005")
    with engine.begin() as conn:
        for email in ("Ayse@example.com", "ayse@example.com"):
            conn.execute(text("INSERT INTO users (id, email, full_name, hashed_password, totp_enabled, "
                              "is_active, is_platform_support) VALUES (:id, :email, 'x', 'x', false, "
                              "true, false)"), {"id": uuid.uuid4(), "email": email})
    with pytest.raises(Exception, match="differ only by case"):
        command.upgrade(cfg, "head")
    with engine.begin() as conn:
        assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0005"
        assert conn.execute(text("SELECT to_regclass('public.groups')")).scalar_one() is None

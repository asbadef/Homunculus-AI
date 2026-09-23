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

    tenant_id = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO tenants (id, name, slug, country_code, timezone, is_active) "
                          "VALUES (:id, 'Demo', 'demo-hastanesi', 'TR', 'UTC', true)"),
                     {"id": tenant_id})
        for role in LEGACY:
            uid = uuid.uuid4()
            conn.execute(text("INSERT INTO users (id, email, full_name, hashed_password, totp_enabled, "
                              "is_active, is_platform_support) VALUES (:id, :email, :name, 'x', false, "
                              "true, false)"),
                         {"id": uid, "email": f"{role}@Example.com", "name": role})
            conn.execute(text("INSERT INTO tenant_memberships (id, user_id, tenant_id, role, is_active) "
                              "VALUES (:id, :uid, :tid, CAST(:role AS userrole), true)"),
                         {"id": uuid.uuid4(), "uid": uid, "tid": tenant_id, "role": role})

    command.upgrade(cfg, "head")

    with engine.begin() as conn:
        groups = conn.execute(text("SELECT count(*) FROM groups WHERE tenant_id = :t"),
                              {"t": tenant_id}).scalar_one()
        assert groups == 11
        rows = conn.execute(text(
            "SELECT u.full_name AS role, g.slug, ug.source FROM user_groups ug "
            "JOIN users u ON u.id = ug.user_id JOIN groups g ON g.id = ug.group_id")).all()
        assert len(rows) == len(LEGACY)                       # exactly one row per membership
        assert {r.role: r.slug for r in rows} == EXPECTED
        assert {r.source for r in rows} == {"manual"}
        usernames = conn.execute(text("SELECT username, email FROM users")).all()
        assert all(r.username == r.email and r.email == r.email.lower() for r in usernames)
        nulls = conn.execute(text("SELECT count(*) FROM tenant_memberships WHERE role IS NULL")).scalar_one()
        assert nulls == 0                                     # the legacy value is kept, not cleared

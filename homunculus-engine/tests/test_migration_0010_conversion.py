# homunculus-engine/tests/test_migration_0010_conversion.py
"""Migration 0010 on a database that holds legacy roles: one user_groups row per active
membership, in the mapped group; usernames backfilled from e-mail; 11 default groups per tenant;
`tenant_memberships.role` kept as `varchar(40)` text, and turned back into the enum on downgrade.

Runs the real Alembic chain (the `clean_db` fixture in conftest), so it needs TEST_DATABASE_URL.
It rebuilds the `public` schema — the conftest guard already refuses any database whose name does
not contain "test".
"""
from __future__ import annotations

import asyncio
import uuid

import pytest
from alembic import command
from sqlalchemy import text

from tests.conftest import TEST_DATABASE_URL, requires_db

pytestmark = [requires_db]

LEGACY = ["HOSPITAL_ADMIN", "ATTENDING", "UNIT_PHYSICIAN", "ASSOCIATE_PHYSICIAN",
          "ONCALL_PHYSICIAN", "CHARGE_NURSE", "NURSE", "RAPID_RESPONSE", "AUDITOR",
          "PLATFORM_SUPPORT", "PHARMACIST", "BIOMEDICAL"]
EXPECTED = {"HOSPITAL_ADMIN": "hospital_admin", "ATTENDING": "attending",
            "UNIT_PHYSICIAN": "unit_physician", "ASSOCIATE_PHYSICIAN": "physician",
            "ONCALL_PHYSICIAN": "physician", "CHARGE_NURSE": "charge_nurse", "NURSE": "nurse",
            "RAPID_RESPONSE": "rapid_response", "AUDITOR": "auditor",
            "PLATFORM_SUPPORT": "platform_support",
            "PHARMACIST": "pharmacist", "BIOMEDICAL": "biomedical"}


def test_legacy_roles_become_group_memberships(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "0009")

    demo, other, scope_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
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
        # Rows main's 0008/0009 own must pass through 0010 untouched.
        scope_user = add_user("scoped@example.com", "SCOPED")
        conn.execute(text("INSERT INTO staff_scopes (id, tenant_id, user_id, unit_id, bed_id) "
                          "VALUES (:id, :tid, :uid, 'icu-1', '')"),
                     {"id": scope_id, "tid": demo, "uid": scope_user})
        conn.execute(text("INSERT INTO audit (ts, tenant, event_type, patient_id, subject, payload, "
                          "prev_hash, hash) VALUES ('2026-09-01T00:00:00Z', 'HOSP1', 'alert', 'bed-1', "
                          "'news2', '{}'::jsonb, :prev, :h)"), {"prev": "p" * 64, "h": "h" * 64})

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
        # Legacy: nullable, and plain text the ORM can insert NULL into (B1), every value kept.
        column = conn.execute(text(
            "SELECT is_nullable, data_type, character_maximum_length FROM information_schema.columns "
            "WHERE table_name = 'tenant_memberships' AND column_name = 'role'")).one()
        assert tuple(column) == ("YES", "character varying", 40)
        roles = conn.execute(text("SELECT role FROM tenant_memberships")).scalars().all()
        assert sorted(roles) == sorted(LEGACY + ["ATTENDING", "NURSE"])
        scope = conn.execute(text("SELECT tenant_id, unit_id, bed_id, is_active FROM staff_scopes "
                                  "WHERE id = :id"), {"id": scope_id}).one()
        assert tuple(scope) == (demo, "icu-1", "", True)
        sealed = conn.execute(text("SELECT prev_hash, hash FROM audit WHERE tenant = 'HOSP1'")).all()
        assert [tuple(r) for r in sealed] == [("p" * 64, "h" * 64)]


def test_email_case_collisions_block_the_upgrade_before_any_change(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "0009")
    with engine.begin() as conn:
        for email in ("Ayse@example.com", "ayse@example.com"):
            conn.execute(text("INSERT INTO users (id, email, full_name, hashed_password, totp_enabled, "
                              "is_active, is_platform_support) VALUES (:id, :email, 'x', 'x', false, "
                              "true, false)"), {"id": uuid.uuid4(), "email": email})
    with pytest.raises(Exception, match="differ only by case"):
        command.upgrade(cfg, "head")
    with engine.begin() as conn:
        assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0009"
        assert conn.execute(text("SELECT to_regclass('public.groups')")).scalar_one() is None


def _legacy_user(conn, email, *, password_hash="x"):
    uid = uuid.uuid4()
    conn.execute(text("INSERT INTO users (id, email, full_name, hashed_password, totp_enabled, "
                      "is_active, is_platform_support) VALUES (:id, :email, 'x', :pw, false, "
                      "true, false)"), {"id": uid, "email": email, "pw": password_hash})
    return uid


async def _sign_in(logins, password):
    """POST /auth/login for each login against the migrated database, as the app runs it."""
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from homunculus.api.app import create_app
    from homunculus.db import get_db

    engine = create_async_engine(TEST_DATABASE_URL)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    app = create_app({"t": "HOSP1"}, run_escalation_loop=False)

    async def _db():
        async with maker() as session:
            yield session

    app.dependency_overrides[get_db] = _db
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            return {login: (await c.post("/auth/login", json={"login": login,
                                                              "password": password})).status_code
                    for login in logins}
    finally:
        await engine.dispose()


def test_turkish_i_in_a_legacy_email_is_folded_like_sign_in_and_signs_in(clean_db):
    """A legacy `Aydın.İlhan@...`: SQL lower() would have kept the dotless ı (and, under a C
    ctype, the İ as well), while sign-in folds both to `i` — the account could never sign in
    again. The migration folds with a frozen copy of the sign-in fold."""
    from homunculus.auth.service import hash_password

    engine, cfg = clean_db
    command.upgrade(cfg, "0009")
    tenant = uuid.uuid4()
    password = "Gizli-Parola-123"
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO tenants (id, name, slug, country_code, timezone, is_active) "
                          "VALUES (:id, 'Baku', 'baku', 'AZ', 'UTC', true)"), {"id": tenant})
        uid = _legacy_user(conn, "Aydın.İlhan@Hastane.az", password_hash=hash_password(password))
        conn.execute(text("INSERT INTO tenant_memberships (id, user_id, tenant_id, role, is_active) "
                          "VALUES (:id, :uid, :tid, CAST('NURSE' AS userrole), true)"),
                     {"id": uuid.uuid4(), "uid": uid, "tid": tenant})

    command.upgrade(cfg, "head")

    with engine.begin() as conn:
        row = conn.execute(text("SELECT username, email FROM users WHERE id = :id"),
                           {"id": uid}).one()
    assert (row.username, row.email) == ("aydin.ilhan@hastane.az", "aydin.ilhan@hastane.az")
    logins = ["aydın.ilhan@hastane.az", "AYDIN.İLHAN@HASTANE.AZ", "Aydın.İlhan@Hastane.az",
              "aydin.ilhan@hastane.az"]
    assert asyncio.run(_sign_in(logins, password)) == {login: 200 for login in logins}


@pytest.mark.parametrize("pair", [("aydın@hastane.az", "aydin@hastane.az"),
                                  ("İlker@hastane.az", "ilker@hastane.az")], ids=["ı", "İ"])
def test_emails_that_fold_to_one_login_block_the_upgrade_before_any_change(clean_db, pair):
    """Folded, the two would be one login: sign-in could reach only one of the accounts, so the
    upgrade refuses loudly, as it does for a case clash, rather than hide the other."""
    engine, cfg = clean_db
    command.upgrade(cfg, "0009")
    with engine.begin() as conn:
        for email in pair:
            _legacy_user(conn, email)
    with pytest.raises(Exception, match="differ only by case or by the Turkish"):
        command.upgrade(cfg, "head")
    with engine.begin() as conn:
        assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0009"
        assert conn.execute(text("SELECT to_regclass('public.groups')")).scalar_one() is None
        assert sorted(conn.execute(text("SELECT email FROM users")).scalars()) == sorted(pair)


def test_downgrade_turns_the_legacy_roles_back_into_the_enum(clean_db):
    """0010 stores `role` as text; its downgrade must give 0009 back its `userrole` column with
    the values intact. (Lossy elsewhere by design: a membership the new code wrote has no role
    and fails the downgrade's NOT NULL — see the migration's docstring.)"""
    engine, cfg = clean_db
    command.upgrade(cfg, "0009")
    tenant = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO tenants (id, name, slug, country_code, timezone, is_active) "
                          "VALUES (:id, 'Demo', 'demo', 'TR', 'UTC', true)"), {"id": tenant})
        for role in ("HOSPITAL_ADMIN", "NURSE", "PHARMACIST"):
            uid = _legacy_user(conn, f"{role.lower()}@example.com")
            conn.execute(text("INSERT INTO tenant_memberships (id, user_id, tenant_id, role, "
                              "is_active) VALUES (:id, :uid, :tid, CAST(:role AS userrole), true)"),
                         {"id": uuid.uuid4(), "uid": uid, "tid": tenant, "role": role})

    command.upgrade(cfg, "head")
    command.downgrade(cfg, "0009")

    with engine.begin() as conn:
        column = conn.execute(text(
            "SELECT is_nullable, udt_name FROM information_schema.columns "
            "WHERE table_name = 'tenant_memberships' AND column_name = 'role'")).one()
        assert tuple(column) == ("NO", "userrole")
        roles = conn.execute(text("SELECT role::text FROM tenant_memberships")).scalars().all()
        assert sorted(roles) == ["HOSPITAL_ADMIN", "NURSE", "PHARMACIST"]

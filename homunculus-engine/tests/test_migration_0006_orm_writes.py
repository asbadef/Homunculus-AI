# homunculus-engine/tests/test_migration_0006_orm_writes.py
"""The ORM writes a deployment depends on, on a database built by the real migrations
(`alembic upgrade head`), never by `create_all`: the bootstrap seed creates its administrator and
membership (a fresh install), and an administrator carried over by the upgrade creates a user
through `POST /admin/users` (the VM's path).

Deploy blocker B1: migration 0006 left `tenant_memberships.role` as the enum `userrole` while the
model maps it as `String(40)`. Every ORM insert of a membership sent `role = NULL::VARCHAR`, which
PostgreSQL refuses, so the seed restart-looped the API container and the staff tab answered 500.
`db_session` builds the schema from the models, so only a migrated database shows it.

Sync tests on purpose (see the `clean_db` fixture): alembic runs its own event loop. Synthetic
accounts only."""
from __future__ import annotations

import asyncio
import json
import uuid

from alembic import command
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from homunculus.api.app import create_app
from homunculus.auth.models import Group, User
from homunculus.auth.seed import seed_bootstrap
from homunculus.auth.service import build_context, issue_tokens
from homunculus.db import get_db
from tests.conftest import TEST_DATABASE_URL, requires_db

pytestmark = [requires_db]

SEED = dict(
    tenant_name="Demo Hastanesi", tenant_slug="demo-hastanesi", country_code="TR",
    email="Admin@Example.com", full_name="Demo Yönetici", password="Str0ng-Pass-123",
)
DEMO = uuid.UUID("00000000-0000-4000-8000-000000000001")   # the legacy tenant in the upgrade test


async def _seed() -> tuple[uuid.UUID, uuid.UUID]:
    """seed_bootstrap as `scripts/seed_admin.py` runs it: its own engine and session."""
    engine = create_async_engine(TEST_DATABASE_URL)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            tenant, user = await seed_bootstrap(session, **SEED)
            return tenant.id, user.id
    finally:
        await engine.dispose()


async def _create_a_nurse(admin_id: uuid.UUID) -> tuple[int, str]:
    """`POST /admin/users` as the administrator, through the app as it runs. An unhandled error
    comes back as the 500 the dashboard saw, not as a raised exception."""
    engine = create_async_engine(TEST_DATABASE_URL)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    app = create_app({"bridge-token": "demo-hastanesi"}, run_escalation_loop=False)

    async def _db():
        async with maker() as session:
            yield session

    app.dependency_overrides[get_db] = _db
    try:
        async with maker() as session:
            admin = await session.get(User, admin_id)
            nurse_group = (await session.execute(select(Group.id).where(
                Group.tenant_id == DEMO, Group.slug == "nurse"))).scalar_one()
            # Minted from the service, as tests/test_admin_api.py does: the MFA enrolment the
            # administrator's group requires is not what this test is about.
            tokens = issue_tokens(admin, await build_context(session, admin), mfa_verified=True)
        transport = ASGITransport(app=app, raise_app_exceptions=False)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            res = await c.post(
                "/admin/users",
                headers={"Authorization": f"Bearer {tokens['access_token']}"},
                json={"username": "Selin.Arslan", "email": "Selin@Example.com",
                      "full_name": "Selin Arslan", "password": "Gecici-Parola-1",
                      "group_ids": [str(nurse_group)]},
            )
        return res.status_code, res.text
    finally:
        await engine.dispose()


def test_the_seed_creates_the_administrator_on_a_migrated_database(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")

    tenant_id, user_id = asyncio.run(_seed())

    with engine.begin() as conn:
        user = conn.execute(text("SELECT username, email, auth_source, is_active FROM users "
                                 "WHERE id = :id"), {"id": user_id}).one()
        assert tuple(user) == ("admin@example.com", "admin@example.com", "local", True)
        memberships = conn.execute(text(
            "SELECT tenant_id, role, is_active FROM tenant_memberships WHERE user_id = :id"),
            {"id": user_id}).all()
        assert [tuple(m) for m in memberships] == [(tenant_id, None, True)]
        groups = conn.execute(text(
            "SELECT g.slug FROM user_groups ug JOIN groups g ON g.id = ug.group_id "
            "WHERE ug.user_id = :id"), {"id": user_id}).scalars().all()
        assert groups == ["hospital_admin"]
        assert conn.execute(text("SELECT count(*) FROM groups WHERE tenant_id = :id"),
                            {"id": tenant_id}).scalar_one() == 11


def test_an_administrator_creates_a_user_on_a_migrated_database(clean_db):
    """An administrator from before 0006 (a legacy HOSPITAL_ADMIN membership, which the upgrade
    turns into `hospital_admin`) adds a nurse — the first thing the VM's administrator does."""
    engine, cfg = clean_db
    command.upgrade(cfg, "0005")
    admin_id = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO tenants (id, name, slug, country_code, timezone, is_active) "
                          "VALUES (:id, 'Demo Hastanesi', 'demo-hastanesi', 'TR', 'UTC', true)"),
                     {"id": DEMO})
        conn.execute(text("INSERT INTO users (id, email, full_name, hashed_password, totp_enabled, "
                          "is_active, is_platform_support) VALUES (:id, 'yonetici@example.com', "
                          "'Yönetici', 'x', false, true, false)"), {"id": admin_id})
        conn.execute(text("INSERT INTO tenant_memberships (id, user_id, tenant_id, role, "
                          "is_active) VALUES (:id, :uid, :tid, CAST('HOSPITAL_ADMIN' AS userrole), "
                          "true)"),
                     {"id": uuid.uuid4(), "uid": admin_id, "tid": DEMO})
    command.upgrade(cfg, "head")

    status, body = asyncio.run(_create_a_nurse(admin_id))

    assert status == 201, body
    created = json.loads(body)
    assert (created["username"], created["email"]) == ("selin.arslan", "selin@example.com")
    assert [g["slug"] for g in created["groups"]] == ["nurse"]
    with engine.begin() as conn:
        membership = conn.execute(text(
            "SELECT m.tenant_id, m.role, m.is_active, m.granted_by_id FROM tenant_memberships m "
            "JOIN users u ON u.id = m.user_id WHERE u.username = 'selin.arslan'")).one()
        assert tuple(membership) == (DEMO, None, True, admin_id)

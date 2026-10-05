# homunculus-engine/tests/test_auth_password_change.py
"""A temporary password is replaced at the first sign-in (roadmap D4, plan G1 Wave 2 decision 1):
an administrator's new account or password reset flags the LOCAL account; while flagged, its
session reaches only /auth/password, /auth/me, /auth/refresh and /auth/totp/*; the change clears
the flag. MFA comes first. An AD account is never flagged. Synthetic accounts only."""
from __future__ import annotations

import pyotp
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import async_sessionmaker

import homunculus.scope.models  # noqa: F401  (staff_scopes, read by /scope/me, before create_all)
from homunculus.api.app import create_app
from homunculus.auth.groups import ensure_default_groups, set_manual_groups
from homunculus.auth.models import AUTH_LDAP, AUTH_LOCAL, TenantMembership, User
from homunculus.auth.service import (
    build_context, hash_password, issue_tokens, password_change_due,
)
from homunculus.db import get_db
from homunculus.tenant.models import Tenant
from tests.conftest import requires_db

PASSWORD = "Gizli-123"
TEMPORARY = "Gecici-Parola-1"
CHOSEN = "Kendi-Parolam-9"


# ---------------------------------------------------------------- the rule, no database
@pytest.mark.parametrize("source,flag,due", [
    (AUTH_LOCAL, True, True), (AUTH_LOCAL, False, False),
    (AUTH_LDAP, True, False), (AUTH_LDAP, False, False),
])
def test_only_a_flagged_local_account_must_change_its_password(source, flag, due):
    user = User(username="u", full_name="U", auth_source=source, must_change_password=flag)
    assert password_change_due(user) is due


def test_the_token_response_says_so():
    from homunculus.auth.service import EMPTY_CONTEXT
    user = User(username="u", full_name="U", auth_source=AUTH_LOCAL, must_change_password=True,
                token_version=0, totp_enabled=False)
    assert issue_tokens(user, EMPTY_CONTEXT, mfa_verified=False)["password_change_required"]
    user.must_change_password = False
    assert not issue_tokens(user, EMPTY_CONTEXT, mfa_verified=False)["password_change_required"]


# ---------------------------------------------------------------- end to end


@pytest_asyncio.fixture
async def world(db_session):
    tenant = Tenant(name="Sentetik Hastane", slug="demo-hastanesi", country_code="TR")
    db_session.add(tenant)
    await db_session.flush()
    groups = await ensure_default_groups(db_session, tenant.id)

    async def make(username, group_slug, **kw):
        u = User(username=username, email=f"{username}@example.com", full_name=username.title(),
                 hashed_password=kw.pop("hashed_password", hash_password(PASSWORD)), **kw)
        db_session.add(u)
        await db_session.flush()
        db_session.add(TenantMembership(user_id=u.id, tenant_id=tenant.id))
        await db_session.flush()
        await set_manual_groups(db_session, user=u, tenant_id=tenant.id,
                                group_ids=[groups[group_slug].id], granted_by_id=None)
        return u

    admin = await make("admin", "hospital_admin")
    ldap = await make("ldapci", "nurse", auth_source=AUTH_LDAP, hashed_password=None)
    await db_session.commit()
    return {"tenant": tenant, "groups": groups, "admin": admin, "ldap": ldap, "make": make}


@pytest_asyncio.fixture
async def client(db_session):
    app = create_app({"bridge-token": "demo-hastanesi"}, run_escalation_loop=False)
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)

    async def _db():
        async with maker() as session:
            yield session

    app.dependency_overrides[get_db] = _db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def _admin_headers(db, admin) -> dict:
    tokens = issue_tokens(admin, await build_context(db, admin), mfa_verified=True)
    return {"Authorization": f"Bearer {tokens['access_token']}"}


def _bearer(tokens: dict) -> dict:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


async def _flag(db, user_id) -> bool:
    return (await db.execute(select(User.must_change_password).where(User.id == user_id)
                             .execution_options(populate_existing=True))).scalar_one()


async def _create(c, admin, username, group_id):
    res = await c.post("/admin/users", headers=admin, json={
        "username": username, "full_name": "Sentetik Kişi", "password": TEMPORARY,
        "group_ids": [str(group_id)]})
    assert res.status_code == 201, res.text
    return res.json()


@pytest.mark.asyncio
@requires_db
async def test_a_new_account_must_replace_its_temporary_password_first(client, world, db_session):
    c = client
    admin = await _admin_headers(db_session, world["admin"])
    created = await _create(c, admin, "selin", world["groups"]["nurse"].id)
    assert created["must_change_password"] is True

    tokens = (await c.post("/auth/login", json={"login": "selin", "password": TEMPORARY})).json()
    assert tokens["password_change_required"] is True and tokens["requires_mfa"] is False
    me = await c.get("/auth/me", headers=_bearer(tokens))
    assert me.status_code == 200 and me.json()["must_change_password"] is True
    # The routers; the board's own resolver (/patients, /stream-ticket) is tests/test_jwt_caller.py.
    for path in ("/scope/me", "/admissions", "/admin/users"):
        res = await c.get(path, headers=_bearer(tokens))
        assert (res.status_code, res.json()["detail"]) == (403, "password_change_required"), path

    changed = await c.post("/auth/password", headers=_bearer(tokens),
                           json={"current_password": TEMPORARY, "new_password": CHOSEN})
    assert changed.status_code == 200, changed.text
    fresh = changed.json()
    assert fresh["password_change_required"] is False
    assert await _flag(db_session, created["id"]) is False
    assert (await c.get("/scope/me", headers=_bearer(fresh))).status_code == 200
    users = {u["username"]: u for u in (await c.get("/admin/users", headers=admin)).json()}
    assert users["selin"]["must_change_password"] is False


@pytest.mark.asyncio
@requires_db
async def test_a_password_reset_flags_a_local_account_and_never_an_ad_one(client, world,
                                                                         db_session):
    c = client
    admin = await _admin_headers(db_session, world["admin"])
    nurse = await world["make"]("ayse", "nurse")
    await db_session.commit()
    res = await c.post(f"/admin/users/{nurse.id}/reset-password", headers=admin,
                       json={"password": TEMPORARY})
    assert res.status_code == 200
    assert await _flag(db_session, nurse.id) is True
    res = await c.post(f"/admin/users/{world['ldap'].id}/reset-password", headers=admin,
                       json={"password": TEMPORARY})
    assert res.status_code == 400
    assert await _flag(db_session, world["ldap"].id) is False


@pytest.mark.asyncio
@requires_db
async def test_an_ad_account_with_the_flag_set_by_hand_is_not_held(client, world, db_session):
    """Defence in depth: nothing writes the flag on an AD account, and if something did, the
    account would be stuck — its password cannot be changed here."""
    c = client
    await db_session.execute(update(User).where(User.id == world["ldap"].id)
                             .values(must_change_password=True))
    await db_session.commit()
    user = (await db_session.execute(select(User).where(User.id == world["ldap"].id)
                                     .execution_options(populate_existing=True))).scalar_one()
    tokens = issue_tokens(user, await build_context(db_session, user), mfa_verified=False)
    assert tokens["password_change_required"] is False
    assert (await c.get("/scope/me", headers=_bearer(tokens))).status_code == 200
    assert (await c.get("/auth/me", headers=_bearer(tokens))).json()["must_change_password"] is False


@pytest.mark.asyncio
@requires_db
async def test_mfa_comes_before_the_password_change(client, world, db_session):
    """An attending (MFA group) with a temporary password: the TOTP step first, then the
    change. The temporary password alone never chooses the next one."""
    c = client
    admin = await _admin_headers(db_session, world["admin"])
    created = await _create(c, admin, "dr.kaya", world["groups"]["attending"].id)

    pending = (await c.post("/auth/login", json={"login": "dr.kaya", "password": TEMPORARY})).json()
    assert pending["requires_mfa"] is True and pending["password_change_required"] is True
    res = await c.post("/auth/password", headers=_bearer(pending),
                       json={"current_password": TEMPORARY, "new_password": CHOSEN})
    assert (res.status_code, res.json()["detail"]) == (403, "mfa_required")

    uri = (await c.post("/auth/totp/setup", headers=_bearer(pending))).json()["provisioning_uri"]
    code = pyotp.parse_uri(uri).now()
    verified = (await c.post("/auth/totp/verify", headers=_bearer(pending),
                             json={"code": code})).json()
    assert verified["requires_mfa"] is False and verified["password_change_required"] is True
    res = await c.get("/scope/me", headers=_bearer(verified))
    assert (res.status_code, res.json()["detail"]) == (403, "password_change_required")
    res = await c.post("/auth/password", headers=_bearer(verified),
                       json={"current_password": TEMPORARY, "new_password": CHOSEN})
    assert res.status_code == 200 and res.json()["password_change_required"] is False
    assert await _flag(db_session, created["id"]) is False


@pytest.mark.asyncio
@requires_db
async def test_the_temporary_password_cannot_be_kept(client, world, db_session):
    c = client
    admin = await _admin_headers(db_session, world["admin"])
    created = await _create(c, admin, "aynen", world["groups"]["nurse"].id)
    tokens = (await c.post("/auth/login", json={"login": "aynen", "password": TEMPORARY})).json()
    res = await c.post("/auth/password", headers=_bearer(tokens),
                       json={"current_password": TEMPORARY, "new_password": TEMPORARY})
    assert (res.status_code, res.json()["detail"]) == (
        400, "Yeni parola mevcut paroladan farklı olmalı")
    assert await _flag(db_session, created["id"]) is True

# homunculus-engine/tests/test_auth_password_change.py
"""A temporary password is replaced at the first sign-in (roadmap D4, plan G1 Wave 2 decision 1):
an administrator's new account or password reset flags the LOCAL account; while flagged, its
session reaches only /auth/password, /auth/me, /auth/refresh and /auth/totp/*; the change clears
the flag. MFA comes first. An AD account is never flagged. Synthetic accounts only."""
from __future__ import annotations

import asyncio

import pyotp
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import async_sessionmaker

import homunculus.scope.models  # noqa: F401  (staff_scopes, read by /scope/me, before create_all)
from homunculus.admin import service as admin_service
from homunculus.api.app import create_app
from homunculus.auth import service as auth_service
from homunculus.auth.groups import ensure_default_groups, set_manual_groups
from homunculus.auth.models import AUTH_LDAP, AUTH_LOCAL, TenantMembership, User
from homunculus.auth.permissions import ALL_PERMISSIONS
from homunculus.auth.service import (
    PasswordError, build_context, change_password, get_user_by_id, hash_password, issue_tokens,
    password_change_due, verify_password,
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


@pytest.mark.asyncio
@pytest.mark.parametrize("temporary", [
    "x" * 72 + "-gecici",                 # 72 ASCII bytes, then more
    "Ş" * 36 + "-gecici",                 # 36 two-byte characters = 72 bytes, then more
], ids=["ascii", "two-byte"])
async def test_a_new_password_bcrypt_cannot_tell_from_the_current_one_is_unchanged(temporary):
    """bcrypt hashes the first 72 bytes only: a suffix after them would pass a plain `new ==
    current` and leave the temporary password signing in, with the flag gone. Refused before
    the database is touched (hence db=None) and before the current password is checked."""
    user = User(username="u", full_name="U", auth_source=AUTH_LOCAL, must_change_password=True,
                hashed_password=hash_password(temporary))
    with pytest.raises(PasswordError) as exc:
        await change_password(None, user, temporary, temporary + "X")
    assert exc.value.reason == "unchanged"
    assert user.must_change_password is True


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


# ---------------------------------------------------------------- a reset and a change, together
# The user's own change and an administrator's reset write the same row. Each session loads it
# before it writes; without the row lock an interleaving loses the reset: the temporary password
# signs in with the flag cleared, or a change already in flight puts the old session's password
# back. Two sessions, driven step by step (no sleeps, no timing).


def _actor(admin) -> admin_service.Actor:
    return admin_service.Actor(id=admin.id, perms=ALL_PERMISSIONS,
                               token_version=admin.token_version)


async def _row(db, user_id) -> User:
    return (await db.execute(select(User).where(User.id == user_id)
                             .execution_options(populate_existing=True))).scalar_one()


async def _a_flagged_nurse(world, db_session):
    nurse = await world["make"]("ayse", "nurse", must_change_password=True)
    await db_session.commit()
    return nurse


@pytest.mark.asyncio
@requires_db
async def test_a_reset_that_loaded_the_row_before_a_change_still_flags_it(world, db_session):
    """The reviewer's interleaving: both load the flagged row; the change commits (flag False);
    the reset then sets flag True — equal to what its session loaded, so without re-reading the
    row under the lock only the hash was written."""
    nurse, tenant_id = await _a_flagged_nurse(world, db_session), world["tenant"].id
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)
    async with maker() as change, maker() as reset:
        own = await get_user_by_id(change, nurse.id)
        target = await admin_service.get_tenant_user(reset, tenant_id, nurse.id)
        await change_password(change, own, PASSWORD, CHOSEN)                 # commits
        await admin_service.reset_password(reset, tenant_id, target, _actor(world["admin"]),
                                           TEMPORARY)
        await reset.commit()
    row = await _row(db_session, nurse.id)
    assert verify_password(TEMPORARY, row.hashed_password)
    assert row.must_change_password is True


@pytest.mark.asyncio
@requires_db
async def test_a_change_whose_session_predates_a_reset_cannot_undo_it(world, db_session):
    """The reverse: the reset commits after the change's session loaded the row. The change is
    refused (its session's token version is gone) instead of writing its password over the
    temporary one and clearing the flag."""
    nurse, tenant_id = await _a_flagged_nurse(world, db_session), world["tenant"].id
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)
    refused = None
    async with maker() as change, maker() as reset:
        own = await get_user_by_id(change, nurse.id)
        target = await admin_service.get_tenant_user(reset, tenant_id, nurse.id)
        await admin_service.reset_password(reset, tenant_id, target, _actor(world["admin"]),
                                           TEMPORARY)
        await reset.commit()
        try:
            await change_password(change, own, PASSWORD, CHOSEN)
        except Exception as exc:                       # noqa: BLE001  (checked below)
            refused = exc
            await change.rollback()
    row = await _row(db_session, nurse.id)
    assert verify_password(TEMPORARY, row.hashed_password)                     # the reset stands
    assert row.must_change_password is True
    assert isinstance(refused, auth_service.StaleSession)


async def _until_a_session_waits_on_a_lock(db) -> None:
    """Poll pg_stat_activity until some backend of this database waits on a lock. Each poll ends
    its transaction: the view is a per-transaction snapshot."""
    for _ in range(400):
        waiting = (await db.execute(text(
            "SELECT count(*) FROM pg_stat_activity "
            "WHERE datname = current_database() AND wait_event_type = 'Lock'"))).scalar_one()
        await db.rollback()
        if waiting:
            return
        await asyncio.sleep(0.025)
    raise AssertionError("the reset never waited on the account's row lock")


@pytest.mark.asyncio
@requires_db
async def test_a_reset_waits_for_a_change_in_flight_and_then_flags_the_row(
        world, db_session, monkeypatch):
    """Truly concurrent: the change is held at its token-version bump, after it took the row
    lock; the reset arriving then waits for that lock (seen in pg_stat_activity, not timed) and
    writes only once the change has committed — over it, flag included."""
    nurse, tenant_id = await _a_flagged_nurse(world, db_session), world["tenant"].id
    entered, release = asyncio.Event(), asyncio.Event()
    real_bump = auth_service.bump_user

    async def held_bump(db, user):
        entered.set()
        await release.wait()
        return await real_bump(db, user)

    monkeypatch.setattr(auth_service, "bump_user", held_bump)   # the change's, not the reset's
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)
    async with maker() as change, maker() as reset, maker() as watch:
        own = await get_user_by_id(change, nurse.id)
        target = await admin_service.get_tenant_user(reset, tenant_id, nurse.id)
        changing = asyncio.create_task(change_password(change, own, PASSWORD, CHOSEN))
        resetting = None
        try:
            await asyncio.wait_for(entered.wait(), 30)
            resetting = asyncio.create_task(admin_service.reset_password(
                reset, tenant_id, target, _actor(world["admin"]), TEMPORARY))
            await _until_a_session_waits_on_a_lock(watch)
            assert not resetting.done()
        finally:
            release.set()
            await asyncio.wait_for(asyncio.gather(
                changing, *([resetting] if resetting else []), return_exceptions=True), 30)
        assert changing.exception() is None and resetting.exception() is None
        await reset.commit()
    row = await _row(db_session, nurse.id)
    assert verify_password(TEMPORARY, row.hashed_password)
    assert row.must_change_password is True


@pytest.mark.asyncio
@requires_db
async def test_a_stale_change_is_a_401_so_the_client_refreshes_or_signs_out(
        client, world, db_session, monkeypatch):
    """The route answers a change refused as stale the way the dependency answers a stale token:
    401 `token_version`. After a reset the refresh fails too (the hash moved) and the client
    signs out; after any other bump it refreshes and resends the change."""
    async def stale(*_args):
        raise auth_service.StaleSession()

    monkeypatch.setattr("homunculus.auth.router.change_password", stale)
    await world["make"]("zeynep", "nurse")
    await db_session.commit()
    tokens = (await client.post("/auth/login", json={"login": "zeynep",
                                                     "password": PASSWORD})).json()
    res = await client.post("/auth/password", headers=_bearer(tokens),
                            json={"current_password": PASSWORD, "new_password": CHOSEN})
    assert (res.status_code, res.json()["detail"]) == (401, "token_version")

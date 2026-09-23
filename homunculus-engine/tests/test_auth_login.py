# homunculus-engine/tests/test_auth_login.py
"""Sign-in end to end against the real router, the real dependencies and a test Postgres.

The app is driven through httpx's ASGI transport on the SAME event loop as the db_session
fixture — a TestClient would run the app on another loop and asyncpg connections cannot cross
loops.
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from homunculus.api.app import create_app
from homunculus.auth.groups import ensure_default_groups, set_manual_groups
from homunculus.auth.jwt import decode_token
from homunculus.auth.models import AUTH_LDAP, TenantMembership, User
from homunculus.auth.service import hash_password
from homunculus.db import get_db
from homunculus.tenant.models import Tenant
from tests.conftest import requires_db

pytestmark = [pytest.mark.asyncio, requires_db]

PASSWORD = "Gizli-123"


@pytest_asyncio.fixture
async def world(db_session):
    """One tenant with its default groups, an admin (MFA group) and a nurse (no MFA)."""
    tenant = Tenant(name="Demo", slug="demo-hastanesi", country_code="TR")
    db_session.add(tenant)
    await db_session.flush()
    groups = await ensure_default_groups(db_session, tenant.id)

    async def make(username, email, group_slug, **kw):
        u = User(username=username, email=email, full_name=username.title(),
                 hashed_password=kw.pop("hashed_password", hash_password(PASSWORD)), **kw)
        db_session.add(u)
        await db_session.flush()
        db_session.add(TenantMembership(user_id=u.id, tenant_id=tenant.id))
        await db_session.flush()
        await set_manual_groups(db_session, user=u, tenant_id=tenant.id,
                                group_ids=[groups[group_slug].id], granted_by_id=None)
        return u

    admin = await make("admin", "admin@example.com", "hospital_admin")
    nurse = await make("ayse", "ayse.demir@example.com", "nurse")
    ldap_user = await make("ldapci", "ldapci@example.com", "nurse", auth_source=AUTH_LDAP,
                           hashed_password=None)
    await make("pasif", "pasif@example.com", "nurse", is_active=False)
    await db_session.commit()
    return {"tenant": tenant, "groups": groups, "admin": admin, "nurse": nurse, "ldap": ldap_user}


@pytest_asyncio.fixture
async def client(db_session):
    app = create_app({"bridge-token": "demo-hastanesi"}, run_escalation_loop=False)

    async def _db():
        yield db_session

    app.dependency_overrides[get_db] = _db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c, app


async def _login(c, login, password=PASSWORD):
    return await c.post("/auth/login", json={"login": login, "password": password})


async def test_sign_in_by_username_and_by_email_case_insensitively(client, world):
    c, _ = client
    assert (await _login(c, "ayse")).status_code == 200
    assert (await _login(c, "AYSE.DEMIR@example.com")).status_code == 200


async def test_the_legacy_email_field_still_signs_in(client, world):
    c, _ = client
    res = await c.post("/auth/login", json={"email": "ayse", "password": PASSWORD})
    assert res.status_code == 200


async def test_the_token_carries_the_groups_and_permissions(client, world):
    c, _ = client
    body = (await _login(c, "ayse")).json()
    claims = decode_token(body["access_token"])
    assert claims["tenant"] == "demo-hastanesi" and claims["groups"] == ["nurse"]
    assert "admissions.admit" in claims["perms"] and "users.manage" not in claims["perms"]
    assert body["requires_mfa"] is False


async def test_an_mfa_group_member_is_held_at_the_gate_and_told_to_enrol(client, world):
    c, _ = client
    body = (await _login(c, "admin")).json()
    assert body["requires_mfa"] is True and body["mfa_enrolled"] is False
    headers = {"Authorization": f"Bearer {body['access_token']}"}
    assert (await c.get("/auth/me", headers=headers)).status_code == 200      # allowed pre-MFA
    assert (await c.post("/auth/password", headers=headers,
                         json={"current_password": PASSWORD, "new_password": "Yeni-Parola-1"})
            ).status_code == 403                                            # gated


async def test_wrong_password_unknown_login_and_inactive_are_all_401(client, world):
    c, _ = client
    assert (await _login(c, "ayse", "yanlis")).status_code == 401
    assert (await _login(c, "kimse")).status_code == 401
    assert (await _login(c, "pasif")).status_code == 401


async def test_an_ad_account_gets_503_not_401_until_the_directory_exists(client, world):
    c, _ = client
    res = await _login(c, "ldapci", "her-neyse")
    assert res.status_code == 503
    assert "Dizin" in res.json()["detail"]


async def test_me_reports_groups_and_permissions(client, world):
    c, _ = client
    token = (await _login(c, "ayse")).json()["access_token"]
    me = (await c.get("/auth/me", headers={"Authorization": f"Bearer {token}"})).json()
    assert me["username"] == "ayse" and me["tenant"] == "demo-hastanesi"
    assert me["groups"] == [{"slug": "nurse", "name": "Hemşire"}]
    assert "board.view" in me["perms"]


async def test_a_group_change_invalidates_the_old_token_and_refresh_carries_the_new_rights(
        client, world, db_session):
    c, _ = client
    tokens = (await _login(c, "ayse")).json()
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    assert (await c.get("/auth/me", headers=headers)).status_code == 200

    await set_manual_groups(db_session, user=world["nurse"], tenant_id=world["tenant"].id,
                            group_ids=[world["groups"]["charge_nurse"].id], granted_by_id=None)
    await db_session.commit()

    assert (await c.get("/auth/me", headers=headers)).status_code == 401
    refreshed = (await c.post("/auth/refresh",
                              json={"refresh_token": tokens["refresh_token"]})).json()
    claims = decode_token(refreshed["access_token"])
    assert claims["groups"] == ["charge_nurse"] and "shifts.manage" in claims["perms"]


async def test_password_change_works_and_retires_the_old_token(client, world):
    c, _ = client
    tokens = (await _login(c, "ayse")).json()
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    res = await c.post("/auth/password", headers=headers,
                       json={"current_password": PASSWORD, "new_password": "Yeni-Parola-1"})
    assert res.status_code == 200
    assert (await c.get("/auth/me", headers=headers)).status_code == 401   # tv bumped
    old_refresh = await c.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert old_refresh.status_code == 401                                   # credentials moved
    fresh = {"Authorization": f"Bearer {res.json()['access_token']}"}
    assert (await c.get("/auth/me", headers=fresh)).status_code == 200      # the caller keeps working
    assert (await _login(c, "ayse", "Yeni-Parola-1")).status_code == 200
    assert (await _login(c, "ayse", PASSWORD)).status_code == 401


async def test_an_enrolled_user_cannot_replace_the_authenticator_with_the_password_alone(
        client, world, db_session):
    """The MFA bypass this closes: password -> pending token -> /totp/setup (new secret) ->
    /totp/verify with a code the attacker controls -> verified tokens."""
    c, _ = client
    world["admin"].totp_secret, world["admin"].totp_enabled = "JBSWY3DPEHPK3PXP", True
    await db_session.commit()
    pending = (await _login(c, "admin")).json()
    assert pending["requires_mfa"] is True and pending["mfa_enrolled"] is True
    res = await c.post("/auth/totp/setup",
                       headers={"Authorization": f"Bearer {pending['access_token']}"})
    assert res.status_code == 403 and res.json()["detail"] == "mfa_reset_required"
    await db_session.refresh(world["admin"])
    assert world["admin"].totp_secret == "JBSWY3DPEHPK3PXP"                  # untouched


async def test_an_mfa_reset_ends_the_verified_session(client, world, db_session):
    """An MFA-verified session must not survive an administrator clearing the authenticator:
    the old refresh token neither refreshes nor brings back "verified"."""
    import pyotp
    c, _ = client
    secret = "JBSWY3DPEHPK3PXP"
    world["admin"].totp_secret, world["admin"].totp_enabled = secret, True
    await db_session.commit()
    pending = (await _login(c, "admin")).json()
    verified = (await c.post("/auth/totp/verify",
                             headers={"Authorization": f"Bearer {pending['access_token']}"},
                             json={"code": pyotp.TOTP(secret).now()})).json()
    assert decode_token(verified["access_token"])["mfa_verified"] is True

    world["admin"].totp_secret, world["admin"].totp_enabled = None, False   # what reset-mfa does
    await db_session.commit()

    res = await c.post("/auth/refresh", json={"refresh_token": verified["refresh_token"]})
    assert res.status_code == 401


async def test_sign_ins_are_audited_without_the_password(client, world):
    c, app = client
    await _login(c, "ayse")
    await _login(c, "ayse", "yanlis")
    records = app.state.audit.records(event_type="auth")
    subjects = [r.subject for r in records]
    assert "login.ok" in subjects and "login.fail" in subjects
    for r in records:
        assert PASSWORD not in str(r.payload) and "yanlis" not in str(r.payload)

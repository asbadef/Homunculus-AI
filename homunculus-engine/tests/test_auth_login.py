# homunculus-engine/tests/test_auth_login.py
"""Sign-in end to end against the real router, the real dependencies and a test Postgres.

The app is driven through httpx's ASGI transport on the SAME event loop as the db_session
fixture — a TestClient would run the app on another loop and asyncpg connections cannot cross
loops.
"""
from __future__ import annotations

import time

import pyotp
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from homunculus.api.app import create_app
from homunculus.auth.groups import ensure_default_groups, set_manual_groups
from homunculus.auth.jwt import create_refresh_token, decode_token
from homunculus.auth.models import AUTH_LDAP, TenantMembership, User
from homunculus.auth.service import (
    build_context, credential_fingerprint, hash_password, issue_tokens,
)
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
    return {"tenant": tenant, "groups": groups, "admin": admin, "nurse": nurse, "ldap": ldap_user,
            "make": make}


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


async def test_a_platform_operator_is_always_held_at_the_mfa_gate(client, world, db_session):
    """In a group that needs no MFA, and as a vendor account in no tenant at all."""
    c, _ = client
    await world["make"]("hemsire.operator", "hemsire.operator@example.com", "nurse",
                        is_platform_support=True)
    db_session.add(User(username="vendor", email="vendor@example.com", full_name="Vendor",
                        hashed_password=hash_password(PASSWORD), is_platform_support=True))
    await db_session.commit()

    for login, tenant in (("hemsire.operator", "demo-hastanesi"), ("vendor", None)):
        body = (await _login(c, login)).json()
        assert body["requires_mfa"] is True, login
        claims = decode_token(body["access_token"])
        assert claims["mfa_required"] is True and claims["mfa_verified"] is False
        assert claims["tenant"] == tenant


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


# --- review fixes: flows the dashboard depends on, TOTP limits, lookup, audit ------------------

SECRET = "JBSWY3DPEHPK3PXP"


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _enrolled_admin(world, db_session):
    world["admin"].totp_secret, world["admin"].totp_enabled = SECRET, True
    await db_session.commit()
    return world["admin"]


async def _verify(c, access_token, code):
    return await c.post("/auth/totp/verify", headers=_bearer(access_token), json={"code": code})


def _auth_events(app, subject):
    return [r for r in app.state.audit.records(event_type="auth", limit=10_000)
            if r.subject == subject]


async def test_first_enrolment_end_to_end(client, world, db_session):
    """login (pending, not enrolled) -> setup -> verify -> refresh keeps "verified"."""
    c, app = client
    login = (await _login(c, "admin")).json()
    assert login["requires_mfa"] is True and login["mfa_enrolled"] is False

    setup = await c.post("/auth/totp/setup", headers=_bearer(login["access_token"]))
    assert setup.status_code == 200
    secret = pyotp.parse_uri(setup.json()["provisioning_uri"]).secret
    # A new secret moves the credential fingerprint: the login's refresh token is retired.
    assert (await c.post("/auth/refresh", json={"refresh_token": login["refresh_token"]})
            ).status_code == 401

    res = await _verify(c, login["access_token"], pyotp.TOTP(secret).now())
    assert res.status_code == 200
    verified = res.json()
    assert verified["requires_mfa"] is False and verified["mfa_enrolled"] is True
    assert decode_token(verified["access_token"])["mfa_verified"] is True
    await db_session.refresh(world["admin"])
    assert world["admin"].totp_enabled is True

    refreshed = await c.post("/auth/refresh", json={"refresh_token": verified["refresh_token"]})
    assert refreshed.status_code == 200
    assert decode_token(refreshed.json()["access_token"])["mfa_verified"] is True
    assert refreshed.json()["requires_mfa"] is False

    assert [r.payload["replace"] for r in _auth_events(app, "mfa.enrol")] == [False]
    assert [r.payload["first_enrolment"] for r in _auth_events(app, "mfa.ok")] == [True]


async def test_a_refresh_carries_mfa_verified_forward(client, world, db_session):
    c, _ = client
    await _enrolled_admin(world, db_session)
    pending = (await _login(c, "admin")).json()
    verified = (await _verify(c, pending["access_token"], pyotp.TOTP(SECRET).now())).json()

    res = await c.post("/auth/refresh", json={"refresh_token": verified["refresh_token"]})
    assert res.status_code == 200
    body = res.json()
    assert body["requires_mfa"] is False
    assert decode_token(body["access_token"])["mfa_verified"] is True
    assert decode_token(body["refresh_token"])["mfa_verified"] is True     # and the next one too


async def test_replacing_the_authenticator_from_a_verified_session_keeps_it_enrolled(
        client, world, db_session):
    c, app = client
    await _enrolled_admin(world, db_session)
    pending = (await _login(c, "admin")).json()
    verified = (await _verify(c, pending["access_token"], pyotp.TOTP(SECRET).now())).json()

    setup = await c.post("/auth/totp/setup", headers=_bearer(verified["access_token"]))
    assert setup.status_code == 200
    new_secret = pyotp.parse_uri(setup.json()["provisioning_uri"]).secret
    await db_session.refresh(world["admin"])
    assert world["admin"].totp_enabled is True                  # never back to "not enrolled"
    assert world["admin"].totp_secret == new_secret != SECRET

    # The new device's first code is accepted at once — the old secret's used step does not
    # hold it back.
    res = await _verify(c, verified["access_token"], pyotp.TOTP(new_secret).now())
    assert res.status_code == 200
    assert [r.payload["replace"] for r in _auth_events(app, "mfa.enrol")] == [True]


@pytest.mark.parametrize("cv", [None, 12345, "çok-gizli-ş", ["x"]])
async def test_a_refresh_token_without_a_valid_fingerprint_is_refused(client, world, cv):
    c, _ = client
    nurse = world["nurse"]
    extra = {"mfa_verified": False} if cv is None else {"mfa_verified": False, "cv": cv}
    res = await c.post("/auth/refresh",
                       json={"refresh_token": create_refresh_token(str(nurse.id), extra=extra)})
    assert res.status_code == 401


async def test_a_refresh_token_with_the_current_fingerprint_is_accepted(client, world):
    """The positive control for the test above: the same hand-built token, correct `cv`."""
    c, _ = client
    nurse = world["nurse"]
    token = create_refresh_token(str(nurse.id), extra={"mfa_verified": False,
                                                       "cv": credential_fingerprint(nurse)})
    assert (await c.post("/auth/refresh", json={"refresh_token": token})).status_code == 200


async def test_password_change_error_paths_are_400_and_audited(client, world, db_session):
    c, app = client
    nurse = (await _login(c, "ayse")).json()
    headers = _bearer(nurse["access_token"])

    wrong = await c.post("/auth/password", headers=headers,
                         json={"current_password": "yanlis-parola", "new_password": "Yeni-Parola-1"})
    assert wrong.status_code == 400 and "yanlış" in wrong.json()["detail"]
    # Too short is reported even with a wrong current password: length is checked first.
    short = await c.post("/auth/password", headers=headers,
                         json={"current_password": "yanlis-parola", "new_password": "kisa"})
    assert short.status_code == 400 and "8 karakter" in short.json()["detail"]

    ldap = world["ldap"]
    ldap_tokens = issue_tokens(ldap, await build_context(db_session, ldap), mfa_verified=False)
    ad = await c.post("/auth/password", headers=_bearer(ldap_tokens["access_token"]),
                      json={"current_password": "x", "new_password": "Yeni-Parola-1"})
    assert ad.status_code == 400 and "Active Directory" in ad.json()["detail"]

    fails = _auth_events(app, "password.change.fail")
    assert [r.payload["reason"] for r in fails] == ["wrong_current", "too_short",
                                                     "directory_account"]
    assert all(r.tenant == "demo-hastanesi" for r in fails)
    for r in fails:
        assert "yanlis-parola" not in str(r.payload) and "Yeni-Parola-1" not in str(r.payload)
    # Nothing changed: the original password still signs in.
    assert (await _login(c, "ayse")).status_code == 200


async def test_a_sign_in_records_last_login_at(client, world, db_session):
    c, _ = client
    assert world["nurse"].last_login_at is None
    assert (await _login(c, "ayse")).status_code == 200
    await db_session.refresh(world["nurse"])
    assert world["nurse"].last_login_at is not None


async def test_failed_sign_ins_are_filed_under_the_accounts_hospital(client, world):
    c, app = client
    await _login(c, "pasif")                       # right password, inactive account
    await _login(c, "ldapci", "her-neyse")         # AD account, no directory yet
    await _login(c, "ayse", "yanlis")              # known account, wrong password
    await _login(c, "kimse")                       # no such account
    fails = {(r.payload["login"], r.payload["reason"], r.tenant)
             for r in _auth_events(app, "login.fail")}
    assert fails == {
        ("pasif", "inactive", "demo-hastanesi"),
        ("ldapci", "directory_unavailable", "demo-hastanesi"),
        ("ayse", "bad_credentials", "demo-hastanesi"),
        ("kimse", "bad_credentials", "-"),
    }


async def test_login_ok_records_whether_an_mfa_step_is_pending(client, world):
    c, app = client
    await _login(c, "ayse")
    await _login(c, "admin")
    pending = {r.payload["user"]: r.payload["mfa_pending"] for r in _auth_events(app, "login.ok")}
    assert pending == {"ayse": False, "admin": True}


async def test_a_username_that_is_another_accounts_email_resolves_to_the_username_owner(
        client, world, db_session):
    c, _ = client
    make = world["make"]
    # The e-mail holder is created first, so plain row order would favour it.
    await make("baska", "ortak@example.com", "nurse")
    owner = await make("ortak@example.com", "sahip@example.com", "nurse")
    await db_session.commit()
    for _ in range(3):                             # each sign-in rewrites last_login_at
        res = await _login(c, "ortak@example.com")
        assert res.status_code == 200
        assert decode_token(res.json()["access_token"])["sub"] == str(owner.id)


async def test_five_wrong_codes_lock_the_verify_step(client, world, db_session):
    c, app = client
    await _enrolled_admin(world, db_session)
    pending = (await _login(c, "admin")).json()
    for _ in range(5):
        res = await _verify(c, pending["access_token"], "xxxxxx")
        assert res.status_code == 401 and res.json()["detail"] == "Invalid TOTP code"
    assert [r.payload["reason"] for r in _auth_events(app, "mfa.fail")] == ["bad_code"] * 5
    assert len(_auth_events(app, "mfa.locked")) == 1            # once, when the lock engaged

    rows_before = len(app.state.audit.records(limit=10_000))
    for _ in range(3):                                          # even the right code is refused
        res = await _verify(c, pending["access_token"], pyotp.TOTP(SECRET).now())
        assert res.status_code == 429 and "5 dakika" in res.json()["detail"]
    assert len(app.state.audit.records(limit=10_000)) == rows_before   # no row per refusal


async def test_a_wrong_code_is_counted_even_when_its_audit_row_fails(
        client, world, db_session, monkeypatch):
    """The count comes before the `mfa.fail` row: while the audit store fails, each wrong code
    is a server error — and still counted, so a pending-MFA session cannot guess codes without
    limit while the trail is down. After the fifth the step is locked (429), the right code too."""
    c, app = client
    await _enrolled_admin(world, db_session)
    pending = (await _login(c, "admin")).json()
    real = app.state.audit.append

    def broken(event):
        if event.subject in ("mfa.fail", "mfa.locked"):
            raise RuntimeError("audit store down")
        return real(event)

    monkeypatch.setattr(app.state.audit, "append", broken)
    for _ in range(5):
        with pytest.raises(RuntimeError):
            await _verify(c, pending["access_token"], "xxxxxx")
    res = await _verify(c, pending["access_token"], pyotp.TOTP(SECRET).now())
    assert res.status_code == 429 and "5 dakika" in res.json()["detail"]


async def test_a_totp_code_cannot_be_used_twice(client, world, db_session):
    c, app = client
    await _enrolled_admin(world, db_session)
    pending = (await _login(c, "admin")).json()
    code = pyotp.TOTP(SECRET).now()
    assert (await _verify(c, pending["access_token"], code)).status_code == 200
    again = await _verify(c, pending["access_token"], code)
    assert again.status_code == 401
    assert again.json()["detail"] == "Bu kod zaten kullanıldı; yeni kodu bekleyin."
    assert [r.payload["reason"] for r in _auth_events(app, "mfa.fail")] == ["replayed_code"]


async def test_a_replayed_code_does_not_count_toward_the_lock(client, world, db_session):
    """A clinician re-typing the code they just used is not guessing: six replays, then the
    next code, must still get through."""
    c, app = client
    await _enrolled_admin(world, db_session)
    pending = (await _login(c, "admin")).json()
    totp = pyotp.TOTP(SECRET)
    step = int(time.time() // 30)
    assert (await _verify(c, pending["access_token"], totp.generate_otp(step))).status_code == 200
    for _ in range(6):
        res = await _verify(c, pending["access_token"], totp.generate_otp(step))
        assert res.status_code == 401 and "zaten kullanıldı" in res.json()["detail"]
    # The next step's code is inside the ±1 window whether or not the clock has moved on since.
    res = await _verify(c, pending["access_token"], totp.generate_otp(step + 1))
    assert res.status_code == 200
    assert _auth_events(app, "mfa.locked") == []


async def test_known_and_unknown_login_failures_cost_the_same_tenant_lookup(
        client, world, monkeypatch):
    """The failure audit looks up the tenant for an unknown login too (and finds none), so a
    failed sign-in takes the same queries whether or not the account exists."""
    import homunculus.auth.router as auth_router_module

    real = auth_router_module.tenant_of_user
    looked_up = []

    async def counting(db, user_id):
        looked_up.append(user_id)
        return await real(db, user_id)

    monkeypatch.setattr(auth_router_module, "tenant_of_user", counting)
    c, app = client
    # Read before signing in: this module's client shares the test's session, and a refused
    # sign-in rolls the session back before its floor's sleep, which expires `world`'s rows.
    nurse_id = world["nurse"].id
    assert (await _login(c, "kimse")).status_code == 401
    assert (await _login(c, "ayse", "yanlis")).status_code == 401
    assert len(looked_up) == 2 and looked_up[1] == nurse_id
    assert [r.tenant for r in _auth_events(app, "login.fail")] == ["-", "demo-hastanesi"]

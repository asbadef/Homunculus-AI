# homunculus-engine/tests/test_auth_tokens.py
"""Token issuance and the sign-in helpers, without a database."""
from __future__ import annotations

import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from homunculus.auth.dependencies import Principal, get_principal_pre_mfa
from homunculus.auth.jwt import decode_token
from homunculus.auth.models import AUTH_LDAP, User
from homunculus.auth.router import router as auth_router
from homunculus.auth.schemas import LoginRequest, PasswordChangeRequest, TOTPVerifyRequest
from homunculus.auth.service import (
    AuthContext, PasswordError, change_password, credential_fingerprint, hash_password,
    issue_tokens, normalize_login, verify_local_password,
)
from homunculus.db import get_db


def _user(**kw) -> User:
    return User(id=uuid.uuid4(), username="ayse", email="ayse@example.com", full_name="Ayşe",
                hashed_password=kw.get("hashed_password", hash_password("Gizli-123")),
                auth_source=kw.get("auth_source", "local"), token_version=kw.get("tv", 4),
                totp_secret=kw.get("totp_secret"),
                totp_enabled=kw.get("totp_enabled", False), is_active=True)


def _ctx(**kw) -> AuthContext:
    return AuthContext(tenant_id=uuid.uuid4(), tenant="demo-hastanesi",
                       groups=("nurse",), group_names=("Hemşire",),
                       perms=frozenset({"board.view", "alerts.ack"}),
                       mfa_required=kw.get("mfa_required", False))


def test_the_access_token_carries_tenant_groups_perms_flags_and_version():
    tokens = issue_tokens(_user(), _ctx(), mfa_verified=False)
    claims = decode_token(tokens["access_token"])
    assert claims["tenant"] == "demo-hastanesi"
    assert claims["groups"] == ["nurse"]
    assert claims["perms"] == ["alerts.ack", "board.view"]
    assert claims["mfa_required"] is False and claims["mfa_verified"] is False
    assert claims["tv"] == 4 and claims["type"] == "access"
    assert "roles" not in claims


def test_requires_mfa_means_a_totp_step_is_still_pending():
    assert issue_tokens(_user(), _ctx(mfa_required=True), mfa_verified=False)["requires_mfa"] is True
    assert issue_tokens(_user(), _ctx(mfa_required=True), mfa_verified=True)["requires_mfa"] is False
    assert issue_tokens(_user(), _ctx(mfa_required=False), mfa_verified=False)["requires_mfa"] is False


def test_mfa_enrolled_reports_the_users_totp_state():
    assert issue_tokens(_user(totp_enabled=True), _ctx(), mfa_verified=False)["mfa_enrolled"] is True
    assert issue_tokens(_user(), _ctx(), mfa_verified=False)["mfa_enrolled"] is False


def test_the_refresh_token_remembers_that_mfa_was_verified():
    tokens = issue_tokens(_user(), _ctx(mfa_required=True), mfa_verified=True)
    assert decode_token(tokens["refresh_token"])["mfa_verified"] is True
    assert "tv" not in decode_token(tokens["refresh_token"])


def test_the_refresh_token_is_bound_to_the_current_credentials():
    """A password or authenticator change must end every session, including the 7-day refresh
    token: the refresh token carries a fingerprint of the credentials it was issued against."""
    u = _user()
    claims = decode_token(issue_tokens(u, _ctx(), mfa_verified=False)["refresh_token"])
    assert claims["cv"] == credential_fingerprint(u)
    before = credential_fingerprint(u)
    u.hashed_password = hash_password("Baska-Parola-1")
    assert credential_fingerprint(u) != before
    before = credential_fingerprint(u)
    u.totp_secret = "JBSWY3DPEHPK3PXP"
    assert credential_fingerprint(u) != before
    assert credential_fingerprint(_user(hashed_password=None)) == credential_fingerprint(
        _user(hashed_password=None))                     # stable for an AD account


def test_normalize_login_lowercases_and_trims():
    assert normalize_login("  Ayse.Demir@Example.COM ") == "ayse.demir@example.com"
    assert normalize_login(None) == ""


def test_normalize_login_folds_the_turkish_capital_dotted_i_to_a_plain_i():
    """A Turkish keyboard auto-capitalises `i` to `İ`, and `"İ".lower()` is `i` + a combining
    dot (two code points) — which would never match the stored, plain-ASCII login."""
    assert "İ".lower() != "i"                                  # the trap this guards against
    assert normalize_login("İbrahim") == "ibrahim"
    assert normalize_login("ıbrahim") == "ibrahim"              # the dotless ı as well
    assert normalize_login("IŞIK") == normalize_login("ışık") == "işik"
    assert normalize_login("AYŞE.DEMİR@EXAMPLE.COM") == "ayşe.demir@example.com"


def _check(user: User | None, password: str) -> bool:
    """verify_local_password takes plain values (it runs on a worker thread, never touching the
    ORM object); read them here the way the callers do."""
    if user is None:
        return verify_local_password(None, None, password)
    return verify_local_password(user.auth_source, user.hashed_password, password)


def test_verify_local_password_accepts_the_right_password():
    assert _check(_user(), "Gizli-123") is True
    assert _check(_user(), "yanlis") is False


def test_verify_local_password_fails_closed_and_still_costs_a_bcrypt_compare(monkeypatch):
    calls = []
    import homunculus.auth.service as svc
    real = svc.verify_password

    def counting(plain, hashed):
        calls.append(hashed)
        return real(plain, hashed)

    monkeypatch.setattr(svc, "verify_password", counting)
    assert _check(None, "x") is False
    assert _check(_user(hashed_password=None), "x") is False
    assert _check(_user(auth_source=AUTH_LDAP), "x") is False
    assert len(calls) == 3                      # a dummy compare each time — no timing oracle


async def test_run_bcrypt_returns_the_result_and_never_runs_more_than_four_at_once():
    import threading
    import time

    import anyio

    from homunculus.auth.service import BCRYPT_LIMITER, run_bcrypt

    assert BCRYPT_LIMITER.total_tokens == 4
    assert await run_bcrypt(verify_local_password, "local", hash_password("p"), "p") is True

    lock = threading.Lock()
    state = {"now": 0, "peak": 0}

    def slow(i):
        with lock:
            state["now"] += 1
            state["peak"] = max(state["peak"], state["now"])
        time.sleep(0.05)
        with lock:
            state["now"] -= 1
        return i

    results = []

    async def one(i):
        results.append(await run_bcrypt(slow, i))

    async with anyio.create_task_group() as tg:
        for i in range(10):
            tg.start_soon(one, i)
    assert sorted(results) == list(range(10))
    assert state["peak"] == 4


def test_login_request_accepts_the_legacy_email_field_as_an_alias():
    assert LoginRequest(email="A@B.co", password="x").identifier == "A@B.co"
    assert LoginRequest(login="ayse", password="x").identifier == "ayse"
    with pytest.raises(ValidationError):
        LoginRequest(password="x")


def test_login_and_password_fields_are_length_limited():
    LoginRequest(login="a" * 254, password="p" * 1024)
    with pytest.raises(ValidationError):
        LoginRequest(login="a" * 255, password="x")
    with pytest.raises(ValidationError):
        LoginRequest(email="a" * 255, password="x")
    with pytest.raises(ValidationError):
        LoginRequest(login="ayse", password="p" * 1025)
    PasswordChangeRequest(current_password="p" * 1024, new_password="q" * 1024)
    with pytest.raises(ValidationError):
        PasswordChangeRequest(current_password="p" * 1025, new_password="x")
    with pytest.raises(ValidationError):
        PasswordChangeRequest(current_password="x", new_password="q" * 1025)


def test_an_over_long_login_is_a_422_before_any_database_work():
    app = FastAPI()
    app.include_router(auth_router)

    async def no_db():
        yield None

    app.dependency_overrides[get_db] = no_db
    res = TestClient(app).post("/auth/login", json={"login": "a" * 255, "password": "x"})
    assert res.status_code == 422


def test_an_over_long_totp_code_is_a_422():
    TOTPVerifyRequest(code="1" * 16)
    with pytest.raises(ValidationError):
        TOTPVerifyRequest(code="1" * 17)

    app = FastAPI()
    app.include_router(auth_router)
    principal = Principal(user=_user(totp_secret="JBSWY3DPEHPK3PXP", totp_enabled=True),
                          tenant="demo-hastanesi", groups=("nurse",), perms=frozenset(),
                          mfa_required=True, mfa_verified=False)

    async def no_db():
        yield None

    app.dependency_overrides[get_principal_pre_mfa] = lambda: principal
    app.dependency_overrides[get_db] = no_db
    res = TestClient(app).post("/auth/totp/verify", json={"code": "1" * 17})
    assert res.status_code == 422


def test_health_is_async_so_it_never_waits_for_a_worker_thread():
    """Sync routes run on the same thread pool bcrypt uses; a liveness probe stuck behind a
    burst of sign-ins would get the service restarted for being busy."""
    import inspect

    from homunculus.api.app import create_app

    app = create_app({}, run_escalation_loop=False)
    (route,) = [r for r in app.routes if getattr(r, "path", None) == "/health"]
    assert inspect.iscoroutinefunction(route.endpoint)
    assert TestClient(app).get("/health").json() == {"status": "ok"}


# --- password change: the checks that run before any database work ---------------------------

async def test_a_too_short_new_password_is_reported_before_the_current_one_is_checked():
    """Checked in this order, a stolen session cannot test guesses at the current password by
    sending a short new one (which would otherwise fail harmlessly only when the guess is right)."""
    with pytest.raises(PasswordError) as exc:
        await change_password(None, _user(), "yanlis-tahmin", "kisa")
    assert exc.value.reason == "too_short"


async def test_a_wrong_current_password_is_refused():
    with pytest.raises(PasswordError) as exc:
        await change_password(None, _user(), "yanlis-tahmin", "Yeni-Parola-1")
    assert exc.value.reason == "wrong_current"


async def test_an_ad_account_cannot_change_its_password_here():
    with pytest.raises(PasswordError) as exc:
        await change_password(None, _user(auth_source=AUTH_LDAP, hashed_password=None),
                              "x", "Yeni-Parola-1")
    assert exc.value.reason == "directory_account"

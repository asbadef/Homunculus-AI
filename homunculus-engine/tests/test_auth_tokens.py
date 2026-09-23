# homunculus-engine/tests/test_auth_tokens.py
"""Token issuance and the sign-in helpers, without a database."""
from __future__ import annotations

import uuid

import pytest
from pydantic import ValidationError

from homunculus.auth.jwt import decode_token
from homunculus.auth.models import AUTH_LDAP, User
from homunculus.auth.schemas import LoginRequest
from homunculus.auth.service import (
    AuthContext, credential_fingerprint, hash_password, issue_tokens, normalize_login,
    verify_local_password,
)


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


def test_verify_local_password_accepts_the_right_password():
    assert verify_local_password(_user(), "Gizli-123") is True
    assert verify_local_password(_user(), "yanlis") is False


def test_verify_local_password_fails_closed_and_still_costs_a_bcrypt_compare(monkeypatch):
    calls = []
    import homunculus.auth.service as svc
    real = svc.verify_password

    def counting(plain, hashed):
        calls.append(hashed)
        return real(plain, hashed)

    monkeypatch.setattr(svc, "verify_password", counting)
    assert verify_local_password(None, "x") is False
    assert verify_local_password(_user(hashed_password=None), "x") is False
    assert verify_local_password(_user(auth_source=AUTH_LDAP), "x") is False
    assert len(calls) == 3                      # a dummy compare each time — no timing oracle


def test_login_request_accepts_the_legacy_email_field_as_an_alias():
    assert LoginRequest(email="A@B.co", password="x").identifier == "A@B.co"
    assert LoginRequest(login="ayse", password="x").identifier == "ayse"
    with pytest.raises(ValidationError):
        LoginRequest(password="x")

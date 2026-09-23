"""Authorisation at the route boundary, with the database faked out.

`get_principal_pre_mfa` is the only dependency that touches the database; overriding it lets
every rule above it — permission any-of, the MFA gate, the pre-MFA exceptions — be tested with
a plain FastAPI app and no Postgres. The token-version and claim checks are tested against the
real decoder with `get_user_by_id` monkeypatched.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from jose import jwt as jose_jwt

from homunculus.auth import dependencies as deps
from homunculus.auth import jwt as auth_jwt
from homunculus.auth.dependencies import (
    Principal, get_current_user, get_current_user_pre_mfa, get_principal_pre_mfa,
    require_permission,
)
from homunculus.auth.jwt import create_access_token, create_refresh_token
from homunculus.auth.models import User
from homunculus.auth.permissions import UnknownPermission
from homunculus.db import get_db


def _user(**kw) -> User:
    return User(id=kw.get("id", uuid.uuid4()), username="ayse", email="ayse@example.com",
                full_name="Ayşe Demir", is_active=kw.get("is_active", True),
                token_version=kw.get("token_version", 0))


def _principal(perms=(), *, mfa_required=False, mfa_verified=False) -> Principal:
    return Principal(user=_user(), tenant="demo-hastanesi", groups=("nurse",),
                     perms=frozenset(perms), mfa_required=mfa_required, mfa_verified=mfa_verified)


def _app() -> FastAPI:
    app = FastAPI()

    @app.get("/ack", dependencies=[Depends(require_permission("alerts.ack"))])
    def ack():
        return {"ok": True}

    @app.get("/either", dependencies=[Depends(require_permission("alerts.ack", "alerts.escalate"))])
    def either():
        return {"ok": True}

    @app.get("/me")
    def me(user: User = Depends(get_current_user_pre_mfa)):
        return {"username": user.username}

    @app.get("/any")
    def any_route(user: User = Depends(get_current_user)):
        return {"username": user.username}

    return app


def _client(principal: Principal) -> TestClient:
    app = _app()
    app.dependency_overrides[get_principal_pre_mfa] = lambda: principal
    return TestClient(app)


def test_a_route_opens_for_a_principal_holding_the_permission():
    assert _client(_principal(["alerts.ack"])).get("/ack").status_code == 200


def test_a_route_is_forbidden_without_the_permission_and_names_it():
    res = _client(_principal(["board.view"])).get("/ack")
    assert res.status_code == 403
    assert "alerts.ack" in res.json()["detail"]


def test_several_keys_mean_any_of_them():
    assert _client(_principal(["alerts.escalate"])).get("/either").status_code == 200
    assert _client(_principal(["board.view"])).get("/either").status_code == 403


def test_an_unknown_permission_key_fails_at_definition_not_at_request_time():
    with pytest.raises(UnknownPermission):
        require_permission("alerts.acknowledge")


def test_the_mfa_gate_blocks_everything_but_the_pre_mfa_routes():
    c = _client(_principal(["alerts.ack"], mfa_required=True, mfa_verified=False))
    assert c.get("/me").status_code == 200
    assert c.get("/any").status_code == 403 and c.get("/any").json()["detail"] == "mfa_required"
    assert c.get("/ack").status_code == 403


def test_the_mfa_gate_opens_once_verified():
    c = _client(_principal(["alerts.ack"], mfa_required=True, mfa_verified=True))
    assert c.get("/any").status_code == 200
    assert c.get("/ack").status_code == 200


def test_a_missing_bearer_is_401_before_any_database_work():
    assert TestClient(_app()).get("/any").status_code == 401


# --- the real decoder and the token-version check --------------------------------------------

@pytest.fixture
def real_client(monkeypatch):
    """The real `get_principal_pre_mfa`, with the user lookup faked and no database."""
    stored = _user(id=uuid.UUID("11111111-1111-1111-1111-111111111111"), token_version=3)

    async def fake_get_user_by_id(_db, user_id):
        return stored if user_id == stored.id else None

    async def no_db():
        yield None

    monkeypatch.setattr(deps, "get_user_by_id", fake_get_user_by_id)
    app = _app()
    app.dependency_overrides[get_db] = no_db
    return TestClient(app), stored


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_a_token_with_the_current_version_is_accepted(real_client):
    client, stored = real_client
    token = create_access_token(str(stored.id), extra={"perms": ["alerts.ack"], "tv": 3})
    assert client.get("/ack", headers=_bearer(token)).status_code == 200


def test_a_token_from_before_a_rights_change_is_refused(real_client):
    client, stored = real_client
    token = create_access_token(str(stored.id), extra={"perms": ["alerts.ack"], "tv": 2})
    res = client.get("/ack", headers=_bearer(token))
    assert res.status_code == 401 and res.json()["detail"] == "token_version"


def test_a_refresh_token_never_authorises_a_route(real_client):
    client, stored = real_client
    assert client.get("/any", headers=_bearer(create_refresh_token(str(stored.id)))).status_code == 401


def test_an_expired_access_token_is_refused(real_client):
    client, stored = real_client
    now = datetime.now(timezone.utc)
    expired = jose_jwt.encode(
        {"sub": str(stored.id), "iat": now - timedelta(hours=2), "exp": now - timedelta(hours=1),
         "jti": "x", "type": "access", "tv": 3},
        auth_jwt.JWT_SECRET, algorithm=auth_jwt.JWT_ALGORITHM,
    )
    assert client.get("/any", headers=_bearer(expired)).status_code == 401


def test_an_unknown_user_is_refused(real_client):
    client, _stored = real_client
    token = create_access_token(str(uuid.uuid4()), extra={"tv": 0})
    assert client.get("/any", headers=_bearer(token)).status_code == 401

# homunculus-engine/tests/test_jwt_caller.py
"""The production JWT -> Caller resolver of the live-board routes (`api/prodserver.py`).

`load_user` is the only collaborator that touches Postgres. The first part fakes it and drives
every decision the resolver makes with real signed tokens. The resolver answers like the routers
(`get_principal` + `caller_tenant_id`), in the same order:

* None, so the board answers 401 and the dashboard refreshes once, for what a refresh can repair
  or what must look like a bad credential: a bad or expired signature, a refresh token, an unknown
  or inactive user, a stale `tv`, a slug unknown to the user (renamed, perhaps reused);
* 403 for what a refresh cannot repair: a pending MFA step, a token naming no tenant, a
  deactivated tenant or membership.

A database error propagates (a 5xx), never a None: a 401 would make the dashboard refresh, the
refresh would fail on the same database, and the clinician would be signed out.

The second part runs the real `_read_user_auth` against the test database, and the third drives
`prodserver.app` itself, both skipped without TEST_DATABASE_URL. The last part is the production
start-up refusals: a weak signing key (the one that signs), a missing PHI key, no usable device
token.

Synthetic data only.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient
from jose import jwt as jose_jwt
from sqlalchemy import update
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import async_sessionmaker

from homunculus.api import prodserver
from homunculus.api.prodserver import UserAuthRow, _read_user_auth, make_jwt_caller_resolver
from homunculus.auth import jwt as auth_jwt
from homunculus.auth.groups import (
    TENANT_INACTIVE, TENANT_OK, TENANT_UNKNOWN, bump_user, ensure_default_groups,
)
from homunculus.auth.jwt import create_access_token, create_refresh_token
from homunculus.auth.models import AUTH_LDAP, TenantMembership, User
from homunculus.auth.service import build_context, issue_tokens
from homunculus.tenant.models import Tenant
from tests.conftest import requires_db
from tests.signed_in import add_user, bearer

UID = "11111111-1111-1111-1111-111111111111"
SLUG = "demo-hastanesi"
MEMBERSHIP_INACTIVE = "Bu kurumdaki üyeliğiniz etkin değil"
NO_TENANT = "Hesabınıza kurum tanımlanmamış"


def _row(**over) -> UserAuthRow:
    base = {"username": "ayse", "is_active": True, "token_version": 2,
            "tenant_verdict": TENANT_OK}
    return UserAuthRow(**{**base, **over})


class _Loader:
    """Stands in for the database read; records what it was asked."""

    def __init__(self, row: UserAuthRow | None = None):
        self.row = _row() if row is None else row
        self.calls: list[tuple[str, str | None]] = []

    async def __call__(self, user_id: str, slug: str | None) -> UserAuthRow | None:
        self.calls.append((user_id, slug))
        return self.row if user_id == UID else None


class _Nobody(_Loader):
    async def __call__(self, user_id, slug):
        self.calls.append((user_id, slug))
        return None


def _token(**extra) -> str:
    base = {"tenant": SLUG, "groups": ["nurse"], "perms": ["board.view"],
            "mfa_required": False, "mfa_verified": False, "tv": 2}
    return create_access_token(UID, extra={**base, **extra})


def _signed(payload: dict, secret: str | None = None) -> str:
    return jose_jwt.encode(payload, secret or auth_jwt.JWT_SECRET, algorithm=auth_jwt.JWT_ALGORITHM)


async def _refused(resolve, token) -> HTTPException:
    with pytest.raises(HTTPException) as exc:
        await resolve(token)
    return exc.value


# ---------------------------------------------------------------- the decisions, DB faked
async def test_a_good_token_becomes_a_caller():
    load = _Loader()
    caller = await make_jwt_caller_resolver(load)(_token())
    assert caller is not None
    assert caller.hospital == SLUG and caller.actor == "ayse"
    assert caller.groups == ("nurse",) and caller.perms == frozenset({"board.view"})
    assert caller.is_device is False and caller.device is False
    assert load.calls == [(UID, SLUG)]          # ONE read, for this user and this slug


async def test_garbage_and_refresh_tokens_are_not_callers_and_read_nothing():
    load = _Loader()
    resolve = make_jwt_caller_resolver(load)
    now = datetime.now(timezone.utc)
    expired = _signed({"sub": UID, "type": "access", "tv": 2, "tenant": SLUG,
                       "iat": now - timedelta(hours=2), "exp": now - timedelta(hours=1)})
    foreign = _signed({"sub": UID, "type": "access", "tv": 2, "tenant": SLUG,
                       "exp": now + timedelta(hours=1)}, secret="another-signing-key-" * 3)
    for token in ("not-a-jwt", create_refresh_token(UID), expired, foreign):
        assert await resolve(token) is None
    assert load.calls == []


async def test_an_unknown_or_inactive_user_is_not_a_caller():
    assert await make_jwt_caller_resolver(_Nobody())(_token()) is None
    assert await make_jwt_caller_resolver(_Loader(_row(is_active=False)))(_token()) is None


async def test_a_stale_token_version_is_refused():
    resolve = make_jwt_caller_resolver(_Loader())
    assert await resolve(_token(tv=1)) is None
    assert await resolve(_token(tv=3)) is None


async def test_a_pending_mfa_step_blocks_the_board():
    """403, not None: a refresh cannot finish the MFA step, so a 401 would only make the dashboard
    refresh on every board request (spec §4: pending MFA is 403 `mfa_required` everywhere)."""
    resolve = make_jwt_caller_resolver(_Loader())
    exc = await _refused(resolve, _token(mfa_required=True, mfa_verified=False))
    assert exc.status_code == 403 and exc.detail == "mfa_required"
    assert await resolve(_token(mfa_required=True, mfa_verified=True)) is not None


async def test_a_temporary_password_not_yet_replaced_blocks_the_board():
    """403 `password_change_required`, after the MFA gate — as get_principal answers on the
    routers (plan G1 Wave 2, decision 1)."""
    load = _Loader(_row(password_change_due=True))
    exc = await _refused(make_jwt_caller_resolver(load), _token())
    assert exc.status_code == 403 and exc.detail == "password_change_required"
    exc = await _refused(make_jwt_caller_resolver(load), _token(mfa_required=True))
    assert exc.detail == "mfa_required"                  # the MFA step comes first


async def test_a_slug_unknown_to_the_user_is_a_401_so_the_client_refreshes():
    """No tenant has the slug, or the user has no membership in it (a renamed slug, perhaps
    reused by another tenant): the refresh mints a token with the current slug."""
    assert await make_jwt_caller_resolver(
        _Loader(_row(tenant_verdict=TENANT_UNKNOWN)))(_token()) is None


async def test_an_inactive_tenant_or_membership_is_a_403():
    """Same answer, same text, as `caller_tenant_id` on the routers."""
    from homunculus.auth.dependencies import MEMBERSHIP_INACTIVE as ROUTERS_TEXT

    resolve = make_jwt_caller_resolver(_Loader(_row(tenant_verdict=TENANT_INACTIVE)))
    exc = await _refused(resolve, _token())
    assert exc.status_code == 403 and exc.detail == MEMBERSHIP_INACTIVE == ROUTERS_TEXT


async def test_a_verdict_the_resolver_does_not_know_fails_closed():
    for verdict in ("", "OK", None, True):
        assert await make_jwt_caller_resolver(
            _Loader(_row(tenant_verdict=verdict)))(_token()) is None


async def test_a_token_naming_no_tenant_is_a_403_like_on_the_routers():
    """A refresh would mint the same tenant-less token, so 401 would loop. The read still runs,
    without a slug: an inactive user or a stale token is refused first, as on the routers."""
    from homunculus.auth.dependencies import NO_TENANT as ROUTERS_TEXT

    for tenant in (None, 5, ["demo-hastanesi"], "", "   "):
        load = _Loader()
        exc = await _refused(make_jwt_caller_resolver(load), _token(tenant=tenant))
        assert exc.status_code == 403 and exc.detail == NO_TENANT == ROUTERS_TEXT
        assert load.calls == [(UID, None)]
    load = _Loader()
    token = create_access_token(UID, extra={"tv": 2})           # no tenant claim at all
    assert (await _refused(make_jwt_caller_resolver(load), token)).detail == NO_TENANT
    assert await make_jwt_caller_resolver(_Loader())(_token(tenant=None, tv=1)) is None
    assert await make_jwt_caller_resolver(
        _Loader(_row(is_active=False)))(_token(tenant=None)) is None


async def test_refusals_come_in_the_routers_order():
    """401 for the account and the token version first, then the MFA gate, then the tenant."""
    stale_and_pending = _token(tv=1, mfa_required=True)
    assert await make_jwt_caller_resolver(_Loader())(stale_and_pending) is None
    for verdict in (TENANT_UNKNOWN, TENANT_INACTIVE):
        exc = await _refused(make_jwt_caller_resolver(_Loader(_row(tenant_verdict=verdict))),
                             _token(mfa_required=True))
        assert exc.detail == "mfa_required"
    assert await make_jwt_caller_resolver(
        _Loader(_row(tenant_verdict=TENANT_INACTIVE)))(_token(tv=1)) is None


async def test_claims_are_read_strictly():
    resolve = make_jwt_caller_resolver(_Loader())
    assert await resolve(create_access_token(UID, extra={"tenant": SLUG})) is None  # no tv
    assert await resolve(_token(tv="2")) is None
    assert await resolve(_token(tv=2.0)) is None
    assert await resolve(_token(tv=True)) is None
    exc = await _refused(resolve, _token(mfa_required=True, mfa_verified="true"))
    assert exc.detail == "mfa_required"                     # "true" is not True
    caller = await resolve(_token(perms="board.view", groups="nurse"))
    assert caller.perms == frozenset() and caller.groups == ()
    caller = await resolve(_token(perms=["board.view", 7, None], groups=["nurse", {"x": 1}]))
    assert caller.perms == frozenset({"board.view"}) and caller.groups == ("nurse",)


async def test_a_subject_that_is_not_a_user_id_reads_nothing():
    """The real read: a token's `sub` that is no UUID is no user, and no query is sent."""
    assert await _read_user_auth("not-a-uuid", SLUG) is None
    assert await _read_user_auth("", None) is None


def test_the_one_read_embeds_the_routers_tenant_condition():
    """ONE statement: the account columns, LEFT JOINed to `tenant_claim_query` — the condition
    `caller_tenant_id` applies, not a copy of it. Checked without a database so a laptop run
    catches a query that lost a filter."""
    from homunculus.auth.groups import tenant_claim_query

    uid = uuid.UUID(UID)
    sql = str(prodserver._user_auth_query(uid, SLUG).compile(dialect=postgresql.dialect()))
    claim = str(tenant_claim_query(uid, SLUG).compile(dialect=postgresql.dialect()))
    assert sql.count("SELECT") == claim.count("SELECT") + 1
    for part in ("users.username", "users.is_active", "users.token_version",
                 "users.must_change_password", "users.auth_source",
                 "LEFT OUTER JOIN", "bool_or(tenant_memberships.is_active)",
                 "tenants.is_active", "tenants.slug", "WHERE users.id"):
        assert part in sql, part
    without = str(prodserver._user_auth_query(uid, None).compile(dialect=postgresql.dialect()))
    assert "tenants" not in without and "users.token_version" in without


class _DatabaseDown(RuntimeError):
    pass


async def _unreachable(user_id, slug):
    raise _DatabaseDown("synthetic: the database is unreachable")


async def test_a_database_error_propagates_and_is_not_read_as_a_bad_token():
    """None would be a 401: the dashboard refreshes, `/auth/refresh` fails on the same
    database, and the clinician is signed out. The error must stay an error."""
    with pytest.raises(_DatabaseDown):
        await make_jwt_caller_resolver(_unreachable)(_token())


async def test_a_database_error_is_a_5xx_on_the_board_while_the_device_path_keeps_working():
    from homunculus.api.app import create_app

    app = create_app({"bridge-token": SLUG}, run_escalation_loop=False,
                     resolve_jwt=make_jwt_caller_resolver(_unreachable))
    async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False),
                           base_url="http://test") as client:
        r = await client.get("/patients", headers={"Authorization": f"Bearer {_token()}"})
        assert r.status_code >= 500, r.status_code
        bridge = await client.get("/patients", headers={"Authorization": "Bearer bridge-token"})
        assert bridge.status_code == 200


# ---------------------------------------------------------------- the real read, test database
@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    """Hospital A with a nurse (MFA not required) and an attending (MFA required); hospital B
    with nobody from A. `_read_user_auth` reads through the test database."""
    import homunculus.db

    monkeypatch.setattr(homunculus.db, "AsyncSessionLocal",
                        async_sessionmaker(db_session.bind, expire_on_commit=False))
    tenants = {}
    for slug in ("hastane-a", "hastane-b"):
        tenant = Tenant(name=f"Sentetik {slug}", slug=slug, country_code="TR", timezone="UTC")
        db_session.add(tenant)
        await db_session.flush()
        tenants[slug] = (tenant, await ensure_default_groups(db_session, tenant.id))
    a, groups = tenants["hastane-a"]
    nurse = await add_user(db_session, username="nurse@hastane-a.example.com",
                           tenant_id=a.id, group=groups["nurse"])
    attending = await add_user(db_session, username="attending@hastane-a.example.com",
                               tenant_id=a.id, group=groups["attending"])
    return {"db": db_session, "a": a, "b": tenants["hastane-b"][0], "nurse": nurse,
            "attending": attending}


async def _set(db, model, where, **values):
    await db.execute(update(model).where(where).values(**values))
    await db.commit()


@requires_db
async def test_the_read_reports_the_account_and_the_tenant_verdict(ward):
    nurse = ward["nurse"]
    row = await _read_user_auth(str(nurse.id), "hastane-a")
    assert row == UserAuthRow(username="nurse@hastane-a.example.com", is_active=True,
                              token_version=nurse.token_version, tenant_verdict=TENANT_OK)
    assert await _read_user_auth(str(uuid.uuid4()), "hastane-a") is None
    no_slug = await _read_user_auth(str(nurse.id), None)
    assert no_slug.username == nurse.username and no_slug.tenant_verdict == TENANT_UNKNOWN


@requires_db
async def test_the_read_says_whether_a_local_account_must_change_its_password(ward):
    db, nurse = ward["db"], ward["nurse"]
    assert (await _read_user_auth(str(nurse.id), "hastane-a")).password_change_due is False
    await _set(db, User, User.id == nurse.id, must_change_password=True)
    assert (await _read_user_auth(str(nurse.id), "hastane-a")).password_change_due is True
    await _set(db, User, User.id == nurse.id, auth_source=AUTH_LDAP)   # never an AD account
    assert (await _read_user_auth(str(nurse.id), "hastane-a")).password_change_due is False


@requires_db
async def test_an_unknown_slug_or_a_missing_membership_is_unknown(ward):
    nurse = str(ward["nurse"].id)
    assert (await _read_user_auth(nurse, "yok-boyle-hastane")).tenant_verdict == TENANT_UNKNOWN
    assert (await _read_user_auth(nurse, "hastane-b")).tenant_verdict == TENANT_UNKNOWN


@requires_db
async def test_an_inactive_membership_or_tenant_is_inactive(ward):
    db, nurse, a = ward["db"], ward["nurse"], ward["a"]
    await _set(db, TenantMembership, TenantMembership.user_id == nurse.id, is_active=False)
    assert (await _read_user_auth(str(nurse.id), "hastane-a")).tenant_verdict == TENANT_INACTIVE
    await _set(db, TenantMembership, TenantMembership.user_id == nurse.id, is_active=True)
    await _set(db, Tenant, Tenant.id == a.id, is_active=False)
    assert (await _read_user_auth(str(nurse.id), "hastane-a")).tenant_verdict == TENANT_INACTIVE


@requires_db
async def test_a_duplicated_membership_is_one_row_and_any_active_one_counts(ward):
    db, nurse, a = ward["db"], ward["nurse"], ward["a"]
    db.add(TenantMembership(user_id=nurse.id, tenant_id=a.id, is_active=False))
    db.add(TenantMembership(user_id=nurse.id, tenant_id=a.id, is_active=True))
    await db.commit()
    assert (await _read_user_auth(str(nurse.id), "hastane-a")).tenant_verdict == TENANT_OK
    await _set(db, TenantMembership, TenantMembership.user_id == nurse.id, is_active=False)
    assert (await _read_user_auth(str(nurse.id), "hastane-a")).tenant_verdict == TENANT_INACTIVE


@requires_db
async def test_an_inactive_user_is_read_as_inactive(ward):
    db, nurse = ward["db"], ward["nurse"]
    await _set(db, User, User.id == nurse.id, is_active=False)
    assert (await _read_user_auth(str(nurse.id), "hastane-a")).is_active is False


# ---------------------------------------------------------------- prodserver.app, end to end
async def _patients(headers):
    """GET /patients on the production app object itself. No lifespan: no escalation loop, no
    startup check. Read-only, so nothing is written to its local audit or identity files."""
    async with AsyncClient(transport=ASGITransport(app=prodserver.app),
                           base_url="http://test") as client:
        return await client.get("/patients", headers=headers)


@requires_db
async def test_a_signed_in_nurse_opens_the_board_through_the_production_wiring(ward):
    r = await _patients(await bearer(ward["db"], ward["nurse"]))
    assert r.status_code == 200, r.text
    assert "patients" in r.json()


@requires_db
async def test_a_deactivated_membership_or_tenant_is_a_403_within_the_tokens_hour(ward):
    db, nurse, a = ward["db"], ward["nurse"], ward["a"]
    auth = await bearer(db, nurse)
    await _set(db, TenantMembership, TenantMembership.user_id == nurse.id, is_active=False)
    r = await _patients(auth)
    assert r.status_code == 403 and r.json()["detail"] == MEMBERSHIP_INACTIVE
    await _set(db, TenantMembership, TenantMembership.user_id == nurse.id, is_active=True)
    await _set(db, Tenant, Tenant.id == a.id, is_active=False)
    r = await _patients(auth)
    assert r.status_code == 403 and r.json()["detail"] == MEMBERSHIP_INACTIVE


@requires_db
async def test_a_renamed_slug_is_a_401_even_when_another_tenant_reuses_it(ward):
    db, nurse, a = ward["db"], ward["nurse"], ward["a"]
    auth = await bearer(db, nurse)
    await _set(db, Tenant, Tenant.id == a.id, slug="hastane-a-yeni")
    assert (await _patients(auth)).status_code == 401
    db.add(Tenant(name="Sentetik Başka Hastane", slug="hastane-a", country_code="TR"))
    await db.commit()
    assert (await _patients(auth)).status_code == 401


@requires_db
async def test_an_account_change_is_a_401(ward):
    db, nurse = ward["db"], ward["nurse"]
    auth = await bearer(db, nurse)
    await bump_user(db, nurse)                     # a rights change: the refresh mints anew
    await db.commit()
    assert (await _patients(auth)).status_code == 401
    auth = await bearer(db, nurse)
    assert (await _patients(auth)).status_code == 200
    await _set(db, User, User.id == nurse.id, is_active=False)
    assert (await _patients(auth)).status_code == 401


@requires_db
async def test_a_temporary_password_is_a_403_on_the_board(ward):
    db, nurse = ward["db"], ward["nurse"]
    auth = await bearer(db, nurse)
    await _set(db, User, User.id == nurse.id, must_change_password=True)
    r = await _patients(auth)
    assert r.status_code == 403 and r.json()["detail"] == "password_change_required"


@requires_db
async def test_a_pending_mfa_step_or_no_tenant_is_a_403(ward):
    db, attending = ward["db"], ward["attending"]
    ctx = await build_context(db, attending)
    assert ctx.mfa_required
    pending = issue_tokens(attending, ctx, mfa_verified=False)["access_token"]
    r = await _patients({"Authorization": f"Bearer {pending}"})
    assert r.status_code == 403 and r.json()["detail"] == "mfa_required"
    assert (await _patients(await bearer(db, attending))).status_code == 200

    operator = await add_user(db, username="operator@vendor.example.com", platform_support=True)
    r = await _patients(await bearer(db, operator))
    assert r.status_code == 403 and r.json()["detail"] == NO_TENANT


# ---------------------------------------------------------------- production start-up
PG = "postgresql+asyncpg://synthetic@127.0.0.1:1/none"     # never connected to: the checks run first
STRONG = "s" * 48
TENANTS_OK = "synthetic-device-token:demo-hastanesi"


def test_a_weak_jwt_secret_is_named():
    from homunculus.auth.jwt import jwt_secret_problem
    assert jwt_secret_problem(None) and jwt_secret_problem("")
    assert jwt_secret_problem("CHANGE_ME_IN_PRODUCTION_USE_32_CHARS_MIN")
    assert jwt_secret_problem("kisa")
    assert jwt_secret_problem("x" * 31)
    assert jwt_secret_problem("x" * 32) is None
    assert jwt_secret_problem("x" * 48) is None


@pytest.mark.parametrize("secret", [" " * 40, "\t\n" * 20, "x" * 32 + "\n", "  " + "x" * 40,
                                    " CHANGE_ME_IN_PRODUCTION_USE_32_CHARS_MIN ",
                                    "kisa" + " " * 40])
def test_whitespace_can_neither_make_nor_disguise_a_key(secret):
    """Refused outright, not judged stripped: padding must not dress up the default or a short
    key, and a pasted newline must not sign with a key the operator does not know they set."""
    from homunculus.auth.jwt import jwt_secret_problem
    problem = jwt_secret_problem(secret)
    assert problem is not None
    assert not secret.strip() or secret.strip() not in problem


def test_the_public_default_is_the_fallback_key():
    assert auth_jwt._DEFAULT_SECRET == "CHANGE_ME_IN_PRODUCTION_USE_32_CHARS_MIN"


@pytest.fixture
def production_env(monkeypatch):
    """Everything a production start needs, valid; each test breaks one thing."""
    monkeypatch.setenv("PHI_ENCRYPTION_KEY", "synthetic-presence-only")
    monkeypatch.setattr(auth_jwt, "JWT_SECRET", STRONG)
    monkeypatch.setenv("TENANTS", TENANTS_OK)
    return monkeypatch


def test_a_valid_production_configuration_starts(production_env):
    prodserver._refuse_unsafe_start(PG)


@pytest.mark.parametrize("secret", ["CHANGE_ME_IN_PRODUCTION_USE_32_CHARS_MIN", "change-me",
                                    "kisa-ama-gizli-anahtar", STRONG + "\n"])
def test_production_refuses_a_weak_signing_key(production_env, secret):
    """The token is the only authority for `perms` and `tenant`: whoever knows the key can mint
    an administrator. The refusal names the problem and never echoes the key."""
    production_env.setattr(auth_jwt, "JWT_SECRET", secret)
    with pytest.raises(SystemExit) as exc:
        prodserver._refuse_unsafe_start(PG)
    message = str(exc.value)
    assert "JWT_SECRET" in message and "openssl rand" in message
    assert secret.strip() not in message


def test_the_check_reads_the_key_that_signs_not_the_environment(production_env):
    production_env.setenv("JWT_SECRET", STRONG)
    production_env.setattr(auth_jwt, "JWT_SECRET", "kisa")
    with pytest.raises(SystemExit, match="JWT_SECRET"):
        prodserver._refuse_unsafe_start(PG)
    production_env.setenv("JWT_SECRET", "kisa")
    production_env.setattr(auth_jwt, "JWT_SECRET", STRONG)
    prodserver._refuse_unsafe_start(PG)


def test_production_refuses_a_missing_phi_key(production_env):
    production_env.delenv("PHI_ENCRYPTION_KEY")
    with pytest.raises(SystemExit, match="PHI_ENCRYPTION_KEY"):
        prodserver._refuse_unsafe_start(PG)


@pytest.mark.parametrize("raw", [None, "", "   ", ":demo-hastanesi", "secret-tok:", " , ",
                                 "secret-tok", " :demo-hastanesi , secret-tok: "], ids=repr)
def test_production_refuses_to_start_without_a_usable_device_token(production_env, raw):
    """With no device token the API would look healthy while no observation ever arrived and
    every board froze. TENANTS is read once, at deploy time, while an operator watches."""
    if raw is None:
        production_env.delenv("TENANTS")
    else:
        production_env.setenv("TENANTS", raw)
    with pytest.raises(SystemExit) as exc:
        prodserver._refuse_unsafe_start(PG)
    message = str(exc.value)
    assert "TENANTS" in message and "secret-tok" not in message
    assert "demo-hastanesi" not in message


def test_one_valid_device_token_is_enough(production_env):
    production_env.setenv("TENANTS", f"{TENANTS_OK}, :bozuk-giris")
    prodserver._refuse_unsafe_start(PG)


@pytest.mark.parametrize("url", ["", "sqlite:///dev.db", "  "])
def test_outside_production_every_check_passes(monkeypatch, url):
    monkeypatch.delenv("PHI_ENCRYPTION_KEY", raising=False)
    monkeypatch.delenv("TENANTS", raising=False)
    monkeypatch.setattr(auth_jwt, "JWT_SECRET", "kisa")
    prodserver._refuse_unsafe_start(url)


def test_production_is_a_postgres_url_read_as_db_py_reads_it(monkeypatch):
    for url in ("postgresql+asyncpg://x@h/db", "postgresql://x@h/db", "postgres://x@h/db"):
        assert prodserver._is_production(url)
        with pytest.raises(SystemExit):
            prodserver._refuse_weak_jwt_secret(url, "kisa")
        prodserver._refuse_weak_jwt_secret(url, STRONG)
    for url in ("", "sqlite:///dev.db", "mysql://x@h/db"):
        assert not prodserver._is_production(url)
        prodserver._refuse_weak_jwt_secret(url, None)
    monkeypatch.setenv("DATABASE_URL", "  postgresql://x@h/db\n")
    assert prodserver._database_url() == "postgresql://x@h/db"


def _import_prodserver(**env) -> "subprocess.CompletedProcess[str]":
    """Import prodserver in a fresh interpreter with a synthetic production environment: the
    refusals run at import, before anything is built or connected. The environment is the
    child's alone; nothing is exported here."""
    import os
    import subprocess
    import sys

    child = {k: v for k, v in os.environ.items()
             if k not in ("DATABASE_URL", "TENANTS", "JWT_SECRET", "PHI_ENCRYPTION_KEY")}
    child.update({k: v for k, v in env.items() if v is not None})
    return subprocess.run([sys.executable, "-c", "import homunculus.api.prodserver"],
                          capture_output=True, text=True, timeout=120, env=child)


def test_the_refusals_run_when_prodserver_is_imported():
    base = {"DATABASE_URL": " " + PG + "\n", "PHI_ENCRYPTION_KEY": "synthetic-presence-only",
            "JWT_SECRET": STRONG, "TENANTS": TENANTS_OK}
    weak = _import_prodserver(**{**base, "JWT_SECRET": "kisa-anahtar"})
    assert weak.returncode != 0 and "JWT_SECRET is shorter than 32" in weak.stderr
    assert "kisa-anahtar" not in weak.stderr
    unset = _import_prodserver(**{**base, "JWT_SECRET": None})
    assert unset.returncode != 0 and "JWT_SECRET is the public default" in unset.stderr
    no_tenants = _import_prodserver(**{**base, "TENANTS": None})
    assert no_tenants.returncode != 0 and "TENANTS is not set" in no_tenants.stderr

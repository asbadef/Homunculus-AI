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

The second part runs the real `_read_user_auth` against the test database, and the third drives
`prodserver.app` itself, both skipped without TEST_DATABASE_URL. Then the signing-key check.

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
from homunculus.auth.models import TenantMembership, User
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
                 "LEFT OUTER JOIN", "bool_or(tenant_memberships.is_active)",
                 "tenants.is_active", "tenants.slug", "WHERE users.id"):
        assert part in sql, part
    without = str(prodserver._user_auth_query(uid, None).compile(dialect=postgresql.dialect()))
    assert "tenants" not in without and "users.token_version" in without


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


# ---------------------------------------------------------------- the signing key
def test_a_weak_jwt_secret_is_named():
    from homunculus.auth.jwt import jwt_secret_problem
    assert jwt_secret_problem(None) and jwt_secret_problem("")
    assert jwt_secret_problem("CHANGE_ME_IN_PRODUCTION_USE_32_CHARS_MIN")
    assert jwt_secret_problem("kisa")
    assert jwt_secret_problem("x" * 31)
    assert jwt_secret_problem("x" * 32) is None
    assert jwt_secret_problem("x" * 48) is None


def test_the_public_default_is_the_fallback_key():
    assert auth_jwt._DEFAULT_SECRET == "CHANGE_ME_IN_PRODUCTION_USE_32_CHARS_MIN"


@pytest.mark.parametrize("secret", [None, "CHANGE_ME_IN_PRODUCTION_USE_32_CHARS_MIN",
                                    "change-me", "kisa-ama-gizli-anahtar"])
def test_a_postgres_deployment_refuses_a_weak_key(monkeypatch, secret):
    """The token is the only authority for `perms` and `tenant`: whoever knows the key can mint
    an administrator. The refusal names the problem and never echoes the key."""
    monkeypatch.setenv("DATABASE_URL", "postgresql://synthetic@localhost:1/none")
    monkeypatch.setenv("PHI_ENCRYPTION_KEY", "synthetic-not-checked-here")
    if secret is None:
        monkeypatch.delenv("JWT_SECRET", raising=False)
    else:
        monkeypatch.setenv("JWT_SECRET", secret)
    with pytest.raises(SystemExit) as exc:
        prodserver._identities()
    message = str(exc.value)
    assert "JWT_SECRET" in message and "openssl rand" in message
    if secret:
        assert secret not in message


def test_the_key_check_applies_to_postgres_only():
    strong = "s" * 48
    for url in ("postgresql+asyncpg://x@h/db", "postgresql://x@h/db", "postgres://x@h/db"):
        with pytest.raises(SystemExit):
            prodserver._refuse_weak_jwt_secret(url, "kisa")
        prodserver._refuse_weak_jwt_secret(url, strong)
    for url in ("", "sqlite:///dev.db"):
        prodserver._refuse_weak_jwt_secret(url, None)

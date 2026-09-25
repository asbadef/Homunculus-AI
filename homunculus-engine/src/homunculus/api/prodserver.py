# src/homunculus/api/prodserver.py
"""Production ASGI entry. All config comes from environment variables — no hardcoded secrets.

Run (host does this via render.yaml startCommand):
    alembic upgrade head && uvicorn homunculus.api.prodserver:app --host 0.0.0.0 --port $PORT

Env:
    TENANTS        "tokenA:slugA,tokenB:slugB" (device bearer tokens; the slug is the tenant
                   slug and the engine's hospital key)
    AUDIT_DB_PATH  path for the SQLite audit log (default /tmp; ephemeral on Render — synthetic only)
    DATABASE_URL / DATABASE_SSL / JWT_SECRET / CORS_ORIGINS  read by db.py / auth.jwt / app.py
"""
from __future__ import annotations

import logging
import os
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import Select, select, true

from homunculus.api.app import create_app
from homunculus.api.audit import SqliteAuditLog
from homunculus.api.identity import Caller, unmatched_hospital_keys
from homunculus.auth.dependencies import MEMBERSHIP_INACTIVE, NO_TENANT
from homunculus.auth.groups import (
    TENANT_INACTIVE, TENANT_OK, TENANT_UNKNOWN, tenant_claim_query, tenant_claim_verdict,
)
from homunculus.auth.jwt import jwt_secret_problem
from homunculus.auth.models import User

logger = logging.getLogger(__name__)


_DEV_TENANTS = {"demo-token": "HOSP1"}


def _parse_tenants(raw: str | None) -> dict[str, str]:
    """`"tokenA:HOSP1,tokenB:HOSP2"` -> {token: hospital}.

    An entry whose token or hospital is empty is skipped with a warning. An empty token would
    otherwise become a device credential that a request with no token at all matches. The
    warning gives the entry's position, never its text, because the text may hold a token.

    Unset or blank, TENANTS falls back to the development default. Set but holding no valid
    entry, it configures NO device token: an error is logged and `{}` returned, so the bridge's
    /ingest is refused (401) until TENANTS is fixed. It never falls back to the development
    default there: that token is public (it is in this file) and a device is exempt from every
    permission check. `{}` rather than refusing to start: sign-in and the clinicians' board keep
    working while the operator reads the log (see `warn_about_unmatched_tenants`).
    """
    if raw is None or not raw.strip():
        return dict(_DEV_TENANTS)     # local development only; production sets TENANTS
    tenants: dict[str, str] = {}
    for position, pair in enumerate(raw.split(","), start=1):
        pair = pair.strip()
        if not pair:
            continue                                # "a:X," — a trailing comma, nothing lost
        token, sep, hospital = pair.partition(":")
        token, hospital = token.strip(), hospital.strip()
        if not sep or not token or not hospital:
            logger.warning("TENANTS entry %d is not token:hospital with both parts non-empty; "
                           "ignored", position)
            continue
        tenants[token] = hospital
    if not tenants:
        logger.error("TENANTS is set but holds no valid token:hospital entry, so no device token "
                     "is accepted and the bridge's /ingest is refused until it is fixed. The "
                     "development default is NOT used in its place.")
    return tenants


def _audit():
    """Prefer the durable Postgres audit; fall back to SQLite only without a database.

    Hosts like Render and Vercel discard the local filesystem on every deploy, so a SQLite audit
    there disappears while still looking like a record — worse than having none. When DATABASE_URL
    is configured the trail goes to the same managed Postgres as everything else.
    """
    url = os.getenv("DATABASE_URL")
    if url and url.startswith("postgresql"):
        from homunculus.api.audit_postgres import PostgresAuditLog

        return PostgresAuditLog(
            url, ssl_required=os.getenv("DATABASE_SSL", "").lower() in ("require", "true", "1")
        )
    # Relative by default so it resolves on any platform; an absolute "/tmp/..." is not a valid
    # path on Windows, where developers run this too.
    return SqliteAuditLog(os.getenv("AUDIT_DB_PATH", "homunculus-audit.db"))


def warn_about_unmatched_tenants(configured, known_slugs) -> None:
    """Report configured hospital keys that no tenant slug matches.

    A warning rather than a refusal to start: on a ward, a service that will not boot is worse
    than one running with a fault that can be read in the log and fixed.

    This is the check for the failure with no symptoms: if TENANTS names a hospital key the
    database has no tenant for, the bridge will still write observations under that key, the
    engine will still evaluate and alert on them — and no clinician's JWT will ever resolve to
    it, so every screen for that hospital stays empty, forever, with nothing else complaining.
    """
    unmatched = unmatched_hospital_keys(configured, known_slugs)
    if not unmatched:
        return
    known = sorted(set(known_slugs))
    logger.warning(
        "TENANTS names hospital key(s) %s that match no tenant slug in the database "
        "(known slugs: %s). Observations sent under %s will be stored and evaluated, but no "
        "clinician's JWT can ever resolve to %s, so that hospital's board will stay empty with "
        "no other sign of failure. Fix: change TENANTS to use the tenant's actual slug, or "
        "create a tenant row with that slug.",
        ", ".join(unmatched), ", ".join(known) if known else "(none)",
        ", ".join(unmatched), ", ".join(unmatched),
    )


async def _read_all_tenant_slugs() -> list[str]:
    """All tenant slugs known to the database — used only for the startup TENANTS-vs-DB check.

    Every tenant, active or not, so a configured hospital key can be checked against the full
    set.
    """
    from sqlalchemy import select

    from homunculus.db import AsyncSessionLocal
    from homunculus.tenant.models import Tenant

    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Tenant.slug))
        return [row[0] for row in result.all()]


def make_startup_tenant_check(configured_hospitals: list[str]) -> Callable[[], Awaitable[None]]:
    """Build the `on_startup_check` hook: compare the already-parsed TENANTS hospital keys
    against the database's tenant slugs and warn about any that don't match.

    Takes the parsed hospital list rather than re-reading TENANTS itself, so there is exactly
    one place (`_parse_tenants(os.getenv("TENANTS"))`, below) that turns the env var into
    hospital keys — nothing here can drift from what `create_app` was actually given.
    """

    async def check() -> None:
        known_slugs = await _read_all_tenant_slugs()
        warn_about_unmatched_tenants(configured_hospitals, known_slugs)

    return check


@dataclass(frozen=True)
class UserAuthRow:
    """What the board resolver's one read returns: the account, and `tenant_claim_verdict` for
    the token's `tenant` slug (TENANT_OK, TENANT_UNKNOWN or TENANT_INACTIVE)."""
    username: str
    is_active: bool
    token_version: int
    tenant_verdict: str


def _decode_access_claims(token: str) -> dict | None:
    """The project's real JWT check. A refresh token is signed with the same secret, so only
    the `type` claim tells them apart: it must never authorise the clinical board."""
    from jose import JWTError

    from homunculus.auth.jwt import decode_token

    try:
        claims = decode_token(token)
    except JWTError:
        return None
    if claims.get("type") != "access" or not claims.get("sub"):
        return None
    return claims


def _strings(value) -> list[str]:
    """A list claim's string items; anything else reads as empty (fails closed)."""
    return [x for x in value if isinstance(x, str)] if isinstance(value, list) else []


def make_jwt_caller_resolver(
    load_user: Callable[[str, str | None], Awaitable[UserAuthRow | None]],
    *,
    decode: Callable[[str], dict | None] = _decode_access_claims,
) -> Callable[[str], Awaitable[Caller | None]]:
    """Build the `resolve_jwt` hook `create_app` calls when a bearer value isn't a device token.

    The token is signed, so its `groups` and `perms` are trusted as minted. `load_user(user_id,
    slug)` is ONE database read: the account (active? current token version?) and the token's
    `tenant` slug, checked the way `caller_tenant_id` checks it on the routers (the slug's tenant
    is active and the user holds an active membership in it). The answers, in the routers'
    order (`get_principal`, then `caller_tenant_id`):

      None (401: the dashboard refreshes once)   a bad, expired or refresh token; an unknown or
                                                 inactive user; a stale `tv`; a slug unknown to
                                                 the user (renamed, perhaps reused)
      403 "mfa_required"                         a pending MFA step
      403 NO_TENANT                              a token naming no tenant
      403 MEMBERSHIP_INACTIVE                    a deactivated tenant or membership

    A refresh repairs the first group and cannot repair the rest: answering those with 401 would
    make the dashboard refresh on every board request.
    """

    async def resolve(token: str) -> Caller | None:
        claims = decode(token)
        if claims is None:
            return None
        tenant = claims.get("tenant")
        slug = tenant if isinstance(tenant, str) and tenant.strip() else None
        row = await load_user(str(claims["sub"]), slug)
        if row is None or not row.is_active:
            return None
        tv = claims.get("tv")
        if type(tv) is not int or tv != row.token_version:
            return None
        if claims.get("mfa_required") is True and claims.get("mfa_verified") is not True:
            raise HTTPException(status_code=403, detail="mfa_required")
        if slug is None:
            raise HTTPException(status_code=403, detail=NO_TENANT)
        if row.tenant_verdict == TENANT_INACTIVE:
            raise HTTPException(status_code=403, detail=MEMBERSHIP_INACTIVE)
        if row.tenant_verdict != TENANT_OK:
            return None                     # TENANT_UNKNOWN, or anything unexpected
        return Caller(
            hospital=slug, actor=row.username,
            groups=tuple(_strings(claims.get("groups"))),
            perms=frozenset(_strings(claims.get("perms"))),
        )

    return resolve


def _user_auth_query(user_id: uuid.UUID, slug: str | None) -> Select:
    """The board resolver's ONE query: the user's `username`, `is_active` and `token_version`,
    LEFT JOINed to `tenant_claim_query(user_id, slug)`, the statement `caller_tenant_id` runs on
    the routers, embedded rather than copied. At most one row (the subquery has at most one);
    none when there is no such user. Without a slug only the account is read."""
    account = (User.username, User.is_active, User.token_version)
    if slug is None:
        return select(*account).where(User.id == user_id)
    claim = tenant_claim_query(user_id, slug).subquery("tenant_claim")
    return (
        select(*account, claim.c.tenant_id, claim.c.tenant_active, claim.c.member_active)
        .select_from(User)
        .outerjoin(claim, true())
        .where(User.id == user_id)
    )


async def _read_user_auth(user_id: str, slug: str | None) -> UserAuthRow | None:
    """Run `_user_auth_query` against the real database. A `sub` that is no UUID is no user,
    and no query is sent."""
    try:
        uid = uuid.UUID(user_id)
    except (ValueError, TypeError, AttributeError):
        return None
    from homunculus.db import AsyncSessionLocal

    async with AsyncSessionLocal() as session:
        row = (await session.execute(_user_auth_query(uid, slug))).first()
    if row is None:
        return None
    verdict = tenant_claim_verdict(row)[1] if slug is not None else TENANT_UNKNOWN
    return UserAuthRow(username=row.username, is_active=row.is_active,
                       token_version=row.token_version, tenant_verdict=verdict)


def _refuse_weak_jwt_secret(url: str, secret: str | None) -> None:
    """With a Postgres DATABASE_URL (a real deployment), refuse to start on a weak signing key:
    the token is the only authority for `perms` and `tenant`, so whoever knows the key can mint
    an administrator. The message never quotes the key."""
    problem = jwt_secret_problem(secret)
    if url.startswith(("postgresql", "postgres://")) and problem:
        raise SystemExit(f"{problem}. Generate one: openssl rand -base64 36")


def _identities():
    """Use managed Postgres in production; SQLite persists local development identities.

    The PHI key is validated here, at boot: a malformed key would otherwise surface as a 500 on
    the first admission and — because the bridge drops identity records the API refuses — as a
    ward with readings but no names, with nothing in the API log until someone looks. The JWT
    signing key is checked here too, under the same condition (a Postgres DATABASE_URL)."""
    from homunculus.api.patient_identity import SqliteIdentityStore
    from homunculus.crypto import validate_key

    url = os.getenv("DATABASE_URL", "")
    if url.startswith(("postgresql", "postgres://")) and not os.getenv("PHI_ENCRYPTION_KEY"):
        # The compose file already refuses to start without the key; this covers a server run
        # any other way. Real names must never be written under the JWT_SECRET-derived dev key.
        raise SystemExit("PHI_ENCRYPTION_KEY is required with a Postgres DATABASE_URL "
                         "(see deploy/local/.env.example)")
    _refuse_weak_jwt_secret(url, os.getenv("JWT_SECRET"))
    validate_key()
    if url.startswith(("postgresql", "postgres://")):
        from homunculus.api.patient_identity_postgres import PostgresIdentityStore
        return PostgresIdentityStore(
            url, ssl_required=os.getenv("DATABASE_SSL", "").lower() in ("require", "true", "1"))
    return SqliteIdentityStore(os.getenv("IDENTITY_DB_PATH", "homunculus-identity.db"))


_tenants = _parse_tenants(os.getenv("TENANTS"))

app = create_app(
    _tenants,
    audit=_audit(),
    identities=_identities(),
    resolve_jwt=make_jwt_caller_resolver(_read_user_auth),
    on_startup_check=make_startup_tenant_check(list(_tenants.values())),
)

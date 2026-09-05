# src/homunculus/api/prodserver.py
"""Production ASGI entry. All config comes from environment variables — no hardcoded secrets.

Run (host does this via render.yaml startCommand):
    alembic upgrade head && uvicorn homunculus.api.prodserver:app --host 0.0.0.0 --port $PORT

Env:
    TENANTS        "tokenA:HOSP1,tokenB:HOSP2"  (legacy bearer-token ingest/board tenancy)
    AUDIT_DB_PATH  path for the SQLite audit log (default /tmp; ephemeral on Render — synthetic only)
    DATABASE_URL / DATABASE_SSL / JWT_SECRET / CORS_ORIGINS  read by db.py / auth.jwt / app.py
"""
from __future__ import annotations

import logging
import os
from collections.abc import Awaitable, Callable

from homunculus.api.app import create_app
from homunculus.api.audit import SqliteAuditLog
from homunculus.api.identity import hospital_for_slugs, unmatched_hospital_keys

logger = logging.getLogger(__name__)


def _parse_tenants(raw: str | None) -> dict[str, str]:
    tenants: dict[str, str] = {}
    for pair in (raw or "").split(","):
        pair = pair.strip()
        if ":" in pair:
            token, hospital = pair.split(":", 1)
            tenants[token.strip()] = hospital.strip()
    return tenants or {"demo-token": "HOSP1"}   # safe default; override via TENANTS in production


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


def _decode_access_token(token: str) -> str | None:
    """Default `decode` for `make_jwt_hospital_resolver`: the project's real JWT check.

    Access and refresh tokens are signed with the same secret, so signature validity alone
    doesn't tell them apart — only the `type` claim does. A refresh token must never authorise
    the clinical board (it exists only to mint a new access token), so it is rejected here just
    like a garbled or expired one, by returning None rather than a user id.
    """
    from jose import JWTError

    from homunculus.auth.jwt import decode_token

    try:
        claims = decode_token(token)
    except JWTError:
        return None
    if claims.get("type") != "access":
        return None
    return claims.get("sub")


def make_jwt_hospital_resolver(
    read_slugs: Callable[[str], Awaitable[list[str]]],
    *,
    decode: Callable[[str], str | None] = _decode_access_token,
) -> Callable[[str], Awaitable[str | None]]:
    """Build the `resolve_jwt_hospital` hook that `create_app` calls when a bearer value isn't a
    known tenant token.

    Both collaborators are parameters: `decode` turns a token into a user id (or None), and
    `read_slugs` turns a user id into the tenant slugs they belong to. Splitting them out this
    way means the decision logic — reject what doesn't decode, reject no membership, pick the
    lowest slug when there are several — is testable with neither a database nor a signing key;
    only `read_slugs`'s real implementation below touches Postgres.
    """

    async def resolve(token: str) -> str | None:
        user_id = decode(token)
        if user_id is None:
            return None
        slugs = sorted(await read_slugs(user_id))
        hospital = hospital_for_slugs(slugs)
        if len(slugs) > 1:
            # An operator asking "why is this doctor seeing that ward" needs this line —
            # the choice is deterministic (lowest slug) but not obvious from the outside.
            logger.info(
                "user %s has %d tenant memberships (%s); resolved to hospital %s",
                user_id, len(slugs), ", ".join(slugs), hospital,
            )
        return hospital

    return resolve


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

    Distinct from `_read_tenant_slugs`, which is scoped to one user's active memberships; this
    reads every tenant so a configured hospital key can be checked against the full set.
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


def _tenant_slug_query(user_id: str):
    """The membership query in isolation, so its filters can be inspected without a database.

    Tenant.slug joined through TenantMembership joined through User, filtered to this user's
    *active* membership on an *active* user account. Both checks matter and neither substitutes
    for the other: an admin who deactivates a compromised or terminated account is deactivating
    the User row, not touching any TenantMembership — mirroring `get_current_user` in
    `auth/dependencies.py`, which is why that path already checks `user.is_active` and this one
    must too. Filtering on membership alone (the original version of this query) left a
    deactivated user's still-unexpired access token able to keep reaching every clinical route,
    including /ingest, until it expired on its own.
    """
    from sqlalchemy import select

    from homunculus.auth.models import TenantMembership, User
    from homunculus.tenant.models import Tenant

    return (
        select(Tenant.slug)
        .select_from(TenantMembership)
        .join(Tenant, TenantMembership.tenant_id == Tenant.id)
        .join(User, TenantMembership.user_id == User.id)
        .where(
            TenantMembership.user_id == user_id,
            TenantMembership.is_active == True,  # noqa: E712
            User.is_active == True,  # noqa: E712
        )
    )


async def _read_tenant_slugs(user_id: str) -> list[str]:
    """Run `_tenant_slug_query` against the real database.

    Needs a live Postgres to exercise end to end; the query's own filter construction is covered
    without one by tests/test_jwt_hospital_lookup.py, and the decision logic that consumes its
    result is covered there too.
    """
    from homunculus.db import AsyncSessionLocal

    async with AsyncSessionLocal() as session:
        result = await session.execute(_tenant_slug_query(user_id))
        return [row[0] for row in result.all()]


def _identities():
    """Use managed Postgres in production; SQLite persists local development identities."""
    from homunculus.api.patient_identity import SqliteIdentityStore

    url = os.getenv("DATABASE_URL", "")
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
    resolve_jwt_hospital=make_jwt_hospital_resolver(_read_tenant_slugs),
    on_startup_check=make_startup_tenant_check(list(_tenants.values())),
)

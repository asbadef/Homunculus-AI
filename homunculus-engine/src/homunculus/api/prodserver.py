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
from homunculus.api.identity import hospital_for_slugs

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


async def _read_tenant_slugs(user_id: str) -> list[str]:
    """The real membership query: Tenant.slug joined through TenantMembership, filtered to this
    user's *active* memberships — a revoked membership must not still grant board access.

    Needs a live Postgres to exercise; the decision logic that consumes its result is covered by
    tests/test_jwt_hospital_lookup.py without one.
    """
    from sqlalchemy import select

    from homunculus.auth.models import TenantMembership
    from homunculus.db import AsyncSessionLocal
    from homunculus.tenant.models import Tenant

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Tenant.slug)
            .join(TenantMembership, TenantMembership.tenant_id == Tenant.id)
            .where(
                TenantMembership.user_id == user_id,
                TenantMembership.is_active == True,  # noqa: E712
            )
        )
        return [row[0] for row in result.all()]


app = create_app(
    _parse_tenants(os.getenv("TENANTS")),
    audit=_audit(),
    resolve_jwt_hospital=make_jwt_hospital_resolver(_read_tenant_slugs),
)

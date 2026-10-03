# src/homunculus/api/prodserver.py
"""Production ASGI entry. All config comes from environment variables — no hardcoded secrets.

Run (host does this via render.yaml startCommand):
    alembic upgrade head && uvicorn homunculus.api.prodserver:app --host 0.0.0.0 --port $PORT

Env:
    TENANTS        "tokenA:slugA,tokenB:slugB" (device bearer tokens; the slug is the tenant
                   slug and the engine's hospital key)
    AUDIT_DB_PATH  path for the SQLite audit log (default /tmp; ephemeral on Render — synthetic only)
    DATABASE_URL / DATABASE_SSL / JWT_SECRET / CORS_ORIGINS  read by db.py / auth.jwt / app.py
    LDAP_*         optional Active Directory sign-in, read by auth/ldap3_directory.py
                   (`ldap_from_env`); unset or unusable = off, never a refusal to start

Production means a Postgres DATABASE_URL (`_is_production`). There, before anything is built,
`_refuse_unsafe_start` stops the process (SystemExit) on a missing PHI key, a weak signing key or
unusable device tokens: a deploy that fails loudly while an operator watches is safer than a
service that looks healthy and is not.
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
from homunculus.auth import jwt as auth_jwt
from homunculus.auth.dependencies import MEMBERSHIP_INACTIVE, NO_TENANT
from homunculus.auth.groups import (
    TENANT_INACTIVE, TENANT_OK, TENANT_UNKNOWN, tenant_claim_query, tenant_claim_verdict,
)
from homunculus.auth.jwt import jwt_secret_problem
from homunculus.auth.ldap3_directory import ldap_from_env
from homunculus.auth.models import User
from homunculus.tenant.bedmap import BedMap

logger = logging.getLogger(__name__)


_DEV_TENANTS = {"demo-token": "HOSP1"}


def _split_tenants(raw: str) -> tuple[dict[str, str], list[int]]:
    """The valid `token:hospital` entries of a TENANTS value, and the 1-based positions of the
    invalid ones (a missing ":" or an empty part). Pure: the callers decide what to say."""
    tenants: dict[str, str] = {}
    invalid: list[int] = []
    for position, pair in enumerate(raw.split(","), start=1):
        pair = pair.strip()
        if not pair:
            continue                                # "a:X," — a trailing comma, nothing lost
        token, sep, hospital = pair.partition(":")
        token, hospital = token.strip(), hospital.strip()
        if not sep or not token or not hospital:
            invalid.append(position)
            continue
        tenants[token] = hospital
    return tenants, invalid


def _parse_tenants(raw: str | None) -> dict[str, str]:
    """`"tokenA:HOSP1,tokenB:HOSP2"` -> {token: hospital}.

    An entry whose token or hospital is empty is skipped with a warning. An empty token would
    otherwise become a device credential that a request with no token at all matches. The
    warning gives the entry's position, never its text, because the text may hold a token.

    In production (a Postgres DATABASE_URL) `_refuse_unsafe_start` has already stopped the
    process unless TENANTS holds at least one valid entry. Outside it: unset or blank, TENANTS
    falls back to the development default; set but holding no valid entry, it configures NO
    device token (an error is logged and `{}` returned). It never falls back to the development
    default there: that token is public (it is in this file) and a device is exempt from every
    permission check.
    """
    if raw is None or not raw.strip():
        return dict(_DEV_TENANTS)     # local development only; production sets TENANTS
    tenants, invalid = _split_tenants(raw)
    for position in invalid:
        logger.warning("TENANTS entry %d is not token:hospital with both parts non-empty; "
                       "ignored", position)
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
    url = _database_url()
    if _is_production(url):
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


def _database_url() -> str:
    """DATABASE_URL as db.py reads it, stripped: a pasted trailing newline must not make the
    start-up checks, the audit and the identity store disagree with the engine about whether
    this is production."""
    return os.getenv("DATABASE_URL", "").strip()


def _is_production(url: str) -> bool:
    """The one rule for "this is a real deployment": a Postgres DATABASE_URL."""
    return url.startswith(("postgresql", "postgres://"))


def _refuse_missing_phi_key(url: str, key: str | None) -> None:
    """In production, refuse to start without PHI_ENCRYPTION_KEY. The compose file already
    refuses; this covers a server run any other way. Real names must never be written under the
    JWT_SECRET-derived dev key."""
    if _is_production(url) and not key:
        raise SystemExit("PHI_ENCRYPTION_KEY is required with a Postgres DATABASE_URL "
                         "(see deploy/local/.env.example)")


def _refuse_weak_jwt_secret(url: str, secret: str | None) -> None:
    """In production, refuse to start on a weak signing key: the token is the only authority
    for `perms` and `tenant`, so whoever knows the key can mint an administrator. Pass the key
    that actually signs (`auth.jwt.JWT_SECRET`). The message never quotes the key."""
    problem = jwt_secret_problem(secret)
    if _is_production(url) and problem:
        raise SystemExit(f"{problem}. Generate one: openssl rand -base64 36")


def _refuse_bad_tenants(url: str, raw: str | None) -> None:
    """In production, refuse to start without a usable device token (TENANTS unset, blank, or
    holding no valid entry). With none the API looks healthy (sign-in works, the SSE keep-alives
    say "connected") while no observation ever arrives and every board silently freezes.
    TENANTS is read once, at start-up, so a bad value shows up only at deploy time, when an
    operator is watching: compose restart-loops, Render keeps the previous deploy. The central
    station stays the primary alarm system, so loudly down is safer than quietly stale. The
    message never carries token text."""
    if not _is_production(url):
        return
    if raw is None or not raw.strip():
        raise SystemExit("TENANTS is not set. With a Postgres DATABASE_URL it must map the "
                         "bridge's token to the tenant slug: TENANTS=<token>:<tenant slug>, the "
                         "token generated with openssl rand -base64 36")
    tenants, _invalid = _split_tenants(raw)
    if not tenants:
        raise SystemExit("TENANTS holds no valid <token>:<tenant slug> entry (each entry needs "
                         "a ':' and both parts non-empty), so no device could send "
                         "observations")


def _refuse_unsafe_start(url: str) -> None:
    """Every production start-up refusal, in one place, run at import before anything is
    built. Outside production (no Postgres DATABASE_URL) each check passes."""
    _refuse_missing_phi_key(url, os.getenv("PHI_ENCRYPTION_KEY"))
    _refuse_weak_jwt_secret(url, auth_jwt.JWT_SECRET)
    _refuse_bad_tenants(url, os.getenv("TENANTS"))


def _identities():
    """Use managed Postgres in production; SQLite persists local development identities.

    The PHI key is validated here, at boot: a malformed key would otherwise surface as a 500 on
    the first admission and — because the bridge drops identity records the API refuses — as a
    ward with readings but no names, with nothing in the API log until someone looks. (A
    MISSING key in production was already refused by `_refuse_unsafe_start`.)"""
    from homunculus.api.patient_identity import SqliteIdentityStore
    from homunculus.crypto import validate_key

    url = _database_url()
    validate_key()
    if _is_production(url):
        from homunculus.api.patient_identity_postgres import PostgresIdentityStore
        return PostgresIdentityStore(
            url, ssl_required=os.getenv("DATABASE_SSL", "").lower() in ("require", "true", "1"))
    return SqliteIdentityStore(os.getenv("IDENTITY_DB_PATH", "homunculus-identity.db"))


# Before anything is built: a production start with an unsafe configuration stops here, loudly.
_refuse_unsafe_start(_database_url())

_tenants = _parse_tenants(os.getenv("TENANTS"))

def _bedmap():
    """This site's HIS-location → our-bed table.

    A missing file is not a failure: BedMap.from_file returns an empty table, every location
    then resolves as unmatched-and-counted, and every patient still gets a card. That is the
    correct state for a deployment whose table has not been written yet — the discovery report
    is what tells the operator to write it. Compare the device field tables, which are read the
    same way and for the same reason.
    """
    return BedMap.from_file(os.getenv("BED_MAPPING_PATH", "/app/bed-mapping.json"))


def _scope_resolver():
    """Wire the staff-scope boundary to the real database.

    Assembled here rather than inside `create_app` for the same reason the JWT resolver is: the
    decision logic stays testable without Postgres, and an app built any other way — a test, a
    local run against SQLite — keeps working without one.

    `decode_access_credential` yields `(user_id, tenant_slug)` from the access token, and the
    scope is read in that tenant — the same tenant the JWT resolver puts the caller's board in.

    Nothing narrows until a `staff_scopes` row exists. With the table empty every user resolves
    as unassigned and sees the whole hospital exactly as before, which is why this can ship to a
    running pilot without a screen changing. Narrowing begins when an administrator assigns
    somebody, and becomes deny-by-default only when `SCOPE_ENFORCE_UNASSIGNED` is set.
    """
    from homunculus.scope.resolver import (
        break_glass_patient_ids, decode_access_credential, make_scope_resolver,
        read_scope_for_user,
    )

    return make_scope_resolver(read_scope_for_user, decode=decode_access_credential,
                               break_glass=break_glass_patient_ids)


app = create_app(
    _tenants,
    audit=_audit(),
    identities=_identities(),
    resolve_jwt=make_jwt_caller_resolver(_read_user_auth),
    bedmap=_bedmap(),
    resolve_scope=_scope_resolver(),
    on_startup_check=make_startup_tenant_check(list(_tenants.values())),
    ldap=ldap_from_env(),
)

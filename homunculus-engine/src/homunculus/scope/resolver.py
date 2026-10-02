"""Turning a credential into a scope.

Built the same way `make_jwt_caller_resolver` (prodserver) is, and for the same reason: the
decision — what to do with a token that does not decode, with a user the database does not know,
with a database that is not answering — is testable here with neither Postgres nor a signing key.
Only the reader functions passed in touch either.
"""
from __future__ import annotations

import logging
import os
from collections.abc import Awaitable, Callable

from homunculus.scope.rules import Scope, ScopeReason, build_scope

logger = logging.getLogger(__name__)

# A user whose scope cannot be established sees nothing. This is the one place in the package
# that fails closed, and it is the right place: everywhere else the question is "what has an
# administrator decided", here it is "we could not find out". Those are different, and only the
# second one is a reason to refuse — a look-up failure must not read as an empty assignment and
# quietly hand over the hospital.
UNKNOWN = Scope(False, "unknown")


def enforce_unassigned_default() -> bool:
    """Whether a user with no assignment sees nothing.

    Off unless a deployment says otherwise, because the pilot's database has no assignments in
    it and turning this on with an empty table blacks out every clinical screen at once. The
    flag is what makes narrowing access a decision somebody makes on a date, rather than a
    consequence of a deploy.
    """
    return os.getenv("SCOPE_ENFORCE_UNASSIGNED", "").strip().lower() in ("1", "true", "yes")


def make_scope_resolver(
    read_scope: Callable[[str, str], Awaitable[tuple[str | None, list[str], list[str], list[str]]]],
    *,
    decode: Callable[[str], tuple[str, str] | None],
    break_glass: Callable[[str, str], Awaitable[list[str]]] | None = None,
    enforce_unassigned: Callable[[], bool] = enforce_unassigned_default,
) -> Callable[[str], Awaitable[Scope]]:
    """Build the `resolve_scope` hook `create_app` calls for each credential.

    `decode(credential)` returns `(user_id, tenant_slug)` from the access token's `sub` and
    `tenant` claims, or None. `read_scope(user_id, tenant_slug)` returns
    `(role, unit_ids, bed_ids, own_patient_ids)` IN THAT TENANT; role None means no active
    membership there and resolves to UNKNOWN.
    Production (`prodserver._scope_resolver`) passes `decode=decode_access_credential`.
    `break_glass(user_id, tenant_slug)` returns the patients that user currently holds an open emergency session for —
    a list, not a flag, because a session is opened about one patient with a reason written
    about that patient. Without it wired, break-glass widens nothing here: a deployment that has
    not connected it gets no silent grant.
    """

    async def resolve(credential: str) -> Scope:
        decoded = decode(credential)
        if decoded is None:
            # Not an error path worth a stack trace: an expired access token reaches this line
            # on every ward, all day. It is also not a reason to open the board.
            return UNKNOWN
        user_id, tenant_slug = decoded
        try:
            role, unit_ids, bed_ids, own = await read_scope(user_id, tenant_slug)
            emergency = list(await break_glass(user_id, tenant_slug)) if break_glass else []
        except Exception:
            # A database that is not answering must not be read as "this user has no
            # restrictions". The board goes dark and the log says why — the opposite failure
            # hands a whole hospital's patients to whoever is logged in when Postgres blinks.
            logger.exception("scope lookup failed for user %s; refusing rather than widening",
                             user_id)
            return UNKNOWN
        if role is None:
            # No active membership in this tenant (or unknown tenant): not "unassigned".
            return UNKNOWN
        return build_scope(
            role, unit_ids=unit_ids, bed_ids=bed_ids, own_patient_ids=own,
            break_glass_patient_ids=emergency, enforce_unassigned=enforce_unassigned(),
        )

    return resolve


def decode_access_credential(credential: str) -> tuple[str, str] | None:
    """`(user_id, tenant_slug)` from an access token, or None. No database.

    None on any decode error, a non-access token, or a missing `sub` / `tenant` claim.
    """
    from homunculus.auth.jwt import decode_token

    try:
        claims = decode_token(credential)
    except Exception:
        return None
    sub, tenant = claims.get("sub"), claims.get("tenant")
    if claims.get("type") != "access" or not isinstance(sub, str) or not sub:
        return None
    if not isinstance(tenant, str) or not tenant:
        return None
    return sub, tenant


async def read_scope_for_user(
    user_id: str, tenant_slug: str
) -> tuple[str | None, list[str], list[str], list[str]]:
    """The real reader: one database session, four answers, all for one tenant.

    Kept in one session so the four answers describe the same instant. An unknown or inactive
    tenant slug yields role None (resolver: UNKNOWN).
    """
    import uuid

    from sqlalchemy import select

    from homunculus.db import AsyncSessionLocal
    from homunculus.scope import service
    from homunculus.tenant.models import Tenant

    uid = uuid.UUID(user_id)
    async with AsyncSessionLocal() as session:
        tenant_id = (await session.execute(
            select(Tenant.id).where(Tenant.slug == tenant_slug, Tenant.is_active.is_(True))
        )).scalar_one_or_none()
        if tenant_id is None:
            return None, [], [], []
        grants = await service.read_grants(session, uid, tenant_id)
        role = await service.read_role(session, uid, tenant_id)
        own = await service.read_own_patient_ids(session, uid, tenant_id)
    return (role,
            [g.unit_id for g in grants if g.unit_id],
            [g.bed_id for g in grants if g.bed_id],
            own)


async def break_glass_in_tenant(session, user_id, tenant_id) -> list[str]:
    """Open break-glass patients of this user, restricted to one tenant (session and patient)."""
    from datetime import datetime, timezone

    from sqlalchemy import select

    from homunculus.admission.models import Patient
    from homunculus.escalation.models import BreakGlassSession

    now = datetime.now(timezone.utc)
    result = await session.execute(
        select(Patient.his_patient_reference)
        .select_from(BreakGlassSession)
        .join(Patient, BreakGlassSession.patient_id == Patient.id)
        .where(
            BreakGlassSession.user_id == user_id,
            BreakGlassSession.tenant_id == tenant_id,
            Patient.tenant_id == tenant_id,
            BreakGlassSession.expires_at > now,
            BreakGlassSession.closed_at.is_(None),
        )
    )
    return [row[0] for row in result.all() if row[0]]


async def break_glass_patient_ids(user_id: str, tenant_slug: str) -> list[str]:
    """The patients this user currently holds an open break-glass session for, in one tenant.

    Break-glass is already reason-bound and audited (§3.5). What it grants is access to the
    patient the reason was written about — so this returns those patients, in the identifier the
    board uses, and not a boolean that would open the ward.

    An expired or closed session grants nothing: the 30-minute box is the whole point of it.
    An unknown or inactive tenant slug yields [].
    """
    import uuid

    from sqlalchemy import select

    from homunculus.db import AsyncSessionLocal
    from homunculus.tenant.models import Tenant

    async with AsyncSessionLocal() as session:
        tenant_id = (await session.execute(
            select(Tenant.id).where(Tenant.slug == tenant_slug, Tenant.is_active.is_(True))
        )).scalar_one_or_none()
        if tenant_id is None:
            return []
        return await break_glass_in_tenant(session, uuid.UUID(user_id), tenant_id)


__all__ = ["UNKNOWN", "ScopeReason", "break_glass_patient_ids", "decode_access_credential",
           "enforce_unassigned_default",
           "make_scope_resolver", "read_scope_for_user"]

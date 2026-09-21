"""Turning a credential into a scope.

Built the same way `make_jwt_hospital_resolver` is, and for the same reason: the decision —
what to do with a token that does not decode, with a user the database does not know, with a
database that is not answering — is testable here with neither Postgres nor a signing key. Only
the reader functions passed in touch either.
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
    read_scope: Callable[[str], Awaitable[tuple[str | None, list[str], list[str], list[str]]]],
    *,
    decode: Callable[[str], str | None],
    break_glass: Callable[[str], Awaitable[list[str]]] | None = None,
    enforce_unassigned: Callable[[], bool] = enforce_unassigned_default,
) -> Callable[[str], Awaitable[Scope]]:
    """Build the `resolve_scope` hook `create_app` calls for each credential.

    `read_scope` returns `(role, unit_ids, bed_ids, own_patient_ids)` for a user id.
    `break_glass` returns the patients that user currently holds an open emergency session for —
    a list, not a flag, because a session is opened about one patient with a reason written
    about that patient. Without it wired, break-glass widens nothing here: a deployment that has
    not connected it gets no silent grant.
    """

    async def resolve(credential: str) -> Scope:
        user_id = decode(credential)
        if user_id is None:
            # Not an error path worth a stack trace: an expired access token reaches this line
            # on every ward, all day. It is also not a reason to open the board.
            return UNKNOWN
        try:
            role, unit_ids, bed_ids, own = await read_scope(user_id)
            emergency = list(await break_glass(user_id)) if break_glass else []
        except Exception:
            # A database that is not answering must not be read as "this user has no
            # restrictions". The board goes dark and the log says why — the opposite failure
            # hands a whole hospital's patients to whoever is logged in when Postgres blinks.
            logger.exception("scope lookup failed for user %s; refusing rather than widening",
                             user_id)
            return UNKNOWN
        return build_scope(
            role, unit_ids=unit_ids, bed_ids=bed_ids, own_patient_ids=own,
            break_glass_patient_ids=emergency, enforce_unassigned=enforce_unassigned(),
        )

    return resolve


async def read_scope_for_user(user_id: str) -> tuple[str | None, list[str], list[str], list[str]]:
    """The real reader: one database session, four answers.

    Kept in one session so a board request costs one connection rather than four, and so the
    four answers describe the same instant — a scope assembled from reads a second apart could
    revoke a unit and keep the patients on it.
    """
    import uuid

    from homunculus.db import AsyncSessionLocal
    from homunculus.scope import service

    uid = uuid.UUID(user_id)
    async with AsyncSessionLocal() as session:
        grants = await service.read_grants(session, uid)
        role = await service.read_role(session, uid)
        own = await service.read_own_patient_ids(session, uid)
    return (role,
            [g.unit_id for g in grants if g.unit_id],
            [g.bed_id for g in grants if g.bed_id],
            own)


async def break_glass_patient_ids(user_id: str) -> list[str]:
    """The patients this user currently holds an open break-glass session for.

    Break-glass is already reason-bound and audited (§3.5). What it grants is access to the
    patient the reason was written about — so this returns those patients, in the identifier the
    board uses, and not a boolean that would open the ward.

    An expired or closed session grants nothing: the 30-minute box is the whole point of it.
    """
    import uuid
    from datetime import datetime, timezone

    from sqlalchemy import select

    from homunculus.admission.models import Patient
    from homunculus.db import AsyncSessionLocal
    from homunculus.escalation.models import BreakGlassSession

    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Patient.his_patient_reference)
            .select_from(BreakGlassSession)
            .join(Patient, BreakGlassSession.patient_id == Patient.id)
            .where(
                BreakGlassSession.user_id == uuid.UUID(user_id),
                BreakGlassSession.expires_at > now,
                BreakGlassSession.closed_at.is_(None),
            )
        )
        return [row[0] for row in result.all() if row[0]]


__all__ = ["UNKNOWN", "ScopeReason", "break_glass_patient_ids", "enforce_unassigned_default",
           "make_scope_resolver", "read_scope_for_user"]

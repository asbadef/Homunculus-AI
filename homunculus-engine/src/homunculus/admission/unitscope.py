# homunculus-engine/src/homunculus/admission/unitscope.py
"""Which beds a caller may act on — the admission, discharge and bed routes (Group 2 · B1a, §4.5).

The board's scope (`homunculus.scope`) decides which CARDS a clinician sees; the same grants decide
here which BEDS she may admit into, discharge from or release: the target bed's unit against her
unit grants, the bed itself against her bed grants. An unrestricted caller (an administrator, or
an unassigned one while `SCOPE_ENFORCE_UNASSIGNED` is off — the pilot's state) passes. A caller
whose scope cannot be read (no active membership) reaches nothing.

Own patients (care team) widen what she SEES on the board, not where she may admit: an admission
is about a bed, and a bed belongs to a unit.

Since B1a the grants name tenant UUIDs (spec D9): the unit and bed ids of our own structure, as
`GET /tenant/structure` gives them to the scope editor. Compared case-insensitively, as the board
compares them (`scope.normalise_id`).
"""
from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission.errors import OUT_OF_SCOPE, Refusal
from homunculus.scope import Scope, build_scope, normalise_id
from homunculus.scope import service as scope_service
from homunculus.scope.resolver import UNKNOWN, enforce_unassigned_default


async def caller_scope(db: AsyncSession, user_id: uuid.UUID, tenant_id: uuid.UUID) -> Scope:
    """The caller's scope in this tenant, read the way the board's resolver reads it."""
    role = await scope_service.read_role(db, user_id, tenant_id)
    if role is None:
        return UNKNOWN
    grants = await scope_service.read_grants(db, user_id, tenant_id)
    return build_scope(role, unit_ids=[g.unit_id for g in grants if g.unit_id],
                       bed_ids=[g.bed_id for g in grants if g.bed_id],
                       enforce_unassigned=enforce_unassigned_default())


def reaches(scope: Scope, *, unit_id: uuid.UUID | str, bed_id: uuid.UUID | str) -> bool:
    """Whether this scope reaches this bed: unrestricted, its unit granted, or the bed itself."""
    if scope.unrestricted:
        return True
    return (normalise_id(str(bed_id)) in scope.bed_ids
            or normalise_id(str(unit_id)) in scope.unit_ids)


def require_reach(scope: Scope, *, unit_id: uuid.UUID | str, bed_id: uuid.UUID | str) -> None:
    """403 `out_of_scope` unless the scope reaches the bed. Not a 404: the caller picked the bed
    from a structure already narrowed to her units, so she knows it exists."""
    if not reaches(scope, unit_id=unit_id, bed_id=bed_id):
        raise Refusal(403, OUT_OF_SCOPE, "This bed is not in one of your units.")

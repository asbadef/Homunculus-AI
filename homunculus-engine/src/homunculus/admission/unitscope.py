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

What these functions compare is ids; nothing here looks a bed up. The caller must already have
PROVEN the bed to be in the caller's own tenant, from the database, and passes that bed's room's
unit (`Bed → Room.unit_id`) — never a unit id read from the request body. A grant is only text, so
an id that was not first tied to this tenant proves nothing.

A missing id (`None`: a bed whose unit could not be resolved) matches no grant. It is never turned
into the text "none", a name a grant may well hold, and so never reaches by accident.
"""
from __future__ import annotations

import uuid

from sqlalchemy import ColumnElement, or_
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


def _key(value: uuid.UUID | str | None) -> str | None:
    """An id as the scope holds it, or None for a missing one: never `str(None)`."""
    return None if value is None else normalise_id(str(value))


def reaches(scope: Scope, *, unit_id: uuid.UUID | str | None,
            bed_id: uuid.UUID | str | None) -> bool:
    """Whether this scope reaches this bed: unrestricted, its unit granted, or the bed itself.
    The ids must already be proven this tenant's (see the module's docstring); a missing one
    matches nothing."""
    if scope.unrestricted:
        return True
    bed, unit = _key(bed_id), _key(unit_id)
    return ((bed is not None and bed in scope.bed_ids)
            or (unit is not None and unit in scope.unit_ids))


def _grant_uuids(keys: frozenset[str]) -> list[uuid.UUID]:
    """The grants that name a row of ours: a key equal to a UUID's own text (the scope holds keys
    trimmed and case-folded). Any other key — an old free-text one — names no unit or bed here,
    exactly as it matches none in `reaches`."""
    found = []
    for key in keys:
        try:
            value = uuid.UUID(key)
        except ValueError:
            continue
        if str(value) == key:
            found.append(value)
    return found


def reach_clause(scope: Scope, *, unit_id: ColumnElement,
                 bed_id: ColumnElement) -> ColumnElement | None:
    """`reaches` as SQL over a query's unit and bed id columns, so a list is filtered by the
    database rather than after it: None when the scope is unrestricted (no filter), else "the
    unit granted, or the bed itself" — false for a scope that grants neither. The columns must be
    the bed's own id and its room's unit (see the module's docstring)."""
    if scope.unrestricted:
        return None
    return or_(unit_id.in_(_grant_uuids(scope.unit_ids)), bed_id.in_(_grant_uuids(scope.bed_ids)))


def require_reach(scope: Scope, *, unit_id: uuid.UUID | str | None,
                  bed_id: uuid.UUID | str | None) -> None:
    """403 `out_of_scope` unless the scope reaches the bed. Not a 404: the caller picked the bed
    from a structure already narrowed to her units, so she knows it exists."""
    if not reaches(scope, unit_id=unit_id, bed_id=bed_id):
        raise Refusal(403, OUT_OF_SCOPE, "This bed is not in one of your units.")

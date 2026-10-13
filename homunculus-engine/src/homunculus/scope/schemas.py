"""Request and response shapes for the scope API."""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ScopeGrantIn(BaseModel):
    """One grant. Exactly one of the two ids carries a value — see `StaffScope`."""

    unit_id: str = ""
    bed_id: str = ""

    @model_validator(mode="after")
    def _exactly_one(self) -> ScopeGrantIn:
        unit, bed = self.unit_id.strip(), self.bed_id.strip()
        if bool(unit) == bool(bed):
            # Rejected rather than guessed. A grant naming both is ambiguous and a grant naming
            # neither reads as access while granting nothing — the second is the dangerous one,
            # because an administrator would believe the door was opened.
            raise ValueError("bir atama ya bir ünite ya bir yatak belirtir, ikisi birden değil")
        return self


class ScopeGrantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    unit_id: str
    bed_id: str
    is_active: bool
    granted_by_id: uuid.UUID | None
    created_at: datetime
    revoked_at: datetime | None


class ScopeAssignment(BaseModel):
    """The whole of one user's scope, replaced in a single call.

    Replacement rather than add/remove: an administrator looking at a form is deciding what this
    person's access *is*, not issuing a diff. Two admins editing concurrently with a diff API
    would silently merge into a union — the strictly more permissive outcome, arrived at by
    nobody.

    A replacement built from an out-of-date read has the opposite fault: it silently revokes
    whatever another administrator granted since. So the body may also say what the screen READ
    (`expected_grants`), and the route compares it with what it holds before writing (see
    `scope.router.put_scope`).
    """

    grants: list[ScopeGrantIn] = Field(default_factory=list)
    # The grants the caller's screen read and built `grants` from — the third whole-set write's
    # compare-and-swap, the same contract as `GroupPatch.expected_permissions` and
    # `UserGroupsIn.expected_group_ids` (Task 14e). Compared as a SET of (unit, bed) pairs, each
    # stripped as the server stores it; not the same set → 409 CONCURRENT_CHANGE, nothing written.
    # None (absent): the caller states no expectation — the write as it always was. An EMPTY list
    # is a real expectation, "this user holds no grant", and is compared like any other.
    expected_grants: list[ScopeGrantIn] | None = None


class ScopeView(BaseModel):
    """What a user's scope currently is, and what it resolves to."""

    user_id: uuid.UUID
    role: str | None = None
    unrestricted: bool
    reason: str
    unit_ids: list[str]
    bed_ids: list[str]
    grants: list[ScopeGrantOut]
    # How many patients this scope reaches by NAME rather than by unit or bed — the care-team
    # patients plus any open break-glass session's. A COUNT, not the ids: this route carries no
    # patient identifier (PHI rule in the router's docstring), and the count is what lets a reader
    # of `/scope/me` — and the test that holds it to the board — see that a break-glass grant is
    # in the scope at all. The same figure `Scope.as_dict()` publishes on the board's own `scope`.
    own_patients: int = 0

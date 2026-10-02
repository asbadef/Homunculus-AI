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
    """

    grants: list[ScopeGrantIn] = Field(default_factory=list)


class ScopeView(BaseModel):
    """What a user's scope currently is, and what it resolves to."""

    user_id: uuid.UUID
    role: str | None = None
    unrestricted: bool
    reason: str
    unit_ids: list[str]
    bed_ids: list[str]
    grants: list[ScopeGrantOut]

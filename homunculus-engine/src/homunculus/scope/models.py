"""The staff-scope table: which units and beds a user may see.

**Why the ids are text and not foreign keys.** A scope row names a unit or a bed *as the bed
map names it*. That table (`bed-mapping.json`) is written by hand at each site and is the only
thing joining the hospital's own naming of a location to ours; the board publishes exactly
those strings. A `ForeignKey("beds.id")` would instead demand a row in our hierarchy, and where
a site's map carries a key our tables have no row for, every scope built on it would match
nothing — and a nurse whose scope matches nothing sees an empty ward. Constraining the column
would not prevent that mismatch; it would only move it from a report into a nurse's board. So
the column takes what the map says, and `apply_scope` counts and names the grants nothing
matched, the same way `BedMap` counts locations it could not resolve and `edge/bridge.py`
counts OBX codes it could not map. Blindness gets a counter, not a constraint.

**Why rows and not a JSON column.** One row per grant is what makes "who can see unit X" a
query rather than a scan, and what lets `granted_by_id` and `created_at` say who opened each
door and when — which is the question an inspection asks.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from homunculus.db import Base


class StaffScope(Base):
    """One grant: this user may see this unit, or this single bed.

    Exactly one of `unit_id` / `bed_id` carries a value. A row with both would be ambiguous
    (does the bed narrow the unit, or add to it?) and a row with neither grants nothing while
    looking like it grants something — the check constraint refuses both.
    """

    __tablename__ = "staff_scopes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # As the site's bed map names them. See the module docstring.
    unit_id: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    bed_id: Mapped[str] = mapped_column(String(100), nullable=False, default="")

    # Revoking sets this False rather than deleting the row: "this doctor's access to the NICU
    # was removed on the 14th" is itself a fact an inspection can ask about, and a deleted row
    # cannot answer it.
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    granted_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint(
            "(unit_id <> '' AND bed_id = '') OR (unit_id = '' AND bed_id <> '')",
            name="ck_staff_scope_exactly_one_target",
        ),
        Index("ix_staff_scopes_user_active", "user_id", "is_active"),
    )

    @property
    def target(self) -> str:
        return self.unit_id or self.bed_id

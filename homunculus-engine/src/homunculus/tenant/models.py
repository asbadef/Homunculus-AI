"""
Tenant → Site → Unit → Room → Bed hierarchy.
Design doc §1.1 – §1.3.

PHI RULE: No real patient data in this module. One column may hold a patient's name all the same:
`beds.state_note` (G2-B3a), a reservation's "for whom" — encrypted at rest like every name.
CLINICAL RULE: This module is infrastructure — no clinical logic here.
"""
from __future__ import annotations
import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, CheckConstraint, DateTime, Enum, ForeignKey,
    Integer, String, Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from homunculus.crypto import EncryptedString
from homunculus.db import Base


class UnitType(str, enum.Enum):
    """§1.2 — Supported unit types."""
    ADULT_ICU = "ADULT_ICU"   # MVP Phase 1 target
    NICU = "NICU"              # MVP Phase 1 target (Neonatal ICU)
    PICU = "PICU"              # Phase 2
    CVICU = "CVICU"            # Phase 2
    BMT_ICU = "BMT_ICU"        # Phase 2


class BedState(str, enum.Enum):
    """§1.3 — Bed lifecycle states."""
    AVAILABLE = "AVAILABLE"
    OCCUPIED = "OCCUPIED"
    PENDING_DISCHARGE = "PENDING_DISCHARGE"
    PENDING_TRANSFER_OUT = "PENDING_TRANSFER_OUT"
    HOUSEKEEPING = "HOUSEKEEPING"
    MAINTENANCE = "MAINTENANCE"
    BLOCKED = "BLOCKED"          # G2-B3a: shown as «Kullanım dışı», always with a reason (D4)
    # G2-B3a (spec §4, D5): held for an expected patient; only an admission that confirms it takes it.
    RESERVED = "RESERVED"


class BedStateReason(str, enum.Enum):
    """G2-B3a (spec §4, D4): why a bed is out of service (BLOCKED). Stored as text and checked by
    `ck_beds_state_reason`: a fifth reason is a migration, not a typo that reaches the ward."""
    FAULT = "FAULT"
    ISOLATION_CLEANING = "ISOLATION_CLEANING"
    STAFFING = "STAFFING"
    OTHER = "OTHER"


#: G2-B3a (R8): the ciphertext of a 200-character note, four-byte letters included. The width
#: admission/models.py PHI_COLUMN_LENGTH gives every encrypted text; not imported from there, so
#: that the structure's models do not depend on the admission's.
STATE_NOTE_COLUMN_LENGTH = 1536


# Valid transitions for BedState (§1.3). G2-B3a: a free bed is reserved or taken out of service,
# and only a free one (spec §4).
BED_STATE_TRANSITIONS: dict[BedState, set[BedState]] = {
    BedState.AVAILABLE: {BedState.OCCUPIED, BedState.RESERVED, BedState.BLOCKED},
    BedState.OCCUPIED: {BedState.PENDING_DISCHARGE, BedState.PENDING_TRANSFER_OUT},
    BedState.PENDING_DISCHARGE: {BedState.OCCUPIED, BedState.HOUSEKEEPING},
    BedState.PENDING_TRANSFER_OUT: {BedState.OCCUPIED, BedState.HOUSEKEEPING},
    BedState.HOUSEKEEPING: {BedState.MAINTENANCE, BedState.AVAILABLE},
    BedState.MAINTENANCE: {BedState.AVAILABLE},
    BedState.BLOCKED: {BedState.AVAILABLE},
    BedState.RESERVED: {BedState.AVAILABLE, BedState.OCCUPIED},
}


class Tenant(Base):
    """One paying customer contract = one tenant."""
    __tablename__ = "tenants"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    country_code: Mapped[str] = mapped_column(String(2), nullable=False)  # ISO 3166-1 alpha-2
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="UTC")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    sites: Mapped[list[Site]] = relationship("Site", back_populates="tenant", cascade="all, delete-orphan")


class Site(Base):
    """Building or campus belonging to a Tenant."""
    __tablename__ = "sites"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    tenant: Mapped[Tenant] = relationship("Tenant", back_populates="sites")
    units: Mapped[list[Unit]] = relationship("Unit", back_populates="site", cascade="all, delete-orphan")


class Unit(Base):
    """ICU unit — type determines alert engine rule set."""
    __tablename__ = "units"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    site_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    unit_type: Mapped[UnitType] = mapped_column(Enum(UnitType), nullable=False)
    # Max beds per nurse (soft warning threshold — §S-25)
    max_beds_per_nurse: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    site: Mapped[Site] = relationship("Site", back_populates="units")
    rooms: Mapped[list[Room]] = relationship("Room", back_populates="unit", cascade="all, delete-orphan")


class Room(Base):
    """Physical room within a unit."""
    __tablename__ = "rooms"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    unit_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("units.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    room_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Isolation room flag (relevant for BMT_ICU)
    is_isolation: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    unit: Mapped[Unit] = relationship("Unit", back_populates="rooms")
    beds: Mapped[list[Bed]] = relationship("Bed", back_populates="room", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("unit_id", "name", name="uq_room_name_per_unit"),
    )


class Bed(Base):
    """
    Individual bed with lifecycle state machine (§1.3).
    A Bed can have at most one ACTIVE Admission at any time (enforced in Admission model).
    """
    __tablename__ = "beds"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    label: Mapped[str] = mapped_column(String(50), nullable=False)  # e.g. "4A", "ICU-01"
    state: Mapped[BedState] = mapped_column(
        Enum(BedState), nullable=False, default=BedState.AVAILABLE
    )
    state_updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    # External device identifiers (for MDI Adapter binding)
    device_location_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    # Group 2 · B1a: a closed bed is kept (nothing is deleted) and offered to no admission. Only a
    # bed that holds no patient may be closed (tenant/router.py PATCH /tenant/beds/{id}).
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # G2-B3a (spec §4, R8): the out-of-service reason (BLOCKED only) and the reservation's or the
    # out-of-service note. Both belong to the state they were written with: every transition
    # clears them (`transition_to`), and the route that enters RESERVED or BLOCKED sets them after
    # it. The note may name the expected patient, so it is encrypted at rest like a patient's name.
    state_reason: Mapped[str | None] = mapped_column(String(20), nullable=True)
    state_note: Mapped[str | None] = mapped_column(EncryptedString(STATE_NOTE_COLUMN_LENGTH),
                                                   nullable=True)

    room: Mapped[Room] = relationship("Room", back_populates="beds")

    __table_args__ = (
        UniqueConstraint("room_id", "label", name="uq_bed_label_per_room"),
        # G2-B3a: the same text as migration 0016's CHECK.
        CheckConstraint("state_reason IS NULL OR state_reason IN "
                        "('FAULT', 'ISOLATION_CLEANING', 'STAFFING', 'OTHER')",
                        name="ck_beds_state_reason"),
    )

    def transition_to(self, new_state: BedState) -> None:
        """Validate and apply bed state transition."""
        allowed = BED_STATE_TRANSITIONS.get(self.state, set())
        if new_state not in allowed:
            raise ValueError(
                f"Bed state transition {self.state} → {new_state} is not permitted. "
                f"Allowed: {allowed}"
            )
        self.state = new_state
        self.state_updated_at = datetime.now(timezone.utc)
        # G2-B3a (R8): the reason and the note were the state's that is left behind.
        self.state_reason = None
        self.state_note = None

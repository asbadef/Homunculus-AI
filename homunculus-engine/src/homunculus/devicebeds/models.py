# homunculus-engine/src/homunculus/devicebeds/models.py
"""`device_beds` (migration 0014): which monitor sits at which bed, per tenant, for ever. A change
closes the current row (`valid_to`) and opens a new one; a trigger refuses deletes and every edit but
that close. `bed_label` is the strip's label (`Row.bed_label`, NULL = unbound); `device_bed_label` is
what the central station calls the monitor (spec D14). `verified_at` is text: v2's date as written,
or an editor row's UTC ISO time (D21). PHI RULE: no patient data."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from homunculus.db import Base


class DeviceBed(Base):
    __tablename__ = "device_beds"
    __table_args__ = (
        CheckConstraint("valid_to IS NULL OR valid_to > valid_from", name="ck_device_beds_interval"),
        CheckConstraint("(bed_id IS NULL) = (unit_id IS NULL)", name="ck_device_beds_bed_unit"),
        CheckConstraint("bed_id IS NULL OR bed_label IS NOT NULL", name="ck_device_beds_bound_label"),
        Index("uq_device_beds_current_source", "tenant_id", "source", unique=True,
              postgresql_where=text("valid_to IS NULL")),
        Index("uq_device_beds_current_bed", "tenant_id", "bed_id", unique=True,
              postgresql_where=text("valid_to IS NULL AND bed_id IS NOT NULL")),
        Index("ix_device_beds_tenant_source", "tenant_id", "source", "valid_from"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    source: Mapped[str] = mapped_column(String(45), nullable=False)
    group_address: Mapped[str] = mapped_column(String(45), nullable=False)
    port: Mapped[int] = mapped_column(Integer, nullable=False)
    device_bed_label: Mapped[str | None] = mapped_column(String(32))
    bed_label: Mapped[str | None] = mapped_column(String(50))
    bed_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("beds.id"))
    unit_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("units.id"))
    method: Mapped[str | None] = mapped_column(String(32))
    # v2's imported strings are kept as they are; an editor row writes full ISO-8601 UTC (O9, D21)
    verified_at: Mapped[str | None] = mapped_column(String(40))
    verified_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    note: Mapped[str | None] = mapped_column(String(500))
    valid_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    valid_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    approved_by: Mapped[str] = mapped_column(String(128), nullable=False)
    approved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

"""
User, UserRole, and TenantMembership models.

PHI RULE: No real patient data. This file contains only identity/auth data.
CLINICAL RULE: System states criteria met — never diagnoses.
"""
from __future__ import annotations
import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from homunculus.db import Base


class UserRole(str, enum.Enum):
    """
    10-role catalogue per design doc §2.
    Grant principle: no role can grant a role equal to or higher than its own.
    HOSPITAL_ADMIN is the ceiling for customer-side grants.
    PLATFORM_SUPPORT is granted exclusively by vendor's internal identity system.
    """
    ATTENDING = "ATTENDING"
    ASSOCIATE_PHYSICIAN = "ASSOCIATE_PHYSICIAN"
    ONCALL_PHYSICIAN = "ONCALL_PHYSICIAN"
    UNIT_PHYSICIAN = "UNIT_PHYSICIAN"
    CHARGE_NURSE = "CHARGE_NURSE"
    NURSE = "NURSE"
    RAPID_RESPONSE = "RAPID_RESPONSE"
    HOSPITAL_ADMIN = "HOSPITAL_ADMIN"
    AUDITOR = "AUDITOR"
    PLATFORM_SUPPORT = "PLATFORM_SUPPORT"
    # Both exist on the dashboard and did not exist here, so no real account could hold either:
    # the pharmacist and the biomedical engineer could be drawn on a screen but never signed in
    # as. The device page in particular is unreachable without BIOMEDICAL.
    PHARMACIST = "PHARMACIST"
    BIOMEDICAL = "BIOMEDICAL"


# Roles that REQUIRE TOTP MFA (S-21)
MFA_REQUIRED_ROLES = {
    UserRole.HOSPITAL_ADMIN,
    UserRole.ATTENDING,
    UserRole.UNIT_PHYSICIAN,
    UserRole.PLATFORM_SUPPORT,
}


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(String(254), unique=True, nullable=False, index=True)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    # Bcrypt hash — never store plaintext
    hashed_password: Mapped[str] = mapped_column(String(72), nullable=False)
    # TOTP secret (Base32, stored encrypted at rest via column-level Fernet in service layer)
    totp_secret: Mapped[str | None] = mapped_column(String(64), nullable=True)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Vendor-side staff flag — extra audit controls
    is_platform_support: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    memberships: Mapped[list[TenantMembership]] = relationship(
        "TenantMembership",
        back_populates="user",
        cascade="all, delete-orphan",
        foreign_keys="TenantMembership.user_id",
    )


class TenantMembership(Base):
    """
    Links a User to a Tenant with a primary role.
    A user can hold memberships in multiple tenants (e.g. PLATFORM_SUPPORT).
    Dimension B (unit membership) is stored at the unit level in the tenant module.
    """
    __tablename__ = "tenant_memberships"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), nullable=False)
    granted_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    user: Mapped[User] = relationship("User", foreign_keys=[user_id], back_populates="memberships")

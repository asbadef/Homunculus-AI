"""
PermissionGrant and PermissionEffect — action-level permission model.

PHI RULE: No patient data here. CLINICAL RULE: system states criteria — never diagnoses.

A permission is scoped to a tenant (hospital). It targets EITHER a ROLE (applies to
everyone holding that role in the tenant) OR a specific USER (an allow/deny exception).
Resolution (see permissions/service.py): user-DENY > user-ALLOW > role-ALLOW; no match
=> denied (fail-closed).
"""
from __future__ import annotations
import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, CheckConstraint, DateTime, Enum, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from homunculus.auth.models import UserRole
from homunculus.db import Base


class PermissionEffect(str, enum.Enum):
    ALLOW = "allow"
    DENY = "deny"


class PermissionGrant(Base):
    __tablename__ = "permission_grants"
    __table_args__ = (
        # Tam olarak biri dolu olmalı: ya rol izni ya kullanıcı istisnası.
        CheckConstraint(
            "(CASE WHEN role IS NOT NULL THEN 1 ELSE 0 END) "
            "+ (CASE WHEN user_id IS NOT NULL THEN 1 ELSE 0 END) = 1",
            name="ck_permission_grants_role_xor_user",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # Rol izni: role dolu, user_id boş. Kullanıcı istisnası: user_id dolu, role boş.
    role: Mapped[UserRole | None] = mapped_column(Enum(UserRole), nullable=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    # "allow" | "deny" (PermissionEffect degeri)
    effect: Mapped[str] = mapped_column(String(8), nullable=False)
    granted_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

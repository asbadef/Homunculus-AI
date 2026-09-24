"""
Identity tables: users, tenant memberships, groups, group permissions, user–group links, and the
LDAP group mapping (used by Plan 2).

A user's rights come from the groups they hold in a tenant; the permission catalogue is in
`auth/permissions.py`. `tenant_memberships.role` is a legacy column: nullable, never written,
kept only so the PostgreSQL enum type can be dropped in a later cleanup migration.

PHI RULE: No real patient data. This file contains only identity/auth data.
CLINICAL RULE: System states criteria met — never diagnoses.
"""
from __future__ import annotations
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, false,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from homunculus.db import Base

AUTH_LOCAL = "local"
AUTH_LDAP = "ldap"
SOURCE_MANUAL = "manual"
SOURCE_LDAP = "ldap"


def _now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # Sign-in identifier. Stored lower-case (see auth.service.normalize_login); for a local
    # account it is the e-mail, for an AD account the sAMAccountName.
    username: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    # Optional: AD accounts do not always carry `mail`. Stored lower-case.
    email: Mapped[str | None] = mapped_column(String(254), unique=True, nullable=True, index=True)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    # Bcrypt hash — never plaintext. NULL for an AD account: a local sign-in against NULL fails.
    hashed_password: Mapped[str | None] = mapped_column(String(72), nullable=True)
    auth_source: Mapped[str] = mapped_column(
        String(16), nullable=False, default=AUTH_LOCAL, server_default=AUTH_LOCAL
    )
    # AD objectGUID — stable across renames and OU moves (Plan 2).
    external_id: Mapped[str | None] = mapped_column(
        String(64), unique=True, nullable=True, index=True
    )
    ldap_dn: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Incremented whenever the user's rights change; an access token whose `tv` claim differs
    # is refused, and the client's transparent refresh mints one with the current rights.
    token_version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # TOTP secret (Base32)
    totp_secret: Mapped[str | None] = mapped_column(String(64), nullable=True)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Vendor-side staff flag — extra audit controls
    is_platform_support: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

    memberships: Mapped[list[TenantMembership]] = relationship(
        "TenantMembership",
        back_populates="user",
        cascade="all, delete-orphan",
        foreign_keys="TenantMembership.user_id",
    )
    group_links: Mapped[list[UserGroup]] = relationship(
        "UserGroup",
        back_populates="user",
        cascade="all, delete-orphan",
        foreign_keys="UserGroup.user_id",
        lazy="raise",
        passive_deletes=True,
    )


class TenantMembership(Base):
    """Links a User to a Tenant. Rights come from `user_groups`, not from `role`."""
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
    # LEGACY. In PostgreSQL this column is still the `userrole` enum type; the ORM reads it as
    # text and never writes it. Dropped in a later cleanup migration.
    role: Mapped[str | None] = mapped_column(String(40), nullable=True)
    granted_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    user: Mapped[User] = relationship("User", foreign_keys=[user_id], back_populates="memberships")


class Group(Base):
    """An administrator-defined group in one tenant, carrying a set of permission keys."""
    __tablename__ = "groups"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    slug: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    mfa_required: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default=false()
    )
    # Only `hospital_admin`: cannot be deleted; holds the whole catalogue by rule.
    is_system: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default=false()
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

    permissions: Mapped[list[GroupPermission]] = relationship(
        "GroupPermission", back_populates="group", cascade="all, delete-orphan", lazy="selectin",
        passive_deletes=True,
    )

    __table_args__ = (UniqueConstraint("tenant_id", "slug", name="uq_groups_tenant_slug"),)

    @property
    def permission_keys(self) -> list[str]:
        return sorted(p.permission for p in self.permissions)


class GroupPermission(Base):
    __tablename__ = "group_permissions"

    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("groups.id", ondelete="CASCADE"), primary_key=True
    )
    permission: Mapped[str] = mapped_column(String(64), primary_key=True)

    group: Mapped[Group] = relationship("Group", back_populates="permissions")


class UserGroup(Base):
    """A user's membership in a group. `source` says who put them there: an administrator
    (`manual`) or the AD group mapping (`ldap`); the LDAP sync only ever touches its own rows."""
    __tablename__ = "user_groups"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("groups.id", ondelete="CASCADE"), primary_key=True,
        index=True,
    )
    source: Mapped[str] = mapped_column(
        String(16), nullable=False, default=SOURCE_MANUAL, server_default=SOURCE_MANUAL
    )
    granted_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    user: Mapped[User] = relationship(
        "User", foreign_keys=[user_id], back_populates="group_links", lazy="raise",
    )
    group: Mapped[Group] = relationship("Group", lazy="selectin")


class LdapGroupMapping(Base):
    """AD group DN (stored lower-case) -> Homunculus group. Written and read in Plan 2."""
    __tablename__ = "ldap_group_mappings"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    ad_group_dn: Mapped[str] = mapped_column(Text, nullable=False)
    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("groups.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    __table_args__ = (
        UniqueConstraint("tenant_id", "ad_group_dn", "group_id", name="uq_ldap_mapping"),
    )

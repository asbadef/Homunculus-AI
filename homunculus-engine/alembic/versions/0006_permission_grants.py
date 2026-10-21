"""permission grants

Action-level permissions (role-based ALLOW or per-user ALLOW/DENY exceptions),
tenant-scoped. Enforced in permissions/service.py; writes to security_audit.

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-21

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# userrole enum tipi 0001'de yaratıldı; burada yeniden yaratmadan kullan.
user_role_enum = postgresql.ENUM(
    "ATTENDING", "ASSOCIATE_PHYSICIAN", "ONCALL_PHYSICIAN", "UNIT_PHYSICIAN",
    "CHARGE_NURSE", "NURSE", "RAPID_RESPONSE", "HOSPITAL_ADMIN", "AUDITOR",
    "PLATFORM_SUPPORT", name="userrole", create_type=False,
)


def upgrade() -> None:
    op.create_table(
        "permission_grants",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("role", user_role_enum, nullable=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
        sa.Column("effect", sa.String(8), nullable=False),
        sa.Column("granted_by_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.CheckConstraint(
            "(CASE WHEN role IS NOT NULL THEN 1 ELSE 0 END) "
            "+ (CASE WHEN user_id IS NOT NULL THEN 1 ELSE 0 END) = 1",
            name="ck_permission_grants_role_xor_user",
        ),
    )
    op.create_index("ix_permission_grants_tenant_id", "permission_grants", ["tenant_id"])
    op.create_index("ix_permission_grants_action", "permission_grants", ["action"])
    op.create_index("ix_permission_grants_user_id", "permission_grants", ["user_id"])


def downgrade() -> None:
    op.drop_table("permission_grants")

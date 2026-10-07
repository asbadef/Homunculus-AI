"""security audit events

Append-only trail of security-relevant actions (alert handling, break-glass), including denied
attempts (O2). Internal ids and minimal detail only — no patient-identifying data.

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-07

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "security_audit_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("resource_type", sa.String(32), nullable=False),
        sa.Column("resource_id", sa.String(64), nullable=True),
        sa.Column("outcome", sa.String(16), nullable=False),
        sa.Column("detail", postgresql.JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
    )
    op.create_index("ix_security_audit_tenant_id", "security_audit_events", ["tenant_id"])
    op.create_index("ix_security_audit_user_id", "security_audit_events", ["user_id"])
    op.create_index("ix_security_audit_action", "security_audit_events", ["action"])
    op.create_index("ix_security_audit_created_at", "security_audit_events", ["created_at"])


def downgrade() -> None:
    op.drop_table("security_audit_events")

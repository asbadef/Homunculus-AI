"""
Security audit trail (O2): who did what to which record, and whether it was allowed.

Rows carry internal ids and a minimal `detail` (reason codes, ids) — never patient-identifying data or
free-text clinical notes. Denied attempts are recorded as well as allowed ones. The trail is append-only
from the application's point of view (there is no update/delete path).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from homunculus.db import Base


class SecurityAuditEvent(Base):
    __tablename__ = "security_audit_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Hospital that owns the touched record (not the caller's), so a hospital can review its own trail.
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    resource_type: Mapped[str] = mapped_column(String(32), nullable=False)
    resource_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    outcome: Mapped[str] = mapped_column(String(16), nullable=False)  # "allowed" | "denied"
    detail: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False, index=True
    )


async def record(
    db: AsyncSession, *, action: str, user_id: uuid.UUID | None, tenant_id: uuid.UUID | None,
    resource_type: str, resource_id: object | None, outcome: str, detail: dict | None = None,
    commit: bool = False,
) -> None:
    """Add an audit row. Pass commit=True on denial paths, where the request is about to raise and
    the session would otherwise roll the row back."""
    db.add(SecurityAuditEvent(
        action=action, user_id=user_id, tenant_id=tenant_id, resource_type=resource_type,
        resource_id=None if resource_id is None else str(resource_id), outcome=outcome, detail=detail,
    ))
    if commit:
        await db.commit()
    else:
        await db.flush()

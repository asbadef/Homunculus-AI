# homunculus-engine/src/homunculus/protocol/models.py
"""`protocol_settings` (migration 0015): per tenant, the next protocol number and the label.

* `next_no`      the number the next admission receives; NULL = not configured (spec D5): every
                 admission is refused `protocol_not_configured` until the administrator sets it.
* `last_issued`  the last number given out; NULL = none yet. `next_protocol_no` moves both in one
                 UPDATE inside the admission's transaction (protocol/numbers.py).
* the label      width and height in whole millimetres, the printer's resolution (203 or 300 dpi).

No patient data. The numbers are BIGINT; their text form is twelve zero-padded digits."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, SmallInteger, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from homunculus.db import Base

#: The printer resolutions a label is drawn for (spec D6, D10).
PRINTER_DPIS = (203, 300)


class ProtocolSettings(Base):
    __tablename__ = "protocol_settings"
    __table_args__ = (
        CheckConstraint("printer_dpi IN (203, 300)", name="ck_protocol_settings_dpi"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True)
    next_no: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    last_issued: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    label_width_mm: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=50,
                                                server_default=text("50"))
    label_height_mm: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=30,
                                                 server_default=text("30"))
    printer_dpi: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=203,
                                             server_default=text("203"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc),
        server_default=text("now()"))
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

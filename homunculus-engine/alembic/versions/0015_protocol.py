# homunculus-engine/alembic/versions/0015_protocol.py
"""G2-B1d (spec 2026-11-01 §3): `protocol_settings`, and `admissions.protocol_no`

Revision 0015, follows the editor's 0014 (device_beds).

* `protocol_settings`: one row per tenant (FK tenants ON DELETE CASCADE) — `next_no` and
  `last_issued` (BIGINT, NULL = not configured / none issued), `label_width_mm` 50,
  `label_height_mm` 30, `printer_dpi` 203 (CHECK 203 or 300), `updated_at`, `updated_by`. NO ROW
  is written: no admission is possible until the administrator sets the start number (D5).
* `admissions.protocol_no`: VARCHAR(12) NULL, CHECK twelve ASCII digits, and the partial unique
  index `uq_admissions_tenant_protocol` on (tenant_id, protocol_no) WHERE NOT NULL. Every row
  already written stays NULL: a legacy admission keeps its H-number key (D7).

PURELY ADDITIVE: an image from before this revision serves against it (it never reads the new
objects); only its start command's `alembic upgrade head` refuses the unknown revision.
Downgrade drops exactly this — and with it every protocol number issued (spec §11: clean only
before the first protocol admission).

Revision ID: 0015
Revises: 0014
Create Date: 2026-11-01
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0015"
down_revision: Union[str, None] = "0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "protocol_settings"
INDEX = "uq_admissions_tenant_protocol"
CHECK = "ck_admissions_protocol_no"


def upgrade() -> None:
    op.create_table(
        TABLE,
        sa.Column("tenant_id", UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("next_no", sa.BigInteger(), nullable=True),
        sa.Column("last_issued", sa.BigInteger(), nullable=True),
        sa.Column("label_width_mm", sa.SmallInteger(), nullable=False, server_default=sa.text("50")),
        sa.Column("label_height_mm", sa.SmallInteger(), nullable=False, server_default=sa.text("30")),
        sa.Column("printer_dpi", sa.SmallInteger(), nullable=False, server_default=sa.text("203")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_by", UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint("printer_dpi IN (203, 300)", name="ck_protocol_settings_dpi"),
    )
    op.add_column("admissions", sa.Column("protocol_no", sa.String(12), nullable=True))
    op.create_check_constraint(CHECK, "admissions", "protocol_no ~ '^[0-9]{12}$'")
    op.create_index(INDEX, "admissions", ["tenant_id", "protocol_no"], unique=True,
                    postgresql_where=sa.text("protocol_no IS NOT NULL"))


def downgrade() -> None:
    op.drop_index(INDEX, table_name="admissions")
    op.drop_constraint(CHECK, "admissions", type_="check")
    op.drop_column("admissions", "protocol_no")
    op.drop_table(TABLE)

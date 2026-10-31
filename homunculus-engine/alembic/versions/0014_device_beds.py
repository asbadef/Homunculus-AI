# homunculus-engine/alembic/versions/0014_device_beds.py
"""The monitor→bed editor (spec 2026-10-28 §5.1): `device_beds`, the per-tenant device→bed table

Revision 0014, follows 0013. PURELY ADDITIVE (spec D20, O11): one new table with its checks and
indexes, one function and three triggers; no existing table, column, index or row changes, and no
data is written — the v2 rows come from scripts/import_device_beds.py, which also grants
`devices.map_beds` to the charge nurses (not here). An image from before this revision can serve
against it; only its start command's `alembic upgrade head` refuses an unknown revision (§7.3).

* One current row per device (`uq_device_beds_current_source`) and per bed
  (`uq_device_beds_current_bed`): partial unique indexes over `valid_to IS NULL`.
* History kept (Lane A's A-8): `device_beds_history_kept()` refuses a DELETE, a TRUNCATE, and an
  UPDATE unless it only closes an open row, in the past: `valid_to` goes from NULL to a time not
  after the clock, and the rest of the row — compared as `to_jsonb`, so a column a later migration
  adds is covered without touching this function — is unchanged. `clock_timestamp()`, not `now()`:
  the app reads its time after the transaction began. OLD/NEW are read only inside the UPDATE
  branch (PL/pgSQL's AND does not short-circuit, and a statement trigger has no row). The pattern
  of 0004's audit.

ONE STATEMENT PER op.execute (asyncpg; see 0004, 0010, 0013). Downgrade drops exactly this.

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-30
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0014"
down_revision: Union[str, None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "device_beds"
CURRENT_SOURCE = "uq_device_beds_current_source"
CURRENT_BED = "uq_device_beds_current_bed"
HISTORY = "ix_device_beds_tenant_source"
_CREATE_FUNCTION = """CREATE OR REPLACE FUNCTION device_beds_history_kept() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.valid_to IS NULL AND NEW.valid_to IS NOT NULL
       AND NEW.valid_to <= clock_timestamp()
       AND (to_jsonb(NEW) - 'valid_to') = (to_jsonb(OLD) - 'valid_to') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'device_beds keeps its history: a row is never deleted or edited, only closed once, and not in the future';
END;
$$ LANGUAGE plpgsql"""
_CREATE_NO_DELETE = ("CREATE TRIGGER device_beds_no_delete BEFORE DELETE ON device_beds"
                     " FOR EACH ROW EXECUTE FUNCTION device_beds_history_kept()")
_CREATE_CLOSE_ONLY = ("CREATE TRIGGER device_beds_close_only BEFORE UPDATE ON device_beds"
                      " FOR EACH ROW EXECUTE FUNCTION device_beds_history_kept()")
_CREATE_NO_TRUNCATE = ("CREATE TRIGGER device_beds_no_truncate BEFORE TRUNCATE ON device_beds"
                       " FOR EACH STATEMENT EXECUTE FUNCTION device_beds_history_kept()")
_DROP_NO_TRUNCATE = "DROP TRIGGER IF EXISTS device_beds_no_truncate ON device_beds"
_DROP_CLOSE_ONLY = "DROP TRIGGER IF EXISTS device_beds_close_only ON device_beds"
_DROP_NO_DELETE = "DROP TRIGGER IF EXISTS device_beds_no_delete ON device_beds"
_DROP_FUNCTION = "DROP FUNCTION IF EXISTS device_beds_history_kept()"


def upgrade() -> None:
    op.create_table(
        TABLE,
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("source", sa.String(45), nullable=False),
        sa.Column("group_address", sa.String(45), nullable=False),
        sa.Column("port", sa.Integer(), nullable=False),
        sa.Column("device_bed_label", sa.String(32), nullable=True),
        sa.Column("bed_label", sa.String(50), nullable=True),
        sa.Column("bed_id", UUID(as_uuid=True), sa.ForeignKey("beds.id"), nullable=True),
        sa.Column("unit_id", UUID(as_uuid=True), sa.ForeignKey("units.id"), nullable=True),
        sa.Column("method", sa.String(32), nullable=True),
        # v2's imported strings are kept as they are; an editor row writes full ISO-8601 UTC (O9, D21)
        sa.Column("verified_at", sa.String(40), nullable=True),
        sa.Column("verified_by", UUID(as_uuid=True), nullable=True),
        sa.Column("note", sa.String(500), nullable=True),
        sa.Column("valid_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column("valid_to", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_by", sa.String(128), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("valid_to IS NULL OR valid_to > valid_from", name="ck_device_beds_interval"),
        sa.CheckConstraint("(bed_id IS NULL) = (unit_id IS NULL)", name="ck_device_beds_bed_unit"),
        sa.CheckConstraint("bed_id IS NULL OR bed_label IS NOT NULL", name="ck_device_beds_bound_label"),
    )
    op.create_index(CURRENT_SOURCE, TABLE, ["tenant_id", "source"], unique=True,
                    postgresql_where=sa.text("valid_to IS NULL"))
    op.create_index(CURRENT_BED, TABLE, ["tenant_id", "bed_id"], unique=True,
                    postgresql_where=sa.text("valid_to IS NULL AND bed_id IS NOT NULL"))
    op.create_index(HISTORY, TABLE, ["tenant_id", "source", "valid_from"])
    op.execute(_CREATE_FUNCTION)
    op.execute(_CREATE_NO_DELETE)
    op.execute(_CREATE_CLOSE_ONLY)
    op.execute(_CREATE_NO_TRUNCATE)


def downgrade() -> None:
    # The three triggers and their function first, then the indexes, then the table (spec §7.3 R-2).
    op.execute(_DROP_NO_TRUNCATE)
    op.execute(_DROP_CLOSE_ONLY)
    op.execute(_DROP_NO_DELETE)
    op.execute(_DROP_FUNCTION)
    op.drop_index(HISTORY, table_name=TABLE)
    op.drop_index(CURRENT_BED, table_name=TABLE)
    op.drop_index(CURRENT_SOURCE, table_name=TABLE)
    op.drop_table(TABLE)

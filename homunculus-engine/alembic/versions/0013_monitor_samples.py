# homunculus-engine/alembic/versions/0013_monitor_samples.py
"""Aşama B (spec D8): `monitor_samples`, the samples the shadow engine was fed, and the audit
index (tenant, event_type, id)

Revision 0013, follows 0012.

* `monitor_samples`: one row per sample the shadow engine took from a bedside monitor
  (`api/monitor_samples.py` PostgresSamples) — `id` (bigserial, the primary key: `since` orders
  by captured_at, id), `hospital`, `patient_id`, `bed_id`, `source` (the monitor's address),
  `code` (the engine's SignalCode), `via` (hr | pls | spo2 | art | nbp), `value`, `unit`,
  `captured_at` and `received_at` (timestamptz), all NOT NULL.
* `ix_monitor_samples_hospital_patient_captured` (hospital, patient_id, captured_at): the read at
  start-up — the last 24 hours (`infinity_rules.REPLAY_HOURS`, D9), replayed into the shadow
  engine. Nothing else in this slice reads the table.
* `ix_monitor_samples_received` (received_at): the API's hourly prune deletes every row received
  more than 30 days ago (`monitor_samples.RETENTION_DAYS`), at every stage on a Postgres
  deployment — so after a rollback below `rules` the rows a `rules` run wrote still expire.
* `ix_audit_tenant_event_id` on `audit` (tenant, event_type, id): the kind-filtered reads, newest
  first by id — the lane's two kinds (`shadow_alert`, `shadow_alert_cleared`) at install and for
  the findings route, and `/alarm-quality`'s five. Without it each of those reads walks the
  tenant's rows by id. `IF NOT EXISTS`, as 0008's index. A plain CREATE INDEX, inside the
  migration's transaction: it holds back writes to `audit` while it builds, which happens when
  the API's start command runs `alembic upgrade head`, before it serves.

`monitor_samples` is bulk rows that expire — the opposite of the audit, which is few and for ever.
It is NOT an audit table: no hash chain, no append-only triggers, and deletes are allowed (the
prune is one). Patient ids are the board's pseudonymous numbers, as in the audit; no name, no free
text.

ONE STATEMENT PER op.execute (asyncpg prepares each one; see 0004 and 0010).

Downgrade drops all of it: the table with its rows (at most 30 days of samples; the shadow engine
then starts from the real engine's copy alone) and the audit index (no audit content is touched).

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-27
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: Union[str, None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "monitor_samples"
REPLAY_INDEX = "ix_monitor_samples_hospital_patient_captured"
PRUNE_INDEX = "ix_monitor_samples_received"
AUDIT_INDEX = "ix_audit_tenant_event_id"
# Whole statements, not f-strings: the one-statement-per-execute check reads them
# (tests/test_audit_postgres.py).
_CREATE_AUDIT_INDEX = ("CREATE INDEX IF NOT EXISTS ix_audit_tenant_event_id"
                       " ON audit (tenant, event_type, id)")
_DROP_AUDIT_INDEX = "DROP INDEX IF EXISTS ix_audit_tenant_event_id"


def upgrade() -> None:
    op.create_table(
        TABLE,
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("hospital", sa.String(64), nullable=False),
        sa.Column("patient_id", sa.String(128), nullable=False),
        sa.Column("bed_id", sa.String(64), nullable=False),
        sa.Column("source", sa.String(45), nullable=False),
        sa.Column("code", sa.String(32), nullable=False),
        sa.Column("via", sa.String(8), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column("unit", sa.String(16), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(REPLAY_INDEX, TABLE, ["hospital", "patient_id", "captured_at"])
    op.create_index(PRUNE_INDEX, TABLE, ["received_at"])
    op.execute(_CREATE_AUDIT_INDEX)


def downgrade() -> None:
    op.execute(_DROP_AUDIT_INDEX)
    op.drop_index(PRUNE_INDEX, table_name=TABLE)
    op.drop_index(REPLAY_INDEX, table_name=TABLE)
    op.drop_table(TABLE)

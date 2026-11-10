# homunculus-engine/alembic/versions/0017_tasks.py
"""G3-02 Görevlerim (spec D6, D8, D10): `tasks`, `task_settings`, and the two permission rows.

Revision 0017, follows B3a's 0016 (bed_occupancy).
* `tasks`: one row per hand-written task. Keyed by the tenant SLUG (`tenant`), as `patient_identity`
  and the audit rows are — this table lives in the api world, not the admission world. `title` and
  `skip_reason` hold Fernet ciphertext (`crypto.encrypt_phi`); people are usernames.
* `task_settings`: one row per tenant — the two shift starts, the grace, the interval per NEWS2 band
  (NULL = not configured → no vital task). No row = the defaults; only `b0 = 720` has a vault source.
* `group_permissions`: `tasks.view` and `tasks.manage` for the six default groups that do the work, in
  every tenant (as 0012 did for `beds.release`). `ensure_default_groups` creates missing groups only.
PURELY ADDITIVE: an image from before this revision serves against it. Downgrade drops exactly this.
ONE STATEMENT PER op.execute (asyncpg).

Revision ID: 0017
Revises: 0016
Create Date: 2026-11-09
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0017"
down_revision: Union[str, None] = "0016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

GROUPS = "('nurse','charge_nurse','physician','unit_physician','attending','rapid_response')"
KEYS = ("tasks.view", "tasks.manage")


def upgrade() -> None:
    op.create_table(
        "tasks",
        sa.Column("id", UUID(as_uuid=False), primary_key=True),
        sa.Column("tenant", sa.String(64), nullable=False),
        sa.Column("patient_id", sa.String(64), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("target_role", sa.String(16), nullable=False),
        sa.Column("created_by", sa.String(128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("state", sa.String(16), nullable=False, server_default=sa.text("'open'")),
        sa.Column("claimed_by", sa.String(128), nullable=True),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_by", sa.String(128), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("skip_reason", sa.Text(), nullable=True),
        sa.CheckConstraint("target_role IN ('nurse','physician','any')", name="ck_tasks_role"),
        sa.CheckConstraint("state IN ('open','done','skipped')", name="ck_tasks_state"),
    )
    op.create_index("ix_tasks_tenant_due", "tasks", ["tenant", "due_at"])
    op.create_index("ix_tasks_tenant_patient", "tasks", ["tenant", "patient_id"])
    op.create_table(
        "task_settings",
        sa.Column("tenant", sa.String(64), primary_key=True),
        sa.Column("shift_start_a", sa.SmallInteger(), nullable=False, server_default=sa.text("8")),
        sa.Column("shift_start_b", sa.SmallInteger(), nullable=False, server_default=sa.text("20")),
        sa.Column("grace_min", sa.SmallInteger(), nullable=False, server_default=sa.text("30")),
        sa.Column("interval_b0", sa.Integer(), nullable=True, server_default=sa.text("720")),
        sa.Column("interval_b1_4", sa.Integer(), nullable=True),
        sa.Column("interval_b3_single", sa.Integer(), nullable=True),
        sa.Column("interval_b5_6", sa.Integer(), nullable=True),
        sa.Column("interval_b7", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_by", sa.String(128), nullable=True),
        sa.CheckConstraint("shift_start_a BETWEEN 0 AND 23 AND shift_start_b BETWEEN 0 AND 23 "
                           "AND shift_start_a <> shift_start_b", name="ck_task_settings_shifts"),
        sa.CheckConstraint("grace_min BETWEEN 0 AND 240", name="ck_task_settings_grace"),
    )
    for key in KEYS:
        op.execute(f"INSERT INTO group_permissions (group_id, permission) SELECT id, '{key}' FROM groups "
                   f"WHERE slug IN {GROUPS} ON CONFLICT DO NOTHING")


def downgrade() -> None:
    for key in KEYS:
        op.execute(f"DELETE FROM group_permissions WHERE permission = '{key}'")
    op.drop_table("task_settings")
    op.drop_index("ix_tasks_tenant_patient", table_name="tasks")
    op.drop_index("ix_tasks_tenant_due", table_name="tasks")
    op.drop_table("tasks")

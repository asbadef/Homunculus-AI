# homunculus-engine/alembic/versions/0016_bed_occupancy.py
"""G2-B3a (spec 2026-10-26 §4, refreshed 2026-11-09): reserved and out-of-service beds

Revision 0016, follows 0015 (protocol).

* `bedstate` gains `RESERVED`. `ALTER TYPE … ADD VALUE` runs inside the migration's transaction
  (Postgres 12 and later); nothing here uses the new value, which Postgres forbids before the
  commit. `alembic/env.py` runs every pending revision in ONE transaction, so a LATER revision that
  uses 'RESERVED' fails with "unsafe use of new value" when a database below 0016 goes straight to
  head. Such a revision commits first, or gets its own transaction.
* `beds.state_reason` VARCHAR(20) NULL, one of FAULT / ISOLATION_CLEANING / STAFFING / OTHER
  (`ck_beds_state_reason`), and `beds.state_note` VARCHAR(1536) NULL — a Fernet ciphertext
  (`EncryptedString`, R8): a note may name the expected patient.
* `beds.manage_state` goes to every tenant's `charge_nurse` group. `hospital_admin` holds the whole
  catalogue by rule (auth/permissions.py) and needs no row.

NOT PURELY ADDITIVE. An image from before this revision does not start against it: its start
command's `alembic upgrade head` refuses the unknown revision ("Can't locate revision identified
by '0016'"), and its `Enum(BedState)` could not read a RESERVED bed anyway. A rollback therefore
runs `alembic downgrade 0015` FIRST, in a one-off container of THIS revision's image, and only then
switches to the old image. The downgrade is what makes that safe (X8): it turns every RESERVED bed
back to AVAILABLE, drops the two columns — every reason and note goes with them — and takes
`beds.manage_state` from the groups. Postgres cannot drop an enum value, so `RESERVED` stays in the
type after a downgrade; no row holds it, so the old image reads every bed, and the upgrade's
`ADD VALUE IF NOT EXISTS` runs again cleanly.

ONE STATEMENT PER op.execute (asyncpg; see 0004, 0010, 0013).

Revision ID: 0016
Revises: 0015
Create Date: 2026-11-09
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: Union[str, None] = "0015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CHECK = "ck_beds_state_reason"


def upgrade() -> None:
    op.execute("ALTER TYPE bedstate ADD VALUE IF NOT EXISTS 'RESERVED'")
    op.add_column("beds", sa.Column("state_reason", sa.String(20), nullable=True))
    op.add_column("beds", sa.Column("state_note", sa.String(1536), nullable=True))
    op.create_check_constraint(
        CHECK, "beds",
        "state_reason IS NULL OR state_reason IN ('FAULT', 'ISOLATION_CLEANING', 'STAFFING', 'OTHER')")
    op.execute(
        "INSERT INTO group_permissions (group_id, permission)"
        " SELECT id, 'beds.manage_state' FROM groups WHERE slug = 'charge_nurse'"
        " ON CONFLICT DO NOTHING"
    )


def downgrade() -> None:
    op.execute("DELETE FROM group_permissions WHERE permission = 'beds.manage_state'")
    # Stamped, so "how long has it been free" does not read the reservation's age.
    op.execute("UPDATE beds SET state = 'AVAILABLE', state_updated_at = now() WHERE state = 'RESERVED'")
    op.drop_constraint(CHECK, "beds", type_="check")
    op.drop_column("beds", "state_note")
    op.drop_column("beds", "state_reason")

# homunculus-engine/alembic/versions/0022_workload_view.py
"""G4-04 İş yükü (spec D2, D8, §5 A8, M1): `workload.view` for the default `charge_nurse` group («Sorumlu Hemşire») of
every tenant, and one active nurse per bed per shift window in `nurse_bed_assignments`.

Revision 0022, follows G4-03's 0020 (quality_view). G3-05's 0021 («Cihaz ölçüm kaydı») is on its own branch: whichever
of the two reaches main second sets its `down_revision` to the other's (one line, and its test's tuple), so
`alembic heads` stays one.

Upgrade, in this order:
1. `group_permissions`: `workload.view` for every group whose slug is `charge_nurse`, in every tenant (0017's, 0019's and
   0020's pattern), ON CONFLICT DO NOTHING. tests/test_migration_0022_workload_view.py holds GROUP to `DEFAULT_GROUPS`;
   a group the hospital made itself is not touched; the system group holds the key by rule.
2. `closed_at` TIMESTAMPTZ NULL (M1): when a row was ended — by this migration, then by PUT /shift-schedule.
3. An active row whose `unit_id` is not its bed's unit (the retired POST never checked it, A8) is ended.
4. Of the active rows of one bed and one `shift_start`, the newest (`created_at`, then `id`) stays and the others are
   ended. The retired POST let rows pile up.
5. `uq_nurse_bed_active_shift`: a partial unique index ON (bed_id, shift_start) WHERE is_active (the model's
   `NURSE_BED_ACTIVE_INDEX`).
"Ended" is `is_active = false, closed_at = now()`: the rows stay, as history.

IT CHANGES DATA, AND THE DOWNGRADE DOES NOT UNDO THAT (spec D8). The downgrade drops the index, the `closed_at` column
(the end times go with it) and the key from every group (a group the hospital gave it to since included: the code before
this revision has no such key); it does NOT re-activate the rows steps 3 and 4 ended — it cannot tell them from rows a
later PUT ended. Deploy notes: before the upgrade, a read-only count of the (bed_id, shift_start) pairs with more than
one active row, of the rows steps 3 and 4 would end, numbers only.

ROLLBACK. An image from before this revision does not start against it: its start command's `alembic upgrade head`
refuses the unknown revision ("Can't locate revision identified by '0022'"). A rollback therefore runs `alembic
downgrade` to this revision's `down_revision` (0020 today) FIRST, in a one-off container of THIS revision's image, and
only then switches to the old image (as 0016). Only an old api started WITHOUT its start command would meet this schema:
it still has the retired POST, which could insert a second active row of one bed and window and meet the index (a 500);
no client calls that POST — no dashboard version ever did.
ONE STATEMENT PER op.execute (asyncpg).

Revision ID: 0022
Revises: 0020
Create Date: 2026-11-12
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0022"
down_revision: Union[str, None] = "0020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

KEY = "workload.view"
#: The one non-system default group that holds the key (auth/permissions.py DEFAULT_GROUPS; spec D2).
GROUP = "charge_nurse"
#: admission/models.py NURSE_BED_ACTIVE_INDEX (the test holds the two to each other).
ACTIVE_INDEX = "uq_nurse_bed_active_shift"


def upgrade() -> None:
    # 1
    op.execute(f"INSERT INTO group_permissions (group_id, permission) SELECT id, '{KEY}' FROM groups "
               f"WHERE slug = '{GROUP}' ON CONFLICT DO NOTHING")
    # 2
    op.add_column("nurse_bed_assignments", sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True))
    # 3
    op.execute(
        "UPDATE nurse_bed_assignments AS a SET is_active = false, closed_at = now()"
        " FROM beds AS b JOIN rooms AS r ON r.id = b.room_id"
        " WHERE b.id = a.bed_id AND a.is_active AND a.unit_id <> r.unit_id")
    # 4
    op.execute(
        "UPDATE nurse_bed_assignments SET is_active = false, closed_at = now() WHERE id IN"
        " (SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY bed_id, shift_start"
        " ORDER BY created_at DESC, id DESC) AS n FROM nurse_bed_assignments WHERE is_active) AS ranked"
        " WHERE n > 1)")
    # 5
    op.create_index(ACTIVE_INDEX, "nurse_bed_assignments", ["bed_id", "shift_start"], unique=True,
                    postgresql_where=sa.text("is_active"))


def downgrade() -> None:
    op.drop_index(ACTIVE_INDEX, table_name="nurse_bed_assignments")
    op.drop_column("nurse_bed_assignments", "closed_at")
    op.execute(f"DELETE FROM group_permissions WHERE permission = '{KEY}'")

# homunculus-engine/alembic/versions/0023_infection_view.py
"""G4-05 Enfeksiyon kontrol (spec D2, D21, §5 A2, M5): `infection.view` for the default groups of the ward's clinicians,
in every tenant

Revision 0023, follows G3-05's 0021 (vital_readings), the head of main when this was written (the chain is … 0020 →
0022 → 0021). The TRƏS branch (`feat/tres-esaglik`) also plans a revision on 0021: whichever of the two reaches main
second is renumbered onto the head of that moment — this file's name, `revision`, `down_revision`, this docstring, and
its test's file name and CHAIN tuple. The tests check the head by ancestry, never by the names' order.
* `group_permissions`: one `infection.view` row for each `attending`, `unit_physician`, `physician`, `charge_nurse` and
  `nurse` group, by slug, in every tenant (0019's pattern). `ensure_default_groups` creates missing groups only, so the
  tenants seeded before this revision get the key here; a tenant seeded after it gets it from `DEFAULT_GROUPS`
  (auth/permissions.py). `hospital_admin` needs no row: the system group holds the whole catalogue by rule. A
  hospital's own group gets nothing: the hospital gives it the key itself, in Yönetim › Roller.
No table, no column.

ROLLBACK (§5 A2). An image from before this revision does not start against it: its start command's `alembic upgrade
head` refuses the unknown revision ("Can't locate revision identified by '0023'"). A rollback therefore runs `alembic
downgrade` FIRST, in a one-off container of THIS revision's image, to the revision the server ran before this release
(in a release that carries other revisions too, that is the server's pre-release head, not this revision's
`down_revision`), and only then switches to the old image. The downgrade deletes the key's rows — every one, a row a
hospital gave another group after the upgrade included: the image the downgrade returns to does not know the key.
ONE STATEMENT PER op.execute (asyncpg; see 0004, 0010, 0013).

Revision ID: 0023
Revises: 0021
Create Date: 2026-11-12
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0023"
down_revision: Union[str, None] = "0021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

KEY = "infection.view"
#: The five non-system default groups that hold the key (auth/permissions.py DEFAULT_GROUPS; spec D2).
#: tests/test_migration_0023_infection_view.py holds this tuple, GRANT and DEFAULT_GROUPS to one another.
GROUPS = ("attending", "unit_physician", "physician", "charge_nurse", "nurse")
GRANT = ("INSERT INTO group_permissions (group_id, permission) SELECT id, 'infection.view' FROM groups "
         "WHERE slug IN ('attending', 'unit_physician', 'physician', 'charge_nurse', 'nurse') ON CONFLICT DO NOTHING")
REVOKE = "DELETE FROM group_permissions WHERE permission = 'infection.view'"


def upgrade() -> None:
    op.execute(GRANT)


def downgrade() -> None:
    op.execute(REVOKE)

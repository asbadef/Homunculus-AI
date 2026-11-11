# homunculus-engine/alembic/versions/0019_pharmacy_view.py
"""G3-04 Eczane (spec D2, D21): `pharmacy.view` for the default groups that hold it, in every tenant

Revision 0019, follows G2-B1c's 0018 (care_team_transfer).
* `group_permissions`: one `pharmacy.view` row for each `pharmacist`, `physician`, `unit_physician` and
  `attending` group, by slug, in every tenant (as 0017 did for `tasks.*`). `ensure_default_groups` creates
  missing groups only, so the tenants seeded before this revision get the key here; a tenant seeded after it
  gets it from `DEFAULT_GROUPS` (auth/permissions.py). `hospital_admin` needs no row: the system group holds the
  whole catalogue by rule (0016's and 0017's precedent). A hospital's own group gets nothing: the hospital gives
  it the key itself, in Yönetim › Roller.
No table, no column. PURELY ADDITIVE: an image from before this revision serves against it. Downgrade deletes the
key's rows — every one, a row a hospital gave another group after the upgrade included: the image the downgrade
returns to does not know the key.
ONE STATEMENT PER op.execute (asyncpg; see 0004, 0010, 0013).

Revision ID: 0019
Revises: 0018
Create Date: 2026-11-11
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0019"
down_revision: Union[str, None] = "0018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

KEY = "pharmacy.view"
#: The four non-system default groups that hold the key (auth/permissions.py DEFAULT_GROUPS; spec D2).
#: tests/test_migration_0019_pharmacy_view.py holds this tuple, GRANT and DEFAULT_GROUPS to one another.
GROUPS = ("pharmacist", "physician", "unit_physician", "attending")
GRANT = ("INSERT INTO group_permissions (group_id, permission) SELECT id, 'pharmacy.view' FROM groups "
         "WHERE slug IN ('pharmacist', 'physician', 'unit_physician', 'attending') ON CONFLICT DO NOTHING")
REVOKE = "DELETE FROM group_permissions WHERE permission = 'pharmacy.view'"


def upgrade() -> None:
    op.execute(GRANT)


def downgrade() -> None:
    op.execute(REVOKE)

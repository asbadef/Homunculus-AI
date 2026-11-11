# homunculus-engine/alembic/versions/0020_quality_view.py
"""G4-03 Kalite göstergeleri (spec D2, D7): `quality.view` for the default `auditor` group («Denetçi») of every tenant.

Revision 0020, follows G3-04's 0019 (pharmacy_view).

* `group_permissions`: `quality.view` for every group whose slug is `auditor`, in every tenant (0017's and 0019's
  pattern). tests/test_migration_0020_quality_view.py holds GROUP to `DEFAULT_GROUPS`. A
  group the hospital made itself is not touched. `ensure_default_groups` creates missing groups only; `DEFAULT_GROUPS`
  seeds the key for a tenant made later, and the system group holds it by rule.
* No schema change.

PURELY ADDITIVE: an image from before this revision serves against it — a key its catalogue does not know never
reaches a token (`auth/groups.py`). The downgrade deletes the key from every group, as 0017's does for its keys — a
group the hospital gave it to since included: the code before this revision has no such key.
ONE STATEMENT PER op.execute (asyncpg).

Revision ID: 0020
Revises: 0019
Create Date: 2026-11-11
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0020"
down_revision: Union[str, None] = "0019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

KEY = "quality.view"
#: The one non-system default group that holds the key (auth/permissions.py DEFAULT_GROUPS; spec D2, D7).
GROUP = "auditor"


def upgrade() -> None:
    op.execute(f"INSERT INTO group_permissions (group_id, permission) SELECT id, '{KEY}' FROM groups "
               f"WHERE slug = '{GROUP}' ON CONFLICT DO NOTHING")


def downgrade() -> None:
    op.execute(f"DELETE FROM group_permissions WHERE permission = '{KEY}'")

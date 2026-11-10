# homunculus-engine/alembic/versions/0018_care_team_transfer.py
"""G2-B1c Bakım ekibi with G2-B1b Nakil (specs 2026-11-09: B1c §5.1, B1b §5.9): one migration (D9)

Revision 0018, follows G3-02's 0017 (tasks). B1c is built first and writes all of it; B1b finds its
part (step 8) done.

Upgrade, in this order (B1c §5.1):
1. Drop the constraint `uq_care_team_active_member` (admission_id, user_id, is_active). It allowed
   one CLOSED row per member and admission, so ending a member twice broke it (F2).
2. Close the active rows of closed admissions (DISCHARGED, TRANSFERRED).
3. Per admission, keep the newest active ATTENDING row (`created_at`, then `id`) and close the
   others. `attending_physician_id` follows the kept row.
4. Backfill (O45). An open, signed admission (ACTIVE, PENDING_DISCHARGE, PENDING_TRANSFER) with an
   attending and no active ATTENDING row gets one for her (`granted_by_id` NULL). When she holds
   another active row there, that row becomes it, its window cleared.
5. `uq_care_team_active_member` ON (admission_id, user_id) WHERE is_active.
6. `uq_care_team_one_attending` ON (admission_id) WHERE is_active AND role = 'ATTENDING'.
7. `care_team.claim` leaves every `charge_nurse` group (D7). «bakım ekibi» leaves that group's
   description where it is still the default text; a hospital's own text is left alone (X3).
8. B1b: `admissions.transfer_reason` VARCHAR(32) NULL, checked against the six reasons
   (`ck_admissions_transfer_reason`), and `admissions.transfer_note` VARCHAR(1536) NULL, a Fernet
   ciphertext (`EncryptedString`, ≤ 200 characters of plaintext).

Steps 2–4 close or write rows at `now()`. An image from before this revision runs against it
with two exceptions, both a second active ATTENDING row that a new index refuses (a 500; the
step-6 one, or the step-5 one when the same physician is named twice):
- its claim route (`POST .../care-team/claim`) writes an ATTENDING row without ending the first;
- its care-team ADD route (`POST .../care-team`, `admission/service.py` `add_care_team_member`)
  limits no role, so it writes an ATTENDING row the same way.
The old web calls neither route (deploy notes).

Downgrade: B1b's columns and CHECK go; the `charge_nurse` rows and the description come back; the
two indexes go and the old constraint returns. THE DOWNGRADE DROPS `admissions.transfer_reason`
AND `admissions.transfer_note`: once B1b has shipped, every transfer's reason and its (encrypted)
note are lost, and nothing here saves them. The deploy notes' rollback block counts the reasons
first. The last step FAILS LOUDLY when a member holds two closed rows on one admission, and the
whole downgrade rolls back with it; the deploy notes' rollback block counts those too. Rows closed
or written by steps 2–4 stay as they are.

ONE STATEMENT PER op.execute (asyncpg; see 0004, 0010, 0013).

Revision ID: 0018
Revises: 0017
Create Date: 2026-11-09
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0018"
down_revision: Union[str, None] = "0017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ACTIVE_INDEX = "uq_care_team_active_member"
ATTENDING_INDEX = "uq_care_team_one_attending"
REASON_CHECK = "ck_admissions_transfer_reason"
REASONS = ("CLINICAL_NEED", "TO_ICU", "ICU_TO_WARD", "ISOLATION", "PATIENT_OR_FAMILY_REQUEST",
           "OTHER")
CLOSED = "('DISCHARGED', 'TRANSFERRED')"
SIGNED_OPEN = "('ACTIVE', 'PENDING_DISCHARGE', 'PENDING_TRANSFER')"
NO_ACTIVE_ATTENDING = ("NOT EXISTS (SELECT 1 FROM care_team_members AS x WHERE x.admission_id = a.id"
                       " AND x.is_active AND x.role = 'ATTENDING')")
#: D7 (X3): the charge nurse's default description, before and after.
CHARGE_BEFORE = "Hasta kabul, transfer/taburcu onayı, nöbet çizelgesi, bakım ekibi."
CHARGE_AFTER = "Hasta kabul, transfer/taburcu onayı, nöbet çizelgesi."


def upgrade() -> None:
    # 1
    op.drop_constraint(ACTIVE_INDEX, "care_team_members", type_="unique")
    # 2
    op.execute(
        "UPDATE care_team_members SET is_active = false, closed_at = now()"
        " WHERE is_active AND admission_id IN"
        f" (SELECT id FROM admissions WHERE state IN {CLOSED})")
    # 3
    op.execute(
        "UPDATE care_team_members SET is_active = false, closed_at = now() WHERE id IN"
        " (SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY admission_id"
        " ORDER BY created_at DESC NULLS LAST, id DESC) AS n"
        " FROM care_team_members WHERE is_active AND role = 'ATTENDING') AS ranked WHERE n > 1)")
    op.execute(
        "UPDATE admissions AS a SET attending_physician_id = m.user_id FROM care_team_members AS m"
        " WHERE m.admission_id = a.id AND m.is_active AND m.role = 'ATTENDING'"
        " AND a.attending_physician_id IS DISTINCT FROM m.user_id")
    # 4: her own active row first (the old constraint allowed her one), then a new row.
    op.execute(
        "UPDATE care_team_members AS m SET role = 'ATTENDING', window_start = NULL,"
        " window_end = NULL FROM admissions AS a"
        " WHERE m.admission_id = a.id AND m.is_active AND m.user_id = a.attending_physician_id"
        f" AND a.state IN {SIGNED_OPEN} AND {NO_ACTIVE_ATTENDING}")
    op.execute(
        "INSERT INTO care_team_members (id, admission_id, user_id, role, granted_by_id, is_active,"
        " created_at) SELECT gen_random_uuid(), a.id, a.attending_physician_id, 'ATTENDING', NULL,"
        " true, now() FROM admissions AS a"
        f" WHERE a.state IN {SIGNED_OPEN} AND a.attending_physician_id IS NOT NULL"
        f" AND {NO_ACTIVE_ATTENDING}")
    # 5, 6
    op.create_index(ACTIVE_INDEX, "care_team_members", ["admission_id", "user_id"], unique=True,
                    postgresql_where=sa.text("is_active"))
    op.create_index(ATTENDING_INDEX, "care_team_members", ["admission_id"], unique=True,
                    postgresql_where=sa.text("is_active AND role = 'ATTENDING'"))
    # 7
    op.execute(
        "DELETE FROM group_permissions WHERE permission = 'care_team.claim'"
        " AND group_id IN (SELECT id FROM groups WHERE slug = 'charge_nurse')")
    op.execute(sa.text(
        "UPDATE groups SET description = :after"
        " WHERE slug = 'charge_nurse' AND description = :before"
    ).bindparams(after=CHARGE_AFTER, before=CHARGE_BEFORE))
    # 8 (B1b)
    op.add_column("admissions", sa.Column("transfer_reason", sa.String(32), nullable=True))
    op.add_column("admissions", sa.Column("transfer_note", sa.String(1536), nullable=True))
    op.create_check_constraint(
        REASON_CHECK, "admissions",
        "transfer_reason IS NULL OR transfer_reason IN ({})".format(
            ", ".join(f"'{reason}'" for reason in REASONS)))


def downgrade() -> None:
    op.drop_constraint(REASON_CHECK, "admissions", type_="check")
    op.drop_column("admissions", "transfer_note")
    op.drop_column("admissions", "transfer_reason")
    op.execute(sa.text(
        "UPDATE groups SET description = :before"
        " WHERE slug = 'charge_nurse' AND description = :after"
    ).bindparams(after=CHARGE_AFTER, before=CHARGE_BEFORE))
    op.execute(
        "INSERT INTO group_permissions (group_id, permission)"
        " SELECT id, 'care_team.claim' FROM groups WHERE slug = 'charge_nurse'"
        " ON CONFLICT DO NOTHING")
    op.drop_index(ATTENDING_INDEX, table_name="care_team_members")
    op.drop_index(ACTIVE_INDEX, table_name="care_team_members")
    op.create_unique_constraint(ACTIVE_INDEX, "care_team_members",
                                ["admission_id", "user_id", "is_active"])

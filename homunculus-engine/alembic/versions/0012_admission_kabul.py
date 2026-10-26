# homunculus-engine/alembic/versions/0012_admission_kabul.py
"""Hasta Kabul (Group 2 · B1a): the admission form's columns, the patient number, closable beds,
the board identity's own bed, and `beds.release` for the ward's nurses

Revision 0012, follows 0011.

* `patients`: `patient_number` (varchar 16, unique per tenant, NOT NULL — every existing row gets
  one here, `H` + the two-digit year it was created in (UTC) + its place in that tenant's year,
  oldest first), nine encrypted identity and contact columns, `consent` (enum `consent`, nullable)
  and `sms_permitted` (NOT NULL, false).
* Every encrypted column of `patients` is varchar 1536 — the nine above, and 0002's
  `display_name`, `date_of_birth`, `sex` and `his_patient_reference`, widened from 512 (a metadata
  change in PostgreSQL: no rewrite, no lock beyond the ALTER's own). The request bounds count
  characters, a character is up to four bytes, and the longest (a 200-character name) of four-byte
  characters is 1173 characters of Fernet ciphertext; 512 did not hold 200 Azerbaijani letters
  (641). `admission/models.py` `PHI_COLUMN_LENGTH` says how the figure is reached.
* `patient_number_counters` (tenant_id, year, last): the number source. Seeded from the numbers
  given above, so the next admission continues after them.
* `admissions`: `admission_type`, `blood_group` (enums), `allergies_text`, `no_known_allergy`
  (NOT NULL, false), `comorbidity_codes` (JSON), `comorbidities_text`, and the discharge's
  `discharge_disposition` (enum), `discharge_institution`, `discharge_reported_by`,
  `discharge_at`, `discharge_note`.
* `beds.is_active` (NOT NULL, true): a closed bed is kept and offered to no admission.
* `patient_identity.bed_id`, `.unit_id` (text, nullable): a `kabul` record's own bed and unit, the
  tenant UUIDs (spec D9).
* Data: `beds.release` is added to the `nurse` and `charge_nurse` groups of every tenant —
  `ensure_default_groups` never adds a key to a group that exists. The system group holds every
  key by rule at token issuance and needs no row.

ONE STATEMENT PER op.execute (asyncpg prepares each one; see 0004 and 0010).

Downgrade drops all of it: the patient numbers, the form's extra fields, the dispositions and the
`beds.release` rows (any group's) are lost. Back the database up first (runbook: pg_dump). It
narrows 0002's four columns back to 512, and STOPS — the whole downgrade rolled back, one
transaction — if a value written since no longer fits: a ciphertext cut to fit is a name nobody
can read again. Such a row is the operator's to deal with before downgrading.

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-25
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# create_type=False: created once, explicitly, as 0002 does. Names are SQLAlchemy's for the model's
# `Enum(<class>)`: the class name, lower-cased.
consent_enum = postgresql.ENUM("KVKK_SIGNED", "UNCONSCIOUS_LATER", name="consent",
                               create_type=False)
admission_type_enum = postgresql.ENUM("MEDICAL", "SURGICAL", "ICU", "PROCEDURE",
                                      name="admissiontype", create_type=False)
blood_group_enum = postgresql.ENUM("A_POS", "A_NEG", "B_POS", "B_NEG", "AB_POS", "AB_NEG",
                                   "O_POS", "O_NEG", "UNKNOWN", name="bloodgroup",
                                   create_type=False)
disposition_enum = postgresql.ENUM("HOME", "OTHER_INSTITUTION", "EXITUS",
                                   name="dischargedisposition", create_type=False)

_ENCRYPTED = ("father_name", "nationality", "national_id", "passport_no", "phone",
              "relative_name", "relative_relation", "relative_phone", "companion_name")
#: Every encrypted column's width (admission/models.py PHI_COLUMN_LENGTH; a migration does not
#: import the models it predates, so the figure is written out).
_PHI = 1536
#: 0002's encrypted columns (name, nullable) and the width 0002 gave them.
_WIDENED = (("display_name", False), ("date_of_birth", False), ("sex", False),
            ("his_patient_reference", True))
_PHI_0002 = 512

# The year a row was created in, in UTC: the number's two digits and its counter's year.
_YEAR = "EXTRACT(YEAR FROM created_at AT TIME ZONE 'UTC')::int"

#: The board identity's own bed and unit (IF NOT EXISTS, as 0006). Named here so the Postgres
#: identity store's own test provisions exactly these (tests/test_patient_identity_postgres.py).
IDENTITY_COLUMNS = (
    "ALTER TABLE patient_identity ADD COLUMN IF NOT EXISTS bed_id TEXT",
    "ALTER TABLE patient_identity ADD COLUMN IF NOT EXISTS unit_id TEXT",
)


def upgrade() -> None:
    bind = op.get_bind()
    for enum in (consent_enum, admission_type_enum, blood_group_enum, disposition_enum):
        enum.create(bind, checkfirst=True)

    # ---- patients ----
    op.add_column("patients", sa.Column("patient_number", sa.String(16), nullable=True))
    for name in _ENCRYPTED:
        op.add_column("patients", sa.Column(name, sa.String(_PHI), nullable=True))
    for name, nullable in _WIDENED:
        op.alter_column("patients", name, type_=sa.String(_PHI),
                        existing_type=sa.String(_PHI_0002), existing_nullable=nullable)
    op.add_column("patients", sa.Column("consent", consent_enum, nullable=True))
    op.add_column("patients", sa.Column("sms_permitted", sa.Boolean(), nullable=False,
                                        server_default=sa.false()))
    op.execute(
        "WITH numbered AS ("
        f" SELECT id, {_YEAR} AS yr, ROW_NUMBER() OVER ("
        f"  PARTITION BY tenant_id, {_YEAR} ORDER BY created_at, id) AS seq FROM patients)"
        " UPDATE patients SET patient_number = 'H' || LPAD((numbered.yr % 100)::text, 2, '0')"
        " || LPAD(numbered.seq::text, 5, '0') FROM numbered WHERE patients.id = numbered.id"
    )
    op.alter_column("patients", "patient_number", nullable=False)
    op.create_unique_constraint("uq_patients_tenant_number", "patients",
                                ["tenant_id", "patient_number"])

    op.create_table(
        "patient_number_counters",
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("year", sa.Integer(), primary_key=True),
        sa.Column("last", sa.Integer(), nullable=False, server_default="0"),
    )
    op.execute(
        "INSERT INTO patient_number_counters (tenant_id, year, last)"
        f" SELECT tenant_id, {_YEAR}, COUNT(*) FROM patients GROUP BY tenant_id, {_YEAR}"
    )

    # ---- admissions ----
    op.add_column("admissions", sa.Column("admission_type", admission_type_enum, nullable=True))
    op.add_column("admissions", sa.Column("blood_group", blood_group_enum, nullable=True))
    op.add_column("admissions", sa.Column("allergies_text", sa.String(500), nullable=True))
    op.add_column("admissions", sa.Column("no_known_allergy", sa.Boolean(), nullable=False,
                                          server_default=sa.false()))
    op.add_column("admissions", sa.Column("comorbidity_codes", postgresql.JSONB(), nullable=True))
    op.add_column("admissions", sa.Column("comorbidities_text", sa.String(500), nullable=True))
    op.add_column("admissions", sa.Column("discharge_disposition", disposition_enum,
                                          nullable=True))
    op.add_column("admissions", sa.Column("discharge_institution", sa.String(200), nullable=True))
    op.add_column("admissions", sa.Column("discharge_reported_by", sa.String(200), nullable=True))
    op.add_column("admissions", sa.Column("discharge_at", sa.DateTime(timezone=True),
                                          nullable=True))
    op.add_column("admissions", sa.Column("discharge_note", sa.String(2000), nullable=True))

    # ---- beds ----
    op.add_column("beds", sa.Column("is_active", sa.Boolean(), nullable=False,
                                    server_default=sa.true()))

    # ---- the board identity's own bed ----
    for statement in IDENTITY_COLUMNS:
        op.execute(statement)

    # ---- beds.release for the ward's nurses, in every tenant ----
    op.execute(
        "INSERT INTO group_permissions (group_id, permission)"
        " SELECT id, 'beds.release' FROM groups WHERE slug IN ('nurse', 'charge_nurse')"
        " ON CONFLICT DO NOTHING"
    )


def downgrade() -> None:
    op.execute("DELETE FROM group_permissions WHERE permission = 'beds.release'")
    op.execute("ALTER TABLE patient_identity DROP COLUMN IF EXISTS unit_id")
    op.execute("ALTER TABLE patient_identity DROP COLUMN IF EXISTS bed_id")
    op.drop_column("beds", "is_active")
    for name in ("discharge_note", "discharge_at", "discharge_reported_by",
                 "discharge_institution", "discharge_disposition", "comorbidities_text",
                 "comorbidity_codes", "no_known_allergy", "allergies_text", "blood_group",
                 "admission_type"):
        op.drop_column("admissions", name)
    op.drop_table("patient_number_counters")
    op.drop_constraint("uq_patients_tenant_number", "patients", type_="unique")
    for name in ("sms_permitted", "consent", *_ENCRYPTED, "patient_number"):
        op.drop_column("patients", name)
    # An assignment cast: a value that does not fit is an error, never cut (see the docstring).
    for name, nullable in _WIDENED:
        op.alter_column("patients", name, type_=sa.String(_PHI_0002),
                        existing_type=sa.String(_PHI), existing_nullable=nullable)
    bind = op.get_bind()
    for enum in (disposition_enum, blood_group_enum, admission_type_enum, consent_enum):
        enum.drop(bind, checkfirst=True)

"""Carry the HIS's ICD-10 diagnoses on the identity record. Revision 0006, follows 0005.

The hospital's ADT already sends admission diagnoses in its DG1 segments, and the admission
form asks a clinician to type them again. This column is what lets the first replace the
second: every diagnosis carried here is one nobody has to enter, and one that cannot be
mistyped.

Encrypted at rest, like the name: a diagnosis is health data.
"""
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS so a database that has already been through this — a local stack recreated
    # from the SQLite path, say — does not fail the whole upgrade on a column it already has.
    op.execute("ALTER TABLE patient_identity ADD COLUMN IF NOT EXISTS diagnoses TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE patient_identity DROP COLUMN IF EXISTS diagnoses")

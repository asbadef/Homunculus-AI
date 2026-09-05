"""Encrypted patient identity, scoped by tenant. Revision 0005, follows 0004."""
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS patient_identity (
            tenant TEXT NOT NULL, patient_id TEXT NOT NULL,
            family TEXT, given TEXT, birth_date TEXT, sex TEXT,
            unit TEXT, room TEXT, bed TEXT, state TEXT, source TEXT, updated_at TEXT,
            PRIMARY KEY (tenant, patient_id)
        )
    """)


def downgrade() -> None:
    op.drop_table("patient_identity")

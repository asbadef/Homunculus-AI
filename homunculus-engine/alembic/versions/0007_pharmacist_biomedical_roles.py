"""Add PHARMACIST and BIOMEDICAL to the role catalogue. Revision 0007, follows 0006.

Both roles already existed on the dashboard — the pharmacist since the medication work, the
biomedical engineer since the device inventory — but neither existed here, so no account could
actually hold one. The device-and-data-flow page in particular was unreachable by anyone whose
job it is: a screen drawn for a role nobody could be.

PostgreSQL refuses `ALTER TYPE ... ADD VALUE` inside a transaction block on the versions this
deployment may meet, so the statements run in Alembic's `autocommit_block()` — the supported
way to do it. An earlier draft of this file issued a bare `COMMIT` first instead. That happens
to work and is the wrong shape: it leaves the revision running outside the transaction Alembic
believes it owns, so a later failure in the same revision would have nothing to roll back.

`IF NOT EXISTS` keeps the revision re-runnable: a database that already carries the values
upgrades cleanly rather than failing on the first statement.
"""
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None

NEW_ROLES = ("PHARMACIST", "BIOMEDICAL")


def upgrade() -> None:
    # One statement per execute(): asyncpg refuses multi-statement strings, and the repo's
    # migration test enforces that rule.
    with op.get_context().autocommit_block():
        for role in NEW_ROLES:
            op.execute(f"ALTER TYPE userrole ADD VALUE IF NOT EXISTS '{role}'")


def downgrade() -> None:
    # PostgreSQL cannot drop a value from an enum. Removing these would mean rebuilding the type
    # and every column that uses it — far more destructive than the thing being undone, and it
    # would take every account holding one of these roles with it. Left deliberately empty, and
    # that is exactly why this revision must be seen to run in rehearsal before it runs on a ward.
    pass

"""Staff scope: which units and beds a user may see. Revision 0009, follows 0008.

The assignment matrix has existed on the administrator's screen for months and, until
21.09.2026, reached no board at all. That day the dashboard started filtering by it — on the
screen, in the browser, from a store nothing outside the tab could read. Anyone calling
`/patients` with a valid token still received every patient in the hospital, which is the same
access the KVKK question is about. This table is where the answer becomes durable enough for
the engine to enforce.

**The columns are text, not foreign keys.** A grant names a unit or bed the way the site's
`bed-mapping.json` names it, because that is what the board publishes and therefore the only
thing a filter can compare against. A foreign key would require a row in our own hierarchy for
every key a hospital's map happens to carry; where one is missing, the constraint would not
prevent the mismatch, it would relocate it — out of a report an administrator can read and into
a nurse's empty board. `apply_scope` counts unmatched grants and names them instead.

**Nothing is enforced by this revision.** Creating the table grants nobody anything and
restricts nobody: with no rows, every user resolves as unassigned, which stays unrestricted
until a deployment sets `SCOPE_ENFORCE_UNASSIGNED`. That ordering is deliberate — the migration
can run on the pilot without a single screen changing, and the day access narrows is a day
somebody chose.
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "staff_scopes",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("unit_id", sa.String(100), nullable=False, server_default=""),
        sa.Column("bed_id", sa.String(100), nullable=False, server_default=""),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("granted_by_id", UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        # A row granting both a unit and a bed is ambiguous; a row granting neither looks like
        # access and is not. Neither shape may reach the table.
        sa.CheckConstraint(
            "(unit_id <> '' AND bed_id = '') OR (unit_id = '' AND bed_id <> '')",
            name="ck_staff_scope_exactly_one_target",
        ),
    )
    op.create_index("ix_staff_scopes_tenant_id", "staff_scopes", ["tenant_id"])
    op.create_index("ix_staff_scopes_user_id", "staff_scopes", ["user_id"])
    # The read this table exists for runs on every board request, for one user, active rows only.
    op.create_index("ix_staff_scopes_user_active", "staff_scopes", ["user_id", "is_active"])


def downgrade() -> None:
    op.drop_index("ix_staff_scopes_user_active", table_name="staff_scopes")
    op.drop_index("ix_staff_scopes_user_id", table_name="staff_scopes")
    op.drop_index("ix_staff_scopes_tenant_id", table_name="staff_scopes")
    op.drop_table("staff_scopes")

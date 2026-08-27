"""audit log

Creates the `audit` table: the durable, append-only trail written by
`PostgresAuditLog` (src/homunculus/api/audit_postgres.py) for every ingest,
alert, acknowledgement and escalation. It is also the source of truth the
engine and ack state are rebuilt from on restart, and it is a legal record for
the pilot — so it must exist wherever `alembic upgrade head` is the only thing
provisioning the schema (on-prem, a fresh cloud database, CI), not only where
someone happened to create it by hand.

APPEND-ONLY AT THE DATABASE, NOT JUST IN CODE: the application never issues an
UPDATE or DELETE against this table, but that is a promise the application
keeps only as long as every caller behaves. A compromised credential, an
operator running ad-hoc SQL, or a future bug would otherwise be able to alter
or erase the trail with nothing to stop it. The `audit_no_update` /
`audit_no_delete` triggers make tampering fail at the database itself,
regardless of what issued the statement.

IDEMPOTENT ON PURPOSE: this table was created by hand on the existing cloud
database before this migration existed. `CREATE TABLE IF NOT EXISTS`,
`CREATE OR REPLACE FUNCTION` and `DROP TRIGGER IF EXISTS` before
`CREATE TRIGGER` let `alembic upgrade head` run cleanly against that database
too, converging it onto the same migration-managed schema as every other
environment, rather than failing on objects that already exist. Do not
"simplify" these guards away — removing them is what breaks the cloud
database.

Revision ID: 0004
Revises: 0003
Create Date: 2026-08-26

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Alembic has no native construct for triggers or functions, so these are raw SQL via
# op.execute(). The table is created the same way (rather than op.create_table) so the
# whole DDL block stays together and matches the proven fixture in
# tests/test_audit_postgres.py verbatim.
#
# ONE STATEMENT PER CONSTANT. This is not a formatting preference: migrations run through the async
# engine (alembic/env.py), and asyncpg prepares every statement it is given, so a string holding
# several statements fails with "cannot insert multiple commands into a prepared statement". The
# fixture in tests/test_audit_postgres.py does not hit this because it talks to psycopg2, which
# accepts multi-statement strings — which is exactly why this only surfaced on a real deployment.
_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS audit (
    id BIGSERIAL PRIMARY KEY, ts TEXT NOT NULL, tenant TEXT NOT NULL,
    event_type TEXT NOT NULL, patient_id TEXT NOT NULL, subject TEXT NOT NULL,
    payload JSONB NOT NULL
);
"""

_CREATE_FUNCTION = """
CREATE OR REPLACE FUNCTION audit_is_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit is append-only'; END;
$$ LANGUAGE plpgsql;
"""

# The DROPs run first so the migration is idempotent against the cloud database, where this table
# and its triggers were created by hand before the migration existed.
_DROP_UPDATE_TRIGGER = "DROP TRIGGER IF EXISTS audit_no_update ON audit"

_CREATE_UPDATE_TRIGGER = """
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit
    FOR EACH ROW EXECUTE FUNCTION audit_is_append_only()
"""

_DROP_DELETE_TRIGGER = "DROP TRIGGER IF EXISTS audit_no_delete ON audit"

_CREATE_DELETE_TRIGGER = """
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit
    FOR EACH ROW EXECUTE FUNCTION audit_is_append_only()
"""


def upgrade() -> None:
    op.execute(_CREATE_TABLE)
    op.execute(_CREATE_FUNCTION)
    op.execute(_DROP_UPDATE_TRIGGER)
    op.execute(_CREATE_UPDATE_TRIGGER)
    op.execute(_DROP_DELETE_TRIGGER)
    op.execute(_CREATE_DELETE_TRIGGER)


def downgrade() -> None:
    # Triggers before the function they call, the function before the table — otherwise
    # PostgreSQL refuses the DROP because a dependent object still references it.
    op.execute("DROP TRIGGER IF EXISTS audit_no_update ON audit")
    op.execute("DROP TRIGGER IF EXISTS audit_no_delete ON audit")
    op.execute("DROP FUNCTION IF EXISTS audit_is_append_only()")
    op.execute("DROP TABLE IF EXISTS audit")

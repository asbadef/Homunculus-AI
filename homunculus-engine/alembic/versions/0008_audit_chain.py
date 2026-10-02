"""Seal the audit log with a per-tenant hash chain. Revision 0008, follows 0007.

The audit table was already append-only: triggers refuse UPDATE and DELETE. That protects the log
from the application, and not at all from anyone who can reach the database directly — which on an
on-prem install is the hospital's own database administrator. "Nobody deleted a row" and "nobody
rewrote one" are different claims, and an inspection asks about the second.

Each record now carries `prev_hash` (the seal of the record before it, per tenant) and `hash` (its
own). Editing any past record changes its hash and breaks every link after it, so a tamper cannot
be local and cannot be silent. This is tamper-EVIDENT, not tamper-proof; the honest claim is that
any change is detectable.

Two details worth the ink:

* **Additive and nullable-safe.** Existing rows get an empty string, not a fabricated hash. A row
  written before the chain existed was never sealed, and minting a seal for it now would be
  manufacturing exactly the evidence this column is supposed to provide. `verify_chain` reports
  those separately as "unsealed" instead of calling them tampered.

* **The unique index is the concurrency fix, not an optimisation.** Two appends racing would both
  read the same head and write two records claiming the same predecessor — a forked history with
  no way to tell which branch is real. The partial unique index makes that impossible to commit;
  the losing writer retries against the new head. Partial (`WHERE hash <> ''`) so the unsealed
  legacy rows do not all collide on the empty string.
"""
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # One statement per execute(): asyncpg refuses multi-statement strings, and the repo's
    # migration test enforces that rule.
    op.execute("ALTER TABLE audit ADD COLUMN IF NOT EXISTS prev_hash TEXT NOT NULL DEFAULT ''")
    op.execute("ALTER TABLE audit ADD COLUMN IF NOT EXISTS hash TEXT NOT NULL DEFAULT ''")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS audit_chain_link ON audit (tenant, prev_hash)"
        " WHERE hash <> ''"
    )


def downgrade() -> None:
    # Reversible, unlike 0007: dropping the seal loses the ability to prove the log was not
    # altered, but it destroys no audit content. The rows themselves are untouched.
    op.execute("DROP INDEX IF EXISTS audit_chain_link")
    op.execute("ALTER TABLE audit DROP COLUMN IF EXISTS hash")
    op.execute("ALTER TABLE audit DROP COLUMN IF EXISTS prev_hash")

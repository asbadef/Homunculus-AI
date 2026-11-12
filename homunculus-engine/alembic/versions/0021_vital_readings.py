# homunculus-engine/alembic/versions/0021_vital_readings.py
"""G3-05 Cihaz ölçüm kaydı (spec §3, D6, D14, D19): `vital_readings`, and the audit index (tenant, patient_id, id)

Revision 0021. It follows G4-04 İş yükü's 0022: on its own branch it followed G3-04's 0019; the merges of main, where
G4-03's 0020 and then 0022 landed first, set `down_revision` to each in turn (spec §8). The id stays "0021", so the
chain is not in the names' order (… 0020 → 0022 → 0021): `alembic heads` prints one head, 0021, and an order check
reads the revision graph, never the names.

* `vital_readings`: one row per measured value — a device reading `/ingest` took (`origin` device) or a bedside
  value typed at `POST /clinical/{id}` (`origin` manual). Keyed by the tenant SLUG (`tenant`), as `tasks` and the
  audit rows are: this table lives in the api world. `received_key` is the number the door received;
  `patient_key` the card key the value is filed under (NULL while unmatched, claimed or rejected);
  `admission_id` the stay (admissions.id, ON DELETE RESTRICT; NULL for a HIS-fed patient). `state`: recorded |
  unmatched | assigned | rejected. `audit_id` is the arrival's audit row, `entry_id` the row the engine replays
  and «hatalı giriş» names. No name and no free text but two reasons a person typed (≤ 200 characters).
* Indexes: (tenant, patient_key, observed_at) — the patient screen's box; (admission_id, observed_at) where the
  stay is known — a stay's record; (tenant, received_at) where unmatched — the list; (tenant, entry_id) where
  set — the withdrawal's mark; (tenant, id) where a claim (state assigned, no patient yet) — `claims()`, which
  `reconcile` runs at start and hourly; UNIQUE (tenant, audit_id) where set — `reconcile` adds nothing twice;
  UNIQUE (tenant, received_key, code, observed_at, source, value) for device rows — a re-sent reading is
  recognised (D14).
* `ix_audit_tenant_patient_id` on `audit` (tenant, patient_id, id): the one-patient reads — the withdrawal's
  rebuild, trends, the single-patient task anchor (G3-01's open item O3). `IF NOT EXISTS`, as 0013's index. A
  plain CREATE INDEX takes a SHARE lock on `audit`, and Postgres holds it until the transaction commits — not
  only while the index builds: writes to `audit` wait that long. env.py runs every revision of one `alembic
  upgrade head` in a single transaction, so on a server that upgrades several revisions at once the lock lasts
  until the whole `upgrade head` commits. It happens when the API's start command runs `alembic upgrade head`,
  before it serves.

SCHEMA ONLY: no row is written (D19; `scripts/backfill_vital_readings.py` is the optional step for the patients
in bed). PURELY ADDITIVE: an image from before this revision serves against it. Downgrade drops the table with
its rows and the audit index; no audit content is touched (D20).
ONE STATEMENT PER op.execute (asyncpg; see 0004, 0010, 0013).

Revision ID: 0021
Revises: 0022
Create Date: 2026-11-11
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import DOUBLE_PRECISION, UUID

revision: str = "0021"
down_revision: Union[str, None] = "0022"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "vital_readings"
# Whole statements, not f-strings: the one-statement-per-execute check reads them (tests/test_audit_postgres.py).
_CREATE_AUDIT_INDEX = ("CREATE INDEX IF NOT EXISTS ix_audit_tenant_patient_id"
                       " ON audit (tenant, patient_id, id)")
_DROP_AUDIT_INDEX = "DROP INDEX IF EXISTS ix_audit_tenant_patient_id"


def upgrade() -> None:
    op.create_table(
        TABLE,
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("tenant", sa.String(64), nullable=False),
        sa.Column("received_key", sa.String(128), nullable=False),
        sa.Column("patient_key", sa.String(128), nullable=True),
        sa.Column("admission_id", UUID(as_uuid=False),
                  sa.ForeignKey("admissions.id", ondelete="RESTRICT", name="fk_vital_readings_admission"),
                  nullable=True),
        sa.Column("code", sa.String(32), nullable=False),
        sa.Column("value", DOUBLE_PRECISION(), nullable=False),
        sa.Column("unit", sa.String(16), nullable=False),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("origin", sa.String(8), nullable=False),
        sa.Column("source", sa.String(64), nullable=False),
        sa.Column("recorded_by", sa.String(128), nullable=True),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("unmatched_reason", sa.String(16), nullable=True),
        sa.Column("audit_id", sa.BigInteger(), nullable=True),
        sa.Column("entry_id", sa.BigInteger(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by", sa.String(128), nullable=True),
        sa.Column("resolve_reason", sa.String(200), nullable=True),
        sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("voided_by", sa.String(128), nullable=True),
        sa.Column("void_reason", sa.String(200), nullable=True),
        sa.CheckConstraint("origin IN ('device','manual')", name="ck_vital_readings_origin"),
        sa.CheckConstraint("state IN ('recorded','unmatched','assigned','rejected')", name="ck_vital_readings_state"),
        sa.CheckConstraint("unmatched_reason IS NULL OR unmatched_reason IN ('unknown','discharged')",
                           name="ck_vital_readings_reason"),
    )
    op.create_index("ix_vital_readings_tenant_patient_observed", TABLE, ["tenant", "patient_key", "observed_at"])
    op.create_index("ix_vital_readings_admission_observed", TABLE, ["admission_id", "observed_at"],
                    postgresql_where=sa.text("admission_id IS NOT NULL"))
    op.create_index("ix_vital_readings_unmatched", TABLE, ["tenant", "received_at"],
                    postgresql_where=sa.text("state = 'unmatched'"))
    op.create_index("ix_vital_readings_tenant_entry", TABLE, ["tenant", "entry_id"],
                    postgresql_where=sa.text("entry_id IS NOT NULL"))
    op.create_index("ix_vital_readings_claims", TABLE, ["tenant", "id"],
                    postgresql_where=sa.text("state = 'assigned' AND patient_key IS NULL"))
    op.create_index("uq_vital_readings_tenant_audit", TABLE, ["tenant", "audit_id"], unique=True,
                    postgresql_where=sa.text("audit_id IS NOT NULL"))
    op.create_index("uq_vital_readings_device", TABLE,
                    ["tenant", "received_key", "code", "observed_at", "source", "value"], unique=True,
                    postgresql_where=sa.text("origin = 'device'"))
    op.execute(_CREATE_AUDIT_INDEX)


def downgrade() -> None:
    op.execute(_DROP_AUDIT_INDEX)
    op.drop_index("uq_vital_readings_device", table_name=TABLE)
    op.drop_index("uq_vital_readings_tenant_audit", table_name=TABLE)
    op.drop_index("ix_vital_readings_claims", table_name=TABLE)
    op.drop_index("ix_vital_readings_tenant_entry", table_name=TABLE)
    op.drop_index("ix_vital_readings_unmatched", table_name=TABLE)
    op.drop_index("ix_vital_readings_admission_observed", table_name=TABLE)
    op.drop_index("ix_vital_readings_tenant_patient_observed", table_name=TABLE)
    op.drop_table(TABLE)

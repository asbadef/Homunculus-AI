# homunculus-engine/alembic/versions/0020_tres.py
"""TRƏS-01 (spec 2026-11-11, D3, D6, D26): `tres_settings` and `tres_deliveries`

Revision 0020, follows G3-04's 0019 (pharmacy_view). THIS ONE FILE IS THE WHOLE SLICE'S
MIGRATION (D26): while the branch is unmerged, each later phase adds its tables here (F1 the
practitioner identities and the department map, F2 the code lists and the diagnoses, F3 the
procedures, F4 the laboratory code map, F5 the discharge summaries) and extends the downgrade and
the test with them. Phase F0 creates the two tables it has models for:

* `tres_settings`: one row per tenant (FK tenants ON DELETE CASCADE) — `mode` off|validate|send
  (default off), `environment` test|live (default test), each environment's account (`test_*`,
  `live_*`: base URL, username, password, provider id, Organization id and name), `enabled_types`
  (JSONB, default all eight), `settle_hours` (0–168, default 24), `updated_at`, `updated_by`, and
  `session_refused_at` (null; when the platform last refused the tenant's login — the rounds pass
  it over while set). The two password columns hold Fernet ciphertext (`EncryptedString`). NO ROW
  is written: a tenant with no row reads as the defaults, and the feed is off.
* `tres_deliveries`: the ledger, one row per (tenant, environment, resource type, local id) —
  status, operation, the platform's id, the payload's keyed digest, the attempt count and the next
  attempt's time, a skip's reason code, the platform's last message (Fernet ciphertext) and the
  admission it belongs to (FK admissions ON DELETE SET NULL, indexed: a stay's rows are read by
  it, and an admission's delete must not scan the ledger). No request or response body.

NO PERMISSION ROW is written for `tres.manage` (D23): it is in no default group, and the system
group holds every key by rule at token issuance (auth/permissions.py) — as `summary.view` before it.

PURELY ADDITIVE: an image from before this revision serves against it (it never reads the new
tables); only its start command's `alembic upgrade head` refuses the unknown revision. Downgrade
drops exactly these two tables — and with them every tenant's account and the whole ledger.
ONE STATEMENT PER op.execute (asyncpg; see 0004, 0010, 0013) — this revision needs none.

Revision ID: 0020
Revises: 0019
Create Date: 2026-11-11
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "0020"
down_revision: Union[str, None] = "0019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SETTINGS = "tres_settings"
DELIVERIES = "tres_deliveries"
STATUS_INDEX = "ix_tres_deliveries_tenant_status"
ADMISSION_INDEX = "ix_tres_deliveries_admission_id"
#: homunculus.tres.models.ALL_TYPES_JSON — written out: a migration does not import the models.
ALL_TYPES = ('["patient", "practitioner", "encounter", "condition", "procedure", "vital", "lab", '
             '"composition"]')
#: admission/models.py PHI_COLUMN_LENGTH: the width of an `EncryptedString` column.
CIPHERTEXT = 1536


def _account(prefix: str) -> list[sa.Column]:
    return [
        sa.Column(f"{prefix}_base_url", sa.String(200), nullable=True),
        sa.Column(f"{prefix}_username", sa.String(120), nullable=True),
        sa.Column(f"{prefix}_password", sa.String(CIPHERTEXT), nullable=True),
        sa.Column(f"{prefix}_provider_id", sa.String(64), nullable=True),
        sa.Column(f"{prefix}_organization_id", sa.String(64), nullable=True),
        sa.Column(f"{prefix}_organization_name", sa.String(200), nullable=True),
    ]


def upgrade() -> None:
    op.create_table(
        SETTINGS,
        sa.Column("tenant_id", UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("mode", sa.String(16), nullable=False, server_default=sa.text("'off'")),
        sa.Column("environment", sa.String(8), nullable=False, server_default=sa.text("'test'")),
        *_account("test"),
        *_account("live"),
        sa.Column("enabled_types", JSONB(), nullable=False, server_default=sa.text(f"'{ALL_TYPES}'")),
        sa.Column("settle_hours", sa.SmallInteger(), nullable=False, server_default=sa.text("24")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_by", UUID(as_uuid=True), nullable=True),
        sa.Column("session_refused_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("mode IN ('off', 'validate', 'send')", name="ck_tres_settings_mode"),
        sa.CheckConstraint("environment IN ('test', 'live')", name="ck_tres_settings_environment"),
        sa.CheckConstraint("settle_hours BETWEEN 0 AND 168", name="ck_tres_settings_settle"),
    )
    op.create_table(
        DELIVERIES,
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("environment", sa.String(8), nullable=False),
        sa.Column("resource_type", sa.String(32), nullable=False),
        sa.Column("local_id", sa.String(96), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("operation", sa.String(16), nullable=True),
        sa.Column("remote_id", sa.String(64), nullable=True),
        sa.Column("payload_digest", sa.String(64), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reason", sa.String(48), nullable=True),
        sa.Column("last_error", sa.String(CIPHERTEXT), nullable=True),
        sa.Column("admission_id", UUID(as_uuid=True),
                  sa.ForeignKey("admissions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "environment", "resource_type", "local_id",
                            name="uq_tres_deliveries_key"),
        sa.CheckConstraint("environment IN ('test', 'live')", name="ck_tres_deliveries_environment"),
        sa.CheckConstraint("status IN ('pending', 'sent', 'validated', 'failed', 'skipped', 'stuck', "
                           "'deleted')", name="ck_tres_deliveries_status"),
        sa.CheckConstraint("operation IS NULL OR operation IN ('create', 'update', 'validate', "
                           "'delete')", name="ck_tres_deliveries_operation"),
    )
    op.create_index(STATUS_INDEX, DELIVERIES, ["tenant_id", "status"])
    op.create_index(ADMISSION_INDEX, DELIVERIES, ["admission_id"])


def downgrade() -> None:
    op.drop_index(ADMISSION_INDEX, table_name=DELIVERIES)
    op.drop_index(STATUS_INDEX, table_name=DELIVERIES)
    op.drop_table(DELIVERIES)
    op.drop_table(SETTINGS)

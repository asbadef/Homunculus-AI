"""escalation engine

Creates the alarm / escalation / break-glass tables per design doc §6.1–6.3
(alert tiers, per-signal snooze, escalation chain) and §3.5 (break-glass), plus
settled decisions S-05 (3/5/10-min escalation chain), S-06 (RRT via escalation
event), S-22 (snooze caps) and S-23 (30-min break-glass window).

CLINICAL RULE: these tables record alarm/workflow state only — never a diagnosis
or an order. PHI RULE: alerts reference patients by internal id; no
patient-identifiable data is stored here.

Revision ID: 0003
Revises: 0002
Create Date: 2026-07-29

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# create_type=False: types are created once, explicitly, via .create(checkfirst=True).
alert_tier_enum = postgresql.ENUM(
    "CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO",
    name="alerttier", create_type=False,
)
alert_status_enum = postgresql.ENUM(
    "FIRED", "ACKNOWLEDGED", "SNOOZED", "ESCALATED", "CLOSED",
    name="alertstatus", create_type=False,
)
escalation_step_enum = postgresql.ENUM(
    "NONE", "TIER_1_CHARGE_NURSE", "TIER_2_PHYSICIAN", "TIER_3_RRT",
    name="escalationstep", create_type=False,
)
snooze_reason_enum = postgresql.ENUM(
    "CLINICAL_DECISION_MADE", "ARTEFACT_OR_SIGNAL_NOISE", "PROCEDURE_IN_PROGRESS",
    "PATIENT_BASELINE", "OTHER", name="snoozereason", create_type=False,
)
break_glass_reason_enum = postgresql.ENUM(
    "CARDIAC_ARREST", "RAPID_DETERIORATION", "COVERING_ABSENT_TEAM", "OTHER",
    name="breakglassreason", create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    alert_tier_enum.create(bind, checkfirst=True)
    alert_status_enum.create(bind, checkfirst=True)
    escalation_step_enum.create(bind, checkfirst=True)
    snooze_reason_enum.create(bind, checkfirst=True)
    break_glass_reason_enum.create(bind, checkfirst=True)

    # --- alerts ---
    op.create_table(
        "alerts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("admission_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("admissions.id", ondelete="CASCADE"), nullable=True),
        sa.Column("patient_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("patients.id", ondelete="CASCADE"), nullable=True),
        sa.Column("unit_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("units.id", ondelete="SET NULL"), nullable=True),
        sa.Column("kind", sa.String(64), nullable=False),
        sa.Column("tier", alert_tier_enum, nullable=False),
        sa.Column("status", alert_status_enum, nullable=False, server_default="FIRED"),
        sa.Column("summary", sa.String(500), nullable=False, server_default=""),
        sa.Column("source_signal", sa.String(200), nullable=True),
        sa.Column("current_escalation_step", escalation_step_enum, nullable=False,
                  server_default="NONE"),
        sa.Column("fired_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("acknowledged_by", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("ack_reason", sa.String(64), nullable=True),
        sa.Column("ack_note", sa.Text, nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
    )
    op.create_index("ix_alerts_tenant_id", "alerts", ["tenant_id"])
    op.create_index("ix_alerts_admission_id", "alerts", ["admission_id"])
    op.create_index("ix_alerts_patient_id", "alerts", ["patient_id"])
    op.create_index("ix_alerts_unit_id", "alerts", ["unit_id"])
    op.create_index("ix_alerts_tier", "alerts", ["tier"])
    op.create_index("ix_alerts_status", "alerts", ["status"])
    op.create_index("ix_alerts_current_escalation_step", "alerts",
                    ["current_escalation_step"])

    # --- alert_snoozes ---
    op.create_table(
        "alert_snoozes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("alert_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("alerts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("snoozed_by", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reason", snooze_reason_enum, nullable=False),
        sa.Column("reason_text", sa.Text, nullable=True),
        sa.Column("snoozed_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
    )
    op.create_index("ix_alert_snoozes_alert_id", "alert_snoozes", ["alert_id"])

    # --- escalation_events ---
    op.create_table(
        "escalation_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("alert_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("alerts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("step", escalation_step_enum, nullable=False),
        sa.Column("target_role", sa.String(32), nullable=False),
        sa.Column("triggered_by", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("is_manual", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("reason", sa.Text, nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_escalation_events_alert_id", "escalation_events", ["alert_id"])
    op.create_index("ix_escalation_events_tenant_id", "escalation_events", ["tenant_id"])
    op.create_index("ix_escalation_events_is_active", "escalation_events", ["is_active"])

    # --- break_glass_sessions ---
    op.create_table(
        "break_glass_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("patient_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("patients.id", ondelete="CASCADE"), nullable=False),
        sa.Column("reason", break_glass_reason_enum, nullable=False),
        sa.Column("reason_text", sa.Text, nullable=True),
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("extension_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("accessed_records", postgresql.JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
    )
    op.create_index("ix_break_glass_tenant_id", "break_glass_sessions", ["tenant_id"])
    op.create_index("ix_break_glass_user_id", "break_glass_sessions", ["user_id"])
    op.create_index("ix_break_glass_patient_id", "break_glass_sessions", ["patient_id"])


def downgrade() -> None:
    op.drop_table("break_glass_sessions")
    op.drop_table("escalation_events")
    op.drop_table("alert_snoozes")
    op.drop_table("alerts")

    bind = op.get_bind()
    break_glass_reason_enum.drop(bind, checkfirst=True)
    snooze_reason_enum.drop(bind, checkfirst=True)
    escalation_step_enum.drop(bind, checkfirst=True)
    alert_status_enum.drop(bind, checkfirst=True)
    alert_tier_enum.drop(bind, checkfirst=True)

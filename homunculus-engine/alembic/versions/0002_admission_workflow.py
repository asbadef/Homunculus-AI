"""admission workflow

Creates patient/admission/care-team/nurse-assignment/handover tables per design
doc §4 (assignment workflows) and §5.2 (short admission note).

PHI RULE (§5.2): patient identity columns on `patients` are stored encrypted at
rest (Fernet) via the application EncryptedString type; at the SQL level they are
opaque text. No other table holds patient-identifiable data.

Hard constraint: a patient may have at most one ACTIVE admission at a time —
enforced by a partial unique index on admissions(patient_id) WHERE state='ACTIVE'.

Revision ID: 0002
Revises: 0001
Create Date: 2026-07-29

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# create_type=False: types are created once, explicitly, via .create(checkfirst=True).
admission_state_enum = postgresql.ENUM(
    "DRAFT", "ACTIVE", "PENDING_DISCHARGE", "PENDING_TRANSFER",
    "DISCHARGED", "TRANSFERRED", name="admissionstate", create_type=False,
)
source_of_admission_enum = postgresql.ENUM(
    "EMERGENCY", "ELECTIVE_SURGERY", "TRANSFER_INTERNAL", "TRANSFER_EXTERNAL",
    "OTHER", name="sourceofadmission", create_type=False,
)
care_team_role_enum = postgresql.ENUM(
    "ATTENDING", "ASSOCIATE_PHYSICIAN", "ONCALL_PHYSICIAN", name="careteamrole",
    create_type=False,
)
handover_status_enum = postgresql.ENUM(
    "OPEN", "OUTGOING_SIGNED", "COMPLETED", "EXPIRED", name="handoverstatus",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    admission_state_enum.create(bind, checkfirst=True)
    source_of_admission_enum.create(bind, checkfirst=True)
    care_team_role_enum.create(bind, checkfirst=True)
    handover_status_enum.create(bind, checkfirst=True)

    # --- patients (PHI, encrypted at rest) ---
    op.create_table(
        "patients",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("display_name", sa.String(512), nullable=False),
        sa.Column("date_of_birth", sa.String(512), nullable=False),
        sa.Column("sex", sa.String(512), nullable=False),
        sa.Column("his_patient_reference", sa.String(512), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
    )
    op.create_index("ix_patients_tenant_id", "patients", ["tenant_id"])

    # --- admissions (short admission note, non-PHI) ---
    op.create_table(
        "admissions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("patient_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("patients.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("state", admission_state_enum, nullable=False, server_default="DRAFT"),
        sa.Column("admission_datetime", sa.DateTime(timezone=True), nullable=False),
        sa.Column("admitting_unit_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("units.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("bed_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("beds.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("attending_physician_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("admission_diagnosis_free_text", sa.String(500), nullable=False),
        sa.Column("icd10_codes", postgresql.JSONB, nullable=True),
        sa.Column("active_comorbidities", postgresql.JSONB, nullable=True),
        sa.Column("active_medications_on_admission", postgresql.JSONB, nullable=True),
        sa.Column("known_allergies", postgresql.JSONB, nullable=True),
        sa.Column("baseline_spo2_range", sa.String(64), nullable=True),
        sa.Column("baseline_heart_rate_range", sa.String(64), nullable=True),
        sa.Column("baseline_blood_pressure_range", sa.String(64), nullable=True),
        sa.Column("baseline_respiratory_rate_range", sa.String(64), nullable=True),
        sa.Column("baseline_temperature_range", sa.String(64), nullable=True),
        sa.Column("weight_kg", sa.Float, nullable=True),
        sa.Column("height_cm", sa.Float, nullable=True),
        sa.Column("gestational_age_weeks", sa.Float, nullable=True),
        sa.Column("postnatal_day", sa.Integer, nullable=True),
        sa.Column("transplant_day_zero", sa.Date, nullable=True),
        sa.Column("cardiac_surgery_name", sa.String(200), nullable=True),
        sa.Column("admission_note_narrative", sa.Text, nullable=True),
        sa.Column("source_of_admission", source_of_admission_enum, nullable=True),
        sa.Column("signed_by", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("signed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("draft_reminder_sent", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("source_admission_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("admissions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("transfer_confirm_deadline", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
    )
    op.create_index("ix_admissions_patient_id", "admissions", ["patient_id"])
    op.create_index("ix_admissions_tenant_id", "admissions", ["tenant_id"])
    op.create_index("ix_admissions_state", "admissions", ["state"])
    op.create_index("ix_admissions_admitting_unit_id", "admissions", ["admitting_unit_id"])
    op.create_index("ix_admissions_bed_id", "admissions", ["bed_id"])
    # HARD CONSTRAINT: one ACTIVE admission per patient.
    op.create_index(
        "uq_one_active_admission_per_patient", "admissions", ["patient_id"],
        unique=True, postgresql_where=sa.text("state = 'ACTIVE'"),
    )

    # --- care_team_members ---
    op.create_table(
        "care_team_members",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("admission_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("admissions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", care_team_role_enum, nullable=False),
        sa.Column("granted_by_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("window_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("window_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("admission_id", "user_id", "is_active",
                            name="uq_care_team_active_member"),
    )
    op.create_index("ix_care_team_admission_id", "care_team_members", ["admission_id"])
    op.create_index("ix_care_team_user_id", "care_team_members", ["user_id"])

    # --- nurse_bed_assignments ---
    op.create_table(
        "nurse_bed_assignments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("unit_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("units.id", ondelete="CASCADE"), nullable=False),
        sa.Column("bed_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("beds.id", ondelete="CASCADE"), nullable=False),
        sa.Column("nurse_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("charge_nurse_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("shift_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("shift_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
    )
    op.create_index("ix_nurse_assign_unit_id", "nurse_bed_assignments", ["unit_id"])
    op.create_index("ix_nurse_assign_bed_id", "nurse_bed_assignments", ["bed_id"])
    op.create_index("ix_nurse_assign_nurse_id", "nurse_bed_assignments", ["nurse_id"])

    # --- handovers ---
    op.create_table(
        "handovers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("unit_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("units.id", ondelete="CASCADE"), nullable=False),
        sa.Column("outgoing_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("incoming_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("admission_ids", postgresql.JSONB, nullable=True),
        sa.Column("auto_populated_summary", postgresql.JSONB, nullable=True),
        sa.Column("narrative_note", sa.Text, nullable=True),
        sa.Column("status", handover_status_enum, nullable=False, server_default="OPEN"),
        sa.Column("bridge_opened_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("bridge_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("outgoing_signed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("incoming_signed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
    )
    op.create_index("ix_handovers_unit_id", "handovers", ["unit_id"])


def downgrade() -> None:
    op.drop_table("handovers")
    op.drop_table("nurse_bed_assignments")
    op.drop_table("care_team_members")
    op.drop_index("uq_one_active_admission_per_patient", table_name="admissions")
    op.drop_table("admissions")
    op.drop_table("patients")

    bind = op.get_bind()
    handover_status_enum.drop(bind, checkfirst=True)
    care_team_role_enum.drop(bind, checkfirst=True)
    source_of_admission_enum.drop(bind, checkfirst=True)
    admission_state_enum.drop(bind, checkfirst=True)

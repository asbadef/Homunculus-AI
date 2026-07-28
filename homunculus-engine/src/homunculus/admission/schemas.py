"""
Pydantic schemas for the admission workflow API.

PHI fields (patient identity) are accepted on input but never echoed back in a
list/board context; detail responses return them only to authorised care-team
members (enforced in the router).
"""
from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field

from homunculus.admission.models import (
    AdmissionState, CareTeamRole, HandoverStatus, Sex, SourceOfAdmission,
)


# ---------------------------------------------------------------------------
# Patient identity (PHI) — §5.2 fields 1–4, 28
# ---------------------------------------------------------------------------
class PatientIdentity(BaseModel):
    display_name: str = Field(..., min_length=1, max_length=200)   # #2
    date_of_birth: date                                            # #3
    sex: Sex                                                        # #4
    his_patient_reference: str | None = None                       # #28


class PatientResponse(BaseModel):
    id: uuid.UUID
    display_name: str
    date_of_birth: date
    sex: Sex
    his_patient_reference: str | None = None

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Short Admission Note — §5.2 fields 5–27
# ---------------------------------------------------------------------------
class AdmissionNoteFields(BaseModel):
    admission_datetime: datetime | None = None                     # #5 (defaults to now)
    admitting_unit_id: uuid.UUID                                   # #6
    bed_id: uuid.UUID                                              # #7
    attending_physician_id: uuid.UUID | None = None               # #8
    admission_diagnosis_free_text: str = Field(..., max_length=500)  # #9
    icd10_codes: list[str] | None = None                          # #10
    active_comorbidities: list[dict] | None = None                # #11
    active_medications_on_admission: list[dict] | None = None     # #12
    known_allergies: list[dict] | None = None                     # #13
    baseline_spo2_range: str | None = None                        # #14
    baseline_heart_rate_range: str | None = None                  # #15
    baseline_blood_pressure_range: str | None = None              # #16
    baseline_respiratory_rate_range: str | None = None            # #17
    baseline_temperature_range: str | None = None                 # #18
    weight_kg: float | None = None                                # #19
    height_cm: float | None = None                                # #20
    gestational_age_weeks: float | None = None                    # #21
    postnatal_day: int | None = None                              # #22
    transplant_day_zero: date | None = None                       # #23
    cardiac_surgery_name: str | None = None                       # #24
    admission_note_narrative: str | None = Field(default=None, max_length=2000)  # #25
    source_of_admission: SourceOfAdmission | None = None          # #26


class AdmissionCreate(BaseModel):
    """Create a DRAFT admission (§4.1 steps 2–3)."""
    patient: PatientIdentity
    note: AdmissionNoteFields


class AdmissionResponse(BaseModel):
    id: uuid.UUID
    patient_id: uuid.UUID
    tenant_id: uuid.UUID
    state: AdmissionState
    admission_datetime: datetime
    admitting_unit_id: uuid.UUID
    bed_id: uuid.UUID
    attending_physician_id: uuid.UUID | None
    admission_diagnosis_free_text: str
    icd10_codes: list | None
    active_comorbidities: list | None
    active_medications_on_admission: list | None
    known_allergies: list | None
    baseline_spo2_range: str | None
    baseline_heart_rate_range: str | None
    baseline_blood_pressure_range: str | None
    baseline_respiratory_rate_range: str | None
    baseline_temperature_range: str | None
    weight_kg: float | None
    height_cm: float | None
    gestational_age_weeks: float | None
    postnatal_day: int | None
    transplant_day_zero: date | None
    cardiac_surgery_name: str | None
    admission_note_narrative: str | None
    source_of_admission: SourceOfAdmission | None
    signed_by: uuid.UUID | None
    signed_at: datetime | None
    source_admission_id: uuid.UUID | None
    transfer_confirm_deadline: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Care team — §4.2–4.3
# ---------------------------------------------------------------------------
class CareTeamAdd(BaseModel):
    user_id: uuid.UUID
    role: CareTeamRole
    window_start: datetime | None = None   # required for ONCALL_PHYSICIAN
    window_end: datetime | None = None


class CareTeamMemberResponse(BaseModel):
    id: uuid.UUID
    admission_id: uuid.UUID
    user_id: uuid.UUID
    role: CareTeamRole
    granted_by_id: uuid.UUID | None
    window_start: datetime | None
    window_end: datetime | None
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Nurse–bed assignment — §4.4
# ---------------------------------------------------------------------------
class NurseBedAssignmentCreate(BaseModel):
    bed_id: uuid.UUID
    nurse_id: uuid.UUID
    shift_start: datetime
    shift_end: datetime


class ShiftScheduleCreate(BaseModel):
    unit_id: uuid.UUID
    assignments: list[NurseBedAssignmentCreate]


class NurseBedAssignmentResponse(BaseModel):
    id: uuid.UUID
    unit_id: uuid.UUID
    bed_id: uuid.UUID
    nurse_id: uuid.UUID
    charge_nurse_id: uuid.UUID | None
    shift_start: datetime
    shift_end: datetime
    is_active: bool

    model_config = {"from_attributes": True}


class ShiftScheduleResponse(BaseModel):
    assignments: list[NurseBedAssignmentResponse]
    warnings: list[str] = Field(default_factory=list)  # S-25 soft over-capacity warnings


# ---------------------------------------------------------------------------
# Transfer / discharge — §4.6, §4.7
# ---------------------------------------------------------------------------
class TransferInitiate(BaseModel):
    target_bed_id: uuid.UUID
    target_unit_id: uuid.UUID


class DischargeInitiate(BaseModel):
    discharge_summary: str = Field(..., max_length=2000)
    # Signals the caller acknowledges the confirmation dialog (S-28) — required
    # when a UNIT_PHYSICIAN (not the attending) performs the discharge.
    confirmed: bool = False


# ---------------------------------------------------------------------------
# Handover — §4.5, S-07, S-24
# ---------------------------------------------------------------------------
class HandoverOpen(BaseModel):
    unit_id: uuid.UUID
    incoming_user_id: uuid.UUID
    admission_ids: list[uuid.UUID] = Field(default_factory=list)


class HandoverSign(BaseModel):
    narrative_note: str | None = None


class HandoverResponse(BaseModel):
    id: uuid.UUID
    unit_id: uuid.UUID
    outgoing_user_id: uuid.UUID
    incoming_user_id: uuid.UUID
    admission_ids: list | None
    auto_populated_summary: dict | None
    narrative_note: str | None
    status: HandoverStatus
    bridge_opened_at: datetime
    bridge_expires_at: datetime
    outgoing_signed_at: datetime | None
    incoming_signed_at: datetime | None

    model_config = {"from_attributes": True}

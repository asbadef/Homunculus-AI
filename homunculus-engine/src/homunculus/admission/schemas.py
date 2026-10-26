"""
Pydantic schemas for the admission workflow API.

PHI fields (patient identity) are accepted on input but never echoed back in a
list/board context. They are returned only by the patient-detail endpoint
(`GET /admissions/{id}/patient`), to holders of `admissions.view` in the patient's
own tenant; reads of it are not audited yet.

The admission form's and the discharge decision's request models (Group 2 · B1a) refuse a field
they do not have (`extra="forbid"`: a misspelt field is an error, not a value quietly dropped),
bound every text by the column it lands in, and hold their texts as `FormText`.
"""
from __future__ import annotations

import unicodedata
import uuid
from datetime import date, datetime

from typing import Annotated, Any, Literal

from fastapi import HTTPException
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, ValidationInfo

from homunculus.admission.errors import field_invalid
from homunculus.admission.models import (
    AdmissionState, AdmissionType, BloodGroup, CareTeamRole, Consent, DischargeDisposition,
    HandoverStatus, Sex, SourceOfAdmission,
)


# ---------------------------------------------------------------------------
# Text a form may send (Group 2 · B1a)
# ---------------------------------------------------------------------------
#: The control characters a text may hold: tab, line feed and carriage return — a note has lines.
_KEPT_CONTROLS = frozenset("\t\n\r")


def _has_control(text: str) -> bool:
    """A control character (Unicode category Cc: NUL, ESC, DEL, the C1 block …) other than tab
    and the line breaks. PostgreSQL refuses NUL in text and in JSONB — a 500 — and the others
    have no business in a name or a note: they forge or hide what a screen or an export shows."""
    return any(unicodedata.category(ch) == "Cc" and ch not in _KEPT_CONTROLS for ch in text)


def _refusal(info: ValidationInfo) -> HTTPException:
    """The coded 422 every form refusal answers, naming the field (admission/errors.py).

    An HTTPException, not a ValueError, on purpose: pydantic passes any exception but ValueError
    and AssertionError straight through, so this one leaves the reading of the body as it is and
    FastAPI answers it as `{"detail": {"code": "field_invalid:<field>", …}}` — the shape of every
    other form refusal, which the dashboard maps by its code — rather than a 422 list whose words
    it cannot translate. The value is never repeated in the answer."""
    return field_invalid(info.field_name or "text",
                         "A control character (other than tab or a line break) is not text.").http()


def _form_text(value: str | None, info: ValidationInfo) -> str | None:
    if value is not None and _has_control(value):
        raise _refusal(info)
    return value


def _holds_control(item: Any) -> bool:
    if isinstance(item, str):
        return _has_control(item)
    if isinstance(item, dict):
        return any(_holds_control(key) or _holds_control(value) for key, value in item.items())
    if isinstance(item, list):
        return any(_holds_control(value) for value in item)
    return False


def _form_json(value: list[dict] | None, info: ValidationInfo) -> list[dict] | None:
    if value is not None and _holds_control(value):
        raise _refusal(info)
    return value


#: Every text field of the admission form and the discharge decision, in the clear or encrypted —
#: a name never stores a control character either. A required text is `FormText`; an optional one
#: is `OptionalFormText`, never `FormText | None`: pydantic cannot reach through that union to the
#: string, so a `Field(max_length=…)` on it is checked by its generic length check (`too_long`,
#: which the dashboard reads as a list's) instead of the string's (`string_too_long`).
FormText = Annotated[str, AfterValidator(_form_text)]
OptionalFormText = Annotated[str | None, AfterValidator(_form_text)]
#: The note's free-form JSON lists (§5.2 fields 11–13): no control character in a key or a value.
FormJson = Annotated[list[dict] | None, AfterValidator(_form_json)]


# ---------------------------------------------------------------------------
# Patient identity (PHI) — §5.2 fields 1–4, 28
# ---------------------------------------------------------------------------
class PatientIdentity(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_name: FormText = Field(..., min_length=1, max_length=200)   # #2
    date_of_birth: date                                            # #3
    sex: Sex                                                        # #4
    his_patient_reference: OptionalFormText = Field(default=None, max_length=64)   # #28
    # Group 2 · B1a — the prototype's form (spec §5.2). Encrypted at rest. `max_length` counts
    # characters, and a character is up to four bytes of UTF-8: every encrypted column is wide
    # enough for the ciphertext of the longest bound here in four-byte characters
    # (admission/models.py PHI_COLUMN_LENGTH; tests/test_admission_form.py checks each bound
    # against its column). The rules a value must keep beyond its type are in admission/form.py.
    father_name: OptionalFormText = Field(default=None, max_length=100)
    nationality: OptionalFormText = Field(default=None, max_length=64)
    national_id: OptionalFormText = Field(default=None, max_length=16)   # FİN: 7 letters or digits
    passport_no: OptionalFormText = Field(default=None, max_length=32)
    phone: OptionalFormText = Field(default=None, max_length=32)
    relative_name: OptionalFormText = Field(default=None, max_length=100)
    relative_relation: OptionalFormText = Field(default=None, max_length=64)
    relative_phone: OptionalFormText = Field(default=None, max_length=32)
    companion_name: OptionalFormText = Field(default=None, max_length=100)
    consent: Consent | None = None                                  # required by admission/form.py
    sms_permitted: bool = False


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
    model_config = ConfigDict(extra="forbid")

    admission_datetime: datetime | None = None                     # #5 (defaults to now)
    admitting_unit_id: uuid.UUID                                   # #6
    bed_id: uuid.UUID                                              # #7
    attending_physician_id: uuid.UUID | None = None               # #8
    admission_diagnosis_free_text: FormText = Field(..., max_length=500)  # #9
    icd10_codes: list[FormText] | None = None                     # #10
    active_comorbidities: FormJson = None                         # #11
    active_medications_on_admission: FormJson = None              # #12
    known_allergies: FormJson = None                              # #13
    # The bounds are the columns' (admission/models.py): longer is a 422 here, not a 500 there.
    baseline_spo2_range: OptionalFormText = Field(default=None, max_length=64)              # #14
    baseline_heart_rate_range: OptionalFormText = Field(default=None, max_length=64)        # #15
    baseline_blood_pressure_range: OptionalFormText = Field(default=None, max_length=64)    # #16
    baseline_respiratory_rate_range: OptionalFormText = Field(default=None, max_length=64)  # #17
    baseline_temperature_range: OptionalFormText = Field(default=None, max_length=64)       # #18
    # Strict: JSON `true` is not 1 kg and "72" is not a number (an integer is).
    weight_kg: float | None = Field(default=None, strict=True)    # #19
    height_cm: float | None = Field(default=None, strict=True)    # #20
    gestational_age_weeks: float | None = None                    # #21
    postnatal_day: int | None = None                              # #22
    transplant_day_zero: date | None = None                       # #23
    cardiac_surgery_name: OptionalFormText = Field(default=None, max_length=200)  # #24
    admission_note_narrative: OptionalFormText = Field(default=None, max_length=2000)  # #25
    source_of_admission: SourceOfAdmission | None = None          # #26
    # Group 2 · B1a (spec §5.2); admission/form.py says which are required and how they combine.
    admission_type: AdmissionType | None = None
    blood_group: BloodGroup | None = None
    allergies_text: OptionalFormText = Field(default=None, max_length=500)
    no_known_allergy: bool = False
    comorbidity_codes: list[FormText] | None = Field(default=None, max_length=10)
    comorbidities_text: OptionalFormText = Field(default=None, max_length=500)


class AdmissionCreate(BaseModel):
    """Create a DRAFT admission (§4.1 steps 2–3)."""
    model_config = ConfigDict(extra="forbid")

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
    # Group 2 · B1a
    admission_type: AdmissionType | None = None
    blood_group: BloodGroup | None = None
    allergies_text: str | None = None
    no_known_allergy: bool = False
    comorbidity_codes: list | None = None
    comorbidities_text: str | None = None
    discharge_disposition: DischargeDisposition | None = None
    discharge_institution: str | None = None
    discharge_reported_by: str | None = None
    discharge_at: datetime | None = None
    discharge_note: str | None = None

    model_config = {"from_attributes": True}


# What did not reach the engine after an admission or a discharge was written (spec §3.1 step 3):
# the record stands either way, and the screen says which part to enter by hand.
EngineWrite = Literal["ok", "failed", "skipped"]


class EngineWrites(BaseModel):
    weight: EngineWrite
    profile: EngineWrite
    board: EngineWrite


class AdmitResponse(AdmissionResponse):
    """POST /admissions: the admission, the patient number the nurse enters on the device, and
    which of the engine writes landed."""
    patient_number: str
    engine: EngineWrites


class AdmissionRow(AdmissionResponse):
    """GET /admissions: one row of the Taburcu and Yataklar lists, with the names a screen shows
    (never a UUID). `display_name` is PHI, as on the board, for holders of admissions.view."""
    patient_number: str
    display_name: str
    bed_label: str
    room_name: str
    unit_name: str


class DischargeConfirmResponse(AdmissionResponse):
    """POST …/discharge/confirm: the admission, and whether its card left the board."""
    board: EngineWrite


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


class DischargeStart(BaseModel):
    """The physician's decision (Group 2 · B1a, spec D7 and §3.3): where the patient goes, when,
    and a note. `institution` is required for OTHER_INSTITUTION and refused for any other;
    `reported_by` is written for EXITUS only (the caller unless another name is written);
    `discharge_at` defaults to now and is never in the future (admission/form.py)."""
    model_config = ConfigDict(extra="forbid")

    disposition: DischargeDisposition
    institution: OptionalFormText = Field(default=None, max_length=200)
    reported_by: OptionalFormText = Field(default=None, max_length=200)
    discharge_at: datetime | None = None
    note: OptionalFormText = Field(default=None, max_length=2000)


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

# homunculus-engine/src/homunculus/admission/form.py
"""What an admission and a discharge must hold before they are written (Group 2 · B1a, §5.2, §3.3).

The screen keeps "Kabul et" disabled while a required field is missing and names each one; the
server checks again here, because a screen is not the only client and a rule the server does not
hold is not a rule. A refusal names ONE field — the first wrong one, in the form's order — as
`field_invalid:<field>` (admission/errors.py), the field named as the request body names it.

Types and lengths are pydantic's (admission/schemas.py); this module holds the rules a value
must keep beyond its type. The bounds on weight and height catch a slipped decimal point or a
wrong unit, not clinical judgement: weight is the engine's own charting bound
(`api/clinical.PLAUSIBLE`), so a weight the form accepts is one the engine will take.
"""
from __future__ import annotations

import math
import re
from datetime import date, datetime, timedelta

from homunculus.admission.errors import field_invalid
from homunculus.admission.models import DischargeDisposition
from homunculus.admission.schemas import AdmissionCreate, DischargeStart
from homunculus.api.clinical import PLAUSIBLE
from homunculus.canonical import SignalCode

#: The comorbidity codes the engine reads (rules/patient_relative.py `_COMORBIDITY_EXPLAINS`):
#: the form's checkboxes send these and nothing else. Free text is stored, never sent as a code.
COMORBIDITY_CODES = ("copd", "chronic_respiratory_failure", "chronic_oxygen", "dementia",
                     "chronic_confusion")
WEIGHT_KG = PLAUSIBLE[SignalCode.WEIGHT_KG]
HEIGHT_CM = (20.0, 260.0)
#: FİN, the Azerbaijani personal identification code: seven letters or digits.
NATIONAL_ID = re.compile(r"[A-Za-z0-9]{7}")
PHONE = re.compile(r"\+?[0-9 ()-]{5,32}")
#: A discharge time a few minutes ahead of the server is a clock, not a claim about the future.
CLOCK_SLACK = timedelta(minutes=2)


def _blank(value: str | None) -> bool:
    return value is None or not value.strip()


def _outside(value: float | None, bounds: tuple[float, float]) -> bool:
    return value is not None and (not math.isfinite(value) or not bounds[0] <= value <= bounds[1])


def check_admission(payload: AdmissionCreate, *, today: date) -> None:
    """Refuse the first field that breaks a rule, in the form's order; return quietly otherwise."""
    p, n = payload.patient, payload.note
    if _blank(p.display_name):
        raise field_invalid("display_name", "The patient's name is required.")
    if p.date_of_birth > today:
        raise field_invalid("date_of_birth", "The date of birth is in the future.")
    if not _blank(p.national_id) and not NATIONAL_ID.fullmatch(p.national_id.strip()):
        raise field_invalid("national_id", "FİN is seven letters or digits.")
    for name in ("phone", "relative_phone"):
        value = getattr(p, name)
        if not _blank(value) and not PHONE.fullmatch(value.strip()):
            raise field_invalid(name, "A phone number holds digits, spaces, + ( ) and - only.")
    if n.admission_type is None:
        raise field_invalid("admission_type", "The admission type is required.")
    if _blank(n.admission_diagnosis_free_text):
        raise field_invalid("admission_diagnosis_free_text", "The admission diagnosis is required.")
    if _outside(n.weight_kg, WEIGHT_KG):
        raise field_invalid("weight_kg", f"Weight is between {WEIGHT_KG[0]} and {WEIGHT_KG[1]} kg.")
    if _outside(n.height_cm, HEIGHT_CM):
        raise field_invalid("height_cm", f"Height is between {HEIGHT_CM[0]} and {HEIGHT_CM[1]} cm.")
    if _blank(n.allergies_text) == (not n.no_known_allergy):
        raise field_invalid("allergies_text",
                            "Write the known allergy, or mark that none is known — one of the two.")
    unknown = sorted(set(n.comorbidity_codes or ()) - set(COMORBIDITY_CODES))
    if unknown:
        raise field_invalid("comorbidity_codes", f"Not a code the engine reads: {', '.join(unknown)}.")
    if p.consent is None:
        raise field_invalid("consent", "The consent answer is required.")


def check_discharge(payload: DischargeStart, *, now: datetime,
                    admitted_at: datetime | None) -> None:
    """Refuse a discharge decision that is incomplete or impossible."""
    if (payload.disposition == DischargeDisposition.OTHER_INSTITUTION
            and _blank(payload.institution)):
        raise field_invalid("institution", "Name the institution the patient goes to.")
    at = payload.discharge_at
    if at is not None:
        if at.tzinfo is None:
            raise field_invalid("discharge_at", "The discharge time must carry its time zone.")
        if at > now + CLOCK_SLACK:
            raise field_invalid("discharge_at", "The discharge time is in the future.")
        if admitted_at is not None and at < admitted_at:
            raise field_invalid("discharge_at", "The discharge time is before the admission.")

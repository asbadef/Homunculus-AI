# homunculus-engine/src/homunculus/admission/form.py
"""What an admission and a discharge must hold before they are written (Group 2 · B1a, §5.2, §3.3).

The screen keeps "Kabul et" disabled while a required field is missing and names each one; the
server checks again here, because a screen is not the only client and a rule the server does not
hold is not a rule. A refusal names ONE field — the first wrong one, in the form's order — as
`field_invalid:<field>` (admission/errors.py), the field named as the request body names it.

Types and lengths are pydantic's (admission/schemas.py); this module holds the rules a value
must keep beyond its type. A control character in any text is refused while the body is read
(`schemas.FormText`), before these rules, with the same `field_invalid:<field>`. The bounds on
weight and height catch a slipped decimal point or a wrong unit, not clinical judgement: weight
is the engine's own charting bound (`api/clinical.PLAUSIBLE`), so a weight the form accepts is one
the engine will take.

`today` and `now` are the server's, never the request's. `now` must carry its time zone; a naive
one is the caller's mistake and a ValueError that says so, not Python's "can't compare
offset-naive and offset-aware datetimes".
"""
from __future__ import annotations

import math
import re
import unicodedata
from datetime import date, datetime, timedelta, timezone

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
#: The oldest date of birth taken: anything earlier is a slipped digit, not a patient.
EARLIEST_BIRTH = date(1900, 1, 1)
#: A date of birth may be one day after `today`. Callers pass the hospital's LOCAL date
#: (`Tenant.timezone`); the day of slack covers one that passed the UTC date instead — in Baku
#: (UTC+4) the local date is a day ahead of UTC's from 00:00 to 03:59, and a child born then
#: would be refused. No time zone is more than a day ahead of UTC, so two days ahead is wrong
#: wherever the hospital is.
BIRTH_SLACK = timedelta(days=1)
#: FİN, the Azerbaijani personal identification code: seven letters or digits.
NATIONAL_ID = re.compile(r"[A-Za-z0-9]{7}")
PHONE = re.compile(r"\+?[0-9 ()-]{5,32}")
#: A phone number holds at least this many digits: "((((()))))" fits PHONE and calls nobody.
PHONE_DIGITS = 5
#: A time a few minutes ahead of the server — an admission's, a discharge's — is a clock, not a
#: claim about the future.
CLOCK_SLACK = timedelta(minutes=2)
#: Letters (category Lo) that show nothing: the Hangul fillers. A name of them is a blank name.
_INVISIBLE_LETTERS = frozenset("ᅟᅠㅤﾠ")


def _blank(value: str | None) -> bool:
    return value is None or not value.strip()


def _readable(value: str) -> bool:
    """At least one letter or digit a reader can see: not only spaces, punctuation, zero-width or
    formatting characters, a blank Braille pattern (U+2800, a symbol) or a Hangul filler."""
    return any(unicodedata.category(ch)[0] in "LN" and ch not in _INVISIBLE_LETTERS
               for ch in value)


def _outside(value: float | None, bounds: tuple[float, float]) -> bool:
    return value is not None and (not math.isfinite(value) or not bounds[0] <= value <= bounds[1])


def _aware(moment: datetime) -> bool:
    return moment.tzinfo is not None and moment.utcoffset() is not None


def _server_clock(name: str, moment: datetime | None) -> None:
    """A clock the server passed in must carry its time zone (see the module's docstring)."""
    if moment is not None and not _aware(moment):
        raise ValueError(f"`{name}` must carry its time zone (an aware datetime, e.g. UTC).")


def check_admission(payload: AdmissionCreate, *, today: date, now: datetime | None = None) -> None:
    """Refuse the first field that breaks a rule, in the form's order; return quietly otherwise.

    `today` is the hospital's local date (`BIRTH_SLACK` says why a UTC date still works); `now`
    the server's clock, the current UTC time when not given."""
    now = datetime.now(timezone.utc) if now is None else now
    _server_clock("now", now)
    p, n = payload.patient, payload.note
    if _blank(p.display_name) or not _readable(p.display_name):
        raise field_invalid("display_name",
                            "The patient's name is required and holds a letter or a digit.")
    for name in ("father_name", "relative_name", "companion_name"):
        value = getattr(p, name)
        if not _blank(value) and not _readable(value):
            raise field_invalid(name, "A name holds at least one letter or digit.")
    if p.date_of_birth > today + BIRTH_SLACK:
        raise field_invalid("date_of_birth", "The date of birth is in the future.")
    if p.date_of_birth < EARLIEST_BIRTH:
        raise field_invalid("date_of_birth", "The date of birth is before 1900.")
    if not _blank(p.national_id) and not NATIONAL_ID.fullmatch(p.national_id.strip()):
        raise field_invalid("national_id", "FİN is seven letters or digits.")
    for name in ("phone", "relative_phone"):
        value = getattr(p, name)
        if not _blank(value) and not (PHONE.fullmatch(value.strip())
                                      and sum(ch.isdigit() for ch in value) >= PHONE_DIGITS):
            raise field_invalid(name, "A phone number holds at least five digits, and spaces,"
                                      " + ( ) and - only.")
    at = n.admission_datetime
    if at is not None and not _aware(at):
        raise field_invalid("admission_datetime", "The admission time must carry its time zone.")
    if at is not None and at > now + CLOCK_SLACK:
        raise field_invalid("admission_datetime", "The admission time is in the future.")
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
    """Refuse a discharge decision that is incomplete, impossible, or carries a field that belongs
    to another disposition (a blank `institution` or `reported_by` is not written, so carries
    nothing). `now` and `admitted_at` are the server's and carry their time zone."""
    _server_clock("now", now)
    _server_clock("admitted_at", admitted_at)
    elsewhere = payload.disposition == DischargeDisposition.OTHER_INSTITUTION
    if elsewhere and (_blank(payload.institution) or not _readable(payload.institution)):
        raise field_invalid("institution", "Name the institution the patient goes to.")
    # A blank box is a box left empty (the schema stores it as None; `_blank` asks the same of a
    # payload that was not shaped by it): refused only when something is written in it.
    if not elsewhere and not _blank(payload.institution):
        raise field_invalid("institution",
                            "An institution is named only for a discharge to another institution.")
    if not _blank(payload.reported_by):
        if payload.disposition != DischargeDisposition.EXITUS:
            raise field_invalid("reported_by", "Who reported it is written only for an exitus.")
        if not _readable(payload.reported_by):
            raise field_invalid("reported_by", "A name holds at least one letter or digit.")
    at = payload.discharge_at
    if at is not None:
        if not _aware(at):
            raise field_invalid("discharge_at", "The discharge time must carry its time zone.")
        if at > now + CLOCK_SLACK:
            raise field_invalid("discharge_at", "The discharge time is in the future.")
        if admitted_at is not None and at < admitted_at:
            raise field_invalid("discharge_at", "The discharge time is before the admission.")

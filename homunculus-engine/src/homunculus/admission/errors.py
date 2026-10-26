# homunculus-engine/src/homunculus/admission/errors.py
"""The refusals of the admission and structure routes, each with a stable code (spec §4.4).

A refusal answers `{"detail": {"code": "<code>", "message": "<words>"}}`. The dashboard maps the
CODE to the reader's language (`dashboard/src/live/apiErrors.js`, `ADMISSION_CODE_KEYS`) and
never the words, which are English and for a support call; `apiErrors.test.js` reads this file and
fails when a code below is not mapped. A field the form got wrong is `field_invalid:<field>`, the
field named as the request body names it.

The codes are part of the API: renaming one is a change to every screen that reads it.
"""
from __future__ import annotations

from fastapi import HTTPException

BED_NOT_AVAILABLE = "bed_not_available"          # the bed is not AVAILABLE (occupied, cleaning…)
BED_CLOSED = "bed_closed"                        # the bed, its room or its unit is closed
OUT_OF_SCOPE = "out_of_scope"                    # the bed's unit is not one of the caller's
CRITICAL_ALARM_OPEN = "critical_alarm_open"      # a critical alert nobody acknowledged
PATIENT_NUMBER_EXHAUSTED = "patient_number_exhausted"   # 99 999 numbers taken this year
INVALID_TRANSITION = "invalid_transition"        # the admission or bed is not in a state for it
MISSING_ATTENDING = "missing_attending"          # a DRAFT cannot become ACTIVE without one
OPEN_ADMISSION = "open_admission"                # the patient already has an open admission
BED_IN_USE = "bed_in_use"                        # a bed holding a patient cannot be closed
HAS_OPEN_BEDS = "has_open_beds"                  # a unit or room with an open bed cannot be closed
NAME_TAKEN = "name_taken"                        # another room of the unit has that name
BED_LABEL_TAKEN = "bed_label_taken"              # another bed of the UNIT (any room) has that label
REQUEST_CONFLICT = "request_conflict"            # this request_id came before with another form
FIELD_INVALID = "field_invalid"                  # + ":<field>"

#: Every code but FIELD_INVALID, which travels with its field.
CODES = frozenset({
    BED_NOT_AVAILABLE, BED_CLOSED, OUT_OF_SCOPE, CRITICAL_ALARM_OPEN, PATIENT_NUMBER_EXHAUSTED,
    INVALID_TRANSITION, MISSING_ATTENDING, OPEN_ADMISSION, BED_IN_USE, HAS_OPEN_BEDS, NAME_TAKEN,
    BED_LABEL_TAKEN, REQUEST_CONFLICT,
})


class Refusal(Exception):
    """A refusal with its HTTP status, its code and its words — and, for the few refusals a screen
    names something from, `extra` keys beside them in the detail (never a name: an id or a
    number; `request_conflict` carries the earlier admission's `patient_number`)."""

    def __init__(self, status: int, code: str, message: str, extra: dict | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.extra = dict(extra or {})

    def http(self) -> HTTPException:
        return HTTPException(status_code=self.status,
                             detail={**self.extra, "code": self.code, "message": self.message})


def field_invalid(field: str, message: str) -> Refusal:
    """A 422 naming the one field it is about (the first wrong one, in the form's order)."""
    return Refusal(422, f"{FIELD_INVALID}:{field}", message)

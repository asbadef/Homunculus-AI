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
BED_IN_USE = "bed_in_use"                        # a bed holding a patient: not closed, not freed
HAS_OPEN_BEDS = "has_open_beds"                  # a unit or room with an open bed cannot be closed
NAME_TAKEN = "name_taken"                        # another room of the unit has that name
BED_LABEL_TAKEN = "bed_label_taken"              # another bed of the UNIT (any room) has that label
REQUEST_CONFLICT = "request_conflict"            # this request_id came before with another form
BOARD_NOT_CLEARED = "board_not_cleared"          # the bed's last patient's card still stands
TRANSFER_UNAVAILABLE = "transfer_unavailable"    # the transfer routes are closed (A-37)
# The same person (name and birth date) already has an open admission in the tenant (A-37).
DUPLICATE_OPEN_ADMISSION = "duplicate_open_admission"
FIELD_INVALID = "field_invalid"                  # + ":<field>"
# G2 monitor→bed editor (spec 2026-10-28 §4.5)
MONITOR_LANE_OFF = "monitor_lane_off"            # the strip is off, or the caller is not its hospital
DEVICE_UNKNOWN = "device_unknown"                # the worker never reported it and no row holds it
BED_OCCUPIED = "bed_occupied"                    # an admitted patient there, and no confirm_occupied
MAPPING_CHANGED = "mapping_changed"              # `expected` is not what holds, or an index fired
BED_HAS_MONITOR = "bed_has_monitor"              # Yapı: a bed with a monitor bound is not closed

#: Every code but FIELD_INVALID, which travels with its field.
CODES = frozenset({
    BED_NOT_AVAILABLE, BED_CLOSED, OUT_OF_SCOPE, CRITICAL_ALARM_OPEN, PATIENT_NUMBER_EXHAUSTED,
    INVALID_TRANSITION, MISSING_ATTENDING, OPEN_ADMISSION, BED_IN_USE, HAS_OPEN_BEDS, NAME_TAKEN,
    BED_LABEL_TAKEN, REQUEST_CONFLICT, BOARD_NOT_CLEARED, TRANSFER_UNAVAILABLE,
    DUPLICATE_OPEN_ADMISSION,
    MONITOR_LANE_OFF, DEVICE_UNKNOWN, BED_OCCUPIED, MAPPING_CHANGED, BED_HAS_MONITOR,
})

# G2-B1d — the protocol number and its label (spec 2026-11-01 §7). Its own block AFTER `CODES`,
# which it widens: the monitor→bed editor's block sits inside `CODES`, and two hunks with untouched
# lines between them merge without a conflict (E15).
PROTOCOL_NOT_CONFIGURED = "protocol_not_configured"   # no start number set: no admission (D5)
PROTOCOL_EXHAUSTED = "protocol_exhausted"             # the sequence passed 999 999 999 999
PROTOCOL_FORMAT = "protocol_format"                   # a start number that is not twelve digits
PROTOCOL_NOT_FORWARD = "protocol_not_forward"         # a start number not above the last issued
LABEL_SIZE = "label_size"                             # width 30–110 mm, height 20–80 mm
LABEL_TOO_NARROW = "label_too_narrow"                 # the barcode does not fit that width
LABEL_DPI = "label_dpi"                               # the printer is 203 or 300 dpi
NO_PROTOCOL = "no_protocol"                           # an admission without a protocol: no label

CODES = CODES | frozenset({
    PROTOCOL_NOT_CONFIGURED, PROTOCOL_EXHAUSTED, PROTOCOL_FORMAT, PROTOCOL_NOT_FORWARD,
    LABEL_SIZE, LABEL_TOO_NARROW, LABEL_DPI, NO_PROTOCOL,
})

# G2-B3a — Doluluk (spec D5, X1). Its own block after B1d's, which it widens the same way.
BED_RESERVED = "bed_reserved"                          # a RESERVED bed, and no confirm_reserved
CODES = CODES | frozenset({BED_RESERVED})

# G2-B1c — Bakım ekibi (spec §5.6). Its own block after B3a's, which it widens the same way.
CARE_TEAM_CONFLICT = "care_team_conflict"              # already on the team, or lost at an index (T7)
CARE_TEAM_NOT_PHYSICIAN = "care_team_not_physician"    # the member, claimer or attending made (T1)
CARE_TEAM_ATTENDING_REQUIRED = "care_team_attending_required"   # the ATTENDING row never ends alone (T5)
CODES = CODES | frozenset({CARE_TEAM_CONFLICT, CARE_TEAM_NOT_PHYSICIAN, CARE_TEAM_ATTENDING_REQUIRED})


class Refusal(Exception):
    """A refusal with its HTTP status, its code and its words — and, for the few refusals a screen
    names something from, `extra` keys beside them in the detail (never a name: an id or a
    number; `request_conflict`, `board_not_cleared` and `duplicate_open_admission` carry an
    admission's `patient_number`, and only to a caller whose units hold its bed)."""

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

# homunculus-engine/src/homunculus/tres/errors.py
"""The refusals of the `/admin/tres/*` routes, each with a stable code (TRƏS-01, spec §6).

A refusal answers `{"detail": {"code": "<code>", "message": "<words>"}}`, as the admission routes'
do (`admission/errors.py` `Refusal`, which this module uses). The dashboard maps the CODE to the
reader's language (`dashboard/src/live/apiErrors.js`, `TRES_CODE_KEYS`) and never the words, which
are English and for a support call.

Its own module, not `admission/errors.py`: that file's `CODES` is held one-to-one to the dashboard's
`ADMISSION_CODE_KEYS` by a test, and the two halves of this slice are built apart.

The codes are part of the API: renaming one is a change to the tab that reads it."""
from __future__ import annotations

from homunculus.admission.errors import Refusal

TRES_MODE = "tres_mode"                              # not off, validate or send
TRES_ENVIRONMENT = "tres_environment"                # not test or live
TRES_SETTLE_HOURS = "tres_settle_hours"              # not 0–168
TRES_TYPES = "tres_types"                            # an unknown resource type, or one twice
TRES_BASE_URL = "tres_base_url"                      # not an https:// address of at most 200 characters
TRES_FIELD_LENGTH = "tres_field_length"              # an account field longer than its column
EGRESS_OFF = "egress_off"                            # the install's lock is closed (D2 (b))
TRES_ACCOUNT_INCOMPLETE = "tres_account_incomplete"  # the selected environment's account lacks a part
TRES_HOST_NOT_ALLOWED = "tres_host_not_allowed"      # a host the install does not allow (TRES_HOSTS)
TRES_LIVE_CLOSED = "tres_live_closed"                # F1: the live platform is closed in this version (O5, O11)
TRES_UNIT_UNKNOWN = "tres_unit_unknown"              # F1: a unit not the tenant's, or named twice (D17)
TRES_DEPARTMENT_CODE = "tres_department_code"        # F1: a department code empty or over 32 characters
TRES_DEPARTMENT_DISPLAY = "tres_department_display"  # F1: a department name empty or over 200 characters
TRES_USER_UNKNOWN = "tres_user_unknown"              # F1: no active member of the tenant by that id (D16)
TRES_FIN_FORMAT = "tres_fin_format"                  # F1: a FİN that is not seven Latin capitals or digits
TRES_NAME = "tres_name"                              # F1: a practitioner's name part empty or over 100 characters
TRES_FILTER = "tres_filter"                          # F1: a ledger filter that names no status, type or environment
TRES_CURSOR = "tres_cursor"                          # F1: a cursor that does not read as one (unsigned: a time and an id)
TRES_STAY_UNKNOWN = "tres_stay_unknown"              # F1: no stay of this tenant by that id or key
TRES_OFF = "tres_off"                                # F1: the tenant's mode is off (a hand send, a retry)
TRES_BUSY = "tres_busy"                              # F1: another send of this stay holds its rows (N12): try again
TRES_LOGIN_REFUSED = "tres_login_refused"            # F1: the platform refused the login; the tenant is parked
TRES_PLATFORM_UNAVAILABLE = "tres_platform_unavailable"   # F1: no answer, an outage or a server error
TRES_THROTTLED = "tres_throttled"                    # F1: the platform answered 429 to a hand (`retry_after` beside it)
TRES_OTHER_ENVIRONMENT = "tres_other_environment"    # F1: a retried row of the environment not selected (409)
TRES_SEND_FROM = "tres_send_from"                    # F1: a cut-off before 2020 or more than 366 days ahead
TRES_STAY_DRAFT = "tres_stay_draft"                  # F1, final review: a hand on a stay whose last admission is a DRAFT

CODES = frozenset({TRES_MODE, TRES_ENVIRONMENT, TRES_SETTLE_HOURS, TRES_TYPES, TRES_BASE_URL,
                   TRES_FIELD_LENGTH, EGRESS_OFF, TRES_ACCOUNT_INCOMPLETE, TRES_HOST_NOT_ALLOWED,
                   TRES_LIVE_CLOSED, TRES_UNIT_UNKNOWN, TRES_DEPARTMENT_CODE, TRES_DEPARTMENT_DISPLAY,
                   TRES_USER_UNKNOWN, TRES_FIN_FORMAT, TRES_NAME, TRES_FILTER, TRES_CURSOR, TRES_STAY_UNKNOWN,
                   TRES_OFF, TRES_BUSY, TRES_LOGIN_REFUSED, TRES_PLATFORM_UNAVAILABLE, TRES_THROTTLED,
                   TRES_OTHER_ENVIRONMENT, TRES_SEND_FROM, TRES_STAY_DRAFT})

WORDS = {
    TRES_MODE: "The mode is off, validate or send.",
    TRES_ENVIRONMENT: "The environment is test or live.",
    TRES_SETTLE_HOURS: "The wait after a discharge is 0–168 hours.",
    TRES_TYPES: "The resource types are a list of the eight known types, each at most once.",
    TRES_BASE_URL: "A base URL starts with https://, names a host, carries no credentials, no query, "
                   "no fragment and no port but 443, and is at most 200 characters.",
    TRES_FIELD_LENGTH: "An account field is longer than it may be.",
    EGRESS_OFF: "Outbound sending is closed on this installation (TRES_EGRESS is not on).",
    TRES_ACCOUNT_INCOMPLETE: "The selected environment's account is incomplete: the base URL, the "
                             "username, the password and the provider id are all needed.",
    TRES_HOST_NOT_ALLOWED: "The base URL's host is not one this installation allows (TRES_HOSTS).",
    TRES_LIVE_CLOSED: "Sending patient data to the live platform is closed in this version: the legal basis "
                      "and the cut-over are open (O5, O11). Only the mode off is saved for a live account.",
    TRES_UNIT_UNKNOWN: "A unit in the map is not one of this hospital's, or is named twice.",
    TRES_DEPARTMENT_CODE: "A department code is required, at most 32 characters.",
    TRES_DEPARTMENT_DISPLAY: "A department name is required, at most 200 characters.",
    TRES_USER_UNKNOWN: "No active member of this hospital has that id.",
    TRES_FIN_FORMAT: "A FİN is seven Latin capital letters or digits.",
    TRES_NAME: "The family and the given name are required, each at most 100 characters.",
    TRES_FILTER: "A filter names no known status, record type or environment.",
    TRES_CURSOR: "The page cursor cannot be read; open the list again.",
    TRES_STAY_UNKNOWN: "No stay of this hospital has that id or number.",
    TRES_OFF: "The feed's mode is off for this hospital.",
    TRES_BUSY: "Another send of this stay is in progress; try again in a moment.",
    TRES_LOGIN_REFUSED: "The platform refused the login; the feed waits until the account is saved again or a "
                        "connection test succeeds.",
    TRES_PLATFORM_UNAVAILABLE: "The platform did not answer, or answered with an error; nothing more was sent.",
    TRES_THROTTLED: "The platform asks to wait before the next request (HTTP 429); nothing more was sent.",
    TRES_OTHER_ENVIRONMENT: "This row belongs to the environment that is not selected; it is retried only there.",
    TRES_SEND_FROM: "The cut-off is a moment from 2020-01-01 to at most 366 days from now.",
    TRES_STAY_DRAFT: "This stay is still a draft (not signed); it is not sent by hand.",
}


def refusal(status: int, code: str, extra: dict | None = None) -> Refusal:
    """The refusal of `code`, with its words — and `extra` keys beside them in the detail (never a
    value of the record: `tres_host_not_allowed` names the `environment`, test or live;
    `tres_throttled` the platform's `retry_after`, in seconds, when it said one)."""
    return Refusal(status, code, WORDS[code], extra)

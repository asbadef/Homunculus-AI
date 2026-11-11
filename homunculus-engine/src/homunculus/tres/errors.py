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

CODES = frozenset({TRES_MODE, TRES_ENVIRONMENT, TRES_SETTLE_HOURS, TRES_TYPES, TRES_BASE_URL,
                   TRES_FIELD_LENGTH, EGRESS_OFF, TRES_ACCOUNT_INCOMPLETE})

WORDS = {
    TRES_MODE: "The mode is off, validate or send.",
    TRES_ENVIRONMENT: "The environment is test or live.",
    TRES_SETTLE_HOURS: "The wait after a discharge is 0–168 hours.",
    TRES_TYPES: "The resource types are a list of the eight known types, each at most once.",
    TRES_BASE_URL: "A base URL starts with https://, names a host, carries no credentials and is "
                   "at most 200 characters.",
    TRES_FIELD_LENGTH: "An account field is longer than it may be.",
    EGRESS_OFF: "Outbound sending is closed on this installation (TRES_EGRESS is not on).",
    TRES_ACCOUNT_INCOMPLETE: "The selected environment's account is incomplete: the base URL, the "
                             "username, the password and the provider id are all needed.",
}


def refusal(status: int, code: str) -> Refusal:
    """The refusal of `code`, with its words."""
    return Refusal(status, code, WORDS[code])

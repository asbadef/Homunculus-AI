# homunculus-engine/src/homunculus/tres/ids.py
"""The local ids of the national e-health feed (TRƏS-01, spec D5, amended by plan F1 for O20).

A local id is the platform's ONLY search key (`local-system-unique-id`), unique per resource type,
in a space shared with any other sender on the same provider account: every one starts `hmn-`.
It carries no PHI — a person's is a keyed digest of the FİN (`crypto.phi_digest`), never the FİN.

EVERY LOCAL ID ENDS WITH A DOT, AND HOLDS NO OTHER (O20). The platform's search is a FHIR `string`
search, by prefix and in any case: `hmn-l-1` would also find `hmn-l-10`…`hmn-l-1999`. With the dot
as the one end mark, no id is a proper prefix of another — a proper prefix would end in a dot
that the longer id holds before its end — so a search answers one entry. A sent local id never
changes; this rule holds from the first one.

They are also valid FHIR ids (`[A-Za-z0-9\\-\\.]{1,64}`): a POST carries the local id as its
placeholder `id` (spec §4.2). `is_local_id` checks both rules; the tests hold every id to it.

    Patient        hmn-p-{phi_digest(FİN)[:32]}.        the person, not the admission row (D5)
    Practitioner   hmn-pr-{user id}.
    Encounter      hmn-e-{root admission id}.           one stay across beds (D5)
    vital sign     hmn-v-{root admission id}-{signal key}-{first|last}.
                   the key is `codes.Signal.id_key` (`heart-rate`, `resp-rate`, `spo2`, `temperature`,
                   `sbp`, `map`, `weight`, `height`) — NEVER the LOINC code: a sent id never changes,
                   a code may (SpO2, O7), and then it is the same resource PUT again

A Patient that cannot be built for want of a usable FİN has no digest to be keyed by; its skip is
recorded under `hmn-p-s-{root admission id}.` (the stay's placeholder), which the package removes
once the person's own id can be built."""
from __future__ import annotations

import re
import uuid

from homunculus.crypto import phi_digest
from homunculus.tres import az

PREFIX = "hmn-"
END = "."
#: FHIR's `id`: letters, digits, '-' and '.', 1 to 64 of them.
_FHIR_ID = re.compile(r"[A-Za-z0-9\-.]{1,64}")
FIRST, LAST = "first", "last"
#: A vital sign's id key: lower-case ASCII words joined by single hyphens (FHIR ids allow no `_`).
_VITAL_KEY = re.compile(r"[a-z0-9]+(-[a-z0-9]+)*")
#: Constant messages: an exception raised here never carries the FİN or the key it was given.
FIN_UNUSABLE = "a patient's id needs a usable FİN (seven Latin capitals or digits)"
VITAL_KEY_INVALID = "a vital sign's id key is lower-case words joined by single hyphens, and its id fits 64 characters"


def is_local_id(value: str) -> bool:
    """`hmn-…`, a valid FHIR id, and exactly one dot, at its end (O20)."""
    return (isinstance(value, str) and value.startswith(PREFIX) and bool(_FHIR_ID.fullmatch(value))
            and value.endswith(END) and value.count(END) == 1)


def patient(fin: str | None) -> str:
    """The person's id: the digest of the FİN as `az.normal_fin` normalises it, so one person is one
    national Patient however the FİN was typed (`ab12c3d` and `AB12C3D` are the same id). A FİN the
    platform would not accept has no id: ValueError, whose message never holds the FİN."""
    normal, _ = az.normal_fin(fin)
    if normal is None:
        raise ValueError(FIN_UNUSABLE)
    return f"{PREFIX}p-{phi_digest(normal)[:32]}{END}"


def patient_placeholder(root: uuid.UUID) -> str:
    """Where a Patient's skip is recorded while it has no usable FİN (fin_missing, fin_format)."""
    return f"{PREFIX}p-s-{root}{END}"


def practitioner(user_id: uuid.UUID) -> str:
    return f"{PREFIX}pr-{user_id}{END}"


def encounter(root: uuid.UUID) -> str:
    return f"{PREFIX}e-{root}{END}"


def vital(root: uuid.UUID, key: str, which: str) -> str:
    """A vital sign's id: the stay's root, the signal's key (`codes.Signal.id_key`, never its LOINC
    code) and `first` or `last`. Raises ValueError for a key that is not hyphenated lower-case words
    or that would make the id longer than FHIR allows."""
    if which not in (FIRST, LAST):
        raise ValueError("a vital sign's id is its first or its last value")
    if not isinstance(key, str) or not _VITAL_KEY.fullmatch(key):
        raise ValueError(VITAL_KEY_INVALID)
    local_id = f"{PREFIX}v-{root}-{key}-{which}{END}"
    if not is_local_id(local_id):
        raise ValueError(VITAL_KEY_INVALID)
    return local_id

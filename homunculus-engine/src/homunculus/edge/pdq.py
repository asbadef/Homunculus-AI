"""Answer IHE PDQ patient queries (QBP^Q22) by echoing the queried id, with a name when we have one.

Why this exists: a Welch Allyn NCE forwards the patient id a clinician types or scans on a Connex
Spot to its "patient query" host before the reading is saved. Its query sheet accepts a response
that contains ``MSA|AA`` and a ``PID`` segment; anything else — or silence — leaves the id
*unvalidated*, and NCE's ORU rendering then emits ``PID-3 = ^^^X^PI``: a reading with no patient.

The id is always handed straight back: that is the same trust model as a manual id anywhere else
in the pipeline, a pseudonymous identifier the operator is responsible for, never one we invent.
An optional `lookup` (typically `IdentityMirror.get`) supplies what the HIS said about that id —
name, date of birth, sex — so the device can show the clinician the patient and let them confirm
the bed. Without a hit, or without a `lookup` at all, only the id comes back; nothing is guessed.

PHI: the id is echoed to the sender only; nothing here logs it.
"""
from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from homunculus.gateway.hl7 import split_segments

if TYPE_CHECKING:                    # import only for typing: pdq stays free of edge-layer deps
    from homunculus.edge.adt import PatientIdentity

_QUERY_TYPES = ("QBP^Q22",)
_ID_TAGS = ("@PID.3.1", "@PID3.1")

# FHIR AdministrativeGender -> HL7 table 0001, for the answer we hand back to the device.
_FHIR_SEX_TO_HL7 = {"male": "M", "female": "F", "other": "O", "unknown": "U"}


def _fields(segment: str) -> list[str]:
    return segment.split("|")


def _at(fields: list[str], i: int) -> str:
    return fields[i] if i < len(fields) else ""


def queried_patient_id(qpd: list[str]) -> str:
    """The id in QPD-3, whichever of the two spellings the sender used for the PID.3.1 tag."""
    for repetition in _at(qpd, 3).split("~"):
        tag, _, value = repetition.partition("^")
        if tag.strip() in _ID_TAGS and value.strip():
            return value.strip()
    return ""


def patient_query_response(
    message: str,
    lookup: Callable[[str], "PatientIdentity | None"] | None = None,
) -> str | None:
    """An RSP^K22 for a QBP^Q22 query; None for any other message (the caller's handler runs).

    `lookup` maps a protocol number to what the HIS said about it. With a hit, the device shows
    the patient's name and the nurse can confirm they are at the right bed; without one, the id
    is echoed and the reading still flows. A lookup that fails is treated as a miss: a broken
    mirror must never stop a measurement.
    """
    segs = split_segments(message)
    if not segs or not segs[0].startswith("MSH|"):
        return None
    msh = _fields(segs[0])
    if not any(_at(msh, 8).startswith(t) for t in _QUERY_TYPES):
        return None

    qpd = next((_fields(s) for s in segs if s.startswith("QPD|")), ["QPD"])
    patient_id = queried_patient_id(qpd)
    control_id = _at(msh, 9)
    query_tag = _at(qpd, 2) or control_id
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")

    known = None
    if patient_id and lookup is not None:
        try:
            known = lookup(patient_id)
        except Exception:                      # a mirror fault degrades, never blocks
            known = None

    out = [
        "|".join(["MSH", "^~\\&", _at(msh, 4) or "HOMUNCULUS", _at(msh, 5), _at(msh, 2), _at(msh, 3),
                  stamp, "", "RSP^K22^RSP_K21", stamp, "P", _at(msh, 11) or "2.5"]),
        "|".join(["MSA", "AA" if patient_id else "AE", control_id]),
        "|".join(["QAK", query_tag, "OK" if patient_id else "NF"]),
        "|".join(["QPD", _at(qpd, 1), query_tag, f"@PID.3.1^{patient_id}" if patient_id else ""]),
    ]
    if patient_id:
        # Field-complete like the vendor's sample (PID|||id||name||dob|sex), with unknown
        # demographics present but EMPTY. NCE's transform sheets slice fields with
        # substring-before(…,'|'), which yields "" when no delimiter follows — a PID that ended
        # right after the id came back to the device with no id at all (ward, 2026-09-04).
        name = f"{known.family}^{known.given}" if known else ""
        dob = known.birth_date.replace("-", "") if known else ""
        sex = _FHIR_SEX_TO_HL7.get(known.sex, "") if known else ""
        out.append("|".join(["PID", "", "", patient_id, "", name, "", dob, sex]))
    return "\r".join(out) + "\r"

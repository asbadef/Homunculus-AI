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


def _safe_text(value: object) -> str:
    """Text that cannot break out of the field it is written into.

    HL7's delimiters (`| ^ ~ \\ &`) are legal characters in a person's name, and one of them
    inside PID-5 slides every field after it one place along: the date of birth lands in the sex
    slot and the device shows a patient who does not exist. `O^BRIEN` is worse still — it parses
    as a different name, and a WRONG name on the screen is more dangerous than none, because it
    is what the nurse checks the bed against.

    They are replaced with a space rather than escaped. The receiving system parses this reply
    with XSL `substring-before`, not an HL7 parser, so it would render `\\S\\` literally and show
    the clinician punctuation soup. A delimiter in a name is a data-quality artefact; a space
    keeps the name readable and makes the corruption impossible.
    """
    text = "" if value is None else str(value)
    for delimiter in "|^~\\&":
        text = text.replace(delimiter, " ")
    return " ".join(text.split())


def _hl7_date(iso_date: object) -> str:
    """`1980-01-15` -> `19800115`; anything that is not a whole ISO date -> empty.

    A malformed date passed through verbatim reaches the device looking like a real one. An
    empty field says "we were not told", which is the truth.
    """
    digits = "".join(c for c in str(iso_date or "") if c.isdigit())
    return digits if len(digits) == 8 else ""


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

    # The lookup AND everything read off what it returned sit inside one guard. A record with a
    # missing field is as capable of breaking the reply as a lookup that raises, and the promise
    # here is the same either way: the device gets an answer, always.
    name = dob = sex = ""
    if patient_id and lookup is not None:
        try:
            known = lookup(patient_id)
            if known is not None:
                family, given = _safe_text(known.family), _safe_text(known.given)
                name = f"{family}^{given}" if (family or given) else ""
                dob = _hl7_date(known.birth_date)
                sex = _FHIR_SEX_TO_HL7.get(known.sex, "")
        except Exception:                      # a mirror fault degrades, never blocks
            name = dob = sex = ""

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
        out.append("|".join(["PID", "", "", patient_id, "", name, "", dob, sex]))
    return "\r".join(out) + "\r"

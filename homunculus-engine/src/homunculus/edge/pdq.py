"""Answer IHE PDQ patient queries (QBP^Q22) by echoing the queried id.

Why this exists: a Welch Allyn NCE forwards the patient id a clinician types or scans on a Connex
Spot to its "patient query" host before the reading is saved. Its query sheet accepts a response
that contains ``MSA|AA`` and a ``PID`` segment; anything else — or silence — leaves the id
*unvalidated*, and NCE's ORU rendering then emits ``PID-3 = ^^^X^PI``: a reading with no patient.

This responder does not look anything up. It hands the id straight back, with no name, date of
birth or sex, so the device carries on with exactly the identifier the clinician entered. That is
the same trust model as a manual id anywhere else in the pipeline: a pseudonymous identifier the
operator is responsible for, never a demographic record we invented.

PHI: the id is echoed to the sender only; nothing here logs it.
"""
from __future__ import annotations

from datetime import datetime, timezone

_QUERY_TYPES = ("QBP^Q22",)
_ID_TAGS = ("@PID.3.1", "@PID3.1")


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


def patient_query_response(message: str) -> str | None:
    """An RSP^K22 for a QBP^Q22 query; None for any other message (the caller's handler runs)."""
    segs = [s for s in message.split("\r") if s]
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

    out = [
        "|".join(["MSH", "^~\\&", _at(msh, 4) or "HOMUNCULUS", _at(msh, 5), _at(msh, 2), _at(msh, 3),
                  stamp, "", "RSP^K22^RSP_K21", stamp, "P", _at(msh, 11) or "2.5"]),
        "|".join(["MSA", "AA" if patient_id else "AE", control_id]),
        "|".join(["QAK", query_tag, "OK" if patient_id else "NF"]),
        "|".join(["QPD", _at(qpd, 1), query_tag, f"@PID.3.1^{patient_id}" if patient_id else ""]),
    ]
    if patient_id:
        # Field-complete like the vendor's sample (PID|||id||name||dob|sex), with the demographic
        # fields present but EMPTY. NCE's transform sheets slice fields with
        # substring-before(…,'|'), which yields "" when no delimiter follows — a PID that ended
        # right after the id came back to the device with no id at all (ward, 2026-09-04).
        out.append("|".join(["PID", "", "", patient_id, "", "", "", "", ""]))
    return "\r".join(out) + "\r"

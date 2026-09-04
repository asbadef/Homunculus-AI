# src/homunculus/gateway/hl7.py
"""HL7v2 ORU^R01 -> canonical Observations. The seam where a hospital's HL7 feed plugs in.

Mirrors gateway/fhir.py's contract: map identifiers to SignalCode, raise GatewayError on a
structurally broken message. Unlike a FHIR resource (one observation), one ORU message carries
many OBX segments, so this returns a *list* of Observations. Observations we cannot map or parse
(unknown code, non-numeric value) are dropped, not fabricated — a monitor emits many parameters
we do not track.
"""
from __future__ import annotations

from datetime import datetime

from homunculus.canonical import Observation, SignalCode
from homunculus.gateway.fhir import GatewayError, to_utc  # shared gateway contract

# Default identifier table: OBX-3 code == our SignalCode slug. A per-hospital mapping table
# (vendor OBX code -> SignalCode) is passed in for real sites and replaces this default.
_DEFAULT_MAP = {c.value: c for c in SignalCode}


def default_mapping() -> dict[str, SignalCode]:
    """The identifier table used when a site supplies none. Exposed so the edge bridge can report
    which codes a device sent that nothing would map, without duplicating this definition."""
    return dict(_DEFAULT_MAP)


def _fields(segment: str) -> list[str]:
    return segment.split("|")


def _at(fields: list[str], i: int) -> str:
    return fields[i] if i < len(fields) else ""


def _first_component(field: str) -> str:
    return field.split("^", 1)[0]


def _parse_hl7_ts(ts: str) -> datetime | None:
    digits = "".join(c for c in ts if c.isdigit())
    for width, fmt in ((14, "%Y%m%d%H%M%S"), (12, "%Y%m%d%H%M"), (8, "%Y%m%d")):
        if len(digits) >= width:
            try:
                return to_utc(datetime.strptime(digits[:width], fmt))
            except ValueError:
                return None
    return None


def split_segments(message: str) -> list[str]:
    """An HL7 message's `\\r`-terminated segments, tolerant of `\\n`/`\\r\\n` from senders and
    tools that don't preserve the wire terminator. Shared by every HL7 parser in this package so
    segment-boundary handling can't drift between them."""
    return [s for s in message.replace("\r\n", "\r").replace("\n", "\r").split("\r") if s]


def parse_hl7_oru(message: str, mapping: dict[str, SignalCode] | None = None) -> list[Observation]:
    table = mapping if mapping is not None else _DEFAULT_MAP

    segments = split_segments(message)
    if not segments or not segments[0].startswith("MSH"):
        raise GatewayError("message does not start with an MSH segment")

    msh = _fields(segments[0])
    if _first_component(_at(msh, 8)).upper() != "ORU":
        raise GatewayError(f"expected ORU message, got {_at(msh, 8)!r}")
    message_time = _parse_hl7_ts(_at(msh, 6))
    sending_app = _at(msh, 2) or "unknown"

    patient_id = ""
    for seg in segments:
        if seg.startswith("PID"):
            # The CX datatype puts the identifier in the first component, but real senders
            # scatter it — Welch Allyn NCE, for one, ships PID-3 with leading empty components
            # (^^1234567^X^PI). The first NON-EMPTY of the first three components is still the
            # sender's own identifier: nothing is invented, only the punctuation is forgiven.
            # Components 4 and 5 are the assigning authority and the identifier-type code —
            # HL7 code-table values, never identifiers. A reading saved on the device with no
            # patient id arrives as ^^^X^PI, and taking "X" from there merged every anonymous
            # reading on the ward into one pseudo-patient (seen 2026-09-03).
            for component in _at(_fields(seg), 3).split("^")[:3]:
                if component.strip():
                    patient_id = component.strip()
                    break
            break
    if not patient_id:
        raise GatewayError("missing or empty PID-3 patient identifier (CX.1–CX.3 empty; "
                           "a reading saved without a patient id on the device looks like this)")

    observations: list[Observation] = []
    for seg in segments:
        if not seg.startswith("OBX"):
            continue
        f = _fields(seg)

        code = table.get(_first_component(_at(f, 3)))
        if code is None:
            continue  # a parameter we do not track — drop it

        try:
            value = float(_at(f, 5))
        except ValueError:
            continue  # non-numeric / errored result — drop, never fabricate

        timestamp = _parse_hl7_ts(_at(f, 14)) or message_time
        if timestamp is None:
            continue  # no usable time anywhere — drop

        observations.append(Observation(
            patient_id=patient_id,
            code=code,
            value=value,
            unit=_at(f, 6),
            timestamp=timestamp,
            source_device=sending_app,
        ))

    return observations

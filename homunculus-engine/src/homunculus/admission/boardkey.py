# homunculus-engine/src/homunculus/admission/boardkey.py
"""The card key of an admission (Group 2 · B1d, spec §4, D7) — one rule, in one place.

The board world (the engine, the identity store, alerts, acks, trends, the Infinity strip, the
audit's `patient_id`) keys a patient by one string. An admission made since 0015 is keyed by its
protocol number: the number on the device, the label and the card are the same (D7). An admission
opened before it keeps its H-number key (`Patient.patient_number`) until it is discharged.

Every place that ties an admission to the board calls this; none of them reads
`Patient.patient_number` for that purpose any more."""
from __future__ import annotations


def board_key(protocol_no: str | None, patient_number: str) -> str:
    """The admission's card key: its protocol number, else (a legacy admission) its H-number."""
    return protocol_no or patient_number

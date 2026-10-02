# src/homunculus/edge/adt.py
"""HL7v2 ADT -> PatientIdentity -> FHIR Patient + Encounter.

Comed (the hospital's HIS) is the source of a patient's name and bed. The device never carries
them: a Connex Spot discards whatever a nurse typed once its patient query is answered, so
PID-5/PV1-3 on the reading arrive empty (ward, 2026-09-04). The join key is the **protocol
number** — PID-3.1 here, the same number the nurse types on the device.

This module is pure: HL7 text in, records out. No network, no state, no clock.

PHI: raising is by reason, never by content. Callers log the reason and drop the message.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from homunculus.gateway.fhir import GatewayError
from homunculus.gateway.hl7 import (  # shared HL7 primitives
    _at,
    _fields,
    _first_component,
    _parse_hl7_ts,
    split_segments,
)

# Which trigger events we act on, and what each one means for the record's state. An event that
# is not here is not guessed at: it is ignored (the caller still ACKs it). None means the trigger
# says nothing about admission: a transfer moves the bed and an update corrects the name, and a
# HIS sends A08 for billing edits long after discharge -- reading that as "admitted" resurrected
# discharged patients onto the board, where nothing would ever prune them.
ADMITTED = "admitted"
DISCHARGED = "discharged"
_ADMITTED, _DISCHARGED = ADMITTED, DISCHARGED
_EVENTS: dict[str, str | None] = {
    "A01": _ADMITTED,    # admit
    "A04": _ADMITTED,    # register
    "A02": None,         # transfer  (location changes, state untouched)
    "A08": None,         # update    (demographics change, state untouched)
    "A13": _ADMITTED,    # discharge cancelled
    "A03": _DISCHARGED,  # discharge
    "A11": _DISCHARGED,  # admit cancelled
}
_ENCOUNTER_STATUS = {_ADMITTED: "in-progress", _DISCHARGED: "finished", None: "unknown"}

# HL7 table 0001 -> FHIR AdministrativeGender. Anything else is "unknown": a sex we cannot read
# is not a sex we invent.
_SEX = {"M": "male", "F": "female", "O": "other", "U": "unknown", "A": "other", "N": "other"}


@dataclass(frozen=True)
class Diagnosis:
    """One DG1 diagnosis: an ICD-10 code, its text, and which kind of diagnosis it is.

    The admission form asks a clinician to type these by hand. The HIS already holds them and
    sends them in every ADT — so every one carried here is one nobody has to type, and one that
    cannot be mistyped.
    """
    code: str                # DG1-3.1, e.g. "A41.9"
    text: str = ""           # DG1-3.2, falling back to DG1-4
    system: str = ""         # DG1-3.3, e.g. "I10" / "ICD10"
    kind: str = ""           # DG1-6: A=admitting, W=working, F=final

    def as_dict(self) -> dict:
        return {"code": self.code, "text": self.text, "system": self.system, "kind": self.kind}


@dataclass(frozen=True)
class PatientIdentity:
    """Who a protocol number belongs to, and where they are, at one moment in time."""
    patient_id: str          # PID-3.1 — the Comed protocol number
    family: str = ""
    given: str = ""
    birth_date: str = ""     # ISO date, "" when absent
    sex: str = "unknown"
    unit: str = ""
    room: str = ""
    bed: str = ""
    state: str | None = _ADMITTED   # None: this message did not say (transfer, update)
    at: datetime | None = None      # MSH-7: how two messages about one patient are ordered
    # Empty means "this message carried no DG1", never "this patient has no diagnoses" — a
    # transfer message says nothing about diagnosis and must not blank what an admission said.
    diagnoses: tuple[Diagnosis, ...] = ()

    @property
    def bed_label(self) -> str:
        """Human-readable bed, e.g. "YB^304^2" -> "YB 304-2" (empty parts fall away rather than
        leaving punctuation). Compare `identity_to_fhir`'s Encounter, whose location.display
        stays "^"-joined on purpose — that one is for the API layer to parse back apart, not for
        a person to read."""
        parts = [p for p in (self.unit, self.room, self.bed) if p]
        if not parts:
            return ""
        return parts[0] if len(parts) == 1 else f"{parts[0]} {'-'.join(parts[1:])}"


def _diagnoses(segments: list[str]) -> tuple[Diagnosis, ...]:
    """Every DG1 in the message, in the order sent, de-duplicated on the code.

    A segment with no code is skipped rather than kept as a blank row: a diagnosis nobody can
    read is not a diagnosis, and an empty chip on a clinical card invites someone to trust it.
    A malformed DG1 never costs the message its identity — the patient and the bed matter more
    than the diagnosis list, and losing the admission over a bad code would be the worse trade.
    """
    found: list[Diagnosis] = []
    seen: set[str] = set()
    for segment in segments:
        if not segment.startswith("DG1"):
            continue
        try:
            fields = _fields(segment)
            coded = _at(fields, 3)
            code = _component(coded, 1)
            if not code or code in seen:
                continue
            seen.add(code)
            found.append(Diagnosis(
                code=code,
                # DG1-3.2 is the modern place for the text; DG1-4 is where older interfaces
                # put it, and a few send both. Prefer the coded one, fall back rather than
                # show a bare code to a clinician.
                text=_component(coded, 2) or _at(fields, 4).strip(),
                system=_component(coded, 3),
                kind=_at(fields, 6).strip().upper(),
            ))
        except (IndexError, AttributeError):
            continue
    return tuple(found)


def _component(field: str, index: int) -> str:
    """One `^`-separated component of an HL7 field, 1-based, "" when absent."""
    parts = field.split("^")
    return parts[index - 1].strip() if len(parts) >= index else ""


def _protocol_number(pid: list[str]) -> str:
    """PID-3.1..3 of the FIRST repetition only, "" when none of those three carry a value.

    HL7 separates PID-3 repetitions with `~` (a patient can carry an MRN alongside the protocol
    number); splitting on `^` without first splitting on `~` would run two identifiers together
    into one field and could hand back a component that belongs to the wrong repetition. Within
    that first repetition, CX.4/CX.5 are still off limits — the assigning authority and the
    id-type code are HL7 code-table values, never identifiers (taking CX.4 once merged a whole
    ward into one card)."""
    first_repetition = _at(pid, 3).split("~", 1)[0]
    for component in first_repetition.split("^")[:3]:
        if component.strip():
            return component.strip()
    return ""


def _iso_date(hl7_date: str) -> str:
    digits = "".join(c for c in hl7_date if c.isdigit())[:8]
    if len(digits) != 8:
        return ""
    return f"{digits[:4]}-{digits[4:6]}-{digits[6:]}"


def is_adt(message: str) -> bool:
    """True when MSH-9's first component is ADT, whatever the trigger.

    Same gate `parse_hl7_adt` applies before it looks at the trigger event, extracted so a
    caller can tell "an ADT we do not act on" apart from "not an ADT at all" without duplicating
    the MSH inspection.
    """
    segments = split_segments(message)
    if not segments or not segments[0].startswith("MSH"):
        return False
    msh = _fields(segments[0])
    return _first_component(_at(msh, 8)).upper() == "ADT"


def parse_hl7_adt(message: str) -> PatientIdentity | None:
    """A `PatientIdentity` for an ADT we act on; None for anything else (the caller carries on).

    Raises GatewayError when the message IS an ADT we act on but carries no protocol number —
    an identity with no key is unusable, and guessing one would attach a name to the wrong card.
    """
    segments = split_segments(message)
    if not segments or not segments[0].startswith("MSH"):
        return None
    msh = _fields(segments[0])
    message_type = _at(msh, 8)
    if _first_component(message_type).upper() != "ADT":
        return None
    trigger = _component(message_type, 2).upper()
    if trigger not in _EVENTS:
        return None
    state = _EVENTS[trigger]

    pid = next((_fields(s) for s in segments if s.startswith("PID")), [])
    patient_id = _protocol_number(pid)
    if not patient_id:
        raise GatewayError("missing or empty PID-3 patient identifier in an ADT message")

    name = _at(pid, 5)
    pv1 = next((_fields(s) for s in segments if s.startswith("PV1")), [])
    location = _at(pv1, 3)

    return PatientIdentity(
        patient_id=patient_id,
        family=_component(name, 1),
        given=_component(name, 2),
        birth_date=_iso_date(_at(pid, 7)),
        sex=_SEX.get(_at(pid, 8).strip().upper(), "unknown"),
        unit=_component(location, 1),
        room=_component(location, 2),
        bed=_component(location, 3),
        state=state,
        at=_parse_hl7_ts(_at(msh, 6)),
        diagnoses=_diagnoses(segments),
    )


def identity_to_fhir(identity: PatientIdentity, source: str) -> tuple[dict, dict]:
    """(Patient, Encounter) for the uplink, in that order — the Encounter references the Patient.

    `meta.lastUpdated` carries MSH-7 so the receiving store can refuse a message that arrives out
    of order, and `meta.source` says which feed it came from ("comed" | "manuel"). A message that
    says nothing about admission (state None) renders without `Patient.active` and with
    `Encounter.status = "unknown"`, and the receiving store leaves the state as it was.
    """
    stamp = identity.at.isoformat() if identity.at else ""
    meta = {"lastUpdated": stamp, "source": source}

    patient = {
        "resourceType": "Patient",
        "identifier": [{"system": "http://homunculus.local/protocol-no",
                        "value": identity.patient_id}],
        "name": [{"family": identity.family, "given": [identity.given]}],
        "birthDate": identity.birth_date,
        "gender": identity.sex,
        "meta": meta,
    }
    if identity.state is not None:
        patient["active"] = identity.state == _ADMITTED
    encounter = {
        "resourceType": "Encounter",
        "status": _ENCOUNTER_STATUS[identity.state],
        "subject": {"reference": f"Patient/{identity.patient_id}"},
        # "^"-joined, not `identity.bed_label` -- this display is for the receiving API to parse
        # back apart, not for a person to read; bed_label is the human-readable form.
        "location": [{"location": {"display": "^".join([identity.unit, identity.room, identity.bed])}}],
        "period": {"start": stamp},
        "meta": meta,
    }
    if identity.diagnoses:
        # reasonCode is FHIR's place for why an encounter is happening, which is what a DG1
        # admitting diagnosis is. Omitted entirely when the message carried none, so the
        # receiving side can tell "not told" from "none" — a transfer must not blank the
        # diagnoses an admission established.
        encounter["reasonCode"] = [
            {"coding": [{"system": d.system, "code": d.code, "display": d.text}],
             "text": d.text or d.code}
            for d in identity.diagnoses
        ]
    return patient, encounter

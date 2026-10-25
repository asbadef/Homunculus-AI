# src/homunculus/gateway/fhir.py
"""FHIR R4 Observation -> canonical Observation. The seam where real hospital feeds plug in."""
from __future__ import annotations

import math
from datetime import datetime, timezone

from homunculus.canonical import Observation, SignalCode

_SLUG_TO_CODE = {c.value: c for c in SignalCode}


class GatewayError(ValueError):
    """Raised when an incoming message cannot be normalized. Caller logs and drops it."""


#: The longest patient id a door accepts (G2-A2, D14) — a device's id or the protocol number the
#: HIS keys a patient by. Here since G2-A2 so readings and identity key alike; `api/app.py` applies
#: it to request bodies too (`_body_patient_id`).
PATIENT_ID_MAX = 128


def patient_id_from(value: object, *, what: str) -> str:
    """The patient id `value` carries, stripped: a non-blank string of at most PATIENT_ID_MAX
    characters, else a GatewayError naming `what` (G2-A2, D14). A blank id merges every reading
    that carries one into one pseudo-patient, and an id past the cap is a feed error: neither may
    reach the engine, and neither may surface as a 500."""
    if not isinstance(value, str):
        raise GatewayError(f"{what} is not a string")
    patient_id = value.strip()
    if not patient_id:
        raise GatewayError(f"missing {what}")
    if len(patient_id) > PATIENT_ID_MAX:
        raise GatewayError(f"{what} is longer than {PATIENT_ID_MAX} characters")
    return patient_id


def to_utc(dt: datetime) -> datetime:
    """Normalize to timezone-aware UTC. A feed that carries no offset is assumed UTC, so
    timestamps from different gateways (FHIR, HL7) never mix naive and aware datetimes inside
    one engine — which would raise TypeError on comparison."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def parse_fhir_observation(resource: dict) -> Observation:
    if resource.get("resourceType") != "Observation":
        raise GatewayError(f"expected resourceType 'Observation', got {resource.get('resourceType')!r}")

    try:
        coding = resource["code"]["coding"][0]
        slug = coding["code"]
    except (KeyError, IndexError, TypeError) as exc:
        raise GatewayError("missing code.coding[0].code") from exc

    code = _SLUG_TO_CODE.get(slug)
    if code is None:
        raise GatewayError(f"unknown signal code: {slug!r}")

    vq = resource.get("valueQuantity")
    if not vq or "value" not in vq:
        raise GatewayError("missing valueQuantity.value")

    when = resource.get("effectiveDateTime")
    if not when:
        raise GatewayError("missing effectiveDateTime")
    try:
        timestamp = to_utc(datetime.fromisoformat(when))
    except ValueError as exc:
        raise GatewayError(f"unparseable effectiveDateTime: {when!r}") from exc

    # G2-A2 (D14): a subject that is not an object, or a reference that is not a string, is the
    # feed's error (400), not an AttributeError (500); the id itself is `patient_id_from`'s.
    subject = resource.get("subject")
    if subject is not None and not isinstance(subject, dict):
        raise GatewayError(f"malformed subject: {subject!r}")
    reference = (subject or {}).get("reference", "")
    if not isinstance(reference, str) or not reference.startswith("Patient/"):
        raise GatewayError(f"missing or malformed subject.reference: {reference!r}")
    patient_id = patient_id_from(reference.split("/", 1)[1], what="patient id in subject.reference")

    value = float(vq["value"])
    if not math.isfinite(value):
        # NaN / ±inf parse as floats — and JSON as Python reads it carries a bare NaN token — but
        # are not measurements; edge/ncefiles.py and api/clinical.py refuse them too.
        raise GatewayError(f"valueQuantity.value is not a finite number: {vq['value']!r}")

    return Observation(
        patient_id=patient_id,
        code=code,
        value=value,
        unit=vq.get("unit", ""),
        timestamp=timestamp,
        source_device=resource.get("device", {}).get("display", "unknown"),
    )

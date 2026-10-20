# src/homunculus/gateway/fhir.py
"""FHIR R4 Observation -> canonical Observation. The seam where real hospital feeds plug in."""
from __future__ import annotations

import math
from datetime import datetime, timezone

from homunculus.canonical import Observation, SignalCode

_SLUG_TO_CODE = {c.value: c for c in SignalCode}


class GatewayError(ValueError):
    """Raised when an incoming message cannot be normalized. Caller logs and drops it."""


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

    subject = resource.get("subject", {}).get("reference", "")
    if not subject.startswith("Patient/"):
        raise GatewayError(f"missing or malformed subject.reference: {subject!r}")
    patient_id = subject.split("/", 1)[1]

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

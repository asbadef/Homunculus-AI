# src/homunculus/edge/serialize.py
"""Canonical Observation -> FHIR R4 Observation dict.

The inverse of gateway.fhir.parse_fhir_observation. The edge bridge normalizes an HL7 feed to
canonical Observations, then serializes them to FHIR so the cloud /ingest (which speaks FHIR)
accepts them unchanged. Round-trip is lossless: parse_fhir_observation(observation_to_fhir(o)) == o,
for patient ids that already meet D14 (stripped, non-blank, ≤ 128).
"""
from __future__ import annotations

from homunculus.canonical import Observation

CODE_SYSTEM = "http://homunculus.local/obs"


def observation_to_fhir(obs: Observation) -> dict:
    return {
        "resourceType": "Observation",
        "status": "final",
        "code": {"coding": [{"system": CODE_SYSTEM, "code": obs.code.value}]},
        "subject": {"reference": f"Patient/{obs.patient_id}"},
        "effectiveDateTime": obs.timestamp.isoformat(),
        "valueQuantity": {"value": obs.value, "unit": obs.unit},
        "device": {"display": obs.source_device},
    }

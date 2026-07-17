# tests/test_gateway_fhir.py
import pytest
from datetime import datetime, timezone
from homunculus.canonical import SignalCode
from homunculus.gateway.fhir import parse_fhir_observation, GatewayError

CODE_SYSTEM = "http://homunculus.local/obs"


def _fhir(code_slug, value, unit="mmol/L", patient="bed-3",
          when="2026-07-14T10:00:00+00:00", device="abg-1"):
    return {
        "resourceType": "Observation",
        "status": "final",
        "code": {"coding": [{"system": CODE_SYSTEM, "code": code_slug}]},
        "subject": {"reference": f"Patient/{patient}"},
        "effectiveDateTime": when,
        "valueQuantity": {"value": value, "unit": unit},
        "device": {"display": device},
    }


def test_parses_a_valid_fhir_observation():
    obs = parse_fhir_observation(_fhir("lactate", 3.1))
    assert obs.code is SignalCode.LACTATE
    assert obs.value == 3.1
    assert obs.unit == "mmol/L"
    assert obs.patient_id == "bed-3"
    assert obs.timestamp == datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)
    assert obs.source_device == "abg-1"


def test_naive_effectivedatetime_is_normalized_to_utc():
    # A feed that omits the timezone offset is assumed UTC, so timestamps from different
    # gateways (FHIR, HL7) never mix naive and aware datetimes inside one engine.
    obs = parse_fhir_observation(_fhir("lactate", 3.1, when="2026-07-14T10:00:00"))
    assert obs.timestamp == datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)


def test_unknown_code_raises_gateway_error():
    with pytest.raises(GatewayError, match="unknown signal code"):
        parse_fhir_observation(_fhir("unobtanium", 1.0))


def test_missing_value_raises_gateway_error():
    bad = _fhir("lactate", 3.1)
    del bad["valueQuantity"]
    with pytest.raises(GatewayError, match="missing valueQuantity"):
        parse_fhir_observation(bad)


def test_wrong_resource_type_raises_gateway_error():
    with pytest.raises(GatewayError, match="resourceType"):
        parse_fhir_observation({"resourceType": "Patient"})

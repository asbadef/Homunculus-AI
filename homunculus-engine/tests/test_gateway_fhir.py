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


@pytest.mark.parametrize("sentinel", [float("nan"), float("inf"), float("-inf"), "NaN"])
def test_a_non_finite_value_raises_gateway_error(sentinel):
    """float() takes NaN and ±inf, and so does JSON as Python reads it: the edge bridge's
    json.dumps writes a bare NaN token and Starlette's request.json() reads it back. Neither is a
    measurement — edge/ncefiles.py and api/clinical.py already refuse them."""
    with pytest.raises(GatewayError, match="finite"):
        parse_fhir_observation(_fhir("lactate", sentinel))


def test_the_ingest_door_answers_400_to_a_nan_token_and_records_nothing():
    import json
    from fastapi.testclient import TestClient
    from homunculus.api.app import create_app

    body = json.dumps(_fhir("lactate", float("nan")))      # what the bridge's json.dumps sends
    assert '"value": NaN' in body
    auth = {"Authorization": "Bearer tok", "Content-Type": "application/json"}
    with TestClient(create_app({"tok": "h1"}, run_escalation_loop=False)) as client:
        r = client.post("/ingest", content=body, headers=auth)
        assert r.status_code == 400 and "finite" in r.json()["detail"]
        records = client.get("/audit", headers=auth).json()["records"]
        assert [x for x in records if x["event_type"] == "ingest"] == []


# --- G2-A2 (D14): one patient-id rule for every resource /ingest takes ------------------------
#
# A blank id merged every reading that carried one into one pseudo-patient; a 129-character id is a
# feed error; a subject that is not an object raised AttributeError, which /ingest answered with
# 500. Each is a GatewayError now, and so a 400.

BAD_SUBJECTS = {
    "blank": {"reference": "Patient/"},
    "whitespace": {"reference": "Patient/   "},
    "129 characters": {"reference": "Patient/" + "p" * 129},
    "a number": {"reference": 7},
    "a null reference": {"reference": None},
    "a string subject": "x",
    "a list subject": ["Patient/bed-3"],
    "a null subject": None,
}


@pytest.mark.parametrize("subject", list(BAD_SUBJECTS.values()), ids=list(BAD_SUBJECTS))
def test_a_patient_id_that_is_not_one_raises_gateway_error(subject):
    bad = {**_fhir("lactate", 3.1), "subject": subject}
    with pytest.raises(GatewayError):
        parse_fhir_observation(bad)


def test_a_128_character_id_is_still_an_id_and_an_id_is_stripped():
    assert parse_fhir_observation(_fhir("lactate", 3.1, patient="p" * 128)).patient_id == "p" * 128
    assert parse_fhir_observation(_fhir("lactate", 3.1, patient="  bed-3 ")).patient_id == "bed-3"


def test_patient_id_from_is_the_one_rule():
    from homunculus.gateway.fhir import PATIENT_ID_MAX, patient_id_from
    assert PATIENT_ID_MAX == 128
    assert patient_id_from("  p-1 ", what="the id") == "p-1"
    with pytest.raises(GatewayError, match="missing the id"):
        patient_id_from("   ", what="the id")
    with pytest.raises(GatewayError, match="the id is longer than 128 characters"):
        patient_id_from("p" * 129, what="the id")
    with pytest.raises(GatewayError, match="the id is not a string"):
        patient_id_from(7, what="the id")


@pytest.mark.parametrize("name", ["blank", "129 characters", "a string subject", "a number"])
def test_the_ingest_door_answers_400_not_500_and_records_nothing(name):
    from fastapi.testclient import TestClient
    from homunculus.api.app import create_app

    auth = {"Authorization": "Bearer tok"}
    bad = {**_fhir("lactate", 3.1), "subject": BAD_SUBJECTS[name]}
    app = create_app({"tok": "h1"}, run_escalation_loop=False)
    with TestClient(app, raise_server_exceptions=False) as client:
        r = client.post("/ingest", json=bad, headers=auth)
        assert r.status_code == 400, r.text
        records = client.get("/audit", headers=auth).json()["records"]
        assert [x for x in records if x["event_type"] == "ingest"] == []
        assert client.get("/patients", headers=auth).json()["patients"] == []

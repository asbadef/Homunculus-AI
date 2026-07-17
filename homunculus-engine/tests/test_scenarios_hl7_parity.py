# tests/test_scenarios_hl7_parity.py
"""Parity: the HL7 seam must produce the SAME cited alerts as the FHIR seam.

Each scenario is authored once (as FHIR). Here we re-encode every event as an HL7 ORU
message, run it through parse_hl7_oru -> Engine, and assert the resulting alerts match the
FHIR path exactly. This proves gateway/hl7.py is a drop-in equivalent of gateway/fhir.py.
"""
from pathlib import Path

import pytest

import homunculus.scenarios
from homunculus.gateway.fhir import parse_fhir_observation
from homunculus.gateway.hl7 import parse_hl7_oru
from homunculus.pipeline import Engine
from homunculus.scenarios.loader import load_scenario

SCEN = Path(homunculus.scenarios.__file__).parent
SCENARIOS = ["septic_shock.yaml", "stable_control.yaml", "under_resuscitated.yaml"]


def _fhir_to_oru(fhir: dict, ts) -> str:
    """Re-encode a single FHIR Observation as an equivalent one-OBX ORU^R01 message."""
    code = fhir["code"]["coding"][0]["code"]
    vq = fhir["valueQuantity"]
    patient = fhir["subject"]["reference"].split("/", 1)[1]
    hl7ts = ts.strftime("%Y%m%d%H%M%S")
    return "\r".join([
        rf"MSH|^~\&|SIM|ICU|HOM|HOSP|{hl7ts}||ORU^R01|M|P|2.5",
        f"PID|1||{patient}^^^HOSP^MR",
        f"OBX|1|NM|{code}||{vq['value']}|{vq.get('unit', '')}|||||F|||{hl7ts}",
    ])


def _alert_set(engine: Engine, patient: str):
    return {(a.kind, tuple(a.supporting_evidence)) for a in engine.active_alerts(patient)}


@pytest.mark.parametrize("scenario", SCENARIOS)
def test_hl7_path_produces_same_alerts_as_fhir_path(scenario):
    fhir_eng, hl7_eng, patient = Engine(), Engine(), None
    for ts, fhir in load_scenario(SCEN / scenario):
        patient = fhir["subject"]["reference"].split("/", 1)[1]
        fhir_eng.ingest(parse_fhir_observation(fhir), now=ts)
        for obs in parse_hl7_oru(_fhir_to_oru(fhir, ts)):
            hl7_eng.ingest(obs, now=ts)
    assert _alert_set(hl7_eng, patient) == _alert_set(fhir_eng, patient)


def test_hl7_shock_scenario_actually_fires_shock():
    # Guard: parity would be trivially satisfied if BOTH engines produced nothing.
    eng, patient = Engine(), None
    for ts, fhir in load_scenario(SCEN / "septic_shock.yaml"):
        patient = fhir["subject"]["reference"].split("/", 1)[1]
        for obs in parse_hl7_oru(_fhir_to_oru(fhir, ts)):
            eng.ingest(obs, now=ts)
    assert "septic_shock" in {a.kind for a in eng.active_alerts(patient)}

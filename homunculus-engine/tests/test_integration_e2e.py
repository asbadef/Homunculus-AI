# tests/test_integration_e2e.py
"""Whole-chain proof: HL7 -> edge bridge (normalize, serialize, store-and-forward) -> cloud
ingest API -> per-tenant engine -> cited alert. Including an uplink outage that buffers on the
edge and backfills to the cloud on reconnect, still producing the correct alert.
"""
from pathlib import Path

from fastapi.testclient import TestClient

import homunculus.scenarios
from homunculus.api.app import create_app
from homunculus.edge.forwarder import StoreAndForward
from homunculus.edge.serialize import observation_to_fhir
from homunculus.gateway.hl7 import parse_hl7_oru
from homunculus.scenarios.loader import load_scenario

SCEN = Path(homunculus.scenarios.__file__).parent


def _fhir_to_oru(fhir: dict, ts) -> str:
    """Re-encode a scenario's FHIR event as the HL7 a hospital feed would actually emit."""
    code = fhir["code"]["coding"][0]["code"]
    vq = fhir["valueQuantity"]
    patient = fhir["subject"]["reference"].split("/", 1)[1]
    hl7ts = ts.strftime("%Y%m%d%H%M%S")
    return "\r".join([
        rf"MSH|^~\&|MON|ICU|HOM|HOSP|{hl7ts}||ORU^R01|M|P|2.5",
        f"PID|1||{patient}^^^HOSP^MR",
        f"OBX|1|NM|{code}||{vq['value']}|{vq.get('unit', '')}|||||F|||{hl7ts}",
    ])


def _shock_scenario():
    events = load_scenario(SCEN / "septic_shock.yaml")
    patient = events[0][1]["subject"]["reference"].split("/", 1)[1]
    return events, patient


def test_hl7_edge_to_cloud_end_to_end_raises_shock():
    client = TestClient(create_app({"tok": "HOSP1"}))

    def send(payload):
        r = client.post("/ingest", json=payload, headers={"Authorization": "Bearer tok"})
        if r.status_code != 200:
            raise ConnectionError(f"ingest failed: {r.status_code}")

    saf = StoreAndForward(sender=send)
    events, patient = _shock_scenario()
    for ts, fhir in events:
        for obs in parse_hl7_oru(_fhir_to_oru(fhir, ts)):
            saf.submit(observation_to_fhir(obs))

    assert saf.pending == 0
    r = client.get(f"/alerts/{patient}", headers={"Authorization": "Bearer tok"})
    assert "septic_shock" in {a["kind"] for a in r.json()["alerts"]}


def test_uplink_outage_buffers_then_backfills_and_still_alerts():
    client = TestClient(create_app({"tok": "HOSP1"}))
    up = {"v": True}

    def send(payload):
        if not up["v"]:
            raise ConnectionError("uplink down")
        r = client.post("/ingest", json=payload, headers={"Authorization": "Bearer tok"})
        if r.status_code != 200:
            raise ConnectionError(f"ingest failed: {r.status_code}")

    saf = StoreAndForward(sender=send)
    events, patient = _shock_scenario()

    up["v"] = False  # internet drops before the stream starts
    for ts, fhir in events:
        for obs in parse_hl7_oru(_fhir_to_oru(fhir, ts)):
            saf.submit(observation_to_fhir(obs))
    assert saf.pending > 0  # nothing reached the cloud; all held on the edge

    up["v"] = True  # link restored
    saf.flush()
    assert saf.pending == 0  # backfilled in order

    r = client.get(f"/alerts/{patient}", headers={"Authorization": "Bearer tok"})
    assert "septic_shock" in {a["kind"] for a in r.json()["alerts"]}

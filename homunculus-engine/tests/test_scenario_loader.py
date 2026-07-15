# tests/test_scenario_loader.py
from homunculus.scenarios.loader import load_scenario

SAMPLE = """
patient_id: bed-3
start: "2026-07-14T10:00:00+00:00"
events:
  - at_min: 0
    code: suspected_infection
    value: 1.0
    unit: "bool"
  - at_min: 5
    code: lactate
    value: 3.1
    unit: "mmol/L"
"""


def test_loader_yields_fhir_observations_in_time_order(tmp_path):
    p = tmp_path / "s.yaml"
    p.write_text(SAMPLE, encoding="utf-8")
    events = load_scenario(p)
    assert events[0][0].isoformat() == "2026-07-14T10:00:00+00:00"
    fhir0 = events[0][1]
    assert fhir0["resourceType"] == "Observation"
    assert fhir0["code"]["coding"][0]["code"] == "suspected_infection"
    assert events[1][0].isoformat() == "2026-07-14T10:05:00+00:00"

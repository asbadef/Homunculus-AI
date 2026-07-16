# tests/test_scenarios_e2e.py
from pathlib import Path
from homunculus.gateway.fhir import parse_fhir_observation
from homunculus.pipeline import Engine
from homunculus.scenarios.loader import load_scenario

SCEN = Path("src/homunculus/scenarios")


def _run(scenario_file):
    eng = Engine()
    patient = None
    for ts, fhir in load_scenario(SCEN / scenario_file):
        obs = parse_fhir_observation(fhir)
        patient = obs.patient_id
        eng.ingest(obs, now=ts)
    return eng, patient


def test_septic_shock_scenario_fires_shock_alert_citing_sepsis3():
    eng, patient = _run("septic_shock.yaml")
    alerts = {a.kind: a for a in eng.active_alerts(patient)}
    assert "septic_shock" in alerts
    assert "sepsis-3-jama-2016" in alerts["septic_shock"].supporting_evidence
    # register: no orders
    for action in alerts["septic_shock"].recommended_actions:
        assert not action.lower().startswith(("give ", "administer ", "start ", "order "))


def test_stable_control_scenario_fires_no_sepsis_alert():
    eng, patient = _run("stable_control.yaml")
    kinds = {a.kind for a in eng.active_alerts(patient)}
    assert "septic_shock" not in kinds
    assert "sepsis" not in kinds
    assert "under_resuscitated_sepsis" not in kinds


def test_under_resuscitated_scenario_recommends_fluid_not_shock():
    eng, patient = _run("under_resuscitated.yaml")
    kinds = {a.kind for a in eng.active_alerts(patient)}
    assert "under_resuscitated_sepsis" in kinds
    assert "septic_shock" not in kinds


def test_golden_qanda_reasoning_present_in_shock_alert():
    # The vault Q&A: escalating pressor + lactate should surface a repeat-lactate recommendation.
    eng, patient = _run("septic_shock.yaml")
    shock = next(a for a in eng.active_alerts(patient) if a.kind == "septic_shock")
    assert any("lactate" in a.lower() for a in shock.recommended_actions)

# tests/test_reco_engine.py
import pytest
from homunculus.rules.finding import Finding, Citation, Severity, Urgency
from homunculus.reco.engine import to_alert, Alert


def _finding(kind="septic_shock"):
    return Finding(
        kind=kind, severity=Severity.CRITICAL, urgency=Urgency.IMMEDIATE,
        summary="Septic shock criteria met",
        reasoning="Vasopressor + lactate 3.1 after 30 mL/kg fluid.",
        citations=[Citation("sepsis-3-jama-2016", "shock criteria")],
    )


def test_alert_has_vision_schema_fields():
    a = to_alert(_finding(), patient_id="bed-3")
    assert a.patient_id == "bed-3"
    assert a.severity == "critical"
    assert a.urgency == "immediate"
    assert a.clinical_reasoning
    assert a.supporting_evidence == ["sepsis-3-jama-2016"]
    assert a.recommended_actions  # non-empty


def test_recommended_actions_are_recommendations_not_orders():
    a = to_alert(_finding(), patient_id="bed-3")
    for action in a.recommended_actions:
        low = action.lower()
        assert low.startswith(("consider", "review", "assess", "evaluate", "monitor"))
        # never an imperative order
        assert not low.startswith(("give ", "administer ", "start ", "order "))


def test_confidence_conveys_grade_not_a_number():
    a = to_alert(_finding(), patient_id="bed-3")
    assert isinstance(a.confidence, str)
    assert "certainty" in a.confidence.lower() or "recommendation" in a.confidence.lower()


def test_unknown_kind_still_produces_a_safe_generic_alert():
    a = to_alert(_finding(kind="something_new"), patient_id="bed-3")
    assert a.recommended_actions == ["Review the patient and the supporting evidence."]

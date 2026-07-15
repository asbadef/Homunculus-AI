# tests/rules/test_finding.py
from homunculus.rules.finding import Finding, Citation, Severity, Urgency


def test_citation_names_a_vault_source_note():
    c = Citation(source="sepsis-3-jama-2016", note="the >=2-point SOFA delta")
    assert c.source == "sepsis-3-jama-2016"


def test_finding_requires_at_least_one_citation():
    import pytest
    with pytest.raises(ValueError, match="at least one citation"):
        Finding(
            kind="sepsis",
            severity=Severity.MODERATE,
            urgency=Urgency.SOON,
            summary="x",
            reasoning="y",
            citations=[],
        )


def test_finding_carries_structured_fields():
    f = Finding(
        kind="septic_shock",
        severity=Severity.CRITICAL,
        urgency=Urgency.IMMEDIATE,
        summary="Septic shock criteria met",
        reasoning="Vasopressor + lactate 3.1 despite 30 mL/kg fluid",
        citations=[Citation("sepsis-3-jama-2016", "shock criteria")],
    )
    assert f.kind == "septic_shock"
    assert f.severity is Severity.CRITICAL
    assert f.citations[0].source == "sepsis-3-jama-2016"

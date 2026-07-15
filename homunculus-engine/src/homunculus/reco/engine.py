# src/homunculus/reco/engine.py
"""Finding -> Alert. Register: recommendations a clinician evaluates, never orders.
Confidence conveys GRADE certainty, not a fabricated probability."""
from __future__ import annotations

from dataclasses import dataclass

from homunculus.rules.finding import Finding, Severity, Urgency

_SEVERITY_NAME = {
    Severity.INFO: "info", Severity.LOW: "low", Severity.MODERATE: "moderate",
    Severity.HIGH: "high", Severity.CRITICAL: "critical",
}
_URGENCY_NAME = {
    Urgency.ROUTINE: "routine", Urgency.SOON: "soon", Urgency.IMMEDIATE: "immediate",
}

# Recommended actions per finding kind. Phrased as recommendations, never orders.
# Every verb is one of: Consider / Review / Assess / Evaluate / Monitor.
_ACTIONS: dict[str, list[str]] = {
    "septic_shock": [
        "Review vasopressor titration against a MAP target of 65 mmHg.",
        "Consider repeat lactate to confirm the trend.",
        "Review antibiotic coverage and source control.",
    ],
    "under_resuscitated_sepsis": [
        "Assess fluid responsiveness before escalating vasopressors.",
        "Consider continuing crystalloid toward 30 mL/kg if not contraindicated.",
        "Monitor lactate and MAP after the next fluid bolus.",
    ],
    "sepsis": [
        "Consider whether an infective source is being addressed.",
        "Monitor the SOFA trend and repeat labs as indicated.",
    ],
    "antibiotic_due": [
        "Review whether antibiotics can be given within the 1-hour window.",
    ],
    "antibiotic_overdue": [
        "Review antibiotic administration urgently — the 1-hour window has closed.",
    ],
}

# GRADE certainty phrasing per kind (from the vault). Not a probability.
_CONFIDENCE: dict[str, str] = {
    "septic_shock": "Criteria are deterministic (Sepsis-3). Antibiotic urgency: strong recommendation, very low certainty (SSC 2026).",
    "under_resuscitated_sepsis": "Fluid target: conditional recommendation, low certainty (SSC 2026).",
    "sepsis": "Sepsis-3 organ-dysfunction criterion (consensus definition).",
    "antibiotic_due": "Strong recommendation, very low certainty (SSC 2026).",
    "antibiotic_overdue": "Strong recommendation, very low certainty (SSC 2026).",
}


@dataclass(frozen=True)
class Alert:
    patient_id: str
    kind: str
    severity: str
    urgency: str
    summary: str
    clinical_reasoning: str
    supporting_evidence: list[str]   # vault source basenames
    recommended_actions: list[str]
    confidence: str
    source: str = "rule"             # 'rule' or (later) 'model'


def to_alert(finding: Finding, patient_id: str) -> Alert:
    return Alert(
        patient_id=patient_id,
        kind=finding.kind,
        severity=_SEVERITY_NAME[finding.severity],
        urgency=_URGENCY_NAME[finding.urgency],
        summary=finding.summary,
        clinical_reasoning=finding.reasoning,
        supporting_evidence=[c.source for c in finding.citations],
        recommended_actions=_ACTIONS.get(
            finding.kind, ["Review the patient and the supporting evidence."]
        ),
        confidence=_CONFIDENCE.get(finding.kind, "See supporting evidence."),
    )

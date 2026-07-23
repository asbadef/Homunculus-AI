# src/homunculus/rules/patient_relative.py
"""Patient-relative / comorbidity-aware layer.

Population-threshold scores (NEWS2 first) score every patient against the same boundaries.
This layer uses the patient's *own clinician-charted baseline* (from PatientProfile) to:

  1. **Downgrade chronic-normal.** A NEWS2 finding whose every points-scoring vital sits within
     the patient's charted baseline is chronic-expected — it stays visible but does NOT alarm or
     escalate (severity->LOW, urgency->ROUTINE, downgraded=True, chronic_context explains why).
  2. **Surface acute deviation.** When a charted vital's latest value falls OUTSIDE its baseline
     range, emit an `acute_change` finding — the case a population score under-represents (a
     chronic-hypertensive dropping to a systolic that only looks normal for an average patient).

Charter safety: the boundary is the clinician-charted range, never a number we mint. The register
is review-only. Findings cite news2-rcp-2017 (the Scale-2 patient-specific-normal precedent); the
reasoning states the range is clinician-provided.
"""
from __future__ import annotations

from dataclasses import replace

from homunculus.canonical import SignalCode
from homunculus.rules import news2
from homunculus.rules.finding import Citation, Finding, Severity, Urgency
from homunculus.state.profile import PatientProfile
from homunculus.state.timeline import PatientState

# NEWS2 breakdown parameter -> the signal whose latest value it scores.
_PARAM_SIGNAL: dict[str, SignalCode] = {
    "respiration_rate": SignalCode.RESP_RATE,
    "spo2": SignalCode.SPO2,
    "systolic_bp": SignalCode.SBP,
    "pulse": SignalCode.HEART_RATE,
    "temperature": SignalCode.TEMPERATURE,
}
_SIGNAL_LABEL: dict[SignalCode, str] = {
    SignalCode.RESP_RATE: "resp rate", SignalCode.SPO2: "SpO2", SignalCode.SBP: "systolic BP",
    SignalCode.HEART_RATE: "pulse", SignalCode.TEMPERATURE: "temperature",
}


def _val(state: PatientState, code: SignalCode) -> float | None:
    obs = state.latest(code)
    return None if obs is None else obs.value


def apply(findings: list[Finding], state: PatientState,
          profile: PatientProfile | None) -> list[Finding]:
    """Adjust population findings against the patient's baseline and append acute-change findings.
    A patient with no profile is left exactly as the population rules produced them."""
    if profile is None:
        return findings

    result = news2.score(state)
    out: list[Finding] = []
    for f in findings:
        out.append(_adjust_news2(f, state, profile, result) if f.kind == "news2" else f)
    out.extend(_acute_changes(state, profile))
    return out


def _adjust_news2(finding: Finding, state: PatientState, profile: PatientProfile,
                  result: news2.News2Result) -> Finding:
    explained: list[str] = []      # "pulse 125 within baseline 120-130"
    unexplained: list[str] = []    # param names not covered by an in-range baseline
    for name, pts in result.breakdown.items():
        if pts <= 0:
            continue
        sig = _PARAM_SIGNAL.get(name)
        br = profile.baselines.get(sig) if sig else None
        val = _val(state, sig) if sig else None
        if br is not None and val is not None and br.contains(val):
            explained.append(f"{_SIGNAL_LABEL[sig]} {val:g} within charted baseline "
                             f"{br.low:g}-{br.high:g}")
        else:
            unexplained.append(name)

    if explained and not unexplained:
        return replace(
            finding,
            severity=Severity.LOW,
            urgency=Urgency.ROUTINE,
            downgraded=True,
            chronic_context="Expected for this patient — " + "; ".join(explained) + ".",
        )
    if explained and unexplained:
        return replace(
            finding,
            chronic_context="Acute contributor(s): " + ", ".join(unexplained)
            + f" (chronic-expected: {'; '.join(explained)}).",
        )
    return finding


def _acute_changes(state: PatientState, profile: PatientProfile) -> list[Finding]:
    findings: list[Finding] = []
    for sig, br in profile.baselines.items():
        val = _val(state, sig)
        if val is None or br.contains(val):
            continue
        label = _SIGNAL_LABEL.get(sig, sig.value)
        direction = "below" if val < br.low else "above"
        findings.append(Finding(
            kind="acute_change",
            severity=Severity.MODERATE,
            urgency=Urgency.SOON,
            summary=f"{label} {val:g} outside this patient's charted baseline",
            reasoning=(
                f"{label} {val:g} is {direction} the range the clinician charted for this patient "
                f"({br.low:g}-{br.high:g}). A population score can miss this because the value looks "
                f"normal for an average patient; assess for an acute cause."
            ),
            citations=[Citation("news2-rcp-2017",
                                "Scale 2 precedent: 'normal' can be patient-specific")],
        ))
    return findings

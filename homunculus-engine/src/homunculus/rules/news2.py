# src/homunculus/rules/news2.py
"""NEWS2 early-warning score (RCP 2017).

Thresholds: Homunculus/wiki/concepts/news2.md (news2-rcp-2017).

Scale 1 only. Scale 2 (the hypercapnic / target-88-92% chart) is senior-authorised
and carries a threshold cell the captured secondary sources disagree on, so it is
deliberately NOT implemented here rather than bake in a value we cannot source.

Per the score's own honesty ethos: a parameter with no recent observation does not
contribute, and the result records which parameters were missing so a partial
aggregate is never presented as a complete NEWS2.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from homunculus.canonical import SignalCode
from homunculus.rules.finding import Citation, Finding, Severity, Urgency
from homunculus.state.timeline import PatientState


def resp_rate_points(rr: float) -> int:
    if rr <= 8:
        return 3
    if rr <= 11:
        return 1
    if rr <= 20:
        return 0
    if rr <= 24:
        return 2
    return 3


def spo2_scale1_points(spo2: float) -> int:
    if spo2 <= 91:
        return 3
    if spo2 <= 93:
        return 2
    if spo2 <= 95:
        return 1
    return 0


def air_or_oxygen_points(*, on_oxygen: bool) -> int:
    return 2 if on_oxygen else 0


def systolic_bp_points(sbp: float) -> int:
    if sbp <= 90:
        return 3
    if sbp <= 100:
        return 2
    if sbp <= 110:
        return 1
    if sbp <= 219:
        return 0
    return 3


def pulse_points(hr: float) -> int:
    if hr <= 40:
        return 3
    if hr <= 50:
        return 1
    if hr <= 90:
        return 0
    if hr <= 110:
        return 1
    if hr <= 130:
        return 2
    return 3


def temperature_points(temp: float) -> int:
    if temp <= 35.0:
        return 3
    if temp <= 36.0:
        return 1
    if temp <= 38.0:
        return 0
    if temp <= 39.0:
        return 1
    return 2


def consciousness_points(acvpu: float) -> int:
    """ACVPU as an ordinal: 0 = Alert, 1..4 = Confusion/Voice/Pain/Unresponsive."""
    return 0 if acvpu <= 0 else 3


# The five continuous monitor channels. If one is not reporting the aggregate is
# partial (it can only understate), and score() lists it in `missing`.
_CORE_VITALS = ("respiration_rate", "spo2", "systolic_bp", "pulse", "temperature")


@dataclass(frozen=True)
class News2Result:
    total: int
    breakdown: dict[str, int]      # parameter name -> points
    missing: list[str] = field(default_factory=list)   # core vitals with no observation
    red_param: bool = False        # any single parameter scored the maximum 3

    @property
    def partial(self) -> bool:
        return bool(self.missing)


def _val(state: PatientState, code: SignalCode) -> float | None:
    obs = state.latest(code)
    return None if obs is None else obs.value


def score(state: PatientState) -> News2Result:
    """Aggregate NEWS2 (Scale 1) from current state.

    Air-or-oxygen defaults to air (0) and consciousness to Alert (0) when not
    recorded — the benign, overwhelmingly-common case, and neither is derivable
    from monitor telemetry. Only the five continuous vitals are treated as
    'missing' when absent, so a partial aggregate is never shown as complete.
    """
    breakdown: dict[str, int] = {}
    missing: list[str] = []

    def core(name: str, code: SignalCode, fn) -> None:
        v = _val(state, code)
        if v is None:
            breakdown[name] = 0
            missing.append(name)
        else:
            breakdown[name] = fn(v)

    core("respiration_rate", SignalCode.RESP_RATE, resp_rate_points)
    core("spo2", SignalCode.SPO2, spo2_scale1_points)
    core("systolic_bp", SignalCode.SBP, systolic_bp_points)
    core("pulse", SignalCode.HEART_RATE, pulse_points)
    core("temperature", SignalCode.TEMPERATURE, temperature_points)

    breakdown["air_or_oxygen"] = air_or_oxygen_points(
        on_oxygen=(_val(state, SignalCode.SUPPLEMENTAL_OXYGEN) or 0.0) >= 1.0
    )
    breakdown["consciousness"] = consciousness_points(_val(state, SignalCode.ACVPU) or 0.0)

    total = sum(breakdown.values())
    red_param = any(p >= 3 for p in breakdown.values())
    return News2Result(total=total, breakdown=breakdown, missing=missing, red_param=red_param)


def _band(result: News2Result) -> tuple[Severity, Urgency, str] | None:
    """Map an aggregate to (severity, urgency, response). None = nothing to surface."""
    if result.total >= 7:
        return Severity.HIGH, Urgency.IMMEDIATE, "high risk — immediate emergency-team review"
    if result.total >= 5:
        return Severity.MODERATE, Urgency.SOON, "medium risk — urgent clinician review"
    if result.red_param:
        return Severity.MODERATE, Urgency.SOON, "single parameter scoring 3 — urgent ward review for the cause"
    return None


# NEWS2 inputs are all continuous vitals — they go stale in minutes, not hours. Operational
# data-recency defaults (configurable), not clinical claims (mirrors the SOFA staleness approach).
from datetime import datetime, timedelta  # noqa: E402

_NEWS2_FRESHNESS: dict[SignalCode, timedelta] = {
    SignalCode.RESP_RATE: timedelta(hours=1), SignalCode.SPO2: timedelta(hours=1),
    SignalCode.SBP: timedelta(hours=1), SignalCode.HEART_RATE: timedelta(hours=1),
    SignalCode.TEMPERATURE: timedelta(hours=2),
}
_VITAL_LABEL: dict[SignalCode, str] = {
    SignalCode.RESP_RATE: "resp rate", SignalCode.SPO2: "SpO2", SignalCode.SBP: "systolic BP",
    SignalCode.HEART_RATE: "pulse", SignalCode.TEMPERATURE: "temperature",
}


def _stale_vital_labels(state: PatientState, now: datetime) -> list[str]:
    aged: list[tuple[str, timedelta]] = []
    for code, window in _NEWS2_FRESHNESS.items():
        age = state.age(code, now)
        if age is not None and age > window:
            aged.append((_VITAL_LABEL[code], age))
    aged.sort(key=lambda kv: kv[1], reverse=True)
    return [label for label, _age in aged]


def evaluate(state: PatientState, now: datetime | None = None) -> list[Finding]:
    result = score(state)
    band = _band(result)
    if band is None:
        return []
    severity, urgency, response = band

    contributing = ", ".join(
        f"{name} {pts}" for name, pts in result.breakdown.items() if pts > 0
    )
    partial_note = ""
    if result.partial:
        partial_note = (
            f" This is a partial NEWS2: {', '.join(result.missing)} not recently recorded, "
            f"so the true aggregate can only be higher."
        )
    stale = _stale_vital_labels(state, now) if now is not None else []
    stale_note = ""
    if stale:
        stale_note = (f" Data recency: {', '.join(stale)} older than the expected refresh window; "
                      f"interpret the score with that in mind.")
    reasoning = (
        f"NEWS2 {result.total} ({response}). Contributing: {contributing}. "
        f"Screen for deterioration, not a diagnosis; the response is review, not an order."
        f"{partial_note}{stale_note}"
    )
    return [Finding(
        kind="news2",
        severity=severity,
        urgency=urgency,
        summary=f"NEWS2 {result.total} — {response.split(' — ')[0]}",
        reasoning=reasoning,
        citations=[Citation("news2-rcp-2017", "aggregate NEWS2 score, risk band and escalation response")],
        stale_inputs=stale,
    )]

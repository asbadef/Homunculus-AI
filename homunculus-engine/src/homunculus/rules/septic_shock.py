# src/homunculus/rules/septic_shock.py
"""Sepsis / septic shock / under-resuscitation.
Sources: sepsis-3-jama-2016 (criteria), surviving-sepsis-campaign-2026 (30 mL/kg anchor).
"""
from __future__ import annotations

from datetime import datetime, timedelta

from homunculus.canonical import SignalCode
from homunculus.rules.finding import Citation, Finding, Severity, Urgency
from homunculus.rules.sofa import stale_note, total_sofa
from homunculus.state.timeline import PatientState

LACTATE_SHOCK_THRESHOLD = 2.0     # mmol/L  (sepsis-3)
MAP_TARGET = 65.0                 # mmHg    (sepsis-3 / SSC)
FLUID_ML_PER_KG = 30.0            # mL/kg   (SSC 2026, within 3 h)
FLUID_WINDOW = timedelta(hours=3)
SOFA_SEPSIS_DELTA = 2             # sepsis-3


def _val(state: PatientState, code: SignalCode) -> float | None:
    obs = state.latest(code)
    return None if obs is None else obs.value


def _on_vasopressor(state: PatientState) -> bool:
    for code in (SignalCode.NOREPINEPHRINE_RATE, SignalCode.EPINEPHRINE_RATE,
                 SignalCode.DOPAMINE_RATE):
        v = _val(state, code)
        if v is not None and v > 0:
            return True
    return False


def _fluid_adequate(state: PatientState, now: datetime) -> bool:
    weight = _val(state, SignalCode.WEIGHT_KG)
    if not weight:
        return False
    given = state.sum_since(SignalCode.CRYSTALLOID_BOLUS_ML, now - FLUID_WINDOW)
    return given >= FLUID_ML_PER_KG * weight


def evaluate(state: PatientState, now: datetime) -> list[Finding]:
    findings: list[Finding] = []
    if (_val(state, SignalCode.SUSPECTED_INFECTION) or 0.0) < 1.0:
        return findings  # no suspected infection -> not our call to make

    sofa = total_sofa(state)
    lactate = _val(state, SignalCode.LACTATE)
    map_val = _val(state, SignalCode.MAP)

    on_pressor = _on_vasopressor(state)
    fluid_ok = _fluid_adequate(state, now)
    lactate_high = lactate is not None and lactate > LACTATE_SHOCK_THRESHOLD

    # Septic shock: pressor + lactate>2 + adequate fluid
    if on_pressor and lactate_high and fluid_ok:
        findings.append(Finding(
            kind="septic_shock",
            severity=Severity.CRITICAL,
            urgency=Urgency.IMMEDIATE,
            summary="Septic shock criteria met",
            reasoning=(
                f"Suspected infection with a vasopressor running, lactate {lactate} mmol/L "
                f"(> {LACTATE_SHOCK_THRESHOLD}), after adequate fluid resuscitation "
                f"(>= {FLUID_ML_PER_KG:.0f} mL/kg in 3 h). Hospital mortality > 40%."
            ),
            citations=[
                Citation("sepsis-3-jama-2016", "septic shock = vasopressor + lactate >2 despite fluids"),
                Citation("surviving-sepsis-campaign-2026", "30 mL/kg within 3 h; MAP target 65; norepinephrine first-line"),
            ],
        ))
    # Under-resuscitated sepsis: lactate>2 + hypotension + fluid NOT adequate
    elif lactate_high and map_val is not None and map_val < MAP_TARGET and not fluid_ok:
        findings.append(Finding(
            kind="under_resuscitated_sepsis",
            severity=Severity.HIGH,
            urgency=Urgency.IMMEDIATE,
            summary="Hypoperfusion before adequate fluid — assess fluid resuscitation",
            reasoning=(
                f"Lactate {lactate} mmol/L with MAP {map_val} mmHg, but < {FLUID_ML_PER_KG:.0f} "
                f"mL/kg crystalloid given in the last 3 h. This may be under-resuscitation, "
                f"not shock — the distinction changes the next action (volume vs pressors)."
            ),
            citations=[
                Citation("sepsis-3-jama-2016", "'despite adequate fluid resuscitation' precondition"),
                Citation("surviving-sepsis-campaign-2026", "at least 30 mL/kg crystalloid within 3 h"),
            ],
        ))

    # Sepsis (organ dysfunction), independent of the shock branch above.
    if sofa >= SOFA_SEPSIS_DELTA:
        findings.append(Finding(
            kind="sepsis",
            severity=Severity.HIGH,
            urgency=Urgency.SOON,
            summary=f"Sepsis criteria met (SOFA {sofa})",
            reasoning=(
                f"Suspected infection with SOFA {sofa} (>= {SOFA_SEPSIS_DELTA}); "
                f"acute organ dysfunction attributable to infection."
                f"{stale_note(state, now)}"
            ),
            citations=[Citation("sepsis-3-jama-2016", "sepsis = suspected infection + SOFA rise >= 2")],
        ))

    return findings

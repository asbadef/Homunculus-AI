# src/homunculus/rules/septic_shock.py
"""Sepsis / septic shock / under-resuscitation.
Sources: sepsis-3-jama-2016 (criteria), surviving-sepsis-campaign-2026 (30 mL/kg anchor).
"""
from __future__ import annotations

from datetime import datetime, timedelta

from homunculus.canonical import SignalCode
from homunculus.rules.finding import Citation, Finding, Severity, Urgency
from homunculus.rules.sofa import stale_input_labels, stale_note, total_sofa
from homunculus.state.profile import PatientProfile
from homunculus.state.timeline import PatientState

LACTATE_SHOCK_THRESHOLD = 2.0     # mmol/L  (sepsis-3)
MAP_TARGET = 65.0                 # mmHg    (sepsis-3 / SSC)
FLUID_ML_PER_KG = 30.0            # mL/kg   (SSC 2026, within 3 h)
FLUID_WINDOW = timedelta(hours=3)
SOFA_SEPSIS_DELTA = 2             # sepsis-3: a RISE of 2 points, not a total of 2
MAX_SOFA = 24                     # 6 organ systems x 4 points


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


def evaluate(state: PatientState, now: datetime,
             profile: PatientProfile | None = None) -> list[Finding]:
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
    #
    # The criterion is a RISE of >= 2 SOFA points over the patient's own pre-infection baseline —
    # not a total of 2. Comparing the absolute total was over-calling on exactly the patients an
    # ICU has most of: someone on chronic dialysis carries 2 renal points every day of their life,
    # so any suspected infection fired "sepsis" permanently, on a patient whose organs had not
    # changed at all. Alarm fatigue is a clinical harm, and this was manufacturing it.
    baseline, assumed = _baseline_sofa(profile)
    rise = sofa - baseline
    if rise >= SOFA_SEPSIS_DELTA:
        if assumed:
            # Baseline 0 is Sepsis-3's own stated default, so the numbers are unchanged from the
            # population case — but the assumption is now visible, because the clinician at the
            # bedside is the only one who knows whether it holds for this patient.
            detail = (
                f"Suspected infection with SOFA {sofa} (>= {SOFA_SEPSIS_DELTA}); "
                f"acute organ dysfunction attributable to infection. No baseline SOFA is "
                f"charted, so it is taken as 0 — Sepsis-3's stated assumption for a patient "
                f"not known to have preexisting organ dysfunction. If this patient has chronic "
                f"organ dysfunction, chart a baseline: part of this score may be their normal."
            )
            summary = f"Sepsis criteria met (SOFA {sofa})"
            citations = [
                Citation("sepsis-3-jama-2016", "sepsis = suspected infection + SOFA rise >= 2"),
                Citation("sepsis-3-jama-2016",
                         "baseline SOFA assumed 0 unless preexisting organ dysfunction is known"),
            ]
        else:
            detail = (
                f"Suspected infection with SOFA {sofa} against a charted baseline of {baseline} "
                f"— a rise of {rise} (>= {SOFA_SEPSIS_DELTA}); acute organ dysfunction "
                f"attributable to infection."
            )
            summary = f"Sepsis criteria met (SOFA {sofa}, baseline {baseline} → +{rise})"
            citations = [
                Citation("sepsis-3-jama-2016", "sepsis = suspected infection + SOFA rise >= 2"),
            ]
        findings.append(Finding(
            kind="sepsis",
            severity=Severity.HIGH,
            urgency=Urgency.SOON,
            summary=summary,
            reasoning=f"{detail}{stale_note(state, now)}",
            citations=citations,
            stale_inputs=stale_input_labels(state, now),
        ))

    return findings


def _baseline_sofa(profile: PatientProfile | None) -> tuple[int, bool]:
    """The patient's pre-infection SOFA and whether we assumed it. Returns (baseline, assumed)."""
    if profile is None or profile.baseline_sofa is None:
        return 0, True
    return profile.baseline_sofa, False

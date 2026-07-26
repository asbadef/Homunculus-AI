# src/homunculus/rules/sofa.py
"""SOFA score. Thresholds: Homunculus/wiki/concepts/sofa-score.md (sepsis-3-jama-2016).

Each organ scores 0-4. A missing signal scores 0 (SOFA assumes baseline 0 unless
documented). Catecholamine doses are ug/kg/min.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from homunculus.canonical import SignalCode
from homunculus.state.timeline import PatientState


def _val(state: PatientState, code: SignalCode) -> float | None:
    obs = state.latest(code)
    return None if obs is None else obs.value


# --- Data recency (B6) -------------------------------------------------------------------------
# Operational freshness windows per SOFA input — how old a value may be before the score is leaning
# on stale data. These are configurable operational defaults (like a monitor's refresh expectation),
# NOT sourced clinical claims: SOFA's thresholds (sepsis-3) are unchanged; staleness only flags
# recency so the reasoning can say the score rests on old data. Stale values are surfaced, never
# silently dropped (dropping would under-score).
_HOUR = timedelta(hours=1)
DEFAULT_FRESHNESS: dict[SignalCode, timedelta] = {
    SignalCode.MAP: _HOUR,
    SignalCode.NOREPINEPHRINE_RATE: _HOUR,
    SignalCode.EPINEPHRINE_RATE: _HOUR,
    SignalCode.DOPAMINE_RATE: _HOUR,
    SignalCode.DOBUTAMINE_RATE: _HOUR,
    SignalCode.PAO2_FIO2: 8 * _HOUR,
    SignalCode.GCS: 8 * _HOUR,
    SignalCode.CREATININE: 26 * _HOUR,
    SignalCode.BILIRUBIN: 26 * _HOUR,
    SignalCode.PLATELETS: 26 * _HOUR,
}
_INPUT_LABEL: dict[SignalCode, str] = {
    SignalCode.MAP: "MAP", SignalCode.NOREPINEPHRINE_RATE: "norepinephrine",
    SignalCode.EPINEPHRINE_RATE: "epinephrine", SignalCode.DOPAMINE_RATE: "dopamine",
    SignalCode.DOBUTAMINE_RATE: "dobutamine", SignalCode.PAO2_FIO2: "PaO2/FiO2",
    SignalCode.GCS: "GCS", SignalCode.CREATININE: "creatinine",
    SignalCode.BILIRUBIN: "bilirubin", SignalCode.PLATELETS: "platelets",
}


def stale_inputs(state: PatientState, now: datetime,
                 freshness: dict[SignalCode, timedelta] = DEFAULT_FRESHNESS) -> list[SignalCode]:
    """SOFA inputs that are PRESENT but older than their freshness window, oldest first.
    Missing inputs are already scored 0 and are not 'stale'."""
    aged: list[tuple[SignalCode, timedelta]] = []
    for code, window in freshness.items():
        age = state.age(code, now)
        if age is not None and age > window:
            aged.append((code, age))
    aged.sort(key=lambda kv: kv[1], reverse=True)
    return [code for code, _age in aged]


def stale_note(state: PatientState, now: datetime,
               freshness: dict[SignalCode, timedelta] = DEFAULT_FRESHNESS) -> str:
    """A one-line data-recency note for the finding reasoning, or '' when all inputs are fresh."""
    stale = stale_inputs(state, now, freshness)
    if not stale:
        return ""
    oldest = stale[0]
    hours = (state.age(oldest, now) or timedelta()).total_seconds() / 3600
    return (f" Data recency: {len(stale)} SOFA input(s) stale — oldest {_INPUT_LABEL[oldest]} "
            f"~{hours:.0f} h old; interpret the score with that in mind.")


def cardiovascular_points(state: PatientState) -> int:
    norepi = _val(state, SignalCode.NOREPINEPHRINE_RATE) or 0.0
    epi = _val(state, SignalCode.EPINEPHRINE_RATE) or 0.0
    dopamine = _val(state, SignalCode.DOPAMINE_RATE) or 0.0
    dobutamine = _val(state, SignalCode.DOBUTAMINE_RATE) or 0.0
    map_val = _val(state, SignalCode.MAP)

    # 4: dopamine >15 or epi >0.1 or norepi >0.1
    if dopamine > 15 or epi > 0.1 or norepi > 0.1:
        return 4
    # 3: dopamine 5.1-15 or epi <=0.1 or norepi <=0.1  (any pressor at low dose)
    if dopamine > 5 or epi > 0 or norepi > 0:
        return 3
    # 2: dopamine <5 or dobutamine any dose
    if dopamine > 0 or dobutamine > 0:
        return 2
    # 1: MAP < 70
    if map_val is not None and map_val < 70:
        return 1
    return 0


def respiration_points(state: PatientState) -> int:
    pf = _val(state, SignalCode.PAO2_FIO2)
    if pf is None:
        return 0
    support = (_val(state, SignalCode.ON_RESP_SUPPORT) or 0.0) >= 1.0
    if pf < 100 and support:
        return 4
    if pf < 200 and support:
        return 3
    if pf < 300:
        return 2
    if pf < 400:
        return 1
    return 0


def coagulation_points(state: PatientState) -> int:
    plt = _val(state, SignalCode.PLATELETS)
    if plt is None:
        return 0
    if plt < 20:
        return 4
    if plt < 50:
        return 3
    if plt < 100:
        return 2
    if plt < 150:
        return 1
    return 0


def renal_points(state: PatientState) -> int:
    cr = _val(state, SignalCode.CREATININE)
    if cr is None:
        return 0
    if cr > 5.0:
        return 4
    if cr >= 3.5:
        return 3
    if cr >= 2.0:
        return 2
    if cr >= 1.2:
        return 1
    return 0


def cns_points(state: PatientState) -> int:
    gcs = _val(state, SignalCode.GCS)
    if gcs is None:
        return 0
    if gcs < 6:
        return 4
    if gcs <= 9:
        return 3
    if gcs <= 12:
        return 2
    if gcs <= 14:
        return 1
    return 0


def liver_points(state: PatientState) -> int:
    bili = _val(state, SignalCode.BILIRUBIN)
    if bili is None:
        return 0
    if bili > 12.0:
        return 4
    if bili >= 6.0:
        return 3
    if bili >= 2.0:
        return 2
    if bili >= 1.2:
        return 1
    return 0


def total_sofa(state: PatientState) -> int:
    return (
        cardiovascular_points(state)
        + respiration_points(state)
        + coagulation_points(state)
        + renal_points(state)
        + cns_points(state)
        + liver_points(state)
    )

# src/homunculus/rules/sofa.py
"""SOFA score. Thresholds: Homunculus/wiki/concepts/sofa-score.md (sepsis-3-jama-2016).

Each organ scores 0-4. A missing signal scores 0 (SOFA assumes baseline 0 unless
documented). Catecholamine doses are ug/kg/min.
"""
from __future__ import annotations

from homunculus.canonical import SignalCode
from homunculus.state.timeline import PatientState


def _val(state: PatientState, code: SignalCode) -> float | None:
    obs = state.latest(code)
    return None if obs is None else obs.value


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

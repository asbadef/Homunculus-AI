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


def stale_input_labels(state: PatientState, now: datetime,
                       freshness: dict[SignalCode, timedelta] = DEFAULT_FRESHNESS) -> list[str]:
    """Human labels of the stale SOFA inputs, oldest first — for a finding's structured stale_inputs."""
    return [_INPUT_LABEL[code] for code in stale_inputs(state, now, freshness)]


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


# --- Band tables as pure functions of a value ----------------------------------------------------
# Split out from the state-reading versions below so the same table can be applied to ANY value,
# not only the latest one. The severity-scoring module needs exactly this: "worst value in the last
# 24 hours" is undefined without the table, because worst does not mean highest or lowest — it
# means *the value that scores most points*, and for a bidirectional parameter those are opposite
# ends. The state-reading functions now delegate here, so there is one table per organ and it
# cannot drift into two.


def respiration_points_of(pf: float | None, on_support: bool = False) -> int:
    if pf is None:
        return 0
    if pf < 100 and on_support:
        return 4
    if pf < 200 and on_support:
        return 3
    if pf < 300:
        return 2
    if pf < 400:
        return 1
    return 0


def coagulation_points_of(platelets: float | None) -> int:
    if platelets is None:
        return 0
    if platelets < 20:
        return 4
    if platelets < 50:
        return 3
    if platelets < 100:
        return 2
    if platelets < 150:
        return 1
    return 0


def renal_points_of(creatinine: float | None) -> int:
    if creatinine is None:
        return 0
    if creatinine > 5.0:
        return 4
    if creatinine >= 3.5:
        return 3
    if creatinine >= 2.0:
        return 2
    if creatinine >= 1.2:
        return 1
    return 0


def cns_points_of(gcs: float | None) -> int:
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


def liver_points_of(bilirubin: float | None) -> int:
    if bilirubin is None:
        return 0
    if bilirubin > 12.0:
        return 4
    if bilirubin >= 6.0:
        return 3
    if bilirubin >= 2.0:
        return 2
    if bilirubin >= 1.2:
        return 1
    return 0


def cardiovascular_points_of(*, map_value: float | None = None, norepinephrine: float = 0.0,
                             epinephrine: float = 0.0, dopamine: float = 0.0,
                             dobutamine: float = 0.0) -> int:
    """The one organ whose points are not a function of a single number.

    Kept in the same shape as the others so the worst-value machinery can treat it uniformly, but
    it takes the whole vasoactive picture because SOFA's cardiovascular row grades the SUPPORT a
    patient needs, not a measurement taken from them.
    """
    # 4: dopamine >15 or epi >0.1 or norepi >0.1
    if dopamine > 15 or epinephrine > 0.1 or norepinephrine > 0.1:
        return 4
    # 3: dopamine 5.1-15 or any low-dose epi/norepi
    if dopamine > 5 or epinephrine > 0 or norepinephrine > 0:
        return 3
    # 2: dopamine <=5 or dobutamine at any dose
    if dopamine > 0 or dobutamine > 0:
        return 2
    # 1: MAP < 70
    if map_value is not None and map_value < 70:
        return 1
    return 0


def cardiovascular_points(state: PatientState) -> int:
    return cardiovascular_points_of(
        map_value=_val(state, SignalCode.MAP),
        norepinephrine=_val(state, SignalCode.NOREPINEPHRINE_RATE) or 0.0,
        epinephrine=_val(state, SignalCode.EPINEPHRINE_RATE) or 0.0,
        dopamine=_val(state, SignalCode.DOPAMINE_RATE) or 0.0,
        dobutamine=_val(state, SignalCode.DOBUTAMINE_RATE) or 0.0,
    )


def respiration_points(state: PatientState) -> int:
    return respiration_points_of(
        _val(state, SignalCode.PAO2_FIO2),
        (_val(state, SignalCode.ON_RESP_SUPPORT) or 0.0) >= 1.0,
    )


def coagulation_points(state: PatientState) -> int:
    return coagulation_points_of(_val(state, SignalCode.PLATELETS))


def renal_points(state: PatientState) -> int:
    return renal_points_of(_val(state, SignalCode.CREATININE))


def cns_points(state: PatientState) -> int:
    return cns_points_of(_val(state, SignalCode.GCS))


def liver_points(state: PatientState) -> int:
    return liver_points_of(_val(state, SignalCode.BILIRUBIN))


def total_sofa(state: PatientState) -> int:
    return (
        cardiovascular_points(state)
        + respiration_points(state)
        + coagulation_points(state)
        + renal_points(state)
        + cns_points(state)
        + liver_points(state)
    )

# src/homunculus/model/scorer.py
"""Score a live PatientState with a trained early-sepsis artifact.

Resamples the patient's history into hourly rows (forward-filled within the window) and reuses the
SAME build_feature_vector as training (via homunculus_ml.featurespec, numpy-only), so live scoring
cannot drift from the trained features. Importing this module requires the optional homunculus-ml
package + numpy; the engine guards the import so it runs fine without them."""
from __future__ import annotations

from datetime import datetime, timedelta

import numpy as np

from homunculus.canonical import SignalCode
from homunculus.state.timeline import PatientState
from homunculus_ml.featurespec import build_feature_vector, WINDOW_HOURS

# Map engine signals to the PhysioNet column names the feature vector expects.
SIGNAL_TO_PHYSIONET = {
    SignalCode.HEART_RATE: "HR", SignalCode.SPO2: "O2Sat", SignalCode.TEMPERATURE: "Temp",
    SignalCode.SBP: "SBP", SignalCode.MAP: "MAP", SignalCode.RESP_RATE: "Resp",
    SignalCode.LACTATE: "Lactate", SignalCode.PLATELETS: "Platelets",
    SignalCode.CREATININE: "Creatinine", SignalCode.BILIRUBIN: "Bilirubin_total",
}


def _latest_before(state: PatientState, code: SignalCode, cutoff: datetime) -> float:
    vals = [o for o in state.history(code) if o.timestamp <= cutoff]
    return vals[-1].value if vals else float("nan")


def resample_hourly(state: PatientState, now: datetime, window_hours: int = WINDOW_HOURS) -> list[dict]:
    rows: list[dict] = []
    for h in range(window_hours - 1, -1, -1):
        cutoff = now - timedelta(hours=h)
        rows.append({phys: _latest_before(state, sig, cutoff)
                     for sig, phys in SIGNAL_TO_PHYSIONET.items()})
    return rows


class Scorer:
    def __init__(self, artifact: dict):
        self._model = artifact["model"]
        self._feature_names = artifact["feature_names"]
        self.threshold = artifact.get("threshold", 0.5)

    def score(self, state: PatientState, now: datetime) -> tuple[float, list[tuple[str, float]]]:
        rows = resample_hourly(state, now)
        static = {"Age": float("nan"), "Gender": float("nan")}
        fv = build_feature_vector(rows, static)
        x = np.array([[fv.get(name, np.nan) for name in self._feature_names]], dtype=float)
        risk = float(self._model.predict_proba(x)[0, 1])
        # transparent per-prediction explanation: the observed *_last / *_slope features furthest
        # from zero, ranked by magnitude (no SHAP dependency in slice 1).
        contrib = [(n, fv[n]) for n in self._feature_names
                   if (n.endswith("_last") or n.endswith("_slope")) and not np.isnan(fv[n])]
        contrib.sort(key=lambda kv: abs(kv[1]), reverse=True)
        return risk, contrib[:3]

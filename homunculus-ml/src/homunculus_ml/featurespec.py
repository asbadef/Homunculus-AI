# src/homunculus_ml/featurespec.py
"""The shared, dependency-light feature contract (numpy + stdlib only).

Kept free of pandas/sklearn so the engine's optional scoring seam can import build_feature_vector
without pulling the training stack. build_matrix (pandas) lives in features.py and reuses this."""
from __future__ import annotations

import numpy as np

WINDOW_HOURS = 8
VITALS = ["HR", "O2Sat", "Temp", "SBP", "MAP", "Resp"]
LABS = ["Lactate", "WBC", "Creatinine", "Platelets", "Bilirubin_total"]
SIGNALS = VITALS + LABS
STATICS = ["Age", "Gender"]


def _series(rows: list[dict], signal: str) -> np.ndarray:
    return np.array([r.get(signal, np.nan) for r in rows], dtype=float)


def _ffill_last(vals: np.ndarray) -> float:
    non_nan = vals[~np.isnan(vals)]
    return float(non_nan[-1]) if non_nan.size else float("nan")


def build_feature_vector(rows: list[dict], static: dict) -> dict[str, float]:
    fv: dict[str, float] = {}
    for sig in SIGNALS:
        vals = _series(rows, sig)
        observed = vals[~np.isnan(vals)]
        fv[f"{sig}_last"] = _ffill_last(vals)
        fv[f"{sig}_min"] = float(observed.min()) if observed.size else float("nan")
        fv[f"{sig}_max"] = float(observed.max()) if observed.size else float("nan")
        if observed.size >= 2:
            idx = np.flatnonzero(~np.isnan(vals))
            fv[f"{sig}_delta"] = float(observed[-1] - observed[0])
            # per-hour slope across the observed span (endpoint-based: robust, warning-free)
            span = float(idx[-1] - idx[0]) or 1.0
            fv[f"{sig}_slope"] = float((observed[-1] - observed[0]) / span)
        else:
            fv[f"{sig}_delta"] = 0.0
            fv[f"{sig}_slope"] = 0.0
    for s in STATICS:
        fv[s] = float(static.get(s, np.nan))
    return fv

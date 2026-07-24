# src/homunculus_ml/features.py
"""Per-hour feature engineering. The shape both training and the live engine share.

build_feature_vector(rows, static) is PURE (numpy + stdlib): rows is a chronological list of
per-hour dicts up to and INCLUDING the scoring hour, so no feature can ever see the future. The
engine builds the same `rows` from a resampled PatientState, guaranteeing train/score parity."""
from __future__ import annotations

import numpy as np
import pandas as pd

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
            fv[f"{sig}_delta"] = float(observed[-1] - observed[0])
            idx = np.flatnonzero(~np.isnan(vals))
            fv[f"{sig}_slope"] = float(np.polyfit(idx, observed, 1)[0])
        else:
            fv[f"{sig}_delta"] = 0.0
            fv[f"{sig}_slope"] = 0.0
    for s in STATICS:
        fv[s] = float(static.get(s, np.nan))
    return fv


def build_matrix(patient_df: pd.DataFrame):
    """Slide an expanding window (capped at WINDOW_HOURS) over each patient; one feature row per hour.
    Returns (X: DataFrame, y: ndarray, meta: DataFrame[patient_id, ICULOS])."""
    feature_rows, labels, meta = [], [], []
    for pid, g in patient_df.groupby("patient_id", sort=False):
        g = g.sort_values("ICULOS").reset_index(drop=True)
        static = {s: g[s].iloc[0] for s in STATICS}
        hour_dicts = g[SIGNALS].to_dict("records")
        for i in range(len(g)):
            window = hour_dicts[max(0, i - WINDOW_HOURS + 1): i + 1]
            feature_rows.append(build_feature_vector(window, static))
            labels.append(int(g["SepsisLabel"].iloc[i]))
            meta.append({"patient_id": pid, "ICULOS": int(g["ICULOS"].iloc[i])})
    return pd.DataFrame(feature_rows), np.array(labels), pd.DataFrame(meta)

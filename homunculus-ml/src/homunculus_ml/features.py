# src/homunculus_ml/features.py
"""Training-side feature matrix. The per-hour vector is shared with the engine via featurespec.

build_feature_vector (and the signal-name constants) live in featurespec.py, which is numpy-only so
the engine can reuse it without pandas/sklearn. build_matrix here slides the window over a patient
frame and is pandas-bound (training only)."""
from __future__ import annotations

import pandas as pd

from homunculus_ml.featurespec import (  # re-exported for training callers/tests
    build_feature_vector, WINDOW_HOURS, VITALS, LABS, SIGNALS, STATICS,
)

__all__ = ["build_feature_vector", "build_matrix", "WINDOW_HOURS", "VITALS", "LABS",
           "SIGNALS", "STATICS"]


def build_matrix(patient_df: pd.DataFrame):
    """Slide an expanding window (capped at WINDOW_HOURS) over each patient; one feature row per hour.
    Returns (X: DataFrame, y: ndarray, meta: DataFrame[patient_id, ICULOS])."""
    import numpy as np

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

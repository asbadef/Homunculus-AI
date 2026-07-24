# src/homunculus_ml/split.py
"""Patient-level split so no patient's hours land in two splits (the classic ICU leakage bug)."""
from __future__ import annotations

import numpy as np
import pandas as pd


def split_patients(meta: pd.DataFrame, *, val_frac=0.15, test_frac=0.15, seed=0):
    patients = np.array(sorted(meta["patient_id"].unique()))
    rng = np.random.default_rng(seed)
    rng.shuffle(patients)
    n = len(patients)
    n_test = int(round(n * test_frac))
    n_val = int(round(n * val_frac))
    test = set(patients[:n_test])
    val = set(patients[n_test:n_test + n_val])
    train = set(patients[n_test + n_val:])
    return train, val, test

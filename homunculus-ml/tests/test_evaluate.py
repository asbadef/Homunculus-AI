# tests/test_evaluate.py
from pathlib import Path

import numpy as np
import pandas as pd

from homunculus_ml.evaluate import metrics, run_ablation
from homunculus_ml.features import build_matrix
from homunculus_ml.data import load_dataset

FIX = Path(__file__).resolve().parents[1] / "fixtures" / "synthetic"


def test_metrics_perfect_scores_give_auroc_one():
    y = np.array([0, 0, 1, 1])
    proba = np.array([0.1, 0.2, 0.8, 0.9])
    m = metrics(y, proba)
    assert m["auroc"] == 1.0
    assert 0.0 <= m["brier"] <= 1.0


def test_metrics_handles_single_class_without_crashing():
    m = metrics(np.array([0, 0, 0]), np.array([0.1, 0.2, 0.3]))
    assert m["auroc"] is None   # undefined with one class, reported honestly


def test_run_ablation_returns_with_and_without_treatment_features():
    df = pd.concat(
        [load_dataset(FIX).assign(patient_id=lambda d, k=k: d["patient_id"] + f"_{k}")
         for k in range(6)], ignore_index=True)
    X, y, meta = build_matrix(df)
    ablate_cols = [c for c in X.columns if c.split("_")[0] in {"Lactate", "WBC"}]
    res = run_ablation(X, y, ablate_cols, seed=0)
    assert "full" in res and "ablated" in res
    assert "auroc" in res["full"]

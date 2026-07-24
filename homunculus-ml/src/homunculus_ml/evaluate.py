# src/homunculus_ml/evaluate.py
"""Honest evaluation: AUROC, Brier (calibration), and the intervention-feature ablation.

The point of the ablation is the Epic-Sepsis-Model lesson: measure how much the model leans on
treatment-adjacent features versus physiology by removing them and re-scoring."""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score, brier_score_loss

from homunculus_ml.train import train_model


def metrics(y_true: np.ndarray, proba: np.ndarray) -> dict:
    y_true = np.asarray(y_true)
    single_class = len(np.unique(y_true)) < 2
    return {
        "auroc": None if single_class else float(roc_auc_score(y_true, proba)),
        "brier": float(brier_score_loss(y_true, proba)) if not single_class
        else float(np.mean((proba - y_true) ** 2)),
        "n": int(len(y_true)),
        "prevalence": float(np.mean(y_true)),
    }


def _fit_score(X: pd.DataFrame, y: np.ndarray, seed: int) -> dict:
    art = train_model(X, y, seed=seed)
    proba = art["model"].predict_proba(X.to_numpy())[:, 1]
    return metrics(y, proba)


def run_ablation(X: pd.DataFrame, y: np.ndarray, ablate_cols: list[str], *, seed: int = 0) -> dict:
    full = _fit_score(X, y, seed)
    kept = [c for c in X.columns if c not in set(ablate_cols)]
    ablated = _fit_score(X[kept], y, seed)
    return {"full": full, "ablated": ablated,
            "auroc_delta": (None if full["auroc"] is None or ablated["auroc"] is None
                            else full["auroc"] - ablated["auroc"])}

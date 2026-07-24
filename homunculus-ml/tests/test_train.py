# tests/test_train.py
from pathlib import Path

import pandas as pd

from homunculus_ml.train import train_model, load_artifact
from homunculus_ml.features import build_matrix
from homunculus_ml.data import load_dataset

FIX = Path(__file__).resolve().parents[1] / "fixtures" / "synthetic"


def _tiny_xy():
    # duplicate the two fixture patients into a few pseudo-patients so both classes are present
    df = load_dataset(FIX)
    frames = []
    for k in range(6):
        d = df.copy()
        d["patient_id"] = d["patient_id"] + f"_{k}"
        frames.append(d)
    big = pd.concat(frames, ignore_index=True)
    X, y, meta = build_matrix(big)
    return X, y


def test_train_returns_artifact_with_feature_names(tmp_path):
    X, y = _tiny_xy()
    art = train_model(X, y, out_path=tmp_path / "model.joblib")
    assert art["feature_names"] == list(X.columns)
    assert 0.0 <= art["threshold"] <= 1.0


def test_artifact_round_trips_and_scores(tmp_path):
    X, y = _tiny_xy()
    train_model(X, y, out_path=tmp_path / "model.joblib")
    art = load_artifact(tmp_path / "model.joblib")
    proba = art["model"].predict_proba(X[art["feature_names"]].to_numpy())[:, 1]
    assert proba.shape == (len(X),)
    assert ((proba >= 0) & (proba <= 1)).all()

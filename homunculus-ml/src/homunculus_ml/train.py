# src/homunculus_ml/train.py
"""Fit the early-sepsis model (HistGradientBoosting; LR baseline) and persist a scoring artifact."""
from __future__ import annotations

from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler


def train_model(X: pd.DataFrame, y: np.ndarray, *, out_path: str | Path | None = None,
                seed: int = 0) -> dict:
    feature_names = list(X.columns)
    Xv = X.to_numpy()

    model = HistGradientBoostingClassifier(
        max_depth=3, learning_rate=0.05, max_iter=200,
        l2_regularization=1.0, random_state=seed,
    )
    model.fit(Xv, y)

    # transparent baseline (imputer+scaler because LR cannot take NaN)
    baseline = make_pipeline(
        SimpleImputer(strategy="median"), StandardScaler(),
        LogisticRegression(max_iter=1000, class_weight="balanced"),
    )
    baseline.fit(Xv, y)

    artifact = {"model": model, "baseline": baseline,
                "feature_names": feature_names, "threshold": 0.5}
    if out_path is not None:
        Path(out_path).parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(artifact, out_path)
    return artifact


def load_artifact(path: str | Path) -> dict:
    return joblib.load(path)


def main(argv: list[str] | None = None) -> None:
    """Reproducible end-to-end run against a LOCAL PhysioNet dir (data never enters the repo)."""
    import argparse
    from pathlib import Path

    from homunculus_ml.data import load_dataset
    from homunculus_ml.features import build_matrix
    from homunculus_ml.split import split_patients
    from homunculus_ml.evaluate import metrics
    from homunculus_ml.report import render_report

    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--out", default="artifacts/model.joblib")
    ap.add_argument("--report", default="artifacts/metrics-report.md")
    args = ap.parse_args(argv)

    df = load_dataset(args.data_dir)
    X, y, meta = build_matrix(df)
    train, val, test = split_patients(meta)
    tr = meta["patient_id"].isin(train).to_numpy()
    te = meta["patient_id"].isin(test).to_numpy()
    art = train_model(X[tr], y[tr], out_path=args.out)
    proba = art["model"].predict_proba(X[te][art["feature_names"]].to_numpy())[:, 1]
    m = metrics(y[te], proba)
    report = render_report(data_dir=args.data_dir, n_patients=meta["patient_id"].nunique(),
                           n_hours=len(meta),
                           splits={"train": len(train), "val": len(val), "test": len(test)},
                           test_metrics=m, ablation={"auroc_delta": None})
    Path(args.report).parent.mkdir(parents=True, exist_ok=True)
    Path(args.report).write_text(report, encoding="utf-8")
    print(f"wrote {args.out} and {args.report}: AUROC={m['auroc']}")


if __name__ == "__main__":
    main()

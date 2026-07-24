# Early Sepsis-Onset ML Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reproducible, honestly-evaluated early sepsis-onset prediction pipeline (adult ICU, PhysioNet 2019, gradient-boosted trees) plus an additive `sepsis_watch` scoring seam in the engine.

**Architecture:** A new offline `homunculus-ml/` package owns data loading, leakage-safe windowed feature engineering, a patient-level split, training (HistGradientBoosting + logistic baseline), and an honest evaluation harness (PhysioNet utility, AUROC, calibration, lead-time, intervention ablation). A pure `build_feature_vector` function is shared with the engine's new `homunculus/model/scorer.py`, which resamples a live `PatientState` into hourly rows and emits an additive, model-labelled `sepsis_watch` alert that never overrides the rules. Real PhysioNet data stays out of the repo; everything here is tested on a tiny synthetic fixture.

**Tech Stack:** Python 3.14, numpy, pandas, scikit-learn (`HistGradientBoostingClassifier`, `LogisticRegression`, metrics, `CalibratedClassifierCV`), joblib, pytest. The engine gains an *optional* dependency on `homunculus-ml` (the model seam is inert if it is not installed).

---

## Reference: PhysioNet/CinC 2019 format

One pipe-separated file per patient (`p000001.psv`), one row per ICU hour. Header columns include vitals `HR, O2Sat, Temp, SBP, MAP, DBP, Resp`, labs `Lactate, WBC, Creatinine, Platelets, Bilirubin_total, ...`, statics `Age, Gender, HospAdmTime, ICULOS`, and the target `SepsisLabel` (already shifted: 1 from 6 h before onset onward for septic patients, else 0). Missing measurements are empty cells (`NaN`).

## File structure

```
homunculus-ml/
  pyproject.toml
  src/homunculus_ml/__init__.py
  src/homunculus_ml/data.py        # load .psv -> tidy long/wide frame
  src/homunculus_ml/features.py    # build_feature_vector (shared, pure) + build_matrix
  src/homunculus_ml/labels.py      # horizon / time-zero handling
  src/homunculus_ml/split.py       # patient-level split
  src/homunculus_ml/train.py       # fit + persist artifact
  src/homunculus_ml/evaluate.py    # utility score, AUROC, calibration, lead-time, ablation
  src/homunculus_ml/report.py      # write committed metrics report (no PHI)
  fixtures/synthetic/p000001.psv   # tiny synthetic PhysioNet-shaped patients
  fixtures/synthetic/p000002.psv
  tests/...

homunculus-engine/src/homunculus/model/__init__.py
homunculus-engine/src/homunculus/model/scorer.py   # PatientState -> feature vector -> risk + top features
homunculus-engine/src/homunculus/pipeline.py        # (modify) hook sepsis_watch
homunculus-engine/src/homunculus/reco/engine.py     # (modify) actions/confidence for sepsis_watch
```

**Feature-vector contract (shared, the DRY seam):** `build_feature_vector(rows, static)` in
`homunculus_ml/features.py` is pure (numpy + stdlib only). `rows` is a chronological list of
per-hour dicts `{signal: float|nan}`, last element = scoring hour; `static` is `{"Age":.., "Gender":..}`.
Both training (sliding window over a patient frame) and the engine (resampled `PatientState`) build
`rows` and call this one function, so the two can never drift.

---

### Task 1: Scaffold the `homunculus-ml` package + synthetic fixture

**Files:**
- Create: `homunculus-ml/pyproject.toml`
- Create: `homunculus-ml/src/homunculus_ml/__init__.py`
- Create: `homunculus-ml/fixtures/synthetic/p000001.psv`, `homunculus-ml/fixtures/synthetic/p000002.psv`
- Create: `homunculus-ml/tests/__init__.py`

- [ ] **Step 1: Write `pyproject.toml`**

```toml
[project]
name = "homunculus-ml"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = ["numpy>=1.26", "pandas>=2.1", "scikit-learn>=1.4", "joblib>=1.3"]

[project.optional-dependencies]
dev = ["pytest>=8.0"]

[tool.pytest.ini_options]
pythonpath = ["src"]
testpaths = ["tests"]

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"
```

- [ ] **Step 2: Create the package init**

`src/homunculus_ml/__init__.py`:
```python
"""Homunculus offline ML: early sepsis-onset prediction (adult ICU, PhysioNet 2019)."""
```

- [ ] **Step 3: Create two tiny synthetic PhysioNet-shaped patients**

`fixtures/synthetic/p000001.psv` — a septic patient (onset late, SepsisLabel flips to 1). Columns kept small but real-named; empty cells are NaN.
```
HR|O2Sat|Temp|SBP|MAP|Resp|Lactate|WBC|Creatinine|Platelets|Bilirubin_total|Age|Gender|ICULOS|SepsisLabel
88|98|37.0|120|80|16|1.0|8.0|0.9|250|0.5|64|1|1|0
90|97|37.1|118|79|17||||||64|1|2|0
96|96|37.4|112|74|19|1.4||1.0|240||64|1|3|0
104|95|37.9|104|69|22|2.2|12.0|1.1|210|0.7|64|1|4|0
112|93|38.4|96|64|25|3.1||1.3||64|1|5|1
120|92|38.8|92|61|27|3.6|14.0|1.4|180|0.9|64|1|6|1
```

`fixtures/synthetic/p000002.psv` — a stable patient who never becomes septic (SepsisLabel all 0).
```
HR|O2Sat|Temp|SBP|MAP|Resp|Lactate|WBC|Creatinine|Platelets|Bilirubin_total|Age|Gender|ICULOS|SepsisLabel
76|99|36.8|128|86|14|0.9|7.0|0.8|260|0.4|51|0|1|0
78|98|36.9|126|85|15||||||51|0|2|0
74|99|37.0|130|88|14|1.0|7.5|0.8|255|0.4|51|0|3|0
80|98|36.9|124|84|15|||0.9||51|0|4|0
77|99|37.1|127|86|14|0.8|7.2|0.8|258|0.4|51|0|5|0
```

- [ ] **Step 4: Create `tests/__init__.py`** (empty file).

- [ ] **Step 5: Verify the package imports**

Run: `cd homunculus-ml && python -m venv .venv && ./.venv/Scripts/python.exe -m pip install -e ".[dev]" && ./.venv/Scripts/python.exe -c "import homunculus_ml; print('ok')"`
Expected: prints `ok`.

- [ ] **Step 6: Commit**

```bash
git add homunculus-ml/pyproject.toml homunculus-ml/src homunculus-ml/fixtures homunculus-ml/tests
git commit -m "feat(ml): scaffold homunculus-ml package + synthetic PhysioNet fixture"
```

---

### Task 2: `data.py` — load PhysioNet `.psv` files into a tidy frame

**Files:**
- Create: `homunculus-ml/src/homunculus_ml/data.py`
- Test: `homunculus-ml/tests/test_data.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_data.py
from pathlib import Path
from homunculus_ml.data import load_patient, load_dataset

FIX = Path(__file__).resolve().parents[1] / "fixtures" / "synthetic"


def test_load_patient_reads_rows_and_patient_id():
    df = load_patient(FIX / "p000001.psv")
    assert df["patient_id"].iloc[0] == "p000001"
    assert len(df) == 6
    assert df["ICULOS"].tolist() == [1, 2, 3, 4, 5, 6]
    # empty cells parse as NaN, not the string ""
    assert df["Lactate"].isna().iloc[1]


def test_load_dataset_concatenates_all_patients():
    df = load_dataset(FIX)
    assert set(df["patient_id"].unique()) == {"p000001", "p000002"}
    assert df["SepsisLabel"].sum() == 2   # only p000001's last two hours
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd homunculus-ml && ./.venv/Scripts/python.exe -m pytest tests/test_data.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'homunculus_ml.data'`.

- [ ] **Step 3: Write the implementation**

```python
# src/homunculus_ml/data.py
"""Load PhysioNet/CinC 2019 .psv files into a tidy pandas frame. No PHI is stored in the repo;
this reads from a local path the user provides."""
from __future__ import annotations

from pathlib import Path

import pandas as pd


def load_patient(path: str | Path) -> pd.DataFrame:
    path = Path(path)
    df = pd.read_csv(path, sep="|")
    df.insert(0, "patient_id", path.stem)
    return df


def load_dataset(directory: str | Path) -> pd.DataFrame:
    directory = Path(directory)
    files = sorted(directory.glob("*.psv"))
    if not files:
        raise FileNotFoundError(f"no .psv files under {directory}")
    return pd.concat([load_patient(f) for f in files], ignore_index=True)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd homunculus-ml && ./.venv/Scripts/python.exe -m pytest tests/test_data.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add homunculus-ml/src/homunculus_ml/data.py homunculus-ml/tests/test_data.py
git commit -m "feat(ml): PhysioNet .psv loader -> tidy frame"
```

---

### Task 3: `labels.py` — prediction horizon and time-zero

**Files:**
- Create: `homunculus-ml/src/homunculus_ml/labels.py`
- Test: `homunculus-ml/tests/test_labels.py`

PhysioNet's `SepsisLabel` is already the 6-h-shifted target, so slice 1 uses it directly as `y`.
`labels.py` documents time-zero and exposes the onset hour (first `SepsisLabel==1`) for lead-time
evaluation, returning `None` for never-septic patients.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_labels.py
import pandas as pd
from homunculus_ml.labels import onset_hour, PREDICTION_LEAD_HOURS


def _pt(labels):
    return pd.DataFrame({"ICULOS": list(range(1, len(labels) + 1)), "SepsisLabel": labels})


def test_onset_hour_is_first_positive():
    assert onset_hour(_pt([0, 0, 1, 1])) == 3


def test_onset_hour_none_when_never_septic():
    assert onset_hour(_pt([0, 0, 0])) is None


def test_prediction_lead_documented():
    assert PREDICTION_LEAD_HOURS == 6
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd homunculus-ml && ./.venv/Scripts/python.exe -m pytest tests/test_labels.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Write the implementation**

```python
# src/homunculus_ml/labels.py
"""Label / time-zero handling for early sepsis prediction.

Time-zero is the PhysioNet/CinC 2019 *utilization-based* sepsis onset: the hour t_sepsis at which
the patient met the challenge's Sepsis-3 proxy. SepsisLabel is already 1 from (t_sepsis - 6) onward,
so it IS the early-prediction target and is used directly as y. This module records that definition
and exposes the onset hour for lead-time evaluation."""
from __future__ import annotations

import pandas as pd

PREDICTION_LEAD_HOURS = 6   # SepsisLabel turns positive 6 h before clinical onset (challenge design)


def onset_hour(patient_df: pd.DataFrame) -> int | None:
    positive = patient_df.loc[patient_df["SepsisLabel"] == 1, "ICULOS"]
    return int(positive.iloc[0]) if len(positive) else None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd homunculus-ml && ./.venv/Scripts/python.exe -m pytest tests/test_labels.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add homunculus-ml/src/homunculus_ml/labels.py homunculus-ml/tests/test_labels.py
git commit -m "feat(ml): document time-zero + onset-hour for lead-time"
```

---

### Task 4: `features.py` — the shared, leakage-safe feature vector

**Files:**
- Create: `homunculus-ml/src/homunculus_ml/features.py`
- Test: `homunculus-ml/tests/test_features.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_features.py
import math
import numpy as np
import pandas as pd
from homunculus_ml.features import build_feature_vector, build_matrix, WINDOW_HOURS, VITALS

FIX = __import__("pathlib").Path(__file__).resolve().parents[1] / "fixtures" / "synthetic"


def test_current_value_is_last_non_nan():
    rows = [{"HR": 90.0}, {"HR": float("nan")}, {"HR": 110.0}]
    fv = build_feature_vector(rows, {"Age": 64.0, "Gender": 1.0})
    assert fv["HR_last"] == 110.0


def test_current_value_falls_back_to_prior_when_latest_missing():
    rows = [{"HR": 90.0}, {"HR": 110.0}, {"HR": float("nan")}]
    fv = build_feature_vector(rows, {"Age": 64.0, "Gender": 1.0})
    assert fv["HR_last"] == 110.0   # forward-filled, never a future value


def test_delta_and_slope_use_only_past_rows():
    rows = [{"HR": 80.0}, {"HR": 90.0}, {"HR": 100.0}]
    fv = build_feature_vector(rows, {"Age": 64.0, "Gender": 1.0})
    assert fv["HR_delta"] == 20.0            # last - first in window
    assert fv["HR_max"] == 100.0
    assert fv["HR_min"] == 80.0
    assert math.isclose(fv["HR_slope"], 10.0)  # +10 per hour


def test_all_nan_signal_yields_nan_features_not_crash():
    rows = [{"HR": float("nan")}, {"HR": float("nan")}]
    fv = build_feature_vector(rows, {"Age": 64.0, "Gender": 1.0})
    assert math.isnan(fv["HR_last"])


def test_static_features_passed_through():
    fv = build_feature_vector([{"HR": 90.0}], {"Age": 64.0, "Gender": 1.0})
    assert fv["Age"] == 64.0 and fv["Gender"] == 1.0


def test_build_matrix_produces_one_row_per_hour_with_label():
    df = pd.read_csv(FIX / "p000001.psv", sep="|")
    df.insert(0, "patient_id", "p000001")
    X, y, meta = build_matrix(df)
    assert len(X) == len(df)                 # one feature row per patient-hour
    assert list(y) == df["SepsisLabel"].tolist()
    assert "HR_last" in X.columns and "Age" in X.columns
    # leakage guard: the feature row for hour 2 must not see hour 3's HR
    row2 = X.iloc[1]
    assert row2["HR_max"] == max(88.0, 90.0)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd homunculus-ml && ./.venv/Scripts/python.exe -m pytest tests/test_features.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Write the implementation**

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd homunculus-ml && ./.venv/Scripts/python.exe -m pytest tests/test_features.py -v`
Expected: PASS (6 passed).

- [ ] **Step 5: Commit**

```bash
git add homunculus-ml/src/homunculus_ml/features.py homunculus-ml/tests/test_features.py
git commit -m "feat(ml): shared leakage-safe windowed feature vector"
```

---

### Task 5: `split.py` — patient-level train/val/test split (no leakage)

**Files:**
- Create: `homunculus-ml/src/homunculus_ml/split.py`
- Test: `homunculus-ml/tests/test_split.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_split.py
import pandas as pd
from homunculus_ml.split import split_patients


def test_no_patient_appears_in_two_splits():
    meta = pd.DataFrame({"patient_id": [f"p{i:03d}" for i in range(20) for _ in range(3)]})
    tr, va, te = split_patients(meta, seed=0)
    assert tr.isdisjoint(va) and tr.isdisjoint(te) and va.isdisjoint(te)
    assert tr | va | te == set(meta["patient_id"])


def test_split_is_deterministic_for_a_seed():
    meta = pd.DataFrame({"patient_id": [f"p{i:03d}" for i in range(20)]})
    assert split_patients(meta, seed=1) == split_patients(meta, seed=1)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd homunculus-ml && ./.venv/Scripts/python.exe -m pytest tests/test_split.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Write the implementation**

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd homunculus-ml && ./.venv/Scripts/python.exe -m pytest tests/test_split.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add homunculus-ml/src/homunculus_ml/split.py homunculus-ml/tests/test_split.py
git commit -m "feat(ml): patient-level no-leakage split"
```

---

### Task 6: `train.py` — fit HistGBDT (+ LR baseline) and persist the artifact

**Files:**
- Create: `homunculus-ml/src/homunculus_ml/train.py`
- Test: `homunculus-ml/tests/test_train.py`

The artifact is a dict `{"model", "feature_names", "threshold", "baseline"}` persisted with joblib.
`HistGradientBoostingClassifier` handles NaN natively (labs are sparse), so no imputation is needed.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_train.py
from pathlib import Path
import numpy as np
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd homunculus-ml && ./.venv/Scripts/python.exe -m pytest tests/test_train.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Write the implementation**

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd homunculus-ml && ./.venv/Scripts/python.exe -m pytest tests/test_train.py -v`
Expected: PASS (2 passed). (A convergence warning from the tiny baseline fit is acceptable.)

- [ ] **Step 5: Commit**

```bash
git add homunculus-ml/src/homunculus_ml/train.py homunculus-ml/tests/test_train.py
git commit -m "feat(ml): train HistGBDT + LR baseline, persist scoring artifact"
```

---

### Task 7: `evaluate.py` — utility, AUROC, calibration, lead-time, ablation

**Files:**
- Create: `homunculus-ml/src/homunculus_ml/evaluate.py`
- Test: `homunculus-ml/tests/test_evaluate.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_evaluate.py
import numpy as np
import pandas as pd
from homunculus_ml.evaluate import metrics, run_ablation
from homunculus_ml.features import build_matrix, SIGNALS
from homunculus_ml.data import load_dataset

FIX = __import__("pathlib").Path(__file__).resolve().parents[1] / "fixtures" / "synthetic"


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
    # treat labs as the "intervention-adjacent" set to prove the ablation runs end to end
    ablate_cols = [c for c in X.columns if c.split("_")[0] in {"Lactate", "WBC"}]
    res = run_ablation(X, y, ablate_cols, seed=0)
    assert "full" in res and "ablated" in res
    assert "auroc" in res["full"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd homunculus-ml && ./.venv/Scripts/python.exe -m pytest tests/test_evaluate.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Write the implementation**

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd homunculus-ml && ./.venv/Scripts/python.exe -m pytest tests/test_evaluate.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add homunculus-ml/src/homunculus_ml/evaluate.py homunculus-ml/tests/test_evaluate.py
git commit -m "feat(ml): evaluation metrics + intervention-feature ablation"
```

---

### Task 8: `report.py` + a runnable end-to-end training entrypoint

**Files:**
- Create: `homunculus-ml/src/homunculus_ml/report.py`
- Modify: `homunculus-ml/src/homunculus_ml/train.py` (add a `main()` CLI entry)
- Test: `homunculus-ml/tests/test_report.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_report.py
from homunculus_ml.report import render_report


def test_report_states_setting_and_metrics_and_caveat():
    text = render_report(
        data_dir="/local/physionet",
        n_patients=40336, n_hours=1552210,
        splits={"train": 28000, "val": 6000, "test": 6336},
        test_metrics={"auroc": 0.79, "brier": 0.05, "prevalence": 0.018},
        ablation={"auroc_delta": 0.06},
    )
    assert "AUROC" in text and "0.79" in text
    assert "generalis" in text.lower() or "setting" in text.lower()   # the caveat is present
    assert "ablation" in text.lower()
    assert "/local/physionet" in text   # provenance of the (out-of-repo) data
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd homunculus-ml && ./.venv/Scripts/python.exe -m pytest tests/test_report.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Write `report.py`**

```python
# src/homunculus_ml/report.py
"""Render the committed metrics report. Contains only aggregate numbers + provenance — never PHI."""
from __future__ import annotations


def render_report(*, data_dir, n_patients, n_hours, splits, test_metrics, ablation) -> str:
    m = test_metrics
    return f"""# Early Sepsis Model — Metrics Report

**Data (out of repo):** `{data_dir}` — {n_patients} patients, {n_hours} patient-hours.
**Split (patient-level, no leakage):** {splits}

## Test-set performance
- **AUROC:** {m['auroc']}
- **Brier (calibration):** {m['brier']}
- **Prevalence:** {m['prevalence']}

## Intervention-feature ablation
- **AUROC delta (full − ablated):** {ablation['auroc_delta']}
  A large positive delta means the model leans on treatment-adjacent features (the Epic Sepsis Model
  caution); a small delta means it stands on physiology.

## Generalisation caveat
This model was trained on the PhysioNet/CinC 2019 ICU cohort (specific US hospitals). Performance is
**not** a universal constant — cf. the Phoenix 7.1% vs 28.5% cross-setting mortality gap. Treat the
score as a setting-specific early-warning signal, revalidate before use elsewhere, and never as a
diagnosis.
"""
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd homunculus-ml && ./.venv/Scripts/python.exe -m pytest tests/test_report.py -v`
Expected: PASS (1 passed).

- [ ] **Step 5: Add the CLI entrypoint to `train.py`**

Append to `src/homunculus_ml/train.py`:
```python
def main(argv: list[str] | None = None) -> None:
    """Reproducible end-to-end run against a LOCAL PhysioNet dir (data never enters the repo)."""
    import argparse
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
    from pathlib import Path
    Path(args.report).parent.mkdir(parents=True, exist_ok=True)
    Path(args.report).write_text(report, encoding="utf-8")
    print(f"wrote {args.out} and {args.report}: AUROC={m['auroc']}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 6: Add `artifacts/` to `.gitignore`** so trained models / reports with real numbers are not committed by accident.

Append to the repo root `.gitignore`:
```
# ML artifacts trained on out-of-repo data
homunculus-ml/artifacts/
```

- [ ] **Step 7: Commit**

```bash
git add homunculus-ml/src/homunculus_ml/report.py homunculus-ml/src/homunculus_ml/train.py homunculus-ml/tests/test_report.py .gitignore
git commit -m "feat(ml): metrics report + reproducible training CLI (data stays out of repo)"
```

---

### Task 9: Engine seam — `model/scorer.py` (PatientState → risk + top features)

**Files:**
- Create: `homunculus-engine/src/homunculus/model/__init__.py`
- Create: `homunculus-engine/src/homunculus/model/scorer.py`
- Test: `homunculus-engine/tests/test_model_scorer.py`

The scorer resamples a `PatientState` into hourly rows ending at `now`, builds the shared feature
vector, and returns `(risk, top_features)`. It imports `build_feature_vector` from `homunculus_ml`
inside a guard so the base engine still runs when the ML package is absent.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_model_scorer.py
import numpy as np
import pytest
from datetime import datetime, timezone, timedelta
from homunculus.canonical import Observation, SignalCode
from homunculus.state.timeline import PatientState

pytest.importorskip("homunculus_ml")   # seam is optional; skip if ML package not installed
from homunculus.model.scorer import resample_hourly, SIGNAL_TO_PHYSIONET, Scorer

T0 = datetime(2026, 7, 25, 10, 0, tzinfo=timezone.utc)


def _state():
    st = PatientState("bed-3")
    for h, hr in enumerate([88, 96, 104, 112]):
        st.ingest(Observation("bed-3", SignalCode.HEART_RATE, float(hr), "bpm",
                              T0 + timedelta(hours=h), "mon"))
    return st


def test_resample_hourly_produces_one_row_per_hour_ending_now():
    rows = resample_hourly(_state(), now=T0 + timedelta(hours=3), window_hours=4)
    assert len(rows) == 4
    assert rows[-1]["HR"] == 112.0          # latest hour
    assert rows[0]["HR"] == 88.0


class _FakeModel:
    feature_names_in_ = None
    def predict_proba(self, X):
        # risk rises with HR_last (col chosen by the scorer's feature order)
        return np.column_stack([1 - X[:, 0] / 200.0, X[:, 0] / 200.0])


def test_scorer_returns_risk_and_top_features():
    art = {"model": _FakeModel(), "feature_names": ["HR_last"], "threshold": 0.5}
    scorer = Scorer(art)
    risk, top = scorer.score(_state(), now=T0 + timedelta(hours=3))
    assert 0.0 <= risk <= 1.0
    assert isinstance(top, list) and top and isinstance(top[0], tuple)
```

- [ ] **Step 2: Run test to verify it fails**

Run (from repo root): `homunculus-engine/.venv/Scripts/python.exe -m pytest homunculus-engine/tests/test_model_scorer.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'homunculus.model'` (or a skip if `homunculus_ml` is not installed — install it with `homunculus-engine/.venv/Scripts/python.exe -m pip install -e homunculus-ml` first so the test runs).

- [ ] **Step 3: Write the implementation**

```python
# src/homunculus/model/__init__.py
"""Optional ML scoring seam. Inert unless a trained artifact is loaded."""
```

```python
# src/homunculus/model/scorer.py
"""Score a live PatientState with a trained early-sepsis artifact.

Resamples the patient's history into hourly rows (forward-filled within the window) and reuses the
SAME build_feature_vector as training, so live scoring cannot drift from the trained features."""
from __future__ import annotations

from datetime import datetime, timedelta

import numpy as np

from homunculus.canonical import SignalCode
from homunculus.state.timeline import PatientState
from homunculus_ml.features import build_feature_vector, WINDOW_HOURS

# Map engine signals to PhysioNet column names the feature vector expects.
SIGNAL_TO_PHYSIONET = {
    SignalCode.HEART_RATE: "HR", SignalCode.SPO2: "O2Sat", SignalCode.TEMPERATURE: "Temp",
    SignalCode.SBP: "SBP", SignalCode.MAP: "MAP", SignalCode.RESP_RATE: "Resp",
    SignalCode.LACTATE: "Lactate", SignalCode.PLATELETS: "Platelets",
    SignalCode.CREATININE: "Creatinine", SignalCode.BILIRUBIN: "Bilirubin_total",
}


def _latest_before(state: PatientState, code: SignalCode, cutoff: datetime):
    vals = [o for o in state.history(code) if o.timestamp <= cutoff]
    return vals[-1].value if vals else float("nan")


def resample_hourly(state: PatientState, now: datetime, window_hours: int = WINDOW_HOURS) -> list[dict]:
    rows: list[dict] = []
    for h in range(window_hours - 1, -1, -1):
        cutoff = now - timedelta(hours=h)
        row = {phys: _latest_before(state, sig, cutoff)
               for sig, phys in SIGNAL_TO_PHYSIONET.items()}
        rows.append(row)
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
        # transparent per-prediction explanation: the observed features furthest from benign,
        # ranked by |value| among the *_last and *_slope features (no SHAP dependency in slice 1).
        contrib = [(n, fv[n]) for n in self._feature_names
                   if (n.endswith("_last") or n.endswith("_slope")) and not np.isnan(fv[n])]
        contrib.sort(key=lambda kv: abs(kv[1]), reverse=True)
        return risk, contrib[:3]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `homunculus-engine/.venv/Scripts/python.exe -m pytest homunculus-engine/tests/test_model_scorer.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/model homunculus-engine/tests/test_model_scorer.py
git commit -m "feat(engine): model scoring seam (PatientState -> risk + top features)"
```

---

### Task 10: Pipeline integration — additive `sepsis_watch` alert

**Files:**
- Modify: `homunculus-engine/src/homunculus/pipeline.py`
- Modify: `homunculus-engine/src/homunculus/reco/engine.py`
- Modify: `homunculus-engine/src/homunculus/rules/finding.py` (allow a model finding to carry its risk)
- Test: `homunculus-engine/tests/test_pipeline_model.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_pipeline_model.py
import numpy as np
import pytest
from datetime import datetime, timezone, timedelta
from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine

pytest.importorskip("homunculus_ml")
T0 = datetime(2026, 7, 25, 10, 0, tzinfo=timezone.utc)


class _RisingModel:
    """risk = HR_last/200 so a climbing heart rate crosses the watch threshold."""
    def predict_proba(self, X):
        p = np.clip(X[:, 0] / 200.0, 0, 1)
        return np.column_stack([1 - p, p])


def _obs(code, value, minute=0):
    return Observation("bed-3", code, value, "u", T0 + timedelta(minutes=minute), "mon")


def test_engine_emits_model_sepsis_watch_when_risk_high():
    art = {"model": _RisingModel(), "feature_names": ["HR_last"], "threshold": 0.5}
    eng = Engine()
    eng.set_model(art)                       # load the scoring seam
    eng.ingest(_obs(SignalCode.HEART_RATE, 150), now=T0)   # 150/200 = 0.75 > 0.5
    alerts = {a.kind: a for a in eng.active_alerts("bed-3")}
    assert "sepsis_watch" in alerts
    a = alerts["sepsis_watch"]
    assert a.source == "model"
    assert a.supporting_evidence  # cites the model report / vault, not a rule threshold


def test_no_model_means_no_watch_alert():
    eng = Engine()
    eng.ingest(_obs(SignalCode.HEART_RATE, 150), now=T0)
    assert "sepsis_watch" not in {a.kind for a in eng.active_alerts("bed-3")}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `homunculus-engine/.venv/Scripts/python.exe -m pytest homunculus-engine/tests/test_pipeline_model.py -v`
Expected: FAIL with `AttributeError: 'Engine' object has no attribute 'set_model'`.

- [ ] **Step 3: Add a `model_risk` finding builder + engine wiring**

Add to `src/homunculus/reco/engine.py` `_ACTIONS`:
```python
    "sepsis_watch": [
        "Assess the patient early — a statistical model flags rising sepsis risk before the rule fires.",
        "Review the contributing signals below and the trend.",
        "Treat as a prompt to look, not a diagnosis.",
    ],
```
Add to `_CONFIDENCE`:
```python
    "sepsis_watch": "Statistical early-warning model (setting-specific, not a diagnosis); revalidate before use outside the training setting.",
```

Add to `src/homunculus/pipeline.py` imports and `Engine`:
```python
from homunculus.rules.finding import Citation, Finding, Severity, Urgency
```
```python
    def set_model(self, artifact: dict | None) -> None:
        """Load (or clear) the optional ML scoring artifact. No artifact => seam inert."""
        if artifact is None:
            self._scorer = None
            return
        from homunculus.model.scorer import Scorer
        self._scorer = Scorer(artifact)
```
Initialise `self._scorer = None` in `__init__`, then after the patient-relative line in `ingest`:
```python
        if self._scorer is not None:
            risk, top = self._scorer.score(state, now)
            if risk >= self._scorer.threshold:
                drivers = ", ".join(f"{n} {v:g}" for n, v in top) or "rising trend"
                findings.append(Finding(
                    kind="sepsis_watch",
                    severity=Severity.MODERATE,
                    urgency=Urgency.SOON,
                    summary=f"Model early-warning: sepsis risk {risk:.0%}",
                    reasoning=(f"A statistical model estimates {risk:.0%} risk of sepsis onset from the "
                               f"recent trend (top contributors: {drivers}). This is an early heads-up "
                               f"before the deterministic rule fires — a prompt to look, not a diagnosis."),
                    citations=[Citation("physionet-cinc-2019", "early-sepsis model, setting-specific")],
                ))
```
Then set `source="model"` on the alert. Because `to_alert` defaults `source="rule"`, add after building alerts in `ingest`:
```python
        alerts = [to_alert(f, obs.patient_id) for f in findings]
        alerts = [replace(a, source="model") if a.kind == "sepsis_watch" else a for a in alerts]
```
and add `from dataclasses import replace` at the top of `pipeline.py`.

- [ ] **Step 4: Run test to verify it passes**

Run: `homunculus-engine/.venv/Scripts/python.exe -m pytest homunculus-engine/tests/test_pipeline_model.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Run the full engine suite to confirm no regression**

Run: `homunculus-engine/.venv/Scripts/python.exe -m pytest homunculus-engine -q`
Expected: all pass (existing 187 + new).

- [ ] **Step 6: Commit**

```bash
git add homunculus-engine/src/homunculus/pipeline.py homunculus-engine/src/homunculus/reco/engine.py homunculus-engine/tests/test_pipeline_model.py
git commit -m "feat(engine): additive model sepsis_watch alert (never overrides rules)"
```

---

### Task 11: Vault + guide + memory

**Files:**
- Create: `Homunculus/raw/physionet-cinc-2019-raw.md`
- Create: `Homunculus/wiki/sources/physionet-cinc-2019.md`
- Create: `Homunculus/wiki/concepts/early-sepsis-ml-model.md`
- Modify: `Homunculus/wiki/INDEX.md`, `Homunculus/wiki/concepts/open-questions.md`
- Modify: `docs/homunculus-rehber-TR.md`

- [ ] **Step 1: Capture the dataset as a source** (`raw/physionet-cinc-2019-raw.md`), `type: dataset`,
  `capture: extract`, with the honesty note that only the dataset *description* is captured, not the
  data (which never enters the repo). Include the real citation: Reyna MA, et al. "Early Prediction of
  Sepsis From Clinical Data: The PhysioNet/Computing in Cardiology Challenge 2019." *Crit Care Med* 2020.

- [ ] **Step 2: Write the source note** (`wiki/sources/physionet-cinc-2019.md`): what it is, authority
  (moderate — a challenge dataset from specific US ICUs), the claims it supports (early prediction is
  feasible from routine vitals/labs; the utility metric), and its limitations (setting-specific, the
  label is a Sepsis-3 proxy).

- [ ] **Step 3: Write the concept article** (`wiki/concepts/early-sepsis-ml-model.md`): the model as an
  additive signal, the label/time-zero, the honest-evaluation stance (leakage guard, calibration,
  intervention ablation, the Epic-Sepsis-Model and Phoenix cautions), and how it surfaces as
  `sepsis_watch` — links `[[treatment-confounding-in-severity-scores]]`, `[[generalisation-and-setting]]`,
  `[[why-early-detection-is-possible]]`.

- [ ] **Step 4: Update `INDEX.md`** (one line for the new article + the source in the sources table) and
  tick the relevant `open-questions.md` items (ML label, time-zero, dataset choice) as *decided for the
  adult model*, citing the spec.

- [ ] **Step 5: Update `docs/homunculus-rehber-TR.md`** — add an ML glossary entry (etiket, time-zero,
  AUROC, kalibrasyon, sızıntı, ablasyon in plain Turkish) and flip the roadmap row for the ML model to
  in-progress/done for slice 1.

- [ ] **Step 6: Commit**

```bash
git add Homunculus/ docs/homunculus-rehber-TR.md
git commit -m "vault+guide: capture PhysioNet 2019, early-sepsis-ml-model article, roadmap"
```

---

## Self-Review

**1. Spec coverage:**
- PHI boundary (data out of repo, synthetic fixtures, artifact gitignored) → Tasks 1, 8 (.gitignore), 11. ✓
- Package structure → Task 1. ✓
- Label / time-zero → Task 3. ✓
- Leakage-safe windowed features + shared contract → Task 4 (+ reused in Task 9). ✓
- Patient-level split → Task 5. ✓
- GBDT + LR baseline + artifact → Task 6. ✓
- Utility/AUROC/calibration/lead-time/ablation → Task 7 (utility-score note: PhysioNet's full utility
  needs onset timing; slice 1 ships AUROC+Brier+ablation and the onset hook from Task 3 for lead-time —
  the full challenge utility function is a documented follow-up, called out here so it is not silently
  dropped). ⚠ partial-by-design, noted.
- Report with generalisation caveat → Task 8. ✓
- Engine additive `sepsis_watch`, model-labelled, never overrides → Tasks 9–10. ✓
- Vault/guide → Task 11. ✓

**2. Placeholder scan:** No TBD/TODO; every code step carries complete code. The only deferred item
(full PhysioNet utility function) is explicitly scoped as follow-up, not hidden. ✓

**3. Type consistency:** artifact dict keys (`model`, `baseline`, `feature_names`, `threshold`) are
identical across Tasks 6, 7, 9, 10. `build_feature_vector(rows, static)` signature matches in Tasks 4
and 9. `Engine.set_model` / `self._scorer` consistent in Task 10. `SIGNAL_TO_PHYSIONET` uses real
`SignalCode` members present in `canonical.py`. ✓

---

## Notes for the implementer

- **Install order:** the engine's model tests need `homunculus-ml` installed into the engine venv:
  `homunculus-engine/.venv/Scripts/python.exe -m pip install -e homunculus-ml`. Without it, Task 9/10
  tests `skip` (by design) rather than fail.
- **No real data here.** Every test uses the synthetic fixture. The `train.py main()` path is for the
  user to run against their local PhysioNet copy; do not attempt to download it in this environment.
- **Kill stray venv `python.exe`** if a run hangs (same gotcha as the SSE work).

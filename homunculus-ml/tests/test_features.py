# tests/test_features.py
import math
from pathlib import Path

import pandas as pd

from homunculus_ml.features import build_feature_vector, build_matrix, WINDOW_HOURS, VITALS

FIX = Path(__file__).resolve().parents[1] / "fixtures" / "synthetic"


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

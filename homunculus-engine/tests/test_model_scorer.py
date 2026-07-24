# tests/test_model_scorer.py
from datetime import datetime, timezone, timedelta

import pytest

from homunculus.canonical import Observation, SignalCode
from homunculus.state.timeline import PatientState

pytest.importorskip("homunculus_ml")   # seam is optional; skip if ML package not installed
np = pytest.importorskip("numpy")
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
    def predict_proba(self, X):
        # risk rises with the first feature (HR_last), scaled into [0, 1]
        p = np.clip(X[:, 0] / 200.0, 0, 1)
        return np.column_stack([1 - p, p])


def test_scorer_returns_risk_and_top_features():
    art = {"model": _FakeModel(), "feature_names": ["HR_last"], "threshold": 0.5}
    scorer = Scorer(art)
    risk, top = scorer.score(_state(), now=T0 + timedelta(hours=3))
    assert 0.0 <= risk <= 1.0
    assert isinstance(top, list) and top and isinstance(top[0], tuple)

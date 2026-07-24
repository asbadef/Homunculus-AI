# tests/test_pipeline_model.py
from datetime import datetime, timezone, timedelta

import pytest

from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine

pytest.importorskip("homunculus_ml")
np = pytest.importorskip("numpy")

T0 = datetime(2026, 7, 25, 10, 0, tzinfo=timezone.utc)


class _RisingModel:
    """risk = HR_last / 200 so a climbing heart rate crosses the watch threshold."""
    def predict_proba(self, X):
        p = np.clip(X[:, 0] / 200.0, 0, 1)
        return np.column_stack([1 - p, p])


def _obs(code, value, minute=0):
    return Observation("bed-3", code, value, "u", T0 + timedelta(minutes=minute), "mon")


def test_engine_emits_model_sepsis_watch_when_risk_high():
    art = {"model": _RisingModel(), "feature_names": ["HR_last"], "threshold": 0.5}
    eng = Engine()
    eng.set_model(art)                                     # load the scoring seam
    eng.ingest(_obs(SignalCode.HEART_RATE, 150), now=T0)  # 150/200 = 0.75 > 0.5
    alerts = {a.kind: a for a in eng.active_alerts("bed-3")}
    assert "sepsis_watch" in alerts
    a = alerts["sepsis_watch"]
    assert a.source == "model"
    assert a.supporting_evidence  # cites the model dataset, not a rule threshold


def test_no_model_means_no_watch_alert():
    eng = Engine()
    eng.ingest(_obs(SignalCode.HEART_RATE, 150), now=T0)
    assert "sepsis_watch" not in {a.kind for a in eng.active_alerts("bed-3")}

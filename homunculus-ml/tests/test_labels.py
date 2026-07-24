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

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

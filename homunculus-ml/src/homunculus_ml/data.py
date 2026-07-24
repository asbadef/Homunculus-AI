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

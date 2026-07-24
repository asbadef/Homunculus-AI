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

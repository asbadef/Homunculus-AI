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

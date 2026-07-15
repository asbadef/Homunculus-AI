# tests/rules/test_sofa.py
from datetime import datetime, timezone, timedelta
from homunculus.canonical import Observation, SignalCode
from homunculus.state.timeline import PatientState
from homunculus.rules.sofa import (
    cardiovascular_points, respiration_points, coagulation_points,
    renal_points, cns_points, liver_points, total_sofa,
)

T0 = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)


def _state(**signals):
    st = PatientState("bed-3")
    for code, value in signals.items():
        st.ingest(Observation("bed-3", SignalCode[code], value, "u", T0, "dev"))
    return st


def test_cardiovascular_points_map_ge_70_is_zero():
    assert cardiovascular_points(_state(MAP=72)) == 0

def test_cardiovascular_points_map_below_70_is_one():
    assert cardiovascular_points(_state(MAP=64)) == 1

def test_cardiovascular_points_low_dose_norepi_is_three():
    # norepinephrine <= 0.1 ug/kg/min -> 3 points
    assert cardiovascular_points(_state(MAP=64, NOREPINEPHRINE_RATE=0.08)) == 3

def test_cardiovascular_points_high_dose_norepi_is_four():
    # norepinephrine > 0.1 -> 4 points
    assert cardiovascular_points(_state(MAP=60, NOREPINEPHRINE_RATE=0.25)) == 4

def test_respiration_points_pf_below_200_with_support_is_three():
    st = _state(PAO2_FIO2=180, ON_RESP_SUPPORT=1.0)
    assert respiration_points(st) == 3

def test_respiration_points_pf_below_300_no_support_is_two():
    st = _state(PAO2_FIO2=250, ON_RESP_SUPPORT=0.0)
    assert respiration_points(st) == 2

def test_coagulation_points_platelets_below_100_is_two():
    assert coagulation_points(_state(PLATELETS=90)) == 2

def test_renal_points_creatinine_2_to_3_4_is_two():
    assert renal_points(_state(CREATININE=2.5)) == 2

def test_cns_points_gcs_10_to_12_is_two():
    assert cns_points(_state(GCS=11)) == 2

def test_liver_points_bilirubin_2_to_5_9_is_two():
    assert liver_points(_state(BILIRUBIN=3.0)) == 2

def test_total_sofa_sums_available_organs():
    st = _state(MAP=64, PLATELETS=90, CREATININE=2.5)  # 1 + 2 + 2
    assert total_sofa(st) == 5

def test_total_sofa_treats_missing_organ_as_zero():
    st = _state(MAP=72)  # everything else absent
    assert total_sofa(st) == 0

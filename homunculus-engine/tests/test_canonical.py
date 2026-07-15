# tests/test_canonical.py
from datetime import datetime, timezone
from homunculus.canonical import Observation, SignalCode


def test_observation_holds_value_unit_time_and_patient():
    ts = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)
    obs = Observation(
        patient_id="bed-3",
        code=SignalCode.LACTATE,
        value=3.1,
        unit="mmol/L",
        timestamp=ts,
        source_device="abg-analyzer-1",
    )
    assert obs.patient_id == "bed-3"
    assert obs.code is SignalCode.LACTATE
    assert obs.value == 3.1
    assert obs.unit == "mmol/L"
    assert obs.timestamp == ts
    assert obs.source_device == "abg-analyzer-1"


def test_signal_codes_cover_the_sepsis_pathway():
    # Every signal the SOFA / septic-shock rules need must exist.
    required = {
        "HEART_RATE", "RESP_RATE", "SPO2", "TEMPERATURE", "SBP", "MAP", "GCS",
        "LACTATE", "PLATELETS", "BILIRUBIN", "CREATININE", "URINE_OUTPUT_ML",
        "PAO2_FIO2", "FIO2", "ON_RESP_SUPPORT",
        "NOREPINEPHRINE_RATE", "DOPAMINE_RATE", "EPINEPHRINE_RATE", "DOBUTAMINE_RATE",
        "CRYSTALLOID_BOLUS_ML", "WEIGHT_KG",
        "SUSPECTED_INFECTION", "ANTIBIOTIC_ADMINISTERED",
    }
    names = {c.name for c in SignalCode}
    assert required <= names

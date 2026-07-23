# src/homunculus/canonical.py
"""The canonical internal representation. Every module speaks this; FHIR is translated into it."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import Enum


class SignalCode(Enum):
    """Internal semantic signal codes. NOT LOINC — we do not mint standard identifiers.

    Values are stable string slugs used in scenario files and FHIR mapping tables.
    """
    # Vitals (continuous)
    HEART_RATE = "heart_rate"
    RESP_RATE = "resp_rate"
    SPO2 = "spo2"
    TEMPERATURE = "temperature"
    SBP = "sbp"
    MAP = "map"
    GCS = "gcs"
    ACVPU = "acvpu"          # consciousness ordinal: 0=Alert, 1=Confusion, 2=Voice, 3=Pain, 4=Unresponsive (NEWS2)
    SUPPLEMENTAL_OXYGEN = "supplemental_oxygen"   # 1.0 = receiving oxygen, 0.0 = on air (NEWS2 air-or-oxygen)
    # Labs / gases (intermittent)
    LACTATE = "lactate"
    PLATELETS = "platelets"
    BILIRUBIN = "bilirubin"
    CREATININE = "creatinine"
    URINE_OUTPUT_ML = "urine_output_ml"      # over the prior hour
    PAO2_FIO2 = "pao2_fio2"
    FIO2 = "fio2"
    ON_RESP_SUPPORT = "on_resp_support"      # 1.0 = yes, 0.0 = no
    # Infusions / interventions (from pumps / MAR)
    NOREPINEPHRINE_RATE = "norepinephrine_rate"   # ug/kg/min
    DOPAMINE_RATE = "dopamine_rate"               # ug/kg/min
    EPINEPHRINE_RATE = "epinephrine_rate"         # ug/kg/min
    DOBUTAMINE_RATE = "dobutamine_rate"           # ug/kg/min
    CRYSTALLOID_BOLUS_ML = "crystalloid_bolus_ml" # mL given in this event
    WEIGHT_KG = "weight_kg"
    # Clinical context (not computable from telemetry — provided by the clinician/record)
    SUSPECTED_INFECTION = "suspected_infection"   # 1.0 = infection suspected
    ANTIBIOTIC_ADMINISTERED = "antibiotic_administered"  # 1.0 = a dose was given


@dataclass(frozen=True)
class Observation:
    """A single measurement or event, normalized. Immutable."""
    patient_id: str
    code: SignalCode
    value: float
    unit: str
    timestamp: datetime
    source_device: str

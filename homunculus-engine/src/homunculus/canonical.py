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
    # Chemistry / haematology. No rule scores these today; they are carried because the severity
    # scores the wards already fill in by hand (APACHE II and its siblings) read exactly these,
    # and a value the engine cannot carry is a field a clinician must go and look up by hand.
    ARTERIAL_PH = "arterial_ph"
    BICARBONATE = "bicarbonate"              # HCO3, mmol/L
    SODIUM = "sodium"                        # mmol/L
    POTASSIUM = "potassium"                  # mmol/L
    HAEMATOCRIT = "haematocrit"              # %
    WHITE_CELL_COUNT = "white_cell_count"    # x10^3/mm3
    # Infusions / interventions (from pumps / MAR)
    NOREPINEPHRINE_RATE = "norepinephrine_rate"   # ug/kg/min
    DOPAMINE_RATE = "dopamine_rate"               # ug/kg/min
    EPINEPHRINE_RATE = "epinephrine_rate"         # ug/kg/min
    DOBUTAMINE_RATE = "dobutamine_rate"           # ug/kg/min
    CRYSTALLOID_BOLUS_ML = "crystalloid_bolus_ml" # mL given in this event
    # G3-03 Sıvı dengesi: the nurse's fluid ledger, mL per entry (spec D2). No rule reads them.
    IV_FLUID_ML = "iv_fluid_ml"                   # IV fluid / infusion volume since the last entry
    ENTERAL_ML = "enteral_ml"                     # enteral or oral intake
    BLOOD_PRODUCT_ML = "blood_product_ml"         # blood product given
    OTHER_INTAKE_ML = "other_intake_ml"
    DRAIN_OUTPUT_ML = "drain_output_ml"
    OTHER_OUTPUT_ML = "other_output_ml"           # NG, vomit, stool estimate
    WEIGHT_KG = "weight_kg"
    # Clinical context (not computable from telemetry — provided by the clinician/record)
    SUSPECTED_INFECTION = "suspected_infection"   # 1.0 = infection suspected
    ANTIBIOTIC_ADMINISTERED = "antibiotic_administered"  # 1.0 = a dose was given
    # G4-05 «Enfeksiyon kontrol» (spec D3, D7): the patient's isolation precautions as a clinician charts them, four
    # flags — 1.0 = the precaution is in place, 0.0 = it is not. No rule reads them; no device may send them.
    ISOLATION_CONTACT = "isolation_contact"
    ISOLATION_DROPLET = "isolation_droplet"
    ISOLATION_AIRBORNE = "isolation_airborne"
    ISOLATION_PROTECTIVE = "isolation_protective"


#: G4-05 (spec D3, D7, §5 M8, A7): the four isolation flags in the one order the board's `isolation` block, GET /infection
#: and the dashboard follow — contact, droplet, airborne, protective. A flag's name on the card is its slug after
#: `isolation_`. A clinician's record only: no device table carries them (gateway/hl7.py's default leaves them out; a
#: site's table naming one stops the bridge at startup — scripts/run_bridge.py, edge/ncefiles.py, medibus), `/ingest`
#: answers one from a device 200 and applies nothing, and the chart door refuses one from the device token
#: (api/clinical.py ISOLATION_FROM_DEVICE). Defined here, not in api/, because the bridge runs on the standard library
#: alone (tests/test_bridge_import_chain.py); api/clinical.py re-exports it.
ISOLATION_CODES: tuple[SignalCode, ...] = (SignalCode.ISOLATION_CONTACT, SignalCode.ISOLATION_DROPLET,
                                           SignalCode.ISOLATION_AIRBORNE, SignalCode.ISOLATION_PROTECTIVE)


@dataclass(frozen=True)
class Observation:
    """A single measurement or event, normalized. Immutable."""
    patient_id: str
    code: SignalCode
    value: float
    unit: str
    timestamp: datetime
    source_device: str

# homunculus-engine/src/homunculus/tres/mapping/vitals.py
"""Observation · `az-observation`, vital signs (TRƏS-01, spec §5, D5, D10, D12).

Per signal of the stay, its FIRST and its LAST hand-charted value (stay.first_and_last) — one value
only → only `first` — then the admission's weight and height, each once, at the admission. Monitor
samples are never sent (D10). Every code, display and unit is codes.py's, checked (D12); the
systolic pressure goes alone under its own code, not as a panel: the diastolic is not charted.

`status` `final`; `category` vital-signs; `code` the LOINC coding and, as its text, the LOINC
display (plan F1: no reviewed local label exists); `subject` and `encounter` the platform's ids;
`effectiveDateTime` in the tenant's zone (D22); `valueQuantity` the value, its UCUM code as both
`code` and `unit`."""
from __future__ import annotations

from datetime import datetime

from homunculus.tres import ids
from homunculus.tres.codes import HEIGHT, SIGNALS, UCUM, VITAL_SIGNS, WEIGHT, Signal
from homunculus.tres.mapping.common import Built, base, instant, number, reference
from homunculus.tres.stay import Stay, first_and_last

PROFILE = "az-observation"


def _observation(stay: Stay, signal: Signal, which: str, value: float, at: datetime, *,
                 patient_id: str, encounter_id: str) -> Built:
    local_id = ids.vital(stay.root_id, signal.loinc.code, which)
    resource = base("Observation", PROFILE, local_id)
    resource.update({
        "status": "final",
        "category": [{"coding": [VITAL_SIGNS.coding()]}],
        "code": {"coding": [signal.loinc.coding()], "text": signal.loinc.display},
        "subject": reference("Patient", patient_id),
        "encounter": reference("Encounter", encounter_id),
        "effectiveDateTime": instant(at, stay.zone),
        "valueQuantity": {"value": number(value), "unit": signal.ucum, "system": UCUM, "code": signal.ucum},
    })
    return Built("vital", "Observation", local_id, resource)


def vitals(stay: Stay, *, patient_id: str, encounter_id: str) -> list[Built]:
    """The stay's vital-sign Observations in the order they are sent. None without a zone (the
    Encounter, which needs one too, was skipped before these)."""
    if stay.zone is None:
        return []
    out: list[Built] = []
    chosen = first_and_last(stay.readings)
    for slug, signal in SIGNALS.items():
        if slug not in chosen:
            continue
        first, last = chosen[slug]
        out.append(_observation(stay, signal, ids.FIRST, first.value, first.at,
                                patient_id=patient_id, encounter_id=encounter_id))
        if last is not None:
            out.append(_observation(stay, signal, ids.LAST, last.value, last.at,
                                    patient_id=patient_id, encounter_id=encounter_id))
    for signal, value in ((WEIGHT, stay.weight_kg), (HEIGHT, stay.height_cm)):
        if value is not None and value > 0:
            out.append(_observation(stay, signal, ids.FIRST, value, stay.admitted_at,
                                    patient_id=patient_id, encounter_id=encounter_id))
    return out

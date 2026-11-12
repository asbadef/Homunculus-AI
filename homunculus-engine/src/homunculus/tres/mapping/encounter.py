# homunculus-engine/src/homunculus/tres/mapping/encounter.py
"""Encounter · `az-encounter` (TRƏS-01, spec §5, D5, D8, D17, D22).

One stay, keyed by its chain's ROOT admission (ids.encounter): one Encounter across beds.

* `status` `finished` once the chain's last admission is DISCHARGED, else `in-progress` (a stay
  sent by hand while admitted, D9); a finished stay with no discharge time is skipped
  `discharge_missing` — never a `finished` Encounter with no `period.end`;
* `class` v3-ActCode `IMP` (codes.INPATIENT, checked); `type` `az:CodeSystem/encounter-type` `1`,
  without a display — none is in any source in hand (plan F1, O23);
* `subject` the Patient's platform id; `period` from the root's admission to the last's
  discharge, in the tenant's zone (D22);
* `serviceType` the tab's `hospital-departments` mapping of the LAST admission's unit (D17) — none
  → `unit_unmapped`, never a silent «999 Digər»;
* `serviceProvider` `Organization/<organization id>` of the selected environment's account — none
  → `organization_missing`;
* `participant[].individual` each attending the platform holds a Practitioner of (D8: one that
  could not be sent is left out). `diagnosis[]` comes with F2."""
from __future__ import annotations

from homunculus.tres import ids
from homunculus.tres.codes import INPATIENT
from homunculus.tres.mapping.common import (
    CODE_SYSTEM, DISCHARGE_MISSING, TIMEZONE_UNKNOWN, Built, Skip, base, instant, reference,
)
from homunculus.tres.stay import Stay

PROFILE = "az-encounter"
ENCOUNTER_TYPE = CODE_SYSTEM + "encounter-type"
INPATIENT_STAY = "1"
DEPARTMENTS = CODE_SYSTEM + "hospital-departments"
UNIT_UNMAPPED = "unit_unmapped"
ORGANIZATION_MISSING = "organization_missing"


def encounter(stay: Stay, *, patient_id: str, practitioner_ids: list[str],
              organization_id: str | None) -> Built | Skip:
    local_id = ids.encounter(stay.root_id)
    if stay.zone is None:
        return Skip("encounter", local_id, TIMEZONE_UNKNOWN)
    if stay.finished and stay.discharged_at is None:
        return Skip("encounter", local_id, DISCHARGE_MISSING)
    if stay.department is None:
        return Skip("encounter", local_id, UNIT_UNMAPPED)
    organization = (organization_id or "").strip()
    if not organization:
        return Skip("encounter", local_id, ORGANIZATION_MISSING)
    period = {"start": instant(stay.admitted_at, stay.zone)}
    if stay.finished:
        period["end"] = instant(stay.discharged_at, stay.zone)
    resource = base("Encounter", PROFILE, local_id)
    resource.update({
        "status": "finished" if stay.finished else "in-progress",
        "class": INPATIENT.coding(),
        "type": [{"coding": [{"system": ENCOUNTER_TYPE, "code": INPATIENT_STAY}]}],
        "subject": reference("Patient", patient_id),
        "period": period,
        "serviceType": {"coding": [{"system": DEPARTMENTS, "code": stay.department.code,
                                    "display": stay.department.display}]},
        "serviceProvider": reference("Organization", organization),
    })
    if practitioner_ids:
        resource["participant"] = [{"individual": reference("Practitioner", remote)}
                                   for remote in practitioner_ids]
    return Built("encounter", "Encounter", local_id, resource)

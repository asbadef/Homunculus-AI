# homunculus-engine/src/homunculus/tres/mapping/practitioner.py
"""Practitioner · `az-practitioner` (TRƏS-01, spec §5, D5, D16).

An attending of the stay, from the identity the tab holds for them (`tres_practitioner_identity`:
FİN, family name, given name). No row → `identity_missing`; no FİN or a malformed one →
`fin_missing` / `fin_format` (the patient's rule, az.normal_fin); a name part empty →
`name_missing`. `active` is true: the profile fixes it (spec §5)."""
from __future__ import annotations

from homunculus.tres import az, ids
from homunculus.tres.mapping.common import Built, Skip, base
from homunculus.tres.mapping.patient import fin_identifier
from homunculus.tres.stay import Clinician

PROFILE = "az-practitioner"
IDENTITY_MISSING = "identity_missing"
NAME_MISSING = "name_missing"


def practitioner(clinician: Clinician) -> Built | Skip:
    local_id = ids.practitioner(clinician.user_id)
    if not clinician.known:
        return Skip("practitioner", local_id, IDENTITY_MISSING)
    fin, reason = az.normal_fin(clinician.fin)
    if fin is None:
        return Skip("practitioner", local_id, reason)
    family, given = (clinician.family_name or "").strip(), (clinician.given_name or "").strip()
    if not family or not given:
        return Skip("practitioner", local_id, NAME_MISSING)
    resource = base("Practitioner", PROFILE, local_id)
    resource.update({"identifier": [fin_identifier(fin)], "active": True,
                     "name": [{"family": family, "given": given.split()}]})
    return Built("practitioner", "Practitioner", local_id, resource)

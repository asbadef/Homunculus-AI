# homunculus-engine/src/homunculus/tres/mapping/patient.py
"""Patient · `az-patient` (TRƏS-01, spec §5, D5, D20).

The person, keyed by their FİN (ids.patient): one national Patient however many stays. Required
by the profile — FİN, family and given name, father's name, sex — or the stay's Patient is
skipped with the reason (D20), under the person's own id once a FİN can key it, else under the
stay's placeholder (ids.patient_placeholder).

NOT SENT in phase F1 (plan F1, amendments): the blood group — the codes of
`az:CodeSystem/blood-group` are in no source in hand (O23); the identifier type's display —
`identity-document-type` `15` goes without one, which no source in hand gives (O23); address,
marital status and citizenship are not recorded (O10)."""
from __future__ import annotations

import uuid

from homunculus.tres import az, ids
from homunculus.tres.mapping.common import AZ, CODE_SYSTEM, STRUCTURE, Built, Skip, base
from homunculus.tres.stay import Person

PROFILE = "az-patient"
FIN_SYSTEM = AZ + "sid/fin"
IDENTITY_DOCUMENT_TYPE = CODE_SYSTEM + "identity-document-type"
FIN_DOCUMENT = "15"
SEX = STRUCTURE + "sex"
FATHERS_NAME = STRUCTURE + "fathersName"


def fin_identifier(fin: str) -> dict:
    """The FİN as the platform identifies a person (Patient and Practitioner alike, spec §5)."""
    return {"type": {"coding": [{"system": IDENTITY_DOCUMENT_TYPE, "code": FIN_DOCUMENT}]},
            "system": FIN_SYSTEM, "value": fin}


def patient(person: Person, root_id: uuid.UUID) -> Built | Skip:
    fin, reason = az.normal_fin(person.fin)
    if fin is None:
        return Skip("patient", ids.patient_placeholder(root_id), reason)
    local_id = ids.patient(fin)
    name, reason = az.split_name(person.display_name)
    if name is None:
        return Skip("patient", local_id, reason)
    father = (person.father_name or "").strip()
    if not father:
        return Skip("patient", local_id, az.FATHER_NAME_MISSING)
    sex, reason = az.sex_code(person.sex)
    if sex is None:
        return Skip("patient", local_id, reason)
    born, reason = az.birth_date(person.date_of_birth)
    if born is None:
        return Skip("patient", local_id, reason)
    family, given = name
    resource = base("Patient", PROFILE, local_id)
    resource["extension"] += [{"url": SEX, "valueCode": sex}, {"url": FATHERS_NAME, "valueString": father}]
    resource.update({"identifier": [fin_identifier(fin)], "active": True,
                     "name": [{"family": family, "given": given}], "birthDate": born})
    phone = az.phone(person.phone)
    if phone is not None:
        resource["telecom"] = [{"system": "phone", "value": phone}]
    return Built("patient", "Patient", local_id, resource)

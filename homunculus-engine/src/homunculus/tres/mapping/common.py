# homunculus-engine/src/homunculus/tres/mapping/common.py
"""What every resource of the feed carries (TRƏS-01, spec §4.4, §5, D22), and what a mapper answers.

* `meta.profile` — the platform's profile, `http://fhir.az/StructureDefinition/<name>`;
* the local-id extension (`client.LOCAL_ID_EXTENSION`, `valueString`), the platform's only search key;
* a reference is `Type/<the platform's id>` — never a local id, never a URL;
* a time is ISO 8601 in the TENANT's zone with its offset (`+04:00` for Asia/Baku), to the second,
  never UTC `Z` (D22); a mapper that needs a time and has no zone is skipped (`timezone_unknown`).

Systems under `http://fhir.az/` are the platform's own, as spec §5 names them (second-hand, §2)."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, tzinfo

from homunculus.tres.client import LOCAL_ID_EXTENSION

AZ = "http://fhir.az/"
STRUCTURE = AZ + "StructureDefinition/"
CODE_SYSTEM = AZ + "CodeSystem/"
TIMEZONE_UNKNOWN = "timezone_unknown"


@dataclass(frozen=True)
class Built:
    """A resource ready for the ledger: its ledger key (`resource_type`), its FHIR type, its local id."""
    resource_type: str
    fhir_type: str
    local_id: str
    resource: dict


@dataclass(frozen=True)
class Skip:
    """Why a resource was not built: a catalogue code (never text), under the local id its row keeps."""
    resource_type: str
    local_id: str
    reason: str


def base(fhir_type: str, profile: str, local_id: str) -> dict:
    return {"resourceType": fhir_type, "meta": {"profile": [STRUCTURE + profile]},
            "extension": [{"url": LOCAL_ID_EXTENSION, "valueString": local_id}]}


def reference(fhir_type: str, remote_id: str) -> dict:
    return {"reference": f"{fhir_type}/{remote_id}"}


def instant(at: datetime, zone: tzinfo) -> str:
    """`at` in the tenant's zone with its offset, to the second (D22)."""
    return at.astimezone(zone).isoformat(timespec="seconds")


def number(value: float) -> int | float:
    """A whole value as a JSON integer (72, not 72.0) — one payload, one digest (D7)."""
    return int(value) if float(value).is_integer() else float(value)

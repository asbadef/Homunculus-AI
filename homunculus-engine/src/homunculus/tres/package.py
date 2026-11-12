# homunculus-engine/src/homunculus/tres/package.py
"""One stay's package (TRƏS-01, spec D8; phase F1's share): its resources to the platform, in an
order where everything a resource refers to is there before it.

    Patient → Practitioner(s) → Encounter → vital-sign Observations

F2–F5 add their types in D8's places (Conditions and the Encounter's `diagnosis[]` after the
Encounter, then Procedures, the Composition, the laboratory results — before the vitals).

* A skipped Patient or Encounter stops the package there (D8), and so does one the platform does
  not hold after its delivery (failed, `stuck`, its type switched off before it was ever sent): a
  reference is the platform's id (`remote_id`), never a local id.
* A Practitioner that cannot be sent is left out of the Encounter's `participant` (D8).
* A Patient built under its own id removes the skip its stay's placeholder may still hold
  (ids.patient_placeholder): the person now has a record, the old reason no longer applies.

VALIDATE MODE AND REFERENCES (spec O14, decided by plan F1). `$validate` stores nothing, so a
round in `validate` has no platform id for what a resource refers to unless an earlier `send` in
the same environment left one in the ledger. Such a resource is NOT sent for validation with a
reference to nothing: it is recorded `skipped` with the reason `no_reference` — the Encounter when
the Patient has no platform id, every vital sign when the Encounter has none — so every resource
of the stay has a row that says what happened. A tenant that has never sent therefore validates
its Patients and Practitioners, the profiles with the most rules. F6 checks on the sandbox what
`$validate` does with a reference to an unknown id, and may relax this.

`run` answers what it did (`Outcome`): each row it touched, and whether this run gave the stay its
Encounter on the platform for the first time (`first_complete`, send mode only) — the moment the
caller writes the stay's one `tres.package` audit row (D24).

`PreviewSender` stands in for the worker's `Sender` and asks nothing of anyone: the preview route
(D25) runs the same package through it and shows what would be sent."""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from homunculus.tres import ids
from homunculus.tres.ledger import held as ledger_held
from homunculus.tres.mapping.common import Built, Skip
from homunculus.tres.mapping.encounter import encounter as map_encounter
from homunculus.tres.mapping.patient import patient as map_patient
from homunculus.tres.mapping.practitioner import practitioner as map_practitioner
from homunculus.tres.mapping.vitals import vitals as map_vitals
from homunculus.tres.stay import Stay

NO_REFERENCE = "no_reference"


@dataclass
class Outcome:
    """What one run of a package did: (resource type, local id, status, reason) per row touched."""
    rows: list[tuple[str, str, str, str | None]] = field(default_factory=list)
    first_complete: bool = False

    def add(self, resource_type: str, local_id: str, status: str, reason: str | None) -> None:
        self.rows.append((resource_type, local_id, status, reason))

    def counts(self) -> dict[str, dict[str, int]]:
        """{resource type: {status: how many}} — what an audit row may carry (no id, no value)."""
        out: dict[str, dict[str, int]] = {}
        for resource_type, _local_id, status, _reason in self.rows:
            by_status = out.setdefault(resource_type, {})
            by_status[status] = by_status.get(status, 0) + 1
        return out


async def run(stay: Stay, sender, *, organization_id: str | None, force: bool = False) -> Outcome:
    """The stay's resources through `sender` (worker.Sender or PreviewSender), in D8's order.
    `force` is handed to every send: the nightly retry and «Yeniden dene» (D21) — a `stuck` or
    waiting row is tried now, a `sent` one with the same payload still asks nothing (ledger.py)."""
    outcome = Outcome()
    validating = sender.mode == "validate"

    async def send(built: Built):
        row = await sender.send(resource_type=built.resource_type, fhir_type=built.fhir_type,
                                local_id=built.local_id, resource=built.resource,
                                admission_id=stay.last_id, force=force)
        outcome.add(built.resource_type, built.local_id, row.status, row.reason)
        return row

    async def skip(resource_type: str, local_id: str, reason: str) -> None:
        row = await sender.skip(resource_type=resource_type, local_id=local_id, reason=reason,
                                admission_id=stay.last_id)
        outcome.add(resource_type, local_id, row.status, row.reason)

    async def unreferenced(*local_ids: tuple[str, str]) -> None:
        if validating:
            for resource_type, local_id in local_ids:
                await skip(resource_type, local_id, NO_REFERENCE)

    def vital_ids() -> list[tuple[str, str]]:
        # The vitals' local ids depend on the stay alone; the references are never sent from here.
        return [("vital", built.local_id) for built in map_vitals(stay, patient_id="-", encounter_id="-")]

    built = map_patient(stay.person, stay.root_id)
    if isinstance(built, Skip):
        await skip(built.resource_type, built.local_id, built.reason)
        return outcome
    await sender.forget_skip(resource_type="patient", local_id=ids.patient_placeholder(stay.root_id))
    patient_id = (await send(built)).remote_id

    practitioner_ids: list[str] = []
    for clinician in stay.clinicians:
        built = map_practitioner(clinician)
        if isinstance(built, Skip):
            await skip(built.resource_type, built.local_id, built.reason)
            continue
        remote = (await send(built)).remote_id
        if remote:
            practitioner_ids.append(remote)

    if not patient_id:
        await unreferenced(("encounter", ids.encounter(stay.root_id)), *vital_ids())
        return outcome
    built = map_encounter(stay, patient_id=patient_id, practitioner_ids=practitioner_ids,
                          organization_id=organization_id)
    if isinstance(built, Skip):
        await skip(built.resource_type, built.local_id, built.reason)
        return outcome
    before = await sender.held(resource_type="encounter", local_id=built.local_id)
    encounter_id = (await send(built)).remote_id
    if not encounter_id:
        await unreferenced(*vital_ids())
        return outcome

    for built in map_vitals(stay, patient_id=patient_id, encounter_id=encounter_id):
        await send(built)
    outcome.first_complete = sender.mode == "send" and before is None
    return outcome


@dataclass(frozen=True)
class PreviewRow:
    """What `PreviewSender` answers in place of a ledger row."""
    status: str
    remote_id: str | None
    reason: str | None


class PreviewSender:
    """A `Sender` that sends nothing and writes nothing (the preview, D25). It reads the ledger for
    the platform's ids; a resource the platform holds none of is referred to by its local id, and
    its item says `held: false` — the preview shows what would be sent, references as they would be
    once the resources before it are there."""

    mode = "send"

    def __init__(self, db, *, tenant_id: uuid.UUID, environment: str) -> None:
        self._db, self.tenant_id, self.environment = db, tenant_id, environment
        self.items: list[dict] = []

    async def held(self, *, resource_type: str, local_id: str) -> str | None:
        return await ledger_held(self._db, tenant_id=self.tenant_id, environment=self.environment,
                                 resource_type=resource_type, local_id=local_id)

    async def send(self, *, resource_type: str, fhir_type: str, local_id: str, resource: dict,
                   admission_id: uuid.UUID | None = None, force: bool = False) -> PreviewRow:
        remote = await self.held(resource_type=resource_type, local_id=local_id)
        self.items.append({"resource_type": resource_type, "local_id": local_id, "held": remote is not None,
                           "resource": resource, "reason": None})
        return PreviewRow("preview", remote or local_id, None)

    async def skip(self, *, resource_type: str, local_id: str, reason: str,
                   admission_id: uuid.UUID | None = None) -> PreviewRow:
        self.items.append({"resource_type": resource_type, "local_id": local_id, "held": False,
                           "resource": None, "reason": reason})
        return PreviewRow("skipped", None, reason)

    async def forget_skip(self, *, resource_type: str, local_id: str) -> None:
        return None

# homunculus-engine/src/homunculus/tres/package.py
"""One stay's package (TRƏS-01, spec D8; phase F1's share): its resources to the platform, in an
order where everything a resource refers to is there before it.

    Patient → Practitioner(s) → Encounter → vital-sign Observations

F2–F5 add their types in D8's places (Conditions and the Encounter's `diagnosis[]` after the
Encounter, then Procedures, the Composition, the laboratory results — before the vitals).

* A skipped Patient or Encounter stops the package there (D8), and so does one the platform does
  not hold after its delivery (failed, `stuck`, its type switched off before it was ever sent): a
  reference is the platform's id (`remote_id`), never a local id. In `send`, a package that stops at
  the Patient writes the stay's own Encounter row, `skipped` with PATIENT_UNHELD (batch-4 review): so
  every stay that reached the Encounter point has a row of its own, and the nightly retry
  (source.retry_stays: an Encounter not `sent`) sends it once its person can be sent. It is written
  with `keep_held` (re-review of 2026-11-13): an Encounter the platform already holds — a stay sent
  whole, its person's FİN removed since — keeps its row as it is (`sent`, its id), and the night
  does not take the stay for it. So do the Encounter's OWN skips (`unit_unmapped`,
  `organization_missing`, `timezone_unknown`, `discharge_missing`; final review, 2026-11-13): a
  unit's mapping cleared after its stay was sent leaves the held Encounter `sent`; one the platform
  does not hold gets `skipped` with the reason, as before.
* A Practitioner that cannot be sent is left out of the Encounter's `participant` (D8).
* Once a FİN keys the person — the Patient's local id is not the stay's placeholder
  (ids.patient_placeholder) — the placeholder's skip is removed, whether the Patient is then sent
  or skipped for another reason (`name_single`, `father_name_missing`…; amendment 25, A4): the old
  reason no longer stands for this stay.
* THE PERSON'S NEWEST STAY IS THEIR PATIENT'S AUTHORITY (amendment 25, A1). The Patient's row is
  keyed by the FİN and shared by every stay of the person, each built from its own patient row; the
  ledger (`shared`) leaves it to the newest stay that has run AND that the platform holds the
  person for (the row's `remote_id`; batch-4 review). An older stay then sends, validates and
  records nothing for it, and refers to the platform's id on that row — even when its own patient
  row would have been skipped: the newer stay's record stands for the person. A newer stay the
  platform holds nothing for does not hold an older one's send back: the older sends its own
  version. An older stay's SKIP is left to any newer stay, held or not (re-review; ledger.yields):
  with no platform id on that row there is no Patient to refer to, and the stay stops there as for
  its own skip (`patient_unheld` on its Encounter, in `send`).

VALIDATE MODE AND REFERENCES (spec O14, decided by plan F1). `$validate` stores nothing, so a
round in `validate` has no platform id for what a resource refers to unless an earlier `send` in
the same environment left one in the ledger. Such a resource is NOT sent for validation with a
reference to nothing: it is recorded `skipped` with the reason `no_reference` — the Encounter when
the Patient has no platform id, every vital sign when the Encounter has none. The Encounter's
`no_reference` is written with `keep_held` too (re-review of 2026-11-13): an Encounter the platform
holds from an earlier send keeps its row as it is. What is true of the
rows (A9): every resource the package REACHED has a row that says what happened to it — sent,
validated, failed, or skipped with its reason, `no_reference` included. A Patient or an Encounter
skipped for a reason of its own (`fin_missing`, `unit_unmapped`…) stops the package, and the
resources after it get NO row in that run: nothing was built for them, and the skip before them
says why — except, in `send`, the stay's Encounter after a Patient it could not refer to
(`patient_unheld`, above). (A person's Patient left to their newer stay has its row, that stay's.) A tenant that has
never sent therefore validates its Patients and Practitioners, the profiles with the most rules.
F6 checks on the sandbox what `$validate` does with a reference to an unknown id, and may relax
this.

`run` answers what it did (`Outcome`): each row it touched, and whether this run gave the stay its
Encounter on the platform for the first time (`first_complete`, send mode only) — the moment the
caller writes the stay's one `tres.package` audit row (D24). It is read from the ledger's answer
to the Encounter's own delivery (`row.took_id`, under the row's lock; A5), never from a read made
before it: of a round and a hand on one stay, only the one whose delivery took the id says so; and
a run that ends early (an outage among the vitals) says nothing, as amendment 17 has it.

`PreviewSender` stands in for the worker's `Sender` and asks nothing of anyone: the preview route
(D25) runs the same package through it and shows what would be sent."""
from __future__ import annotations

import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field

from sqlalchemy import select

from homunculus.tres import ids
from homunculus.tres.ledger import held as ledger_held
from homunculus.tres.ledger import yields as ledger_yields
from homunculus.tres.mapping.common import Built, Skip
from homunculus.tres.mapping.encounter import encounter as map_encounter
from homunculus.tres.mapping.patient import patient as map_patient
from homunculus.tres.mapping.practitioner import practitioner as map_practitioner
from homunculus.tres.mapping.vitals import vitals as map_vitals
from homunculus.tres.models import RESOURCE_TYPES, TresDelivery
from homunculus.tres.stay import Stay
from homunculus.tres.worker import TYPE_OFF

NO_REFERENCE = "no_reference"
PATIENT_UNHELD = "patient_unheld"
#: The stay's package raised what nothing else handles (final review): its Encounter row reads `failed`
#: with this reason (source.StaySource.package, ledger.record_failure) — the list shows it, the night retries it.
PACKAGE_ERROR = "package_error"


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

    async def send(built: Built, *, shared: bool = False):
        row = await sender.send(resource_type=built.resource_type, fhir_type=built.fhir_type,
                                local_id=built.local_id, resource=built.resource,
                                admission_id=stay.last_id, force=force, shared=shared)
        outcome.add(built.resource_type, built.local_id, row.status, row.reason)
        return row

    async def skip(resource_type: str, local_id: str, reason: str, *, shared: bool = False,
                   keep_held: bool = False):
        row = await sender.skip(resource_type=resource_type, local_id=local_id, reason=reason,
                                admission_id=stay.last_id, shared=shared, keep_held=keep_held)
        outcome.add(resource_type, local_id, row.status, row.reason)
        return row

    async def unreferenced(*local_ids: tuple[str, str]) -> None:
        if validating:
            for resource_type, local_id in local_ids:
                # The Encounter never over a row the platform holds (`keep_held`, re-review of 2026-11-13: as its
                # own skips and `patient_unheld`) — a stay sent whole, its person's id gone from this run.
                await skip(resource_type, local_id, NO_REFERENCE, keep_held=resource_type == "encounter")

    def vital_ids() -> list[tuple[str, str]]:
        # The vitals' local ids depend on the stay alone; the references are never sent from here.
        return [("vital", built.local_id) for built in map_vitals(stay, patient_id="-", encounter_id="-")]

    async def patient_unheld() -> None:
        # Batch-4 review: in send mode a package that stops at the Patient writes the stay's own
        # Encounter row, so every stay that reached the Encounter point has one — the nightly retry
        # takes it (source.retry_stays) once the person can be sent. Never over an Encounter the
        # platform holds (`keep_held`, re-review): that row keeps its status and its id.
        if not validating:
            await skip("encounter", ids.encounter(stay.root_id), PATIENT_UNHELD, keep_held=True)

    placeholder = ids.patient_placeholder(stay.root_id)
    built = map_patient(stay.person, stay.root_id)
    # Keyed by the FİN (not the stay's placeholder): the row is the person's, shared by their stays.
    personal = built.local_id != placeholder
    if personal:
        await sender.forget_skip(resource_type="patient", local_id=placeholder)          # A4
    if isinstance(built, Skip):
        row = await skip(built.resource_type, built.local_id, built.reason, shared=personal)
        if not (row.yielded and row.remote_id):
            # Its own skip — or a newer stay's row the platform holds nothing for (a skip yields to
            # any newer stay, re-review): no Patient to refer to; the package stops here.
            await patient_unheld()
            return outcome
        # A newer stay the platform holds the person for is their authority (A1): it stands for this stay.
    else:
        row = await send(built, shared=True)
    patient_id = row.remote_id

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
        await patient_unheld()
        return outcome
    built = map_encounter(stay, patient_id=patient_id, practitioner_ids=practitioner_ids,
                          organization_id=organization_id)
    if isinstance(built, Skip):
        # Its own skip (`unit_unmapped`, `organization_missing`, `timezone_unknown`, `discharge_missing`)
        # never relabels an Encounter the platform holds (`keep_held`, final review — as `patient_unheld`).
        await skip(built.resource_type, built.local_id, built.reason, keep_held=True)
        return outcome
    encounter = await send(built)
    encounter_id = encounter.remote_id
    if not encounter_id:
        await unreferenced(*vital_ids())
        return outcome

    for built in map_vitals(stay, patient_id=patient_id, encounter_id=encounter_id):
        await send(built)
    # A5: THIS run's delivery took the Encounter's id (under its row's lock), and the package ran
    # to its end — an outage among the vitals raised before this line (amendment 17).
    outcome.first_complete = sender.mode == "send" and encounter.took_id
    return outcome


@dataclass(frozen=True)
class PreviewRow:
    """What `PreviewSender` answers in place of a ledger row. A preview takes no id (`took_id`);
    `yielded` as a send's row would say it (the person's newer stay holds their Patient)."""
    status: str
    remote_id: str | None
    reason: str | None
    took_id: bool = False
    yielded: bool = False


class PreviewSender:
    """A `Sender` that sends nothing and writes nothing (the preview, D25). It reads the ledger for
    the platform's ids; a resource the platform holds none of is referred to by its local id, and
    its item says `held: false` — the preview shows what would be sent, references as they would be
    once the resources before it are there.

    IT JUDGES AS A SEND DOES (Task-12 review M5):
    * the tenant's types — a type switched off is shown NOT SENT (`resource` None, the reason
      `type_off`); one the platform does not hold then refers to nothing, so a Patient so left stops
      the stay at its Encounter, as a send would (`patient_unheld`); one it holds keeps its id;
    * the person's newest stay (amendment 25, A1, as `ledger.yields` judges it): a Patient the
      person's newer stay holds on the platform is shown as THAT stay's — `yielded`, `held`, no body
      (this stay would send nothing for it) — and the preview goes on to the Encounter and the
      vitals, referring to it, as a send would; a Patient this stay would SKIP is left to any newer
      stay (re-review) — `yielded`, `held` as the platform holds it, and with none held the preview
      stops at the Encounter (`patient_unheld`);
    * `keep_held` (`patient_unheld`): an Encounter the platform holds is shown `held` — a send leaves
      its row as it is."""

    mode = "send"

    def __init__(self, db, *, tenant_id: uuid.UUID, environment: str,
                 enabled_types: Iterable[str] = RESOURCE_TYPES) -> None:
        self._db, self.tenant_id, self.environment = db, tenant_id, environment
        self.enabled_types = frozenset(enabled_types)
        self.items: list[dict] = []

    async def held(self, *, resource_type: str, local_id: str) -> str | None:
        return await ledger_held(self._db, tenant_id=self.tenant_id, environment=self.environment,
                                 resource_type=resource_type, local_id=local_id)

    async def _owner(self, resource_type: str, local_id: str) -> tuple[str | None, uuid.UUID | None]:
        """(the platform's id, the stay that holds the row) — read, never locked."""
        row = (await self._db.execute(select(TresDelivery.remote_id, TresDelivery.admission_id).where(
            TresDelivery.tenant_id == self.tenant_id, TresDelivery.environment == self.environment,
            TresDelivery.resource_type == resource_type, TresDelivery.local_id == local_id))).first()
        return (row.remote_id, row.admission_id) if row is not None else (None, None)

    async def _yielded(self, resource_type: str, local_id: str, admission_id: uuid.UUID | None,
                       shared: bool, *, skip: bool = False) -> PreviewRow | None:
        if not shared:
            return None
        remote, owner = await self._owner(resource_type, local_id)
        if not await ledger_yields(self._db, owner_id=owner, remote_id=remote, admission_id=admission_id,
                                   skip=skip):
            return None
        self.items.append({"resource_type": resource_type, "local_id": local_id, "held": remote is not None,
                           "resource": None, "reason": None, "yielded": True})
        return PreviewRow("preview", remote, None, yielded=True)

    async def send(self, *, resource_type: str, fhir_type: str, local_id: str, resource: dict,
                   admission_id: uuid.UUID | None = None, force: bool = False,
                   shared: bool = False) -> PreviewRow:
        yielded = await self._yielded(resource_type, local_id, admission_id, shared)
        if yielded is not None:
            return yielded
        remote = await self.held(resource_type=resource_type, local_id=local_id)
        if resource_type not in self.enabled_types:
            self.items.append({"resource_type": resource_type, "local_id": local_id, "held": remote is not None,
                               "resource": None, "reason": TYPE_OFF, "yielded": False})
            return PreviewRow("skipped", remote, TYPE_OFF)
        self.items.append({"resource_type": resource_type, "local_id": local_id, "held": remote is not None,
                           "resource": resource, "reason": None, "yielded": False})
        return PreviewRow("preview", remote or local_id, None)

    async def skip(self, *, resource_type: str, local_id: str, reason: str,
                   admission_id: uuid.UUID | None = None, shared: bool = False,
                   keep_held: bool = False) -> PreviewRow:
        yielded = await self._yielded(resource_type, local_id, admission_id, shared, skip=True)
        if yielded is not None:
            return yielded
        # With `keep_held` a send leaves a row the platform holds as it is: the item says it is held.
        held = keep_held and await self.held(resource_type=resource_type, local_id=local_id) is not None
        self.items.append({"resource_type": resource_type, "local_id": local_id, "held": held,
                           "resource": None, "reason": reason, "yielded": False})
        return PreviewRow("skipped", None, reason)

    async def forget_skip(self, *, resource_type: str, local_id: str) -> None:
        return None

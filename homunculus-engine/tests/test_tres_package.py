# homunculus-engine/tests/test_tres_package.py
"""TRƏS-01 (spec D8, O14 decided by plan F1): one stay's package — Patient, its attendings, the
Encounter, the vital signs, in that order, each referring to the platform's ids of what came
before; a skipped or unheld Patient or Encounter stops it; a Practitioner that cannot be sent is
left out of `participant`; in `validate` mode a resource whose reference has no platform id is
recorded `no_reference`, never sent pointing at nothing; the first run that gives a stay its
Encounter says so (`first_complete`, the `tres.package` audit row). The order and the rules run
against a recording sender (no database); the whole package then runs on Postgres through the
real ledger against the stand-in, whose profile rules every resource passes — and a second run
asks nothing. The preview sender writes nothing. Synthetic stay, synthetic people."""
from __future__ import annotations

from dataclasses import dataclass, replace

import pytest
from sqlalchemy import func, select

from homunculus.tenant.models import Tenant
from homunculus.tres import ids
from homunculus.tres.client import TresClient
from homunculus.tres.models import TresDelivery
from homunculus.tres.package import NO_REFERENCE, PreviewSender, run
from homunculus.tres.stay import Clinician
from homunculus.tres.worker import Sender
from tests.conftest import requires_db
from tests.fake_tres import FakeTres
from tests.kabul_world import build_ward
from tests.test_tres_mapping import DOCTOR, PATIENT_ID, PERSON, ROOT, stay
from tests.tres_world import add_stay

ENCOUNTER_ID = f"hmn-e-{ROOT}."
VITALS = [f"hmn-v-{ROOT}-heart-rate-first.", f"hmn-v-{ROOT}-heart-rate-last.", f"hmn-v-{ROOT}-spo2-first.",
          f"hmn-v-{ROOT}-temperature-first.", f"hmn-v-{ROOT}-weight-first.", f"hmn-v-{ROOT}-height-first."]
PRACTITIONER_ID = f"hmn-pr-{DOCTOR}."


@dataclass(frozen=True)
class Row:
    status: str
    remote_id: str | None
    reason: str | None


class Recorder:
    """A sender that remembers what it was asked. Send mode hands out platform ids 7001, 7002…;
    validate mode hands out none (the platform stores nothing). `held` is what the ledger holds
    already; a type in `refuse` fails without an id."""

    def __init__(self, mode: str = "send", held: dict | None = None, refuse=()) -> None:
        self.mode, self.ids, self.refuse = mode, dict(held or {}), set(refuse)
        self.calls: list[tuple] = []
        self._next = 7000

    async def held(self, *, resource_type, local_id):
        return self.ids.get((resource_type, local_id))

    async def send(self, *, resource_type, fhir_type, local_id, resource, admission_id=None, force=False):
        self.calls.append(("send", resource_type, local_id, force))
        self.last = resource
        key = (resource_type, local_id)
        if resource_type in self.refuse:
            return Row("failed", self.ids.get(key), None)
        if self.mode == "validate":
            return Row("validated", self.ids.get(key), None)
        if key not in self.ids:
            self._next += 1
            self.ids[key] = str(self._next)
        return Row("sent", self.ids[key], None)

    async def skip(self, *, resource_type, local_id, reason, admission_id=None):
        self.calls.append(("skip", resource_type, local_id, reason))
        return Row("skipped", None, reason)

    async def forget_skip(self, *, resource_type, local_id):
        self.calls.append(("forget", resource_type, local_id))


# ---------------------------------------------------------------- the order and the rules (no database)
async def test_a_whole_package_goes_in_order_each_referring_to_the_platforms_ids():
    sender = Recorder()
    outcome = await run(stay(), sender, organization_id="ORG-0001")
    assert sender.calls == [("forget", "patient", ids.patient_placeholder(ROOT)),
                            ("send", "patient", PATIENT_ID, False), ("send", "practitioner", PRACTITIONER_ID, False),
                            ("send", "encounter", ENCOUNTER_ID, False),
                            *(("send", "vital", local_id, False) for local_id in VITALS)]
    assert sender.ids[("encounter", ENCOUNTER_ID)] == "7003"
    assert sender.last["subject"] == {"reference": "Patient/7001"}
    assert sender.last["encounter"] == {"reference": "Encounter/7003"}
    assert outcome.first_complete is True
    assert outcome.counts() == {"patient": {"sent": 1}, "practitioner": {"sent": 1}, "encounter": {"sent": 1},
                                "vital": {"sent": 6}}
    again = await run(stay(), sender, organization_id="ORG-0001", force=True)
    assert again.first_complete is False                                   # the Encounter was there already
    assert {call[3] for call in sender.calls if call[0] == "send"} == {False, True}


async def test_a_skipped_patient_stops_the_package_under_its_placeholder():
    sender = Recorder()
    outcome = await run(stay(person=replace(PERSON, fin=None)), sender, organization_id="ORG-0001")
    assert sender.calls == [("skip", "patient", ids.patient_placeholder(ROOT), "fin_missing")]
    assert outcome.rows == [("patient", ids.patient_placeholder(ROOT), "skipped", "fin_missing")]
    assert outcome.first_complete is False


async def test_a_patient_the_platform_does_not_hold_stops_the_package_before_the_encounter():
    sender = Recorder(refuse={"patient"})
    await run(stay(), sender, organization_id="ORG-0001")
    assert [call[1] for call in sender.calls if call[0] == "send"] == ["patient", "practitioner"]
    assert not any(call[0] == "skip" for call in sender.calls)             # send mode: the Patient's row says why


async def test_a_practitioner_that_cannot_be_sent_is_left_out_of_participant():
    sender = Recorder()
    await run(stay(clinicians=(Clinician(DOCTOR),)), sender, organization_id="ORG-0001")
    assert ("skip", "practitioner", PRACTITIONER_ID, "identity_missing") in sender.calls
    encounter = [c for c in sender.calls if c[1] == "encounter"]
    assert encounter == [("send", "encounter", ENCOUNTER_ID, False)]
    refused = Recorder(refuse={"practitioner"})
    await run(stay(), refused, organization_id="ORG-0001")
    assert ("send", "vital", VITALS[0], False) in refused.calls          # the stay went on without them


async def test_a_skipped_encounter_stops_the_package_before_the_vitals():
    sender = Recorder()
    outcome = await run(stay(department=None), sender, organization_id="ORG-0001")
    assert sender.calls[-1] == ("skip", "encounter", ENCOUNTER_ID, "unit_unmapped")
    assert not any(call[1] == "vital" for call in sender.calls) and outcome.first_complete is False


async def test_validate_with_nothing_sent_before_checks_the_people_and_records_no_reference_for_the_rest():
    """O14: nothing the Encounter could point at exists on the platform."""
    sender = Recorder(mode="validate")
    outcome = await run(stay(), sender, organization_id="ORG-0001")
    assert [c for c in sender.calls if c[0] == "send"] == [("send", "patient", PATIENT_ID, False),
                                                          ("send", "practitioner", PRACTITIONER_ID, False)]
    assert [c for c in sender.calls if c[0] == "skip"] == [
        ("skip", "encounter", ENCOUNTER_ID, NO_REFERENCE), *(("skip", "vital", v, NO_REFERENCE) for v in VITALS)]
    assert outcome.first_complete is False


async def test_validate_after_a_send_checks_the_encounter_against_the_ids_the_ledger_holds():
    sender = Recorder(mode="validate", held={("patient", PATIENT_ID): "7001"})
    await run(stay(), sender, organization_id="ORG-0001")
    assert ("send", "encounter", ENCOUNTER_ID, False) in sender.calls
    assert sender.last["subject"] == {"reference": "Patient/7001"} and "participant" not in sender.last
    assert [c[1:] for c in sender.calls if c[0] == "skip"] == [("vital", v, NO_REFERENCE) for v in VITALS]


# ---------------------------------------------------------------- through the ledger, against the stand-in (Postgres)
@requires_db
async def test_the_package_lands_on_the_stand_in_and_a_second_run_asks_nothing(db_session):
    ward = await build_ward(db_session)
    admission = await add_stay(db_session, ward)
    the_stay = stay(root_id=admission.id, last_id=admission.id)
    fake = FakeTres()
    fake.seed("Organization", "ORG-0001")
    client = TresClient(fake.account, transport=fake.transport)
    sender = Sender(db_session, client, tenant_id=ward.tenant.id, environment="test", mode="send",
                    now=the_stay.discharged_at, enabled_types=("patient", "practitioner", "encounter", "vital"))
    outcome = await run(the_stay, sender, organization_id="ORG-0001")
    assert outcome.first_complete and outcome.counts() == {
        "patient": {"sent": 1}, "practitioner": {"sent": 1}, "encounter": {"sent": 1}, "vital": {"sent": 6}}
    (encounter,) = fake.stored("Encounter")
    assert encounter["subject"]["reference"] == f"Patient/{fake.stored('Patient')[0]['id']}"
    assert encounter["participant"][0]["individual"]["reference"] == f"Practitioner/{fake.stored('Practitioner')[0]['id']}"
    assert len(fake.stored("Observation")) == 6
    asked = list(fake.requests)
    again = await run(the_stay, sender, organization_id="ORG-0001")
    assert fake.requests == asked and again.first_complete is False         # D7: nothing changed, nothing asked
    rows = (await db_session.execute(select(TresDelivery.admission_id).distinct())).scalars().all()
    assert rows == [admission.id]                                           # every row: the stay's last admission
    await client.aclose()


@requires_db
async def test_the_preview_sender_builds_everything_and_writes_nothing(db_session):
    tenant = Tenant(name="Sentetik TRƏS Hastanesi", slug="tres-hastane", country_code="AZ")
    db_session.add(tenant)
    await db_session.commit()
    preview = PreviewSender(db_session, tenant_id=tenant.id, environment="test")
    await run(stay(), preview, organization_id="ORG-0001")
    assert [(i["resource_type"], i["local_id"], i["held"]) for i in preview.items] == [
        ("patient", PATIENT_ID, False), ("practitioner", PRACTITIONER_ID, False), ("encounter", ENCOUNTER_ID, False),
        *(("vital", v, False) for v in VITALS)]
    encounter = preview.items[2]["resource"]
    assert encounter["subject"] == {"reference": f"Patient/{PATIENT_ID}"}          # not yet held: its local id
    assert (await db_session.execute(select(func.count()).select_from(TresDelivery))).scalar_one() == 0

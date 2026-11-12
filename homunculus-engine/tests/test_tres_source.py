# homunculus-engine/tests/test_tres_source.py
"""TRƏS-01 (spec D8, D9, D10, D21, D24; plan F1, N1–N3, O15, O21): the stays a round sends, read whole.

* which stays are due: discharged, past the tenant's wait, within the week after it (REACH), not
  before the tenant's `send_from` (O15, proposed); never an open one, never another tenant's;
* a stay read whole: the person from the root's patient row with the FİN decrypted, the chain from
  root to last, the last row's department, the attendings and their identities, the bedside values
  of ONE trail read under the last row's board key (a transfer moves the protocol number), the
  withdrawn ones left out;
* a round with the app's source puts the stay on the stand-in — every time in +04:00 — and writes
  the one `tres.package` audit row; the next round asks nothing and writes none;
* the nightly retry: at the first round after 04:00 in the tenant's zone, a `stuck` row's stay is
  rebuilt and forced, however old; once a night.

No database for the zone and the night; the rest runs on Postgres against the stand-in, the trail
in memory. Synthetic ward (tests/kabul_world.py), synthetic stays (tests/tres_world.py)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from homunculus.admission.models import AdmissionState
from homunculus.api.audit import AuditEvent, InMemoryAuditLog
from homunculus.tres import ids, source
from homunculus.tres.client import TresClient
from homunculus.tres.ledger import payload_digest
from homunculus.tres.mapping.patient import patient as map_patient
from homunculus.tres.models import TresDelivery, TresSettings
from homunculus.tres.source import REACH, StaySource, due_stays, nightly_due, zone_of
from homunculus.tres.worker import run_round
from tests.conftest import requires_db
from tests.fake_tres import FakeTres
from tests.kabul_world import SLUG, build_ward
from tests.tres_world import (
    ADMITTED, BAKU, DISCHARGED, NOW, ORGANIZATION, add_stay, chart, feed_settings, identify, map_unit,
)


# ---------------------------------------------------------------- the zone and the night (no database)
def test_the_zone_is_the_tenants_and_an_unknown_one_is_none_never_utc():
    assert zone_of("UTC") is timezone.utc and zone_of("") is timezone.utc and zone_of(None) is timezone.utc
    assert zone_of("Mars/Olympus_Mons") is None


def test_the_nightly_retry_is_due_once_after_four_in_the_tenants_zone():
    before_four = datetime(2026, 11, 7, 23, 30, tzinfo=timezone.utc)        # 03:30 in Baku
    after_four = datetime(2026, 11, 8, 0, 30, tzinfo=timezone.utc)          # 04:30 in Baku
    assert nightly_due(None, before_four, BAKU)                             # never ran: due now
    assert not nightly_due(before_four - timedelta(hours=2), before_four, BAKU)   # ran after yesterday's 04:00
    assert nightly_due(before_four, after_four, BAKU)                       # 04:00 has come since
    assert not nightly_due(after_four, after_four + timedelta(hours=5), BAKU)


# ---------------------------------------------------------------- Postgres
async def _world(db_session):
    ward = await build_ward(db_session)
    fake = FakeTres()
    fake.seed("Organization", ORGANIZATION)
    return ward, fake


def _source(audit, now=NOW) -> StaySource:
    return StaySource(audit, clock=lambda: now, zone=lambda name: BAKU)


async def _round(db_session, fake, audit, now=NOW):
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)

    async def quiet(seconds: float) -> None:
        return None

    return await run_round(maker, egress=True, source=_source(audit, now), now=now, sleep=quiet,
                           client_factory=lambda account: TresClient(account, transport=fake.transport))


@requires_db
async def test_due_stays_are_the_discharged_past_their_wait_within_the_week_and_after_send_from(db_session):
    ward, fake = await _world(db_session)
    due = await add_stay(db_session, ward, protocol_no="202600000101", number="H2600101")
    await add_stay(db_session, ward, protocol_no="202600000102", number="H2600102", bed="2",
                   discharged_at=NOW - timedelta(hours=23))                          # still within its wait
    await add_stay(db_session, ward, protocol_no="202600000103", number="H2600103", bed="3",
                   discharged_at=NOW - timedelta(hours=24) - REACH - timedelta(minutes=1))   # past the week
    await add_stay(db_session, ward, protocol_no="202600000104", number="H2600104", bed="10",
                   state=AdmissionState.ACTIVE)                                     # still admitted
    settings = await feed_settings(db_session, ward, fake)
    assert await due_stays(db_session, settings, NOW) == [due.id]
    settings.send_from = DISCHARGED + timedelta(minutes=1)                          # O15: discharged before it
    assert await due_stays(db_session, settings, NOW) == []
    settings.send_from, settings.settle_hours = DISCHARGED, 0
    assert len(await due_stays(db_session, settings, NOW)) == 2                     # at the cut-off itself: due


@requires_db
async def test_a_stay_is_read_whole_with_one_trail_read_under_its_last_board_key(db_session):
    """N2, N3: a transfer chain — the protocol number moved to the arriving row, the patient row
    kept; the chart rows of both beds are under that one key."""
    ward, fake = await _world(db_session)
    first = await add_stay(db_session, ward, state=AdmissionState.TRANSFERRED, protocol_no=None)
    from homunculus.admission.models import Patient
    person = await db_session.get(Patient, first.patient_id)
    last = await add_stay(db_session, ward, unit="neo", bed="N1", attending="admin", source=first, patient=person,
                          protocol_no="202600000101", admitted_at=ADMITTED + timedelta(days=1), weight_kg=None)
    await map_unit(db_session, ward, unit="neo", code="NEO-01", display="Neonatal")
    await identify(db_session, ward, user="doctor")
    audit = InMemoryAuditLog()
    hr1 = chart(audit, "202600000101", "heart_rate", 88.0, "/min", ADMITTED + timedelta(hours=1))
    wrong = chart(audit, "202600000101", "heart_rate", 180.0, "/min", ADMITTED + timedelta(hours=30))
    audit.append(AuditEvent(SLUG, "chart_retract", "202600000101", "heart_rate", {"entry": wrong, "reason": "yanlış hasta"}))
    hr2 = chart(audit, "202600000101", "heart_rate", 76.0, "/min", ADMITTED + timedelta(hours=60))
    chart(audit, "H2600999", "heart_rate", 99.0, "/min", ADMITTED + timedelta(hours=2))     # someone else's key
    for admission_id in (first.id, last.id):                                    # from either end of the chain
        stay = await _source(audit).load(db_session, ward.tenant.id, admission_id)
        assert (stay.root_id, stay.last_id, stay.board_key) == (first.id, last.id, "202600000101")
        assert (stay.admitted_at, stay.discharged_at, stay.finished) == (ADMITTED, DISCHARGED, True)
        assert stay.person.fin == "AB12C3D" and stay.person.display_name == "Sentetikova Leyla"
        assert (stay.department.code, stay.department.display) == ("NEO-01", "Neonatal")       # the last row's unit
        assert [(c.user_id, c.known) for c in stay.clinicians] == [(ward.users["doctor"].id, True),
                                                                 (ward.users["admin"].id, False)]
        assert stay.weight_kg == 72.5                                           # the root's
        assert [r.entry for r in stay.readings] == [hr1, hr2]
    assert await _source(audit).load(db_session, ward.tenant.id, ward.units["rea"].id) is None   # not an admission


@requires_db
async def test_a_round_puts_the_due_stay_on_the_stand_in_and_writes_one_package_row(db_session):
    ward, fake = await _world(db_session)
    admission = await add_stay(db_session, ward)
    await map_unit(db_session, ward)
    await identify(db_session, ward)
    await feed_settings(db_session, ward, fake)
    audit = InMemoryAuditLog()
    chart(audit, "202600000101", "heart_rate", 88.0, "/min", ADMITTED + timedelta(hours=1))
    chart(audit, "202600000101", "heart_rate", 76.0, "/min", ADMITTED + timedelta(hours=90))
    chart(audit, "202600000101", "temperature", 37.2, "°C", ADMITTED + timedelta(hours=2))
    report = await _round(db_session, fake, audit)
    assert (report.tenants, report.packages, report.failed) == (1, 1, 0)
    (encounter,) = fake.stored("Encounter")
    assert encounter["period"] == {"start": "2026-11-02T10:30:00+04:00", "end": "2026-11-06T15:00:00+04:00"}
    assert encounter["serviceType"]["coding"][0]["code"] == "RE-01" and encounter["status"] == "finished"
    assert sorted(o["effectiveDateTime"] for o in fake.stored("Observation")) == [
        "2026-11-02T10:30:00+04:00", "2026-11-02T11:30:00+04:00", "2026-11-02T12:30:00+04:00",
        "2026-11-06T04:30:00+04:00"]                                            # weight, HR first, temperature, HR last
    rows = (await db_session.execute(select(TresDelivery.resource_type, TresDelivery.status,
                                            TresDelivery.admission_id))).all()
    assert {tuple(r) for r in rows} == {(t, "sent", admission.id) for t in ("patient", "practitioner", "encounter", "vital")}
    (package_row,) = audit.records(tenant=SLUG, event_type="tres.package")
    assert package_row.patient_id == "202600000101"
    assert package_row.payload == {"admission_id": str(admission.id), "environment": "test",
                                   "counts": {"patient": {"sent": 1}, "practitioner": {"sent": 1},
                                              "encounter": {"sent": 1}, "vital": {"sent": 4}}}
    assert "AB12C3D" not in str(package_row.payload) and "Sentetik" not in str(package_row.payload)
    asked = list(fake.requests)
    report = await _round(db_session, fake, audit, now=NOW + timedelta(minutes=5))
    assert report.packages == 1 and fake.requests == asked                     # D7: nothing changed
    assert len(audit.records(tenant=SLUG, event_type="tres.package")) == 1


@requires_db
async def test_a_stay_whose_unit_is_unmapped_is_skipped_and_goes_once_it_is_mapped(db_session):
    ward, fake = await _world(db_session)
    await add_stay(db_session, ward)
    await feed_settings(db_session, ward, fake)
    audit = InMemoryAuditLog()
    await _round(db_session, fake, audit)
    rows = {r.resource_type: (r.status, r.reason) for r in (await db_session.execute(select(TresDelivery))).scalars()}
    assert rows["encounter"] == ("skipped", "unit_unmapped") and rows["practitioner"] == ("skipped", "identity_missing")
    assert fake.stored("Encounter") == []
    await map_unit(db_session, ward)
    await _round(db_session, fake, audit, now=NOW + timedelta(minutes=5))
    assert len(fake.stored("Encounter")) == 1                                  # the next round sent it


@requires_db
async def test_the_nightly_retry_forces_a_stuck_stay_once_a_night_however_old(db_session):
    """O21: a stay discharged two weeks ago, past the rounds' week, has a `stuck` Patient row whose
    payload is unchanged — no round would try it. The first round after 04:00 in Baku does."""
    ward, fake = await _world(db_session)
    old = DISCHARGED - timedelta(days=14)
    admission = await add_stay(db_session, ward, admitted_at=old - timedelta(days=2), discharged_at=old)
    await map_unit(db_session, ward)
    settings = await feed_settings(db_session, ward, fake)
    audit = InMemoryAuditLog()
    stay = await _source(audit).load(db_session, ward.tenant.id, admission.id)
    built = map_patient(stay.person, stay.root_id)
    db_session.add(TresDelivery(tenant_id=ward.tenant.id, environment="test", resource_type="patient",
                                local_id=built.local_id, status="stuck", attempts=5,
                                payload_digest=payload_digest(built.resource), admission_id=admission.id))
    settings.retried_at = datetime(2026, 11, 7, 1, 0, tzinfo=timezone.utc)      # 05:00 in Baku, 7 Nov
    await db_session.commit()
    night = datetime(2026, 11, 7, 22, 0, tzinfo=timezone.utc)                   # 02:00 in Baku, 8 Nov
    await _round(db_session, fake, audit, now=night)
    assert fake.stored("Patient") == []                                         # not yet 04:00
    await _round(db_session, fake, audit, now=night + timedelta(hours=2, minutes=5))   # 04:05
    assert len(fake.stored("Patient")) == 1 and len(fake.stored("Encounter")) == 1
    db_session.expire_all()
    row = (await db_session.execute(select(TresDelivery).where(TresDelivery.resource_type == "patient"))).scalar_one()
    assert (row.status, row.attempts) == ("sent", 0)
    marked = (await db_session.execute(select(TresSettings.retried_at))).scalar_one()
    assert marked == night + timedelta(hours=2, minutes=5)
    asked = len(fake.requests)
    await _round(db_session, fake, audit, now=night + timedelta(hours=3))      # the same night: nothing again
    assert len(fake.requests) == asked


@requires_db
async def test_a_stay_still_admitted_goes_by_hand_in_progress(db_session):
    """D9: «Şimdi gönder» sends a stay at any time; its Encounter is `in-progress`, with no end."""
    from homunculus.tres.worker import Sender
    ward, fake = await _world(db_session)
    admission = await add_stay(db_session, ward, state=AdmissionState.ACTIVE)
    await map_unit(db_session, ward)
    settings = await feed_settings(db_session, ward, fake)
    client = TresClient(fake.account, transport=fake.transport)
    sender = Sender(db_session, client, tenant_id=ward.tenant.id, environment="test", mode="send", now=NOW,
                    enabled_types=("patient", "practitioner", "encounter", "vital"))
    outcome = await _source(InMemoryAuditLog()).package(db_session, settings, admission.id)(sender)
    (encounter,) = fake.stored("Encounter")
    assert encounter["status"] == "in-progress" and "end" not in encounter["period"]
    assert outcome.first_complete and ids.encounter(admission.id) in [row[1] for row in outcome.rows]
    await client.aclose()

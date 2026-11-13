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
  rebuilt and forced, within the night's 90 days; once a night — never before 04:00 on a tenant's
  first night, never twice by two processes (the mark is a compare-and-set), and a stuck stay that
  is due goes once;
* the re-review of the fixes: the night takes each row to its stay's LAST admission before it
  judges the cut-off or counts the stay; it reaches back 90 days (NIGHT_REACH); a person's FİN
  cleared never relabels an Encounter the platform holds; «Yeniden dene» is not held by the cut-off;
* batch-3 review: the person's newest stay is the authority for their one national Patient (A1); a
  round and a hand on one stay write one `tres.package` (A5); the rounds' reach goes back to the last
  round that ran to its end, never past the cut-off, and closes to the week again (A3); tenant
  isolation and the window's two edges (A10).

No database for the zone, the night and the window; the rest runs on Postgres against the
stand-in, the trail in memory. Synthetic ward (tests/kabul_world.py), synthetic stays
(tests/tres_world.py)."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker

from homunculus.admission.models import AdmissionState, Patient
from homunculus.api.audit import AuditEvent, InMemoryAuditLog
from homunculus.tres import ids, source
from homunculus.tres import package as tres_package
from homunculus.tres.client import TresClient, TresError
from homunculus.tres.ledger import HAND_LOCK_TIMEOUT_MS, RETRY_AFTER, LedgerBusy, payload_digest
from homunculus.tres.mapping.patient import patient as map_patient
from homunculus.tres.models import RESOURCE_TYPES, TresDelivery, TresDepartmentMap, TresSettings
from homunculus.tres.source import REACH, StaySource, due_stays, nightly_due, retry_stays, window, zone_of
from homunculus.tres.worker import Sender, run_round
from tests.conftest import requires_db
from tests.fake_tres import FakeTres
from tests.kabul_world import SLUG, build_ward
from tests.tres_world import (
    ADMITTED, BAKU, DISCHARGED, NOW, ORGANIZATION, add_stay, chart, feed_settings, identify, map_unit,
    other_tenants_stay,
)


# ---------------------------------------------------------------- the zone and the night (no database)
def test_the_zone_is_the_tenants_and_an_unknown_one_is_none_never_utc():
    assert zone_of("UTC") is timezone.utc and zone_of("") is timezone.utc and zone_of(None) is timezone.utc
    assert zone_of("Mars/Olympus_Mons") is None


def test_the_nightly_retry_is_due_once_after_four_in_the_tenants_zone():
    before_four = datetime(2026, 11, 7, 23, 30, tzinfo=timezone.utc)        # 03:30 in Baku
    after_four = datetime(2026, 11, 8, 0, 30, tzinfo=timezone.utc)          # 04:30 in Baku
    # batch-3 review A6: a tenant that never ran it waits for 04:00 too — never a night run at 03:30
    assert not nightly_due(None, before_four, BAKU)
    assert nightly_due(None, after_four, BAKU)                              # the first round after 04:00
    assert not nightly_due(before_four - timedelta(hours=2), before_four, BAKU)   # ran after yesterday's 04:00
    assert nightly_due(before_four, after_four, BAKU)                       # 04:00 has come since
    assert not nightly_due(after_four, after_four + timedelta(hours=5), BAKU)


def test_an_unknown_zone_is_said_by_the_tenants_id_and_the_night_falls_back_to_utc(caplog):
    """A6: never silently — one warning, the tenant's id and nothing else (no zone name, no PHI)."""
    tenant = SimpleNamespace(id=uuid.uuid4(), timezone="Mars/Olympus_Mons")
    with caplog.at_level("WARNING"):
        assert StaySource(InMemoryAuditLog()).night_zone(tenant) is timezone.utc
    assert str(tenant.id) in caplog.text and "Mars" not in caplog.text
    caplog.clear()
    with caplog.at_level("WARNING"):
        assert StaySource(InMemoryAuditLog(), zone=lambda name: BAKU).night_zone(tenant) is BAKU
    assert caplog.text == ""


def test_an_unknown_zone_is_said_once_per_tenant_not_every_round(caplog):
    """Batch-4 review: a round every five minutes would say it 288 times a day."""
    source_ = StaySource(InMemoryAuditLog())
    first, second = (SimpleNamespace(id=uuid.uuid4(), timezone="Mars/Olympus_Mons") for _ in range(2))
    with caplog.at_level("WARNING"):
        for _ in range(3):
            assert source_.night_zone(first) is timezone.utc
        assert source_.night_zone(second) is timezone.utc
    assert caplog.text.count(str(first.id)) == 1 and caplog.text.count(str(second.id)) == 1


def _settings(**over) -> SimpleNamespace:
    return SimpleNamespace(**{"settle_hours": 24, "send_from": None, "reached_to": None, **over})


def test_the_window_reaches_back_to_the_last_round_that_ran_to_its_end_and_closes_to_the_week():
    """A3: `(after, upper)` — due when after < discharge_at <= upper (and >= send_from, in the query)."""
    upper = NOW - timedelta(hours=24)
    week = upper - REACH
    assert window(_settings(), NOW) == (week, upper)                        # validate, no cut-off: the week
    cut = NOW - timedelta(days=30)
    assert window(_settings(send_from=cut), NOW) == (None, upper)           # no round completed: from the cut-off
    gap = week - timedelta(days=3)
    assert window(_settings(reached_to=gap), NOW) == (gap, upper)           # rounds stopped: back to the last one
    assert window(_settings(send_from=cut, reached_to=gap), NOW) == (gap, upper)
    assert window(_settings(reached_to=upper - timedelta(minutes=5)), NOW) == (week, upper)   # closed again
    assert window(_settings(settle_hours=0, reached_to=gap), NOW) == (gap, NOW)


# ---------------------------------------------------------------- Postgres
async def _world(db_session):
    ward = await build_ward(db_session)
    fake = FakeTres()
    fake.seed("Organization", ORGANIZATION)
    return ward, fake


def _source(audit, now=NOW) -> StaySource:
    return StaySource(audit, clock=lambda: now, zone=lambda name: BAKU)


async def _round(db_session, fake, audit, now=NOW, transport=None):
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)

    async def quiet(seconds: float) -> None:
        return None

    return await run_round(maker, egress=True, source=_source(audit, now), now=now, sleep=quiet,
                           client_factory=lambda account: TresClient(account, transport=transport or fake.transport))


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
    """O21: a stay discharged two weeks ago, past the rounds' week (within the night's 90 days), has a
    `stuck` Patient row whose payload is unchanged — no round would try it. The first round after
    04:00 in Baku does."""
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


# ---------------------------------------------------------------- batch-3 review (Postgres)
OLDER_PHONE, NEWER_PHONE = "050 123 45 67", "055 765 43 21"


def _hand(db_session, fake, ward) -> tuple[Sender, TresClient]:
    """«Şimdi gönder»'s sender: a person's lock timeout (N12), every type on."""
    client = TresClient(fake.account, transport=fake.transport)
    return Sender(db_session, client, tenant_id=ward.tenant.id, environment="test", mode="send", now=NOW,
                  enabled_types=RESOURCE_TYPES, lock_timeout_ms=HAND_LOCK_TIMEOUT_MS), client


def _phone(fake) -> str:
    (person,) = fake.stored("Patient")
    return person["telecom"][0]["value"]


async def _patient_row(db_session) -> TresDelivery:
    """The person's ledger row, read afresh (never `expire_all`: the test's own objects stay loaded)."""
    return (await db_session.execute(select(TresDelivery).where(TresDelivery.resource_type == "patient")
                                     .execution_options(populate_existing=True))).scalar_one()


@requires_db
async def test_a_person_readmitted_within_the_reach_keeps_one_patient_the_newer_stays_and_rounds_ask_nothing(db_session):
    """A1: the admission form made a patient row per stay — the phone typed only on the second. Both
    stays build `hmn-p-{digest}.`; the newer stay is the authority, so after the first round no round
    (and no hand on the older stay) asks the platform anything, and its Patient holds the newer phone."""
    ward, fake = await _world(db_session)
    older = await add_stay(db_session, ward, phone=OLDER_PHONE)
    newer = await add_stay(db_session, ward, protocol_no="202600000102", number="H2600102", bed="2",
                           admitted_at=DISCHARGED + timedelta(days=1), discharged_at=DISCHARGED + timedelta(days=2),
                           phone=NEWER_PHONE)
    await map_unit(db_session, ward)
    await identify(db_session, ward)
    settings = await feed_settings(db_session, ward, fake)
    audit = InMemoryAuditLog()
    now = DISCHARGED + timedelta(days=2, hours=25)                    # both due: the older within its week
    report = await _round(db_session, fake, audit, now=now)
    assert (report.packages, report.failed) == (2, 0)
    assert _phone(fake) == "+994557654321" and len(fake.stored("Encounter")) == 2
    assert (await _patient_row(db_session)).admission_id == newer.id
    asked = list(fake.requests)
    for minutes in (5, 10):
        report = await _round(db_session, fake, audit, now=now + timedelta(minutes=minutes))
        assert report.packages == 2 and fake.requests == asked         # D7 holds: not a token, not a PUT
    # «Şimdi gönder» of the older stay leaves the newer one's Patient alone as well
    hand, client = _hand(db_session, fake, ward)
    outcome = await _source(audit, now).package(db_session, settings, older.id)(hand)
    assert fake.requests == asked and _phone(fake) == "+994557654321"
    assert ("patient", ids.patient("AB12C3D"), "sent", None) in outcome.rows
    assert (await _patient_row(db_session)).admission_id == newer.id
    await client.aclose()


@requires_db
async def test_a_newer_stay_still_in_progress_holds_nothing_back_until_it_has_run(db_session):
    """A1: the newer stay owns the person's row only once it has run — here, by hand while admitted."""
    ward, fake = await _world(db_session)
    await add_stay(db_session, ward, phone=OLDER_PHONE)
    newer = await add_stay(db_session, ward, protocol_no="202600000102", number="H2600102", bed="2",
                           state=AdmissionState.ACTIVE, admitted_at=DISCHARGED + timedelta(hours=6),
                           phone=NEWER_PHONE)
    await map_unit(db_session, ward)
    await identify(db_session, ward)
    settings = await feed_settings(db_session, ward, fake)
    audit = InMemoryAuditLog()
    await _round(db_session, fake, audit)                              # the older stay is due; the newer is not
    assert _phone(fake) == "+994501234567"
    hand, client = _hand(db_session, fake, ward)
    await _source(audit).package(db_session, settings, newer.id)(hand)
    assert _phone(fake) == "+994557654321"                             # the newer stay took the person
    await client.aclose()
    asked = list(fake.requests)
    report = await _round(db_session, fake, audit, now=NOW + timedelta(minutes=5))
    assert report.packages == 1 and fake.requests == asked and _phone(fake) == "+994557654321"


class _RoundFirst:
    """The hand's sender; just before its Encounter goes, a whole round runs the same stay."""

    def __init__(self, inner: Sender, round_) -> None:
        self.inner, self.round_ = inner, round_
        self.mode, self.environment = inner.mode, inner.environment

    async def held(self, **kw):
        return await self.inner.held(**kw)

    async def forget_skip(self, **kw):
        return await self.inner.forget_skip(**kw)

    async def skip(self, **kw):
        return await self.inner.skip(**kw)

    async def send(self, **kw):
        if kw["resource_type"] == "encounter" and self.round_ is not None:
            round_, self.round_ = self.round_, None
            await round_()
        return await self.inner.send(**kw)


@requires_db
async def test_a_round_and_a_hand_on_one_stay_write_one_package_row(db_session):
    """A5: the `tres.package` row is written by the run whose delivery took the Encounter's id under its
    row's lock — here the round, which ran between the hand's Patient and the hand's Encounter."""
    ward, fake = await _world(db_session)
    admission = await add_stay(db_session, ward)
    await map_unit(db_session, ward)
    await identify(db_session, ward)
    settings = await feed_settings(db_session, ward, fake)
    audit = InMemoryAuditLog()
    hand, client = _hand(db_session, fake, ward)
    sender = _RoundFirst(hand, lambda: _round(db_session, fake, audit))
    outcome = await _source(audit).package(db_session, settings, admission.id)(sender)
    assert sender.round_ is None and outcome.first_complete is False
    assert len(fake.stored("Encounter")) == 1
    assert len(audit.records(tenant=SLUG, event_type="tres.package")) == 1
    await client.aclose()


@requires_db
async def test_an_outage_among_the_vitals_writes_no_package_row_then_or_later(db_session):
    """Amendment 17, held by A5: the run that gave the Encounter its id was cut short; no later run
    took it — the ledger holds every row, the audit has no `tres.package`."""
    ward, fake = await _world(db_session)
    await add_stay(db_session, ward)
    await map_unit(db_session, ward)
    await identify(db_session, ward)
    await feed_settings(db_session, ward, fake)
    audit = InMemoryAuditLog()

    def vitals_down(request: httpx.Request) -> httpx.Response:
        if "/Observation" in request.url.path:
            return httpx.Response(503, text="")
        return fake.transport.handler(request)

    report = await _round(db_session, fake, audit, transport=httpx.MockTransport(vitals_down))
    assert (report.packages, report.failed) == (0, 1)
    assert len(fake.stored("Encounter")) == 1 and fake.stored("Observation") == []
    report = await _round(db_session, fake, audit, now=NOW + timedelta(minutes=5))
    assert (report.packages, report.failed) == (1, 0) and len(fake.stored("Observation")) == 1
    assert audit.records(tenant=SLUG, event_type="tres.package") == []


async def _reached(db_session):
    value = (await db_session.execute(text("SELECT reached_to FROM tres_settings"))).scalar_one()
    await db_session.commit()
    return value


@requires_db
async def test_a_round_that_runs_to_its_end_advances_the_reach_and_one_cut_short_does_not(db_session):
    """A3: with no due stay a completed round still advances `reached_to` (to its `now − settle`);
    a round ended by a 429 leaves it; the settings' `updated_at` is never touched."""
    ward, fake = await _world(db_session)
    await feed_settings(db_session, ward, fake)
    version = (await db_session.execute(text("SELECT updated_at FROM tres_settings"))).scalar_one()
    report = await _round(db_session, fake, InMemoryAuditLog())
    assert (report.tenants, report.packages) == (1, 0)
    assert await _reached(db_session) == NOW - timedelta(hours=24)
    await add_stay(db_session, ward)
    await map_unit(db_session, ward)

    def throttled(request: httpx.Request) -> httpx.Response:
        if request.url.path.startswith("/fhir/"):
            return httpx.Response(429, headers={"Retry-After": "60"})
        return fake.transport.handler(request)

    later = NOW + timedelta(hours=1)
    report = await _round(db_session, fake, InMemoryAuditLog(), now=later, transport=httpx.MockTransport(throttled))
    assert report.retry_after == 60
    assert await _reached(db_session) == NOW - timedelta(hours=24)        # cut short: not advanced
    report = await _round(db_session, fake, InMemoryAuditLog(), now=later)
    assert report.packages == 1 and await _reached(db_session) == later - timedelta(hours=24)
    assert (await db_session.execute(text("SELECT updated_at FROM tres_settings"))).scalar_one() == version


@requires_db
async def test_a_tenant_parked_for_ten_days_sends_the_gap_once_a_round_completes_and_never_crosses_the_cut_off(
        db_session):
    """A3 against D9: stays discharged while no round could complete are not dropped by the week."""
    ward, fake = await _world(db_session)
    await map_unit(db_session, ward)
    cut = datetime(2026, 11, 1, 0, 0, tzinfo=timezone.utc)
    t1 = datetime(2026, 11, 3, 12, 0, tzinfo=timezone.utc)
    before_cut = await add_stay(db_session, ward, protocol_no="202600000110", number="H2600110", fin="CD34E5F",
                                admitted_at=cut - timedelta(days=3), discharged_at=cut - timedelta(hours=12))
    await feed_settings(db_session, ward, fake, send_from=cut)
    audit = InMemoryAuditLog()
    await _round(db_session, fake, audit, now=t1)                       # nothing due: it completes
    assert await _reached(db_session) == t1 - timedelta(hours=24)
    await db_session.execute(text("UPDATE tres_settings SET session_refused_at = :t"), {"t": t1})   # parked
    await db_session.commit()
    gap = await add_stay(db_session, ward, protocol_no="202600000111", number="H2600111", fin="EF56G7H", bed="2",
                         admitted_at=t1, discharged_at=t1 + timedelta(days=1))
    recent = await add_stay(db_session, ward, protocol_no="202600000112", number="H2600112", fin="GH78J9K", bed="3",
                            admitted_at=t1 + timedelta(days=6), discharged_at=t1 + timedelta(days=8))
    for day in range(1, 10):
        report = await _round(db_session, fake, audit, now=t1 + timedelta(days=day))
        assert report.parked == 1
    assert await _reached(db_session) == t1 - timedelta(hours=24)         # passed over: not advanced
    await db_session.execute(text("UPDATE tres_settings SET session_refused_at = NULL"))
    await db_session.commit()
    t2 = t1 + timedelta(days=10)
    settings = await db_session.get(TresSettings, ward.tenant.id, populate_existing=True)
    assert await due_stays(db_session, settings, t2) == [gap.id, recent.id]   # the gap, beyond the week
    report = await _round(db_session, fake, audit, now=t2)
    assert report.packages == 2 and len(fake.stored("Encounter")) == 2
    assert await _reached(db_session) == t2 - timedelta(hours=24)
    settings = await db_session.get(TresSettings, ward.tenant.id, populate_existing=True)
    assert await due_stays(db_session, settings, t2 + timedelta(minutes=5)) == [recent.id]   # closed to the week
    settings.reached_to = cut - timedelta(days=20)                          # even reaching far back…
    assert before_cut.id not in await due_stays(db_session, settings, t2)   # …the cut-off is never crossed


@requires_db
async def test_two_processes_cannot_both_run_the_night(db_session):
    """A6: the night's mark is a compare-and-set on the value each read — the second changes no row
    and leaves the night alone (Dockerfile.api runs one process; this holds if that ever changes)."""
    ward, fake = await _world(db_session)
    old = DISCHARGED - timedelta(days=14)
    admission = await add_stay(db_session, ward, admitted_at=old - timedelta(days=2), discharged_at=old)
    await feed_settings(db_session, ward, fake, retried_at=datetime(2026, 11, 7, 1, 0, tzinfo=timezone.utc))
    db_session.add(TresDelivery(tenant_id=ward.tenant.id, environment="test", resource_type="patient",
                                local_id="hmn-p-takili.", status="stuck", attempts=5, admission_id=admission.id))
    await db_session.commit()
    night = datetime(2026, 11, 8, 0, 5, tzinfo=timezone.utc)                # 04:05 in Baku
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)
    async with maker() as one, maker() as two:
        first_settings = await one.get(TresSettings, ward.tenant.id)
        second_settings = await two.get(TresSettings, ward.tenant.id)       # read before the first marks
        first = [package async for package in _source(InMemoryAuditLog(), night)(one, first_settings)]
        second = [package async for package in _source(InMemoryAuditLog(), night)(two, second_settings)]
    assert (len(first), len(second)) == (1, 0)
    assert (await db_session.execute(text("SELECT retried_at FROM tres_settings"))).scalar_one() == night


@requires_db
async def test_a_stay_both_stuck_and_due_is_packaged_once_in_the_nightly_round(db_session):
    """A8: forced once — not forced and then again as due."""
    ward, fake = await _world(db_session)
    admission = await add_stay(db_session, ward)
    await map_unit(db_session, ward)
    await feed_settings(db_session, ward, fake)                             # never retried: NOW is 16:00 in Baku
    db_session.add(TresDelivery(tenant_id=ward.tenant.id, environment="test", resource_type="practitioner",
                                local_id="hmn-pr-takili.", status="stuck", attempts=5, admission_id=admission.id))
    await db_session.commit()
    report = await _round(db_session, fake, InMemoryAuditLog())
    assert (report.packages, report.failed) == (1, 0)


@requires_db
async def test_another_tenants_stay_is_never_due_stuck_or_loaded(db_session):
    """A10: every read of the source is the tenant's own."""
    ward, fake = await _world(db_session)
    ours = await add_stay(db_session, ward)
    theirs = await other_tenants_stay(db_session)
    settings = await feed_settings(db_session, ward, fake)
    db_session.add(TresDelivery(tenant_id=ward.tenant.id, environment="test", resource_type="patient",
                                local_id="hmn-p-bizim.", status="stuck", attempts=5, admission_id=ours.id))
    await db_session.commit()
    assert await due_stays(db_session, settings, NOW) == [ours.id]
    assert await retry_stays(db_session, settings, NOW) == [ours.id]
    assert await _source(InMemoryAuditLog()).load(db_session, ward.tenant.id, theirs.id) is None
    assert (await _source(InMemoryAuditLog()).load(db_session, ward.tenant.id, ours.id)).last_id == ours.id


@requires_db
async def test_the_window_holds_its_upper_edge_and_leaves_its_lower_one(db_session):
    """A10: due when `now − settle − REACH < discharge_at <= now − settle` — the upper edge inclusive
    (a stay is due the moment its wait is over), the lower exclusive (a week is seven days, not seven
    and a moment). No cut-off, no completed round: the week alone."""
    ward, fake = await _world(db_session)
    upper = NOW - timedelta(hours=24)
    at_upper = await add_stay(db_session, ward, discharged_at=upper)
    await add_stay(db_session, ward, protocol_no="202600000102", number="H2600102", bed="2",
                   admitted_at=upper - REACH - timedelta(days=2), discharged_at=upper - REACH)
    inside = await add_stay(db_session, ward, protocol_no="202600000103", number="H2600103", bed="3",
                            admitted_at=upper - REACH - timedelta(days=2),
                            discharged_at=upper - REACH + timedelta(microseconds=1))
    await add_stay(db_session, ward, protocol_no="202600000104", number="H2600104", bed="10",
                   discharged_at=upper + timedelta(microseconds=1))
    settings = await feed_settings(db_session, ward, fake, mode="validate")
    assert await due_stays(db_session, settings, NOW) == [inside.id, at_upper.id]


# ---------------------------------------------------------------- batch-4 review (Postgres)
def _once(fake, status: int, match) -> httpx.MockTransport:
    """The stand-in, but the first request `match` takes is answered `status` — a 503 (an outage: the
    row is left as it was, a new one `pending`) or a 400 (a refusal about the resource: `failed`)."""
    left = [1]

    def handler(request: httpx.Request) -> httpx.Response:
        if left[0] and match(request):
            left[0] -= 1
            if status >= 500:
                return httpx.Response(status, text="")
            return httpx.Response(status, json={"resourceType": "OperationOutcome", "issue": [
                {"severity": "error", "code": "invalid", "diagnostics": "Sentetik ret"}]})
        return fake.transport.handler(request)
    return httpx.MockTransport(handler)


async def _rows_of(db_session, admission_id) -> dict[str, tuple[str, str | None]]:
    rows = (await db_session.execute(select(TresDelivery).where(TresDelivery.admission_id == admission_id)
                                     .execution_options(populate_existing=True))).scalars()
    return {row.resource_type: (row.status, row.reason) for row in rows if row.resource_type != "vital"}


@requires_db
@pytest.mark.parametrize("status", [503, 400])
async def test_a_gap_stay_whose_catch_up_meets_one_outage_or_one_refusal_goes_the_next_night(db_session, status):
    """Batch-4 review (the reviewer's repro, inverted): the round that reached back for a gap stay ran to
    its end, so the watermark passed the stay; its Patient's first request met one 503 (the new row stays
    `pending`) or one 400 (`failed`). No round reaches it again — the nightly retry takes every stay with a
    `stuck`, `failed` or `pending` row, so the next night sends it."""
    ward, fake = await _world(db_session)
    await map_unit(db_session, ward)
    await identify(db_session, ward)
    cut = datetime(2026, 11, 1, 0, 0, tzinfo=timezone.utc)
    t1 = datetime(2026, 11, 3, 12, 0, tzinfo=timezone.utc)
    await feed_settings(db_session, ward, fake, send_from=cut)
    audit = InMemoryAuditLog()
    await _round(db_session, fake, audit, now=t1)
    await db_session.execute(text("UPDATE tres_settings SET session_refused_at = :t"), {"t": t1})   # parked
    await db_session.commit()
    gap = await add_stay(db_session, ward, protocol_no="202600000111", number="H2600111", fin="EF56G7H", bed="2",
                         admitted_at=t1, discharged_at=t1 + timedelta(days=1))
    await add_stay(db_session, ward, protocol_no="202600000112", number="H2600112", fin="GH78J9K", bed="3",
                   admitted_at=t1 + timedelta(days=6), discharged_at=t1 + timedelta(days=8))
    await db_session.execute(text("UPDATE tres_settings SET session_refused_at = NULL"))
    await db_session.commit()
    t2 = t1 + timedelta(days=10)
    transport = _once(fake, status, lambda r: r.url.path.startswith("/fhir/Patient")
                      and (status >= 500 or r.method in ("POST", "PUT")))
    await _round(db_session, fake, audit, now=t2, transport=transport)          # the gap stay goes first
    assert await _reached(db_session) == t2 - timedelta(hours=24)               # it ran to its end
    assert (await _rows_of(db_session, gap.id))["patient"][0] == ("pending" if status >= 500 else "failed")
    assert len(fake.stored("Encounter")) == 1                                   # the recent stay's only
    await _round(db_session, fake, audit, now=t2 + timedelta(minutes=5))
    assert len(fake.stored("Encounter")) == 1                                   # out of the rounds' window
    await _round(db_session, fake, audit, now=datetime(2026, 11, 14, 0, 5, tzinfo=timezone.utc))   # 04:05 Baku
    assert len(fake.stored("Encounter")) == 2
    rows = await _rows_of(db_session, gap.id)          # (the doctor's row follows the stay that last ran it)
    assert (rows["patient"], rows["encounter"]) == (("sent", None), ("sent", None))


@requires_db
async def test_the_nightly_retry_never_crosses_the_cut_off(db_session):
    """Batch-4 review (the reviewer's repro, inverted): a `validate` trial left a Practitioner `stuck`; the
    first `send` set `send_from` two days after this stay's discharge. The night does not send it — the
    duplicate O15 exists to prevent."""
    ward, fake = await _world(db_session)
    admission = await add_stay(db_session, ward)
    await map_unit(db_session, ward)
    await identify(db_session, ward)
    await feed_settings(db_session, ward, fake, send_from=DISCHARGED + timedelta(days=2),
                        retried_at=datetime(2026, 11, 7, 1, 0, tzinfo=timezone.utc))
    db_session.add(TresDelivery(tenant_id=ward.tenant.id, environment="test", resource_type="practitioner",
                                local_id="hmn-pr-takili.", status="stuck", attempts=5, admission_id=admission.id))
    await db_session.commit()
    await _round(db_session, fake, InMemoryAuditLog(), now=datetime(2026, 11, 9, 0, 5, tzinfo=timezone.utc))
    assert fake.stored("Patient") == [] and fake.stored("Encounter") == []
    assert (await db_session.execute(text("SELECT retried_at FROM tres_settings"))).scalar_one() is not None


@requires_db
async def test_the_nightly_retry_takes_the_unfinished_stays_since_the_cut_off_and_in_validate_only_the_refused(
        db_session):
    """Batch-4 review: a stay with a `stuck`, `failed` or `pending` row in the selected environment; in
    `send`, also one whose Encounter row is not `sent` — skipped for any reason, so a FİN added, a unit
    mapped or a zone set later sends the old stay; never one discharged before the cut-off (or of the
    other environment, or another tenant's). In `validate`, an Encounter `no_reference` is not taken:
    every validated stay would be rebuilt every night."""
    ward, fake = await _world(db_session)
    stays = {}
    for n, name in enumerate(("stuck", "failed", "pending", "unmapped", "no_reference", "done", "before_cut",
                              "live", "deleted", "admitted")):
        stays[name] = await add_stay(
            db_session, ward, protocol_no=f"2026000002{n:02d}", number=f"H26002{n:02d}", bed="1",
            state=AdmissionState.ACTIVE if name == "admitted" else AdmissionState.DISCHARGED,
            discharged_at=DISCHARGED - timedelta(days=30 if name == "before_cut" else 10))
    cut = DISCHARGED - timedelta(days=20)
    settings = await feed_settings(db_session, ward, fake, send_from=cut)

    def row(name, resource_type, status, reason=None, environment="test"):
        db_session.add(TresDelivery(tenant_id=ward.tenant.id, environment=environment, resource_type=resource_type,
                                    local_id=f"hmn-{name}-{resource_type}.", status=status, reason=reason,
                                    admission_id=stays[name].id))

    row("stuck", "patient", "stuck")
    row("failed", "vital", "failed")
    row("pending", "practitioner", "pending")
    row("unmapped", "encounter", "skipped", "unit_unmapped")
    row("no_reference", "encounter", "skipped", "no_reference")
    row("done", "encounter", "sent")
    row("done", "practitioner", "skipped", "identity_missing")   # a practitioner left out: the stay went
    row("before_cut", "patient", "stuck")
    row("live", "patient", "stuck", environment="live")
    row("deleted", "encounter", "deleted")
    row("admitted", "encounter", "skipped", "patient_unheld")   # still admitted: not before the cut-off
    await db_session.commit()
    expected = sorted((stays[n].id for n in ("stuck", "failed", "pending", "unmapped", "no_reference", "admitted")),
                      key=str)
    assert sorted(await retry_stays(db_session, settings, NOW), key=str) == expected
    settings.mode = "validate"
    assert sorted(await retry_stays(db_session, settings, NOW), key=str) == sorted(
        (stays[n].id for n in ("stuck", "failed", "pending")), key=str)
    settings.send_from = None                                    # no cut-off: the old stay too
    assert stays["before_cut"].id in await retry_stays(db_session, settings, NOW)


@requires_db
async def test_an_older_stay_held_back_by_a_stuck_patient_goes_the_night_after_its_newer_stay_took_the_person(
        db_session):
    """Batch-4 review (the reviewer's A1 repro, inverted): the older stay's run stopped at its `stuck`
    Patient and wrote its own Encounter row (`patient_unheld`); the newer stay then took the person's
    row and sent it. The next night takes the older stay (its Encounter not sent): it yields the Patient
    to the newer stay, which holds the platform's id, and its Encounter goes."""
    ward, fake = await _world(db_session)
    old = DISCHARGED - timedelta(days=14)
    older = await add_stay(db_session, ward, admitted_at=old - timedelta(days=2), discharged_at=old, phone=OLDER_PHONE)
    newer = await add_stay(db_session, ward, protocol_no="202600000102", number="H2600102", bed="2",
                           phone=NEWER_PHONE)                              # due at NOW, the same FİN
    await map_unit(db_session, ward)
    await identify(db_session, ward)
    await feed_settings(db_session, ward, fake, retried_at=datetime(2026, 11, 7, 1, 0, tzinfo=timezone.utc))
    audit = InMemoryAuditLog()
    stay = await _source(audit).load(db_session, ward.tenant.id, older.id)
    built = map_patient(stay.person, stay.root_id)
    db_session.add(TresDelivery(tenant_id=ward.tenant.id, environment="test", resource_type="patient",
                                local_id=built.local_id, status="stuck", attempts=5,
                                payload_digest=payload_digest(built.resource), admission_id=older.id))
    await db_session.commit()
    await _round(db_session, fake, audit, now=old + timedelta(hours=25))      # the older stay's own week
    assert (await _rows_of(db_session, older.id))["encounter"] == ("skipped", "patient_unheld")
    assert fake.stored("Patient") == []
    await _round(db_session, fake, audit, now=NOW)                            # the newer stay takes the person
    assert (await _patient_row(db_session)).admission_id == newer.id and _phone(fake) == "+994557654321"
    await _round(db_session, fake, audit, now=datetime(2026, 11, 8, 0, 5, tzinfo=timezone.utc))   # 04:05 Baku
    assert len(fake.stored("Encounter")) == 2 and len(fake.stored("Patient")) == 1
    assert (await _rows_of(db_session, older.id))["encounter"] == ("sent", None)
    assert _phone(fake) == "+994557654321"                                    # the newer stay's person stands


@requires_db
async def test_an_older_stay_takes_a_persons_row_its_newer_stay_holds_no_id_on_and_the_newer_takes_it_back(
        db_session):
    """Batch-4 review (A1 follow-up): an older stay yields the person's row ONLY to a newer stay whose
    row holds the platform's id. Here the newer stay's Patient was refused: the older stay sends its own
    version and takes the row; the newer stay takes it back when it runs again; and then the older one
    yields and asks nothing — no flip-flop."""
    ward, fake = await _world(db_session)
    older = await add_stay(db_session, ward, phone=OLDER_PHONE)
    newer = await add_stay(db_session, ward, protocol_no="202600000102", number="H2600102", bed="2",
                           admitted_at=DISCHARGED + timedelta(days=1), discharged_at=DISCHARGED + timedelta(days=2),
                           phone=NEWER_PHONE)
    await map_unit(db_session, ward)
    await identify(db_session, ward)
    settings = await feed_settings(db_session, ward, fake)
    audit = InMemoryAuditLog()

    async def hand(admission, transport=None):
        client = TresClient(fake.account, transport=transport or fake.transport)
        sender = Sender(db_session, client, tenant_id=ward.tenant.id, environment="test", mode="send", now=NOW,
                        enabled_types=RESOURCE_TYPES, lock_timeout_ms=HAND_LOCK_TIMEOUT_MS)
        await _source(audit).package(db_session, settings, admission.id)(sender)
        await client.aclose()

    await hand(newer, _once(fake, 400, lambda r: r.url.path == "/fhir/Patient" and r.method == "POST"))
    row = await _patient_row(db_session)
    assert (row.status, row.remote_id, row.admission_id) == ("failed", None, newer.id)
    await hand(older)                                                         # the newer stay holds no id
    row = await _patient_row(db_session)
    assert (row.status, row.admission_id) == ("sent", older.id) and _phone(fake) == "+994501234567"
    assert len(fake.stored("Encounter")) == 1                                 # the older stay is not orphaned
    await hand(newer)                                                         # the newer takes it back
    assert (await _patient_row(db_session)).admission_id == newer.id and _phone(fake) == "+994557654321"
    assert len(fake.stored("Encounter")) == 2
    asked = list(fake.requests)
    await hand(older)
    assert fake.requests == asked and (await _patient_row(db_session)).admission_id == newer.id


@requires_db
async def test_a_unit_mapped_after_the_stays_week_sends_it_the_next_night(db_session):
    """Batch-4 review: the stay's Encounter was skipped `unit_unmapped` while it was in reach; the unit is
    mapped after its week. The next night takes it (send mode: its Encounter is not `sent`)."""
    ward, fake = await _world(db_session)
    admission = await add_stay(db_session, ward)
    await identify(db_session, ward)
    await feed_settings(db_session, ward, fake, retried_at=datetime(2026, 11, 7, 1, 0, tzinfo=timezone.utc))
    audit = InMemoryAuditLog()
    await _round(db_session, fake, audit)
    assert (await _rows_of(db_session, admission.id))["encounter"] == ("skipped", "unit_unmapped")
    await map_unit(db_session, ward)
    later = NOW + REACH + timedelta(days=1)                                   # 15 Nov 12:00 UTC: out of reach
    await db_session.execute(text("UPDATE tres_settings SET retried_at = :t"), {"t": later - timedelta(hours=1)})
    await db_session.commit()                                                 # tonight's retry has run
    await _round(db_session, fake, audit, now=later)                          # the rounds no longer reach it
    assert fake.stored("Encounter") == []
    await _round(db_session, fake, audit, now=later + timedelta(hours=12, minutes=5))    # 16 Nov 04:05 Baku
    assert len(fake.stored("Encounter")) == 1


@requires_db
async def test_a_validate_night_does_not_rebuild_the_stays_left_no_reference(db_session):
    """Batch-4 review: in `validate` an Encounter `no_reference` is what every stay of a tenant that never
    sent has; the night takes only `stuck`, `failed` and `pending` rows."""
    ward, fake = await _world(db_session)
    admission = await add_stay(db_session, ward)
    await map_unit(db_session, ward)
    await identify(db_session, ward)
    await feed_settings(db_session, ward, fake, mode="validate",
                        retried_at=datetime(2026, 11, 7, 1, 0, tzinfo=timezone.utc))
    audit = InMemoryAuditLog()
    await _round(db_session, fake, audit)
    assert (await _rows_of(db_session, admission.id))["encounter"] == ("skipped", "no_reference")
    asked = list(fake.requests)
    await _round(db_session, fake, audit, now=NOW + REACH + timedelta(hours=12, minutes=5))   # a night, out of reach
    assert fake.requests == asked


@requires_db
async def test_the_window_is_keyed_on_the_discharge_or_the_rows_last_change_and_the_cut_off_on_the_discharge(
        db_session):
    """Batch-4 review: a discharge confirmed (or backdated) long after its `discharge_at`, or a later
    edit, brings the stay within reach — the row's `updated_at` (bumped by `transition_to`) counts as
    its discharge for the window, and the wait runs from it; the cut-off stays on `discharge_at`."""
    ward, fake = await _world(db_session)
    upper = NOW - timedelta(hours=24)
    long_ago = NOW - timedelta(days=20)
    confirmed_late = await add_stay(db_session, ward, admitted_at=long_ago - timedelta(days=2), discharged_at=long_ago,
                                    updated_at=NOW - timedelta(days=2))
    await add_stay(db_session, ward, protocol_no="202600000102", number="H2600102", bed="2",
                   admitted_at=long_ago - timedelta(days=2), discharged_at=long_ago)          # untouched since
    await add_stay(db_session, ward, protocol_no="202600000103", number="H2600103", bed="3",
                   admitted_at=NOW - timedelta(days=5), discharged_at=NOW - timedelta(days=3),
                   updated_at=NOW - timedelta(hours=1))                                     # its wait not over
    settings = await feed_settings(db_session, ward, fake, send_from=NOW - timedelta(days=30),
                                   reached_to=upper - timedelta(minutes=5))
    assert await due_stays(db_session, settings, NOW) == [confirmed_late.id]
    settings.send_from = long_ago + timedelta(minutes=1)                     # the cut-off: on the discharge
    assert await due_stays(db_session, settings, NOW) == []


# ---------------------------------------------------------------- the re-review of the fixes (Postgres)
#: source.NIGHT_REACH, as the re-review set it (the tests use the value; one asserts the constant).
NINETY = timedelta(days=90)
#: 04:05 in Baku on 9 Nov: a night whose retry has not run (the tenants below last ran it on 7 Nov).
NIGHT = datetime(2026, 11, 9, 0, 5, tzinfo=timezone.utc)
RAN = datetime(2026, 11, 7, 1, 0, tzinfo=timezone.utc)


async def _transfer_chain(db_session, ward, **last):
    """A stay of two admissions: the first TRANSFERRED (no protocol number, no discharge), the last
    the arriving row of the same person — DISCHARGED at DISCHARGED unless `last` says otherwise."""
    first = await add_stay(db_session, ward, protocol_no=None, state=AdmissionState.TRANSFERRED, discharged_at=None)
    person = await db_session.get(Patient, first.patient_id)
    arrived = await add_stay(db_session, ward, source=first, patient=person, bed="2",
                             **{"admitted_at": DISCHARGED - timedelta(days=1), **last})
    return first, arrived


@requires_db
async def test_the_night_judges_the_cut_off_on_the_stays_last_admission_and_a_hand_is_exempt(db_session):
    """Re-review (the reviewer's repro, inverted): a hand ran the stay while its first admission was the
    last, so its rows are keyed to it; the patient was then transferred and discharged before `send_from`.
    The night resolves the row to its stay's LAST admission and judges the cut-off there — it sends
    nothing. The nightly package judges it again once it has read the stay; «Yeniden dene» (the same
    forced package, from a person's hand) is not held by the cut-off."""
    ward, fake = await _world(db_session)
    first, _last = await _transfer_chain(db_session, ward)
    first_id = first.id
    await map_unit(db_session, ward)
    await identify(db_session, ward)
    settings = await feed_settings(db_session, ward, fake, send_from=DISCHARGED + timedelta(days=2), retried_at=RAN)
    # What a validate-mode «Şimdi gönder» on the open first admission left (O14: no platform id → no_reference).
    db_session.add(TresDelivery(tenant_id=ward.tenant.id, environment="test", resource_type="encounter",
                                local_id=ids.encounter(first_id), status="skipped", reason="no_reference",
                                admission_id=first_id))
    await db_session.commit()
    audit = InMemoryAuditLog()
    await _round(db_session, fake, audit, now=NIGHT)
    assert fake.stored("Patient") == [] and fake.stored("Encounter") == []
    assert await retry_stays(db_session, settings, NIGHT) == []
    hand, client = _hand(db_session, fake, ward)
    outcome = await _source(audit, NIGHT).package(db_session, settings, first_id, force=True, nightly=True)(hand)
    assert outcome.rows == [] and fake.requests == []                         # read, judged, nothing asked
    await _source(audit, NIGHT).package(db_session, settings, first_id, force=True)(hand)   # «Yeniden dene»
    assert len(fake.stored("Encounter")) == 1
    await client.aclose()


@requires_db
async def test_a_stay_whose_rows_sit_on_two_of_its_admissions_is_one_stay_to_the_night(db_session):
    """Re-review: the night's candidates are resolved to their stay's last admission BEFORE they are
    deduplicated — the key the due set uses — so a chain with an unfinished row on each of two of its
    admissions is rebuilt once, and once only though it is also due (A8)."""
    ward, fake = await _world(db_session)
    first, last = await _transfer_chain(db_session, ward, discharged_at=DISCHARGED)      # due at NOW
    first_id, last_id = first.id, last.id
    await map_unit(db_session, ward)
    await identify(db_session, ward)
    settings = await feed_settings(db_session, ward, fake)                  # never retried: NOW is 16:00 in Baku
    db_session.add_all([
        TresDelivery(tenant_id=ward.tenant.id, environment="test", resource_type="practitioner",
                     local_id="hmn-pr-takili.", status="stuck", attempts=5, admission_id=first_id),
        TresDelivery(tenant_id=ward.tenant.id, environment="test", resource_type="vital",
                     local_id="hmn-v-takili.", status="failed", attempts=1, admission_id=last_id)])
    await db_session.commit()
    report = await _round(db_session, fake, InMemoryAuditLog())
    assert (report.packages, report.failed) == (1, 0) and len(fake.stored("Encounter")) == 1
    assert await retry_stays(db_session, settings, NOW) == [last_id]


@requires_db
async def test_the_night_reaches_back_ninety_days_and_an_older_stay_goes_by_hand(db_session):
    """Re-review: the night takes a stay only while its window key — `greatest(discharge_at, updated_at)`
    of its last admission, which for a stay still admitted is that row's last change — is within
    NIGHT_REACH (90 days) of now. A stay that can never be sent (a newborn or a foreign national with no
    FİN, common in a NICU) would otherwise be rebuilt every night for ever. An older stay keeps its rows
    in the ledger and goes by «Yeniden dene»."""
    ward, fake = await _world(db_session)
    long_ago = NIGHT - NINETY
    inside = await add_stay(db_session, ward, protocol_no="202600000301", number="H2600301", fin="CD34E5F",
                            admitted_at=long_ago - timedelta(days=2), discharged_at=long_ago + timedelta(hours=1))
    outside = await add_stay(db_session, ward, protocol_no="202600000302", number="H2600302", fin="EF56G7H", bed="2",
                             admitted_at=long_ago - timedelta(days=2), discharged_at=long_ago - timedelta(hours=1))
    still_in = await add_stay(db_session, ward, protocol_no="202600000303", number="H2600303", fin="GH78J9K", bed="3",
                              state=AdmissionState.ACTIVE, admitted_at=NIGHT - timedelta(days=10))
    long_in = await add_stay(db_session, ward, protocol_no="202600000304", number="H2600304", fin="JK90L1M",
                             bed="10", state=AdmissionState.ACTIVE, admitted_at=long_ago - timedelta(days=10))
    ids_ = {name: stay_.id for name, stay_ in
            (("inside", inside), ("outside", outside), ("still_in", still_in), ("long_in", long_in))}
    await identify(db_session, ward)
    settings = await feed_settings(db_session, ward, fake, retried_at=RAN)
    for admission_id in ids_.values():                                   # each skipped while its unit was unmapped
        db_session.add(TresDelivery(tenant_id=ward.tenant.id, environment="test", resource_type="encounter",
                                    local_id=ids.encounter(admission_id), status="skipped", reason="unit_unmapped",
                                    admission_id=admission_id))
    await db_session.commit()
    await map_unit(db_session, ward)                                      # mapped since
    audit = InMemoryAuditLog()
    await _round(db_session, fake, audit, now=NIGHT)
    encounters = {name: (await _rows_of(db_session, admission_id))["encounter"] for name, admission_id in ids_.items()}
    assert encounters == {"inside": ("sent", None), "still_in": ("sent", None),
                          "outside": ("skipped", "unit_unmapped"), "long_in": ("skipped", "unit_unmapped")}
    assert await retry_stays(db_session, settings, NIGHT) == []           # the two left are past the night's reach
    assert ids_["outside"] in await retry_stays(db_session, settings, NIGHT - timedelta(days=1))
    hand, client = _hand(db_session, fake, ward)
    await _source(audit, NIGHT).package(db_session, settings, ids_["outside"], force=True)(hand)   # «Yeniden dene»
    assert (await _rows_of(db_session, ids_["outside"]))["encounter"] == ("sent", None)
    await client.aclose()
    assert source.NIGHT_REACH == NINETY


async def _encounter_row(db_session) -> TresDelivery:
    return (await db_session.execute(select(TresDelivery).where(TresDelivery.resource_type == "encounter")
                                     .execution_options(populate_existing=True))).scalar_one()


@requires_db
async def test_a_person_whose_fin_is_cleared_never_relabels_the_encounter_the_platform_holds(db_session):
    """Re-review (the reviewer's repro, inverted): a stay sent whole; its person's FİN is then removed (a
    correction) while the stay is within reach. The next round stops at the Patient's placeholder and
    leaves the Encounter row the platform holds as it is — `sent`, its id: `patient_unheld` is written only
    where the platform holds nothing (`keep_held`). The night does not take the stay for it."""
    ward, fake = await _world(db_session)
    admission = await add_stay(db_session, ward)
    admission_id = admission.id
    await map_unit(db_session, ward)
    await identify(db_session, ward)
    settings = await feed_settings(db_session, ward, fake)
    audit = InMemoryAuditLog()
    await _round(db_session, fake, audit)
    row = await _encounter_row(db_session)
    held_id = row.remote_id
    assert row.status == "sent" and held_id
    person = await db_session.get(Patient, admission.patient_id)
    person.national_id = None
    await db_session.commit()
    await _round(db_session, fake, audit, now=NOW + timedelta(minutes=5))
    row = await _encounter_row(db_session)
    assert (row.status, row.reason, row.remote_id) == ("sent", None, held_id)
    assert len(fake.stored("Encounter")) == 1
    assert admission_id not in await retry_stays(db_session, settings, NOW + timedelta(minutes=5))


# ---------------------------------------------------------------- the final review (Postgres)
@requires_db
async def test_an_encounter_the_platform_holds_keeps_its_row_when_its_unit_is_unmapped_since(db_session):
    """Final review (2026-11-13): the Encounter's own skips (`unit_unmapped`, `organization_missing`,
    `timezone_unknown`, `discharge_missing`) are written with `keep_held`, as `patient_unheld` is
    (amendment 27). A stay sent whole whose unit's mapping is then cleared, within its week: the next round
    stops at the Encounter and leaves the row the platform holds as it is — `sent`, its id — and the night
    does not take the stay for it."""
    ward, fake = await _world(db_session)
    admission = await add_stay(db_session, ward)
    admission_id = admission.id
    await map_unit(db_session, ward)
    await identify(db_session, ward)
    settings = await feed_settings(db_session, ward, fake)
    audit = InMemoryAuditLog()
    await _round(db_session, fake, audit)
    row = await _encounter_row(db_session)
    held_id = row.remote_id
    assert row.status == "sent" and held_id
    await db_session.execute(delete(TresDepartmentMap))
    await db_session.commit()
    asked = len(fake.requests)
    await _round(db_session, fake, audit, now=NOW + timedelta(minutes=5))
    row = await _encounter_row(db_session)
    assert (row.status, row.reason, row.remote_id) == ("sent", None, held_id)
    assert len(fake.stored("Encounter")) == 1 and len(fake.requests) == asked     # D7: nothing changed was asked
    assert admission_id not in await retry_stays(db_session, settings, NOW + timedelta(minutes=5))


def _breaks(*_args, **_kwargs):
    raise RuntimeError("Sentetikova Leyla")          # words that must reach neither the row nor a log line


@requires_db
@pytest.mark.parametrize("module, name", [("package", "map_encounter"), ("source", "readings_of")])
async def test_a_package_that_raises_leaves_its_stay_failed_with_package_error_and_the_night_retries_it(
        db_session, monkeypatch, caplog, module, name):
    """Final review (2026-11-13): a stay whose package raises what nothing else handles — a mapper, or the
    read of the stay itself — never drops out silently. Its Encounter row (`ids.encounter(root)`, keyed to
    the stay's last admission) reads `failed` with the catalogue reason `package_error`, one attempt counted
    and the 30-minute wait set as for a counted refusal, no words of the exception; the round goes on to its
    end (the reach advances); and the night, which takes `failed` rows, sends the stay once the cause is gone
    — after its week, where no round reaches it."""
    ward, fake = await _world(db_session)
    admission = await add_stay(db_session, ward)
    admission_id = admission.id
    await map_unit(db_session, ward)
    await identify(db_session, ward)
    settings = await feed_settings(db_session, ward, fake)
    audit = InMemoryAuditLog()
    monkeypatch.setattr({"package": tres_package, "source": source}[module], name, _breaks)
    with caplog.at_level("ERROR"):
        report = await _round(db_session, fake, audit)
    assert (report.packages, report.failed) == (0, 1)
    assert await _reached(db_session) == NOW - timedelta(hours=24)              # the round ran to its end
    row = await _encounter_row(db_session)
    assert (row.status, row.reason, row.attempts, row.remote_id, row.last_error) == (
        "failed", "package_error", 1, None, None)
    assert (row.local_id, row.admission_id, row.next_attempt_at) == (ids.encounter(admission_id), admission_id,
                                                                     NOW + RETRY_AFTER)
    assert "RuntimeError" in caplog.text and "Sentetik" not in caplog.text
    assert fake.stored("Encounter") == [] and admission_id in await retry_stays(db_session, settings, NOW)
    monkeypatch.undo()
    later = NOW + REACH + timedelta(days=1)                                   # 15 Nov 12:00 UTC: out of reach
    await db_session.execute(text("UPDATE tres_settings SET retried_at = :t"), {"t": later - timedelta(hours=1)})
    await db_session.commit()                                                 # tonight's retry has run
    await _round(db_session, fake, audit, now=later)
    assert fake.stored("Encounter") == []                                     # the rounds no longer reach it
    await _round(db_session, fake, audit, now=later + timedelta(hours=12, minutes=5))    # 16 Nov 04:05 Baku
    assert len(fake.stored("Encounter")) == 1
    row = await _encounter_row(db_session)
    assert (row.status, row.reason, row.attempts) == ("sent", None, 0)


@requires_db
async def test_a_package_that_raises_never_relabels_an_encounter_the_platform_holds(db_session, monkeypatch):
    """Final review (2026-11-13): an Encounter the platform holds stays `sent` with its id (`keep_held`) when a
    later run of its stay raises; nothing else is written, and the night does not take the stay for it."""
    ward, fake = await _world(db_session)
    admission = await add_stay(db_session, ward)
    admission_id = admission.id
    await map_unit(db_session, ward)
    await identify(db_session, ward)
    settings = await feed_settings(db_session, ward, fake)
    audit = InMemoryAuditLog()
    await _round(db_session, fake, audit)
    held_id = (await _encounter_row(db_session)).remote_id
    assert held_id
    monkeypatch.setattr(tres_package, "map_encounter", _breaks)
    report = await _round(db_session, fake, audit, now=NOW + timedelta(minutes=5))
    assert report.failed == 1
    row = await _encounter_row(db_session)
    assert (row.status, row.reason, row.attempts, row.remote_id, row.next_attempt_at) == ("sent", None, 0, held_id, None)
    assert admission_id not in await retry_stays(db_session, settings, NOW + timedelta(minutes=5))


@requires_db
@pytest.mark.parametrize("raised", [TresError(503, "Sentetik"), LedgerBusy("encounter")])
async def test_an_outage_or_a_busy_row_is_not_a_package_error(db_session, monkeypatch, raised):
    """Final review (2026-11-13): what the round and the hand already handle — the platform's outage (an
    outage leaves the rows as they were), a row another sender holds — is not recorded as `package_error`."""
    ward, fake = await _world(db_session)
    admission = await add_stay(db_session, ward)
    admission_id = admission.id
    await map_unit(db_session, ward)
    await identify(db_session, ward)
    await feed_settings(db_session, ward, fake)

    def raise_it(*_args, **_kwargs):
        raise raised

    monkeypatch.setattr(tres_package, "map_encounter", raise_it)
    report = await _round(db_session, fake, InMemoryAuditLog())
    assert report.failed == 1
    rows = await _rows_of(db_session, admission_id)
    assert "encounter" not in rows and rows["patient"] == ("sent", None)

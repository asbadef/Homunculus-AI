# homunculus-engine/tests/test_tres_ledger.py
"""TRƏS-01 (spec D4, D6, D7, D21): the ledger against the stand-in (tests/fake_tres.py) — find,
then POST with the local id as the placeholder or PUT; the same payload never sent twice; a stale
platform id falling back to the search; `validate` storing nothing; a refusal about the resource
counted, kept (encrypted) and left alone for 30 minutes, `stuck` at the fifth; an outage (a 429, a
5xx, a dead line, no session) raised again and counted against no row; the environment in the key;
a skip with its reason. The digest, the clip and `due` need no database; the rest runs on
Postgres; so do two deliverers of one key at once, which take turns (one writer per key).
Synthetic tenant, synthetic people."""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker

from homunculus.admission.models import Admission, Patient
from homunculus.tenant.models import Bed, Room, Site, Tenant, Unit, UnitType
from homunculus.tres.client import LOCAL_ID_EXTENSION, TresClient, TresError, is_outage
from homunculus.tres.ledger import (
    ERROR_MAX_BYTES, ERROR_MAX_CHARS, HAND_LOCK_TIMEOUT_MS, MAX_ATTEMPTS, RETRY_AFTER, LedgerBusy, _row, clip_error,
    deliver, due, forget_skip, held, is_lock_timeout, newer_stay, payload_digest, record_skip,
)
from homunculus.tres.models import TresDelivery
from tests.conftest import requires_db
from tests.fake_tres import UNCHECKED_PROFILE, FakeTres

T0 = datetime(2026, 11, 11, 8, 0, tzinfo=timezone.utc)
LOCAL = "hmn-p-0001"


def patient(given: str = "Ayşe", local_id: str = LOCAL) -> dict:
    return {"resourceType": "Patient", "meta": {"profile": [UNCHECKED_PROFILE]},
            "extension": [{"url": LOCAL_ID_EXTENSION, "valueString": local_id}],
            "name": [{"family": "Sentetik", "given": [given]}]}


# ---------------------------------------------------------------- no database
def test_the_digest_ignores_the_id_and_the_key_order_and_sees_every_other_change():
    base = patient()
    assert payload_digest(base) == payload_digest({**base, "id": "7001"}) == payload_digest({**base, "id": LOCAL})
    assert payload_digest(base) == payload_digest(dict(reversed(list(base.items()))))
    assert payload_digest(base) != payload_digest(patient("Leyla"))
    assert payload_digest(base) != payload_digest({**base, "active": True})
    assert len(payload_digest(base)) == 64 and "Sentetik" not in payload_digest(base)


def test_the_newer_stay_is_the_later_admission_and_on_a_tie_the_larger_id():
    """Batch-3 review A1: the person's shared row belongs to their newest stay — deterministic, so two
    stays never both take it."""
    small, large = uuid.UUID(int=1), uuid.UUID(int=2)
    assert newer_stay((T0 + timedelta(days=1), small), (T0, large))         # later wins, whatever the ids
    assert not newer_stay((T0, large), (T0 + timedelta(days=1), small))
    assert newer_stay((T0, large), (T0, small)) and not newer_stay((T0, small), (T0, large))   # a tie: the larger id
    assert not newer_stay((T0, small), (T0, small))                         # the same stay is not newer


def test_a_message_is_clipped_to_500_characters_and_1000_bytes():
    assert clip_error("kısa") == "kısa" and clip_error("") == "" and clip_error(None) == ""
    assert len(clip_error("x" * 2000)) == ERROR_MAX_CHARS == 500
    wide = clip_error("ə" * 2000)                      # two bytes each
    assert len(wide) == 500 and len(wide.encode("utf-8")) == ERROR_MAX_BYTES == 1000
    emoji = clip_error("🩺" * 2000)                     # four bytes each: cut on a character boundary
    assert len(emoji.encode("utf-8")) == 1000 and emoji == "🩺" * 250


def test_an_unchanged_payload_is_due_unless_stuck_or_still_waiting():
    def row(status, wait=None):
        return TresDelivery(tenant_id=uuid.uuid4(), environment="test", resource_type="patient",
                            local_id=LOCAL, status=status, next_attempt_at=wait)

    assert due(row("pending"), T0) and due(row("sent"), T0) and due(row("skipped"), T0)
    assert not due(row("stuck"), T0)
    assert not due(row("failed", T0 + timedelta(minutes=1)), T0)
    assert due(row("failed", T0), T0) and due(row("failed", T0 - timedelta(minutes=1)), T0)
    assert due(row("failed"), T0)


# ---------------------------------------------------------------- Postgres
@pytest_asyncio.fixture
async def world(db_session):
    """A tenant, the stand-in and a client on it; `send(resource, **over)` delivers the patient."""
    tenant = Tenant(name="Sentetik TRƏS Hastanesi", slug="tres-hastane", country_code="AZ")
    db_session.add(tenant)
    await db_session.commit()
    fake = FakeTres()
    client = TresClient(fake.account, transport=fake.transport)

    async def send(resource: dict | None = None, **over) -> TresDelivery:
        values = {"tenant_id": tenant.id, "environment": "test", "mode": "send", "resource_type": "patient",
                  "fhir_type": "Patient", "local_id": LOCAL, "resource": resource or patient(), "now": T0, **over}
        return await deliver(db_session, client, **values)

    yield fake, send, tenant
    await client.aclose()


async def _rows(db_session) -> int:
    return (await db_session.execute(select(func.count()).select_from(TresDelivery))).scalar_one()


@requires_db
async def test_the_first_send_looks_the_local_id_up_and_posts_it_as_the_placeholder(world, db_session):
    fake, send, tenant = world
    row = await send()
    assert fake.fhir_requests == [("GET", "/fhir/Patient"), ("POST", "/fhir/Patient")]
    (stored,) = fake.stored("Patient")
    assert stored["id"] == row.remote_id == "7001" and stored["name"][0]["given"] == ["Ayşe"]
    assert (row.status, row.operation, row.attempts, row.last_error, row.next_attempt_at) == (
        "sent", "create", 0, None, None)
    assert row.payload_digest == payload_digest(patient())
    assert (row.tenant_id, row.environment, row.resource_type, row.local_id) == (tenant.id, "test", "patient", LOCAL)
    db_session.expire_all()
    (saved,) = (await db_session.execute(select(TresDelivery))).scalars()        # committed
    assert (saved.status, saved.remote_id) == ("sent", "7001")


@requires_db
async def test_the_same_payload_is_never_sent_twice_and_a_changed_one_is_put(world, db_session):
    fake, send, _ = world
    first = await send()
    again = await send()
    assert again.id == first.id and len(fake.fhir_requests) == 2          # nothing asked
    changed = await send(patient("Ayşe Nur"))
    assert fake.fhir_requests[2:] == [("PUT", "/fhir/Patient/7001")]      # the ledger's id is trusted
    assert (changed.status, changed.operation, changed.remote_id) == ("sent", "update", "7001")
    assert fake.resources["Patient"]["7001"]["name"][0]["given"] == ["Ayşe Nur"]
    assert await _rows(db_session) == 1


@requires_db
async def test_a_resource_the_platform_already_holds_is_found_and_put_never_posted_again(world):
    fake, send, _ = world
    fake.seed("Patient", "5005", patient("Eski"))          # the ledger was lost; the platform was not
    row = await send()
    assert fake.fhir_requests == [("GET", "/fhir/Patient"), ("PUT", "/fhir/Patient/5005")]
    assert (row.operation, row.remote_id) == ("update", "5005") and len(fake.stored("Patient")) == 1


@requires_db
async def test_a_stale_platform_id_falls_back_to_the_search_and_then_to_a_post(world):
    fake, send, _ = world
    await send()
    del fake.resources["Patient"]["7001"]                  # gone from the platform
    row = await send(patient("Ayşe Nur"))
    assert fake.fhir_requests[2:] == [("PUT", "/fhir/Patient/7001"), ("GET", "/fhir/Patient"),
                                      ("POST", "/fhir/Patient")]
    assert (row.status, row.operation, row.remote_id) == ("sent", "create", "7002")


@requires_db
async def test_validate_checks_and_stores_nothing_and_is_not_repeated_for_the_same_payload(world):
    fake, send, _ = world
    row = await send(mode="validate")
    assert fake.fhir_requests == [("POST", "/fhir/Patient/$validate")] and fake.stored("Patient") == []
    assert (row.status, row.operation, row.remote_id) == ("validated", "validate", None)
    await send(mode="validate")
    assert len(fake.fhir_requests) == 1
    sent = await send()                                    # the tenant moves to `send`
    assert (sent.status, sent.operation, sent.remote_id) == ("sent", "create", "7001")
    await send(mode="validate")                            # a sent payload is not validated again
    assert len(fake.fhir_requests) == 3 and sent.status == "sent"


@requires_db
async def test_a_refusal_is_counted_kept_encrypted_and_left_alone_for_thirty_minutes(world, db_session):
    fake, send, _ = world
    broken = {k: v for k, v in patient().items() if k != "meta"}
    row = await send(broken)
    assert (row.status, row.attempts, row.remote_id) == ("failed", 1, None)
    assert row.last_error == "meta.profile is required" and row.next_attempt_at == T0 + RETRY_AFTER
    stored = (await db_session.execute(text("SELECT last_error FROM tres_deliveries"))).scalar_one()
    assert stored.startswith("enc::v1::") and "profile" not in stored
    asked = len(fake.fhir_requests)
    await send(broken, now=T0 + timedelta(minutes=29))
    assert len(fake.fhir_requests) == asked                # still waiting
    row = await send(broken, now=T0 + timedelta(minutes=30))
    assert row.attempts == 2 and len(fake.fhir_requests) > asked


@requires_db
async def test_the_fifth_failure_is_stuck_until_forced_or_until_the_record_changes(world):
    fake, send, _ = world
    broken = {k: v for k, v in patient().items() if k != "meta"}
    for n in range(MAX_ATTEMPTS):
        row = await send(broken, now=T0 + n * RETRY_AFTER)
    assert (row.status, row.attempts) == ("stuck", 5)
    asked = len(fake.fhir_requests)
    await send(broken, now=T0 + timedelta(days=30))
    assert len(fake.fhir_requests) == asked                # stuck: not tried by a round
    row = await send(broken, now=T0 + timedelta(days=30), force=True)
    assert (row.status, row.attempts) == ("stuck", 6) and len(fake.fhir_requests) > asked
    row = await send(now=T0 + timedelta(days=30))          # the record was corrected
    assert (row.status, row.attempts, row.last_error, row.next_attempt_at) == ("sent", 0, None, None)


@requires_db
async def test_a_changed_record_is_tried_at_once_and_its_count_starts_again(world):
    fake, send, _ = world
    broken = {k: v for k, v in patient().items() if k != "meta"}
    await send(broken)
    await send(broken, now=T0 + RETRY_AFTER)
    other = {k: v for k, v in patient("Leyla").items() if k != "meta"}
    row = await send(other, now=T0 + RETRY_AFTER)          # no wait: the payload is another
    assert (row.status, row.attempts) == ("failed", 1)


@requires_db
async def test_a_429_is_raised_again_and_counts_against_no_resource(world, db_session):
    """O13, answered «no»: a 429 is the platform's state, not this resource's."""
    fake, send, _ = world
    fake.throttle(1, retry_after=120)
    with pytest.raises(TresError) as raised:
        await send()
    assert (raised.value.status, raised.value.retry_after) == (429, 120.0)
    (row,) = (await db_session.execute(                      # a brand-new row stays `pending`
        select(TresDelivery).execution_options(populate_existing=True))).scalars()
    assert (row.status, row.attempts, row.last_error, row.next_attempt_at, row.payload_digest) == (
        "pending", 0, None, None, None)
    row = await send(now=T0)                               # no wait: tried again at once
    assert (row.status, row.attempts) == ("sent", 0) and len(fake.fhir_requests) == 3


# What the platform answers every FHIR request with, the token route opening a session; or how the
# token route itself fails. Each is an outage: the round's business, never one resource's.
def _down(status: int | None):
    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/auth/token":
            return httpx.Response(200, json={"payload": {"sessionId": "S-1"}})
        if status is None:
            raise httpx.ConnectError("connection refused", request=request)
        return httpx.Response(status, headers={"Retry-After": "60"}, text="Service Unavailable")
    return handle


def _no_session(status: int):
    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/auth/token":
            return httpx.Response(status, json={"message": "Invalid credentials"})
        raise AssertionError("no FHIR request without a session")
    return handle


@requires_db
@pytest.mark.parametrize("handler", [_down(None), _down(429), _down(408), _down(302), _down(502), _down(503),
                                     _down(504), _no_session(401), _no_session(403), _no_session(503)],
                         ids=["no-answer", "429", "408", "302", "502", "503", "504", "token-401", "token-403",
                              "token-503"])
async def test_an_outage_is_raised_again_and_the_row_keeps_what_it_had(db_session, handler):
    tenant = Tenant(name="Sentetik TRƏS Hastanesi", slug="tres-hastane", country_code="AZ")
    db_session.add(tenant)
    await db_session.flush()
    earlier = T0 - timedelta(hours=1)
    # one resource that failed twice before (due again), one never seen
    db_session.add(TresDelivery(tenant_id=tenant.id, environment="test", resource_type="patient", local_id=LOCAL,
                                status="failed", attempts=2, payload_digest="a" * 64, last_error="Eski xəta",
                                next_attempt_at=earlier))
    await db_session.commit()
    client = TresClient(FakeTres().account, transport=httpx.MockTransport(handler))
    for local_id in (LOCAL, "hmn-p-0002"):
        with pytest.raises(TresError) as raised:
            await deliver(db_session, client, tenant_id=tenant.id, environment="test", mode="send",
                          resource_type="patient", fhir_type="Patient", local_id=local_id,
                          resource=patient(local_id=local_id), now=T0)
        assert is_outage(raised.value)
    db_session.expire_all()
    rows = {r.local_id: r for r in (await db_session.execute(select(TresDelivery))).scalars()}
    old, new = rows[LOCAL], rows["hmn-p-0002"]
    assert (old.status, old.attempts, old.payload_digest, old.last_error, old.next_attempt_at) == (
        "failed", 2, "a" * 64, "Eski xəta", earlier)
    assert (new.status, new.attempts, new.payload_digest, new.last_error, new.next_attempt_at) == (
        "pending", 0, None, None, None)
    await client.aclose()


@requires_db
@pytest.mark.parametrize("status", [400, 403, 404, 409, 422])
async def test_a_refusal_about_the_resource_is_counted(db_session, status):
    tenant = Tenant(name="Sentetik TRƏS Hastanesi", slug="tres-hastane", country_code="AZ")
    db_session.add(tenant)
    await db_session.commit()

    def refuse(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/auth/token":
            return httpx.Response(200, json={"payload": {"sessionId": "S-1"}})
        return httpx.Response(status, json={"issue": [{"severity": "error", "diagnostics": "Yanlış resurs"}]})

    client = TresClient(FakeTres().account, transport=httpx.MockTransport(refuse))
    row = await deliver(db_session, client, tenant_id=tenant.id, environment="test", mode="send",
                        resource_type="patient", fhir_type="Patient", local_id=LOCAL, resource=patient(), now=T0)
    assert (row.status, row.attempts, row.last_error, row.next_attempt_at) == (
        "failed", 1, "Yanlış resurs", T0 + RETRY_AFTER)
    await client.aclose()


@requires_db
async def test_a_sandbox_row_never_stands_for_live(world, db_session):
    fake, send, _ = world
    test_row = await send()
    live_row = await send(environment="live")              # (the stand-in plays both)
    assert test_row.id != live_row.id and await _rows(db_session) == 2
    assert {test_row.environment, live_row.environment} == {"test", "live"}


@requires_db
async def test_a_skip_is_a_row_with_its_reason_and_ends_when_the_resource_is_sent(world, db_session):
    fake, send, tenant = world
    key = {"tenant_id": tenant.id, "environment": "test", "resource_type": "patient", "local_id": LOCAL}
    row = await record_skip(db_session, **key, reason="fin_missing")
    assert (row.status, row.reason, row.attempts, row.remote_id) == ("skipped", "fin_missing", 0, None)
    again = await record_skip(db_session, **key, reason="fin_missing")
    assert again.id == row.id and await _rows(db_session) == 1 and fake.requests == []
    renamed = await record_skip(db_session, **key, reason="name_single")
    assert renamed.reason == "name_single"
    sent = await send()
    assert (sent.id, sent.status, sent.reason) == (row.id, "sent", None)


async def _admission(db_session, tenant: Tenant, label: str, at: datetime = T0) -> uuid.UUID:
    """One synthetic stay on its own bed, admitted `at`; only its id (and that time) matter here."""
    site = Site(tenant_id=tenant.id, name=f"Bina {label}")
    db_session.add(site)
    await db_session.flush()
    unit = Unit(site_id=site.id, name="Reanimasiya", unit_type=UnitType.ADULT_ICU)
    db_session.add(unit)
    await db_session.flush()
    room = Room(unit_id=unit.id, name="Otaq 1")
    db_session.add(room)
    await db_session.flush()
    bed = Bed(room_id=room.id, label=label)
    person = Patient(tenant_id=tenant.id, display_name="Sentetik Ayşe", date_of_birth="1980-01-01",
                     sex="female", patient_number=f"H260000{label}")
    db_session.add_all([bed, person])
    await db_session.flush()
    admission = Admission(patient_id=person.id, tenant_id=tenant.id, admission_datetime=at,
                          admitting_unit_id=unit.id, bed_id=bed.id,
                          admission_diagnosis_free_text="Sentetik tanı")
    db_session.add(admission)
    await db_session.commit()
    return admission.id


@requires_db
async def test_the_row_carries_the_admission_it_was_last_sent_for(world, db_session):
    fake, send, tenant = world
    first, second = await _admission(db_session, tenant, "1"), await _admission(db_session, tenant, "2")
    row = await send(admission_id=first)
    assert row.admission_id == first
    row = await send(admission_id=second)                  # the same person, a later stay: nothing asked
    assert row.admission_id == second and len(fake.fhir_requests) == 2
    row = await send()                                     # a caller that names no stay changes nothing
    assert row.admission_id == second
    db_session.expire_all()
    (saved,) = (await db_session.execute(select(TresDelivery))).scalars()
    assert saved.admission_id == second


@requires_db
async def test_an_older_stays_skip_never_takes_a_newer_stays_row_though_its_send_may(world, db_session):
    """Re-review: the person's shared row is held for their newer stay, whose Patient the platform refused
    (no platform id). The older stay's SKIP (its own patient row lacks a field) leaves the row exactly as
    it is — the older stay's stop is on its own Encounter (`patient_unheld`) — so the newer stay's
    refusals count on towards `stuck` instead of starting again every night; a SEND by the older stay
    still takes the unheld row (amendment 26, 2)."""
    fake, send, tenant = world
    older = await _admission(db_session, tenant, "1")
    newer = await _admission(db_session, tenant, "2", at=T0 + timedelta(days=3))

    def refuse(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/auth/token":
            return httpx.Response(200, json={"payload": {"sessionId": "S-1"}})
        return httpx.Response(400, json={"issue": [{"severity": "error", "diagnostics": "Sentetik ret"}]})

    refusing = TresClient(fake.account, transport=httpx.MockTransport(refuse))
    key = {"tenant_id": tenant.id, "environment": "test", "resource_type": "patient", "local_id": LOCAL}
    newer_send = {**key, "mode": "send", "fhir_type": "Patient", "resource": patient(), "now": T0,
                  "admission_id": newer, "shared": True, "force": True}

    async def stored() -> TresDelivery:
        return (await db_session.execute(select(TresDelivery).execution_options(populate_existing=True))).scalar_one()

    await deliver(db_session, refusing, **newer_send)
    skipped = await record_skip(db_session, **key, reason="father_name_missing", admission_id=older, shared=True)
    assert skipped.yielded
    row = await stored()
    assert (row.status, row.reason, row.attempts, row.remote_id, row.admission_id) == ("failed", None, 1, None, newer)
    await deliver(db_session, refusing, **newer_send)
    assert ((await stored()).status, (await stored()).attempts) == ("failed", 2)     # counted on, not started again
    row = await send(patient("Leyla"), admission_id=older, shared=True)     # the older stay's own version, SENT
    assert (row.yielded, row.status, row.admission_id) == (False, "sent", older)    # takes the unheld row
    await refusing.aclose()


@requires_db
async def test_the_mode_off_never_reaches_the_ledger(world):
    fake, send, _ = world
    with pytest.raises(ValueError):
        await send(mode="off")
    assert fake.requests == []


# ---------------------------------------------------------------- one writer per key (review #2)
@requires_db
@pytest.mark.parametrize("earlier", [None, "failed"], ids=["brand-new key", "a row that failed before"])
async def test_two_deliverers_of_one_key_take_turns_and_the_platform_holds_one_resource(db_session, earlier):
    """A round and «Şimdi gönder» (F1) on the same stay, at the same moment, each on its own session
    and its own client: the second waits for the first's commit, then reads its row — `sent`, the
    same digest — and asks nothing. Without the lock both looked the id up, found nothing, and both
    POSTed: two national records of one resource."""
    tenant = Tenant(name="Sentetik TRƏS Hastanesi", slug="tres-hastane", country_code="AZ")
    db_session.add(tenant)
    await db_session.flush()
    if earlier is not None:
        db_session.add(TresDelivery(tenant_id=tenant.id, environment="test", resource_type="patient",
                                    local_id=LOCAL, status=earlier, attempts=1))
    await db_session.commit()
    tenant_id = tenant.id
    fake = FakeTres()
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)

    searching: list[int] = []
    both = asyncio.Event()
    start = asyncio.Barrier(2)

    async def platform(request: httpx.Request) -> httpx.Response:
        # The search answers what the platform holds now, then holds the answer until BOTH
        # deliverers have searched (or three seconds have passed): without one writer per key, both
        # hear «none» before either has posted. With it, the second never searches before the
        # first has committed, and the first goes on alone.
        answer = fake.transport.handler(request)
        if request.method == "GET" and request.url.path == "/fhir/Patient":
            searching.append(1)
            if len(searching) == 2:
                both.set()
            try:
                await asyncio.wait_for(both.wait(), timeout=3.0)
            except TimeoutError:
                pass
        return answer

    async def one() -> TresDelivery:
        client = TresClient(fake.account, transport=httpx.MockTransport(platform))
        try:
            async with maker() as db:
                await db.connection()            # each on its own connection before the start
                await start.wait()
                return await deliver(db, client, tenant_id=tenant_id, environment="test", mode="send",
                                     resource_type="patient", fhir_type="Patient", local_id=LOCAL,
                                     resource=patient(), now=T0)
        finally:
            await client.aclose()

    first, second = await asyncio.wait_for(asyncio.gather(one(), one()), timeout=60)
    (stored,) = fake.stored("Patient")
    assert first.remote_id == second.remote_id == stored["id"]
    assert [line for line in fake.fhir_requests if line[0] == "POST"] == [("POST", "/fhir/Patient")]
    rows = (await db_session.execute(
        select(TresDelivery).execution_options(populate_existing=True))).scalars().all()
    assert [(r.status, r.remote_id, r.attempts) for r in rows] == [("sent", stored["id"], 0)]


# ---------------------------------------------------------------- a search that proves nothing (review I1)
@requires_db
async def test_a_search_that_cannot_prove_an_absence_is_counted_and_nothing_is_posted(db_session):
    """The platform holds the Patient, but on its search's second page: never a second record of it.
    Counted against the resource — failed, the 30-minute wait, `stuck` at the fifth."""
    tenant = Tenant(name="Sentetik TRƏS Hastanesi", slug="tres-hastane", country_code="AZ")
    db_session.add(tenant)
    await db_session.commit()
    fake = FakeTres(page_size=2)
    for server_id, local_id in (("5001", "hmn-p-00010"), ("5002", "hmn-p-00011"), ("5003", LOCAL)):
        fake.seed("Patient", server_id, patient(local_id=local_id))
    client = TresClient(fake.account, transport=fake.transport)
    for n in range(5):
        row = await deliver(db_session, client, tenant_id=tenant.id, environment="test", mode="send",
                            resource_type="patient", fhir_type="Patient", local_id=LOCAL, resource=patient(),
                            now=T0 + n * RETRY_AFTER)
        if n == 0:
            assert (row.status, row.attempts, row.remote_id, row.next_attempt_at) == (
                "failed", 1, None, T0 + RETRY_AFTER)
            assert row.last_error == "the search answer has a next page"
    assert (row.status, row.attempts) == ("stuck", 5)
    assert [line for line in fake.fhir_requests if line[0] != "GET"] == []    # nothing POSTed, nothing PUT
    assert len(fake.stored("Patient")) == 3
    await client.aclose()


# ---------------------------------------------------------------- a 5xx about one resource (review I2)
@requires_db
@pytest.mark.parametrize("status", [500, 501, 505])
async def test_a_server_error_about_the_resource_is_counted_and_raised_for_the_rounds_five(db_session, status):
    """A platform that answers 500 to THIS input every time would otherwise hold the row forever and
    end every round before the stays behind it. Counted like a refusal, and raised again so that
    the round counts it towards its five in a row."""
    tenant = Tenant(name="Sentetik TRƏS Hastanesi", slug="tres-hastane", country_code="AZ")
    db_session.add(tenant)
    await db_session.commit()

    def internal(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/auth/token":
            return httpx.Response(200, json={"payload": {"sessionId": "S-1"}})
        return httpx.Response(status, json={"issue": [{"severity": "fatal", "diagnostics": "HAPI-0000: internal"}]})

    client = TresClient(FakeTres().account, transport=httpx.MockTransport(internal))
    with pytest.raises(TresError) as raised:
        await deliver(db_session, client, tenant_id=tenant.id, environment="test", mode="send",
                      resource_type="patient", fhir_type="Patient", local_id=LOCAL, resource=patient(), now=T0)
    assert raised.value.status == status and not is_outage(raised.value)
    (row,) = (await db_session.execute(
        select(TresDelivery).execution_options(populate_existing=True))).scalars()
    assert (row.status, row.attempts, row.last_error, row.next_attempt_at) == (
        "failed", 1, "HAPI-0000: internal", T0 + RETRY_AFTER)
    await client.aclose()


@requires_db
async def test_the_row_is_read_again_and_never_trusted_from_the_sessions_memory(db_session):
    """Review M5 — pins `populate_existing` in `_row`. The session already holds the row (it does
    not expire on commit), another connection changes it: `_row` must answer what is stored now,
    or the second deliverer of a key would act on what the first had before it."""
    tenant = Tenant(name="Sentetik TRƏS Hastanesi", slug="tres-hastane", country_code="AZ")
    db_session.add(tenant)
    await db_session.commit()
    key = {"tenant_id": tenant.id, "environment": "test", "resource_type": "patient", "local_id": LOCAL,
           "admission_id": None}
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)
    async with maker() as db:
        held = await _row(db, **key)
        await db.commit()
        assert (held.status, held.remote_id) == ("pending", None)
        async with maker() as other:
            await other.execute(text("UPDATE tres_deliveries SET status = 'sent', remote_id = '7999'"))
            await other.commit()
        again = await _row(db, **key)
        assert again is held and (again.status, again.remote_id) == ("sent", "7999")
        await db.commit()


# ---------------------------------------------------------------- a hand never waits for a round (plan F1, N12)
def test_a_lock_timeout_is_told_by_its_sqlstate():
    class Orig:
        def __init__(self, code):
            self.sqlstate = code

    class Wrapped(Exception):
        def __init__(self, code):
            self.orig = Orig(code)

    assert is_lock_timeout(Wrapped("55P03")) and not is_lock_timeout(Wrapped("23505"))
    assert not is_lock_timeout(RuntimeError("x")) and HAND_LOCK_TIMEOUT_MS == 2000


@requires_db
@pytest.mark.parametrize("committed", [True, False], ids=["a-row-a-round-holds", "a-row-a-round-is-inserting"])
async def test_a_deliverer_with_a_lock_timeout_answers_busy_and_writes_nothing(db_session, committed):
    """N12: a round holds the row (FOR UPDATE across its HTTP calls) — or has inserted it and not
    committed, which makes the INSERT … ON CONFLICT wait for its transaction (NOWAIT would not bound
    that wait). «Şimdi gönder» waits a moment, then is told the row is busy; nothing is asked."""
    tenant = Tenant(name="Sentetik TRƏS Hastanesi", slug="tres-hastane", country_code="AZ")
    db_session.add(tenant)
    await db_session.flush()
    if committed:
        db_session.add(TresDelivery(tenant_id=tenant.id, environment="test", resource_type="patient",
                                    local_id=LOCAL, status="failed", attempts=1))
    await db_session.commit()
    tenant_id = tenant.id
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)
    fake = FakeTres()
    client = TresClient(fake.account, transport=fake.transport)
    async with maker() as round_, maker() as hand:
        await _row(round_, tenant_id=tenant_id, environment="test", resource_type="patient", local_id=LOCAL,
                   admission_id=None)                                  # the round's lock, uncommitted
        with pytest.raises(LedgerBusy):
            await deliver(hand, client, tenant_id=tenant_id, environment="test", mode="send",
                          resource_type="patient", fhir_type="Patient", local_id=LOCAL, resource=patient(),
                          now=T0, lock_timeout_ms=200)
        with pytest.raises(LedgerBusy):
            await record_skip(hand, tenant_id=tenant_id, environment="test", resource_type="patient",
                              local_id=LOCAL, reason="fin_missing", lock_timeout_ms=200)
        assert fake.requests == []
        # Review M5: «writes nothing» is read from a third session — the row a round holds is
        # exactly what it was (a failed row, one attempt, no digest, no message), or no row at all.
        async with maker() as reader:
            seen = (await reader.execute(select(TresDelivery.status, TresDelivery.attempts, TresDelivery.payload_digest,
                                                TresDelivery.last_error, TresDelivery.reason))).all()
        assert [tuple(r) for r in seen] == ([("failed", 1, None, None, None)] if committed else [])
        await round_.commit()
        # the round is done: the same hand now goes through (its session is usable again)
        row = await deliver(hand, client, tenant_id=tenant_id, environment="test", mode="send",
                            resource_type="patient", fhir_type="Patient", local_id=LOCAL, resource=patient(),
                            now=T0, lock_timeout_ms=200, force=True)
        assert row.status == "sent"
    await client.aclose()


@requires_db
async def test_held_reads_the_platforms_id_and_forget_skip_removes_only_an_unheld_skip(world, db_session):
    fake, send, tenant = world
    assert await held(db_session, tenant_id=tenant.id, environment="test", resource_type="patient",
                      local_id=LOCAL) is None
    await send()
    assert await held(db_session, tenant_id=tenant.id, environment="test", resource_type="patient",
                      local_id=LOCAL) == "7001"
    await record_skip(db_session, tenant_id=tenant.id, environment="test", resource_type="patient",
                      local_id="hmn-p-s-1.", reason="fin_missing")
    for local_id in ("hmn-p-s-1.", LOCAL):                       # the sent row is never removed
        await forget_skip(db_session, tenant_id=tenant.id, environment="test", resource_type="patient",
                          local_id=local_id)
    db_session.expire_all()
    rows = (await db_session.execute(select(TresDelivery.local_id, TresDelivery.status))).all()
    assert [tuple(r) for r in rows] == [(LOCAL, "sent")]


# ---------------------------------------------------------------- the bound is on taking the row (review M3, M4)
async def _lock_timeout(db) -> str:
    return (await db.execute(text("SHOW lock_timeout"))).scalar_one()


class _Probe:
    """A client that only reports the transaction's `lock_timeout` at each call it is asked for —
    the window of a delivery in which the HTTP calls are made."""

    def __init__(self, db) -> None:
        self.db, self.seen = db, []

    async def find(self, fhir_type: str, local_id: str) -> None:
        self.seen.append(await _lock_timeout(self.db))

    async def create(self, fhir_type: str, resource: dict) -> str:
        self.seen.append(await _lock_timeout(self.db))
        return "7001"


@requires_db
async def test_the_lock_timeout_bounds_taking_the_row_and_nothing_after_it(db_session):
    """Review M3: `SET LOCAL lock_timeout` is for the wait on the row. Once the row is held it is
    put back to the default, so the rest of the delivery transaction — the write after the HTTP
    calls, which may take a minute — is not under the 2-second bound; and after the commit too."""
    tenant = Tenant(name="Sentetik TRƏS Hastanesi", slug="tres-hastane", country_code="AZ")
    db_session.add(tenant)
    await db_session.commit()
    default = await _lock_timeout(db_session)
    await db_session.commit()
    row = await _row(db_session, tenant_id=tenant.id, environment="test", resource_type="patient", local_id=LOCAL,
                     admission_id=None, lock_timeout_ms=HAND_LOCK_TIMEOUT_MS)
    assert await _lock_timeout(db_session) == default != "2s"      # the bound ended with taking the row
    assert row.status == "pending"
    await db_session.commit()
    assert await _lock_timeout(db_session) == default
    # the whole delivery of a person's request: at no call to the platform is the bound on
    probe = _Probe(db_session)
    delivered = await deliver(db_session, probe, tenant_id=tenant.id, environment="test", mode="send",
                              resource_type="patient", fhir_type="Patient", local_id=LOCAL, resource=patient(),
                              now=T0, lock_timeout_ms=HAND_LOCK_TIMEOUT_MS)
    assert delivered.status == "sent" and probe.seen == [default, default]
    assert await _lock_timeout(db_session) == default
    # a skip of a person's request, and a row that is skipped again unchanged
    await record_skip(db_session, tenant_id=tenant.id, environment="test", resource_type="patient",
                      local_id="hmn-p-s-1.", reason="fin_missing", lock_timeout_ms=HAND_LOCK_TIMEOUT_MS)
    assert await _lock_timeout(db_session) == default


@requires_db
async def test_forgetting_a_skip_for_a_person_is_under_the_same_bound_and_leaves_the_row_when_busy(db_session):
    """Review M4: `forget_skip` deletes a placeholder's row; a round holding that row (FOR UPDATE)
    must not make «Şimdi gönder» wait behind it. `LedgerBusy`, the row untouched, the session
    usable; afterwards the same call goes through and the bound is gone."""
    tenant = Tenant(name="Sentetik TRƏS Hastanesi", slug="tres-hastane", country_code="AZ")
    db_session.add(tenant)
    await db_session.flush()
    placeholder = "hmn-p-s-1."
    db_session.add(TresDelivery(tenant_id=tenant.id, environment="test", resource_type="patient",
                                local_id=placeholder, status="skipped", reason="fin_missing"))
    await db_session.commit()
    tenant_id = tenant.id
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)
    async with maker() as round_, maker() as hand, maker() as reader:
        default = await _lock_timeout(hand)
        await hand.commit()
        await _row(round_, tenant_id=tenant_id, environment="test", resource_type="patient", local_id=placeholder,
                   admission_id=None)                                  # the round's lock, uncommitted
        started = asyncio.get_running_loop().time()
        with pytest.raises(LedgerBusy):
            await forget_skip(hand, tenant_id=tenant_id, environment="test", resource_type="patient",
                              local_id=placeholder, lock_timeout_ms=200)
        assert asyncio.get_running_loop().time() - started < 5          # it did not wait for the round
        assert (await reader.execute(select(func.count()).select_from(TresDelivery))).scalar_one() == 1
        await reader.commit()
        await round_.commit()
        # the round is done: the same call now goes through, and leaves no bound behind
        await forget_skip(hand, tenant_id=tenant_id, environment="test", resource_type="patient",
                          local_id=placeholder, lock_timeout_ms=200)
        assert await _lock_timeout(hand) == default
        assert (await reader.execute(select(func.count()).select_from(TresDelivery))).scalar_one() == 0

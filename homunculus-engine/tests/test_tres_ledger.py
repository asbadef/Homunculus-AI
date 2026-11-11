# homunculus-engine/tests/test_tres_ledger.py
"""TRƏS-01 (spec D4, D6, D7, D21): the ledger against the stand-in (tests/fake_tres.py) — find,
then POST with the local id as the placeholder or PUT; the same payload never sent twice; a stale
platform id falling back to the search; `validate` storing nothing; a refusal about the resource
counted, kept (encrypted) and left alone for 30 minutes, `stuck` at the fifth; an outage (a 429, a
5xx, a dead line, no session) raised again and counted against no row; the environment in the key;
a skip with its reason. The digest, the clip and `due` need no database; the rest runs on
Postgres. Synthetic tenant, synthetic people."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import func, select, text

from homunculus.admission.models import Admission, Patient
from homunculus.tenant.models import Bed, Room, Site, Tenant, Unit, UnitType
from homunculus.tres.client import LOCAL_ID_EXTENSION, TresClient, TresError, is_outage
from homunculus.tres.ledger import (
    ERROR_MAX_BYTES, ERROR_MAX_CHARS, MAX_ATTEMPTS, RETRY_AFTER, clip_error, deliver, due,
    payload_digest, record_skip,
)
from homunculus.tres.models import TresDelivery
from tests.conftest import requires_db
from tests.fake_tres import FakeTres

T0 = datetime(2026, 11, 11, 8, 0, tzinfo=timezone.utc)
LOCAL = "hmn-p-0001"


def patient(given: str = "Ayşe", local_id: str = LOCAL) -> dict:
    return {"resourceType": "Patient", "meta": {"profile": ["http://fhir.az/StructureDefinition/az-patient"]},
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
@pytest.mark.parametrize("handler", [_down(None), _down(429), _down(500), _down(502), _down(503),
                                     _no_session(401), _no_session(403), _no_session(503)],
                         ids=["no-answer", "429", "500", "502", "503", "token-401", "token-403", "token-503"])
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
@pytest.mark.parametrize("status", [400, 404, 409, 422])
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


async def _admission(db_session, tenant: Tenant, label: str) -> uuid.UUID:
    """One synthetic stay on its own bed; only its id matters here."""
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
    admission = Admission(patient_id=person.id, tenant_id=tenant.id, admission_datetime=T0,
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
async def test_the_mode_off_never_reaches_the_ledger(world):
    fake, send, _ = world
    with pytest.raises(ValueError):
        await send(mode="off")
    assert fake.requests == []

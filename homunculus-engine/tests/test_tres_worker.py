# homunculus-engine/tests/test_tres_worker.py
"""TRƏS-01 (spec D2, D21): the rounds — with the install's lock closed nothing at all is touched
and no client is ever built; the loop is started by the lifespan only when the lock is open, waits
five minutes between rounds, survives a bad one and backs off after a 429; a round works only the
tenants whose mode is not `off` and whose account is whole, hands each package a `Sender`, spaces
the requests 300 ms apart, ends a tenant's round at once on a 429 or a refused session and after
five failures in a row (a 5xx, a dead line), and an outage counts against no ledger row; a
type the tenant switched off is skipped at the sender, and a tenant switched off or moved to
another environment during its round is sent no further package. The
lock, the loop and the lifespan need no database; the rounds run on Postgres against the stand-in
(tests/fake_tres.py). Synthetic tenants, synthetic people."""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker

from homunculus.api.app import create_app
from homunculus.tenant.models import Tenant
from homunculus.tres import worker
from homunculus.tres.client import LOCAL_ID_EXTENSION, TresAccount, TresClient
from homunculus.tres.egress import TresEgressRefused, open_client
from homunculus.tres.models import TresDelivery, TresSettings
from homunculus.tres.worker import (
    MAX_CONSECUTIVE, PACE_S, ROUND_S, THROTTLED_S, RoundReport, no_packages, run_round, tres_loop,
)
from tests.conftest import requires_db
from tests.fake_tres import FakeTres

T0 = datetime(2026, 11, 11, 8, 0, tzinfo=timezone.utc)
EARLIER = T0 - timedelta(hours=1)


def patient(local_id: str, given: str = "Ayşe") -> dict:
    return {"resourceType": "Patient", "meta": {"profile": ["http://fhir.az/StructureDefinition/az-patient"]},
            "extension": [{"url": LOCAL_ID_EXTENSION, "valueString": local_id}],
            "name": [{"family": "Sentetik", "given": [given]}]}


def sends(local_id: str):
    """A package of one resource."""
    async def package(sender) -> None:
        await sender.send(resource_type="patient", fhir_type="Patient", local_id=local_id,
                          resource=patient(local_id))
    return package


async def breaks(sender) -> None:
    raise RuntimeError("Sentetik Ayşe")          # a message that must never reach a log line


def source_of(*packages):
    async def source(db, settings):
        for package in packages:
            yield package
    return source


def never(*_args, **_kwargs):
    raise AssertionError("touched with the install's lock closed")


# ---------------------------------------------------------------- the lock (no database)
async def test_with_the_lock_closed_a_round_touches_nothing_and_builds_no_client(monkeypatch):
    built = []
    monkeypatch.setattr(httpx.AsyncClient, "__init__", lambda self, *a, **k: built.append(1))
    report = await run_round(never, egress=False, source=never, now=T0, client_factory=never, sleep=never)
    assert report == RoundReport() and built == []
    assert (report.tenants, report.incomplete, report.packages, report.failed, report.retry_after) == (
        0, 0, 0, 0, None)


async def test_phase_f0s_source_yields_nothing():
    assert [package async for package in no_packages(None, None)] == []


def test_the_lifespan_starts_the_rounds_only_when_the_lock_is_open(monkeypatch):
    monkeypatch.delenv("TRES_EGRESS", raising=False)
    closed = create_app({"t": "HOSP1"}, run_escalation_loop=False)
    with TestClient(closed):
        assert closed.state.tres_task is None
    monkeypatch.setenv("TRES_EGRESS", "on")
    opened = create_app({"t": "HOSP1"}, run_escalation_loop=False)
    assert opened.state.tres_source is no_packages
    # the rounds get the app's guarded factory (egress.open_client), never a bare TresClient
    with pytest.raises(TresEgressRefused):
        opened.state.tres_client_factory(TresAccount("https://tres.test", "sentetik", "gizli-parola", "PRV-0001"))
    with TestClient(opened):
        task = opened.state.tres_task
        assert task is not None and not task.done()      # asleep until the first round, 5 minutes on
    assert task.done()                                   # cancelled at shutdown


# ---------------------------------------------------------------- the loop (no database)
class Clock:
    """A sleep that only records, and ends the loop after `rounds` sleeps."""

    def __init__(self, rounds: int) -> None:
        self.sleeps: list[float] = []
        self._rounds = rounds

    async def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        if len(self.sleeps) > self._rounds:
            raise asyncio.CancelledError


async def test_the_loop_waits_five_minutes_survives_a_bad_round_and_backs_off_after_a_429(monkeypatch, caplog):
    answers = [RoundReport(tenants=1), RuntimeError("Sentetik Ayşe"), RoundReport(retry_after=1200.0),
               RoundReport(retry_after=30.0), RoundReport()]
    seen = []

    async def fake_round(session_factory, **kwargs):
        seen.append(kwargs)
        answer = answers[len(seen) - 1]
        if isinstance(answer, Exception):
            raise answer
        return answer

    monkeypatch.setattr(worker, "run_round", fake_round)
    clock = Clock(rounds=5)
    with pytest.raises(asyncio.CancelledError), caplog.at_level("ERROR"):
        await tres_loop(never, source=no_packages, client_factory=never, sleep=clock.sleep, clock=lambda: T0)
    # before the first round; after a good one; after the bad one; after 429 + 1200 s; after 429 + 30 s
    # (never less than a round); after a quiet one.
    assert clock.sleeps == [ROUND_S, ROUND_S, ROUND_S, 1200.0, ROUND_S, ROUND_S]
    assert len(seen) == 5 and all(k["egress"] is True and k["now"] == T0 for k in seen)
    assert "RuntimeError" in caplog.text and "Sentetik" not in caplog.text


# ---------------------------------------------------------------- the rounds (Postgres)
@pytest_asyncio.fixture
async def feed(db_session):
    """Three tenants — `off`, `validate` with half an account, `send` with a whole one — the
    stand-in, and `round_(source)`, which runs one round and answers (report, sleeps, clients)."""
    fake = FakeTres()
    whole = {"test_base_url": fake.account.base_url, "test_username": fake.account.username,
             "test_password": fake.account.password, "test_provider_id": fake.account.provider_id}
    tenants = {}
    for slug, mode, account in (("kapali", "off", whole), ("yarim", "validate", {**whole, "test_password": None}),
                                ("acik", "send", whole)):
        tenant = Tenant(name=f"Sentetik {slug}", slug=slug, country_code="AZ")
        db_session.add(tenant)
        await db_session.flush()
        db_session.add(TresSettings(tenant_id=tenant.id, mode=mode, environment="test", **account))
        tenants[slug] = tenant
    await db_session.commit()
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)

    async def round_(source, transport=None, now=T0):
        sleeps, clients = [], []

        async def sleep(seconds: float) -> None:
            sleeps.append(seconds)

        def factory(account):
            clients.append(TresClient(account, transport=transport or fake.transport))
            return clients[-1]

        report = await run_round(maker, egress=True, source=source, now=now, client_factory=factory, sleep=sleep)
        return report, sleeps, clients

    return fake, tenants, round_


@requires_db
async def test_a_round_works_only_the_tenants_that_are_on_and_whose_account_is_whole(feed, db_session):
    fake, tenants, round_ = feed
    asked = []

    async def source(db, settings):
        asked.append((settings.tenant_id, settings.mode))
        return
        yield

    report, sleeps, clients = await round_(source)
    assert (report.tenants, report.incomplete, report.packages, report.failed) == (1, 1, 0, 0)
    assert asked == [(tenants["acik"].id, "send")]
    assert [c.account for c in clients] == [fake.account]
    assert clients[0]._client is None                      # closed; and it never connected
    assert fake.requests == [] and sleeps == []


@requires_db
async def test_a_tenant_whose_address_the_install_does_not_allow_is_passed_over(feed, db_session, caplog):
    fake, tenants, _ = feed
    built = []

    def guarded(account):
        built.append(account)
        return open_client(account, egress=True, hosts=frozenset({"ehr-sandbox.e-health.gov.az"}))

    with caplog.at_level("WARNING"):
        report = await run_round(async_sessionmaker(db_session.bind, expire_on_commit=False), egress=True,
                                 source=source_of(sends("hmn-p-0001")), now=T0, client_factory=guarded)
    assert (report.tenants, report.incomplete, report.refused, report.packages) == (0, 1, 1, 0)
    assert [a.base_url for a in built] == ["https://tres.test"] and fake.requests == []
    assert "tres_host_not_allowed" in caplog.text and "tres.test" not in caplog.text


@requires_db
async def test_each_package_is_handed_a_sender_and_the_requests_are_spaced(feed, db_session):
    fake, tenants, round_ = feed
    report, sleeps, clients = await round_(source_of(sends("hmn-p-0001"), sends("hmn-p-0002")))
    assert (report.packages, report.failed, report.retry_after) == (2, 0, None)
    # token, then find + create for each of the two: five requests, four gaps.
    assert fake.requests == [("POST", "/auth/token"), ("GET", "/fhir/Patient"), ("POST", "/fhir/Patient"),
                             ("GET", "/fhir/Patient"), ("POST", "/fhir/Patient")]
    assert sleeps == [PACE_S] * 4 and PACE_S >= 0.3
    rows = (await db_session.execute(select(TresDelivery).order_by(TresDelivery.local_id))).scalars().all()
    assert [(r.tenant_id, r.environment, r.local_id, r.status, r.remote_id) for r in rows] == [
        (tenants["acik"].id, "test", "hmn-p-0001", "sent", "7001"),
        (tenants["acik"].id, "test", "hmn-p-0002", "sent", "7002")]
    assert clients[0]._client is None                      # closed at the end of the tenant's round


@requires_db
async def test_a_tenant_in_validate_mode_asks_only_for_validation(feed, db_session):
    fake, tenants, round_ = feed
    row = (await db_session.execute(select(TresSettings).where(
        TresSettings.tenant_id == tenants["acik"].id))).scalar_one()
    row.mode = "validate"
    await db_session.commit()
    report, _, _ = await round_(source_of(sends("hmn-p-0001")))
    assert report.packages == 1 and fake.fhir_requests == [("POST", "/fhir/Patient/$validate")]
    assert fake.stored("Patient") == []
    (saved,) = (await db_session.execute(select(TresDelivery))).scalars()
    assert (saved.status, saved.operation) == ("validated", "validate")


@requires_db
@pytest.mark.parametrize("said, waits", [(120, 120.0), (None, THROTTLED_S)])
async def test_a_429_ends_the_tenants_round_and_says_how_long_to_wait(feed, db_session, said, waits):
    fake, _, round_ = feed
    fake.throttle(1, retry_after=said)
    report, _, clients = await round_(source_of(sends("hmn-p-0001"), sends("hmn-p-0002")))
    assert (report.packages, report.failed, report.retry_after) == (0, 1, waits)
    assert fake.fhir_requests == [("GET", "/fhir/Patient")]          # the second package never ran
    (row,) = (await db_session.execute(select(TresDelivery))).scalars()
    assert (row.local_id, row.status, row.attempts) == ("hmn-p-0001", "pending", 0)   # counted against no row
    assert clients[0]._client is None


async def _failed_before(db_session, tenant_id, local_ids) -> None:
    """Rows that failed twice before and are due again: an outage must leave them exactly so."""
    for local_id in local_ids:
        db_session.add(TresDelivery(tenant_id=tenant_id, environment="test", resource_type="patient",
                                    local_id=local_id, status="failed", attempts=2, payload_digest="a" * 64,
                                    last_error="Eski xəta", next_attempt_at=EARLIER))
    await db_session.commit()


async def _ledger(db_session) -> set:
    db_session.expire_all()
    return {(r.local_id, r.status, r.attempts, r.payload_digest, r.last_error, r.next_attempt_at)
            for r in (await db_session.execute(select(TresDelivery))).scalars()}


@requires_db
async def test_a_wrong_password_asks_one_token_ends_the_round_and_touches_no_row(feed, db_session, caplog):
    """Review #1: the password was changed at the ministry. Twelve stays are due."""
    fake, tenants, round_ = feed
    settings = await db_session.get(TresSettings, tenants["acik"].id)
    settings.test_password = "degisdirilib-parola"
    await db_session.commit()
    local_ids = [f"hmn-p-{n:04d}" for n in range(12)]
    await _failed_before(db_session, tenants["acik"].id, local_ids)
    before = await _ledger(db_session)
    with caplog.at_level("WARNING"):
        report, _, clients = await round_(source_of(*[sends(local_id) for local_id in local_ids]))
    assert fake.requests == [("POST", "/auth/token")]                # ONE token request, no FHIR at all
    assert (report.packages, report.failed, report.retry_after) == (0, 1, None)
    assert await _ledger(db_session) == before                      # every row as it was
    assert "401" in caplog.text and "Invalid credentials" not in caplog.text
    assert clients[0]._client is None


@requires_db
@pytest.mark.parametrize("status", [503, 502, 504, 408, 302])
async def test_a_platform_answering_an_outage_ends_the_round_after_five_and_touches_no_row(feed, db_session,
                                                                                          status):
    fake, tenants, round_ = feed
    local_ids = [f"hmn-p-{n:04d}" for n in range(12)]
    await _failed_before(db_session, tenants["acik"].id, local_ids)
    before = await _ledger(db_session)

    def down(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/auth/token":
            return fake.transport.handler(request)                  # the session still opens
        return httpx.Response(status, text="Service Unavailable")

    report, _, _ = await round_(source_of(*[sends(local_id) for local_id in local_ids]),
                                transport=httpx.MockTransport(down))
    assert (report.packages, report.failed, report.retry_after) == (0, MAX_CONSECUTIVE, None)
    assert await _ledger(db_session) == before


@requires_db
async def test_a_refusal_about_one_resource_is_still_counted_and_the_round_goes_on(feed, db_session):
    fake, tenants, round_ = feed
    broken = {k: v for k, v in patient("hmn-p-0001").items() if k != "meta"}

    async def refused(sender) -> None:
        await sender.send(resource_type="patient", fhir_type="Patient", local_id="hmn-p-0001", resource=broken)

    report, _, _ = await round_(source_of(refused, sends("hmn-p-0002")))
    assert (report.packages, report.failed) == (2, 0)
    rows = (await db_session.execute(select(TresDelivery).order_by(TresDelivery.local_id))).scalars().all()
    assert [(r.local_id, r.status, r.attempts) for r in rows] == [("hmn-p-0001", "failed", 1),
                                                                  ("hmn-p-0002", "sent", 0)]


@requires_db
async def test_five_failures_in_a_row_end_the_round_and_a_success_starts_the_count_again(feed, caplog):
    fake, _, round_ = feed
    with caplog.at_level("WARNING"):
        report, _, _ = await round_(source_of(*[breaks] * 4, sends("hmn-p-0001"), *[breaks] * 7))
    assert MAX_CONSECUTIVE == 5
    assert (report.packages, report.failed) == (1, 4 + 5)            # the last two were never run
    assert "RuntimeError" in caplog.text and "Sentetik" not in caplog.text


@requires_db
async def test_a_sender_records_a_skip_and_a_refusal_is_a_row_not_an_exception(feed, db_session):
    fake, tenants, round_ = feed

    async def package(sender) -> None:
        await sender.skip(resource_type="patient", local_id="hmn-p-0001", reason="fin_missing")
        broken = {k: v for k, v in patient("hmn-p-0002").items() if k != "meta"}
        row = await sender.send(resource_type="patient", fhir_type="Patient", local_id="hmn-p-0002", resource=broken)
        assert (row.status, row.attempts) == ("failed", 1)           # the package goes on, or stops, as it likes

    report, _, _ = await round_(source_of(package))
    assert (report.packages, report.failed) == (1, 0)
    rows = (await db_session.execute(select(TresDelivery).order_by(TresDelivery.local_id))).scalars().all()
    assert [(r.local_id, r.status, r.reason) for r in rows] == [
        ("hmn-p-0001", "skipped", "fin_missing"), ("hmn-p-0002", "failed", None)]


@requires_db
async def test_a_dead_line_counts_as_a_failure_and_five_of_them_end_the_round(db_session):
    tenant = Tenant(name="Sentetik acik", slug="acik", country_code="AZ")
    db_session.add(tenant)
    await db_session.flush()
    db_session.add(TresSettings(tenant_id=tenant.id, mode="send", environment="test",
                                test_base_url="https://tres.test", test_username="sentetik",
                                test_password="gizli-parola", test_provider_id="PRV-0001"))
    await db_session.commit()

    def refuse(request):
        raise httpx.ConnectError("connection refused", request=request)

    async def quiet(seconds: float) -> None:
        return None

    report = await run_round(
        async_sessionmaker(db_session.bind, expire_on_commit=False), egress=True, now=T0, sleep=quiet,
        source=source_of(*[sends(f"hmn-p-{n:04d}") for n in range(8)]),
        client_factory=lambda account: TresClient(account, transport=httpx.MockTransport(refuse)))
    assert (report.packages, report.failed, report.retry_after) == (0, 5, None)
    rows = (await db_session.execute(select(TresDelivery))).scalars().all()
    # counted against the round, never against a row: five brand-new rows, still `pending`
    assert len(rows) == 5 and {(r.status, r.attempts, r.last_error) for r in rows} == {("pending", 0, None)}


# ---------------------------------------------------------------- the tenant's switches (review #5)
def practitioner(local_id: str) -> dict:
    return {"resourceType": "Practitioner", "meta": {"profile": ["http://fhir.az/StructureDefinition/az-practitioner"]},
            "extension": [{"url": LOCAL_ID_EXTENSION, "valueString": local_id}]}


@requires_db
async def test_a_type_switched_off_is_skipped_at_the_sender_and_never_asked_for(feed, db_session):
    fake, tenants, round_ = feed
    settings = await db_session.get(TresSettings, tenants["acik"].id)
    settings.enabled_types = ["patient"]
    await db_session.commit()

    async def package(sender) -> None:
        row = await sender.send(resource_type="practitioner", fhir_type="Practitioner", local_id="hmn-pr-0001",
                                resource=practitioner("hmn-pr-0001"))
        assert (row.status, row.reason) == ("skipped", "type_off")
        await sender.send(resource_type="patient", fhir_type="Patient", local_id="hmn-p-0001",
                          resource=patient("hmn-p-0001"))

    report, _, _ = await round_(source_of(package))
    assert report.packages == 1
    assert fake.fhir_requests == [("GET", "/fhir/Patient"), ("POST", "/fhir/Patient")]   # no Practitioner at all
    rows = (await db_session.execute(select(TresDelivery).order_by(TresDelivery.local_id))).scalars().all()
    assert [(r.local_id, r.status, r.reason) for r in rows] == [
        ("hmn-p-0001", "sent", None), ("hmn-pr-0001", "skipped", "type_off")]


async def _change_settings(maker, tenant_id, **values) -> None:
    """What an administrator's save does, from another session, while the round runs: the values,
    and a new `updated_at` (router.py writes one with every change)."""
    async with maker() as other:
        row = await other.get(TresSettings, tenant_id)
        for name, value in values.items():
            setattr(row, name, value)
        row.updated_at = datetime.now(timezone.utc)
        await other.commit()


@requires_db
@pytest.mark.parametrize("change", [{"mode": "off"}, {"environment": "live"}, {"mode": "validate"},
                                    {"test_username": "baska-hesap"}, {"settle_hours": 12}],
                         ids=["mode-off", "environment-live", "send-to-validate", "account", "any-saved-change"])
async def test_a_tenant_switched_off_or_moved_during_its_round_is_not_sent_another_package(feed, db_session, change):
    fake, tenants, round_ = feed
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)
    tenant_id = tenants["acik"].id

    async def then_switched(sender) -> None:
        await sends("hmn-p-0001")(sender)
        await _change_settings(maker, tenant_id, **change)

    report, _, _ = await round_(source_of(then_switched, sends("hmn-p-0002"), sends("hmn-p-0003")))
    assert (report.packages, report.failed) == (1, 0)
    assert fake.fhir_requests == [("GET", "/fhir/Patient"), ("POST", "/fhir/Patient")]   # the first package only


@requires_db
async def test_types_switched_during_a_round_end_it_and_the_next_round_applies_them(feed, db_session):
    """Review M8: one rule — any saved change ends the tenant's round; the next starts on it."""
    fake, tenants, round_ = feed
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)
    tenant_id = tenants["acik"].id

    async def then_patients_off(sender) -> None:
        await sends("hmn-p-0001")(sender)
        await _change_settings(maker, tenant_id, enabled_types=["practitioner"])

    report, _, _ = await round_(source_of(then_patients_off, sends("hmn-p-0002")))
    assert (report.packages, report.failed) == (1, 0)
    assert fake.fhir_requests == [("GET", "/fhir/Patient"), ("POST", "/fhir/Patient")]
    report, _, _ = await round_(source_of(sends("hmn-p-0002")))
    assert report.packages == 1
    assert fake.fhir_requests == [("GET", "/fhir/Patient"), ("POST", "/fhir/Patient")]
    rows = (await db_session.execute(select(TresDelivery).order_by(TresDelivery.local_id))).scalars().all()
    assert [(r.local_id, r.status, r.reason) for r in rows] == [
        ("hmn-p-0001", "sent", None), ("hmn-p-0002", "skipped", "type_off")]


@requires_db
async def test_one_tenants_failure_never_ends_the_round_for_the_others(feed, db_session, caplog):
    fake, tenants, round_ = feed
    other = Tenant(name="Sentetik ikinci", slug="ikinci", country_code="AZ")
    db_session.add(other)
    await db_session.flush()
    db_session.add(TresSettings(tenant_id=other.id, mode="send", environment="test",
                                test_base_url=fake.account.base_url, test_username=fake.account.username,
                                test_password=fake.account.password, test_provider_id=fake.account.provider_id))
    await db_session.commit()
    broken_id, other_id = tenants["acik"].id, other.id

    async def source(db, settings):
        if settings.tenant_id == broken_id:
            raise RuntimeError("Sentetik Ayşe")    # a message that must never reach a log line
        yield sends("hmn-p-0001")

    with caplog.at_level("ERROR"):
        report, _, clients = await round_(source)
    assert (report.tenants, report.packages, report.failed) == (2, 1, 1)
    rows = (await db_session.execute(select(TresDelivery))).scalars().all()
    assert [(r.tenant_id, r.status) for r in rows] == [(other_id, "sent")]
    assert "RuntimeError" in caplog.text and "Sentetik" not in caplog.text
    assert all(c._client is None for c in clients)


# ---------------------------------------------------------------- a 5xx about one resource (review I2)
@requires_db
async def test_five_resources_the_platform_always_answers_500_no_longer_hold_up_the_stays_behind_them(
        feed, db_session):
    """probe_poison: five resources first that the platform answers 500 to every time, seven healthy
    ones behind them. Each 500 is counted against its row AND towards the round's five in a row: the
    first round ends after the five; their rows then wait 30 minutes, so the next round sends the
    seven; the five reach `stuck` at their fifth attempt, two hours after the first."""
    fake, tenants, round_ = feed
    poison = {f"hmn-p-{n:04d}" for n in range(5)}
    order = [f"hmn-p-{n:04d}" for n in range(12)]

    def platform(request: httpx.Request) -> httpx.Response:
        if request.method == "POST" and request.url.path == "/fhir/Patient":
            local_id = json.loads(request.content)["extension"][0]["valueString"]
            if local_id in poison:
                return httpx.Response(500, json={"issue": [{"severity": "fatal", "diagnostics": "HAPI-0000"}]})
        return fake.transport.handler(request)

    async def rows():
        db_session.expire_all()
        return {r.local_id: (r.status, r.attempts) for r in (await db_session.execute(select(TresDelivery))).scalars()}

    source = source_of(*[sends(local_id) for local_id in order])
    report, _, _ = await round_(source, transport=httpx.MockTransport(platform), now=T0)
    assert (report.packages, report.failed) == (0, MAX_CONSECUTIVE)          # the round's five
    assert await rows() == {local_id: ("failed", 1) for local_id in sorted(poison)}
    report, _, _ = await round_(source, transport=httpx.MockTransport(platform), now=T0 + timedelta(minutes=5))
    assert (report.packages, report.failed) == (12, 0)                        # the five wait; the seven go
    assert len(fake.stored("Patient")) == 7
    for attempt in range(2, 6):                                                # every 30 minutes
        report, _, _ = await round_(source, transport=httpx.MockTransport(platform),
                                    now=T0 + (attempt - 1) * timedelta(minutes=30))
        assert report.failed == MAX_CONSECUTIVE
        state = await rows()
        assert {state[local_id] for local_id in poison} == {("stuck" if attempt == 5 else "failed", attempt)}
    assert {state[local_id] for local_id in set(order) - poison} == {("sent", 0)}
    report, _, _ = await round_(source, transport=httpx.MockTransport(platform), now=T0 + timedelta(hours=3))
    assert (report.packages, report.failed) == (12, 0)                        # stuck: left alone


# ---------------------------------------------------------------- a refused login parks the tenant (review I3)
async def _parking(db_session, tenant_id):
    row = (await db_session.execute(text("SELECT session_refused_at, updated_at FROM tres_settings "
                                         "WHERE tenant_id = :t"), {"t": tenant_id})).one()
    await db_session.commit()
    return tuple(row)


def _tokens(fake) -> int:
    return sum(1 for line in fake.requests if line == ("POST", "/auth/token"))


@requires_db
async def test_a_refused_login_parks_the_tenant_until_a_save_lets_it_try_again(feed, db_session, caplog):
    """A wrong password must not cost a failed login every five minutes (288 a day, and an account
    the ministry may lock): one login, then nothing until the administrator saves the tab."""
    fake, tenants, round_ = feed
    tenant_id = tenants["acik"].id
    settings = await db_session.get(TresSettings, tenant_id)
    settings.test_password = "degisdirilib-parola"
    await db_session.commit()
    (_, saved_at) = await _parking(db_session, tenant_id)
    with caplog.at_level("WARNING"):
        report, _, _ = await round_(source_of(sends("hmn-p-0001")))
    assert _tokens(fake) == 1 and report.failed == 1
    assert await _parking(db_session, tenant_id) == (T0, saved_at)            # parked; updated_at untouched
    (line,) = [r.getMessage() for r in caplog.records if str(tenant_id) in r.getMessage()]
    assert "401" in line and "Invalid credentials" not in line and "degisdirilib" not in line
    for _ in range(2):                                                         # rounds 2 and 3: nothing asked
        report, _, _ = await round_(source_of(sends("hmn-p-0001")))
        assert (report.tenants, report.parked) == (0, 1)
    assert _tokens(fake) == 1
    # the administrator corrects the password and saves (the route clears the parking): the next
    # round logs in again
    settings.test_password, settings.updated_at = fake.account.password, datetime.now(timezone.utc)
    await db_session.commit()
    await db_session.execute(text("UPDATE tres_settings SET session_refused_at = NULL WHERE tenant_id = :t"),
                             {"t": tenant_id})
    await db_session.commit()
    report, _, _ = await round_(source_of(sends("hmn-p-0001")))
    assert _tokens(fake) == 2 and (report.tenants, report.parked, report.packages) == (1, 0, 1)


@requires_db
async def test_a_token_route_that_is_down_parks_nothing(feed, db_session):
    fake, tenants, round_ = feed

    asked = []

    def down(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/auth/token":
            asked.append(request.url.path)
            return httpx.Response(503, text="")
        return fake.transport.handler(request)

    for n in (1, 2):                                       # every round asks again: the platform, not the account
        report, _, _ = await round_(source_of(sends("hmn-p-0001")), transport=httpx.MockTransport(down))
        assert (report.tenants, report.parked, report.failed) == (1, 0, 1) and len(asked) == n
        assert (await _parking(db_session, tenants["acik"].id))[0] is None


@requires_db
async def test_a_type_switched_off_never_overwrites_a_row_the_platform_holds(feed, db_session):
    """Review M7: the record stays as the platform has it — its id, its status; only a resource the
    platform does not hold is recorded as skipped."""
    fake, tenants, round_ = feed
    await round_(source_of(sends("hmn-p-0001")))
    settings = await db_session.get(TresSettings, tenants["acik"].id)
    settings.enabled_types = ["practitioner"]
    await db_session.commit()
    report, _, _ = await round_(source_of(sends("hmn-p-0001"), sends("hmn-p-0002")))
    assert report.packages == 2 and fake.fhir_requests == [("GET", "/fhir/Patient"), ("POST", "/fhir/Patient")]
    db_session.expire_all()
    rows = (await db_session.execute(select(TresDelivery).order_by(TresDelivery.local_id))).scalars().all()
    assert [(r.local_id, r.status, r.remote_id, r.reason) for r in rows] == [
        ("hmn-p-0001", "sent", "7001", None), ("hmn-p-0002", "skipped", None, "type_off")]

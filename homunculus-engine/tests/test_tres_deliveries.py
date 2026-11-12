# homunculus-engine/tests/test_tres_deliveries.py
"""Yönetim › TRƏS, the ledger and a person's hand on it (TRƏS-01, spec §6, D9, D21, D24, D25; plan F1,
N12, N14, N15, O21): the list (newest first, a page at a time, filtered, the stay's board key, no
platform words, a parked tenant said), a stay found by its key, its audited preview, «Şimdi gönder»
and «Yeniden dene» — each refused while a lock is closed, `busy` rather than waiting behind a
round, a refused login parking the tenant, an outage a 503, every attempt audited with its result
and counts. `tres.manage`, the caller's tenant only. Postgres (tests/kabul_world.py) against the
stand-in (tests/fake_tres.py). Synthetic ward, synthetic stays."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from functools import partial

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker

from homunculus.admission.models import AdmissionState
from homunculus.tenant.models import Tenant
from homunculus.tres import ids
from homunculus.tres.client import TresClient
from homunculus.tres.egress import open_client
from homunculus.tres.errors import WORDS
from homunculus.tres.ledger import _row
from homunculus.tres.models import TresDelivery
from homunculus.tres.worker import PACE_S, Pacer, run_round
from tests.conftest import requires_db
from tests.fake_tres import FakeTres
from tests.kabul_world import SLUG, build_ward, ward_client
from tests.test_tres_worker import sends, source_of
from tests.tres_world import (
    ADMITTED, BAKU, DISCHARGED, NOW, ORGANIZATION, add_stay, chart, feed_settings, identify, map_unit,
    other_tenants_stay,
)

LIST, FIND = "/admin/tres/deliveries", "/admin/tres/admissions"


@pytest_asyncio.fixture
async def desk(db_session, monkeypatch):
    """The ward with one discharged stay, mapped and identified, the tenant in `send` on the
    stand-in; the app's lock open and its client factory the stand-in's."""
    monkeypatch.delenv("TRES_EGRESS", raising=False)
    ward = await build_ward(db_session)
    fake = FakeTres()
    fake.seed("Organization", ORGANIZATION)
    stay = await add_stay(db_session, ward)
    await map_unit(db_session, ward)
    await identify(db_session, ward)
    await feed_settings(db_session, ward, fake)
    async with ward_client(db_session) as (client, app):
        app.state.tres_egress = True
        app.state.tres_client_factory = lambda account: TresClient(account, transport=fake.transport)
        app.state.tres_source.zone = lambda name: BAKU
        chart(app.state.audit, "202600000101", "heart_rate", 88.0, "/min", ADMITTED + timedelta(hours=1))
        yield ward, fake, stay, client, app


def _audit(app, event_type: str) -> list:
    return app.state.audit.records(tenant=SLUG, event_type=event_type, limit=50)


def _send(stay) -> str:
    return f"/admin/tres/admissions/{stay.id}/send"


# ---------------------------------------------------------------- «Şimdi gönder» (D9)
@requires_db
async def test_send_now_puts_the_stay_on_the_platform_and_is_audited_with_its_counts(desk):
    ward, fake, stay, client, app = desk
    r = await client.post(_send(stay), headers=ward.auth["admin"])
    assert r.status_code == 200, r.text
    answer = r.json()
    assert answer["admission_id"] == str(stay.id)
    assert answer["counts"] == {"patient": {"sent": 1}, "practitioner": {"sent": 1}, "encounter": {"sent": 1},
                                "vital": {"sent": 2}}
    assert [row["resource_type"] for row in answer["rows"]] == ["patient", "practitioner", "encounter", "vital", "vital"]
    assert "AB12C3D" not in r.text and "Sentetik" not in r.text                 # ids and statuses, no person
    assert len(fake.stored("Encounter")) == 1
    (row,) = _audit(app, "tres.send")
    assert row.patient_id == "202600000101"
    assert row.payload == {"actor": ward.users["admin"].username, "admission_id": str(stay.id), "result": "sent",
                           "counts": answer["counts"]}
    assert len(_audit(app, "tres.package")) == 1                                # the stay's first complete package


@requires_db
async def test_send_now_is_refused_while_a_lock_is_closed_and_asks_nothing(desk, db_session):
    ward, fake, stay, client, app = desk
    app.state.tres_egress = False
    r = await client.post(_send(stay), headers=ward.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "egress_off")
    app.state.tres_egress = True
    await db_session.execute(text("UPDATE tres_settings SET mode = 'off'"))
    await db_session.commit()
    r = await client.post(_send(stay), headers=ward.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "tres_off")
    await db_session.execute(text("UPDATE tres_settings SET mode = 'send', test_base_url = 'https://ehr.e-health.gov.az'"))
    await db_session.commit()
    r = await client.post(_send(stay), headers=ward.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "tres_live_closed")      # O5, O11
    await db_session.execute(text("UPDATE tres_settings SET test_base_url = 'https://tres.test', test_password = NULL"))
    await db_session.commit()
    r = await client.post(_send(stay), headers=ward.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "tres_account_incomplete")
    assert fake.requests == [] and _audit(app, "tres.send") == []


@requires_db
async def test_send_now_answers_busy_rather_than_wait_behind_a_round(desk, db_session):
    """N12: a round holds the stay's Patient row; the hand is told at once, and nothing is asked."""
    ward, fake, stay, client, app = desk
    async with async_sessionmaker(db_session.bind, expire_on_commit=False)() as round_:
        await _row(round_, tenant_id=ward.tenant.id, environment="test", resource_type="patient",
                   local_id=ids.patient("AB12C3D"), admission_id=stay.id)       # held, uncommitted
        started = datetime.now(timezone.utc)
        r = await client.post(_send(stay), headers=ward.auth["admin"])
        assert datetime.now(timezone.utc) - started < timedelta(seconds=30)
        await round_.rollback()
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "tres_busy")
    assert fake.fhir_requests == []
    assert _audit(app, "tres.send")[-1].payload["result"] == "tres_busy"


@requires_db
async def test_a_refused_login_parks_the_tenant_and_an_outage_is_a_503(desk, db_session):
    ward, fake, stay, client, app = desk
    await db_session.execute(text("UPDATE tres_settings SET test_password = :p"), {"p": "yanlis-parola"})
    await db_session.commit()
    r = await client.post(_send(stay), headers=ward.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "tres_login_refused")
    parked = (await db_session.execute(text("SELECT session_refused_at FROM tres_settings"))).scalar_one()
    assert parked is not None                                                    # as a round would (N15)
    await db_session.execute(text("UPDATE tres_settings SET test_password = :p, session_refused_at = NULL"),
                             {"p": fake.account.password})
    await db_session.commit()

    def down(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/auth/token":
            return fake.transport.handler(request)
        return httpx.Response(503, text="")

    app.state.tres_client_factory = lambda account: TresClient(account, transport=httpx.MockTransport(down))
    r = await client.post(_send(stay), headers=ward.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (503, "tres_platform_unavailable")
    assert [a.payload["result"] for a in _audit(app, "tres.send")] == ["tres_login_refused", "tres_platform_unavailable"]


# ---------------------------------------------------------------- «Yeniden dene» (D21, O21)
@requires_db
async def test_retry_forces_a_stuck_row_of_the_stay_and_is_audited(desk, db_session):
    ward, fake, stay, client, app = desk
    actor, stay_id = ward.users["admin"].username, stay.id                  # plain values: expire_all below
    await client.post(_send(stay), headers=ward.auth["admin"])
    vital = (await db_session.execute(select(TresDelivery).where(TresDelivery.resource_type == "vital")
                                      .order_by(TresDelivery.local_id).limit(1))).scalar_one()
    vital_id = vital.id
    await db_session.execute(text("UPDATE tres_deliveries SET status = 'stuck', attempts = 5, payload_digest = :d "
                                  "WHERE id = :id"), {"d": vital.payload_digest, "id": vital_id})
    await db_session.commit()
    r = await client.post(f"{LIST}/{vital_id}/retry", headers=ward.auth["admin"])
    assert r.status_code == 200, r.text
    db_session.expire_all()
    row = await db_session.get(TresDelivery, vital_id)
    assert (row.status, row.attempts) == ("sent", 0)                             # forced: tried, and taken
    (audit,) = _audit(app, "tres.retry")
    assert audit.payload == {"actor": actor, "delivery_id": str(vital_id),
                             "admission_id": str(stay_id), "result": "sent", "counts": r.json()["counts"]}
    r = await client.post(f"{LIST}/{uuid.uuid4()}/retry", headers=ward.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (404, "tres_stay_unknown")


# ---------------------------------------------------------------- the list (N15)
@requires_db
async def test_the_list_is_newest_first_with_the_board_key_and_no_platform_words(desk, db_session):
    ward, fake, stay, client, app = desk
    await client.post(_send(stay), headers=ward.auth["admin"])
    await db_session.execute(text("UPDATE tres_deliveries SET last_error = NULL"))
    await db_session.execute(text("UPDATE tres_settings SET session_refused_at = now()"))
    await db_session.commit()
    r = await client.get(LIST, headers=ward.auth["admin"])
    assert r.status_code == 200, r.text
    answer = r.json()
    assert answer["environment"] == "test" and answer["session_refused_at"] is not None and answer["next"] is None
    items = answer["items"]
    assert len(items) == 5 and {i["board_key"] for i in items} == {"202600000101"}
    assert [i["updated_at"] for i in items] == sorted((i["updated_at"] for i in items), reverse=True)
    assert all("last_error" not in i for i in items) and "AB12C3D" not in r.text
    only = (await client.get(LIST, params={"type": "vital", "status": "sent"}, headers=ward.auth["admin"])).json()
    assert [i["resource_type"] for i in only["items"]] == ["vital", "vital"]
    stay_rows = (await client.get(LIST, params={"admission": str(stay.id)}, headers=ward.auth["admin"])).json()
    assert len(stay_rows["items"]) == 5
    assert (await client.get(LIST, params={"environment": "live"}, headers=ward.auth["admin"])).json()["items"] == []
    for params, code in (({"status": "done"}, "tres_filter"), ({"type": "imaging"}, "tres_filter"),
                         ({"environment": "prod"}, "tres_filter"), ({"cursor": "not-a-cursor"}, "tres_cursor")):
        r = await client.get(LIST, params=params, headers=ward.auth["admin"])
        assert (r.status_code, r.json()["detail"]["code"]) == (422, code), params


@requires_db
async def test_the_list_pages_by_its_cursor(desk, db_session, monkeypatch):
    from homunculus.tres import deliveries
    monkeypatch.setattr(deliveries, "PAGE", 2)
    ward, fake, stay, client, app = desk
    await client.post(_send(stay), headers=ward.auth["admin"])
    seen, cursor = [], None
    while True:
        params = {"cursor": cursor} if cursor else {}
        page = (await client.get(LIST, params=params, headers=ward.auth["admin"])).json()
        seen += [i["id"] for i in page["items"]]
        cursor = page["next"]
        if cursor is None:
            break
    assert len(seen) == len(set(seen)) == 5


# ---------------------------------------------------------------- a stay by its key, its preview (D25)
@requires_db
async def test_a_stay_is_found_by_its_protocol_number(desk):
    ward, fake, stay, client, app = desk
    r = await client.get(FIND, params={"key": "202600000101"}, headers=ward.auth["admin"])
    assert r.status_code == 200, r.text
    assert r.json()["admission_id"] == str(stay.id) and r.json()["state"] == "DISCHARGED"
    r = await client.get(FIND, params={"key": "209900000001"}, headers=ward.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (404, "tres_stay_unknown")


@requires_db
async def test_the_preview_rebuilds_the_stay_writes_nothing_and_is_audited(desk, db_session):
    ward, fake, stay, client, app = desk
    app.state.tres_egress = False                                               # allowed with the locks closed
    await db_session.execute(text("UPDATE tres_settings SET mode = 'off'"))
    await db_session.commit()
    r = await client.get(f"/admin/tres/admissions/{stay.id}/preview", headers=ward.auth["admin"])
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert [(i["resource_type"], i["held"], i["status"]) for i in items] == [
        ("patient", False, None), ("practitioner", False, None), ("encounter", False, None), ("vital", False, None),
        ("vital", False, None)]
    assert items[0]["resource"]["identifier"][0]["value"] == "AB12C3D"         # the body itself: PHI, audited
    assert fake.requests == []
    assert (await db_session.execute(select(TresDelivery))).scalars().all() == []
    (row,) = _audit(app, "tres.preview")
    assert row.payload == {"actor": ward.users["admin"].username, "admission_id": str(stay.id)}


@requires_db
async def test_another_tenants_stay_and_rows_are_never_reached(desk, db_session):
    ward, fake, stay, client, app = desk
    other = Tenant(name="Sentetik Başka Hastane", slug="baska-hastane", country_code="AZ")
    db_session.add(other)
    await db_session.flush()
    db_session.add(TresDelivery(tenant_id=other.id, environment="test", resource_type="patient",
                                local_id="hmn-p-baska.", status="stuck"))
    await db_session.commit()
    foreign = (await db_session.execute(select(TresDelivery.id).where(TresDelivery.tenant_id == other.id))).scalar_one()
    assert (await client.get(LIST, headers=ward.auth["admin"])).json()["items"] == []
    r = await client.post(f"{LIST}/{foreign}/retry", headers=ward.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (404, "tres_stay_unknown")
    for who in ("nurse", "doctor", "auditor"):
        assert (await client.get(LIST, headers=ward.auth[who])).status_code == 403, who
        assert (await client.post(_send(stay), headers=ward.auth[who])).status_code == 403, who
        assert (await client.get(f"/admin/tres/admissions/{stay.id}/preview",
                                 headers=ward.auth[who])).status_code == 403, who


# ---------------------------------------------------------------- the Task-12 review
SENTINEL = "Sentetik-platform-sozu-0042"


def _preview(admission_id) -> str:
    return f"/admin/tres/admissions/{admission_id}/preview"


@requires_db
async def test_a_hand_send_is_paced_and_shares_the_tenants_pacer_with_the_rounds(desk, db_session):
    """I1 (spec D21, §13.1): requests at least PACE_S apart between ANY two of a tenant's. The hand's
    client is paced by the tenant's one pacer — the rounds' — so a round after it waits PACE_S before
    its very first request too: a hand during a round cannot double the rate."""
    ward, fake, stay, client, app = desk
    slept: list[float] = []

    async def sleep(seconds: float) -> None:
        slept.append(seconds)

    app.state.tres_pacers = {ward.tenant.id: Pacer(sleep)}
    r = await client.post(_send(stay), headers=ward.auth["admin"])
    assert r.status_code == 200, r.text
    hand = len(fake.requests)
    assert hand > 2 and slept == [PACE_S] * (hand - 1)
    round_slept: list[float] = []

    async def round_sleep(seconds: float) -> None:
        round_slept.append(seconds)

    report = await run_round(async_sessionmaker(db_session.bind, expire_on_commit=False), egress=True,
                             source=source_of(sends("hmn-p-ortak.")), now=NOW, sleep=round_sleep,
                             client_factory=lambda account: TresClient(account, transport=fake.transport),
                             pacers=app.state.tres_pacers)
    assert report.packages == 1 and len(fake.requests) == hand + 3       # a token, a search, a POST
    assert slept == [PACE_S] * (hand + 2) and round_slept == []          # the round's first request waited too


@requires_db
async def test_a_429_during_a_hand_is_its_own_refusal_with_the_platforms_wait(desk):
    """M1: not 503 — the panel says «the platform asks to wait», with how long when the platform said."""
    ward, fake, stay, client, app = desk
    fake.throttle(1, retry_after=600)
    r = await client.post(_send(stay), headers=ward.auth["admin"])
    assert r.status_code == 429, r.text
    assert r.json()["detail"] == {"code": "tres_throttled", "retry_after": 600, "message": WORDS["tres_throttled"]}
    fake.throttle(1)
    r = await client.post(_send(stay), headers=ward.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (429, "tres_throttled")
    assert "retry_after" not in r.json()["detail"]
    assert [a.payload["result"] for a in _audit(app, "tres.send")] == ["tres_throttled", "tres_throttled"]


@requires_db
async def test_a_parked_tenant_is_refused_by_hand_without_asking_the_platform(desk, db_session):
    """M2: each click would be one more failed login, and the ministry may lock the account. A refused
    precondition: nothing asked, no audit row."""
    ward, fake, stay, client, app = desk
    await db_session.execute(text("UPDATE tres_settings SET session_refused_at = now()"))
    await db_session.commit()
    r = await client.post(_send(stay), headers=ward.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "tres_login_refused")
    assert fake.requests == [] and _audit(app, "tres.send") == []


@requires_db
async def test_a_row_of_the_other_environment_is_never_retried_in_this_one_and_a_refused_retry_is_not_audited(
        desk, db_session):
    """M3: a live row is never sent to the test platform (nor the other way round): 409, nothing asked,
    the row as it was. Any refused precondition of «Yeniden dene» writes no audit row."""
    ward, fake, stay, client, app = desk
    db_session.add(TresDelivery(tenant_id=ward.tenant.id, environment="live", resource_type="vital",
                                local_id="hmn-v-baska-heart-rate-first.", status="stuck", attempts=5,
                                admission_id=stay.id))
    await db_session.commit()
    live = (await db_session.execute(select(TresDelivery.id).where(TresDelivery.environment == "live"))).scalar_one()
    r = await client.post(f"{LIST}/{live}/retry", headers=ward.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "tres_other_environment")
    row = (await db_session.execute(select(TresDelivery).where(TresDelivery.id == live)
                                    .execution_options(populate_existing=True))).scalar_one()
    assert (row.status, row.attempts) == ("stuck", 5)
    await client.post(_send(stay), headers=ward.auth["admin"])
    asked = list(fake.requests)
    test_row = (await db_session.execute(select(TresDelivery.id).where(TresDelivery.environment == "test")
                                         .limit(1))).scalar_one()
    app.state.tres_egress = False
    r = await client.post(f"{LIST}/{test_row}/retry", headers=ward.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "egress_off")
    assert fake.requests == asked and _audit(app, "tres.retry") == []


@requires_db
async def test_the_platforms_words_are_in_the_audited_preview_and_never_in_the_list(desk, db_session):
    """D25 with a sentinel: `last_error` may echo a value — the list never carries it, the preview does."""
    ward, fake, stay, client, app = desk
    assert (await client.post(_send(stay), headers=ward.auth["admin"])).status_code == 200
    row = (await db_session.execute(select(TresDelivery).where(TresDelivery.resource_type == "encounter"))).scalar_one()
    row.last_error = SENTINEL
    await db_session.commit()
    listed = await client.get(LIST, headers=ward.auth["admin"])
    assert listed.status_code == 200 and SENTINEL not in listed.text
    r = await client.get(_preview(stay.id), headers=ward.auth["admin"])
    (encounter,) = [i for i in r.json()["items"] if i["resource_type"] == "encounter"]
    assert encounter["last_error"] == SENTINEL and encounter["status"] == "sent"


@requires_db
async def test_the_preview_reads_each_items_row_by_its_key_not_by_the_stay(desk, db_session):
    """M4: the doctor's Practitioner row follows the stay that last ran it; the first stay's preview still
    shows its status."""
    ward, fake, stay, client, app = desk
    assert (await client.post(_send(stay), headers=ward.auth["admin"])).status_code == 200
    second = await add_stay(db_session, ward, protocol_no="202600000102", number="H2600102", fin="ZZ55YY5", bed="2")
    assert (await client.post(_send(second), headers=ward.auth["admin"])).status_code == 200
    moved = (await db_session.execute(select(TresDelivery.admission_id).where(
        TresDelivery.resource_type == "practitioner"))).scalar_one()
    assert moved == second.id
    r = await client.get(_preview(stay.id), headers=ward.auth["admin"])
    (practitioner,) = [i for i in r.json()["items"] if i["resource_type"] == "practitioner"]
    assert (practitioner["status"], practitioner["held"]) == ("sent", True)


@requires_db
async def test_the_preview_shows_a_type_switched_off_as_not_sent_with_its_reason(desk, db_session):
    """M5: the preview honours the tenant's types as a send does — a type off and not held is not sent,
    and a Patient so left unheld stops the stay at its Encounter (`patient_unheld`)."""
    ward, fake, stay, client, app = desk
    await db_session.execute(text("""UPDATE tres_settings SET enabled_types = '["patient", "practitioner", "encounter"]'"""))
    await db_session.commit()
    items = (await client.get(_preview(stay.id), headers=ward.auth["admin"])).json()["items"]
    vitals = [i for i in items if i["resource_type"] == "vital"]
    assert vitals and all((i["reason"], i["resource"], i["held"]) == ("type_off", None, False) for i in vitals)
    assert [i for i in items if i["resource_type"] == "encounter"][0]["resource"] is not None
    await db_session.execute(text("""UPDATE tres_settings SET enabled_types = '["practitioner", "encounter", "vital"]'"""))
    await db_session.commit()
    items = (await client.get(_preview(stay.id), headers=ward.auth["admin"])).json()["items"]
    assert [(i["resource_type"], i["reason"]) for i in items] == [
        ("patient", "type_off"), ("practitioner", None), ("encounter", "patient_unheld")]
    assert fake.requests == []


@requires_db
async def test_the_preview_shows_a_patient_left_to_the_persons_newer_stay_and_goes_on(desk, db_session):
    """M5: as `_row` judges a send — the person's newer stay holds the Patient on the platform, so this
    older stay sends nothing for it: the item says so (`yielded`, no body) and the preview goes on to the
    Encounter and the vitals, referring to that Patient."""
    ward, fake, stay, client, app = desk
    newer = await add_stay(db_session, ward, protocol_no="202600000102", number="H2600102", bed="2",
                           admitted_at=DISCHARGED + timedelta(days=1), discharged_at=DISCHARGED + timedelta(days=2),
                           phone="055 765 43 21")
    assert (await client.post(_send(newer), headers=ward.auth["admin"])).status_code == 200
    (person,) = fake.stored("Patient")
    items = (await client.get(_preview(stay.id), headers=ward.auth["admin"])).json()["items"]
    patient = items[0]
    assert (patient["resource_type"], patient["local_id"]) == ("patient", ids.patient("AB12C3D"))
    assert (patient["yielded"], patient["held"], patient["resource"], patient["status"]) == (True, True, None, "sent")
    (encounter,) = [i for i in items if i["resource_type"] == "encounter"]
    assert encounter["resource"]["subject"] == {"reference": f"Patient/{person['id']}"}
    assert [i["resource_type"] for i in items].count("vital") >= 1
    assert all(i["yielded"] is False for i in items[1:])


@requires_db
async def test_an_unexpected_failure_in_a_hand_is_rolled_back_audited_as_an_error_and_raised(desk, monkeypatch):
    """M6: never a hand with no trail — `result: "error"`, no message, no value; then the 500."""
    ward, fake, stay, client, app = desk
    from homunculus.tres import package

    def broken(*_args, **_kwargs):
        raise RuntimeError("Sentetikova Leyla")

    monkeypatch.setattr(package, "map_encounter", broken)
    with pytest.raises(RuntimeError):
        await client.post(_send(stay), headers=ward.auth["admin"])
    (row,) = _audit(app, "tres.send")
    assert row.payload == {"actor": ward.users["admin"].username, "admission_id": str(stay.id), "result": "error"}


@requires_db
async def test_a_malformed_admission_filter_is_a_coded_422_that_echoes_nothing(desk):
    """M7: never FastAPI's 422, which echoes the value it could not read."""
    ward, fake, stay, client, app = desk
    r = await client.get(LIST, params={"admission": "not-a-uuid<script>"}, headers=ward.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (422, "tres_filter")
    assert "<script>" not in r.text and "not-a-uuid" not in r.text


@requires_db
async def test_another_tenants_admission_is_unknown_to_the_send_and_the_preview(desk, db_session):
    ward, fake, stay, client, app = desk
    other = await other_tenants_stay(db_session)
    for r in (await client.post(_send(other), headers=ward.auth["admin"]),
              await client.get(_preview(other.id), headers=ward.auth["admin"])):
        assert (r.status_code, r.json()["detail"]["code"]) == (404, "tres_stay_unknown")
    assert fake.requests == [] and _audit(app, "tres.send") == [] and _audit(app, "tres.preview") == []


@requires_db
async def test_an_address_the_factory_refuses_is_a_409_that_asks_nothing(desk):
    """The app's own factory (egress.open_client) with an install that does not allow the stand-in's host."""
    ward, fake, stay, client, app = desk
    app.state.tres_client_factory = partial(open_client, egress=True, hosts=frozenset({"ehr-sandbox.e-health.gov.az"}))
    r = await client.post(_send(stay), headers=ward.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "tres_host_not_allowed")
    assert fake.requests == [] and _audit(app, "tres.send") == []


@requires_db
async def test_a_stay_still_admitted_is_sent_by_hand_in_progress(desk, db_session):
    ward, fake, stay, client, app = desk
    admitted = await add_stay(db_session, ward, protocol_no="202600000102", number="H2600102", fin="ZZ55YY5",
                              bed="2", state=AdmissionState.ACTIVE)
    r = await client.post(_send(admitted), headers=ward.auth["admin"])
    assert r.status_code == 200, r.text
    (encounter,) = fake.stored("Encounter")
    assert encounter["status"] == "in-progress" and "end" not in encounter["period"]

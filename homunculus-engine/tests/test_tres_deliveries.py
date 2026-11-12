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

import httpx
import pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker

from homunculus.admission.models import AdmissionState
from homunculus.tenant.models import Tenant
from homunculus.tres.client import TresClient
from homunculus.tres.ledger import _row
from homunculus.tres.models import TresDelivery, TresSettings
from tests.conftest import requires_db
from tests.fake_tres import FakeTres
from tests.kabul_world import SLUG, build_ward, ward_client
from tests.tres_world import ADMITTED, BAKU, ORGANIZATION, add_stay, chart, feed_settings, identify, map_unit

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
        from homunculus.tres import ids
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

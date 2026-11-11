# homunculus-engine/tests/test_tres_settings.py
"""Yönetim › TRƏS (TRƏS-01, spec §6, D2, D3, D23, D24): GET|PUT /admin/tres/settings and
POST /admin/tres/test — `tres.manage` in the caller's tenant; a tenant with no row reads as off;
the answer says whether the install's lock is open and never carries a password; a password
omitted keeps the stored one and an empty one clears it; the password is ciphertext at rest; a bad
value is refused with its code and writes nothing; a change is audited with the NAMES of the
fields and no value; the connection test is refused while the install's lock is closed, and then
asks the platform for one session and tells its words, never the session id. The body's rules need
no database; the routes run on Postgres (tests/kabul_world.py) against the stand-in
(tests/fake_tres.py). Synthetic ward, synthetic account."""
from __future__ import annotations

import json

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import func, select, text

from homunculus.tenant.models import Tenant
from homunculus.tres.client import TresClient
from homunculus.tres.errors import CODES, WORDS
from homunculus.tres.models import RESOURCE_TYPES, TresSettings
from homunculus.tres.schemas import TresSettingsIn, base_url_ok, settings_refusal
from tests.conftest import requires_db
from tests.fake_tres import FakeTres
from tests.kabul_world import SLUG, build_ward, ward_client

URL = "/admin/tres/settings"
TEST_URL = "/admin/tres/test"
EMPTY = {"base_url": None, "username": None, "provider_id": None, "organization_id": None,
         "organization_name": None}
SANDBOX = {"base_url": "https://ehr-sandbox.example.az", "username": "sentetik", "password": "gizli-parola",
           "provider_id": "PRV-0001", "organization_id": "ORG-0001", "organization_name": "Sentetik Kabul Hastanesi"}


def body(**over) -> dict:
    return {"mode": "off", "environment": "test", "settle_hours": 24, "enabled_types": list(RESOURCE_TYPES),
            "test": dict(EMPTY), "live": dict(EMPTY), **over}


# ---------------------------------------------------------------- the rules (no database)
@pytest.mark.parametrize("sent, code", [
    (body(mode="on"), "tres_mode"),
    (body(mode=""), "tres_mode"),
    (body(environment="prod"), "tres_environment"),
    (body(settle_hours=-1), "tres_settle_hours"),
    (body(settle_hours=169), "tres_settle_hours"),
    (body(enabled_types=["patient", "imaging"]), "tres_types"),
    (body(enabled_types=["patient", "patient"]), "tres_types"),
    (body(test={**EMPTY, "base_url": "http://ehr-sandbox.example.az"}), "tres_base_url"),
    (body(live={**EMPTY, "base_url": "ehr.example.az"}), "tres_base_url"),
    (body(live={**EMPTY, "base_url": "https://"}), "tres_base_url"),
    (body(live={**EMPTY, "base_url": "https://sentetik:parola@ehr.example.az"}), "tres_base_url"),
    (body(live={**EMPTY, "base_url": "https://ehr.example.az/" + "x" * 200}), "tres_base_url"),
    (body(test={**EMPTY, "username": "u" * 121}), "tres_field_length"),
    (body(test={**EMPTY, "password": "p" * 201}), "tres_field_length"),
    (body(live={**EMPTY, "provider_id": "x" * 65}), "tres_field_length"),
    (body(live={**EMPTY, "organization_id": "x" * 65}), "tres_field_length"),
    (body(live={**EMPTY, "organization_name": "x" * 201}), "tres_field_length"),
    (body(mode="on", settle_hours=999), "tres_mode"),                # the first wrong value, in the form's order
])
def test_a_bad_body_has_its_code(sent, code):
    assert settings_refusal(TresSettingsIn(**sent)) == code


@pytest.mark.parametrize("sent", [
    body(), body(mode="validate", environment="live", settle_hours=0, enabled_types=[]),
    body(mode="send", settle_hours=168, enabled_types=["lab", "patient"], test=SANDBOX),
    body(test={**EMPTY, "base_url": "  "}),                           # blank: cleared, not judged
])
def test_a_good_body_has_none(sent):
    assert settings_refusal(TresSettingsIn(**sent)) is None


def test_a_base_url_is_https_with_a_host_and_no_credentials():
    assert base_url_ok("https://ehr.e-health.example.az") and base_url_ok("https://10.0.0.5:8443/api")
    for bad in ("http://ehr.example.az", "https://", "https:///fhir", "https://u:p@ehr.example.az", "ftp://x"):
        assert not base_url_ok(bad), bad


def test_every_code_has_its_words():
    assert set(WORDS) == CODES and all(text_.strip() for text_ in WORDS.values())


# ---------------------------------------------------------------- the routes
@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    monkeypatch.delenv("TRES_EGRESS", raising=False)
    built = await build_ward(db_session)
    async with ward_client(db_session) as (client, app):
        yield built, client, app


def _audit(app) -> list:
    return app.state.audit.records(tenant=SLUG, event_type="tres.settings", limit=50)


async def _count(db_session) -> int:
    return (await db_session.execute(select(func.count()).select_from(TresSettings))).scalar_one()


@requires_db
async def test_a_tenant_starts_off_with_no_account_and_the_lock_closed(ward, db_session):
    w, client, _ = ward
    r = await client.get(URL, headers=w.auth["admin"])
    assert r.status_code == 200, r.text
    account = {**EMPTY, "password_set": False}
    assert r.json() == {"mode": "off", "environment": "test", "settle_hours": 24,
                        "enabled_types": list(RESOURCE_TYPES), "test": account, "live": account,
                        "egress": False, "updated_at": None}
    assert await _count(db_session) == 0                    # a read writes no row


@requires_db
async def test_the_answer_says_when_the_installs_lock_is_open(ward):
    w, client, app = ward
    app.state.tres_egress = True
    assert (await client.get(URL, headers=w.auth["admin"])).json()["egress"] is True
    r = await client.put(URL, json=body(), headers=w.auth["admin"])
    assert (r.status_code, r.json()["egress"]) == (200, True)


@requires_db
async def test_the_administrator_saves_and_the_password_never_comes_back(ward, db_session):
    w, client, app = ward
    sent = body(mode="validate", settle_hours=48, enabled_types=["lab", "patient", "encounter"], test=SANDBOX)
    r = await client.put(URL, json=sent, headers=w.auth["admin"])
    assert r.status_code == 200, r.text
    answer = r.json()
    assert (answer["mode"], answer["environment"], answer["settle_hours"]) == ("validate", "test", 48)
    assert answer["enabled_types"] == ["patient", "encounter", "lab"]          # the catalogue's order
    assert answer["test"] == {**{k: v for k, v in SANDBOX.items() if k != "password"}, "password_set": True}
    assert answer["live"] == {**EMPTY, "password_set": False}
    assert answer["updated_at"] is not None
    read = await client.get(URL, headers=w.auth["admin"])
    assert read.json() == answer
    assert "gizli-parola" not in r.text + read.text and "password\"" not in r.text.replace("password_set\"", "")
    # at rest: ciphertext; to the model: the password
    stored = (await db_session.execute(text("SELECT test_password FROM tres_settings"))).scalar_one()
    assert stored.startswith("enc::v1::") and "gizli" not in stored
    (row,) = (await db_session.execute(select(TresSettings))).scalars()
    assert (row.tenant_id, row.test_password, row.updated_by) == (w.tenant.id, "gizli-parola", w.users["admin"].id)
    # audited: who, and the NAMES of what changed — no value, no password
    (audit,) = _audit(app)
    assert audit.patient_id == ""
    assert audit.payload == {"actor": "admin@kabul.example.com", "changed": [
        "mode", "settle_hours", "enabled_types", "test.base_url", "test.username", "test.password",
        "test.provider_id", "test.organization_id", "test.organization_name"]}
    assert "gizli" not in json.dumps(audit.payload) and "sandbox" not in json.dumps(audit.payload)


@requires_db
async def test_a_password_left_out_stays_and_an_empty_one_clears_it(ward, db_session):
    w, client, app = ward
    assert (await client.put(URL, json=body(test=SANDBOX), headers=w.auth["admin"])).status_code == 200
    kept = {k: v for k, v in SANDBOX.items() if k != "password"}
    for unchanged in (kept, {**kept, "password": None}):
        r = await client.put(URL, json=body(test=unchanged, settle_hours=12), headers=w.auth["admin"])
        assert (r.status_code, r.json()["test"]["password_set"]) == (200, True), r.text
    db_session.expire_all()
    (row,) = (await db_session.execute(select(TresSettings))).scalars()
    assert row.test_password == "gizli-parola"
    r = await client.put(URL, json=body(test={**kept, "password": ""}, settle_hours=12), headers=w.auth["admin"])
    assert (r.status_code, r.json()["test"]["password_set"]) == (200, False)
    db_session.expire_all()
    (row,) = (await db_session.execute(select(TresSettings))).scalars()
    assert row.test_password is None
    assert [a.payload["changed"] for a in _audit(app)][1:] == [["settle_hours"], ["test.password"]]


@requires_db
async def test_an_empty_field_clears_and_a_save_that_changes_nothing_is_not_audited(ward, db_session):
    w, client, app = ward
    assert (await client.put(URL, json=body(test=SANDBOX), headers=w.auth["admin"])).status_code == 200
    first = (await client.get(URL, headers=w.auth["admin"])).json()["updated_at"]
    again = await client.put(URL, json=body(test={**SANDBOX, "base_url": "  https://ehr-sandbox.example.az "}),
                             headers=w.auth["admin"])
    assert (again.status_code, again.json()["updated_at"]) == (200, first)      # trimmed: the same
    assert len(_audit(app)) == 1
    cleared = await client.put(URL, json=body(test={**SANDBOX, "organization_name": "", "username": None}),
                               headers=w.auth["admin"])
    assert (cleared.json()["test"]["organization_name"], cleared.json()["test"]["username"]) == (None, None)
    assert _audit(app)[-1].payload["changed"] == ["test.username", "test.organization_name"]


@requires_db
@pytest.mark.parametrize("sent, code", [
    (body(mode="on"), "tres_mode"),
    (body(environment="prod"), "tres_environment"),
    (body(settle_hours=169), "tres_settle_hours"),
    (body(enabled_types=["imaging"]), "tres_types"),
    (body(live={**EMPTY, "base_url": "http://ehr.example.az"}), "tres_base_url"),
    (body(test={**EMPTY, "username": "u" * 121}), "tres_field_length"),
])
async def test_a_bad_value_is_refused_with_its_code_and_writes_nothing(ward, db_session, sent, code):
    w, client, app = ward
    r = await client.put(URL, json=sent, headers=w.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (422, code), r.text
    assert r.json()["detail"]["message"] == WORDS[code]
    assert await _count(db_session) == 0 and _audit(app) == []


@requires_db
async def test_a_field_too_many_or_of_the_wrong_type_is_refused(ward):
    w, client, _ = ward
    for sent in ({**body(), "egress": True}, body(settle_hours="24"), body(settle_hours=True),
                 body(test={**EMPTY, "password_set": True}), body(enabled_types="patient"),
                 {k: v for k, v in body().items() if k != "live"}):
        assert (await client.put(URL, json=sent, headers=w.auth["admin"])).status_code == 422


@requires_db
async def test_only_tres_manage_reads_writes_or_tests(ward):
    w, client, app = ward
    app.state.tres_egress = True
    for who in ("nurse", "nurse_b", "charge", "doctor", "auditor"):
        assert (await client.get(URL, headers=w.auth[who])).status_code == 403, who
        assert (await client.put(URL, json=body(), headers=w.auth[who])).status_code == 403, who
        assert (await client.post(TEST_URL, headers=w.auth[who])).status_code == 403, who
    assert (await client.get(URL)).status_code == 401


@requires_db
async def test_the_settings_are_the_callers_tenants_alone(ward, db_session):
    w, client, _ = ward
    other = Tenant(name="Sentetik Başka Hastane", slug="baska-hastane", country_code="AZ")
    db_session.add(other)
    await db_session.flush()
    db_session.add(TresSettings(tenant_id=other.id, mode="send", environment="live",
                                live_base_url="https://ehr.example.az", live_password="baska-parola"))
    await db_session.commit()
    own_id, other_id = w.tenant.id, other.id               # read before expire_all()
    assert (await client.get(URL, headers=w.auth["admin"])).json()["mode"] == "off"
    assert (await client.put(URL, json=body(mode="validate"), headers=w.auth["admin"])).status_code == 200
    db_session.expire_all()
    rows = {r.tenant_id: r for r in (await db_session.execute(select(TresSettings))).scalars()}
    assert (rows[other_id].mode, rows[other_id].live_password) == ("send", "baska-parola")
    assert rows[own_id].mode == "validate"


# ---------------------------------------------------------------- the connection test
async def _stand_in(app, client, w, **account) -> FakeTres:
    """The stand-in behind the app's client factory, and its account saved as the tenant's sandbox."""
    fake = FakeTres()
    app.state.tres_client_factory = lambda acc: TresClient(acc, transport=fake.transport)
    saved = {"base_url": fake.account.base_url, "username": fake.account.username,
             "password": fake.account.password, "provider_id": fake.account.provider_id, **account}
    r = await client.put(URL, json=body(test={**EMPTY, **saved}), headers=w.auth["admin"])
    assert r.status_code == 200, r.text
    return fake


@requires_db
async def test_with_the_lock_closed_the_test_is_refused_and_no_client_is_built(ward):
    w, client, app = ward
    built = []
    app.state.tres_client_factory = lambda account: built.append(account)
    await client.put(URL, json=body(test=SANDBOX), headers=w.auth["admin"])
    r = await client.post(TEST_URL, headers=w.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "egress_off"), r.text
    assert built == []


@requires_db
async def test_an_incomplete_account_is_refused_before_anything_is_asked(ward):
    w, client, app = ward
    app.state.tres_egress = True
    r = await client.post(TEST_URL, headers=w.auth["admin"])                      # no row at all
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "tres_account_incomplete")
    fake = await _stand_in(app, client, w, provider_id=None)
    r = await client.post(TEST_URL, headers=w.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "tres_account_incomplete")
    assert fake.requests == []
    # the account is the SELECTED environment's: the sandbox one does not stand for live
    await _stand_in(app, client, w)
    await client.put(URL, json=body(environment="live", test={k: v for k, v in EMPTY.items()}),
                     headers=w.auth["admin"])
    r = await client.post(TEST_URL, headers=w.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "tres_account_incomplete")


@requires_db
async def test_the_test_opens_one_session_and_never_tells_its_id(ward):
    w, client, app = ward
    app.state.tres_egress = True
    fake = await _stand_in(app, client, w)
    r = await client.post(TEST_URL, headers=w.auth["admin"])
    assert (r.status_code, r.json()) == (200, {"ok": True, "message": None}), r.text
    assert fake.requests == [("POST", "/auth/token")]
    assert "session" not in r.text
    assert app.state.audit.records(tenant=SLUG, event_type="tres.test", limit=5) == []     # it writes nothing


@requires_db
async def test_the_platforms_refusal_is_told_in_its_own_words(ward):
    w, client, app = ward
    app.state.tres_egress = True
    await _stand_in(app, client, w, password="yanlis-parola")
    r = await client.post(TEST_URL, headers=w.auth["admin"])
    assert (r.status_code, r.json()) == (200, {"ok": False, "message": "Invalid credentials"})
    assert "yanlis-parola" not in r.text


@requires_db
async def test_a_dead_line_is_an_answer_too_never_a_500(ward):
    w, client, app = ward
    app.state.tres_egress = True
    await _stand_in(app, client, w)

    def refuse(request):
        raise httpx.ConnectError("connection refused", request=request)

    app.state.tres_client_factory = lambda acc: TresClient(acc, transport=httpx.MockTransport(refuse))
    r = await client.post(TEST_URL, headers=w.auth["admin"])
    assert (r.status_code, r.json()) == (200, {"ok": False, "message": "ConnectError"})

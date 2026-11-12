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
from datetime import datetime, timezone

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker

from homunculus.db import get_db
from homunculus.tenant.models import Tenant
from homunculus.tres.client import TresClient
from homunculus.tres.egress import DEFAULT_HOSTS, open_client
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
#: What these tests' install allows (TRES_HOSTS): the synthetic hosts, and the stand-in's.
HOSTS = frozenset({"ehr-sandbox.example.az", "ehr.example.az", "tres.test"})


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
    # review #4: nothing rides along with the address, and it points only where the install allows
    (body(test={**EMPTY, "base_url": "https://ehr-sandbox.example.az/?x=1"}), "tres_base_url"),
    (body(test={**EMPTY, "base_url": "https://ehr-sandbox.example.az/fhir?"}), "tres_base_url"),
    (body(test={**EMPTY, "base_url": "https://ehr-sandbox.example.az/gizli#"}), "tres_base_url"),
    (body(test={**EMPTY, "base_url": "https://ehr-sandbox.example.az:22"}), "tres_base_url"),
    (body(test={**EMPTY, "base_url": "https://ehr-sandbox.example.az:8443"}), "tres_base_url"),
    (body(test={**EMPTY, "base_url": "https://sentetik@ehr-sandbox.example.az"}), "tres_base_url"),
    (body(test={**EMPTY, "base_url": "https://ehr.e-health.gov.az"}), "tres_host_not_allowed"),
    (body(live={**EMPTY, "base_url": "https://127.0.0.1"}), "tres_host_not_allowed"),
    (body(live={**EMPTY, "base_url": "https://ehr.example.az.example.org"}), "tres_host_not_allowed"),
    # review M1: a host IDNA cannot read (httpx's `.host` raises) is a bad address, never a 500
    (body(test={**EMPTY, "base_url": "https://xn--a.gov.az"}), "tres_base_url"),
    (body(live={**EMPTY, "base_url": "https://xn--hr-e-health-xyz.gov.az"}), "tres_base_url"),
])
def test_a_bad_body_has_its_code(sent, code):
    assert settings_refusal(TresSettingsIn(**sent), hosts=HOSTS) == code


@pytest.mark.parametrize("sent", [
    body(), body(mode="validate", environment="live", settle_hours=0, enabled_types=[]),
    body(mode="send", settle_hours=168, enabled_types=["lab", "patient"], test=SANDBOX),
    body(test={**EMPTY, "base_url": "  "}),                           # blank: cleared, not judged
    body(live={**EMPTY, "base_url": "https://EHR.example.az:443/fhir-base"}),
])
def test_a_good_body_has_none(sent):
    assert settings_refusal(TresSettingsIn(**sent), hosts=HOSTS) is None


def test_with_no_hosts_named_by_the_install_only_the_platforms_own_two_are_allowed():
    for host in ("ehr-sandbox.e-health.gov.az", "ehr.e-health.gov.az"):
        assert settings_refusal(TresSettingsIn(**body(test={**EMPTY, "base_url": f"https://{host}"})),
                                hosts=DEFAULT_HOSTS) is None
    assert settings_refusal(TresSettingsIn(**body(test=SANDBOX)), hosts=DEFAULT_HOSTS) == "tres_host_not_allowed"


def test_a_base_url_is_https_with_a_host_and_nothing_but_a_path():
    assert base_url_ok("https://ehr.e-health.example.az") and base_url_ok("https://10.0.0.5:443/api")
    for bad in ("http://ehr.example.az", "https://", "https:///fhir", "https://u:p@ehr.example.az", "ftp://x",
                "https://10.0.0.5:8443/api", "https://ehr.example.az/?x=", "https://ehr.example.az/a#b"):
        assert not base_url_ok(bad), bad


def test_every_code_has_its_words():
    assert set(WORDS) == CODES and all(text_.strip() for text_ in WORDS.values())


# ---------------------------------------------------------------- the routes
@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    monkeypatch.delenv("TRES_EGRESS", raising=False)
    monkeypatch.setenv("TRES_HOSTS", ",".join(sorted(HOSTS)))
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
                        "egress": False, "updated_at": None, "session_refused_at": None}
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
    # audited: who, the NAMES of what changed, and where a changed address now points (its host
    # only) — no other value, no password
    (audit,) = _audit(app)
    assert audit.patient_id == ""
    assert audit.payload == {"actor": "admin@kabul.example.com", "changed": [
        "mode", "settle_hours", "enabled_types", "test.base_url", "test.username", "test.password",
        "test.provider_id", "test.organization_id", "test.organization_name"],
        "hosts": {"test": "ehr-sandbox.example.az"}}
    assert "gizli" not in json.dumps(audit.payload) and "sentetik" not in json.dumps(audit.payload)
    assert "PRV-0001" not in json.dumps(audit.payload)


@requires_db
async def test_a_changed_address_drops_the_stored_password_unless_a_new_one_comes_with_it(ward, db_session):
    """Review #4: a stored password never follows the account to another server."""
    w, client, app = ward
    assert (await client.put(URL, json=body(test=SANDBOX), headers=w.auth["admin"])).status_code == 200
    kept = {k: v for k, v in SANDBOX.items() if k != "password"}
    moved = {**kept, "base_url": "https://sentetik:x@ehr.example.az/fhir-base"}
    r = await client.put(URL, json=body(test=moved), headers=w.auth["admin"])
    assert r.status_code == 422                                     # credentials in the address: refused
    moved = {**kept, "base_url": "https://ehr.example.az/fhir-base"}
    r = await client.put(URL, json=body(test=moved), headers=w.auth["admin"])
    assert (r.status_code, r.json()["test"]["password_set"]) == (200, False), r.text
    db_session.expire_all()
    (row,) = (await db_session.execute(select(TresSettings))).scalars()
    assert (row.test_base_url, row.test_password) == ("https://ehr.example.az/fhir-base", None)
    audit = _audit(app)[-1].payload
    assert audit["changed"] == ["test.base_url", "test.password"]
    assert audit["hosts"] == {"test": "ehr.example.az"} and "fhir-base" not in json.dumps(audit)
    # back, with a new password in the same save: it is kept
    r = await client.put(URL, json=body(test={**SANDBOX, "password": "yeni-parola"}), headers=w.auth["admin"])
    assert (r.status_code, r.json()["test"]["password_set"]) == (200, True)
    db_session.expire_all()
    (row,) = (await db_session.execute(select(TresSettings))).scalars()
    assert row.test_password == "yeni-parola"
    # the other environment's password is its own: the sandbox's move never touches live's
    live = {**SANDBOX, "base_url": "https://ehr.example.az", "password": "canli-parola"}
    assert (await client.put(URL, json=body(test=SANDBOX, live=live), headers=w.auth["admin"])).status_code == 200
    r = await client.put(URL, json=body(test={**kept, "base_url": None}, live={**live, "password": None}),
                         headers=w.auth["admin"])
    assert (r.json()["test"]["password_set"], r.json()["live"]["password_set"]) == (False, True)
    assert _audit(app)[-1].payload["hosts"] == {"test": None}


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
    (body(live={**EMPTY, "base_url": "https://ehr.example.az:8443"}), "tres_base_url"),
    # the platform's own live host, but this install names others (TRES_HOSTS): refused
    (body(live={**EMPTY, "base_url": "https://ehr.e-health.gov.az"}), "tres_host_not_allowed"),
    (body(test={**EMPTY, "base_url": "https://xn--a.gov.az"}), "tres_base_url"),       # review M1: not a 500
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
    app.state.tres_client_factory = lambda acc, **_: TresClient(acc, transport=fake.transport)
    saved = {"base_url": fake.account.base_url, "username": fake.account.username,
             "password": fake.account.password, "provider_id": fake.account.provider_id, **account}
    r = await client.put(URL, json=body(test={**EMPTY, **saved}), headers=w.auth["admin"])
    assert r.status_code == 200, r.text
    return fake


@requires_db
async def test_with_the_lock_closed_the_test_is_refused_and_no_client_is_built(ward):
    w, client, app = ward
    built = []
    app.state.tres_client_factory = lambda account, **_: built.append(account)
    await client.put(URL, json=body(test=SANDBOX), headers=w.auth["admin"])
    r = await client.post(TEST_URL, headers=w.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "egress_off"), r.text
    assert built == []


@requires_db
async def test_an_address_the_install_no_longer_allows_is_refused_by_the_apps_own_factory(ward, db_session, monkeypatch):
    """A row saved before TRES_HOSTS was narrowed: the route builds no client, nothing is asked."""
    w, client, app = ward
    app.state.tres_egress = True
    built = []
    monkeypatch.setattr(httpx.AsyncClient, "__init__", lambda self, *a, **k: built.append(1))
    db_session.add(TresSettings(tenant_id=w.tenant.id, mode="validate", environment="test",
                                test_base_url="https://onceki.example.org", test_username="sentetik",
                                test_password="gizli-parola", test_provider_id="PRV-0001"))
    await db_session.commit()
    r = await client.post(TEST_URL, headers=w.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "tres_host_not_allowed"), r.text
    assert r.json()["detail"]["message"] == WORDS["tres_host_not_allowed"] and built == []


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
async def test_the_test_asks_for_no_patient_data_and_so_still_reaches_an_account_on_the_live_host(ward, db_session):
    """Review M10: the live lock sits inside the client factory and is closed by default; the
    connection test alone says `patient_data=False` (it sends no patient data). Here the REAL
    `open_client` is the factory, on the stand-in's transport — nothing leaves the process."""
    w, client, app = ward
    app.state.tres_egress = True
    fake = FakeTres()
    asked = []

    def factory(account, **kw):
        asked.append(kw)
        return open_client(account, egress=True, hosts=DEFAULT_HOSTS, transport=fake.transport, **kw)

    app.state.tres_client_factory = factory
    db_session.add(TresSettings(tenant_id=w.tenant.id, mode="off", environment="test",
                                test_base_url="https://ehr.e-health.gov.az", test_username=fake.account.username,
                                test_password=fake.account.password, test_provider_id=fake.account.provider_id))
    await db_session.commit()
    r = await client.post(TEST_URL, headers=w.auth["admin"])
    assert (r.status_code, r.json()) == (200, {"ok": True, "message": None}), r.text
    assert asked == [{"patient_data": False}] and fake.requests == [("POST", "/auth/token")]


@requires_db
async def test_the_test_ends_its_database_transaction_before_it_asks_the_platform(ward, db_session):
    """No transaction (and no pooled connection) is held while the platform takes its time."""
    w, client, app = ward
    app.state.tres_egress = True
    fake = await _stand_in(app, client, w)
    sessions = []
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)

    async def _db():
        async with maker() as session:
            sessions.append(session)
            yield session

    app.dependency_overrides[get_db] = _db
    held = []

    def platform(request: httpx.Request) -> httpx.Response:
        held.append(sessions[-1].in_transaction())
        return fake.transport.handler(request)

    app.state.tres_client_factory = lambda acc, **_: TresClient(acc, transport=httpx.MockTransport(platform))
    r = await client.post(TEST_URL, headers=w.auth["admin"])
    assert (r.status_code, r.json()) == (200, {"ok": True, "message": None}), r.text
    assert held == [False]


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

    app.state.tres_client_factory = lambda acc, **_: TresClient(acc, transport=httpx.MockTransport(refuse))
    r = await client.post(TEST_URL, headers=w.auth["admin"])
    assert (r.status_code, r.json()) == (200, {"ok": False, "message": "ConnectError"})


# ---------------------------------------------------------------- a parked tenant (review I3)
PARKED = datetime(2026, 11, 11, 8, 0, tzinfo=timezone.utc)


async def _park(db_session) -> None:
    """What the worker does when the platform refuses the login."""
    await db_session.execute(text("UPDATE tres_settings SET session_refused_at = :t"), {"t": PARKED})
    await db_session.commit()


async def _parked_at(db_session):
    at = (await db_session.execute(text("SELECT session_refused_at FROM tres_settings"))).scalar_one()
    await db_session.commit()
    return at


@requires_db
async def test_a_save_that_changes_something_lets_a_parked_tenant_try_again(ward, db_session):
    w, client, app = ward
    assert (await client.put(URL, json=body(test=SANDBOX), headers=w.auth["admin"])).status_code == 200
    await _park(db_session)
    assert (await client.get(URL, headers=w.auth["admin"])).json()["session_refused_at"] == "2026-11-11T08:00:00Z"
    same = await client.put(URL, json=body(test=SANDBOX), headers=w.auth["admin"])          # nothing changes
    assert same.json()["session_refused_at"] == "2026-11-11T08:00:00Z" and await _parked_at(db_session) == PARKED
    fixed = await client.put(URL, json=body(test={**SANDBOX, "password": "duzeldilmis-parola"}),
                             headers=w.auth["admin"])
    assert (fixed.status_code, fixed.json()["session_refused_at"]) == (200, None)
    assert await _parked_at(db_session) is None


@requires_db
async def test_a_successful_connection_test_lets_a_parked_tenant_try_again_and_a_failed_one_parks_nothing(
        ward, db_session):
    w, client, app = ward
    app.state.tres_egress = True
    await _stand_in(app, client, w, password="yanlis-parola")
    assert (await client.post(TEST_URL, headers=w.auth["admin"])).json()["ok"] is False
    assert await _parked_at(db_session) is None                                   # a failed test parks nothing
    await _stand_in(app, client, w)
    await _park(db_session)
    wrong = FakeTres(password="baska-parola")
    app.state.tres_client_factory = lambda acc, **_: TresClient(acc, transport=wrong.transport)
    assert (await client.post(TEST_URL, headers=w.auth["admin"])).json()["ok"] is False
    assert await _parked_at(db_session) == PARKED                                 # still parked
    await _stand_in(app, client, w, provider_id="PRV-0001")                       # the same account: no change
    await _park(db_session)
    assert (await client.post(TEST_URL, headers=w.auth["admin"])).json() == {"ok": True, "message": None}
    assert await _parked_at(db_session) is None


# ---------------------------------------------------------------- the rounds' reach (plan F1, amendment 25, A3)
REACHED = datetime(2026, 11, 10, 8, 0, tzinfo=timezone.utc)


async def _reach(db_session, value=REACHED):
    """What a round that ran to its end leaves (source.py); then the value as stored."""
    if value is not None:
        await db_session.execute(text("UPDATE tres_settings SET reached_to = :t"), {"t": value})
        await db_session.commit()
    stored = (await db_session.execute(text("SELECT reached_to FROM tres_settings"))).scalar_one()
    await db_session.commit()
    return stored


@requires_db
async def test_a_save_that_moves_the_environment_or_its_address_resets_the_rounds_reach(ward, db_session):
    """The ledger is per environment: another environment, or another address for the selected
    account, starts the watermark again — the next round reaches back to the cut-off (or a week).
    Any other change keeps it, and so does a change to the account not in use."""
    w, client, app = ward
    assert (await client.put(URL, json=body(test=SANDBOX), headers=w.auth["admin"])).status_code == 200
    await _reach(db_session)
    other = {**EMPTY, "base_url": "https://ehr.example.az"}
    for kept in (body(test=SANDBOX, settle_hours=48), body(test=SANDBOX, settle_hours=48, mode="validate"),
                 body(test=SANDBOX, settle_hours=48, mode="validate", live=other)):        # live: not in use
        assert (await client.put(URL, json=kept, headers=w.auth["admin"])).status_code == 200
        assert await _reach(db_session, None) == REACHED, kept
    readdressed = body(test={**SANDBOX, "base_url": "https://ehr.example.az"}, live=other)
    assert (await client.put(URL, json=readdressed, headers=w.auth["admin"])).status_code == 200
    assert await _reach(db_session, None) is None
    await _reach(db_session)
    moved = body(test={**SANDBOX, "base_url": "https://ehr.example.az"}, live=other, environment="live")
    assert (await client.put(URL, json=moved, headers=w.auth["admin"])).status_code == 200
    assert await _reach(db_session, None) is None


# ---------------------------------------------------------------- the install narrows its hosts (review M10)
def test_a_stored_address_sent_back_unchanged_is_not_judged_against_the_hosts_again():
    stored = {"test": None, "live": "https://ehr.e-health.gov.az"}
    for unchanged in ("https://ehr.e-health.gov.az", "  https://ehr.e-health.gov.az "):
        sent = TresSettingsIn(**body(live={**EMPTY, "base_url": unchanged}))
        assert settings_refusal(sent, hosts=HOSTS, stored=stored) is None
    moved = TresSettingsIn(**body(live={**EMPTY, "base_url": "https://ehr.e-health.gov.az/fhir"}))
    assert settings_refusal(moved, hosts=HOSTS, stored=stored) == "tres_host_not_allowed"
    fresh = TresSettingsIn(**body(live={**EMPTY, "base_url": "https://ehr.e-health.gov.az"}))
    assert settings_refusal(fresh, hosts=HOSTS) == "tres_host_not_allowed"        # nothing stored: judged
    bad = TresSettingsIn(**body(live={**EMPTY, "base_url": "http://ehr.e-health.gov.az"}))
    assert settings_refusal(bad, hosts=HOSTS, stored={"live": "http://ehr.e-health.gov.az"}) == "tres_base_url"


@requires_db
async def test_a_narrowed_install_still_saves_the_form_and_names_the_account_it_refuses(ward, db_session):
    """The install's TRES_HOSTS no longer holds the live host the tenant saved: the form, sent back
    as it was, still saves (the client refuses that address at connect); a NEW address elsewhere
    is refused, and the refusal says which account."""
    w, client, app = ward
    db_session.add(TresSettings(tenant_id=w.tenant.id, mode="off", environment="test",
                                live_base_url="https://ehr.e-health.gov.az"))
    await db_session.commit()
    kept = await client.put(URL, json=body(mode="validate", live={**EMPTY, "base_url": "https://ehr.e-health.gov.az"}),
                            headers=w.auth["admin"])
    assert (kept.status_code, kept.json()["mode"], kept.json()["live"]["base_url"]) == (
        200, "validate", "https://ehr.e-health.gov.az"), kept.text
    moved = await client.put(URL, json=body(live={**EMPTY, "base_url": "https://ehr-sandbox.e-health.gov.az"}),
                             headers=w.auth["admin"])
    assert moved.status_code == 422
    assert moved.json()["detail"] == {"code": "tres_host_not_allowed", "environment": "live",
                                      "message": WORDS["tres_host_not_allowed"]}

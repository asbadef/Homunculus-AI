"""/admin/ldap end to end (spec §7, "Import and mapping"; plan decisions D12–D14): with LDAP off
everything but the status is 409, the permission comes first (403), the status and the
connection test, the account and group searches — and, in the sections Tasks 10 and 11 add, the
import and the mapping table under the same rights rules as the rest of /admin. FakeDirectory
and the test Postgres; synthetic accounts only."""
from __future__ import annotations

import time
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import func, select

from homunculus.auth.groups import ensure_default_groups
from homunculus.auth.ldap import ACCOUNT_NEVER_EXPIRES, NOT_CONFIGURED
from homunculus.auth.models import Group, GroupPermission, User
from homunculus.tenant.models import Tenant
from tests.conftest import requires_db
from tests.fake_directory import (
    AD_PASSWORD, ad_client, ad_world, add_mapping, audit_events, group_dn, person,
)
from tests.signed_in import add_user, bearer

pytestmark = [pytest.mark.asyncio, requires_db]


@pytest_asyncio.fixture
async def world(db_session):
    """`ad_world`, plus: a second tenant with its own YB-Hemsire mapping; YB-Sorumlu →
    charge_nurse here; a nurse `hemsire`; a user desk `masa` (the nurse's rights +
    users.manage); and in AD, accounts not yet imported — `MKaya` (YB-Sorumlu), `BDemir`
    (YB-Hemsire, with a mail), the disabled `Eski`, and `Admin`, whose sAMAccountName is the
    local administrator's username."""
    db = db_session
    w = await ad_world(db)
    other = Tenant(name="Other", slug="other", country_code="TR")
    db.add(other)
    await db.flush()
    w["other_groups"] = await ensure_default_groups(db, other.id)
    w["foreign_mapping"] = await add_mapping(db, other.id, group_dn("YB-Hemsire"),
                                             w["other_groups"]["nurse"])
    w["mappings"]["YB-Sorumlu"] = await add_mapping(db, w["tenant"].id, group_dn("YB-Sorumlu"),
                                                    w["groups"]["charge_nurse"])
    desk = Group(tenant_id=w["tenant"].id, slug="personel_masasi", name="Personel Masası")
    desk.permissions = [GroupPermission(permission=k) for k in
                        sorted(set(w["groups"]["nurse"].permission_keys) | {"users.manage"})]
    db.add(desk)
    await db.commit()
    w["desk"] = await add_user(db, username="masa", tenant_id=w["tenant"].id, group=desk)
    w["nurse"] = await add_user(db, username="hemsire", tenant_id=w["tenant"].id,
                                group=w["groups"]["nurse"])
    directory = w["directory"]
    w["mkaya"] = directory.add(person("MKaya", groups=(group_dn("YB-Sorumlu"),)))
    w["bdemir"] = directory.add(person("BDemir", groups=(group_dn("YB-Hemsire"),),
                                       email="B.Demir@hastane.az", display_name="Burak Demir"))
    w["eski"] = directory.add(person("Eski", disabled=True))
    w["clash"] = directory.add(person("Admin"))
    return w


@pytest_asyncio.fixture
async def client(db_session, world):
    async with ad_client(db_session, world["directory"]) as pair:
        yield pair


def _routes(w) -> list[tuple[str, str, dict | None]]:
    """Every /admin/ldap route, each with a body an administrator could send."""
    return [
        ("GET", "/admin/ldap/status", None),
        ("POST", "/admin/ldap/test", None),
        ("GET", "/admin/ldap/search?q=kaya", None),
        ("GET", "/admin/ldap/groups?q=yb", None),
        ("POST", "/admin/ldap/import", {"external_ids": [w["mkaya"].identity.external_id]}),
    ]


# ---------------------------------------------------------------- off, and who may ask
async def test_a_caller_without_users_manage_is_refused_everywhere_configured_or_not(
        client, world, db_session):
    c, app = client
    nurse = await bearer(db_session, world["nurse"])
    for ldap in (app.state.ldap, None):
        app.state.ldap = ldap
        for method, path, body in _routes(world):
            res = await c.request(method, path, headers=nurse, json=body)
            assert res.status_code == 403, (method, path, ldap)


async def test_without_a_directory_only_the_status_answers(client, world, db_session):
    c, app = client
    app.state.ldap = None
    admin = await bearer(db_session, world["admin"])
    res = await c.get("/admin/ldap/status", headers=admin)
    assert res.status_code == 200 and res.json() == {
        "configured": False, "url_host": None, "last_test_at": None, "last_test_ok": None}
    for method, path, body in _routes(world)[1:]:
        res = await c.request(method, path, headers=admin, json=body)
        assert (res.status_code, res.json()["detail"]) == (409, NOT_CONFIGURED), (method, path)


# ---------------------------------------------------------------- status and connection test
async def test_the_status_reports_the_last_connection_test(client, world, db_session):
    c, app = client
    admin = await bearer(db_session, world["admin"])
    status = (await c.get("/admin/ldap/status", headers=admin)).json()
    assert (status["configured"], status["url_host"], status["last_test_ok"]) == (
        True, "dc1.hastane.local", None)
    res = await c.post("/admin/ldap/test", headers=admin)
    assert res.status_code == 200 and (res.json()["ok"], res.json()["reason"]) == (True, None)
    world["directory"].unavailable = True
    res = await c.post("/admin/ldap/test", headers=admin)
    assert res.status_code == 200
    assert (res.json()["ok"], res.json()["reason"]) == (False, "unreachable")
    status = (await c.get("/admin/ldap/status", headers=admin)).json()
    assert status["last_test_ok"] is False and status["last_test_at"] is not None
    assert [r.payload["after"] for r in audit_events(app, "admin", "ldap.test")] == [
        {"ok": True, "reason": None}, {"ok": False, "reason": "unreachable"}]


# ---------------------------------------------------------------- searches
async def test_the_search_flags_accounts_already_imported(client, world, db_session):
    c, _ = client
    admin = await bearer(db_session, world["admin"])
    rows = (await c.get("/admin/ldap/search?q=yilmaz", headers=admin)).json()
    assert [(r["username"], r["already_imported"]) for r in rows] == [("AYilmaz", True)]
    assert rows[0]["external_id"] == world["ayse"].identity.external_id
    assert set(rows[0]) == {"external_id", "username", "upn", "email", "display_name", "dn",
                            "disabled", "already_imported"}
    rows = (await c.get("/admin/ldap/search?q=kaya", headers=admin)).json()
    assert [(r["username"], r["already_imported"]) for r in rows] == [("MKaya", False)]


async def test_a_search_needs_two_characters(client, world, db_session):
    c, _ = client
    admin = await bearer(db_session, world["admin"])
    assert (await c.get("/admin/ldap/search?q=k", headers=admin)).status_code == 422
    assert (await c.get("/admin/ldap/search", headers=admin)).status_code == 422
    assert world["directory"].calls == []


async def test_a_search_with_the_directory_down_is_503(client, world, db_session):
    c, _ = client
    admin = await bearer(db_session, world["admin"])
    world["directory"].unavailable = True
    for path in ("/admin/ldap/search?q=kaya", "/admin/ldap/groups?q=yb"):
        res = await c.get(path, headers=admin)
        assert (res.status_code, res.json()["detail"]) == (503, "Dizin sunucusuna ulaşılamıyor")


async def test_the_group_picker_lists_ad_groups(client, world, db_session):
    c, _ = client
    admin = await bearer(db_session, world["admin"])
    rows = (await c.get("/admin/ldap/groups?q=yb", headers=admin)).json()
    assert sorted(r["name"] for r in rows) == ["YB-Hekim", "YB-Hemsire", "YB-Sorumlu"]
    assert {r["dn"] for r in rows} == {group_dn(n) for n in ("YB-Hekim", "YB-Hemsire",
                                                             "YB-Sorumlu")}


async def test_a_user_desk_may_search(client, world, db_session):
    c, _ = client
    desk = await bearer(db_session, world["desk"])
    assert (await c.get("/admin/ldap/search?q=kaya", headers=desk)).status_code == 200


# ---------------------------------------------------------------- import
async def _imported(db, *external_ids) -> int:
    return (await db.execute(select(func.count()).select_from(User)
                             .where(User.external_id.in_(external_ids)))).scalar_one()


async def test_import_creates_directory_accounts_with_mapped_and_extra_groups(client, world,
                                                                            db_session):
    c, app = client
    admin = await bearer(db_session, world["admin"])
    mkaya = world["mkaya"].identity
    res = await c.post("/admin/ldap/import", headers=admin, json={
        "external_ids": [mkaya.external_id],
        "extra_group_ids": [str(world["groups"]["physician"].id)]})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["skipped"] == []
    [row] = body["imported"]
    assert (row["external_id"], row["username"]) == (mkaya.external_id, "mkaya")
    assert [(g["slug"], g["source"]) for g in row["groups"]] == [
        ("charge_nurse", "ldap"), ("physician", "manual")]
    user = (await db_session.execute(select(User).where(User.external_id == mkaya.external_id))
            ).scalar_one()
    assert (user.auth_source, user.hashed_password, user.email, user.full_name, user.ldap_dn) \
        == ("ldap", None, None, "Mkaya", mkaya.dn)
    signed_in = await c.post("/auth/login", json={"login": "mkaya", "password": AD_PASSWORD})
    assert signed_in.status_code == 200
    assert [r.payload["after"]["username"] for r in audit_events(app, "admin", "ldap.import")] \
        == ["mkaya"]


async def test_import_is_idempotent_and_says_what_it_skipped(client, world, db_session):
    c, _ = client
    admin = await bearer(db_session, world["admin"])
    unknown = str(uuid.uuid4())
    ids = [world["mkaya"].identity.external_id, world["ayse"].identity.external_id,
           world["eski"].identity.external_id, world["clash"].identity.external_id, unknown]
    body = (await c.post("/admin/ldap/import", headers=admin, json={"external_ids": ids})).json()
    assert [r["username"] for r in body["imported"]] == ["mkaya"]
    assert [(s["external_id"], s["reason"]) for s in body["skipped"]] == [
        (ids[1], "exists"), (ids[2], "disabled"), (ids[3], "login_taken"), (unknown, "not_found")]
    again = (await c.post("/admin/ldap/import", headers=admin,
                          json={"external_ids": ids[:1]})).json()
    assert again == {"imported": [], "skipped": [{"external_id": ids[0], "reason": "exists"}]}


def _filetime(unix_seconds: float) -> int:
    return int((unix_seconds + 11_644_473_600) * 10_000_000)


async def test_an_account_past_its_ad_end_date_is_skipped_like_a_disabled_one(client, world,
                                                                             db_session):
    """accountExpires is how HR often off-boards — an end date, not the disabled flag — and the
    default LDAP_USER_FILTER does not exclude it. Such an account could never sign in (it is
    refused as `directory_expired`), so it is not imported: `skipped: expired`. An end date
    still to come, or none, is no reason to skip."""
    c, app = client
    admin = await bearer(db_session, world["admin"])
    directory = world["directory"]
    gone = directory.add(person("Gecmis", groups=(group_dn("YB-Hemsire"),),
                                account_expires=_filetime(time.time() - 60))).identity
    later = directory.add(person("Sonra", account_expires=_filetime(time.time() + 3600))).identity
    never = directory.add(person("Daima", account_expires=ACCOUNT_NEVER_EXPIRES)).identity
    ids = [gone.external_id, later.external_id, never.external_id]
    res = await c.post("/admin/ldap/import", headers=admin, json={"external_ids": ids})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["skipped"] == [{"external_id": gone.external_id, "reason": "expired"}]
    assert [r["username"] for r in body["imported"]] == ["sonra", "daima"]
    assert await _imported(db_session, gone.external_id) == 0
    assert [r.payload["after"]["username"] for r in audit_events(app, "admin", "ldap.import")] \
        == ["sonra", "daima"]


async def test_a_user_desk_imports_only_within_its_rights(client, world, db_session):
    c, _ = client
    desk = await bearer(db_session, world["desk"])
    mkaya, bdemir = world["mkaya"].identity, world["bdemir"].identity
    res = await c.post("/admin/ldap/import", headers=desk,
                       json={"external_ids": [mkaya.external_id]})       # maps to charge_nurse
    assert res.status_code == 403 and "Kendi yetkilerinizi aşan" in res.json()["detail"]
    res = await c.post("/admin/ldap/import", headers=desk, json={
        "external_ids": [bdemir.external_id],
        "extra_group_ids": [str(world["groups"]["physician"].id)]})
    assert res.status_code == 403
    assert await _imported(db_session, mkaya.external_id, bdemir.external_id) == 0
    res = await c.post("/admin/ldap/import", headers=desk,
                       json={"external_ids": [bdemir.external_id]})      # maps to nurse
    assert res.status_code == 200
    assert [g["slug"] for g in res.json()["imported"][0]["groups"]] == ["nurse"]


async def test_an_import_with_the_directory_down_is_503_and_writes_nothing(client, world,
                                                                         db_session):
    c, _ = client
    admin = await bearer(db_session, world["admin"])
    world["directory"].unavailable = True
    res = await c.post("/admin/ldap/import", headers=admin,
                       json={"external_ids": [world["mkaya"].identity.external_id]})
    assert (res.status_code, res.json()["detail"]) == (503, "Dizin sunucusuna ulaşılamıyor")
    assert await _imported(db_session, world["mkaya"].identity.external_id) == 0


@pytest.mark.parametrize("body", [
    {"external_ids": []}, {"external_ids": ["not-a-guid"]},
    {"external_ids": [str(uuid.uuid4()) for _ in range(51)]},
])
async def test_the_import_body_is_bounded(client, world, db_session, body):
    c, _ = client
    admin = await bearer(db_session, world["admin"])
    assert (await c.post("/admin/ldap/import", headers=admin, json=body)).status_code == 422

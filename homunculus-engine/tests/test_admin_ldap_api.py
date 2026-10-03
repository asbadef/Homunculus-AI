"""/admin/ldap end to end (spec §7, "Import and mapping"; plan decisions D12–D14): with LDAP off
everything but the status is 409, the permission comes first (403), the status and the
connection test, the account and group searches — and, in the sections Tasks 10 and 11 add, the
import and the mapping table under the same rights rules as the rest of /admin. FakeDirectory
and the test Postgres; synthetic accounts only."""
from __future__ import annotations

import pytest
import pytest_asyncio

from homunculus.auth.groups import ensure_default_groups
from homunculus.auth.ldap import NOT_CONFIGURED
from homunculus.auth.models import Group, GroupPermission
from homunculus.tenant.models import Tenant
from tests.conftest import requires_db
from tests.fake_directory import (
    ad_client, ad_world, add_mapping, audit_events, group_dn, person,
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

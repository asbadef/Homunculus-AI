"""/admin/ldap end to end (spec §7, "Import and mapping"; plan decisions D12–D14): with LDAP off
everything but the status is 409, the permission comes first (403), the status and the
connection test, the account and group searches — and, in the sections Tasks 10 and 11 add, the
import and the mapping table under the same rights rules as the rest of /admin — and the
administrator's unlock of an AD account's sign-in throttle (/admin/users/{id}/unlock-sign-in),
which needs this world. FakeDirectory and the test Postgres; synthetic accounts only."""
from __future__ import annotations

import asyncio
import threading
import time
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from homunculus.admin import ldap_router, ldap_service
from homunculus.admin import service as admin_service
from homunculus.admin.service import LAST_ADMIN, UNLOCK_COOLDOWN, Actor, AdminError
from homunculus.auth.groups import ensure_default_groups
from homunculus.auth.jwt import decode_token
from homunculus.auth.ldap import (
    ACCOUNT_NEVER_EXPIRES, ADMIN_LANE_SLOTS, NOT_CONFIGURED, LdapUnavailable, load_ldap_config,
)
from homunculus.auth.ldap3_directory import Ldap3Directory
from homunculus.auth.limits import directory_binds
from homunculus.auth.models import (
    SOURCE_LDAP, Group, GroupPermission, LdapGroupMapping, TenantMembership, User, UserGroup,
)
from homunculus.auth.permissions import ALL_PERMISSIONS
from homunculus.tenant.models import Tenant
from tests.conftest import requires_db
from tests.fake_directory import (
    AD_PASSWORD, ADMIN_PASSWORD, TENANT_SLUG, ad_client, ad_world, add_directory_account,
    add_mapping, audit_events, group_dn, group_rows, person, runtime,
)
from tests.signed_in import add_user, bearer

pytestmark = [pytest.mark.asyncio, requires_db]

# A directory configuration for the tests that run the real Ldap3Directory (over a scripted
# connection: no server is ever contacted).
LDAP_ENV = {
    "LDAP_URL": "ldaps://dc1.hastane.local",
    "LDAP_BIND_DN": "CN=svc-homunculus,OU=Servis,DC=hastane,DC=local",
    "LDAP_BIND_PASSWORD": "Servis-Parolasi-7",
    "LDAP_BASE_DN": "DC=hastane,DC=local",
}


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
        ("GET", "/admin/ldap/group-mappings", None),
        ("POST", "/admin/ldap/group-mappings",
         {"ad_group_dn": group_dn("YB-Eczaci"), "group_id": str(w["groups"]["pharmacist"].id)}),
        ("DELETE", f"/admin/ldap/group-mappings/{w['mappings']['YB-Hekim'].id}", None),
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


async def test_a_search_is_trimmed_before_its_length_is_checked(client, world, db_session):
    """Two characters of query, not two characters of padding: `" a"` is a 422 like `"a"`,
    before the directory is asked; a padded query reaches it trimmed."""
    c, _ = client
    admin = await bearer(db_session, world["admin"])
    for path in ("/admin/ldap/search", "/admin/ldap/groups"):
        for q in (" a", "a ", "   "):
            res = await c.get(path, params={"q": q}, headers=admin)
            assert res.status_code == 422, (path, q)
    assert world["directory"].calls == []
    assert (await c.get("/admin/ldap/search", params={"q": "  kaya "}, headers=admin)
            ).status_code == 200
    assert (await c.get("/admin/ldap/groups", params={"q": " yb "}, headers=admin)
            ).status_code == 200
    assert world["directory"].calls == [("search_users", "kaya"), ("search_groups", "yb")]


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


async def test_the_import_answers_and_audits_from_what_it_wrote(client, world, db_session,
                                                                 monkeypatch):
    """The response and the `ldap.import` audit rows come from what the import wrote, gathered
    before its commit — never from a lookup after it, which a concurrent change (the new
    account's membership deactivated a moment later) could turn into a 404, i.e. a 500 for a
    committed import, with the audit rows of the accounts after it never written."""
    c, app = client
    admin = await bearer(db_session, world["admin"])

    async def gone(*args, **kwargs):
        raise AdminError(404, "User not found")

    monkeypatch.setattr(admin_service, "get_tenant_user", gone)
    monkeypatch.setattr(ldap_router, "get_tenant_user", gone, raising=False)
    ids = [world["mkaya"].identity.external_id, world["bdemir"].identity.external_id]
    res = await c.post("/admin/ldap/import", headers=admin, json={
        "external_ids": ids, "extra_group_ids": [str(world["groups"]["physician"].id)]})
    assert res.status_code == 200, res.text
    rows = res.json()["imported"]
    assert [(r["external_id"], r["username"], [(g["slug"], g["source"]) for g in r["groups"]])
            for r in rows] == [
        (ids[0], "mkaya", [("charge_nurse", "ldap"), ("physician", "manual")]),
        (ids[1], "bdemir", [("nurse", "ldap"), ("physician", "manual")])]
    assert rows[0]["groups"][0] == {"id": str(world["groups"]["charge_nurse"].id),
                                    "slug": "charge_nurse", "name": "Sorumlu Hemşire",
                                    "source": "ldap"}
    assert [(e.payload["target"], e.payload["after"])
            for e in audit_events(app, "admin", "ldap.import")] == [
        (rows[0]["id"], {"username": "mkaya", "external_id": ids[0],
                         "groups": ["charge_nurse", "physician"]}),
        (rows[1]["id"], {"username": "bdemir", "external_id": ids[1],
                         "groups": ["nurse", "physician"]})]


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


async def test_an_ad_name_outside_the_local_username_rule_is_skipped(client, world, db_session):
    """The imported username is the sAMAccountName through `normalize_login`, and must then
    follow the rule every local username does (a-z 0-9 . _ @ -, 2-128): `Yıldız` folds to
    `yildiz` and is imported, as it signs in; `Işıl` keeps its `ş`; and `Аdmin`, whose first
    letter is Cyrillic, would be an account that reads as `admin` — both are
    `skipped: invalid_login`, with nothing written for them."""
    c, app = client
    admin = await bearer(db_session, world["admin"])
    directory = world["directory"]
    folded = directory.add(person("Yıldız")).identity
    turkish = directory.add(person("Işıl", groups=(group_dn("YB-Hemsire"),))).identity
    homoglyph = directory.add(person("Аdmin")).identity
    ids = [folded.external_id, turkish.external_id, homoglyph.external_id]
    res = await c.post("/admin/ldap/import", headers=admin, json={"external_ids": ids})
    assert res.status_code == 200, res.text
    body = res.json()
    assert [r["username"] for r in body["imported"]] == ["yildiz"]
    assert body["skipped"] == [{"external_id": turkish.external_id, "reason": "invalid_login"},
                               {"external_id": homoglyph.external_id, "reason": "invalid_login"}]
    assert await _imported(db_session, turkish.external_id, homoglyph.external_id) == 0
    assert [r.payload["after"]["username"] for r in audit_events(app, "admin", "ldap.import")] \
        == ["yildiz"]


async def test_an_account_another_tenant_imports_meanwhile_is_skipped_not_the_batch(
        client, world, db_session, monkeypatch):
    """Two hospitals importing the same AD account at once hold different tenant locks, so both
    pass the re-check, and the second INSERT meets the unique objectGUID and username. For the
    tenant that lost, that account is `skipped: exists` — not a 409 for its whole batch: the
    rest is imported. Made deterministic: right after this import has checked the name, another
    session commits the same account in the other tenant."""
    c, _ = client
    admin = await bearer(db_session, world["admin"])
    mkaya, bdemir = world["mkaya"].identity, world["bdemir"].identity
    other_tenant = world["other_groups"]["nurse"].tenant_id
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)
    check = ldap_service.login_in_use
    raced: list[str] = []

    async def imported_elsewhere_right_after_the_check(db, value, **kwargs):
        in_use = await check(db, value, **kwargs)
        if value == "mkaya" and not raced:
            raced.append(value)
            async with maker() as elsewhere:
                user = User(username="mkaya", email=None, full_name="Mkaya",
                            hashed_password=None, auth_source="ldap",
                            external_id=mkaya.external_id)
                elsewhere.add(user)
                await elsewhere.flush()
                elsewhere.add(TenantMembership(user_id=user.id, tenant_id=other_tenant))
                await elsewhere.commit()
        return in_use

    monkeypatch.setattr(ldap_service, "login_in_use", imported_elsewhere_right_after_the_check)
    res = await c.post("/admin/ldap/import", headers=admin,
                       json={"external_ids": [mkaya.external_id, bdemir.external_id]})
    assert res.status_code == 200, res.text
    body = res.json()
    assert raced == ["mkaya"]
    assert body["skipped"] == [{"external_id": mkaya.external_id, "reason": "exists"}]
    assert [r["username"] for r in body["imported"]] == ["bdemir"]
    tenants = (await db_session.execute(
        select(TenantMembership.tenant_id).join(User, User.id == TenantMembership.user_id)
        .where(User.external_id == mkaya.external_id))).scalars().all()
    assert tenants == [other_tenant]                             # one account, theirs


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


def _lookups(directory) -> int:
    return sum(1 for method, _ in directory.calls if method == "find_by_external_id")


async def test_two_large_imports_share_the_admin_lane_and_a_sign_in_is_not_held_up(
        client, world, db_session):
    """Two administrators import 50 accounts each against a slow directory: at most
    ADMIN_LANE_SLOTS lookups are with the directory at once, across both requests, and a
    clinician signing in meanwhile is answered without waiting for them."""
    c, _ = client
    admin = await bearer(db_session, world["admin"])
    directory = world["directory"]
    ids = [directory.add(person(f"Toplu{i:03d}")).identity.external_id for i in range(100)]
    directory.delay = 0.02
    imports = [asyncio.create_task(c.post("/admin/ldap/import", headers=admin,
                                          json={"external_ids": ids[k:k + 50]}))
               for k in (0, 50)]
    while _lookups(directory) < 2 * ADMIN_LANE_SLOTS:
        await asyncio.sleep(0.01)
    started = time.monotonic()
    res = await c.post("/auth/login", json={"login": "ayilmaz", "password": AD_PASSWORD})
    took = time.monotonic() - started
    assert res.status_code == 200, res.text
    assert not all(task.done() for task in imports)
    results = await asyncio.gather(*imports)
    assert [len(r.json()["imported"]) for r in results] == [50, 50]
    assert directory.peak["find_by_external_id"] == ADMIN_LANE_SLOTS
    assert took < 2.0                                   # no queue behind 100 lookups


async def test_an_import_leaves_a_lane_place_for_a_search(client, world, db_session):
    """One import asks at most ADMIN_LANE_SLOTS - 1 lookups at once: however large, it leaves
    the administrator's interactive calls (a search, the group picker, the connection test) a
    lane place, so they never queue behind it."""
    c, app = client
    admin = await bearer(db_session, world["admin"])
    directory, lane = world["directory"], app.state.ldap.admin_lane
    ids = [directory.add(person(f"Toplu{i:03d}")).identity.external_id for i in range(20)]
    directory.delay = 0.05
    running = asyncio.create_task(c.post("/admin/ldap/import", headers=admin,
                                         json={"external_ids": ids}))
    while _lookups(directory) < ADMIN_LANE_SLOTS:
        await asyncio.sleep(0.01)
    assert not lane.locked()                             # a place is free while it runs
    res = await c.get("/admin/ldap/search?q=kaya", headers=admin)
    assert res.status_code == 200 and not running.done()
    assert (await running).status_code == 200
    assert directory.peak["find_by_external_id"] == ADMIN_LANE_SLOTS - 1


async def test_a_cancelled_import_stays_cancelled_and_is_not_an_outage():
    """The request goes away (the client disconnected, the server is stopping) in the same step
    as a lookup fails. The TaskGroup then reports the lookup's failure and drops the
    cancellation; the import re-raises the cancellation instead of answering 503 for a request
    nobody waits on (and that the server is cancelling)."""
    gate = asyncio.Event()
    failing, silent = str(uuid.uuid4()), str(uuid.uuid4())

    class Directory:
        async def find_by_external_id(self, external_id, *, lane=None):
            if external_id == failing:
                await gate.wait()
                raise LdapUnavailable("timeout")
            await asyncio.Event().wait()                  # never answers

    importing = asyncio.create_task(
        ldap_service.lookup_accounts(runtime(Directory()), [failing, silent]))
    await asyncio.sleep(0.01)                             # both lookups are waiting
    gate.set()                                            # the lookup fails...
    importing.cancel()                                    # ...as the request is cancelled
    with pytest.raises(asyncio.CancelledError):
        await importing


async def test_the_first_directory_failure_stops_the_rest_of_the_import(client, world,
                                                                        db_session):
    """A domain controller that fails: the lookups not started yet are never made (no queue of
    doomed calls in front of sign-ins), and the import is 503 with nothing written."""
    c, _ = client
    admin = await bearer(db_session, world["admin"])
    directory = world["directory"]
    ids = [directory.add(person(f"Toplu{i:03d}")).identity.external_id for i in range(50)]
    directory.delay, directory.unavailable = 0.05, "timeout"
    res = await c.post("/admin/ldap/import", headers=admin, json={"external_ids": ids})
    assert (res.status_code, res.json()["detail"]) == (503, "Dizin sunucusuna ulaşılamıyor")
    await asyncio.sleep(0.2)                             # nothing left running asks later
    assert _lookups(directory) <= ADMIN_LANE_SLOTS
    assert await _imported(db_session, *ids) == 0


async def test_every_admin_directory_call_takes_the_lane_and_sign_in_never_does(client, world,
                                                                               db_session):
    c, app = client
    admin = await bearer(db_session, world["admin"])
    directory, lane = world["directory"], app.state.ldap.admin_lane
    tokens = (await c.post("/auth/login", json={"login": "ayilmaz",
                                                 "password": AD_PASSWORD})).json()
    for _ in range(ADMIN_LANE_SLOTS):                    # the lane is full
        await lane.acquire()
    directory.calls.clear()
    pending = [asyncio.create_task(c.request(method, path, headers=admin, json=body))
               for method, path, body in _routes(world)[1:5]]   # test, search, groups, import
    try:
        assert (await c.post("/auth/login", json={"login": "ayilmaz", "password": AD_PASSWORD})
                ).status_code == 200
        assert (await c.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
                ).status_code == 200
        await asyncio.sleep(0.1)
        assert not any(task.done() for task in pending)
        assert {method for method, _ in directory.calls} == {"authenticate",
                                                             "find_by_external_id"}
        assert len(directory.calls) == 2                 # the sign-in's and the refresh's
    finally:
        for _ in range(ADMIN_LANE_SLOTS):
            lane.release()
    assert [r.status_code for r in await asyncio.gather(*pending)] == [200] * 4


async def test_a_search_queued_behind_long_imports_is_503_within_its_deadline(world, db_session):
    """The admin lane is full — two imports against a domain controller that never answers,
    their lookups cut off at the deadline but their threads still running, each holding its
    place — and an administrator searches: the search waits for a place at most its deadline
    and answers 503, instead of hanging until the lane frees up. The real Ldap3Directory, over
    a connection that never opens."""
    release, connects = threading.Event(), []

    def hung(user, password):
        connects.append(user)
        release.wait(5)
        raise OSError("the domain controller never answered")

    directory = Ldap3Directory(load_ldap_config(LDAP_ENV), connect=hung, deadline_s=0.3)
    try:
        async with ad_client(db_session, directory) as (c, app):
            admin = await bearer(db_session, world["admin"])
            ids = [str(uuid.uuid4()) for _ in range(4)]
            imports = [asyncio.create_task(c.post("/admin/ldap/import", headers=admin,
                                                  json={"external_ids": ids[k:k + 2]}))
                       for k in (0, 2)]
            while len(connects) < ADMIN_LANE_SLOTS:
                await asyncio.sleep(0.01)
            assert app.state.ldap.admin_lane.locked()
            started = time.monotonic()
            res = await asyncio.wait_for(c.get("/admin/ldap/search?q=kaya", headers=admin), 3)
            waited = time.monotonic() - started
            assert [r.status_code for r in await asyncio.gather(*imports)] == [503, 503]
    finally:
        release.set()
        directory.close()
    assert (res.status_code, res.json()["detail"]) == (503, "Dizin sunucusuna ulaşılamıyor")
    assert waited < 0.3 + 0.5
    assert len(connects) == ADMIN_LANE_SLOTS             # the search never reached the server


def _checked_out(db_session) -> int:
    """Connections of the test database's pool in use right now, the test's own included."""
    return db_session.bind.pool.checkedout()


@pytest.mark.parametrize("method, path, asks", [
    ("POST", "/admin/ldap/test", "test_connection"),
    ("GET", "/admin/ldap/search?q=kaya", "search_users"),
    ("GET", "/admin/ldap/groups?q=yb", "search_groups"),
    ("POST", "/admin/ldap/import", "find_by_external_id"),
])
async def test_no_database_connection_is_held_while_the_directory_answers(
        client, world, db_session, method, path, asks):
    """Plan D7, for administration too: the directory may take its deadline, after waiting as
    long for an admin-lane place — the request's database connection goes back to the pool
    first, so a slow domain controller cannot pin the pool (and with it the board). Counted
    in the pool itself, at the moment the directory is asked."""
    c, _ = client
    admin = await bearer(db_session, world["admin"])
    directory = world["directory"]
    answer = getattr(directory, asks)
    held: list[int] = []

    async def observed(*args, **kwargs):
        held.append(_checked_out(db_session) - baseline)
        return await answer(*args, **kwargs)

    setattr(directory, asks, observed)
    body = ({"external_ids": [world["mkaya"].identity.external_id]}
            if path.endswith("/import") else None)
    baseline = _checked_out(db_session)
    res = await c.request(method, path, headers=admin, json=body)
    assert res.status_code == 200, res.text
    assert held == [0]


async def test_an_import_re_checks_the_callers_rights_after_the_directory_call(
        client, world, db_session):
    """The connection is released during the lookups, so nothing read before them is trusted
    after: the import re-reads the caller under the tenant lock (`_begin`). Rights taken away
    while the directory answered (the token version bumped): 401 `token_version`, nothing
    written."""
    c, _ = client
    admin = await bearer(db_session, world["admin"])
    directory = world["directory"]
    answer = directory.find_by_external_id

    async def demote_then_answer(external_id, **kwargs):
        await db_session.execute(update(User).where(User.id == world["admin"].id)
                                 .values(token_version=User.token_version + 1))
        await db_session.commit()
        return await answer(external_id, **kwargs)

    directory.find_by_external_id = demote_then_answer
    mkaya = world["mkaya"].identity.external_id
    res = await c.post("/admin/ldap/import", headers=admin, json={"external_ids": [mkaya]})
    assert (res.status_code, res.json()["detail"]) == (401, "token_version")
    assert await _imported(db_session, mkaya) == 0


@pytest.mark.parametrize("body", [
    {"external_ids": []}, {"external_ids": ["not-a-guid"]},
    {"external_ids": [str(uuid.uuid4()) for _ in range(51)]},
])
async def test_the_import_body_is_bounded(client, world, db_session, body):
    c, _ = client
    admin = await bearer(db_session, world["admin"])
    assert (await c.post("/admin/ldap/import", headers=admin, json=body)).status_code == 422


# ---------------------------------------------------------------- the mapping table
async def test_the_mapping_table_shows_this_tenants_rows(client, world, db_session):
    c, _ = client
    admin = await bearer(db_session, world["admin"])
    rows = (await c.get("/admin/ldap/group-mappings", headers=admin)).json()
    assert [(r["ad_group_dn"], r["group_slug"]) for r in rows] == [
        (group_dn("YB-Hekim").lower(), "physician"), (group_dn("YB-Hemsire").lower(), "nurse"),
        (group_dn("YB-Sorumlu").lower(), "charge_nurse")]
    assert str(world["foreign_mapping"].id) not in {r["id"] for r in rows}


async def test_a_mapping_is_stored_once_with_its_dn_lowercased(client, world, db_session):
    c, app = client
    admin = await bearer(db_session, world["admin"])
    body = {"ad_group_dn": "  CN=YB-Eczaci,OU=Gruplar,DC=HASTANE,DC=LOCAL ",
            "group_id": str(world["groups"]["pharmacist"].id)}
    res = await c.post("/admin/ldap/group-mappings", headers=admin, json=body)
    assert res.status_code == 201, res.text
    assert (res.json()["ad_group_dn"], res.json()["group_slug"]) == (
        "cn=yb-eczaci,ou=gruplar,dc=hastane,dc=local", "pharmacist")
    again = await c.post("/admin/ldap/group-mappings", headers=admin, json={
        **body, "ad_group_dn": "cn=yb-eczaci,ou=gruplar,dc=hastane,dc=local"})
    assert (again.status_code, again.json()["detail"]) == (409, "Bu AD grubu bu gruba zaten eşlenmiş")
    foreign = await c.post("/admin/ldap/group-mappings", headers=admin, json={
        **body, "group_id": str(world["other_groups"]["nurse"].id)})
    assert foreign.status_code == 422
    short = await c.post("/admin/ldap/group-mappings", headers=admin,
                         json={**body, "ad_group_dn": "yb"})
    assert short.status_code == 422
    assert [r.payload["after"] for r in audit_events(app, "admin", "ldap.mapping.create")] == [
        {"ad_group_dn": "cn=yb-eczaci,ou=gruplar,dc=hastane,dc=local", "group": "pharmacist"}]


async def test_a_mapping_dn_is_stored_in_its_canonical_spelling(client, world, db_session):
    """Spacing, escaping and case never make one AD group two rows: the DN is stored canonical
    (`canonical_dn`, as the sign-in compares AD's memberOf), and another spelling of a mapped DN
    is the 409 duplicate — a row stored before canonicalisation included."""
    c, _ = client
    admin = await bearer(db_session, world["admin"])
    pharmacist, nurse = world["groups"]["pharmacist"].id, world["groups"]["nurse"].id
    res = await c.post("/admin/ldap/group-mappings", headers=admin, json={
        "ad_group_dn": r"CN=Eczane\2C Göğüs Cerrahisi, OU=Gruplar, DC=hastane, DC=local",
        "group_id": str(pharmacist)})
    assert res.status_code == 201, res.text
    assert res.json()["ad_group_dn"] == (
        r"cn=eczane\, göğüs cerrahisi,ou=gruplar,dc=hastane,dc=local")
    again = await c.post("/admin/ldap/group-mappings", headers=admin, json={
        "ad_group_dn": r"cn=ECZANE\, GÖĞÜS CERRAHISI,ou=Gruplar,dc=HASTANE,dc=LOCAL",
        "group_id": str(pharmacist)})
    assert (again.status_code, again.json()["detail"]) == (409, ldap_service.MAPPING_EXISTS)
    db_session.add(LdapGroupMapping(tenant_id=world["tenant"].id, group_id=nurse,
                                    ad_group_dn="cn=yb-eski, ou=gruplar, dc=hastane, dc=local"))
    await db_session.commit()
    legacy = await c.post("/admin/ldap/group-mappings", headers=admin, json={
        "ad_group_dn": group_dn("YB-Eski"), "group_id": str(nurse)})
    assert (legacy.status_code, legacy.json()["detail"]) == (409, ldap_service.MAPPING_EXISTS)


async def test_a_mapping_to_a_name_ending_in_backslash_space_grants_only_that_group(
        client, world, db_session):
    """`Eczane\\ ` (a backslash, then a space) and `Eczane\\` are two AD groups. The DN is
    canonicalised by the validator, again by `create_mapping`, and AD's memberOf at every
    sign-in: a second pass that dropped the escaped trailing space once stored the mapping as
    the SIBLING's DN and granted its rights to the sibling's members."""
    c, _ = client
    admin = await bearer(db_session, world["admin"])
    res = await c.post("/admin/ldap/group-mappings", headers=admin, json={
        "ad_group_dn": r"CN=Eczane\5C\20,OU=Gruplar,DC=hastane,DC=local",
        "group_id": str(world["groups"]["pharmacist"].id)})
    assert res.status_code == 201, res.text
    assert res.json()["ad_group_dn"] == r"cn=eczane\\\ ,ou=gruplar,dc=hastane,dc=local"
    member = person("Eczaci", groups=(r"CN=Eczane\\\ ,OU=Gruplar,DC=hastane,DC=local",))
    sibling = person("Komsu", groups=(r"CN=Eczane\\,OU=Gruplar,DC=hastane,DC=local",))
    for p in (member, sibling):
        world["directory"].add(p)
        await add_directory_account(db_session, world["tenant"].id, p)
    await db_session.commit()
    for login, groups in (("eczaci", ["pharmacist"]), ("komsu", [])):
        signed = await c.post("/auth/login", json={"login": login, "password": AD_PASSWORD})
        assert signed.status_code == 200, signed.text
        assert decode_token(signed.json()["access_token"])["groups"] == groups, login


@pytest.mark.parametrize("dn", [
    "CN=a\x00b,DC=x", r"CN=a\00b,DC=x", "CN=a\nb,DC=x", "CN=a,b", "CN=x,,DC=y", "CN=,DC=x",
    r"CN=a\zb,DC=x", "CN=YB-Yeni;DC=x",
])
async def test_a_mapping_dn_that_is_not_one_is_a_422(client, world, db_session, dn):
    """A malformed DN, or one carrying a control character (NUL included, raw or escaped — the
    database would refuse it with a 500), is refused by the body's validator, field by field."""
    c, _ = client
    admin = await bearer(db_session, world["admin"])
    before = await _mapping_rows(db_session)
    res = await c.post("/admin/ldap/group-mappings", headers=admin, json={
        "ad_group_dn": dn, "group_id": str(world["groups"]["pharmacist"].id)})
    assert res.status_code == 422, res.text
    [error] = res.json()["detail"]
    assert (error["loc"][-1], error["type"]) == ("ad_group_dn", "value_error")
    assert "ad_group_dn must be a distinguished name" in error["msg"]
    assert await _mapping_rows(db_session) == before


async def test_deleting_a_mapping_takes_the_rights_it_gave_away_now(client, world, db_session):
    c, app = client
    admin = await bearer(db_session, world["admin"])
    ayse_id = world["account"].id
    res = await c.put(f"/admin/users/{ayse_id}/groups", headers=admin,
                      json={"group_ids": [str(world["groups"]["charge_nurse"].id)]})
    assert res.status_code == 200
    login = await c.post("/auth/login", json={"login": "ayilmaz", "password": AD_PASSWORD})
    ayse = {"Authorization": f"Bearer {login.json()['access_token']}"}
    assert (await c.get("/auth/me", headers=ayse)).status_code == 200
    mapping = world["mappings"]["YB-Hemsire"]
    res = await c.delete(f"/admin/ldap/group-mappings/{mapping.id}", headers=admin)
    assert res.status_code == 204
    assert (await c.get("/auth/me", headers=ayse)).status_code == 401      # tokens retired
    assert await group_rows(db_session, ayse_id) == {("charge_nurse", "manual")}
    [event] = audit_events(app, "admin", "ldap.mapping.delete")
    assert event.payload["before"] == {"ad_group_dn": group_dn("YB-Hemsire").lower(),
                                       "group": "nurse"}
    assert event.payload["after"] == {"removed_from": ["ayilmaz"]}
    assert (await c.delete(f"/admin/ldap/group-mappings/{mapping.id}",
                           headers=admin)).status_code == 404
    assert (await c.delete(f"/admin/ldap/group-mappings/{world['foreign_mapping'].id}",
                           headers=admin)).status_code == 404


MAPPING_ADMIN_ONLY = "AD grup eşlemesini yalnız sistem yöneticisi değiştirebilir"


async def _mapping_rows(db) -> set[tuple[str, uuid.UUID]]:
    rows = await db.execute(select(LdapGroupMapping.ad_group_dn, LdapGroupMapping.group_id))
    return set(rows.all())


async def test_only_a_full_administrator_writes_the_mapping_table(client, world, db_session):
    """A mapping is tenant-wide policy: it regroups every member of the AD group at their next
    sign-in or refresh. Creating or deleting one therefore needs the whole catalogue (the system
    group), not `users.manage` — a user desk is refused even a mapping wholly within its own
    rights (YB-Yeni → nurse), and the deletion of one whose group and members are within them
    (nobody holds `nurse` through YB-Hemsire yet). It learns nothing about ids either, and it may
    still read the table."""
    c, _ = client
    desk = await bearer(db_session, world["desk"])
    admin = await bearer(db_session, world["admin"])
    before = await _mapping_rows(db_session)
    body = {"ad_group_dn": group_dn("YB-Yeni"), "group_id": str(world["groups"]["nurse"].id)}
    res = await c.post("/admin/ldap/group-mappings", headers=desk, json=body)
    assert (res.status_code, res.json()["detail"]) == (403, MAPPING_ADMIN_ONLY)
    for mapping_id in (world["mappings"]["YB-Hemsire"].id, uuid.uuid4()):
        res = await c.delete(f"/admin/ldap/group-mappings/{mapping_id}", headers=desk)
        assert (res.status_code, res.json()["detail"]) == (403, MAPPING_ADMIN_ONLY)
    assert await _mapping_rows(db_session) == before
    assert (await c.get("/admin/ldap/group-mappings", headers=desk)).status_code == 200
    created = await c.post("/admin/ldap/group-mappings", headers=admin, json=body)
    assert created.status_code == 201, created.text
    assert (await c.delete(f"/admin/ldap/group-mappings/{created.json()['id']}",
                           headers=admin)).status_code == 204
    assert (await c.delete(f"/admin/ldap/group-mappings/{world['mappings']['YB-Hemsire'].id}",
                           headers=admin)).status_code == 204


async def test_a_user_desk_cannot_regroup_ad_members_through_a_mapping(client, world,
                                                                       db_session):
    """Review probe P1. A pharmacy desk (pharmacist + users.manage) may not move Ayşe — a nurse
    through YB-Hemsire — into its own group: her rights are not within its own. Mapping her AD
    group to that group would do the same to every YB-Hemsire member at their next sign-in, and
    pool the desk's rights with the nurses' on them. It is refused, and her next sign-in is
    unchanged."""
    c, _ = client
    pharmacy = Group(tenant_id=world["tenant"].id, slug="eczane_masasi", name="Eczane Masası")
    pharmacy.permissions = [GroupPermission(permission=k) for k in sorted(
        set(world["groups"]["pharmacist"].permission_keys) | {"users.manage"})]
    db_session.add(pharmacy)
    await db_session.commit()
    deskb = await bearer(db_session, await add_user(db_session, username="eczmasa",
                                                    tenant_id=world["tenant"].id,
                                                    group=pharmacy))
    ayse_id = world["account"].id
    login = {"login": "ayilmaz", "password": AD_PASSWORD}
    assert (await c.post("/auth/login", json=login)).status_code == 200      # nurse, from AD
    res = await c.put(f"/admin/users/{ayse_id}/groups", headers=deskb,
                      json={"group_ids": [str(pharmacy.id)]})
    assert res.status_code == 403 and "Kendi yetkilerinizi aşan" in res.json()["detail"]
    res = await c.post("/admin/ldap/group-mappings", headers=deskb, json={
        "ad_group_dn": group_dn("YB-Hemsire"), "group_id": str(pharmacy.id)})
    assert (res.status_code, res.json()["detail"]) == (403, MAPPING_ADMIN_ONLY)
    again = await c.post("/auth/login", json=login)
    assert decode_token(again.json()["access_token"])["groups"] == ["nurse"]
    assert await group_rows(db_session, ayse_id) == {("nurse", "ldap")}


async def test_in_a_tenant_without_a_local_administrator_a_mapping_can_still_be_deleted(
        client, world, db_session):
    """The guard refuses only a deletion that takes the tenant from some active LOCAL
    administrators to none — as the sign-in sync's does. A tenant that has none already (its
    one local administrator deactivated; `admin2`, without a password, does not count) must not
    have its mapping table frozen: deleting a row that removes nobody, or somebody, goes
    through."""
    c, _ = client
    tenant_id, ayse_id = world["tenant"].id, world["account"].id
    # Plain ids: rolling back the count below expires `world`'s objects.
    mapping_ids = [world["mappings"][name].id for name in ("YB-Hekim", "YB-Hemsire")]
    admin2 = await add_user(db_session, username="admin2", tenant_id=tenant_id,
                            group=world["groups"]["hospital_admin"])
    headers = await bearer(db_session, admin2)
    assert (await c.post("/auth/login", json={"login": "ayilmaz", "password": AD_PASSWORD})
            ).status_code == 200                                 # nurse, through YB-Hemsire
    await db_session.execute(update(User).where(User.id == world["admin"].id)
                             .values(is_active=False))
    await db_session.commit()
    assert await ldap_service.count_admins(db_session, tenant_id) == 0
    await db_session.rollback()                                  # the count took the lock
    for mapping_id in mapping_ids:                               # removes nobody, then Ayşe
        res = await c.delete(f"/admin/ldap/group-mappings/{mapping_id}", headers=headers)
        assert res.status_code == 204, (mapping_id, res.text)
    assert await group_rows(db_session, ayse_id) == set()


async def test_a_mapping_deletion_that_leaves_no_local_administrator_is_refused(
        world, db_session):
    """The guard itself, from some local administrators to none — data the API never produces
    (a LOCAL account holding hospital_admin through an `ldap` row, the tenant's only one), built
    by hand to reach it: 409, and nothing is removed."""
    tenant_id, admin_id = world["tenant"].id, world["admin"].id
    system = world["groups"]["hospital_admin"]
    await db_session.execute(delete(UserGroup).where(UserGroup.user_id == admin_id))
    db_session.add(UserGroup(user_id=admin_id, group_id=system.id, source=SOURCE_LDAP))
    mapping = await add_mapping(db_session, tenant_id, group_dn("YB-Yonetim"), system)
    await db_session.commit()
    actor = Actor(id=admin_id, perms=ALL_PERMISSIONS, token_version=0)
    with pytest.raises(AdminError) as refused:
        await ldap_service.delete_mapping(db_session, tenant_id, actor, mapping.id)
    await db_session.rollback()
    assert (refused.value.status_code, refused.value.detail) == (409, LAST_ADMIN)
    assert await group_rows(db_session, admin_id) == {("hospital_admin", SOURCE_LDAP)}


async def test_ldap_admin_changes_are_audited_without_a_secret(client, world, db_session):
    c, app = client
    admin = await bearer(db_session, world["admin"])
    await c.post("/admin/ldap/test", headers=admin)
    await c.post("/admin/ldap/import", headers=admin,
                 json={"external_ids": [world["bdemir"].identity.external_id]})
    created = (await c.post("/admin/ldap/group-mappings", headers=admin, json={
        "ad_group_dn": group_dn("YB-Eczaci"),
        "group_id": str(world["groups"]["pharmacist"].id)})).json()
    assert (await c.delete(f"/admin/ldap/group-mappings/{created['id']}",
                           headers=admin)).status_code == 204
    records = [r for r in app.state.audit.records(event_type="admin", limit=10_000)
               if r.subject.startswith("ldap.")]
    assert {r.subject for r in records} == {
        "ldap.test", "ldap.import", "ldap.mapping.create", "ldap.mapping.delete"}
    assert {r.payload["actor"] for r in records} == {"admin"}
    trail = str([r.payload for r in records])
    assert AD_PASSWORD not in trail and ADMIN_PASSWORD not in trail


# ---------------------------------------------------------------- the sign-in unlock
WRONG = "Yanlis-Parola-9"


async def _throttle(c, login: str) -> None:
    """Three wrong passwords: the account's next sign-in is refused without asking AD."""
    for _ in range(3):
        assert (await c.post("/auth/login", json={"login": login, "password": WRONG})
                ).status_code == 401
    assert (await c.post("/auth/login", json={"login": login, "password": AD_PASSWORD})
            ).status_code == 429


def _authenticates(directory) -> int:
    return sum(1 for method, _ in directory.calls if method == "authenticate")


REASON = "Vardiya başında parolasını üç kez yanlış yazdı; telefonla doğrulandı"


async def _unlock(c, user_id, headers, reason: str | None = REASON):
    return await c.post(f"/admin/users/{user_id}/unlock-sign-in", headers=headers,
                        json=None if reason is None else {"reason": reason})


def _throttle_directly(user_id) -> str:
    """Three failed binds recorded for the account, as three wrong passwords would leave them."""
    key = str(user_id)
    for _ in range(3):
        assert directory_binds.begin(key)
        directory_binds.end(key, failed=True)
    return key


async def test_an_administrator_unlocks_a_throttled_ad_account(client, world, db_session):
    """The clinician who mistyped three times and is waiting at the ward PC: the administrator
    clears the throttle, and the next sign-in goes to the directory at once. The reason the
    administrator gave is in the audit row."""
    c, app = client
    admin = await bearer(db_session, world["admin"])
    ayse_id = world["account"].id
    await _throttle(c, "ayilmaz")
    asked = _authenticates(world["directory"])
    res = await _unlock(c, ayse_id, admin)
    assert (res.status_code, res.json()) == (200, {"ok": True})
    assert (await c.post("/auth/login", json={"login": "ayilmaz", "password": AD_PASSWORD})
            ).status_code == 200
    assert _authenticates(world["directory"]) == asked + 1
    [event] = audit_events(app, "admin", "user.sign_in_unlocked")
    assert event.payload == {"actor": "admin", "target": str(ayse_id),
                             "before": {"failed_sign_ins": 3}, "after": {"failed_sign_ins": 0},
                             "reason": REASON}
    assert event.tenant == TENANT_SLUG
    assert WRONG not in str(event.payload) and AD_PASSWORD not in str(event.payload)


async def test_a_second_unlock_within_the_window_is_refused(client, world, db_session):
    """One unlock per account per DIRECTORY_BIND_WINDOW_S: each unlock lets three more wrong
    passwords reach the domain controller, so within 15 minutes Homunculus makes at most
    3 + 3 failed binds for one account — the figure the hospital's AD lockout threshold must
    stay above. A second unlock is 409 and clears nothing; the account stays throttled."""
    c, app = client
    admin = await bearer(db_session, world["admin"])
    ayse_id = world["account"].id
    await _throttle(c, "ayilmaz")
    assert (await _unlock(c, ayse_id, admin)).status_code == 200
    await _throttle(c, "ayilmaz")
    res = await _unlock(c, ayse_id, admin)
    assert (res.status_code, res.json()["detail"]) == (409, UNLOCK_COOLDOWN)
    assert (await c.post("/auth/login", json={"login": "ayilmaz", "password": AD_PASSWORD})
            ).status_code == 429
    assert len(audit_events(app, "admin", "user.sign_in_unlocked")) == 1


@pytest.mark.parametrize("body", [
    None, {}, {"reason": ""}, {"reason": "   "}, {"reason": "x" * 201},
    {"reason": "iki\nsatır"}, {"reason": "boş\x00karakter"}, {"reason": "sekme\tile"},
])
async def test_an_unlock_needs_a_one_line_reason(client, world, db_session, body):
    """The reason goes to the audit row: required, not blank, at most 200 characters, one line
    with no control character (nothing that could forge a line in an exported trail)."""
    c, app = client
    admin = await bearer(db_session, world["admin"])
    key = _throttle_directly(world["account"].id)
    res = await c.post(f"/admin/users/{world['account'].id}/unlock-sign-in", headers=admin,
                       json=body)
    assert res.status_code == 422, res.text
    assert directory_binds.begin(key) is False                      # still throttled
    assert audit_events(app, "admin", "user.sign_in_unlocked") == []


async def test_an_unlock_reason_is_stored_trimmed(client, world, db_session):
    c, app = client
    admin = await bearer(db_session, world["admin"])
    _throttle_directly(world["account"].id)
    assert (await _unlock(c, world["account"].id, admin, "  " + "ş" * 200 + "  ")
            ).status_code == 422                                    # 204 characters as sent
    assert (await _unlock(c, world["account"].id, admin, "  Telefonla doğrulandı  ")
            ).status_code == 200
    [event] = audit_events(app, "admin", "user.sign_in_unlocked")
    assert event.payload["reason"] == "Telefonla doğrulandı"


async def test_a_platform_operator_or_a_shared_account_is_not_unlocked_here(client, world,
                                                                           db_session):
    """As for a password or MFA reset (`_refuse_global_account`): the throttle is one per
    account, not per hospital, so one hospital must not lift it for an account another
    hospital — or the vendor — relies on."""
    c, app = client
    admin = await bearer(db_session, world["admin"])
    operator = await add_user(db_session, username="vendor_op", tenant_id=world["tenant"].id,
                              group=world["groups"]["nurse"], platform_support=True)
    shared = await add_user(db_session, username="paylasilan", tenant_id=world["tenant"].id,
                            group=world["groups"]["nurse"])
    db_session.add(TenantMembership(user_id=shared.id,
                                    tenant_id=world["other_groups"]["nurse"].tenant_id))
    await db_session.commit()
    for account, detail in ((operator, admin_service.PLATFORM_ACCOUNT),
                            (shared, admin_service.SHARED_ACCOUNT)):
        key = _throttle_directly(account.id)
        res = await _unlock(c, account.id, admin)
        assert (res.status_code, res.json()["detail"]) == (409, detail), account.username
        assert directory_binds.begin(key) is False                  # still throttled
    assert audit_events(app, "admin", "user.sign_in_unlocked") == []


async def test_an_administrator_may_unlock_their_own_sign_in(client, world, db_session):
    """Unlike a password or MFA reset, unlocking oneself hands nothing over: the next sign-in
    still needs the password."""
    c, _ = client
    admin = await bearer(db_session, world["admin"])
    key = _throttle_directly(world["admin"].id)
    assert (await _unlock(c, world["admin"].id, admin)).status_code == 200
    assert directory_binds.begin(key) is True
    directory_binds.end(key, failed=False)


async def test_a_user_desk_unlocks_only_accounts_within_its_rights(client, world, db_session):
    """The rule of every action on a user: nothing on an account that can do more than you."""
    c, _ = client
    admin, desk = await bearer(db_session, world["admin"]), await bearer(db_session,
                                                                          world["desk"])
    res = await c.post("/admin/ldap/import", headers=admin,
                       json={"external_ids": [world["mkaya"].identity.external_id]})
    mkaya_id = res.json()["imported"][0]["id"]               # charge_nurse, through YB-Sorumlu
    await _throttle(c, "mkaya")
    res = await _unlock(c, mkaya_id, desk)
    assert res.status_code == 403 and "Kendi yetkilerinizi aşan" in res.json()["detail"]
    assert (await c.post("/auth/login", json={"login": "mkaya", "password": AD_PASSWORD})
            ).status_code == 429                             # still throttled
    await _throttle(c, "ayilmaz")                            # no groups yet: within the desk's
    res = await _unlock(c, world["account"].id, desk)
    assert res.status_code == 200
    assert (await c.post("/auth/login", json={"login": "ayilmaz", "password": AD_PASSWORD})
            ).status_code == 200


async def test_another_tenants_account_is_not_found_and_stays_throttled(client, world,
                                                                        db_session):
    c, _ = client
    admin = await bearer(db_session, world["admin"])
    other_tenant = world["other_groups"]["nurse"].tenant_id
    stranger = await add_user(db_session, username="baska", tenant_id=other_tenant,
                              group=world["other_groups"]["nurse"])
    key = _throttle_directly(stranger.id)
    theirs = await _unlock(c, stranger.id, admin)
    missing = await _unlock(c, uuid.uuid4(), admin)
    assert theirs.status_code == 404
    assert (theirs.status_code, theirs.json()) == (missing.status_code, missing.json())
    assert directory_binds.begin(key) is False


async def test_a_caller_without_users_manage_cannot_unlock(client, world, db_session):
    c, _ = client
    nurse = await bearer(db_session, world["nurse"])
    await _throttle(c, "ayilmaz")
    res = await _unlock(c, world["account"].id, nurse)
    assert res.status_code == 403
    assert (await c.post("/auth/login", json={"login": "ayilmaz", "password": AD_PASSWORD})
            ).status_code == 429


# ---------------------------------------------------------------- a delete racing a sync
async def _until_the_sign_in_waits_for_the_admin_lock(db: AsyncSession, tenant_id: uuid.UUID,
                                                      sign_in: asyncio.Task) -> None:
    """Return once some session is queued on THIS tenant's admin lock (`lock_admin_guard`'s
    bigint advisory key: high half in pg_locks.classid, low half in objid, objsubid 1) — not on
    another test run's session lock. Fail if the sign-in finishes without queueing, or after
    5 s."""
    key = f"homunculus.admin-guard:{tenant_id}"
    for _ in range(250):
        if sign_in.done():
            raise AssertionError("the sign-in finished without waiting for the admin lock")
        waiting = (await db.execute(text(
            "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted"
            " AND objsubid = 1"
            " AND classid::bigint = ((hashtextextended(:key, 0) >> 32) & 4294967295)"
            " AND objid::bigint = (hashtextextended(:key, 0) & 4294967295)"),
            {"key": key})).scalar_one()
        await db.rollback()
        if waiting:
            return
        await asyncio.sleep(0.02)
    raise AssertionError("the sign-in never queued on the tenant's admin lock")


@pytest.mark.parametrize("via", ["api", "service"])
async def test_a_mapping_delete_and_a_concurrent_sign_in_end_consistent(client, world,
                                                                        db_session,
                                                                        monkeypatch, via):
    """Plan D13 with the tenant lock taken BEFORE the rows are deleted. Ayşe (YB-Hemsire, not
    yet signed in) signs in while the YB-Hemsire → nurse mapping is being deleted: the delete
    has removed the mapping and its `ldap` rows but not committed, so her sync still reads the
    mapping and decides to add `nurse`. It must then wait for the tenant lock and decide again
    once the delete has committed — not insert a `nurse` row no mapping accounts for. Made
    deterministic: the sign-in starts inside the delete, just before its administrator guard's
    second count (the one after the rows are gone; the first is taken before them), and the
    delete commits only once the sign-in is queued on the lock. `service` calls
    `delete_mapping` without the router's `serialise`: the function holds the lock itself.
    (The other order — the sync commits first — is the delete's ordinary case, above.)"""
    c, app = client
    # Plain ids: the lock poll rolls the test's session back, which expires `world`'s objects.
    tenant_id, ayse_id, admin_id = world["tenant"].id, world["account"].id, world["admin"].id
    mapping_id = world["mappings"]["YB-Hemsire"].id
    count_admins = ldap_service.count_admins
    counts: list[int] = []
    sign_in: list[asyncio.Task] = []

    async def guard_while_ayse_signs_in(db, tid):
        counts.append(1)
        if len(counts) == 2:                                   # after the rows are deleted
            sign_in.append(asyncio.create_task(
                c.post("/auth/login", json={"login": "ayilmaz", "password": AD_PASSWORD})))
            await _until_the_sign_in_waits_for_the_admin_lock(db_session, tenant_id,
                                                              sign_in[0])
        return await count_admins(db, tid)

    monkeypatch.setattr(ldap_service, "count_admins", guard_while_ayse_signs_in)
    if via == "api":
        admin = await bearer(db_session, world["admin"])
        res = await c.delete(f"/admin/ldap/group-mappings/{mapping_id}", headers=admin)
        assert res.status_code == 204, res.text
        [event] = audit_events(app, "admin", "ldap.mapping.delete")
        assert event.payload["after"] == {"removed_from": []}
    else:
        maker = async_sessionmaker(db_session.bind, expire_on_commit=False)
        async with maker() as session:
            actor = Actor(id=admin_id, perms=ALL_PERMISSIONS, token_version=0)
            removed = await ldap_service.delete_mapping(session, tenant_id, actor, mapping_id)
            await session.commit()
        assert removed.removed_from == ()
    assert len(counts) == 2 and len(sign_in) == 1                # before and after the rows
    res = await sign_in[0]
    assert res.status_code == 200, res.text
    assert decode_token(res.json()["access_token"])["groups"] == []
    assert await group_rows(db_session, ayse_id) == set()
    assert (await db_session.execute(select(func.count()).select_from(LdapGroupMapping).where(
        LdapGroupMapping.id == mapping_id))).scalar_one() == 0

# homunculus-engine/tests/test_admin_api.py
"""The administration API end to end: scoping to the caller's tenant, the guards that keep a
tenant administrable, token invalidation on change, and the audit trail.

Synthetic accounts only."""
from __future__ import annotations

import asyncio
import logging
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.ext.asyncio import async_sessionmaker

import homunculus.auth.groups as groups_module
from homunculus.admin import service
from homunculus.admin.service import Actor, AdminError
from homunculus.api.app import create_app
from homunculus.auth.dependencies import MEMBERSHIP_INACTIVE
from homunculus.auth.groups import (
    count_admins, ensure_default_groups, lock_admin_guard, set_manual_groups,
)
from homunculus.auth.jwt import create_access_token, decode_token
from homunculus.auth.models import (
    AUTH_LDAP, SOURCE_LDAP, Group, GroupPermission, TenantMembership, User, UserGroup,
)
from homunculus.auth.permissions import ALL_PERMISSIONS
from homunculus.auth.service import build_context, hash_password, issue_tokens
from homunculus.db import get_db
from homunculus.tenant.models import Tenant
from tests.conftest import requires_db

pytestmark = [pytest.mark.asyncio, requires_db]

PASSWORD = "Gizli-123"


async def _make_user(db, tenant, groups, username, group_slug, **kw):
    u = User(username=username, email=kw.pop("email", f"{username}@example.com"),
             full_name=username.title(),
             hashed_password=kw.pop("hashed_password", hash_password(PASSWORD)), **kw)
    db.add(u)
    await db.flush()
    db.add(TenantMembership(user_id=u.id, tenant_id=tenant.id))
    await db.flush()
    if group_slug:
        await set_manual_groups(db, user=u, tenant_id=tenant.id,
                                group_ids=[groups[group_slug].id], granted_by_id=None)
    return u


@pytest_asyncio.fixture
async def world(db_session):
    t = Tenant(name="Demo", slug="demo-hastanesi", country_code="TR")
    other = Tenant(name="Other", slug="other", country_code="TR")
    db_session.add_all([t, other])
    await db_session.flush()
    groups = await ensure_default_groups(db_session, t.id)
    other_groups = await ensure_default_groups(db_session, other.id)
    admin = await _make_user(db_session, t, groups, "admin", "hospital_admin")
    nurse = await _make_user(db_session, t, groups, "ayse", "nurse")
    ldap = await _make_user(db_session, t, groups, "ldapci", "nurse",
                            auth_source=AUTH_LDAP, hashed_password=None)
    stranger = await _make_user(db_session, other, other_groups, "yabanci", "nurse")
    await db_session.commit()
    return {"tenant": t, "groups": groups, "admin": admin, "nurse": nurse, "ldap": ldap,
            "stranger": stranger, "other_groups": other_groups}


@pytest_asyncio.fixture
async def client(db_session):
    """Every request gets its own session, as `get_db` gives it in production: a route that
    rolls back cannot expire the test's objects, and nothing a route reads comes from the
    test's identity map."""
    app = create_app({"bridge-token": "demo-hastanesi"}, run_escalation_loop=False)
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)

    async def _db():
        async with maker() as session:
            yield session

    app.dependency_overrides[get_db] = _db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c, app


async def _headers(db, user, *, mfa_verified=True):
    """Mint a token straight from the service, so an MFA group does not gate the tests."""
    ctx = await build_context(db, user)
    tokens = issue_tokens(user, ctx, mfa_verified=mfa_verified)
    return {"Authorization": f"Bearer {tokens['access_token']}"}, tokens


async def _fresh(db, user_id) -> User:
    """The committed row, not the test session's cached copy."""
    return (await db.execute(select(User).where(User.id == user_id)
                             .execution_options(populate_existing=True))).scalar_one()


# ---------------------------------------------------------------- permissions & groups

async def test_the_catalogue_needs_groups_manage(client, world, db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    nurse, _ = await _headers(db_session, world["nurse"])
    res = await c.get("/admin/permissions", headers=admin)
    assert res.status_code == 200 and {p["key"] for p in res.json()} >= {"board.view", "users.manage"}
    assert (await c.get("/admin/permissions", headers=nurse)).status_code == 403


async def test_groups_are_listed_with_member_counts(client, world, db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    groups = {g["slug"]: g for g in (await c.get("/admin/groups", headers=admin)).json()}
    assert groups["nurse"]["member_count"] == 2 and groups["hospital_admin"]["member_count"] == 1
    assert groups["hospital_admin"]["is_system"] is True
    assert "yabanci" not in str(groups)              # the other tenant's world is invisible
    assert {g["id"] for g in groups.values()} == {str(g.id) for g in world["groups"].values()}


async def test_the_system_group_reports_the_whole_catalogue_whatever_its_rows(client, world,
                                                                            db_session):
    """Its rights are a rule (spec §3); rows seeded before a key existed must not under-report."""
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    await db_session.execute(delete(GroupPermission).where(
        GroupPermission.group_id == world["groups"]["hospital_admin"].id,
        GroupPermission.permission.in_(["audit.view", "devices.manage"])))
    await db_session.commit()
    groups = {g["slug"]: g for g in (await c.get("/admin/groups", headers=admin)).json()}
    assert groups["hospital_admin"]["permissions"] == sorted(ALL_PERMISSIONS)


async def test_create_patch_and_delete_a_custom_group(client, world, db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    res = await c.post("/admin/groups", headers=admin, json={
        "slug": "it_destek", "name": "BT Destek", "description": "",
        "mfa_required": False, "permissions": ["users.manage"]})
    assert res.status_code == 201
    gid = res.json()["id"]
    assert (await c.post("/admin/groups", headers=admin, json={
        "slug": "it_destek", "name": "x", "permissions": []})).status_code == 409
    assert (await c.post("/admin/groups", headers=admin, json={
        "slug": "Kötü Slug", "name": "x", "permissions": []})).status_code == 422
    assert (await c.post("/admin/groups", headers=admin, json={
        "slug": "bilinmez", "name": "x", "permissions": ["alerts.acknowledge"]})).status_code == 422

    res = await c.patch(f"/admin/groups/{gid}", headers=admin,
                        json={"name": "BT", "permissions": ["users.manage", "audit.view"]})
    assert res.status_code == 200 and sorted(res.json()["permissions"]) == ["audit.view", "users.manage"]
    assert (await c.patch(f"/admin/groups/{gid}", headers=admin,
                          json={"permissions": ["users.manage", "no.such.key"]})).status_code == 422
    assert (await c.delete(f"/admin/groups/{gid}", headers=admin)).status_code == 204
    assert (await c.delete(f"/admin/groups/{gid}", headers=admin)).status_code == 404


async def test_system_and_populated_groups_cannot_be_deleted(client, world, db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    assert (await c.delete(f"/admin/groups/{world['groups']['hospital_admin'].id}",
                           headers=admin)).status_code == 409
    assert (await c.delete(f"/admin/groups/{world['groups']['nurse'].id}",
                           headers=admin)).status_code == 409


async def test_changing_a_groups_permissions_retires_its_members_tokens(client, world, db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    nurse, nurse_tokens = await _headers(db_session, world["nurse"])
    assert (await c.get("/auth/me", headers=nurse)).status_code == 200

    res = await c.patch(f"/admin/groups/{world['groups']['nurse'].id}", headers=admin,
                        json={"permissions": ["board.view"]})
    assert res.status_code == 200

    assert (await c.get("/auth/me", headers=nurse)).status_code == 401
    refreshed = (await c.post("/auth/refresh",
                              json={"refresh_token": nurse_tokens["refresh_token"]})).json()
    assert decode_token(refreshed["access_token"])["perms"] == ["board.view"]


async def test_changing_a_groups_mfa_rule_retires_its_members_tokens(client, world, db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    nurse, _ = await _headers(db_session, world["nurse"])
    res = await c.patch(f"/admin/groups/{world['groups']['nurse'].id}", headers=admin,
                        json={"mfa_required": True})
    assert res.status_code == 200 and res.json()["mfa_required"] is True
    assert (await c.get("/auth/me", headers=nurse)).status_code == 401


async def test_a_label_only_change_keeps_the_members_tokens(client, world, db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    nurse, _ = await _headers(db_session, world["nurse"])
    res = await c.patch(f"/admin/groups/{world['groups']['nurse'].id}", headers=admin,
                        json={"name": "Servis Hemşiresi", "description": "etiket"})
    assert res.status_code == 200
    assert (await c.get("/auth/me", headers=nurse)).status_code == 200


async def test_the_system_groups_rights_are_immutable_but_its_labels_are_not(client, world, db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    gid = world["groups"]["hospital_admin"].id
    assert (await c.patch(f"/admin/groups/{gid}", headers=admin,
                          json={"permissions": ["board.view"]})).status_code == 409
    assert (await c.patch(f"/admin/groups/{gid}", headers=admin,
                          json={"mfa_required": False})).status_code == 409
    res = await c.patch(f"/admin/groups/{gid}", headers=admin, json={"name": "BT Yönetimi"})
    assert res.status_code == 200 and res.json()["name"] == "BT Yönetimi"
    assert res.json()["permissions"] == sorted(ALL_PERMISSIONS)


async def test_the_last_administrator_cannot_lose_groups_manage_either(client, world, db_session):
    """An administrator holds the whole catalogue; moving the only one into a group that has
    just users.manage would leave nobody able to edit groups (or to grant anything)."""
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    res = await c.post("/admin/groups", headers=admin, json={
        "slug": "user_desk", "name": "Kullanıcı Masası", "permissions": ["users.manage"]})
    assert res.status_code == 201
    res = await c.put(f"/admin/users/{world['admin'].id}/groups", headers=admin,
                      json={"group_ids": [res.json()["id"]]})
    assert res.status_code == 409


async def test_the_last_system_group_member_may_not_leave_it_for_a_copy_of_its_keys(
        client, world, db_session):
    """Probe E12: the only administrator once moved from hospital_admin into a custom group
    holding every key (200). The day a release added a key, that group no longer held it, the
    count fell to 0, and the way back into hospital_admin was beyond their rights (403). Only
    the system group holds the whole catalogue by rule, so only its local members count."""
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    ha = str(world["groups"]["hospital_admin"].id)
    copy = (await c.post("/admin/groups", headers=admin, json={
        "slug": "tam_yetki", "name": "Tam Yetki",
        "permissions": sorted(ALL_PERMISSIONS)})).json()["id"]

    res = await c.put(f"/admin/users/{world['admin'].id}/groups", headers=admin,
                      json={"group_ids": [copy]})
    assert (res.status_code, res.json()["detail"]) == (409, service.LAST_ADMIN)
    assert await _groups_of(db_session, world["admin"].id) == ["hospital_admin"]
    # Holding the copy AS WELL is fine, and editing a custom group never touches the guard.
    res = await c.put(f"/admin/users/{world['admin'].id}/groups", headers=admin,
                      json={"group_ids": [copy, ha]})
    assert res.status_code == 200
    admin, _ = await _headers(db_session, await _fresh(db_session, world["admin"].id))
    assert (await c.patch(f"/admin/groups/{copy}", headers=admin,
                          json={"permissions": []})).status_code == 200


async def test_a_system_group_administrator_survives_a_catalogue_change(client, world, db_session,
                                                                      monkeypatch):
    """The control: a release adds a key. The system group holds it by rule, so its member is
    still an administrator, and still holds every right the rules compare against."""
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])      # minted before the change
    grown = frozenset(ALL_PERMISSIONS | {"future.key"})
    for module in (groups_module, service):
        monkeypatch.setattr(module, "ALL_PERMISSIONS", grown)
    async with async_sessionmaker(db_session.bind)() as check:
        assert await count_admins(check, world["tenant"].id) == 1
    res = await c.put(f"/admin/users/{world['nurse'].id}/groups", headers=admin,
                      json={"group_ids": [str(world["groups"]["charge_nurse"].id)]})
    assert res.status_code == 200
    res = await c.patch(f"/admin/groups/{world['groups']['nurse'].id}", headers=admin,
                        json={"permissions": ["board.view"]})
    assert res.status_code == 200


async def test_two_managing_keys_do_not_make_an_administrator(client, world, db_session):
    """Probe E9: with a local `bt` in {users.manage, groups.manage} the guard used to count 1,
    so the only full administrator could leave — and `bt`, unable to give any right it lacks,
    could then administer nobody. The guard now counts holders of the whole catalogue."""
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    it = (await c.post("/admin/groups", headers=admin, json={
        "slug": "it_admin", "name": "BT Yönetimi",
        "permissions": ["users.manage", "groups.manage"]})).json()
    res = await c.post("/admin/users", headers=admin, json={
        "username": "bt.yonetici", "full_name": "BT", "password": "Gecici-Parola-1",
        "group_ids": [it["id"]]})
    assert res.status_code == 201
    res = await c.put(f"/admin/users/{world['admin'].id}/groups", headers=admin,
                      json={"group_ids": [str(world["groups"]["nurse"].id)]})
    assert (res.status_code, res.json()["detail"]) == (409, service.LAST_ADMIN)
    res = await c.patch(f"/admin/users/{world['admin'].id}", headers=admin,
                        json={"full_name": "Hâlâ Yönetici"})
    assert res.status_code == 200
    assert await _groups_of(db_session, world["admin"].id) == ["hospital_admin"]


# ---------------------------------------------------------------- users

async def test_users_are_listed_with_their_groups_in_this_tenant(client, world, db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    users = {u["username"]: u for u in (await c.get("/admin/users", headers=admin)).json()}
    assert set(users) == {"admin", "ayse", "ldapci"}
    assert [g["slug"] for g in users["ayse"]["groups"]] == ["nurse"]
    assert users["ayse"]["groups"][0]["source"] == "manual"
    assert users["ldapci"]["auth_source"] == "ldap"
    assert "hashed_password" not in users["ayse"] and "totp_secret" not in users["ayse"]


async def test_create_a_local_user_who_can_then_sign_in(client, world, db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    res = await c.post("/admin/users", headers=admin, json={
        "username": "Selin.Arslan", "email": "Selin@Example.com", "full_name": "Selin Arslan",
        "password": "Gecici-Parola-1", "group_ids": [str(world["groups"]["charge_nurse"].id)]})
    assert res.status_code == 201
    body = res.json()
    assert body["username"] == "selin.arslan" and body["email"] == "selin@example.com"
    assert [g["slug"] for g in body["groups"]] == ["charge_nurse"]
    login = await c.post("/auth/login", json={"login": "selin.arslan", "password": "Gecici-Parola-1"})
    assert login.status_code == 200
    assert (await c.post("/admin/users", headers=admin, json={
        "username": "selin.arslan", "full_name": "x", "password": "Gecici-Parola-1"})).status_code == 409


async def test_a_new_user_in_another_tenants_group_is_refused_and_not_created(client, world,
                                                                             db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    res = await c.post("/admin/users", headers=admin, json={
        "username": "kacak", "full_name": "Kaçak", "password": "Gecici-Parola-1",
        "group_ids": [str(world["other_groups"]["nurse"].id)]})
    assert res.status_code == 422
    assert (await db_session.execute(
        select(User.id).where(User.username == "kacak"))).first() is None


async def test_set_groups_and_the_last_admin_guard(client, world, db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    nurse, _ = await _headers(db_session, world["nurse"])
    res = await c.put(f"/admin/users/{world['nurse'].id}/groups", headers=admin,
                      json={"group_ids": [str(world["groups"]["charge_nurse"].id)]})
    assert res.status_code == 200 and [g["slug"] for g in res.json()["groups"]] == ["charge_nurse"]
    assert (await c.get("/auth/me", headers=nurse)).status_code == 401   # the old token is dead

    tv = world["admin"].token_version
    res = await c.put(f"/admin/users/{world['admin'].id}/groups", headers=admin,
                      json={"group_ids": [str(world["groups"]["nurse"].id)]})
    assert res.status_code == 409                    # would leave nobody with users.manage
    assert res.json()["detail"] == service.LAST_ADMIN
    after = await _fresh(db_session, world["admin"].id)
    assert after.token_version == tv                 # rolled back: nothing left behind
    users = {u["username"]: u for u in (await c.get("/admin/users", headers=admin)).json()}
    assert [g["slug"] for g in users["admin"]["groups"]] == ["hospital_admin"]


async def test_setting_groups_leaves_directory_memberships_alone(client, world, db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    db_session.add(UserGroup(user_id=world["ldap"].id,
                             group_id=world["groups"]["physician"].id, source=SOURCE_LDAP))
    await db_session.commit()
    res = await c.put(f"/admin/users/{world['ldap'].id}/groups", headers=admin,
                      json={"group_ids": []})
    assert res.status_code == 200
    assert [(g["slug"], g["source"]) for g in res.json()["groups"]] == [("physician", "ldap")]


async def test_deactivation_guard_and_effect(client, world, db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    nurse, _ = await _headers(db_session, world["nurse"])
    res = await c.patch(f"/admin/users/{world['admin'].id}", headers=admin,
                        json={"is_active": False})
    assert res.status_code == 409 and res.json()["detail"] == service.SELF_DEACTIVATE
    assert (await _fresh(db_session, world["admin"].id)).is_active is True
    assert (await c.patch(f"/admin/users/{world['nurse'].id}", headers=admin,
                          json={"is_active": False})).status_code == 200
    assert (await c.get("/auth/me", headers=nurse)).status_code == 401


async def test_password_and_mfa_resets(client, world, db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    assert (await c.post(f"/admin/users/{world['nurse'].id}/reset-password", headers=admin,
                         json={"password": "Yeni-Parola-1"})).status_code == 200
    assert (await c.post("/auth/login", json={"login": "ayse", "password": "Yeni-Parola-1"})
            ).status_code == 200
    assert (await c.post(f"/admin/users/{world['ldap'].id}/reset-password", headers=admin,
                         json={"password": "Yeni-Parola-1"})).status_code == 400
    world["nurse"].totp_secret, world["nurse"].totp_enabled = "SECRET", True
    await db_session.commit()
    assert (await c.post(f"/admin/users/{world['nurse'].id}/reset-mfa", headers=admin)
            ).status_code == 200
    await db_session.refresh(world["nurse"])
    assert world["nurse"].totp_enabled is False and world["nurse"].totp_secret is None


async def test_resets_retire_the_users_access_tokens(client, world, db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    for route, body in (("reset-password", {"password": "Yeni-Parola-1"}), ("reset-mfa", None)):
        nurse, _ = await _headers(db_session, await _fresh(db_session, world["nurse"].id))
        assert (await c.get("/auth/me", headers=nurse)).status_code == 200
        res = await c.post(f"/admin/users/{world['nurse'].id}/{route}", headers=admin, json=body)
        assert res.status_code == 200
        assert (await c.get("/auth/me", headers=nurse)).status_code == 401, route


async def test_another_tenants_user_is_not_found(client, world, db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    assert (await c.patch(f"/admin/users/{world['stranger'].id}", headers=admin,
                          json={"full_name": "x"})).status_code == 404
    res = await c.put(f"/admin/users/{world['nurse'].id}/groups", headers=admin,
                      json={"group_ids": [str(world["other_groups"]["nurse"].id)]})
    assert res.status_code == 422                    # a group of another tenant


async def test_every_user_route_answers_another_tenants_user_like_a_missing_one(client, world,
                                                                              db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    before = await _fresh(db_session, world["stranger"].id)
    snapshot = (before.full_name, before.is_active, before.token_version, before.hashed_password)
    calls = [
        ("PATCH", "", {"full_name": "x", "is_active": False}),
        ("PUT", "/groups", {"group_ids": [str(world["groups"]["hospital_admin"].id)]}),
        ("POST", "/reset-password", {"password": "Ele-Gecirildi-1"}),
        ("POST", "/reset-mfa", None),
    ]
    for method, suffix, body in calls:
        theirs = await c.request(method, f"/admin/users/{world['stranger'].id}{suffix}",
                                 headers=admin, json=body)
        missing = await c.request(method, f"/admin/users/{uuid.uuid4()}{suffix}",
                                  headers=admin, json=body)
        assert (theirs.status_code, theirs.json()) == (missing.status_code, missing.json())
        assert theirs.status_code == 404, (method, suffix)
    after = await _fresh(db_session, world["stranger"].id)
    assert (after.full_name, after.is_active, after.token_version, after.hashed_password) == snapshot
    assert [link.group_id for link in (await db_session.execute(
        select(UserGroup).where(UserGroup.user_id == world["stranger"].id))).scalars()] == \
        [world["other_groups"]["nurse"].id]


async def test_every_group_route_answers_another_tenants_group_like_a_missing_one(client, world,
                                                                                db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    theirs_id = world["other_groups"]["physician"].id
    for method, body in (("PATCH", {"name": "x", "permissions": ["users.manage"]}),
                         ("DELETE", None)):
        theirs = await c.request(method, f"/admin/groups/{theirs_id}", headers=admin, json=body)
        missing = await c.request(method, f"/admin/groups/{uuid.uuid4()}", headers=admin,
                                  json=body)
        assert (theirs.status_code, theirs.json()) == (missing.status_code, missing.json())
        assert theirs.status_code == 404, method
    group = (await db_session.execute(select(Group).where(Group.id == theirs_id)
                                      .execution_options(populate_existing=True))).scalar_one()
    assert group.name == "Hekim" and "users.manage" not in group.permission_keys


async def test_a_nurse_is_refused_on_every_admin_route(client, world, db_session):
    c, _ = client
    nurse, _ = await _headers(db_session, world["nurse"])
    uid, gid = world["nurse"].id, world["groups"]["nurse"].id
    calls = [
        ("GET", "/admin/permissions", None), ("GET", "/admin/groups", None),
        ("POST", "/admin/groups", {"slug": "x_y", "name": "x"}),
        ("PATCH", f"/admin/groups/{gid}", {"name": "x"}),
        ("DELETE", f"/admin/groups/{gid}", None),
        ("GET", "/admin/users", None),
        ("POST", "/admin/users", {"username": "xx", "full_name": "x", "password": "12345678"}),
        ("PATCH", f"/admin/users/{uid}", {"full_name": "x"}),
        ("PUT", f"/admin/users/{uid}/groups", {"group_ids": []}),
        ("POST", f"/admin/users/{uid}/reset-password", {"password": "12345678"}),
        ("POST", f"/admin/users/{uid}/reset-mfa", None),
    ]
    for method, path, body in calls:
        res = await c.request(method, path, headers=nurse, json=body)
        assert res.status_code == 403, (method, path)


async def test_an_administrator_without_the_mfa_step_is_refused(client, world, db_session):
    c, _ = client
    pending, _ = await _headers(db_session, world["admin"], mfa_verified=False)
    res = await c.get("/admin/users", headers=pending)
    assert res.status_code == 403 and res.json()["detail"] == "mfa_required"


async def test_admin_actions_are_audited(client, world, db_session):
    c, app = client
    admin, _ = await _headers(db_session, world["admin"])
    await c.post("/admin/groups", headers=admin,
                 json={"slug": "gecici", "name": "Geçici", "permissions": ["board.view"]})
    await c.put(f"/admin/users/{world['nurse'].id}/groups", headers=admin,
                json={"group_ids": [str(world["groups"]["charge_nurse"].id)]})
    subjects = [r.subject for r in app.state.audit.records(event_type="admin")]
    assert "group.create" in subjects and "user.groups" in subjects
    rec = next(r for r in app.state.audit.records(event_type="admin") if r.subject == "user.groups")
    assert rec.payload["actor"] == "admin" and rec.payload["after"] == ["charge_nurse"]


async def test_every_admin_mutation_is_audited_without_a_secret(client, world, db_session):
    c, app = client
    admin, _ = await _headers(db_session, world["admin"])
    world["nurse"].totp_secret, world["nurse"].totp_enabled = "JBSWY3DPEHPK3PXP", True
    await db_session.commit()
    gid = (await c.post("/admin/groups", headers=admin, json={
        "slug": "gecici", "name": "Geçici", "permissions": ["board.view"]})).json()["id"]
    await c.patch(f"/admin/groups/{gid}", headers=admin, json={"permissions": ["audit.view"]})
    await c.delete(f"/admin/groups/{gid}", headers=admin)
    uid = (await c.post("/admin/users", headers=admin, json={
        "username": "yeni", "full_name": "Yeni", "password": "Gecici-Parola-1"})).json()["id"]
    await c.patch(f"/admin/users/{uid}", headers=admin, json={"full_name": "Yeni Kişi"})
    await c.put(f"/admin/users/{uid}/groups", headers=admin,
                json={"group_ids": [str(world["groups"]["nurse"].id)]})
    await c.post(f"/admin/users/{uid}/reset-password", headers=admin,
                 json={"password": "Yeni-Parola-9"})
    await c.post(f"/admin/users/{world['nurse'].id}/reset-mfa", headers=admin)

    records = app.state.audit.records(event_type="admin")
    assert [r.subject for r in records] == [
        "group.create", "group.update", "group.delete", "user.create", "user.update",
        "user.groups", "user.password_reset", "user.mfa_reset"]
    assert all(r.tenant == "demo-hastanesi" and r.payload["actor"] == "admin" for r in records)
    by = {r.subject: r.payload for r in records}
    assert by["group.update"]["before"]["permissions"] == ["board.view"]
    assert by["group.update"]["after"]["permissions"] == ["audit.view"]
    assert by["user.update"]["before"]["full_name"] == "Yeni"
    assert by["user.update"]["after"]["full_name"] == "Yeni Kişi"
    assert by["user.password_reset"]["target"] == uid
    trail = repr([r.payload for r in records])
    for secret in ("Gecici-Parola-1", "Yeni-Parola-9", "JBSWY3DPEHPK3PXP", "$2b$"):
        assert secret not in trail


async def test_a_refused_change_is_not_audited(client, world, db_session):
    c, app = client
    admin, _ = await _headers(db_session, world["admin"])
    await c.patch(f"/admin/users/{world['admin'].id}", headers=admin, json={"is_active": False})
    assert app.state.audit.records(event_type="admin") == []


# ---------------------------------------------------------------- sessions

async def test_an_admin_mfa_reset_ends_the_users_sessions(client, world, db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    world["nurse"].totp_secret, world["nurse"].totp_enabled = "JBSWY3DPEHPK3PXP", True
    await db_session.commit()
    nurse_tokens = (await c.post("/auth/login", json={"login": "ayse", "password": PASSWORD})).json()
    assert (await c.post(f"/admin/users/{world['nurse'].id}/reset-mfa", headers=admin)).status_code == 200
    res = await c.post("/auth/refresh", json={"refresh_token": nurse_tokens["refresh_token"]})
    assert res.status_code == 401


async def test_an_admin_password_reset_ends_the_users_sessions(client, world, db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    nurse_tokens = (await c.post("/auth/login", json={"login": "ayse", "password": PASSWORD})).json()
    assert (await c.post(f"/admin/users/{world['nurse'].id}/reset-password", headers=admin,
                         json={"password": "Yeni-Parola-1"})).status_code == 200
    res = await c.post("/auth/refresh", json={"refresh_token": nurse_tokens["refresh_token"]})
    assert res.status_code == 401


async def test_reactivation_does_not_revive_old_sessions(client, world, db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    nurse_tokens = (await c.post("/auth/login", json={"login": "ayse", "password": PASSWORD})).json()
    await c.patch(f"/admin/users/{world['nurse'].id}", headers=admin, json={"is_active": False})
    await c.patch(f"/admin/users/{world['nurse'].id}", headers=admin, json={"is_active": True})
    res = await c.post("/auth/refresh", json={"refresh_token": nurse_tokens["refresh_token"]})
    assert res.status_code == 401
    await asyncio.sleep(1.1)                     # a fresh sign-in after the revocation instant works
    fresh = await c.post("/auth/login", json={"login": "ayse", "password": PASSWORD})
    assert fresh.status_code == 200
    res = await c.post("/auth/refresh", json={"refresh_token": fresh.json()["refresh_token"]})
    assert res.status_code == 200


async def test_a_username_may_not_be_another_users_email(client, world, db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    res = await c.post("/admin/users", headers=admin, json={
        "username": "ayse@example.com", "full_name": "Taklit", "password": "Gecici-Parola-1"})
    assert res.status_code == 409


async def test_an_email_may_not_be_another_users_login_either(client, world, db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    # A legacy local account signs in with its address as the USERNAME and has no e-mail.
    await _make_user(db_session, world["tenant"], world["groups"], "eski@hastane.local", "nurse",
                     email=None)
    await db_session.commit()
    assert (await c.post("/admin/users", headers=admin, json={
        "username": "taklit", "email": "Eski@Hastane.local", "full_name": "Taklit",
        "password": "Gecici-Parola-1"})).status_code == 409          # someone's username
    assert (await c.post("/admin/users", headers=admin, json={
        "username": "taklit", "email": "ayse@example.com", "full_name": "Taklit",
        "password": "Gecici-Parola-1"})).status_code == 409          # someone's e-mail
    for email in ("eski@hastane.local", "Admin@Example.com"):
        res = await c.patch(f"/admin/users/{world['nurse'].id}", headers=admin,
                            json={"email": email})
        assert res.status_code == 409, email
    res = await c.patch(f"/admin/users/{world['nurse'].id}", headers=admin,
                        json={"email": "Ayse@Example.com"})       # her own address: fine
    assert res.status_code == 200 and res.json()["email"] == "ayse@example.com"


# ---------------------------------------------------------------- no grant beyond your own rights

async def _desk(db, world, member, slug, keys, *, also=()):
    """A custom group of the demo tenant holding `keys`; `member` is put into it and into the
    default groups `also`. Returns the group and the member's (headers, tokens)."""
    group = Group(tenant_id=world["tenant"].id, slug=slug, name=slug, is_system=False)
    group.permissions = [GroupPermission(permission=k) for k in keys]
    db.add(group)
    await db.flush()
    await set_manual_groups(db, user=await _fresh(db, member.id), tenant_id=world["tenant"].id,
                            group_ids=[group.id, *(world["groups"][g].id for g in also)],
                            granted_by_id=None)
    await db.commit()
    return group, await _headers(db, await _fresh(db, member.id))


def _beyond(res) -> bool:
    return res.status_code == 403 and res.json()["detail"].startswith(service.BEYOND_OWN_RIGHTS)


async def _groups_of(db, user_id) -> list[str]:
    return sorted((await db.execute(
        select(Group.slug).join(UserGroup, UserGroup.group_id == Group.id)
        .where(UserGroup.user_id == user_id))).scalars().all())


async def test_a_user_desk_cannot_make_anyone_an_administrator(client, world, db_session):
    """Probe P1: `users.manage` alone once let its holder PUT themselves into hospital_admin and
    create a fresh hospital_admin account."""
    c, _ = client
    masa = await _make_user(db_session, world["tenant"], world["groups"], "masa", None)
    desk, (auth, _) = await _desk(db_session, world, masa, "user_desk", ["users.manage"])
    ha = str(world["groups"]["hospital_admin"].id)

    listing = await c.get("/admin/groups", headers=auth)      # it may see what exists ...
    assert listing.status_code == 200 and "hospital_admin" in {g["slug"] for g in listing.json()}
    assert _beyond(await c.put(f"/admin/users/{masa.id}/groups", headers=auth,
                               json={"group_ids": [str(desk.id), ha]}))
    assert _beyond(await c.post("/admin/users", headers=auth, json={
        "username": "golge", "full_name": "Gölge", "password": "Gecici-Parola-1",
        "group_ids": [ha]}))
    assert _beyond(await c.post("/admin/users", headers=auth, json={
        "username": "golge", "full_name": "Gölge", "password": "Gecici-Parola-1",
        "group_ids": [str(world["groups"]["nurse"].id)]}))   # board rights it does not hold
    assert await _groups_of(db_session, masa.id) == ["user_desk"]
    assert (await db_session.execute(select(User.id).where(User.username == "golge"))).first() \
        is None


async def test_a_user_desk_cannot_take_over_the_administrator(client, world, db_session):
    """Probe P1b: `users.manage` alone once reset the real administrator's password and MFA."""
    c, _ = client
    masa = await _make_user(db_session, world["tenant"], world["groups"], "masa", None)
    _, (auth, _) = await _desk(db_session, world, masa, "user_desk", ["users.manage"])
    admin_id = world["admin"].id
    before = await _fresh(db_session, admin_id)
    snapshot = (before.hashed_password, before.totp_secret, before.token_version,
                before.is_active, before.full_name)

    calls = [("POST", "/reset-password", {"password": "Ele-Gecirildi-1"}),
             ("POST", "/reset-mfa", None),
             ("PATCH", "", {"is_active": False}), ("PATCH", "", {"full_name": "x"}),
             ("PUT", "/groups", {"group_ids": []})]
    for method, suffix, body in calls:
        res = await c.request(method, f"/admin/users/{admin_id}{suffix}", headers=auth, json=body)
        assert _beyond(res), (method, suffix)
    after = await _fresh(db_session, admin_id)
    assert (after.hashed_password, after.totp_secret, after.token_version, after.is_active,
            after.full_name) == snapshot
    assert (await c.post("/auth/login", json={"login": "admin", "password": "Ele-Gecirildi-1"})
            ).status_code == 401


async def test_a_group_desk_cannot_widen_any_group_its_own_included(client, world, db_session):
    """Probe P2: `groups.manage` alone once added users.manage to its own group."""
    c, _ = client
    masa = await _make_user(db_session, world["tenant"], world["groups"], "masa", None)
    desk, (auth, _) = await _desk(db_session, world, masa, "group_desk", ["groups.manage"])

    assert _beyond(await c.patch(f"/admin/groups/{desk.id}", headers=auth, json={
        "permissions": ["groups.manage", "users.manage"]}))
    assert _beyond(await c.post("/admin/groups", headers=auth, json={
        "slug": "arka_kapi", "name": "Arka Kapı", "permissions": ["users.manage"]}))
    assert _beyond(await c.patch(f"/admin/groups/{world['groups']['nurse'].id}", headers=auth,
                                 json={"permissions": ["board.view"]}))   # nurse: beyond it now
    ha = world["groups"]["hospital_admin"].id
    assert _beyond(await c.patch(f"/admin/groups/{ha}", headers=auth, json={"name": "x"}))
    assert _beyond(await c.delete(f"/admin/groups/{ha}", headers=auth))
    # Within its own rights it works: a group of groups.manage, emptied, deleted.
    res = await c.post("/admin/groups", headers=auth, json={
        "slug": "ikinci_masa", "name": "İkinci Masa", "permissions": ["groups.manage"]})
    assert res.status_code == 201
    assert (await c.patch(f"/admin/groups/{res.json()['id']}", headers=auth,
                          json={"permissions": []})).status_code == 200
    assert (await c.delete(f"/admin/groups/{res.json()['id']}", headers=auth)).status_code == 204
    group = (await db_session.execute(select(Group).where(Group.id == desk.id)
                                      .execution_options(populate_existing=True))).scalar_one()
    assert group.permission_keys == ["groups.manage"]


async def test_a_charge_nurse_with_the_user_desk_manages_nurses_and_no_one_above(client, world,
                                                                               db_session):
    """The intended lower tier: a charge nurse who also holds users.manage. Every right a nurse
    has is hers too, so she may create nurses, re-group them and reset their credentials — and
    nobody whose rights exceed hers."""
    c, _ = client
    sorumlu = await _make_user(db_session, world["tenant"], world["groups"], "sorumlu", None)
    _, (auth, _) = await _desk(db_session, world, sorumlu, "user_desk", ["users.manage"],
                               also=("charge_nurse",))
    doktor = await _make_user(db_session, world["tenant"], world["groups"], "doktor",
                              "attending")
    await db_session.commit()
    nurse_id, g = world["nurse"].id, world["groups"]

    res = await c.post("/admin/users", headers=auth, json={
        "username": "yeni.hemsire", "full_name": "Yeni Hemşire",
        "password": "Gecici-Parola-1", "group_ids": [str(g["nurse"].id)]})
    assert res.status_code == 201 and [x["slug"] for x in res.json()["groups"]] == ["nurse"]
    for slugs in (["charge_nurse"], ["nurse"]):
        res = await c.put(f"/admin/users/{nurse_id}/groups", headers=auth,
                          json={"group_ids": [str(g[s].id) for s in slugs]})
        assert res.status_code == 200 and [x["slug"] for x in res.json()["groups"]] == slugs
    assert (await c.post(f"/admin/users/{nurse_id}/reset-password", headers=auth,
                         json={"password": "Yeni-Parola-1"})).status_code == 200
    assert (await c.post(f"/admin/users/{nurse_id}/reset-mfa", headers=auth)).status_code == 200
    assert (await c.patch(f"/admin/users/{nurse_id}", headers=auth,
                          json={"full_name": "Ayşe Yılmaz"})).status_code == 200

    assert _beyond(await c.post(f"/admin/users/{doktor.id}/reset-password", headers=auth,
                                json={"password": "Ele-Gecirildi-1"}))
    assert _beyond(await c.patch(f"/admin/users/{doktor.id}", headers=auth,
                                 json={"is_active": False}))
    assert _beyond(await c.put(f"/admin/users/{nurse_id}/groups", headers=auth,
                               json={"group_ids": [str(g["attending"].id)]}))
    assert _beyond(await c.put(f"/admin/users/{sorumlu.id}/groups", headers=auth, json={
        "group_ids": [str(g["charge_nurse"].id), str(g["hospital_admin"].id)]}))
    assert await _groups_of(db_session, doktor.id) == ["attending"]
    assert await _groups_of(db_session, nurse_id) == ["nurse"]


# ---------------------------------------------------------------- accounts shared with others

async def _account_snapshot(db, user_id):
    u = await _fresh(db, user_id)
    return (u.hashed_password, u.totp_secret, u.totp_enabled, u.email, u.full_name,
            u.is_active, u.sessions_revoked_at)


async def test_another_tenants_administrator_is_untouchable_from_here(client, world, db_session):
    """Probe P3: `yabanci` is the ONLY administrator of tenant `other` and a plain member of
    demo. Demo's administrator once deactivated them (leaving `other` with none) and rewrote
    their password and e-mail."""
    c, _ = client
    other_id = world["other_groups"]["nurse"].tenant_id
    stranger = await _fresh(db_session, world["stranger"].id)
    await set_manual_groups(db_session, user=stranger, tenant_id=other_id,
                            group_ids=[world["other_groups"]["hospital_admin"].id],
                            granted_by_id=None)
    db_session.add(TenantMembership(user_id=stranger.id, tenant_id=world["tenant"].id))
    await db_session.commit()
    admin, _ = await _headers(db_session, world["admin"])
    snapshot = await _account_snapshot(db_session, stranger.id)

    calls = [("PATCH", "", {"is_active": False}), ("PATCH", "", {"email": "x@evil.test"}),
             ("PATCH", "", {"full_name": "Başka Biri"}),
             ("POST", "/reset-password", {"password": "Ele-Gecirildi-1"}),
             ("POST", "/reset-mfa", None)]
    for method, suffix, body in calls:
        res = await c.request(method, f"/admin/users/{stranger.id}{suffix}", headers=admin,
                              json=body)
        assert (res.status_code, res.json()["detail"]) == (409, service.SHARED_ACCOUNT), body
    assert await _account_snapshot(db_session, stranger.id) == snapshot
    async with async_sessionmaker(db_session.bind)() as check:
        assert await count_admins(check, other_id) == 1
    # Its groups HERE are demo's business.
    res = await c.put(f"/admin/users/{stranger.id}/groups", headers=admin,
                      json={"group_ids": [str(world["groups"]["nurse"].id)]})
    assert res.status_code == 200 and [g["slug"] for g in res.json()["groups"]] == ["nurse"]


async def test_an_inactive_membership_elsewhere_does_not_make_an_account_shared(client, world,
                                                                               db_session):
    c, _ = client
    stranger_id = world["stranger"].id
    db_session.add(TenantMembership(user_id=stranger_id, tenant_id=world["tenant"].id))
    await db_session.execute(
        TenantMembership.__table__.update()
        .where(TenantMembership.user_id == stranger_id,
               TenantMembership.tenant_id == world["other_groups"]["nurse"].tenant_id)
        .values(is_active=False))
    await db_session.commit()
    admin, _ = await _headers(db_session, world["admin"])
    assert (await c.post(f"/admin/users/{stranger_id}/reset-password", headers=admin,
                         json={"password": "Yeni-Parola-1"})).status_code == 200


async def test_a_platform_operators_account_is_untouchable_from_here(client, world, db_session):
    """Probe P4: a hospital administrator once reset a vendor operator's password and MFA,
    enrolled their own authenticator and created a tenant as the operator."""
    c, _ = client
    op = await _make_user(db_session, world["tenant"], world["groups"], "vendor_op",
                          "platform_support", is_platform_support=True)
    await db_session.commit()
    admin, _ = await _headers(db_session, world["admin"])
    snapshot = await _account_snapshot(db_session, op.id)

    calls = [("POST", "/reset-password", {"password": "Ele-Gecirildi-1"}),
             ("POST", "/reset-mfa", None), ("PATCH", "", {"is_active": False}),
             ("PATCH", "", {"email": "x@evil.test"})]
    for method, suffix, body in calls:
        res = await c.request(method, f"/admin/users/{op.id}{suffix}", headers=admin, json=body)
        assert (res.status_code, res.json()["detail"]) == (409, service.PLATFORM_ACCOUNT), body
    assert await _account_snapshot(db_session, op.id) == snapshot
    assert (await c.post("/auth/login", json={"login": "vendor_op",
                                              "password": "Ele-Gecirildi-1"})).status_code == 401


async def test_an_administrator_may_not_reset_or_deactivate_themselves_here(client, world,
                                                                          db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    me = world["admin"].id
    res = await c.post(f"/admin/users/{me}/reset-password", headers=admin,
                       json={"password": "Yeni-Parola-1"})
    assert (res.status_code, res.json()["detail"]) == (409, service.SELF_CREDENTIALS)
    res = await c.post(f"/admin/users/{me}/reset-mfa", headers=admin)
    assert (res.status_code, res.json()["detail"]) == (409, service.SELF_CREDENTIALS)
    res = await c.patch(f"/admin/users/{me}", headers=admin, json={"is_active": False})
    assert (res.status_code, res.json()["detail"]) == (409, service.SELF_DEACTIVATE)
    res = await c.patch(f"/admin/users/{me}", headers=admin, json={"full_name": "Yönetici"})
    assert res.status_code == 200 and res.json()["full_name"] == "Yönetici"


# ---------------------------------------------------------------- at least one LOCAL administrator

async def test_a_directory_administrator_does_not_count_toward_the_guard(client, world,
                                                                       db_session):
    """Probe P9: with an AD-held hospital_admin present, the last LOCAL administrator could be
    deactivated — and an AD outage would then lock the hospital out of administration."""
    c, _ = client
    db_session.add(UserGroup(user_id=world["ldap"].id,
                             group_id=world["groups"]["hospital_admin"].id, source=SOURCE_LDAP))
    await db_session.commit()
    ad_admin, _ = await _headers(db_session, await _fresh(db_session, world["ldap"].id))
    admin_id = world["admin"].id

    res = await c.patch(f"/admin/users/{admin_id}", headers=ad_admin, json={"is_active": False})
    assert (res.status_code, res.json()["detail"]) == (409, service.LAST_ADMIN_DEACTIVATE)
    res = await c.put(f"/admin/users/{admin_id}/groups", headers=ad_admin,
                      json={"group_ids": []})
    assert (res.status_code, res.json()["detail"]) == (409, service.LAST_ADMIN)
    assert (await _fresh(db_session, admin_id)).is_active is True

    await _make_user(db_session, world["tenant"], world["groups"], "ikinci", "hospital_admin")
    await db_session.commit()                       # a second LOCAL administrator ...
    res = await c.patch(f"/admin/users/{admin_id}", headers=ad_admin, json={"is_active": False})
    assert res.status_code == 200                   # ... and the same change is fine


# ---------------------------------------------------------------- audit written after the commit

async def test_an_audit_failure_after_commit_is_logged_without_secrets(client, world, db_session,
                                                                      caplog):
    c, app = client
    admin, _ = await _headers(db_session, world["admin"])

    def refuse(event):
        # The message carries the password on purpose: it must never reach the log.
        raise RuntimeError("audit store down while writing Yeni-Parola-1")

    working = app.state.audit.append
    app.state.audit.append = refuse
    with caplog.at_level(logging.ERROR, logger="homunculus.admin.router"):
        with pytest.raises(RuntimeError):
            await c.post(f"/admin/users/{world['nurse'].id}/reset-password", headers=admin,
                         json={"password": "Yeni-Parola-1"})
    records = [r for r in caplog.records if r.name == "homunculus.admin.router"]
    assert len(records) == 1 and records[0].levelno == logging.ERROR
    message = records[0].getMessage()
    assert "NOT AUDITED" in message and "user.password_reset" in message
    assert str(world["nurse"].id) in message and "RuntimeError" in message
    assert "Yeni-Parola-1" not in caplog.text and "$2b$" not in caplog.text
    # The change itself stands: it was committed before the trail refused the row.
    app.state.audit.append = working
    assert (await c.post("/auth/login", json={"login": "ayse", "password": "Yeni-Parola-1"})
            ).status_code == 200


# ---------------------------------------------------------------- input

async def test_group_input_is_validated_after_normalising(client, world, db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    bad = [{"slug": "abc\n", "name": "x"},                  # `$` would have let this through
           {"slug": "bosluk", "name": "   "},
           {"slug": "uzun", "name": "x", "description": "d" * 501}]
    for body in bad:
        assert (await c.post("/admin/groups", headers=admin, json=body)).status_code == 422, body
    assert (await c.patch(f"/admin/groups/{world['groups']['nurse'].id}", headers=admin,
                          json={"name": "  "})).status_code == 422
    res = await c.post("/admin/groups", headers=admin,
                       json={"slug": "iyi_ad", "name": "  Temiz Ad  ", "description": "d" * 500})
    assert res.status_code == 201 and res.json()["name"] == "Temiz Ad"


async def test_user_input_is_validated_after_normalising(client, world, db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    base = {"full_name": "Deneme", "password": "Gecici-Parola-1"}
    bad = [{"username": " a "}, {"username": "ali veli"}, {"username": "ali​veli"},
           {"username": "ali/veli"}, {"username": "tamam", "full_name": "   "},
           {"username": "tamam", "email": "not an email"},
           {"username": "tamam", "email": "a@@example.com"},
           {"username": "tamam", "email": "@example.com"},
           {"username": "tamam", "email": "ali@example.com​"}]
    for body in bad:
        res = await c.post("/admin/users", headers=admin, json={**base, **body})
        assert res.status_code == 422, body
    nurse = world["nurse"].id
    for body in ({"full_name": "  "}, {"email": "bozuk"}):
        assert (await c.patch(f"/admin/users/{nurse}", headers=admin, json=body)
                ).status_code == 422, body

    # Turkish capital İ still folds to a plain i, for the username and the e-mail alike.
    res = await c.post("/admin/users", headers=admin, json={
        **base, "username": "İBRAHİM", "email": "İbo@Example.com", "full_name": " İbrahim "})
    assert res.status_code == 201
    assert (res.json()["username"], res.json()["email"], res.json()["full_name"]) == \
        ("ibrahim", "ibo@example.com", "İbrahim")
    for login in ("ibrahim", "İBRAHİM", "ibo@example.com"):
        assert (await c.post("/auth/login", json={"login": login, "password": "Gecici-Parola-1"})
                ).status_code == 200, login

    res = await c.patch(f"/admin/users/{nurse}", headers=admin, json={"email": ""})
    assert res.status_code == 200 and res.json()["email"] is None       # "" clears it


async def test_a_patch_that_changes_nothing_is_not_audited(client, world, db_session):
    c, app = client
    admin, _ = await _headers(db_session, world["admin"])
    nurse, _ = await _headers(db_session, world["nurse"])
    group = world["groups"]["nurse"]
    calls = [(f"/admin/users/{world['nurse'].id}", {}),
             (f"/admin/users/{world['nurse'].id}",
              {"full_name": " Ayse ", "email": "AYSE@example.com", "is_active": True}),
             (f"/admin/groups/{group.id}", {}),
             (f"/admin/groups/{group.id}",
              {"name": "Hemşire", "permissions": group.permission_keys, "mfa_required": False})]
    for path, body in calls:
        assert (await c.patch(path, headers=admin, json=body)).status_code == 200, body
    assert app.state.audit.records(event_type="admin") == []
    assert (await c.get("/auth/me", headers=nurse)).status_code == 200    # no token bump


# ---------------------------------------------------------------- group edits are member-aware

async def _group(db, world, slug, keys, *, mfa=False) -> Group:
    group = Group(tenant_id=world["tenant"].id, slug=slug, name=slug, is_system=False,
                  mfa_required=mfa)
    group.permissions = [GroupPermission(permission=k) for k in keys]
    db.add(group)
    await db.flush()
    return group


async def _put(db, world, user, groups) -> None:
    await set_manual_groups(db, user=await _fresh(db, user.id), tenant_id=world["tenant"].id,
                            group_ids=[g.id for g in groups], granted_by_id=None)


async def _auth(db, user) -> dict:
    return (await _headers(db, await _fresh(db, user.id)))[0]


async def _rights(db, world, user) -> list[str]:
    return sorted(service.user_rights(
        await service.get_tenant_user(db, world["tenant"].id, user.id), world["tenant"].id))


async def test_a_group_edit_may_not_demote_a_member_the_desk_could_not_edit(client, world,
                                                                          db_session):
    """Probe E3: a {groups.manage, board.view} desk once stripped board.view from a group a
    physician relies on — every right it touched was its own, the physician's were not."""
    c, _ = client
    board = await _group(db_session, world, "g_board", ["board.view"])
    clinical = await _group(db_session, world, "g_clin", ["admissions.sign_off",
                                                          "break_glass.use"])
    doktor = await _make_user(db_session, world["tenant"], world["groups"], "doktor", None)
    await _put(db_session, world, doktor, [board, clinical])
    masa = await _make_user(db_session, world["tenant"], world["groups"], "masa", None)
    desk = await _group(db_session, world, "g_gm", ["groups.manage"])
    await _put(db_session, world, masa, [desk, board])
    await db_session.commit()

    res = await c.patch(f"/admin/groups/{board.id}", headers=await _auth(db_session, masa),
                        json={"permissions": []})
    assert _beyond(res)
    assert "admissions.sign_off" in res.json()["detail"]      # it names what it may not touch
    assert await _rights(db_session, world, doktor) == [
        "admissions.sign_off", "board.view", "break_glass.use"]


async def test_a_group_edit_may_not_demote_an_administrator_with_split_keys(client, world,
                                                                          db_session):
    """Probe E3, second variant: a groups.manage-only desk once took groups.manage from an
    account holding its managing keys through two groups."""
    c, _ = client
    gu = await _group(db_session, world, "g_u", ["users.manage"])
    gg = await _group(db_session, world, "g_g", ["groups.manage"])
    ikinci = await _make_user(db_session, world["tenant"], world["groups"], "ikinci", None)
    await _put(db_session, world, ikinci, [gu, gg])
    masa = await _make_user(db_session, world["tenant"], world["groups"], "masa", None)
    await _put(db_session, world, masa, [await _group(db_session, world, "g_g2",
                                                      ["groups.manage"])])
    await db_session.commit()

    assert _beyond(await c.patch(f"/admin/groups/{gg.id}", headers=await _auth(db_session, masa),
                                 json={"permissions": []}))
    assert await _rights(db_session, world, ikinci) == ["groups.manage", "users.manage"]


async def test_a_group_edit_may_not_switch_off_the_mfa_of_a_member_above_the_desk(client, world,
                                                                                db_session):
    """Probe E4: a groups.manage-only desk once switched off an (empty-keyed) MFA group, and a
    charge nurse holding eleven more rights than the desk no longer needed MFA."""
    c, _ = client
    mfa = await _group(db_session, world, "mfa_zorunlu", [], mfa=True)
    sorumlu = await _make_user(db_session, world["tenant"], world["groups"], "sorumlu", None)
    await _put(db_session, world, sorumlu, [world["groups"]["charge_nurse"], mfa])
    masa = await _make_user(db_session, world["tenant"], world["groups"], "masa", None)
    await _put(db_session, world, masa, [await _group(db_session, world, "g_gm",
                                                      ["groups.manage"])])
    unused = await _group(db_session, world, "mfa_bos", [], mfa=True)
    await db_session.commit()
    auth = await _auth(db_session, masa)

    assert _beyond(await c.patch(f"/admin/groups/{mfa.id}", headers=auth,
                                 json={"mfa_required": False}))
    assert (await build_context(db_session, await _fresh(db_session, sorumlu.id))).mfa_required
    # A group none of whose members is beyond the desk: its own business.
    res = await c.patch(f"/admin/groups/{unused.id}", headers=auth, json={"mfa_required": False})
    assert res.status_code == 200 and res.json()["mfa_required"] is False


async def test_two_lesser_desks_cannot_pool_their_rights_on_a_puppet(client, world, db_session):
    """Probe E2: A {users.manage, board.view}, B {users.manage, audit.view} and a group desk M
    {groups.manage, board.view}. Every single step was within its author's rights, yet the
    puppet C could end up with rights no one of them holds."""
    c, _ = client
    um = await _group(db_session, world, "g_um", ["users.manage"])
    board = await _group(db_session, world, "g_board", ["board.view"])
    audit = await _group(db_session, world, "g_audit", ["audit.view"])
    gm = await _group(db_session, world, "g_gm", ["groups.manage"])
    empty = await _group(db_session, world, "g_empty", [])
    names = ("a_desk", "b_desk", "m_desk", "c_kukla")
    a, b, m, puppet = [await _make_user(db_session, world["tenant"], world["groups"], n, None)
                       for n in names]
    await _put(db_session, world, a, [um, board])
    await _put(db_session, world, b, [um, audit])
    await _put(db_session, world, m, [gm, board])
    await db_session.commit()
    ha, hb, hm = [await _auth(db_session, u) for u in (a, b, m)]
    path = f"/admin/users/{puppet.id}/groups"

    res = await c.put(path, headers=hb, json={"group_ids": [str(um.id), str(audit.id)]})
    assert res.status_code == 200                                   # within B
    assert _beyond(await c.put(path, headers=ha, json={             # C is beyond A now
        "group_ids": [str(um.id), str(audit.id), str(board.id)]}))
    res = await c.put(path, headers=hb, json={
        "group_ids": [str(um.id), str(audit.id), str(empty.id)]})
    assert res.status_code == 200                                   # an empty group: within B
    assert _beyond(await c.patch(f"/admin/groups/{empty.id}", headers=hm,   # C is beyond M
                                 json={"permissions": ["board.view"]}))
    assert await _rights(db_session, world, puppet) == ["audit.view", "users.manage"]


# ---------------------------------------------------------------- the caller's rights: the DB's

def _token(user: User, *, tenant: str, groups: list[str], perms, tv: int) -> dict:
    token = create_access_token(subject=str(user.id), extra={
        "tenant": tenant, "groups": groups, "perms": sorted(perms), "mfa_required": True,
        "mfa_verified": True, "tv": tv})
    return {"Authorization": f"Bearer {token}"}


async def test_the_callers_rights_are_read_from_the_database_not_the_token(client, world,
                                                                          db_session):
    """After a deploy that adds a catalogue key, a full administrator's older token lacks it;
    hospital_admin still means the whole catalogue, so nothing may be refused for that key. And
    the other way round: a token claiming more than the database says grants nothing more."""
    c, _ = client
    admin = await _fresh(db_session, world["admin"].id)
    older = _token(admin, tenant="demo-hastanesi", groups=["hospital_admin"],
                   perms=ALL_PERMISSIONS - {"devices.manage"}, tv=admin.token_version)
    ha = str(world["groups"]["hospital_admin"].id)
    res = await c.put(f"/admin/users/{world['nurse'].id}/groups", headers=older,
                      json={"group_ids": [ha]})
    assert res.status_code == 200 and [g["slug"] for g in res.json()["groups"]] == \
        ["hospital_admin"]

    ldap = await _fresh(db_session, world["ldap"].id)             # a nurse, by the database
    overclaim = _token(ldap, tenant="demo-hastanesi", groups=["nurse"], perms=ALL_PERMISSIONS,
                       tv=ldap.token_version)
    res = await c.put(f"/admin/users/{ldap.id}/groups", headers=overclaim,
                      json={"group_ids": [ha]})
    assert _beyond(res)
    assert await _groups_of(db_session, ldap.id) == ["nurse"]


# ---------------------------------------------------------------- sign-in folding

async def test_the_dotless_i_signs_in_and_the_username_rule_speaks_turkish(client, world,
                                                                         db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    base = {"full_name": "Deneme", "password": "Gecici-Parola-1"}
    res = await c.post("/admin/users", headers=admin, json={**base, "username": "ılgaz"})
    assert res.status_code == 201 and res.json()["username"] == "ilgaz"
    for login in ("ilgaz", "ılgaz", "ILGAZ", "İLGAZ"):
        res = await c.post("/auth/login", json={"login": login, "password": "Gecici-Parola-1"})
        assert res.status_code == 200, login

    for name in ("şükrü", "ələkbər", "çağrı"):
        res = await c.post("/admin/users", headers=admin, json={**base, "username": name})
        assert res.status_code == 422, name
        message = res.json()["detail"][0]["msg"]
        assert "Kullanıcı adı" in message and "ş→s" in message and "ə→e" in message


# ---------------------------------------------------------------- the guard under concurrency
# Two transactions race on separate connections. The second is let run until Postgres makes IT
# wait (its own backend pid, so another test run queued on the conftest lock cannot pass for
# it); the first then commits, and the second must see that commit before it decides.

def _root(user: User) -> Actor:
    """An actor holding the whole catalogue: the rights rules do not get in the way."""
    return Actor(id=user.id, perms=ALL_PERMISSIONS, token_version=user.token_version)


async def _until_waiting(maker, pid: int) -> None:
    async with maker() as probe:
        for _ in range(400):
            waiting = (await probe.execute(
                text("SELECT count(*) FROM pg_locks WHERE pid = :pid AND NOT granted"),
                {"pid": pid})).scalar_one()
            if waiting:
                return
            await asyncio.sleep(0.025)
    raise AssertionError(f"backend {pid} never waited for the first transaction")


async def _race(db_session, first, second):
    """Run `first(session)` to just before its commit, start `second(session)`, wait until IT
    blocks on the first, commit the first, and return what the second raised (or None)."""
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)
    async with maker() as s1, maker() as s2:
        await first(s1)
        pid = (await s2.execute(select(func.pg_backend_pid()))).scalar_one()
        racing = asyncio.create_task(second(s2))
        try:
            await _until_waiting(maker, pid)
        finally:
            await s1.commit()
        try:
            await racing
        except AdminError as exc:
            await s2.rollback()
            return exc
        await s2.commit()
        return None


async def test_two_concurrent_demotions_cannot_both_pass(world, db_session):
    tid, nurse_group = world["tenant"].id, world["groups"]["nurse"].id
    second = await _make_user(db_session, world["tenant"], world["groups"], "ikinci",
                              "hospital_admin")
    await db_session.commit()
    actor = _root(world["admin"])

    def demote(user_id):
        async def run(s):
            user = await service.get_tenant_user(s, tid, user_id)
            await service.set_user_groups(s, tid, user, [nurse_group], actor)
        return run

    refused = await _race(db_session, demote(world["admin"].id), demote(second.id))
    assert refused is not None and refused.status_code == 409
    maker = async_sessionmaker(db_session.bind)
    async with maker() as check:
        assert await count_admins(check, tid) == 1


async def test_a_deactivation_racing_a_demotion_cannot_leave_no_administrator(world,
                                                                             db_session):
    """Two administrators; one transaction deactivates the first while another takes the
    second out of hospital_admin. Each alone leaves one administrator; together, none."""
    tid = world["tenant"].id
    ikinci = await _make_user(db_session, world["tenant"], world["groups"], "ikinci",
                              "hospital_admin")
    await db_session.commit()

    async def deactivate_admin(s):
        user = await service.get_tenant_user(s, tid, world["admin"].id)
        await service.update_user(s, tid, user, _root(ikinci), full_name=None, email=None,
                                  is_active=False)

    async def demote_ikinci(s):
        user = await service.get_tenant_user(s, tid, ikinci.id)
        await service.set_user_groups(s, tid, user, [world["groups"]["nurse"].id],
                                      _root(world["admin"]))

    refused = await _race(db_session, deactivate_admin, demote_ikinci)
    assert refused is not None and refused.status_code == 409
    async with async_sessionmaker(db_session.bind)() as check:
        assert await count_admins(check, tid) == 1


async def test_deleting_a_group_racing_a_move_into_it_keeps_the_new_membership(world,
                                                                             db_session):
    """A nurse is put into an empty custom group while another request deletes that group.
    Without the row lock, the delete counted no members and its cascade then silently took the
    membership the move had just committed (the nurse's token still carrying the group)."""
    tid = world["tenant"].id
    ward = Group(tenant_id=tid, slug="servis", name="Servis", is_system=False)
    ward.permissions = [GroupPermission(permission="board.view")]
    db_session.add(ward)
    await db_session.commit()
    actor = _root(world["admin"])

    async def move_nurse(s):
        user = await service.get_tenant_user(s, tid, world["nurse"].id)
        await service.set_user_groups(s, tid, user, [world["groups"]["nurse"].id, ward.id],
                                      actor)

    async def delete_group(s):
        group = await service.get_group(s, tid, ward.id, for_update=True)
        await service.delete_group(s, tid, group, actor)

    refused = await _race(db_session, move_nurse, delete_group)
    assert refused is not None and refused.status_code == 409
    assert refused.detail == "Üyesi olan grup silinemez"
    assert await _groups_of(db_session, world["nurse"].id) == ["nurse", "servis"]


async def _queued_behind(db_session, tid, send, meanwhile):
    """Through the router, so the lock-first path is what is exercised: hold the tenant's
    admin-guard lock, `send(client)` a request, wait until ITS backend blocks on the lock, run
    `meanwhile(holder_session)`, commit, and return the request's response."""
    app = create_app({"bridge-token": "demo-hastanesi"}, run_escalation_loop=False)
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)
    pids: list[int] = []

    async def _db():
        async with maker() as session:
            pids.append((await session.execute(select(func.pg_backend_pid()))).scalar_one())
            yield session

    app.dependency_overrides[get_db] = _db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        async with maker() as holder:
            await lock_admin_guard(holder, tid)
            request = asyncio.create_task(send(c))
            for _ in range(400):
                if pids:
                    break
                await asyncio.sleep(0.01)
            await _until_waiting(maker, pids[0])
            await meanwhile(holder)
            await holder.commit()
        return await request


async def test_a_request_that_waited_behind_the_callers_own_demotion_is_refused(world,
                                                                               db_session):
    """A second administrator's request has passed its permission guard and waits on the tenant
    lock while another transaction demotes that administrator. Once the lock is free, the
    request must be judged by the caller's rights NOW, not at arrival."""
    tid = world["tenant"].id
    ikinci = await _make_user(db_session, world["tenant"], world["groups"], "ikinci",
                              "hospital_admin")
    await db_session.commit()
    ikinci_auth, _ = await _headers(db_session, ikinci)

    async def demote(holder):
        user = await service.get_tenant_user(holder, tid, ikinci.id)
        await service.set_user_groups(holder, tid, user, [world["groups"]["nurse"].id],
                                      _root(world["admin"]))

    res = await _queued_behind(db_session, tid, lambda c: c.put(
        f"/admin/users/{world['nurse'].id}/groups", headers=ikinci_auth,
        json={"group_ids": [str(world["groups"]["hospital_admin"].id)]}), demote)

    assert res.status_code == 401 and res.json()["detail"] == "token_version"
    assert await _groups_of(db_session, world["nurse"].id) == ["nurse"]


async def test_a_request_that_waited_behind_a_tenant_deactivation_is_refused(world, db_session):
    """Probe E11: the tenant is deactivated while an administrator's request waits on the lock;
    the re-check under the lock answers as `caller_tenant_id` would answer now."""
    tid = world["tenant"].id
    admin, _ = await _headers(db_session, world["admin"])

    async def deactivate_tenant(holder):
        await holder.execute(update(Tenant).where(Tenant.id == tid).values(is_active=False))

    res = await _queued_behind(db_session, tid, lambda c: c.put(
        f"/admin/users/{world['nurse'].id}/groups", headers=admin,
        json={"group_ids": [str(world["groups"]["charge_nurse"].id)]}), deactivate_tenant)

    assert res.status_code == 403 and res.json()["detail"] == MEMBERSHIP_INACTIVE
    assert await _groups_of(db_session, world["nurse"].id) == ["nurse"]

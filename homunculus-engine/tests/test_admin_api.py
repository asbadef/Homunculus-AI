# homunculus-engine/tests/test_admin_api.py
"""The administration API end to end: scoping to the caller's tenant, the guards that keep a
tenant administrable, token invalidation on change, and the audit trail.

Synthetic accounts only."""
from __future__ import annotations

import asyncio
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker

from homunculus.admin import service
from homunculus.admin.service import AdminError
from homunculus.api.app import create_app
from homunculus.auth.groups import count_admins, ensure_default_groups, set_manual_groups
from homunculus.auth.jwt import decode_token
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
    u = User(username=username, email=f"{username}@example.com", full_name=username.title(),
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
    """An administrator holds users.manage AND groups.manage; moving the only one into a group
    that has just users.manage would leave nobody able to edit groups."""
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    res = await c.post("/admin/groups", headers=admin, json={
        "slug": "user_desk", "name": "Kullanıcı Masası", "permissions": ["users.manage"]})
    assert res.status_code == 201
    res = await c.put(f"/admin/users/{world['admin'].id}/groups", headers=admin,
                      json={"group_ids": [res.json()["id"]]})
    assert res.status_code == 409


async def test_a_group_edit_may_not_strip_the_last_administrator(client, world, db_session):
    """The only administrator holds the rights through a custom group; editing THAT group's
    permissions is the other way to take them away — refused, and nothing is left behind."""
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    res = await c.post("/admin/groups", headers=admin, json={
        "slug": "it_admin", "name": "BT Yönetimi",
        "permissions": ["users.manage", "groups.manage"]})
    gid = res.json()["id"]
    res = await c.put(f"/admin/users/{world['admin'].id}/groups", headers=admin,
                      json={"group_ids": [gid]})
    assert res.status_code == 200                    # still an administrator, through it_admin
    admin, _ = await _headers(db_session, await _fresh(db_session, world["admin"].id))

    for keys in (["users.manage"], ["groups.manage"], []):
        res = await c.patch(f"/admin/groups/{gid}", headers=admin, json={"permissions": keys})
        assert res.status_code == 409, keys
        assert res.json()["detail"] == service.LAST_ADMIN
    groups = {g["slug"]: g for g in (await c.get("/admin/groups", headers=admin)).json()}
    assert groups["it_admin"]["permissions"] == ["groups.manage", "users.manage"]
    # ... and a second administrator makes the same edit acceptable.
    await c.put(f"/admin/users/{world['nurse'].id}/groups", headers=admin,
                json={"group_ids": [str(world["groups"]["hospital_admin"].id)]})
    res = await c.patch(f"/admin/groups/{gid}", headers=admin,
                        json={"permissions": ["users.manage"]})
    assert res.status_code == 200


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
    assert res.status_code == 409
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
    assert (await c.post("/admin/users", headers=admin, json={
        "username": "taklit", "email": "AYSE", "full_name": "Taklit",
        "password": "Gecici-Parola-1"})).status_code == 409          # someone's username
    assert (await c.post("/admin/users", headers=admin, json={
        "username": "taklit", "email": "ayse@example.com", "full_name": "Taklit",
        "password": "Gecici-Parola-1"})).status_code == 409          # someone's e-mail
    for email in ("admin", "Admin@Example.com"):
        res = await c.patch(f"/admin/users/{world['nurse'].id}", headers=admin,
                            json={"email": email})
        assert res.status_code == 409, email
    res = await c.patch(f"/admin/users/{world['nurse'].id}", headers=admin,
                        json={"email": "Ayse@Example.com"})       # her own address: fine
    assert res.status_code == 200 and res.json()["email"] == "ayse@example.com"


# ---------------------------------------------------------------- the guard under concurrency
# Two transactions race on separate connections. The second is let run until Postgres makes it
# wait; the first then commits, and the second must see that commit before it decides.

async def _until_a_transaction_waits(maker) -> None:
    async with maker() as probe:
        for _ in range(200):
            waiting = (await probe.execute(
                text("SELECT count(*) FROM pg_locks WHERE NOT granted"))).scalar_one()
            if waiting:
                return
            await asyncio.sleep(0.025)
    raise AssertionError("the racing transaction never waited for the first one")


async def _race(db_session, first, second):
    """Run `first(session)` to just before its commit, start `second(session)`, wait until it
    blocks on the first, commit the first, and return what the second raised (or None)."""
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)
    async with maker() as s1, maker() as s2:
        await first(s1)
        racing = asyncio.create_task(second(s2))
        try:
            await _until_a_transaction_waits(maker)
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

    def demote(user_id):
        async def run(s):
            user = await service.get_tenant_user(s, tid, user_id)
            await service.set_user_groups(s, tid, user, [nurse_group], None)
        return run

    refused = await _race(db_session, demote(world["admin"].id), demote(second.id))
    assert refused is not None and refused.status_code == 409
    maker = async_sessionmaker(db_session.bind)
    async with maker() as check:
        assert await count_admins(check, tid) == 1


async def test_a_group_edit_racing_a_demotion_cannot_leave_no_administrator(world, db_session):
    tid = world["tenant"].id
    it_admin = Group(tenant_id=tid, slug="it_admin", name="BT", is_system=False)
    it_admin.permissions = [GroupPermission(permission=k)
                            for k in ("users.manage", "groups.manage")]
    db_session.add(it_admin)
    await db_session.flush()
    second = await _make_user(db_session, world["tenant"], world["groups"], "ikinci", None)
    await set_manual_groups(db_session, user=second, tenant_id=tid, group_ids=[it_admin.id],
                            granted_by_id=None)
    await db_session.commit()

    async def strip_group(s):
        group = await service.get_group(s, tid, it_admin.id, for_update=True)
        await service.update_group(s, tid, group, name=None, description=None,
                                   mfa_required=None, permissions=["users.manage"])

    async def demote_admin(s):
        user = await service.get_tenant_user(s, tid, world["admin"].id)
        await service.set_user_groups(s, tid, user, [world["groups"]["nurse"].id], None)

    refused = await _race(db_session, strip_group, demote_admin)
    assert refused is not None and refused.status_code == 409
    async with async_sessionmaker(db_session.bind)() as check:
        assert await count_admins(check, tid) == 1


async def test_deleting_a_group_racing_a_move_into_it_cannot_leave_no_administrator(world,
                                                                                  db_session):
    """The only administrator is moved into an empty custom group while another request deletes
    that group. Without a guard, the delete's cascade would silently take the membership the
    move had just committed."""
    tid = world["tenant"].id
    it_admin = Group(tenant_id=tid, slug="it_admin", name="BT", is_system=False)
    it_admin.permissions = [GroupPermission(permission=k)
                            for k in ("users.manage", "groups.manage")]
    db_session.add(it_admin)
    await db_session.commit()

    async def move_admin(s):
        user = await service.get_tenant_user(s, tid, world["admin"].id)
        await service.set_user_groups(s, tid, user, [it_admin.id], None)

    async def delete_group(s):
        group = await service.get_group(s, tid, it_admin.id, for_update=True)
        await service.delete_group(s, tid, group)

    refused = await _race(db_session, move_admin, delete_group)
    assert refused is not None and refused.status_code == 409
    async with async_sessionmaker(db_session.bind)() as check:
        assert await count_admins(check, tid) == 1
        assert (await check.execute(select(Group.id).where(Group.id == it_admin.id))).first()

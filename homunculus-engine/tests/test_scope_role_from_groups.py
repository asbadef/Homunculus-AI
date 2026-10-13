"""Scope's notion of an unrestricted user, read from groups instead of the retired role column.

Before the LDAP merge `scope.service.read_role` read `tenant_memberships.role`. After migration
0010 that column is NULL for every membership created by `/admin`, so reading it would scope an
administrator like a nurse — and an empty-scoped administrator cannot fix anyone's scope.
"""
from __future__ import annotations

import asyncio
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import async_sessionmaker

from homunculus.admin.service import CONCURRENT_CHANGE
from homunculus.auth.groups import ensure_default_groups, lock_admin_guard, set_manual_groups
from homunculus.auth.models import Group, GroupPermission, TenantMembership, User
from homunculus.scope.models import StaffScope
from homunculus.auth.service import build_context, hash_password, issue_tokens
from homunculus.db import get_db
from homunculus.scope import service
from homunculus.tenant.models import Tenant
from tests.conftest import requires_db

pytestmark = [pytest.mark.asyncio, requires_db]


# Same shape as tests/test_admin_api.py::_make_user (kept local, as that file keeps it).
async def _make_user(db, tenant, groups, username, group_slug, **kw):
    u = User(username=username, email=f"{username}@example.com", full_name=username.title(),
             hashed_password=hash_password("Gizli-123"), **kw)
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
    world = {
        "tenant": t, "other_tenant": other, "groups": groups, "other_groups": other_groups,
        "admin": await _make_user(db_session, t, groups, "admin", "hospital_admin"),
        "nurse": await _make_user(db_session, t, groups, "ayse", "nurse"),
        "operator": await _make_user(db_session, t, groups, "destek", None,
                                     is_platform_support=True),
        "stranger": await _make_user(db_session, other, other_groups, "yabanci", "nurse"),
    }
    await db_session.commit()
    return world


async def test_hospital_admin_member_reads_as_hospital_admin(db_session, world):
    assert await service.read_role(db_session, world["admin"].id, world["tenant"].id) == "HOSPITAL_ADMIN"


async def test_platform_operator_reads_as_platform_support(db_session, world):
    assert await service.read_role(db_session, world["operator"].id, world["tenant"].id) == "PLATFORM_SUPPORT"


async def test_plain_member_reads_as_member(db_session, world):
    assert await service.read_role(db_session, world["nurse"].id, world["tenant"].id) == "MEMBER"


async def test_no_active_membership_reads_as_none(db_session, world):
    await db_session.execute(update(TenantMembership)
                             .where(TenantMembership.user_id == world["nurse"].id)
                             .values(is_active=False))
    await db_session.commit()
    assert await service.read_role(db_session, world["nurse"].id, world["tenant"].id) is None


async def test_unknown_user_reads_as_none(db_session):
    assert await service.read_role(db_session, uuid.uuid4(), uuid.uuid4()) is None


async def _second_membership(db, user, tenant, groups, slug):
    db.add(TenantMembership(user_id=user.id, tenant_id=tenant.id))
    await db.flush()
    await set_manual_groups(db, user=user, tenant_id=tenant.id,
                            group_ids=[groups[slug].id], granted_by_id=None)
    await db.commit()


async def test_inactive_account_reads_as_none(db_session, world):
    await db_session.execute(update(User).where(User.id == world["admin"].id)
                             .values(is_active=False))
    await db_session.commit()
    assert await service.read_role(db_session, world["admin"].id, world["tenant"].id) is None


async def test_operator_without_membership_in_the_tenant_reads_as_none(db_session, world):
    assert await service.read_role(db_session, world["operator"].id,
                                   world["other_tenant"].id) is None


async def test_admin_group_with_inactive_membership_is_not_hospital_admin(db_session, world):
    await db_session.execute(update(TenantMembership)
                             .where(TenantMembership.user_id == world["admin"].id)
                             .values(is_active=False))
    await db_session.commit()
    assert await service.read_role(db_session, world["admin"].id, world["tenant"].id) is None


async def test_roles_and_grants_do_not_cross_tenants(db_session, world):
    a, b = world["tenant"], world["other_tenant"]
    nurse = world["nurse"]                      # nurse in A
    await _second_membership(db_session, nurse, b, world["other_groups"], "hospital_admin")
    assert await service.read_role(db_session, nurse.id, a.id) == "MEMBER"
    assert await service.read_role(db_session, nurse.id, b.id) == "HOSPITAL_ADMIN"

    await service.replace_grants(db_session, tenant_id=b.id, user_id=nurse.id,
                                 grants=[("unit-b", "")], granted_by_id=None)
    assert await service.read_grants(db_session, nurse.id, a.id) == []
    await service.replace_grants(db_session, tenant_id=a.id, user_id=nurse.id,
                                 grants=[("unit-a", "")], granted_by_id=None)
    in_b = await service.read_grants(db_session, nurse.id, b.id)
    assert [(g.unit_id, g.tenant_id) for g in in_b] == [("unit-b", b.id)]
    in_a = await service.read_grants(db_session, nurse.id, a.id)
    assert [g.unit_id for g in in_a] == ["unit-a"]
    # replacing in A with nothing must not touch B
    await service.replace_grants(db_session, tenant_id=a.id, user_id=nurse.id,
                                 grants=[], granted_by_id=None)
    assert [g.unit_id for g in await service.read_grants(db_session, nurse.id, b.id)] == ["unit-b"]


@pytest_asyncio.fixture
async def client(db_session):
    from homunculus.api.app import create_app   # imported here: app.py is resolved in Task 5
    app = create_app({"bridge-token": "demo-hastanesi"}, run_escalation_loop=False)
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)

    async def _db():
        async with maker() as session:
            yield session

    app.dependency_overrides[get_db] = _db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        c.app = app
        yield c


async def _headers(db, user):
    tokens = issue_tokens(user, await build_context(db, user), mfa_verified=True)
    return {"Authorization": f"Bearer {tokens['access_token']}"}


@pytest.mark.parametrize("method", ["GET", "PUT"])
async def test_scope_of_another_tenants_user_is_not_found(db_session, world, client, method):
    headers = await _headers(db_session, world["admin"])
    body = {"grants": []} if method == "PUT" else None   # scope/schemas.py ScopeAssignment
    r = await client.request(method, f"/scope/{world['stranger'].id}", json=body, headers=headers)
    assert r.status_code == 404, r.text


async def test_scope_admin_routes_need_users_manage(db_session, world, client):
    headers = await _headers(db_session, world["nurse"])
    r = await client.get(f"/scope/{world['admin'].id}", headers=headers)
    assert r.status_code == 403, r.text


# ------------------------------------------------------------- HTTP (needs the app: Task 5)

async def test_hospital_admin_reads_and_writes_scope_in_own_tenant(db_session, world, client):
    headers = await _headers(db_session, world["admin"])
    nurse_id = world["nurse"].id
    assert (await client.get(f"/scope/{nurse_id}", headers=headers)).status_code == 200
    r = await client.put(f"/scope/{nurse_id}", headers=headers,
                         json={"grants": [{"unit_id": "unit-adult", "bed_id": ""}]})
    assert r.status_code == 200, r.text
    rows = (await db_session.execute(
        select(StaffScope).where(StaffScope.user_id == nurse_id))).scalars().all()
    assert rows and {x.tenant_id for x in rows} == {world["tenant"].id}
    events = client.app.state.audit.records(tenant="demo-hastanesi", event_type="scope")
    assert events and events[-1].tenant == "demo-hastanesi"
    r = await client.get("/scope/unassigned", headers=headers)
    assert r.status_code == 200 and isinstance(r.json()["unassigned_users"], int)
    assert r.json()["tenant"] == "demo-hastanesi"


async def test_users_manage_without_unrestricted_scope_cannot_assign(db_session, world, client):
    t = world["tenant"]
    g = Group(tenant_id=t.id, slug="kullanici-yoneticisi", name="ky", is_system=False,
              mfa_required=False)
    g.permissions = [GroupPermission(permission="users.manage")]
    db_session.add(g)
    await db_session.flush()
    mgr = User(username="mudur", email="mudur@example.com", full_name="Mudur",
               hashed_password=hash_password("Gizli-123"))
    db_session.add(mgr)
    await db_session.flush()
    db_session.add(TenantMembership(user_id=mgr.id, tenant_id=t.id))
    await db_session.flush()
    await set_manual_groups(db_session, user=mgr, tenant_id=t.id, group_ids=[g.id],
                            granted_by_id=None)
    await db_session.commit()
    headers = await _headers(db_session, mgr)
    assert (await client.get(f"/scope/{world['nurse'].id}", headers=headers)).status_code == 200
    r = await client.put(f"/scope/{mgr.id}", headers=headers,
                         json={"grants": [{"unit_id": "unit-adult", "bed_id": ""}]})
    assert r.status_code == 403, r.text


async def test_break_glass_in_another_tenant_does_not_reach_this_one(db_session, world):
    from datetime import datetime, timedelta, timezone

    from homunculus.admission.models import Patient
    from homunculus.escalation.models import BreakGlassReason, BreakGlassSession
    from homunculus.scope.resolver import break_glass_in_tenant

    a, b = world["tenant"], world["other_tenant"]
    nurse = world["nurse"]
    patient = Patient(tenant_id=b.id, display_name="Sentetik Hasta", date_of_birth="2000-01-01",
                      sex="U", his_patient_reference="MRN-B-1")
    db_session.add(patient)
    await db_session.flush()
    db_session.add(BreakGlassSession(
        tenant_id=b.id, user_id=nurse.id, patient_id=patient.id,
        reason=BreakGlassReason.CARDIAC_ARREST,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=30)))
    await db_session.commit()
    assert await break_glass_in_tenant(db_session, nurse.id, b.id) == ["MRN-B-1"]
    assert await break_glass_in_tenant(db_session, nurse.id, a.id) == []


# ------------------------------------------------------------- the write: compare-and-swap
#
# `PUT /scope/{id}` REPLACES the user's whole scope with a list a screen built from what it last
# read, and the server keeps no version of it — the third whole-set write, beside a group's
# permissions and a user's memberships (Task 14e). A save from an out-of-date editor therefore
# silently revoked a grant another administrator had just added, and two saves at once could end as
# the UNION of both: the more permissive outcome, chosen by neither. The body may now say what it
# believed the scope WAS (`expected_grants`); under the tenant's admin lock the server compares it,
# as a SET of (unit, bed) pairs, with the grants it holds, and refuses a mismatch with
# CONCURRENT_CHANGE — the exact text the dashboard recognises as `concurrentChange`. Refused,
# nothing is written and nothing audited. A matching or absent expectation is the write as it
# always was.

async def _active_grants(db, user_id) -> list[tuple[str, str]]:
    """What the user holds now, read on a fresh session (never the test's identity map)."""
    async with async_sessionmaker(db.bind)() as fresh:
        rows = (await fresh.execute(select(StaffScope.unit_id, StaffScope.bed_id).where(
            StaffScope.user_id == user_id, StaffScope.is_active == True))).all()  # noqa: E712
    return sorted((unit, bed) for unit, bed in rows)


def _scope_events(client) -> int:
    return len(client.app.state.audit.records(tenant="demo-hastanesi", event_type="scope"))


def _changed_meanwhile(res) -> bool:
    """The refusal the dashboard recognises by its text (`apiErrors.js`: concurrentChange)."""
    return res.status_code == 409 and res.json().get("detail") == CONCURRENT_CHANGE


async def test_a_scope_save_from_a_stale_read_is_refused_and_writes_nothing(db_session, world,
                                                                          client):
    headers = await _headers(db_session, world["admin"])
    nurse = world["nurse"].id
    read = (await client.get(f"/scope/{nurse}", headers=headers)).json()["grants"]   # [] ...
    # ... and another desk gives her a unit before this editor saves.
    other = await client.put(f"/scope/{nurse}", headers=headers,
                             json={"grants": [{"unit_id": "unit-adult"}]})
    assert other.status_code == 200, other.text
    audited = _scope_events(client)

    # Built on the stale read, the body would REVOKE the unit the other desk just gave.
    res = await client.put(f"/scope/{nurse}", headers=headers, json={
        "grants": [{"bed_id": "bed-a1"}],
        "expected_grants": [{"unit_id": g["unit_id"], "bed_id": g["bed_id"]} for g in read]})
    assert _changed_meanwhile(res), res.text
    assert await _active_grants(db_session, nurse) == [("unit-adult", "")]   # nothing written
    assert _scope_events(client) == audited                                  # nothing audited


async def test_a_scope_save_whose_expectation_holds_goes_through_in_any_order(db_session, world,
                                                                            client):
    """A SET of normalised pairs: the order the screen listed them in, and a key's surrounding
    blanks (the server strips both when it stores them), say nothing about what was read."""
    headers = await _headers(db_session, world["admin"])
    nurse = world["nurse"].id
    first = await client.put(f"/scope/{nurse}", headers=headers, json={
        "grants": [{"unit_id": "unit-adult"}, {"bed_id": "bed-a1"}]})
    assert first.status_code == 200, first.text
    res = await client.put(f"/scope/{nurse}", headers=headers, json={
        "grants": [{"unit_id": "unit-adult"}, {"bed_id": "bed-a1"}, {"unit_id": "unit-nicu"}],
        "expected_grants": [{"bed_id": " bed-a1 "}, {"unit_id": "unit-adult"}]})
    assert res.status_code == 200, res.text
    assert await _active_grants(db_session, nurse) == [
        ("", "bed-a1"), ("unit-adult", ""), ("unit-nicu", "")]


async def test_a_scope_save_without_an_expectation_is_the_write_it_always_was(db_session, world,
                                                                             client):
    headers = await _headers(db_session, world["admin"])
    nurse = world["nurse"].id
    await client.put(f"/scope/{nurse}", headers=headers, json={"grants": [{"unit_id": "unit-adult"}]})
    res = await client.put(f"/scope/{nurse}", headers=headers,
                           json={"grants": [{"bed_id": "bed-a1"}]})
    assert res.status_code == 200, res.text
    assert await _active_grants(db_session, nurse) == [("", "bed-a1")]


async def test_an_empty_scope_expectation_means_she_held_none(db_session, world, client):
    """An EMPTY list is an expectation — "this user holds no grant" — not an absent one."""
    headers = await _headers(db_session, world["admin"])
    nurse = world["nurse"].id
    await client.put(f"/scope/{nurse}", headers=headers, json={"grants": [{"unit_id": "unit-adult"}]})
    audited = _scope_events(client)
    res = await client.put(f"/scope/{nurse}", headers=headers,
                           json={"grants": [], "expected_grants": []})
    assert _changed_meanwhile(res), res.text
    assert await _active_grants(db_session, nurse) == [("unit-adult", "")]
    assert _scope_events(client) == audited

    # An account that held none meets it.
    admin_id = world["admin"].id
    res = await client.put(f"/scope/{admin_id}", headers=headers,
                           json={"grants": [{"unit_id": "unit-adult"}], "expected_grants": []})
    assert res.status_code == 200, res.text


@pytest.mark.parametrize("expectation", [[], None], ids=["stale-expectation", "no-expectation"])
async def test_two_scope_saves_at_once_never_end_as_the_union(db_session, world, client,
                                                              expectation):
    """Another administrator's save is in flight — it holds the tenant's admin lock and has
    written its unit, not yet committed — when this one arrives. This one must WAIT for it and
    then decide against what it committed: refused when its expectation is now stale, a plain
    replacement when it stated none. Never both units: the union is the outcome neither chose.

    Before the lock, the second save read the scope without the first's uncommitted row, wrote
    its own, and the two commits together left both grants standing."""
    headers = await _headers(db_session, world["admin"])
    nurse, tid = world["nurse"].id, world["tenant"].id
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)
    pids: list[int] = []

    async def _db():
        async with maker() as session:
            # Which backend serves this request, so the test can see it wait.
            pids.append((await session.execute(select(func.pg_backend_pid()))).scalar_one())
            yield session

    client.app.dependency_overrides[get_db] = _db
    body = {"grants": [{"unit_id": "unit-b"}]}
    if expectation is not None:
        body["expected_grants"] = expectation

    async with maker() as first:
        await lock_admin_guard(first, tid)
        first.add(StaffScope(tenant_id=tid, user_id=nurse, unit_id="unit-a", bed_id=""))
        await first.flush()
        racing = asyncio.create_task(client.put(f"/scope/{nurse}", headers=headers, json=body))
        try:
            async with maker() as probe:
                for _ in range(400):
                    if racing.done():
                        break                     # it did not wait: the defect, shown below
                    if pids and (await probe.execute(
                            text("SELECT count(*) FROM pg_locks WHERE pid = :pid AND NOT granted"),
                            {"pid": pids[-1]})).scalar_one():
                        break                     # it waits for the first save, as it must
                    await asyncio.sleep(0.025)
                else:
                    raise AssertionError("the second save neither waited nor finished")
        finally:
            await first.commit()
        res = await racing

    held = await _active_grants(db_session, nurse)
    assert held != [("unit-a", ""), ("unit-b", "")], "two saves ended as the union of both"
    if expectation is None:
        assert res.status_code == 200, res.text
        assert held == [("unit-b", "")]
    else:
        assert _changed_meanwhile(res), res.text
        assert held == [("unit-a", "")]

"""Group persistence: seeding, membership, token-version bumps and the administrator count."""
from __future__ import annotations

import pytest

from homunculus.auth.groups import (
    GroupError, bump_group_members, count_admins, ensure_default_groups, groups_of,
    set_manual_groups, summarize, tenant_of_user,
)
from homunculus.auth.models import (
    SOURCE_LDAP, Group, GroupPermission, TenantMembership, User, UserGroup,
)
from homunculus.auth.permissions import DEFAULT_GROUPS
from homunculus.tenant.models import Tenant
from tests.conftest import requires_db

pytestmark = [pytest.mark.asyncio, requires_db]


async def _tenant(db, slug="demo-hastanesi"):
    t = Tenant(name=slug, slug=slug, country_code="TR")
    db.add(t)
    await db.flush()
    return t


async def _user(db, tenant, username, *, active=True):
    u = User(username=username, email=f"{username}@example.com", full_name=username,
             hashed_password="x", is_active=active)
    db.add(u)
    await db.flush()
    db.add(TenantMembership(user_id=u.id, tenant_id=tenant.id))
    await db.flush()
    return u


async def test_seeding_creates_the_defaults_once(db_session):
    t = await _tenant(db_session)
    first = await ensure_default_groups(db_session, t.id)
    second = await ensure_default_groups(db_session, t.id)
    assert set(first) == {g["slug"] for g in DEFAULT_GROUPS}
    assert {s: g.id for s, g in first.items()} == {s: g.id for s, g in second.items()}
    assert first["hospital_admin"].is_system is True
    assert "users.manage" in first["hospital_admin"].permission_keys


async def test_manual_groups_are_replaced_and_ldap_rows_are_kept(db_session):
    t = await _tenant(db_session)
    groups = await ensure_default_groups(db_session, t.id)
    u = await _user(db_session, t, "ayse")
    db_session.add(UserGroup(user_id=u.id, group_id=groups["auditor"].id, source=SOURCE_LDAP))
    await db_session.flush()

    await set_manual_groups(db_session, user=u, tenant_id=t.id,
                            group_ids=[groups["nurse"].id], granted_by_id=None)
    slugs = sorted(link.group.slug for link in await groups_of(db_session, u.id, t.id))
    assert slugs == ["auditor", "nurse"]

    await set_manual_groups(db_session, user=u, tenant_id=t.id,
                            group_ids=[groups["charge_nurse"].id], granted_by_id=None)
    slugs = sorted(link.group.slug for link in await groups_of(db_session, u.id, t.id))
    assert slugs == ["auditor", "charge_nurse"]          # ldap row survived, manual replaced


async def test_changing_groups_bumps_the_token_version(db_session):
    t = await _tenant(db_session)
    groups = await ensure_default_groups(db_session, t.id)
    u = await _user(db_session, t, "ayse")
    assert u.token_version == 0
    await set_manual_groups(db_session, user=u, tenant_id=t.id,
                            group_ids=[groups["nurse"].id], granted_by_id=None)
    assert u.token_version == 1


async def test_a_group_from_another_tenant_is_refused(db_session):
    t1 = await _tenant(db_session, "a")
    t2 = await _tenant(db_session, "b")
    g1 = await ensure_default_groups(db_session, t1.id)
    await ensure_default_groups(db_session, t2.id)
    u = await _user(db_session, t2, "ayse")
    with pytest.raises(GroupError):
        await set_manual_groups(db_session, user=u, tenant_id=t2.id,
                                group_ids=[g1["nurse"].id], granted_by_id=None)


async def test_summarize_unions_permissions_and_mfa(db_session):
    t = await _tenant(db_session)
    groups = await ensure_default_groups(db_session, t.id)
    u = await _user(db_session, t, "ayse")
    await set_manual_groups(db_session, user=u, tenant_id=t.id,
                            group_ids=[groups["nurse"].id, groups["attending"].id],
                            granted_by_id=None)
    s = summarize(await groups_of(db_session, u.id, t.id))
    assert s.slugs == ("attending", "nurse")
    assert "admissions.admit" in s.perms and "admissions.sign_off" in s.perms
    assert s.mfa_required is True                       # attending demands it


async def test_a_system_group_member_holds_the_whole_catalogue_by_rule(db_session):
    t = await _tenant(db_session)
    groups = await ensure_default_groups(db_session, t.id)
    u = await _user(db_session, t, "admin")
    await set_manual_groups(db_session, user=u, tenant_id=t.id,
                            group_ids=[groups["hospital_admin"].id], granted_by_id=None)
    # Simulate a tenant seeded before a key existed: drop one row from the system group.
    admin = groups["hospital_admin"]
    admin.permissions.remove(next(p for p in admin.permissions if p.permission == "audit.view"))
    await db_session.flush()
    s = summarize(await groups_of(db_session, u.id, t.id))
    assert "audit.view" in s.perms                       # by rule, not by rows


async def test_count_admins_counts_active_users_holding_both_admin_permissions(db_session):
    t = await _tenant(db_session)
    groups = await ensure_default_groups(db_session, t.id)
    a = await _user(db_session, t, "admin")
    b = await _user(db_session, t, "pasif", active=False)
    for u in (a, b):
        await set_manual_groups(db_session, user=u, tenant_id=t.id,
                                group_ids=[groups["hospital_admin"].id], granted_by_id=None)
    # users.manage alone is not an administrator: groups.manage is needed too.
    half = Group(tenant_id=t.id, slug="user_desk", name="Kullanıcı Masası", is_system=False)
    half.permissions = [GroupPermission(permission="users.manage")]
    db_session.add(half)
    await db_session.flush()
    c = await _user(db_session, t, "yarim")
    await set_manual_groups(db_session, user=c, tenant_id=t.id, group_ids=[half.id],
                            granted_by_id=None)
    assert await count_admins(db_session, t.id) == 1


async def test_bump_group_members_touches_every_member(db_session):
    t = await _tenant(db_session)
    groups = await ensure_default_groups(db_session, t.id)
    a = await _user(db_session, t, "a")
    b = await _user(db_session, t, "b")
    c = await _user(db_session, t, "c")
    for u in (a, b):
        await set_manual_groups(db_session, user=u, tenant_id=t.id,
                                group_ids=[groups["nurse"].id], granted_by_id=None)
    assert await bump_group_members(db_session, groups["nurse"].id) == 2
    await db_session.refresh(a)
    assert a.token_version == 2                         # 1 from set_manual_groups, 1 from bump
    await db_session.refresh(c)
    assert c.token_version == 0                          # not a member: untouched


async def test_tenant_of_user_is_the_lowest_slug(db_session):
    t1 = await _tenant(db_session, "kardiyoloji")
    t2 = await _tenant(db_session, "acil")
    u = await _user(db_session, t1, "dr")
    db_session.add(TenantMembership(user_id=u.id, tenant_id=t2.id))
    await db_session.flush()
    ref = await tenant_of_user(db_session, u.id)
    assert ref is not None and ref.slug == "acil" and ref.id == t2.id


async def test_a_user_without_membership_has_no_tenant(db_session):
    u = User(username="yalniz", email="yalniz@example.com", full_name="Yalnız",
             hashed_password="x")
    db_session.add(u)
    await db_session.flush()
    assert await tenant_of_user(db_session, u.id) is None


# ---------------------------------------------------------------- last-admin guard: more cases

async def test_count_admins_counts_a_system_group_member_by_rule(db_session):
    t = await _tenant(db_session)
    groups = await ensure_default_groups(db_session, t.id)
    a = await _user(db_session, t, "admin")
    await set_manual_groups(db_session, user=a, tenant_id=t.id,
                            group_ids=[groups["hospital_admin"].id], granted_by_id=None)
    admin = groups["hospital_admin"]
    for key in ("users.manage", "groups.manage"):
        admin.permissions.remove(next(p for p in admin.permissions if p.permission == key))
    await db_session.flush()
    assert await count_admins(db_session, t.id) == 1     # by rule, not by rows


async def test_count_admins_is_scoped_to_the_tenant(db_session):
    t1 = await _tenant(db_session, "a")
    t2 = await _tenant(db_session, "b")
    groups1 = await ensure_default_groups(db_session, t1.id)
    await ensure_default_groups(db_session, t2.id)
    a = await _user(db_session, t1, "admin")
    await set_manual_groups(db_session, user=a, tenant_id=t1.id,
                            group_ids=[groups1["hospital_admin"].id], granted_by_id=None)
    assert await count_admins(db_session, t2.id) == 0


async def test_count_admins_counts_split_rights_across_two_groups(db_session):
    t = await _tenant(db_session)
    await ensure_default_groups(db_session, t.id)
    g1 = Group(tenant_id=t.id, slug="g1", name="G1", is_system=False)
    g1.permissions = [GroupPermission(permission="users.manage")]
    g2 = Group(tenant_id=t.id, slug="g2", name="G2", is_system=False)
    g2.permissions = [GroupPermission(permission="groups.manage")]
    db_session.add_all([g1, g2])
    await db_session.flush()
    u = await _user(db_session, t, "split")
    await set_manual_groups(db_session, user=u, tenant_id=t.id, group_ids=[g1.id, g2.id],
                            granted_by_id=None)
    assert await count_admins(db_session, t.id) == 1


async def test_count_admins_ignores_an_inactive_membership(db_session):
    t = await _tenant(db_session)
    groups = await ensure_default_groups(db_session, t.id)
    a = User(username="admin2", email="admin2@example.com", full_name="admin2",
             hashed_password="x")
    db_session.add(a)
    await db_session.flush()
    db_session.add(TenantMembership(user_id=a.id, tenant_id=t.id, is_active=False))
    await db_session.flush()
    await set_manual_groups(db_session, user=a, tenant_id=t.id,
                            group_ids=[groups["hospital_admin"].id], granted_by_id=None)
    assert await count_admins(db_session, t.id) == 0


# ---------------------------------------------------------------- set_manual_groups: more cases

async def test_set_manual_groups_with_no_ids_removes_manual_rows_and_keeps_ldap(db_session):
    t = await _tenant(db_session)
    groups = await ensure_default_groups(db_session, t.id)
    u = await _user(db_session, t, "ayse")
    db_session.add(UserGroup(user_id=u.id, group_id=groups["auditor"].id, source=SOURCE_LDAP))
    await db_session.flush()
    await set_manual_groups(db_session, user=u, tenant_id=t.id,
                            group_ids=[groups["nurse"].id], granted_by_id=None)
    await set_manual_groups(db_session, user=u, tenant_id=t.id, group_ids=[], granted_by_id=None)
    slugs = sorted(link.group.slug for link in await groups_of(db_session, u.id, t.id))
    assert slugs == ["auditor"]


async def test_set_manual_groups_records_granted_by(db_session):
    t = await _tenant(db_session)
    groups = await ensure_default_groups(db_session, t.id)
    admin = await _user(db_session, t, "admin")
    u = await _user(db_session, t, "ayse")
    links = await set_manual_groups(db_session, user=u, tenant_id=t.id,
                                    group_ids=[groups["nurse"].id], granted_by_id=admin.id)
    link = next(l for l in links if l.group_id == groups["nurse"].id)
    assert link.granted_by_id == admin.id


async def test_set_manual_groups_is_a_no_op_for_a_group_held_via_ldap(db_session):
    t = await _tenant(db_session)
    groups = await ensure_default_groups(db_session, t.id)
    u = await _user(db_session, t, "ayse")
    db_session.add(UserGroup(user_id=u.id, group_id=groups["auditor"].id, source=SOURCE_LDAP))
    await db_session.flush()
    await set_manual_groups(db_session, user=u, tenant_id=t.id,
                            group_ids=[groups["auditor"].id], granted_by_id=None)
    links = await groups_of(db_session, u.id, t.id)
    assert len(links) == 1
    assert links[0].group_id == groups["auditor"].id
    assert links[0].source == SOURCE_LDAP


async def test_set_manual_groups_no_op_save_does_not_bump(db_session):
    t = await _tenant(db_session)
    groups = await ensure_default_groups(db_session, t.id)
    u = await _user(db_session, t, "ayse")
    await set_manual_groups(db_session, user=u, tenant_id=t.id,
                            group_ids=[groups["nurse"].id], granted_by_id=None)
    assert u.token_version == 1
    await set_manual_groups(db_session, user=u, tenant_id=t.id,
                            group_ids=[groups["nurse"].id], granted_by_id=None)
    assert u.token_version == 1


# ---------------------------------------------------------------- tenant_of_user / groups_of

async def test_tenant_of_user_ignores_an_inactive_membership(db_session):
    t1 = await _tenant(db_session, "a")
    t2 = await _tenant(db_session, "b")
    u = User(username="dr2", email="dr2@example.com", full_name="dr2", hashed_password="x")
    db_session.add(u)
    await db_session.flush()
    db_session.add(TenantMembership(user_id=u.id, tenant_id=t1.id, is_active=False))
    await db_session.flush()
    assert await tenant_of_user(db_session, u.id) is None

    db_session.add(TenantMembership(user_id=u.id, tenant_id=t2.id, is_active=True))
    await db_session.flush()
    ref = await tenant_of_user(db_session, u.id)
    assert ref is not None and ref.slug == "b"


async def test_groups_of_is_scoped_to_the_tenant(db_session):
    t1 = await _tenant(db_session, "a")
    t2 = await _tenant(db_session, "b")
    groups1 = await ensure_default_groups(db_session, t1.id)
    groups2 = await ensure_default_groups(db_session, t2.id)
    u = await _user(db_session, t1, "dr")
    db_session.add(TenantMembership(user_id=u.id, tenant_id=t2.id))
    await db_session.flush()
    await set_manual_groups(db_session, user=u, tenant_id=t1.id,
                            group_ids=[groups1["nurse"].id], granted_by_id=None)
    await set_manual_groups(db_session, user=u, tenant_id=t2.id,
                            group_ids=[groups2["attending"].id], granted_by_id=None)
    slugs = sorted(link.group.slug for link in await groups_of(db_session, u.id, t1.id))
    assert slugs == ["nurse"]


# ---------------------------------------------------------------- concurrency

async def test_two_concurrent_demotions_cannot_both_pass_the_guard(db_session):
    import asyncio
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from tests.conftest import TEST_DATABASE_URL

    t = await _tenant(db_session)
    groups = await ensure_default_groups(db_session, t.id)
    x = await _user(db_session, t, "x")
    y = await _user(db_session, t, "y")
    for u in (x, y):
        await set_manual_groups(db_session, user=u, tenant_id=t.id,
                                group_ids=[groups["hospital_admin"].id], granted_by_id=None)
    await db_session.commit()

    engine = create_async_engine(TEST_DATABASE_URL)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    results: dict[str, int] = {}
    first_counted = asyncio.Event()

    async def first():                         # X demotes Y
        async with maker() as s:
            await set_manual_groups(s, user=await s.get(User, y.id), tenant_id=t.id,
                                    group_ids=[], granted_by_id=None)
            results["first"] = await count_admins(s, t.id)
            first_counted.set()
            await asyncio.sleep(0.5)           # hold the guard lock while the other one tries
            await s.commit()

    async def second():                        # Y demotes X, at the same time
        await first_counted.wait()
        async with maker() as s:
            await set_manual_groups(s, user=await s.get(User, x.id), tenant_id=t.id,
                                    group_ids=[], granted_by_id=None)
            results["second"] = await count_admins(s, t.id)   # waits for first's commit
            await s.rollback()

    await asyncio.gather(first(), second())
    await engine.dispose()
    assert results == {"first": 1, "second": 0}

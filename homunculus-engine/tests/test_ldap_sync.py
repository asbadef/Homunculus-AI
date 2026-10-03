"""The directory's half of a sign-in, against the test Postgres (spec §7 steps 4–5): the
profile copied from AD, and the AD-mapped groups made equal to the mapping — `ldap` rows only,
manual rows untouched; a removal that would leave the tenant without a LOCAL administrator is
rolled back in its savepoint while the profile update stays. Synthetic accounts only."""
from __future__ import annotations

import logging
from dataclasses import replace

import pytest
import pytest_asyncio
from sqlalchemy import update

from homunculus.auth.groups import ensure_default_groups, set_manual_groups
from homunculus.auth.ldap_sync import apply_directory_profile, mapped_group_ids, sync_ldap_groups
from homunculus.auth.models import SOURCE_LDAP, SOURCE_MANUAL, TenantMembership, User, UserGroup
from homunculus.auth.service import hash_password
from homunculus.tenant.models import Tenant
from tests.conftest import requires_db
from tests.fake_directory import ADMIN_PASSWORD, ad_world, fresh_user, group_dn, group_rows

pytestmark = [pytest.mark.asyncio, requires_db]


@pytest_asyncio.fixture
async def world(db_session):
    return await ad_world(db_session)


# ---------------------------------------------------------------- the mapping
async def test_the_mapping_reads_dns_whatever_their_case(world, db_session):
    tid = world["tenant"].id
    assert await mapped_group_ids(db_session, tid, [group_dn("YB-Hemsire").upper()]) == \
        {world["groups"]["nurse"].id}
    assert await mapped_group_ids(db_session, tid, ["CN=Baska,DC=x"]) == set()
    assert await mapped_group_ids(db_session, tid, []) == set()


async def test_mapped_groups_arrive_as_directory_rows_and_retire_old_tokens(world, db_session):
    user = await fresh_user(db_session, world["account"].id)
    tv = user.token_version
    outcome = await sync_ldap_groups(db_session, user=user, tenant_id=world["tenant"].id,
                                     group_dns=[group_dn("YB-Hemsire")])
    await db_session.commit()
    assert (outcome.before, outcome.after, outcome.guarded) == ((), ("nurse",), ())
    assert outcome.changed is True
    assert await group_rows(db_session, user.id) == {("nurse", SOURCE_LDAP)}
    assert (await fresh_user(db_session, user.id)).token_version == tv + 1


async def test_rows_the_mapping_no_longer_gives_go_and_manual_rows_stay(world, db_session):
    g, tid = world["groups"], world["tenant"].id
    user = await fresh_user(db_session, world["account"].id)
    db_session.add(UserGroup(user_id=user.id, group_id=g["nurse"].id, source=SOURCE_LDAP))
    await set_manual_groups(db_session, user=user, tenant_id=tid,
                            group_ids=[g["charge_nurse"].id], granted_by_id=None)
    await db_session.commit()
    outcome = await sync_ldap_groups(db_session, user=user, tenant_id=tid,
                                     group_dns=[group_dn("YB-Hekim")])
    await db_session.commit()
    assert outcome.before == ("charge_nurse", "nurse")
    assert outcome.after == ("charge_nurse", "physician")
    assert await group_rows(db_session, user.id) == {
        ("charge_nurse", SOURCE_MANUAL), ("physician", SOURCE_LDAP)}


async def test_a_manual_row_for_a_mapped_group_stays_manual_and_nothing_moves(world, db_session):
    g, tid = world["groups"], world["tenant"].id
    user = await fresh_user(db_session, world["account"].id)
    await set_manual_groups(db_session, user=user, tenant_id=tid, group_ids=[g["nurse"].id],
                            granted_by_id=None)
    await db_session.commit()
    tv = (await fresh_user(db_session, user.id)).token_version
    outcome = await sync_ldap_groups(db_session, user=user, tenant_id=tid,
                                     group_dns=[group_dn("YB-Hemsire")])
    await db_session.commit()
    assert outcome.changed is False and outcome.after == ("nurse",)
    assert await group_rows(db_session, user.id) == {("nurse", SOURCE_MANUAL)}
    assert (await fresh_user(db_session, user.id)).token_version == tv


# ---------------------------------------------------------------- the local-administrator guard
async def _sole_local_admin_through_ad(db):
    """A second tenant whose ONLY local administrator holds hospital_admin through an `ldap`
    row — data the API never produces (the sync runs for AD accounts only), built by hand to
    reach the guard (plan decision D10)."""
    tenant = Tenant(name="Iki", slug="iki", country_code="TR")
    db.add(tenant)
    await db.flush()
    groups = await ensure_default_groups(db, tenant.id)
    boss = User(username="patron", email="patron@example.com", full_name="Patron",
                hashed_password=hash_password(ADMIN_PASSWORD))
    db.add(boss)
    await db.flush()
    db.add(TenantMembership(user_id=boss.id, tenant_id=tenant.id))
    db.add(UserGroup(user_id=boss.id, group_id=groups["hospital_admin"].id, source=SOURCE_LDAP))
    await db.commit()
    return tenant, groups, boss


async def test_a_removal_that_would_leave_no_local_administrator_is_rolled_back(world,
                                                                               db_session):
    """A unit test of the guard itself: the router never reaches it (it syncs AD accounts only,
    and `count_admins` counts LOCAL ones), so the sync is called directly on hand-made data."""
    tenant, _groups, boss = await _sole_local_admin_through_ad(db_session)
    boss = await fresh_user(db_session, boss.id)
    tv = boss.token_version
    boss.full_name = "Profil AD'den"                     # step 4, before the sync
    outcome = await sync_ldap_groups(db_session, user=boss, tenant_id=tenant.id, group_dns=[])
    await db_session.commit()
    assert outcome.guarded == ("hospital_admin",) and outcome.changed is False
    after = await fresh_user(db_session, boss.id)
    assert after.full_name == "Profil AD'den" and after.token_version == tv
    assert await group_rows(db_session, boss.id) == {("hospital_admin", SOURCE_LDAP)}


async def test_the_same_removal_goes_through_when_another_local_administrator_remains(
        world, db_session):
    tenant, groups, boss = await _sole_local_admin_through_ad(db_session)
    other = User(username="ikinci", email="ikinci@example.com", full_name="İkinci",
                 hashed_password=hash_password(ADMIN_PASSWORD))
    db_session.add(other)
    await db_session.flush()
    db_session.add(TenantMembership(user_id=other.id, tenant_id=tenant.id))
    await set_manual_groups(db_session, user=other, tenant_id=tenant.id,
                            group_ids=[groups["hospital_admin"].id], granted_by_id=None)
    await db_session.commit()
    boss = await fresh_user(db_session, boss.id)
    outcome = await sync_ldap_groups(db_session, user=boss, tenant_id=tenant.id, group_dns=[])
    await db_session.commit()
    assert (outcome.before, outcome.after, outcome.guarded) == (("hospital_admin",), (), ())
    assert await group_rows(db_session, boss.id) == set()


async def test_in_a_tenant_without_a_local_administrator_an_ad_removal_still_applies(
        world, db_session, caplog):
    """`count_admins` counts LOCAL administrators and the sync runs for AD accounts, so a sync
    never lowers that count. A tenant that has none already (the last one deactivated outside
    the API) must not freeze every AD account's rights: the removal applies — the guard refuses
    only a change from some local administrators to none — and the log says what is missing."""
    g, tid = world["groups"], world["tenant"].id
    await db_session.execute(update(User).where(User.id == world["admin"].id)
                             .values(is_active=False))
    user = await fresh_user(db_session, world["account"].id)
    db_session.add(UserGroup(user_id=user.id, group_id=g["nurse"].id, source=SOURCE_LDAP))
    await db_session.commit()
    tv = (await fresh_user(db_session, user.id)).token_version
    with caplog.at_level(logging.WARNING, logger="homunculus"):
        outcome = await sync_ldap_groups(db_session, user=user, tenant_id=tid, group_dns=[])
    await db_session.commit()
    assert (outcome.before, outcome.after, outcome.guarded) == (("nurse",), (), ())
    assert await group_rows(db_session, user.id) == set()
    assert (await fresh_user(db_session, user.id)).token_version == tv + 1
    assert "no active local administrator" in caplog.text


# ---------------------------------------------------------------- the profile
async def test_the_profile_follows_ad(world, db_session):
    user = await fresh_user(db_session, world["account"].id)
    changed = await apply_directory_profile(db_session, user, world["ayse"].identity)
    await db_session.commit()
    assert sorted(changed) == ["email", "full_name", "ldap_dn"]
    after = await fresh_user(db_session, user.id)
    assert (after.full_name, after.email, after.ldap_dn) == (
        "Ayşe Yılmaz", "ayse.yilmaz@hastane.az", world["ayse"].identity.dn)
    assert await apply_directory_profile(db_session, after, world["ayse"].identity) == []


async def test_an_ad_mail_another_account_uses_is_not_copied(world, db_session):
    user = await fresh_user(db_session, world["account"].id)
    taken = replace(world["ayse"].identity, email="ADMIN@example.com")
    changed = await apply_directory_profile(db_session, user, taken)
    assert "email" not in changed and user.email is None


async def test_an_account_without_mail_in_ad_loses_its_email_here(world, db_session):
    user = await fresh_user(db_session, world["account"].id)
    await apply_directory_profile(db_session, user, world["ayse"].identity)
    changed = await apply_directory_profile(db_session, user,
                                            replace(world["ayse"].identity, email=None))
    assert "email" in changed and user.email is None

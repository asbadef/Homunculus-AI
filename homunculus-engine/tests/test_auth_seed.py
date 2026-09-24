"""
Bootstrap seeding: the first tenant, its default groups, and one administrator in
`hospital_admin`. Without this a fresh database has zero users and nobody can sign in.
Synthetic credentials only — real deployments pass their own via environment variables.
"""
from __future__ import annotations

import asyncio

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from homunculus.auth.groups import groups_of
from homunculus.auth.models import Group, TenantMembership, User
from homunculus.auth.seed import SeedRefused, seed_bootstrap
from homunculus.auth.service import (
    find_user_by_login, normalize_login, verify_local_password, verify_password,
)
from homunculus.tenant.models import Tenant
from tests.conftest import requires_db

pytestmark = [pytest.mark.asyncio, requires_db]

ARGS = dict(
    tenant_name="Demo Hastanesi", tenant_slug="demo-hastanesi", country_code="TR",
    email="Admin@Example.com", full_name="Demo Yönetici", password="Str0ng-Pass-123",
)


async def test_seed_creates_tenant_groups_admin_and_membership(db_session):
    tenant, user = await seed_bootstrap(db_session, **ARGS)

    assert tenant.slug == "demo-hastanesi"
    assert user.username == "admin@example.com" and user.email == "admin@example.com"
    assert user.is_active is True and user.auth_source == "local"
    assert user.hashed_password != "Str0ng-Pass-123"
    assert verify_password("Str0ng-Pass-123", user.hashed_password)

    membership = (await db_session.execute(
        select(TenantMembership).where(TenantMembership.user_id == user.id)
    )).scalar_one()
    assert membership.tenant_id == tenant.id and membership.role is None

    slugs = [link.group.slug for link in await groups_of(db_session, user.id, tenant.id)]
    assert slugs == ["hospital_admin"]
    assert (await db_session.execute(
        select(func.count(Group.id)).where(Group.tenant_id == tenant.id))).scalar_one() == 11


async def test_seed_is_idempotent(db_session):
    await seed_bootstrap(db_session, **ARGS)
    await seed_bootstrap(db_session, **ARGS)   # re-running must not duplicate

    assert (await db_session.execute(select(func.count(User.id)))).scalar_one() == 1
    assert (await db_session.execute(select(func.count(Tenant.id)))).scalar_one() == 1
    assert (await db_session.execute(select(func.count(TenantMembership.id)))).scalar_one() == 1
    assert (await db_session.execute(select(func.count(Group.id)))).scalar_one() == 11


async def test_seed_does_not_re_promote_a_demoted_bootstrap_admin(db_session):
    """The seed runs on every boot. A hospital that moved the generic account out of
    hospital_admin must not find it promoted again after the next restart."""
    tenant, user = await seed_bootstrap(db_session, **ARGS)
    groups = {g.slug: g for g in (await db_session.execute(
        select(Group).where(Group.tenant_id == tenant.id))).scalars()}
    from homunculus.auth.groups import set_manual_groups
    await set_manual_groups(db_session, user=user, tenant_id=tenant.id,
                            group_ids=[groups["auditor"].id], granted_by_id=None)
    await db_session.commit()

    await seed_bootstrap(db_session, **ARGS)                  # the next boot

    slugs = [link.group.slug for link in await groups_of(db_session, user.id, tenant.id)]
    assert slugs == ["auditor"]


async def test_seed_finds_a_renamed_bootstrap_admin_by_email(db_session):
    """The seed runs on every deploy. A hospital that renamed the bootstrap account's username
    must not have the next boot try to INSERT a second user with the same e-mail (which would hit
    the unique constraint and fail the boot script)."""
    _, user = await seed_bootstrap(db_session, **ARGS)
    user.username = "yonetici"
    await db_session.commit()

    await seed_bootstrap(db_session, **ARGS)                  # the next boot

    assert (await db_session.execute(select(func.count(User.id)))).scalar_one() == 1
    assert (await db_session.execute(select(User.username))).scalar_one() == "yonetici"


@pytest.mark.parametrize("email", [
    "", "   ", "admin", "@example.com", "admin@", "ad min@example.com", "a@b@example.com",
    "x" * 120 + "@example.com",   # 132 characters: longer than users.username (128)
])
async def test_seed_refuses_an_invalid_email(db_session, email):
    """The address becomes the username AND the e-mail: it must be one non-blank token with a
    single `@` between two non-empty parts, and fit both columns."""
    with pytest.raises(ValueError, match="e-posta"):
        await seed_bootstrap(db_session, **{**ARGS, "email": email})

    # nothing was written
    assert (await db_session.execute(select(func.count(User.id)))).scalar_one() == 0
    assert (await db_session.execute(select(func.count(Tenant.id)))).scalar_one() == 0


async def test_seed_accepts_an_ad_style_domain(db_session):
    """Sign-in takes any login string, so nothing requires a public domain; hospitals on Active
    Directory often use one like `hastane.local` (Plan 2)."""
    _, user = await seed_bootstrap(db_session, **{**ARGS, "email": "Admin@Hastane.local"})

    assert user.username == "admin@hastane.local" and user.email == "admin@hastane.local"


async def test_seed_refuses_an_account_that_belongs_to_another_tenant(db_session):
    """Otherwise the seed would put into `hospital_admin` of the seed tenant an account whose
    session (and token) runs in a different tenant."""
    tenant, user = await seed_bootstrap(db_session, **ARGS)
    tenant_id, user_id = tenant.id, user.id      # the refusal rolls back, expiring both objects

    with pytest.raises(SeedRefused, match="demo-hastanesi"):
        await seed_bootstrap(db_session, **{**ARGS, "tenant_slug": "baska-hastane"})

    assert (await db_session.execute(select(Tenant.slug))).scalars().all() == ["demo-hastanesi"]
    assert (await db_session.execute(select(func.count(TenantMembership.id)))).scalar_one() == 1
    slugs = [link.group.slug for link in await groups_of(db_session, user_id, tenant_id)]
    assert slugs == ["hospital_admin"]


async def test_seed_refuses_an_inactive_account(db_session):
    """A hospital that deactivated the generic account must not find it back in charge; and
    with a new tenant slug the seed would otherwise link it to a fresh membership."""
    _, user = await seed_bootstrap(db_session, **ARGS)
    user.is_active = False
    await db_session.commit()

    with pytest.raises(SeedRefused, match="pasif"):
        await seed_bootstrap(db_session, **ARGS)

    assert (await db_session.execute(select(User.is_active))).scalar_one() is False


async def test_seed_refuses_a_directory_account(db_session):
    _, user = await seed_bootstrap(db_session, **ARGS)
    user.auth_source = "ldap"
    await db_session.commit()

    with pytest.raises(SeedRefused, match="yerel"):
        await seed_bootstrap(db_session, **ARGS)


async def test_concurrent_boots_are_serialised(db_session):
    """Two boots at once (two replicas, a restart overlapping a deploy) must not both create
    the tenant or the membership: the advisory lock makes the second wait and find the first's
    work."""
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)
    async with maker() as first, maker() as second:
        # return_exceptions: let BOTH finish, so a failure leaves no transaction open (which
        # would hang the fixture's DROP instead of failing the test).
        results = await asyncio.wait_for(asyncio.gather(
            seed_bootstrap(first, **ARGS), seed_bootstrap(second, **ARGS),
            return_exceptions=True), timeout=60)
    assert not [r for r in results if isinstance(r, BaseException)], results

    assert (await db_session.execute(select(func.count(User.id)))).scalar_one() == 1
    assert (await db_session.execute(select(func.count(Tenant.id)))).scalar_one() == 1
    assert (await db_session.execute(select(func.count(TenantMembership.id)))).scalar_one() == 1
    assert (await db_session.execute(select(func.count(Group.id)))).scalar_one() == 11


async def test_seeded_admin_can_sign_in(db_session):
    """The whole point of seeding: the bootstrap account must be able to sign in, by the same
    lookup and password check the login route uses."""
    await seed_bootstrap(db_session, **ARGS)

    user = await find_user_by_login(db_session, normalize_login("Admin@Example.com"))
    assert user is not None
    assert verify_local_password(user.auth_source, user.hashed_password, "Str0ng-Pass-123") is True
    assert verify_local_password(user.auth_source, user.hashed_password, "wrong-password") is False

"""
Bootstrap seeding: the first tenant, its default groups, and one administrator in
`hospital_admin`. Without this a fresh database has zero users and nobody can sign in.
Synthetic credentials only — real deployments pass their own via environment variables.
"""
from __future__ import annotations

import pytest
from sqlalchemy import func, select

from homunculus.auth.groups import groups_of
from homunculus.auth.models import Group, TenantMembership, User
from homunculus.auth.seed import seed_bootstrap
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


async def test_seed_refuses_an_email_the_login_api_would_reject(db_session):
    """`.local` / `localhost` fail EmailStr validation; refuse them at seed time so no
    deployment ships an administrator whose address the UI's own validation rejects."""
    with pytest.raises(ValueError, match="e-posta|email"):
        await seed_bootstrap(db_session, **{**ARGS, "email": "admin@hastane.local"})

    # nothing was written
    assert (await db_session.execute(select(func.count(User.id)))).scalar_one() == 0


async def test_seeded_admin_can_sign_in(db_session):
    """The whole point of seeding: the bootstrap account must be able to sign in, by the same
    lookup and password check the login route uses."""
    await seed_bootstrap(db_session, **ARGS)

    user = await find_user_by_login(db_session, normalize_login("Admin@Example.com"))
    assert user is not None
    assert verify_local_password(user.auth_source, user.hashed_password, "Str0ng-Pass-123") is True
    assert verify_local_password(user.auth_source, user.hashed_password, "wrong-password") is False

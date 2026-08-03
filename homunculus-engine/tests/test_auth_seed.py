"""
Bootstrap seeding: the first tenant + HOSPITAL_ADMIN user.

Without this a fresh database has zero users and nobody can log in. Synthetic
credentials only — real deployments pass their own via environment variables.
"""
from __future__ import annotations

import pytest
from sqlalchemy import func, select

from homunculus.auth.models import TenantMembership, User, UserRole
from homunculus.auth.seed import seed_bootstrap
from homunculus.auth.service import verify_password
from homunculus.tenant.models import Tenant
from tests.conftest import requires_db

pytestmark = [pytest.mark.asyncio, requires_db]


async def test_seed_creates_tenant_admin_and_membership(db_session):
    tenant, user = await seed_bootstrap(
        db_session,
        tenant_name="Demo Hastanesi", tenant_slug="demo-hastanesi", country_code="TR",
        email="admin@demo.local", full_name="Demo Yönetici", password="Str0ng-Pass-123",
    )

    assert tenant.slug == "demo-hastanesi"
    assert user.email == "admin@demo.local"
    assert user.is_active is True
    # Password is stored as a bcrypt hash, never plaintext.
    assert user.hashed_password != "Str0ng-Pass-123"
    assert verify_password("Str0ng-Pass-123", user.hashed_password)

    membership = (await db_session.execute(
        select(TenantMembership).where(TenantMembership.user_id == user.id)
    )).scalar_one()
    assert membership.tenant_id == tenant.id
    assert membership.role is UserRole.HOSPITAL_ADMIN


async def test_seed_is_idempotent(db_session):
    args = dict(
        tenant_name="Demo Hastanesi", tenant_slug="demo-hastanesi", country_code="TR",
        email="admin@demo.local", full_name="Demo Yönetici", password="Str0ng-Pass-123",
    )
    await seed_bootstrap(db_session, **args)
    await seed_bootstrap(db_session, **args)   # re-running must not duplicate

    assert (await db_session.execute(select(func.count(User.id)))).scalar_one() == 1
    assert (await db_session.execute(select(func.count(Tenant.id)))).scalar_one() == 1
    assert (await db_session.execute(select(func.count(TenantMembership.id)))).scalar_one() == 1


async def test_seeded_admin_can_authenticate(db_session):
    """The whole point of seeding: the bootstrap account must be able to log in."""
    from homunculus.auth.service import authenticate_user

    await seed_bootstrap(
        db_session,
        tenant_name="Demo Hastanesi", tenant_slug="demo-hastanesi", country_code="TR",
        email="admin@demo.local", full_name="Demo Yönetici", password="Str0ng-Pass-123",
    )

    assert await authenticate_user(db_session, "admin@demo.local", "Str0ng-Pass-123") is not None
    assert await authenticate_user(db_session, "admin@demo.local", "wrong-password") is None

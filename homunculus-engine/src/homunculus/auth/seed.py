"""
Bootstrap seeding — the first tenant and its HOSPITAL_ADMIN.

A freshly migrated database has no users, so nobody could log in and no admin could
create anyone. This module creates that first account. It is **idempotent**: running it
again on an already-seeded database changes nothing.

Credentials come from the caller (CLI reads them from the environment) — never hardcoded.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.auth.models import TenantMembership, User, UserRole
from homunculus.auth.service import hash_password
from homunculus.tenant.models import Tenant


async def seed_bootstrap(
    db: AsyncSession,
    *,
    tenant_name: str,
    tenant_slug: str,
    country_code: str,
    email: str,
    full_name: str,
    password: str,
    timezone: str = "UTC",
    role: UserRole = UserRole.HOSPITAL_ADMIN,
) -> tuple[Tenant, User]:
    """Create (or return) the bootstrap tenant, admin user, and their membership."""
    tenant = (await db.execute(
        select(Tenant).where(Tenant.slug == tenant_slug)
    )).scalar_one_or_none()
    if tenant is None:
        tenant = Tenant(
            name=tenant_name, slug=tenant_slug,
            country_code=country_code.upper(), timezone=timezone,
        )
        db.add(tenant)
        await db.flush()

    user = (await db.execute(
        select(User).where(User.email == email)
    )).scalar_one_or_none()
    if user is None:
        user = User(
            email=email, full_name=full_name,
            hashed_password=hash_password(password), is_active=True,
        )
        db.add(user)
        await db.flush()

    membership = (await db.execute(
        select(TenantMembership).where(
            TenantMembership.user_id == user.id,
            TenantMembership.tenant_id == tenant.id,
        )
    )).scalar_one_or_none()
    if membership is None:
        db.add(TenantMembership(user_id=user.id, tenant_id=tenant.id, role=role))

    await db.commit()
    await db.refresh(tenant)
    await db.refresh(user)
    return tenant, user

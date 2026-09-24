"""
Bootstrap seeding — the first tenant, its default groups, and its first administrator.

A freshly migrated database has no users, so nobody could sign in and no admin could create
anyone. This module creates that first account. It is **idempotent**: running it again on an
already-seeded database changes nothing.

Credentials come from the caller (CLI reads them from the environment) — never hardcoded.
"""
from __future__ import annotations

from pydantic import BaseModel, EmailStr, ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.auth.groups import ensure_default_groups, groups_of, set_manual_groups
from homunculus.auth.models import SOURCE_MANUAL, TenantMembership, User
from homunculus.auth.service import (
    find_user_by_login, hash_password, normalize_login, run_bcrypt,
)
from homunculus.tenant.models import Tenant


class _EmailCheck(BaseModel):
    """The dashboard validates addresses the same way; never seed one it would refuse."""
    email: EmailStr


def _validate_email(email: str) -> None:
    try:
        _EmailCheck(email=email)
    except ValidationError as exc:
        raise ValueError(
            f"Geçersiz e-posta {email!r}: giriş ekranı bu adresi kabul etmez, "
            f"bu hesapla giriş yapılamaz."
        ) from exc


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
) -> tuple[Tenant, User]:
    """Create (or return) the bootstrap tenant, its default groups, the admin user, the
    membership, and the admin's `hospital_admin` group membership."""
    _validate_email(email)
    key = normalize_login(email)

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
    groups = await ensure_default_groups(db, tenant.id)

    created = False
    # By username OR e-mail: a hospital may rename the bootstrap account's username, and a
    # username-only lookup would then INSERT a second user with the same e-mail on the next
    # boot — the unique constraint would fail the boot script.
    user = await find_user_by_login(db, key)
    if user is None:
        user = User(
            username=key, email=key, full_name=full_name,
            hashed_password=await run_bcrypt(hash_password, password), is_active=True,
        )
        db.add(user)
        await db.flush()
        created = True

    membership = (await db.execute(
        select(TenantMembership).where(
            TenantMembership.user_id == user.id,
            TenantMembership.tenant_id == tenant.id,
        )
    )).scalar_one_or_none()
    if membership is None:
        db.add(TenantMembership(user_id=user.id, tenant_id=tenant.id))
        await db.flush()
        created = True

    # Grant hospital_admin ONLY to an account or membership this run created. The seed runs on
    # every boot; re-granting on each start would silently undo a hospital's decision to demote
    # the generic bootstrap account. Additive, so it never strips groups the account already has.
    if created:
        links = await groups_of(db, user.id, tenant.id)
        manual_ids = {link.group_id for link in links if link.source == SOURCE_MANUAL}
        await set_manual_groups(db, user=user, tenant_id=tenant.id,
                                group_ids=manual_ids | {groups["hospital_admin"].id},
                                granted_by_id=None)

    await db.commit()
    await db.refresh(tenant)
    await db.refresh(user)
    return tenant, user

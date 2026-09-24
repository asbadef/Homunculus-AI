"""
Bootstrap seeding — the first tenant, its default groups, and its first administrator.

A freshly migrated database has no users, so nobody could sign in and no admin could create
anyone. This module creates that first account. It is **idempotent**: running it again on an
already-seeded database changes nothing.

It runs on every boot, so it is careful about what it finds:
  * two boots at once are serialised by an advisory lock (`tenant_memberships` has no unique
    `(user_id, tenant_id)`, so racing boots could otherwise insert a duplicate membership);
  * an EXISTING account at the configured address is only linked to the seed tenant if it is an
    active local account with no membership in another tenant — anything else raises
    `SeedRefused` rather than hand `hospital_admin` to the wrong account.

Credentials come from the caller (CLI reads them from the environment) — never hardcoded.
"""
from __future__ import annotations

from typing import NoReturn

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.auth.groups import ensure_default_groups, groups_of, set_manual_groups
from homunculus.auth.models import AUTH_LOCAL, SOURCE_MANUAL, TenantMembership, User
from homunculus.auth.service import (
    find_user_by_login, hash_password, normalize_login, run_bcrypt,
)
from homunculus.tenant.models import Tenant

_SEED_LOCK_KEY = "homunculus.seed_bootstrap"

# The address becomes the account's username AND its e-mail, so it must fit both columns.
_MAX_LOGIN = min(User.__table__.c.username.type.length, User.__table__.c.email.type.length)


class SeedRefused(ValueError):
    """An account already exists at the bootstrap address but must not be made the seed
    tenant's administrator (inactive, not a local account, or a member of another tenant)."""


def _bootstrap_login(email: str) -> str:
    """The normalised address, or ValueError. The value is stored as the username AND the
    e-mail of the account, and typed at sign-in as either: after `normalize_login` it must be
    non-empty, contain no whitespace, have exactly one `@` with something on both sides, and fit
    both columns. Nothing stricter — an AD-style domain such as `hastane.local` is fine."""
    key = normalize_login(email)
    local, _, domain = key.partition("@")
    if (not key or any(ch.isspace() for ch in key) or key.count("@") != 1
            or not local or not domain or len(key) > _MAX_LOGIN):
        raise ValueError(
            f"Geçersiz e-posta {email!r}: bu değer yöneticinin hem kullanıcı adı hem "
            f"e-postası olur; boşluk içermeyen, tek '@' ile ad@alan biçiminde ve en fazla "
            f"{_MAX_LOGIN} karakter olmalı."
        )
    return key


async def _refuse(db: AsyncSession, message: str) -> NoReturn:
    """Roll back (nothing has been written; this also releases the seed lock) and refuse."""
    await db.rollback()
    raise SeedRefused(message)


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
    key = _bootstrap_login(email)

    # Serialise concurrent boots; held until the commit (or rollback) below.
    await db.execute(select(func.pg_advisory_xact_lock(
        func.hashtextextended(_SEED_LOCK_KEY, 0))))

    # By username OR e-mail: a hospital may rename the bootstrap account's username, and a
    # username-only lookup would then INSERT a second user with the same e-mail on the next
    # boot — the unique constraint would fail the boot script.
    user = await find_user_by_login(db, key)
    if user is not None:
        if not user.is_active:
            await _refuse(db, f"{key!r} hesabı pasif; tohumlama onu yeniden yönetici yapmaz. "
                              f"Tohumlama artık gerekmiyorsa SEED_ADMIN_PASSWORD değişkenini "
                              f"kaldırın.")
        if user.auth_source != AUTH_LOCAL:
            await _refuse(db, f"{key!r} yerel bir hesap değil ({user.auth_source}); tohumlama "
                              f"dizin hesabına yönetici yetkisi vermez.")
        elsewhere = (await db.execute(
            select(Tenant.slug)
            .join(TenantMembership, TenantMembership.tenant_id == Tenant.id)
            .where(TenantMembership.user_id == user.id, Tenant.slug != tenant_slug)
            .limit(1)
        )).scalar_one_or_none()
        if elsewhere is not None:
            await _refuse(db, f"{key!r} hesabı başka bir kurumun ({elsewhere!r}) üyesi; "
                              f"tohumlama onu {tenant_slug!r} yöneticisi yapmaz.")

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

    newly_linked = False
    if user is None:
        user = User(
            username=key, email=key, full_name=full_name,
            hashed_password=await run_bcrypt(hash_password, password), is_active=True,
        )
        db.add(user)
        await db.flush()
        newly_linked = True

    membership = (await db.execute(
        select(TenantMembership).where(
            TenantMembership.user_id == user.id,
            TenantMembership.tenant_id == tenant.id,
        )
    )).scalar_one_or_none()
    if membership is None:
        db.add(TenantMembership(user_id=user.id, tenant_id=tenant.id))
        await db.flush()
        newly_linked = True

    # Grant hospital_admin ONLY to an account or membership this run created. The seed runs on
    # every boot; re-granting on each start would silently undo a hospital's decision to demote
    # the generic bootstrap account. Additive, so it never strips groups the account already has.
    if newly_linked:
        links = await groups_of(db, user.id, tenant.id)
        manual_ids = {link.group_id for link in links if link.source == SOURCE_MANUAL}
        await set_manual_groups(db, user=user, tenant_id=tenant.id,
                                group_ids=manual_ids | {groups["hospital_admin"].id},
                                granted_by_id=None)

    await db.commit()
    await db.refresh(tenant)
    await db.refresh(user)
    return tenant, user

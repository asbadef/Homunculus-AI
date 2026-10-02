"""Create one test account per legacy role, each in the group that role maps to, so every group
can actually be signed into.

The /admin API creates accounts now, but only for an administrator who is already signed in. A
pilot or a developer machine wants a full set at once, and this script is that shortcut, run
against the deployment's database.

Each account gets exactly ONE group: `LEGACY_ROLE_TO_GROUP[role]` (ATTENDING -> attending,
NURSE -> nurse, ...). It deliberately does not go through `auth.seed.seed_bootstrap`: that function
creates the bootstrap ADMINISTRATOR and always puts its account in `hospital_admin`, so seeding
test users through it would make every one of them an administrator. Only the HOSPITAL_ADMIN test
account lands in `hospital_admin`, and the seeding refuses to put any other one in the system group.

Idempotent: an account that already exists (by username or e-mail) is left exactly as it is —
password and groups included. Re-running it is safe.

Run (inside the API container, which already has DATABASE_URL):
    docker compose exec api python scripts/seed_test_users.py

Or locally against a reachable database:
    DATABASE_URL=postgresql+asyncpg://... .venv/Scripts/python.exe scripts/seed_test_users.py

Env:
    DATABASE_URL          async SQLAlchemy URL (defaults to the local docker Postgres)
    SEED_TENANT_SLUG      which hospital these accounts belong to; MUST match the slug the
                          deployment already runs as, or the accounts log in fine and then
                          see an empty board (see deploy/local/.env.example on TENANT_SLUG).
                          A tenant that does not exist is created, and the output says so.
    TEST_USER_DOMAIN      email domain, default "homunculus.health"
    TEST_USER_PASSWORD    use ONE fixed password for every account instead of generating
                          per-account ones. Convenient for a pilot; never for production.

Passwords are generated and printed ONCE. They are not stored anywhere by this script —
copy them out of the output and keep them with the deployment's other credentials.
"""
from __future__ import annotations

import asyncio
import os
import secrets
import string
import sys
from typing import NamedTuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from homunculus.auth.groups import ensure_default_groups, set_manual_groups
from homunculus.auth.models import TenantMembership, User
from homunculus.auth.permissions import LEGACY_ROLE_TO_GROUP
from homunculus.auth.service import find_user_by_login, hash_password, normalize_login, run_bcrypt
from homunculus.tenant.models import Tenant

# One account per legacy role. The local part doubles as the label an operator sees in the
# output, so keep it readable. Synthetic accounts only — no real person.
TEST_USERS: list[tuple[str, str, str]] = [
    ("ATTENDING",           "test.sorumlu.hekim",   "TEST Sorumlu Hekim"),
    ("ASSOCIATE_PHYSICIAN", "test.yardimci.hekim",  "TEST Yardımcı Hekim"),
    ("ONCALL_PHYSICIAN",    "test.nobetci.hekim",   "TEST Nöbetçi Hekim"),
    ("UNIT_PHYSICIAN",      "test.unite.hekimi",    "TEST Ünite Hekimi"),
    ("CHARGE_NURSE",        "test.sorumlu.hemsire", "TEST Sorumlu Hemşire"),
    ("NURSE",               "test.hemsire",         "TEST Hemşire"),
    ("RAPID_RESPONSE",      "test.rrt",             "TEST Hızlı Yanıt Ekibi"),
    ("HOSPITAL_ADMIN",      "test.yonetici",        "TEST Hastane Yöneticisi"),
    ("AUDITOR",             "test.denetci",         "TEST Denetçi"),
    ("PLATFORM_SUPPORT",    "test.destek",          "TEST Platform Desteği"),
    ("PHARMACIST",          "test.eczaci",          "TEST Eczacı"),
    ("BIOMEDICAL",          "test.biyomedikal",     "TEST Biyomedikal"),
]

# The one legacy role whose account may hold the system group (every right, by rule).
_ADMIN_ROLE = "HOSPITAL_ADMIN"

_ALPHABET = string.ascii_letters + string.digits


def _generate_password() -> str:
    """A password nobody has to type twice and nobody can guess. 16 chars, mixed."""
    return "".join(secrets.choice(_ALPHABET) for _ in range(16)) + "!7"


# NamedTuple, not a dataclass: dev_local.py loads this file by path without registering it in
# sys.modules, and a dataclass looks its module up there while it is being defined.
class CreatedAccount(NamedTuple):
    legacy_role: str
    group_slug: str
    email: str
    password: str
    mfa_required: bool


class SeedResult(NamedTuple):
    tenant_created: bool
    created: list[CreatedAccount]
    existing: list[str]


async def seed_test_users(
    db: AsyncSession, *, tenant_slug: str, domain: str, shared_password: str | None = None,
) -> SeedResult:
    """Create the missing test accounts in `tenant_slug`, each with its tenant membership and
    exactly one manual group. Commits after the tenant's groups and after every account."""
    created: list[CreatedAccount] = []
    existing: list[str] = []
    tenant = (await db.execute(
        select(Tenant).where(Tenant.slug == tenant_slug)
    )).scalar_one_or_none()
    tenant_created = tenant is None
    if tenant_created:
        tenant = Tenant(name="Demo Hastanesi", slug=tenant_slug, country_code="TR",
                        timezone="UTC")
        db.add(tenant)
        await db.flush()
    tenant_id = tenant.id
    # Plain values, read before the commit: nothing below reloads an expired ORM object.
    groups = {slug: (g.id, g.is_system, g.mfa_required)
              for slug, g in (await ensure_default_groups(db, tenant_id)).items()}
    await db.commit()

    for legacy_role, local, full_name in TEST_USERS:
        slug = LEGACY_ROLE_TO_GROUP[legacy_role]
        group_id, is_system, mfa_required = groups[slug]
        if is_system and legacy_role != _ADMIN_ROLE:
            raise RuntimeError(f"{legacy_role} maps to the system group {slug!r}; "
                               f"only the {_ADMIN_ROLE} test account may hold it")
        key = normalize_login(f"{local}@{domain}")
        if await find_user_by_login(db, key) is not None:
            existing.append(key)
            continue
        password = shared_password or _generate_password()
        user = User(username=key, email=key, full_name=full_name,
                    hashed_password=await run_bcrypt(hash_password, password), is_active=True)
        db.add(user)
        await db.flush()
        db.add(TenantMembership(user_id=user.id, tenant_id=tenant_id))
        await db.flush()
        await set_manual_groups(db, user=user, tenant_id=tenant_id, group_ids={group_id},
                                granted_by_id=None)
        await db.commit()
        created.append(CreatedAccount(legacy_role, slug, key, password, mfa_required))
    return SeedResult(tenant_created, created, existing)


async def main() -> int:
    from homunculus.db import engine

    tenant_slug = os.getenv("SEED_TENANT_SLUG", "demo-hastanesi")
    domain = os.getenv("TEST_USER_DOMAIN", "homunculus.health")
    shared_password = os.getenv("TEST_USER_PASSWORD")

    maker = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with maker() as session:
            result = await seed_test_users(session, tenant_slug=tenant_slug, domain=domain,
                                           shared_password=shared_password)
    finally:
        await engine.dispose()

    print()
    print("=" * 96)
    print(f"TEST HESAPLARI — kiracı: {tenant_slug}")
    if result.tenant_created:
        print(f"⚠ {tenant_slug!r} kiracısı yoktu, oluşturuldu. Dağıtımın kiracısı bu değilse "
              f"SEED_TENANT_SLUG yanlış.")
    print("=" * 96)
    print(f"{'ROL':<20} {'GRUP':<17} {'E-POSTA':<40} PAROLA")
    print("-" * 96)
    for account in result.created:
        print(f"{account.legacy_role:<20} {account.group_slug:<17} {account.email:<40} "
              f"{account.password}")
    if result.existing:
        print()
        print("Zaten var (dokunulmadı, parolaları ve grupları değişmedi):")
        for email in result.existing:
            print(f"  {email}")
    mfa = [account.email for account in result.created if account.mfa_required]
    print()
    print("⚠ Parolalar yalnız burada gösterilir; betik hiçbir yere yazmaz. Şimdi kopyala.")
    if mfa:
        print(f"⚠ İlk girişte TOTP kuracak hesaplar: {', '.join(mfa)}")
    print("⚠ Bunlar TEST hesaplarıdır. Pilot bitince pasifleştirilmeli.")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

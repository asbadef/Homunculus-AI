"""Create one test account per role, so every role can actually be signed into.

There is no user-creation endpoint yet: `auth/router.py` exposes login, refresh, /me and the
TOTP pair, and nothing else. The dashboard's "User Invitation" and "User Management" screens
write to the browser's own store and never reach the API. So until that gap is closed
(phase 2 of the eight-phase plan), the only way to put a second account on a deployment is
this script, run against its database.

Idempotent, like seed_admin.py: an account that already exists is left exactly as it is,
password included. Re-running it is safe.

Run (inside the API container, which already has DATABASE_URL):
    docker compose exec api python scripts/seed_test_users.py

Or locally against a reachable database:
    DATABASE_URL=postgresql+asyncpg://... .venv/Scripts/python.exe scripts/seed_test_users.py

Env:
    DATABASE_URL          async SQLAlchemy URL (defaults to the local docker Postgres)
    SEED_TENANT_SLUG      which hospital these accounts belong to; MUST match the slug the
                          deployment already runs as, or the accounts log in fine and then
                          see an empty board (see deploy/local/.env.example on TENANT_SLUG)
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

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from homunculus.auth.models import User, UserRole
from homunculus.auth.seed import seed_bootstrap
from homunculus.db import engine

# One account per role in the catalogue. The local part doubles as the label an operator sees
# in the output, so keep it readable.
TEST_USERS: list[tuple[UserRole, str, str]] = [
    (UserRole.ATTENDING,           "test.sorumlu.hekim",   "TEST Sorumlu Hekim"),
    (UserRole.ASSOCIATE_PHYSICIAN, "test.yardimci.hekim",  "TEST Yardımcı Hekim"),
    (UserRole.ONCALL_PHYSICIAN,    "test.nobetci.hekim",   "TEST Nöbetçi Hekim"),
    (UserRole.UNIT_PHYSICIAN,      "test.unite.hekimi",    "TEST Ünite Hekimi"),
    (UserRole.CHARGE_NURSE,        "test.sorumlu.hemsire", "TEST Sorumlu Hemşire"),
    (UserRole.NURSE,               "test.hemsire",         "TEST Hemşire"),
    (UserRole.RAPID_RESPONSE,      "test.rrt",             "TEST Hızlı Yanıt Ekibi"),
    (UserRole.HOSPITAL_ADMIN,      "test.yonetici",        "TEST Hastane Yöneticisi"),
    (UserRole.AUDITOR,             "test.denetci",         "TEST Denetçi"),
    (UserRole.PLATFORM_SUPPORT,    "test.destek",          "TEST Platform Desteği"),
    (UserRole.PHARMACIST,          "test.eczaci",          "TEST Eczacı"),
    (UserRole.BIOMEDICAL,          "test.biyomedikal",     "TEST Biyomedikal"),
]

_ALPHABET = string.ascii_letters + string.digits


def _generate_password() -> str:
    """A password nobody has to type twice and nobody can guess. 16 chars, mixed."""
    return "".join(secrets.choice(_ALPHABET) for _ in range(16)) + "!7"


async def main() -> int:
    tenant_slug = os.getenv("SEED_TENANT_SLUG", "demo-hastanesi")
    domain = os.getenv("TEST_USER_DOMAIN", "homunculus.health")
    shared_password = os.getenv("TEST_USER_PASSWORD")

    maker = async_sessionmaker(engine, expire_on_commit=False)
    created: list[tuple[str, str, str]] = []
    existing: list[str] = []

    async with maker() as session:
        for role, local, full_name in TEST_USERS:
            email = f"{local}@{domain}"

            # Ask BEFORE seeding whether the row is already there. seed_bootstrap is idempotent
            # and returns the existing user unchanged, so afterwards there is no way to tell the
            # two cases apart — and printing a freshly generated password next to an account
            # whose stored hash is something else would be worse than printing nothing.
            already = (await session.execute(
                select(User).where(User.email == email)
            )).scalar_one_or_none() is not None

            password = shared_password or _generate_password()
            # seed_bootstrap finds the tenant by slug and only creates what is missing, so
            # passing tenant_name/country here affects nothing on an already-seeded database.
            await seed_bootstrap(
                session,
                tenant_name="Demo Hastanesi",
                tenant_slug=tenant_slug,
                country_code="TR",
                email=email,
                full_name=full_name,
                password=password,
                role=role,
            )
            if already:
                existing.append(email)
            else:
                created.append((role.value, email, password))

    print()
    print("=" * 78)
    print(f"TEST HESAPLARI — kiracı: {tenant_slug}")
    print("=" * 78)
    print(f"{'ROL':<22} {'E-POSTA':<40} PAROLA")
    print("-" * 78)
    for role_name, email, password in created:
        print(f"{role_name:<22} {email:<40} {password}")
    if existing:
        print()
        print("Zaten var (dokunulmadı, parolaları değişmedi):")
        for email in existing:
            print(f"  {email}")
    print()
    print("⚠ Parolalar yalnız burada gösterilir; betik hiçbir yere yazmaz. Şimdi kopyala.")
    print("⚠ Bunlar TEST hesaplarıdır. Pilot bitince pasifleştirilmeli.")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

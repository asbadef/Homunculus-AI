"""Create the bootstrap tenant + HOSPITAL_ADMIN so a fresh database can be logged into.

Idempotent — safe to re-run (the host may call it on every deploy).

Run:
    SEED_ADMIN_EMAIL=admin@hastane.local SEED_ADMIN_PASSWORD='...' \
    homunculus-engine/.venv/Scripts/python.exe homunculus-engine/scripts/seed_admin.py

Env (all optional except the password):
    DATABASE_URL          async SQLAlchemy URL (defaults to the local docker Postgres)
    SEED_TENANT_NAME      default "Demo Hastanesi"
    SEED_TENANT_SLUG      default "demo-hastanesi"
    SEED_TENANT_COUNTRY   default "TR"
    SEED_ADMIN_EMAIL      default "admin@demo.local"
    SEED_ADMIN_NAME       default "Sistem Yöneticisi"
    SEED_ADMIN_PASSWORD   REQUIRED — no default, so no deployment ships a known password
"""
from __future__ import annotations

import asyncio
import os
import sys

from sqlalchemy.ext.asyncio import async_sessionmaker

from homunculus.auth.seed import seed_bootstrap
from homunculus.db import engine


async def main() -> int:
    password = os.getenv("SEED_ADMIN_PASSWORD")
    if not password:
        print("SEED_ADMIN_PASSWORD is required (refusing to seed a default password).",
              file=sys.stderr)
        return 2

    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        tenant, user = await seed_bootstrap(
            session,
            tenant_name=os.getenv("SEED_TENANT_NAME", "Demo Hastanesi"),
            tenant_slug=os.getenv("SEED_TENANT_SLUG", "demo-hastanesi"),
            country_code=os.getenv("SEED_TENANT_COUNTRY", "TR"),
            email=os.getenv("SEED_ADMIN_EMAIL", "admin@demo.local"),
            full_name=os.getenv("SEED_ADMIN_NAME", "Sistem Yöneticisi"),
            password=password,
        )
    await engine.dispose()
    print(f"seeded: tenant={tenant.slug!r} admin={user.email!r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

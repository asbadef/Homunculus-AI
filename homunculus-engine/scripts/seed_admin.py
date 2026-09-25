"""Create the bootstrap tenant, its default groups, and the first administrator (in the
`hospital_admin` group) so a fresh database can be logged into.

Idempotent — safe to re-run (the host may call it on every deploy).

Changing SEED_ADMIN_EMAIL after the first boot creates a SECOND administrator at the new address:
the old account stays, with its rights, and should be deactivated from the admin screen. If the
account at the configured address exists but is inactive, not a local account, or a member of
another tenant, the seed refuses to touch it and the boot carries on (see auth/seed.py).

Run:
    SEED_ADMIN_EMAIL=admin@hastane.com.tr SEED_ADMIN_PASSWORD='...' \
    homunculus-engine/.venv/Scripts/python.exe homunculus-engine/scripts/seed_admin.py

Env (all optional except the password):
    DATABASE_URL          async SQLAlchemy URL (defaults to the local docker Postgres)
    SEED_TENANT_NAME      default "Demo Hastanesi"
    SEED_TENANT_SLUG      default "demo-hastanesi"
    SEED_TENANT_COUNTRY   default "TR"
    SEED_ADMIN_EMAIL      default "admin@example.com" — becomes the admin's username AND e-mail:
                          no spaces, exactly one '@' with text on both sides, at most 128 chars
    SEED_ADMIN_NAME       default "Sistem Yöneticisi"
    SEED_ADMIN_PASSWORD   REQUIRED — no default, so no deployment ships a known password. A NEW
                          administrator needs at least 12 characters and no known placeholder
                          (change-me, password, ...); otherwise the seed is skipped, loudly
"""
from __future__ import annotations

import asyncio
import os
import sys

from sqlalchemy.ext.asyncio import async_sessionmaker

from homunculus.auth.seed import SeedRefused, seed_bootstrap
from homunculus.db import engine


async def main() -> int:
    password = os.getenv("SEED_ADMIN_PASSWORD")
    if not password:
        # Deploys run this on every boot. Once the admin exists the operator can remove the
        # password from the environment, and restarts must not fail — so skip loudly, not fatally.
        # (There is deliberately no default password: no deployment ships a known credential.)
        print("SEED_ADMIN_PASSWORD not set — skipping bootstrap seed.", file=sys.stderr)
        return 0

    maker = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with maker() as session:
            tenant, user = await seed_bootstrap(
                session,
                tenant_name=os.getenv("SEED_TENANT_NAME", "Demo Hastanesi"),
                tenant_slug=os.getenv("SEED_TENANT_SLUG", "demo-hastanesi"),
                country_code=os.getenv("SEED_TENANT_COUNTRY", "TR"),
                email=os.getenv("SEED_ADMIN_EMAIL", "admin@example.com"),
                full_name=os.getenv("SEED_ADMIN_NAME", "Sistem Yöneticisi"),
                password=password,
            )
    except SeedRefused as exc:
        # The account exists and was deliberately left alone (e.g. a hospital deactivated the
        # generic bootstrap account), or would have been created with a weak password. Same rule
        # as above: skip loudly, never stop the boot.
        print(f"bootstrap seed skipped: {exc}", file=sys.stderr)
        return 0
    finally:
        await engine.dispose()
    print(f"seeded: tenant={tenant.slug!r} admin={user.email!r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

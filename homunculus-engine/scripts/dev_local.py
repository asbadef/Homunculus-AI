"""Stand the whole product up on this machine, with no Docker and no PostgreSQL.

Why this exists: the product owner could not look at his own product. The supported local stack is
`deploy/local` (Docker Compose), and Docker's Linux engine will not start on the workstation this
was written on — WSL has no distribution installed, and fixing that needs administrator rights.
Everything else was reachable except the one thing that matters: a browser pointed at a running
system with real engine data behind it.

So this script builds the smallest honest substitute:

    * SQLite instead of PostgreSQL, for the auth/tenant/admission schema
    * `Base.metadata.create_all` instead of Alembic, because the migrations are Postgres-specific
      (JSONB, `ALTER TYPE ... ADD VALUE`) and a SQLite run of them proves nothing anyway
    * the same seeding scripts the real deployment uses, so the accounts are the real accounts

**This is a development convenience and nothing else.** It is not a rehearsal for the pilot: it
does not exercise the migrations, and a migration that has not run on PostgreSQL is still
unrehearsed after this script succeeds. Saying otherwise would turn a demo into false assurance,
which is the failure mode this project keeps finding in its own past work.

Run (cmd.exe, from homunculus-engine\\):

    set DATABASE_URL=sqlite+aiosqlite:///./dev-local.db
    set JWT_SECRET=dev-only-not-a-secret
    set SEED_ADMIN_EMAIL=admin@homunculus.health
    set SEED_ADMIN_PASSWORD=Demo1234!
    set TEST_USER_PASSWORD=Demo1234!
    .venv\\Scripts\\python.exe scripts\\dev_local.py
"""
from __future__ import annotations

import asyncio
import os
import sys

# cmd.exe hands Python a cp1252 stdout, which cannot encode "Şema" and kills the script on its
# first print — an error about codecs, in the middle of a script whose whole job is to be the easy
# path. Reconfigured rather than avoided: the output stays Turkish, because the person running
# this reads Turkish.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass   # already UTF-8, or a stream that cannot be reconfigured (a pipe under test)

DEFAULTS = {
    "DATABASE_URL": "sqlite+aiosqlite:///./dev-local.db",
    "JWT_SECRET": "dev-only-not-a-secret",
    # `.local` is a reserved suffix and the login API's own validator rejects it, so an
    # account seeded with it could never be signed into. Matches the test users' domain.
    "SEED_ADMIN_EMAIL": "admin@homunculus.health",
    "SEED_ADMIN_PASSWORD": "Demo1234!",
    "SEED_TENANT_SLUG": "demo-hastanesi",
    "TEST_USER_PASSWORD": "Demo1234!",
}


def _apply_defaults() -> None:
    """Fill in what the operator did not set — but never a Postgres URL.

    A missing DATABASE_URL would otherwise fall through to `db.py`'s default, which points at the
    docker-compose PostgreSQL. On a machine where that is not running the script fails with a
    connection error that says nothing about the real cause; worse, on a machine where it IS
    running, this development script would quietly seed a database somebody meant to keep.
    """
    for key, value in DEFAULTS.items():
        os.environ.setdefault(key, value)
    url = os.environ["DATABASE_URL"]
    if not url.startswith("sqlite"):
        print(f"dev_local.py refuses a non-SQLite DATABASE_URL ({url.split('://')[0]}://…).\n"
              f"It creates the schema with create_all rather than Alembic, which must never touch "
              f"a real database. Unset DATABASE_URL to use the local SQLite file.", file=sys.stderr)
        raise SystemExit(2)


async def _create_schema() -> int:
    from homunculus.db import Base, engine
    # Imported for their side effect: a model class that is never imported never registers with
    # Base.metadata, and create_all would silently produce a schema missing those tables.
    import homunculus.admission.models          # noqa: F401
    import homunculus.auth.models               # noqa: F401
    import homunculus.escalation.models         # noqa: F401
    import homunculus.tenant.models             # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return len(Base.metadata.tables)


def main() -> int:
    _apply_defaults()
    tables = asyncio.run(_create_schema())
    print(f"[1/3] Şema kuruldu — {tables} tablo · {os.environ['DATABASE_URL']}")

    # Run the deployment's own seeders, so these are the same accounts a real install gets.
    # `scripts/` is a plain directory, not a package, so it is loaded by path rather than imported.
    import importlib.util
    from pathlib import Path

    def _load(name):
        spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(f"{name}.py"))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    seed_admin = _load("seed_admin")
    seed_test_users = _load("seed_test_users")
    print("[2/3] Yönetici hesabı:")
    asyncio.run(seed_admin.main())
    print("[3/3] Rol başına test hesapları:")
    asyncio.run(seed_test_users.main())

    print("\nHazır. Şimdi iki pencere aç (cmd):")
    print(r"  1) homunculus-engine\.venv\Scripts\python.exe -m uvicorn "
          r"homunculus.api.devserver:app --port 8000")
    print(r"  2) cd app\dashboard  &&  npm run dev")
    print("  Sonra: http://localhost:5173")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

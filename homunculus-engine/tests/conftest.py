"""
Shared pytest fixtures for DB-backed admission-workflow tests.

These tests require a real PostgreSQL (the models use PostgreSQL-specific types:
UUID, JSONB, and a partial unique index). If TEST_DATABASE_URL is not set, the
DB-backed tests are skipped so the pure-logic suite still runs anywhere.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
ENGINE_ROOT = Path(__file__).resolve().parents[1]   # homunculus-engine/, holds alembic.ini

# Import all model modules so their tables register on Base.metadata.
import homunculus.auth.models  # noqa: E402,F401
import homunculus.tenant.models  # noqa: E402,F401
import homunculus.admission.models  # noqa: E402,F401
import homunculus.escalation.models  # noqa: E402,F401
from homunculus.db import Base  # noqa: E402

requires_db = pytest.mark.skipif(
    TEST_DATABASE_URL is None,
    reason="TEST_DATABASE_URL not set; skipping DB-backed tests.",
)

# The read-only check against a real directory (tests/test_ldap_integration.py), run by hand on
# the VM (docs/EDGE-BRIDGE-LOCAL.md, "Active Directory sign-in"): skipped unless all four
# LDAP_TEST_* variables are set.
LDAP_TEST_ENV = ("LDAP_TEST_URL", "LDAP_TEST_BIND_DN", "LDAP_TEST_BIND_PASSWORD",
                 "LDAP_TEST_BASE_DN")
requires_ldap = pytest.mark.skipif(
    not all(os.getenv(name) for name in LDAP_TEST_ENV),
    reason="LDAP_TEST_* not set; the directory integration test runs by hand on the VM.",
)

# SAFETY: the db_session fixture drops every table. Pointing TEST_DATABASE_URL at a real database
# (a dev instance, or worse a managed one like Supabase) would destroy it. Require the database
# name to say "test" so that can only ever happen deliberately.
if TEST_DATABASE_URL is not None:
    _db_name = TEST_DATABASE_URL.rsplit("/", 1)[-1].split("?")[0]
    if "test" not in _db_name.lower():
        raise RuntimeError(
            f"Refusing to run DB tests against database {_db_name!r}: these tests DROP ALL TABLES. "
            f"Point TEST_DATABASE_URL at a dedicated database whose name contains 'test' "
            f"(e.g. .../homunculus_test)."
        )


# ONE run at a time on the test database. `db_session` drops and recreates every table per test,
# and the migration tests rebuild the schema, so two runs against one TEST_DATABASE_URL corrupt
# each other (missing tables, a `pg_type` unique violation, a deadlocked DROP). The run holds a
# Postgres SESSION-level advisory lock on a dedicated connection from start to finish; a second run
# waits for it, saying so once. Advisory locks are per database, and the server releases a
# session lock when the connection goes away, so a crashed or killed run frees it too. Taken only
# when TEST_DATABASE_URL is set: runs without the database pay nothing.
_RUN_LOCK_ID = 0x486F6D756E63   # "Homunc": this project's test-run lock
_RUN_LOCK = pytest.StashKey[object]()


def _libpq_url(url: str) -> str:
    """The libpq form of an async SQLAlchemy URL, password included: for `psycopg2.connect`."""
    from sqlalchemy.engine import make_url
    return make_url(url).set(drivername="postgresql").render_as_string(hide_password=False)


def _sync_engine_url(url: str) -> str:
    """The sync SQLAlchemy URL, with its driver named: a bare `postgresql://` means psycopg2 to
    SQLAlchemy 2.0 but psycopg (3) to 2.1, which this project does not install."""
    from sqlalchemy.engine import make_url
    return (make_url(url).set(drivername="postgresql+psycopg2")
            .render_as_string(hide_password=False))


def pytest_sessionstart(session):
    if TEST_DATABASE_URL is None:
        return
    import psycopg2

    conn = psycopg2.connect(_libpq_url(TEST_DATABASE_URL))
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("SELECT pg_try_advisory_lock(%s)", (_RUN_LOCK_ID,))
        if not cur.fetchone()[0]:
            line = (f"waiting for another test run on database {_db_name!r} to finish "
                    f"(advisory lock {_RUN_LOCK_ID:#x})")
            reporter = session.config.pluginmanager.get_plugin("terminalreporter")
            if reporter is not None:
                reporter.write_line(line)
            else:
                print(line, flush=True)
            cur.execute("SELECT pg_advisory_lock(%s)", (_RUN_LOCK_ID,))
    session.config.stash[_RUN_LOCK] = conn


def pytest_sessionfinish(session, exitstatus):
    conn = session.config.stash.get(_RUN_LOCK, None)
    if conn is not None:
        conn.close()   # ends the database session, which releases the lock
        del session.config.stash[_RUN_LOCK]


@pytest_asyncio.fixture
async def db_session():
    if TEST_DATABASE_URL is None:
        pytest.skip("TEST_DATABASE_URL not set.")
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        yield session
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


def _reset_public_schema(engine) -> None:
    from sqlalchemy import text

    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))


@pytest.fixture
def clean_db(monkeypatch):
    """An EMPTY `public` schema, a sync engine on it, and the Alembic config that builds it the
    way production does: `command.upgrade(cfg, "head")` (or any revision). `db_session` builds
    the schema from the models with `create_all`, so it cannot see a migration that leaves a
    column differently typed from its model (deploy blocker B1); tests that must see the deployed
    schema run the real chain through this fixture.

    The tests using it are sync on purpose: `alembic/env.py` drives its async engine with
    `asyncio.run`, which cannot run inside a running event loop, so their async parts go through
    `asyncio.run` too. `public` is rebuilt before and after; the name guard above refuses any
    database whose name does not contain "test"."""
    if TEST_DATABASE_URL is None:
        pytest.skip("TEST_DATABASE_URL not set.")
    from alembic.config import Config
    from sqlalchemy import create_engine

    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)   # alembic/env.py reads this
    engine = create_engine(_sync_engine_url(TEST_DATABASE_URL))
    _reset_public_schema(engine)
    cfg = Config(str(ENGINE_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ENGINE_ROOT / "alembic"))
    yield engine, cfg
    _reset_public_schema(engine)
    engine.dispose()

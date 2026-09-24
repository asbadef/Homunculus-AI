"""
Shared pytest fixtures for DB-backed admission-workflow tests.

These tests require a real PostgreSQL (the models use PostgreSQL-specific types:
UUID, JSONB, and a partial unique index). If TEST_DATABASE_URL is not set, the
DB-backed tests are skipped so the pure-logic suite still runs anywhere.
"""
from __future__ import annotations

import os

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")

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
    """The sync (psycopg2) form of an async SQLAlchemy URL, password included."""
    from sqlalchemy.engine import make_url
    return make_url(url).set(drivername="postgresql").render_as_string(hide_password=False)


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

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
from homunculus.db import Base  # noqa: E402

requires_db = pytest.mark.skipif(
    TEST_DATABASE_URL is None,
    reason="TEST_DATABASE_URL not set; skipping DB-backed tests.",
)


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

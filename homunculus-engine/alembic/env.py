"""
Alembic migration environment — async (asyncpg) aware.

The database URL is taken from the DATABASE_URL environment variable, falling
back to the docker-compose default. All model modules are imported so that
``target_metadata`` reflects the full schema for autogenerate support.
"""
from __future__ import annotations

import asyncio
import os

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from homunculus.db import Base, ssl_context, to_async_url

# Import all model modules so their tables register on Base.metadata.
import homunculus.auth.models  # noqa: F401
import homunculus.tenant.models  # noqa: F401
import homunculus.admission.models  # noqa: F401
import homunculus.escalation.models  # noqa: F401

config = context.config

# Normalised the same way the application does: migrations run through an async engine, so a
# pasted `postgresql://…` (what managed-database dashboards show) must become the asyncpg form.
DATABASE_URL = to_async_url(os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://homunculus:homunculus@localhost:5432/homunculus",
))
config.set_main_option("sqlalchemy.url", DATABASE_URL)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode (emit SQL to script, no DBAPI)."""
    context.configure(
        url=DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    """Run migrations in 'online' mode using an async engine."""
    # Same TLS decision as the application, so migrations cannot fail on a setting the app accepts.
    _ctx = ssl_context()
    _connect_args = {"ssl": _ctx, "statement_cache_size": 0} if _ctx else {}
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
        connect_args=_connect_args,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())

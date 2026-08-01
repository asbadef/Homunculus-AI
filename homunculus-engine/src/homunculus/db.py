"""
Async SQLAlchemy engine + session factory.
DATABASE_URL env var; falls back to the docker-compose default.
"""
from __future__ import annotations
import os
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://homunculus:homunculus@localhost:5432/homunculus",
)

# Managed Postgres (e.g. Supabase pooler) requires TLS. Enabled via env so local docker dev is
# unaffected. statement_cache_size=0 keeps asyncpg compatible with the Supabase connection pooler
# (pgbouncer). Set DATABASE_SSL=require on the host.
_SSL = os.getenv("DATABASE_SSL", "").lower() in ("require", "true", "1")
_CONNECT_ARGS = {"ssl": True, "statement_cache_size": 0} if _SSL else {}

engine = create_async_engine(
    DATABASE_URL, echo=False, pool_pre_ping=True, connect_args=_CONNECT_ARGS
)
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session

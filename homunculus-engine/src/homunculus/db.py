"""
Async SQLAlchemy engine + session factory.
DATABASE_URL env var; falls back to the docker-compose default.
"""
from __future__ import annotations
import logging
import os
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

_PG_SCHEMES = ("postgresql+asyncpg://", "postgresql+psycopg2://", "postgresql://", "postgres://")


def to_async_url(url: str) -> str:
    """Normalise any pasted Postgres URL onto the async driver.

    Managed-database dashboards hand out `postgresql://…`, which SQLAlchemy resolves to psycopg2 —
    a sync driver that create_async_engine rejects at import time with an error that never mentions
    the URL. Rather than asking an operator to remember the rewrite, accept whichever form they
    paste. Non-Postgres URLs (SQLite in tests) are left untouched.
    """
    for scheme in _PG_SCHEMES:
        if url.startswith(scheme):
            return "postgresql+asyncpg://" + url[len(scheme):]
    return url


def warn_if_ipv6_only_host(url: str) -> str | None:
    """Supabase's *direct* host (db.<ref>.supabase.co) resolves to IPv6 only. Hosts without IPv6
    egress — Render's free tier among them — fail with a bare "Network is unreachable" that names
    neither the database nor the cause. Return an explanation so it appears next to the failure."""
    if ".supabase.co" in url and "pooler.supabase.com" not in url:
        return (
            "DATABASE_URL points at Supabase's DIRECT host (db.<ref>.supabase.co), which is "
            "IPv6-only. Hosts without IPv6 egress fail with 'Network is unreachable'. Use the "
            "Session pooler string instead: user postgres.<ref>, host "
            "aws-0-<region>.pooler.supabase.com."
        )
    return None


DATABASE_URL = to_async_url(os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://homunculus:homunculus@localhost:5432/homunculus",
))

_hint = warn_if_ipv6_only_host(DATABASE_URL)
if _hint:
    logging.getLogger(__name__).warning("%s", _hint)

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

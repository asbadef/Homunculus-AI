"""
Async SQLAlchemy engine + session factory.
DATABASE_URL env var; falls back to the docker-compose default.
"""
from __future__ import annotations
import logging
import os
import ssl
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

def ssl_context():
    """TLS settings for a managed Postgres, or None for a plain local connection.

    The connection is always encrypted when DATABASE_SSL is set. Whether the server's certificate
    is *verified* depends on DATABASE_CA_CERT:

      * with it — full verification against that CA (Supabase publishes one; this is the right
        setting for anything carrying real data over the public internet);
      * without it — encrypted but unverified, because the Supabase pooler presents a chain that
        is not in the system trust store, and `ssl=True` fails there with "self-signed certificate
        in certificate chain". Traffic is still encrypted; what is lost is proof of who is on the
        other end, so this is a pilot convenience, not the end state.
    """
    if os.getenv("DATABASE_SSL", "").lower() not in ("require", "true", "1", "verify"):
        return None

    ca_cert = os.getenv("DATABASE_CA_CERT")
    if ca_cert:
        return ssl.create_default_context(cafile=ca_cert)

    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    logging.getLogger(__name__).warning(
        "TLS is on but the server certificate is NOT verified. Set DATABASE_CA_CERT to Supabase's "
        "CA bundle to enable verification before this carries real data."
    )
    return context


# statement_cache_size=0 keeps asyncpg compatible with the Supabase connection pooler (pgbouncer).
_SSL_CONTEXT = ssl_context()
_CONNECT_ARGS = {"ssl": _SSL_CONTEXT, "statement_cache_size": 0} if _SSL_CONTEXT else {}

engine = create_async_engine(
    DATABASE_URL, echo=False, pool_pre_ping=True, connect_args=_CONNECT_ARGS
)
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session

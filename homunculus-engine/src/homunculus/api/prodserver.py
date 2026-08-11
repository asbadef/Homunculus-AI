# src/homunculus/api/prodserver.py
"""Production ASGI entry. All config comes from environment variables — no hardcoded secrets.

Run (host does this via render.yaml startCommand):
    alembic upgrade head && uvicorn homunculus.api.prodserver:app --host 0.0.0.0 --port $PORT

Env:
    TENANTS        "tokenA:HOSP1,tokenB:HOSP2"  (legacy bearer-token ingest/board tenancy)
    AUDIT_DB_PATH  path for the SQLite audit log (default /tmp; ephemeral on Render — synthetic only)
    DATABASE_URL / DATABASE_SSL / JWT_SECRET / CORS_ORIGINS  read by db.py / auth.jwt / app.py
"""
from __future__ import annotations

import os

from homunculus.api.app import create_app
from homunculus.api.audit import SqliteAuditLog


def _parse_tenants(raw: str | None) -> dict[str, str]:
    tenants: dict[str, str] = {}
    for pair in (raw or "").split(","):
        pair = pair.strip()
        if ":" in pair:
            token, hospital = pair.split(":", 1)
            tenants[token.strip()] = hospital.strip()
    return tenants or {"demo-token": "HOSP1"}   # safe default; override via TENANTS in production


def _audit():
    """Prefer the durable Postgres audit; fall back to SQLite only without a database.

    Hosts like Render and Vercel discard the local filesystem on every deploy, so a SQLite audit
    there disappears while still looking like a record — worse than having none. When DATABASE_URL
    is configured the trail goes to the same managed Postgres as everything else.
    """
    url = os.getenv("DATABASE_URL")
    if url and url.startswith("postgresql"):
        from homunculus.api.audit_postgres import PostgresAuditLog

        return PostgresAuditLog(
            url, ssl_required=os.getenv("DATABASE_SSL", "").lower() in ("require", "true", "1")
        )
    # Relative by default so it resolves on any platform; an absolute "/tmp/..." is not a valid
    # path on Windows, where developers run this too.
    return SqliteAuditLog(os.getenv("AUDIT_DB_PATH", "homunculus-audit.db"))


app = create_app(_parse_tenants(os.getenv("TENANTS")), audit=_audit())

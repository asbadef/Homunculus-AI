"""Vercel serverless entry for the Homunculus API.

Vercel runs this as a Python function; every request is a fresh, short-lived invocation. That
shapes two decisions:

  * The background escalation loop is DISABLED (`run_escalation_loop=False`). A loop started per
    invocation would never outlive the request, so it would burn time without ever escalating.
    Escalation needs a persistent host (see docs/DEPLOY-SUPABASE.md) before it goes live.

  * The audit log is in-memory. Serverless has no durable local disk, so a SQLite audit would be
    silently discarded between requests — worse than none, because it would *look* recorded. The
    endpoints that write audit records (/ingest, /ack, /view) therefore must not be relied on here
    until the audit is backed by Postgres.

Authentication (/auth/*) and the other stateless REST domains work normally: they read and write
Postgres directly, which is where the real state lives.

The app is mounted under /api so the static dashboard keeps the root path.
"""
from __future__ import annotations

import os

from starlette.applications import Starlette
from starlette.routing import Mount

from homunculus.api.app import create_app
from homunculus.api.audit import InMemoryAuditLog


def _parse_tenants(raw: str | None) -> dict[str, str]:
    """TENANTS="tokenA:HOSP1,tokenB:HOSP2" -> {"tokenA": "HOSP1", ...}"""
    tenants: dict[str, str] = {}
    for pair in (raw or "").split(","):
        pair = pair.strip()
        if ":" in pair:
            token, hospital = pair.split(":", 1)
            tenants[token.strip()] = hospital.strip()
    return tenants or {"demo-token": "HOSP1"}


_api = create_app(
    _parse_tenants(os.getenv("TENANTS")),
    run_escalation_loop=False,
    audit=InMemoryAuditLog(),
)

# Vercel routes /api/* here; strip that prefix so the API sees its own paths (/auth/login, /health…).
app = Starlette(routes=[Mount("/api", app=_api)])

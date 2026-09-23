# homunculus-engine/src/homunculus/auth/audit.py
"""Auth and admin events go to the same append-only trail as the clinical events.

`create_app` puts the AuditLog on `app.state.audit`; a router mounted anywhere else (a bare
FastAPI in a test) simply has no trail, and that must not turn into a 500 on sign-in.
"""
from __future__ import annotations

from fastapi import Request

from homunculus.api.audit import AuditEvent


def append_audit(request: Request, *, tenant: str | None, event_type: str, subject: str,
                 payload: dict) -> None:
    log = getattr(request.app.state, "audit", None)
    if log is None:
        return
    log.append(AuditEvent(tenant or "-", event_type, "", subject, payload))

# homunculus-engine/src/homunculus/admission/trail.py
"""Where the admission, bed and structure routes meet the engine's world: its hospital key and its
audit (Group 2 · B1a).

The routers act on a tenant by UUID (`caller_tenant_id`); the engine, the identity store and the
audit key a hospital by the tenant's SLUG (api/identity.py: "the engine's hospital key *is* the
tenant slug"). `hospital_of` turns one into the other; `record` appends one row to the app's own
audit log under it — the append-only, hash-chained trail an inspection reads.

What a row carries: ids, the patient NUMBER, the actor, the fields a decision turned on. Never a
name: the audit is PHI-free by design (the name lives in the encrypted stores). A structure row
(`structure.create|rename|close|reopen`, amendment A-4) carries no patient at all.
"""
from __future__ import annotations

import uuid

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.api.audit import AuditEvent
from homunculus.tenant.models import Tenant


async def hospital_of(db: AsyncSession, tenant_id: uuid.UUID) -> str:
    """The engine's hospital key for this tenant: its slug."""
    return (await db.execute(select(Tenant.slug).where(Tenant.id == tenant_id))).scalar_one()


def record(request: Request, hospital: str, event_type: str, *, patient_id: str = "",
           subject: str = "", payload: dict) -> None:
    """One row in the app's audit log. An app assembled without one (a test mounting the routers
    alone) writes nothing here rather than failing the write it describes."""
    log = getattr(request.app.state, "audit", None)
    if log is not None:
        log.append(AuditEvent(hospital, event_type, patient_id, subject, payload))

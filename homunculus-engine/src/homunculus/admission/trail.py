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

A row is written AFTER the change it describes has committed, so it stands for something that
happened. If the audit store then fails, the change has still happened: the route answers its
success, and the failure is logged at ERROR for whoever keeps the log (amendment A-26) — never a
500 for a committed change.
"""
from __future__ import annotations

import logging
import uuid

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.api.audit import AuditEvent
from homunculus.tenant.models import Tenant

_log = logging.getLogger(__name__)


async def hospital_of(db: AsyncSession, tenant_id: uuid.UUID) -> str:
    """The engine's hospital key for this tenant: its slug."""
    return (await db.execute(select(Tenant.slug).where(Tenant.id == tenant_id))).scalar_one()


#: The payload keys a log line may carry: a structure row's kind and object id, and the ids of
#: our own rows that the admission, bed and structure rows name. An ALLOW-list, not a pattern: a
#: key merely ending in "_id" (a `national_id`, a HIS reference) identifies a person and stays
#: out. A new row type whose ids should be logged adds them here.
LOGGED_KEYS = ("kind", "id", "admission_id", "bed_id", "unit_id", "room_id", "site_id")


def _ids(payload: dict) -> str:
    """What of a payload a log line may carry: the allow-listed keys it has. Never a name, a
    label, a person's identifier or a value a clinician wrote."""
    return " ".join(f"{k}={payload[k]}" for k in LOGGED_KEYS if k in payload)


def record(request: Request, hospital: str, event_type: str, *, patient_id: str = "",
           subject: str = "", payload: dict) -> None:
    """One row in the app's audit log, written after the change it describes has committed. An
    app assembled without one (a test mounting the routers alone) writes nothing here rather than
    failing the write it describes.

    Never raises (amendment A-26). A store that fails is logged at ERROR with the event type, the
    hospital, the patient number if the row has one, the ids and the actor. The exception's class
    is logged but not its words, which could repeat the payload."""
    log = getattr(request.app.state, "audit", None)
    if log is None:
        return
    try:
        log.append(AuditEvent(hospital, event_type, patient_id, subject, payload))
    except Exception as exc:  # noqa: BLE001 — the write it describes has committed already
        _log.error("audit row not written after a committed change: event=%s hospital=%s "
                   "patient=%s %s actor=%s error=%s", event_type, hospital, patient_id or "-",
                   _ids(payload), payload.get("actor", "-"), type(exc).__name__)

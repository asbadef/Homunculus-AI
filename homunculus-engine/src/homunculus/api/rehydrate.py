# src/homunculus/api/rehydrate.py
"""Rehydrate engine + ack state from the audit log (event sourcing).

The append-only audit is the event log: replaying its `ingest` and `ack` records in id order into a
fresh Engine + AckStore reconstructs the runtime state a restart would otherwise lose. Replay calls
the engine/store directly, so it writes NO new audit records. Deliberately NOT replayed: first_seen
(escalation clock resets on restart), the derived `escalated` set, and transient notifications."""
from __future__ import annotations

from datetime import datetime

from homunculus.api.ackstore import AckStore
from homunculus.api.audit import AuditRecord
from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine


def rehydrate(engine: Engine, store: AckStore, records: list[AuditRecord]) -> None:
    for rec in records:
        if rec.event_type == "ingest":
            _replay_ingest(engine, rec)
        elif rec.event_type == "ack":
            _replay_ack(store, rec)
        # alert / escalation / notification are derived or transient — nothing to replay.


def _replay_ingest(engine: Engine, rec: AuditRecord) -> None:
    try:
        code = SignalCode(rec.subject)
    except ValueError:
        return  # unknown signal slug — skip rather than fail the whole replay
    p = rec.payload
    ts = datetime.fromisoformat(p["obs_ts"])
    obs = Observation(patient_id=rec.patient_id, code=code, value=float(p["value"]),
                      unit=p.get("unit", ""), timestamp=ts, source_device=p.get("device", "replay"))
    engine.ingest(obs, now=ts)


def _replay_ack(store: AckStore, rec: AuditRecord) -> None:
    at = datetime.fromisoformat(rec.payload["at"])
    store.acknowledge(rec.patient_id, rec.subject, rec.payload.get("role", "unknown"), at)

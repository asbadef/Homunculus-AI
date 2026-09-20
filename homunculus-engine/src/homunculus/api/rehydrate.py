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
from homunculus.api.clinical import profile_from_payload
from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine


def rehydrate(engine: Engine, store: AckStore, records: list[AuditRecord]) -> None:
    for rec in records:
        if rec.event_type in ("ingest", "chart"):
            # `chart` is a clinician's observation and replays exactly like a device's. It has
            # to: a charted `suspected_infection` that a restart forgot would take the sepsis,
            # septic-shock and antibiotic-clock alerts down with it, silently, on a patient the
            # ward believes is being watched for exactly those.
            _replay_ingest(engine, rec)
        elif rec.event_type == "profile":
            _replay_profile(engine, rec)
        elif rec.event_type == "ack":
            _replay_ack(store, rec)
        elif rec.event_type == "first_seen":
            store.first_seen.setdefault((rec.patient_id, rec.subject),
                                        datetime.fromisoformat(rec.payload["at"]))
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


def _replay_profile(engine: Engine, rec: AuditRecord) -> None:
    """Restore a clinician-charted baseline/comorbidity profile.

    Losing this on restart is not a cosmetic loss: without the profile the patient-relative
    layer stops downgrading chronic-normal values, so a patient whose atrial fibrillation lives
    at 105 bpm starts alarming on every measurement again — the exact alarm fatigue the layer
    exists to prevent, arriving quietly after a deploy.
    """
    try:
        engine.set_profile(profile_from_payload(rec.patient_id, rec.payload))
    except (ValueError, TypeError, KeyError):
        return  # a payload we cannot read must not fail the whole replay


def _replay_ack(store: AckStore, rec: AuditRecord) -> None:
    at = datetime.fromisoformat(rec.payload["at"])
    store.acknowledge(rec.patient_id, rec.subject, rec.payload.get("role", "unknown"), at)

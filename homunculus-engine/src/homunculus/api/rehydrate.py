# src/homunculus/api/rehydrate.py
"""Rehydrate engine + ack state from the audit log (event sourcing).

The append-only audit is the event log: replaying its `ingest`, `chart`, `profile`, `ack` and
`first_seen` records in id order into a fresh Engine + AckStore reconstructs the runtime state a
restart would otherwise lose. `first_seen` keeps the earliest stamp per (patient, kind), so an
alert's escalation clock runs on across a restart instead of starting over. Replay calls the
engine/store directly, so it writes NO new audit records. Deliberately NOT replayed: the derived
`escalated` set and the `alert`, `escalation` and `notification` records (derived or transient).

Since G2-A1 (O17, D7) every replayed `ingest` and `chart` runs through the lifecycle hook the doors
run (api/alert_lifecycle.py): a closed episode's stamp and ack are pruned as they were live — so
the `first_seen` row of the next episode sets that episode's own stamp —, a critical nobody
acknowledged latches again, and an `ack` row for a latched alert removes it. The `alert_cleared`
rows follow from those and are not replayed — except one whose reason is `discharged` (G2-A11,
D7a), which retires the patient as the discharge did.

The escalation chain (X13) is not in the log: a replayed episode's clock (`clock_from`) is its own
`first_seen` row, and no chain of an episode that ended is remembered (`recent`). After a restart a
chain starts over — the same limitation as `paged` and `escalated`, which are not replayed either."""
from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime

from homunculus.api.ackstore import AckStore
from homunculus.api.alert_lifecycle import (
    DISCHARGED, acknowledge_latched, live_keys, retire_state, sync_alerts,
)
from homunculus.api.audit import AuditRecord
from homunculus.api.clinical import RETRACT, profile_from_payload
from homunculus.api.identity import bounded_role
from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine


def rehydrate(engine: Engine, store: AckStore, records: Iterable[AuditRecord], *,
              skip: frozenset[int] = frozenset()) -> None:
    # Any iterable, read once, in id order (G2-A2, D12): the API hands it `audit.iter_records`,
    # which reads the log a page at a time, so no cap can drop the newest rows.
    # G3-01 (D12): `skip` is the `chart` rows a «hatalı giriş» withdrew (`retracted_entries`, read first by
    # the API): they are not replayed, so a restart scores the patient as the live rebuild did.
    for rec in records:
        if rec.event_type == "chart" and rec.id in skip:
            continue
        if rec.event_type in ("ingest", "chart"):
            # `chart` is a clinician's observation and replays exactly like a device's. It has
            # to: a charted `suspected_infection` that a restart forgot would take the sepsis,
            # septic-shock and antibiotic-clock alerts down with it, silently, on a patient the
            # ward believes is being watched for exactly those.
            written = _written_at(rec)
            if _replay_ingest(engine, rec, written):
                # G2-A1 (D7): through the hook, as the door ran it. What it clears was audited
                # live (`alert_cleared`) and is not written again.
                sync_alerts(engine, store, rec.patient_id, written)
        elif rec.event_type == "profile":
            _replay_profile(engine, rec)
        elif rec.event_type == "ack":
            _replay_ack(engine, store, rec)
        elif rec.event_type == "first_seen":
            key = (rec.patient_id, rec.subject)
            store.first_seen.setdefault(key, datetime.fromisoformat(rec.payload["at"]))
            store.clock_from.setdefault(key, store.first_seen[key])
        elif rec.event_type == "alert_cleared" and rec.payload.get("reason") == DISCHARGED:
            # G2-A11 (D7a): a discharge retired the patient live, at this point of the log; the
            # replay retires it here. Every other `alert_cleared` row follows from the rows the
            # replay runs through the hook and stays ignored (D7 of A1).
            retire_state(engine, store, rec.patient_id)
        # alert / escalation / notification are derived or transient — nothing to replay.
    # The hook's prunes remembered the chains of the episodes the replay saw end, but nothing replayed
    # continues one (the `first_seen` rows set their stamps directly). Carried past the restart, they
    # would continue a chain from its middle: the last replayed episode's first sight as its clock.
    store.recent.clear()


def _replay_ingest(engine: Engine, rec: AuditRecord, written: datetime) -> bool:
    """Replay one observation; False when its signal is unknown and it was skipped.

    Judged where the door judged it (G2-A2, X10b): at the reading's own stamp, never past the wall
    clock (X10), with the row's write time standing for that wall clock, to within the request.
    Judged at a stamp in the future, as the replay did, every other input was aged to it — a NEWS2
    the ward saw firing came back held, and the antibiotic anchor moved to the future stamp."""
    obs = observation_of(rec)
    if obs is None:
        return False  # unknown signal slug — skip rather than fail the whole replay
    engine.ingest(obs, now=min(obs.timestamp, written))
    return True


def observation_of(rec: AuditRecord) -> Observation | None:
    """The observation an `ingest` or `chart` row recorded, or None for a signal this build does not know.
    G3-01: the replay builds it so, and so does the withdrawal for the shadow lane (X5) — one reading equals
    the other, field for field."""
    try:
        code = SignalCode(rec.subject)
    except ValueError:
        return None
    p = rec.payload
    # G2-A4 review (S1, X22): a `chart` row carries `charted_by`, never a `device` — the door stamps the
    # observation "clinician" (api/clinical.py `build_entries`), and the replay must too, or after a restart
    # every hand-charted value reads as coming from "replay" (the SOFA form prints the source).
    source = p.get("device") or ("clinician" if rec.event_type == "chart" else "replay")
    return Observation(patient_id=rec.patient_id, code=code, value=float(p["value"]),
                       unit=p.get("unit", ""), timestamp=datetime.fromisoformat(p["obs_ts"]),
                       source_device=source)


def _written_at(rec: AuditRecord) -> datetime:
    """When the row was written — the wall clock the door's hook ran at, to within the request: a
    latched alert's `resolved_at`. A row whose time cannot be read gives its observation's."""
    try:
        return datetime.fromisoformat(rec.ts)
    except (TypeError, ValueError):
        return datetime.fromisoformat(rec.payload["obs_ts"])


def _replay_profile(engine: Engine, rec: AuditRecord) -> None:
    """Restore a clinician-charted baseline/comorbidity profile.

    Losing this on restart is not a cosmetic loss: without the profile the patient-relative
    layer stops downgrading chronic-normal values, so a patient whose atrial fibrillation lives
    at 105 bpm starts alarming on every measurement again — the exact alarm fatigue the layer
    exists to prevent, arriving quietly after a deploy.
    """
    # Read over what the replay has restored so far, as the live door read it over what was
    # charted. A row that cleared the last range is an empty profile, refused when read from
    # nothing — and the range the clinician removed would come back with the next deploy.
    try:
        engine.set_profile(profile_from_payload(rec.patient_id, rec.payload,
                                                engine.profile(rec.patient_id)))
    except (ValueError, TypeError, KeyError):
        return  # a payload we cannot read must not fail the whole replay


def _replay_ack(engine: Engine, store: AckStore, rec: AuditRecord) -> None:
    """`role` is replayed as `acknowledged_by`, bounded like the live path: rows written before
    the device role was bounded may hold anything the body sent (a dict, a page of text).

    G2-A1 (D7, D8): an `ack` row for a latched alert removed it live, and removes it here — it is
    not recorded as an acknowledgement, which a later episode of the same kind would inherit. For
    the same reason a row for a kind that is neither firing nor latched at this point of the replay
    is ignored: the live door answers 404 to it, so it acknowledges nothing, and kept, it would
    answer the next episode of that kind."""
    if (rec.patient_id, rec.subject) not in live_keys(engine, store):
        return
    if acknowledge_latched(store, rec.patient_id, rec.subject) is not None:
        return
    at = datetime.fromisoformat(rec.payload["at"])
    store.acknowledge(rec.patient_id, rec.subject, bounded_role(rec.payload.get("role")), at)


#: G3-01 (D10): the kinds a patient's ENGINE state is rebuilt from — what `rehydrate` replays into the engine
#: for one patient. The ack, first-seen and clear rows are the store's, and the store is not rebuilt: an
#: alert the ward saw stays seen, and the lifecycle hook, run once after the rebuild, ends what no longer fires.
REBUILD_EVENTS = frozenset({"ingest", "chart", "profile"})


def retracted_entries(records: Iterable[AuditRecord]) -> frozenset[int]:
    """The `chart` rows a `chart_retract` row withdrew (G3-01, D12), from any rows: the others are ignored, and
    a payload whose `entry` is not an integer withdraws nothing."""
    out: set[int] = set()
    for rec in records:
        if rec.event_type != RETRACT:
            continue
        entry = rec.payload.get("entry")
        if isinstance(entry, int) and not isinstance(entry, bool):
            out.add(entry)
    return frozenset(out)


def rebuild_patient(engine: Engine, patient_id: str, records: Iterable[AuditRecord], *,
                    skip: frozenset[int]) -> None:
    """One patient's engine state from the trail, without the `chart` rows in `skip` (G3-01, D10, X4): first
    everything the engine holds for the patient is dropped (`Engine.forget`), then that patient's `ingest`,
    `chart` and `profile` rows are replayed in id order with the restart's own helpers — each reading judged
    where the door judged it. Engine only: no store and no lifecycle hook; the caller runs the hook once, at its
    own instant. Rows of another patient or kind are passed over, so the caller may hand it a wider read."""
    engine.forget(patient_id)
    for rec in records:
        if rec.patient_id != patient_id or rec.event_type not in REBUILD_EVENTS:
            continue
        if rec.event_type == "profile":
            _replay_profile(engine, rec)
        elif not (rec.event_type == "chart" and rec.id in skip):
            _replay_ingest(engine, rec, _written_at(rec))

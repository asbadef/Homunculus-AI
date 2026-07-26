# Dashboard B4.2 — State Persistence via Audit Replay Design Spec

**Date:** 2026-07-26
**Status:** approved-in-spirit (user: "continue B4 then B6"); honest sandbox constraint stated below.
**Depends on:** B4.1 immutable audit log (`api/audit.py`), the engine (`pipeline.py`), `AckStore`.

## Purpose

Today all runtime state (patient timelines, active alerts, recognition times, acknowledgements) lives
in memory and is **lost on restart**. B4.2 makes the board survive a restart by **rehydrating** each
tenant's `Engine` and `AckStore` from the audit log on startup — treating the append-only audit as the
**event log** (event sourcing). No new infrastructure: the SQLite audit from B4.1 is the source of truth.

## Honest sandbox constraint (why this, not "Postgres")

A real Postgres integration and multi-process pub-sub (LISTEN/NOTIFY) both need a Postgres/broker
**server that cannot be run or TDD-verified in this sandbox**. Writing them without a failing/passing
test would violate TDD and the no-faking rule. So B4.2 delivers the **fully-testable** persistence
piece on SQLite, with the Postgres path remaining the documented interface seam from B4.1. Real
Postgres integration, state rehydration against Postgres, and cross-worker pub-sub stay deferred until
a Postgres is available.

## Design — rehydrate by replaying audited events

The audit already records, per tenant, every `ingest` (with value, unit, obs timestamp, device, and
`subject` = signal slug) and every `ack` (role, at). Rehydration replays them in `id` order into a
fresh engine/store:

- **`ingest`** → reconstruct the canonical `Observation` (`SignalCode(subject)`, value, unit,
  `datetime.fromisoformat(payload["obs_ts"])`, device) and call `engine.ingest(obs, now=obs.timestamp)`
  — deterministic, so alerts + recognition times rebuild identically.
- **`ack`** → `store.acknowledge(patient_id, subject, payload["role"], datetime.fromisoformat(payload["at"]))`.

Replay writes **no new audit records** (it calls the engine/store directly, not the HTTP endpoints).

### What is NOT rehydrated (deliberate)

- **`first_seen`** (escalation clock) is re-stamped on the next `/ingest` or left unset — a restarted
  process should not instantly escalate on a pre-restart wall-clock. Escalation timing resets on
  restart; documented, acceptable for this slice.
- **`escalated`** set is derived by the escalation cycle; it recomputes.
- **Notifications** are transient delivery; not replayed (they would re-fire to nobody).

## Interface

```python
def rehydrate(engine: Engine, store: AckStore, records: list[AuditRecord]) -> None:
    """Replay audited ingest/ack events (id order) into a fresh engine + store. No re-auditing."""
```

Wiring: `create_app` builds each tenant's engine/store lazily today. Rehydration runs on **first
access** to a tenant's engine (or eagerly at startup for tenants already present in the audit): read
`audit.records(tenant=…, limit=large)` and `rehydrate(...)`. To keep it simple and testable, add a
per-tenant "rehydrated" guard so it runs once.

## Test plan (TDD — SQLite, deterministic)

- `rehydrate` replays a shock scenario's ingest events into a fresh engine → `active_alerts` shows
  `septic_shock` (identical to a live run).
- `rehydrate` replays an `ack` event → the store reports the alert acknowledged.
- Replay ignores non-replayable event types (`alert`, `escalation`, `notification`) without error.
- Replay writes no new audit records (append count unchanged).
- **App-level:** ingest a scenario through app A with a `SqliteAuditLog` file; build app B with the
  **same** audit file; app B's `GET /patients` shows the `septic_shock` alert (survived "restart").
- App-level: an ack made in app A is reflected as acknowledged in app B after rehydration.
- Tenant isolation: rehydrating HOSP1 never pulls HOSP2 events.

## Out of scope (later)

Real Postgres integration + its test; multi-process pub-sub (LISTEN/NOTIFY); persisting `first_seen`
so escalation timing survives restart; snapshotting for faster rehydration than full replay; audit
retention/compaction.

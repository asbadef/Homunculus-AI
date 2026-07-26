# Dashboard B4.1 — Immutable Audit Log Design Spec

**Date:** 2026-07-26
**Status:** approved (design decisions locked with the user)
**Depends on:** B1 (board + `Broadcaster`), B2 (`AckStore` + escalation), B3 (`Notifier` + `NotificationHub`), all in `api/app.py`.

## Purpose

Every clinically-meaningful event the system produces must be recorded in an **append-only,
immutable** log: what was ingested, which alerts fired, who acknowledged, what escalated, what was
notified. This is a vision + charter requirement ("immutable audit on every observation, alert, and
view") and the foundation the later B4 slices (state persistence, multi-process pub-sub) build on.

This slice delivers the audit log **only** — not state rehydration, not cross-worker pub-sub.

## Decisions locked with the user

1. **Scope:** the **immutable audit log** first (cleanest boundary, highest trust value, additive —
   does not refactor the in-memory core).
2. **Backend:** **SQLite now, Postgres via the interface seam.** SQLite is a real ACID database in
   the Python stdlib, so it is fully TDD-tested here. The `AuditLog` interface is the seam; a
   `PostgresAuditLog` implementing the same interface is the production drop-in, deferred until a
   Postgres is available. We do **not** fake one SQL string across both dialects.

## Events audited

| event_type | when | subject | payload (PHI-minimal JSON) |
|---|---|---|---|
| `ingest` | an observation is ingested | signal slug (e.g. `heart_rate`) | value, unit, obs timestamp, source device |
| `alert` | an alert is produced by the engine | alert kind | severity, urgency, summary, source (rule/model), evidence |
| `ack` | an alert is acknowledged | alert kind | role, at |
| `escalation` | an alert crosses into the escalated set | alert kind | at |
| `notification` | a notification is pushed | alert kind | audience, trigger |

`view` (a clinician opened a patient) is **deferred** — it needs a real login/session, which the
system does not have yet.

## Data model

```python
@dataclass(frozen=True)
class AuditEvent:            # what a caller appends
    tenant: str
    event_type: str         # "ingest" | "alert" | "ack" | "escalation" | "notification"
    patient_id: str
    subject: str            # alert kind or signal slug
    payload: dict           # event-specific, PHI-minimal

@dataclass(frozen=True)
class AuditRecord(AuditEvent):   # what is stored/returned — adds id + ts
    id: int
    ts: str                 # ISO-8601 UTC, stamped at append
```

## Interface (the Postgres seam)

```python
class AuditLog(Protocol):
    def append(self, event: AuditEvent) -> AuditRecord: ...
    def records(self, *, tenant: str | None = None, patient_id: str | None = None,
                event_type: str | None = None, limit: int = 200) -> list[AuditRecord]: ...
```

**No update or delete method exists** — immutability is part of the contract, not just the storage.

### `InMemoryAuditLog`

A list-backed implementation for fast unit tests of callers. Same ordering guarantees.

### `SqliteAuditLog`

- stdlib `sqlite3`, a file path (prod/dev) or `:memory:` (tests). `check_same_thread=False`.
- One table `audit` (`id INTEGER PRIMARY KEY AUTOINCREMENT`, `ts`, `tenant`, `event_type`,
  `patient_id`, `subject`, `payload` TEXT holding `json.dumps`).
- **True immutability at the DB:** `BEFORE UPDATE` and `BEFORE DELETE` triggers that
  `RAISE(ABORT, 'audit is append-only')`. A test proves an `UPDATE`/`DELETE` raises.
- `records()` filters by the given predicates, orders by `id` ascending, applies `limit`.

## Wiring in `app.py`

- `create_app(..., audit: AuditLog | None = None)`. Default `InMemoryAuditLog()` so existing tests
  and callers keep working with zero config. Expose `app.state.audit`.
- `/ingest`: `audit.append(ingest event)` for the observation; then one `alert` event per alert in
  the ingest result.
- `/ack`: `audit.append(ack event)`.
- `_escalation_cycle`: one `escalation` event per newly-escalated key.
- Notification hooks (`for_new`, `for_escalation` results): one `notification` event each.
- **`GET /audit`** — tenant-scoped, read-only: query params `patient_id?`, `event_type?`, `limit?`;
  returns the tenant's records (never another tenant's). Serves inspection + partial notification
  history.

## Charter / PHI

The audit persists to a local `.db` file holding patient_id (bed label) + PHI-minimal payloads —
the same level of detail already on the board. The DB file is **gitignored and never committed**;
synthetic data only. Nothing new leaves the machine.

## Test plan (TDD — SQLite is real, tested directly)

- `SqliteAuditLog`: append → `records()` round-trips id/ts/fields; payload JSON survives.
- **Immutability:** a raw `UPDATE`/`DELETE` on the `audit` table raises (trigger enforced).
- Filtering by `tenant`, `patient_id`, `event_type`; ordering by `id`; `limit` respected.
- `:memory:` and file-path both work; reopening a file path sees prior records.
- `InMemoryAuditLog`: same behaviours (shared contract test where practical).
- App integration: `/ingest` writes one `ingest` + N `alert` records; `/ack` writes `ack`;
  driving the escalation cycle writes `escalation`; a pushed notification writes `notification`.
- `GET /audit`: tenant-scoped; HOSP1 never sees HOSP2 records; filters apply.

## Out of scope (later B4 slices)

Real Postgres integration + its integration test; state persistence / engine rehydration on
restart; multi-process pub-sub (Postgres LISTEN/NOTIFY); `view` auditing (needs real login);
retention / archival policy; audit signing / tamper-evidence beyond append-only triggers.

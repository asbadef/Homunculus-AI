# Dashboard B4.1 — Immutable Audit Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record every clinically-meaningful event (ingest, alert, ack, escalation, notification) in an append-only, DB-enforced-immutable audit log, backed by SQLite with a Postgres-ready interface seam, and expose a tenant-scoped read endpoint.

**Architecture:** An `AuditLog` protocol with two implementations — `InMemoryAuditLog` (caller unit tests) and `SqliteAuditLog` (real stdlib `sqlite3`, `BEFORE UPDATE/DELETE` triggers for true append-only). `create_app` takes an injected `audit` (default in-memory) and appends events at `/ingest`, `/ack`, the escalation cycle, and the notification hooks; `GET /audit` reads them tenant-scoped.

**Tech Stack:** Python 3.14, stdlib `sqlite3` + `json` + `dataclasses`, FastAPI, pytest. No new dependencies.

Spec: `docs/superpowers/specs/2026-07-26-dashboard-b4-audit-log-design.md`.

---

### Task 1: `AuditEvent` / `AuditRecord` + `InMemoryAuditLog`

**Files:** Create `homunculus-engine/src/homunculus/api/audit.py`; Test `homunculus-engine/tests/test_audit_memory.py`.

- [ ] **Step 1: Failing test**

```python
# tests/test_audit_memory.py
from homunculus.api.audit import AuditEvent, InMemoryAuditLog


def _ev(tenant="HOSP1", et="alert", pid="bed-3", subject="septic_shock", **payload):
    return AuditEvent(tenant=tenant, event_type=et, patient_id=pid, subject=subject, payload=payload)


def test_append_returns_record_with_id_and_ts():
    log = InMemoryAuditLog()
    rec = log.append(_ev(severity="critical"))
    assert rec.id == 1
    assert rec.tenant == "HOSP1" and rec.event_type == "alert" and rec.subject == "septic_shock"
    assert rec.payload["severity"] == "critical"
    assert rec.ts.endswith("+00:00")


def test_ids_increment_and_records_return_in_order():
    log = InMemoryAuditLog()
    log.append(_ev(et="ingest", subject="heart_rate"))
    log.append(_ev(et="alert"))
    recs = log.records()
    assert [r.id for r in recs] == [1, 2]
    assert [r.event_type for r in recs] == ["ingest", "alert"]


def test_records_filter_by_tenant_patient_and_event_type():
    log = InMemoryAuditLog()
    log.append(_ev(tenant="HOSP1", et="ack", pid="bed-3"))
    log.append(_ev(tenant="HOSP2", et="ack", pid="bed-3"))
    log.append(_ev(tenant="HOSP1", et="alert", pid="bed-9"))
    assert [r.tenant for r in log.records(tenant="HOSP1")] == ["HOSP1", "HOSP1"]
    assert len(log.records(tenant="HOSP1", event_type="ack")) == 1
    assert len(log.records(tenant="HOSP1", patient_id="bed-9")) == 1


def test_records_respect_limit():
    log = InMemoryAuditLog()
    for _ in range(5):
        log.append(_ev())
    assert len(log.records(limit=3)) == 3
```

- [ ] **Step 2: Run — expect ModuleNotFoundError.** `homunculus-engine/.venv/Scripts/python.exe -m pytest homunculus-engine/tests/test_audit_memory.py -q`

- [ ] **Step 3: Implement**

```python
# src/homunculus/api/audit.py
"""Append-only, immutable audit log. Interface is the Postgres seam; SQLite is the tested backend.

Records every clinically-meaningful event. PHI-minimal payloads (bed label + what's on the board).
No update/delete in the contract — immutability is part of the type, and SqliteAuditLog enforces it
at the database with triggers."""
from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Protocol


@dataclass(frozen=True)
class AuditEvent:
    tenant: str
    event_type: str          # "ingest" | "alert" | "ack" | "escalation" | "notification"
    patient_id: str
    subject: str             # alert kind or signal slug
    payload: dict = field(default_factory=dict)


@dataclass(frozen=True)
class AuditRecord:
    id: int
    ts: str                  # ISO-8601 UTC
    tenant: str
    event_type: str
    patient_id: str
    subject: str
    payload: dict


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _matches(rec: AuditRecord, tenant, patient_id, event_type) -> bool:
    return ((tenant is None or rec.tenant == tenant)
            and (patient_id is None or rec.patient_id == patient_id)
            and (event_type is None or rec.event_type == event_type))


class AuditLog(Protocol):
    def append(self, event: AuditEvent) -> AuditRecord: ...
    def records(self, *, tenant: str | None = None, patient_id: str | None = None,
                event_type: str | None = None, limit: int = 200) -> list[AuditRecord]: ...


class InMemoryAuditLog:
    def __init__(self) -> None:
        self._rows: list[AuditRecord] = []

    def append(self, event: AuditEvent) -> AuditRecord:
        rec = AuditRecord(id=len(self._rows) + 1, ts=_now_iso(), tenant=event.tenant,
                          event_type=event.event_type, patient_id=event.patient_id,
                          subject=event.subject, payload=dict(event.payload))
        self._rows.append(rec)
        return rec

    def records(self, *, tenant=None, patient_id=None, event_type=None, limit=200):
        hits = [r for r in self._rows if _matches(r, tenant, patient_id, event_type)]
        return hits[:limit]
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `feat(api): audit event/record model + InMemoryAuditLog`

---

### Task 2: `SqliteAuditLog` with append-only triggers

**Files:** Modify `homunculus-engine/src/homunculus/api/audit.py`; Test `homunculus-engine/tests/test_audit_sqlite.py`.

- [ ] **Step 1: Failing test**

```python
# tests/test_audit_sqlite.py
import sqlite3
import pytest
from homunculus.api.audit import AuditEvent, SqliteAuditLog


def _ev(tenant="HOSP1", et="alert", pid="bed-3", subject="septic_shock", **payload):
    return AuditEvent(tenant=tenant, event_type=et, patient_id=pid, subject=subject, payload=payload)


def test_append_and_read_round_trips_in_memory():
    log = SqliteAuditLog(":memory:")
    rec = log.append(_ev(severity="critical", urgency="immediate"))
    assert rec.id == 1
    got = log.records(tenant="HOSP1")[0]
    assert got.subject == "septic_shock" and got.payload["urgency"] == "immediate"


def test_update_is_rejected_by_trigger():
    log = SqliteAuditLog(":memory:")
    log.append(_ev())
    with pytest.raises(sqlite3.IntegrityError):
        log.connection.execute("UPDATE audit SET tenant='X' WHERE id=1")


def test_delete_is_rejected_by_trigger():
    log = SqliteAuditLog(":memory:")
    log.append(_ev())
    with pytest.raises(sqlite3.IntegrityError):
        log.connection.execute("DELETE FROM audit WHERE id=1")


def test_filters_and_order_and_limit():
    log = SqliteAuditLog(":memory:")
    log.append(_ev(tenant="HOSP1", et="ingest", subject="heart_rate"))
    log.append(_ev(tenant="HOSP2", et="alert"))
    log.append(_ev(tenant="HOSP1", et="alert", pid="bed-9"))
    assert [r.id for r in log.records(tenant="HOSP1")] == [1, 3]     # ordered by id, tenant-scoped
    assert len(log.records(event_type="alert")) == 2
    assert len(log.records(limit=1)) == 1


def test_file_backend_persists_across_reopen(tmp_path):
    path = str(tmp_path / "audit.db")
    SqliteAuditLog(path).append(_ev())
    assert len(SqliteAuditLog(path).records()) == 1     # reopen sees prior record
```

- [ ] **Step 2: Run — expect failure (SqliteAuditLog missing).**

- [ ] **Step 3: Implement** (append to `audit.py`)

```python
class SqliteAuditLog:
    """SQLite-backed append-only audit log. Immutability is enforced by DB triggers, not convention.
    The Postgres drop-in would implement the same append/records surface (interface is the seam)."""

    def __init__(self, path: str = ":memory:") -> None:
        self.connection = sqlite3.connect(path, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        self.connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL,
                tenant TEXT NOT NULL,
                event_type TEXT NOT NULL,
                patient_id TEXT NOT NULL,
                subject TEXT NOT NULL,
                payload TEXT NOT NULL
            );
            CREATE TRIGGER IF NOT EXISTS audit_no_update
                BEFORE UPDATE ON audit
                BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
            CREATE TRIGGER IF NOT EXISTS audit_no_delete
                BEFORE DELETE ON audit
                BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
            """
        )
        self.connection.commit()

    def append(self, event: AuditEvent) -> AuditRecord:
        ts = _now_iso()
        cur = self.connection.execute(
            "INSERT INTO audit (ts, tenant, event_type, patient_id, subject, payload) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (ts, event.tenant, event.event_type, event.patient_id, event.subject,
             json.dumps(event.payload)),
        )
        self.connection.commit()
        return AuditRecord(id=cur.lastrowid, ts=ts, tenant=event.tenant,
                           event_type=event.event_type, patient_id=event.patient_id,
                           subject=event.subject, payload=dict(event.payload))

    def records(self, *, tenant=None, patient_id=None, event_type=None, limit=200):
        clauses, params = [], []
        for col, val in (("tenant", tenant), ("patient_id", patient_id), ("event_type", event_type)):
            if val is not None:
                clauses.append(f"{col} = ?")
                params.append(val)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(limit)
        rows = self.connection.execute(
            f"SELECT * FROM audit {where} ORDER BY id ASC LIMIT ?", params
        ).fetchall()
        return [AuditRecord(id=r["id"], ts=r["ts"], tenant=r["tenant"], event_type=r["event_type"],
                            patient_id=r["patient_id"], subject=r["subject"],
                            payload=json.loads(r["payload"])) for r in rows]
```

Note: SQLite raises `sqlite3.IntegrityError` for a `RAISE(ABORT)` in a trigger — the test asserts that type.

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `feat(api): SqliteAuditLog with append-only DB triggers`

---

### Task 3: Wire audit into `create_app` — `/ingest` + `/ack`

**Files:** Modify `homunculus-engine/src/homunculus/api/app.py`; Test `homunculus-engine/tests/test_api_audit.py`.

- [ ] **Step 1: Failing test**

```python
# tests/test_api_audit.py
from datetime import datetime, timezone
from fastapi.testclient import TestClient
from homunculus.api.app import create_app
from homunculus.api.audit import InMemoryAuditLog

TENANTS = {"tok": "HOSP1"}


def _fhir(code, value, patient="bed-3", when="2026-07-14T10:00:00+00:00"):
    return {"resourceType": "Observation", "code": {"coding": [{"code": code}]},
            "subject": {"reference": f"Patient/{patient}"}, "effectiveDateTime": when,
            "valueQuantity": {"value": value, "unit": ""}}


_SHOCK = [("suspected_infection", 1.0), ("weight_kg", 100), ("crystalloid_bolus_ml", 3000),
          ("map", 60), ("norepinephrine_rate", 0.12), ("lactate", 3.1)]


def test_ingest_writes_ingest_and_alert_audit_records():
    audit = InMemoryAuditLog()
    app = create_app(TENANTS, run_escalation_loop=False, audit=audit)
    client = TestClient(app)
    hdr = {"Authorization": "Bearer tok"}
    for code, val in _SHOCK:
        client.post("/ingest", json=_fhir(code, val), headers=hdr)
    ingests = audit.records(tenant="HOSP1", event_type="ingest")
    alerts = audit.records(tenant="HOSP1", event_type="alert")
    assert len(ingests) == len(_SHOCK)
    assert any(r.subject == "septic_shock" for r in alerts)


def test_ack_writes_ack_audit_record():
    audit = InMemoryAuditLog()
    app = create_app(TENANTS, run_escalation_loop=False, audit=audit)
    client = TestClient(app)
    hdr = {"Authorization": "Bearer tok"}
    for code, val in _SHOCK:
        client.post("/ingest", json=_fhir(code, val), headers=hdr)
    client.post("/ack", json={"patient_id": "bed-3", "kind": "septic_shock", "role": "doctor"}, headers=hdr)
    acks = audit.records(tenant="HOSP1", event_type="ack")
    assert len(acks) == 1 and acks[0].payload["role"] == "doctor"
```

- [ ] **Step 2: Run — expect failure (`create_app` has no `audit` param).**

- [ ] **Step 3: Implement** in `app.py`:
  - Import: `from homunculus.api.audit import AuditEvent, AuditLog, InMemoryAuditLog`.
  - Signature: add `audit: AuditLog | None = None` to `create_app(...)`. Inside: `audit = audit or InMemoryAuditLog()`. Expose `app.state.audit = audit`.
  - In `/ingest`, after `obs = parse_fhir_observation(resource)` and `alerts = engine.ingest(...)`:

```python
        audit.append(AuditEvent(hospital, "ingest", obs.patient_id, obs.code.value,
                                {"value": obs.value, "unit": obs.unit,
                                 "obs_ts": obs.timestamp.isoformat(), "device": obs.source_device}))
        for a in alerts:
            audit.append(AuditEvent(hospital, "alert", a.patient_id, a.kind,
                                    {"severity": a.severity, "urgency": a.urgency, "summary": a.summary,
                                     "source": a.source, "evidence": a.supporting_evidence}))
```

  - In `/ack`, after `store.acknowledge(...)`:

```python
        audit.append(AuditEvent(hospital, "ack", patient_id, kind,
                                {"role": role, "at": datetime.now(timezone.utc).isoformat()}))
```

- [ ] **Step 4: Run — expect PASS**; run full engine suite (`pytest homunculus-engine -q`) — no regression.
- [ ] **Step 5: Commit** `feat(api): audit /ingest observations+alerts and /ack`

---

### Task 4: Audit the escalation cycle + notifications

**Files:** Modify `homunculus-engine/src/homunculus/api/app.py`; Test `homunculus-engine/tests/test_api_audit.py` (append).

- [ ] **Step 1: Failing test**

```python
from datetime import timedelta

def test_escalation_and_notification_are_audited():
    audit = InMemoryAuditLog()
    app = create_app(TENANTS, escalate_after=timedelta(seconds=0), run_escalation_loop=False, audit=audit)
    client = TestClient(app)
    hdr = {"Authorization": "Bearer tok"}
    for code, val in _SHOCK:
        client.post("/ingest", json=_fhir(code, val), headers=hdr)
    # a new immediate alert already produced a notification on /ingest
    assert len(audit.records(tenant="HOSP1", event_type="notification")) >= 1
    # drive the escalation cycle synchronously
    import anyio
    anyio.from_thread  # noqa  (marker; the cycle is async, run it below)
    import asyncio
    asyncio.get_event_loop().run_until_complete(app.state.escalation_cycle(datetime.now(timezone.utc)))
    escs = audit.records(tenant="HOSP1", event_type="escalation")
    assert any(r.subject == "septic_shock" for r in escs)
```

Note: if `asyncio.get_event_loop().run_until_complete` is awkward under pytest, use the existing
async-test pattern instead — mark the test `@pytest.mark.anyio` with the local `anyio_backend`
fixture and `await app.state.escalation_cycle(...)`, mirroring `test_api_notifications.py`. Prefer
that pattern; the sketch above is a fallback.

Preferred form:

```python
import pytest

@pytest.fixture
def anyio_backend():
    return "asyncio"

@pytest.mark.anyio
async def test_escalation_and_notification_are_audited():
    import httpx
    from httpx import ASGITransport
    from datetime import timedelta
    audit = InMemoryAuditLog()
    app = create_app(TENANTS, escalate_after=timedelta(seconds=0), run_escalation_loop=False, audit=audit)
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        hdr = {"Authorization": "Bearer tok"}
        for code, val in _SHOCK:
            await c.post("/ingest", json=_fhir(code, val), headers=hdr)
    assert len(audit.records(tenant="HOSP1", event_type="notification")) >= 1
    await app.state.escalation_cycle(datetime.now(timezone.utc))
    assert any(r.subject == "septic_shock" for r in audit.records(event_type="escalation"))
```

- [ ] **Step 2: Run — expect failure (no escalation/notification audit yet).**

- [ ] **Step 3: Implement** in `app.py`:
  - In `/ingest`, where notifications are pushed, also audit each:

```python
        for note in notifier.for_new(hospital, engine.active_alerts(obs.patient_id)):
            await hub.publish(hospital, note)
            audit.append(AuditEvent(hospital, "notification", note.patient_id, note.kind,
                                    {"audience": note.audience, "trigger": note.trigger}))
```

  - In `_escalation_cycle`, where `added` is computed and notifications built:

```python
                if added:
                    alert_by_key = {(pid, a.kind): a for (pid, a) in alerts}
                    for key in added:
                        audit.append(AuditEvent(hospital, "escalation", key[0], key[1],
                                                {"at": now.isoformat()}))
                    for note in notifier.for_escalation(hospital, added, alert_by_key):
                        await hub.publish(hospital, note)
                        audit.append(AuditEvent(hospital, "notification", note.patient_id, note.kind,
                                                {"audience": note.audience, "trigger": note.trigger}))
```

- [ ] **Step 4: Run — expect PASS**; full engine suite — no regression.
- [ ] **Step 5: Commit** `feat(api): audit escalations and notifications`

---

### Task 5: `GET /audit` tenant-scoped read endpoint

**Files:** Modify `homunculus-engine/src/homunculus/api/app.py`; Test `homunculus-engine/tests/test_api_audit.py` (append).

- [ ] **Step 1: Failing test**

```python
def test_audit_endpoint_is_tenant_scoped_and_filterable():
    audit = InMemoryAuditLog()
    app = create_app({"tok1": "HOSP1", "tok2": "HOSP2"}, run_escalation_loop=False, audit=audit)
    client = TestClient(app)
    for code, val in _SHOCK:
        client.post("/ingest", json=_fhir(code, val), headers={"Authorization": "Bearer tok1"})
    # HOSP2 sees none of HOSP1's records
    r2 = client.get("/audit", headers={"Authorization": "Bearer tok2"})
    assert r2.status_code == 200 and r2.json()["records"] == []
    # HOSP1 sees its ingest records, filterable by event_type
    r1 = client.get("/audit?event_type=ingest", headers={"Authorization": "Bearer tok1"})
    body = r1.json()["records"]
    assert len(body) == len(_SHOCK) and all(rec["event_type"] == "ingest" for rec in body)
```

- [ ] **Step 2: Run — expect failure (404, no `/audit`).**

- [ ] **Step 3: Implement** in `app.py` (before `return app`):

```python
    from dataclasses import asdict as _asdict

    @app.get("/audit")
    def get_audit(patient_id: str | None = None, event_type: str | None = None,
                  limit: int = 200, authorization: str | None = Header(default=None)):
        hospital = _tenant(authorization)
        recs = audit.records(tenant=hospital, patient_id=patient_id,
                             event_type=event_type, limit=limit)
        return {"records": [_asdict(r) for r in recs]}
```

(`asdict` is already imported at module top as `asdict`; reuse it rather than the local alias if present — check the existing import and use the module-level `asdict`.)

- [ ] **Step 4: Run — expect PASS**; full engine suite — no regression.
- [ ] **Step 5: Commit** `feat(api): GET /audit tenant-scoped read endpoint`

---

### Task 6: Dev wiring + gitignore + guide + memory

**Files:** Modify `homunculus-engine/src/homunculus/api/devserver.py`, repo `.gitignore`, `docs/homunculus-rehber-TR.md`, memory.

- [ ] **Step 1:** Point the dev server at a SQLite audit file:

```python
# devserver.py
from homunculus.api.app import create_app
from homunculus.api.audit import SqliteAuditLog

app = create_app({"dev-token": "HOSP1"}, audit=SqliteAuditLog("homunculus-audit.db"))
```

- [ ] **Step 2:** Add to the repo root `.gitignore` (audit DBs must never be committed — they hold runtime data):

```
# runtime audit databases (synthetic data only, never committed)
*.db
*.db-journal
*.db-wal
```

- [ ] **Step 3:** Guide (`docs/homunculus-rehber-TR.md`): flip the "Denetim kaydı (audit)" roadmap row to done (SQLite slice); one-line glossary note (immutable/append-only, Postgres deferred).
- [ ] **Step 4:** Update `project-state` memory: B4.1 audit log done (SQLite + triggers + `/audit`); Postgres integration + state persistence + multi-process pub-sub still deferred.
- [ ] **Step 5:** Run the full engine suite once more (`pytest homunculus-engine -q`) — confirm green.
- [ ] **Step 6: Commit** `docs+config: audit dev wiring, gitignore *.db, guide, memory`

---

## Self-Review

**Spec coverage:** event model + PHI-minimal payload (T1); InMemoryAuditLog (T1); SqliteAuditLog + append-only triggers + immutability test (T2); filters/order/limit (T1–T2); file persistence (T2); `/ingest` ingest+alert audit (T3); `/ack` audit (T3); escalation + notification audit (T4); `GET /audit` tenant-scoped + filterable (T5); gitignore `.db` / dev wiring / guide / memory (T6). ✓

**Placeholder scan:** No TBD; every code step has complete code. Task 4's first test sketch is explicitly labelled a fallback with the preferred `@pytest.mark.anyio` form given in full immediately after — implement the preferred one. ✓

**Type consistency:** `AuditEvent(tenant, event_type, patient_id, subject, payload)` and `AuditRecord(id, ts, +same)` identical across T1/T2/T3/T4/T5; `append` returns `AuditRecord`; `records(tenant=, patient_id=, event_type=, limit=)` signature identical everywhere; `create_app(..., audit=)` + `app.state.audit` consistent T3↔T5; `SqliteAuditLog.connection` used by the immutability tests matches the attribute set in T2. ✓

**Charter:** audit DB gitignored (T6); payloads PHI-minimal (T1 model + T3/T4 call sites use bed label + board-level detail only). ✓

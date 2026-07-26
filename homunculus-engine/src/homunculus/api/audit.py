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

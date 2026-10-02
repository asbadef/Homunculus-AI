# src/homunculus/api/audit.py
"""Append-only, immutable audit log. Interface is the Postgres seam; SQLite is the tested backend.

Records every clinically-meaningful event. PHI-minimal payloads (bed label + what's on the board).
No update/delete in the contract — immutability is part of the type, and SqliteAuditLog enforces it
at the database with triggers."""
from __future__ import annotations

import hashlib
import json
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Protocol

# --- Integrity chain (G2) ------------------------------------------------------------------------
# Append-only was already enforced by database triggers, but "nobody deleted a row" and "nobody
# rewrote one" are different claims, and only the second one an inspection actually asks about.
# Triggers protect the log from the application; they do not protect it from whoever can reach the
# database directly, which on an on-prem install is the hospital's own administrator.
#
# So each record carries the hash of the one before it. Changing any field of any past record
# changes its hash, which breaks every link after it — a tamper cannot be local. Re-sealing the
# whole chain is possible for someone with write access, but it is no longer a silent one-row edit,
# and an exported chain digest taken earlier will not match.
#
# This is a tamper-EVIDENT log, not a tamper-PROOF one, and the wiki says so in those words: the
# honest claim is "any change is detectable", never "no change is possible".
GENESIS_HASH = "0" * 64


def chain_hash(prev_hash: str, *, ts: str, tenant: str, event_type: str,
               patient_id: str, subject: str, payload: dict) -> str:
    """The seal over one record and its predecessor.

    `id` is deliberately outside the hash: it is assigned by whichever database holds the log, so
    including it would make a chain unverifiable after a restore or a migration between backends.
    The ordering it would have protected is already carried by `prev_hash` itself.

    The payload is serialised with sorted keys and no incidental whitespace so that the same record
    hashes the same way in SQLite, in Postgres, and in an exported JSON file. `ensure_ascii=False`
    keeps Turkish text as itself rather than as escapes — the bytes are UTF-8 either way, but a
    reader checking the hash by hand should see what was written.
    """
    body = json.dumps([prev_hash, ts, tenant, event_type, patient_id, subject, payload],
                      sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


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
    # Defaulted so that a record read back from an older log — or from an export written before the
    # chain existed — still loads. `verify_chain` reports those as unsealed rather than as broken:
    # a row that predates the seal was never claimed to be sealed, and calling it tampered would be
    # a false accusation in the one place where accusations matter.
    prev_hash: str = ""
    hash: str = ""


@dataclass(frozen=True)
class ChainReport:
    """The answer to "has this log been altered?" — with the first break named, not just a verdict."""
    ok: bool
    checked: int             # records that carried a seal and were verified
    unsealed: int            # records written before the chain existed
    broken_at: int | None    # audit id of the first record that fails
    reason: str = ""

    def as_dict(self) -> dict:
        return {"ok": self.ok, "checked": self.checked, "unsealed": self.unsealed,
                "broken_at": self.broken_at, "reason": self.reason}


def verify_chain(records: list[AuditRecord]) -> ChainReport:
    """Recompute every seal in order and report the first one that does not match.

    Records must be the complete, ascending-by-id run for ONE tenant. A filtered slice (one patient,
    one event type) cannot be verified — its predecessors are missing by construction — and asking
    this function to judge one would manufacture a break that is not there.
    """
    prev = GENESIS_HASH
    checked = unsealed = 0
    for rec in records:
        if not rec.hash:
            unsealed += 1
            continue
        if rec.prev_hash != prev:
            return ChainReport(False, checked, unsealed, rec.id,
                               "önceki kayda bağlanmıyor — arada kayıt silinmiş olabilir")
        expected = chain_hash(prev, ts=rec.ts, tenant=rec.tenant, event_type=rec.event_type,
                              patient_id=rec.patient_id, subject=rec.subject, payload=rec.payload)
        if expected != rec.hash:
            return ChainReport(False, checked, unsealed, rec.id,
                               "kaydın içeriği mührüyle uyuşmuyor — sonradan değiştirilmiş")
        prev = rec.hash
        checked += 1
    return ChainReport(True, checked, unsealed, None)


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
        # One chain per tenant. A shared chain would mean a hospital could not verify its own log
        # without being handed another hospital's records, which is both a coupling and a leak.
        self._head: dict[str, str] = {}

    def append(self, event: AuditEvent) -> AuditRecord:
        ts = _now_iso()
        prev = self._head.get(event.tenant, GENESIS_HASH)
        payload = dict(event.payload)
        digest = chain_hash(prev, ts=ts, tenant=event.tenant, event_type=event.event_type,
                            patient_id=event.patient_id, subject=event.subject, payload=payload)
        rec = AuditRecord(id=len(self._rows) + 1, ts=ts, tenant=event.tenant,
                          event_type=event.event_type, patient_id=event.patient_id,
                          subject=event.subject, payload=payload,
                          prev_hash=prev, hash=digest)
        self._rows.append(rec)
        self._head[event.tenant] = digest
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
                payload TEXT NOT NULL,
                prev_hash TEXT NOT NULL DEFAULT '',
                hash TEXT NOT NULL DEFAULT ''
            );
            -- Two appends that race would otherwise both read the same head and fork the chain,
            -- leaving two records claiming the same predecessor and no way to tell which is the
            -- real history. The uniqueness makes a fork impossible to commit rather than something
            -- to notice afterwards; the loser retries against the new head.
            CREATE TRIGGER IF NOT EXISTS audit_no_update
                BEFORE UPDATE ON audit
                BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
            CREATE TRIGGER IF NOT EXISTS audit_no_delete
                BEFORE DELETE ON audit
                BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
            """
        )
        # A log file written before the chain existed has neither column, and CREATE TABLE IF NOT
        # EXISTS will not add them. Added here rather than in a migration because this backend is
        # a plain file with no migration runner in front of it; the rows already in it stay
        # unsealed, which `verify_chain` reports as unsealed rather than as tampered.
        have = {row[1] for row in self.connection.execute("PRAGMA table_info(audit)")}
        for column in ("prev_hash", "hash"):
            if column not in have:
                self.connection.execute(
                    f"ALTER TABLE audit ADD COLUMN {column} TEXT NOT NULL DEFAULT ''")
        # Two appends that race would otherwise both read the same head and fork the chain, leaving
        # two records claiming the same predecessor and no way to tell which is the real history.
        # The uniqueness makes a fork impossible to commit rather than something to notice
        # afterwards; the loser retries against the new head. Unsealed legacy rows are excluded,
        # or they would all collide on the empty string.
        self.connection.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS audit_chain_link "
            "ON audit (tenant, prev_hash) WHERE hash <> ''")
        self.connection.commit()

    def _head(self, tenant: str) -> str:
        row = self.connection.execute(
            "SELECT hash FROM audit WHERE tenant = ? AND hash <> '' ORDER BY id DESC LIMIT 1",
            (tenant,),
        ).fetchone()
        return row["hash"] if row is not None else GENESIS_HASH

    def append(self, event: AuditEvent) -> AuditRecord:
        payload = dict(event.payload)
        # The unique link index turns a lost race into an IntegrityError instead of a forked chain.
        # Retried against the new head; the bound is small because a genuine repeat here means
        # something other than contention is wrong, and looping forever would hide it.
        for _ in range(5):
            ts = _now_iso()
            prev = self._head(event.tenant)
            digest = chain_hash(prev, ts=ts, tenant=event.tenant, event_type=event.event_type,
                                patient_id=event.patient_id, subject=event.subject, payload=payload)
            try:
                cur = self.connection.execute(
                    "INSERT INTO audit (ts, tenant, event_type, patient_id, subject, payload,"
                    " prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (ts, event.tenant, event.event_type, event.patient_id, event.subject,
                     json.dumps(payload), prev, digest),
                )
            except sqlite3.IntegrityError:
                self.connection.rollback()
                continue
            self.connection.commit()
            return AuditRecord(id=cur.lastrowid, ts=ts, tenant=event.tenant,
                               event_type=event.event_type, patient_id=event.patient_id,
                               subject=event.subject, payload=payload,
                               prev_hash=prev, hash=digest)
        raise RuntimeError("denetim zinciri yazılamadı — eşzamanlı yazım çözülemedi")

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
                            payload=json.loads(r["payload"]),
                            prev_hash=r["prev_hash"] or "", hash=r["hash"] or "") for r in rows]

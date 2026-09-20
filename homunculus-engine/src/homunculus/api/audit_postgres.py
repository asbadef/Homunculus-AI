# src/homunculus/api/audit_postgres.py
"""Postgres-backed audit log — the durable implementation.

`SqliteAuditLog` writes to local disk, which on a serverless or container host is discarded on
every deploy. An audit that silently disappears is worse than no audit, because it still *looks*
like a record. The pilot carries real data and its trail is a legal requirement, so it goes to the
same managed Postgres as everything else.

**Append-only.** Like the SQLite implementation, there is no update or delete: immutability is part
of the contract, and the migration adds triggers that refuse both at the database.

**Synchronous on purpose.** The `AuditLog` protocol is sync and is called from inside async request
handlers, so this uses a sync driver (psycopg2) rather than pretending to be async. Each append is
one small INSERT; blocking the loop for that is acceptable at pilot volume and is far simpler than
a background queue that could lose records in a crash. If audit volume ever justifies it, the fix
is a durable queue, not a fire-and-forget one.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError

from homunculus.api.audit import GENESIS_HASH, AuditEvent, AuditRecord, chain_hash


_PG_SCHEMES = ("postgresql+asyncpg://", "postgresql+psycopg2://", "postgresql://", "postgres://")


def to_sync_url(url: str) -> str:
    """Derive the sync-driver form of whatever DATABASE_URL was configured, so a deployment sets
    one connection string rather than two that can drift apart. Non-Postgres URLs are untouched."""
    url = url.strip()
    for scheme in _PG_SCHEMES:
        if url.startswith(scheme):
            return "postgresql+psycopg2://" + url[len(scheme):]
    return url


class PostgresAuditLog:
    """Durable append-only audit. Same surface as InMemoryAuditLog / SqliteAuditLog."""

    def __init__(self, url: str, *, ssl_required: bool = False) -> None:
        connect_args = {"sslmode": "require"} if ssl_required else {}
        self._engine = create_engine(
            to_sync_url(url), pool_pre_ping=True, connect_args=connect_args, future=True
        )

    def append(self, event: AuditEvent) -> AuditRecord:
        """Seal this record to the tenant's previous one, then insert.

        The read of the head and the insert share one transaction, and the unique index on
        (tenant, prev_hash) makes a lost race fail loudly instead of forking the chain into two
        histories with the same predecessor. The loser retries against the new head.
        """
        payload = dict(event.payload)
        for _ in range(5):
            ts = datetime.now(timezone.utc).isoformat()
            try:
                with self._engine.begin() as conn:
                    head = conn.execute(
                        text("SELECT hash FROM audit WHERE tenant = :tenant AND hash <> ''"
                             " ORDER BY id DESC LIMIT 1"),
                        {"tenant": event.tenant},
                    ).scalar()
                    prev = head or GENESIS_HASH
                    digest = chain_hash(
                        prev, ts=ts, tenant=event.tenant, event_type=event.event_type,
                        patient_id=event.patient_id, subject=event.subject, payload=payload)
                    row_id = conn.execute(
                        text(
                            "INSERT INTO audit (ts, tenant, event_type, patient_id, subject,"
                            " payload, prev_hash, hash)"
                            " VALUES (:ts, :tenant, :event_type, :patient_id, :subject,"
                            " CAST(:payload AS JSONB), :prev_hash, :hash)"
                            " RETURNING id"
                        ),
                        {
                            "ts": ts, "tenant": event.tenant, "event_type": event.event_type,
                            "patient_id": event.patient_id, "subject": event.subject,
                            "payload": json.dumps(payload),
                            "prev_hash": prev, "hash": digest,
                        },
                    ).scalar_one()
            except IntegrityError:
                continue
            return AuditRecord(
                id=int(row_id), ts=ts, tenant=event.tenant, event_type=event.event_type,
                patient_id=event.patient_id, subject=event.subject, payload=payload,
                prev_hash=prev, hash=digest,
            )
        raise RuntimeError("denetim zinciri yazılamadı — eşzamanlı yazım çözülemedi")

    def records(self, *, tenant: str | None = None, patient_id: str | None = None,
                event_type: str | None = None, limit: int = 200) -> list[AuditRecord]:
        clauses, params = [], {"limit": limit}
        for column, value in (("tenant", tenant), ("patient_id", patient_id),
                              ("event_type", event_type)):
            if value is not None:
                clauses.append(f"{column} = :{column}")
                params[column] = value
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""

        with self._engine.connect() as conn:
            rows = conn.execute(
                text(f"SELECT id, ts, tenant, event_type, patient_id, subject, payload,"
                     f" prev_hash, hash FROM audit {where} ORDER BY id ASC LIMIT :limit"),
                params,
            ).mappings().all()

        return [
            AuditRecord(
                id=int(r["id"]), ts=r["ts"], tenant=r["tenant"], event_type=r["event_type"],
                patient_id=r["patient_id"], subject=r["subject"],
                payload=r["payload"] if isinstance(r["payload"], dict) else json.loads(r["payload"]),
                prev_hash=r["prev_hash"] or "", hash=r["hash"] or "",
            )
            for r in rows
        ]

    def dispose(self) -> None:
        self._engine.dispose()

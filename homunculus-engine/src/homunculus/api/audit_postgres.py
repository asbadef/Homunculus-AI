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
from collections.abc import Iterable
from datetime import datetime

from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError

from homunculus.api.audit import (
    GENESIS_HASH, AuditEvent, AuditRecord, _now_iso, _one_order, chain_hash, id_floor, kinds_of, since_utc)


_PG_SCHEMES = ("postgresql+asyncpg://", "postgresql+psycopg2://", "postgresql://", "postgres://")


def to_sync_url(url: str) -> str:
    """Derive the sync-driver form of whatever DATABASE_URL was configured, so a deployment sets
    one connection string rather than two that can drift apart. Non-Postgres URLs are untouched."""
    url = url.strip()
    for scheme in _PG_SCHEMES:
        if url.startswith(scheme):
            return "postgresql+psycopg2://" + url[len(scheme):]
    return url


# Time bounds for every sync engine the API calls on its event loop (spec 2026-11-01, D1). A
# database that accepts a connection and then says nothing — an overloaded container, a lock held
# by a migration, a half-open connection — would otherwise hold the loop, and every request of the
# API with it, until the operating system's TCP timeout: minutes in which nothing reaches the
# ward's screens. libpq applies each of these; psycopg2 passes them through.
#
# A connection not made in 3 s is not coming: the database answers a healthy start in milliseconds.
CONNECT_TIMEOUT_S = 3
# An idle pooled connection whose peer has gone is found by keepalives rather than by the next
# request: the first probe after 10 s of silence, then one every 5 s. On Linux TCP_USER_TIMEOUT
# (below) overrides the count: the connection is dropped at about idle + interval (≈15 s), after the
# first unanswered probe, and KEEPALIVES_COUNT has no effect there. Where TCP_USER_TIMEOUT does not
# exist, the count applies if the system supports it: dead after 3 unanswered.
KEEPALIVES_IDLE_S = 10
KEEPALIVES_INTERVAL_S = 5
KEEPALIVES_COUNT = 3
# Data sent and not acknowledged for 4 s drops the connection — the value Lane B's device-bed
# reader already uses — and on Linux it also decides when keepalive gives up (above). Linux only;
# libpq ignores it where the socket option does not exist.
TCP_USER_TIMEOUT_MS = 4000
# Not libpq's but the pool's (D2): a checkout waits at most 3 s for a free connection, so a pool
# held by stalled queries fails the next request instead of queueing it behind them.
POOL_TIMEOUT_S = 3
# The audit engine's statement bound (D2), the widest of the engines': each append is two
# statements (the chain's head, then the insert) on almost every request.
AUDIT_STATEMENT_TIMEOUT_MS = 10_000
# Its reads set their own, for their transaction (D2): GET /audit, /audit/verify (since G2 borç 3 the
# whole chain, AUDIT_VERIFY_PAGE records a read, each read on a worker thread through this engine's
# pool), the alarm-quality report and a restart's replay are long by nature, and a bound meant for a
# stalled server must not cut them.
AUDIT_READ_STATEMENT_TIMEOUT_MS = 30_000


def _positive_ms(ms: int) -> int:
    """A statement timeout as Postgres must be given it: a positive whole number of milliseconds.
    Postgres reads 0 as no timeout at all, which would quietly lift the bound it was meant to set."""
    if isinstance(ms, bool) or not isinstance(ms, int) or ms <= 0:
        raise ValueError(f"a statement timeout must be a positive integer of ms, not {ms!r}")
    return ms


def bounded_connect_args(*, ssl_required: bool, statement_timeout_ms: int) -> dict:
    """libpq's connection arguments for one store's engine: the bounds above, the store's own
    statement timeout, and `sslmode=require` when the deployment asks for TLS (DATABASE_SSL).

    The statement timeout is the server's to enforce, so it bounds a slow query, not a server that
    cannot run one (spec D5)."""
    statement_timeout_ms = _positive_ms(statement_timeout_ms)
    args: dict = {
        "connect_timeout": CONNECT_TIMEOUT_S,
        "options": f"-c statement_timeout={statement_timeout_ms}",
        "keepalives": 1,
        "keepalives_idle": KEEPALIVES_IDLE_S,
        "keepalives_interval": KEEPALIVES_INTERVAL_S,
        "keepalives_count": KEEPALIVES_COUNT,
        "tcp_user_timeout": TCP_USER_TIMEOUT_MS,
    }
    if ssl_required:
        args["sslmode"] = "require"
    return args


def set_local_statement_timeout(conn, ms: int) -> None:
    """This transaction's statement bound in place of the engine's, for a statement that is long by
    nature. SET LOCAL ends with the transaction, so the pooled connection goes back with the
    engine's own. SET takes no bound parameter, so the value is written in — checked first to be a
    positive integer (`_positive_ms`), and only ever a constant, never input."""
    conn.execute(text(f"SET LOCAL statement_timeout = {_positive_ms(ms)}"))


class PostgresAuditLog:
    """Durable append-only audit. Same surface as InMemoryAuditLog / SqliteAuditLog."""

    def __init__(self, url: str, *, ssl_required: bool = False) -> None:
        # Bounded (spec 2026-11-01). A timeout propagates like any database error: the request
        # fails, and the record is never skipped, retried quietly or queued — an event the trail
        # does not hold must not be answered as written (D3).
        self._engine = create_engine(
            to_sync_url(url), pool_pre_ping=True, hide_parameters=True,
            pool_timeout=POOL_TIMEOUT_S,
            connect_args=bounded_connect_args(ssl_required=ssl_required,
                                              statement_timeout_ms=AUDIT_STATEMENT_TIMEOUT_MS),
            future=True
        )

    def append(self, event: AuditEvent) -> AuditRecord:
        """Seal this record to the tenant's previous one, then insert.

        The read of the head and the insert share one transaction, and the unique index on
        (tenant, prev_hash) makes a lost race fail loudly instead of forking the chain into two
        histories with the same predecessor. The loser retries against the new head.
        """
        payload = dict(event.payload)
        for _ in range(5):
            ts = _now_iso()
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
                event_type: str | None = None, since: datetime | None = None,
                limit: int = 200, newest: bool = False,
                after_id: int | None = None,
                event_types: Iterable[str] | None = None) -> list[AuditRecord]:
        _one_order(newest, after_id)
        kinds = kinds_of(event_types)
        if kinds is not None and not kinds:
            return []                        # an empty set matches nothing; `IN ()` is not SQL
        clauses, params = [], {"limit": limit}
        for column, value in (("tenant", tenant), ("patient_id", patient_id),
                              ("event_type", event_type)):
            if value is not None:
                clauses.append(f"{column} = :{column}")
                params[column] = value
        if kinds is not None:
            # One bound parameter per kind (`:kind_0`, …), sorted: the kinds are values, never SQL.
            names = [f"kind_{n}" for n in range(len(kinds))]
            clauses.append(f"event_type IN ({', '.join(':' + name for name in names)})")
            params.update(zip(names, sorted(kinds)))
        bound = since_utc(since)
        if bound is not None:
            # `ts` is TEXT (migration 0004). Compared as text it would follow the database's
            # collation, which need not order "…:00+00:00" before "…:00.5+00:00"; cast, it is an
            # instant against an instant, whatever the collation and whatever zone the bound was in.
            clauses.append("CAST(ts AS timestamptz) >= CAST(:since AS timestamptz)")
            params["since"] = bound.isoformat()
        if after_id is not None:
            clauses.append("id > :after_id")
            params["after_id"] = after_id
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        # The newest N from the id end, handed back oldest first (G2-A2, D11): `id` is the BIGSERIAL
        # primary key (migration 0004), walked backwards — no new index, no migration.
        order = "DESC" if newest else "ASC"

        with self._engine.begin() as conn:
            set_local_statement_timeout(conn, AUDIT_READ_STATEMENT_TIMEOUT_MS)
            rows = conn.execute(
                text(f"SELECT id, ts, tenant, event_type, patient_id, subject, payload,"
                     f" prev_hash, hash FROM audit {where} ORDER BY id {order} LIMIT :limit"),
                params,
            ).mappings().all()
        if newest:
            rows = list(reversed(rows))

        return [
            AuditRecord(
                id=int(r["id"]), ts=r["ts"], tenant=r["tenant"], event_type=r["event_type"],
                patient_id=r["patient_id"], subject=r["subject"],
                payload=r["payload"] if isinstance(r["payload"], dict) else json.loads(r["payload"]),
                prev_hash=r["prev_hash"] or "", hash=r["hash"] or "",
            )
            for r in rows
        ]

    def first_id_at_or_after(self, since: datetime) -> int:
        """The id to start reading from for the rows written at or after `since` (G3-05, `id_floor`). `records(since=)`
        casts the TEXT `ts` of every row it looks at, which no index serves, so on its own it walks the primary key
        from the first row; a caller that reads a recent window (the readings `reconcile`, hourly) asks for this floor
        first and reads `after_id=floor - 1`. About thirty primary-key point reads, in one transaction, however long
        the log is."""
        since_utc(since)                                             # refused without a zone, as `records`
        with self._engine.begin() as conn:
            set_local_statement_timeout(conn, AUDIT_READ_STATEMENT_TIMEOUT_MS)
            newest = conn.execute(text("SELECT max(id) FROM audit")).scalar() or 0

            def first_from(mid: int):
                row = conn.execute(text("SELECT id, ts FROM audit WHERE id >= :mid ORDER BY id LIMIT 1"),
                                   {"mid": mid}).first()
                return None if row is None else (int(row[0]), row[1])
            return id_floor(first_from, int(newest), since)

    def dispose(self) -> None:
        self._engine.dispose()

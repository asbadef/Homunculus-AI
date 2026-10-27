"""Aşama B's monitor samples (spec D8): one row per sample the shadow engine was fed, kept
RETENTION_DAYS and then deleted. Bulk and expiring — the opposite of the audit, which is few
and for ever. Patient ids are the board's pseudonymous numbers, as in the audit; no name, no
free text. Read at start-up (the last 24 h, D9) and by nothing else in this slice (O3).

The table (`durable`) keeps RETENTION_DAYS. In memory — a lab run, or no Postgres — a store keeps
MEMORY_RETENTION_HOURS only: nothing reads a sample there but an install's replay of that window,
and 30 days of a ward in memory is a few million rows for nothing (T6 review)."""
from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Protocol

from sqlalchemy import create_engine, text

from homunculus.api.audit_postgres import to_sync_url

RETENTION_DAYS = 30
# What an install replays (infinity_rules.REPLAY_HOURS is this, D9), and so all a store in memory keeps.
MEMORY_RETENTION_HOURS = 24
# Postgres's SQLSTATE for "relation does not exist": the table of migration 0013 is not there.
UNDEFINED_TABLE = "42P01"


@dataclass(frozen=True)
class Sample:
    hospital: str
    patient_id: str
    bed_id: str
    source: str
    code: str             # SignalCode.value
    via: str              # hr | pls | spo2 | art | nbp
    value: float
    unit: str
    captured_at: datetime
    received_at: datetime


class SampleStore(Protocol):
    # True for the table: it outlives the process, keeps RETENTION_DAYS and is pruned at every stage,
    # off the loop. False in memory: MEMORY_RETENTION_HOURS, pruned on the loop (api/app.py).
    durable: bool

    def append(self, sample: Sample) -> None: ...
    # One sampling pass's rows in one write (one transaction for the table); nothing for none.
    def append_many(self, samples: Sequence[Sample]) -> None: ...
    def since(self, hospital: str, since: datetime, *, now: datetime) -> list[Sample]: ...
    def prune(self, *, before: datetime) -> int: ...


class InMemorySamples:
    """The samples in a list. Every call runs on the event loop — the lane's appends and the
    prune alike — so nothing here needs a lock."""

    durable = False

    def __init__(self) -> None:
        self._rows: list[Sample] = []

    def append(self, sample: Sample) -> None:
        self._rows.append(sample)

    def append_many(self, samples: Sequence[Sample]) -> None:
        self._rows.extend(samples)

    def since(self, hospital: str, since: datetime, *, now: datetime) -> list[Sample]:
        """Oldest first by `captured_at`, ties by insertion; nothing stamped after `now`."""
        return sorted((r for r in self._rows if r.hospital == hospital and since <= r.captured_at <= now),
                      key=lambda r: r.captured_at)

    def prune(self, *, before: datetime) -> int:
        kept = [r for r in self._rows if r.received_at >= before]
        dropped = len(self._rows) - len(kept)
        self._rows = kept
        return dropped


_INSERT = text(
    "INSERT INTO monitor_samples (hospital, patient_id, bed_id, source, code, via, value, unit,"
    " captured_at, received_at) VALUES (:hospital, :patient_id, :bed_id, :source, :code, :via,"
    " :value, :unit, :captured_at, :received_at)")


class PostgresSamples:
    """The table of migration 0013, through a sync engine like the audit's. The lane writes one
    sampling pass's rows in one transaction (`append_many`, an executemany): at pilot volume
    ≈6 rows/min/bed, a busy pass ≈50 rows — one pool pre-ping and one commit, not fifty."""

    durable = True

    def __init__(self, url: str, *, ssl_required: bool = False) -> None:
        connect_args = {"sslmode": "require"} if ssl_required else {}
        self._engine = create_engine(to_sync_url(url), pool_pre_ping=True, hide_parameters=True,
                                     connect_args=connect_args)

    def append(self, sample: Sample) -> None:
        self.append_many([sample])

    def append_many(self, samples: Sequence[Sample]) -> None:
        if not samples:
            return
        with self._engine.begin() as conn:
            conn.execute(_INSERT, [dict(sample.__dict__) for sample in samples])

    def since(self, hospital: str, since: datetime, *, now: datetime) -> list[Sample]:
        with self._engine.connect() as conn:
            rows = conn.execute(text(
                "SELECT hospital, patient_id, bed_id, source, code, via, value, unit, captured_at, received_at"
                " FROM monitor_samples WHERE hospital = :hospital AND captured_at >= :since AND captured_at <= :now"
                " ORDER BY captured_at, id"), {"hospital": hospital, "since": since, "now": now}).mappings().all()
        return [Sample(**{**dict(r), "captured_at": _utc(r["captured_at"]), "received_at": _utc(r["received_at"])})
                for r in rows]

    def prune(self, *, before: datetime) -> int:
        with self._engine.begin() as conn:
            return conn.execute(text("DELETE FROM monitor_samples WHERE received_at < :before"),
                                {"before": before}).rowcount

    def dispose(self) -> None:
        self._engine.dispose()


def _utc(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def retention_bound(now: datetime, *, durable: bool = True) -> datetime:
    """The oldest `received_at` a store keeps at `now`: RETENTION_DAYS in the table,
    MEMORY_RETENTION_HOURS in memory."""
    return now - (timedelta(days=RETENTION_DAYS) if durable else timedelta(hours=MEMORY_RETENTION_HOURS))


def is_missing_table(error: BaseException) -> bool:
    """The table is not there (migration 0013 not applied): SQLAlchemy's wrapper around a driver
    error whose SQLSTATE is UNDEFINED_TABLE (psycopg2's `pgcode`)."""
    return getattr(getattr(error, "orig", None), "pgcode", None) == UNDEFINED_TABLE

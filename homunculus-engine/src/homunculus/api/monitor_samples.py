"""Aşama B's monitor samples (spec D8): one row per sample the shadow engine was fed, kept
RETENTION_DAYS and then deleted. Bulk and expiring — the opposite of the audit, which is few
and for ever. Patient ids are the board's pseudonymous numbers, as in the audit; no name, no
free text. Read at start-up (the last 24 h, D9) and by nothing else in this slice (O3)."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Protocol

from sqlalchemy import create_engine, text

from homunculus.api.audit_postgres import to_sync_url

RETENTION_DAYS = 30


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
    def append(self, sample: Sample) -> None: ...
    def since(self, hospital: str, since: datetime, *, now: datetime) -> list[Sample]: ...
    def prune(self, *, before: datetime) -> int: ...


class InMemorySamples:
    def __init__(self) -> None:
        self._rows: list[Sample] = []

    def append(self, sample: Sample) -> None:
        self._rows.append(sample)

    def since(self, hospital: str, since: datetime, *, now: datetime) -> list[Sample]:
        """Oldest first by `captured_at`, ties by insertion; nothing stamped after `now`."""
        return sorted((r for r in self._rows if r.hospital == hospital and since <= r.captured_at <= now),
                      key=lambda r: r.captured_at)

    def prune(self, *, before: datetime) -> int:
        kept = [r for r in self._rows if r.received_at >= before]
        dropped = len(self._rows) - len(kept)
        self._rows = kept
        return dropped


class PostgresSamples:
    """The table of migration 0013, through a sync engine like the audit's (one small INSERT per
    sample at pilot volume: ≈6 rows/min/bed)."""

    def __init__(self, url: str, *, ssl_required: bool = False) -> None:
        connect_args = {"sslmode": "require"} if ssl_required else {}
        self._engine = create_engine(to_sync_url(url), pool_pre_ping=True, hide_parameters=True,
                                     connect_args=connect_args)

    def append(self, sample: Sample) -> None:
        with self._engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO monitor_samples (hospital, patient_id, bed_id, source, code, via, value, unit,"
                " captured_at, received_at) VALUES (:hospital, :patient_id, :bed_id, :source, :code, :via,"
                " :value, :unit, :captured_at, :received_at)"), sample.__dict__)

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


def retention_bound(now: datetime) -> datetime:
    return now - timedelta(days=RETENTION_DAYS)

# src/homunculus/edge/buffer.py
"""Durable store-and-forward queue for the edge bridge.

The bridge holds real observations in transit. An in-memory queue loses a whole shift's data the
moment the process restarts — which is precisely when you need it most — so the queue is SQLite on
local disk.

Two guarantees:

* **Order.** Observations are a time series. Delivering them out of order would let the engine read
  a past state as the current one, so rows come back oldest-first and are only removed once the
  uplink has confirmed them.
* **At-least-once.** A flush that dies before acking leaves its rows queued, so they are re-sent.
  Duplicates are harmless here: an observation is keyed by patient + signal + timestamp, so a
  repeat overwrites rather than accumulates. Exactly-once would need distributed transactions and
  would buy nothing.

PHI: the file holds real observations in transit. Keep it on encrypted storage, never commit it,
and delete it after the pilot.
"""
from __future__ import annotations

import json
import logging
import sqlite3
from pathlib import Path

_log = logging.getLogger(__name__)


class SqliteBuffer:
    """Append-only outbound queue with explicit acknowledgement."""

    def __init__(self, path: str | Path, max_rows: int | None = None) -> None:
        self.path = str(path)
        self.max_rows = max_rows
        self.dropped = 0
        self._conn = sqlite3.connect(self.path, check_same_thread=False)
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS outbox ("
            " id INTEGER PRIMARY KEY AUTOINCREMENT,"
            " payload TEXT NOT NULL)"
        )
        self._conn.commit()

    def append(self, payload: dict) -> int:
        cur = self._conn.execute(
            "INSERT INTO outbox (payload) VALUES (?)", (json.dumps(payload),)
        )
        self._conn.commit()
        self._enforce_cap()
        return int(cur.lastrowid)

    def pending(self, limit: int = 100) -> list[tuple[int, dict]]:
        """Oldest-first batch awaiting delivery. Rows stay queued until `ack`."""
        rows = self._conn.execute(
            "SELECT id, payload FROM outbox ORDER BY id ASC LIMIT ?", (limit,)
        ).fetchall()
        return [(int(rid), json.loads(payload)) for rid, payload in rows]

    def ack(self, ids: list[int]) -> None:
        """Delete rows the uplink has confirmed. Called only after a successful send."""
        if not ids:
            return
        placeholders = ",".join("?" * len(ids))
        self._conn.execute(f"DELETE FROM outbox WHERE id IN ({placeholders})", ids)
        self._conn.commit()

    def depth(self) -> int:
        (count,) = self._conn.execute("SELECT count(*) FROM outbox").fetchone()
        return int(count)

    def close(self) -> None:
        self._conn.close()

    def _enforce_cap(self) -> None:
        """Drop the oldest rows past the cap — loudly. Silently discarding clinical data is not
        acceptable; an operator has to be able to see that it happened."""
        if self.max_rows is None:
            return
        excess = self.depth() - self.max_rows
        if excess <= 0:
            return
        self._conn.execute(
            "DELETE FROM outbox WHERE id IN (SELECT id FROM outbox ORDER BY id ASC LIMIT ?)",
            (excess,),
        )
        self._conn.commit()
        self.dropped += excess
        _log.warning(
            "buffer cap %s exceeded: dropped %s oldest queued observation(s), %s dropped in total",
            self.max_rows, excess, self.dropped,
        )

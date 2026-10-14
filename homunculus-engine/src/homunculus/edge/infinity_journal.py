"""Encrypted, bounded durable packet outbox/archive; no patient assignments."""
from __future__ import annotations

from contextlib import contextmanager
import hashlib
import json
import sqlite3
import threading
import time
from pathlib import Path

from cryptography.fernet import Fernet

from .infinity_stream import canonical


class CapacityError(Exception):
    pass


class ConflictError(Exception):
    pass


def external_path(path):
    path = Path(path).expanduser().resolve()
    if any((parent / ".git").exists() for parent in (path.parent, *path.parents)):
        raise ValueError("Runtime data must stay outside repositories.")
    return path


class _Untimed:
    """Stands in when no one asked for timings, so the journal's code has one shape."""
    @staticmethod
    def clock():
        return 0.0

    @staticmethod
    def since(name, started):
        pass


class Journal:
    def __init__(self, path, key, *, max_bytes=128 * 1024 * 1024, max_rows=100_000,
                 retention=3600, clock=time.time, timings=None):
        if not 1024 <= max_bytes <= 4 * 1024**3 or not 1 <= max_rows <= 1_000_000 or not 60 <= retention <= 86400:
            raise ValueError("Invalid storage limits.")
        self.path = external_path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.fernet = Fernet(key)
        self.clock, self.retention = clock, retention
        self.timings = timings or _Untimed()
        self.max_bytes, self.max_rows = max_bytes, max_rows
        self.lock = threading.RLock()
        self.db = sqlite3.connect(self.path, check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=DELETE")
        self.db.execute("PRAGMA synchronous=FULL")
        # SQLite reuses freed pages; logical caps bound growth, not immediate file shrinkage.
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS events (
                seq INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, digest TEXT NOT NULL,
                created REAL NOT NULL, size INTEGER NOT NULL, body BLOB NOT NULL);
            -- Expiry and the oldest row's age read this, not the whole table. Created on the
            -- first open of an older file (one scan, once); older code keeps working with it.
            CREATE INDEX IF NOT EXISTS events_created ON events(created);
            CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value BLOB NOT NULL);
            CREATE TABLE IF NOT EXISTS stats (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS devices (
                id TEXT PRIMARY KEY, stamp REAL NOT NULL, packets INTEGER NOT NULL,
                bytes INTEGER NOT NULL, length INTEGER NOT NULL, mode TEXT NOT NULL);
        """)
        check = self.db.execute("SELECT value FROM settings WHERE name='key_check'").fetchone()
        try:
            if check:
                if self.fernet.decrypt(check[0]) != b"infinity-journal-v1":
                    raise ValueError("Wrong journal key.")
            else:
                self.db.execute("INSERT INTO settings VALUES ('key_check',?)", (self.fernet.encrypt(b"infinity-journal-v1"),))
            self.db.commit()
        except Exception:
            self.db.close()
            raise ValueError("Journal key does not match existing storage.") from None
        # Rows and encrypted bytes, counted once here and then kept in step with every
        # commit, so the capacity check no longer sums the whole table on every append.
        self.rows, self.bytes = self.db.execute("SELECT COUNT(*),COALESCE(SUM(size),0) FROM events").fetchone()
        self._delta = [0, 0]

    @contextmanager
    def _transaction(self, name=None):
        """The lock, one transaction, and where the time went: waiting, working, committing.

        Commits on success and rolls back on any exception, exactly as `with self.db:` did.
        """
        started = self.timings.clock()
        with self.lock:
            self.timings.since("lock_wait_ms", started)
            self._delta = [0, 0]
            try:
                yield
                committing = self.timings.clock()
                self.db.commit()
                self.timings.since("commit_ms", committing)
            except BaseException:
                self.db.rollback()
                raise
            # Only a committed change moves the totals; a rolled-back batch leaves them be.
            self.rows += self._delta[0]
            self.bytes += self._delta[1]
        if name:
            self.timings.since(name, started)

    def _increment(self, name, amount=1):
        self.db.execute("INSERT INTO stats VALUES (?,?) ON CONFLICT(name) DO UPDATE SET value=value+excluded.value", (name, amount))

    def count(self, name, amount=1):
        with self._transaction():
            self._increment(name, amount)

    def _removed(self, sizes):
        self._delta[0] -= len(sizes)
        self._delta[1] -= sum(size for (size,) in sizes)
        return len(sizes)

    def _expire(self):
        started = self.timings.clock()
        count = self._removed(self.db.execute("DELETE FROM events WHERE created < ? RETURNING size",
                                              (self.clock() - self.retention,)).fetchall())
        self.timings.since("expire_ms", started)
        if count:
            self._increment("expired", count)

    def append(self, events, *, update_devices=False):
        """Atomic batch: ack only after commit. Same ID with different content is an error."""
        if not events:
            return []
        with self._transaction("append_ms"):
            self._expire()
            started = self.timings.clock()
            size, rows = self.bytes + self._delta[1], self.rows + self._delta[0]
            self.timings.since("capacity_ms", started)
            started = self.timings.clock()
            for event in events:
                plain = canonical(event)
                digest = hashlib.sha256(plain).hexdigest()
                existing = self.db.execute("SELECT digest FROM events WHERE id=?", (event["id"],)).fetchone()
                if existing:
                    if existing[0] != digest:
                        raise ConflictError("Event ID reused with different content.")
                    continue
                encrypted = self.fernet.encrypt(plain)
                if size + len(encrypted) > self.max_bytes or rows + 1 > self.max_rows:
                    raise CapacityError("Journal capacity reached.")
                self.db.execute("INSERT INTO events(id,digest,created,size,body) VALUES (?,?,?,?,?)",
                                (event["id"], digest, self.clock(), len(encrypted), encrypted))
                size += len(encrypted)
                rows += 1
                self._delta[0] += 1
                self._delta[1] += len(encrypted)
                self._increment("accepted")
                if update_devices:
                    self.db.execute("""INSERT INTO devices VALUES (?,?,1,?,?,?)
                        ON CONFLICT(id) DO UPDATE SET
                        packets=packets+1,bytes=bytes+excluded.bytes,
                        length=CASE WHEN excluded.stamp>stamp THEN excluded.length ELSE length END,
                        mode=CASE WHEN excluded.stamp>stamp THEN excluded.mode ELSE mode END,
                        stamp=MAX(stamp,excluded.stamp)""",
                        (event["device_id"], event["received_at"], event["payload_bytes"], event["payload_bytes"], event["mode"]))
            self.timings.since("insert_ms", started)
        return [e["id"] for e in events]

    def pending(self, limit=32):
        with self._transaction("pending_ms"):
            self._expire()
            rows = self.db.execute("SELECT body FROM events ORDER BY seq LIMIT ?", (limit,)).fetchall()
            return [json.loads(self.fernet.decrypt(row[0])) for row in rows]

    def ack(self, ids):
        with self._transaction("ack_ms"):
            for x in ids:
                self._removed(self.db.execute("DELETE FROM events WHERE id=? RETURNING size", (x,)).fetchall())

    def snapshot(self):
        with self._transaction("snapshot_ms"):
            self._expire()
            oldest = self.db.execute("SELECT MIN(created) FROM events").fetchone()[0]
            rows, size = self.rows + self._delta[0], self.bytes + self._delta[1]
            return {"rows": rows, "encrypted_bytes": size, "oldest_age_seconds": None if oldest is None else max(0, self.clock()-oldest),
                    "counters": dict(self.db.execute("SELECT name,value FROM stats")), "retention_seconds": self.retention}

    def device_states(self):
        with self.lock:
            return {row[0]: dict(zip(("last_packet_at", "packets", "bytes", "last_payload_bytes", "mode"), row[1:]))
                    for row in self.db.execute("SELECT * FROM devices")}

    def close(self):
        with self.lock:
            self.db.close()

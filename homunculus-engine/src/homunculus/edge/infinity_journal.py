"""Encrypted, bounded durable packet outbox/archive; no patient assignments."""
from __future__ import annotations

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


class Journal:
    def __init__(self, path, key, *, max_bytes=128 * 1024 * 1024, max_rows=100_000,
                 retention=3600, clock=time.time):
        if not 1024 <= max_bytes <= 4 * 1024**3 or not 1 <= max_rows <= 1_000_000 or not 60 <= retention <= 86400:
            raise ValueError("Invalid storage limits.")
        self.path = external_path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.fernet = Fernet(key)
        self.clock, self.retention = clock, retention
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

    def _increment(self, name, amount=1):
        self.db.execute("INSERT INTO stats VALUES (?,?) ON CONFLICT(name) DO UPDATE SET value=value+excluded.value", (name, amount))

    def count(self, name, amount=1):
        with self.lock, self.db:
            self._increment(name, amount)

    def _expire(self):
        count = self.db.execute("DELETE FROM events WHERE created < ?", (self.clock() - self.retention,)).rowcount
        if count:
            self._increment("expired", count)

    def append(self, events, *, update_devices=False):
        """Atomic batch: ack only after commit. Same ID with different content is an error."""
        if not events:
            return []
        with self.lock, self.db:
            self._expire()
            size, rows = self.db.execute("SELECT COALESCE(SUM(size),0),COUNT(*) FROM events").fetchone()
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
                self._increment("accepted")
                if update_devices:
                    self.db.execute("""INSERT INTO devices VALUES (?,?,1,?,?,?)
                        ON CONFLICT(id) DO UPDATE SET
                        packets=packets+1,bytes=bytes+excluded.bytes,
                        length=CASE WHEN excluded.stamp>stamp THEN excluded.length ELSE length END,
                        mode=CASE WHEN excluded.stamp>stamp THEN excluded.mode ELSE mode END,
                        stamp=MAX(stamp,excluded.stamp)""",
                        (event["device_id"], event["received_at"], event["payload_bytes"], event["payload_bytes"], event["mode"]))
        return [e["id"] for e in events]

    def pending(self, limit=32):
        with self.lock, self.db:
            self._expire()
            rows = self.db.execute("SELECT body FROM events ORDER BY seq LIMIT ?", (limit,)).fetchall()
            return [json.loads(self.fernet.decrypt(row[0])) for row in rows]

    def ack(self, ids):
        with self.lock, self.db:
            self.db.executemany("DELETE FROM events WHERE id=?", ((x,) for x in ids))

    def snapshot(self):
        with self.lock, self.db:
            self._expire()
            rows, size, oldest = self.db.execute("SELECT COUNT(*),COALESCE(SUM(size),0),MIN(created) FROM events").fetchone()
            return {"rows": rows, "encrypted_bytes": size, "oldest_age_seconds": None if oldest is None else max(0, self.clock()-oldest),
                    "counters": dict(self.db.execute("SELECT name,value FROM stats")), "retention_seconds": self.retention}

    def device_states(self):
        with self.lock:
            return {row[0]: dict(zip(("last_packet_at", "packets", "bytes", "last_payload_bytes", "mode"), row[1:]))
                    for row in self.db.execute("SELECT * FROM devices")}

    def close(self):
        with self.lock:
            self.db.close()

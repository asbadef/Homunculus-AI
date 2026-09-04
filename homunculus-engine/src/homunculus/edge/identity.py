# src/homunculus/edge/identity.py
"""The bridge's identity mirror: protocol number -> who that is, on local disk.

Why it exists: NCE gives its patient-query host ten seconds, and the answer decides whether the
nurse sees the right patient on the device. Asking the cloud on every lookup would put that
answer behind the uplink. The mirror is fed by the same ADT messages that go upstream, so it is
never a second source of truth — only a faster copy of one.

PHI: names, dates of birth and sex are encrypted at rest with the engine's PHI helper. The
protocol number is stored in the clear because it IS the lookup key. Discharged rows are dropped
24 hours later; nothing else is kept.
"""
from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from homunculus.crypto import decrypt_phi, encrypt_phi
from homunculus.edge.adt import PatientIdentity
from homunculus.gateway.fhir import to_utc

_log = logging.getLogger(__name__)

DISCHARGED_TTL = timedelta(hours=24)


def _iso(value: datetime | None) -> str:
    """ISO-8601 in UTC, so the ordering comparison on these strings is chronological.
    A naive datetime is taken as UTC by the same convention the gateways use. `None` — an ADT
    whose MSH-7 was missing or unparseable — is stamped with the moment it arrived here, which
    means such a record wins against anything genuinely earlier."""
    return to_utc(value or datetime.now(tz=timezone.utc)).isoformat()


class IdentityMirror:
    """Upsert-by-protocol-number, newest message wins."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        # check_same_thread=False: the runner may write from a worker thread, as the buffer does.
        self._conn = sqlite3.connect(str(self.path), check_same_thread=False)
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS identity ("
            " patient_id TEXT PRIMARY KEY,"
            " family TEXT, given TEXT, birth_date TEXT, sex TEXT,"
            " unit TEXT, room TEXT, bed TEXT,"
            " state TEXT NOT NULL, at TEXT NOT NULL)"
        )
        self._conn.commit()

    def upsert(self, identity: PatientIdentity) -> bool:
        """Write the record. Returns False when an OLDER message was refused.

        The compare-and-write is a single conditional statement, not a Python-side SELECT
        followed by a write — two `IdentityMirror`s on the same file (the live bridge, plus an
        operator script) could otherwise interleave so an older write lands after a newer one."""
        stamp = _iso(identity.at)
        cur = self._conn.execute(
            "INSERT INTO identity (patient_id, family, given, birth_date, sex,"
            " unit, room, bed, state, at) VALUES (?,?,?,?,?,?,?,?,?,?)"
            " ON CONFLICT(patient_id) DO UPDATE SET family=excluded.family, given=excluded.given,"
            " birth_date=excluded.birth_date, sex=excluded.sex, unit=excluded.unit,"
            " room=excluded.room, bed=excluded.bed, state=excluded.state, at=excluded.at"
            " WHERE excluded.at >= identity.at",
            (identity.patient_id, encrypt_phi(identity.family), encrypt_phi(identity.given),
             encrypt_phi(identity.birth_date), encrypt_phi(identity.sex),
             identity.unit, identity.room, identity.bed, identity.state, stamp),
        )
        self._conn.commit()
        if cur.rowcount > 0:
            return True
        # The decision is already made and committed above — a log line must never cost us that
        # decided answer, so a failure reading it back (e.g. a second writer holding the file's
        # lock, the exact contention this atomic upsert exists to tolerate) is swallowed here.
        try:
            row = self._conn.execute(
                "SELECT at FROM identity WHERE patient_id = ?", (identity.patient_id,)).fetchone()
            stored = row[0] if row else "?"
        except sqlite3.Error:
            stored = "?"
        _log.info(
            "identity refused as older than the stored record: %s (incoming=%s stored=%s)",
            identity.patient_id, stamp, stored,
        )
        return False

    def get(self, patient_id: str) -> PatientIdentity | None:
        row = self._conn.execute(
            "SELECT patient_id, family, given, birth_date, sex, unit, room, bed, state, at"
            " FROM identity WHERE patient_id = ?", (patient_id,)).fetchone()
        if row is None:
            return None
        return PatientIdentity(
            patient_id=row[0],
            family=decrypt_phi(row[1]) or "",
            given=decrypt_phi(row[2]) or "",
            birth_date=decrypt_phi(row[3]) or "",
            sex=decrypt_phi(row[4]) or "unknown",
            unit=row[5] or "", room=row[6] or "", bed=row[7] or "",
            state=row[8], at=datetime.fromisoformat(row[9]),
        )

    def prune(self, now: datetime, ttl: timedelta = DISCHARGED_TTL) -> int:
        """Drop discharged rows older than `ttl`. Returns how many went."""
        cutoff = (to_utc(now) - ttl).isoformat()
        cur = self._conn.execute(
            "DELETE FROM identity WHERE state = 'discharged' AND at < ?", (cutoff,))
        self._conn.commit()
        return cur.rowcount

    def count(self) -> int:
        (total,) = self._conn.execute("SELECT count(*) FROM identity").fetchone()
        return int(total)

    def close(self) -> None:
        self._conn.close()

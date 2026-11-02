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
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

from homunculus.crypto import decrypt_phi, encrypt_phi
from homunculus.edge.adt import ADMITTED, PatientIdentity
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
        # G2-B1d (E8): the patient query runs on worker threads (edge/mllp.py) while the ADT
        # handler writes on the event loop, so every statement and its commit take this lock.
        self._conn = sqlite3.connect(str(self.path), check_same_thread=False)
        self._lock = threading.Lock()
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS identity ("
            " patient_id TEXT PRIMARY KEY,"
            " family TEXT, given TEXT, birth_date TEXT, sex TEXT,"
            " unit TEXT, room TEXT, bed TEXT,"
            " state TEXT NOT NULL, at TEXT NOT NULL)"
        )
        self._conn.commit()

    def _write(self, sql: str, params: object = ()) -> sqlite3.Cursor:
        """One statement and its commit, under the lock."""
        with self._lock:
            cur = self._conn.execute(sql, params)
            self._conn.commit()
            return cur

    def _read_one(self, sql: str, params: object = ()) -> tuple | None:
        """One row of one statement, under the lock."""
        with self._lock:
            return self._conn.execute(sql, params).fetchone()

    def upsert(self, identity: PatientIdentity) -> bool:
        """Write the record. Returns False when an OLDER message was refused.

        The compare-and-write is a single conditional statement, not a Python-side SELECT
        followed by a write — two `IdentityMirror`s on the same file (the live bridge, plus an
        operator script) could otherwise interleave so an older write lands after a newer one.

        What a message does not say, it does not change. An empty name on a transfer is "not
        told", never "cleared" — a thin A02 must not blank the name the nurse checks the bed
        against — and a trigger that carries no admission state (A02/A08) leaves the state as it
        was: an A08 after discharge is a billing edit, not a readmission. The name is one group
        and the location is one group (`WARD2^^` really does clear the old room and bed).
        """
        params = {
            "patient_id": identity.patient_id,
            "family": encrypt_phi(identity.family), "given": encrypt_phi(identity.given),
            "birth_date": encrypt_phi(identity.birth_date), "sex": encrypt_phi(identity.sex),
            "unit": identity.unit, "room": identity.room, "bed": identity.bed,
            "state": identity.state or ADMITTED, "at": _iso(identity.at),
            "has_state": identity.state is not None,
            "has_name": bool(identity.family or identity.given),
            "has_birth": bool(identity.birth_date),
            "has_sex": identity.sex not in ("", "unknown"),
            "has_location": bool(identity.unit or identity.room or identity.bed),
        }
        cur = self._write(
            "INSERT INTO identity (patient_id, family, given, birth_date, sex,"
            " unit, room, bed, state, at) VALUES (:patient_id, :family, :given, :birth_date,"
            " :sex, :unit, :room, :bed, :state, :at)"
            " ON CONFLICT(patient_id) DO UPDATE SET"
            " family = CASE WHEN :has_name THEN excluded.family ELSE identity.family END,"
            " given = CASE WHEN :has_name THEN excluded.given ELSE identity.given END,"
            " birth_date = CASE WHEN :has_birth THEN excluded.birth_date ELSE identity.birth_date END,"
            " sex = CASE WHEN :has_sex THEN excluded.sex ELSE identity.sex END,"
            " unit = CASE WHEN :has_location THEN excluded.unit ELSE identity.unit END,"
            " room = CASE WHEN :has_location THEN excluded.room ELSE identity.room END,"
            " bed = CASE WHEN :has_location THEN excluded.bed ELSE identity.bed END,"
            " state = CASE WHEN :has_state THEN excluded.state ELSE identity.state END,"
            " at = excluded.at"
            " WHERE excluded.at >= identity.at",
            params,
        )
        if cur.rowcount > 0:
            return True
        # Counted by the caller (adt_stale). The protocol number is an identifier and stays out
        # of the log, like every other id on this bridge.
        _log.info("identity refused as older than the stored record (counted, not written)")
        return False

    def get(self, patient_id: str) -> PatientIdentity | None:
        row = self._read_one(
            "SELECT patient_id, family, given, birth_date, sex, unit, room, bed, state, at"
            " FROM identity WHERE patient_id = ?", (patient_id,))
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

    def forget(self, patient_id: str) -> bool:
        """Drop the number's row (G2-B1d, spec §5 point 2, §8): the API answered «not found», so
        the name it had here — a discharged patient's, a mistyped neighbour's — does not stay on
        this disk. True when a row went. The number is never logged."""
        return self._write("DELETE FROM identity WHERE patient_id = ?", (patient_id,)).rowcount > 0

    def prune(self, now: datetime, ttl: timedelta = DISCHARGED_TTL) -> int:
        """Drop discharged rows older than `ttl`. Returns how many went."""
        cutoff = (to_utc(now) - ttl).isoformat()
        cur = self._write(
            "DELETE FROM identity WHERE state = 'discharged' AND at < ?", (cutoff,))
        return cur.rowcount

    def count(self) -> int:
        (total,) = self._read_one("SELECT count(*) FROM identity")
        return int(total)

    def close(self) -> None:
        with self._lock:
            self._conn.close()

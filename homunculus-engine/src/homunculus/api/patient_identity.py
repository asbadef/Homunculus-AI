# src/homunculus/api/patient_identity.py
"""Who a protocol number belongs to — the board's side of the HIS feed.

The bridge turns Comed's ADT into FHIR `Patient` and `Encounter` resources and sends them through
the same /ingest the readings use. This module accepts them, keeps one record per protocol number
per hospital, and hands the board a name and a bed.

Stores share one protocol: memory for tests, SQLite for local development, and the production
Postgres implementation in patient_identity_postgres.py. Identity is NOT rehydrated from the audit log — the audit deliberately
carries no name, so the record's durability has to live here instead.

PHI: name, date of birth and sex are encrypted at rest. The protocol number is the key and stays
in the clear. Discharged records are dropped 24 hours later.
"""
from __future__ import annotations

import logging
import sqlite3
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Protocol

from homunculus.crypto import decrypt_phi, encrypt_phi
from homunculus.gateway.fhir import GatewayError, to_utc

_log = logging.getLogger(__name__)

PROTOCOL_SYSTEM = "http://homunculus.local/protocol-no"
DISCHARGED_TTL = timedelta(hours=24)
_ADMITTED = "admitted"
_DISCHARGED = "discharged"


def plain(ciphertext: str | None, default: str = "") -> str:
    """A stored PHI column as text; `default` when it cannot be decrypted.

    A key that no longer matches the rows (rotated, or the dev fallback replaced by a real
    PHI_ENCRYPTION_KEY after the first admissions) must cost the board the NAME, never the
    board: the snapshot decrypts every identity it shows, so one unreadable row raising here
    would turn /patients into a 500 for the whole ward. The reason is logged, never the value.
    """
    try:
        return decrypt_phi(ciphertext) or default
    except ValueError:
        _log.error("kimlik alanı çözülemedi (anahtar uyuşmuyor?); boş gösteriliyor")
        return default


@dataclass(frozen=True)
class IdentityRecord:
    """One patient as the HIS describes them. Fields not yet known stay empty, never invented."""
    patient_id: str
    family: str = ""
    given: str = ""
    birth_date: str = ""
    sex: str = "unknown"
    unit: str = ""
    room: str = ""
    bed: str = ""
    state: str = _ADMITTED
    source: str = ""
    updated_at: datetime | None = None
    # Which half of the resource may replace fields (including intentionally empty ones).
    resource_type: str = ""

    @property
    def display_name(self) -> str:
        return " ".join(p for p in (self.given, self.family) if p)

    @property
    def bed_label(self) -> str:
        parts = [p for p in (self.unit, self.room, self.bed) if p]
        if not parts:
            return ""
        return parts[0] if len(parts) == 1 else f"{parts[0]} {'-'.join(parts[1:])}"

    def as_board(self) -> dict:
        return {
            "patient_id": self.patient_id,
            "display_name": self.display_name,
            "bed_label": self.bed_label,
            "state": self.state,
            "source": self.source,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


def _meta(resource: dict) -> tuple[datetime | None, str]:
    meta = resource.get("meta") or {}
    stamp = meta.get("lastUpdated") or ""
    try:
        when = datetime.fromisoformat(stamp) if stamp else None
    except (ValueError, TypeError):
        raise GatewayError("invalid identity meta.lastUpdated") from None
    return to_utc(when or datetime.now(timezone.utc)), str(meta.get("source", ""))


def parse_fhir_patient(resource: dict) -> IdentityRecord:
    """FHIR Patient -> the demographic half of a record."""
    if resource.get("resourceType") != "Patient":
        raise GatewayError(f"expected resourceType 'Patient', got {resource.get('resourceType')!r}")
    patient_id = ""
    for ident in resource.get("identifier") or []:
        value = ident.get("value")
        if ident.get("system") == PROTOCOL_SYSTEM and isinstance(value, str) and value.strip():
            patient_id = value.strip()
            break
    if not patient_id:
        raise GatewayError(f"missing protocol number (identifier with system {PROTOCOL_SYSTEM})")

    names = resource.get("name") or [{}]
    given_names = names[0].get("given") or []
    if not isinstance(given_names, list) or not all(isinstance(n, str) for n in given_names):
        raise GatewayError("invalid Patient name.given")
    given = " ".join(given_names)
    family = names[0].get("family") or ""
    birth_date = resource.get("birthDate") or ""
    sex = resource.get("gender") or "unknown"
    if not isinstance(family, str) or not isinstance(birth_date, str):
        raise GatewayError("invalid Patient demographics")
    if sex not in ("male", "female", "other", "unknown"):
        raise GatewayError("invalid Patient gender")
    if not isinstance(resource.get("active", True), bool):
        raise GatewayError("invalid Patient active flag")
    when, source = _meta(resource)
    return IdentityRecord(
        patient_id=patient_id,
        family=family,
        given=given,
        birth_date=birth_date,
        sex=sex,
        state=_ADMITTED if resource.get("active", True) else _DISCHARGED,
        source=source,
        updated_at=when,
        resource_type="Patient",
    )


def parse_fhir_encounter(resource: dict) -> IdentityRecord:
    """FHIR Encounter -> the location half of a record."""
    if resource.get("resourceType") != "Encounter":
        raise GatewayError(
            f"expected resourceType 'Encounter', got {resource.get('resourceType')!r}")
    reference = (resource.get("subject") or {}).get("reference", "")
    patient_id = reference.removeprefix("Patient/").strip() if reference.startswith("Patient/") else ""
    if not patient_id:
        raise GatewayError("missing protocol number (subject.reference)")
    if resource.get("status") not in ("in-progress", "finished"):
        raise GatewayError("unsupported identity Encounter status")

    locations = resource.get("location") or [{}]
    display = ((locations[0].get("location") or {}).get("display", ""))
    parts = (display.split("^") + ["", "", ""])[:3]
    when, source = _meta(resource)
    return IdentityRecord(
        patient_id=patient_id,
        unit=parts[0], room=parts[1], bed=parts[2],
        state=_ADMITTED if resource.get("status") == "in-progress" else _DISCHARGED,
        source=source,
        updated_at=when,
        resource_type="Encounter",
    )


def _merge(existing: IdentityRecord | None, incoming: IdentityRecord) -> IdentityRecord | None:
    """Fold `incoming` into `existing`. None means "refused: this message is older".

    A Patient carries demographics, an Encounter a location; neither erases what the other knows.
    """
    incoming = replace(incoming, updated_at=to_utc(incoming.updated_at or datetime.now(timezone.utc)))
    if existing is None:
        return incoming
    if (existing.updated_at and incoming.updated_at
            and incoming.updated_at < existing.updated_at):
        return None
    changed = {k: v for k, v in (
        ("family", incoming.family), ("given", incoming.given),
        ("birth_date", incoming.birth_date), ("unit", incoming.unit),
        ("room", incoming.room), ("bed", incoming.bed),
    ) if v}
    if incoming.sex != "unknown":
        changed["sex"] = incoming.sex
    if incoming.resource_type == "Encounter":
        # A transfer can explicitly clear a room/bed; the old location must not survive.
        changed.update(unit=incoming.unit, room=incoming.room, bed=incoming.bed)
    elif incoming.resource_type == "Patient" and incoming.state == _ADMITTED:
        changed.update(family=incoming.family, given=incoming.given,
                       birth_date=incoming.birth_date, sex=incoming.sex)
    return replace(existing, state=incoming.state, source=incoming.source or existing.source,
                   updated_at=incoming.updated_at or existing.updated_at, **changed)


class IdentityStore(Protocol):
    def apply(self, hospital: str, incoming: IdentityRecord) -> IdentityRecord | None: ...
    def get(self, hospital: str, patient_id: str) -> IdentityRecord | None: ...
    def admitted_ids(self, hospital: str) -> list[str]: ...
    def patient_ids(self, hospital: str) -> list[str]: ...
    def prune(self, now: datetime, ttl: timedelta = DISCHARGED_TTL) -> int: ...
    def close(self) -> None: ...


class InMemoryIdentityStore:
    """For tests and for a deployment that accepts losing identities on restart."""

    def __init__(self) -> None:
        self._rows: dict[tuple[str, str], IdentityRecord] = {}

    def apply(self, hospital: str, incoming: IdentityRecord) -> IdentityRecord | None:
        key = (hospital, incoming.patient_id)
        merged = _merge(self._rows.get(key), incoming)
        if merged is None:
            return None
        self._rows[key] = merged
        return merged

    def get(self, hospital: str, patient_id: str) -> IdentityRecord | None:
        return self._rows.get((hospital, patient_id))

    def admitted_ids(self, hospital: str) -> list[str]:
        return sorted(pid for (h, pid), r in self._rows.items()
                      if h == hospital and r.state == _ADMITTED)

    def patient_ids(self, hospital: str) -> list[str]:
        return sorted(pid for h, pid in self._rows if h == hospital)

    def prune(self, now: datetime, ttl: timedelta = DISCHARGED_TTL) -> int:
        cutoff = to_utc(now) - ttl
        gone = [k for k, r in self._rows.items()
                if r.state == _DISCHARGED and r.updated_at and r.updated_at < cutoff]
        for key in gone:
            del self._rows[key]
        return len(gone)

    def close(self) -> None:
        pass


class SqliteIdentityStore:
    """Durable and encrypted. Same file family as the audit database."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self._conn = sqlite3.connect(str(self.path), check_same_thread=False)
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS identity ("
            " tenant TEXT NOT NULL, patient_id TEXT NOT NULL,"
            " family TEXT, given TEXT, birth_date TEXT, sex TEXT,"
            " unit TEXT, room TEXT, bed TEXT,"
            " state TEXT NOT NULL, source TEXT, updated_at TEXT,"
            " PRIMARY KEY (tenant, patient_id))"
        )
        self._conn.commit()

    def apply(self, hospital: str, incoming: IdentityRecord) -> IdentityRecord | None:
        # Serialize read/merge/write across processes sharing this file.
        try:
            self._conn.execute("BEGIN IMMEDIATE")
            return self._apply(hospital, incoming)
        except Exception:
            self._conn.rollback()
            raise

    def _apply(self, hospital: str, incoming: IdentityRecord) -> IdentityRecord | None:
        merged = _merge(self.get(hospital, incoming.patient_id), incoming)
        if merged is None:
            self._conn.commit()
            return None
        self._conn.execute(
            "INSERT INTO identity (tenant, patient_id, family, given, birth_date, sex,"
            " unit, room, bed, state, source, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
            " ON CONFLICT(tenant, patient_id) DO UPDATE SET family=excluded.family,"
            " given=excluded.given, birth_date=excluded.birth_date, sex=excluded.sex,"
            " unit=excluded.unit, room=excluded.room, bed=excluded.bed, state=excluded.state,"
            " source=excluded.source, updated_at=excluded.updated_at",
            (hospital, merged.patient_id, encrypt_phi(merged.family), encrypt_phi(merged.given),
             encrypt_phi(merged.birth_date), encrypt_phi(merged.sex),
             merged.unit, merged.room, merged.bed, merged.state, merged.source,
             merged.updated_at.isoformat() if merged.updated_at else None),
        )
        self._conn.commit()
        return merged

    def get(self, hospital: str, patient_id: str) -> IdentityRecord | None:
        row = self._conn.execute(
            "SELECT patient_id, family, given, birth_date, sex, unit, room, bed, state, source,"
            " updated_at FROM identity WHERE tenant = ? AND patient_id = ?",
            (hospital, patient_id)).fetchone()
        if row is None:
            return None
        return IdentityRecord(
            patient_id=row[0],
            family=plain(row[1]), given=plain(row[2]),
            birth_date=plain(row[3]), sex=plain(row[4], "unknown"),
            unit=row[5] or "", room=row[6] or "", bed=row[7] or "",
            state=row[8], source=row[9] or "",
            updated_at=datetime.fromisoformat(row[10]) if row[10] else None,
        )

    def admitted_ids(self, hospital: str) -> list[str]:
        rows = self._conn.execute(
            "SELECT patient_id FROM identity WHERE tenant = ? AND state = ? ORDER BY patient_id",
            (hospital, _ADMITTED)).fetchall()
        return [r[0] for r in rows]

    def patient_ids(self, hospital: str) -> list[str]:
        return [r[0] for r in self._conn.execute(
            "SELECT patient_id FROM identity WHERE tenant = ? ORDER BY patient_id", (hospital,))]

    def prune(self, now: datetime, ttl: timedelta = DISCHARGED_TTL) -> int:
        cutoff = (to_utc(now) - ttl).isoformat()
        cur = self._conn.execute(
            "DELETE FROM identity WHERE state = ? AND updated_at IS NOT NULL AND updated_at < ?",
            (_DISCHARGED, cutoff))
        self._conn.commit()
        return cur.rowcount

    def close(self) -> None:
        self._conn.close()

# src/homunculus/api/patient_identity.py
"""Who a protocol number belongs to — the board's side of the HIS feed.

The bridge turns Comed's ADT into FHIR `Patient` and `Encounter` resources and sends them through
the same /ingest the readings use. This module accepts them, keeps one record per protocol number
per hospital, and hands the board a name and a bed.

Stores share one protocol: memory for tests, SQLite for local development, and the production
Postgres implementation in patient_identity_postgres.py. Identity is NOT rehydrated from the
audit log — the audit deliberately carries no name, so the record's durability has to live here.

PHI: name, date of birth and sex are encrypted at rest. The protocol number is the key and stays
in the clear. Discharged records are dropped 24 hours later.
"""
from __future__ import annotations

import json
import logging
import re
import sqlite3
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Protocol

from homunculus.crypto import decrypt_phi, encrypt_phi
from homunculus.gateway.fhir import GatewayError, patient_id_from, to_utc

_log = logging.getLogger(__name__)

PROTOCOL_SYSTEM = "http://homunculus.local/protocol-no"
DISCHARGED_TTL = timedelta(hours=24)
_ADMITTED = "admitted"
_DISCHARGED = "discharged"
# FHIR Encounter.status -> admission state. "unknown" is what the bridge sends for a trigger that
# says nothing about admission (a transfer, a demographics update): the state stays as it was.
_ENCOUNTER_STATUS = {"in-progress": _ADMITTED, "finished": _DISCHARGED, "unknown": None}
# Which feed a record came from ("comed" | "manuel" today). Bounded to a short token because it
# is written into the append-only audit and rendered on cards; free text here would be a channel
# for exactly the content those two places must never carry.
_SOURCE = re.compile(r"^[a-z0-9_-]{1,32}$")
_key_warned = False


def plain(ciphertext: str | None, default: str = "") -> str:
    """A stored PHI column as text; `default` when it cannot be decrypted.

    A key that no longer matches the rows (rotated, or the dev fallback replaced by a real
    PHI_ENCRYPTION_KEY after the first admissions) must cost the board the NAME, never the
    board: the snapshot decrypts every identity it shows, so one unreadable row raising here
    would turn /patients into a 500 for the whole ward. The reason is logged once per process
    (the board reads every row every few seconds), never the value.
    """
    global _key_warned
    try:
        return decrypt_phi(ciphertext) or default
    except ValueError:
        if not _key_warned:
            _key_warned = True
            _log.error("kimlik alanı çözülemedi (PHI_ENCRYPTION_KEY satırlarla uyuşmuyor?); "
                       "adlar boş gösteriliyor — bu uyarı süreç başına bir kez yazılır")
        return default


@dataclass(frozen=True)
class IdentityRecord:
    """One patient as the HIS describes them. Fields not yet known stay empty, never invented.

    `state` is None only on a freshly parsed message that said nothing about admission; a stored
    record always carries a concrete state."""
    patient_id: str
    family: str = ""
    given: str = ""
    birth_date: str = ""
    sex: str = "unknown"
    unit: str = ""
    room: str = ""
    bed: str = ""
    state: str | None = _ADMITTED
    source: str = ""
    updated_at: datetime | None = None
    # ICD-10 diagnoses the HIS sent with the admission (ADT DG1). Empty means "this message
    # carried none", never "this patient has none": a transfer says nothing about diagnosis and
    # must not blank what an admission established.
    diagnoses: tuple[dict, ...] = ()

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
            "diagnoses": [dict(d) for d in self.diagnoses],
            # Date of birth and sex travel because the admission form asks for exactly these and
            # the HIS already knows them: leaving them off means a clinician retypes what the
            # hospital sent, which is the re-entry this whole path exists to remove — and a
            # retyped date of birth is a date of birth that can be wrong. Both are encrypted at
            # rest; the board is authenticated and already carries the name.
            "birth_date": self.birth_date,
            "sex": self.sex,
        }


def _meta(resource: dict) -> tuple[datetime, str]:
    meta = resource.get("meta") or {}
    stamp = meta.get("lastUpdated") or ""
    try:
        when = datetime.fromisoformat(stamp) if stamp else None
    except (ValueError, TypeError):
        raise GatewayError("invalid identity meta.lastUpdated") from None
    source = meta.get("source", "")
    if not isinstance(source, str) or not _SOURCE.fullmatch(source):
        raise GatewayError("invalid identity meta.source")
    return to_utc(when or datetime.now(timezone.utc)), source


def parse_fhir_patient(resource: dict) -> IdentityRecord:
    """FHIR Patient -> the demographic half of a record. No `active` means "state unchanged"."""
    if resource.get("resourceType") != "Patient":
        raise GatewayError(f"expected resourceType 'Patient', got {resource.get('resourceType')!r}")
    patient_id = ""
    for ident in resource.get("identifier") or []:
        value = ident.get("value")
        if ident.get("system") == PROTOCOL_SYSTEM and isinstance(value, str) and value.strip():
            patient_id = value.strip()
            break
    patient_id = patient_id_from(   # G2-A2 (D14): the one rule /ingest keys by
        patient_id, what=f"protocol number (identifier with system {PROTOCOL_SYSTEM})")

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
    active = resource.get("active")
    if active is not None and not isinstance(active, bool):
        raise GatewayError("invalid Patient active flag")
    when, source = _meta(resource)
    return IdentityRecord(
        patient_id=patient_id,
        family=family,
        given=given,
        birth_date=birth_date,
        sex=sex,
        state=None if active is None else (_ADMITTED if active else _DISCHARGED),
        source=source,
        updated_at=when,
    )


def _reason_codes(resource: dict) -> tuple[dict, ...]:
    """Encounter.reasonCode -> the diagnoses the HIS sent, de-duplicated on the code.

    A malformed entry is skipped rather than allowed to fail the message: the patient and the
    bed matter more than the diagnosis list, and losing an admission over a bad code would be
    the worse trade. An entry with no code is dropped too — a blank chip on a clinical card
    invites someone to trust it.
    """
    out: list[dict] = []
    seen: set[str] = set()
    for reason in (resource.get("reasonCode") or []):
        try:
            coding = (reason.get("coding") or [{}])[0]
            code = str(coding.get("code") or "").strip()
            if not code or code in seen:
                continue
            seen.add(code)
            out.append({
                "code": code,
                "text": str(coding.get("display") or reason.get("text") or "").strip(),
                "system": str(coding.get("system") or "").strip(),
                "kind": str(reason.get("kind") or "").strip().upper(),
            })
        except (AttributeError, TypeError, IndexError):
            continue
    return tuple(out)


def parse_fhir_encounter(resource: dict) -> IdentityRecord:
    """FHIR Encounter -> the location half of a record. Status "unknown" means "state unchanged"."""
    if resource.get("resourceType") != "Encounter":
        raise GatewayError(
            f"expected resourceType 'Encounter', got {resource.get('resourceType')!r}")
    reference = (resource.get("subject") or {}).get("reference", "")
    patient_id = reference.removeprefix("Patient/").strip() if reference.startswith("Patient/") else ""
    patient_id = patient_id_from(   # G2-A2 (D14): the one rule /ingest keys by
        patient_id, what="protocol number (subject.reference)")
    status = resource.get("status")
    if status not in _ENCOUNTER_STATUS:
        raise GatewayError("unsupported identity Encounter status")

    locations = resource.get("location") or [{}]
    display = ((locations[0].get("location") or {}).get("display", ""))
    parts = (display.split("^") + ["", "", ""])[:3]
    when, source = _meta(resource)
    return IdentityRecord(
        patient_id=patient_id,
        unit=parts[0], room=parts[1], bed=parts[2],
        state=_ENCOUNTER_STATUS[status],
        source=source,
        updated_at=when,
        diagnoses=_reason_codes(resource),
    )


def _merge(existing: IdentityRecord | None, incoming: IdentityRecord) -> IdentityRecord | None:
    """Fold `incoming` into `existing`. None means "refused: this message is older".

    What a message does not say, it does not change. An empty name is "not told", never
    "cleared" — a thin transfer must not blank the name the nurse checks the bed against. The
    name is one group and the location is one group: `WARD2^^` really does clear the old room
    and bed. A message with no admission state (a transfer, a demographics update) leaves the
    state as it was — an A08 after discharge is a billing edit, not a readmission. Discharge
    frees the bed but keeps the name for the 24 hours the card stays on the board: a readmission
    into the same bed must not show two cards with one label.
    """
    stamp = to_utc(incoming.updated_at or datetime.now(timezone.utc))
    if existing is not None and existing.updated_at and stamp < existing.updated_at:
        return None
    base = existing or IdentityRecord(patient_id=incoming.patient_id, state=_ADMITTED)
    changed: dict = {}
    if incoming.family or incoming.given:
        changed.update(family=incoming.family, given=incoming.given)
    if incoming.birth_date:
        changed["birth_date"] = incoming.birth_date
    if incoming.sex not in ("", "unknown"):
        changed["sex"] = incoming.sex
    if incoming.unit or incoming.room or incoming.bed:
        changed.update(unit=incoming.unit, room=incoming.room, bed=incoming.bed)
    if incoming.diagnoses:
        changed["diagnoses"] = incoming.diagnoses
    state = incoming.state if incoming.state is not None else (base.state or _ADMITTED)
    if state == _DISCHARGED:
        changed.update(unit="", room="", bed="")
    return replace(base, state=state, source=incoming.source or base.source,
                   updated_at=stamp, **changed)


class IdentityStore(Protocol):
    def apply(self, hospital: str, incoming: IdentityRecord) -> IdentityRecord | None: ...
    def get(self, hospital: str, patient_id: str) -> IdentityRecord | None: ...
    def admitted_ids(self, hospital: str) -> list[str]: ...
    def patient_ids(self, hospital: str) -> list[str]: ...
    def expired(self, hospital: str, now: datetime,
                ttl: timedelta = DISCHARGED_TTL) -> list[IdentityRecord]: ...
    def prune(self, now: datetime, ttl: timedelta = DISCHARGED_TTL) -> int: ...
    def close(self) -> None: ...


def _is_expired(record: IdentityRecord, cutoff: datetime) -> bool:
    return (record.state == _DISCHARGED and record.updated_at is not None
            and record.updated_at < cutoff)


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

    def expired(self, hospital: str, now: datetime,
                ttl: timedelta = DISCHARGED_TTL) -> list[IdentityRecord]:
        cutoff = to_utc(now) - ttl
        return [r for (h, _pid), r in sorted(self._rows.items())
                if h == hospital and _is_expired(r, cutoff)]

    def prune(self, now: datetime, ttl: timedelta = DISCHARGED_TTL) -> int:
        cutoff = to_utc(now) - ttl
        gone = [k for k, r in self._rows.items() if _is_expired(r, cutoff)]
        for key in gone:
            del self._rows[key]
        return len(gone)

    def close(self) -> None:
        pass


_SELECT = ("SELECT patient_id, family, given, birth_date, sex, unit, room, bed, state, source,"
           " updated_at, diagnoses FROM identity")


def _decode_diagnoses(stored: str | None) -> tuple[dict, ...]:
    """The stored diagnosis list, or nothing.

    Unreadable rather than absent gets the same answer for the same reason `plain` gives one:
    the board decrypts every identity it shows, so a single bad row must cost that card its
    diagnoses, never the ward its board.
    """
    if not stored:
        return ()
    try:
        parsed = json.loads(plain(stored) or "[]")
    except ValueError:
        return ()
    return tuple(d for d in parsed if isinstance(d, dict)) if isinstance(parsed, list) else ()


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
            " state TEXT NOT NULL, source TEXT, updated_at TEXT, diagnoses TEXT,"
            " PRIMARY KEY (tenant, patient_id))"
        )
        # A store created before diagnoses existed keeps its rows; adding the column is the
        # whole migration. Wrapped because SQLite has no ADD COLUMN IF NOT EXISTS and a second
        # start must not fail on the column it added the first time.
        try:
            self._conn.execute("ALTER TABLE identity ADD COLUMN diagnoses TEXT")
        except sqlite3.OperationalError:
            pass
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
            " unit, room, bed, state, source, updated_at, diagnoses)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
            " ON CONFLICT(tenant, patient_id) DO UPDATE SET family=excluded.family,"
            " given=excluded.given, birth_date=excluded.birth_date, sex=excluded.sex,"
            " unit=excluded.unit, room=excluded.room, bed=excluded.bed, state=excluded.state,"
            " source=excluded.source, updated_at=excluded.updated_at,"
            " diagnoses=excluded.diagnoses",
            (hospital, merged.patient_id, encrypt_phi(merged.family), encrypt_phi(merged.given),
             encrypt_phi(merged.birth_date), encrypt_phi(merged.sex),
             merged.unit, merged.room, merged.bed, merged.state, merged.source,
             merged.updated_at.isoformat() if merged.updated_at else None,
             # A diagnosis is health data, so it is encrypted at rest like the name is.
             encrypt_phi(json.dumps([dict(d) for d in merged.diagnoses]))),
        )
        self._conn.commit()
        return merged

    @staticmethod
    def _record(row: tuple) -> IdentityRecord:
        return IdentityRecord(
            patient_id=row[0],
            family=plain(row[1]), given=plain(row[2]),
            birth_date=plain(row[3]), sex=plain(row[4], "unknown"),
            unit=row[5] or "", room=row[6] or "", bed=row[7] or "",
            state=row[8], source=row[9] or "",
            updated_at=datetime.fromisoformat(row[10]) if row[10] else None,
            diagnoses=_decode_diagnoses(row[11] if len(row) > 11 else None),
        )

    def get(self, hospital: str, patient_id: str) -> IdentityRecord | None:
        row = self._conn.execute(
            _SELECT + " WHERE tenant = ? AND patient_id = ?", (hospital, patient_id)).fetchone()
        return None if row is None else self._record(row)

    def admitted_ids(self, hospital: str) -> list[str]:
        rows = self._conn.execute(
            "SELECT patient_id FROM identity WHERE tenant = ? AND state = ? ORDER BY patient_id",
            (hospital, _ADMITTED)).fetchall()
        return [r[0] for r in rows]

    def patient_ids(self, hospital: str) -> list[str]:
        return [r[0] for r in self._conn.execute(
            "SELECT patient_id FROM identity WHERE tenant = ? ORDER BY patient_id", (hospital,))]

    def expired(self, hospital: str, now: datetime,
                ttl: timedelta = DISCHARGED_TTL) -> list[IdentityRecord]:
        cutoff = (to_utc(now) - ttl).isoformat()
        rows = self._conn.execute(
            _SELECT + " WHERE tenant = ? AND state = ? AND updated_at IS NOT NULL"
            " AND updated_at < ? ORDER BY patient_id", (hospital, _DISCHARGED, cutoff)).fetchall()
        return [self._record(r) for r in rows]

    def prune(self, now: datetime, ttl: timedelta = DISCHARGED_TTL) -> int:
        cutoff = (to_utc(now) - ttl).isoformat()
        cur = self._conn.execute(
            "DELETE FROM identity WHERE state = ? AND updated_at IS NOT NULL AND updated_at < ?",
            (_DISCHARGED, cutoff))
        self._conn.commit()
        return cur.rowcount

    def close(self) -> None:
        self._conn.close()

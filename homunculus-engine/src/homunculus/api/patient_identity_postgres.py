"""Encrypted patient identities in the managed database, independent of the audit trail."""
from __future__ import annotations

import json
from dataclasses import asdict
from datetime import datetime, timedelta

from sqlalchemy import create_engine, text

from homunculus.api.audit_postgres import to_sync_url
from homunculus.api.patient_identity import (
    DISCHARGED_TTL, IdentityRecord, _decode_diagnoses, _merge, plain,
)
from homunculus.crypto import encrypt_phi
from homunculus.gateway.fhir import to_utc

# A diagnosis is health data, so it is encrypted at rest alongside the name.
_PHI = ("family", "given", "birth_date", "sex")
_COLUMNS = ("patient_id", "family", "given", "birth_date", "sex", "unit", "room", "bed",
            "state", "source", "updated_at", "diagnoses", "bed_id", "unit_id")
# G2-B1a: what the 24-hour sweep may take — never a `kabul` tombstone (patient_identity.py).
_PRUNABLE = " AND (source IS NULL OR source <> 'kabul')"


def _decode(row) -> IdentityRecord | None:
    if row is None:
        return None
    values = {key: row[key] for key in _COLUMNS}
    for key in _PHI:
        values[key] = plain(values[key], "unknown" if key == "sex" else "")
    values["updated_at"] = datetime.fromisoformat(values["updated_at"])
    values["diagnoses"] = _decode_diagnoses(values.get("diagnoses"))
    values["bed_id"] = values["bed_id"] or ""           # NULL on a row from before 0012
    values["unit_id"] = values["unit_id"] or ""
    return IdentityRecord(**values)


class PostgresIdentityStore:
    def __init__(self, url: str, *, ssl_required: bool = False) -> None:
        self._engine = create_engine(to_sync_url(url), pool_pre_ping=True,
                                     connect_args={"sslmode": "require"} if ssl_required else {})

    def apply(self, hospital: str, incoming: IdentityRecord) -> IdentityRecord | None:
        params = {"tenant": hospital, "patient_id": incoming.patient_id}
        with self._engine.begin() as conn:
            # An empty row gives concurrent first admissions the same row lock as updates.
            conn.execute(text(
                "INSERT INTO patient_identity (tenant, patient_id) VALUES (:tenant, :patient_id)"
                " ON CONFLICT (tenant, patient_id) DO NOTHING"), params)
            row = conn.execute(text(
                "SELECT * FROM patient_identity WHERE tenant=:tenant AND patient_id=:patient_id"
                " FOR UPDATE"), params).mappings().one()
            existing = _decode(row) if row["updated_at"] else None
            merged = _merge(existing, incoming)
            if merged is None:
                return None
            values = asdict(merged)
            values["updated_at"] = merged.updated_at.isoformat()
            # asdict leaves a tuple of dicts, which no TEXT column can take. Serialised and
            # encrypted like the name: a diagnosis is health data.
            values["diagnoses"] = encrypt_phi(
                json.dumps([dict(d) for d in merged.diagnoses]))
            for key in _PHI:
                values[key] = encrypt_phi(values[key])
            values["tenant"] = hospital
            assignments = ", ".join(f"{key}=:{key}" for key in _COLUMNS if key != "patient_id")
            conn.execute(text(f"UPDATE patient_identity SET {assignments}"
                              " WHERE tenant=:tenant AND patient_id=:patient_id"), values)
            return merged

    def get(self, hospital: str, patient_id: str) -> IdentityRecord | None:
        with self._engine.connect() as conn:
            row = conn.execute(text(
                "SELECT * FROM patient_identity WHERE tenant=:tenant AND patient_id=:patient_id"),
                {"tenant": hospital, "patient_id": patient_id}).mappings().first()
        return _decode(row)

    def _ids(self, hospital: str, admitted: bool = False) -> list[str]:
        # G2-B1a: the inventory never lists a `kabul` tombstone (kept for good). NULL-safe: the
        # row `apply` locks on has no state and no source until its first write lands.
        clause = (" AND state='admitted'" if admitted else
                  " AND NOT (COALESCE(state, '')='discharged' AND COALESCE(source, '')='kabul')")
        with self._engine.connect() as conn:
            return list(conn.execute(text(
                "SELECT patient_id FROM patient_identity WHERE tenant=:tenant" + clause +
                " ORDER BY patient_id"), {"tenant": hospital}).scalars())

    def admitted_ids(self, hospital: str) -> list[str]:
        return self._ids(hospital, admitted=True)

    def patient_ids(self, hospital: str) -> list[str]:
        return self._ids(hospital)

    def expired(self, hospital: str, now: datetime,
                ttl: timedelta = DISCHARGED_TTL) -> list[IdentityRecord]:
        with self._engine.connect() as conn:
            rows = conn.execute(text(
                "SELECT * FROM patient_identity WHERE tenant=:tenant AND state='discharged'"
                " AND updated_at < :cutoff" + _PRUNABLE + " ORDER BY patient_id"),
                {"tenant": hospital, "cutoff": (to_utc(now) - ttl).isoformat()}).mappings().all()
        return [_decode(row) for row in rows]

    def prune(self, now: datetime, ttl: timedelta = DISCHARGED_TTL) -> int:
        with self._engine.begin() as conn:
            return conn.execute(text(
                "DELETE FROM patient_identity WHERE state='discharged' AND updated_at < :cutoff"
                + _PRUNABLE),
                {"cutoff": (to_utc(now) - ttl).isoformat()}).rowcount

    def close(self) -> None:
        self._engine.dispose()

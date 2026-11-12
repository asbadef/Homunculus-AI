# homunculus-engine/src/homunculus/api/readings_postgres.py
"""The readings store in the managed database (G3-05): `vital_readings` from migration 0021, and the admission a
card key belongs to from `admissions` + `patients` (api/admission_keys.py). A sync engine and `text()` SQL,
bounded like the task store, so a silent database fails the request in seconds. `add` leaves a row the table
already holds to the table: `ON CONFLICT DO NOTHING` on both unique indexes (spec D7, D14)."""
from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime, timezone

from sqlalchemy import create_engine, text

from homunculus.api.admission_keys import NEWEST_FIRST, OPEN_ADMISSION_OF_KEY, OPEN_STAYS
from homunculus.api.audit_postgres import POOL_TIMEOUT_S, bounded_connect_args, to_sync_url
from homunculus.api.readings import Reading, ReadingNotUnmatched

STATEMENT_TIMEOUT_MS = 2000
_COLUMNS = ("id, tenant, received_key, patient_key, CAST(admission_id AS text) AS admission_id, code, value, unit, "
            "observed_at, received_at, origin, source, recorded_by, state, unmatched_reason, audit_id, entry_id, "
            "resolved_at, resolved_by, resolve_reason, voided_at, voided_by, void_reason")
_SELECT = "SELECT " + _COLUMNS + " FROM vital_readings"
_CLAIMED = "state = 'assigned' AND patient_key IS NULL"
#: The open admission a card key belongs to, and every open admission's key (the fragments are shared, D8).
ADMISSION_OF = "SELECT CAST(a.id AS text) " + OPEN_ADMISSION_OF_KEY + NEWEST_FIRST
_TIMES = ("observed_at", "received_at", "resolved_at", "voided_at")


def _row(r) -> Reading:
    values = dict(r)
    for name in _TIMES:                      # timestamptz comes back in the session's zone: the rows are UTC
        if values[name] is not None:
            values[name] = values[name].astimezone(timezone.utc)
    return Reading(**values)


def _ids(ids: Iterable[int]) -> list[int]:
    return sorted({int(i) for i in ids})


class PostgresReadingStore:
    durable = True

    def __init__(self, url: str, *, ssl_required: bool = False) -> None:
        self._engine = create_engine(to_sync_url(url), pool_pre_ping=True, hide_parameters=True,
                                     pool_timeout=POOL_TIMEOUT_S,
                                     connect_args=bounded_connect_args(ssl_required=ssl_required,
                                                                       statement_timeout_ms=STATEMENT_TIMEOUT_MS))

    def add(self, row: Reading) -> Reading | None:
        with self._engine.begin() as conn:
            saved = conn.execute(text(
                "INSERT INTO vital_readings (tenant, received_key, patient_key, admission_id, code, value, unit, "
                "observed_at, received_at, origin, source, recorded_by, state, unmatched_reason, audit_id, entry_id, "
                "resolved_at, resolved_by, resolve_reason, voided_at, voided_by, void_reason) VALUES (:tenant, "
                ":received_key, :patient_key, CAST(:admission_id AS uuid), :code, :value, :unit, :observed_at, "
                ":received_at, :origin, :source, :recorded_by, :state, :unmatched_reason, :audit_id, :entry_id, "
                ":resolved_at, :resolved_by, :resolve_reason, :voided_at, :voided_by, :void_reason) "
                "ON CONFLICT DO NOTHING RETURNING " + _COLUMNS),
                {name: getattr(row, name) for name in row.__dataclass_fields__ if name != "id"}).mappings().first()
        return None if saved is None else _row(saved)

    def seen(self, tenant: str, received_key: str, code: str, observed_at: datetime, source: str,
             value: float) -> bool:
        with self._engine.connect() as conn:
            return conn.execute(text(
                "SELECT 1 FROM vital_readings WHERE origin = 'device' AND tenant = :tenant "
                "AND (received_key = :key OR patient_key = :key) "
                "AND code = :code AND observed_at = :at AND source = :source AND value = :value LIMIT 1"),
                {"tenant": tenant, "key": received_key, "code": code, "at": observed_at, "source": source,
                 "value": value}).first() is not None

    def filed_under(self, tenant: str, patient_key: str, code: str, observed_at: datetime, source: str,
                    value: float) -> bool:
        """Does the record hold this device reading UNDER the patient — `patient_key` only, never `received_key`
        (the link asks this of its target: a waiting row of the same number must not answer for itself)."""
        with self._engine.connect() as conn:
            return conn.execute(text(
                "SELECT 1 FROM vital_readings WHERE origin = 'device' AND tenant = :tenant AND patient_key = :key "
                "AND code = :code AND observed_at = :at AND source = :source AND value = :value LIMIT 1"),
                {"tenant": tenant, "key": patient_key, "code": code, "at": observed_at, "source": source,
                 "value": value}).first() is not None

    def have(self, tenant: str, audit_ids: Iterable[int]) -> set[int]:
        wanted = _ids(audit_ids)
        if not wanted:
            return set()
        with self._engine.connect() as conn:
            return {r[0] for r in conn.execute(text(
                "SELECT audit_id FROM vital_readings WHERE tenant = :tenant AND audit_id = ANY(:ids)"),
                {"tenant": tenant, "ids": wanted})}

    def get(self, tenant: str, ids: Iterable[int]) -> list[Reading]:
        wanted = _ids(ids)
        if not wanted:
            return []
        with self._engine.connect() as conn:
            rows = conn.execute(text(_SELECT + " WHERE tenant = :tenant AND id = ANY(:ids) ORDER BY id"),
                                {"tenant": tenant, "ids": wanted}).mappings().all()
        return [_row(r) for r in rows]

    def for_patient(self, tenant: str, patient_key: str, *, since: datetime, until: datetime) -> list[Reading]:
        with self._engine.connect() as conn:
            rows = conn.execute(text(_SELECT + " WHERE tenant = :tenant AND patient_key = :key AND observed_at >= :since "
                                     "AND observed_at <= :until ORDER BY observed_at, id"),
                                {"tenant": tenant, "key": patient_key, "since": since, "until": until}).mappings().all()
        return [_row(r) for r in rows]

    def unmatched(self, tenant: str, *, since: datetime, limit: int | None = None) -> list[Reading]:
        """The waiting rows, oldest arrival first. With a `limit`: the NEWEST `limit` of them (the database cuts
        the list; a flooded week is never read whole), in the same order."""
        where = " WHERE tenant = :tenant AND state = 'unmatched' AND received_at >= :since"
        if limit is None:
            query, params = where + " ORDER BY received_at, id", {"tenant": tenant, "since": since}
        else:
            query = where + " ORDER BY received_at DESC, id DESC LIMIT :limit"
            params = {"tenant": tenant, "since": since, "limit": max(int(limit), 0)}
        with self._engine.connect() as conn:
            rows = conn.execute(text(_SELECT + query), params).mappings().all()
        found = [_row(r) for r in rows]
        return found if limit is None else found[::-1]

    def claim(self, tenant: str, ids: Iterable[int], *, by: str, at: datetime) -> list[Reading]:
        """Every row or none: the update and the count are one transaction, and the raise rolls it back."""
        wanted = _ids(ids)
        if not wanted:
            raise ReadingNotUnmatched(wanted)
        with self._engine.begin() as conn:
            rows = conn.execute(text(
                "UPDATE vital_readings SET state = 'assigned', resolved_by = :by, resolved_at = :at "
                "WHERE tenant = :tenant AND id = ANY(:ids) AND state = 'unmatched' RETURNING " + _COLUMNS),
                {"tenant": tenant, "ids": wanted, "by": by, "at": at}).mappings().all()
            if len(rows) != len(wanted):
                raise ReadingNotUnmatched(wanted)
        return sorted((_row(r) for r in rows), key=lambda r: r.id)

    def claims(self, tenant: str) -> list[Reading]:
        with self._engine.connect() as conn:
            rows = conn.execute(text(_SELECT + " WHERE tenant = :tenant AND " + _CLAIMED + " ORDER BY id"),
                                {"tenant": tenant}).mappings().all()
        return [_row(r) for r in rows]

    def release(self, tenant: str, ids: Iterable[int]) -> None:
        wanted = _ids(ids)
        if not wanted:
            return
        with self._engine.begin() as conn:
            conn.execute(text("UPDATE vital_readings SET state = 'unmatched', resolved_by = NULL, resolved_at = NULL "
                              "WHERE tenant = :tenant AND id = ANY(:ids) AND " + _CLAIMED),
                         {"tenant": tenant, "ids": wanted})

    def finalize(self, tenant: str, reading_id: int, *, patient_key: str, admission_id: str | None,
                 entry_id: int) -> None:
        with self._engine.begin() as conn:
            conn.execute(text("UPDATE vital_readings SET patient_key = :key, admission_id = CAST(:admission AS uuid), "
                              "entry_id = :entry WHERE tenant = :tenant AND id = :id AND " + _CLAIMED),
                         {"tenant": tenant, "id": int(reading_id), "key": patient_key, "admission": admission_id,
                          "entry": entry_id})

    def reject(self, tenant: str, ids: Iterable[int], *, reason: str) -> None:
        wanted = _ids(ids)
        if not wanted:
            return
        with self._engine.begin() as conn:
            conn.execute(text("UPDATE vital_readings SET state = 'rejected', resolve_reason = :reason "
                              "WHERE tenant = :tenant AND id = ANY(:ids) AND " + _CLAIMED),
                         {"tenant": tenant, "ids": wanted, "reason": reason})

    def void(self, tenant: str, entry_id: int, *, by: str, at: datetime, reason: str) -> bool:
        with self._engine.begin() as conn:
            done = conn.execute(text("UPDATE vital_readings SET voided_at = :at, voided_by = :by, void_reason = :reason "
                                     "WHERE tenant = :tenant AND entry_id = :entry AND voided_at IS NULL"),
                                {"tenant": tenant, "entry": int(entry_id), "by": by, "at": at, "reason": reason})
        return done.rowcount > 0

    def admission_of(self, tenant: str, key: str) -> str | None:
        with self._engine.connect() as conn:
            return conn.execute(text(ADMISSION_OF), {"tenant": tenant, "key": key}).scalar_one_or_none()

    def open_stays(self, tenant: str) -> dict[str, datetime]:
        with self._engine.connect() as conn:
            return {r[0]: r[1].astimezone(timezone.utc) for r in conn.execute(text(OPEN_STAYS), {"tenant": tenant})}

    def close(self) -> None:
        self._engine.dispose()

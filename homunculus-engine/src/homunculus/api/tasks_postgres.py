# homunculus-engine/src/homunculus/api/tasks_postgres.py
"""The task store in the managed database (G3-02): `tasks` and `task_settings` from migration 0017,
the tenant's time zone from `tenants`, the admission time of a board key from `admissions` +
`patients`. A sync engine and `text()` SQL, bounded like the identity store, so a silent database
fails the request in seconds. `title` and `skip_reason` are Fernet ciphertext at rest."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import create_engine, text

from homunculus.api.audit_postgres import POOL_TIMEOUT_S, bounded_connect_args, to_sync_url
from homunculus.api.tasks import BAND_KEYS, TaskNotOpen, TaskRow, TaskSettings
from homunculus.crypto import decrypt_phi, encrypt_phi

STATEMENT_TIMEOUT_MS = 2000
_COLUMNS = ("id", "tenant", "patient_id", "title", "due_at", "target_role", "created_by", "created_at", "state",
            "claimed_by", "claimed_at", "closed_by", "closed_at", "skip_reason")
_SELECT = "SELECT " + ", ".join(_COLUMNS) + " FROM tasks"
#: admission/models.py OPEN_ADMISSION_STATES, as the enum's values
_OPEN_STATES = "('DRAFT','ACTIVE','PENDING_DISCHARGE','PENDING_TRANSFER')"
#: G2-B1b (X18): how far `admitted_at` follows one stay's moves back — admission/transfer.py's
#: `_MOST_MOVES` (where_now's forward bound), kept here so the api's store imports nothing of the
#: admission routes. A chain written wrong by hand ends here instead of looping.
_MOST_MOVES = 64


def _uuid(task_id) -> str | None:
    """The id in its canonical spelling, or None when it is not a UUID — never a cast error in Postgres."""
    try:
        return str(uuid.UUID(task_id))
    except (ValueError, TypeError, AttributeError):
        return None


def _row(r) -> TaskRow:
    values = dict(r)
    values["title"] = decrypt_phi(values["title"]) or ""
    values["skip_reason"] = decrypt_phi(values["skip_reason"]) if values["skip_reason"] else None
    values["id"] = str(values["id"])
    return TaskRow(**values)


def _settings(r) -> TaskSettings:
    return TaskSettings(shift_start_a=r["shift_start_a"], shift_start_b=r["shift_start_b"], grace_min=r["grace_min"],
                        intervals={k: r[f"interval_{k}"] for k in BAND_KEYS},
                        updated_at=r["updated_at"], updated_by=r["updated_by"])


class PostgresTaskStore:
    def __init__(self, url: str, *, ssl_required: bool = False) -> None:
        self._engine = create_engine(to_sync_url(url), pool_pre_ping=True, hide_parameters=True,
                                     pool_timeout=POOL_TIMEOUT_S,
                                     connect_args=bounded_connect_args(ssl_required=ssl_required,
                                                                       statement_timeout_ms=STATEMENT_TIMEOUT_MS))

    def create(self, row: TaskRow) -> TaskRow:
        with self._engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO tasks (id, tenant, patient_id, title, due_at, target_role, created_by, created_at, state) "
                "VALUES (CAST(:id AS uuid), :tenant, :patient_id, :title, :due_at, :target_role, :created_by, :created_at, :state)"),
                {"id": row.id, "tenant": row.tenant, "patient_id": row.patient_id, "title": encrypt_phi(row.title),
                 "due_at": row.due_at, "target_role": row.target_role, "created_by": row.created_by,
                 "created_at": row.created_at, "state": row.state})
        return row

    def get(self, tenant: str, task_id: str) -> TaskRow | None:
        key = _uuid(task_id)
        if key is None:
            return None
        with self._engine.connect() as conn:
            r = conn.execute(text(_SELECT + " WHERE tenant = :tenant AND id = CAST(:id AS uuid)"),
                             {"tenant": tenant, "id": key}).mappings().first()
        return None if r is None else _row(r)

    def list(self, tenant: str, *, since: datetime, until: datetime, patient_ids: set[str]) -> list[TaskRow]:
        if not patient_ids:
            return []
        with self._engine.connect() as conn:
            rows = conn.execute(text(_SELECT + " WHERE tenant = :tenant AND due_at >= :since AND due_at < :until "
                                     "AND patient_id = ANY(:ids) ORDER BY due_at, created_at, id"),
                                {"tenant": tenant, "since": since, "until": until, "ids": sorted(patient_ids)}).mappings().all()
        return [_row(r) for r in rows]

    def update(self, row: TaskRow) -> TaskRow:
        """Open rows only (`AND state = 'open'`): of two closes that read the row open, the second
        changes nothing and raises TaskNotOpen; KeyError when the tenant has no such task."""
        key = _uuid(row.id)
        if key is None:
            raise KeyError(row.id)
        with self._engine.begin() as conn:
            done = conn.execute(text(
                "UPDATE tasks SET state = :state, claimed_by = :claimed_by, claimed_at = :claimed_at, closed_by = :closed_by, "
                "closed_at = :closed_at, skip_reason = :skip_reason "
                "WHERE tenant = :tenant AND id = CAST(:id AS uuid) AND state = 'open'"),
                {"state": row.state, "claimed_by": row.claimed_by, "claimed_at": row.claimed_at, "closed_by": row.closed_by,
                 "closed_at": row.closed_at, "skip_reason": encrypt_phi(row.skip_reason) if row.skip_reason else None,
                 "tenant": row.tenant, "id": key})
            if done.rowcount == 0:
                found = conn.execute(text("SELECT 1 FROM tasks WHERE tenant = :tenant AND id = CAST(:id AS uuid)"),
                                     {"tenant": row.tenant, "id": key}).first()
                raise TaskNotOpen(row.id) if found is not None else KeyError(row.id)
        return row

    def settings(self, tenant: str) -> TaskSettings | None:
        with self._engine.connect() as conn:
            r = conn.execute(text("SELECT * FROM task_settings WHERE tenant = :tenant"), {"tenant": tenant}).mappings().first()
        return None if r is None else _settings(r)

    def save_settings(self, tenant: str, settings: TaskSettings, *, by: str, now: datetime) -> TaskSettings:
        params = {"tenant": tenant, "a": settings.shift_start_a, "b": settings.shift_start_b, "grace": settings.grace_min,
                  "by": by, "now": now, **{f"i_{k}": settings.intervals.get(k) for k in BAND_KEYS}}
        sets = ", ".join(f"interval_{k} = :i_{k}" for k in BAND_KEYS)
        with self._engine.begin() as conn:
            conn.execute(text("INSERT INTO task_settings (tenant) VALUES (:tenant) ON CONFLICT (tenant) DO NOTHING"),
                         {"tenant": tenant})
            conn.execute(text(f"UPDATE task_settings SET shift_start_a = :a, shift_start_b = :b, grace_min = :grace, {sets}, "
                              "updated_at = :now, updated_by = :by WHERE tenant = :tenant"), params)
        saved = self.settings(tenant)
        assert saved is not None
        return saved

    def admitted_at(self, tenant: str, patient_id: str) -> datetime | None:
        """When the stay of the patient under this board key began (G3-02 D2: "the admission's
        `admitted_at` (kabul)"): her open admission's time — or, when a move opened that row
        (G2-B1b: a transfer closes the row and opens another at the move's time, spec T6), the
        stay's first row's, reached through `source_admission_id` (the owner, 2026-11-10; X18).
        One statement: the open row as before, then the walk back, at most `_MOST_MOVES` steps,
        inside the tenant."""
        with self._engine.connect() as conn:
            return conn.execute(text(
                "WITH RECURSIVE open_row AS ("
                "SELECT a.id FROM admissions a JOIN patients p ON p.id = a.patient_id "
                "JOIN tenants t ON t.id = a.tenant_id WHERE t.slug = :tenant AND CAST(a.state AS text) IN " + _OPEN_STATES +
                " AND (a.protocol_no = :key OR (a.protocol_no IS NULL AND p.patient_number = :key)) "
                "ORDER BY a.admission_datetime DESC LIMIT 1), "
                "stay AS (SELECT a.tenant_id, a.source_admission_id, a.admission_datetime, 0 AS depth "
                "FROM admissions a JOIN open_row o ON o.id = a.id "
                "UNION ALL SELECT s.tenant_id, s.source_admission_id, s.admission_datetime, stay.depth + 1 "
                "FROM admissions s JOIN stay ON s.id = stay.source_admission_id AND s.tenant_id = stay.tenant_id "
                "WHERE stay.depth < :most) "
                "SELECT admission_datetime FROM stay ORDER BY depth DESC LIMIT 1"),
                {"tenant": tenant, "key": patient_id, "most": _MOST_MOVES}).scalar_one_or_none()

    def timezone(self, tenant: str) -> str:
        with self._engine.connect() as conn:
            zone = conn.execute(text("SELECT timezone FROM tenants WHERE slug = :tenant"), {"tenant": tenant}).scalar_one_or_none()
        return zone or "UTC"

    def close(self) -> None:
        self._engine.dispose()

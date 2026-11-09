# homunculus-engine/src/homunculus/api/tasks.py
"""Görevlerim (G3-02): the ward's task queue.

Two sources, one model (spec D1). A HAND task is a row a clinician wrote (the store below). The
VITAL task is never stored (D2): it is derived at read time from the patient's most recent hand
entry of a NEWS2 input (the `chart` rows G3-01 writes, minus the withdrawn ones), the band of the
board card's NEWS2 total (D3) and the interval the hospital set for that band (D10). The only
interval the vault supports is NEWS2 score 0 → «minimum 12-hourly observations» (news2-rcp-2017,
an extract); every other band is NULL until the administrator enters the hospital's protocol, and
a NULL band produces no task. Homunculus does not decide how often a patient is observed.

This file: the pure schedule functions, the dataclasses, the store protocol with its in-memory
version, and the factory router bound to the app's caller resolver, scoped board and audit log
(`edge_query_router`'s pattern). The Postgres store is `api/tasks_postgres.py`."""
from __future__ import annotations

import logging
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta, timezone
from typing import Protocol
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Body, Header, HTTPException, Query

from homunculus.api.audit import AuditEvent, AuditLog
from homunculus.api.clinical import BEDSIDE_SKEW, RETRACT
from homunculus.api.identity import Caller
from homunculus.auth.permissions import validate_permissions
from homunculus.canonical import SignalCode

log = logging.getLogger(__name__)

#: The five NEWS2 bands a tenant sets an interval for (spec D3), in the order the settings tab shows them.
BAND_KEYS: tuple[str, ...] = ("b0", "b1_4", "b3_single", "b5_6", "b7")

#: Vault source of the one default: news2-rcp-2017 — «Minimum 12-hourly observations» for a score of 0.
VITAL_DEFAULT_SOURCE = "news2-rcp-2017"

#: The seven inputs NEWS2 scores, as the signal codes a hand entry carries (`rules/news2.py`).
NEWS2_HAND_CODES: frozenset[str] = frozenset({
    SignalCode.RESP_RATE.value, SignalCode.SPO2.value, SignalCode.SBP.value, SignalCode.HEART_RATE.value,
    SignalCode.TEMPERATURE.value, SignalCode.SUPPLEMENTAL_OXYGEN.value, SignalCode.ACVPU.value,
})

TARGET_ROLES: tuple[str, ...] = ("nurse", "physician", "any")
TASK_STATES: tuple[str, ...] = ("open", "done", "skipped")
TITLE_MAX = 200
#: A hand task's due time at creation: at most this far back, at most this far ahead (spec D6).
DUE_BACK = timedelta(hours=24)
DUE_AHEAD = timedelta(days=7)
#: How far back the anchor read looks for a hand entry before it falls back to the admission (D2).
ANCHOR_WINDOW = timedelta(hours=48)
#: The most hand-entry rows one anchor read keeps (newest first), as trends keeps (G3-01 X1).
HAND_LIMIT = 5000
VITAL_SKIPPED = "vital_skipped"

TASKS_VIEW, TASKS_MANAGE, STRUCTURE_MANAGE = validate_permissions(("tasks.view", "tasks.manage", "structure.manage"))

# ----------------------------------------------------------------------------- refusal codes and words

TASK_SETTINGS_RANGE = "task_settings_range"
TASK_TITLE_LENGTH = "task_title_length"
TASK_DUE_WINDOW = "task_due_window"
TASK_ROLE_UNKNOWN = "task_role_unknown"
TASK_NOT_OPEN = "task_not_open"
TASK_REASON_LENGTH = "task_reason_length"
VITAL_NOT_DUE = "vital_not_due"
#: The server's words. The dashboard maps each in `apiErrors.js` (Task 15).
WORDS = {
    TASK_SETTINGS_RANGE: "Intervals are 5–1440 minutes, the grace 0–240 minutes, shift hours 0–23 and different.",
    TASK_TITLE_LENGTH: "The task text is 1–200 characters.",
    TASK_DUE_WINDOW: "The due time is at most 24 hours back and 7 days ahead.",
    TASK_ROLE_UNKNOWN: "The target role is nurse, physician or any.",
    TASK_NOT_OPEN: "The task is already closed.",
    TASK_REASON_LENGTH: "The reason is 1–200 characters.",
    VITAL_NOT_DUE: "No vital measurement is due for this patient.",
}
PATIENT_NOT_FOUND = "hasta bulunamadı"      # the words app.py's `_require_patient` uses
TASK_NOT_FOUND = "görev bulunamadı"
PERSON_REQUIRED = "a person signs a task: this credential names no actor"

# ----------------------------------------------------------------------------- settings

@dataclass(frozen=True)
class TaskSettings:
    """One tenant's rules (spec D10): the two shift starts (hours, tenant-local), the grace, the
    interval in minutes per band — None = not configured, no vital task for that band."""
    shift_start_a: int = 8
    shift_start_b: int = 20
    grace_min: int = 30
    intervals: dict[str, int | None] = field(default_factory=lambda: {
        "b0": 720, "b1_4": None, "b3_single": None, "b5_6": None, "b7": None})
    updated_at: datetime | None = None
    updated_by: str | None = None

    def refusal(self) -> str | None:
        """None when accepted, else the refusal code (one code: the screen names the field itself)."""
        hours = (self.shift_start_a, self.shift_start_b)
        if any(not isinstance(h, int) or isinstance(h, bool) or not 0 <= h <= 23 for h in hours):
            return TASK_SETTINGS_RANGE
        if self.shift_start_a == self.shift_start_b:
            return TASK_SETTINGS_RANGE
        if not isinstance(self.grace_min, int) or isinstance(self.grace_min, bool) or not 0 <= self.grace_min <= 240:
            return TASK_SETTINGS_RANGE
        if set(self.intervals) != set(BAND_KEYS):
            return TASK_SETTINGS_RANGE
        for value in self.intervals.values():
            if value is None:
                continue
            if not isinstance(value, int) or isinstance(value, bool) or not 5 <= value <= 1440:
                return TASK_SETTINGS_RANGE
        return None

    def as_dict(self, configured: bool) -> dict:
        return {"configured": configured, "shift_start_a": self.shift_start_a, "shift_start_b": self.shift_start_b,
                "grace_min": self.grace_min, "intervals": dict(self.intervals),
                "updated_at": _iso(self.updated_at), "updated_by": self.updated_by,
                "default_source": {"b0": VITAL_DEFAULT_SOURCE}}


DEFAULT_SETTINGS = TaskSettings()

# ----------------------------------------------------------------------------- pure functions

def _iso(at: datetime | None) -> str | None:
    return None if at is None else at.astimezone(timezone.utc).isoformat()


def _instant(raw) -> datetime | None:
    if not isinstance(raw, str):
        return None
    try:
        at = datetime.fromisoformat(raw)
    except ValueError:
        return None
    return at if at.tzinfo is not None else at.replace(tzinfo=timezone.utc)


def band_of(total: int, red_param: bool) -> str:
    """The settings key of a NEWS2 total (spec D3). A single parameter at 3 lifts 0–4 to its own
    band (the RCP table's «3 in any single parameter»); 5–6 and ≥7 stand whatever the parameter."""
    if total >= 7:
        return "b7"
    if total >= 5:
        return "b5_6"
    if red_param:
        return "b3_single"
    return "b0" if total == 0 else "b1_4"


def zone_of(name: str | None):
    """The tenant's zone, or UTC when the name is empty, "UTC", or unknown to this server's zone
    database (a warning, never a 500 — `admission/router.py` `hospital_today` does the same)."""
    if not name or name == "UTC":
        return timezone.utc
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        log.warning("the tenant's time zone %r is not known here: shifts are read in UTC", name)
        return timezone.utc


def shift_window(now: datetime, zone, starts: tuple[int, int]) -> tuple[datetime, datetime]:
    """The shift that contains `now`: 24 hours from the latest shift start at or before `now`, in
    the tenant's zone (spec D5). A boundary instant begins the new shift."""
    local = now.astimezone(zone)
    candidates = []
    for day in (local.date() - timedelta(days=1), local.date()):
        for hour in sorted(starts):
            candidates.append(datetime(day.year, day.month, day.day, hour, 0, tzinfo=zone))
    start = max(c for c in candidates if c <= local)
    return start, start + timedelta(hours=24)


def vital_task(*, now: datetime, anchor: datetime | None, admitted_at: datetime | None,
               interval_min: int | None, grace_min: int, skipped_until: datetime | None) -> dict | None:
    """The derived vital task (spec D2, D4), or None when the band has no interval."""
    if interval_min is None:
        return None
    anchor_at = anchor if anchor is not None else admitted_at
    if anchor_at is None:
        return {"state": "unknown", "anchor_at": None, "due_at": None, "skipped_until": None}
    due_at = anchor_at + timedelta(minutes=interval_min)
    if skipped_until is not None and skipped_until > now:
        return {"state": "skipped", "anchor_at": anchor_at, "due_at": skipped_until, "skipped_until": skipped_until}
    if now < due_at:
        state = "plan"
    elif now <= due_at + timedelta(minutes=grace_min):
        state = "due"
    else:
        state = "late"
    return {"state": state, "anchor_at": anchor_at, "due_at": due_at, "skipped_until": None}


def hand_state(state: str, due_at: datetime, *, grace_min: int, now: datetime) -> tuple[str, bool]:
    """A hand task's state and whether it is late: only an OPEN task past its grace is (spec D4)."""
    late = state == "open" and now > due_at + timedelta(minutes=grace_min)
    return state, late

# ----------------------------------------------------------------------------- rows and the store

@dataclass(frozen=True)
class TaskRow:
    """A hand task (spec D6). `title` and `skip_reason` are plain text here; the Postgres store
    encrypts them at rest (`crypto.encrypt_phi`). People are the actor's username, as `charted_by`."""
    id: str
    tenant: str
    patient_id: str
    title: str
    due_at: datetime
    target_role: str
    created_by: str
    created_at: datetime
    state: str = "open"
    claimed_by: str | None = None
    claimed_at: datetime | None = None
    closed_by: str | None = None
    closed_at: datetime | None = None
    skip_reason: str | None = None

    def as_dict(self, *, grace_min: int, now: datetime) -> dict:
        state, late = hand_state(self.state, self.due_at, grace_min=grace_min, now=now)
        return {"id": self.id, "patient_id": self.patient_id, "title": self.title, "due_at": _iso(self.due_at),
                "target_role": self.target_role, "state": state, "late": late,
                "created_by": self.created_by, "created_at": _iso(self.created_at),
                "claimed_by": self.claimed_by, "claimed_at": _iso(self.claimed_at),
                "closed_by": self.closed_by, "closed_at": _iso(self.closed_at)}


def new_task(*, tenant: str, patient_id: str, title: str, due_at: datetime, target_role: str,
             created_by: str, now: datetime) -> TaskRow:
    return TaskRow(id=str(uuid.uuid4()), tenant=tenant, patient_id=patient_id, title=title, due_at=due_at,
                   target_role=target_role, created_by=created_by, created_at=now)


class TaskStore(Protocol):
    """What the router needs. `tenant` is the hospital slug (the audit's tenant key)."""
    def create(self, row: TaskRow) -> TaskRow: ...
    def get(self, tenant: str, task_id: str) -> TaskRow | None: ...
    def list(self, tenant: str, *, since: datetime, until: datetime, patient_ids: set[str]) -> list[TaskRow]: ...
    def update(self, row: TaskRow) -> TaskRow: ...
    def settings(self, tenant: str) -> TaskSettings | None: ...
    def save_settings(self, tenant: str, settings: TaskSettings, *, by: str, now: datetime) -> TaskSettings: ...
    def admitted_at(self, tenant: str, patient_id: str) -> datetime | None: ...
    def timezone(self, tenant: str) -> str: ...
    def close(self) -> None: ...


class InMemoryTaskStore:
    """For tests and for a deployment without Postgres (rows vanish on restart). `zones` and
    `admitted` let a test say what the tenants table and the admissions would say."""

    def __init__(self, *, zones: dict[str, str] | None = None,
                 admitted: dict[tuple[str, str], datetime] | None = None) -> None:
        self._rows: dict[tuple[str, str], TaskRow] = {}
        self._settings: dict[str, TaskSettings] = {}
        self._zones = dict(zones or {})
        self._admitted = dict(admitted or {})

    def create(self, row: TaskRow) -> TaskRow:
        self._rows[(row.tenant, row.id)] = row
        return row

    def get(self, tenant: str, task_id: str) -> TaskRow | None:
        return self._rows.get((tenant, task_id))

    def list(self, tenant: str, *, since: datetime, until: datetime, patient_ids: set[str]) -> list[TaskRow]:
        rows = [r for (t, _), r in self._rows.items()
                if t == tenant and r.patient_id in patient_ids and since <= r.due_at < until]
        return sorted(rows, key=lambda r: (r.due_at, r.created_at, r.id))

    def update(self, row: TaskRow) -> TaskRow:
        if (row.tenant, row.id) not in self._rows:
            raise KeyError(row.id)
        self._rows[(row.tenant, row.id)] = row
        return row

    def settings(self, tenant: str) -> TaskSettings | None:
        return self._settings.get(tenant)

    def save_settings(self, tenant: str, settings: TaskSettings, *, by: str, now: datetime) -> TaskSettings:
        saved = replace(settings, updated_at=now, updated_by=by)
        self._settings[tenant] = saved
        return saved

    def admitted_at(self, tenant: str, patient_id: str) -> datetime | None:
        return self._admitted.get((tenant, patient_id))

    def timezone(self, tenant: str) -> str:
        return self._zones.get(tenant, "UTC")

    def close(self) -> None:
        return None

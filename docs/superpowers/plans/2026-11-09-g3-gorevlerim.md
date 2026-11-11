# G3-02 «Görevlerim» (My tasks) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A shared ward task queue («Görevlerim») fed by two sources — tasks a clinician writes, and the next hand-entered vital set derived from NEWS2 band intervals the hospital configures — with a 24-hour shift grid / list screen, a settings tab, two permissions and one migration.

**Architecture:** Spec `docs/superpowers/specs/2026-11-09-g3-gorevlerim-design.md` (bd5f90d9). Engine side lives in the `api/` world (the world `/patients`, `/clinical` and the identity store live in): a new module `homunculus/api/tasks.py` holds the pure schedule functions, the task/settings dataclasses, the `TaskStore` protocol with an in-memory store, and a **factory router** `tasks_router(...)` bound to the app's caller resolver, scoped board and audit log (the `edge_query_router` pattern); `homunculus/api/tasks_postgres.py` is the Postgres store (sync engine + `text()` SQL, as `patient_identity_postgres.py`). The vital task is never stored: it is derived from the patient's hand entries in the audit chain (`chart` / `chart_retract` rows), the board card's NEWS2 total, and the tenant's intervals. Hand tasks and settings are rows in two new tables (migration **0017**, after B3a's 0016). Dashboard: a new screen `/gorevler`, an admin tab, eight API client methods, one i18n namespace.

**Tech Stack:** Python 3.12 (FastAPI, SQLAlchemy sync engine for the store, Alembic), pytest; React 18 + Vite + vitest + Testing Library; Tailwind tokens already in the shell.

**Spec amendments this plan makes (recorded in Task 16):** tables are keyed by the tenant **slug** (`tenant VARCHAR(64)`), as `patient_identity` and the audit rows are, not by a UUID FK (D6, D10); `created_by`/`claimed_by`/`closed_by` are the actor's username, as `charted_by` is (D6); `title`/`skip_reason` are encrypted with `crypto.encrypt_phi` in the store, not an ORM `EncryptedString` (D6); the settings routes are `GET|PUT /tasks/settings` under the one `/tasks` prefix, not `/tenant/task-settings` (§3, D10); a patient who is not on the caller's scoped board answers **404 `hasta bulunamadı`** like every other patient route (not 403 `scope_denied`), and a discharged patient is simply not on the board (D9, D11); the vital skip is read back from the audit chain (`vital_skipped` events), no table (D7).

---

## Ground rules (read before Task 0)

- **Worktree:** `/c/tmp/g3-gorevler` (branch `feat/g3-gorevlerim`, off `main` 8260d0cb; spec commit bd5f90d9). Never touch `c:\Users\User\Desktop\Project\Homunculus AI`. Never `git stash`. Commit with explicit pathspecs only.
- **Engine commands** run from `/c/tmp/g3-gorevler/homunculus-engine`:
  ```
  PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q <files> 2>&1 | tail -3
  ```
  - Whole no-DB suite: `… -m pytest -p no:cacheprovider -q -p no:warnings tests --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -3`.
  - **Never run `tests/test_infinity_vm_pilot.py`** (it hangs). **Never set or export `DATABASE_URL`.** The Postgres tests take `TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test` on the command line only (the container `homunculus-test-pg-56`; start it as G3-01's Task 7 did if it is not running — `docker ps --filter name=homunculus-test-pg-56`).
- **Dashboard commands** run from `/c/tmp/g3-gorevler/dashboard`: one file `./node_modules/.bin/vitest run <paths>`; whole suite `./node_modules/.bin/vitest run`; build `./node_modules/.bin/vite build` (a `precache  N entries` line and no `larger than 500 kB`). Use the local binaries, not `npx`. A `not wrapped in act(...)` warning is not a failure.
- **Style:** every new Python file starts with the `# homunculus-engine/src/…` path comment and a docstring that says what and why (as `protocol/router.py`); every new JSX file starts with a `// src/live/…` path comment. No patient data in tests: synthetic ids `S-001`, names `Ayşe Sentetik`.
- **Merge seams:** `routes.js` SCREENS/ROUTES, `AdminScreen.jsx` TABS/TAB_SCREENS, `catalog.js` NAMESPACES, `fakeApi`, `permissions.py` each take ONE new line (or block) with blank lines either side. Do not close the gaps.
- **Migration numbering (spec D18):** this slice's migration is `0017_tasks.py`, `down_revision = "0016"`. B1d's `0016_bed_occupancy.py` is on the LOCAL branch `feat/g2b-b3a-doluluk` (same repository). Task 0 copies it next to ours for local tests only; it is never added to a commit. If at merge time B3a is not on main, rename ours to 0016 with `down_revision = "0015"` and tell B1d the same day.

---

### Task 0: Baseline, the 0016 neighbour, the gates as they stand

**Files:**
- Create (untracked, never committed): `homunculus-engine/alembic/versions/0016_bed_occupancy.py`

- [ ] **Step 1: Confirm the worktree and branch**

Run: `cd /c/tmp/g3-gorevler && git status -sb | head -2 && git log --oneline -1`
Expected: `## feat/g3-gorevlerim...origin/feat/g3-gorevlerim`, clean, head `bd5f90d9`.

- [ ] **Step 2: Put B3a's 0016 beside ours for local tests only**

Run:
```bash
cd /c/tmp/g3-gorevler && git show feat/g2b-b3a-doluluk:homunculus-engine/alembic/versions/0016_bed_occupancy.py > homunculus-engine/alembic/versions/0016_bed_occupancy.py && grep -nE '^revision|^down_revision' homunculus-engine/alembic/versions/0016_bed_occupancy.py
```
Expected: `revision: str = "0016"` and `down_revision: Union[str, None] = "0015"`. `git status --porcelain` shows it as `??` — leave it so. Every `git add` in this plan names its files.

- [ ] **Step 3: Record the baseline gates**

Run the whole no-DB engine suite and the whole dashboard suite (commands in the ground rules). Write the three numbers (engine passed/skipped, dashboard files/tests) into the commit message of Task 1 as `baseline: engine N/M, dashboard F/T`.

---

### Task 1: The two permissions

**Files:**
- Modify: `homunculus-engine/src/homunculus/auth/permissions.py` (the `PERMISSIONS` dict tail, ~line 54–61; the default groups ~lines 100–180)
- Modify: `homunculus-engine/tests/test_permissions.py` (`SPEC_KEYS` ~line 16; the count test ~line 28; `SPEC_GROUPS` ~lines 109–137)

- [ ] **Step 1: Extend the catalogue test first**

In `tests/test_permissions.py` add to `SPEC_KEYS`, after the `"devices.map_beds"` line:
```python
    "tasks.view",         # G3-02 Görevlerim (spec D8): open the queue, read /tasks
    "tasks.manage",       # G3-02: write a task, claim, close, skip; skip a vital measurement
```
Rename and fix the count test:
```python
def test_the_catalogue_is_exactly_the_specified_twenty_five_keys():
    assert len(SPEC_KEYS) == 25
    assert set(PERMISSIONS) == SPEC_KEYS
    assert ALL_PERMISSIONS == frozenset(SPEC_KEYS)
```
In `SPEC_GROUPS` add `"tasks.view", "tasks.manage"` to the sets of `attending`, `unit_physician`, `physician`, `charge_nurse`, `nurse`, `rapid_response` (six groups; `auditor`, `platform_support`, `pharmacist`, `biomedical` unchanged; `hospital_admin` is `tuple(PERMISSIONS)` and needs no edit).

- [ ] **Step 2: Run it to see it fail**

Run: `… -m pytest -p no:cacheprovider -q tests/test_permissions.py 2>&1 | tail -3`
Expected: FAIL — `set(PERMISSIONS) == SPEC_KEYS` differs by the two keys.

- [ ] **Step 3: Add the keys and the group rows**

In `permissions.py`, after the `"devices.map_beds"` entry and before the closing `}` of `PERMISSIONS`:
```python

    # G3-02 — Görevlerim (spec D8): the ward's task queue. `tasks.view` opens the screen and reads
    # `/tasks`; `tasks.manage` writes a task, claims, closes or skips one, and skips a vital
    # measurement for one interval with a reason.
    "tasks.view": "Open the Görevlerim queue and read the ward's tasks in one's own units",
    "tasks.manage": "Write, claim, close or skip a task; skip one vital measurement with a reason",
```
Then add `"tasks.view", "tasks.manage",` to `_ATTENDING` (so `attending` and `unit_physician` inherit it) and to the `permissions` tuples of `physician`, `charge_nurse`, `nurse` and `rapid_response`.

- [ ] **Step 4: Run the permission tests and the route tests**

Run: `… -m pytest -p no:cacheprovider -q tests/test_permissions.py tests/test_route_permissions.py tests/test_route_inventory.py 2>&1 | tail -3`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g3-gorevler && git add homunculus-engine/src/homunculus/auth/permissions.py homunculus-engine/tests/test_permissions.py && git commit -m "feat(auth): tasks.view and tasks.manage — Görevlerim permissions (G3-02 D8); baseline: engine N/M, dashboard F/T"
```

---

### Task 2: The schedule — pure functions

**Files:**
- Create: `homunculus-engine/src/homunculus/api/tasks.py` (first part)
- Test: `homunculus-engine/tests/test_tasks_schedule.py`

- [ ] **Step 1: Write the failing tests**

```python
# homunculus-engine/tests/test_tasks_schedule.py
"""G3-02 (spec D2–D5): the vital task is derived, never stored. These are the pure functions."""
from datetime import datetime, timedelta, timezone

from homunculus.api.tasks import (
    BAND_KEYS, DEFAULT_SETTINGS, NEWS2_HAND_CODES, TaskSettings, band_of, hand_state, shift_window,
    vital_task, zone_of,
)
from homunculus.canonical import SignalCode

BAKU = timezone(timedelta(hours=4))          # a fixed offset: no tzdata needed on Windows
UTC = timezone.utc
T0 = datetime(2026, 11, 9, 10, 0, tzinfo=UTC)   # 14:00 in Baku


class TestBandOf:
    def test_zero_without_a_red_parameter_is_b0(self):
        assert band_of(0, False) == "b0"

    def test_one_to_four_is_b1_4_unless_a_parameter_scored_three(self):
        assert band_of(1, False) == "b1_4"
        assert band_of(4, False) == "b1_4"
        assert band_of(3, True) == "b3_single"

    def test_five_six_and_seven_plus(self):
        assert band_of(5, False) == "b5_6"
        assert band_of(6, True) == "b5_6"          # a red parameter inside 5–6 keeps the higher band
        assert band_of(7, False) == "b7"
        assert band_of(12, True) == "b7"

    def test_the_keys_are_the_settings_keys(self):
        assert set(BAND_KEYS) == {"b0", "b1_4", "b3_single", "b5_6", "b7"}
        assert set(DEFAULT_SETTINGS.intervals) == set(BAND_KEYS)
        assert DEFAULT_SETTINGS.intervals == {"b0": 720, "b1_4": None, "b3_single": None, "b5_6": None, "b7": None}


class TestShiftWindow:
    def test_the_morning_shift_in_baku(self):
        start, end = shift_window(T0, BAKU, (8, 20))
        assert start == datetime(2026, 11, 9, 8, 0, tzinfo=BAKU)
        assert end == start + timedelta(hours=24)

    def test_the_night_shift_crosses_midnight(self):
        night = datetime(2026, 11, 9, 23, 30, tzinfo=UTC)        # 03:30 Baku, 10 Nov
        start, _ = shift_window(night, BAKU, (8, 20))
        assert start == datetime(2026, 11, 9, 20, 0, tzinfo=BAKU)

    def test_exactly_at_the_boundary_starts_the_new_shift(self):
        at = datetime(2026, 11, 9, 16, 0, tzinfo=UTC)          # 20:00 Baku
        start, _ = shift_window(at, BAKU, (8, 20))
        assert start == datetime(2026, 11, 9, 20, 0, tzinfo=BAKU)

    def test_the_starts_may_come_in_any_order(self):
        assert shift_window(T0, BAKU, (20, 8)) == shift_window(T0, BAKU, (8, 20))


class TestVitalTask:
    def test_plan_due_late(self):
        anchor = T0 - timedelta(minutes=100)
        v = vital_task(now=T0, anchor=anchor, admitted_at=None, interval_min=240, grace_min=30, skipped_until=None)
        assert v["state"] == "plan" and v["due_at"] == anchor + timedelta(minutes=240)
        v = vital_task(now=T0, anchor=T0 - timedelta(minutes=250), admitted_at=None, interval_min=240, grace_min=30, skipped_until=None)
        assert v["state"] == "due"
        v = vital_task(now=T0, anchor=T0 - timedelta(minutes=271), admitted_at=None, interval_min=240, grace_min=30, skipped_until=None)
        assert v["state"] == "late"

    def test_the_grace_edge_is_still_due(self):
        v = vital_task(now=T0, anchor=T0 - timedelta(minutes=270), admitted_at=None, interval_min=240, grace_min=30, skipped_until=None)
        assert v["state"] == "due"

    def test_no_interval_means_no_task(self):
        assert vital_task(now=T0, anchor=T0, admitted_at=None, interval_min=None, grace_min=30, skipped_until=None) is None

    def test_without_a_hand_entry_the_admission_is_the_anchor(self):
        admitted = T0 - timedelta(hours=13)
        v = vital_task(now=T0, anchor=None, admitted_at=admitted, interval_min=720, grace_min=30, skipped_until=None)
        assert v["anchor_at"] == admitted and v["state"] == "late"

    def test_neither_is_unknown(self):
        v = vital_task(now=T0, anchor=None, admitted_at=None, interval_min=720, grace_min=30, skipped_until=None)
        assert v["state"] == "unknown" and v["due_at"] is None and v["anchor_at"] is None

    def test_a_skip_hides_the_task_until_its_moment(self):
        v = vital_task(now=T0, anchor=T0 - timedelta(hours=5), admitted_at=None, interval_min=240, grace_min=30,
                       skipped_until=T0 + timedelta(hours=3))
        assert v["state"] == "skipped" and v["due_at"] == T0 + timedelta(hours=3) and v["skipped_until"] == T0 + timedelta(hours=3)
        v = vital_task(now=T0, anchor=T0 - timedelta(hours=5), admitted_at=None, interval_min=240, grace_min=30,
                       skipped_until=T0 - timedelta(minutes=1))
        assert v["state"] == "late"                      # a skip in the past no longer hides anything


class TestHandState:
    def test_open_is_late_only_after_the_grace(self):
        due = T0 - timedelta(minutes=31)
        assert hand_state("open", due, grace_min=30, now=T0) == ("open", True)
        assert hand_state("open", T0 - timedelta(minutes=30), grace_min=30, now=T0) == ("open", False)
        assert hand_state("done", due, grace_min=30, now=T0) == ("done", False)
        assert hand_state("skipped", due, grace_min=30, now=T0) == ("skipped", False)


class TestZoneOf:
    def test_utc_and_an_unknown_name_fall_back_to_utc(self):
        assert zone_of("UTC") is UTC
        assert zone_of(None) is UTC
        assert zone_of("Mars/Olympus") is UTC


def test_the_hand_codes_are_news2s_seven_inputs():
    assert NEWS2_HAND_CODES == frozenset({
        SignalCode.RESP_RATE.value, SignalCode.SPO2.value, SignalCode.SBP.value, SignalCode.HEART_RATE.value,
        SignalCode.TEMPERATURE.value, SignalCode.SUPPLEMENTAL_OXYGEN.value, SignalCode.ACVPU.value})


def test_settings_validation():
    ok = TaskSettings(shift_start_a=8, shift_start_b=20, grace_min=30, intervals=dict(DEFAULT_SETTINGS.intervals))
    assert ok.refusal() is None
    assert TaskSettings(8, 8, 30, dict(DEFAULT_SETTINGS.intervals)).refusal() == "task_settings_range"
    assert TaskSettings(8, 20, 241, dict(DEFAULT_SETTINGS.intervals)).refusal() == "task_settings_range"
    bad = dict(DEFAULT_SETTINGS.intervals)
    bad["b7"] = 4
    assert TaskSettings(8, 20, 30, bad).refusal() == "task_settings_range"
    bad["b7"] = 1441
    assert TaskSettings(8, 20, 30, bad).refusal() == "task_settings_range"
```

- [ ] **Step 2: Run it to see it fail**

Run: `… -m pytest -p no:cacheprovider -q tests/test_tasks_schedule.py 2>&1 | tail -3`
Expected: FAIL — `ModuleNotFoundError: No module named 'homunculus.api.tasks'`.

- [ ] **Step 3: Write the module's first part**

```python
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
```

- [ ] **Step 4: Run the schedule tests**

Run: `… -m pytest -p no:cacheprovider -q tests/test_tasks_schedule.py 2>&1 | tail -3`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g3-gorevler && git add homunculus-engine/src/homunculus/api/tasks.py homunculus-engine/tests/test_tasks_schedule.py && git commit -m "feat(tasks): schedule — NEWS2 band, shift window, derived vital task, hand-task lateness (G3-02 D2–D5)"
```

---

### Task 3: The task store — protocol and in-memory

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/tasks.py` (append)
- Test: `homunculus-engine/tests/test_tasks_store.py`

- [ ] **Step 1: Write the failing tests**

```python
# homunculus-engine/tests/test_tasks_store.py
"""G3-02 (spec D6, D10): the hand-task rows and the tenant's settings, in the in-memory store the
DB-less suite and the tests use. The Postgres store answers the same protocol (test_tasks_postgres.py)."""
from datetime import datetime, timedelta, timezone

from homunculus.api.tasks import DEFAULT_SETTINGS, InMemoryTaskStore, TaskRow, TaskSettings, new_task

T0 = datetime(2026, 11, 9, 10, 0, tzinfo=timezone.utc)


def _row(**over) -> TaskRow:
    base = new_task(tenant="h1", patient_id="S-001", title="Pansuman", due_at=T0 + timedelta(hours=1),
                    target_role="nurse", created_by="hem.ayse", now=T0)
    return base if not over else TaskRow(**{**base.__dict__, **over})


def test_create_get_and_list_in_a_window():
    store = InMemoryTaskStore()
    saved = store.create(_row())
    assert saved.id and saved.state == "open" and saved.created_at == T0
    assert store.get("h1", saved.id) == saved
    assert store.get("h2", saved.id) is None                       # another tenant never sees it
    assert store.list("h1", since=T0, until=T0 + timedelta(hours=2), patient_ids={"S-001"}) == [saved]
    assert store.list("h1", since=T0 + timedelta(hours=2), until=T0 + timedelta(hours=3), patient_ids={"S-001"}) == []
    assert store.list("h1", since=T0, until=T0 + timedelta(hours=2), patient_ids={"S-002"}) == []


def test_update_replaces_the_row():
    store = InMemoryTaskStore()
    saved = store.create(_row())
    closed = store.update(TaskRow(**{**saved.__dict__, "state": "done", "closed_by": "hem.ayse", "closed_at": T0}))
    assert store.get("h1", saved.id) == closed and closed.state == "done"


def test_settings_default_until_saved():
    store = InMemoryTaskStore()
    assert store.settings("h1") is None
    saved = store.save_settings("h1", TaskSettings(8, 20, 45, {**DEFAULT_SETTINGS.intervals, "b1_4": 360}), by="admin", now=T0)
    assert saved.grace_min == 45 and saved.intervals["b1_4"] == 360 and saved.updated_by == "admin" and saved.updated_at == T0
    assert store.settings("h1") == saved and store.settings("h2") is None


def test_admitted_at_and_zone_are_what_the_test_set():
    store = InMemoryTaskStore(zones={"h1": "Asia/Baku"}, admitted={("h1", "S-001"): T0})
    assert store.admitted_at("h1", "S-001") == T0 and store.admitted_at("h1", "S-009") is None
    assert store.timezone("h1") == "Asia/Baku" and store.timezone("h2") == "UTC"
```

- [ ] **Step 2: Run it to see it fail**

Run: `… -m pytest -p no:cacheprovider -q tests/test_tasks_store.py 2>&1 | tail -3`
Expected: FAIL — `ImportError: cannot import name 'InMemoryTaskStore'`.

- [ ] **Step 3: Append the rows and the store to `api/tasks.py`**

```python
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
```

- [ ] **Step 4: Run the store tests**

Run: `… -m pytest -p no:cacheprovider -q tests/test_tasks_store.py tests/test_tasks_schedule.py 2>&1 | tail -3`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g3-gorevler && git add homunculus-engine/src/homunculus/api/tasks.py homunculus-engine/tests/test_tasks_store.py && git commit -m "feat(tasks): TaskRow, TaskSettings and the in-memory TaskStore (G3-02 D6, D10)"
```

---

### Task 4: `GET /tasks` — the derived queue, wired into the app

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/tasks.py` (append the anchor read and the router factory)
- Modify: `homunculus-engine/src/homunculus/api/app.py` (`create_app` signature ~line 243; the defaults ~line 315; the `/patients` handler ~lines 1466–1498; the router block ~lines 729–733; the `app.state` block ~line 744)
- Modify: `homunculus-engine/tests/test_route_inventory.py` (`CALLER_RESOLVED_ROUTES`, line 28)
- Modify: `deploy/local/web/nginx.conf` (line 236 regex)
- Test: `homunculus-engine/tests/test_tasks_api.py`

- [ ] **Step 1: Write the failing tests (read side)**

```python
# homunculus-engine/tests/test_tasks_api.py
"""G3-02: /tasks against the DB-less app — the derived vital task, the hand tasks, the rights, the scope."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.identity import Caller
from homunculus.api.tasks import DEFAULT_SETTINGS, TASK_NOT_OPEN, InMemoryTaskStore

TOKEN = "tok"
DEVICE = {"Authorization": f"Bearer {TOKEN}"}
NURSE = {"Authorization": "Bearer nurse-jwt"}
VIEWER = {"Authorization": "Bearer viewer-jwt"}
ADMIN = {"Authorization": "Bearer admin-jwt"}
PEOPLE = {
    "nurse-jwt": Caller(hospital="h1", actor="hem.ayse", groups=("nurse",),
                        perms=frozenset({"board.view", "clinical.chart", "tasks.view", "tasks.manage"})),
    "viewer-jwt": Caller(hospital="h1", actor="dr.elif", groups=("auditor",), perms=frozenset({"board.view"})),
    "admin-jwt": Caller(hospital="h1", actor="admin.lbys", groups=("hospital_admin",),
                        perms=frozenset({"board.view", "tasks.view", "tasks.manage", "structure.manage"})),
}
NOW = datetime(2026, 11, 9, 10, 0, tzinfo=timezone.utc)


async def _resolve(credential: str):
    return PEOPLE.get(credential)


@pytest.fixture()
def store():
    return InMemoryTaskStore(zones={"h1": "UTC"}, admitted={("h1", "S-002"): NOW - timedelta(hours=20)})


@pytest.fixture()
def client(store):
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve, tasks=store)
    with TestClient(app) as c:
        yield c


def _ingest(client, patient, code, value, at):
    r = client.post("/ingest", json={"patient_id": patient, "code": code, "value": value, "unit": "",
                                     "timestamp": at.isoformat()}, headers=DEVICE)
    assert r.status_code == 200, r.text


def _chart(client, patient, entries, at):
    r = client.post(f"/clinical/{patient}", json={"recorded_at": at.isoformat(), "entries": entries}, headers=NURSE)
    assert r.status_code == 200, r.text
    return r.json()


def _tasks(client, headers=NURSE, **params):
    return client.get("/tasks", params=params, headers=headers)


def _card(client, patient):
    return next(p for p in _tasks(client).json()["patients"] if p["patient_id"] == patient)


class TestReading:
    def test_needs_tasks_view(self, client):
        assert _tasks(client, VIEWER).status_code == 403

    def test_answers_the_shift_window_the_settings_and_one_entry_per_patient(self, client):
        at = datetime.now(timezone.utc) - timedelta(minutes=5)
        _chart(client, "S-001", [{"code": "resp_rate", "value": 16}], at)
        r = _tasks(client)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["shift"]["start"] <= body["now"] < body["shift"]["end"]
        assert body["settings"]["grace_min"] == 30 and body["settings"]["intervals"]["b0"] == 720
        card = next(p for p in body["patients"] if p["patient_id"] == "S-001")
        vital = card["vital"]
        assert vital["state"] == "plan" and vital["band"] == "b0" and vital["interval_min"] == 720
        assert vital["anchor_at"][:16] == at.isoformat()[:16] and len(vital["entries"]) == 1
        assert card["tasks"] == []

    def test_a_band_without_an_interval_has_no_vital_task(self, client):
        at = datetime.now(timezone.utc) - timedelta(minutes=5)
        _chart(client, "S-001", [{"code": "resp_rate", "value": 26}], at)        # 3 points → b3_single, NULL
        assert _card(client, "S-001")["vital"] is None

    def test_the_admission_is_the_anchor_when_nothing_was_charted(self, client, store):
        at = datetime.now(timezone.utc) - timedelta(minutes=3)
        _ingest(client, "S-002", "heart_rate", 80, at)              # a monitor value is NOT a hand entry
        vital = _card(client, "S-002")["vital"]
        assert vital["state"] == "late"                              # admitted 20 h ago, b0 = 12 h, no hand set
        assert vital["anchor_at"] == (NOW - timedelta(hours=20)).isoformat()

    def test_unknown_when_there_is_neither(self, client):
        at = datetime.now(timezone.utc) - timedelta(minutes=3)
        _ingest(client, "S-003", "heart_rate", 80, at)
        vital = _card(client, "S-003")["vital"]
        assert vital["state"] == "unknown" and vital["due_at"] is None

    def test_a_withdrawn_entry_is_not_an_anchor(self, client):
        at = datetime.now(timezone.utc) - timedelta(minutes=5)
        saved = _chart(client, "S-001", [{"code": "resp_rate", "value": 16}], at)
        entry = saved["entries"][0]["entry"]
        r = client.post(f"/clinical/S-001/entries/{entry}/retract", json={"reason": "yanlış hasta"}, headers=NURSE)
        assert r.status_code == 200, r.text
        vital = _card(client, "S-001")["vital"]
        assert vital["anchor_at"] is None and vital["state"] == "unknown"

    def test_a_device_token_reads_too(self, client):
        assert _tasks(client, DEVICE).status_code == 200
```

- [ ] **Step 2: Run it to see it fail**

Run: `… -m pytest -p no:cacheprovider -q tests/test_tasks_api.py 2>&1 | tail -3`
Expected: FAIL — `create_app() got an unexpected keyword argument 'tasks'`.

- [ ] **Step 3: Append the anchor read and the router factory to `api/tasks.py`**

```python
# ----------------------------------------------------------------------------- the anchor: hand entries

def hand_entries(audit: AuditLog, hospital: str, patient_id: str, *, since: datetime,
                 until: datetime) -> list[datetime]:
    """When this patient's NEWS2 inputs were entered by hand in [since, until], oldest first — the
    `chart` rows minus the withdrawn ones (G3-01 D12). A monitor or HL7 observation is not one."""
    rows = audit.records(tenant=hospital, patient_id=patient_id, event_types={"chart", RETRACT},
                         since=since - BEDSIDE_SKEW, limit=HAND_LIMIT, newest=True)
    withdrawn = {rec.payload.get("entry") for rec in rows if rec.event_type == RETRACT}
    stamps = []
    for rec in rows:
        if rec.event_type != "chart" or rec.subject not in NEWS2_HAND_CODES or rec.id in withdrawn:
            continue
        at = _instant(rec.payload.get("obs_ts"))
        if at is not None and since <= at <= until:
            stamps.append(at)
    return sorted(stamps)


def skipped_until(audit: AuditLog, hospital: str, patient_id: str) -> datetime | None:
    """The latest `vital_skipped` event's `until`, if any (spec D7)."""
    rows = audit.records(tenant=hospital, patient_id=patient_id, event_type=VITAL_SKIPPED, limit=1, newest=True)
    return _instant(rows[-1].payload.get("until")) if rows else None


# ----------------------------------------------------------------------------- the router

def tasks_router(*, caller: Callable[[str | None], Awaitable[Caller]],
                 board: Callable[[str | None, str], Awaitable[tuple[Caller, list[dict]]]],
                 audit: AuditLog, store: TaskStore,
                 clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc)) -> APIRouter:
    """The routes of spec §3, bound to the app: `caller` resolves the credential, `board(authorization,
    permission)` answers the caller and the cards they may see (the `/patients` body), `audit` is
    the chain the events go to, `store` holds the hand tasks and the settings."""
    router = APIRouter(tags=["tasks"])

    def _settings(hospital: str) -> tuple[TaskSettings, bool]:
        saved = store.settings(hospital)
        return (saved, True) if saved is not None else (DEFAULT_SETTINGS, False)

    def _person(who: Caller) -> str:
        if who.is_device or not isinstance(who.actor, str) or not who.actor.strip():
            raise HTTPException(status_code=403, detail=PERSON_REQUIRED)
        return who.actor

    def _require(who: Caller, permission: str) -> None:
        if not who.can(permission):
            raise HTTPException(status_code=403, detail=f"permission required: {permission}")

    def _refuse(status: int, code: str) -> HTTPException:
        return HTTPException(status_code=status, detail={"code": code, "message": WORDS[code]})

    def _window(hospital: str, settings: TaskSettings, now: datetime,
                from_: str | None, to: str | None) -> tuple[datetime, datetime, datetime, datetime]:
        zone = zone_of(store.timezone(hospital))
        start, end = shift_window(now, zone, (settings.shift_start_a, settings.shift_start_b))
        since = _instant(from_) or start
        until = _instant(to) or end
        if until <= since:
            raise HTTPException(status_code=422, detail="`to` is after `from`")
        return start, end, since, until

    def _vital(hospital: str, card: dict, settings: TaskSettings, now: datetime,
               since: datetime, until: datetime) -> dict | None:
        news2 = card.get("news2") or {}
        total = news2.get("total")
        band = band_of(int(total), bool(news2.get("red_param"))) if isinstance(total, int) else "b0"
        interval = settings.intervals.get(band)
        if interval is None:
            return None
        pid = card["patient_id"]
        stamps = hand_entries(audit, hospital, pid, since=now - ANCHOR_WINDOW, until=now)
        anchor = stamps[-1] if stamps else None
        derived = vital_task(now=now, anchor=anchor, admitted_at=store.admitted_at(hospital, pid),
                             interval_min=interval, grace_min=settings.grace_min,
                             skipped_until=skipped_until(audit, hospital, pid))
        return {**derived, "anchor_at": _iso(derived["anchor_at"]), "due_at": _iso(derived["due_at"]),
                "skipped_until": _iso(derived["skipped_until"]), "band": band, "interval_min": interval,
                "partial": bool(news2.get("partial")), "entries": [_iso(s) for s in stamps if since <= s < until]}

    @router.get("/tasks")
    async def list_tasks(authorization: str | None = Header(default=None),
                         from_: str | None = Query(default=None, alias="from"),
                         to: str | None = Query(default=None)):
        who, cards = await board(authorization, TASKS_VIEW)
        hospital = who.hospital
        now = clock()
        settings, _ = _settings(hospital)
        start, end, since, until = _window(hospital, settings, now, from_, to)
        ids = {c["patient_id"] for c in cards}
        rows = store.list(hospital, since=since, until=until, patient_ids=ids)
        by_patient: dict[str, list[dict]] = {pid: [] for pid in ids}
        for row in rows:
            by_patient[row.patient_id].append(row.as_dict(grace_min=settings.grace_min, now=now))
        return {"from": _iso(since), "to": _iso(until), "shift": {"start": _iso(start), "end": _iso(end)},
                "now": _iso(now),
                "settings": {"grace_min": settings.grace_min, "intervals": dict(settings.intervals)},
                "patients": [{"patient_id": c["patient_id"], "bed_key": c.get("bed_key"), "unit_id": c.get("unit_id"),
                              "vital": _vital(hospital, c, settings, now, since, until),
                              "tasks": by_patient[c["patient_id"]]} for c in cards]}

    # Task 5 appends the write routes here; Task 6 the settings routes.
    return router
```

- [ ] **Step 4: Wire the store and the scoped board into `app.py`**

a) In `create_app`'s signature add, after `device_beds: DeviceBedSource | None = None,`:
```python
    tasks: TaskStore | None = None,
```
With the other `homunculus.api` imports at the top of the module:
```python
from homunculus.api.tasks import InMemoryTaskStore, TaskStore, tasks_router
```
Next to `audit = audit or InMemoryAuditLog()` (~line 315):
```python
    tasks = tasks if tasks is not None else InMemoryTaskStore()
```

b) Replace the `/patients` handler (~1466–1498) with a shared reader plus the thin route. Keep the handler's existing docstring paragraphs on `_board_for`:
```python
    async def _board_for(authorization: str | None, permission: str) -> tuple[Caller, Scope, ScopeResult]:
        """The ward narrowed to this caller — what `/patients` answers and `/tasks` reads (G3-02).
        (… the former /patients docstring …)"""
        caller = await _caller(authorization)
        _require(caller, permission)
        hospital = caller.hospital
        # 503 before the board is narrowed (G2-A2, D13): an unreadable scope is not an empty one.
        scope = _readable(await _scope(authorization))
        now = datetime.now(timezone.utc)          # every card, and its shadow, judged at one instant
        cards = board_snapshot(_engine(hospital), _store(hospital), identities=identities,
                               hospital=hospital, bedmap=bedmap, now=now,
                               shadow_for=lambda pid: _shadow_for(hospital, pid, now))
        # The identity-only cards (an admitted patient the real engine has never measured) carry
        # the shadow key too, read without creating the patient in the real engine (D1, D6).
        for card in cards:
            if "shadow" not in card:
                card["shadow"] = _shadow_for(hospital, card["patient_id"], now)
        result = apply_scope(cards, scope)
        if result.blind:
            log.warning("scope yielded an empty board for a %s caller in %s (grants: %s)",
                        scope.reason, hospital, ", ".join(result.unmatched_grants) or "none")
        return caller, scope, result

    @app.get("/patients")
    async def patients(authorization: str | None = Header(default=None)):
        """The ward, narrowed to what this caller may see — and told why it is that size."""
        _, _, result = await _board_for(authorization, BOARD_VIEW)
        return {"patients": result.boards,
                "scope": result.as_dict(),
                "scope_note": scope_report(result)}
```
`ScopeResult` comes from `homunculus.scope.rules` — add it to that import line if it is not there.

c) In the router block, after the protocol router include (~line 731):
```python
    # G3-02: Görevlerim — the task queue, bound to the caller resolver and the scoped board (`_board_for`
    # is defined below; the lambdas read it when a request arrives, as the edge query does).
    async def _tasks_board(authorization: str | None, permission: str):
        who, _, result = await _board_for(authorization, permission)
        return who, result.boards
    app.include_router(tasks_router(caller=lambda authorization: _caller(authorization),
                                    board=_tasks_board, audit=audit, store=tasks))
```
In the `app.state` block: `app.state.tasks = tasks`.

- [ ] **Step 5: Register the factory routes with the inventory test and nginx**

`tests/test_route_inventory.py`:
```python
CALLER_RESOLVED_ROUTES = {("homunculus.api.edge_query", "POST", "/edge/patient-query"),
                          ("homunculus.api.infinity_waves", "GET", "/infinity-waves/{device_id}"),
                          # G3-02: the task queue resolves its caller through the app's `_caller`
                          ("homunculus.api.tasks", "GET", "/tasks"),
                          ("homunculus.api.tasks", "POST", "/tasks"),
                          ("homunculus.api.tasks", "POST", "/tasks/{task_id}/claim"),
                          ("homunculus.api.tasks", "POST", "/tasks/{task_id}/done"),
                          ("homunculus.api.tasks", "POST", "/tasks/{task_id}/skip"),
                          ("homunculus.api.tasks", "POST", "/tasks/vitals/{patient_id}/skip"),
                          ("homunculus.api.tasks", "GET", "/tasks/settings"),
                          ("homunculus.api.tasks", "PUT", "/tasks/settings")}
```
`deploy/local/web/nginx.conf` line 236: add `|tasks` before `)(/|$)` so the alternation ends `…|audit|health|tasks)(/|$)`.

- [ ] **Step 6: Run the read tests, the inventory, nginx and the bedside tests**

Run: `… -m pytest -p no:cacheprovider -q tests/test_tasks_api.py tests/test_route_inventory.py tests/test_nginx_routes.py tests/test_bedside_preview.py 2>&1 | tail -3`
Expected: PASS (the inventory lists exemptions, so routes not yet defined do not fail it; `/patients` behaves as before).

- [ ] **Step 7: Commit**

```bash
cd /c/tmp/g3-gorevler && git add homunculus-engine/src/homunculus/api/tasks.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_tasks_api.py homunculus-engine/tests/test_route_inventory.py deploy/local/web/nginx.conf && git commit -m "feat(tasks): GET /tasks — the derived vital task and the hand tasks for the caller's scoped board (G3-02 §3, D2–D5, D9)"
```

---

### Task 5: The writes — create, claim, done, skip; skip a vital measurement

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/tasks.py` (inside `tasks_router`, before `return router`)
- Test: `homunculus-engine/tests/test_tasks_api.py` (append)

- [ ] **Step 1: Write the failing tests**

```python
def _create(client, headers=NURSE, **over):
    body = {"patient_id": "S-001", "title": "Pansuman",
            "due_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(), "target_role": "nurse", **over}
    return client.post("/tasks", json=body, headers=headers)


def _seen(client, patient="S-001"):
    _ingest(client, patient, "heart_rate", 80, datetime.now(timezone.utc) - timedelta(minutes=3))


class TestWriting:
    def test_needs_tasks_manage_and_a_person(self, client):
        _seen(client)
        assert _create(client, VIEWER).status_code == 403
        assert _create(client, DEVICE).status_code == 403

    def test_creates_lists_and_audits(self, client):
        _seen(client)
        r = _create(client)
        assert r.status_code == 201, r.text
        task = r.json()
        assert task["state"] == "open" and task["late"] is False and task["created_by"] == "hem.ayse"
        assert task["title"] == "Pansuman"
        assert [t["id"] for t in _card(client, "S-001")["tasks"]] == [task["id"]]
        rows = client.app.state.audit.records(tenant="h1", event_type="task_created", limit=10)
        assert rows and rows[-1].payload == {"task": task["id"], "patient_id": "S-001", "due_at": task["due_at"],
                                              "target_role": "nurse", "actor": "hem.ayse"}

    def test_refusals(self, client):
        _seen(client)
        assert _create(client, title="").status_code == 422
        assert _create(client, title="x" * 201).status_code == 422
        assert _create(client, due_at=(datetime.now(timezone.utc) - timedelta(hours=25)).isoformat()).status_code == 422
        assert _create(client, due_at=(datetime.now(timezone.utc) + timedelta(days=8)).isoformat()).status_code == 422
        assert _create(client, target_role="vet").status_code == 422
        assert _create(client, patient_id="S-404").status_code == 404        # not on the caller's board

    def test_claim_done_skip_and_409_after_closing(self, client):
        _seen(client)
        task = _create(client).json()
        r = client.post(f"/tasks/{task['id']}/claim", headers=NURSE)
        assert r.status_code == 200 and r.json()["claimed_by"] == "hem.ayse"
        r = client.post(f"/tasks/{task['id']}/done", headers=NURSE)
        assert r.status_code == 200 and r.json()["state"] == "done" and r.json()["closed_by"] == "hem.ayse"
        r = client.post(f"/tasks/{task['id']}/done", headers=NURSE)
        assert r.status_code == 409 and r.json()["detail"]["code"] == TASK_NOT_OPEN
        other = _create(client).json()
        r = client.post(f"/tasks/{other['id']}/skip", json={"reason": "hasta ameliyatta"}, headers=NURSE)
        assert r.status_code == 200 and r.json()["state"] == "skipped"
        assert client.post(f"/tasks/{other['id']}/skip", json={"reason": "x"}, headers=NURSE).status_code == 409
        assert client.post("/tasks/nope/done", headers=NURSE).status_code == 404
        kinds = [r.event_type for r in client.app.state.audit.records(tenant="h1", limit=1000)]
        assert kinds.count("task_claimed") == 1 and kinds.count("task_done") == 1 and kinds.count("task_skipped") == 1

    def test_skip_reason_is_required_and_bounded(self, client):
        _seen(client)
        task = _create(client).json()
        assert client.post(f"/tasks/{task['id']}/skip", json={"reason": ""}, headers=NURSE).status_code == 422
        assert client.post(f"/tasks/{task['id']}/skip", json={"reason": "x" * 201}, headers=NURSE).status_code == 422

    def test_skipping_the_vital_task_hides_it_for_one_interval(self, client, store):
        at = datetime.now(timezone.utc) - timedelta(hours=13)
        _chart(client, "S-001", [{"code": "resp_rate", "value": 16}], at)          # b0, due 1 h ago → late
        assert _card(client, "S-001")["vital"]["state"] == "late"
        r = client.post("/tasks/vitals/S-001/skip", json={"reason": "hasta görüntülemede"}, headers=NURSE)
        assert r.status_code == 200, r.text
        until = r.json()["skipped_until"]
        assert until == (at + timedelta(minutes=1440)).isoformat()                 # the due point after the current one
        vital = _card(client, "S-001")["vital"]
        assert vital["state"] == "skipped" and vital["due_at"] == until
        rows = client.app.state.audit.records(tenant="h1", event_type="vital_skipped", limit=5)
        assert rows[-1].payload == {"patient_id": "S-001", "until": until, "actor": "hem.ayse"}

    def test_skipping_a_vital_task_that_is_not_due_is_409(self, client):
        at = datetime.now(timezone.utc) - timedelta(minutes=5)
        _chart(client, "S-001", [{"code": "resp_rate", "value": 16}], at)          # plan
        assert client.post("/tasks/vitals/S-001/skip", json={"reason": "x"}, headers=NURSE).status_code == 409
        _seen(client, "S-003")                                                       # unknown anchor
        assert client.post("/tasks/vitals/S-003/skip", json={"reason": "x"}, headers=NURSE).status_code == 409
```

- [ ] **Step 2: Run it to see it fail**

Run: `… -m pytest -p no:cacheprovider -q tests/test_tasks_api.py 2>&1 | tail -3`
Expected: FAIL — 405 on `POST /tasks`.

- [ ] **Step 3: Append the write routes inside `tasks_router` (before `return router`)**

```python
    def _text(raw, code: str) -> str:
        if not isinstance(raw, str) or not raw.strip() or len(raw) > TITLE_MAX:
            raise _refuse(422, code)
        return raw.strip()

    async def _on_board(authorization: str | None, patient_id: str) -> tuple[Caller, dict]:
        who, cards = await board(authorization, TASKS_VIEW)
        _require(who, TASKS_MANAGE)
        for card in cards:
            if card["patient_id"] == patient_id:
                return who, card
        raise HTTPException(status_code=404, detail=PATIENT_NOT_FOUND)

    def _event(hospital: str, kind: str, patient_id: str, subject: str, payload: dict) -> None:
        audit.append(AuditEvent(hospital, kind, patient_id, subject, payload))

    @router.post("/tasks", status_code=201)
    async def create_task(body: dict = Body(...), authorization: str | None = Header(default=None)):
        patient_id = body.get("patient_id")
        if not isinstance(patient_id, str) or not patient_id:
            raise HTTPException(status_code=422, detail="patient_id is required")
        who, _ = await _on_board(authorization, patient_id)
        actor = _person(who)
        now = clock()
        title = _text(body.get("title"), TASK_TITLE_LENGTH)
        due_at = _instant(body.get("due_at"))
        if due_at is None or not (now - DUE_BACK <= due_at <= now + DUE_AHEAD):
            raise _refuse(422, TASK_DUE_WINDOW)
        role = body.get("target_role")
        if role not in TARGET_ROLES:
            raise _refuse(422, TASK_ROLE_UNKNOWN)
        settings, _ = _settings(who.hospital)
        row = store.create(new_task(tenant=who.hospital, patient_id=patient_id, title=title, due_at=due_at,
                                    target_role=role, created_by=actor, now=now))
        answer = row.as_dict(grace_min=settings.grace_min, now=now)
        _event(who.hospital, "task_created", patient_id, row.id,
               {"task": row.id, "patient_id": patient_id, "due_at": answer["due_at"], "target_role": role, "actor": actor})
        return answer

    async def _open_task(authorization: str | None, task_id: str) -> tuple[Caller, TaskRow, TaskSettings, datetime]:
        who = await caller(authorization)
        _require(who, TASKS_VIEW)
        _require(who, TASKS_MANAGE)
        row = store.get(who.hospital, task_id)
        if row is None:
            raise HTTPException(status_code=404, detail=TASK_NOT_FOUND)
        await _on_board(authorization, row.patient_id)      # 404 when the patient left the caller's board
        if row.state != "open":
            raise _refuse(409, TASK_NOT_OPEN)
        settings, _ = _settings(who.hospital)
        return who, row, settings, clock()

    @router.post("/tasks/{task_id}/claim")
    async def claim_task(task_id: str, authorization: str | None = Header(default=None)):
        who, row, settings, now = await _open_task(authorization, task_id)
        actor = _person(who)
        saved = store.update(replace(row, claimed_by=actor, claimed_at=now))
        _event(who.hospital, "task_claimed", row.patient_id, row.id, {"task": row.id, "actor": actor})
        return saved.as_dict(grace_min=settings.grace_min, now=now)

    @router.post("/tasks/{task_id}/done")
    async def finish_task(task_id: str, authorization: str | None = Header(default=None)):
        who, row, settings, now = await _open_task(authorization, task_id)
        actor = _person(who)
        saved = store.update(replace(row, state="done", closed_by=actor, closed_at=now))
        _event(who.hospital, "task_done", row.patient_id, row.id, {"task": row.id, "actor": actor})
        return saved.as_dict(grace_min=settings.grace_min, now=now)

    @router.post("/tasks/{task_id}/skip")
    async def skip_task(task_id: str, body: dict = Body(...), authorization: str | None = Header(default=None)):
        who, row, settings, now = await _open_task(authorization, task_id)
        actor = _person(who)
        reason = _text(body.get("reason"), TASK_REASON_LENGTH)
        saved = store.update(replace(row, state="skipped", closed_by=actor, closed_at=now, skip_reason=reason))
        _event(who.hospital, "task_skipped", row.patient_id, row.id, {"task": row.id, "actor": actor})
        return saved.as_dict(grace_min=settings.grace_min, now=now)

    @router.post("/tasks/vitals/{patient_id}/skip")
    async def skip_vital(patient_id: str, body: dict = Body(...), authorization: str | None = Header(default=None)):
        who, card = await _on_board(authorization, patient_id)
        actor = _person(who)
        reason = _text(body.get("reason"), TASK_REASON_LENGTH)   # kept out of the chain (D7); the event is the record
        now = clock()
        settings, _ = _settings(who.hospital)
        current = _vital(who.hospital, card, settings, now, now, now)
        if current is None or current["state"] not in ("due", "late"):
            raise _refuse(409, VITAL_NOT_DUE)
        until = _instant(current["due_at"]) + timedelta(minutes=current["interval_min"])
        _event(who.hospital, VITAL_SKIPPED, patient_id, "vital", {"patient_id": patient_id, "until": _iso(until), "actor": actor})
        log.info("vital measurement skipped by %s for one interval (reason length %d)", actor, len(reason))
        return {"patient_id": patient_id, "skipped_until": _iso(until)}
```

- [ ] **Step 4: Run the API tests**

Run: `… -m pytest -p no:cacheprovider -q tests/test_tasks_api.py tests/test_route_inventory.py 2>&1 | tail -3`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g3-gorevler && git add homunculus-engine/src/homunculus/api/tasks.py homunculus-engine/tests/test_tasks_api.py && git commit -m "feat(tasks): write a task, claim, close, skip; skip a vital measurement for one interval — audited (G3-02 D6, D7, D11)"
```

---

### Task 6: The settings routes

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/tasks.py` (inside `tasks_router`, before `return router`)
- Test: `homunculus-engine/tests/test_tasks_api.py` (append)

- [ ] **Step 1: Write the failing tests**

```python
class TestSettings:
    def test_defaults_until_saved_structure_manage_only(self, client):
        assert client.get("/tasks/settings", headers=NURSE).status_code == 403
        r = client.get("/tasks/settings", headers=ADMIN)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["configured"] is False and body["shift_start_a"] == 8 and body["shift_start_b"] == 20
        assert body["grace_min"] == 30 and body["intervals"] == DEFAULT_SETTINGS.intervals
        assert body["default_source"] == {"b0": "news2-rcp-2017"}

    def test_put_validates_saves_and_audits(self, client):
        good = {"shift_start_a": 8, "shift_start_b": 20, "grace_min": 45,
                "intervals": {"b0": 720, "b1_4": 360, "b3_single": 60, "b5_6": 60, "b7": 30}}
        r = client.put("/tasks/settings", json=good, headers=ADMIN)
        assert r.status_code == 200, r.text
        assert r.json()["configured"] is True and r.json()["grace_min"] == 45 and r.json()["updated_by"] == "admin.lbys"
        assert client.get("/tasks/settings", headers=ADMIN).json()["intervals"]["b1_4"] == 360
        assert client.put("/tasks/settings", json={**good, "shift_start_b": 8}, headers=ADMIN).status_code == 422
        assert client.put("/tasks/settings", json={**good, "grace_min": 241}, headers=ADMIN).status_code == 422
        assert client.put("/tasks/settings", json={**good, "intervals": {**good["intervals"], "b7": 4}}, headers=ADMIN).status_code == 422
        assert client.put("/tasks/settings", json={**good, "intervals": {"b0": 720}}, headers=ADMIN).status_code == 422
        rows = client.app.state.audit.records(tenant="h1", event_type="task_settings_changed", limit=5)
        assert rows[-1].payload["actor"] == "admin.lbys" and rows[-1].payload["after"]["grace_min"] == 45
        assert rows[-1].payload["before"]["grace_min"] == 30

    def test_the_queue_uses_the_saved_intervals(self, client):
        client.put("/tasks/settings", json={"shift_start_a": 8, "shift_start_b": 20, "grace_min": 30,
                                            "intervals": {"b0": 720, "b1_4": None, "b3_single": 60, "b5_6": None, "b7": None}},
                   headers=ADMIN)
        at = datetime.now(timezone.utc) - timedelta(minutes=5)
        _chart(client, "S-001", [{"code": "resp_rate", "value": 26}], at)          # b3_single, now 60 min
        vital = _card(client, "S-001")["vital"]
        assert vital["band"] == "b3_single" and vital["interval_min"] == 60 and vital["state"] == "plan"
```

- [ ] **Step 2: Run it to see it fail**

Run: `… -m pytest -p no:cacheprovider -q tests/test_tasks_api.py 2>&1 | tail -3`
Expected: FAIL — 404 on `/tasks/settings`.

- [ ] **Step 3: Append the settings routes inside `tasks_router`**

```python
    @router.get("/tasks/settings")
    async def read_settings(authorization: str | None = Header(default=None)):
        who = await caller(authorization)
        _require(who, STRUCTURE_MANAGE)
        settings, configured = _settings(who.hospital)
        return settings.as_dict(configured)

    @router.put("/tasks/settings")
    async def write_settings(body: dict = Body(...), authorization: str | None = Header(default=None)):
        who = await caller(authorization)
        _require(who, STRUCTURE_MANAGE)
        actor = _person(who)
        intervals = body.get("intervals")
        if not isinstance(intervals, dict):
            raise _refuse(422, TASK_SETTINGS_RANGE)
        wanted = TaskSettings(shift_start_a=body.get("shift_start_a"), shift_start_b=body.get("shift_start_b"),
                              grace_min=body.get("grace_min"), intervals={k: intervals.get(k) for k in intervals})
        code = wanted.refusal()
        if code is not None:
            raise _refuse(422, code)
        before, _ = _settings(who.hospital)
        now = clock()
        saved = store.save_settings(who.hospital, wanted, by=actor, now=now)
        _event(who.hospital, "task_settings_changed", "", "settings",
               {"actor": actor, "before": before.as_dict(True), "after": saved.as_dict(True)})
        return saved.as_dict(True)
```

- [ ] **Step 4: Run the engine API tests and the whole no-DB suite**

Run the three task test files, then the whole no-DB suite. Expected: PASS; the whole suite = baseline + the new tests, 0 failed.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g3-gorevler && git add homunculus-engine/src/homunculus/api/tasks.py homunculus-engine/tests/test_tasks_api.py && git commit -m "feat(tasks): GET|PUT /tasks/settings — the hospital's intervals, shifts and grace, audited (G3-02 D10)"
```

---

### Task 7: Migration 0017 and the Postgres store

**Files:**
- Create: `homunculus-engine/alembic/versions/0017_tasks.py`
- Create: `homunculus-engine/src/homunculus/api/tasks_postgres.py`
- Modify: `homunculus-engine/src/homunculus/api/prodserver.py` (a `_tasks(url)` builder beside `_samples` ~line 481; the `create_app(...)` call ~line 518)
- Test: `homunculus-engine/tests/test_tasks_postgres.py`

- [ ] **Step 1: Write the failing test**

```python
# homunculus-engine/tests/test_tasks_postgres.py
"""G3-02: migration 0017 and the Postgres task store — round trip, encryption at rest, the settings
row, the permission statement, the downgrade. Runs only with TEST_DATABASE_URL (the disposable container)."""
from datetime import datetime, timedelta, timezone

import pytest
from alembic import command
from sqlalchemy import create_engine, text

from homunculus.api.audit_postgres import to_sync_url
from homunculus.api.tasks import DEFAULT_SETTINGS, TaskRow, TaskSettings, new_task
from homunculus.api.tasks_postgres import PostgresTaskStore
from tests.conftest import TEST_DATABASE_URL, requires_db

pytestmark = [requires_db]
T0 = datetime(2026, 11, 9, 10, 0, tzinfo=timezone.utc)


@pytest.fixture()
def migrated(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    sync = create_engine(to_sync_url(TEST_DATABASE_URL))
    with sync.begin() as conn:
        # The tenants table's NOT NULL columns: read tenant/models.py before trusting this list.
        conn.execute(text("INSERT INTO tenants (id, slug, name, timezone, created_at, updated_at) "
                          "VALUES (gen_random_uuid(), 'h1', 'H1', 'Asia/Baku', now(), now())"))
    yield sync
    sync.dispose()


def test_round_trip_and_encryption_at_rest(migrated):
    store = PostgresTaskStore(TEST_DATABASE_URL)
    try:
        row = store.create(new_task(tenant="h1", patient_id="S-001", title="Pansuman · sağ kol", due_at=T0,
                                    target_role="nurse", created_by="hem.ayse", now=T0))
        assert store.get("h1", row.id) == row
        assert store.list("h1", since=T0 - timedelta(hours=1), until=T0 + timedelta(hours=1), patient_ids={"S-001"}) == [row]
        with migrated.connect() as conn:
            stored = conn.execute(text("SELECT title FROM tasks WHERE id = CAST(:id AS uuid)"), {"id": row.id}).scalar_one()
        assert stored.startswith("enc::v1::") and "Pansuman" not in stored
        closed = store.update(TaskRow(**{**row.__dict__, "state": "skipped", "closed_by": "hem.ayse", "closed_at": T0,
                                         "skip_reason": "ameliyatta"}))
        assert store.get("h1", row.id) == closed
        assert store.settings("h1") is None
        saved = store.save_settings("h1", TaskSettings(8, 20, 45, {**DEFAULT_SETTINGS.intervals, "b7": 30}), by="admin", now=T0)
        assert store.settings("h1") == saved and saved.intervals["b7"] == 30 and saved.intervals["b1_4"] is None
        assert store.timezone("h1") == "Asia/Baku" and store.timezone("h9") == "UTC"
        assert store.admitted_at("h1", "S-001") is None
    finally:
        store.close()


def test_the_permission_statement_is_idempotent(migrated):
    with migrated.begin() as conn:
        conn.execute(text("INSERT INTO groups (id, tenant_id, slug, name, description, mfa_required, is_system, created_at, updated_at) "
                          "SELECT gen_random_uuid(), id, 'nurse', 'Hemşire', '', false, false, now(), now() FROM tenants WHERE slug = 'h1'"))
        for _ in range(2):
            conn.execute(text("INSERT INTO group_permissions (group_id, permission) SELECT id, 'tasks.view' FROM groups "
                              "WHERE slug IN ('nurse','charge_nurse','physician','unit_physician','attending','rapid_response') "
                              "ON CONFLICT DO NOTHING"))
        n = conn.execute(text("SELECT count(*) FROM group_permissions WHERE permission = 'tasks.view'")).scalar_one()
    assert n == 1


def test_downgrade_drops_only_the_new_objects(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    command.downgrade(cfg, "0016")
    sync = create_engine(to_sync_url(TEST_DATABASE_URL))
    with sync.connect() as conn:
        names = {r[0] for r in conn.execute(text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'"))}
    sync.dispose()
    assert "tasks" not in names and "task_settings" not in names and "protocol_settings" in names
```

- [ ] **Step 2: Run it to see it fail**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test … -m pytest -p no:cacheprovider -q tests/test_tasks_postgres.py 2>&1 | tail -3`
Expected: FAIL — `ModuleNotFoundError: homunculus.api.tasks_postgres`.

- [ ] **Step 3: Write the migration**

```python
# homunculus-engine/alembic/versions/0017_tasks.py
"""G3-02 Görevlerim (spec D6, D8, D10): `tasks`, `task_settings`, and the two permission rows.

Revision 0017, follows B3a's 0016 (bed_occupancy).
* `tasks`: one row per hand-written task. Keyed by the tenant SLUG (`tenant`), as `patient_identity`
  and the audit rows are — this table lives in the api world, not the admission world. `title` and
  `skip_reason` hold Fernet ciphertext (`crypto.encrypt_phi`); people are usernames.
* `task_settings`: one row per tenant — the two shift starts, the grace, the interval per NEWS2 band
  (NULL = not configured → no vital task). No row = the defaults; only `b0 = 720` has a vault source.
* `group_permissions`: `tasks.view` and `tasks.manage` for the six default groups that do the work, in
  every tenant (as 0012 did for `beds.release`). `ensure_default_groups` creates missing groups only.
PURELY ADDITIVE: an image from before this revision serves against it. Downgrade drops exactly this.
ONE STATEMENT PER op.execute (asyncpg).

Revision ID: 0017
Revises: 0016
Create Date: 2026-11-09
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0017"
down_revision: Union[str, None] = "0016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

GROUPS = "('nurse','charge_nurse','physician','unit_physician','attending','rapid_response')"
KEYS = ("tasks.view", "tasks.manage")


def upgrade() -> None:
    op.create_table(
        "tasks",
        sa.Column("id", UUID(as_uuid=False), primary_key=True),
        sa.Column("tenant", sa.String(64), nullable=False),
        sa.Column("patient_id", sa.String(64), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("target_role", sa.String(16), nullable=False),
        sa.Column("created_by", sa.String(128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("state", sa.String(16), nullable=False, server_default=sa.text("'open'")),
        sa.Column("claimed_by", sa.String(128), nullable=True),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_by", sa.String(128), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("skip_reason", sa.Text(), nullable=True),
        sa.CheckConstraint("target_role IN ('nurse','physician','any')", name="ck_tasks_role"),
        sa.CheckConstraint("state IN ('open','done','skipped')", name="ck_tasks_state"),
    )
    op.create_index("ix_tasks_tenant_due", "tasks", ["tenant", "due_at"])
    op.create_index("ix_tasks_tenant_patient", "tasks", ["tenant", "patient_id"])
    op.create_table(
        "task_settings",
        sa.Column("tenant", sa.String(64), primary_key=True),
        sa.Column("shift_start_a", sa.SmallInteger(), nullable=False, server_default=sa.text("8")),
        sa.Column("shift_start_b", sa.SmallInteger(), nullable=False, server_default=sa.text("20")),
        sa.Column("grace_min", sa.SmallInteger(), nullable=False, server_default=sa.text("30")),
        sa.Column("interval_b0", sa.Integer(), nullable=True, server_default=sa.text("720")),
        sa.Column("interval_b1_4", sa.Integer(), nullable=True),
        sa.Column("interval_b3_single", sa.Integer(), nullable=True),
        sa.Column("interval_b5_6", sa.Integer(), nullable=True),
        sa.Column("interval_b7", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_by", sa.String(128), nullable=True),
        sa.CheckConstraint("shift_start_a BETWEEN 0 AND 23 AND shift_start_b BETWEEN 0 AND 23 "
                           "AND shift_start_a <> shift_start_b", name="ck_task_settings_shifts"),
        sa.CheckConstraint("grace_min BETWEEN 0 AND 240", name="ck_task_settings_grace"),
    )
    for key in KEYS:
        op.execute(f"INSERT INTO group_permissions (group_id, permission) SELECT id, '{key}' FROM groups "
                   f"WHERE slug IN {GROUPS} ON CONFLICT DO NOTHING")


def downgrade() -> None:
    for key in KEYS:
        op.execute(f"DELETE FROM group_permissions WHERE permission = '{key}'")
    op.drop_table("task_settings")
    op.drop_index("ix_tasks_tenant_patient", table_name="tasks")
    op.drop_index("ix_tasks_tenant_due", table_name="tasks")
    op.drop_table("tasks")
```

- [ ] **Step 4: Write the Postgres store**

```python
# homunculus-engine/src/homunculus/api/tasks_postgres.py
"""The task store in the managed database (G3-02): `tasks` and `task_settings` from migration 0017,
the tenant's time zone from `tenants`, the admission time of a board key from `admissions` +
`patients`. A sync engine and `text()` SQL, bounded like the identity store, so a silent database
fails the request in seconds. `title` and `skip_reason` are Fernet ciphertext at rest."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import create_engine, text

from homunculus.api.audit_postgres import POOL_TIMEOUT_S, bounded_connect_args, to_sync_url
from homunculus.api.tasks import BAND_KEYS, TaskRow, TaskSettings
from homunculus.crypto import decrypt_phi, encrypt_phi

STATEMENT_TIMEOUT_MS = 2000
_COLUMNS = ("id", "tenant", "patient_id", "title", "due_at", "target_role", "created_by", "created_at", "state",
            "claimed_by", "claimed_at", "closed_by", "closed_at", "skip_reason")
_SELECT = "SELECT " + ", ".join(_COLUMNS) + " FROM tasks"
#: admission/models.py OPEN_ADMISSION_STATES, as the enum's values
_OPEN_STATES = "('DRAFT','ACTIVE','PENDING_DISCHARGE','PENDING_TRANSFER')"


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
        with self._engine.connect() as conn:
            r = conn.execute(text(_SELECT + " WHERE tenant = :tenant AND id = CAST(:id AS uuid)"),
                             {"tenant": tenant, "id": task_id}).mappings().first()
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
        with self._engine.begin() as conn:
            done = conn.execute(text(
                "UPDATE tasks SET state = :state, claimed_by = :claimed_by, claimed_at = :claimed_at, closed_by = :closed_by, "
                "closed_at = :closed_at, skip_reason = :skip_reason WHERE tenant = :tenant AND id = CAST(:id AS uuid)"),
                {"state": row.state, "claimed_by": row.claimed_by, "claimed_at": row.claimed_at, "closed_by": row.closed_by,
                 "closed_at": row.closed_at, "skip_reason": encrypt_phi(row.skip_reason) if row.skip_reason else None,
                 "tenant": row.tenant, "id": row.id})
            if done.rowcount != 1:
                raise KeyError(row.id)
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
        with self._engine.connect() as conn:
            return conn.execute(text(
                "SELECT a.admission_datetime FROM admissions a JOIN patients p ON p.id = a.patient_id "
                "JOIN tenants t ON t.id = a.tenant_id WHERE t.slug = :tenant AND CAST(a.state AS text) IN " + _OPEN_STATES +
                " AND (a.protocol_no = :key OR (a.protocol_no IS NULL AND p.patient_number = :key)) "
                "ORDER BY a.admission_datetime DESC LIMIT 1"), {"tenant": tenant, "key": patient_id}).scalar_one_or_none()

    def timezone(self, tenant: str) -> str:
        with self._engine.connect() as conn:
            zone = conn.execute(text("SELECT timezone FROM tenants WHERE slug = :tenant"), {"tenant": tenant}).scalar_one_or_none()
        return zone or "UTC"

    def close(self) -> None:
        self._engine.dispose()
```

- [ ] **Step 5: Wire production**

In `prodserver.py`, read `_samples(url)` (~481–492) and add beside it, copying `_samples`' exact production condition:
```python
def _tasks(url: str) -> TaskStore:
    """The task queue's rows (G3-02): Postgres in production, in memory elsewhere — `_samples`' rule."""
    if not _is_production():
        return InMemoryTaskStore()
    return PostgresTaskStore(url, ssl_required=os.getenv("DATABASE_SSL", "").lower() in ("require", "true", "1"))
```
Imports: `from homunculus.api.tasks import InMemoryTaskStore, TaskStore` and `from homunculus.api.tasks_postgres import PostgresTaskStore`. In the `create_app(...)` call add `tasks=_tasks(_database_url()),` after `device_beds=…`.

- [ ] **Step 6: Run the Postgres tests and the no-DB suite**

Run: `TEST_DATABASE_URL=… … -m pytest -p no:cacheprovider -q tests/test_tasks_postgres.py tests/test_migration_0015_protocol.py 2>&1 | tail -3`, then the whole no-DB suite.
Expected: PASS. If the `tenants` INSERT in the fixture fails on a NOT NULL column, add that column with a literal and note it in the commit message.

- [ ] **Step 7: Commit (the untracked 0016 stays out)**

```bash
cd /c/tmp/g3-gorevler && git add homunculus-engine/alembic/versions/0017_tasks.py homunculus-engine/src/homunculus/api/tasks_postgres.py homunculus-engine/src/homunculus/api/prodserver.py homunculus-engine/tests/test_tasks_postgres.py && git status --porcelain | grep 0016 && git commit -m "feat(tasks): migration 0017 (tasks, task_settings, permission rows) and the Postgres task store; prodserver wiring (G3-02 D6, D8, D10)"
```
`grep 0016` must print the `??` line (still untracked).

---

### Task 8: Engine gates

- [ ] **Step 1:** Whole no-DB suite — expected: baseline + the new tests, 0 failed.
- [ ] **Step 2:** Postgres gate — `TEST_DATABASE_URL=… tests/test_tasks_postgres.py tests/test_protocol_settings.py tests/test_bedside_trail_stores.py` — expected PASS.
- [ ] **Step 3:** Python 3.14 slice — run the four new test files with the 3.14 interpreter G3-01's plan names (grep `py314` in `docs/superpowers/plans/2026-11-02-g3-yatak-basi-olcum.md`); if no 3.14 venv exists on this machine, write `3.14: not available` in Task 16's record.
- [ ] **Step 4:** No commit unless a fix was needed; write the numbers down for Task 16.


---

## Dashboard (Tasks 9–15 may run in a second worktree on branch `feat/g3-gorevlerim-web`, created with `git -C /c/tmp/g3-gorevler worktree add -b feat/g3-gorevlerim-web /c/tmp/g3-gorevler-web HEAD` after Task 8 is pushed, and merged back with `git merge --no-ff feat/g3-gorevlerim-web` in Task 16. The two sides touch disjoint files except `deploy/local/web/nginx.conf` (Task 4, engine side only).)

### Task 9: API client methods, the fake API, the dev proxy

**Files:**
- Modify: `dashboard/src/backendApi.js` (after `saveProtocolSettings`, ~line 926)
- Modify: `dashboard/src/live/session/testTokens.testutil.js` (after the G3-01 lines ~70–71)
- Modify: `dashboard/vite.config.js` (the proxy list ~lines 79–105)
- Test: `dashboard/src/backendApi.test.js` (append), `dashboard/src/devProxy.test.js` (runs as is)

- [ ] **Step 1: Write the failing test**

Append to `dashboard/src/backendApi.test.js` (reuse its `jsonResponse` and `signedIn` helpers; read lines 1–40 and ~328 first):
```js
describe("G3-02 Görevlerim calls", () => {
  it("reads the queue, writes a task and its three verbs, skips a vital and reads/saves the settings", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const api = signedIn(fetchMock);
    await api.tasks();
    await api.tasks("2026-11-09T04:00:00Z", "2026-11-10T04:00:00Z");
    await api.createTask({ patient_id: "S-001", title: "Pansuman", due_at: "2026-11-09T12:00:00Z", target_role: "nurse" });
    await api.claimTask("t-1");
    await api.doneTask("t-1");
    await api.skipTask("t-1", "ameliyatta");
    await api.skipVitalTask("S-001", "görüntülemede");
    await api.taskSettings();
    await api.saveTaskSettings({ grace_min: 30 });
    const calls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/tasks")).map(([url, init]) => [String(url), init.method ?? "GET"]);
    expect(calls).toEqual([
      ["/tasks", "GET"],
      ["/tasks?from=2026-11-09T04%3A00%3A00Z&to=2026-11-10T04%3A00%3A00Z", "GET"],
      ["/tasks", "POST"], ["/tasks/t-1/claim", "POST"], ["/tasks/t-1/done", "POST"], ["/tasks/t-1/skip", "POST"],
      ["/tasks/vitals/S-001/skip", "POST"], ["/tasks/settings", "GET"], ["/tasks/settings", "PUT"],
    ]);
    expect(JSON.parse(fetchMock.mock.calls.find(([url]) => String(url).endsWith("/t-1/skip"))[1].body)).toEqual({ reason: "ameliyatta" });
  });
});
```
If `signedIn` builds the api with a non-empty `baseUrl`, prefix the expected URLs with it (read the helper).

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/tmp/g3-gorevler/dashboard && ./node_modules/.bin/vitest run src/backendApi.test.js 2>&1 | tail -5`
Expected: FAIL — `api.tasks is not a function`.

- [ ] **Step 3: Add the methods**

In `backendApi.js`, after `saveProtocolSettings(...)`:
```js
    // G3-02: Görevlerim — the task queue, its writes and the hospital's settings (homunculus/api/tasks.py).
    tasks(from = null, to = null) {
      const q = new URLSearchParams();
      if (from) q.set("from", from);
      if (to) q.set("to", to);
      const s = q.toString();
      return authed(`/tasks${s ? `?${s}` : ""}`);
    },
    createTask(body) { return authed("/tasks", { method: "POST", body }); },
    claimTask(id) { return authed(`/tasks/${seg(id)}/claim`, { method: "POST" }); },
    doneTask(id) { return authed(`/tasks/${seg(id)}/done`, { method: "POST" }); },
    skipTask(id, reason) { return authed(`/tasks/${seg(id)}/skip`, { method: "POST", body: { reason } }); },
    skipVitalTask(patientId, reason) { return authed(`/tasks/vitals/${seg(patientId)}/skip`, { method: "POST", body: { reason } }); },
    taskSettings() { return authed("/tasks/settings"); },
    saveTaskSettings(body) { return authed("/tasks/settings", { method: "PUT", body }); },
```
In `testTokens.testutil.js` `fakeApi`, after `retractEntry: vi.fn(),` (keep the blank line after the block):
```js
    // G3-02: Görevlerim — the queue, its writes and the settings tab
    tasks: vi.fn(),
    createTask: vi.fn(),
    claimTask: vi.fn(),
    doneTask: vi.fn(),
    skipTask: vi.fn(),
    skipVitalTask: vi.fn(),
    taskSettings: vi.fn(),
    saveTaskSettings: vi.fn(),
```
In `vite.config.js` proxy list, after `"/infinity-waves",    // Lane C (dalga): …`:
```js
      "/tasks",             // G3-02: Görevlerim — the queue and its settings
```

- [ ] **Step 4: Run the client, proxy and session tests**

Run: `./node_modules/.bin/vitest run src/backendApi.test.js src/devProxy.test.js src/live/session 2>&1 | tail -5`
Expected: PASS (devProxy compares nginx.conf — already extended in Task 4 — with the Vite list).

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g3-gorevler && git add dashboard/src/backendApi.js dashboard/src/backendApi.test.js dashboard/src/live/session/testTokens.testutil.js dashboard/vite.config.js && git commit -m "feat(dashboard): Görevlerim API calls, fake API lines and the /tasks dev proxy (G3-02)"
```

---

### Task 10: The i18n namespace

**Files:**
- Create: `dashboard/src/live/i18n/strings/gorevler.js`
- Modify: `dashboard/src/live/i18n/catalog.js` (import line after `olcum`; `NAMESPACES` entry after `olcum, // G3-01`)
- Test: `dashboard/src/live/i18n/strings.test.js` (runs as is)

- [ ] **Step 1: Write the namespace** — TR is the source; AZ, RU, EN carry every key (strings.test enforces same keys, non-empty, same `{placeholders}`, AZ ≠ TR unless listed, RU in Cyrillic).

```js
// src/live/i18n/strings/gorevler.js — Görevlerim (G3-02): the task queue screen, its dialogs, the
// Yönetim › Görevler settings tab. TR is the source. AZ, RU and EN await a native reading.
export default {
  tr: {
    nav: "Görevlerim", navShort: "Görevler",
    title: "Görevlerim",
    intro: "Bu nöbetin işleri: elle açılan görevler ve bir sonraki vital ölçüm. Vital aralığını hastane belirler; boş bant görev üretmez.",
    shift: "Nöbet {start} → {end} · {count} hasta",
    counterLate: "Geciken", counterDue: "Şimdi", counterPlan: "Kalan (planlı)", counterDone: "Tamamlanan",
    modeGrid: "Izgara", modeList: "Liste", modeLabel: "Görünüm",
    kindAll: "Tümü", kindVital: "Vital", kindHand: "Elle", kindLabel: "Tür",
    onlyLate: "Yalnız gecikenler", onlyMine: "Yalnız benim rolüm",
    gotoNow: "Şimdiye git", now: "şimdi",
    legend: "Açıklama",
    stateDone: "tamamlandı", stateLate: "gecikti", stateDue: "şimdi", statePlan: "planlı", stateSkipped: "uygulanmadı",
    stateUnknown: "ölçüm kaydı yok", stateOpen: "açık",
    vitalRow: "Vital ölçüm", vitalPartial: "eksik skorla", vitalBand: "NEWS2 bandı {band} · {minutes} dk",
    vitalDue: "Ölçüm vadesi {time}", vitalAnchor: "Son elle ölçüm {time}", vitalAnchorAdmission: "Dayanak: kabul zamanı {time}",
    vitalSkippedUntil: "{time} saatine kadar atlandı",
    empty: "Bu süzgeçle iş yok.", listHidesDone: "Liste görünümünde tamamlananlar gizlidir; ızgarada görünür.",
    noPatients: "Birimlerinizde yatan hasta yok.",
    newTask: "Görev ekle", newTitle: "Yeni görev",
    fieldPatient: "Hasta", fieldText: "Görev", fieldTextHint: "En çok 200 karakter; hasta adı yazmayın, yatak yeter.",
    fieldDue: "Vade", fieldDueHint: "En çok 24 saat geriye, 7 gün ileriye.", fieldRole: "Kime",
    roleNurse: "Hemşire", rolePhysician: "Hekim", roleAny: "Herkes",
    save: "Kaydet", cancel: "Vazgeç", close: "Kapat",
    taskTitle: "{title} · {bed}", vitalTitle: "Vital ölçüm · {bed}",
    claim: "Üstlen", finish: "Tamamla", skip: "Uygulanmadı", skipReason: "Neden", skipReasonHint: "En çok 200 karakter; denetim kaydına yalnız olay yazılır, metin yazılmaz.",
    skipConfirm: "Uygulanmadı olarak kaydet", skipVitalConfirm: "Bu aralık için atla",
    claimedBy: "üstlenen: {who}", createdBy: "açan: {who} · {time}", closedBy: "kapatan: {who} · {time}",
    readOnly: "Görev yazma yetkiniz yok; ekran salt okunur.",
    created: "Görev eklendi.", claimed: "Görev üstlenildi.", finished: "Görev tamamlandı.", skipped: "Görev «uygulanmadı» olarak kapandı.",
    vitalSkipped: "Vital ölçüm {time} saatine kadar atlandı.",
    readFailed: "Görevler okunamadı: {reason}", refused: "{subject}: {reason}",
    err: {
      titleLength: "Görev metni 1–200 karakter olmalı.",
      dueWindow: "Vade en çok 24 saat geriye ve 7 gün ileriye alınabilir.",
      role: "Hedef rol hemşire, hekim ya da herkes olmalı.",
      notOpen: "Görev zaten kapatılmış.",
      reasonLength: "Neden 1–200 karakter olmalı.",
      vitalNotDue: "Bu hasta için vadesi gelmiş vital ölçüm yok.",
      settingsRange: "Aralıklar 5–1440 dk, pay 0–240 dk, nöbet saatleri 0–23 ve birbirinden farklı olmalı.",
      taskNotFound: "Görev bulunamadı.",
      person: "Görevi bir kişi imzalar; bu kimlik bir kişiyi göstermiyor.",
    },
    settingsTab: "Görevler",
    settingsTitle: "Görevlerim ayarları",
    settingsIntro: "Nöbet başlangıçları, gecikme payı ve NEWS2 bandına göre vital ölçüm aralığı. Boş bırakılan bant için görev üretilmez.",
    shiftA: "1. nöbet başlangıcı (saat)", shiftB: "2. nöbet başlangıcı (saat)", grace: "Gecikme payı (dk)",
    intervalsTitle: "Vital ölçüm aralığı (dk)",
    bandB0: "NEWS2 0", bandB1_4: "NEWS2 1–4", bandB3single: "Tek parametrede 3", bandB5_6: "NEWS2 5–6", bandB7: "NEWS2 ≥ 7",
    bandEmpty: "boş = görev yok",
    sourceNote: "Puan 0 varsayılanı kasadaki NEWS2 kaynağından gelir (RCP 2017: en az 12 saatte bir gözlem). Diğer bantların aralığı hastanenin protokolüdür; burada girilir.",
    settingsSaved: "Görev ayarları kaydedildi.", settingsLoading: "Ayarlar okunuyor…", settingsReadFailed: "Ayarlar okunamadı: {reason}",
    settingsUnset: "Yalnız «NEWS2 0» bandının aralığı tanımlı; diğer bantlardaki hastalar için vital görevi düşmez.",
    settingsInvalid: "Değerleri kontrol edin: aralık 5–1440, pay 0–240, saatler 0–23 ve farklı.",
    settingsUpdated: "Son değişiklik {who} · {time}",
  },
  az: {
    nav: "Tapşırıqlarım", navShort: "Tapşırıqlar",
    title: "Tapşırıqlarım",
    intro: "Bu növbənin işləri: əl ilə açılan tapşırıqlar və növbəti vital ölçmə. Vital intervalını xəstəxana müəyyən edir; boş zolaq tapşırıq yaratmır.",
    shift: "Növbə {start} → {end} · {count} xəstə",
    counterLate: "Gecikən", counterDue: "İndi", counterPlan: "Qalan (planlı)", counterDone: "Tamamlanan",
    modeGrid: "Cədvəl", modeList: "Siyahı", modeLabel: "Görünüş",
    kindAll: "Hamısı", kindVital: "Vital", kindHand: "Əl ilə", kindLabel: "Növ",
    onlyLate: "Yalnız gecikənlər", onlyMine: "Yalnız mənim rolum",
    gotoNow: "İndiyə keç", now: "indi",
    legend: "İzah",
    stateDone: "tamamlandı", stateLate: "gecikdi", stateDue: "indi", statePlan: "planlı", stateSkipped: "tətbiq edilmədi",
    stateUnknown: "ölçmə qeydi yoxdur", stateOpen: "açıq",
    vitalRow: "Vital ölçmə", vitalPartial: "natamam balla", vitalBand: "NEWS2 zolağı {band} · {minutes} dəq",
    vitalDue: "Ölçmə vaxtı {time}", vitalAnchor: "Son əl ölçməsi {time}", vitalAnchorAdmission: "Əsas: qəbul vaxtı {time}",
    vitalSkippedUntil: "{time}-ə qədər ötürüldü",
    empty: "Bu süzgəclə iş yoxdur.", listHidesDone: "Siyahı görünüşündə tamamlananlar gizlidir; cədvəldə görünür.",
    noPatients: "Şöbələrinizdə yatan xəstə yoxdur.",
    newTask: "Tapşırıq əlavə et", newTitle: "Yeni tapşırıq",
    fieldPatient: "Xəstə", fieldText: "Tapşırıq", fieldTextHint: "Ən çox 200 simvol; xəstə adı yazmayın, çarpayı kifayətdir.",
    fieldDue: "Vaxt", fieldDueHint: "Ən çox 24 saat geriyə, 7 gün irəliyə.", fieldRole: "Kimə",
    roleNurse: "Tibb bacısı", rolePhysician: "Həkim", roleAny: "Hamı",
    save: "Yadda saxla", cancel: "İmtina", close: "Bağla",
    taskTitle: "{title} · {bed}", vitalTitle: "Vital ölçmə · {bed}",
    claim: "Öhdəyə götür", finish: "Tamamla", skip: "Tətbiq edilmədi", skipReason: "Səbəb", skipReasonHint: "Ən çox 200 simvol; audit qeydinə yalnız hadisə yazılır, mətn yazılmır.",
    skipConfirm: "Tətbiq edilmədi kimi qeyd et", skipVitalConfirm: "Bu interval üçün ötür",
    claimedBy: "öhdəsinə götürən: {who}", createdBy: "açan: {who} · {time}", closedBy: "bağlayan: {who} · {time}",
    readOnly: "Tapşırıq yazma icazəniz yoxdur; ekran yalnız oxunur.",
    created: "Tapşırıq əlavə edildi.", claimed: "Tapşırıq öhdəyə götürüldü.", finished: "Tapşırıq tamamlandı.", skipped: "Tapşırıq «tətbiq edilmədi» kimi bağlandı.",
    vitalSkipped: "Vital ölçmə {time}-ə qədər ötürüldü.",
    readFailed: "Tapşırıqlar oxuna bilmədi: {reason}", refused: "{subject}: {reason}",
    err: {
      titleLength: "Tapşırıq mətni 1–200 simvol olmalıdır.",
      dueWindow: "Vaxt ən çox 24 saat geriyə və 7 gün irəliyə ola bilər.",
      role: "Hədəf rol tibb bacısı, həkim və ya hamı olmalıdır.",
      notOpen: "Tapşırıq artıq bağlanıb.",
      reasonLength: "Səbəb 1–200 simvol olmalıdır.",
      vitalNotDue: "Bu xəstə üçün vaxtı çatmış vital ölçmə yoxdur.",
      settingsRange: "İntervallar 5–1440 dəq, pay 0–240 dəq, növbə saatları 0–23 və fərqli olmalıdır.",
      taskNotFound: "Tapşırıq tapılmadı.",
      person: "Tapşırığı bir şəxs imzalayır; bu kimlik şəxs göstərmir.",
    },
    settingsTab: "Tapşırıqlar",
    settingsTitle: "Tapşırıqlarım ayarları",
    settingsIntro: "Növbə başlanğıcları, gecikmə payı və NEWS2 zolağına görə vital ölçmə intervalı. Boş buraxılan zolaq üçün tapşırıq yaranmır.",
    shiftA: "1-ci növbənin başlanğıcı (saat)", shiftB: "2-ci növbənin başlanğıcı (saat)", grace: "Gecikmə payı (dəq)",
    intervalsTitle: "Vital ölçmə intervalı (dəq)",
    bandB0: "NEWS2 0 balı", bandB1_4: "NEWS2 1–4 bal", bandB3single: "Tək parametrdə 3", bandB5_6: "NEWS2 5–6 bal", bandB7: "NEWS2 ≥ 7 bal",
    bandEmpty: "boş = tapşırıq yoxdur",
    sourceNote: "0 balın defoltu anbardakı NEWS2 mənbəyindən gəlir (RCP 2017: ən azı 12 saatdan bir müşahidə). Digər zolaqların intervalı xəstəxananın protokoludur; burada daxil edilir.",
    settingsSaved: "Tapşırıq ayarları yadda saxlanıldı.", settingsLoading: "Ayarlar oxunur…", settingsReadFailed: "Ayarlar oxuna bilmədi: {reason}",
    settingsUnset: "Yalnız «NEWS2 0» zolağının intervalı təyin edilib; digər zolaqlardakı xəstələr üçün vital tapşırığı düşmür.",
    settingsInvalid: "Dəyərləri yoxlayın: interval 5–1440, pay 0–240, saatlar 0–23 və fərqli.",
    settingsUpdated: "Son dəyişiklik {who} · {time}",
  },
  ru: {
    nav: "Мои задачи", navShort: "Задачи",
    title: "Мои задачи",
    intro: "Работа этой смены: задачи, созданные вручную, и следующее измерение витальных показателей. Интервал задаёт больница; пустая полоса задач не создаёт.",
    shift: "Смена {start} → {end} · пациентов: {count}",
    counterLate: "Просрочено", counterDue: "Сейчас", counterPlan: "Осталось (план)", counterDone: "Выполнено",
    modeGrid: "Сетка", modeList: "Список", modeLabel: "Вид",
    kindAll: "Все", kindVital: "Витальные", kindHand: "Вручную", kindLabel: "Тип",
    onlyLate: "Только просроченные", onlyMine: "Только моя роль",
    gotoNow: "К текущему часу", now: "сейчас",
    legend: "Обозначения",
    stateDone: "выполнено", stateLate: "просрочено", stateDue: "сейчас", statePlan: "запланировано", stateSkipped: "не выполнено",
    stateUnknown: "нет записи измерения", stateOpen: "открыто",
    vitalRow: "Измерение витальных", vitalPartial: "неполный балл", vitalBand: "полоса NEWS2 {band} · {minutes} мин",
    vitalDue: "Срок измерения {time}", vitalAnchor: "Последнее ручное измерение {time}", vitalAnchorAdmission: "Основа: время поступления {time}",
    vitalSkippedUntil: "пропущено до {time}",
    empty: "По этому фильтру задач нет.", listHidesDone: "В списке выполненные скрыты; в сетке они видны.",
    noPatients: "В ваших отделениях нет пациентов.",
    newTask: "Добавить задачу", newTitle: "Новая задача",
    fieldPatient: "Пациент", fieldText: "Задача", fieldTextHint: "До 200 знаков; имя пациента не пишите, достаточно койки.",
    fieldDue: "Срок", fieldDueHint: "Не более 24 часов назад и 7 дней вперёд.", fieldRole: "Кому",
    roleNurse: "Медсестра", rolePhysician: "Врач", roleAny: "Все",
    save: "Сохранить", cancel: "Отмена", close: "Закрыть",
    taskTitle: "{title} · {bed}", vitalTitle: "Измерение витальных · {bed}",
    claim: "Взять", finish: "Выполнить", skip: "Не выполнено", skipReason: "Причина", skipReasonHint: "До 200 знаков; в журнал аудита пишется только событие, без текста.",
    skipConfirm: "Отметить как не выполнено", skipVitalConfirm: "Пропустить на этот интервал",
    claimedBy: "взял: {who}", createdBy: "создал: {who} · {time}", closedBy: "закрыл: {who} · {time}",
    readOnly: "У вас нет права писать задачи; экран только для чтения.",
    created: "Задача добавлена.", claimed: "Задача взята.", finished: "Задача выполнена.", skipped: "Задача закрыта как «не выполнено».",
    vitalSkipped: "Измерение витальных пропущено до {time}.",
    readFailed: "Не удалось прочитать задачи: {reason}", refused: "{subject}: {reason}",
    err: {
      titleLength: "Текст задачи — от 1 до 200 знаков.",
      dueWindow: "Срок — не более 24 часов назад и 7 дней вперёд.",
      role: "Роль — медсестра, врач или все.",
      notOpen: "Задача уже закрыта.",
      reasonLength: "Причина — от 1 до 200 знаков.",
      vitalNotDue: "У этого пациента нет измерения с наступившим сроком.",
      settingsRange: "Интервалы 5–1440 мин, запас 0–240 мин, часы смен 0–23 и разные.",
      taskNotFound: "Задача не найдена.",
      person: "Задачу подписывает человек; эти учётные данные не указывают на человека.",
    },
    settingsTab: "Задачи",
    settingsTitle: "Настройки задач",
    settingsIntro: "Начало смен, запас по опозданию и интервал измерения витальных по полосе NEWS2. Для пустой полосы задачи не создаются.",
    shiftA: "Начало 1-й смены (час)", shiftB: "Начало 2-й смены (час)", grace: "Запас по опозданию (мин)",
    intervalsTitle: "Интервал измерения витальных (мин)",
    bandB0: "NEWS2 0", bandB1_4: "NEWS2 1–4", bandB3single: "3 по одному параметру", bandB5_6: "NEWS2 5–6", bandB7: "NEWS2 ≥ 7",
    bandEmpty: "пусто = без задачи",
    sourceNote: "Значение для балла 0 взято из источника NEWS2 в хранилище (RCP 2017: наблюдения не реже раза в 12 часов). Интервалы остальных полос — протокол больницы; они вводятся здесь.",
    settingsSaved: "Настройки задач сохранены.", settingsLoading: "Читаем настройки…", settingsReadFailed: "Не удалось прочитать настройки: {reason}",
    settingsUnset: "Задан интервал только для полосы «NEWS2 0»; пациентам в других полосах задача измерения не ставится.",
    settingsInvalid: "Проверьте значения: интервал 5–1440, запас 0–240, часы 0–23 и разные.",
    settingsUpdated: "Последнее изменение {who} · {time}",
  },
  en: {
    nav: "My tasks", navShort: "Tasks",
    title: "My tasks",
    intro: "This shift's work: tasks written by hand and the next vital measurement. The hospital sets the vital interval; an empty band produces no task.",
    shift: "Shift {start} → {end} · {count} patients",
    counterLate: "Late", counterDue: "Now", counterPlan: "Remaining (planned)", counterDone: "Done",
    modeGrid: "Grid", modeList: "List", modeLabel: "View",
    kindAll: "All", kindVital: "Vitals", kindHand: "By hand", kindLabel: "Kind",
    onlyLate: "Only late", onlyMine: "Only my role",
    gotoNow: "Go to now", now: "now",
    legend: "Legend",
    stateDone: "done", stateLate: "late", stateDue: "now", statePlan: "planned", stateSkipped: "not done",
    stateUnknown: "no measurement on record", stateOpen: "open",
    vitalRow: "Vital measurement", vitalPartial: "partial score", vitalBand: "NEWS2 band {band} · {minutes} min",
    vitalDue: "Measurement due {time}", vitalAnchor: "Last hand measurement {time}", vitalAnchorAdmission: "Anchor: admission time {time}",
    vitalSkippedUntil: "skipped until {time}",
    empty: "No work for this filter.", listHidesDone: "The list hides done items; the grid shows them.",
    noPatients: "No patients in your units.",
    newTask: "Add task", newTitle: "New task",
    fieldPatient: "Patient", fieldText: "Task", fieldTextHint: "At most 200 characters; no patient name, the bed is enough.",
    fieldDue: "Due", fieldDueHint: "At most 24 hours back, 7 days ahead.", fieldRole: "For",
    roleNurse: "Nurse", rolePhysician: "Physician", roleAny: "Anyone",
    save: "Save", cancel: "Cancel", close: "Close",
    taskTitle: "{title} · {bed}", vitalTitle: "Vital measurement · {bed}",
    claim: "Claim", finish: "Finish", skip: "Not done", skipReason: "Reason", skipReasonHint: "At most 200 characters; the audit trail records the event, not the text.",
    skipConfirm: "Record as not done", skipVitalConfirm: "Skip this interval",
    claimedBy: "claimed by {who}", createdBy: "created by {who} · {time}", closedBy: "closed by {who} · {time}",
    readOnly: "You have no right to write tasks; the screen is read-only.",
    created: "Task added.", claimed: "Task claimed.", finished: "Task finished.", skipped: "Task closed as not done.",
    vitalSkipped: "Vital measurement skipped until {time}.",
    readFailed: "Tasks could not be read: {reason}", refused: "{subject}: {reason}",
    err: {
      titleLength: "The task text is 1–200 characters.",
      dueWindow: "The due time is at most 24 hours back and 7 days ahead.",
      role: "The target role is nurse, physician or anyone.",
      notOpen: "The task is already closed.",
      reasonLength: "The reason is 1–200 characters.",
      vitalNotDue: "No vital measurement is due for this patient.",
      settingsRange: "Intervals 5–1440 min, grace 0–240 min, shift hours 0–23 and different.",
      taskNotFound: "Task not found.",
      person: "A person signs a task; this credential names no person.",
    },
    settingsTab: "Tasks",
    settingsTitle: "Task settings",
    settingsIntro: "Shift starts, the grace for lateness and the vital measurement interval per NEWS2 band. An empty band produces no task.",
    shiftA: "First shift start (hour)", shiftB: "Second shift start (hour)", grace: "Grace (min)",
    intervalsTitle: "Vital measurement interval (min)",
    bandB0: "NEWS2 0", bandB1_4: "NEWS2 1–4", bandB3single: "3 in a single parameter", bandB5_6: "NEWS2 5–6", bandB7: "NEWS2 ≥ 7",
    bandEmpty: "empty = no task",
    sourceNote: "The score-0 default comes from the vault's NEWS2 source (RCP 2017: observations at least 12-hourly). The other bands' intervals are the hospital's protocol, entered here.",
    settingsSaved: "Task settings saved.", settingsLoading: "Reading settings…", settingsReadFailed: "Settings could not be read: {reason}",
    settingsUnset: "Only the «NEWS2 0» band has an interval; patients in the other bands get no vital task.",
    settingsInvalid: "Check the values: interval 5–1440, grace 0–240, hours 0–23 and different.",
    settingsUpdated: "Last change {who} · {time}",
  },
};
```
In `catalog.js`: after `import olcum from "./strings/olcum.js";` add
```js
// G3-02: Görevlerim — the task queue, its dialogs and the Yönetim › Görevler tab.
import gorevler from "./strings/gorevler.js";
```
and in `NAMESPACES`, after `olcum, // G3-01` (blank line either side):
```js
  gorevler, // G3-02
```

- [ ] **Step 2: Run the dictionary tests**

Run: `./node_modules/.bin/vitest run src/live/i18n 2>&1 | tail -5`
Expected: PASS. If `strings.test` names an AZ value equal to TR (e.g. `vitalBand` differs only in «dk/dəq» — fine) or a RU value without Cyrillic (`bandB0: "NEWS2 0"` → add it to the file's `NEUTRAL` set with a comment `// G3-02 band labels`), fix as the test says.

- [ ] **Step 3: Commit**

```bash
cd /c/tmp/g3-gorevler && git add dashboard/src/live/i18n/strings/gorevler.js dashboard/src/live/i18n/catalog.js dashboard/src/live/i18n/strings.test.js && git commit -m "feat(dashboard): gorevler i18n namespace in four languages (G3-02 D16)"
```

---

### Task 11: The route, the model helpers and the screen skeleton with its hook

**Files:**
- Create: `dashboard/src/live/screens/gorevler/taskModel.js`, `useTasks.js`, `GorevlerScreen.jsx`
- Modify: `dashboard/src/live/shell/routes.js` (three lines), `dashboard/src/live/shell/routes.test.js`
- Test: `dashboard/src/live/screens/gorevler/taskModel.test.js`, `GorevlerScreen.test.jsx`

- [ ] **Step 1: Write the failing tests**

`taskModel.test.js`:
```js
import { describe, it, expect } from "vitest";
import { counters, handStateOf, hourIndex, items, keep, myRole, sortItems } from "./taskModel.js";

const START = Date.parse("2026-11-09T04:00:00Z");           // 08:00 Baku
const NOW = Date.parse("2026-11-09T10:00:00Z");
const SETTINGS = { grace_min: 30, intervals: { b0: 720 } };
const P = {
  patient_id: "S-001", bed_key: "REA^01^2", unit_id: "REA-01",
  vital: { state: "late", anchor_at: "2026-11-08T20:00:00Z", due_at: "2026-11-09T08:00:00Z", band: "b0", interval_min: 720,
           partial: false, skipped_until: null, entries: ["2026-11-09T05:10:00Z"] },
  tasks: [
    { id: "t1", title: "Pansuman", due_at: "2026-11-09T06:00:00Z", target_role: "nurse", state: "open", late: true, claimed_by: null },
    { id: "t2", title: "Konsültasyon", due_at: "2026-11-09T12:00:00Z", target_role: "physician", state: "open", late: false, claimed_by: null },
    { id: "t3", title: "Yara", due_at: "2026-11-09T07:00:00Z", target_role: "any", state: "done", late: false, claimed_by: "hem.ayse" },
  ],
};

describe("taskModel", () => {
  it("buckets an instant into the shift's hour columns", () => {
    expect(hourIndex("2026-11-09T04:00:00Z", START)).toBe(0);
    expect(hourIndex("2026-11-09T05:59:00Z", START)).toBe(1);
    expect(hourIndex("2026-11-10T03:59:00Z", START)).toBe(23);
    expect(hourIndex("2026-11-10T04:00:00Z", START)).toBe(24);
  });
  it("derives a hand task's state from the server's flags and the clock", () => {
    expect(handStateOf(P.tasks[0], NOW, SETTINGS.grace_min)).toBe("late");
    expect(handStateOf(P.tasks[1], NOW, SETTINGS.grace_min)).toBe("plan");
    expect(handStateOf({ ...P.tasks[1], due_at: "2026-11-09T09:50:00Z" }, NOW, SETTINGS.grace_min)).toBe("due");
    expect(handStateOf(P.tasks[2], NOW, SETTINGS.grace_min)).toBe("done");
  });
  it("turns a patient's answer into items: the vital's entries as done, the vital itself, every hand task", () => {
    const got = items(P, NOW, SETTINGS.grace_min);
    expect(got.map((x) => [x.kind, x.state, x.hour !== undefined ? hourIndex(x.at, START) : null])).toEqual([
      ["vital", "done", 1], ["vital", "late", 4], ["hand", "late", 2], ["hand", "plan", 8], ["hand", "done", 3],
    ].map(([k, s]) => [k, s, expect.any(Number)]));
  });
  it("counts this shift and filters by kind, lateness and role", () => {
    const got = items(P, NOW, SETTINGS.grace_min);
    expect(counters(got)).toEqual({ late: 2, due: 0, plan: 1, done: 2 });
    expect(got.filter((x) => keep(x, { kind: "hand", onlyLate: true, onlyMine: false }, "nurse")).map((x) => x.task.id)).toEqual(["t1"]);
    expect(got.filter((x) => keep(x, { kind: "all", onlyLate: false, onlyMine: true }, "nurse")).map((x) => x.kind + ":" + (x.task?.id ?? "v"))).toEqual(["vital:v", "vital:v", "hand:t1", "hand:t3"]);
    expect(sortItems(got.filter((x) => x.state !== "done")).map((x) => x.state)).toEqual(["late", "late", "plan"]);
  });
  it("reads the session's role from its default-group slugs", () => {
    expect(myRole([{ slug: "nurse" }])).toBe("nurse");
    expect(myRole([{ slug: "charge_nurse" }, { slug: "rapid_response" }])).toBe("nurse");
    expect(myRole([{ slug: "attending" }])).toBe("physician");
    expect(myRole([{ slug: "auditor" }])).toBe(null);
  });
});
```

`GorevlerScreen.test.jsx` (first tests — the grid/list tests come in Task 12):
```js
// src/live/screens/gorevler/GorevlerScreen.test.jsx — Görevlerim (G3-02)
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { NOW, ago, board, entry, identity, news2 } from "../../data/board.testutil.js";
import { GorevlerScreen } from "./GorevlerScreen.jsx";

export const VIEW = ["board.view", "tasks.view"];
export const MANAGE = [...VIEW, "tasks.manage", "clinical.chart"];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const AYSE = entry("S-001", [], { identity: identity({ birth_date: "1970-05-05" }), score: news2({ total: 0 }) });
const VUSAL = entry("S-002", [], { identity: identity({ patient_id: "S-002", display_name: "Vüsal Sınaq", bed_label: "REA-01 · 1", bed_id: "REA-01-1", bed_key: "REA^01^1" }) });
const iso = (ms) => new Date(ms).toISOString();
export const TASKS = {
  from: iso(NOW - 2 * 3_600_000), to: iso(NOW + 22 * 3_600_000), shift: { start: iso(NOW - 2 * 3_600_000), end: iso(NOW + 22 * 3_600_000) }, now: iso(NOW),
  settings: { grace_min: 30, intervals: { b0: 720, b1_4: null, b3_single: null, b5_6: null, b7: null } },
  patients: [
    { patient_id: "S-001", bed_key: "REA^01^2", unit_id: "REA-01",
      vital: { state: "late", anchor_at: iso(NOW - 13 * 3_600_000), due_at: iso(NOW - 3_600_000), band: "b0", interval_min: 720, partial: false, skipped_until: null, entries: [iso(NOW - 90 * 60_000)] },
      tasks: [{ id: "t1", patient_id: "S-001", title: "Pansuman", due_at: iso(NOW + 3_600_000), target_role: "nurse", state: "open", late: false,
                created_by: "hem.ayse", created_at: iso(NOW - 600_000), claimed_by: null, claimed_at: null, closed_by: null, closed_at: null }] },
    { patient_id: "S-002", bed_key: "REA^01^1", unit_id: "REA-01", vital: null, tasks: [] },
  ],
};

export async function open({ perms = MANAGE, tasks = TASKS, width = 1200 } = {}) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  const mounted = await mount(<GorevlerScreen />, {
    access: token({ perms, groups: ["nurse"] }), me: profile({ perms, groups: [{ slug: "nurse", name: "Hemşire" }] }),
    setup: (api) => {
      api.boardPatients.mockResolvedValue(board([AYSE, VUSAL]));
      api.streamTicket.mockResolvedValue({ ticket: "t-1" });
      api.tasks.mockResolvedValue(tasks);
    },
  });
  await act(async () => { await mounted.board.start(); });
  await act(async () => { mounted.stream.open(); await settle(); });
  await act(async () => { await settle(); });
  return mounted;
}
export const press = (el) => act(async () => { fireEvent.click(el); await settle(); });
export const toasted = (text) => within(screen.getByRole("region", { name: "Bildirişlər" })).queryAllByText(text);

beforeEach(() => { vi.setSystemTime(NOW); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the task screen", () => {
  it("reads the queue and shows the shift, the counters and one row per patient", async () => {
    const m = await open();
    expect(screen.getByRole("heading", { level: 1, name: "Tapşırıqlarım" })).toBeInTheDocument();
    expect(m.api.tasks).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/^Növbə .* · 2 xəstə$/)).toBeInTheDocument();
    expect(screen.getByTestId("counter-late")).toHaveTextContent("1");
    expect(screen.getByTestId("counter-done")).toHaveTextContent("1");
    expect(screen.getByTestId("counter-plan")).toHaveTextContent("1");
    expect(screen.getAllByRole("row", { name: /REA-01 · [12]/ })).toHaveLength(2);
  });
  it("keeps the last answer and says so when a read fails", async () => {
    const m = await open();
    m.api.tasks.mockRejectedValueOnce(refusal(503, "kapsam şu anda okunamıyor"));
    await act(async () => { vi.advanceTimersByTime(30_000); await settle(); });
    expect(screen.getByText(/Tapşırıqlar oxuna bilmədi/)).toBeInTheDocument();
    expect(screen.getByTestId("counter-late")).toHaveTextContent("1");
  });
  it("is read-only without tasks.manage", async () => {
    await open({ perms: VIEW });
    expect(screen.queryByRole("button", { name: "Tapşırıq əlavə et" })).toBeNull();
    expect(screen.getByText("Tapşırıq yazma icazəniz yoxdur; ekran yalnız oxunur.")).toBeInTheDocument();
  });
});
```
Note `vi.setSystemTime` needs fake timers for `advanceTimersByTime`: add `vi.useFakeTimers({ shouldAdvanceTime: true })` in `beforeEach` before `setSystemTime` if the second test does not advance; mirror what `BedsideScreen.test.jsx` does for its tick.

`routes.test.js` — append:
```js
  it("G3-02: Görevlerim opens with tasks.view, after Ölçüm, and is a work screen", () => {
    expect(navRoutes(["tasks.view"]).main).toEqual(["gorevler"]);
    expect(homePath(["tasks.view"])).toBe("/gorevler");
    expect(homePath(["clinical.chart", "tasks.view"])).toBe("/olcum");
    const ids = ROUTES.filter((r) => r.nav === "main").map((r) => r.id);
    expect(ids.indexOf("gorevler")).toBe(ids.indexOf("olcum") + 1);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `./node_modules/.bin/vitest run src/live/screens/gorevler src/live/shell/routes.test.js 2>&1 | tail -5`
Expected: FAIL — modules not found; the route test fails on `gorevler`.

- [ ] **Step 3: The model helpers**

```js
// src/live/screens/gorevler/taskModel.js — pure helpers for Görevlerim (G3-02): hour columns, states,
// counters, filters, the session's role. No React, no fetch; tested alone.
export const HOUR_MS = 3_600_000;
//: the order the list shows: what is late first, then what is due, then the rest
const ORDER = { late: 0, due: 1, open: 2, plan: 3, unknown: 4, skipped: 5, done: 6 };
const NURSE_SLUGS = new Set(["nurse", "charge_nurse", "rapid_response"]);
const PHYSICIAN_SLUGS = new Set(["physician", "unit_physician", "attending"]);

export const hourIndex = (iso, shiftStartMs) => Math.floor((Date.parse(iso) - shiftStartMs) / HOUR_MS);

/** A hand task's state as the grid paints it: the server says `state` and `late`; «due» is the open task whose
 *  time has come but whose grace has not run out (the same rule the server applies to the vital task). */
export function handStateOf(task, nowMs, graceMin) {
  if (task.state !== "open") return task.state;
  if (task.late) return "late";
  const due = Date.parse(task.due_at);
  if (nowMs < due) return "plan";
  return nowMs <= due + graceMin * 60_000 ? "due" : "late";
}

/** One patient's answer as flat items. The vital's past entries are `done` items; the vital itself is one item
 *  in its derived state at its due time (now, when it has none); every hand task is one item. */
export function items(patient, nowMs, graceMin) {
  const out = [];
  const v = patient.vital;
  if (v) {
    for (const at of v.entries || []) out.push({ key: `v:${patient.patient_id}:${at}`, kind: "vital", patientId: patient.patient_id, state: "done", at, vital: v });
    out.push({ key: `v:${patient.patient_id}:now`, kind: "vital", patientId: patient.patient_id, state: v.state,
               at: v.due_at ?? new Date(nowMs).toISOString(), vital: v, role: "nurse" });
  }
  for (const task of patient.tasks || []) {
    out.push({ key: `t:${task.id}`, kind: "hand", patientId: patient.patient_id, state: handStateOf(task, nowMs, graceMin), at: task.due_at, task, role: task.target_role });
  }
  return out;
}

export function counters(all) {
  const c = { late: 0, due: 0, plan: 0, done: 0 };
  for (const x of all) if (x.state in c) c[x.state] += 1;
  return c;
}

export function keep(item, filters, role) {
  if (filters.kind !== "all" && item.kind !== filters.kind) return false;
  if (filters.onlyLate && item.state !== "late") return false;
  if (filters.onlyMine && role && item.role && item.role !== "any" && item.role !== role) return false;
  return true;
}

export const sortItems = (all) => [...all].sort((a, b) => (ORDER[a.state] ?? 9) - (ORDER[b.state] ?? 9) || Date.parse(a.at) - Date.parse(b.at));

export function myRole(groups) {
  const slugs = (groups || []).map((g) => g.slug);
  if (slugs.some((s) => NURSE_SLUGS.has(s))) return "nurse";
  if (slugs.some((s) => PHYSICIAN_SLUGS.has(s))) return "physician";
  return null;
}

/** StatusPill tones per state (ui/Tag.jsx): the same five colours the prototype's legend used. */
export const TONE = { late: "crit", due: "att", plan: "neutral", done: "ok", skipped: "low", unknown: "neutral", open: "neutral" };
```

- [ ] **Step 4: The hook**

```js
// src/live/screens/gorevler/useTasks.js — reads /tasks every 30 s and after every write (G3-02 D14).
// A failed read keeps the last answer and reports the error; the screen says so and goes on.
import { useCallback, useEffect, useRef, useState } from "react";

export const TASKS_TICK_MS = 30_000;

export function useTasks(store, { everyMs = TASKS_TICK_MS } = {}) {
  const [state, setState] = useState({ data: null, error: null });
  const alive = useRef(true);
  const read = useCallback(async () => {
    try {
      const data = await store.track(() => store.api.tasks());
      if (alive.current) setState({ data, error: null });
    } catch (error) {
      if (alive.current) setState((s) => ({ data: s.data, error }));
    }
  }, [store]);
  useEffect(() => {
    alive.current = true;
    read();
    const id = setInterval(read, everyMs);
    return () => { alive.current = false; clearInterval(id); };
  }, [read, everyMs]);
  /** Runs a write through the session store, then reads again. Rejections propagate to the caller. */
  const write = useCallback(async (call) => {
    const answer = await store.track(call);
    await read();
    return answer;
  }, [store, read]);
  return { data: state.data, error: state.error, refresh: read, write };
}
```

- [ ] **Step 5: The screen skeleton**

```jsx
// src/live/screens/gorevler/GorevlerScreen.jsx — Görevlerim (G3-02): the ward's task queue for this shift.
// Two sources: tasks written by hand, and the vital measurement the server derives from the patient's last
// hand-entered NEWS2 set and the hospital's interval for the band. The grid (wide) and the list (narrow) read
// the same items; nothing here scores or decides — the server says the state, the screen paints it.
import React, { useMemo, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { hhmm } from "../../i18n/dates.js";
import { useBoard } from "../../data/BoardProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { readErrorText } from "../../apiErrors.js";
import { Alert, Button, Note, Seg } from "../../ui/index.js";
import { BoardStrip, ScopeNote, useBoardNow } from "../common/BoardState.jsx";
import { orderBeds } from "../beds/order.js";
import { counters, items, keep, myRole } from "./taskModel.js";
import { useTasks } from "./useTasks.js";
import { TaskGrid } from "./TaskGrid.jsx";
import { TaskList } from "./TaskList.jsx";
import { NewTaskDialog, TaskDialog, VitalDialog } from "./TaskDialogs.jsx";

const NARROW_PX = 900;

export function GorevlerScreen() {
  const { t } = useI18n();
  const board = useBoard();
  const { user, store } = useSession();
  const nowMs = useBoardNow(30_000);
  const { data, error, refresh, write } = useTasks(store);
  const canManage = user?.perms?.includes("tasks.manage") ?? false;
  const role = myRole(user?.groups);
  const [mode, setMode] = useState(() => (typeof window !== "undefined" && window.innerWidth < NARROW_PX ? "list" : "grid"));
  const [filters, setFilters] = useState({ kind: "all", onlyLate: false, onlyMine: false });
  const [dialog, setDialog] = useState(null);     // { kind: "hand"|"vital"|"new", patientId?, item? }

  const patients = useMemo(() => orderBeds(board.patients), [board.patients]);
  const byId = useMemo(() => new Map((data?.patients ?? []).map((p) => [p.patient_id, p])), [data]);
  const grace = data?.settings?.grace_min ?? 30;
  const all = useMemo(() => patients.flatMap((p) => (byId.get(p.patient_id) ? items(byId.get(p.patient_id), nowMs, grace) : [])), [patients, byId, nowMs, grace]);
  const shown = useMemo(() => all.filter((x) => keep(x, filters, role)), [all, filters, role]);
  const count = counters(all);
  const shiftStartMs = data ? Date.parse(data.shift.start) : nowMs;
  const shiftEndMs = data ? Date.parse(data.shift.end) : nowMs;

  const set = (patch) => setFilters((f) => ({ ...f, ...patch }));
  const openItem = (item) => setDialog(item.kind === "vital" ? { kind: "vital", patientId: item.patientId, item } : { kind: "hand", patientId: item.patientId, item });

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="m-0 font-display text-23 font-bold">{t("gorevler.title")}</h1>
          <p className="m-0 text-13 text-mute">{t("gorevler.intro")}</p>
          {data ? <p className="m-0 mt-1 text-13 text-ink">{t("gorevler.shift", { start: hhmm(shiftStartMs), end: hhmm(shiftEndMs), count: patients.length })}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Seg label={t("gorevler.modeLabel")} value={mode} onChange={setMode}
            options={[{ value: "grid", label: t("gorevler.modeGrid") }, { value: "list", label: t("gorevler.modeList") }]} />
          {canManage ? <Button variant="primary" icon="plus" onClick={() => setDialog({ kind: "new" })}>{t("gorevler.newTask")}</Button> : null}
        </div>
      </div>
      <BoardStrip connection={board.connection} />
      <ScopeNote scope={board.scope} scopeNote={board.scopeNote} />
      {error ? <Alert tone="crit"><p className="m-0">{t("gorevler.readFailed", { reason: readErrorText(t, error) })}</p></Alert> : null}
      {!canManage ? <Note tone="info" icon="lock">{t("gorevler.readOnly")}</Note> : null}
      <div className="grid grid-cols-2 gap-2 min-[640px]:grid-cols-4">
        {[["late", "counterLate", "text-crit"], ["due", "counterDue", "text-pri"], ["plan", "counterPlan", "text-mute"], ["done", "counterDone", "text-ok"]].map(([k, label, cls]) => (
          <div key={k} className="rounded-box border border-line bg-card px-3 py-2">
            <b data-testid={`counter-${k}`} className={`block font-data text-23 ${cls}`}>{count[k]}</b>
            <span className="text-12 text-mute">{t(`gorevler.${label}`)}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Seg label={t("gorevler.kindLabel")} value={filters.kind} onChange={(kind) => set({ kind })}
          options={[{ value: "all", label: t("gorevler.kindAll") }, { value: "vital", label: t("gorevler.kindVital") }, { value: "hand", label: t("gorevler.kindHand") }]} />
        <label className="flex items-center gap-2 text-13"><input type="checkbox" checked={filters.onlyLate} onChange={(e) => set({ onlyLate: e.target.checked })} />{t("gorevler.onlyLate")}</label>
        {role ? <label className="flex items-center gap-2 text-13"><input type="checkbox" checked={filters.onlyMine} onChange={(e) => set({ onlyMine: e.target.checked })} />{t("gorevler.onlyMine")}</label> : null}
      </div>
      {patients.length === 0 ? <Note tone="info" icon="bed">{t("gorevler.noPatients")}</Note>
        : mode === "grid"
          ? <TaskGrid patients={patients} items={shown} shiftStartMs={shiftStartMs} nowMs={nowMs} onOpen={openItem} />
          : <TaskList patients={patients} items={shown} nowMs={nowMs} onOpen={openItem} />}
      {dialog?.kind === "new" ? <NewTaskDialog patients={patients} nowMs={nowMs} write={write} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "hand" ? <TaskDialog item={dialog.item} patient={patients.find((p) => p.patient_id === dialog.patientId)} nowMs={nowMs} canManage={canManage} write={write} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "vital" ? <VitalDialog item={dialog.item} patient={patients.find((p) => p.patient_id === dialog.patientId)} nowMs={nowMs} canManage={canManage} write={write} refresh={refresh} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}
```
Until Task 12/13 exist, create `TaskGrid.jsx`, `TaskList.jsx` and `TaskDialogs.jsx` as minimal placeholders that render `null` **only for the duration of this task's test run** — no: Task 11's test needs the rows. Instead run Task 11 and Task 12 together: write both before running (the skeleton's test asserts rows from the grid). Order: Step 3–5 here, then Task 12 Step 3, then run both test files.

- [ ] **Step 6: Register the route**

`routes.js`: after the G3-01 import line (blank line between):
```js
import { GorevlerScreen } from "../screens/gorevler/GorevlerScreen.jsx"; // G3-02
```
In `SCREENS`, after `olcum: BedsideScreen, …` (blank line either side):
```js
  gorevler: GorevlerScreen, // G3-02 — Görevlerim: the ward's task queue
```
In `ROUTES`, after the `olcum` entry (blank line between):
```js
  // G3-02 (D12) — Görevlerim: for whoever reads the queue (`tasks.view`). After Ölçüm, so nobody's home moves;
  // a session that only reads tasks lands here.
  route({ id: "gorevler", path: "/gorevler", icon: "clip", labelKey: "gorevler.nav", shortKey: "gorevler.navShort",
    perms: ["tasks.view"], work: true, nav: "main" }),
```

- [ ] **Step 7: Commit (after Task 12's tests pass together with these)**

```bash
cd /c/tmp/g3-gorevler && git add dashboard/src/live/screens/gorevler dashboard/src/live/shell/routes.js dashboard/src/live/shell/routes.test.js && git commit -m "feat(dashboard): Görevlerim screen — route, model helpers, the 30 s hook, header, counters and filters (G3-02 D12, D14)"
```

---

### Task 12: The grid and the list

**Files:**
- Create: `dashboard/src/live/screens/gorevler/TaskGrid.jsx`, `TaskList.jsx`
- Test: `dashboard/src/live/screens/gorevler/GorevlerScreen.test.jsx` (append)

- [ ] **Step 1: Write the failing tests**

```js
describe("grid and list", () => {
  it("paints the grid: 24 hour columns from the shift start, a vital row and a hand row under the patient", async () => {
    await open();
    const grid = screen.getByRole("table", { name: "Tapşırıqlarım" });
    expect(within(grid).getAllByRole("columnheader")).toHaveLength(25);      // bed/name + 24 hours
    const ayse = within(grid).getByRole("row", { name: /REA-01 · 2/ });
    expect(ayse).toBeInTheDocument();
    expect(within(grid).getByText("Vital ölçmə")).toBeInTheDocument();
    expect(within(grid).getByText("Pansuman")).toBeInTheDocument();
    expect(within(grid).getByRole("button", { name: /gecikdi/ })).toBeInTheDocument();   // the late vital cell
    expect(within(grid).getAllByRole("button", { name: /tamamlandı/ })).toHaveLength(1); // the 90-min-old entry
  });
  it("lists open items late first on a narrow screen and hides done ones", async () => {
    await open({ width: 700 });
    const list = screen.getByRole("list", { name: "Tapşırıqlarım" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Vital ölçmə");
    expect(rows[0]).toHaveTextContent("gecikdi");
    expect(rows[1]).toHaveTextContent("Pansuman");
    expect(within(list).queryByText("tamamlandı")).toBeNull();
    expect(screen.getByText("Siyahı görünüşündə tamamlananlar gizlidir; cədvəldə görünür.")).toBeInTheDocument();
  });
  it("filters: only late, only vitals", async () => {
    await open();
    await press(screen.getByLabelText("Yalnız gecikənlər"));
    expect(screen.queryByText("Pansuman")).toBeNull();
    await press(screen.getByRole("button", { name: "Vital" }));
    expect(screen.getByText("Vital ölçmə")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to see them fail** — `./node_modules/.bin/vitest run src/live/screens/gorevler 2>&1 | tail -5` → FAIL (TaskGrid missing).

- [ ] **Step 3: The grid**

```jsx
// src/live/screens/gorevler/TaskGrid.jsx — the prototype's 24-hour grid (G3-02 D12): one patient row, then
// one row per task kind; hour columns from the shift start; a cell is a button in the state's colour.
import React from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { hhmm } from "../../i18n/dates.js";
import { StatusPill } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { nameOf } from "../common/BoardState.jsx";
import { bedNameOf } from "../beds/order.js";
import { HOUR_MS, TONE, hourIndex } from "./taskModel.js";

const HOURS = Array.from({ length: 24 }, (_, i) => i);

function Cell({ item, t, onOpen }) {
  const label = t(`gorevler.state${item.state[0].toUpperCase()}${item.state.slice(1)}`);
  return (
    <button type="button" onClick={() => onOpen(item)} title={`${hhmm(Date.parse(item.at))} · ${label}`}
      aria-label={`${hhmm(Date.parse(item.at))} ${label}`} className={`inline-grid place-items-center rounded-ctl ${FOCUS_RING}`}>
      <StatusPill tone={TONE[item.state]}>{item.state === "late" ? "!" : item.state === "done" ? "✓" : "·"}</StatusPill>
    </button>
  );
}

export function TaskGrid({ patients, items, shiftStartMs, nowMs, onOpen }) {
  const { t } = useI18n();
  const nowCol = Math.min(23, Math.max(0, Math.floor((nowMs - shiftStartMs) / HOUR_MS)));
  return (
    <div className="overflow-x-auto rounded-box border border-line bg-card">
      <table aria-label={t("gorevler.title")} className="min-w-[1100px] border-collapse text-13">
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 bg-card2 px-3 py-2 text-left">{t("gorevler.fieldPatient")}</th>
            {HOURS.map((h) => (
              <th key={h} scope="col" aria-current={h === nowCol ? "time" : undefined}
                className={`w-11 px-0 py-2 font-data text-11 ${h === nowCol ? "text-crit" : "text-mute"}`}>{hhmm(shiftStartMs + h * HOUR_MS)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {patients.map((p) => {
            const mine = items.filter((x) => x.patientId === p.patient_id);
            if (mine.length === 0) return null;
            const rows = [["vital", t("gorevler.vitalRow"), mine.filter((x) => x.kind === "vital")]];
            const byTitle = new Map();
            for (const x of mine.filter((x) => x.kind === "hand")) byTitle.set(x.task.title, [...(byTitle.get(x.task.title) ?? []), x]);
            for (const [title, xs] of byTitle) rows.push([`t:${title}`, title, xs]);
            return (
              <React.Fragment key={p.patient_id}>
                <tr aria-label={`${bedNameOf(p)} ${nameOf(p, t)}`} className="bg-card2">
                  <th scope="row" className="sticky left-0 bg-card2 px-3 py-2 text-left"><b className="font-data text-pri">{bedNameOf(p)}</b> <span className="text-ink">{nameOf(p, t)}</span></th>
                  <td colSpan={24} className="px-3 text-12 text-mute">{mine.filter((x) => x.state === "late").length ? `${mine.filter((x) => x.state === "late").length} ${t("gorevler.stateLate")}` : ""}</td>
                </tr>
                {rows.filter(([, , xs]) => xs.length > 0).map(([key, label, xs]) => (
                  <tr key={key}>
                    <th scope="row" className="sticky left-0 bg-card px-3 py-1 text-left font-text font-semibold text-ink">{label}</th>
                    {HOURS.map((h) => {
                      const here = xs.filter((x) => Math.min(23, Math.max(0, hourIndex(x.at, shiftStartMs))) === h);
                      return <td key={h} className="border-l border-line px-0 py-1 text-center">{here.map((x) => <Cell key={x.key} item={x} t={t} onOpen={onOpen} />)}</td>;
                    })}
                  </tr>
                ))}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```
A `late`/`unknown` vital whose due time lies before the shift start is clamped to column 0, one after the end to column 23 — the clamp above does that.

- [ ] **Step 4: The list**

```jsx
// src/live/screens/gorevler/TaskList.jsx — the narrow-screen list (G3-02 D12): open items late first, done hidden.
import React from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { dayStamp } from "../../i18n/dates.js";
import { Note, StatusPill } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { nameOf } from "../common/BoardState.jsx";
import { bedNameOf } from "../beds/order.js";
import { TONE, sortItems } from "./taskModel.js";

export function TaskList({ patients, items, nowMs, onOpen }) {
  const { t } = useI18n();
  const byId = new Map(patients.map((p) => [p.patient_id, p]));
  const shown = sortItems(items.filter((x) => x.state !== "done"));
  return (
    <div className="grid gap-2">
      {shown.length === 0 ? <Note tone="info" icon="list">{t("gorevler.empty")}</Note> : (
        <ul role="list" aria-label={t("gorevler.title")} className="m-0 grid list-none gap-2 p-0">
          {shown.map((x) => {
            const p = byId.get(x.patientId);
            const label = t(`gorevler.state${x.state[0].toUpperCase()}${x.state.slice(1)}`);
            return (
              <li key={x.key}>
                <button type="button" onClick={() => onOpen(x)} className={`grid w-full grid-cols-[56px_1fr_auto] items-center gap-3 rounded-box border border-line bg-card px-3 py-2 text-left ${FOCUS_RING}`}>
                  <span className="font-data text-13 font-bold">{x.at ? dayStamp(Date.parse(x.at), nowMs) : "—"}</span>
                  <span><b className="block text-ink">{x.kind === "vital" ? t("gorevler.vitalRow") : x.task.title}</b>
                    <small className="block text-12 text-mute">{p ? `${bedNameOf(p)} · ${nameOf(p, t)}` : x.patientId}{x.task?.claimed_by ? ` · ${t("gorevler.claimedBy", { who: x.task.claimed_by })}` : ""}</small></span>
                  <StatusPill tone={TONE[x.state]}>{label}</StatusPill>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="m-0 text-12 text-mute">{t("gorevler.listHidesDone")}</p>
    </div>
  );
}
```

- [ ] **Step 5: Run Task 11's and Task 12's tests**

Run: `./node_modules/.bin/vitest run src/live/screens/gorevler src/live/shell/routes.test.js 2>&1 | tail -6`
Expected: PASS — except the dialog tests, which Task 13 adds. (`TaskDialogs.jsx` must exist for the import: create it in Task 13 before running, or run Task 13 first; the three dialog components are exported from one file.)

- [ ] **Step 6: Commit** (together with Task 11's files if not yet committed)

```bash
cd /c/tmp/g3-gorevler && git add dashboard/src/live/screens/gorevler && git commit -m "feat(dashboard): Görevlerim grid and list (G3-02 D12)"
```

---

### Task 13: The dialogs — hand task, vital task, new task

**Files:**
- Create: `dashboard/src/live/screens/gorevler/TaskDialogs.jsx`
- Test: `dashboard/src/live/screens/gorevler/GorevlerScreen.test.jsx` (append)

- [ ] **Step 1: Write the failing tests**

```js
describe("dialogs", () => {
  it("claims and finishes a hand task, then reads again", async () => {
    const m = await open();
    m.api.claimTask.mockResolvedValue({ ...TASKS.patients[0].tasks[0], claimed_by: "hem.ayse" });
    m.api.doneTask.mockResolvedValue({ ...TASKS.patients[0].tasks[0], state: "done" });
    await press(screen.getByText("Pansuman"));
    const dialog = screen.getByRole("dialog", { name: "Pansuman · REA-01 · 2" });
    await press(within(dialog).getByRole("button", { name: "Öhdəyə götür" }));
    expect(m.api.claimTask).toHaveBeenCalledWith("t1");
    expect(toasted("Tapşırıq öhdəyə götürüldü.")).toHaveLength(1);
    await press(within(dialog).getByRole("button", { name: "Tamamla" }));
    expect(m.api.doneTask).toHaveBeenCalledWith("t1");
    expect(m.api.tasks).toHaveBeenCalledTimes(3);
  });
  it("skips a hand task with a reason and names a refusal", async () => {
    const m = await open();
    m.api.skipTask.mockRejectedValueOnce(refusal(409, "The task is already closed.", { apiCode: "task_not_open" }));
    await press(screen.getByText("Pansuman"));
    const dialog = screen.getByRole("dialog", { name: "Pansuman · REA-01 · 2" });
    await press(within(dialog).getByRole("button", { name: "Tətbiq edilmədi" }));
    fireEvent.change(within(dialog).getByLabelText(/^Səbəb/), { target: { value: "xəstə əməliyyatdadır" } });
    await press(within(dialog).getByRole("button", { name: "Tətbiq edilmədi kimi qeyd et" }));
    expect(m.api.skipTask).toHaveBeenCalledWith("t1", "xəstə əməliyyatdadır");
    expect(toasted(/Tapşırıq artıq bağlanıb\./)).toHaveLength(1);
  });
  it("opens the vital dialog with the bedside entry button and skips the interval", async () => {
    const m = await open();
    m.api.skipVitalTask.mockResolvedValue({ patient_id: "S-001", skipped_until: new Date(NOW + 11 * 3_600_000).toISOString() });
    await press(screen.getByRole("button", { name: /gecikdi/ }));
    const dialog = screen.getByRole("dialog", { name: "Vital ölçmə · REA-01 · 2" });
    expect(within(dialog).getByRole("button", { name: "Ölçmə daxil et" })).toBeInTheDocument();   // G3-01's VitalsEntry
    await press(within(dialog).getByRole("button", { name: "Bu interval üçün ötür" }));
    fireEvent.change(within(dialog).getByLabelText(/^Səbəb/), { target: { value: "görüntüləmədə" } });
    await press(within(dialog).getByRole("button", { name: "Bu interval üçün ötür" }));
    expect(m.api.skipVitalTask).toHaveBeenCalledWith("S-001", "görüntüləmədə");
    expect(toasted(/Vital ölçmə .* qədər ötürüldü\./)).toHaveLength(1);
  });
  it("creates a task for a chosen patient", async () => {
    const m = await open();
    m.api.createTask.mockResolvedValue({ id: "t9", state: "open" });
    await press(screen.getByRole("button", { name: "Tapşırıq əlavə et" }));
    const dialog = screen.getByRole("dialog", { name: "Yeni tapşırıq" });
    fireEvent.change(within(dialog).getByLabelText(/^Xəstə/), { target: { value: "S-002" } });
    fireEvent.change(within(dialog).getByLabelText(/^Tapşırıq/), { target: { value: "Konsultasiya" } });
    fireEvent.change(within(dialog).getByLabelText(/^Kimə/), { target: { value: "physician" } });
    await press(within(dialog).getByRole("button", { name: "Yadda saxla" }));
    expect(m.api.createTask).toHaveBeenCalledWith(expect.objectContaining({ patient_id: "S-002", title: "Konsultasiya", target_role: "physician", due_at: expect.stringMatching(/Z$/) }));
    expect(toasted("Tapşırıq əlavə edildi.")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to see them fail** — `./node_modules/.bin/vitest run src/live/screens/gorevler 2>&1 | tail -5` → FAIL (TaskDialogs missing).

- [ ] **Step 3: The dialogs**

```jsx
// src/live/screens/gorevler/TaskDialogs.jsx — the three dialogs of Görevlerim (G3-02 D13): a hand task (claim ·
// finish · not done), the vital task (G3-01's entry button + skip this interval), a new task. Every write goes
// through `write` (session store → read again); a refusal becomes a toast in the catalog's words.
import React, { useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { dayStamp } from "../../i18n/dates.js";
import { apiErrorText } from "../../apiErrors.js";
import { Button, Field, Input, Modal, Select, StatusPill, useToast } from "../../ui/index.js";
import { nameOf } from "../common/BoardState.jsx";
import { bedNameOf } from "../beds/order.js";
import { VitalsEntry } from "../patient/VitalsEntry.jsx";
import { fromLocalInput, toLocalInput } from "../patient/meds/medsFields.js";
import { TONE } from "./taskModel.js";

const REASON_MAX = 200;
const CONTROL = "w-full rounded-ctl border border-line2 bg-card2 px-[11px] py-[9px] font-text text-14.5 text-ink outline-none focus:border-pri";

function stateLabel(t, state) { return t(`gorevler.state${state[0].toUpperCase()}${state.slice(1)}`); }

function ReasonForm({ label, confirm, onConfirm, onCancel, busy }) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const ok = reason.trim().length >= 1 && reason.length <= REASON_MAX;
  return (
    <form noValidate onSubmit={(e) => { e.preventDefault(); if (ok && !busy) onConfirm(reason.trim()); }} className="grid gap-2">
      <Field label={label} hint={t("gorevler.skipReasonHint")} required layout="col">
        <textarea value={reason} maxLength={REASON_MAX} rows={2} className={CONTROL} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <div className="flex gap-2"><Button type="submit" variant="danger" busy={busy}>{confirm}</Button><Button onClick={onCancel}>{t("gorevler.cancel")}</Button></div>
    </form>
  );
}

export function TaskDialog({ item, patient, nowMs, canManage, write, onClose }) {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const task = item.task;
  const bed = patient ? bedNameOf(patient) : item.patientId;
  const run = async (call, okKey) => {
    setBusy(true);
    try { await write(call); toast(t(okKey)); if (okKey !== "gorevler.claimed") onClose(); }
    catch (err) { toast(t("gorevler.refused", { subject: task.title, reason: apiErrorText(t, err) }), "error"); }
    finally { setBusy(false); }
  };
  return (
    <Modal open title={t("gorevler.taskTitle", { title: task.title, bed })} onClose={onClose} busy={busy}>
      <div className="grid gap-2 text-13">
        <p className="m-0"><StatusPill tone={TONE[item.state]}>{stateLabel(t, item.state)}</StatusPill> <span className="font-data">{dayStamp(Date.parse(task.due_at), nowMs)}</span> · {patient ? nameOf(patient, t) : ""}</p>
        <p className="m-0 text-mute">{t("gorevler.createdBy", { who: task.created_by, time: dayStamp(Date.parse(task.created_at), nowMs) })}{task.claimed_by ? ` · ${t("gorevler.claimedBy", { who: task.claimed_by })}` : ""}</p>
        {task.state !== "open" && task.closed_by ? <p className="m-0 text-mute">{t("gorevler.closedBy", { who: task.closed_by, time: dayStamp(Date.parse(task.closed_at), nowMs) })}</p> : null}
        {canManage && task.state === "open" && !skipping ? (
          <div className="flex flex-wrap gap-2">
            {!task.claimed_by ? <Button busy={busy} onClick={() => run((api) => api.claimTask(task.id), "gorevler.claimed")}>{t("gorevler.claim")}</Button> : null}
            <Button variant="primary" busy={busy} onClick={() => run((api) => api.doneTask(task.id), "gorevler.finished")}>{t("gorevler.finish")}</Button>
            <Button variant="ghost" onClick={() => setSkipping(true)}>{t("gorevler.skip")}</Button>
          </div>
        ) : null}
        {skipping ? <ReasonForm label={t("gorevler.skipReason")} confirm={t("gorevler.skipConfirm")} busy={busy} onCancel={() => setSkipping(false)}
          onConfirm={(reason) => run((api) => api.skipTask(task.id, reason), "gorevler.skipped")} /> : null}
      </div>
    </Modal>
  );
}

export function VitalDialog({ item, patient, nowMs, canManage, write, refresh, onClose }) {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const v = item.vital;
  const bed = patient ? bedNameOf(patient) : item.patientId;
  const canSkip = canManage && (item.state === "due" || item.state === "late");
  const skip = async (reason) => {
    setBusy(true);
    try {
      const got = await write((api) => api.skipVitalTask(item.patientId, reason));
      toast(t("gorevler.vitalSkipped", { time: dayStamp(Date.parse(got.skipped_until), nowMs) }));
      onClose();
    } catch (err) { toast(t("gorevler.refused", { subject: t("gorevler.vitalRow"), reason: apiErrorText(t, err) }), "error"); }
    finally { setBusy(false); }
  };
  return (
    <Modal open title={t("gorevler.vitalTitle", { bed })} onClose={onClose} busy={busy}>
      <div className="grid gap-2 text-13">
        <p className="m-0"><StatusPill tone={TONE[item.state]}>{stateLabel(t, item.state)}</StatusPill>{v.due_at ? <> · {t("gorevler.vitalDue", { time: dayStamp(Date.parse(v.due_at), nowMs) })}</> : null}{v.partial ? <> · {t("gorevler.vitalPartial")}</> : null}</p>
        <p className="m-0 text-mute">{t("gorevler.vitalBand", { band: v.band, minutes: v.interval_min })}{v.anchor_at ? ` · ${t(v.entries?.length ? "gorevler.vitalAnchor" : "gorevler.vitalAnchorAdmission", { time: dayStamp(Date.parse(v.anchor_at), nowMs) })}` : ""}</p>
        {patient && canManage ? <VitalsEntry patientId={patient.patient_id} bed={bed} nowMs={nowMs} onWritten={() => refresh()} /> : null}
        {canSkip && !skipping ? <div><Button variant="ghost" onClick={() => setSkipping(true)}>{t("gorevler.skipVitalConfirm")}</Button></div> : null}
        {skipping ? <ReasonForm label={t("gorevler.skipReason")} confirm={t("gorevler.skipVitalConfirm")} busy={busy} onCancel={() => setSkipping(false)} onConfirm={skip} /> : null}
      </div>
    </Modal>
  );
}

export function NewTaskDialog({ patients, nowMs, write, onClose }) {
  const { t } = useI18n();
  const toast = useToast();
  const nextHour = Math.ceil(nowMs / 3_600_000) * 3_600_000;
  const [form, setForm] = useState({ patientId: patients[0]?.patient_id ?? "", title: "", due: toLocalInput(nextHour), role: "nurse" });
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const badTitle = form.title.trim().length < 1 || form.title.length > 200;
  const dueMs = fromLocalInput(form.due);
  const badDue = !Number.isFinite(dueMs) || dueMs < nowMs - 24 * 3_600_000 || dueMs > nowMs + 7 * 24 * 3_600_000;
  async function save(e) {
    e.preventDefault();
    if (badTitle || badDue || !form.patientId) { setTried(true); return; }
    setBusy(true);
    try {
      await write((api) => api.createTask({ patient_id: form.patientId, title: form.title.trim(), due_at: new Date(dueMs).toISOString(), target_role: form.role }));
      toast(t("gorevler.created"));
      onClose();
    } catch (err) { toast(t("gorevler.refused", { subject: t("gorevler.newTitle"), reason: apiErrorText(t, err) }), "error"); }
    finally { setBusy(false); }
  }
  return (
    <Modal open title={t("gorevler.newTitle")} onClose={onClose} busy={busy}>
      <form noValidate autoComplete="off" onSubmit={save} className="grid gap-2">
        <Field label={t("gorevler.fieldPatient")} required>
          <Select value={form.patientId} onChange={(e) => set({ patientId: e.target.value })}>
            {patients.map((p) => <option key={p.patient_id} value={p.patient_id}>{`${bedNameOf(p)} · ${nameOf(p, t)}`}</option>)}
          </Select>
        </Field>
        <Field label={t("gorevler.fieldText")} hint={t("gorevler.fieldTextHint")} required error={tried && badTitle ? t("gorevler.err.titleLength") : undefined}>
          <Input value={form.title} maxLength={200} onChange={(e) => set({ title: e.target.value })} />
        </Field>
        <Field label={t("gorevler.fieldDue")} hint={t("gorevler.fieldDueHint")} required error={tried && badDue ? t("gorevler.err.dueWindow") : undefined}>
          <Input type="datetime-local" value={form.due} onChange={(e) => set({ due: e.target.value })} />
        </Field>
        <Field label={t("gorevler.fieldRole")}>
          <Select value={form.role} onChange={(e) => set({ role: e.target.value })}>
            <option value="nurse">{t("gorevler.roleNurse")}</option>
            <option value="physician">{t("gorevler.rolePhysician")}</option>
            <option value="any">{t("gorevler.roleAny")}</option>
          </Select>
        </Field>
        <div className="flex gap-2"><Button type="submit" variant="primary" busy={busy}>{t("gorevler.save")}</Button><Button onClick={onClose}>{t("gorevler.cancel")}</Button></div>
      </form>
    </Modal>
  );
}
```
`write(call)` passes the session store's `api` to the call: in `useTasks.write`, change `store.track(call)` to `store.track(() => call(store.api))` so dialogs receive `api`. Update `useTasks.js` accordingly (the hook test in Task 11 does not depend on it).

- [ ] **Step 4: Run the screen tests**

Run: `./node_modules/.bin/vitest run src/live/screens/gorevler src/live/screens/patient/PatientScreen.test.jsx 2>&1 | tail -6`
Expected: PASS (PatientScreen still mounts `VitalsEntry` as before).

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g3-gorevler && git add dashboard/src/live/screens/gorevler && git commit -m "feat(dashboard): Görevlerim dialogs — claim/finish/skip, the vital entry with skip, new task (G3-02 D13)"
```

---

### Task 14: Yönetim › Görevler — the settings tab, and the rawKeys sweep

**Files:**
- Create: `dashboard/src/live/screens/admin/TasksTab.jsx`, `TasksTab.test.jsx`
- Modify: `dashboard/src/live/screens/admin/AdminScreen.jsx` (import line; `TABS` entry; `TAB_SCREENS` entry — each with blank lines)
- Modify: `dashboard/src/live/rawKeys.test.jsx` (`openAt` setup: stub `api.tasks` and `api.taskSettings`)

- [ ] **Step 1: Write the failing test**

```js
// src/live/screens/admin/TasksTab.test.jsx
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { ADMIN, settle, toasts } from "../kabul/kabul.testutil.js";
import { TasksTab } from "./TasksTab.jsx";

const UNSET = { configured: false, shift_start_a: 8, shift_start_b: 20, grace_min: 30,
  intervals: { b0: 720, b1_4: null, b3_single: null, b5_6: null, b7: null }, updated_at: null, updated_by: null, default_source: { b0: "news2-rcp-2017" } };

async function mounted(setup) {
  const m = await mount(<TasksTab />, { access: token({ perms: ADMIN }), me: profile({ perms: ADMIN }), setup });
  await settle();
  return m;
}
const save = async () => { await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yadda saxla" })); }); await settle(); };

describe("TasksTab", () => {
  it("shows the defaults, names the one sourced band and says the others are the hospital's", async () => {
    await mounted((a) => a.taskSettings.mockResolvedValue(UNSET));
    expect(screen.getByLabelText(/^NEWS2 0 balı/).value).toBe("720");
    expect(screen.getByLabelText(/^NEWS2 1–4 bal/).value).toBe("");
    expect(screen.getByText(/RCP 2017/)).toBeInTheDocument();
    expect(screen.getByText("Yalnız «NEWS2 0» zolağının intervalı təyin edilib; digər zolaqlardakı xəstələr üçün vital tapşırığı düşmür.")).toBeInTheDocument();
  });
  it("saves whole bodies and toasts", async () => {
    const m = await mounted((a) => { a.taskSettings.mockResolvedValue(UNSET); a.saveTaskSettings.mockResolvedValue({ ...UNSET, configured: true, grace_min: 45, intervals: { ...UNSET.intervals, b1_4: 360 }, updated_by: "admin", updated_at: "2026-11-09T10:00:00Z" }); });
    fireEvent.change(screen.getByLabelText(/^Gecikmə payı/), { target: { value: "45" } });
    fireEvent.change(screen.getByLabelText(/^NEWS2 1–4 bal/), { target: { value: "360" } });
    await save();
    expect(m.api.saveTaskSettings).toHaveBeenCalledWith({ shift_start_a: 8, shift_start_b: 20, grace_min: 45, intervals: { b0: 720, b1_4: 360, b3_single: null, b5_6: null, b7: null } });
    expect(toasts().getAllByText("Tapşırıq ayarları yadda saxlanıldı.")).toHaveLength(1);
  });
  it("refuses out-of-range values before sending, and names the server's refusal", async () => {
    const m = await mounted((a) => { a.taskSettings.mockResolvedValue(UNSET); a.saveTaskSettings.mockRejectedValue(refusal(422, "Intervals are 5–1440 minutes, the grace 0–240 minutes, shift hours 0–23 and different.", { apiCode: "task_settings_range" })); });
    fireEvent.change(screen.getByLabelText(/^Gecikmə payı/), { target: { value: "500" } });
    await save();
    expect(m.api.saveTaskSettings).not.toHaveBeenCalled();
    expect(screen.getByText("Dəyərləri yoxlayın: interval 5–1440, pay 0–240, saatlar 0–23 və fərqli.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Gecikmə payı/), { target: { value: "40" } });
    await save();
    expect(toasts().getAllByText(/İntervallar 5–1440 dəq/)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to see it fail** — `./node_modules/.bin/vitest run src/live/screens/admin/TasksTab.test.jsx 2>&1 | tail -5` → FAIL.

- [ ] **Step 3: The tab**

```jsx
// src/live/screens/admin/TasksTab.jsx — Yönetim › Görevler (G3-02 D10): the two shift starts, the grace, the
// vital interval per NEWS2 band. Only band 0 has a vault-sourced default (news2-rcp-2017); the others are
// the hospital's protocol and start empty — an empty band produces no task. Pattern: ProtocolTab.
import React, { useCallback, useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { readErrorText } from "../../apiErrors.js";
import { dayStamp } from "../../i18n/dates.js";
import { Alert, Box, Button, Field, Input, Note, useToast } from "../../ui/index.js";
import { refusedFor } from "./refusal.js";

export const BANDS = Object.freeze([["b0", "gorevler.bandB0"], ["b1_4", "gorevler.bandB1_4"], ["b3_single", "gorevler.bandB3single"], ["b5_6", "gorevler.bandB5_6"], ["b7", "gorevler.bandB7"]]);
const formOf = (s) => ({ a: String(s?.shift_start_a ?? 8), b: String(s?.shift_start_b ?? 20), grace: String(s?.grace_min ?? 30),
  ...Object.fromEntries(BANDS.map(([k]) => [k, s?.intervals?.[k] == null ? "" : String(s.intervals[k])])) });
const int = (text) => (/^\d+$/.test(text) ? Number(text) : NaN);
export function bodyOf(form) {
  return { shift_start_a: int(form.a), shift_start_b: int(form.b), grace_min: int(form.grace),
    intervals: Object.fromEntries(BANDS.map(([k]) => [k, form[k].trim() === "" ? null : int(form[k])])) };
}
export function invalid(body) {
  const hour = (h) => Number.isInteger(h) && h >= 0 && h <= 23;
  if (!hour(body.shift_start_a) || !hour(body.shift_start_b) || body.shift_start_a === body.shift_start_b) return true;
  if (!Number.isInteger(body.grace_min) || body.grace_min < 0 || body.grace_min > 240) return true;
  return Object.values(body.intervals).some((v) => v !== null && (!Number.isInteger(v) || v < 5 || v > 1440));
}

export function TasksTab() {
  const { t } = useI18n();
  const { store } = useSession();
  const toast = useToast();
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(() => formOf(null));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const read = useCallback(async () => {
    try { const got = await store.track(() => store.api.taskSettings()); setSettings(got); setForm(formOf(got)); setError(null); }
    catch (err) { setError(err); }
  }, [store]);
  useEffect(() => { read(); }, [read]);
  const body = bodyOf(form);
  const bad = invalid(body);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  async function save(e) {
    e.preventDefault();
    if (busy) return;
    if (bad) { setTried(true); return; }
    setBusy(true);
    try { const got = await store.track(() => store.api.saveTaskSettings(body)); setSettings(got); setForm(formOf(got)); setTried(false); toast(t("gorevler.settingsSaved")); }
    catch (err) { toast(refusedFor(t, t("gorevler.settingsTab"), err), "error"); await read(); }
    finally { setBusy(false); }
  }
  if (settings === null && error === null) return <Box><p className="m-0 text-13 text-mute">{t("gorevler.settingsLoading")}</p></Box>;
  if (settings === null) return <Alert tone="crit"><p className="m-0">{t("gorevler.settingsReadFailed", { reason: readErrorText(t, error) })}</p><Button size="sm" onClick={read}>{t("admin.retry")}</Button></Alert>;
  const onlyB0 = BANDS.every(([k]) => k === "b0" || settings.intervals?.[k] == null);
  return (
    <div className="grid max-w-[760px] gap-3">
      <Box title={t("gorevler.settingsTitle")} icon="clip" level={2}>
        <p className="m-0 mb-3 text-13 text-mute">{t("gorevler.settingsIntro")}</p>
        {onlyB0 ? <Note tone="info" icon="clock" className="mb-3">{t("gorevler.settingsUnset")}</Note> : null}
        <form noValidate autoComplete="off" onSubmit={save} className="grid gap-2">
          <Field label={t("gorevler.shiftA")}><Input inputMode="numeric" value={form.a} onChange={(e) => set({ a: e.target.value })} /></Field>
          <Field label={t("gorevler.shiftB")}><Input inputMode="numeric" value={form.b} onChange={(e) => set({ b: e.target.value })} /></Field>
          <Field label={t("gorevler.grace")}><Input inputMode="numeric" value={form.grace} onChange={(e) => set({ grace: e.target.value })} /></Field>
          <h3 className="m-0 mt-2 text-14.5 font-bold">{t("gorevler.intervalsTitle")}</h3>
          {BANDS.map(([k, label]) => (
            <Field key={k} label={t(label)} hint={k === "b0" ? undefined : t("gorevler.bandEmpty")}>
              <Input inputMode="numeric" value={form[k]} placeholder={k === "b0" ? "" : "—"} onChange={(e) => set({ [k]: e.target.value })} />
            </Field>
          ))}
          <p className="m-0 text-12 text-mute">{t("gorevler.sourceNote")}</p>
          {tried && bad ? <Alert tone="crit"><p className="m-0">{t("gorevler.settingsInvalid")}</p></Alert> : null}
          {settings.updated_by ? <p className="m-0 text-12 text-mute">{t("gorevler.settingsUpdated", { who: settings.updated_by, time: dayStamp(Date.parse(settings.updated_at), Date.now()) })}</p> : null}
          <div><Button type="submit" variant="primary" busy={busy}>{t("gorevler.save")}</Button></div>
        </form>
      </Box>
    </div>
  );
}
```
Register in `AdminScreen.jsx`: import line `import { TasksTab } from "./TasksTab.jsx"; // G3-02` (blank line after the ProtocolTab import), `TABS` entry after the protocol entry (blank line between):
```js
  // G3-02 — Yönetim › Görevler: shift starts, grace and the vital interval per NEWS2 band (spec D10)
  Object.freeze({ id: "tasks", perm: "structure.manage", labelKey: "gorevler.settingsTab" }),
```
and `TAB_SCREENS`: `  tasks: TasksTab, // G3-02` (blank lines either side).
`rawKeys.test.jsx` `openAt` setup, after the `api.protocolSettings.mockResolvedValue(PROTOCOL_SETTINGS);` block:
```js
      // G3-02: the task queue and its settings tab — unstubbed the screen reads `undefined` and draws nothing.
      api.tasks.mockResolvedValue(TASKS_SWEEP);
      api.taskSettings.mockResolvedValue(TASK_SETTINGS_SWEEP);
```
with, near the other fixtures in that file:
```js
// G3-02: one patient with a late vital and one open hand task, so the sweep meets every state word.
const TASKS_SWEEP = { from: "2026-10-08T04:00:00Z", to: "2026-10-09T04:00:00Z", shift: { start: "2026-10-08T04:00:00Z", end: "2026-10-09T04:00:00Z" }, now: "2026-10-08T10:00:00Z",
  settings: { grace_min: 30, intervals: { b0: 720, b1_4: null, b3_single: null, b5_6: null, b7: null } },
  patients: [{ patient_id: "S-001", bed_key: "REA^01^2", unit_id: "REA-01",
    vital: { state: "late", anchor_at: "2026-10-07T21:00:00Z", due_at: "2026-10-08T09:00:00Z", band: "b0", interval_min: 720, partial: false, skipped_until: null, entries: ["2026-10-08T05:00:00Z"] },
    tasks: [{ id: "t1", patient_id: "S-001", title: "Pansuman", due_at: "2026-10-08T12:00:00Z", target_role: "nurse", state: "open", late: false, created_by: "hem.ayse", created_at: "2026-10-08T09:00:00Z", claimed_by: null, claimed_at: null, closed_by: null, closed_at: null }] }] };
const TASK_SETTINGS_SWEEP = { configured: false, shift_start_a: 8, shift_start_b: 20, grace_min: 30, intervals: { b0: 720, b1_4: null, b3_single: null, b5_6: null, b7: null }, updated_at: null, updated_by: null, default_source: { b0: "news2-rcp-2017" } };
```
(The sweep's board fixture must contain patient `S-001` — it does: `PAYLOAD`'s card.)

- [ ] **Step 4: Run the admin, rawKeys and apiErrors tests**

Run: `./node_modules/.bin/vitest run src/live/screens/admin src/live/rawKeys.test.jsx src/live/apiErrors.test.js 2>&1 | tail -6`
Expected: admin + rawKeys PASS; `apiErrors.test.js` may FAIL on unmapped server words → Task 15.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g3-gorevler && git add dashboard/src/live/screens/admin/TasksTab.jsx dashboard/src/live/screens/admin/TasksTab.test.jsx dashboard/src/live/screens/admin/AdminScreen.jsx dashboard/src/live/rawKeys.test.jsx && git commit -m "feat(dashboard): Yönetim › Görevler settings tab; rawKeys sweep stubs (G3-02 D10)"
```

---

### Task 15: Server words → catalog keys; the dashboard gates

**Files:**
- Modify: `dashboard/src/live/apiErrors.js` (`API_MESSAGE_KEYS` and `API_CODE_KEYS`)
- Test: `dashboard/src/live/apiErrors.test.js` (append one case)

- [ ] **Step 1: Write the failing test**

```js
  it("G3-02: maps the task queue's refusals by code and by words", () => {
    expect(apiErrorKey(Object.assign(new Error("The task is already closed."), { status: 409, apiCode: "task_not_open" })).key).toBe("gorevler.err.notOpen");
    expect(apiErrorKey(Object.assign(new Error("görev bulunamadı"), { status: 404 })).key).toBe("gorevler.err.taskNotFound");
    expect(apiErrorKey(Object.assign(new Error("a person signs a task: this credential names no actor"), { status: 403 })).key).toBe("gorevler.err.person");
  });
```

- [ ] **Step 2: Run to see it fail** — `./node_modules/.bin/vitest run src/live/apiErrors.test.js 2>&1 | tail -5`.

- [ ] **Step 3: Map the words** — in `apiErrors.js` add to `API_MESSAGE_KEYS` (one entry per server word of `api/tasks.py` `WORDS`, `TASK_NOT_FOUND`, `PERSON_REQUIRED`):
```js
  // G3-02: homunculus/api/tasks.py WORDS, TASK_NOT_FOUND, PERSON_REQUIRED
  ["Intervals are 5–1440 minutes, the grace 0–240 minutes, shift hours 0–23 and different.", "gorevler.err.settingsRange"],
  ["The task text is 1–200 characters.", "gorevler.err.titleLength"],
  ["The due time is at most 24 hours back and 7 days ahead.", "gorevler.err.dueWindow"],
  ["The target role is nurse, physician or any.", "gorevler.err.role"],
  ["The task is already closed.", "gorevler.err.notOpen"],
  ["The reason is 1–200 characters.", "gorevler.err.reasonLength"],
  ["No vital measurement is due for this patient.", "gorevler.err.vitalNotDue"],
  ["görev bulunamadı", "gorevler.err.taskNotFound"],
  ["a person signs a task: this credential names no actor", "gorevler.err.person"],
```
and to `API_CODE_KEYS` the seven codes → the same keys (`task_settings_range`, `task_title_length`, `task_due_window`, `task_role_unknown`, `task_not_open`, `task_reason_length`, `vital_not_due`) if `apiErrorKey` consults codes before words (read `apiErrorKey`, lines ~425–460, and follow its order). If the test file's engine scan (`py("api/app.py")` etc.) must also see `api/tasks.py`, add `const TASKS = py("api/tasks.py");` and the `WORDS` constants to its mapped-message set the way `CLINICAL_MESSAGES` is built.

- [ ] **Step 4: The whole dashboard suite and the build**

Run: `./node_modules/.bin/vitest run 2>&1 | tail -5` then `./node_modules/.bin/vite build 2>&1 | tail -6`.
Expected: all files pass; `precache  N entries`, no chunk over 500 kB. Record the numbers for Task 16.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g3-gorevler && git add dashboard/src/live/apiErrors.js dashboard/src/live/apiErrors.test.js && git commit -m "feat(dashboard): the task queue's refusal words in the catalog (G3-02 D11)"
```

---

### Task 16: Docs — spec amendments, roadmap row, the Turkish guide, the plan fold; merge the web branch

**Files:**
- Modify: `docs/superpowers/specs/2026-11-09-g3-gorevlerim-design.md` (D6, D7, D9, D10, D11, §3, §4 — the amendments listed at the top of this plan; CRLF file)
- Modify: `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` (Grup 3 table: a `G3-02` row after `G3-01`; CRLF)
- Modify: `docs/homunculus-rehber-TR.md` (new section «3.13 Görevlerim (Grup 3 · G3-02)» after 3.12, 15–25 lines in the guide's voice: what the screen shows, where the intervals come from, what is NOT decided by the system; CRLF/LF as the file is)
- Modify: `docs/superpowers/plans/2026-11-09-g3-gorevlerim.md` (this plan: a «Gates» block at the top with the recorded numbers)

- [ ] **Step 1:** If the dashboard work ran on `feat/g3-gorevlerim-web`, merge it: `cd /c/tmp/g3-gorevler && git merge --no-ff feat/g3-gorevlerim-web -m "merge: Görevlerim dashboard (G3-02)"`, then run both whole suites once more.
- [ ] **Step 2:** Edit the four documents. Check each file's line ending first (`tr -cd '\r' < file | wc -c`) and preserve it (edit with a Python one-shot that reads/writes `newline=""`, as the capacity-plan edits did).
- [ ] **Step 3:** Roadmap row (Grup 3 table), after the G3-01 row:
```
| G3-02 | Görevlerim (Lane A): nöbetin iş kuyruğu — elle açılan görevler + hastanın son elle NEWS2 setinden ve bandın kurum aralığından türetilen vital ölçüm görevi; `/gorevler` ızgara/liste; Yönetim › Görevler ayarları (nöbet 08/20, pay, bant aralıkları — yalnız «puan 0 → 720 dk» kaynaklı: news2-rcp-2017); izinler `tasks.view`/`tasks.manage`; göç 0017 · spec: [2026-11-09](../specs/2026-11-09-g3-gorevlerim-design.md) · plan: [2026-11-09](2026-11-09-g3-gorevlerim.md) | Kod ✅ <tarih> `<sha>` · kapılar: motor N/M, Postgres P, pano F/T, precache K · **VM'de değil** (B3a 0016'dan sonra, sahibin «onay»ı ile) |
```
- [ ] **Step 4:** Commit: `git add docs/superpowers/specs/2026-11-09-g3-gorevlerim-design.md docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md docs/homunculus-rehber-TR.md docs/superpowers/plans/2026-11-09-g3-gorevlerim.md && git commit -m "docs: G3-02 Görevlerim — spec amendments, roadmap row, guide §3.13, plan fold"` and `git push origin feat/g3-gorevlerim`.

---

### Task 17: Final review and hand-over

- [ ] **Step 1:** Dispatch the final code reviewer (superpowers:requesting-code-review) over `git diff bd5f90d9..HEAD` with the spec; fix what it finds (each fix its own commit, both suites green).
- [ ] **Step 2:** Local walkthrough on the local stack (`docker compose -p g3t …` as G3-01's Task 18 did, synthetic patients only): open `/gorevler` as a nurse, see the vital task of a patient with a hand set, add a task, claim/finish/skip, skip a vital interval, change the settings as admin, see the band interval change the queue. Write the result (date, image shas, what was seen) into the plan's Gates block.
- [ ] **Step 3:** Push; write Lane A the head sha, the gate numbers and the open items (deploy after B3a's 0016 is on main; the owner's «main'e al» and «onay» are separate words). Nothing goes to main or the VM from this plan.

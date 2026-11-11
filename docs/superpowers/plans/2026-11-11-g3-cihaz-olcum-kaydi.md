# G3-05 Cihaz ölçüm kaydı Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every device reading is kept in a durable record tied to the patient's admission — with a list for the readings whose number matches nobody, a way to correct a wrong device value, and a vital task that a device round satisfies.

**Architecture:** Spec `docs/superpowers/specs/2026-11-11-g3-cihaz-olcum-kaydi-design.md` (`31f56279`, approved by the owner 2026-11-11; D1–D20 and §10 Q1–Q4 are final) — read it whole before your first task. The audit trail stays the source of truth; a new table `vital_readings` (migration `0021`) is its projection, written by both doors after their audit rows and repaired by an idempotent `reconcile`. `/ingest`'s tail becomes one function, `_apply_reading`, which the door and the «link an unmatched reading» route both run, so a linked reading enters the real engine exactly as a device's would. The dashboard draws what the engine answers and judges nothing: a record box on the patient screen, «Düzelt», a step inside the bedside page, a neutral rail badge.

**Tech Stack:** Python 3.12 / FastAPI / SQLAlchemy (sync engine, `text()` SQL) / alembic / pytest; React 18 / Vite / vitest / Testing Library; i18n tr · az · ru · en.

---

## Ground rules

Read these before Task 0. They are the rules of `docs/superpowers/plans/2026-11-11-g3-eczane.md` «Ground rules», restated for this worktree.

- **Worktree:** `C:\tmp\g3-cihaz-olcum` (Git Bash `/c/tmp/g3-cihaz-olcum`), branch `feat/g3-cihaz-olcum-kaydi`, head `31f56279` plus this plan's commit. Work ONLY here. Never touch `c:\Users\User\Desktop\Project\Homunculus AI` (the main checkout) or any other worktree under `/c/tmp`. Pushing this feature branch is allowed (`git push origin feat/g3-cihaz-olcum-kaydi`). **Nothing in this plan pushes to `main` or touches the hospital VM:** both are the owner's word, through Lane A.
- **Do not change** `admission/boardkey.py`, `edge/pdq.py`, `edge/pdq_client.py`, `edge/bridge.py`, `edge/mllp.py`, `api/edge_query.py`, `edge/adt.py` (spec D18). If a step seems to need one of them, stop and report.
- **Code exploration:** there is no `graphify-out/` in this worktree: read the files with Grep and Read. If you do find `graphify-out/graph.json` inside `/c/tmp/g3-cihaz-olcum`, run `graphify query "<question>"` before your first grep.
- **Engine tests** run in the FOREGROUND, on a bounded selection (the files or the `-k` a step names), written out in full each time (shell variables do not persist between tool calls):
  ```
  cd /c/tmp/g3-cihaz-olcum/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q <files> 2>&1 | tail -3
  ```
  An implementer never runs the whole suite and never a command longer than 180 s: the controller runs whole suites (Task B3 Step 5, Task G1). **Never run `tests/test_infinity_vm_pilot.py`** (it hangs). **Never background a test run and wait on it**; if something must wait, report first.
- **Never export or set `DATABASE_URL`.** A DB-backed test runs only with `TEST_DATABASE_URL=…` written on the command line itself, against a database whose name contains `test` (`tests/conftest.py` refuses any other), and only on this slice's throwaway Postgres (below). **Never the shared `56432`.**
- **The throwaway Postgres** (`cihaz-pg`, port 56451; the DB tests drop every table). Each line is one foreground call:
  ```bash
  docker run -d --rm --name cihaz-pg -p 127.0.0.1:56451:5432 -e POSTGRES_PASSWORD=cihaz -e POSTGRES_DB=cihaz postgres:16
  timeout 90 bash -c 'until docker exec cihaz-pg pg_isready -h 127.0.0.1 -U postgres -q; do sleep 1; done' && docker exec cihaz-pg createdb -U postgres cihaz_test
  cd /c/tmp/g3-cihaz-olcum/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:cihaz@127.0.0.1:56451/cihaz_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q <files> 2>&1 | tail -3
  docker stop cihaz-pg
  ```
  `pg_isready -h 127.0.0.1` on purpose: the image's first start runs a temporary server on the socket only, and a check without `-h` answers «ready» seconds before that server is shut down again (seen while this plan was written). One pytest at a time against it. Always `docker stop cihaz-pg` at the end; `--rm` then deletes it.
- **Dashboard tests** run from `/c/tmp/g3-cihaz-olcum/dashboard` — **an upper-case drive path** (`/c/tmp/…` in Git Bash, `C:\tmp\…` in PowerShell). From a lower-case `c:\` working directory vitest fails every file with «failed to find the current suite». Command: `npx vitest run <files>`. `node_modules` there is a junction to another worktree (Task 0 makes it): **never `npm install`, never `npm uninstall`, never delete it, never `rm -rf` the `dashboard` folder.** A `not wrapped in act(...)` warning is not a failure.
- **Python scripts** that print Turkish run with `python -I -X utf8` (`-I` ignores `PYTHONIOENCODING`, and cp1252 cannot print «ğ»).
- **Git:** never `git stash`; never `git add -A`, never `git commit -a`. Every commit names its paths and carries the trailer — each task's last step gives the exact command, in this shape:
  ```
  cd /c/tmp/g3-cihaz-olcum && git add -- <paths> && git commit -m "<subject>" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>" -- <paths>
  ```
  The pathspec matters: the other lane may have files staged at the same moment. If `.git/index.lock` exists, the other lane is committing: wait a few seconds and retry; never delete it.
- **Line endings.** `core.autocrlf=true` here: every tracked text file is CRLF in the working tree and LF in the repository. Every block in this plan is LF; the Edit tool matches either way and keeps the file's endings. Edit existing files with the **Edit** tool; create new files with the **Write** tool. **Never write code with a Bash heredoc** — the Bash tool collapses backslashes inside heredocs (it happened three times while this plan was written). After editing an existing file, `git diff --stat -- <file>` must show only the lines you meant (a whole-file diff means the endings were rewritten: restore the file and redo the edit).
- **Find blocks.** Every «find» block below occurs **exactly once** in its file at that point of the plan, and the line numbers printed beside it are the file's at that point: each was applied, in order, to a scratch copy of the tree at `31f56279` when the plan was written, and every «Expected» line was seen there. If a block does not match, stop and report; do not guess.
- **Style.** Every new Python file starts with its `# homunculus-engine/…` path comment and a docstring that says what and why; every new JS/JSX file with a `// src/live/…` comment. Merge seams (`catalog.js` NAMESPACES, `strings.test.js`, `testTokens.testutil.js` `fakeApi`, `denetim.js` EVENT_TYPES, `nginx.conf`, the pin tests) take one block with a blank line either side where the file has them: do not close the gaps — other lanes add theirs beside it.
- **No patient data anywhere** (CLAUDE.md rule 6): synthetic names only («Test Hasta»), synthetic protocol numbers (`202600000001`, `202600000010`), made-up device names (`CONNEX-3A`), keys like `S-001`.
- **Clinical register (hard rules 1 and 5).** This slice adds **no clinical threshold, no score and no colour**. Its numbers are engineering bounds the spec fixes: 24 hours (how far back a reading may be linked or a corrected value typed — G3-01 D7's bound), 7 days (the list's window), 5 minutes (when «alındı» is shown), 10–200 characters (a reason), 10 minutes (an orphaned claim), 48 hours (reconcile's window). The screens record and describe; none gives an order. If a step seems to need a threshold, a judgement on a value or an instruction to a clinician, stop and report.

### Order, lanes and file ownership

1. **Task 0** (each implementer): preflight. The controller records the baseline.
2. **Engine lane, in this order:** B1 → B2 → B3 (then the controller's whole-suite gate, B3 Step 5) → B4 → B5 → B6 → B7 → B8 → B9 → B10. Each depends on the one before it.
3. **Dashboard lane:** W1 (Part A) → W2 → W3 → W4 → W5, and W1 Part B once B7 is committed. The shapes of B6's and B8's answers are frozen in «Interfaces» below, so **W1 Part A and W2 may start at once, in parallel with B1**; the dashboard tests use fixtures in those shapes and never need the engine running. The two lanes share one worktree and no file — except `dashboard/vite.config.js`, whose one line is Task B6's (it travels with nginx's).
4. **Closing (controller):** G1 (gates) → G2 (the local walk) → D1 (docs).

**Red by design, between the lanes.** Three dashboard tests read the ENGINE's sources as text and are red from an engine commit until W1 Part B (Steps 9–11), which runs after B7:

| Dashboard test | Red after | Why | Green after |
|---|---|---|---|
| `src/live/screens/denetim/engineTypes.test.js` | B5 (`reading_unmatched`), B6 (`reading_assigned`, `reading_rejected`) | «Denetim» must name every audit type the engine writes | W1 Step 9 |
| `src/live/apiErrors.test.js` | B7 (`RETRACT_UNKNOWN` reworded) | the dashboard's map is held to `api/clinical.py` | W1 Step 10 |
| `src/live/screens/common/RetractDialog.test.jsx` | W1 Step 10 only if run before B7 | it types the engine's sentence | W1 Step 10, after B7 |

Nothing else may be red at a commit. `src/devProxy.test.js` stays green throughout (B6 edits nginx and the dev proxy together).

| Lane | Tasks | Files (only these) |
|---|---|---|
| Engine | B1–B10 | `homunculus-engine/src/homunculus/api/readings.py` (new), `readings_postgres.py` (new), `admission_keys.py` (new), `app.py`, `clinical.py`, `rehydrate.py`, `trends.py`, `tasks.py`, `tasks_postgres.py`, `prodserver.py`; `homunculus-engine/alembic/versions/0021_vital_readings.py` (new); `homunculus-engine/scripts/backfill_vital_readings.py` (new); `homunculus-engine/tests/` — new: `readings_contract.py`, `test_readings_store.py`, `test_readings_postgres.py`, `test_readings_wiring.py`, `test_readings_ingest.py`, `test_readings_unmatched.py`, `test_readings_api.py`, `test_readings_patient.py`, `test_readings_reconcile.py`, `test_device_retract.py`, `test_ingest_apply.py`, `test_admission_keys.py`, `test_migration_0021_vital_readings.py`; edited: `test_api_scope.py`, `test_api_discharge.py`, `test_kabul_identity.py`, `test_bedside_retract.py`, `test_tasks_api.py`, `test_tasks_schedule.py`, `test_board_permissions.py`, `test_route_inventory.py`, `test_tenant_isolation.py`, `test_nginx_routes.py`; `deploy/local/web/nginx.conf`; `dashboard/vite.config.js` (one line, B6) |
| Dashboard | W1–W5 | `dashboard/src/backendApi.js`, `backendApi.test.js`; `src/live/apiErrors.js`, `apiErrors.test.js`, `rawKeys.test.jsx`; `src/live/session/testTokens.testutil.js`; `src/live/data/boardStore.js`, `boardStore.test.js`, `UnmatchedProvider.jsx` (new), `UnmatchedProvider.test.jsx` (new); `src/live/i18n/catalog.js`, `strings.test.js`, `kayit.strings.test.js` (new), `strings/kayit.js` (new), `strings/olcum.js`, `strings/denetim.js`, `strings/errors.js`, `strings/gorevler.js`; `src/live/screens/patient/readings/` (five new files), `screens/patient/PatientScreen.jsx` (two lines), `screens/patient/trends/` (`trendGeometry.js`, `TrendTable.jsx`, `TrendModal.jsx`, `TrendsBox.jsx`, `trends.testutil.js`, `TrendDevice.test.jsx` new); `screens/bedside/` (`BedsideScreen.jsx`, `PickSteps.jsx` new, `UnmatchedStep.jsx` new, `UnmatchedStep.test.jsx` new, `unmatched.testutil.js` new); `screens/denetim/denetim.js`, `denetim.test.js`; `screens/common/RetractDialog.test.jsx`; `screens/gorevler/` (`TaskDialogs.jsx`, `GorevlerScreen.jsx`, `GorevlerScreen.test.jsx`); `src/live/shell/Shell.jsx`, `Sidebar.jsx` |
| Controller | G1, G2, D1 | `docs/homunculus-rehber-TR.md`, `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`, the spec's «As built» section; the walk's notes outside the repo |

Files other lanes are editing now (spec O5) — keep these diffs minimal and expect a late, trivial merge: `PatientScreen.jsx` (B1b Nakil), `denetim.js` / `strings/denetim.js`, `nginx.conf`, the pin tests, the guide's § number, the migration's `down_revision` (G4-03 Kalite).

### The pins, as read at `31f56279` (re-read at Task 0: other lanes move them)

| Pin | Where | At `31f56279` | After this slice | Task |
|---|---|---|---|---|
| `EXPECTED` (guarded-router routes) | `tests/test_route_permissions.py` 60, counted at 240 | **75** | **75** — unchanged (departure E-1) | — |
| `BOARD_EXPECTED` (routes defined in `api/app.py`) | `tests/test_board_permissions.py` 247–288 | **27** | **28** (`GET /patients/{patient_id}/readings`) | B8 |
| `CALLER_RESOLVED_ROUTES` | `tests/test_route_inventory.py` 27–37 | **10** | **13** (the three `/readings/unmatched…`) | B6 |
| `UNSCOPED_BY_DESIGN` | `tests/test_tenant_isolation.py` 835–871 | `TASK_QUEUE` and the board's | + a set `UNMATCHED_READINGS` (3) + the board's new route | B6, B8 |
| `SPEC_KEYS` (permission keys) | `tests/test_permissions.py` 19–35 | **28** | **28** — no new permission (D10) | — |
| nginx `API_PATHS` | `tests/test_nginx_routes.py` 24–32 | **32** | **33** (`/readings/unmatched`; 34 if Kalite's `/quality` lands first) | B6 |
| nginx API location | `deploy/local/web/nginx.conf` 246 | …`\|tasks\|pharmacy` | + `\|readings` | B6 |
| nginx log map (`$homunculus_log_uri`) | `deploy/local/web/nginx.conf` 36–85 | 2 entries under `/patients/` | + `/patients/:key/readings` | B8 |
| dev proxy | `dashboard/vite.config.js` 79–107 | … `"/pharmacy"` | + `"/readings"` | B6 |
| `EVENT_TYPES` | `dashboard/src/live/screens/denetim/denetim.js` 67–97, counted in `denetim.test.js` 165 | **55** | **58** | W1 Step 9 |
| alembic head | `homunculus-engine/alembic/versions/` | `0019` | `0021` (`down_revision "0019"`; `"0020"` at the merge if Kalite is first) | B2 |
| precache (`vite build`) | the build's `precache N entries` line | **67** (G3-04's gate) | re-measured in Task 0 and Task G1 | G1 |

### Interfaces (the names every task uses — defined once, here)

**The row** — `homunculus.api.readings.Reading` (frozen dataclass; one row of `vital_readings`):

`tenant, received_key, code, value, unit, observed_at, received_at, origin, source` (required, in this order), then `state="recorded", id=0, patient_key=None, admission_id=None, recorded_by=None, unmatched_reason=None, audit_id=None, entry_id=None, resolved_at=None, resolved_by=None, resolve_reason=None, voided_at=None, voided_by=None, void_reason=None`.

Constants: `ORIGIN_DEVICE="device"`, `ORIGIN_MANUAL="manual"`; `STATE_RECORDED="recorded"`, `STATE_UNMATCHED="unmatched"`, `STATE_ASSIGNED="assigned"`, `STATE_REJECTED="rejected"`; `REASON_UNKNOWN="unknown"`, `REASON_DISCHARGED="discharged"`; `POLICY_CARD="card"`, `POLICY_UNMATCHED="unmatched"`, `UNKNOWN_POLICIES`; `MANUAL_CODES` (= `RETRACTABLE_CODES - FLUID_CODES`: the eight bedside codes); `SOURCE_MAX=64`, `UNIT_MAX=16`; `EPOCH`; `UNMATCHED_WINDOW` (7 days), `LINK_MAX_AGE` (24 h), `SET_MAX=50`, `REJECT_MIN_REASON_CHARS=10`, `REJECT_MAX_REASON_CHARS=200`, `READINGS_HOURS=(24, 72, 168)`, `RECEIVED_LATE` (5 min), `RECONCILE_WINDOW` (48 h), `RECONCILE_PAGE=1000`, `CLAIM_STALE` (10 min).

A **claim** is a row in state `assigned` whose `patient_key` is still `None`: a link or a rejection is being made for it (D12). `audit_id` is the arrival's audit row (`ingest`, `chart` or `reading_unmatched`); `entry_id` the row the engine replays and «hatalı giriş» names — the same row for a matched reading, the link's own `ingest` row for an assigned one, `None` otherwise.

**The store** — `ReadingStore` (Protocol), implemented by `InMemoryReadingStore(*, admitted=None, admitted_at=None)` and `PostgresReadingStore(url, *, ssl_required=False)`:

```python
durable: bool
def add(self, row: Reading) -> Reading | None            # None: the table already holds it (audit_id, or D14's tuple)
def seen(self, tenant, received_key, code, observed_at, source, value) -> bool
def have(self, tenant, audit_ids) -> set[int]
def get(self, tenant, ids) -> list[Reading]              # ascending id
def for_patient(self, tenant, patient_key, *, since, until) -> list[Reading]    # by observed_at, id
def unmatched(self, tenant, *, since) -> list[Reading]   # state unmatched, by received_at, id
def claim(self, tenant, ids, *, by, at) -> list[Reading] # all or none: raises ReadingNotUnmatched
def claims(self, tenant) -> list[Reading]
def release(self, tenant, ids) -> None                   # claims only
def finalize(self, tenant, reading_id, *, patient_key, admission_id, entry_id) -> None   # a claim only
def reject(self, tenant, ids, *, reason) -> None         # claims only
def void(self, tenant, entry_id, *, by, at, reason) -> bool
def admission_of(self, tenant, key) -> str | None
def open_stays(self, tenant) -> dict[str, datetime]      # card key → when the stay began
def close(self) -> None
```

**Pure functions of `api/readings.py`:** `device_source(obs) -> str`; `device_reading(tenant, obs, *, received_at, audit_id, reason=None) -> Reading`; `manual_reading(tenant, obs, *, received_at, entry_id, recorded_by) -> Reading`; `set_key(row)`; `unmatched_sets(rows, now) -> list[dict]`; `patient_readings(rows, *, patient_id, hours, now) -> dict`; `reading_refusal(status, code) -> HTTPException`; `reconcile(store, audit, *, tenant, now, since=None, stays=None, dry_run=False) -> dict[str, int]` (keys `recorded, unmatched, voided, finalized, rejected, released, skipped`); `readings_router(*, caller, sees, target, admission_for, apply, audit, store, clock=…) -> APIRouter`.

**`create_app`** gains `readings: ReadingStore | None = None` and `unknown_readings: str = POLICY_CARD`; `app.state.readings`, `app.state.reconcile_readings` (one pass), `app.state.reconcile_task`. **Closures of `create_app`** (`api/app.py`): `async _apply_reading(hospital, obs, record, wall_now, *, reading=None) -> tuple[list, AuditRecord]`; `_admission_for(hospital, record) -> str | None`; `_file_recorded(hospital, record, rows) -> None`; `_resent(hospital, obs) -> bool`; `_file_unmatched(hospital, obs, reason, dropped) -> dict`; `async _reading_visibility(caller, authorization) -> Callable[[str], bool]`; `async _link_target(caller, authorization, patient_id)`; `async _reconcile_once()`. **`prodserver`:** `_readings(url)`, `_unknown_readings(url, env=None)`; env `READINGS_UNKNOWN_KEY=card`.

**Audit rows** (types are module constants of `api/readings.py`):

| Type | patient_id · subject | Payload |
|---|---|---|
| `ingest` (unchanged) | patient key · code | `{value, unit, obs_ts, device}` + `"reading": <vital_readings id>` only for a linked reading |
| `reading_unmatched` (`READING_UNMATCHED`) | the number as received · code | `{value, unit, obs_ts, device, reason}` — reason `unknown` or `discharged` |
| `reading_assigned` (`READING_ASSIGNED`) | the target patient · `"reading"` | `{readings: [ids], received_key, reason, device, obs_ts, actor}` — one per set |
| `reading_rejected` (`READING_REJECTED`) | the number as received · `"reading"` | `{readings: [ids], received_key, device, obs_ts, reason, actor}` — one per set |
| `chart_retract` (unchanged for a `chart` row) | patient key · code | `{entry, code, value, obs_ts, reason, retracted_by}` + `"origin": "device", "device"` when the entry is an `ingest` row |
| `reading_dropped_discharged` | — | still written by `POST /clinical/{id}`; no longer by `/ingest` |

**HTTP:**

- `POST /ingest` (device token) answers one of: `{"patient_id", "alerts": [...]}` (applied) · `{"patient_id", "duplicate": true}` (D14) · `{"patient_id", "dropped": "discharged"}` · `{"patient_id", "dropped": "unmatched"}`. Always 200, except 500 when an unmatched reading's table row cannot be written (D7).
- `GET /readings/unmatched` → `{"count": <sets>, "sets": [{"received_key", "reason", "source", "observed_at", "received_at", "linkable", "readings": [{"id", "code", "value", "unit"}]}]}` — newest arrival first; `linkable` is «measured within 24 h» (departure E-4).
- `POST /readings/unmatched/assign` `{"readings": [ids], "patient_id": key}` → `{"assigned": [ids], "patient_id", "alerts": [kinds]}`.
- `POST /readings/unmatched/reject` `{"readings": [ids], "reason": "…"}` → `{"rejected": [ids]}`.
- `GET /patients/{patient_id}/readings?hours=24|72|168` → `{"patient_id", "hours", "since", "until", "sets": [{"observed_at", "received_at", "received_late", "origin", "source", "recorded_by", "readings": [{"id", "code", "value", "unit", "origin", "source", "recorded_by", "entry", "voided": null | {"reason", "by", "at"}}]}]}` — newest set first.
- `GET /patients/{id}/trends` — each channel gains `"device": [{"entry", "at", "value", "source", "retracted": null | {"reason", "by", "at"}}]`.
- `POST /clinical/{id}/entries/{entry}/retract` — `entry` may be an `ingest` row; answer unchanged (`{"retracted", "code", "alerts"}`).

**Refusals** — the three list routes need `clinical.chart` (403 `permission required: clinical.chart`) and a person (403 `READING_NEEDS_PERSON` = `a person links or rejects a reading: this credential names no actor`). Coded refusals answer `{"detail": {"code", "message"}}`:

| Code | Status | When |
|---|---|---|
| `reading_not_unmatched` | 409 | an id is not a waiting reading this caller may see (linked, rejected, unknown, another hospital's, or a discharged patient's outside the caller's scope) |
| `reading_set_mixed` | 422 | the ids are of two sets |
| `reading_too_old` | 409 | measured more than 24 h ago (link only) |
| `reading_target_discharged` | 409 | the link's target is a discharged admission |
| `reading_reason_length` | 422 | a rejection's reason is not 10–200 characters after trim |
| `reading_hours` | 400 | `hours` is not 24, 72 or 168 |

Also: 404 `hasta bulunamadı` (the link's target is out of scope — audited `scope_denied` — or on no board; the record read's patient is out of scope or unknown); 422 with a plain sentence for a malformed body; 503 `kapsam şu anda okunamıyor`. `RETRACT_UNKNOWN` becomes `bu hastada böyle bir ölçüm değeri yok`.

**Dashboard:** `api.patientReadings(patientId, hours = 24)`, `api.unmatchedReadings()`, `api.assignReadings(readings, patientId)`, `api.rejectReadings(readings, reason)`; `board.store.assignReadings(readings, patientId)` (reloads the board), `board.store.rejectReadings(readings, reason)`; `useReadings(patientId, hours)` → `{data, error, refresh}`, `READINGS_POLL_MS = 60_000`, `READINGS_WINDOWS = [24, 72, 168]`; `ReadingsBox({patientId, bed, nowMs, canChart, onWritten})`, `sourceText(t, origin, source, recordedBy)`; `CorrectDialog({bed, what: {code, label, value, time, source, observedMs}, nowMs, onRetract, onChart, onDone, onClose})` with outcomes `"corrected" | "retracted" | "partial" | "already" | "uncertain"`; `parseDevice(raw)`, `deviceEntryOf(device, point)`; `UnmatchedProvider`, `useUnmatched()` → `{sets, count, phase, error, reload}`, `UNMATCHED_POLL_MS = 60_000`; `PickList`, `IdentityStep`, `bedOf` (`screens/bedside/PickSteps.jsx`); `UnmatchedStep({patients, nowMs, known, onBack})`; `READING_CODE_KEYS` (`apiErrors.js`); the i18n namespace `kayit` (72 keys), `olcum.device`, `gorevler.vitalPartialNote`, `denetim.type.readingUnmatched|readingAssigned|readingRejected`.

### File structure — what each new file is for

| File | Its one responsibility |
|---|---|
| `api/readings.py` | the row, the store protocol and the in-memory store; the doors' row builders; the list's sets and the patient's record as answers; the three list routes; `reconcile` |
| `api/readings_postgres.py` | the store on `vital_readings` |
| `api/admission_keys.py` | the one SQL fragment «card key → open admission», shared by the task store and the readings store |
| `alembic/versions/0021_vital_readings.py` | the table, its six indexes, the audit index — schema only |
| `scripts/backfill_vital_readings.py` | the optional deploy step: `reconcile` for the stays open now |
| `tests/readings_contract.py` | what every store does — run against memory and against Postgres |
| `dashboard/…/i18n/strings/kayit.js` | every new word of the slice, in four languages |
| `dashboard/…/patient/readings/useReadings.js`, `ReadingsBox.jsx`, `CorrectDialog.jsx` | the record's read; the box; «Düzelt» |
| `dashboard/…/data/UnmatchedProvider.jsx` | the shell's one read of the unmatched list |
| `dashboard/…/bedside/PickSteps.jsx` | the patient list and the identity question, moved unchanged out of `BedsideScreen.jsx` |
| `dashboard/…/bedside/UnmatchedStep.jsx` | the list, the link, the rejection |

Modified files and their line ranges are listed under each task's **Files**.

### Departures from the spec (E-n: what the spec says · what the code is · what the plan does)

- **E-1 · the pin of the three list routes.** Spec §7: «routes of a router by `test_route_permissions.py` `EXPECTED` (75 → 78)». `EXPECTED` covers only the routers of `GUARDED_MODULES`, which guard with `require_permission` dependencies; a factory router bound to the app's `_caller` — what spec §3 asks for («Store pattern as `tasks`… the router») — is pinned by `test_route_inventory.py` `CALLER_RESOLVED_ROUTES` and `test_tenant_isolation.py`, as the task queue's eight routes are. The plan: `EXPECTED` stays **75**; `CALLER_RESOLVED_ROUTES` 10 → 13; a new set in `UNSCOPED_BY_DESIGN`; the permission and the person-only rule are held by `tests/test_readings_api.py`.
- **E-2 · a sixth index.** Spec §3 lists five indexes. `void` finds a row by `(tenant, entry_id)` on every withdrawal; the plan adds `ix_vital_readings_tenant_entry (tenant, entry_id) WHERE entry_id IS NOT NULL`.
- **E-3 · the claim also guards a rejection, and an orphan is 10 minutes old.** Spec D12 describes the claim for a link. A rejection has the same race (two desks), so it runs claim → `reading_rejected` row → table; a failed append releases the claim. The spec gives no age for an orphaned claim: the plan uses `CLAIM_STALE = 10 min`, released by `reconcile` (at start and hourly).
- **E-4 · two booleans the spec's answers do not list.** `linkable` on an unmatched set (measured within 24 h) and `received_late` on a record set (arrival later than measurement by more than 5 min, D16). Both are the spec's own rules, decided by the engine so that the browser compares no two times.
- **E-5 · the link's target must be on a board.** Spec D11: the target «must pass `_require_patient` and must not be discharged». For an unscoped caller `_require_patient` passes any text, and `_apply_reading` would then create a nameless card. The plan adds: an identity record or a patient the engine has measured, else 404.
- **E-6 · one rejection is one set.** Spec §4 gives `reading_set_mixed` for the link only; the plan applies it to a rejection too (one `reading_rejected` row per set, as the spec's «one row per set» for links).
- **E-7 · `hours` outside 24/72/168 is a coded 400.** The spec does not say how it is refused. A literal `detail="…"` in `api/app.py` is swept by the dashboard's `apiErrors.test.js`; the plan answers `reading_hours` through `reading_refusal`, like the list's refusals.
- **E-8 · O2 is fixed, not only tested.** Spec O2 asks for a test of «an empty `device.display` replays as "replay"». The plan's test holds the replayed reading EQUAL to the live one, which needs one branch in `rehydrate.observation_of`: an `ingest` row's `device` is replayed as sent, an empty string included. A row with no `device` key still replays as `"replay"`.
- **E-9 · the dev proxy line is B6's, and W1 has two parts.** The task list puts the dev proxy in W1. `devProxy.test.js` holds nginx ⊆ vite, so the line must travel with nginx's (B6), as G3-04's E6 did. W1's audit labels and the reworded sentence follow the engine (after B7): W1 Part B.
- **E-10 · the dashboard's reads go through hooks, its writes through the board store.** Spec §6 lists four calls on `backendApi.js` and `boardStore.js`. The two reads follow `useFluids` (the session's `track` and `api`, no store method); only `assignReadings` and `rejectReadings` are board-store methods, because a link changes a card.
- **E-11 · the backfill needs `--open-only`, and bounds each stay by its start.** Spec D19 names `--open-only --dry-run`. An admission from before migration 0015 is keyed by the patient's H-number, which an earlier stay shares; so the store answers each open stay's start (`open_stays`) and the backfill files only readings measured since it. Without `--open-only` the script refuses (exit 2): closed stays have no screen yet (spec §9).
- **E-12 · widths.** The table's `source` is 64 characters and `unit` 16 (spec §3); a feed's text is cut to them at the door, and D14 compares the source as kept.

---

## The tasks

### Task 0: Preflight — the baseline is green before anything changes (each implementer, once; the controller records the numbers)

**Files:** none.

- [ ] **Step 1: The worktree**

Run: `cd /c/tmp/g3-cihaz-olcum && git status --short && git log --oneline -2 && git rev-parse --abbrev-ref HEAD`
Expected: no changes listed; the head is this plan's commit, its parent `31f56279 docs(spec): G3-05 — the owner's «evet» on the design (2026-11-11)`; branch `feat/g3-cihaz-olcum-kaydi`.

- [ ] **Step 2 (engine lane): pytest imports the worktree's code, and the pins are what the plan read**

Run: `cd /c/tmp/g3-cihaz-olcum/homunculus-engine && PYTHONPATH=src /c/tmp/f7-py312/venv/Scripts/python.exe -c "import homunculus; print(homunculus.__file__)"`
Expected: a path under `C:\tmp\g3-cihaz-olcum\homunculus-engine\src`. Anything else: stop and report.

Run: `cd /c/tmp/g3-cihaz-olcum/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_permissions.py tests/test_board_permissions.py tests/test_route_permissions.py tests/test_route_inventory.py tests/test_nginx_routes.py tests/test_access_log_redaction.py tests/test_tenant_isolation.py tests/test_audit_postgres.py 2>&1 | tail -3`
Expected: `180 passed, 145 skipped` — measured per file at `31f56279`: `test_permissions.py` 21, `test_board_permissions.py` 75, `test_route_permissions.py` 9 passed / 6 skipped, `test_route_inventory.py` 4, `test_nginx_routes.py` 50, `test_access_log_redaction.py` 14, `test_tenant_isolation.py` 1 passed / 133 skipped, `test_audit_postgres.py` 6 passed / 6 skipped. **If a number differs, another lane has merged since:** re-read the pin table of «The pins» against the files (`len(EXPECTED)`, the entries of `BOARD_EXPECTED`, `CALLER_RESOLVED_ROUTES`, `API_PATHS`, `SPEC_KEYS`), tell the controller the new values, and shift this plan's counts by the difference — the edits themselves do not change.

The other files this plan edits, measured at `31f56279`: `test_api_ingest.py` 11, `test_api_discharge.py` 14, `test_api_identity_ingest.py` 15, `test_api_scope.py` 72, `test_kabul_identity.py` 29, `test_bedside_retract.py` 49, `test_bedside_rebuild.py` 33, `test_rehydrate.py` 19, `test_tasks_api.py` 28, `test_tasks_schedule.py` 20, `test_tasks_store.py` 5, `test_fluids.py` 37, `test_pharmacy.py` 41, `test_alert_lifecycle.py` + `test_api_notifications.py` 34, `test_tasks_postgres.py` 6 skipped.

- [ ] **Step 3 (dashboard lane): the toolchain**

`dashboard/node_modules` does not exist in a fresh worktree. Make the junction to the installed tree (never `npm install`):

```bash
cd /c/tmp/g3-cihaz-olcum/dashboard && (ls node_modules/.bin/vitest >/dev/null 2>&1 || cmd //c "mklink /J node_modules C:\tmp\homunculus-g1\dashboard\node_modules")
```

Run: `cd /c/tmp/g3-cihaz-olcum/dashboard && git status --short . && npx vitest run src/devProxy.test.js src/live/screens/denetim src/live/i18n/strings.test.js 2>&1 | tail -5`
Expected: nothing listed by `git status` (`node_modules` is ignored); no failure — `devProxy.test.js` 5 among them. (Vitest must be started from this upper-case path; see «Ground rules».)

- [ ] **Step 4 (controller only): the baseline of the whole suites**

Run the whole no-DB engine suite and the whole dashboard suite as Task G1 Steps 1 and 4 run them, at this plan's commit, and keep the numbers; G1's expected totals are these plus the deltas it states. Measured when the plan was written, at `31f56279`:

- engine, no database (in the worktree itself, read-only): `1298 passed, 814 skipped` · `1722 passed, 114 skipped` · `1002 passed, 390 skipped` for the three chunks — **4022 passed, 1318 skipped**, no failure;
- dashboard (on a scratch copy of the tree): `Test Files  165 passed (165)`, `Tests  4448 passed (4448)`;
- `npx vite build`: `precache  67 entries (1512.21 KiB)`, no `larger than 500 kB` line; the largest chunk is the shared `Toast-*.js`, **489.17 kB** (it holds the dictionaries of every namespace — see Task G1 Step 5).

---

### Task B1: The readings store — the row, the protocol, the in-memory store

**Files:**
- Test: `homunculus-engine/tests/readings_contract.py` (new)
- Test: `homunculus-engine/tests/test_readings_store.py` (new)
- Create: `homunculus-engine/src/homunculus/api/readings.py`

The table's row as a frozen dataclass, the store protocol every later task calls, and the store the no-DB suite runs on. No route, no door and no SQL yet. The contract class is written once here and run again against Postgres in Task B2.

- [ ] **Step 1: Write the contract every store passes**

Create `homunculus-engine/tests/readings_contract.py`:

```python
# homunculus-engine/tests/readings_contract.py
"""G3-05: what every ReadingStore does, whatever holds the rows (spec §3, §7 «store»). A test class per backend
inherits this and provides the `store` fixture: tests/test_readings_store.py (memory) and
tests/test_readings_postgres.py (the table of migration 0021). Synthetic numbers and values only
(CLAUDE.md rule 6): 202600000001 is no patient's protocol."""
from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest

from homunculus.api.readings import (
    ORIGIN_DEVICE, ORIGIN_MANUAL, REASON_DISCHARGED, REASON_UNKNOWN, STATE_ASSIGNED, STATE_RECORDED,
    STATE_REJECTED, STATE_UNMATCHED, Reading, ReadingNotUnmatched,
)

T0 = datetime(2026, 11, 11, 9, 0, tzinfo=timezone.utc)
KEY = "202600000001"
TYPO = "202600000010"


def device(code="spo2", value=97.0, *, key=KEY, at=T0, audit_id=None, source="CONNEX-3A", tenant="h1",
           state=STATE_RECORDED, reason=None) -> Reading:
    """A device reading as `/ingest` files it: matched (`recorded`, under its own key) or unmatched."""
    matched = state == STATE_RECORDED
    return Reading(tenant=tenant, received_key=key, code=code, value=value, unit="%", observed_at=at,
                   received_at=at + timedelta(seconds=20), origin=ORIGIN_DEVICE, source=source, state=state,
                   patient_key=key if matched else None, unmatched_reason=reason, audit_id=audit_id,
                   entry_id=audit_id if matched else None)


def manual(code="resp_rate", value=16.0, *, key=KEY, at=T0, audit_id=None, by="hem.ayse") -> Reading:
    """A hand entry as `POST /clinical/{id}` files it."""
    return Reading(tenant="h1", received_key=key, code=code, value=value, unit="/min", observed_at=at,
                   received_at=at, origin=ORIGIN_MANUAL, source="clinician", state=STATE_RECORDED,
                   patient_key=key, recorded_by=by, audit_id=audit_id, entry_id=audit_id)


def unmatched(code="spo2", value=97.0, *, key=TYPO, at=T0, audit_id=None, reason=REASON_UNKNOWN,
              source="CONNEX-3A") -> Reading:
    return device(code, value, key=key, at=at, audit_id=audit_id, source=source, state=STATE_UNMATCHED,
                  reason=reason)


class ReadingStoreContract:
    """Inherit, and provide `store`: an empty ReadingStore."""

    # ------------------------------------------------------------------ add, seen, have
    def test_add_gives_the_row_an_id_and_keeps_every_field(self, store):
        saved = store.add(device(audit_id=11))
        assert saved is not None and saved.id > 0
        assert saved == replace(device(audit_id=11), id=saved.id)
        assert store.get("h1", [saved.id]) == [saved]

    def test_a_second_row_for_one_audit_row_is_not_added(self, store):
        """UNIQUE (tenant, audit_id): `reconcile` adds what is missing and nothing twice (spec D7)."""
        first = store.add(manual(audit_id=7))
        assert store.add(manual(value=18.0, audit_id=7)) is None
        assert store.for_patient("h1", KEY, since=T0 - timedelta(hours=1), until=T0 + timedelta(hours=1)) == [first]

    def test_the_same_device_reading_is_not_added_twice(self, store):
        """D14's index: one number, one code, one time, one device, one value — whatever its audit row."""
        assert store.add(device(audit_id=1)) is not None
        assert store.add(device(audit_id=2)) is None
        assert store.add(device(value=96.0, audit_id=3)) is not None        # another value is another reading
        assert store.add(device(source="CONNEX-3B", audit_id=4)) is not None  # another device too

    def test_two_equal_hand_entries_are_both_kept(self, store):
        """The index is the device's alone: a nurse may type the same value at the same minute twice."""
        assert store.add(manual(audit_id=1)) is not None
        assert store.add(manual(audit_id=2)) is not None

    def test_seen_knows_a_device_reading_in_any_state(self, store):
        assert store.seen("h1", KEY, "spo2", T0, "CONNEX-3A", 97.0) is False
        store.add(device(audit_id=1))
        store.add(unmatched("heart_rate", 88.0, audit_id=2))
        assert store.seen("h1", KEY, "spo2", T0, "CONNEX-3A", 97.0) is True
        assert store.seen("h1", TYPO, "heart_rate", T0, "CONNEX-3A", 88.0) is True
        assert store.seen("h1", KEY, "spo2", T0, "CONNEX-3A", 96.0) is False
        assert store.seen("h1", KEY, "spo2", T0 + timedelta(seconds=1), "CONNEX-3A", 97.0) is False
        assert store.seen("h2", KEY, "spo2", T0, "CONNEX-3A", 97.0) is False     # another hospital's is not ours

    def test_seen_never_takes_a_hand_entry_for_a_device_reading(self, store):
        store.add(replace(manual("spo2", 97.0, audit_id=1), source="CONNEX-3A"))
        assert store.seen("h1", KEY, "spo2", T0, "CONNEX-3A", 97.0) is False

    def test_have_names_the_audit_rows_already_filed(self, store):
        store.add(device(audit_id=5))
        store.add(manual(audit_id=6))
        assert store.have("h1", [5, 6, 7]) == {5, 6}
        assert store.have("h2", [5, 6, 7]) == set()
        assert store.have("h1", []) == set()

    # ------------------------------------------------------------------ the two lists
    def test_a_patients_rows_come_oldest_first_within_the_window(self, store):
        early = store.add(device(at=T0 - timedelta(hours=2), audit_id=1))
        late = store.add(manual(at=T0 - timedelta(minutes=5), audit_id=2))
        store.add(device(at=T0 - timedelta(hours=30), audit_id=3))                 # before the window
        store.add(device(key="202600000002", audit_id=4))                           # another patient
        store.add(unmatched(audit_id=5))                                            # filed under nobody
        rows = store.for_patient("h1", KEY, since=T0 - timedelta(hours=24), until=T0)
        assert rows == [early, late]
        assert store.for_patient("h2", KEY, since=T0 - timedelta(hours=24), until=T0) == []

    def test_the_unmatched_list_is_the_waiting_rows_by_arrival(self, store):
        b = store.add(unmatched("heart_rate", 88.0, at=T0, audit_id=2))
        a = store.add(unmatched("spo2", 97.0, at=T0 - timedelta(minutes=1), audit_id=1))
        store.add(unmatched(at=T0 - timedelta(days=8), audit_id=3))                 # older than the list's window
        store.add(device(audit_id=4))                                               # matched: not listed
        assert store.unmatched("h1", since=T0 - timedelta(days=7)) == [a, b]
        assert store.unmatched("h2", since=T0 - timedelta(days=7)) == []

    def test_a_discharged_reason_travels_with_the_row(self, store):
        row = store.add(unmatched(key=KEY, reason=REASON_DISCHARGED, audit_id=1))
        assert store.unmatched("h1", since=T0 - timedelta(days=7)) == [row]
        assert row.unmatched_reason == REASON_DISCHARGED and row.patient_key is None

    # ------------------------------------------------------------------ claim, release, finalize, reject
    def test_a_claim_takes_every_row_or_none(self, store):
        a = store.add(unmatched("spo2", 97.0, audit_id=1))
        b = store.add(unmatched("heart_rate", 88.0, audit_id=2))
        claimed = store.claim("h1", [a.id, b.id], by="hem.ayse", at=T0)
        assert [r.id for r in claimed] == [a.id, b.id]
        assert all(r.state == STATE_ASSIGNED and r.patient_key is None and r.resolved_by == "hem.ayse"
                   and r.resolved_at == T0 for r in claimed)
        assert store.unmatched("h1", since=T0 - timedelta(days=7)) == []            # in work: off the list
        assert [r.id for r in store.claims("h1")] == [a.id, b.id]
        c = store.add(unmatched("temperature", 37.1, audit_id=3))
        with pytest.raises(ReadingNotUnmatched):
            store.claim("h1", [a.id, c.id], by="hem.zeynep", at=T0)                 # `a` is taken
        assert store.get("h1", [c.id])[0].state == STATE_UNMATCHED                  # … so `c` is not either

    def test_a_claim_of_an_unknown_or_foreign_row_is_refused(self, store):
        a = store.add(unmatched(audit_id=1))
        with pytest.raises(ReadingNotUnmatched):
            store.claim("h1", [a.id, a.id + 999], by="hem.ayse", at=T0)
        with pytest.raises(ReadingNotUnmatched):
            store.claim("h2", [a.id], by="hem.ayse", at=T0)
        with pytest.raises(ReadingNotUnmatched):
            store.claim("h1", [], by="hem.ayse", at=T0)
        assert store.get("h1", [a.id])[0].state == STATE_UNMATCHED

    def test_a_released_claim_is_waiting_again(self, store):
        a = store.add(unmatched(audit_id=1))
        store.claim("h1", [a.id], by="hem.ayse", at=T0)
        store.release("h1", [a.id])
        assert store.get("h1", [a.id]) == [a]                                       # as it was: nobody's
        assert store.claims("h1") == []

    def test_release_touches_only_a_claim(self, store):
        a = store.add(unmatched(audit_id=1))
        store.claim("h1", [a.id], by="hem.ayse", at=T0)
        store.finalize("h1", a.id, patient_key=KEY, admission_id=None, entry_id=40)
        store.release("h1", [a.id])
        linked = store.get("h1", [a.id])[0]
        assert (linked.state, linked.patient_key, linked.entry_id) == (STATE_ASSIGNED, KEY, 40)

    def test_finalize_files_a_claimed_row_under_the_patient(self, store):
        a = store.add(unmatched(audit_id=1))
        store.claim("h1", [a.id], by="hem.ayse", at=T0)
        store.finalize("h1", a.id, patient_key=KEY, admission_id=None, entry_id=40)
        linked = store.get("h1", [a.id])[0]
        assert (linked.state, linked.patient_key, linked.entry_id, linked.audit_id) == (STATE_ASSIGNED, KEY, 40, 1)
        assert linked.received_key == TYPO                                          # the number as typed stays
        assert store.claims("h1") == []
        assert store.for_patient("h1", KEY, since=T0 - timedelta(hours=1), until=T0 + timedelta(hours=1)) == [linked]
        assert store.seen("h1", TYPO, "spo2", T0, "CONNEX-3A", 97.0) is True        # a re-send is still known

    def test_reject_closes_a_claimed_row_with_its_reason(self, store):
        a = store.add(unmatched(audit_id=1))
        store.claim("h1", [a.id], by="hem.ayse", at=T0)
        store.reject("h1", [a.id], reason="hasta taburcu, ölçüm başkasının")
        closed = store.get("h1", [a.id])[0]
        assert (closed.state, closed.resolved_by, closed.resolved_at) == (STATE_REJECTED, "hem.ayse", T0)
        assert closed.resolve_reason == "hasta taburcu, ölçüm başkasının" and closed.patient_key is None
        assert store.claims("h1") == [] and store.unmatched("h1", since=T0 - timedelta(days=7)) == []
        assert store.seen("h1", TYPO, "spo2", T0, "CONNEX-3A", 97.0) is True        # a re-send does not re-create it

    def test_reject_touches_only_a_claim(self, store):
        a = store.add(unmatched(audit_id=1))
        store.reject("h1", [a.id], reason="on karakterden uzun")                    # never claimed: nothing happens
        assert store.get("h1", [a.id]) == [a]

    # ------------------------------------------------------------------ void
    def test_void_marks_the_row_of_an_entry_once(self, store):
        row = store.add(device(audit_id=31))
        assert store.void("h1", 31, by="hem.ayse", at=T0, reason="yanlış hastadan ölçüldü") is True
        voided = store.get("h1", [row.id])[0]
        assert (voided.voided_by, voided.voided_at, voided.void_reason) == ("hem.ayse", T0, "yanlış hastadan ölçüldü")
        assert voided.state == STATE_RECORDED and voided.value == 97.0              # the value is kept
        assert store.void("h1", 31, by="hem.zeynep", at=T0 + timedelta(minutes=1), reason="ikinci kez") is False
        assert store.get("h1", [row.id])[0] == voided                               # the first word stands

    def test_void_of_an_entry_nobody_filed_is_false(self, store):
        assert store.void("h1", 999, by="hem.ayse", at=T0, reason="yanlış hastadan ölçüldü") is False
        store.add(device(audit_id=31))
        assert store.void("h2", 31, by="hem.ayse", at=T0, reason="yanlış hastadan ölçüldü") is False

    def test_get_keeps_to_the_tenant_and_orders_by_id(self, store):
        a = store.add(device(audit_id=1))
        b = store.add(device("heart_rate", 88.0, audit_id=2))
        assert store.get("h1", [b.id, a.id]) == [a, b]
        assert store.get("h2", [a.id, b.id]) == []
        assert store.get("h1", []) == []
```

Create `homunculus-engine/tests/test_readings_store.py`:

```python
# homunculus-engine/tests/test_readings_store.py
"""G3-05: the in-memory ReadingStore — the contract every store passes (tests/readings_contract.py), and what
only this one has: the admissions a test tells it about."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from homunculus.api.readings import EPOCH, InMemoryReadingStore
from tests.readings_contract import KEY, ReadingStoreContract

ADMISSION = "11111111-1111-4111-8111-111111111111"       # a synthetic admission id


class TestInMemoryReadingStore(ReadingStoreContract):
    @pytest.fixture()
    def store(self):
        return InMemoryReadingStore()


def test_the_memory_store_is_not_durable():
    """`create_app` starts the hourly reconcile for a durable store only (spec D7)."""
    assert InMemoryReadingStore().durable is False


def test_the_admission_of_a_key_is_what_the_test_said():
    store = InMemoryReadingStore(admitted={("h1", KEY): ADMISSION})
    assert store.admission_of("h1", KEY) == ADMISSION
    assert store.admission_of("h1", "202600000002") is None
    assert store.admission_of("h2", KEY) is None
    assert store.open_stays("h1") == {KEY: EPOCH} and store.open_stays("h2") == {}


def test_the_start_of_an_open_stay_is_what_the_test_said():
    start = datetime(2026, 11, 10, 8, 0, tzinfo=timezone.utc)
    store = InMemoryReadingStore(admitted={("h1", KEY): ADMISSION}, admitted_at={("h1", KEY): start})
    assert store.open_stays("h1") == {KEY: start}


def test_close_is_harmless():
    assert InMemoryReadingStore().close() is None
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/tmp/g3-cihaz-olcum/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_readings_store.py 2>&1 | tail -3`
Expected: an error at collection — `ModuleNotFoundError: No module named 'homunculus.api.readings'`.

- [ ] **Step 3: Write the module**

Create `homunculus-engine/src/homunculus/api/readings.py`:

```python
# homunculus-engine/src/homunculus/api/readings.py
"""G3-05 «Cihaz ölçüm kaydı»: the per-admission record of what was measured (spec §3).

One row per measured value in `vital_readings` (migration 0021), written by both doors: every `/ingest`
observation (`origin` device) and the bedside set of `POST /clinical/{id}` (`origin` manual). A device reading
whose number matches nobody — unknown, or a discharged admission's — is a row too, in state `unmatched`, with
its value: an authorised person links it to the right admission or rejects it.

THE AUDIT TRAIL STAYS THE SOURCE OF TRUTH (spec D7). The engine, the restart's replay and «who did what» read the
audit; this table is its projection, written after the audit row, and every row can be derived again from audit
rows (`reconcile`, Task B10). The table exists for what the audit cannot answer cheaply: «this stay's
measurements, with their source», and «which readings wait for a patient».

This file: the row, the store protocol and the in-memory store (Task B1). The Postgres store is
`api/readings_postgres.py`. No name, no free text but the two reasons a person typed (≤ 200 characters): a
patient is the board's number, as in the audit."""
from __future__ import annotations

import logging
from collections.abc import Iterable
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from typing import Protocol

log = logging.getLogger(__name__)

#: «Since ever»: the start of a stay nobody gave a time for (the in-memory store), and a bound that excludes nothing.
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)

#: `origin`: who produced the value.
ORIGIN_DEVICE = "device"
ORIGIN_MANUAL = "manual"
#: `state`. `recorded`: filed under its patient at arrival. `unmatched`: waits in the list. `assigned`: an
#: unmatched reading a person linked — or, while `patient_key` is still NULL, one a link or a rejection is being
#: made for (the claim, spec D12). `rejected`: closed with a reason; the value is kept.
STATE_RECORDED = "recorded"
STATE_UNMATCHED = "unmatched"
STATE_ASSIGNED = "assigned"
STATE_REJECTED = "rejected"
#: `unmatched_reason`: no identity record under the number, or a discharged admission's number.
REASON_UNKNOWN = "unknown"
REASON_DISCHARGED = "discharged"


@dataclass(frozen=True)
class Reading:
    """One measured value (a row of `vital_readings`). `received_key` is the number the door received;
    `patient_key` the card key the value is filed under — None while unmatched, claimed or rejected.
    `audit_id` is the arrival's audit row (`ingest`, `chart` or `reading_unmatched`); `entry_id` the row the
    engine replays and «hatalı giriş» names (`ingest` or `chart`) — the same row for a matched reading, the
    link's own `ingest` row for an assigned one, None for a reading the engine never took."""
    tenant: str
    received_key: str
    code: str
    value: float
    unit: str
    observed_at: datetime
    received_at: datetime
    origin: str
    source: str                          # the device as it named itself, or "clinician"
    state: str = STATE_RECORDED
    id: int = 0                          # the store's; 0 until added
    patient_key: str | None = None
    admission_id: str | None = None      # admissions.id as text; None for a HIS-fed patient
    recorded_by: str | None = None       # a hand entry's `charted_by`
    unmatched_reason: str | None = None
    audit_id: int | None = None
    entry_id: int | None = None
    resolved_at: datetime | None = None  # the claim: when and by whom it was linked or rejected
    resolved_by: str | None = None
    resolve_reason: str | None = None    # a rejection's reason
    voided_at: datetime | None = None    # «hatalı giriş»: when, by whom, why
    voided_by: str | None = None
    void_reason: str | None = None


class ReadingNotUnmatched(Exception):
    """`claim` on rows that are not all waiting: another hand linked or rejected one first, or an id is not a
    reading of this tenant. Nothing was claimed."""


class ReadingStore(Protocol):
    """What the doors, the list's routes and `reconcile` need. `tenant` is the hospital slug (the audit's key).

    `add` answers the stored row, or None when the table already holds it: the same audit row (`audit_id`), or —
    a device reading — the same number, code, time, device and value (spec D14).
    `claim` moves EVERY row named from `unmatched` to `assigned` (with `resolved_by`, `resolved_at`, and
    `patient_key` still None) or none of them: ReadingNotUnmatched. `release` puts a claim back; `finalize` files
    one under a patient; `reject` closes claims as `rejected`. The three touch claims only, so each is safe to
    repeat. `void` marks the row of an engine entry once: True when it did. `admission_of` is the open
    admission a card key belongs to (spec D8); `open_stays` every open admission's card key with the time the
    stay began (the backfill's bound, D19)."""
    durable: bool

    def add(self, row: Reading) -> Reading | None: ...
    def seen(self, tenant: str, received_key: str, code: str, observed_at: datetime, source: str,
             value: float) -> bool: ...
    def have(self, tenant: str, audit_ids: Iterable[int]) -> set[int]: ...
    def get(self, tenant: str, ids: Iterable[int]) -> list[Reading]: ...
    def for_patient(self, tenant: str, patient_key: str, *, since: datetime, until: datetime) -> list[Reading]: ...
    def unmatched(self, tenant: str, *, since: datetime) -> list[Reading]: ...
    def claim(self, tenant: str, ids: Iterable[int], *, by: str, at: datetime) -> list[Reading]: ...
    def claims(self, tenant: str) -> list[Reading]: ...
    def release(self, tenant: str, ids: Iterable[int]) -> None: ...
    def finalize(self, tenant: str, reading_id: int, *, patient_key: str, admission_id: str | None,
                 entry_id: int) -> None: ...
    def reject(self, tenant: str, ids: Iterable[int], *, reason: str) -> None: ...
    def void(self, tenant: str, entry_id: int, *, by: str, at: datetime, reason: str) -> bool: ...
    def admission_of(self, tenant: str, key: str) -> str | None: ...
    def open_stays(self, tenant: str) -> dict[str, datetime]: ...
    def close(self) -> None: ...


def _same_reading(row: Reading, tenant: str, received_key: str, code: str, observed_at: datetime, source: str,
                  value: float) -> bool:
    """D14's identity of a device reading: the columns of the table's unique index."""
    return (row.origin == ORIGIN_DEVICE and row.tenant == tenant and row.received_key == received_key
            and row.code == code and row.observed_at == observed_at and row.source == source
            and row.value == value)


def _is_claim(row: Reading) -> bool:
    return row.state == STATE_ASSIGNED and row.patient_key is None


class InMemoryReadingStore:
    """For tests and for a deployment without Postgres (rows vanish on restart). `admitted` lets a test say
    what the admissions table would — `{(tenant, key): admission id}` — and `admitted_at` when each of those
    stays began (EPOCH when the test does not say)."""
    durable = False

    def __init__(self, *, admitted: dict[tuple[str, str], str] | None = None,
                 admitted_at: dict[tuple[str, str], datetime] | None = None) -> None:
        self._rows: dict[int, Reading] = {}
        self._next = 1
        self._admitted = dict(admitted or {})
        self._admitted_at = dict(admitted_at or {})

    def _of(self, tenant: str) -> list[Reading]:
        return [r for r in self._rows.values() if r.tenant == tenant]

    def add(self, row: Reading) -> Reading | None:
        for held in self._of(row.tenant):
            if row.audit_id is not None and held.audit_id == row.audit_id:
                return None
            if row.origin == ORIGIN_DEVICE and _same_reading(held, row.tenant, row.received_key, row.code,
                                                             row.observed_at, row.source, row.value):
                return None
        saved = replace(row, id=self._next)
        self._rows[saved.id] = saved
        self._next += 1
        return saved

    def seen(self, tenant: str, received_key: str, code: str, observed_at: datetime, source: str,
             value: float) -> bool:
        return any(_same_reading(r, tenant, received_key, code, observed_at, source, value)
                   for r in self._rows.values())

    def have(self, tenant: str, audit_ids: Iterable[int]) -> set[int]:
        wanted = set(audit_ids)
        return {r.audit_id for r in self._of(tenant) if r.audit_id in wanted}

    def get(self, tenant: str, ids: Iterable[int]) -> list[Reading]:
        wanted = set(ids)
        return sorted((r for r in self._of(tenant) if r.id in wanted), key=lambda r: r.id)

    def for_patient(self, tenant: str, patient_key: str, *, since: datetime, until: datetime) -> list[Reading]:
        rows = [r for r in self._of(tenant) if r.patient_key == patient_key and since <= r.observed_at <= until]
        return sorted(rows, key=lambda r: (r.observed_at, r.id))

    def unmatched(self, tenant: str, *, since: datetime) -> list[Reading]:
        rows = [r for r in self._of(tenant) if r.state == STATE_UNMATCHED and r.received_at >= since]
        return sorted(rows, key=lambda r: (r.received_at, r.id))

    def claim(self, tenant: str, ids: Iterable[int], *, by: str, at: datetime) -> list[Reading]:
        wanted = sorted(set(ids))
        rows = [r for r in self.get(tenant, wanted) if r.state == STATE_UNMATCHED]
        if not wanted or len(rows) != len(wanted):
            raise ReadingNotUnmatched(wanted)
        for r in rows:
            self._rows[r.id] = replace(r, state=STATE_ASSIGNED, resolved_by=by, resolved_at=at)
        return self.get(tenant, wanted)

    def claims(self, tenant: str) -> list[Reading]:
        return sorted((r for r in self._of(tenant) if _is_claim(r)), key=lambda r: r.id)

    def release(self, tenant: str, ids: Iterable[int]) -> None:
        for r in self.get(tenant, ids):
            if _is_claim(r):
                self._rows[r.id] = replace(r, state=STATE_UNMATCHED, resolved_by=None, resolved_at=None)

    def finalize(self, tenant: str, reading_id: int, *, patient_key: str, admission_id: str | None,
                 entry_id: int) -> None:
        for r in self.get(tenant, [reading_id]):
            if _is_claim(r):
                self._rows[r.id] = replace(r, patient_key=patient_key, admission_id=admission_id, entry_id=entry_id)

    def reject(self, tenant: str, ids: Iterable[int], *, reason: str) -> None:
        for r in self.get(tenant, ids):
            if _is_claim(r):
                self._rows[r.id] = replace(r, state=STATE_REJECTED, resolve_reason=reason)

    def void(self, tenant: str, entry_id: int, *, by: str, at: datetime, reason: str) -> bool:
        for r in self._of(tenant):
            if r.entry_id == entry_id and r.voided_at is None:
                self._rows[r.id] = replace(r, voided_at=at, voided_by=by, void_reason=reason)
                return True
        return False

    def admission_of(self, tenant: str, key: str) -> str | None:
        return self._admitted.get((tenant, key))

    def open_stays(self, tenant: str) -> dict[str, datetime]:
        return {key: self._admitted_at.get((t, key), EPOCH) for (t, key) in self._admitted if t == tenant}

    def close(self) -> None:
        return None
```

- [ ] **Step 4: Run it to see it pass**

Run: `cd /c/tmp/g3-cihaz-olcum/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_readings_store.py 2>&1 | tail -3`
Expected: `24 passed` (the contract's 20 and this file's 4).

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g3-cihaz-olcum && git add -- homunculus-engine/src/homunculus/api/readings.py homunculus-engine/tests/readings_contract.py homunculus-engine/tests/test_readings_store.py && git commit -m "feat(readings): the readings store — the row, the protocol, the in-memory store (G3-05 D6, D14)" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>" -- homunculus-engine/src/homunculus/api/readings.py homunculus-engine/tests/readings_contract.py homunculus-engine/tests/test_readings_store.py
```

---

### Task B2: Migration `0021_vital_readings.py`, the Postgres store, the shared key→admission SQL, `prodserver._readings`

**Files:**
- Test: `homunculus-engine/tests/test_admission_keys.py` (new)
- Create: `homunculus-engine/src/homunculus/api/admission_keys.py`
- Modify: `homunculus-engine/src/homunculus/api/tasks_postgres.py` — lines 13–14, lines 21–23, lines 122–127 (as each step finds the file)
- Test: `homunculus-engine/tests/test_migration_0021_vital_readings.py` (new)
- Create: `homunculus-engine/alembic/versions/0021_vital_readings.py`
- Test: `homunculus-engine/tests/test_readings_postgres.py` (new)
- Create: `homunculus-engine/src/homunculus/api/readings_postgres.py`
- Test: `homunculus-engine/tests/test_readings_wiring.py` (new)
- Modify: `homunculus-engine/src/homunculus/api/prodserver.py` — line 50, line 505 (as each step finds the file)

The table of spec §3 and the store on it. The SQL that ties a card key to its open admission moves out of `tasks_postgres.py` into one module both stores read (spec D8); `admission/boardkey.py` is not touched. **`down_revision` is `"0019"` on this branch. If G4-03 Kalite's `0020` is on main when this branch merges, the merge changes it to `"0020"` and nothing else (spec §8, O5); `alembic heads` must print one head either way.**

The DB-backed halves of this task run only on the throwaway Postgres of «Ground rules» (`cihaz-pg`). An implementer without it writes the files, runs the no-DB steps, and reports the DB steps as not run.

- [ ] **Step 1: The shared SQL — write the failing test**

Create `homunculus-engine/tests/test_admission_keys.py`:

```python
# homunculus-engine/tests/test_admission_keys.py
"""G3-05 (spec D8): one SQL fragment ties a card key to its open admission — the rule of admission/boardkey.py,
`protocol_no`, else (an admission from before 0015) the patient's H-number — and both stores that need it read
it from one place. No database: the fragment is text, and what it must say is checked as text."""
from __future__ import annotations

from homunculus.admission.models import OPEN_ADMISSION_STATES
from homunculus.api import admission_keys, readings_postgres, tasks_postgres


def test_the_open_states_are_the_models():
    named = {part.strip("'") for part in admission_keys.OPEN_STATES.strip("()").split(",")}
    assert named == {state.value for state in OPEN_ADMISSION_STATES}
    assert "DRAFT" in named                      # a draft has a card from POST /admissions: a valid target (D8)


def test_the_key_is_the_protocol_or_a_legacy_admissions_h_number():
    sql = admission_keys.OPEN_ADMISSION_OF_KEY
    assert "a.protocol_no = :key OR (a.protocol_no IS NULL AND p.patient_number = :key)" in sql
    assert "t.slug = :tenant" in sql and admission_keys.OPEN_STATES in sql
    assert admission_keys.NEWEST_FIRST.strip() == "ORDER BY a.admission_datetime DESC LIMIT 1"


def test_both_stores_read_the_one_fragment():
    assert not hasattr(tasks_postgres, "_OPEN_STATES")            # the copy is gone
    assert tasks_postgres.ADMITTED_AT == ("SELECT a.admission_datetime " + admission_keys.OPEN_ADMISSION_OF_KEY
                                          + admission_keys.NEWEST_FIRST)
    assert readings_postgres.ADMISSION_OF == ("SELECT CAST(a.id AS text) " + admission_keys.OPEN_ADMISSION_OF_KEY
                                              + admission_keys.NEWEST_FIRST)
    assert readings_postgres.OPEN_STAYS == admission_keys.OPEN_STAYS
    assert admission_keys.OPEN_STAYS.startswith("SELECT COALESCE(a.protocol_no, p.patient_number), a.admission_datetime ")
```

Run: `cd /c/tmp/g3-cihaz-olcum/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_admission_keys.py 2>&1 | tail -3`
Expected: an error at collection — `ImportError: cannot import name 'admission_keys'`.

- [ ] **Step 2: The shared module, and `tasks_postgres` reading it**

Create `homunculus-engine/src/homunculus/api/admission_keys.py`:

```python
# homunculus-engine/src/homunculus/api/admission_keys.py
"""The SQL that ties a card key to its open admission (G3-05, spec D8) — admission/boardkey.py's rule, as the
api world's stores read it: an admission made since migration 0015 is keyed by its protocol number, one from
before it by the patient's H-number. Text fragments for `text()` SQL on a sync engine, bound with `:tenant` (the
hospital slug) and `:key`. Two readers: the task queue's admission time (api/tasks_postgres.py) and the readings
store's admission id (api/readings_postgres.py). A DRAFT is open: its card exists from POST /admissions."""
from __future__ import annotations

#: admission/models.py OPEN_ADMISSION_STATES, as the enum's values (tests/test_admission_keys.py holds them equal).
OPEN_STATES = "('DRAFT','ACTIVE','PENDING_DISCHARGE','PENDING_TRANSFER')"
_JOINS = ("FROM admissions a JOIN patients p ON p.id = a.patient_id JOIN tenants t ON t.id = a.tenant_id "
          "WHERE t.slug = :tenant AND CAST(a.state AS text) IN " + OPEN_STATES)
#: `SELECT <columns of a> ` + this + NEWEST_FIRST: the open admission whose card key is `:key`.
OPEN_ADMISSION_OF_KEY = (_JOINS + " AND (a.protocol_no = :key OR (a.protocol_no IS NULL AND p.patient_number = :key))")
NEWEST_FIRST = " ORDER BY a.admission_datetime DESC LIMIT 1"
#: The card key of every open admission of `:tenant`, with the time the stay began.
OPEN_STAYS = "SELECT COALESCE(a.protocol_no, p.patient_number), a.admission_datetime " + _JOINS
```

In `homunculus-engine/src/homunculus/api/tasks_postgres.py`, find (lines 13–14):

```python
from homunculus.api.audit_postgres import POOL_TIMEOUT_S, bounded_connect_args, to_sync_url
from homunculus.api.tasks import BAND_KEYS, TaskNotOpen, TaskRow, TaskSettings
```

Replace with:

```python
from homunculus.api.admission_keys import NEWEST_FIRST, OPEN_ADMISSION_OF_KEY      # G3-05 (D8)
from homunculus.api.audit_postgres import POOL_TIMEOUT_S, bounded_connect_args, to_sync_url
from homunculus.api.tasks import BAND_KEYS, TaskNotOpen, TaskRow, TaskSettings
```

In the same file, find (lines 21–23):

```python
_SELECT = "SELECT " + ", ".join(_COLUMNS) + " FROM tasks"
#: admission/models.py OPEN_ADMISSION_STATES, as the enum's values
_OPEN_STATES = "('DRAFT','ACTIVE','PENDING_DISCHARGE','PENDING_TRANSFER')"
```

Replace with:

```python
_SELECT = "SELECT " + ", ".join(_COLUMNS) + " FROM tasks"
#: When the open admission of a card key began (G3-05: the fragment is api/admission_keys.py's, shared).
ADMITTED_AT = "SELECT a.admission_datetime " + OPEN_ADMISSION_OF_KEY + NEWEST_FIRST
```

In the same file, find (lines 122–127):

```python
        with self._engine.connect() as conn:
            return conn.execute(text(
                "SELECT a.admission_datetime FROM admissions a JOIN patients p ON p.id = a.patient_id "
                "JOIN tenants t ON t.id = a.tenant_id WHERE t.slug = :tenant AND CAST(a.state AS text) IN " + _OPEN_STATES +
                " AND (a.protocol_no = :key OR (a.protocol_no IS NULL AND p.patient_number = :key)) "
                "ORDER BY a.admission_datetime DESC LIMIT 1"), {"tenant": tenant, "key": patient_id}).scalar_one_or_none()
```

Replace with:

```python
        with self._engine.connect() as conn:
            return conn.execute(text(ADMITTED_AT), {"tenant": tenant, "key": patient_id}).scalar_one_or_none()
```

- [ ] **Step 3: The migration — write its test**

Create `homunculus-engine/tests/test_migration_0021_vital_readings.py`:

```python
# homunculus-engine/tests/test_migration_0021_vital_readings.py
"""Migration 0021 (G3-05, spec §3, D19, D20) on the real chain (`clean_db`, never `create_all`): the table with
its checks and its foreign key, the six indexes, the audit index that closes G3-01's O3; schema only — no row is
written; the downgrade drops exactly this, and 0019 → 0021 → 0019 → 0021 runs. Synthetic rows only."""
from __future__ import annotations

import importlib.util
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
from alembic import command
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

from tests.conftest import ENGINE_ROOT, requires_db

MIGRATION = ENGINE_ROOT / "alembic" / "versions" / "0021_vital_readings.py"
T0 = datetime(2026, 11, 11, 9, 0, tzinfo=timezone.utc)
INDEXES = {
    "ix_vital_readings_tenant_patient_observed", "ix_vital_readings_admission_observed",
    "ix_vital_readings_unmatched", "ix_vital_readings_tenant_entry",
    "uq_vital_readings_tenant_audit", "uq_vital_readings_device",
}
INSERT = text(
    "INSERT INTO vital_readings (tenant, received_key, patient_key, admission_id, code, value, unit, observed_at, "
    "received_at, origin, source, state, unmatched_reason, audit_id, entry_id) VALUES ('h1', :key, :patient, "
    ":admission, 'spo2', 97, '%', :at, :at, :origin, 'CONNEX-3A', :state, :reason, :audit, :audit)")


def _module():
    spec = importlib.util.spec_from_file_location("m0021", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_revision_follows_0019_on_this_branch():
    """No database: the file's own word. `"0020"` instead, at the merge, if Kalite's migration is on main first
    (spec §8) — then this line changes with it, and tests/test_audit_postgres.py still finds one head."""
    module = _module()
    assert (module.revision, module.down_revision) == ("0021", "0019")


def _row(conn, **over):
    values = {"key": "202600000001", "patient": "202600000001", "admission": None, "at": T0, "origin": "device",
              "state": "recorded", "reason": None, "audit": 1, **over}
    conn.execute(INSERT, values)


def _admission(conn) -> uuid.UUID:
    """A tenant, a bed and one ACTIVE admission on it (the columns migration 0018's test writes)."""
    tenant, site, unit, room, bed, patient, admission = (uuid.uuid4() for _ in range(7))
    conn.execute(text("INSERT INTO tenants (id, name, slug, country_code) VALUES (:id, 'Sentetik', 'h1', 'AZ')"),
                 {"id": tenant})
    conn.execute(text("INSERT INTO sites (id, tenant_id, name) VALUES (:id, :t, 'Ana bina')"), {"id": site, "t": tenant})
    conn.execute(text("INSERT INTO units (id, site_id, name, unit_type) VALUES (:id, :s, 'Reanimasiya', 'ADULT_ICU')"),
                 {"id": unit, "s": site})
    conn.execute(text("INSERT INTO rooms (id, unit_id, name) VALUES (:id, :u, 'Otaq 1')"), {"id": room, "u": unit})
    conn.execute(text("INSERT INTO beds (id, room_id, label) VALUES (:id, :r, '1')"), {"id": bed, "r": room})
    conn.execute(text("INSERT INTO patients (id, tenant_id, display_name, date_of_birth, sex, patient_number, "
                      "created_at) VALUES (:id, :t, 'x', 'x', 'x', 'H-0000001', now())"), {"id": patient, "t": tenant})
    conn.execute(text(
        "INSERT INTO admissions (id, patient_id, tenant_id, state, admission_datetime, admitting_unit_id, bed_id, "
        "admission_diagnosis_free_text, protocol_no) VALUES (:id, :p, :t, 'ACTIVE', now(), :u, :b, 'Sentetik tanı', "
        "'202600000001')"), {"id": admission, "p": patient, "t": tenant, "u": unit, "b": bed})
    return admission


@requires_db
def test_the_table_its_indexes_and_the_audit_index(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    names = inspect(engine)
    columns = {c["name"]: c for c in names.get_columns("vital_readings")}
    assert set(columns) == {
        "id", "tenant", "received_key", "patient_key", "admission_id", "code", "value", "unit", "observed_at",
        "received_at", "origin", "source", "recorded_by", "state", "unmatched_reason", "audit_id", "entry_id",
        "resolved_at", "resolved_by", "resolve_reason", "voided_at", "voided_by", "void_reason"}
    assert not columns["received_key"]["nullable"] and columns["patient_key"]["nullable"]
    assert columns["admission_id"]["nullable"] and columns["audit_id"]["nullable"]
    with engine.connect() as conn:
        found = {r[0] for r in conn.execute(text("SELECT indexname FROM pg_indexes WHERE tablename = 'vital_readings'"))}
        audit = {r[0] for r in conn.execute(text("SELECT indexname FROM pg_indexes WHERE tablename = 'audit'"))}
        device = conn.execute(text("SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_vital_readings_device'")).scalar_one()
        rows = conn.execute(text("SELECT count(*) FROM vital_readings")).scalar_one()
    assert INDEXES <= found
    assert "ix_audit_tenant_patient_id" in audit
    assert "UNIQUE" in device and "(tenant, received_key, code, observed_at, source, value)" in device
    assert "origin" in device and "device" in device                     # partial: the device's rows only
    assert rows == 0                                                     # schema only (D19)
    [fk] = names.get_foreign_keys("vital_readings")
    assert (fk["referred_table"], fk["constrained_columns"], fk["options"].get("ondelete")) == (
        "admissions", ["admission_id"], "RESTRICT")


@requires_db
def test_the_checks_and_the_two_unique_indexes_hold(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        _row(conn)
    for bad in ({"origin": "monitor"}, {"state": "open"}, {"reason": "typo", "state": "unmatched"}):
        with pytest.raises(IntegrityError), engine.begin() as conn:
            _row(conn, audit=2, at=T0.replace(minute=1), **bad)
    with pytest.raises(IntegrityError), engine.begin() as conn:
        _row(conn, audit=1, at=T0.replace(minute=2))                     # the same audit row twice
    with pytest.raises(IntegrityError), engine.begin() as conn:
        _row(conn, audit=3)                                              # the same device reading twice
    with engine.begin() as conn:
        _row(conn, audit=4, origin="manual")                             # … but a hand entry may equal it
        _row(conn, audit=None, at=T0.replace(minute=3))                  # and rows with no audit id never collide
        _row(conn, audit=None, at=T0.replace(minute=4))


@requires_db
def test_an_admission_with_a_reading_cannot_be_deleted(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        admission = _admission(conn)
        _row(conn, admission=admission)
    with pytest.raises(IntegrityError), engine.begin() as conn:
        conn.execute(text("DELETE FROM admissions WHERE id = :id"), {"id": admission})


@requires_db
def test_downgrade_drops_exactly_this_and_the_round_trip_runs(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    command.downgrade(cfg, "0019")
    with engine.connect() as conn:
        tables = {r[0] for r in conn.execute(text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'"))}
        audit = {r[0] for r in conn.execute(text("SELECT indexname FROM pg_indexes WHERE tablename = 'audit'"))}
        version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
    assert "vital_readings" not in tables and "tasks" in tables and "audit" in tables
    assert "ix_audit_tenant_patient_id" not in audit and "ix_audit_tenant_event_id" in audit
    assert version == "0019"
    command.upgrade(cfg, "head")
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM vital_readings")).scalar_one() == 0
```

Run: `cd /c/tmp/g3-cihaz-olcum/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_migration_0021_vital_readings.py 2>&1 | tail -3`
Expected: `1 failed, 4 skipped` — `FileNotFoundError` for `0021_vital_readings.py` (the four DB tests skip without `TEST_DATABASE_URL`).

- [ ] **Step 4: Write the migration**

Create `homunculus-engine/alembic/versions/0021_vital_readings.py`:

```python
# homunculus-engine/alembic/versions/0021_vital_readings.py
"""G3-05 Cihaz ölçüm kaydı (spec §3, D6, D14, D19): `vital_readings`, and the audit index (tenant, patient_id, id)

Revision 0021. On its own branch it follows G3-04's 0019; if G4-03 Kalite's 0020 is on main first, the merge sets
`down_revision = "0020"` (spec §8) — `alembic heads` prints one head either way.

* `vital_readings`: one row per measured value — a device reading `/ingest` took (`origin` device) or a bedside
  value typed at `POST /clinical/{id}` (`origin` manual). Keyed by the tenant SLUG (`tenant`), as `tasks` and the
  audit rows are: this table lives in the api world. `received_key` is the number the door received;
  `patient_key` the card key the value is filed under (NULL while unmatched, claimed or rejected);
  `admission_id` the stay (admissions.id, ON DELETE RESTRICT; NULL for a HIS-fed patient). `state`: recorded |
  unmatched | assigned | rejected. `audit_id` is the arrival's audit row, `entry_id` the row the engine replays
  and «hatalı giriş» names. No name and no free text but two reasons a person typed (≤ 200 characters).
* Indexes: (tenant, patient_key, observed_at) — the patient screen's box; (admission_id, observed_at) where the
  stay is known — a stay's record; (tenant, received_at) where unmatched — the list; (tenant, entry_id) where
  set — the withdrawal's mark; UNIQUE (tenant, audit_id) where set — `reconcile` adds nothing twice; UNIQUE
  (tenant, received_key, code, observed_at, source, value) for device rows — a re-sent reading is recognised (D14).
* `ix_audit_tenant_patient_id` on `audit` (tenant, patient_id, id): the one-patient reads — the withdrawal's
  rebuild, trends, the single-patient task anchor (G3-01's open item O3). `IF NOT EXISTS`, as 0013's index. A
  plain CREATE INDEX inside the migration's transaction: writes to `audit` wait while it builds, which happens
  when the API's start command runs `alembic upgrade head`, before it serves.

SCHEMA ONLY: no row is written (D19; `scripts/backfill_vital_readings.py` is the optional step for the patients
in bed). PURELY ADDITIVE: an image from before this revision serves against it. Downgrade drops the table with
its rows and the audit index; no audit content is touched (D20).
ONE STATEMENT PER op.execute (asyncpg; see 0004, 0010, 0013).

Revision ID: 0021
Revises: 0019
Create Date: 2026-11-11
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import DOUBLE_PRECISION, UUID

revision: str = "0021"
down_revision: Union[str, None] = "0019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "vital_readings"
# Whole statements, not f-strings: the one-statement-per-execute check reads them (tests/test_audit_postgres.py).
_CREATE_AUDIT_INDEX = ("CREATE INDEX IF NOT EXISTS ix_audit_tenant_patient_id"
                       " ON audit (tenant, patient_id, id)")
_DROP_AUDIT_INDEX = "DROP INDEX IF EXISTS ix_audit_tenant_patient_id"


def upgrade() -> None:
    op.create_table(
        TABLE,
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("tenant", sa.String(64), nullable=False),
        sa.Column("received_key", sa.String(128), nullable=False),
        sa.Column("patient_key", sa.String(128), nullable=True),
        sa.Column("admission_id", UUID(as_uuid=False),
                  sa.ForeignKey("admissions.id", ondelete="RESTRICT", name="fk_vital_readings_admission"),
                  nullable=True),
        sa.Column("code", sa.String(32), nullable=False),
        sa.Column("value", DOUBLE_PRECISION(), nullable=False),
        sa.Column("unit", sa.String(16), nullable=False),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("origin", sa.String(8), nullable=False),
        sa.Column("source", sa.String(64), nullable=False),
        sa.Column("recorded_by", sa.String(128), nullable=True),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("unmatched_reason", sa.String(16), nullable=True),
        sa.Column("audit_id", sa.BigInteger(), nullable=True),
        sa.Column("entry_id", sa.BigInteger(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by", sa.String(128), nullable=True),
        sa.Column("resolve_reason", sa.String(200), nullable=True),
        sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("voided_by", sa.String(128), nullable=True),
        sa.Column("void_reason", sa.String(200), nullable=True),
        sa.CheckConstraint("origin IN ('device','manual')", name="ck_vital_readings_origin"),
        sa.CheckConstraint("state IN ('recorded','unmatched','assigned','rejected')", name="ck_vital_readings_state"),
        sa.CheckConstraint("unmatched_reason IS NULL OR unmatched_reason IN ('unknown','discharged')",
                           name="ck_vital_readings_reason"),
    )
    op.create_index("ix_vital_readings_tenant_patient_observed", TABLE, ["tenant", "patient_key", "observed_at"])
    op.create_index("ix_vital_readings_admission_observed", TABLE, ["admission_id", "observed_at"],
                    postgresql_where=sa.text("admission_id IS NOT NULL"))
    op.create_index("ix_vital_readings_unmatched", TABLE, ["tenant", "received_at"],
                    postgresql_where=sa.text("state = 'unmatched'"))
    op.create_index("ix_vital_readings_tenant_entry", TABLE, ["tenant", "entry_id"],
                    postgresql_where=sa.text("entry_id IS NOT NULL"))
    op.create_index("uq_vital_readings_tenant_audit", TABLE, ["tenant", "audit_id"], unique=True,
                    postgresql_where=sa.text("audit_id IS NOT NULL"))
    op.create_index("uq_vital_readings_device", TABLE,
                    ["tenant", "received_key", "code", "observed_at", "source", "value"], unique=True,
                    postgresql_where=sa.text("origin = 'device'"))
    op.execute(_CREATE_AUDIT_INDEX)


def downgrade() -> None:
    op.execute(_DROP_AUDIT_INDEX)
    op.drop_index("uq_vital_readings_device", table_name=TABLE)
    op.drop_index("uq_vital_readings_tenant_audit", table_name=TABLE)
    op.drop_index("ix_vital_readings_tenant_entry", table_name=TABLE)
    op.drop_index("ix_vital_readings_unmatched", table_name=TABLE)
    op.drop_index("ix_vital_readings_admission_observed", table_name=TABLE)
    op.drop_index("ix_vital_readings_tenant_patient_observed", table_name=TABLE)
    op.drop_table(TABLE)
```

- [ ] **Step 5: The Postgres store — write its tests**

Create `homunculus-engine/tests/test_readings_postgres.py`:

```python
# homunculus-engine/tests/test_readings_postgres.py
"""G3-05: the Postgres ReadingStore on migration 0021's table — the contract every store passes
(tests/readings_contract.py), and the admission a card key is stamped with (spec D8): an open admission, a
DRAFT, a legacy H-number key, a transferred stay. Runs only with TEST_DATABASE_URL (the throwaway container).
Synthetic rows only."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from alembic import command
from sqlalchemy import create_engine, text

from homunculus.api.audit_postgres import to_sync_url
from homunculus.api.readings_postgres import PostgresReadingStore
from tests.conftest import TEST_DATABASE_URL, requires_db
from tests.readings_contract import KEY, T0, ReadingStoreContract, device, unmatched

pytestmark = [requires_db]
STATES = {"DRAFT", "ACTIVE", "PENDING_DISCHARGE", "PENDING_TRANSFER", "DISCHARGED", "TRANSFERRED"}


@pytest.fixture()
def migrated(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    sync = create_engine(to_sync_url(TEST_DATABASE_URL))
    yield sync
    sync.dispose()


def _tenant(conn, slug: str) -> uuid.UUID:
    tid = uuid.uuid4()
    conn.execute(text("INSERT INTO tenants (id, name, slug, country_code) VALUES (:id, :n, :s, 'AZ')"),
                 {"id": tid, "n": f"Sentetik {slug}", "s": slug})
    return tid


def _bed(conn, tenant: uuid.UUID) -> tuple[uuid.UUID, uuid.UUID]:
    site, unit, room, bed = (uuid.uuid4() for _ in range(4))
    conn.execute(text("INSERT INTO sites (id, tenant_id, name) VALUES (:id, :t, 'Ana bina')"), {"id": site, "t": tenant})
    conn.execute(text("INSERT INTO units (id, site_id, name, unit_type) VALUES (:id, :s, 'Reanimasiya', 'ADULT_ICU')"),
                 {"id": unit, "s": site})
    conn.execute(text("INSERT INTO rooms (id, unit_id, name) VALUES (:id, :u, 'Otaq 1')"), {"id": room, "u": unit})
    conn.execute(text("INSERT INTO beds (id, room_id, label) VALUES (:id, :r, '1')"), {"id": bed, "r": room})
    return unit, bed


def _patient(conn, tenant: uuid.UUID, number: str) -> uuid.UUID:
    pid = uuid.uuid4()
    conn.execute(text("INSERT INTO patients (id, tenant_id, display_name, date_of_birth, sex, patient_number, "
                      "created_at) VALUES (:id, :t, 'x', 'x', 'x', :n, now())"), {"id": pid, "t": tenant, "n": number})
    return pid


def _admission(conn, tenant: uuid.UUID, patient: uuid.UUID, state: str, *, protocol: str | None,
               hours_ago: int = 1) -> str:
    """One admission of `patient` in `state`, on a bed of its own, `hours_ago` old."""
    assert state in STATES                                  # written into the statement
    unit, bed = _bed(conn, tenant)
    admission = uuid.uuid4()
    conn.execute(text(
        "INSERT INTO admissions (id, patient_id, tenant_id, state, admission_datetime, admitting_unit_id, bed_id, "
        f"admission_diagnosis_free_text, protocol_no) VALUES (:id, :p, :t, '{state}', "
        "now() - make_interval(hours => :h), :u, :b, 'Sentetik tanı', :protocol)"),
        {"id": admission, "p": patient, "t": tenant, "h": hours_ago, "u": unit, "b": bed, "protocol": protocol})
    return str(admission)


class TestPostgresReadingStore(ReadingStoreContract):
    @pytest.fixture()
    def store(self, migrated):
        store = PostgresReadingStore(TEST_DATABASE_URL)
        yield store
        store.close()


def test_the_postgres_store_is_durable(migrated):
    store = PostgresReadingStore(TEST_DATABASE_URL)
    try:
        assert store.durable is True
    finally:
        store.close()


def test_the_rows_are_in_the_table_with_the_stay(migrated):
    with migrated.begin() as conn:
        tenant = _tenant(conn, "h1")
        admission = _admission(conn, tenant, _patient(conn, tenant, "H-0000001"), "ACTIVE", protocol=KEY)
    store = PostgresReadingStore(TEST_DATABASE_URL)
    try:
        from dataclasses import replace
        saved = store.add(replace(device(audit_id=11), admission_id=admission))
        assert saved.admission_id == admission and store.get("h1", [saved.id]) == [saved]
        with migrated.connect() as conn:
            row = conn.execute(text("SELECT tenant, received_key, patient_key, CAST(admission_id AS text), code, "
                                    "value, origin, state, audit_id, entry_id FROM vital_readings")).one()
        assert tuple(row) == ("h1", KEY, KEY, admission, "spo2", 97.0, "device", "recorded", 11, 11)
    finally:
        store.close()


@pytest.mark.parametrize("state", ["ACTIVE", "DRAFT", "PENDING_DISCHARGE", "PENDING_TRANSFER"])
def test_an_open_admission_is_found_by_its_protocol(migrated, state):
    """D8: a DRAFT has a card from POST /admissions, so it is a valid target."""
    with migrated.begin() as conn:
        tenant = _tenant(conn, "h1")
        admission = _admission(conn, tenant, _patient(conn, tenant, "H-0000001"), state, protocol=KEY)
    store = PostgresReadingStore(TEST_DATABASE_URL)
    try:
        assert store.admission_of("h1", KEY) == admission
        assert store.admission_of("h1", "H-0000001") is None       # the protocol is the key now, not the H-number
        assert store.admission_of("h2", KEY) is None
        [(key, began)] = store.open_stays("h1").items()
        assert key == KEY and began.utcoffset() == timedelta(0)
        assert timedelta(minutes=50) < datetime.now(timezone.utc) - began < timedelta(minutes=70)   # `hours_ago=1`
    finally:
        store.close()


def test_a_legacy_admission_is_found_by_its_h_number(migrated):
    """An admission from before 0015 has no protocol: its card key is the patient's H-number (boardkey.py)."""
    with migrated.begin() as conn:
        tenant = _tenant(conn, "h1")
        admission = _admission(conn, tenant, _patient(conn, tenant, "H-0000007"), "ACTIVE", protocol=None)
    store = PostgresReadingStore(TEST_DATABASE_URL)
    try:
        assert store.admission_of("h1", "H-0000007") == admission
        assert set(store.open_stays("h1")) == {"H-0000007"}
    finally:
        store.close()


def test_a_closed_admission_is_no_target(migrated):
    with migrated.begin() as conn:
        tenant = _tenant(conn, "h1")
        _admission(conn, tenant, _patient(conn, tenant, "H-0000001"), "DISCHARGED", protocol=KEY)
    store = PostgresReadingStore(TEST_DATABASE_URL)
    try:
        assert store.admission_of("h1", KEY) is None and store.open_stays("h1") == {}
    finally:
        store.close()


def test_after_a_transfer_the_key_names_the_arriving_admission(migrated):
    """O8: the arriving row takes the protocol over and the source row, TRANSFERRED, gives it up — so a reading
    that arrives after the transfer is stamped with the new stay's row, and `patient_key` spans both."""
    with migrated.begin() as conn:
        tenant = _tenant(conn, "h1")
        patient = _patient(conn, tenant, "H-0000001")
        source = _admission(conn, tenant, patient, "TRANSFERRED", protocol=None, hours_ago=30)
        arriving = _admission(conn, tenant, patient, "ACTIVE", protocol=KEY, hours_ago=2)
    store = PostgresReadingStore(TEST_DATABASE_URL)
    try:
        assert store.admission_of("h1", KEY) == arriving != source
        assert store.admission_of("h1", "H-0000001") is None       # the open row has a protocol: the H-number is no key
    finally:
        store.close()


def test_a_claim_that_fails_changes_no_row(migrated):
    """All or nothing in one transaction: the update of the rows that were waiting is rolled back."""
    store = PostgresReadingStore(TEST_DATABASE_URL)
    try:
        from homunculus.api.readings import STATE_UNMATCHED, ReadingNotUnmatched
        a = store.add(unmatched("spo2", 97.0, audit_id=1))
        b = store.add(unmatched("heart_rate", 88.0, audit_id=2))
        store.claim("h1", [a.id], by="hem.ayse", at=T0)
        with pytest.raises(ReadingNotUnmatched):
            store.claim("h1", [a.id, b.id], by="hem.zeynep", at=T0 + timedelta(minutes=1))
        assert store.get("h1", [b.id])[0].state == STATE_UNMATCHED
        assert store.get("h1", [a.id])[0].resolved_by == "hem.ayse"
    finally:
        store.close()


def test_times_come_back_in_utc(migrated):
    store = PostgresReadingStore(TEST_DATABASE_URL)
    try:
        baku = timezone(timedelta(hours=4))
        saved = store.add(device(at=datetime(2026, 11, 11, 13, 0, tzinfo=baku), audit_id=1))
        assert saved.observed_at == T0 and saved.observed_at.utcoffset() == timedelta(0)
        assert store.seen("h1", KEY, "spo2", T0, "CONNEX-3A", 97.0) is True
    finally:
        store.close()
```

Run: `cd /c/tmp/g3-cihaz-olcum/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_readings_postgres.py 2>&1 | tail -3`
Expected: an error at collection — `ModuleNotFoundError: No module named 'homunculus.api.readings_postgres'`.

- [ ] **Step 6: Write the Postgres store**

Create `homunculus-engine/src/homunculus/api/readings_postgres.py`:

```python
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
                "SELECT 1 FROM vital_readings WHERE origin = 'device' AND tenant = :tenant AND received_key = :key "
                "AND code = :code AND observed_at = :at AND source = :source AND value = :value LIMIT 1"),
                {"tenant": tenant, "key": received_key, "code": code, "at": observed_at, "source": source,
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

    def unmatched(self, tenant: str, *, since: datetime) -> list[Reading]:
        with self._engine.connect() as conn:
            rows = conn.execute(text(_SELECT + " WHERE tenant = :tenant AND state = 'unmatched' AND received_at >= :since "
                                     "ORDER BY received_at, id"), {"tenant": tenant, "since": since}).mappings().all()
        return [_row(r) for r in rows]

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
```

- [ ] **Step 7: `prodserver._readings` — the failing test, then the function**

Create `homunculus-engine/tests/test_readings_wiring.py`:

```python
# homunculus-engine/tests/test_readings_wiring.py
"""G3-05: how the production entry and `create_app` are handed the readings store (spec §3) and — from Task B5 —
the policy for a number nobody is admitted under (D9). No database: a Postgres store is built, never connected."""
from __future__ import annotations

from homunculus.api import prodserver
from homunculus.api.readings import InMemoryReadingStore
from homunculus.api.readings_postgres import PostgresReadingStore


def test_the_store_is_postgres_in_production_and_memory_elsewhere():
    assert isinstance(prodserver._readings(""), InMemoryReadingStore)
    assert isinstance(prodserver._readings("sqlite:///x.db"), InMemoryReadingStore)
    store = prodserver._readings("postgresql+asyncpg://u:p@db.invalid:5432/homunculus")
    try:
        assert isinstance(store, PostgresReadingStore) and store.durable is True
    finally:
        store.close()
```

Run: `cd /c/tmp/g3-cihaz-olcum/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_readings_wiring.py 2>&1 | tail -3`
Expected: `1 failed` — `AttributeError: module 'homunculus.api.prodserver' has no attribute '_readings'`.

In `homunculus-engine/src/homunculus/api/prodserver.py`, find (line 50):

```python
from homunculus.api.monitor_samples import InMemorySamples, PostgresSamples, SampleStore
```

Replace with:

```python
from homunculus.api.monitor_samples import InMemorySamples, PostgresSamples, SampleStore
from homunculus.api.readings import InMemoryReadingStore, ReadingStore            # G3-05
from homunculus.api.readings_postgres import PostgresReadingStore
```

In the same file, find (line 505):

```python
def _device_beds(url: str, hospital: str) -> DeviceBedSource | None:
```

Replace with:

```python
def _readings(url: str) -> ReadingStore:
    """The per-admission record of what was measured (G3-05): Postgres in production, in memory elsewhere —
    `_tasks`' rule."""
    if not _is_production(url):
        return InMemoryReadingStore()
    return PostgresReadingStore(url, ssl_required=os.getenv("DATABASE_SSL", "").lower() in ("require", "true", "1"))


def _device_beds(url: str, hospital: str) -> DeviceBedSource | None:
```

(The store is handed to `create_app` in Task B4, when `create_app` takes it.)

- [ ] **Step 8: Run the no-DB half**

Run: `cd /c/tmp/g3-cihaz-olcum/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_admission_keys.py tests/test_readings_wiring.py tests/test_migration_0021_vital_readings.py tests/test_readings_postgres.py tests/test_audit_postgres.py tests/test_tasks_postgres.py tests/test_readings_store.py 2>&1 | tail -3`
Expected: `35 passed, 47 skipped` — 3 + 1 + 1 (4 skipped) + 0 (31 skipped) + 6 (6 skipped) + 0 (6 skipped) + 24; among the passes are `test_migration_chain_has_a_single_head` and the one-statement-per-`op.execute` scan, which now read `0021`.

- [ ] **Step 9: Run the DB half on the throwaway Postgres**

Start `cihaz-pg` as «Ground rules» says if it is not running, then:

Run: `cd /c/tmp/g3-cihaz-olcum/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:cihaz@127.0.0.1:56451/cihaz_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_migration_0021_vital_readings.py tests/test_readings_postgres.py tests/test_tasks_postgres.py 2>&1 | tail -3`
Expected: `42 passed` — 5 + 31 + 6, none skipped. (`test_tasks_postgres.py` is here because its `admitted_at` now reads the shared fragment.)

- [ ] **Step 10: Commit**

```bash
cd /c/tmp/g3-cihaz-olcum && git add -- homunculus-engine/alembic/versions/0021_vital_readings.py homunculus-engine/src/homunculus/api/admission_keys.py homunculus-engine/src/homunculus/api/readings_postgres.py homunculus-engine/src/homunculus/api/tasks_postgres.py homunculus-engine/src/homunculus/api/prodserver.py homunculus-engine/tests/test_admission_keys.py homunculus-engine/tests/test_migration_0021_vital_readings.py homunculus-engine/tests/test_readings_postgres.py homunculus-engine/tests/test_readings_wiring.py && git commit -m "feat(readings): migration 0021 vital_readings, the Postgres store, the shared key→admission SQL (G3-05 §3, D8)" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>" -- homunculus-engine/alembic/versions/0021_vital_readings.py homunculus-engine/src/homunculus/api/admission_keys.py homunculus-engine/src/homunculus/api/readings_postgres.py homunculus-engine/src/homunculus/api/tasks_postgres.py homunculus-engine/src/homunculus/api/prodserver.py homunculus-engine/tests/test_admission_keys.py homunculus-engine/tests/test_migration_0021_vital_readings.py homunculus-engine/tests/test_readings_postgres.py homunculus-engine/tests/test_readings_wiring.py
```

---

### Task B3: `_apply_reading` — `/ingest`'s tail becomes one function, with no change in behaviour

**Files:**
- Test: `homunculus-engine/tests/test_ingest_apply.py` (new)
- Modify: `homunculus-engine/src/homunculus/api/app.py` — lines 37–39, lines 1458–1459, lines 1566–1605 (as each step finds the file)

Linking an unmatched reading (Task B6) must put it into the real engine exactly as the door does (spec D12): the same evaluation, lifecycle hook, mirror, rows, stamps, frame and notifications. So the door's tail moves into one closure of `create_app`, `_apply_reading(hospital, obs, record, wall_now, *, reading=None)`, which answers the alerts and the `ingest` row it wrote. Nothing passes `reading` yet: with `None` the `ingest` payload is byte for byte what it was.

This is a refactor: the pin test of Step 1 passes **before and after** the move. It is there so that a line dropped or reordered in the move fails in seconds.

- [ ] **Step 1: Pin the door's rows, order and frames**

Create `homunculus-engine/tests/test_ingest_apply.py`:

```python
# homunculus-engine/tests/test_ingest_apply.py
"""G3-05 (spec D12): what one reading does at `/ingest` — its rows, their order, the frame, the answer — pinned
before the door's tail moved into `_apply_reading`, and held after it. From Task B6 the link of an unmatched
reading runs the same function. Synthetic numbers and values only (CLAUDE.md rule 6)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.audit import InMemoryAuditLog

HEAD = {"Authorization": "Bearer tok"}
# Five readings that together score an immediate NEWS2 (tests/test_api_discharge.py IMMEDIATE): the alert fires on
# the first, and turns immediate — the nurse is told — on the third.
IMMEDIATE = [("heart_rate", 140), ("resp_rate", 30), ("spo2", 88), ("sbp", 85), ("temperature", 39.5)]


def obs(code, value, patient="S-001", when=None, device="CONNEX-3A"):
    when = when or datetime.now(timezone.utc) - timedelta(minutes=5)
    return {"resourceType": "Observation", "status": "final",
            "code": {"coding": [{"system": "http://homunculus.local/obs", "code": code}]},
            "subject": {"reference": f"Patient/{patient}"}, "effectiveDateTime": when.isoformat(),
            "valueQuantity": {"value": value, "unit": "u"}, "device": {"display": device}}


def test_five_readings_write_their_rows_in_the_doors_order_and_one_frame_each():
    audit = InMemoryAuditLog()
    app = create_app({"tok": "h1"}, run_escalation_loop=False, audit=audit)
    when = datetime.now(timezone.utc) - timedelta(minutes=5)
    with TestClient(app) as client:
        queue = app.state.broadcaster.subscribe("h1")
        for code, value in IMMEDIATE:
            r = client.post("/ingest", json=obs(code, value, when=when), headers=HEAD)
            assert r.status_code == 200 and sorted(r.json()) == ["alerts", "patient_id"]
            assert [a["kind"] for a in r.json()["alerts"]] == ["news2"]
        frames = 0
        while not queue.empty():
            assert queue.get_nowait()["patient_id"] == "S-001"
            frames += 1
    assert frames == 5
    assert [(r.event_type, r.subject) for r in audit.records(tenant="h1", limit=100)] == [
        ("ingest", "heart_rate"), ("alert", "news2"), ("first_seen", "news2"),
        ("ingest", "resp_rate"), ("alert", "news2"),
        ("ingest", "spo2"), ("alert", "news2"), ("notification", "news2"),
        ("ingest", "sbp"), ("alert", "news2"),
        ("ingest", "temperature"), ("alert", "news2"),
    ]
    first = audit.records(tenant="h1", event_type="ingest", limit=1)[0]
    assert first.patient_id == "S-001"
    assert first.payload == {"value": 140.0, "unit": "u", "obs_ts": when.isoformat(), "device": "CONNEX-3A"}
```

Run: `cd /c/tmp/g3-cihaz-olcum/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_ingest_apply.py 2>&1 | tail -3`
Expected: `1 passed` — before the move. If it fails here, stop and report: the door is not what the plan read.

- [ ] **Step 2: Move the tail**

In `homunculus-engine/src/homunculus/api/app.py`, find (lines 37–39):

```python
from homunculus.api.audit import (
    AuditEvent, AuditLog, ChainVerifier, InMemoryAuditLog, iter_records, iter_records_of,
)
```

Replace with:

```python
from homunculus.api.audit import (
    AuditEvent, AuditLog, AuditRecord, ChainVerifier, InMemoryAuditLog, iter_records, iter_records_of,
)
```

In the same file, find (lines 1458–1459):

```python
    @app.post("/ingest")
    async def ingest(resource: dict, authorization: str | None = Header(default=None)):
```

Replace with:

```python
    async def _apply_reading(hospital: str, obs, record, wall_now: datetime, *,
                             reading: int | None = None) -> tuple[list, AuditRecord]:
        """One reading into the real engine, as the device door does it (G3-05, spec D12): the evaluation at the
        reading's own time, the lifecycle hook, the shadow mirror, the `ingest` row, the alert, clear and
        first-seen rows, the card's frame, the nurse's notification. `/ingest` runs it for a matched reading;
        the link of an unmatched one (api/readings.py) runs it for each reading of the set, with `reading` — the
        `vital_readings` row linked — written into the `ingest` payload. `record` is the identity the caller
        already read; `wall_now` the request's one instant. Answers the evaluation's alerts and the `ingest` row."""
        engine = _engine(hospital)
        store = _store(hospital)
        # The rules judge at the reading's own time but never past the wall clock (G2-A2, X10): judged at a
        # stamp in the future, every other input would be aged to it. The audit row keeps the stamp; the replay
        # judges at min(the stamp, the row's write time) (rehydrate, X10b).
        alerts = engine.ingest(obs, now=min(obs.timestamp, wall_now))
        # G2-A1: what stopped firing ends its episode or — a critical nobody acknowledged —
        # latches (api/alert_lifecycle.py). Right after the evaluation and before any audit write:
        # if the audit fails from here on, an unacknowledged critical is still on the board.
        # Before the stamps too: a kind that came back after clearing has had its old stamp pruned,
        # so it is stamped anew, a new episode (D5).
        # First-seen uses WALL-CLOCK time (escalation measures real elapsed time, not observation time).
        cleared = sync_alerts(engine, store, obs.patient_id, wall_now)
        # Aşama B (D1): the same observation into the shadow engine, after the real evaluation and
        # its lifecycle hook — guarded, so nothing the lane does can fail this request.
        lane.guard("mirror", lambda: lane.mirror_observation(hospital, obs, now=wall_now, real=engine))
        payload = {"value": obs.value, "unit": obs.unit,
                   "obs_ts": obs.timestamp.isoformat(), "device": obs.source_device}
        if reading is not None:
            payload["reading"] = reading
        written = audit.append(AuditEvent(hospital, "ingest", obs.patient_id, obs.code.value, payload))
        for a in alerts:
            audit.append(AuditEvent(hospital, "alert", a.patient_id, a.kind,
                                    {"severity": a.severity, "urgency": a.urgency, "summary": a.summary,
                                     "source": a.source, "evidence": a.supporting_evidence}))
        _audit_cleared(hospital, cleared, wall_now)
        # A return within `escalate_after` of an unanswered clear continues its escalation chain
        # (X13); a return after an acknowledgement starts a new one.
        for a in engine.active_alerts(obs.patient_id):
            if store.stamp_first_seen(obs.patient_id, a.kind, wall_now, chain_gap=escalate_after):
                audit.append(AuditEvent(hospital, "first_seen", obs.patient_id, a.kind,
                                        {"at": wall_now.isoformat()}))
        await broadcaster.publish(hospital, _card(hospital, obs.patient_id, record))
        # Push a notification for any newly-appeared immediate alert (nurse audience).
        for note in notifier.for_new(hospital, engine.active_alerts(obs.patient_id)):
            await hub.publish(hospital, note)
            audit.append(AuditEvent(hospital, "notification", note.patient_id, note.kind,
                                    {"audience": note.audience, "trigger": note.trigger}))
        notifier.prune(hospital, live_keys(engine, store))
        return alerts, written

    @app.post("/ingest")
    async def ingest(resource: dict, authorization: str | None = Header(default=None)):
```

In the same file, find (lines 1566–1605):

```python
        engine = _engine(hospital)
        store = _store(hospital)
        # One wall-clock instant per request. The rules judge at the reading's own time but never
        # past the wall clock (G2-A2, X10): judged at a stamp in the future, every other input
        # would be aged to it. The audit row keeps the stamp; the replay judges at min(the stamp,
        # the row's write time) (rehydrate, X10b).
        wall_now = datetime.now(timezone.utc)
        alerts = engine.ingest(obs, now=min(obs.timestamp, wall_now))
        # G2-A1: what stopped firing ends its episode or — a critical nobody acknowledged —
        # latches (api/alert_lifecycle.py). Right after the evaluation and before any audit write:
        # if the audit fails from here on, an unacknowledged critical is still on the board.
        # Before the stamps too: a kind that came back after clearing has had its old stamp pruned,
        # so it is stamped anew, a new episode (D5).
        # First-seen uses WALL-CLOCK time (escalation measures real elapsed time, not observation time).
        cleared = sync_alerts(engine, store, obs.patient_id, wall_now)
        # Aşama B (D1): the same observation into the shadow engine, after the real evaluation and
        # its lifecycle hook — guarded, so nothing the lane does can fail this request.
        lane.guard("mirror", lambda: lane.mirror_observation(hospital, obs, now=wall_now, real=engine))
        audit.append(AuditEvent(hospital, "ingest", obs.patient_id, obs.code.value,
                                {"value": obs.value, "unit": obs.unit,
                                 "obs_ts": obs.timestamp.isoformat(), "device": obs.source_device}))
        for a in alerts:
            audit.append(AuditEvent(hospital, "alert", a.patient_id, a.kind,
                                    {"severity": a.severity, "urgency": a.urgency, "summary": a.summary,
                                     "source": a.source, "evidence": a.supporting_evidence}))
        _audit_cleared(hospital, cleared, wall_now)
        # A return within `escalate_after` of an unanswered clear continues its escalation chain
        # (X13); a return after an acknowledgement starts a new one.
        for a in engine.active_alerts(obs.patient_id):
            if store.stamp_first_seen(obs.patient_id, a.kind, wall_now, chain_gap=escalate_after):
                audit.append(AuditEvent(hospital, "first_seen", obs.patient_id, a.kind,
                                        {"at": wall_now.isoformat()}))
        await broadcaster.publish(hospital, _card(hospital, obs.patient_id, record))
        # Push a notification for any newly-appeared immediate alert (nurse audience).
        for note in notifier.for_new(hospital, engine.active_alerts(obs.patient_id)):
            await hub.publish(hospital, note)
            audit.append(AuditEvent(hospital, "notification", note.patient_id, note.kind,
                                    {"audience": note.audience, "trigger": note.trigger}))
        notifier.prune(hospital, live_keys(engine, store))
        return {"patient_id": obs.patient_id, "alerts": [asdict(a) for a in alerts]}
```

Replace with:

```python
        _engine(hospital)       # the tenant is rehydrated before the request's clock is read, as before the move
        # One wall-clock instant per request (G2-A2, X10): `_apply_reading` judges, stamps and frames at it.
        wall_now = datetime.now(timezone.utc)
        alerts, _ = await _apply_reading(hospital, obs, record, wall_now)
        return {"patient_id": obs.patient_id, "alerts": [asdict(a) for a in alerts]}
```

- [ ] **Step 3: The pin still holds, and so does every file that posts to the door**

Run: `cd /c/tmp/g3-cihaz-olcum/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_ingest_apply.py tests/test_api_ingest.py tests/test_api_discharge.py tests/test_api_identity_ingest.py tests/test_alert_lifecycle.py tests/test_api_notifications.py tests/test_rehydrate.py tests/test_bedside_retract.py tests/test_tasks_api.py 2>&1 | tail -3`
Expected: `171 passed` (1 + 11 + 14 + 15 + 34 + 19 + 49 + 28), as before the move plus the pin.

- [ ] **Step 4: Commit**

```bash
cd /c/tmp/g3-cihaz-olcum && git add -- homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_ingest_apply.py && git commit -m "refactor(ingest): the door's tail is _apply_reading — no change in behaviour (G3-05 D12)" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>" -- homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_ingest_apply.py
```

- [ ] **Step 5 (controller): the gate of this task — the whole no-DB engine suite**

The move touches the busiest door of the API, so this one task has a whole-suite gate (the implementer does not run it: no command of theirs runs longer than 180 s). The controller runs Task G1 Step 1's three chunks now and compares with Task 0's baseline plus this plan's additions so far: `test_readings_store.py` +24, `test_admission_keys.py` +3, `test_readings_wiring.py` +1, `test_migration_0021_vital_readings.py` +1 passed and 4 skipped, `test_readings_postgres.py` 31 skipped, `test_ingest_apply.py` +1. No failure, no error. Only then does Task B4 start.

---

### Task B4: The doors write the record — `/ingest` files every matched reading and recognises a re-send (D14); `/clinical` files the bedside set

**Files:**
- Test: `homunculus-engine/tests/test_readings_ingest.py` (new)
- Modify: `homunculus-engine/src/homunculus/api/readings.py` — lines 23–25, lines 44–45, after line 227 (the end of the file) (as each step finds the file)
- Modify: `homunculus-engine/src/homunculus/api/app.py` — line 22, line 69, lines 364–365, lines 393–394, line 427, line 804, line 891, line 1202, lines 1472–1473, lines 1608–1617 (as each step finds the file)
- Modify: `homunculus-engine/src/homunculus/api/prodserver.py` — lines 539–540 (as each step finds the file)
- Test: `homunculus-engine/tests/test_api_scope.py` — line 657 (as each step finds the file)

`create_app` takes the store (`readings=None` → memory). `/ingest`, for a reading it applies: first `seen` (a hit answers `{"patient_id", "duplicate": true}` — no engine entry, no audit row; a store error fails open), then `_apply_reading`, then the table row with the `ingest` row's id and the admission of the card key (D8). `POST /clinical/{id}` files one `manual` row per value of the bedside set (`MANUAL_CODES`: what «hatalı giriş» may withdraw, minus the fluid volumes). The audit row always comes first; a table write that fails is logged and never fails the request (D7) — `reconcile` (Task B10) files the row later. The discharged and unknown numbers are Task B5's.

- [ ] **Step 1: Write the failing tests**

Create `homunculus-engine/tests/test_readings_ingest.py`:

```python
# homunculus-engine/tests/test_readings_ingest.py
"""G3-05 (spec D6, D7, D8, D14): the two doors write the per-admission record. A matched device reading is a
`vital_readings` row with its `ingest` row's id and its stay; a re-sent one is recognised before the engine; the
bedside set typed at /clinical is filed as `manual`. The table never fails a request the engine has taken.
Synthetic numbers and values only (CLAUDE.md rule 6)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.audit import InMemoryAuditLog
from homunculus.api.identity import Caller
from homunculus.api.patient_identity import KABUL, IdentityRecord, InMemoryIdentityStore
from homunculus.api.readings import (
    MANUAL_CODES, ORIGIN_DEVICE, ORIGIN_MANUAL, SOURCE_MAX, STATE_RECORDED, InMemoryReadingStore,
)
from tests.test_ingest_apply import obs

TOKEN = "tok"
DEVICE = {"Authorization": f"Bearer {TOKEN}"}
NURSE = {"Authorization": "Bearer nurse-jwt"}
PEOPLE = {"nurse-jwt": Caller(hospital="h1", actor="hem.ayse", groups=("nurse",),
                              perms=frozenset({"board.view", "clinical.chart"}))}
KEY = "202600000001"
ADMISSION = "11111111-1111-4111-8111-111111111111"      # a synthetic admission id
WHEN = datetime.now(timezone.utc) - timedelta(minutes=5)
WINDOW = {"since": WHEN - timedelta(hours=1), "until": WHEN + timedelta(hours=1)}


async def _resolve(credential: str):
    return PEOPLE.get(credential)


class _Flaky(InMemoryReadingStore):
    """A store whose `seen` or `add` raises on demand — the database going away mid-request."""

    def __init__(self, **kw):
        super().__init__(**kw)
        self.fail: set[str] = set()
        self.closed = False

    def seen(self, *args, **kw):
        if "seen" in self.fail:
            raise RuntimeError("readings down")
        return super().seen(*args, **kw)

    def add(self, row):
        if "add" in self.fail:
            raise RuntimeError("readings down")
        return super().add(row)

    def admission_of(self, tenant, key):
        if "admission_of" in self.fail:
            raise RuntimeError("readings down")
        return super().admission_of(tenant, key)

    def close(self):
        self.closed = True


@pytest.fixture()
def world():
    """The app on a store that knows KEY's admission, with an identity store a test admits patients into."""
    audit, identities = InMemoryAuditLog(), InMemoryIdentityStore()
    store = _Flaky(admitted={("h1", KEY): ADMISSION})
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve, audit=audit,
                     identities=identities, readings=store)
    with TestClient(app) as client:
        yield client, store, audit, identities


def _admit(identities, key=KEY, source=KABUL, state="admitted"):
    identities.apply("h1", IdentityRecord(key, family="Hasta", given="Test", state=state, source=source,
                                          updated_at=WHEN - timedelta(hours=2)))


def _rows(store, key=KEY):
    return store.for_patient("h1", key, **WINDOW)


def _ingest_rows(audit, key=KEY):
    return audit.records(tenant="h1", patient_id=key, event_type="ingest", limit=100)


def _history(client, key, code):
    """The engine's readings of one code, through the handle BoardLink is given; [] for an id it never measured."""
    engine = client.app.state.board_link._engine("h1")
    if key not in engine.patient_ids():
        return []
    return [o.value for o in engine.state(key).history(code)]


class TestAMatchedDeviceReading:
    def test_is_filed_with_its_ingest_row_and_its_stay(self, world):
        client, store, audit, identities = world
        _admit(identities)
        r = client.post("/ingest", json=obs("spo2", 97, KEY, WHEN), headers=DEVICE)
        assert r.status_code == 200 and "duplicate" not in r.json()
        [written] = _ingest_rows(audit)
        [row] = _rows(store)
        assert (row.origin, row.state, row.source, row.recorded_by) == (ORIGIN_DEVICE, STATE_RECORDED, "CONNEX-3A", None)
        assert (row.received_key, row.patient_key, row.code, row.value, row.unit) == (KEY, KEY, "spo2", 97.0, "u")
        assert row.observed_at == WHEN and row.received_at >= WHEN
        assert row.audit_id == row.entry_id == written.id                # the row «hatalı giriş» will name
        assert row.admission_id == ADMISSION                             # D8: stamped at arrival
        assert "reading" not in written.payload                          # only a linked reading carries one (B6)

    def test_of_a_his_fed_patient_has_no_stay(self, world):
        """D8: a record of another source keeps today's path — filed under its number, `admission_id` NULL."""
        client, store, _, identities = world
        _admit(identities, source="comed")
        assert client.post("/ingest", json=obs("spo2", 97, KEY, WHEN), headers=DEVICE).status_code == 200
        [row] = _rows(store)
        assert (row.patient_key, row.admission_id) == (KEY, None)

    def test_under_a_number_with_no_identity_is_filed_under_that_number(self, world):
        """The default policy for an unknown number is `card` (D9, Task B5): the reading is applied, so it is recorded."""
        client, store, _, _ = world
        assert client.post("/ingest", json=obs("spo2", 97, "S-404", WHEN), headers=DEVICE).status_code == 200
        [row] = _rows(store, "S-404")
        assert (row.patient_key, row.admission_id, row.state) == ("S-404", None, STATE_RECORDED)

    def test_keeps_a_device_name_to_the_columns_width(self, world):
        client, store, _, _ = world
        long_name = "CONNEX-" + "X" * 100
        assert client.post("/ingest", json=obs("spo2", 97, KEY, WHEN, device=long_name), headers=DEVICE).status_code == 200
        [row] = _rows(store)
        assert row.source == long_name[:SOURCE_MAX] and len(row.source) == 64
        again = client.post("/ingest", json=obs("spo2", 97, KEY, WHEN, device=long_name), headers=DEVICE)
        assert again.json() == {"patient_id": KEY, "duplicate": True}    # compared as it was kept


class TestAReSentReading:
    def test_is_answered_duplicate_with_no_row_no_point_and_no_frame(self, world):
        client, store, audit, _ = world
        first = client.post("/ingest", json=obs("heart_rate", 140, KEY, WHEN), headers=DEVICE)
        assert first.status_code == 200 and "alerts" in first.json()
        trail = len(audit.records(tenant="h1", limit=1000))
        queue = client.app.state.broadcaster.subscribe("h1")
        again = client.post("/ingest", json=obs("heart_rate", 140, KEY, WHEN), headers=DEVICE)
        assert again.status_code == 200 and again.json() == {"patient_id": KEY, "duplicate": True}
        assert len(audit.records(tenant="h1", limit=1000)) == trail      # no audit row at all
        assert _history(client, KEY, _code("heart_rate")) == [140.0]     # one point in the engine
        assert queue.empty() and len(_rows(store)) == 1

    @pytest.mark.parametrize("change", [
        {"value": 141}, {"when": WHEN + timedelta(seconds=1)}, {"device": "CONNEX-3B"}, {"patient": "202600000002"},
        {"code": "resp_rate"},
    ])
    def test_another_value_time_device_number_or_code_is_another_reading(self, world, change):
        client, _, audit, _ = world
        base = {"code": "heart_rate", "value": 140, "patient": KEY, "when": WHEN, "device": "CONNEX-3A"}
        assert client.post("/ingest", json=obs(**base), headers=DEVICE).status_code == 200
        other = client.post("/ingest", json=obs(**{**base, **change}), headers=DEVICE)
        assert other.status_code == 200 and "duplicate" not in other.json()
        assert len(audit.records(tenant="h1", event_type="ingest", limit=100)) == 2

    def test_a_store_that_cannot_answer_fails_open(self, world):
        """D14: a store error must never drop a measurement — the reading is ingested."""
        client, store, audit, _ = world
        assert client.post("/ingest", json=obs("heart_rate", 140, KEY, WHEN), headers=DEVICE).status_code == 200
        store.fail = {"seen"}
        again = client.post("/ingest", json=obs("heart_rate", 140, KEY, WHEN), headers=DEVICE)
        assert again.status_code == 200 and "alerts" in again.json()
        assert len(_ingest_rows(audit)) == 2
        assert len(_rows(store)) == 1                                    # the table's own index refused the twin


class TestTheTableNeverFailsARequestTheEngineTook:
    def test_a_failed_table_write_still_answers_200_with_the_audit_row_and_the_point(self, world):
        client, store, audit, _ = world
        store.fail = {"add"}
        r = client.post("/ingest", json=obs("heart_rate", 140, KEY, WHEN), headers=DEVICE)
        assert r.status_code == 200 and "alerts" in r.json()
        assert len(_ingest_rows(audit)) == 1 and _history(client, KEY, _code("heart_rate")) == [140.0]
        assert _rows(store) == []                                        # `reconcile` files it (Task B10)

    def test_a_failed_admission_lookup_does_not_fail_it_either(self, world):
        client, store, audit, identities = world
        _admit(identities)
        store.fail = {"admission_of"}
        assert client.post("/ingest", json=obs("heart_rate", 140, KEY, WHEN), headers=DEVICE).status_code == 200
        assert len(_ingest_rows(audit)) == 1 and _rows(store) == []

    def test_a_failed_table_write_does_not_fail_a_chart(self, world):
        client, store, audit, _ = world
        store.fail = {"add"}
        r = client.post(f"/clinical/{KEY}", json={"entries": [{"code": "resp_rate", "value": 16}],
                                                  "recorded_at": WHEN.isoformat()}, headers=NURSE)
        assert r.status_code == 200 and r.json()["charted"] == 1
        assert len(audit.records(tenant="h1", event_type="chart", limit=10)) == 1


class TestTheBedsideSetIsFiledAsManual:
    def test_each_value_of_the_set_is_a_manual_row_with_its_chart_row(self, world):
        client, store, _, identities = world
        _admit(identities)
        r = client.post(f"/clinical/{KEY}", headers=NURSE, json={"recorded_at": WHEN.isoformat(), "entries": [
            {"code": "resp_rate", "value": 16}, {"code": "spo2", "value": 97}, {"code": "supplemental_oxygen", "value": 0},
            {"code": "acvpu", "value": 0}]})
        assert r.status_code == 200, r.text
        entries = {e["code"]: e["entry"] for e in r.json()["entries"]}
        rows = {row.code: row for row in _rows(store)}
        assert set(rows) == {"resp_rate", "spo2", "supplemental_oxygen", "acvpu"}
        for code, row in rows.items():
            assert (row.origin, row.source, row.recorded_by, row.state) == (ORIGIN_MANUAL, "clinician", "hem.ayse", STATE_RECORDED)
            assert row.audit_id == row.entry_id == entries[code]
            assert (row.received_key, row.patient_key, row.admission_id) == (KEY, KEY, ADMISSION)
            assert row.observed_at == WHEN and row.received_at >= WHEN
        assert (rows["resp_rate"].value, rows["resp_rate"].unit) == (16.0, "/min")

    def test_what_is_not_the_bedside_set_is_not_filed(self, world):
        """D6: the fluid volumes have their own ledger; a lactate, a mark and a pressor rate are no bedside vital."""
        client, store, _, _ = world
        r = client.post(f"/clinical/{KEY}", headers=NURSE, json={"recorded_at": WHEN.isoformat(), "entries": [
            {"code": "urine_output_ml", "value": 200}, {"code": "lactate", "value": 2.1},
            {"code": "suspected_infection", "value": 1}, {"code": "heart_rate", "value": 88}]})
        assert r.status_code == 200, r.text
        assert [row.code for row in _rows(store)] == ["heart_rate"]

    def test_the_filed_codes_are_the_withdrawable_ones_minus_the_fluids(self):
        assert MANUAL_CODES == {"resp_rate", "spo2", "supplemental_oxygen", "sbp", "map", "heart_rate", "acvpu",
                                "temperature"}

    def test_a_chart_through_the_device_token_names_nobody(self, world):
        client, store, _, _ = world
        r = client.post(f"/clinical/{KEY}", headers=DEVICE, json={"entries": [{"code": "heart_rate", "value": 88}],
                                                                   "recorded_at": WHEN.isoformat()})
        assert r.status_code == 200
        [row] = _rows(store)
        assert (row.origin, row.recorded_by) == (ORIGIN_MANUAL, "tenant-token")

    def test_an_equal_hand_value_is_never_a_duplicate_of_the_devices(self, world):
        client, store, _, _ = world
        assert client.post("/ingest", json=obs("heart_rate", 88, KEY, WHEN, device="clinician"), headers=DEVICE).status_code == 200
        r = client.post(f"/clinical/{KEY}", headers=NURSE, json={"entries": [{"code": "heart_rate", "value": 88}],
                                                                  "recorded_at": WHEN.isoformat()})
        assert r.status_code == 200 and r.json()["charted"] == 1
        assert sorted(row.origin for row in _rows(store)) == [ORIGIN_DEVICE, ORIGIN_MANUAL]

    def test_a_discharged_number_files_nothing_at_the_chart_door(self, world):
        client, store, _, identities = world
        _admit(identities, state="discharged")
        r = client.post(f"/clinical/{KEY}", headers=NURSE, json={"entries": [{"code": "heart_rate", "value": 88}],
                                                                  "recorded_at": WHEN.isoformat()})
        assert r.json() == {"patient_id": KEY, "dropped": "discharged"}
        assert _rows(store) == []


def _code(slug):
    from homunculus.canonical import SignalCode
    return SignalCode(slug)


def test_without_a_store_the_app_keeps_the_record_in_memory():
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False)
    assert isinstance(app.state.readings, InMemoryReadingStore)
    with TestClient(app) as client:
        assert client.post("/ingest", json=obs("spo2", 97, KEY, WHEN), headers=DEVICE).status_code == 200
    assert len(app.state.readings.for_patient("h1", KEY, **WINDOW)) == 1


def test_the_store_is_released_at_shutdown():
    store = _Flaky()
    with TestClient(create_app({TOKEN: "h1"}, run_escalation_loop=False, readings=store)):
        assert store.closed is False
    assert store.closed is True
```

Run: `cd /c/tmp/g3-cihaz-olcum/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_readings_ingest.py 2>&1 | tail -3`
Expected: an error at collection — `ImportError: cannot import name 'MANUAL_CODES' from 'homunculus.api.readings'`.

- [ ] **Step 2: The rows the doors build (`api/readings.py`)**

In `homunculus-engine/src/homunculus/api/readings.py`, find (lines 23–25):

```python
from typing import Protocol

log = logging.getLogger(__name__)
```

Replace with:

```python
from typing import Protocol

from homunculus.api.clinical import FLUID_CODES, RETRACTABLE_CODES
from homunculus.canonical import Observation

log = logging.getLogger(__name__)
```

In the same file, find (lines 44–45):

```python
REASON_UNKNOWN = "unknown"
REASON_DISCHARGED = "discharged"
```

Replace with:

```python
REASON_UNKNOWN = "unknown"
REASON_DISCHARGED = "discharged"
#: D6: the hand entries the record keeps — the bedside form's set, by the slug a `chart` row carries: what «hatalı
#: giriş» may withdraw (api/clinical.py RETRACTABLE_CODES) minus the fluid volumes, which have their own ledger.
MANUAL_CODES = RETRACTABLE_CODES - FLUID_CODES
#: The widths of the table's `source` and `unit` columns (migration 0021). A feed's text is cut to them at the
#: door, so no device name can make a row unwritable — and D14 compares the source as it was kept.
SOURCE_MAX = 64
UNIT_MAX = 16
```

Append to the end of `homunculus-engine/src/homunculus/api/readings.py` (after line 227):

```python


# ----------------------------------------------------------------------------- the doors' rows

def device_source(obs: Observation) -> str:
    """The device as the table keeps it and D14 compares it: as sent, cut to the column."""
    return str(obs.source_device or "")[:SOURCE_MAX]


def device_reading(tenant: str, obs: Observation, *, received_at: datetime, audit_id: int,
                   reason: str | None = None) -> Reading:
    """A device reading's row. `reason` None: the engine took it — `recorded` under its own number, `audit_id` its
    `ingest` row, which is also the entry a withdrawal names. With a reason (REASON_UNKNOWN, REASON_DISCHARGED) it
    waits in the list: `unmatched`, under nobody, `audit_id` its `reading_unmatched` row and no entry."""
    matched = reason is None
    return Reading(tenant=tenant, received_key=obs.patient_id, code=obs.code.value, value=obs.value,
                   unit=str(obs.unit or "")[:UNIT_MAX], observed_at=obs.timestamp, received_at=received_at,
                   origin=ORIGIN_DEVICE, source=device_source(obs),
                   state=STATE_RECORDED if matched else STATE_UNMATCHED,
                   patient_key=obs.patient_id if matched else None, unmatched_reason=reason,
                   audit_id=audit_id, entry_id=audit_id if matched else None)


def manual_reading(tenant: str, obs: Observation, *, received_at: datetime, entry_id: int,
                   recorded_by: str) -> Reading:
    """A hand entry's row: `recorded` under the patient it was charted for, `entry_id` its `chart` row."""
    return Reading(tenant=tenant, received_key=obs.patient_id, code=obs.code.value, value=obs.value,
                   unit=str(obs.unit or "")[:UNIT_MAX], observed_at=obs.timestamp, received_at=received_at,
                   origin=ORIGIN_MANUAL, source="clinician", state=STATE_RECORDED, patient_key=obs.patient_id,
                   recorded_by=recorded_by, audit_id=entry_id, entry_id=entry_id)
```

- [ ] **Step 3: `create_app` takes the store, and the two doors file their rows (`api/app.py`)**

In `homunculus-engine/src/homunculus/api/app.py`, find (line 22):

```python
from dataclasses import asdict, dataclass
```

Replace with:

```python
from dataclasses import asdict, dataclass, replace
```

In the same file, find (line 69):

```python
from homunculus.api.pharmacy import ward_pharmacy                 # G3-04
```

Replace with:

```python
from homunculus.api.pharmacy import ward_pharmacy                 # G3-04
from homunculus.api.readings import (                             # G3-05
    MANUAL_CODES, InMemoryReadingStore, Reading, ReadingStore, device_reading, device_source, manual_reading,
)
```

In the same file, find (lines 364–365):

```python
    tasks: TaskStore | None = None,
) -> FastAPI:
```

Replace with:

```python
    tasks: TaskStore | None = None,
    readings: ReadingStore | None = None,
) -> FastAPI:
```

In the same file, find (lines 393–394):

```python
    rows of a `rules` run still expire after a rollback below it.
    At shutdown the lifespan releases `audit`, `identities`, `samples` and `device_beds`
```

Replace with:

```python
    rows of a `rules` run still expire after a rollback below it.
    `readings` is the per-admission record of what was measured (G3-05, `api/readings.py`, migration 0021):
    `PostgresReadingStore` in production; None keeps the rows in memory, which is what the no-DB suite runs on.
    At shutdown the lifespan releases `audit`, `identities`, `samples` and `device_beds`
```

In the same file, find (line 427):

```python
    tasks = tasks if tasks is not None else InMemoryTaskStore()      # G3-02: the task queue's rows
```

Replace with:

```python
    tasks = tasks if tasks is not None else InMemoryTaskStore()      # G3-02: the task queue's rows
    readings = readings if readings is not None else InMemoryReadingStore()   # G3-05: the readings record
```

In the same file, find (line 804):

```python
                                         ("tasks", tasks, "close")):           # G3-02
```

Replace with:

```python
                                         ("tasks", tasks, "close"),            # G3-02
                                         ("readings", readings, "close")):     # G3-05
```

In the same file, find (line 891):

```python
    app.state.tasks = tasks                         # G3-02
```

Replace with:

```python
    app.state.tasks = tasks                         # G3-02
    app.state.readings = readings                   # G3-05
```

In the same file, find (line 1202):

```python
        # G3-01 (X2): a newly immediate alert from a charted value tells the nurse, as /ingest's reading does —
```

Replace with:

```python
        # G3-05 (D6): the bedside set is filed in the record as «elle», each value with its `chart` row — after
        # those rows (D7). `written` is in the request's order, as `charted` is.
        _file_recorded(hospital, record, [
            manual_reading(hospital, item.observation, received_at=now, entry_id=entry, recorded_by=item.charted_by)
            for item, (code, entry) in zip(charted, written) if code in MANUAL_CODES])
        # G3-01 (X2): a newly immediate alert from a charted value tells the nurse, as /ingest's reading does —
```

In the same file, find (lines 1472–1473):

```python
    async def _apply_reading(hospital: str, obs, record, wall_now: datetime, *,
                             reading: int | None = None) -> tuple[list, AuditRecord]:
```

Replace with:

```python
    def _admission_for(hospital: str, record) -> str | None:
        """G3-05 (D8): the stay a reading is stamped with at arrival. An admission made here (`kabul`, admitted)
        is found by its card key (`admission/boardkey.py`'s rule, read by the store); a HIS-fed patient and a
        number with no record have none."""
        if record is None or record.source != KABUL or is_tombstone(record):
            return None
        return readings.admission_of(hospital, record.patient_id)

    def _file_recorded(hospital: str, record, rows: list[Reading]) -> None:
        """G3-05 (D6, D7): the table rows of values the engine has taken, written AFTER their audit rows, each
        stamped with the stay (D8). Never raises: the audit row is written and the engine holds the value, so a
        table that cannot be written must not fail the request — a 500 would make the bridge send the reading
        again and count it twice. The failure is logged (no number, no value) and `reconcile` files the row."""
        if not rows:
            return
        try:
            admission = _admission_for(hospital, record)
            for row in rows:
                readings.add(replace(row, admission_id=admission))
        except Exception:
            log.exception("vital_readings: %d satır yazılamadı (hastane %s); reconcile tamamlar", len(rows), hospital)

    def _resent(hospital: str, obs) -> bool:
        """G3-05 (D14): has the record this very reading already — the same number, code, time, device and
        value? The Connex re-sends what it buffered and the uplink is at-least-once. A store that cannot answer
        fails OPEN: the reading is ingested, never dropped on a doubt."""
        try:
            return readings.seen(hospital, obs.patient_id, obs.code.value, obs.timestamp, device_source(obs),
                                 obs.value)
        except Exception:
            log.exception("vital_readings: yinelenen ölçüm denetimi yapılamadı (hastane %s); ölçüm işlenir", hospital)
            return False

    async def _apply_reading(hospital: str, obs, record, wall_now: datetime, *,
                             reading: int | None = None) -> tuple[list, AuditRecord]:
```

In the same file, find (lines 1608–1617):

```python
        record = identities.get(hospital, obs.patient_id)
        if is_tombstone(record):
            audit.append(AuditEvent(hospital, READING_DROPPED, obs.patient_id, obs.code.value,
                                    {"patient_id": obs.patient_id, "code": obs.code.value}))
            return {"patient_id": obs.patient_id, "dropped": DISCHARGED}
        _engine(hospital)       # the tenant is rehydrated before the request's clock is read, as before the move
        # One wall-clock instant per request (G2-A2, X10): `_apply_reading` judges, stamps and frames at it.
        wall_now = datetime.now(timezone.utc)
        alerts, _ = await _apply_reading(hospital, obs, record, wall_now)
        return {"patient_id": obs.patient_id, "alerts": [asdict(a) for a in alerts]}
```

Replace with:

```python
        record = identities.get(hospital, obs.patient_id)
        # G3-05 (D14): a reading the record already holds is recognised before the engine — no engine entry, no
        # audit row, no frame. 200, as every answer of this door: the bridge's uplink never blocks (D18).
        if _resent(hospital, obs):
            return {"patient_id": obs.patient_id, "duplicate": True}
        if is_tombstone(record):
            audit.append(AuditEvent(hospital, READING_DROPPED, obs.patient_id, obs.code.value,
                                    {"patient_id": obs.patient_id, "code": obs.code.value}))
            return {"patient_id": obs.patient_id, "dropped": DISCHARGED}
        _engine(hospital)       # the tenant is rehydrated before the request's clock is read, as before the move
        # One wall-clock instant per request (G2-A2, X10): `_apply_reading` judges, stamps and frames at it.
        wall_now = datetime.now(timezone.utc)
        alerts, written = await _apply_reading(hospital, obs, record, wall_now)
        # G3-05 (D6, D7): the record's row, after the `ingest` row it points at.
        _file_recorded(hospital, record, [device_reading(hospital, obs, received_at=wall_now, audit_id=written.id)])
        return {"patient_id": obs.patient_id, "alerts": [asdict(a) for a in alerts]}
```

- [ ] **Step 4: `prodserver` hands the store over**

In `homunculus-engine/src/homunculus/api/prodserver.py`, find (lines 539–540):

```python
    tasks=_tasks(_database_url()),
)
```

Replace with:

```python
    tasks=_tasks(_database_url()),
    readings=_readings(_database_url()),
)
```

- [ ] **Step 5: Run to see them pass**

Run: `cd /c/tmp/g3-cihaz-olcum/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_readings_ingest.py tests/test_readings_store.py tests/test_readings_wiring.py tests/test_ingest_apply.py 2>&1 | tail -3`
Expected: `48 passed` (22 + 24 + 1 + 1).

- [ ] **Step 6: O1 — the tests that post one identical reading twice**

D14 is now on in every app the suite builds (the default store is memory), so a test that posts the very same reading twice — same patient, code, time, device and value — gets `{"duplicate": true}` the second time. The rule is never weakened; the test's second reading is given its own time (spec O1). On the scratch copy these were found and are fixed here:

Run: `cd /c/tmp/g3-cihaz-olcum/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_api_scope.py 2>&1 | tail -3`
Expected: `1 failed` — `test_a_transfer_out_and_a_discharge_are_removals_and_a_transfer_in_is_a_card`: it sends `p-n1`'s reading a second time to make a frame, and the second send is now a duplicate. Its helper takes no time, so the second reading gets its own value (another value is another reading):

In `homunculus-engine/tests/test_api_scope.py`, find (line 657):

```python
            await _async_reading(client, "p-n1")       # the NICU, never shown here: withheld
```

Replace with:

```python
            # Its own value: the very same reading sent twice is a duplicate since G3-05 (D14) and makes no frame.
            await _async_reading(client, "p-n1", 96.0)       # the NICU, never shown here: withheld
```

Run the same command again.
Expected: no failure.

That was the only one in the whole no-DB suite on the scratch copy (all three chunks of Task G1 Step 1 were run there after Task B5). If the controller's next whole-suite run finds another — a file added by another lane since — it is fixed the same way, in a commit of its own: the second reading gets its own time or value.

- [ ] **Step 7: Commit**

```bash
cd /c/tmp/g3-cihaz-olcum && git add -- homunculus-engine/tests/test_readings_ingest.py homunculus-engine/src/homunculus/api/readings.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/src/homunculus/api/prodserver.py homunculus-engine/tests/test_api_scope.py && git commit -m "feat(readings): the doors write the record — a matched reading is filed, a re-send is recognised, the bedside set is filed as manual (G3-05 D6, D7, D14)" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>" -- homunculus-engine/tests/test_readings_ingest.py homunculus-engine/src/homunculus/api/readings.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/src/homunculus/api/prodserver.py homunculus-engine/tests/test_api_scope.py
```

---

### Task B5: A number that matches nobody goes to the list (D4, D8, D9) — the policy switch

**Files:**
- Test: `homunculus-engine/tests/test_readings_unmatched.py` (new)
- Modify: `homunculus-engine/src/homunculus/api/readings.py` — lines 43–45 (as each step finds the file)
- Modify: `homunculus-engine/src/homunculus/api/app.py` — lines 70–72, lines 365–367, line 397, line 404, lines 1512–1513, lines 1625–1631, lines 1635–1639 (as each step finds the file)
- Modify: `homunculus-engine/src/homunculus/api/prodserver.py` — line 51, line 515, lines 553–554, lines 23–25 (as each step finds the file)
- Test: `homunculus-engine/tests/test_api_discharge.py` — lines 79–87 (as each step finds the file)
- Test: `homunculus-engine/tests/test_kabul_identity.py` — lines 181–182, lines 203–205 (as each step finds the file)

At `/ingest`, after the duplicate check:

- a **discharged** admission's number (a `kabul` tombstone): one `reading_unmatched` audit row **with the value** (`{value, unit, obs_ts, device, reason: "discharged"}`) and one `unmatched` table row; the answer stays `{"patient_id", "dropped": "discharged"}`. This replaces `reading_dropped_discharged` **at this door only** (it overrides G2-A11 D3 here: the value is now kept; still no engine entry, no alert, no frame, no page). `POST /clinical/{id}` keeps writing `reading_dropped_discharged`.
- a number with **no identity record**, under the policy `unmatched`: the same with reason `unknown`, answer `{"patient_id", "dropped": "unmatched"}` — no engine entry and no card (it overrides B1d D4 in the hospital).
- under the policy `card` — `create_app`'s default, so the suite, `scripts/replay.py` and the seed scripts keep working — an unknown number behaves as today.

`prodserver` sets `unmatched` on a Postgres deployment; `READINGS_UNKNOWN_KEY=card` turns it back for a replay. On the unmatched path the table row is the only place a nurse will ever see the reading, so a table write that fails answers **500** and the bridge sends it again (D7).

- [ ] **Step 1: Write the failing tests**

Create `homunculus-engine/tests/test_readings_unmatched.py`:

```python
# homunculus-engine/tests/test_readings_unmatched.py
"""G3-05 (spec D4, D8, D9): a device reading whose number matches nobody is kept, with its value, in the
unmatched list — a discharged admission's number always, a number with no identity record under the production
policy. Nothing of it reaches the engine: no alert, no frame, no page, no card. Synthetic numbers and values
only (CLAUDE.md rule 6)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api import prodserver
from homunculus.api.app import create_app
from homunculus.api.audit import InMemoryAuditLog
from homunculus.api.patient_identity import KABUL, IdentityRecord, InMemoryIdentityStore
from homunculus.api.readings import (
    POLICY_CARD, POLICY_UNMATCHED, READING_UNMATCHED, REASON_DISCHARGED, REASON_UNKNOWN, STATE_UNMATCHED,
    InMemoryReadingStore,
)
from tests.test_ingest_apply import IMMEDIATE, obs
from tests.test_readings_ingest import _Flaky

TOKEN = "tok"
DEVICE = {"Authorization": f"Bearer {TOKEN}"}
KEY, TYPO = "202600000001", "202600000010"
WHEN = datetime.now(timezone.utc) - timedelta(minutes=5)
WEEK = WHEN - timedelta(days=7)
QUIET = ("ingest", "alert", "first_seen", "notification", "alert_cleared", "reading_dropped_discharged")


def _world(policy=POLICY_UNMATCHED, audit=None, store=None, identities=None, **kw):
    audit = audit if audit is not None else InMemoryAuditLog()
    store = store if store is not None else _Flaky()
    identities = identities if identities is not None else InMemoryIdentityStore()
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False, audit=audit, identities=identities, readings=store,
                     unknown_readings=policy, **kw)
    return app, store, audit, identities


def _admit(identities, key=KEY, source=KABUL, state="admitted"):
    identities.apply("h1", IdentityRecord(key, family="Hasta", given="Test", state=state, source=source,
                                          unit_id="u-1", bed_id="b-1", updated_at=WHEN - timedelta(hours=2)))


def _kinds(audit, key):
    return [r.event_type for r in audit.records(tenant="h1", patient_id=key, limit=1000)]


def _cards(client):
    return [p["patient_id"] for p in client.get("/patients", headers=DEVICE).json()["patients"]]


def _measured(app):
    return set(app.state.board_link._engine("h1").patient_ids())


class TestADischargedNumber:
    def test_is_listed_with_its_value_and_nothing_reaches_the_engine(self):
        app, store, audit, identities = _world(policy=POLICY_CARD)        # whatever the policy for unknown numbers
        _admit(identities, state="discharged")
        with TestClient(app) as client:
            queue = app.state.broadcaster.subscribe("h1")
            r = client.post("/ingest", json=obs("heart_rate", 140, KEY, WHEN), headers=DEVICE)
            assert r.status_code == 200 and r.json() == {"patient_id": KEY, "dropped": "discharged"}
            [row] = audit.records(tenant="h1", event_type=READING_UNMATCHED, limit=10)
            assert (row.patient_id, row.subject) == (KEY, "heart_rate")
            assert row.payload == {"value": 140.0, "unit": "u", "obs_ts": WHEN.isoformat(), "device": "CONNEX-3A",
                                   "reason": "discharged"}
            assert _kinds(audit, KEY) == [READING_UNMATCHED]
            assert queue.empty(), "nothing is published for a listed reading"
            assert KEY not in _cards(client) and KEY not in _measured(app)
            assert client.get(f"/alerts/{KEY}", headers=DEVICE).json()["alerts"] == []
        [listed] = store.unmatched("h1", since=WEEK)
        assert (listed.state, listed.unmatched_reason, listed.received_key, listed.patient_key) == (
            STATE_UNMATCHED, REASON_DISCHARGED, KEY, None)
        assert (listed.code, listed.value, listed.source, listed.observed_at) == ("heart_rate", 140.0, "CONNEX-3A", WHEN)
        assert (listed.audit_id, listed.entry_id, listed.admission_id) == (row.id, None, None)

    def test_a_set_that_would_page_raises_no_alert_no_frame_and_no_notification(self):
        """The owner's decision of 2026-10-26 stands: no alert and no page may come of a discharged number."""
        app, store, audit, identities = _world()
        _admit(identities, state="discharged")
        with TestClient(app) as client:
            queue = app.state.broadcaster.subscribe("h1")
            hub = app.state.notification_hub.subscribe("h1", "nurse")
            for code, value in IMMEDIATE:
                assert client.post("/ingest", json=obs(code, value, KEY, WHEN), headers=DEVICE).json()["dropped"] == "discharged"
            assert queue.empty() and hub.empty()
        assert _kinds(audit, KEY) == [READING_UNMATCHED] * 5
        assert not any(audit.records(tenant="h1", event_type=kind, limit=10) for kind in QUIET)
        assert sorted(r.code for r in store.unmatched("h1", since=WEEK)) == sorted(code for code, _ in IMMEDIATE)

    def test_the_chart_door_still_writes_its_own_drop_row(self):
        """Only `/ingest` changed: a hand entry for a discharged number is refused as before, value not kept."""
        app, store, audit, identities = _world()
        _admit(identities, state="discharged")
        with TestClient(app) as client:
            r = client.post(f"/clinical/{KEY}", headers=DEVICE, json={"entries": [{"code": "lactate", "value": 3.1}],
                                                                       "recorded_at": WHEN.isoformat()})
            assert r.json() == {"patient_id": KEY, "dropped": "discharged"}
        assert _kinds(audit, KEY) == ["reading_dropped_discharged"]
        assert store.unmatched("h1", since=WEEK) == []


class TestAnUnknownNumber:
    def test_under_the_production_policy_is_listed_and_makes_no_card(self):
        app, store, audit, _ = _world(policy=POLICY_UNMATCHED)
        with TestClient(app) as client:
            queue = app.state.broadcaster.subscribe("h1")
            r = client.post("/ingest", json=obs("spo2", 97, TYPO, WHEN), headers=DEVICE)
            assert r.status_code == 200 and r.json() == {"patient_id": TYPO, "dropped": "unmatched"}
            assert queue.empty() and TYPO not in _cards(client) and TYPO not in _measured(app)
        [row] = audit.records(tenant="h1", event_type=READING_UNMATCHED, limit=10)
        assert row.payload["reason"] == "unknown" and row.payload["value"] == 97.0
        assert _kinds(audit, TYPO) == [READING_UNMATCHED]
        [listed] = store.unmatched("h1", since=WEEK)
        assert (listed.unmatched_reason, listed.received_key, listed.patient_key) == (REASON_UNKNOWN, TYPO, None)

    @pytest.mark.parametrize("number", ["20260000001", "2026000000011", "H-0000007", "bed-3"])
    def test_any_number_with_no_record_is_listed_not_only_twelve_digits(self, number):
        """D9: an 11- or 13-digit typo is exactly what the list is for."""
        app, store, _, _ = _world(policy=POLICY_UNMATCHED)
        with TestClient(app) as client:
            assert client.post("/ingest", json=obs("spo2", 97, number, WHEN), headers=DEVICE).json()["dropped"] == "unmatched"
        assert [r.received_key for r in store.unmatched("h1", since=WEEK)] == [number]

    def test_under_the_default_policy_makes_a_card_as_before(self):
        app, store, audit, _ = _world(policy=POLICY_CARD)
        with TestClient(app) as client:
            r = client.post("/ingest", json=obs("spo2", 97, TYPO, WHEN), headers=DEVICE)
            assert r.status_code == 200 and "alerts" in r.json()
            assert TYPO in _cards(client)
        assert _kinds(audit, TYPO)[0] == "ingest" and store.unmatched("h1", since=WEEK) == []

    def test_the_default_policy_is_card(self):
        app = create_app({TOKEN: "h1"}, run_escalation_loop=False)
        with TestClient(app) as client:
            assert "alerts" in client.post("/ingest", json=obs("spo2", 97, TYPO, WHEN), headers=DEVICE).json()

    def test_an_unknown_policy_is_refused_at_start(self):
        with pytest.raises(ValueError, match="unknown_readings"):
            create_app({TOKEN: "h1"}, run_escalation_loop=False, unknown_readings="drop")


class TestWhoIsStillApplied:
    @pytest.mark.parametrize("source", [KABUL, "comed", "manuel"])
    def test_an_admitted_record_of_any_source_is_applied_under_the_production_policy(self, source):
        app, store, audit, identities = _world(policy=POLICY_UNMATCHED)
        _admit(identities, source=source)
        with TestClient(app) as client:
            r = client.post("/ingest", json=obs("spo2", 97, KEY, WHEN), headers=DEVICE)
            assert "alerts" in r.json() and KEY in _cards(client)
        assert _kinds(audit, KEY)[0] == "ingest" and store.unmatched("h1", since=WEEK) == []

    def test_a_his_discharge_is_still_evaluated(self):
        """A HIS discharge is no tombstone (G2-A11 D4): its card keeps its 24 hours and its readings are scored."""
        app, store, _, identities = _world(policy=POLICY_UNMATCHED)
        _admit(identities, source="comed", state="discharged")
        with TestClient(app) as client:
            assert "alerts" in client.post("/ingest", json=obs("spo2", 97, KEY, WHEN), headers=DEVICE).json()
        assert store.unmatched("h1", since=WEEK) == []


class TestTheNamelessCardOfTheDeployDay:
    def test_it_stays_after_the_restart_and_receives_nothing_new(self):
        """Spec §8: a nameless card that exists on the day stays — the restart replays its old `ingest` rows —
        but under the production policy a new reading for that number goes to the list, not onto the card."""
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        before, _, _, _ = _world(policy=POLICY_CARD, audit=audit, store=store)
        with TestClient(before) as client:
            assert "alerts" in client.post("/ingest", json=obs("spo2", 97, "S-404", WHEN), headers=DEVICE).json()
        after, _, _, _ = _world(policy=POLICY_UNMATCHED, audit=audit, store=store)
        with TestClient(after) as client:
            assert "S-404" in _cards(client)                             # replayed from its old rows
            later = WHEN + timedelta(minutes=2)
            r = client.post("/ingest", json=obs("spo2", 91, "S-404", later), headers=DEVICE)
            assert r.json() == {"patient_id": "S-404", "dropped": "unmatched"}
            card = next(p for p in client.get("/patients", headers=DEVICE).json()["patients"] if p["patient_id"] == "S-404")
            assert card["latest"]["spo2"] == 97                          # the card did not take the 91
        assert [(r.value, r.unmatched_reason) for r in store.unmatched("h1", since=WEEK)] == [(91.0, REASON_UNKNOWN)]


class TestTheListIsTheOnlyPlace:
    def test_a_table_write_that_fails_answers_500_so_the_bridge_sends_it_again(self):
        app, store, audit, _ = _world(policy=POLICY_UNMATCHED)
        store.fail = {"add"}
        with TestClient(app, raise_server_exceptions=False) as client:
            r = client.post("/ingest", json=obs("spo2", 97, TYPO, WHEN), headers=DEVICE)
            assert r.status_code == 500
            assert len(audit.records(tenant="h1", event_type=READING_UNMATCHED, limit=10)) == 1   # the row came first
            store.fail = set()
            again = client.post("/ingest", json=obs("spo2", 97, TYPO, WHEN), headers=DEVICE)      # the bridge's retry
            assert again.status_code == 200 and again.json() == {"patient_id": TYPO, "dropped": "unmatched"}
        assert len(store.unmatched("h1", since=WEEK)) == 1
        assert len(audit.records(tenant="h1", event_type=READING_UNMATCHED, limit=10)) == 2

    def test_a_re_sent_unmatched_reading_is_a_duplicate(self):
        app, store, audit, _ = _world(policy=POLICY_UNMATCHED)
        with TestClient(app) as client:
            assert client.post("/ingest", json=obs("spo2", 97, TYPO, WHEN), headers=DEVICE).json()["dropped"] == "unmatched"
            again = client.post("/ingest", json=obs("spo2", 97, TYPO, WHEN), headers=DEVICE)
            assert again.json() == {"patient_id": TYPO, "duplicate": True}
        assert len(store.unmatched("h1", since=WEEK)) == 1
        assert len(audit.records(tenant="h1", event_type=READING_UNMATCHED, limit=10)) == 1


class TestTheProductionPolicy:
    def test_postgres_lists_unknown_numbers_and_the_env_turns_it_back(self):
        url = "postgresql+asyncpg://u:p@db.invalid:5432/homunculus"
        assert prodserver._unknown_readings(url, {}) == POLICY_UNMATCHED
        assert prodserver._unknown_readings(url, {"READINGS_UNKNOWN_KEY": "card"}) == POLICY_CARD
        assert prodserver._unknown_readings(url, {"READINGS_UNKNOWN_KEY": " CARD "}) == POLICY_CARD
        assert prodserver._unknown_readings(url, {"READINGS_UNKNOWN_KEY": "anything else"}) == POLICY_UNMATCHED

    def test_a_development_start_keeps_the_card(self):
        assert prodserver._unknown_readings("", {}) == POLICY_CARD
        assert prodserver._unknown_readings("sqlite:///x.db", {"READINGS_UNKNOWN_KEY": "unmatched"}) == POLICY_CARD
```

Run: `cd /c/tmp/g3-cihaz-olcum/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_readings_unmatched.py 2>&1 | tail -3`
Expected: an error at collection — `ImportError: cannot import name 'POLICY_CARD' from 'homunculus.api.readings'`.

- [ ] **Step 2: The names (`api/readings.py`)**

In `homunculus-engine/src/homunculus/api/readings.py`, find (lines 43–45):

```python
#: `unmatched_reason`: no identity record under the number, or a discharged admission's number.
REASON_UNKNOWN = "unknown"
REASON_DISCHARGED = "discharged"
```

Replace with:

```python
#: `unmatched_reason`: no identity record under the number, or a discharged admission's number.
REASON_UNKNOWN = "unknown"
REASON_DISCHARGED = "discharged"
#: The audit rows of the list (spec §4). `reading_unmatched`: a device reading that matched nobody, WITH its value
#: — `{value, unit, obs_ts, device, reason}`, patient_id the number as received, subject the code (written by
#: `/ingest`, api/app.py). `reading_assigned` / `reading_rejected`: one row per set a person linked or rejected
#: (the router below, Task B6). The dashboard's «Denetim» page names all three (engineTypes.test.js reads these).
READING_UNMATCHED = "reading_unmatched"
READING_ASSIGNED = "reading_assigned"
READING_REJECTED = "reading_rejected"
#: D9: what `/ingest` does with a number no identity record exists for. `card`: today's behaviour — the reading
#: is applied and makes a nameless card (the default: the test suite, scripts/replay.py and the seed scripts
#: ingest without an identity). `unmatched`: the reading is listed, with no engine entry and no card (production).
POLICY_CARD = "card"
POLICY_UNMATCHED = "unmatched"
UNKNOWN_POLICIES = (POLICY_CARD, POLICY_UNMATCHED)
```

- [ ] **Step 3: The door's two new branches (`api/app.py`)**

In `homunculus-engine/src/homunculus/api/app.py`, find (lines 70–72):

```python
from homunculus.api.readings import (                             # G3-05
    MANUAL_CODES, InMemoryReadingStore, Reading, ReadingStore, device_reading, device_source, manual_reading,
)
```

Replace with:

```python
from homunculus.api.readings import (                             # G3-05
    MANUAL_CODES, POLICY_CARD, POLICY_UNMATCHED, READING_UNMATCHED, REASON_DISCHARGED, REASON_UNKNOWN,
    UNKNOWN_POLICIES, InMemoryReadingStore, Reading, ReadingStore, device_reading, device_source, manual_reading,
)
```

In the same file, find (lines 365–367):

```python
    tasks: TaskStore | None = None,
    readings: ReadingStore | None = None,
) -> FastAPI:
```

Replace with:

```python
    tasks: TaskStore | None = None,
    readings: ReadingStore | None = None,
    unknown_readings: str = POLICY_CARD,
) -> FastAPI:
```

In the same file, find (line 397):

```python
    `PostgresReadingStore` in production; None keeps the rows in memory, which is what the no-DB suite runs on.
```

Replace with:

```python
    `PostgresReadingStore` in production; None keeps the rows in memory, which is what the no-DB suite runs on.
    `unknown_readings` (G3-05, D9) is what `/ingest` does with a number no identity record exists for: `"card"`
    (the default — the reading is applied and makes a nameless card, as before) or `"unmatched"` (production: the
    reading is kept in the unmatched list, with no engine entry and no card). Any other word is a ValueError.
```

In the same file, find (line 404):

```python
    # A device token is a non-empty string. A missing token reads as "" further down, so an empty
```

Replace with:

```python
    if unknown_readings not in UNKNOWN_POLICIES:
        raise ValueError(f"unknown_readings must be one of {UNKNOWN_POLICIES}, not {unknown_readings!r}")
    # A device token is a non-empty string. A missing token reads as "" further down, so an empty
```

In the same file, find (lines 1512–1513):

```python
    async def _apply_reading(hospital: str, obs, record, wall_now: datetime, *,
                             reading: int | None = None) -> tuple[list, AuditRecord]:
```

Replace with:

```python
    def _file_unmatched(hospital: str, obs, reason: str, dropped: str) -> dict:
        """G3-05 (D4, D8, D9): a device reading whose number matches nobody — a discharged admission's, or (under
        the policy `unmatched`) one with no identity record. It is kept WITH its value: one `reading_unmatched`
        row, then the list's table row. Nothing reaches the engine: no evaluation, no hook, no stamp, no frame,
        no notification, no card. The answer is 200 (`dropped`), as the door has answered a discharged number
        since G2-A11: a per-reading 4xx on a device that keeps an old number would read as rejections in the
        hub's counters. A table write that FAILS is not swallowed here (D7): the list is the only place a nurse
        will see this reading, so the request fails (500) and the bridge sends it again."""
        written = audit.append(AuditEvent(hospital, READING_UNMATCHED, obs.patient_id, obs.code.value,
                                          {"value": obs.value, "unit": obs.unit,
                                           "obs_ts": obs.timestamp.isoformat(), "device": obs.source_device,
                                           "reason": reason}))
        readings.add(device_reading(hospital, obs, received_at=datetime.now(timezone.utc), audit_id=written.id,
                                    reason=reason))
        return {"patient_id": obs.patient_id, "dropped": dropped}

    async def _apply_reading(hospital: str, obs, record, wall_now: datetime, *,
                             reading: int | None = None) -> tuple[list, AuditRecord]:
```

In the same file, find (lines 1625–1631):

```python
        # G2-A11 (D3): a reading for a number whose admission here was discharged is dropped
        # before the engine — one audit row, no evaluation, no hook, no stamp, no frame, no
        # notification. The owner's decision (2026-10-26): no alert and no page may come of it.
        # 200, not 4xx: the input is well-formed and the server chose not to apply it, and a
        # per-reading 4xx on a monitor that keeps the old number would read as rejections in the
        # hub's counters. The one identity read a reading costs is reused for the frame below.
        record = identities.get(hospital, obs.patient_id)
```

Replace with:

```python
        # G2-A11 (D3), as G3-05 (D4) changed it: a reading for a number whose admission here was discharged
        # never reaches the engine — no evaluation, no hook, no stamp, no frame, no notification. The owner's
        # decision (2026-10-26) stands: no alert and no page may come of it. Since G3-05 its VALUE is kept, in
        # the unmatched list (`_file_unmatched`). 200, not 4xx: the input is well-formed and the server chose
        # not to apply it. The one identity read a reading costs is reused for the frame.
        record = identities.get(hospital, obs.patient_id)
```

In the same file, find (lines 1635–1639):

```python
        if is_tombstone(record):
            audit.append(AuditEvent(hospital, READING_DROPPED, obs.patient_id, obs.code.value,
                                    {"patient_id": obs.patient_id, "code": obs.code.value}))
            return {"patient_id": obs.patient_id, "dropped": DISCHARGED}
        _engine(hospital)       # the tenant is rehydrated before the request's clock is read, as before the move
```

Replace with:

```python
        if is_tombstone(record):
            return _file_unmatched(hospital, obs, REASON_DISCHARGED, DISCHARGED)
        # G3-05 (D9): a number nobody is admitted under. In the hospital it is listed and makes no card (it
        # overrides B1d D4 there); under the default policy it is applied as before.
        if record is None and unknown_readings == POLICY_UNMATCHED:
            return _file_unmatched(hospital, obs, REASON_UNKNOWN, POLICY_UNMATCHED)
        _engine(hospital)       # the tenant is rehydrated before the request's clock is read, as before the move
```

- [ ] **Step 4: The production policy (`api/prodserver.py`)**

In `homunculus-engine/src/homunculus/api/prodserver.py`, find (line 51):

```python
from homunculus.api.readings import InMemoryReadingStore, ReadingStore            # G3-05
```

Replace with:

```python
from homunculus.api.readings import (                                             # G3-05
    POLICY_CARD, POLICY_UNMATCHED, InMemoryReadingStore, ReadingStore,
)
```

In the same file, find (line 515):

```python
def _device_beds(url: str, hospital: str) -> DeviceBedSource | None:
```

Replace with:

```python
def _unknown_readings(url: str, env=None) -> str:
    """G3-05 (D9): what `/ingest` does with a number no identity record exists for. On a Postgres deployment —
    the hospital — the reading goes to the unmatched list and makes no card; READINGS_UNKNOWN_KEY=card turns
    that back, for a replay of recorded data into a deployment with no admissions. Anywhere else the reading is
    applied and makes a card, as before: a development start has no admissions to match against."""
    env = os.environ if env is None else env
    if not _is_production(url):
        return POLICY_CARD
    return POLICY_CARD if str(env.get("READINGS_UNKNOWN_KEY", "")).strip().lower() == POLICY_CARD else POLICY_UNMATCHED


def _device_beds(url: str, hospital: str) -> DeviceBedSource | None:
```

In the same file, find (lines 553–554):

```python
    readings=_readings(_database_url()),
)
```

Replace with:

```python
    readings=_readings(_database_url()),
    unknown_readings=_unknown_readings(_database_url()),
)
```

Add the variable to the module docstring's list of environment variables:

In `homunculus-engine/src/homunculus/api/prodserver.py`, find (lines 23–25):

```python
                   lab's source and the import's input

Production means a Postgres DATABASE_URL (`_is_production`). There, before anything is built,
```

Replace with:

```python
                   lab's source and the import's input
    READINGS_UNKNOWN_KEY
                   G3-05 (D9): on a Postgres deployment a device reading whose number has no identity
                   record goes to the «Eşleşmeyen ölçümler» list and makes no card; `card` turns that
                   back (the reading is applied and makes a nameless card) — for a replay of recorded
                   data only (`_unknown_readings`)

Production means a Postgres DATABASE_URL (`_is_production`). There, before anything is built,
```

- [ ] **Step 5: The assertions other tests make on the old row**

`reading_dropped_discharged` is no longer written at `/ingest`. Two existing tests read it there:

In `homunculus-engine/tests/test_api_discharge.py`, find (lines 79–87):

```python
    def test_is_dropped_before_the_engine_with_one_audit_row(self, app, client):
        _kabul(app.state.test_identities, "H-1", state="discharged")
        queue = app.state.broadcaster.subscribe("h1")
        r = client.post("/ingest", json=_obs("heart_rate", 140, "H-1"), headers=HEAD)
        assert r.status_code == 200 and r.json() == {"patient_id": "H-1", "dropped": "discharged"}
        [row] = _rows(app, "reading_dropped_discharged")
        assert row.patient_id == "H-1" and row.subject == "heart_rate"
        assert row.payload == {"patient_id": "H-1", "code": "heart_rate"}
        assert _rows(app, "ingest", "H-1") == [] and _rows(app, "alert", "H-1") == []
```

Replace with:

```python
    def test_is_dropped_before_the_engine_with_one_audit_row(self, app, client):
        """G3-05 (D4) changed the row, not the rule: the reading still never reaches the engine, but its row is
        `reading_unmatched` and keeps the value — it waits in the unmatched list (tests/test_readings_unmatched.py)."""
        _kabul(app.state.test_identities, "H-1", state="discharged")
        queue = app.state.broadcaster.subscribe("h1")
        r = client.post("/ingest", json=_obs("heart_rate", 140, "H-1"), headers=HEAD)
        assert r.status_code == 200 and r.json() == {"patient_id": "H-1", "dropped": "discharged"}
        assert _rows(app, "reading_dropped_discharged") == []
        [row] = _rows(app, "reading_unmatched")
        assert row.patient_id == "H-1" and row.subject == "heart_rate"
        assert row.payload == {"value": 140.0, "unit": "u", "obs_ts": WHEN.isoformat(), "device": "nce",
                               "reason": "discharged"}
        assert _rows(app, "ingest", "H-1") == [] and _rows(app, "alert", "H-1") == []
```

In `homunculus-engine/tests/test_kabul_identity.py`, find (lines 181–182):

```python
def dropped_rows(audit: InMemoryAuditLog) -> list:
    return audit.records(tenant="h1", event_type="reading_dropped_discharged", limit=100)
```

Replace with:

```python
def dropped_rows(audit: InMemoryAuditLog) -> list:
    """The rows `/ingest` writes for a tombstone's number: `reading_unmatched` since G3-05 (D4) — the reading
    still never reaches the engine, and its value is now kept for the unmatched list."""
    return audit.records(tenant="h1", event_type="reading_unmatched", limit=100)
```

In the same file, find (lines 203–205):

```python
        (row,) = dropped_rows(audit)
        assert (row.patient_id, row.subject, row.payload) == \
            ("H2600001", "spo2", {"patient_id": "H2600001", "code": "spo2"})
```

Replace with:

```python
        (row,) = dropped_rows(audit)
        assert (row.patient_id, row.subject, row.payload) == \
            ("H2600001", "spo2", {"value": 97.0, "unit": "u", "obs_ts": (T0 + timedelta(hours=2)).isoformat(),
                                  "device": "nce", "reason": "discharged"})
```

(The chart door's two tests further down the same file — `rows(audit, "reading_dropped_discharged")` — are right as they are: `POST /clinical/{id}` still writes that row.)

- [ ] **Step 6: Run to see them pass**

Run: `cd /c/tmp/g3-cihaz-olcum/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_readings_unmatched.py tests/test_readings_ingest.py tests/test_readings_wiring.py tests/test_api_discharge.py tests/test_kabul_identity.py tests/test_api_identity_ingest.py tests/test_prodserver_logging.py 2>&1 | tail -3`
Expected: `103 passed` (20 + 22 + 1 + 14 + 29 + 15 + 2).

- [ ] **Step 7: Commit**

```bash
cd /c/tmp/g3-cihaz-olcum && git add -- homunculus-engine/tests/test_readings_unmatched.py homunculus-engine/src/homunculus/api/readings.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/src/homunculus/api/prodserver.py homunculus-engine/tests/test_api_discharge.py homunculus-engine/tests/test_kabul_identity.py && git commit -m "feat(readings): a number that matches nobody goes to the list with its value — the policy switch for unknown numbers (G3-05 D4, D8, D9)" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>" -- homunculus-engine/tests/test_readings_unmatched.py homunculus-engine/src/homunculus/api/readings.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/src/homunculus/api/prodserver.py homunculus-engine/tests/test_api_discharge.py homunculus-engine/tests/test_kabul_identity.py
```

After this commit the dashboard's `screens/denetim/engineTypes.test.js` is red until Task W1 Part B: the engine now writes `reading_unmatched`, which «Denetim» does not name yet. That is by design (see «Order, lanes and file ownership»).

---

### Task B6: «Eşleşmeyen ölçümler» — the list, the link and the rejection (D10–D12), with their pins

**Files:**
- Test: `homunculus-engine/tests/test_readings_api.py` (new)
- Modify: `homunculus-engine/src/homunculus/api/readings.py` — lines 19–26, lines 70–71, after line 312 (the end of the file) (as each step finds the file)
- Modify: `homunculus-engine/src/homunculus/api/app.py` — lines 70–73, lines 888–889, line 1522 (as each step finds the file)
- Test: `homunculus-engine/tests/test_route_inventory.py` — lines 37–38 (as each step finds the file)
- Test: `homunculus-engine/tests/test_tenant_isolation.py` — line 835, line 909 (as each step finds the file)
- Test: `homunculus-engine/tests/test_nginx_routes.py` — lines 30–32 (as each step finds the file)
- Modify: `deploy/local/web/nginx.conf` — line 246 (as each step finds the file)
- Modify: `dashboard/vite.config.js` — line 106 (as each step finds the file)

Three routes in a factory router (`readings_router`, the task queue's pattern), bound to the app's caller resolver, its scope, its identity store and `_apply_reading`:

- `GET /readings/unmatched` — the last 7 days' waiting readings as sets (one number, one device, one time), newest arrival first;
- `POST /readings/unmatched/assign` — one set linked to a patient: each reading goes into the real engine at its own time with the device as its source (`_apply_reading`, with `reading` in the `ingest` payload), then one `reading_assigned` row;
- `POST /readings/unmatched/reject` — one set closed with a reason; the value is kept.

All three: `clinical.chart`, a person only (D10). A set under an unknown number has no patient, so every holder sees it; a set under a discharged number is shown only where the caller's scope reaches that patient's last unit (D11). The rows are claimed before anything is written and released when the write fails (D12).

Because the routes live in `homunculus.api.readings`, not in a `GUARDED_MODULES` router, they are pinned by `tests/test_route_inventory.py` `CALLER_RESOLVED_ROUTES` and `tests/test_tenant_isolation.py` — not by `test_route_permissions.py` `EXPECTED`, which stays 75 (departure E-1).

- [ ] **Step 1: Write the failing tests**

Create `homunculus-engine/tests/test_readings_api.py`:

```python
# homunculus-engine/tests/test_readings_api.py
"""G3-05 (spec D10–D12, §4): the unmatched list and its two actions against the DB-less app — who may, who sees
what, every refusal, a linked reading entering the real engine at its own time with the device as its source, a
claim released when the write fails, and a restart replaying the same picture. Synthetic numbers and values only
(CLAUDE.md rule 6)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.audit import InMemoryAuditLog
from homunculus.api.identity import Caller
from homunculus.api.patient_identity import KABUL, IdentityRecord, InMemoryIdentityStore
from homunculus.api.readings import (
    POLICY_UNMATCHED, READING_ASSIGNED, READING_NEEDS_PERSON, READING_REJECTED, STATE_ASSIGNED, STATE_REJECTED,
    STATE_UNMATCHED,
)
from homunculus.canonical import SignalCode
from homunculus.scope import Scope, ScopeReason
from homunculus.scope.resolver import UNKNOWN as UNKNOWN_SCOPE
from tests.test_ingest_apply import IMMEDIATE, obs
from tests.test_readings_ingest import _Flaky

TOKEN = "tok"
DEVICE = {"Authorization": f"Bearer {TOKEN}"}
NURSE = {"Authorization": "Bearer nurse-jwt"}            # unscoped here: no resolver names her
WARD1 = {"Authorization": "Bearer ward1-jwt"}            # scoped to unit u-1
WARD2 = {"Authorization": "Bearer ward2-jwt"}            # scoped to unit u-2
BLIP = {"Authorization": "Bearer blip-jwt"}              # a scope that cannot be read
VIEWER = {"Authorization": "Bearer viewer-jwt"}
CHART = frozenset({"board.view", "clinical.chart"})
PEOPLE = {
    "nurse-jwt": Caller(hospital="h1", actor="hem.ayse", groups=("nurse",), perms=CHART),
    "ward1-jwt": Caller(hospital="h1", actor="hem.leyla", groups=("nurse",), perms=CHART),
    "ward2-jwt": Caller(hospital="h1", actor="hem.zeynep", groups=("nurse",), perms=CHART),
    "blip-jwt": Caller(hospital="h1", actor="hem.nur", groups=("nurse",), perms=CHART),
    "viewer-jwt": Caller(hospital="h1", actor="dr.elif", groups=("physician",), perms=frozenset({"board.view"})),
}
SCOPES = {
    "ward1-jwt": Scope(False, ScopeReason.ASSIGNED, unit_ids=frozenset({"u-1"})),
    "ward2-jwt": Scope(False, ScopeReason.ASSIGNED, unit_ids=frozenset({"u-2"})),
    "blip-jwt": UNKNOWN_SCOPE,
}
KEY, OTHER, GONE, TYPO = "202600000001", "202600000002", "202600000003", "202600000010"
ADMISSION = "11111111-1111-4111-8111-111111111111"       # a synthetic admission id
WHEN = datetime.now(timezone.utc) - timedelta(minutes=30)
WEEK = WHEN - timedelta(days=7)
WHY = "yanlış numara girilmiş, hasta bulunamadı"


async def _resolve(credential: str):
    return PEOPLE.get(credential)


async def _resolve_scope(credential: str) -> Scope:
    return SCOPES.get(credential, Scope(True, ScopeReason.UNRESTRICTED_ROLE))


class _FailsOnce(InMemoryAuditLog):
    """An audit log whose next append of `fail_on` raises once — the database going away mid-request."""

    def __init__(self):
        super().__init__()
        self.fail_on = None

    def append(self, event):
        if event.event_type == self.fail_on:
            self.fail_on = None
            raise RuntimeError("audit down")
        return super().append(event)


def _identities() -> InMemoryIdentityStore:
    """KEY admitted in unit u-1, OTHER admitted in unit u-2, GONE discharged from unit u-1 (a tombstone)."""
    store = InMemoryIdentityStore()
    for key, unit, state in ((KEY, "u-1", "admitted"), (OTHER, "u-2", "admitted"), (GONE, "u-1", "discharged")):
        store.apply("h1", IdentityRecord(key, family="Hasta", given="Test", state=state, source=KABUL,
                                         unit_id=unit, bed_id=f"b-{key[-1]}", updated_at=WHEN - timedelta(hours=3)))
    return store


def _app(audit=None, store=None, identities=None):
    audit = audit if audit is not None else InMemoryAuditLog()
    store = store if store is not None else _Flaky(admitted={("h1", KEY): ADMISSION})
    identities = identities if identities is not None else _identities()
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve, resolve_scope=_resolve_scope,
                     audit=audit, identities=identities, readings=store, unknown_readings=POLICY_UNMATCHED)
    return app, store, audit


@pytest.fixture()
def world():
    app, store, audit = _app()
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client, store, audit


def _send(client, pairs, key=TYPO, when=WHEN, device="CONNEX-3A"):
    """Device readings the door lists: one set (one number, one device, one time)."""
    for code, value in pairs:
        r = client.post("/ingest", json=obs(code, value, key, when, device=device), headers=DEVICE)
        assert r.status_code == 200 and "dropped" in r.json(), r.text


def _list(client, headers=NURSE):
    r = client.get("/readings/unmatched", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _ids(client, key=TYPO, headers=NURSE):
    """The ids of every waiting reading under `key`, ascending — the order the two actions answer them in."""
    return sorted(reading["id"] for s in _list(client, headers)["sets"] if s["received_key"] == key
                  for reading in s["readings"])


def _assign(client, ids, patient=KEY, headers=NURSE):
    return client.post("/readings/unmatched/assign", json={"readings": ids, "patient_id": patient}, headers=headers)


def _reject(client, ids, reason=WHY, headers=NURSE):
    return client.post("/readings/unmatched/reject", json={"readings": ids, "reason": reason}, headers=headers)


def _code(r):
    detail = r.json()["detail"]
    return detail["code"] if isinstance(detail, dict) else detail


def _card(client, key=KEY):
    return next(p for p in client.get("/patients", headers=DEVICE).json()["patients"] if p["patient_id"] == key)


class TestWhoMay:
    ROUTES = [("GET", "/readings/unmatched"), ("POST", "/readings/unmatched/assign"), ("POST", "/readings/unmatched/reject")]

    @pytest.mark.parametrize("method,path", ROUTES)
    def test_no_credential_is_401(self, world, method, path):
        client, _, _ = world
        assert client.request(method, path, **({"json": {}} if method == "POST" else {})).status_code == 401

    @pytest.mark.parametrize("method,path", ROUTES)
    def test_the_chart_permission_is_needed(self, world, method, path):
        client, _, _ = world
        r = client.request(method, path, headers=VIEWER, **({"json": {}} if method == "POST" else {}))
        assert (r.status_code, r.json()["detail"]) == (403, "permission required: clinical.chart")

    @pytest.mark.parametrize("method,path", ROUTES)
    def test_a_device_token_is_refused(self, world, method, path):
        """D10: a person only — the bridge's token names nobody, and the list is a person's work."""
        client, _, _ = world
        r = client.request(method, path, headers=DEVICE, **({"json": {}} if method == "POST" else {}))
        assert (r.status_code, r.json()["detail"]) == (403, READING_NEEDS_PERSON)


class TestTheList:
    def test_an_empty_list(self, world):
        client, _, _ = world
        assert _list(client) == {"count": 0, "sets": []}

    def test_readings_are_grouped_into_sets_newest_arrival_first(self, world):
        client, _, _ = world
        _send(client, [("spo2", 97), ("heart_rate", 88)], key=TYPO, when=WHEN)
        _send(client, [("temperature", 37.2)], key=GONE, when=WHEN + timedelta(minutes=1))
        body = _list(client)
        assert body["count"] == 2 and [s["received_key"] for s in body["sets"]] == [GONE, TYPO]
        late, early = body["sets"]
        assert (late["reason"], early["reason"]) == ("discharged", "unknown")
        assert (early["source"], early["observed_at"], early["linkable"]) == ("CONNEX-3A", WHEN.isoformat(), True)
        assert early["received_at"] >= early["observed_at"]
        assert [(r["code"], r["value"], r["unit"]) for r in early["readings"]] == [("heart_rate", 88.0, "u"), ("spo2", 97.0, "u")]
        assert all(isinstance(r["id"], int) and sorted(r) == ["code", "id", "unit", "value"] for r in early["readings"])
        assert sorted(early) == ["linkable", "observed_at", "readings", "reason", "received_at", "received_key", "source"]

    def test_another_device_or_another_time_is_another_set(self, world):
        client, _, _ = world
        _send(client, [("spo2", 97)], when=WHEN)
        _send(client, [("spo2", 96)], when=WHEN, device="CONNEX-3B")
        _send(client, [("spo2", 95)], when=WHEN + timedelta(minutes=10))
        assert _list(client)["count"] == 3

    def test_a_reading_older_than_a_day_is_listed_but_not_linkable(self, world):
        client, _, _ = world
        _send(client, [("spo2", 97)], when=WHEN - timedelta(hours=25))
        [old] = _list(client)["sets"]
        assert old["linkable"] is False

    def test_a_reading_that_arrived_more_than_seven_days_ago_is_off_the_list(self, world):
        client, store, _ = world
        _send(client, [("spo2", 97)])
        [row] = store.unmatched("h1", since=WEEK)
        from dataclasses import replace
        store._rows[row.id] = replace(row, received_at=row.received_at - timedelta(days=8))
        assert _list(client) == {"count": 0, "sets": []}


class TestWhoSeesWhat:
    def test_an_unknown_number_is_everybodys(self, world):
        """D11: a set under an unknown number has no patient — hidden from scoped users it would never be worked."""
        client, _, _ = world
        _send(client, [("spo2", 97)], key=TYPO)
        for headers in (NURSE, WARD1, WARD2):
            assert [s["received_key"] for s in _list(client, headers)["sets"]] == [TYPO]

    def test_a_discharged_number_is_shown_where_the_scope_reaches_its_last_unit(self, world):
        client, _, _ = world
        _send(client, [("spo2", 97)], key=GONE)                          # GONE lay in u-1
        assert _list(client, WARD1)["count"] == 1 and _list(client, NURSE)["count"] == 1
        assert _list(client, WARD2) == {"count": 0, "sets": []}

    def test_a_set_the_caller_cannot_see_cannot_be_linked_or_rejected_by_id(self, world):
        client, store, _ = world
        _send(client, [("spo2", 97)], key=GONE)
        ids = _ids(client, GONE)
        assert (_assign(client, ids, OTHER, WARD2).status_code, _code(_assign(client, ids, OTHER, WARD2))) == (409, "reading_not_unmatched")
        assert _code(_reject(client, ids, headers=WARD2)) == "reading_not_unmatched"
        assert store.get("h1", ids)[0].state == STATE_UNMATCHED

    def test_a_scope_that_cannot_be_read_is_503_not_an_empty_list(self, world):
        client, _, _ = world
        _send(client, [("spo2", 97)])
        r = client.get("/readings/unmatched", headers=BLIP)
        assert (r.status_code, r.json()["detail"]) == (503, "kapsam şu anda okunamıyor")


class TestLinking:
    def test_a_linked_set_enters_the_engine_at_its_own_time_with_the_device_as_its_source(self, world):
        client, store, audit = world
        _send(client, IMMEDIATE)
        ids = _ids(client)
        queue = client.app.state.broadcaster.subscribe("h1")
        r = _assign(client, ids)
        assert r.status_code == 200, r.text
        assert r.json() == {"assigned": ids, "patient_id": KEY, "alerts": ["news2"]}
        # the engine: every value, at the measurement's own time, from the device — never «elle»
        state = client.app.state.board_link._engine("h1").state(KEY)
        for code, value in IMMEDIATE:
            [point] = state.history(SignalCode(code))
            assert (point.value, point.timestamp, point.source_device) == (float(value), WHEN, "CONNEX-3A")
        # … so the card scores exactly as if the device had sent the set under the right number
        card = _card(client)
        direct, _, _ = _app()
        with TestClient(direct) as other:
            for code, value in IMMEDIATE:
                assert "alerts" in other.post("/ingest", json=obs(code, value, KEY, WHEN), headers=DEVICE).json()
            want = _card(other)
        assert card["latest"]["news2"] == want["latest"]["news2"]
        assert [a["kind"] for a in card["alerts"]] == [a["kind"] for a in want["alerts"]] == ["news2"]
        assert not queue.empty()                                         # the card's frame went out
        # the trail: ordinary `ingest` rows under the patient, each naming its reading, then one row for the set
        rows = audit.records(tenant="h1", patient_id=KEY, event_type="ingest", limit=100)
        assert sorted(row.payload["reading"] for row in rows) == ids
        assert all(row.payload["device"] == "CONNEX-3A" and row.payload["obs_ts"] == WHEN.isoformat() for row in rows)
        assert len(audit.records(tenant="h1", patient_id=KEY, event_type="notification", limit=10)) == 1
        [linked] = audit.records(tenant="h1", event_type=READING_ASSIGNED, limit=10)
        assert (linked.patient_id, linked.subject) == (KEY, "reading")
        assert linked.payload == {"readings": ids, "received_key": TYPO, "reason": "unknown", "device": "CONNEX-3A",
                                  "obs_ts": WHEN.isoformat(), "actor": "hem.ayse"}
        # the table: filed under the patient and the stay, the number as typed kept
        by_entry = {row.payload["reading"]: row.id for row in rows}
        for row in store.get("h1", ids):
            assert (row.state, row.patient_key, row.received_key, row.admission_id) == (STATE_ASSIGNED, KEY, TYPO, ADMISSION)
            assert (row.entry_id, row.resolved_by) == (by_entry[row.id], "hem.ayse")
        assert _list(client) == {"count": 0, "sets": []}

    def test_a_double_link_is_409(self, world):
        client, _, audit = world
        _send(client, [("spo2", 97)])
        ids = _ids(client)
        assert _assign(client, ids).status_code == 200
        again = _assign(client, ids)
        assert (again.status_code, _code(again)) == (409, "reading_not_unmatched")
        assert len(audit.records(tenant="h1", patient_id=KEY, event_type="ingest", limit=10)) == 1

    def test_an_unknown_id_is_409_and_claims_nothing(self, world):
        client, store, _ = world
        _send(client, [("spo2", 97)])
        ids = _ids(client)
        r = _assign(client, ids + [ids[0] + 999])
        assert (r.status_code, _code(r)) == (409, "reading_not_unmatched")
        assert store.get("h1", ids)[0].state == STATE_UNMATCHED

    def test_ids_of_two_sets_are_422(self, world):
        client, store, _ = world
        _send(client, [("spo2", 97)], when=WHEN)
        _send(client, [("spo2", 96)], when=WHEN + timedelta(minutes=10))
        ids = _ids(client)
        r = _assign(client, ids)
        assert (r.status_code, _code(r)) == (422, "reading_set_mixed")
        assert all(row.state == STATE_UNMATCHED for row in store.get("h1", ids))

    def test_a_reading_older_than_24_hours_cannot_be_linked_only_rejected(self, world):
        client, _, _ = world
        _send(client, [("spo2", 97)], when=WHEN - timedelta(hours=25))
        ids = _ids(client)
        r = _assign(client, ids)
        assert (r.status_code, _code(r)) == (409, "reading_too_old")
        assert _reject(client, ids).status_code == 200

    def test_a_discharged_target_is_409(self, world):
        client, store, _ = world
        _send(client, [("spo2", 97)])
        ids = _ids(client)
        r = _assign(client, ids, GONE)
        assert (r.status_code, _code(r)) == (409, "reading_target_discharged")
        assert store.get("h1", ids)[0].state == STATE_UNMATCHED

    def test_a_target_out_of_scope_is_404_and_audited(self, world):
        client, _, audit = world
        _send(client, [("spo2", 97)])
        r = _assign(client, _ids(client, headers=WARD1), OTHER, WARD1)   # OTHER lies in u-2
        assert (r.status_code, r.json()["detail"]) == (404, "hasta bulunamadı")
        assert len(audit.records(tenant="h1", patient_id=OTHER, event_type="scope_denied", limit=10)) == 1

    def test_a_target_nobody_is_admitted_under_is_404_and_makes_no_card(self, world):
        client, store, _ = world
        _send(client, [("spo2", 97)])
        ids = _ids(client)
        r = _assign(client, ids, "202600000099")
        assert (r.status_code, r.json()["detail"]) == (404, "hasta bulunamadı")
        assert "202600000099" not in [p["patient_id"] for p in client.get("/patients", headers=DEVICE).json()["patients"]]
        assert store.get("h1", ids)[0].state == STATE_UNMATCHED

    @pytest.mark.parametrize("body", [
        {}, {"readings": [], "patient_id": KEY}, {"readings": "1", "patient_id": KEY}, {"readings": [True], "patient_id": KEY},
        {"readings": [1.5], "patient_id": KEY}, {"readings": [1, 1], "patient_id": KEY}, {"readings": list(range(1, 52)), "patient_id": KEY},
        {"readings": [1]}, {"readings": [1], "patient_id": ""}, {"readings": [1], "patient_id": 7},
    ])
    def test_a_malformed_body_is_422(self, world, body):
        client, _, _ = world
        assert client.post("/readings/unmatched/assign", json=body, headers=NURSE).status_code == 422

    def test_a_scoped_nurse_links_to_her_own_patient(self, world):
        client, _, _ = world
        _send(client, [("spo2", 97)])
        assert _assign(client, _ids(client, headers=WARD1), KEY, WARD1).status_code == 200

    def test_a_failed_write_releases_the_claim_and_the_retry_links(self):
        audit = _FailsOnce()
        app, store, _ = _app(audit=audit)
        with TestClient(app, raise_server_exceptions=False) as client:
            _send(client, [("spo2", 97), ("heart_rate", 88)])
            ids = _ids(client)
            audit.fail_on = "ingest"
            assert _assign(client, ids).status_code == 500
            assert all(row.state == STATE_UNMATCHED and row.resolved_by is None for row in store.get("h1", ids))
            assert _list(client)["count"] == 1                           # back on the list
            assert _assign(client, ids).status_code == 200
            assert all(row.state == STATE_ASSIGNED and row.patient_key == KEY for row in store.get("h1", ids))

    def test_a_reading_the_engine_took_is_never_released(self):
        """The second reading's `ingest` append fails: the first is in the engine and stays claimed and linked;
        only the second goes back to the list."""
        audit = _FailsOnce()
        app, store, _ = _app(audit=audit)
        with TestClient(app, raise_server_exceptions=False) as client:
            _send(client, [("heart_rate", 88)])
            first = _ids(client)
            assert _assign(client, first).status_code == 200             # … so the next `ingest` append is a later one
            _send(client, [("spo2", 97), ("temperature", 37.2)], when=WHEN + timedelta(minutes=1))
            ids = _ids(client)

            seen = {"n": 0}
            plain = audit.append

            def append(event):
                if event.event_type == "ingest":
                    seen["n"] += 1
                    if seen["n"] == 2:
                        raise RuntimeError("audit down")
                return plain(event)
            audit.append = append
            assert _assign(client, ids).status_code == 500
            audit.append = plain
            states = {row.code: (row.state, row.patient_key) for row in store.get("h1", ids)}
            assert states == {"spo2": (STATE_ASSIGNED, KEY), "temperature": (STATE_UNMATCHED, None)}

    def test_a_restart_replays_the_same_picture(self):
        audit, store = InMemoryAuditLog(), _Flaky(admitted={("h1", KEY): ADMISSION})
        first, _, _ = _app(audit=audit, store=store)
        with TestClient(first) as client:
            _send(client, IMMEDIATE)
            assert _assign(client, _ids(client)).status_code == 200
            live = _card(client)
        second, _, _ = _app(audit=audit, store=store)
        with TestClient(second) as client:
            again = _card(client)
            assert again["latest"]["news2"] == live["latest"]["news2"]
            assert [(a["kind"], a["severity"]) for a in again["alerts"]] == [(a["kind"], a["severity"]) for a in live["alerts"]]
            assert TYPO not in [p["patient_id"] for p in client.get("/patients", headers=DEVICE).json()["patients"]]
            assert _list(client) == {"count": 0, "sets": []}

    def test_a_re_sent_linked_reading_is_a_duplicate(self, world):
        client, _, audit = world
        _send(client, [("spo2", 97)])
        assert _assign(client, _ids(client)).status_code == 200
        r = client.post("/ingest", json=obs("spo2", 97, TYPO, WHEN), headers=DEVICE)
        assert r.json() == {"patient_id": TYPO, "duplicate": True}
        assert _list(client) == {"count": 0, "sets": []}


class TestRejecting:
    def test_a_rejected_set_is_closed_with_its_reason_and_the_value_is_kept(self, world):
        client, store, audit = world
        _send(client, [("spo2", 97), ("heart_rate", 88)])
        ids = _ids(client)
        r = _reject(client, ids, reason=f"  {WHY}  ")
        assert r.status_code == 200 and r.json() == {"rejected": ids}
        for row in store.get("h1", ids):
            assert (row.state, row.resolve_reason, row.resolved_by, row.patient_key) == (STATE_REJECTED, WHY, "hem.ayse", None)
        assert sorted(row.value for row in store.get("h1", ids)) == [88.0, 97.0]
        [closed] = audit.records(tenant="h1", event_type=READING_REJECTED, limit=10)
        assert (closed.patient_id, closed.subject) == (TYPO, "reading")
        assert closed.payload == {"readings": ids, "received_key": TYPO, "device": "CONNEX-3A", "obs_ts": WHEN.isoformat(),
                                  "reason": WHY, "actor": "hem.ayse"}
        assert audit.records(tenant="h1", event_type="ingest", limit=10) == []      # nothing reached the engine
        assert _list(client) == {"count": 0, "sets": []}

    @pytest.mark.parametrize("reason", ["kısa", " " * 20, "x" * 201, None, 7])
    def test_the_reason_is_10_to_200_characters(self, world, reason):
        client, store, _ = world
        _send(client, [("spo2", 97)])
        ids = _ids(client)
        r = _reject(client, ids, reason=reason)
        assert (r.status_code, _code(r)) == (422, "reading_reason_length")
        assert store.get("h1", ids)[0].state == STATE_UNMATCHED

    def test_a_reason_of_exactly_10_and_of_200_is_taken(self, world):
        client, _, _ = world
        _send(client, [("spo2", 97)], when=WHEN)
        assert _reject(client, _ids(client), reason="ğ" * 10).status_code == 200
        _send(client, [("spo2", 96)], when=WHEN + timedelta(minutes=1))
        assert _reject(client, _ids(client), reason="ğ" * 200).status_code == 200

    def test_a_second_rejection_and_a_link_after_it_are_409(self, world):
        client, _, _ = world
        _send(client, [("spo2", 97)])
        ids = _ids(client)
        assert _reject(client, ids).status_code == 200
        assert _code(_reject(client, ids)) == "reading_not_unmatched"
        assert _code(_assign(client, ids)) == "reading_not_unmatched"

    def test_ids_of_two_sets_are_422(self, world):
        client, _, _ = world
        _send(client, [("spo2", 97)], when=WHEN)
        _send(client, [("spo2", 96)], when=WHEN + timedelta(minutes=10))
        r = _reject(client, _ids(client))
        assert (r.status_code, _code(r)) == (422, "reading_set_mixed")

    def test_a_failed_audit_row_releases_the_claim(self):
        audit = _FailsOnce()
        app, store, _ = _app(audit=audit)
        with TestClient(app, raise_server_exceptions=False) as client:
            _send(client, [("spo2", 97)])
            ids = _ids(client)
            audit.fail_on = READING_REJECTED
            assert _reject(client, ids).status_code == 500
            assert store.get("h1", ids)[0].state == STATE_UNMATCHED and _list(client)["count"] == 1
            assert _reject(client, ids).status_code == 200

    def test_a_re_sent_rejected_reading_is_a_duplicate(self, world):
        client, _, _ = world
        _send(client, [("spo2", 97)])
        assert _reject(client, _ids(client)).status_code == 200
        r = client.post("/ingest", json=obs("spo2", 97, TYPO, WHEN), headers=DEVICE)
        assert r.json() == {"patient_id": TYPO, "duplicate": True}
        assert _list(client) == {"count": 0, "sets": []}


def test_another_hospital_neither_sees_nor_touches_the_list():
    people = {**PEOPLE, "h2-jwt": Caller(hospital="h2", actor="hem.h2", groups=("nurse",), perms=CHART)}

    async def resolve(credential):
        return people.get(credential)
    store = _Flaky()
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=resolve, identities=_identities(),
                     readings=store, unknown_readings=POLICY_UNMATCHED)
    h2 = {"Authorization": "Bearer h2-jwt"}
    with TestClient(app) as client:
        _send(client, [("spo2", 97)])
        ids = _ids(client)
        assert _list(client, h2) == {"count": 0, "sets": []}
        assert _code(_reject(client, ids, headers=h2)) == "reading_not_unmatched"
        assert store.get("h1", ids)[0].state == STATE_UNMATCHED
```

Run: `cd /c/tmp/g3-cihaz-olcum/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_readings_api.py 2>&1 | tail -3`
Expected: an error at collection — `ImportError: cannot import name 'READING_NEEDS_PERSON' from 'homunculus.api.readings'`.

- [ ] **Step 2: The router (`api/readings.py`)**

In `homunculus-engine/src/homunculus/api/readings.py`, find (lines 19–26):

```python
import logging
from collections.abc import Iterable
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from typing import Protocol

from homunculus.api.clinical import FLUID_CODES, RETRACTABLE_CODES
from homunculus.canonical import Observation
```

Replace with:

```python
import logging
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from typing import Protocol

from fastapi import APIRouter, Body, Header, HTTPException

from homunculus.api.audit import AuditEvent, AuditLog
from homunculus.api.clinical import FLUID_CODES, RETRACTABLE_CODES
from homunculus.api.identity import Caller
from homunculus.auth.permissions import validate_permissions
from homunculus.canonical import Observation, SignalCode
from homunculus.gateway.fhir import PATIENT_ID_MAX
```

In the same file, find (lines 70–71):

```python
SOURCE_MAX = 64
UNIT_MAX = 16
```

Replace with:

```python
SOURCE_MAX = 64
UNIT_MAX = 16

(CLINICAL_CHART,) = validate_permissions(("clinical.chart",))
#: The list shows what arrived in the last 7 days (spec §4); an older reading stays in the table.
UNMATCHED_WINDOW = timedelta(days=7)
#: D12, Q2: a reading measured longer ago than this cannot be linked, only rejected — G3-01 D7's back-dating
#: bound for a hand entry (api/clinical.py BEDSIDE_BACKDATE). An engineering bound on what may enter a score
#: late, not a clinical threshold.
LINK_MAX_AGE = timedelta(hours=24)
#: The most readings one link or rejection names: a set is one round's values of one patient.
SET_MAX = 50
REJECT_MIN_REASON_CHARS = 10
REJECT_MAX_REASON_CHARS = 200

# ----------------------------------------------------------------------------- refusal codes and words

READING_NOT_UNMATCHED = "reading_not_unmatched"
READING_SET_MIXED = "reading_set_mixed"
READING_TOO_OLD = "reading_too_old"
READING_TARGET_DISCHARGED = "reading_target_discharged"
READING_REASON_LENGTH = "reading_reason_length"
#: The server's words. The dashboard maps each code in `apiErrors.js` (Task W1).
WORDS = {
    READING_NOT_UNMATCHED: "The reading is no longer waiting: it was linked or rejected already.",
    READING_SET_MIXED: "The readings are not one set: one number, one device, one time.",
    READING_TOO_OLD: "A reading older than 24 hours cannot be linked; it can only be rejected.",
    READING_TARGET_DISCHARGED: "The patient is discharged: a reading cannot be linked to a closed stay.",
    READING_REASON_LENGTH: "The reason is 10–200 characters.",
}
READING_NEEDS_PERSON = "a person links or rejects a reading: this credential names no actor"
READING_BODY = "`readings` is a list of 1–50 reading ids"
READING_TARGET = "`patient_id` is required"


def reading_refusal(status: int, code: str) -> HTTPException:
    """A refusal with its code beside its words (`{"code", "message"}`), as the task queue answers one."""
    return HTTPException(status_code=status, detail={"code": code, "message": WORDS[code]})
```

Append to the end of `homunculus-engine/src/homunculus/api/readings.py` (after line 312):

```python


# ----------------------------------------------------------------------------- the list's sets

def _iso(at: datetime) -> str:
    return at.astimezone(timezone.utc).isoformat()


def set_key(row: Reading) -> tuple[str, str, datetime]:
    """One set: one number, one device, one time (spec D10) — a round's values of one patient."""
    return (row.received_key, row.source, row.observed_at)


def unmatched_sets(rows: Iterable[Reading], now: datetime) -> list[dict]:
    """The waiting rows as the list answers them (spec §4): one entry per set, the newest arrival first, each
    reading by code. `linkable`: measured within LINK_MAX_AGE of `now` — the screen offers «bağla» only then
    (the engine refuses an older one, READING_TOO_OLD), so the browser judges no age itself."""
    grouped: dict[tuple, list[Reading]] = {}
    for row in rows:
        grouped.setdefault(set_key(row), []).append(row)
    sets = []
    for (received_key, source, observed_at), members in grouped.items():
        members.sort(key=lambda r: (r.code, r.id))
        sets.append({
            "received_key": received_key, "reason": members[0].unmatched_reason, "source": source,
            "observed_at": _iso(observed_at), "received_at": _iso(max(r.received_at for r in members)),
            "linkable": now - observed_at <= LINK_MAX_AGE,
            "readings": [{"id": r.id, "code": r.code, "value": r.value, "unit": r.unit} for r in members],
        })
    sets.sort(key=lambda s: (s["received_at"], s["received_key"], s["source"]), reverse=True)
    return sets


# ----------------------------------------------------------------------------- the router

def readings_router(*, caller: Callable[[str | None], Awaitable[Caller]],
                    sees: Callable[[Caller, str | None], Awaitable[Callable[[str], bool]]],
                    target: Callable[[Caller, str | None, str], Awaitable[object]],
                    admission_for: Callable[[str, object], str | None],
                    apply: Callable[..., Awaitable[tuple[list, object]]],
                    audit: AuditLog, store: ReadingStore,
                    clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc)) -> APIRouter:
    """«Eşleşmeyen ölçümler» (spec §4, D10–D12), bound to the app as the task queue is: `caller` resolves the
    credential; `sees(caller, authorization)` resolves the caller's scope once (503 when it cannot be read) and
    answers «may this caller see the patient under this number» (D11); `target(caller, authorization, patient_id)`
    is the link's target check — in scope (404), not discharged (409), on the board (404) — answering the
    identity record; `admission_for(hospital, record)` is the stay a reading is stamped with (D8);
    `apply(hospital, obs, record, now, reading=id)` is the device door's own tail (`_apply_reading`)."""
    router = APIRouter(tags=["readings"])

    def _person(who: Caller) -> str:
        """`clinical.chart`, and a person: a device passes every permission check by being a device, and the
        list is a person's work, named in the trail (D10)."""
        if not who.can(CLINICAL_CHART):
            raise HTTPException(status_code=403, detail=f"permission required: {CLINICAL_CHART}")
        if who.is_device or not isinstance(who.actor, str) or not who.actor.strip():
            raise HTTPException(status_code=403, detail=READING_NEEDS_PERSON)
        return who.actor

    def _ids(body: dict) -> list[int]:
        raw = body.get("readings")
        if (not isinstance(raw, list) or not 1 <= len(raw) <= SET_MAX or len(set(map(repr, raw))) != len(raw)
                or any(not isinstance(i, int) or isinstance(i, bool) or i < 1 for i in raw)):
            raise HTTPException(status_code=422, detail=READING_BODY)
        return sorted(raw)

    async def _one_set(who: Caller, authorization: str | None, ids: list[int]) -> list[Reading]:
        """The rows named, when every one is waiting, visible to this caller (D11) and of one set — else the
        refusal. A row the caller may not see answers as one that is not there."""
        visible = await sees(who, authorization)
        rows = [r for r in store.get(who.hospital, ids)
                if r.state == STATE_UNMATCHED
                and (r.unmatched_reason != REASON_DISCHARGED or visible(r.received_key))]
        if len(rows) != len(ids):
            raise reading_refusal(409, READING_NOT_UNMATCHED)
        if len({set_key(r) for r in rows}) != 1:
            raise reading_refusal(422, READING_SET_MIXED)
        return rows

    def _claim(hospital: str, ids: list[int], actor: str, now: datetime) -> list[Reading]:
        try:
            return store.claim(hospital, ids, by=actor, at=now)
        except ReadingNotUnmatched:                       # another hand got there between the read and the write
            raise reading_refusal(409, READING_NOT_UNMATCHED) from None

    def _release(hospital: str, ids: list[int]) -> None:
        """A claim put back after a failed write — best effort: if this fails too, `reconcile` releases it."""
        if not ids:
            return
        try:
            store.release(hospital, ids)
        except Exception:
            log.exception("vital_readings: %d ölçümün kilidi bırakılamadı (hastane %s); reconcile bırakır",
                          len(ids), hospital)

    @router.get("/readings/unmatched")
    async def list_unmatched(authorization: str | None = Header(default=None)):
        who = await caller(authorization)
        _person(who)
        visible = await sees(who, authorization)
        now = clock()
        rows = [r for r in store.unmatched(who.hospital, since=now - UNMATCHED_WINDOW)
                if r.unmatched_reason != REASON_DISCHARGED or visible(r.received_key)]
        sets = unmatched_sets(rows, now)
        return {"count": len(sets), "sets": sets}

    @router.post("/readings/unmatched/assign")
    async def assign(body: dict = Body(...), authorization: str | None = Header(default=None)):
        who = await caller(authorization)
        actor = _person(who)
        hospital = who.hospital
        ids = _ids(body)
        patient_id = body.get("patient_id")
        if not isinstance(patient_id, str) or not patient_id.strip() or len(patient_id) > PATIENT_ID_MAX:
            raise HTTPException(status_code=422, detail=READING_TARGET)
        record = await target(who, authorization, patient_id)
        rows = await _one_set(who, authorization, ids)
        now = clock()
        if now - rows[0].observed_at > LINK_MAX_AGE:
            raise reading_refusal(409, READING_TOO_OLD)
        claimed = _claim(hospital, ids, actor, now)
        # From here the rows are ours. Each reading goes into the engine as the device door would have put it
        # (D12): its own time, the device as its source, an ordinary `ingest` row that names it. A reading the
        # engine has taken is never released — released, it could be linked a second time; one whose table row
        # could not be filed stays claimed, and `reconcile` files it from its `ingest` row. What the engine has
        # not taken goes back to the list when anything fails, and the failure goes up (500).
        waiting = [r.id for r in claimed]
        alerts: list = []
        try:
            admission = admission_for(hospital, record)
            for row in claimed:
                obs = Observation(patient_id=patient_id, code=SignalCode(row.code), value=row.value, unit=row.unit,
                                  timestamp=row.observed_at, source_device=row.source)
                alerts, written = await apply(hospital, obs, record, now, reading=row.id)
                waiting.remove(row.id)
                store.finalize(hospital, row.id, patient_key=patient_id, admission_id=admission, entry_id=written.id)
        except Exception:
            _release(hospital, waiting)
            raise
        first = claimed[0]
        audit.append(AuditEvent(hospital, READING_ASSIGNED, patient_id, "reading", {
            "readings": ids, "received_key": first.received_key, "reason": first.unmatched_reason,
            "device": first.source, "obs_ts": _iso(first.observed_at), "actor": actor}))
        return {"assigned": ids, "patient_id": patient_id, "alerts": [a.kind for a in alerts]}

    @router.post("/readings/unmatched/reject")
    async def reject(body: dict = Body(...), authorization: str | None = Header(default=None)):
        who = await caller(authorization)
        actor = _person(who)
        hospital = who.hospital
        ids = _ids(body)
        raw = body.get("reason")
        reason = raw.strip() if isinstance(raw, str) else ""
        if not REJECT_MIN_REASON_CHARS <= len(reason) <= REJECT_MAX_REASON_CHARS:
            raise reading_refusal(422, READING_REASON_LENGTH)
        rows = await _one_set(who, authorization, ids)
        _claim(hospital, ids, actor, clock())
        first = rows[0]
        # The audit row, then the table's (D7). An append that fails releases the claim: nothing was rejected.
        try:
            audit.append(AuditEvent(hospital, READING_REJECTED, first.received_key, "reading", {
                "readings": ids, "received_key": first.received_key, "device": first.source,
                "obs_ts": _iso(first.observed_at), "reason": reason, "actor": actor}))
        except Exception:
            _release(hospital, ids)
            raise
        store.reject(hospital, ids, reason=reason)
        return {"rejected": ids}

    return router
```

- [ ] **Step 3: Bind it in `create_app` (`api/app.py`)**

In `homunculus-engine/src/homunculus/api/app.py`, find (lines 70–73):

```python
from homunculus.api.readings import (                             # G3-05
    MANUAL_CODES, POLICY_CARD, POLICY_UNMATCHED, READING_UNMATCHED, REASON_DISCHARGED, REASON_UNKNOWN,
    UNKNOWN_POLICIES, InMemoryReadingStore, Reading, ReadingStore, device_reading, device_source, manual_reading,
)
```

Replace with:

```python
from homunculus.api.readings import (                             # G3-05
    MANUAL_CODES, POLICY_CARD, POLICY_UNMATCHED, READING_TARGET_DISCHARGED, READING_UNMATCHED, REASON_DISCHARGED,
    REASON_UNKNOWN, UNKNOWN_POLICIES, InMemoryReadingStore, Reading, ReadingStore, device_reading, device_source,
    manual_reading, reading_refusal, readings_router,
)
```

In the same file, find (lines 888–889):

```python
    app.include_router(tasks_router(caller=lambda authorization: _caller(authorization),
                                    board=_tasks_board, audit=audit, store=tasks))
```

Replace with:

```python
    app.include_router(tasks_router(caller=lambda authorization: _caller(authorization),
                                    board=_tasks_board, audit=audit, store=tasks))
    # G3-05: «Eşleşmeyen ölçümler» — the unmatched list, the link and the rejection, bound the same way: the
    # closures below are read when a request arrives.
    app.include_router(readings_router(
        caller=lambda authorization: _caller(authorization),
        sees=lambda who, authorization: _reading_visibility(who, authorization),
        target=lambda who, authorization, patient_id: _link_target(who, authorization, patient_id),
        admission_for=lambda hospital, record: _admission_for(hospital, record),
        apply=lambda hospital, obs, record, now, reading: _apply_reading(hospital, obs, record, now, reading=reading),
        audit=audit, store=readings))
```

In the same file, find (line 1522):

```python
    def _file_unmatched(hospital: str, obs, reason: str, dropped: str) -> dict:
```

Replace with:

```python
    async def _reading_visibility(caller: Caller, authorization: str | None) -> Callable[[str], bool]:
        """G3-05 (D11): «may this caller see the patient under this number» — for the unmatched sets of a
        DISCHARGED number, which are shown only where the caller's scope reaches that patient's last unit (the
        tombstone keeps it; `_scope_card` reads it there). The scope is resolved once per request; one that
        cannot be read is 503, never an empty list (G2-A2, D13)."""
        scope = _readable(await _scope(authorization))
        if scope.unrestricted:
            return lambda key: True
        hospital = caller.hospital
        return lambda key: sees_patient(_scope_card(hospital, key), scope)

    async def _link_target(caller: Caller, authorization: str | None, patient_id: str):
        """G3-05 (D11): the patient an unmatched reading may be linked to — in the caller's scope
        (`_require_patient`: 404, audited), not discharged (409: linking to a closed stay is out of this slice),
        and on the board: an identity record or a patient the engine has measured (404 otherwise — a link must
        never create a card). Answers the identity record, None for a measured patient nobody named."""
        await _require_patient(caller, authorization, patient_id)
        record = identities.get(caller.hospital, patient_id)
        if is_tombstone(record):
            raise reading_refusal(409, READING_TARGET_DISCHARGED)
        if record is None and patient_id not in set(_engine(caller.hospital).patient_ids()):
            raise HTTPException(status_code=404, detail="hasta bulunamadı")
        return record

    def _file_unmatched(hospital: str, obs, reason: str, dropped: str) -> dict:
```

- [ ] **Step 4: Run to see them pass**

Run: `cd /c/tmp/g3-cihaz-olcum/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_readings_api.py 2>&1 | tail -3`
Expected: `53 passed`.

- [ ] **Step 5: The pins — the route inventory, the tenant walk, nginx and the dev proxy**

Run first, to see the four pins fail for the right reason:

`cd /c/tmp/g3-cihaz-olcum/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_route_inventory.py tests/test_nginx_routes.py tests/test_tenant_isolation.py 2>&1 | tail -6`
Expected: `2 failed` among the rest — `test_every_route_is_guarded_or_explicitly_exempt` (the three `/readings/unmatched…` routes) and `test_every_app_route_prefix_is_proxied` (`routers not proxied by nginx: ['/readings']`). (`test_tenant_isolation.py`'s route walk is DB-backed and skips here; its table is edited all the same.)

In `homunculus-engine/tests/test_route_inventory.py`, find (lines 37–38):

```python
                          ("homunculus.api.tasks", "GET", "/tasks/settings"),
                          ("homunculus.api.tasks", "PUT", "/tasks/settings")}
```

Replace with:

```python
                          ("homunculus.api.tasks", "GET", "/tasks/settings"),
                          ("homunculus.api.tasks", "PUT", "/tasks/settings"),
                          # G3-05: «Eşleşmeyen ölçümler» resolves its caller the same way — `clinical.chart`,
                          # and a person only (tests/test_readings_api.py holds both)
                          ("homunculus.api.readings", "GET", "/readings/unmatched"),
                          ("homunculus.api.readings", "POST", "/readings/unmatched/assign"),
                          ("homunculus.api.readings", "POST", "/readings/unmatched/reject")}
```

In `homunculus-engine/tests/test_tenant_isolation.py`, find (line 835):

```python
UNSCOPED_BY_DESIGN = NOT_THE_BOARD | CALLER_ELSEWHERE | DEVICE_ONLY | TASK_QUEUE | {
```

Replace with:

```python
# G3-05: «Eşleşmeyen ölçümler» (api/readings.py) is a factory router bound to the app's `_caller`, its scope
# and `_require_patient`: the caller's own hospital's rows only (the store is read by `who.hospital`), a
# discharged number's set only inside the caller's scope, a link only to a patient in it.
UNMATCHED_READINGS = {
    ("GET", "/readings/unmatched"),
    ("POST", "/readings/unmatched/assign"),
    ("POST", "/readings/unmatched/reject"),
}
UNSCOPED_BY_DESIGN = NOT_THE_BOARD | CALLER_ELSEWHERE | DEVICE_ONLY | TASK_QUEUE | UNMATCHED_READINGS | {
```

In the same file, find (line 909):

```python
    assert UNSCOPED_BY_DESIGN - NOT_THE_BOARD - CALLER_ELSEWHERE - DEVICE_ONLY - TASK_QUEUE == board
```

Replace with:

```python
    assert UNSCOPED_BY_DESIGN - NOT_THE_BOARD - CALLER_ELSEWHERE - DEVICE_ONLY - TASK_QUEUE - UNMATCHED_READINGS == board
```

In `homunculus-engine/tests/test_nginx_routes.py`, find (lines 30–32):

```python
    "/ingest", "/view", "/audit", "/audit/verify", "/health", "/stream", "/stream-ticket",
    "/notifications",
]
```

Replace with:

```python
    "/ingest", "/view", "/audit", "/audit/verify", "/health", "/stream", "/stream-ticket",
    "/notifications", "/readings/unmatched",       # G3-05: «Eşleşmeyen ölçümler»
]
```

In `deploy/local/web/nginx.conf`, find (line 246):

```nginx
    location ~ ^/(auth|admin|tenant|admissions|shift-schedule|handovers|alerts|break-glass|scope|clinical|scores|alarm-quality|infinity-research|infinity-shadow|infinity-waves|patients|ack|ingest|view|audit|health|tasks|pharmacy)(/|$) {
```

Replace with:

```nginx
    location ~ ^/(auth|admin|tenant|admissions|shift-schedule|handovers|alerts|break-glass|scope|clinical|scores|alarm-quality|infinity-research|infinity-shadow|infinity-waves|patients|ack|ingest|view|audit|health|tasks|pharmacy|readings)(/|$) {
```

The dashboard's `src/devProxy.test.js` holds «every API path nginx proxies is in the dev server's proxy list», so the dev proxy's line travels with nginx's, in this commit (G3-04's E6 did the same):

In `dashboard/vite.config.js`, find (line 106):

```js
      "/pharmacy",          // G3-04: Eczane — the pharmacist's ward page
```

Replace with:

```js
      "/pharmacy",          // G3-04: Eczane — the pharmacist's ward page
      "/readings",          // G3-05: «Eşleşmeyen ölçümler» — the unmatched list, the link, the rejection
```

The three `/readings/unmatched…` paths carry no key or id (numbers and ids travel in bodies, spec §4), so nginx's log map needs no entry: they fall to `default $uri` and are logged as they are — `tests/test_access_log_redaction.py` `test_routes_without_a_parameter_are_logged_as_they_are` holds that.

- [ ] **Step 6: Run the pins**

Run: `cd /c/tmp/g3-cihaz-olcum/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_route_inventory.py tests/test_nginx_routes.py tests/test_tenant_isolation.py tests/test_access_log_redaction.py tests/test_route_permissions.py tests/test_board_permissions.py 2>&1 | tail -3`
Expected: `154 passed, 139 skipped` (the skips are DB-backed: `test_tenant_isolation.py`'s 133 and `test_route_permissions.py`'s 6).

Run: `cd /c/tmp/g3-cihaz-olcum/dashboard && npx vitest run src/devProxy.test.js 2>&1 | tail -5`
Expected: `Tests  5 passed (5)`.

- [ ] **Step 7: Commit**

```bash
cd /c/tmp/g3-cihaz-olcum && git add -- homunculus-engine/tests/test_readings_api.py homunculus-engine/src/homunculus/api/readings.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_route_inventory.py homunculus-engine/tests/test_tenant_isolation.py homunculus-engine/tests/test_nginx_routes.py deploy/local/web/nginx.conf dashboard/vite.config.js && git commit -m "feat(readings): «Eşleşmeyen ölçümler» — the unmatched list, the link into the real engine, the rejection (G3-05 D10–D12)" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>" -- homunculus-engine/tests/test_readings_api.py homunculus-engine/src/homunculus/api/readings.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_route_inventory.py homunculus-engine/tests/test_tenant_isolation.py homunculus-engine/tests/test_nginx_routes.py deploy/local/web/nginx.conf dashboard/vite.config.js
```

After this commit the engine also writes `reading_assigned` and `reading_rejected`: the dashboard's `engineTypes.test.js` stays red until Task W1 Part B names the three.

---

### Task B7: A wrong device value can be withdrawn — «hatalı giriş» takes `ingest` rows (D3, D13)

**Files:**
- Test: `homunculus-engine/tests/test_device_retract.py` (new)
- Modify: `homunculus-engine/src/homunculus/api/clinical.py` — lines 173–175, line 202 (as each step finds the file)
- Modify: `homunculus-engine/src/homunculus/api/rehydrate.py` — lines 52–53, lines 59–61, line 138, lines 257–258, line 272, lines 284–285 (as each step finds the file)
- Modify: `homunculus-engine/src/homunculus/api/app.py` — lines 512–513, lines 1343–1345, line 1366, lines 1402–1404, lines 1439–1442 (as each step finds the file)
- Test: `homunculus-engine/tests/test_bedside_retract.py` — lines 264–265 (as each step finds the file)

`POST /clinical/{id}/entries/{entry}/retract` now accepts the patient's `ingest` row as well as its `chart` row, when the code is in `RETRACTABLE_CODES`: the same permission, a person only, the same reason bounds, the same rebuild — every score as if the value had never arrived. The audit event stays `chart_retract` — so every reader of withdrawals honours it without a change — and for a device row its payload gains `"origin": "device"` and `"device"`. The restart's replay and the one-patient rebuild skip a withdrawn `ingest` row as they skip a withdrawn `chart` row. The table's row is marked (`void`) after the audit row; a re-sent copy of the reading is a duplicate (D14), so it does not come back. `RETRACT_UNKNOWN` no longer says «elle girilmiş».

**This overrides G3-01 D11** («a device value cannot be withdrawn»). The corrected value is an ordinary hand entry at the reading's own time (`POST /clinical/{id}` with `recorded_at`), which the dashboard offers in the same dialog (Task W2); nothing new is needed here for it.

- [ ] **Step 1: Write the failing tests**

Create `homunculus-engine/tests/test_device_retract.py`:

```python
# homunculus-engine/tests/test_device_retract.py
"""G3-05 (spec D3, D13; O2): «hatalı giriş» for a device reading. A withdrawn `ingest` row leaves every score as
if the value had never arrived; the trail keeps both rows; the record's row is marked and a re-sent copy does not
bring it back; the restart and the one-patient rebuild skip it; every other reader of withdrawals answers as
before; and a restart after one does not hand an old acknowledgement to an alert it did not answer. Synthetic
numbers and values only (CLAUDE.md rule 6)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api import fluids, pharmacy, tasks
from homunculus.api.app import create_app
from homunculus.api.audit import AuditEvent, InMemoryAuditLog
from homunculus.api.clinical import (
    RETRACT, RETRACT_ALREADY, RETRACT_NEEDS_PERSON, RETRACT_NOT_BEDSIDE, RETRACT_UNKNOWN,
)
from homunculus.api.identity import Caller
from homunculus.api.readings import InMemoryReadingStore
from homunculus.api.rehydrate import observation_of, rebuild_patient, rehydrate, retracted_entries
from homunculus.api.ackstore import AckStore
from homunculus.canonical import Observation, SignalCode
from homunculus.gateway.fhir import parse_fhir_observation
from homunculus.pipeline import Engine
from tests.test_ingest_apply import obs

TOKEN = "tok"
DEVICE = {"Authorization": f"Bearer {TOKEN}"}
NURSE = {"Authorization": "Bearer nurse-jwt"}
PEOPLE = {"nurse-jwt": Caller(hospital="h1", actor="hem.ayse", groups=("nurse",),
                              perms=frozenset({"board.view", "clinical.chart", "alerts.ack"}))}
KEY = "202600000001"
WHY = "manşet yanlış koldaydı, yeniden ölçüldü"
# Respiration 26, SpO₂ 91, systolic 88: NEWS2 9, the immediate band (tests/test_bedside_retract.py RISKY).
RISKY = [("resp_rate", 26), ("spo2", 91), ("sbp", 88)]


async def _resolve(credential: str):
    return PEOPLE.get(credential)


def _app(audit=None, store=None):
    audit = audit if audit is not None else InMemoryAuditLog()
    store = store if store is not None else InMemoryReadingStore()
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve, audit=audit, readings=store)
    return app, audit, store


@pytest.fixture()
def world():
    app, audit, store = _app()
    with TestClient(app) as client:
        yield client, audit, store


def _ago(minutes: float) -> datetime:
    return datetime.now(timezone.utc) - timedelta(minutes=minutes)


def _send(client, pairs, when, key=KEY, device="CONNEX-3A") -> dict[str, int]:
    """Device readings through `/ingest`; each code's `ingest` row id — the entry a withdrawal names."""
    audit, ids = client.app.state.audit, {}
    for code, value in pairs:
        r = client.post("/ingest", json=obs(code, value, key, when, device=device), headers=DEVICE)
        assert r.status_code == 200 and "alerts" in r.json(), r.text
        ids[code] = audit.records(tenant="h1", patient_id=key, event_type="ingest", limit=1, newest=True)[-1].id
    return ids


def _retract(client, entry, reason=WHY, headers=NURSE, key=KEY):
    return client.post(f"/clinical/{key}/entries/{entry}/retract", json={"reason": reason}, headers=headers)


def _card(client, key=KEY):
    return next(p for p in client.get("/patients", headers=DEVICE).json()["patients"] if p["patient_id"] == key)


def _news2(card):
    n = card["latest"]["news2"]
    return {k: n[k] for k in ("total", "partial", "missing", "red_param", "breakdown")}


def _alerts(card):
    """(kind, firing?, acknowledged?) of every alert on the card."""
    return sorted((a["kind"], a["resolved_at"] is None, bool(a["acknowledged"])) for a in card["alerts"])


def _rows(audit, kind, key=KEY):
    return audit.records(tenant="h1", patient_id=key, event_type=kind, limit=1000)


class TestADeviceValueIsWithdrawn:
    def test_the_scores_are_as_if_it_had_never_arrived(self, world):
        client, _, _ = world
        when = _ago(5)
        ids = _send(client, RISKY, when)
        assert _card(client)["latest"]["news2"]["total"] == 9
        r = _retract(client, ids["resp_rate"])
        assert r.status_code == 200, r.text
        assert (r.json()["retracted"], r.json()["code"]) == (ids["resp_rate"], "resp_rate")
        fresh_app, _, _ = _app()
        with TestClient(fresh_app) as fresh:
            _send(fresh, [pair for pair in RISKY if pair[0] != "resp_rate"], when)
            assert _news2(_card(client)) == _news2(_card(fresh))
            assert _alerts(_card(client)) == _alerts(_card(fresh))
        assert _card(client)["latest"]["resp_rate"] is None

    def test_the_alert_it_raised_ends(self, world):
        client, audit, _ = world
        ids = _send(client, [("heart_rate", 140)], _ago(5))            # one red parameter: a news2 alert
        assert [a["kind"] for a in _card(client)["alerts"]] == ["news2"]
        assert _retract(client, ids["heart_rate"]).status_code == 200
        # It was the patient's only reading: no card is left for an alert to sit on, and nothing fires.
        assert KEY not in [p["patient_id"] for p in client.get("/patients", headers=DEVICE).json()["patients"]]
        assert client.get(f"/alerts/{KEY}", headers=DEVICE).json()["alerts"] == []

    def test_the_trail_keeps_both_rows_and_the_withdrawal_names_the_device(self, world):
        client, audit, _ = world
        when = _ago(5)
        ids = _send(client, RISKY, when)
        assert _retract(client, ids["spo2"], reason=f"  {WHY}  ").status_code == 200
        assert ids["spo2"] in [r.id for r in _rows(audit, "ingest")]             # the reading's row stays
        [row] = _rows(audit, RETRACT)
        assert (row.patient_id, row.subject) == (KEY, "spo2")
        assert row.payload == {"entry": ids["spo2"], "code": "spo2", "value": 91.0, "obs_ts": when.isoformat(),
                               "reason": WHY, "retracted_by": "hem.ayse", "origin": "device", "device": "CONNEX-3A"}

    def test_a_hand_entrys_withdrawal_row_is_what_it_was(self, world):
        """The two new keys are the device's alone: G3-01's payload for a `chart` row is unchanged."""
        client, audit, _ = world
        when = _ago(5)
        r = client.post(f"/clinical/{KEY}", json={"entries": [{"code": "resp_rate", "value": 26}],
                                                  "recorded_at": when.isoformat()}, headers=NURSE)
        entry = r.json()["entries"][0]["entry"]
        assert _retract(client, entry).status_code == 200
        [row] = _rows(audit, RETRACT)
        assert sorted(row.payload) == ["code", "entry", "obs_ts", "reason", "retracted_by", "value"]

    def test_the_records_row_is_marked_and_the_value_kept(self, world):
        client, _, store = world
        when = _ago(5)
        ids = _send(client, RISKY, when)
        assert _retract(client, ids["sbp"]).status_code == 200
        rows = {r.code: r for r in store.for_patient("h1", KEY, since=when - timedelta(hours=1), until=when + timedelta(hours=1))}
        assert (rows["sbp"].voided_by, rows["sbp"].void_reason, rows["sbp"].value) == ("hem.ayse", WHY, 88.0)
        assert rows["sbp"].voided_at is not None and rows["spo2"].voided_at is None

    def test_a_hand_entrys_row_is_marked_too(self, world):
        client, _, store = world
        when = _ago(5)
        r = client.post(f"/clinical/{KEY}", json={"entries": [{"code": "resp_rate", "value": 26}],
                                                  "recorded_at": when.isoformat()}, headers=NURSE)
        assert _retract(client, r.json()["entries"][0]["entry"]).status_code == 200
        [row] = store.for_patient("h1", KEY, since=when - timedelta(hours=1), until=when + timedelta(hours=1))
        assert (row.origin, row.voided_by, row.void_reason) == ("manual", "hem.ayse", WHY)

    def test_a_re_sent_copy_does_not_bring_the_value_back(self, world):
        client, audit, _ = world
        when = _ago(5)
        ids = _send(client, RISKY, when)
        assert _retract(client, ids["resp_rate"]).status_code == 200
        again = client.post("/ingest", json=obs("resp_rate", 26, KEY, when), headers=DEVICE)
        assert again.json() == {"patient_id": KEY, "duplicate": True}
        assert _card(client)["latest"]["resp_rate"] is None and len(_rows(audit, "ingest")) == 3

    def test_the_corrected_value_is_a_hand_entry_at_the_readings_own_time(self, world):
        """D13, Q3: the wrong value stays in the trail, withdrawn; the right one is typed, «elle», at that time."""
        client, _, store = world
        when = _ago(5)
        ids = _send(client, RISKY, when)
        assert _retract(client, ids["resp_rate"]).status_code == 200
        r = client.post(f"/clinical/{KEY}", json={"entries": [{"code": "resp_rate", "value": 16}],
                                                  "recorded_at": when.isoformat()}, headers=NURSE)
        assert r.status_code == 200, r.text
        assert _card(client)["latest"]["resp_rate"] == 16
        rows = [r for r in store.for_patient("h1", KEY, since=when - timedelta(hours=1), until=when + timedelta(hours=1))
                if r.code == "resp_rate"]
        assert sorted((r.origin, r.value, r.voided_at is not None) for r in rows) == [
            ("device", 26.0, True), ("manual", 16.0, False)]

    def test_a_failed_table_mark_does_not_fail_the_withdrawal(self):
        class _NoVoid(InMemoryReadingStore):
            def void(self, *args, **kw):
                raise RuntimeError("readings down")
        app, audit, _ = _app(store=_NoVoid())
        with TestClient(app) as client:
            ids = _send(client, RISKY, _ago(5))
            assert _retract(client, ids["resp_rate"]).status_code == 200
            assert _card(client)["latest"]["resp_rate"] is None and len(_rows(audit, RETRACT)) == 1


class TestTheRefusals:
    def test_a_second_withdrawal_is_409(self, world):
        client, _, _ = world
        ids = _send(client, RISKY, _ago(5))
        assert _retract(client, ids["resp_rate"]).status_code == 200
        r = _retract(client, ids["resp_rate"])
        assert (r.status_code, r.json()["detail"]) == (409, RETRACT_ALREADY)

    def test_a_device_credential_still_cannot_withdraw(self, world):
        client, _, _ = world
        ids = _send(client, RISKY, _ago(5))
        r = _retract(client, ids["resp_rate"], headers=DEVICE)
        assert (r.status_code, r.json()["detail"]) == (403, RETRACT_NEEDS_PERSON)

    def test_another_patients_reading_is_404(self, world):
        client, _, _ = world
        other = _send(client, RISKY, _ago(5), key="202600000002")
        _send(client, RISKY, _ago(5))
        r = _retract(client, other["spo2"])
        assert (r.status_code, r.json()["detail"]) == (404, RETRACT_UNKNOWN)

    def test_a_device_value_the_bedside_form_does_not_chart_is_refused(self, world):
        """X22 holds for the device too: a lactate is corrected by a new entry, not withdrawn."""
        client, audit, _ = world
        ids = _send(client, [("lactate", 4.2)], _ago(5))
        r = _retract(client, ids["lactate"])
        assert (r.status_code, r.json()["detail"]) == (409, RETRACT_NOT_BEDSIDE)
        assert _rows(audit, RETRACT) == []

    def test_the_unknown_entry_sentence_no_longer_says_hand_entered(self, world):
        client, _, _ = world
        _send(client, RISKY, _ago(5))
        r = _retract(client, "999999")
        assert (r.status_code, r.json()["detail"]) == (404, RETRACT_UNKNOWN)
        assert RETRACT_UNKNOWN == "bu hastada böyle bir ölçüm değeri yok"          # the dashboard maps it so
        assert "elle" not in RETRACT_UNKNOWN


class TestTheReplayAndTheRebuildSkipIt:
    def _trail(self, when):
        log = InMemoryAuditLog()
        kept = log.append(AuditEvent("h1", "ingest", KEY, "heart_rate", {
            "value": 80.0, "unit": "/min", "obs_ts": when.isoformat(), "device": "CONNEX-3A"}))
        wrong = log.append(AuditEvent("h1", "ingest", KEY, "heart_rate", {
            "value": 180.0, "unit": "/min", "obs_ts": (when + timedelta(minutes=1)).isoformat(), "device": "CONNEX-3A"}))
        log.append(AuditEvent("h1", RETRACT, KEY, "heart_rate", {
            "entry": wrong.id, "code": "heart_rate", "value": 180.0, "obs_ts": (when + timedelta(minutes=1)).isoformat(),
            "reason": WHY, "retracted_by": "hem.ayse", "origin": "device", "device": "CONNEX-3A"}))
        return log, kept, wrong

    def test_rehydrate_skips_a_withdrawn_ingest_row(self):
        log, kept, wrong = self._trail(_ago(10))
        rows = log.records(tenant="h1", limit=100)
        engine, store = Engine(), AckStore()
        rehydrate(engine, store, rows, skip=retracted_entries(rows))
        assert [o.value for o in engine.state(KEY).history(SignalCode.HEART_RATE)] == [80.0]
        assert engine.active_alerts(KEY) == []

    def test_rehydrate_without_the_skip_still_replays_it(self):
        log, _, _ = self._trail(_ago(10))
        engine = Engine()
        rehydrate(engine, AckStore(), log.records(tenant="h1", limit=100))
        assert [o.value for o in engine.state(KEY).history(SignalCode.HEART_RATE)] == [80.0, 180.0]

    def test_rebuild_patient_skips_a_withdrawn_ingest_row(self):
        log, kept, wrong = self._trail(_ago(10))
        rows = log.records(tenant="h1", limit=100)
        engine = Engine()
        rebuild_patient(engine, KEY, rows, skip=frozenset({wrong.id}))
        assert [o.value for o in engine.state(KEY).history(SignalCode.HEART_RATE)] == [80.0]

    def test_a_restart_scores_as_the_live_withdrawal_did(self):
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        first, _, _ = _app(audit=audit, store=store)
        with TestClient(first) as client:
            ids = _send(client, RISKY, _ago(5))
            assert _retract(client, ids["resp_rate"]).status_code == 200
            live = _card(client)
        second, _, _ = _app(audit=audit, store=store)
        with TestClient(second) as client:
            again = _card(client)
            assert _news2(again) == _news2(live) and _alerts(again) == _alerts(live)


class TestTheSourceIsReplayedAsSent:
    """O2: a device that names itself with an empty string. The door stamps the reading with "" and writes
    `"device": ""`; the replay used to read that as "replay", so the rebuilt reading was not EQUAL to the live one
    — and the shadow lane's removal and the «already» repair, which compare readings, could miss it."""

    def test_the_row_of_a_nameless_device_replays_as_the_door_stamped_it(self):
        when = _ago(5)
        resource = obs("heart_rate", 140, KEY, when, device="")
        live = parse_fhir_observation(resource)
        assert live.source_device == ""
        log = InMemoryAuditLog()
        row = log.append(AuditEvent("h1", "ingest", KEY, "heart_rate", {
            "value": live.value, "unit": live.unit, "obs_ts": live.timestamp.isoformat(), "device": live.source_device}))
        assert observation_of(row) == live

    def test_a_row_with_no_device_key_still_replays_as_replay_and_a_chart_row_as_clinician(self):
        when = _ago(5).isoformat()
        log = InMemoryAuditLog()
        old = log.append(AuditEvent("h1", "ingest", KEY, "heart_rate", {"value": 80.0, "unit": "/min", "obs_ts": when}))
        hand = log.append(AuditEvent("h1", "chart", KEY, "heart_rate", {"value": 80.0, "unit": "/min", "obs_ts": when,
                                                                        "charted_by": "hem.ayse"}))
        assert observation_of(old).source_device == "replay"
        assert observation_of(hand).source_device == "clinician"

    def test_a_nameless_devices_value_is_withdrawn_like_any_other(self, world):
        client, _, store = world
        when = _ago(5)
        ids = _send(client, [("heart_rate", 140)], when, device="")
        assert _retract(client, ids["heart_rate"]).status_code == 200
        engine = client.app.state.board_link._engine("h1")
        assert KEY not in engine.patient_ids()                            # it was the only reading
        [row] = store.for_patient("h1", KEY, since=when - timedelta(hours=1), until=when + timedelta(hours=1))
        assert (row.source, row.voided_by) == ("", "hem.ayse")


class TestTheOtherReadersOfWithdrawals:
    """Lane A, 2026-11-11 (spec §7): the fluid ledger, Eczane and the task anchor each pair a `chart_retract`
    with its (patient, entry). A withdrawal of a DEVICE row of a non-fluid code must change none of their answers."""

    def _trail(self):
        when = _ago(30)
        log = InMemoryAuditLog()
        urine = log.append(AuditEvent("h1", "chart", KEY, "urine_output_ml", {
            "value": 200.0, "unit": "mL", "obs_ts": when.isoformat(), "charted_by": "hem.ayse"}))
        hand = log.append(AuditEvent("h1", "chart", KEY, "resp_rate", {
            "value": 16.0, "unit": "/min", "obs_ts": when.isoformat(), "charted_by": "hem.ayse"}))
        device = log.append(AuditEvent("h1", "ingest", KEY, "heart_rate", {
            "value": 140.0, "unit": "/min", "obs_ts": when.isoformat(), "device": "CONNEX-3A"}))
        return log, when, urine, hand, device

    def _answers(self, log, when):
        since, until = when - timedelta(hours=1), when + timedelta(hours=1)
        rows = log.records(tenant="h1", event_types={"chart", RETRACT}, limit=1000)
        return (fluids._entries_by_patient(rows, since=since, until=until),
                pharmacy.read_entries_by_patient(log, "h1", since=since, until=until),
                fluids.read_entries(log, "h1", KEY, since=since, until=until),
                tasks._stamps_by_patient(rows, since=since, until=until))

    def test_a_device_withdrawal_changes_none_of_their_answers(self):
        log, when, urine, hand, device = self._trail()
        before = self._answers(log, when)
        log.append(AuditEvent("h1", RETRACT, KEY, "heart_rate", {
            "entry": device.id, "code": "heart_rate", "value": 140.0, "obs_ts": when.isoformat(), "reason": WHY,
            "retracted_by": "hem.ayse", "origin": "device", "device": "CONNEX-3A"}))
        assert self._answers(log, when) == before
        ledger, _ = fluids.read_entries(log, "h1", KEY, since=when - timedelta(hours=1), until=when + timedelta(hours=1))
        assert [(e.entry, e.retracted) for e in ledger] == [(urine.id, None)]

    def test_each_still_pairs_a_withdrawal_with_its_own_patients_entry(self):
        """A withdrawal names an entry of ITS patient: one written for another patient with the same id touches
        nothing — whatever kind of row the id is."""
        log, when, urine, hand, device = self._trail()
        before = self._answers(log, when)
        for entry in (urine.id, hand.id, device.id):
            log.append(AuditEvent("h1", RETRACT, "202600000002", "heart_rate", {
                "entry": entry, "code": "heart_rate", "value": 1.0, "obs_ts": when.isoformat(), "reason": WHY,
                "retracted_by": "hem.ayse"}))
        assert self._answers(log, when) == before


class TestARestartAfterADeviceWithdrawal:
    """Lane A, 2026-11-11 (spec §7): the replay never prunes what the live door pruned, so an acknowledgement
    given to an episode that the withdrawal ended must not come back on an alert the replay raises differently.
    Each case holds the restarted app's alerts — kind, firing, acknowledged — equal to the live rebuild's."""

    def _ack(self, client, kind="news2"):
        r = client.post("/ack", json={"patient_id": KEY, "kind": kind}, headers=NURSE)
        assert r.status_code == 200, r.text

    def _restarted(self, audit, store):
        app, _, _ = _app(audit=audit, store=store)
        return app

    def test_an_acknowledged_alert_the_withdrawal_ended_and_a_later_one_of_its_kind(self):
        """The wrong value raised the alert, a nurse acknowledged it, the value was withdrawn (the episode ends),
        and later readings raise the kind again: a new episode nobody has acknowledged — live and after a restart."""
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        app, _, _ = _app(audit=audit, store=store)
        with TestClient(app) as client:
            ids = _send(client, [("heart_rate", 140)], _ago(20))
            self._ack(client)
            assert _retract(client, ids["heart_rate"]).status_code == 200
            _send(client, RISKY, _ago(5))                                # a real deterioration, later
            live = _alerts(_card(client))
            assert live == [("news2", True, False)]                      # firing, not acknowledged
        with TestClient(self._restarted(audit, store)) as client:
            assert _alerts(_card(client)) == live

    def test_an_acknowledged_alert_that_still_fires_without_the_withdrawn_value(self):
        """The alert stands on other values too: the withdrawal changes its score, not its being there, and the
        acknowledgement stays — live and after a restart."""
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        app, _, _ = _app(audit=audit, store=store)
        with TestClient(app) as client:
            ids = _send(client, RISKY, _ago(10))
            self._ack(client)
            assert _retract(client, ids["sbp"]).status_code == 200       # NEWS2 9 → 6: still an alert
            live = _alerts(_card(client))
            assert live == [("news2", True, True)]
        with TestClient(self._restarted(audit, store)) as client:
            assert _alerts(_card(client)) == live

    def test_a_withdrawal_that_empties_the_patient(self):
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        app, _, _ = _app(audit=audit, store=store)
        with TestClient(app) as client:
            ids = _send(client, [("heart_rate", 140)], _ago(20))
            self._ack(client)
            assert _retract(client, ids["heart_rate"]).status_code == 200
            live = [p["patient_id"] for p in client.get("/patients", headers=DEVICE).json()["patients"]]
            assert KEY not in live
        with TestClient(self._restarted(audit, store)) as client:
            assert [p["patient_id"] for p in client.get("/patients", headers=DEVICE).json()["patients"]] == live
```

Run: `cd /c/tmp/g3-cihaz-olcum/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_device_retract.py 2>&1 | tail -3`
Expected: `19 failed, 7 passed` — every test that withdraws a device row fails on the route's 404 (`assert 404 == 200`), the two skips replay the withdrawn value, and the wording test still reads «elle girilmiş». The seven that pass need no change: a hand entry's withdrawal row, the device-token refusal, another patient's row (404 already), the replay without a skip, the two tests of the other readers and the row with no `device` key.

- [ ] **Step 2: The sentence (`api/clinical.py`)**

In `homunculus-engine/src/homunculus/api/clinical.py`, find (lines 173–175):

```python
#: G3-01 (D10, D12): the audit row a «hatalı giriş» writes — `{entry, code, value, obs_ts, reason, retracted_by}`,
#: subject the code too; `entry` is the withdrawn `chart` row's id. The replay and the rebuild skip that row.
RETRACT = "chart_retract"
```

Replace with:

```python
#: G3-01 (D10, D12): the audit row a «hatalı giriş» writes — `{entry, code, value, obs_ts, reason, retracted_by}`,
#: subject the code too; `entry` is the withdrawn row's id. The replay and the rebuild skip that row. G3-05 (D13):
#: the withdrawn row is a `chart` row or — a device reading — an `ingest` row, and then the payload also carries
#: `"origin": "device"` and `"device"`. One event for both, so every reader of withdrawals honours a device's.
RETRACT = "chart_retract"
```

In the same file, find (line 202):

```python
RETRACT_UNKNOWN = "bu hastada böyle bir elle girilmiş değer yok"
```

Replace with:

```python
#: G3-05 (D13): the entry may be a device reading, so the sentence no longer says «elle girilmiş». The dashboard
#: maps this exact sentence (apiErrors.js).
RETRACT_UNKNOWN = "bu hastada böyle bir ölçüm değeri yok"
```

- [ ] **Step 3: The two skips, and the source as sent (`api/rehydrate.py`)**

In `homunculus-engine/src/homunculus/api/rehydrate.py`, find (lines 52–53):

```python
    # G3-01 (D12): `skip` is the `chart` rows a «hatalı giriş» withdrew (`retracted_entries`, read first by
    # the API): they are not replayed, so a restart scores the patient as the live rebuild did.
```

Replace with:

```python
    # G3-01 (D12): `skip` is the rows a «hatalı giriş» withdrew (`retracted_entries`, read first by the API):
    # they are not replayed, so a restart scores the patient as the live rebuild did. G3-05 (D13): a withdrawn
    # row is a `chart` row or a device's `ingest` row — both are skipped.
```

In the same file, find (lines 59–61):

```python
        if rec.event_type == "chart" and rec.id in skip:
            continue
        if rec.event_type in ("ingest", "chart"):
```

Replace with:

```python
        if rec.event_type in ("ingest", "chart") and rec.id in skip:
            continue
        if rec.event_type in ("ingest", "chart"):
```

In the same file, find (line 138):

```python
    source = p.get("device") or ("clinician" if rec.event_type == "chart" else "replay")
```

Replace with:

```python
    # G3-05 (O2): an `ingest` row's device is replayed AS SENT, an empty name included — the door stamped the
    # reading with it, and a rebuilt reading must equal the live one (the shadow lane's removal and the «already»
    # repair compare them). A row with no `device` key (written before the key existed) still reads "replay".
    device = p.get("device")
    if rec.event_type == "ingest" and isinstance(device, str):
        source = device
    else:
        source = device or ("clinician" if rec.event_type == "chart" else "replay")
```

In the same file, find (lines 257–258):

```python
    """The `chart` rows a `chart_retract` row withdrew (G3-01, D12), from any rows: the others are ignored, and
    a payload whose `entry` is not an integer withdraws nothing."""
```

Replace with:

```python
    """The rows a `chart_retract` row withdrew (G3-01, D12) — `chart` rows and, since G3-05 (D13), a device's
    `ingest` rows — from any rows: the others are ignored, and a payload whose `entry` is not an integer
    withdraws nothing."""
```

In the same file, find (line 272):

```python
    """One patient's engine state from the trail, without the `chart` rows in `skip` (G3-01, D10, X4): first
```

Replace with:

```python
    """One patient's engine state from the trail, without the `chart` and `ingest` rows in `skip` (G3-01, D10,
    X4; G3-05, D13: a device reading can be withdrawn too): first
```

In the same file, find (lines 284–285):

```python
        elif not (rec.event_type == "chart" and rec.id in skip):
            _replay_ingest(engine, rec, _written_at(rec))
```

Replace with:

```python
        elif rec.id not in skip:
            _replay_ingest(engine, rec, _written_at(rec))
```

- [ ] **Step 4: The route (`api/app.py`)**

In `homunculus-engine/src/homunculus/api/app.py`, find (lines 512–513):

```python
        # G3-01 (D12): the withdrawn hand entries first — one read of the `chart_retract` rows — so the replay
        # below scores each patient as the live withdrawal's rebuild did.
```

Replace with:

```python
        # G3-01 (D12): the withdrawn entries first — one read of the `chart_retract` rows — so the replay below
        # scores each patient as the live withdrawal's rebuild did. G3-05 (D13): a device's `ingest` row among them.
```

In the same file, find (lines 1343–1345):

```python
        """G3-01 (D10, D11, X3, X4, X11): «hatalı giriş» — a hand entry withdrawn from every score.

        `entry` is the value's `chart` row (the door answered it). The patient's rows are read from the trail,
```

Replace with:

```python
        """G3-01 (D10, D11, X3, X4, X11): «hatalı giriş» — a hand entry withdrawn from every score. G3-05 (D3,
        D13): a device reading too — the wards measure with a device, so its errors must be correctable where a
        hand entry's are (this overrides G3-01's «a device value cannot be withdrawn»).

        `entry` is the value's `chart` row (the door answered it) or the device reading's `ingest` row (the
        readings record and the trends answer carry it). The patient's rows are read from the trail,
```

In the same file, find (line 1366):

```python
        - 404 for an id that is not this patient's `chart` row (a device's reading is an `ingest` row);
```

Replace with:

```python
        - 404 for an id that is neither this patient's `chart` row nor its `ingest` row;
```

In the same file, find (lines 1402–1404):

```python
        target = next((r for r in rows if r.id == wanted and r.event_type == "chart"), None)
        if target is None:
            raise HTTPException(status_code=404, detail=RETRACT_UNKNOWN)
```

Replace with:

```python
        # G3-05 (D13): a hand entry's `chart` row or a device reading's `ingest` row — never another kind of row.
        target = next((r for r in rows if r.id == wanted and r.event_type in ("chart", "ingest")), None)
        if target is None:
            raise HTTPException(status_code=404, detail=RETRACT_UNKNOWN)
```

In the same file, find (lines 1439–1442):

```python
        audit.append(AuditEvent(hospital, RETRACT, patient_id, target.subject, {
            "entry": target.id, "code": target.subject, "value": target.payload.get("value"),
            "obs_ts": target.payload.get("obs_ts"), "reason": reason, "retracted_by": caller.actor}))
        await _adopt_rebuilt(hospital, patient_id, record, engine, store, scratch, observation, now)
```

Replace with:

```python
        withdrawal = {"entry": target.id, "code": target.subject, "value": target.payload.get("value"),
                      "obs_ts": target.payload.get("obs_ts"), "reason": reason, "retracted_by": caller.actor}
        if target.event_type == "ingest":
            # G3-05 (D13): the same event — every reader of withdrawals honours it — saying what it withdrew.
            withdrawal |= {"origin": "device", "device": target.payload.get("device")}
        audit.append(AuditEvent(hospital, RETRACT, patient_id, target.subject, withdrawal))
        # G3-05 (D7): the record's row is marked after the trail's row. Never raises: the withdrawal is written,
        # and `reconcile` marks a row this could not.
        try:
            readings.void(hospital, target.id, by=caller.actor, at=now, reason=reason)
        except Exception:
            log.exception("vital_readings: hatalı giriş işareti yazılamadı (hastane %s); reconcile tamamlar", hospital)
        await _adopt_rebuilt(hospital, patient_id, record, engine, store, scratch, observation, now)
```

- [ ] **Step 5: G3-01's test that said «a device's reading is not a hand entry»**

`tests/test_bedside_retract.py` `test_a_row_that_is_not_a_chart_row_is_404` uses an `alert` row, which is still refused; only its docstring said why a device's row was. Find:

In `homunculus-engine/tests/test_bedside_retract.py`, find (lines 264–265):

```python
    def test_a_row_that_is_not_a_chart_row_is_404(self, client):
        """A device's reading is an `ingest` row, an alert an `alert` row: neither is a hand entry."""
```

Replace with:

```python
    def test_a_row_that_is_not_a_chart_row_is_404(self, client):
        """An alert is an `alert` row: no value to withdraw. (Since G3-05, D13, a device's `ingest` row CAN be
        withdrawn — tests/test_device_retract.py.)"""
```

- [ ] **Step 6: Run to see them pass**

Run: `cd /c/tmp/g3-cihaz-olcum/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_device_retract.py tests/test_bedside_retract.py tests/test_bedside_rebuild.py tests/test_rehydrate.py tests/test_fluids.py tests/test_pharmacy.py tests/test_tasks_api.py 2>&1 | tail -3`
Expected: `233 passed` (26 + 49 + 33 + 19 + 37 + 41 + 28).

- [ ] **Step 7: Commit**

```bash
cd /c/tmp/g3-cihaz-olcum && git add -- homunculus-engine/tests/test_device_retract.py homunculus-engine/src/homunculus/api/clinical.py homunculus-engine/src/homunculus/api/rehydrate.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_bedside_retract.py && git commit -m "feat(readings): a wrong device value can be withdrawn — «hatalı giriş» takes ingest rows, the replay and the rebuild skip them (G3-05 D3, D13)" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>" -- homunculus-engine/tests/test_device_retract.py homunculus-engine/src/homunculus/api/clinical.py homunculus-engine/src/homunculus/api/rehydrate.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_bedside_retract.py
```

After this commit the dashboard's `src/live/apiErrors.test.js` is red until Task W1 Part B: it reads `RETRACT_UNKNOWN` from `api/clinical.py` and holds the dashboard's map to it.

---

### Task B8: The patient's record read and the trends' `device` list (D16), with their pins and the nginx mask

**Files:**
- Test: `homunculus-engine/tests/test_readings_patient.py` (new)
- Modify: `homunculus-engine/src/homunculus/api/readings.py` — lines 80–81, line 98, lines 106–107, line 355 (as each step finds the file)
- Modify: `homunculus-engine/src/homunculus/api/app.py` — lines 48–49, lines 70–74, line 120, lines 1955–1956 (as each step finds the file)
- Modify: `homunculus-engine/src/homunculus/api/trends.py` — line 13, lines 174–177, lines 194–196, lines 206–218, line 244, line 261 (as each step finds the file)
- Test: `homunculus-engine/tests/test_board_permissions.py` — lines 282–283 (as each step finds the file)
- Test: `homunculus-engine/tests/test_tenant_isolation.py` — line 870 (as each step finds the file)
- Modify: `deploy/local/web/nginx.conf` — line 49 (as each step finds the file)

- `GET /patients/{patient_id}/readings?hours=24|72|168` — `board.view` + scope, beside the trends and fluids reads; read-only and not audited, as they are. It answers the patient's rows of `vital_readings` as measurement sets, newest first, each value with its `origin`, `source`, `recorded_by`, the `entry` «Düzelt» names and `voided: null | {reason, by, at}`.
- `GET /patients/{id}/trends` — each channel gains `device: [{entry, at, value, source, retracted}]` beside `manual`, from the one audit read `_manual` already makes (it now reads the `ingest` rows too).

The new path carries a patient key, so it joins nginx's log map (O10) and `BOARD_EXPECTED` (27 → 28).

- [ ] **Step 1: Write the failing tests**

Create `homunculus-engine/tests/test_readings_patient.py`:

```python
# homunculus-engine/tests/test_readings_patient.py
"""G3-05 (spec D16, §4): one patient's measurement record — GET /patients/{id}/readings — and the `device` list
of the trends answer. Read-only: what the two doors filed, as sets, with the source of each value and the mark
of a withdrawn one. Synthetic numbers and values only (CLAUDE.md rule 6)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.audit import InMemoryAuditLog
from homunculus.api.identity import Caller
from homunculus.api.patient_identity import KABUL, IdentityRecord, InMemoryIdentityStore
from homunculus.api.readings import (
    READING_HOURS, READINGS_HOURS, RECEIVED_LATE, WORDS, InMemoryReadingStore, Reading, patient_readings,
)
from homunculus.scope import Scope, ScopeReason
from tests.test_ingest_apply import obs

TOKEN = "tok"
DEVICE = {"Authorization": f"Bearer {TOKEN}"}
NURSE = {"Authorization": "Bearer nurse-jwt"}
WARD2 = {"Authorization": "Bearer ward2-jwt"}
NOBODY = {"Authorization": "Bearer none-jwt"}
PEOPLE = {
    "nurse-jwt": Caller(hospital="h1", actor="hem.ayse", groups=("nurse",), perms=frozenset({"board.view", "clinical.chart"})),
    "ward2-jwt": Caller(hospital="h1", actor="hem.zeynep", groups=("nurse",), perms=frozenset({"board.view"})),
    "none-jwt": Caller(hospital="h1", actor="synth-none"),
}
KEY = "202600000001"
WHY = "manşet yanlış koldaydı, yeniden ölçüldü"


async def _resolve(credential: str):
    return PEOPLE.get(credential)


async def _resolve_scope(credential: str) -> Scope:
    if credential == "ward2-jwt":
        return Scope(False, ScopeReason.ASSIGNED, unit_ids=frozenset({"u-2"}))
    return Scope(True, ScopeReason.UNRESTRICTED_ROLE)


@pytest.fixture()
def client():
    identities = InMemoryIdentityStore()
    identities.apply("h1", IdentityRecord(KEY, family="Hasta", given="Test", state="admitted", source=KABUL,
                                          unit_id="u-1", bed_id="b-1", updated_at=datetime.now(timezone.utc)))
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve, resolve_scope=_resolve_scope,
                     audit=InMemoryAuditLog(), identities=identities, readings=InMemoryReadingStore())
    with TestClient(app) as c:
        yield c


def _ago(minutes: float) -> datetime:
    return datetime.now(timezone.utc) - timedelta(minutes=minutes)


def _send(client, pairs, when, device="CONNEX-3A"):
    for code, value in pairs:
        assert client.post("/ingest", json=obs(code, value, KEY, when, device=device), headers=DEVICE).status_code == 200


def _chart(client, entries, when):
    r = client.post(f"/clinical/{KEY}", json={"entries": entries, "recorded_at": when.isoformat()}, headers=NURSE)
    assert r.status_code == 200, r.text
    return {e["code"]: e["entry"] for e in r.json()["entries"]}


def _read(client, hours=None, headers=NURSE, key=KEY):
    return client.get(f"/patients/{key}/readings", params={} if hours is None else {"hours": hours}, headers=headers)


class TestTheRecord:
    def test_the_sets_come_newest_first_each_value_with_its_source(self, client):
        early, late = _ago(120), _ago(10)
        _send(client, [("spo2", 97), ("heart_rate", 88)], early)
        entries = _chart(client, [{"code": "resp_rate", "value": 16}], late)
        r = _read(client)
        assert r.status_code == 200, r.text
        body = r.json()
        assert (body["patient_id"], body["hours"]) == (KEY, 24)
        assert datetime.fromisoformat(body["until"]) - datetime.fromisoformat(body["since"]) == timedelta(hours=24)
        hand, device = body["sets"]
        assert (hand["origin"], hand["source"], hand["recorded_by"], hand["observed_at"]) == ("manual", "clinician", "hem.ayse", late.isoformat())
        assert hand["readings"] == [{"id": hand["readings"][0]["id"], "code": "resp_rate", "value": 16.0, "unit": "/min",
                                     "origin": "manual", "source": "clinician", "recorded_by": "hem.ayse",
                                     "entry": entries["resp_rate"], "voided": None}]
        assert (device["origin"], device["source"], device["recorded_by"], device["observed_at"]) == ("device", "CONNEX-3A", None, early.isoformat())
        assert [(v["code"], v["value"]) for v in device["readings"]] == [("heart_rate", 88.0), ("spo2", 97.0)]
        assert all(isinstance(v["entry"], int) and v["voided"] is None for v in device["readings"])
        assert sorted(device) == ["observed_at", "origin", "readings", "received_at", "received_late", "recorded_by", "source"]

    def test_a_withdrawn_value_stays_with_its_reason_who_and_when(self, client):
        when = _ago(10)
        _send(client, [("sbp", 88)], when)
        [value] = _read(client).json()["sets"][0]["readings"]
        r = client.post(f"/clinical/{KEY}/entries/{value['entry']}/retract", json={"reason": WHY}, headers=NURSE)
        assert r.status_code == 200, r.text
        [after] = _read(client).json()["sets"][0]["readings"]
        assert (after["value"], after["voided"]["reason"], after["voided"]["by"]) == (88.0, WHY, "hem.ayse")
        assert datetime.fromisoformat(after["voided"]["at"]).utcoffset() == timedelta(0)

    def test_a_reading_that_arrived_long_after_it_was_measured_says_so(self, client):
        """D16: «alındı» is shown when arrival and measurement differ by more than five minutes — decided here."""
        _send(client, [("spo2", 97)], _ago(30))                          # a buffered reading, sent half an hour on
        _send(client, [("spo2", 96)], _ago(1))
        fresh, buffered = _read(client).json()["sets"]
        assert (fresh["received_late"], buffered["received_late"]) == (False, True)
        assert RECEIVED_LATE == timedelta(minutes=5)

    @pytest.mark.parametrize("hours,shown", [("24", 1), ("72", 2), ("168", 3)])
    def test_the_three_windows(self, client, hours, shown):
        store = client.app.state.readings
        for n, age in enumerate((timedelta(hours=2), timedelta(hours=40), timedelta(hours=100), timedelta(hours=200))):
            at = datetime.now(timezone.utc) - age
            store.add(Reading(tenant="h1", received_key=KEY, patient_key=KEY, code="spo2", value=97.0, unit="%",
                              observed_at=at, received_at=at, origin="device", source="CONNEX-3A", audit_id=1000 + n,
                              entry_id=1000 + n))
        client.post("/ingest", json=obs("heart_rate", 80, KEY, _ago(500 * 60)), headers=DEVICE)   # the engine knows the patient
        body = _read(client, hours).json()
        assert body["hours"] == int(hours)
        assert len([s for s in body["sets"] if s["readings"][0]["code"] == "spo2"]) == shown

    def test_the_windows_are_exactly_these(self):
        assert READINGS_HOURS == (24, 72, 168)

    @pytest.mark.parametrize("hours", ["6", "0", "abc", "24.0", ""])
    def test_any_other_window_is_400_with_its_code(self, client, hours):
        r = _read(client, hours)
        assert (r.status_code, r.json()["detail"]) == (400, {"code": READING_HOURS, "message": WORDS[READING_HOURS]})
        assert READING_HOURS == "reading_hours"

    def test_an_admitted_patient_nobody_measured_has_an_empty_record(self, client):
        assert _read(client).json()["sets"] == []

    def test_a_reading_linked_from_the_list_is_in_the_record(self):
        """A linked reading is filed under the patient with its own time and the device as its source."""
        from tests.test_readings_api import KEY as TARGET, TYPO, _app as unmatched_app
        app, _, _ = unmatched_app()
        with TestClient(app) as c:
            when = _ago(20)
            c.post("/ingest", json=obs("spo2", 97, TYPO, when), headers=DEVICE)
            [waiting] = c.get("/readings/unmatched", headers=NURSE).json()["sets"]
            ids = [v["id"] for v in waiting["readings"]]
            assert c.post("/readings/unmatched/assign", json={"readings": ids, "patient_id": TARGET}, headers=NURSE).status_code == 200
            [linked] = c.get(f"/patients/{TARGET}/readings", headers=NURSE).json()["sets"]
            assert (linked["origin"], linked["source"], linked["observed_at"]) == ("device", "CONNEX-3A", when.isoformat())
            assert linked["readings"][0]["id"] == ids[0] and isinstance(linked["readings"][0]["entry"], int)


class TestWhoMayRead:
    def test_it_needs_a_credential_and_board_view(self, client):
        assert client.get(f"/patients/{KEY}/readings").status_code == 401
        r = _read(client, headers=NOBODY)
        assert (r.status_code, r.json()["detail"]) == (403, "permission required: board.view")

    def test_out_of_scope_and_unknown_are_one_404(self, client):
        r = _read(client, headers=WARD2)                                 # KEY lies in u-1
        assert (r.status_code, r.json()["detail"]) == (404, "hasta bulunamadı")
        assert _read(client, key="202600000099").status_code == 404
        assert "202600000099" not in [p["patient_id"] for p in client.get("/patients", headers=DEVICE).json()["patients"]]

    def test_a_read_writes_no_audit_row(self, client):
        _send(client, [("spo2", 97)], _ago(5))
        audit = client.app.state.audit
        before = len(audit.records(tenant="h1", limit=1000))
        assert _read(client).status_code == 200
        assert len(audit.records(tenant="h1", limit=1000)) == before

    def test_the_device_token_reads_too(self, client):
        assert _read(client, headers=DEVICE).status_code == 200


class TestThePureAnswer:
    T0 = datetime(2026, 11, 11, 9, 0, tzinfo=timezone.utc)

    def _row(self, n, **over):
        base = dict(tenant="h1", received_key=KEY, patient_key=KEY, code="spo2", value=97.0, unit="%",
                    observed_at=self.T0, received_at=self.T0 + timedelta(seconds=30), origin="device",
                    source="CONNEX-3A", id=n, audit_id=n, entry_id=n)
        return Reading(**{**base, **over})

    def test_one_set_per_time_origin_source_and_person(self):
        rows = [
            self._row(1), self._row(2, code="heart_rate", value=88.0, unit="/min"),
            self._row(3, source="CONNEX-3B", value=96.0),
            self._row(4, origin="manual", source="clinician", recorded_by="hem.ayse", code="resp_rate", value=16.0),
            self._row(5, origin="manual", source="clinician", recorded_by="hem.leyla", code="resp_rate", value=18.0),
            self._row(6, observed_at=self.T0 + timedelta(minutes=1)),
        ]
        body = patient_readings(rows, patient_id=KEY, hours=24, now=self.T0 + timedelta(hours=1))
        assert [(s["observed_at"], s["origin"], s["source"], s["recorded_by"], len(s["readings"])) for s in body["sets"]] == [
            ((self.T0 + timedelta(minutes=1)).isoformat(), "device", "CONNEX-3A", None, 1),
            (self.T0.isoformat(), "device", "CONNEX-3A", None, 2),
            (self.T0.isoformat(), "device", "CONNEX-3B", None, 1),
            (self.T0.isoformat(), "manual", "clinician", "hem.ayse", 1),
            (self.T0.isoformat(), "manual", "clinician", "hem.leyla", 1),
        ]
        assert (body["since"], body["until"]) == ((self.T0 - timedelta(hours=23)).isoformat(), (self.T0 + timedelta(hours=1)).isoformat())

    def test_a_row_with_no_entry_has_none(self):
        body = patient_readings([self._row(1, entry_id=None)], patient_id=KEY, hours=24, now=self.T0)
        assert body["sets"][0]["readings"][0]["entry"] is None


class TestTheTrendsDeviceList:
    def _channel(self, client, key, hours=24):
        r = client.get(f"/patients/{KEY}/trends", params={"hours": hours}, headers=NURSE)
        assert r.status_code == 200, r.text
        return next(c for c in r.json()["channels"] if c["key"] == key)

    def test_each_channel_lists_its_device_readings_beside_the_hand_ones(self, client):
        when = _ago(10)
        _send(client, [("sbp", 118), ("heart_rate", 88)], when)
        entries = _chart(client, [{"code": "sbp", "value": 121}], _ago(5))
        sbp = self._channel(client, "sbp")
        [device] = sbp["device"]
        assert sorted(device) == ["at", "entry", "retracted", "source", "value"]
        assert (device["at"], device["value"], device["source"], device["retracted"]) == (when.isoformat(), 118.0, "CONNEX-3A", None)
        assert [m["entry"] for m in sbp["manual"]] == [entries["sbp"]]   # `manual` is what it was
        assert self._channel(client, "resp_rate")["device"] == []

    def test_a_withdrawn_device_reading_is_marked_and_off_the_line(self, client):
        when = _ago(10)
        _send(client, [("sbp", 88)], when)
        entry = self._channel(client, "sbp")["device"][0]["entry"]
        assert client.post(f"/clinical/{KEY}/entries/{entry}/retract", json={"reason": WHY}, headers=NURSE).status_code == 200
        sbp = self._channel(client, "sbp")
        [device] = sbp["device"]
        assert (device["entry"], device["retracted"]["reason"], device["retracted"]["by"]) == (entry, WHY, "hem.ayse")
        assert sbp["points"] == []                                        # the engine dropped it: nothing is drawn

    def test_a_device_reading_outside_the_window_is_not_listed(self, client):
        _send(client, [("sbp", 118)], _ago(7 * 60))
        assert self._channel(client, "sbp", hours=6)["device"] == []
        assert len(self._channel(client, "sbp", hours=24)["device"]) == 1
```

Run: `cd /c/tmp/g3-cihaz-olcum/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_readings_patient.py 2>&1 | tail -3`
Expected: an error at collection — `ImportError: cannot import name 'READING_HOURS' from 'homunculus.api.readings'`.

- [ ] **Step 2: The answer (`api/readings.py`)**

In `homunculus-engine/src/homunculus/api/readings.py`, find (lines 80–81):

```python
#: The most readings one link or rejection names: a set is one round's values of one patient.
SET_MAX = 50
```

Replace with:

```python
#: The most readings one link or rejection names: a set is one round's values of one patient.
SET_MAX = 50
#: The windows GET /patients/{id}/readings accepts (spec D16): 24 hours, 72 hours, 7 days. Any other is refused
#: with the code READING_HOURS (below, with the list's codes; the dashboard maps it, apiErrors.js).
READINGS_HOURS = (24, 72, 168)
#: D16: a set whose arrival is later than its measurement by more than this says «alındı» with the arrival time
#: — a buffered device round, a reading linked from the list. A display rule, decided here so that the browser
#: compares no two times itself.
RECEIVED_LATE = timedelta(minutes=5)
```

In `homunculus-engine/src/homunculus/api/readings.py`, find (line 98):

```python
READING_REASON_LENGTH = "reading_reason_length"
```

Replace with:

```python
READING_REASON_LENGTH = "reading_reason_length"
READING_HOURS = "reading_hours"
```

In the same file, find (lines 106–107):

```python
    READING_REASON_LENGTH: "The reason is 10–200 characters.",
}
```

Replace with:

```python
    READING_REASON_LENGTH: "The reason is 10–200 characters.",
    READING_HOURS: "The window is 24, 72 or 168 hours.",
}
```

In `homunculus-engine/src/homunculus/api/readings.py`, find (line 355):

```python
# ----------------------------------------------------------------------------- the router
```

Replace with:

```python
def patient_readings(rows: Iterable[Reading], *, patient_id: str, hours: int, now: datetime) -> dict:
    """One patient's record as GET /patients/{id}/readings answers it (spec §4, D16): the rows as measurement
    sets — one time, one origin, one source, one person — the newest first; within a set the values by code.
    Each value carries what «Düzelt» needs (`entry`: the engine row a withdrawal names, None for a row the
    engine never took) and its withdrawal, `voided`, when there is one. `received_late`: RECEIVED_LATE."""
    if hours not in READINGS_HOURS:
        raise ValueError(f"hours must be one of {READINGS_HOURS}, not {hours!r}")
    grouped: dict[tuple, list[Reading]] = {}
    for row in rows:
        grouped.setdefault((row.observed_at, row.origin, row.source, row.recorded_by or ""), []).append(row)
    sets = []
    for (observed_at, origin, source, _), members in grouped.items():
        members.sort(key=lambda r: (r.code, r.id))
        received_at = max(r.received_at for r in members)
        sets.append({
            "observed_at": _iso(observed_at), "received_at": _iso(received_at),
            "received_late": received_at - observed_at > RECEIVED_LATE,
            "origin": origin, "source": source, "recorded_by": members[0].recorded_by,
            "readings": [{
                "id": r.id, "code": r.code, "value": r.value, "unit": r.unit, "origin": r.origin, "source": r.source,
                "recorded_by": r.recorded_by, "entry": r.entry_id,
                "voided": None if r.voided_at is None else {
                    "reason": r.void_reason or "", "by": r.voided_by or "", "at": _iso(r.voided_at)},
            } for r in members],
        })
    # Newest measurement first; at one instant the device's sets before the hand entries, then by source and person.
    sets.sort(key=lambda s: (s["origin"], s["source"], s["recorded_by"] or ""))
    sets.sort(key=lambda s: s["observed_at"], reverse=True)
    now = now.astimezone(timezone.utc)
    return {"patient_id": patient_id, "hours": hours, "since": _iso(now - timedelta(hours=hours)),
            "until": _iso(now), "sets": sets}


# ----------------------------------------------------------------------------- the router
```

- [ ] **Step 3: The route (`api/app.py`)**

In `homunculus-engine/src/homunculus/api/app.py`, find (lines 48–49):

```python
from homunculus.api.clinical import (
    GCS_NOT_WHOLE, PLAUSIBLE, RETRACT, RETRACT_ALREADY, RETRACT_DISCHARGED, RETRACT_MAX_REASON_CHARS,
```

Replace with:

```python
from homunculus.api.clinical import (
    BEDSIDE_SKEW, GCS_NOT_WHOLE, PLAUSIBLE, RETRACT, RETRACT_ALREADY, RETRACT_DISCHARGED, RETRACT_MAX_REASON_CHARS,
```

In the same file, find (lines 70–74):

```python
from homunculus.api.readings import (                             # G3-05
    MANUAL_CODES, POLICY_CARD, POLICY_UNMATCHED, READING_TARGET_DISCHARGED, READING_UNMATCHED, REASON_DISCHARGED,
    REASON_UNKNOWN, UNKNOWN_POLICIES, InMemoryReadingStore, Reading, ReadingStore, device_reading, device_source,
    manual_reading, reading_refusal, readings_router,
)
```

Replace with:

```python
from homunculus.api.readings import (                             # G3-05
    MANUAL_CODES, POLICY_CARD, POLICY_UNMATCHED, READING_HOURS, READING_TARGET_DISCHARGED, READING_UNMATCHED,
    READINGS_HOURS, REASON_DISCHARGED, REASON_UNKNOWN, UNKNOWN_POLICIES, InMemoryReadingStore, Reading,
    ReadingStore, device_reading, device_source, manual_reading, patient_readings, reading_refusal, readings_router,
)
```

In the same file, find (line 120):

```python
#: The windows GET /infinity-shadow/findings accepts (`days`, 1–7), as text for the same reason.
```

Replace with:

```python
#: The windows GET /patients/{id}/readings accepts (G3-05: 24, 72, 168 hours), as text for the same reason.
READINGS_WINDOWS_TEXT = frozenset(str(h) for h in READINGS_HOURS)
#: The windows GET /infinity-shadow/findings accepts (`days`, 1–7), as text for the same reason.
```

In the same file, find (lines 1955–1956):

```python
    @app.get("/patients/{patient_id}/fluids")
    async def fluids(patient_id: str, authorization: str | None = Header(default=None)):
```

Replace with:

```python
    @app.get("/patients/{patient_id}/readings")
    async def patient_record(patient_id: str, hours: str = "24",
                             authorization: str | None = Header(default=None)):
        """G3-05 «Ölçüm kaydı» (spec D16): what was measured in this stay and by what — the patient's rows of
        the readings record (`api/readings.py`), as sets, newest first: «cihaz · {device}» or «elle · {user}»,
        a withdrawn value with its reason. Read from the table only (D6). Read-only and not audited, as the
        trends and fluids reads; the scope is resolved once and handed on, as they do. `hours` is read as text
        so that anything but 24, 72 or 168 is this route's own 400 (`reading_hours`, a code beside its words, as
        the list's refusals) rather than FastAPI's 422. Out of scope and unknown are one 404."""
        caller = await _caller(authorization)
        _require(caller, BOARD_VIEW)
        if hours not in READINGS_WINDOWS_TEXT:
            raise reading_refusal(400, READING_HOURS)
        scope = await _scope(authorization)
        await _require_patient(caller, authorization, patient_id, scope=scope)
        _score_state(caller.hospital, patient_id)     # 404 for an id neither measured nor admitted
        now = datetime.now(timezone.utc)
        # Up to the door's own skew ahead: a bedside value stamped a minute fast is in the record at once.
        rows = readings.for_patient(caller.hospital, patient_id, since=now - timedelta(hours=int(hours)),
                                    until=now + BEDSIDE_SKEW)
        return patient_readings(rows, patient_id=patient_id, hours=int(hours), now=now)

    @app.get("/patients/{patient_id}/fluids")
    async def fluids(patient_id: str, authorization: str | None = Header(default=None)):
```

- [ ] **Step 4: The trends' `device` list (`api/trends.py`)**

In `homunculus-engine/src/homunculus/api/trends.py`, find (line 13):

```python
the drawn `points` are the engine's, a withdrawn value gone from them; `manual` is what was typed, and by whom.
```

Replace with:

```python
the drawn `points` are the engine's, a withdrawn value gone from them; `manual` is what was typed, and by whom.
Since G3-05 (D16) it lists each channel's DEVICE readings the same way (`device`: the `ingest` rows, each with
the device that sent it and its withdrawal), so the trend table can say «cihaz» and offer «Düzelt» on one.
```

In the same file, find (lines 174–177):

```python
def _manual(audit: AuditLog, hospital: str, patient_id: str, since: datetime,
            until: datetime) -> tuple[dict[str, list[dict]], bool]:
    """Each published channel's hand entries measured in [since, until], in the order they were written, each
    with its withdrawal when there is one (G3-01, D13, X1).
```

Replace with:

```python
def _manual(audit: AuditLog, hospital: str, patient_id: str, since: datetime,
            until: datetime) -> tuple[dict[str, list[dict]], dict[str, list[dict]], bool]:
    """Each published channel's hand entries measured in [since, until], in the order they were written, each
    with its withdrawal when there is one (G3-01, D13, X1) — and, since G3-05 (D16), its device readings the
    same way, from the same read: `(manual, device, truncated)`. A device entry is `{entry, at, value, source,
    retracted}`: `entry` the `ingest` row «Düzelt» names, `source` the device as it named itself.
```

In the same file, find (lines 194–196):

```python
    fetched = audit.records(tenant=hospital, patient_id=patient_id, event_types={"chart", RETRACT},
                            since=since - BEDSIDE_SKEW, limit=TRENDS_MANUAL_LIMIT + 1, newest=True)
    truncated = len(fetched) > TRENDS_MANUAL_LIMIT
```

Replace with:

```python
    fetched = audit.records(tenant=hospital, patient_id=patient_id, event_types={"chart", "ingest", RETRACT},
                            since=since - BEDSIDE_SKEW, limit=TRENDS_MANUAL_LIMIT + 1, newest=True)
    truncated = len(fetched) > TRENDS_MANUAL_LIMIT
```

In the same file, find (lines 206–218):

```python
    out: dict[str, list[dict]] = {key: [] for key in _PUBLISHED_SIGNALS}
    for rec in rows:
        if rec.event_type != "chart" or rec.subject not in out:
            continue
        at = _instant(rec.payload.get("obs_ts"))
        value = rec.payload.get("value")
        if at is None or not since <= at <= until or not _finite_number(value):
            continue
        out[rec.subject].append({
            "entry": rec.id, "at": at.astimezone(timezone.utc).isoformat(), "value": value,
            "by": str(rec.payload.get("charted_by") or ""), "retracted": withdrawn.get(rec.id),
        })
    return out, truncated
```

Replace with:

```python
    out: dict[str, list[dict]] = {key: [] for key in _PUBLISHED_SIGNALS}
    device: dict[str, list[dict]] = {key: [] for key in _PUBLISHED_SIGNALS}
    for rec in rows:
        if rec.event_type not in ("chart", "ingest") or rec.subject not in out:
            continue
        at = _instant(rec.payload.get("obs_ts"))
        value = rec.payload.get("value")
        if at is None or not since <= at <= until or not _finite_number(value):
            continue
        if rec.event_type == "ingest":
            device[rec.subject].append({
                "entry": rec.id, "at": at.astimezone(timezone.utc).isoformat(), "value": value,
                "source": str(rec.payload.get("device") or ""), "retracted": withdrawn.get(rec.id),
            })
            continue
        out[rec.subject].append({
            "entry": rec.id, "at": at.astimezone(timezone.utc).isoformat(), "value": value,
            "by": str(rec.payload.get("charted_by") or ""), "retracted": withdrawn.get(rec.id),
        })
    return out, device, truncated
```

In the same file, find (line 244):

```python
    manual, manual_truncated = _manual(audit, hospital, patient_id, since, until)   # G3-01 (D13, X1)
```

Replace with:

```python
    manual, device, manual_truncated = _manual(audit, hospital, patient_id, since, until)   # G3-01 (D13, X1); G3-05 (D16)
```

In the same file, find (line 261):

```python
            "manual": manual[key],
```

Replace with:

```python
            "manual": manual[key],
            # G3-05 (D16): what a device sent into this channel in the window, a withdrawn value included and marked.
            "device": device[key],
```

`TRENDS_MANUAL_LIMIT` (5000 rows, the newest kept) now counts the `ingest` rows too. A spot-check device writes four rows a round, so the 72-hour window of an hourly round is about 300 rows; `manual_truncated` still says when a read had to cut (spec O3 names the continuous-monitor case).

- [ ] **Step 5: Run to see them pass**

Run: `cd /c/tmp/g3-cihaz-olcum/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_readings_patient.py 2>&1 | tail -3`
Expected: `23 passed`.

- [ ] **Step 6: The pins — the board table, the tenant walk, the log mask**

Run first: `cd /c/tmp/g3-cihaz-olcum/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_board_permissions.py tests/test_access_log_redaction.py 2>&1 | tail -4`
Expected: `2 failed` among the rest — `test_the_table_names_every_board_route_and_only_those` and `test_every_route_parameter_is_redacted_in_the_log_uri` (`/patients/{patient_id}/readings -> /patients/:redacted (wanted /patients/:key/readings)`: only the catch-all covers it).

In `homunculus-engine/tests/test_board_permissions.py`, find (lines 282–283):

```python
    # G3-03: the fluid ledger (api/fluids.py), read with the board's own right.
    ("GET", "/patients/{patient_id}/fluids"): "board.view",
```

Replace with:

```python
    # G3-03: the fluid ledger (api/fluids.py), read with the board's own right.
    ("GET", "/patients/{patient_id}/fluids"): "board.view",
    # G3-05: the patient's measurement record (api/readings.py `patient_readings`), read with the board's own right.
    ("GET", "/patients/{patient_id}/readings"): "board.view",
```

In `homunculus-engine/tests/test_tenant_isolation.py`, find (line 870):

```python
    ("GET", "/patients/{patient_id}/fluids"),
```

Replace with:

```python
    ("GET", "/patients/{patient_id}/fluids"),
    # G3-05's measurement record (api/readings.py): as the trends read — the board's Caller, board.view and
    # _require_patient; the store is read by the caller's own hospital.
    ("GET", "/patients/{patient_id}/readings"),
```

In `deploy/local/web/nginx.conf`, find (line 49):

```nginx
    ~^/patients/[^/]+/fluids$                                /patients/:key/fluids;
```

Replace with:

```nginx
    ~^/patients/[^/]+/fluids$                                /patients/:key/fluids;
    ~^/patients/[^/]+/readings$                              /patients/:key/readings;   # G3-05: «Ölçüm kaydı»
```

- [ ] **Step 7: Run the pins and the trends suites**

Run: `cd /c/tmp/g3-cihaz-olcum/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_board_permissions.py tests/test_access_log_redaction.py tests/test_tenant_isolation.py tests/test_nginx_routes.py tests/test_trends_api.py tests/test_trends.py tests/test_trends_manual.py 2>&1 | tail -3`
Expected: `225 passed, 133 skipped` — `test_board_permissions.py` is 77 now (two more parametrized cases for the new route).

- [ ] **Step 8: Commit**

```bash
cd /c/tmp/g3-cihaz-olcum && git add -- homunculus-engine/tests/test_readings_patient.py homunculus-engine/src/homunculus/api/readings.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/src/homunculus/api/trends.py homunculus-engine/tests/test_board_permissions.py homunculus-engine/tests/test_tenant_isolation.py deploy/local/web/nginx.conf && git commit -m "feat(readings): GET /patients/{id}/readings — the patient's measurement record — and the trends' device list (G3-05 D16)" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>" -- homunculus-engine/tests/test_readings_patient.py homunculus-engine/src/homunculus/api/readings.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/src/homunculus/api/trends.py homunculus-engine/tests/test_board_permissions.py homunculus-engine/tests/test_tenant_isolation.py deploy/local/web/nginx.conf
```

---

### Task B9: A device reading counts for the vital task (D5, D15)

**Files:**
- Test: `homunculus-engine/tests/test_tasks_api.py` — after line 392 (the end of the file), line 99, lines 106–108, line 112, lines 173–174 (as each step finds the file)
- Test: `homunculus-engine/tests/test_tasks_schedule.py` — lines 124–127 (as each step finds the file)
- Modify: `homunculus-engine/src/homunculus/api/tasks.py` — lines 4–6, lines 42–46, lines 62–66, lines 337–344, lines 355–358, lines 366–368, lines 443–444 (as each step finds the file)

The derived «vital zamanı» task is anchored on the patient's most recent measurement of a NEWS2 input. Until now that was a hand entry only (G3-02 D2); on the wards the device is the normal source, so a nurse would have had to retype the device's values to clear the task. **This overrides G3-02 D2**: the anchor reads `chart` and `ingest` rows of the seven NEWS2 inputs, minus the withdrawn ones; any one input counts. `NEWS2_HAND_CODES` becomes `NEWS2_INPUT_CODES` (the old name stays as an alias).

Two consequences the spec names and the tests hold (Q4): the device sends SpO₂, systolic pressure, pulse and temperature but no respiration rate and no consciousness, so after a device round the task resets while the card's NEWS2 stays `partial` (the answer already carries `partial`); and a reading in the unmatched list resets nothing — it writes no `ingest` row under a patient — until it is linked, when it counts at its own time.

- [ ] **Step 1: Write the failing tests**

Append to the end of `homunculus-engine/tests/test_tasks_api.py` (after line 392):

```python


class TestADeviceReadingCountsForTheVitalTask:
    """G3-05 (spec D5, D15): overrides G3-02 D2 — the anchor is the last measurement of a NEWS2 input, whoever
    made it: the nurse by hand or the device."""

    def test_a_device_reading_is_the_anchor(self, client, store):
        at = datetime.now(timezone.utc) - timedelta(minutes=4)
        _ingest(client, "S-002", "spo2", 97, at)                         # admitted 20 h ago: late until now
        vital = _card(client, "S-002")["vital"]
        assert vital["anchor_at"] == at.isoformat() and vital["state"] == "plan"
        assert vital["entries"] == ([at.isoformat()] if at >= datetime.fromisoformat(_tasks(client).json()["shift"]["start"]) else [])

    def test_the_newest_of_a_hand_entry_and_a_device_reading_wins(self, client):
        now = datetime.now(timezone.utc)
        _chart(client, "S-001", [{"code": "resp_rate", "value": 16}], now - timedelta(minutes=50))
        _ingest(client, "S-001", "heart_rate", 80, now - timedelta(minutes=10))
        assert _card(client, "S-001")["vital"]["anchor_at"] == (now - timedelta(minutes=10)).isoformat()
        _chart(client, "S-001", [{"code": "acvpu", "value": 0}], now - timedelta(minutes=2))
        assert _card(client, "S-001")["vital"]["anchor_at"] == (now - timedelta(minutes=2)).isoformat()

    def test_a_device_value_that_is_no_news2_input_is_not_an_anchor(self, client):
        _ingest(client, "S-003", "map", 80, datetime.now(timezone.utc) - timedelta(minutes=3))
        vital = _card(client, "S-003")["vital"]
        assert vital["anchor_at"] is None and vital["state"] == "unknown"

    def test_a_withdrawn_device_reading_is_not_an_anchor(self, client):
        at = datetime.now(timezone.utc) - timedelta(minutes=5)
        _ingest(client, "S-001", "map", 80, at)                          # keeps the card on the board
        _ingest(client, "S-001", "spo2", 97, at)
        entry = client.app.state.audit.records(tenant="h1", patient_id="S-001", event_type="ingest", limit=1, newest=True)[-1].id
        assert _card(client, "S-001")["vital"]["anchor_at"] == at.isoformat()
        r = client.post(f"/clinical/S-001/entries/{entry}/retract", json={"reason": "yanlış hastadan ölçüldü"}, headers=NURSE)
        assert r.status_code == 200, r.text
        vital = _card(client, "S-001")["vital"]
        assert vital["anchor_at"] is None and vital["state"] == "unknown"

    def test_a_device_reading_stamped_in_the_future_is_ignored(self, client):
        """The door's own skew is two minutes (BEDSIDE_SKEW): a device clock an hour fast anchors nothing."""
        now = datetime.now(timezone.utc)
        _ingest(client, "S-001", "spo2", 97, now + timedelta(hours=1))
        assert _card(client, "S-001")["vital"]["anchor_at"] is None
        _ingest(client, "S-001", "spo2", 96, now + timedelta(minutes=1))
        assert _card(client, "S-001")["vital"]["anchor_at"] == (now + timedelta(minutes=1)).isoformat()

    def test_after_a_device_round_the_task_resets_and_the_news2_is_partial(self, client):
        """Q4: the device sends no respiration rate and no consciousness — the timer resets all the same, and
        the answer says the score is partial until they are entered by hand."""
        at = datetime.now(timezone.utc) - timedelta(minutes=3)
        for code, value in (("spo2", 97), ("sbp", 122), ("heart_rate", 78), ("temperature", 36.8)):
            _ingest(client, "S-001", code, value, at)
        vital = _card(client, "S-001")["vital"]
        assert (vital["state"], vital["anchor_at"], vital["partial"]) == ("plan", at.isoformat(), True)

    def test_a_device_reading_ends_a_skip_as_a_hand_entry_does(self, client, store):
        store.save_settings("h1", DEFAULT_SETTINGS, by="admin", now=NOW)
        _ingest(client, "S-002", "map", 80, datetime.now(timezone.utc) - timedelta(minutes=30))   # on the board, late
        r = client.post("/tasks/vitals/S-002/skip", json={"reason": "hasta ameliyatta"}, headers=NURSE)
        assert r.status_code == 200, r.text
        assert _card(client, "S-002")["vital"]["state"] == "skipped"
        _ingest(client, "S-002", "spo2", 97, datetime.now(timezone.utc))
        assert _card(client, "S-002")["vital"]["state"] == "plan"

    def test_skipping_reads_the_device_anchor_too(self, client):
        """The one-patient read (`hand_entries`) and the board's read agree: a patient the device has just
        measured has no vital task due, so there is nothing to skip."""
        _ingest(client, "S-002", "spo2", 97, datetime.now(timezone.utc) - timedelta(minutes=3))
        r = client.post("/tasks/vitals/S-002/skip", json={"reason": "hasta ameliyatta"}, headers=NURSE)
        assert r.status_code == 409 and r.json()["detail"]["code"] == "vital_not_due"


def test_an_unmatched_reading_resets_nothing_until_it_is_linked():
    """D15: an unmatched reading writes no `ingest` row under a patient; linked, it counts at its own time."""
    from homunculus.api.readings import POLICY_UNMATCHED
    identities = InMemoryIdentityStore()
    identities.apply("h1", IdentityRecord(patient_id="202600000001", given="Test", family="Hasta", source="kabul",
                                          unit_id="u-1", bed_id="b-1", updated_at=NOW))
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve, identities=identities,
                     tasks=InMemoryTaskStore(zones={"h1": "UTC"}), unknown_readings=POLICY_UNMATCHED)
    with TestClient(app) as c:
        at = datetime.now(timezone.utc) - timedelta(minutes=6)
        _ingest(c, "202600000010", "spo2", 97, at)                       # a typo: listed
        assert _card(c, "202600000001")["vital"]["anchor_at"] is None
        [waiting] = c.get("/readings/unmatched", headers=NURSE).json()["sets"]
        ids = [v["id"] for v in waiting["readings"]]
        r = c.post("/readings/unmatched/assign", json={"readings": ids, "patient_id": "202600000001"}, headers=NURSE)
        assert r.status_code == 200, r.text
        assert _card(c, "202600000001")["vital"]["anchor_at"] == at.isoformat()
```

In `homunculus-engine/tests/test_tasks_schedule.py`, find (lines 124–127):

```python
def test_the_hand_codes_are_news2s_seven_inputs():
    assert NEWS2_HAND_CODES == frozenset({
        SignalCode.RESP_RATE.value, SignalCode.SPO2.value, SignalCode.SBP.value, SignalCode.HEART_RATE.value,
        SignalCode.TEMPERATURE.value, SignalCode.SUPPLEMENTAL_OXYGEN.value, SignalCode.ACVPU.value})
```

Replace with:

```python
def test_the_hand_codes_are_news2s_seven_inputs():
    assert NEWS2_HAND_CODES == frozenset({
        SignalCode.RESP_RATE.value, SignalCode.SPO2.value, SignalCode.SBP.value, SignalCode.HEART_RATE.value,
        SignalCode.TEMPERATURE.value, SignalCode.SUPPLEMENTAL_OXYGEN.value, SignalCode.ACVPU.value})


def test_the_input_codes_are_the_same_seven_under_their_new_name():
    """G3-05 (D15): the anchor counts a device's reading too, so the set is named for what it is — the inputs
    NEWS2 scores — and the old name stays as an alias for whoever still imports it."""
    from homunculus.api.tasks import NEWS2_INPUT_CODES
    assert NEWS2_INPUT_CODES is NEWS2_HAND_CODES and len(NEWS2_INPUT_CODES) == 7
```

Run: `cd /c/tmp/g3-cihaz-olcum/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_tasks_api.py tests/test_tasks_schedule.py 2>&1 | tail -3`
Expected: `9 failed, 49 passed` — eight of the nine new tests of `test_tasks_api.py` (a device reading does not anchor yet; `test_a_device_value_that_is_no_news2_input_is_not_an_anchor` passes already) and the alias test (`ImportError: cannot import name 'NEWS2_INPUT_CODES'`).

- [ ] **Step 2: The anchor reads both kinds of row (`api/tasks.py`)**

In `homunculus-engine/src/homunculus/api/tasks.py`, find (lines 4–6):

```python
Two sources, one model (spec D1). A HAND task is a row a clinician wrote (the store below). The
VITAL task is never stored (D2): it is derived at read time from the patient's most recent hand
entry of a NEWS2 input (the `chart` rows G3-01 writes, minus the withdrawn ones), the band of the
```

Replace with:

```python
Two sources, one model (spec D1). A HAND task is a row a clinician wrote (the store below). The
VITAL task is never stored (D2): it is derived at read time from the patient's most recent
measurement of a NEWS2 input — a hand entry (the `chart` rows G3-01 writes) or, since G3-05 (D15,
which overrides D2's «hand entries only»), a device reading (the `ingest` rows) — minus the withdrawn ones, the band of the
```

In the same file, find (lines 42–46):

```python
#: The seven inputs NEWS2 scores, as the signal codes a hand entry carries (`rules/news2.py`).
NEWS2_HAND_CODES: frozenset[str] = frozenset({
    SignalCode.RESP_RATE.value, SignalCode.SPO2.value, SignalCode.SBP.value, SignalCode.HEART_RATE.value,
    SignalCode.TEMPERATURE.value, SignalCode.SUPPLEMENTAL_OXYGEN.value, SignalCode.ACVPU.value,
})
```

Replace with:

```python
#: The seven inputs NEWS2 scores, as the signal codes a `chart` or an `ingest` row carries (`rules/news2.py`).
#: Any one of them, measured, is a vital measurement (G3-05, D15). A device sends four of the seven — SpO₂,
#: systolic pressure, pulse, temperature — and no respiration rate and no consciousness: after a device round
#: the task resets and the card's NEWS2 stays partial until those two are entered by hand (Q4).
NEWS2_INPUT_CODES: frozenset[str] = frozenset({
    SignalCode.RESP_RATE.value, SignalCode.SPO2.value, SignalCode.SBP.value, SignalCode.HEART_RATE.value,
    SignalCode.TEMPERATURE.value, SignalCode.SUPPLEMENTAL_OXYGEN.value, SignalCode.ACVPU.value,
})
#: The name from before G3-05, when only a hand entry counted. Kept for its importers.
NEWS2_HAND_CODES = NEWS2_INPUT_CODES
#: The rows a measurement is: a clinician's `chart` row or a device's `ingest` row. A reading that waits in the
#: unmatched list is neither — it is a `reading_unmatched` row under no patient — and counts only once linked.
MEASUREMENT_EVENTS = frozenset({"chart", "ingest"})
```

In the same file, find (lines 62–66):

```python
#: How far back the anchor read looks for a hand entry before it falls back to the admission (D2).
ANCHOR_WINDOW = timedelta(hours=48)
#: The most hand-entry rows one patient's anchor read keeps (newest first), as trends keeps (G3-01 X1);
#: the board's one tenant-wide read keeps HAND_LIMIT * 4.
HAND_LIMIT = 5000
```

Replace with:

```python
#: How far back the anchor read looks for a measurement before it falls back to the admission (D2).
ANCHOR_WINDOW = timedelta(hours=48)
#: The most measurement rows one patient's anchor read keeps (newest first), as trends keeps (G3-01 X1);
#: the board's one tenant-wide read keeps HAND_LIMIT * 4 — 20 000 rows, the newest: enough for spot-check
#: devices on every floor (four rows a round), not for a continuous monitor feed in the real engine (G3-05 O3).
HAND_LIMIT = 5000
```

In the same file, find (lines 337–344):

```python
def _stamps_by_patient(rows, *, since: datetime, until: datetime) -> dict[str, list[datetime]]:
    """Each patient's hand-entry instants in [since, until], oldest first: the `chart` rows of a NEWS2
    input minus the ones a `chart_retract` of the SAME patient withdrew (G3-01 D12)."""
    withdrawn = {(rec.patient_id, rec.payload.get("entry")) for rec in rows if rec.event_type == RETRACT}
    stamps: dict[str, list[datetime]] = {}
    for rec in rows:
        if rec.event_type != "chart" or rec.subject not in NEWS2_HAND_CODES or (rec.patient_id, rec.id) in withdrawn:
            continue
```

Replace with:

```python
def _stamps_by_patient(rows, *, since: datetime, until: datetime) -> dict[str, list[datetime]]:
    """Each patient's measurement instants in [since, until], oldest first: the `chart` and `ingest` rows of
    a NEWS2 input minus the ones a `chart_retract` of the SAME patient withdrew (G3-01 D12; G3-05 D13, D15).
    `until` bounds a stamp from the future: a device clock running ahead anchors nothing."""
    withdrawn = {(rec.patient_id, rec.payload.get("entry")) for rec in rows if rec.event_type == RETRACT}
    stamps: dict[str, list[datetime]] = {}
    for rec in rows:
        if (rec.event_type not in MEASUREMENT_EVENTS or rec.subject not in NEWS2_INPUT_CODES
                or (rec.patient_id, rec.id) in withdrawn):
            continue
```

In the same file, find (lines 355–358):

```python
    """When this patient's NEWS2 inputs were entered by hand in [since, until], oldest first — the
    `chart` rows minus the withdrawn ones (G3-01 D12). A monitor or HL7 observation is not one."""
    rows = audit.records(tenant=hospital, patient_id=patient_id, event_types={"chart", RETRACT},
                         since=since - BEDSIDE_SKEW, limit=HAND_LIMIT, newest=True)
```

Replace with:

```python
    """When this patient's NEWS2 inputs were measured in [since, until], oldest first — the `chart` and
    `ingest` rows minus the withdrawn ones (G3-01 D12). Since G3-05 (D15) a device reading is one; the name is
    from before it."""
    rows = audit.records(tenant=hospital, patient_id=patient_id, event_types=MEASUREMENT_EVENTS | {RETRACT},
                         since=since - BEDSIDE_SKEW, limit=HAND_LIMIT, newest=True)
```

In the same file, find (lines 366–368):

```python
    rows = audit.records(tenant=hospital, event_types={"chart", RETRACT}, since=since - BEDSIDE_SKEW,
                         limit=HAND_LIMIT * 4, newest=True)
    return _stamps_by_patient(rows, since=since, until=until)
```

Replace with:

```python
    rows = audit.records(tenant=hospital, event_types=MEASUREMENT_EVENTS | {RETRACT}, since=since - BEDSIDE_SKEW,
                         limit=HAND_LIMIT * 4, newest=True)
    return _stamps_by_patient(rows, since=since, until=until)
```

In the same file, find (lines 443–444):

```python
        """One card's vital task from what was read for it: `stamps` its hand entries (oldest first),
        `skip` its latest `vital_skipped`. The admission is read only when there is no hand entry."""
```

Replace with:

```python
        """One card's vital task from what was read for it: `stamps` its measurements (oldest first),
        `skip` its latest `vital_skipped`. The admission is read only when there is no measurement."""
```

- [ ] **Step 3: The G3-02 tests that used a device reading as «not a measurement»**

Five tests of G3-02 sent a device heart rate where they meant «something that is not a vital measurement» — to put a card on the board, or to show that a monitor value did not anchor. A heart rate is a NEWS2 input, so since Step 2 it anchors. Each keeps its point with a device value NEWS2 does not score (`map`):

In `homunculus-engine/tests/test_tasks_api.py`, find (line 99):

```python
        _ingest(client, "S-002", "heart_rate", 80, at)              # a monitor value is NOT a hand entry
```

Replace with:

```python
        _ingest(client, "S-002", "map", 80, at)                     # a value NEWS2 does not score is no vital measurement (G3-05 D15)
```

In the same file, find (lines 106–108):

```python
        _ingest(client, "S-003", "heart_rate", 80, at)
        vital = _card(client, "S-003")["vital"]
        assert vital["state"] == "unknown" and vital["due_at"] is None
```

Replace with:

```python
        _ingest(client, "S-003", "map", 80, at)                     # on the board, with nothing NEWS2 scores measured
        vital = _card(client, "S-003")["vital"]
        assert vital["state"] == "unknown" and vital["due_at"] is None
```

In the same file, find (line 112):

```python
        _ingest(client, "S-001", "heart_rate", 80, at)              # keeps the card on the board after the withdrawal
```

Replace with:

```python
        _ingest(client, "S-001", "map", 80, at)                     # keeps the card on the board after the withdrawal
```

In the same file, find (lines 173–174):

```python
def _seen(client, patient="S-001"):
    _ingest(client, patient, "heart_rate", 80, datetime.now(timezone.utc) - timedelta(minutes=3))
```

Replace with:

```python
def _seen(client, patient="S-001"):
    """Puts the patient on the board without measuring a NEWS2 input: a device MAP. (A device heart rate would
    anchor the vital task since G3-05, D15.)"""
    _ingest(client, patient, "map", 80, datetime.now(timezone.utc) - timedelta(minutes=3))
```

(`test_each_patient_carries_the_unit_and_bed_key_its_card_sits_on`, at the end of the file, also ingests a heart rate, but reads only the unit and the bed key: it is right as it is.)

- [ ] **Step 4: Run to see them pass**

Run: `cd /c/tmp/g3-cihaz-olcum/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_tasks_api.py tests/test_tasks_schedule.py tests/test_tasks_store.py tests/test_device_retract.py 2>&1 | tail -3`
Expected: `89 passed` (37 + 21 + 5 + 26).

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g3-cihaz-olcum && git add -- homunculus-engine/tests/test_tasks_api.py homunculus-engine/tests/test_tasks_schedule.py homunculus-engine/src/homunculus/api/tasks.py && git commit -m "feat(tasks): a device reading counts for the vital task — the anchor reads chart and ingest rows (G3-05 D5, D15)" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>" -- homunculus-engine/tests/test_tasks_api.py homunculus-engine/tests/test_tasks_schedule.py homunculus-engine/src/homunculus/api/tasks.py
```

---

### Task B10: `reconcile` (audit → table) and `scripts/backfill_vital_readings.py` (D7, D19)

**Files:**
- Test: `homunculus-engine/tests/test_readings_reconcile.py` (new)
- Modify: `homunculus-engine/src/homunculus/api/readings.py` — lines 27–28, line 85, after line 530 (the end of the file) (as each step finds the file)
- Modify: `homunculus-engine/src/homunculus/api/app.py` — lines 70–74, lines 782–783, lines 821–829, line 941 (as each step finds the file)
- Create: `homunculus-engine/scripts/backfill_vital_readings.py`
- Test: `homunculus-engine/tests/test_readings_postgres.py` — after line 186 (the end of the file) (as each step finds the file)

The table is the audit's projection, written after it and allowed to fail without failing a request. `reconcile` is what makes that safe: it reads the audit rows of a window and writes what the table lacks — idempotently, so it can run at every start and every hour:

| The trail holds | The table lacks | `reconcile` does |
|---|---|---|
| an `ingest` row, or a `chart` row of the bedside set | the row with that `audit_id` | adds it as `recorded` |
| a `reading_unmatched` row | the row with that `audit_id` | adds it as `unmatched` |
| a `chart_retract` row | the mark on the row of that entry | `void` |
| an `ingest` row carrying `"reading": id` | the link of a row still claimed | `finalize` |
| a `reading_rejected` row | the closing of rows still claimed | `reject` |
| nothing for a claim older than 10 minutes | — | `release` (an orphaned claim, D12) |

`create_app` runs it at start and hourly over the last 48 hours when the store is durable (Postgres), off the event loop; `app.state.reconcile_readings` is one pass (the tests call it). `scripts/backfill_vital_readings.py --tenant <slug> --open-only [--dry-run]` runs it with no 48-hour bound, for the stays open now, each from the time it began — the optional deploy step of D19.

- [ ] **Step 1: Write the failing tests**

Create `homunculus-engine/tests/test_readings_reconcile.py`:

```python
# homunculus-engine/tests/test_readings_reconcile.py
"""G3-05 (spec D7, D12, D19): `reconcile` — the audit trail is the source of truth and the readings table its
projection, so whatever the table lacks can be written again from the trail: a missing row, a missing mark, a
claim left behind. Idempotent. And the backfill script that runs it for the stays open on the deploy day.
Synthetic numbers and values only (CLAUDE.md rule 6)."""
from __future__ import annotations

import importlib.util
import json
from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.audit import AuditEvent, InMemoryAuditLog
from homunculus.api.clinical import RETRACT
from homunculus.api.identity import Caller
from homunculus.api.readings import (
    CLAIM_STALE, POLICY_UNMATCHED, READING_REJECTED, READING_UNMATCHED, RECONCILE_WINDOW, STATE_ASSIGNED,
    STATE_RECORDED, STATE_REJECTED, STATE_UNMATCHED, InMemoryReadingStore, reconcile,
)
from tests.conftest import ENGINE_ROOT
from tests.test_ingest_apply import obs
from tests.test_readings_ingest import _Flaky

TOKEN = "tok"
DEVICE = {"Authorization": f"Bearer {TOKEN}"}
NURSE = {"Authorization": "Bearer nurse-jwt"}
PEOPLE = {"nurse-jwt": Caller(hospital="h1", actor="hem.ayse", groups=("nurse",),
                              perms=frozenset({"board.view", "clinical.chart"}))}
KEY, TYPO = "202600000001", "202600000010"
ADMISSION = "11111111-1111-4111-8111-111111111111"       # a synthetic admission id
NOW = datetime.now(timezone.utc)
WHEN = NOW - timedelta(minutes=30)
ALL = {"since": NOW - timedelta(days=30), "until": NOW + timedelta(hours=1)}
NOTHING = {"recorded": 0, "unmatched": 0, "voided": 0, "finalized": 0, "rejected": 0, "released": 0, "skipped": 0}
WHY = "manşet yanlış koldaydı, yeniden ölçüldü"

SCRIPT = ENGINE_ROOT / "scripts" / "backfill_vital_readings.py"


async def _resolve(credential: str):
    return PEOPLE.get(credential)


def _ingest_row(audit, code, value, when=WHEN, key=KEY, device="CONNEX-3A", **extra):
    return audit.append(AuditEvent("h1", "ingest", key, code, {
        "value": float(value), "unit": "u", "obs_ts": when.isoformat(), "device": device, **extra}))


def _chart_row(audit, code, value, when=WHEN, key=KEY, by="hem.ayse"):
    return audit.append(AuditEvent("h1", "chart", key, code, {
        "value": float(value), "unit": "/min", "obs_ts": when.isoformat(), "charted_by": by}))


def _unmatched_row(audit, code, value, when=WHEN, key=TYPO, reason="unknown"):
    return audit.append(AuditEvent("h1", READING_UNMATCHED, key, code, {
        "value": float(value), "unit": "u", "obs_ts": when.isoformat(), "device": "CONNEX-3A", "reason": reason}))


def _run(store, audit, **kw):
    return reconcile(store, audit, tenant="h1", now=kw.pop("now", NOW), **kw)


class TestAMissingRow:
    def test_a_device_reading_and_a_bedside_value_are_filed_from_their_audit_rows(self):
        audit, store = InMemoryAuditLog(), InMemoryReadingStore(admitted={("h1", KEY): ADMISSION})
        device = _ingest_row(audit, "spo2", 97)
        hand = _chart_row(audit, "resp_rate", 16)
        counts = _run(store, audit)
        assert counts == {**NOTHING, "recorded": 2}
        rows = {r.code: r for r in store.for_patient("h1", KEY, **ALL)}
        spo2, resp = rows["spo2"], rows["resp_rate"]
        assert (spo2.origin, spo2.source, spo2.state, spo2.value, spo2.unit) == ("device", "CONNEX-3A", STATE_RECORDED, 97.0, "u")
        assert (spo2.audit_id, spo2.entry_id, spo2.observed_at, spo2.admission_id) == (device.id, device.id, WHEN, ADMISSION)
        assert (spo2.received_key, spo2.patient_key) == (KEY, KEY)
        assert spo2.received_at == datetime.fromisoformat(device.ts)                # when the door wrote the row
        assert (resp.origin, resp.source, resp.recorded_by, resp.entry_id) == ("manual", "clinician", "hem.ayse", hand.id)

    def test_what_the_doors_do_not_file_is_not_filed_here_either(self):
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        _chart_row(audit, "urine_output_ml", 200)            # the fluid ledger's
        _chart_row(audit, "lactate", 2.1)                    # no bedside vital
        audit.append(AuditEvent("h1", "alert", KEY, "news2", {"severity": "high"}))
        assert _run(store, audit) == NOTHING and store.for_patient("h1", KEY, **ALL) == []

    def test_a_reading_the_door_listed_is_filed_as_unmatched(self):
        """The 500 path of D7: the `reading_unmatched` row was written and the table row was not."""
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        row = _unmatched_row(audit, "spo2", 97, reason="discharged")
        assert _run(store, audit) == {**NOTHING, "unmatched": 1}
        [listed] = store.unmatched("h1", since=NOW - timedelta(days=7))
        assert (listed.state, listed.unmatched_reason, listed.received_key, listed.patient_key) == (STATE_UNMATCHED, "discharged", TYPO, None)
        assert (listed.audit_id, listed.entry_id, listed.value) == (row.id, None, 97.0)

    def test_a_row_the_table_has_is_left_alone(self):
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        app = create_app({TOKEN: "h1"}, run_escalation_loop=False, audit=audit, readings=store)
        with TestClient(app) as client:
            assert client.post("/ingest", json=obs("spo2", 97, KEY, WHEN), headers=DEVICE).status_code == 200
        before = store.for_patient("h1", KEY, **ALL)
        assert _run(store, audit) == NOTHING and store.for_patient("h1", KEY, **ALL) == before

    def test_the_twin_of_a_re_sent_unmatched_reading_adds_nothing(self):
        """Two `reading_unmatched` rows for one reading (the bridge's retry after a 500): one table row."""
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        _unmatched_row(audit, "spo2", 97)
        _unmatched_row(audit, "spo2", 97)
        assert _run(store, audit) == {**NOTHING, "unmatched": 1}
        assert len(store.unmatched("h1", since=NOW - timedelta(days=7))) == 1

    def test_a_row_that_cannot_be_read_is_skipped_and_counted(self):
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        audit.append(AuditEvent("h1", "ingest", KEY, "spo2", {"value": "yok", "unit": "%", "obs_ts": WHEN.isoformat()}))
        audit.append(AuditEvent("h1", "ingest", KEY, "spo2", {"value": 97.0, "unit": "%", "obs_ts": "dün"}))
        audit.append(AuditEvent("h1", "ingest", KEY, "spo2", {"value": 97.0, "unit": "%", "obs_ts": "2026-11-11T09:00:00"}))
        _ingest_row(audit, "heart_rate", 80)
        assert _run(store, audit) == {**NOTHING, "recorded": 1, "skipped": 3}

    def test_a_failed_table_write_at_the_door_is_made_good(self):
        audit, store = InMemoryAuditLog(), _Flaky()
        app = create_app({TOKEN: "h1"}, run_escalation_loop=False, audit=audit, readings=store)
        with TestClient(app) as client:
            store.fail = {"add"}
            assert client.post("/ingest", json=obs("spo2", 97, KEY, WHEN), headers=DEVICE).status_code == 200
            assert store.for_patient("h1", KEY, **ALL) == []
            store.fail = set()
            client.portal.call(app.state.reconcile_readings)
            [row] = store.for_patient("h1", KEY, **ALL)
            assert (row.code, row.value, row.origin) == ("spo2", 97.0, "device")
            again = client.post("/ingest", json=obs("spo2", 97, KEY, WHEN), headers=DEVICE)
            assert again.json() == {"patient_id": KEY, "duplicate": True}        # … and a re-send is known again


class TestAMissingMark:
    def test_a_withdrawal_marks_its_row(self):
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        device = _ingest_row(audit, "sbp", 88)
        gone = audit.append(AuditEvent("h1", RETRACT, KEY, "sbp", {
            "entry": device.id, "code": "sbp", "value": 88.0, "obs_ts": WHEN.isoformat(), "reason": WHY,
            "retracted_by": "hem.ayse", "origin": "device", "device": "CONNEX-3A"}))
        assert _run(store, audit) == {**NOTHING, "recorded": 1, "voided": 1}
        [row] = store.for_patient("h1", KEY, **ALL)
        assert (row.voided_by, row.void_reason, row.voided_at) == ("hem.ayse", WHY, datetime.fromisoformat(gone.ts))

    def test_a_mark_the_route_could_not_write_is_made_good(self):
        class _NoVoidOnce(InMemoryReadingStore):
            broken = True

            def void(self, *args, **kw):
                if self.broken:
                    raise RuntimeError("readings down")
                return super().void(*args, **kw)
        audit, store = InMemoryAuditLog(), _NoVoidOnce()
        app = create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve, audit=audit, readings=store)
        with TestClient(app) as client:
            assert client.post("/ingest", json=obs("sbp", 88, KEY, WHEN), headers=DEVICE).status_code == 200
            entry = audit.records(tenant="h1", event_type="ingest", limit=1)[0].id
            assert client.post(f"/clinical/{KEY}/entries/{entry}/retract", json={"reason": WHY}, headers=NURSE).status_code == 200
            assert store.for_patient("h1", KEY, **ALL)[0].voided_at is None
            store.broken = False
            client.portal.call(app.state.reconcile_readings)
            assert store.for_patient("h1", KEY, **ALL)[0].void_reason == WHY


class TestAClaimLeftBehind:
    def _claimed(self, store, audit, at=NOW - timedelta(hours=1)):
        row = _unmatched_row(audit, "spo2", 97)
        _run(store, audit)
        [waiting] = store.unmatched("h1", since=NOW - timedelta(days=7))
        store.claim("h1", [waiting.id], by="hem.ayse", at=at)
        return waiting

    def test_a_link_whose_ingest_row_was_written_is_finished(self):
        """The engine took the value (its `ingest` row names the reading) and the table's link failed."""
        audit, store = InMemoryAuditLog(), InMemoryReadingStore(admitted={("h1", KEY): ADMISSION})
        waiting = self._claimed(store, audit)
        linked = _ingest_row(audit, "spo2", 97, reading=waiting.id)
        assert _run(store, audit) == {**NOTHING, "finalized": 1}
        [row] = store.get("h1", [waiting.id])
        assert (row.state, row.patient_key, row.entry_id, row.admission_id) == (STATE_ASSIGNED, KEY, linked.id, ADMISSION)
        assert len(store.for_patient("h1", KEY, **ALL)) == 1             # the linked row, and no second one for the `ingest` row

    def test_a_rejection_whose_audit_row_was_written_is_finished(self):
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        waiting = self._claimed(store, audit)
        audit.append(AuditEvent("h1", READING_REJECTED, TYPO, "reading", {
            "readings": [waiting.id], "received_key": TYPO, "device": "CONNEX-3A", "obs_ts": WHEN.isoformat(),
            "reason": "yanlış numara girilmiş", "actor": "hem.ayse"}))
        assert _run(store, audit) == {**NOTHING, "rejected": 1}
        [row] = store.get("h1", [waiting.id])
        assert (row.state, row.resolve_reason, row.resolved_by) == (STATE_REJECTED, "yanlış numara girilmiş", "hem.ayse")

    def test_an_orphaned_claim_goes_back_to_the_list(self):
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        waiting = self._claimed(store, audit, at=NOW - CLAIM_STALE - timedelta(seconds=1))
        assert _run(store, audit) == {**NOTHING, "released": 1}
        assert store.get("h1", [waiting.id]) == [waiting]

    def test_a_claim_in_work_is_left_alone(self):
        """A link is being made right now: its claim is seconds old."""
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        waiting = self._claimed(store, audit, at=NOW - timedelta(seconds=30))
        assert _run(store, audit) == NOTHING
        assert store.get("h1", [waiting.id])[0].state == STATE_ASSIGNED and store.claims("h1") != []


class TestItIsSafeToRepeat:
    def test_a_second_run_does_nothing(self):
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        device = _ingest_row(audit, "sbp", 88)
        _chart_row(audit, "resp_rate", 16)
        _unmatched_row(audit, "spo2", 97)
        audit.append(AuditEvent("h1", RETRACT, KEY, "sbp", {"entry": device.id, "code": "sbp", "value": 88.0,
                                                            "obs_ts": WHEN.isoformat(), "reason": WHY, "retracted_by": "hem.ayse"}))
        assert _run(store, audit) == {**NOTHING, "recorded": 2, "unmatched": 1, "voided": 1}
        snapshot = (store.for_patient("h1", KEY, **ALL), store.unmatched("h1", since=NOW - timedelta(days=7)))
        assert _run(store, audit) == NOTHING
        assert (store.for_patient("h1", KEY, **ALL), store.unmatched("h1", since=NOW - timedelta(days=7))) == snapshot

    def test_another_hospitals_trail_is_not_read(self):
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        audit.append(AuditEvent("h2", "ingest", KEY, "spo2", {"value": 97.0, "unit": "%", "obs_ts": WHEN.isoformat(), "device": "X"}))
        assert _run(store, audit) == NOTHING

    def test_more_rows_than_a_page_are_all_read(self, monkeypatch):
        from homunculus.api import readings
        monkeypatch.setattr(readings, "RECONCILE_PAGE", 3)
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        for minute in range(8):
            _ingest_row(audit, "spo2", 97, when=WHEN + timedelta(minutes=minute))
        assert _run(store, audit)["recorded"] == 8


class TestTheWindowAndTheStays:
    def test_only_rows_written_in_the_window_are_read(self):
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        _ingest_row(audit, "spo2", 97)
        # The bound is taken at the test's own instant (the row was written just now, whenever this module was loaded).
        assert _run(store, audit, since=datetime.now(timezone.utc) + timedelta(minutes=1)) == NOTHING
        assert _run(store, audit, since=datetime.now(timezone.utc) - RECONCILE_WINDOW)["recorded"] == 1
        assert RECONCILE_WINDOW == timedelta(hours=48)

    def test_with_stays_only_those_keys_from_the_start_of_each_stay(self):
        audit, store = InMemoryAuditLog(), InMemoryReadingStore(admitted={("h1", KEY): ADMISSION})
        began = WHEN - timedelta(hours=2)
        _ingest_row(audit, "spo2", 95, when=began - timedelta(days=3))       # an earlier stay under the same key
        _ingest_row(audit, "spo2", 97, when=WHEN)                            # this stay
        _ingest_row(audit, "spo2", 96, when=WHEN, key="202600000002")        # a key that is not open
        _unmatched_row(audit, "spo2", 94)                                    # nobody's: not a stay's
        counts = _run(store, audit, stays={KEY: began})
        assert counts == {**NOTHING, "recorded": 1}
        assert [(r.value, r.admission_id) for r in store.for_patient("h1", KEY, **ALL)] == [(97.0, ADMISSION)]

    def test_a_dry_run_counts_and_writes_nothing(self):
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        _ingest_row(audit, "spo2", 97)
        _chart_row(audit, "resp_rate", 16)
        _unmatched_row(audit, "heart_rate", 88)
        assert _run(store, audit, dry_run=True) == {**NOTHING, "recorded": 2, "unmatched": 1}
        assert store.for_patient("h1", KEY, **ALL) == [] and store.unmatched("h1", since=NOW - timedelta(days=7)) == []


class TestTheAppRunsIt:
    def test_one_pass_is_on_app_state_and_never_raises(self):
        class _Broken(InMemoryReadingStore):
            def claims(self, tenant):
                raise RuntimeError("readings down")
        app = create_app({TOKEN: "h1"}, run_escalation_loop=False, readings=_Broken())
        with TestClient(app) as client:
            client.portal.call(app.state.reconcile_readings)             # logged, swallowed: the next hour tries again

    def test_the_hourly_pass_is_started_for_a_durable_store_only(self):
        class _Durable(InMemoryReadingStore):
            durable = True
        for store, started in ((InMemoryReadingStore(), False), (_Durable(), True)):
            app = create_app({TOKEN: "h1"}, run_escalation_loop=False, readings=store)
            with TestClient(app):
                assert (app.state.reconcile_task is not None) is started

    def test_a_pass_covers_every_hospital_of_the_deployment(self):
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        for hospital in ("h1", "h2"):
            audit.append(AuditEvent(hospital, "ingest", KEY, "spo2", {"value": 97.0, "unit": "%", "obs_ts": WHEN.isoformat(), "device": "X"}))
        app = create_app({TOKEN: "h1", "tok2": "h2"}, run_escalation_loop=False, audit=audit, readings=store)
        with TestClient(app) as client:
            client.portal.call(app.state.reconcile_readings)
        assert len(store.for_patient("h1", KEY, **ALL)) == 1 and len(store.for_patient("h2", KEY, **ALL)) == 1


# ----------------------------------------------------------------------------- the backfill script

def _script():
    spec = importlib.util.spec_from_file_location("backfill_vital_readings", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestTheBackfillScript:
    def _world(self):
        began = WHEN - timedelta(hours=5)
        audit = InMemoryAuditLog()
        store = InMemoryReadingStore(admitted={("h1", KEY): ADMISSION}, admitted_at={("h1", KEY): began})
        _ingest_row(audit, "spo2", 95, when=began - timedelta(days=4))       # before this stay
        _ingest_row(audit, "spo2", 97, when=WHEN - timedelta(hours=3))       # older than nothing: there is no 48 h bound
        _chart_row(audit, "resp_rate", 16, when=WHEN)
        _ingest_row(audit, "spo2", 96, when=WHEN, key="202600000002")        # not an open stay
        return audit, store

    def _line(self, capsys):
        out = capsys.readouterr().out.strip().splitlines()
        assert len(out) == 1 and out[0].startswith("VITAL_READINGS_BACKFILL ")
        return json.loads(out[0].split(" ", 1)[1])

    def test_a_dry_run_says_what_it_would_file_and_writes_nothing(self, capsys):
        audit, store = self._world()
        assert _script().run(["--tenant", "h1", "--open-only", "--dry-run"], audit=audit, store=store) == 0
        assert self._line(capsys) == {"tenant": "h1", "open_only": True, "dry_run": True, "stays": 1, **NOTHING, "recorded": 2}
        assert store.for_patient("h1", KEY, **ALL) == []

    def test_a_run_files_the_open_stays_rows_and_a_second_run_nothing(self, capsys):
        audit, store = self._world()
        script = _script()
        assert script.run(["--tenant", "h1", "--open-only"], audit=audit, store=store) == 0
        assert self._line(capsys)["recorded"] == 2
        assert sorted((r.code, r.admission_id) for r in store.for_patient("h1", KEY, **ALL)) == [
            ("resp_rate", ADMISSION), ("spo2", ADMISSION)]
        assert store.for_patient("h1", "202600000002", **ALL) == []
        assert script.run(["--tenant", "h1", "--open-only"], audit=audit, store=store) == 0
        assert self._line(capsys) == {"tenant": "h1", "open_only": True, "dry_run": False, "stays": 1, **NOTHING}

    def test_it_refuses_without_a_tenant_or_without_open_only(self, capsys):
        audit, store = self._world()
        script = _script()
        assert script.run(["--open-only"], audit=audit, store=store) == 2
        assert script.run(["--tenant", "h1"], audit=audit, store=store) == 2
        captured = capsys.readouterr()
        assert captured.out == "" and captured.err.count("VITAL_READINGS_BACKFILL_RED 2") == 2
        assert store.for_patient("h1", KEY, **ALL) == []

    def test_it_refuses_without_a_database_when_nothing_is_handed_in(self, capsys, monkeypatch):
        monkeypatch.delenv("DATABASE_URL", raising=False)
        assert _script().run(["--tenant", "h1", "--open-only"]) == 2
        assert "DATABASE_URL" in capsys.readouterr().err

    def test_a_failure_is_exit_1_with_the_class_and_no_traceback(self, capsys):
        class _Down(InMemoryReadingStore):
            def open_stays(self, tenant):
                raise RuntimeError("secret connection string")
        assert _script().run(["--tenant", "h1", "--open-only"], audit=InMemoryAuditLog(), store=_Down()) == 1
        err = capsys.readouterr().err
        assert "VITAL_READINGS_BACKFILL_RED 1 RuntimeError" in err and "secret" not in err and "Traceback" not in err
```

Run: `cd /c/tmp/g3-cihaz-olcum/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_readings_reconcile.py 2>&1 | tail -3`
Expected: an error at collection — `ImportError: cannot import name 'CLAIM_STALE' from 'homunculus.api.readings'`.

- [ ] **Step 2: `reconcile` (`api/readings.py`)**

In `homunculus-engine/src/homunculus/api/readings.py`, find (lines 27–28):

```python
from homunculus.api.audit import AuditEvent, AuditLog
from homunculus.api.clinical import FLUID_CODES, RETRACTABLE_CODES
```

Replace with:

```python
from homunculus.api.audit import AuditEvent, AuditLog, AuditRecord
from homunculus.api.clinical import FLUID_CODES, RETRACT, RETRACTABLE_CODES
```

In the same file, find (line 85):

```python
#: D16: a set whose arrival is later than its measurement by more than this says «alındı» with the arrival time
```

Replace with:

```python
#: D7: `reconcile` runs at start and hourly over the audit rows written in this window, a page at a time.
RECONCILE_WINDOW = timedelta(hours=48)
RECONCILE_PAGE = 1000
#: D12: a claim this old with nothing in the trail to finish it is an orphan — the request that made it died —
#: and goes back to the list. A link or a rejection in work holds its claim for less than a request's time.
CLAIM_STALE = timedelta(minutes=10)
#: D16: a set whose arrival is later than its measurement by more than this says «alındı» with the arrival time
```

Append to the end of `homunculus-engine/src/homunculus/api/readings.py` (after line 530):

```python


# ----------------------------------------------------------------------------- reconcile: audit → table

_RECONCILE_EVENTS = frozenset({"ingest", "chart", RETRACT, READING_UNMATCHED, READING_REJECTED})
_COUNTS = ("recorded", "unmatched", "voided", "finalized", "rejected", "released", "skipped")


def _instant(raw) -> datetime | None:
    """An ISO instant that carries a zone, or None."""
    try:
        at = datetime.fromisoformat(raw)
    except (TypeError, ValueError):
        return None
    return at if at.tzinfo is not None and at.utcoffset() is not None else None


def _observation_of_row(rec: AuditRecord, patient_id: str | None = None) -> Observation | None:
    """The observation an `ingest`, `chart` or `reading_unmatched` row recorded, as the door built it — or None
    for a row that cannot be read (an unknown code, a value that is no number, a time with no zone)."""
    payload = rec.payload
    at = _instant(payload.get("obs_ts"))
    value = payload.get("value")
    try:
        code = SignalCode(rec.subject)
    except ValueError:
        return None
    if at is None or isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        number = float(value)
    except OverflowError:
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    source = "clinician" if rec.event_type == "chart" else str(payload.get("device") or "")
    return Observation(patient_id=patient_id or rec.patient_id, code=code, value=number,
                       unit=str(payload.get("unit") or ""), timestamp=at, source_device=source)


def reconcile(store: ReadingStore, audit: AuditLog, *, tenant: str, now: datetime, since: datetime | None = None,
              stays: dict[str, datetime] | None = None, dry_run: bool = False) -> dict[str, int]:
    """The audit trail, written into the table where the table lacks it (spec D7). Idempotent: every write is
    conditional, so it runs at every start and every hour, and a second run does nothing.

    `since` bounds the audit rows read by when they were WRITTEN (None: every row — the backfill). `stays`, when
    given (the backfill, D19), keeps the run to those card keys and, for each, to the readings measured since
    its stay began; the unmatched list and the claims are then left alone — they are nobody's stay. `dry_run`
    counts what a run would add or finish and writes nothing; a mark (`voided`) is not predicted in a dry run,
    since it needs the row it marks.

    It answers what it did: `recorded` / `unmatched` rows added, rows `voided`, links `finalized`, rejections
    finished (`rejected`), orphaned claims `released`, and audit rows it could not read (`skipped`)."""
    counts = dict.fromkeys(_COUNTS, 0)
    whole = stays is None
    claims = {r.id for r in store.claims(tenant)} if whole else set()
    admissions: dict[str, str | None] = {}

    def admission_of(key: str) -> str | None:
        if key not in admissions:
            admissions[key] = store.admission_of(tenant, key)
        return admissions[key]

    def wanted(rec: AuditRecord, obs: Observation) -> bool:
        return whole or (rec.patient_id in stays and obs.timestamp >= stays[rec.patient_id])

    after: int | None = None
    while True:
        page = audit.records(tenant=tenant, event_types=_RECONCILE_EVENTS, since=since, limit=RECONCILE_PAGE,
                             after_id=after)
        have = store.have(tenant, [rec.id for rec in page
                                   if rec.event_type in ("ingest", "chart", READING_UNMATCHED)])
        for rec in page:
            kind = rec.event_type
            if kind == RETRACT:
                entry = rec.payload.get("entry")
                at = _instant(rec.ts)
                if dry_run or not isinstance(entry, int) or isinstance(entry, bool) or at is None:
                    continue
                if not whole and rec.patient_id not in stays:
                    continue
                if store.void(tenant, entry, by=str(rec.payload.get("retracted_by") or ""), at=at,
                              reason=str(rec.payload.get("reason") or "")[:REJECT_MAX_REASON_CHARS]):
                    counts["voided"] += 1
                continue
            if kind == READING_REJECTED:
                named = rec.payload.get("readings")
                ids = [i for i in named if isinstance(i, int) and i in claims] if isinstance(named, list) else []
                if ids:
                    if not dry_run:
                        store.reject(tenant, ids, reason=str(rec.payload.get("reason") or "")[:REJECT_MAX_REASON_CHARS])
                    claims.difference_update(ids)
                    counts["rejected"] += len(ids)
                continue
            if kind == "chart" and rec.subject not in MANUAL_CODES:
                continue
            if kind == READING_UNMATCHED and not whole:
                continue
            linked = rec.payload.get("reading") if kind == "ingest" else None
            if isinstance(linked, int) and not isinstance(linked, bool):
                # A linked reading's own `ingest` row: the table row is the unmatched one, never a second row.
                if linked in claims:
                    if not dry_run:
                        store.finalize(tenant, linked, patient_key=rec.patient_id,
                                       admission_id=admission_of(rec.patient_id), entry_id=rec.id)
                    claims.discard(linked)
                    counts["finalized"] += 1
                continue
            if rec.id in have:
                continue
            obs = _observation_of_row(rec)
            received_at = _instant(rec.ts)
            if obs is None or received_at is None:
                counts["skipped"] += 1
                continue
            if not wanted(rec, obs):
                continue
            if kind == READING_UNMATCHED:
                reason = rec.payload.get("reason")
                row = device_reading(tenant, obs, received_at=received_at, audit_id=rec.id,
                                     reason=reason if reason in (REASON_UNKNOWN, REASON_DISCHARGED) else REASON_UNKNOWN)
                label = "unmatched"
            elif kind == "ingest":
                row = replace(device_reading(tenant, obs, received_at=received_at, audit_id=rec.id),
                              admission_id=admission_of(rec.patient_id))
                label = "recorded"
            else:
                row = replace(manual_reading(tenant, obs, received_at=received_at, entry_id=rec.id,
                                             recorded_by=str(rec.payload.get("charted_by") or "")),
                              admission_id=admission_of(rec.patient_id))
                label = "recorded"
            if dry_run or store.add(row) is not None:
                counts[label] += 1
        if len(page) < RECONCILE_PAGE:
            break
        after = page[-1].id
    if whole and not dry_run:
        stale = [r.id for r in store.claims(tenant)
                 if r.id in claims and r.resolved_at is not None and now - r.resolved_at > CLAIM_STALE]
        if stale:
            store.release(tenant, stale)
            counts["released"] += len(stale)
    return counts
```

- [ ] **Step 3: The app runs it (`api/app.py`)**

In `homunculus-engine/src/homunculus/api/app.py`, find (lines 70–74):

```python
from homunculus.api.readings import (                             # G3-05
    MANUAL_CODES, POLICY_CARD, POLICY_UNMATCHED, READING_HOURS, READING_TARGET_DISCHARGED, READING_UNMATCHED,
    READINGS_HOURS, REASON_DISCHARGED, REASON_UNKNOWN, UNKNOWN_POLICIES, InMemoryReadingStore, Reading,
    ReadingStore, device_reading, device_source, manual_reading, patient_readings, reading_refusal, readings_router,
)
```

Replace with:

```python
from homunculus.api.readings import (                             # G3-05
    MANUAL_CODES, POLICY_CARD, POLICY_UNMATCHED, READING_HOURS, READING_TARGET_DISCHARGED, READING_UNMATCHED,
    READINGS_HOURS, REASON_DISCHARGED, REASON_UNKNOWN, RECONCILE_WINDOW, UNKNOWN_POLICIES, InMemoryReadingStore,
    Reading, ReadingStore, device_reading, device_source, manual_reading, patient_readings, reading_refusal,
    readings_router, reconcile,
)
```

In the same file, find (lines 782–783):

```python
    @asynccontextmanager
    async def lifespan(app: FastAPI):
```

Replace with:

```python
    async def _reconcile_once() -> None:
        """G3-05 (D7): one pass of `reconcile` — the audit rows of the last 48 hours written into the readings
        table where it lacks them — for every hospital of this deployment. A durable store is reconciled off
        the loop (the reads and writes are bounded database calls); a store in memory on it, where the doors
        write. Never raises: a hospital that fails is logged and the others still run; the next hour tries again."""
        now = datetime.now(timezone.utc)
        for hospital in sorted(set(tenants.values())):
            def one(hospital=hospital):
                return reconcile(readings, audit, tenant=hospital, now=now, since=now - RECONCILE_WINDOW)
            try:
                counts = await asyncio.to_thread(one) if readings.durable else one()
            except Exception:
                log.exception("vital_readings: reconcile başarısız (hastane %s); bir saat sonra yeniden", hospital)
                continue
            if any(counts.values()):
                log.info("vital_readings: reconcile (hastane %s): %s", hospital,
                         ", ".join(f"{name} {n}" for name, n in counts.items() if n))

    async def _reconcile_loop() -> None:
        """`_reconcile_once` at start-up, then hourly — for a durable store only: a store in memory holds what
        this process's doors wrote and nothing a restart could have left behind."""
        while True:
            await _reconcile_once()
            await asyncio.sleep(3600)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
```

In the same file, find (lines 821–829):

```python
        prune = (asyncio.create_task(_prune_loop())                           # Aşama B (D8)
                 if samples.durable or shadow.rules else None)
        try:
            yield
        finally:
            if task is not None:
                task.cancel()
            if prune is not None:
                prune.cancel()
```

Replace with:

```python
        prune = (asyncio.create_task(_prune_loop())                           # Aşama B (D8)
                 if samples.durable or shadow.rules else None)
        reconciling = asyncio.create_task(_reconcile_loop()) if readings.durable else None      # G3-05 (D7)
        app.state.reconcile_task = reconciling
        try:
            yield
        finally:
            if task is not None:
                task.cancel()
            if prune is not None:
                prune.cancel()
            if reconciling is not None:
                reconciling.cancel()
```

In the same file, find (line 941):

```python
    app.state.readings = readings                   # G3-05
```

Replace with:

```python
    app.state.readings = readings                   # G3-05
    app.state.reconcile_readings = _reconcile_once  # one pass of the hourly reconcile (the tests call it)
    app.state.reconcile_task = None                 # the hourly pass, once the lifespan has started it
```

- [ ] **Step 4: The backfill script**

Create `homunculus-engine/scripts/backfill_vital_readings.py`:

```python
"""File the readings of the stays open NOW into `vital_readings`, from the audit trail (G3-05, spec D19).

Migration 0021 is schema-only: on the deploy day the table is empty, and the patient screen's «Ölçüm kaydı» box
would show nothing measured before the deploy. This optional step runs `reconcile` (api/readings.py) with no
48-hour bound, for the card keys admitted now, each from the time its stay began — so the patients in bed keep
their record. Idempotent: a second run files nothing. Run on the VM in a one-off container of the NEW api image,
after `alembic upgrade head`:

    docker compose run --rm --no-deps -T api python scripts/backfill_vital_readings.py --tenant <slug> --open-only --dry-run </dev/null
    docker compose run --rm --no-deps -T api python scripts/backfill_vital_readings.py --tenant <slug> --open-only </dev/null

It prints ONE line on stdout and nothing else there:

    VITAL_READINGS_BACKFILL {"tenant", "open_only", "dry_run", "stays", "recorded", "unmatched", "voided",
                             "finalized", "rejected", "released", "skipped"}

`stays` is how many admissions are open; `recorded` the rows filed (in a dry run: that would be filed);
`skipped` the audit rows that could not be read. `unmatched`, `finalized`, `rejected` and `released` are always 0
here: the list and its claims are the hourly reconcile's, not a stay's. A dry run predicts no `voided`.
Every refusal and failure goes to stderr as `VITAL_READINGS_BACKFILL_RED <code> <reason>`.

Exit codes
  0  done (or, with --dry-run, counted); nothing is written twice.
  1  an unexpected failure (the database down, a timeout). Rows may have been written: run it again. stderr
     carries the exception's CLASS, never its message and never a traceback (a driver error prints parameters).
  2  refused, nothing read or written: no --tenant, no --open-only, no DATABASE_URL.

Without --open-only it refuses: the rows of closed stays have no screen yet (spec §9), and an admission from
before migration 0015 is keyed by the patient's H-number, which an earlier stay of the same patient shares —
only the start of an open stay tells them apart.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone

from homunculus.api.readings import reconcile

LINE = "VITAL_READINGS_BACKFILL"


def _refused(code: int, reason: str) -> int:
    print(f"{LINE}_RED {code} {reason}", file=sys.stderr)
    return code


def run(argv=None, *, audit=None, store=None) -> int:
    """`audit` and `store` are handed in by the tests; left out, they are the deployment's (DATABASE_URL)."""
    parser = argparse.ArgumentParser(prog="scripts/backfill_vital_readings.py",
                                     description="File the open stays' readings into vital_readings, once.")
    parser.add_argument("--tenant", default="", help="the tenant's slug")
    parser.add_argument("--open-only", action="store_true", help="the stays open now, each from its start (required)")
    parser.add_argument("--dry-run", action="store_true", help="count what would be filed, write nothing")
    args = parser.parse_args(argv)
    if not args.tenant.strip():
        return _refused(2, "--tenant gerekli")
    if not args.open_only:
        return _refused(2, "--open-only gerekli: kapanmış yatışların kaydı bu dilimde doldurulmaz")
    owned = []
    try:
        if audit is None or store is None:
            url = os.getenv("DATABASE_URL", "").strip()
            if not url.startswith("postgresql"):
                return _refused(2, "DATABASE_URL bir Postgres adresi değil")
            from homunculus.api.audit_postgres import PostgresAuditLog
            from homunculus.api.readings_postgres import PostgresReadingStore
            ssl = os.getenv("DATABASE_SSL", "").lower() in ("require", "true", "1")
            audit = PostgresAuditLog(url, ssl_required=ssl)
            store = PostgresReadingStore(url, ssl_required=ssl)
            owned = [(audit, "dispose"), (store, "close")]
        stays = store.open_stays(args.tenant)
        counts = reconcile(store, audit, tenant=args.tenant, now=datetime.now(timezone.utc), since=None,
                           stays=stays, dry_run=args.dry_run)
    except Exception as error:                      # the class only: a driver's message carries parameters
        return _refused(1, f"{type(error).__name__} — satırlar yazılmış olabilir; yeniden çalıştırın")
    finally:
        for resource, release in owned:
            getattr(resource, release)()
    print(LINE + " " + json.dumps({"tenant": args.tenant, "open_only": True, "dry_run": args.dry_run,
                                   "stays": len(stays), **counts}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(run())
```

- [ ] **Step 5: Run to see them pass**

Run: `cd /c/tmp/g3-cihaz-olcum/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_readings_reconcile.py tests/test_readings_api.py tests/test_readings_ingest.py tests/test_readings_unmatched.py 2>&1 | tail -3`
Expected: `122 passed` (27 + 53 + 22 + 20).

- [ ] **Step 6: `reconcile` on the real table (DB-backed)**

Append to the end of `homunculus-engine/tests/test_readings_postgres.py` (after line 186):

```python


def test_reconcile_files_voids_and_releases_on_the_real_table(migrated):
    """G3-05 (D7): the audit → table pass against Postgres — the `ON CONFLICT DO NOTHING` insert, the batch
    `have`, the conditional updates — and a second pass that does nothing."""
    from homunculus.api.audit import AuditEvent, InMemoryAuditLog
    from homunculus.api.clinical import RETRACT
    from homunculus.api.readings import CLAIM_STALE, READING_UNMATCHED, STATE_UNMATCHED, reconcile
    now = datetime.now(timezone.utc)
    when = now - timedelta(minutes=30)
    audit = InMemoryAuditLog()
    device = audit.append(AuditEvent("h1", "ingest", KEY, "sbp", {"value": 88.0, "unit": "mmHg", "obs_ts": when.isoformat(), "device": "CONNEX-3A"}))
    audit.append(AuditEvent("h1", "chart", KEY, "resp_rate", {"value": 16.0, "unit": "/min", "obs_ts": when.isoformat(), "charted_by": "hem.ayse"}))
    audit.append(AuditEvent("h1", READING_UNMATCHED, "202600000010", "spo2", {"value": 97.0, "unit": "%", "obs_ts": when.isoformat(), "device": "CONNEX-3A", "reason": "unknown"}))
    audit.append(AuditEvent("h1", RETRACT, KEY, "sbp", {"entry": device.id, "code": "sbp", "value": 88.0, "obs_ts": when.isoformat(),
                                                        "reason": "manşet yanlış koldaydı", "retracted_by": "hem.ayse"}))
    store = PostgresReadingStore(TEST_DATABASE_URL)
    try:
        counts = reconcile(store, audit, tenant="h1", now=now)
        assert (counts["recorded"], counts["unmatched"], counts["voided"]) == (2, 1, 1)
        rows = {r.code: r for r in store.for_patient("h1", KEY, since=when - timedelta(hours=1), until=now)}
        assert rows["sbp"].void_reason == "manşet yanlış koldaydı" and rows["resp_rate"].recorded_by == "hem.ayse"
        [waiting] = store.unmatched("h1", since=now - timedelta(days=7))
        store.claim("h1", [waiting.id], by="hem.ayse", at=now - CLAIM_STALE - timedelta(minutes=1))
        again = reconcile(store, audit, tenant="h1", now=now)
        assert again == {**dict.fromkeys(again, 0), "released": 1}
        assert store.get("h1", [waiting.id])[0].state == STATE_UNMATCHED
        assert not any(reconcile(store, audit, tenant="h1", now=now).values())
    finally:
        store.close()
```

Run (only with the throwaway Postgres of «Ground rules»): `cd /c/tmp/g3-cihaz-olcum/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:cihaz@127.0.0.1:56451/cihaz_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_readings_postgres.py 2>&1 | tail -3`
Expected: `32 passed`.

- [ ] **Step 7: Commit**

```bash
cd /c/tmp/g3-cihaz-olcum && git add -- homunculus-engine/tests/test_readings_reconcile.py homunculus-engine/src/homunculus/api/readings.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/scripts/backfill_vital_readings.py homunculus-engine/tests/test_readings_postgres.py && git commit -m "feat(readings): reconcile — the audit trail written into the table where it lacks it — and the open stays' backfill script (G3-05 D7, D19)" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>" -- homunculus-engine/tests/test_readings_reconcile.py homunculus-engine/src/homunculus/api/readings.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/scripts/backfill_vital_readings.py homunculus-engine/tests/test_readings_postgres.py
```

---

## The dashboard lane

### Task W1: The client calls, the words in four languages, the refusal codes — and, after B7, the audit labels and the withdrawal's sentence

**Files:**
- Test: `dashboard/src/backendApi.test.js` — after line 1944 (the end of the file) (as each step finds the file)
- Modify: `dashboard/src/backendApi.js` — lines 951–953 (as each step finds the file)
- Test: `dashboard/src/live/session/testTokens.testutil.js` — lines 81–82 (as each step finds the file)
- Test: `dashboard/src/live/data/boardStore.test.js` — line 361 (as each step finds the file)
- Modify: `dashboard/src/live/data/boardStore.js` — lines 465–471 (as each step finds the file)
- Test: `dashboard/src/live/i18n/kayit.strings.test.js` (new)
- Create: `dashboard/src/live/i18n/strings/kayit.js`
- Modify: `dashboard/src/live/i18n/catalog.js` — lines 93–94, lines 155–156 (as each step finds the file)
- Modify: `dashboard/src/live/i18n/strings/olcum.js` — line 97, line 187, line 277, line 367 (as each step finds the file)
- Test: `dashboard/src/live/i18n/strings.test.js` — lines 225–227 (as each step finds the file)
- Test: `dashboard/src/live/apiErrors.test.js` — after line 843 (the end of the file) (as each step finds the file)
- Modify: `dashboard/src/live/apiErrors.js` — lines 185–187, line 271, line 376, line 125 (as each step finds the file)
- Modify: `dashboard/src/live/screens/denetim/denetim.js` — line 75 (as each step finds the file)
- Modify: `dashboard/src/live/i18n/strings/denetim.js` — line 48, line 126, line 200, line 274 (as each step finds the file)
- Test: `dashboard/src/live/screens/denetim/denetim.test.js` — lines 165–166 (as each step finds the file)
- Modify: `dashboard/src/live/i18n/strings/errors.js` — line 80, line 190, line 299, line 408 (as each step finds the file)
- Test: `dashboard/src/live/screens/common/RetractDialog.test.jsx` — line 161, line 165 (as each step finds the file)

Two parts. **Part A** (Steps 1–8) depends on nothing but the «Interfaces» section and may start at once, in parallel with the engine lane. **Part B** (Steps 9–11) follows the engine: it is run **only after Task B7 is committed**, because the two tests it turns green read the engine's sources (`engineTypes.test.js` reads every `AuditEvent(…)` call; `apiErrors.test.js` reads `RETRACT_UNKNOWN` from `api/clinical.py`). The dev proxy's `/readings` line is Task B6's (it travels with nginx's line); this task only checks it.

#### Part A

- [ ] **Step 1: The four client calls — the failing test**

Append to the end of `dashboard/src/backendApi.test.js` (after line 1944):

```js

// G3-05 — Cihaz ölçüm kaydı: the patient's measurement record and the unmatched list (homunculus/api/readings.py)
describe("G3-05 Cihaz ölçüm kaydı calls", () => {
  it("reads a patient's record for a window, the unmatched list, and sends a link and a rejection", async () => {
    store.set("homunculus-access-token", "acc-1");
    store.set("homunculus-refresh-token", "ref-1");
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ ok: true })));
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
    await api.patientReadings("S 1/x");
    await api.patientReadings("202600000001", 168);
    await api.unmatchedReadings();
    await api.assignReadings([7, 8], "202600000001");
    await api.rejectReadings([9], "yanlış numara girilmiş");
    const calls = fetchMock.mock.calls.map(([url, init]) => [String(url), init.method ?? "GET"]);
    expect(calls).toEqual([
      ["/patients/S%201%2Fx/readings?hours=24", "GET"],
      ["/patients/202600000001/readings?hours=168", "GET"],
      ["/readings/unmatched", "GET"],
      ["/readings/unmatched/assign", "POST"],
      ["/readings/unmatched/reject", "POST"],
    ]);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer acc-1");
    // Numbers and ids travel in the body, never on the address (spec §4).
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({ readings: [7, 8], patient_id: "202600000001" });
    expect(JSON.parse(fetchMock.mock.calls[4][1].body)).toEqual({ readings: [9], reason: "yanlış numara girilmiş" });
  });
});
```

Run: `cd /c/tmp/g3-cihaz-olcum/dashboard && npx vitest run src/backendApi.test.js 2>&1 | tail -6`
Expected: `1 failed` — `api.patientReadings is not a function`.

- [ ] **Step 2: The calls, and their place in the test API**

In `dashboard/src/backendApi.js`, find (lines 951–953):

```js
    patientFluids(patientId) {
      return authed(`/patients/${seg(patientId)}/fluids`);
    },
```

Replace with:

```js
    patientFluids(patientId) {
      return authed(`/patients/${seg(patientId)}/fluids`);
    },

    /**
     * G3-05 «Ölçüm kaydı» (GET /patients/{id}/readings, `board.view`): what was measured in this stay and by what —
     * {patient_id, hours, since, until, sets: [{observed_at, received_at, received_late, origin, source, recorded_by,
     * readings: [{id, code, value, unit, origin, source, recorded_by, entry, voided}]}]}, the newest set first
     * (homunculus-engine api/readings.py `patient_readings`). `hours` is 24, 72 or 168; the API refuses any other.
     */
    patientReadings(patientId, hours = 24) {
      return authed(`/patients/${seg(patientId)}/readings?hours=${encodeURIComponent(hours)}`);
    },
    // G3-05 «Eşleşmeyen ölçümler» (`clinical.chart`, a person only). Refusals carry `err.apiCode`:
    // `reading_not_unmatched`, `reading_set_mixed`, `reading_too_old`, `reading_target_discharged`,
    // `reading_reason_length`. Numbers and ids travel in the body, never on the address.
    /** {count, sets: [{received_key, reason, source, observed_at, received_at, linkable, readings: [{id, code, value, unit}]}]} */
    unmatchedReadings() { return authed("/readings/unmatched"); },
    /** One set's readings linked to a patient → {assigned: [ids], patient_id, alerts: [kinds]} */
    assignReadings(readings, patientId) {
      return authed("/readings/unmatched/assign", { method: "POST", body: { readings, patient_id: patientId } });
    },
    /** One set's readings closed with a reason (10–200 characters) → {rejected: [ids]} */
    rejectReadings(readings, reason) {
      return authed("/readings/unmatched/reject", { method: "POST", body: { readings, reason } });
    },
```

In `dashboard/src/live/session/testTokens.testutil.js`, find (lines 81–82):

```js
    // G3-03: Sıvı dengesi — the patient screen's fluid box (screens/patient/fluids)
    patientFluids: vi.fn(),
```

Replace with:

```js
    // G3-03: Sıvı dengesi — the patient screen's fluid box (screens/patient/fluids)
    patientFluids: vi.fn(),

    // G3-05: Cihaz ölçüm kaydı — the patient's record box and the unmatched list (screens/patient/readings, bedside)
    patientReadings: vi.fn(),
    unmatchedReadings: vi.fn(),
    assignReadings: vi.fn(),
    rejectReadings: vi.fn(),
```

Run: `cd /c/tmp/g3-cihaz-olcum/dashboard && npx vitest run src/backendApi.test.js 2>&1 | tail -6`
Expected: no failure (`146 passed`).

- [ ] **Step 3: The board store's two writes — the failing test**

A link changes a card (the engine took the readings), so the board reloads after it, as after a chart; a rejection changes no card.

In `dashboard/src/live/data/boardStore.test.js`, find (line 361):

```js
  // G3-01 (D10), review of Task 8: the engine's refusal of a withdrawal (here «already withdrawn», a 409) reaches the
```

Replace with:

```js
  // G3-05 (D12): a linked set entered the engine, so the card changed and the board reloads; a rejected one changed
  // no card. A refusal reaches the caller as the API's own error and nothing is reloaded.
  it("links an unmatched set and reloads, rejects one without reloading, and passes a refusal on", async () => {
    const { api, store } = setup();
    api.assignReadings = vi.fn().mockResolvedValue({ assigned: [7, 8], patient_id: "S-001", alerts: [] });
    api.rejectReadings = vi.fn().mockResolvedValue({ rejected: [9] });
    expect(await store.assignReadings([7, 8], "S-001")).toMatchObject({ assigned: [7, 8] });
    expect(api.assignReadings).toHaveBeenLastCalledWith([7, 8], "S-001");
    expect(api.boardPatients).toHaveBeenCalledTimes(1);
    expect(await store.rejectReadings([9], "yanlış numara girilmiş")).toEqual({ rejected: [9] });
    expect(api.rejectReadings).toHaveBeenLastCalledWith([9], "yanlış numara girilmiş");
    expect(api.boardPatients).toHaveBeenCalledTimes(1);                // no reload after a rejection
    const refused = Object.assign(new Error("x"), { status: 409, apiCode: "reading_not_unmatched" });
    api.assignReadings.mockRejectedValue(refused);
    await expect(store.assignReadings([7], "S-001")).rejects.toBe(refused);
    expect(api.boardPatients).toHaveBeenCalledTimes(1);                // … nor after a refusal
  });

  // G3-01 (D10), review of Task 8: the engine's refusal of a withdrawal (here «already withdrawn», a 409) reaches the
```

Run: `cd /c/tmp/g3-cihaz-olcum/dashboard && npx vitest run src/live/data/boardStore.test.js 2>&1 | tail -6`
Expected: `1 failed` — `store.assignReadings is not a function`.

- [ ] **Step 4: The two writes**

In `dashboard/src/live/data/boardStore.js`, find (lines 465–471):

```js
    async retract(patientId, entry, reason) {
      const mine = generation;
      const answer = await track(() => api.retractEntry(patientId, entry, reason));
      if (mine !== generation) return null;
      await refresh();
      return answer;
    },
```

Replace with:

```js
    async retract(patientId, entry, reason) {
      const mine = generation;
      const answer = await track(() => api.retractEntry(patientId, entry, reason));
      if (mine !== generation) return null;
      await refresh();
      return answer;
    },
    // G3-05 (D12): one unmatched set linked to a patient. The engine took each reading at its own time, so the
    // patient's card changed (and may carry a new alarm): the board reloads, as after a chart. A refusal rejects
    // with the API's own error (`err.apiCode`), having changed nothing here.
    async assignReadings(readings, patientId) {
      const mine = generation;
      const answer = await track(() => api.assignReadings(readings, patientId));
      if (mine !== generation) return null;
      await refresh();
      return answer;
    },
    // G3-05 (D10): one unmatched set rejected. Nothing reached the engine and no card changed: no reload.
    async rejectReadings(readings, reason) {
      const mine = generation;
      const answer = await track(() => api.rejectReadings(readings, reason));
      return mine === generation ? answer : null;
    },
```

Run: `cd /c/tmp/g3-cihaz-olcum/dashboard && npx vitest run src/live/data/boardStore.test.js 2>&1 | tail -6`
Expected: no failure.

- [ ] **Step 5: The words — the failing test**

Create `dashboard/src/live/i18n/kayit.strings.test.js`:

```js
// G3-05 «Cihaz ölçüm kaydı» (spec D13, D16, D17, Q1–Q4): the words of the patient screen's «Ölçüm kaydı» box, the
// «Düzelt» dialog and the bedside page's «Eşleşmeyen ölçümler» step (strings/kayit.js), and the two words the trend
// table gains (strings/olcum.js). What every language must keep: a value is never lost — a withdrawn one stays,
// struck through, with its reason; a rejected or unmatched one keeps its value; the screens give no order.
import { describe, it, expect } from "vitest";
import { DICTIONARIES } from "./catalog.js";
import { LANG_CODES } from "./langs.js";

const fill = (template, vars) => template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name]));
const kayit = (lang) => Object.entries(DICTIONARIES[lang]).filter(([key]) => key.startsWith("kayit."));

describe("the measurement record's words (kayit)", () => {
  // The sweeps below read every key of the namespace: on an empty namespace they would pass having read nothing.
  it("has its 72 keys in every language", () => {
    for (const lang of LANG_CODES) expect(kayit(lang), lang).toHaveLength(72);
  });

  it("says the spec's Turkish for the box, the two sources and the list", () => {
    const tr = DICTIONARIES.tr;
    expect(tr["kayit.title"]).toBe("Ölçüm kaydı");
    expect(fill(tr["kayit.sourceDevice"], { device: "CONNEX-3A" })).toBe("cihaz · CONNEX-3A");
    expect(fill(tr["kayit.sourceHand"], { user: "hem.ayse" })).toBe("elle · hem.ayse");
    expect(fill(tr["kayit.received"], { time: "09:40" })).toBe("alındı 09:40");
    expect(tr["kayit.correct"]).toBe("Düzelt");
    expect(tr["kayit.umTitle"]).toBe("Eşleşmeyen ölçümler");
    expect(tr["kayit.umReasonDischarged"]).toBe("taburcu edilmiş hastanın numarası");
    expect([tr["kayit.w24"], tr["kayit.w72"], tr["kayit.w168"]]).toEqual(["24 saat", "72 saat", "7 gün"]);
    expect([tr["olcum.device"], tr["olcum.hand"]]).toEqual(["cihaz", "elle"]);
  });

  it("the correction says the wrong value stays, struck through, and the right one is written by hand at that time", () => {
    const STAYS = { tr: "üstü çizili", az: "üstündən xətt çəkilmiş", ru: "зачёркнутым", en: "struck through" };
    const BY_HAND = { tr: "«elle»", az: "«əl ilə»", ru: "«вручную»", en: "“by hand”" };
    for (const lang of LANG_CODES) {
      expect(DICTIONARIES[lang]["kayit.correctIntro"], lang).toContain(STAYS[lang]);
      expect(DICTIONARIES[lang]["kayit.correctIntro"], lang).toContain(BY_HAND[lang]);
    }
  });

  it("a partial correction says which half happened", () => {
    for (const lang of LANG_CODES) {
      const said = fill(DICTIONARIES[lang]["kayit.correctPartial"], { subject: "REA-01 · 2", reason: "x" });
      expect(said.startsWith("REA-01 · 2: "), `${lang}: ${said}`).toBe(true);
      expect(said, lang).toContain("x");
    }
    expect(DICTIONARIES.tr["kayit.correctPartial"]).toContain("yanlış değer işaretlendi");
    expect(DICTIONARIES.tr["kayit.correctPartial"]).toContain("doğru değer kaydedilmedi");
  });

  it("the list says the values are not lost, and a rejection says they are kept", () => {
    const KEPT = { tr: "kaybolmadı", az: "itməyib", ru: "не потеряны", en: "are not lost" };
    const STAY = { tr: "kayıtta kalır", az: "qeyddə qalır", ru: "остаются в записи", en: "stay in the record" };
    for (const lang of LANG_CODES) {
      expect(DICTIONARIES[lang]["kayit.umIntro"], lang).toContain(KEPT[lang]);
      expect(DICTIONARIES[lang]["kayit.umRejectIntro"], lang).toContain(STAY[lang]);
    }
  });

  it("every refusal and every toast names its subject first", () => {
    const named = ["correctDone", "correctWithdrawn", "correctPartial", "correctRefused", "correctMayHaveLanded",
      "umLinked", "umLinkRefused", "umLinkMayHaveLanded", "umRejected", "umRejectRefused"];
    for (const lang of LANG_CODES) {
      for (const key of named) expect(DICTIONARIES[lang][`kayit.${key}`], `${lang} ${key}`).toMatch(/^\{subject\}: /);
    }
  });

  // Hard rule 5: the screens describe and record; they never tell a clinician what to do to a patient.
  it("gives no order and suggests no treatment", () => {
    const ORDER = /\b(verin|uygulayın|başlayın|verilməlidir|назначьте|введите препарат|administer|start (?:the )?(?:drug|treatment))\b/i;
    for (const lang of LANG_CODES) {
      for (const [key, text] of kayit(lang)) expect(text, `${lang} ${key}`).not.toMatch(ORDER);
    }
  });

  it("the unmatched list's refusals have their texts by code", () => {
    for (const lang of LANG_CODES) {
      for (const key of ["notUnmatched", "setMixed", "tooOld", "targetDischarged", "reasonLength", "hours", "person"]) {
        expect(DICTIONARIES[lang][`kayit.err.${key}`], `${lang} ${key}`).toBeTruthy();
      }
    }
  });
});
```

Run: `cd /c/tmp/g3-cihaz-olcum/dashboard && npx vitest run src/live/i18n/kayit.strings.test.js 2>&1 | tail -6`
Expected: every test fails (the namespace does not exist: 0 keys).

- [ ] **Step 6: The namespace, in four languages**

Create `dashboard/src/live/i18n/strings/kayit.js`:

```js
// src/live/i18n/strings/kayit.js — G3-05 «Cihaz ölçüm kaydı»: the patient screen's «Ölçüm kaydı» box
// (screens/patient/readings/ReadingsBox.jsx), the «Düzelt» dialog (CorrectDialog.jsx), and the bedside page's
// «Eşleşmeyen ölçümler» step with the rail's badge (screens/bedside/UnmatchedStep.jsx, shell/Sidebar.jsx).
// What every language must keep:
//   - a measured value is never lost: a withdrawn one stays, struck through, with its reason; an unmatched or a
//     rejected one keeps its value (spec D4, D13, Q3);
//   - the corrected value is a hand entry at the reading's own time, and the screen says «elle» (Q3);
//   - a refusal and a toast name their subject first ({subject}: the bed, or the number as it was typed on the
//     device — never a patient's name);
//   - no text gives an order: the screens record and describe (hard rule 5).
// Channel names and units are the board's (board.ch*, board.unit*). TR is the source. AZ, RU and EN await a native
// reading after the deploy (spec O4). Russian calls the engine «система».
export default {
  tr: {
    title: "Ölçüm kaydı",
    intro: "Bu yatışta ölçülen değerler ve kaynağı: cihazdan gelen ya da elle girilen. Hatalı bir değer «Düzelt» ile işaretlenir; kayıtta üstü çizili kalır.",
    windowLabel: "Dönem",
    w24: "24 saat", w72: "72 saat", w168: "7 gün",
    reading: "Ölçüm kaydı okunuyor…",
    readFailed: "Ölçüm kaydı okunamadı: {reason}",
    empty: "Bu dönemde ölçüm kaydı yok.",
    sourceDevice: "cihaz · {device}",
    sourceDeviceUnnamed: "cihaz",
    sourceHand: "elle · {user}",
    sourceHandUnnamed: "elle",
    received: "alındı {time}",
    voided: "hatalı giriş — {reason} · {who} · {time}",
    voidedShort: "hatalı giriş olarak işaretlendi",
    correct: "Düzelt",
    correctTitle: "Düzelt · {bed}",
    correctWhat: "{label}: {value} · ölçüm {time} · {source}",
    correctIntro: "Yanlış değer bütün skorlardan ve uyarılardan çıkar; kayıtta üstü çizili, gerekçesiyle kalır. Doğru değeri girerseniz aynı ölçüm saatine «elle» olarak yazılır. İşlem denetim kaydına yazılır. Gerekçeye hasta adı ya da numarası yazmayın.",
    correctReason: "Gerekçe",
    correctCount: "{count} / {min} karakter",
    correctValue: "Doğru değer · {label}",
    correctValueHint: "Boş bırakırsanız yalnız yanlış değer işaretlenir.",
    correctTooOld: "Ölçüm 24 saatten eski: doğru değer buradan girilemez; yalnız yanlış değer işaretlenir.",
    correctConfirm: "Düzelt",
    correctDone: "{subject}: {label} düzeltildi.",
    correctWithdrawn: "{subject}: {label} hatalı giriş olarak işaretlendi.",
    correctPartial: "{subject}: yanlış değer işaretlendi, ama doğru değer kaydedilmedi — {reason}. Doğru değeri «Ölçüm gir» ile girin.",
    correctRefused: "{subject}: düzeltilmedi — {reason}",
    correctMayHaveLanded: "{subject}: yanıt gelmedi — işaretlenmiş olabilir. Ölçüm kaydına bakın.",
    noRight: "ölçüm düzeltme yetkiniz yok",
    saving: "Kaydediliyor…",
    umOpen: "Eşleşmeyen ölçümler",
    umOpenCount: "Eşleşmeyen ölçümler · {count}",
    umTitle: "Eşleşmeyen ölçümler",
    umIntro: "Cihaza girilen numara hiçbir yatışla eşleşmedi ya da hasta taburcu edilmişti. Değerler kaybolmadı: doğru hastaya bağlayın ya da gerekçesiyle reddedin.",
    umEmpty: "Bekleyen eşleşmeyen ölçüm yok.",
    umReading: "Liste okunuyor…",
    umReadFailed: "Eşleşmeyen ölçümler okunamadı: {reason}",
    umNumber: "Girilen numara {number}",
    umReasonUnknown: "numara hiçbir yatışla eşleşmedi",
    umReasonDischarged: "taburcu edilmiş hastanın numarası",
    umMeasured: "ölçüm {time}",
    umDevice: "cihaz {device}",
    umLink: "Hastaya bağla",
    umReject: "Reddet",
    umTooOld: "24 saatten eski: bağlanamaz, yalnız reddedilir.",
    umPickTitle: "Bu ölçüm hangi hastanın?",
    umConfirmTitle: "Bağlamayı doğrulayın",
    umConfirmAsk: "Bu ölçüm bu hastaya mı ait? Soyad ad ve doğum yılı hastayla eşleşiyor mu?",
    umConfirmYes: "Evet, bağla",
    umConfirmNo: "Hayır, vazgeç",
    umLinking: "Bağlanıyor…",
    umLinked: "{subject}: ölçüm hastaya bağlandı.",
    umLinkRefused: "{subject}: bağlanmadı — {reason}",
    umLinkMayHaveLanded: "{subject}: yanıt gelmedi — bağlanmış olabilir. Listeye ve hasta ekranına bakın.",
    umRejectTitle: "Ölçümü reddet · {number}",
    umRejectIntro: "Ölçüm hiçbir hastaya bağlanmaz; değerleri ve gerekçeniz kayıtta kalır. İşlem denetim kaydına yazılır. Gerekçeye hasta adı yazmayın.",
    umRejectConfirm: "Reddet",
    umRejected: "{subject}: ölçüm reddedildi.",
    umRejectRefused: "{subject}: reddedilmedi — {reason}",
    umBack: "Geri",
    umSubject: "Numara {number}",
    badgeCount: "{count} eşleşmeyen ölçüm",
    err: {
      notUnmatched: "Bu ölçüm artık beklemiyor: bağlanmış ya da reddedilmiş.",
      setMixed: "Seçilen değerler tek bir ölçüm seti değil.",
      tooOld: "24 saatten eski bir ölçüm bağlanamaz; yalnız reddedilebilir.",
      targetDischarged: "Hasta taburcu edilmiş: ölçüm kapanmış bir yatışa bağlanamaz.",
      reasonLength: "Gerekçe 10–200 karakter olmalı.",
      hours: "Dönem 24 saat, 72 saat ya da 7 gün olmalı.",
      person: "Bu işi bir kişi yapar; bu kimlik bir kişiyi göstermiyor.",
    },
  },
  az: {
    title: "Ölçmə qeydi",
    intro: "Bu yatışda ölçülmüş dəyərlər və mənbəyi: cihazdan gələn və ya əl ilə daxil edilən. Səhv dəyər «Düzəlt» ilə işarələnir; qeyddə üstündən xətt çəkilmiş qalır.",
    windowLabel: "Dövr",
    w24: "24 saat", w72: "72 saat", w168: "7 gün",
    reading: "Ölçmə qeydi oxunur…",
    readFailed: "Ölçmə qeydi oxunmadı: {reason}",
    empty: "Bu dövrdə ölçmə qeydi yoxdur.",
    sourceDevice: "cihazdan · {device}",
    sourceDeviceUnnamed: "cihazdan",
    sourceHand: "əl ilə · {user}",
    sourceHandUnnamed: "əl ilə",
    received: "qəbul edildi {time}",
    voided: "səhv qeyd — {reason} · {who} · {time}",
    voidedShort: "səhv qeyd kimi işarələnib",
    correct: "Düzəlt",
    correctTitle: "Düzəlt · {bed}",
    correctWhat: "{label}: {value} · ölçmə {time} · {source}",
    correctIntro: "Səhv dəyər bütün skorlardan və xəbərdarlıqlardan çıxır; qeyddə üstündən xətt çəkilmiş, səbəbi ilə qalır. Düzgün dəyəri daxil etsəniz, eyni ölçmə vaxtına «əl ilə» yazılır. Əməliyyat audit qeydinə yazılır. Səbəbə xəstənin adını və ya nömrəsini yazmayın.",
    correctReason: "Səbəb",
    correctCount: "{count} / {min} simvol",
    correctValue: "Düzgün dəyər · {label}",
    correctValueHint: "Boş saxlasanız, yalnız səhv dəyər işarələnir.",
    correctTooOld: "Ölçmə 24 saatdan köhnədir: düzgün dəyər buradan daxil edilə bilməz; yalnız səhv dəyər işarələnir.",
    correctConfirm: "Düzəlt",
    correctDone: "{subject}: {label} düzəldildi.",
    correctWithdrawn: "{subject}: {label} səhv qeyd kimi işarələndi.",
    correctPartial: "{subject}: səhv dəyər işarələndi, lakin düzgün dəyər yazılmadı — {reason}. Düzgün dəyəri «Ölçmə daxil et» ilə yazın.",
    correctRefused: "{subject}: düzəldilmədi — {reason}",
    correctMayHaveLanded: "{subject}: cavab gəlmədi — işarələnmiş ola bilər. Ölçmə qeydinə baxın.",
    noRight: "ölçməni düzəltmək hüququnuz yoxdur",
    saving: "Yadda saxlanılır…",
    umOpen: "Uyğunlaşmayan ölçmələr",
    umOpenCount: "Uyğunlaşmayan ölçmələr · {count}",
    umTitle: "Uyğunlaşmayan ölçmələr",
    umIntro: "Cihaza daxil edilən nömrə heç bir yatışla uyğun gəlməyib və ya xəstə evə yazılıb. Dəyərlər itməyib: düzgün xəstəyə bağlayın və ya səbəbi ilə rədd edin.",
    umEmpty: "Gözləyən uyğunlaşmayan ölçmə yoxdur.",
    umReading: "Siyahı oxunur…",
    umReadFailed: "Uyğunlaşmayan ölçmələr oxunmadı: {reason}",
    umNumber: "Daxil edilən nömrə {number}",
    umReasonUnknown: "nömrə heç bir yatışla uyğun gəlmədi",
    umReasonDischarged: "evə yazılmış xəstənin nömrəsi",
    umMeasured: "ölçmə {time}",
    umDevice: "cihaz: {device}",
    umLink: "Xəstəyə bağla",
    umReject: "Rədd et",
    umTooOld: "24 saatdan köhnədir: bağlana bilməz, yalnız rədd edilir.",
    umPickTitle: "Bu ölçmə hansı xəstənindir?",
    umConfirmTitle: "Bağlamanı təsdiqləyin",
    umConfirmAsk: "Bu ölçmə bu xəstəyə aiddirmi? Soyad, ad və doğum ili xəstə ilə uyğun gəlirmi?",
    umConfirmYes: "Bəli, bağla",
    umConfirmNo: "Xeyr, imtina",
    umLinking: "Bağlanır…",
    umLinked: "{subject}: ölçmə xəstəyə bağlandı.",
    umLinkRefused: "{subject}: xəstəyə bağlanmadı — {reason}",
    umLinkMayHaveLanded: "{subject}: cavab gəlmədi — bağlanmış ola bilər. Siyahıya və xəstə ekranına baxın.",
    umRejectTitle: "Ölçməni rədd et · {number}",
    umRejectIntro: "Ölçmə heç bir xəstəyə bağlanmır; dəyərləri və səbəbiniz qeyddə qalır. Əməliyyat audit qeydinə yazılır. Səbəbə xəstənin adını yazmayın.",
    umRejectConfirm: "Rədd et",
    umRejected: "{subject}: ölçmə rədd edildi.",
    umRejectRefused: "{subject}: rədd edilmədi — {reason}",
    umBack: "Geriyə",
    umSubject: "Nömrə {number}",
    badgeCount: "{count} uyğunlaşmayan ölçmə",
    err: {
      notUnmatched: "Bu ölçmə artıq gözləmir: bağlanıb və ya rədd edilib.",
      setMixed: "Seçilən dəyərlər bir ölçmə dəsti deyil.",
      tooOld: "24 saatdan köhnə ölçmə bağlana bilməz; yalnız rədd edilə bilər.",
      targetDischarged: "Xəstə evə yazılıb: ölçmə bağlanmış yatışa bağlana bilməz.",
      reasonLength: "Səbəb 10–200 simvol olmalıdır.",
      hours: "Dövr 24 saat, 72 saat və ya 7 gün olmalıdır.",
      person: "Bu işi bir şəxs görür; bu kimlik bir şəxsi göstərmir.",
    },
  },
  ru: {
    title: "Запись измерений",
    intro: "Значения, измеренные за эту госпитализацию, и их источник: с прибора или введённые вручную. Ошибочное значение отмечается кнопкой «Исправить»; в записи оно остаётся зачёркнутым.",
    windowLabel: "Период",
    w24: "24 часа", w72: "72 часа", w168: "7 дней",
    reading: "Запись измерений читается…",
    readFailed: "Запись измерений не прочитана: {reason}",
    empty: "За этот период измерений в записи нет.",
    sourceDevice: "прибор · {device}",
    sourceDeviceUnnamed: "прибор",
    sourceHand: "вручную · {user}",
    sourceHandUnnamed: "вручную",
    received: "получено {time}",
    voided: "ошибочная запись — {reason} · {who} · {time}",
    voidedShort: "отмечено как ошибочная запись",
    correct: "Исправить",
    correctTitle: "Исправить · {bed}",
    correctWhat: "{label}: {value} · измерено {time} · {source}",
    correctIntro: "Ошибочное значение исключается из всех шкал и предупреждений; в записи оно остаётся зачёркнутым, с причиной. Если вы введёте верное значение, оно записывается на то же время измерения как «вручную». Действие вносится в журнал аудита. Не указывайте в причине имя или номер пациента.",
    correctReason: "Причина",
    correctCount: "{count} / {min} знаков",
    correctValue: "Верное значение · {label}",
    correctValueHint: "Если оставить пустым, будет отмечено только ошибочное значение.",
    correctTooOld: "Измерению больше 24 часов: верное значение здесь ввести нельзя; отмечается только ошибочное.",
    correctConfirm: "Исправить",
    correctDone: "{subject}: {label} исправлено.",
    correctWithdrawn: "{subject}: {label} отмечено как ошибочная запись.",
    correctPartial: "{subject}: ошибочное значение отмечено, но верное значение не записано — {reason}. Введите верное значение через «Ввести измерение».",
    correctRefused: "{subject}: не исправлено — {reason}",
    correctMayHaveLanded: "{subject}: ответ не получен — возможно, отмечено. Проверьте запись измерений.",
    noRight: "у вас нет права исправлять измерения",
    saving: "Сохраняется…",
    umOpen: "Несопоставленные измерения",
    umOpenCount: "Несопоставленные измерения · {count}",
    umTitle: "Несопоставленные измерения",
    umIntro: "Номер, введённый на приборе, не совпал ни с одной госпитализацией, либо пациент уже выписан. Значения не потеряны: привяжите их к нужному пациенту или отклоните с причиной.",
    umEmpty: "Несопоставленных измерений в ожидании нет.",
    umReading: "Список читается…",
    umReadFailed: "Несопоставленные измерения не прочитаны: {reason}",
    umNumber: "Введённый номер {number}",
    umReasonUnknown: "номер не совпал ни с одной госпитализацией",
    umReasonDischarged: "номер выписанного пациента",
    umMeasured: "измерено {time}",
    umDevice: "прибор {device}",
    umLink: "Привязать к пациенту",
    umReject: "Отклонить",
    umTooOld: "Больше 24 часов: привязать нельзя, можно только отклонить.",
    umPickTitle: "Какому пациенту принадлежит это измерение?",
    umConfirmTitle: "Подтвердите привязку",
    umConfirmAsk: "Это измерение принадлежит этому пациенту? Фамилия, имя и год рождения совпадают с пациентом?",
    umConfirmYes: "Да, привязать",
    umConfirmNo: "Нет, отмена",
    umLinking: "Привязывается…",
    umLinked: "{subject}: измерение привязано к пациенту.",
    umLinkRefused: "{subject}: не привязано — {reason}",
    umLinkMayHaveLanded: "{subject}: ответ не получен — возможно, привязано. Проверьте список и экран пациента.",
    umRejectTitle: "Отклонить измерение · {number}",
    umRejectIntro: "Измерение не привязывается ни к одному пациенту; его значения и ваша причина остаются в записи. Действие вносится в журнал аудита. Не указывайте в причине имя пациента.",
    umRejectConfirm: "Отклонить",
    umRejected: "{subject}: измерение отклонено.",
    umRejectRefused: "{subject}: не отклонено — {reason}",
    umBack: "Назад",
    umSubject: "Номер {number}",
    badgeCount: "несопоставленных измерений: {count}",
    err: {
      notUnmatched: "Это измерение уже не ожидает: оно привязано или отклонено.",
      setMixed: "Выбранные значения не составляют один набор измерений.",
      tooOld: "Измерение старше 24 часов привязать нельзя; его можно только отклонить.",
      targetDischarged: "Пациент выписан: измерение нельзя привязать к закрытой госпитализации.",
      reasonLength: "Причина — от 10 до 200 знаков.",
      hours: "Период — 24 часа, 72 часа или 7 дней.",
      person: "Это действие выполняет человек; эта учётная запись не указывает на человека.",
    },
  },
  en: {
    title: "Measurement record",
    intro: "The values measured in this stay and their source: sent by a device or entered by hand. A wrong value is marked with “Correct”; it stays in the record, struck through.",
    windowLabel: "Period",
    w24: "24 hours", w72: "72 hours", w168: "7 days",
    reading: "Reading the measurement record…",
    readFailed: "The measurement record could not be read: {reason}",
    empty: "No measurement in the record for this period.",
    sourceDevice: "device · {device}",
    sourceDeviceUnnamed: "device",
    sourceHand: "by hand · {user}",
    sourceHandUnnamed: "by hand",
    received: "received {time}",
    voided: "entered in error — {reason} · {who} · {time}",
    voidedShort: "marked as entered in error",
    correct: "Correct",
    correctTitle: "Correct · {bed}",
    correctWhat: "{label}: {value} · measured {time} · {source}",
    correctIntro: "The wrong value leaves every score and alert; it stays in the record struck through, with its reason. If you enter the right value, it is written at the same measurement time as “by hand”. The act is written to the audit trail. Do not write a patient's name or number in the reason.",
    correctReason: "Reason",
    correctCount: "{count} / {min} characters",
    correctValue: "Right value · {label}",
    correctValueHint: "Left empty, only the wrong value is marked.",
    correctTooOld: "The measurement is older than 24 hours: the right value cannot be entered here; only the wrong value is marked.",
    correctConfirm: "Correct",
    correctDone: "{subject}: {label} corrected.",
    correctWithdrawn: "{subject}: {label} marked as entered in error.",
    correctPartial: "{subject}: the wrong value was marked, but the right value was not saved — {reason}. Enter the right value with “Enter measurement”.",
    correctRefused: "{subject}: not corrected — {reason}",
    correctMayHaveLanded: "{subject}: no answer — it may have been marked. Check the measurement record.",
    noRight: "you may not correct measurements",
    saving: "Saving…",
    umOpen: "Unmatched readings",
    umOpenCount: "Unmatched readings · {count}",
    umTitle: "Unmatched readings",
    umIntro: "The number typed on the device matched no stay, or the patient had been discharged. The values are not lost: link them to the right patient, or reject them with a reason.",
    umEmpty: "No unmatched reading is waiting.",
    umReading: "Reading the list…",
    umReadFailed: "The unmatched readings could not be read: {reason}",
    umNumber: "Number as typed {number}",
    umReasonUnknown: "the number matched no stay",
    umReasonDischarged: "a discharged patient's number",
    umMeasured: "measured {time}",
    umDevice: "device {device}",
    umLink: "Link to a patient",
    umReject: "Reject",
    umTooOld: "Older than 24 hours: it cannot be linked, only rejected.",
    umPickTitle: "Whose measurement is this?",
    umConfirmTitle: "Confirm the link",
    umConfirmAsk: "Does this measurement belong to this patient? Do the surname, name and year of birth match the patient?",
    umConfirmYes: "Yes, link",
    umConfirmNo: "No, cancel",
    umLinking: "Linking…",
    umLinked: "{subject}: the measurement was linked to the patient.",
    umLinkRefused: "{subject}: not linked — {reason}",
    umLinkMayHaveLanded: "{subject}: no answer — it may have been linked. Check the list and the patient screen.",
    umRejectTitle: "Reject the measurement · {number}",
    umRejectIntro: "The measurement is linked to no patient; its values and your reason stay in the record. The act is written to the audit trail. Do not write a patient's name in the reason.",
    umRejectConfirm: "Reject",
    umRejected: "{subject}: the measurement was rejected.",
    umRejectRefused: "{subject}: not rejected — {reason}",
    umBack: "Back",
    umSubject: "Number {number}",
    badgeCount: "{count} unmatched readings",
    err: {
      notUnmatched: "This reading is no longer waiting: it was linked or rejected.",
      setMixed: "The chosen values are not one measurement set.",
      tooOld: "A reading older than 24 hours cannot be linked; it can only be rejected.",
      targetDischarged: "The patient is discharged: a reading cannot be linked to a closed stay.",
      reasonLength: "The reason is 10–200 characters.",
      hours: "The period is 24 hours, 72 hours or 7 days.",
      person: "A person does this; this credential names no person.",
    },
  },
};
```

In `dashboard/src/live/i18n/catalog.js`, find (lines 93–94):

```js
// G3-04: «Eczane» — the pharmacist's ward page (screens/eczane).
import eczane from "./strings/eczane.js";
```

Replace with:

```js
// G3-04: «Eczane» — the pharmacist's ward page (screens/eczane).
import eczane from "./strings/eczane.js";

// G3-05: «Cihaz ölçüm kaydı» — the record box, «Düzelt», the unmatched list (screens/patient/readings, bedside).
import kayit from "./strings/kayit.js";
```

In the same file, find (lines 155–156):

```js
  eczane, // G3-04
};
```

Replace with:

```js
  eczane, // G3-04

  kayit, // G3-05
};
```

The trend table's two new words go beside «elle», in `olcum` (one edit per language):

In `dashboard/src/live/i18n/strings/olcum.js`, find (line 97):

```js
    hand: "elle",
```

Replace with:

```js
    hand: "elle",
    device: "cihaz",                         // G3-05 (D16): a reading a device sent, in the trend table
```

In the same file, find (line 187):

```js
    hand: "əl ilə",
```

Replace with:

```js
    hand: "əl ilə",
    device: "cihazdan",
```

In the same file, find (line 277):

```js
    hand: "вручную",
```

Replace with:

```js
    hand: "вручную",
    device: "прибор",
```

In the same file, find (line 367):

```js
    hand: "by hand",
```

Replace with:

```js
    hand: "by hand",
    device: "device",
```

Three of the new Azerbaijani texts equal their Turkish source and are reviewed as such («saat» and «gün» are Azerbaijani words too, as G4-02's periods): list them, under this slice's own heading.

In `dashboard/src/live/i18n/strings.test.js`, find (lines 225–227):

```js
  // G3-04 (eczane) · az = tr
  "eczane.col.creatinine", //  Kreatinin — the same word in Azerbaijani (as patient.creatinine's first word)
  "eczane.fluid.balance", //   "{value} mL" — a number and the unit symbol (as sivi.ml)
```

Replace with:

```js
  // G3-04 (eczane) · az = tr
  "eczane.col.creatinine", //  Kreatinin — the same word in Azerbaijani (as patient.creatinine's first word)
  "eczane.fluid.balance", //   "{value} mL" — a number and the unit symbol (as sivi.ml)

  // G3-05 (kayit) · az = tr — «saat» (hour) and «gün» (day) are Azerbaijani words too (as ozet.period.*)
  "kayit.w24", "kayit.w72", "kayit.w168", //  24 saat · 72 saat · 7 gün
```

- [ ] **Step 7: Run the words**

Run: `cd /c/tmp/g3-cihaz-olcum/dashboard && npx vitest run src/live/i18n/kayit.strings.test.js src/live/i18n/strings.test.js 2>&1 | tail -6`
Expected: no failure — `kayit.strings.test.js` 8 passed, `strings.test.js` as before.

- [ ] **Step 8: The refusal codes — test, map, run, commit Part A**

Append to the end of `dashboard/src/live/apiErrors.test.js` (after line 843):

```js

// G3-05 — «Eşleşmeyen ölçümler» and «Ölçüm kaydı»: the readings' refusals, by code (err.apiCode) and by the server's words.
describe("the readings' refusals (G3-05)", () => {
  const CODES = ["reading_not_unmatched", "reading_set_mixed", "reading_too_old", "reading_target_discharged",
    "reading_reason_length", "reading_hours"];
  it("maps every coded refusal to its text in the four languages", () => {
    for (const code of CODES) {
      const hit = apiErrorKey(Object.assign(new Error("x"), { status: 409, apiCode: code }));
      expect(hit?.key, code).toMatch(/^kayit\.err\./);
      for (const lang of LANG_CODES) expect(DICTIONARIES[lang][hit.key], `${lang} ${hit.key}`).toBeTruthy();
    }
    expect(apiErrorKey(Object.assign(new Error("x"), { status: 409, apiCode: "reading_too_old" })).key).toBe("kayit.err.tooOld");
  });
  it("holds the codes to the engine's own (api/readings.py WORDS), read as text", () => {
    const source = py("api/readings.py");
    const block = /^WORDS = \{([^]*?)^\}/m.exec(source);
    const names = [...block[1].matchAll(/^\s*(READING_[A-Z_]+):/gm)].map((m) => m[1]);
    const codes = names.map((name) => new RegExp(`^${name} = "([a-z_]+)"`, "m").exec(source)[1]);
    expect(codes.sort()).toEqual([...CODES].sort());
  });
  it("says the person-only refusal in the reader's words", () => {
    const sentence = "a person links or rejects a reading: this credential names no actor";
    expect(py("api/readings.py")).toContain(`READING_NEEDS_PERSON = "${sentence}"`);
    expect(apiErrorKey(Object.assign(new Error(sentence), { status: 403 })).key).toBe("kayit.err.person");
  });
});
```

Run: `cd /c/tmp/g3-cihaz-olcum/dashboard && npx vitest run src/live/apiErrors.test.js 2>&1 | tail -8`
Expected: the three new tests fail (`expected undefined to match /^kayit\.err\./`); before Task B8 is committed the second fails on the missing `reading_hours`, and before Task B6 on the missing file — the map below is right either way, and the test is green once the engine lane has reached B8. (After Task B7 the file's own `RETRACT_UNKNOWN` test is red too: that is Part B's.)

In `dashboard/src/live/apiErrors.js`, find (lines 185–187):

```js
  ["görev bulunamadı", "gorevler.err.taskNotFound"],
  ["a person signs a task: this credential names no actor", "gorevler.err.person"],
]);
```

Replace with:

```js
  ["görev bulunamadı", "gorevler.err.taskNotFound"],
  ["a person signs a task: this credential names no actor", "gorevler.err.person"],
  // G3-05 — «Eşleşmeyen ölçümler»: homunculus/api/readings.py READING_NEEDS_PERSON (a 403 with no code).
  ["a person links or rejects a reading: this credential names no actor", "kayit.err.person"],
]);
```

In the same file, find (line 271):

```js
/** G2-B1d (E6): the same three sentences when the number is a protocol — twelve digits, the card
```

Replace with:

```js
/** G3-05 — «Eşleşmeyen ölçümler» and «Ölçüm kaydı» (homunculus/api/readings.py WORDS): the readings' refusals by
 *  their code (`err.apiCode`), as the task queue's. apiErrors.test.js holds the codes to the engine's. */
export const READING_CODE_KEYS = new Map([
  ["reading_not_unmatched", "kayit.err.notUnmatched"],
  ["reading_set_mixed", "kayit.err.setMixed"],
  ["reading_too_old", "kayit.err.tooOld"],
  ["reading_target_discharged", "kayit.err.targetDischarged"],
  ["reading_reason_length", "kayit.err.reasonLength"],
  ["reading_hours", "kayit.err.hours"],
]);

/** G2-B1d (E6): the same three sentences when the number is a protocol — twelve digits, the card
```

In the same file, find (line 376):

```js
  if (TASK_CODE_KEYS.has(code)) return { key: TASK_CODE_KEYS.get(code), vars: {} };
```

Replace with:

```js
  if (TASK_CODE_KEYS.has(code)) return { key: TASK_CODE_KEYS.get(code), vars: {} };
  if (READING_CODE_KEYS.has(code)) return { key: READING_CODE_KEYS.get(code), vars: {} };
```

Run: `cd /c/tmp/g3-cihaz-olcum/dashboard && npx vitest run src/live/apiErrors.test.js src/devProxy.test.js src/backendApi.test.js src/live/data/boardStore.test.js src/live/i18n/kayit.strings.test.js src/live/i18n/strings.test.js 2>&1 | tail -8`
Expected: with the engine lane at B8 or later, the only failure left is `api/clinical.py RETRACT_UNKNOWN` (Part B's, and only once B7 is committed); `devProxy.test.js` is green once B6 is committed (and before it).

```bash
cd /c/tmp/g3-cihaz-olcum && git add -- dashboard/src/backendApi.test.js dashboard/src/backendApi.js dashboard/src/live/session/testTokens.testutil.js dashboard/src/live/data/boardStore.test.js dashboard/src/live/data/boardStore.js dashboard/src/live/i18n/kayit.strings.test.js dashboard/src/live/i18n/strings/kayit.js dashboard/src/live/i18n/catalog.js dashboard/src/live/i18n/strings/olcum.js dashboard/src/live/i18n/strings.test.js dashboard/src/live/apiErrors.test.js dashboard/src/live/apiErrors.js && git commit -m "feat(dashboard): the readings' client calls, the kayit words in four languages, the refusal codes (G3-05 W1, part A)" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>" -- dashboard/src/backendApi.test.js dashboard/src/backendApi.js dashboard/src/live/session/testTokens.testutil.js dashboard/src/live/data/boardStore.test.js dashboard/src/live/data/boardStore.js dashboard/src/live/i18n/kayit.strings.test.js dashboard/src/live/i18n/strings/kayit.js dashboard/src/live/i18n/catalog.js dashboard/src/live/i18n/strings/olcum.js dashboard/src/live/i18n/strings.test.js dashboard/src/live/apiErrors.test.js dashboard/src/live/apiErrors.js
```

#### Part B — only after Task B7 is committed

- [ ] **Step 9: «Denetim» names the three new audit types**

Run first: `cd /c/tmp/g3-cihaz-olcum/dashboard && npx vitest run src/live/screens/denetim/engineTypes.test.js 2>&1 | tail -8`
Expected: `1 failed` — «names every type the engine writes»: `reading_unmatched`, `reading_assigned`, `reading_rejected`.

In `dashboard/src/live/screens/denetim/denetim.js`, find (line 75):

```js
  ["identity", "identity"], ["ingest", "ingest"], ["reading_dropped_discharged", "readingDropped"],
```

Replace with:

```js
  ["identity", "identity"], ["ingest", "ingest"], ["reading_dropped_discharged", "readingDropped"],
  // G3-05 (spec §4): a device reading that matched nobody (kept, with its value), and a set a person linked or rejected.
  ["reading_unmatched", "readingUnmatched"], ["reading_assigned", "readingAssigned"], ["reading_rejected", "readingRejected"],
```

In `dashboard/src/live/i18n/strings/denetim.js`, find (line 48):

```js
      identity: "Kimlik", ingest: "Ölçüm alındı", readingDropped: "Taburcu hastanın ölçümü atıldı",
```

Replace with:

```js
      identity: "Kimlik", ingest: "Ölçüm alındı", readingDropped: "Taburcu hastanın ölçümü atıldı",
      readingUnmatched: "Eşleşmeyen ölçüm listeye alındı", readingAssigned: "Eşleşmeyen ölçüm hastaya bağlandı",
      readingRejected: "Eşleşmeyen ölçüm reddedildi",
```

In the same file, find (line 126):

```js
      identity: "Şəxsiyyət", ingest: "Ölçmə qəbul edildi", readingDropped: "Evə yazılmış xəstənin ölçməsi atıldı",
```

Replace with:

```js
      identity: "Şəxsiyyət", ingest: "Ölçmə qəbul edildi", readingDropped: "Evə yazılmış xəstənin ölçməsi atıldı",
      readingUnmatched: "Uyğunlaşmayan ölçmə siyahıya alındı", readingAssigned: "Uyğunlaşmayan ölçmə xəstəyə bağlandı",
      readingRejected: "Uyğunlaşmayan ölçmə rədd edildi",
```

In the same file, find (line 200):

```js
      identity: "Идентификация", ingest: "Измерение получено", readingDropped: "Измерение выписанного пациента отброшено",
```

Replace with:

```js
      identity: "Идентификация", ingest: "Измерение получено", readingDropped: "Измерение выписанного пациента отброшено",
      readingUnmatched: "Несопоставленное измерение внесено в список", readingAssigned: "Несопоставленное измерение привязано к пациенту",
      readingRejected: "Несопоставленное измерение отклонено",
```

In the same file, find (line 274):

```js
      identity: "Identity", ingest: "Reading received", readingDropped: "Discharged patient's reading dropped",
```

Replace with:

```js
      identity: "Identity", ingest: "Reading received", readingDropped: "Discharged patient's reading dropped",
      readingUnmatched: "Unmatched reading listed", readingAssigned: "Unmatched reading linked to a patient",
      readingRejected: "Unmatched reading rejected",
```

In `dashboard/src/live/screens/denetim/denetim.test.js`, find (lines 165–166):

```js
    expect(EVENT_TYPES).toHaveLength(55);   // … + G2-B5b's alert_snooze + G2-B1c's three care-team events; + the follow-up's 14 (D3, engineTypes.test.js)
    expect(new Set(EVENT_TYPES.map((e) => e.code)).size).toBe(55);
```

Replace with:

```js
    expect(EVENT_TYPES).toHaveLength(58);   // … + G2-B5b's alert_snooze + G2-B1c's three care-team events; + the follow-up's 14 (D3, engineTypes.test.js); + G3-05's three
    expect(new Set(EVENT_TYPES.map((e) => e.code)).size).toBe(58);
    expect(typeKey("reading_unmatched")).toBe("denetim.type.readingUnmatched");   // G3-05 (spec §4)
    expect(typeKey("reading_assigned")).toBe("denetim.type.readingAssigned");
    expect(typeKey("reading_rejected")).toBe("denetim.type.readingRejected");
```

- [ ] **Step 10: The withdrawal's «no such value» sentence**

The engine's `RETRACT_UNKNOWN` no longer says «elle girilmiş» (Task B7): the entry may be a device reading.

In `dashboard/src/live/apiErrors.js`, find (line 125):

```js
  ["bu hastada böyle bir elle girilmiş değer yok", "retractUnknown"],
```

Replace with:

```js
  ["bu hastada böyle bir ölçüm değeri yok", "retractUnknown"],   // G3-05 (D13): a device reading can be withdrawn too
```

In `dashboard/src/live/i18n/strings/errors.js`, find (line 80):

```js
    retractUnknown: "Bu hastada böyle bir elle girilmiş değer yok.",
```

Replace with:

```js
    retractUnknown: "Bu hastada böyle bir ölçüm değeri yok.",
```

In the same file, find (line 190):

```js
    retractUnknown: "Bu xəstədə belə bir əl ilə daxil edilmiş dəyər yoxdur.",
```

Replace with:

```js
    retractUnknown: "Bu xəstədə belə bir ölçmə dəyəri yoxdur.",
```

In the same file, find (line 299):

```js
    retractUnknown: "У этого пациента нет такого значения, введённого вручную.",
```

Replace with:

```js
    retractUnknown: "У этого пациента нет такого измеренного значения.",
```

In the same file, find (line 408):

```js
    retractUnknown: "This patient has no such hand-entered value.",
```

Replace with:

```js
    retractUnknown: "This patient has no such measured value.",
```

In `dashboard/src/live/screens/common/RetractDialog.test.jsx`, find (line 161):

```jsx
    const { onDone, onClose } = await open(() => Promise.reject(refusal(404, "bu hastada böyle bir elle girilmiş değer yok")));
```

Replace with:

```jsx
    const { onDone, onClose } = await open(() => Promise.reject(refusal(404, "bu hastada böyle bir ölçüm değeri yok")));
```

In the same file, find (line 165):

```jsx
    expect(toasted("REA-01 · 2: işarələnmədi — Bu xəstədə belə bir əl ilə daxil edilmiş dəyər yoxdur.").length).toBeGreaterThan(0);
```

Replace with:

```jsx
    expect(toasted("REA-01 · 2: işarələnmədi — Bu xəstədə belə bir ölçmə dəyəri yoxdur.").length).toBeGreaterThan(0);
```

- [ ] **Step 11: Run and commit Part B**

Run: `cd /c/tmp/g3-cihaz-olcum/dashboard && npx vitest run src/live/screens/denetim src/live/apiErrors.test.js src/live/screens/common/RetractDialog.test.jsx src/live/i18n/strings.test.js 2>&1 | tail -8`
Expected: no failure. `engineTypes.test.js` and `apiErrors.test.js` are green again.

```bash
cd /c/tmp/g3-cihaz-olcum && git add -- dashboard/src/live/screens/denetim/denetim.js dashboard/src/live/i18n/strings/denetim.js dashboard/src/live/screens/denetim/denetim.test.js dashboard/src/live/apiErrors.js dashboard/src/live/i18n/strings/errors.js dashboard/src/live/screens/common/RetractDialog.test.jsx && git commit -m "feat(dashboard): Denetim names the three reading events; the withdrawal's «no such value» sentence follows the engine (G3-05 W1, part B)" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>" -- dashboard/src/live/screens/denetim/denetim.js dashboard/src/live/i18n/strings/denetim.js dashboard/src/live/screens/denetim/denetim.test.js dashboard/src/live/apiErrors.js dashboard/src/live/i18n/strings/errors.js dashboard/src/live/screens/common/RetractDialog.test.jsx
```

---

### Task W2: «Ölçüm kaydı» on the patient screen — `useReadings`, `ReadingsBox`, `CorrectDialog` (D2, D13, D16)

**Files:**
- Test: `dashboard/src/live/screens/patient/readings/readings.testutil.js` (new)
- Test: `dashboard/src/live/screens/patient/readings/ReadingsBox.test.jsx` (new)
- Create: `dashboard/src/live/screens/patient/readings/useReadings.js`
- Create: `dashboard/src/live/screens/patient/readings/CorrectDialog.jsx`
- Create: `dashboard/src/live/screens/patient/readings/ReadingsBox.jsx`
- Modify: `dashboard/src/live/screens/patient/PatientScreen.jsx` — line 69, lines 451–452 (as each step finds the file)
- Test: `dashboard/src/live/rawKeys.test.jsx` — line 310, line 50 (as each step finds the file)

A box under «Ölçülen değerler»: one row per measurement set, newest first, over 24 hours, 72 hours or 7 days; each set says its source — «cihaz · {device}» or «elle · {user}» — and «alındı {time}» when the engine marks the arrival as late; a withdrawn value is struck through with its reason, who and when. A `clinical.chart` holder gets «Düzelt» on each value of the bedside set that is not withdrawn: one dialog that withdraws the wrong value (the engine's «hatalı giriş») and, when a right value is typed, charts it by hand at the reading's own time. The box computes nothing: every fact is the engine's (`GET /patients/{id}/readings`).

`PatientScreen.jsx` gets one import and one mount line; **B1b Nakil is editing that file** — keep the diff to those two lines and expect a late, trivial merge (spec O5).

- [ ] **Step 1: The fixture and the failing tests**

Create `dashboard/src/live/screens/patient/readings/readings.testutil.js`:

```js
// Test-only: GET /patients/{id}/readings as the engine answers it (spec §4, homunculus-engine api/readings.py
// `patient_readings`), on synthetic values. Three sets, newest first: a hand entry ten minutes before NOW, a
// device round an hour before it — one of its values withdrawn — and a buffered device reading that arrived half
// an hour after it was measured. Protocol 202600000001 and the device name are synthetic.
import { NOW } from "../../../data/board.testutil.js";

const iso = (ms) => new Date(ms).toISOString();
export const MIN = 60_000;
export const HAND_AT = NOW - 10 * MIN;
export const ROUND_AT = NOW - 70 * MIN;
export const LATE_AT = NOW - 5 * 60 * MIN;

const value = (id, code, v, unit, over = {}) => ({
  id, code, value: v, unit, origin: "device", source: "CONNEX-3A", recorded_by: null, entry: 400 + id, voided: null, ...over,
});

export const SETS = [
  {
    observed_at: iso(HAND_AT), received_at: iso(HAND_AT), received_late: false, origin: "manual", source: "clinician",
    recorded_by: "hem.ayse",
    readings: [value(31, "resp_rate", 16, "/min", { origin: "manual", source: "clinician", recorded_by: "hem.ayse" })],
  },
  {
    observed_at: iso(ROUND_AT), received_at: iso(ROUND_AT + 20_000), received_late: false, origin: "device",
    source: "CONNEX-3A", recorded_by: null,
    readings: [
      value(21, "heart_rate", 88, "/min"),
      value(22, "sbp", 188, "mmHg", { voided: { reason: "manşet yanlış koldaydı", by: "hem.ayse", at: iso(ROUND_AT + 8 * MIN) } }),
      value(23, "spo2", 97, "%"),
      value(24, "temperature", 36.8, "°C"),
    ],
  },
  {
    observed_at: iso(LATE_AT), received_at: iso(LATE_AT + 30 * MIN), received_late: true, origin: "device",
    source: "CONNEX-3A", recorded_by: null,
    readings: [value(11, "spo2", 95, "%")],
  },
];

/** The answer for `patientId` and `hours`, with `over` laid on top. */
export function readings(patientId = "S-001", hours = 24, over = {}) {
  return { patient_id: patientId, hours, since: iso(NOW - hours * 60 * MIN), until: iso(NOW), sets: SETS, ...over };
}

export const emptyReadings = (patientId = "S-001", hours = 24) => readings(patientId, hours, { sets: [] });
```

Create `dashboard/src/live/screens/patient/readings/ReadingsBox.test.jsx`:

```jsx
// src/live/screens/patient/readings/ReadingsBox.test.jsx — the patient screen's «Ölçüm kaydı» box (G3-05 D16) and
// its «Düzelt» (D13). Synthetic values only (readings.testutil.js).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount, refusal } from "../../../session/mount.testutil.jsx";
import { profile, token } from "../../../session/testTokens.testutil.js";
import { NOW, board, entry } from "../../../data/board.testutil.js";
import { dayStamp } from "../../../i18n/dates.js";
import { RETRACT_ARM_MS } from "../../common/RetractDialog.jsx";
import { HAND_AT, LATE_AT, MIN, ROUND_AT, emptyReadings, readings } from "./readings.testutil.js";
import { ReadingsBox } from "./ReadingsBox.jsx";
import { READINGS_POLL_MS } from "./useReadings.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const CHART = ["board.view", "clinical.chart"];
const BED = "REA-01 · 2";
const WHY = "manşet yanlış koldaydı, yeniden ölçüldü";

/** The box on its own, on a session holding `perms`, reading `answer` for whichever patient and window it asks. */
async function open({ perms = CHART, answer = readings, id = "S-001", host = null, setup, onWritten = vi.fn() } = {}) {
  const ui = host ?? <ReadingsBox patientId={id} bed={BED} nowMs={NOW} canChart={perms.includes("clinical.chart")} onWritten={onWritten} />;
  const mounted = await mount(ui, {
    access: token({ perms }), me: profile({ perms }),
    setup: (api) => {
      api.boardPatients.mockResolvedValue(board([entry("S-001")]));
      api.streamTicket.mockResolvedValue({ ticket: "t-1" });
      api.patientReadings.mockImplementation((pid, hours) => Promise.resolve(answer(pid, hours)));
      api.retractEntry.mockResolvedValue({ retracted: 422, code: "sbp", alerts: [] });
      api.chart.mockResolvedValue({ patient_id: "S-001", charted: 1, alerts: [], entries: [{ code: "sbp", entry: 501 }] });
      setup?.(api);
    },
  });
  await act(async () => { await settle(); });
  return { ...mounted, onWritten };
}

const sets = () => [...document.querySelectorAll("[data-set]")];
const press = (el) => act(async () => { fireEvent.click(el); await settle(); });
const type = (el, text) => act(async () => { fireEvent.change(el, { target: { value: text } }); await settle(); });
const arm = () => act(async () => { vi.advanceTimersByTime(RETRACT_ARM_MS + 1); await settle(); });
const toasted = (text) => within(screen.getByRole("region", { name: "Bildirişlər" })).queryAllByText(text);
const correctButtons = () => screen.queryAllByRole("button", { name: "Düzəlt" });

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(NOW); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the measurement record — what was measured, and by what", () => {
  it("reads the patient's 24 hours on mount and lists the sets newest first, each with its source", async () => {
    const { api } = await open();
    expect(api.patientReadings).toHaveBeenCalledWith("S-001", 24);
    expect(screen.getByRole("heading", { level: 2, name: "Ölçmə qeydi" })).toBeInTheDocument();
    expect(sets()).toHaveLength(3);
    expect(sets()[0]).toHaveTextContent(dayStamp(HAND_AT, NOW));
    expect(sets()[0]).toHaveTextContent("əl ilə · hem.ayse");
    expect(sets()[1]).toHaveTextContent(dayStamp(ROUND_AT, NOW));
    expect(sets()[1]).toHaveTextContent("cihazdan · CONNEX-3A");
    expect(sets()[1]).toHaveTextContent("Nəbz");
    expect(sets()[1]).toHaveTextContent("88 /dəq");
    expect(sets()[1]).toHaveTextContent("36,8 °C");
  });

  it("says «alındı» only where the engine marks the arrival as late", async () => {
    await open();
    expect(sets()[2]).toHaveTextContent(`qəbul edildi ${dayStamp(LATE_AT + 30 * MIN, NOW)}`);
    expect(sets()[1]).not.toHaveTextContent("qəbul edildi");
    expect(sets()[0]).not.toHaveTextContent("qəbul edildi");
  });

  it("keeps a withdrawn value, struck through, with its reason, who and when — and offers no «Düzelt» on it", async () => {
    await open();
    const struck = sets()[1].querySelector("[data-reading='22']");
    expect(struck.querySelector("s")).toHaveTextContent("188 mmHg");
    expect(struck).toHaveTextContent(`səhv qeyd — manşet yanlış koldaydı · hem.ayse · ${dayStamp(ROUND_AT + 8 * MIN, NOW)}`);
    expect(within(struck).queryByRole("button")).toBeNull();
    // the other values of the set are not struck
    expect(sets()[1].querySelector("[data-reading='21'] s")).toBeNull();
  });

  it("offers the three windows and reads again for the one chosen", async () => {
    const { api } = await open();
    const window = within(screen.getByRole("group", { name: "Dövr" }));
    expect(window.getByRole("button", { name: "24 saat" })).toHaveAttribute("aria-pressed", "true");
    await press(window.getByRole("button", { name: "7 gün" }));
    expect(api.patientReadings).toHaveBeenLastCalledWith("S-001", 168);
    expect(window.getByRole("button", { name: "7 gün" })).toHaveAttribute("aria-pressed", "true");
  });

  it("says so when the window holds nothing, and why when the read fails — keeping the last answer", async () => {
    const { api } = await open({ answer: emptyReadings });
    expect(screen.getByText("Bu dövrdə ölçmə qeydi yoxdur.")).toBeInTheDocument();
    cleanup();
    const again = await open();
    again.api.patientReadings.mockRejectedValue(refusal(503, "kapsam şu anda okunamıyor"));
    await act(async () => { vi.advanceTimersByTime(READINGS_POLL_MS); await settle(); });
    expect(screen.getByText(/^Ölçmə qeydi oxunmadı: /)).toBeInTheDocument();
    expect(sets()).toHaveLength(3);                       // the last answer stays beside the note
    expect(api.patientReadings).toHaveBeenCalled();
  });

  it("reads again once a minute", async () => {
    const { api } = await open();
    const before = api.patientReadings.mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(READINGS_POLL_MS); await settle(); });
    expect(api.patientReadings.mock.calls.length).toBe(before + 1);
  });

  it("never shows another patient's record: a move shows nothing until that patient answers", async () => {
    let release;
    const answer = (pid, hours) => (pid === "S-002" ? new Promise((resolve) => { release = () => resolve(readings(pid, hours)); }) : readings(pid, hours));
    function Host() {
      const [id, setId] = React.useState("S-001");
      return (<><button type="button" onClick={() => setId("S-002")}>move</button>
        <ReadingsBox patientId={id} bed={BED} nowMs={NOW} canChart /></>);
    }
    await open({ host: <Host />, answer });
    expect(sets()).toHaveLength(3);
    await press(screen.getByRole("button", { name: "move" }));
    expect(sets()).toHaveLength(0);
    expect(screen.getByText("Ölçmə qeydi oxunur…")).toBeInTheDocument();
    await act(async () => { release(); await settle(); });
    expect(sets()).toHaveLength(3);
  });

  it("an answer that is not this patient's record for this window is not shown", async () => {
    await open({ answer: () => ({ patient_id: "S-999", hours: 24, sets: [] }) });
    expect(screen.getByText(/^Ölçmə qeydi oxunmadı: /)).toBeInTheDocument();
    expect(sets()).toHaveLength(0);
  });
});

describe("«Düzelt» — who is offered it, and on what", () => {
  it("is absent without clinical.chart — never a disabled button", async () => {
    await open({ perms: ["board.view"] });
    expect(correctButtons()).toHaveLength(0);
  });

  it("is offered on each bedside value that is not withdrawn and has an engine entry", async () => {
    const answer = (pid, hours) => {
      const base = readings(pid, hours);
      const sets2 = base.sets.map((s, i) => (i === 2 ? { ...s, readings: [{ ...s.readings[0], entry: null }] } : s));
      return { ...base, sets: sets2 };
    };
    await open({ answer });
    // 1 hand value + 3 of the round's 4 (one is withdrawn); the last set's value has no entry.
    expect(correctButtons()).toHaveLength(4);
  });

  it("is not offered on a value the bedside form does not chart", async () => {
    const answer = (pid, hours) => readings(pid, hours, { sets: [{ ...readings().sets[2],
      readings: [{ id: 91, code: "lactate", value: 2.1, unit: "mmol/L", origin: "device", source: "LAB", recorded_by: null, entry: 491, voided: null }] }] });
    await open({ answer });
    expect(sets()[0]).toHaveTextContent("2,1");
    expect(correctButtons()).toHaveLength(0);
  });
});

describe("«Düzelt» — the dialog", () => {
  async function openDialog(extra) {
    const mounted = await open(extra);
    await press(within(sets()[1].querySelector("[data-reading='21']")).getByRole("button", { name: "Düzəlt" }));
    return mounted;
  }
  const dialog = () => screen.getByRole("dialog");
  const reasonBox = () => within(dialog()).getByLabelText(/^Səbəb/);
  const valueBox = () => within(dialog()).getByLabelText(/^Düzgün dəyər · Nəbz/);
  const confirm = () => press(within(dialog()).getByRole("button", { name: "Düzəlt" }));

  it("says which value, of which source, before anything is sent", async () => {
    const { api } = await openDialog();
    expect(within(dialog()).getByRole("heading", { name: `Düzəlt · ${BED}` })).toBeInTheDocument();
    expect(dialog()).toHaveTextContent(`Nəbz: 88 /dəq · ölçmə ${dayStamp(ROUND_AT, NOW)} · cihazdan · CONNEX-3A`);
    expect(dialog()).toHaveTextContent("üstündən xətt çəkilmiş");
    expect(api.retractEntry).not.toHaveBeenCalled();
  });

  it("withdraws first, then charts the right value by hand at the reading's own time", async () => {
    const { api, onWritten } = await openDialog();
    const order = [];
    api.retractEntry.mockImplementation(() => { order.push("retract"); return Promise.resolve({ retracted: 421, code: "heart_rate", alerts: [] }); });
    api.chart.mockImplementation(() => { order.push("chart"); return Promise.resolve({ patient_id: "S-001", charted: 1, alerts: [], entries: [] }); });
    await arm();
    await type(reasonBox(), WHY);
    await type(valueBox(), "78");
    await confirm();
    expect(order).toEqual(["retract", "chart"]);
    expect(api.retractEntry).toHaveBeenCalledWith("S-001", 421, WHY);
    expect(api.chart).toHaveBeenCalledWith("S-001", [{ code: "heart_rate", value: 78 }], new Date(ROUND_AT).toISOString());
    expect(toasted(`${BED}: Nəbz düzəldildi.`).length).toBeGreaterThan(0);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onWritten).toHaveBeenCalledWith("S-001");
    expect(api.patientReadings.mock.calls.length).toBeGreaterThan(1);   // the box read again
  });

  it("with no right value typed it only withdraws", async () => {
    const { api } = await openDialog();
    await arm();
    await type(reasonBox(), WHY);
    await confirm();
    expect(api.retractEntry).toHaveBeenCalledTimes(1);
    expect(api.chart).not.toHaveBeenCalled();
    expect(toasted(`${BED}: Nəbz səhv qeyd kimi işarələndi.`).length).toBeGreaterThan(0);
  });

  it("waits for a reason of ten characters and for the arming window, and holds back a value out of range", async () => {
    const { api } = await openDialog();
    await type(reasonBox(), WHY);
    await confirm();                                        // inside the arming window: ignored
    expect(api.retractEntry).not.toHaveBeenCalled();
    await arm();
    await type(reasonBox(), "kısa");
    await confirm();
    expect(api.retractEntry).not.toHaveBeenCalled();
    await type(reasonBox(), WHY);
    await type(valueBox(), "900");
    await confirm();
    expect(api.retractEntry).not.toHaveBeenCalled();
    expect(dialog()).toHaveTextContent("0–300 aralığında olmalıdır.");
  });

  it("a withdrawal that landed and a chart that did not says which half happened", async () => {
    const { api } = await openDialog({ setup: (a) => { a.chart.mockRejectedValue(refusal(400, "ölçüm saati en çok 24 saat geriye alınabilir")); } });
    await arm();
    await type(reasonBox(), WHY);
    await type(valueBox(), "78");
    await confirm();
    expect(api.retractEntry).toHaveBeenCalledTimes(1);
    const said = toasted(/^REA-01 · 2: səhv dəyər işarələndi, lakin düzgün dəyər yazılmadı — /);
    expect(said.length).toBeGreaterThan(0);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a refused withdrawal charts nothing and says the engine's reason", async () => {
    const { api } = await openDialog({ setup: (a) => { a.retractEntry.mockRejectedValue(refusal(409, "taburcu edilmiş bir hastada değer geri alınamaz")); } });
    await arm();
    await type(reasonBox(), WHY);
    await type(valueBox(), "78");
    await confirm();
    expect(api.chart).not.toHaveBeenCalled();
    expect(toasted(/^REA-01 · 2: düzəldilmədi — /).length).toBeGreaterThan(0);
  });

  it("offers no right-value box for a reading older than 24 hours, and says why", async () => {
    const old = NOW - 26 * 60 * MIN;
    const answer = (pid, hours) => readings(pid, hours, { sets: [{ ...readings().sets[1], observed_at: new Date(old).toISOString() }] });
    const { api } = await open({ answer });
    await press(within(sets()[0].querySelector("[data-reading='21']")).getByRole("button", { name: "Düzəlt" }));
    expect(within(dialog()).queryByLabelText(/^Düzgün dəyər/)).toBeNull();
    expect(dialog()).toHaveTextContent("Ölçmə 24 saatdan köhnədir");
    await arm();
    await type(reasonBox(), WHY);
    await confirm();
    expect(api.retractEntry).toHaveBeenCalledTimes(1);
    expect(api.chart).not.toHaveBeenCalled();
  });
});
```

Run: `cd /c/tmp/g3-cihaz-olcum/dashboard && npx vitest run src/live/screens/patient/readings 2>&1 | tail -6`
Expected: the file fails to load — `Failed to resolve import "./ReadingsBox.jsx"`.

- [ ] **Step 2: The hook**

Create `dashboard/src/live/screens/patient/readings/useReadings.js`:

```js
// src/live/screens/patient/readings/useReadings.js — one patient's measurement record, read through the session
// (GET /patients/{id}/readings; homunculus-engine api/readings.py), on mount, once a minute, when the window
// changes and on `refresh()` — the box calls that after a correction (G3-05 D16). useFluids.js's pattern.
//
//   const { data, error, refresh } = useReadings(patientId, hours);
//
// A FAILED READ KEEPS THE LAST ANSWER and reports the error: a record that went blank on one dropped request would
// read as «nothing measured», a claim about the patient and a false one. NEVER ANOTHER PATIENT'S ANSWER, NOR ANOTHER
// WINDOW'S: a move to another patient or window shows nothing until that one answers, and an answer that is not
// this patient's record for this window is not shown. A sequence number drops an answer overtaken by a later read.
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../../session/SessionProvider.jsx";

export const READINGS_POLL_MS = 60_000;
/** The windows the engine accepts (api/readings.py READINGS_HOURS), in hours: 24 h, 72 h, 7 days. */
export const READINGS_WINDOWS = Object.freeze([24, 72, 168]);

/** This patient's record for this window — or not an answer at all. */
const isReadings = (answer, patientId, hours) => Boolean(answer) && typeof answer === "object"
  && answer.patient_id === patientId && answer.hours === hours && Array.isArray(answer.sets);

const NOTHING = Object.freeze({ data: null, error: null });

export function useReadings(patientId, hours = 24, { everyMs = READINGS_POLL_MS } = {}) {
  const { store } = useSession();
  const key = `${patientId}|${hours}`;
  const [state, setState] = useState({ forKey: key, ...NOTHING });
  const alive = useRef(true);
  const seq = useRef(0);
  const shownKey = useRef(key);
  const read = useCallback(async () => {
    if (shownKey.current !== key) return;        // a patient or window left behind: its refresh lands nowhere
    const mine = ++seq.current;
    const current = () => alive.current && mine === seq.current;
    try {
      const answer = await store.track(() => store.api.patientReadings(patientId, hours));
      if (!current()) return;
      if (!isReadings(answer, patientId, hours)) throw new Error("not a measurement record");
      setState({ forKey: key, data: answer, error: null });
    } catch (error) {
      if (error?.superseded || !current()) return;
      setState((s) => (s.forKey === key ? { ...s, error } : { forKey: key, data: null, error }));
    }
  }, [store, patientId, hours, key]);
  useEffect(() => {
    shownKey.current = key;
    alive.current = true;
    read();
    const timer = setInterval(read, everyMs);
    return () => {
      alive.current = false;
      seq.current += 1;          // a read in flight for what was left behind lands nowhere
      clearInterval(timer);
    };
  }, [read, everyMs, key]);
  const shown = state.forKey === key ? state : NOTHING;
  return { data: shown.data, error: shown.error, refresh: read };
}
```

- [ ] **Step 3: The dialog**

Create `dashboard/src/live/screens/patient/readings/CorrectDialog.jsx`:

```jsx
// src/live/screens/patient/readings/CorrectDialog.jsx — «Düzelt» (G3-05, D3, D13, Q3): a wrong value corrected,
// whoever produced it — the device or a hand. Two screens open it: the «Ölçüm kaydı» box and the trend table.
//
// WHAT IT DOES, in this order, and only after the clinician gave a reason:
//   1. withdraws the wrong value — the engine's «hatalı giriş» (`onRetract(reason)`): the value leaves every score
//      and alert, and stays in the record and on the chart struck through, with the reason, who and when;
//   2. when a right value was typed, charts it BY HAND at the reading's own time (`onChart(entries, recordedAt)`),
//      so the record shows it as «elle» — never as the device's.
// The right value is optional (an empty box only withdraws) and is held to the bedside form's own check
// (`checkVital`: a slipped digit, not a clinical bound). The engine takes a hand entry at most 24 hours back, so for
// an older reading the box is not offered and the dialog says why — the withdrawal still works.
//
// THE ENGINE DECIDES, and each ending is said on a toast named after the bed:
//   both done → «düzeltildi»; only the withdrawal asked → «hatalı giriş olarak işaretlendi»;
//   withdrawn but the right value refused or unanswered → the PARTIAL message, which says which half happened and
//     where to enter the value (never a plain failure: the wrong value IS out of the scores);
//   the withdrawal refused → nothing is charted; «already withdrawn» closes and the host re-reads; a reason the
//     engine finds short keeps the dialog open; a withdrawal with no answer may have landed — she is told to look.
// `onDone(outcome)`: "corrected" | "retracted" | "partial" | "already" | "uncertain". The button ignores a press for
// RETRACT_ARM_MS after the dialog opens and a double click's second press (RetractDialog's rule).
import React, { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { apiErrorText } from "../../../apiErrors.js";
import { Announce, Button, Field, Input, Modal, Note, useToast } from "../../../ui/index.js";
import { mayHaveLanded } from "../../admin/refusal.js";
import { checkVital, specOf } from "../../bedside/vitalsFields.js";
import {
  RETRACT_ALREADY, RETRACT_ARM_MS, RETRACT_MAX_REASON_CHARS, RETRACT_MIN_REASON_CHARS,
} from "../../common/RetractDialog.jsx";

/** The engine takes a hand entry at most this far back (api/clinical.py BEDSIDE_BACKDATE); a minute is kept inside
 *  the edge, as the bedside form keeps it (vitalsFields.js SKEW_MS). */
export const CORRECT_BACKDATE_MS = 24 * 3_600_000 - 60_000;

const saidAlready = (err) => err?.status === 409 && String(err.message ?? "").trim() === RETRACT_ALREADY;

/** `bed` names the patient in the title and on the toasts. `what` is `{ code, label, value, time, source,
 *  observedMs }`: the engine's code, and the label, the value with its unit, the measurement time and the source as
 *  the clinician reads them; `observedMs` is the reading's own instant. `nowMs` is the screen's clock.
 *  `onRetract(reason)` and `onChart(entries, recordedAtIso)` are the two writes, bound to the patient and the
 *  entry by the host; each resolves to the API's answer, or null when the store dropped it. */
export function CorrectDialog({ bed, what, nowMs = Date.now(), onRetract, onChart, onDone, onClose }) {
  const { t } = useI18n();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [raw, setRaw] = useState("");
  const [valueError, setValueError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [arming, setArming] = useState(true);
  const armed = useRef(false);
  const sending = useRef(false);
  const mounted = useRef(false);
  const formId = useId();
  const countId = useId();
  const whatId = useId();
  const introId = useId();
  useEffect(() => {
    mounted.current = true;
    const timer = setTimeout(() => {
      armed.current = true;
      if (mounted.current) setArming(false);
    }, RETRACT_ARM_MS);
    return () => {
      mounted.current = false;
      clearTimeout(timer);
    };
  }, []);
  const spec = specOf(what.code);
  // A value of a kind the bedside form types as a number can be re-entered here; a choice (oxygen, ACVPU) is
  // corrected on the bedside form itself, where its options are.
  const typable = Boolean(spec) && spec.kind === "number";
  const recent = Number.isFinite(what.observedMs) && nowMs - what.observedMs <= CORRECT_BACKDATE_MS;
  const offerValue = typable && recent;
  const count = reason.trim().length;
  const short = count < RETRACT_MIN_REASON_CHARS;

  async function confirm(event) {
    if ((event?.detail ?? 0) > 1 || !armed.current || short || sending.current || busy) return;
    let entries = null;
    if (offerValue) {
      const checked = checkVital(spec, raw);
      if (checked.error) {
        setValueError(t(checked.error.key, checked.error.params));
        return;
      }
      if (!checked.skip) entries = [{ code: what.code, value: checked.value }];
    }
    setValueError(null);
    sending.current = true;
    setBusy(true);
    let done;   // { say: [text, tone], outcome: string | null, close }
    try {
      const withdrawn = await onRetract(reason.trim());
      if (withdrawn === null) return;                // the store dropped it: the session ended
      if (entries === null) {
        done = { say: [t("kayit.correctWithdrawn", { subject: bed, label: what.label })], outcome: "retracted", close: true };
      } else {
        try {
          const charted = await onChart(entries, new Date(what.observedMs).toISOString());
          if (charted === null) return;
          done = { say: [t("kayit.correctDone", { subject: bed, label: what.label })], outcome: "corrected", close: true };
        } catch (err) {
          if (err?.superseded) return;
          // The wrong value IS withdrawn: say which half happened, never a plain failure.
          done = { say: [t("kayit.correctPartial", { subject: bed, reason: apiErrorText(t, err) }), "warn"], outcome: "partial", close: true };
        }
      }
    } catch (err) {
      if (err?.superseded) return;
      if (mayHaveLanded(err)) {
        done = { say: [t("kayit.correctMayHaveLanded", { subject: bed }), "warn"], outcome: "uncertain", close: true };
      } else {
        const said = err?.status === 403 ? t("kayit.noRight") : apiErrorText(t, err);
        done = {
          say: [t("kayit.correctRefused", { subject: bed, reason: said }), "error"],
          outcome: saidAlready(err) ? "already" : null,
          close: err?.status !== 400,
        };
      }
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
    // Out of the `try`: a host callback that throws must never turn a correction the engine took into "not done".
    toast(...done.say);
    try {
      if (done.outcome) onDone(done.outcome);
    } finally {
      if (done.close) onClose();
    }
  }

  return (
    <Modal
      open title={t("kayit.correctTitle", { bed })} onClose={onClose} busy={busy}
      actions={(
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          <p id={countId} className="m-0 mr-auto text-12 font-semibold text-mute">
            {t("kayit.correctCount", { count, min: RETRACT_MIN_REASON_CHARS })}
          </p>
          <div className="ml-auto flex shrink-0 gap-2">
            <Button variant="ghost" onClick={onClose} busy={busy}>{t("common.cancel")}</Button>
            <Button variant="danger" onClick={confirm} busy={busy}
              aria-disabled={short || arming ? "true" : undefined} aria-describedby={countId}>
              {t("kayit.correctConfirm")}
            </Button>
          </div>
        </div>
      )}
    >
      {/* Enter in a box presses the button: the same checks, and no `detail`. */}
      <form id={formId} noValidate onSubmit={(event) => { event.preventDefault(); confirm(); }}>
        <p id={whatId} className="m-0 font-data text-14.5 font-semibold">
          {t("kayit.correctWhat", { label: what.label, value: what.value, time: what.time, source: what.source })}
        </p>
        <Note tone="warn" icon="alert" className="mt-2"><span id={introId}>{t("kayit.correctIntro")}</span></Note>
        <div className="mt-3">
          <Field label={t("kayit.correctReason")} layout="col" required>
            <Input autoFocus autoComplete="off" maxLength={RETRACT_MAX_REASON_CHARS} value={reason}
              onChange={(event) => setReason(event.target.value)} readOnly={busy}
              aria-describedby={`${whatId} ${introId}`} />
          </Field>
          {offerValue ? (
            <Field label={t("kayit.correctValue", { label: `${what.label} (${t(spec.unitKey)})` })} layout="col"
              hint={t("kayit.correctValueHint")} error={valueError}>
              <Input inputMode="decimal" autoComplete="off" value={raw} readOnly={busy}
                onChange={(event) => { setRaw(event.target.value); setValueError(null); }} />
            </Field>
          ) : null}
          {typable && !recent ? <p className="m-0 text-12.5 text-mute">{t("kayit.correctTooOld")}</p> : null}
        </div>
      </form>
      <Announce text={busy ? t("kayit.saving") : ""} />
    </Modal>
  );
}
```

- [ ] **Step 4: The box**

Create `dashboard/src/live/screens/patient/readings/ReadingsBox.jsx`:

```jsx
// src/live/screens/patient/readings/ReadingsBox.jsx — the patient screen's «Ölçüm kaydı» box (G3-05 D2, D16): what
// was measured in this stay, and by what — as the engine's record holds it (GET /patients/{id}/readings).
//
// WHAT IT PRINTS is the engine's, value for value: one row per measurement set, the newest first, over the window
// chosen (24 hours, 72 hours, 7 days); the set's time, its source — «cihaz · {device}» or «elle · {user}» — and
// «alındı {time}» where the engine marks the arrival as late (`received_late`; the box compares no two times). Each
// value is named and written as the bedside form names and writes it (vitalsFields.js); a code that form does not
// know is printed as the engine sent it. A WITHDRAWN value stays, struck through, with its reason, who and when
// (Q3): nothing measured ever disappears from this box. No score, no colour and no judgement lives here.
//
// WHAT IT WRITES, for a `clinical.chart` holder only — absent otherwise, never a disabled button: «Düzelt» on each
// value of the bedside set that is not withdrawn and that the engine can address (`entry`), in CorrectDialog.jsx.
// After any ending of that dialog the box reads again, and tells the screen that a value moved (`onWritten`), so
// the SOFA box and the trends follow.
//
// The shell keeps the patient screen mounted across a move to another patient (no `key`), so the box remembers
// WHOSE dialog it opened: one opened on a patient is never shown on the next (the fluid box's rule).
import React, { useEffect, useId, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { dayStamp } from "../../../i18n/dates.js";
import { numberText } from "../../../i18n/numbers.js";
import { readErrorText } from "../../../apiErrors.js";
import { useBoard } from "../../../data/BoardProvider.jsx";
import { Box, Button, Note, Seg } from "../../../ui/index.js";
import { isBedsideCode, specOf, valueText } from "../../bedside/vitalsFields.js";
import { CorrectDialog } from "./CorrectDialog.jsx";
import { READINGS_WINDOWS, useReadings } from "./useReadings.js";

const WINDOW_KEY = Object.freeze({ 24: "kayit.w24", 72: "kayit.w72", 168: "kayit.w168" });

const timeOf = (iso) => {
  const ms = Date.parse(iso ?? "");
  return Number.isFinite(ms) ? ms : null;
};

/** A set's source as the reader meets it: «cihaz · CONNEX-3A» or «elle · hem.ayse» — the bare word when the engine
 *  holds no device name or no person. */
export function sourceText(t, origin, source, recordedBy) {
  if (origin === "manual") {
    return recordedBy ? t("kayit.sourceHand", { user: recordedBy }) : t("kayit.sourceHandUnnamed");
  }
  return source ? t("kayit.sourceDevice", { device: source }) : t("kayit.sourceDeviceUnnamed");
}

/** A value's name and text: the bedside form's own for a code it knows; else the engine's code and number. */
function wordsOf(t, lang, reading) {
  const spec = specOf(reading.code);
  if (spec) return { label: t(spec.labelKey), value: valueText(t, reading.code, reading.value, lang) };
  const number = typeof reading.value === "number" ? numberText(lang, reading.value) : "—";
  return { label: String(reading.code ?? "—"), value: [number, reading.unit].filter(Boolean).join(" ") };
}

function Reading({ reading, nowMs, onCorrect }) {
  const { t, lang } = useI18n();
  const id = useId();
  const { label, value } = wordsOf(t, lang, reading);
  const voided = reading.voided && typeof reading.voided === "object" ? reading.voided : null;
  const voidedAt = voided ? timeOf(voided.at) : null;
  const offer = onCorrect && !voided && Number.isInteger(reading.entry) && isBedsideCode(reading.code);
  return (
    <li data-reading={reading.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-0.5">
      <span id={id} className="min-w-0 flex-1 text-13.5">
        <span className="font-semibold text-mute">{label}</span>{" "}
        {voided ? <s className="font-data">{value}</s> : <b className="font-data">{value}</b>}
        {voided ? (
          <span className="ml-2 text-12 text-mute">
            {t("kayit.voided", { reason: String(voided.reason ?? ""), who: String(voided.by ?? ""),
              time: voidedAt === null ? "—" : dayStamp(voidedAt, nowMs) })}
          </span>
        ) : null}
      </span>
      {offer ? (
        // The name stays «Düzelt»; the value's own words tell the buttons apart for a screen reader.
        <Button size="sm" variant="ghost" icon="edit" aria-describedby={id} onClick={() => onCorrect(reading, label, value)}>
          {t("kayit.correct")}
        </Button>
      ) : null}
    </li>
  );
}

function Sets({ data, nowMs, onCorrect }) {
  const { t } = useI18n();
  if (data.sets.length === 0) return <p className="m-0 text-13 text-mute">{t("kayit.empty")}</p>;
  return (
    // role="list": a list with its bullets removed (`list-none`) stops being one for VoiceOver.
    <ul role="list" className="m-0 list-none p-0">
      {data.sets.map((set) => {
        const at = timeOf(set.observed_at);
        const received = timeOf(set.received_at);
        const source = sourceText(t, set.origin, set.source, set.recorded_by);
        return (
          <li key={`${set.observed_at}|${set.origin}|${set.source}|${set.recorded_by ?? ""}`} data-set={set.origin}
            className="border-b border-line py-2 last:border-b-0">
            <p className="m-0 text-12.5">
              <b className="font-data text-ink">{at === null ? "—" : dayStamp(at, nowMs)}</b>
              {" · "}<span className="font-semibold text-mute">{source}</span>
              {set.received_late === true && received !== null ? (
                <>{" · "}<span className="text-mute">{t("kayit.received", { time: dayStamp(received, nowMs) })}</span></>
              ) : null}
            </p>
            <ul role="list" className="m-0 mt-0.5 list-none p-0">
              {(Array.isArray(set.readings) ? set.readings : []).map((reading) => (
                <Reading key={reading.id} reading={reading} nowMs={nowMs}
                  onCorrect={onCorrect ? (r, label, value) => onCorrect(set, r, label, value, source) : null} />
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}

/** `patientId` is whose record this is; `bed` names the patient in the dialog and on its toasts (never the
 *  patient's name, Decision 14); `nowMs` is the screen's clock; `canChart` (`clinical.chart`) offers «Düzelt» —
 *  absent otherwise. `onWritten(patientId)` tells the screen a value moved (the SOFA box and the trends re-read). */
export function ReadingsBox({ patientId, bed, nowMs = Date.now(), canChart = false, onWritten }) {
  const { t } = useI18n();
  const board = useBoard();
  const [hours, setHours] = useState(24);
  const { data, error, refresh } = useReadings(patientId, hours);
  // `{ id, what, entry }`: the value whose «Düzelt» is open, and whose patient it is.
  const [correcting, setCorrecting] = useState(null);
  useEffect(() => { setCorrecting(null); }, [patientId]);
  const open = correcting && correcting.id === patientId ? correcting : null;
  const windows = (
    <Seg label={t("kayit.windowLabel")} value={hours} onChange={setHours}
      options={READINGS_WINDOWS.map((h) => ({ value: h, label: t(WINDOW_KEY[h]) }))} />
  );
  return (
    <Box title={t("kayit.title")} icon="list" level={2} right={windows}>
      <p className="m-0 mb-2 text-11.5 text-mute">{t("kayit.intro")}</p>
      {/* A failed read keeps the last record and says so beside it — a static note: a read once a minute must not
          interrupt a screen reader each time it fails. */}
      {error ? <Note tone="warn" icon="alert" className="mb-2">{t("kayit.readFailed", { reason: readErrorText(t, error) })}</Note> : null}
      {data ? (
        <Sets data={data} nowMs={nowMs}
          onCorrect={canChart ? (set, reading, label, value, source) => setCorrecting({
            id: patientId, entry: reading.entry,
            what: { code: reading.code, label, value, source, observedMs: timeOf(set.observed_at),
              time: timeOf(set.observed_at) === null ? "—" : dayStamp(timeOf(set.observed_at), nowMs) },
          }) : null} />
      ) : error ? null : <p className="m-0 text-13 text-mute">{t("kayit.reading")}</p>}
      {open ? (
        <CorrectDialog
          bed={bed} what={open.what} nowMs={nowMs}
          onRetract={(reason) => board.store.retract(open.id, open.entry, reason)}
          onChart={(entries, at) => board.store.chart(open.id, entries, at)}
          // Every ending re-reads: the record may have changed even when the answer never came.
          onDone={() => {
            onWritten?.(open.id);
            refresh();
          }}
          onClose={() => setCorrecting(null)}
        />
      ) : null}
    </Box>
  );
}
```

- [ ] **Step 5: Run to see them pass**

Run: `cd /c/tmp/g3-cihaz-olcum/dashboard && npx vitest run src/live/screens/patient/readings 2>&1 | tail -6`
Expected: `Tests  18 passed (18)`.

- [ ] **Step 6: Mount it on the patient screen — two lines**

In `dashboard/src/live/screens/patient/PatientScreen.jsx`, find (line 69):

```jsx
import { FluidsBox } from "./fluids/FluidsBox.jsx"; // G3-03 (D10)
```

Replace with:

```jsx
import { FluidsBox } from "./fluids/FluidsBox.jsx"; // G3-03 (D10)
import { ReadingsBox } from "./readings/ReadingsBox.jsx"; // G3-05 (D16)
```

In the same file, find (lines 451–452):

```jsx
            <Vitals patient={patient} shadow={patient.shadow} nowMs={nowMs} />
          </Box>
```

Replace with:

```jsx
            <Vitals patient={patient} shadow={patient.shadow} nowMs={nowMs} />
          </Box>
          <ReadingsBox patientId={id} bed={bed} nowMs={nowMs} canChart={canChart} onWritten={sofaMayHaveMoved} />{/* G3-05 (D16): the measurement record */}
```

The raw-key sweep opens the patient screen with every API call stubbed; give it the record, so that it meets the box's words rather than only «could not be read»:

In `dashboard/src/live/rawKeys.test.jsx`, find (line 310):

```jsx
      api.patientFluids.mockImplementation((pid) => Promise.resolve(fluids(pid)));
```

Replace with:

```jsx
      api.patientFluids.mockImplementation((pid) => Promise.resolve(fluids(pid)));

      // G3-05: the patient screen's «Ölçüm kaydı» box — a hand entry, a device round with a withdrawn value and a
      // late arrival, so the sweep meets both sources, the struck value and «alındı».
      api.patientReadings.mockImplementation((pid, hours) => Promise.resolve(readings(pid, hours)));
```

In the same file, find (line 50):

```jsx
import { fluids } from "./screens/patient/fluids/fluids.testutil.js"; // G3-03
```

Replace with:

```jsx
import { fluids } from "./screens/patient/fluids/fluids.testutil.js"; // G3-03
import { readings } from "./screens/patient/readings/readings.testutil.js"; // G3-05
```

- [ ] **Step 7: Run the patient screen's suites and the sweep**

Run: `cd /c/tmp/g3-cihaz-olcum/dashboard && npx vitest run src/live/screens/patient/PatientScreen.test.jsx src/live/rawKeys.test.jsx src/live/screens/patient/readings 2>&1 | tail -6`
Expected: no failure (144 tests in the three files on the scratch copy).

- [ ] **Step 8: Commit**

```bash
cd /c/tmp/g3-cihaz-olcum && git add -- dashboard/src/live/screens/patient/readings/readings.testutil.js dashboard/src/live/screens/patient/readings/ReadingsBox.test.jsx dashboard/src/live/screens/patient/readings/useReadings.js dashboard/src/live/screens/patient/readings/CorrectDialog.jsx dashboard/src/live/screens/patient/readings/ReadingsBox.jsx dashboard/src/live/screens/patient/PatientScreen.jsx dashboard/src/live/rawKeys.test.jsx && git commit -m "feat(dashboard): «Ölçüm kaydı» on the patient screen — the record box, its window, «Düzelt» for a device or a hand value (G3-05 W2)" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>" -- dashboard/src/live/screens/patient/readings/readings.testutil.js dashboard/src/live/screens/patient/readings/ReadingsBox.test.jsx dashboard/src/live/screens/patient/readings/useReadings.js dashboard/src/live/screens/patient/readings/CorrectDialog.jsx dashboard/src/live/screens/patient/readings/ReadingsBox.jsx dashboard/src/live/screens/patient/PatientScreen.jsx dashboard/src/live/rawKeys.test.jsx
```

---

### Task W3: The trend table says «cihaz» and offers «Düzelt» (D16)

**Files:**
- Test: `dashboard/src/live/screens/patient/trends/trends.testutil.js` — line 53, line 75 (as each step finds the file)
- Test: `dashboard/src/live/screens/patient/trends/TrendDevice.test.jsx` (new)
- Modify: `dashboard/src/live/screens/patient/trends/trendGeometry.js` — line 100 (as each step finds the file)
- Modify: `dashboard/src/live/screens/patient/trends/TrendTable.jsx` — line 14, line 24, lines 44–46, line 73, lines 112–113, lines 123–124, lines 134–136, line 145 (as each step finds the file)
- Modify: `dashboard/src/live/screens/patient/trends/TrendModal.jsx` — line 27, lines 37–38, line 44, line 137, line 145, lines 151–154, lines 161–165, line 191, line 205, line 215, lines 285–286, lines 314–317 (as each step finds the file)
- Modify: `dashboard/src/live/screens/patient/trends/TrendsBox.jsx` — line 116 (as each step finds the file)

The trends answer now lists each channel's device readings (`device`, Task B8). In the big chart's table a reading a device sent says «cihaz», as a hand entry says «elle»; a `clinical.chart` holder gets «Düzelt» on a device reading of the bedside set — the same dialog as in the record box (`CorrectDialog`); a withdrawn device reading is listed struck through and drawn crossed, exactly as a withdrawn hand entry is, and says «cihaz». A hand entry keeps its «Hatalı giriş».

- [ ] **Step 1: The failing tests**

In `dashboard/src/live/screens/patient/trends/trends.testutil.js`, find (line 53):

```js
/** One channel. Its `latest` defaults to the last point with no delta and no own-normal judgement;
```

Replace with:

```js
/** G3-05 (D16): one device reading of a channel's `device`, `minutesAgo` before NOW. `retracted` as `hand`'s. */
export function dev(entry, minutesAgo, value, { source = "CONNEX-3A", retracted = null } = {}) {
  return {
    entry, at: ago(minutesAgo * 60), value, source,
    retracted: retracted ? { reason: retracted.reason, by: retracted.by ?? "hem.ayse", at: ago(retracted.minutesAgo * 60) } : null,
  };
}

/** One channel. Its `latest` defaults to the last point with no delta and no own-normal judgement;
```

In the same file, find (line 75):

```js
    manual: [],               // G3-01 (D13): the channel's hand entries in the window
```

Replace with:

```js
    manual: [],               // G3-01 (D13): the channel's hand entries in the window
    device: [],               // G3-05 (D16): the channel's device readings in the window
```

Create `dashboard/src/live/screens/patient/trends/TrendDevice.test.jsx`:

```jsx
// TrendDevice.test.jsx — G3-05 (D16): the big chart's table names a device reading «cihaz» and offers «Düzelt» on
// it; a withdrawn device reading is listed struck through, as a withdrawn hand entry is. Synthetic values only.
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount } from "../../../session/mount.testutil.jsx";
import { profile, token } from "../../../session/testTokens.testutil.js";
import { NOW } from "../../../data/board.testutil.js";
import { RETRACT_ARM_MS } from "../../common/RetractDialog.jsx";
import { CARDS } from "./cards.js";
import { TrendModal } from "./TrendModal.jsx";
import { deviceEntryOf, parseDevice } from "./trendGeometry.js";
import { answering, channel, dev, hand, point, trends } from "./trends.testutil.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const PATIENT = { patient_id: "S-001", display_name: "Ayşe Sentetik", measuredAt: {} };
const BED = "REA-01 · 2";
const WHY = "manşet yanlış koldaydı, yeniden ölçüldü";
// Three pulse readings: a device's at −120 min (entry 71), a hand entry at −60 min (entry 41), a device's at −30 min
// that was withdrawn (entry 72: gone from the drawn points, listed in `device` with its withdrawal).
const MIXED = answering((pid, hours) => trends(pid, [channel("heart_rate", [point(120, 84, 0), point(60, 96, 1)], {
  manual: [hand(41, 60, 96)],
  device: [dev(71, 120, 84), dev(72, 30, 188, { retracted: { reason: "manşet yanlış koldaydı", minutesAgo: 20 } })],
})], { hours }));

async function open(answer = MIXED, props = {}) {
  vi.setSystemTime(NOW);
  const card = CARDS.find((c) => c.id === "heart_rate");
  const mounted = await mount(<TrendModal card={card} patient={PATIENT} bed={BED} onClose={() => {}} {...props} />, {
    access: token(), me: profile(), setup: (api) => api.patientTrends.mockImplementation(answer),
  });
  await act(async () => { await settle(); });
  await act(async () => { fireEvent.click(within(screen.getAllByRole("dialog")[0]).getByRole("button", { name: "Cədvəl" })); await settle(); });
  return mounted;
}
const table = () => screen.getAllByRole("dialog")[0].querySelector("table");
const row = (selector) => table().querySelector(selector);
const press = (el) => act(async () => { fireEvent.click(el); await settle(); });

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the device readings of a channel (trendGeometry)", () => {
  it("parses `device`, dropping an entry it cannot read", () => {
    const parsed = parseDevice([dev(71, 120, 84), { entry: "x", at: "bad", value: 1 }, dev(72, 30, 188, { retracted: { reason: "r", minutesAgo: 20 } })]);
    expect(parsed.map((d) => [d.entry, d.value, d.source, d.retracted === null])).toEqual([[71, 84, "CONNEX-3A", true], [72, 188, "CONNEX-3A", false]]);
    expect(parsed[1].retracted).toMatchObject({ reason: "r", by: "hem.ayse" });
    expect(parseDevice(undefined)).toEqual([]);
  });

  it("finds the device reading a drawn point is — not a withdrawn one, at its instant, with its value", () => {
    const parsed = parseDevice([dev(71, 120, 84), dev(72, 30, 188, { retracted: { reason: "r", minutesAgo: 20 } })]);
    expect(deviceEntryOf(parsed, { ms: parsed[0].ms, value: 84 })?.entry).toBe(71);
    expect(deviceEntryOf(parsed, { ms: parsed[0].ms, value: 85 })).toBeNull();
    expect(deviceEntryOf(parsed, { ms: parsed[1].ms, value: 188 })).toBeNull();
    expect(deviceEntryOf(undefined, { ms: 1, value: 1 })).toBeNull();
  });
});

describe("the trend table and the device", () => {
  it("says «cihaz» on a device reading and «elle» on a hand entry", async () => {
    await open();
    expect(row("tr[data-value='84']")).toHaveTextContent("cihazdan");
    expect(row("tr[data-value='84']")).not.toHaveTextContent("əl ilə");
    expect(row("tr[data-value='96']")).toHaveTextContent("əl ilə");
    expect(row("tr[data-value='96']")).not.toHaveTextContent("cihazdan");
  });

  it("lists a withdrawn device reading struck through, as the device's, with its reason", async () => {
    await open();
    const struck = row("tr[data-withdrawn='72']");
    expect(struck.querySelector("s")).toHaveTextContent("188");
    expect(struck).toHaveTextContent("cihazdan");
    expect(struck).toHaveTextContent("səhv qeyd — manşet yanlış koldaydı · hem.ayse");
    expect(struck).not.toHaveTextContent("əl ilə");
  });

  it("offers «Düzelt» on a device reading only to a clinical.chart holder with both writes", async () => {
    await open();
    expect(within(table()).queryByRole("button", { name: "Düzəlt" })).toBeNull();
    cleanup();
    await open(MIXED, { canRetract: true, onRetract: vi.fn(), onChart: vi.fn() });
    expect(within(row("tr[data-value='84']")).getByRole("button", { name: "Düzəlt" })).toBeInTheDocument();
    // the hand entry keeps its own button, and gets no «Düzelt»
    expect(within(row("tr[data-value='96']")).getByRole("button", { name: "Səhv qeyd" })).toBeInTheDocument();
    expect(within(row("tr[data-value='96']")).queryByRole("button", { name: "Düzəlt" })).toBeNull();
  });

  it("«Düzelt» withdraws the device reading and charts the right value at its own time, then reads again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onRetract = vi.fn(() => Promise.resolve({ retracted: 71, code: "heart_rate", alerts: [] }));
    const onChart = vi.fn(() => Promise.resolve({ charted: 1 }));
    const { api } = await open(MIXED, { canRetract: true, onRetract, onChart });
    const reads = api.patientTrends.mock.calls.length;
    await press(within(row("tr[data-value='84']")).getByRole("button", { name: "Düzəlt" }));
    const dialog = screen.getAllByRole("dialog").at(-1);
    expect(dialog).toHaveTextContent("Nəbz: 84 /dəq");
    expect(dialog).toHaveTextContent("cihazdan · CONNEX-3A");
    await act(async () => { vi.advanceTimersByTime(RETRACT_ARM_MS + 1); await settle(); });
    await act(async () => { fireEvent.change(within(dialog).getByLabelText(/^Səbəb/), { target: { value: WHY } }); await settle(); });
    await act(async () => { fireEvent.change(within(dialog).getByLabelText(/^Düzgün dəyər/), { target: { value: "78" } }); await settle(); });
    await press(within(dialog).getByRole("button", { name: "Düzəlt" }));
    expect(onRetract).toHaveBeenCalledWith(71, WHY);
    expect(onChart).toHaveBeenCalledWith([{ code: "heart_rate", value: 78 }], new Date(NOW - 120 * 60_000).toISOString());
    expect(api.patientTrends.mock.calls.length).toBeGreaterThan(reads);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);              // only the chart's dialog is left
  });

  it("a window with only a withdrawn device reading says so instead of «no measurement»", async () => {
    const only = answering((pid, hours) => trends(pid, [channel("heart_rate", [], {
      device: [dev(72, 30, 188, { retracted: { reason: "manşet yanlış koldaydı", minutesAgo: 20 } })] })], { hours }));
    await open(only);
    const dialog = screen.getAllByRole("dialog")[0];
    expect(dialog.querySelector("[data-only-withdrawn]")).not.toBeNull();
    expect(dialog.querySelector("[data-no-data]")).toBeNull();
  });
});
```

Run: `cd /c/tmp/g3-cihaz-olcum/dashboard && npx vitest run src/live/screens/patient/trends/TrendDevice.test.jsx 2>&1 | tail -6`
Expected: every test fails — `parseDevice` and `deviceEntryOf` are not exported, and no row says «cihazdan».

- [ ] **Step 2: Parse the device list (`trendGeometry.js`)**

In `dashboard/src/live/screens/patient/trends/trendGeometry.js`, find (line 100):

```js
/** [sinceMs, untilMs] onto [left, right]. */
```

Replace with:

```js
/** G3-05 (D16): a channel's device readings (`device`) as `{ entry, ms, iso, value, source, retracted }`, in their
 *  order; `retracted` as `parseManual`'s. An entry whose instant, value or id cannot be read is dropped. */
export function parseDevice(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((d) => {
    const ms = Date.parse(d?.at);
    if (!Number.isFinite(ms) || typeof d?.value !== "number" || !Number.isFinite(d.value) || !Number.isInteger(d?.entry)) return [];
    const r = d.retracted && typeof d.retracted === "object" ? d.retracted : null;
    const rms = r ? Date.parse(r.at) : Number.NaN;
    return [{
      entry: d.entry, ms, iso: d.at, value: d.value, source: String(d.source ?? ""),
      retracted: r ? { reason: String(r.reason ?? ""), by: String(r.by ?? ""), ms: Number.isFinite(rms) ? rms : null } : null,
    }];
  });
}

/** The device reading a drawn point is — not withdrawn, at its instant, with its value — or null (`handEntryOf`'s
 *  rule, for the other source). */
export function deviceEntryOf(device, point) {
  if (!point || !Array.isArray(device)) return null;
  return device.find((d) => d.retracted === null && d.ms === point.ms && d.value === point.value) ?? null;
}

/** [sinceMs, untilMs] onto [left, right]. */
```

- [ ] **Step 3: The table (`TrendTable.jsx`)**

In `dashboard/src/live/screens/patient/trends/TrendTable.jsx`, find (line 14):

```jsx
// take focus (`tabIndex={-1}`): after a withdrawal the dialog puts focus there, because the button that had it is gone.
```

Replace with:

```jsx
// take focus (`tabIndex={-1}`): after a withdrawal the dialog puts focus there, because the button that had it is gone.
//
// G3-05 (D16): a reading a device sent says «cihaz», and to a `clinical.chart` holder offers «Düzelt» (the host
// opens it, `onCorrect`) on a value of the bedside set. A withdrawn device reading is a struck row like a hand
// entry's, and says «cihaz». A reading that is both lists (the same instant and value) is shown as the hand entry.
```

In the same file, find (line 24):

```jsx
import { handEntryOf } from "./trendGeometry.js";
```

Replace with:

```jsx
import { deviceEntryOf, handEntryOf } from "./trendGeometry.js";
```

In the same file, find (lines 44–46):

```jsx
        ? [{ ms: p.ms, rank: i, order: j, key: keyed(`${s.key}-${p.iso}`), series: s, p, hand: handEntryOf(series[i]?.manual, p) }]
        : []
    ))),
```

Replace with:

```jsx
        ? [{ ms: p.ms, rank: i, order: j, key: keyed(`${s.key}-${p.iso}`), series: s, p, hand: handEntryOf(series[i]?.manual, p),
          device: deviceEntryOf(series[i]?.device, p) }]
        : []
    ))),
```

In the same file, find (line 73):

```jsx
export function TrendTable({ card, channels, series, markers, hours, canRetract = false, onWithdraw }) {
```

Replace with:

```jsx
export function TrendTable({ card, channels, series, markers, hours, canRetract = false, onWithdraw, canCorrect = false, onCorrect }) {
```

In the same file, find (lines 112–113):

```jsx
              <span className="font-semibold">{t("olcum.hand")}</span>{" "}
              {t("olcum.retracted", {
```

Replace with:

```jsx
              <span className="font-semibold">{t(row.withdrawn.origin === "device" ? "olcum.device" : "olcum.hand")}</span>{" "}
              {t("olcum.retracted", {
```

In the same file, find (lines 123–124):

```jsx
            offer={Boolean(row.hand) && canRetract && isBedsideCode(row.series.key)} onWithdraw={onWithdraw}
          />
```

Replace with:

```jsx
            offer={Boolean(row.hand) && canRetract && isBedsideCode(row.series.key)} onWithdraw={onWithdraw}
            offerCorrect={!row.hand && Boolean(row.device) && canCorrect && isBedsideCode(row.series.key)} onCorrect={onCorrect}
          />
```

In the same file, find (lines 134–136):

```jsx
function ReadingRow({ row, id, two, hours, news2, offer, onWithdraw }) {
  const { t } = useI18n();
  const ids = offer ? { time: `${id}-t`, series: two ? `${id}-s` : undefined, value: `${id}-v` } : {};
```

Replace with:

```jsx
function ReadingRow({ row, id, two, hours, news2, offer, onWithdraw, offerCorrect = false, onCorrect }) {
  const { t } = useI18n();
  const ids = offer || offerCorrect ? { time: `${id}-t`, series: two ? `${id}-s` : undefined, value: `${id}-v` } : {};
```

In the same file, find (line 145):

```jsx
        {row.hand ? <span className="font-semibold">{t("olcum.hand")}</span> : null}
```

Replace with:

```jsx
        {row.hand ? <span className="font-semibold">{t("olcum.hand")}</span> : null}
        {!row.hand && row.device ? <span className="font-semibold">{t("olcum.device")}</span> : null}
        {offerCorrect ? (
          <Button
            size="sm" variant="ghost" icon="edit" className="ml-2"
            aria-describedby={[ids.time, ids.series, ids.value].filter(Boolean).join(" ")} onClick={() => onCorrect(row.series, row.device)}
          >
            {t("kayit.correct")}
          </Button>
        ) : null}
```

- [ ] **Step 4: The dialog's host (`TrendModal.jsx`, `TrendsBox.jsx`)**

In `dashboard/src/live/screens/patient/trends/TrendModal.jsx`, find (line 27):

```jsx
// read again — the withdrawal changed the record the chart draws.
```

Replace with:

```jsx
// read again — the withdrawal changed the record the chart draws.
//
// G3-05 (D16): a device reading says «cihaz» in the table, and a `clinical.chart` holder corrects one there with
// «Düzelt» (readings/CorrectDialog.jsx): the withdrawal through `onRetract`, the right value through `onChart`,
// then the same re-read. A withdrawn device reading is drawn crossed and listed struck, as a hand entry's.
```

In the same file, find (lines 37–38):

```jsx
import { RetractDialog } from "../../common/RetractDialog.jsx";
import { cardTitle, channelsOf } from "./cards.js";
```

Replace with:

```jsx
import { RetractDialog } from "../../common/RetractDialog.jsx";
import { CorrectDialog } from "../readings/CorrectDialog.jsx";
import { sourceText } from "../readings/ReadingsBox.jsx";
import { cardTitle, channelsOf } from "./cards.js";
```

In the same file, find (line 44):

```jsx
import { handEntryOf, indexAtTime, marksAtTime, parseManual, parseMarkers, parsePoints, validWindow } from "./trendGeometry.js";
```

Replace with:

```jsx
import { handEntryOf, indexAtTime, marksAtTime, parseDevice, parseManual, parseMarkers, parsePoints, validWindow } from "./trendGeometry.js";
```

In the same file, find (line 137):

```jsx
export function TrendModal({ card, patient, bed, onClose, canRetract = false, onRetract }) {
```

Replace with:

```jsx
export function TrendModal({ card, patient, bed, onClose, canRetract = false, onRetract, onChart }) {
```

In the same file, find (line 145):

```jsx
  const [withdrawing, setWithdrawing] = useState(null);   // G3-01: { series, entry } whose «hatalı giriş» is open
```

Replace with:

```jsx
  const [withdrawing, setWithdrawing] = useState(null);   // G3-01: { series, entry } whose «hatalı giriş» is open
  const [correcting, setCorrecting] = useState(null);     // G3-05: { series, entry } — a device reading whose «Düzelt» is open
```

In the same file, find (lines 151–154):

```jsx
  useEffect(() => {
    setWithdrawing(null);
    struck.current = null;
  }, [patient.patient_id]);
```

Replace with:

```jsx
  useEffect(() => {
    setWithdrawing(null);
    setCorrecting(null);
    struck.current = null;
  }, [patient.patient_id]);
```

In the same file, find (lines 161–165):

```jsx
      const manual = parseManual(byKey[s.key]?.manual);
      return {
        key: s.key, color: s.color, hollow: s.hollow, points: parsePoints(byKey[s.key]?.points),
        manual, withdrawn: manual.filter((m) => m.retracted !== null),
      };
```

Replace with:

```jsx
      const manual = parseManual(byKey[s.key]?.manual);
      // G3-05 (D16): the device's readings, and its withdrawn ones beside the hand's — marked, so the table can say whose.
      const device = parseDevice(byKey[s.key]?.device);
      const withdrawn = [...manual.filter((m) => m.retracted !== null),
        ...device.filter((d) => d.retracted !== null).map((d) => ({ ...d, origin: "device" }))];
      return {
        key: s.key, color: s.color, hollow: s.hollow, points: parsePoints(byKey[s.key]?.points),
        manual, device, withdrawn,
      };
```

In the same file, find (line 191):

```jsx
  const noData = count === 0 && !series.some((s) => s.manual.length > 0);
```

Replace with:

```jsx
  const noData = count === 0 && !series.some((s) => s.manual.length > 0 || s.withdrawn.length > 0);
```

In the same file, find (line 205):

```jsx
    if (pending === null || withdrawing !== null) return;
```

Replace with:

```jsx
    if (pending === null || withdrawing !== null || correcting !== null) return;
```

In the same file, find (line 215):

```jsx
  }, [trends.data, withdrawing]);
```

Replace with:

```jsx
  }, [trends.data, withdrawing, correcting]);
```

In the same file, find (lines 285–286):

```jsx
            canRetract={canRetract && typeof onRetract === "function"}
            onWithdraw={(s, entry) => setWithdrawing({ series: s, entry })} />
```

Replace with:

```jsx
            canRetract={canRetract && typeof onRetract === "function"}
            onWithdraw={(s, entry) => setWithdrawing({ series: s, entry })}
            canCorrect={canRetract && typeof onRetract === "function" && typeof onChart === "function"}
            onCorrect={(s, entry) => setCorrecting({ series: s, entry })} />
```

In the same file, find (lines 314–317):

```jsx
          onClose={() => setWithdrawing(null)}
        />
      ) : null}
    </Modal>
```

Replace with:

```jsx
          onClose={() => setWithdrawing(null)}
        />
      ) : null}
      {correcting ? (
        <CorrectDialog
          bed={bed} nowMs={Date.now()}
          what={{
            code: correcting.series.key, label: t(correcting.series.labelKey),
            value: `${correcting.entry.value} ${t(correcting.series.unitKey)}`,
            time: dayStamp(correcting.entry.ms, Date.now()), observedMs: correcting.entry.ms,
            source: sourceText(t, "device", correcting.entry.source, null),
          }}
          onRetract={(reason) => onRetract(correcting.entry.entry, reason)}
          onChart={onChart}
          // Every ending re-reads; focus waits for that answer, as after a hand entry's withdrawal.
          onDone={() => {
            struck.current = { entry: correcting.entry.entry, data: trends.data };
            trends.reload();
          }}
          onClose={() => setCorrecting(null)}
        />
      ) : null}
    </Modal>
```

In `dashboard/src/live/screens/patient/trends/TrendsBox.jsx`, find (line 116):

```jsx
            .finally(() => trends.reload())} />
```

Replace with:

```jsx
            .finally(() => trends.reload())}
          // G3-05 (D13): the right value of a corrected device reading — a hand entry at the reading's own time.
          onChart={(entries, at) => board.store.chart(patient.patient_id, entries, at)
            .then((answer) => {
              if (answer !== null) onWritten?.(patient.patient_id);
              return answer;
            })
            .finally(() => trends.reload())} />
```

- [ ] **Step 5: Run to see them pass, with the trend suites that were there**

Run: `cd /c/tmp/g3-cihaz-olcum/dashboard && npx vitest run src/live/screens/patient/trends 2>&1 | tail -6`
Expected: `Tests  229 passed (229)` in 9 files — the 7 new tests and every trend test that was there.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/g3-cihaz-olcum && git add -- dashboard/src/live/screens/patient/trends/trends.testutil.js dashboard/src/live/screens/patient/trends/TrendDevice.test.jsx dashboard/src/live/screens/patient/trends/trendGeometry.js dashboard/src/live/screens/patient/trends/TrendTable.jsx dashboard/src/live/screens/patient/trends/TrendModal.jsx dashboard/src/live/screens/patient/trends/TrendsBox.jsx && git commit -m "feat(dashboard): the trend table says «cihaz» and offers «Düzelt» on a device reading (G3-05 W3)" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>" -- dashboard/src/live/screens/patient/trends/trends.testutil.js dashboard/src/live/screens/patient/trends/TrendDevice.test.jsx dashboard/src/live/screens/patient/trends/trendGeometry.js dashboard/src/live/screens/patient/trends/TrendTable.jsx dashboard/src/live/screens/patient/trends/TrendModal.jsx dashboard/src/live/screens/patient/trends/TrendsBox.jsx
```

---

### Task W4: «Eşleşmeyen ölçümler» on the bedside page, and the rail's badge (D10, D11, D17)

**Files:**
- Test: `dashboard/src/live/data/UnmatchedProvider.test.jsx` (new)
- Test: `dashboard/src/live/screens/bedside/unmatched.testutil.js` (new)
- Create: `dashboard/src/live/data/UnmatchedProvider.jsx`
- Test: `dashboard/src/live/screens/bedside/UnmatchedStep.test.jsx` (new)
- Create: `dashboard/src/live/screens/bedside/PickSteps.jsx`
- Modify: `dashboard/src/live/screens/bedside/BedsideScreen.jsx` — lines 25–111, line 22, lines 52–53, lines 78–79, lines 98–101 (as each step finds the file)
- Create: `dashboard/src/live/screens/bedside/UnmatchedStep.jsx`
- Modify: `dashboard/src/live/shell/Shell.jsx` — line 31, lines 237–238, lines 268–269 (as each step finds the file)
- Modify: `dashboard/src/live/shell/Sidebar.jsx` — line 16, line 23, line 85, line 111 (as each step finds the file)
- Test: `dashboard/src/live/rawKeys.test.jsx` — line 315, line 51 (as each step finds the file)

The list lives inside «Yatak başı ölçüm» (`/olcum`) — no new route and no new lazy chunk (D17): a button on the page's first step opens it; each waiting set shows the number as it was typed, why it matched nobody, the device, the measurement time and the values; «Hastaya bağla» walks the page's own patient list and identity question before the link is sent (D11), «Reddet» asks for a reason. The `olcum` rail entry carries a neutral count badge.

One shell-wide provider reads `GET /readings/unmatched` every 60 seconds for a `clinical.chart` holder; the badge and the step read it. A count is shown only from the last read that succeeded — a number that may be out of date is not a count.

The bedside page's patient list and identity question move, unchanged, into a file of their own (`PickSteps.jsx`) so the new step reuses them rather than copying them; the identity question gains its title, question and two button texts as optional props.

- [ ] **Step 1: The provider — failing test, then the code**

Create `dashboard/src/live/data/UnmatchedProvider.test.jsx`:

```jsx
// UnmatchedProvider.test.jsx — G3-05 (D17): the shell-wide read of the unmatched readings, for the rail's badge and
// the bedside page's step. Synthetic sets only.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, screen } from "@testing-library/react";
import { mount, refusal } from "../session/mount.testutil.jsx";
import { profile, token } from "../session/testTokens.testutil.js";
import { NOW } from "./board.testutil.js";
import { UNMATCHED_POLL_MS, UnmatchedProvider, useUnmatched } from "./UnmatchedProvider.jsx";
import { unmatched } from "../screens/bedside/unmatched.testutil.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const CHART = ["board.view", "clinical.chart"];

function Probe() {
  const { count, sets, phase } = useUnmatched();
  return <p data-probe="">{`${phase}:${count === null ? "null" : count}:${sets.length}`}</p>;
}
const probe = () => document.querySelector("[data-probe]").textContent;

async function open({ perms = CHART, setup } = {}) {
  const mounted = await mount(<UnmatchedProvider><Probe /></UnmatchedProvider>, {
    access: token({ perms }), me: profile({ perms }),
    setup: (api) => { api.unmatchedReadings.mockResolvedValue(unmatched()); setup?.(api); },
  });
  await act(async () => { await settle(); });
  return mounted;
}

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(NOW); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the unmatched readings, read once for the shell", () => {
  it("reads the list for a clinical.chart holder and counts its sets", async () => {
    const { api } = await open();
    expect(api.unmatchedReadings).toHaveBeenCalledTimes(1);
    expect(probe()).toBe("known:2:2");
  });

  it("asks nothing without clinical.chart", async () => {
    const { api } = await open({ perms: ["board.view"] });
    expect(api.unmatchedReadings).not.toHaveBeenCalled();
    expect(probe()).toBe("unasked:null:0");
  });

  it("reads again every 60 seconds", async () => {
    const { api } = await open();
    await act(async () => { vi.advanceTimersByTime(UNMATCHED_POLL_MS); await settle(); });
    expect(api.unmatchedReadings).toHaveBeenCalledTimes(2);
    expect(UNMATCHED_POLL_MS).toBe(60_000);
  });

  it("a failed read keeps the last sets but no count: a number that may be old is not a count", async () => {
    const { api } = await open();
    api.unmatchedReadings.mockRejectedValue(refusal(503, "kapsam şu anda okunamıyor"));
    await act(async () => { vi.advanceTimersByTime(UNMATCHED_POLL_MS); await settle(); });
    expect(probe()).toBe("stale:null:2");
  });

  it("an answer that is not a list is a failed read", async () => {
    await open({ setup: (api) => api.unmatchedReadings.mockResolvedValue({ nope: true }) });
    expect(probe()).toBe("failed:null:0");
  });

  it("outside a provider nothing is asked and nothing is counted", async () => {
    const mounted = await mount(<Probe />, { access: token({ perms: CHART }), me: profile({ perms: CHART }) });
    expect(mounted.api.unmatchedReadings).not.toHaveBeenCalled();
    expect(screen.getByText("unasked:null:0")).toBeInTheDocument();
  });
});
```

Create `dashboard/src/live/screens/bedside/unmatched.testutil.js`:

```js
// Test-only: GET /readings/unmatched as the engine answers it (spec §4, homunculus-engine api/readings.py
// `unmatched_sets`), on synthetic sets. Two wait: a round typed under a number nobody is admitted under, twenty
// minutes before NOW, and one value for a discharged patient's number that is too old to link. The numbers are
// synthetic 12-digit protocols; the device name is made up.
import { NOW } from "../../data/board.testutil.js";

const iso = (ms) => new Date(ms).toISOString();
export const TYPO = "202600000010";
export const GONE = "202600000003";
export const ROUND_AT = NOW - 20 * 60_000;
export const OLD_AT = NOW - 30 * 3_600_000;

export const ROUND = {
  received_key: TYPO, reason: "unknown", source: "CONNEX-3A", observed_at: iso(ROUND_AT), received_at: iso(ROUND_AT + 15_000),
  linkable: true,
  readings: [{ id: 7, code: "heart_rate", value: 88, unit: "/min" }, { id: 8, code: "spo2", value: 97, unit: "%" }],
};
export const OLD = {
  received_key: GONE, reason: "discharged", source: "CONNEX-3B", observed_at: iso(OLD_AT), received_at: iso(OLD_AT + 15_000),
  linkable: false,
  readings: [{ id: 5, code: "temperature", value: 37.4, unit: "°C" }],
};

/** The answer, newest arrival first; `sets` in place of the two. */
export const unmatched = (sets = [ROUND, OLD]) => ({ count: sets.length, sets });
```

Run: `cd /c/tmp/g3-cihaz-olcum/dashboard && npx vitest run src/live/data/UnmatchedProvider.test.jsx 2>&1 | tail -6`
Expected: the file fails to load — `Failed to resolve import "./UnmatchedProvider.jsx"`.

Create `dashboard/src/live/data/UnmatchedProvider.jsx`:

```jsx
// src/live/data/UnmatchedProvider.jsx — the unmatched readings, read once for the whole shell (G3-05, D17): the
// rail's badge on «Yatak başı ölçüm» and that page's «Eşleşmeyen ölçümler» step read the same answer
// (GET /readings/unmatched; homunculus-engine api/readings.py).
//
//   const { sets, count, phase, error, reload } = useUnmatched();
//
// `phase`: "unasked" (this session does not hold `clinical.chart`, so the route is not called), "loading", "known",
// "stale" (a read failed; the last sets stand) or "failed" (none has answered). `count` is the number of waiting
// SETS, and only from a read that succeeded: in every other phase it is null — a number that may be out of date is
// not a count, and the badge shows nothing rather than a number the ward would take for current.
// `reload()` reads now and resolves to the sets it read (null when the read failed or was not asked): the step calls
// it after a link or a rejection. Every call goes through the session's `track`, as the board's do.
// Outside a provider (a screen mounted alone in a test) the context is empty: nothing is called.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "../session/SessionProvider.jsx";

/** D17: the list is polled every 60 seconds. */
export const UNMATCHED_POLL_MS = 60_000;
/** The right the three routes ask for (api/readings.py CLINICAL_CHART). */
export const UNMATCHED_PERM = "clinical.chart";

const NONE = Object.freeze({ sets: Object.freeze([]), count: null, phase: "unasked", error: null, reload: async () => null });
const UnmatchedContext = createContext(NONE);

export function UnmatchedProvider({ children }) {
  const { user, store } = useSession();
  const may = user?.perms?.includes(UNMATCHED_PERM) ?? false;
  const [state, setState] = useState(() => ({ sets: null, phase: may ? "loading" : "unasked", error: null }));
  const seq = useRef(0);
  const mounted = useRef(false);

  const reload = useCallback(async () => {
    // Every call takes a number first: an answer overtaken by a later read is dropped.
    const mine = seq.current + 1;
    seq.current = mine;
    if (!may) {
      setState({ sets: null, phase: "unasked", error: null });
      return null;
    }
    try {
      const answer = await store.track(() => store.api.unmatchedReadings());
      if (!answer || !Array.isArray(answer.sets)) throw new Error("not an unmatched list");
      if (mounted.current && seq.current === mine) setState({ sets: answer.sets, phase: "known", error: null });
      return answer.sets;
    } catch (error) {
      if (error?.superseded) return null;
      if (mounted.current && seq.current === mine) {
        setState((prev) => ({ sets: prev.sets, phase: prev.sets ? "stale" : "failed", error }));
      }
      return null;
    }
  }, [may, store]);

  useEffect(() => {
    mounted.current = true;
    reload();
    const timer = may ? setInterval(reload, UNMATCHED_POLL_MS) : 0;
    return () => {
      mounted.current = false;
      seq.current += 1;          // a read in flight lands nowhere
      clearInterval(timer);
    };
  }, [reload, may]);

  const value = useMemo(() => ({
    sets: state.sets ?? NONE.sets,
    count: state.phase === "known" ? state.sets.length : null,
    phase: state.phase, error: state.error, reload,
  }), [state, reload]);
  return <UnmatchedContext.Provider value={value}>{children}</UnmatchedContext.Provider>;
}

/** The unmatched readings as the shell holds them. */
export const useUnmatched = () => useContext(UnmatchedContext);
```

Run: `cd /c/tmp/g3-cihaz-olcum/dashboard && npx vitest run src/live/data/UnmatchedProvider.test.jsx 2>&1 | tail -6`
Expected: `Tests  6 passed (6)`.

- [ ] **Step 2: The step and the badge — the failing tests**

Create `dashboard/src/live/screens/bedside/UnmatchedStep.test.jsx`:

```jsx
// UnmatchedStep.test.jsx — G3-05 (D10, D11, D17): «Eşleşmeyen ölçümler» inside the bedside page — the waiting sets,
// the link through the page's own patient list and identity question, the rejection with its reason — and the
// rail's count. Synthetic cards and sets only (board.testutil.js, unmatched.testutil.js).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { NOW, board, entry, identity } from "../../data/board.testutil.js";
import { UnmatchedProvider } from "../../data/UnmatchedProvider.jsx";
import { dayStamp } from "../../i18n/dates.js";
import { Sidebar } from "../../shell/Sidebar.jsx";
import { BedsideScreen } from "./BedsideScreen.jsx";
import { GONE, OLD, OLD_AT, ROUND, ROUND_AT, TYPO, unmatched } from "./unmatched.testutil.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const CHART = ["board.view", "clinical.chart"];
const AYSE = entry("S-001", [], { identity: identity({ birth_date: "1970-05-05" }) });
const VUSAL = entry("S-002", [], { identity: identity({ patient_id: "S-002", display_name: "Vüsal Sınaq", bed_label: "REA-01 · 1",
  bed_id: "REA-01-1", bed_key: "REA^01^1" }) });
const WHY = "yanlış numara girilmiş, hasta bulunamadı";

/** The page inside the shell's provider, the board LIVE, the list answering `sets`. */
async function open({ sets = [ROUND, OLD], perms = CHART, rail = false, setup } = {}) {
  const mounted = await mount(
    <UnmatchedProvider>{rail ? <Sidebar perms={perms} current="olcum" /> : null}<BedsideScreen /></UnmatchedProvider>, {
      access: token({ perms }), me: profile({ perms }),
      setup: (api) => {
        api.boardPatients.mockResolvedValue(board([AYSE, VUSAL]));
        api.streamTicket.mockResolvedValue({ ticket: "t-1" });
        api.unmatchedReadings.mockResolvedValue(unmatched(sets));
        api.assignReadings.mockResolvedValue({ assigned: [7, 8], patient_id: "S-001", alerts: [] });
        api.rejectReadings.mockResolvedValue({ rejected: [7, 8] });
        setup?.(api);
      },
    });
  await act(async () => { await mounted.board.start(); });
  await act(async () => { mounted.stream.open(); await settle(); });
  return mounted;
}
const press = (el) => act(async () => { fireEvent.click(el); await settle(); });
const button = (name) => screen.getByRole("button", { name });
const toasted = (text) => within(screen.getByRole("region", { name: "Bildirişlər" })).queryAllByText(text);
const setRows = () => [...document.querySelectorAll("[data-um-set]")];
const openList = () => press(button(/^Uyğunlaşmayan ölçmələr/));

beforeEach(() => { vi.setSystemTime(NOW); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the way in", () => {
  it("the page's first step offers the list, with how many sets wait", async () => {
    await open();
    expect(button("Uyğunlaşmayan ölçmələr · 2")).toBeInTheDocument();
  });

  it("with nothing waiting the button carries no number", async () => {
    await open({ sets: [] });
    expect(button("Uyğunlaşmayan ölçmələr")).toBeInTheDocument();
    await openList();
    expect(screen.getByText("Gözləyən uyğunlaşmayan ölçmə yoxdur.")).toBeInTheDocument();
  });
});

describe("the list", () => {
  it("shows each set: the number as typed, why it matched nobody, the device, the time and the values", async () => {
    await open();
    await openList();
    expect(screen.getByRole("heading", { level: 2, name: "Uyğunlaşmayan ölçmələr" })).toBeInTheDocument();
    expect(setRows().map((r) => r.getAttribute("data-um-set"))).toEqual([TYPO, GONE]);
    const [round, old] = setRows();
    expect(round).toHaveTextContent(`Daxil edilən nömrə ${TYPO}`);
    expect(round).toHaveTextContent("nömrə heç bir yatışla uyğun gəlmədi");
    expect(round).toHaveTextContent("cihaz: CONNEX-3A");
    expect(round).toHaveTextContent(`ölçmə ${dayStamp(ROUND_AT, NOW)}`);
    expect(round).toHaveTextContent("Nəbz 88 /dəq");
    expect(round).toHaveTextContent("SpO2 97 %");
    expect(old).toHaveTextContent("evə yazılmış xəstənin nömrəsi");
    expect(old).toHaveTextContent(`ölçmə ${dayStamp(OLD_AT, NOW)}`);
  });

  it("a set the engine marks as not linkable offers only the rejection, and says why", async () => {
    await open();
    await openList();
    const [round, old] = setRows();
    expect(within(round).getByRole("button", { name: "Xəstəyə bağla" })).toBeInTheDocument();
    expect(within(old).queryByRole("button", { name: "Xəstəyə bağla" })).toBeNull();
    expect(old).toHaveTextContent("24 saatdan köhnədir: bağlana bilməz, yalnız rədd edilir.");
    expect(within(old).getByRole("button", { name: "Rədd et" })).toBeInTheDocument();
  });

  it("«Geri» goes back to the patient list", async () => {
    await open();
    await openList();
    await press(button("Geriyə"));
    expect(document.querySelectorAll("[data-pick]")).toHaveLength(2);
    expect(screen.getByRole("heading", { level: 2, name: "Xəstəni seçin" })).toBeInTheDocument();
  });

  it("says why when the list cannot be read", async () => {
    await open({ setup: (api) => api.unmatchedReadings.mockRejectedValue(refusal(503, "kapsam şu anda okunamıyor")) });
    await press(button("Uyğunlaşmayan ölçmələr"));
    expect(screen.getByText(/^Uyğunlaşmayan ölçmələr oxunmadı: /)).toBeInTheDocument();
  });
});

describe("linking a set to a patient", () => {
  async function toConfirm(extra) {
    const mounted = await open(extra);
    await openList();
    await press(within(setRows()[0]).getByRole("button", { name: "Xəstəyə bağla" }));
    expect(screen.getByRole("heading", { level: 2, name: "Bu ölçmə hansı xəstənindir?" })).toBeInTheDocument();
    await press(document.querySelector("[data-pick='S-001']"));
    return mounted;
  }

  it("asks the page's identity question, with the set's values, before anything is sent", async () => {
    const { api } = await toConfirm();
    expect(screen.getByRole("heading", { level: 2, name: "Bağlamanı təsdiqləyin" })).toBeInTheDocument();
    expect(screen.getByText("Ayşe Sentetik")).toBeInTheDocument();
    expect(screen.getByText("1970")).toBeInTheDocument();
    expect(screen.getByText("Bu ölçmə bu xəstəyə aiddirmi? Soyad, ad və doğum ili xəstə ilə uyğun gəlirmi?")).toBeInTheDocument();
    expect(document.querySelector("[data-um-values]")).toHaveTextContent("Nəbz 88 /dəq");
    expect(api.assignReadings).not.toHaveBeenCalled();
  });

  it("«Bəli, bağla» sends the set's ids and the patient, says so, and reads the list again", async () => {
    const { api } = await toConfirm();
    api.unmatchedReadings.mockResolvedValue(unmatched([OLD]));
    await press(button("Bəli, bağla"));
    expect(api.assignReadings).toHaveBeenCalledWith([7, 8], "S-001");
    expect(toasted("REA-01 · 2: ölçmə xəstəyə bağlandı.").length).toBeGreaterThan(0);
    expect(setRows().map((r) => r.getAttribute("data-um-set"))).toEqual([GONE]);
    expect(api.boardPatients.mock.calls.length).toBeGreaterThan(1);       // the card changed: the board reloaded
  });

  it("«Xeyr, imtina» goes back to the list and sends nothing", async () => {
    const { api } = await toConfirm();
    await press(button("Xeyr, imtina"));
    expect(api.assignReadings).not.toHaveBeenCalled();
    expect(setRows()).toHaveLength(2);
  });

  it("a refusal is said in the reader's words, named after the bed, and the list is read again", async () => {
    const { api } = await toConfirm({ setup: (a) => a.assignReadings.mockRejectedValue(
      refusal(409, "The reading is no longer waiting: it was linked or rejected already.", { apiCode: "reading_not_unmatched" })) });
    const reads = api.unmatchedReadings.mock.calls.length;
    await press(button("Bəli, bağla"));
    expect(toasted("REA-01 · 2: xəstəyə bağlanmadı — Bu ölçmə artıq gözləmir: bağlanıb və ya rədd edilib.").length).toBeGreaterThan(0);
    expect(api.unmatchedReadings.mock.calls.length).toBeGreaterThan(reads);
    expect(screen.getByRole("heading", { level: 2, name: "Uyğunlaşmayan ölçmələr" })).toBeInTheDocument();
  });

  it("a second press while the link is in flight sends nothing more", async () => {
    let finish;
    const { api } = await toConfirm({ setup: (a) => a.assignReadings.mockImplementation(() => new Promise((resolve) => { finish = resolve; })) });
    fireEvent.click(button("Bəli, bağla"));
    fireEvent.click(button("Bəli, bağla"));
    await act(async () => { finish({ assigned: [7, 8], patient_id: "S-001", alerts: [] }); await settle(); });
    expect(api.assignReadings).toHaveBeenCalledTimes(1);
  });
});

describe("rejecting a set", () => {
  const dialog = () => screen.getByRole("dialog");
  async function toDialog(extra) {
    const mounted = await open(extra);
    await openList();
    await press(within(setRows()[0]).getByRole("button", { name: "Rədd et" }));
    return mounted;
  }
  const type = (text) => act(async () => { fireEvent.change(within(dialog()).getByLabelText(/^Səbəb/), { target: { value: text } }); await settle(); });

  it("asks for a reason and says the values are kept", async () => {
    const { api } = await toDialog();
    expect(within(dialog()).getByRole("heading", { name: `Ölçməni rədd et · ${TYPO}` })).toBeInTheDocument();
    expect(dialog()).toHaveTextContent("qeyddə qalır");
    await type("qısa");
    await press(within(dialog()).getByRole("button", { name: "Rədd et" }));
    expect(api.rejectReadings).not.toHaveBeenCalled();
  });

  it("sends the set's ids with the reason, says so, and reads the list again", async () => {
    const { api } = await toDialog();
    api.unmatchedReadings.mockResolvedValue(unmatched([OLD]));
    await type(`  ${WHY}  `);
    await press(within(dialog()).getByRole("button", { name: "Rədd et" }));
    expect(api.rejectReadings).toHaveBeenCalledWith([7, 8], WHY);
    expect(toasted(`Nömrə ${TYPO}: ölçmə rədd edildi.`).length).toBeGreaterThan(0);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(setRows().map((r) => r.getAttribute("data-um-set"))).toEqual([GONE]);
  });

  it("a refusal is said, and the dialog closes on anything but a reason the engine finds wrong", async () => {
    const { api } = await toDialog({ setup: (a) => a.rejectReadings.mockRejectedValue(
      refusal(409, "The reading is no longer waiting: it was linked or rejected already.", { apiCode: "reading_not_unmatched" })) });
    await type(WHY);
    await press(within(dialog()).getByRole("button", { name: "Rədd et" }));
    expect(api.rejectReadings).toHaveBeenCalledTimes(1);
    expect(toasted(`Nömrə ${TYPO}: rədd edilmədi — Bu ölçmə artıq gözləmir: bağlanıb və ya rədd edilib.`).length).toBeGreaterThan(0);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("the rail's badge", () => {
  const entryOf = () => document.querySelector("nav a[href='#/olcum']");

  it("shows how many sets wait, in a neutral tone, and says it in words", async () => {
    await open({ rail: true });
    const badge = entryOf().querySelector("[data-rail-badge='unmatched']");
    expect(badge).toHaveTextContent("2");
    expect(badge.className).not.toMatch(/bg-crit|bg-mid/);
    expect(entryOf()).toHaveTextContent("2 uyğunlaşmayan ölçmə");
  });

  it("shows nothing when nothing waits, and nothing when the list could not be read", async () => {
    await open({ rail: true, sets: [] });
    expect(entryOf().querySelector("[data-rail-badge]")).toBeNull();
    cleanup();
    await open({ rail: true, setup: (api) => api.unmatchedReadings.mockRejectedValue(refusal(503, "down")) });
    expect(entryOf().querySelector("[data-rail-badge]")).toBeNull();
  });
});
```

Run: `cd /c/tmp/g3-cihaz-olcum/dashboard && npx vitest run src/live/screens/bedside/UnmatchedStep.test.jsx 2>&1 | tail -6`
Expected: every test fails — the page has no «Uyğunlaşmayan ölçmələr» button and the rail no badge.

- [ ] **Step 3: The patient list and the identity question move to a file of their own**

Create `dashboard/src/live/screens/bedside/PickSteps.jsx`:

```jsx
// src/live/screens/bedside/PickSteps.jsx — the bedside page's two steps that say WHO: the patient list and the
// identity question (G3-01, D3, X9, X13). Moved here unchanged from BedsideScreen.jsx (G3-05), so that the page's
// «Eşleşmeyen ölçümler» step asks the very same question before it links a reading (spec D11) instead of a copy.
//
// THE LIST is the board this session already has — the engine's scope filter decides who is on it — each patient by
// bed, name, age and when a NEWS2 input was last measured, by anything (the board carries no source per value).
// THE QUESTION (X9): the name and the year of birth the HIS sent, and the bed. A patient with no birth date says so;
// the question is asked all the same. The year is the HIS's, never one made up. The age of an infant is years,
// months and days (`ageOf`, `kabul.age`): whole years print «0 yaşında» for every baby on a NICU round.
import React from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { dayStamp } from "../../i18n/dates.js";
import { Box, Button, Note } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { nameOf } from "../common/BoardState.jsx";
import { bedNameOf } from "../beds/order.js";
import { ageOf } from "../kabul/admitForm.js";
import { birthYearOf, lastMeasuredMs } from "./vitalsFields.js";

export const bedOf = bedNameOf;

/** The board's day (YYYY-MM-DD, local, from the server-corrected clock): what `ageOf` counts to. */
const dayOf = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** «56 yaşında»; an infant under a year, «0 yaş 2 ay 5 gün». null for an age the board does not have. */
function ageLine(t, patient, nowMs) {
  if (!Number.isInteger(patient.age)) return null;
  if (patient.age === 0) {
    const exact = ageOf(String(patient.birthDate ?? "").slice(0, 10), dayOf(nowMs));
    if (exact) return t("kabul.age", exact);
  }
  return t("olcum.pickAge", { years: patient.age });
}

/** `known`: the board may be spoken of as current (LIVE). An empty list on any other board is no statement
 *  about the ward — the strip above says why — so «yatan xəstə yoxdur» is not written under it. */
export function PickList({ patients, nowMs, known, onPick }) {
  const { t } = useI18n();
  if (patients.length === 0) return known ? <Note tone="info" icon="bed">{t("olcum.pickEmpty")}</Note> : null;
  return (
    // role="list": a list with its bullets removed (`list-none`) stops being one for VoiceOver.
    <ul role="list" className="m-0 grid list-none gap-2 p-0 min-[640px]:grid-cols-2">
      {patients.map((p) => {
        const last = lastMeasuredMs(p);
        const facts = [
          ageLine(t, p, nowMs),
          last !== null ? t("olcum.pickLast", { time: dayStamp(last, nowMs) }) : t("olcum.pickNone"),
        ].filter(Boolean);
        return (
          <li key={p.patient_id}>
            <button
              type="button" data-pick={p.patient_id} onClick={() => onPick(p)}
              className={`block w-full rounded-box border border-line bg-card px-4 py-3 text-left ${FOCUS_RING}`}
            >
              <b className="block font-data text-17 font-bold text-ink">{bedOf(p)}</b>
              <span className={`block text-14.5 ${p.display_name ? "text-ink" : "italic text-mute"}`}>{nameOf(p, t)}</span>
              <span className="mt-1 block text-12 text-mute">{facts.join(" · ")}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** `title`, `ask`, `yes` and `no` are the bedside form's own words unless the host gives others (G3-05: the link of
 *  an unmatched reading asks its own question over the same three facts); `children` sit between the facts and the
 *  question (the reading being linked); `busy` holds the buttons while the host's write is out. */
export function IdentityStep({ patient, onYes, onNo, title, ask, yes, no, busy = false, children }) {
  const { t } = useI18n();
  const year = birthYearOf(patient.birthDate);
  const term = "font-semibold text-mute";
  return (
    <Box title={title ?? t("olcum.identityTitle")} icon="user" level={2}>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-14.5">
        <dt className={term}>{t("olcum.identityName")}</dt>
        <dd className={`m-0 font-bold ${patient.display_name ? "" : "italic text-mute"}`}>{nameOf(patient, t)}</dd>
        <dt className={term}>{t("olcum.identityYear")}</dt>
        <dd className="m-0">
          {year ? <b className="font-data">{year}</b> : <span className="italic text-mute">{t("olcum.identityNoBirth")}</span>}
        </dd>
        <dt className={term}>{t("olcum.identityBed")}</dt>
        <dd className="m-0 font-data font-bold">{bedOf(patient)}</dd>
      </dl>
      {children}
      <p className="m-0 mt-3 text-14.5 font-semibold">{ask ?? t("olcum.identityAsk")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="lg" variant="primary" icon="ok" onClick={onYes} busy={busy}>{yes ?? t("olcum.identityYes")}</Button>
        <Button size="lg" icon="x" onClick={onNo} busy={busy}>{no ?? t("olcum.identityNo")}</Button>
      </div>
    </Box>
  );
}
```

In `BedsideScreen.jsx` the same definitions are deleted and imported instead. The find block is the file's lines 25–111 as they are at this point — the imports, the two helpers, `PickList` and `IdentityStep`:

In `dashboard/src/live/screens/bedside/BedsideScreen.jsx`, find (lines 25–111):

```jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { dayStamp } from "../../i18n/dates.js";
import { useBoard } from "../../data/BoardProvider.jsx";
import { Announce, Box, Button, Note, useToast } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { BoardStrip, ScopeNote, boardKnown, nameOf, useBoardNow } from "../common/BoardState.jsx";
import { bedNameOf, orderBeds } from "../beds/order.js";
import { ageOf } from "../kabul/admitForm.js";
import { SavedStep } from "./SavedStep.jsx";
import { VitalsForm } from "./VitalsForm.jsx";
import { birthYearOf, lastMeasuredMs } from "./vitalsFields.js";

const TICK_MS = 30_000;
const bedOf = bedNameOf;

/** The board's day (YYYY-MM-DD, local, from the server-corrected clock): what `ageOf` counts to. */
const dayOf = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** «56 yaşında»; an infant under a year, «0 yaş 2 ay 5 gün». null for an age the board does not have. */
function ageLine(t, patient, nowMs) {
  if (!Number.isInteger(patient.age)) return null;
  if (patient.age === 0) {
    const exact = ageOf(String(patient.birthDate ?? "").slice(0, 10), dayOf(nowMs));
    if (exact) return t("kabul.age", exact);
  }
  return t("olcum.pickAge", { years: patient.age });
}

/** `known`: the board may be spoken of as current (LIVE). An empty list on any other board is no statement
 *  about the ward — the strip above says why — so «yatan xəstə yoxdur» is not written under it. */
function PickList({ patients, nowMs, known, onPick }) {
  const { t } = useI18n();
  if (patients.length === 0) return known ? <Note tone="info" icon="bed">{t("olcum.pickEmpty")}</Note> : null;
  return (
    // role="list": a list with its bullets removed (`list-none`) stops being one for VoiceOver.
    <ul role="list" className="m-0 grid list-none gap-2 p-0 min-[640px]:grid-cols-2">
      {patients.map((p) => {
        const last = lastMeasuredMs(p);
        const facts = [
          ageLine(t, p, nowMs),
          last !== null ? t("olcum.pickLast", { time: dayStamp(last, nowMs) }) : t("olcum.pickNone"),
        ].filter(Boolean);
        return (
          <li key={p.patient_id}>
            <button
              type="button" data-pick={p.patient_id} onClick={() => onPick(p)}
              className={`block w-full rounded-box border border-line bg-card px-4 py-3 text-left ${FOCUS_RING}`}
            >
              <b className="block font-data text-17 font-bold text-ink">{bedOf(p)}</b>
              <span className={`block text-14.5 ${p.display_name ? "text-ink" : "italic text-mute"}`}>{nameOf(p, t)}</span>
              <span className="mt-1 block text-12 text-mute">{facts.join(" · ")}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function IdentityStep({ patient, onYes, onNo }) {
  const { t } = useI18n();
  const year = birthYearOf(patient.birthDate);
  const term = "font-semibold text-mute";
  return (
    <Box title={t("olcum.identityTitle")} icon="user" level={2}>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-14.5">
        <dt className={term}>{t("olcum.identityName")}</dt>
        <dd className={`m-0 font-bold ${patient.display_name ? "" : "italic text-mute"}`}>{nameOf(patient, t)}</dd>
        <dt className={term}>{t("olcum.identityYear")}</dt>
        <dd className="m-0">
          {year ? <b className="font-data">{year}</b> : <span className="italic text-mute">{t("olcum.identityNoBirth")}</span>}
        </dd>
        <dt className={term}>{t("olcum.identityBed")}</dt>
        <dd className="m-0 font-data font-bold">{bedOf(patient)}</dd>
      </dl>
      <p className="m-0 mt-3 text-14.5 font-semibold">{t("olcum.identityAsk")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="lg" variant="primary" icon="ok" onClick={onYes}>{t("olcum.identityYes")}</Button>
        <Button size="lg" icon="x" onClick={onNo}>{t("olcum.identityNo")}</Button>
      </div>
    </Box>
  );
}
```

Replace with:

```jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { dayStamp } from "../../i18n/dates.js";
import { useBoard } from "../../data/BoardProvider.jsx";
import { useUnmatched } from "../../data/UnmatchedProvider.jsx";   // G3-05
import { Announce, Box, Button, Note, useToast } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { BoardStrip, ScopeNote, boardKnown, useBoardNow } from "../common/BoardState.jsx";
import { orderBeds } from "../beds/order.js";
// G3-05: the patient list and the identity question live in PickSteps.jsx now — the «Eşleşmeyen ölçümler» step
// (UnmatchedStep.jsx) asks the same question before it links a reading.
import { IdentityStep, PickList, bedOf } from "./PickSteps.jsx";
import { SavedStep } from "./SavedStep.jsx";
import { UnmatchedStep } from "./UnmatchedStep.jsx";
import { VitalsForm } from "./VitalsForm.jsx";

const TICK_MS = 30_000;
```

- [ ] **Step 4: The step**

Create `dashboard/src/live/screens/bedside/UnmatchedStep.jsx`:

```jsx
// src/live/screens/bedside/UnmatchedStep.jsx — «Eşleşmeyen ölçümler» (G3-05, D4, D10, D11, D17): the device readings
// whose number matched no stay, or a discharged patient's, kept with their values — a step of the bedside page.
//
// THE LIST is the shell's own read (data/UnmatchedProvider.jsx): one row per set — one number, one device, one time
// — with the number AS IT WAS TYPED, why it matched nobody, the device, the measurement time and the values. The
// engine has already left out what this session may not see (a discharged patient of another unit, D11) and says
// which sets can still be linked (`linkable`: the browser judges no age).
//
// «HASTAYA BAĞLA» walks the page's own two steps before anything is sent (D11): the patient list (the board in this
// session's scope), then the identity question — name, year of birth, bed — asked over the reading's values. Only
// «Evet, bağla» sends the link. The engine takes each reading at its own time, with the device as its source: the
// patient's card and scores change as if the device had sent the right number, and the board reloads.
// «REDDET» asks for a reason of 10–200 characters; the values stay in the record.
//
// THE ENGINE DECIDES: a refusal is said on the toast in the reader's words (apiErrors.js maps its code), named after
// the bed for a link and after the number for a rejection, and the list is read again either way — another desk may
// have got there first. A link with no answer may have landed: she is told where to look.
import React, { useId, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { dayStamp } from "../../i18n/dates.js";
import { numberText } from "../../i18n/numbers.js";
import { apiErrorText, readErrorText } from "../../apiErrors.js";
import { useBoard } from "../../data/BoardProvider.jsx";
import { useUnmatched } from "../../data/UnmatchedProvider.jsx";
import { Announce, Box, Button, Field, Input, Modal, Note, useToast } from "../../ui/index.js";
import { mayHaveLanded } from "../admin/refusal.js";
import { IdentityStep, PickList, bedOf } from "./PickSteps.jsx";
import { specOf, valueText } from "./vitalsFields.js";

/** The reason's bounds — api/readings.py REJECT_MIN_REASON_CHARS / REJECT_MAX_REASON_CHARS, mirrored only so the
 *  button can say why it waits and the box stops at the ceiling; the engine stays the judge. */
export const REJECT_MIN_REASON_CHARS = 10;
export const REJECT_MAX_REASON_CHARS = 200;

const timeOf = (iso) => {
  const ms = Date.parse(iso ?? "");
  return Number.isFinite(ms) ? ms : null;
};
const idsOf = (set) => (Array.isArray(set.readings) ? set.readings : []).map((r) => r.id).filter(Number.isInteger);
const keyOf = (set) => `${set.received_key}|${set.source}|${set.observed_at}`;

/** A set's values as one line: «Nabız 88 /dk · SpO2 97 %» — the bedside form's names and units for the codes it
 *  knows, the engine's code and number for any other. */
function SetValues({ set }) {
  const { t, lang } = useI18n();
  const parts = (Array.isArray(set.readings) ? set.readings : []).map((r) => {
    const spec = specOf(r.code);
    if (spec) return `${t(spec.labelKey)} ${valueText(t, r.code, r.value, lang)}`;
    const number = typeof r.value === "number" ? numberText(lang, r.value) : "—";
    return [String(r.code ?? "—"), number, r.unit].filter(Boolean).join(" ");
  });
  return <p data-um-values="" className="m-0 mt-1 font-data text-14.5 font-semibold text-ink">{parts.join(" · ")}</p>;
}

/** What a set is, in words: the number as typed, why it waits, the device, when it was measured. */
function SetFacts({ set, nowMs }) {
  const { t } = useI18n();
  const at = timeOf(set.observed_at);
  const facts = [
    t(set.reason === "discharged" ? "kayit.umReasonDischarged" : "kayit.umReasonUnknown"),
    set.source ? t("kayit.umDevice", { device: set.source }) : null,
    t("kayit.umMeasured", { time: at === null ? "—" : dayStamp(at, nowMs) }),
  ].filter(Boolean);
  return (
    <>
      <b className="block font-data text-15 font-bold text-ink">{t("kayit.umNumber", { number: set.received_key })}</b>
      <span className="block text-12.5 text-mute">{facts.join(" · ")}</span>
    </>
  );
}

function RejectDialog({ set, onReject, onClose }) {
  const { t } = useI18n();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const countId = useId();
  const introId = useId();
  const count = reason.trim().length;
  const short = count < REJECT_MIN_REASON_CHARS;
  const subject = t("kayit.umSubject", { number: set.received_key });

  async function confirm(event) {
    if ((event?.detail ?? 0) > 1 || short || sending.current) return;
    sending.current = true;
    setBusy(true);
    let close = true;
    try {
      const answer = await onReject(reason.trim());
      if (answer !== null) toast(t("kayit.umRejected", { subject }));
    } catch (err) {
      if (err?.superseded) return;
      toast(t("kayit.umRejectRefused", { subject, reason: err?.status === 403 ? t("kayit.noRight") : apiErrorText(t, err) }), "error");
      close = err?.apiCode !== "reading_reason_length";      // a reason the engine finds wrong keeps the dialog
    } finally {
      sending.current = false;
      setBusy(false);
    }
    if (close) onClose();
  }

  return (
    <Modal
      open title={t("kayit.umRejectTitle", { number: set.received_key })} onClose={onClose} busy={busy}
      actions={(
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          <p id={countId} className="m-0 mr-auto text-12 font-semibold text-mute">
            {t("kayit.correctCount", { count, min: REJECT_MIN_REASON_CHARS })}
          </p>
          <div className="ml-auto flex shrink-0 gap-2">
            <Button variant="ghost" onClick={onClose} busy={busy}>{t("common.cancel")}</Button>
            <Button variant="danger" onClick={confirm} busy={busy} aria-disabled={short ? "true" : undefined} aria-describedby={countId}>
              {t("kayit.umRejectConfirm")}
            </Button>
          </div>
        </div>
      )}
    >
      <form noValidate onSubmit={(event) => { event.preventDefault(); confirm(); }}>
        <SetValues set={set} />
        <Note tone="warn" icon="alert" className="mt-2"><span id={introId}>{t("kayit.umRejectIntro")}</span></Note>
        <div className="mt-3">
          <Field label={t("kayit.correctReason")} layout="col" required>
            <Input autoFocus autoComplete="off" maxLength={REJECT_MAX_REASON_CHARS} value={reason} readOnly={busy}
              onChange={(event) => setReason(event.target.value)} aria-describedby={introId} />
          </Field>
        </div>
      </form>
      <Announce text={busy ? t("kayit.saving") : ""} />
    </Modal>
  );
}

/** `patients` is the page's own list (the board, ordered by bed), `nowMs` its clock, `known` whether the board may
 *  be spoken of as current; `onBack` returns to the page's first step. */
export function UnmatchedStep({ patients, nowMs, known, onBack }) {
  const { t } = useI18n();
  const board = useBoard();
  const toast = useToast();
  const { sets, phase, error, reload } = useUnmatched();
  // { name: "list" } | { name: "pick", set } | { name: "confirm", set, id, bed }
  const [view, setView] = useState({ name: "list" });
  const [rejecting, setRejecting] = useState(null);
  const [linking, setLinking] = useState(false);
  const sending = useRef(false);
  const target = view.name === "confirm" ? patients.find((p) => p.patient_id === view.id) ?? null : null;

  async function link() {
    if (sending.current) return;
    sending.current = true;
    setLinking(true);
    const subject = view.bed;
    try {
      const answer = await board.store.assignReadings(idsOf(view.set), view.id);
      if (answer !== null) toast(t("kayit.umLinked", { subject }));
    } catch (err) {
      if (!err?.superseded) {
        if (mayHaveLanded(err)) toast(t("kayit.umLinkMayHaveLanded", { subject }), "warn");
        else toast(t("kayit.umLinkRefused", { subject, reason: err?.status === 403 ? t("kayit.noRight") : apiErrorText(t, err) }), "error");
      }
    } finally {
      sending.current = false;
      setLinking(false);
    }
    // Every ending reads the list again and goes back to it: the set is gone, or another desk got there first.
    await reload();
    setView({ name: "list" });
  }

  if (view.name === "pick") {
    return (
      <>
        <h2 className="m-0 mb-2 font-text text-11 font-bold uppercase tracking-[.08em] text-mute">{t("kayit.umPickTitle")}</h2>
        <div className="mb-2 rounded-box border border-line bg-card px-4 py-3">
          <SetFacts set={view.set} nowMs={nowMs} />
          <SetValues set={view.set} />
        </div>
        <PickList patients={patients} nowMs={nowMs} known={known}
          onPick={(p) => setView({ name: "confirm", set: view.set, id: p.patient_id, bed: bedOf(p) })} />
        <div className="mt-3"><Button icon="chevL" onClick={() => setView({ name: "list" })}>{t("kayit.umBack")}</Button></div>
      </>
    );
  }
  if (view.name === "confirm" && target) {
    return (
      <IdentityStep patient={target} busy={linking} onYes={link} onNo={() => setView({ name: "list" })}
        title={t("kayit.umConfirmTitle")} ask={t("kayit.umConfirmAsk")} yes={t("kayit.umConfirmYes")} no={t("kayit.umConfirmNo")}>
        <div className="mt-3 border-t border-line pt-2">
          <SetFacts set={view.set} nowMs={nowMs} />
          <SetValues set={view.set} />
        </div>
        <Announce text={linking ? t("kayit.umLinking") : ""} />
      </IdentityStep>
    );
  }
  return (
    <Box title={t("kayit.umTitle")} icon="link" level={2}>
      <p className="m-0 mb-2 text-12.5 text-mute">{t("kayit.umIntro")}</p>
      {error ? <Note tone="warn" icon="alert" className="mb-2">{t("kayit.umReadFailed", { reason: readErrorText(t, error) })}</Note> : null}
      {phase === "loading" ? <p className="m-0 text-13 text-mute">{t("kayit.umReading")}</p> : null}
      {phase === "known" && sets.length === 0 ? <p className="m-0 text-13 text-mute">{t("kayit.umEmpty")}</p> : null}
      {sets.length > 0 ? (
        // role="list": a list with its bullets removed (`list-none`) stops being one for VoiceOver.
        <ul role="list" className="m-0 list-none p-0">
          {sets.map((set) => (
            <li key={keyOf(set)} data-um-set={set.received_key} className="flex flex-wrap items-center gap-2 border-b border-line py-2.5 last:border-b-0">
              <span className="min-w-0 flex-1">
                <SetFacts set={set} nowMs={nowMs} />
                <SetValues set={set} />
                {set.linkable === true ? null : <span className="mt-1 block text-12 font-semibold text-mute">{t("kayit.umTooOld")}</span>}
              </span>
              <span className="flex shrink-0 flex-wrap gap-2">
                {set.linkable === true ? (
                  <Button variant="primary" icon="link" onClick={() => setView({ name: "pick", set })}>{t("kayit.umLink")}</Button>
                ) : null}
                <Button variant="ghost" icon="x" onClick={() => setRejecting(set)}>{t("kayit.umReject")}</Button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3"><Button icon="chevL" onClick={onBack}>{t("kayit.umBack")}</Button></div>
      {rejecting ? (
        <RejectDialog
          set={rejecting}
          onReject={(reason) => board.store.rejectReadings(idsOf(rejecting), reason)}
          onClose={() => { setRejecting(null); reload(); }}
        />
      ) : null}
    </Box>
  );
}
```

- [ ] **Step 5: The page gains the step and its way in (`BedsideScreen.jsx`)**

In `dashboard/src/live/screens/bedside/BedsideScreen.jsx`, find (line 22):

```jsx
// THE ORDER is the beds screen's (`orderBeds`: by unit, a card the bed table does not place last, numbers as
```

Replace with:

```jsx
// «EŞLEŞMEYEN ÖLÇÜMLER» (G3-05, D17) is a step of this page too: a button on the first step — with how many sets
// wait — opens the list (UnmatchedStep.jsx), which reuses this page's patient list and identity question
// (PickSteps.jsx) before it links a reading. No route and no chunk of its own.
//
// THE ORDER is the beds screen's (`orderBeds`: by unit, a card the bed table does not place last, numbers as
```

In the same file, find (lines 52–53):

```jsx
  // { name: "pick" | "identity" | "form" | "saved", id?, bed?, saved?, gone? }: the step, and the patient it is
  // for. `gone` belongs to the list step it was raised for: the next step the page takes has none.
```

Replace with:

```jsx
  // { name: "pick" | "identity" | "form" | "saved" | "unmatched", id?, bed?, saved?, gone? }: the step, and the
  // patient it is for. `gone` belongs to the list step it was raised for: the next step the page takes has none.
  const waiting = useUnmatched();
```

In the same file, find (lines 78–79):

```jsx
    : step.name === "saved" ? t("olcum.saved", { time: dayStamp(step.saved.atMs, nowMs) })
    : t("olcum.pickTitle");
```

Replace with:

```jsx
    : step.name === "saved" ? t("olcum.saved", { time: dayStamp(step.saved.atMs, nowMs) })
    : step.name === "unmatched" ? t("kayit.umTitle")
    : t("olcum.pickTitle");
```

In the same file, find (lines 98–101):

```jsx
            <h2 className="m-0 mb-2 font-text text-11 font-bold uppercase tracking-[.08em] text-mute">{t("olcum.pickTitle")}</h2>
            <PickList patients={patients} nowMs={nowMs} known={known} onPick={choose} />
          </>
        ) : null}
```

Replace with:

```jsx
            {/* G3-05 (D17): the way into «Eşleşmeyen ölçümler», with the count when the last read gave one. */}
            <div className="mb-3">
              <Button icon="link" onClick={() => setStep({ name: "unmatched" })}>
                {waiting.count ? t("kayit.umOpenCount", { count: waiting.count }) : t("kayit.umOpen")}
              </Button>
            </div>
            <h2 className="m-0 mb-2 font-text text-11 font-bold uppercase tracking-[.08em] text-mute">{t("olcum.pickTitle")}</h2>
            <PickList patients={patients} nowMs={nowMs} known={known} onPick={choose} />
          </>
        ) : null}
        {step.name === "unmatched" ? (
          <UnmatchedStep patients={patients} nowMs={nowMs} known={known} onBack={() => setStep({ name: "pick" })} />
        ) : null}
```

- [ ] **Step 6: The provider in the shell, and the badge on the rail**

In `dashboard/src/live/shell/Shell.jsx`, find (line 31):

```jsx
import { StructureProvider } from "../data/StructureProvider.jsx";   // G2-B1a
```

Replace with:

```jsx
import { StructureProvider } from "../data/StructureProvider.jsx";   // G2-B1a
import { UnmatchedProvider } from "../data/UnmatchedProvider.jsx";   // G3-05
```

In the same file, find (lines 237–238):

```jsx
      {/* G2-B1a: the ward's units and beds by name, for the top bar and every screen. */}
      <StructureProvider>
```

Replace with:

```jsx
      {/* G2-B1a: the ward's units and beds by name, for the top bar and every screen. */}
      <StructureProvider>
      {/* G3-05: the unmatched readings, read once for the rail's badge and the bedside page's step. */}
      <UnmatchedProvider>
```

In the same file, find (lines 268–269):

```jsx
      </div>
      </StructureProvider>
```

Replace with:

```jsx
      </div>
      </UnmatchedProvider>
      </StructureProvider>
```

In `dashboard/src/live/shell/Sidebar.jsx`, find (line 16):

```jsx
// same rule, in its own words.
```

Replace with:

```jsx
// same rule, in its own words.
//
// G3-05 (D17): the «Yatak başı ölçüm» entry carries how many unmatched readings wait — the shell's own read
// (data/UnmatchedProvider.jsx), not the board's — in a NEUTRAL tone: it is work waiting, not an alarm. A number only
// from a read that succeeded; nothing at all otherwise.
```

In the same file, find (line 23):

```jsx
import { useBoard } from "../data/BoardProvider.jsx";
```

Replace with:

```jsx
import { useBoard } from "../data/BoardProvider.jsx";
import { useUnmatched } from "../data/UnmatchedProvider.jsx";
```

In the same file, find (line 85):

```jsx
function RailLink({ route, current }) {
```

Replace with:

```jsx
/** G3-05 (D17): the waiting unmatched sets, on the bedside page's entry. Neutral: no alarm colour. */
function UnmatchedBadge() {
  const { t } = useI18n();
  const { count } = useUnmatched();
  if (!count) return null;
  return (
    <>
      <span aria-hidden="true" data-rail-badge="unmatched" className="absolute right-1 top-1 min-w-[16px] rounded-full border border-line bg-card2 px-1 font-text text-10 font-bold leading-[14px] text-ink">{count}</span>
      <span className="sr-only">{` · ${t("kayit.badgeCount", { count })}`}</span>
    </>
  );
}

function RailLink({ route, current }) {
```

In the same file, find (line 111):

```jsx
        <RailBadge routeId={route.id} />
```

Replace with:

```jsx
        <RailBadge routeId={route.id} />
        {route.id === "olcum" ? <UnmatchedBadge /> : null}
```

The raw-key sweep gets the list, so that the bedside page's button carries its count there:

In `dashboard/src/live/rawKeys.test.jsx`, find (line 315):

```jsx
      api.patientReadings.mockImplementation((pid, hours) => Promise.resolve(readings(pid, hours)));
```

Replace with:

```jsx
      api.patientReadings.mockImplementation((pid, hours) => Promise.resolve(readings(pid, hours)));
      api.unmatchedReadings.mockResolvedValue(unmatched());   // … and the bedside page's «Eşleşmeyen ölçümler» count
```

In the same file, find (line 51):

```jsx
import { readings } from "./screens/patient/readings/readings.testutil.js"; // G3-05
```

Replace with:

```jsx
import { readings } from "./screens/patient/readings/readings.testutil.js"; // G3-05
import { unmatched } from "./screens/bedside/unmatched.testutil.js"; // G3-05
```

- [ ] **Step 7: Run to see them pass, with the suites of the files touched**

Run: `cd /c/tmp/g3-cihaz-olcum/dashboard && npx vitest run src/live/screens/bedside src/live/data/UnmatchedProvider.test.jsx src/live/shell src/live/rawKeys.test.jsx 2>&1 | tail -6`
Expected: `Test Files  11 passed (11)`, `Tests  244 passed (244)` on the scratch copy — `BedsideScreen.test.jsx`'s 16 among them, unchanged: the move changed no behaviour.

- [ ] **Step 8: Commit**

```bash
cd /c/tmp/g3-cihaz-olcum && git add -- dashboard/src/live/data/UnmatchedProvider.test.jsx dashboard/src/live/screens/bedside/unmatched.testutil.js dashboard/src/live/data/UnmatchedProvider.jsx dashboard/src/live/screens/bedside/UnmatchedStep.test.jsx dashboard/src/live/screens/bedside/PickSteps.jsx dashboard/src/live/screens/bedside/BedsideScreen.jsx dashboard/src/live/screens/bedside/UnmatchedStep.jsx dashboard/src/live/shell/Shell.jsx dashboard/src/live/shell/Sidebar.jsx dashboard/src/live/rawKeys.test.jsx && git commit -m "feat(dashboard): «Eşleşmeyen ölçümler» on the bedside page — the list, the link through the identity question, the rejection — and the rail's badge (G3-05 W4)" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>" -- dashboard/src/live/data/UnmatchedProvider.test.jsx dashboard/src/live/screens/bedside/unmatched.testutil.js dashboard/src/live/data/UnmatchedProvider.jsx dashboard/src/live/screens/bedside/UnmatchedStep.test.jsx dashboard/src/live/screens/bedside/PickSteps.jsx dashboard/src/live/screens/bedside/BedsideScreen.jsx dashboard/src/live/screens/bedside/UnmatchedStep.jsx dashboard/src/live/shell/Shell.jsx dashboard/src/live/shell/Sidebar.jsx dashboard/src/live/rawKeys.test.jsx
```

---

### Task W5: Görevlerim says what a device round leaves to the hand (D15, Q4)

**Files:**
- Test: `dashboard/src/live/screens/gorevler/GorevlerScreen.test.jsx` — line 158 (as each step finds the file)
- Modify: `dashboard/src/live/i18n/strings/gorevler.js` — line 17, line 72, line 127, line 182 (as each step finds the file)
- Modify: `dashboard/src/live/screens/gorevler/TaskDialogs.jsx` — line 88, line 91 (as each step finds the file)
- Modify: `dashboard/src/live/screens/gorevler/GorevlerScreen.jsx` — lines 2–3 (as each step finds the file)

Since Task B9 a device round resets the vital timer, but the device sends no respiration rate and no consciousness: the task's NEWS2 is then `partial`. The vital dialog already prints «eksik skorla» beside the state; it now also says, under the band line, what is missing and that those two are entered by hand — so that a nurse who sees the timer reset does not take the score for complete. The dialog's «Ölçüm gir» button is right there. Nothing is computed here: `partial` is the engine's.

- [ ] **Step 1: The failing test**

In `dashboard/src/live/screens/gorevler/GorevlerScreen.test.jsx`, find (line 158):

```jsx
  it("creates a task for a chosen patient", async () => {
```

Replace with:

```jsx
  // G3-05 (D15, Q4): a device round resets the timer and leaves the NEWS2 partial — the dialog says what the hand owes.
  it("says, on a partial score, that respiration and consciousness are entered by hand — and nothing on a complete one", async () => {
    const partial = { ...TASKS, patients: [{ ...TASKS.patients[0], vital: { ...TASKS.patients[0].vital, partial: true } }, TASKS.patients[1]] };
    await open({ tasks: partial });
    await press(screen.getByRole("button", { name: /gecikdi/ }));
    const dialog = screen.getByRole("dialog", { name: "Vital ölçmə · REA-01 · 2" });
    expect(within(dialog).getByText("NEWS2 natamamdır: cihaz tənəffüs sayını və şüuru göndərmir; bunlar əl ilə daxil edilir.")).toBeInTheDocument();
    cleanup();
    await open();
    await press(screen.getByRole("button", { name: /gecikdi/ }));
    expect(within(screen.getByRole("dialog", { name: "Vital ölçmə · REA-01 · 2" })).queryByText(/NEWS2 natamamdır/)).toBeNull();
  });
  it("creates a task for a chosen patient", async () => {
```

Run: `cd /c/tmp/g3-cihaz-olcum/dashboard && npx vitest run src/live/screens/gorevler/GorevlerScreen.test.jsx 2>&1 | tail -6`
Expected: `1 failed` — the sentence is not on the page.

- [ ] **Step 2: The sentence in four languages, and its place in the dialog**

In `dashboard/src/live/i18n/strings/gorevler.js`, find (line 17):

```js
    vitalDue: "Ölçüm vadesi {time}", vitalAnchor: "Dayanak {time}",
```

Replace with:

```js
    vitalDue: "Ölçüm vadesi {time}", vitalAnchor: "Dayanak {time}",
    vitalPartialNote: "NEWS2 eksik: cihaz solunum sayısını ve bilinci göndermez; bunlar elle girilir.",   // G3-05 (D15, Q4)
```

In the same file, find (line 72):

```js
    vitalDue: "Ölçmə vaxtı {time}", vitalAnchor: "Əsas {time}",
```

Replace with:

```js
    vitalDue: "Ölçmə vaxtı {time}", vitalAnchor: "Əsas {time}",
    vitalPartialNote: "NEWS2 natamamdır: cihaz tənəffüs sayını və şüuru göndərmir; bunlar əl ilə daxil edilir.",
```

In the same file, find (line 127):

```js
    vitalDue: "Срок измерения {time}", vitalAnchor: "Основа {time}",
```

Replace with:

```js
    vitalDue: "Срок измерения {time}", vitalAnchor: "Основа {time}",
    vitalPartialNote: "NEWS2 неполный: прибор не передаёт частоту дыхания и уровень сознания; их вводят вручную.",
```

In the same file, find (line 182):

```js
    vitalDue: "Measurement due {time}", vitalAnchor: "Anchor {time}",
```

Replace with:

```js
    vitalDue: "Measurement due {time}", vitalAnchor: "Anchor {time}",
    vitalPartialNote: "The NEWS2 is partial: the device sends no respiration rate and no consciousness; those are entered by hand.",
```

In `dashboard/src/live/screens/gorevler/TaskDialogs.jsx`, find (line 88):

```jsx
        {/* the anchor is the server's (the last hand set, or the admission when there is none): one neutral word */}
```

Replace with:

```jsx
        {/* the anchor is the server's (the last measurement — by hand or, since G3-05, by a device — or the admission
            when there is none): one neutral word */}
```

In the same file, find (line 91):

```jsx
        {patient && canManage && canChart ? <VitalsEntry patientId={patient.patient_id} bed={bed} nowMs={nowMs} onWritten={() => refresh()} /> : null}
```

Replace with:

```jsx
        {/* G3-05 (D15, Q4): a device round resets the timer and leaves the score partial — say what the hand owes. */}
        {v.partial ? <p className="m-0 text-12.5 text-mute">{t("gorevler.vitalPartialNote")}</p> : null}
        {patient && canManage && canChart ? <VitalsEntry patientId={patient.patient_id} bed={bed} nowMs={nowMs} onWritten={() => refresh()} /> : null}
```

In `dashboard/src/live/screens/gorevler/GorevlerScreen.jsx`, find (lines 2–3):

```jsx
// Two sources: tasks written by hand, and the vital measurement the server derives from the patient's last
// hand-entered NEWS2 set and the hospital's interval for the band. The grid (wide) and the list (narrow) read
```

Replace with:

```jsx
// Two sources: tasks written by hand, and the vital measurement the server derives from the patient's last
// measurement of a NEWS2 input — typed by hand or, since G3-05 (D15), sent by a device — and the hospital's
// interval for the band. The grid (wide) and the list (narrow) read
```

- [ ] **Step 3: Run to see it pass**

Run: `cd /c/tmp/g3-cihaz-olcum/dashboard && npx vitest run src/live/screens/gorevler src/live/i18n/strings.test.js 2>&1 | tail -6`
Expected: `Tests  27 passed (27)` in 3 files.

- [ ] **Step 4: Commit**

```bash
cd /c/tmp/g3-cihaz-olcum && git add -- dashboard/src/live/screens/gorevler/GorevlerScreen.test.jsx dashboard/src/live/i18n/strings/gorevler.js dashboard/src/live/screens/gorevler/TaskDialogs.jsx dashboard/src/live/screens/gorevler/GorevlerScreen.jsx && git commit -m "feat(dashboard): Görevlerim says a device round leaves respiration and consciousness to the hand (G3-05 W5)" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>" -- dashboard/src/live/screens/gorevler/GorevlerScreen.test.jsx dashboard/src/live/i18n/strings/gorevler.js dashboard/src/live/screens/gorevler/TaskDialogs.jsx dashboard/src/live/screens/gorevler/GorevlerScreen.jsx
```

---

## Closing (controller)

### Task G1: The gates

**Files:** none. A gate failure goes back to the owning lane as a fix commit (pathspec, trailer); then the failed chunk is run again. Every command is one foreground call.

- [ ] **Step 1: The whole no-DB engine suite, in three foreground chunks**

Never `test_infinity_vm_pilot.py`:

```bash
cd /c/tmp/g3-cihaz-olcum/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_[a-d]*.py 2>&1 | tail -3
cd /c/tmp/g3-cihaz-olcum/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_[e-l]*.py --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -3
cd /c/tmp/g3-cihaz-olcum/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_[m-z]*.py tests/rules tests/scoring tests/tenant 2>&1 | tail -3
```

Expected: no failure, no error. Against Task 0's baseline (4022 passed, 1318 skipped) the slice adds **214 passed** and **36 skipped** — **4236 passed, 1354 skipped**:

| Chunk | Baseline | After the slice | What was added |
|---|---|---|---|
| `test_[a-d]*` | 1298 / 814 | 1329 / 814 | `test_admission_keys.py` 3, `test_device_retract.py` 26, `test_board_permissions.py` +2 |
| `test_[e-l]*` | 1722 / 114 | 1723 / 114 | `test_ingest_apply.py` 1 |
| `test_[m-z]*` + `rules`, `scoring`, `tenant` | 1002 / 390 | 1184 / 426 | `test_migration_0021_vital_readings.py` 1 (+4 skipped), `test_nginx_routes.py` +1, `test_readings_api.py` 53, `test_readings_ingest.py` 22, `test_readings_patient.py` 23, `test_readings_postgres.py` (32 skipped), `test_readings_reconcile.py` 27, `test_readings_store.py` 24, `test_readings_unmatched.py` 20, `test_readings_wiring.py` 1, `test_tasks_api.py` +9, `test_tasks_schedule.py` +1 |

(The second chunk reads one test more as passed and one fewer as skipped where `dashboard/node_modules` exists: `test_infinity_transport.py` needs jsdom.) These deltas were seen on the scratch copy; a chunk takes about three to four minutes.

- [ ] **Step 2: The Postgres part, on the throwaway database**

Start `cihaz-pg` («Ground rules»), then, one call:

`cd /c/tmp/g3-cihaz-olcum/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:cihaz@127.0.0.1:56451/cihaz_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_migration_0021_vital_readings.py tests/test_readings_postgres.py tests/test_tasks_postgres.py tests/test_audit_postgres.py tests/test_migration_0019_pharmacy_view.py tests/test_migration_0018_care_team_transfer.py 2>&1 | tail -3`

Expected: no failure and nothing skipped in the first three files — `test_migration_0021_vital_readings.py` 5, `test_readings_postgres.py` 32, `test_tasks_postgres.py` 6 (seen on the scratch copy: 43 passed for the three). Then the two walks that need every route's tenant and guard, one call:

`cd /c/tmp/g3-cihaz-olcum/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:cihaz@127.0.0.1:56451/cihaz_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_route_permissions.py tests/test_tenant_isolation.py 2>&1 | tail -3`

Expected: no failure, nothing skipped — the 133 tenant-isolation tests and the 6 group tests that skip without a database run here (seen on the scratch copy for `test_route_permissions.py`: 15 passed). Stop the container: `docker stop cihaz-pg`.

- [ ] **Step 3: One alembic head**

Run: `cd /c/tmp/g3-cihaz-olcum/homunculus-engine && PYTHONPATH=src /c/tmp/f7-py312/venv/Scripts/python.exe -m alembic heads 2>&1 | tail -2`
Expected: one line, `0021 (head)`. (`alembic heads` reads the files only: no database is opened. If main has gained Kalite's `0020` and this branch has merged it, `0021`'s `down_revision` is `"0020"` and the line is still one.)

- [ ] **Step 4: The whole dashboard suite**

Run: `cd /c/tmp/g3-cihaz-olcum/dashboard && npx vitest run 2>&1 | tail -6` (foreground, timeout 600000; from this upper-case path).
Expected: no failure. Against Task 0's baseline (165 files, 4448 tests): **5 more files** (`kayit.strings.test.js` 8, `ReadingsBox.test.jsx` 18, `TrendDevice.test.jsx` 7, `UnmatchedProvider.test.jsx` 6, `UnmatchedStep.test.jsx` 17) and **62 more tests** (those 56, and `backendApi.test.js` +1, `boardStore.test.js` +1, `apiErrors.test.js` +3, `GorevlerScreen.test.jsx` +1) — `Test Files  170 passed (170)`, `Tests  4510 passed (4510)` on the scratch copy. `engineTypes.test.js` and `apiErrors.test.js` are green: both lanes are complete.

- [ ] **Step 5: The build, the precache, and the one warning to decide on**

Run: `cd /c/tmp/g3-cihaz-olcum/dashboard && npx vite build 2>&1 | tail -12`
Expected: `✓ built in …`, no error, `precache  67 entries` — the count is unchanged (no new lazy chunk: the record box rides in the patient screen's chunk, the step in the bedside page's). On the scratch copy the line read `precache  67 entries (1550.60 KiB)` (1512.21 KiB before the slice). `dist/` is git-ignored.

**One finding the scratch build made, for the controller to decide — do not paper over it:** the build printed `(!) Some chunks are larger than 500 kB after minification`. The chunk is the shared `Toast-*.js`, **505.80 kB** (489.17 kB at `31f56279`): it carries the dictionaries of every i18n namespace, and this slice's `kayit` namespace (72 keys in four languages, about 16 kB) is what crossed the line. No new chunk is involved, and G3-04's gate expected no such line. The choices: accept and record it (the next slice's strings would cross it anyway), or open a slice that splits the dictionaries by language. **Do not raise `chunkSizeWarningLimit` and do not trim clinical wording to duck the number** without the owner's word. Record the line as printed and the decision taken.

- [ ] **Step 6: The slice's no-DB files under Python 3.14**

`cd /c/tmp/g3-cihaz-olcum/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/g115-py314/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_readings_store.py tests/test_readings_wiring.py tests/test_readings_ingest.py tests/test_readings_unmatched.py tests/test_readings_api.py tests/test_readings_patient.py tests/test_readings_reconcile.py tests/test_device_retract.py tests/test_ingest_apply.py tests/test_admission_keys.py tests/test_migration_0021_vital_readings.py tests/test_tasks_api.py tests/test_tasks_schedule.py tests/test_bedside_retract.py tests/test_board_permissions.py 2>&1 | tail -3`

Expected: `385 passed, 4 skipped` (24 + 1 + 22 + 20 + 53 + 23 + 27 + 26 + 1 + 3 + 1 + 37 + 21 + 49 + 77; the four skips are the migration's DB tests) — seen on the scratch copy under Python 3.14. It is slower than 3.12: allow five minutes.

- [ ] **Step 7: Record the gates**

Write the six results (the lines as printed, the date, the head's sha) into the plan's «As run» block at the end of this file and into the spec's «As built» section (Task D1 Step 4). Commit with Task D1.

---

### Task G2: The local walk — admit, a device round, a typo, a discharge, a correction, a restart (spec §7 «Local walk»)

**Where:** `/c/tmp/g3-cihaz-olcum`, after Task G1. The agent drives the dashboard in headless Chrome, as B1d's and G3-01's walks did; **synthetic data only** — the tenant `cihaz-yuruyus`, the patient «Test Hasta» born 1970-05-05, the protocol `202600000001`, the typo `202600000010`. Nothing is committed by this task: its outcome is `/c/tmp/homunculus-plans/g3-cihaz/walk/notes.md` (each item: what was done, what the screen or the probe said, pass or finding) and the screenshots beside it (1440 px, and 390 px for items 2 and 4, in both themes for one of each). The model is `docs/superpowers/plans/2026-11-01-g2b-b1d-protokol-barkod.md` Task 20, whose stack scratch (`/c/tmp/g115plan/stack/`) this walk reuses.

**Unlike every other task of this plan, these commands were not run when the plan was written** (a stack of another lane was up on the fixed container names): they are composed from B1d's Task 20 and G3-01's walk. Where a line does not behave as written, write down what it did, adapt it, and go on — the five items and their expected pictures are what is binding.

The device's messages are the bridge's own path, unchanged by this slice (D18): `scripts/pdq_probe.py` sends the patient query (QBP^Q22) and `scripts/hl7_simulator.py` an ORU^R01 over MLLP to the local bridge, which posts to `/ingest`.

- [ ] **Step 1: No other stack, and the MLLP port free.** The compose file names its containers (`homunculus-postgres`, `-api`, `-web`, `-bridge`), so one such stack runs at a time:

```bash
docker ps -a --format '{{.Names}} {{.Ports}} {{.Label "com.docker.compose.project"}}' | grep -E '^homunculus-(postgres|api|web|bridge|nce) ' || echo "no stack containers"
netstat -ano | grep -E "[:.]2575 .*LISTEN" || echo "2575 free"
```

If a container is listed or 2575 is taken: **stop and ask the controller** whose it is and whether it may go down (when this plan was written, `homunculus-web`, `homunculus-api` and `homunculus-postgres` of another lane's stack were up on 18100). Never `down -v` a stack this task did not start.

- [ ] **Step 2: The three images, from the slice's head.**

```bash
cd /c/tmp/g3-cihaz-olcum
docker build -q -t g3-cihaz-api:new -f homunculus-engine/Dockerfile.api homunculus-engine
docker build -q -t g3-cihaz-web:new --build-arg BUILD_SHA=$(git rev-parse --short HEAD) -f deploy/local/web/Dockerfile .
docker build -q -t g3-cihaz-bridge:new -f homunculus-engine/Dockerfile homunculus-engine
docker run --rm --entrypoint python g3-cihaz-api:new -c "from homunculus.api.readings import reconcile, POLICY_UNMATCHED; import homunculus.api.readings_postgres; print(POLICY_UNMATCHED)"
```

Expected: three image ids; `unmatched`.

- [ ] **Step 3: The stack's scratch** (outside the repo):

```bash
S=/c/tmp/homunculus-plans/g3-cihaz/stack
mkdir -p $S /c/tmp/homunculus-plans/g3-cihaz/walk
grep -vE '^(WEB_PORT|WEB_TLS_PORT|TENANT_SLUG)=' /c/tmp/g115plan/stack/local.env > $S/local.env
printf 'WEB_PORT=18205\nWEB_TLS_PORT=18568\nTENANT_SLUG=cihaz-yuruyus\n' >> $S/local.env
grep -c PHI_ENCRYPTION_KEY $S/local.env                                    # 1: the bridge's mirror needs it
```

**Write** `/c/tmp/homunculus-plans/g3-cihaz/stack/compose.cihaz.yml` (with the Write tool):

```yaml
# G3-05's walk: the three services run the slice's images, never a build or a pull. Used with
# deploy/local/docker-compose.yml and G1-15's compose.g115.yml (the bind mounts in scratch).
services:
  api:
    image: g3-cihaz-api:new
    pull_policy: never
  web:
    image: g3-cihaz-web:new
    pull_policy: never
  bridge:
    image: g3-cihaz-bridge:new
    pull_policy: never
```

In every command below, `C` is (set it again in each tool call: shell variables do not persist):

```bash
C="docker compose -p g3cihaz -f deploy/local/docker-compose.yml -f /c/tmp/g115plan/stack/compose.g115.yml -f /c/tmp/homunculus-plans/g3-cihaz/stack/compose.cihaz.yml --env-file /c/tmp/homunculus-plans/g3-cihaz/stack/local.env"
```

- [ ] **Step 4: Up, at `0021`, with the production policy.**

```bash
cd /c/tmp/g3-cihaz-olcum
$C up -d --no-build postgres api web bridge 2>&1 | tail -4
docker exec homunculus-postgres psql -U homunculus -d homunculus -Atc "select version_num from alembic_version" </dev/null
docker exec homunculus-postgres psql -U homunculus -d homunculus -Atc "select count(*) from vital_readings" </dev/null
docker exec homunculus-api python -c "from homunculus.api import prodserver as p; print(p._unknown_readings(p._database_url()))" </dev/null
```

Expected: `0021`; `0`; `unmatched` (a Postgres deployment lists unknown numbers, D9). Wait for the API's health (`curl -s http://127.0.0.1:18205/health`) before the browser. The API's start log carries no `vital_readings:` error line (`docker logs homunculus-api 2>&1 | grep vital_readings` prints nothing or a `reconcile` info line).

- [ ] **Step 5: The walk.** Sign in as the seed admin (`SEED_ADMIN_EMAIL` of `local.env`). Yönetim › Yapı: unit «Reanimasiya» (Erişkin YBÜ), room «Otaq 1», beds «1» and «2»; Yönetim › Protokol ve etiket: start number `202600000001` (as B1d's walk, items a and c).

  1. **Admit; the probe answers with the name; an ORU set appears as «cihaz», linked to the admission; the Görevlerim timer resets.** Hasta Kabul › Kabul: «Test Hasta», 1970-05-05, bed 1 → the box shows `202600000001`.

     ```bash
     docker exec homunculus-bridge python scripts/pdq_probe.py --id 202600000001 --show-name </dev/null
     docker exec homunculus-bridge python scripts/hl7_simulator.py --port 2575 --patients 202600000001 --count 1 --interval 0 </dev/null
     docker exec homunculus-postgres psql -U homunculus -d homunculus -Atc "select code, origin, state, source, admission_id is not null, audit_id = entry_id from vital_readings order by id" </dev/null
     ```

     Expected: the probe says `QAK=OK PID=evet ad=Test Hasta …`; the table holds one row per value of the ORU — `device|recorded|<the simulator's station name>|t|t` each. The patient screen's «Ölçüm kaydı» shows one set, «cihaz · …», with the values; the card carries them; Görevlerim's vital task for the patient reads «planlı» with the set's time as its anchor (the simulator sends a respiration rate too, so the NEWS2 need not be partial here — the partial case is item 4's).
  2. **A typo: the probe answers NF; the ORU makes no card; the badge and the list show the set; link it; it appears under the patient at its own time.**

     ```bash
     docker exec homunculus-bridge python scripts/pdq_probe.py --id 202600000010 </dev/null
     docker exec homunculus-bridge python scripts/hl7_simulator.py --port 2575 --patients 202600000010 --count 1 --interval 0 </dev/null
     ```

     Expected: `QAK=NF PID=yok`; no card for `202600000010` on Yataklar; within a minute the «Yatak başı ölçüm» rail entry shows a neutral `1`; on `/olcum` the button reads «Eşleşmeyen ölçümler · 1»; the list shows the number as typed, «numara hiçbir yatışla eşleşmedi», the device and the values. «Hastaya bağla» → pick bed 1 → the identity question with «Test Hasta», 1970 and the values → «Evet, bağla». The toast names the bed; the list is empty; the badge is gone; the patient's «Ölçüm kaydı» shows a second set at the typo round's own time, «cihaz · …»; `select state, received_key, patient_key from vital_readings where received_key = '202600000010'` prints `assigned|202600000010|202600000001` rows. Screenshot the list and the identity question at 390 px.
  3. **Discharge, then an ORU: the list shows it as «taburcu»; no alert.** Admit a second synthetic patient («Test Hasta İki», bed 2 → `202600000002`), start and confirm the discharge, then:

     ```bash
     docker exec homunculus-bridge python scripts/hl7_simulator.py --port 2575 --patients 202600000002 --count 1 --interval 0 </dev/null
     docker exec homunculus-postgres psql -U homunculus -d homunculus -Atc "select count(*) from audit where patient_id = '202600000002' and event_type in ('ingest','alert','notification') and id > (select max(id) from audit where event_type = 'admission.discharge_confirm')" </dev/null
     ```

     Expected: the list shows the set under `202600000002` with «taburcu edilmiş hastanın numarası» and its values; the count is `0` — nothing reached the engine; no card returns, no alarm sounds. Reject it with a reason of ten characters or more: the row leaves the list, `select state, resolve_reason from vital_readings where received_key = '202600000002'` prints `rejected|…` with the values still in the row.
  4. **«Düzelt» a device systolic value: NEWS2 and the trend change, the row is struck with its reason; re-send the same reading: nothing returns.** The simulator sends no systolic pressure, so post one device round by hand — the same door, the device token of `local.env`, a synthetic device name — a systolic of 88 with SpO₂, pulse and temperature (no respiration, no consciousness: the Connex's set):

     ```bash
     TOKEN=$(grep '^TENANT_TOKEN=' /c/tmp/homunculus-plans/g3-cihaz/stack/local.env | cut -d= -f2)
     AT=$(date -u +%Y-%m-%dT%H:%M:%S+00:00)
     for pair in sbp:88 spo2:97 heart_rate:78 temperature:36.8; do
       curl -s -X POST http://127.0.0.1:18205/ingest -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
         -d "{\"resourceType\":\"Observation\",\"code\":{\"coding\":[{\"system\":\"x\",\"code\":\"${pair%%:*}\"}]},\"subject\":{\"reference\":\"Patient/202600000001\"},\"effectiveDateTime\":\"$AT\",\"valueQuantity\":{\"value\":${pair##*:},\"unit\":\"\"},\"device\":{\"display\":\"CONNEX-3A\"}}"; echo
     done
     echo "$AT" > /c/tmp/homunculus-plans/g3-cihaz/walk/round-at.txt
     ```

     Expected: four answers with `"alerts"`. The patient's NEWS2 rises (a systolic of 88 scores 3) and says it is partial; Görevlerim's vital dialog says «NEWS2 eksik: cihaz solunum sayısını ve bilinci göndermez; bunlar elle girilir.» In «Ölçüm kaydı», «Düzelt» on «Sistolik TA 88 mmHg»: reason «manşet yanlış koldaydı, yeniden ölçüldü», right value `118` → the toast «… düzeltildi». The row is struck with the reason, the name and the time; a new set «elle · <the admin>» at the same time holds 118; the NEWS2 falls; the trend table of «Kan basıncı» lists 88 struck as «cihaz» and 118 as «elle». Then re-send the very same systolic reading:

     ```bash
     TOKEN=$(grep '^TENANT_TOKEN=' /c/tmp/homunculus-plans/g3-cihaz/stack/local.env | cut -d= -f2); AT=$(cat /c/tmp/homunculus-plans/g3-cihaz/walk/round-at.txt)
     curl -s -X POST http://127.0.0.1:18205/ingest -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
       -d "{\"resourceType\":\"Observation\",\"code\":{\"coding\":[{\"system\":\"x\",\"code\":\"sbp\"}]},\"subject\":{\"reference\":\"Patient/202600000001\"},\"effectiveDateTime\":\"$AT\",\"valueQuantity\":{\"value\":88,\"unit\":\"\"},\"device\":{\"display\":\"CONNEX-3A\"}}"; echo
     ```

     Expected: `{"patient_id":"202600000001","duplicate":true}`; the card's systolic stays 118. Screenshot the box and the dialog at 390 px.
  5. **Restart the API: the same picture.**

     ```bash
     cd /c/tmp/g3-cihaz-olcum && $C restart api 2>&1 | tail -1
     ```

     Expected, after the health check: the card, the NEWS2, the «Ölçüm kaydı» box (the struck 88, the hand 118, the linked set) and the empty list are as before the restart; `docker logs homunculus-api 2>&1 | grep "vital_readings"` shows no error (a `reconcile` info line only if it had something to file).

- [ ] **Step 6: The backfill script answers on this stack** (the optional deploy step, D19):

```bash
docker exec homunculus-api python scripts/backfill_vital_readings.py --tenant cihaz-yuruyus --open-only --dry-run </dev/null
```

Expected: one line, `VITAL_READINGS_BACKFILL {"tenant": "cihaz-yuruyus", "open_only": true, "dry_run": true, "stays": 1, "recorded": 0, …}` — nothing to file: the doors wrote every row.

- [ ] **Step 7: Down, and the notes.** `$C down -v 2>&1 | tail -2` (this task's own stack and volumes only). Write `notes.md`: the date, the head's sha, the three image ids, each item's pass or finding. A finding goes back to its lane as a fix commit, and the item is walked again. Do not commit the notes or the screenshots.

---

### Task D1: The guide, the roadmap, the spec's «As built», the deploy notes for Lane A

**Files:**
- Modify: `docs/homunculus-rehber-TR.md` — lines 2397–2402, lines 1742–1743, lines 1889–1891 (as each step finds the file)
- Modify: `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` — line 56 (as each step finds the file)
- Modify: `docs/superpowers/specs/2026-11-11-g3-cihaz-olcum-kaydi-design.md` — after line 256 (the end of the file) (as each step finds the file)

Docs are the controller's. `docs/homunculus-rehber-TR.md` is the owner's living guide: plain Turkish, no jargon without its meaning. The edits below were applied to a scratch copy at `31f56279`; if another lane's merge moved a find block, the text is the same and only its place changed.

- [ ] **Step 1: The guide — a new section, and two sentences that are no longer true**

The next free number after §3.24 is **§3.25**. Other lanes are adding sections now (and §3.20 is a gap that another lane holds): **fix the number at the merge**, and with it the three cross-references written here («3.25»).

In `docs/homunculus-rehber-TR.md`, find (lines 2397–2402):

```markdown
- **Kaynak:** `docs/superpowers/specs/2026-11-11-g4-yonetici-ozeti-design.md`; plan
  `docs/superpowers/plans/2026-11-11-g4-yonetici-ozeti.md`.

---

## 4. "Neden bunu kullanmıyoruz" köşesi
```

Replace with:

```markdown
- **Kaynak:** `docs/superpowers/specs/2026-11-11-g4-yonetici-ozeti-design.md`; plan
  `docs/superpowers/plans/2026-11-11-g4-yonetici-ozeti.md`.

### 3.25 Cihaz ölçüm kaydı: cihazdan gelen ölçüm hastanın yatışına bağlanır (Grup 3 · G3-05)

- **Ne:** Servislerde vitaller elle yazılmaz: hemşire Connex cihazına hastanın **protokol numarasını** girer (ya
  da barkodu okutur), ölçer, cihaz değerleri gönderir. Bu dilimden önce o değerler yalnız «denetim kaydında» ve
  motorun belleğinde duruyordu; hangi yatışa ait olduğu hiçbir yerde yazılı değildi. Artık her ölçüm, hastanın o
  yatışına bağlı kalıcı bir kayda yazılır. **Durum:** kod dalda (`feat/g3-cihaz-olcum-kaydi`); ana dalda ve
  hastane sunucusunda değil. Örneklerdeki numaralar ve değerler uydurmadır.
- **Sözcükler.**
  - *Ölçüm kaydı:* bir yatışta ölçülen her değerin, kaynağıyla birlikte tutulduğu liste. Kaynak ya **«cihaz»**
    (hangi cihaz olduğuyla) ya **«elle»** (kimin girdiğiyle) olur.
  - *Eşleşmeyen ölçüm:* cihaza girilen numara hiçbir yatışla eşleşmediği için (yanlış bir hane, eksik bir hane)
    ya da hasta o sırada taburcu edilmiş olduğu için bir hastaya yazılamayan ölçüm. **Değeri kaybolmaz**; bir
    listede bekler.
  - *Bağla / Reddet:* eşleşmeyen bir ölçümü doğru hastaya yazmak, ya da gerekçesiyle kapatmak.
  - *Düzelt:* yanlış bir değeri işaretleyip yerine doğrusunu girmek. Yanlış değer silinmez; üstü çizili kalır.
- **Hasta ekranında «Ölçüm kaydı» kutusu.** «Ölçülen değerler»in hemen altında. Her ölçüm seti bir satır, en yenisi
  üstte; dönem 24 saat, 72 saat ya da 7 gün. Satırda ölçüm saati, kaynağı («cihaz · CONNEX-3A» ya da «elle ·
  hem.ayse») ve değerler yazar. Cihaz ölçümü geç ulaştıysa (ölçümle varış arasında 5 dakikadan fazla) yanında
  «alındı 09:40» görünür.
- **«Düzelt».** Kayıt girme yetkisi (`clinical.chart`) olan herkes, kutudaki ya da trend tablosundaki bir değerin
  yanında «Düzelt»i görür. Bir gerekçe (en az 10 karakter) yazılır; istenirse doğru değer de girilir. Olan şudur:
  yanlış değer bütün skorlardan ve uyarılardan çıkar — NEWS2 sanki o değer hiç gelmemiş gibi yeniden hesaplanır —
  ama kayıtta **üstü çizili**, gerekçesi, kimin ne zaman işaretlediğiyle kalır. Doğru değer aynı ölçüm saatine
  **«elle»** olarak yazılır. Cihaz aynı ölçümü yeniden gönderirse geri gelmez. Bu, 3.12'deki «hatalı giriş»in
  cihaz değerleri için de açılmasıdır: önceden cihazdan gelen bir değer geri alınamıyordu. 24 saatten eski bir
  ölçüm işaretlenebilir, ama doğru değeri buradan girilemez.
- **«Eşleşmeyen ölçümler» listesi.** «Yatak başı ölçüm» sayfasının (`/olcum`) içinde bir adımdır; sol raydaki
  girişte bekleyen set sayısı gri bir rozetle görünür (dakikada bir yenilenir; alarm rengi değildir). Listede her
  set için cihaza **girildiği haliyle** numara, neden eşleşmediği, cihaz, ölçüm saati ve değerler yazar.
  - **«Hastaya bağla»:** hasta listesinden hasta seçilir, sistem yatak başındaki soruyu sorar («Soyad ad ve doğum
    yılı hastayla eşleşiyor mu?»), «Evet, bağla» denince ölçüm o hastaya **kendi ölçüm saatinde**, kaynağı
    **cihaz** olarak yazılır; skorlar ve uyarılar cihaz doğru numarayla göndermiş gibi hesaplanır.
  - **«Reddet»:** gerekçe (10–200 karakter) yazılır; ölçüm hiçbir hastaya bağlanmaz, değerleri kayıtta kalır.
  - **24 saatten eski** bir ölçüm bağlanamaz, yalnız reddedilebilir.
  - **Kim görür:** numarası hiç eşleşmeyen seti kayıt girme yetkisi olan herkes görür (ortada bir hasta yoktur).
    Taburcu edilmiş bir hastanın numarasıyla gelen seti yalnız o hastanın son biriminin çalışanları görür.
  - Bağlama ve reddetme denetim kaydına kimin yaptığıyla yazılır.
- **Hastane sunucusunda ne değişir.** Bilinmeyen bir numarayla gelen ölçüm artık panoda **adsız bir kart
  açmaz**; listeye gider. Taburcu edilmiş bir numaraya gelen ölçümün **değeri artık saklanır** (önceden yalnız
  «bir ölçüm geldi ve atıldı» yazılıyordu); yine de alarm üretmez, kimseye bildirim gitmez. Kurulum gününde panoda
  duran adsız bir kart yerinde kalır, ama yeni ölçüm almaz.
- **Görevlerim.** Cihazdan gelen ölçüm artık «vital ölçüm» görevini karşılar (3.16); hemşirenin cihazın
  değerlerini yeniden yazması gerekmez. **Dikkat:** cihaz yalnız SpO₂, sistolik tansiyon, nabız ve ateş gönderir;
  **solunum sayısını ve bilinci göndermez.** Cihaz turundan sonra sayaç sıfırlanır, ama NEWS2 «eksik» kalır ve
  görev penceresi bunu söyler; o ikisi elle girilir.
- **Ne yapmaz.** Comed'in protokol numarasını tanımaz (cihaza Homunculus'un 12 haneli protokolü girilir). Numarada
  denetim hanesi yoktur: yanlış girilen bir hane **başka bir yatan hastanın** numarasına denk gelirse ölçüm o
  hastaya yazılır — korunma, cihazın ekranda gösterdiği ad ve «Düzelt»tir. Taburcu olmuş bir yatışın kaydını
  gösteren ekran henüz yoktur (kayıt durur). Cihazdan solunum sayısı, kartlarda kaynak etiketi, kat başına cihaz
  listesi bu dilimde yoktur. Tanı koymaz, tedavi önermez: kayıt tutar ve gösterir.
- **Arka planda.** Denetim kaydı asıl kaynaktır; yeni tablo (`vital_readings`, göç 0021) onun özetidir. Tablo bir
  an yazılamazsa istek başarısız sayılmaz; sistem açılışta ve saatte bir eksikleri denetim kaydından tamamlar.
- **Açık:** Azerbaycanca, Rusça ve İngilizce metinler ana dili okuması bekliyor. NCE akışı 5 Eylül 2026'dan beri
  sessiz olduğu için bu dilim yalnız yerel kurulumda denendi.
- **Kaynak:** `docs/superpowers/specs/2026-11-11-g3-cihaz-olcum-kaydi-design.md`; plan
  `docs/superpowers/plans/2026-11-11-g3-cihaz-olcum-kaydi.md`.

---

## 4. "Neden bunu kullanmıyoruz" köşesi
```

In the same file, find (lines 1742–1743):

```markdown
  - Geri alma bir kişinin işidir: cihaz kimliği (köprünün jetonu) yapamaz, cihazdan gelen bir
    değer geri alınamaz, taburcu edilmiş bir numarada da yapılmaz.
```

Replace with:

```markdown
  - Geri alma bir kişinin işidir: cihaz kimliği (köprünün jetonu) yapamaz; taburcu edilmiş bir
    numarada da yapılmaz. Cihazdan gelen bir değer G3-05'ten beri geri alınabilir («Düzelt», 3.25).
```

In the same file, find (lines 1889–1891):

```markdown
- **Vital ölçüm görevi hesaplanır, kaydedilmez.** Dayanak, hastanın son **elle girilen** NEWS2 değeridir (3.12'deki
  form; geri alınan giriş sayılmaz). Monitörden ya da HBYS'den gelen değer dayanak değildir. Son 48 saatte elle
  giriş yoksa dayanak kabul zamanıdır; o da yoksa ekran «ölçüm kaydı yok» der. Vade = dayanak + hastanın NEWS2
```

Replace with:

```markdown
- **Vital ölçüm görevi hesaplanır, kaydedilmez.** Dayanak, hastanın son **ölçülen** NEWS2 değeridir: elle girilen
  (3.12'deki form) ya da — G3-05'ten beri — cihazdan gelen (3.25); geri alınan değer sayılmaz. Cihaz solunum
  sayısını ve bilinci göndermediği için cihaz turundan sonra NEWS2 «eksik» kalır. Son 48 saatte ölçüm
  yoksa dayanak kabul zamanıdır; o da yoksa ekran «ölçüm kaydı yok» der. Vade = dayanak + hastanın NEWS2
```

- [ ] **Step 2: The roadmap — the row of G3-05**

The find block is the end of the G3-04 row (it begins with a space: it is the tail of a long line). Fill the `…` of the status cell from Task G1's and G2's records before committing (the head's sha, the two engine numbers, the Postgres count, the dashboard's files/tests).

In `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`, find (line 56):

```markdown
 · tarayıcı yürüyüşü yapılmadı; AZ/RU/EN metinler ana dili okumasını bekliyor |
```

Replace with:

```markdown
 · tarayıcı yürüyüşü yapılmadı; AZ/RU/EN metinler ana dili okumasını bekliyor |
| G3-05 | Cihaz ölçüm kaydı (Lane B): servis cihazından (Connex) gelen her ölçüm hastanın yatışına bağlı kalıcı bir kayda yazılır — yeni tablo `vital_readings` (göç **0021**; yalnız şema), denetim kaydının özeti (önce denetim satırı, sonra tablo; tablo yazılamazsa istek düşmez, `reconcile` açılışta ve saatte bir tamamlar); hasta ekranında «Ölçüm kaydı» kutusu (kaynak «cihaz · …» ya da «elle · …», 24 sa / 72 sa / 7 gün, geç ulaşan ölçümde «alındı»); cihaz değeri de «Düzelt» ile geri alınır (G3-01 D11'in yerini alır: üstü çizili kalır, doğrusu aynı saate «elle»), yeniden gönderilen ölçüm tanınır; numarası eşleşmeyen ya da taburcu edilmiş numaraya gelen ölçüm değeriyle «Eşleşmeyen ölçümler» listesine gider (G2-A11 D3 ve B1d D4'ün yerini alır: adsız kart yok, yine alarm yok) — `/olcum` içinde adım + ray rozeti; «Hastaya bağla» (kimlik sorusundan sonra, ölçüm kendi saatinde ve cihaz kaynağıyla gerçek motora girer) ve «Reddet» (gerekçeli), ikisi de `clinical.chart`, yeni yetki yok; 24 saatten eski ölçüm bağlanamaz; cihaz ölçümü «vital ölçüm» görevini karşılar (G3-02 D2'nin yerini alır; cihaz solunum ve bilinç göndermediği için NEWS2 eksik kalır); bilinmeyen numara politikası üretimde `unmatched`, `READINGS_UNKNOWN_KEY=card` ile eski davranış; `scripts/backfill_vital_readings.py --open-only` (isteğe bağlı kurulum adımı) · spec: [2026-11-11](../specs/2026-11-11-g3-cihaz-olcum-kaydi-design.md) · plan: [2026-11-11](2026-11-11-g3-cihaz-olcum-kaydi.md) | Kod ✅ … · dal `feat/g3-cihaz-olcum-kaydi` @ `…` · göç `0021` (`down_revision` Kalite önce birleşirse `0020`) · kapılar: motor veritabanısız … geçti / … atlandı; Postgres dilimi …; pano … dosya / … test, precache 67 · yerel yürüyüş: … · **main'de değil, VM'de değil** (sahibin sözü; kurulum notları planın sonunda) · AZ/RU/EN metinler ana dili okumasını bekliyor |
```

- [ ] **Step 3: The spec — «As built»**

Append to the spec, and fill each `…` from Tasks G1 and G2:

Append to the end of `docs/superpowers/specs/2026-11-11-g3-cihaz-olcum-kaydi-design.md` (after line 256):

```markdown

## 11. As built

Plan: `docs/superpowers/plans/2026-11-11-g3-cihaz-olcum-kaydi.md`. Built on `feat/g3-cihaz-olcum-kaydi`; head `…`; gates run … (the lines are in the plan's «As run» block).

What differs from the design above (the plan's departures, E-1 … E-12):

- **§7 pins.** The three list routes are a factory router's, so they are pinned by `test_route_inventory.py` `CALLER_RESOLVED_ROUTES` (10 → 13) and `test_tenant_isolation.py`; `test_route_permissions.py` `EXPECTED` stays 75 (E-1).
- **§3.** A sixth index, `ix_vital_readings_tenant_entry (tenant, entry_id)`, for the withdrawal's mark (E-2). `source` and `unit` are cut to 64 and 16 characters at the door (E-12).
- **D12.** A rejection is claimed like a link; an orphaned claim is released by `reconcile` after 10 minutes (E-3). A link's target must be on a board — an identity record or a measured patient — else 404 (E-5).
- **§4.** An unmatched set carries `linkable`, a record set `received_late` (E-4); a rejection names one set (E-6); `hours` outside 24/72/168 answers 400 `reading_hours` (E-7).
- **O2.** Closed: an `ingest` row's device is replayed as sent, an empty name included (E-8).
- **§6.** The dev proxy line travels with nginx's (E-9); the dashboard's two reads are hooks, its two writes board-store methods (E-10).
- **D19.** The backfill requires `--open-only` and bounds each stay by its start (E-11).

Found while building: the shared dashboard chunk that carries every dictionary crossed vite's 500 kB warning line with this slice's `kayit` namespace (489.17 → 505.80 kB); decision: ….

Local walk (§7): … (date, head, the five items: pass or finding).
```

- [ ] **Step 4: The plan's «As run» block, and the commit**

Fill the «As run» block at the end of this plan (below) with Task G1's six results and Task G2's outcome, then:

```bash
cd /c/tmp/g3-cihaz-olcum && git add -- docs/homunculus-rehber-TR.md docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md docs/superpowers/specs/2026-11-11-g3-cihaz-olcum-kaydi-design.md docs/superpowers/plans/2026-11-11-g3-cihaz-olcum-kaydi.md && git commit -m "docs(rehber, roadmap, spec): G3-05 Cihaz ölçüm kaydı — §3.25, the roadmap row, as built, the gates as run" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>" -- docs/homunculus-rehber-TR.md docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md docs/superpowers/specs/2026-11-11-g3-cihaz-olcum-kaydi-design.md docs/superpowers/plans/2026-11-11-g3-cihaz-olcum-kaydi.md
git push origin feat/g3-cihaz-olcum-kaydi
```

Then report to Lane A that the branch is ready for the owner's «main'e al», with the deploy notes below. **Do not merge and do not touch the VM.**

---

## Deploy notes for Lane A (spec §8 — what the blocks must say; Lane A writes them, the owner's «onay» runs them)

- **Order:** bundle → dump → `alembic upgrade head` (the API's start command) → api image → web image → checks. api + web only: the bridge, the hub and the workers are untouched (D18). In a pasted heredoc every stdin consumer (`docker compose exec|run`, `psql`, `ssh`) takes `</dev/null`.
- **Migration `0021`** — schema only, one statement per `op.execute`. It builds `ix_audit_tenant_patient_id` on `audit` inside the migration's transaction: **audit writes wait while it builds** (the VM's table is small, about 2 400 rows — a moment). `down_revision` is `"0020"` if Kalite is on main first; `alembic heads` must print one head before the deploy.
- **Block A-1 counts today's nameless cards**, so the owner knows what will stop updating: `docker compose exec -T api python -c "import os,json,urllib.request as u; t=os.environ['TENANTS'].split(',')[0].split(':')[0]; r=u.Request('http://127.0.0.1:8000/patients', headers={'Authorization':'Bearer '+t}); print(sum(1 for p in json.load(u.urlopen(r))['patients'] if p.get('identity') is None))" </dev/null` — prints a number only, never a patient id.
- **What the live board shows changes** (the production policy is on by itself on Postgres):
  - a new reading under a number nobody is admitted under goes to «Eşleşmeyen ölçümler» and makes **no** card;
  - a nameless card that exists on the day stays (the restart replays its old `ingest` rows) and receives nothing new (`tests/test_readings_unmatched.py` `TestTheNamelessCardOfTheDeployDay`);
  - a reading for a discharged number is listed with its value (still no alert, no page);
  - a re-sent reading is recognised and not counted twice (D14) — so replaying recorded data a second time into this deployment changes nothing; `READINGS_UNKNOWN_KEY=card` in the API's environment turns the unknown-number policy back for a replay.
- **Checks after the start:** `select version_num from alembic_version` = `0021`; `select count(*) from vital_readings` = `0` right after the migration; the API's log has no `vital_readings:` error line; `GET /readings/unmatched` answers 401 without a credential through nginx (a JSON body, not the dashboard's HTML); the web asset grep finds `kayit`.
- **Optional, the same day (D19):** `docker compose run --rm --no-deps -T api python scripts/backfill_vital_readings.py --tenant <slug> --open-only --dry-run </dev/null`, read the one line, then the same without `--dry-run`. It files the open stays' readings since each stay began; a second run files nothing.
- **The ward is told beforehand:** the «Eşleşmeyen ölçümler» list and its badge; «Düzelt» on a device value; a device round now clears the vital task while the NEWS2 stays partial until respiration rate and consciousness are entered by hand; a wrong digit that happens to be another in-patient's protocol attaches the reading to that patient — the name on the device and «Düzelt» are the remedies.
- **Rollback (D20):** api + web to the previous images; `alembic downgrade 0019` (or `0020`) drops the table and the audit index. The rollback block **first prints three counts**: `select count(*) from audit where event_type = 'chart_retract' and payload->>'origin' = 'device'` (withdrawn device values — under the old images each **counts again**: the old replay skips withdrawn `chart` rows only), `select count(*) from vital_readings where state = 'assigned' and patient_key is not null` (linked readings — they **stay**: they are ordinary `ingest` rows), `select count(*) from vital_readings where state = 'unmatched'` (waiting readings — **no longer visible**; their `reading_unmatched` audit rows remain).
- **Open:** az/ru/en strings await a native reading (O4); the NCE feed has been silent since 2026-09-05, so this slice is proven on the local stack only (spec §9).

---

## As run (filled by the controller in Tasks G1, G2 and D1)

- Head: … · date: …
- G1 Step 1 (engine, no database): … / … / …
- G1 Step 2 (Postgres): … ; …
- G1 Step 3 (`alembic heads`): …
- G1 Step 4 (dashboard): …
- G1 Step 5 (build): … · the 500 kB line: … · decision: …
- G1 Step 6 (Python 3.14): …
- G2 (the walk): … — notes at `/c/tmp/homunculus-plans/g3-cihaz/walk/notes.md`

---

## Spec coverage

**Decisions (spec §2):**

| # | Decision | Task(s) |
|---|---|---|
| D1 | the number on the device is the Homunculus protocol; Comed's is not looked up | nothing to build: the key the door receives is matched as it is (B4, B5); the guide says so (D1 Step 1) |
| D2 | a durable record, shown with its source | B1, B2 (the table), B4 (both doors write it), B8 (the read), W2 (the box) |
| D3 | a wrong device value can be corrected — overrides G3-01 D11 | B7 (the route takes `ingest` rows), W2 (`CorrectDialog`), W3 (the trend table) |
| D4 | an unmatched reading is listed with its value — overrides G2-A11 D3 at `/ingest` and B1d D4 | B5 (the door), B6 (the list), W4 (the step) |
| D5 | a device reading counts for the vital task — overrides G3-02 D2 | B9, W5 |
| D6 | `vital_readings`, written by both doors; the box reads the table only | B2, B4, B8 |
| D7 | audit first, table second; a failed table write does not fail a request — except on the unmatched path (500); `reconcile` at start and hourly over 48 h | B4 (`_file_recorded`), B5 (`_file_unmatched`), B7 (the mark), B10 (`reconcile`, the loop) |
| D8 | the admission is stamped at arrival; the shared SQL fragment; `boardkey.py` untouched | B2 (`admission_keys.py`, `admission_of`), B4 (`_admission_for`) |
| D9 | the policy switch; default `card`; production `unmatched`; `READINGS_UNKNOWN_KEY=card` | B5 |
| D10 | the list and its two actions; `clinical.chart`, a person only; sets | B6 |
| D11 | who sees what; the target passes `_require_patient`, is not discharged; the identity question | B6 (`_reading_visibility`, `_link_target`), W4 (the question before the link) |
| D12 | a link enters the real engine at its own time with the device as source; `_apply_reading`; claim, release; 24 h | B3 (the function), B6 (the route), B10 (orphaned claims) |
| D13 | correction reuses «hatalı giriş»; the event stays `chart_retract`; the corrected value is a hand entry at the reading's time | B7, W2 |
| D14 | a re-sent reading is recognised; fails open; the unique index | B1 (`seen`), B2 (the index), B4 (`_resent`) |
| D15 | the vital task reads `chart` and `ingest` rows; `NEWS2_INPUT_CODES`; partial after a device round | B9, W5 |
| D16 | the «Ölçüm kaydı» box; trends `device`; «cihaz» and «Düzelt» in the trend table | B8, W2, W3 |
| D17 | the list lives in `/olcum`; the rail badge, polled every 60 s, neutral | W4 |
| D18 | the device query path is not changed; `/ingest` keeps answering 200 | «Ground rules» (the seven files); B4/B5 (every answer 200, the one 500 of D7) |
| D19 | the migration is schema-only; the backfill script | B2, B10 |
| D20 | rollback, and what it brings back | B2 (the downgrade and its test), «Deploy notes» (the three counts) |
| §10 Q1–Q4 | chart permission for the list; 24 h; the struck value and the «elle» correction; the timer resets and the NEWS2 is partial | B6; B6 (`LINK_MAX_AGE`); B7 + W2; B9 + W5 |

**Testing (spec §7), bullet by bullet:**

| Spec §7 | Where |
|---|---|
| store: add, seen, dedupe, list by patient, unmatched list, claim / release / finalize, void, reject | B1 `tests/readings_contract.py`, `test_readings_store.py` |
| Postgres: round trip; the admission stamp for an open, a DRAFT, a legacy H-key and a transferred admission; the two unique indexes; the audit index; downgrade; one alembic head | B2 `test_readings_postgres.py`, `test_migration_0021_vital_readings.py`; `test_audit_postgres.py` (the head); G1 Step 3 |
| `/ingest`: a matched row carries `audit_id` and `admission_id`; a duplicate writes no second audit row and no engine point; `seen` raising still ingests; a table failure still answers 200 | B4 `test_readings_ingest.py` |
| a discharged number is listed with its value and raises no alert, frame or notification; policy `unmatched` lists an unknown number and makes no card; policy `card` behaves as today; a `prodserver` test pins the production policy | B5 `test_readings_unmatched.py`; `test_api_identity_ingest.py::test_a_reading_without_an_identity_still_makes_a_card` stays untouched |
| list / assign / reject: permission, device 403, the scope filter, every refusal code, a linked reading enters the engine at its own time with the device as source, a double assign is 409, a failed apply releases the claim, a restart replays the same picture | B6 `test_readings_api.py` |
| correction: NEWS2 falls, the alert clears, the table row is voided, a re-send is a duplicate; `rehydrate` and `rebuild_patient` both skip it; the «device value cannot be withdrawn» test flips | B7 `test_device_retract.py`; `test_bedside_retract.py`'s docstring (the 404 test there used an `alert` row and still holds) |
| vital task: a device reading anchors, a withdrawn one does not, a future-stamped one is ignored | B9 `test_tasks_api.py` |
| `reconcile`: a missing recorded row, a missing void, an orphaned claim, idempotent when run twice | B10 `test_readings_reconcile.py`, and on the real table in `test_readings_postgres.py` |
| the other readers of withdrawals (Lane A) | B7 `test_device_retract.py` `TestTheOtherReadersOfWithdrawals` |
| restart after a device withdrawal: no old acknowledgement on an alert the replay raises differently (Lane A) | B7 `test_device_retract.py` `TestARestartAfterADeviceWithdrawal` (three cases; all three hold on the scratch copy — the «replay never prunes» risk was not reproduced by them) |
| pins | the pin table («The pins»); B6, B8, W1 Step 9; G1 |
| dashboard: client calls; `ReadingsBox`; `CorrectDialog` (order of the two calls, partial failure, hidden after 24 h); the trend tag; the unmatched step and the badge; the raw-key sweep, four languages | W1, W2, W3, W4 (`rawKeys.test.jsx` gets both answers); `kayit.strings.test.js`, `strings.test.js` |
| two themes, 390 and 1440 px | G2 (the walk's screenshots) |
| gates | G1 |
| local walk, five steps | G2 |

**Spec §8 (deploy)** → «Deploy notes for Lane A». **Spec §10 O1** → B4 Step 6 (one test, `test_api_scope.py`). **O2** → B7 (E-8). **O3** → the comment at `HAND_LIMIT` (B9) and the note at `TRENDS_MANUAL_LIMIT` (B8). **O4** → «Deploy notes», the guide's «Açık». **O5** → «Order, lanes and file ownership».

**Self-review notes.** No step says «TBD» or «similar to Task N»; every function, constant and key a task uses is defined in an earlier task or in «Interfaces». The only blanks left are the controller's records in D1 (`…`: the head's sha, the gate lines, the walk's outcome), which do not exist until G1 and G2 have run. Task G2's commands are the one part of the plan that was not executed while it was written.

# G3-02 · My tasks («Görevlerim») — design

Group 3, slice 2 (roadmap `2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`, Grup 3). Lane A. Owner's decisions of
2026-11-09: scope **A** (infrastructure + hand-created tasks + the vital-measurement task), two 12-hour shifts
**08:00–20:00 / 20:00–08:00**, architecture **1** (derived vital tasks, stored hand tasks), «önerilerinle devam».
Builds on G3-01 (bedside vitals; its D15 deferred the «vital zamanı / gecikti» reminder to this slice), G2-A2 (NEWS2
freshness), G2-B1a (admissions), G2-B1d (protocol settings pattern) and the Group 1 shell.

## 1. Why

The ward's work has no shared queue. The prototype's «Görevlerim» is a 24-hour grid per patient fed by the care plan,
medication orders and form reminders — none of which exist in the live system yet. What does exist is the hand-entered
NEWS2 set (G3-01) and the knowledge of when it was last entered; what the nurses asked for first is «whose vitals are due,
whose are late». This slice builds the queue, fills it with the two sources the live system can honestly feed today — a
task a clinician writes, and the next vital measurement — and leaves the model open to the sources later slices add.

Homunculus does not decide how often a patient is observed. The only interval the vault supports is NEWS2 score 0 →
«minimum 12-hourly observations» ([[news2-rcp-2017]], an `extract`); every other band's interval is the **hospital's
protocol**, entered by the administrator as a tenant setting. A band without an interval produces no task.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Two sources, one model.** A task row has `source`: `manual` (written by a clinician) or `vital` (derived, never stored). Later slices add `med`, `careplan`, `handover` as new sources without touching the screen's model. | Owner chose A; YAGNI on the sources the live system cannot feed yet. |
| D2 | **The vital task is derived at read time, never stored.** Anchor = the time of the patient's most recent non-withdrawn **hand entry** of any NEWS2 input (the `chart` audit rows G3-01 writes, read the way `api/trends.py` reads `manual`; a `chart_retract` removes the entry from the anchor, D12 of G3-01). `due_at = anchor + interval(band)`. With no hand entry in the last 48 h the anchor is the admission's `admitted_at` (kabul); a legacy patient with neither shows «ölçüm kaydı yok» with no due time (state `unknown`). | One truth: the measurement itself. No scheduler, no rows to drift, no double generation after a restart; completion is the G3-01 save. Monitor and HL7 observations do not count — the task is about the hand set (the real engine receives only hand sets today). |
| D3 | **Band → interval** from the engine's published NEWS2 total and `red_param` (`rules/news2.py` `NEWS2_BANDS`): keys `b0` (0), `b1_4` (1–4, no single 3), `b3_single` (a parameter scoring 3), `b5_6`, `b7` (≥7). Default intervals: `b0 = 720` min (source: [[news2-rcp-2017]] «Minimum 12-hourly observations»); the other four **NULL = not configured → no vital task** for patients in that band, and the settings tab says so. A `partial` or `stale` total still selects the band (it can only understate); the task carries `partial: true` so the screen can say «eksik skorla». | Hard rule 1 (no clinical claim without a source) and rule 5 (recommendations, not orders): the vault has one sourced interval; the rest is the hospital's protocol, named as such. |
| D4 | **States** at `now`: `plan` (now < due_at), `due` (due_at ≤ now < due_at + grace), `late` (after grace), `done` (a hand entry exists in that hour cell — history, from the same manual rows), `skipped` (a `vital_skipped` event with `until` ≥ now; the task is hidden until `until`, then derives again), `unknown` (D2). Grace default **30 min** (setting). A hand task is `open`, `done` or `skipped`, and `late` when `open` and now > due_at + grace. | Mirrors the prototype's legend (tamamlandı · gecikti · şimdi · planlı · uygulanmadı) with one definition each. |
| D5 | **The grid window** is the current shift: 24 hourly columns from the shift start that contains `now`, in the tenant's time zone (`tenants.timezone`, `Asia/Baku` in the pilot), shift starts **08 and 20** (setting). Past cells show `done` entries and closed hand tasks; a past `due` point that was never met is NOT painted retroactively as a miss — the vital task simply stays `late` until the next entry. | Deriving a retroactive miss history means replaying band changes hour by hour; the ward needs «late now», and lateness history is an open item (O3). |
| D6 | **Hand tasks** live in Postgres table `tasks` (migration 0017): `id` UUID, `tenant_id` FK, `patient_key` (the board's patient key — protocol number or H-number, the same key `POST /clinical/{id}` takes), `title` **EncryptedString** ≤ 200 chars, `due_at` tz, `target_role` ∈ {`nurse`, `physician`, `any`}, `created_by` UUID, `created_at`, `state` ∈ {`open`, `done`, `skipped`}, `claimed_by` UUID NULL, `claimed_at`, `closed_by` UUID NULL, `closed_at`, `skip_reason` EncryptedString ≤ 200 NULL; indexes `(tenant_id, due_at)`, `(tenant_id, patient_key)`. Rows are never deleted. `due_at` at most 24 h in the past and 7 days ahead at creation. | A list the ward filters by time and patient; free text may name a person → encrypted at rest like B3a's bed note; the audit row carries no text (D7). |
| D7 | **Audit events**, appended to the tenant's chain with the actor: `task_created {task, patient, due_at, target_role}`, `task_claimed {task}`, `task_done {task}`, `task_skipped {task}` (no reason text), `vital_skipped {patient, until}`. None joins `REBUILD_EVENTS` (no engine state changes). | Every write is attributable; text stays in the encrypted column. |
| D8 | **Permissions** `tasks.view` (open the screen, read `/tasks`) and `tasks.manage` (create, claim, close, skip). Default groups: nurse, charge_nurse, physician, unit_physician, attending, rapid_response get both; auditor, pharmacist, biomedical, platform_support none; hospital_admin everything by rule. Migration 0017 inserts the two keys into the existing default groups of every tenant **by slug, where missing** (`ensure_default_groups` creates missing groups only; it does not grow an existing group's rows). | The screen is for the people who do the work; the administrator gets it by rule. |
| D9 | **Scope.** `/tasks` reads only patients in the caller's bed scope — the same `resolve_scope` `/patients` uses (3b); creating, claiming, closing or skipping a task for a patient outside the scope answers 403 `scope_denied`; a discharged key answers `dropped` as `/clinical` does. | Group 2's scope rule, unchanged. |
| D10 | **Settings** table `task_settings`, one row per tenant: `shift_start_a` 8, `shift_start_b` 20 (hours 0–23, distinct), `grace_min` 30 (0–240), `interval_b0` 720, `interval_b1_4`, `interval_b3_single`, `interval_b5_6`, `interval_b7` (minutes 5–1440 or NULL), `updated_at`, `updated_by`. `GET` answers the defaults when no row exists; `PUT` writes the row. Edited in Yönetim › **Görevler** tab, right `structure.manage` (as the Protokol tab). Every save is a `task_settings_changed` audit event with the new values (no text). | Hospital protocol belongs to the hospital; defaults so the screen works on day one. |
| D11 | **Refusals.** 403 missing right or scope; 404 unknown task; 409 claiming or closing a task that is not `open`; 422 title length, `due_at` outside D6's window, unknown `target_role`, settings out of range or equal shift hours; `dropped` for a discharged patient. The screen names each in the catalog's words. | Same door as G3-01. |
| D12 | **Screen** `/gorevler` (route id `gorevler`, rail after Ölçüm, icon `list`, `perms: ["tasks.view"]`, `work: true`). ≥ 900 px: the **grid** — patient rows (bed label · board identity, via the same `nameOf` as BedsideScreen) that expand into one row per task kind, 24 hour columns, a «şimdi» line, cells in the state's colour, `Şimdiye git`. Narrower (tablet, phone): the **list** — open tasks sorted late → due → plan, then by time; done hidden. Header counters for this shift: geciken · şimdi · kalan · tamamlanan. Filters: kind (tümü / vital / elle), «yalnız gecikenler», «yalnız benim rolüm» (the session's default group kind → nurse or physician; `any` tasks always show). | The prototype's screen, reduced to what the two sources can fill. |
| D13 | **Actions.** A vital cell opens G3-01's entry modal (`VitalsEntry`) for that patient; saving refreshes the queue. A vital cell's menu also offers «uygulanmadı» (reason ≤ 200, `tasks.manage`) → `vital_skipped` until the next due point. A hand task opens a dialog: üstlen · tamamla · uygulanmadı (reason). «+ Görev» opens the creation dialog: patient (from the scoped board), due time (default the next full hour), text, target role. Without `tasks.manage` every action is hidden and the screen is read-only. | One entry path for vitals (G3-01's), so no second form charts a value. |
| D14 | **Refresh** every 30 s (`useTasks`), and immediately after any action; a failed read keeps the last answer and shows the board strip's reconnect note (as BedsideScreen does). No SSE, no notification. | Ward tempo, not alarm tempo. |
| D15 | **Out of this slice:** notifications of any kind; a tasks box on the patient screen; medication, care-plan and handover sources; personal assignment (after B1c care team); an exemption for monitored beds (asked again when Aşama B's values enter the real engine); lateness/miss history (O3); printing the shift's tasks. | One slice, one screen. |
| D16 | **i18n:** `src/live/i18n/strings/gorevler.js` with `tr`, `az`, `ru`, `en`; every user-facing string through the catalog (G3-01's pattern, `rawKeys` test). | Shell rule. |
| D17 | **Time zone:** the API speaks UTC ISO-8601; shift boundaries and hour columns are computed in `tenants.timezone`; the API returns `shift.start`/`shift.end` so the client never guesses the boundary. | One clock. |
| D18 | **Migration numbering:** `0017_tasks` revises `0016` (B3a Doluluk). If B3a is not on main when this merges, this becomes `0016` and B1d is told the same day (one chain). H1a (held) takes the next free number. | Alembic is a single chain. |

## 3. API

**`GET /tasks?from=&to=`** (`tasks.view`). Defaults: the current shift window (D5). Answer:

```json
{"from": "…", "to": "…", "shift": {"start": "…", "end": "…"}, "now": "…",
 "settings": {"grace_min": 30, "intervals": {"b0": 720, "b1_4": null, "b3_single": null, "b5_6": null, "b7": null}},
 "patients": [{"patient_id": "…", "bed_key": "…", "unit_id": "…",
   "vital": {"state": "late", "anchor_at": "…", "due_at": "…", "band": "b1_4", "interval_min": 240,
             "partial": false, "skipped_until": null, "entries": ["…", "…"]},
   "tasks": [{"id": "…", "title": "…", "due_at": "…", "target_role": "nurse", "state": "open",
              "late": true, "created_by": "…", "created_at": "…", "claimed_by": null, "claimed_at": null,
              "closed_by": null, "closed_at": null}]}]}
```

`vital` is `null` when the patient's band has no interval (D3); `state: "unknown"` with `due_at: null` for D2's legacy case.
`entries` are the hand-entry times inside `[from, to)` (the grid's `done` cells). `title` is decrypted for the caller.

**`POST /tasks`** (`tasks.manage`) `{"patient_id", "title", "due_at", "target_role"}` → 201 with the task (D11 refusals).
**`POST /tasks/{id}/claim`**, **`POST /tasks/{id}/done`**, **`POST /tasks/{id}/skip`** `{"reason"}` → 200 with the task; 409 unless `open`.
**`POST /tasks/vitals/{patient_id}/skip`** `{"reason"}` → `{"patient_id", "skipped_until"}` (= the due point after the current one).
**`GET /tenant/task-settings`** (`structure.manage`) → the row or the defaults with `"configured": false`.
**`PUT /tenant/task-settings`** → the row (D10 validation).

## 4. Engine and API changes (by file)

- `homunculus/tasks/__init__.py`, `schedule.py` — pure functions, no I/O: `band_of(total, red_param)`, `shift_window(now, tz, starts)`,
  `vital_task(anchor, admitted_at, interval, grace, skipped_until, now)` → the `vital` object of §3, `hand_state(task, grace, now)`.
- `homunculus/tasks/models.py` — ORM `Task`, `TaskSettings` (EncryptedString from `crypto.py`, as B3a's note).
- `homunculus/tasks/repository.py` — the seam: `TaskRepository` protocol with a Postgres implementation and an in-memory one for the
  DB-less suite (the pattern `protocol/` and `admission/` use).
- `homunculus/tasks/router.py`, `schemas.py` — the routes of §3; the anchor read reuses the manual-entry read `api/trends.py` holds
  (lifted into a shared helper, `TRENDS_MANUAL_LIMIT` unchanged), the admission's `admitted_at` from the admissions repository,
  the band from `api/board.py` `_news2` (shared function, not re-scored).
- `homunculus/auth/permissions.py` — the two keys and the default-group rows of D8.
- `alembic/versions/0017_tasks.py` — `tasks`, `task_settings`, the permission rows (D8); downgrade drops exactly these.
- `api/app.py` — `include_router(tasks_router)` with `resolve_scope`, the audit log and the notifier-less door; `/clinical` is unchanged.

## 5. Dashboard

- `src/live/shell/routes.js` — the import line, the `SCREENS` line and the `ROUTES` entry of D12 (three lines, blank-line separated).
- `src/live/screens/gorevler/GorevlerScreen.jsx` (header, counters, filters, grid/list switch by width), `TaskGrid.jsx`, `TaskList.jsx`,
  `TaskDialog.jsx` (create / claim / done / skip), `useTasks.js` (fetch, 30 s refresh, action calls, refusal mapping), `hours.js`
  (hour bucketing and shift columns from the API's `shift`), tests beside each.
- `src/live/screens/patient/VitalsEntry.jsx` — accepts a patient prop so the grid can open it (no behaviour change on the patient screen).
- `src/live/screens/admin/TasksTab.jsx` — the settings form (D10), registered as the Görevler tab (`structure.manage`); test.
- `src/live/i18n/strings/gorevler.js` and the catalog import line (D16).

## 6. Testing

- Engine, DB-less: `tests/test_tasks_schedule.py` (bands incl. single 3, intervals NULL → no task, grace edges, skipped_until, anchor from
  entry vs admission vs unknown, shift windows across midnight and DST-free `Asia/Baku`), `tests/test_tasks_api.py` (routes, rights,
  scope 403, `dropped`, 404/409/422, audit events and their payloads, settings defaults and validation, decrypted title for the caller).
- Engine, Postgres part: `tests/db/test_tasks_postgres.py` (repository round trip, encryption at rest, 0017 upgrade/downgrade, permission
  rows inserted once).
- Dashboard: `GorevlerScreen.test.jsx` (grid vs list by width, counters, filters, states and colours, actions and refusal texts, read-only
  without `tasks.manage`), `routes.test.js` additions (rail order, permission), `TasksTab.test.jsx`, `rawKeys` completeness for the four languages.
- Gates, as G3-01: engine no-DB suite, Postgres part on a disposable database (`TEST_DATABASE_URL`, name containing `test`), Python 3.14 slice,
  `./node_modules/.bin/vitest run`, `npm run build` (precache count recorded), local walkthrough on the local stack with synthetic patients.

## 7. Deploy

After B3a (0016) is live, as its own release: bundle → `alembic upgrade head` (0017) → api + web images; hub, bridge, nce and postgres untouched;
rollback = previous image tags + `alembic downgrade 0016` (drops only the two tables and the two permission keys). Blocks in the DALGAPERF2 style,
one at a time, owner's «onay» first; the owner walks the screen on a tablet after the deploy.

## 8. Open items

- O1 The other NEWS2 bands' intervals have no vault source: ingest the full RCP NEWS2 text (compile loop) before offering sourced defaults.
- O2 Monitored-bed exemption, when Aşama B's monitor values enter the real engine.
- O3 Lateness history (how often a patient's set was late) — an audit event at the moment a task turns late, or a nightly derivation.
- O4 Personal assignment and «my patients» after B1c (care team).
- O5 Medication, care-plan and handover sources (their own slices).
- O6 A tasks box on the patient screen; O7 notifications; O8 printing the shift's tasks (prototype `yazdir.js`).

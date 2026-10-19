# Vital trend charts (Group 2 · slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The patient screen's dashed "Vital eğrileri" placeholder becomes six engine-backed trend cards, a big chart per card (6 h / 24 h / 3 days, a readout, the alarm and antibiotic marks, an accessible table) and a "Hastanın normali" form — all served by one new read endpoint that carries the thresholds as data.

**Architecture:** The engine composes, the browser draws (spec D1). `rules/news2.py` turns its five if-chains into one table, `NEWS2_BANDS`, that the score and the charts both read; `state/timeline.thin()` caps a series for drawing; the three audit logs gain `records(since=)`; `api/trends.py` builds the answer (every reading with the engine's NEWS2 points for it, the latest value's delta / points / own-normal verdict, the bands, the alarm-episode and antibiotic marks) and `api/app.py` mounts `GET /patients/{patient_id}/trends` behind the board's own permission and scope checks. The dashboard reads it through `useTrends` (inside the session's `track`, polling only while READY and visible, keeping the last answer when a read fails), draws it with a pure `trendGeometry.js` and an SVG `TrendChart`, and writes the patient's normal through `PUT /clinical/{id}/profile` with a body of `{baselines}` alone.

**Tech Stack:** Python 3.12 and 3.14, FastAPI, SQLAlchemy/psycopg2 (Postgres) and sqlite3, pytest; React 18, Vite, Vitest + Testing Library (`fireEvent`; no user-event), Tailwind on the live token classes, inline SVG (no chart library).

**Spec (authoritative):** `docs/superpowers/specs/2026-10-19-g2-vital-egrileri-design.md`. Where the code made the spec's letter impossible or unsafe, this plan departs from it; every departure is in the table below with its file and line, and is an open item for the user.

**How the numbers in this plan were obtained.** All seventeen tasks were implemented, in this order, in the worktree while the plan was written, and every red, every green and every count below is what was printed; the tree was then restored to `b6ed65d` and only this file was committed. The verified implementation is kept beside the per-task files as `/c/tmp/homunculus-plans/g2v/reference.patch` — a cross-check, not the authority: build from the tasks.

---

## What the code says that the spec did not (read before Task 1)

| # | Spec | Code at `b6ed65d` | This plan |
|---|---|---|---|
| X1 | §4: `_require_patient` gives "403 out of scope, 404 unknown patient, 503 scope unreadable (the same three the board gives)" | `_require_patient` (api/app.py:476–514) answers **404** for out of scope *and* for an unreadable scope (`UNKNOWN = Scope(False, "unknown")`, scope/resolver.py:23, sees nothing); 403 is the missing permission (`_require`, app.py:436–440); 503 exists only at `/stream-ticket` (app.py:889–894); `/patients` answers 200 with an empty board. The roadmap already records "her yerde 503 olmalı" (roadmap l. 659). | 401 no credential · 403 without `board.view` (before the scope is asked) · 400 bad `hours` · **503 when the scope is UNKNOWN**, checked before `_require_patient` · 404 out of scope (audited `scope_denied`) or unknown id (nothing created). |
| X2 | §4 example bands `{"low": 41, "high": 50}` | The rules score real numbers with `<=` chains (rules/news2.py:23–84); whole-number rows leave `40 < v < 41` in no row. | Rows are `low < value <= high`: `{"low": 40, "high": 50, "points": 1}` — contiguous, and exactly the old boundaries. |
| X3 | §4: "`markers.alarm` are the patient's audited `alert` events" | The engine re-emits every active alert on every reading (pipeline.py:91–96) and `/ingest` appends an `alert` row for each (app.py:684–687); api/alarm_quality.py:14–18: "The unit is the episode, not the alert row … `first_seen` is stamped exactly once per episode". | Alarm marks are `first_seen` rows (one per episode), at the escalation clock's own instant (`payload["at"]`, else `ts`). |
| X4 | §4: "`markers.antibiotic` are `ANTIBIOTIC_ADMINISTERED` observations" | A charted `0.0` means "not given" (api/board.py:98–101 counts only `>= 1.0`). | Only values `>= 1.0` are marks. |
| X5 | §4 `points: [[iso_ts, value]]`; §3.2 the table's NEWS2 column is "a lookup, not a computation" | — | Each point carries a third element, **the engine's NEWS2 points for that reading** (`null` for MAP and lactate), so the browser never compares a value with a band edge. Additive; the chart ignores it. |
| X6 | §3.1: MAP "in the same `--v-map` colour at reduced opacity"; §6: "the `--v-*` lines must keep 3:1" | Measured: `--v-map` at opacity .55–.70 over the band tints on a card is **2.17–3.34:1** in Gece and Gün. | MAP drawn at full colour with **hollow** dots; systolic filled; the legend names both. |
| X7 | §3.1: age "through the existing `elapsed.js`/`useNow`" | Binding contract (amendments, "From Wave 3 … contracts"): "A screen that prints an age calls `useBoardNow`, NEVER `useNow`"; `elapsed.js` is the alarm's `m:ss`. | The patient screen's own `useBoardNow` instant is passed down; `ageText` moves from PatientScreen.jsx:61–66 to `screens/patient/ageText.js` and both use it. |
| X8 | §3.3 on 400: "the engine's reason under the form … and a toast" | Amendments (a): a write's refusal goes on the toast, "never also inline" (two `role="alert"`s announce one refusal twice). | Toast only, named after the bed; the form stays open. The client-side checks (both bounds, a number, low ≤ high) stay inline — they are not refusals. |
| X9 | §6: the `formsSoon` sentence moves "unchanged in wording" | Its four texts (strings/patient.js:63, 116, 169, 222) promise "entering the patient's own normal" for the next group — this slice delivers it. `patient.onlyWrite` (l. 14, 67, 120, 173) says the screen writes ONE thing. | Both reworded in four languages (Task 8): `formsSoon` names the SOFA form only, `onlyWrite` names the two writes. The existing test regexes (`heç nə yazılmır`, `növbəti qrupda əlavə olunacaq`) still match. |
| X10 | §7/§8: "390 px … (the screen test util's overflow check)" | There is no such util; jsdom has no layout (the only `scrollWidth` check is ui/Table.jsx's own). | Tests pin the layout classes (one column, `min-[861px]:grid-cols-2`, `min-[1200px]:grid-cols-3`, `min-w-0`, the kit `Table`'s scroll region); the 390/1440 px check is a browser step in Task 16. |
| X11 | §8: end to end "with `scripts/replay.py`" | The scenarios are fixed-date (septic_shock.yaml `start: 2026-07-14`, news2_deterioration.yaml `2026-09-08`) and replay.py posts to `localhost:8000` with `dev-token` (replay.py:17–25). A window that ends at the server's now draws nothing. | Task 16: `loader.rebased()` and replay.py `--now`, `--url`, `--token-env` (the token from the environment, never the command line). |
| X12 | §6: "same error mapping as `patients()`" | There is no `patients()`; the board read is `boardPatients()` (backendApi.js:519). | `patientTrends` is an `authed()` GET like `boardPatients`; same `failure()` mapping, same 15 s `timed()`. |
| X13 | — | backendApi.js:778–787 `setProfile` always sends `comorbidities: []` unless given one; the engine reads a present-but-empty list as "clear them" (api/clinical.py:212–222). No live screen calls it today. | `putPatientProfile(id, body)` sends the body as given; a test pins `setProfile`'s behaviour so nobody "simplifies" the form onto it. |
| X14 | §3.3: "all pairs empty → the Save button is disabled" | Amendments (c): `Button` takes `busy`, never `disabled`. | `aria-disabled="true"`, focusable, the reason in words under the fields, and no request. |
| X15 | §3.3: "the engine refuses an empty profile" | Only when no comorbidity and no baseline SOFA is charted either (api/clinical.py:249–259); with either, `{"baselines": {}}` is accepted and clears every baseline. | As the spec says (nothing sent when all pairs are empty) — which means **the form cannot remove the last baseline**. Open item O4. |
| X16 | §5 | Two route registries the spec does not name must list the route: tests/test_board_permissions.py `BOARD_EXPECTED` and tests/test_tenant_isolation.py `UNSCOPED_BY_DESIGN`; and the dashboard's apiErrors.test.js reads every `detail="…"` literal of api/app.py, so the route's new 400 needs an `errors.*` key in the same task. | Task 5 does all three. |
| X17 | §6 the form "on the kit's Modal, Field, Button"; prefill "from `bands.own_normal` of the current response" | The engine REPLACES the whole set with what is sent. | The button is offered only once the trends have answered and while they are readable: the form must open on the set it replaces. |
| X18 | — | `refusal.js` is `src/live/screens/admin/refusal.js`, not `src/live/refusal.js`. | The form imports `mayHaveLanded` from there (the one rule). |
| X19 | — | `src/reachable.test.js` fails on any module `main.jsx` cannot reach. | The dashboard is built top-down: each task wires the module it creates (Task 9 wires the box before any card exists). |

---

## Baseline at `b6ed65d` (measured 2026-10-19)

- **Dashboard:** `npx vitest run` → **81 files / 1912 tests**, all passing. `npx vite build` clean, precache 20 entries.
- **Backend, the brief's command** (`--ignore=tests/test_infinity_vm_pilot.py`, no `PYTHONPATH`, no database): **1979 passed, 644 skipped, 2 failed** — `test_infinity_research.py::test_schema_validation_remains_active_under_optimized_python` and `test_jwt_caller.py::test_the_refusals_run_when_prodserver_is_imported`. Both spawn a child `python` that cannot `import homunculus` (`ModuleNotFoundError: No module named 'homunculus'`): the f7-py312 venv does not have this worktree installed. **With `PYTHONPATH=src` both pass: 1981 passed, 644 skipped, 0 failed.** Every Python command below sets `PYTHONPATH=src`.
- **Backend with Postgres** (`TEST_DATABASE_URL=…/homunculus_test_g2v`, `PYTHONPATH=src`): **2617 passed, 8 skipped** in 25 min 41 s — longer than one Bash call may run (10 min), so Task 15 runs it in thirds.
- **Python 3.14:** `/c/tmp/g115-py314/Scripts/python.exe` (3.14.5) runs this worktree's tests with `PYTHONPATH=src`.

## Counts after each task (merged in plan order)

If tasks are merged in another order, a total is the base plus the deltas of the tasks merged; each task also states its own files' counts, so a wrong total can be traced to a file.

| After | Backend, no DB (passed / skipped) | Dashboard (files / tests) | This task's test files |
|---|---|---|---|
| base | 1981 / 644 | 81 / 1912 | — |
| 1 | 1995 / 644 | — | `test_news2_bands.py` **14** (new) |
| 2 | 2010 / 644 | — | `test_timeline_thin.py` **15** (new) |
| 3 | 2023 / 648 | — | `test_audit_since.py` **13 + 4 skipped** without the DB, **17** with it (new) |
| 4 | 2044 / 648 | — | `test_trends.py` **21** (new) |
| 5 | 2070 / 648 | 81 / 1914 | `test_trends_api.py` **21** (new); isolation 15 → **18**; board_permissions 55 → **57**; tenant_isolation 109 (a registry row, no new test); dashboard `apiErrors.test.js` 141 → **143** |
| 6 | — | 81 / 1920 | `backendApi.test.js` 104 → **110** |
| 7 | — | 81 / 1954 | `tokens.test.js` 192 → **226** |
| 8 | — | 81 / 1954 | `strings.test.js` 6 → **6** (it loops; no count moves) |
| 9 | — | 82 / 1967 | `useTrends.test.jsx` **9** (new); `PatientScreen.test.jsx` 50 → **54** |
| 10 | — | 84 / 1981 | `news2Tone.test.js` **2**, `TrendCard.test.jsx` **10** (new); PatientScreen 54 → **56** |
| 11 | — | 86 / 2010 | `trendGeometry.test.js` **16**, `TrendChart.test.jsx` **12** (new); TrendCard 10 → **11** |
| 12 | — | 87 / 2020 | `TrendModal.test.jsx` **8** (new); trendGeometry 16 → **17**; PatientScreen 56 → **57** |
| 13 | — | 87 / 2027 | TrendModal 8 → **15** |
| 14 | — | 88 / 2041 | `BaselineForm.test.jsx` **12** (new); PatientScreen 57 → **59** |
| 15 | — | 88 / 2042 | `rawKeys.test.jsx` 6 → **7** |
| 16 | 2074 / 648 | — | `test_scenario_rebase.py` **4** (new) |
| 17 | — | — | docs only |

Backend arithmetic: 14 + 15 + 13 + 21 + (21 + 3 + 2) + 4 = **93** passed and **4** skipped over the base. Dashboard: 2 + 6 + 34 + 13 + 14 + 29 + 10 + 7 + 14 + 1 = **130** tests and 7 files.

---

## Ground rules for every task

- **Your worktree.** `/c/tmp/g2-vital`, branch `feat/g2-vital-egrileri` (from `b6ed65d`). If the controller gives you a parallel worktree branched from this one, every path below reads that worktree instead. **Never touch `/c/Users/User/Desktop/Project/Homunculus AI`** (the user's main checkout). Never `git push`, never deploy, never connect to the VM. **Never run `git stash`** — the stash is shared with every other worktree and session. If you remove a worktree, unlink its `node_modules` junction first (`cmd /c rmdir "<worktree>\dashboard\node_modules"`), then `git worktree remove --force`: a recursive delete that follows the junction empties the shared install. Never reinstall `node_modules`.
- **Write and Edit tools only — never `sed`, `python`, `node` or a shell heredoc on a repo file.** The tree checks out **CRLF** (`core.autocrlf=true`); every block here is LF. The Edit tool matches either way; a shell replacement fails or rewrites every line end. **Write** is for a file this plan gives whole (every new file, and `scripts/replay.py` in Task 16); **Edit** for everything else, and its old text must match exactly once. For `strings/*.js` (Azerbaijani, Russian, Turkish) run `npx vitest run src/live/i18n/strings.test.js` after editing: it fails if the Cyrillic or the `ə` was mangled.
- **TDD.** Write the test, run it and **see it red for the reason the task names**, then the code, then green. Put the red in the commit body (`red: 13 failed, 4 skipped — TypeError … unexpected keyword argument 'since'`).
- **Stage explicit paths only** (the task's `git add` line). Before every commit run `git status --short` and `git diff --cached --stat`; if a staged path is not one the task lists, or a file you stage holds hunks that are not yours, stop and ask.
- **Commit after every task.** Messages are `type(scope): what, in words` (`feat(engine): …`, `feat(dashboard): …`, `test(…)`, `docs(…)`) and end with:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  ```
  (the trailer the controller set for this plan; if amendments.md records a newer one by the time you commit, use that.)
- **Foreground gates.** Run every suite and build in the foreground; never background a gate and wait on it (an agent that did sat silent for hours). One Bash call runs at most 10 minutes: name the files; the whole Postgres-backed suite runs in thirds (Task 15).
- **Python commands** (always from the engine directory, always `PYTHONPATH=src`, always name files):
  ```bash
  cd /c/tmp/g2-vital/homunculus-engine
  PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q <files> 2>&1 | tail -3
  ```
  **Never run `tests/test_infinity_vm_pilot.py`** (it hangs), alone or in a bare `pytest tests/`. The whole no-DB suite: the same command with `--ignore=tests/test_infinity_vm_pilot.py` and no file list (≈ 2 min).
- **Postgres-backed tests** read `TEST_DATABASE_URL`, given **on the command line of each call, never exported**; never set or export `DATABASE_URL`. The database name must contain "test":
  ```bash
  docker start homunculus-test-pg            # if `docker ps` does not list it
  docker exec homunculus-test-pg psql -U homunculus -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='homunculus_test_g2v'" | grep -q 1 \
    || docker exec homunculus-test-pg psql -U homunculus -d postgres -c "CREATE DATABASE homunculus_test_g2v"
  cd /c/tmp/g2-vital/homunculus-engine
  TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:55432/homunculus_test_g2v PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
    /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q <files> 2>&1 | tail -3
  ```
  `conftest.py` holds a session advisory lock per database, so two runs on `homunculus_test_g2v` queue rather than corrupt each other. Never print a token, a key or an env file's values.
- **Dashboard commands** run from `/c/tmp/g2-vital/dashboard`. Filter by file, or by folder **with a trailing slash** (`src/live/screens/patient/` — Vitest filters by substring). The suite and the build are **two separate commands**:
  ```bash
  cd /c/tmp/g2-vital/dashboard
  npx vitest run 2>&1 | tail -5
  ```
  ```bash
  cd /c/tmp/g2-vital/dashboard
  npx vite build 2>&1 | grep -E "\.js |built in|precache|larger than|error"
  ```
  The build must print `built in` and `precache  20 entries`, and no `larger than 500 kB`. A test run may print `Warning: An update to Announce inside a test was not wrapped in act(...)`; it is not a failure.
- **The dashboard gate** at the end of every dashboard task is the whole suite and the build. **The backend gate** is the task's named files plus its neighbours (each task lists them); Task 15 runs everything.
- **D1, the boundaries and reachability.** Nothing under `src/live/` imports outside it but `backendApi.js`, `liveAuth.js`, `liveAdapters.js`, `liveConnection.js` (`boundaries.test.js`). **Every production module must be reachable from `main.jsx` in the commit that creates it** (`src/reachable.test.js`) — which is why Task 9 wires an almost empty box before any card exists. No comment under `src/` may contain `import (` or a quoted `import "x"`.
- **No patient data, ever** (CLAUDE.md rule 6). Fixtures are synthetic and in code: patients `S-001`…, bed `REA-01 · 2`, "Ayşe Sentetik", "Sentetik Hastane" on the dashboard; `p-a1`…, `bed-1`, units `unit-adult` / `unit-nicu` in the engine. The trends fixtures live in `screens/patient/trends/trends.testutil.js`, relative to `board.testutil.js`'s `NOW`.
- **Thresholds live only in the engine.** The browser never computes a threshold, a band, a delta or NEWS2 points. Every dashboard test of a clinical fact hands the browser a fact that **contradicts** what it could have worked out itself — `news2_points: 3` on a value of 72, a delta that is not the difference of the points drawn, a band the server scored 3 over values that look normal — and asserts the engine's fact is what the clinician reads.
- **Four languages for every key** (`tr` is the source; `az` the default): the Azerbaijani and Russian texts in this plan were written by the planner and **await a native reading** (open item O1). An `az` text equal to `tr`, and an `ru` text with no Cyrillic, need a reviewed entry in `strings.test.js` (`AZ_SAME_AS_TR`, `NEUTRAL`). Russian calls the engine "система", never "движок". No user-visible text in a component that does not come from `t()` or from the caller; data (an alarm kind, a number, a bed label) is printed as data.
- **Refusals and announcements** (amendments, binding): (a) a write's refusal goes on the **toast** via `apiErrorText`, never in screen state and never also inline; `useToast()` **is** the function (no `.show`); a success test asserts the confirmation **and** that every `role="alert"` is blank. (f) A refusal names its subject: the server's bed label, else the patient id — **never `display_name`**. (c) `Button` takes `busy`, never `disabled`; text inputs held during a write are `readOnly`. A write with no answer may have landed: `mayHaveLanded(err)` from `screens/admin/refusal.js` is the one rule — read again what it touched and say so. Anything said once is said through `Announce` / `useAnnounced` — never a `role="status"` born with its text, never per tick, never on a mouse hover.
- **Ages** are aged against the patient screen's `useBoardNow` instant (the server's clock), never `useNow`.
- **Colours** are token classes, written out whole (`fill-band-crit`, `stroke-grid`, `text-v-hr`, `border-crit`), never a hex and never a Tailwind palette colour; an SVG series takes its channel's `text-v-*` class and draws in `currentColor`.
- **Accessibility, asserted:** one `h1` per screen; `h2` under it; a list is a `<ul>`; the table view is the kit `Table` with a caption, `th scope="col"` and a `th scope="row"` per row; the big chart is one tab stop, `role="img"` with a summarising label and its keys described; Escape closes (the kit `Modal`).
- **A test asserts what the clinician reads, not the API call.** A call assertion is allowed as well, never instead.
- **Test names:** `describe` names the thing, `it` is a sentence about its behaviour in the reader's terms ("frames red and says NEWS2 +3 from the engine's points …").
- New dashboard files stay under ~250 lines. **No new dependency.**

---

## File map

**Create — engine** (`homunculus-engine/`)

| File | Responsibility | Task |
|---|---|---|
| `src/homunculus/api/trends.py` | Builds the trends answer: series with per-reading NEWS2 points, latest facts, bands, marks. Never creates a patient, writes no audit row, imports nothing of Aşama A. | 4 |
| `tests/test_news2_bands.py` | The table against the old if-chains (kept verbatim), tiling, the vault source. | 1 |
| `tests/test_timeline_thin.py` | `thin()`'s properties on seeded random series; 72 h of 5 s data. | 2 |
| `tests/test_audit_since.py` | `records(since=)` in memory, SQLite and Postgres; instants, not text. | 3 |
| `tests/test_trends.py` | The builder on an `Engine` fed with readings, a profile and an in-memory audit. | 4 |
| `tests/test_trends_api.py` | The route over HTTP: answer, windows, 400/401/403/404/503, no audit row. | 5 |
| `tests/test_scenario_rebase.py` | `rebased()`; replay.py takes its token from the environment. | 16 |

**Modify — engine**

| File | Change | Task |
|---|---|---|
| `src/homunculus/rules/news2.py` | `BANDS_SOURCE`, `Band`, `NEWS2_BANDS`, `points_for`; the five `*_points` read the table. | 1 |
| `src/homunculus/state/timeline.py` | `thin(series, max_points)`. | 2 |
| `src/homunculus/api/audit.py` | `since_utc()`; `AuditLog.records` / `InMemoryAuditLog.records` / `SqliteAuditLog.records` take `since`. | 3 |
| `src/homunculus/api/audit_postgres.py` | `records(since=)` with a `timestamptz` cast. | 3 |
| `src/homunculus/api/app.py` | `GET /patients/{patient_id}/trends`. | 5 |
| `tests/test_infinity_shadow_isolation.py` | trends imports nothing of the lane; a trends read never reaches the shadow store; the shadow token is refused there. | 5 |
| `tests/test_board_permissions.py`, `tests/test_tenant_isolation.py` | one registry row each. | 5 |
| `src/homunculus/scenarios/loader.py` | `rebased(events, end)`. | 16 |
| `scripts/replay.py` | `--url`, `--token-env`, `--now` (Write, whole). | 16 |

**Create — dashboard** (`dashboard/src/live/screens/patient/`)

| File | Responsibility | Task |
|---|---|---|
| `trends/useTrends.js` | The read: session-tracked, on mount / new measurement / every 60 s while READY and visible; the last answer kept when one fails. | 9 |
| `trends/TrendsBox.jsx` | The box where the placeholder stood: header, states, the six cards, the dialog, the form. | 9, 10, 11, 12, 14 |
| `trends/trends.testutil.js` | Synthetic trends answers (test-only). | 9 |
| `ageText.js` | An age in the reader's words; moved out of PatientScreen.jsx. | 10 |
| `trends/news2Tone.js` | The ONE mapping from the engine's points to a tone (frame and band). | 10 |
| `trends/cards.js` | The six cards and the channels each draws. | 10 |
| `trends/TrendCard.jsx` | One card: values, delta, age, frame, badge, pill, mini chart. | 10, 11 |
| `trends/trendGeometry.js` | Pure geometry: frame, scales, bands, line, ticks, marks, nearest. | 11, 12 |
| `trends/TrendChart.jsx` | The SVG, small and big. | 11, 12, 13 |
| `trends/TrendLegend.jsx` | The big chart's legend, in words. | 12 |
| `trends/TrendModal.jsx` | The big chart dialog. | 12, 13 |
| `trends/trendText.js` | How the readout and the table word a time, a mark and a point total. | 13 |
| `trends/TrendTable.jsx` | The table view. | 13 |
| `trends/BaselineForm.jsx` | The patient's own normal. | 14 |
| tests: `trends/useTrends.test.jsx` (9), `trends/news2Tone.test.js` (10), `trends/TrendCard.test.jsx` (10, 11), `trends/trendGeometry.test.js` (11, 12), `trends/TrendChart.test.jsx` (11), `trends/TrendModal.test.jsx` (12, 13), `trends/BaselineForm.test.jsx` (14) | | |

**Modify — dashboard**

| File | Change | Task |
|---|---|---|
| `src/live/apiErrors.js`, `src/live/i18n/strings/errors.js` | the route's 400 → `errors.badTrendHours` (four languages). | 5 |
| `src/backendApi.js` (+ `src/backendApi.test.js`) | `patientTrends(id, hours)`, `putPatientProfile(id, body)`. | 6 |
| `src/live/session/testTokens.testutil.js` | `fakeApi` gains both. | 6 |
| `src/live/theme/tokens.css`, `tokens.js`, `tokens.test.js` | `--band-n`, `--band-mid`, `--band-crit`, `--grid` (Gece and Gün); the chart contrast pairs. | 7 |
| `src/live/i18n/strings/patient.js` | 49 keys × 4 languages; `onlyWrite` and `formsSoon` reworded (8); `trendsSoon` removed (9). | 8, 9 |
| `src/live/i18n/strings.test.js` | one `NEUTRAL` and six `AZ_SAME_AS_TR` entries. | 8 |
| `src/live/screens/patient/PatientScreen.jsx` (+ test) | `TrendsBox` where the placeholder stood; the forms note under the Sepsis/Meds row; `ageText` imported; header comment. | 9, 10, 12 (test also 14) |
| `src/live/rawKeys.test.jsx` | `patientTrends` stubbed; the trend charts' anchor. | 15 |

**Modify — docs** (Task 17): `docs/homunculus-rehber-TR.md`, `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`, the spec's §11.

---

## Task order and parallel work

| Task | Needs | May run beside (own worktree) | Files it shares with a later task |
|---|---|---|---|
| 1 NEWS2 rows as data | — | 2, 3, 6, 7, 8 | — |
| 2 `thin()` | — | 1, 3, 6, 7, 8 | — |
| 3 `records(since=)` | — | 1, 2, 6, 7, 8 | — |
| 4 the builder | 1, 2, 3 | 9 → 14 | — |
| 5 the route | 4 | 9 → 14 (its two dashboard files, `apiErrors.js` and `errors.js`, are touched by no other task) | — |
| 6 the API client | — | 1, 2, 3, 7, 8 | `testTokens.testutil.js` |
| 7 the tokens | — | 1, 2, 3, 6, 8 | — |
| 8 the strings | — | 1, 2, 3, 6, 7 | `strings/patient.js` (9) |
| 9 the box reads the endpoint | 6, 8 | 4, 5 | `TrendsBox.jsx`, `PatientScreen.jsx` + test |
| 10 the six cards | 9 | 4, 5 | `TrendsBox.jsx`, `PatientScreen.*` |
| 11 the mini chart | 10 (and 7 for the colours to render) | 4, 5 | `TrendCard.jsx`, `TrendsBox.jsx` |
| 12 the big chart | 11 | 4, 5 | `TrendChart.jsx`, `trendGeometry.*`, `TrendsBox.jsx` |
| 13 keyboard and table | 12 | 4, 5 | `TrendModal.*`, `TrendChart.jsx` |
| 14 the patient's normal | 13, 6 | 4, 5 | `TrendsBox.jsx`, `PatientScreen.test.jsx` |
| 15 sweeps and the full gates | 1–14 | — | `rawKeys.test.jsx` |
| 16 replay and the local walk | 15 | — | — |
| 17 docs | 16 | — | — |

**Waves:** A = {1, 2, 3, 6, 7, 8} in six worktrees; B = {4} beside {9}; C = {5} beside the chain 10 → 11 → 12 → 13 → 14 (sequential: each edits `TrendsBox.jsx`); then 15, 16, 17.

---

# Part 1 · The engine (Tasks 1–5)

### Task 1: NEWS2's rows as data — one table the score and the charts both read

Spec §5.1. The five `*_points` functions become lookups in `NEWS2_BANDS`; the trends endpoint (Task 4) serves the same rows, so a band on a chart and a point in the score cannot disagree. **No score moves:** the old if-chains are kept verbatim in the test as the reference, and every value on a dense grid, every boundary and both sides of it, ±∞ and NaN must score what they scored before. Scale 1 only (the module docstring says why Scale 2 is not implemented).

**Files:**
- Create: `homunculus-engine/tests/test_news2_bands.py`
- Modify: `homunculus-engine/src/homunculus/rules/news2.py` (the block from `def resp_rate_points` to the end of `def temperature_points`, lines 23–84)

- [ ] **Step 1: Write the failing test** — Write `homunculus-engine/tests/test_news2_bands.py`:

```python
"""NEWS2's bands are data, and the score reads them.

The trend charts draw these rows as bands (api/trends.py); the rules score with them. ONE table, so
a band on a chart and a point in the score can never disagree. Moving the five scored vitals from
if-chains to that table must move no score at all, so the if-chains are kept below, verbatim, as
the reference: every value on a dense grid, every boundary and both sides of it, the infinities and
NaN score exactly what they scored before.
"""
from __future__ import annotations

import math
from pathlib import Path

import pytest

from homunculus.rules import news2
from homunculus.rules.news2 import BANDS_SOURCE, NEWS2_BANDS, Band

VAULT = Path(__file__).resolve().parents[2] / "Homunculus" / "wiki"


# --- the five functions as they were before the table (rules/news2.py at b6ed65d) ---------------

def _old_resp(rr):
    if rr <= 8:
        return 3
    if rr <= 11:
        return 1
    if rr <= 20:
        return 0
    if rr <= 24:
        return 2
    return 3


def _old_spo2(spo2):
    if spo2 <= 91:
        return 3
    if spo2 <= 93:
        return 2
    if spo2 <= 95:
        return 1
    return 0


def _old_sbp(sbp):
    if sbp <= 90:
        return 3
    if sbp <= 100:
        return 2
    if sbp <= 110:
        return 1
    if sbp <= 219:
        return 0
    return 3


def _old_pulse(hr):
    if hr <= 40:
        return 3
    if hr <= 50:
        return 1
    if hr <= 90:
        return 0
    if hr <= 110:
        return 1
    if hr <= 130:
        return 2
    return 3


def _old_temp(temp):
    if temp <= 35.0:
        return 3
    if temp <= 36.0:
        return 1
    if temp <= 38.0:
        return 0
    if temp <= 39.0:
        return 1
    return 2


# parameter, the function under test, its reference, and the range a dense grid covers
CASES = [
    ("respiration_rate", news2.resp_rate_points, _old_resp, (0, 60)),
    ("spo2", news2.spo2_scale1_points, _old_spo2, (50, 100)),
    ("systolic_bp", news2.systolic_bp_points, _old_sbp, (40, 300)),
    ("pulse", news2.pulse_points, _old_pulse, (0, 250)),
    ("temperature", news2.temperature_points, _old_temp, (30, 45)),
]
IDS = [name for name, *_ in CASES]


def test_the_table_holds_the_five_scored_vitals_and_scale_1_only():
    assert set(NEWS2_BANDS) == {"respiration_rate", "spo2", "systolic_bp", "pulse", "temperature"}
    assert set(NEWS2_BANDS) == set(news2._CORE_VITALS)
    # Scale 2 is deliberately not implemented (module docstring): no row of it may appear here.
    assert not [name for name in NEWS2_BANDS if "scale2" in name or "scale_2" in name]


@pytest.mark.parametrize("parameter", IDS)
def test_the_rows_tile_the_line_with_no_gap_and_no_overlap(parameter):
    rows = NEWS2_BANDS[parameter]
    assert rows[0].low is None and rows[-1].high is None
    for before, after in zip(rows, rows[1:]):
        assert after.low == before.high, (before, after)
    highs = [row.high for row in rows[:-1]]
    assert highs == sorted(highs) and len(set(highs)) == len(highs)


@pytest.mark.parametrize(("parameter", "fn", "reference", "span"), CASES, ids=IDS)
def test_every_value_scores_what_the_if_chain_scored(parameter, fn, reference, span):
    lo, hi = span
    grid = [i / 20 for i in range(lo * 20, hi * 20 + 1)]
    edges = [row.high for row in NEWS2_BANDS[parameter] if row.high is not None]
    around = [edge + d for edge in edges for d in (-1e-9, 0.0, 1e-9)]
    for value in grid + around + [-math.inf, math.inf]:
        assert fn(value) == reference(value), (parameter, value)
    # NaN satisfies no comparison: the if-chains fell through to their last line, and so must the
    # table, or a NaN reading would score differently after this change than before it.
    assert fn(math.nan) == reference(math.nan)


def test_the_functions_read_the_table(monkeypatch):
    monkeypatch.setitem(NEWS2_BANDS, "pulse", (Band(None, 200, 2), Band(200, None, 3)))
    assert news2.pulse_points(100) == 2
    assert news2.pulse_points(201) == 3


def test_the_source_is_the_vault_note():
    assert BANDS_SOURCE == "news2-rcp-2017"
    assert (VAULT / "sources" / "news2-rcp-2017.md").is_file()


def test_a_band_is_served_with_its_open_side_as_none():
    assert Band(None, 40, 3).as_dict() == {"low": None, "high": 40, "points": 3}
    assert NEWS2_BANDS["pulse"][-1].as_dict() == {"low": 130, "high": None, "points": 3}
```

- [ ] **Step 2: Run it — red.**

```bash
cd /c/tmp/g2-vital/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_news2_bands.py 2>&1 | grep -E "Error|error"
```
Expected: `E   ImportError: cannot import name 'BANDS_SOURCE' from 'homunculus.rules.news2' (…\rules\news2.py)` and `1 error in …`.

- [ ] **Step 3: The table.** Edit `homunculus-engine/src/homunculus/rules/news2.py` — replace this block (it is the whole of lines 23–84):

```python
def resp_rate_points(rr: float) -> int:
    if rr <= 8:
        return 3
    if rr <= 11:
        return 1
    if rr <= 20:
        return 0
    if rr <= 24:
        return 2
    return 3


def spo2_scale1_points(spo2: float) -> int:
    if spo2 <= 91:
        return 3
    if spo2 <= 93:
        return 2
    if spo2 <= 95:
        return 1
    return 0


def air_or_oxygen_points(*, on_oxygen: bool) -> int:
    return 2 if on_oxygen else 0


def systolic_bp_points(sbp: float) -> int:
    if sbp <= 90:
        return 3
    if sbp <= 100:
        return 2
    if sbp <= 110:
        return 1
    if sbp <= 219:
        return 0
    return 3


def pulse_points(hr: float) -> int:
    if hr <= 40:
        return 3
    if hr <= 50:
        return 1
    if hr <= 90:
        return 0
    if hr <= 110:
        return 1
    if hr <= 130:
        return 2
    return 3


def temperature_points(temp: float) -> int:
    if temp <= 35.0:
        return 3
    if temp <= 36.0:
        return 1
    if temp <= 38.0:
        return 0
    if temp <= 39.0:
        return 1
    return 2
```

with:

```python
#: The vault source note every row below is read from (Homunculus/wiki/sources/news2-rcp-2017.md).
#: Served with the rows by the trends endpoint, so a chart's legend names it.
BANDS_SOURCE = "news2-rcp-2017"


@dataclass(frozen=True)
class Band:
    """One row of a NEWS2 parameter's chart: a value with `low < value <= high` scores `points`.

    `None` is an open side. The vault writes the chart in whole numbers (41–50 → 1), but the engine
    scores real numbers, and whole-number rows leave 40 < value < 41 belonging to none of them. So
    each row's lower edge is the previous row's upper edge, exclusive: the rows tile the line with
    no gap and no overlap, and every boundary sits where the if-chains these replaced had it.
    """
    low: float | None
    high: float | None
    points: int

    def as_dict(self) -> dict:
        return {"low": self.low, "high": self.high, "points": self.points}


# The five scored vitals, Scale 1 only, as Homunculus/wiki/concepts/news2.md gives them. ONE source:
# the *_points functions below look a value up here, and the trends endpoint (api/trends.py) serves
# these same rows to the screen that draws them as bands — so a band on a chart and a point in the
# score cannot disagree. Keyed by the names `score()` puts in its breakdown.
NEWS2_BANDS: dict[str, tuple[Band, ...]] = {
    "respiration_rate": (Band(None, 8, 3), Band(8, 11, 1), Band(11, 20, 0), Band(20, 24, 2),
                         Band(24, None, 3)),
    "spo2": (Band(None, 91, 3), Band(91, 93, 2), Band(93, 95, 1), Band(95, None, 0)),
    "systolic_bp": (Band(None, 90, 3), Band(90, 100, 2), Band(100, 110, 1), Band(110, 219, 0),
                    Band(219, None, 3)),
    "pulse": (Band(None, 40, 3), Band(40, 50, 1), Band(50, 90, 0), Band(90, 110, 1),
              Band(110, 130, 2), Band(130, None, 3)),
    "temperature": (Band(None, 35.0, 3), Band(35.0, 36.0, 1), Band(36.0, 38.0, 0),
                    Band(38.0, 39.0, 1), Band(39.0, None, 2)),
}


def points_for(parameter: str, value: float) -> int:
    """The points `value` scores for one of the five vitals, read from NEWS2_BANDS.

    Walked exactly as the if-chains it replaced were walked: the first row whose upper edge the
    value does not exceed, else the last, open row. A value no comparison holds for (NaN) therefore
    still lands where it always landed, so this rewrite moves no score at all
    (tests/test_news2_bands.py holds the old chains as the reference).
    """
    rows = NEWS2_BANDS[parameter]
    for band in rows[:-1]:
        if value <= band.high:
            return band.points
    return rows[-1].points


def resp_rate_points(rr: float) -> int:
    return points_for("respiration_rate", rr)


def spo2_scale1_points(spo2: float) -> int:
    return points_for("spo2", spo2)


def air_or_oxygen_points(*, on_oxygen: bool) -> int:
    return 2 if on_oxygen else 0


def systolic_bp_points(sbp: float) -> int:
    return points_for("systolic_bp", sbp)


def pulse_points(hr: float) -> int:
    return points_for("pulse", hr)


def temperature_points(temp: float) -> int:
    return points_for("temperature", temp)
```

(`dataclass` is already imported at the top of the module.)

- [ ] **Step 4: Run it and its neighbours — green.**

```bash
cd /c/tmp/g2-vital/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_news2_bands.py tests/rules/test_news2.py tests/test_api_board_news2.py tests/test_scenario_news2.py tests/rules/test_patient_relative.py tests/test_pipeline.py 2>&1 | tail -1
```
Expected: `126 passed` — `test_news2_bands.py` 14 and the unchanged 65 + 11 + 23 + 7 + 6.

- [ ] **Step 5: Commit.**

```bash
cd /c/tmp/g2-vital
git add homunculus-engine/src/homunculus/rules/news2.py homunculus-engine/tests/test_news2_bands.py
git status --short && git diff --cached --stat
git commit -m "feat(engine): NEWS2's five scored vitals as one table (NEWS2_BANDS), read by the score" -m "The *_points functions look a value up in NEWS2_BANDS (rows low < v <= high, None open, Scale 1, source news2-rcp-2017), so the trends endpoint can serve the same rows as bands. No score moves: the old if-chains are the test's reference on a dense grid, every edge +/- 1e-9, the infinities and NaN.

red: 1 error — ImportError: cannot import name 'BANDS_SOURCE'" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `thin()` — at most N readings of a series, keeping its shape

Spec D8 and §5.2. Pure, over `[Observation]` in time order. At or below the cap it is the series itself (a copy). Above it, the series' span is cut into `max_points // 4` equal slices and each keeps its first, last, lowest and highest reading, in order — the lowest because the reading a clinician must not lose is the worst one. Today's spot-check data never reaches the cap; Stage B's 5 s data would be 51 840 readings per 72 h.

**Files:**
- Create: `homunculus-engine/tests/test_timeline_thin.py`
- Modify: `homunculus-engine/src/homunculus/state/timeline.py` (append after `sum_since`, the end of the file)

- [ ] **Step 1: Write the failing test** — Write `homunculus-engine/tests/test_timeline_thin.py`:

```python
"""`thin()`: at most N readings of a series, keeping its shape, for a chart and never for a rule.

Today's spot-check data never reaches the cap, and below it the series must come back untouched.
Stage B's 5-second data would be 51 840 readings per channel over 72 hours; thinned, each of
`max_points // 4` equal slices of the series' span keeps its first, last, lowest and highest
reading — the lowest because the reading a clinician must not lose is the worst one.
"""
from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone

import pytest

from homunculus.canonical import Observation, SignalCode
from homunculus.state.timeline import thin

T0 = datetime(2026, 10, 19, 9, 0, tzinfo=timezone.utc)


def _obs(seconds: float, value: float) -> Observation:
    return Observation("S-001", SignalCode.SPO2, value, "%", T0 + timedelta(seconds=seconds), "test")


def _slices(series: list[Observation], buckets: int) -> list[list[Observation]]:
    """The series cut into `buckets` equal slices of its time span, as the docstring defines them."""
    t0 = series[0].timestamp
    span = (series[-1].timestamp - t0).total_seconds()
    out: list[list[Observation]] = [[] for _ in range(buckets)]
    for obs in series:
        at = 0 if span <= 0 else min(buckets - 1,
                                     int((obs.timestamp - t0).total_seconds() / span * buckets))
        out[at].append(obs)
    return [part for part in out if part]


def test_at_or_below_the_cap_the_series_comes_back_whole():
    series = [_obs(i * 60, 96 + i % 3) for i in range(2000)]
    kept = thin(series, 2000)
    assert kept == series
    assert kept is not series                 # a copy: the caller may not mutate the state's list


def test_an_empty_series_stays_empty():
    assert thin([], 2000) == []


def test_a_cap_below_four_is_refused():
    with pytest.raises(ValueError, match="at least 4"):
        thin([_obs(0, 96)], 3)


@pytest.mark.parametrize("seed", range(10))
def test_a_long_series_keeps_its_shape(seed):
    rng = random.Random(seed)
    n = rng.randint(2001, 6000)
    seconds = sorted(rng.uniform(0, 72 * 3600) for _ in range(n))
    if seed % 2:                              # repeated instants happen (two channels, one message)
        seconds = sorted(seconds + seconds[: n // 10])
    series = [_obs(s, round(rng.uniform(80, 100), 1)) for s in seconds]

    kept = thin(series, 2000)

    assert len(kept) <= 2000
    # A subsequence of the series, in its order: no reading invented, none moved.
    positions = [next(i for i, o in enumerate(series) if o is k) for k in kept]
    assert positions == sorted(positions) and len(set(positions)) == len(positions)
    assert kept[0] is series[0] and kept[-1] is series[-1]
    held = {id(o) for o in kept}
    for part in _slices(series, 2000 // 4):
        assert id(part[0]) in held and id(part[-1]) in held
        assert min(o.value for o in part) in {o.value for o in part if id(o) in held}
        assert max(o.value for o in part) in {o.value for o in part if id(o) in held}


def test_a_desaturation_survives_three_days_of_five_second_data():
    """Acceptance 2 (spec §12): a synthetic 5 s series thins to at most 2 000 points — and the one
    reading that matters is still there."""
    series = [_obs(i * 5, 96.0) for i in range(72 * 3600 // 5)]
    assert len(series) == 51_840
    series[30_000] = _obs(30_000 * 5, 85.0)

    kept = thin(series, 2000)

    assert len(kept) <= 2000
    assert 85.0 in [o.value for o in kept]


def test_readings_that_share_one_instant_fall_in_one_slice():
    series = [_obs(0, 90 + i % 7) for i in range(3000)]
    kept = thin(series, 2000)
    assert len(kept) <= 4
    assert {o.value for o in kept} >= {90, 96}
```

- [ ] **Step 2: Run it — red.**

```bash
cd /c/tmp/g2-vital/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_timeline_thin.py 2>&1 | grep -E "Error"
```
Expected: `E   ImportError: cannot import name 'thin' from 'homunculus.state.timeline' (…\state\timeline.py)`.

- [ ] **Step 3: `thin()`.** Edit `homunculus-engine/src/homunculus/state/timeline.py` — replace:

```python
    def sum_since(self, code: SignalCode, since: datetime) -> float:
        return sum(o.value for o in self._history.get(code, []) if o.timestamp >= since)
```

with:

```python
    def sum_since(self, code: SignalCode, since: datetime) -> float:
        return sum(o.value for o in self._history.get(code, []) if o.timestamp >= since)


def thin(series: list[Observation], max_points: int) -> list[Observation]:
    """At most `max_points` readings of `series` (oldest first), keeping its shape: the series' time
    span is cut into `max_points // 4` equal slices, and each keeps its first, last, lowest and
    highest reading, in their order.

    For a chart, never for a rule: a thinned series has lost readings by construction, and no score
    may be computed from one. At or below the cap it is the series itself (a copy), so the spot-check
    data the wards send today is never touched. The extremes are what is kept because the reading a
    clinician must not lose is the worst one — an average would draw a desaturation to 85 % as a
    dip that never left the 90s.
    """
    if max_points < 4:
        raise ValueError("max_points must be at least 4: each slice keeps up to four readings")
    if len(series) <= max_points:
        return list(series)
    buckets = max_points // 4
    t0 = series[0].timestamp
    span = (series[-1].timestamp - t0).total_seconds()
    slices: dict[int, list[int]] = {}
    for index, obs in enumerate(series):
        at = 0 if span <= 0 else min(buckets - 1,
                                     int((obs.timestamp - t0).total_seconds() / span * buckets))
        slices.setdefault(at, []).append(index)
    keep: set[int] = set()
    for members in slices.values():
        lowest = min(members, key=lambda i: series[i].value)
        highest = max(members, key=lambda i: series[i].value)
        keep.update((members[0], members[-1], lowest, highest))
    return [series[i] for i in sorted(keep)]
```

- [ ] **Step 4: Green.**

```bash
cd /c/tmp/g2-vital/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_timeline_thin.py tests/test_state_timeline.py 2>&1 | tail -1
```
Expected: `23 passed` — 15 new, `test_state_timeline.py` 8 unchanged.

- [ ] **Step 5: Commit.**

```bash
cd /c/tmp/g2-vital
git add homunculus-engine/src/homunculus/state/timeline.py homunculus-engine/tests/test_timeline_thin.py
git status --short && git diff --cached --stat
git commit -m "feat(engine): thin() keeps a long series' shape for a chart — first, last, lowest, highest per slice" -m "At or below the cap the series itself (a copy); above it max_points // 4 equal slices of its span. A 72 h, 5 s series (51 840 readings) thins to <= 2000 and keeps its one desaturation.

red: ImportError: cannot import name 'thin'" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `records(…, since=)` on the protocol, in memory, SQLite and Postgres

Spec §5.3. A `ts >= since` clause; the `/audit` route does not change (only the trends endpoint passes `since`). `ts` is TEXT in both databases (migration 0004 `ts TEXT NOT NULL`), so the comparison must order **instants**: a bound in any zone means the same instant, and a row stamped on a whole second (`isoformat()` writes `…09:00:00+00:00`, no fraction) must still sort before `…09:00:00.500000+00:00`. SQLite compares TEXT byte by byte, which is right here because every `ts` is `_now_iso()` and the bound is formatted the same way ("+" sorts before "."); Postgres compares TEXT by its collation, so it casts both sides to `timestamptz`. A bound with no zone is refused, in all three.

**Files:**
- Create: `homunculus-engine/tests/test_audit_since.py`
- Modify: `homunculus-engine/src/homunculus/api/audit.py`, `homunculus-engine/src/homunculus/api/audit_postgres.py`

- [ ] **Step 1: Write the failing test** — Write `homunculus-engine/tests/test_audit_since.py`:

```python
"""`records(…, since=)`: the audit read from an instant on, in every implementation.

The trends endpoint reads one patient's alarm episodes for a window. Without `since` every read is
the OLDEST N rows (`ORDER BY id ASC LIMIT n`), which on a busy pilot is the wrong end of the log; with
it the window is asked for directly. `ts` is stored as text, so the comparison must order instants,
not strings: the bound may come in any time zone, and a row stamped on a whole second
("…09:00:00+00:00") has no fraction at all where its neighbours have six digits.
"""
from __future__ import annotations

import inspect
import time
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from homunculus.api.audit import AuditEvent, AuditLog, InMemoryAuditLog, SqliteAuditLog
from homunculus.api.audit_postgres import PostgresAuditLog
from tests.conftest import TEST_DATABASE_URL, requires_db
from tests.test_audit_postgres import _load_migration

BAKU = timezone(timedelta(hours=4))
# Three rows a second apart, the first on a whole second: isoformat() writes it with no fraction.
CRAFTED = ["2026-10-19T09:00:00+00:00", "2026-10-19T09:00:00.500000+00:00",
           "2026-10-19T09:00:01+00:00"]


def _event(**over) -> AuditEvent:
    base = dict(tenant="HOSP1", event_type="first_seen", patient_id="S-001", subject="news2",
                payload={"at": "2026-10-19T09:00:00+00:00"})
    return AuditEvent(**{**base, **over})


def _two(log):
    """Two appends with a clear instant between them; returns their records."""
    first = log.append(_event())
    time.sleep(0.01)
    second = log.append(_event(subject="septic_shock"))
    return first, second


# --- the contract -------------------------------------------------------------------------------

@pytest.mark.parametrize("cls", [AuditLog, InMemoryAuditLog, SqliteAuditLog, PostgresAuditLog],
                         ids=lambda c: c.__name__)
def test_every_audit_log_takes_since_as_a_keyword(cls):
    param = inspect.signature(cls.records).parameters["since"]
    assert param.kind is inspect.Parameter.KEYWORD_ONLY and param.default is None


# --- in memory and SQLite -----------------------------------------------------------------------

@pytest.fixture(params=["memory", "sqlite"])
def log(request):
    return InMemoryAuditLog() if request.param == "memory" else SqliteAuditLog(":memory:")


def test_since_keeps_the_rows_at_or_after_it(log):
    first, second = _two(log)
    assert [r.id for r in log.records(since=datetime.fromisoformat(second.ts))] == [second.id]
    # Inclusive: the row stamped exactly at the bound is in.
    assert [r.id for r in log.records(since=datetime.fromisoformat(first.ts))] == [first.id, second.id]
    assert [r.id for r in log.records()] == [first.id, second.id]


def test_since_in_another_zone_is_the_same_instant(log):
    _first, second = _two(log)
    baku = datetime.fromisoformat(second.ts).astimezone(BAKU)
    assert [r.id for r in log.records(since=baku)] == [second.id]


def test_since_combines_with_the_other_filters(log):
    _first, second = _two(log)
    log.append(_event(patient_id="S-002"))
    log.append(_event(event_type="alert"))
    log.append(_event(tenant="HOSP2"))
    since = datetime.fromisoformat(second.ts)
    rows = log.records(tenant="HOSP1", patient_id="S-001", event_type="first_seen", since=since)
    assert [r.id for r in rows] == [second.id]


def test_a_since_without_a_zone_is_refused(log):
    log.append(_event())
    with pytest.raises(ValueError, match="time zone"):
        log.records(since=datetime(2026, 10, 19, 9, 0))


def test_sqlite_orders_a_whole_second_against_its_fractions():
    log = SqliteAuditLog(":memory:")
    for ts in CRAFTED:      # unsealed rows (hash ''), as a log written before the chain would hold
        log.connection.execute(
            "INSERT INTO audit (ts, tenant, event_type, patient_id, subject, payload)"
            " VALUES (?, 'HOSP1', 'first_seen', 'S-001', 'news2', '{}')", (ts,))
    log.connection.commit()
    half = datetime(2026, 10, 19, 9, 0, 0, 500000, tzinfo=timezone.utc)
    assert [r.ts for r in log.records(since=half)] == CRAFTED[1:]
    assert [r.ts for r in log.records(since=datetime(2026, 10, 19, 9, 0, tzinfo=timezone.utc))] == CRAFTED


# --- Postgres -----------------------------------------------------------------------------------

@pytest.fixture
def pg_log():
    log = PostgresAuditLog(TEST_DATABASE_URL)
    with log._engine.begin() as conn:                      # noqa: SLF001 — test setup
        conn.execute(text("DROP TABLE IF EXISTS audit CASCADE"))
        from alembic.migration import MigrationContext
        from alembic.operations import Operations
        for revision in ("0004", "0008"):
            migration, _ = _load_migration(revision)
            with Operations.context(MigrationContext.configure(conn)):
                migration.upgrade()
    yield log
    with log._engine.begin() as conn:                      # noqa: SLF001
        conn.execute(text("DROP TABLE IF EXISTS audit CASCADE"))
    log.dispose()


@requires_db
def test_postgres_keeps_the_rows_at_or_after_since(pg_log):
    first, second = _two(pg_log)
    assert [r.id for r in pg_log.records(since=datetime.fromisoformat(second.ts))] == [second.id]
    assert [r.id for r in pg_log.records(since=datetime.fromisoformat(first.ts))] == [first.id, second.id]
    baku = datetime.fromisoformat(second.ts).astimezone(BAKU)
    assert [r.id for r in pg_log.records(since=baku)] == [second.id]


@requires_db
def test_postgres_combines_since_with_the_other_filters(pg_log):
    _first, second = _two(pg_log)
    pg_log.append(_event(patient_id="S-002"))
    pg_log.append(_event(event_type="alert"))
    since = datetime.fromisoformat(second.ts)
    rows = pg_log.records(tenant="HOSP1", patient_id="S-001", event_type="first_seen", since=since)
    assert [r.id for r in rows] == [second.id]


@requires_db
def test_postgres_orders_instants_not_text(pg_log):
    with pg_log._engine.begin() as conn:                   # noqa: SLF001
        for ts in CRAFTED:
            conn.execute(text("INSERT INTO audit (ts, tenant, event_type, patient_id, subject, payload)"
                              " VALUES (:ts, 'HOSP1', 'first_seen', 'S-001', 'news2', '{}'::jsonb)"),
                         {"ts": ts})
    half = datetime(2026, 10, 19, 9, 0, 0, 500000, tzinfo=timezone.utc)
    assert [r.ts for r in pg_log.records(since=half)] == CRAFTED[1:]
    assert [r.ts for r in pg_log.records(since=half.astimezone(BAKU))] == CRAFTED[1:]


@requires_db
def test_postgres_refuses_a_since_without_a_zone(pg_log):
    with pytest.raises(ValueError, match="time zone"):
        pg_log.records(since=datetime(2026, 10, 19, 9, 0))
```

(`tests.test_audit_postgres._load_migration` is that file's own helper; importing it reuses the migration loader rather than copying it. The Postgres fixture is that file's `audit_log`, renamed so the two files do not shadow each other.)

- [ ] **Step 2: Run it — red.** Start the test database first (ground rules), then:

```bash
cd /c/tmp/g2-vital/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:55432/homunculus_test_g2v PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_audit_since.py 2>&1 | grep -E "^E |failed" | sort | uniq -c
```
Expected: `17 failed` — `TypeError: InMemoryAuditLog.records() got an unexpected keyword argument 'since'` (and the same for `SqliteAuditLog`, and Postgres' `PostgresAuditLog.records()`), and `KeyError: 'since'` from the four signature cases. Without the database: `13 failed, 4 skipped`.

- [ ] **Step 3: The contract and the two in-process logs.** Three Edits in `homunculus-engine/src/homunculus/api/audit.py`.

(a) Replace:

```python
def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _matches(rec: AuditRecord, tenant, patient_id, event_type) -> bool:
    return ((tenant is None or rec.tenant == tenant)
            and (patient_id is None or rec.patient_id == patient_id)
            and (event_type is None or rec.event_type == event_type))


class AuditLog(Protocol):
    def append(self, event: AuditEvent) -> AuditRecord: ...
    def records(self, *, tenant: str | None = None, patient_id: str | None = None,
                event_type: str | None = None, limit: int = 200) -> list[AuditRecord]: ...
```

with:

```python
def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def since_utc(since: datetime | None) -> datetime | None:
    """The lower bound of a `records(since=…)` read, in UTC, or None.

    Refused without a zone: every row's `ts` is UTC (`_now_iso`), and a zone-less bound would move
    the window by the server's own offset — the NCE server's local clock ran an hour off the UTC
    stamps in its own filenames, and that is the mistake this refuses to make silently.
    """
    if since is None:
        return None
    if since.tzinfo is None or since.utcoffset() is None:
        raise ValueError("since must carry a time zone")
    return since.astimezone(timezone.utc)


def _matches(rec: AuditRecord, tenant, patient_id, event_type, since=None) -> bool:
    return ((tenant is None or rec.tenant == tenant)
            and (patient_id is None or rec.patient_id == patient_id)
            and (event_type is None or rec.event_type == event_type)
            and (since is None or datetime.fromisoformat(rec.ts) >= since))


class AuditLog(Protocol):
    def append(self, event: AuditEvent) -> AuditRecord: ...
    # `since` (zone-aware) keeps the rows written at or after it. Without it a read is the OLDEST
    # `limit` rows — the right end for a replay, the wrong one for "what happened in this window".
    def records(self, *, tenant: str | None = None, patient_id: str | None = None,
                event_type: str | None = None, since: datetime | None = None,
                limit: int = 200) -> list[AuditRecord]: ...
```

(b) Replace (in `InMemoryAuditLog`):

```python
    def records(self, *, tenant=None, patient_id=None, event_type=None, limit=200):
        hits = [r for r in self._rows if _matches(r, tenant, patient_id, event_type)]
        return hits[:limit]
```

with:

```python
    def records(self, *, tenant=None, patient_id=None, event_type=None, since=None, limit=200):
        bound = since_utc(since)
        hits = [r for r in self._rows if _matches(r, tenant, patient_id, event_type, bound)]
        return hits[:limit]
```

(c) Replace (in `SqliteAuditLog`):

```python
    def records(self, *, tenant=None, patient_id=None, event_type=None, limit=200):
        clauses, params = [], []
        for col, val in (("tenant", tenant), ("patient_id", patient_id), ("event_type", event_type)):
            if val is not None:
                clauses.append(f"{col} = ?")
                params.append(val)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
```

with:

```python
    def records(self, *, tenant=None, patient_id=None, event_type=None, since=None, limit=200):
        clauses, params = [], []
        for col, val in (("tenant", tenant), ("patient_id", patient_id), ("event_type", event_type)):
            if val is not None:
                clauses.append(f"{col} = ?")
                params.append(val)
        bound = since_utc(since)
        if bound is not None:
            # Text against text, which orders instants here and only here: every `ts` is written by
            # `_now_iso` (UTC, "+00:00"), the bound is formatted the same way, and SQLite compares
            # TEXT byte by byte. A row on a whole second has no fraction ("…:00+00:00"), and "+"
            # sorts before ".", so it still comes before "…:00.000001+00:00" — as its instant does.
            clauses.append("ts >= ?")
            params.append(bound.isoformat())
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
```

- [ ] **Step 4: Postgres.** Two Edits in `homunculus-engine/src/homunculus/api/audit_postgres.py`.

(a) Replace:

```python
from homunculus.api.audit import GENESIS_HASH, AuditEvent, AuditRecord, chain_hash
```

with:

```python
from homunculus.api.audit import GENESIS_HASH, AuditEvent, AuditRecord, chain_hash, since_utc
```

(b) Replace:

```python
    def records(self, *, tenant: str | None = None, patient_id: str | None = None,
                event_type: str | None = None, limit: int = 200) -> list[AuditRecord]:
        clauses, params = [], {"limit": limit}
        for column, value in (("tenant", tenant), ("patient_id", patient_id),
                              ("event_type", event_type)):
            if value is not None:
                clauses.append(f"{column} = :{column}")
                params[column] = value
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
```

with:

```python
    def records(self, *, tenant: str | None = None, patient_id: str | None = None,
                event_type: str | None = None, since: datetime | None = None,
                limit: int = 200) -> list[AuditRecord]:
        clauses, params = [], {"limit": limit}
        for column, value in (("tenant", tenant), ("patient_id", patient_id),
                              ("event_type", event_type)):
            if value is not None:
                clauses.append(f"{column} = :{column}")
                params[column] = value
        bound = since_utc(since)
        if bound is not None:
            # `ts` is TEXT (migration 0004). Compared as text it would follow the database's
            # collation, which need not order "…:00+00:00" before "…:00.5+00:00"; cast, it is an
            # instant against an instant, whatever the collation and whatever zone the bound was in.
            clauses.append("CAST(ts AS timestamptz) >= CAST(:since AS timestamptz)")
            params["since"] = bound.isoformat()
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
```

(`datetime` is already imported in audit_postgres.py.)

- [ ] **Step 5: Green, with and without the database.**

```bash
cd /c/tmp/g2-vital/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:55432/homunculus_test_g2v PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_audit_since.py tests/test_audit_postgres.py tests/test_audit_memory.py tests/test_audit_sqlite.py tests/test_audit_chain.py tests/test_api_audit.py tests/test_rehydrate.py 2>&1 | tail -1
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_audit_since.py 2>&1 | tail -1
```
Expected: `69 passed` (17 + 11 + 4 + 5 + 21 + 5 + 6), then `13 passed, 4 skipped`.

- [ ] **Step 6: Commit.**

```bash
cd /c/tmp/g2-vital
git add homunculus-engine/src/homunculus/api/audit.py homunculus-engine/src/homunculus/api/audit_postgres.py homunculus-engine/tests/test_audit_since.py
git status --short && git diff --cached --stat
git commit -m "feat(engine): audit records(since=) in memory, SQLite and Postgres — instants, not text" -m "A zone-aware lower bound on ts (since_utc refuses a naive one). SQLite compares the isoformat text byte by byte (every ts is _now_iso); Postgres casts both sides to timestamptz, because TEXT follows the collation. /audit is unchanged; only the trends endpoint passes since.

red: 17 failed (13 + 4 skipped without the DB) — TypeError: ...records() got an unexpected keyword argument 'since'; KeyError: 'since'" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `api/trends.py` — the answer, built by the engine

Spec §4 and §5.4, with X1–X5 above. `patient_trends(engine, audit, *, hospital, patient_id, hours, now)` returns the response: the board's seven channels in its order, even empty; each reading as `[iso, value, the engine's NEWS2 points]`; `latest` with the delta over the whole history (rounded to 2 places), the breakdown's points and the own-normal verdict; `bands.news2` from `NEWS2_BANDS` on the five NEWS2 channels, `bands.own_normal` from the charted profile, `bands.device` reserved as `None`; thinning above `TRENDS_MAX_POINTS = 2000`; marks from `first_seen` audit rows and charted doses, in time order. It never creates a patient (an unmeasured id is read from an empty `PatientState`), writes nothing to the audit, and imports nothing of Aşama A.

**Files:**
- Create: `homunculus-engine/src/homunculus/api/trends.py`, `homunculus-engine/tests/test_trends.py`

- [ ] **Step 1: Write the failing test** — Write `homunculus-engine/tests/test_trends.py`:

```python
"""`patient_trends()`: everything a trend chart draws, decided by the engine.

The browser draws and never scores (spec §1, D1). So every fact a chart shows is built here and held
here: the series, how the latest value moved, its NEWS2 points, whether it sits inside the normal a
clinician charted, the NEWS2 rows as bands (the rules' own table, not a copy), and the moments an
alarm episode began or an antibiotic was charted. Synthetic patients only (`S-001`…).
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest

from homunculus.api.audit import AuditEvent, InMemoryAuditLog
from homunculus.api.board import _PUBLISHED_SIGNALS
from homunculus.api.trends import TRENDS_HOURS, TRENDS_MAX_POINTS, patient_trends
from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine
from homunculus.rules.news2 import NEWS2_BANDS, score as news2_score
from homunculus.state.profile import BaselineRange, PatientProfile

NOW = datetime(2026, 10, 19, 9, 0, tzinfo=timezone.utc)
HOSPITAL = "HOSP1"


def _at(minutes_ago: float) -> datetime:
    return NOW - timedelta(minutes=minutes_ago)


def _engine(*readings: tuple[SignalCode, float, float], patient: str = "S-001") -> Engine:
    """An engine fed `(code, value, minutes_ago)` readings, oldest first, as the bridge would."""
    engine = Engine()
    for code, value, minutes_ago in sorted(readings, key=lambda r: -r[2]):
        ts = _at(minutes_ago)
        engine.ingest(Observation(patient, code, value, "u", ts, "test"), now=ts)
    return engine


def _trends(engine: Engine, audit=None, *, hours: int = 24, patient: str = "S-001") -> dict:
    return patient_trends(engine, audit or InMemoryAuditLog(), hospital=HOSPITAL,
                          patient_id=patient, hours=hours, now=NOW)


def _channel(answer: dict, key: str) -> dict:
    return next(c for c in answer["channels"] if c["key"] == key)


# --- shape --------------------------------------------------------------------------------------

def test_every_published_channel_is_listed_in_the_boards_order_even_when_empty():
    answer = _trends(_engine((SignalCode.HEART_RATE, 84, 30)))
    assert [c["key"] for c in answer["channels"]] == list(_PUBLISHED_SIGNALS)
    assert [c["key"] for c in answer["channels"]] == [
        "heart_rate", "map", "sbp", "spo2", "temperature", "resp_rate", "lactate"]
    empty = _channel(answer, "lactate")
    assert empty["points"] == [] and empty["latest"] is None
    assert (empty["thinned"], empty["total_points"]) == (False, 0)


def test_the_window_and_the_bands_source_are_stated():
    answer = _trends(_engine((SignalCode.HEART_RATE, 84, 30)), hours=6)
    assert answer["patient_id"] == "S-001" and answer["hours"] == 6
    assert answer["since"] == (NOW - timedelta(hours=6)).isoformat()
    assert answer["until"] == NOW.isoformat() and answer["generated_at"] == NOW.isoformat()
    assert (answer["bands_source"], answer["news2_scale"]) == ("news2-rcp-2017", 1)
    json.dumps(answer)                         # nothing in it a JSON response cannot carry


# --- points -------------------------------------------------------------------------------------

def test_points_are_the_window_oldest_first_with_the_engines_points():
    engine = _engine((SignalCode.HEART_RATE, 80, 30 * 60), (SignalCode.HEART_RATE, 84, 120),
                     (SignalCode.HEART_RATE, 132, 60))
    hr = _channel(_trends(engine), "heart_rate")
    assert hr["points"] == [[_at(120).isoformat(), 84.0, 0], [_at(60).isoformat(), 132.0, 3]]
    assert (hr["thinned"], hr["total_points"]) == (False, 2)
    assert len(_channel(_trends(engine, hours=72), "heart_rate")["points"]) == 3


def test_map_and_lactate_points_carry_no_news2_points():
    engine = _engine((SignalCode.MAP, 58, 30), (SignalCode.LACTATE, 4.1, 20))
    answer = _trends(engine)
    assert _channel(answer, "map")["points"] == [[_at(30).isoformat(), 58.0, None]]
    assert _channel(answer, "lactate")["points"] == [[_at(20).isoformat(), 4.1, None]]


def test_a_channel_over_the_cap_is_thinned_and_says_so():
    engine = _engine(*[(SignalCode.SPO2, 96.0 if i != 1000 else 85.0, (2500 - i) * 0.5)
                       for i in range(2500)])
    spo2 = _channel(_trends(engine), "spo2")
    assert spo2["thinned"] is True and spo2["total_points"] == 2500
    assert len(spo2["points"]) <= TRENDS_MAX_POINTS
    assert 85.0 in [value for _ts, value, _points in spo2["points"]]
    assert spo2["latest"]["ts"] == _at(0.5).isoformat()


# --- latest -------------------------------------------------------------------------------------

def test_the_delta_spans_the_whole_history_not_the_window():
    engine = _engine((SignalCode.HEART_RATE, 80, 30 * 60), (SignalCode.HEART_RATE, 88, 60))
    hr = _channel(_trends(engine, hours=6), "heart_rate")
    assert len(hr["points"]) == 1                # the previous reading is outside the window …
    assert hr["latest"]["delta"] == 8.0          # … and is still the one the change is measured from


def test_one_measurement_has_no_delta():
    hr = _channel(_trends(_engine((SignalCode.HEART_RATE, 84, 30))), "heart_rate")
    assert hr["latest"] == {"ts": _at(30).isoformat(), "value": 84.0, "delta": None,
                            "news2_points": 0, "within_own_normal": None}


def test_the_delta_is_the_clinicians_number_not_floating_point_noise():
    engine = _engine((SignalCode.TEMPERATURE, 36.9, 120), (SignalCode.TEMPERATURE, 37.2, 60))
    assert _channel(_trends(engine), "temperature")["latest"]["delta"] == 0.3


def test_news2_points_are_the_engines_score_and_none_for_map_and_lactate():
    engine = _engine((SignalCode.HEART_RATE, 132, 10), (SignalCode.RESP_RATE, 22, 10),
                     (SignalCode.SPO2, 95, 10), (SignalCode.SBP, 120, 10),
                     (SignalCode.TEMPERATURE, 38.5, 10), (SignalCode.MAP, 60, 10),
                     (SignalCode.LACTATE, 4.0, 10))
    answer = _trends(engine)
    breakdown = news2_score(engine.state("S-001")).breakdown
    for key, parameter in (("heart_rate", "pulse"), ("resp_rate", "respiration_rate"),
                           ("spo2", "spo2"), ("sbp", "systolic_bp"), ("temperature", "temperature")):
        assert _channel(answer, key)["latest"]["news2_points"] == breakdown[parameter], key
    assert [_channel(answer, k)["latest"]["news2_points"] for k in ("heart_rate", "resp_rate", "spo2")] == [3, 2, 1]
    assert _channel(answer, "map")["latest"]["news2_points"] is None
    assert _channel(answer, "lactate")["latest"]["news2_points"] is None


# --- bands --------------------------------------------------------------------------------------

def test_the_bands_are_the_rules_own_rows_and_only_on_the_news2_channels():
    answer = _trends(_engine((SignalCode.HEART_RATE, 84, 30)))
    for key, parameter in (("heart_rate", "pulse"), ("resp_rate", "respiration_rate"),
                           ("spo2", "spo2"), ("sbp", "systolic_bp"), ("temperature", "temperature")):
        assert _channel(answer, key)["bands"]["news2"] == [b.as_dict() for b in NEWS2_BANDS[parameter]]
    for key in ("map", "lactate"):
        assert _channel(answer, key)["bands"]["news2"] is None
    assert {c["bands"]["device"] for c in answer["channels"]} == {None}     # Stage B's, reserved


def test_the_heart_rate_bands_as_the_screen_receives_them():
    hr = _channel(_trends(_engine((SignalCode.HEART_RATE, 84, 30))), "heart_rate")
    assert hr["bands"]["news2"] == [
        {"low": None, "high": 40, "points": 3}, {"low": 40, "high": 50, "points": 1},
        {"low": 50, "high": 90, "points": 0}, {"low": 90, "high": 110, "points": 1},
        {"low": 110, "high": 130, "points": 2}, {"low": 130, "high": None, "points": 3},
    ]


def test_the_patients_own_normal_is_served_and_judged_by_the_engine():
    engine = _engine((SignalCode.HEART_RATE, 108, 30), (SignalCode.SPO2, 96, 30))
    engine.set_profile(PatientProfile("S-001", baselines={
        SignalCode.HEART_RATE: BaselineRange(100, 115)}))
    answer = _trends(engine)
    hr = _channel(answer, "heart_rate")
    assert hr["bands"]["own_normal"] == {"low": 100, "high": 115}
    assert hr["latest"]["within_own_normal"] is True
    assert _channel(answer, "spo2")["bands"]["own_normal"] is None
    assert _channel(answer, "spo2")["latest"]["within_own_normal"] is None

    engine.ingest(Observation("S-001", SignalCode.HEART_RATE, 121, "u", _at(5), "test"), now=_at(5))
    assert _channel(_trends(engine), "heart_rate")["latest"]["within_own_normal"] is False


# --- markers ------------------------------------------------------------------------------------

def _first_seen(audit, kind: str, minutes_ago: float, *, patient: str = "S-001",
                tenant: str = HOSPITAL, event_type: str = "first_seen") -> None:
    audit.append(AuditEvent(tenant, event_type, patient, kind, {"at": _at(minutes_ago).isoformat()}))


def test_alarm_markers_are_episode_starts_inside_the_window_only():
    audit = InMemoryAuditLog()
    _first_seen(audit, "news2", 60)                              # in
    _first_seen(audit, "septic_shock", 30 * 60)                  # before the window
    _first_seen(audit, "news2", 60, patient="S-002")             # another patient
    _first_seen(audit, "news2", 60, tenant="HOSP2")              # another hospital
    _first_seen(audit, "news2", 50, event_type="alert")          # a re-emission, not an episode
    answer = _trends(_engine((SignalCode.SPO2, 85, 60)), audit)
    assert answer["markers"] == [{"ts": _at(60).isoformat(), "kind": "alarm", "label": "news2"}]


def test_antibiotic_markers_are_charted_doses_inside_the_window():
    engine = _engine((SignalCode.ANTIBIOTIC_ADMINISTERED, 1.0, 120),
                     (SignalCode.ANTIBIOTIC_ADMINISTERED, 0.0, 60),       # charted "not given"
                     (SignalCode.ANTIBIOTIC_ADMINISTERED, 1.0, 30 * 60))  # before the window
    assert _trends(engine)["markers"] == [
        {"ts": _at(120).isoformat(), "kind": "antibiotic", "label": "antibiotic_administered"}]


def test_markers_are_in_time_order():
    audit = InMemoryAuditLog()
    _first_seen(audit, "news2", 30)
    engine = _engine((SignalCode.ANTIBIOTIC_ADMINISTERED, 1.0, 90), (SignalCode.SPO2, 85, 30))
    assert [m["kind"] for m in _trends(engine, audit)["markers"]] == ["antibiotic", "alarm"]


# --- what it refuses, and what it never does ----------------------------------------------------

def test_an_unmeasured_patient_is_read_without_being_created():
    engine = _engine((SignalCode.HEART_RATE, 84, 30))
    answer = _trends(engine, patient="S-009")
    assert {c["key"]: c["points"] for c in answer["channels"]} == {k: [] for k in _PUBLISHED_SIGNALS}
    assert "S-009" not in engine.patient_ids()


@pytest.mark.parametrize("hours", [0, 12, 48, 168])
def test_a_window_other_than_the_three_is_refused(hours):
    assert hours not in TRENDS_HOURS
    with pytest.raises(ValueError, match="hours"):
        _trends(_engine((SignalCode.HEART_RATE, 84, 30)), hours=hours)


def test_a_now_without_a_zone_is_refused():
    with pytest.raises(ValueError, match="time zone"):
        patient_trends(Engine(), InMemoryAuditLog(), hospital=HOSPITAL, patient_id="S-001",
                       hours=24, now=datetime(2026, 10, 19, 9, 0))
```

(The audit rows' `ts` is the real clock — `append` stamps it — while `NOW` is fixed; the builder reads with `since` and then keeps the marks whose own instant, `payload["at"]`, is inside the window, which is what the test pins.)

- [ ] **Step 2: Run it — red.**

```bash
cd /c/tmp/g2-vital/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_trends.py 2>&1 | grep -E "^E "
```
Expected: `E   ModuleNotFoundError: No module named 'homunculus.api.trends'`.

- [ ] **Step 3: The builder** — Write `homunculus-engine/src/homunculus/api/trends.py`:

```python
# src/homunculus/api/trends.py
"""One patient's vital history, as the trend charts draw it (GET /patients/{id}/trends).

The browser draws and never scores (spec D1). Everything a chart needs in order to be honest is
decided here, by the engine: the series, how the latest value moved since the previous one, its
NEWS2 points, whether it sits inside the normal a clinician charted for this patient, the NEWS2 rows
as bands, and the moments an alarm episode began or an antibiotic dose was charted. A threshold has
ONE home — `rules/news2.py` `NEWS2_BANDS` — and this module serves that table rather than restating
it, so a band on a chart and a point in the score cannot disagree.

What it deliberately does not do:
  * chart Aşama A's monitor values. That lane keeps no history, binds no patient and is unvalidated
    (spec D7); this module imports nothing of it (tests/test_infinity_shadow_isolation.py).
  * serve the device's own alarm limits. Stage B validates them; `bands.device` is reserved as None
    now so the response's shape does not change then (D9).
  * write an audit row. Opening the patient already wrote `view`; a chart read every minute would
    bury that record under its own.
  * create a patient. `Engine.state()` creates the id it is asked about; an id the engine has not
    measured is read from an empty state instead — the rule `_score_state` keeps for the score forms.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from homunculus.api.alarm_quality import _event_time
from homunculus.api.audit import AuditLog
from homunculus.api.board import _PUBLISHED_SIGNALS
from homunculus.canonical import SignalCode
from homunculus.pipeline import Engine
from homunculus.rules.news2 import BANDS_SOURCE, NEWS2_BANDS, points_for, score as news2_score
from homunculus.state.timeline import PatientState, thin

#: The windows the screen offers: 6 hours, 24 hours, 3 days. Any other is refused.
TRENDS_HOURS = (6, 24, 72)
#: Above this many readings in a window a channel is thinned (`state/timeline.py` `thin`), D8.
TRENDS_MAX_POINTS = 2000
#: The most alarm-episode rows read for one patient's window. One per alarm kind is the real count;
#: the bound is there so a runaway log cannot make one chart read it all.
TRENDS_MARKER_LIMIT = 1000

# The NEWS2 parameter each published channel is — the names `score()` puts in its breakdown and
# NEWS2_BANDS is keyed by. MAP and lactate are not NEWS2 parameters: no band, no points.
_NEWS2_PARAMETER = {
    "heart_rate": "pulse", "resp_rate": "respiration_rate", "spo2": "spo2",
    "sbp": "systolic_bp", "temperature": "temperature",
}

# The scale the rules read each channel's number on — what `api/clinical.py` CHARTABLE fixes for a
# charted value and what the NEWS2 rows are written in. Informational: the screen prints its own
# unit words (dashboard `vitals.js`).
_UNITS = {
    "heart_rate": "/min", "map": "mmHg", "sbp": "mmHg", "spo2": "%",
    "temperature": "°C", "resp_rate": "/min", "lactate": "mmol/L",
}


def _latest(state: PatientState, key: str, code: SignalCode, breakdown: dict[str, int],
            baseline) -> dict | None:
    history = state.history(code)
    if not history:
        return None
    last = history[-1]
    previous = history[-2] if len(history) > 1 else None
    parameter = _NEWS2_PARAMETER.get(key)
    return {
        "ts": last.timestamp.isoformat(),
        "value": last.value,
        # Over the whole history, not the window: "since the previous measurement" is a fact about
        # the patient, and a 6-hour window must not turn a change into "no previous one". Rounded,
        # because 37.2 − 36.9 is 0.30000000000000426 in binary and 0.3 at the bedside.
        "delta": None if previous is None else round(last.value - previous.value, 2),
        # The engine's own NEWS2 breakdown — the same number the board's score is built from.
        "news2_points": breakdown.get(parameter) if parameter is not None else None,
        # Judged here, against the range a clinician charted; None when nobody charted one.
        "within_own_normal": None if baseline is None else baseline.contains(last.value),
    }


def _markers(state: PatientState, audit: AuditLog, hospital: str, patient_id: str,
             since: datetime, until: datetime) -> list[dict]:
    """When an alarm episode began, and when an antibiotic dose was charted, in time order.

    An alarm is its `first_seen` row, not its `alert` rows: the engine re-emits an active alert on
    every reading, so the `alert` rows count how often the monitor sampled, not how often the ward
    was asked to look (`api/alarm_quality.py` makes the same choice for the same reason). Its instant
    is the escalation clock's own (`payload["at"]`, else the row's `ts`).
    """
    found: list[tuple[datetime, dict]] = []
    for rec in audit.records(tenant=hospital, patient_id=patient_id, event_type="first_seen",
                             since=since, limit=TRENDS_MARKER_LIMIT):
        at = _event_time(rec)
        if at is not None and since <= at <= until:
            found.append((at, {"ts": at.isoformat(), "kind": "alarm", "label": rec.subject}))
    for obs in state.window(SignalCode.ANTIBIOTIC_ADMINISTERED, since, until):
        # A charted 0 is "not given" (api/board.py `_meds`), never a dose on the time axis.
        if obs.value >= 1.0:
            found.append((obs.timestamp, {"ts": obs.timestamp.isoformat(), "kind": "antibiotic",
                                          "label": SignalCode.ANTIBIOTIC_ADMINISTERED.value}))
    found.sort(key=lambda pair: pair[0])
    return [marker for _at, marker in found]


def patient_trends(engine: Engine, audit: AuditLog, *, hospital: str, patient_id: str,
                   hours: int, now: datetime) -> dict:
    """The trends response for `patient_id` over the `hours` before `now` (spec §4)."""
    if hours not in TRENDS_HOURS:
        raise ValueError(f"hours must be one of {TRENDS_HOURS}, not {hours!r}")
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("now must carry a time zone")
    state = (engine.state(patient_id) if patient_id in set(engine.patient_ids())
             else PatientState(patient_id))
    profile = engine.profile(patient_id)
    breakdown = news2_score(state).breakdown
    since, until = now - timedelta(hours=hours), now

    channels = []
    for key, code in _PUBLISHED_SIGNALS.items():
        window = state.window(code, since, until)
        kept = thin(window, TRENDS_MAX_POINTS)
        parameter = _NEWS2_PARAMETER.get(key)
        baseline = profile.baselines.get(code) if profile is not None else None
        channels.append({
            "key": key,
            "unit": _UNITS[key],
            # [instant, value, the NEWS2 points that value scores] — the third so the table view
            # prints the engine's points for every reading instead of looking a band up itself.
            "points": [[o.timestamp.isoformat(), o.value,
                        points_for(parameter, o.value) if parameter is not None else None]
                       for o in kept],
            "thinned": len(window) > TRENDS_MAX_POINTS,
            "total_points": len(window),
            "latest": _latest(state, key, code, breakdown, baseline),
            "bands": {
                "news2": ([band.as_dict() for band in NEWS2_BANDS[parameter]]
                          if parameter is not None else None),
                "own_normal": (None if baseline is None
                               else {"low": baseline.low, "high": baseline.high}),
                "device": None,
            },
        })

    return {
        "patient_id": patient_id,
        "hours": hours,
        "since": since.isoformat(),
        "until": until.isoformat(),
        # The instant the window was cut at: the same as `until`, named for what it is.
        "generated_at": now.isoformat(),
        "bands_source": BANDS_SOURCE,
        "news2_scale": 1,
        "channels": channels,
        "markers": _markers(state, audit, hospital, patient_id, since, until),
    }
```

- [ ] **Step 4: Green.**

```bash
cd /c/tmp/g2-vital/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_trends.py tests/test_news2_bands.py tests/test_timeline_thin.py tests/test_audit_since.py 2>&1 | tail -1
```
Expected: `63 passed, 4 skipped` (21 + 14 + 15 + 13, the four Postgres cases skipped without the database).

- [ ] **Step 5: Commit.**

```bash
cd /c/tmp/g2-vital
git add homunculus-engine/src/homunculus/api/trends.py homunculus-engine/tests/test_trends.py
git status --short && git diff --cached --stat
git commit -m "feat(engine): api/trends.py builds the trend charts' answer — series, latest facts, bands, marks" -m "The board's seven channels in its order; each reading with the engine's NEWS2 points; latest delta over the whole history, the breakdown's points, the own-normal verdict; NEWS2_BANDS as bands on the five NEWS2 channels; thinning above 2000; alarm marks from first_seen (one per episode, not every re-emitted alert row), antibiotic marks from charted doses >= 1. Creates no patient, writes no audit row.

red: ModuleNotFoundError: No module named 'homunculus.api.trends'" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `GET /patients/{patient_id}/trends` — the door, and everything that lists doors

Spec §4 with X1 and X16. Order of checks: credential (401) → `board.view` (403, before the scope is asked) → `hours` ∈ {6, 24, 72} read as text (400 in the reader's words, never FastAPI's 422) → scope UNKNOWN (503, the stream ticket's own answer) → `_require_patient` (404, audited) → `_score_state` (404 for an id neither measured nor admitted; creates nothing) → the builder. No audit row for the read. The route needs a row in two registries (`test_board_permissions.py`, `test_tenant_isolation.py`), the isolation test gains the trends direction, and the dashboard's apiErrors.test.js — which reads every `detail="…"` literal of api/app.py — needs the new 400 translated in this same task.

**Files:**
- Create: `homunculus-engine/tests/test_trends_api.py`
- Modify: `homunculus-engine/src/homunculus/api/app.py`, `homunculus-engine/tests/test_infinity_shadow_isolation.py`, `homunculus-engine/tests/test_board_permissions.py`, `homunculus-engine/tests/test_tenant_isolation.py`, `dashboard/src/live/apiErrors.js`, `dashboard/src/live/i18n/strings/errors.js`

- [ ] **Step 1: Write the failing API test** — Write `homunculus-engine/tests/test_trends_api.py`:

```python
"""GET /patients/{id}/trends through HTTP: who may read it, what it answers, and what it never does.

`test_trends.py` fixes what the builder computes. These fix the door: the board's permission and the
board's scope check guard it, a window outside 6/24/72 is the caller's error in the reader's words,
a scope that cannot be read is 503 rather than "no such patient", an unknown id creates nothing, and
the read itself writes nothing to the audit. Synthetic ward only (`p-a1`…, units `unit-adult` /
`unit-nicu`), as tests/test_api_scope.py builds it.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.board import _PUBLISHED_SIGNALS
from homunculus.api.identity import Caller
from homunculus.api.patient_identity import IdentityRecord, InMemoryIdentityStore
from homunculus.auth.permissions import DEFAULT_GROUPS
from homunculus.scope import Scope, build_scope
from homunculus.scope.resolver import UNKNOWN
from homunculus.tenant.bedmap import BedMap

TOKEN = {"Authorization": "Bearer bridge-token"}
NURSE = {"Authorization": "Bearer nurse-jwt"}
NURSE_PERMS = frozenset(next(g["permissions"] for g in DEFAULT_GROUPS if g["slug"] == "nurse"))
ADULT = build_scope("NURSE", unit_ids=["unit-adult"])
WHOLE = build_scope("HOSPITAL_ADMIN")
BEDMAP = BedMap.from_dict({"beds": {
    "YB^304^1": {"bed_id": "bed-a1", "unit_id": "unit-adult"},
    "YB^304^2": {"bed_id": "bed-a2", "unit_id": "unit-adult"},
    "YYB^12^A": {"bed_id": "bed-n1", "unit_id": "unit-nicu"},
}})


def _identities() -> InMemoryIdentityStore:
    store = InMemoryIdentityStore()
    for pid, unit, room, bed in (("p-a1", "YB", "304", "1"), ("p-a2", "YB", "304", "2"),
                                 ("p-n1", "YYB", "12", "A")):
        store.apply("demo", IdentityRecord(patient_id=pid, given="X", family="Y", unit=unit,
                                           room=room, bed=bed, source="comed",
                                           updated_at=datetime(2026, 10, 19, tzinfo=timezone.utc)))
    return store


def _app(scope: Scope = WHOLE, perms: frozenset[str] = NURSE_PERMS):
    async def resolve_scope(_credential: str) -> Scope:
        return scope

    async def resolve_jwt(_credential: str) -> Caller:
        return Caller(hospital="demo", actor="nurse-1", groups=("nurse",), perms=perms)

    return create_app({"bridge-token": "demo"}, run_escalation_loop=False,
                      identities=_identities(), bedmap=BEDMAP,
                      resolve_jwt=resolve_jwt, resolve_scope=resolve_scope)


def _reading(client: TestClient, pid: str, code: str, value: float, minutes_ago: float = 10) -> None:
    """One reading through the bridge's credential, stamped relative to the real clock: the route
    cuts its window at the server's `now`."""
    at = datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)
    r = client.post("/ingest", headers=TOKEN, json={
        "resourceType": "Observation", "subject": {"reference": f"Patient/{pid}"},
        "effectiveDateTime": at.isoformat(), "code": {"coding": [{"code": code}]},
        "valueQuantity": {"value": value, "unit": "u"},
    })
    assert r.status_code == 200, r.text


def _rows(app, event_type: str | None = None) -> list:
    return [r for r in app.state.audit.records(tenant="demo", limit=10_000)
            if event_type is None or r.event_type == event_type]


def _channel(answer: dict, key: str) -> dict:
    return next(c for c in answer["channels"] if c["key"] == key)


@pytest.fixture
def ward():
    app = _app()
    with TestClient(app) as client:
        for pid in ("p-a1", "p-n1"):
            _reading(client, pid, "heart_rate", 84)
        yield app, client


class TestTheAnswer:
    def test_the_shape_and_the_channel_order(self, ward):
        _app, client = ward
        r = client.get("/patients/p-a1/trends", headers=TOKEN)
        assert r.status_code == 200, r.text
        answer = r.json()
        assert answer["hours"] == 24                                   # the default window
        assert [c["key"] for c in answer["channels"]] == list(_PUBLISHED_SIGNALS)
        assert (answer["bands_source"], answer["news2_scale"]) == ("news2-rcp-2017", 1)
        assert _channel(answer, "heart_rate")["latest"]["value"] == 84.0

    @pytest.mark.parametrize("hours", ["6", "24", "72"])
    def test_the_three_windows(self, ward, hours):
        _app, client = ward
        r = client.get(f"/patients/p-a1/trends?hours={hours}", headers=NURSE)
        assert (r.status_code, r.json()["hours"]) == (200, int(hours))

    def test_bands_only_on_the_news2_channels(self, ward):
        _app, client = ward
        answer = client.get("/patients/p-a1/trends", headers=NURSE).json()
        assert [c["key"] for c in answer["channels"] if c["bands"]["news2"] is None] == ["map", "lactate"]

    def test_a_charted_normal_becomes_the_band_and_the_engines_judgement(self, ward):
        _app, client = ward
        r = client.put("/clinical/p-a1/profile", headers=TOKEN,
                       json={"baselines": {"heart_rate": {"low": 80, "high": 90}}})
        assert r.status_code == 200, r.text
        hr = _channel(client.get("/patients/p-a1/trends", headers=NURSE).json(), "heart_rate")
        assert hr["bands"]["own_normal"] == {"low": 80.0, "high": 90.0}
        assert hr["latest"]["within_own_normal"] is True

    def test_an_alarm_episode_is_a_marker(self, ward):
        _app, client = ward
        _reading(client, "p-a1", "spo2", 85, minutes_ago=5)           # NEWS2 3 on one parameter
        markers = client.get("/patients/p-a1/trends", headers=NURSE).json()["markers"]
        assert {"kind": "alarm", "label": "news2"} in [{k: m[k] for k in ("kind", "label")} for m in markers]

    def test_a_charted_dose_is_a_marker(self, ward):
        _app, client = ward
        r = client.post("/clinical/p-a1", headers=TOKEN,
                        json={"entries": [{"code": "antibiotic_administered", "value": 1}]})
        assert r.status_code == 200, r.text
        markers = client.get("/patients/p-a1/trends", headers=NURSE).json()["markers"]
        assert [m["kind"] for m in markers] == ["antibiotic"]

    def test_the_read_writes_nothing_to_the_audit(self, ward):
        app, client = ward
        before = len(_rows(app))
        for _ in range(3):
            assert client.get("/patients/p-a1/trends", headers=NURSE).status_code == 200
        assert len(_rows(app)) == before


class TestTheDoor:
    @pytest.mark.parametrize("hours", ["12", "0", "abc", "6.0", "-24", ""])
    def test_any_other_window_is_the_callers_error(self, ward, hours):
        _app, client = ward
        r = client.get(f"/patients/p-a1/trends?hours={hours}", headers=NURSE)
        assert (r.status_code, r.json()["detail"]) == (400, "geçersiz hours: 6, 24 veya 72 olmalı")

    def test_no_credential_is_401(self, ward):
        _app, client = ward
        assert client.get("/patients/p-a1/trends").status_code == 401

    def test_without_board_view_it_is_403_before_the_scope_is_asked(self):
        app = _app(ADULT, perms=frozenset())
        with TestClient(app) as client:
            _reading(client, "p-a1", "heart_rate", 84)
            r = client.get("/patients/p-a1/trends", headers=NURSE)
        assert (r.status_code, r.json()["detail"]) == (403, "permission required: board.view")
        assert not _rows(app, "scope_denied")

    def test_out_of_scope_is_404_like_an_unknown_id_and_is_audited(self):
        app = _app(ADULT)
        with TestClient(app) as client:
            _reading(client, "p-n1", "heart_rate", 84)
            r = client.get("/patients/p-n1/trends", headers=NURSE)
        assert (r.status_code, r.json()["detail"]) == (404, "hasta bulunamadı")
        [row] = _rows(app, "scope_denied")
        assert (row.patient_id, row.payload["actor"]) == ("p-n1", "nurse-1")

    def test_an_unknown_id_is_404_and_creates_nothing(self, ward):
        _app, client = ward
        r = client.get("/patients/ghost-1/trends", headers=NURSE)
        assert (r.status_code, r.json()["detail"]) == (404, "hasta bulunamadı")
        board = client.get("/patients", headers=TOKEN).json()["patients"]
        assert "ghost-1" not in [p["patient_id"] for p in board]

    def test_an_unreadable_scope_is_503_not_a_missing_patient(self):
        app = _app(UNKNOWN)
        with TestClient(app) as client:
            _reading(client, "p-a1", "heart_rate", 84)
            refused = client.get("/patients/p-a1/trends", headers=NURSE)
            device = client.get("/patients/p-a1/trends", headers=TOKEN)
        assert (refused.status_code, refused.json()["detail"]) == (503, "kapsam şu anda okunamıyor")
        assert not _rows(app, "scope_denied")
        assert device.status_code == 200                               # the machine credential is unscoped

    def test_an_admitted_patient_with_no_reading_is_served_empty_and_stays_unmeasured(self, ward):
        _app, client = ward
        r = client.get("/patients/p-a2/trends", headers=NURSE)
        assert r.status_code == 200
        assert {c["key"]: c["points"] for c in r.json()["channels"]} == {k: [] for k in _PUBLISHED_SIGNALS}
        card = next(p for p in client.get("/patients", headers=TOKEN).json()["patients"]
                    if p["patient_id"] == "p-a2")
        assert card["latest"]["news2"] is None                          # still the identity-only card
```

- [ ] **Step 2: The isolation test and the two registries.** These are tests too; edit them now so they go red with the rest.

(a) `homunculus-engine/tests/test_infinity_shadow_isolation.py` — replace:

```python
def test_importing_the_lane_loads_nothing_clinical_even_indirectly():
```

with:

```python
def test_the_trend_charts_import_nothing_of_the_lane():
    """The other direction (spec §5.5, D7): the clinical trends charts no Aşama A value. Its
    readings keep no history, are bound to no patient and are unvalidated; a chart of them would
    put an unvalidated number on a clinical axis."""
    imported = _imports(PACKAGE / "api" / "trends.py")
    assert imported, "the scan went blind"
    lane = ("homunculus.api.infinity_shadow", "homunculus.api.infinity_device_beds",
            "homunculus.edge")
    assert not sorted(n for n in imported if any(n == m or n.startswith(m + ".") for m in lane))


def test_importing_the_lane_loads_nothing_clinical_even_indirectly():
```

(b) Same file — replace:

```python
    assert client.post("/ingest", json=observation, headers=_hdr(DEVICE)).status_code == 200
    assert {"ingest", "append", "publish"} <= set(calls)
```

with:

```python
    assert client.post("/ingest", json=observation, headers=_hdr(DEVICE)).status_code == 200
    assert {"ingest", "append", "publish"} <= set(calls)


def test_a_trends_read_never_reaches_the_shadow_store(tmp_path, monkeypatch):
    """The lane holds a heart rate of 180 for p1's bed; the clinical trends of p1 must not show it,
    and must not even ask the shadow store."""
    identities = InMemoryIdentityStore()
    identities.apply(HOSPITAL, IdentityRecord(patient_id="p1", unit="YB", room="1", bed="1", source="test"))
    client, clock = _app(tmp_path, identities=identities)
    assert client.post("/infinity-shadow/readings", json=_body(clock.t), headers=_hdr(SHADOW)).status_code == 200
    calls: list[str] = []
    store = client.app.state.shadow_store
    for name in ("devices", "feed"):
        original = getattr(store, name)
        monkeypatch.setattr(store, name, lambda *a, _n=name, _o=original, **k: (calls.append(_n), _o(*a, **k))[1])

    answer = client.get("/patients/p1/trends", headers=_hdr(DEVICE))

    assert answer.status_code == 200, answer.text
    assert all(channel["points"] == [] for channel in answer.json()["channels"])
    assert calls == []
```

(c) Same file — replace:

```python
    ("GET", "/patients", None),
    ("POST", "/stream-ticket", None),
```

with:

```python
    ("GET", "/patients", None),
    ("GET", "/patients/p1/trends", None),
    ("POST", "/stream-ticket", None),
```

(d) `homunculus-engine/tests/test_board_permissions.py` — replace:

```python
    ("GET", "/alarm-quality"): "audit.view",
    ("GET", "/audit/verify"): "audit.view",
    ("POST", "/infinity-shadow/readings"): SHADOW_TOKEN,
```

with:

```python
    ("GET", "/alarm-quality"): "audit.view",
    ("GET", "/audit/verify"): "audit.view",
    # Group 2's trend charts (api/trends.py), read with the board's own right.
    ("GET", "/patients/{patient_id}/trends"): "board.view",
    ("POST", "/infinity-shadow/readings"): SHADOW_TOKEN,
```

(e) `homunculus-engine/tests/test_tenant_isolation.py` — replace:

```python
    ("GET", "/alarm-quality"),
    ("GET", "/audit/verify"),
    # Aşama A's monitor strip (api/app.py). The GET goes through the Caller and answers only a
```

with:

```python
    ("GET", "/alarm-quality"),
    ("GET", "/audit/verify"),
    # Group 2's trend charts (api/trends.py): the board's Caller, board.view and _require_patient.
    ("GET", "/patients/{patient_id}/trends"),
    # Aşama A's monitor strip (api/app.py). The GET goes through the Caller and answers only a
```

- [ ] **Step 3: Run them — red.**

```bash
cd /c/tmp/g2-vital/homunculus-engine
for f in tests/test_trends_api.py tests/test_infinity_shadow_isolation.py tests/test_board_permissions.py tests/test_tenant_isolation.py; do echo -n "$f: "; PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q $f 2>&1 | tail -1; done
```
Expected (the route does not exist, so every call is FastAPI's own 404):
`test_trends_api.py: 21 failed` · `test_infinity_shadow_isolation.py: 2 failed, 16 passed` (`test_a_trends_read_never_reaches_the_shadow_store`, `test_the_shadow_token_opens_no_clinical_route[/patients/p1/trends]`; the import test passes already — trends.py exists since Task 4) · `test_board_permissions.py: 2 failed, 55 passed` (`test_the_table_names_every_board_route_and_only_those`, `test_a_jwt_without_permissions_gets_nothing_but_the_open_routes[GET /patients/{patient_id}/trends]`) · `test_tenant_isolation.py: 1 failed, 108 skipped`.

- [ ] **Step 4: The route.** Two Edits in `homunculus-engine/src/homunculus/api/app.py`.

(a) Replace:

```python
from homunculus.api.tickets import TicketStore
```

with:

```python
from homunculus.api.tickets import TicketStore
from homunculus.api.trends import TRENDS_HOURS, patient_trends
```

(b) Replace (the end of the `/patients` route):

```python
        return {"patients": result.boards,
                "scope": result.as_dict(),
                "scope_note": scope_report(result)}
```

with:

```python
        return {"patients": result.boards,
                "scope": result.as_dict(),
                "scope_note": scope_report(result)}

    @app.get("/patients/{patient_id}/trends")
    async def trends(patient_id: str, hours: str = "24",
                     authorization: str | None = Header(default=None)):
        """One patient's vital history for the trend charts (`api/trends.py`): the series, the
        NEWS2 rows as bands, the latest value's movement and points, and the alarm and antibiotic
        moments — everything a chart draws, decided here. Read-only, and not audited: opening the
        patient already wrote `view`, and a chart read every minute would bury that record.

        `hours` is read as text so that anything but 6, 24 or 72 is this route's 400, in the
        reader's words, rather than FastAPI's 422. A scope that cannot be read is 503, as the stream
        ticket answers it: `_require_patient` would call it "not found", which tells a screen the
        patient is gone when only the look-up failed. Out of scope and unknown stay one 404.
        """
        caller = await _caller(authorization)
        _require(caller, BOARD_VIEW)
        if hours not in {str(h) for h in TRENDS_HOURS}:
            raise HTTPException(status_code=400, detail="geçersiz hours: 6, 24 veya 72 olmalı")
        if (await _scope(authorization)).reason == UNKNOWN_SCOPE.reason:
            raise HTTPException(status_code=503, detail="kapsam şu anda okunamıyor")
        await _require_patient(caller, authorization, patient_id)
        _score_state(caller.hospital, patient_id)     # 404 for an id neither measured nor admitted
        return patient_trends(_engine(caller.hospital), audit, hospital=caller.hospital,
                              patient_id=patient_id, hours=int(hours),
                              now=datetime.now(timezone.utc))
```

- [ ] **Step 5: Engine green.**

```bash
cd /c/tmp/g2-vital/homunculus-engine
for f in tests/test_trends_api.py tests/test_infinity_shadow_isolation.py tests/test_board_permissions.py tests/test_tenant_isolation.py tests/test_nginx_routes.py tests/test_api_scope.py tests/test_api_patient_profile.py; do echo -n "$f: "; PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q $f 2>&1 | tail -1; done
```
Expected: `21 passed` · `18 passed` · `57 passed` · `1 passed, 108 skipped` · `43 passed` (`/patients` is already in nginx's API prefix list, deploy/local/web/nginx.conf:143) · `42 passed` · `27 passed`. With the database, `test_tenant_isolation.py` is `109 passed` (≈ 85 s).

- [ ] **Step 6: The dashboard reads app.py's refusals — red.**

```bash
cd /c/tmp/g2-vital/dashboard
npx vitest run src/live/apiErrors.test.js 2>&1 | grep -E "×|Tests "
```
Expected: `× … api/app.py detail: geçersiz hours: 6, 24 veya 72 olmalı` and `Tests  1 failed | 142 passed (143)`. (Base 141: the route adds two `detail=` literals — the new 400 and a second "kapsam şu anda okunamıyor", which is already translated.)

- [ ] **Step 7: Translate it.** Edit `dashboard/src/live/apiErrors.js` — replace:

```js
  ["skor formunu yalnız bir kişi imzalayabilir", "scoreSignedByOne"],
```

with:

```js
  ["skor formunu yalnız bir kişi imzalayabilir", "scoreSignedByOne"],
  // GET /patients/{id}/trends (Group 2's trend charts): a window other than 6, 24 or 72 hours.
  ["geçersiz hours: 6, 24 veya 72 olmalı", "badTrendHours"],
```

Then four Edits in `dashboard/src/live/i18n/strings/errors.js`, one per language — replace each `badAlarmKind` line with itself plus `badTrendHours`:

```js
    badAlarmKind: "Alarm türü geçersiz.",
```
→
```js
    badAlarmKind: "Alarm türü geçersiz.",
    badTrendHours: "Eğri aralığı yalnız 6 saat, 24 saat veya 3 gün olabilir.",
```

```js
    badAlarmKind: "Siqnal növü yanlışdır.",
```
→
```js
    badAlarmKind: "Siqnal növü yanlışdır.",
    badTrendHours: "Qrafik aralığı yalnız 6 saat, 24 saat və ya 3 gün ola bilər.",
```

```js
    badAlarmKind: "Тип тревоги некорректен.",
```
→
```js
    badAlarmKind: "Тип тревоги некорректен.",
    badTrendHours: "Интервал графика может быть только 6 часов, 24 часа или 3 дня.",
```

```js
    badAlarmKind: "The alarm kind is not valid.",
```
→
```js
    badAlarmKind: "The alarm kind is not valid.",
    badTrendHours: "A chart window can only be 6 hours, 24 hours or 3 days.",
```

- [ ] **Step 8: Dashboard green, then the gates.**

```bash
cd /c/tmp/g2-vital/dashboard
npx vitest run src/live/apiErrors.test.js src/live/i18n/ 2>&1 | grep -E "Test Files|Tests "
```
Expected: `Test Files  5 passed (5)`, `Tests  184 passed (184)` (apiErrors 143). Then the dashboard suite (`81 files / 1914 tests`) and the build (ground rules), and the whole backend suite without the database:

```bash
cd /c/tmp/g2-vital/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -1
```
Expected: `2070 passed, 648 skipped`.

- [ ] **Step 9: Commit.**

```bash
cd /c/tmp/g2-vital
git add homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_trends_api.py homunculus-engine/tests/test_infinity_shadow_isolation.py homunculus-engine/tests/test_board_permissions.py homunculus-engine/tests/test_tenant_isolation.py dashboard/src/live/apiErrors.js dashboard/src/live/i18n/strings/errors.js
git status --short && git diff --cached --stat
git commit -m "feat(api): GET /patients/{id}/trends behind board.view and the board's scope check" -m "401 / 403 (before the scope is asked) / 400 for hours outside 6, 24, 72 (read as text, the reader's words) / 503 when the scope is UNKNOWN (as the stream ticket; _require_patient would say 'not found') / 404 out of scope (audited) or unknown (nothing created). No audit row for the read. Listed in test_board_permissions and test_tenant_isolation; the isolation test gains the trends direction; the dashboard translates the new 400 (errors.badTrendHours).

red: test_trends_api 21 failed; isolation 2, board_permissions 2, tenant_isolation 1 failed (route absent); apiErrors.test.js 1 failed (an untranslated detail)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

# Part 2 · The dashboard's foundations (Tasks 6–8, independent of each other and of Part 1)

### Task 6: `backendApi` — `patientTrends` and `putPatientProfile`

Spec §6 with X12, X13. `patientTrends(patientId, hours = 24)` is an `authed()` GET like `boardPatients()` — the same refusal mapping (`failure()`), the same 15 s `timed()` limit. `putPatientProfile(patientId, body)` sends the body exactly as given, because the existing `setProfile` always sends `comorbidities` and the engine reads a present empty list as "clear them". `fakeApi` gains both, so every screen test that mounts the patient screen has them (an unset `vi.fn()` resolves `undefined`, which the screen must survive).

**Files:**
- Modify: `dashboard/src/backendApi.js`, `dashboard/src/backendApi.test.js`, `dashboard/src/live/session/testTokens.testutil.js`

- [ ] **Step 1: Write the failing tests.** Edit `dashboard/src/backendApi.test.js` — append a describe at the end of the file by replacing the file's last lines:

```js
      await api.reauth("gizli");
      expect(api.serverClockSkewMs()).toBe(-5 * 60 * 1000);
    } finally {
      vi.useRealTimers();
    }
  });
});
```

with:

```js
      await api.reauth("gizli");
      expect(api.serverClockSkewMs()).toBe(-5 * 60 * 1000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("backendApi — the trend charts and the patient's own normal (Group 2 · slice 1)", () => {
  const signedIn = (fetchMock) => {
    store.set("homunculus-access-token", "acc-1");
    store.set("homunculus-refresh-token", "ref-1");
    return createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
  };

  it("reads one patient's trends with an authed GET, the window in the query", async () => {
    const answer = { patient_id: "S 1/x", hours: 72, channels: [], markers: [] };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(answer));
    expect(await signedIn(fetchMock).patientTrends("S 1/x", 72)).toEqual(answer);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/patients/S%201%2Fx/trends?hours=72");
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe("Bearer acc-1");
  });

  it("asks for the 24-hour window when none is named", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    await signedIn(fetchMock).patientTrends("S-001");
    expect(fetchMock.mock.calls[0][0]).toBe("/patients/S-001/trends?hours=24");
  });

  it("a refused read carries the API's own message and status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ detail: "hasta bulunamadı" }, { ok: false, status: 404 }));
    await expect(signedIn(fetchMock).patientTrends("S-999", 24))
      .rejects.toMatchObject({ status: 404, message: "hasta bulunamadı" });
  });

  it("writes the patient's own normal with exactly the body it was given — no comorbidities key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ patient_id: "S-001" }));
    const body = { baselines: { heart_rate: { low: 100, high: 115 } } };
    await signedIn(fetchMock).putPatientProfile("S-001", body);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/clinical/S-001/profile");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual(body);
  });

  it("setProfile always sends comorbidities, which the engine reads as 'clear them' — why the form does not use it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    await signedIn(fetchMock).setProfile("S-001", { baselines: { heart_rate: { low: 1, high: 2 } } });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).comorbidities).toEqual([]);
  });

  it("a trends read that gets no answer gives up after 15 s, as every read does", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(() => new Promise(() => {}));
      const outcome = signedIn(fetchMock).patientTrends("S-001", 24).then(() => "answered", (err) => err);
      await vi.advanceTimersByTimeAsync(14_999);
      expect(await Promise.race([outcome, Promise.resolve("pending")])).toBe("pending");
      await vi.advanceTimersByTimeAsync(1);
      expect((await outcome).code).toBe(REQUEST_TIMEOUT);
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: Run it — red.**

```bash
cd /c/tmp/g2-vital/dashboard
npx vitest run src/backendApi.test.js 2>&1 | grep -E "×|Tests "
```
Expected: five `×` in the new describe (`…patientTrends is not a function` / `…putPatientProfile is not a function`) and `Tests  5 failed | 105 passed (110)` — the `setProfile` case passes already: it pins today's behaviour.

- [ ] **Step 3: The two calls.** Edit `dashboard/src/backendApi.js` — replace:

```js
    /** Escape hatch for endpoints not yet wrapped (admissions, alerts, tenant…). */
    request: authed,
```

with:

```js
    /**
     * One patient's vital history for the trend charts (GET /patients/{id}/trends, Group 2): the
     * series, the NEWS2 rows as bands, the latest value's movement and NEWS2 points, whether it
     * sits inside the normal a clinician charted, and the alarm and antibiotic moments — every
     * fact a chart draws, decided by the engine (homunculus-engine api/trends.py). `hours` is 6, 24
     * or 72; the API refuses any other with a 400.
     */
    patientTrends(patientId, hours = 24) {
      return authed(`/patients/${seg(patientId)}/trends?hours=${encodeURIComponent(hours)}`);
    },

    /**
     * The patient's own normal, written as the caller built it (PUT /clinical/{id}/profile).
     *
     * Not `setProfile` above: that always sends `comorbidities` (an empty list unless given),
     * and the engine reads a present-but-empty list as "clear them" (api/clinical.py
     * `profile_from_payload`) — so a form that only means to write the baselines would erase
     * every charted comorbidity. The baseline form sends `{baselines}` alone, and the engine keeps
     * whatever the body does not mention.
     */
    putPatientProfile(patientId, body) {
      return authed(`/clinical/${seg(patientId)}/profile`, { method: "PUT", body });
    },

    /** Escape hatch for endpoints not yet wrapped (admissions, alerts, tenant…). */
    request: authed,
```

Edit `dashboard/src/live/session/testTokens.testutil.js` — replace:

```js
    // Aşama A's unvalidated monitor strip (data/shadowStore.js)
    shadowBoard: vi.fn(),
```

with:

```js
    // Aşama A's unvalidated monitor strip (data/shadowStore.js)
    shadowBoard: vi.fn(),
    // Group 2 · slice 1: the patient screen's trend charts and the patient's own normal
    patientTrends: vi.fn(),
    putPatientProfile: vi.fn(),
```

- [ ] **Step 4: Green, then the gate.**

```bash
cd /c/tmp/g2-vital/dashboard
npx vitest run src/backendApi.test.js 2>&1 | grep -E "Tests "
```
Expected: `Tests  110 passed (110)`. Then the suite — **81 files / 1920 tests** in plan order (base + 2 from Task 5 + 6 here) — and the build.

- [ ] **Step 5: Commit.**

```bash
cd /c/tmp/g2-vital
git add dashboard/src/backendApi.js dashboard/src/backendApi.test.js dashboard/src/live/session/testTokens.testutil.js
git status --short && git diff --cached --stat
git commit -m "feat(dashboard): backendApi.patientTrends and putPatientProfile" -m "patientTrends is an authed GET like boardPatients (same refusal mapping, same 15 s limit). putPatientProfile sends the body as given: setProfile always sends comorbidities, which the engine reads as 'clear them' (a test pins that, so nobody moves the form onto it). fakeApi gains both.

red: 5 failed — patientTrends / putPatientProfile is not a function" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Tokens — `--band-n`, `--band-mid`, `--band-crit`, `--grid`, held to contrast

Spec §6 with X6. `--band-mid` and `--band-crit` tint a NEWS2 row the engine scores 1–2 and 3 points (D2's amber and red); `--band-n` the patient's own normal (the prototype's own `--band-n`); `--grid` the value lines. The prototype's single `--band-al` (`rgba(239,68,68,.12)` / `rgba(220,38,38,.08)`) becomes two. Every `--v-*` line must clear **3:1** over each tint on a card (measured lowest: Gün `--v-map` over `--band-n`, 4.21:1); the ▲/◆ marks sit on the card in their own lane (`crit` 3.57 / 4.83, `pri` 7.31 / 5.36).

**Files:**
- Modify: `dashboard/src/live/theme/tokens.css`, `dashboard/src/live/theme/tokens.js`, `dashboard/src/live/theme/tokens.test.js`

- [ ] **Step 1: Write the failing tests.** Edit `dashboard/src/live/theme/tokens.test.js` — replace:

```js
  // A bed card's stripe sits on the card, a dot or bar in a card2 row (G1-09), a stripe on the
  // page or the app frame (G1-07): each ground is held to 3:1.
```

with:

```js
  // Group 2's trend charts (screens/patient/trends/): a vital's dots and dashed connectors are drawn
  // over a band tint on the card — a NEWS2 row scoring 1–2 (band-mid) or 3 (band-crit), or the
  // patient's own normal (band-n). A line is a graphic, held to 3:1, over every tint it can cross.
  // (The prototype drew MAP at reduced opacity; at .55–.70 that measured 2.17–3.34:1, so the
  // charts draw MAP at full colour with hollow dots instead.)
  it.each(["v-hr", "v-map", "v-spo", "v-rr", "v-t"].flatMap((v) => ["band-n", "band-mid", "band-crit"].map((b) => [v, b])))(
    "chart: the %s line clears 3:1 over the %s tint on a card",
    (vital, band) => {
      expect(ratio(s(vital), over(theme, band, "card"))).toBeGreaterThanOrEqual(UI);
    },
  );

  // The ▲ alarm and ◆ antibiotic marks sit in their own lane under the plot, on the card — never
  // over a band.
  it.each(["crit", "pri"])("chart: the %s marker clears 3:1 on a card", (name) => {
    expect(ratio(s(name), s("card"))).toBeGreaterThanOrEqual(UI);
  });

  // A bed card's stripe sits on the card, a dot or bar in a card2 row (G1-09), a stripe on the
  // page or the app frame (G1-07): each ground is held to 3:1.
```

- [ ] **Step 2: Run it — red.**

```bash
cd /c/tmp/g2-vital/dashboard
npx vitest run src/live/theme/tokens.test.js 2>&1 | grep -E "Tests |not a colour" | sort -u
```
Expected: `Error: not a colour this test reads: undefined` and `Tests  30 failed | 196 passed (226)` (fifteen line-over-tint cases per theme; the four marker cases pass already).

- [ ] **Step 3: The tokens.** Edit `dashboard/src/live/theme/tokens.css` three times.

(a) Replace the header's last lines:

```css
 * on card, card2, page and app; the *Ink tokens are for text. Not ported yet (YAGNI): --monbg (Group 2 monitor; its Gun vital colours
 * fail on it), --band-*, --grid (charts), --body-* (body map).
 */
```

with:

```css
 * on card, card2, page and app; the *Ink tokens are for text. Not ported yet (YAGNI): --monbg (Group 2 monitor; its Gun vital colours
 * fail on it), --body-* (body map).
 * The trend charts' grounds (Group 2 · slice 1): --band-mid and --band-crit tint a NEWS2 row scoring
 *   1–2 and 3 points (the engine's points, never a value judged here), --band-n the patient's own
 *   normal (the prototype's --band-n), --grid the value lines. The prototype's single --band-al
 *   became two, because D2 frames 1–2 points amber and 3 red. Every --v-* line holds 3:1 over each
 *   tint on a card (tokens.test.js).
 */
```

(b) In the Gece block replace:

```css
  --v-t: #e8eef7;
  --scrim: rgba(2, 6, 14, .55);
  --shadow: 0 12px 30px rgba(0, 0, 0, .45);
```

with:

```css
  --v-t: #e8eef7;
  --band-n: rgba(34, 184, 214, .13);
  --band-mid: rgba(234, 179, 8, .12);
  --band-crit: rgba(239, 68, 68, .12);
  --grid: #1c2c45;
  --scrim: rgba(2, 6, 14, .55);
  --shadow: 0 12px 30px rgba(0, 0, 0, .45);
```

(c) In the Gün block replace:

```css
  --v-t: #152231;
  --scrim: rgba(2, 6, 14, .55);
```

with:

```css
  --v-t: #152231;
  --band-n: rgba(14, 116, 144, .10);
  --band-mid: rgba(186, 127, 7, .10);
  --band-crit: rgba(220, 38, 38, .08);
  --grid: #e7ebf1;
  --scrim: rgba(2, 6, 14, .55);
```

Edit `dashboard/src/live/theme/tokens.js` — replace:

```js
  // vital-sign channels
  "v-hr", "v-map", "v-spo", "v-rr", "v-t",
```

with:

```js
  // vital-sign channels
  "v-hr", "v-map", "v-spo", "v-rr", "v-t",
  // the trend charts: NEWS2 rows scoring 1–2 and 3 points, the patient's own normal, value lines
  "band-n", "band-mid", "band-crit", "grid",
```

(Tailwind reaches them as `fill-band-mid`, `fill-band-crit`, `fill-band-n`, `stroke-grid` through `tailwindColors()`; `tailwind.test.js` checks the mapping and that no name shadows a Tailwind default.)

- [ ] **Step 4: Green, then the gate.**

```bash
cd /c/tmp/g2-vital/dashboard
npx vitest run src/live/theme/ 2>&1 | grep -E "Test Files|Tests "
```
Expected: `Test Files  4 passed (4)`, `Tests  262 passed (262)` (tokens.test.js 226). Then the suite — **81 / 1954** in plan order — and the build.

- [ ] **Step 5: Commit.**

```bash
cd /c/tmp/g2-vital
git add dashboard/src/live/theme/tokens.css dashboard/src/live/theme/tokens.js dashboard/src/live/theme/tokens.test.js
git status --short && git diff --cached --stat
git commit -m "feat(theme): the trend charts' band and grid tokens, every vital line held to 3:1 over them" -m "--band-mid / --band-crit tint the NEWS2 rows the engine scores 1–2 and 3, --band-n the patient's own normal, --grid the value lines, in Gece and Gün. Each --v-* line clears 3:1 over each tint on a card (lowest: Gun v-map over band-n, 4.21); the alarm and antibiotic marks clear 3:1 on the card.

red: 30 failed — not a colour this test reads: undefined" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: The strings — 49 keys in four languages, and two sentences that would become false

Spec §9 (its 31 new keys; `trends` exists), plus what the table, the dialog's controls and the form need (18 more: `trendsLoading`, `trendsChartLabel`, `trendsBandPoints12`, `trendsBandPoints3`, `trendsHoursLabel`, `trendsViewLabel`, `trendsKeysHint`, `trendsCaption`, `trendsCol*` ×6, `baselineNotDeviceAlarm`, `baselineNotNumber`, `baselineNothingToSend`, `baselineSaving`), and two placeholders the spec's list does not carry: `trendsBandNews2` takes `{source}` (the legend names the source the SERVER sent), `baselineMayHaveLanded` takes `{subject}` (amendments (f)). Per X9, `onlyWrite` and `formsSoon` are reworded in four languages (the old texts stay recognisable to the existing tests). `trendsSoon` stays until Task 9 removes the placeholder that reads it. Nothing renders these yet; `rawKeys.test.jsx`'s static net checks only that a key a source NAMES exists.

The Azerbaijani and Russian texts are the planner's and await a native reading (O1).

**Files:**
- Modify: `dashboard/src/live/i18n/strings/patient.js`, `dashboard/src/live/i18n/strings.test.js`

- [ ] **Step 1: The Turkish source.** Two Edits in `dashboard/src/live/i18n/strings/patient.js`, in the `tr` block.

(a) Replace:

```js
    onlyWrite: "Bu ekranın hasta kaydına yazdığı tek şey şüpheli enfeksiyon işaretidir; başka hiçbir şey buradan yazılmaz.",
```

with:

```js
    onlyWrite: "Bu ekran hasta kaydına iki şey yazar: şüpheli enfeksiyon işareti ve hastanın normali (yalnız clinical.chart yetkisiyle); başka hiçbir şey buradan yazılmaz.",
```

(b) Replace:

```js
    formsSoon: "SOFA formunu doldurma/imzalama ve hastanın kendi normalini girme bu ekrana sonraki grupta eklenecek.",
```

with:

```js
    formsSoon: "SOFA formunu doldurma ve imzalama bu ekrana sonraki grupta eklenecek.",
    // Group 2 · slice 1 — the trend charts and the patient's own normal (spec §9, plus the
    // table, the dialog's controls and the form's own words).
    trendsNote: "NEWS2 · yetişkin bantları; hastanın normali, hekim girdiyse",
    trendsLoading: "Vital eğrileri okunuyor…",
    trendsUnreadable: "Vital eğrileri okunamıyor (son: {time})",
    trendsNoData: "Bu kanal için ölçüm yok",
    trendsSingle: "tek ölçüm",
    trendsDelta: "{delta} (öncekine göre)",
    trendsFrameBadge: "NEWS2 +{points}",
    trendsOwnNormalPill: "Hastanın normalinde",
    trendsOpen: "{channel}: büyük grafiği aç",
    trendsChartLabel: "{channel}: son {hours} saatteki ölçüm sayısı {count}",
    trendsThinned: "seyreltilmiş: {total} noktadan {kept}",
    trendsBandNews2: "NEWS2 bandı (yetişkin) · kaynak {source}",
    trendsBandPoints12: "1–2 puan",
    trendsBandPoints3: "3 puan",
    trendsBandOwn: "hastanın normali",
    trendsMarkerAlarm: "alarm",
    trendsMarkerAntibiotic: "antibiyotik",
    trendsLegendPoints: "noktalar ölçüm, kesikli çizgi aralık",
    trendsHoursLabel: "Zaman aralığı",
    trendsHours6: "6 sa",
    trendsHours24: "24 sa",
    trendsHours72: "3 gün",
    trendsViewLabel: "Görünüm",
    trendsGraph: "Grafik",
    trendsTable: "Tablo",
    trendsReadoutIdle: "Bir ölçümü okumak için grafiğin üzerine gelin ya da ← → tuşlarını kullanın.",
    trendsKeysHint: "Grafik seçiliyken ← → bir sonraki ölçüm, Home/End ilk ve son ölçüm.",
    trendsCaption: "{channel} — ölçümler, en yeni üstte",
    trendsColTime: "Saat",
    trendsColChannel: "Kanal",
    trendsColValue: "Değer",
    trendsColUnit: "Birim",
    trendsColBand: "NEWS2 puanı",
    trendsColMarker: "İşaret",
    baselineOpen: "Hastanın normali…",
    baselineTitle: "Hastanın normali",
    baselineNotDeviceAlarm: "Bu aralıklar monitörün alarm sınırı değildir: motor bu hastanın değerlerini yorumlarken hekimin girdiği bu normali kullanır.",
    baselineLow: "alt",
    baselineHigh: "üst",
    baselineBothOrNeither: "iki sınır da gerekli",
    baselineLowAboveHigh: "alt sınır üst sınırdan büyük",
    baselineNotNumber: "sayı girin",
    baselineClearsNote: "Boş bırakılan aralık silinir. Komorbiditelere dokunulmaz.",
    baselineNothingToSend: "Gönderilecek aralık yok: en az bir satırın iki sınırını da girin.",
    baselineSaving: "Hastanın normali kaydediliyor…",
    baselineSaved: "Hastanın normali kaydedildi; motor yeniden değerlendirdi.",
    baselineRefused: "{subject}: hastanın normali kaydedilmedi — {reason}",
    baselineMayHaveLanded: "{subject}: sunucu yanıt vermedi; hastanın normali kaydedilmiş olabilir — eğrideki bandı kontrol edin.",
    baselineNoRight: "bu işlem için artık yetkiniz yok (clinical.chart)",
```

- [ ] **Step 2: Azerbaijani** (the `az` block).

(a) Replace:

```js
    onlyWrite: "Bu ekranın xəstə qeydinə yazdığı yalnız şübhəli infeksiya işarəsidir; buradan başqa heç nə yazılmır.",
```

with:

```js
    onlyWrite: "Bu ekran xəstə qeydinə iki şey yazır: şübhəli infeksiya işarəsi və xəstənin norması (yalnız clinical.chart səlahiyyəti ilə); buradan başqa heç nə yazılmır.",
```

(b) Replace:

```js
    formsSoon: "SOFA formasının doldurulması/imzalanması və xəstənin öz normasının daxil edilməsi bu ekrana növbəti qrupda əlavə olunacaq.",
```

with:

```js
    formsSoon: "SOFA formasının doldurulması və imzalanması bu ekrana növbəti qrupda əlavə olunacaq.",
    trendsNote: "NEWS2 · yetkin zolaqları; xəstənin norması, həkim daxil edibsə",
    trendsLoading: "Vital qrafikləri oxunur…",
    trendsUnreadable: "Vital qrafikləri oxunmur (son: {time})",
    trendsNoData: "Bu kanal üçün ölçmə yoxdur",
    trendsSingle: "tək ölçmə",
    trendsDelta: "{delta} (əvvəlkinə görə)",
    trendsFrameBadge: "NEWS2 +{points}",
    trendsOwnNormalPill: "Xəstənin normasında",
    trendsOpen: "{channel}: böyük qrafiki aç",
    trendsChartLabel: "{channel}: son {hours} saatdakı ölçmələrin sayı {count}",
    trendsThinned: "seyrəldilib: {total} nöqtədən {kept}",
    trendsBandNews2: "NEWS2 zolağı (yetkin) · mənbə {source}",
    trendsBandPoints12: "1–2 bal",
    trendsBandPoints3: "3 bal",
    trendsBandOwn: "xəstənin norması",
    trendsMarkerAlarm: "siqnal",
    trendsMarkerAntibiotic: "antibiotik",
    trendsLegendPoints: "nöqtələr ölçmədir, qırıq xətt aralıqdır",
    trendsHoursLabel: "Vaxt aralığı",
    trendsHours6: "6 saat",
    trendsHours24: "24 saat",
    trendsHours72: "3 gün",
    trendsViewLabel: "Görünüş",
    trendsGraph: "Qrafik",
    trendsTable: "Cədvəl",
    trendsReadoutIdle: "Ölçməni oxumaq üçün qrafikin üzərinə gəlin və ya ← → düymələrindən istifadə edin.",
    trendsKeysHint: "Qrafik seçiləndə ← → növbəti ölçmə, Home/End ilk və son ölçmə.",
    trendsCaption: "{channel} — ölçmələr, ən yenisi yuxarıda",
    trendsColTime: "Saat",
    trendsColChannel: "Kanal",
    trendsColValue: "Dəyər",
    trendsColUnit: "Vahid",
    trendsColBand: "NEWS2 balı",
    trendsColMarker: "İşarə",
    baselineOpen: "Xəstənin norması…",
    baselineTitle: "Xəstənin norması",
    baselineNotDeviceAlarm: "Bu aralıqlar monitorun siqnal həddi deyil: mühərrik bu xəstənin dəyərlərini şərh edərkən həkimin daxil etdiyi bu normadan istifadə edir.",
    baselineLow: "alt",
    baselineHigh: "üst",
    baselineBothOrNeither: "hər iki hədd lazımdır",
    baselineLowAboveHigh: "alt hədd üst həddən böyükdür",
    baselineNotNumber: "rəqəm daxil edin",
    baselineClearsNote: "Boş saxlanılan aralıq silinir. Yanaşı xəstəliklərə toxunulmur.",
    baselineNothingToSend: "Göndəriləcək aralıq yoxdur: ən azı bir sətrin hər iki həddini daxil edin.",
    baselineSaving: "Xəstənin norması yadda saxlanılır…",
    baselineSaved: "Xəstənin norması yadda saxlanıldı; mühərrik yenidən qiymətləndirdi.",
    baselineRefused: "{subject}: xəstənin norması yadda saxlanılmadı — {reason}",
    baselineMayHaveLanded: "{subject}: server cavab vermədi; xəstənin norması yadda saxlanılmış ola bilər — qrafikdəki zolağı yoxlayın.",
    baselineNoRight: "bu əməliyyat üçün artıq səlahiyyətiniz yoxdur (clinical.chart)",
```

- [ ] **Step 3: Russian** (the `ru` block).

(a) Replace:

```js
    onlyWrite: "Единственное, что этот экран записывает в карту пациента, — отметка о подозрении на инфекцию; больше отсюда ничего не записывается.",
```

with:

```js
    onlyWrite: "Этот экран записывает в карту пациента две вещи: отметку о подозрении на инфекцию и норму пациента (только с правом clinical.chart); больше отсюда ничего не записывается.",
```

(b) Replace:

```js
    formsSoon: "Заполнение и подпись формы SOFA и ввод собственной нормы пациента будут добавлены на этот экран в следующей группе.",
```

with:

```js
    formsSoon: "Заполнение и подпись формы SOFA будут добавлены на этот экран в следующей группе.",
    trendsNote: "Полосы NEWS2 · для взрослых; норма пациента — если её ввёл врач",
    trendsLoading: "Графики показателей загружаются…",
    trendsUnreadable: "Графики показателей не загружаются (последний раз: {time})",
    trendsNoData: "Для этого канала измерений нет",
    trendsSingle: "одно измерение",
    trendsDelta: "{delta} (к предыдущему)",
    trendsFrameBadge: "NEWS2 +{points}",
    trendsOwnNormalPill: "В пределах нормы пациента",
    trendsOpen: "{channel}: открыть большой график",
    trendsChartLabel: "{channel}: измерений за последние {hours} ч — {count}",
    trendsThinned: "прорежено: показано {kept} из {total}",
    trendsBandNews2: "Полоса NEWS2 (взрослые) · источник {source}",
    trendsBandPoints12: "1–2 балла",
    trendsBandPoints3: "3 балла",
    trendsBandOwn: "норма пациента",
    trendsMarkerAlarm: "тревога",
    trendsMarkerAntibiotic: "антибиотик",
    trendsLegendPoints: "точки — измерения, пунктир — промежуток",
    trendsHoursLabel: "Интервал",
    trendsHours6: "6 ч",
    trendsHours24: "24 ч",
    trendsHours72: "3 дня",
    trendsViewLabel: "Вид",
    trendsGraph: "График",
    trendsTable: "Таблица",
    trendsReadoutIdle: "Чтобы прочитать измерение, наведите курсор на график или используйте клавиши ← →.",
    trendsKeysHint: "Когда график выбран: ← → — соседнее измерение, Home/End — первое и последнее.",
    trendsCaption: "{channel} — измерения, новые сверху",
    trendsColTime: "Время",
    trendsColChannel: "Канал",
    trendsColValue: "Значение",
    trendsColUnit: "Единица",
    trendsColBand: "Баллы NEWS2",
    trendsColMarker: "Отметка",
    baselineOpen: "Норма пациента…",
    baselineTitle: "Норма пациента",
    baselineNotDeviceAlarm: "Эти диапазоны — не пределы тревог монитора: система использует введённую врачом норму, когда оценивает показатели этого пациента.",
    baselineLow: "нижняя",
    baselineHigh: "верхняя",
    baselineBothOrNeither: "нужны обе границы",
    baselineLowAboveHigh: "нижняя граница больше верхней",
    baselineNotNumber: "введите число",
    baselineClearsNote: "Пустой диапазон удаляется. Сопутствующие заболевания не затрагиваются.",
    baselineNothingToSend: "Нечего отправлять: введите обе границы хотя бы в одной строке.",
    baselineSaving: "Норма пациента сохраняется…",
    baselineSaved: "Норма пациента сохранена; система заново оценила пациента.",
    baselineRefused: "{subject}: норма пациента не сохранена — {reason}",
    baselineMayHaveLanded: "{subject}: сервер не ответил; норма пациента могла сохраниться — проверьте полосу на графике.",
    baselineNoRight: "у вас больше нет права на это действие (clinical.chart)",
```

- [ ] **Step 4: English** (the `en` block).

(a) Replace:

```js
    onlyWrite: "The only thing this screen writes to the patient's record is the suspected-infection charting; nothing else is written from here.",
```

with:

```js
    onlyWrite: "This screen writes two things to the patient's record: the suspected-infection charting and the patient's own normal (with clinical.chart only); nothing else is written from here.",
```

(b) Replace:

```js
    formsSoon: "Filling in and signing the SOFA form and entering the patient's own normal come to this screen in the next group.",
```

with:

```js
    formsSoon: "Filling in and signing the SOFA form come to this screen in the next group.",
    trendsNote: "NEWS2 · adult bands; the patient's normal, if a physician entered one",
    trendsLoading: "Loading vital trends…",
    trendsUnreadable: "Vital trends cannot be loaded (last: {time})",
    trendsNoData: "No measurement for this channel",
    trendsSingle: "one measurement",
    trendsDelta: "{delta} (since the previous)",
    trendsFrameBadge: "NEWS2 +{points}",
    trendsOwnNormalPill: "Within the patient's normal",
    trendsOpen: "{channel}: open the large chart",
    trendsChartLabel: "{channel}: measurements in the last {hours} h — {count}",
    trendsThinned: "thinned: {kept} of {total} points shown",
    trendsBandNews2: "NEWS2 band (adult) · source {source}",
    trendsBandPoints12: "1–2 points",
    trendsBandPoints3: "3 points",
    trendsBandOwn: "the patient's normal",
    trendsMarkerAlarm: "alarm",
    trendsMarkerAntibiotic: "antibiotic",
    trendsLegendPoints: "dots are measurements, the dashed line is the interval",
    trendsHoursLabel: "Window",
    trendsHours6: "6 h",
    trendsHours24: "24 h",
    trendsHours72: "3 days",
    trendsViewLabel: "View",
    trendsGraph: "Chart",
    trendsTable: "Table",
    trendsReadoutIdle: "Hover over the chart or use ← → to read a measurement.",
    trendsKeysHint: "With the chart selected: ← → the next measurement, Home/End the first and the last.",
    trendsCaption: "{channel} — measurements, newest first",
    trendsColTime: "Time",
    trendsColChannel: "Channel",
    trendsColValue: "Value",
    trendsColUnit: "Unit",
    trendsColBand: "NEWS2 points",
    trendsColMarker: "Mark",
    baselineOpen: "The patient's normal…",
    baselineTitle: "The patient's normal",
    baselineNotDeviceAlarm: "These ranges are not the monitor's alarm limits: the engine uses this physician-entered normal when it reads this patient's values.",
    baselineLow: "low",
    baselineHigh: "high",
    baselineBothOrNeither: "both limits are needed",
    baselineLowAboveHigh: "the low limit is above the high one",
    baselineNotNumber: "enter a number",
    baselineClearsNote: "A range left empty is deleted. Comorbidities are not touched.",
    baselineNothingToSend: "Nothing to send: enter both limits of at least one row.",
    baselineSaving: "Saving the patient's normal…",
    baselineSaved: "The patient's normal is saved; the engine has re-evaluated.",
    baselineRefused: "{subject}: the patient's normal was not saved — {reason}",
    baselineMayHaveLanded: "{subject}: the server did not answer; the patient's normal may have been saved — check the band on the chart.",
    baselineNoRight: "you no longer have the right for this (clinical.chart)",
```

(Russian numerals: the counts are written after a dash — "— {count}", "показано {kept} из {total}" — so no noun has to agree with a number.)

- [ ] **Step 5: Run the dictionary test — red for the reviewed identities.**

```bash
cd /c/tmp/g2-vital/dashboard
npx vitest run src/live/i18n/strings.test.js 2>&1 | grep -E "→|Tests "
```
Expected: `→ az patient.trendsFrameBadge = tr "NEWS2 +{points}": review, then list it…`, `→ ru patient.trendsFrameBadge: expected 'NEWS2 +{points}' to match /[Ѐ-ӿ]/`, `Tests  2 failed | 4 passed (6)`.

- [ ] **Step 6: List the reviewed ones.** Two Edits in `dashboard/src/live/i18n/strings.test.js`.

(a) Replace:

```js
  // G1-11 (patient) · neutral
  "patient.sofa", //              SOFA — the same
```

with:

```js
  // G1-11 (patient) · neutral
  "patient.sofa", //              SOFA — the same
  "patient.trendsFrameBadge", //  "NEWS2 +{points}" — the score's own name and a number (Group 2)
```

(b) Replace:

```js
  "patient.seenBy", //       Gördü — the same verb as alarms.seenBy
```

with:

```js
  "patient.seenBy", //       Gördü — the same verb as alarms.seenBy
  // Group 2 · slice 1 (the trend charts and the patient's own normal)
  "patient.trendsFrameBadge", // "NEWS2 +{points}" — the score's name and a number
  "patient.trendsHours72", //  3 gün — "3 days" reads the same in Azerbaijani
  "patient.trendsColTime", //  Saat — "time" (of day) in Azerbaijani too
  "patient.trendsColChannel", // Kanal — the same word (board.chLac's neighbour, "Bu kanal üçün")
  "patient.baselineLow", //    alt — "lower" in Azerbaijani too
  "patient.baselineHigh", //   üst — "upper" in Azerbaijani too
```

- [ ] **Step 7: Green, then the gate.**

```bash
cd /c/tmp/g2-vital/dashboard
npx vitest run src/live/i18n/ src/live/rawKeys.test.jsx src/live/screens/patient/ 2>&1 | grep -E "Test Files|Tests "
```
Expected: `Test Files  6 passed (6)`, `Tests  97 passed (97)` — the patient screen's own test still passes: its `heç nə yazılmır` and `növbəti qrupda əlavə olunacaq` match the new sentences. Then the suite — **81 / 1954** — and the build.

- [ ] **Step 8: Commit.**

```bash
cd /c/tmp/g2-vital
git add dashboard/src/live/i18n/strings/patient.js dashboard/src/live/i18n/strings.test.js
git status --short && git diff --cached --stat
git commit -m "feat(i18n): the trend charts' and the patient's normal's words, in four languages" -m "Spec §9's 31 new keys and 18 the table, the dialog's controls and the form need. onlyWrite now names the two writes and formsSoon only the SOFA form (the patient's normal arrives in this slice). One neutral key, six reviewed az = tr. AZ and RU await a native reading.

red: 2 failed — az patient.trendsFrameBadge = tr; ru patient.trendsFrameBadge has no Cyrillic" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

# Part 3 · The patient screen (Tasks 9–14, one chain: each edits `TrendsBox.jsx`)

### Task 9: The box where the placeholder stood, and the read behind it

Spec §3.1 (the box, its header, its unreadable state) and §6 (`useTrends`). The box is wired into the patient screen in this task — `reachable.test.js` refuses a module the page cannot reach — so for one commit it holds only its header and its states; the cards come in Task 10.

`useTrends(patientId, hours, measuredKey)` reads through `store.track(() => store.api.patientTrends(…))`: on mount, on a new patient or window (what is shown is cleared first, so another patient's answer is never on screen), when the board's `measuredAt` for the patient changes (`measuredKeyOf`), and every `TRENDS_POLL_MS = 60 000` while the page is visible and the session READY; nothing while LOCKED, and an answer landing after the lock, a sign-out (`store.epoch()`) or an unmount is dropped. A failed or malformed read keeps the last answer and reports `unreadable` with `lastOkAt`. The forms seam keeps its sentence, as a `Note` under the Sepsis/Meds row; `trendsSoon` goes.

**Files:**
- Create: `dashboard/src/live/screens/patient/trends/trends.testutil.js`, `trends/useTrends.js`, `trends/useTrends.test.jsx`, `trends/TrendsBox.jsx`
- Modify: `dashboard/src/live/screens/patient/PatientScreen.jsx`, `PatientScreen.test.jsx`, `dashboard/src/live/i18n/strings/patient.js`

- [ ] **Step 1: The fixtures** — Write `dashboard/src/live/screens/patient/trends/trends.testutil.js`:

```js
// Test-only: synthetic GET /patients/{id}/trends answers, in the endpoint's own shape
// (homunculus-engine api/trends.py `patient_trends`), for the patient screen's trend charts.
//
// NO PATIENT DATA, EVER (CLAUDE.md, hard rule 6). Ids are `S-001`…, every value is invented, and
// every instant is relative to board.testutil's NOW, so an age a test prints is the age it wrote.
// Nothing here may be replaced by anything from a real ward, a capture or an export.
//
// The convention is board.testutil's: what a fixture almost always varies is POSITIONAL, the rest
// goes in a trailing override, and the builders THROW on the other shape rather than quietly
// building a fixture that does not hold what the test is about:
//
//     trends("S-001", [channel("heart_rate", [point(30, 84, 0), point(5, 132, 3)], { latest: … })])
import { NOW, ago } from "../../../data/board.testutil.js";

/** The channels the endpoint lists, in its order (api/board.py `_PUBLISHED_SIGNALS`). */
export const KEYS = Object.freeze(["heart_rate", "map", "sbp", "spo2", "temperature", "resp_rate", "lactate"]);

const UNITS = { heart_rate: "/min", map: "mmHg", sbp: "mmHg", spo2: "%", temperature: "°C", resp_rate: "/min", lactate: "mmol/L" };

/** The engine's NEWS2 rows as the endpoint serves them (rules/news2.py `NEWS2_BANDS`, Scale 1):
 *  `low < value <= high`, null for an open side. MAP and lactate have none. */
export const BANDS = Object.freeze({
  heart_rate: [{ low: null, high: 40, points: 3 }, { low: 40, high: 50, points: 1 }, { low: 50, high: 90, points: 0 },
    { low: 90, high: 110, points: 1 }, { low: 110, high: 130, points: 2 }, { low: 130, high: null, points: 3 }],
  resp_rate: [{ low: null, high: 8, points: 3 }, { low: 8, high: 11, points: 1 }, { low: 11, high: 20, points: 0 },
    { low: 20, high: 24, points: 2 }, { low: 24, high: null, points: 3 }],
  spo2: [{ low: null, high: 91, points: 3 }, { low: 91, high: 93, points: 2 }, { low: 93, high: 95, points: 1 },
    { low: 95, high: null, points: 0 }],
  sbp: [{ low: null, high: 90, points: 3 }, { low: 90, high: 100, points: 2 }, { low: 100, high: 110, points: 1 },
    { low: 110, high: 219, points: 0 }, { low: 219, high: null, points: 3 }],
  temperature: [{ low: null, high: 35, points: 3 }, { low: 35, high: 36, points: 1 }, { low: 36, high: 38, points: 0 },
    { low: 38, high: 39, points: 1 }, { low: 39, high: null, points: 2 }],
  map: null,
  lactate: null,
});

/** One reading: `[iso, value, the engine's NEWS2 points for it]`, `minutesAgo` before NOW. */
export const point = (minutesAgo, value, points = null) => [ago(minutesAgo * 60), value, points];

/** One mark on the time axis. */
export const marker = (minutesAgo, kind = "alarm", label = kind === "alarm" ? "news2" : "antibiotic_administered") => (
  { ts: ago(minutesAgo * 60), kind, label });

/** One channel. Its `latest` defaults to the last point with no delta and no own-normal judgement;
 *  a test about those states them in `over.latest`. */
export function channel(key, points = [], over = {}) {
  if (!KEYS.includes(key)) throw new TypeError(`channel(key, points, over): no channel "${key}"`);
  if (!Array.isArray(points)) throw new TypeError("channel(key, points, over): points is an array of point(…)");
  const last = points[points.length - 1];
  return {
    key,
    unit: UNITS[key],
    points,
    thinned: false,
    total_points: points.length,
    latest: last ? { ts: last[0], value: last[1], delta: null, news2_points: last[2], within_own_normal: null } : null,
    bands: { news2: BANDS[key], own_normal: null, device: null },
    ...over,
  };
}

/** One answer: every channel the endpoint lists, the given ones in place of empty ones. */
export function trends(patientId = "S-001", channels = [], over = {}) {
  if (typeof patientId !== "string") throw new TypeError("trends(patientId, channels, over): the id comes first");
  if (!Array.isArray(channels)) throw new TypeError("trends(patientId, channels, over): channels is an array of channel(…)");
  const byKey = Object.fromEntries(channels.map((c) => [c.key, c]));
  const hours = over.hours ?? 24;
  return {
    patient_id: patientId,
    hours,
    since: new Date(NOW - hours * 3_600_000).toISOString(),
    until: new Date(NOW).toISOString(),
    generated_at: new Date(NOW).toISOString(),
    bands_source: "news2-rcp-2017",
    news2_scale: 1,
    channels: KEYS.map((key) => byKey[key] ?? channel(key)),
    markers: [],
    ...over,
  };
}

/** `api.patientTrends` answering every patient and window with `build(patientId, hours)`. */
export const answering = (build = (pid, hours) => trends(pid, [], { hours })) => (pid, hours) => Promise.resolve(build(pid, hours));
```

- [ ] **Step 2: Write the hook's failing test** — Write `dashboard/src/live/screens/patient/trends/useTrends.test.jsx`:

```jsx
// useTrends: when the patient screen reads the trend charts, and what it keeps when it cannot.
// Fake timers are installed BEFORE mount (the house recipe), and `flush()` yields one real turn of
// the event loop inside act() instead of waitFor.
import { describe, it, expect, vi, afterEach } from "vitest";
import React, { useState } from "react";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { mount } from "../../../session/mount.testutil.jsx";
import { profile, token } from "../../../session/testTokens.testutil.js";
import { NOW } from "../../../data/board.testutil.js";
import { TRENDS_POLL_MS, measuredKeyOf, useTrends } from "./useTrends.js";
import { answering, channel, point, trends } from "./trends.testutil.js";

const realSetTimeout = globalThis.setTimeout;
const FAKE_TIMERS = { toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] };
const flush = () => act(() => new Promise((resolve) => { realSetTimeout(resolve, 0); }));

let setProps;
function Probe(initial) {
  const [props, set] = useState(initial);
  setProps = set;
  const read = useTrends(props.id, props.hours, props.measuredKey);
  const hr = read.data?.channels.find((c) => c.key === "heart_rate")?.latest?.value;
  return (
    <>
      <output data-testid="probe" data-loading={String(read.loading)} data-unreadable={String(read.unreadable)}
        data-patient={read.data?.patient_id ?? ""} data-last={read.lastOkAt ?? ""}>{hr ?? ""}</output>
      <button type="button" onClick={read.reload}>again</button>
    </>
  );
}
const probe = () => screen.getByTestId("probe");
const withHr = (value) => (pid, hours) => trends(pid, [channel("heart_rate", [point(5, value, 0)])], { hours });

async function start({ id = "S-001", hours = 24, measuredKey = "k1", answer = answering(withHr(84)) } = {}) {
  vi.useFakeTimers(FAKE_TIMERS);
  vi.setSystemTime(NOW);
  const mounted = await mount(<Probe id={id} hours={hours} measuredKey={measuredKey} />, {
    access: token(), me: profile(), setup: (api) => api.patientTrends.mockImplementation(answer),
  });
  await flush();
  return mounted;
}

function visibility(state) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  cleanup();
  delete document.visibilityState;
  vi.useRealTimers();
  localStorage.clear();          // a lock is written to storage (`hmc.lock`) and would lock the next test
});

describe("useTrends", () => {
  it("reads the patient's window once on mount and gives the answer", async () => {
    const { api } = await start();
    expect(api.patientTrends.mock.calls).toEqual([["S-001", 24]]);
    expect(probe()).toHaveTextContent("84");
    expect(probe().dataset).toMatchObject({ loading: "false", unreadable: "false", patient: "S-001", last: String(NOW) });
  });

  it("reads again when a new measurement reaches the board, and not on a render that changed nothing", async () => {
    const { api } = await start();
    act(() => setProps((p) => ({ ...p })));
    await flush();
    expect(api.patientTrends).toHaveBeenCalledTimes(1);
    act(() => setProps((p) => ({ ...p, measuredKey: "k2" })));
    await flush();
    expect(api.patientTrends).toHaveBeenCalledTimes(2);
  });

  it("reads once a minute while the page is visible, not while it is hidden, and at once on return", async () => {
    const { api } = await start();
    await act(async () => { await vi.advanceTimersByTimeAsync(TRENDS_POLL_MS); });
    expect(api.patientTrends).toHaveBeenCalledTimes(2);
    act(() => visibility("hidden"));
    await act(async () => { await vi.advanceTimersByTimeAsync(3 * TRENDS_POLL_MS); });
    expect(api.patientTrends).toHaveBeenCalledTimes(2);
    act(() => visibility("visible"));
    await flush();
    expect(api.patientTrends).toHaveBeenCalledTimes(3);
  });

  it("a failed read keeps the last answer and says when that answer came", async () => {
    const { api } = await start();
    api.patientTrends.mockImplementationOnce(() => Promise.reject(Object.assign(new Error("down"), { status: 503 })));
    await act(async () => { await vi.advanceTimersByTimeAsync(TRENDS_POLL_MS); });
    expect(probe()).toHaveTextContent("84");
    expect(probe().dataset).toMatchObject({ unreadable: "true", last: String(NOW) });
    api.patientTrends.mockImplementation(answering(withHr(90)));
    await act(async () => { await vi.advanceTimersByTimeAsync(TRENDS_POLL_MS); });
    expect(probe()).toHaveTextContent("90");
    expect(probe().dataset).toMatchObject({ unreadable: "false", last: String(NOW + 2 * TRENDS_POLL_MS) });
  });

  it("an answer that is not this patient's trends is no answer", async () => {
    for (const bad of [() => Promise.resolve(undefined), answering((_pid, h) => trends("S-002", [], { hours: h })),
      answering((pid) => trends(pid, [], { hours: 72 }))]) {
      await start({ answer: bad });
      expect(probe().dataset).toMatchObject({ loading: "false", unreadable: "true", patient: "" });
      cleanup();
      vi.useRealTimers();
    }
  });

  it("never shows another patient's answer: a move clears the screen, and a late answer is dropped", async () => {
    let late;
    const answer = (pid, hours) => (pid === "S-001"
      ? new Promise((resolve) => { late = () => resolve(withHr(84)(pid, hours)); })
      : Promise.resolve(withHr(70)(pid, hours)));
    await start({ answer });
    expect(probe().dataset.loading).toBe("true");
    act(() => setProps((p) => ({ ...p, id: "S-002" })));
    expect(probe().dataset).toMatchObject({ patient: "", loading: "true" });
    await flush();
    expect(probe().dataset.patient).toBe("S-002");
    await act(async () => { late(); });
    await flush();
    expect(probe().dataset.patient).toBe("S-002");
    expect(probe()).toHaveTextContent("70");
  });

  it("stops at the lock: nothing is read while locked, and an answer that lands after it is dropped", async () => {
    let late;
    const { api, store } = await start();
    api.patientTrends.mockImplementationOnce((pid, hours) => new Promise((resolve) => { late = () => resolve(withHr(99)(pid, hours)); }));
    await act(async () => { await vi.advanceTimersByTimeAsync(TRENDS_POLL_MS); });
    expect(api.patientTrends).toHaveBeenCalledTimes(2);
    act(() => { store.lock(); });
    await act(async () => { late(); });
    await flush();
    expect(probe()).toHaveTextContent("84");
    await act(async () => { await vi.advanceTimersByTimeAsync(3 * TRENDS_POLL_MS); });
    expect(api.patientTrends).toHaveBeenCalledTimes(2);
  });

  it("reload() reads now", async () => {
    const { api } = await start();
    fireEvent.click(screen.getByRole("button", { name: "again" }));
    await flush();
    expect(api.patientTrends).toHaveBeenCalledTimes(2);
  });
});

describe("measuredKeyOf", () => {
  it("changes exactly when one of the card's measured instants does", () => {
    expect(measuredKeyOf({ spo2: "2026-10-08T09:58:00Z", heart_rate: "2026-10-08T09:59:00Z", map: null }))
      .toBe(measuredKeyOf({ heart_rate: "2026-10-08T09:59:00Z", spo2: "2026-10-08T09:58:00Z" }));
    expect(measuredKeyOf({ heart_rate: "2026-10-08T09:59:00Z" })).not.toBe(measuredKeyOf({ heart_rate: "2026-10-08T10:00:00Z" }));
    expect(measuredKeyOf(undefined)).toBe("");
  });
});
```

(`localStorage.clear()` is not decoration: `store.lock()` writes `hmc.lock`, and the next test's session would restore LOCKED and read nothing — measured while this plan was written.)

- [ ] **Step 3: Run it — red.**

```bash
cd /c/tmp/g2-vital/dashboard
npx vitest run src/live/screens/patient/trends/useTrends.test.jsx 2>&1 | grep -E "Error|Test Files"
```
Expected: `Error: Failed to resolve import "./useTrends.js" from "src/live/screens/patient/trends/useTrends.test.jsx". Does the file exist?` and `Test Files  1 failed (1)`.

- [ ] **Step 4: The hook** — Write `dashboard/src/live/screens/patient/trends/useTrends.js`:

```js
// src/live/screens/patient/trends/useTrends.js — one patient's trends, read through the session
// (GET /patients/{id}/trends; homunculus-engine api/trends.py).
//
//   const { data, loading, unreadable, lastOkAt, reload } = useTrends(patientId, hours, measuredKey);
//
// Four rules, each held by useTrends.test.jsx:
//   * READ ONLY WHILE THE SESSION IS READY. A locked screen shows nothing of a patient, so nothing
//     is read for one; an answer that lands after the lock, a sign-out or another sign-in is dropped.
//     (The shell also unmounts at the lock, which clears the timers; this does not rely on it.)
//   * A FAILED READ KEEPS THE LAST ANSWER and says the trends are unreadable, with the time the last
//     answer came — the monitor strip's rule. A chart that went blank on one dropped request would
//     read as "no measurements", which is a claim about the patient, and a false one.
//   * NEVER ANOTHER PATIENT'S ANSWER. A move to another patient or window shows nothing until that
//     one answers, and a late answer for the one left behind is dropped.
//   * READ AGAIN when the board says something was measured (`measuredKey`), and once a minute while
//     the page is visible — an antibiotic charted elsewhere moves no `measuredAt`.
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../../session/SessionProvider.jsx";
import { PHASE } from "../../../session/sessionStore.js";

export const TRENDS_POLL_MS = 60_000;

const NOTHING = Object.freeze({ data: null, loading: true, unreadable: false, lastOkAt: null });

/** A string that changes exactly when one of the patient card's measured instants does. */
export function measuredKeyOf(measuredAt) {
  return Object.entries(measuredAt ?? {})
    .filter(([, at]) => typeof at === "string" && at !== "")
    .map(([key, at]) => `${key}=${at}`)
    .sort()
    .join("|");
}

/** This patient's trends for this window — or not an answer at all. */
const isTrends = (answer, patientId, hours) => Boolean(answer) && typeof answer === "object"
  && answer.patient_id === patientId && answer.hours === hours && Array.isArray(answer.channels);

const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

export function useTrends(patientId, hours, measuredKey = "") {
  const { phase, store } = useSession();
  const ready = phase === PHASE.READY;
  const key = `${patientId}|${hours}`;
  const [state, setState] = useState({ ...NOTHING, key });
  const seq = useRef(0);

  const read = useCallback(async () => {
    seq.current += 1;
    const mine = seq.current;
    const epoch = store.epoch();
    const stale = () => mine !== seq.current || epoch !== store.epoch();
    try {
      const answer = await store.track(() => store.api.patientTrends(patientId, hours));
      if (stale()) return;
      if (!isTrends(answer, patientId, hours)) throw new Error("not a trends answer");
      setState({ data: answer, loading: false, unreadable: false, lastOkAt: Date.now(), key });
    } catch (err) {
      if (stale() || err?.superseded) return;
      setState((s) => (s.key === key ? { ...s, loading: false, unreadable: true }
        : { ...NOTHING, loading: false, unreadable: true, key }));
    }
  }, [store, patientId, hours, key]);

  // Mount, a new patient or window, a new measurement: read. Leaving READY: whatever is in flight
  // will not land.
  useEffect(() => {
    if (!ready) {
      seq.current += 1;
      return;
    }
    read();
  }, [ready, read, measuredKey]);

  // Once a minute while visible, and at once when the page comes back.
  useEffect(() => {
    if (!ready) return undefined;
    let timer = 0;
    const tick = () => {
      if (!hidden()) read();
      timer = setTimeout(tick, TRENDS_POLL_MS);
    };
    const wake = () => {
      if (!hidden()) read();
    };
    timer = setTimeout(tick, TRENDS_POLL_MS);
    document.addEventListener("visibilitychange", wake);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [ready, read]);

  // Gone: nothing late may land.
  useEffect(() => () => { seq.current += 1; }, []);

  const shown = state.key === key ? state : { ...NOTHING, key };
  return { data: shown.data, loading: shown.loading, unreadable: shown.unreadable, lastOkAt: shown.lastOkAt, reload: read };
}
```

- [ ] **Step 5: Green.** `npx vitest run src/live/screens/patient/trends/useTrends.test.jsx 2>&1 | grep -E "Tests "` → `Tests  9 passed (9)`.

- [ ] **Step 6: The screen's tests — red.** Four Edits in `dashboard/src/live/screens/patient/PatientScreen.test.jsx`.

(a) Replace:

```jsx
import { STAGE_OFF, bed as monitorBed, param as monitorParam, strip } from "../../data/shadow.testutil.js";
import { PatientScreen } from "./PatientScreen.jsx";
```

with:

```jsx
import { STAGE_OFF, bed as monitorBed, param as monitorParam, strip } from "../../data/shadow.testutil.js";
import { answering } from "./trends/trends.testutil.js";
import { PatientScreen } from "./PatientScreen.jsx";
```

(b) Replace (in `open()`):

```jsx
      api.streamTicket.mockResolvedValue({ ticket: "t-1" });
      api.view.mockResolvedValue({ ok: true });
      setup?.(api);
```

with:

```jsx
      api.streamTicket.mockResolvedValue({ ticket: "t-1" });
      api.view.mockResolvedValue({ ok: true });
      api.patientTrends.mockImplementation(answering());     // empty channels, for whoever is asked
      setup?.(api);
```

(c) Replace:

```jsx
  it("names the bed and the patient, and says the one thing it writes", async () => {
```

with:

```jsx
  it("names the bed and the patient, and says the two things it writes", async () => {
```

and, in the same test, replace:

```jsx
    expect(screen.getByText(/heç nə yazılmır/)).toBeInTheDocument();
  });
```

with:

```jsx
    expect(screen.getByText(/heç nə yazılmır/)).toHaveTextContent(/şübhəli infeksiya işarəsi və xəstənin norması/);
  });
```

(d) Replace the seams describe:

```jsx
  describe("the seams Group 2 fills", () => {
    it("draws no trend, and says the engine has no history endpoint", async () => {
      await open({ payload: board([entry("S-001", [], FULL)]) });
      expect(screen.getByText(/Brauzer öz qrafikini uydurmur/)).toBeInTheDocument();
      expect(screen.getByText(/növbəti qrupda əlavə olunacaq/)).toBeInTheDocument();
    });
  });
```

with:

```jsx
  describe("the trend charts (Group 2 · slice 1)", () => {
    it("stand where the placeholder stood, after the Sepsis and medication row", async () => {
      await open({ payload: board([entry("S-001", [], FULL)]) });
      const trends = screen.getByRole("heading", { level: 2, name: "Vital qrafikləri" });
      const meds = screen.getByRole("heading", { level: 2, name: /Dərman/ });
      expect(meds.compareDocumentPosition(trends) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.queryByText(/Brauzer öz qrafikini uydurmur/)).toBeNull();
      expect(document.querySelector("[data-trends-box]")).not.toBeNull();
    });

    it("keep the forms seam as one note, which no longer promises the patient's normal", async () => {
      await open({ payload: board([entry("S-001", [], FULL)]) });
      const seam = screen.getByText(/növbəti qrupda əlavə olunacaq/).closest("[role='note']");
      expect(seam).not.toBeNull();
      expect(seam).toHaveTextContent(/SOFA/);
      expect(seam).not.toHaveTextContent(/norma/);
    });

    it("read the 24-hour trends of the patient the screen shows", async () => {
      const { api } = await open({ payload: board([entry("S-001", [], FULL)]) });
      expect(api.patientTrends).toHaveBeenCalledWith("S-001", 24);
    });

    it("read nothing for a patient the board does not hold", async () => {
      const { api } = await open({ payload: board([entry("S-001", [], FULL)]), id: "S-999" });
      expect(api.patientTrends).not.toHaveBeenCalled();
    });

    it("say they cannot be read, and since when, without raising an alert", async () => {
      await open({
        payload: board([entry("S-001", [], FULL)]),
        setup: (api) => api.patientTrends.mockRejectedValue(Object.assign(new Error("down"), { status: 503 })),
      });
      expect(screen.getByText("Vital qrafikləri oxunmur (son: —)")).toBeInTheDocument();
      expect(screen.queryAllByRole("alert").map((a) => a.textContent).join(" ")).not.toMatch(/Vital qrafikləri/);
    });
  });
```

Run `npx vitest run src/live/screens/patient/PatientScreen.test.jsx 2>&1 | grep -E "×|Tests "`. Expected: `Tests  4 failed | 50 passed (54)` — "stand where…" (the placeholder's text is still there), "keep the forms seam…" (no note), "read the 24-hour trends…" (nothing reads), "say they cannot be read…".

- [ ] **Step 7: The box** — Write `dashboard/src/live/screens/patient/trends/TrendsBox.jsx`:

```jsx
// src/live/screens/patient/trends/TrendsBox.jsx — the patient's vital trends (Group 2 · slice 1),
// where the dashed "Vital eğrileri" placeholder stood.
//
// THE BROWSER DRAWS; IT NEVER SCORES. Every fact this box shows about a value — its NEWS2 points,
// the band it sits in, whether it is inside the patient's charted normal, how it moved — is the
// engine's (GET /patients/{id}/trends, homunculus-engine api/trends.py), printed or drawn as it
// came. Nothing here or below it computes a band, a threshold, a delta or a point.
//
// It never says less than it knows: an unreadable read keeps the last answer on screen and says so
// in the header, with the time that answer came (the monitor strip's rule), and it is a plain line,
// not an alert — nothing the clinician did was refused.
import React from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { hhmm } from "../../../i18n/dates.js";
import { Box } from "../../../ui/index.js";
import { measuredKeyOf, useTrends } from "./useTrends.js";

export function TrendsBox({ patient }) {
  const { t } = useI18n();
  const trends = useTrends(patient.patient_id, 24, measuredKeyOf(patient.measuredAt));
  return (
    <Box title={t("patient.trends")} icon="chart" level={2} right={t("patient.trendsNote")}>
      <div data-trends-box="">
        {trends.unreadable ? (
          <p className="m-0 mb-2 text-12 font-semibold text-att-ink">
            {t("patient.trendsUnreadable", { time: trends.lastOkAt ? hhmm(trends.lastOkAt) : "—" })}
          </p>
        ) : null}
        {trends.loading ? <p className="m-0 text-12.5 text-mute">{t("patient.trendsLoading")}</p> : null}
      </div>
    </Box>
  );
}
```

- [ ] **Step 8: Wire it in.** Four Edits in `dashboard/src/live/screens/patient/PatientScreen.jsx`.

(a) Replace the header's first lines:

```jsx
// src/live/screens/patient/PatientScreen.jsx — one patient, as the engine describes them (G1-11).
// It writes EXACTLY ONE thing (Task 15B, Decision 27): whether an infection is suspected. Nothing
// else here reaches the record, and the screen says so in as many words (`patient.onlyWrite`).
```

with:

```jsx
// src/live/screens/patient/PatientScreen.jsx — one patient, as the engine describes them (G1-11).
// It writes TWO things, and says so in as many words (`patient.onlyWrite`): whether an infection is
// suspected (Task 15B, Decision 27), and — since Group 2 · slice 1, from the trends box, for a
// `clinical.chart` holder — the patient's own normal ranges. Nothing else here reaches the record.
```

(b) Replace:

```jsx
// It refuses to draw a trend. The engine has no endpoint for a vital's history, and the browser
// drawing one from the single latest value — as the prototype does, from a seeded random
// generator — would be a picture of nothing. The seam is stated in one box, for Group 2.
```

with:

```jsx
// The trends are the engine's (`trends/TrendsBox.jsx`, GET /patients/{id}/trends): the prototype
// drew a curve from the single latest value and a seeded random generator, a picture of nothing.
// The box draws the measurements the engine holds and the bands it scores with, and nothing else.
```

(c) Replace:

```jsx
import { maxAgeOf } from "../common/monitor.js";
```

with:

```jsx
import { maxAgeOf } from "../common/monitor.js";
import { TrendsBox } from "./trends/TrendsBox.jsx";
```

(d) Replace:

```jsx
          <div className="grid gap-2 min-[861px]:grid-cols-2">
            <Sepsis sepsis={patient.sepsis} canChart={canChart} onChart={chart} pending={charting} />
            <Meds meds={patient.meds} />
          </div>

          {/* The seams. Both say what is missing on the SERVER, not what nobody got round to. */}
          <Box title={t("patient.trends")} icon="chart" level={2} className="!border-dashed">
            <p className="m-0 text-12.5 text-mute">{t("patient.trendsSoon")}</p>
            <p className="m-0 mt-1.5 text-12.5 text-mute">{t("patient.formsSoon")}</p>
          </Box>
```

with:

```jsx
          <div className="grid gap-2 min-[861px]:grid-cols-2">
            <Sepsis sepsis={patient.sepsis} canChart={canChart} onChart={chart} pending={charting} />
            <Meds meds={patient.meds} />
          </div>
          {/* The one seam left: the SOFA form is Group 3's, and the screen says so where it will go. */}
          <Note tone="info" icon="clock">{t("patient.formsSoon")}</Note>

          <TrendsBox patient={patient} />
```

Then remove `trendsSoon` from `dashboard/src/live/i18n/strings/patient.js`, four Edits — each replaces the whole line, its line break included, with nothing:

```js
    trendsSoon: "Vital eğrileri Grup 2'de gelecek: motorda vital geçmişi için bir uç nokta henüz yok, pano yalnız son ölçümü gönderiyor. Tarayıcı kendi eğrisini uydurmaz.",
```
```js
    trendsSoon: "Vital qrafikləri Qrup 2-də gələcək: mühərrikdə vital tarixçəsi üçün uç nöqtə hələ yoxdur, panel yalnız son ölçməni göndərir. Brauzer öz qrafikini uydurmur.",
```
```js
    trendsSoon: "Графики показателей появятся в Группе 2: в системе пока нет конечной точки для истории показателей, панель передаёт только последнее измерение. Браузер свою кривую не выдумывает.",
```
```js
    trendsSoon: "Vital trends come with Group 2: the engine has no endpoint for a vital's history yet, and the board sends the latest measurement only. The browser does not invent a curve of its own.",
```

- [ ] **Step 9: Green, then the gate.**

```bash
cd /c/tmp/g2-vital/dashboard
npx vitest run src/live/screens/patient/ src/reachable.test.js src/live/boundaries.test.js src/live/rawKeys.test.jsx src/live/i18n/ 2>&1 | grep -E "Test Files|Tests |×"
```
Expected: no `×`; `PatientScreen.test.jsx` 54, `useTrends.test.jsx` 9 (`reachable.test.js` passes because PatientScreen imports the box, which imports the hook). Then the suite — **82 / 1967** — and the build.

- [ ] **Step 10: Commit.**

```bash
cd /c/tmp/g2-vital
git add dashboard/src/live/screens/patient/trends/trends.testutil.js dashboard/src/live/screens/patient/trends/useTrends.js dashboard/src/live/screens/patient/trends/useTrends.test.jsx dashboard/src/live/screens/patient/trends/TrendsBox.jsx dashboard/src/live/screens/patient/PatientScreen.jsx dashboard/src/live/screens/patient/PatientScreen.test.jsx dashboard/src/live/i18n/strings/patient.js
git status --short && git diff --cached --stat
git commit -m "feat(patient): the trends box where the placeholder stood, and the read behind it" -m "useTrends reads GET /patients/{id}/trends through the session's track: on mount, on a new patient or window (cleared first), on a new measurement (measuredKeyOf), every 60 s while READY and visible; nothing while locked, nothing late after a lock, a sign-out or an unmount; a failed read keeps the last answer and says since when. The forms seam keeps its sentence as a Note; trendsSoon goes.

red: useTrends — Failed to resolve import ./useTrends.js; PatientScreen 4 failed" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: The six cards — the engine's facts, printed and judged by nobody here

Spec §3.1 and D2, D3 with X7. `news2Tone(points)` is the ONE mapping from the engine's points to a tone (0 → none, 1–2 → `mid`, 3 → `crit`), shared by the card's frame here and the chart's bands in Task 11. `cards.js` lists the six cards in the bed card's order — pulse, respiration, SpO₂, systolic + MAP, temperature, lactate — with names, units and identity colours from `vitals.js`. A card prints each channel's latest value in its identity colour, the engine's delta with an arrow for its sign ("↑ +6", "↓ −3", "→ 0") or "tek ölçüm" when there was no previous one, and its age against the screen's `useBoardNow` instant; it is framed and badged ("NEWS2 +3") from the first channel's `news2_points` (systolic on the pressure card); the own-normal pill shows when `within_own_normal === true`, beside the frame. `ageText` moves out of PatientScreen.jsx so the two say an age the same way.

**Files:**
- Create: `dashboard/src/live/screens/patient/ageText.js`, `trends/news2Tone.js`, `trends/news2Tone.test.js`, `trends/cards.js`, `trends/TrendCard.jsx`, `trends/TrendCard.test.jsx`
- Modify: `trends/TrendsBox.jsx` (Write, whole), `PatientScreen.jsx`, `PatientScreen.test.jsx`

- [ ] **Step 1: The tone's test** — Write `dashboard/src/live/screens/patient/trends/news2Tone.test.js`:

```js
import { describe, it, expect } from "vitest";
import { news2Tone } from "./news2Tone.js";

describe("news2Tone — the engine's points, as a tone (spec D2)", () => {
  it("0 is no tone, 1–2 amber, 3 red", () => {
    expect([0, 1, 2, 3].map(news2Tone)).toEqual([null, "mid", "mid", "crit"]);
  });

  it("is no tone for anything the engine did not send as points", () => {
    for (const nothing of [null, undefined, "3", Number.NaN, -1, Infinity]) expect(news2Tone(nothing), String(nothing)).toBeNull();
  });
});
```

Run it: `npx vitest run src/live/screens/patient/trends/news2Tone.test.js 2>&1 | grep -E "Error"` → `Error: Failed to resolve import "./news2Tone.js" …`.

- [ ] **Step 2: The tone** — Write `dashboard/src/live/screens/patient/trends/news2Tone.js`:

```js
// src/live/screens/patient/trends/news2Tone.js — the ONE mapping from the engine's NEWS2 points for
// one parameter to the tone it is drawn in, on a card's frame and on a chart's band (spec D2):
// 0 → none, 1–2 → amber ("mid"), 3 → red ("crit").
//
// The points are the SERVER's (homunculus-engine api/trends.py: `latest.news2_points`, a band's
// `points`); nothing here looks at a value. One copy, with its test, for the reason `pillRisk` has
// one: a card framed red above a band drawn amber is two answers to one question on one screen.
// Anything that is not a number of at least 1 — MAP and lactate have no points — is no tone.
export function news2Tone(points) {
  if (typeof points !== "number" || !Number.isFinite(points) || points < 1) return null;
  return points >= 3 ? "crit" : "mid";
}
```

`npx vitest run src/live/screens/patient/trends/news2Tone.test.js 2>&1 | grep -E "Tests "` → `Tests  2 passed (2)`. (Unreachable until Step 6 imports it through the card — do not run the suite in between.)

- [ ] **Step 3: The card's test** — Write `dashboard/src/live/screens/patient/trends/TrendCard.test.jsx`:

```jsx
// The trend card prints the engine's facts and judges none of them. Every test here hands the card a
// fact that CONTRADICTS what the browser could have worked out for itself — points of 3 on a value
// that looks normal, a delta that is not the difference of the points drawn — and asserts the card
// shows the engine's, which is the only way to prove a browser did not judge.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "../../../i18n/I18nProvider.jsx";
import { NOW, ago } from "../../../data/board.testutil.js";
import { CARDS, channelsOf } from "./cards.js";
import { TrendCard, deltaText } from "./TrendCard.jsx";
import { channel, point, trends } from "./trends.testutil.js";

const HR = CARDS.find((c) => c.id === "heart_rate");
const PRESSURE = CARDS.find((c) => c.id === "pressure");
const LACTATE = CARDS.find((c) => c.id === "lactate");

function show(card, channels, { onOpen } = {}) {
  render(
    <I18nProvider>
      <ul><TrendCard card={card} channels={channelsOf(trends("S-001", channels))} nowMs={NOW} onOpen={onOpen} /></ul>
    </I18nProvider>,
  );
  return document.querySelector("[data-frame]");
}

const latest = (over) => ({ ts: ago(300), value: 72, delta: null, news2_points: 0, within_own_normal: null, ...over });

describe("the trend card", () => {
  it("frames red and says NEWS2 +3 from the engine's points — for a value the browser would call normal", () => {
    const card = show(HR, [channel("heart_rate", [point(5, 72, 3)], { latest: latest({ news2_points: 3 }) })]);
    expect(card.dataset.frame).toBe("crit");
    expect(card).toHaveClass("border-crit");
    expect(screen.getByText("NEWS2 +3")).toBeInTheDocument();
  });

  it("frames amber for 1–2 points and not at all for 0", () => {
    const amber = show(HR, [channel("heart_rate", [point(5, 72, 2)], { latest: latest({ news2_points: 2 }) })]);
    expect(amber.dataset.frame).toBe("mid");
    expect(screen.getByText("NEWS2 +2")).toBeInTheDocument();
    document.body.innerHTML = "";
    const calm = show(HR, [channel("heart_rate", [point(5, 132, 0)], { latest: latest({ value: 132, news2_points: 0 }) })]);
    expect(calm.dataset.frame).toBe("none");
    expect(screen.queryByText(/NEWS2 \+/)).toBeNull();
  });

  it("frames nothing on a channel the engine gives no points (lactate, MAP)", () => {
    const card = show(LACTATE, [channel("lactate", [point(5, 9.9)], { latest: latest({ value: 9.9, news2_points: null }) })]);
    expect(card.dataset.frame).toBe("none");
    expect(screen.queryByText(/NEWS2/)).toBeNull();
  });

  it("shows the own-normal pill from the engine's verdict, beside the frame and not instead of it", () => {
    const card = show(HR, [channel("heart_rate", [point(5, 108, 1)],
      { latest: latest({ value: 108, news2_points: 1, within_own_normal: true }) })]);
    expect(screen.getByText("Xəstənin normasında")).toBeInTheDocument();
    expect(card.dataset.frame).toBe("mid");
    document.body.innerHTML = "";
    show(HR, [channel("heart_rate", [point(5, 108, 1)], { latest: latest({ value: 108, within_own_normal: false }) })]);
    expect(screen.queryByText("Xəstənin normasında")).toBeNull();
  });

  it("prints the engine's delta — not the difference of the points it was given", () => {
    show(HR, [channel("heart_rate", [point(60, 84, 0), point(5, 90, 0)], { latest: latest({ value: 90, delta: 2 }) })]);
    expect(screen.getByText("↑ +2 (əvvəlkinə görə)")).toBeInTheDocument();
    expect(screen.queryByText(/\+6/)).toBeNull();
  });

  it("says when there was no previous measurement, and when there is none at all", () => {
    show(HR, [channel("heart_rate", [point(5, 84, 0)])]);
    expect(screen.getByText("tək ölçmə")).toBeInTheDocument();
    document.body.innerHTML = "";
    show(HR, []);
    expect(screen.getByText("Bu kanal üçün ölçmə yoxdur")).toBeInTheDocument();
  });

  it("says how long ago, against the clock it is handed", () => {
    show(HR, [channel("heart_rate", [point(5, 84, 0)])]);
    expect(screen.getByText("5 dəq əvvəl")).toBeInTheDocument();
  });

  it("puts systolic and MAP on one card, each named, framed by systolic's points", () => {
    const card = show(PRESSURE, [
      channel("sbp", [point(5, 88, 3)], { latest: latest({ value: 88, news2_points: 3 }) }),
      channel("map", [point(5, 58)], { latest: latest({ value: 58, news2_points: null }) }),
    ]);
    expect(card.dataset.frame).toBe("crit");
    expect(card.querySelector("[data-series='sbp']")).toHaveTextContent(/Sistolik AT\s*88/);
    expect(card.querySelector("[data-series='map']")).toHaveTextContent(/MAP\s*58/);
  });

  it("is a button naming the chart it opens only when it can open one", () => {
    show(HR, [channel("heart_rate", [point(5, 84, 0)])]);
    expect(screen.queryByRole("button")).toBeNull();
    document.body.innerHTML = "";
    const onOpen = vi.fn();
    show(HR, [channel("heart_rate", [point(5, 84, 0)])], { onOpen });
    fireEvent.click(screen.getByRole("button", { name: /Nəbz: böyük qrafiki aç/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe("deltaText", () => {
  it("writes the engine's number with an arrow for its sign, and nothing for no number", () => {
    expect([6, -3, 0, 0.3].map(deltaText)).toEqual(["↑ +6", "↓ −3", "→ 0", "↑ +0.3"]);
    expect([null, undefined, Number.NaN].map(deltaText)).toEqual([null, null, null]);
  });
});
```

Run it: `… grep -E "Error"` → `Error: Failed to resolve import "./cards.js" …` (red).

- [ ] **Step 4: The cards' table and the shared age.** Write `dashboard/src/live/screens/patient/trends/cards.js`:

```js
// src/live/screens/patient/trends/cards.js — the six trend cards and the channels each one draws.
//
// Names, units and identity colours are the bed card's own (`../../common/vitals.js`), so a channel
// is called the same thing on every screen. Systolic and MAP share one card: one chart, two series,
// told apart by label and by the dot — MAP's is hollow — and never by colour alone (they share
// `--v-map`, vitals.js says why).
import { VITALS } from "../../common/vitals.js";

const META = Object.fromEntries(VITALS.map((v) => [v.at, v]));

const series = (key, hollow = false) => Object.freeze({
  key, labelKey: META[key].labelKey, unitKey: META[key].unitKey, color: META[key].color, hollow,
});

export const CARDS = Object.freeze([
  Object.freeze({ id: "heart_rate", series: Object.freeze([series("heart_rate")]) }),
  Object.freeze({ id: "resp_rate", series: Object.freeze([series("resp_rate")]) }),
  Object.freeze({ id: "spo2", series: Object.freeze([series("spo2")]) }),
  Object.freeze({ id: "pressure", series: Object.freeze([series("sbp"), series("map", true)]) }),
  Object.freeze({ id: "temperature", series: Object.freeze([series("temperature")]) }),
  Object.freeze({ id: "lactate", series: Object.freeze([series("lactate")]) }),
]);

/** A card's title: its channels' names, in its order. */
export const cardTitle = (t, card) => card.series.map((s) => t(s.labelKey)).join(" · ");

/** An answer's channels by key; empty before there is an answer. */
export const channelsOf = (data) => Object.fromEntries((data?.channels ?? []).map((c) => [c.key, c]));
```

Write `dashboard/src/live/screens/patient/ageText.js`:

```js
// src/live/screens/patient/ageText.js — how old a value is, in the reader's own language: "3 dk önce".
// The number and the unit stay apart, so neither ends up inside a word that would need a suffix
// fitted to it. Shared by the measured-values box and the trend cards, so the two never word one
// age two ways. The instant it ages against is the caller's `useBoardNow` (the server's clock).
import { ageOf } from "../common/freshness.js";
import { ageParts } from "../common/feedHealth.js";

export function ageText(t, iso, nowMs) {
  const ms = ageOf(iso, nowMs);
  if (ms === null) return null;
  const parts = ageParts(ms / 1000);
  const key = parts.unit === "s" ? "board.ageS" : parts.unit === "m" ? "board.ageM" : "board.ageH";
  return t("patient.vitalAge", { age: t(key, { count: parts.value }) });
}
```

(The one difference from PatientScreen.jsx's copy: no instant → `null` up front. The old one computed `ageParts(NaN)` = "NaN sa" and relied on its caller not printing it.)

- [ ] **Step 5: The card** — Write `dashboard/src/live/screens/patient/trends/TrendCard.jsx`:

```jsx
// src/live/screens/patient/trends/TrendCard.jsx — one trend card: the latest value of each of its
// channels, how it moved since the previous measurement, how long ago, and (Task 11) a 24-hour mini
// chart.
//
// The frame and its badge are the ENGINE'S NEWS2 points for the latest value (spec D2), through
// `news2Tone` — never a judgement made here: a card handed `news2_points: 3` frames red whatever the
// number reads. The pill is the engine's `within_own_normal` (D3): it never silences the frame and
// the frame never hides it. The delta is the engine's, printed with an arrow for its sign.
//
// A button only when it can open the big chart (`onOpen`).
import React from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { Pill, Tag } from "../../../ui/index.js";
import { FOCUS_RING } from "../../../ui/focus.js";
import { ageText } from "../ageText.js";
import { cardTitle } from "./cards.js";
import { news2Tone } from "./news2Tone.js";

const FRAME = { none: "border border-line", mid: "border-2 border-mid", crit: "border-2 border-crit" };
const BADGE = { mid: "warn", crit: "crit" };

/** The engine's delta as the card prints it: "↑ +6", "↓ −3", "→ 0"; null for no number. */
export function deltaText(delta) {
  if (typeof delta !== "number" || !Number.isFinite(delta)) return null;
  if (delta > 0) return `↑ +${delta}`;
  if (delta < 0) return `↓ −${Math.abs(delta)}`;
  return "→ 0";
}

function Reading({ series, channel, nowMs, named }) {
  const { t } = useI18n();
  const latest = channel?.latest ?? null;
  if (!latest) return null;
  const delta = deltaText(latest.delta);
  const age = ageText(t, latest.ts, nowMs);
  return (
    <span className="mt-1 block" data-series={series.key}>
      {named ? <span className="mr-1.5 text-11 font-semibold text-mute">{t(series.labelKey)}</span> : null}
      <b className={`font-data text-20 font-bold ${series.color}`}>{latest.value}</b>
      <small className="ml-1 text-11 font-semibold text-mute">{t(series.unitKey)}</small>
      <span className="ml-2 font-data text-12 font-semibold text-ink">
        {delta ? t("patient.trendsDelta", { delta }) : t("patient.trendsSingle")}
      </span>
      {age ? <span className="ml-2 text-11 text-mute">{age}</span> : null}
    </span>
  );
}

export function TrendCard({ card, channels, nowMs, onOpen }) {
  const { t } = useI18n();
  const primary = channels?.[card.series[0].key] ?? null;
  const points = primary?.latest?.news2_points ?? null;
  const tone = news2Tone(points);
  const measured = card.series.some((s) => channels?.[s.key]?.latest);
  const title = cardTitle(t, card);
  const Wrapper = onOpen ? "button" : "div";
  return (
    <li className="min-w-0">
      <Wrapper
        type={onOpen ? "button" : undefined}
        onClick={onOpen}
        data-frame={tone ?? "none"}
        className={`block w-full min-w-0 rounded-box bg-card px-3 py-2.5 text-left ${FRAME[tone ?? "none"]} ${onOpen ? FOCUS_RING : ""}`}
      >
        <span className="flex flex-wrap items-center gap-1.5">
          <span className={`text-10.5 font-bold uppercase leading-[normal] tracking-[.06em] ${card.series[0].color}`}>{title}</span>
          {tone ? <Tag tone={BADGE[tone]}>{t("patient.trendsFrameBadge", { points })}</Tag> : null}
          {primary?.latest?.within_own_normal === true ? <Pill icon="user">{t("patient.trendsOwnNormalPill")}</Pill> : null}
        </span>
        {measured ? (
          card.series.map((s) => (
            <Reading key={s.key} series={s} channel={channels?.[s.key]} nowMs={nowMs} named={card.series.length > 1} />
          ))
        ) : (
          <span className="mt-1 block text-12.5 text-mute">{t("patient.trendsNoData")}</span>
        )}
        {onOpen ? <span className="sr-only">{t("patient.trendsOpen", { channel: title })}</span> : null}
      </Wrapper>
    </li>
  );
}
```

`npx vitest run src/live/screens/patient/trends/TrendCard.test.jsx 2>&1 | grep -E "Tests "` → `Tests  10 passed (10)`.

- [ ] **Step 6: The screen's tests — red while the box lists nothing.** Edit `PatientScreen.test.jsx` four times.

(a) Replace `import { answering } from "./trends/trends.testutil.js";` with:

```jsx
import { answering, channel, point, trends } from "./trends/trends.testutil.js";
```

(b) The trend cards will name the same channels as the measured-values box, so its tests must read that box only. Replace:

```jsx
  describe("the measured values", () => {
    it("shows each channel with its value, its unit, its clock time and its age", async () => {
      await open({ payload: board([entry("S-001", [], FULL)]) });
      expect(screen.getByText("118")).toBeInTheDocument();
      expect(screen.getByText("Nəbz")).toBeInTheDocument();
      // Every vital's age is visible — the gap the old workspace never closed.
      expect(screen.getAllByText(/2 dəq əvvəl/).length).toBeGreaterThan(0);
    });

    it("a channel with no value is left out, and a card with none says so once", async () => {
      await open({ payload: board([entry("S-001", [], { identity: identity() })]) });
      expect(screen.getByText("Bu çarpayıdan heç bir ölçmə gəlməyib.")).toBeInTheDocument();
      expect(screen.queryByText("Nəbz")).toBeNull();
    });
```

with:

```jsx
  describe("the measured values", () => {
    // The trend cards below name the same channels, so these read the measured-values box only.
    const vitalsBox = () => within(screen.getByRole("heading", { level: 2, name: "Ölçülən dəyərlər" }).closest(".rounded-box"));

    it("shows each channel with its value, its unit, its clock time and its age", async () => {
      await open({ payload: board([entry("S-001", [], FULL)]) });
      expect(vitalsBox().getByText("118")).toBeInTheDocument();
      expect(vitalsBox().getByText("Nəbz")).toBeInTheDocument();
      // Every vital's age is visible — the gap the old workspace never closed.
      expect(vitalsBox().getAllByText(/2 dəq əvvəl/).length).toBeGreaterThan(0);
    });

    it("a channel with no value is left out, and a card with none says so once", async () => {
      await open({ payload: board([entry("S-001", [], { identity: identity() })]) });
      expect(vitalsBox().getByText("Bu çarpayıdan heç bir ölçmə gəlməyib.")).toBeInTheDocument();
      expect(vitalsBox().queryByText("Nəbz")).toBeNull();
    });
```

(c) Replace:

```jsx
    it("a lactate is shown with the monitor channels — septic shock turns on it", async () => {
      await open({ payload: board([entry("S-001", [], FULL)]) });
      expect(screen.getByText("4.1")).toBeInTheDocument();
      expect(screen.getByText("Laktat")).toBeInTheDocument();
    });
```

with:

```jsx
    it("a lactate is shown with the monitor channels — septic shock turns on it", async () => {
      await open({ payload: board([entry("S-001", [], FULL)]) });
      expect(vitalsBox().getByText("4.1")).toBeInTheDocument();
      expect(vitalsBox().getByText("Laktat")).toBeInTheDocument();
    });
```

(d) Replace:

```jsx
    it("read nothing for a patient the board does not hold", async () => {
      const { api } = await open({ payload: board([entry("S-001", [], FULL)]), id: "S-999" });
      expect(api.patientTrends).not.toHaveBeenCalled();
    });
```

with:

```jsx
    it("read nothing for a patient the board does not hold", async () => {
      const { api } = await open({ payload: board([entry("S-001", [], FULL)]), id: "S-999" });
      expect(api.patientTrends).not.toHaveBeenCalled();
    });

    it("show six cards, in the bed card's channel order, one list", async () => {
      await open({ payload: board([entry("S-001", [], FULL)]) });
      const list = document.querySelector("[data-trends-box] ul");
      expect([...list.children].map((li) => li.querySelector("[data-frame] span span").textContent))
        .toEqual(["Nəbz", "Tənəffüs", "SpO2", "Sistolik AT · MAP", "Bədən hərarəti", "Laktat"]);
    });

    it("frame a card from the engine's points, and age its value against the server's clock", async () => {
      await open({
        payload: board([entry("S-001", [], FULL)]),
        setup: (api) => api.patientTrends.mockImplementation(answering((pid, hours) =>
          trends(pid, [channel("heart_rate", [point(4, 72, 3)])], { hours }))),
      });
      const hr = document.querySelector("[data-trends-box] li [data-frame]");
      expect(hr.dataset.frame).toBe("crit");
      expect(hr).toHaveTextContent("NEWS2 +3");
      expect(hr).toHaveTextContent("4 dəq əvvəl");
    });
```

Run it: `npx vitest run src/live/screens/patient/PatientScreen.test.jsx 2>&1 | grep -E "Tests "` → `Tests  2 failed | 54 passed (56)` — the two new tests (the box holds no list yet). (b) and (c) pass now and keep passing once the cards render; without them three measured-values tests would fail then with `Found multiple elements with the text: Nəbz` / `Laktat` — measured while this plan was written.

- [ ] **Step 7: The box lists the cards** — Write `dashboard/src/live/screens/patient/trends/TrendsBox.jsx` (whole, replacing Task 9's):

```jsx
// src/live/screens/patient/trends/TrendsBox.jsx — the patient's vital trends (Group 2 · slice 1),
// where the dashed "Vital eğrileri" placeholder stood.
//
// THE BROWSER DRAWS; IT NEVER SCORES. Every fact this box shows about a value — its NEWS2 points,
// the band it sits in, whether it is inside the patient's charted normal, how it moved — is the
// engine's (GET /patients/{id}/trends, homunculus-engine api/trends.py), printed or drawn as it
// came. Nothing here or below it computes a band, a threshold, a delta or a point.
//
// It never says less than it knows: an unreadable read keeps the last answer on screen and says so
// in the header, with the time that answer came (the monitor strip's rule), and it is a plain line,
// not an alert — nothing the clinician did was refused.
import React from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { hhmm } from "../../../i18n/dates.js";
import { Box } from "../../../ui/index.js";
import { CARDS, channelsOf } from "./cards.js";
import { TrendCard } from "./TrendCard.jsx";
import { measuredKeyOf, useTrends } from "./useTrends.js";

export function TrendsBox({ patient, nowMs }) {
  const { t } = useI18n();
  const trends = useTrends(patient.patient_id, 24, measuredKeyOf(patient.measuredAt));
  const channels = channelsOf(trends.data);
  return (
    <Box title={t("patient.trends")} icon="chart" level={2} right={t("patient.trendsNote")}>
      <div data-trends-box="">
        {trends.unreadable ? (
          <p className="m-0 mb-2 text-12 font-semibold text-att-ink">
            {t("patient.trendsUnreadable", { time: trends.lastOkAt ? hhmm(trends.lastOkAt) : "—" })}
          </p>
        ) : null}
        {trends.loading ? <p className="m-0 text-12.5 text-mute">{t("patient.trendsLoading")}</p> : null}
        {trends.data ? (
          <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 min-[861px]:grid-cols-2 min-[1200px]:grid-cols-3">
            {CARDS.map((card) => (
              <TrendCard key={card.id} card={card} channels={channels} nowMs={nowMs} />
            ))}
          </ul>
        ) : null}
      </div>
    </Box>
  );
}
```

(One column at 390 px, two from 861 px, three from 1200 px — spec §3.1. Each `<li>` and card is `min-w-0`, so a long value never widens the grid.)

- [ ] **Step 8: The screen hands its clock down, and its age helper moves out.** Three Edits in `dashboard/src/live/screens/patient/PatientScreen.jsx`.

(a) Replace:

```jsx
import { ageOf, hasMeasurement } from "../common/freshness.js";
import { ageParts } from "../common/feedHealth.js";
import { measuredVitals } from "../common/vitals.js";
```

with:

```jsx
import { hasMeasurement } from "../common/freshness.js";
import { measuredVitals } from "../common/vitals.js";
```

(b) Replace:

```jsx
import { TrendsBox } from "./trends/TrendsBox.jsx";

const TICK_MS = 30_000;

/** How old, in the reader's own language: "3 dk", "2 sa". The number and the unit stay apart, so
 *  neither ends up inside a word that would need a suffix fitted to it. */
function ageText(t, iso, nowMs) {
  const parts = ageParts((ageOf(iso, nowMs) ?? NaN) / 1000);
  if (!parts) return null;
  const key = parts.unit === "s" ? "board.ageS" : parts.unit === "m" ? "board.ageM" : "board.ageH";
  return t("patient.vitalAge", { age: t(key, { count: parts.value }) });
}
```

with:

```jsx
import { ageText } from "./ageText.js";
import { TrendsBox } from "./trends/TrendsBox.jsx";

const TICK_MS = 30_000;
```

(c) Replace:

```jsx
          <TrendsBox patient={patient} />
```

with:

```jsx
          <TrendsBox patient={patient} nowMs={nowMs} />
```

- [ ] **Step 9: Green, then the gate.**

```bash
cd /c/tmp/g2-vital/dashboard
npx vitest run src/live/screens/patient/ src/reachable.test.js src/live/boundaries.test.js src/live/rawKeys.test.jsx src/live/i18n/ 2>&1 | grep -E "Test Files|Tests |×"
```
Expected: no `×`; PatientScreen 56, TrendCard 10, news2Tone 2, useTrends 9. Then the suite — **84 / 1981** — and the build.

- [ ] **Step 10: Commit.**

```bash
cd /c/tmp/g2-vital
git add dashboard/src/live/screens/patient/ageText.js dashboard/src/live/screens/patient/trends/news2Tone.js dashboard/src/live/screens/patient/trends/news2Tone.test.js dashboard/src/live/screens/patient/trends/cards.js dashboard/src/live/screens/patient/trends/TrendCard.jsx dashboard/src/live/screens/patient/trends/TrendCard.test.jsx dashboard/src/live/screens/patient/trends/TrendsBox.jsx dashboard/src/live/screens/patient/PatientScreen.jsx dashboard/src/live/screens/patient/PatientScreen.test.jsx
git status --short && git diff --cached --stat
git commit -m "feat(patient): six trend cards — the engine's value, delta, age, NEWS2 frame and own-normal pill" -m "news2Tone is the one mapping from the engine's points to a tone (frame now, bands next). A card handed news2_points 3 on a value of 72 frames red; a delta of 2 prints '+2' whatever the points drawn; the pill is within_own_normal and sits beside the frame. The pressure card frames on systolic. ageText moves out of PatientScreen so the two say an age alike.

red: news2Tone / cards imports unresolved; PatientScreen 2 failed (no list)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: The geometry and the chart — a 24-hour mini chart in every card

Spec §3.1 (the mini chart) and §6 (`trendGeometry.js`, `TrendChart.jsx`), with X6. The geometry is pure and numbers-only: the plot frame, the time and value scales, the value range (the data's own plus 15 % either side, plus the patient's charted normal so a band just entered is always on the chart — never a "normal range" of the browser's), the NEWS2 rows as rectangles **in the tone of the server's points** (`news2Tone`; a row scoring 0 is not tinted), the line (dashed, broken where a value is missing, empty below two points), round value ticks, local-hour time ticks, the marks in the window, the nearest point to a pointer. The chart draws it as SVG in token classes, each series in its channel's identity colour through `currentColor`, MAP's dots hollow. Its width is measured (`ResizeObserver`; 320 px small / 640 px big where nothing can measure, e.g. jsdom), so a dot stays round. The card's mini chart is `aria-hidden`: the card's text is its equivalent.

**Files:**
- Create: `dashboard/src/live/screens/patient/trends/trendGeometry.js`, `trendGeometry.test.js`, `TrendChart.jsx`, `TrendChart.test.jsx`
- Modify: `trends/TrendCard.jsx`, `trends/TrendCard.test.jsx`, `trends/TrendsBox.jsx`

- [ ] **Step 1: The geometry's test** — Write `dashboard/src/live/screens/patient/trends/trendGeometry.test.js`:

```js
// The trend charts' geometry, without React: every number below is worked out by hand in the
// comment beside it, so a change to the arithmetic shows up as a change to a number someone wrote.
import { describe, it, expect } from "vitest";
import {
  bandRects, linePath, markerMarks, markerNear, nearestIndex, ownNormalRect, parseMarkers, parsePoints,
  plotFrame, timeScale, timeTicks, valueDomain, valueScale, valueTicks,
} from "./trendGeometry.js";
import { BANDS } from "./trends.testutil.js";

const same = (v) => v;
const p = (ms, value) => ({ ms, value });

describe("the frame and the scales", () => {
  it("leaves the mini chart its whole width, and the big one room for labels, marks and times", () => {
    expect(plotFrame(320, 46)).toEqual({ left: 2, right: 318, top: 6, bottom: 40, laneY: 53, axisY: 42 });
    // 280 − 6 − 14 (marks) − 16 (times) = 244; the marks' lane centres at 244 + 6 + 7 = 257.
    expect(plotFrame(640, 280, { labels: true, markers: true, axis: true }))
      .toEqual({ left: 34, right: 632, top: 6, bottom: 244, laneY: 257, axisY: 276 });
  });

  it("maps the window's ends onto the plot's, and a window of no length onto its left edge", () => {
    expect(timeScale(0, 100, 10, 110)(50)).toBe(60);
    expect(timeScale(5, 5, 10, 110)(5)).toBe(10);
  });

  it("spans the data plus 15 % either side, and never a range of its own", () => {
    expect(valueDomain([60, 80])).toEqual({ lo: 57, hi: 83 });
    expect(valueDomain([84])).toEqual({ lo: 79.8, hi: 88.2 });          // ±5 % of one value
    expect(valueDomain([0])).toEqual({ lo: -1, hi: 1 });                // at least ±1
    expect(valueDomain([Number.NaN, null, undefined])).toBeNull();
    expect(valueDomain([])).toBeNull();
  });

  it("puts larger values higher", () => {
    const y = valueScale({ lo: 0, hi: 100 }, 0, 200);
    expect([y(0), y(50), y(100)]).toEqual([200, 100, 0]);
  });
});

describe("the bands", () => {
  // Heart rate on 30–140, one pixel a beat, 140 at the top: y(v) = 140 − v (exact in binary).
  const domain = { lo: 30, hi: 140 };
  const y = (v) => 140 - v;

  it("draws each row the server scores 1 or more, clipped to the domain, in the tone of its points", () => {
    expect(bandRects(BANDS.heart_rate, domain, y, 0, 300)).toEqual([
      { x: 0, y: 100, w: 300, h: 10, tone: "crit", points: 3 }, // ≤ 40, clipped at 30
      { x: 0, y: 90, w: 300, h: 10, tone: "mid", points: 1 }, //  40–50
      { x: 0, y: 30, w: 300, h: 20, tone: "mid", points: 1 }, //  90–110
      { x: 0, y: 10, w: 300, h: 20, tone: "mid", points: 2 }, //  110–130
      { x: 0, y: 0, w: 300, h: 10, tone: "crit", points: 3 }, //  > 130, clipped at 140
    ]);
  });

  it("tints nothing a row of 0 covers, and nothing outside the domain", () => {
    expect(bandRects(BANDS.heart_rate, { lo: 60, hi: 80 }, valueScale({ lo: 60, hi: 80 }, 0, 20), 0, 300)).toEqual([]);
    expect(bandRects(null, domain, y, 0, 300)).toEqual([]);
  });

  it("draws a row red because the SERVER scored it 3, whatever the values under it look like", () => {
    const [rect] = bandRects([{ low: null, high: null, points: 3 }], { lo: 60, hi: 80 }, valueScale({ lo: 60, hi: 80 }, 0, 20), 0, 300);
    expect(rect).toEqual({ x: 0, y: 0, w: 300, h: 20, tone: "crit", points: 3 });
  });

  it("draws the patient's charted normal where the clinician put it", () => {
    const own = (v) => 120 - v;                                        // 90–120 on 0–30 px
    expect(ownNormalRect({ low: 100, high: 115 }, { lo: 90, hi: 120 }, own, 0, 300)).toEqual({ x: 0, y: 5, w: 300, h: 15 });
    expect(ownNormalRect(null, { lo: 90, hi: 120 }, own, 0, 300)).toBeNull();
    expect(ownNormalRect({ low: 200, high: 210 }, { lo: 90, hi: 120 }, own, 0, 300)).toBeNull();
  });
});

describe("the line, the labels and the marks", () => {
  it("joins two or more measurements, never one, and breaks where a value is not a number", () => {
    expect(linePath([p(0, 10), p(50, 20)], same, same)).toBe("M0.0,10.0L50.0,20.0");
    expect(linePath([p(0, 10)], same, same)).toBe("");
    expect(linePath([p(0, 10), p(10, Number.NaN), p(20, 30), p(30, 40)], same, same)).toBe("M0.0,10.0M20.0,30.0L30.0,40.0");
  });

  it("labels values at round steps inside the domain", () => {
    expect(valueTicks({ lo: 0, hi: 100 })).toEqual([0, 25, 50, 75, 100]);
    expect(valueTicks({ lo: 57, hi: 83 })).toEqual([60, 70, 80]);
    expect(valueTicks({ lo: 36.1, hi: 37.9 })).toEqual([36.5, 37, 37.5]);
    expect(valueTicks(null)).toEqual([]);
  });

  it("labels time on whole local hours: every hour, every 4 hours, every 12 hours", () => {
    const since = new Date(2026, 9, 19, 3, 20).getTime();
    const hoursOf = (ticks) => ticks.map((ms) => new Date(ms).getHours());
    expect(hoursOf(timeTicks(since, since + 6 * 3_600_000, 6))).toEqual([4, 5, 6, 7, 8, 9]);
    expect(hoursOf(timeTicks(since, since + 24 * 3_600_000, 24))).toEqual([4, 8, 12, 16, 20, 0]);
    expect(hoursOf(timeTicks(since, since + 72 * 3_600_000, 72))).toEqual([12, 0, 12, 0, 12, 0]);
  });

  it("keeps the marks inside the window, with their x", () => {
    expect(markerMarks([{ ms: 10, kind: "alarm" }, { ms: 200, kind: "antibiotic" }], same, 0, 100))
      .toEqual([{ ms: 10, kind: "alarm", x: 10 }]);
  });

  it("finds the measurement nearest the pointer, the later one on a tie, none in an empty chart", () => {
    const points = [p(0, 1), p(10, 2), p(20, 3), p(25, Number.NaN)];
    expect(nearestIndex(points, same, 14)).toBe(1);
    expect(nearestIndex(points, same, 15)).toBe(2);
    expect(nearestIndex(points, same, 26)).toBe(2);                     // the NaN reading is not one
    expect(nearestIndex([], same, 5)).toBe(-1);
  });

  it("names a mark only within one pixel column of the pointer", () => {
    const marks = [{ x: 10, kind: "alarm" }, { x: 20, kind: "antibiotic" }];
    expect(markerNear(marks, 10.9)).toEqual(marks[0]);
    expect(markerNear(marks, 12)).toBeNull();
  });
});

describe("reading the endpoint's rows", () => {
  it("keeps every readable instant, a missing value as NaN, and the server's points only when whole", () => {
    expect(parsePoints([["2026-10-19T09:00:00Z", 84, 0], ["bad", 1, 0], ["2026-10-19T10:00:00Z", null, 2.5], "nope"])).toEqual([
      { ms: Date.parse("2026-10-19T09:00:00Z"), iso: "2026-10-19T09:00:00Z", value: 84, points: 0 },
      { ms: Date.parse("2026-10-19T10:00:00Z"), iso: "2026-10-19T10:00:00Z", value: Number.NaN, points: null },
    ]);
    expect(parsePoints(undefined)).toEqual([]);
  });

  it("keeps every mark with a readable instant", () => {
    expect(parseMarkers([{ ts: "2026-10-19T09:00:00Z", kind: "alarm", label: "news2" }, { ts: "x", kind: "alarm" }])).toEqual([
      { ms: Date.parse("2026-10-19T09:00:00Z"), iso: "2026-10-19T09:00:00Z", kind: "alarm", label: "news2" },
    ]);
  });
});
```

(The bands' `y` is written as `140 − v` and not built with `valueScale`: `valueScale` on that domain gives 20.000000000000007 for a 20-px band, which is right and unreadable as an expectation.)

Run it: `npx vitest run src/live/screens/patient/trends/trendGeometry.test.js 2>&1 | grep -E "Error"` → `Error: Failed to resolve import "./trendGeometry.js" …`.

- [ ] **Step 2: The geometry** — Write `dashboard/src/live/screens/patient/trends/trendGeometry.js`:

```js
// src/live/screens/patient/trends/trendGeometry.js — where things go on a trend chart. Pure: no
// React, no DOM, and no clock but the instants it is handed.
//
// NOTHING HERE DECIDES ANYTHING CLINICAL. Every band edge and every point total comes from the
// engine (GET /patients/{id}/trends); this file maps them to pixels and does nothing else. The value
// range a chart spans is the data's own (plus a margin, plus the patient's charted normal so a band a
// clinician just entered is always on the chart) — never a "normal range" of its own. A band is drawn
// where the server put it, clipped to that range, in the tone of the server's points (`news2Tone`,
// the one mapping the card's frame uses too).
import { news2Tone } from "./news2Tone.js";

const LABEL_PAD = 34;   // room for the value labels, big chart only
const EDGE_PAD = 2;
const TOP_PAD = 6;
const BOTTOM_PAD = 6;
export const MARKER_LANE = 14;
export const AXIS_LANE = 16;
// The time-label step per window: hourly over 6 h, every 4 h over 24 h, every 12 h over 3 days.
const TICK_HOURS = { 6: 1, 24: 4, 72: 12 };
const NICE_STEPS = [1, 2, 2.5, 5];

/** The plot area of a `width` × `height` chart. The big chart has value labels on the left, a lane
 *  under the plot for the ▲/◆ marks, and one under that for the time labels. */
export function plotFrame(width, height, { labels = false, markers = false, axis = false } = {}) {
  const left = labels ? LABEL_PAD : EDGE_PAD;
  const right = Math.max(left + 1, width - (labels ? 8 : EDGE_PAD));
  const top = TOP_PAD;
  const bottom = Math.max(top + 1, height - BOTTOM_PAD - (markers ? MARKER_LANE : 0) - (axis ? AXIS_LANE : 0));
  return { left, right, top, bottom, laneY: bottom + BOTTOM_PAD + MARKER_LANE / 2, axisY: height - 4 };
}

/** The endpoint's `[iso, value, points]` rows as `{ ms, iso, value, points }`, in their order. A row
 *  whose instant cannot be read is dropped (it could be drawn nowhere); a value that is not a number
 *  is kept as NaN, which breaks the line there. */
export function parsePoints(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row) => {
    if (!Array.isArray(row)) return [];
    const ms = Date.parse(row[0]);
    if (!Number.isFinite(ms)) return [];
    return [{ ms, iso: row[0], value: typeof row[1] === "number" ? row[1] : Number.NaN, points: Number.isInteger(row[2]) ? row[2] : null }];
  });
}

/** The response's markers as `{ ms, iso, kind, label }`; unreadable instants dropped. */
export function parseMarkers(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((m) => {
    const ms = Date.parse(m?.ts);
    return Number.isFinite(ms) ? [{ ms, iso: m.ts, kind: m.kind, label: m.label }] : [];
  });
}

/** [sinceMs, untilMs] onto [left, right]. */
export function timeScale(sinceMs, untilMs, left, right) {
  const span = untilMs - sinceMs;
  return (ms) => left + (span > 0 ? ((ms - sinceMs) / span) * (right - left) : 0);
}

/** The value range drawn: the finite values' own, with 15 % either side (±5 % of the value, at least
 *  1, when they are all one number). Null when there is no finite value at all. */
export function valueDomain(values) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (Number.isFinite(v)) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (lo > hi) return null;
  const margin = hi > lo ? (hi - lo) * 0.15 : Math.max(Math.abs(hi) * 0.05, 1);
  return { lo: lo - margin, hi: hi + margin };
}

/** The domain onto [bottom, top] (larger values higher). */
export function valueScale(domain, top, bottom) {
  const span = domain.hi - domain.lo;
  return (v) => bottom - ((v - domain.lo) / span) * (bottom - top);
}

function clip(low, high, domain, y, left, right) {
  const a = Math.max(low ?? -Infinity, domain.lo);
  const b = Math.min(high ?? Infinity, domain.hi);
  if (!(b > a)) return null;
  return { x: left, y: y(b), w: right - left, h: y(a) - y(b) };
}

/** The NEWS2 rows that score at least 1, as rectangles clipped to the domain, each in the tone of the
 *  SERVER's points for it. A row scoring 0 is not tinted; a row outside the domain is not drawn. */
export function bandRects(rows, domain, y, left, right) {
  if (!Array.isArray(rows) || !domain) return [];
  return rows.flatMap((row) => {
    const tone = news2Tone(row?.points);
    const rect = tone ? clip(row.low, row.high, domain, y, left, right) : null;
    return rect ? [{ ...rect, tone, points: row.points }] : [];
  });
}

/** The patient's charted normal as a rectangle, or null. */
export function ownNormalRect(own, domain, y, left, right) {
  if (!own || !domain || !Number.isFinite(own.low) || !Number.isFinite(own.high)) return null;
  return clip(own.low, own.high, domain, y, left, right);
}

/** The connector through the points: an SVG path, broken wherever a value is not a number. Empty
 *  when fewer than two points can be drawn — one measurement is a dot, never a line. */
export function linePath(points, x, y) {
  let d = "";
  let pen = false;
  let drawn = 0;
  for (const p of points) {
    if (!Number.isFinite(p.ms) || !Number.isFinite(p.value)) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${x(p.ms).toFixed(1)},${y(p.value).toFixed(1)}`;
    pen = true;
    drawn += 1;
  }
  return drawn >= 2 ? d : "";
}

/** Round values for the value labels: about `count` steps of 1, 2, 2.5 or 5 × 10ⁿ inside the domain. */
export function valueTicks(domain, count = 4) {
  if (!domain) return [];
  const raw = (domain.hi - domain.lo) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = NICE_STEPS.map((s) => s * magnitude).find((s) => s >= raw) ?? 10 * magnitude;
  const out = [];
  for (let v = Math.ceil(domain.lo / step) * step; v <= domain.hi + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

/** The time labels: whole local hours on the window's step (the browser's zone is the ward's). */
export function timeTicks(sinceMs, untilMs, hours) {
  const step = TICK_HOURS[hours] ?? Math.max(1, Math.round(hours / 6));
  const at = new Date(sinceMs);
  at.setMinutes(0, 0, 0);
  while (at.getTime() < sinceMs || at.getHours() % step !== 0) at.setHours(at.getHours() + 1);
  const out = [];
  for (; at.getTime() <= untilMs; at.setHours(at.getHours() + step)) out.push(at.getTime());
  return out;
}

/** The marks inside the window, with their x. */
export function markerMarks(markers, x, sinceMs, untilMs) {
  return (markers ?? []).filter((m) => m.ms >= sinceMs && m.ms <= untilMs).map((m) => ({ ...m, x: x(m.ms) }));
}

/** The index of the drawable point nearest `px` in time (the later one on a tie), or -1. */
export function nearestIndex(points, x, px) {
  let best = -1;
  let distance = Infinity;
  points.forEach((p, i) => {
    if (!Number.isFinite(p.ms) || !Number.isFinite(p.value)) return;
    const d = Math.abs(x(p.ms) - px);
    if (d <= distance) {
      best = i;
      distance = d;
    }
  });
  return best;
}

/** The mark within one pixel column of `px`, or null. */
export function markerNear(marks, px) {
  return marks.find((m) => Math.abs(m.x - px) <= 1) ?? null;
}
```

`npx vitest run src/live/screens/patient/trends/trendGeometry.test.js 2>&1 | grep -E "Tests "` → `Tests  16 passed (16)`. (The time labels follow the browser's zone, which on the ward PCs is the hospital's — `i18n/dates.js` says so; the test builds its instant in local time for the same reason.)

- [ ] **Step 3: The chart's test** — Write `dashboard/src/live/screens/patient/trends/TrendChart.test.jsx`:

```jsx
// What the chart draws, read off the SVG. jsdom has no layout, so the chart runs on its fallback
// width (320 small, 640 big) and every x below is worked out from `plotFrame` + `timeScale`.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { fireEvent, render } from "@testing-library/react";
import { NOW } from "../../../data/board.testutil.js";
import { hhmm } from "../../../i18n/dates.js";
import { TrendChart } from "./TrendChart.jsx";
import { parseMarkers, parsePoints, plotFrame, timeScale, timeTicks } from "./trendGeometry.js";
import { BANDS, marker, point } from "./trends.testutil.js";

const SINCE = NOW - 24 * 3_600_000;
const hr = (raw, over = {}) => ({ key: "heart_rate", color: "text-v-hr", hollow: false, points: parsePoints(raw), ...over });

function draw(props) {
  const { container } = render(<TrendChart sinceMs={SINCE} untilMs={NOW} hours={24} {...props} />);
  return container.querySelector("svg");
}
const all = (svg, selector) => [...svg.querySelectorAll(selector)];

describe("the trend chart", () => {
  it("draws a dot per measurement and a dashed connector between them", () => {
    const svg = draw({ series: [hr([point(120, 84, 0), point(60, 90, 0), point(30, 96, 1)])] });
    expect(all(svg, "circle").map((c) => c.dataset.value)).toEqual(["84", "90", "96"]);
    const [line] = all(svg, "path");
    expect(line.getAttribute("stroke-dasharray")).toBe("4 3");
  });

  it("draws one measurement as a dot, and no line", () => {
    const svg = draw({ series: [hr([point(60, 84, 0)])] });
    expect(all(svg, "circle")).toHaveLength(1);
    expect(all(svg, "path")).toHaveLength(0);
  });

  it("breaks the connector where a value is missing, and draws no dot for it", () => {
    const svg = draw({ series: [hr([point(120, 84, 0), point(90, null), point(60, 90, 0), point(30, 95, 1)])] });
    expect(all(svg, "path")[0].getAttribute("d").match(/M/g)).toHaveLength(2);
    expect(all(svg, "circle")).toHaveLength(3);
  });

  it("tints the rows the server scored 1–3 in the server's tone, and none it scored 0", () => {
    const svg = draw({ series: [hr([point(60, 60, 0), point(30, 100, 1)])], bands: { news2: BANDS.heart_rate } });
    // 60–100 drawn as 54–106: 50–90 scores 0 (untinted), 90–110 scores 1.
    expect(all(svg, "[data-band]").map((r) => [r.dataset.band, r.getAttribute("class")])).toEqual([["mid", "fill-band-mid"]]);
  });

  it("draws a row red because the server scored it 3 — the browser does not judge the values under it", () => {
    const svg = draw({ series: [hr([point(60, 72, 0)])], bands: { news2: [{ low: null, high: null, points: 3 }] } });
    expect(all(svg, "[data-band]").map((r) => r.getAttribute("class"))).toEqual(["fill-band-crit"]);
  });

  it("draws the patient's normal tinted and edged with dashes, so it is not told by colour alone", () => {
    const svg = draw({ series: [hr([point(60, 72, 0)])], bands: { news2: null, own_normal: { low: 70, high: 80 } } });
    const own = svg.querySelector("[data-own-normal]");
    expect(own.querySelector("rect")).toHaveClass("fill-band-n");
    expect(all(own, "line").map((l) => l.getAttribute("stroke-dasharray"))).toEqual(["2 3", "2 3"]);
  });

  it("gives a reader a summary — or, inside a card whose text already says it, nothing at all", () => {
    const named = draw({ series: [hr([point(60, 72, 0)])], label: "Nəbz: 1" });
    expect(named).toHaveAttribute("role", "img");
    expect(named).toHaveAttribute("aria-label", "Nəbz: 1");
    document.body.innerHTML = "";
    const quiet = draw({ series: [hr([point(60, 72, 0)])] });
    expect(quiet).toHaveAttribute("aria-hidden", "true");
    expect(quiet).not.toHaveAttribute("role");
  });

  it("on the big chart: time and value labels, ▲ and ◆ in their own lane, inside the window only", () => {
    const markers = parseMarkers([marker(60, "alarm"), marker(120, "antibiotic"), marker(30 * 60, "alarm")]);
    const svg = draw({ series: [hr([point(120, 84, 0), point(60, 132, 3)])], markers, big: true, height: 280 });
    expect(all(svg, "[data-marker]").map((m) => m.dataset.marker)).toEqual(["alarm", "antibiotic"]);
    expect(svg.querySelector("[data-marker='alarm']")).toHaveClass("fill-crit");
    expect(svg.querySelector("[data-marker='antibiotic']")).toHaveClass("fill-pri");
    expect(all(svg, "[data-tick='time']").map((t) => t.textContent)).toEqual(timeTicks(SINCE, NOW, 24).map(hhmm));
    expect(all(svg, "[data-tick='value']").length).toBeGreaterThan(1);
  });

  it("draws no marks and no labels on the small chart", () => {
    const svg = draw({ series: [hr([point(60, 84, 0)])], markers: parseMarkers([marker(60)]) });
    expect(all(svg, "[data-marker]")).toHaveLength(0);
    expect(all(svg, "text")).toHaveLength(0);
  });

  it("follows the mouse to the nearest measurement, and lets go when it leaves", () => {
    const onCursor = vi.fn();
    const svg = draw({ series: [hr([point(120, 84, 0), point(60, 90, 0)])], big: true, height: 280, onCursor });
    const frame = plotFrame(640, 280, { labels: true, markers: true, axis: true });
    const x = timeScale(SINCE, NOW, frame.left, frame.right);
    fireEvent.mouseMove(svg, { clientX: x(NOW - 61 * 60_000) });
    expect(onCursor).toHaveBeenLastCalledWith(1, "mouse");
    fireEvent.mouseLeave(svg);
    expect(onCursor).toHaveBeenLastCalledWith(null, "mouse");
  });

  it("draws the cursor where it is told, on the first series", () => {
    const svg = draw({ series: [hr([point(120, 84, 0), point(60, 90, 0)])], big: true, height: 280, cursor: 1 });
    const frame = plotFrame(640, 280, { labels: true, markers: true, axis: true });
    const x = timeScale(SINCE, NOW, frame.left, frame.right);
    expect(Number(svg.querySelector("[data-cursor] line").getAttribute("x1"))).toBeCloseTo(x(NOW - 60 * 60_000));
  });

  it("draws MAP's dots hollow", () => {
    const svg = draw({ series: [hr([point(60, 58)], { key: "map", color: "text-v-map", hollow: true })] });
    expect(svg.querySelector("[data-series='map'] circle")).toHaveClass("fill-card");
  });
});
```

Run it → red: `Error: Failed to resolve import "./TrendChart.jsx" …`.

- [ ] **Step 4: The chart** — Write `dashboard/src/live/screens/patient/trends/TrendChart.jsx`:

```jsx
// src/live/screens/patient/trends/TrendChart.jsx — one card's chart, small (in the card) or big (in
// the dialog). It draws what the engine sent and nothing else:
//   * the NEWS2 rows the server scored 1–3, tinted by the server's points (`news2Tone`), and the
//     patient's charted normal, tinted and edged with a dashed line (so it is not told by colour);
//   * a DOT per measurement, and between two measurements a DASHED line — an interval, never a
//     measurement (the legend says so); one measurement is a dot and no line;
//   * on the big chart, the value and time labels, and ▲ (alarm, `--crit`) and ◆ (antibiotic,
//     `--pri`) in a lane of their own under the plot, never over a band (tokens.test.js holds both).
// The series' colour is its channel's identity colour (`vitals.js`), through `currentColor`; MAP's dots
// are hollow. Every colour is a token class; none is written here.
import React, { useLayoutEffect, useRef, useState } from "react";
import { ddmm, hhmm } from "../../../i18n/dates.js";
import {
  bandRects, linePath, markerMarks, nearestIndex, ownNormalRect, plotFrame, timeScale, timeTicks,
  valueDomain, valueScale, valueTicks,
} from "./trendGeometry.js";

const BAND_FILL = { mid: "fill-band-mid", crit: "fill-band-crit" };
const drawable = (p) => Number.isFinite(p.ms) && Number.isFinite(p.value);

/** The element's width in CSS pixels, followed as it changes; `fallback` where nothing can measure
 *  it (no ResizeObserver: jsdom, an old browser). The viewBox is that width, so one unit is one pixel
 *  and a dot stays round at any size. */
function useWidth(ref, fallback) {
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver !== "function") return undefined;
    const measure = () => {
      if (el.clientWidth > 0) setWidth(Math.round(el.clientWidth));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

export function TrendChart({
  series, bands = null, markers = [], sinceMs, untilMs, hours = 24, height = 46, big = false,
  label, cursor = null, onCursor,
}) {
  const box = useRef(null);
  const width = useWidth(box, big ? 640 : 320);
  const frame = plotFrame(width, height, { labels: big, markers: big, axis: big });
  const x = timeScale(sinceMs, untilMs, frame.left, frame.right);
  const own = bands?.own_normal ?? null;
  const values = series.flatMap((s) => s.points.map((p) => p.value));
  if (own) values.push(own.low, own.high);
  const domain = valueDomain(values);
  const y = domain ? valueScale(domain, frame.top, frame.bottom) : null;
  const rects = y ? bandRects(bands?.news2, domain, y, frame.left, frame.right) : [];
  const ownRect = y ? ownNormalRect(own, domain, y, frame.left, frame.right) : null;
  const marks = big ? markerMarks(markers, x, sinceMs, untilMs) : [];
  const at = cursor === null ? null : series[0]?.points[cursor] ?? null;

  const move = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = rect.width > 0 ? ((event.clientX - rect.left) / rect.width) * width : event.clientX - rect.left;
    const index = nearestIndex(series[0]?.points ?? [], x, px);
    onCursor(index >= 0 ? index : null, "mouse");
  };
  const named = label ? { role: "img", "aria-label": label } : { "aria-hidden": "true", focusable: "false" };

  // A <span>, not a <div>: the small chart sits inside the card's <button>, which takes phrasing
  // content only.
  return (
    <span ref={box} className="block w-full min-w-0">
      <svg
        width="100%" height={height} viewBox={`0 0 ${width} ${height}`} className="block" {...named}
        onMouseMove={onCursor ? move : undefined}
        onMouseLeave={onCursor ? () => onCursor(null, "mouse") : undefined}
      >
        {rects.map((r) => (
          <rect key={`${r.y}-${r.tone}`} data-band={r.tone} x={r.x} y={r.y} width={r.w} height={r.h} className={BAND_FILL[r.tone]} />
        ))}
        {ownRect ? (
          <g data-own-normal="">
            <rect x={ownRect.x} y={ownRect.y} width={ownRect.w} height={ownRect.h} className="fill-band-n" />
            <line x1={ownRect.x} x2={ownRect.x + ownRect.w} y1={ownRect.y} y2={ownRect.y} className="stroke-pri" strokeDasharray="2 3" />
            <line x1={ownRect.x} x2={ownRect.x + ownRect.w} y1={ownRect.y + ownRect.h} y2={ownRect.y + ownRect.h} className="stroke-pri" strokeDasharray="2 3" />
          </g>
        ) : null}
        {big && y ? valueTicks(domain).map((v) => (
          <g key={`v${v}`} data-tick="value">
            <line x1={frame.left} x2={frame.right} y1={y(v)} y2={y(v)} className="stroke-grid" />
            <text x={frame.left - 5} y={y(v) + 3.5} textAnchor="end" className="fill-mute text-10">{v}</text>
          </g>
        )) : null}
        {y ? series.map((s) => (
          <g key={s.key} data-series={s.key} className={s.color}>
            {linePath(s.points, x, y) ? (
              <path d={linePath(s.points, x, y)} fill="none" stroke="currentColor" strokeWidth={1.5} strokeDasharray="4 3" />
            ) : null}
            {s.points.filter(drawable).map((p) => (
              <circle
                key={p.iso} data-ts={p.iso} data-value={p.value} cx={x(p.ms)} cy={y(p.value)} r={big ? 3.5 : 2.5}
                fill={s.hollow ? undefined : "currentColor"} className={s.hollow ? "fill-card" : undefined}
                stroke="currentColor" strokeWidth={s.hollow ? 1.5 : 0}
              />
            ))}
          </g>
        )) : null}
        {marks.map((m) => (m.kind === "alarm" ? (
          <path key={`a${m.iso}`} data-marker="alarm" d={`M${m.x - 6},${frame.laneY + 5}L${m.x},${frame.laneY - 5}L${m.x + 6},${frame.laneY + 5}Z`} className="fill-crit" />
        ) : (
          <rect key={`m${m.iso}`} data-marker={m.kind} x={m.x - 4} y={frame.laneY - 4} width={8} height={8} transform={`rotate(45 ${m.x} ${frame.laneY})`} className="fill-pri" />
        )))}
        {big ? timeTicks(sinceMs, untilMs, hours).map((ms) => (
          <text key={`t${ms}`} data-tick="time" x={x(ms)} y={frame.axisY} textAnchor="middle" className="fill-mute text-10">
            {hours === 72 ? `${ddmm(ms)} ${hhmm(ms)}` : hhmm(ms)}
          </text>
        )) : null}
        {at && y && drawable(at) ? (
          <g data-cursor="">
            <line x1={x(at.ms)} x2={x(at.ms)} y1={frame.top} y2={frame.bottom} className="stroke-ink" strokeWidth={1} opacity={0.5} />
            <circle cx={x(at.ms)} cy={y(at.value)} r={6} fill="none" className="stroke-ink" strokeWidth={1.5} />
          </g>
        ) : null}
      </svg>
    </span>
  );
}
```

`npx vitest run src/live/screens/patient/trends/TrendChart.test.jsx 2>&1 | grep -E "Tests "` → `Tests  12 passed (12)`.

- [ ] **Step 5: The card draws it — its test first.** Two Edits in `trends/TrendCard.test.jsx`.

(a) Replace:

```jsx
      <ul><TrendCard card={card} channels={channelsOf(trends("S-001", channels))} nowMs={NOW} onOpen={onOpen} /></ul>
```

with:

```jsx
      <ul>
        <TrendCard card={card} channels={channelsOf(trends("S-001", channels))} nowMs={NOW}
          sinceMs={NOW - 24 * 3_600_000} untilMs={NOW} onOpen={onOpen} />
      </ul>
```

(b) Replace:

```jsx
  it("is a button naming the chart it opens only when it can open one", () => {
```

with:

```jsx
  it("draws its 24-hour mini chart — a dot per reading — hidden from a reader the card's text already told", () => {
    const card = show(PRESSURE, [
      channel("sbp", [point(90, 118, 0), point(30, 112, 0)]),
      channel("map", [point(90, 80), point(30, 76)]),
    ]);
    const svg = card.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect([...svg.querySelectorAll("circle")].map((c) => c.dataset.value)).toEqual(["118", "112", "80", "76"]);
    expect(svg.querySelector("[data-series='map'] circle")).toHaveClass("fill-card");
    document.body.innerHTML = "";
    expect(show(HR, []).querySelector("svg")).toBeNull();          // nothing measured: no empty chart either
  });

  it("is a button naming the chart it opens only when it can open one", () => {
```

Run it: `Tests  1 failed | 10 passed (11)` (no `svg` in the card yet).

- [ ] **Step 6: Into the card.** Five Edits in `trends/TrendCard.jsx`.

(a) Replace:

```jsx
// src/live/screens/patient/trends/TrendCard.jsx — one trend card: the latest value of each of its
// channels, how it moved since the previous measurement, how long ago, and (Task 11) a 24-hour mini
// chart.
```

with:

```jsx
// src/live/screens/patient/trends/TrendCard.jsx — one trend card: the latest value of each of its
// channels, how it moved since the previous measurement, how long ago, and a 24-hour mini chart.
```

(b) Replace:

```jsx
// A button only when it can open the big chart (`onOpen`).
```

with:

```jsx
// A button only when it can open the big chart (`onOpen`); its text — the values, the delta, the age —
// is the chart's text equivalent, so the mini chart inside it is hidden from assistive technology.
```

(c) Replace:

```jsx
import { news2Tone } from "./news2Tone.js";
```

with:

```jsx
import { news2Tone } from "./news2Tone.js";
import { TrendChart } from "./TrendChart.jsx";
import { parsePoints } from "./trendGeometry.js";
```

(d) Replace:

```jsx
export function TrendCard({ card, channels, nowMs, onOpen }) {
  const { t } = useI18n();
  const primary = channels?.[card.series[0].key] ?? null;
```

with:

```jsx
export function TrendCard({ card, channels, nowMs, sinceMs, untilMs, onOpen }) {
  const { t } = useI18n();
  const primary = channels?.[card.series[0].key] ?? null;
  const drawn = card.series.map((s) => ({ key: s.key, color: s.color, hollow: s.hollow, points: parsePoints(channels?.[s.key]?.points) }));
```

(e) Replace:

```jsx
        {measured ? (
          card.series.map((s) => (
            <Reading key={s.key} series={s} channel={channels?.[s.key]} nowMs={nowMs} named={card.series.length > 1} />
          ))
        ) : (
```

with:

```jsx
        {measured ? (
          <>
            {card.series.map((s) => (
              <Reading key={s.key} series={s} channel={channels?.[s.key]} nowMs={nowMs} named={card.series.length > 1} />
            ))}
            <span className="mt-1.5 block">
              <TrendChart series={drawn} bands={primary?.bands ?? null} sinceMs={sinceMs} untilMs={untilMs} hours={24} height={46} />
            </span>
          </>
        ) : (
```

Two Edits in `trends/TrendsBox.jsx`:

(a) Replace `  const channels = channelsOf(trends.data);` with:

```jsx
  const channels = channelsOf(trends.data);
  const sinceMs = Date.parse(trends.data?.since);
  const untilMs = Date.parse(trends.data?.until);
```

(b) Replace `              <TrendCard key={card.id} card={card} channels={channels} nowMs={nowMs} />` with:

```jsx
              <TrendCard key={card.id} card={card} channels={channels} nowMs={nowMs} sinceMs={sinceMs} untilMs={untilMs} />
```

- [ ] **Step 7: Green, then the gate.**

```bash
cd /c/tmp/g2-vital/dashboard
npx vitest run src/live/screens/patient/ src/reachable.test.js src/live/boundaries.test.js src/live/rawKeys.test.jsx 2>&1 | grep -E "Test Files|Tests |×"
```
Expected: no `×`; TrendCard 11, TrendChart 12, trendGeometry 16, PatientScreen 56. Then the suite — **86 / 2010** — and the build.

- [ ] **Step 8: Commit.**

```bash
cd /c/tmp/g2-vital
git add dashboard/src/live/screens/patient/trends/trendGeometry.js dashboard/src/live/screens/patient/trends/trendGeometry.test.js dashboard/src/live/screens/patient/trends/TrendChart.jsx dashboard/src/live/screens/patient/trends/TrendChart.test.jsx dashboard/src/live/screens/patient/trends/TrendCard.jsx dashboard/src/live/screens/patient/trends/TrendCard.test.jsx dashboard/src/live/screens/patient/trends/TrendsBox.jsx
git status --short && git diff --cached --stat
git commit -m "feat(patient): the trend charts' geometry and SVG — a 24-hour mini chart in every card" -m "trendGeometry is pure: frame, scales, the data's own range plus the charted normal, NEWS2 rows as rectangles in the tone of the SERVER's points (0 untinted), a dashed line broken at a missing value and empty below two points, round value ticks, local-hour time ticks, marks in the window, the nearest point. TrendChart draws it in token classes, each series in currentColor, MAP hollow; the card's chart is aria-hidden.

red: trendGeometry / TrendChart imports unresolved; TrendCard 1 failed (no svg)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: The big chart — a dialog with the window, the readout and the legend

Spec §3.2 (graph view) and §7. A card is now a button; it opens `TrendModal` on the kit `Modal` (wide; focus in, Escape closes, focus back to the card). The dialog reads its own window through `useTrends` — 24 h on open, 6 h / 3 days on the `Seg` — and draws the big chart (280 px, value and time labels, ▲/◆ lane) with a readout above it: "HH:MM · value unit", the channel named on the two-series card, and the mark within one pixel column, if any (`markerAtTime`, given the plot width the chart reports through `onPlot`). The readout is `aria-hidden`: a screen reader hears it only after a keyboard move (Task 13), never on a hover. `TrendLegend` names everything in words: the NEWS2 rows (with the source the SERVER sent, and the two tones' point totals), the patient's normal when charted, what a dot and a dashed line are, the two series of the pressure card, both marks, and "seyrəldilib: N nöqtədən M" for a thinned channel.

**Files:**
- Create: `trends/TrendLegend.jsx`, `trends/TrendModal.jsx`, `trends/TrendModal.test.jsx`
- Modify: `trends/trendGeometry.js` (+ test), `trends/TrendChart.jsx`, `trends/TrendsBox.jsx` (Write, whole), `PatientScreen.jsx`, `PatientScreen.test.jsx`

- [ ] **Step 1: The mark lookup in time — test first.** Two Edits in `trends/trendGeometry.test.js`.

(a) Replace:

```js
import {
  bandRects, linePath, markerMarks, markerNear, nearestIndex, ownNormalRect, parseMarkers, parsePoints,
  plotFrame, timeScale, timeTicks, valueDomain, valueScale, valueTicks,
} from "./trendGeometry.js";
```

with:

```js
import {
  bandRects, linePath, markerAtTime, markerMarks, markerNear, nearestIndex, ownNormalRect, parseMarkers,
  parsePoints, plotFrame, timeScale, timeTicks, valueDomain, valueScale, valueTicks,
} from "./trendGeometry.js";
```

(b) Replace:

```js
  it("names a mark only within one pixel column of the pointer", () => {
    const marks = [{ x: 10, kind: "alarm" }, { x: 20, kind: "antibiotic" }];
    expect(markerNear(marks, 10.9)).toEqual(marks[0]);
    expect(markerNear(marks, 12)).toBeNull();
  });
```

with:

```js
  it("names a mark only within one pixel column of the pointer", () => {
    const marks = [{ x: 10, kind: "alarm" }, { x: 20, kind: "antibiotic" }];
    expect(markerNear(marks, 10.9)).toEqual(marks[0]);
    expect(markerNear(marks, 12)).toBeNull();
  });

  it("asks the same in time: within one pixel's worth of milliseconds, and never on a chart of no width", () => {
    const marks = [{ ms: 1_000, kind: "alarm" }];
    expect(markerAtTime(marks, 1_090, 100)).toEqual(marks[0]);
    expect(markerAtTime(marks, 1_200, 100)).toBeNull();
    expect(markerAtTime(marks, 1_000, 0)).toBeNull();
  });
```

Run it: `Tests  1 failed | 16 passed (17)` (`markerAtTime` is not exported yet).

- [ ] **Step 2: `markerAtTime`.** Edit `trends/trendGeometry.js` — replace:

```js
/** The mark within one pixel column of `px`, or null. */
export function markerNear(marks, px) {
  return marks.find((m) => Math.abs(m.x - px) <= 1) ?? null;
}
```

with:

```js
/** The mark within one pixel column of `px`, or null. */
export function markerNear(marks, px) {
  return marks.find((m) => Math.abs(m.x - px) <= 1) ?? null;
}

/** The same question asked in time, for a caller that holds an instant and the chart's milliseconds
 *  per pixel (the dialog's readout, whose cursor may have been moved by the keyboard). */
export function markerAtTime(markers, ms, msPerPx) {
  if (!(msPerPx > 0) || !Number.isFinite(ms)) return null;
  return (markers ?? []).find((m) => Math.abs(m.ms - ms) <= msPerPx) ?? null;
}
```

→ `Tests  17 passed (17)`.

- [ ] **Step 3: The chart reports its plot width.** Two Edits in `trends/TrendChart.jsx`.

(a) Replace `import React, { useLayoutEffect, useRef, useState } from "react";` with:

```jsx
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
```

(b) Replace:

```jsx
  label, cursor = null, onCursor,
}) {
  const box = useRef(null);
  const width = useWidth(box, big ? 640 : 320);
  const frame = plotFrame(width, height, { labels: big, markers: big, axis: big });
```

with:

```jsx
  label, cursor = null, onCursor, onPlot,
}) {
  const box = useRef(null);
  const width = useWidth(box, big ? 640 : 320);
  const frame = plotFrame(width, height, { labels: big, markers: big, axis: big });
  const plotWidth = frame.right - frame.left;
  // The plot's width in pixels, for a caller that names a mark "within one pixel column" of a
  // cursor it moved itself (the dialog's keyboard).
  useEffect(() => { onPlot?.(plotWidth); }, [onPlot, plotWidth]);
```

- [ ] **Step 4: The dialog's tests** — Write `dashboard/src/live/screens/patient/trends/TrendModal.test.jsx`:

```jsx
// The big chart: its window, its readout, its legend — read as the clinician reads them.
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount } from "../../../session/mount.testutil.jsx";
import { profile, token } from "../../../session/testTokens.testutil.js";
import { NOW } from "../../../data/board.testutil.js";
import { hhmm } from "../../../i18n/dates.js";
import { CARDS } from "./cards.js";
import { TrendModal } from "./TrendModal.jsx";
import { plotFrame, timeScale } from "./trendGeometry.js";
import { answering, channel, marker, point, trends } from "./trends.testutil.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const PATIENT = { patient_id: "S-001", display_name: "Ayşe Sentetik", measuredAt: {} };
const card = (id) => CARDS.find((c) => c.id === id);
const HR_ANSWER = answering((pid, hours) => trends(pid, [channel("heart_rate", [point(120, 84, 0), point(60, 132, 3)])],
  { hours, markers: [marker(60, "alarm", "news2")] }));

async function open(id = "heart_rate", answer = HR_ANSWER) {
  vi.setSystemTime(NOW);
  const mounted = await mount(<TrendModal card={card(id)} patient={PATIENT} bed="REA-01 · 2" onClose={() => {}} />, {
    access: token(), me: profile(), setup: (api) => api.patientTrends.mockImplementation(answer),
  });
  await act(async () => { await settle(); });
  return mounted;
}
const dialog = () => screen.getByRole("dialog");
const xOf = (minutesAgo, hours = 24) => {
  const frame = plotFrame(640, 280, { labels: true, markers: true, axis: true });
  return timeScale(NOW - hours * 3_600_000, NOW, frame.left, frame.right)(NOW - minutesAgo * 60_000);
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the big chart", () => {
  it("is titled with the bed, the patient and the channel", async () => {
    await open();
    expect(screen.getByRole("dialog", { name: "REA-01 · 2 · Ayşe Sentetik · Nəbz" })).toBeInTheDocument();
  });

  it("reads 24 hours on open, and each window it is switched to", async () => {
    const { api } = await open();
    await act(async () => { fireEvent.click(within(dialog()).getByRole("button", { name: "6 saat" })); await settle(); });
    await act(async () => { fireEvent.click(within(dialog()).getByRole("button", { name: "3 gün" })); await settle(); });
    expect(api.patientTrends.mock.calls).toEqual([["S-001", 24], ["S-001", 6], ["S-001", 72]]);
    expect(within(dialog()).getByRole("button", { name: "3 gün" })).toHaveAttribute("aria-pressed", "true");
  });

  it("names the chart for a reader: what it shows and how many measurements", async () => {
    await open();
    expect(within(dialog()).getByRole("img")).toHaveAttribute("aria-label", "Nəbz: son 24 saatdakı ölçmələrin sayı 2");
  });

  it("reads out the measurement under the mouse — its time, value and unit, and a mark in the same pixel column", async () => {
    await open();
    const svg = within(dialog()).getByRole("img");
    const readout = dialog().querySelector("[data-readout]");
    expect(readout).toHaveAttribute("aria-hidden", "true");
    expect(readout).toHaveTextContent("Ölçməni oxumaq üçün qrafikin üzərinə gəlin");
    fireEvent.mouseMove(svg, { clientX: xOf(60) });
    expect(readout).toHaveTextContent(`${hhmm(NOW - 3_600_000)} · 132 /dəq · siqnal: news2`);
    fireEvent.mouseMove(svg, { clientX: xOf(120) });
    expect(readout.textContent).toBe(`${hhmm(NOW - 7_200_000)} · 84 /dəq`);
    fireEvent.mouseLeave(svg);
    expect(readout).toHaveTextContent("Ölçməni oxumaq üçün qrafikin üzərinə gəlin");
  });

  it("explains every mark in words: the server's NEWS2 source, both band tones, both marks, the dashed line", async () => {
    await open();
    const legend = dialog().querySelector("[data-legend]");
    expect(legend).toHaveTextContent("NEWS2 zolağı (yetkin) · mənbə news2-rcp-2017");
    for (const words of ["1–2 bal", "3 bal", "siqnal", "antibiotik", "nöqtələr ölçmədir, qırıq xətt aralıqdır"]) {
      expect(legend).toHaveTextContent(words);
    }
    expect(legend).not.toHaveTextContent("xəstənin norması");            // none charted
  });

  it("says a channel was thinned, and from how many", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate",
      [point(90, 84, 0), point(60, 90, 0), point(30, 96, 1)], { thinned: true, total_points: 2500 })], { hours })));
    expect(dialog().querySelector("[data-legend]")).toHaveTextContent("seyrəldilib: 2500 nöqtədən 3");
  });

  it("draws systolic and MAP as two series of one chart, named in the legend", async () => {
    await open("pressure", answering((pid, hours) => trends(pid, [
      channel("sbp", [point(60, 118, 0)]), channel("map", [point(60, 80)])], { hours })));
    const svg = within(dialog()).getByRole("img");
    expect(svg.querySelector("[data-series='sbp']")).not.toBeNull();
    expect(svg.querySelector("[data-series='map'] circle")).toHaveClass("fill-card");
    expect(dialog().querySelector("[data-legend]")).toHaveTextContent(/Sistolik AT.*MAP/);
  });

  it("shows no NEWS2 band in the legend of a channel the engine scores none for", async () => {
    await open("lactate", answering((pid, hours) => trends(pid, [channel("lactate", [point(60, 4.1)])], { hours })));
    expect(dialog().querySelector("[data-legend]")).not.toHaveTextContent("NEWS2");
  });
});
```

And the screen's own — Edit `PatientScreen.test.jsx`, replace:

```jsx
    it("say they cannot be read, and since when, without raising an alert", async () => {
```

with:

```jsx
    it("open a card's big chart from the card, and give the focus back to it when Escape closes it", async () => {
      await open({ payload: board([entry("S-001", [], FULL)]) });
      const hr = screen.getByRole("button", { name: /Nəbz: böyük qrafiki aç/ });
      hr.focus();
      await act(async () => { fireEvent.click(hr); await settle(); });
      expect(screen.getByRole("dialog", { name: "REA-01 · 2 · Ayşe Sentetik · Nəbz" })).toBeInTheDocument();
      await act(async () => { fireEvent.keyDown(document, { key: "Escape" }); await settle(); });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(hr);
    });

    it("say they cannot be read, and since when, without raising an alert", async () => {
```

Run both: `TrendModal.test.jsx` → `Error: Failed to resolve import "./TrendModal.jsx" …`; `PatientScreen.test.jsx` → `Tests  1 failed | 56 passed (57)` (the card is not a button yet).

- [ ] **Step 5: The legend** — Write `dashboard/src/live/screens/patient/trends/TrendLegend.jsx`:

```jsx
// src/live/screens/patient/trends/TrendLegend.jsx — what the big chart's marks mean, in words. Colour
// is never the only carrier (spec §7): every swatch has its name beside it, the two marks differ in
// shape, and the source of the NEWS2 rows is the one the SERVER named (`bands_source`).
import React from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";

function Swatch({ className, dashed = false }) {
  return (
    <svg aria-hidden="true" width="18" height="10" viewBox="0 0 18 10" className="shrink-0">
      <rect x="0" y="0" width="18" height="10" className={className} />
      {dashed ? <line x1="0" x2="18" y1="0.5" y2="0.5" className="stroke-pri" strokeDasharray="2 3" /> : null}
    </svg>
  );
}

function Glyph({ kind, color = "", hollow = false }) {
  return (
    <svg aria-hidden="true" width="18" height="10" viewBox="0 0 18 10" className={`shrink-0 ${color}`}>
      {kind === "alarm" ? <path d="M3,9L9,1L15,9Z" className="fill-crit" /> : null}
      {kind === "antibiotic" ? <rect x="5" y="1" width="8" height="8" transform="rotate(45 9 5)" className="fill-pri" /> : null}
      {kind === "points" ? (
        <>
          <line x1="3" x2="15" y1="5" y2="5" stroke="currentColor" strokeDasharray="3 2" />
          <circle cx="3" cy="5" r="2.5" fill="currentColor" />
          <circle cx="15" cy="5" r="2.5" fill="currentColor" />
        </>
      ) : null}
      {kind === "dot" ? (
        <circle cx="9" cy="5" r="3" fill={hollow ? undefined : "currentColor"} className={hollow ? "fill-card" : undefined}
          stroke="currentColor" strokeWidth={hollow ? 1.5 : 0} />
      ) : null}
    </svg>
  );
}

const Item = ({ children }) => <li className="flex items-center gap-1.5">{children}</li>;

export function TrendLegend({ card, channels, source }) {
  const { t } = useI18n();
  const primary = channels[card.series[0].key] ?? null;
  const thinned = card.series.map((s) => channels[s.key]).filter((c) => c?.thinned);
  return (
    <ul data-legend="" className="m-0 mt-2 flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0 text-11.5 text-mute">
      {Array.isArray(primary?.bands?.news2) ? (
        <Item>
          {t("patient.trendsBandNews2", { source })}:
          <Swatch className="fill-band-mid" /> {t("patient.trendsBandPoints12")}
          <Swatch className="fill-band-crit" /> {t("patient.trendsBandPoints3")}
        </Item>
      ) : null}
      {primary?.bands?.own_normal ? <Item><Swatch className="fill-band-n" dashed /> {t("patient.trendsBandOwn")}</Item> : null}
      <Item><Glyph kind="points" color={card.series[0].color} /> {t("patient.trendsLegendPoints")}</Item>
      {card.series.length > 1 ? card.series.map((s) => (
        <Item key={s.key}><Glyph kind="dot" color={s.color} hollow={s.hollow} /> {t(s.labelKey)}</Item>
      )) : null}
      <Item><Glyph kind="alarm" /> {t("patient.trendsMarkerAlarm")}</Item>
      <Item><Glyph kind="antibiotic" /> {t("patient.trendsMarkerAntibiotic")}</Item>
      {thinned.map((c) => (
        <Item key={c.key}>{t("patient.trendsThinned", { kept: c.points.length, total: c.total_points })}</Item>
      ))}
    </ul>
  );
}
```

- [ ] **Step 6: The dialog** — Write `dashboard/src/live/screens/patient/trends/TrendModal.jsx`:

```jsx
// src/live/screens/patient/trends/TrendModal.jsx — one card's chart, large (spec §3.2): the window
// (6 h / 24 h / 3 days, each a read of its own), a readout of the measurement under the cursor, the
// marks, and the legend.
//
// The readout is drawn for the eye and HIDDEN from assistive technology: a screen reader hears it
// only when the keyboard moved the cursor (Task 13), never on a mouse hover.
import React, { useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { ddmm, hhmm } from "../../../i18n/dates.js";
import { Modal, Seg } from "../../../ui/index.js";
import { nameOf } from "../../common/BoardState.jsx";
import { cardTitle, channelsOf } from "./cards.js";
import { TrendChart } from "./TrendChart.jsx";
import { TrendLegend } from "./TrendLegend.jsx";
import { markerAtTime, parseMarkers, parsePoints } from "./trendGeometry.js";
import { measuredKeyOf, useTrends } from "./useTrends.js";

const WINDOWS = [
  { value: 6, key: "patient.trendsHours6" },
  { value: 24, key: "patient.trendsHours24" },
  { value: 72, key: "patient.trendsHours72" },
];

/** When, as the chart's own time labels write it: with the date over three days. */
export const whenText = (ms, hours) => (hours === 72 ? `${ddmm(ms)} ${hhmm(ms)}` : hhmm(ms));

/** What a mark says in the readout and the table: an alarm with the engine's kind, a dose by name. */
export function markText(t, mark) {
  return mark.kind === "alarm" ? `${t("patient.trendsMarkerAlarm")}: ${mark.label}` : t("patient.trendsMarkerAntibiotic");
}

/** "HH:MM · 132 /dəq", the channel named when the card has two, and the mark within a pixel. */
function readoutOf(t, card, point, mark, hours) {
  const series = card.series[0];
  const value = `${card.series.length > 1 ? `${t(series.labelKey)} ` : ""}${point.value} ${t(series.unitKey)}`;
  return [whenText(point.ms, hours), value, mark ? markText(t, mark) : null].filter(Boolean).join(" · ");
}

export function TrendModal({ card, patient, bed, onClose }) {
  const { t } = useI18n();
  const [hours, setHours] = useState(24);
  const [cursor, setCursor] = useState(null);   // { index, how: "mouse" | "key" }
  const [plotWidth, setPlotWidth] = useState(0);
  const trends = useTrends(patient.patient_id, hours, measuredKeyOf(patient.measuredAt));
  const channels = channelsOf(trends.data);
  const primary = channels[card.series[0].key] ?? null;
  const series = card.series.map((s) => ({ key: s.key, color: s.color, hollow: s.hollow, points: parsePoints(channels[s.key]?.points) }));
  const markers = parseMarkers(trends.data?.markers);
  const sinceMs = Date.parse(trends.data?.since);
  const untilMs = Date.parse(trends.data?.until);
  const title = cardTitle(t, card);
  const at = cursor ? series[0].points[cursor.index] ?? null : null;
  const mark = at ? markerAtTime(markers, at.ms, plotWidth > 0 ? (untilMs - sinceMs) / plotWidth : 0) : null;
  const readout = at ? readoutOf(t, card, at, mark, hours) : null;
  const count = series.reduce((n, s) => n + s.points.length, 0);

  const choose = (value) => {
    setHours(value);
    setCursor(null);
  };

  return (
    <Modal open wide title={[bed, nameOf(patient, t), title].join(" · ")} onClose={onClose}>
      <Seg label={t("patient.trendsHoursLabel")} value={hours} onChange={choose}
        options={WINDOWS.map((w) => ({ value: w.value, label: t(w.key) }))} />
      {trends.unreadable ? (
        <p className="m-0 mt-2 text-12 font-semibold text-att-ink">
          {t("patient.trendsUnreadable", { time: trends.lastOkAt ? hhmm(trends.lastOkAt) : "—" })}
        </p>
      ) : null}
      {trends.data ? (
        <>
          <p data-readout="" aria-hidden="true" className="m-0 mt-3 min-h-[1.5em] font-data text-13 font-semibold text-ink">
            {readout ?? t("patient.trendsReadoutIdle")}
          </p>
          <TrendChart
            series={series} bands={primary?.bands ?? null} markers={markers} sinceMs={sinceMs} untilMs={untilMs}
            hours={hours} height={280} big label={t("patient.trendsChartLabel", { channel: title, hours, count })}
            cursor={cursor?.index ?? null} onPlot={setPlotWidth}
            onCursor={(index, how) => setCursor(index === null ? null : { index, how })}
          />
          <TrendLegend card={card} channels={channels} source={trends.data.bands_source} />
        </>
      ) : trends.loading ? (
        <p className="m-0 mt-3 text-12.5 text-mute">{t("patient.trendsLoading")}</p>
      ) : null}
    </Modal>
  );
}
```

- [ ] **Step 7: Cards open it.** Write `dashboard/src/live/screens/patient/trends/TrendsBox.jsx` (whole):

```jsx
// src/live/screens/patient/trends/TrendsBox.jsx — the patient's vital trends (Group 2 · slice 1),
// where the dashed "Vital eğrileri" placeholder stood.
//
// THE BROWSER DRAWS; IT NEVER SCORES. Every fact this box shows about a value — its NEWS2 points,
// the band it sits in, whether it is inside the patient's charted normal, how it moved — is the
// engine's (GET /patients/{id}/trends, homunculus-engine api/trends.py), printed or drawn as it
// came. Nothing here or below it computes a band, a threshold, a delta or a point.
//
// It never says less than it knows: an unreadable read keeps the last answer on screen and says so
// in the header, with the time that answer came (the monitor strip's rule), and it is a plain line,
// not an alert — nothing the clinician did was refused.
import React, { useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { hhmm } from "../../../i18n/dates.js";
import { Box } from "../../../ui/index.js";
import { CARDS, channelsOf } from "./cards.js";
import { TrendCard } from "./TrendCard.jsx";
import { TrendModal } from "./TrendModal.jsx";
import { measuredKeyOf, useTrends } from "./useTrends.js";

export function TrendsBox({ patient, bed, nowMs }) {
  const { t } = useI18n();
  const trends = useTrends(patient.patient_id, 24, measuredKeyOf(patient.measuredAt));
  const [open, setOpen] = useState(null);       // the id of the card whose big chart is open
  const channels = channelsOf(trends.data);
  const sinceMs = Date.parse(trends.data?.since);
  const untilMs = Date.parse(trends.data?.until);
  const card = CARDS.find((c) => c.id === open) ?? null;
  return (
    <Box title={t("patient.trends")} icon="chart" level={2} right={t("patient.trendsNote")}>
      <div data-trends-box="">
        {trends.unreadable ? (
          <p className="m-0 mb-2 text-12 font-semibold text-att-ink">
            {t("patient.trendsUnreadable", { time: trends.lastOkAt ? hhmm(trends.lastOkAt) : "—" })}
          </p>
        ) : null}
        {trends.loading ? <p className="m-0 text-12.5 text-mute">{t("patient.trendsLoading")}</p> : null}
        {trends.data ? (
          <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 min-[861px]:grid-cols-2 min-[1200px]:grid-cols-3">
            {CARDS.map((c) => (
              <TrendCard key={c.id} card={c} channels={channels} nowMs={nowMs} sinceMs={sinceMs} untilMs={untilMs}
                onOpen={() => setOpen(c.id)} />
            ))}
          </ul>
        ) : null}
      </div>
      {card ? <TrendModal card={card} patient={patient} bed={bed} onClose={() => setOpen(null)} /> : null}
    </Box>
  );
}
```

Edit `PatientScreen.jsx` — replace `          <TrendsBox patient={patient} nowMs={nowMs} />` with:

```jsx
          <TrendsBox patient={patient} bed={bed} nowMs={nowMs} />
```

(`bed` is the server's bed label, else the id — the screen's own rule, never `display_name` — and is what the dialog's title and every refusal name.)

- [ ] **Step 8: Green, then the gate.**

```bash
cd /c/tmp/g2-vital/dashboard
npx vitest run src/live/screens/patient/ src/reachable.test.js src/live/boundaries.test.js src/live/rawKeys.test.jsx 2>&1 | grep -E "Test Files|Tests |×"
```
Expected: no `×`; TrendModal 8, trendGeometry 17, PatientScreen 57. Then the suite — **87 / 2020** — and the build.

- [ ] **Step 9: Commit.**

```bash
cd /c/tmp/g2-vital
git add dashboard/src/live/screens/patient/trends/trendGeometry.js dashboard/src/live/screens/patient/trends/trendGeometry.test.js dashboard/src/live/screens/patient/trends/TrendChart.jsx dashboard/src/live/screens/patient/trends/TrendLegend.jsx dashboard/src/live/screens/patient/trends/TrendModal.jsx dashboard/src/live/screens/patient/trends/TrendModal.test.jsx dashboard/src/live/screens/patient/trends/TrendsBox.jsx dashboard/src/live/screens/patient/PatientScreen.jsx dashboard/src/live/screens/patient/PatientScreen.test.jsx
git status --short && git diff --cached --stat
git commit -m "feat(patient): the big chart — 6 h / 24 h / 3 days, a readout under the mouse, the legend in words" -m "A card opens TrendModal (kit Modal: focus in, Escape out, focus back). Each window is a read of its own. The readout says time, value, unit and the mark within one pixel column (markerAtTime, from the plot width the chart reports) and is aria-hidden. The legend names the server's NEWS2 source, both tones' points, the charted normal, dots vs dashed intervals, both series of the pressure card, both marks, and a thinned channel's counts.

red: TrendModal import unresolved; trendGeometry 1 failed (markerAtTime); PatientScreen 1 failed (the card was not a button)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: The keyboard, the one announcement, and the table view

Spec §3.2 (keyboard cursor, Grafik | Tablo, the table) and §7. The big chart becomes one tab stop (`tabIndex=0`, `role="img"`, its keys described by a visible hint through `aria-describedby`); ← → move the cursor one measurement, Home / End to the first and last, staying put at either end; the readout follows, and **only a keyboard move** is said, once, through `Announce` (a hover empties the region). The `Seg` "Qrafik | Cədvəl" swaps in `TrendTable`: the kit `Table` with a caption, a `th scope="row"` time per row, newest first, every reading the chart draws with **the engine's NEWS2 points for that reading** (the endpoint's third column, printed — "+3", "0", "—"), and each mark as a row of its own. `trendText.js` holds how both views word a time, a mark and a point total.

**Files:**
- Create: `trends/trendText.js`, `trends/TrendTable.jsx`
- Modify: `trends/TrendChart.jsx`, `trends/TrendModal.jsx` (Write, whole), `trends/TrendModal.test.jsx`

- [ ] **Step 1: The tests.** Edit `trends/TrendModal.test.jsx` — replace its last test and the describe's close:

```jsx
  it("shows no NEWS2 band in the legend of a channel the engine scores none for", async () => {
    await open("lactate", answering((pid, hours) => trends(pid, [channel("lactate", [point(60, 4.1)])], { hours })));
    expect(dialog().querySelector("[data-legend]")).not.toHaveTextContent("NEWS2");
  });
});
```

with:

```jsx
  it("shows no NEWS2 band in the legend of a channel the engine scores none for", async () => {
    await open("lactate", answering((pid, hours) => trends(pid, [channel("lactate", [point(60, 4.1)])], { hours })));
    expect(dialog().querySelector("[data-legend]")).not.toHaveTextContent("NEWS2");
  });
});

describe("the big chart by keyboard", () => {
  const THREE = answering((pid, hours) => trends(pid, [channel("heart_rate",
    [point(180, 80, 0), point(120, 84, 0), point(60, 132, 3)])], { hours }));
  const wait = (ms) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

  it("is one tab stop, its keys described in words", async () => {
    await open("heart_rate", THREE);
    const svg = within(dialog()).getByRole("img");
    expect(svg).toHaveAttribute("tabindex", "0");
    expect(document.getElementById(svg.getAttribute("aria-describedby")))
      .toHaveTextContent("Qrafik seçiləndə ← → növbəti ölçmə, Home/End ilk və son ölçmə.");
  });

  it("walks the measurements with ← → Home End, and the readout follows", async () => {
    await open("heart_rate", THREE);
    const svg = within(dialog()).getByRole("img");
    const readout = () => dialog().querySelector("[data-readout]").textContent;
    const press = (key) => fireEvent.keyDown(svg, { key });
    press("ArrowRight");
    expect(readout()).toBe(`${hhmm(NOW - 3 * 3_600_000)} · 80 /dəq`);
    press("ArrowRight");
    expect(readout()).toBe(`${hhmm(NOW - 2 * 3_600_000)} · 84 /dəq`);
    press("End");
    expect(readout()).toBe(`${hhmm(NOW - 3_600_000)} · 132 /dəq`);
    press("ArrowRight");                                                // stays on the last
    expect(readout()).toBe(`${hhmm(NOW - 3_600_000)} · 132 /dəq`);
    press("Home");
    press("ArrowLeft");                                                 // stays on the first
    expect(readout()).toBe(`${hhmm(NOW - 3 * 3_600_000)} · 80 /dəq`);
    expect(svg.querySelector("[data-cursor]")).not.toBeNull();
  });

  it("says the readout once after a keyboard move, and nothing after the mouse", async () => {
    await open("heart_rate", THREE);
    const svg = within(dialog()).getByRole("img");
    const region = within(dialog()).getByRole("status");
    fireEvent.mouseMove(svg, { clientX: xOf(60) });
    await wait(200);
    expect(region).toHaveTextContent("");
    fireEvent.keyDown(svg, { key: "End" });
    await wait(200);
    expect(region).toHaveTextContent(`${hhmm(NOW - 3_600_000)} · 132 /dəq`);
    fireEvent.mouseMove(svg, { clientX: xOf(120) });
    await wait(200);
    expect(region.textContent).toBe("");
  });
});

describe("the big chart as a table", () => {
  const MIXED = answering((pid, hours) => trends(pid, [channel("heart_rate",
    [point(180, 80, 0), point(120, 72, 3), point(60, 132, 3)])], { hours, markers: [marker(90, "antibiotic")] }));
  const table = async () => {
    await act(async () => { fireEvent.click(within(dialog()).getByRole("button", { name: "Cədvəl" })); await settle(); });
    return within(dialog()).getByRole("table", { name: "Nəbz — ölçmələr, ən yenisi yuxarıda" });
  };

  it("holds exactly what the chart draws, newest first", async () => {
    await open("heart_rate", MIXED);
    const drawn = [...within(dialog()).getByRole("img").querySelectorAll("circle[data-value]")]
      .map((c) => [c.dataset.ts, c.dataset.value]);
    const listed = [...(await table()).querySelectorAll("tr[data-value]")].map((r) => [r.dataset.ts, r.dataset.value]);
    expect(listed).toEqual([...drawn].reverse());
  });

  it("prints the engine's points for each reading — 72 with +3 because the server said 3", async () => {
    await open("heart_rate", MIXED);
    const row = (await table()).querySelector("tr[data-value='72']");
    expect(within(row).getAllByRole("cell").map((c) => c.textContent)).toEqual(["72", "/dəq", "+3", ""]);
  });

  it("gives each mark a row of its own, in time order with the readings", async () => {
    await open("heart_rate", MIXED);
    const rows = [...(await table()).querySelectorAll("tbody tr")];
    expect(rows.map((r) => r.dataset.value ?? r.dataset.mark)).toEqual(["132", "antibiotic", "72", "80"]);
    expect(rows[1]).toHaveTextContent("antibiotik");
  });

  it("is a real table: a caption, column headers, and the time heading each row", async () => {
    await open("heart_rate", MIXED);
    const grid = await table();
    expect(within(grid).getAllByRole("columnheader").map((h) => h.textContent))
      .toEqual(["Saat", "Dəyər", "Vahid", "NEWS2 balı", "İşarə"]);
    expect(within(grid).getAllByRole("rowheader")).toHaveLength(4);
  });
});
```

Run it: `npx vitest run src/live/screens/patient/trends/TrendModal.test.jsx 2>&1 | grep -E "Tests "` → `Tests  7 failed | 8 passed (15)` (no tab stop, no keys, no status region, no "Cədvəl").

- [ ] **Step 2: The chart takes the keyboard.** Four Edits in `trends/TrendChart.jsx`.

(a) Replace `import { ddmm, hhmm } from "../../../i18n/dates.js";` with:

```jsx
import { ddmm, hhmm } from "../../../i18n/dates.js";
import { FOCUS_RING } from "../../../ui/focus.js";
```

(b) Replace `  label, cursor = null, onCursor, onPlot,` with:

```jsx
  label, cursor = null, onCursor, onPlot, onKeyDown, describedBy,
```

(c) Replace:

```jsx
  const named = label ? { role: "img", "aria-label": label } : { "aria-hidden": "true", focusable: "false" };
```

with:

```jsx
  const named = label ? { role: "img", "aria-label": label } : { "aria-hidden": "true", focusable: "false" };
  // The big chart is one tab stop whose arrow keys move the cursor (the dialog's `onKeyDown`).
  const keys = onKeyDown ? { tabIndex: 0, onKeyDown, "aria-describedby": describedBy } : {};
```

(d) Replace:

```jsx
        width="100%" height={height} viewBox={`0 0 ${width} ${height}`} className="block" {...named}
```

with:

```jsx
        width="100%" height={height} viewBox={`0 0 ${width} ${height}`}
        className={`block rounded-ctl ${onKeyDown ? FOCUS_RING : ""}`} {...named} {...keys}
```

- [ ] **Step 3: The words both views share** — Write `dashboard/src/live/screens/patient/trends/trendText.js`:

```js
// src/live/screens/patient/trends/trendText.js — how the big chart's readout and its table word an
// instant and a mark, so the two views of one chart never say one thing two ways.
import { ddmm, hhmm } from "../../../i18n/dates.js";

/** When, as the chart's own time labels write it: with the date over three days. */
export const whenText = (ms, hours) => (hours === 72 ? `${ddmm(ms)} ${hhmm(ms)}` : hhmm(ms));

/** What a mark says: an alarm with the engine's own kind (data, not translated), a dose by name. */
export function markText(t, mark) {
  return mark.kind === "alarm" ? `${t("patient.trendsMarkerAlarm")}: ${mark.label}` : t("patient.trendsMarkerAntibiotic");
}

/** The engine's NEWS2 points for one reading, as a column prints them: "+3", "0", or "—" for none. */
export const pointsText = (points) => (Number.isInteger(points) ? (points > 0 ? `+${points}` : "0") : "—");
```

- [ ] **Step 4: The table** — Write `dashboard/src/live/screens/patient/trends/TrendTable.jsx`:

```jsx
// src/live/screens/patient/trends/TrendTable.jsx — the big chart as a table (spec §3.2, §7): every
// measurement the chart draws, newest first, with the ENGINE'S NEWS2 points for that reading (the
// endpoint's third column — printed, never looked up here), and each mark as a row of its own. The
// same numbers the SVG shows; TrendModal.test.jsx holds the two views equal.
import React from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { Table } from "../../../ui/index.js";
import { cardTitle } from "./cards.js";
import { parseMarkers, parsePoints } from "./trendGeometry.js";
import { markText, pointsText, whenText } from "./trendText.js";

export function TrendTable({ card, channels, markers, hours }) {
  const { t } = useI18n();
  const two = card.series.length > 1;
  const rows = [
    ...card.series.flatMap((s) => parsePoints(channels[s.key]?.points).map((p) => ({ ms: p.ms, key: `${s.key}-${p.iso}`, series: s, p }))),
    ...parseMarkers(markers).map((m) => ({ ms: m.ms, key: `${m.kind}-${m.iso}`, mark: m })),
  ].sort((a, b) => b.ms - a.ms);
  return (
    <Table caption={t("patient.trendsCaption", { channel: cardTitle(t, card) })} className="mt-3">
      <thead>
        <tr>
          <th scope="col">{t("patient.trendsColTime")}</th>
          {two ? <th scope="col">{t("patient.trendsColChannel")}</th> : null}
          <th scope="col">{t("patient.trendsColValue")}</th>
          <th scope="col">{t("patient.trendsColUnit")}</th>
          <th scope="col">{t("patient.trendsColBand")}</th>
          <th scope="col">{t("patient.trendsColMarker")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (row.mark ? (
          <tr key={row.key} data-mark={row.mark.kind}>
            <th scope="row" className="font-data font-semibold">{whenText(row.ms, hours)}</th>
            {two ? <td /> : null}
            <td />
            <td />
            <td />
            <td>{markText(t, row.mark)}</td>
          </tr>
        ) : (
          <tr key={row.key} data-ts={row.p.iso} data-value={row.p.value} data-series={row.series.key}>
            <th scope="row" className="font-data font-semibold">{whenText(row.ms, hours)}</th>
            {two ? <td>{t(row.series.labelKey)}</td> : null}
            <td className="font-data font-bold">{Number.isFinite(row.p.value) ? row.p.value : "—"}</td>
            <td>{t(row.series.unitKey)}</td>
            <td className="font-data">{pointsText(row.p.points)}</td>
            <td />
          </tr>
        )))}
      </tbody>
    </Table>
  );
}
```

(The kit `Table` turns its frame into a named, focusable scroll region when it is wider than the screen — the 390 px case.)

- [ ] **Step 5: The dialog, whole** — Write `dashboard/src/live/screens/patient/trends/TrendModal.jsx`:

```jsx
// src/live/screens/patient/trends/TrendModal.jsx — one card's chart, large (spec §3.2): the window
// (6 h / 24 h / 3 days, each a read of its own), a readout of the measurement under the cursor, the
// marks and the legend — and the same numbers as a table (Grafik | Tablo).
//
// The cursor follows the mouse, and the arrow keys, Home and End when the chart has focus. The
// readout is drawn for the eye and HIDDEN from assistive technology; a screen reader hears it once
// per KEYBOARD move (`Announce`), never on a mouse hover — a live region that spoke at every pixel of
// a hover would drown everything else the dialog says.
import React, { useId, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { hhmm } from "../../../i18n/dates.js";
import { Announce, Modal, Seg } from "../../../ui/index.js";
import { nameOf } from "../../common/BoardState.jsx";
import { cardTitle, channelsOf } from "./cards.js";
import { TrendChart } from "./TrendChart.jsx";
import { TrendLegend } from "./TrendLegend.jsx";
import { TrendTable } from "./TrendTable.jsx";
import { markerAtTime, parseMarkers, parsePoints } from "./trendGeometry.js";
import { markText, whenText } from "./trendText.js";
import { measuredKeyOf, useTrends } from "./useTrends.js";

const WINDOWS = [
  { value: 6, key: "patient.trendsHours6" },
  { value: 24, key: "patient.trendsHours24" },
  { value: 72, key: "patient.trendsHours72" },
];

/** "HH:MM · 132 /dəq", the channel named when the card has two, and the mark within a pixel. */
function readoutOf(t, card, point, mark, hours) {
  const series = card.series[0];
  const value = `${card.series.length > 1 ? `${t(series.labelKey)} ` : ""}${point.value} ${t(series.unitKey)}`;
  return [whenText(point.ms, hours), value, mark ? markText(t, mark) : null].filter(Boolean).join(" · ");
}

/** Where a key moves the cursor among the measurements that can be drawn; null for any other key. */
function step(key, points, index) {
  const drawable = points.flatMap((p, i) => (Number.isFinite(p.value) ? [i] : []));
  if (drawable.length === 0) return null;
  const at = index === null ? -1 : drawable.indexOf(index);
  const first = drawable[0];
  const last = drawable[drawable.length - 1];
  if (key === "Home") return first;
  if (key === "End") return last;
  if (key === "ArrowRight") return at < 0 ? first : drawable[Math.min(at + 1, drawable.length - 1)];
  if (key === "ArrowLeft") return at < 0 ? last : drawable[Math.max(at - 1, 0)];
  return null;
}

export function TrendModal({ card, patient, bed, onClose }) {
  const { t } = useI18n();
  const hintId = useId();
  const [hours, setHours] = useState(24);
  const [view, setView] = useState("graph");
  const [cursor, setCursor] = useState(null);   // { index, how: "mouse" | "key" }
  const [plotWidth, setPlotWidth] = useState(0);
  const trends = useTrends(patient.patient_id, hours, measuredKeyOf(patient.measuredAt));
  const channels = channelsOf(trends.data);
  const primary = channels[card.series[0].key] ?? null;
  const series = card.series.map((s) => ({ key: s.key, color: s.color, hollow: s.hollow, points: parsePoints(channels[s.key]?.points) }));
  const markers = parseMarkers(trends.data?.markers);
  const sinceMs = Date.parse(trends.data?.since);
  const untilMs = Date.parse(trends.data?.until);
  const title = cardTitle(t, card);
  const at = cursor ? series[0].points[cursor.index] ?? null : null;
  const mark = at ? markerAtTime(markers, at.ms, plotWidth > 0 ? (untilMs - sinceMs) / plotWidth : 0) : null;
  const readout = at ? readoutOf(t, card, at, mark, hours) : null;
  const count = series.reduce((n, s) => n + s.points.length, 0);

  const choose = (value) => {
    setHours(value);
    setCursor(null);
  };
  const onKeyDown = (event) => {
    const next = step(event.key, series[0].points, cursor?.index ?? null);
    if (next === null) return;
    event.preventDefault();
    setCursor({ index: next, how: "key" });
  };

  return (
    <Modal open wide title={[bed, nameOf(patient, t), title].join(" · ")} onClose={onClose}>
      <div className="flex flex-wrap items-center gap-2">
        <Seg label={t("patient.trendsHoursLabel")} value={hours} onChange={choose}
          options={WINDOWS.map((w) => ({ value: w.value, label: t(w.key) }))} />
        <Seg label={t("patient.trendsViewLabel")} value={view} onChange={setView}
          options={[{ value: "graph", label: t("patient.trendsGraph") }, { value: "table", label: t("patient.trendsTable") }]} />
      </div>
      {trends.unreadable ? (
        <p className="m-0 mt-2 text-12 font-semibold text-att-ink">
          {t("patient.trendsUnreadable", { time: trends.lastOkAt ? hhmm(trends.lastOkAt) : "—" })}
        </p>
      ) : null}
      {trends.data && view === "graph" ? (
        <>
          <p data-readout="" aria-hidden="true" className="m-0 mt-3 min-h-[1.5em] font-data text-13 font-semibold text-ink">
            {readout ?? t("patient.trendsReadoutIdle")}
          </p>
          <TrendChart
            series={series} bands={primary?.bands ?? null} markers={markers} sinceMs={sinceMs} untilMs={untilMs}
            hours={hours} height={280} big label={t("patient.trendsChartLabel", { channel: title, hours, count })}
            cursor={cursor?.index ?? null} onPlot={setPlotWidth} onKeyDown={onKeyDown} describedBy={hintId}
            onCursor={(index, how) => setCursor(index === null ? null : { index, how })}
          />
          <p id={hintId} className="m-0 mt-1 text-11 text-mute">{t("patient.trendsKeysHint")}</p>
          <TrendLegend card={card} channels={channels} source={trends.data.bands_source} />
        </>
      ) : null}
      {trends.data && view === "table" ? (
        <TrendTable card={card} channels={channels} markers={trends.data.markers} hours={hours} />
      ) : null}
      {!trends.data && trends.loading ? <p className="m-0 mt-3 text-12.5 text-mute">{t("patient.trendsLoading")}</p> : null}
      <Announce text={cursor?.how === "key" && readout ? readout : ""} />
    </Modal>
  );
}
```

(`whenText` and `markText` moved to trendText.js; nothing else imported them from here.)

- [ ] **Step 6: Green, then the gate.**

```bash
cd /c/tmp/g2-vital/dashboard
npx vitest run src/live/screens/patient/trends/ src/reachable.test.js 2>&1 | grep -E "Test Files|Tests |×"
```
Expected: no `×`; `Test Files  7 passed (7)` (the folder's six + reachable), `Tests  69 passed (69)` (66 in the folder: useTrends 9, news2Tone 2, TrendCard 11, trendGeometry 17, TrendChart 12, TrendModal 15; reachable 3). Then the suite — **87 / 2027** — and the build.

- [ ] **Step 7: Commit.**

```bash
cd /c/tmp/g2-vital
git add dashboard/src/live/screens/patient/trends/trendText.js dashboard/src/live/screens/patient/trends/TrendTable.jsx dashboard/src/live/screens/patient/trends/TrendModal.jsx dashboard/src/live/screens/patient/trends/TrendModal.test.jsx dashboard/src/live/screens/patient/trends/TrendChart.jsx
git status --short && git diff --cached --stat
git commit -m "feat(patient): the big chart by keyboard, said once, and as a table" -m "The chart is one tab stop with its keys described; arrows, Home and End walk the measurements and the readout follows; a keyboard move is announced once (Announce), a hover never. Grafik | Tablo: the kit Table, newest first, the engine's NEWS2 points per reading printed (72 reads +3 when the server says 3), each mark a row of its own — the same numbers the SVG draws.

red: 7 failed — no tab stop, no keys, no status region, no table" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: The patient's own normal — the form

Spec §3.3, §3.4 and D4, with X8, X14, X15, X17. For a `clinical.chart` holder the box's header offers "Xəstənin norması…" — once the trends have answered and while they are readable, because the engine replaces the whole baseline set with what is sent and the form must open on the set it replaces. Five rows (pulse, respiration, SpO₂, systolic, temperature — `BASELINE_KEYS`, held equal to api/clinical.py `BASELINE_SIGNALS` by a test that reads that file), each "alt" / "üst", prefilled from `bands.own_normal`. Held inline before anything is sent: one side without the other, a bound that is not a number (a decimal comma is read as a point), low above high. Every filled pair is sent as `{baselines}` alone; an emptied pair is not sent and the engine deletes it — the form says so, and says the comorbidities are not touched. All pairs empty: Save is `aria-disabled` and says why; nothing is sent. 200 → toast "…yadda saxlanıldı…", the trends read again, the form closes, no alert anywhere. 400 → the engine's reason on the toast named after the bed, the form stays open. 403 → the toast says the right is gone, the form closes. No answer → `mayHaveLanded`: the trends read again, the clinician is told to look at the band, the form closes. While in flight: Save `busy`, the fields `readOnly`, the dialog will not close, "…yadda saxlanılır…" said once.

**Files:**
- Create: `trends/BaselineForm.jsx`, `trends/BaselineForm.test.jsx`
- Modify: `trends/TrendsBox.jsx`, `PatientScreen.test.jsx`

- [ ] **Step 1: The form's tests** — Write `dashboard/src/live/screens/patient/trends/BaselineForm.test.jsx`:

```jsx
// The patient's own normal: what the form holds back, what it sends, and what the clinician reads
// after — the confirmation AND the absence of any alert on success (amendments (a)), the bed-named
// refusal on the toast and never inline, the may-have-landed rule on no answer.
import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount } from "../../../session/mount.testutil.jsx";
import { profile, token } from "../../../session/testTokens.testutil.js";
import { BASELINE_KEYS, BaselineForm } from "./BaselineForm.jsx";

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../../homunculus-engine/src/homunculus");
const CHARTABLE = ["board.view", "alerts.ack", "clinical.chart"];
const PATIENT = { patient_id: "S-001", display_name: "Ayşe Sentetik", measuredAt: {} };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const wait = (ms) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

async function open({ own = {}, answer } = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const mounted = await mount(<BaselineForm patient={PATIENT} bed="REA-01 · 2" own={own} onClose={onClose} onSaved={onSaved} />, {
    access: token({ perms: CHARTABLE }), me: profile({ perms: CHARTABLE }),
    setup: (api) => api.putPatientProfile.mockImplementation(answer ?? (() => Promise.resolve({ patient_id: "S-001" }))),
  });
  return { ...mounted, onClose, onSaved };
}
const dialog = () => screen.getByRole("dialog", { name: "Xəstənin norması" });
const row = (key) => dialog().querySelector(`[data-baseline='${key}']`);
const type = (key, side, value) => fireEvent.change(within(row(key)).getByLabelText(side === "low" ? "alt" : "üst"), { target: { value } });
const save = () => act(async () => { fireEvent.click(within(dialog()).getByRole("button", { name: "Yadda saxla" })); await settle(); });
const toastText = () => document.body.textContent;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the patient's own normal", () => {
  it("offers exactly the vitals the engine keeps a baseline for (api/clinical.py BASELINE_SIGNALS)", () => {
    const source = fs.readFileSync(path.join(ENGINE, "api", "clinical.py"), "utf8");
    const block = /BASELINE_SIGNALS[^{]*\{([^}]*)\}/.exec(source)[1];
    expect([...block.matchAll(/"(\w+)":/g)].map((m) => m[1]).sort()).toEqual([...BASELINE_KEYS].sort());
  });

  it("opens with what is charted, says it is not a monitor alarm, and says an emptied range is deleted", async () => {
    await open({ own: { heart_rate: { low: 100, high: 115 } } });
    expect(within(row("heart_rate")).getByLabelText("alt")).toHaveValue("100");
    expect(within(row("heart_rate")).getByLabelText("üst")).toHaveValue("115");
    expect(within(row("spo2")).getByLabelText("alt")).toHaveValue("");
    expect(dialog()).toHaveTextContent("Bu aralıqlar monitorun siqnal həddi deyil");
    expect(dialog()).toHaveTextContent("Boş saxlanılan aralıq silinir. Yanaşı xəstəliklərə toxunulmur.");
  });

  it("holds one side without the other, in words, and sends nothing", async () => {
    const { api } = await open();
    type("spo2", "low", "88");
    await save();
    expect(within(row("spo2")).getByText("hər iki hədd lazımdır")).toBeInTheDocument();
    expect(api.putPatientProfile).not.toHaveBeenCalled();
  });

  it("holds low above high and a bound that is not a number, as the engine would refuse them", async () => {
    const { api } = await open();
    type("heart_rate", "low", "120");
    type("heart_rate", "high", "100");
    type("temperature", "low", "otuz");
    type("temperature", "high", "37");
    await save();
    expect(within(row("heart_rate")).getByText("alt hədd üst həddən böyükdür")).toBeInTheDocument();
    expect(within(row("temperature")).getByText("rəqəm daxil edin")).toBeInTheDocument();
    expect(api.putPatientProfile).not.toHaveBeenCalled();
  });

  it("sends the whole filled set — the charted pairs too, a decimal comma as a point — and nothing but baselines", async () => {
    const { api } = await open({ own: { heart_rate: { low: 100, high: 115 } } });
    type("temperature", "low", "36,0");
    type("temperature", "high", "37.5");
    await save();
    expect(api.putPatientProfile).toHaveBeenCalledWith("S-001", {
      baselines: { heart_rate: { low: 100, high: 115 }, temperature: { low: 36, high: 37.5 } },
    });
  });

  it("does not send an emptied pair: the engine deletes it", async () => {
    const { api } = await open({ own: { heart_rate: { low: 100, high: 115 }, resp_rate: { low: 12, high: 22 } } });
    type("heart_rate", "low", "");
    type("heart_rate", "high", "");
    await save();
    expect(api.putPatientProfile).toHaveBeenCalledWith("S-001", { baselines: { resp_rate: { low: 12, high: 22 } } });
  });

  it("with nothing to send, Save says why, stays focusable and sends nothing", async () => {
    const { api } = await open();
    const button = within(dialog()).getByRole("button", { name: "Yadda saxla" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    expect(dialog()).toHaveTextContent("Göndəriləcək aralıq yoxdur");
    await save();
    expect(api.putPatientProfile).not.toHaveBeenCalled();
  });

  it("a save the engine took: the confirmation, the trends read again, the form closed — and no alert", async () => {
    const { onClose, onSaved } = await open({ own: { heart_rate: { low: 100, high: 115 } } });
    await save();
    expect(screen.getAllByText("Xəstənin norması yadda saxlanıldı; mühərrik yenidən qiymətləndirdi.").length).toBeGreaterThan(0);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByRole("alert").map((a) => a.textContent).join(" ").trim()).toBe("");
  });

  it("a refusal goes on the toast, named after the bed and never inline, and the form stays open", async () => {
    const refused = Object.assign(new Error("profil boş olamaz — komorbidite, bazal aralık veya bazal SOFA gerekir"), { status: 400 });
    const { onClose, onSaved } = await open({ own: { heart_rate: { low: 100, high: 115 } }, answer: () => Promise.reject(refused) });
    await save();
    expect(toastText()).toContain("REA-01 · 2: xəstənin norması yadda saxlanılmadı — profil boş olamaz");
    expect(within(dialog()).queryAllByRole("alert")).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("a right taken away meanwhile (403): the toast says so, and the form closes", async () => {
    const refused = Object.assign(new Error("permission required: clinical.chart"), { status: 403 });
    const { onClose } = await open({ own: { heart_rate: { low: 100, high: 115 } }, answer: () => Promise.reject(refused) });
    await save();
    expect(toastText()).toContain("REA-01 · 2: xəstənin norması yadda saxlanılmadı — bu əməliyyat üçün artıq səlahiyyətiniz yoxdur (clinical.chart)");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("no answer: it may have landed — the trends are read again and the clinician is told to look at the band", async () => {
    const silent = Object.assign(new Error("Sunucu yanıt vermedi."), { code: "REQUEST_TIMEOUT" });
    const { onClose, onSaved } = await open({ own: { heart_rate: { low: 100, high: 115 } }, answer: () => Promise.reject(silent) });
    await save();
    expect(toastText()).toContain("REA-01 · 2: server cavab vermədi; xəstənin norması yadda saxlanılmış ola bilər — qrafikdəki zolağı yoxlayın.");
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("while in flight: Save is busy and says so, the fields are read-only, and the dialog will not close", async () => {
    const { onClose } = await open({ own: { heart_rate: { low: 100, high: 115 } }, answer: () => new Promise(() => {}) });
    await save();
    const button = within(dialog()).getByRole("button", { name: "Yadda saxla" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(within(row("heart_rate")).getByLabelText("alt")).toHaveAttribute("readonly");
    await wait(200);
    expect(within(dialog()).getAllByRole("status").map((s) => s.textContent)).toContain("Xəstənin norması yadda saxlanılır…");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

Run it → red: `Error: Failed to resolve import "./BaselineForm.jsx" …`.

- [ ] **Step 2: The form** — Write `dashboard/src/live/screens/patient/trends/BaselineForm.jsx`:

```jsx
// src/live/screens/patient/trends/BaselineForm.jsx — "the patient's normal" (spec §3.3): the patient's
// own range for the five vitals the engine keeps a baseline for, written through the engine's profile
// door (PUT /clinical/{id}/profile) by a `clinical.chart` holder.
//
// THE ENGINE REPLACES THE WHOLE SET WITH WHAT IS SENT (api/clinical.py `profile_from_payload`). So the
// form opens with what is charted and sends every filled pair; an emptied pair is a deleted baseline,
// and the form says so under the fields. Only `baselines` is sent: the comorbidities and the baseline
// SOFA are not in the body, so the engine keeps them (`backendApi.putPatientProfile`, not `setProfile`).
//
// Held here before sending, in the reader's words, exactly what the engine would refuse: one side
// without the other, a bound that is not a number, low above high. Nothing else is judged — what a
// range means is the engine's, and anything this form lets through is the engine's to refuse.
//
// A refusal goes on the toast, named after the bed, and never also inline (amendments (a), (f)); a
// write that got no answer may have landed (`mayHaveLanded`, the one rule): the trends are read again
// and the clinician is told to look at the band. `busy` holds Save (never `disabled`, amendment (c))
// and the fields go read-only while the write is in flight.
import React, { useEffect, useRef, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { useSession } from "../../../session/SessionProvider.jsx";
import { apiErrorText } from "../../../apiErrors.js";
import { Announce, Button, Field, Input, Modal, Note, useToast } from "../../../ui/index.js";
import { VITALS } from "../../common/vitals.js";
import { mayHaveLanded } from "../../admin/refusal.js";

/** The vitals the engine keeps a baseline for, in the bed card's order. A mirror of api/clinical.py
 *  BASELINE_SIGNALS — BaselineForm.test.jsx reads that file and holds the two equal. MAP and lactate
 *  have none, so they are not offered (spec D4). */
export const BASELINE_KEYS = Object.freeze(["heart_rate", "resp_rate", "spo2", "sbp", "temperature"]);
const META = Object.fromEntries(VITALS.map((v) => [v.at, v]));

const shown = (v) => (typeof v === "number" && Number.isFinite(v) ? String(v) : "");
/** A typed bound: "" when empty, its number (a decimal comma read as a point), NaN when not one. */
function bound(raw) {
  const s = String(raw ?? "").trim().replace(",", ".");
  if (s === "") return "";
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : Number.NaN;
}

/** What the rows would send, and each row's problem as `{ side, key }`. */
export function checkBaselines(rows) {
  const errors = {};
  const baselines = {};
  for (const key of BASELINE_KEYS) {
    const low = bound(rows[key]?.low);
    const high = bound(rows[key]?.high);
    if (low === "" && high === "") continue;
    if (low === "" || high === "") errors[key] = { side: low === "" ? "low" : "high", key: "patient.baselineBothOrNeither" };
    else if (Number.isNaN(low) || Number.isNaN(high)) errors[key] = { side: Number.isNaN(low) ? "low" : "high", key: "patient.baselineNotNumber" };
    else if (low > high) errors[key] = { side: "low", key: "patient.baselineLowAboveHigh" };
    else baselines[key] = { low, high };
  }
  return { errors, baselines };
}

export function BaselineForm({ patient, bed, own, onClose, onSaved }) {
  const { t } = useI18n();
  const { store } = useSession();
  const toast = useToast();
  const [rows, setRows] = useState(() => Object.fromEntries(
    BASELINE_KEYS.map((key) => [key, { low: shown(own?.[key]?.low), high: shown(own?.[key]?.high) }])));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const { errors, baselines } = checkBaselines(rows);
  const nothing = Object.keys(baselines).length === 0 && Object.keys(errors).length === 0;
  const errorOf = (key, side) => (tried && errors[key]?.side === side ? t(errors[key].key) : undefined);
  const edit = (key, side) => (event) => {
    const { value } = event.target;
    setRows((current) => ({ ...current, [key]: { ...current[key], [side]: value } }));
  };

  async function save() {
    if (busy || nothing) return;
    setTried(true);
    if (Object.keys(errors).length > 0) return;
    const epoch = store.epoch();
    setBusy(true);
    try {
      await store.track(() => store.api.putPatientProfile(patient.patient_id, { baselines }));
      if (epoch !== store.epoch()) return;
      toast(t("patient.baselineSaved"));
      onSaved();
      onClose();
    } catch (err) {
      if (err?.superseded || epoch !== store.epoch()) return;
      if (mayHaveLanded(err)) {
        toast(t("patient.baselineMayHaveLanded", { subject: bed }), "warn");
        onSaved();
        onClose();
      } else if (err?.status === 403) {
        toast(t("patient.baselineRefused", { subject: bed, reason: t("patient.baselineNoRight") }), "error");
        onClose();
      } else {
        toast(t("patient.baselineRefused", { subject: bed, reason: apiErrorText(t, err) }), "error");
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <Modal
      open title={t("patient.baselineTitle")} onClose={onClose} busy={busy}
      actions={(
        <>
          <Button variant="ghost" onClick={onClose} busy={busy}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={save} busy={busy} aria-disabled={nothing ? "true" : undefined}>{t("common.save")}</Button>
        </>
      )}
    >
      <Note tone="info" icon="user">{t("patient.baselineNotDeviceAlarm")}</Note>
      {BASELINE_KEYS.map((key) => (
        <fieldset key={key} data-baseline={key} className="m-0 mt-3 min-w-0 border-0 p-0">
          <legend className="mb-1 p-0 text-12.5 font-semibold">
            {t(META[key].labelKey)} <span className="font-normal text-mute">({t(META[key].unitKey)})</span>
          </legend>
          <div className="grid grid-cols-2 gap-x-2">
            <Field label={t("patient.baselineLow")} layout="col" error={errorOf(key, "low")}>
              <Input inputMode="decimal" autoComplete="off" value={rows[key].low} onChange={edit(key, "low")} readOnly={busy} />
            </Field>
            <Field label={t("patient.baselineHigh")} layout="col" error={errorOf(key, "high")}>
              <Input inputMode="decimal" autoComplete="off" value={rows[key].high} onChange={edit(key, "high")} readOnly={busy} />
            </Field>
          </div>
        </fieldset>
      ))}
      <p className="m-0 mt-2 text-12 text-mute">{t("patient.baselineClearsNote")}</p>
      {nothing ? <p className="m-0 mt-1 text-12 font-semibold text-att-ink">{t("patient.baselineNothingToSend")}</p> : null}
      <Announce text={busy ? t("patient.baselineSaving") : ""} />
    </Modal>
  );
}
```

`npx vitest run src/live/screens/patient/trends/BaselineForm.test.jsx 2>&1 | grep -E "Tests "` → `Tests  12 passed (12)`. (Each row is a `<fieldset>` whose `<legend>` names the vital, so a reader hears "Nəbz (/dəq), alt" rather than five identical "alt" fields.)

- [ ] **Step 3: The screen offers it — tests first.** Edit `PatientScreen.test.jsx` — replace:

```jsx
    it("say they cannot be read, and since when, without raising an alert", async () => {
```

with:

```jsx
    it("offer the patient's normal to nobody without clinical.chart", async () => {
      await open({ payload: board([entry("S-001", [], FULL)]) });
      expect(screen.queryByRole("button", { name: "Xəstənin norması…" })).toBeNull();
    });

    it("open the patient's normal from the box, prefilled from the trends, and read them again after a save", async () => {
      const { api } = await open({
        payload: board([entry("S-001", [], FULL)]),
        perms: ["board.view", "alerts.ack", "clinical.chart"],
        setup: (api) => {
          api.patientTrends.mockImplementation(answering((pid, hours) => trends(pid, [channel("heart_rate", [point(5, 108, 1)],
            { bands: { news2: null, own_normal: { low: 100, high: 115 }, device: null } })], { hours })));
          api.putPatientProfile.mockResolvedValue({ patient_id: "S-001" });
        },
      });
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Xəstənin norması…" })); await settle(); });
      const form = screen.getByRole("dialog", { name: "Xəstənin norması" });
      expect(within(form.querySelector("[data-baseline='heart_rate']")).getByLabelText("alt")).toHaveValue("100");
      const reads = api.patientTrends.mock.calls.length;
      await act(async () => { fireEvent.click(within(form).getByRole("button", { name: "Yadda saxla" })); await settle(); });
      expect(api.putPatientProfile).toHaveBeenCalledWith("S-001", { baselines: { heart_rate: { low: 100, high: 115 } } });
      expect(api.patientTrends.mock.calls.length).toBe(reads + 1);
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("say they cannot be read, and since when, without raising an alert", async () => {
```

Run it: `Tests  1 failed | 58 passed (59)` (no button yet).

- [ ] **Step 4: The button and the form in the box.** Two Edits in `trends/TrendsBox.jsx`.

(a) Replace:

```jsx
import React, { useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { hhmm } from "../../../i18n/dates.js";
import { Box } from "../../../ui/index.js";
import { CARDS, channelsOf } from "./cards.js";
import { TrendCard } from "./TrendCard.jsx";
import { TrendModal } from "./TrendModal.jsx";
import { measuredKeyOf, useTrends } from "./useTrends.js";

export function TrendsBox({ patient, bed, nowMs }) {
  const { t } = useI18n();
  const trends = useTrends(patient.patient_id, 24, measuredKeyOf(patient.measuredAt));
  const [open, setOpen] = useState(null);       // the id of the card whose big chart is open
  const channels = channelsOf(trends.data);
  const sinceMs = Date.parse(trends.data?.since);
  const untilMs = Date.parse(trends.data?.until);
  const card = CARDS.find((c) => c.id === open) ?? null;
  return (
    <Box title={t("patient.trends")} icon="chart" level={2} right={t("patient.trendsNote")}>
```

with:

```jsx
import React, { useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { hhmm } from "../../../i18n/dates.js";
import { useSession } from "../../../session/SessionProvider.jsx";
import { Box, Button } from "../../../ui/index.js";
import { BASELINE_KEYS, BaselineForm } from "./BaselineForm.jsx";
import { CARDS, channelsOf } from "./cards.js";
import { TrendCard } from "./TrendCard.jsx";
import { TrendModal } from "./TrendModal.jsx";
import { measuredKeyOf, useTrends } from "./useTrends.js";

export function TrendsBox({ patient, bed, nowMs }) {
  const { t } = useI18n();
  const { user } = useSession();
  const trends = useTrends(patient.patient_id, 24, measuredKeyOf(patient.measuredAt));
  const [open, setOpen] = useState(null);       // the id of the card whose big chart is open
  const [editing, setEditing] = useState(false);
  const channels = channelsOf(trends.data);
  const sinceMs = Date.parse(trends.data?.since);
  const untilMs = Date.parse(trends.data?.until);
  const card = CARDS.find((c) => c.id === open) ?? null;
  // The form replaces the whole baseline set, so it opens only on a set this box has READ: offered
  // to a `clinical.chart` holder once the trends answered, and not while they cannot be read.
  const canEdit = (user?.perms?.includes("clinical.chart") ?? false) && Boolean(trends.data) && !trends.unreadable;
  const own = Object.fromEntries(BASELINE_KEYS.map((key) => [key, channels[key]?.bands?.own_normal ?? null]));
  const right = (
    <>
      <span>{t("patient.trendsNote")}</span>
      {canEdit ? (
        <Button size="sm" icon="edit" className="ml-2" onClick={() => setEditing(true)}>{t("patient.baselineOpen")}</Button>
      ) : null}
    </>
  );
  return (
    <Box title={t("patient.trends")} icon="chart" level={2} right={right}>
```

(b) Replace:

```jsx
      {card ? <TrendModal card={card} patient={patient} bed={bed} onClose={() => setOpen(null)} /> : null}
    </Box>
```

with:

```jsx
      {card ? <TrendModal card={card} patient={patient} bed={bed} onClose={() => setOpen(null)} /> : null}
      {editing ? (
        <BaselineForm patient={patient} bed={bed} own={own} onClose={() => setEditing(false)} onSaved={trends.reload} />
      ) : null}
    </Box>
```

- [ ] **Step 5: Green, then the gate.**

```bash
cd /c/tmp/g2-vital/dashboard
npx vitest run src/live/screens/patient/ src/reachable.test.js src/live/boundaries.test.js src/live/rawKeys.test.jsx src/live/i18n/ 2>&1 | grep -E "Test Files|Tests |×"
```
Expected: no `×`; PatientScreen 59, BaselineForm 12. Then the suite — **88 / 2041** — and the build.

- [ ] **Step 6: Commit.**

```bash
cd /c/tmp/g2-vital
git add dashboard/src/live/screens/patient/trends/BaselineForm.jsx dashboard/src/live/screens/patient/trends/BaselineForm.test.jsx dashboard/src/live/screens/patient/trends/TrendsBox.jsx dashboard/src/live/screens/patient/PatientScreen.test.jsx
git status --short && git diff --cached --stat
git commit -m "feat(patient): the patient's own normal — five ranges, the whole set, written through the engine's profile door" -m "Offered to clinical.chart once the trends answered (the engine replaces the whole set, so the form opens on the set it replaces). Held inline: both bounds, a number, low <= high. Sends {baselines} alone; an emptied pair is deleted and the form says so; nothing to send is aria-disabled with the reason. 200: toast, trends re-read, closed, no alert. 400: the engine's reason on the toast, named after the bed. 403: toast, closed. No answer: may have landed, re-read, told to look at the band.

red: BaselineForm import unresolved; PatientScreen 1 failed (no button)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

# Part 4 · The whole (Tasks 15–17)

### Task 15: The sweeps and the full gates

Spec §8 and §12 (acceptance 1, 2, 4). `rawKeys.test.jsx` renders every built screen and checks no raw key reaches a reader — but the dialog, its table and the form open only on a click, so the sweep never saw them. It gains a trends answer that reaches every card state and an anchor test that opens all three. Then every gate this slice touches: the dashboard suite and build, the backend suite without and with the database, the new files on Python 3.14, and acceptance 2's timing.

**Files:**
- Modify: `dashboard/src/live/rawKeys.test.jsx`
- Uses (not in the repo): `/c/tmp/homunculus-plans/g2v/trends_timing.py`

- [ ] **Step 1: The fixture and the stub.** Four Edits in `dashboard/src/live/rawKeys.test.jsx`.

(a) Replace:

```jsx
import { ADMIN_READS } from "./screens/admin/admin.testutil.js";
```

with:

```jsx
import { ADMIN_READS } from "./screens/admin/admin.testutil.js";
import { BANDS, channel, marker, point, trends } from "./screens/patient/trends/trends.testutil.js";
```

(b) Replace:

```jsx
/** The shell on one address, as LiveApp nests it, with the board LIVE and its first reload landed. */
```

with:

```jsx
/** The trend charts (Group 2 · slice 1), reaching every card state: a red frame with the
 *  own-normal pill and a delta, a single reading, an amber frame, the two-series pressure card, a
 *  thinned channel and a lactate never measured; and both kinds of mark for the dialog. */
const TRENDS = trends(FIXTURE_ID, [
  channel("heart_rate", [point(60, 120, 2), point(5, 132, 3)], {
    latest: { ts: point(5, 0)[0], value: 132, delta: 12, news2_points: 3, within_own_normal: true },
    bands: { news2: BANDS.heart_rate, own_normal: { low: 100, high: 135 }, device: null },
  }),
  channel("resp_rate", [point(5, 22, 2)]),
  channel("spo2", [point(30, 93, 2)]),
  channel("sbp", [point(30, 118, 0)]),
  channel("map", [point(30, 80)]),
  channel("temperature", [point(90, 37.9, 0), point(30, 38.2, 1)], { thinned: true, total_points: 2400 }),
], { markers: [marker(45, "alarm"), marker(20, "antibiotic")] });

/** The shell on one address, as LiveApp nests it, with the board LIVE and its first reload landed. */
```

(c) Replace (in `openAt`'s setup):

```jsx
      ADMIN_READS(api);
      api.shadowBoard.mockResolvedValue(STRIP);
    },
  });
```

with:

```jsx
      ADMIN_READS(api);
      api.shadowBoard.mockResolvedValue(STRIP);
      api.patientTrends.mockImplementation((pid, hours) => Promise.resolve({ ...TRENDS, patient_id: pid, hours }));
    },
  });
```

(d) Replace:

```jsx
  // The same anchor for Aşama A's monitor strip: with no strip in the shadow store, every
```

with:

```jsx
  // The same anchor for the trend charts: the cards are on the patient screen, but the big chart, its
  // table and the patient's-normal form open only on a click, so the sweep above never saw them.
  it("the trend charts' keys resolve on the cards, in the big chart, its table and the form", async () => {
    const mounted = await openAt(`/patients/${FIXTURE_ID}`);
    await act(async () => { await settle(); });
    const box = document.querySelector("[data-trends-box]");
    expect(box).toHaveTextContent("NEWS2 +3");                                          // trendsFrameBadge
    expect(box).toHaveTextContent("Xəstənin normasında");                               // trendsOwnNormalPill
    expect(box).toHaveTextContent("↑ +12 (əvvəlkinə görə)");                            // trendsDelta
    expect(box).toHaveTextContent("tək ölçmə");                                         // trendsSingle
    expect(box).toHaveTextContent("Bu kanal üçün ölçmə yoxdur");                        // trendsNoData
    const offenders = [...rawKeys(document.body)];
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Nəbz: böyük qrafiki aç/ })); await settle(); });
    expect(screen.getByRole("dialog")).toHaveTextContent("NEWS2 zolağı (yetkin) · mənbə news2-rcp-2017");
    offenders.push(...rawKeys(document.body));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Cədvəl" })); await settle(); });
    expect(screen.getByRole("table")).toHaveTextContent("siqnal: news2");
    offenders.push(...rawKeys(document.body));
    await act(async () => { fireEvent.keyDown(document, { key: "Escape" }); await settle(); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Bədən hərarəti: böyük qrafiki aç/ })); await settle(); });
    expect(screen.getByRole("dialog")).toHaveTextContent("seyrəldilib: 2400 nöqtədən 2");
    await act(async () => { fireEvent.keyDown(document, { key: "Escape" }); await settle(); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Xəstənin norması…" })); await settle(); });
    expect(screen.getByRole("dialog", { name: "Xəstənin norması" })).toHaveTextContent("Boş saxlanılan aralıq silinir.");
    offenders.push(...rawKeys(document.body));
    expect(offenders).toEqual([]);
    act(() => { mounted.board.clear(); mounted.shadow.clear(); });
  });

  // The same anchor for Aşama A's monitor strip: with no strip in the shadow store, every
```

(`PERMS` is the whole catalogue, so `clinical.chart` is in it and the form's button is drawn.)

- [ ] **Step 2: Run the sweep.** `npx vitest run src/live/rawKeys.test.jsx 2>&1 | grep -E "Tests "` → `Tests  7 passed (7)`.

- [ ] **Step 3: Prove the net bites** (then put it back). Edit `trends/TrendCard.jsx`: replace `t("patient.trendsSingle")` with `t("patient.trendsSingel")`, and run the sweep again. Expected — three nets catch it: `[i18n] "patient.trendsSingel" has no az text — showing the key.`; `× … every screen this build has renders its texts …` with `patient (/patients/S-001) → patient.trendsSingel`; `× … the trend charts' keys resolve …` (its `tək ölçmə` is now the raw key); `× … names no key the dictionaries do not have …` with `screens\patient\trends\TrendCard.jsx → patient.trendsSingel (az, tr, ru, en)`. Edit it back to `t("patient.trendsSingle")` and re-run: `Tests  7 passed (7)`. **Nothing of this step is committed.**

- [ ] **Step 4: The dashboard gate.** The suite: **88 files / 2042 tests**; the build: `built in`, `precache  20 entries`, no `larger than 500 kB`. Then, by hand, read the dashboard part of `git diff b6ed65d --stat`: every new file under `src/live/screens/patient/trends/` is under ~250 lines (the largest, `TrendModal.test.jsx`, ≈ 210; `TrendModal.jsx` ≈ 145).

- [ ] **Step 5: The backend, without the database.**

```bash
cd /c/tmp/g2-vital/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -1
```
Expected: `2070 passed, 648 skipped` (≈ 100 s). (2074 once Task 16 has landed.)

- [ ] **Step 6: The backend with Postgres, in four parts** (each under the 10-minute call limit; one at a time — they share `homunculus_test_g2v` and its advisory lock):

```bash
cd /c/tmp/g2-vital/homunculus-engine
DB=postgresql+asyncpg://homunculus:homunculus@localhost:55432/homunculus_test_g2v
TEST_DATABASE_URL=$DB PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q $(ls tests/test_a*.py) 2>&1 | tail -1
```
```bash
cd /c/tmp/g2-vital/homunculus-engine
DB=postgresql+asyncpg://homunculus:homunculus@localhost:55432/homunculus_test_g2v
TEST_DATABASE_URL=$DB PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q $(ls tests/test_[b-h]*.py) tests/rules tests/scoring tests/tenant 2>&1 | tail -1
```
```bash
cd /c/tmp/g2-vital/homunculus-engine
DB=postgresql+asyncpg://homunculus:homunculus@localhost:55432/homunculus_test_g2v
TEST_DATABASE_URL=$DB PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q $(ls tests/test_[i-r]*.py | grep -v test_infinity_vm_pilot.py) 2>&1 | tail -1
```
```bash
cd /c/tmp/g2-vital/homunculus-engine
DB=postgresql+asyncpg://homunculus:homunculus@localhost:55432/homunculus_test_g2v
TEST_DATABASE_URL=$DB PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q $(ls tests/test_[s-z]*.py) 2>&1 | tail -1
```
Expected (measured with the whole slice in place): `846 passed` (8 min 44 s — if a slow day takes it past 10 minutes, run `tests/test_ad*.py` and the other `test_a*.py` files separately); `508 passed, 1 skipped` (38 s); `1028 passed, 7 skipped` (89 s); `328 passed` before Task 16, `332 passed` after it (2 min 20 s). Total **2710 passed, 8 skipped** at this task (base 2617 / 8 + 93), **2714 / 8** after Task 16. `grep -v` keeps `test_infinity_vm_pilot.py` out of the third part: never let a glob pick it up.

- [ ] **Step 7: The slice's files on Python 3.14.**

```bash
cd /c/tmp/g2-vital/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:55432/homunculus_test_g2v PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/g115-py314/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_news2_bands.py tests/rules/test_news2.py tests/test_timeline_thin.py tests/test_audit_since.py tests/test_audit_postgres.py tests/test_trends.py tests/test_trends_api.py tests/test_infinity_shadow_isolation.py tests/test_board_permissions.py 2>&1 | tail -1
```
Expected: `239 passed` (14 + 65 + 15 + 17 + 11 + 21 + 21 + 18 + 57; Task 16 adds `test_scenario_rebase.py`'s 4 → 243).

- [ ] **Step 8: Acceptance 2 — the 72-hour window answers in under 300 ms.**

```bash
cd /c/tmp/g2-vital/homunculus-engine
PYTHONIOENCODING=utf-8 PYTHONPATH=src /c/tmp/f7-py312/venv/Scripts/python.exe /c/tmp/homunculus-plans/g2v/trends_timing.py 2>&1 | tail -1
```
Expected: `observations 864, points served 858, median 4.0 ms, max 4.5 ms` (± the machine; the bound is 300 ms). The script feeds 72 h of synthetic spot checks (six channels every 30 min) through `/ingest` of an in-process app and times ten `GET /patients/S-001/trends?hours=72`. The 5 s half of acceptance 2 is Task 2's `test_a_desaturation_survives_three_days_of_five_second_data`.

- [ ] **Step 9: Commit.**

```bash
cd /c/tmp/g2-vital
git add dashboard/src/live/rawKeys.test.jsx
git status --short && git diff --cached --stat
git commit -m "test(i18n): the raw-key sweep reaches the trend cards, the big chart, its table and the form" -m "rawKeys.test.jsx stubs patientTrends with an answer reaching every card state and opens the dialog, the table and the form, which the route sweep never saw. Gates at this commit: dashboard 88 / 2042, build clean; backend 2070 / 648 without the DB, 2710 / 8 with it (four parts); the slice's files 239 on 3.14; the 72 h window in ~4 ms." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 16: A replay the charts can draw, and the walk on the local stack

Spec §8 (end to end) and §12 acceptance 3–4, with X11. Code first: `loader.rebased(events, end)` moves a scenario so its last event lands at `end`, every gap kept; `scripts/replay.py` gains `--now`, `--url` and `--token-env` (the token from the environment variable it names, never from the command line). Then the walk — the steps a person runs, or an agent with a browser, on a local Docker stack with synthetic accounts and synthetic patients.

**Files:**
- Create: `homunculus-engine/tests/test_scenario_rebase.py`
- Modify: `homunculus-engine/src/homunculus/scenarios/loader.py`, `homunculus-engine/scripts/replay.py` (Write, whole)
- Uses (not in the repo): `/c/tmp/homunculus-plans/g2v/read_trends.py`; G1-15's synthetic stack files `/c/tmp/g115plan/stack/{local.env, compose.g115.yml}` (if missing, recreate them exactly as `/c/tmp/homunculus-plans/2026-10-14-g1-15-uctan-uca-ve-vm.md` A0 Step 2 lists)

- [ ] **Step 1: The test** — Write `homunculus-engine/tests/test_scenario_rebase.py`:

```python
"""`rebased()`: a scenario moved in time, for a replay the trend charts can draw.

The scenarios are written at fixed dates (2026-07-14, 2026-09-08) and the charts' window ends at the
server's now, so an unmoved replay into a local stack draws an empty chart. Moved, every gap between
two events is kept, only the dates change. Synthetic data only, like the scenarios themselves.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

import homunculus.scenarios
from homunculus.scenarios.loader import load_scenario, rebased

SCEN = Path(homunculus.scenarios.__file__).parent
SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "replay.py"
END = datetime(2026, 10, 19, 9, 0, tzinfo=timezone.utc)


def test_the_last_event_lands_at_the_end_and_every_gap_is_kept():
    events = load_scenario(SCEN / "news2_deterioration.yaml")
    moved = rebased(events, END)
    assert moved[-1][0] == END
    assert [b[0] - a[0] for a, b in zip(moved, moved[1:])] == [b[0] - a[0] for a, b in zip(events, events[1:])]


def test_the_resource_carries_the_moved_instant_and_the_original_is_untouched():
    events = load_scenario(SCEN / "septic_shock.yaml")
    before = events[0][1]["effectiveDateTime"]
    moved = rebased(events, END)
    assert moved[0][1]["effectiveDateTime"] == moved[0][0].isoformat()
    assert events[0][1]["effectiveDateTime"] == before
    assert moved[0][1]["valueQuantity"] == events[0][1]["valueQuantity"]


def test_an_empty_scenario_stays_empty_and_a_zone_less_end_is_refused():
    assert rebased([], END) == []
    with pytest.raises(ValueError, match="time zone"):
        rebased(load_scenario(SCEN / "stable_control.yaml"), datetime(2026, 10, 19, 9, 0))


def test_the_replay_script_reads_its_token_from_the_environment_never_its_command_line():
    """A token on a command line lands in a shell's history and in every process listing."""
    source = SCRIPT.read_text(encoding="utf-8")
    assert '"--token-env"' in source and '"--token"' not in source
    assert '"--now"' in source and "rebased(" in source
```

Run it: `… -q tests/test_scenario_rebase.py 2>&1 | grep -E "^E "` → `E   ImportError: cannot import name 'rebased' from 'homunculus.scenarios.loader' (…)`.

- [ ] **Step 2: `rebased()`.** Edit `homunculus-engine/src/homunculus/scenarios/loader.py` — replace:

```python
        out.append((ts, resource))
    out.sort(key=lambda pair: pair[0])
    return out
```

with:

```python
        out.append((ts, resource))
    out.sort(key=lambda pair: pair[0])
    return out


def rebased(events: list[tuple[datetime, dict]], end: datetime) -> list[tuple[datetime, dict]]:
    """The same events moved in time so the last one falls at `end`, every gap between two kept.

    For a replay into a local stack (scripts/replay.py `--now`): the scenarios are written at fixed
    dates, and the trend charts' window ends at the server's now, so an unmoved replay draws an
    empty chart. A copy: the loaded events are not changed.
    """
    if end.tzinfo is None or end.utcoffset() is None:
        raise ValueError("end must carry a time zone")
    if not events:
        return []
    shift = end - events[-1][0]
    return [(ts + shift, {**resource, "effectiveDateTime": (ts + shift).isoformat()})
            for ts, resource in events]
```

- [ ] **Step 3: The script** — Write `homunculus-engine/scripts/replay.py` (whole; its positional `scenario` and `delay` keep working as before):

```python
# homunculus-engine/scripts/replay.py
"""Replay a scenario into a running Homunculus API, one observation at a time, so the dashboard shows
a patient sliding into septic shock live. Synthetic data only.

    python scripts/replay.py [scenario.yaml] [delay_s] [--url URL] [--token-env NAME] [--now]

`--url` is the API's base: the dev server (http://localhost:8000, the default) or a local Docker
stack's web front, which proxies /ingest (e.g. http://127.0.0.1:18080). The token is read from the
environment variable `--token-env` names (HOMUNCULUS_TOKEN by default) and never from the command
line, where it would land in a shell's history and in every process listing; with none set, the dev
server's "dev-token". `--now` moves the scenario so its last event is now (`loader.rebased`): the
trend charts' window ends at the server's clock and the scenarios are written at fixed dates, so an
unmoved replay draws an empty chart.
"""
import argparse
import json
import os
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import homunculus.scenarios
from homunculus.scenarios.loader import load_scenario, rebased

SCEN = Path(homunculus.scenarios.__file__).parent


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(description="Replay a synthetic scenario into a Homunculus API.")
    parser.add_argument("scenario", nargs="?", default="septic_shock.yaml")
    parser.add_argument("delay", nargs="?", type=float, default=1.0, help="seconds between observations")
    parser.add_argument("--url", default="http://localhost:8000")
    parser.add_argument("--token-env", default="HOMUNCULUS_TOKEN",
                        help="the environment variable holding the device token")
    parser.add_argument("--now", action="store_true", help="move the scenario so it ends now")
    args = parser.parse_args(argv)

    token = os.environ.get(args.token_env) or "dev-token"
    events = load_scenario(SCEN / args.scenario)
    if args.now:
        events = rebased(events, datetime.now(timezone.utc))
    for _ts, fhir in events:
        req = urllib.request.Request(
            f"{args.url.rstrip('/')}/ingest",
            data=json.dumps(fhir).encode(),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        )
        urllib.request.urlopen(req).read()
        print("sent", fhir["code"]["coding"][0]["code"], fhir["valueQuantity"]["value"],
              fhir["effectiveDateTime"])
        time.sleep(args.delay)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Green, and commit the code.**

```bash
cd /c/tmp/g2-vital/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_scenario_rebase.py tests/test_scenario_loader.py tests/test_scenarios_e2e.py 2>&1 | tail -1
PYTHONPATH=src /c/tmp/f7-py312/venv/Scripts/python.exe scripts/replay.py --help | head -2
```
Expected: `9 passed` (4 + 1 + 4); `usage: replay.py [-h] [--url URL] [--token-env TOKEN_ENV] [--now]` / `[scenario] [delay]`. The whole no-DB suite: `2074 passed, 648 skipped`.

```bash
cd /c/tmp/g2-vital
git add homunculus-engine/src/homunculus/scenarios/loader.py homunculus-engine/scripts/replay.py homunculus-engine/tests/test_scenario_rebase.py
git status --short && git diff --cached --stat
git commit -m "feat(scripts): replay.py --now moves a scenario to end now; --url and --token-env reach a local stack" -m "loader.rebased keeps every gap and moves only the dates, so a replay lands inside the trend charts' window. The token comes from the environment variable --token-env names, never the command line.

red: ImportError: cannot import name 'rebased'" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 5: The local stack.** Synthetic accounts and the G1-15 scratch files only. The containers are named by the compose file (`homunculus-postgres`, `homunculus-api`, `homunculus-web`), so no other such stack may be up:

```bash
cd /c/tmp/g2-vital
ls /c/tmp/g115plan/stack/local.env /c/tmp/g115plan/stack/compose.g115.yml
docker ps -a --format '{{.Names}}' | grep -E '^homunculus-(postgres|api|web)$' || echo "no stack containers"
```
Expected: both files; `no stack containers`. If a container is listed, **stop and ask** — it may be another session's.

```bash
cd /c/tmp/g2-vital
C="docker compose -p g2v -f deploy/local/docker-compose.yml -f /c/tmp/g115plan/stack/compose.g115.yml --env-file /c/tmp/g115plan/stack/local.env"
$C build api web 2>&1 | grep -E "Built|ERROR|precache"
$C up -d postgres api web 2>&1 | tail -3
```
Expected: `Image g2v-api Built`, `precache  20 entries …`, `Image g2v-web Built`; three containers started. Re-run `docker inspect -f '{{.State.Health.Status}}' homunculus-api` until it prints `healthy` (≈ 30–60 s; do not loop on `sleep`), then `curl -s -o /dev/null -w "http %{http_code}\n" http://127.0.0.1:18080/health` → `http 200`. Always name the three services (`up -d` without them stops at the bridge image, which is not pullable here).

- [ ] **Step 6: Accounts and a ward.**

```bash
docker exec -e TEST_USER_PASSWORD='G115-Sentetik-Parola-1' -e SEED_TENANT_SLUG=demo-hastanesi homunculus-api python scripts/seed_test_users.py 2>&1 | grep -E "test\.(hemsire|denetci)"
cd /c/tmp/g2-vital/homunculus-engine
for s in news2_deterioration.yaml septic_shock.yaml; do HOMUNCULUS_TOKEN=$(grep '^TENANT_TOKEN=' /c/tmp/g115plan/stack/local.env | cut -d= -f2-) PYTHONPATH=src /c/tmp/f7-py312/venv/Scripts/python.exe scripts/replay.py $s 0.2 --url http://127.0.0.1:18080 --now | tail -1; done
TT=$(grep '^TENANT_TOKEN=' /c/tmp/g115plan/stack/local.env | cut -d= -f2-); curl -s -o /dev/null -w "chart %{http_code}\n" -X POST http://127.0.0.1:18080/clinical/bed-3 -H "Authorization: Bearer $TT" -H "Content-Type: application/json" -d '{"entries":[{"code":"antibiotic_administered","value":1}]}'
```
Expected: two lines naming `test.hemsire@homunculus.health` (nurse: `board.view`, `clinical.chart`) and `test.denetci@homunculus.health` (auditor: `board.view`, no `clinical.chart`); `sent temperature 39.4 <now>` and `sent platelets 95.0 <now>`; `chart 200`. The token is read inside each command and printed nowhere.

- [ ] **Step 7: What the engine answers** (synthetic values; writing them down is fine here, never on the VM):

```bash
cd /c/tmp/g2-vital/homunculus-engine
for p in bed-1 bed-3; do HOMUNCULUS_TOKEN=$(grep '^TENANT_TOKEN=' /c/tmp/g115plan/stack/local.env | cut -d= -f2-) PYTHONIOENCODING=utf-8 /c/tmp/f7-py312/venv/Scripts/python.exe /c/tmp/homunculus-plans/g2v/read_trends.py http://127.0.0.1:18080 $p 6; done
```
Expected (computed with the same engine in-process while this plan was written):
```
bed-1 6h heart_rate:5(130.0 Δ12.0 N2 2) | map:5(62.0 Δ-6.0 N2 None) | sbp:5(86.0 Δ-10.0 N2 3) | spo2:5(90.0 Δ-2.0 N2 3) | temperature:5(39.4 Δ0.5 N2 2) | resp_rate:5(28.0 Δ3.0 N2 3) | lactate:0
  marks [('alarm', 'news2')]
bed-3 6h heart_rate:0 | map:4(63.0 Δ1.0 N2 None) | sbp:0 | spo2:0 | temperature:0 | resp_rate:0 | lactate:3(3.4 Δ0.8 N2 None)
  marks [('alarm', 'sepsis'), ('alarm', 'antibiotic_due'), ('alarm', 'septic_shock'), ('antibiotic', 'antibiotic_administered')]
```

- [ ] **Step 8: The walk in a browser** (a person, or an agent driving a browser). Open `http://127.0.0.1:18080`, sign in as `test.hemsire@homunculus.health` / `G115-Sentetik-Parola-1`, Yataklar → `bed-1` (no identity: the heading reads "kimlik gözlənilir").
  1. Under the Sepsis / İlaç row: the note "SOFA formasının doldurulması və imzalanması …" (no "normal" in it), then the box **Vital qrafikləri** with "NEWS2 · yetkin zolaqları; …" and the button **Xəstənin norması…**.
  2. Six cards in this order: Nəbz, Tənəffüs, SpO2, Sistolik AT · MAP, Bədən hərarəti, Laktat. **Acceptance 3 — each frame is the engine's points from Step 7:** Nəbz amber "NEWS2 +2", Tənəffüs red "+3", SpO2 red "+3", Sistolik AT · MAP red "+3", Bədən hərarəti amber "+2", Laktat "Bu kanal üçün ölçmə yoxdur". Deltas: "↑ +12 (əvvəlkinə görə)" on Nəbz, "↓ −10 …" on Sistolik.
  3. Nəbz → the dialog "bed-1 · kimlik gözlənilir · Nəbz". Hover: the readout names time, value, "/dəq". Tab to the chart; ← → Home End move the cursor. 6 saat / 24 saat / 3 gün each re-draw. The ▲ sits at the right edge: the alarm's instant is when the server first raised it (the replay's wall clock), while the readings carry their rebased instants — the honest picture (open item O10). Legend: "NEWS2 zolağı (yetkin) · mənbə news2-rcp-2017: 1–2 bal 3 bal", dots and dashes, ▲ siqnal, ◆ antibiotik.
  4. Cədvəl: five rows, newest first, the values equal to the dots, "NEWS2 balı" equal to the frames; the ▲ as a row of its own. Escape closes and focus returns to the card.
  5. `bed-3`: Laktat and Sistolik AT · MAP cards with readings; in the Laktat dialog ▲ sepsis, antibiotic_due, septic_shock and ◆ antibiotik.
  6. Back on `bed-1`, **Xəstənin norması…**: five rows, no MAP and no lactate; enter Nəbz 120 – 135, Yadda saxla → the toast "Xəstənin norması yadda saxlanıldı; …", the Nəbz card now also wears "Xəstənin normasında" (130 is inside), its frame still amber; the dialog shows the dashed band. **Acceptance 3 — the form writes and the band appears.**
  7. Sign out; sign in as `test.denetci@homunculus.health`: the cards are there, the **Xəstənin norması…** button is not.
  8. **Acceptance 4:** at 390 px (devtools device toolbar, 390 × 844) and at 1440 px — no horizontal page scroll on the patient screen, in the big chart, in its table (it scrolls inside its own frame) and in the form; one column at 390, three at 1440. Ayarlar → Tema: Gece and Gün. Dil: az, tr, ru, en — no raw `patient.…` key anywhere.

- [ ] **Step 9: Tear it down.** `$C down -v` (with `C` set as in Step 5) → the three containers and the `g2v` volumes removed; `docker ps -a --format '{{.Names}}' | grep -E '^homunculus-(postgres|api|web)$' || echo "no stack containers"` → `no stack containers`. Nothing to commit: write the walk's outcome (pass / what differed) into Task 17's roadmap row.

---

### Task 17: The docs — the Turkish guide, the roadmap, the spec

The guide says what the charts show and what they never claim, and where the thresholds come from; the roadmap records Group 2's first item; the spec's §11 records what planning found. The guide's text describes the system's behaviour and cites the vault's source note by its id only — no new clinical claim.

**Files:**
- Modify: `docs/homunculus-rehber-TR.md`, `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`, `docs/superpowers/specs/2026-10-19-g2-vital-egrileri-design.md`

- [ ] **Step 1: The guide.** Four Edits in `docs/homunculus-rehber-TR.md` (§3.6, then a new §3.7).

(a) Replace:

```markdown
- *Şüpheli enfeksiyon — ekranın yazdığı tek şey:* Motorun sepsis kuralı yalnız şüpheli enfeksiyonu
```

with:

```markdown
- *Şüpheli enfeksiyon — ekranın yazdığı iki şeyden biri* (öteki hastanın normali, 3.7): Motorun sepsis kuralı yalnız şüpheli enfeksiyonu
```

(b) Replace:

```markdown
  ekran onun yeni hâlini gösterir. Yetkisi olmayana düğme çizilmez, nedeni yazılır. SOFA formunu
  doldurup imzalamak ve hastanın kendi normalini girmek Grup 2'de.
- *Göstermedikleri:* yaş, vücut yüzey alanı, hasta kimliğinden uydurulmuş hastane ya da protokol
  numarası, simüle monitör dalgası, hemşirelik risk skorları ve **vital eğrileri**.
```

with:

```markdown
  ekran onun yeni hâlini gösterir. Yetkisi olmayana düğme çizilmez, nedeni yazılır. SOFA formunu
  doldurup imzalamak sonraki grupta.
- *Göstermedikleri:* yaş, vücut yüzey alanı, hasta kimliğinden uydurulmuş hastane ya da protokol
  numarası, simüle monitör dalgası ve hemşirelik risk skorları. Vital eğrileri artık motorun
  kaydından çizilir (3.7).
```

(c) Replace:

```markdown
3. **"Vital eğrileri nerede?"** Grup 2'de. Motorda bir vitalin geçmişini veren uç henüz yok, pano
   yalnız son ölçümü gönderiyor; tarayıcı tek bir son değerden eğri uydurmaz.

---

## 4. "Neden bunu kullanmıyoruz" köşesi
```

with:

```markdown
3. **"Vital eğrileri nerede?"** Hasta ekranının altında, "Vital eğrileri" kutusunda (Grup 2 ·
   dilim 1, 3.7). Eğriler motorun kaydettiği ölçümlerdir; tarayıcı hiçbir değeri, bandı ya da
   puanı kendisi hesaplamaz.

### 3.7 Vital eğrileri (hasta ekranı · Grup 2, dilim 1)

Hasta ekranının "Vital eğrileri" kutusu motorun bu hasta için kaydettiği ölçümleri çizer. Kural
Grup 1'inkidir: **ekran çizer, puanlamaz.** Her bant, her NEWS2 puanı, her "hastanın normalinde"
yargısı ve her "öncekine göre" farkı motordan gelir (`GET /patients/{id}/trends`); tarayıcı
bunların hiçbirini hesaplamaz. Homunculus tanı koymaz; eğriler de koymaz.

**Ne gösterir**
- Altı kart: nabız, solunum, SpO₂, sistolik + MAP (bir kart, iki seri; MAP'in noktaları içi boş),
  vücut sıcaklığı, laktat. Her kartta son değer, bir önceki ölçüme göre fark ("↑ +6"), ölçümün ne
  kadar önce yapıldığı (sunucunun saatiyle) ve son 24 saatin küçük grafiği.
- **Çerçeve ve rozet motorun NEWS2 puanıdır:** o parametrenin son değeri 1–2 puan aldıysa amber,
  3 puan aldıysa kırmızı çerçeve ve "NEWS2 +3" rozeti. MAP ve laktat NEWS2 parametresi değildir;
  çerçeveleri yoktur.
- **"Hastanın normalinde" hapı:** son değer hekimin girdiği aralığın içindeyse. Hap çerçeveyi
  susturmaz, çerçeve de hapı gizlemez — iki olgu birlikte gösterilir.
- Karta basınca büyük grafik: 6 saat / 24 saat / 3 gün; imlecin altındaki ölçümün saati, değeri
  ve birimi; ▲ bir alarmın ilk çıktığı an, ◆ kaydedilmiş antibiyotik dozu; aynı sayıların tablosu,
  her ölçümün motorun verdiği NEWS2 puanıyla. Klavyeyle de gezilir; ekran okuyucu okumayı yalnız
  klavye hareketinde duyar.
- Noktalar ölçümdür; aralarındaki kesikli çizgi yalnız aradaki zamandır, ölçüm değildir.

**Bantlar nereden gelir**
- NEWS2 bantları motorun puanlamada kullandığı tablonun kendisidir (`rules/news2.py`
  `NEWS2_BANDS`); kaynağı kasadaki `news2-rcp-2017` notu. Yalnız yetişkin, SpO₂ için yalnız
  Ölçek 1. Yenidoğan için bant yoktur — bu boşluk kasada kayıtlı, ekranda kapatılmaz.
- "Hastanın normali" hekimin girdiği aralıktır. Cihazın kendi alarm sınırları Aşama B'de
  doğrulanınca eklenecek; şimdilik yoktur.

**Ne göstermez:** dalga formu (ECG vb.) — prototiptekiler sentetikti; Aşama A'nın monitör
değerleri (geçmiş tutulmuyor, doğrulanmadı, hastaya bağlanmadı); MAP ve laktat için kişisel normal
(motor tutmuyor).

**Çok veri olunca:** bir kanalda pencerede 2 000'den çok ölçüm varsa grafik seyreltilir — eşit
zaman dilimlerinin her birinde ilk, son, en düşük ve en yüksek ölçüm kalır, yani en kötü değer
kaybolmaz — ve gösterge "seyreltilmiş: N noktadan M" der. Bugünkü aralıklı ölçümler bu sınıra
yaklaşmaz.

**Hastanın normali (form):** `clinical.chart` yetkisi olan klinisyen kutunun başlığındaki
"Hastanın normali…" ile beş vital için alt ve üst sınır girer. İki sınır da gerekir; alt üstten
büyük olamaz. Motor gönderilen kümeyi bütünüyle yeniler: boş bırakılan aralık silinir,
komorbiditelere dokunulmaz. Bu aralık monitörün alarm sınırı değildir; motor bu hastanın
değerlerini yorumlarken (4. bölümdeki hastaya göreli katman) bu normali kullanır. Reddedilen bir
kayıt yatağın adıyla bildirimde söylenir; sunucu yanıt vermezse kaydın gerçekleşmiş olabileceği
söylenir ve eğri yeniden okunur.

---

## 4. "Neden bunu kullanmıyoruz" köşesi
```

- [ ] **Step 2: The roadmap.** Three Edits in `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`.

(a) Replace `| Kısmen (vital geçmişi ucu yok) |` with:

```markdown
| Kısmen — vital geçmişi: `GET /patients/{id}/trends` (G2 · dilim 1) |
```

(b) Replace:

```markdown
Prototipteki sabit sayılar (`core.js:499` `H.VITAL.al/nb`) kaynaksızdır, taşınmaz.
```

with (fill `<date>` with `git log -1 --format=%cs`, `<range>` with the first and last commit of this plan, `git log --format=%h b6ed65d..HEAD`, and `<walk>` with Task 16's outcome):

```markdown
Prototipteki sabit sayılar (`core.js:499` `H.VITAL.al/nb`) kaynaksızdır, taşınmaz.

**Grup 2 · durum**

| # | İş | Durum |
|---|---|---|
| G2-01 | Vital eğrileri (hasta ekranı): altı kart, büyük grafik (6 sa / 24 sa / 3 gün, tablo), hastanın normali formu; `GET /patients/{id}/trends` · spec: [2026-10-19](../specs/2026-10-19-g2-vital-egrileri-design.md) · plan: [G2 dilim 1](2026-10-19-g2-vital-egrileri.md) | Kod ✅ <date> · <range>. Backend 2074 / 648 (DB'siz), 2714 / 8 (Postgres); dashboard 88 dosya / 2042 test. Yerel yürüyüş: <walk>. **Açık:** az/ru yerel okuma; VM'de kullanıcının bakışı (gerçek bir hasta, 390 ve 1440 px, değerler yazılmaz); plandaki X1–X19 ve O1–O11 |
```

(c) Append to the two items the slice moved — replace:

```markdown
`rehydrate` (1 000 000) sınırı aşınca en yeni ack/first_seen/kayıtları kaybeder; `limit`'lerin üst sınırı da yok. → Grup 2, alarm kalitesi paneli yeniden bağlanmadan ÖNCE
- Kapsam okunamadığında (UNKNOWN) `/patients` 200 + yanlış not dönüyor, `_require_patient` 404 + `scope_denied` yazıyor; her yerde 503 olmalı. → Grup 2
```

with:

```markdown
`rehydrate` (1 000 000) sınırı aşınca en yeni ack/first_seen/kayıtları kaybeder; `limit`'lerin üst sınırı da yok. → Grup 2, alarm kalitesi paneli yeniden bağlanmadan ÖNCE · **G2 dilim 1:** üç günlük de `records(since=)` aldı (yalnız eğri ucu kullanıyor); `/audit`, `/alarm-quality` ve `rehydrate` hâlâ en eski N.
- Kapsam okunamadığında (UNKNOWN) `/patients` 200 + yanlış not dönüyor, `_require_patient` 404 + `scope_denied` yazıyor; her yerde 503 olmalı. → Grup 2 · **G2 dilim 1:** eğri ucu (`/patients/{id}/trends`) UNKNOWN'da 503 veriyor, `scope_denied` yazmıyor; öteki tek-hasta uçları hâlâ 404.
```

- [ ] **Step 3: The spec's open points.** Edit `docs/superpowers/specs/2026-10-19-g2-vital-egrileri-design.md` — replace:

```markdown
- Acceptance on the VM will show sparse charts today; that is the data, not the chart.
```

with:

```markdown
- Acceptance on the VM will show sparse charts today; that is the data, not the chart.
- **Found while planning (2026-10-19; `docs/superpowers/plans/2026-10-19-g2-vital-egrileri.md`,
  "What the code says", X1–X19):** the plan departs from this spec where the code made its letter
  impossible or unsafe — 503 for an unreadable scope, checked before `_require_patient` (X1); bands
  as `low < v <= high` (X2); alarm marks from `first_seen`, one per episode, not from `alert` rows
  (X3); antibiotic marks only for doses ≥ 1 (X4); each point carries the engine's NEWS2 points
  (X5); MAP at full colour with hollow dots, because reduced opacity measured 2.17–3.34:1 (X6);
  ages through `useBoardNow` (X7); a 400 only on the toast (X8); `onlyWrite` and `formsSoon`
  reworded (X9); 390 px checked in a browser (X10); `replay.py --now` (X11).
- The form cannot remove the last baseline (all pairs empty sends nothing), although the engine
  accepts `{"baselines": {}}` when a comorbidity or a baseline SOFA is charted (plan X15, O4).
- `PUT /clinical/{id}/profile` replaces the set with no lost-update check: two clinicians saving one
  patient's normal at once — the second wins silently (plan O3).
```

- [ ] **Step 4: Check and commit.** `git diff --stat` shows the three files only; read the guide's new §3.7 once in a Markdown preview (it renders under §3.6's three questions).

```bash
cd /c/tmp/g2-vital
git add docs/homunculus-rehber-TR.md docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md docs/superpowers/specs/2026-10-19-g2-vital-egrileri-design.md
git status --short && git diff --cached --stat
git commit -m "docs: the trend charts in the guide, Group 2's first row in the roadmap, what planning found in the spec" -m "Rehber §3.7: what the charts show and never claim, where every band comes from (NEWS2_BANDS, vault note news2-rcp-2017, adult, Scale 1; the clinician's normal; device limits at Stage B), thinning, the form's rules. Roadmap: G2-01 with counts and the walk's outcome; the audit and UNKNOWN-scope items say what this slice moved. Spec §11: the plan's departures and two open points." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Open items

| # | Item | Who | When |
|---|---|---|---|
| O1 | **Native reading of the Azerbaijani and Russian texts:** the 49 `patient.trends*` / `patient.baseline*` keys, the two reworded sentences (`onlyWrite`, `formsSoon`) and `errors.badTrendHours` were written by the planner. | A native-speaking clinician | Before the VM |
| O2 | **Stage B retention cap** on `PatientState._history` (unbounded per signal, spec §11). The trends endpoint scans a window linearly per request — 864 readings in ≈ 4 ms today — and thins only what it serves; 51 840 readings per channel per 72 h is Stage B's to bound. | Stage B's plan | Stage B |
| O3 | **Lost update on the profile.** `PUT /clinical/{id}/profile` replaces the baseline set with no expected-set check (Wave 3B's 14e closed this for the three `/admin` whole-set writes only). Two clinicians saving one patient's normal at once: the second wins, silently. | User decision; engine | Group 2 |
| O4 | **The form cannot remove the last baseline** (X15): all pairs empty sends nothing, though the engine would accept `{"baselines": {}}` whenever a comorbidity or a baseline SOFA is charted. Offer a "clear all" (with that condition) or keep as is. | User decision | — |
| O5 | **The departures X1–X9 need the user's nod**, above all X3 (marks from `first_seen`, not `alert` rows), X5 (a third element on every point) and X9 (two sentences reworded). | User | Before merge |
| O6 | UNKNOWN scope → 503 only on the trends route; every other single-patient route still answers 404 and writes `scope_denied` (roadmap l. 659). | Group 2 | — |
| O7 | `/audit`, `/alarm-quality` and `rehydrate` still read the oldest N (roadmap l. 658); `since` now exists for them to use. | Group 2 | Before the alarm-quality panel |
| O8 | `backendApi.setProfile` (backendApi.js:778–787) sends `comorbidities: []` by default and so clears every charted comorbidity when called with only baselines. No live screen calls it; the admission form (Group 2/3) must not, or must be fixed first. | Whoever builds the admission form | — |
| O9 | `errors.scopeUnreadable` speaks of the live stream ("canlı akış başlatılamadı"); a trends 503 maps to the same key. The trends screens print their own "okunamıyor" line and never that text, but a later screen that prints `apiErrorText` for a trends 503 would say "live stream". | i18n | Minor |
| O10 | **A mark's instant is the escalation clock's** (when the server first raised the episode); a reading's is its own measured instant. Live they are minutes apart; a replayed, back-filled or late-arriving reading can sit hours before its ▲ (seen in Task 16 with `--now`). Honest, but worth a sentence in the legend if the ward finds it confusing. | User, after the VM look | — |
| O11 | The brief's backend command fails 2 tests without `PYTHONPATH=src` (`ModuleNotFoundError` in a child process; the f7-py312 venv has no install of this worktree). This plan always sets it; installing the worktree editable into a venv is the other fix. | Environment | — |

**Commit trailer.** The controller's brief set `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` for this plan's tasks; amendments.md's latest recorded trailer is `Claude Opus 5.5`. Use the one the controller gives when the tasks run.

---

## Self-review

**Spec coverage, section by section.**

| Spec | Where |
|---|---|
| §1 the four deliverables | cards T10–T11; big chart T12–T13; the form T14; the endpoint T4–T5 |
| §2 D1 server composes, browser draws | T4 (everything computed there); every dashboard test hands the browser a contradicting fact (T10, T11, T13) |
| D2 frame from the engine's points + badge | T10 (`news2Tone`, frame, "NEWS2 +3"), reused for bands T11 |
| D3 own-normal pill beside the frame | T4 (`within_own_normal`), T10 (pill, frame kept) |
| D4 the form, five channels, `clinical.chart` | T14 (`BASELINE_KEYS` held to `api/clinical.py`), T6 (`putPatientProfile`) |
| D5 no waveforms | nothing drawn; T17 guide says so |
| D6 adult NEWS2, Scale 1 only | T1 (no Scale 2 row; test), T4 (`news2_scale: 1`), T8 (labels "yetişkin") |
| D7 Stage A not charted | T4 (imports nothing of it), T5 (isolation tests both ways) |
| D8 thinning 2 000 / 500 buckets, flagged | T2, T4 (`thinned`, `total_points`), T12 (legend) |
| D9 device limits reserved | T4 (`bands.device: None`, test) |
| §3.1 the box, header note, button, grid 1/2/3, card contents, 46 px mini chart, states, unreadable header, systolic + MAP, card is a button | T9 (box, note, unreadable), T10 (grid, values, delta, age, frame, pill, no data, single), T11 (mini chart), T12 (button), T14 (the header's button) |
| §3.2 the big chart: Modal, title, Seg hours (refetch), Grafik | Tablo, 280 px, time labels in the ward's zone, bands, points, connectors, ▲ ◆, readout with the nearest mark, mouse, keyboard, legend incl. thinned; table with caption and columns | T12 (dialog, hours, readout, mouse, legend), T13 (keyboard, Grafik | Tablo, table), T11 (labels, marks) |
| §3.3 the form: prefill, both-or-neither, low > high, full set, the note, all-empty, 200 / 400 / timeout / 403, button only with `clinical.chart` | T14 (+ X8, X14, X15, X17) |
| §3.4 who sees what | T5 (`board.view`), T14 (`clinical.chart`; the auditor has no button, T16 step 8.7) |
| §4 the endpoint and its rules | T4 (shape, order, points, latest, bands, markers, thinning), T5 (hours, 400/401/403/404/503, no audit row) with X1–X5 |
| §5.1 NEWS2 bands as data | T1 |
| §5.2 `thin` | T2 |
| §5.3 `records(since=)` on three logs | T3 |
| §5.4 `api/trends.py` and the route | T4, T5 |
| §5.5 isolation | T5 (imports; the shadow store never asked; the shadow token refused) |
| §6 `backendApi` | T6 |
| §6 the trends folder (7 modules) | T9 `useTrends`, `TrendsBox`; T10 `TrendCard`; T11 `trendGeometry`, `TrendChart`; T12–T13 `TrendModal`; T14 `BaselineForm` (+ `cards`, `news2Tone`, `TrendLegend`, `TrendTable`, `trendText`, `ageText` to keep files small and one mapping in one place) |
| §6 tokens + contrast | T7 |
| §6 i18n | T8 (and T9 removes `trendsSoon`) |
| §6 PatientScreen: placeholder replaced, `formsSoon` as a Note under Sepsis/Meds | T9 (+ X9) |
| §7 accessibility and honesty | text equivalents T10 (card text, mini chart hidden) and T13 (table); keyboard T12–T13; colour never alone T10 (badge), T11 (dashed own normal, hollow MAP), T12 (legend); announcement only on keyboard T13; ages on the server's clock T10; 390 px T10 (classes) + T16 (browser); dashed connectors + legend sentence T11–T12 |
| §8 tests | engine T1–T5 (named files), dashboard T6–T15, end to end T16 |
| §9 keys | T8 (all 31 new + 18) |
| §10 not in this slice | nothing built for it |
| §11 risks | T17 updates it; O2 |
| §12 acceptance 1 | T15 steps 4–7 (3.12, 3.14, dashboard; counts here) |
| acceptance 2 | T15 step 8 (≈ 4 ms), T2 (5 s series ≤ 2 000, flagged in T4) |
| acceptance 3 | T16 steps 7–8 |
| acceptance 4 | T15 (rawKeys sweep, contrast via T7), T16 step 8.8 (390/1440, four languages, both themes) |
| acceptance 5 (the VM look) | after merge, the user's; recorded as open in T17's roadmap row |

**Placeholder scan.** No "TBD", no "similar to Task N", no "add appropriate error handling". The only fill-ins are runtime facts that cannot exist before the work does — T17's roadmap row takes the date, the commit range and the walk's outcome, each with the command or step that produces it.

**Names and types across tasks.** Engine: `Band`, `NEWS2_BANDS`, `BANDS_SOURCE`, `points_for` (T1) are what T4 imports; `thin(series, max_points)` (T2) is called with `TRENDS_MAX_POINTS`; `since_utc` (T3) is shared by `audit.py` and `audit_postgres.py`; `records(…, since=…)` is keyword-only everywhere (T3's signature test); `patient_trends(engine, audit, *, hospital, patient_id, hours, now)` (T4) is what T5's route calls with `int(hours)` after the text check against `TRENDS_HOURS`; the route is listed in `BOARD_EXPECTED` and `UNSCOPED_BY_DESIGN` under the path FastAPI reports, `/patients/{patient_id}/trends`. Dashboard: `patientTrends(patientId, hours)` / `putPatientProfile(patientId, body)` (T6) are the names `useTrends` (T9) and `BaselineForm` (T14) call, and `fakeApi` carries both; `useTrends(patientId, hours, measuredKey)` → `{data, loading, unreadable, lastOkAt, reload}` is read the same way by `TrendsBox` and `TrendModal`; `measuredKeyOf(patient.measuredAt)`; the fixtures `trends(patientId, channels, over)`, `channel(key, points, over)`, `point(minutesAgo, value, points)`, `marker(minutesAgo, kind, label)`, `answering(build)`, `BANDS`, `KEYS` (T9) are what every later test uses; `news2Tone(points)` (T10) is used by `TrendCard` and `bandRects`; `CARDS` / `cardTitle` / `channelsOf` (T10) by the box, the dialog, the legend and the table; `TrendCard({card, channels, nowMs, sinceMs, untilMs, onOpen})` gains `sinceMs`/`untilMs` in T11 and `onOpen` is passed from T12; `TrendChart`'s props grow `onPlot` (T12) and `onKeyDown`, `describedBy` (T13) by Edit, never renamed; `whenText`/`markText` live in `TrendModal.jsx` in T12 and move to `trendText.js` (with `pointsText`) in T13, where `TrendModal` and `TrendTable` both import them and nothing else imported them from the dialog; `TrendsBox({patient, bed, nowMs})` gains `nowMs` in T10 and `bed` in T12, matching PatientScreen's edits in those tasks. Every `t("patient.…")` the code names is one T8 defines in four languages (checked by `rawKeys.test.jsx`'s static net, T15 step 3 proves it bites).


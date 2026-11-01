# Group 2 · Lane B — Monitör–yatak eşleme (the monitor→bed mapping editor) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The administrator and the charge nurse bind a bedside monitor the worker reports to a bed picked from Yapı, or unbind it, on the rail screen «Monitörler», in two confirmed steps (a third for an occupied bed); the mapping lives in a per-tenant table seeded once from the approved v2 file, and the strip and Aşama B keep reading the same `shadow_table.current()`.

**Architecture:** Migration `0014` (purely additive) creates `device_beds`: one row per device per period, closed (`valid_to`) and never deleted, one open row per source and per bed (two partial unique indexes), a trigger that allows only a close. `api/device_beds_postgres.py` `PostgresDeviceBeds` implements Lane A's `DeviceBedSource` protocol (`current()` → `TableState`, `invalidate()`), with `version` = `max(id)` and `sha256` = `rows_digest` of the current rows. A new package `homunculus/devicebeds/` holds the model, the row helpers, the seed import (with the one-time `devices.map_beds` grant), the list, the bind/unbind transaction and the router (`GET /infinity-shadow/device-beds`, `POST …/bind`, `POST …/unbind`). `tenant/router.py` `patch_bed` relabels a bound bed's row on a rename and refuses `bed_has_monitor` on a close. `api/app.py` takes the source as a parameter, exposes the lane's settings, clock, invalidate and an uncached occupant read on `app.state`, and mounts the router (a minimal Lane A hunk). The dashboard adds the «Monitör–yatak eşleme» section and its dialog to `DevicesScreen.jsx`, a new string namespace `esleme`, the five codes, and the two Yapı fixes.

**Tech Stack:** Python 3.12 (and a 3.14 check), FastAPI, SQLAlchemy 2 async + asyncpg (routes, import) and sync + psycopg (the accessor, as `PostgresSamples`), Alembic, pytest with Postgres 16; React 18, Vite, Vitest + Testing Library (`render`, `screen`, `within`, `fireEvent`; no user-event), Tailwind on the live tokens.

**Spec (authoritative):** `docs/superpowers/specs/2026-10-28-g2b-monitor-yatak-esleme-design.md`, approved by the user 2026-10-28 and amended `6adad90` (2026-10-30) with Lane A's answers and the controller's calls — §9 lists each O-item's answer; D18–D21 are the amendment's decisions. Where this plan departs from the spec, the departure is in the table below with its reason.

**How the numbers in this plan were obtained.** Unlike B1a's plan, this one was NOT replayed while it was written: no scratch worktree ran its code. Every code block was written against the files as they stand at `0195b30`/`6adad90` (main `cad9bea` underneath), and every file:line was read there. Each task's "Expected" red names the failure the code at that point must give; counts of passed tests are given only where the task's own tests fix them. The implementer records the real red and green in each commit body, and Task 21 records the suite totals. Where a code block meets a line that moved, the task's prose says what the line does: match on that, never on the number.

---

## Departures from the spec (read before Task 1)

| # | Spec | Found in the code | This plan |
|---|---|---|---|
| E1 | §4.1 names one module, `homunculus/devicebeds/router.py` | The router, the transaction, the list, the import and the row helpers are five responsibilities; one file would pass 600 lines | The package `homunculus/devicebeds/`: `models.py` (ORM), `rows.py` (row ↔ `Row`, current rows, the DB time, close and insert), `seed.py` (the import's logic), `listing.py` (the GET body), `service.py` (bind/unbind), `schemas.py`, `router.py`, `writes.py` (Yapı's two hooks). `scripts/import_device_beds.py` is a thin CLI over `seed.py`. |
| E2 | §4.5: `field_invalid:source` / `:bed_id` / `:expected` | `apiErrors.test.js` reads `field_invalid("…")` from three files only (`admission/form.py`, `admission/router.py`, `tenant/router.py`) and maps fields the forms type | The device routes' field refusals are answered as specified, but not added to `INVALID_FIELD_KEYS`: the screen sends ids it read from the server, never typed text, and `apiErrors.js` already says the generic `kabul.invalid.other` for an unmapped field. |
| E3 | §4.4 steps 5 and 8a: "with `_lock_bed`'s strength", "`_holds_open_admission`" | Both are private helpers of `tenant/router.py` (`:115-128`, `:612-616`) | `_lock_bed` is imported from `tenant/router.py`, not copied, so the lock rule stays one. `tenant/router.py` imports only `devicebeds/writes.py`, never `devicebeds/router.py` or `service.py`: no import cycle. The open-admission read is E9's. |
| E4 | §5.3: `check_current` over "the loaded rows" | The read loads rows with `valid_to IS NULL OR valid_to > :now` (a row closed at the DB's `t` is still "valid" at an API clock a moment behind) | `check_current` runs over the rows with `valid_to IS NULL` only; `table.at()` resolves over everything loaded. |
| E5 | §6: "the downstream … at stage `rules`, the next readings body links the bed's patient" | Editor rows start at the database's `t` (§4.4); a test app with an injected fake `shadow_clock` earlier than the DB's clock would not see them | The downstream tests run the app with the real clock (`shadow_clock=time.time`, the default) and post readings with `sent_at=time.time()`. |
| E6 | §3.3 O5: "the same rule as the strip" | No short-name rule exists at `cad9bea`: `MonitorStrip.jsx` names no patient, the bed card prints the whole `display_name` (`BoardState.jsx:172-174`) | A new pure helper `shortName(displayName)` in `screens/devices/deviceMap.js`: the first word and the initial of the last («Ahmet Yılmaz» → «Ahmet Y.»; one word → itself; blank → null). O61. |
| E7 | §7.1: "the new read-only summary script in `deploy/infinity/`" | — | `deploy/infinity/esleme_ozet.py`: standard library only (it runs with the hub's `python3`, as `shadow_check.py`), prints `ESLEME_OZET {…}` from `GET /infinity-shadow/board`. Task 13. |
| E8 | §4.2: `last_seen_at` "now − `status_age_s`" | `DeviceView.status_age_s` is monotonic, rounded to 0.1 s (`infinity_shadow.py:367-370`) | `last_seen_at` = `_iso(now - view.status_age_s)` on the strip's wall clock; null when the device is not in the store. |

| E9 | §4.4 step 8a: "`_holds_open_admission`, read under the bed lock" | That helper answers a bool (`tenant/router.py:612-616`); the audit (O5) and the refusal need the patient's number | `service.change` reads `Patient.patient_number` of an open admission on the bed with the helper's exact condition (`Admission.bed_id`, `OPEN_ADMISSION_STATES`), under the bed lock. Task 10. |
| E10 | §6: tenant isolation "listed in `test_tenant_isolation.py`" | That file's world runs the lane off, where every device route answers `monitor_lane_off` before reading an id | The two isolation tests (another tenant's bed is the same 404 as a missing one; another tenant's caller gets `monitor_lane_off`) live in `tests/test_device_beds_occupied.py`; `test_tenant_isolation.py`'s route walk covers the three routes unchanged (they depend on `caller_tenant_id`). Task 10. |

Departures found while implementing go below E10 (E11 …), each with its file and line.

## Open items

Numbered from O60 (B1a holds O39–O53).

| # | Item | Owner | When |
|---|---|---|---|
| O60 | Spec O4a: the live try returns the sha to the import's only if the chosen bed's Yapı label equals its v2 label. v2's notes say Yapı «bed05…», its labels «BED05…». Block D stops for the user's word if they differ. | User | Before the deploy |
| O61 | The short-name rule (E6) is new code; Lane A agreed "«Ahmet Y.», the same rule as the strip", but the strip has none. Lane A to confirm the helper's wording. | Lane A | Task 17's review |
| O62 | Native-speaker review of the `esleme` namespace and the Yapı additions (az, ru, en are the planner's). | User | Before the deploy |
| O63 | `shadow_check.py` at `cad9bea` reports the stage `rules` as RED (`:94-98`); the fix `7fe61a9` is on main since `ade8da8` (2026-10-30). Every block runs it pinned by commit at `ade8da8` (`7fe61a9` is equivalent: the script is identical), never by branch. | — | Settled |
| O64 | This plan was not replayed (see above): the implementer's red/green and Task 21's totals are the first measured numbers. | Controller | Task 21 |
| O65 | At planning time a stack named `homunculus-api/web/postgres` was up on 18090/18453 (likely B1a's walk). Task 22 stops and asks before touching it. | Controller | Task 22 |
| O66 | A future image could start against a newer, additive database by itself (spec §7.3, last paragraph); not in this slice. | Lane A | Later |

---

## Environment and gates (binding)

- **Worktrees.** The slice branch `feat/g2b-monitor-esleme` lives at `/c/tmp/g2b-esleme`. The backend lane works in `/c/tmp/g2b-esleme-be` (branch `feat/g2b-esleme-be`), the dashboard lane in `/c/tmp/g2b-esleme-fe` (branch `feat/g2b-esleme-fe`), both cut from the slice branch at this plan's commit (`deps.md`). Paths in tasks are relative to the repository root of the task's worktree. **Never touch `/c/Users/User/Desktop/Project/Homunculus AI`** (the user's checkout) or `main`, nor any Lane A worktree (`/c/tmp/inf-*`, `/c/tmp/g2a-*`).
- **Test database.** `TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test`, the container `homunculus-test-pg-56` (`docker start homunculus-test-pg-56` if `docker ps` does not list it). Shared with Lane A behind `conftest.py`'s advisory lock: a run may print "waiting for another test run …" — wait, then run again. Give it on each command line, **never export it. Never set `DATABASE_URL`.**
- **Python.** `/c/tmp/f7-py312/venv/Scripts/python.exe` (3.12); the 3.14 check uses `/c/tmp/g115-py314/Scripts/python.exe`. Always from `homunculus-engine`, always naming files:
  ```bash
  cd /c/tmp/g2b-esleme-be/homunculus-engine
  PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q <files> 2>&1 | tail -5
  ```
  With the database: prefix `TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test`. **Never run `tests/test_infinity_vm_pilot.py`** (it hangs), alone or through a bare `pytest tests/`; the whole no-DB suite is the command above with `--ignore=tests/test_infinity_vm_pilot.py` and no file list. The repo has no ruff or other linter configured (`pyproject.toml`): the gates are the tests and the build.
- **Dashboard.** `dashboard/node_modules` is a junction to `/c/tmp/homunculus-g1/dashboard/node_modules`. **Never `npm install`, never search it** (give Grep/Glob a path under `dashboard/src`). Commands from `<worktree>/dashboard`, the suite and the build as two separate calls:
  ```bash
  npx vitest run <files or folder/> 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
  npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
  ```
  The build prints `built in` and `precache  20 entries` and no `larger than 500 kB`. After editing a `strings/*.js` file run `npx vitest run src/live/i18n/strings.test.js` (it fails on a mangled `ə` or Cyrillic).
- **Foreground, short.** Every suite and build in the foreground, at most 10 minutes per call, no `sleep`; never background a gate and wait on it. Name the files.
- **Edits.** Write and Edit tools only on repo files — never `sed`, `python`, `node` or a heredoc onto a repo file. The tree checks out CRLF (`core.autocrlf=true`); every block here is LF; the Edit tool keeps a file's CRLF; a new file lands LF and git normalises it on commit.
- **TDD.** Write the test, run it, see it red **for the reason the task names**, then the code, then green. The red goes in the commit body (`red: 3 failed — ModuleNotFoundError: homunculus.devicebeds`).
- **Git.** Never `git stash`. Before each commit `git status --short` and `git diff --cached --stat`; commit with a pathspec (`git commit -F - -- <paths>`); a staged path the task does not list: stop and ask. **Never push**, alone or inside a compound command. Messages `type(scope): what` ending with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```
- **No PHI, anywhere** (CLAUDE.md rule 6): tests, fixtures, docs, blocks and screenshots use synthetic names («Ahmet Yılmaz», «Sentetik …») and made-up numbers (`H2600042`), `192.0.2.x` / `10.10.203.x` addresses only as the v2 file already holds them. No block prints a patient's name, number or value.
- **Lane A review.** Lane A reviews every hunk in its files: `api/app.py`, `api/board.py`, `api/clinical.py`, `api/alert_lifecycle.py`, `api/infinity_shadow.py`, `api/infinity_device_beds.py`, `edge/infinity_*`, `deploy/infinity/*`, and this slice's `alembic/versions/0014_device_beds.py`, `api/device_beds_postgres.py`, `api/prodserver.py`, `screens/devices/DevicesScreen.jsx`, `i18n/strings/monitor.js`. A task touching one carries a **Lane A review hunk** note listing the exact lines; send the diff of those paths to the controller before the task's commit is merged to the slice branch.
- **Deploy.** One VM deploy at a time across both lanes. NBP-2 (main `cad9bea`) deploys first. This slice's deploy waits for the user's «main'e al» and then «onay»; Tasks 24–25 write the blocks, they never run them. In a pasted `bash <<'BLOK'`, every stdin consumer (`docker compose exec|run`, `psql`, `ssh`, `scp`, `docker exec`) takes `</dev/null`.
- **Codes, not words; no UUID; four languages** (az default, tr source, ru, en), as B1a §5.7: refusals mapped by `err.apiCode`; a test of every new surface asserts no UUID in `document.body.textContent`; an `az` text equal to `tr` or an `ru` text without Cyrillic needs a reviewed entry in `strings.test.js`.
- **Reachability** (`src/reachable.test.js`): every new dashboard module is imported from `main.jsx`'s tree in the commit that creates it; nothing under `src/live/` imports outside it but `backendApi.js`, `liveAuth.js`, `liveAdapters.js`, `liveConnection.js` (`boundaries.test.js`).

---

## File map

**Create — engine** (`homunculus-engine/`)

| File | Responsibility | Task |
|---|---|---|
| `alembic/versions/0014_device_beds.py` **(Lane A review)** | the table, its checks, two partial unique indexes, the history index, the function and two triggers; downgrade (*as built:* three triggers — `no_delete`, `close_only`, `no_truncate` — a whole-row freeze and a close at or before `clock_timestamp()`; amendment A-8, spec §5.1) | 2 |
| `src/homunculus/devicebeds/__init__.py` | the package (empty docstring) | 2 |
| `src/homunculus/devicebeds/models.py` | `DeviceBed` on `Base` | 2 |
| `src/homunculus/devicebeds/rows.py` | `to_row`, `current_rows`, `db_time`, `close_row`, `insert_row`, `iso_utc` | 4 |
| `src/homunculus/api/device_beds_postgres.py` **(Lane A review)** | `PostgresDeviceBeds`: `current()`, `invalidate()` | 4 |
| `src/homunculus/devicebeds/seed.py` | `import_v2`: sha, parse, bed and unit checks, insert, grant, audit, the printed line | 5 |
| `scripts/import_device_beds.py` | the CLI over `seed.import_v2` | 6 |
| `tests/esleme_v2.py` | a tenant whose unit and twelve beds carry v2's UUIDs (Tasks 5, 6, 8) | 5 |
| `src/homunculus/devicebeds/schemas.py` | `BindBody`, `UnbindBody`, `Expected` (`extra="forbid"`) | 7 |
| `src/homunculus/devicebeds/listing.py` | the GET body: devices (store ∪ rows), bed names by scope, `editable` | 8 |
| `src/homunculus/devicebeds/router.py` | the three routes and the lane guard | 8, 9 |
| `src/homunculus/devicebeds/service.py` | `change()`: the transaction of spec §4.4 | 9, 10 |
| `src/homunculus/devicebeds/writes.py` | Yapı's hooks: `refuse_close_if_bound`, `relabel_bed` | 12 |
| `deploy/infinity/esleme_ozet.py` **(Lane A review)** | the read-only before/after summary | 13 |
| `tests/test_migration_0014_device_beds.py` | the real chain, additive, indexes, trigger, parity, round trip | 2 |
| `tests/test_infinity_device_beds_contract.py` | the protocol, `invalidate`, `rows_digest`, `check_current` | 3 |
| `tests/test_device_beds_postgres.py` | the accessor on the test database | 4 |
| `tests/test_device_beds_import.py` | the import's refusals, idempotency, grant, audit, line | 5 |
| `tests/test_device_beds_parity.py` | C2: TableFile(v2) ≡ PostgresDeviceBeds after the import | 6 |
| `tests/test_device_beds_wiring.py` | `create_app(device_beds=…)`, `app.state` hooks, the shared occupant read | 7 |
| `tests/esleme_world.py` | the ward of `kabul_world` + the lane on, devices in the store, rows seeded | 8 |
| `tests/test_device_beds_api.py` | GET, bind, unbind, replace, refusals, audit | 8, 9 |
| `tests/test_device_beds_occupied.py` | `bed_occupied`, `confirm_occupied`, patient ids | 10 |
| `tests/test_device_beds_concurrency.py` | stale `expected`, races, downstream strip and rules | 11 |
| `tests/test_device_beds_structure.py` | relabel on rename, `bed_has_monitor`, the structure guard | 12 |
| `tests/test_esleme_ozet.py` | the summary script on fixed boards | 13 |

**Modify — engine**

| File | Change | Task |
|---|---|---|
| `src/homunculus/auth/permissions.py`, `tests/test_permissions.py` | `devices.map_beds` (last); in `charge_nurse` | 1 |
| `src/homunculus/api/infinity_device_beds.py` **(Lane A review)** | `DeviceBedSource`, `TableFile.invalidate`, `rows_digest`, `check_current` | 3 |
| `src/homunculus/admission/errors.py` | five codes | 7 |
| `src/homunculus/api/app.py` **(Lane A review)** | `device_beds=` parameter; `shadow_settings`, `shadow_clock`, `shadow_table_reset`, `bed_occupants` on `app.state`; `_occupants` split into an uncached read and its cache; the router mounted | 7, 8 |
| `src/homunculus/api/prodserver.py` **(Lane A review)** | `PostgresDeviceBeds` in production | 7 |
| `src/homunculus/tenant/router.py` | `patch_bed`'s two hooks; `GET /tenant/structure` accepts `devices.map_beds` | 12 |
| `tests/test_route_permissions.py` | the new module; three rows; `/tenant/structure`'s key; 59 → 62 | 8, 9, 12 |
| `tests/test_nginx_routes.py` | `/infinity-shadow/device-beds` | 8 |
| `tests/test_tenant_isolation.py` | **unchanged** (E10): its route walk covers the three routes; the device routes' isolation tests are in `test_device_beds_occupied.py` | — |

**Create — dashboard** (`dashboard/src/live/`)

| File | Responsibility | Task |
|---|---|---|
| `i18n/strings/esleme.js` | every text of the editor, four languages | 15 |
| `screens/devices/deviceMap.js` (+ test) | `canSeeMapping`, `shortName`, `occupiedNames`, `monitorName`, `bedText`, `visibility`, `verifiedText` | 17 |
| `screens/devices/MappingSection.jsx` (+ test) | the list, its poll, the row actions | 17 |
| `screens/devices/MappingDialog.jsx` (+ test) | pick → confirm → occupied; unbind; refusals (a stub in 17) | 17, 18 |
| `screens/devices/esleme.testutil.js` | synthetic devices, list bodies, a mount with structure and board | 17 |

**Modify — dashboard**

| File | Change | Task |
|---|---|---|
| `src/live/screens/admin/catalogue.js`, `admin.testutil.js`, `i18n/strings/perms.js` | the key's mirror (lands with Task 1) | 1 |
| `src/live/i18n/catalog.js`, `src/live/i18n/strings.test.js` | the `esleme` namespace block; reviewed entries | 15 |
| `src/live/i18n/strings/monitor.js` **(Lane A review)** | `monitor.method.editor`, four lines | 15 |
| `src/live/i18n/strings/kabul.js` | the Yapı hint, the room boxes' labels, `kabul.err.bedHasMonitor` | 15 |
| `src/backendApi.js` (+ test), `src/live/session/testTokens.testutil.js` | `deviceBeds`, `bindDeviceBed`, `unbindDeviceBed`; `err.occupied` | 16 |
| `src/live/apiErrors.js` (+ test) | five codes | 16 |
| `src/live/screens/devices/DevicesScreen.jsx` **(Lane A review)** | the section above the strips; an editor row's `verified_at` in local time | 17 |
| `src/live/shell/routes.js`, `src/live/data/StructureProvider.jsx` | `devices.map_beds` on the route and in `STRUCTURE_PERMS` | 17 |
| `src/live/screens/admin/StructureTab.jsx` (+ test) | the held reason visible; the room boxes' labels and hint | 19 |
| `src/live/rawKeys.test.jsx` | the section and the dialog in the sweep | 20 |

**Docs** (Task 23): `docs/homunculus-rehber-TR.md`, `deploy/infinity/README.md` **(Lane A review)**, `deploy/local/.env.example`, `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`, the spec's "as built" notes. **Outside the repo** (Tasks 24–25): `/c/tmp/infinity-a-releases/G2B-ESLEME-bloklari.txt`, the bundle.


---

## Task order, lanes and parallel work

| Task | Lane | Needs | May run beside | Lane A review |
|---|---|---|---|---|
| 1 `devices.map_beds` (engine + the dashboard's mirror) | backend | — | 15 | — |
| 2 migration 0014 and the model | backend | 1 | 15 | **yes** (0014) |
| 3 the accessor contract in `infinity_device_beds.py` | backend | — (no DB) | 2, 15 | **yes** |
| 4 `rows.py` and `PostgresDeviceBeds` | backend | 2, 3 | 15 | **yes** (`device_beds_postgres.py`) |
| 5 the seed import and its grant | backend | 4 | 15 | — |
| 6 the parity test (C2) and the import's CLI | backend | 5 | 7, 15 | — |
| 7 the five codes; `app.py`/`prodserver.py` wiring | backend | 4 | 6, 15 | **yes** (`app.py`, `prodserver.py`) |
| 8 `GET /infinity-shadow/device-beds` | backend | 5, 7 | 15–17 | **yes** (`app.py`: one `include_router` line) |
| 9 bind and unbind | backend | 8 | 15–18 | — |
| 10 occupied beds and the patient id | backend | 9 | 15–19 | — |
| 11 concurrency and downstream | backend | 10 | 15–19 | — |
| 12 Yapı hooks; the structure guard | backend | 9 | 10, 11, 15–19 | — |
| 13 `deploy/infinity/esleme_ozet.py` | backend | — | 2–12, 15–19 | **yes** |
| 14 the backend lane's gate | backend | 1–13 | 15–20 | — |
| 15 strings (`esleme`, `monitor.method.editor`, Yapı's) | dashboard | — | 1–14 | **yes** (`monitor.js`) |
| 16 the API client and the five codes | dashboard | 15; **7 on the slice branch** (`apiErrors.test.js` reads `admission/errors.py`) | 8–14 | — |
| 17 `deviceMap.js`, the list, the screen's section | dashboard | 16 | 8–14 | **yes** (`DevicesScreen.jsx`) |
| 18 the dialog | dashboard | 17 | 8–14, 19 | — |
| 19 Yapı's two fixes and `bed_has_monitor` | dashboard | 16 | 8–14, 18 | — |
| 20 the sweep and the dashboard lane's gate | dashboard | 17–19 | 8–14 | — |
| 21 gates on the merged branch | — | 14, 20 merged | — | — |
| 22 the local walk | — | 21 | — | — |
| 23 docs | — | 21 (the counts it quotes) | 22 | **yes** (`deploy/infinity/README.md`) |
| 24 VM blocks A and B | — | 22, 23 | 25 | — |
| 25 VM blocks C, D and R | — | 22, 23 | 24 | — |

**Continuation files.** A file named `task-NN-<part>.md` is NOT a task of its own: it is one step of Task NN, split out of `task-NN.md` for length, and the step in `task-NN.md` names it. `task-05-seed.md` is Task 5's Step 4 (`devicebeds/seed.py`); `task-08-world.md` is Task 8's Step 1 (`tests/esleme_world.py`); any other `-<part>` file says whose step it is in its first line. A task is done when all its files' steps are; it has one commit. The tasks are numbered 1–25, as the table above.

**Why this order.** The key lands with its dashboard mirror (`catalogue.test.js` reads `permissions.py`). The schema (2) comes before every reader and writer of it; the accessor's contract (3) before its Postgres implementation (4); the implementation before the import that prints its `version`/`sha256` (5) and the parity test that compares it with the file (6). The wiring (7) gives the routes the lane's settings, clock, invalidate and occupants before the first route (8) is mounted. Bind and unbind (9) come before the occupancy rule (10) and the races (11) that build on them; Yapı's hooks (12) reuse the row helpers of 4 and the DB time of 9. On the dashboard, the strings come first (every test reads them), the client second, the list third (it creates `deviceMap.js`, which the dialog reads), the dialog fourth; Yapı's fixes need only the strings and the client.

## Lane worktrees

**The base.** The planner did NOT rebase. The coordinator rebases the slice branch onto main `ade8da8` (NBP-2 deployed: `cad9bea` + the shadow_check fix `7fe61a9` + docs-only deploy records; no code or migration changed) after this plan is committed, and **the two lanes are cut only after that rebase**, from the rebased slice branch. Check before cutting:

```bash
cd /c/tmp/g2b-esleme
git status --short                                  # clean
git merge-base --is-ancestor ade8da8 HEAD && echo "on ade8da8"   # must print it; else stop and ask
git log --oneline ade8da8..HEAD | cat               # the slice's own commits only: spec, its amendments, this plan
```

```bash
# backend lane (Tasks 1–14)
cd /c/tmp/g2b-esleme
git worktree add -b feat/g2b-esleme-be /c/tmp/g2b-esleme-be feat/g2b-monitor-esleme
cmd //c "mklink /J C:\\tmp\\g2b-esleme-be\\dashboard\\node_modules C:\\tmp\\homunculus-g1\\dashboard\\node_modules"
```

```bash
# dashboard lane (Tasks 15–20). Task 15 may start at once. Task 16 needs Task 7 on the slice
# branch: after Task 7 has landed on feat/g2b-esleme-be, fast-forward the slice branch to it, then
# merge the slice branch into the dashboard lane.
cd /c/tmp/g2b-esleme
git worktree add -b feat/g2b-esleme-fe /c/tmp/g2b-esleme-fe feat/g2b-monitor-esleme
cmd //c "mklink /J C:\\tmp\\g2b-esleme-fe\\dashboard\\node_modules C:\\tmp\\homunculus-g1\\dashboard\\node_modules"
# … Task 15 …; after Task 7:
git -C /c/tmp/g2b-esleme merge --ff-only feat/g2b-esleme-be
git -C /c/tmp/g2b-esleme-fe merge --no-edit feat/g2b-monitor-esleme
```

**The baseline** (once, in each lane worktree before its first task; write the numbers into the first commit body of the lane):

```bash
cd /c/tmp/g2b-esleme-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -1
```

```bash
cd /c/tmp/g2b-esleme-fe/dashboard
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
```

Expected: no failure in either (main `cad9bea` was green at NBP-2's gate). A failure here is not this slice's: stop and report it before Task 1 or 15.

**Who touches what.** The dashboard lane touches no engine file; the backend lane touches no dashboard file but Task 1's three (the permission mirror, which must land with `permissions.py`). `tests/test_route_permissions.py` is the backend lane's alone (Tasks 8, 9, 12). Shared seams that both lanes' tasks extend are blank-separated blocks marked `// G2-ESLEME` (`i18n/catalog.js`, `strings.test.js`'s two sets, `shell/routes.js`), as B1a's `// G2-B1a` blocks: do not tidy the gaps away.

**Merge order.** The backend lane first (`git -C /c/tmp/g2b-esleme merge --ff-only feat/g2b-esleme-be`), then the dashboard lane (`git -C /c/tmp/g2b-esleme merge --no-ff feat/g2b-esleme-fe -m "merge: G2 monitor→bed editor, dashboard lane"`). Tasks 21–25 run on the merged `feat/g2b-monitor-esleme` in `/c/tmp/g2b-esleme`. Removing a lane worktree: unlink the junction first (`cmd //c "rmdir C:\\tmp\\g2b-esleme-fe\\dashboard\\node_modules"`), then `git worktree remove --force /c/tmp/g2b-esleme-fe`, then `git branch -d feat/g2b-esleme-fe` — a recursive delete that follows the junction empties the shared install.

## Lane A coordination (the agreed regions)

Lane A (the strip, Aşama B, the engine) owns the files the header lists. This slice changes, in them, only:

| File | This slice's change | Lane A's own, untouched |
|---|---|---|
| `api/infinity_device_beds.py` | additive, after `TableFile`: `DeviceBedSource`, `rows_digest`, `check_current`; one method `TableFile.invalidate` | `parse_table`, `_row`, `_same_bed`, `TableFile.current/_fetch/_parse/_announce` |
| `api/app.py` | `device_beds` parameter; `shadow_table = device_beds if … else TableFile(…)` (`:255`); `_occupants` (`:1170-1195`) split into `_occupants_now` + its cache; five `app.state` lines after `app.state.shadow_lane` (`:633`); one `include_router` after `infinity_research_router` (`:621`) | `_sample_and_publish`, `shadow_board`, `shadow_readings`, every clinical door |
| `api/prodserver.py` | `_device_beds(url)` beside `_samples` (`:472-483`), passed to `create_app` | the rest |
| `api/infinity_shadow.py`, `edge/infinity_*` | **none** | all |
| `DevicesScreen.jsx` | the section mounted above `{body}`; the method line's `verified` value through `verifiedText` | the strip, its notes, its counters |
| `strings/monitor.js` | `method.editor` in each language's `method` object | every other key |
| `deploy/infinity/*` | a new `esleme_ozet.py`; README section (Task 23) | `shadow_check.py`, every other file |
| `alembic/versions/0014_device_beds.py`, `api/device_beds_postgres.py` | new files, Lane A reviews them whole | — |


---

### Task 1: `devices.map_beds` — the catalogue, the charge nurse's default group and the dashboard's mirror

**Lane:** backend (`/c/tmp/g2b-esleme-be`). **Needs:** nothing.

Spec D2, §4.6. A new key, last in the catalogue (a new key at the end moves no row of Rollar), in `charge_nurse`'s default set. The system group holds it by rule (`auth/groups.py:79-80`), so `hospital_admin` needs nothing but the catalogue entry (its `DEFAULT_GROUPS` row is `tuple(PERMISSIONS)`). The lane hospital's EXISTING `charge_nurse` group gets it from the import's one-time grant (Task 5), never from migration 0014 (O11). `catalogue.test.js` reads `permissions.py`, so the dashboard's mirror lands in this commit.

**Files:**
- Modify: `homunculus-engine/tests/test_permissions.py`
- Modify: `homunculus-engine/src/homunculus/auth/permissions.py`
- Modify: `dashboard/src/live/screens/admin/catalogue.js`
- Modify: `dashboard/src/live/screens/admin/admin.testutil.js`
- Modify: `dashboard/src/live/i18n/strings/perms.js`

- [ ] **Step 1: Write the failing test.**

**Edit** `homunculus-engine/tests/test_permissions.py` (1) — replace:

```python
    "beds.release",       # G2-B1a (spec D8)
}


def test_the_catalogue_is_exactly_the_specified_twenty_two_keys():
    assert len(SPEC_KEYS) == 22
```

with:

```python
    "beds.release",       # G2-B1a (spec D8)
    "devices.map_beds",   # G2 monitor→bed editor (spec D2)
}


def test_the_catalogue_is_exactly_the_specified_twenty_three_keys():
    assert len(SPEC_KEYS) == 23
```

**Edit** `homunculus-engine/tests/test_permissions.py` (2) — replace:

```python
                                    "break_glass.use", "clinical.chart", "beds.release"}),
    "nurse": (False, False, {"board.view", "alerts.ack", "admissions.view", "admissions.admit",
```

with:

```python
                                    "break_glass.use", "clinical.chart", "beds.release",
                                    "devices.map_beds"}),
    "nurse": (False, False, {"board.view", "alerts.ack", "admissions.view", "admissions.admit",
```

**Edit** `homunculus-engine/tests/test_permissions.py` (3) — replace:

```python
def test_a_cleaned_bed_is_released_by_the_wards_nurses_and_no_one_else_by_default():
```

with:

```python
def test_a_monitor_is_bound_to_a_bed_by_the_charge_nurse_and_the_administrator_by_default():
    """Spec D2: the administrator (by rule: the system group holds every key) and the charge nurse,
    so a moved monitor can be fixed at night. Not biomedical: `devices.manage` opens the research
    window, a different right."""
    by_slug = {g["slug"]: set(g["permissions"]) for g in DEFAULT_GROUPS}
    holders = {slug for slug, perms in by_slug.items() if "devices.map_beds" in perms}
    assert holders == {"charge_nurse", "hospital_admin"}
    assert "devices.map_beds" not in by_slug["biomedical"] | by_slug["platform_support"]


def test_a_cleaned_bed_is_released_by_the_wards_nurses_and_no_one_else_by_default():
```

- [ ] **Step 2: Run it and see it red** — the catalogue holds 22 keys and no group holds the new one:

```bash
cd /c/tmp/g2b-esleme-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_permissions.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed)" | head
```

Expected: `FAILED …twenty_three_keys`, `FAILED …hospital_admin_holds_every_permission` (it compares with `SPEC_KEYS`), `FAILED …every_default_group_matches_the_spec_table_exactly`, `FAILED …charge_nurse_and_the_administrator_by_default`; the rest pass.

- [ ] **Step 3: Add the key and give it to `charge_nurse`.**

**Edit** `homunculus-engine/src/homunculus/auth/permissions.py` (1) — replace:

```python
    "beds.release": "Mark a cleaned bed free again (housekeeping → available), in one's own units",
}
```

with:

```python
    "beds.release": "Mark a cleaned bed free again (housekeeping → available), in one's own units",

    # G2 — the monitor→bed editor on the Monitörler screen (spec D2). Not `devices.manage`, which
    # opens the research window and every unassigned device.
    "devices.map_beds": "Bind a bedside monitor to a bed, or unbind it, on the Monitörler screen — "
                        "beds in one's own units only; a bed with an admitted patient asks a second "
                        "confirmation",
}
```

**Edit** `homunculus-engine/src/homunculus/auth/permissions.py` (2) — replace:

```python
                     "shifts.manage", "break_glass.use", "clinical.chart", "beds.release")},
    {"slug": "nurse", "kind": "role", "name": "Hemşire",
```

with:

```python
                     "shifts.manage", "break_glass.use", "clinical.chart", "beds.release",
                     "devices.map_beds")},
    {"slug": "nurse", "kind": "role", "name": "Hemşire",
```

- [ ] **Step 4: Run it green.** The same command: `16 passed` (15 before, plus the new test). Then run the dashboard's mirror test and see it red — the engine has a key the mirror lacks:

```bash
cd /c/tmp/g2b-esleme-be/dashboard
npx vitest run src/live/screens/admin/catalogue.test.js src/live/screens/admin/admin.testutil.test.js 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |AssertionError" | head
```

Expected: `FAIL` in `catalogue.test.js` (the key lists differ by `devices.map_beds`).

- [ ] **Step 5: The mirror.**

**Edit** `dashboard/src/live/screens/admin/catalogue.js` — replace:

```js
  // G2-B1a — a cleaned bed marked free by the ward's nurses (spec D8)
  "beds.release",
]);
```

with:

```js
  // G2-B1a — a cleaned bed marked free by the ward's nurses (spec D8)
  "beds.release",

  // G2-ESLEME — a monitor bound to a bed on the Monitörler screen (spec D2)
  "devices.map_beds",
]);
```

**Edit** `dashboard/src/live/screens/admin/admin.testutil.js` — replace:

```js
  // G2-B1a
  "beds.release": "Mark a cleaned bed free again (housekeeping → available), in one's own units",
});
```

with:

```js
  // G2-B1a
  "beds.release": "Mark a cleaned bed free again (housekeeping → available), in one's own units",

  // G2-ESLEME
  "devices.map_beds": "Bind a bedside monitor to a bed, or unbind it, on the Monitörler screen — beds in one's own units only; a bed with an admitted patient asks a second confirmation",
});
```

**Edit** `dashboard/src/live/i18n/strings/perms.js` (tr) — replace:

```js
Varsayılan olarak biyomedikal grubunda ve üreticinin destek grubunda vardır" },
```

with:

```js
Varsayılan olarak biyomedikal grubunda ve üreticinin destek grubunda vardır",
      map_beds: "«Monitörler» ekranında bir başucu monitörünü bir yatağa bağlar ya da bağlantısını çözer — yalnız kendi birimlerindeki yataklar; yatan hastası olan yatak ikinci bir onay ister" },
```

**Edit** `dashboard/src/live/i18n/strings/perms.js` (az) — replace:

```js
istehsalçının dəstək qrupunda var" },
```

with:

```js
istehsalçının dəstək qrupunda var",
      map_beds: "«Monitorlar» ekranında çarpayı yanı monitoru çarpayıya bağlayır və ya bağlantını açır — yalnız öz şöbələrindəki çarpayılar; xəstəsi yatan çarpayı ikinci təsdiq istəyir" },
```

**Edit** `dashboard/src/live/i18n/strings/perms.js` (ru) — replace:

```js
у группы поддержки производителя" },
```

with:

```js
у группы поддержки производителя",
      map_beds: "Привязывает прикроватный монитор к койке или отвязывает его на экране «Мониторы» — только койки своих отделений; для койки с госпитализированным пациентом нужно второе подтверждение" },
```

**Edit** `dashboard/src/live/i18n/strings/perms.js` (en) — replace:

```js
the vendor's support group hold it" },
```

with:

```js
the vendor's support group hold it",
      map_beds: "Bind a bedside monitor to a bed, or unbind it, on the Monitors screen — beds in their own units only; a bed with an admitted patient asks a second confirmation" },
```

(Check each old text is unique in `perms.js` before the Edit: `grep -c` gives 1. The az screen name «Monitorlar» is `nav.devices`'s az text; read it from `strings/nav.js` and use that exact word if it differs.)

- [ ] **Step 6: Green on both sides.**

```bash
cd /c/tmp/g2b-esleme-be/dashboard
npx vitest run src/live/screens/admin/ src/live/i18n/strings.test.js 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
cd ../homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_permissions.py tests/test_route_permissions.py 2>&1 | tail -1
```

Expected: no `FAIL`; the engine line all passed (the DB-backed tests of `test_route_permissions.py` skip without `TEST_DATABASE_URL`).

- [ ] **Step 7: Commit.**

```bash
cd /c/tmp/g2b-esleme-be
git status --short && git diff --cached --stat
git add -- homunculus-engine/tests/test_permissions.py homunculus-engine/src/homunculus/auth/permissions.py dashboard/src/live/screens/admin/catalogue.js dashboard/src/live/screens/admin/admin.testutil.js dashboard/src/live/i18n/strings/perms.js
git commit -F - -- homunculus-engine/tests/test_permissions.py homunculus-engine/src/homunculus/auth/permissions.py dashboard/src/live/screens/admin/catalogue.js dashboard/src/live/screens/admin/admin.testutil.js dashboard/src/live/i18n/strings/perms.js <<'EOF'
feat(auth): devices.map_beds — bind a monitor to a bed; the charge nurse's by default, the administrator's by rule

The catalogue's 23rd key, last; in charge_nurse's default set. The lane hospital's existing group
gets it from the seed import's one-time grant (Task 5), not from a migration (spec O11). The
dashboard's mirror in four languages.

red: 4 failed — the catalogue held 22 keys; no group held the key; catalogue.test.js after the engine side

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```


---

### Task 2: Migration 0014 `device_beds` and its model

**Lane:** backend (`/c/tmp/g2b-esleme-be`). **Needs:** Task 1. **Lane A review hunk:** the whole of `alembic/versions/0014_device_beds.py` (O2, O11) — send it to the controller before the merge.

Spec D5, D20, §5.1, §5.2. Purely additive: one table, three checks, two partial unique indexes, a history index, a function and two triggers; no data, no change to an existing object. The tests run the real chain (`clean_db`, never `create_all`), as `test_migration_0012_kabul.py`.

**Files:**
- Create: `homunculus-engine/alembic/versions/0014_device_beds.py`
- Create: `homunculus-engine/src/homunculus/devicebeds/__init__.py`
- Create: `homunculus-engine/src/homunculus/devicebeds/models.py`
- Create: `homunculus-engine/tests/test_migration_0014_device_beds.py`

- [ ] **Step 1: Write the failing test.** **Write** `homunculus-engine/tests/test_migration_0014_device_beds.py`:

```python
# homunculus-engine/tests/test_migration_0014_device_beds.py
"""Migration 0014 (the monitor→bed editor, spec §5.1) on the real chain: purely additive — every
object and row that existed at 0013 is the same at 0014 and after the downgrade, and 0014 grants no
permission (O11); one current row per device and per bed; history kept (no delete, no edit but a
close); the model agrees with the migration; 0013 → 0014 → 0013 → 0014 runs. Synthetic rows only."""
from __future__ import annotations

import uuid

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError

import homunculus.devicebeds.models  # noqa: F401  (register device_beds on Base.metadata)
import homunculus.tenant.models  # noqa: F401
from homunculus.db import Base
from tests.conftest import requires_db

pytestmark = [requires_db]
OWN = {"device_beds"}


def _tenant(conn, slug: str) -> uuid.UUID:
    tid = uuid.uuid4()
    conn.execute(text("INSERT INTO tenants (id, name, slug, country_code) VALUES (:id, :n, :s, 'AZ')"),
                 {"id": tid, "n": f"Sentetik {slug}", "s": slug})
    return tid


def _ward(conn, tenant: uuid.UUID) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    """A site, a unit, a room and two beds; returns (unit, bed 1, bed 2)."""
    site, unit, room, bed1, bed2 = (uuid.uuid4() for _ in range(5))
    conn.execute(text("INSERT INTO sites (id, tenant_id, name) VALUES (:id, :t, 'Ana bina')"), {"id": site, "t": tenant})
    conn.execute(text("INSERT INTO units (id, site_id, name, unit_type) VALUES (:id, :s, 'Reanimasiya', 'ADULT_ICU')"),
                 {"id": unit, "s": site})
    conn.execute(text("INSERT INTO rooms (id, unit_id, name) VALUES (:id, :u, 'Otaq 05')"), {"id": room, "u": unit})
    for bed, label in ((bed1, "bed05"), (bed2, "bed06")):
        conn.execute(text("INSERT INTO beds (id, room_id, label) VALUES (:id, :r, :l)"), {"id": bed, "r": room, "l": label})
    conn.execute(text("INSERT INTO groups (id, tenant_id, slug, name, mfa_required, is_system, created_at, updated_at) "
                      "VALUES (:id, :t, 'charge_nurse', 'Sorumlu Hemşire', false, false, now(), now())"),
                 {"id": uuid.uuid4(), "t": tenant})
    return unit, bed1, bed2


def _row(conn, tenant, source, *, bed=None, unit=None, label=None, valid_to=None) -> int:
    return conn.execute(text(
        "INSERT INTO device_beds (tenant_id, source, group_address, port, device_bed_label, bed_label, bed_id, "
        "unit_id, method, verified_at, note, valid_from, valid_to, approved_by, approved_at) VALUES (:t, :s, "
        "'224.0.2.99', 2050, 'BED99', :label, :bed, :unit, 'central_station_list', '2026-09-22', NULL, "
        "'2026-10-19T00:00:00+00:00', :vt, 'proje sahibi', '2026-10-27T00:00:00+00:00') RETURNING id"),
        {"t": tenant, "s": source, "label": label, "bed": bed, "unit": unit, "vt": valid_to}).scalar_one()


def _snapshot(engine) -> dict:
    """Every column, index, function and row count of the schema, device_beds' own left out."""
    with engine.connect() as conn:
        tables = [r[0] for r in conn.execute(text(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")) if r[0] not in OWN]
        return {
            "columns": conn.execute(text(
                "SELECT table_name, column_name, data_type, is_nullable, character_maximum_length "
                "FROM information_schema.columns WHERE table_schema = 'public' AND table_name <> 'device_beds' "
                "ORDER BY 1, 2")).all(),
            "indexes": conn.execute(text(
                "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' "
                "AND tablename <> 'device_beds' ORDER BY 1")).all(),
            "functions": conn.execute(text(
                "SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
                "WHERE n.nspname = 'public' AND proname <> 'device_beds_history_kept' ORDER BY 1")).all(),
            "rows": {t: conn.execute(text(f'SELECT count(*) FROM "{t}"')).scalar_one() for t in tables},
            "grants": conn.execute(text("SELECT group_id, permission FROM group_permissions ORDER BY 1, 2")).all(),
        }


def test_0014_is_purely_additive_and_grants_nothing(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "0013")
    with engine.begin() as conn:
        _ward(conn, _tenant(conn, "hastane-a"))
    before = _snapshot(engine)
    command.upgrade(cfg, "0014")
    assert _snapshot(engine) == before
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM group_permissions WHERE permission = 'devices.map_beds'")).scalar_one() == 0
    command.downgrade(cfg, "0013")
    assert _snapshot(engine) == before
    with engine.connect() as conn:
        # R-2's checks (Lane A): the downgrade dropped the triggers before the table, and left neither
        assert conn.execute(text("SELECT to_regclass('public.device_beds')")).scalar_one() is None
        assert conn.execute(text("SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'device_beds_%'")).scalar_one() == 0
        assert conn.execute(text("SELECT count(*) FROM pg_proc WHERE proname = 'device_beds_history_kept'")).scalar_one() == 0
        assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0013"


def test_one_current_row_per_device_and_per_bed_while_closed_history_is_free(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        unit, bed1, bed2 = _ward(conn, tenant)
        first = _row(conn, tenant, "10.10.203.23", bed=bed1, unit=unit, label="BED05")
    for source, bed in (("10.10.203.23", bed2), ("10.10.203.24", bed1)):   # the device again; the bed again
        with pytest.raises(IntegrityError), engine.begin() as conn:
            _row(conn, tenant, source, bed=bed, unit=unit, label="bed06")
    with engine.begin() as conn:
        conn.execute(text("UPDATE device_beds SET valid_to = now() WHERE id = :id"), {"id": first})
        _row(conn, tenant, "10.10.203.23", bed=bed1, unit=unit, label="bed05")      # history, then a new one
        _row(conn, tenant, "10.10.203.25", label="BED01")                            # a label, no bed: no bed index
        _row(conn, tenant, "10.10.203.26")                                           # unbound


def test_history_is_kept_no_delete_and_no_edit_but_one_close(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        unit, bed1, _ = _ward(conn, tenant)
        row = _row(conn, tenant, "10.10.203.23", bed=bed1, unit=unit, label="BED05")
    refused = ["DELETE FROM device_beds WHERE id = :id",
               "UPDATE device_beds SET bed_label = 'bed05' WHERE id = :id",
               "UPDATE device_beds SET bed_label = 'bed05', valid_to = now() WHERE id = :id"]
    for sql in refused:
        with pytest.raises(DBAPIError, match="keeps its history"), engine.begin() as conn:
            conn.execute(text(sql), {"id": row})
    with engine.begin() as conn:
        conn.execute(text("UPDATE device_beds SET valid_to = now() WHERE id = :id"), {"id": row})
    with pytest.raises(DBAPIError, match="keeps its history"), engine.begin() as conn:
        conn.execute(text("UPDATE device_beds SET valid_to = now() + interval '1 day' WHERE id = :id"), {"id": row})


@pytest.mark.parametrize("columns", [
    {"bed": "BED", "unit": None, "label": "bed05"},       # a bed without its unit
    {"bed": "BED", "unit": "UNIT", "label": None},        # a bound row must name its bed
])
def test_the_checks_refuse_a_half_bound_row(clean_db, columns):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        unit, bed1, _ = _ward(conn, tenant)
    ids = {"BED": bed1, "UNIT": unit, None: None}
    with pytest.raises(IntegrityError), engine.begin() as conn:
        _row(conn, tenant, "10.10.203.23", bed=ids[columns["bed"]], unit=ids[columns["unit"]], label=columns["label"])
    with pytest.raises(IntegrityError), engine.begin() as conn:     # an empty interval
        _row(conn, tenant, "10.10.203.24", valid_to="2026-10-19T00:00:00+00:00")


def test_the_model_and_the_migration_agree_and_the_round_trip_runs(clean_db):
    engine, cfg = clean_db
    for target in ("head", "0013", "0014"):
        (command.upgrade if target != "0013" else command.downgrade)(cfg, target)
    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn, opts={
            "compare_type": True, "compare_server_default": False,
            "include_object": lambda obj, name, type_, reflected, compare_to: (
                name in OWN if type_ == "table" else
                getattr(getattr(obj, "table", None), "name", None) in OWN)})
        assert compare_metadata(ctx, Base.metadata) == []
```

- [ ] **Step 2: Red.**

```bash
cd /c/tmp/g2b-esleme-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_migration_0014_device_beds.py 2>&1 | tail -3
```

Expected: `ModuleNotFoundError: No module named 'homunculus.devicebeds'` (collection error).

- [ ] **Step 3: The model.** **Write** `homunculus-engine/src/homunculus/devicebeds/__init__.py`:

```python
"""The monitor→bed mapping (Group 2 · Lane B; spec 2026-10-28-g2b-monitor-yatak-esleme-design.md)."""
```

**Write** `homunculus-engine/src/homunculus/devicebeds/models.py`:

```python
# homunculus-engine/src/homunculus/devicebeds/models.py
"""`device_beds` (migration 0014): which monitor sits at which bed, per tenant, for ever. A change
closes the current row (`valid_to`) and opens a new one; a trigger refuses deletes and every edit but
that close. `bed_label` is the strip's label (`Row.bed_label`, NULL = unbound); `device_bed_label` is
what the central station calls the monitor (spec D14). `verified_at` is text: v2's date as written,
or an editor row's UTC ISO time (D21). PHI RULE: no patient data."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from homunculus.db import Base


class DeviceBed(Base):
    __tablename__ = "device_beds"
    __table_args__ = (
        CheckConstraint("valid_to IS NULL OR valid_to > valid_from", name="ck_device_beds_interval"),
        CheckConstraint("(bed_id IS NULL) = (unit_id IS NULL)", name="ck_device_beds_bed_unit"),
        CheckConstraint("bed_id IS NULL OR bed_label IS NOT NULL", name="ck_device_beds_bound_label"),
        Index("uq_device_beds_current_source", "tenant_id", "source", unique=True,
              postgresql_where=text("valid_to IS NULL")),
        Index("uq_device_beds_current_bed", "tenant_id", "bed_id", unique=True,
              postgresql_where=text("valid_to IS NULL AND bed_id IS NOT NULL")),
        Index("ix_device_beds_tenant_source", "tenant_id", "source", "valid_from"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    source: Mapped[str] = mapped_column(String(45), nullable=False)
    group_address: Mapped[str] = mapped_column(String(45), nullable=False)
    port: Mapped[int] = mapped_column(Integer, nullable=False)
    device_bed_label: Mapped[str | None] = mapped_column(String(32))
    bed_label: Mapped[str | None] = mapped_column(String(50))
    bed_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("beds.id"))
    unit_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("units.id"))
    method: Mapped[str | None] = mapped_column(String(32))
    verified_at: Mapped[str | None] = mapped_column(String(40))
    verified_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    note: Mapped[str | None] = mapped_column(String(500))
    valid_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    valid_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    approved_by: Mapped[str] = mapped_column(String(128), nullable=False)
    approved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
```

- [ ] **Step 4: Red again, for the migration:** the same command — `Can't locate revision identified by '0014'` (or `KeyError: '0014'`).

- [ ] **Step 5: The migration.** **Write** `homunculus-engine/alembic/versions/0014_device_beds.py`:

```python
# homunculus-engine/alembic/versions/0014_device_beds.py
"""The monitor→bed editor (spec 2026-10-28 §5.1): `device_beds`, the per-tenant device→bed table

Revision 0014, follows 0013. PURELY ADDITIVE (spec D20, O11): one new table with its checks and
indexes, one function and two triggers; no existing table, column, index or row changes, and no
data is written — the v2 rows come from scripts/import_device_beds.py, which also grants
`devices.map_beds` to the charge nurses (not here). An image from before this revision can serve
against it; only its start command's `alembic upgrade head` refuses an unknown revision (§7.3).

* One current row per device (`uq_device_beds_current_source`) and per bed
  (`uq_device_beds_current_bed`): partial unique indexes over `valid_to IS NULL`.
* History kept: `device_beds_history_kept()` refuses a DELETE, and an UPDATE unless it only closes
  an open row (sets `valid_to`, every other column unchanged) — the pattern of 0004's audit.

ONE STATEMENT PER op.execute (asyncpg; see 0004, 0010, 0013). Downgrade drops exactly this.

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-30
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0014"
down_revision: Union[str, None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "device_beds"
CURRENT_SOURCE = "uq_device_beds_current_source"
CURRENT_BED = "uq_device_beds_current_bed"
HISTORY = "ix_device_beds_tenant_source"
_CREATE_FUNCTION = """CREATE OR REPLACE FUNCTION device_beds_history_kept() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.valid_to IS NULL AND NEW.valid_to IS NOT NULL
     AND ROW(NEW.id, NEW.tenant_id, NEW.source, NEW.group_address, NEW.port, NEW.device_bed_label,
             NEW.bed_label, NEW.bed_id, NEW.unit_id, NEW.method, NEW.verified_at, NEW.verified_by,
             NEW.note, NEW.valid_from, NEW.approved_by, NEW.approved_at)
         IS NOT DISTINCT FROM
         ROW(OLD.id, OLD.tenant_id, OLD.source, OLD.group_address, OLD.port, OLD.device_bed_label,
             OLD.bed_label, OLD.bed_id, OLD.unit_id, OLD.method, OLD.verified_at, OLD.verified_by,
             OLD.note, OLD.valid_from, OLD.approved_by, OLD.approved_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'device_beds keeps its history: a row is never deleted, only closed once';
END;
$$ LANGUAGE plpgsql"""
_CREATE_NO_DELETE = ("CREATE TRIGGER device_beds_no_delete BEFORE DELETE ON device_beds"
                     " FOR EACH ROW EXECUTE FUNCTION device_beds_history_kept()")
_CREATE_CLOSE_ONLY = ("CREATE TRIGGER device_beds_close_only BEFORE UPDATE ON device_beds"
                      " FOR EACH ROW EXECUTE FUNCTION device_beds_history_kept()")
_DROP_CLOSE_ONLY = "DROP TRIGGER IF EXISTS device_beds_close_only ON device_beds"
_DROP_NO_DELETE = "DROP TRIGGER IF EXISTS device_beds_no_delete ON device_beds"
_DROP_FUNCTION = "DROP FUNCTION IF EXISTS device_beds_history_kept()"


def upgrade() -> None:
    op.create_table(
        TABLE,
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("source", sa.String(45), nullable=False),
        sa.Column("group_address", sa.String(45), nullable=False),
        sa.Column("port", sa.Integer(), nullable=False),
        sa.Column("device_bed_label", sa.String(32), nullable=True),
        sa.Column("bed_label", sa.String(50), nullable=True),
        sa.Column("bed_id", UUID(as_uuid=True), sa.ForeignKey("beds.id"), nullable=True),
        sa.Column("unit_id", UUID(as_uuid=True), sa.ForeignKey("units.id"), nullable=True),
        sa.Column("method", sa.String(32), nullable=True),
        sa.Column("verified_at", sa.String(40), nullable=True),
        sa.Column("verified_by", UUID(as_uuid=True), nullable=True),
        sa.Column("note", sa.String(500), nullable=True),
        sa.Column("valid_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column("valid_to", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_by", sa.String(128), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("valid_to IS NULL OR valid_to > valid_from", name="ck_device_beds_interval"),
        sa.CheckConstraint("(bed_id IS NULL) = (unit_id IS NULL)", name="ck_device_beds_bed_unit"),
        sa.CheckConstraint("bed_id IS NULL OR bed_label IS NOT NULL", name="ck_device_beds_bound_label"),
    )
    op.create_index(CURRENT_SOURCE, TABLE, ["tenant_id", "source"], unique=True,
                    postgresql_where=sa.text("valid_to IS NULL"))
    op.create_index(CURRENT_BED, TABLE, ["tenant_id", "bed_id"], unique=True,
                    postgresql_where=sa.text("valid_to IS NULL AND bed_id IS NOT NULL"))
    op.create_index(HISTORY, TABLE, ["tenant_id", "source", "valid_from"])
    op.execute(_CREATE_FUNCTION)
    op.execute(_CREATE_NO_DELETE)
    op.execute(_CREATE_CLOSE_ONLY)


def downgrade() -> None:
    # The triggers and their function first, then the indexes, then the table (spec §7.3 R-2).
    op.execute(_DROP_CLOSE_ONLY)
    op.execute(_DROP_NO_DELETE)
    op.execute(_DROP_FUNCTION)
    op.drop_index(HISTORY, table_name=TABLE)
    op.drop_index(CURRENT_BED, table_name=TABLE)
    op.drop_index(CURRENT_SOURCE, table_name=TABLE)
    op.drop_table(TABLE)
```

- [ ] **Step 6: Green**, with the one-statement check and 0012's parity test beside it:

```bash
cd /c/tmp/g2b-esleme-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_migration_0014_device_beds.py tests/test_audit_postgres.py::test_no_migration_passes_multiple_statements_to_one_execute 2>&1 | tail -3
```

Expected: `7 passed` — the new file's six and the one-statement check (its `$$ … $$` stripping keeps the function body one statement). If `compare_metadata` reports the partial indexes' `postgresql_where` as a difference, read the diff: it must be text only (`valid_to IS NULL` vs `(valid_to IS NULL)`); then compare those two indexes by `pg_indexes.indexdef` in the test instead, and record it as E9.

- [ ] **Step 7: Commit.**

```bash
cd /c/tmp/g2b-esleme-be
git add -- homunculus-engine/alembic/versions/0014_device_beds.py homunculus-engine/src/homunculus/devicebeds/__init__.py homunculus-engine/src/homunculus/devicebeds/models.py homunculus-engine/tests/test_migration_0014_device_beds.py
git status --short && git diff --cached --stat
git commit -F - -- homunculus-engine/alembic/versions/0014_device_beds.py homunculus-engine/src/homunculus/devicebeds/__init__.py homunculus-engine/src/homunculus/devicebeds/models.py homunculus-engine/tests/test_migration_0014_device_beds.py <<'EOF'
feat(devicebeds): migration 0014 device_beds — one current row per device and per bed, history kept, purely additive

A per-tenant device→bed table (spec §5.1): a change closes a row and opens one; a trigger refuses a
delete and every edit but one close. No data and no grant (O11): the old image's code can serve
against it. The model agrees with the migration.

red: collection error — No module named 'homunculus.devicebeds'; then Can't locate revision '0014'

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```


---

### Task 3: The accessor's contract in `api/infinity_device_beds.py`

**Lane:** backend (`/c/tmp/g2b-esleme-be`). **Needs:** nothing (no database). **Lane A review hunk:** `src/homunculus/api/infinity_device_beds.py` — the import line, `TableFile.invalidate` (a new method after `current`, ≈ `:332`), and the block appended after `TableFile` (`DeviceBedSource`, `rows_digest`, `check_current`); nothing else in the file moves.

Spec D6, D19, §5.3; E4. The strip and Aşama B read one interface; this task names it and gives the file source the one method it lacks. The module stays import-pure (`tests/test_infinity_shadow_isolation.py:154-160`): only the standard library and what it already imports.

The two digests below were computed while planning, with this very formula over the committed v2 file (`TableFile(...).current()`, current rows): **v2's is `e470d3342025100ad3dce0e6e42606aa37051d18f4bcac8f02a5abfa3b3b79af`** — the `sha256` the import prints and block C quotes (version 13 on a fresh table).

**Files:**
- Create: `homunculus-engine/tests/test_infinity_device_beds_contract.py`
- Modify: `homunculus-engine/src/homunculus/api/infinity_device_beds.py`

- [ ] **Step 1: Write the failing test.** **Write** `homunculus-engine/tests/test_infinity_device_beds_contract.py`:

```python
# homunculus-engine/tests/test_infinity_device_beds_contract.py
"""The one interface the strip and Aşama B read (spec D6, D19, §5.3): `DeviceBedSource`
(`current()`, `invalidate()`), `rows_digest` (Lane A's rule: the current rows as [source, bed_id,
bed_label], sorted by source, compact JSON, UTF-8) and `check_current` (one current row per source,
one current bound row per bed, a bound row names its bed; NOT the file's label rule). No database."""
from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

import pytest

from homunculus.api.infinity_device_beds import (
    DeviceBedSource, Row, TableError, TableFile, check_current, rows_digest,
)

V2 = Path(__file__).resolve().parents[2] / "deploy" / "infinity" / "device-beds.icu2.json"
V2_DIGEST = "e470d3342025100ad3dce0e6e42606aa37051d18f4bcac8f02a5abfa3b3b79af"
FROM = datetime(2026, 10, 19, tzinfo=timezone.utc)
BED = "ccbcafd3-0e2c-4c20-8960-e260cf02f3af"


def _row(source, bed_label=None, bed_id=None, *, valid_to=None):
    return Row(source, "224.0.2." + source.rsplit(".", 1)[1], 2050, bed_label, bed_id,
               "82ff93a0-4b67-4ccc-b326-77fa48524222" if bed_id else None,
               "editor" if bed_label else None, None, FROM, valid_to, None)


def test_the_file_source_and_any_conforming_object_are_device_bed_sources():
    class Fixed:
        def current(self, now=None):
            return None

        def invalidate(self):
            pass

    assert isinstance(TableFile(V2, clock=lambda: 0.0), DeviceBedSource)
    assert isinstance(Fixed(), DeviceBedSource)
    assert not isinstance(object(), DeviceBedSource)


def test_invalidate_makes_the_next_current_look_again_and_the_same_bytes_keep_their_state():
    reads = []

    def read(path):
        reads.append(path)
        return V2.read_bytes()

    source = TableFile(V2, clock=lambda: 0.0, read=read)
    first = source.current(100.0)
    assert source.current(101.0) is first and len(reads) == 1          # inside RELOAD_EVERY_S
    source.invalidate()
    assert source.current(102.0) is first and len(reads) == 2          # looked again, same bytes


def test_the_digest_is_lane_as_rule_over_the_current_rows():
    rows = [_row("10.10.203.25", "BED01"), _row("10.10.203.23", "BED05", BED)]
    # json.dumps([["10.10.203.23","ccbcafd3-…","BED05"],["10.10.203.25",null,"BED01"]], separators=(",",":"))
    assert rows_digest(rows) == "2f97e8a0953c89fcd0402cd81657b9485c3ccb77e4e72d7e0932b2d6165afd61"
    assert rows_digest(reversed(rows)) == rows_digest(rows)            # sorted by source
    relabelled = [rows[0], replace(rows[1], bed_label="bed05")]
    assert rows_digest(relabelled) != rows_digest(rows)                # the strip's label counts
    assert rows_digest([replace(r, method="both", note="x") for r in rows]) == rows_digest(rows)


def test_the_v2_files_current_rows_digest_to_the_value_the_blocks_quote():
    state = TableFile(V2, clock=lambda: 0.0).current()
    assert state.status == "ok"
    assert rows_digest(r for r in state.table.rows if r.valid_to is None) == V2_DIGEST


@pytest.mark.parametrize("rows, reason", [
    ([_row("10.10.203.23", "BED05", BED), _row("10.10.203.23")], "aynı kaynak"),
    ([_row("10.10.203.23", "BED05", BED), _row("10.10.203.24", "bed05", BED.upper())], "aynı yatak"),
    ([replace(_row("10.10.203.23", "BED05", BED), bed_label=None)], "etiket"),
])
def test_check_current_refuses_two_rows_for_a_device_two_monitors_on_a_bed_and_a_nameless_bed(rows, reason):
    with pytest.raises(TableError, match=reason):
        check_current(rows)


def test_check_current_allows_history_and_a_label_only_row_named_like_a_yapi_bed():
    closed = datetime(2026, 10, 30, tzinfo=timezone.utc)
    check_current([
        _row("10.10.203.23", "BED05", BED, valid_to=closed),        # history: not current
        _row("10.10.203.23", "bed05", BED),
        _row("10.10.203.25", "bed05"),                              # BED01-like: a label, no bed_id
        _row("10.10.203.26"),                                       # unbound
    ])
```

- [ ] **Step 2: Red.**

```bash
cd /c/tmp/g2b-esleme-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_infinity_device_beds_contract.py 2>&1 | tail -3
```

Expected: `ImportError: cannot import name 'DeviceBedSource'` (collection error).

- [ ] **Step 3: The contract.**

**Edit** `homunculus-engine/src/homunculus/api/infinity_device_beds.py` (1) — replace:

```python
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, NamedTuple
```

with:

```python
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, NamedTuple, Protocol, runtime_checkable
```

**Edit** `homunculus-engine/src/homunculus/api/infinity_device_beds.py` (2) — replace:

```python
        self._announce(state)
        self._state = state
        return state

    def _fetch(self) -> tuple[TableState | None, bytes | None]:
```

with:

```python
        self._announce(state)
        self._state = state
        return state

    def invalidate(self) -> None:
        """The next `current()` looks at the file again, whatever RELOAD_EVERY_S says; the same bytes
        still give the same state, unannounced (`DeviceBedSource`, spec §5.3)."""
        self._checked_at = float("-inf")

    def _fetch(self) -> tuple[TableState | None, bytes | None]:
```

**Edit** `homunculus-engine/src/homunculus/api/infinity_device_beds.py` (3) — replace (the file's last lines):

```python
            log.warning("cihaz→yatak tablosu okunamadı (%s): %s; bütün cihazlar atanmamış",
                        state.status, state.reason)
```

with:

```python
            log.warning("cihaz→yatak tablosu okunamadı (%s): %s; bütün cihazlar atanmamış",
                        state.status, state.reason)


# ------------------------------------------------- the one interface (monitor→bed editor, spec §5.3)
@runtime_checkable
class DeviceBedSource(Protocol):
    """What the strip and Aşama B read: `TableFile` in the lab, `PostgresDeviceBeds`
    (api/device_beds_postgres.py) in production. `now` is monotonic seconds, as `TableFile`'s."""

    def current(self, now: float | None = None) -> TableState: ...

    def invalidate(self) -> None: ...


def rows_digest(rows: Iterable[Row]) -> str:
    """Lane A's digest of a table (spec D19): the SHA-256 of the rows as [source, bed_id, bed_label]
    lists, sorted by source, in compact JSON (`,`/`:`, non-ASCII kept) encoded UTF-8. Pass the CURRENT
    rows: two tables with the same devices on the same beds under the same strip labels hash alike,
    whatever their history."""
    lists = sorted(([row.source, row.bed_id, row.bed_label] for row in rows), key=lambda item: item[0])
    return hashlib.sha256(json.dumps(lists, separators=(",", ":"), ensure_ascii=False)
                          .encode("utf-8")).hexdigest()


def check_current(rows: Iterable[Row]) -> None:
    """`TableError` unless the CURRENT rows (`valid_to` None) hold one row per source, one bound row
    per bed (by `bed_id`, as `board_view` tells beds apart) and a label on every bound row. Not the
    file's label rule (`_same_bed`): a label-only row named like a Yapı bed is no second monitor
    there, and refusing it would take every monitor off its bed."""
    sources: set[str] = set()
    beds: dict[str, str] = {}
    for row in rows:
        if row.valid_to is not None:
            continue
        if row.source in sources:
            raise TableError(f"aynı kaynak ({row.source}) için iki güncel satır var")
        sources.add(row.source)
        if row.bed_id:
            if row.bed_label is None:
                raise TableError(f"yatağa bağlı satırın etiketi yok ({row.source})")
            bed = normalise_id(row.bed_id)
            if bed in beds:
                raise TableError(f"aynı yatak için iki güncel satır var ({beds[bed]}, {row.source}): "
                                 "bir yatakta iki monitör")
            beds[bed] = row.source
```

- [ ] **Step 4: Green**, with Lane A's own tests of the file and the isolation test:

```bash
cd /c/tmp/g2b-esleme-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_infinity_device_beds_contract.py tests/test_infinity_device_beds.py tests/test_infinity_shadow_isolation.py 2>&1 | tail -2
```

Expected: all passed — the new file's 9 (1 + 1 + 1 + 1 + 3 + 1 + 1) and the two existing files unchanged.

- [ ] **Step 5: Commit.**

```bash
cd /c/tmp/g2b-esleme-be
git add -- homunculus-engine/tests/test_infinity_device_beds_contract.py homunculus-engine/src/homunculus/api/infinity_device_beds.py
git status --short && git diff --cached --stat
git commit -F - -- homunculus-engine/tests/test_infinity_device_beds_contract.py homunculus-engine/src/homunculus/api/infinity_device_beds.py <<'EOF'
feat(infinity): the device→bed source contract — DeviceBedSource, TableFile.invalidate, rows_digest, check_current

One interface for the strip and Aşama B (spec D6), the file source's invalidate, Lane A's digest of
the current rows (D19; v2's is e470d3342025…) and the database source's check (one row per device,
one monitor per bed, a bound row names its bed). Additive; Lane A reviews the hunk.

red: ImportError — cannot import name 'DeviceBedSource'

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```


---

### Task 4: `PostgresDeviceBeds` — the database source the strip will read

**Lane:** backend (`/c/tmp/g2b-esleme-be`). **Needs:** Tasks 2, 3. **Lane A review hunk:** the whole new file `src/homunculus/api/device_beds_postgres.py` (what the strip and Aşama B read from Task 7 on).

Spec D6, D19, §5.3, E4. A sync engine as `PostgresSamples` (`api/monitor_samples.py:86-96`: `to_sync_url`, `pool_pre_ping`, `hide_parameters=True`). In its own module, not in the lane module, so the isolation test's transitive check stays clean. `current()` re-reads at most every `RELOAD_EVERY_S` and on the first call after `invalidate()`; it loads the tenant's rows valid at the API's wall clock, plus `max(id)` and the tenant's name; fail closed: `missing` (no rows) and `invalid` (unreadable, or a `check_current` violation) place no monitor anywhere.

**Files:**
- Create: `homunculus-engine/src/homunculus/devicebeds/rows.py`
- Create: `homunculus-engine/src/homunculus/api/device_beds_postgres.py`
- Create: `homunculus-engine/tests/test_device_beds_postgres.py`

- [ ] **Step 1: Write the failing test.** **Write** `homunculus-engine/tests/test_device_beds_postgres.py`:

```python
# homunculus-engine/tests/test_device_beds_postgres.py
"""`PostgresDeviceBeds` on the test database (spec §5.3): the tenant's rows as `Row`s, `version` =
max(id), `sha256` = rows_digest of the current rows, `site` = the tenant's name; only rows valid now;
the 10-s cache and `invalidate()`; `missing` and `invalid` fail closed. Synthetic rows only."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from homunculus.api.device_beds_postgres import PostgresDeviceBeds
from homunculus.api.infinity_device_beds import DeviceBedSource, Row, rows_digest
from homunculus.devicebeds.models import DeviceBed
from homunculus.tenant.models import Bed, Room, Site, Tenant, Unit, UnitType
from tests.conftest import TEST_DATABASE_URL, requires_db

pytestmark = [requires_db]
SLUG = "esleme-hastane"
FROM = datetime(2026, 10, 19, tzinfo=timezone.utc)
APPROVED = datetime(2026, 10, 27, tzinfo=timezone.utc)


async def _ward(db):
    tenant = Tenant(name="Sentetik Eşleme Hastanesi", slug=SLUG, country_code="AZ")
    db.add(tenant)
    await db.flush()
    site = Site(tenant_id=tenant.id, name="Ana bina")
    db.add(site)
    await db.flush()
    unit = Unit(site_id=site.id, name="Reanimasiya", unit_type=UnitType.ADULT_ICU)
    db.add(unit)
    await db.flush()
    room = Room(unit_id=unit.id, name="Otaq 05")
    db.add(room)
    await db.flush()
    bed = Bed(room_id=room.id, label="bed05")
    db.add(bed)
    await db.flush()
    return tenant, unit, bed


def _device(tenant, source, *, bed=None, unit=None, label=None, valid_to=None, approved_at=APPROVED):
    return DeviceBed(tenant_id=tenant.id, source=source, group_address="224.0.2." + source.rsplit(".", 1)[1],
                     port=2050, device_bed_label=label, bed_label=label,
                     bed_id=None if bed is None else bed.id, unit_id=None if unit is None else unit.id,
                     method="central_station_list" if label else None, verified_at="2026-09-22" if label else None,
                     note=None if label else "atanmamış", valid_from=FROM, valid_to=valid_to,
                     approved_by="proje sahibi", approved_at=approved_at)


def _source(clock=None):
    return PostgresDeviceBeds(TEST_DATABASE_URL, hospital=SLUG, clock=clock or (lambda: 0.0))


async def test_a_tenant_without_rows_is_missing_and_places_nothing(db_session):
    await _ward(db_session)
    await db_session.commit()
    state = _source().current()
    assert isinstance(_source(), DeviceBedSource)
    assert (state.status, state.table, state.version, state.sha256) == ("missing", None, None, None)
    assert "satır yok" in state.reason
    assert PostgresDeviceBeds(TEST_DATABASE_URL, hospital="baska", clock=lambda: 0.0).current().status == "missing"


async def test_the_rows_are_the_strips_rows_with_version_digest_site_and_approval(db_session):
    tenant, unit, bed = await _ward(db_session)
    bound = _device(tenant, "10.10.203.23", bed=bed, unit=unit, label="BED05")
    label_only = _device(tenant, "10.10.203.25", label="BED01", approved_at=APPROVED + timedelta(days=1))
    db_session.add_all([bound, label_only])
    await db_session.commit()
    state = _source().current()
    assert state.status == "ok" and state.reason is None
    assert state.table.rows == (
        Row("10.10.203.23", "224.0.2.23", 2050, "BED05", str(bed.id), str(unit.id), "central_station_list",
            "2026-09-22", FROM, None, None),
        Row("10.10.203.25", "224.0.2.25", 2050, "BED01", None, None, "central_station_list",
            "2026-09-22", FROM, None, None),
    )
    assert state.version == state.table.version == label_only.id
    assert state.sha256 == rows_digest(state.table.rows)
    assert state.table.site == "Sentetik Eşleme Hastanesi"
    assert (state.table.approved_by, state.table.approved_at) == ("proje sahibi", "2026-10-28")
    assert all(r.valid_from.utcoffset() == timedelta(0) for r in state.table.rows)


async def test_only_rows_valid_now_are_loaded_and_the_version_counts_history(db_session):
    tenant, unit, bed = await _ward(db_session)
    old = _device(tenant, "10.10.203.23", bed=bed, unit=unit, label="BED05",
                  valid_to=datetime.now(timezone.utc) - timedelta(hours=1))
    db_session.add(old)
    await db_session.flush()
    new = _device(tenant, "10.10.203.23", bed=bed, unit=unit, label="bed05")
    db_session.add(new)
    await db_session.commit()
    state = _source().current()
    assert [r.bed_label for r in state.table.rows] == ["bed05"]
    assert state.version == new.id > old.id


async def test_the_read_is_cached_ten_seconds_and_invalidate_reads_again(db_session):
    tenant, unit, bed = await _ward(db_session)
    db_session.add(_device(tenant, "10.10.203.23", bed=bed, unit=unit, label="BED05"))
    await db_session.commit()
    now = [100.0]
    source = _source(lambda: now[0])
    first = source.current()
    db_session.add(_device(tenant, "10.10.203.26"))
    await db_session.commit()
    now[0] = 105.0
    assert source.current() is first                                   # inside RELOAD_EVERY_S
    source.invalidate()
    second = source.current()
    assert len(second.table.rows) == 2 and second.version > first.version
    assert second.sha256 != first.sha256
    now[0] = 116.0
    assert len(source.current().table.rows) == 2                       # past the window: re-read


def test_an_unreadable_database_is_invalid_and_places_nothing():
    state = PostgresDeviceBeds("postgresql://x:y@127.0.0.1:1/none", hospital=SLUG, clock=lambda: 0.0).current()
    assert (state.status, state.table) == ("invalid", None)
    assert "okunamadı" in state.reason
```

- [ ] **Step 2: Red.**

```bash
cd /c/tmp/g2b-esleme-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_device_beds_postgres.py 2>&1 | tail -3
```

Expected: `ModuleNotFoundError: No module named 'homunculus.api.device_beds_postgres'`.

- [ ] **Step 3: The row mapping.** **Write** `homunculus-engine/src/homunculus/devicebeds/rows.py`:

```python
# homunculus-engine/src/homunculus/devicebeds/rows.py
"""A `device_beds` row as the strip's `Row` (spec §5.3's mapping table): `group_address` → `group`,
`bed_id`/`unit_id` as their text, times in UTC. Tasks 9 and 12 add the write helpers here."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from homunculus.api.infinity_device_beds import Row


def utc(moment: datetime | None) -> datetime | None:
    return None if moment is None else moment.astimezone(timezone.utc)


def iso_utc(moment: datetime) -> str:
    """An instant as an editor row's `verified_at` (D21): ISO-8601 with `+00:00`."""
    return moment.astimezone(timezone.utc).isoformat()


def to_row(r: Any) -> Row:
    """A `DeviceBed`, or a mapping row with the same column names, as a `Row`."""
    get = (lambda name: r[name]) if hasattr(r, "keys") else (lambda name: getattr(r, name))
    bed_id, unit_id = get("bed_id"), get("unit_id")
    return Row(get("source"), get("group_address"), get("port"), get("bed_label"),
               None if bed_id is None else str(bed_id), None if unit_id is None else str(unit_id),
               get("method"), get("verified_at"), utc(get("valid_from")), utc(get("valid_to")), get("note"))
```

- [ ] **Step 4: The source.** **Write** `homunculus-engine/src/homunculus/api/device_beds_postgres.py`:

```python
# homunculus-engine/src/homunculus/api/device_beds_postgres.py
"""The device→bed table from the database (migration 0014): the `DeviceBedSource` the strip and
Aşama B read in production (spec D6, §5.3). Lane A reviews this file.

A sync engine, as `PostgresSamples`: `current()` is called on the loop, like the identity store's
reads, and costs one small query per RELOAD_EVERY_S. It loads the tenant's rows valid at the API's
wall clock (history stays in the table), `max(id)` and the tenant's name. Failing closed: no rows is
`missing`, an unreadable database or a broken current set is `invalid`; both place no monitor on any
bed, as a missing or broken file does. A change of state is logged once."""
from __future__ import annotations

import logging
import time
from collections.abc import Callable
from datetime import datetime, timezone

from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError

from homunculus.api.audit_postgres import to_sync_url
from homunculus.api.infinity_device_beds import (
    RELOAD_EVERY_S, DeviceBedTable, TableError, TableState, check_current, rows_digest,
)
from homunculus.devicebeds.rows import to_row

log = logging.getLogger(__name__)

_HEAD = text("SELECT t.id, t.name, (SELECT max(d.id) FROM device_beds d WHERE d.tenant_id = t.id)"
             " FROM tenants t WHERE t.slug = :slug")
_ROWS = text("SELECT source, group_address, port, bed_label, bed_id, unit_id, method, verified_at,"
             " valid_from, valid_to, note, approved_by, approved_at FROM device_beds"
             " WHERE tenant_id = :tenant AND (valid_to IS NULL OR valid_to > :now) ORDER BY id")
MISSING = "eşleme tablosunda bu hastane için satır yok"
UNREADABLE = "eşleme tablosu okunamadı"


class PostgresDeviceBeds:
    def __init__(self, url: str, *, hospital: str, clock: Callable[[], float] = time.monotonic,
                 wall: Callable[[], float] = time.time, ssl_required: bool = False) -> None:
        connect_args = {"sslmode": "require"} if ssl_required else {}
        self._engine = create_engine(to_sync_url(url), pool_pre_ping=True, hide_parameters=True,
                                     connect_args=connect_args)
        self._hospital, self._clock, self._wall = hospital, clock, wall
        self._state: TableState | None = None
        self._checked_at = float("-inf")
        self._said: tuple | None = None

    def current(self, now: float | None = None) -> TableState:
        now = self._clock() if now is None else now
        if self._state is not None and 0 <= now - self._checked_at < RELOAD_EVERY_S:
            return self._state
        self._checked_at = now
        state = self._read()
        said = (state.status, state.reason, state.version, state.sha256)
        if said != self._said:
            self._said = said
            if state.status == "ok":
                log.info("cihaz→yatak tablosu (veritabanı): sürüm %d, sha256 %s…, %d satır",
                         state.version, state.sha256[:12], len(state.table.rows))
            else:
                log.warning("cihaz→yatak tablosu (veritabanı) okunamadı (%s): %s; bütün cihazlar atanmamış",
                            state.status, state.reason)
        self._state = state
        return state

    def invalidate(self) -> None:
        self._checked_at = float("-inf")

    def _read(self) -> TableState:
        wall = datetime.fromtimestamp(self._wall(), timezone.utc)
        try:
            with self._engine.connect() as conn:
                head = conn.execute(_HEAD, {"slug": self._hospital}).first()
                if head is None or head[2] is None:
                    return TableState(None, "missing", MISSING, None, None)
                rows = conn.execute(_ROWS, {"tenant": head[0], "now": wall}).mappings().all()
        except SQLAlchemyError as exc:
            log.error("cihaz→yatak tablosu okunamadı: %s", type(exc).__name__)
            return TableState(None, "invalid", UNREADABLE, None, None)
        if not rows:                               # every row closed before `now`: nothing current
            return TableState(None, "missing", MISSING, None, None)
        table_rows = tuple(to_row(r) for r in rows)
        try:
            check_current(table_rows)
        except TableError as error:
            return TableState(None, "invalid", error.reason, None, None)
        newest = max(rows, key=lambda r: r["approved_at"])
        version = int(head[2])
        table = DeviceBedTable(version, head[1], newest["approved_by"],
                               newest["approved_at"].astimezone(timezone.utc).date().isoformat(), table_rows)
        current = [row for row in table_rows if row.valid_to is None]
        return TableState(table, "ok", None, rows_digest(current), version)
```

- [ ] **Step 5: Green**, with the contract tests:

```bash
cd /c/tmp/g2b-esleme-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_device_beds_postgres.py tests/test_infinity_device_beds_contract.py tests/test_infinity_shadow_isolation.py 2>&1 | tail -2
```

Expected: all passed (5 new). The `approved_at` assertion reads the newest row's day in UTC (`2026-10-28`).

- [ ] **Step 6: Commit.**

```bash
cd /c/tmp/g2b-esleme-be
git add -- homunculus-engine/src/homunculus/devicebeds/rows.py homunculus-engine/src/homunculus/api/device_beds_postgres.py homunculus-engine/tests/test_device_beds_postgres.py
git status --short && git diff --cached --stat
git commit -F - -- homunculus-engine/src/homunculus/devicebeds/rows.py homunculus-engine/src/homunculus/api/device_beds_postgres.py homunculus-engine/tests/test_device_beds_postgres.py <<'EOF'
feat(infinity): PostgresDeviceBeds — the device→bed table from the database, failing closed

The DeviceBedSource production will read (spec §5.3): the tenant's rows valid now as the strip's
Rows, version = max(id), sha256 = rows_digest of the current rows, a 10-s cache and invalidate();
missing and invalid place no monitor on a bed. Lane A reviews the file.

red: ModuleNotFoundError — homunculus.api.device_beds_postgres

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```


---

### Task 5: The seed import — v2 into the table, once, with the charge nurse's grant

**Lane:** backend (`/c/tmp/g2b-esleme-be`). **Needs:** Task 4.

Spec D7, §5.4, §4.6 (O11). `seed.import_v2` holds the logic (testable on `db_session`); Task 6 adds the CLI over it. The sha check first (a test pins `APPROVED_V2_SHA256` to the committed file); Lane A's own parser (`parse_table`); the tenant's row locked so two imports run one after the other; an untouched earlier import answers `already`, anything else in the table refuses (exit 3); every `bed_id` a bed of this tenant and every `unit_id` that bed's room's unit; insert in file order; the grant `devices.map_beds` → `charge_nurse` (`ON CONFLICT DO NOTHING`); one commit; the audit after it; `version`/`sha256` read back by the accessor's own functions.

**Files:**
- Create: `homunculus-engine/tests/esleme_v2.py`
- Create: `homunculus-engine/src/homunculus/devicebeds/seed.py`
- Create: `homunculus-engine/tests/test_device_beds_import.py`

- [ ] **Step 1: The synthetic v2 ward** (shared by Tasks 5, 6, 8). **Write** `homunculus-engine/tests/esleme_v2.py`:

```python
# homunculus-engine/tests/esleme_v2.py
"""A tenant whose one unit and twelve beds carry the committed v2 table's UUIDs (spec §6, the
parity fixture): «Reanimasiya» with rooms «Otaq NN», one bed «bedNN» each — lower-case, as v2's
notes record the Yapı labels (O60). The default groups, so `charge_nurse` exists. Synthetic names."""
from __future__ import annotations

import uuid
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.auth.groups import ensure_default_groups
from homunculus.tenant.models import Bed, Room, Site, Tenant, Unit, UnitType

V2 = Path(__file__).resolve().parents[2] / "deploy" / "infinity" / "device-beds.icu2.json"
V2_DIGEST = "e470d3342025100ad3dce0e6e42606aa37051d18f4bcac8f02a5abfa3b3b79af"
UNIT = uuid.UUID("82ff93a0-4b67-4ccc-b326-77fa48524222")
BEDS = {
    "05": "ccbcafd3-0e2c-4c20-8960-e260cf02f3af", "06": "812c1447-e3c5-4993-a125-e9d1b99ad00f",
    "07": "78410869-6eff-4ba3-ad6f-c14f2d30854c", "08": "de98c201-c2d4-4a07-a983-ac6631627924",
    "09": "4f05102b-2b75-4d53-897a-c03ec57aa208", "10": "ad8fd1e6-7ad5-48b0-bf09-e15a8c50a1bd",
    "11": "ec5a3244-426b-4877-af3c-bb2bb829ce1f", "12": "7b8295b4-cdf2-4261-82e0-190b2027844d",
    "13": "756060d1-3bd4-4b0e-a8e8-03ae135f2229", "14": "94ac21da-f2c3-4fa6-9a50-f450510db771",
    "15": "0ffd2cf8-6fa0-41be-820b-5b4120961546", "25": "67f9ea20-db59-42ab-bfcb-0ff4d53728b0",
}


async def tenant_only(db: AsyncSession, slug: str) -> Tenant:
    tenant = Tenant(name=f"Sentetik {slug}", slug=slug, country_code="AZ")
    db.add(tenant)
    await db.flush()
    await ensure_default_groups(db, tenant.id)
    return tenant


async def v2_ward(db: AsyncSession, slug: str = "esleme-hastane") -> tuple[Tenant, dict[str, Bed]]:
    tenant = await tenant_only(db, slug)
    site = Site(tenant_id=tenant.id, name="Ana bina")
    db.add(site)
    await db.flush()
    db.add(Unit(id=UNIT, site_id=site.id, name="Reanimasiya", unit_type=UnitType.ADULT_ICU))
    await db.flush()
    beds = {}
    for nn, bed_id in BEDS.items():
        room = Room(unit_id=UNIT, name=f"Otaq {nn}")
        db.add(room)
        await db.flush()
        beds[nn] = Bed(id=uuid.UUID(bed_id), room_id=room.id, label=f"bed{nn}")
        db.add(beds[nn])
    await db.commit()
    return tenant, beds
```

- [ ] **Step 2: Write the failing test.** **Write** `homunculus-engine/tests/test_device_beds_import.py`:

```python
# homunculus-engine/tests/test_device_beds_import.py
"""The seed import (spec §5.4): the sha, the parse, the beds and units, the rows, the grant (O11),
the audit, the printed line; an untouched second run is `already`; an edited table is exit 3."""
from __future__ import annotations

import hashlib
import json
import uuid

import pytest
from sqlalchemy import func, select

from homunculus.api.audit import InMemoryAuditLog
from homunculus.auth.models import Group, GroupPermission
from homunculus.devicebeds.models import DeviceBed
from homunculus.devicebeds.seed import APPROVED_V2_SHA256, ImportRefused, import_v2
from tests.conftest import requires_db
from tests.esleme_v2 import V2, V2_DIGEST, tenant_only, v2_ward

pytestmark = [requires_db]
SLUG = "esleme-hastane"


def _edited(edit) -> bytes:
    raw = json.loads(V2.read_bytes())
    edit(raw)
    return json.dumps(raw).encode()


async def _count(db, model=DeviceBed):
    return (await db.execute(select(func.count()).select_from(model))).scalar_one()


async def _granted(db, slug_tenant_id):
    return set((await db.execute(select(Group.slug).join(GroupPermission).where(
        Group.tenant_id == slug_tenant_id, GroupPermission.permission == "devices.map_beds"))).scalars())


def test_the_approved_constant_is_the_committed_v2_files_sha256():
    assert hashlib.sha256(V2.read_bytes()).hexdigest() == APPROVED_V2_SHA256


async def test_v2_imports_as_thirteen_rows_grants_the_charge_nurse_and_audits(db_session):
    tenant, _ = await v2_ward(db_session)
    other = await tenant_only(db_session, "baska-hastane")
    audit = InMemoryAuditLog()
    result = await import_v2(db_session, tenant_slug=SLUG, data=V2.read_bytes(), audit=audit)
    assert (result.rows, result.with_bed, result.without_bed) == (13, 12, 1)
    assert result.granted == ["charge_nurse"] and result.already is False
    assert result.sha256 == V2_DIGEST
    assert result.version == (await db_session.execute(select(func.max(DeviceBed.id)))).scalar_one()
    assert await _granted(db_session, tenant.id) == {"charge_nurse"}
    assert await _granted(db_session, other.id) == set()
    [row] = audit.records(event_type="device_bed.import")
    assert (row.tenant, row.patient_id) == (SLUG, "")
    assert row.payload == {"file_sha256": APPROVED_V2_SHA256, "file_version": 2, "site": "ICU2 (VLAN 203)",
                           "rows": 13, "with_bed": 12, "without_bed": 1, "granted": ["charge_nurse"],
                           "version": result.version, "sha256": V2_DIGEST, "actor": "import"}
    line = result.line()
    assert line.startswith("ESLEME_ICE_AKTARIM ")
    assert json.loads(line.split(" ", 1)[1])["sha256"] == V2_DIGEST
    seeded = (await db_session.execute(select(DeviceBed).order_by(DeviceBed.id))).scalars().first()
    assert (seeded.device_bed_label, seeded.bed_label, seeded.verified_by) == ("BED05", "BED05", None)


async def test_an_untouched_second_run_is_already_done_and_writes_nothing(db_session):
    tenant, _ = await v2_ward(db_session)
    first = await import_v2(db_session, tenant_slug=SLUG, data=V2.read_bytes(), audit=None)
    revoked = await db_session.execute(select(Group).where(Group.tenant_id == tenant.id, Group.slug == "charge_nurse"))
    group = revoked.scalar_one()
    group.permissions = [p for p in group.permissions if p.permission != "devices.map_beds"]   # the admin took it away
    await db_session.commit()
    audit = InMemoryAuditLog()
    again = await import_v2(db_session, tenant_slug=SLUG, data=V2.read_bytes(), audit=audit)
    assert again.already is True and (again.version, again.sha256) == (first.version, first.sha256)
    assert await _count(db_session) == 13 and audit.records() == []
    assert await _granted(db_session, tenant.id) == set()                                     # not put back


async def test_a_table_edited_since_is_refused_with_exit_3(db_session):
    tenant, _ = await v2_ward(db_session)
    await import_v2(db_session, tenant_slug=SLUG, data=V2.read_bytes(), audit=None)
    first = (await db_session.execute(select(DeviceBed).order_by(DeviceBed.id))).scalars().first()
    db_session.add(DeviceBed(tenant_id=tenant.id, source="10.10.203.40", group_address="224.0.2.40", port=2050,
                             valid_from=first.valid_from, approved_by="x", approved_at=first.approved_at))
    await db_session.commit()
    with pytest.raises(ImportRefused) as refused:
        await import_v2(db_session, tenant_slug=SLUG, data=V2.read_bytes(), audit=None)
    assert refused.value.code == 3 and await _count(db_session) == 14


def _swap_bed(raw):
    raw["devices"][0]["bed_id"] = str(uuid.uuid4())


def _swap_unit(raw):
    raw["devices"][0]["unit_id"] = str(uuid.uuid4())


@pytest.mark.parametrize("data, approved, words", [
    (V2.read_bytes() + b" ", None, "sha256"),
    (b"{not json", "own", "JSON"),
    (_edited(lambda raw: raw.update(approved_by="")), "own", "onaylanmamış"),
    (_edited(_swap_bed), "own", "yatak"),
    (_edited(_swap_unit), "own", "birim"),
])
async def test_each_refusal_is_exit_2_and_writes_nothing(db_session, data, approved, words):
    tenant, _ = await v2_ward(db_session)
    sha = hashlib.sha256(data).hexdigest() if approved == "own" else APPROVED_V2_SHA256
    with pytest.raises(ImportRefused, match=words) as refused:
        await import_v2(db_session, tenant_slug=SLUG, data=data, audit=None, approved_sha=sha)
    assert refused.value.code == 2
    assert await _count(db_session) == 0 and await _granted(db_session, tenant.id) == set()


async def test_another_tenants_bed_is_refused_like_a_missing_one(db_session):
    await v2_ward(db_session, "ilk-hastane")
    await tenant_only(db_session, SLUG)
    with pytest.raises(ImportRefused, match="yatak") as refused:
        await import_v2(db_session, tenant_slug=SLUG, data=V2.read_bytes(), audit=None)
    assert refused.value.code == 2


async def test_a_dry_run_checks_everything_and_writes_nothing(db_session):
    tenant, _ = await v2_ward(db_session)
    result = await import_v2(db_session, tenant_slug=SLUG, data=V2.read_bytes(), audit=None, dry_run=True)
    assert (result.rows, result.sha256, result.version, result.granted) == (13, V2_DIGEST, None, [])
    assert await _count(db_session) == 0 and await _granted(db_session, tenant.id) == set()
```

- [ ] **Step 3: Red.**

```bash
cd /c/tmp/g2b-esleme-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_device_beds_import.py 2>&1 | tail -3
```

Expected: `ModuleNotFoundError: No module named 'homunculus.devicebeds.seed'`.

- [ ] **Step 4: The import's logic** — **Write** `homunculus-engine/src/homunculus/devicebeds/seed.py` with exactly the content of `task-05-seed.md` (the next file; split for length).

- [ ] **Step 5: Green.**

```bash
cd /c/tmp/g2b-esleme-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_device_beds_import.py tests/test_device_beds_postgres.py 2>&1 | tail -2
```

Expected: all passed — 11 in the import file (1 + 1 + 1 + 1 + 5 + 1 + 1).

- [ ] **Step 6: Commit.**

```bash
cd /c/tmp/g2b-esleme-be
git add -- homunculus-engine/tests/esleme_v2.py homunculus-engine/src/homunculus/devicebeds/seed.py homunculus-engine/tests/test_device_beds_import.py
git status --short && git diff --cached --stat
git commit -F - -- homunculus-engine/tests/esleme_v2.py homunculus-engine/src/homunculus/devicebeds/seed.py homunculus-engine/tests/test_device_beds_import.py <<'EOF'
feat(devicebeds): the v2 seed import — once, checked, with the charge nurse's one-time grant

import_v2 (spec §5.4): the approved sha, Lane A's parser, the tenant's beds and units, thirteen rows
in file order, devices.map_beds granted to charge_nurse in the same transaction (O11, not 0014), the
device_bed.import audit row, version/sha256 as the accessor reports them. An untouched re-run is
"already" and writes nothing; an edited table is refused (exit 3).

red: ModuleNotFoundError — homunculus.devicebeds.seed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```


---

#### Task 5, Step 4 (continued): `homunculus-engine/src/homunculus/devicebeds/seed.py`

**Write** `homunculus-engine/src/homunculus/devicebeds/seed.py`:

```python
# homunculus-engine/src/homunculus/devicebeds/seed.py
"""The one-time seed of `device_beds` from the approved v2 file (spec D7, §5.4), and the grant of
`devices.map_beds` to the tenant's `charge_nurse` group (§4.6, O11) in the same transaction.

Not a migration: a migration runs on every database (the lab, the tests). The file is checked by its
sha256 against the approved one and parsed by Lane A's own reader; nothing is partly written. Run
again over the untouched rows it answers `already` and writes nothing — not even the grant, which an
administrator may have taken away since (a boot-time grant would put it back, so there is none).

PHI RULE: addresses, labels and ids only."""
from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.api.audit import AuditEvent, AuditLog
from homunculus.api.infinity_device_beds import (
    DeviceBedTable, Row, TableError, no_duplicate_keys, parse_table, rows_digest,
)
from homunculus.auth.models import Group, GroupPermission
from homunculus.devicebeds.models import DeviceBed
from homunculus.devicebeds.rows import to_row
from homunculus.tenant.models import Bed, Room, Site, Tenant, Unit

APPROVED_V2_SHA256 = "84ac1760d59f31b9ab016ca30f08cb1e7387addb02355ea02e3600e4e7ed584d"
DEFAULT_FILE = "/etc/homunculus/infinity-shadow/device-beds.json"
GRANT_KEY, GRANT_GROUP = "devices.map_beds", "charge_nurse"
LINE = "ESLEME_ICE_AKTARIM"


class ImportRefused(Exception):
    """Nothing was written. `code` is the CLI's exit code: 2 a check failed, 3 the tenant's table
    holds other rows than the file's."""

    def __init__(self, code: int, reason: str) -> None:
        super().__init__(reason)
        self.code, self.reason = code, reason


@dataclass
class ImportResult:
    tenant: str
    file_sha256: str
    rows: int
    with_bed: int
    without_bed: int
    granted: list[str] = field(default_factory=list)
    version: int | None = None
    sha256: str | None = None
    already: bool = False
    dry_run: bool = False

    def line(self) -> str:
        return f"{LINE} {json.dumps(asdict(self), ensure_ascii=False)}"


def _parse(data: bytes, approved_sha: str) -> tuple[str, DeviceBedTable]:
    digest = hashlib.sha256(data).hexdigest()
    if digest != approved_sha:
        raise ImportRefused(2, f"dosyanın sha256'sı onaylı v2'ninki değil ({digest[:12]}…)")
    try:
        raw = json.loads(data.decode("utf-8-sig"), object_pairs_hook=no_duplicate_keys)
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise ImportRefused(2, "JSON okunamadı (bozuk ya da tekrarlanan anahtar)") from None
    try:
        return digest, parse_table(raw)
    except TableError as error:
        raise ImportRefused(2, error.reason) from None


async def _check_beds(db: AsyncSession, tenant_id: uuid.UUID, rows: tuple[Row, ...]) -> None:
    for row in rows:
        if row.bed_id is None:
            continue
        try:
            bed_id, unit_id = uuid.UUID(row.bed_id), uuid.UUID(row.unit_id or "")
        except ValueError:
            raise ImportRefused(2, f"{row.source}: yatak ya da birim kimliği bir UUID değil") from None
        found = (await db.execute(
            select(Room.unit_id, Site.tenant_id).select_from(Bed).join(Room, Room.id == Bed.room_id)
            .join(Unit, Unit.id == Room.unit_id).join(Site, Site.id == Unit.site_id)
            .where(Bed.id == bed_id))).first()
        if found is None or found.tenant_id != tenant_id:
            raise ImportRefused(2, f"{row.source}: yatak bu hastanenin değil ya da yok")
        if found.unit_id != unit_id:
            raise ImportRefused(2, f"{row.source}: birim, yatağın odasının birimi değil")


def _seeded(tenant_id: uuid.UUID, row: Row, table: DeviceBedTable) -> DeviceBed:
    approved = datetime.fromisoformat(f"{table.approved_at}T00:00:00+00:00")
    return DeviceBed(
        tenant_id=tenant_id, source=row.source, group_address=row.group, port=row.port,
        device_bed_label=row.bed_label, bed_label=row.bed_label,
        bed_id=None if row.bed_id is None else uuid.UUID(row.bed_id),
        unit_id=None if row.unit_id is None else uuid.UUID(row.unit_id),
        method=row.method, verified_at=row.verified_at, verified_by=None, note=row.note,
        valid_from=row.valid_from, valid_to=row.valid_to,
        approved_by=table.approved_by, approved_at=approved)


async def _grant(db: AsyncSession, tenant_id: uuid.UUID) -> list[str]:
    group_id = (await db.execute(select(Group.id).where(
        Group.tenant_id == tenant_id, Group.slug == GRANT_GROUP, Group.is_system.is_(False)))).scalar_one_or_none()
    if group_id is None:
        return []
    done = await db.execute(pg_insert(GroupPermission).values(group_id=group_id, permission=GRANT_KEY)
                            .on_conflict_do_nothing())
    return [GRANT_GROUP] if done.rowcount == 1 else []


async def _read_back(db: AsyncSession, tenant_id: uuid.UUID) -> tuple[int, str]:
    rows = (await db.execute(select(DeviceBed).where(DeviceBed.tenant_id == tenant_id,
                                                     DeviceBed.valid_to.is_(None)))).scalars().all()
    version = (await db.execute(select(func.max(DeviceBed.id))
                                .where(DeviceBed.tenant_id == tenant_id))).scalar_one()
    return int(version), rows_digest(to_row(r) for r in rows)


async def import_v2(db: AsyncSession, *, tenant_slug: str, data: bytes, audit: AuditLog | None,
                    dry_run: bool = False, approved_sha: str = APPROVED_V2_SHA256) -> ImportResult:
    file_sha, table = _parse(data, approved_sha)
    with_bed = sum(1 for row in table.rows if row.bed_id)
    result = ImportResult(tenant_slug, file_sha, len(table.rows), with_bed, len(table.rows) - with_bed,
                          dry_run=dry_run)
    tenant = (await db.execute(select(Tenant).where(Tenant.slug == tenant_slug)
                               .with_for_update())).scalar_one_or_none()
    if tenant is None:
        await db.rollback()
        raise ImportRefused(2, f"kiracı yok: {tenant_slug}")
    existing = (await db.execute(select(DeviceBed).where(DeviceBed.tenant_id == tenant.id)
                                 .order_by(DeviceBed.id))).scalars().all()
    if existing:
        if tuple(to_row(r) for r in existing) != table.rows:
            await db.rollback()
            raise ImportRefused(3, "bu hastanenin tablosunda dosyadakinden başka satırlar var")
        result.version, result.sha256 = await _read_back(db, tenant.id)
        result.already = True
        await db.rollback()
        return result
    try:
        await _check_beds(db, tenant.id, table.rows)
    except ImportRefused:
        await db.rollback()
        raise
    if dry_run:
        result.sha256 = rows_digest(row for row in table.rows if row.valid_to is None)
        await db.rollback()
        return result
    db.add_all([_seeded(tenant.id, row, table) for row in table.rows])
    await db.flush()
    result.granted = await _grant(db, tenant.id)
    await db.commit()
    result.version, result.sha256 = await _read_back(db, tenant.id)
    if audit is not None:
        try:
            audit.append(AuditEvent(tenant_slug, "device_bed.import", "", "", {
                "file_sha256": file_sha, "file_version": table.version, "site": table.site,
                "rows": result.rows, "with_bed": result.with_bed, "without_bed": result.without_bed,
                "granted": result.granted, "version": result.version, "sha256": result.sha256,
                "actor": "import"}))
        except Exception as exc:  # noqa: BLE001 — the rows are committed (A-26): say so, do not undo
            result_note = type(exc).__name__
            print(f"{LINE}_DENETIM_YAZILAMADI {result_note}")
    return result
```

Notes for the implementer:
- `db.add_all` in file order, then one `flush`: SQLAlchemy inserts the pending `DeviceBed` objects of one mapper in the order they were added, so the ids follow the file (`test_v2_imports…` reads the first row back as BED05).
- `pg_insert(...).on_conflict_do_nothing()` needs `group_permissions`' primary key `(group_id, permission)` (`auth/models.py:165-170`): it is.
- The result's `version` is `max(id)` — 13 only on a table whose sequence starts at 1 (a fresh `device_beds`, as on the VM). The tests compare with the database's own `max(id)`, never with 13.


---

### Task 6: Parity (C2) and the import's command line

**Lane:** backend (`/c/tmp/g2b-esleme-be`). **Needs:** Task 5.

Spec C2, D6, §5.4, §6 "Parity". The proof Lane A asked for: after the import, the database source answers what the file source answers — the same `Row`s in the same order, the same row at every moment, and `board_view` places every monitor alike. Then the thin CLI the deploy blocks run. The committed v2 file is not touched: `tests/test_infinity_device_beds.py::test_the_committed_site_table_is_approved_and_puts_every_monitor_on_its_own_bed` keeps pinning it, and this slice changes neither.

**Files:**
- Create: `homunculus-engine/tests/test_device_beds_parity.py`
- Create: `homunculus-engine/scripts/import_device_beds.py`

- [ ] **Step 1: Write the failing test.** **Write** `homunculus-engine/tests/test_device_beds_parity.py`:

```python
# homunculus-engine/tests/test_device_beds_parity.py
"""C2, the parity proof (spec §6): after the import, PostgresDeviceBeds(...).current() answers what
TableFile(v2).current() answers — row for row, at every moment, and on the strip — and the CLI
(scripts/import_device_beds.py) prints the line the blocks read. Synthetic devices; v2's own rows."""
from __future__ import annotations

import importlib.util
import json
import time
from datetime import timedelta
from pathlib import Path

from sqlalchemy.ext.asyncio import async_sessionmaker

from homunculus.api.audit import InMemoryAuditLog
from homunculus.api.device_beds_postgres import PostgresDeviceBeds
from homunculus.api.infinity_device_beds import TableFile
from homunculus.api.infinity_shadow import DeviceView, board_view
from homunculus.devicebeds.seed import import_v2
from homunculus.scope.rules import normalise_id
from tests.conftest import TEST_DATABASE_URL, requires_db
from tests.esleme_v2 import BEDS, V2, V2_DIGEST, v2_ward

pytestmark = [requires_db]
SLUG = "esleme-hastane"
SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "import_device_beds.py"


def _script():
    spec = importlib.util.spec_from_file_location("import_device_beds", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def _both(db):
    await v2_ward(db)
    await import_v2(db, tenant_slug=SLUG, data=V2.read_bytes(), audit=None)
    return (TableFile(V2, clock=lambda: 0.0).current(),
            PostgresDeviceBeds(TEST_DATABASE_URL, hospital=SLUG, clock=lambda: 0.0).current())


async def test_the_database_holds_the_files_rows_in_the_files_order(db_session):
    file, database = await _both(db_session)
    assert (file.status, database.status) == ("ok", "ok")
    assert database.table.rows == file.table.rows
    assert database.sha256 == V2_DIGEST


async def test_every_source_resolves_to_the_same_row_at_every_moment(db_session):
    file, database = await _both(db_session)
    sources = {row.source for row in file.table.rows} | {"10.10.203.99"}
    start = min(row.valid_from for row in file.table.rows)
    for source in sources:
        for moment in (start - timedelta(seconds=1), start, time.time(), 4102444800.0):   # 2100-01-01
            assert database.table.at(source, moment) == file.table.at(source, moment), (source, moment)


async def test_the_strip_places_every_monitor_alike(db_session):
    file, database = await _both(db_session)
    sources = sorted({row.source for row in file.table.rows} | {"10.10.203.99"})
    devices = {s: DeviceView(s, "224.0.2." + s.rsplit(".", 1)[1], 2050, "streaming", 1.0, 120.0, ())
               for s in sources}
    occupants = {normalise_id(BEDS["05"]): ["H2600042"], normalise_id(BEDS["06"]): ["H2600043", "H2600044"]}

    def view(state):
        body = board_view(devices, {}, state, occupants=occupants, visible=lambda card: True,
                          patient_visible=lambda card: True, show_unassigned=True, now=time.time())
        return body["beds"], body["unassigned"]

    assert view(database) == view(file)
    beds, unassigned = view(database)
    assert [c["source"] for c in unassigned] == ["10.10.203.99"]
    links = {c["bed_label"]: c["link"] for c in beds}
    assert (links["BED05"], links["BED06"], links["BED01"]) == ("one", "ambiguous", "none")


async def test_the_command_line_prints_the_line_then_already(db_session, tmp_path, capsys):
    await v2_ward(db_session)
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)
    audit = InMemoryAuditLog()
    script = _script()
    assert await script.run(["--file", str(V2), "--tenant", SLUG], maker=maker, audit=audit) == 0
    first = json.loads(capsys.readouterr().out.strip().split(" ", 1)[1])
    assert (first["rows"], first["with_bed"], first["without_bed"], first["sha256"]) == (13, 12, 1, V2_DIGEST)
    assert first["granted"] == ["charge_nurse"] and len(audit.records()) == 1
    assert await script.run(["--file", str(V2), "--tenant", SLUG], maker=maker, audit=audit) == 0
    again = json.loads(capsys.readouterr().out.strip().split(" ", 1)[1])
    assert again["already"] is True and again["version"] == first["version"]
    bad = tmp_path / "v2.json"
    bad.write_bytes(V2.read_bytes() + b"\n")
    assert await script.run(["--file", str(bad), "--tenant", SLUG], maker=maker, audit=audit) == 2
    assert "ESLEME_ICE_AKTARIM_RED 2" in capsys.readouterr().err
    assert await script.run(["--file", str(tmp_path / "yok.json"), "--tenant", SLUG], maker=maker) == 2
    assert await script.run(["--file", str(V2), "--tenant", " "], maker=maker) == 2
```

- [ ] **Step 2: Red.**

```bash
cd /c/tmp/g2b-esleme-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_device_beds_parity.py 2>&1 | tail -4
```

Expected: three parity tests PASS already (Tasks 4–5 built what they compare — that is the point of the proof; if one fails, the mapping in `rows.to_row` or `seed._seeded` is wrong: fix it, never the test), and `test_the_command_line_prints_the_line_then_already` FAILS with `FileNotFoundError` (no script). Record both in the commit body.

- [ ] **Step 3: The command line.** **Write** `homunculus-engine/scripts/import_device_beds.py`:

```python
"""Import the approved v2 device→bed table into `device_beds`, once (spec §5.4).

Run on the VM in a one-off container of the NEW api image, after `alembic upgrade head`:

    docker compose run --rm --no-deps -T api python scripts/import_device_beds.py --tenant <slug> </dev/null

It checks the file's sha256 against the approved v2, parses it with the strip's own reader, checks
every bed and unit against this tenant's structure, writes the rows and grants `devices.map_beds` to
the tenant's `charge_nurse` group in one transaction, audits `device_bed.import`, and prints one line:

    ESLEME_ICE_AKTARIM {"tenant", "file_sha256", "rows", "with_bed", "without_bed", "granted",
                        "version", "sha256", "already", "dry_run"}

`version` and `sha256` are what `GET /infinity-shadow/board`'s `table` will say. Exit 0: imported,
or already imported (`"already": true`, nothing written). Exit 2: a check refused, nothing written.
Exit 3: the tenant's table holds other rows than the file's, nothing written. `--dry-run` checks
everything and writes nothing. A refusal prints `ESLEME_ICE_AKTARIM_RED <code> <reason>` on stderr.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

from homunculus.api.infinity_device_beds import MAX_BYTES, read_capped
from homunculus.devicebeds.seed import DEFAULT_FILE, LINE, ImportRefused, import_v2


def _refused(code: int, reason: str) -> int:
    print(f"{LINE}_RED {code} {reason}", file=sys.stderr)
    return code


async def run(argv=None, *, maker=None, audit=None) -> int:
    parser = argparse.ArgumentParser(description="Import the approved v2 device→bed table, once.")
    parser.add_argument("--file", default=DEFAULT_FILE)
    parser.add_argument("--tenant", default=os.getenv("INFINITY_SHADOW_HOSPITAL", ""))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    tenant = args.tenant.strip()
    if not tenant:
        return _refused(2, "kiracı verilmedi (--tenant ya da INFINITY_SHADOW_HOSPITAL)")
    try:
        data = read_capped(Path(args.file))
    except OSError as exc:
        return _refused(2, f"dosya okunamadı ({type(exc).__name__})")
    if len(data) > MAX_BYTES:
        return _refused(2, f"dosya {MAX_BYTES // 1024} KiB'tan büyük")
    engine = None
    if maker is None:                                     # the deployed path: the app's own database
        from sqlalchemy.ext.asyncio import async_sessionmaker

        from homunculus.api.audit_postgres import PostgresAuditLog
        from homunculus.db import engine as app_engine
        engine = app_engine
        maker = async_sessionmaker(engine, expire_on_commit=False)
        if audit is None:
            audit = PostgresAuditLog(os.environ["DATABASE_URL"], ssl_required=os.getenv(
                "DATABASE_SSL", "").lower() in ("require", "true", "1"))
    try:
        async with maker() as db:
            result = await import_v2(db, tenant_slug=tenant, data=data, audit=audit, dry_run=args.dry_run)
    except ImportRefused as refused:
        return _refused(refused.code, refused.reason)
    finally:
        if engine is not None:
            await engine.dispose()
    print(result.line())
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run()))
```

- [ ] **Step 4: Green.** The same command: `4 passed`. Then the whole slice so far and the pinned file test:

```bash
cd /c/tmp/g2b-esleme-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_device_beds_parity.py tests/test_device_beds_import.py tests/test_device_beds_postgres.py tests/test_infinity_device_beds.py tests/test_docker_build_context.py 2>&1 | tail -2
```

Expected: all passed. (`test_docker_build_context.py` checks what `Dockerfile.api` copies: `scripts/` is copied whole, so the new script ships in the image.)

- [ ] **Step 5: Commit.**

```bash
cd /c/tmp/g2b-esleme-be
git add -- homunculus-engine/tests/test_device_beds_parity.py homunculus-engine/scripts/import_device_beds.py
git status --short && git diff --cached --stat
git commit -F - -- homunculus-engine/tests/test_device_beds_parity.py homunculus-engine/scripts/import_device_beds.py <<'EOF'
feat(devicebeds): parity with the v2 file (C2) and the import's command line

After the import the database source answers what TableFile(v2) answers: the same Rows in order,
the same row at every moment, the same strip (beds, links, unassigned). The CLI the blocks run prints
ESLEME_ICE_AKTARIM with version and sha256 (e470d3342025… for v2), exit 0/2/3.

red: the CLI test — FileNotFoundError, no scripts/import_device_beds.py (the three parity tests
passed on Tasks 4–5's code, as a proof should)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```


---

### Task 7: The five codes, and the app's wiring for the editor

**Lane:** backend (`/c/tmp/g2b-esleme-be`). **Needs:** Task 4. **Lane A review hunk:** `src/homunculus/api/app.py` — the import line (`:48`), the `create_app` parameter (after `samples`, `:194`) and its docstring line, the `shadow_table =` line (`:255`), `_occupants` (`:1170-1195`) split into `_occupants_now` and its cache plus one `app.state.bed_occupants` line after it, and four `app.state` lines after `app.state.shadow_lane = lane` (`:633`); `src/homunculus/api/prodserver.py` — `_device_beds` beside `_samples` (`:472-483`), its import, and one argument to `create_app`. No other line of either file.

Spec D6, D12, §4.5, §4.9. The router (Task 8) reaches the lane through `request.app.state`; this task puts there what it needs and nothing else, and swaps the file source for the database source in production behind the same `shadow_table.current()`. The codes land now so the dashboard lane can start Task 16 (its `apiErrors.test.js` reads `admission/errors.py`).

**Files:**
- Modify: `homunculus-engine/src/homunculus/admission/errors.py`
- Modify: `homunculus-engine/src/homunculus/api/app.py`
- Modify: `homunculus-engine/src/homunculus/api/prodserver.py`
- Create: `homunculus-engine/tests/test_device_beds_wiring.py`

- [ ] **Step 1: Write the failing test.** **Write** `homunculus-engine/tests/test_device_beds_wiring.py`:

```python
# homunculus-engine/tests/test_device_beds_wiring.py
"""The editor's wiring (spec D6, §4.9): `create_app(device_beds=…)` puts that source behind the
strip; `app.state` carries the lane's settings and clock, the table's invalidate and an uncached
per-bed occupant read that the strip's cached one shares; the five codes are registered. No DB."""
from __future__ import annotations

import time
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from homunculus.admission.errors import CODES
from homunculus.api.app import create_app
from homunculus.api.infinity_device_beds import TableState
from homunculus.api.infinity_shadow import ShadowSettings
from homunculus.api.patient_identity import IdentityRecord, InMemoryIdentityStore

H, DEVICE, TOKEN = "esleme-hastane", "esleme-device", "s" * 40
BED = "ccbcafd3-0e2c-4c20-8960-e260cf02f3af"


class Source:
    def __init__(self):
        self.reads, self.resets = 0, 0

    def current(self, now=None):
        self.reads += 1
        return TableState(None, "missing", "eşleme tablosunda bu hastane için satır yok", None, None)

    def invalidate(self):
        self.resets += 1


def _app(source, identities=None):
    settings = ShadowSettings("shadow", "shadow", None, TOKEN, H)
    return create_app({DEVICE: H}, run_escalation_loop=False, shadow=settings, device_beds=source,
                      identities=identities or InMemoryIdentityStore()), settings


def test_the_five_codes_are_registered():
    assert {"monitor_lane_off", "device_unknown", "bed_occupied", "mapping_changed",
            "bed_has_monitor"} <= CODES


def test_the_strip_reads_the_source_it_is_given_and_the_state_hooks_reach_it():
    source = Source()
    app, settings = _app(source)
    assert app.state.shadow_settings is settings and app.state.shadow_clock is time.time
    body = TestClient(app).get("/infinity-shadow/board", headers={"Authorization": f"Bearer {DEVICE}"}).json()
    assert body["table"]["status"] == "missing" and source.reads >= 1
    app.state.shadow_table_reset()
    assert source.resets == 1


def test_bed_occupants_is_the_strips_rule_read_fresh_every_time():
    identities = InMemoryIdentityStore()
    app, _ = _app(Source(), identities)
    assert app.state.bed_occupants(H) == {}
    identities.apply(H, IdentityRecord(patient_id="H2600042", given="Ahmet", family="Yılmaz", source="test",
                                       updated_at=datetime(2026, 10, 30, tzinfo=timezone.utc), bed_id=BED))
    assert app.state.bed_occupants(H) == {BED: ["H2600042"]}          # no 10-s cache in between


def test_without_a_source_the_lab_reads_the_file():
    app, _ = _app(None)
    assert type(app.state.shadow_table_reset.__self__).__name__ == "TableFile"
```

- [ ] **Step 2: Red.**

```bash
cd /c/tmp/g2b-esleme-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_device_beds_wiring.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed)|Error" | head
```

Expected: 4 failed — the codes test `AssertionError` (not in `CODES`), the three others `TypeError: create_app() got an unexpected keyword argument 'device_beds'`.

- [ ] **Step 3: The codes.** **Edit** `homunculus-engine/src/homunculus/admission/errors.py` — replace:

```python
FIELD_INVALID = "field_invalid"                  # + ":<field>"

#: Every code but FIELD_INVALID, which travels with its field.
CODES = frozenset({
    BED_NOT_AVAILABLE, BED_CLOSED, OUT_OF_SCOPE, CRITICAL_ALARM_OPEN, PATIENT_NUMBER_EXHAUSTED,
    INVALID_TRANSITION, MISSING_ATTENDING, OPEN_ADMISSION, BED_IN_USE, HAS_OPEN_BEDS, NAME_TAKEN,
    BED_LABEL_TAKEN, REQUEST_CONFLICT, BOARD_NOT_CLEARED, TRANSFER_UNAVAILABLE,
    DUPLICATE_OPEN_ADMISSION,
})
```

with:

```python
FIELD_INVALID = "field_invalid"                  # + ":<field>"
# G2 monitor→bed editor (spec 2026-10-28 §4.5)
MONITOR_LANE_OFF = "monitor_lane_off"            # the strip is off, or the caller is not its hospital
DEVICE_UNKNOWN = "device_unknown"                # the worker never reported it and no row holds it
BED_OCCUPIED = "bed_occupied"                    # an admitted patient there, and no confirm_occupied
MAPPING_CHANGED = "mapping_changed"              # `expected` is not what holds, or an index fired
BED_HAS_MONITOR = "bed_has_monitor"              # Yapı: a bed with a monitor bound is not closed

#: Every code but FIELD_INVALID, which travels with its field.
CODES = frozenset({
    BED_NOT_AVAILABLE, BED_CLOSED, OUT_OF_SCOPE, CRITICAL_ALARM_OPEN, PATIENT_NUMBER_EXHAUSTED,
    INVALID_TRANSITION, MISSING_ATTENDING, OPEN_ADMISSION, BED_IN_USE, HAS_OPEN_BEDS, NAME_TAKEN,
    BED_LABEL_TAKEN, REQUEST_CONFLICT, BOARD_NOT_CLEARED, TRANSFER_UNAVAILABLE,
    DUPLICATE_OPEN_ADMISSION,
    MONITOR_LANE_OFF, DEVICE_UNKNOWN, BED_OCCUPIED, MAPPING_CHANGED, BED_HAS_MONITOR,
})
```

- [ ] **Step 4: `api/app.py`.**

**Edit** (1) — replace `from homunculus.api.infinity_device_beds import TableFile` with:

```python
from homunculus.api.infinity_device_beds import DeviceBedSource, TableFile
```

**Edit** (2) — replace:

```python
    samples: SampleStore | None = None,
) -> FastAPI:
```

with:

```python
    samples: SampleStore | None = None,
    device_beds: DeviceBedSource | None = None,
) -> FastAPI:
```

and in the docstring, after the sentence about `shadow_clock`, add one line: `` `device_beds` is the device→bed table the strip reads (G2-ESLEME, spec D6): `PostgresDeviceBeds` in production; None reads the file at `shadow.table_path` (the lab). ``

**Edit** (3) — replace:

```python
    shadow_table = TableFile(shadow.table_path, clock=time.monotonic)
```

with:

```python
    shadow_table = device_beds if device_beds is not None else TableFile(shadow.table_path, clock=time.monotonic)
```

**Edit** (4) — replace:

```python
    app.state.shadow_store = shadow_store
    app.state.shadow_lane = lane
```

with:

```python
    app.state.shadow_store = shadow_store
    app.state.shadow_lane = lane
    # G2-ESLEME (the monitor→bed editor, devicebeds/router.py): the lane's settings and clock, so the
    # editor answers only while this strip runs for its hospital (spec D15), and the table's
    # invalidate, so the next read after a change re-reads (§4.4 step 11).
    app.state.shadow_settings = shadow
    app.state.shadow_clock = shadow_clock
    app.state.shadow_table_reset = shadow_table.invalidate
```

**Edit** (5) — replace the head of `_occupants` down to its loop:

```python
    def _occupants(hospital: str, now: float) -> dict[str, list[str]]:
```

…through…

```python
        cached = shadow_occupancy.get(hospital)
        if cached is not None and 0 <= now - cached[0] < SHADOW_OCCUPANCY_CACHE_S:
            return cached[1]
        beds: dict[str, list[str]] = {}
```

with (the docstring moves to `_occupants_now`, unchanged but for its first line):

```python
    def _occupants_now(hospital: str) -> dict[str, list[str]]:
        """Admitted patients per bed, read now (uncached): a `kabul` record (an admission made here,
        G2-B1a) by its own `bed_id`, the tenant's bed UUID; every other record through the site's bed
        map — read-only and counting nothing (`BedMap.lookup`). The ONLY bridge between a monitor and
        a patient in Aşama A: an explicit binding the hospital already made (an admission here,
        ADT or set_identity), never a guess from a name (design K3, K5). Discharged identities
        are not admitted, so never here. The strip reads it through `_occupants` (cached 10 s); the
        monitor→bed editor through `app.state.bed_occupants` (fresh: G2-ESLEME §4.4 step 8b)."""
        beds: dict[str, list[str]] = {}
```

and replace the function's tail:

```python
            if normalise_id(bed_id):
                beds.setdefault(normalise_id(bed_id), []).append(patient_id)
        shadow_occupancy[hospital] = (now, beds)
        return beds
```

with:

```python
            if normalise_id(bed_id):
                beds.setdefault(normalise_id(bed_id), []).append(patient_id)
        return beds

    def _occupants(hospital: str, now: float) -> dict[str, list[str]]:
        """`_occupants_now`, cached SHADOW_OCCUPANCY_CACHE_S per hospital (`_occupancy_reset` drops it)."""
        cached = shadow_occupancy.get(hospital)
        if cached is not None and 0 <= now - cached[0] < SHADOW_OCCUPANCY_CACHE_S:
            return cached[1]
        beds = _occupants_now(hospital)
        shadow_occupancy[hospital] = (now, beds)
        return beds

    app.state.bed_occupants = _occupants_now          # G2-ESLEME: the editor's fresh read (§4.9)
```

The loop between them (`for patient_id in identities.admitted_ids(hospital): …`) stays as it is, now inside `_occupants_now`.

- [ ] **Step 5: `api/prodserver.py`.** **Edit** (1) — after `from homunculus.api.infinity_shadow import shadow_settings_from_env` add:

```python
from homunculus.api.device_beds_postgres import PostgresDeviceBeds
from homunculus.api.infinity_device_beds import DeviceBedSource
```

**Edit** (2) — replace:

```python
# Aşama A's monitor strip and Aşama B's shadow engine: INFINITY_CLINICAL_STAGE, off unless set. A
```

with:

```python
def _device_beds(url: str, hospital: str) -> DeviceBedSource | None:
    """G2-ESLEME (spec D6): the device→bed table from the database (migration 0014, seeded by
    scripts/import_device_beds.py) on a Postgres deployment, for the lane's hospital, with the
    audit's TLS flag. None — the lab, or no lane hospital — leaves the strip on the file."""
    if _is_production(url) and hospital:
        return PostgresDeviceBeds(url, hospital=hospital,
                                  ssl_required=os.getenv("DATABASE_SSL", "").lower() in ("require", "true", "1"))
    return None


# Aşama A's monitor strip and Aşama B's shadow engine: INFINITY_CLINICAL_STAGE, off unless set. A
```

**Edit** (3) — replace:

```python
    samples=_samples(_database_url()),
)
```

with:

```python
    samples=_samples(_database_url()),
    device_beds=_device_beds(_database_url(), _shadow.hospital),
)
```

- [ ] **Step 6: Green**, and the strip's own suites unchanged:

```bash
cd /c/tmp/g2b-esleme-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_device_beds_wiring.py tests/test_infinity_shadow_api.py tests/test_infinity_rules.py tests/test_infinity_shadow_isolation.py tests/test_prodserver*.py 2>&1 | tail -2
```

Expected: all passed (4 new). If a `test_prodserver*` file builds the module with a Postgres URL and no database, `PostgresDeviceBeds` connects only at its first `current()`: building it never fails. Then the whole no-DB suite (`--ignore=tests/test_infinity_vm_pilot.py`): no failure.

- [ ] **Step 7: Commit.**

```bash
cd /c/tmp/g2b-esleme-be
git add -- homunculus-engine/src/homunculus/admission/errors.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/src/homunculus/api/prodserver.py homunculus-engine/tests/test_device_beds_wiring.py
git status --short && git diff --cached --stat
git commit -F - -- homunculus-engine/src/homunculus/admission/errors.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/src/homunculus/api/prodserver.py homunculus-engine/tests/test_device_beds_wiring.py <<'EOF'
feat(infinity): the editor's wiring — the table source as a parameter, the lane's hooks on app.state, five codes

create_app(device_beds=…) puts PostgresDeviceBeds behind shadow_table.current() in production
(prodserver), the file in the lab. app.state gains shadow_settings, shadow_clock,
shadow_table_reset and bed_occupants — the strip's occupant rule read fresh, shared with its cache.
Codes monitor_lane_off, device_unknown, bed_occupied, mapping_changed, bed_has_monitor. Lane A
reviews the app.py and prodserver.py hunks.

red: 4 failed — create_app() got an unexpected keyword argument 'device_beds'; codes not registered

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```


---

### Task 8: `GET /infinity-shadow/device-beds` — the list

**Lane:** backend (`/c/tmp/g2b-esleme-be`). **Needs:** Tasks 5, 7. **Lane A review hunk:** `src/homunculus/api/app.py` — one import line beside the other routers' and one `app.include_router(device_beds_router)` after `app.include_router(infinity_research_router)` (`:621`).

Spec D8, D9, D12, D15, §4.1, §4.2, E8. The union of what the worker reports (`shadow_store.devices(now)`) and the tenant's current rows, ordered by address; live fields from the store, identity from the worker else the row; `row_id` (the `expected` token); `bed` with names only when the caller's scope reaches it (`structure.manage` and an unrestricted scope see every name); `editable` for `devices.map_beds` holders on an unbound device or a reached bed. Guards: `require_permission("devices.manage", "devices.map_beds")`, `caller_tenant_id`, and `monitor_lane_off` unless the strip runs for this tenant's slug.

**Files:**
- Create: `homunculus-engine/tests/esleme_world.py` (the code is in `task-08-world.md`)
- Create: `homunculus-engine/src/homunculus/devicebeds/listing.py`
- Create: `homunculus-engine/src/homunculus/devicebeds/router.py`
- Create: `homunculus-engine/tests/test_device_beds_api.py`
- Modify: `homunculus-engine/src/homunculus/api/app.py`
- Modify: `homunculus-engine/tests/test_route_permissions.py`, `homunculus-engine/tests/test_nginx_routes.py`

- [ ] **Step 1: The world.** **Write** `homunculus-engine/tests/esleme_world.py` with the content of `task-08-world.md`.

- [ ] **Step 2: Write the failing test.** **Write** `homunculus-engine/tests/test_device_beds_api.py` (Task 9 appends to it):

```python
# homunculus-engine/tests/test_device_beds_api.py
"""The editor's routes (spec §4): the list (Task 8); bind and unbind (Task 9). Synthetic ward."""
from __future__ import annotations

import pytest

from tests.conftest import requires_db
from tests.esleme_world import URL, esleme_client, seed
from tests.kabul_world import BOARD

pytestmark = [requires_db]


def _by_source(body):
    return {d["source"]: d for d in body["devices"]}


async def test_the_list_is_the_workers_devices_and_the_tables_rows_in_address_order(db_session):
    async with esleme_client(db_session) as (client, _, ward):
        ids = await seed(db_session, ward, ("192.0.2.11", "1", "BED05"), ("192.0.2.12", None, "BED01"),
                         ("192.0.2.20", "3", "BED07"))
        body = (await client.get(URL, headers=ward.auth["admin"])).json()
    assert body["stage"] == "shadow" and body["can_bind"] is True
    assert [d["source"] for d in body["devices"]] == ["192.0.2.11", "192.0.2.12", "192.0.2.13", "192.0.2.20"]
    d = _by_source(body)
    assert d["192.0.2.11"] | {"last_seen_at": None} == {
        "source": "192.0.2.11", "group": "224.0.2.11", "port": 2050, "device_bed_label": "BED05",
        "seen": True, "status": "streaming", "last_seen_at": None, "row_id": ids["192.0.2.11"],
        "bed": {"id": str(ward.beds["1"].id), "in_scope": True, "label": "1", "room": "Otaq 1",
                "unit": "Reanimasiya"},
        "editable": True}
    assert d["192.0.2.11"]["last_seen_at"].endswith("+00:00")
    assert (d["192.0.2.12"]["bed"], d["192.0.2.12"]["device_bed_label"]) == (None, "BED01")   # label-only
    assert (d["192.0.2.13"]["row_id"], d["192.0.2.13"]["bed"], d["192.0.2.13"]["editable"]) == (None, None, True)
    absent = d["192.0.2.20"]                                         # bound, not reported: kept (D9)
    assert (absent["seen"], absent["status"], absent["last_seen_at"]) == (False, None, None)
    assert absent["bed"]["label"] == "3" and absent["group"] == "224.0.2.20"


async def test_a_charge_nurse_sees_another_units_monitor_without_names_and_cannot_edit_it(db_session):
    async with esleme_client(db_session) as (client, _, ward):
        await seed(db_session, ward, ("192.0.2.11", "N1", "BEDN1"), ("192.0.2.12", "2", "BED02"))
        body = (await client.get(URL, headers=ward.auth["charge"])).json()
    d = _by_source(body)
    assert d["192.0.2.11"]["bed"] == {"id": str(ward.beds["N1"].id), "in_scope": False}
    assert d["192.0.2.11"]["editable"] is False
    assert d["192.0.2.12"]["bed"]["in_scope"] is True and d["192.0.2.12"]["editable"] is True
    assert d["192.0.2.13"]["editable"] is True                      # unbound: any holder may bind it


async def test_biomedical_reads_the_list_and_may_change_nothing(db_session):
    async with esleme_client(db_session) as (client, _, ward):
        await seed(db_session, ward, ("192.0.2.11", "1", "BED05"))
        body = (await client.get(URL, headers=ward.auth["bio"])).json()
    assert body["can_bind"] is False and not any(d["editable"] for d in body["devices"])


@pytest.mark.parametrize("who, status", [("nurse", 403), ("auditor", 403)])
async def test_a_caller_without_either_key_is_refused(db_session, who, status):
    async with esleme_client(db_session) as (client, _, ward):
        assert (await client.get(URL, headers=ward.auth[who])).status_code == status


async def test_a_device_token_is_not_a_person(db_session):
    async with esleme_client(db_session) as (client, _, _ward):
        assert (await client.get(URL, headers=BOARD)).status_code == 401


@pytest.mark.parametrize("options", [{"stage": "off"}, {"hospital": "baska-hastane"}])
async def test_the_list_answers_monitor_lane_off_unless_the_strip_runs_for_this_hospital(db_session, options):
    async with esleme_client(db_session, **options) as (client, _, ward):
        response = await client.get(URL, headers=ward.auth["admin"])
    assert response.status_code == 409 and response.json()["detail"]["code"] == "monitor_lane_off"


async def test_at_stage_rules_the_list_says_rules(db_session):
    async with esleme_client(db_session, stage="rules") as (client, _, ward):
        assert (await client.get(URL, headers=ward.auth["admin"])).json()["stage"] == "rules"
```

- [ ] **Step 3: Red.**

```bash
cd /c/tmp/g2b-esleme-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_device_beds_api.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed)" | head
```

Expected: every test fails — the route does not exist (`404 != 403`, `KeyError: 'stage'` on a 404 body). (A `TypeError` on `ShadowSettings(... parameters=…)` means the world's settings line is wrong: `parameters` is a keyword field.)

- [ ] **Step 4: The list.** **Write** `homunculus-engine/src/homunculus/devicebeds/listing.py`:

```python
# homunculus-engine/src/homunculus/devicebeds/listing.py
"""`GET /infinity-shadow/device-beds`'s body (spec §4.2). Devices: the worker's (the strip's store)
∪ the tenant's current rows, ordered by address. Identity from the worker when it reports the device,
else from its row; a bed named only when the caller's scope reaches it. No patient anywhere."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission import unitscope
from homunculus.api.infinity_device_beds import PORT
from homunculus.auth.dependencies import Principal
from homunculus.devicebeds.models import DeviceBed
from homunculus.tenant.models import Bed, Room, Unit

UNSEEN = (None, "unknown")


def _iso(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat()


def _address(source: str) -> tuple[int, ...]:
    return tuple(int(part) for part in source.split("."))


async def current_rows(db: AsyncSession, tenant_id: uuid.UUID) -> dict[str, DeviceBed]:
    rows = (await db.execute(select(DeviceBed).where(DeviceBed.tenant_id == tenant_id,
                                                     DeviceBed.valid_to.is_(None)))).scalars().all()
    return {row.source: row for row in rows}


async def bed_places(db: AsyncSession, bed_ids) -> dict[uuid.UUID, tuple[str, str, str, uuid.UUID]]:
    """Each bed's (label, room name, unit name, unit id) — the structure's current names."""
    if not bed_ids:
        return {}
    rows = (await db.execute(select(Bed.id, Bed.label, Room.name, Unit.name, Unit.id)
                             .join(Room, Room.id == Bed.room_id).join(Unit, Unit.id == Room.unit_id)
                             .where(Bed.id.in_(list(bed_ids))))).all()
    return {r[0]: (r[1], r[2], r[3], r[4]) for r in rows}


async def build(state, db: AsyncSession, tenant_id: uuid.UUID, principal: Principal) -> dict:
    settings, now = state.shadow_settings, state.shadow_clock()
    views = state.shadow_store.devices(now)
    rows = await current_rows(db, tenant_id)
    places = await bed_places(db, {r.bed_id for r in rows.values() if r.bed_id})
    everything = "structure.manage" in principal.perms
    scope = None if everything else await unitscope.caller_scope(db, principal.user.id, tenant_id)
    can_bind = "devices.map_beds" in principal.perms
    devices = []
    for source in sorted(set(views) | set(rows), key=_address):
        view, row = views.get(source), rows.get(source)
        bed = None
        if row is not None and row.bed_id is not None:
            label, room, unit, unit_id = places.get(row.bed_id, ("", "", "", None))
            reached = scope is None or unitscope.reaches(scope, unit_id=unit_id, bed_id=row.bed_id)
            bed = ({"id": str(row.bed_id), "in_scope": True, "label": label, "room": room, "unit": unit}
                   if reached else {"id": str(row.bed_id), "in_scope": False})
        devices.append({
            "source": source,
            "group": view.group if view is not None else row.group_address,
            "port": PORT,
            "device_bed_label": row.device_bed_label if row is not None else None,
            "seen": view is not None and view.status not in UNSEEN,
            "status": view.status if view is not None else None,
            "last_seen_at": _iso(now - view.status_age_s) if view is not None else None,
            "row_id": row.id if row is not None else None,
            "bed": bed,
            "editable": can_bind and (bed is None or bed["in_scope"]),
        })
    return {"stage": "rules" if settings.rules else "shadow", "generated_at": _iso(now),
            "can_bind": can_bind, "devices": devices}
```

- [ ] **Step 5: The router (GET).** **Write** `homunculus-engine/src/homunculus/devicebeds/router.py`:

```python
# homunculus-engine/src/homunculus/devicebeds/router.py
"""The monitor→bed editor's routes (spec §4.1), beside the strip they change: the list, bind and
unbind. People only (a JWT; a device token is 401), and only while the strip runs for the caller's
own hospital — at stage `shadow` or `rules`, the tenant's slug equal to INFINITY_SHADOW_HOSPITAL —
otherwise 409 `monitor_lane_off` (D15). Refusals carry a stable code (admission/errors.py)."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission import trail
from homunculus.admission.errors import MONITOR_LANE_OFF, Refusal
from homunculus.auth.dependencies import Principal, caller_tenant_id, get_principal, require_permission
from homunculus.auth.models import User
from homunculus.db import get_db
from homunculus.devicebeds import listing

router = APIRouter(prefix="/infinity-shadow/device-beds", tags=["device-beds"])


async def lane_hospital(request: Request, db: AsyncSession, tenant_id: uuid.UUID) -> str:
    """The caller's hospital key (its tenant's slug), or 409 `monitor_lane_off`."""
    settings = getattr(request.app.state, "shadow_settings", None)
    hospital = await trail.hospital_of(db, tenant_id)
    if settings is None or not settings.on or hospital != settings.hospital:
        raise Refusal(409, MONITOR_LANE_OFF, "The monitor strip is not running for this hospital.").http()
    return hospital


@router.get("", summary="Monitors and the beds they sit at (the Monitörler screen's editor)")
async def device_beds(
    request: Request, db: AsyncSession = Depends(get_db), caller_tenant: uuid.UUID = Depends(caller_tenant_id),
    principal: Principal = Depends(get_principal),
    _user: User = Depends(require_permission("devices.manage", "devices.map_beds")),
) -> dict:
    await lane_hospital(request, db, caller_tenant)
    return await listing.build(request.app.state, db, caller_tenant, principal)
```

- [ ] **Step 6: Mount it.** **Edit** `homunculus-engine/src/homunculus/api/app.py` (1): after the import line of `infinity_research_router` (find it with `grep -n "infinity_research_router" src/homunculus/api/app.py`) add:

```python
from homunculus.devicebeds.router import router as device_beds_router   # G2-ESLEME
```

**Edit** (2) — replace:

```python
    app.include_router(infinity_research_router)
```

with:

```python
    app.include_router(infinity_research_router)
    app.include_router(device_beds_router)          # G2-ESLEME: the monitor→bed editor (spec §4.1)
```

- [ ] **Step 7: The route tables.** **Edit** `homunculus-engine/tests/test_route_permissions.py` (1) — replace `    "homunculus.tenant.router",\n}` with:

```python
    "homunculus.tenant.router",
    "homunculus.devicebeds.router",
}
```

**Edit** (2) — replace:

```python
    ("DELETE", "/admin/ldap/group-mappings/{mapping_id}"): ANY(_U),
}
```

with:

```python
    ("DELETE", "/admin/ldap/group-mappings/{mapping_id}"): ANY(_U),
    # devicebeds/router.py — the monitor→bed editor (G2-ESLEME, spec §4.1)
    ("GET", "/infinity-shadow/device-beds"): ANY("devices.manage", "devices.map_beds"),
}
```

**Edit** (3) — replace `    assert len(EXPECTED) == 59` with `    assert len(EXPECTED) == 60`.

**Edit** `homunculus-engine/tests/test_nginx_routes.py` — replace `    "/infinity-shadow/board", "/infinity-shadow/readings", "/patients", "/ack",` with `    "/infinity-shadow/board", "/infinity-shadow/readings", "/infinity-shadow/device-beds", "/patients", "/ack",`.

- [ ] **Step 8: Green.**

```bash
cd /c/tmp/g2b-esleme-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_device_beds_api.py tests/test_route_permissions.py tests/test_route_inventory.py tests/test_nginx_routes.py tests/test_device_beds_wiring.py 2>&1 | tail -2
```

Expected: all passed — 9 in the new file (1 + 1 + 1 + 2 + 1 + 2 + 1). `test_route_inventory.py` passes unchanged (a JWT route). `test_nginx_routes.py` passes with no nginx change (`location ~ ^/(…|infinity-shadow|…)`, `deploy/local/web/nginx.conf:143`).

- [ ] **Step 9: Commit.**

```bash
cd /c/tmp/g2b-esleme-be
P="homunculus-engine/tests/esleme_world.py homunculus-engine/src/homunculus/devicebeds/listing.py homunculus-engine/src/homunculus/devicebeds/router.py homunculus-engine/tests/test_device_beds_api.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_route_permissions.py homunculus-engine/tests/test_nginx_routes.py"
git add -- $P && git status --short && git diff --cached --stat
git commit -F - -- $P <<'EOF'
feat(devicebeds): GET /infinity-shadow/device-beds — the worker's monitors and the beds they sit at

The union of the store's devices and the tenant's current rows, by address (spec §4.2): live status
and last seen, identity from the worker else the row, row_id for `expected`, the bed named only in
the caller's scope, editable for devices.map_beds holders. monitor_lane_off unless the strip runs for
this hospital (D15). Route tables 59 → 60. Lane A reviews the app.py include.

red: 9 failed — no such route (404)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```


---

#### Task 8, Step 1 (continued): `homunculus-engine/tests/esleme_world.py`

The route tests' world (Tasks 8–12). It reuses B1a's ward (`tests/kabul_world.py`: one tenant, «Reanimasiya» with beds 1, 2, 10 in «Otaq 1» and 3 in «Otaq 2», «Neonatal» with N1; staff with unit grants; signed-in tokens) and adds what the editor needs: a biomedical user, the lane on for the ward's hospital, the database source behind the strip, devices in the strip's store and rows in `device_beds`. Synthetic everything; `192.0.2.x` addresses.

**Write** `homunculus-engine/tests/esleme_world.py`:

```python
# homunculus-engine/tests/esleme_world.py
"""The monitor→bed editor's route-test world: kabul_world's ward + a biomedical user, the strip on
(stage `shadow` or `rules`) for the ward's hospital with PostgresDeviceBeds behind it, the worker's
devices in the store, and seeded `device_beds` rows. Synthetic everything.

    beds   1, 2, 10 (Otaq 1) and 3 (Otaq 2) in Reanimasiya — the charge nurse's unit
           N1 (N-1) in Neonatal — not hers
    users  admin (hospital_admin), charge (charge_nurse: devices.map_beds, board.view),
           nurse (no key), bio (biomedical: devices.manage only)
"""
from __future__ import annotations

import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from homunculus.api.app import create_app
from homunculus.api.audit import InMemoryAuditLog
from homunculus.api.device_beds_postgres import PostgresDeviceBeds
from homunculus.api.infinity_shadow import SCHEMA, ShadowSettings
from homunculus.auth.groups import ensure_default_groups
from homunculus.db import get_db
from homunculus.devicebeds.models import DeviceBed
from tests.conftest import TEST_DATABASE_URL
from tests.kabul_world import DEVICE, SLUG, Ward, build_ward
from tests.signed_in import add_user, bearer

TOKEN = "e" * 40
SOURCES = ("192.0.2.11", "192.0.2.12", "192.0.2.13")
UNIT_OF = {"1": "rea", "2": "rea", "10": "rea", "3": "rea", "N1": "neo"}
FROM = datetime(2026, 10, 19, tzinfo=timezone.utc)
APPROVED = datetime(2026, 10, 27, tzinfo=timezone.utc)
URL = "/infinity-shadow/device-beds"


def group_of(source: str) -> str:
    return "224.0.2." + source.rsplit(".", 1)[1]


def readings(sources, now: float) -> dict:
    """A forwarder body reporting `sources` streaming, with no readings (the editor needs presence)."""
    return {"schema": SCHEMA, "sent_at": now,
            "forwarder": {"interval_s": 5, "sent": 1, "failed": 0, "decoder": None},
            "hub": {"collector_age_s": 1.0, "accepted_packets": 1, "old_or_duplicate_packets": 0},
            "devices": [{"source": s, "group": group_of(s), "port": 2050, "status": "streaming",
                         "packet_age_ms": 100.0, "readings": []} for s in sources]}


async def seed(db: AsyncSession, ward: Ward, *rows: tuple[str, str | None, str | None]) -> dict[str, int]:
    """Current rows `(source, bed key or None, label or None)`, as the import would leave them."""
    ids = {}
    for source, bed_key, label in rows:
        bed = ward.beds[bed_key] if bed_key else None
        row = DeviceBed(tenant_id=ward.tenant.id, source=source, group_address=group_of(source), port=2050,
                        device_bed_label=label, bed_label=label, bed_id=bed.id if bed else None,
                        unit_id=ward.units[UNIT_OF[bed_key]].id if bed else None,
                        method="central_station_list" if label else None,
                        verified_at="2026-09-22" if label else None,
                        note=None if label else "atanmamış", valid_from=FROM,
                        approved_by="proje sahibi", approved_at=APPROVED)
        db.add(row)
        await db.flush()
        ids[source] = row.id
    await db.commit()
    return ids


@asynccontextmanager
async def esleme_client(db: AsyncSession, *, stage: str = "shadow", hospital: str = SLUG,
                        sources=SOURCES) -> AsyncIterator[tuple[AsyncClient, object, Ward]]:
    ward = await build_ward(db)
    groups = await ensure_default_groups(db, ward.tenant.id)
    bio = await add_user(db, username="bio@kabul.example.com", tenant_id=ward.tenant.id, group=groups["biomedical"])
    await db.commit()
    ward.users["bio"], ward.auth["bio"] = bio, await bearer(db, bio)
    settings = (ShadowSettings() if stage == "off" else
                ShadowSettings(stage, stage, None, TOKEN, hospital, parameters=("hr",) if stage == "rules" else ()))
    app = create_app({DEVICE: SLUG}, run_escalation_loop=False, shadow=settings, audit=InMemoryAuditLog(),
                     device_beds=PostgresDeviceBeds(TEST_DATABASE_URL, hospital=SLUG))
    maker = async_sessionmaker(db.bind, expire_on_commit=False)

    async def _db():
        async with maker() as session:
            yield session

    app.dependency_overrides[get_db] = _db
    if settings.on:
        app.state.shadow_store.ingest(readings(sources, time.time()))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client, app, ward
```

Notes:
- `bearer(db, user)` mints a token from the user's groups at that moment: `charge` carries `devices.map_beds` because Task 1 put it in `DEFAULT_GROUPS`, which `build_ward`'s `ensure_default_groups` used.
- The app's audit is in memory (`app.state.audit.records(...)` in the tests): the device routes write through `trail.record`, which reads `request.app.state.audit`.
- The strip's clock is the real one (E5): rows written at the database's `t` are valid at `time.time()`.


---

### Task 9: Bind and unbind — move, replace, `changed: false`, the refusals, the audit

**Lane:** backend (`/c/tmp/g2b-esleme-be`). **Needs:** Task 8.

Spec D3, D8, D10, D11, D13, D21, §4.3, §4.4 (all steps but 8), §4.5, §4.7. Occupancy (step 8) is Task 10. This task's files: the request models, three row helpers, the service (in `task-09-service.md`, this task's Step 4), the two routes, the tests (in `task-09-tests.md`, this task's Step 1).

**Files:**
- Create: `homunculus-engine/src/homunculus/devicebeds/schemas.py`
- Create: `homunculus-engine/src/homunculus/devicebeds/service.py` (code in `task-09-service.md`)
- Modify: `homunculus-engine/src/homunculus/devicebeds/rows.py`
- Modify: `homunculus-engine/src/homunculus/devicebeds/router.py`
- Modify: `homunculus-engine/tests/test_device_beds_api.py` (the tests in `task-09-tests.md`)
- Modify: `homunculus-engine/tests/test_route_permissions.py`

- [ ] **Step 1: Write the failing tests** — append to `homunculus-engine/tests/test_device_beds_api.py` the block of `task-09-tests.md`.

- [ ] **Step 2: Red.**

```bash
cd /c/tmp/g2b-esleme-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_device_beds_api.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed)" | tail -3
```

Expected: Task 8's nine pass; every new test fails on `405 Method Not Allowed` / `404` (no `bind`/`unbind` route).

- [ ] **Step 3: Request models and row helpers.** **Write** `homunculus-engine/src/homunculus/devicebeds/schemas.py`:

```python
# homunculus-engine/src/homunculus/devicebeds/schemas.py
"""The bind and unbind bodies (spec §4.3). Closed (`extra="forbid"`, as admission/schemas.py): a
misspelt key is FastAPI's 422, not a value dropped. Both `expected` keys are required; null is an
explicit value ("the screen saw none"). A well-formed wrong value is `field_invalid:<field>`."""
from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict


class _Closed(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BindExpected(_Closed):
    device_row_id: int | None
    bed_row_id: int | None


class UnbindExpected(_Closed):
    device_row_id: int | None


class BindBody(_Closed):
    source: str
    bed_id: uuid.UUID
    expected: BindExpected
    confirm_occupied: bool = False


class UnbindBody(_Closed):
    source: str
    expected: UnbindExpected
    confirm_occupied: bool = False
```

**Edit** `homunculus-engine/src/homunculus/devicebeds/rows.py` (1) — replace:

```python
from datetime import datetime, timezone
from typing import Any

from homunculus.api.infinity_device_beds import Row
```

with:

```python
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.api.infinity_device_beds import Row
from homunculus.devicebeds.models import DeviceBed
```

**Edit** `rows.py` (2) — append at the end of the file:

```python


async def db_time(db: AsyncSession) -> datetime:
    """`t` (spec §4.4): the database's own clock, `clock_timestamp()`, in UTC. Read once, after the
    locks, so it is later than the `valid_from` of every row the change closes."""
    return (await db.execute(select(func.clock_timestamp()))).scalar_one().astimezone(timezone.utc)


def editor_row(tenant_id: uuid.UUID, source: str, group: str, port: int, device_bed_label: str | None,
               bed_label: str | None, bed_id: uuid.UUID | None, unit_id: uuid.UUID | None,
               t: datetime, user) -> DeviceBed:
    """A row the editor (or Yapı's relabel) opens at `t` (spec §5.3, D21): `method` editor,
    `verified_at` = `t` in UTC ISO, `verified_by` = the user's id, approved by the user at `t`."""
    return DeviceBed(tenant_id=tenant_id, source=source, group_address=group, port=port,
                     device_bed_label=device_bed_label, bed_label=bed_label, bed_id=bed_id, unit_id=unit_id,
                     method="editor", verified_at=iso_utc(t), verified_by=user.id, note=None,
                     valid_from=t, valid_to=None, approved_by=user.username, approved_at=t)


def brief(row: DeviceBed | None) -> dict | None:
    """A row as an audit payload names it (spec §4.7): no patient, no free text."""
    if row is None:
        return None
    return {"row_id": row.id, "bed_id": None if row.bed_id is None else str(row.bed_id),
            "unit_id": None if row.unit_id is None else str(row.unit_id), "bed_label": row.bed_label}
```

(`rows.py` now imports `devicebeds.models`; `api/device_beds_postgres.py` imports `rows.to_row` — the accessor module therefore loads the model, which is only SQLAlchemy and `homunculus.db`: the lane module's isolation test, which imports `infinity_shadow` and `infinity_device_beds` only, is unaffected.)

- [ ] **Step 4: The service.** **Write** `homunculus-engine/src/homunculus/devicebeds/service.py` with the content of `task-09-service.md`.

- [ ] **Step 5: The routes.** **Edit** `homunculus-engine/src/homunculus/devicebeds/router.py` (1) — replace:

```python
from homunculus.devicebeds import listing
```

with:

```python
from homunculus.devicebeds import listing, service
from homunculus.devicebeds.schemas import BindBody, UnbindBody
```

**Edit** (2) — append at the end of the file:

```python


_MAP = require_permission("devices.map_beds")


@router.post("/bind", summary="Bind a monitor to a bed (a move or a replace included)")
async def bind(
    body: BindBody, request: Request, db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = Depends(caller_tenant_id), principal: Principal = Depends(get_principal),
    user: User = Depends(_MAP),
) -> dict:
    hospital = await lane_hospital(request, db, caller_tenant)
    return await service.change(request, db, caller_tenant, user, principal, hospital, service.Ask(
        body.source, body.bed_id, body.expected.device_row_id, body.expected.bed_row_id, body.confirm_occupied))


@router.post("/unbind", summary="Unbind a monitor: it stays in the list, on no bed")
async def unbind(
    body: UnbindBody, request: Request, db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = Depends(caller_tenant_id), principal: Principal = Depends(get_principal),
    user: User = Depends(_MAP),
) -> dict:
    hospital = await lane_hospital(request, db, caller_tenant)
    return await service.change(request, db, caller_tenant, user, principal, hospital, service.Ask(
        body.source, None, body.expected.device_row_id, None, body.confirm_occupied))
```

**Edit** `homunculus-engine/tests/test_route_permissions.py` — replace:

```python
    ("GET", "/infinity-shadow/device-beds"): ANY("devices.manage", "devices.map_beds"),
}
```

with:

```python
    ("GET", "/infinity-shadow/device-beds"): ANY("devices.manage", "devices.map_beds"),
    ("POST", "/infinity-shadow/device-beds/bind"): ANY("devices.map_beds"),
    ("POST", "/infinity-shadow/device-beds/unbind"): ANY("devices.map_beds"),
}
```

and `assert len(EXPECTED) == 60` → `assert len(EXPECTED) == 62`.

- [ ] **Step 6: Green.**

```bash
cd /c/tmp/g2b-esleme-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_device_beds_api.py tests/test_route_permissions.py tests/test_infinity_shadow_isolation.py tests/test_device_beds_postgres.py 2>&1 | tail -2
```

Expected: all passed. A deadlock or a `ck_device_beds_interval` violation here means `t` was read before the locks: move it back after step 6.

- [ ] **Step 7: Commit.**

```bash
cd /c/tmp/g2b-esleme-be
P="homunculus-engine/src/homunculus/devicebeds/schemas.py homunculus-engine/src/homunculus/devicebeds/service.py homunculus-engine/src/homunculus/devicebeds/rows.py homunculus-engine/src/homunculus/devicebeds/router.py homunculus-engine/tests/test_device_beds_api.py homunculus-engine/tests/test_route_permissions.py"
git add -- $P && git status --short && git diff --cached --stat
git commit -F - -- $P <<'EOF'
feat(devicebeds): bind and unbind — move, replace, changed:false, the refusals, the audit

POST /infinity-shadow/device-beds/bind and /unbind (spec §4.3–§4.5): the device from the worker or a
row, the bed from this tenant's structure and open, beds then rows locked in id order, changed:false
before `expected`, mapping_changed otherwise, unit scope on both beds, closes before inserts, editor
rows (method editor, verified_at the DB's t, verified_by the user), the strip's table invalidated,
device_bed.bind/unbind audited per device. Route tables 60 → 62.

red: <n> failed — 405/404, no bind or unbind route

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

(Replace `<n>` with the count the red run printed.)


---

#### Task 9, Step 1 (continued): the bind and unbind tests

Append to `homunculus-engine/tests/test_device_beds_api.py` (**Edit**: replace its import block with the one below, then add the tests at the end of the file).

Import block — replace:

```python
import pytest

from tests.conftest import requires_db
from tests.esleme_world import URL, esleme_client, seed
from tests.kabul_world import BOARD
```

with:

```python
import uuid
from datetime import datetime

import pytest
from sqlalchemy import select

from homunculus.devicebeds.models import DeviceBed
from tests.conftest import requires_db
from tests.esleme_world import URL, esleme_client, seed
from tests.kabul_world import BOARD
```

Tests — add at the end:

```python
async def _rows(db, source):
    return (await db.execute(select(DeviceBed).where(DeviceBed.source == source)
                             .order_by(DeviceBed.id).execution_options(populate_existing=True))).scalars().all()


def _bind(client, ward, who, source, bed_key, device_row=None, bed_row=None, **extra):
    return client.post(f"{URL}/bind", headers=ward.auth[who], json={
        "source": source, "bed_id": str(ward.beds[bed_key].id) if bed_key in ward.beds else bed_key,
        "expected": {"device_row_id": device_row, "bed_row_id": bed_row}, **extra})


def _unbind(client, ward, who, source, device_row, **extra):
    return client.post(f"{URL}/unbind", headers=ward.auth[who],
                       json={"source": source, "expected": {"device_row_id": device_row}, **extra})


async def test_a_new_monitor_is_bound_to_an_empty_bed_as_an_editor_row(db_session):
    async with esleme_client(db_session) as (client, app, ward):
        response = await _bind(client, ward, "admin", "192.0.2.13", "2")
        assert response.status_code == 200, response.text
        body = response.json()
        [row] = await _rows(db_session, "192.0.2.13")
        audit = app.state.audit.records(event_type="device_bed.bind")
        board = (await client.get("/infinity-shadow/board", headers=BOARD)).json()
    assert body["changed"] is True and body["replaced_source"] is None
    assert (row.bed_id, row.bed_label, row.unit_id) == (ward.beds["2"].id, "2", ward.units["rea"].id)
    assert (row.method, row.verified_by, row.approved_by) == ("editor", ward.users["admin"].id, ward.users["admin"].username)
    assert datetime.fromisoformat(row.verified_at) == row.valid_from and row.verified_at.endswith("+00:00")
    [entry] = [d for d in body["list"]["devices"] if d["source"] == "192.0.2.13"]
    assert entry["row_id"] == row.id and entry["bed"]["label"] == "2"
    [rec] = audit
    assert (rec.subject, rec.patient_id, rec.payload["old"], rec.payload["new"]["row_id"]) == ("192.0.2.13", "", None, row.id)
    assert rec.payload["actor"] == ward.users["admin"].username
    assert [c["source"] for c in board["beds"] if c["bed_id"] == str(ward.beds["2"].id)] == ["192.0.2.13"]


async def test_a_bound_monitor_moves_closing_its_row_and_opening_one(db_session):
    async with esleme_client(db_session) as (client, app, ward):
        ids = await seed(db_session, ward, ("192.0.2.11", "1", "BED05"))
        assert (await _bind(client, ward, "admin", "192.0.2.11", "2", ids["192.0.2.11"])).status_code == 200
        old, new = await _rows(db_session, "192.0.2.11")
        [rec] = app.state.audit.records(event_type="device_bed.bind")
    assert old.valid_to == new.valid_from and new.valid_to is None
    assert (new.bed_id, new.bed_label, new.device_bed_label) == (ward.beds["2"].id, "2", "BED05")
    assert rec.payload["old"] == {"row_id": old.id, "bed_id": str(ward.beds["1"].id),
                                  "unit_id": str(ward.units["rea"].id), "bed_label": "BED05"}


async def test_a_bed_with_a_monitor_takes_the_new_one_and_the_old_one_is_unbound(db_session):
    async with esleme_client(db_session) as (client, app, ward):
        ids = await seed(db_session, ward, ("192.0.2.11", "1", "BED05"), ("192.0.2.12", "2", "BED06"))
        response = await _bind(client, ward, "admin", "192.0.2.11", "2", ids["192.0.2.11"], ids["192.0.2.12"])
        displaced = await _rows(db_session, "192.0.2.12")
        unbinds = app.state.audit.records(event_type="device_bed.unbind")
    assert response.json()["replaced_source"] == "192.0.2.12"
    assert [(r.bed_id, r.valid_to is None) for r in displaced] == [(ward.beds["2"].id, False), (None, True)]
    assert displaced[1].device_bed_label == "BED06" and displaced[1].bed_label is None
    [rec] = unbinds
    assert (rec.subject, rec.payload["reason"], rec.payload["by_source"]) == ("192.0.2.12", "replaced", "192.0.2.11")


@pytest.mark.parametrize("bed_key, label", [("1", "BED05"), (None, "BED01")])
async def test_an_unbind_writes_an_unbound_row_for_a_bound_and_a_label_only_monitor(db_session, bed_key, label):
    async with esleme_client(db_session) as (client, app, ward):
        ids = await seed(db_session, ward, ("192.0.2.11", bed_key, label))
        assert (await _unbind(client, ward, "admin", "192.0.2.11", ids["192.0.2.11"])).status_code == 200
        rows = await _rows(db_session, "192.0.2.11")
        [rec] = app.state.audit.records(event_type="device_bed.unbind")
    assert [(r.bed_label, r.valid_to is None) for r in rows] == [(label, False), (None, True)]
    assert rec.payload["reason"] == "unbound" and rec.payload["new"]["bed_label"] is None


async def test_asking_for_what_already_holds_changes_nothing_even_with_a_stale_expected(db_session):
    async with esleme_client(db_session) as (client, app, ward):
        await seed(db_session, ward, ("192.0.2.11", "1", "BED05"), ("192.0.2.12", None, None))
        again = await _bind(client, ward, "admin", "192.0.2.11", "1", 999, 999)
        unbound = await _unbind(client, ward, "admin", "192.0.2.12", 999)
        assert len(await _rows(db_session, "192.0.2.11")) == 1
    assert (again.json()["changed"], unbound.json()["changed"]) == (False, False)
    assert app.state.audit.records() == []


async def test_a_stale_expected_is_mapping_changed(db_session):
    async with esleme_client(db_session) as (client, _, ward):
        ids = await seed(db_session, ward, ("192.0.2.11", "1", "BED05"), ("192.0.2.12", "2", "BED06"))
        stale_device = await _bind(client, ward, "admin", "192.0.2.11", "2", None, ids["192.0.2.12"])
        stale_bed = await _bind(client, ward, "admin", "192.0.2.11", "2", ids["192.0.2.11"], None)
    for response in (stale_device, stale_bed):
        assert response.status_code == 409 and response.json()["detail"]["code"] == "mapping_changed"


async def test_the_refusals_carry_their_codes(db_session):
    async with esleme_client(db_session) as (client, _, ward):
        ward.beds["10"].is_active = False
        await db_session.commit()
        unknown = await _bind(client, ward, "admin", "192.0.2.99", "2")
        multicast = await _bind(client, ward, "admin", "224.0.2.13", "2")
        closed = await _bind(client, ward, "admin", "192.0.2.13", "10")
        missing = await _bind(client, ward, "admin", "192.0.2.13", str(uuid.uuid4()))
        extra = await _bind(client, ward, "admin", "192.0.2.13", "2", surplus=True)
    assert (unknown.status_code, unknown.json()["detail"]["code"]) == (404, "device_unknown")
    assert (multicast.status_code, multicast.json()["detail"]["code"]) == (422, "field_invalid:source")
    assert (closed.status_code, closed.json()["detail"]["code"]) == (409, "bed_closed")
    assert missing.status_code == 404 and extra.status_code == 422


async def test_a_charge_nurse_acts_only_in_her_units(db_session):
    async with esleme_client(db_session) as (client, _, ward):
        ids = await seed(db_session, ward, ("192.0.2.11", "N1", "BEDN1"))
        into_neo = await _bind(client, ward, "charge", "192.0.2.13", "N1")
        out_of_neo = await _bind(client, ward, "charge", "192.0.2.11", "2", ids["192.0.2.11"])
        unbind_neo = await _unbind(client, ward, "charge", "192.0.2.11", ids["192.0.2.11"])
        own = await _bind(client, ward, "charge", "192.0.2.13", "2")
    for response in (into_neo, out_of_neo, unbind_neo):
        assert response.status_code == 403 and response.json()["detail"]["code"] == "out_of_scope"
    assert own.status_code == 200


@pytest.mark.parametrize("who", ["nurse", "bio"])
async def test_without_the_key_nobody_writes(db_session, who):
    async with esleme_client(db_session) as (client, _, ward):
        assert (await _bind(client, ward, who, "192.0.2.13", "2")).status_code == 403
        assert (await _unbind(client, ward, who, "192.0.2.13", None)).status_code == 403


async def test_the_writes_answer_monitor_lane_off_for_another_hospital(db_session):
    async with esleme_client(db_session, hospital="baska-hastane") as (client, _, ward):
        response = await _bind(client, ward, "admin", "192.0.2.13", "2")
    assert response.status_code == 409 and response.json()["detail"]["code"] == "monitor_lane_off"
```

(A bed of another tenant answering the same 404 as a missing one is in `tests/test_tenant_isolation.py`, Task 10.)


---

#### Task 9, Step 4 (continued): `homunculus-engine/src/homunculus/devicebeds/service.py`

The transaction of spec §4.4, steps 2–13. Task 10 adds step 8 (occupancy) at the marked place; nothing else of this file changes after this task.

**Write** `homunculus-engine/src/homunculus/devicebeds/service.py`:

```python
# homunculus-engine/src/homunculus/devicebeds/service.py
"""Bind, move, replace and unbind (spec §4.4) — one transaction on the request's session.

Locks follow B1a's rules (A-26): the beds touched, FOR NO KEY UPDATE through `tenant.router._lock_bed`
(imported, so the rule is one — E3), in id order; then the current rows involved, FOR UPDATE, in id
order. A request asking for what already holds answers `changed: false` before `expected` is
compared (§4.3). `t` is the database's `clock_timestamp()`, read once after the locks (§4.4). All
closes are flushed before any insert, so the partial unique indexes never see two current rows; one
that fires anyway is `mapping_changed`. Audit rows after the commit, never raising (trail.record)."""
from __future__ import annotations

import uuid
from dataclasses import dataclass

from fastapi import Request
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission import trail, unitscope
from homunculus.admission.errors import (
    BED_CLOSED, DEVICE_UNKNOWN, MAPPING_CHANGED, Refusal, field_invalid,
)
from homunculus.api.infinity_device_beds import PORT, unicast_ipv4
from homunculus.auth.dependencies import Principal
from homunculus.auth.models import User
from homunculus.devicebeds import listing
from homunculus.devicebeds.models import DeviceBed
from homunculus.devicebeds.rows import brief, db_time, editor_row
from homunculus.tenant import scope
from homunculus.tenant.models import Bed, Room, Unit
from homunculus.tenant.router import _lock_bed

_CHANGED = Refusal(409, MAPPING_CHANGED, "The mapping changed meanwhile; read it again.")


@dataclass(frozen=True)
class Ask:
    source: str
    bed_id: uuid.UUID | None            # None: unbind
    expected_device: int | None
    expected_bed: int | None            # bind only
    confirm_occupied: bool


async def _place(db: AsyncSession, bed_id: uuid.UUID):
    """(label, bed open, room open, unit open, unit id) — read as columns, so a value committed
    after an earlier ORM load of the bed is seen (the session's identity map is not consulted)."""
    return (await db.execute(
        select(Bed.label, Bed.is_active, Room.is_active, Unit.is_active, Room.unit_id)
        .join(Room, Room.id == Bed.room_id).join(Unit, Unit.id == Room.unit_id)
        .where(Bed.id == bed_id))).one()


def _open(place) -> None:
    if not (place[1] and place[2] and place[3]):
        raise Refusal(409, BED_CLOSED, "This bed, its room or its unit is closed.").http()


async def change(request: Request, db: AsyncSession, tenant_id: uuid.UUID, user: User,
                 principal: Principal, hospital: str, ask: Ask) -> dict:
    state = request.app.state
    # 2. the device: a unicast IPv4 the worker reports or a row of this tenant holds (D8)
    if unicast_ipv4(ask.source) != ask.source:
        raise field_invalid("source", "Not a monitor's unicast IPv4 address.").http()
    view = state.shadow_store.devices(state.shadow_clock()).get(ask.source)
    device_row = (await db.execute(select(DeviceBed).where(
        DeviceBed.tenant_id == tenant_id, DeviceBed.source == ask.source,
        DeviceBed.valid_to.is_(None)))).scalar_one_or_none()          # 4. without a lock
    if view is None and device_row is None:
        raise Refusal(404, DEVICE_UNKNOWN, "This monitor is not one the worker reports.").http()
    # 3. the target bed: this tenant's (a missing or foreign bed is the same 404), and open
    if ask.bed_id is not None:
        scope.ensure_owned(await scope.tenant_of_bed(db, ask.bed_id), tenant_id, "Bed not found")
        _open(await _place(db, ask.bed_id))
    leaving = device_row.bed_id if device_row is not None else None
    # 5. the beds, in id order
    for bed in sorted({b for b in (ask.bed_id, leaving) if b is not None}):
        await _lock_bed(db, bed)
    # 6. the current rows involved, in id order, then what holds now
    wanted = [DeviceBed.source == ask.source]
    if ask.bed_id is not None:
        wanted.append(DeviceBed.bed_id == ask.bed_id)
    locked = (await db.execute(select(DeviceBed).where(
        DeviceBed.tenant_id == tenant_id, DeviceBed.valid_to.is_(None), or_(*wanted))
        .order_by(DeviceBed.id).with_for_update().execution_options(populate_existing=True))).scalars().all()
    mine = next((r for r in locked if r.source == ask.source), None)
    on_bed = next((r for r in locked if ask.bed_id is not None and r.bed_id == ask.bed_id), None)
    if (mine.bed_id if mine is not None else None) != leaving:
        raise _CHANGED.http()                                         # it moved between 4 and 6
    if ask.bed_id is not None:
        place = await _place(db, ask.bed_id)
        _open(place)                                                  # a close committed meanwhile
        if mine is not None and mine.bed_id == ask.bed_id:
            return await _answer(state, db, tenant_id, principal, changed=False)
    elif mine is None or mine.bed_label is None:
        return await _answer(state, db, tenant_id, principal, changed=False)
    if (mine.id if mine is not None else None) != ask.expected_device:
        raise _CHANGED.http()
    if ask.bed_id is not None and (on_bed.id if on_bed is not None else None) != ask.expected_bed:
        raise _CHANGED.http()
    # 7. unit scope: the target bed and the bed the device leaves
    caller = await unitscope.caller_scope(db, principal.user.id, tenant_id)
    if ask.bed_id is not None:
        try:
            unitscope.require_reach(caller, unit_id=place[4], bed_id=ask.bed_id)
        except Refusal as refusal:
            raise refusal.http() from None
    if leaving is not None:
        try:
            unitscope.require_reach(caller, unit_id=mine.unit_id, bed_id=leaving)
        except Refusal as refusal:
            raise refusal.http() from None
    # 8. occupancy — Task 10
    occupied: list[dict] = []
    # 9. t, then every close, then every insert
    t = await db_time(db)
    group = view.group if view is not None else mine.group_address
    label = mine.device_bed_label if mine is not None else None
    displaced = on_bed if on_bed is not None and on_bed.source != ask.source else None
    for row in (mine, displaced):
        if row is not None:
            row.valid_to = t
    try:
        await db.flush()
        new_displaced = None
        if displaced is not None:
            new_displaced = editor_row(tenant_id, displaced.source, displaced.group_address, PORT,
                                       displaced.device_bed_label, None, None, None, t, user)
            db.add(new_displaced)
        new = editor_row(tenant_id, ask.source, group, PORT, label,
                         place[0] if ask.bed_id is not None else None, ask.bed_id,
                         place[4] if ask.bed_id is not None else None, t, user)
        db.add(new)
        await db.flush()
        await db.commit()                                             # 10
    except IntegrityError:
        await db.rollback()
        raise _CHANGED.http() from None
    state.shadow_table_reset()                                        # 11
    # 12. one audit row per device's change (B1a A-4)
    common = {"occupied_confirmed": bool(occupied), "occupied": occupied, "actor": user.username}
    kind = "device_bed.bind" if ask.bed_id is not None else "device_bed.unbind"
    payload = {"source": ask.source, "group": group, "device_bed_label": label,
               "old": brief(mine), "new": brief(new),
               "replaced_source": displaced.source if displaced is not None else None, **common}
    if ask.bed_id is None:
        payload["reason"] = "unbound"
    trail.record(request, hospital, kind, patient_id=_patient_of(occupied, ask.bed_id, leaving),
                 subject=ask.source, payload=payload)
    if displaced is not None:
        trail.record(request, hospital, "device_bed.unbind",
                     patient_id=_patient_of(occupied, ask.bed_id, None), subject=displaced.source,
                     payload={"source": displaced.source, "group": displaced.group_address,
                              "device_bed_label": displaced.device_bed_label, "old": brief(displaced),
                              "new": brief(new_displaced), "reason": "replaced", "by_source": ask.source,
                              "replaced_source": None, **common})
    return await _answer(state, db, tenant_id, principal, changed=True,
                         replaced=displaced.source if displaced is not None else None)   # 13


def _patient_of(occupied: list[dict], first: uuid.UUID | None, second: uuid.UUID | None) -> str:
    """The audit row's `patient_id` (spec §4.7, O5): the confirmed occupied bed's patient — `first`
    (the target bed) before `second` (the bed left) — or ""."""
    for bed in (first, second):
        for hit in occupied:
            if bed is not None and hit["bed_id"] == str(bed) and hit.get("patient_id"):
                return hit["patient_id"]
    return ""


async def _answer(state, db, tenant_id, principal, *, changed: bool, replaced: str | None = None) -> dict:
    return {"changed": changed, "replaced_source": replaced,
            "list": await listing.build(state, db, tenant_id, principal)}
```

Notes for the implementer:
- `populate_existing=True` on the locking select makes the ORM objects carry the values read under the lock, not the ones step 4 loaded.
- `place` is read again under the bed lock (step 6) and that read is what names the new row's `bed_label` and `unit_id` — never the request body.
- `listing.build` after the commit reads the same session, which sees the committed rows.


---

### Task 10: An admitted patient on the bed — `bed_occupied`, `confirm_occupied`, the patient id; tenant isolation

**Lane:** backend (`/c/tmp/g2b-esleme-be`). **Needs:** Task 9.

Spec D4, §4.4 step 8, §4.7 (O5), §6 "tenant isolation". A bed is occupied when an open admission holds it (read under the bed lock) or the board puts an admitted patient on it (`app.state.bed_occupants`, the strip's rule read fresh — HIS-fed records included). If the target bed or the bed the monitor leaves is occupied and `confirm_occupied` is not true: 409 `bed_occupied` with `occupied: [{bed_id, patient_id?}]`, the target first, `patient_id` only to a `board.view` holder. With it: the change goes through and its audit rows carry the patient id; no name anywhere.

The open-admission read here returns the admission's patient number, with exactly `_holds_open_admission`'s condition (`tenant/router.py:612-616`: `Admission.bed_id`, `OPEN_ADMISSION_STATES`) — E3's "imported, not copied" holds for `_lock_bed`; this read needs the number, which that helper does not return (E9).

Tenant isolation lives in this task's test file, not in `tests/test_tenant_isolation.py`: that file's world runs the lane off, where every device route answers `monitor_lane_off` before any id is read. Its route walk (`every route of the app resolves the caller's tenant`) covers the three routes unchanged, through `caller_tenant_id` (E10).

**Files:**
- Modify: `homunculus-engine/src/homunculus/devicebeds/service.py`
- Modify: `homunculus-engine/tests/esleme_world.py`
- Create: `homunculus-engine/tests/test_device_beds_occupied.py`

- [ ] **Step 1: Let the world take an identity store.** **Edit** `homunculus-engine/tests/esleme_world.py` (1) — replace:

```python
async def esleme_client(db: AsyncSession, *, stage: str = "shadow", hospital: str = SLUG,
                        sources=SOURCES) -> AsyncIterator[tuple[AsyncClient, object, Ward]]:
```

with:

```python
async def esleme_client(db: AsyncSession, *, stage: str = "shadow", hospital: str = SLUG,
                        sources=SOURCES, identities=None) -> AsyncIterator[tuple[AsyncClient, object, Ward]]:
```

**Edit** (2) — replace `device_beds=PostgresDeviceBeds(TEST_DATABASE_URL, hospital=SLUG))` with:

```python
                     device_beds=PostgresDeviceBeds(TEST_DATABASE_URL, hospital=SLUG),
                     **({"identities": identities} if identities is not None else {}))
```

- [ ] **Step 2: Write the failing test.** **Write** `homunculus-engine/tests/test_device_beds_occupied.py`:

```python
# homunculus-engine/tests/test_device_beds_occupied.py
"""A bed with an admitted patient (spec D4, §4.4 step 8, O5) and tenant isolation of the device
routes. Synthetic patients («Ahmet Yılmaz», H2600042); their names must appear in no answer and no
audit row."""
from __future__ import annotations

import json
from datetime import datetime, timezone

from homunculus.admission.models import Admission, Patient
from homunculus.api.patient_identity import IdentityRecord, InMemoryIdentityStore
from homunculus.auth.groups import ensure_default_groups
from homunculus.auth.models import Group, GroupPermission
from tests.conftest import requires_db
from tests.esleme_v2 import tenant_only
from tests.esleme_world import URL, esleme_client, seed
from tests.kabul_world import SLUG
from tests.signed_in import add_user, bearer

pytestmark = [requires_db]
NOW = datetime(2026, 10, 30, 9, 0, tzinfo=timezone.utc)


async def _admit(db, ward, bed_key, number="H2600042"):
    patient = Patient(tenant_id=ward.tenant.id, display_name="Ahmet Yılmaz", date_of_birth="1970-01-01",
                      sex="male", patient_number=number)
    db.add(patient)
    await db.flush()
    unit = ward.units["neo" if bed_key == "N1" else "rea"]
    db.add(Admission(tenant_id=ward.tenant.id, patient_id=patient.id, admitting_unit_id=unit.id,
                     bed_id=ward.beds[bed_key].id, admission_datetime=NOW,
                     admission_diagnosis_free_text="Sentetik tanı"))
    await db.commit()


def _bind(client, ward, who, source, bed_key, device_row=None, bed_row=None, confirm=False):
    return client.post(f"{URL}/bind", headers=ward.auth[who], json={
        "source": source, "bed_id": str(ward.beds[bed_key].id), "confirm_occupied": confirm,
        "expected": {"device_row_id": device_row, "bed_row_id": bed_row}})


async def test_binding_to_an_admitted_patients_bed_asks_first_then_audits_the_patient(db_session):
    async with esleme_client(db_session) as (client, app, ward):
        await _admit(db_session, ward, "2")
        refused = await _bind(client, ward, "admin", "192.0.2.13", "2")
        done = await _bind(client, ward, "admin", "192.0.2.13", "2", confirm=True)
        [rec] = app.state.audit.records(event_type="device_bed.bind")
    assert refused.status_code == 409
    detail = refused.json()["detail"]
    assert detail["code"] == "bed_occupied"
    assert detail["occupied"] == [{"bed_id": str(ward.beds["2"].id), "patient_id": "H2600042"}]
    assert done.status_code == 200
    assert (rec.patient_id, rec.payload["occupied_confirmed"]) == ("H2600042", True)
    assert "Ahmet" not in json.dumps([refused.json(), done.json(), rec.payload], ensure_ascii=False)


async def test_a_patient_the_board_puts_on_the_bed_counts_too_when_unbinding(db_session):
    identities = InMemoryIdentityStore()
    async with esleme_client(db_session, identities=identities) as (client, app, ward):
        ids = await seed(db_session, ward, ("192.0.2.11", "1", "BED05"))
        identities.apply(SLUG, IdentityRecord(patient_id="H2600043", given="Ahmet", family="Yılmaz",
                                              source="test", updated_at=NOW, bed_id=str(ward.beds["1"].id)))
        body = {"source": "192.0.2.11", "expected": {"device_row_id": ids["192.0.2.11"]}}
        refused = await client.post(f"{URL}/unbind", headers=ward.auth["admin"], json=body)
        done = await client.post(f"{URL}/unbind", headers=ward.auth["admin"], json={**body, "confirm_occupied": True})
        [rec] = app.state.audit.records(event_type="device_bed.unbind")
    assert refused.json()["detail"]["occupied"] == [{"bed_id": str(ward.beds["1"].id), "patient_id": "H2600043"}]
    assert done.status_code == 200 and rec.patient_id == "H2600043"


async def test_a_move_lists_the_target_bed_first_then_the_bed_it_leaves(db_session):
    async with esleme_client(db_session) as (client, _, ward):
        ids = await seed(db_session, ward, ("192.0.2.11", "1", "BED05"))
        await _admit(db_session, ward, "1", "H2600044")
        await _admit(db_session, ward, "2", "H2600045")
        refused = await _bind(client, ward, "admin", "192.0.2.11", "2", ids["192.0.2.11"])
    assert [o["patient_id"] for o in refused.json()["detail"]["occupied"]] == ["H2600045", "H2600044"]


async def test_a_holder_without_board_view_learns_that_a_patient_is_there_not_who(db_session):
    async with esleme_client(db_session) as (client, _, ward):
        group = Group(tenant_id=ward.tenant.id, slug="esleme_only", name="Yalnız eşleme",
                      mfa_required=False, is_system=False)
        group.permissions = [GroupPermission(permission="devices.map_beds")]
        db_session.add(group)
        await db_session.flush()
        user = await add_user(db_session, username="map@kabul.example.com", tenant_id=ward.tenant.id, group=group)
        await db_session.commit()
        ward.auth["map"] = await bearer(db_session, user)
        await _admit(db_session, ward, "2")
        refused = await _bind(client, ward, "map", "192.0.2.13", "2")
    assert refused.json()["detail"]["occupied"] == [{"bed_id": str(ward.beds["2"].id)}]


async def test_another_tenants_bed_is_the_same_404_as_a_missing_one(db_session):
    async with esleme_client(db_session) as (client, _, ward):
        other, _beds = await _other_with_bed(db_session)
        foreign = await client.post(f"{URL}/bind", headers=ward.auth["admin"], json={
            "source": "192.0.2.13", "bed_id": str(_beds), "expected": {"device_row_id": None, "bed_row_id": None}})
        missing = await client.post(f"{URL}/bind", headers=ward.auth["admin"], json={
            "source": "192.0.2.13", "bed_id": "00000000-0000-4000-8000-000000000000",
            "expected": {"device_row_id": None, "bed_row_id": None}})
    assert foreign.status_code == missing.status_code == 404
    assert foreign.json() == missing.json()


async def test_another_tenants_administrator_gets_monitor_lane_off(db_session):
    async with esleme_client(db_session) as (client, _, _ward):
        other = await tenant_only(db_session, "baska-hastane")
        groups = await ensure_default_groups(db_session, other.id)
        admin = await add_user(db_session, username="admin@baska.example.com", tenant_id=other.id,
                               group=groups["hospital_admin"])
        await db_session.commit()
        response = await client.get(URL, headers=await bearer(db_session, admin))
    assert response.status_code == 409 and response.json()["detail"]["code"] == "monitor_lane_off"


async def _other_with_bed(db):
    from homunculus.tenant.models import Bed, Room, Site, Unit, UnitType
    other = await tenant_only(db, "ucuncu-hastane")
    site = Site(tenant_id=other.id, name="Bina")
    db.add(site)
    await db.flush()
    unit = Unit(site_id=site.id, name="YBÜ", unit_type=UnitType.ADULT_ICU)
    db.add(unit)
    await db.flush()
    room = Room(unit_id=unit.id, name="Oda 1")
    db.add(room)
    await db.flush()
    bed = Bed(room_id=room.id, label="1")
    db.add(bed)
    await db.commit()
    return other, bed.id
```

- [ ] **Step 3: Red.**

```bash
cd /c/tmp/g2b-esleme-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_device_beds_occupied.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed)" | tail -6
```

Expected: the four occupancy tests fail (`200 != 409` — nothing checks occupancy yet); the two isolation tests pass already (Tasks 8–9 built them; record it).

- [ ] **Step 4: Step 8 of the transaction.** **Edit** `homunculus-engine/src/homunculus/devicebeds/service.py` (1) — replace:

```python
from homunculus.admission.errors import (
    BED_CLOSED, DEVICE_UNKNOWN, MAPPING_CHANGED, Refusal, field_invalid,
)
```

with:

```python
from homunculus.admission.errors import (
    BED_CLOSED, BED_OCCUPIED, DEVICE_UNKNOWN, MAPPING_CHANGED, Refusal, field_invalid,
)
from homunculus.admission.models import OPEN_ADMISSION_STATES, Admission, Patient
from homunculus.scope.rules import normalise_id
```

**Edit** (2) — replace:

```python
    # 8. occupancy — Task 10
    occupied: list[dict] = []
```

with:

```python
    # 8. occupancy: an open admission on the bed (read under its lock), or the board's admitted
    #    patients there (the strip's rule, fresh). Target first. The patient id goes to the audit
    #    always, to the caller only with board.view (§4.4, O5); a name goes nowhere.
    on_board = state.bed_occupants(hospital)
    occupied: list[dict] = []
    for bed in (ask.bed_id, leaving):
        if bed is None:
            continue
        present = on_board.get(normalise_id(str(bed)), [])
        number = (await db.execute(select(Patient.patient_number).join(Admission, Admission.patient_id == Patient.id)
                                   .where(Admission.bed_id == bed,
                                          Admission.state.in_(list(OPEN_ADMISSION_STATES))).limit(1))).scalar_one_or_none()
        if present or number is not None:
            hit = {"bed_id": str(bed)}
            patient = present[0] if len(present) == 1 else number
            if patient:
                hit["patient_id"] = patient
            occupied.append(hit)
    if occupied and not ask.confirm_occupied:
        shown = [hit if "board.view" in principal.perms else {"bed_id": hit["bed_id"]} for hit in occupied]
        raise Refusal(409, BED_OCCUPIED, "An admitted patient is on this bed; confirm to go on.",
                      {"occupied": shown}).http()
```

- [ ] **Step 5: Green**, with Task 9's file beside it:

```bash
cd /c/tmp/g2b-esleme-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_device_beds_occupied.py tests/test_device_beds_api.py tests/test_tenant_isolation.py -k "occupied or device or bed or every_route" 2>&1 | tail -2
```

Expected: all passed. (`-k` keeps `test_tenant_isolation.py` to its route walk and bed tests: the whole file takes ≈ 11 min, B1a's O49.)

- [ ] **Step 6: Commit.**

```bash
cd /c/tmp/g2b-esleme-be
P="homunculus-engine/src/homunculus/devicebeds/service.py homunculus-engine/tests/esleme_world.py homunculus-engine/tests/test_device_beds_occupied.py"
git add -- $P && git status --short && git diff --cached --stat
git commit -F - -- $P <<'EOF'
feat(devicebeds): an admitted patient on the bed asks a second confirmation; the audit names the patient id

Step 8 of the transaction (spec §4.4, D4, O5): an open admission (under the bed lock) or the board's
admitted patients on the target bed or the bed left gives 409 bed_occupied with the beds, target
first, the patient id only to board.view; with confirm_occupied the change goes through and its
audit rows carry the patient id. No name anywhere. Tenant isolation of the device routes.

red: 4 failed — 200 != 409, nothing checked occupancy (the 2 isolation tests passed on Task 9's code)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```


---

### Task 11: Concurrency and downstream — races end in one winner and one `mapping_changed`; the strip and Aşama B follow

**Lane:** backend (`/c/tmp/g2b-esleme-be`). **Needs:** Task 10.

Spec D10, §4.4 steps 5, 6, 9, §4.8, §6 "concurrency" and "downstream", E5. No production code is expected to change: these tests prove what Tasks 9–10 built under two sessions at once. If one fails, the fix goes into `devicebeds/service.py` and is named in the commit body (a lock order, a missing `populate_existing`, an `IntegrityError` not mapped).

**Files:**
- Create: `homunculus-engine/tests/test_device_beds_concurrency.py`

- [ ] **Step 1: Write the test.** **Write** `homunculus-engine/tests/test_device_beds_concurrency.py`:

```python
# homunculus-engine/tests/test_device_beds_concurrency.py
"""Two editors at once (spec D10, §4.4) and what a change does downstream (§4.8). Each request runs
on its own session (the world's `get_db` override opens one per request), so two requests sent
together contend on the database as two nurses would. Synthetic ward and patients."""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone

from sqlalchemy import select

from homunculus.api.patient_identity import IdentityRecord, InMemoryIdentityStore
from homunculus.devicebeds.models import DeviceBed
from tests.conftest import requires_db
from tests.esleme_world import TOKEN, URL, esleme_client, readings, seed
from tests.kabul_world import BOARD, SLUG

pytestmark = [requires_db]
NOW = datetime(2026, 10, 30, 9, 0, tzinfo=timezone.utc)


def _bind(client, ward, source, bed_key, device_row, bed_row, confirm=False):
    return client.post(f"{URL}/bind", headers=ward.auth["admin"], json={
        "source": source, "bed_id": str(ward.beds[bed_key].id), "confirm_occupied": confirm,
        "expected": {"device_row_id": device_row, "bed_row_id": bed_row}})


async def _current(db):
    rows = (await db.execute(select(DeviceBed).where(DeviceBed.valid_to.is_(None))
                             .execution_options(populate_existing=True))).scalars().all()
    return {r.source: r.bed_id for r in rows}


async def test_two_crossed_moves_over_the_same_two_beds_queue_and_one_wins(db_session):
    async with esleme_client(db_session) as (client, _, ward):
        ids = await seed(db_session, ward, ("192.0.2.11", "1", "BED05"), ("192.0.2.12", "2", "BED06"))
        a, b = await asyncio.wait_for(asyncio.gather(
            _bind(client, ward, "192.0.2.11", "2", ids["192.0.2.11"], ids["192.0.2.12"]),
            _bind(client, ward, "192.0.2.12", "1", ids["192.0.2.12"], ids["192.0.2.11"])), timeout=60)
        current = await _current(db_session)
    assert sorted([a.status_code, b.status_code]) == [200, 409]          # no deadlock, no 500
    loser = a if a.status_code == 409 else b
    assert loser.json()["detail"]["code"] == "mapping_changed"
    beds = [bed for bed in current.values() if bed is not None]
    assert len(beds) == len(set(beds)) == 1                             # one monitor bound, never two on a bed


async def test_two_first_binds_of_a_new_monitor_end_in_one_row_and_one_mapping_changed(db_session):
    async with esleme_client(db_session) as (client, _, ward):
        a, b = await asyncio.wait_for(asyncio.gather(
            _bind(client, ward, "192.0.2.13", "1", None, None),
            _bind(client, ward, "192.0.2.13", "2", None, None)), timeout=60)
        rows = (await db_session.execute(select(DeviceBed).where(DeviceBed.source == "192.0.2.13"))).scalars().all()
    assert sorted([a.status_code, b.status_code]) == [200, 409]
    assert (a if a.status_code == 409 else b).json()["detail"]["code"] == "mapping_changed"
    assert len(rows) == 1                                               # the partial index decided


async def test_the_strip_shows_the_move_at_its_next_read(db_session):
    async with esleme_client(db_session) as (client, _, ward):
        ids = await seed(db_session, ward, ("192.0.2.11", "1", "BED05"))
        before = (await client.get("/infinity-shadow/board", headers=BOARD)).json()
        await _bind(client, ward, "192.0.2.11", "2", ids["192.0.2.11"], None)
        after = (await client.get("/infinity-shadow/board", headers=BOARD)).json()
    def bed_of(body):
        return {c["source"]: (c["bed_id"], c["bed_label"], c["method"]) for c in body["beds"]}
    assert bed_of(before)["192.0.2.11"] == (str(ward.beds["1"].id), "BED05", "central_station_list")
    assert bed_of(after)["192.0.2.11"] == (str(ward.beds["2"].id), "2", "editor")
    assert after["table"]["version"] > before["table"]["version"]
    assert after["table"]["sha256"] != before["table"]["sha256"]


async def test_at_stage_rules_the_next_readings_body_links_the_beds_patient(db_session):
    identities = InMemoryIdentityStore()
    async with esleme_client(db_session, stage="rules", sources=(), identities=identities) as (client, app, ward):
        identities.apply(SLUG, IdentityRecord(patient_id="H2600046", given="Ahmet", family="Yılmaz",
                                              source="test", updated_at=NOW, bed_id=str(ward.beds["2"].id)))
        auth = {"Authorization": f"Bearer {TOKEN}"}

        def body():
            now = time.time()
            sent = readings(["192.0.2.13"], now)
            sent["devices"][0]["readings"] = [{"parameter": "hr", "value": 72, "unit": "bpm", "valid": True,
                                               "captured_at": now - 0.4}]
            return sent

        assert (await client.post("/infinity-shadow/readings", json=body(), headers=auth)).status_code == 200
        assert "H2600046" not in app.state.shadow_lane.linked.get(SLUG, {})      # no monitor on bed 2 yet
        bound = await _bind(client, ward, "192.0.2.13", "2", None, None, confirm=True)
        assert bound.status_code == 200
        await asyncio.sleep(1.1)                                     # the forwarder's 1-s spacing (429 otherwise)
        assert (await client.post("/infinity-shadow/readings", json=body(), headers=auth)).status_code == 200
        assert "H2600046" in app.state.shadow_lane.linked.get(SLUG, {})          # Aşama B D5: the link starts
```

- [ ] **Step 2: Run it.**

```bash
cd /c/tmp/g2b-esleme-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_device_beds_concurrency.py 2>&1 | tail -3
```

Expected: `4 passed`. This task proves rather than builds, so a first green is the expected outcome; record it as "no red: proof of Tasks 9–10" in the commit body. If the first test times out, the two requests deadlocked: the beds must be locked in ascending id order before any row (`sorted({…})` in step 5) — fix that, see this test red then green, and say so. If the link test fails because `ShadowLane.linked` is keyed differently, read `api/infinity_rules.py` `sample()` (`linked = self.linked.setdefault(hospital, {})`, ≈ `:545`) and assert on what it holds; never change Lane A's file.

- [ ] **Step 3: Commit.**

```bash
cd /c/tmp/g2b-esleme-be
git add -- homunculus-engine/tests/test_device_beds_concurrency.py
git status --short && git diff --cached --stat
git commit -F - -- homunculus-engine/tests/test_device_beds_concurrency.py <<'EOF'
test(devicebeds): two editors at once, and the strip and Aşama B after a change

Crossed moves over the same two beds queue on the bed locks and end in one 200 and one
mapping_changed, never a deadlock or two monitors on a bed; two first binds of one monitor are
decided by the partial index. After a bind the strip shows the monitor on its new bed at the next
read (method editor, version and sha moved), and at stage rules the next readings body links the
bed's patient (Aşama B D5).

no red: a proof of Tasks 9–10 (4 passed at first run)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```


---

### Task 12: Yapı follows the mapping — relabel on rename, `bed_has_monitor` on close; the structure for `devices.map_beds`

**Lane:** backend (`/c/tmp/g2b-esleme-be`). **Needs:** Task 9.

Spec D18, §4.1 (the structure guard), §4.5, §4.7, §4.10, O3, O7. Both hooks run inside `patch_bed`'s transaction (`tenant/router.py:507-534`), after its unit and bed locks, whatever the lane's stage: the close refusal before anything is written; the relabel before the bed's own label is assigned, so the mapping rows flush without the bed's UPDATE and a label race stays `_commit_unless_taken`'s `bed_label_taken`. After the commit: `device_bed.relabel` audited beside `structure.rename`, and the strip's table invalidated. A room or unit closes only with every bed closed (`_has_open_bed`), so the bed hook covers them.

**Files:**
- Create: `homunculus-engine/src/homunculus/devicebeds/writes.py`
- Modify: `homunculus-engine/src/homunculus/tenant/router.py`
- Modify: `homunculus-engine/tests/test_route_permissions.py`
- Create: `homunculus-engine/tests/test_device_beds_structure.py`

- [ ] **Step 1: Write the failing test.** **Write** `homunculus-engine/tests/test_device_beds_structure.py`:

```python
# homunculus-engine/tests/test_device_beds_structure.py
"""Yapı and the mapping (spec D18, O3, O7): a rename of a bound bed relabels its current row in the
same transaction and the strip follows; a bed with a monitor is not closed (`bed_has_monitor`); the
structure opens to `devices.map_beds`. Synthetic ward."""
from __future__ import annotations

from sqlalchemy import func, select

from homunculus.auth.models import Group, GroupPermission
from homunculus.devicebeds.models import DeviceBed
from tests.conftest import requires_db
from tests.esleme_world import URL, esleme_client, seed
from tests.kabul_world import BOARD
from tests.signed_in import add_user, bearer

pytestmark = [requires_db]


def _patch(client, ward, bed_key, **body):
    return client.patch(f"/tenant/beds/{ward.beds[bed_key].id}", headers=ward.auth["admin"], json=body)


async def _rows(db, source=None):
    q = select(DeviceBed).order_by(DeviceBed.id).execution_options(populate_existing=True)
    return (await db.execute(q if source is None else q.where(DeviceBed.source == source))).scalars().all()


async def test_renaming_a_bound_bed_relabels_its_row_and_the_strip_follows(db_session):
    async with esleme_client(db_session) as (client, app, ward):
        await seed(db_session, ward, ("192.0.2.11", "1", "BED05"))
        response = await _patch(client, ward, "1", label="Yatak 1")
        old, new = await _rows(db_session, "192.0.2.11")
        board = (await client.get("/infinity-shadow/board", headers=BOARD)).json()
        [rec] = app.state.audit.records(event_type="device_bed.relabel")
        renames = app.state.audit.records(event_type="structure.rename")
    assert response.status_code == 200
    assert old.valid_to == new.valid_from and new.valid_to is None
    assert (new.bed_id, new.bed_label, new.device_bed_label, new.method) == (ward.beds["1"].id, "Yatak 1", "BED05", "editor")
    assert new.verified_by == ward.users["admin"].id
    assert rec.payload["old"] == {"row_id": old.id, "bed_label": "BED05"}
    assert rec.payload["new"] == {"row_id": new.id, "bed_label": "Yatak 1"} and rec.patient_id == ""
    assert len(renames) == 1
    assert [c["bed_label"] for c in board["beds"] if c["source"] == "192.0.2.11"] == ["Yatak 1"]


async def test_a_rename_writes_no_mapping_row_for_an_unbound_bed_or_an_unchanged_label(db_session):
    async with esleme_client(db_session) as (client, _, ward):
        await seed(db_session, ward, ("192.0.2.11", "1", "5"))
        assert (await _patch(client, ward, "2", label="Yatak 2")).status_code == 200    # no monitor
        assert (await _patch(client, ward, "1", label="5")).status_code == 200          # the row says "5"
        assert len(await _rows(db_session)) == 1


async def test_a_refused_rename_writes_no_mapping_row(db_session):
    async with esleme_client(db_session) as (client, _, ward):
        await seed(db_session, ward, ("192.0.2.11", "1", "BED05"))
        response = await _patch(client, ward, "1", label="2")                          # bed 2's label
        assert response.json()["detail"]["code"] == "bed_label_taken"
        assert len(await _rows(db_session)) == 1


async def test_a_bed_with_a_monitor_is_not_closed_until_the_monitor_is_unbound(db_session):
    async with esleme_client(db_session) as (client, _, ward):
        ids = await seed(db_session, ward, ("192.0.2.11", "1", "BED05"))
        refused = await _patch(client, ward, "1", is_active=False)
        await db_session.refresh(ward.beds["1"])
        still_open = ward.beds["1"].is_active
        await client.post(f"{URL}/unbind", headers=ward.auth["admin"],
                          json={"source": "192.0.2.11", "expected": {"device_row_id": ids["192.0.2.11"]}})
        closed = await _patch(client, ward, "1", is_active=False)
    assert refused.status_code == 409 and refused.json()["detail"]["code"] == "bed_has_monitor"
    assert still_open is True and closed.status_code == 200


async def test_the_structure_opens_to_a_holder_of_devices_map_beds(db_session):
    async with esleme_client(db_session) as (client, _, ward):
        group = Group(tenant_id=ward.tenant.id, slug="esleme_only", name="Yalnız eşleme",
                      mfa_required=False, is_system=False)
        group.permissions = [GroupPermission(permission="devices.map_beds")]
        db_session.add(group)
        await db_session.flush()
        user = await add_user(db_session, username="map@kabul.example.com", tenant_id=ward.tenant.id, group=group)
        await db_session.commit()
        response = await client.get("/tenant/structure", headers=await bearer(db_session, user))
    assert response.status_code == 200 and response.json()["sites"]
```

- [ ] **Step 2: Red.**

```bash
cd /c/tmp/g2b-esleme-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_device_beds_structure.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed)" | tail -6
```

Expected: the relabel test fails (`ValueError: not enough values to unpack` — one row), the close test (`200 != 409`), the structure test (`403`); the two "no row" tests pass already.

- [ ] **Step 3: The hooks.** **Write** `homunculus-engine/src/homunculus/devicebeds/writes.py`:

```python
# homunculus-engine/src/homunculus/devicebeds/writes.py
"""Yapı's two hooks into the mapping (spec D18, §4.10), called by `tenant/router.py` `patch_bed`
inside its transaction, after its unit and bed locks. The bed's current bound row is read FOR UPDATE.

* `refuse_close_if_bound` (O7): a bed with a monitor bound is not closed — 409 `bed_has_monitor`;
  the screen sends the user to «Monitörler» to unbind first.
* `relabel_bed` (O3): a rename that changes the label closes the bound row at the database's `t`
  and opens the same device on the same bed under the new label (`method` editor), so the strip
  follows renames. A label-only row (v2's BED01: a label, no bed) is no Yapı bed's, never touched."""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission.errors import BED_HAS_MONITOR, Refusal
from homunculus.devicebeds.models import DeviceBed
from homunculus.devicebeds.rows import db_time, editor_row


async def bound_row(db: AsyncSession, tenant_id: uuid.UUID, bed_id: uuid.UUID) -> DeviceBed | None:
    return (await db.execute(select(DeviceBed).where(
        DeviceBed.tenant_id == tenant_id, DeviceBed.bed_id == bed_id, DeviceBed.valid_to.is_(None))
        .with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()


async def refuse_close_if_bound(db: AsyncSession, tenant_id: uuid.UUID, bed_id: uuid.UUID) -> None:
    if await bound_row(db, tenant_id, bed_id) is not None:
        raise Refusal(409, BED_HAS_MONITOR,
                      "A monitor is bound to this bed; unbind it on the Monitors screen first.").http()


async def relabel_bed(db: AsyncSession, tenant_id: uuid.UUID, bed_id: uuid.UUID, label: str,
                      user) -> tuple[DeviceBed, DeviceBed] | None:
    """(closed row, new row), or None when no monitor is bound or its row already says `label`."""
    row = await bound_row(db, tenant_id, bed_id)
    if row is None or row.bed_label == label:
        return None
    t = await db_time(db)
    row.valid_to = t
    await db.flush()
    new = editor_row(tenant_id, row.source, row.group_address, row.port, row.device_bed_label,
                     label, row.bed_id, row.unit_id, t, user)
    db.add(new)
    await db.flush()
    return row, new
```

- [ ] **Step 4: `patch_bed` and the structure's guard.** **Edit** `homunculus-engine/src/homunculus/tenant/router.py` (1) — replace:

```python
from homunculus.db import get_db
from homunculus.tenant import scope
```

with:

```python
from homunculus.db import get_db
from homunculus.devicebeds import writes as device_beds   # G2-ESLEME: Yapı follows the mapping (D18)
from homunculus.tenant import scope
```

**Edit** (2) — replace:

```python
    _user: User = Depends(require_permission("admissions.view", "admissions.admit",
                                             "beds.release", "structure.manage", "users.manage")),
```

with:

```python
    _user: User = Depends(require_permission("admissions.view", "admissions.admit",
                                             "beds.release", "structure.manage", "users.manage",
                                             "devices.map_beds")),
```

**Edit** (3) — replace:

```python
    if bed.is_active and not is_active and bed.state not in _FREE_TO_CLOSE:
        raise Refusal(409, BED_IN_USE, f"A bed that is {bed.state.value} cannot be closed.").http()
    changes = _changes(old_name=bed.label, new_name=label, was_active=bed.is_active,
                       is_active=is_active)
    hospital = await trail.hospital_of(db, caller_tenant)
    bed.label, bed.is_active = label, is_active
    await _commit_unless_taken(db, _BED_LABEL_TAKEN)
    await db.refresh(bed)
    for event_type, change in changes:
        _audit(request, hospital, event_type, user, kind="bed", obj_id=bed.id, unit_id=unit_id,
               change=change)
    return BedResponse.model_validate(bed)
```

with:

```python
    if bed.is_active and not is_active and bed.state not in _FREE_TO_CLOSE:
        raise Refusal(409, BED_IN_USE, f"A bed that is {bed.state.value} cannot be closed.").http()
    if bed.is_active and not is_active:
        await device_beds.refuse_close_if_bound(db, caller_tenant, bed.id)          # G2-ESLEME (O7)
    changes = _changes(old_name=bed.label, new_name=label, was_active=bed.is_active,
                       is_active=is_active)
    hospital = await trail.hospital_of(db, caller_tenant)
    # G2-ESLEME (O3): the bound monitor's row follows the rename, in this transaction — before the
    # bed's own UPDATE is pending, so a label race still ends in `bed_label_taken` at the commit.
    relabelled = (await device_beds.relabel_bed(db, caller_tenant, bed.id, label, user)
                  if label != bed.label else None)
    bed.label, bed.is_active = label, is_active
    await _commit_unless_taken(db, _BED_LABEL_TAKEN)
    await db.refresh(bed)
    for event_type, change in changes:
        _audit(request, hospital, event_type, user, kind="bed", obj_id=bed.id, unit_id=unit_id,
               change=change)
    if relabelled is not None:
        closed, opened = relabelled
        trail.record(request, hospital, "device_bed.relabel", subject=closed.source, payload={
            "source": closed.source, "bed_id": str(bed.id), "unit_id": str(unit_id),
            "old": {"row_id": closed.id, "bed_label": closed.bed_label},
            "new": {"row_id": opened.id, "bed_label": opened.bed_label}, "actor": user.username})
        reset = getattr(request.app.state, "shadow_table_reset", None)
        if reset is not None:
            reset()
    return BedResponse.model_validate(bed)
```

**Edit** `homunculus-engine/tests/test_route_permissions.py` — replace:

```python
    ("GET", "/tenant/structure"): ANY("admissions.view", "admissions.admit", "beds.release", _S, _U),
```

with:

```python
    ("GET", "/tenant/structure"): ANY("admissions.view", "admissions.admit", "beds.release", _S, _U,
                                      "devices.map_beds"),
```

- [ ] **Step 5: Green**, with B1a's structure tests:

```bash
cd /c/tmp/g2b-esleme-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_device_beds_structure.py tests/test_structure_api.py tests/test_route_permissions.py 2>&1 | tail -2
```

Expected: all passed (5 new). A `test_structure_api.py` failure that counts audit rows of a rename means a relabel row was written for a bed without a monitor — it must not be.

- [ ] **Step 6: Commit.**

```bash
cd /c/tmp/g2b-esleme-be
P="homunculus-engine/src/homunculus/devicebeds/writes.py homunculus-engine/src/homunculus/tenant/router.py homunculus-engine/tests/test_route_permissions.py homunculus-engine/tests/test_device_beds_structure.py"
git add -- $P && git status --short && git diff --cached --stat
git commit -F - -- $P <<'EOF'
feat(tenant): Yapı follows the mapping — a rename relabels the bound monitor's row, a bed with a monitor is not closed

patch_bed (spec D18, O3, O7): a label change closes the bound row and opens the same device on the
same bed under the new label (method editor), in the rename's transaction, audited
device_bed.relabel, the strip's table invalidated; closing a bed with a monitor bound is 409
bed_has_monitor. GET /tenant/structure opens to devices.map_beds (the bed picker).

red: 3 failed — one row (no relabel), 200 != 409, 403 on the structure

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```


---

### Task 13: `deploy/infinity/esleme_ozet.py` — the blocks' read-only before/after summary

**Lane:** backend (`/c/tmp/g2b-esleme-be`). **Needs:** nothing (no database). **Lane A review hunk:** the whole new file `deploy/infinity/esleme_ozet.py` (a `deploy/infinity/*` file).

Spec §7.2 A and C, E7. Standard library only: it runs as `shadow_check.py` does, piped over ssh into the hub's `python3` (`python3 -`), reading `TENANT_TOKEN` from the clinical stack's `.env` without printing it, and asking `GET /infinity-shadow/board` on the host's own address. It prints one line, `ESLEME_OZET_<ETIKET> {…}`: the sorted `[source, bed_id, bed_label]` of every bed card, the sorted `[source, reason]` of every unassigned device, the number of `link: one` cards, `feed.devices.total`, and the table's status, version and the first 12 hex of its sha. Never a value, a patient id or the token. A second mode, `--karsilastir ONCE SONRA`, runs on the workstation over two saved lines and says which parts differ.

**Files:**
- Create: `homunculus-engine/tests/test_esleme_ozet.py`
- Create: `deploy/infinity/esleme_ozet.py`

- [ ] **Step 1: Write the failing test.** **Write** `homunculus-engine/tests/test_esleme_ozet.py`:

```python
# homunculus-engine/tests/test_esleme_ozet.py
"""deploy/infinity/esleme_ozet.py (spec §7.2): the summary of the strip the blocks print before and
after, and the comparison of two. Fixed synthetic boards; no network, no database."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "deploy" / "infinity" / "esleme_ozet.py"


def _load():
    spec = importlib.util.spec_from_file_location("esleme_ozet", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


BOARD = {
    "stage": "rules",
    "table": {"status": "ok", "version": 13, "sha256": "e470d3342025100ad3dce0e6e42606aa37051d18f4bcac8f02a5abfa3b3b79af"},
    "feed": {"devices": {"total": 3}},
    "beds": [{"source": "10.10.203.24", "bed_id": "ec5a3244-426b-4877-af3c-bb2bb829ce1f", "bed_label": "BED11",
              "link": "one", "patient_id": "H2600042", "parameters": [{"parameter": "hr", "value": 72}]},
             {"source": "10.10.203.23", "bed_id": "ccbcafd3-0e2c-4c20-8960-e260cf02f3af", "bed_label": "BED05",
              "link": "none", "patient_id": None, "parameters": []}],
    "unassigned": [{"source": "10.10.203.40", "reason": "not_in_table"}],
}


def test_the_summary_holds_beds_unassigned_links_and_the_table_and_no_patient_or_value():
    summary = _load().summary(BOARD)
    assert summary == {
        "beds": [["10.10.203.23", "ccbcafd3-0e2c-4c20-8960-e260cf02f3af", "BED05"],
                 ["10.10.203.24", "ec5a3244-426b-4877-af3c-bb2bb829ce1f", "BED11"]],
        "unassigned": [["10.10.203.40", "not_in_table"]], "link_one": 1, "devices_total": 3,
        "table": {"status": "ok", "version": 13, "sha12": "e470d3342025"}, "stage": "rules"}
    text = json.dumps(summary)
    assert "H2600042" not in text and "72" not in text.replace("e470d3342025", "")


def test_main_prints_one_labelled_line_and_never_the_token(tmp_path, capsys):
    env = tmp_path / ".env"
    env.write_text("TENANT_TOKEN='gizli-sentetik-token'\n", encoding="utf-8")
    seen = []

    def get(path, token):
        seen.append((path, token))
        return BOARD

    assert _load().main(["--etiket", "ONCE"], get=get, env_path=str(env)) == 0
    out = capsys.readouterr().out.strip()
    assert out.startswith("ESLEME_OZET_ONCE {") and "gizli" not in out
    assert seen == [("/infinity-shadow/board", "gizli-sentetik-token")]


def test_the_comparison_names_what_differs(tmp_path, capsys):
    module = _load()
    before = module.summary(BOARD)
    after = json.loads(json.dumps(before))
    after["beds"][0][2] = "bed05"
    once, sonra = tmp_path / "once.txt", tmp_path / "sonra.txt"
    once.write_text("ESLEME_OZET_ONCE " + json.dumps(before) + "\n", encoding="utf-8")
    sonra.write_text("ESLEME_OZET_SONRA " + json.dumps(after) + "\n", encoding="utf-8")
    assert module.main(["--karsilastir", str(once), str(once)]) == 0
    assert "AYNI" in capsys.readouterr().out
    assert module.main(["--karsilastir", str(once), str(sonra)]) == 1
    assert "FARKLI: beds" in capsys.readouterr().out
```

- [ ] **Step 2: Red.**

```bash
cd /c/tmp/g2b-esleme-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_esleme_ozet.py 2>&1 | tail -3
```

Expected: 3 failed — `FileNotFoundError` (no script).

- [ ] **Step 3: The script.** **Write** `deploy/infinity/esleme_ozet.py`:

```python
"""Read-only summary of the monitor strip, for the monitor→bed editor's deploy blocks (spec §7.2).

Run it as shadow_check.py runs, from a machine with the hub's SSH key, never copying it anywhere:

    git -C <worktree> show <commit>:deploy/infinity/esleme_ozet.py \
      | ssh -i ~/.ssh/homunculus_vm sysadmin@172.100.101.72 'python3 - --etiket ONCE' | tee ONCE.txt

It reads TENANT_TOKEN from the clinical stack's .env (never printing it), asks GET
/infinity-shadow/board on the host's own address, and prints ONE line:

    ESLEME_OZET_<ETIKET> {"beds": [[source, bed_id, bed_label], …], "unassigned": [[source, reason], …],
                          "link_one": n, "devices_total": n, "table": {"status", "version", "sha12"}, "stage"}

Addresses, bed ids, labels and counts only — never a value, a patient id or the token. On the
workstation, `--karsilastir ONCE.txt SONRA.txt` compares two saved lines: "AYNI" (exit 0) when the
beds, the unassigned devices and the link count agree, else "FARKLI: <parts>" (exit 1).

Python standard library only: it runs on the hub's system python3.
"""
from __future__ import annotations

import argparse
import json
import urllib.request

API = "http://172.100.101.72:8080"
ENV = "/opt/homunculus/deploy/local/.env"
COMPARED = ("beds", "unassigned", "link_one")


def _token(env_path):
    with open(env_path, encoding="utf-8") as handle:
        for line in handle:
            if line.startswith("TENANT_TOKEN="):
                return line.split("=", 1)[1].strip().strip("'\"")
    raise SystemExit("TENANT_TOKEN .env içinde yok")


def _http_get(path, token):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    request = urllib.request.Request(API + path, headers={"Authorization": "Bearer " + token})
    with opener.open(request, timeout=15) as response:
        return json.loads(response.read())


def summary(board):
    table = board.get("table") or {}
    beds = board.get("beds") or []
    return {
        "beds": sorted([c.get("source"), c.get("bed_id"), c.get("bed_label")] for c in beds),
        "unassigned": sorted([c.get("source"), c.get("reason")] for c in board.get("unassigned") or []),
        "link_one": sum(1 for c in beds if c.get("link") == "one"),
        "devices_total": ((board.get("feed") or {}).get("devices") or {}).get("total"),
        "table": {"status": table.get("status"), "version": table.get("version"),
                  "sha12": str(table.get("sha256") or "")[:12]},
        "stage": board.get("stage"),
    }


def _saved(path):
    with open(path, encoding="utf-8") as handle:
        return json.loads(handle.read().strip().split(" ", 1)[1])


def main(argv=None, *, get=_http_get, env_path=ENV):
    parser = argparse.ArgumentParser(description="Read-only summary of the monitor strip.")
    parser.add_argument("--etiket", default="OZET", help="ONCE, SONRA, … — the line's label")
    parser.add_argument("--karsilastir", nargs=2, metavar=("ONCE", "SONRA"))
    args = parser.parse_args(argv)
    if args.karsilastir:
        before, after = (_saved(path) for path in args.karsilastir)
        differ = [key for key in COMPARED if before.get(key) != after.get(key)]
        print("AYNI" if not differ else "FARKLI: " + ", ".join(differ))
        return 1 if differ else 0
    board = get("/infinity-shadow/board", _token(env_path))
    print(f"ESLEME_OZET_{args.etiket} {json.dumps(summary(board), ensure_ascii=False)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Green.** The same command: `3 passed`. Then `python -I deploy/infinity/esleme_ozet.py --help` from the repo root with `/c/tmp/f7-py312/venv/Scripts/python.exe` prints the usage (the script imports nothing of the project).

- [ ] **Step 5: Commit.**

```bash
cd /c/tmp/g2b-esleme-be
git add -- deploy/infinity/esleme_ozet.py homunculus-engine/tests/test_esleme_ozet.py
git status --short && git diff --cached --stat
git commit -F - -- deploy/infinity/esleme_ozet.py homunculus-engine/tests/test_esleme_ozet.py <<'EOF'
feat(deploy): esleme_ozet.py — the editor's read-only before/after summary of the strip

One line per reading (beds as source/bed_id/label, unassigned with reasons, the link:one count, the
devices, the table's status/version/sha12), standard library only, piped to the hub's python3 as
shadow_check is; --karsilastir compares two saved lines. No value, patient id or token. Lane A
reviews the file.

red: 3 failed — no deploy/infinity/esleme_ozet.py

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```


---

### Task 14: The backend lane's gate

**Lane:** backend (`/c/tmp/g2b-esleme-be`). **Needs:** Tasks 1–13. Nothing is committed unless a step finds a fault; a fix gets its own commit (`fix(devicebeds): …`, with its red).

- [ ] **Step 1: The lane is whole.**

```bash
cd /c/tmp/g2b-esleme-be
git log --oneline feat/g2b-monitor-esleme..HEAD | cat
git diff --stat feat/g2b-monitor-esleme..HEAD -- homunculus-engine deploy dashboard | tail -1
```

Expected: thirteen commits, one per Task 1–13 (plus any `fix(…)`), and only the files of the header's file map for Tasks 1–13 (`git diff --name-only …` to read them).

- [ ] **Step 2: The slice's files, with the database.**

```bash
cd /c/tmp/g2b-esleme-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_migration_0014_device_beds.py tests/test_infinity_device_beds_contract.py tests/test_device_beds_postgres.py tests/test_device_beds_import.py tests/test_device_beds_parity.py tests/test_device_beds_wiring.py tests/test_device_beds_api.py tests/test_device_beds_occupied.py tests/test_device_beds_concurrency.py tests/test_device_beds_structure.py tests/test_esleme_ozet.py tests/test_permissions.py tests/test_route_permissions.py tests/test_nginx_routes.py tests/test_audit_postgres.py 2>&1 | tail -2
```

Expected: all passed, nothing skipped but what skips without the database in `test_audit_postgres.py` (none with it). ≈ 90 DB-backed tests at ≈ 5 s each: about 8 minutes; if the call nears 10 minutes, split it in two at `test_device_beds_api.py`.

- [ ] **Step 3: The touched neighbours, with the database.** B1a's structure and isolation tests (`patch_bed`, the structure guard), Lane A's strip and rules tests (the wiring), in two calls:

```bash
cd /c/tmp/g2b-esleme-be/homunculus-engine
DB=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test
TEST_DATABASE_URL=$DB PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_structure_api.py tests/test_infinity_shadow_api.py tests/test_infinity_rules.py tests/test_infinity_device_beds.py tests/test_infinity_shadow_isolation.py tests/test_kabul_boardlink.py 2>&1 | tail -1
```

```bash
cd /c/tmp/g2b-esleme-be/homunculus-engine
DB=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test
TEST_DATABASE_URL=$DB PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_tenant_isolation.py -k "not by_id" 2>&1 | tail -1
```

Expected: all passed. (`test_tenant_isolation.py`'s other half, `-k by_id`, runs in Task 21.)

- [ ] **Step 4: The whole no-DB suite** (≈ 2½ min):

```bash
cd /c/tmp/g2b-esleme-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -1
```

Expected: no failure; passed = the lane's baseline + the slice's no-DB tests (Tasks 1, 3, 7, 13: 1 + 9 + 4 + 3 = 17), skipped = the baseline's + the slice's DB-backed tests. Write both numbers into Task 21's notes.

- [ ] **Step 5: Python 3.14**, the slice's no-DB files:

```bash
cd /c/tmp/g2b-esleme-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/g115-py314/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_infinity_device_beds_contract.py tests/test_device_beds_wiring.py tests/test_esleme_ozet.py tests/test_permissions.py 2>&1 | tail -1
```

Expected: all passed.

- [ ] **Step 6: Lane A's hunks, gathered for review.** One diff of the reviewed paths, for the controller to send to Lane A:

```bash
cd /c/tmp/g2b-esleme-be
git diff feat/g2b-monitor-esleme..HEAD -- homunculus-engine/alembic/versions/0014_device_beds.py homunculus-engine/src/homunculus/api/infinity_device_beds.py homunculus-engine/src/homunculus/api/device_beds_postgres.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/src/homunculus/api/prodserver.py deploy/infinity/esleme_ozet.py > /c/tmp/homunculus-plans/g2b-esleme/lane-a-review-backend.patch
git diff --stat feat/g2b-monitor-esleme..HEAD -- homunculus-engine/src/homunculus/api/infinity_shadow.py homunculus-engine/src/homunculus/edge
```

Expected: the patch file written (outside the repo); the second command prints nothing — `api/infinity_shadow.py` and `edge/*` are untouched. Report the patch's path to the controller; the lane is merged into the slice branch only after Lane A's word on it.


---

### Task 15: The words — the `esleme` namespace, `monitor.method.editor`, Yapı's additions

**Lane:** dashboard (`/c/tmp/g2b-esleme-fe`). **Needs:** nothing. **Lane A review hunk:** `dashboard/src/live/i18n/strings/monitor.js` — one key, `editor`, in each language's `method` object (four lines).

Spec §3, §3.6, §3.7, D17. TR is the source, AZ the default; AZ, RU and EN are the planner's and await a native reading (O62). No text is clinical advice. The editor's words get their own namespace (spec §3.6), so Lane A's `monitor.js` takes one key.

**Files:**
- Create: `dashboard/src/live/i18n/strings/esleme.js`
- Modify: `dashboard/src/live/i18n/catalog.js`, `dashboard/src/live/i18n/strings.test.js`
- Modify: `dashboard/src/live/i18n/strings/monitor.js`, `dashboard/src/live/i18n/strings/kabul.js`

- [ ] **Step 1: The red.** Register the namespace before it exists. **Edit** `dashboard/src/live/i18n/catalog.js` (1) — replace:

```js
// G2-B1a: Hasta Kabul (screens/kabul, the admin's Yapı tab, the unit names, the coded refusals).
import kabul from "./strings/kabul.js";
```

with:

```js
// G2-B1a: Hasta Kabul (screens/kabul, the admin's Yapı tab, the unit names, the coded refusals).
import kabul from "./strings/kabul.js";

// G2-ESLEME: the monitor→bed editor on «Monitörler» (screens/devices/MappingSection.jsx, MappingDialog.jsx).
import esleme from "./strings/esleme.js";
```

**Edit** (2) — replace `  kabul, // G2-B1a\n};` with:

```js
  kabul, // G2-B1a

  esleme, // G2-ESLEME
};
```

Run `npx vitest run src/live/i18n/strings.test.js` from `/c/tmp/g2b-esleme-fe/dashboard`: red, `Failed to resolve import "./strings/esleme.js"`.

- [ ] **Step 2: The namespace.** **Write** `dashboard/src/live/i18n/strings/esleme.js`:

```js
// G2-ESLEME — the monitor→bed editor on the rail screen «Monitörler» (spec 2026-10-28 §3): the list,
// the pick, the confirmations (the second one for a bed with an admitted patient) and the coded
// refusals (apiErrors.js `ADMISSION_CODE_KEYS`). A monitor is named by its address and its central
// station name, a bed by the structure ("label · room · unit"), a patient only as «Ahmet Y.».
//
// TR is the source; AZ is the default. AZ, RU and EN are the planner's and await a native reading
// (plan O62). Russian calls the engine "система".
export default {
  tr: {
    title: "Monitör–yatak eşleme",
    sub: "İşçinin gördüğü her monitör ve bağlı olduğu yatak. Yatak yalnız listeden seçilir; değişiklik onayla olur.",
    caption: "Monitörler ve yatakları",
    col: { monitor: "Monitör", station: "Merkezi istasyon adı", visibility: "Görünürlük", bed: "Yatak", actions: "İşlem" },
    seen: "görünüyor", unseenAt: "görünmüyor · son görülme {time}", unseenUnknown: "görünmüyor · son görülme bilinmiyor",
    unbound: "bağlı değil", otherUnit: "başka birimde",
    bind: "Yatağa bağla", rebind: "Başka yatağa bağla", unbind: "Bağlantıyı çöz",
    bindFor: "Yatağa bağla: {monitor}", rebindFor: "Başka yatağa bağla: {monitor}", unbindFor: "Bağlantıyı çöz: {monitor}",
    loading: "Eşleme listesi yükleniyor…", unreadable: "Eşleme listesi okunamadı; birazdan yeniden denenecek.",
    empty: "İşçi henüz bir monitör bildirmedi.",
    pick: { title: "Yatak seçin — {monitor}", legend: "Yataklar", closed: "kapalı", hasMonitor: "monitör: {monitor}",
      occupied: "dolu", next: "Devam", none: "Seçilebilecek açık yatak yok." },
    confirm: { title: "Onaylayın", bind: "{monitor} → {bed}", replace: "{other} bu yataktan ayrılacak.",
      leave: "Monitör şu yataktan ayrılacak: {bed}.", unbind: "{monitor} şu yataktan çözülecek: {bed}.", ok: "Onayla" },
    occupied: { title: "Bu yatakta yatan hasta var", named: "Yatakta: {name}.", unnamed: "Bu yatakta yatan bir hasta var.",
      flowTo: "Monitörün değerleri bu hastanın kartına akmaya başlayacak.",
      flowStop: "Monitörün değerleri bu hastanın kartına akmayı bırakacak.", ok: "Evet, devam et" },
    cancel: "Vazgeç",
    done: { bound: "{monitor} bağlandı: {bed}", unbound: "{monitor} bağlantısı çözüldü", same: "Değişiklik yok: zaten böyle." },
    err: { laneOff: "Monitör şeridi bu hastane için çalışmıyor; eşleme şu an değiştirilemez.",
      deviceUnknown: "Bu monitörü işçi bildirmiyor.", mappingChanged: "Bu arada değişti — liste yenilendi; yeniden bakın.",
      bedOccupied: "Bu yatakta yatan hasta var; ikinci onay gerekir." },
  },
  az: {
    title: "Monitor–çarpayı uyğunlaşdırması",
    sub: "İşçinin gördüyü hər monitor və bağlı olduğu çarpayı. Çarpayı yalnız siyahıdan seçilir; dəyişiklik təsdiqlə olur.",
    caption: "Monitorlar və çarpayıları",
    col: { monitor: "Monitor", station: "Mərkəzi stansiya adı", visibility: "Görünmə", bed: "Çarpayı", actions: "Əməliyyat" },
    seen: "görünür", unseenAt: "görünmür · son dəfə {time}", unseenUnknown: "görünmür · son dəfə bilinmir",
    unbound: "bağlı deyil", otherUnit: "başqa şöbədə",
    bind: "Çarpayıya bağla", rebind: "Başqa çarpayıya bağla", unbind: "Bağlantını aç",
    bindFor: "Çarpayıya bağla: {monitor}", rebindFor: "Başqa çarpayıya bağla: {monitor}", unbindFor: "Bağlantını aç: {monitor}",
    loading: "Uyğunlaşdırma siyahısı yüklənir…", unreadable: "Uyğunlaşdırma siyahısı oxunmadı; bir azdan yenidən cəhd ediləcək.",
    empty: "İşçi hələ monitor bildirməyib.",
    pick: { title: "Çarpayı seçin — {monitor}", legend: "Çarpayılar", closed: "bağlı", hasMonitor: "monitor: {monitor}",
      occupied: "dolu", next: "Davam", none: "Seçilə bilən açıq çarpayı yoxdur." },
    confirm: { title: "Təsdiqləyin", bind: "{monitor} → {bed}", replace: "{other} bu çarpayıdan ayrılacaq.",
      leave: "Monitor bu çarpayıdan ayrılacaq: {bed}.", unbind: "{monitor} bu çarpayıdan açılacaq: {bed}.", ok: "Təsdiqlə" },
    occupied: { title: "Bu çarpayıda xəstə yatır", named: "Çarpayıda: {name}.", unnamed: "Bu çarpayıda yatan xəstə var.",
      flowTo: "Monitorun dəyərləri bu xəstənin kartına axmağa başlayacaq.",
      flowStop: "Monitorun dəyərləri bu xəstənin kartına axmağı dayandıracaq.", ok: "Bəli, davam et" },
    cancel: "İmtina",
    done: { bound: "{monitor} çarpayıya bağlandı: {bed}", unbound: "{monitor} bağlantısı açıldı", same: "Dəyişiklik yoxdur: artıq belədir." },
    err: { laneOff: "Monitor zolağı bu xəstəxana üçün işləmir; uyğunlaşdırma indi dəyişdirilə bilməz.",
      deviceUnknown: "Bu monitoru işçi bildirmir.", mappingChanged: "Bu arada dəyişdi — siyahı yeniləndi; yenidən baxın.",
      bedOccupied: "Bu çarpayıda xəstə yatır; ikinci təsdiq lazımdır." },
  },
  ru: {
    title: "Привязка мониторов к койкам",
    sub: "Каждый монитор, который видит рабочий узел, и его койка. Койка выбирается только из списка; изменение — после подтверждения.",
    caption: "Мониторы и их койки",
    col: { monitor: "Монитор", station: "Имя на центральной станции", visibility: "Виден", bed: "Койка", actions: "Действие" },
    seen: "виден", unseenAt: "не виден · последний раз {time}", unseenUnknown: "не виден · последний раз неизвестно",
    unbound: "не привязан", otherUnit: "в другом отделении",
    bind: "Привязать к койке", rebind: "Привязать к другой койке", unbind: "Отвязать",
    bindFor: "Привязать к койке: {monitor}", rebindFor: "Привязать к другой койке: {monitor}", unbindFor: "Отвязать: {monitor}",
    loading: "Список привязок загружается…", unreadable: "Список привязок не прочитан; скоро будет новая попытка.",
    empty: "Рабочий узел ещё не сообщил ни одного монитора.",
    pick: { title: "Выберите койку — {monitor}", legend: "Койки", closed: "закрыта", hasMonitor: "монитор: {monitor}",
      occupied: "занята", next: "Далее", none: "Нет открытой койки для выбора." },
    confirm: { title: "Подтвердите", bind: "{monitor} → {bed}", replace: "{other} будет отвязан от этой койки.",
      leave: "Монитор уйдёт с койки: {bed}.", unbind: "{monitor} будет отвязан от койки: {bed}.", ok: "Подтвердить" },
    occupied: { title: "На этой койке госпитализированный пациент", named: "На койке: {name}.",
      unnamed: "На этой койке лежит пациент.", flowTo: "Значения монитора начнут поступать в карточку этого пациента.",
      flowStop: "Значения монитора перестанут поступать в карточку этого пациента.", ok: "Да, продолжить" },
    cancel: "Отмена",
    done: { bound: "{monitor} привязан: {bed}", unbound: "{monitor} отвязан", same: "Без изменений: уже так." },
    err: { laneOff: "Полоса мониторов не работает для этой больницы; привязку сейчас изменить нельзя.",
      deviceUnknown: "Рабочий узел не сообщает этот монитор.", mappingChanged: "Пока вы смотрели, всё изменилось — список обновлён; посмотрите снова.",
      bedOccupied: "На этой койке пациент; нужно второе подтверждение." },
  },
  en: {
    title: "Monitor–bed mapping",
    sub: "Every monitor the worker sees and the bed it is bound to. A bed is picked from the list only; a change takes a confirmation.",
    caption: "Monitors and their beds",
    col: { monitor: "Monitor", station: "Central station name", visibility: "Seen", bed: "Bed", actions: "Action" },
    seen: "seen", unseenAt: "not seen · last seen {time}", unseenUnknown: "not seen · last seen unknown",
    unbound: "not bound", otherUnit: "in another unit",
    bind: "Bind to a bed", rebind: "Bind to another bed", unbind: "Unbind",
    bindFor: "Bind to a bed: {monitor}", rebindFor: "Bind to another bed: {monitor}", unbindFor: "Unbind: {monitor}",
    loading: "Loading the mapping…", unreadable: "The mapping could not be read; trying again shortly.",
    empty: "The worker has not reported a monitor yet.",
    pick: { title: "Pick a bed — {monitor}", legend: "Beds", closed: "closed", hasMonitor: "monitor: {monitor}",
      occupied: "occupied", next: "Continue", none: "No open bed to pick." },
    confirm: { title: "Confirm", bind: "{monitor} → {bed}", replace: "{other} will be unbound from this bed.",
      leave: "The monitor leaves this bed: {bed}.", unbind: "{monitor} will be unbound from: {bed}.", ok: "Confirm" },
    occupied: { title: "An admitted patient is on this bed", named: "On the bed: {name}.",
      unnamed: "An admitted patient is on this bed.", flowTo: "The monitor's values will start flowing to this patient's card.",
      flowStop: "The monitor's values will stop flowing to this patient's card.", ok: "Yes, go on" },
    cancel: "Cancel",
    done: { bound: "{monitor} bound: {bed}", unbound: "{monitor} unbound", same: "No change: it is already so." },
    err: { laneOff: "The monitor strip is not running for this hospital; the mapping cannot be changed now.",
      deviceUnknown: "The worker does not report this monitor.", mappingChanged: "It changed meanwhile — the list was reloaded; look again.",
      bedOccupied: "An admitted patient is on this bed; a second confirmation is needed." },
  },
};
```

- [ ] **Step 3: The reviewed identities.** **Edit** `dashboard/src/live/i18n/strings.test.js` (1) — the NEUTRAL set's last block (the only place where this line is followed by a blank line and `]);`) — replace:

```js
  "kabul.blood.abPos", "kabul.blood.abNeg", "kabul.blood.oPos", "kabul.blood.oNeg",

]);
```

with:

```js
  "kabul.blood.abPos", "kabul.blood.abNeg", "kabul.blood.oPos", "kabul.blood.oNeg",

  // G2-ESLEME (esleme) · neutral — an arrow between two names the screen fills in
  "esleme.confirm.bind",

]);
```

**Edit** (2) — replace:

```js
  "kabul.placeholder.site", // Bina adı — bina and ad are Azerbaijani too (az newSite: "Yeni binanın adı")
```

with:

```js
  "kabul.placeholder.site", // Bina adı — bina and ad are Azerbaijani too (az newSite: "Yeni binanın adı")

  // G2-ESLEME (esleme) · az = tr
  "esleme.confirm.bind", //  "{monitor} → {bed}" — no word in it
  "esleme.pick.occupied", // dolu — the same word in Azerbaijani, as kabul.state.OCCUPIED
```

- [ ] **Step 4: `monitor.method.editor` and Yapı's words.** **Edit** `dashboard/src/live/i18n/strings/monitor.js`, one per language:

| replace | with |
|---|---|
| `both: "liste ve ekran" }` | `both: "liste ve ekran", editor: "ekrandan eşleme" }` |
| `both: "siyahı və ekran" }` | `both: "siyahı və ekran", editor: "ekrandan uyğunlaşdırma" }` |
| `both: "список и экран" }` | `both: "список и экран", editor: "привязка на экране" }` |
| `both: "list and screen" }` | `both: "list and screen", editor: "set on screen" }` |

**Edit** `dashboard/src/live/i18n/strings/kabul.js`, after each language's `isolation:` line (tr `:127`, az `:285`, ru `:438`, en `:590`), the room adder's labels and hint (spec §3.7 item 2), and after each `bedNotAvailable:` line inside `err` the new refusal (item 3):

| after the line beginning | add |
|---|---|
| tr `    isolation: "İzolasyon odası",` | `    roomNameLabel: "Oda adı", roomNumberLabel: "Oda numarası (isteğe bağlı, örn. 05)",`<br>`    roomHint: "Yatak, oda eklendikten sonra odanın altında «Yatak ekle» ile eklenir.",` |
| az `    isolation: "İzolyasiya otağı",` | `    roomNameLabel: "Otağın adı", roomNumberLabel: "Otağın nömrəsi (məcburi deyil, məs. 05)",`<br>`    roomHint: "Çarpayı otaq əlavə edildikdən sonra otağın altında «Çarpayı əlavə et» ilə əlavə olunur.",` |
| ru `    isolation: "Изолятор",` | `    roomNameLabel: "Название палаты", roomNumberLabel: "Номер палаты (необязательно, напр. 05)",`<br>`    roomHint: "Койку добавляют под палатой, когда палата уже есть, — «Добавить койку».",` |
| en `    isolation: "Isolation room",` | `    roomNameLabel: "Room name", roomNumberLabel: "Room number (optional, e.g. 05)",`<br>`    roomHint: "Beds are added under the room once it exists, with «Add bed».",` |
| tr `      bedNotAvailable: "Bu yatak artık boş değil;` | `      bedHasMonitor: "Bu yatağa bir monitör bağlı — önce «Monitörler» ekranında bağlantıyı çözün.",` |
| az `      bedNotAvailable: "Bu çarpayı artıq boş deyil;` | `      bedHasMonitor: "Bu çarpayıya monitor bağlıdır — əvvəlcə «Monitorlar» ekranında bağlantını açın.",` |
| ru `      bedNotAvailable: "Эта койка уже не свободна;` | `      bedHasMonitor: "К этой койке привязан монитор — сначала отвяжите его на экране «Мониторы».",` |
| en `      bedNotAvailable: "This bed is no longer free;` | `      bedHasMonitor: "A monitor is bound to this bed — unbind it first on the Monitors screen.",` |

(Each is an Edit whose old text is the whole line named, and whose new text is that line followed by the added line(s).)

- [ ] **Step 5: Green.**

```bash
cd /c/tmp/g2b-esleme-fe/dashboard
npx vitest run src/live/i18n/ 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
```

Expected: no `FAIL`. A failure "az X = tr …: review, then list it" names an identity this plan missed: review it, list it under the `G2-ESLEME` heading, say so in the commit body.

- [ ] **Step 6: Commit.**

```bash
cd /c/tmp/g2b-esleme-fe
P="dashboard/src/live/i18n/strings/esleme.js dashboard/src/live/i18n/catalog.js dashboard/src/live/i18n/strings.test.js dashboard/src/live/i18n/strings/monitor.js dashboard/src/live/i18n/strings/kabul.js"
git add -- $P && git status --short && git diff --cached --stat
git commit -F - -- $P <<'EOF'
feat(dashboard): the monitor→bed editor's words — the esleme namespace, monitor.method.editor, Yapı's additions

Four languages (tr source, az default; az/ru/en await a native reading): the list, the pick, the
confirmations, the occupied bed's step, the results and the coded refusals; the strip's method line
for an editor row (one key in Lane A's monitor.js); the room adder's labels and hint and
kabul.err.bedHasMonitor for Yapı.

red: Failed to resolve import "./strings/esleme.js"

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```


---

### Task 16: The API client and the five codes

**Lane:** dashboard (`/c/tmp/g2b-esleme-fe`). **Needs:** Task 15; **Task 7 on the slice branch** (`apiErrors.test.js` reads `admission/errors.py`: merge the slice branch into the lane first, `deps.md`).

Spec §3.5, §4.2, §4.3, §4.4 step 8, §4.5. Three calls (`deviceBeds`, `bindDeviceBed`, `unbindDeviceBed`); a `bed_occupied` refusal's `occupied` list carried onto the error as `err.occupied` (bed ids and, for a `board.view` holder, patient ids — nothing else of the detail); the five codes mapped by `ADMISSION_CODE_KEYS`. `bed_has_monitor` is Yapı's sentence (`kabul.err.bedHasMonitor`); the four device codes the editor's (`esleme.err.*`).

**Files:**
- Modify: `dashboard/src/backendApi.js`, `dashboard/src/backendApi.test.js`
- Modify: `dashboard/src/live/session/testTokens.testutil.js`
- Modify: `dashboard/src/live/apiErrors.js`, `dashboard/src/live/apiErrors.test.js`

- [ ] **Step 1: Write the failing tests.** **Edit** `dashboard/src/backendApi.test.js` — at the end of the file, after the closing `});` of the `G2-B1a` describe, add:

```js

// G2-ESLEME — the monitor→bed editor (homunculus-engine devicebeds/router.py)
describe("backendApi — the monitor→bed editor", () => {
  const signedIn = (fetchMock) => {
    store.set("homunculus-access-token", "acc-1");
    store.set("homunculus-refresh-token", "ref-1");
    return createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
  };
  const sent = (fetchMock, at = 0) => {
    const [url, init] = fetchMock.mock.calls[at];
    return { url, method: init.method ?? "GET", body: init.body === undefined ? undefined : JSON.parse(init.body) };
  };

  it("reads the list and binds and unbinds by their own routes, each body as given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    const api = signedIn(fetchMock);
    const bind = { source: "192.0.2.11", bed_id: "b-1", expected: { device_row_id: 3, bed_row_id: null }, confirm_occupied: false };
    const unbind = { source: "192.0.2.11", expected: { device_row_id: 4 }, confirm_occupied: true };
    await api.deviceBeds();
    await api.bindDeviceBed(bind);
    await api.unbindDeviceBed(unbind);
    expect(fetchMock.mock.calls.map((_, at) => [sent(fetchMock, at).method, sent(fetchMock, at).url])).toEqual([
      ["GET", "/infinity-shadow/device-beds"], ["POST", "/infinity-shadow/device-beds/bind"],
      ["POST", "/infinity-shadow/device-beds/unbind"],
    ]);
    expect([sent(fetchMock, 1).body, sent(fetchMock, 2).body]).toEqual([bind, unbind]);
  });

  it("a bed_occupied refusal carries the beds and patient ids, and nothing else of the detail", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ detail: {
      code: "bed_occupied", message: "An admitted patient is on this bed; confirm to go on.",
      occupied: [{ bed_id: "b-2", patient_id: "H2600042", display_name: "Ahmet Yılmaz" }, { bed_id: "b-1" }, { bed_id: 7 }],
    } }, { ok: false, status: 409 }));
    const err = await signedIn(fetchMock).bindDeviceBed({}).catch((e) => e);
    expect(err).toMatchObject({ status: 409, apiCode: "bed_occupied" });
    expect(err.occupied).toEqual([{ bed_id: "b-2", patient_id: "H2600042" }, { bed_id: "b-1" }]);
    expect(JSON.stringify(Object.entries(err))).not.toContain("Ahmet");
  });
});
```

**Edit** `dashboard/src/live/apiErrors.test.js` — replace:

```js
    expect(CODES).toHaveLength(16);
```

with:

```js
    // … and the monitor→bed editor's five (G2-ESLEME: monitor_lane_off, device_unknown, bed_occupied,
    // mapping_changed; bed_has_monitor for Yapı).
    expect(CODES).toHaveLength(21);
```

- [ ] **Step 2: Red.**

```bash
cd /c/tmp/g2b-esleme-fe/dashboard
npx vitest run src/backendApi.test.js src/live/apiErrors.test.js 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL " | head
```

Expected: `FAIL` — `api.deviceBeds is not a function`, `err.occupied` undefined; in `apiErrors.test.js` "the map holds every code errors.py raises" (five codes unmapped) and `it.each(CODES)` for each of the five.

- [ ] **Step 3: The client.** **Edit** `dashboard/src/backendApi.js` (1) — replace:

```js
    let apiCode;
    let patientNumber;
```

with:

```js
    let apiCode;
    let patientNumber;
    let occupied;
```

**Edit** (2) — replace:

```js
        if (typeof body.detail.patient_number === "string") patientNumber = body.detail.patient_number;
```

with:

```js
        if (typeof body.detail.patient_number === "string") patientNumber = body.detail.patient_number;
        // G2-ESLEME: `bed_occupied` names the occupied beds and, to a board.view holder, the patients'
        // board ids (devicebeds/service.py step 8). Only those two keys are kept — never a name.
        if (Array.isArray(body.detail.occupied)) {
          occupied = body.detail.occupied.filter((o) => typeof o?.bed_id === "string")
            .map((o) => (typeof o.patient_id === "string" ? { bed_id: o.bed_id, patient_id: o.patient_id } : { bed_id: o.bed_id }));
        }
```

**Edit** (3) — replace:

```js
    if (patientNumber !== undefined) err.patientNumber = patientNumber;
```

with:

```js
    if (patientNumber !== undefined) err.patientNumber = patientNumber;
    if (occupied !== undefined) err.occupied = occupied;
```

**Edit** (4) — replace:

```js
    patchBed(id, body) { return authed(`/tenant/beds/${seg(id)}`, { method: "PATCH", body }); },
```

with:

```js
    patchBed(id, body) { return authed(`/tenant/beds/${seg(id)}`, { method: "PATCH", body }); },

    // ---- G2-ESLEME: the monitor→bed editor (homunculus-engine devicebeds/router.py) ----
    // Refusals carry `err.apiCode` (`monitor_lane_off`, `device_unknown`, `bed_occupied` with
    // `err.occupied`, `mapping_changed`, `out_of_scope`, `bed_closed`).
    /** {stage, generated_at, can_bind, devices: [{source, group, port, device_bed_label, seen, status,
     *  last_seen_at, row_id, bed: null | {id, in_scope, label?, room?, unit?}, editable}]} */
    deviceBeds() { return authed("/infinity-shadow/device-beds"); },
    /** {source, bed_id, expected: {device_row_id, bed_row_id}, confirm_occupied} → {changed, replaced_source, list} */
    bindDeviceBed(body) { return authed("/infinity-shadow/device-beds/bind", { method: "POST", body }); },
    /** {source, expected: {device_row_id}, confirm_occupied} → {changed, replaced_source, list} */
    unbindDeviceBed(body) { return authed("/infinity-shadow/device-beds/unbind", { method: "POST", body }); },
```

**Edit** `dashboard/src/live/session/testTokens.testutil.js` — replace:

```js
    patchBed: vi.fn(),

```

with:

```js
    patchBed: vi.fn(),

    // G2-ESLEME: the monitor→bed editor
    deviceBeds: vi.fn(),
    bindDeviceBed: vi.fn(),
    unbindDeviceBed: vi.fn(),

```

- [ ] **Step 4: The codes.** **Edit** `dashboard/src/live/apiErrors.js` — replace:

```js
  ["duplicate_open_admission", "kabul.err.duplicateOpenAdmission"],
]);
```

with:

```js
  ["duplicate_open_admission", "kabul.err.duplicateOpenAdmission"],
  // G2-ESLEME — the monitor→bed editor (spec §4.5). `bed_occupied` opens the second confirmation
  // (MappingDialog.jsx); its sentence is said only where a screen shows the refusal itself.
  ["monitor_lane_off", "esleme.err.laneOff"],
  ["device_unknown", "esleme.err.deviceUnknown"],
  ["bed_occupied", "esleme.err.bedOccupied"],
  ["mapping_changed", "esleme.err.mappingChanged"],
  ["bed_has_monitor", "kabul.err.bedHasMonitor"],      // Yapı: unbind the monitor first, on «Monitörler»
]);
```

- [ ] **Step 5: Green**, and the whole suite and the build:

```bash
cd /c/tmp/g2b-esleme-fe/dashboard
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
```

Expected: no `FAIL`; `built in`, `precache  20 entries`.

- [ ] **Step 6: Commit.**

```bash
cd /c/tmp/g2b-esleme-fe
P="dashboard/src/backendApi.js dashboard/src/backendApi.test.js dashboard/src/live/session/testTokens.testutil.js dashboard/src/live/apiErrors.js dashboard/src/live/apiErrors.test.js"
git add -- $P && git status --short && git diff --cached --stat
git commit -F - -- $P <<'EOF'
feat(dashboard): the editor's API calls and its five codes

deviceBeds, bindDeviceBed, unbindDeviceBed; a bed_occupied refusal's beds and patient ids carried as
err.occupied (no name); monitor_lane_off, device_unknown, bed_occupied, mapping_changed and Yapı's
bed_has_monitor mapped by code in the four languages.

red: api.deviceBeds is not a function; five codes of errors.py unmapped (CODES 16 → 21)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```


---

### Task 17: `deviceMap.js`, the list section, and its place on «Monitörler»

**Lane:** dashboard (`/c/tmp/g2b-esleme-fe`). **Needs:** Task 16. **Lane A review hunk:** `dashboard/src/live/screens/devices/DevicesScreen.jsx` — two import lines, `useSession` in `DevicesScreen`, the section mounted above `{body}`, and the method line's `verified` value (`:34`); `DevicesScreen.test.jsx` — `open()`'s setup answers the list, and one new test. **O61:** Lane A to confirm `shortName`'s rule.

Spec D1, D9, §3.1, §3.2, §3.6 (the method line), E6. The section is shown to holders of `devices.map_beds` or `devices.manage`; the route opens to both; the structure (the bed picker's source, Task 18) to `devices.map_beds` too. `deviceMap.js` holds the pure rules the list and the dialog share. `MappingDialog.jsx` lands here as an empty component (reachability: every module is reachable the commit it lands), filled in Task 18.

**Files:**
- Create: `dashboard/src/live/screens/devices/deviceMap.js`, `deviceMap.test.js`
- Create: `dashboard/src/live/screens/devices/esleme.testutil.js`, `MappingSection.jsx`, `MappingSection.test.jsx` (code in `task-17-section.md`)
- Create: `dashboard/src/live/screens/devices/MappingDialog.jsx` (a stub)
- Modify: `dashboard/src/live/screens/devices/DevicesScreen.jsx`, `DevicesScreen.test.jsx`
- Modify: `dashboard/src/live/shell/routes.js`, `routes.test.js`; `dashboard/src/live/data/StructureProvider.jsx`

- [ ] **Step 1: The pure rules, test first.** **Write** `dashboard/src/live/screens/devices/deviceMap.test.js`:

```js
import { describe, it, expect } from "vitest";
import { bedText, canSeeMapping, monitorName, occupiedNames, shortName, verifiedText, visibility } from "./deviceMap.js";

const t = (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key);

describe("the editor's pure rules", () => {
  it("names a patient only by the first word and the last word's initial (O5)", () => {
    expect(shortName("Ahmet Yılmaz")).toBe("Ahmet Y.");
    expect(shortName("  Ayşe  Nur   Kaya ")).toBe("Ayşe K.");
    expect(shortName("Ahmet")).toBe("Ahmet");
    expect(shortName("ömer şahin")).toBe("ömer Ş.");
    expect([shortName(""), shortName(null), shortName("   ")]).toEqual([null, null, null]);
  });

  it("finds each occupied bed's patient on the session's own board, and never prints a number", () => {
    const patients = [{ patient_id: "H2600042", display_name: "Ahmet Yılmaz" }, { patient_id: "H2600043", display_name: null }];
    expect(occupiedNames([{ bed_id: "b1", patient_id: "H2600042" }, { bed_id: "b2", patient_id: "H2600043" },
      { bed_id: "b3" }, { bed_id: "b4", patient_id: "H2600099" }], patients))
      .toEqual([{ bedId: "b1", name: "Ahmet Y." }, { bedId: "b2", name: null }, { bedId: "b3", name: null }, { bedId: "b4", name: null }]);
  });

  it("names a monitor by its address and central station name", () => {
    expect(monitorName({ source: "10.10.203.37", device_bed_label: "BED08" })).toBe("10.10.203.37 (BED08)");
    expect(monitorName({ source: "10.10.203.40", device_bed_label: null })).toBe("10.10.203.40");
  });

  it("says where a monitor sits in the structure's words, or why it cannot", () => {
    expect(bedText(t, { bed: null })).toBe("esleme.unbound");
    expect(bedText(t, { bed: { id: "x", in_scope: false } })).toBe("esleme.otherUnit");
    expect(bedText(t, { bed: { id: "x", in_scope: true, label: "bed08", room: "Otaq 08", unit: "Reanimasiya" } }))
      .toBe("bed08 · Otaq 08 · Reanimasiya");
  });

  it("says whether a monitor is seen, and since when it is not", () => {
    expect(visibility({ seen: true })).toEqual({ key: "esleme.seen", vars: undefined });
    expect(visibility({ seen: false, last_seen_at: null })).toEqual({ key: "esleme.unseenUnknown", vars: undefined });
    const at = visibility({ seen: false, last_seen_at: "2026-10-30T09:02:00+00:00" });
    expect(at.key).toBe("esleme.unseenAt");
    expect(at.vars.time).toMatch(/^\d{2}:\d{2}$/);
  });

  it("prints a v2 date as written and an editor row's time in local time", () => {
    expect(verifiedText("2026-09-22")).toBe("2026-09-22");
    expect(verifiedText("2026-10-30T09:12:03.120000+00:00")).toMatch(/^2026-10-30 \d{2}:\d{2}$/);
    expect([verifiedText(null), verifiedText(undefined), verifiedText("bozuk")]).toEqual(["—", "—", "—"]);
  });

  it("shows the section to a holder of either key", () => {
    expect([canSeeMapping(["devices.map_beds"]), canSeeMapping(["devices.manage"]), canSeeMapping(["board.view"]), canSeeMapping(undefined)])
      .toEqual([true, true, false, false]);
  });
});
```

Run `npx vitest run src/live/screens/devices/deviceMap.test.js`: red, `Failed to resolve import "./deviceMap.js"`.

**Write** `dashboard/src/live/screens/devices/deviceMap.js`:

```js
// src/live/screens/devices/deviceMap.js — the monitor→bed editor's pure rules (spec 2026-10-28 §3):
// how a monitor, a bed and (in the occupied-bed step only) a patient are named. No patient number is
// ever printed; a patient is «Ahmet Y.» from the session's own board card, or nobody (O5).
const pad = (n) => String(n).padStart(2, "0");
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const MAPPING_PERMS = Object.freeze(["devices.map_beds", "devices.manage"]);
export const canSeeMapping = (perms) => MAPPING_PERMS.some((key) => Array.isArray(perms) && perms.includes(key));

/** «Ahmet Yılmaz» → «Ahmet Y.»: the first word and the initial of the last (O5; no such rule existed
 *  in the strip, plan E6). One word stays as it is; a blank name is null. */
export function shortName(displayName) {
  const words = String(displayName ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  if (words.length === 1) return words[0];
  return `${words[0]} ${words[words.length - 1][0].toLocaleUpperCase("tr")}.`;
}

/** Each occupied bed of a `bed_occupied` refusal (`err.occupied`) with the short name of its patient
 *  when the session's board holds that card; the board id itself goes no further. */
export function occupiedNames(occupied, patients) {
  const byId = new Map((patients ?? []).map((p) => [p.patient_id, p]));
  return (occupied ?? []).map((o) => ({ bedId: o.bed_id, name: shortName(byId.get(o.patient_id)?.display_name) }));
}

export const monitorName = (d) => (d.device_bed_label ? `${d.source} (${d.device_bed_label})` : d.source);

export function bedText(t, d) {
  if (!d.bed) return t("esleme.unbound");
  if (!d.bed.in_scope) return t("esleme.otherUnit");
  return `${d.bed.label} · ${d.bed.room} · ${d.bed.unit}`;
}

const clock = (ms) => { const at = new Date(ms); return `${pad(at.getHours())}:${pad(at.getMinutes())}`; };

export function visibility(d) {
  if (d.seen) return { key: "esleme.seen", vars: undefined };
  const ms = Date.parse(d.last_seen_at ?? "");
  return Number.isFinite(ms) ? { key: "esleme.unseenAt", vars: { time: clock(ms) } } : { key: "esleme.unseenUnknown", vars: undefined };
}

/** The strip's method line (DevicesScreen.jsx): v2's date as written, an editor row's UTC time (D21)
 *  as this browser's local «YYYY-AA-GG SS:DD», anything else «—». */
export function verifiedText(value) {
  if (typeof value !== "string") return "—";
  if (DATE_ONLY.test(value)) return value;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "—";
  const at = new Date(ms);
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${clock(ms)}`;
}
```

Green: `npx vitest run src/live/screens/devices/deviceMap.test.js` → 7 passed.

- [ ] **Step 2: The dialog's stub.** **Write** `dashboard/src/live/screens/devices/MappingDialog.jsx`:

```jsx
// src/live/screens/devices/MappingDialog.jsx — the pick, the confirmation and the occupied-bed step
// (spec §3.3, §3.4). Task 18 fills it; until then it renders nothing.
export function MappingDialog() {
  return null;
}
```

- [ ] **Step 3: The section** — **Write** the three files of `task-17-section.md` (`esleme.testutil.js`, `MappingSection.jsx`, `MappingSection.test.jsx`). Run `npx vitest run src/live/screens/devices/MappingSection.test.jsx`: 5 passed (the section is new code under its own test; its red was the missing module, record it).

- [ ] **Step 4: On the screen, the route, the structure.** **Edit** `dashboard/src/live/screens/devices/DevicesScreen.jsx` (1) — replace:

```js
import { maxAgeOf, reasonKey } from "../common/monitor.js";
```

with:

```js
import { maxAgeOf, reasonKey } from "../common/monitor.js";
// G2-ESLEME: the monitor→bed editor, above the strips (spec §3.1)
import { useSession } from "../../session/SessionProvider.jsx";
import { canSeeMapping, verifiedText } from "./deviceMap.js";
import { MappingSection } from "./MappingSection.jsx";
```

**Edit** (2) — replace `verified: card.verified_at ?? "—" })}` with `verified: verifiedText(card.verified_at) })}`.

**Edit** (3) — replace:

```js
export function DevicesScreen() {
  const { t } = useI18n();
  const shadow = useShadow();
```

with:

```js
export function DevicesScreen() {
  const { t } = useI18n();
  const { user } = useSession();
  const shadow = useShadow();
```

**Edit** (4) — replace:

```js
        <p className="m-0 text-13 text-mute">{t("monitor.devicesSub")}</p>
      </div>
      {body}
```

with:

```js
        <p className="m-0 text-13 text-mute">{t("monitor.devicesSub")}</p>
      </div>
      {canSeeMapping(user?.perms) ? <MappingSection /> : null}
      {body}
```

**Edit** `dashboard/src/live/screens/devices/DevicesScreen.test.jsx` (1) — in `open()`'s `setup`, before `if (answer instanceof Error)`, add the line `      api.deviceBeds.mockResolvedValue({ stage: "shadow", generated_at: "2026-10-30T09:00:00+00:00", can_bind: false, devices: [] });`. (2) — at the end of the outer `describe`, add:

```jsx
  it("shows the monitor–bed section to a charge nurse holding devices.map_beds", async () => {
    await open(WARD, ["devices.map_beds", "board.view"]);
    expect(screen.getByRole("heading", { name: "Monitor–çarpayı uyğunlaşdırması" })).toBeTruthy();
  });
```

**Edit** `dashboard/src/live/shell/routes.js` — replace:

```js
    perms: ["devices.manage"], work: true, nav: "main" }),
```

with:

```js
    perms: ["devices.manage", "devices.map_beds"], work: true, nav: "main" }),   // G2-ESLEME: + the editor's key
```

**Edit** `dashboard/src/live/shell/routes.test.js` — replace `perms: ["devices.manage"], work: true, nav: "main",` with `perms: ["devices.manage", "devices.map_beds"], work: true, nav: "main",`, and rename that `it(…)`'s title from "is a work screen for devices.manage alone, …" to "is a work screen for devices.manage or devices.map_beds, …".

**Edit** `dashboard/src/live/data/StructureProvider.jsx` — replace:

```js
export const STRUCTURE_PERMS = Object.freeze(["admissions.view", "admissions.admit", "beds.release", "structure.manage", "users.manage"]);
```

with:

```js
export const STRUCTURE_PERMS = Object.freeze(["admissions.view", "admissions.admit", "beds.release", "structure.manage", "users.manage",
  "devices.map_beds"]);   // G2-ESLEME: the monitor→bed editor's bed picker (spec §4.1)
```

- [ ] **Step 5: Green**, the whole suite and the build:

```bash
cd /c/tmp/g2b-esleme-fe/dashboard
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
```

Expected: no `FAIL` (`reachable.test.js` finds the four new modules through `DevicesScreen.jsx`); `built in`, `precache  20 entries`.

- [ ] **Step 6: Commit.**

```bash
cd /c/tmp/g2b-esleme-fe
D=dashboard/src/live
P="$D/screens/devices/deviceMap.js $D/screens/devices/deviceMap.test.js $D/screens/devices/esleme.testutil.js $D/screens/devices/MappingSection.jsx $D/screens/devices/MappingSection.test.jsx $D/screens/devices/MappingDialog.jsx $D/screens/devices/DevicesScreen.jsx $D/screens/devices/DevicesScreen.test.jsx $D/shell/routes.js $D/shell/routes.test.js $D/data/StructureProvider.jsx"
git add -- $P && git status --short && git diff --cached --stat
git commit -F - -- $P <<'EOF'
feat(dashboard): «Monitör–yatak eşleme» on the Monitörler screen — the list, and who may act

The section above the strips (spec §3.2): each monitor's address, central station name, visibility
(«görünmüyor · son görülme HH:MM»), its bed in the structure's words or «başka birimde», and the
actions for devices.map_beds holders, read every 5 s. The route and the structure open to the key;
the strip's method line prints an editor row's time locally. deviceMap.js holds the shared rules,
shortName («Ahmet Y.») among them. Lane A reviews the DevicesScreen hunk.

red: Failed to resolve import "./deviceMap.js"; MappingSection.jsx missing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```


---

#### Task 17, Steps 3–4 (continued): the list section, its test util and its tests

**Write** `dashboard/src/live/screens/devices/esleme.testutil.js`:

```js
// Test-only: synthetic monitors and list bodies for the monitor→bed editor (GET
// /infinity-shadow/device-beds, homunculus-engine devicebeds/listing.py), on kabul.testutil's ward.
import { BED, mountKabul } from "../kabul/kabul.testutil.js";

export const MAP = Object.freeze(["devices.map_beds", "board.view"]);   // a charge nurse's two that matter here
export const BIO = Object.freeze(["devices.manage"]);                    // biomedical: reads, binds nothing

export function device(source, over = {}) {
  return { source, group: `224.0.2.${source.split(".").pop()}`, port: 2050, device_bed_label: null,
    seen: true, status: "streaming", last_seen_at: "2026-10-30T09:12:01.400000+00:00", row_id: null,
    bed: null, editable: true, ...over };
}

export const onBed = (n, label, room = "Otaq 1", unit = "Reanimasiya") => ({ id: BED(n), in_scope: true, label, room, unit });

export function list(devices, over = {}) {
  return { stage: "shadow", generated_at: "2026-10-30T09:12:03.120000+00:00", can_bind: true, devices, ...over };
}

/** `ui` in the shell's providers (structure included), the list answering `body`. */
export function mountMapping(ui, { perms = MAP, body = list([]), setup } = {}) {
  return mountKabul(ui, { perms, setup: (api) => { api.deviceBeds.mockResolvedValue(body); setup?.(api); } });
}
```

**Write** `dashboard/src/live/screens/devices/MappingSection.jsx`:

```jsx
// src/live/screens/devices/MappingSection.jsx — «Monitör–yatak eşleme» on the Monitörler screen (spec
// 2026-10-28 §3.2): every monitor the worker reports or the table holds, its central station name,
// whether it is seen, its bed (named from the server's names, or «başka birimde»), and — for a
// holder of devices.map_beds on a monitor she may change — «Yatağa bağla» / «Bağlantıyı çöz».
// Read every POLL_MS while on screen and right after each change. No patient anywhere here.
import React, { useCallback, useEffect, useId, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { POLL_MS } from "../../data/shadowStore.js";
import { Announce, Button, Note, Table } from "../../ui/index.js";
import { bedText, monitorName, visibility } from "./deviceMap.js";
import { MappingDialog } from "./MappingDialog.jsx";

function Row({ device, onAct }) {
  const { t } = useI18n();
  const name = monitorName(device);
  const seen = visibility(device);
  const bound = Boolean(device.bed);
  return (
    <tr>
      <td className="font-data">{device.source} · {device.port}<span className="block text-12 text-mute">{device.group}</span></td>
      <td className="font-data">{device.device_bed_label ?? "—"}</td>
      <td>{t(seen.key, seen.vars)}</td>
      <td>{bedText(t, device)}</td>
      <td>
        {device.editable ? (
          <span className="flex flex-wrap gap-1.5">
            <Button size="sm" onClick={() => onAct("bind", device)}
              aria-label={t(bound ? "esleme.rebindFor" : "esleme.bindFor", { monitor: name })}>
              {t(bound ? "esleme.rebind" : "esleme.bind")}
            </Button>
            {bound || device.device_bed_label ? (
              <Button size="sm" onClick={() => onAct("unbind", device)} aria-label={t("esleme.unbindFor", { monitor: name })}>
                {t("esleme.unbind")}
              </Button>
            ) : null}
          </span>
        ) : null}
      </td>
    </tr>
  );
}

export function MappingSection() {
  const { t } = useI18n();
  const { store } = useSession();
  const headId = useId();
  const [state, setState] = useState({ phase: "loading", body: null });
  const [dialog, setDialog] = useState(null);       // {mode: "bind" | "unbind", device}
  const [said, setSaid] = useState("");

  const load = useCallback(async () => {
    try {
      const body = await store.api.deviceBeds();
      if (!body || !Array.isArray(body.devices)) throw new Error("not a list");
      setState({ phase: "ok", body });
    } catch (err) {
      setState((was) => ({ phase: err?.apiCode === "monitor_lane_off" ? "off" : "unreadable", body: was.body }));
    }
  }, [store]);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const { phase, body } = state;
  return (
    <section aria-labelledby={headId} className="flex flex-col gap-2">
      <div>
        <h2 id={headId} className="m-0 font-display text-17 font-bold">{t("esleme.title")}</h2>
        <p className="m-0 text-13 text-mute">{t("esleme.sub")}</p>
      </div>
      {phase === "loading" && !body ? <p className="m-0 text-13 text-mute">{t("esleme.loading")}</p> : null}
      {phase === "off" ? <Note tone="info">{t("esleme.err.laneOff")}</Note> : null}
      {phase === "unreadable" ? <Note>{t("esleme.unreadable")}</Note> : null}
      {body && phase !== "off" ? (
        body.devices.length === 0 ? <p className="m-0 text-13 text-mute">{t("esleme.empty")}</p> : (
          <Table caption={t("esleme.caption")}>
            <thead>
              <tr>
                {["monitor", "station", "visibility", "bed", "actions"].map((col) => (
                  <th key={col} scope="col">{t(`esleme.col.${col}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.devices.map((d) => <Row key={d.source} device={d} onAct={(mode, device) => setDialog({ mode, device })} />)}
            </tbody>
          </Table>
        )
      ) : null}
      <Announce text={said} />
      {dialog ? (
        <MappingDialog mode={dialog.mode} device={dialog.device} devices={body?.devices ?? []}
          onClose={() => setDialog(null)}
          onDone={(text, fresh) => {
            setDialog(null);
            setSaid(text);
            if (fresh && Array.isArray(fresh.devices)) setState({ phase: "ok", body: fresh });
            else load();
          }} />
      ) : null}
    </section>
  );
}
```

(Task 17 lands the section with a `MappingDialog.jsx` that renders nothing — see Task 17 Step 3; Task 18 fills it.)

**Write** `dashboard/src/live/screens/devices/MappingSection.test.jsx`:

```jsx
// «Monitör–yatak eşleme» (spec §3.2): columns, absent devices, another unit's bed, who may act, the
// lane off, the poll, and no UUID on screen. Synthetic monitors; the screen speaks az (the default).
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, screen, within } from "@testing-library/react";
import { expectNoUuid } from "../kabul/kabul.testutil.js";
import { BIO, device, list, mountMapping, onBed } from "./esleme.testutil.js";
import { MappingSection } from "./MappingSection.jsx";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); localStorage.clear(); });

const pad = (n) => String(n).padStart(2, "0");
const local = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

const WARD = list([
  device("192.0.2.11", { device_bed_label: "BED05", row_id: 1, bed: onBed(1, "1") }),
  device("192.0.2.12", { device_bed_label: "BED01", row_id: 2 }),
  device("192.0.2.13"),
  device("192.0.2.14", { device_bed_label: "BEDN1", row_id: 4, editable: false, bed: { id: "x", in_scope: false } }),
  device("192.0.2.20", { device_bed_label: "BED07", row_id: 5, seen: false, status: null,
    last_seen_at: "2026-10-30T09:02:00+00:00", bed: onBed(5, "5", "Otaq 2") }),
  device("192.0.2.21", { row_id: 6, seen: false, status: null, last_seen_at: null }),
]);

const rowOf = (source) => screen.getByText(new RegExp(`^${source.replace(/\./g, "\\.")}`)).closest("tr");

describe("the monitor–bed list", () => {
  it("shows each monitor's address, station name, visibility and bed, in the server's order", async () => {
    await mountMapping(<MappingSection />, { body: WARD });
    const table = screen.getByRole("table", { name: "Monitorlar və çarpayıları" });
    expect(within(table).getAllByRole("row")).toHaveLength(7);
    expect(within(rowOf("192.0.2.11")).getByText("1 · Otaq 1 · Reanimasiya")).toBeTruthy();
    expect(within(rowOf("192.0.2.12")).getByText("bağlı deyil")).toBeTruthy();
    expect(within(rowOf("192.0.2.14")).getByText("başqa şöbədə")).toBeTruthy();
    expect(within(rowOf("192.0.2.20")).getByText(`görünmür · son dəfə ${local("2026-10-30T09:02:00+00:00")}`)).toBeTruthy();
    expect(within(rowOf("192.0.2.21")).getByText("görünmür · son dəfə bilinmir")).toBeTruthy();
    expectNoUuid();
  });

  it("offers the actions only on a monitor the session may change, named after it", async () => {
    await mountMapping(<MappingSection />, { body: WARD });
    expect(within(rowOf("192.0.2.11")).getByRole("button", { name: "Başqa çarpayıya bağla: 192.0.2.11 (BED05)" })).toBeTruthy();
    expect(within(rowOf("192.0.2.11")).getByRole("button", { name: "Bağlantını aç: 192.0.2.11 (BED05)" })).toBeTruthy();
    expect(within(rowOf("192.0.2.13")).getByRole("button", { name: "Çarpayıya bağla: 192.0.2.13" })).toBeTruthy();
    expect(within(rowOf("192.0.2.13")).queryByRole("button", { name: /Bağlantını aç/ })).toBeNull();
    expect(within(rowOf("192.0.2.14")).queryByRole("button")).toBeNull();
  });

  it("offers nothing to biomedical, who reads the list", async () => {
    const body = list(WARD.devices.map((d) => ({ ...d, editable: false })), { can_bind: false });
    await mountMapping(<MappingSection />, { perms: BIO, body });
    expect(screen.queryAllByRole("button", { name: /bağla|aç/ })).toHaveLength(0);
  });

  it("says the strip is off rather than showing a list", async () => {
    await mountMapping(<MappingSection />, { setup: (api) => {
      api.deviceBeds.mockRejectedValue(Object.assign(new Error("x"), { status: 409, apiCode: "monitor_lane_off" }));
    } });
    expect(screen.getByText(/Monitor zolağı bu xəstəxana üçün işləmir/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("reads the list again every five seconds while on screen", async () => {
    vi.useFakeTimers();
    const mounted = await mountMapping(<MappingSection />, { body: WARD });
    expect(mounted.api.deviceBeds).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(mounted.api.deviceBeds).toHaveBeenCalledTimes(2);
  });
});
```


---

### Task 18: The dialog — pick, confirm, the occupied bed's step, unbind, the refusals

**Lane:** dashboard (`/c/tmp/g2b-esleme-fe`). **Needs:** Task 17.

Spec D3, D4, §3.3, §3.4, §3.5, §3.6, O5. «Yatağa bağla»: a `Modal` with the session's beds from the structure (grouped by unit and room as a radio group; a closed bed dimmed with its reason; the monitor already on a bed named; «dolu» from the bed's state), then one confirming sentence (naming the monitor that will be unbound, and the bed the monitor leaves), then the request. The server decides occupancy: its `bed_occupied` opens the second step, focus on «Vazgeç», naming the patient only as «Ahmet Y.» from the session's board (or nobody), and that step's confirm sends `confirm_occupied: true`. «Bağlantıyı çöz»: one confirm, the same second step when the server asks. `mapping_changed` closes the dialog and reloads the list; any other refusal goes on the toast named after the monitor. Nothing changes before the last confirm; the result is said on the toast and announced.

**Files:**
- Modify: `dashboard/src/live/screens/devices/MappingDialog.jsx` (replace the stub)
- Create: `dashboard/src/live/screens/devices/MappingDialog.test.jsx` (code in `task-18-tests.md`)

- [ ] **Step 1: Write the failing test** — **Write** `MappingDialog.test.jsx` with the content of `task-18-tests.md`. Run `npx vitest run src/live/screens/devices/MappingDialog.test.jsx`: red — every test fails at `getByRole("dialog")` (the stub renders nothing).

- [ ] **Step 2: The dialog.** **Write** `dashboard/src/live/screens/devices/MappingDialog.jsx`:

```jsx
// src/live/screens/devices/MappingDialog.jsx — «Yatağa bağla» and «Bağlantıyı çöz» (spec 2026-10-28
// §3.3, §3.4): pick a bed from the session's own structure (bind only), confirm in one sentence, and
// — only when the server answers `bed_occupied` — a second step that names the patient as «Ahmet Y.»
// from the session's own board card, its focus on «Vazgeç». No UUID and no patient number on screen.
import React, { useMemo, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { useBoard } from "../../data/BoardProvider.jsx";
import { useStructure } from "../../data/StructureProvider.jsx";
import { bedLabel, normId } from "../../data/structure.js";
import { Button, Modal, useToast } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { reasonOf, refusedFor } from "../admin/refusal.js";
import { bedText, monitorName, occupiedNames } from "./deviceMap.js";

const FULL = new Set(["OCCUPIED", "PENDING_DISCHARGE", "PENDING_TRANSFER_OUT"]);

function BedChoice({ beds, devices, picked, onPick, self }) {
  const { t } = useI18n();
  const onBed = new Map(devices.filter((d) => d.bed?.id && d.source !== self).map((d) => [normId(d.bed.id), d]));
  if (beds.length === 0) return <p className="m-0 text-13">{t("esleme.pick.none")}</p>;
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="mb-1.5 text-13.5 font-semibold text-mute">{t("esleme.pick.legend")}</legend>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {beds.map((bed) => {
          const other = onBed.get(normId(bed.id));
          return (
            <li key={bed.id} className={bed.open ? "" : "opacity-55"}>
              <label className="inline-flex items-center gap-2 text-13.5">
                <input type="radio" name="esleme-bed" value={bed.id} checked={picked === bed.id} disabled={!bed.open}
                  onChange={() => onPick(bed.id)} className={FOCUS_RING} />
                <span>{bed.label} · {bed.roomName} · {bed.unitName}</span>
                {!bed.open ? <span className="text-12 text-mute">{t("esleme.pick.closed")}</span> : null}
                {other ? <span className="text-12 text-mute">{t("esleme.pick.hasMonitor", { monitor: monitorName(other) })}</span> : null}
                {FULL.has(bed.state) ? <span className="text-12 font-semibold text-att-ink">{t("esleme.pick.occupied")}</span> : null}
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

export function MappingDialog({ mode, device, devices, onClose, onDone }) {
  const { t } = useI18n();
  const { store } = useSession();
  const { patients } = useBoard();
  const { index } = useStructure();
  const toast = useToast();
  const [step, setStep] = useState(mode === "bind" ? "pick" : "confirm");
  const [picked, setPicked] = useState(null);
  const [occupied, setOccupied] = useState([]);
  const [busy, setBusy] = useState(false);
  const name = monitorName(device);
  const beds = useMemo(() => [...index.beds.values()]
    .filter((bed) => normId(bed.id) !== normId(device.bed?.id))
    .sort((a, b) => `${a.unitName}${a.roomName}${a.label}`.localeCompare(`${b.unitName}${b.roomName}${b.label}`, undefined, { numeric: true })),
  [index, device]);
  const other = picked ? devices.find((d) => d.source !== device.source && normId(d.bed?.id) === normId(picked)) : null;
  const target = picked ? bedLabel(index, picked) : null;
  const leaving = device.bed ? bedText(t, device) : null;

  async function send(confirm) {
    setBusy(true);
    const body = mode === "bind"
      ? { source: device.source, bed_id: picked, confirm_occupied: confirm,
          expected: { device_row_id: device.row_id, bed_row_id: other?.row_id ?? null } }
      : { source: device.source, confirm_occupied: confirm, expected: { device_row_id: device.row_id } };
    try {
      const answer = await store.track(() => (mode === "bind" ? store.api.bindDeviceBed(body) : store.api.unbindDeviceBed(body)));
      const text = !answer?.changed ? t("esleme.done.same")
        : mode === "bind" ? t("esleme.done.bound", { monitor: name, bed: target }) : t("esleme.done.unbound", { monitor: name });
      toast(text);
      onDone(text, answer?.list);
    } catch (err) {
      if (err?.apiCode === "bed_occupied" && !confirm) {
        setOccupied(occupiedNames(err.occupied, patients));
        setStep("occupied");
      } else if (err?.apiCode === "mapping_changed") {
        toast(t("esleme.err.mappingChanged"), "warn");
        onDone(t("esleme.err.mappingChanged"), null);
      } else {
        toast(refusedFor(t, name, reasonOf(t, err)), "error");
      }
    } finally {
      setBusy(false);
    }
  }

  const titles = { pick: t("esleme.pick.title", { monitor: name }), confirm: t("esleme.confirm.title"), occupied: t("esleme.occupied.title") };
  const actions = step === "pick" ? (
    <>
      <Button onClick={onClose} busy={busy}>{t("esleme.cancel")}</Button>
      <Button variant="primary" busy={busy} aria-disabled={picked ? undefined : "true"}
        onClick={() => { if (picked) setStep("confirm"); }}>{t("esleme.pick.next")}</Button>
    </>
  ) : step === "confirm" ? (
    <>
      <Button onClick={onClose} busy={busy}>{t("esleme.cancel")}</Button>
      <Button variant="primary" busy={busy} onClick={() => send(false)}>{t("esleme.confirm.ok")}</Button>
    </>
  ) : (
    <>
      {/* Its own step and its own button; Enter on the first focus cancels (spec §3.3 step 3). */}
      <Button onClick={onClose} busy={busy} autoFocus>{t("esleme.cancel")}</Button>
      <Button variant="primary" busy={busy} onClick={() => send(true)}>{t("esleme.occupied.ok")}</Button>
    </>
  );
  return (
    <Modal open title={titles[step]} onClose={onClose} busy={busy} actions={actions}>
      {step === "pick" ? <BedChoice beds={beds} devices={devices} picked={picked} onPick={setPicked} self={device.source} /> : null}
      {step === "confirm" ? (
        <div className="flex flex-col gap-1.5 text-13.5">
          {mode === "bind" ? <p className="m-0 font-semibold">{t("esleme.confirm.bind", { monitor: name, bed: target })}</p>
            : <p className="m-0 font-semibold">{t("esleme.confirm.unbind", { monitor: name, bed: leaving ?? device.device_bed_label ?? "—" })}</p>}
          {mode === "bind" && other ? <p className="m-0">{t("esleme.confirm.replace", { other: monitorName(other) })}</p> : null}
          {mode === "bind" && leaving ? <p className="m-0">{t("esleme.confirm.leave", { bed: leaving })}</p> : null}
        </div>
      ) : null}
      {step === "occupied" ? (
        <div className="flex flex-col gap-1.5 text-13.5">
          {occupied.map((o) => (
            <p key={o.bedId} className="m-0">
              {o.name ? t("esleme.occupied.named", { name: o.name }) : t("esleme.occupied.unnamed")}{" "}
              {mode === "bind" && normId(o.bedId) === normId(picked) ? t("esleme.occupied.flowTo") : t("esleme.occupied.flowStop")}
            </p>
          ))}
        </div>
      ) : null}
    </Modal>
  );
}
```

- [ ] **Step 3: Green**, the whole suite and the build:

```bash
cd /c/tmp/g2b-esleme-fe/dashboard
npx vitest run src/live/screens/devices/ 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
```

Expected: no `FAIL` (the dialog's 7 tests among them); `built in`, `precache  20 entries`. If `Button` rejects `autoFocus` (it must pass unknown props to the `<button>`; check `ui/Button.jsx`), focus «Vazgeç» with a ref and an effect instead, and say so in the commit body.

- [ ] **Step 4: Commit.**

```bash
cd /c/tmp/g2b-esleme-fe
P="dashboard/src/live/screens/devices/MappingDialog.jsx dashboard/src/live/screens/devices/MappingDialog.test.jsx"
git add -- $P && git status --short && git diff --cached --stat
git commit -F - -- $P <<'EOF'
feat(dashboard): the monitor→bed dialog — pick from the structure, confirm, and a second step for an admitted patient

«Yatağa bağla» (spec §3.3): the session's beds by unit and room, closed ones dimmed, the monitor on
a bed and «dolu» shown; one confirming sentence naming the monitor unbound and the bed left; the
server's bed_occupied opens the second step (focus on «Vazgeç»), naming the patient only as
«Ahmet Y.» from the session's board. «Bağlantıyı çöz» likewise. mapping_changed reloads the list;
every other refusal on the toast by its code.

red: 7 failed — no dialog (the stub rendered nothing)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```


---

#### Task 18, Step 1 (continued): `dashboard/src/live/screens/devices/MappingDialog.test.jsx`

The dialog is driven through the list (`MappingSection`), as a nurse reaches it. The ward is `kabul.testutil.js`'s structure: beds 1 (AVAILABLE), 2 (OCCUPIED), 3 (HOUSEKEEPING), 4 (closed) in «Otaq 1», 5 in «Otaq 2», N1 in the closed «Neonatal». The screen speaks az. Synthetic patient «Ahmet Yılmaz», `H2600042`.

**Write** `dashboard/src/live/screens/devices/MappingDialog.test.jsx`:

```jsx
// The monitor→bed dialog (spec §3.3–§3.5, O5): pick → confirm → (bed_occupied) a second step naming the
// patient only as «Ahmet Y.»; unbind; mapping_changed reloads; refusals by code; no UUID, no number.
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { board, entry, identity } from "../../data/board.testutil.js";
import { BED, expectNoUuid, settle } from "../kabul/kabul.testutil.js";
import { device, list, mountMapping, onBed } from "./esleme.testutil.js";
import { MappingSection } from "./MappingSection.jsx";

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

const WARD = list([
  device("192.0.2.11", { device_bed_label: "BED05", row_id: 1, bed: onBed(1, "1") }),
  device("192.0.2.13"),
]);
const refusal = (apiCode, extra = {}) => Object.assign(new Error("English words"), { status: 409, apiCode, ...extra });

async function open(name, setup) {
  const mounted = await mountMapping(<MappingSection />, { body: WARD, setup: (api) => {
    api.boardPatients.mockResolvedValue(board([entry("H2600042", [], {
      identity: identity({ patient_id: "H2600042", display_name: "Ahmet Yılmaz", bed_id: BED(2) }) })]));
    setup?.(api);
  } });
  await act(async () => { await mounted.board.start(); });
  fireEvent.click(screen.getByRole("button", { name }));
  await settle();
  return { ...mounted, dialog: () => screen.getByRole("dialog") };
}

async function pickAndConfirm(dialog, bed) {
  fireEvent.click(within(dialog()).getByRole("radio", { name: new RegExp(`^${bed}`) }));
  fireEvent.click(within(dialog()).getByRole("button", { name: "Davam" }));
  await settle();
}

describe("the monitor–bed dialog", () => {
  it("offers the session's beds, dims a closed one and names a bed's monitor and fullness", async () => {
    const { dialog } = await open("Çarpayıya bağla: 192.0.2.13");
    const d = within(dialog());
    expect(d.getByRole("radio", { name: /^1 · Otaq 1 · Reanimasiya.*monitor: 192\.0\.2\.11 \(BED05\)/ })).toBeTruthy();
    expect(d.getByRole("radio", { name: /^2 · Otaq 1 · Reanimasiya.*dolu/ })).toBeTruthy();
    expect(d.getByRole("radio", { name: /^4 · Otaq 1 · Reanimasiya.*bağlı/ }).disabled).toBe(true);
    expectNoUuid();
  });

  it("confirms naming both monitors, then sends what the screen saw", async () => {
    const { dialog, api } = await open("Çarpayıya bağla: 192.0.2.13", (a) => {
      a.bindDeviceBed.mockResolvedValue({ changed: true, replaced_source: "192.0.2.11", list: WARD });
    });
    await pickAndConfirm(dialog, "1 · Otaq 1");
    expect(within(dialog()).getByText("192.0.2.13 → 1 · Otaq 1 · Reanimasiya")).toBeTruthy();
    expect(within(dialog()).getByText("192.0.2.11 (BED05) bu çarpayıdan ayrılacaq.")).toBeTruthy();
    expect(api.bindDeviceBed).not.toHaveBeenCalled();                   // nothing before the last confirm
    fireEvent.click(within(dialog()).getByRole("button", { name: "Təsdiqlə" }));
    await settle();
    expect(api.bindDeviceBed).toHaveBeenCalledWith({ source: "192.0.2.13", bed_id: BED(1), confirm_occupied: false,
      expected: { device_row_id: null, bed_row_id: 1 } });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the second step on bed_occupied, names the patient only as «Ahmet Y.», and resends with the confirmation", async () => {
    const { dialog, api } = await open("Çarpayıya bağla: 192.0.2.13", (a) => {
      a.bindDeviceBed.mockRejectedValueOnce(refusal("bed_occupied", { occupied: [{ bed_id: BED(2), patient_id: "H2600042" }] }))
        .mockResolvedValueOnce({ changed: true, replaced_source: null, list: WARD });
    });
    await pickAndConfirm(dialog, "2 · Otaq 1");
    fireEvent.click(within(dialog()).getByRole("button", { name: "Təsdiqlə" }));
    await settle();
    expect(within(dialog()).getByText(/Çarpayıda: Ahmet Y\./)).toBeTruthy();
    expect(within(dialog()).getByText(/axmağa başlayacaq/)).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog()).getByRole("button", { name: "İmtina" }));
    expect(document.body.textContent).not.toMatch(/H2600042|Yılmaz/);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Bəli, davam et" }));
    await settle();
    expect(api.bindDeviceBed.mock.calls[1][0].confirm_occupied).toBe(true);
  });

  it("says only that a patient is there when the session's board has no card for them", async () => {
    const { dialog } = await open("Çarpayıya bağla: 192.0.2.13", (a) => {
      a.bindDeviceBed.mockRejectedValue(refusal("bed_occupied", { occupied: [{ bed_id: BED(5) }] }));
    });
    await pickAndConfirm(dialog, "5 · Otaq 2");
    fireEvent.click(within(dialog()).getByRole("button", { name: "Təsdiqlə" }));
    await settle();
    expect(within(dialog()).getByText(/Bu çarpayıda yatan xəstə var\./)).toBeTruthy();
  });

  it("unbinds after one confirmation naming the monitor and its bed", async () => {
    const { dialog, api } = await open("Bağlantını aç: 192.0.2.11 (BED05)", (a) => {
      a.unbindDeviceBed.mockResolvedValue({ changed: true, replaced_source: null, list: WARD });
    });
    expect(within(dialog()).getByText("192.0.2.11 (BED05) bu çarpayıdan açılacaq: 1 · Otaq 1 · Reanimasiya.")).toBeTruthy();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Təsdiqlə" }));
    await settle();
    expect(api.unbindDeviceBed).toHaveBeenCalledWith({ source: "192.0.2.11", confirm_occupied: false,
      expected: { device_row_id: 1 } });
  });

  it("closes and reads the list again when the mapping changed meanwhile", async () => {
    const { dialog, api } = await open("Bağlantını aç: 192.0.2.11 (BED05)", (a) => {
      a.unbindDeviceBed.mockRejectedValue(refusal("mapping_changed"));
    });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Təsdiqlə" }));
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.deviceBeds.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/Bu arada dəyişdi/).length).toBeGreaterThan(0);
  });

  it("says any other refusal by its code, named after the monitor, never in the server's words", async () => {
    const { dialog } = await open("Çarpayıya bağla: 192.0.2.13", (a) => {
      a.bindDeviceBed.mockRejectedValue(Object.assign(new Error("English words"), { status: 403, apiCode: "out_of_scope" }));
    });
    await pickAndConfirm(dialog, "5 · Otaq 2");
    fireEvent.click(within(dialog()).getByRole("button", { name: "Təsdiqlə" }));
    await settle();
    expect(screen.getByText(/192\.0\.2\.13.*sizin şöbələrinizdən birində deyil/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("English words");
  });
});
```

Notes:
- `identity({... bed_id: BED(2) })` puts the synthetic patient's card on bed 2 of the board; the dialog finds them by the refusal's `patient_id`, never by bed.
- `bed(4, "4", "AVAILABLE", false)` is the structure's closed bed (`kabul.testutil.js`): its radio is `disabled`, and its row says «bağlı» (`esleme.pick.closed` in az).
- `settle()` flushes the promises (and fake timers, when on).


---

### Task 19: Yönetim › Yapı — a held add says why, the room adder cannot be taken for the bed adder, and `bed_has_monitor`

**Lane:** dashboard (`/c/tmp/g2b-esleme-fe`). **Needs:** Task 16 (the strings of Task 15 and the code's mapping).

Spec D16, D18 b, §3.7. Three changes in `screens/admin/StructureTab.jsx`, B1a's file (Lane B):
1. `Line` (`:54-83`): while its box is blank, the sentence saying why the button is held is VISIBLE (muted), not `sr-only`; after a press it turns to the error style, as today. Every adder and rename box gets it.
2. `RoomAdd` (`:106-136`): both boxes get visible labels («Otağın adı», «Otağın nömrəsi (məcburi deyil, məs. 05)»), and a hint under the adder says beds are added under the room once it exists.
3. Closing a bed with a monitor: the server's `bed_has_monitor` (Task 12) reaches the toast through the existing `refusedFor(t, subject, reasonOf(t, err))` — mapped by its code in Task 16 — named after the bed. No code change for it; a test pins it.

**Files:**
- Modify: `dashboard/src/live/screens/admin/StructureTab.jsx`
- Modify: `dashboard/src/live/screens/admin/StructureTab.test.jsx`

- [ ] **Step 1: Write the failing tests.** **Edit** `dashboard/src/live/screens/admin/StructureTab.test.jsx` — after the test `it("closes an open bed and reopens a closed one, each named after the bed", …)` (ends before the next `it(`), add:

```jsx
  // G2-ESLEME (spec §3.7, walk lessons of B1a's deploy)
  it("shows, without a press, why a blank adder's button is held", async () => {
    await mountKabul(<StructureTab />, { perms: ADMIN });
    const reasons = screen.getAllByText("Çarpayı etiketi boş ola bilməz.");
    expect(reasons.length).toBeGreaterThan(0);
    for (const el of reasons) expect(el.className).not.toContain("sr-only");
  });

  it("labels the room adder's two boxes where they can be seen, and says where beds are added", async () => {
    await mountKabul(<StructureTab />, { perms: ADMIN });
    expect(screen.getAllByText("Otağın adı").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Otağın nömrəsi (məcburi deyil, məs. 05)").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Çarpayı otaq əlavə edildikdən sonra otağın altında «Çarpayı əlavə et» ilə/).length)
      .toBeGreaterThan(0);
  });

  it("says a bed with a monitor is unbound on «Monitorlar» first, named after the bed", async () => {
    await mountKabul(<StructureTab />, { perms: ADMIN, setup: (api) => {
      api.patchBed.mockRejectedValue(Object.assign(new Error("A monitor is bound to this bed."), { status: 409, apiCode: "bed_has_monitor" }));
    } });
    await press("Bağla: 5 · Otaq 2 · Reanimasiya");
    expect(toasts().getAllByText(/5 · Otaq 2 · Reanimasiya.*Bu çarpayıya monitor bağlıdır — əvvəlcə «Monitorlar» ekranında bağlantını açın\./).length)
      .toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("A monitor is bound to this bed.");
  });
```

- [ ] **Step 2: Red.**

```bash
cd /c/tmp/g2b-esleme-fe/dashboard
npx vitest run src/live/screens/admin/StructureTab.test.jsx 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |✗|×" | head
```

Expected: the first two new tests fail (the sentence is `sr-only`; no visible room labels or hint); the third passes already (Task 16 mapped the code — record it as the pin of a behaviour, not a red).

- [ ] **Step 3: `Line` and `RoomAdd`.**

**Edit** `dashboard/src/live/screens/admin/StructureTab.jsx` (1) — replace:

```jsx
function Line({ id, label, placeholder, initial = "", subject, submitKey, blankKey, maxLength, onSubmit, busy, held, autoFocus, children }) {
  const { t } = useI18n();
  const [value, setValue] = useState(initial);
  const [tried, setTried] = useState(false);
  const blankId = useId();
```

with:

```jsx
function Line({ id, label, caption, placeholder, initial = "", subject, submitKey, blankKey, maxLength, onSubmit, busy, held, autoFocus, children }) {
  const { t } = useI18n();
  const [value, setValue] = useState(initial);
  const [tried, setTried] = useState(false);
  const blankId = useId();
  const inputId = useId();
```

**Edit** (2) — replace:

```jsx
      <Input aria-label={label} placeholder={placeholder} value={value} readOnly={busy} maxLength={maxLength} autoFocus={autoFocus}
```

with:

```jsx
      {/* G2-ESLEME (spec §3.7): a visible label where the accessible one alone was mistaken (RoomAdd). */}
      {caption ? <label htmlFor={inputId} className="basis-full text-12 font-semibold text-mute">{caption}</label> : null}
      <Input id={inputId} aria-label={label} placeholder={placeholder} value={value} readOnly={busy} maxLength={maxLength} autoFocus={autoFocus}
```

**Edit** (3) — replace:

```jsx
        <p id={blankId} className={tried ? "m-0 basis-full text-12 font-semibold text-crit-ink" : "sr-only"}>{t(blankKey)}</p>
```

with:

```jsx
        // G2-ESLEME (spec §3.7 item 1): seen while the button is held for a blank box — a button that
        // only looks disabled is rarely pressed, so a reason heard only after a press was never heard.
        <p id={blankId} className={tried ? "m-0 basis-full text-12 font-semibold text-crit-ink" : "m-0 basis-full text-12 text-mute"}>{t(blankKey)}</p>
```

**Edit** (4) — replace:

```jsx
  return (
    <Line label={t("kabul.newRoom", { unit })} placeholder={t(PLACEHOLDER.room)} subject={unit} submitKey="kabul.addRoom"
      blankKey="kabul.invalid.name" maxLength={MAX.room} busy={busy} held={held}
```

with:

```jsx
  return (
    <div className="flex flex-col gap-1">
    <Line label={t("kabul.newRoom", { unit })} caption={t("kabul.roomNameLabel")} placeholder={t(PLACEHOLDER.room)} subject={unit} submitKey="kabul.addRoom"
      blankKey="kabul.invalid.name" maxLength={MAX.room} busy={busy} held={held}
```

**Edit** (5) — replace:

```jsx
      <Input aria-label={t("kabul.newRoomNumber", { unit })} placeholder={t("kabul.roomNumber")}
        value={number} readOnly={busy} maxLength={MAX.roomNumber} onChange={(e) => setNumber(e.target.value)}
        className="!w-[120px]" />
```

with:

```jsx
      <label className="inline-flex flex-col gap-0.5 text-12 font-semibold text-mute">
        {t("kabul.roomNumberLabel")}
        <Input aria-label={t("kabul.newRoomNumber", { unit })} placeholder={t("kabul.roomNumber")}
          value={number} readOnly={busy} maxLength={MAX.roomNumber} onChange={(e) => setNumber(e.target.value)}
          className="!w-[120px]" />
      </label>
```

**Edit** (6) — the end of `RoomAdd`'s JSX: replace the `</Line>` that closes `RoomAdd`'s `Line` together with the function's `);` — i.e. the lines

```jsx
        {t("kabul.isolation")}
      </label>
    </Line>
  );
}
```

with:

```jsx
        {t("kabul.isolation")}
      </label>
    </Line>
    <p className="m-0 text-12 text-mute">{t("kabul.roomHint")}</p>
    </div>
  );
}
```

(Edit 3's `//` comment sits inside the ternary's parentheses, `{blank ? ( … ) : null}`, which is JavaScript, not JSX children: a line comment is valid there.)

- [ ] **Step 4: Green**, the tab's own tests and the admin folder:

```bash
cd /c/tmp/g2b-esleme-fe/dashboard
npx vitest run src/live/screens/admin/ 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
```

Expected: no `FAIL`. An existing test that pinned the old invisibility (a sentence found only after a press) now finds it before: change that assertion to the spec's new rule (visible and muted before a press, the error style after) and name the test in the commit body. The 390 px test (`never scrolls sideways at 390 px`) must stay green: the room number's label stacks above its box.

- [ ] **Step 5: The whole suite and the build**, then commit.

```bash
cd /c/tmp/g2b-esleme-fe/dashboard
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
cd /c/tmp/g2b-esleme-fe
P="dashboard/src/live/screens/admin/StructureTab.jsx dashboard/src/live/screens/admin/StructureTab.test.jsx"
git add -- $P && git status --short && git diff --cached --stat
git commit -F - -- $P <<'EOF'
fix(dashboard): Yapı — a held add says why where it is seen; the room adder is labelled; bed_has_monitor pinned

B1a deploy lessons (spec §3.7): a blank box's reason is visible (muted) while its button is held,
the error style after a press; the room adder's name and number boxes carry visible labels and a
hint says beds are added under the room. Closing a bed with a monitor says, named after the bed, to
unbind it on «Monitorlar» first.

red: 2 failed — the reason was sr-only; no visible room labels or hint (bed_has_monitor passed on Task 16)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```


---

### Task 20: The raw-key sweep, and the dashboard lane's gate

**Lane:** dashboard (`/c/tmp/g2b-esleme-fe`). **Needs:** Tasks 17–19.

Spec D17, §3.6, §6 "Dashboard". `rawKeys.test.jsx` opens every route of the build in the whole shell (`openAt(path)`, `:193-219`, every permission) and fails on a text that is an i18n key; its anchors assert, per slice, that the strings are really drawn (a sweep over a screen that rendered nothing passes vacuously). The «Monitörler» route is already swept — but its list answers `undefined` there today, so the section would show only «oxunmadı». This task gives the sweep a list to draw and adds the editor's anchor: the list and the dialog's pick, in az, with no raw key and no UUID.

**Files:**
- Modify: `dashboard/src/live/rawKeys.test.jsx`

- [ ] **Step 1: A list for the sweep.** **Edit** `dashboard/src/live/rawKeys.test.jsx` (1) — replace:

```js
import { UUID_TEXT, row as admissionRow, structure as wardStructure } from "./screens/kabul/kabul.testutil.js"; // G2-B1a
```

with:

```js
import { BED, UUID_TEXT, row as admissionRow, structure as wardStructure } from "./screens/kabul/kabul.testutil.js"; // G2-B1a
import { device, list as mappingList, onBed } from "./screens/devices/esleme.testutil.js"; // G2-ESLEME
```

**Edit** (2) — replace:

```js
      api.structure.mockResolvedValue(WARD);
      api.admissions.mockResolvedValue(ADMISSIONS);
    },
```

with:

```js
      api.structure.mockResolvedValue(WARD);
      api.admissions.mockResolvedValue(ADMISSIONS);

      // G2-ESLEME: the monitor–bed list on «Monitörler» — a bound, a label-only, another unit's and
      // an absent monitor, so every row kind and both actions are drawn.
      api.deviceBeds.mockResolvedValue(MAPPING);
    },
```

**Edit** (3) — replace:

```js
/** The address of a route, with its parameters on the fixture's card. */
```

with:

```js
// G2-ESLEME: the editor's list for every sweep (synthetic monitors on the kabul ward's beds).
const MAPPING = mappingList([
  device("192.0.2.11", { device_bed_label: "BED05", row_id: 1, bed: onBed(1, "1") }),
  device("192.0.2.12", { device_bed_label: "BED01", row_id: 2 }),
  device("192.0.2.14", { row_id: 4, editable: false, bed: { id: BED(6), in_scope: false } }),
  device("192.0.2.20", { row_id: 5, seen: false, status: null, last_seen_at: null }),
]);

/** The address of a route, with its parameters on the fixture's card. */
```

- [ ] **Step 2: The editor's anchor.** **Edit** (4) — replace:

```js
  it("the trend charts' keys resolve on the cards, in the big chart, its table and the form", async () => {
```

with:

```js
  it("the monitor–bed editor's keys resolve on its list and in its dialog", async () => {
    const mounted = await openAt("/devices");
    expect(screen.getByRole("heading", { name: "Monitor–çarpayı uyğunlaşdırması" })).toBeInTheDocument(); // esleme.title
    expect(screen.getByText("başqa şöbədə")).toBeInTheDocument();                                         // esleme.otherUnit
    expect(screen.getByText("görünmür · son dəfə bilinmir")).toBeInTheDocument();                         // esleme.unseenUnknown
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Başqa çarpayıya bağla: 192.0.2.11 (BED05)" })); await settle(); });
    expect(screen.getByRole("dialog")).toHaveTextContent("Çarpayılar");                                    // esleme.pick.legend
    expect(rawKeys(document.body)).toEqual([]);
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
    act(() => { mounted.board.clear(); });
  });

  it("the trend charts' keys resolve on the cards, in the big chart, its table and the form", async () => {
```

(`settle` is the file's own helper — `grep -n "const settle\|function settle" src/live/rawKeys.test.jsx`; `rawKeys` likewise. Both exist: B1a's anchor at `:311-340` uses them.)

- [ ] **Step 3: Green — the sweep, then everything, then the build.**

```bash
cd /c/tmp/g2b-esleme-fe/dashboard
npx vitest run src/live/rawKeys.test.jsx 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
```

Expected: no `FAIL` (`rawKeys.test.jsx` one test more); totals = the lane's baseline + the slice's (new files `deviceMap.test.js`, `MappingSection.test.jsx`, `MappingDialog.test.jsx`; added tests in `backendApi.test.js`, `apiErrors.test.js` (its `it.each(CODES)` grows by five), `DevicesScreen.test.jsx`, `StructureTab.test.jsx`, `rawKeys.test.jsx`); `built in`, `precache  20 entries`, no `larger than 500 kB`. Write the totals into the commit body and into Task 21's notes.

- [ ] **Step 4: Commit.**

```bash
cd /c/tmp/g2b-esleme-fe
git add -- dashboard/src/live/rawKeys.test.jsx
git status --short && git diff --cached --stat
git commit -F - -- dashboard/src/live/rawKeys.test.jsx <<'EOF'
test(dashboard): the monitor→bed editor in the raw-key sweep

The whole-shell sweep now draws the «Monitörler» list (bound, label-only, another unit's, absent
monitors), and an anchor opens the dialog's pick: no i18n key, no UUID.

no red: a sweep over Tasks 15–19's surfaces; totals <files>/<tests>, build clean, precache 20

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

(Fill `<files>/<tests>` from Step 3.)

- [ ] **Step 5: Lane A's dashboard hunks, gathered for review.**

```bash
cd /c/tmp/g2b-esleme-fe
git diff feat/g2b-monitor-esleme..HEAD -- dashboard/src/live/screens/devices/DevicesScreen.jsx dashboard/src/live/screens/devices/DevicesScreen.test.jsx dashboard/src/live/i18n/strings/monitor.js > /c/tmp/homunculus-plans/g2b-esleme/lane-a-review-dashboard.patch
git diff --stat feat/g2b-monitor-esleme..HEAD -- dashboard/src/live/screens/common dashboard/src/live/data/shadowStore.js
```

Expected: the patch written outside the repo; the second command prints nothing (`MonitorStrip`, `screens/common/monitor.js` and the shadow store are untouched). Report the patch's path to the controller; the lane merges after Lane A's word.


---

### Task 21: The gates — everything, on the merged slice branch

**Where:** `/c/tmp/g2b-esleme` (branch `feat/g2b-monitor-esleme`), after both lanes are merged (`deps.md`, "Merge order": the backend lane first, then the dashboard lane) and Lane A has reviewed the two `lane-a-review-*.patch` files. Nothing is committed here unless a gate finds a fault (a fix gets its own commit with its red).

- [ ] **Step 1: The merge is whole.**

```bash
cd /c/tmp/g2b-esleme
git log --oneline ade8da8..HEAD | cat
git diff --stat ade8da8 HEAD -- homunculus-engine dashboard deploy | tail -1
git diff --name-only ade8da8 HEAD -- homunculus-engine dashboard deploy
```

Expected: the spec's commits, this plan's, the nineteen task commits (Tasks 1–13 and 15–20; Task 14 commits nothing) plus any `fix(…)`, and the dashboard lane's merge commit; the file list is the header's file map for Tasks 1–20 and nothing else.

- [ ] **Step 2: The whole no-DB engine suite** (≈ 2½ min):

```bash
cd /c/tmp/g2b-esleme/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -1
```

Expected: no failure; the counts Task 14 Step 4 recorded.

- [ ] **Step 3: The Postgres-backed suite, in parts** — one call per part, each under 10 minutes; a part that waits on Lane A's advisory lock and times out is run again. The parts are B1a's fourteen (`/c/tmp/homunculus-plans/g2b1a/task-20.md`, Step 3 — the same file lists, `ls`-expanded at run time, `grep -v test_infinity_vm_pilot`) plus one part for this slice:

```bash
# part 15 — this slice
cd /c/tmp/g2b-esleme/homunculus-engine
DB=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test
TEST_DATABASE_URL=$DB PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_migration_0014_device_beds.py tests/test_device_beds_postgres.py tests/test_device_beds_import.py tests/test_device_beds_parity.py tests/test_device_beds_api.py tests/test_device_beds_occupied.py tests/test_device_beds_concurrency.py tests/test_device_beds_structure.py 2>&1 | tail -1
```

and `tests/test_tenant_isolation.py` in its two halves (`-k by_id`, `-k "not by_id"`, O49 of B1a). B1a's part whose glob would now catch a `test_device_beds_*` file runs it twice — harmless, or add `--deselect` for those files there. Expected: every part `… passed`, nothing failed or errored; write each part's line into the notes.

- [ ] **Step 4: Python 3.14, the slice's DB-backed files** (one call):

```bash
cd /c/tmp/g2b-esleme/homunculus-engine
DB=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test
TEST_DATABASE_URL=$DB PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/g115-py314/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_device_beds_postgres.py tests/test_device_beds_import.py tests/test_device_beds_parity.py tests/test_device_beds_api.py tests/test_device_beds_structure.py 2>&1 | tail -1
```

Expected: all passed.

- [ ] **Step 5: The dashboard, merged** (the junction is the slice worktree's own `dashboard/node_modules`; if it is missing, make it as `deps.md` makes the lanes'):

```bash
cd /c/tmp/g2b-esleme/dashboard
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
```

Expected: Task 20's totals (the backend lane added no dashboard test but Task 1's mirror, already in the dashboard lane's base); `built in`, `precache  20 entries`.

- [ ] **Step 6: The notes.** Write `/c/tmp/homunculus-plans/g2b-esleme/gates.txt` (outside the repo): the merged head, each suite's line, the build's two lines, the date. Task 23 quotes it in the roadmap row and the spec's "as built" note.


---

### Task 22: The local walk — the deploy rehearsed, the editor walked, R-1 and R-2 rehearsed

**Where:** `/c/tmp/g2b-esleme`, after Task 21. The agent drives (headless Chrome, as B1a's walk); synthetic accounts, structure and devices only — the v2 file is the one exception, and it holds addresses and labels, no patient. Nothing is committed; the outcome is `/c/tmp/homunculus-plans/g2b-esleme/walk/notes.md` (pass or finding per item, in the screen's own words) and screenshots beside it, quoted by Task 23. Spec §6 "Local walk", §7.2, §7.3 (R-1 and its rehearsal are Lane A's condition: **the plan is not done until Step 8 has run**).

- [ ] **Step 1: No other stack.** The compose file names its containers (`homunculus-postgres`, `homunculus-api`, `homunculus-web`), so one such stack runs at a time. At planning time one was up on 18090/18453 (O65):

```bash
docker ps -a --format '{{.Names}} {{.Ports}} {{.Label "com.docker.compose.project"}}' | grep -E '^homunculus-(postgres|api|web) ' || echo "no stack containers"
```

If any is listed: **stop and ask the controller** whose it is and whether it may go down. Never `down -v` a stack this task did not start.

- [ ] **Step 2: The two api images.** The pre-slice image is main `ade8da8`'s (the code the VM runs, `cad9bea` + docs), built from a detached worktree; the new one from the slice's head:

```bash
cd /c/tmp/g2b-esleme
git worktree add --detach /c/tmp/g2b-esleme-old ade8da8
docker build -q -t g2b-esleme-api:pre -f /c/tmp/g2b-esleme-old/homunculus-engine/Dockerfile.api /c/tmp/g2b-esleme-old/homunculus-engine
cmd //c "mklink /J C:\\tmp\\g2b-esleme-old\\dashboard\\node_modules C:\\tmp\\homunculus-g1\\dashboard\\node_modules"
docker build -q -t g2b-esleme-web:pre -f /c/tmp/g2b-esleme-old/deploy/local/web/Dockerfile /c/tmp/g2b-esleme-old
cmd //c "rmdir C:\\tmp\\g2b-esleme-old\\dashboard\\node_modules"
git worktree remove --force /c/tmp/g2b-esleme-old
docker build -q -t g2b-esleme-api:new -f homunculus-engine/Dockerfile.api homunculus-engine
docker build -q -t g2b-esleme-web:new -f deploy/local/web/Dockerfile .
docker image inspect g2b-esleme-api:pre --format '{{json .Config.Cmd}}'
```

Expected: two image ids; the pre image's `Cmd` is exactly `["sh","-c","alembic upgrade head && python scripts/seed_admin.py && exec uvicorn homunculus.api.prodserver:app --host 0.0.0.0 --port 8000"]` (the CMD R-1's override drops one step of).

- [ ] **Step 3: The stack's scratch.** Outside the repo, so the worktree gains no `infinity-shadow/` directory:

```bash
S=/c/tmp/homunculus-plans/g2b-esleme/stack
mkdir -p $S/infinity-shadow /c/tmp/homunculus-plans/g2b-esleme/walk
cp deploy/infinity/device-beds.icu2.json $S/infinity-shadow/device-beds.json
sha256sum $S/infinity-shadow/device-beds.json | cut -c1-12            # 84ac1760d59f
grep -vE '^(WEB_PORT|WEB_TLS_PORT|INFINITY_CLINICAL_STAGE|INFINITY_SHADOW_TOKEN|TENANT_SLUG)=' /c/tmp/g115plan/stack/local.env > $S/local.env
printf 'WEB_PORT=18095\nWEB_TLS_PORT=18458\nTENANT_SLUG=esleme-yuruyus\nINFINITY_CLINICAL_STAGE=shadow\nINFINITY_SHADOW_TOKEN=%s\n' "$(/c/tmp/f7-py312/venv/Scripts/python.exe -c 'import secrets; print(secrets.token_hex(32))')" >> $S/local.env
```

**Write** `/c/tmp/homunculus-plans/g2b-esleme/stack/compose.esleme.yml` (outside the repo):

```yaml
# The editor's walk: the api runs the image named by ESLEME_API_IMAGE (pre or new), never a build,
# and reads the device→bed file from scratch. Used with deploy/local/docker-compose.yml and G1-15's
# compose.g115.yml (the other bind mounts in scratch).
services:
  api:
    image: ${ESLEME_API_IMAGE:-g2b-esleme-api:new}
    pull_policy: never
    volumes:
      - C:/tmp/homunculus-plans/g2b-esleme/stack/infinity-shadow:/etc/homunculus/infinity-shadow:ro
  web:
    image: ${ESLEME_WEB_IMAGE:-g2b-esleme-web:new}
    pull_policy: never
```

(The web image's build context is the repository root, as `deploy/local/docker-compose.yml`'s `web.build` says; if its `context` differs, build with that context. The junction lets the web build find `node_modules` if its Dockerfile copies them; if it installs them itself, the junction is unused and harmless.)

and the R-1 override, exactly as the blocks will write it (spec §7.3), **Write** `/c/tmp/homunculus-plans/g2b-esleme/stack/eski-imaj-0014.yml`:

```yaml
services:
  api:
    command: ["sh", "-c", "python scripts/seed_admin.py && exec uvicorn homunculus.api.prodserver:app --host 0.0.0.0 --port 8000"]
```

In every command below, `C` is:

```bash
C="docker compose -p g2besleme -f deploy/local/docker-compose.yml -f /c/tmp/g115plan/stack/compose.g115.yml -f /c/tmp/homunculus-plans/g2b-esleme/stack/compose.esleme.yml --env-file /c/tmp/homunculus-plans/g2b-esleme/stack/local.env"
```

- [ ] **Step 4: The "VM before": the pre image at 0013, with a v2-shaped ward.**

```bash
cd /c/tmp/g2b-esleme
ESLEME_API_IMAGE=g2b-esleme-api:pre ESLEME_WEB_IMAGE=g2b-esleme-web:pre $C up -d --no-build postgres api web 2>&1 | tail -3
docker exec homunculus-postgres psql -U homunculus -d homunculus -Atc "select version_num from alembic_version" </dev/null
```

Expected: `0013`; `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:18095/health` → `200` once `docker inspect -f '{{.State.Health.Status}}' homunculus-api` says `healthy`. Then the accounts (`docker exec -e TEST_USER_PASSWORD='G115-Sentetik-Parola-1' -e SEED_TENANT_SLUG=esleme-yuruyus homunculus-api python scripts/seed_test_users.py`, as B1a's walk), and the v2-shaped ward — one site, «Reanimasiya» with id `82ff93a0-4b67-4ccc-b326-77fa48524222`, twelve rooms «Otaq NN» with one bed «bedNN» each carrying v2's bed id (the twelve of `tests/esleme_v2.py` `BEDS`) — inserted by one `psql -v ON_ERROR_STOP=1 … </dev/null` script the agent writes to `walk/ward.sql` from `tests/esleme_v2.py` (site, unit, rooms, beds; `is_active` true; state `AVAILABLE`). Make one bed's label equal its v2 label (`BED07` for bed 07) so Step 7 can rehearse both sha cases of block D.

- [ ] **Step 5: The deploy, as blocks B will do it.** The migration and the import with the NEW image in one-off containers while the pre API serves; then the new API:

```bash
cd /c/tmp/g2b-esleme
ESLEME_API_IMAGE=g2b-esleme-api:new $C run --rm --no-deps -T api alembic upgrade head </dev/null 2>&1 | tail -2
ESLEME_API_IMAGE=g2b-esleme-api:new $C run --rm --no-deps -T api python scripts/import_device_beds.py --tenant esleme-yuruyus </dev/null | tee /c/tmp/homunculus-plans/g2b-esleme/walk/import.txt
ESLEME_API_IMAGE=g2b-esleme-api:new ESLEME_WEB_IMAGE=g2b-esleme-web:new $C up -d --no-build api web 2>&1 | tail -2
```

Expected: `alembic current` 0014; `ESLEME_ICE_AKTARIM {… "rows": 13, "with_bed": 12, "without_bed": 1, "granted": ["charge_nurse"], "version": 13, "sha256": "e470d3342025…", "already": false …}`; the new API healthy; `GET /infinity-shadow/board` (tenant token) `table.version` 13, `table.sha256` `e470d3342025…`.

- [ ] **Step 6: Devices on the strip.** A synthetic forwarder body for v2's thirteen addresses plus one new (`10.10.203.40`), posted every ~5 s while walking (a small loop the agent runs in the background of its own shell, with the stack's shadow token from `local.env`, never printed; `sent_at` = now, readings `[]` or an `hr` 70–80): the list shows thirteen bound/label-only rows and one «bağlı deyil».

- [ ] **Step 7: The walk** (az, then tr for the dialog; 1440 px, then 390 px; Gece and Gün once each). Each item: pass, or a finding with the screen's words and a screenshot `walk/NN-…png`:
  1. «Monitorlar» as `test.sorumlu.hemsire` (charge nurse): the section above the strips; her own unit's rows editable; no UUID; the method line of a v2 card reads the date.
  2. Bind the new monitor `10.10.203.40` to an empty bed — pick list grouped, closed bed dimmed, «dolu» on an occupied bed; one confirm; toast «… bağlandı»; the strip shows it at its next poll.
  3. Replace: bind it to a bed that has a monitor — the confirmation names the monitor to be unbound; afterwards that monitor reads «bağlı deyil».
  4. Move and unbind; «Bağlantını aç» on the label-only BED01 row (it becomes «atanmamış cihaz» on the strip).
  5. Occupied: admit a synthetic patient («Ahmet Yılmaz») on an empty bed through Hasta Kabul, then bind a monitor there: the second step opens, focus on «İmtina», names «Ahmet Y.» and no number; confirm; the strip's card links the patient. Unbind it again (second step, «axmağı dayandıracaq»).
  6. A second browser as `test.yonetici` changes a row while the first has the dialog open: the first gets «Bu arada dəyişdi …» and the list reloads.
  7. Yapı (`test.yonetici`): rename a bound bed → the strip's card follows; close a bound bed → the toast says to unbind on «Monitorlar» first; the blank adder's reason is visible; the room adder's labels and hint.
  8. Block D rehearsed: unbind then rebind an empty bed's monitor on the bed whose Yapı label equals its v2 label (BED07): `version` +2, `sha256` back to the import's; then on a bed whose labels differ (bed05 vs BED05): `version` +2 and the sha `esleme_ozet.py`'s rule predicts (the label replaced) — record both.

- [ ] **Step 8: R-1, rehearsed (Lane A's condition).** The pre image with the override against the database at 0014:

```bash
cd /c/tmp/g2b-esleme
ESLEME_API_IMAGE=g2b-esleme-api:pre ESLEME_WEB_IMAGE=g2b-esleme-web:pre $C -f /c/tmp/homunculus-plans/g2b-esleme/stack/eski-imaj-0014.yml up -d --no-build api web 2>&1 | tail -2
docker inspect -f '{{json .Config.Cmd}} {{.Config.User}} {{json .Config.Entrypoint}}' homunculus-api
docker exec homunculus-postgres psql -U homunculus -d homunculus -Atc "select version_num from alembic_version" </dev/null
```

Expected: the container runs the override's `Cmd`, user `homunculus`, no entrypoint; `alembic_version` still `0014`; `/health` 200 after `healthy`; the board's `table.version` **2** and `table.sha256` beginning **`84ac1760d59f`** (the old code reads the file); the strip shows the file's mapping (the walk's binds are not on it); Rollar shows the charge nurse's column read-only, naming `devices.map_beds`. Then **forward again**:

```bash
ESLEME_API_IMAGE=g2b-esleme-api:new ESLEME_WEB_IMAGE=g2b-esleme-web:new $C up -d --no-build api web 2>&1 | tail -2
docker logs homunculus-api 2>&1 | grep -iE "alembic|Running upgrade" | tail -3
ESLEME_API_IMAGE=g2b-esleme-api:new $C run --rm --no-deps -T api python scripts/import_device_beds.py --tenant esleme-yuruyus </dev/null; echo "exit $?"
```

Expected: no `Running upgrade` line (head is already 0014); the import exits **3** (the walk's binds are in the table) and writes nothing; the board's `version` and `sha256` are the database's again and the walk's binds are back on the strip.

- [ ] **Step 9: R-2, rehearsed.**

```bash
ESLEME_API_IMAGE=g2b-esleme-api:new $C run --rm --no-deps -T api alembic downgrade 0013 </dev/null 2>&1 | tail -2
docker exec homunculus-postgres psql -U homunculus -d homunculus -Atc "select to_regclass('public.device_beds'), (select count(*) from pg_trigger where tgname like 'device_beds_%'), (select count(*) from pg_proc where proname = 'device_beds_history_kept'), (select version_num from alembic_version)" </dev/null
docker exec homunculus-postgres psql -U homunculus -d homunculus -Atc "delete from group_permissions where permission = 'devices.map_beds'" </dev/null
ESLEME_API_IMAGE=g2b-esleme-api:pre ESLEME_WEB_IMAGE=g2b-esleme-web:pre $C up -d --no-build api web 2>&1 | tail -2
```

Expected: `|0|0|0013` (no table, no trigger, no function, at 0013); `DELETE 1`; the pre image with its OWN command healthy, the board's table version 2, sha `84ac1760d59f…`.

- [ ] **Step 10: Down, this stack only.** `$C down -v` (the project `g2besleme`, which this task started), `docker image rm g2b-esleme-api:pre g2b-esleme-api:new g2b-esleme-web:pre g2b-esleme-web:new`, stop the Step 6 loop. Write `walk/notes.md`: each item of Steps 5–9 with its outcome, the findings first. A finding that changes code is a new task for the controller, not a fix inside the walk.


---

### Task 23: Docs — the Turkish guide, the deploy README, `.env.example`, the roadmap row, the spec's "as built"

**Where:** `/c/tmp/g2b-esleme`, after Task 21 (the counts it quotes) and beside Task 22 (its outcomes). **Lane A review hunk:** `deploy/infinity/README.md` — the new section only.

Spec §7.4; memory "Living Turkish guide" (the guide is kept current as the project grows). Docs only: the words of the editor for the ward, where the table now lives for the operator, and the record of what was built.

**Files:**
- Modify: `docs/homunculus-rehber-TR.md`
- Modify: `deploy/infinity/README.md`
- Modify: `deploy/local/.env.example`
- Modify: `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`
- Modify: `docs/superpowers/specs/2026-10-28-g2b-monitor-yatak-esleme-design.md`

- [ ] **Step 1: The guide, §3.9.** **Edit** `docs/homunculus-rehber-TR.md` — replace the heading line `## 4. "Neden bunu kullanmıyoruz" köşesi` with the new section followed by that heading:

```markdown
### 3.9 Monitör–yatak eşleme (Grup 2 · Lane B)

**Ne?** Hangi başucu monitörünün hangi yatakta durduğu. Monitör şeridi (ve Aşama B'nin gölge motoru)
bir monitörün değerlerini yalnız bu eşlemeyle bir yatağa, oradan da o yatakta yatan hastanın kartına
bağlar. Eskiden onaylı bir dosyaydı (`device-beds.icu2.json`, sürüm 2); artık veritabanında, kurum
başına bir tablodur ve değişikliği ekrandan yapılır. Dosya tarihçe olarak kalır.

**Nerede, kim?** Sol raydaki **«Monitörler»** ekranında, şeritlerin üstünde **«Monitör–yatak
eşleme»** bölümü. Değiştirebilenler: **yönetici** ve **sorumlu hemşire** (`devices.map_beds`
yetkisi; yönetici İdare › Rollar'dan başka gruplara da verebilir ya da geri alabilir). Sorumlu
hemşire yalnız **kendi birimlerinin** yataklarında değişiklik yapar. Biyomedikal listeyi görür,
değiştiremez.

**Nasıl?** Her monitörün satırında **«Yatağa bağla»** (bağlıysa «Başka yatağa bağla») ve
**«Bağlantıyı çöz»**:
1. Yatak **Yapı'dan seçilir**, asla yazılmaz; kapalı yataklar soluk ve seçilemez.
2. **Tek cümlelik onay**: «10.10.203.37 (BED08) → bed08 · Otaq 08 · Reanimasiya». Yatakta başka
   monitör varsa o monitörün ayrılacağı da yazılır — bir yatakta hiçbir an iki monitör olmaz.
3. **Yatakta yatan hasta varsa ikinci onay**: monitörün değerleri o hastanın kartına akmaya
   başlayacak (ya da bırakacak). Hasta yalnız kısa adıyla görünür (**«Ahmet Y.»**), numara görünmez.
   İlk odak «Vazgeç»tedir; Enter yanlışlıkla onaylamaz.

Son onaydan önce hiçbir şey değişmez. Şerit değişikliği en geç bir sonraki okumada (≤ 5 sn) gösterir.

**Satırdaki sözler.** «görünüyor» — işçi monitörü bildiriyor. **«görünmüyor · son görülme 13:42»** —
bir süredir bildirmiyor; bağlıysa bağlı kalır, kendiliğinden hiçbir şey çözülmez. «son görülme
bilinmiyor» — API yeniden başladığından beri hiç bildirilmedi. «başka birimde» — monitörün yatağı
sizin birimlerinizden birinde değil.

**Ret mesajları.** «Bu arada değişti — liste yenilendi» (siz bakarken başka biri değiştirdi; yeniden
bakın), «Monitör şeridi bu hastane için çalışmıyor», «Bu monitörü işçi bildirmiyor».

**Yapı ile ilişkisi.** Bir yatağın adını Yapı'da değiştirirseniz monitörün eşlemesi de yeni adı alır
(şerit yeni adı gösterir). **Monitörü bağlı bir yatak kapatılamaz**: önce «Monitörler»de bağlantıyı
çözün. Aynı dilimde Yapı'da iki düzeltme: boş kutunun düğmesi neden tutulduğunu artık görünür biçimde
söyler; oda ekleme kutularının görünür etiketleri ve «yatak, oda eklendikten sonra odanın altında
eklenir» ipucu vardır.

**Kayıt.** Her değişiklik eski ve yeni satırıyla denetim kaydına yazılır (`device_bed.bind`,
`device_bed.unbind`, `device_bed.relabel`); hasta yataklı bir değişiklik o hastanın numarasını taşır,
adını asla. Tablo geçmişi silmez: bir değişiklik eski satırı kapatır, yenisini açar.

```

- [ ] **Step 2: The deploy README.** **Edit** `deploy/infinity/README.md` — replace the heading `## Verification and remaining work` with this section followed by that heading:

```markdown
## The device→bed table lives in the database (G2 monitor→bed editor, 2026-10)

From the editor's deploy on, the strip and Aşama B read the table from `device_beds` (migration
0014), not from `device-beds.json`. The file stays on the VM and in the repo as read-only history.

- **Seed, once:** `docker compose run --rm --no-deps -T api python scripts/import_device_beds.py --tenant <slug> </dev/null`
  checks the file's sha256 against the approved v2 (`84ac1760d59f…`), writes its 13 rows, grants
  `devices.map_beds` to `charge_nurse`, and prints `ESLEME_ICE_AKTARIM {…, "version", "sha256"}`.
  Run again over untouched rows it says `"already": true`; over a table edited since it exits 3.
- **`version` and `sha256`** in `GET /infinity-shadow/board`'s `table` are now `max(id)` of the
  tenant's rows and the SHA-256 of the current rows as `[source, bed_id, bed_label]` (v2's:
  `e470d3342025…`, version 13 on a fresh table). `shadow_check.py --table-version/--table-sha` take
  those values; run it pinned by commit (`git show ade8da8:deploy/infinity/shadow_check.py | ssh …`).
- **Rollback.** R-1 (fast): the `:pre-esleme` images with a compose override whose `command` is the
  old image's own CMD without `alembic upgrade head` — the database stays at 0014, the old code reads
  the file again, binds made since stay in the table and return with the next deploy. R-2 (full):
  `alembic downgrade 0013` with the new image, the grant deleted, the old images with their own
  command. The blocks: `G2B-ESLEME-bloklari.txt`.
- **Summary before and after:** `deploy/infinity/esleme_ozet.py` (standard library, piped to the
  hub's `python3` like `shadow_check.py`).
```

- [ ] **Step 3: `.env.example`.** **Edit** `deploy/local/.env.example` — replace the comment line beginning `# INFINITY_DEVICE_BEDS_PATH is the approved device->bed table inside the container.` with:

```
# INFINITY_DEVICE_BEDS_PATH is the approved device->bed FILE inside the container. Since the
# monitor->bed editor (migration 0014) a Postgres deployment reads the table from the database; the
# file is read only by the lab (no Postgres) and by scripts/import_device_beds.py, once.
```

(keep the lines that follow it as they are; if the original comment runs over two lines, replace both).

- [ ] **Step 4: The roadmap row.** **Edit** `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` — after the `| G2-B1a | …` row, add one row `| G2-ESLEME | Monitör–yatak eşleme (Lane B): … | Kod ✅ <date> · <range> · **VM'de değil** — … |` in the B1a row's manner: what was built (the list, the two-step bind with the occupied-bed step, unbind, Yapı's relabel and `bed_has_monitor`, the table in the database, the import and its grant, 0014 purely additive), the spec, this plan, the counts from `gates.txt` (Task 21), the walk's outcome from `walk/notes.md` (Task 22), the open items (O60 the label case for block D, O61, O62, O66), and "deploy waits for «main'e al» and «onay»".

- [ ] **Step 5: The spec's "as built".** **Edit** `docs/superpowers/specs/2026-10-28-g2b-monitor-yatak-esleme-design.md` — append at the end:

```markdown

## 10. As built (<date>, plan `2026-10-30-g2b-monitor-yatak-esleme.md`)

- Code `<first>..<last>` on `feat/g2b-monitor-esleme`; gates in the plan's Task 21 (`<numbers>`).
- Departures from this spec: the plan's E1–E10 (and any E11 … found while building), each with its
  reason — the package layout, field codes not mapped on screen, `_lock_bed` imported, `check_current`
  over the open rows, the real clock in the downstream tests, the new short-name helper,
  `esleme_ozet.py`, `last_seen_at` from the store's age, the occupancy read with its number, the
  isolation tests' file.
- The walk (`<date>`): `<one line per finding, or "no finding">`; R-1 and R-2 rehearsed.
```

filled from `gates.txt` and `walk/notes.md`.

- [ ] **Step 6: Commit.**

```bash
cd /c/tmp/g2b-esleme
P="docs/homunculus-rehber-TR.md deploy/infinity/README.md deploy/local/.env.example docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md docs/superpowers/specs/2026-10-28-g2b-monitor-yatak-esleme-design.md"
git add -- $P && git status --short && git diff --cached --stat
git commit -F - -- $P <<'EOF'
docs(esleme): the monitor→bed editor — the ward's guide (§3.9), the deploy README, .env.example, roadmap, as built

The Turkish guide says who binds a monitor where and what the two confirmations and «görünmüyor»
mean; the README says the table now lives in the database (import, version/sha, R-1/R-2); the
roadmap row and the spec's "as built" carry the gates and the walk.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```


---

### Task 24: The VM blocks, part 1 — the file's header, A (pre-checks, dump, `:pre-esleme`, the R-1 override) and B (bundle, migrate, import, start)

**Where:** `/c/tmp/infinity-a-releases/G2B-ESLEME-bloklari.txt` (outside the repo), after Tasks 22 and 23, once the slice is on main (the user's «main'e al»). The agent WRITES the blocks; the user pastes them; nothing here runs on the VM. Spec §7.2, §7.3. Model: `G2B1a-bloklari.txt` (structure, wording, `bash -eu -o pipefail <<'BLOK'`, "… TAMAM" last lines, "durdum" = nothing changed). Turkish, as every block file.

**Rules every block keeps** (and the header says): every stdin consumer inside a pasted heredoc — `docker compose exec|run`, `docker exec`, `psql`, `ssh`, `scp` — takes `</dev/null`; a piped `ssh` whose stdin IS the script (shadow_check, esleme_ozet) takes none. A directory listing is compared against `printf '%s\n' <names…> | sort`, never against a hand-ordered literal (Lane A's B-1 lesson, 2026-10-30). No block prints a patient name, number or value, or a token.

**Values the agent fills before handing the file over** (each «…» stops its block if left unfilled): «UC» the main commit to deploy (full sha, the slice merged), «UC7» its short form; «BUNDLE» `esleme-«UC7».bundle` and «BUNDLE_SHA» its sha256; «SLUG» the pilot tenant's slug (the one B1a's D-3 used — read it from `G2B1a-bloklari.txt`, never guess); «API_ID» / «WEB_ID» the running image ids Lane A reported (`efd878b9…`, `26901e49…`, full ids from block A-1's own print).

- [ ] **Step 1: The bundle** (workstation, Git Bash; a clean main checkout as B1a's `/c/tmp/g2-main`):

```bash
git -C /c/tmp/g2-main fetch --quiet && git -C /c/tmp/g2-main checkout --quiet main && git -C /c/tmp/g2-main merge --ff-only --quiet origin/main
git -C /c/tmp/g2-main bundle create /c/tmp/infinity-a-releases/esleme-$(git -C /c/tmp/g2-main rev-parse --short=7 main).bundle cad9bea..main
git -C /c/tmp/g2-main bundle verify /c/tmp/infinity-a-releases/esleme-*.bundle
sha256sum /c/tmp/infinity-a-releases/esleme-*.bundle
```

(`cad9bea` is the VM's HEAD, Lane A's report of NBP-2's deploy; the bundle's prerequisites are its ancestors. If Lane A reports the VM on another commit, use that one.)

- [ ] **Step 2: Write the file's header and groups A and B.** **Write** `/c/tmp/infinity-a-releases/G2B-ESLEME-bloklari.txt` beginning with:

```text
=====================================================================================================
 G2 · LANE B · MONİTÖR–YATAK EŞLEME (Monitörler ekranında düzenleyici) — VM'YE ÇIKIŞ BLOKLARI
 Kod ucu «UC7» (main) · göç 0014 (YALNIZ EKLEYİCİ) · spec 2026-10-28-g2b-monitor-yatak-esleme-design.md §7
=====================================================================================================
BU BLOKLAR, LANE A NBP-2'NİN BİTTİĞİNİ BİLDİRDİKTEN VE KULLANICI «onay» DEDİKTEN SONRA BAŞLAR.
(Tek seferde tek dağıtım; NBP-2 2026-10-30'da dağıtıldı — Lane A bildirdi.)
Her VM bloğunu kullanıcı yapıştırır: ssh -i ~/.ssh/homunculus_vm sysadmin@172.100.101.72
"İş istasyonu" blokları Git Bash'te. "ajan" yazanları ajan koşar (salt okunur).
`bash -eu -o pipefail <<'BLOK'` ilk hatada durur; "durdum" = hiçbir şey değişmedi. Son satır "… TAMAM";
TAMAM gelmeden biten blok, heredoc'u yutan bir komut demektir — ajana sorun, aynı bloğu yeniden yapıştırmayın.
Heredoc içindeki her psql / docker compose exec·run / docker exec / ssh / scp `</dev/null` taşır.
Bir klasör listesi `printf '%s\n' … | sort` ile karşılaştırılır, elle sıralanmış bir metinle asla.
Hiçbir blok hastanın adını, numarasını, bir değerini ya da bir token'ı basmaz.

SIRA: C-0 (ajan, "önce") → A-1 → A-2 → A-3 → B-1 → B-2 → C-1 (ajan, "sonra") → D-0 → D-1 (ekran) → D-2.
      Geri dönüş: R-1 (hızlı) ya da R-2 (tam). Bir bloğun "Beklenen"i görülmeden sonrakine geçilmez.

DEĞERLER
  VM başlangıcı (Lane A, NBP-2 sonrası): kod main cad9bea · api efd878b9… · web 26901e49… · alembic 0013
                            hub R5 transport-c51afb1059de3a08 · drop-in 93, 94, 95 · aşama rules
  Lane A'nın etiketleri     : homunculus-rollback/{api,web}:pre-nbp2 — DOKUNULMAZ
  Bizim etiketlerimiz       : homunculus-rollback/{api,web}:pre-esleme (A-2; çakışırsa durur)
  Göç                       : 0013 → 0014 (yalnız yeni tablo, indeks, fonksiyon, tetikleyici; veri yok)
  İçe aktarım               : 13 satır (12 yataklı, 1 yataksız — BED01) · charge_nurse'a devices.map_beds
                            beklenen sürüm 13 · sha256 e470d3342025… (taze tablo)
  Dosya (tarihçe, değişmez) : deploy/local/infinity-shadow/device-beds.json · sha256 84ac1760d59f…
  shadow_check              : commit'e sabit — ade8da8 (main; 7fe61a9 ile aynı betik)
  Yönlendirme için "önce"   : 6× KABUL · PANO_OZET cb259cc49ef5… · 9 kart, 1 alarm · nbp: 0 zamanlı,
                            5 zamansız, 1 bekleyen (manşonla değişir, bloklar buna göre durmaz) ·
                            gölge motor ok, bağlı 3 yatak: BED06, BED08, BED09 · forwarder 0 başarısız.
                            (C-0 kendi "önce"sini dağıtımdan hemen önce aynı sabit betikle alır.)
  Bundle                    : «BUNDLE» · sha256 «BUNDLE_SHA» · cad9bea..«UC7»
  Kiracı                    : «SLUG»
```

then group A:

```text
=====================================================================================================
 A) VM — ÖN KONTROL, DÖKÜM, GERİ DÖNÜŞ ETİKETLERİ, R-1 DOSYASI
=====================================================================================================
--- A-1 (VM, salt okunur): ön kontrol -------------------------------------------------------------------
bash -eu -o pipefail <<'BLOK'
umask 077
cd /opt/homunculus/deploy/local
A=$HOME/esleme
test "$(ls -A $A | sort)" = "$(printf '%s\n' «BUNDLE» | sort)" || { echo "~/esleme'de bundle'dan başka dosya var ya da bundle yok: durdum"; ls -A $A; exit 1; }
test "$(git -C /opt/homunculus rev-parse HEAD)" = "$(git -C /opt/homunculus rev-parse cad9bea)" || { echo "VM cad9bea'da DEĞİL: durdum, ajana sorun"; exit 1; }
test -z "$(git -C /opt/homunculus status --porcelain --untracked-files=no)" || { echo "İZLENEN DOSYA DEĞİŞMİŞ: durdum"; exit 1; }
echo "«BUNDLE_SHA»  $A/«BUNDLE»" | sha256sum -c -
git -C /opt/homunculus bundle verify $A/«BUNDLE»
test "$(sudo docker compose exec -T postgres psql -U homunculus -d homunculus -Atc 'select version_num from alembic_version' </dev/null)" = 0013 || { echo "alembic 0013 DEĞİL: durdum"; exit 1; }
sha256sum infinity-shadow/device-beds.json | grep -q '^84ac1760d59f' || { echo "DOSYA v2 DEĞİL: durdum"; exit 1; }
for c in homunculus-api homunculus-web; do echo "$c $(sudo docker inspect -f '{{.Image}} {{.Config.Image}}' $c)"; done | tee $A/image-ids-before.txt
CMDJ=$(sudo docker inspect -f '{{json .Config.Cmd}}' homunculus-api)
test "$CMDJ" = '["sh","-c","alembic upgrade head && python scripts/seed_admin.py && exec uvicorn homunculus.api.prodserver:app --host 0.0.0.0 --port 8000"]' || { echo "ÇALIŞAN API'NİN KOMUTU BEKLENEN CMD DEĞİL (R-1 onun üstüne kurulu): durdum, ajana sorun — $CMDJ"; exit 1; }
test "$(sudo docker inspect -f '{{json .Config.Entrypoint}}' homunculus-api)" = null || { echo "API'NİN ENTRYPOINT'İ VAR: durdum, ajana sorun"; exit 1; }
grep -E '^INFINITY_CLINICAL_STAGE=' .env | sed 's/=.*/=…/'; echo "aşama: $(grep -E '^INFINITY_CLINICAL_STAGE=' .env | cut -d= -f2)"
df -h / | tail -1
echo "A-1 TAMAM"
BLOK
Beklenen: "«BUNDLE»: OK", bundle verify ok, image-ids-before.txt iki satır (api efd878b9…, web 26901e49…),
aşama: rules, "A-1 TAMAM".

--- A-2 (VM): veritabanı dökümü ve :pre-esleme etiketleri (üzerine yazmaz) --------------------------------
bash -eu -o pipefail <<'BLOK'
umask 077
cd /opt/homunculus/deploy/local
A=$HOME/esleme
for s in api web; do
  if sudo docker image inspect homunculus-rollback/$s:pre-esleme >/dev/null 2>&1; then echo "homunculus-rollback/$s:pre-esleme ZATEN VAR: durdum"; exit 1; fi
done
sudo docker compose exec -T postgres pg_dump -U homunculus -d homunculus </dev/null | gzip > $A/before-0014.sql.gz
test "$(gzip -dc $A/before-0014.sql.gz | grep -c 'PostgreSQL database dump complete')" = 1 || { echo "DÖKÜM TAMAM DEĞİL: durdum"; exit 1; }
sudo docker tag "$(awk '$1=="homunculus-api" {print $2}' $A/image-ids-before.txt)" homunculus-rollback/api:pre-esleme
sudo docker tag "$(awk '$1=="homunculus-web" {print $2}' $A/image-ids-before.txt)" homunculus-rollback/web:pre-esleme
sudo docker image ls homunculus-rollback --format '{{.Repository}}:{{.Tag}} {{.ID}}' | sort
echo "A-2 TAMAM"
BLOK
Beklenen: before-0014.sql.gz yazıldı; listede :pre-esleme (api efd878b9…, web 26901e49…) ve :pre-nbp2 ile
eskiler; "A-2 TAMAM".

--- A-3 (VM): R-1'in compose dosyası — eski imajın KENDİ komutu, yalnız `alembic upgrade head` çıkarılmış ---
bash -eu -o pipefail <<'BLOK'
umask 077
cat > $HOME/esleme/eski-imaj-0014.yml <<'YML'
services:
  api:
    command: ["sh", "-c", "python scripts/seed_admin.py && exec uvicorn homunculus.api.prodserver:app --host 0.0.0.0 --port 8000"]
YML
cd /opt/homunculus/deploy/local
sudo docker compose -f docker-compose.yml -f $HOME/esleme/eski-imaj-0014.yml config </dev/null | grep -A2 'command:' | head -4
echo "A-3 TAMAM"
BLOK
Beklenen: compose config'te api'nin command'ı "python scripts/seed_admin.py && exec uvicorn …"; entrypoint,
user, işçi sayısı ve sağlık kontrolü imajınki kalır (dosya yalnız command'ı değiştirir); "A-3 TAMAM".
```

then group B:

```text
=====================================================================================================
 B) VM — KOD, GÖÇ 0014, İÇE AKTARIM, YENİ API + WEB
=====================================================================================================
--- B-1 (VM): kodu al ve imajları derle (çalışan konteynerler değişmez) --------------------------------------
bash -eu -o pipefail <<'BLOK'
cd /opt/homunculus
A=$HOME/esleme
for s in api web; do sudo docker image inspect homunculus-rollback/$s:pre-esleme >/dev/null 2>&1 || { echo "A-2 KOŞMAMIŞ: durdum"; exit 1; }; done
test -s $A/eski-imaj-0014.yml || { echo "A-3 KOŞMAMIŞ: durdum"; exit 1; }
git fetch $A/«BUNDLE» main </dev/null
test "$(git rev-parse FETCH_HEAD)" = «UC» || { echo "BUNDLE'IN main'i «UC7» DEĞİL: durdum"; exit 1; }
git merge --ff-only FETCH_HEAD | tail -2
test "$(ls homunculus-engine/alembic/versions | grep -E '^[0-9]{4}_' | tail -1)" = 0014_device_beds.py || { echo "SON GÖÇ 0014 DEĞİL: durdum, ajana sorun"; exit 1; }
cd deploy/local
sudo env BUILD_SHA=«UC7» docker compose build api web > $A/build.log 2>&1 </dev/null || { echo "DERLEME HATALI ($A/build.log): çalışan konteynerler değişmedi, ajana sorun"; exit 1; }
echo "B-1 TAMAM: $(git -C /opt/homunculus rev-parse --short=7 HEAD)"
BLOK
Beklenen: "Fast-forward"; "B-1 TAMAM: «UC7»". Geri alma: `cd /opt/homunculus && git checkout -B main cad9bea` (yalnız kod).

--- B-2 (VM): göç 0014 YENİ imajla, içe aktarım, sonra yeni api + web — ARKA ARKAYA -------------------------
bash -eu -o pipefail <<'BLOK'
cd /opt/homunculus/deploy/local
A=$HOME/esleme
test "$(git -C /opt/homunculus rev-parse HEAD)" = «UC» || { echo "B-1 KOŞMAMIŞ: durdum"; exit 1; }
sudo docker compose run --rm --no-deps -T api alembic upgrade head </dev/null 2>&1 | tail -3
test "$(sudo docker compose exec -T postgres psql -U homunculus -d homunculus -Atc 'select version_num from alembic_version' </dev/null)" = 0014 || { echo "GÖÇ 0014'E VARMADI: eski API hâlâ hizmette, R-2'ye bakın, ajana sorun"; exit 1; }
sudo docker compose run --rm --no-deps -T api python scripts/import_device_beds.py --tenant «SLUG» </dev/null | tee $A/import.txt
grep -q '^ESLEME_ICE_AKTARIM ' $A/import.txt || { echo "İÇE AKTARIM SATIRI YOK: yeni API başlatılmadı; eski API 0014'te hizmet veriyor (yeniden başlarsa R-1 dosyasıyla), ajana sorun"; exit 1; }
python3 - $A/import.txt <<'PY'
import json, sys
line = open(sys.argv[1], encoding="utf-8").read().strip().split(" ", 1)[1]
d = json.loads(line)
ok = (d["rows"], d["with_bed"], d["without_bed"], d["already"]) == (13, 12, 1, False) and d["granted"] in (["charge_nurse"], [])
print("içe aktarım:", {k: d[k] for k in ("rows", "with_bed", "without_bed", "granted", "version", "already")}, "sha12", d["sha256"][:12])
sys.exit(0 if ok else 1)
PY
sudo docker compose up -d api web </dev/null 2>&1 | tail -3
for i in $(seq 1 40); do test "$(sudo docker inspect -f '{{.State.Health.Status}}' homunculus-api)" = healthy && break; sleep 3; done
test "$(sudo docker inspect -f '{{.State.Health.Status}}' homunculus-api)" = healthy || { echo "YENİ API SAĞLIKLI DEĞİL: R-1 ya da R-2, ajana sorun"; exit 1; }
for c in homunculus-api homunculus-web; do echo "$c $(sudo docker inspect -f '{{.Image}} {{.Config.Image}}' $c)"; done | tee $A/image-ids-after.txt
echo "B-2 TAMAM"
BLOK
Beklenen: "Running upgrade 0013 -> 0014"; "içe aktarım: {'rows': 13, 'with_bed': 12, 'without_bed': 1,
'granted': ['charge_nurse'], 'version': 13, 'already': False} sha12 e470d3342025"; api ve web yeniden başladı,
api healthy; "B-2 TAMAM". Göç ile yeni başlatma arasında eski API yeniden başlarsa kendi `alembic upgrade head`'inde
durur (0014'ü tanımaz): ya B-2'yi bitirin ya da R-1'i uygulayın.
```

(The `python3 -` inside the block reads its program from the inner `<<'PY'` heredoc, which bash takes from the block's own text: it is python's stdin, so it takes NO `</dev/null` — a `</dev/null` after it would replace the program with nothing.)

- [ ] **Step 3: Check the file you wrote.** `grep -c "TAMAM\"$" …` equals the number of blocks so far (5); every `«…»` is filled (`grep -n "«" …` prints only the header's explanation lines); every `docker compose run|exec`, `psql` and `ssh` inside a `BLOK` ends with `</dev/null` (`grep -nE "compose (run|exec)|psql|ssh " … | grep -v "</dev/null"` prints only lines outside blocks). Nothing is committed: the file lives outside the repo.


---

### Task 25: The VM blocks, part 2 — C (the strip before and after), D (the live try, O4) and R (R-1, R-2)

**Where:** the same file as Task 24, `/c/tmp/infinity-a-releases/G2B-ESLEME-bloklari.txt`, appended. Spec §7.2 C and D, §7.3 R-1 and R-2 (Lane A's conditions, 2026-10-30), O4, O60. The agent writes; the user pastes the VM blocks; the agent runs the "ajan" ones (read-only, from the workstation).

**The pin.** Every `shadow_check.py` run is `git -C <worktree> show ade8da8:deploy/infinity/shadow_check.py | ssh …` — by commit (`7fe61a9` is the same script), never a branch; `esleme_ozet.py` likewise at «UC». Its "before" and "after" come from the same pinned script (the fixed `PANO_OZET` leaves out each card's `shadow` picture: a hash from the older script is not comparable). The `nbp:` line's counts move with cuff activity: never a stop condition.

- [ ] **Step 1: Append group C.**

```text
=====================================================================================================
 C) ŞERİT — ÖNCE VE SONRA (ajan, salt okunur, iş istasyonundan)
=====================================================================================================
--- C-0 (ajan): "önce" — A-1'den hemen önce ----------------------------------------------------------------
W=/c/tmp/g2-main; K=$HOME/.ssh/homunculus_vm; V=sysadmin@172.100.101.72; R=/c/tmp/infinity-a-releases
git -C $W show ade8da8:deploy/infinity/shadow_check.py | ssh -i $K $V 'python3 - --window 60 --table-version 2 --table-sha 84ac1760d59f' | tee $R/ESLEME-P-once.txt
git -C $W show «UC»:deploy/infinity/esleme_ozet.py | ssh -i $K $V 'python3 - --etiket ONCE' | tee $R/ESLEME-OZET-once.txt
Beklenen: SONUÇ KABUL (aşama rules, tablo ok sürüm 2 sha 84ac1760d59f, atanmamış yok, besleme, gecikme,
gönderim); PANO_OZET kaydedildi (yön için cb259cc49ef5…); gölge motor ok; ESLEME_OZET_ONCE satırı.
(ssh'ın stdin'i boru ile gelen betiktir; `</dev/null` almaz.)

--- C-1 (ajan): "sonra" — B-2 TAMAM'dan en az 1 dk sonra --------------------------------------------------
ssh -i $K $V 'cat ~/esleme/import.txt' </dev/null | tee $R/ESLEME-import.txt
VER=$(sed 's/^ESLEME_ICE_AKTARIM //' $R/ESLEME-import.txt | /c/tmp/f7-py312/venv/Scripts/python.exe -I -c "import json,sys; print(json.load(sys.stdin)['version'])")
SHA=$(sed 's/^ESLEME_ICE_AKTARIM //' $R/ESLEME-import.txt | /c/tmp/f7-py312/venv/Scripts/python.exe -I -c "import json,sys; print(json.load(sys.stdin)['sha256'][:12])")
git -C $W show ade8da8:deploy/infinity/shadow_check.py | ssh -i $K $V "python3 - --window 60 --table-version $VER --table-sha $SHA" | tee $R/ESLEME-P-sonra.txt
git -C $W show «UC»:deploy/infinity/esleme_ozet.py | ssh -i $K $V 'python3 - --etiket SONRA' | tee $R/ESLEME-OZET-sonra.txt
git -C $W show «UC»:deploy/infinity/esleme_ozet.py > $R/esleme_ozet.py
/c/tmp/f7-py312/venv/Scripts/python.exe -I $R/esleme_ozet.py --karsilastir $R/ESLEME-OZET-once.txt $R/ESLEME-OZET-sonra.txt
Beklenen: SONUÇ KABUL ve "tablo ok, sürüm 13, sha256 e470d3342025"; "AYNI" (yataklar, atanmamışlar ve
`link: one` sayısı); PANO_OZET "önce" ile aynı. "FARKLI: link_one" ve arada bir kabul/taburcu olduysa ajan
söyler (beklenen); "FARKLI: beds" ise DURUN → R-1. Ekranda şerit eskisi gibi; «Monitörler»de bölüm görünür.
```

- [ ] **Step 2: Append group D** (O4; O60 decides its second case):

```text
=====================================================================================================
 D) CANLI DENEME (O4) — BOŞ BİR YATAĞIN MONİTÖRÜ ÇÖZÜLÜR, SONRA AYNI YATAĞA BAĞLANIR
=====================================================================================================
--- D-0 (VM, salt okunur): yatağı seç, beklenen sürüm ve sha'yı yaz ------------------------------------------
bash -eu -o pipefail <<'BLOK'
umask 077
cd /opt/homunculus/deploy/local
A=$HOME/esleme
PSQL="sudo docker compose exec -T postgres psql -U homunculus -d homunculus -At -F|"
$PSQL -c "select d.source, d.device_bed_label, d.bed_label, b.label, d.bed_id, (select count(*) from admissions a where a.bed_id = d.bed_id and a.state in ('DRAFT','ACTIVE','PENDING_DISCHARGE','PENDING_TRANSFER_OUT')) from device_beds d join beds b on b.id = d.bed_id join tenants t on t.id = d.tenant_id where t.slug = '«SLUG»' and d.valid_to is null order by d.source" </dev/null > $A/d0-rows.txt
$PSQL -c "select d.source, coalesce(d.bed_id::text,''), coalesce(d.bed_label,'') from device_beds d join tenants t on t.id = d.tenant_id where t.slug = '«SLUG»' and d.valid_to is null" </dev/null > $A/d0-current.txt
VER=$($PSQL -c "select max(d.id) from device_beds d join tenants t on t.id = d.tenant_id where t.slug = '«SLUG»'" </dev/null)
python3 - $A <<'PY'
import hashlib, json, os, sys, urllib.request
a = sys.argv[1]
token = next(l.split("=", 1)[1].strip().strip("'\"") for l in open(".env", encoding="utf-8") if l.startswith("TENANT_TOKEN="))
op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
req = urllib.request.Request("http://172.100.101.72:8080/infinity-shadow/board", headers={"Authorization": "Bearer " + token})
link = {c["source"]: c.get("link") for c in json.loads(op.open(req, timeout=15).read()).get("beds", [])}
rows = [l.rstrip("\n").split("|") for l in open(os.path.join(a, "d0-rows.txt"), encoding="utf-8") if l.strip()]
LINKED = {"BED06", "BED08", "BED09"}
ok = [r for r in rows if r[5] == "0" and link.get(r[0]) == "none" and r[1] != "BED01"]
ok.sort(key=lambda r: (r[1] in LINKED, r[2] != r[3], r[0]))
for r in ok:
    print(f"aday {r[0]} · istasyon {r[1]} · şerit {r[2]} · Yapı {r[3]} · {'etiket AYNI' if r[2] == r[3] else 'etiket FARKLI'}")
if not ok:
    print("BOŞ ADAY YOK: durdum, ajana sorun"); sys.exit(1)
pick = ok[0]
cur = [l.rstrip("\n").split("|") for l in open(os.path.join(a, "d0-current.txt"), encoding="utf-8") if l.strip()]
lists = sorted(([s, b or None, (pick[3] if s == pick[0] else lbl) or None] for s, b, lbl in cur), key=lambda x: x[0])
sha = hashlib.sha256(json.dumps(lists, separators=(",", ":"), ensure_ascii=False).encode("utf-8")).hexdigest()
open(os.path.join(a, "d0.txt"), "w", encoding="utf-8").write(json.dumps({"source": pick[0], "bed": pick[3], "sha": sha}))
print(f"SEÇİLEN {pick[0]} ({pick[1]}) → Yapı «{pick[3]}» · beklenen sha {sha[:12]}")
print("DURUM:", "etiketler AYNI → sha içe aktarımınkine döner" if pick[2] == pick[3]
      else f"etiketler FARKLI («{pick[2]}» ≠ «{pick[3]}») → şeritte «{pick[3]}» okunacak; KULLANICININ SÖZÜ GEREKİR (O60)")
PY
echo "beklenen sürüm: $((VER + 2))"
echo "D-0 TAMAM"
BLOK
Beklenen: adaylar (BED01 hiç; bağlı yataklar BED06, BED08, BED09 en sonda); "SEÇİLEN …"; "DURUM: …";
"beklenen sürüm: <içe aktarım + 2>"; "D-0 TAMAM". DURUM "etiketler FARKLI" ise D-1'e geçmeden önce kullanıcı
seçer (O60): bir etiketin değişmesini kabul etmek, o Yapı yatağını v2 etiketiyle yeniden adlandırmak (eşleme
için değişiklik yok), ya da D'yi atlamak.

--- D-1 (ekran, yönetici): çöz, sonra aynı yatağa bağla -------------------------------------------------------
«Monitörler» › «Monitör–yatak eşleme»: D-0'ın SEÇİLEN monitörünün satırında «Bağlantını aç» → onay; satır
«bağlı deyil», şeritte «atanmamış cihaz». Sonra aynı satırda «Çarpayıya bağla» → D-0'ın yatağı → «Davam» →
«Təsdiqlə»; şerit en geç 5 sn'de monitörü yatağında gösterir. İkinci onay (yatan hasta) ÇIKMAMALI —
çıkarsa «İmtina», durun, ajana sorun.

--- D-2 (VM, salt okunur): denetim satırları, tablo satırları, sürüm ve sha ----------------------------------
bash -eu -o pipefail <<'BLOK'
cd /opt/homunculus/deploy/local
A=$HOME/esleme
PSQL="sudo docker compose exec -T postgres psql -U homunculus -d homunculus -At -F|"
S=$(python3 -c "import json; print(json.load(open('$A/d0.txt'))['source'])")
$PSQL -c "select event_type, subject, patient_id, payload->'old'->>'row_id', payload->'new'->>'row_id', payload->>'reason' from audit where tenant = '«SLUG»' and event_type like 'device_bed.%' and event_type <> 'device_bed.import' order by id" </dev/null
$PSQL -c "select id, coalesce(bed_label,'—'), method, valid_to is null from device_beds where source = '$S' order by id" </dev/null
echo "sürüm şimdi: $($PSQL -c "select max(d.id) from device_beds d join tenants t on t.id = d.tenant_id where t.slug = '«SLUG»'" </dev/null)"
echo "D-2 TAMAM"
BLOK
Beklenen: iki denetim satırı — `device_bed.unbind|<kaynak>||<v2 satırı>|<çözülen satır>|unbound`, sonra
`device_bed.bind|<kaynak>||<çözülen satır>|<yeni satır>|` (patient_id boş); kaynağın üç satırı (v2'ninki kapalı,
çözülen kapalı, yeni `editor` açık); "sürüm şimdi" = D-0'ın beklenen sürümü. Ajan sonra C-1'in shadow_check'ini
`--table-version <yeni sürüm> --table-sha <d0.txt sha'sının ilk 12'si>` ile koşar: KABUL; etiketler AYNI idiyse
bu sha içe aktarımınki (e470d3342025…) ile aynıdır.
```

- [ ] **Step 3: Append group R** — R-1 first (the fast path), then R-2:

```text
=====================================================================================================
 R) GERİ DÖNÜŞ
=====================================================================================================
--- R-1 (VM): HIZLI — eski imajlar, veritabanı 0014'te kalır -------------------------------------------------
bash -eu -o pipefail <<'BLOK'
cd /opt/homunculus/deploy/local
A=$HOME/esleme
test -s $A/eski-imaj-0014.yml || { echo "R-1 DOSYASI YOK (A-3): durdum"; exit 1; }
for s in api web; do sudo docker image inspect homunculus-rollback/$s:pre-esleme >/dev/null 2>&1 || { echo ":pre-esleme YOK ($s): durdum"; exit 1; }; done
test "$(sudo docker compose exec -T postgres psql -U homunculus -d homunculus -Atc 'select version_num from alembic_version' </dev/null)" = 0014 || { echo "alembic 0014 DEĞİL — R-1 0014 içindir; durdum"; exit 1; }
sudo docker tag homunculus-rollback/api:pre-esleme "$(awk '$1=="homunculus-api" {print $3}' $A/image-ids-before.txt)"
sudo docker tag homunculus-rollback/web:pre-esleme "$(awk '$1=="homunculus-web" {print $3}' $A/image-ids-before.txt)"
sudo docker compose -f docker-compose.yml -f $A/eski-imaj-0014.yml up -d --no-build api web </dev/null 2>&1 | tail -3
for i in $(seq 1 40); do test "$(sudo docker inspect -f '{{.State.Health.Status}}' homunculus-api)" = healthy && break; sleep 3; done
test "$(sudo docker inspect -f '{{.State.Health.Status}}' homunculus-api)" = healthy || { echo "ESKİ API SAĞLIKLI DEĞİL: ajana sorun"; exit 1; }
echo "api komutu: $(sudo docker inspect -f '{{json .Config.Cmd}} kullanıcı={{.Config.User}}' homunculus-api)"
python3 - <<'PY'
import json, urllib.request
token = next(l.split("=", 1)[1].strip().strip("'\"") for l in open(".env", encoding="utf-8") if l.startswith("TENANT_TOKEN="))
op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
req = urllib.request.Request("http://172.100.101.72:8080/infinity-shadow/board", headers={"Authorization": "Bearer " + token})
t = json.loads(op.open(req, timeout=15).read()).get("table", {})
print("tablo:", t.get("status"), "sürüm", t.get("version"), "sha", str(t.get("sha256"))[:12])
PY
echo "R-1 TAMAM"
BLOK
Beklenen: api komutu "python scripts/seed_admin.py && exec uvicorn …", kullanıcı=homunculus; "tablo: ok sürüm 2
sha 84ac1760d59f"; "R-1 TAMAM".
R-1 NE BIRAKIR: eski kod eşlemeyi v2 dosyasından okur — şerit dosyanın eşlemesini gösterir, dağıtımdan beri
yapılan bağlamaları görmez; o bağlamalar device_beds'te kalır ve yeni imaj yeniden dağıtılınca geri gelir;
devices.map_beds izni group_permissions'ta kalır (eski kod onu hiçbir token'a koymaz) ve eski İdare › Rollar
sorumlu hemşire sütununu salt okunur gösterir, anahtarı adıyla anar. Veritabanı 0014'te kaldıkça api'nin her
`up`'ı -f $A/eski-imaj-0014.yml ile yapılır.
İLERİ (R-1'den sonra): `sudo docker tag <image-ids-after.txt'teki api/web kimlikleri> <compose adları>`,
`sudo docker compose up -d --no-build api web </dev/null` (geçersiz kılma YOK) — `alembic upgrade head` boş
geçer (0014 zaten uygulanmış); içe aktarım "already": true ya da bağlama yapıldıysa çıkış 3 (bağlamalar kalır).

--- R-2 (VM): TAM — 0013'e iner, izni siler, eski imajlar kendi komutlarıyla ----------------------------------
bash -eu -o pipefail <<'BLOK'
cd /opt/homunculus/deploy/local
A=$HOME/esleme
PSQL="sudo docker compose exec -T postgres psql -U homunculus -d homunculus -Atc"
for s in api web; do sudo docker image inspect homunculus-rollback/$s:pre-esleme >/dev/null 2>&1 || { echo ":pre-esleme YOK ($s): durdum"; exit 1; }; done
sudo docker tag "$(awk '$1=="homunculus-api" {print $2}' $A/image-ids-after.txt)" "$(awk '$1=="homunculus-api" {print $3}' $A/image-ids-after.txt)"
sudo docker compose run --rm --no-deps -T api alembic downgrade 0013 </dev/null 2>&1 | tail -3
test "$($PSQL "select coalesce(to_regclass('public.device_beds')::text, 'yok')" </dev/null)" = yok || { echo "TABLO DURUYOR: durdum, ajana sorun"; exit 1; }
test "$($PSQL "select count(*) from pg_trigger where tgname like 'device_beds_%'" </dev/null)" = 0 || { echo "TETİKLEYİCİ DURUYOR: durdum"; exit 1; }
test "$($PSQL "select count(*) from pg_proc where proname = 'device_beds_history_kept'" </dev/null)" = 0 || { echo "FONKSİYON DURUYOR: durdum"; exit 1; }
test "$($PSQL 'select version_num from alembic_version' </dev/null)" = 0013 || { echo "alembic 0013 DEĞİL: durdum"; exit 1; }
echo "0013: tablo, tetikleyiciler ve fonksiyon yok"
echo "izin silindi: $($PSQL "with d as (delete from group_permissions where permission = 'devices.map_beds' returning 1) select count(*) from d" </dev/null)"
sudo docker tag homunculus-rollback/api:pre-esleme "$(awk '$1=="homunculus-api" {print $3}' $A/image-ids-before.txt)"
sudo docker tag homunculus-rollback/web:pre-esleme "$(awk '$1=="homunculus-web" {print $3}' $A/image-ids-before.txt)"
sudo docker compose up -d --no-build api web </dev/null 2>&1 | tail -3
for i in $(seq 1 40); do test "$(sudo docker inspect -f '{{.State.Health.Status}}' homunculus-api)" = healthy && break; sleep 3; done
test "$(sudo docker inspect -f '{{.State.Health.Status}}' homunculus-api)" = healthy || { echo "ESKİ API SAĞLIKLI DEĞİL: ajana sorun"; exit 1; }
git -C /opt/homunculus checkout -B main cad9bea </dev/null 2>&1 | tail -1
echo "R-2 TAMAM: $(git -C /opt/homunculus rev-parse --short=7 HEAD)"
BLOK
Beklenen: "Running downgrade 0014 -> 0013"; "0013: tablo, tetikleyiciler ve fonksiyon yok"; "izin silindi: 1";
api healthy; "R-2 TAMAM: cad9bea". Sonra ajan C-0'ın shadow_check'ini koşar: tablo sürüm 2, sha 84ac1760d59f.
Dağıtımdan beri yapılan eşleme değişiklikleri tablodan gider; before-0014.sql.gz ve denetim satırları onları tutar.
```

- [ ] **Step 4: Check the whole file.** Every block's last line is "… TAMAM"; no `«…»` is left but the header's explanation; every stdin consumer inside a `BLOK` takes `</dev/null` except the two by design (a piped `ssh … 'python3 -'` and a `python3 -` reading its own inner `<<'PY'` heredoc); no line prints a token (`TENANT_TOKEN` is read inside python, never echoed). Then tell the controller the file is ready, with its path, and that block A waits for «main'e al» and «onay». Nothing is committed.


---


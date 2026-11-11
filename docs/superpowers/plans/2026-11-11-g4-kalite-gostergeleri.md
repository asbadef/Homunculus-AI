# G4-03 «Kalite göstergeleri» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Task 1 runs first, alone** (the permission key both halves read). Then two implementers run the **engine lane** (Tasks 2–6) and the **dashboard lane** (Tasks 7–12) **in parallel, in the same worktree**. Task 13 (docs) and Task 14 (gates) run after both lanes report.

**Goal:** A read-only page `/kalite` «Kalite göstergeleri» for `quality.view` that shows, per unit and over the last 24 hours, 7 or 30 days, the care process the system really records — alarm response (with the unanswered alarms that cleared by themselves counted apart), handover countersignature times, snooze use and its reasons, RRT calls — with every past alarm placed in a unit through its protocol number's admission, and the ones that cannot be placed said out loud.

**Architecture:**
- **Engine:**
  - the key `quality.view` (the 29th), held by the default `auditor` group (migration `0020`, after G3-04's `0019`) and by the system group by rule;
  - `alarm_quality.summarise` gains `unanswered_resolved` (additive; `/alarm-quality` shows it too);
  - a new package `homunculus.quality`: `indicators.py` builds the answer from what was read (pure, no database), `router.py` reads it — the audit trail (capped as `/alarm-quality` is), the board key → unit map from the admissions table (`units_of_keys`), the caller's units and the window's handovers — and serves `GET /quality?days=1|7|30`;
  - the route tables, nginx and the dev server's proxy.
- **Dashboard:**
  - a pure `screens/kalite/kalite.js` turns the one read into "a number, or why not" (Decision 18) and into rows;
  - `KaliteScreen.jsx` words it, under a new `kalite` string namespace, reusing the summary page's words (`ozet.*`);
  - two things move out of the summary page so both pages share one copy: the period read (`usePeriodRead`) and the small words (`words.jsx`);
  - the route goes after `ozet`, as a work screen.

**Tech Stack:**
- Engine: Python 3.14, FastAPI, SQLAlchemy 2 (async), Alembic, pytest.
- Dashboard: React 18, Vitest 2, Testing Library, Tailwind.
- Guide: Turkish Markdown.

**Spec (the contract):** `docs/superpowers/specs/2026-11-11-g4-kalite-gostergeleri-design.md`, committed at `e63bdc9f`. The branch then took main `331df704` (the merge `0a4b3808`: Eczane G3-04 with its migration `0019` and its key `pharmacy.view`); this plan is written for that head. Read the spec whole before your first task.

---

## Plan notes: where the spec meets the code

Each note records a choice this plan makes where the spec and the tree disagree, or where the spec leaves a detail open. The notes bind the implementers. A reviewer who disagrees raises it; the implementer does not improvise.

**N1: Where `GET /quality` lives, and its tables.**
- A new package `homunculus.quality`: `indicators.py` (pure) and `router.py` (the route and `units_of_keys`, the spec's `quality.units_of_keys`), mounted by `create_app` after the protocol router.
- It is a dependency-guarded router (`require_permission`, `caller_tenant_id`, `get_db`), so it goes into `tests/test_route_permissions.py`: `GUARDED_MODULES` gains `homunculus.quality.router`, `EXPECTED` goes **75 → 76**. `BOARD_EXPECTED` (27, `homunculus.api.app` routes) does not change. `tests/test_tenant_isolation.py` covers it by its own rule (it resolves `caller_tenant_id`).
- It reads the audit trail through `request.app.state.audit` under the token's tenant **slug** (`principal.tenant`): the trail's `tenant` is the slug (a JWT `Caller.hospital` is the slug, `api/prodserver.py`). The read runs on a worker thread (`asyncio.to_thread`), so the ward's screens keep the event loop.

**N2: The cap.** `READ_CAP = ALARM_QUALITY_LIMIT_MAX` (20 000), imported from `api/app.py`; one row more is read to know `truncated`. There is no `limit` parameter (the spec names `days` only). The read covers `QUALITY_KINDS` = `EPISODE_KINDS` ∪ {`alert_snooze`, `rrt_call`}, so snoozes and RRT calls share the cap with the episodes.

**N3: `window_from`.** Always an ISO string. Not truncated: the period's start, `now − days`. Truncated: the `ts` of the oldest audit row kept — the alarms, snoozes and RRT calls count from there. The handovers always count from `now − days` (their own table). The page's truncated note names both.

**N4: `days`.** An integer, 7 by default, one of 1, 7, 30; any other integer is a 422 «days 1, 7 ya da 30 olmalı», a non-integer FastAPI's own 422. The permission is checked first: without `quality.view` the answer is 403 whatever `days` says. `days=1` is the last 24 hours.

**N5: `unanswered_resolved` — narrower than the spec's parenthesis, for the owner to confirm.**
- Counted only among the settled unanswered episodes (a subset of `unanswered`; a pending one is not counted).
- An episode counts when its rule itself stopped: an `alert_cleared` row with reason `resolved` (a new, additive flag, `Episode.self_resolved`). `build_episodes`' rules — episodes, answers, escalations, `resolved_at`, `ended_at` — do not change.
- The spec says «`resolved_at` set, never answered». But `build_episodes` also sets `resolved_at` (when none was set) on a discharge (`discharged`) or an «entered in error» close: the patient left, or the value was withdrawn — not the alarm clearing by itself. Counting those would print «kendiliğinden düzeldi» for something that did not happen. A latched critical nobody answered counts: its rule stopped.

**N6: Placing.**
- The key → unit map reads the caller tenant's admissions **of every state** (a past alarm's patient is usually discharged): `protocol_no` is the key, or (legacy) the patient's `patient_number` when `protocol_no` is null. A key whose admissions name two units is ambiguous and left out; a key with none is left out. Keys are looked up 2 000 at a time (asyncpg's parameter limit).
- Snoozes and RRT calls are placed by their row's `patient_id` through the same map.
- An unrestricted caller's key placed in a unit she does not list (impossible by the foreign keys; defensive) counts as unplaced, never lost.

**N7: Scope.** `unitscope.caller_scope(db, user.id, caller_tenant)`; `unitscope.unit_clause` filters the units list and the handovers (a bed grant names a bed, not its unit). The answer carries a top-level **`scoped: bool`** (the spec's "`scoped: true` flag"): `not scope.unrestricted`.
- Unrestricted (the administrator; the auditor, who has no grants, while `SCOPE_ENFORCE_UNASSIGNED` is off — the pilot's state): every unit with something to count, and `unplaced`.
- Scoped: her unit grants' units; `unplaced` is null; `coverage` counts her units' episodes only (`episodes = placed`, `unplaced = 0`); `hospital` sums what she got.
- Reaching nothing: `units: []`, zeros and nulls in `hospital`, `scoped: true`; the page says «Kapsamınızda birim yok».

**N8: Unit names and order.** `Unit.name` of the tenant's units (through `Site.tenant_id`), closed units included: a past alarm in a unit closed since is still that unit's. Sorted by name (case-folded), then id. A unit with no episode, snooze, RRT call or handover in the window is left out.

**N9: Medians and p90s.** Each group goes through `alarm_quality.summarise` unchanged. `hospital.alarms` is computed over **every episode the caller may see** (her units' plus, unrestricted, the unplaced) — never a mean of the units' medians. The handover times and the snooze minutes use the same rules: median rounded to 0.1, p90 by nearest rank.

**N10: Snoozes.** The engine snoozes only `high` and `moderate` (`api/snooze.py` `SNOOZE_CAPS`), so `by_severity` always has those two keys, and `by_reason` always the five codes (`SNOOZE_REASONS`), zeros included. A row with another value counts in `count` only. A snooze's `reason_text` and an RRT call's `reason` (free text) are never read.

**N11: Handovers.** `opened`: `bridge_opened_at` inside the window. `countersigned`: COMPLETED. `waiting`: OUTGOING_SIGNED. `expired`: EXPIRED, or OPEN past its 30-minute bridge (as `GET /handovers` reads it). An OPEN one still inside its bridge is opened and nothing else yet. The countersign time is `incoming_signed_at − outgoing_signed_at`, over the COMPLETED ones with both.

**N12: The answer's form.** A dict built by `indicators.build_report`, with its keys pinned by tests (as `/alarm-quality` returns a dict); no pydantic model. `per_kind` is a list, as `/alarm-quality`'s, sorted by episodes (most first): `kind`, `episodes`, `answered`, `escalated`, `unanswered`, `median_response_sec`.

**N13: nginx and the dev server.** `quality` joins the API `location` regex after `pharmacy`. The access-log map needs no line: `/quality` has no parameter and no catch-all prefix takes it, so `default $uri` logs it as it is. `dashboard/vite.config.js` gains `/quality` in Task 6, with nginx, because `src/devProxy.test.js` holds the two lists to each other.

**N14: The migration.** `0020_quality_view`, `down_revision = "0019"`. It inserts `quality.view` for every group whose slug is `auditor` (`GROUP`), `ON CONFLICT DO NOTHING`; the downgrade deletes the key from every group, as 0017 and 0019 do. A no-DB test holds `GROUP` and the revision ids to `DEFAULT_GROUPS`. The auditor's default description «Salt okunur: pano ve denetim kaydı.» is not changed (owner note).

**N15: The icon and the names.** `star`, the prototype's own icon for «quality» (`tasarim-taslaklari/app/shell.js`), used by no route. The rail's short labels «Kalite» / «Keyfiyyət» / «Качество» / «Quality» are unique in each language.

**N16: The route.** `{ id: "kalite", path: "/kalite", icon: "star", labelKey: "kalite.nav", shortKey: "kalite.navShort", perms: ["quality.view"], work: true, nav: "main" }`, after `ozet`, before `settings`: devir → eczane → ozet → kalite → settings. The auditor's home stays «Yataklar»; a session holding `quality.view` alone lands on `/kalite`. `routes.test.js` keeps its one pinned tail, now in the kalite block: `slice(-4)` = `["eczane", "ozet", "kalite", "settings"]`; the summary block asserts only that `kalite` follows `ozet`.

**N17: What the quality page shares with the summary page.**
- `usePeriodRead` is `useQuality`'s body with the read and the check as parameters; `useQuality` becomes one use of it. The summary page's tests run unchanged.
- `screens/ozet/words.jsx` holds `PERIOD_KEYS`, `durationText` and `Missing`, which `OzetScreen.jsx` defined for itself; it imports them now.
- `kalite.js` imports `durationOf`, `readSource`, `WHY`, `PERIODS`, `DEFAULT_PERIOD` from `ozet.js`. Strings reused, so one thing has one name on both pages: `ozet.period.*`, `ozet.why.*`, `ozet.asOf`, `ozet.refresh`, `ozet.q.sec`, `ozet.q.minSec`, `ozet.q.unsettled`, `ozet.q.noAnswered`; the snooze reasons are the alarm screen's own `ertele.reason.*`; the severities `risk.*` are not needed (the split line has its own words).

**N18: The page.**
- «HH:MM itibarıyla» is the answer's `generated_at`, the server's clock.
- «Yenile» reads the same period again (`usePeriodRead`'s `retry`); it is also the way to read again after a failure (no second button). Never a timer.
- The cards are the answer's `hospital`: «Hastane geneli · {dönem}», for a scoped caller «Kapsamınızdaki birimler · {dönem}».
- A unit's name in the table is a button (`aria-pressed`) that selects it; «Birimi belli olmayan» and «Toplam» can be selected too; «Toplam» is selected on open; a selection the newest answer no longer holds falls back to «Toplam».
- «Erteleme nedenleri»: a column for the hospital (or her units) and, once a row other than «Toplam» is selected, one for that row; then a «Toplam» row and an «Ortanca süre» row. A half minute is written with a decimal comma in tr, az and ru.
- A rate over nothing is «— henüz yerleşen yok», a median over nothing «—» in a cell and «— yanıtlanan yok» / «— karşı imzalanan yok» on a card. A missing source (loading, failed, refused, malformed) is «—» and its reason on every card and in place of the table, never 0. An answer of the wrong shape — one bad figure — is a failed read.

**N19: The spec's Turkish, adjusted where a suffix would be glued to a number** (the summary page's rule, tested): «{episodes} alarmın {placed}'i» → «{episodes} alarm olayından {placed} tanesi»; «{n}'i kendiliğinden düzeldi» → «{n} tanesi kendiliğinden düzeldi». The truncated note says what it limits (alarms, snoozes and RRT calls; the handovers are whole) and drops «{window_from}'dan». The rate is a whole percent, `kalite.pct`: tr «%82», az and en «82%», ru «82 %» (listed in `NEUTRAL`: no Cyrillic word in it).

**N20: The guide section is §3.25**, right after §3.24 (before the `---` that precedes «## 4.»); §3.5's count goes 28 → 29.

---

## Execution rules (both lanes; read before Task 0)

- **Code exploration:**
  - `graphify-out/graph.json` lives in the main checkout `C:/Users/User/Desktop/Project/Homunculus AI` and was built from an older branch.
  - Before your first grep or source read for a codebase question, run `graphify query "<question>"` from that directory: `cd "/c/Users/User/Desktop/Project/Homunculus AI" && graphify query "..."`. Then read the **worktree's** files (`C:\tmp\g4-kalite`) for the current lines.
  - Use `graphify path "<A>" "<B>"` or `graphify explain "<concept>"` for focused questions.
  - **Never run `graphify update`.**
- **Tests run in the FOREGROUND only.**
  - Never background a test run and wait on it. Split a long run into chunks instead (the gates do).
  - Report before you wait on anything.
- **Engine tests** run from `C:\tmp\g4-kalite\homunculus-engine`, always written out in full (shell variables do not persist between tool calls):
  `"/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest <paths> -q -p no:cacheprovider`
  pytest's `pythonpath = ["src", "tests"]` (pyproject) puts the worktree's `src` ahead of the venv's editable install of the main checkout; Task 0 checks it.
- **Dashboard tests** run from `C:\tmp\g4-kalite\dashboard`: `npx vitest run <files>`. `node_modules` is a junction and is already present. Two vitest runs at once on the shared junction (another session's included) can fail with «Vitest failed to find the current suite»: run again, it is not a code error.
- **Never:**
  - `npm install` or `pip install`;
  - set `DATABASE_URL`. DB tests use `TEST_DATABASE_URL`, and only on the throwaway Postgres below;
  - run `tests/test_infinity_vm_pilot.py`.
- **Git:**
  - Never a bare `git stash`. Never `git add -A`, never `git commit -a`.
  - Every commit names its paths, run from `C:\tmp\g4-kalite`:
    `git add <paths>`, then `git commit -m "<subject>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- <paths>`.
    The pathspec matters: the other lane may have files staged at the same moment, and `git commit -- <paths>` commits only yours. A new file must be `git add`ed before the pathspec commit can name it.
  - If `.git/index.lock` exists, the other lane is committing: wait a few seconds and retry. **Never delete it.**
- **Line endings and editing:** `core.autocrlf=true`, so tracked files are CRLF in the working tree.
  - Edit existing files with the **Edit** tool, or with a `python -I -X utf8` script that writes `\r\n`.
  - Create new files with the **Write** tool.
  - **Never** write code with a Bash heredoc: the Bash tool mangles backslashes in heredocs.
- **Find blocks:** every **find** block below occurs **exactly once** in its file at that point of the plan (checked on a scratch copy of `0a4b3808` when the plan was written, by applying the plan's own blocks in order). If one does not match, stop and report; do not guess.
- **No patient data:** synthetic ids only (`S-001`, `S-HIS-1`, `202600000101`, `192.0.2.x`), synthetic names (`Ayşe Sentetik`, `Sentetik Hasta`).
- Do not push. Do not merge. Do not touch the VM.

### The throwaway Postgres (DB-backed tests: Tasks 4, 5 and 14)

The DB tests drop every table, so they run only against a private, disposable database. **Never use the shared `56432`.** Each line is one foreground tool call, from `C:\tmp\g4-kalite\homunculus-engine`:

```bash
docker run -d --rm --name kalite-pg -p 127.0.0.1:56453:5432 -e POSTGRES_PASSWORD=ozet -e POSTGRES_DB=ozet postgres:16
timeout 60 bash -c 'until docker exec kalite-pg createdb -U postgres ozet_test 2>/dev/null; do :; done'
TEST_DATABASE_URL=postgresql+asyncpg://postgres:ozet@127.0.0.1:56453/ozet_test "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest <paths> -q -p no:cacheprovider
docker stop kalite-pg
```

- `pg_isready` answers before the server is really up (during its init it restarts); retrying `createdb` until it succeeds is the reliable wait.
- If `docker ps` fails, Docker Desktop is not running: say so and do the steps that need no database first.
- The `TEST_DATABASE_URL=… python …` prefix sets the variable for that one command only. The database name must contain `test` (`tests/conftest.py` refuses any other).
- Run one pytest at a time against it: two concurrent runs corrupt each other.
- Always `docker stop kalite-pg` at the end, even after a failure. `--rm` then deletes it.

## Order, lanes and file ownership

1. **Task 0** (each implementer): preflight.
2. **Task 1** (engine implementer, **alone, first**): the key `quality.view`. After its commit, three dashboard tests go red until Task 7 by design, because they read `permissions.py` as text: `catalogue.test.js`, `admin.testutil.test.js` and `RolesTab.test.jsx`.
3. **In parallel:** the engine lane (Tasks 2→3→4→5→6) and the dashboard lane (Tasks 7→8→9→10→11→12). The two lanes share **no file**.
4. **Task 13** (docs), then **Task 14** (gates).

| Lane | Tasks | Files (only these) |
|---|---|---|
| Engine | 1–6 | `homunculus-engine/src/homunculus/auth/permissions.py`, `homunculus-engine/tests/test_permissions.py`, `homunculus-engine/src/homunculus/api/alarm_quality.py`, `homunculus-engine/tests/test_alarm_quality.py`, `homunculus-engine/src/homunculus/quality/__init__.py` (new), `homunculus-engine/src/homunculus/quality/indicators.py` (new), `homunculus-engine/tests/test_quality_indicators.py` (new), `homunculus-engine/src/homunculus/quality/router.py` (new), `homunculus-engine/src/homunculus/api/app.py`, `homunculus-engine/tests/test_quality_api.py` (new), `homunculus-engine/alembic/versions/0020_quality_view.py` (new), `homunculus-engine/tests/test_migration_0020_quality_view.py` (new), `homunculus-engine/tests/test_route_permissions.py`, `homunculus-engine/tests/test_nginx_routes.py`, `deploy/local/web/nginx.conf`, `dashboard/vite.config.js` |
| Dashboard | 7–12 | `dashboard/src/live/i18n/strings/kalite.js` (new), `dashboard/src/live/i18n/kalite.strings.test.js` (new), `dashboard/src/live/i18n/catalog.js`, `dashboard/src/live/i18n/strings.test.js`, `dashboard/src/live/i18n/strings/perms.js`, `dashboard/src/live/screens/admin/catalogue.js`, `dashboard/src/live/screens/admin/admin.testutil.js`, `dashboard/src/backendApi.js`, `dashboard/src/backendApi.test.js`, `dashboard/src/live/session/testTokens.testutil.js`, `dashboard/src/live/screens/ozet/words.jsx` (new), `dashboard/src/live/screens/ozet/useSummaryReads.js`, `dashboard/src/live/screens/ozet/useSummaryReads.test.js`, `dashboard/src/live/screens/ozet/OzetScreen.jsx`, `dashboard/src/live/screens/kalite/kalite.testutil.js` (new), `dashboard/src/live/screens/kalite/kalite.test.js` (new), `dashboard/src/live/screens/kalite/kalite.js` (new), `dashboard/src/live/screens/kalite/KaliteScreen.test.jsx` (new), `dashboard/src/live/screens/kalite/KaliteScreen.jsx` (new), `dashboard/src/live/shell/routes.js`, `dashboard/src/live/shell/routes.test.js`, `dashboard/src/live/rawKeys.test.jsx` |
| Docs (after both) | 13 | `docs/homunculus-rehber-TR.md` |
| Gates (last) | 14 | none (fixes go back to the owning lane) |

The dashboard lane never needs the engine running: its tests use fixtures in the contract's shape below. `dashboard/vite.config.js` is the engine lane's, in Task 6: it changes with nginx.

## The shared contract

**`quality.view`** (Task 1; mirrored by Task 7):

| Where | Text |
|---|---|
| `auth/permissions.py` `PERMISSIONS["quality.view"]`, appended after `pharmacy.view` (the 29th key) | `"Open the Kalite göstergeleri page and read per-unit care-process indicators (GET /quality), as counts and times only"` |
| `catalogue.js` `PERMISSION_KEYS` | `"quality.view"`, last |
| `admin.testutil.js` `PERMISSION_TEXTS["quality.view"]` | the same English text, word for word |
| `perms.js` `quality.view` | tr «Kalite göstergelerini görür» · az «Keyfiyyət göstəricilərini görür» · ru «Видит показатели качества» · en «See the quality indicators» |
| Default groups | `auditor` («Denetçi»): `DEFAULT_GROUPS` for a tenant made later, migration `0020` for the ones seeded before; `hospital_admin` by rule |

**`GET /quality?days=1|7|30`** (Tasks 3–4), guard `quality.view`, the caller's tenant (`caller_tenant_id`) and units:

| Field | Type | Example | Meaning |
|---|---|---|---|
| `days` | 1 \| 7 \| 30 | `7` | the period asked for (`days=1`: the last 24 hours); another value is a 422 |
| `generated_at` | string (ISO) | `"2026-11-11T10:42:00+00:00"` | the server's time; the page's «HH:MM itibarıyla» |
| `window_from` | string (ISO) | `"2026-11-04T10:42:00+00:00"` | the period's start; when `truncated`, the oldest audit row kept (N3) |
| `truncated` | boolean | `false` | the audit read hit the cap (N2) |
| `scoped` | boolean | `false` | the caller is not unrestricted: only her unit grants' units (N7) |
| `coverage` | `{episodes, placed, unplaced}`, integers ≥ 0 | `{"episodes": 9, "placed": 7, "unplaced": 2}` | how many alarm episodes could be tied to a unit; a scoped caller's: her units' only (`episodes = placed`, `unplaced = 0`) |
| `units` | array of unit blocks | `[{…}]` | by name, then id; a unit with nothing is left out |
| `units[].unit_id` | string (UUID) | `"33333333-3333-4333-8333-333333333301"` | the unit |
| `units[].unit_name` | string | `"Reanimasiya"` | its name (a closed unit's too) |
| `units[].alarms` | alarms block | see below | the unit's episodes |
| `units[].snoozes` | snoozes block | see below | the unit's snoozes |
| `units[].rrt` | `{count}` | `{"count": 1}` | the unit's RRT calls (the free-text reason is never sent) |
| `units[].handovers` | handovers block | see below | the unit's handovers opened in the window |
| `unplaced` | `{alarms, snoozes, rrt}` \| null | `{…}` | what no unit could be tied to; null for a scoped caller; no handovers (each has a unit) |
| `hospital` | `{alarms, snoozes, rrt, handovers}` | `{…}` | the sum the caller may see (N9) |

The **alarms block** (`summarise`' rules, per group):

| Field | Type | Example |
|---|---|---|
| `episodes`, `answered`, `escalated`, `unanswered`, `pending` | integers ≥ 0 | `6`, `3`, `1`, `2`, `1` |
| `unanswered_resolved` | integer ≥ 0, ≤ `unanswered` | `1` (N5) |
| `answered_rate` | number 0–1 \| null | `0.6` (null when nothing settled) |
| `median_response_sec`, `p90_response_sec` | number ≥ 0 \| null | `180.0`, `600.0` (null with nothing answered) |
| `per_kind` | array of `{kind, episodes, answered, escalated, unanswered, median_response_sec}` | `[{"kind": "news2", "episodes": 3, "answered": 2, "escalated": 0, "unanswered": 0, "median_response_sec": 120.0}]` |

The **snoozes block**: `count` (integer); `by_reason` — exactly the five codes `ARTEFACT_OR_SIGNAL_NOISE`, `CLINICAL_DECISION_MADE`, `OTHER`, `PATIENT_BASELINE`, `PROCEDURE_IN_PROGRESS` → integer; `by_severity` — `high`, `moderate` → integer; `median_minutes` — number \| null. Example: `{"count": 2, "by_reason": {"ARTEFACT_OR_SIGNAL_NOISE": 0, "CLINICAL_DECISION_MADE": 1, "OTHER": 1, "PATIENT_BASELINE": 0, "PROCEDURE_IN_PROGRESS": 0}, "by_severity": {"high": 1, "moderate": 1}, "median_minutes": 12.5}`.

The **handovers block**: `opened`, `countersigned`, `waiting`, `expired` (integers ≥ 0); `median_countersign_sec`, `p90_countersign_sec` (number \| null). Example: `{"opened": 6, "countersigned": 2, "waiting": 1, "expired": 2, "median_countersign_sec": 600.0, "p90_countersign_sec": 900.0}`.

- 403 without `quality.view`; 422 for another `days`; 503 if the app has no audit trail.
- No patient key, no person, no free text anywhere in the answer (tested in both Task 3 and Task 4).
- `dashboard/src/live/screens/kalite/kalite.testutil.js` `ANSWER` (Task 10) is the engine's own answer for the synthetic trail of `tests/test_quality_indicators.py` (Task 3).

**`GET /alarm-quality`** (Task 2): gains `unanswered_resolved`; no other field changes (a test pins the key set).

## File map

**Engine**
- `auth/permissions.py`: `quality.view`; the auditor's default (Task 1).
- `api/alarm_quality.py`: `Episode.self_resolved`, `AlarmQuality.unanswered_resolved` (Task 2).
- `quality/__init__.py`, `quality/indicators.py` (new, pure: `QUALITY_KINDS`, `HandoverFacts`, `Reach`, `alarms_of`, `snoozes_of`, `handovers_of`, `build_report`) (Task 3).
- `quality/router.py` (new: `QUALITY_VIEW`, `QUALITY_DAYS`, `READ_CAP`, `units_of_keys`, `GET /quality`); `api/app.py` mounts it (Task 4).
- `alembic/versions/0020_quality_view.py` (new) (Task 5).
- Tests:
  - `test_permissions.py` (Task 1);
  - `test_alarm_quality.py` (Task 2);
  - `test_quality_indicators.py` (new, no DB) (Task 3);
  - `test_quality_api.py` (new, DB-backed) (Task 4);
  - `test_migration_0020_quality_view.py` (new; one no-DB test, three DB-backed) (Task 5);
  - `test_route_permissions.py`, `test_nginx_routes.py` (Task 6).
- `deploy/local/web/nginx.conf`, `dashboard/vite.config.js`: the proxied path (Task 6).

**Dashboard**
- `i18n/strings/kalite.js` (new) and its entries in `catalog.js`; `i18n/kalite.strings.test.js` (new); one `NEUTRAL` line in `strings.test.js` (Task 7).
- `perms.js`, `catalogue.js`, `admin.testutil.js`: the key's mirrors (Task 7).
- `backendApi.js` `qualityIndicators(days)`, its test, and `fakeApi`'s mock (Task 8).
- `screens/ozet/useSummaryReads.js` `usePeriodRead`; `screens/ozet/words.jsx` (new); `OzetScreen.jsx` imports them (Task 9).
- `screens/kalite/kalite.js` (new, pure), `kalite.test.js` and `kalite.testutil.js` (new) (Task 10).
- `screens/kalite/KaliteScreen.jsx` and `KaliteScreen.test.jsx` (new) (Task 11).
- `shell/routes.js`, `shell/routes.test.js`, `rawKeys.test.jsx` (Task 12).

**Docs**
- `docs/homunculus-rehber-TR.md`: §3.25, and the permission count in §3 «İzin» (Task 13).

---

## Task 0: Preflight (each implementer, once)

**Files:** none.

- [ ] **Step 1: Check the worktree**

Run: `cd /c/tmp/g4-kalite && git status --short && git log --oneline -2`
Expected: no changes listed, on branch `feat/g4-kalite`. The head is this plan's commit; its parent is `0a4b3808 merge origin/main 331df704 …`.

- [ ] **Step 2 (engine lane): Check that pytest imports the worktree's code**

Run: `cd /c/tmp/g4-kalite/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -c "import sys; sys.path.insert(0, 'src'); import homunculus; print(homunculus.__file__)"`
Expected: `C:\tmp\g4-kalite\homunculus-engine\src\homunculus\__init__.py`. Anything under `Desktop\Project` means the tests would exercise the main checkout: stop and report.

- [ ] **Step 3 (dashboard lane): Check the toolchain**

Run: `cd /c/tmp/g4-kalite/dashboard && ls node_modules/.bin/vitest && npx vitest run src/live/shell/routes.test.js`
Expected: the file exists, and `Tests 46 passed (46)`.

- [ ] **Step 4: Run graphify once for your lane** (rule above). For example:
  - engine: `graphify query "alarm_quality build_episodes summarise unitscope caller_scope unit_clause admissions protocol_no handovers"`;
  - dashboard: `graphify query "ozet useQuality readSource durationOf routes lazyScreen catalogue PERMISSION_KEYS"`.

The graph predates these files, so expect little; read the worktree after.

---

# Engine lane

## Task 1 (engine, first and alone): the key `quality.view`, held by the default auditor group

**Files:**
- Modify: `homunculus-engine/src/homunculus/auth/permissions.py` (end of `PERMISSIONS`, after `pharmacy.view`; the `auditor` entry of `DEFAULT_GROUPS`)
- Test: `homunculus-engine/tests/test_permissions.py` (`SPEC_KEYS`, the count test, the legacy-rights test, `SPEC_GROUPS`, the pharmacy test's order line, end of file)

- [ ] **Step 1: Write the failing tests**

In `homunculus-engine/tests/test_permissions.py`, find:

```python
    "pharmacy.view",      # G3-04 Eczane (spec D2): the page, GET /pharmacy
}


def test_the_catalogue_is_exactly_the_specified_twenty_eight_keys():
    assert len(SPEC_KEYS) == 28
```

Replace with:

```python
    "pharmacy.view",      # G3-04 Eczane (spec D2): the page, GET /pharmacy
    "quality.view",       # G4-03 Kalite göstergeleri (spec D2, D3): the page, GET /quality
}


def test_the_catalogue_is_exactly_the_specified_twenty_nine_keys():
    assert len(SPEC_KEYS) == 29
```

Then find:

```python
    assert by_slug["auditor"] == {"board.view", "audit.view"}
```

Replace with:

```python
    assert by_slug["auditor"] == {"board.view", "audit.view", "quality.view"}     # + G4-03 (spec D2)
```

Then find:

```python
    "auditor": (False, False, {"board.view", "audit.view"}),
    "platform_support": (True, False, {"audit.view", "devices.manage"}),
```

Replace with:

```python
    "auditor": (False, False, {"board.view", "audit.view", "quality.view"}),     # G4-03 (spec D2)
    "platform_support": (True, False, {"audit.view", "devices.manage"}),
```

Then find (the end of the file):

```python
    assert PERMISSIONS["pharmacy.view"].endswith("read-only")
    assert list(PERMISSIONS)[-1] == "pharmacy.view"          # appended after summary.view: the mirrors' order
```

Replace with:

```python
    assert PERMISSIONS["pharmacy.view"].endswith("read-only")
    keys = list(PERMISSIONS)                                 # G4-03: quality.view is the last key now
    assert keys[keys.index("summary.view") + 1] == "pharmacy.view"   # appended after summary.view: the mirrors' order


def test_the_quality_indicators_are_the_auditors_and_the_system_administrators_by_default():
    """G4-03 (spec D2, D7): `quality.view` is in the default auditor group («Denetçi») — migration 0020 gives it to
    the tenants seeded before it, `DEFAULT_GROUPS` to the ones made after — and the system group holds it by rule.
    Any other group can be given it on the Roles screen."""
    holders = {g["slug"] for g in DEFAULT_GROUPS if "quality.view" in g["permissions"]}
    assert holders == {"hospital_admin", "auditor"}
    assert PERMISSIONS["quality.view"].startswith("Open the Kalite göstergeleri page")
    assert list(PERMISSIONS)[-1] == "quality.view"           # appended after pharmacy.view: the mirrors' order
```

(`SPEC_GROUPS["hospital_admin"]` is built from `SPEC_KEYS`, so the spec-table test follows on its own.)

- [ ] **Step 2: Run them to see them fail**

Run: `cd /c/tmp/g4-kalite/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_permissions.py -q -p no:cacheprovider`
Expected: `5 failed, 17 passed`:
- `test_the_catalogue_is_exactly_the_specified_twenty_nine_keys`;
- `test_hospital_admin_holds_every_permission`;
- `test_the_legacy_rights_are_preserved_group_by_group`;
- `test_every_default_group_matches_the_spec_table_exactly`;
- `test_the_quality_indicators_are_the_auditors_and_the_system_administrators_by_default`.

- [ ] **Step 3: Add the key, and give it to the auditor group**

In `homunculus-engine/src/homunculus/auth/permissions.py`, find:

```python
    "pharmacy.view": "Open the Eczane page: per patient in one's own units — vasopressors, the "
                     "antibiotic clock, creatinine and the day's fluid balance; read-only",
}
```

Replace with:

```python
    "pharmacy.view": "Open the Eczane page: per patient in one's own units — vasopressors, the "
                     "antibiotic clock, creatinine and the day's fluid balance; read-only",

    # G4-03 — Kalite göstergeleri (spec D2, D3): per-unit care-process indicators. The default auditor group holds
    # it (migration 0020 for the tenants seeded before it); the system group holds it by rule.
    "quality.view": "Open the Kalite göstergeleri page and read per-unit care-process indicators "
                    "(GET /quality), as counts and times only",
}
```

(The dashboard's `admin.testutil.test.js` folds the two adjacent strings into one: keep each on a line that begins with spaces and a `"`, and end the entry with `",`.)

Then find:

```python
     "mfa_required": False, "is_system": False, "permissions": ("board.view", "audit.view")},
```

Replace with:

```python
     # G4-03 (spec D2, D7): + `quality.view`, the Kalite göstergeleri page; migration 0020 for the tenants seeded before.
     "mfa_required": False, "is_system": False, "permissions": ("board.view", "audit.view", "quality.view")},
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd /c/tmp/g4-kalite/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_permissions.py tests/test_merge_permissions.py tests/test_groups_service.py -q -p no:cacheprovider`
Expected: `37 passed, 27 skipped` (the skips are DB-backed).

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g4-kalite && git add homunculus-engine/src/homunculus/auth/permissions.py homunculus-engine/tests/test_permissions.py && git commit -m "feat(auth): G4-03 quality.view — the Kalite göstergeleri's key (the 29th, after pharmacy.view), held by the default auditor group (migration 0020 for the tenants seeded before) and by the system group by rule" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/src/homunculus/auth/permissions.py homunculus-engine/tests/test_permissions.py
```

Then tell the dashboard implementer that Task 1 is committed: the lanes may start.

---

## Task 2 (engine): `unanswered_resolved` — the unanswered alarms that cleared by themselves

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/alarm_quality.py` (`Episode`, `AlarmQuality`, `build_episodes`' `alert_cleared` branch, `summarise`' unanswered branch)
- Test: `homunculus-engine/tests/test_alarm_quality.py` (a new class before `TestTheBreakdown`; a new endpoint test)

- [ ] **Step 1: Write the failing tests**

In `homunculus-engine/tests/test_alarm_quality.py`, find:

```python
class TestTheBreakdown:
```

Replace with:

```python
class TestTheSelfResolved:
    """G4-03 (spec D4; plan note N5): an unanswered episode whose alarm cleared by itself — its rule stopped
    (`alert_cleared`, reason `resolved`) and nobody ever answered — is counted apart, as a subset of
    `unanswered`. A discharge also ends an episode, and is not the alarm clearing by itself."""

    def test_an_unanswered_alarm_whose_rule_stopped_is_counted_apart(self):
        records = [rec("first_seen", "bed-1", "news2", 0),
                   rec("alert_cleared", "bed-1", "news2", 4, reason="resolved", severity="moderate"),
                   rec("first_seen", "bed-2", "news2", 0)]                    # never stopped
        report = alarm_quality(records, _now(60))
        assert (report.unanswered, report.unanswered_resolved) == (2, 1)

    def test_a_latched_critical_nobody_answered_is_one_too(self):
        records = [rec("first_seen", "bed-1", "septic_shock", 0),
                   rec("alert_cleared", "bed-1", "septic_shock", 2, reason="resolved", severity="critical")]
        report = alarm_quality(records, _now(60))
        assert (report.unanswered, report.unanswered_resolved) == (1, 1)

    def test_an_answered_or_pending_alarm_whose_rule_stopped_is_not(self):
        answered = [rec("first_seen", "bed-1", "news2", 0), rec("ack", "bed-1", "news2", 1, role="ayse"),
                    rec("alert_cleared", "bed-1", "news2", 3, reason="resolved", severity="moderate")]
        assert alarm_quality(answered, _now(60)).unanswered_resolved == 0
        pending = [rec("first_seen", "bed-1", "news2", 55),
                   rec("alert_cleared", "bed-1", "news2", 57, reason="resolved", severity="moderate")]
        report = alarm_quality(pending, _now(60))
        assert (report.pending, report.unanswered_resolved) == (1, 0)

    def test_a_discharge_ends_an_episode_without_its_alarm_clearing_by_itself(self):
        records = [rec("first_seen", "bed-1", "news2", 0),
                   rec("alert_cleared", "bed-1", "news2", 4, reason="discharged", severity="moderate")]
        (episode,) = build_episodes(records)
        assert episode.resolved_at == _now(4) and episode.self_resolved is False
        report = alarm_quality(records, _now(60))
        assert (report.unanswered, report.unanswered_resolved) == (1, 0)


class TestTheBreakdown:
```

Then find:

```python
        assert all(c["hour"].endswith(":00:00+00:00") for c in cells)
```

Replace with:

```python
        assert all(c["hour"].endswith(":00:00+00:00") for c in cells)

    def test_the_report_adds_the_self_resolved_count_and_changes_no_other_field(self, client):   # G4-03 (spec D4)
        body = client.get("/alarm-quality", headers=AUTH).json()
        assert body["unanswered_resolved"] == 0
        assert set(body) == {"episodes", "answered", "unanswered", "unanswered_resolved", "escalated", "pending",
                             "answered_rate", "median_response_sec", "p90_response_sec", "per_kind", "per_day",
                             "noisiest_beds", "per_patient_hour", "repeats", "window_from", "window_to",
                             "days", "truncated"}
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /c/tmp/g4-kalite/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_alarm_quality.py -q -p no:cacheprovider`
Expected: `5 failed, 29 passed` — the four `TestTheSelfResolved` tests (`AttributeError: … 'unanswered_resolved'` or `'self_resolved'`) and the endpoint test (`KeyError: 'unanswered_resolved'`).

- [ ] **Step 3: Count them**

In `homunculus-engine/src/homunculus/api/alarm_quality.py`, find:

```python
    resolved_at: datetime | None = None   # G2-A1: when its rule stopped firing (`alert_cleared`)
```

Replace with:

```python
    resolved_at: datetime | None = None   # G2-A1: when its rule stopped firing (`alert_cleared`)
    # G4-03 (spec D4): its rule itself stopped at least once (an `alert_cleared` row, reason `resolved`). A discharge
    # or an «entered in error» also sets `resolved_at` when none was set, and is not the alarm clearing by itself.
    self_resolved: bool = False
```

Then find:

```python
    escalated: int = 0
    pending: int = 0
    # None, never 0, when nothing has settled yet: a rate computed from no episodes is not 0%,
```

Replace with:

```python
    escalated: int = 0
    pending: int = 0
    # G4-03 (spec D4): the unanswered episodes whose alarm cleared by itself (`Episode.self_resolved`), a subset of
    # `unanswered`. New and additive: no other field changes.
    unanswered_resolved: int = 0
    # None, never 0, when nothing has settled yet: a rate computed from no episodes is not 0%,
```

Then find:

```python
            if reason == "resolved" or episode.resolved_at is None:
                episode.resolved_at = when
```

Replace with:

```python
            if reason == "resolved" or episode.resolved_at is None:
                episode.resolved_at = when
            if reason == "resolved":
                episode.self_resolved = True     # G4-03: the rule stopped — not a discharge, not an error
```

Then find:

```python
        else:
            stats.unanswered += 1
            report.unanswered += 1
```

Replace with:

```python
        else:
            stats.unanswered += 1
            report.unanswered += 1
            if ep.self_resolved:
                report.unanswered_resolved += 1      # G4-03 (spec D4): nobody answered; it cleared by itself
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd /c/tmp/g4-kalite/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_alarm_quality.py tests/test_audit_newest.py tests/test_audit_event_types.py tests/test_alert_lifecycle.py -q -p no:cacheprovider`
Expected: `81 passed, 5 skipped`.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g4-kalite && git add homunculus-engine/src/homunculus/api/alarm_quality.py homunculus-engine/tests/test_alarm_quality.py && git commit -m "feat(alarm-quality): G4-03 unanswered_resolved — the unanswered episodes whose rule stopped by itself, a subset of unanswered; /alarm-quality gains the field, no other changes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/src/homunculus/api/alarm_quality.py homunculus-engine/tests/test_alarm_quality.py
```

---

## Task 3 (engine): the pure answer, `quality/indicators.py`

**Files:**
- Create: `homunculus-engine/src/homunculus/quality/__init__.py`
- Create: `homunculus-engine/src/homunculus/quality/indicators.py`
- Test: `homunculus-engine/tests/test_quality_indicators.py` (new, no DB)

- [ ] **Step 1: Write the failing test**

Create `homunculus-engine/tests/test_quality_indicators.py` with:

```python
# homunculus-engine/tests/test_quality_indicators.py
"""G4-03 «Kalite göstergeleri» (spec D4): the answer of GET /quality, built from what the route read — pure, no
database. One synthetic hospital: Reanimasiya (two protocol numbers), Neonatal (a legacy H-number), a third unit with
nothing (left out), and two keys no admission holds (a HIS-fed id and a monitor-only id: unplaced). Synthetic ids,
synthetic people, synthetic texts."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

from homunculus.api.alarm_quality import EPISODE_KINDS
from homunculus.api.audit import AuditRecord
from homunculus.api.snooze import SNOOZE_REASONS
from homunculus.quality.indicators import (
    QUALITY_KINDS, HandoverFacts, Reach, build_report, handovers_of, snoozes_of,
)

T0 = datetime(2026, 11, 10, 8, 0, tzinfo=timezone.utc)
NOW = T0 + timedelta(hours=6)
REA, NEO, KARDIO = uuid.UUID(int=0xA1), uuid.UUID(int=0xB2), uuid.UUID(int=0xC3)
K1, K3 = "202600000001", "202600000003"          # Reanimasiya, protocol numbers
K2 = "H2600002"                                  # Neonatal, a legacy admission's H-number
HIS, MONITOR = "S-HIS-7", "MON-3"                # no admission here: unplaced
KEY_UNITS = {K1: REA, K3: REA, K2: NEO}
ALL_UNITS = {REA: "Reanimasiya", NEO: "Neonatal", KARDIO: "Kardiyoloji"}
NURSE = {"role": "ayse.sentetik", "actor": "ayse.sentetik", "via": "user", "groups": ["nurse"]}
OTHER_TEXT = "Sentetik açıklama, on beş harften uzun"
RRT_TEXT = "Sentetik gerekçe: tansiyon düşüyor"
WINDOW_FROM = (NOW - timedelta(days=7)).isoformat()

_ids = iter(range(1, 10_000))


def rec(event_type: str, key: str, kind: str, minute: float, **payload) -> AuditRecord:
    when = (T0 + timedelta(minutes=minute)).isoformat()
    return AuditRecord(id=next(_ids), ts=when, tenant="kalite-hastane", event_type=event_type, patient_id=key,
                       subject=kind, payload={"at": when, **payload})


def snooze(key: str, kind: str, minute: float, *, minutes: int, reason: str, severity: str, **extra) -> AuditRecord:
    return rec("alert_snooze", key, kind, minute, **NURSE, minutes=minutes, reason=reason, severity=severity,
               until=(T0 + timedelta(minutes=minute + minutes)).isoformat(), **extra)


TRAIL = [
    # Reanimasiya: answered in 60 s, 180 s and 600 s (one escalated); one whose rule stopped by itself; one never
    # answered; one still pending.
    rec("first_seen", K1, "news2", 0), rec("ack", K1, "news2", 1, **NURSE),
    snooze(K1, "news2", 5, minutes=15, reason="CLINICAL_DECISION_MADE", severity="moderate"),
    rec("first_seen", K1, "news2", 30), rec("ack", K1, "news2", 33, **NURSE),
    rec("first_seen", K3, "septic_shock", 40), rec("escalation", K3, "septic_shock", 45),
    rec("rrt_call", K3, "septic_shock", 46, **NURSE, reason=RRT_TEXT),
    rec("ack", K3, "septic_shock", 50, **NURSE),
    rec("first_seen", K3, "spo2_low", 60),
    snooze(K3, "spo2_low", 61, minutes=10, reason="OTHER", severity="high", reason_text=OTHER_TEXT),
    rec("alert_cleared", K3, "spo2_low", 62, reason="resolved", severity="high"),
    rec("first_seen", K1, "spo2_low", 70),
    # Neonatal: answered in 240 s, one snooze.
    rec("first_seen", K2, "news2", 100), rec("ack", K2, "news2", 104, **NURSE),
    snooze(K2, "news2", 101, minutes=30, reason="ARTEFACT_OR_SIGNAL_NOISE", severity="moderate"),
    # Unplaced: a HIS-fed patient never answered (and snoozed), a monitor-only id answered in 60 s (and an RRT call).
    rec("first_seen", HIS, "news2", 120),
    snooze(HIS, "news2", 121, minutes=5, reason="PROCEDURE_IN_PROGRESS", severity="high"),
    rec("first_seen", MONITOR, "news2", 130), rec("ack", MONITOR, "news2", 131, **NURSE),
    rec("rrt_call", MONITOR, "news2", 130.5, **NURSE, reason=RRT_TEXT),
    # Reanimasiya, raised two minutes ago: pending.
    rec("first_seen", K3, "news2", 358),
]


def handover(unit, status, *, out_min=None, in_min=None, expires_min=30.0) -> HandoverFacts:
    at = lambda minute: None if minute is None else T0 + timedelta(minutes=minute)   # noqa: E731
    return HandoverFacts(unit_id=unit, status=status, bridge_expires_at=at(expires_min),
                         outgoing_signed_at=at(out_min), incoming_signed_at=at(in_min))


HANDOVERS = [
    handover(REA, "COMPLETED", out_min=60, in_min=65),           # countersigned in 300 s
    handover(REA, "COMPLETED", out_min=120, in_min=135),         # 900 s
    handover(REA, "OUTGOING_SIGNED", out_min=200),               # waiting
    handover(REA, "OPEN", expires_min=300),                      # past its bridge: expired
    handover(REA, "OPEN", expires_min=370),                      # still inside its bridge
    handover(REA, "EXPIRED"),
    handover(NEO, "COMPLETED", out_min=180, in_min=181),         # 60 s
]


def report(reach: Reach, *, records=TRAIL, handovers=HANDOVERS, truncated=False, window_from=WINDOW_FROM) -> dict:
    return build_report(records=records, key_units=KEY_UNITS, reach=reach, handovers=handovers, now=NOW, days=7,
                        window_from=window_from, truncated=truncated)


EVERYONE = Reach(units=ALL_UNITS, scoped=False)


def test_the_answer_says_its_period_and_how_it_was_read():
    body = report(EVERYONE, truncated=True, window_from=T0.isoformat())
    assert (body["days"], body["generated_at"], body["window_from"]) == (7, NOW.isoformat(), T0.isoformat())
    assert (body["truncated"], body["scoped"]) == (True, False)
    assert set(body) == {"days", "generated_at", "window_from", "truncated", "scoped", "coverage", "units",
                         "unplaced", "hospital"}


def test_each_unit_counts_its_own_alarms_by_the_alarm_quality_rules():
    units = {u["unit_name"]: u for u in report(EVERYONE)["units"]}
    rea = units["Reanimasiya"]["alarms"]
    assert {k: rea[k] for k in ("episodes", "answered", "escalated", "unanswered", "unanswered_resolved",
                                "pending")} == {"episodes": 6, "answered": 3, "escalated": 1, "unanswered": 2,
                                               "unanswered_resolved": 1, "pending": 1}
    assert (rea["answered_rate"], rea["median_response_sec"], rea["p90_response_sec"]) == (0.6, 180.0, 600.0)
    assert rea["per_kind"] == [
        {"kind": "news2", "episodes": 3, "answered": 2, "escalated": 0, "unanswered": 0, "median_response_sec": 120.0},
        {"kind": "spo2_low", "episodes": 2, "answered": 0, "escalated": 0, "unanswered": 2, "median_response_sec": None},
        {"kind": "septic_shock", "episodes": 1, "answered": 1, "escalated": 1, "unanswered": 0,
         "median_response_sec": 600.0},
    ]
    neo = units["Neonatal"]["alarms"]
    assert (neo["episodes"], neo["answered"], neo["median_response_sec"], neo["answered_rate"]) == (1, 1, 240.0, 1.0)


def test_the_units_are_by_name_and_a_unit_with_nothing_is_left_out():
    body = report(EVERYONE)
    assert [(u["unit_id"], u["unit_name"]) for u in body["units"]] == [(str(NEO), "Neonatal"), (str(REA), "Reanimasiya")]
    assert set(body["units"][0]) == {"unit_id", "unit_name", "alarms", "snoozes", "rrt", "handovers"}


def test_snoozes_by_reason_and_severity_and_rrt_calls_are_counted_per_unit():
    units = {u["unit_name"]: u for u in report(EVERYONE)["units"]}
    rea = units["Reanimasiya"]
    assert rea["snoozes"] == {"count": 2, "by_reason": {**{r: 0 for r in SNOOZE_REASONS}, "CLINICAL_DECISION_MADE": 1,
                                                         "OTHER": 1},
                              "by_severity": {"high": 1, "moderate": 1}, "median_minutes": 12.5}
    assert rea["rrt"] == {"count": 1}
    assert units["Neonatal"]["snoozes"]["by_reason"]["ARTEFACT_OR_SIGNAL_NOISE"] == 1
    assert units["Neonatal"]["rrt"] == {"count": 0}


def test_handovers_per_unit_opened_countersigned_waiting_expired_and_their_times():
    units = {u["unit_name"]: u for u in report(EVERYONE)["units"]}
    assert units["Reanimasiya"]["handovers"] == {"opened": 6, "countersigned": 2, "waiting": 1, "expired": 2,
                                                 "median_countersign_sec": 600.0, "p90_countersign_sec": 900.0}
    assert units["Neonatal"]["handovers"]["countersigned"] == 1
    assert handovers_of([], NOW) == {"opened": 0, "countersigned": 0, "waiting": 0, "expired": 0,
                                     "median_countersign_sec": None, "p90_countersign_sec": None}


def test_an_unrestricted_caller_gets_the_unplaced_and_the_whole_hospital():
    body = report(EVERYONE)
    assert body["coverage"] == {"episodes": 9, "placed": 7, "unplaced": 2}
    unplaced = body["unplaced"]
    assert set(unplaced) == {"alarms", "snoozes", "rrt"}                 # every handover has a unit
    assert (unplaced["alarms"]["episodes"], unplaced["alarms"]["answered"], unplaced["alarms"]["unanswered"]) == (2, 1, 1)
    assert (unplaced["snoozes"]["count"], unplaced["rrt"]["count"]) == (1, 1)
    hospital = body["hospital"]
    assert (hospital["alarms"]["episodes"], hospital["alarms"]["answered"], hospital["alarms"]["unanswered"]) == (9, 5, 3)
    assert hospital["alarms"]["answered_rate"] == 0.625
    # Over every episode the caller may see (60, 60, 180, 240, 600 s) — not a mean of the groups' medians (160 s).
    assert (hospital["alarms"]["median_response_sec"], hospital["alarms"]["p90_response_sec"]) == (180.0, 240.0)
    assert (hospital["snoozes"]["count"], hospital["snoozes"]["median_minutes"], hospital["rrt"]["count"]) == (4, 12.5, 2)
    assert hospital["handovers"] == {"opened": 7, "countersigned": 3, "waiting": 1, "expired": 2,
                                     "median_countersign_sec": 300.0, "p90_countersign_sec": 900.0}


def test_a_scoped_caller_gets_her_units_only_and_no_unplaced():
    body = report(Reach(units={REA: "Reanimasiya"}, scoped=True), handovers=HANDOVERS)
    assert body["scoped"] is True and body["unplaced"] is None
    assert [u["unit_name"] for u in body["units"]] == ["Reanimasiya"]
    assert body["coverage"] == {"episodes": 6, "placed": 6, "unplaced": 0}
    assert body["hospital"]["alarms"]["episodes"] == 6
    assert (body["hospital"]["snoozes"]["count"], body["hospital"]["rrt"]["count"]) == (2, 1)
    assert body["hospital"]["handovers"]["opened"] == 6          # Neonatal's handover is not hers


def test_a_caller_who_reaches_nothing_gets_no_unit_and_zeros():
    body = report(Reach(units={}, scoped=True))
    assert (body["units"], body["unplaced"], body["scoped"]) == ([], None, True)
    assert body["coverage"] == {"episodes": 0, "placed": 0, "unplaced": 0}
    alarms = body["hospital"]["alarms"]
    assert (alarms["episodes"], alarms["answered_rate"], alarms["median_response_sec"], alarms["per_kind"]) == (0, None, None, [])
    assert body["hospital"]["snoozes"] == {"count": 0, "by_reason": {r: 0 for r in SNOOZE_REASONS},
                                           "by_severity": {"high": 0, "moderate": 0}, "median_minutes": None}
    assert body["hospital"]["handovers"]["opened"] == 0


def test_an_unrestricted_callers_key_in_a_unit_she_does_not_list_is_unplaced_not_lost():
    body = report(Reach(units={NEO: "Neonatal"}, scoped=False))
    assert body["coverage"] == {"episodes": 9, "placed": 1, "unplaced": 8}


def test_the_answer_names_no_patient_key_no_person_and_no_free_text():
    text = json.dumps(report(EVERYONE), ensure_ascii=False)
    for told in (K1, K2, K3, HIS, MONITOR, "ayse.sentetik", "nurse", OTHER_TEXT, RRT_TEXT):
        assert told not in text, told


def test_snoozes_read_only_well_formed_figures():
    odd = [rec("alert_snooze", K1, "news2", 1, minutes=True, reason=["OTHER"], severity={"high": 1}),
           rec("alert_snooze", K1, "news2", 2, minutes=20, reason="UNKNOWN_CODE", severity="critical")]
    assert snoozes_of(odd) == {"count": 2, "by_reason": {r: 0 for r in SNOOZE_REASONS},
                               "by_severity": {"high": 0, "moderate": 0}, "median_minutes": 20}


def test_the_kinds_read_are_the_episodes_and_the_two_acts():
    assert QUALITY_KINDS == EPISODE_KINDS | {"alert_snooze", "rrt_call"}
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/tmp/g4-kalite/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_quality_indicators.py -q -p no:cacheprovider`
Expected: `1 error` during collection: `ModuleNotFoundError: No module named 'homunculus.quality'`.

- [ ] **Step 3: Write the package and the answer**

Create `homunculus-engine/src/homunculus/quality/__init__.py` with:

```python
# homunculus-engine/src/homunculus/quality/__init__.py
"""G4-03 «Kalite göstergeleri» (spec docs/superpowers/specs/2026-11-11-g4-kalite-gostergeleri-design.md): per-unit
care-process indicators. `indicators` builds the answer from what was read (pure); `router` reads it (`GET /quality`,
the board key → unit map). Counts and times only: no patient key, no person and no free text leaves this package."""
```

Create `homunculus-engine/src/homunculus/quality/indicators.py` with:

```python
# homunculus-engine/src/homunculus/quality/indicators.py
"""G4-03 «Kalite göstergeleri» (spec 2026-11-11 D4): the answer of `GET /quality`, pure — no database, no clock.

What the route read goes in: the window's audit rows (the alarm episode kinds, `alert_snooze`, `rrt_call`), the board
key → unit map (`router.units_of_keys`), the units the caller reaches with their names, and the window's handovers.
What comes out is counts and times only, with unit ids and names: never a patient key, a person or a free text (a
snooze's `reason_text` and an RRT call's `reason` are not read at all).

PLACING. An episode, a snooze and an RRT call are tied to a unit through their row's patient key. A key the map does
not hold — a patient admitted elsewhere (HIS-fed), a monitor-only id, a legacy key admitted to two units — is
UNPLACED. An unrestricted caller gets every unit and the unplaced block; a scoped caller gets her units only, no
unplaced block, and `coverage` and `hospital` count only what she got.

Alarms are grouped and each group goes through `alarm_quality.summarise` unchanged: a unit's median and p90 are over
its own episodes, `hospital`'s over every episode the caller may see — never a mean of the units' medians.
"""
from __future__ import annotations

import statistics
import uuid
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import datetime

from homunculus.api.alarm_quality import EPISODE_KINDS, Episode, build_episodes, summarise
from homunculus.api.audit import AuditRecord
from homunculus.api.snooze import SNOOZE_CAPS, SNOOZE_REASONS

#: The two acts `/quality` reads beside the episodes (spec D4 §1): a snooze («Ertele») and a call to the RRT.
SNOOZE = "alert_snooze"
RRT_CALL = "rrt_call"
QUALITY_KINDS = EPISODE_KINDS | {SNOOZE, RRT_CALL}

#: The handover states (`admission.models.HandoverStatus`, a str enum: each member equals its text).
OPEN, OUTGOING_SIGNED, COMPLETED, EXPIRED = "OPEN", "OUTGOING_SIGNED", "COMPLETED", "EXPIRED"


@dataclass(frozen=True)
class HandoverFacts:
    """One handover of the window as `/quality` counts it: its unit, its state and its times — no person, no note."""
    unit_id: uuid.UUID
    status: str
    bridge_expires_at: datetime
    outgoing_signed_at: datetime | None
    incoming_signed_at: datetime | None


@dataclass(frozen=True)
class Reach:
    """The units the caller reaches (id → name) and whether she is scoped (her unit grants, not unrestricted)."""
    units: Mapping[uuid.UUID, str]
    scoped: bool


@dataclass
class _Group:
    episodes: list[Episode] = field(default_factory=list)
    snoozes: list[AuditRecord] = field(default_factory=list)
    calls: list[AuditRecord] = field(default_factory=list)
    handovers: list[HandoverFacts] = field(default_factory=list)

    def counts_anything(self) -> bool:
        return bool(self.episodes or self.snoozes or self.calls or self.handovers)


def _median(values: list[float]) -> float | None:
    return round(statistics.median(values), 1) if values else None


def _p90(values: list[float]) -> float | None:
    """Nearest rank, as `summarise` takes it: never a number between two real ones."""
    if not values:
        return None
    ordered = sorted(values)
    return round(ordered[max(0, min(len(ordered) - 1, int(round(0.9 * len(ordered))) - 1))], 1)


def alarms_of(episodes: list[Episode], now: datetime) -> dict:
    """One group's alarm figures by `summarise`'s rules. Its patient-level fields (`noisiest_beds`,
    `per_patient_hour`) and its days are not carried."""
    report = summarise(episodes, now)
    return {
        "episodes": report.episodes, "answered": report.answered, "answered_rate": report.answered_rate,
        "median_response_sec": report.median_response_sec, "p90_response_sec": report.p90_response_sec,
        "escalated": report.escalated, "unanswered": report.unanswered,
        "unanswered_resolved": report.unanswered_resolved, "pending": report.pending,
        "per_kind": [{"kind": k.kind, "episodes": k.episodes, "answered": k.answered, "escalated": k.escalated,
                      "unanswered": k.unanswered, "median_response_sec": k.median_response_sec}
                     for k in report.per_kind],
    }


def snoozes_of(rows: list[AuditRecord]) -> dict:
    """One group's snoozes: how many; by reason code and by severity, every code and both severities listed (a 0
    included); the median of the minutes given. A figure of the wrong kind is not counted under any reason, severity
    or median; `reason_text` is never read."""
    by_reason = {reason: 0 for reason in sorted(SNOOZE_REASONS)}
    by_severity = {severity: 0 for severity in sorted(SNOOZE_CAPS)}
    minutes: list[int] = []
    for rec in rows:
        reason, severity, given = rec.payload.get("reason"), rec.payload.get("severity"), rec.payload.get("minutes")
        if isinstance(reason, str) and reason in by_reason:
            by_reason[reason] += 1
        if isinstance(severity, str) and severity in by_severity:
            by_severity[severity] += 1
        if isinstance(given, int) and not isinstance(given, bool):
            minutes.append(given)
    return {"count": len(rows), "by_reason": by_reason, "by_severity": by_severity,
            "median_minutes": _median(minutes)}


def handovers_of(rows: list[HandoverFacts], now: datetime) -> dict:
    """One group's handovers opened in the window: countersigned (COMPLETED); waiting (OUTGOING_SIGNED); expired
    (EXPIRED, or OPEN past its 30-minute bridge — read as `GET /handovers` reads it); an OPEN one inside its bridge is
    opened and nothing else yet. The median and p90 of the outgoing signature → countersignature time, over the
    countersigned ones. No «within 30 minutes» share: a countersignature has no deadline (spec D4)."""
    countersigned = waiting = expired = 0
    times: list[float] = []
    for h in rows:
        if h.status == COMPLETED:
            countersigned += 1
            if h.outgoing_signed_at is not None and h.incoming_signed_at is not None:
                times.append(max(0.0, (h.incoming_signed_at - h.outgoing_signed_at).total_seconds()))
        elif h.status == OUTGOING_SIGNED:
            waiting += 1
        elif h.status == EXPIRED or (h.status == OPEN and now >= h.bridge_expires_at):
            expired += 1
    return {"opened": len(rows), "countersigned": countersigned, "waiting": waiting, "expired": expired,
            "median_countersign_sec": _median(times), "p90_countersign_sec": _p90(times)}


def _figures(group: _Group, now: datetime, *, with_handovers: bool = True) -> dict:
    out = {"alarms": alarms_of(group.episodes, now), "snoozes": snoozes_of(group.snoozes),
           "rrt": {"count": len(group.calls)}}
    if with_handovers:
        out["handovers"] = handovers_of(group.handovers, now)
    return out


def build_report(*, records: list[AuditRecord], key_units: Mapping[str, uuid.UUID], reach: Reach,
                 handovers: Iterable[HandoverFacts], now: datetime, days: int, window_from: str,
                 truncated: bool) -> dict:
    """The answer (spec D4). `records`: the window's rows of QUALITY_KINDS, oldest first; `key_units`: board key →
    unit; `reach`: the units the caller may see; `handovers`: the window's, already cut to her tenant and units
    (a handover of a unit outside `reach` is dropped all the same)."""
    units = {unit_id: _Group() for unit_id in reach.units}
    unplaced = _Group()

    def group_of(key: str) -> _Group | None:
        unit_id = key_units.get(key)
        if unit_id is not None and unit_id in units:
            return units[unit_id]
        # No admission here, two units, or a unit she does not reach: the unplaced block of an unrestricted caller;
        # a scoped caller is told nothing of it.
        return None if reach.scoped else unplaced

    for episode in build_episodes([rec for rec in records if rec.event_type in EPISODE_KINDS]):
        group = group_of(episode.patient_id)
        if group is not None:
            group.episodes.append(episode)
    for rec in records:
        if rec.event_type in (SNOOZE, RRT_CALL):
            group = group_of(rec.patient_id)
            if group is not None:
                (group.snoozes if rec.event_type == SNOOZE else group.calls).append(rec)
    for h in handovers:
        if h.unit_id in units:
            units[h.unit_id].handovers.append(h)

    rows = sorted(((unit_id, group) for unit_id, group in units.items() if group.counts_anything()),
                  key=lambda row: (reach.units[row[0]].casefold(), str(row[0])))
    seen = [group for _, group in rows] + ([] if reach.scoped else [unplaced])
    every = _Group(episodes=[e for g in seen for e in g.episodes], snoozes=[s for g in seen for s in g.snoozes],
                   calls=[c for g in seen for c in g.calls], handovers=[h for g in seen for h in g.handovers])
    placed = sum(len(group.episodes) for _, group in rows)
    lost = 0 if reach.scoped else len(unplaced.episodes)
    return {
        "days": days, "generated_at": now.isoformat(), "window_from": window_from, "truncated": truncated,
        "scoped": reach.scoped,
        "coverage": {"episodes": placed + lost, "placed": placed, "unplaced": lost},
        "units": [{"unit_id": str(unit_id), "unit_name": reach.units[unit_id], **_figures(group, now)}
                  for unit_id, group in rows],
        "unplaced": None if reach.scoped else _figures(unplaced, now, with_handovers=False),
        "hospital": _figures(every, now),
    }
```

- [ ] **Step 4: Run it to see it pass**

Run: `cd /c/tmp/g4-kalite/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_quality_indicators.py -q -p no:cacheprovider`
Expected: `12 passed`.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g4-kalite && git add homunculus-engine/src/homunculus/quality/__init__.py homunculus-engine/src/homunculus/quality/indicators.py homunculus-engine/tests/test_quality_indicators.py && git commit -m "feat(quality): G4-03 the pure answer of GET /quality — alarms per unit by summarise's rules, snoozes by reason and severity, RRT calls, handover countersign times; unplaced for an unrestricted caller only; no key, person or free text" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/src/homunculus/quality/__init__.py homunculus-engine/src/homunculus/quality/indicators.py homunculus-engine/tests/test_quality_indicators.py
```

---

## Task 4 (engine): `GET /quality` and the board key → unit map

**Files:**
- Create: `homunculus-engine/src/homunculus/quality/router.py`
- Modify: `homunculus-engine/src/homunculus/api/app.py` (after the protocol router's `include_router`)
- Test: `homunculus-engine/tests/test_quality_api.py` (new, DB-backed)

- [ ] **Step 1: Write the failing DB-backed tests**

Create `homunculus-engine/tests/test_quality_api.py` with:

```python
# homunculus-engine/tests/test_quality_api.py
"""G4-03 «Kalite göstergeleri» (spec D4): `units_of_keys` and `GET /quality`, on Postgres (`db_session`).

The ward is tests/kabul_world.py (Reanimasiya, Neonatal; the default groups, whose `auditor` holds quality.view since
G4-03). Past admissions are written straight into the database and the audit rows straight into the app's own trail
(`app.state.audit`, in memory): a quality figure needs no live board. Synthetic everything."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest_asyncio

from homunculus.admission import service as adm_service
from homunculus.admission.models import Admission, AdmissionState, Handover, HandoverStatus, Patient
from homunculus.admission.numbers import next_patient_number
from homunculus.api.audit import AuditEvent
from homunculus.auth.groups import ensure_default_groups
from homunculus.auth.models import Group, GroupPermission
from homunculus.quality import router as quality_router
from homunculus.quality.indicators import QUALITY_KINDS
from homunculus.quality.router import units_of_keys
from homunculus.scope.models import StaffScope
from homunculus.tenant.models import Bed, Room, Site, Tenant, Unit, UnitType
from tests.conftest import requires_db
from tests.kabul_world import SLUG, build_ward, ward_client
from tests.signed_in import add_user, bearer

pytestmark = [requires_db]

K1 = "202600000101"            # Reanimasiya: a protocol number
SHARED = "202600000102"        # Reanimasiya here; the other hospital uses the same number in its own unit
HIS = "S-HIS-1"                # no admission here: unplaced
OTHER = "omega-hastane"
OTHER_TEXT = "Sentetik açıklama, on beş harften uzun"
RRT_TEXT = "Sentetik gerekçe metni"
NURSE = {"role": "ayse.sentetik", "actor": "ayse.sentetik", "via": "user", "groups": ["nurse"]}


@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    built = await build_ward(db_session)
    async with ward_client(db_session) as (client, app):
        yield built, client, app


async def stay(db_session, *, tenant_id: uuid.UUID, unit_id: uuid.UUID, bed_id: uuid.UUID,
               protocol_no: str | None = None, patient: Patient | None = None) -> Patient:
    """One past admission (DISCHARGED), written straight into the database: the key → unit map reads every state. A
    new synthetic patient unless `patient` is given (a legacy patient's second stay)."""
    if patient is None:
        patient = Patient(tenant_id=tenant_id, display_name="Sentetik Hasta", date_of_birth="1970-01-01",
                          sex="female", patient_number=await next_patient_number(db_session, tenant_id))
        db_session.add(patient)
        await db_session.flush()
    db_session.add(Admission(patient_id=patient.id, tenant_id=tenant_id, state=AdmissionState.DISCHARGED,
                             admission_datetime=datetime.now(timezone.utc) - timedelta(days=2),
                             admitting_unit_id=unit_id, bed_id=bed_id,
                             admission_diagnosis_free_text="Sentetik tanı", protocol_no=protocol_no))
    await db_session.commit()
    return patient


async def here(db_session, w, unit: str, bed: str, **kw) -> Patient:
    """`stay` in the ward."""
    return await stay(db_session, tenant_id=w.tenant.id, unit_id=w.units[unit].id, bed_id=w.beds[bed].id, **kw)


async def other_hospital(db_session):
    """Sentetik Omega: its own unit, bed and administrator."""
    tenant = Tenant(name="Sentetik Omega Hastanesi", slug=OTHER, country_code="AZ")
    db_session.add(tenant)
    await db_session.flush()
    groups = await ensure_default_groups(db_session, tenant.id)
    site = Site(tenant_id=tenant.id, name="Omega bina")
    db_session.add(site)
    await db_session.flush()
    unit = Unit(site_id=site.id, name="Omega YBÜ", unit_type=UnitType.ADULT_ICU)
    db_session.add(unit)
    await db_session.flush()
    room = Room(unit_id=unit.id, name="O-1")
    db_session.add(room)
    await db_session.flush()
    bed = Bed(room_id=room.id, label="O1")
    db_session.add(bed)
    await db_session.commit()
    admin = await add_user(db_session, username="yonetici@omega.example.com", tenant_id=tenant.id,
                           group=groups["hospital_admin"])
    return tenant, unit, bed, admin


async def handed(db_session, w, unit: str | None, status: HandoverStatus, *, signed_ago: float | None = None,
                 countersigned_ago: float | None = None, expired_ago: float | None = None,
                 opened_days_ago: float = 0, unit_id: uuid.UUID | None = None,
                 people: tuple[uuid.UUID, uuid.UUID] | None = None) -> Handover:
    """A handover in `status`, written straight into the database; its times in minutes (days) before now."""
    now = datetime.now(timezone.utc)
    outgoing, incoming = people or (w.users["nurse"].id, w.users["charge"].id)
    h = await adm_service.open_handover(db_session, unit_id=unit_id or w.units[unit].id, outgoing_user_id=outgoing,
                                        incoming_user_id=incoming, admission_ids=[])
    h.status = status
    if signed_ago is not None:
        h.outgoing_signed_at = now - timedelta(minutes=signed_ago)
    if countersigned_ago is not None:
        h.incoming_signed_at = now - timedelta(minutes=countersigned_ago)
    if expired_ago is not None:
        h.bridge_expires_at = now - timedelta(minutes=expired_ago)
    if opened_days_ago:
        h.bridge_opened_at = now - timedelta(days=opened_days_ago)
    await db_session.commit()
    return h


def write(app, event_type: str, key: str, kind: str, minutes_ago: float, *, tenant: str = SLUG, **payload) -> None:
    """One row of a hospital's audit trail, its event `minutes_ago` before now."""
    at = (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat()
    app.state.audit.append(AuditEvent(tenant, event_type, key, kind, {"at": at, **payload}))


async def ward_with_a_trail(db_session, w, app) -> Patient:
    """Reanimasiya (K1): answered in 60 s and snoozed; another alarm cleared by itself, unanswered. Neonatal (a
    legacy H-number): escalated, an RRT call, answered in 600 s. Unplaced (a HIS-fed id): never answered, snoozed.
    The legacy patient."""
    await here(db_session, w, "rea", "1", protocol_no=K1)
    legacy = await here(db_session, w, "neo", "N1")
    k2 = legacy.patient_number
    write(app, "first_seen", K1, "news2", 120)
    write(app, "ack", K1, "news2", 119, **NURSE)
    write(app, "alert_snooze", K1, "news2", 118, **NURSE, minutes=15, reason="CLINICAL_DECISION_MADE",
          severity="moderate")
    write(app, "first_seen", K1, "spo2_low", 100)
    write(app, "alert_cleared", K1, "spo2_low", 98, reason="resolved", severity="high")
    write(app, "first_seen", k2, "news2", 90)
    write(app, "escalation", k2, "news2", 85)
    write(app, "rrt_call", k2, "news2", 84, **NURSE, reason=RRT_TEXT)
    write(app, "ack", k2, "news2", 80, **NURSE)
    write(app, "first_seen", HIS, "news2", 60)
    write(app, "alert_snooze", HIS, "news2", 59, **NURSE, minutes=10, reason="OTHER", reason_text=OTHER_TEXT,
          severity="high")
    return legacy


async def quality(client, headers: dict[str, str], days: int = 7) -> dict:
    r = await client.get("/quality", params={"days": days}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


async def quality_reader(db_session, w, *, unit: str | None = None, bed: str | None = None) -> dict[str, str]:
    """A member of a group the hospital made, holding `quality.view` alone (spec D2: a hospital's own «Kalite
    birimi»), granted one unit or one bed. Her Authorization header."""
    tag = uuid.uuid4().hex[:8]
    group = Group(tenant_id=w.tenant.id, slug=f"kalite-{tag}", name=f"Sentetik kalite {tag}",
                  permissions=[GroupPermission(permission="quality.view")])
    db_session.add(group)
    await db_session.flush()
    user = await add_user(db_session, username=f"kalite-{tag}@kabul.example.com", tenant_id=w.tenant.id,
                          group=group)
    db_session.add(StaffScope(tenant_id=w.tenant.id, user_id=user.id,
                              unit_id=str(w.units[unit].id) if unit else "",
                              bed_id=str(w.beds[bed].id) if bed else ""))
    await db_session.commit()
    return await bearer(db_session, user)


async def test_each_key_is_placed_in_the_unit_its_admission_was_admitted_to(ward, db_session):
    """Spec D4 §3: a protocol number; a legacy H-number (no protocol number); a legacy key admitted to two units is
    ambiguous and left out; a key with no admission is left out; a protocol-numbered admission's H-number is no
    key; another hospital's admission under the same protocol number is never matched."""
    w, _, _ = ward
    first = await here(db_session, w, "rea", "1", protocol_no=K1)
    legacy = await here(db_session, w, "neo", "N1")
    twice = await here(db_session, w, "rea", "2")
    await here(db_session, w, "neo", "N1", patient=twice)
    await here(db_session, w, "rea", "3", protocol_no=SHARED)
    tenant, unit, bed, _ = await other_hospital(db_session)
    await stay(db_session, tenant_id=tenant.id, unit_id=unit.id, bed_id=bed.id, protocol_no=SHARED)

    found = await units_of_keys(db_session, w.tenant.id, [K1, legacy.patient_number, twice.patient_number, SHARED,
                                                          first.patient_number, HIS, ""])
    assert found == {K1: w.units["rea"].id, legacy.patient_number: w.units["neo"].id, SHARED: w.units["rea"].id}
    assert await units_of_keys(db_session, tenant.id, [K1, SHARED]) == {SHARED: unit.id}


async def test_the_indicators_need_quality_view(ward):
    """Spec D2: the auditor group holds it by default, the system administrator by rule; the ward's groups do not."""
    w, client, _ = ward
    for who in ("nurse", "charge", "doctor"):
        r = await client.get("/quality", headers=w.auth[who])
        assert r.status_code == 403, (who, r.text)
    for who in ("auditor", "admin"):
        body = await quality(client, w.auth[who])
        assert (body["days"], body["units"], body["scoped"]) == (7, [], False)


async def test_days_is_one_seven_or_thirty(ward):
    w, client, _ = ward
    for days in (1, 7, 30):
        assert (await quality(client, w.auth["admin"], days))["days"] == days
    for days in ("0", "2", "31", "abc"):
        r = await client.get("/quality", params={"days": days}, headers=w.auth["admin"])
        assert r.status_code == 422, (days, r.text)


async def test_each_unit_counts_its_alarms_snoozes_and_rrt_calls_from_the_trail(ward, db_session):
    w, client, app = ward
    await ward_with_a_trail(db_session, w, app)
    body = await quality(client, w.auth["admin"])
    assert [u["unit_name"] for u in body["units"]] == ["Neonatal", "Reanimasiya"]
    neo, rea = body["units"]
    assert neo["unit_id"] == str(w.units["neo"].id)
    assert (neo["alarms"]["episodes"], neo["alarms"]["answered"], neo["alarms"]["escalated"],
            neo["alarms"]["median_response_sec"], neo["rrt"]["count"]) == (1, 1, 1, 600.0, 1)
    assert (rea["alarms"]["episodes"], rea["alarms"]["answered"], rea["alarms"]["unanswered"],
            rea["alarms"]["unanswered_resolved"], rea["alarms"]["median_response_sec"]) == (2, 1, 1, 1, 60.0)
    assert rea["snoozes"]["count"] == 1 and rea["snoozes"]["by_reason"]["CLINICAL_DECISION_MADE"] == 1
    assert rea["snoozes"]["by_severity"] == {"high": 0, "moderate": 1}
    assert (body["unplaced"]["alarms"]["episodes"], body["unplaced"]["snoozes"]["by_reason"]["OTHER"]) == (1, 1)
    assert body["coverage"] == {"episodes": 4, "placed": 3, "unplaced": 1}
    hospital = body["hospital"]
    assert (hospital["alarms"]["episodes"], hospital["alarms"]["answered"],
            hospital["alarms"]["median_response_sec"]) == (4, 2, 330.0)
    assert (hospital["snoozes"]["count"], hospital["rrt"]["count"]) == (2, 1)


async def test_handovers_are_counted_per_unit_by_their_state_and_times(ward, db_session):
    w, client, _ = ward
    await handed(db_session, w, "rea", HandoverStatus.COMPLETED, signed_ago=50, countersigned_ago=45)   # 300 s
    await handed(db_session, w, "rea", HandoverStatus.COMPLETED, signed_ago=40, countersigned_ago=25)   # 900 s
    await handed(db_session, w, "rea", HandoverStatus.OUTGOING_SIGNED, signed_ago=10)
    await handed(db_session, w, "rea", HandoverStatus.OPEN, expired_ago=1)          # past its bridge: expired
    await handed(db_session, w, "rea", HandoverStatus.OPEN)                         # still inside it
    await handed(db_session, w, "neo", HandoverStatus.EXPIRED)
    await handed(db_session, w, "neo", HandoverStatus.COMPLETED, signed_ago=60, countersigned_ago=59,
                 opened_days_ago=8)                                                 # before the 7 days
    body = await quality(client, w.auth["admin"])
    units = {u["unit_name"]: u["handovers"] for u in body["units"]}
    assert units["Reanimasiya"] == {"opened": 5, "countersigned": 2, "waiting": 1, "expired": 1,
                                    "median_countersign_sec": 600.0, "p90_countersign_sec": 900.0}
    assert units["Neonatal"] == {"opened": 1, "countersigned": 0, "waiting": 0, "expired": 1,
                                 "median_countersign_sec": None, "p90_countersign_sec": None}
    assert body["hospital"]["handovers"]["opened"] == 6
    assert (await quality(client, w.auth["admin"], 30))["hospital"]["handovers"]["opened"] == 7


async def test_a_scoped_reader_sees_her_units_only_and_no_unplaced(ward, db_session):
    """Spec D4: a unit grant reaches its unit; a bed grant names a bed, not its unit, and reaches none."""
    w, client, app = ward
    await ward_with_a_trail(db_session, w, app)
    await handed(db_session, w, "neo", HandoverStatus.EXPIRED)
    body = await quality(client, await quality_reader(db_session, w, unit="rea"))
    assert (body["scoped"], body["unplaced"]) == (True, None)
    assert [u["unit_name"] for u in body["units"]] == ["Reanimasiya"]
    assert body["coverage"] == {"episodes": 2, "placed": 2, "unplaced": 0}
    assert (body["hospital"]["alarms"]["episodes"], body["hospital"]["rrt"]["count"],
            body["hospital"]["handovers"]["opened"]) == (2, 0, 0)

    nothing = await quality(client, await quality_reader(db_session, w, bed="1"))
    assert (nothing["units"], nothing["unplaced"], nothing["scoped"]) == ([], None, True)
    assert nothing["coverage"] == {"episodes": 0, "placed": 0, "unplaced": 0}
    assert nothing["hospital"]["alarms"]["episodes"] == 0


async def test_a_truncated_read_says_so_and_from_when(ward, db_session, monkeypatch):
    """Capped as /alarm-quality is: the newest rows, one more to know. Then `window_from` is the oldest row kept."""
    w, client, app = ward
    await here(db_session, w, "rea", "1", protocol_no=K1)
    for minutes_ago in (50, 40, 30, 20, 10):
        write(app, "first_seen", K1, "news2", minutes_ago)
    whole = await quality(client, w.auth["admin"])
    assert whole["truncated"] is False and whole["hospital"]["alarms"]["episodes"] == 5
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    assert abs(datetime.fromisoformat(whole["window_from"]) - week_ago) < timedelta(minutes=1)

    monkeypatch.setattr(quality_router, "READ_CAP", 3)
    cut = await quality(client, w.auth["admin"])
    assert cut["truncated"] is True and cut["hospital"]["alarms"]["episodes"] == 3
    kept = app.state.audit.records(tenant=SLUG, limit=3, newest=True, event_types=QUALITY_KINDS)
    assert cut["window_from"] == kept[0].ts


async def test_the_answer_names_no_patient_key_person_or_free_text(ward, db_session):
    w, client, app = ward
    legacy = await ward_with_a_trail(db_session, w, app)
    await handed(db_session, w, "rea", HandoverStatus.COMPLETED, signed_ago=5, countersigned_ago=1)
    r = await client.get("/quality", headers=w.auth["admin"])
    assert r.status_code == 200, r.text
    for told in (K1, legacy.patient_number, HIS, "ayse.sentetik", "Sentetik Hasta", OTHER_TEXT, RRT_TEXT,
                 str(w.users["nurse"].id), str(w.users["charge"].id), "nurse@kabul", "charge@kabul"):
        assert told not in r.text, told


async def test_another_hospitals_admissions_trail_and_handovers_are_not_counted(ward, db_session):
    """Tenant isolation: the other hospital admitted a patient under the same protocol number in its own unit and
    handed one over; ours still places the key in Reanimasiya, and neither answer counts the other's rows."""
    w, client, app = ward
    await here(db_session, w, "rea", "1", protocol_no=SHARED)
    tenant, unit, bed, their_admin = await other_hospital(db_session)
    await stay(db_session, tenant_id=tenant.id, unit_id=unit.id, bed_id=bed.id, protocol_no=SHARED)
    await handed(db_session, w, None, HandoverStatus.EXPIRED, unit_id=unit.id, people=(their_admin.id, their_admin.id))
    write(app, "first_seen", SHARED, "news2", 30)
    write(app, "first_seen", SHARED, "news2", 20, tenant=OTHER)

    ours = await quality(client, w.auth["admin"])
    assert [u["unit_name"] for u in ours["units"]] == ["Reanimasiya"]
    assert ours["coverage"] == {"episodes": 1, "placed": 1, "unplaced": 0}
    assert ours["hospital"]["handovers"]["opened"] == 0
    theirs = await quality(client, await bearer(db_session, their_admin))
    assert [u["unit_name"] for u in theirs["units"]] == ["Omega YBÜ"]
    assert theirs["coverage"] == {"episodes": 1, "placed": 1, "unplaced": 0}
    assert theirs["hospital"]["handovers"]["opened"] == 1
```

- [ ] **Step 2: Run them on the throwaway Postgres to see them fail**

Start it (see «The throwaway Postgres»), one call each:

```bash
docker run -d --rm --name kalite-pg -p 127.0.0.1:56453:5432 -e POSTGRES_PASSWORD=ozet -e POSTGRES_DB=ozet postgres:16
timeout 60 bash -c 'until docker exec kalite-pg createdb -U postgres ozet_test 2>/dev/null; do :; done'
```

Run: `cd /c/tmp/g4-kalite/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:ozet@127.0.0.1:56453/ozet_test "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_quality_api.py -q -p no:cacheprovider`
Expected: `1 error` during collection: `ImportError: cannot import name 'router' from 'homunculus.quality'`. Keep the container running for Step 5.

- [ ] **Step 3: Write the route**

Create `homunculus-engine/src/homunculus/quality/router.py` with:

```python
# homunculus-engine/src/homunculus/quality/router.py
"""G4-03 «Kalite göstergeleri» (spec 2026-11-11 D4): `GET /quality?days=1|7|30`, for `quality.view`.

THE READS, in the caller's tenant (`caller_tenant_id`; the audit trail under the token's tenant slug, the `tenant`
every row of the trail carries):
1. the audit trail since `now − days`, the newest rows, capped as `/alarm-quality` is (READ_CAP, and one row more to
   know), of the episode kinds and the two acts (`indicators.QUALITY_KINDS`); `truncated` when the cap was hit, and
   then `window_from` is the oldest row kept rather than the period's start;
2. the units the caller reaches, with their names (`unitscope.unit_clause`: a bed grant names a bed, not its unit);
3. the board key → unit map for the keys those rows name (`units_of_keys`);
4. the handovers opened in the window, of those units.
The answer is `indicators.build_report`'s. The audit store is not joinable in SQL on every backend (Postgres in
production, a separate SQLite file in dev, memory in tests), so the map is built from the admissions table here.

`days=1` is the last 24 hours, as on `/alarm-quality`. The page reads it on open, on a period change and on
«Yenile» — never on a timer.
"""
from __future__ import annotations

import asyncio
import uuid
from collections.abc import Iterable
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission import unitscope
from homunculus.admission.boardkey import board_key
from homunculus.admission.models import Admission, Handover, Patient
from homunculus.api.app import ALARM_QUALITY_LIMIT_MAX
from homunculus.auth.dependencies import Principal, caller_tenant_id, get_principal, require_permission
from homunculus.auth.models import User
from homunculus.db import get_db
from homunculus.quality.indicators import QUALITY_KINDS, HandoverFacts, Reach, build_report
from homunculus.tenant.models import Site, Unit

#: G4-03 (spec D3): the Kalite göstergeleri's key.
QUALITY_VIEW = "quality.view"
#: The periods the page offers, in days (spec D4): the last 24 hours, 7 days, 30 days.
QUALITY_DAYS = (1, 7, 30)
#: The most audit rows one answer reads — the newest — as `/alarm-quality` reads them (G2-A2, D12).
READ_CAP = ALARM_QUALITY_LIMIT_MAX
#: The keys one look-up names: asyncpg takes at most 32767 parameters, and each key is named twice.
KEYS_PER_QUERY = 2000

router = APIRouter(tags=["quality"])


async def units_of_keys(db: AsyncSession, tenant_id: uuid.UUID, keys: Iterable[str]) -> dict[str, uuid.UUID]:
    """Spec D4 §3: each board key → the unit its admission was admitted to (`admitting_unit_id`, always the bed's
    unit), in this tenant. The key is the protocol number (admissions since 0015) or, for a legacy admission with
    none, the patient's H-number (`boardkey.board_key`). Every state counts: a past alarm's patient is usually
    discharged. A key with no admission here is left out, and so is one whose admissions name two units (a legacy
    patient admitted twice: ambiguous). Time-invariant while transfers stay closed — an admission's bed never
    changes (spec D6)."""
    wanted = sorted({key for key in keys if isinstance(key, str) and key})
    found: dict[str, set[uuid.UUID]] = {}
    for at in range(0, len(wanted), KEYS_PER_QUERY):
        chunk = wanted[at:at + KEYS_PER_QUERY]
        rows = (await db.execute(
            select(Admission.protocol_no, Patient.patient_number, Admission.admitting_unit_id)
            .join(Patient, Patient.id == Admission.patient_id)
            .where(Admission.tenant_id == tenant_id,
                   or_(Admission.protocol_no.in_(chunk),
                       and_(Admission.protocol_no.is_(None), Patient.patient_number.in_(chunk)))))).all()
        for protocol_no, number, unit_id in rows:
            found.setdefault(board_key(protocol_no, number), set()).add(unit_id)
    return {key: next(iter(units)) for key, units in found.items() if len(units) == 1}


@router.get("/quality")
async def get_quality(
    request: Request,
    days: int = 7,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission(QUALITY_VIEW)),
    principal: Principal = Depends(get_principal),
    caller_tenant: uuid.UUID = Depends(caller_tenant_id),
) -> dict:
    """G4-03 (spec D4): per unit, over the last `days` (1, 7 or 30; 422 otherwise) — alarm response, snoozes, RRT
    calls, handover countersignatures — and the unplaced and the hospital's sums, cut to the caller's units.
    Counts and times only: no patient key, no person, no free text."""
    if days not in QUALITY_DAYS:
        raise HTTPException(status_code=422, detail="days 1, 7 ya da 30 olmalı")
    audit = getattr(request.app.state, "audit", None)
    if audit is None:
        raise HTTPException(status_code=503, detail="denetim kaydı okunamıyor")
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=days)
    cap = READ_CAP
    # On a worker thread: up to READ_CAP rows from the store, and the ward's screens keep the event loop meanwhile.
    rows = await asyncio.to_thread(audit.records, tenant=principal.tenant, since=since, limit=cap + 1,
                                   newest=True, event_types=QUALITY_KINDS)
    truncated = len(rows) > cap
    kept = rows[1:] if truncated else rows
    window_from = kept[0].ts if truncated and kept else since.isoformat()

    scope = await unitscope.caller_scope(db, user.id, caller_tenant)
    within = unitscope.unit_clause(scope, unit_id=Unit.id)
    units = select(Unit.id, Unit.name).join(Site, Site.id == Unit.site_id).where(Site.tenant_id == caller_tenant)
    handovers = (select(Handover.unit_id, Handover.status, Handover.bridge_expires_at, Handover.outgoing_signed_at,
                        Handover.incoming_signed_at)
                 .join(Unit, Unit.id == Handover.unit_id)
                 .join(Site, Site.id == Unit.site_id)
                 .where(Site.tenant_id == caller_tenant, Handover.bridge_opened_at >= since))
    if within is not None:
        units, handovers = units.where(within), handovers.where(within)
    reach = Reach(units={unit_id: name for unit_id, name in (await db.execute(units)).all()},
                  scoped=not scope.unrestricted)
    key_units = await units_of_keys(db, caller_tenant, {rec.patient_id for rec in kept})
    facts = [HandoverFacts(*row) for row in (await db.execute(handovers)).all()]
    return build_report(records=kept, key_units=key_units, reach=reach, handovers=facts, now=now, days=days,
                        window_from=window_from, truncated=truncated)
```

- [ ] **Step 4: Mount it**

In `homunculus-engine/src/homunculus/api/app.py`, find:

```python
    from homunculus.protocol.router import router as protocol_router
    app.include_router(protocol_router)
```

Replace with:

```python
    from homunculus.protocol.router import router as protocol_router
    app.include_router(protocol_router)
    # G4-03: «Kalite göstergeleri» — GET /quality (`quality.view`, the caller's tenant and units).
    from homunculus.quality.router import router as quality_router
    app.include_router(quality_router)
```

(`quality/router.py` imports `ALARM_QUALITY_LIMIT_MAX` from this module at its top. That is no cycle: this module imports the router inside `create_app`, after its own top level has run, as it does every router.)

- [ ] **Step 5: Run the tests to see them pass, then stop the database**

Run: `cd /c/tmp/g4-kalite/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:ozet@127.0.0.1:56453/ozet_test "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_quality_api.py tests/test_quality_indicators.py -q -p no:cacheprovider`
Expected: `21 passed`, no skip (about 35 s). `tests/test_tenant_isolation.py` runs in Task 14 Step 2 (134 tests, 4 to 11 minutes on Postgres).

Then: `docker stop kalite-pg`

One no-DB guard test is **red now by design**, and Task 6 makes it green: `tests/test_nginx_routes.py::test_every_app_route_prefix_is_proxied` (`routers not proxied by nginx: ['/quality']`).

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/g4-kalite && git add homunculus-engine/src/homunculus/quality/router.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_quality_api.py && git commit -m "feat(quality): G4-03 GET /quality?days=1|7|30 — quality.view; the audit trail capped as /alarm-quality, the board key → unit map from the admissions table, the window's handovers; the caller's tenant and units" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/src/homunculus/quality/router.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_quality_api.py
```

---

## Task 5 (engine): migration `0020_quality_view`

**Files:**
- Create: `homunculus-engine/alembic/versions/0020_quality_view.py`
- Test: `homunculus-engine/tests/test_migration_0020_quality_view.py` (new, DB-backed: `clean_db`)

- [ ] **Step 1: Write the failing test**

Create `homunculus-engine/tests/test_migration_0020_quality_view.py` with:

```python
# homunculus-engine/tests/test_migration_0020_quality_view.py
"""G4-03 migration 0020 (spec D7). Without a database: its group is the one `DEFAULT_GROUPS` gives the key to (the
auditor's), and it follows G3-04's 0019. On the real chain (`clean_db`, never `create_all`): `quality.view` goes to
every tenant's `auditor` group and to no other; a group already holding it is left as it is; the downgrade takes the
key from every group — one the hospital gave it to since included — and leaves the groups; 0019 → 0020 → 0019 → 0020
runs, and 0020 is the head. Synthetic rows only."""
from __future__ import annotations

import importlib.util
from pathlib import Path

from alembic import command
from sqlalchemy import create_engine, text

from homunculus.api.audit_postgres import to_sync_url
from homunculus.auth.permissions import DEFAULT_GROUPS
from tests.conftest import TEST_DATABASE_URL, requires_db

#: The rows migration 0020 writes, as (tenant slug, group slug).
GRANTS = ("SELECT t.slug, g.slug FROM group_permissions gp JOIN groups g ON g.id = gp.group_id "
          "JOIN tenants t ON t.id = g.tenant_id WHERE gp.permission = 'quality.view'")
AUDITORS = {("h1", "auditor"), ("h2", "auditor")}


def _tenants_with_groups(sync) -> None:
    """Two tenants, each with an `auditor`, a `nurse` and a group of the hospital's own (`kalite_birimi`)."""
    with sync.begin() as conn:
        for slug in ("h1", "h2"):
            conn.execute(text("INSERT INTO tenants (id, slug, name, country_code, timezone, created_at) "
                              "VALUES (gen_random_uuid(), :s, :s, 'AZ', 'Asia/Baku', now())"), {"s": slug})
            for group in ("auditor", "nurse", "kalite_birimi"):
                conn.execute(text("INSERT INTO groups (id, tenant_id, slug, name, description, mfa_required, "
                                  "is_system, created_at, updated_at) SELECT gen_random_uuid(), id, :g, :g, '', "
                                  "false, false, now(), now() FROM tenants WHERE slug = :s"), {"g": group, "s": slug})


def _grants(sync) -> set[tuple[str, str]]:
    with sync.connect() as conn:
        return {tuple(r) for r in conn.execute(text(GRANTS))}


def test_the_migration_names_the_group_the_catalogue_gives_the_key_to():
    """`DEFAULT_GROUPS` seeds a tenant made later, 0020 the ones seeded before: one group, the auditor's (the system
    group holds every key by rule). No database: the file is loaded by its path (its name starts with a digit)."""
    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0020_quality_view.py"
    spec = importlib.util.spec_from_file_location("migration_0020_quality_view", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    holders = {g["slug"] for g in DEFAULT_GROUPS if "quality.view" in g["permissions"] and not g["is_system"]}
    assert holders == {migration.GROUP} == {"auditor"}
    assert (migration.revision, migration.down_revision, migration.KEY) == ("0020", "0019", "quality.view")


@requires_db
def test_0020_gives_the_key_to_every_auditor_group_and_to_no_other(clean_db):
    _, cfg = clean_db
    command.upgrade(cfg, "0019")
    sync = create_engine(to_sync_url(TEST_DATABASE_URL))
    try:
        _tenants_with_groups(sync)
        command.upgrade(cfg, "0020")
        assert _grants(sync) == AUDITORS
        command.upgrade(cfg, "head")                          # nothing after it
        assert _grants(sync) == AUDITORS
    finally:
        sync.dispose()


@requires_db
def test_an_auditor_group_already_holding_the_key_is_left_as_it_is(clean_db):
    """ON CONFLICT DO NOTHING: a hospital that gave its auditors the key by hand first is not refused."""
    _, cfg = clean_db
    command.upgrade(cfg, "0019")
    sync = create_engine(to_sync_url(TEST_DATABASE_URL))
    try:
        _tenants_with_groups(sync)
        with sync.begin() as conn:
            conn.execute(text("INSERT INTO group_permissions (group_id, permission) SELECT g.id, 'quality.view' "
                              "FROM groups g JOIN tenants t ON t.id = g.tenant_id "
                              "WHERE g.slug = 'auditor' AND t.slug = 'h1'"))
        command.upgrade(cfg, "0020")
        assert _grants(sync) == AUDITORS
    finally:
        sync.dispose()


@requires_db
def test_the_downgrade_takes_the_key_from_every_group_and_leaves_the_groups(clean_db):
    _, cfg = clean_db
    command.upgrade(cfg, "0019")
    sync = create_engine(to_sync_url(TEST_DATABASE_URL))
    try:
        _tenants_with_groups(sync)
        command.upgrade(cfg, "0020")
        with sync.begin() as conn:                            # a hospital gives it to its own group (Roles screen)
            conn.execute(text("INSERT INTO group_permissions (group_id, permission) SELECT id, 'quality.view' "
                              "FROM groups WHERE slug = 'kalite_birimi'"))
        command.downgrade(cfg, "0019")
        assert _grants(sync) == set()
        with sync.connect() as conn:
            assert conn.execute(text("SELECT count(*) FROM groups")).scalar_one() == 6     # the groups stay
        command.upgrade(cfg, "0020")                          # and again
        assert _grants(sync) == AUDITORS
    finally:
        sync.dispose()
```

- [ ] **Step 2: Run it on the throwaway Postgres to see it fail**

Start the container again (Task 4 Step 2, two calls). Run: `cd /c/tmp/g4-kalite/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:ozet@127.0.0.1:56453/ozet_test "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_migration_0020_quality_view.py -q -p no:cacheprovider`
Expected: `4 failed`: the file-reading test cannot find `0020_quality_view.py` (`FileNotFoundError`), and the three on the chain cannot find the revision (`Can't locate revision identified by '0020'`).

- [ ] **Step 3: Write the migration**

Create `homunculus-engine/alembic/versions/0020_quality_view.py` with:

```python
# homunculus-engine/alembic/versions/0020_quality_view.py
"""G4-03 Kalite göstergeleri (spec D2, D7): `quality.view` for the default `auditor` group («Denetçi») of every tenant.

Revision 0020, follows G3-04's 0019 (pharmacy_view).

* `group_permissions`: `quality.view` for every group whose slug is `auditor`, in every tenant (0017's and 0019's
  pattern). tests/test_migration_0020_quality_view.py holds GROUP to `DEFAULT_GROUPS`. A
  group the hospital made itself is not touched. `ensure_default_groups` creates missing groups only; `DEFAULT_GROUPS`
  seeds the key for a tenant made later, and the system group holds it by rule.
* No schema change.

PURELY ADDITIVE: an image from before this revision serves against it — a key its catalogue does not know never
reaches a token (`auth/groups.py`). The downgrade deletes the key from every group, as 0017's does for its keys — a
group the hospital gave it to since included: the code before this revision has no such key.
ONE STATEMENT PER op.execute (asyncpg).

Revision ID: 0020
Revises: 0019
Create Date: 2026-11-11
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0020"
down_revision: Union[str, None] = "0019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

KEY = "quality.view"
#: The one non-system default group that holds the key (auth/permissions.py DEFAULT_GROUPS; spec D2, D7).
GROUP = "auditor"


def upgrade() -> None:
    op.execute(f"INSERT INTO group_permissions (group_id, permission) SELECT id, '{KEY}' FROM groups "
               f"WHERE slug = '{GROUP}' ON CONFLICT DO NOTHING")


def downgrade() -> None:
    op.execute(f"DELETE FROM group_permissions WHERE permission = '{KEY}'")
```

- [ ] **Step 4: Run the migration tests and the chain's other tests, then stop the database**

Run: `cd /c/tmp/g4-kalite/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:ozet@127.0.0.1:56453/ozet_test "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_migration_0020_quality_view.py tests/test_migration_0019_pharmacy_view.py tests/test_migration_0018_care_team_transfer.py tests/test_tasks_postgres.py -q -p no:cacheprovider`
Expected: `30 passed`, no skip.

Then: `docker stop kalite-pg`

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g4-kalite && git add homunculus-engine/alembic/versions/0020_quality_view.py homunculus-engine/tests/test_migration_0020_quality_view.py && git commit -m "feat(migration): G4-03 0020_quality_view — quality.view for every tenant's default auditor group, after G3-04's 0019; downgrade takes the key back" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/alembic/versions/0020_quality_view.py homunculus-engine/tests/test_migration_0020_quality_view.py
```

---

## Task 6 (engine): the route tables, the proxied paths

**Files:**
- Modify: `deploy/local/web/nginx.conf` (the API `location` regex)
- Modify: `dashboard/vite.config.js` (the dev server's proxy list; `src/devProxy.test.js` holds it to nginx's list, so the two change together, in this task)
- Test: `homunculus-engine/tests/test_route_permissions.py` (`GUARDED_MODULES`, `EXPECTED`, the count)
- Test: `homunculus-engine/tests/test_nginx_routes.py` (`API_PATHS`)

Already covered with no edit (checked in Step 1):
- `tests/test_tenant_isolation.py`: the route resolves `caller_tenant_id`, so it stays out of `UNSCOPED_BY_DESIGN` by that test's own rule;
- `tests/test_board_permissions.py`: `BOARD_EXPECTED` counts `homunculus.api.app` routes only;
- `tests/test_route_inventory.py`: `require_permission` reaches `get_principal`;
- `tests/test_access_log_redaction.py` and the access-log map: `/quality` has no parameter and no catch-all prefix takes it, so the map's `default $uri` logs it as it is — no map line (plan note N13).

- [ ] **Step 1: Run the guard tests to see what Task 4 left red**

Run: `cd /c/tmp/g4-kalite/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_route_permissions.py tests/test_tenant_isolation.py tests/test_board_permissions.py tests/test_nginx_routes.py tests/test_access_log_redaction.py tests/test_route_inventory.py -q -p no:cacheprovider`
Expected: `1 failed, 152 passed, 139 skipped`: `test_every_app_route_prefix_is_proxied`, which reports `routers not proxied by nginx: ['/quality']`.

- [ ] **Step 2: Write the route into the guard table**

In `homunculus-engine/tests/test_route_permissions.py`, find:

```python
    "homunculus.protocol.router",       # G2-B1d
}
```

Replace with:

```python
    "homunculus.protocol.router",       # G2-B1d
    "homunculus.quality.router",        # G4-03
}
```

Then find:

```python
    ("PUT", "/admin/protocol-settings"): ANY(_S),
}
```

Replace with:

```python
    ("PUT", "/admin/protocol-settings"): ANY(_S),
    # quality/router.py — G4-03 (spec D4): Kalite göstergeleri
    ("GET", "/quality"): ANY("quality.view"),
}
```

Then find:

```python
    assert len(EXPECTED) == 75      # G2-B3a: +5 (the bed moves, the occupancy read); G2-B3b: +2 (my handovers, colleagues); G2-B1c: +2, the picker, the end; G4-02: +1, GET /handovers/pending
```

Replace with:

```python
    assert len(EXPECTED) == 76      # G2-B3a: +5 (the bed moves, the occupancy read); G2-B3b: +2 (my handovers, colleagues); G2-B1c: +2, the picker, the end; G4-02: +1, GET /handovers/pending; G4-03: +1, GET /quality
```

- [ ] **Step 3: Proxy the path**

In `deploy/local/web/nginx.conf`, find:

```nginx
    location ~ ^/(auth|admin|tenant|admissions|shift-schedule|handovers|alerts|break-glass|scope|clinical|scores|alarm-quality|infinity-research|infinity-shadow|infinity-waves|patients|ack|ingest|view|audit|health|tasks|pharmacy)(/|$) {
```

Replace with:

```nginx
    location ~ ^/(auth|admin|tenant|admissions|shift-schedule|handovers|alerts|break-glass|scope|clinical|scores|alarm-quality|infinity-research|infinity-shadow|infinity-waves|patients|ack|ingest|view|audit|health|tasks|pharmacy|quality)(/|$) {
```

In `dashboard/vite.config.js`, find:

```js
      "/pharmacy",          // G3-04: Eczane — the pharmacist's ward page
```

Replace with:

```js
      "/pharmacy",          // G3-04: Eczane — the pharmacist's ward page
      "/quality",           // G4-03: Kalite göstergeleri — GET /quality
```

In `homunculus-engine/tests/test_nginx_routes.py`, find:

```python
    "/infinity-waves/192.0.2.10", "/patients", "/pharmacy", "/ack",
```

Replace with:

```python
    "/infinity-waves/192.0.2.10", "/patients", "/pharmacy", "/quality", "/ack",
```

- [ ] **Step 4: Run the guard tests to see them pass**

Run: `cd /c/tmp/g4-kalite/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_route_permissions.py tests/test_tenant_isolation.py tests/test_board_permissions.py tests/test_nginx_routes.py tests/test_access_log_redaction.py tests/test_route_inventory.py -q -p no:cacheprovider`
Expected: `154 passed, 139 skipped`.

Then the dev server's proxy, which must list every path nginx proxies: `cd /c/tmp/g4-kalite/dashboard && npx vitest run src/devProxy.test.js`
Expected: `Tests 5 passed (5)`.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g4-kalite && git add homunculus-engine/tests/test_route_permissions.py homunculus-engine/tests/test_nginx_routes.py deploy/local/web/nginx.conf dashboard/vite.config.js && git commit -m "test(routes): G4-03 GET /quality in the guard table (76, quality.view), proxied by nginx and by the dev server, among the proxied paths" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/tests/test_route_permissions.py homunculus-engine/tests/test_nginx_routes.py deploy/local/web/nginx.conf dashboard/vite.config.js
```

The engine lane is done: report the six shas to the coordinator.

---

# Dashboard lane (starts once Task 1 is committed)

## Task 7 (dashboard): the `kalite` strings and the `quality.view` mirrors

**Files:**
- Create: `dashboard/src/live/i18n/kalite.strings.test.js`
- Create: `dashboard/src/live/i18n/strings/kalite.js`
- Modify: `dashboard/src/live/i18n/catalog.js` (the import after `eczane`; `NAMESPACES` after `eczane`)
- Modify: `dashboard/src/live/i18n/strings.test.js` (`NEUTRAL`, after the devir block)
- Modify: `dashboard/src/live/i18n/strings/perms.js` (four languages, after `pharmacy`)
- Modify: `dashboard/src/live/screens/admin/catalogue.js` (`PERMISSION_KEYS`, last)
- Modify: `dashboard/src/live/screens/admin/admin.testutil.js` (`PERMISSION_TEXTS`, last)

- [ ] **Step 1: Write the failing test**

Create `dashboard/src/live/i18n/kalite.strings.test.js` with:

```js
// G4-03 «Kalite göstergeleri» (spec 2026-11-11 D5): the quality page's words (strings/kalite.js) — the spec's own
// Turkish, none of the prototype's figures that have no source, no suffix glued to a number, the period named on the
// cards and the selection on the kinds.
import { describe, it, expect } from "vitest";
import { DICTIONARIES } from "./catalog.js";
import { LANG_CODES } from "./langs.js";

const fill = (template, vars) => template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name]));
const kalite = (lang) => Object.entries(DICTIONARIES[lang]).filter(([key]) => key.startsWith("kalite."));

describe("the quality page's words (kalite)", () => {
  it("says the spec's Turkish", () => {
    const tr = DICTIONARIES.tr;
    expect([tr["kalite.nav"], tr["kalite.title"], tr["kalite.motto"]])
      .toEqual(["Kalite göstergeleri", "Kalite göstergeleri", "Süreç ölçülür, kişi değil"]);
    expect(fill(tr["kalite.coverage"], { episodes: 40, placed: 31 }))
      .toBe("Bu dönemde 40 alarm olayından 31 tanesi bir birime bağlanabildi.");
    expect(tr["kalite.coverageWhy"]).toBe(
      "Birime bağlanamayanlar: bu sistemde kabul kaydı olmayan (HBYS'den gelen ya da kimliği olmayan monitör) hastalar.");
    expect(tr["kalite.coverageScoped"]).toMatch(/^Yalnız kapsamınızdaki birimler/);
    expect(fill(tr["kalite.cards.selfResolved"], { n: 2 })).toBe("2 tanesi kendiliğinden düzeldi");
    expect([tr["kalite.units.unplaced"], tr["kalite.units.total"], tr["kalite.noReach"]])
      .toEqual(["Birimi belli olmayan", "Toplam", "Kapsamınızda birim yok."]);
    expect(tr["kalite.units.colUnanswered"]).toBe("Yanıtsız (kendiliğinden düzelen)");
    expect(tr["kalite.units.colHandovers"]).toBe("Devir (açılan / karşı imzalı / bekleyen)");
    expect(fill(tr["kalite.pct"], { pct: 82 })).toBe("%82");
  });

  it("leaves out the prototype's figures that have no source", () => {
    for (const lang of LANG_CODES) {
      for (const [key, value] of kalite(lang)) {
        expect(value, `${lang} ${key}`).not.toMatch(/\b3 (dk|dəq|мин|min)\b|Hatalı|Səhv|Ошибочн|Güvenlik olay|İncelenecek|Rapor al|30 dk içinde/i);
      }
    }
  });

  it("glues no suffix to a number, a time or a date in Turkish or Azerbaijani", () => {
    for (const lang of ["tr", "az"]) {
      for (const [key, value] of kalite(lang)) {
        expect(value, `${lang} ${key}`)
          .not.toMatch(/\{(n|pct|episodes|placed|answered|settled|high|moderate|from|period|unit|reason|why)\}[^\s·;,.:)%]/);
      }
    }
  });

  it("names the period on the cards and the selection on the kinds, in every language", () => {
    for (const lang of LANG_CODES) {
      for (const key of ["kalite.cards.title", "kalite.cards.titleScoped"]) {
        expect(DICTIONARIES[lang][key], `${lang} ${key}`).toContain("{period}");
      }
      expect(DICTIONARIES[lang]["kalite.kinds.title"], lang).toContain("{unit}");
    }
  });
});
```

- [ ] **Step 2: Run it and the catalogue's mirror tests to see them fail**

Run: `cd /c/tmp/g4-kalite/dashboard && npx vitest run src/live/i18n/kalite.strings.test.js src/live/screens/admin/catalogue.test.js src/live/screens/admin/admin.testutil.test.js`
Expected: `4 failed | 18 passed`.
- `kalite.strings.test.js` fails twice; first with `expected [ undefined, undefined, undefined ] to deeply equal [ 'Kalite göstergeleri', … ]`.
- `catalogue.test.js` fails "has the backend's keys, in the backend's order": the backend has `quality.view` since Task 1, the mirror does not.
- `admin.testutil.test.js` fails "the permission descriptions are the server's, word for word".

- [ ] **Step 3: Write the namespace**

Create `dashboard/src/live/i18n/strings/kalite.js` with:

```js
// G4-03 «Kalite göstergeleri» (screens/kalite/, spec 2026-11-11 D5): care-process quality per unit, from what the system
// really records — alarm response, snoozes, RRT calls, handover countersignatures. Every number is real or says why it
// is missing (the summary page's `ozet.why.*`, after a «—»); none of the prototype's figures without a source («3 dk
// içinde yanıtlanan», «Hatalı / artefakt», «Güvenlik olayları», «İncelenecek olaylar», «Rapor al») is here. No
// patient and no person anywhere. The period's names, «Yenile», «HH:MM itibarıyla», a duration's words and a rate over
// nothing («henüz yerleşen yok») are the summary page's own (`ozet.*`), so one thing has one name on both pages.
//
// TR is the source; AZ is the default. AZ, RU and EN are the planner's and await a native reading before the pilot. No
// suffix is glued to a number, a time or a date (kalite.strings.test.js). No text here is clinical advice.
export default {
  tr: {
    nav: "Kalite göstergeleri", navShort: "Kalite",
    title: "Kalite göstergeleri",
    motto: "Süreç ölçülür, kişi değil",
    intro: "Birim birim bakım süreci, yalnız sistemin gerçekten kaydettiğinden: alarm yanıtı, erteleme, RRT çağrısı ve devrin karşı imzası. Hasta adı, kimliği ya da kişi adı gösterilmez. Okunamayan bir sayı «—» ve nedeniyle yazılır, asla 0 yazılmaz. Sayfa açılınca, dönem değişince ve «Yenile» ile okunur; kendiliğinden yenilenmez.",
    noRead: "Henüz okunmadı",
    pct: "%{pct}",
    coverage: "Bu dönemde {episodes} alarm olayından {placed} tanesi bir birime bağlanabildi.",
    coverageWhy: "Birime bağlanamayanlar: bu sistemde kabul kaydı olmayan (HBYS'den gelen ya da kimliği olmayan monitör) hastalar.",
    coverageScoped: "Yalnız kapsamınızdaki birimler: bu dönemde bu birimlere {placed} alarm olayı bağlandı.",
    noReach: "Kapsamınızda birim yok.",
    truncated: "Sunucunun okuma sınırı aşıldı: yalnız en yeni kayıtlar okundu; alarm, erteleme ve RRT sayıları {from} ile başlıyor, daha eskiler sayılmadı. Devirler dönemin tamamından sayıldı.",
    failed: "Kalite göstergeleri okunamadı: {reason}",
    unreadable: "Kalite göstergeleri okunamadı.",
    cards: {
      title: "Hastane geneli · {period}",
      titleScoped: "Kapsamınızdaki birimler · {period}",
      median: "Alarm yanıt süresi (ortanca)",
      rate: "Yanıtlanan alarm",
      rateOf: "yerleşen {settled} alarm olayından {answered} tanesi",
      escalated: "Eskale edilen alarm",
      unanswered: "Yanıtsız kalan alarm",
      selfResolved: "{n} tanesi kendiliğinden düzeldi",
      snoozes: "Ertelenen alarm",
      snoozeSplit: "{high} yüksek · {moderate} orta",
      rrt: "RRT çağrısı",
      countersign: "Devir karşı imza süresi (ortanca)",
      noCountersigned: "karşı imzalanan yok",
    },
    units: {
      title: "Birimlere göre",
      caption: "Birimlere göre kalite göstergeleri",
      loading: "Kalite göstergeleri okunuyor…",
      missing: "Tablo yazılamıyor · {why}",
      colUnit: "Birim", colEpisodes: "Alarm", colMedian: "Yanıt ortancası", colP90: "Yanıt p90", colRate: "Yanıtlanan",
      colEscalated: "Eskale", colUnanswered: "Yanıtsız (kendiliğinden düzelen)", colSnoozes: "Ertele",
      colRrt: "RRT çağrısı", colHandovers: "Devir (açılan / karşı imzalı / bekleyen)",
      colCountersign: "Karşı imza ortancası",
      unplaced: "Birimi belli olmayan",
      total: "Toplam",
      selectNote: "Bir birimin adına dokunun: erteleme nedenleri ve türe göre alarmlar o birim için de yazılır.",
      unplacedNote: "«Birimi belli olmayan»: bu sistemde kabul kaydı olmayan hastaların alarmları, ertelemeleri ve RRT çağrıları. Her devrin birimi bellidir.",
    },
    snoozes: {
      title: "Erteleme nedenleri",
      caption: "Erteleme nedenleri",
      colReason: "Neden", colHospital: "Hastane geneli", colScoped: "Kapsamınızdaki birimler",
      rowTotal: "Toplam", rowMedian: "Ortanca süre", minutes: "{n} dk",
      none: "Bu dönemde erteleme yok.",
    },
    kinds: {
      title: "Türe göre alarmlar · {unit}",
      caption: "Türe göre alarmlar",
      colKind: "Tür", colEpisodes: "Olay", colAnswered: "Yanıtlanan", colEscalated: "Eskale", colUnanswered: "Yanıtsız",
      colMedian: "Ortanca yanıt",
      none: "Bu seçimde alarm olayı yok.",
    },
  },
  az: {
    nav: "Keyfiyyət göstəriciləri", navShort: "Keyfiyyət",
    title: "Keyfiyyət göstəriciləri",
    motto: "Proses ölçülür, şəxs yox",
    intro: "Şöbə-şöbə qulluq prosesi, yalnız sistemin həqiqətən qeyd etdiklərindən: siqnala cavab, təxirə salma, RRT çağırışı və təhvilin əks-imzası. Xəstə adı, kimliyi və ya şəxs adı göstərilmir. Oxunmayan rəqəm «—» və səbəbi ilə yazılır, heç vaxt 0 yazılmır. Səhifə açılanda, dövr dəyişəndə və «Yenilə» ilə oxunur; özü yenilənmir.",
    noRead: "Hələ oxunmayıb",
    pct: "{pct}%",
    coverage: "Bu dövrdə {episodes} siqnal epizodundan {placed} ədədi şöbəyə bağlana bildi.",
    coverageWhy: "Şöbəyə bağlanmayanlar: bu sistemdə qəbul qeydi olmayan (xəstəxana informasiya sistemindən gələn və ya kimliyi olmayan monitor) xəstələr.",
    coverageScoped: "Yalnız əhatənizdəki şöbələr: bu dövrdə bu şöbələrə {placed} siqnal epizodu bağlandı.",
    noReach: "Əhatənizdə şöbə yoxdur.",
    truncated: "Serverin oxuma həddi aşıldı: yalnız ən yeni qeydlər oxundu; siqnal, təxirə salma və RRT sayları {from} ilə başlayır, daha köhnələr sayılmadı. Təhvillər dövrün tamamından sayıldı.",
    failed: "Keyfiyyət göstəriciləri oxunmadı: {reason}",
    unreadable: "Keyfiyyət göstəriciləri oxunmadı.",
    cards: {
      title: "Bütün xəstəxana · {period}",
      titleScoped: "Əhatənizdəki şöbələr · {period}",
      median: "Siqnala cavab müddəti (median)",
      rate: "Cavablanan siqnal",
      rateOf: "yekunlaşan {settled} siqnal epizodundan {answered} ədədi",
      escalated: "Eskalasiya edilən siqnal",
      unanswered: "Cavabsız qalan siqnal",
      selfResolved: "{n} ədədi öz-özünə düzəldi",
      snoozes: "Təxirə salınan siqnal",
      snoozeSplit: "{high} yüksək · {moderate} orta",
      rrt: "RRT çağırışı",
      countersign: "Təhvilin əks-imza müddəti (median)",
      noCountersigned: "əks-imzalanan yoxdur",
    },
    units: {
      title: "Şöbələrə görə",
      caption: "Şöbələrə görə keyfiyyət göstəriciləri",
      loading: "Keyfiyyət göstəriciləri oxunur…",
      missing: "Cədvəl yazıla bilmir · {why}",
      colUnit: "Şöbə", colEpisodes: "Siqnal", colMedian: "Cavab medianı", colP90: "Cavab p90", colRate: "Cavablanan",
      colEscalated: "Eskalasiya", colUnanswered: "Cavabsız (öz-özünə düzələn)", colSnoozes: "Təxirə salma",
      colRrt: "RRT çağırışı", colHandovers: "Təhvil (açılan / əks-imzalı / gözləyən)",
      colCountersign: "Əks-imza medianı",
      unplaced: "Şöbəsi bəlli olmayan",
      total: "Cəmi",
      selectNote: "Şöbənin adına toxunun: təxirə salma səbəbləri və növə görə siqnallar o şöbə üçün də yazılır.",
      unplacedNote: "«Şöbəsi bəlli olmayan»: bu sistemdə qəbul qeydi olmayan xəstələrin siqnalları, təxirə salmaları və RRT çağırışları. Hər təhvilin şöbəsi bəllidir.",
    },
    snoozes: {
      title: "Təxirə salma səbəbləri",
      caption: "Təxirə salma səbəbləri",
      colReason: "Səbəb", colHospital: "Bütün xəstəxana", colScoped: "Əhatənizdəki şöbələr",
      rowTotal: "Cəmi", rowMedian: "Median müddət", minutes: "{n} dəq",
      none: "Bu dövrdə təxirə salma yoxdur.",
    },
    kinds: {
      title: "Növə görə siqnallar · {unit}",
      caption: "Növə görə siqnallar",
      colKind: "Növ", colEpisodes: "Epizod", colAnswered: "Cavablanan", colEscalated: "Eskalasiya",
      colUnanswered: "Cavabsız", colMedian: "Median cavab",
      none: "Bu seçimdə siqnal epizodu yoxdur.",
    },
  },
  ru: {
    nav: "Показатели качества", navShort: "Качество",
    title: "Показатели качества",
    motto: "Измеряется процесс, а не человек",
    intro: "Процесс ухода по отделениям, только по тому, что система действительно записала: ответ на тревогу, отложенные тревоги, вызовы RRT и встречная подпись передачи смены. Имена и идентификаторы пациентов и имена сотрудников не показываются. Непрочитанное число пишется как «—» с причиной и никогда как 0. Читается при открытии страницы, при смене периода и по кнопке «Обновить»; само не обновляется.",
    noRead: "Ещё не прочитано",
    pct: "{pct} %",
    coverage: "За этот период из {episodes} эпизодов тревог к отделению удалось привязать {placed}.",
    coverageWhy: "Не привязаны: пациенты без записи о поступлении в этой системе (из больничной информационной системы или с монитора без идентификатора).",
    coverageScoped: "Только отделения вашей области: за этот период к ним привязано эпизодов тревог: {placed}.",
    noReach: "В вашей области нет отделений.",
    truncated: "Достигнут предел чтения сервера: прочитаны только самые новые записи; тревоги, отложенные тревоги и вызовы RRT считаются с {from}, более ранние не учтены. Передачи смены учтены за весь период.",
    failed: "Показатели качества не прочитаны: {reason}",
    unreadable: "Показатели качества не прочитаны.",
    cards: {
      title: "Вся больница · {period}",
      titleScoped: "Отделения вашей области · {period}",
      median: "Время ответа на тревогу (медиана)",
      rate: "Тревоги с ответом",
      rateOf: "{answered} из {settled} завершённых эпизодов",
      escalated: "Эскалированные тревоги",
      unanswered: "Тревоги без ответа",
      selfResolved: "из них прошли сами: {n}",
      snoozes: "Отложенные тревоги",
      snoozeSplit: "высоких: {high} · средних: {moderate}",
      rrt: "Вызовы RRT",
      countersign: "Время встречной подписи передачи (медиана)",
      noCountersigned: "встречных подписей нет",
    },
    units: {
      title: "По отделениям",
      caption: "Показатели качества по отделениям",
      loading: "Показатели качества читаются…",
      missing: "Таблицу не построить · {why}",
      colUnit: "Отделение", colEpisodes: "Тревоги", colMedian: "Медиана ответа", colP90: "Ответ p90",
      colRate: "С ответом", colEscalated: "Эскалация", colUnanswered: "Без ответа (прошли сами)", colSnoozes: "Отложено",
      colRrt: "Вызовы RRT", colHandovers: "Передачи (начато / подписано / ждут)",
      colCountersign: "Медиана встречной подписи",
      unplaced: "Отделение не известно",
      total: "Итого",
      selectNote: "Нажмите на название отделения: причины откладывания и тревоги по типам покажутся и для него.",
      unplacedNote: "«Отделение не известно»: тревоги, отложенные тревоги и вызовы RRT пациентов без записи о поступлении в этой системе. У каждой передачи смены отделение известно.",
    },
    snoozes: {
      title: "Причины откладывания",
      caption: "Причины откладывания",
      colReason: "Причина", colHospital: "Вся больница", colScoped: "Отделения вашей области",
      rowTotal: "Итого", rowMedian: "Медианная длительность", minutes: "{n} мин",
      none: "За этот период тревоги не откладывались.",
    },
    kinds: {
      title: "Тревоги по типам · {unit}",
      caption: "Тревоги по типам",
      colKind: "Тип", colEpisodes: "Эпизоды", colAnswered: "С ответом", colEscalated: "Эскалация",
      colUnanswered: "Без ответа", colMedian: "Медиана ответа",
      none: "В этом выборе нет эпизодов тревог.",
    },
  },
  en: {
    nav: "Quality indicators", navShort: "Quality",
    title: "Quality indicators",
    motto: "The process is measured, not the person",
    intro: "The care process unit by unit, only from what the system really recorded: alarm response, snoozes, RRT calls and the handover countersignature. No patient's name or id and no person's name is shown. A number that could not be read is written «—» with its reason, never 0. Read when the page opens, when the period changes and on «Refresh»; it does not refresh by itself.",
    noRead: "Not read yet",
    pct: "{pct}%",
    coverage: "In this period {placed} of {episodes} alarm episodes could be tied to a unit.",
    coverageWhy: "Not tied to a unit: patients with no admission in this system (fed from the hospital information system, or a monitor with no patient id).",
    coverageScoped: "Only the units in your scope: {placed} alarm episodes were tied to them in this period.",
    noReach: "No unit is in your scope.",
    truncated: "The server's read limit was reached: only the newest records were read; alarms, snoozes and RRT calls are counted from {from}, older ones were not counted. Handovers are counted over the whole period.",
    failed: "The quality indicators could not be read: {reason}",
    unreadable: "The quality indicators could not be read.",
    cards: {
      title: "Hospital-wide · {period}",
      titleScoped: "The units in your scope · {period}",
      median: "Alarm response time (median)",
      rate: "Alarms answered",
      rateOf: "{answered} of {settled} settled episodes",
      escalated: "Alarms escalated",
      unanswered: "Alarms left unanswered",
      selfResolved: "{n} of them cleared by themselves",
      snoozes: "Alarms snoozed",
      snoozeSplit: "{high} high · {moderate} moderate",
      rrt: "RRT calls",
      countersign: "Handover countersignature time (median)",
      noCountersigned: "none countersigned",
    },
    units: {
      title: "By unit",
      caption: "Quality indicators by unit",
      loading: "Reading the quality indicators…",
      missing: "The table cannot be drawn · {why}",
      colUnit: "Unit", colEpisodes: "Alarms", colMedian: "Median response", colP90: "Response p90", colRate: "Answered",
      colEscalated: "Escalated", colUnanswered: "Unanswered (cleared by themselves)", colSnoozes: "Snoozed",
      colRrt: "RRT calls", colHandovers: "Handovers (opened / countersigned / waiting)",
      colCountersign: "Median countersignature",
      unplaced: "Unit not known",
      total: "Total",
      selectNote: "Tap a unit's name: the snooze reasons and the alarms by kind are then written for that unit too.",
      unplacedNote: "«Unit not known»: the alarms, snoozes and RRT calls of patients with no admission in this system. Every handover's unit is known.",
    },
    snoozes: {
      title: "Snooze reasons",
      caption: "Snooze reasons",
      colReason: "Reason", colHospital: "Hospital-wide", colScoped: "The units in your scope",
      rowTotal: "Total", rowMedian: "Median length", minutes: "{n} min",
      none: "No alarm was snoozed in this period.",
    },
    kinds: {
      title: "Alarms by kind · {unit}",
      caption: "Alarms by kind",
      colKind: "Kind", colEpisodes: "Episodes", colAnswered: "Answered", colEscalated: "Escalated",
      colUnanswered: "Unanswered", colMedian: "Median response",
      none: "No alarm episode in this selection.",
    },
  },
};
```

- [ ] **Step 4: Register the namespace**

In `dashboard/src/live/i18n/catalog.js`, find:

```js
import eczane from "./strings/eczane.js";
```

Replace with:

```js
import eczane from "./strings/eczane.js";

// G4-03: «Kalite göstergeleri» — care-process quality per unit (screens/kalite).
import kalite from "./strings/kalite.js";
```

Then find:

```js
  eczane, // G3-04
```

Replace with:

```js
  eczane, // G3-04

  kalite, // G4-03
```

- [ ] **Step 5: List the one language-neutral text**

In `dashboard/src/live/i18n/strings.test.js`, find:

```js
  "devir.fromTo", //               "{from} → {to}" — no word in it

]);
```

Replace with:

```js
  "devir.fromTo", //               "{from} → {to}" — no word in it

  // G4-03 (kalite) · neutral — a number and the percent sign: the Russian «{pct} %» has no word to write in Cyrillic
  "kalite.pct",

]);
```

(No az text of the namespace equals its tr source, so `AZ_SAME_AS_TR` gains nothing.)

- [ ] **Step 6: Mirror `quality.view`**

In `dashboard/src/live/screens/admin/catalogue.js`, find:

```js
  "pharmacy.view",
]);
```

Replace with:

```js
  "pharmacy.view",

  // G4-03 — Kalite göstergeleri (spec D2, D3): the page and GET /quality; the default auditor group holds it (migration
  // 0020), the system one by rule
  "quality.view",
]);
```

In `dashboard/src/live/screens/admin/admin.testutil.js`, find:

```js
  "pharmacy.view": "Open the Eczane page: per patient in one's own units — vasopressors, the antibiotic clock, creatinine and the day's fluid balance; read-only",
});
```

Replace with:

```js
  "pharmacy.view": "Open the Eczane page: per patient in one's own units — vasopressors, the antibiotic clock, creatinine and the day's fluid balance; read-only",
  // G4-03
  "quality.view": "Open the Kalite göstergeleri page and read per-unit care-process indicators (GET /quality), as counts and times only",
});
```

In `dashboard/src/live/i18n/strings/perms.js`, make four edits, one per language.

Find (tr):

```js
    pharmacy: { view: "“Eczane” sayfasını açar: kendi birimlerindeki hastaların vazopresörlerini, antibiyotik süresini, kreatininini ve günün sıvı dengesini salt okunur görür" },
```

Replace with:

```js
    pharmacy: { view: "“Eczane” sayfasını açar: kendi birimlerindeki hastaların vazopresörlerini, antibiyotik süresini, kreatininini ve günün sıvı dengesini salt okunur görür" },
    // G4-03 — Kalite göstergeleri
    quality: { view: "Kalite göstergelerini görür" },
```

Find (az):

```js
    pharmacy: { view: "“Aptek” səhifəsini açır: öz şöbələrindəki xəstələrin vazopressorlarını, antibiotik müddətini, kreatininini və günün maye balansını yalnız oxumaq üçün görür" },
```

Replace with:

```js
    pharmacy: { view: "“Aptek” səhifəsini açır: öz şöbələrindəki xəstələrin vazopressorlarını, antibiotik müddətini, kreatininini və günün maye balansını yalnız oxumaq üçün görür" },
    // G4-03 — Kalite göstergeleri
    quality: { view: "Keyfiyyət göstəricilərini görür" },
```

Find (ru):

```js
    pharmacy: { view: "Открывает страницу «Аптека»: видит вазопрессоры, срок для антибиотика, креатинин и суточный баланс жидкости пациентов своих отделений — только чтение" },
```

Replace with:

```js
    pharmacy: { view: "Открывает страницу «Аптека»: видит вазопрессоры, срок для антибиотика, креатинин и суточный баланс жидкости пациентов своих отделений — только чтение" },
    // G4-03 — Kalite göstergeleri
    quality: { view: "Видит показатели качества" },
```

Find (en):

```js
    pharmacy: { view: "Open the “Pharmacy” page: see the vasopressors, the antibiotic window, creatinine and the day's fluid balance of the patients in one's own units, read-only" },
```

Replace with:

```js
    pharmacy: { view: "Open the “Pharmacy” page: see the vasopressors, the antibiotic window, creatinine and the day's fluid balance of the patients in one's own units, read-only" },
    // G4-03 — Kalite göstergeleri
    quality: { view: "See the quality indicators" },
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `cd /c/tmp/g4-kalite/dashboard && npx vitest run src/live/i18n/strings.test.js src/live/i18n/kalite.strings.test.js src/live/i18n/ozet.strings.test.js src/live/screens/admin/catalogue.test.js src/live/screens/admin/admin.testutil.test.js src/live/screens/admin/RolesTab.test.jsx src/live/screens/admin/RolesTab.server.test.jsx`
Expected: `Test Files 7 passed (7)` and `Tests 93 passed (93)`.

`RolesTab.test.jsx` holds `perms.js` to the catalogue in four languages. `strings.test.js` fails here if an az text equals its tr source without a reviewed `AZ_SAME_AS_TR` line, or a ru text has no Cyrillic outside `NEUTRAL`.

- [ ] **Step 8: Commit**

```bash
cd /c/tmp/g4-kalite && git add dashboard/src/live/i18n/strings/kalite.js dashboard/src/live/i18n/kalite.strings.test.js dashboard/src/live/i18n/catalog.js dashboard/src/live/i18n/strings.test.js dashboard/src/live/i18n/strings/perms.js dashboard/src/live/screens/admin/catalogue.js dashboard/src/live/screens/admin/admin.testutil.js && git commit -m "feat(i18n): G4-03 the kalite namespace in four languages; quality.view in the catalogue mirror, the fixtures and perms.js" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/live/i18n/strings/kalite.js dashboard/src/live/i18n/kalite.strings.test.js dashboard/src/live/i18n/catalog.js dashboard/src/live/i18n/strings.test.js dashboard/src/live/i18n/strings/perms.js dashboard/src/live/screens/admin/catalogue.js dashboard/src/live/screens/admin/admin.testutil.js
```

---

## Task 8 (dashboard): `qualityIndicators(days)` in the API client

**Files:**
- Modify: `dashboard/src/backendApi.js` (after `pendingHandovers`)
- Modify: `dashboard/src/live/session/testTokens.testutil.js` (`fakeApi`, after `pendingHandovers`)
- Test: `dashboard/src/backendApi.test.js` (before the "opens a handover" test)

- [ ] **Step 1: Write the failing test**

In `dashboard/src/backendApi.test.js`, find:

```js
  it("opens a handover of one admission to one receiver: POST /handovers {unit_id, incoming_user_id, admission_ids}", async () => {
```

Replace with:

```js
  // G4-03 (spec D4): «Kalite göstergeleri» — per unit, alarm response, snoozes, RRT calls, handover countersignatures.
  it("reads the quality indicators for a period with an authed GET /quality?days=, 7 by default", async () => {
    const answer = { days: 30, units: [] };
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(answer)));
    const api = signedIn(fetchMock);
    expect(await api.qualityIndicators(30)).toEqual(answer);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/quality?days=30");
    expect(init.method || "GET").toBe("GET");
    expect(init.headers.Authorization).toBe("Bearer acc-1");
    expect(init.body).toBeUndefined();
    await api.qualityIndicators();
    expect(fetchMock.mock.calls[1][0]).toBe("/quality?days=7");
  });

  it("opens a handover of one admission to one receiver: POST /handovers {unit_id, incoming_user_id, admission_ids}", async () => {
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/tmp/g4-kalite/dashboard && npx vitest run src/backendApi.test.js`
Expected: `1 failed | 146 passed`, with `TypeError: api.qualityIndicators is not a function`.

- [ ] **Step 3: Write the call, and the fake API's mock**

In `dashboard/src/backendApi.js`, find:

```js
    pendingHandovers() { return authed("/handovers/pending"); },
```

Replace with:

```js
    pendingHandovers() { return authed("/handovers/pending"); },
    /** G4-03 (spec D4), `quality.view`: «Kalite göstergeleri» over the last `days` (1, 7 or 30) — per unit, alarm
     *  response, snoozes, RRT calls and handover countersignatures; the unplaced and the hospital's sums. Counts and
     *  times only: no patient, no person, no free text. */
    qualityIndicators(days = 7) { return authed(`/quality?days=${encodeURIComponent(days)}`); },
```

In `dashboard/src/live/session/testTokens.testutil.js`, find:

```js
    pendingHandovers: vi.fn(),
```

Replace with:

```js
    pendingHandovers: vi.fn(),
    // G4-03: «Kalite göstergeleri» (screens/kalite)
    qualityIndicators: vi.fn(),
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd /c/tmp/g4-kalite/dashboard && npx vitest run src/backendApi.test.js src/backendApi.admin.test.js src/live/session/sessionStore.test.js`
Expected: `Tests 229 passed (229)`.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g4-kalite && git add dashboard/src/backendApi.js dashboard/src/backendApi.test.js dashboard/src/live/session/testTokens.testutil.js && git commit -m "feat(api-client): G4-03 qualityIndicators(days) — GET /quality?days=, and its mock in fakeApi" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/backendApi.js dashboard/src/backendApi.test.js dashboard/src/live/session/testTokens.testutil.js
```

---

## Task 9 (dashboard): what the summary page shares — `usePeriodRead` and `words.jsx`

The quality page reads one answer for a period exactly as the summary page reads `/alarm-quality`, and words its «—», its periods and its durations the same way. This task moves those out of the summary page so both use one copy, and changes nothing the summary page does: its own tests are the proof.

**Files:**
- Create: `dashboard/src/live/screens/ozet/words.jsx`
- Modify: `dashboard/src/live/screens/ozet/useSummaryReads.js` (`useQuality` becomes `usePeriodRead` and a one-line `useQuality`)
- Modify: `dashboard/src/live/screens/ozet/OzetScreen.jsx` (imports `PERIOD_KEYS`, `durationText`, `Missing` instead of defining them)
- Test: `dashboard/src/live/screens/ozet/useSummaryReads.test.js` (the import; a new block at the end)

- [ ] **Step 1: Write the failing test**

In `dashboard/src/live/screens/ozet/useSummaryReads.test.js`, find:

```js
import { useQuality, useSummaryReads } from "./useSummaryReads.js";
```

Replace with:

```js
import { usePeriodRead, useQuality, useSummaryReads } from "./useSummaryReads.js";
```

Then find (the end of the file):

```js
    expect(result.current).toMatchObject({ phase: "failed", data: null, error: null });
  });
});
```

Replace with:

```js
    expect(result.current).toMatchObject({ phase: "failed", data: null, error: null });
  });
});

// G4-03: «Kalite göstergeleri» reads its own answer through the same hook — its own read and its own check.
describe("one read for a period (usePeriodRead)", () => {
  const READ = (api, days) => api.alarmQuality(days);
  const EVEN = (answer) => answer?.episodes % 2 === 0;

  it("reads with the read it is given, and an answer its check refuses is a failed read", async () => {
    const store = fakeStore();
    const { result, rerender } = renderHook(
      ({ period }) => usePeriodRead({ store, may: true, period, read: READ, valid: EVEN }), { initialProps: { period: 30 } });
    await flush();
    expect(result.current).toMatchObject({ phase: "ok", data: REPORT(30) });
    rerender({ period: 7 });
    await flush();
    expect(result.current).toMatchObject({ phase: "failed", data: null, error: null });
    expect(store.api.alarmQuality.mock.calls.map(([days]) => days)).toEqual([30, 7]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/tmp/g4-kalite/dashboard && npx vitest run src/live/screens/ozet/useSummaryReads.test.js`
Expected: `1 failed | 10 passed`, with `TypeError: …usePeriodRead is not a function`.

- [ ] **Step 3: Write `usePeriodRead`; `useQuality` becomes one use of it**

In `dashboard/src/live/screens/ozet/useSummaryReads.js`, find:

```js
export function useQuality({ store, may, period }) {
  const [read, setRead] = useState(LOADING);
  const [attempt, setAttempt] = useState(0);
  const seq = useRef(0);
  const retry = useCallback(() => { setAttempt((n) => n + 1); }, []);
  useEffect(() => {
    if (!may) return undefined;
    seq.current += 1;
    const mine = seq.current;
    let alive = true;
    setRead(LOADING);
    store.track(() => store.api.alarmQuality(period)).then(
      (data) => {
        if (!alive || mine !== seq.current) return;
        setRead(isReport(data) ? { phase: "ok", data, atMs: Date.now(), error: null }
          : { phase: "failed", data: null, atMs: null, error: null });
      },
      (error) => { if (alive && mine === seq.current) setRead({ phase: "failed", data: null, atMs: null, error }); },
    );
    return () => { alive = false; };
  }, [store, may, period, attempt]);
  return useMemo(() => ({ ...read, retry }), [read, retry]);
}
```

Replace with:

```js
/** One read of a page for a period, `read(api, period)`: on open, on a period change and on `retry` (a user's action —
 *  «Yeniden dene», «Yenile»), never on a timer. The newest read wins; an answer `valid` refuses is a failed read (plan
 *  N10). `read` and `valid` must be module constants: a new function each render would read again each render.
 *  G4-03: «Kalite göstergeleri» reads `/quality` through it, as `useQuality` reads `/alarm-quality`. */
export function usePeriodRead({ store, may, period, read, valid }) {
  const [state, setState] = useState(LOADING);
  const [attempt, setAttempt] = useState(0);
  const seq = useRef(0);
  const retry = useCallback(() => { setAttempt((n) => n + 1); }, []);
  useEffect(() => {
    if (!may) return undefined;
    seq.current += 1;
    const mine = seq.current;
    let alive = true;
    setState(LOADING);
    store.track(() => read(store.api, period)).then(
      (data) => {
        if (!alive || mine !== seq.current) return;
        setState(valid(data) ? { phase: "ok", data, atMs: Date.now(), error: null }
          : { phase: "failed", data: null, atMs: null, error: null });
      },
      (error) => { if (alive && mine === seq.current) setState({ phase: "failed", data: null, atMs: null, error }); },
    );
    return () => { alive = false; };
  }, [store, may, period, attempt, read, valid]);
  return useMemo(() => ({ ...state, retry }), [state, retry]);
}

const readAlarmQuality = (api, days) => api.alarmQuality(days);

export function useQuality({ store, may, period }) {
  return usePeriodRead({ store, may, period, read: readAlarmQuality, valid: isReport });
}
```

- [ ] **Step 4: Move the shared words out of the summary page**

Create `dashboard/src/live/screens/ozet/words.jsx` with:

```jsx
// src/live/screens/ozet/words.jsx — the words «Yönetici özeti» (G4-02) and «Kalite göstergeleri» (G4-03) share: the
// period's names, a «—» with its reason, and a duration in minutes and seconds. One thing has one name on both pages.
import React from "react";

/** Each period's switch label and the phrase a card or a box names it by (`ozet.period.*`). */
export const PERIOD_KEYS = Object.freeze({
  1: { label: "ozet.period.d1", text: "ozet.period.text1" },
  7: { label: "ozet.period.d7", text: "ozet.period.text7" },
  30: { label: "ozet.period.d30", text: "ozet.period.text30" },
});

/** A duration (ozet.js `durationOf`: `{m, s}`, `m` null under a minute) in words. */
export const durationText = (t, d) => (d.m === null ? t("ozet.q.sec", { n: d.s }) : t("ozet.q.minSec", { m: d.m, s: d.s }));

/** «—» and why: what every number that is not real is, on a card, in a cell or in a box (Decision 18). */
export function Missing({ t, why, big = false }) {
  return (
    <span data-missing={why}>
      <span className={big ? "font-data text-23 font-bold" : "font-data font-bold"}>—</span>{" "}
      <span className="text-12 font-normal text-mute">{t(`ozet.why.${why}`)}</span>
    </span>
  );
}
```

In `dashboard/src/live/screens/ozet/OzetScreen.jsx`, find:

```jsx
import { useQuality, useSummaryReads } from "./useSummaryReads.js";

/** Each period's switch label and the phrase the card and the box name it by. */
const PERIOD = Object.freeze({
  1: { label: "ozet.period.d1", text: "ozet.period.text1" },
  7: { label: "ozet.period.d7", text: "ozet.period.text7" },
  30: { label: "ozet.period.d30", text: "ozet.period.text30" },
});
```

Replace with:

```jsx
import { useQuality, useSummaryReads } from "./useSummaryReads.js";
// G4-03: the period's names, the «—» with its reason and a duration's words, shared with «Kalite göstergeleri».
import { Missing, PERIOD_KEYS as PERIOD, durationText } from "./words.jsx";
```

Then find:

```jsx
const durationText = (t, d) => (d.m === null ? t("ozet.q.sec", { n: d.s }) : t("ozet.q.minSec", { m: d.m, s: d.s }));

/** «—» and why: what every number that is not real is, on a card, in a cell or in the box. */
function Missing({ t, why, big = false }) {
  return (
    <span data-missing={why}>
      <span className={big ? "font-data text-23 font-bold" : "font-data font-bold"}>—</span>{" "}
      <span className="text-12 font-normal text-mute">{t(`ozet.why.${why}`)}</span>
    </span>
  );
}

/** `caveat`: a short line saying the number is not the whole of what the card names — a truncated read, or a scoped
```

Replace with:

```jsx
/** `caveat`: a short line saying the number is not the whole of what the card names — a truncated read, or a scoped
```

- [ ] **Step 5: Run the summary page's tests to see them pass, unchanged**

Run: `cd /c/tmp/g4-kalite/dashboard && npx vitest run src/live/screens/ozet src/live/i18n/ozet.strings.test.js`
Expected: `Test Files 4 passed (4)` and `Tests 71 passed (71)` — the summary page's own tests, unchanged, and the new one.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/g4-kalite && git add dashboard/src/live/screens/ozet/words.jsx dashboard/src/live/screens/ozet/useSummaryReads.js dashboard/src/live/screens/ozet/useSummaryReads.test.js dashboard/src/live/screens/ozet/OzetScreen.jsx && git commit -m "refactor(ozet): G4-03 usePeriodRead (useQuality is one use of it) and words.jsx (PERIOD_KEYS, durationText, Missing), shared with the quality page; the summary page unchanged" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/live/screens/ozet/words.jsx dashboard/src/live/screens/ozet/useSummaryReads.js dashboard/src/live/screens/ozet/useSummaryReads.test.js dashboard/src/live/screens/ozet/OzetScreen.jsx
```

---

## Task 10 (dashboard): the pure `kalite.js` and the synthetic answers

**Files:**
- Create: `dashboard/src/live/screens/kalite/kalite.testutil.js`
- Create: `dashboard/src/live/screens/kalite/kalite.test.js`
- Create: `dashboard/src/live/screens/kalite/kalite.js`

From this task until Task 12 wires the route, `src/reachable.test.js` is **red by design**: `kalite.js` (and, after Task 11, the screen) is not yet reachable from `main.jsx`. Do not "fix" it here.

- [ ] **Step 1: Write the synthetic answers**

Create `dashboard/src/live/screens/kalite/kalite.testutil.js` with:

```js
// Test-only: synthetic answers of GET /quality for «Kalite göstergeleri» (G4-03) — the engine's own answer for the
// synthetic trail of homunculus-engine/tests/test_quality_indicators.py (Reanimasiya, Neonatal, two unplaced keys), a
// scoped caller's (Reanimasiya alone) and one who reaches nothing. Unit ids and names are the kabul ward's; no patient
// key, no person and no free text, as the API sends none.
import { NEO, REA } from "../kabul/kabul.testutil.js";

const REASONS = { ARTEFACT_OR_SIGNAL_NOISE: 0, CLINICAL_DECISION_MADE: 0, OTHER: 0, PATIENT_BASELINE: 0, PROCEDURE_IN_PROGRESS: 0 };

/** One block's alarms: zeros and nulls, then what `over` says. */
export const alarms = (over = {}) => ({ episodes: 0, answered: 0, answered_rate: null, median_response_sec: null,
  p90_response_sec: null, escalated: 0, unanswered: 0, unanswered_resolved: 0, pending: 0, per_kind: [], ...over });
/** One block's snoozes: `byReason` counted into `count`, the severities and the median as given. */
export const snoozes = (byReason = {}, { high = 0, moderate = 0, median = null } = {}) => ({
  count: Object.values(byReason).reduce((sum, n) => sum + n, 0), by_reason: { ...REASONS, ...byReason },
  by_severity: { high, moderate }, median_minutes: median });
/** One block's handovers. */
export const handovers = (over = {}) => ({ opened: 0, countersigned: 0, waiting: 0, expired: 0,
  median_countersign_sec: null, p90_countersign_sec: null, ...over });
const kind = (name, episodes, answered, escalated, unanswered, median) => ({ kind: name, episodes, answered, escalated,
  unanswered, median_response_sec: median });

const REA_BLOCK = {
  alarms: alarms({ episodes: 6, answered: 3, answered_rate: 0.6, median_response_sec: 180, p90_response_sec: 600,
    escalated: 1, unanswered: 2, unanswered_resolved: 1, pending: 1,
    per_kind: [kind("news2", 3, 2, 0, 0, 120), kind("spo2_low", 2, 0, 0, 2, null), kind("septic_shock", 1, 1, 1, 0, 600)] }),
  snoozes: snoozes({ CLINICAL_DECISION_MADE: 1, OTHER: 1 }, { high: 1, moderate: 1, median: 12.5 }),
  rrt: { count: 1 },
  handovers: handovers({ opened: 6, countersigned: 2, waiting: 1, expired: 2, median_countersign_sec: 600,
    p90_countersign_sec: 900 }),
};

/** An unrestricted caller's week (the system administrator, the auditor). */
export const ANSWER = Object.freeze({
  days: 7, generated_at: "2026-11-11T10:42:00+00:00", window_from: "2026-11-04T10:42:00+00:00",
  truncated: false, scoped: false,
  coverage: { episodes: 9, placed: 7, unplaced: 2 },
  units: [
    { unit_id: NEO, unit_name: "Neonatal",
      alarms: alarms({ episodes: 1, answered: 1, answered_rate: 1, median_response_sec: 240, p90_response_sec: 240,
        per_kind: [kind("news2", 1, 1, 0, 0, 240)] }),
      snoozes: snoozes({ ARTEFACT_OR_SIGNAL_NOISE: 1 }, { moderate: 1, median: 30 }),
      rrt: { count: 0 },
      handovers: handovers({ opened: 1, countersigned: 1, median_countersign_sec: 60, p90_countersign_sec: 60 }) },
    { unit_id: REA, unit_name: "Reanimasiya", ...REA_BLOCK },
  ],
  unplaced: {
    alarms: alarms({ episodes: 2, answered: 1, answered_rate: 0.5, median_response_sec: 60, p90_response_sec: 60,
      unanswered: 1, per_kind: [kind("news2", 2, 1, 0, 1, 60)] }),
    snoozes: snoozes({ PROCEDURE_IN_PROGRESS: 1 }, { high: 1, median: 5 }),
    rrt: { count: 1 },
  },
  hospital: {
    alarms: alarms({ episodes: 9, answered: 5, answered_rate: 0.625, median_response_sec: 180, p90_response_sec: 240,
      escalated: 1, unanswered: 3, unanswered_resolved: 1, pending: 1,
      per_kind: [kind("news2", 6, 4, 0, 1, 120), kind("spo2_low", 2, 0, 0, 2, null), kind("septic_shock", 1, 1, 1, 0, 600)] }),
    snoozes: snoozes({ ARTEFACT_OR_SIGNAL_NOISE: 1, CLINICAL_DECISION_MADE: 1, OTHER: 1, PROCEDURE_IN_PROGRESS: 1 },
      { high: 2, moderate: 2, median: 12.5 }),
    rrt: { count: 2 },
    handovers: handovers({ opened: 7, countersigned: 3, waiting: 1, expired: 2, median_countersign_sec: 300,
      p90_countersign_sec: 900 }),
  },
});

/** A caller granted Reanimasiya alone: her unit, no unplaced block, the sum of what she got. */
export const SCOPED = Object.freeze({
  ...ANSWER, scoped: true, coverage: { episodes: 6, placed: 6, unplaced: 0 },
  units: [{ unit_id: REA, unit_name: "Reanimasiya", ...REA_BLOCK }], unplaced: null, hospital: REA_BLOCK,
});

/** A caller whose grants reach no unit (a bed grant alone): nothing, and zeros that are the answer's own. */
export const NOTHING = Object.freeze({
  ...ANSWER, scoped: true, coverage: { episodes: 0, placed: 0, unplaced: 0 }, units: [], unplaced: null,
  hospital: { alarms: alarms(), snoozes: snoozes(), rrt: { count: 0 }, handovers: handovers() },
});

export function deferred() {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}

export { NEO, REA };
```

- [ ] **Step 2: Write the failing test**

Create `dashboard/src/live/screens/kalite/kalite.test.js` with:

```js
// kalite.test.js — G4-03 «Kalite göstergeleri» (spec D4, D5): the answer as the page reads it — its shape (one bad
// figure makes the whole read a failure), the rows in order with «Birimi belli olmayan» and «Toplam», a row's figures,
// a rate and a median over nothing, a selection, and the snooze reasons' words. Synthetic answers (kalite.testutil.js).
import { describe, it, expect, vi } from "vitest";
import { SNOOZE_REASONS } from "../../data/snooze.js";
import { WHY, noSource, okSource } from "../ozet/ozet.js";
import { REASON_KEYS as DIALOG_REASON_KEYS } from "../alarms/SnoozeDialog.jsx";
import { REASON_KEYS, TOTAL, UNPLACED, isQualityAnswer, qualityPage, readQuality, selectionOf } from "./kalite.js";
import { ANSWER, NEO, NOTHING, REA, SCOPED } from "./kalite.testutil.js";

describe("the answer this page reads", () => {
  it("is the engine's shape — and one malformed figure makes the whole read a failure", () => {
    for (const answer of [ANSWER, SCOPED, NOTHING]) expect(isQualityAnswer(answer)).toBe(true);
    const [neo] = ANSWER.units;
    const broken = [
      { ...ANSWER, days: 2 }, { ...ANSWER, scoped: undefined }, { ...ANSWER, generated_at: "dün" },
      { ...ANSWER, window_from: null }, { ...ANSWER, coverage: { episodes: 9, placed: 7 } },
      { ...ANSWER, units: [{ ...neo, unit_id: " " }] },
      { ...ANSWER, units: [{ ...neo, alarms: { ...neo.alarms, answered_rate: 1.2 } }] },
      { ...ANSWER, units: [{ ...neo, alarms: { ...neo.alarms, per_kind: [{ kind: "news2", episodes: "1" }] } }] },
      { ...ANSWER, units: [{ ...neo, handovers: undefined }] },
      { ...ANSWER, unplaced: { ...ANSWER.unplaced, snoozes: { ...ANSWER.unplaced.snoozes, by_reason: { OTHER: 1 } } } },
      { ...ANSWER, hospital: { ...ANSWER.hospital, rrt: { count: -1 } } },
      null, [], "{}",
    ];
    for (const answer of broken) expect(isQualityAnswer(answer), JSON.stringify(answer)?.slice(0, 90)).toBe(false);
  });

  it("is read with GET /quality for the period", () => {
    const api = { qualityIndicators: vi.fn().mockReturnValue("read") };
    expect(readQuality(api, 30)).toBe("read");
    expect(api.qualityIndicators).toHaveBeenCalledWith(30);
  });
});

describe("the page", () => {
  it("has no number while there is no answer — only why", () => {
    expect(qualityPage(noSource(WHY.loading))).toEqual({ ok: false, why: "loading" });
    expect(qualityPage(noSource(WHY.noRight))).toEqual({ ok: false, why: "noRight" });
  });

  it("draws the units in the answer's order, then the unplaced row, then the total", () => {
    const page = qualityPage(okSource(ANSWER));
    expect(page.rows.map((row) => [row.key, row.name])).toEqual([[NEO, "Neonatal"], [REA, "Reanimasiya"]]);
    expect([page.unplaced.key, page.unplaced.handovers, page.total.key]).toEqual([UNPLACED, null, TOTAL]);
    expect(page).toMatchObject({ ok: true, scoped: false, truncated: false, coverage: { episodes: 9, placed: 7, unplaced: 2 },
      generatedAtMs: Date.parse(ANSWER.generated_at), windowFromMs: Date.parse(ANSWER.window_from) });
  });

  it("gives a row's figures: a whole percent, minutes and seconds, the self-resolved apart", () => {
    const rea = qualityPage(okSource(ANSWER)).rows[1];
    expect(rea.alarms).toMatchObject({ episodes: 6, answered: 3, settled: 5, pct: 60, median: { m: 3, s: 0 },
      p90: { m: 10, s: 0 }, escalated: 1, unanswered: 2, selfResolved: 1, pending: 1 });
    expect(rea.alarms.perKind[1]).toEqual({ kind: "spo2_low", episodes: 2, answered: 0, escalated: 0, unanswered: 2, median: null });
    expect(rea.snoozes.byReason.map((r) => r.reason)).toEqual([...SNOOZE_REASONS]);
    expect(rea.snoozes).toMatchObject({ count: 2, high: 1, moderate: 1, medianMinutes: 12.5 });
    expect(rea.rrt).toBe(1);
    expect(rea.handovers).toEqual({ opened: 6, countersigned: 2, waiting: 1, expired: 2, median: { m: 10, s: 0 },
      p90: { m: 15, s: 0 } });
  });

  it("says nothing settled and nothing answered as null, never 0", () => {
    const { total } = qualityPage(okSource(NOTHING));
    expect(total.alarms).toMatchObject({ episodes: 0, pct: null, median: null, p90: null });
    expect(total.handovers).toMatchObject({ opened: 0, median: null, p90: null });
    expect(total.snoozes.medianMinutes).toBeNull();
  });

  it("selects a unit, the unplaced row or the total; a key the answer no longer holds is the total", () => {
    const page = qualityPage(okSource(ANSWER));
    expect(selectionOf(page, REA).name).toBe("Reanimasiya");
    expect(selectionOf(page, UNPLACED).key).toBe(UNPLACED);
    expect(selectionOf(page, TOTAL).key).toBe(TOTAL);
    expect(selectionOf(page, "gone").key).toBe(TOTAL);
    expect(selectionOf(qualityPage(okSource(SCOPED)), UNPLACED).key).toBe(TOTAL);
    expect(selectionOf(qualityPage(noSource(WHY.loading)), TOTAL)).toBeNull();
  });

  it("names the snooze reasons with the alarm screen's own words", () => {
    expect(REASON_KEYS).toEqual(DIALOG_REASON_KEYS);
    expect(Object.keys(REASON_KEYS).sort()).toEqual([...SNOOZE_REASONS].sort());
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `cd /c/tmp/g4-kalite/dashboard && npx vitest run src/live/screens/kalite/kalite.test.js`
Expected: FAIL — `Failed to resolve import "./kalite.js"`.

- [ ] **Step 4: Write `kalite.js`**

Create `dashboard/src/live/screens/kalite/kalite.js` with:

```js
// src/live/screens/kalite/kalite.js — G4-03 «Kalite göstergeleri» (spec 2026-11-11 D5), pure: `GET /quality`'s answer
// as the page draws it. KaliteScreen.jsx only words it.
//
// ONE READ, ONE SOURCE. The page reads `/quality` for a period (`usePeriodRead` with `readQuality` and
// `isQualityAnswer`) and turns the read into a source by the summary page's own rule (ozet.js `readSource`): an answer
// it may count from, or «—» and why — loading, failed, no right — never a 0 in its place (Decision 18). An answer of
// the wrong shape (one malformed figure is enough) is a failed read, never a partial table.
//
// THE ROWS are the answer's units in its order (by name), then «Birimi belli olmayan» (an unrestricted caller's only),
// then «Toplam» (the answer's `hospital`: the whole hospital, or a scoped caller's units' sum). A row is selected by its
// key; the snooze reasons and the alarms by kind are drawn for the selection.
//
// No patient anywhere: the answer carries unit ids and names, counts, times and the engine's alert kinds.
import { normId } from "../../data/structure.js";
import { SNOOZE_REASONS } from "../../data/snooze.js";
import { durationOf } from "../ozet/ozet.js";

/** The «Toplam» row's key and the «Birimi belli olmayan» row's; a unit's own key is its id (normId). */
export const TOTAL = "total";
export const UNPLACED = "unplaced";
/** The periods the engine answers (`GET /quality?days`). */
const DAYS = Object.freeze([1, 7, 30]);
/** The snooze reason codes' words: the alarm screen's own (`ertele.reason.*`, SnoozeDialog's REASON_KEYS). */
export const REASON_KEYS = Object.freeze({
  CLINICAL_DECISION_MADE: "ertele.reason.clinical",
  ARTEFACT_OR_SIGNAL_NOISE: "ertele.reason.artefact",
  PROCEDURE_IN_PROGRESS: "ertele.reason.procedure",
  PATIENT_BASELINE: "ertele.reason.baseline",
  OTHER: "ertele.reason.other",
});

/** How the page reads its answer (`usePeriodRead`'s `read`): a module constant, so a render does not read again. */
export const readQuality = (api, days) => api.qualityIndicators(days);

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isCount = (value) => Number.isInteger(value) && value >= 0;
const isSeconds = (value) => value === null || (Number.isFinite(value) && value >= 0);
const isRate = (value) => value === null || (Number.isFinite(value) && value >= 0 && value <= 1);
const counts = (object, keys) => keys.every((key) => isCount(object[key]));

function msOf(iso) {
  const ms = typeof iso === "string" ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function isAlarms(a) {
  return isObject(a) && counts(a, ["episodes", "answered", "escalated", "unanswered", "unanswered_resolved", "pending"])
    && isRate(a.answered_rate) && isSeconds(a.median_response_sec) && isSeconds(a.p90_response_sec)
    && Array.isArray(a.per_kind) && a.per_kind.every((k) => isObject(k) && typeof k.kind === "string"
      && counts(k, ["episodes", "answered", "escalated", "unanswered"]) && isSeconds(k.median_response_sec));
}

const isSnoozes = (s) => isObject(s) && isCount(s.count) && isObject(s.by_reason) && counts(s.by_reason, SNOOZE_REASONS)
  && isObject(s.by_severity) && counts(s.by_severity, ["high", "moderate"]) && isSeconds(s.median_minutes);

const isHandovers = (h) => isObject(h) && counts(h, ["opened", "countersigned", "waiting", "expired"])
  && isSeconds(h.median_countersign_sec) && isSeconds(h.p90_countersign_sec);

const isBlock = (b, withHandovers) => isObject(b) && isAlarms(b.alarms) && isSnoozes(b.snoozes) && isObject(b.rrt)
  && isCount(b.rrt.count) && (!withHandovers || isHandovers(b.handovers));

/** `GET /quality`'s answer as this page reads it (spec D4). Anything else is a failed read. */
export function isQualityAnswer(answer) {
  return isObject(answer) && DAYS.includes(answer.days) && msOf(answer.generated_at) !== null
    && msOf(answer.window_from) !== null && typeof answer.truncated === "boolean" && typeof answer.scoped === "boolean"
    && isObject(answer.coverage) && counts(answer.coverage, ["episodes", "placed", "unplaced"])
    && Array.isArray(answer.units) && answer.units.every((u) => isBlock(u, true) && typeof u.unit_id === "string"
      && u.unit_id.trim() !== "" && typeof u.unit_name === "string")
    && (answer.unplaced === null || isBlock(answer.unplaced, false))
    && isBlock(answer.hospital, true);
}

const pctOf = (rate) => (rate === null ? null : Math.round(rate * 100));

/** One row's alarm figures: counts as sent; the rate as a whole percent, null when nothing settled; times as minutes
 *  and seconds (ozet.js `durationOf`), null over nothing. */
export function alarmsView(a) {
  return {
    episodes: a.episodes, answered: a.answered, settled: a.answered + a.unanswered, pct: pctOf(a.answered_rate),
    median: durationOf(a.median_response_sec), p90: durationOf(a.p90_response_sec), escalated: a.escalated,
    unanswered: a.unanswered, selfResolved: a.unanswered_resolved, pending: a.pending,
    perKind: a.per_kind.map((k) => ({ kind: k.kind, episodes: k.episodes, answered: k.answered, escalated: k.escalated,
      unanswered: k.unanswered, median: durationOf(k.median_response_sec) })),
  };
}

/** One row's snoozes: the reasons in the alarm screen's order, the two severities, the median minutes. */
export function snoozesView(s) {
  return { count: s.count, byReason: SNOOZE_REASONS.map((reason) => ({ reason, n: s.by_reason[reason] })),
    high: s.by_severity.high, moderate: s.by_severity.moderate, medianMinutes: s.median_minutes };
}

/** One row's handovers; null for the unplaced row (every handover has a unit). */
export function handoversView(h) {
  return h ? { opened: h.opened, countersigned: h.countersigned, waiting: h.waiting, expired: h.expired,
    median: durationOf(h.median_countersign_sec), p90: durationOf(h.p90_countersign_sec) } : null;
}

const rowOf = (key, name, block) => ({ key, name, alarms: alarmsView(block.alarms), snoozes: snoozesView(block.snoozes),
  rrt: block.rrt.count, handovers: handoversView(block.handovers) });

/** The page from its one source: `{ok: false, why}` while there is no answer to count from; else the rows, the
 *  unplaced row (null for a scoped caller), the total row (the cards' figures), the coverage, and the read's flags. */
export function qualityPage(source) {
  if (!source.ok) return { ok: false, why: source.why };
  const answer = source.data;
  return {
    ok: true, scoped: answer.scoped, truncated: answer.truncated,
    windowFromMs: msOf(answer.window_from), generatedAtMs: msOf(answer.generated_at),
    coverage: { episodes: answer.coverage.episodes, placed: answer.coverage.placed, unplaced: answer.coverage.unplaced },
    rows: answer.units.map((unit) => rowOf(normId(unit.unit_id), unit.unit_name, unit)),
    unplaced: answer.unplaced ? rowOf(UNPLACED, null, answer.unplaced) : null,
    total: rowOf(TOTAL, null, answer.hospital),
  };
}

/** The row a selection names — a unit's, the unplaced row or the total; the total for a key the newest answer no
 *  longer holds (another period, «Yenile»). Null with no answer. */
export function selectionOf(page, key) {
  if (!page.ok) return null;
  if (key === UNPLACED && page.unplaced) return page.unplaced;
  return page.rows.find((row) => row.key === key) ?? page.total;
}
```

- [ ] **Step 5: Run it to see it pass**

Run: `cd /c/tmp/g4-kalite/dashboard && npx vitest run src/live/screens/kalite/kalite.test.js`
Expected: `Tests 8 passed (8)`.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/g4-kalite && git add dashboard/src/live/screens/kalite/kalite.js dashboard/src/live/screens/kalite/kalite.test.js dashboard/src/live/screens/kalite/kalite.testutil.js && git commit -m "feat(kalite): G4-03 the pure kalite.js — the answer's shape (one bad figure is a failed read), the rows with unplaced and total, a row's figures, the selection; synthetic answers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/live/screens/kalite/kalite.js dashboard/src/live/screens/kalite/kalite.test.js dashboard/src/live/screens/kalite/kalite.testutil.js
```

---

## Task 11 (dashboard): `KaliteScreen`

**Files:**
- Create: `dashboard/src/live/screens/kalite/KaliteScreen.test.jsx`
- Create: `dashboard/src/live/screens/kalite/KaliteScreen.jsx`

- [ ] **Step 1: Write the failing test**

Create `dashboard/src/live/screens/kalite/KaliteScreen.test.jsx` with:

```jsx
// KaliteScreen.test.jsx — «Keyfiyyət göstəriciləri» (G4-03, spec D5): one h1 and no patient anywhere; the coverage line;
// the cards; the units table with «Şöbəsi bəlli olmayan» and «Cəmi»; a unit selected by its name; the snooze reasons
// and the alarms by kind for the selection; the period switch, the newest read winning, «Yenilə»; a truncated read; a
// scoped caller and one who reaches nothing; reading, 403, a failure and a malformed answer, each with its reason. The
// default language is az. Synthetic answers (kalite.testutil.js).
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { ddmmhhmm } from "../../i18n/dates.js";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { expectNoUuid } from "../kabul/kabul.testutil.js";
import { KaliteScreen } from "./KaliteScreen.jsx";
import { ANSWER, NOTHING, SCOPED, deferred } from "./kalite.testutil.js";

afterEach(() => { cleanup(); });

const settle = () => act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });

/** Mount the page for a session holding `perms` (a hospital's own quality group by default: `quality.view` alone). */
async function mountKalite({ perms = ["quality.view"], setup } = {}) {
  const mounted = await mount(<KaliteScreen />, {
    access: token({ perms }), me: profile({ perms }),
    setup: (api) => { api.qualityIndicators.mockResolvedValue(ANSWER); setup?.(api); },
  });
  await settle();
  return mounted;
}

const cells = (row) => [...row.querySelectorAll("th, td")].map((cell) => cell.textContent);
const card = (name) => screen.getByRole("heading", { level: 3, name }).closest("li");
const value = (name) => card(name).querySelector("[data-card-value]").textContent;
const rows = () => within(screen.getByRole("table", { name: "Şöbələrə görə keyfiyyət göstəriciləri" }))
  .getAllByRole("row").slice(1).map(cells);
const snoozeRows = () => within(screen.getByRole("table", { name: "Təxirə salma səbəbləri" })).getAllByRole("row").map(cells);
const coverage = () => document.querySelector("[data-coverage]");

describe("the quality page", () => {
  it("has one h1, reads /quality for 7 days once on open, and shows no UUID", async () => {
    const { api } = await mountKalite();
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["Keyfiyyət göstəriciləri"]);
    expect(screen.getByText("Proses ölçülür, şəxs yox")).toBeInTheDocument();
    expect(api.qualityIndicators).toHaveBeenCalledTimes(1);
    expect(api.qualityIndicators).toHaveBeenCalledWith(7);
    expect(document.querySelector("[data-as-of]").textContent).toMatch(/^\d\d:\d\d vəziyyətinə görə$/);
    expectNoUuid();
  });

  it("says how many alarms could be tied to a unit, and why the rest could not", async () => {
    await mountKalite();
    expect(coverage()).toHaveTextContent(
      "Bu dövrdə 9 siqnal epizodundan 7 ədədi şöbəyə bağlana bildi. Şöbəyə bağlanmayanlar: bu sistemdə qəbul qeydi olmayan");
  });

  it("draws the hospital's cards from the answer", async () => {
    await mountKalite();
    expect(screen.getByRole("heading", { level: 2, name: "Bütün xəstəxana · son 7 gün" })).toBeInTheDocument();
    expect(value("Siqnala cavab müddəti (median)")).toBe("3 dəq 0 san");
    expect(value("Cavablanan siqnal")).toBe("63%");
    expect(card("Cavablanan siqnal")).toHaveTextContent("yekunlaşan 8 siqnal epizodundan 5 ədədi");
    expect(value("Eskalasiya edilən siqnal")).toBe("1");
    expect(value("Cavabsız qalan siqnal")).toBe("3");
    expect(card("Cavabsız qalan siqnal")).toHaveTextContent("1 ədədi öz-özünə düzəldi");
    expect(value("Təxirə salınan siqnal")).toBe("4");
    expect(card("Təxirə salınan siqnal")).toHaveTextContent("2 yüksək · 2 orta");
    expect(value("RRT çağırışı")).toBe("2");
    expect(value("Təhvilin əks-imza müddəti (median)")).toBe("5 dəq 0 san");
  });

  it("draws a row per unit, then «Şöbəsi bəlli olmayan», then «Cəmi»", async () => {
    await mountKalite();
    expect(rows()).toEqual([
      ["Neonatal", "1", "4 dəq 0 san", "4 dəq 0 san", "100%", "0", "0 (0)", "1", "0", "1 / 1 / 0", "1 dəq 0 san"],
      ["Reanimasiya", "6", "3 dəq 0 san", "10 dəq 0 san", "60%", "1", "2 (1)", "2", "1", "6 / 2 / 1", "10 dəq 0 san"],
      ["Şöbəsi bəlli olmayan", "2", "1 dəq 0 san", "1 dəq 0 san", "50%", "0", "1 (0)", "1", "1", "", ""],
      ["Cəmi", "9", "3 dəq 0 san", "4 dəq 0 san", "63%", "1", "3 (1)", "4", "2", "7 / 3 / 1", "5 dəq 0 san"],
    ]);
  });

  it("selects a unit by its name: the snooze reasons gain its column, the kinds are its own", async () => {
    await mountKalite();
    expect(screen.getByRole("heading", { level: 2, name: "Növə görə siqnallar · Bütün xəstəxana" })).toBeInTheDocument();
    expect(snoozeRows()[0]).toEqual(["Səbəb", "Bütün xəstəxana"]);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Reanimasiya" })); });
    expect(screen.getByRole("button", { name: "Reanimasiya" })).toHaveAttribute("aria-pressed", "true");
    expect(snoozeRows()).toEqual([
      ["Səbəb", "Bütün xəstəxana", "Reanimasiya"],
      ["Klinik qərar verilib", "1", "1"],
      ["Artefakt və ya siqnal küyü", "1", "0"],
      ["Prosedur gedir", "1", "0"],
      ["Xəstənin öz norması", "0", "0"],
      ["Digər", "1", "1"],
      ["Cəmi", "4", "2"],
      ["Median müddət", "12,5 dəq", "12,5 dəq"],
    ]);
    expect(screen.getByRole("heading", { level: 2, name: "Növə görə siqnallar · Reanimasiya" })).toBeInTheDocument();
    expect(within(screen.getByRole("table", { name: "Növə görə siqnallar" })).getAllByRole("row").slice(1).map(cells))
      .toEqual([["news2", "3", "2", "0", "0", "2 dəq 0 san"], ["spo2_low", "2", "0", "0", "2", "—"],
        ["septic_shock", "1", "1", "1", "0", "10 dəq 0 san"]]);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Şöbəsi bəlli olmayan" })); });
    expect(screen.getByRole("heading", { level: 2, name: "Növə görə siqnallar · Şöbəsi bəlli olmayan" })).toBeInTheDocument();
  });

  it("says a truncated read is one, and from when the alarms are counted", async () => {
    const from = "2026-11-08T06:00:00+00:00";
    await mountKalite({ setup: (api) => api.qualityIndicators.mockResolvedValue({ ...ANSWER, truncated: true, window_from: from }) });
    expect(coverage()).toHaveTextContent(
      `Serverin oxuma həddi aşıldı: yalnız ən yeni qeydlər oxundu; siqnal, təxirə salma və RRT sayları ${ddmmhhmm(Date.parse(from))} ilə başlayır`);
  });
});

describe("the period switch and «Yenilə»", () => {
  it("reads the chosen period, and the newest read wins", async () => {
    const week = deferred();
    const { api } = await mountKalite({ setup: (a) => a.qualityIndicators.mockImplementation(
      (days) => (days === 7 ? week.promise : Promise.resolve({ ...ANSWER, days }))) });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "30 gün" })); });
    await settle();
    expect(api.qualityIndicators).toHaveBeenLastCalledWith(30);
    expect(screen.getByRole("button", { name: "30 gün" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { level: 2, name: "Bütün xəstəxana · son 30 gün" })).toBeInTheDocument();
    await act(async () => { week.resolve({ ...ANSWER, coverage: { episodes: 1, placed: 1, unplaced: 0 } }); });
    await settle();
    expect(coverage()).toHaveTextContent("9 siqnal epizodundan 7 ədədi");
  });

  it("«Yenilə» reads the same period again", async () => {
    const { api } = await mountKalite();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yenilə" })); });
    await settle();
    expect(api.qualityIndicators).toHaveBeenCalledTimes(2);
    expect(api.qualityIndicators).toHaveBeenLastCalledWith(7);
  });
});

describe("a caller whose scope is restricted", () => {
  it("reads only her units: no unplaced row, and the line says so", async () => {
    await mountKalite({ setup: (api) => api.qualityIndicators.mockResolvedValue(SCOPED) });
    expect(coverage()).toHaveTextContent("Yalnız əhatənizdəki şöbələr: bu dövrdə bu şöbələrə 6 siqnal epizodu bağlandı.");
    expect(rows().map((row) => row[0])).toEqual(["Reanimasiya", "Cəmi"]);
    expect(screen.getByRole("heading", { level: 2, name: "Əhatənizdəki şöbələr · son 7 gün" })).toBeInTheDocument();
  });

  it("with no unit in her reach: the page says so, and its zeros are the answer's own", async () => {
    await mountKalite({ setup: (api) => api.qualityIndicators.mockResolvedValue(NOTHING) });
    expect(document.querySelector("[data-units]")).toHaveTextContent("Əhatənizdə şöbə yoxdur.");
    expect(value("Cavablanan siqnal")).toBe("— hələ yekunlaşan yoxdur");
    expect(value("Siqnala cavab müddəti (median)")).toBe("— cavablanan yoxdur");
    expect(value("Təhvilin əks-imza müddəti (median)")).toBe("— əks-imzalanan yoxdur");
    expect(value("Eskalasiya edilən siqnal")).toBe("0");
  });
});

describe("every number is real or says why not", () => {
  it("while reading: «—» and «oxunur…», never 0", async () => {
    await mountKalite({ setup: (api) => api.qualityIndicators.mockReturnValue(new Promise(() => {})) });
    expect(value("RRT çağırışı")).toBe("— oxunur…");
    expect(document.querySelector("[data-units]")).toHaveTextContent("Keyfiyyət göstəriciləri oxunur…");
    expect(document.querySelector("[data-as-of]")).toHaveTextContent("Hələ oxunmayıb");
  });

  it("a refusal is no right; a failure and a malformed answer could not be read — each with its reason", async () => {
    await mountKalite({ setup: (api) => api.qualityIndicators.mockRejectedValue(refusal(403, "permission required: quality.view")) });
    expect(value("RRT çağırışı")).toBe("— səlahiyyət yoxdur");
    expect(document.querySelector("[data-units]")).toHaveTextContent("Cədvəl yazıla bilmir · səlahiyyət yoxdur");
    expect(document.querySelector("[data-failed]")).toBeNull();
    cleanup();
    await mountKalite({ setup: (api) => api.qualityIndicators.mockRejectedValue(refusal(503, "down")) });
    expect(document.querySelector("[data-failed]")).toHaveTextContent("Keyfiyyət göstəriciləri oxunmadı:");
    expect(value("RRT çağırışı")).toBe("— oxunmadı");
    cleanup();
    await mountKalite({ setup: (api) => api.qualityIndicators.mockResolvedValue(
      { ...ANSWER, units: [{ ...ANSWER.units[0], rrt: { count: "1" } }] }) });
    expect(document.querySelector("[data-failed]").textContent).toMatch(/Keyfiyyət göstəriciləri oxunmadı\.$/);
    expect(value("RRT çağırışı")).toBe("— oxunmadı");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/tmp/g4-kalite/dashboard && npx vitest run src/live/screens/kalite/KaliteScreen.test.jsx`
Expected: FAIL — `Failed to resolve import "./KaliteScreen.jsx"`.

- [ ] **Step 3: Write the screen**

Create `dashboard/src/live/screens/kalite/KaliteScreen.jsx` with:

```jsx
// src/live/screens/kalite/KaliteScreen.jsx — G4-03 «Kalite göstergeleri» (spec
// docs/superpowers/specs/2026-11-11-g4-kalite-gostergeleri-design.md, D5), for `quality.view`. Read-only; no patient
// name, key or id anywhere, and no person's name. Top to bottom: the header (the period switch, «HH:MM itibarıyla»,
// «Yenile»), the coverage line, the cards, the units table (a unit's name selects it), the snooze reasons and the
// alarms by kind for the selection. The rules are kalite.js's; this file words them. Every number is real or a «—»
// with its reason (Decision 18). Read on open, on a period change and on «Yenile» — never on a timer; the newest read
// wins (usePeriodRead).
import React, { useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { ddmmhhmm, hhmm } from "../../i18n/dates.js";
import { useSession } from "../../session/SessionProvider.jsx";
import { readErrorText } from "../../apiErrors.js";
import { Alert, Box, Button, FOCUS_RING, Note, Seg, Table } from "../../ui/index.js";
import { DEFAULT_PERIOD, PERIODS, WHY, readSource } from "../ozet/ozet.js";
import { usePeriodRead } from "../ozet/useSummaryReads.js";
import { Missing, PERIOD_KEYS, durationText } from "../ozet/words.jsx";
import { REASON_KEYS, TOTAL, UNPLACED, isQualityAnswer, qualityPage, readQuality, selectionOf } from "./kalite.js";

const CARDS = Object.freeze([
  "kalite.cards.median", "kalite.cards.rate", "kalite.cards.escalated", "kalite.cards.unanswered",
  "kalite.cards.snoozes", "kalite.cards.rrt", "kalite.cards.countersign",
]);
const COLUMNS = Object.freeze([
  "kalite.units.colUnit", "kalite.units.colEpisodes", "kalite.units.colMedian", "kalite.units.colP90",
  "kalite.units.colRate", "kalite.units.colEscalated", "kalite.units.colUnanswered", "kalite.units.colSnoozes",
  "kalite.units.colRrt", "kalite.units.colHandovers", "kalite.units.colCountersign",
]);
const KIND_COLUMNS = Object.freeze([
  "kalite.kinds.colKind", "kalite.kinds.colEpisodes", "kalite.kinds.colAnswered", "kalite.kinds.colEscalated",
  "kalite.kinds.colUnanswered", "kalite.kinds.colMedian",
]);

/** «—» and a word: a figure over nothing — a median with nothing answered, a rate with nothing settled. Not a reason
 *  for a missing source (that is `Missing`): the answer is real; the figure has nothing to stand on. */
function None({ text = null }) {
  return (
    <span data-none>
      <span className="font-data font-bold">—</span>
      {text ? <>{" "}<span className="text-12 font-normal text-mute">{text}</span></> : null}
    </span>
  );
}

function Card({ title, value, extra = null }) {
  return (
    <li className="flex min-w-[180px] flex-1 flex-col gap-1 rounded-box border border-line bg-card px-[14px] py-3">
      <h3 className="m-0 font-text text-13 font-semibold">{title}</h3>
      <p className="m-0 font-data text-23 font-bold" data-card-value>{value}</p>
      {extra ? <p className="m-0 text-12 text-mute">{extra}</p> : null}
    </li>
  );
}

function Cards({ t, page, period }) {
  const title = t(page.ok && page.scoped ? "kalite.cards.titleScoped" : "kalite.cards.title",
    { period: t(PERIOD_KEYS[period].text) });
  let cards;
  if (!page.ok) {
    cards = CARDS.map((key) => <Card key={key} title={t(key)} value={<Missing t={t} why={page.why} big />} />);
  } else {
    const { alarms, snoozes, rrt, handovers } = page.total;
    cards = [
      <Card key="median" title={t("kalite.cards.median")}
        value={alarms.median ? durationText(t, alarms.median) : <None text={t("ozet.q.noAnswered")} />} />,
      <Card key="rate" title={t("kalite.cards.rate")}
        value={alarms.pct === null ? <None text={t("ozet.q.unsettled")} /> : t("kalite.pct", { pct: alarms.pct })}
        extra={alarms.settled > 0 ? t("kalite.cards.rateOf", { answered: alarms.answered, settled: alarms.settled }) : null} />,
      <Card key="escalated" title={t("kalite.cards.escalated")} value={alarms.escalated} />,
      <Card key="unanswered" title={t("kalite.cards.unanswered")} value={alarms.unanswered}
        extra={alarms.unanswered > 0 ? t("kalite.cards.selfResolved", { n: alarms.selfResolved }) : null} />,
      <Card key="snoozes" title={t("kalite.cards.snoozes")} value={snoozes.count}
        extra={snoozes.count > 0 ? t("kalite.cards.snoozeSplit", { high: snoozes.high, moderate: snoozes.moderate }) : null} />,
      <Card key="rrt" title={t("kalite.cards.rrt")} value={rrt} />,
      <Card key="countersign" title={t("kalite.cards.countersign")}
        value={handovers.median ? durationText(t, handovers.median) : <None text={t("kalite.cards.noCountersigned")} />} />,
    ];
  }
  return (
    <section aria-labelledby="kalite-cards" className="flex flex-col gap-2">
      <h2 id="kalite-cards" className="m-0 font-display text-17 font-bold">{title}</h2>
      <ul className="m-0 flex list-none flex-wrap gap-2.5 p-0">{cards}</ul>
    </section>
  );
}

/** How many alarm episodes could be tied to a unit, and why the rest could not — or, for a scoped caller, that these
 *  are her units' only. A truncated read says so, and from when its alarms are counted. */
function Coverage({ t, page }) {
  if (!page.ok) return null;
  const { episodes, placed } = page.coverage;
  const line = page.scoped ? t("kalite.coverageScoped", { placed })
    : `${t("kalite.coverage", { episodes, placed })} ${t("kalite.coverageWhy")}`;
  return (
    <div className="flex flex-col gap-2" data-coverage>
      <p className="m-0 text-13">{line}</p>
      {page.truncated ? <Note tone="warn">{t("kalite.truncated", { from: ddmmhhmm(page.windowFromMs) })}</Note> : null}
    </div>
  );
}

function UnitRow({ t, row, name, on, onSelect }) {
  const { alarms, snoozes, handovers } = row;
  const time = (d) => (d ? durationText(t, d) : <None />);
  return (
    <tr>
      <th scope="row">
        <button type="button" aria-pressed={on} onClick={() => onSelect(row.key)}
          className={`cursor-pointer rounded-sm border-0 bg-transparent p-0 text-left font-text font-semibold underline-offset-2 hover:underline ${on ? "text-pri underline" : ""} ${FOCUS_RING}`}>
          {name}
        </button>
      </th>
      <td className="font-data">{alarms.episodes}</td>
      <td className="font-data">{time(alarms.median)}</td>
      <td className="font-data">{time(alarms.p90)}</td>
      <td className="font-data">{alarms.pct === null ? <None text={t("ozet.q.unsettled")} /> : t("kalite.pct", { pct: alarms.pct })}</td>
      <td className="font-data">{alarms.escalated}</td>
      <td className="font-data">{`${alarms.unanswered} (${alarms.selfResolved})`}</td>
      <td className="font-data">{snoozes.count}</td>
      <td className="font-data">{row.rrt}</td>
      <td className="font-data">{handovers ? `${handovers.opened} / ${handovers.countersigned} / ${handovers.waiting}` : null}</td>
      <td className="font-data">{handovers ? time(handovers.median) : null}</td>
    </tr>
  );
}

function UnitsBox({ t, page, selectedKey, onSelect }) {
  let body;
  if (!page.ok) {
    body = page.why === WHY.loading ? <p className="m-0 text-13 text-mute">{t("kalite.units.loading")}</p>
      : <Note tone="warn">{t("kalite.units.missing", { why: t(`ozet.why.${page.why}`) })}</Note>;
  } else if (page.scoped && page.rows.length === 0) {
    body = <p className="m-0 text-13 text-mute">{t("kalite.noReach")}</p>;
  } else {
    const line = (row, name) => (
      <UnitRow key={row.key} t={t} row={row} name={name} on={selectedKey === row.key} onSelect={onSelect} />
    );
    body = (
      <>
        <Table caption={t("kalite.units.caption")}>
          <thead><tr>{COLUMNS.map((key) => <th key={key} scope="col">{t(key)}</th>)}</tr></thead>
          <tbody>
            {page.rows.map((row) => line(row, row.name))}
            {page.unplaced ? line(page.unplaced, t("kalite.units.unplaced")) : null}
            {line(page.total, t("kalite.units.total"))}
          </tbody>
        </Table>
        <p className="m-0 text-12 text-mute">{t("kalite.units.selectNote")}</p>
        {page.unplaced ? <p className="m-0 text-12 text-mute">{t("kalite.units.unplacedNote")}</p> : null}
      </>
    );
  }
  return (
    <Box title={t("kalite.units.title")} icon="building" level={2}>
      <div className="flex flex-col gap-2" data-units>{body}</div>
    </Box>
  );
}

/** The reasons × count: the hospital (or the scoped caller's units) and, once a row is selected, that row. */
function SnoozeBox({ t, lang, page, selection, selectionName }) {
  const columns = [{ key: TOTAL, name: t(page.scoped ? "kalite.snoozes.colScoped" : "kalite.snoozes.colHospital"),
    view: page.total.snoozes }];
  if (selection.key !== TOTAL) columns.push({ key: selection.key, name: selectionName, view: selection.snoozes });
  // A median of whole minutes may be a half: a decimal comma in az, tr and ru, a point in en.
  const minutes = (n) => (n === null ? <None />
    : t("kalite.snoozes.minutes", { n: lang === "en" ? String(n) : String(n).replace(".", ",") }));
  return (
    <Box title={t("kalite.snoozes.title")} icon="clock" level={2}>
      <div className="flex flex-col gap-2" data-snoozes>
        {page.total.snoozes.count === 0 ? <p className="m-0 text-13 text-mute">{t("kalite.snoozes.none")}</p> : (
          <Table caption={t("kalite.snoozes.caption")}>
            <thead>
              <tr>
                <th scope="col">{t("kalite.snoozes.colReason")}</th>
                {columns.map((column) => <th key={column.key} scope="col">{column.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {page.total.snoozes.byReason.map(({ reason }, at) => (
                <tr key={reason}>
                  <th scope="row">{t(REASON_KEYS[reason])}</th>
                  {columns.map((column) => <td key={column.key} className="font-data">{column.view.byReason[at].n}</td>)}
                </tr>
              ))}
              <tr>
                <th scope="row">{t("kalite.snoozes.rowTotal")}</th>
                {columns.map((column) => <td key={column.key} className="font-data">{column.view.count}</td>)}
              </tr>
              <tr>
                <th scope="row">{t("kalite.snoozes.rowMedian")}</th>
                {columns.map((column) => <td key={column.key} className="font-data">{minutes(column.view.medianMinutes)}</td>)}
              </tr>
            </tbody>
          </Table>
        )}
      </div>
    </Box>
  );
}

/** The selection's alarms by kind, as the engine names its kinds. */
function KindsBox({ t, selection, selectionName }) {
  const kinds = selection.alarms.perKind;
  const time = (d) => (d ? durationText(t, d) : <None />);
  return (
    <Box title={t("kalite.kinds.title", { unit: selectionName })} icon="bell" level={2}>
      <div className="flex flex-col gap-2" data-kinds>
        {kinds.length === 0 ? <p className="m-0 text-13 text-mute">{t("kalite.kinds.none")}</p> : (
          <Table caption={t("kalite.kinds.caption")}>
            <thead><tr>{KIND_COLUMNS.map((key) => <th key={key} scope="col">{t(key)}</th>)}</tr></thead>
            <tbody>
              {kinds.map((kind) => (
                <tr key={kind.kind}>
                  <th scope="row" className="font-data">{kind.kind}</th>
                  <td className="font-data">{kind.episodes}</td>
                  <td className="font-data">{kind.answered}</td>
                  <td className="font-data">{kind.escalated}</td>
                  <td className="font-data">{kind.unanswered}</td>
                  <td className="font-data">{time(kind.median)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </Box>
  );
}

export function KaliteScreen() {
  const { t, lang } = useI18n();
  const { user, store } = useSession();
  const may = Array.isArray(user?.perms) && user.perms.includes("quality.view");
  const [period, setPeriod] = useState(DEFAULT_PERIOD);
  const [selected, setSelected] = useState(TOTAL);
  const read = usePeriodRead({ store, may, period, read: readQuality, valid: isQualityAnswer });
  const page = qualityPage(readSource(read, may));
  const selection = selectionOf(page, selected);
  let selectionName = null;
  if (selection?.key === TOTAL) selectionName = t(page.scoped ? "kalite.snoozes.colScoped" : "kalite.snoozes.colHospital");
  else if (selection?.key === UNPLACED) selectionName = t("kalite.units.unplaced");
  else if (selection) selectionName = selection.name;
  const options = PERIODS.map((days) => ({ value: days, label: t(PERIOD_KEYS[days].label) }));
  const failed = !page.ok && page.why === WHY.failed;
  return (
    <div className="flex min-h-0 max-w-[1200px] flex-col gap-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 font-display text-23 font-bold">{t("kalite.title")}</h1>
          <p className="m-0 text-13 font-semibold">{t("kalite.motto")}</p>
          <p className="m-0 text-13 text-mute" data-as-of>
            {page.ok ? t("ozet.asOf", { time: hhmm(page.generatedAtMs) }) : t("kalite.noRead")}
          </p>
        </div>
        <Seg label={t("ozet.period.label")} options={options} value={period} onChange={setPeriod} />
        <Button size="sm" icon="clock" busy={may && read.phase === "loading"} onClick={read.retry}>{t("ozet.refresh")}</Button>
      </div>
      <p className="m-0 text-13 text-mute">{t("kalite.intro")}</p>
      {failed ? (
        <div data-failed>
          <Alert tone="crit">
            <p className="m-0">{read.error ? t("kalite.failed", { reason: readErrorText(t, read.error) }) : t("kalite.unreadable")}</p>
          </Alert>
        </div>
      ) : null}
      <Coverage t={t} page={page} />
      <Cards t={t} page={page} period={period} />
      <UnitsBox t={t} page={page} selectedKey={selection?.key ?? null} onSelect={setSelected} />
      {page.ok ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <SnoozeBox t={t} lang={lang} page={page} selection={selection} selectionName={selectionName} />
          <KindsBox t={t} selection={selection} selectionName={selectionName} />
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd /c/tmp/g4-kalite/dashboard && npx vitest run src/live/screens/kalite`
Expected: `Test Files 2 passed (2)` and `Tests 20 passed (20)` (`kalite.test.js` 8, `KaliteScreen.test.jsx` 12).

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g4-kalite && git add dashboard/src/live/screens/kalite/KaliteScreen.jsx dashboard/src/live/screens/kalite/KaliteScreen.test.jsx && git commit -m "feat(kalite): G4-03 KaliteScreen — period switch, coverage line, cards, units table with unplaced and total, snooze reasons and alarms by kind for the selected row; «—» with its reason, never 0" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/live/screens/kalite/KaliteScreen.jsx dashboard/src/live/screens/kalite/KaliteScreen.test.jsx
```

---

## Task 12 (dashboard): the `/kalite` route, the pinned tail, the rawKeys sweep

**Files:**
- Modify: `dashboard/src/live/shell/routes.js` (`lazyScreen` after Ozet; SCREENS after `ozet`; ROUTES after `ozet`)
- Test: `dashboard/src/live/shell/routes.test.js` (the management summary's block; a new block before «Yatak başı ölçüm»)
- Test: `dashboard/src/live/rawKeys.test.jsx` (an import; the sweep's mock; a new anchor test before the G4-01 one)

- [ ] **Step 1: Write the failing route tests: the pinned tail moves to the new last route**

In `dashboard/src/live/shell/routes.test.js`, find:

```js
// THE ONE PINNED TAIL of the table is here: a slice that adds a route after «devir» edits this line and no other.
// G3-04 put the pharmacy page between the handover screen and this one: devir → eczane → ozet → settings.
```

Replace with:

```js
// G3-04 put the pharmacy page between the handover screen and this one: devir → eczane → ozet. G4-03: «Kalite
// göstergeleri» comes right after it, and the table's one pinned tail is in that route's block now.
```

Then find:

```js
    expect(ROUTES.map((r) => r.id).slice(-3)).toEqual(["eczane", "ozet", "settings"]);
```

Replace with:

```js
    const ids = ROUTES.map((r) => r.id);
    expect(ids[ids.indexOf("ozet") + 1]).toBe("kalite");
```

Then find:

```js
// G3-01 (D3, D14): the bedside page opens with clinical.chart, on the rail after the ward's other screens.
```

Replace with:

```js
// G4-03 (spec D3): «Kalite göstergeleri» — for `quality.view`: the auditor group by default (migration 0020), the
// system administrator by rule, any group a hospital gives it. A work screen: a hospital's own quality group, given
// this key alone, signs in to it and lands on it. After the management summary, so nobody's home moves.
// THE ONE PINNED TAIL of the table is here: a slice that adds a route after «kalite» edits this line and no other.
// The order: devir → eczane → ozet → kalite → settings.
describe("the quality indicators' route", () => {
  afterEach(() => resetScreens());
  const kalite = () => ROUTES.find((r) => r.id === "kalite");
  /** The auditor's group (`auditor`), as the engine seeds it since G4-03 (auth/permissions.py). */
  const AUDITOR = ["board.view", "audit.view", "quality.view"];

  it("is a work screen for quality.view, on the main rail, with its own icon and names", () => {
    expect(kalite()).toMatchObject({ path: "/kalite", perms: ["quality.view"], work: true, nav: "main",
      icon: "star", labelKey: "kalite.nav", shortKey: "kalite.navShort" });
    expect(screenOf(kalite())).not.toBeNull();
    expect(ROUTES.map((r) => r.id).slice(-4)).toEqual(["eczane", "ozet", "kalite", "settings"]);
  });

  it("is the auditor's and the system administrator's, and moves neither's home", () => {
    expect(navRoutes(AUDITOR).main.map((r) => r.id)).toEqual(["beds", "alarms", "denetim", "kalite"]);
    expect(homePath(AUDITOR)).toBe("/beds");
    expect(navRoutes(ADMIN).main.map((r) => r.id)).toContain("kalite");
    expect(homePath(ADMIN)).toBe("/beds");
    for (const perms of [NURSE, ["handover.sign"], ["summary.view"], ["pharmacy.view"], ["audit.view"], ["devices.manage"]]) {
      expect(canReach(kalite(), perms), perms.join(",")).toBe(false);
    }
  });

  it("is a work screen: a group given only quality.view signs in to it and lands on it", () => {
    expect(hasWorkRoute(["quality.view"])).toBe(true);
    expect(homePath(["quality.view"])).toBe("/kalite");
  });
});

// G3-01 (D3, D14): the bedside page opens with clinical.chart, on the rail after the ward's other screens.
```

(`ADMIN` in this file is `[...PERMISSION_KEYS]`, which holds `quality.view` since Task 7.)

- [ ] **Step 2: Write the failing rawKeys anchor and the sweep's mock**

In `dashboard/src/live/rawKeys.test.jsx`, find:

```js
import { answer as pharmacyAnswer } from "./screens/eczane/eczane.testutil.js"; // G3-04
```

Replace with:

```js
import { answer as pharmacyAnswer } from "./screens/eczane/eczane.testutil.js"; // G3-04
import { ANSWER as QUALITY_SWEEP } from "./screens/kalite/kalite.testutil.js"; // G4-03
```

Then find:

```js
      api.pharmacy.mockResolvedValue(pharmacyAnswer());
```

Replace with:

```js
      api.pharmacy.mockResolvedValue(pharmacyAnswer());

      // G4-03: «Kalite göstergeleri» (screens/kalite) — a whole week: the units, the unplaced row, the snoozes.
      api.qualityIndicators.mockResolvedValue(QUALITY_SWEEP);
```

Then find:

```js
  // G4-01 — «Cihaz & Veri Akışı»: the device page's sections on a ward with a silent, a vanished and a stale-channel
```

Replace with:

```js
  // G4-03 — «Kalite göstergeleri»: its cards and its table, then — only once a unit is chosen — the snooze reasons'
  // second column and that unit's alarms by kind.
  it("the quality page's keys resolve on its cards, its table and a unit's selection", async () => {
    const mounted = await openAt("/kalite");
    expect(screen.getByRole("heading", { level: 1, name: "Keyfiyyət göstəriciləri" })).toBeInTheDocument();      // kalite.title
    const table = screen.getByRole("table", { name: "Şöbələrə görə keyfiyyət göstəriciləri" });                  // kalite.units.caption
    expect(within(table).getByText("Şöbəsi bəlli olmayan")).toBeInTheDocument();                                 // kalite.units.unplaced
    expect(screen.getByText("1 ədədi öz-özünə düzəldi")).toBeInTheDocument();                                     // kalite.cards.selfResolved
    await act(async () => { fireEvent.click(within(table).getByRole("button", { name: "Reanimasiya" })); await settle(); });
    expect(screen.getByRole("heading", { level: 2, name: "Növə görə siqnallar · Reanimasiya" })).toBeInTheDocument(); // kalite.kinds.title
    expect(rawKeys(document.body)).toEqual([]);
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
    act(() => { mounted.board.clear(); });
  });

  // G4-01 — «Cihaz & Veri Akışı»: the device page's sections on a ward with a silent, a vanished and a stale-channel
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd /c/tmp/g4-kalite/dashboard && npx vitest run src/live/shell/routes.test.js src/live/rawKeys.test.jsx src/reachable.test.js`
Expected: `6 failed | 64 passed`.
- `routes.test.js`: the summary block's relative-order test and the three new tests fail (`kalite()` is undefined).
- `rawKeys.test.jsx`: «the quality page's keys resolve…» fails, because `/kalite` is «no such page» and its heading is not found.
- `reachable.test.js`: «keeps no module the page cannot reach» lists the `screens/kalite` files.

- [ ] **Step 4: Add the route**

In `dashboard/src/live/shell/routes.js`, find:

```js
const OzetScreen = lazyScreen(() => import("../screens/ozet/OzetScreen.jsx"), "OzetScreen"); // G4-02
```

Replace with:

```js
const OzetScreen = lazyScreen(() => import("../screens/ozet/OzetScreen.jsx"), "OzetScreen"); // G4-02

const KaliteScreen = lazyScreen(() => import("../screens/kalite/KaliteScreen.jsx"), "KaliteScreen"); // G4-03
```

Then find:

```js
  ozet: OzetScreen, // G4-02 — «Yönetici özeti»: the cards, alarm quality, the units as of now; no patient
```

Replace with:

```js
  ozet: OzetScreen, // G4-02 — «Yönetici özeti»: the cards, alarm quality, the units as of now; no patient

  kalite: KaliteScreen, // G4-03 — «Kalite göstergeleri»: per unit, alarm response, snoozes, RRT, handovers; no patient
```

Then find:

```js
    perms: ["summary.view"], work: false, nav: "main" }),
```

Replace with:

```js
    perms: ["summary.view"], work: false, nav: "main" }),

  // G4-03 (spec D3) — «Kalite göstergeleri»: for whoever holds `quality.view` — the auditor group by default (migration
  // 0020), the system administrator by rule, any group a hospital gives it. A work screen: a hospital's own quality
  // group, given this key alone, signs in to it. After the management summary, so nobody's home moves.
  route({ id: "kalite", path: "/kalite", icon: "star", labelKey: "kalite.nav", shortKey: "kalite.navShort",
    perms: ["quality.view"], work: true, nav: "main" }),
```

- [ ] **Step 5: Run the route, sweep and boundary tests to see them pass**

Run: `cd /c/tmp/g4-kalite/dashboard && npx vitest run src/live/shell/routes.test.js src/live/rawKeys.test.jsx src/reachable.test.js src/live/boundaries.test.js src/live/shell/Shell.test.jsx src/routing.test.js`
Expected: `Test Files 6 passed (6)` and `Tests 157 passed (157)`; the sweep now visits `/kalite` with exactly one h1 and no raw key.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/g4-kalite && git add dashboard/src/live/shell/routes.js dashboard/src/live/shell/routes.test.js dashboard/src/live/rawKeys.test.jsx && git commit -m "feat(shell): G4-03 the /kalite route after ozet (quality.view, star, a work screen); routes.test pins the table's tail [eczane, ozet, kalite, settings] in its block; the rawKeys sweep reads the page" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/live/shell/routes.js dashboard/src/live/shell/routes.test.js dashboard/src/live/rawKeys.test.jsx
```

The dashboard lane is done: report the six shas to the coordinator.

---

## Task 13 (docs, after both lanes): the guide, §3.25

**Files:**
- Modify: `docs/homunculus-rehber-TR.md` (§3 «İzin»; after §3.24, before the `---` that precedes «## 4.»)

- [ ] **Step 1: The permission count**

In `docs/homunculus-rehber-TR.md`, find:

```markdown
- *Homunculus'ta:* 28 sabit anahtar (`board.view`, `alerts.ack`, `users.manage`, `groups.manage`…; en yenisi
  `pharmacy.view`, «Eczane», §3.23).
```

Replace with:

```markdown
- *Homunculus'ta:* 29 sabit anahtar (`board.view`, `alerts.ack`, `users.manage`, `groups.manage`…; en yenisi
  `quality.view`, «Kalite göstergeleri», §3.25).
```

- [ ] **Step 2: §3.25**

Find:

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

### 3.25 «Kalite göstergeleri»: birim birim bakım süreci (Grup 4 · G4-03)

- **Ne:** Sol raydaki **«Kalite göstergeleri»** sayfası (`/kalite`; Azerbaycanca «Keyfiyyət göstəriciləri», Rusça
  «Показатели качества», İngilizce «Quality indicators»; telefonun dar rayında «Kalite»). Birim birim bakım süreci,
  son 24 saat, 7 ya da 30 gün için, yalnız sistemin gerçekten kaydettiğinden: alarm yanıtı, erteleme, RRT çağrısı ve
  devrin karşı imzası. «Süreç ölçülür, kişi değil»: sayfa yalnız okur; hiçbir yerde hasta adı, kimliği ya da bir
  kişinin adı yoktur.
- **Durum:** kodda (`feat/g4-kalite`); main'e ve hastane sunucusuna sahibin sözüyle çıkar. Sunucuda göç `0020`
  çalışmalıdır.
- **Kim görür:** yeni yetki `quality.view` («Kalite göstergelerini görür») olan. Varsayılan **«Denetçi»** grubu taşır
  (göç `0020` var olan hastanelere verir; sonra kurulan bir hastanenin Denetçi grubu kendiliğinden taşır); Sistem
  Yöneticisi her yetkiyi kural gereği taşır. Başka bir gruba (ör. hastanenin kendi «Kalite birimi») Yönetim › Roller ve
  yetkiler'den kodsuz verilebilir. Bir çalışma ekranıdır: yalnız bu yetkiyi taşıyan bir hesap bununla oturum açar ve bu
  sayfaya düşer. Rayda «Yönetici özeti»nden sonra gelir; kimsenin giriş sayfası değişmedi (Denetçi yine «Yataklar»a
  düşer).
- **Sayfanın sırası (yukarıdan aşağı):**
  1. **Başlık:** «Kalite göstergeleri», «Süreç ölçülür, kişi değil», dönem seçici «Bugün» · «7 gün» · «30 gün»
     (açılışta 7 gün; «Bugün» takvim günü değil, son 24 saattir), yanıtın sunucudaki saati («10:42 itibarıyla») ve
     «Yenile».
  2. **Kapsam satırı:** «Bu dönemde {n} alarm olayından {m} tanesi bir birime bağlanabildi» ve bağlanamayanların neden
     bağlanamadığı (aşağıda). Kapsamı kısıtlı bir kullanıcıda: «Yalnız kapsamınızdaki birimler: …». Sunucunun okuma
     sınırı aşıldıysa bir not alarm, erteleme ve RRT sayılarının hangi andan başladığını söyler; devirler yine dönemin
     tamamından sayılır.
  3. **Kartlar («Hastane geneli · {dönem}»; kısıtlı kapsamda «Kapsamınızdaki birimler · {dönem}»):** alarm yanıt süresi
     (ortanca); yanıtlanan alarm oranı («yerleşen {n} alarm olayından {m} tanesi»; hiçbir olay yerleşmediyse «henüz
     yerleşen yok»); eskale edilen; yanıtsız kalan ve «{n} tanesi kendiliğinden düzeldi»; ertelenen (yüksek / orta);
     RRT çağrısı; devir karşı imza süresi (ortanca).
  4. **«Birimlere göre»:** her birim için bir satır (dönemde sayacak bir şeyi olmayan birim yazılmaz), sonra **«Birimi
     belli olmayan»** (yalnız kısıtsız kapsamda), sonra **«Toplam»**. Sütunlar: alarm olayı; yanıt ortancası ve p90'ı;
     yanıtlanan yüzdesi; eskale; yanıtsız (ayraç içinde kendiliğinden düzelen); erteleme; RRT çağrısı; devir (açılan /
     karşı imzalı / bekleyen); karşı imza ortancası. Bir birimin adına dokunmak onu seçer (sayfa değişmez).
  5. **«Erteleme nedenleri»:** beş neden (alarm ekranının «Ertele» penceresindeki sözcüklerle) × sayı; hastane geneli
     ve seçilen satır yan yana; toplam ve ortanca erteleme süresi.
  6. **«Türe göre alarmlar · {seçim}»:** seçilen satırın (açılışta hastane geneli) alarm türleri: olay, yanıtlanan,
     eskale, yanıtsız, ortanca yanıt.
- **Bir alarm bir birime nasıl bağlanır:** denetim kaydındaki alarm satırında yatak ya da birim yoktur, yalnız
  hastanın kart anahtarı vardır. Anahtar bu sistemde açılmış bir kabule aitse (0015'ten beri protokol numarası, daha
  eski bir kabulde H-numarası) o kabulün birimine bağlanır; kabulün yatağı, dolayısıyla birimi, sonradan değişmez
  (nakiller kapalı). HBYS'den gelen hastalar ve kimliği olmayan monitörler bağlanamaz: geçmiş konumları tutulmaz. İki
  ayrı birimde kabulü olan eski (H-numaralı) bir anahtar da bağlanmaz. Bağlanamayanlar «Birimi belli olmayan»
  satırında toplanır; kapsam satırı kaçının bağlanabildiğini söyler. Ertelemeler ve RRT çağrıları aynı yolla bağlanır;
  her devrin birimi zaten bellidir.
- **Sayılar nasıl sayılır:** alarmlar «Alarm kalitesi» raporunun kurallarıyla (§3.24): olay; yanıtlanan; 10 dakikası
  dolmamış bekleyen (orana girmez); oran; yanıt süresinin ortancası ve p90'ı (en yakın sıra). «Kendiliğinden
  düzelen»: hiç yanıtlanmamış ve kuralı kendiliğinden durmuş alarm (taburcu ile kapanan sayılmaz). Hastane geneli
  ortanca bütün olaylar üzerinden hesaplanır; birim ortancalarının ortalaması değildir. Devirler: dönemde açılan;
  karşı imzalı; karşı imza bekleyen; süresi dolan (30 dakikalık köprüsü devredenin imzası olmadan geçen); karşı imza
  süresi, devredenin imzasından karşı imzaya kadardır. «30 dakika içinde karşı imza» payı yoktur: karşı imzanın
  sistemde bir süresi yoktur.
- **Her sayı ya gerçektir ya da neden yok olduğunu söyler.** Sayfa okunurken, okunamadığında ya da yetki reddedildiğinde
  kartlar ve tablo «—» ve kısa nedeniyle yazılır («okunuyor…», «okunamadı», «yetki yok»); asla 0 yazılmaz. Biçimi
  beklenmeyen bir yanıt (tek bir bozuk sayı bile) okunamamış sayılır. Hiçbir olayın yerleşmediği bir oran «henüz
  yerleşen yok», üzerinde hiçbir şey olmayan bir ortanca «—» olarak yazılır.
- **Ne zaman okunur:** sayfa açılınca, dönem değişince ve «Yenile»de; zamanlayıcı yoktur (sunucu dönemin her olayını
  denetim kaydından yeniden kurar). En yeni okuma kazanır.
- **Sunucuda:**
  - yeni `GET /quality?days=1|7|30` (`quality.view`): birim başına sayılar ve süreler; yalnız çağıranın kurumu ve
    birimleri (yatak ataması bir birimi kapsamaz); hasta anahtarı, kişi ya da serbest metin yok;
  - `GET /alarm-quality` yanıtına yeni bir alan, `unanswered_resolved` (kendiliğinden düzelen yanıtsız alarmlar);
    başka bir alan değişmedi;
  - göç `0020`: Denetçi gruplarına `quality.view`.
- **Bu dilimde olmayanlar:** el görevlerinin zamanında yapılması ve vital ölçüm sıklığı; prototipin kaynaksız sayıları
  («3 dk içinde yanıtlanan», «Hatalı / artefakt olarak kapatılan», «Güvenlik olayları», «İncelenecek olaylar», cihaz
  kesintisi); «Rapor al» ya da dışa aktarma; HBYS'den gelen hastaların birime bağlanması (konum geçmişi ister);
  nakiller (açılırsa anahtar → birim eşlemesi zamana bağlı olmalı).
- **Kaynak:** `docs/superpowers/specs/2026-11-11-g4-kalite-gostergeleri-design.md`; plan
  `docs/superpowers/plans/2026-11-11-g4-kalite-gostergeleri.md`.

---

## 4. "Neden bunu kullanmıyoruz" köşesi
```

- [ ] **Step 3: Check it**

Run: `cd /c/tmp/g4-kalite && grep -n "^### 3.2[2-5]\|^## 4\.\|29 sabit anahtar" docs/homunculus-rehber-TR.md`
Expected:
- one `29 sabit anahtar` line;
- `### 3.22 …`, `### 3.23 «Eczane» …`, `### 3.24 «Yönetici özeti» …`, `### 3.25 «Kalite göstergeleri» …`, then `## 4. …`, in that order.

- [ ] **Step 4: Commit**

```bash
cd /c/tmp/g4-kalite && git add docs/homunculus-rehber-TR.md && git commit -m "docs(rehber): §3.25 «Kalite göstergeleri» (G4-03) — who sees it, the page, how an alarm is tied to a unit, how it is counted, «—» with a reason; 29 permission keys" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- docs/homunculus-rehber-TR.md
```

---

## Task 14: the gates (after Tasks 1–13)

**Files:** none. A failure goes back to the owning lane as a fix commit (pathspec, Co-Authored-By line); then the failed chunk is run again.

- [ ] **Step 1: The whole no-DB engine suite, in foreground chunks**

Run from `C:\tmp\g4-kalite\homunculus-engine`. Each line is one tool call; never run `test_infinity_vm_pilot.py`.

```bash
cd /c/tmp/g4-kalite/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_a*.py -q -p no:cacheprovider
cd /c/tmp/g4-kalite/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_[b-d]*.py -q -p no:cacheprovider
cd /c/tmp/g4-kalite/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_[e-h]*.py -q -p no:cacheprovider
cd /c/tmp/g4-kalite/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_[i-l]*.py --ignore=tests/test_infinity_vm_pilot.py -q -p no:cacheprovider
cd /c/tmp/g4-kalite/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_[m-r]*.py -q -p no:cacheprovider
cd /c/tmp/g4-kalite/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_[s-z]*.py tests/rules tests/scoring tests/tenant -q -p no:cacheprovider
```

Expected, no failure and no error (each chunk under about 2.5 minutes):

| Chunk | Passed | Skipped |
|---|---|---|
| `test_a*` | 910 | 484 |
| `test_[b-d]*` | 393 | 330 |
| `test_[e-h]*` | 405 | 85 |
| `test_[i-l]*` | 1317 | 29 |
| `test_[m-r]*` | 411 | 166 |
| `test_[s-z]*` and the sub-folders | 610 | 234 |
| **Total** | **4046** | **1328** |

The slice's own no-DB tests are 20 (Task 1: 1, Task 2: 5, Task 3: 12, Task 5: 1, Task 6: 1, the new proxied path); its 12 DB-backed ones skip here. When the plan was written, six of these tests (`test_dev_waves_bench`, `test_dev_waves_replay` and `test_infinity_release` ×3, `test_infinity_transport`: they need a git repository) could only be run in the worktree, where all six passed; they are counted as passed above.

- [ ] **Step 2: The DB-backed tests the slice touches, on the throwaway Postgres**

One call each (the third takes about 2.5 minutes, the fourth 4 to 11 and the fifth about 2.5):

```bash
docker run -d --rm --name kalite-pg -p 127.0.0.1:56453:5432 -e POSTGRES_PASSWORD=ozet -e POSTGRES_DB=ozet postgres:16
timeout 60 bash -c 'until docker exec kalite-pg createdb -U postgres ozet_test 2>/dev/null; do :; done'
cd /c/tmp/g4-kalite/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:ozet@127.0.0.1:56453/ozet_test "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_quality_api.py tests/test_quality_indicators.py tests/test_migration_0020_quality_view.py tests/test_migration_0018_care_team_transfer.py tests/test_tasks_postgres.py tests/test_migration_0019_pharmacy_view.py tests/test_permissions.py tests/test_groups_service.py tests/test_route_permissions.py -q -p no:cacheprovider
cd /c/tmp/g4-kalite/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:ozet@127.0.0.1:56453/ozet_test "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_tenant_isolation.py -q -p no:cacheprovider
cd /c/tmp/g4-kalite/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:ozet@127.0.0.1:56453/ozet_test "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_admin_api.py -q -p no:cacheprovider
docker stop kalite-pg
```

Expected: no failure, no error, no skip: `115 passed`, `134 passed`, `70 passed` (the auditor's default group gained a key: the administration routes read the groups). Report each `N passed` line as printed. Stop the container even if a test failed.

- [ ] **Step 3: The whole dashboard suite**

Run: `cd /c/tmp/g4-kalite/dashboard && npx vitest run` (foreground, timeout 600000).
Expected: `Test Files 168 passed (168)` and `Tests 4478 passed (4478)`: 165 files before this slice plus `kalite.strings.test.js`, `kalite.test.js` and `KaliteScreen.test.jsx`; 30 new tests (4 + 8 + 12, and one each in `useSummaryReads.test.js`, `backendApi.test.js` and `rawKeys.test.jsx`, three in `routes.test.js`). If the tool moves the run to the background, wait for its notification and start no second run; two vitest runs at once on the shared `node_modules` junction can fail with «Vitest failed to find the current suite» — run again, it is not a code error.

- [ ] **Step 4: The build**

Run: `cd /c/tmp/g4-kalite/dashboard && npx vite build`
Expected: `✓ built in …`, with no error. The page is its own chunk, `assets/KaliteScreen-*.js`, about 13 kB; what it shares with the summary page (`words.jsx`, `ozet.js`, `useSummaryReads.js` and what they import) becomes a shared chunk, `assets/words-*.js`, about 11 kB, and `OzetScreen-*.js` shrinks to about 10 kB. The PWA precache grows from 67 to 69 entries (the two new chunks). The «Some chunks are larger than 500 kB» warning is the vendor chunk's (`Toast-*.js`, 595 kB) and is there before this slice too. `dist/` is git-ignored (`dashboard/.gitignore`).

- [ ] **Step 5: Nothing stray**

Run: `cd /c/tmp/g4-kalite && git status --short && git log --oneline 0a4b3808..HEAD`
Expected: a clean tree. The log holds the plan's commit and the thirteen task commits (six engine, six dashboard, one docs), plus any fix commits, each named.

- [ ] **Step 6: Report** to the coordinator:
- the shas and the gate counts;
- what a reviewer should eyeball in a browser:
  - the page at 390 px: the seven cards wrap, the units table scrolls inside its frame, the two boxes stack;
  - the rail at phone width with «Kalite» / «Keyfiyyət» / «Качество» / «Quality»;
  - a session holding `quality.view` alone lands on `/kalite`;
  - the az, ru and en wording, which await a native speaker before the pilot.

Do not push, do not merge, and send nothing to the VM.

---

## Self-review

**Spec coverage.**
- §1 (what the system has): the episodes from `build_episodes` (Task 3 `alarms_of`, Task 4 the read); the key → unit map in Python from the admissions table (Task 4 `units_of_keys`; N6); snoozes and RRT calls through the same map (Task 3; N6, N10); handovers by their own `unit_id` (Task 4's query, Task 3 `handovers_of`; N11). Nothing from «no source» is built.
- D1 (scope): per unit over 1, 7, 30 days — alarm response (median, p90), the answered rate, escalations, unanswered with the self-resolved apart, countersignature times, snoozes and reasons, RRT calls (Tasks 2–4, 10–11). No task timeliness, no charting frequency.
- D2, D3: `quality.view` with the spec's text, the auditor by migration and by `DEFAULT_GROUPS`, the system group by rule, mirrored in `catalogue.js`, `admin.testutil.js` and the four-language `perms.js` (Tasks 1, 5, 7). The route after `ozet`, `work: true`, `nav: "main"`, icon `star` (Task 12; N15, N16).
- D4:
  - the guard, `days` ∈ {1, 7, 30} else 422, `days=1` = 24 h (Task 4; N4);
  - the capped newest read of `EPISODE_KINDS ∪ {alert_snooze, rrt_call}`, `truncated` (Task 4; N2, N3);
  - `units_of_keys`: protocol number, legacy H-number, ambiguous, unknown, another tenant's (Task 4's first test; N6);
  - handovers by `bridge_opened_at`, the caller's tenant (Task 4);
  - the answer's shape exactly (Task 3 pins the keys; the shared contract); every block's fields (Tasks 3–4); `unanswered_resolved` (Task 2; N5);
  - scope: unrestricted gets `unplaced`; scoped gets her unit grants only, `hospital` and `coverage` hers, `scoped: true`; reaching nothing gives zeros (Tasks 3–4; N7);
  - the additive `/alarm-quality` field, no other change (Task 2's key-set test);
  - route tables 76, the tenant-isolation rule by its own walk, nginx's proxied prefix, no log-map line (Task 6; N1, N13).
- D5: header, coverage line (scoped and truncated variants), seven cards, units table with «Birimi belli olmayan» and «Toplam», snooze reasons for the hospital and the selection, per-kind alarms for the selection, Decision 18 «—» with a reason, null rate and median words, read on open / period change / «Yenile» only, newest wins (Tasks 9–11; N17–N19).
- D6: nothing out of scope is built.
- D7: `0020_quality_view`, the auditor of every tenant, downgrade deletes it, parent `0019` (Task 5; N14).
- §4 Tests: every engine and dashboard test the spec lists has a task (Tasks 1–7, 10–12), and the gates (Task 14).

**Dry run.**
- The plan's own find and create blocks were applied, in task order, by a script that reads this file, to a scratch copy of the worktree at `0a4b3808` (outside the repository): 47 replacements and 15 new files, each find occurring exactly once at its point.
- Each failing step was checked by putting the task's code back to the head's and running its tests: Task 1 `5 failed, 17 passed`; Task 2 `5 failed, 29 passed`; Task 3 the missing module; Task 4 the `ImportError`; Task 5 `4 failed` (`FileNotFoundError`, `Can't locate revision`); Task 6 `1 failed`; Task 7 `4 failed | 18 passed`; Task 8 `1 failed | 146 passed`; Task 9 `1 failed | 10 passed`; Tasks 10–11 the missing modules; Task 12 `6 failed | 64 passed`.
- On the final state:
  - every "pass" count written in Tasks 1–12;
  - the no-DB engine suite in the six chunks of Task 14 Step 1; six tests that need a git repository failed only in the scratch copy and passed in the worktree;
  - the DB-backed tests of Tasks 4, 5 and 14 Step 2 on a throwaway `postgres:16`: `21 passed`, `30 passed`, `115 passed`, `134 passed` (`test_tenant_isolation.py`, in five parts) and `70 passed` (`test_admin_api.py`);
  - the whole dashboard suite: 168 files, 4478 tests passed (in four parts), `engineTypes.test.js` among them;
  - `vite build`: built, `KaliteScreen` 13.3 kB, the shared `words` chunk 11.1 kB, precache 69 entries.

**Placeholder scan.** No TBD and no "similar to". Every step that changes code shows the code; every run states its command and its expected result.

**Type and name consistency.**
- Engine: `PERMISSIONS["quality.view"]`; `Episode.self_resolved`, `AlarmQuality.unanswered_resolved`; `indicators.QUALITY_KINDS`, `SNOOZE`, `RRT_CALL`, `HandoverFacts(unit_id, status, bridge_expires_at, outgoing_signed_at, incoming_signed_at)`, `Reach(units, scoped)`, `alarms_of(episodes, now)`, `snoozes_of(rows)`, `handovers_of(rows, now)`, `build_report(*, records, key_units, reach, handovers, now, days, window_from, truncated)`; `router.QUALITY_VIEW`, `QUALITY_DAYS`, `READ_CAP`, `KEYS_PER_QUERY`, `units_of_keys(db, tenant_id, keys)`, `get_quality`; migration `0020` `KEY`, `GROUP`.
- Dashboard API: `api.qualityIndicators(days = 7)`; the `fakeApi` mock `qualityIndicators`.
- `useSummaryReads.js`: `usePeriodRead({store, may, period, read, valid}) → {phase, data, atMs, error, retry}`; `useQuality` unchanged in use.
- `words.jsx`: `PERIOD_KEYS`, `durationText(t, d)`, `Missing({t, why, big})`.
- `kalite.js`: `TOTAL`, `UNPLACED`, `REASON_KEYS`, `readQuality(api, days)`, `isQualityAnswer`, `alarmsView`, `snoozesView`, `handoversView`, `qualityPage(source) → {ok:false, why} | {ok:true, scoped, truncated, windowFromMs, generatedAtMs, coverage, rows, unplaced, total}`, `selectionOf(page, key)`; a row is `{key, name, alarms, snoozes, rrt, handovers}`.
- Every `kalite.*` key the screen uses exists in `strings/kalite.js` in four languages; the reused keys exist (`ozet.period.*`, `ozet.why.*`, `ozet.asOf`, `ozet.refresh`, `ozet.q.sec`, `ozet.q.minSec`, `ozet.q.unsettled`, `ozet.q.noAnswered`, `ertele.reason.*`).

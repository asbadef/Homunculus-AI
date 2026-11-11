# G4-02 «Yönetici özeti» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Task 1 runs first, alone** (the permission key both halves read). Then two implementers run the **engine lane** (Tasks 2–4) and the **dashboard lane** (Tasks 5–9) **in parallel, in the same worktree**. Task 10 (docs) and Task 11 (gates) run after both lanes report.

**Goal:** A read-only page `/ozet` «Yönetici özeti» for `summary.view` that shows the hospital at a glance from real data only: four «Unutulan işler» cards, the hospital-wide alarm quality over 1, 7 or 30 days, and the units as of now. Every number is real or a «—» with its reason, never an invented 0.

**Architecture:**
- **Engine, two small changes and no migration:**
  - the key `summary.view`, in no default group (the system group holds it by rule);
  - `GET /handovers/pending`: per unit, the handovers waiting for a countersignature, counts and times only, scoped by a new `unitscope.unit_clause`;
  - a fix to `GET /tasks`, which now reads each patient's `unit_id` and `bed_key` from the card's `identity`.
- **Dashboard:**
  - a pure `screens/ozet/ozet.js` turns each source into "a number, or why not" (Decision 18) and joins them per unit;
  - `useSummaryReads.js` polls the three page-owned reads;
  - `OzetScreen.jsx` words it, under a new `ozet` string namespace;
  - the route goes after `devir`.
- **Sources the page reads:**
  - the live board and the shadow board through the stores the app already keeps;
  - the tree through the shell's `StructureProvider`.

**Tech Stack:**
- Engine: Python 3.14, FastAPI, SQLAlchemy 2 (async), pytest.
- Dashboard: React 18, Vitest 2, Testing Library, Tailwind.
- Guide: Turkish Markdown.

**Spec (the contract):** `docs/superpowers/specs/2026-11-11-g4-yonetici-ozeti-design.md`, committed at `1cc05c47`; this plan's commit changes its guide-section line to §3.24. Read the spec whole before your first task.

---

## Plan notes: where the spec meets the code

Each note records a choice this plan makes where the spec and the tree disagree, or where the spec leaves a detail open. The notes bind the implementers. A reviewer who disagrees raises it; the implementer does not improvise.

**N1: The icon.**
- The rail entry uses `chart`, the bar chart already in `ui/icons.js` `ICON_NAMES`. No route uses it today; the audit heatmap uses it only inside a box.
- The four cards use the prototype's icons: `bell`, `clip`, `clock` and `plug`.

**N2: `work: false`, and who sees the rail entry.**
- The route is `{ id: "ozet", path: "/ozet", icon: "chart", labelKey: "ozet.nav", shortKey: "ozet.navShort", perms: ["summary.view"], work: false, nav: "main" }`. It sits after `devir`, so nobody's home moves; `hospital_admin` still lands on «Yataklar».
- The rail shows the entry to every holder of `summary.view`. By default that is the system administrator alone.
- Consequence of `work: false`: a session holding `summary.view` and nothing else does not pass the entry rule (`hasWorkRoute` is false). A group a hospital gives only this key must also get a work right. Task 9 pins this with a test; the guide says it.

**N3: The `/handovers/pending` answer.**
- Shape: `{"units": [...], "generated_at": ...}`, read from the spec's "`[{…}]`, then `generated_at`".
- Units are sorted by name, then id.
- `oldest_outgoing_signed_at` is nullable in the schema. The OUTGOING_SIGNED transition always sets it; the null is defensive.
- The page ages the oldest handover against `generated_at`, the server's own clock, so a wrong browser clock cannot shorten it.

**N4: Scope for a row that has a unit and no bed.**
- `unitscope.reach_clause` needs a bed column, and a handover has none.
- A new `unitscope.unit_clause(scope, *, unit_id)` is its unit-level twin:
  - an unrestricted scope gets no filter;
  - otherwise the unit grants only;
  - a bed grant alone reaches no handover.
- The spec says "`reach_clause`"; this is the same rule written for a unit-level row.

**N5: Where the per-unit join happens.**
- It happens in the pure `screens/ozet/ozet.js`, `summarise()`.
- Keys are unit ids under `normId` (trimmed, lower-cased). The rows are the tree's units, in tree order.
- **«Birimi belli olmayan»** collects:
  - a live-board card whose `identity.unit_id` is null;
  - a `/tasks` patient whose `unit_id` is null;
  - an unassigned or unit-less monitor;
  - any unit id the tree does not hold.
- That row is drawn only when one of its cells counts more than zero. Its occupancy cell is empty, because beds belong to units.
- A closed unit (`is_active: false`) keeps its row and says «· kapalı», in Doluluk's own word.

**N6: What «Geciken iş» counts.**
- For each patient `/tasks` answers over its default window, the current shift: every hand task the server marks `late: true` (open, past due plus grace, `api/tasks.py hand_state`), plus 1 if `vital.state === "late"`.
- A hand task due in an earlier shift is outside the window and not counted, per the spec's "over the current shift".

**N7: Decision 18, source by source.** Each source in `ozet.js` is either "an answer it may count from" or "none, and why".
- **Live board:** counts the bell's own list (`waitingAlarms`: no acknowledged, chronic-expected or snoozed alarm), and only while LIVE.
  - DEGRADED: «pano güncel değil».
  - CONNECTING: «okunuyor…».
  - UNAVAILABLE: «okunamadı».
- **Shadow board:** G4-01's rules (`deviceFeed.js`, `readUnknown`). It counts only while fresh.
  - chain broken: «veri zinciri kesik»;
  - unknown state or counts: «bilinmiyor»;
  - strip off: «monitör şeridi kapalı»;
  - a view with no monitor: 0, with «Bu görünümde monitör yok».
- These four reason words add to the spec's three («okunamadı», «pano güncel değil», «yetki yok»), in its spirit: a missing number says why.

**N8: The tree comes from the shell's StructureProvider, not a second copy.**
- The page calls `useStructure().reload()` on open, on «Yenile» and every 60 s while visible. Doluluk reads the same tree.
- Occupancy counts only in phase `known`.
- Rows are drawn from the last tree held even when its newest read failed; the occupancy column then says «— okunamadı».
- With no tree at all, the table is replaced by «Birim satırları yazılamıyor · {why}».

**N9: «Yenile» and the header's time.**
- «Yenile» re-reads the tree, `/tasks` and `/handovers/pending`. It does **not** re-read `/alarm-quality`: spec D5 §3 says open and period change only. The quality box shows its own «HH:MM itibarıyla».
- The header's «HH:MM itibarıyla» is the end of the last round in which every source this session may read answered.

**N10: A failed read drops its last answer.** The source becomes «okunamadı»; the old number is never shown as today's. An answer of the wrong shape counts as a failure, for example a `/tasks` answer without `patients`, or a report without an integer `episodes`.

**N11: «Bugün» means the last 24 hours.**
- The switch keeps the spec's labels «Bugün · 7 gün · 30 gün» and opens on 7, the API's default and the prototype's.
- `/alarm-quality?days=1` means the last 24 hours, not the calendar day. So card 1's title and the box intro name the period honestly: «son 24 saat», «son 7 gün», «son 30 gün».

**N12: The truncated note.**
- The spec's «yalnız en yeni {n} kayıt okundu; dönem {from}'dan başlıyor» has two problems with the code:
  - the answer does not carry the server's cap (`ALARM_QUALITY_LIMIT_MAX` = 20000, lowered by `limit`), so printing {n} would invent a number;
  - «{from}'dan» glues a suffix to a date.
- The note says instead: «Sunucunun okuma sınırı aşıldı: yalnız en yeni kayıtlar okundu; sayılan dönem {from} ile başlıyor, daha eskiler sayılmadı.» With no `window_from`, it drops the date. This follows the heatmap's precedent.

**N13: The days are UTC.** The `per_day` bars are UTC calendar days (`alarm_quality.py`: `ep.started.date()`), and the box says so under the bars.

**N14: Occupancy uses Doluluk's words and counts.**
- The spec writes «{n} rezerve», «{n} kapalı».
- The page uses Doluluk's `unitCounts` and its own strings, so one bed state has one name on every screen:
  - `doluluk.occupied` «{occupied} / {usable} dolu»;
  - then, when above zero, `doluluk.counts.reserved` «{n} rezerve», `doluluk.counts.outOfService` «{n} kullanım dışı» and `doluluk.counts.maintenance` «{n} bakımda».
- «kapalı» stays Doluluk's word for a closed unit (N5).

**N15: No patient-level field reaches the page.**
- `/alarm-quality` also returns `noisiest_beds` and `per_patient_hour`, both keyed by patient. `qualityView()` does not carry them; a test pins it.
- Alert kinds are printed as the engine's slugs, as the alarms screen prints them.

**N16: The `/tasks` fix.**
- `unit_id` and `bed_key` now come from `(card.identity or {})`, with `or None` so that an empty text is null.
- No dashboard code reads the old fields, which were always null; the page is the first consumer.

**N17: Merging with the pharmacy slice (`feat/g3-eczane`, not merged yet).** The agreed final order is devir → eczane → ozet → settings. Whichever branch merges second does the following:
- `routes.js`: ozet's three entries (the `lazyScreen` line, the SCREENS line and the ROUTES entry) go after eczane's.
- `routes.test.js`: this plan pins the table's tail in **one** place, the «management summary's route» block `slice(-3)`. With eczane it becomes `["eczane", "ozet", "settings"]`. The audit, RRT and handover blocks now assert only relative order (Task 9).
- `homunculus-engine/tests/test_route_permissions.py`: recount `EXPECTED`. It is 73 here, plus 1 if `GET /pharmacy` lives in a `GUARDED_MODULES` router.
- `tests/test_board_permissions.py`: recount `BOARD_EXPECTED` if `GET /pharmacy` lives in `homunculus.api.app`. The routes there are counted in that test, not in `EXPECTED`.
- `auth/permissions.py` and the dashboard's mirrors: `summary.view` and `pharmacy.view` both append after `tasks.manage`. Keep both, in one order, in four places: `PERMISSIONS`, `catalogue.js` `PERMISSION_KEYS`, `admin.testutil.js` `PERMISSION_TEXTS` and `perms.js` (four languages).
- `test_permissions.py`: `SPEC_KEYS` becomes 28; rename the count test.
- The guide's «27 sabit anahtar» becomes 28.
- Everything else of this slice sits in its own block with blank lines around it: `catalog.js`, `strings.test.js` `AZ_SAME_AS_TR`, `testTokens.testutil.js` and `rawKeys.test.jsx`.

**N18: The guide section is §3.24.**
- §3.23 is reserved for the pharmacy slice; the gap is expected.
- §3.24 goes right before the `---` that precedes «## 4.», after §3.22.
- This plan's commit also changes the spec's header line «Guide section: §3.23» to §3.24.

---

## Execution rules (both lanes; read before Task 0)

- **Code exploration:**
  - `graphify-out/graph.json` lives in the main checkout `C:/Users/User/Desktop/Project/Homunculus AI` and was built from an older branch.
  - Before your first grep or source read for a codebase question, run `graphify query "<question>"` from that directory: `cd "/c/Users/User/Desktop/Project/Homunculus AI" && graphify query "..."`. Then read the **worktree's** files (`C:\tmp\g4-ozet`) for the current lines.
  - Use `graphify path "<A>" "<B>"` or `graphify explain "<concept>"` for focused questions.
  - **Never run `graphify update`.**
- **Tests run in the FOREGROUND only.**
  - Never background a test run and wait on it. Split a long run into chunks instead.
  - Report before you wait on anything.
- **Engine tests** run from `C:\tmp\g4-ozet\homunculus-engine`, always written out in full (shell variables do not persist between tool calls):
  `"/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest <paths> -q -p no:cacheprovider`
  pytest's `pythonpath = ["src", "tests"]` (pyproject) puts the worktree's `src` ahead of the venv's editable install of the main checkout; Task 0 checks it.
- **Dashboard tests** run from `C:\tmp\g4-ozet\dashboard`: `npx vitest run <files>`. `node_modules` is a junction and is already present.
- **Never:**
  - `npm install` or `pip install`;
  - set `DATABASE_URL`. DB tests use `TEST_DATABASE_URL`, and only on the throwaway Postgres below;
  - run `tests/test_infinity_vm_pilot.py`.
- **Git:**
  - Never a bare `git stash`. Never `git add -A`, never `git commit -a`.
  - Every commit names its paths, run from `C:\tmp\g4-ozet`:
    `git add <paths>`, then `git commit -m "<subject>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- <paths>`.
    The pathspec matters: the other lane may have files staged at the same moment, and `git commit -- <paths>` commits only yours. A new file must be `git add`ed before the pathspec commit can name it.
  - If `.git/index.lock` exists, the other lane is committing: wait a few seconds and retry. **Never delete it.**
- **Line endings and editing:** `core.autocrlf=true`, so tracked files are CRLF in the working tree.
  - Edit existing files with the **Edit** tool, or with a `python -I -X utf8` script that writes `\r\n`.
  - Create new files with the **Write** tool.
  - **Never** write code with a Bash heredoc: the Bash tool mangles backslashes in heredocs.
- **Find blocks:** every **find** block below occurs **exactly once** in its file at that point of the plan (checked on a scratch copy when the plan was written). If one does not match, stop and report; do not guess.
- **No patient data:** synthetic ids only (`S-001`, `S-3`, `192.0.2.x`), synthetic names (`Ayşe Sentetik`, `Sentetik Hasta`).
- Do not push. Do not merge. Do not touch the VM.

### The throwaway Postgres (DB-backed tests: Tasks 3 and 11)

The DB tests drop every table, so they run only against a private, disposable database. **Never use the shared `56432`.** Each line is one foreground tool call, from `C:\tmp\g4-ozet\homunculus-engine`:

```bash
docker run -d --rm --name ozet-pg -p 127.0.0.1:56446:5432 -e POSTGRES_PASSWORD=ozet -e POSTGRES_DB=ozet postgres:16
timeout 60 bash -c 'until docker exec ozet-pg pg_isready -U postgres -q; do :; done' && docker exec ozet-pg createdb -U postgres ozet_test
TEST_DATABASE_URL=postgresql+asyncpg://postgres:ozet@127.0.0.1:56446/ozet_test "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest <paths> -q -p no:cacheprovider
docker stop ozet-pg
```

- The `TEST_DATABASE_URL=… python …` prefix sets the variable for that one command only. The database name must contain `test` (`tests/conftest.py` refuses any other).
- Run one pytest at a time against it: two concurrent runs corrupt each other.
- Always `docker stop ozet-pg` at the end, even after a failure. `--rm` then deletes it.

## Order, lanes and file ownership

1. **Task 0** (each implementer): preflight.
2. **Task 1** (engine implementer, **alone, first**): the key `summary.view`. After its commit, three dashboard tests go red until Task 5 by design, because they read `permissions.py` as text: `catalogue.test.js`, `admin.testutil.test.js` and `RolesTab.test.jsx`.
3. **In parallel:** the engine lane (Tasks 2→3→4) and the dashboard lane (Tasks 5→6→7→8→9). The two lanes share **no file**.
4. **Task 10** (docs), then **Task 11** (gates).

| Lane | Tasks | Files (only these) |
|---|---|---|
| Engine | 1–4 | `homunculus-engine/src/homunculus/auth/permissions.py`, `homunculus-engine/tests/test_permissions.py`, `homunculus-engine/src/homunculus/api/tasks.py`, `homunculus-engine/tests/test_tasks_api.py`, `homunculus-engine/src/homunculus/admission/unitscope.py`, `homunculus-engine/tests/test_unit_scope.py`, `homunculus-engine/src/homunculus/admission/schemas.py`, `homunculus-engine/src/homunculus/admission/router.py`, `homunculus-engine/tests/test_handover_api.py`, `homunculus-engine/tests/test_route_permissions.py`, `homunculus-engine/tests/test_nginx_routes.py`, `deploy/local/web/nginx.conf` |
| Dashboard | 5–9 | `dashboard/src/live/i18n/strings/ozet.js` (new), `dashboard/src/live/i18n/ozet.strings.test.js` (new), `dashboard/src/live/i18n/catalog.js`, `dashboard/src/live/i18n/strings.test.js`, `dashboard/src/live/i18n/strings/perms.js`, `dashboard/src/live/screens/admin/catalogue.js`, `dashboard/src/live/screens/admin/admin.testutil.js`, `dashboard/src/backendApi.js`, `dashboard/src/backendApi.test.js`, `dashboard/src/live/session/testTokens.testutil.js`, `dashboard/src/live/screens/ozet/ozet.js` (new), `dashboard/src/live/screens/ozet/ozet.test.js` (new), `dashboard/src/live/screens/ozet/useSummaryReads.js` (new), `dashboard/src/live/screens/ozet/OzetScreen.jsx` (new), `dashboard/src/live/screens/ozet/ozet.testutil.jsx` (new), `dashboard/src/live/screens/ozet/OzetScreen.test.jsx` (new), `dashboard/src/live/shell/routes.js`, `dashboard/src/live/shell/routes.test.js`, `dashboard/src/live/rawKeys.test.jsx` |
| Docs (after both) | 10 | `docs/homunculus-rehber-TR.md` |
| Gates (last) | 11 | none (fixes go back to the owning lane) |

The dashboard lane never needs the engine running: its tests use fixtures in the contract's shape below.

## The shared contract

**`summary.view`** (Task 1; mirrored by Task 5):

| Where | Text |
|---|---|
| `auth/permissions.py` `PERMISSIONS["summary.view"]`, appended after `tasks.manage` | `"Open the Yönetici özeti page and read each unit's handovers waiting for a countersignature (GET /handovers/pending), as counts and times only"` |
| `catalogue.js` `PERMISSION_KEYS` | `"summary.view"`, last |
| `admin.testutil.js` `PERMISSION_TEXTS["summary.view"]` | the same English text, word for word |
| `perms.js` `summary.view` | tr «Yönetici özetini görür» · az «Rəhbər xülasəsini görür» · ru «Видит сводку для руководства» · en «See the management summary» |
| Default groups | none. `hospital_admin` holds it by rule (`tuple(PERMISSIONS)`); no migration |

**`GET /handovers/pending`** (Task 3), guard `summary.view`:

| Field | Type | Example | Meaning |
|---|---|---|---|
| `units` | array | `[{…}]` | the units with at least one handover waiting, by `unit_name` then `unit_id`; a unit with none is left out |
| `units[].unit_id` | string (UUID) | `"33333333-3333-4333-8333-333333333301"` | the handover's unit; the page joins it to `/tenant/structure` |
| `units[].unit_name` | string | `"Reanimasiya"` | the unit's name |
| `units[].pending` | integer ≥ 1 | `2` | handovers in `OUTGOING_SIGNED` |
| `units[].oldest_outgoing_signed_at` | string (ISO) \| null | `"2026-11-09T09:00:00+00:00"` | the earliest outgoing signature among them (OUTGOING_SIGNED never expires) |
| `generated_at` | string (ISO) | `"2026-11-11T10:00:00+00:00"` | the server's time; the page ages the oldest against it |

- Scope: the caller's tenant (the unit's site) and units (N4).
- 403 without `summary.view`.
- No patient, no note and no person anywhere in the answer.

**`GET /tasks`** (Task 2):
- `patients[].unit_id` is the card's `identity.unit_id`.
- `patients[].bed_key` is the card's `identity.bed_key`.
- Both are null for a card with no identity, or with an empty value. Nothing else in the answer changes.

## File map

**Engine**
- `auth/permissions.py`: `summary.view` (Task 1).
- `api/tasks.py`: `GET /tasks` reads `identity.unit_id`/`identity.bed_key` (Task 2).
- `admission/unitscope.py`: `unit_clause()` (Task 3).
- `admission/schemas.py`: `PendingUnit`, `PendingHandovers` (Task 3).
- `admission/router.py`: `SUMMARY_VIEW`; `GET /handovers/pending` after `GET /handovers/colleagues` (Task 3).
- Tests:
  - `test_permissions.py` (Task 1);
  - `test_tasks_api.py` (Task 2);
  - `test_unit_scope.py` (no-DB) and `test_handover_api.py` (DB-backed) (Task 3);
  - `test_route_permissions.py`, `test_nginx_routes.py` (Task 4).
- `deploy/local/web/nginx.conf`: the access-log map's line for the new path (Task 4).

**Dashboard**
- `i18n/strings/ozet.js` (new) and its entry in `catalog.js`; `i18n/ozet.strings.test.js` (new); the `AZ_SAME_AS_TR` entries in `strings.test.js` (Task 5).
- `perms.js`, `catalogue.js`, `admin.testutil.js`: the key's mirrors (Task 5).
- `backendApi.js` `pendingHandovers()`, its test, and `fakeApi`'s mock (Task 6).
- `screens/ozet/ozet.js` (new, pure) and `ozet.test.js` (new) (Task 7).
- `screens/ozet/useSummaryReads.js`, `OzetScreen.jsx`, `ozet.testutil.jsx`, `OzetScreen.test.jsx` (all new) (Task 8).
- `shell/routes.js`, `shell/routes.test.js`, `rawKeys.test.jsx` (Task 9).

**Docs**
- `docs/homunculus-rehber-TR.md`: §3.24, and the permission count in §3 «İzin» (Task 10).

---

## Task 0: Preflight (each implementer, once)

**Files:** none.

- [ ] **Step 1: Check the worktree**

Run: `cd /c/tmp/g4-ozet && git status --short && git log --oneline -2`
Expected: no changes listed, on branch `feat/g4-yonetici-ozeti`. The head is this plan's commit; its parent is `1cc05c47 docs(spec): G4-02 «Yönetici özeti» …`.

- [ ] **Step 2 (engine lane): Check that pytest imports the worktree's code**

Run: `cd /c/tmp/g4-ozet/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -c "import sys; sys.path.insert(0, 'src'); import homunculus; print(homunculus.__file__)"`
Expected: `C:\tmp\g4-ozet\homunculus-engine\src\homunculus\__init__.py`. Anything under `Desktop\Project` means the tests would exercise the main checkout: stop and report.

- [ ] **Step 3 (dashboard lane): Check the toolchain**

Run: `cd /c/tmp/g4-ozet/dashboard && ls node_modules/.bin/vitest && npx vitest run src/live/shell/routes.test.js`
Expected: the file exists, and `38 passed`.

- [ ] **Step 4: Run graphify once for your lane** (rule above). For example:
  - engine: `graphify query "handovers router OUTGOING_SIGNED reach_clause tasks unit_id identity"`;
  - dashboard: `graphify query "routes lazyScreen boardStore waitingAlarms shadowStore deviceFeed StructureProvider"`.

The graph predates these files, so expect little; read the worktree after.

---

# Engine lane

## Task 1 (engine, first and alone): the key `summary.view`

**Files:**
- Modify: `homunculus-engine/src/homunculus/auth/permissions.py` (end of `PERMISSIONS`, line 72)
- Test: `homunculus-engine/tests/test_permissions.py` (`SPEC_KEYS` lines 16–28; the count test, line 31; end of file, line 201)

- [ ] **Step 1: Write the failing test**

In `homunculus-engine/tests/test_permissions.py`, find:

```python
    "tasks.manage",       # G3-02: write a task, claim, close, skip; skip a vital measurement
}


def test_the_catalogue_is_exactly_the_specified_twenty_six_keys():
    assert len(SPEC_KEYS) == 26
```

Replace with:

```python
    "tasks.manage",       # G3-02: write a task, claim, close, skip; skip a vital measurement
    "summary.view",       # G4-02 Yönetici özeti (spec D2, D3): the page, GET /handovers/pending
}


def test_the_catalogue_is_exactly_the_specified_twenty_seven_keys():
    assert len(SPEC_KEYS) == 27
```

Then find (the end of the file):

```python
    assert LEGACY_ROLE_TO_GROUP["PHARMACIST"] == "pharmacist"
    assert LEGACY_ROLE_TO_GROUP["BIOMEDICAL"] == "biomedical"
```

Replace with:

```python
    assert LEGACY_ROLE_TO_GROUP["PHARMACIST"] == "pharmacist"
    assert LEGACY_ROLE_TO_GROUP["BIOMEDICAL"] == "biomedical"


def test_the_summary_is_the_system_administrators_alone_by_default():
    """G4-02 (spec D2): `summary.view` is in no default group; the system group holds it by rule (it holds
    the whole catalogue at token issuance), so no migration seeds it. A hospital can give it to another
    group later on the Roles screen."""
    holders = {g["slug"] for g in DEFAULT_GROUPS if "summary.view" in g["permissions"]}
    assert holders == {"hospital_admin"}
    admin = next(g for g in DEFAULT_GROUPS if g["slug"] == "hospital_admin")
    assert admin["permissions"] == tuple(PERMISSIONS)
    assert PERMISSIONS["summary.view"].startswith("Open the Yönetici özeti page")
```

(`SPEC_GROUPS["hospital_admin"]` is built from `SPEC_KEYS`, so the spec-table test follows on its own.)

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/tmp/g4-ozet/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_permissions.py -q -p no:cacheprovider`
Expected: `4 failed, 14 passed`:
- `test_the_catalogue_is_exactly_the_specified_twenty_seven_keys`;
- `test_hospital_admin_holds_every_permission`;
- `test_every_default_group_matches_the_spec_table_exactly`;
- `test_the_summary_is_the_system_administrators_alone_by_default`.

- [ ] **Step 3: Add the key**

In `homunculus-engine/src/homunculus/auth/permissions.py`, find:

```python
    "tasks.manage": "Write, claim, close or skip a task; skip one vital measurement with a reason",
}
```

Replace with:

```python
    "tasks.manage": "Write, claim, close or skip a task; skip one vital measurement with a reason",

    # G4-02 — Yönetici özeti (spec D2, D3): the hospital at a glance. In no default group: the system
    # group holds it by rule, so no migration; a hospital may give it to another group on the Roles screen.
    "summary.view": "Open the Yönetici özeti page and read each unit's handovers waiting for a "
                    "countersignature (GET /handovers/pending), as counts and times only",
}
```

(The dashboard's `admin.testutil.test.js` folds the two adjacent strings into one: keep each on a line that begins with spaces and a `"`, and end the entry with `",`.)

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd /c/tmp/g4-ozet/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_permissions.py tests/test_merge_permissions.py tests/test_groups_service.py -q -p no:cacheprovider`
Expected: `33 passed, 27 skipped` (the skips are DB-backed).

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g4-ozet && git add homunculus-engine/src/homunculus/auth/permissions.py homunculus-engine/tests/test_permissions.py && git commit -m "feat(auth): G4-02 summary.view — the Yönetici özeti's key, in no default group (the system group holds it by rule, so no migration)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/src/homunculus/auth/permissions.py homunculus-engine/tests/test_permissions.py
```

Then tell the dashboard implementer that Task 1 is committed: the lanes may start.

---

## Task 2 (engine): `GET /tasks` reads the card's unit and bed key from `identity`

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/tasks.py` (the `list_tasks` answer, line 471)
- Test: `homunculus-engine/tests/test_tasks_api.py` (imports, line 10; end of file, line 365)

- [ ] **Step 1: Write the failing test**

In `homunculus-engine/tests/test_tasks_api.py`, find:

```python
from homunculus.api.tasks import DEFAULT_SETTINGS, TASK_NOT_OPEN, VITAL_SKIPPED, InMemoryTaskStore
```

Replace with:

```python
from homunculus.api.tasks import DEFAULT_SETTINGS, TASK_NOT_OPEN, VITAL_SKIPPED, InMemoryTaskStore
from homunculus.api.patient_identity import IdentityRecord, InMemoryIdentityStore
from homunculus.tenant.bedmap import BedMap
```

Then find (the end of the file):

```python
    with TestClient(app):
        assert closed == []
    assert closed == [True]
```

Replace with:

```python
    with TestClient(app):
        assert closed == []
    assert closed == [True]


def test_each_patient_carries_the_unit_and_bed_key_its_card_sits_on():
    """G4-02 (spec D4): the card keeps its unit and its bed key under `identity` (api/board.py
    `_bed_resolution`); `/tasks` reads them from there — a top-level field the card does not carry was
    always null. A card with no identity has neither. Synthetic patients and a synthetic bed map."""
    identities = InMemoryIdentityStore()
    identities.apply("h1", IdentityRecord(patient_id="S-010", given="Sentetik", family="Hasta",
                                          unit="YB", room="304", bed="1", source="comed", updated_at=NOW))
    bedmap = BedMap.from_dict({"beds": {"YB^304^1": {"bed_id": "bed-a1", "unit_id": "unit-adult"}}})
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve, identities=identities,
                     bedmap=bedmap, tasks=InMemoryTaskStore(zones={"h1": "UTC"}))
    with TestClient(app) as c:
        _ingest(c, "S-010", "heart_rate", 80, datetime.now(timezone.utc) - timedelta(minutes=3))
        _ingest(c, "S-011", "heart_rate", 80, datetime.now(timezone.utc) - timedelta(minutes=3))
        board = {p["patient_id"]: p for p in c.get("/patients", headers=DEVICE).json()["patients"]}
        r = _tasks(c, DEVICE)
    assert r.status_code == 200, r.text
    cards = {p["patient_id"]: p for p in r.json()["patients"]}
    assert board["S-010"]["identity"]["unit_id"] == "unit-adult"            # the board resolved it
    assert cards["S-010"]["unit_id"] == "unit-adult"
    assert cards["S-010"]["bed_key"] == board["S-010"]["identity"]["bed_key"]
    assert cards["S-010"]["bed_key"] is not None
    assert board["S-011"]["identity"] is None                                 # a device-only card
    assert cards["S-011"]["unit_id"] is None and cards["S-011"]["bed_key"] is None
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/tmp/g4-ozet/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_tasks_api.py -q -p no:cacheprovider -k unit_and_bed_key`
Expected: FAIL at `assert cards["S-010"]["unit_id"] == "unit-adult"`, with `AssertionError: assert None == 'unit-adult'`.

- [ ] **Step 3: Read them from `identity`**

In `homunculus-engine/src/homunculus/api/tasks.py`, find:

```python
                "patients": [{"patient_id": c["patient_id"], "bed_key": c.get("bed_key"), "unit_id": c.get("unit_id"),
                              "vital": _vital(hospital, c, settings, now, since, until,
```

Replace with:

```python
                # G4-02 (spec D4): the card keeps its bed key and unit under `identity` (api/board.py
                # `_bed_resolution`), null on a card with no identity; an empty text is no unit either.
                "patients": [{"patient_id": c["patient_id"],
                              "bed_key": (c.get("identity") or {}).get("bed_key") or None,
                              "unit_id": (c.get("identity") or {}).get("unit_id") or None,
                              "vital": _vital(hospital, c, settings, now, since, until,
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd /c/tmp/g4-ozet/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_tasks_api.py tests/test_tasks_schedule.py tests/test_tasks_store.py -q -p no:cacheprovider`
Expected: `53 passed`.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g4-ozet && git add homunculus-engine/src/homunculus/api/tasks.py homunculus-engine/tests/test_tasks_api.py && git commit -m "fix(tasks): G4-02 GET /tasks reads each patient's unit_id and bed_key from the card's identity, where the board keeps them (they were always null)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/src/homunculus/api/tasks.py homunculus-engine/tests/test_tasks_api.py
```

---

## Task 3 (engine): `GET /handovers/pending`

**Files:**
- Modify: `homunculus-engine/src/homunculus/admission/unitscope.py` (after `reach_clause`, lines 81–89)
- Modify: `homunculus-engine/src/homunculus/admission/schemas.py` (after `Colleague`, line 528)
- Modify: `homunculus-engine/src/homunculus/admission/router.py` (schema imports, line 68; `HANDOVER_SIGN`, line 1155; after `handover_colleagues`, line 1376)
- Test: `homunculus-engine/tests/test_unit_scope.py` (no DB; import, line 17; after the SQL test, line 52)
- Test: `homunculus-engine/tests/test_handover_api.py` (DB-backed; import, line 26; end of file, line 649)

- [ ] **Step 1: Write the failing no-DB test for `unit_clause`**

In `homunculus-engine/tests/test_unit_scope.py`, find:

```python
from homunculus.admission.unitscope import caller_scope, reach_clause, reaches, require_reach
```

Replace with:

```python
from homunculus.admission.unitscope import caller_scope, reach_clause, reaches, require_reach, unit_clause
```

Then find:

```python
        "units.id IN (NULL) AND (1 != 1) OR beds.id IN (NULL) AND (1 != 1)"     # never true


def test_an_unrestricted_scope_reaches_every_bed():
```

Replace with:

```python
        "units.id IN (NULL) AND (1 != 1) OR beds.id IN (NULL) AND (1 != 1)"     # never true


def test_the_sql_unit_reach_names_the_granted_units_and_no_bed():
    """G4-02 (spec D4): a row that belongs to a unit and no bed — a handover — is reached by a unit grant
    only. No filter for an unrestricted scope; a bed grant alone, or an old free-text key, reaches none."""
    assert unit_clause(build_scope("HOSPITAL_ADMIN"), unit_id=Unit.id) is None
    scope = build_scope("MEMBER", unit_ids=[str(UNIT_A).upper(), "Reanimasiya"],
                        bed_ids=[str(BED_B1)], enforce_unassigned=True)
    text = _sql(unit_clause(scope, unit_id=Unit.id))
    assert UNIT_A.hex in text.replace("-", "")
    assert BED_B1.hex not in text.replace("-", "") and "Reanimasiya" not in text
    beds_only = build_scope("MEMBER", bed_ids=[str(BED_B1)], enforce_unassigned=True)
    assert _sql(unit_clause(beds_only, unit_id=Unit.id)) == "units.id IN (NULL) AND (1 != 1)"   # never true


def test_an_unrestricted_scope_reaches_every_bed():
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/tmp/g4-ozet/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_unit_scope.py -q -p no:cacheprovider`
Expected: `1 error`, an `ImportError` during collection: `cannot import name 'unit_clause'`.

- [ ] **Step 3: Write `unit_clause`**

In `homunculus-engine/src/homunculus/admission/unitscope.py`, find:

```python
    return or_(unit_id.in_(_grant_uuids(scope.unit_ids)), bed_id.in_(_grant_uuids(scope.bed_ids)))
```

Replace with:

```python
    return or_(unit_id.in_(_grant_uuids(scope.unit_ids)), bed_id.in_(_grant_uuids(scope.bed_ids)))


def unit_clause(scope: Scope, *, unit_id: ColumnElement) -> ColumnElement | None:
    """`reach_clause` for a row that belongs to a unit and to no bed — a handover (G4-02, spec D4): None
    when the scope is unrestricted (no filter), else "the unit granted". A bed grant reaches no such row:
    it names one bed, not the unit around it. The column must be the row's own unit, proven this
    tenant's by the query (see the module's docstring)."""
    if scope.unrestricted:
        return None
    return unit_id.in_(_grant_uuids(scope.unit_ids))
```

- [ ] **Step 4: Run it to see it pass**

Run: `cd /c/tmp/g4-ozet/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_unit_scope.py -q -p no:cacheprovider`
Expected: `10 passed, 10 skipped`.

- [ ] **Step 5: Write the failing DB-backed tests for the route**

In `homunculus-engine/tests/test_handover_api.py`, find:

```python
from homunculus.auth.models import Group, TenantMembership, User
```

Replace with:

```python
from homunculus.auth.models import Group, GroupPermission, TenantMembership, User
from homunculus.scope.models import StaffScope
```

Then find (the end of the file):

```python
    r = await client.post(url, headers=w.auth["charge"])
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "COMPLETED"
```

Replace with:

```python
    r = await client.post(url, headers=w.auth["charge"])
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "COMPLETED"


# ---------------------------------------------------------------- G4-02: waiting for the countersignature
async def waiting(db_session, w, unit: str, *, signed_at: datetime | None = None,
                  status: HandoverStatus = HandoverStatus.OUTGOING_SIGNED) -> Handover:
    """A handover of `unit` as the outgoing signature leaves it (`status` for the other states), written
    straight into the database: counting one needs no patient and no live board (G4-02)."""
    handover = await adm_service.open_handover(db_session, unit_id=w.units[unit].id,
                                               outgoing_user_id=w.users["nurse"].id,
                                               incoming_user_id=w.users["charge"].id, admission_ids=[])
    handover.status = status
    handover.outgoing_signed_at = signed_at
    await db_session.commit()
    return handover


async def pending(client, headers: dict[str, str]) -> dict:
    r = await client.get("/handovers/pending", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


async def summary_reader(db_session, w, *, unit: str | None = None,
                         bed: str | None = None) -> dict[str, str]:
    """A member of a group the hospital made, holding `summary.view` alone (spec D2: the key can be given
    on the Roles screen later), granted one unit or one bed. Her Authorization header."""
    tag = uuid.uuid4().hex[:8]
    group = Group(tenant_id=w.tenant.id, slug=f"ozet-{tag}", name=f"Sentetik özet {tag}",
                  permissions=[GroupPermission(permission="summary.view")])
    db_session.add(group)
    await db_session.flush()
    user = await add_user(db_session, username=f"ozet-{tag}@kabul.example.com",
                          tenant_id=w.tenant.id, group=group)
    db_session.add(StaffScope(tenant_id=w.tenant.id, user_id=user.id,
                              unit_id=str(w.units[unit].id) if unit else "",
                              bed_id=str(w.beds[bed].id) if bed else ""))
    await db_session.commit()
    return await bearer(db_session, user)


async def test_the_waiting_handovers_need_summary_view(ward):
    """Spec D2: the summary is the system administrator's. A nurse signs handovers and reads none of it."""
    w, client, _ = ward
    for who in ("nurse", "charge", "doctor", "auditor"):
        r = await client.get("/handovers/pending", headers=w.auth[who])
        assert r.status_code == 403, (who, r.text)
    body = await pending(client, w.auth["admin"])
    assert body["units"] == []                      # a unit with none is left out
    assert body["generated_at"]


async def test_each_unit_counts_its_waiting_handovers_and_names_the_oldest(ward, db_session):
    """Per unit, by name: how many wait, and when the oldest was signed — days ago if need be, since
    OUTGOING_SIGNED never expires (service.py)."""
    w, client, _ = ward
    now = datetime.now(timezone.utc)
    oldest = now - timedelta(days=3)
    await waiting(db_session, w, "rea", signed_at=now - timedelta(hours=2))
    await waiting(db_session, w, "rea", signed_at=oldest)
    await waiting(db_session, w, "neo", signed_at=now - timedelta(minutes=5))

    body = await pending(client, w.auth["admin"])
    assert [(u["unit_name"], u["pending"]) for u in body["units"]] == [("Neonatal", 1), ("Reanimasiya", 2)]
    rea = body["units"][1]
    assert rea["unit_id"] == str(w.units["rea"].id)
    assert datetime.fromisoformat(rea["oldest_outgoing_signed_at"]) == oldest
    assert abs(datetime.fromisoformat(body["generated_at"]) - now) < timedelta(minutes=1)


async def test_only_a_handover_waiting_for_its_countersignature_counts(ward, db_session):
    """OPEN (not signed yet, or past its bridge), COMPLETED and EXPIRED wait for nobody."""
    w, client, _ = ward
    now = datetime.now(timezone.utc)
    await waiting(db_session, w, "rea", status=HandoverStatus.OPEN)
    await waiting(db_session, w, "rea", signed_at=now, status=HandoverStatus.COMPLETED)
    await waiting(db_session, w, "rea", status=HandoverStatus.EXPIRED)
    assert (await pending(client, w.auth["admin"]))["units"] == []

    await waiting(db_session, w, "rea", signed_at=now)
    assert [u["pending"] for u in (await pending(client, w.auth["admin"]))["units"]] == [1]


async def test_the_answer_names_no_patient_note_or_person(ward):
    """Spec D4: counts and times only. A handover made the ward's way — a patient, the D-Ö-D-Ö note, two
    people — is counted, and nothing of it is told."""
    w, client, _ = ward
    admission = await signed(w, client)
    handover = await handed(w, client, admission)

    r = await client.get("/handovers/pending", headers=w.auth["admin"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"units", "generated_at"}
    (unit,) = body["units"]
    assert set(unit) == {"unit_id", "unit_name", "pending", "oldest_outgoing_signed_at"}
    assert unit["pending"] == 1
    for told in (NAME, *NOTE.values(), admission["id"], admission["board_key"], handover["id"],
                 str(w.users["nurse"].id), str(w.users["charge"].id), "nurse@kabul", "charge@kabul"):
        assert told not in r.text, told


async def test_a_reader_given_the_key_sees_her_own_units_only(ward, db_session):
    """Spec D4: the scope is the caller's units. A group given the key later (D2), granted one unit, sees
    that unit's; granted a bed alone, none — a handover belongs to a unit, not to a bed."""
    w, client, _ = ward
    now = datetime.now(timezone.utc)
    await waiting(db_session, w, "rea", signed_at=now)
    await waiting(db_session, w, "neo", signed_at=now)
    neo_reader = await summary_reader(db_session, w, unit="neo")
    bed_reader = await summary_reader(db_session, w, bed="1")

    assert [u["unit_name"] for u in (await pending(client, neo_reader))["units"]] == ["Neonatal"]
    assert (await pending(client, bed_reader))["units"] == []
    assert [u["unit_name"] for u in (await pending(client, w.auth["admin"]))["units"]] == \
        ["Neonatal", "Reanimasiya"]


async def test_another_hospitals_waiting_handovers_are_not_counted(ward, db_session):
    """Tenant isolation: each administrator counts her own hospital's units only."""
    w, client, _ = ward
    other = Tenant(name="Sentetik Omega Hastanesi", slug="omega-hastane", country_code="AZ")
    db_session.add(other)
    await db_session.flush()
    groups = await ensure_default_groups(db_session, other.id)
    site = Site(tenant_id=other.id, name="Omega bina")
    db_session.add(site)
    await db_session.flush()
    unit = Unit(site_id=site.id, name="Omega YBÜ", unit_type=UnitType.ADULT_ICU)
    db_session.add(unit)
    await db_session.commit()
    sender = await add_user(db_session, username="gonderen@omega.example.com", tenant_id=other.id,
                            group=groups["nurse"])
    receiver = await add_user(db_session, username="alan@omega.example.com", tenant_id=other.id,
                              group=groups["nurse"])
    their_admin = await add_user(db_session, username="yonetici@omega.example.com", tenant_id=other.id,
                                 group=groups["hospital_admin"])
    theirs = await adm_service.open_handover(db_session, unit_id=unit.id, outgoing_user_id=sender.id,
                                             incoming_user_id=receiver.id, admission_ids=[])
    theirs.status, theirs.outgoing_signed_at = HandoverStatus.OUTGOING_SIGNED, datetime.now(timezone.utc)
    await db_session.commit()
    await waiting(db_session, w, "rea", signed_at=datetime.now(timezone.utc))

    assert [u["unit_name"] for u in (await pending(client, w.auth["admin"]))["units"]] == ["Reanimasiya"]
    assert [u["unit_name"] for u in (await pending(client, await bearer(db_session, their_admin)))["units"]] \
        == ["Omega YBÜ"]
```

- [ ] **Step 6: Run them on the throwaway Postgres to see them fail**

Start it (see «The throwaway Postgres»), one call each:

```bash
docker run -d --rm --name ozet-pg -p 127.0.0.1:56446:5432 -e POSTGRES_PASSWORD=ozet -e POSTGRES_DB=ozet postgres:16
timeout 60 bash -c 'until docker exec ozet-pg pg_isready -U postgres -q; do :; done' && docker exec ozet-pg createdb -U postgres ozet_test
```

Run: `cd /c/tmp/g4-ozet/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:ozet@127.0.0.1:56446/ozet_test "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_handover_api.py -q -p no:cacheprovider`
Expected: `6 failed, 34 passed`. The six new tests fail: there is no `GET /handovers/pending` route yet, so the answers are not the 403 or 200 they expect. Keep the container running for Step 9.

- [ ] **Step 7: Write the answer's schemas**

In `homunculus-engine/src/homunculus/admission/schemas.py`, find:

```python
class Colleague(BaseModel):
    """G2-B3b (D7): someone the caller can hand over to."""
    id: uuid.UUID
    name: str
```

Replace with:

```python
class Colleague(BaseModel):
    """G2-B3b (D7): someone the caller can hand over to."""
    id: uuid.UUID
    name: str


class PendingUnit(BaseModel):
    """G4-02 (spec D4): one unit's handovers signed by the outgoing person and waiting for the
    countersignature — how many, and when the oldest was signed. Nothing else: no patient, no note,
    no person."""
    unit_id: uuid.UUID
    unit_name: str
    pending: int
    oldest_outgoing_signed_at: datetime | None


class PendingHandovers(BaseModel):
    """G4-02 (spec D4): `GET /handovers/pending` — the units with at least one, and the server's time."""
    units: list[PendingUnit]
    generated_at: datetime
```

- [ ] **Step 8: Write the route**

In `homunculus-engine/src/homunculus/admission/router.py`, find:

```python
    HandoverPatient, HandoverPerson, HandoverResponse, HandoverRow, HandoverSign, LabelAsk,
```

Replace with:

```python
    HandoverPatient, HandoverPerson, HandoverResponse, HandoverRow, HandoverSign, LabelAsk,
    PendingHandovers, PendingUnit,
```

Then find:

```python
HANDOVER_SIGN = "handover.sign"
```

Replace with:

```python
HANDOVER_SIGN = "handover.sign"
#: G4-02 (spec D3, D4): the Yönetici özeti's key — the page, and the units' handovers waiting for a countersignature.
SUMMARY_VIEW = "summary.view"
```

Then find (the end of `handover_colleagues`):

```python
    return sorted(people, key=lambda person: (person.name.casefold(), str(person.id)))
```

Replace with:

```python
    return sorted(people, key=lambda person: (person.name.casefold(), str(person.id)))


@handover_router.get("/pending", response_model=PendingHandovers)
async def pending_handovers(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission(SUMMARY_VIEW)),
    caller_tenant: uuid.UUID = _tenant,
):
    """G4-02 (spec D4): per unit, the handovers the outgoing person signed that wait for the
    countersignature (OUTGOING_SIGNED) — how many, and when the oldest was signed; then the server's
    time. Units with none are left out; the rest by name. In the caller's tenant (the unit's site) and
    the caller's units (`unitscope.unit_clause`: a handover belongs to a unit, so a bed grant alone
    reaches none) — today only an unrestricted administrator holds the key, the rule is written for the
    group a hospital may give it to later. Counts and times only: no patient, no note, no person.
    OUTGOING_SIGNED never expires (service.py), so the oldest can be days old."""
    reach = await unitscope.caller_scope(db, user.id, caller_tenant)
    stmt = (select(Unit.id, Unit.name, func.count(Handover.id), func.min(Handover.outgoing_signed_at))
            .select_from(Handover)
            .join(Unit, Unit.id == Handover.unit_id)
            .join(Site, Site.id == Unit.site_id)
            .where(Site.tenant_id == caller_tenant, Handover.status == HandoverStatus.OUTGOING_SIGNED)
            .group_by(Unit.id, Unit.name)
            .order_by(Unit.name, Unit.id))
    within = unitscope.unit_clause(reach, unit_id=Unit.id)
    if within is not None:
        stmt = stmt.where(within)
    rows = (await db.execute(stmt)).all()
    return PendingHandovers(
        units=[PendingUnit(unit_id=unit_id, unit_name=name, pending=count, oldest_outgoing_signed_at=oldest)
               for unit_id, name, count, oldest in rows],
        generated_at=_now())
```

(`select`, `func`, `Unit`, `Site`, `Handover`, `HandoverStatus`, `unitscope`, `User`, `require_permission`, `get_db`, `_tenant` and `_now` are already imported or defined in this module. No `GET /handovers/{id}` route exists, so `/pending` collides with nothing.)

- [ ] **Step 9: Run the tests to see them pass, then stop the database**

Run: `cd /c/tmp/g4-ozet/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:ozet@127.0.0.1:56446/ozet_test "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_handover_api.py tests/test_unit_scope.py -q -p no:cacheprovider`
Expected: `60 passed` (40 + 20), no skip.

Then: `docker stop ozet-pg`

Two no-DB guard tests are **red now by design**, and Task 4 makes them green: `tests/test_route_permissions.py::test_no_guarded_route_is_missing_from_the_table` and `tests/test_access_log_redaction.py::test_routes_without_a_parameter_are_logged_as_they_are`.

- [ ] **Step 10: Commit**

```bash
cd /c/tmp/g4-ozet && git add homunculus-engine/src/homunculus/admission/unitscope.py homunculus-engine/src/homunculus/admission/schemas.py homunculus-engine/src/homunculus/admission/router.py homunculus-engine/tests/test_unit_scope.py homunculus-engine/tests/test_handover_api.py && git commit -m "feat(handovers): G4-02 GET /handovers/pending — per unit, the handovers waiting for a countersignature, counts and times only (summary.view; the caller's units through the new unitscope.unit_clause)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/src/homunculus/admission/unitscope.py homunculus-engine/src/homunculus/admission/schemas.py homunculus-engine/src/homunculus/admission/router.py homunculus-engine/tests/test_unit_scope.py homunculus-engine/tests/test_handover_api.py
```

---

## Task 4 (engine): the route tables, the nginx map and the proxied paths

**Files:**
- Modify: `deploy/local/web/nginx.conf` (the `$homunculus_log_uri` map, line 44)
- Test: `homunculus-engine/tests/test_route_permissions.py` (`EXPECTED`, line 112; the count, line 236)
- Test: `homunculus-engine/tests/test_nginx_routes.py` (`API_PATHS`, line 26)

Already covered with no edit, checked in Step 1:
- `tests/test_tenant_isolation.py`: the route resolves `caller_tenant_id`, so it stays out of `UNSCOPED_BY_DESIGN`, by that test's rule;
- `tests/test_board_permissions.py`: `BOARD_EXPECTED` covers `homunculus.api.app` routes only;
- `tests/test_route_inventory.py`: `require_permission` reaches `get_principal`;
- nginx's API `location` regex: it already proxies `/handovers`.

- [ ] **Step 1: Run the guard tests to see what Task 3 left red**

Run: `cd /c/tmp/g4-ozet/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_route_permissions.py tests/test_tenant_isolation.py tests/test_board_permissions.py tests/test_nginx_routes.py tests/test_access_log_redaction.py tests/test_route_inventory.py -q -p no:cacheprovider`
Expected: `2 failed, 147 passed, 134 skipped`:
- `test_no_guarded_route_is_missing_from_the_table`, which lists `('GET', '/handovers/pending')`;
- `test_routes_without_a_parameter_are_logged_as_they_are`, which reports `/handovers/pending -> /handovers/:redacted`.

- [ ] **Step 2: Write the route's line in the guard table**

In `homunculus-engine/tests/test_route_permissions.py`, find:

```python
    ("GET", "/handovers/colleagues"): ANY("handover.sign"),    # G2-B3b (D7): who I hand over to
```

Replace with:

```python
    ("GET", "/handovers/colleagues"): ANY("handover.sign"),    # G2-B3b (D7): who I hand over to
    ("GET", "/handovers/pending"): ANY("summary.view"),        # G4-02 (D4): waiting for a countersignature
```

Then find:

```python
    assert len(EXPECTED) == 72      # G2-B3a: +4, the bed moves; +1, GET /tenant/occupancy; G2-B3b: + GET /handovers, GET /handovers/colleagues
```

Replace with:

```python
    assert len(EXPECTED) == 73      # G2-B3a: +4, the bed moves; +1, GET /tenant/occupancy; G2-B3b: + GET /handovers, GET /handovers/colleagues; G4-02: + GET /handovers/pending
```

- [ ] **Step 3: Log the new path as it is**

`/handovers/pending` has no parameter. Without its own line, the catch-all at the end of the map (`~^/(?<pre>…|handovers|…)/.`) would log it as `/handovers/:redacted`, as `/handovers/colleagues` once was.

In `deploy/local/web/nginx.conf`, find:

```nginx
    ~^/handovers/colleagues$                                 $uri;   # G2-B3b
```

Replace with:

```nginx
    ~^/handovers/colleagues$                                 $uri;   # G2-B3b
    ~^/handovers/pending$                                    $uri;   # G4-02: the units' counts (no id)
```

- [ ] **Step 4: Name it among the proxied paths**

In `homunculus-engine/tests/test_nginx_routes.py`, find:

```python
    "/handovers", "/alerts/x", "/break-glass", "/scope/me", "/clinical/p1",
```

Replace with:

```python
    "/handovers", "/handovers/pending", "/alerts/x", "/break-glass", "/scope/me", "/clinical/p1",
```

- [ ] **Step 5: Run the guard tests to see them pass**

Run: `cd /c/tmp/g4-ozet/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_route_permissions.py tests/test_tenant_isolation.py tests/test_board_permissions.py tests/test_nginx_routes.py tests/test_access_log_redaction.py tests/test_route_inventory.py -q -p no:cacheprovider`
Expected: `150 passed, 134 skipped`.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/g4-ozet && git add homunculus-engine/tests/test_route_permissions.py homunculus-engine/tests/test_nginx_routes.py deploy/local/web/nginx.conf && git commit -m "test(routes): G4-02 GET /handovers/pending in the guard table (73), logged as itself in nginx's access-log map, among the proxied paths" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/tests/test_route_permissions.py homunculus-engine/tests/test_nginx_routes.py deploy/local/web/nginx.conf
```

The engine lane is done: report the four shas to the coordinator.

---

# Dashboard lane (starts once Task 1 is committed)

## Task 5 (dashboard): the `ozet` strings and the `summary.view` mirrors

**Files:**
- Create: `dashboard/src/live/i18n/ozet.strings.test.js`
- Create: `dashboard/src/live/i18n/strings/ozet.js`
- Modify: `dashboard/src/live/i18n/catalog.js` (import, line 85; `NAMESPACES`, line 137)
- Modify: `dashboard/src/live/i18n/strings.test.js` (`AZ_SAME_AS_TR`, line 219)
- Modify: `dashboard/src/live/i18n/strings/perms.js` (lines 55, 94, 133, 172)
- Modify: `dashboard/src/live/screens/admin/catalogue.js` (line 42)
- Modify: `dashboard/src/live/screens/admin/admin.testutil.js` (line 119)

- [ ] **Step 1: Write the failing test**

Create `dashboard/src/live/i18n/ozet.strings.test.js` with:

```js
// G4-02 «Yönetici özeti» (spec 2026-11-11 D5): the summary page's words (strings/ozet.js) — the spec's own Turkish,
// none of the prototype's numbers that have no source, a reason for every «—», and no suffix glued to a number.
import { describe, it, expect } from "vitest";
import { DICTIONARIES } from "./catalog.js";
import { LANG_CODES } from "./langs.js";

const fill = (template, vars) => template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name]));
const ozet = (lang) => Object.entries(DICTIONARIES[lang]).filter(([key]) => key.startsWith("ozet."));
const WHY = ["loading", "failed", "stale", "noRight", "chain", "unknown", "stripOff"];

describe("the summary page's words (ozet)", () => {
  it("says the spec's Turkish", () => {
    const tr = DICTIONARIES.tr;
    expect([tr["ozet.nav"], tr["ozet.title"], tr["ozet.cards.title"], tr["ozet.q.title"], tr["ozet.units.title"]])
      .toEqual(["Yönetici özeti", "Yönetici özeti", "Unutulan işler", "Alarm kalitesi", "Birimler"]);
    expect(fill(tr["ozet.asOf"], { time: "10:42" })).toBe("10:42 itibarıyla");
    expect(tr["ozet.refresh"]).toBe("Yenile");
    expect(fill(tr["ozet.cards.unansweredTitle"], { period: tr["ozet.period.text7"] })).toBe("Yanıtsız kalan alarm · son 7 gün");
    expect(tr["ozet.cards.pendingTitle"]).toBe("Karşı imzası bekleyen devir");
    expect(fill(tr["ozet.cards.pendingOldest"], { age: fill(tr["ozet.age.day"], { n: 2 }) })).toBe("en eskisi 2 gün önce");
    expect(tr["ozet.cards.lateTitle"]).toBe("Geciken iş");
    expect(tr["ozet.cards.silentTitle"]).toBe("Sessiz monitör");
    expect(fill(tr["ozet.cards.silentLongest"], { for: fill(tr["ozet.for.minutes"], { n: 12 }) })).toBe("en uzunu 12 dk");
    expect([tr["ozet.period.d1"], tr["ozet.period.d7"], tr["ozet.period.d30"]]).toEqual(["Bugün", "7 gün", "30 gün"]);
    expect(tr["ozet.q.daily"]).toBe("Günlük alarm sayısı");
    expect(tr["ozet.q.unsettled"]).toBe("henüz yerleşen yok");
    expect(tr["ozet.units.unplaced"]).toBe("Birimi belli olmayan");
    expect(WHY.map((w) => tr[`ozet.why.${w}`])).toEqual([
      "okunuyor…", "okunamadı", "pano güncel değil", "yetki yok", "veri zinciri kesik", "bilinmiyor", "monitör şeridi kapalı",
    ]);
  });

  it("says why a number is missing with a word of its own, in every language", () => {
    for (const lang of LANG_CODES) {
      const words = WHY.map((w) => DICTIONARIES[lang][`ozet.why.${w}`]);
      expect(new Set(words).size, lang).toBe(WHY.length);
      for (const word of words) expect(word, lang).not.toMatch(/^\s*0\s*$/);
    }
  });

  it("leaves out the prototype's numbers that have no source", () => {
    for (const lang of LANG_CODES) {
      for (const [key, value] of ozet(lang)) {
        expect(value, `${lang} ${key}`).not.toMatch(/3 (dk|dəq|мин|min)\b|Hatalı|Səhv|Ошибочн|Marked as false|1 saatten|1 saatdan|более часа|over an hour|geçen hafta|keçən həftə|прошлой неделе|last week/i);
      }
    }
  });

  it("glues no suffix to a number, a time or a date in Turkish or Azerbaijani", () => {
    for (const lang of ["tr", "az"]) {
      for (const [key, value] of ozet(lang)) {
        expect(value, `${lang} ${key}`).not.toMatch(/\{(time|n|m|s|age|for|from|date|pct|critical|high|period|why)\}[^\s·;,.:)%]/);
      }
    }
  });

  it("names the period in the card that depends on it and in the quality box", () => {
    for (const lang of LANG_CODES) {
      for (const key of ["ozet.cards.unansweredTitle", "ozet.q.intro"]) expect(DICTIONARIES[lang][key], `${lang} ${key}`).toContain("{period}");
    }
  });
});
```

- [ ] **Step 2: Run it and the catalogue's mirror tests to see them fail**

Run: `cd /c/tmp/g4-ozet/dashboard && npx vitest run src/live/i18n/ozet.strings.test.js src/live/screens/admin/catalogue.test.js src/live/screens/admin/admin.testutil.test.js`
Expected: FAIL.
- `ozet.strings.test.js` fails with `expected [ undefined, … ] to deeply equal [ 'Yönetici özeti', … ]`.
- `catalogue.test.js` fails "has the backend's keys": the backend has `summary.view` since Task 1, the mirror does not.
- `admin.testutil.test.js` fails "the permission descriptions are the server's".

- [ ] **Step 3: Write the namespace**

Create `dashboard/src/live/i18n/strings/ozet.js` with:

```js
// G4-02 «Yönetici özeti» (screens/ozet/, spec 2026-11-11 D5): the hospital at a glance, from real data only — the
// «Unutulan işler» cards, the hospital-wide alarm quality, the units table. Every number is real or says why it is
// missing (`why.*`, after a «—»); none of the prototype's numbers without a source («3 dk içinde yanıt», «Hatalı olarak
// işaretlenen», «1 saatten uzun sessiz») is here. No patient anywhere.
//
// TR is the source; AZ is the default. AZ, RU and EN are the planner's and await a native reading before the pilot. No
// suffix is glued to a number, a time or a date (ozet.strings.test.js). No text here is clinical advice.
export default {
  tr: {
    nav: "Yönetici özeti", navShort: "Özet",
    title: "Yönetici özeti",
    intro: "Hastane bir bakışta, yalnız gerçek verilerden. Bu sayfa yalnız okur; hasta adı ya da kimliği göstermez. Okunamayan, güncel olmayan ya da yetkiniz olmayan bir kaynağın sayısı «—» ve nedeniyle yazılır, asla 0 yazılmaz.",
    asOf: "{time} itibarıyla",
    noFullRead: "Henüz tam bir okuma yok",
    refresh: "Yenile",
    readAt: "son okuma {time}",
    why: {
      loading: "okunuyor…", failed: "okunamadı", stale: "pano güncel değil", noRight: "yetki yok",
      chain: "veri zinciri kesik", unknown: "bilinmiyor", stripOff: "monitör şeridi kapalı",
    },
    cards: {
      title: "Unutulan işler",
      unansweredTitle: "Yanıtsız kalan alarm · {period}",
      unansweredWhat: "Hiç yanıtlanmamış ve en az 10 dakikalık alarm olayları. 10 dakika, motorun rapor sınırıdır: 5 dakikalık eskalasyonun iki katı.",
      pendingTitle: "Karşı imzası bekleyen devir",
      pendingWhat: "Devredenin imzaladığı, devralanın henüz karşı imzalamadığı devirler. Bu durum kendiliğinden kapanmaz.",
      pendingOldest: "en eskisi {age}",
      lateTitle: "Geciken iş",
      lateWhat: "Şimdi, bu nöbet: sunucunun geç dediği el görevleri ve zamanı geçmiş vital ölçümler.",
      silentTitle: "Sessiz monitör",
      silentWhat: "Şimdi: sessiz ya da haber alınamayan monitörler, Cihazlar sayfasındaki gibi.",
      silentLongest: "en uzunu {for}",
      silentNoMonitors: "Bu görünümde monitör yok",
    },
    age: { min: "{n} dk önce", hour: "{n} saat önce", day: "{n} gün önce" },
    for: { minutes: "{n} dk", underMinute: "<1 dk" },
    period: {
      label: "Dönem", d1: "Bugün", d7: "7 gün", d30: "30 gün",
      text1: "son 24 saat", text7: "son 7 gün", text30: "son 30 gün",
    },
    q: {
      title: "Alarm kalitesi",
      intro: "Denetim kaydından, hastane geneli, {period}. Sayfa açılınca ve dönem değişince okunur; kendiliğinden yenilenmez.",
      loading: "Alarm kalitesi okunuyor…",
      failed: "Alarm kalitesi okunamadı: {reason}",
      noRight: "Alarm kalitesi, denetim kaydını okuma yetkisi (audit.view) ve bütün hastaneyi kapsayan bir kapsam ister.",
      episodes: "Alarm olayı", answered: "Yanıtlanan", rate: "oran %{pct}", unsettled: "henüz yerleşen yok",
      median: "Yanıt süresi (ortanca)", p90: "Yanıt süresi (p90)", escalated: "Eskale edilen",
      unanswered: "Yanıtsız kalan", pending: "Bekleyen (10 dakikası dolmamış)",
      sec: "{n} sn", minSec: "{m} dk {s} sn", noAnswered: "yanıtlanan yok",
      none: "Bu dönemde alarm olayı yok.",
      truncated: "Sunucunun okuma sınırı aşıldı: yalnız en yeni kayıtlar okundu, daha eskiler sayılmadı; sayılar eksik.",
      truncatedFrom: "Sunucunun okuma sınırı aşıldı: yalnız en yeni kayıtlar okundu; sayılan dönem {from} ile başlıyor, daha eskiler sayılmadı.",
      daily: "Günlük alarm sayısı",
      dailyNote: "Her çubuk bir günün alarm olaylarıdır; günler UTC takvimine göredir.",
      dayCount: "{date}: {n} olay",
      byKind: "Türe göre",
      colKind: "Tür", colEpisodes: "Olay", colAnswered: "Yanıtlanan", colEscalated: "Eskale", colMedian: "Ortanca yanıt",
    },
    units: {
      title: "Birimler",
      caption: "Birimler, şimdi",
      colUnit: "Birim", colOccupancy: "Doluluk", colWaiting: "Yanıt bekleyen alarm", colLate: "Geciken iş",
      colPending: "Karşı imzası bekleyen devir", colSilent: "Sessiz monitör",
      waitingSplit: "({critical} kritik · {high} yüksek)",
      unplaced: "Birimi belli olmayan",
      unplacedNote: "«Birimi belli olmayan»: yatağı olmayan ya da yapıda bulunmayan bir birimdeki hasta ve monitörler.",
      missing: "Birim satırları yazılamıyor · {why}",
    },
  },
  az: {
    nav: "Rəhbər xülasəsi", navShort: "Xülasə",
    title: "Rəhbər xülasəsi",
    intro: "Xəstəxana bir baxışda, yalnız real məlumatlardan. Bu səhifə yalnız oxuyur; xəstə adı və ya kimliyi göstərmir. Oxunmayan, yenilənməmiş və ya səlahiyyətiniz olmayan mənbənin sayı «—» və səbəbi ilə yazılır, heç vaxt 0 yazılmır.",
    asOf: "{time} vəziyyətinə görə",
    noFullRead: "Hələ tam oxunuş yoxdur",
    refresh: "Yenilə",
    readAt: "son oxunuş {time}",
    why: {
      loading: "oxunur…", failed: "oxunmadı", stale: "lövhə yenilənməyib", noRight: "səlahiyyət yoxdur",
      chain: "məlumat zənciri qırılıb", unknown: "məlum deyil", stripOff: "monitor zolağı bağlıdır",
    },
    cards: {
      title: "Unudulan işlər",
      unansweredTitle: "Cavabsız qalan siqnal · {period}",
      unansweredWhat: "Heç cavablanmamış və ən azı 10 dəqiqəlik siqnal epizodları. 10 dəqiqə sistemin hesabat həddidir: 5 dəqiqəlik eskalasiyanın iki qatı.",
      pendingTitle: "Əks-imza gözləyən təhvil",
      pendingWhat: "Təhvil verənin imzaladığı, təhvil alanın hələ əks-imza atmadığı təhvillər. Bu vəziyyət öz-özünə bağlanmır.",
      pendingOldest: "ən köhnəsi {age}",
      lateTitle: "Gecikən iş",
      lateWhat: "İndi, bu növbə: serverin gecikmiş saydığı əl tapşırıqları və vaxtı keçmiş vital ölçmələr.",
      silentTitle: "Səssiz monitor",
      silentWhat: "İndi: səssiz və ya xəbər alınmayan monitorlar, Cihazlar səhifəsindəki kimi.",
      silentLongest: "ən uzunu {for}",
      silentNoMonitors: "Bu görünüşdə monitor yoxdur",
    },
    age: { min: "{n} dəq əvvəl", hour: "{n} saat əvvəl", day: "{n} gün əvvəl" },
    for: { minutes: "{n} dəq", underMinute: "<1 dəq" },
    period: {
      label: "Dövr", d1: "Bu gün", d7: "7 gün", d30: "30 gün",
      text1: "son 24 saat", text7: "son 7 gün", text30: "son 30 gün",
    },
    q: {
      title: "Siqnal keyfiyyəti",
      intro: "Audit jurnalından, bütün xəstəxana üzrə, {period}. Səhifə açılanda və dövr dəyişəndə oxunur; özü yenilənmir.",
      loading: "Siqnal keyfiyyəti oxunur…",
      failed: "Siqnal keyfiyyəti oxunmadı: {reason}",
      noRight: "Siqnal keyfiyyəti audit jurnalını oxuma səlahiyyəti (audit.view) və bütün xəstəxananı əhatə edən əhatə dairəsi tələb edir.",
      episodes: "Siqnal epizodu", answered: "Cavablanan", rate: "nisbət {pct}%", unsettled: "hələ yekunlaşan yoxdur",
      median: "Cavab müddəti (median)", p90: "Cavab müddəti (p90)", escalated: "Eskalasiya edilən",
      unanswered: "Cavabsız qalan", pending: "Gözləyən (10 dəqiqəsi dolmayıb)",
      sec: "{n} san", minSec: "{m} dəq {s} san", noAnswered: "cavablanan yoxdur",
      none: "Bu dövrdə siqnal epizodu yoxdur.",
      truncated: "Serverin oxuma həddi aşıldı: yalnız ən yeni qeydlər oxundu, daha köhnələr sayılmadı; rəqəmlər natamamdır.",
      truncatedFrom: "Serverin oxuma həddi aşıldı: yalnız ən yeni qeydlər oxundu; sayılan dövr {from} ilə başlayır, daha köhnələr sayılmadı.",
      daily: "Gündəlik siqnal sayı",
      dailyNote: "Hər zolaq bir günün siqnal epizodlarıdır; günlər UTC təqviminə görədir.",
      dayCount: "{date}: {n} epizod",
      byKind: "Növə görə",
      colKind: "Növ", colEpisodes: "Epizod", colAnswered: "Cavablanan", colEscalated: "Eskalasiya", colMedian: "Median cavab",
    },
    units: {
      title: "Şöbələr",
      caption: "Şöbələr, indi",
      colUnit: "Şöbə", colOccupancy: "Doluluq", colWaiting: "Cavab gözləyən siqnal", colLate: "Gecikən iş",
      colPending: "Əks-imza gözləyən təhvil", colSilent: "Səssiz monitor",
      waitingSplit: "({critical} kritik · {high} yüksək)",
      unplaced: "Şöbəsi bəlli olmayan",
      unplacedNote: "«Şöbəsi bəlli olmayan»: çarpayısı olmayan və ya strukturda olmayan şöbədəki xəstə və monitorlar.",
      missing: "Şöbə sətirləri yazıla bilmir · {why}",
    },
  },
  ru: {
    nav: "Сводка для руководства", navShort: "Сводка",
    title: "Сводка для руководства",
    intro: "Больница одним взглядом, только по реальным данным. Страница только читает и не показывает ни имён, ни идентификаторов пациентов. Число из источника, который не прочитан, не обновлён или вам недоступен, пишется как «—» с причиной и никогда как 0.",
    asOf: "По состоянию на {time}",
    noFullRead: "Полного чтения ещё не было",
    refresh: "Обновить",
    readAt: "прочитано в {time}",
    why: {
      loading: "читается…", failed: "не прочитано", stale: "данные не обновлены", noRight: "нет права",
      chain: "цепочка данных прервана", unknown: "неизвестно", stripOff: "блок монитора выключен",
    },
    cards: {
      title: "Забытые задачи",
      unansweredTitle: "Тревоги без ответа · {period}",
      unansweredWhat: "Эпизоды тревог, на которые так и не ответили, длительностью не менее 10 минут. 10 минут — граница отчёта системы: удвоенная 5-минутная эскалация.",
      pendingTitle: "Передачи без встречной подписи",
      pendingWhat: "Передачи смены, подписанные сдающим и ещё не подписанные принимающим. Такое состояние само не закрывается.",
      pendingOldest: "самая ранняя {age}",
      lateTitle: "Просроченные задачи",
      lateWhat: "Сейчас, эта смена: ручные задачи, которые сервер считает просроченными, и пропущенные сроки измерения витальных.",
      silentTitle: "Молчащие мониторы",
      silentWhat: "Сейчас: молчащие мониторы и мониторы без связи, как на странице «Устройства».",
      silentLongest: "дольше всех {for}",
      silentNoMonitors: "В этом представлении нет мониторов",
    },
    age: { min: "{n} мин назад", hour: "{n} ч назад", day: "{n} дн. назад" },
    for: { minutes: "{n} мин", underMinute: "<1 мин" },
    period: {
      label: "Период", d1: "Сегодня", d7: "7 дней", d30: "30 дней",
      text1: "последние 24 часа", text7: "последние 7 дней", text30: "последние 30 дней",
    },
    q: {
      title: "Качество тревог",
      intro: "По журналу аудита, по всей больнице, {period}. Читается при открытии страницы и при смене периода; само не обновляется.",
      loading: "Качество тревог читается…",
      failed: "Качество тревог не прочитано: {reason}",
      noRight: "Качеству тревог нужно право на чтение журнала аудита (audit.view) и область, охватывающая всю больницу.",
      episodes: "Эпизоды тревог", answered: "С ответом", rate: "доля {pct} %", unsettled: "завершённых ещё нет",
      median: "Время ответа (медиана)", p90: "Время ответа (p90)", escalated: "Эскалировано",
      unanswered: "Без ответа", pending: "Ожидают (10 минут не прошло)",
      sec: "{n} с", minSec: "{m} мин {s} с", noAnswered: "ответов нет",
      none: "За этот период эпизодов тревог нет.",
      truncated: "Превышен предел чтения сервера: прочитаны только самые новые записи, более ранние не учтены; числа неполные.",
      truncatedFrom: "Превышен предел чтения сервера: прочитаны только самые новые записи; учтённый период начинается {from}, более ранние не учтены.",
      daily: "Число тревог за сутки",
      dailyNote: "Каждая полоса — эпизоды тревог одних суток; сутки по календарю UTC.",
      dayCount: "{date}: эпизодов {n}",
      byKind: "По видам",
      colKind: "Вид", colEpisodes: "Эпизоды", colAnswered: "С ответом", colEscalated: "Эскалировано", colMedian: "Медиана ответа",
    },
    units: {
      title: "Отделения",
      caption: "Отделения, сейчас",
      colUnit: "Отделение", colOccupancy: "Занятость", colWaiting: "Тревоги, ждущие ответа", colLate: "Просроченные задачи",
      colPending: "Передачи без встречной подписи", colSilent: "Молчащие мониторы",
      waitingSplit: "(критических {critical} · высоких {high})",
      unplaced: "Отделение не определено",
      unplacedNote: "«Отделение не определено»: пациенты и мониторы без койки или в отделении, которого нет в структуре.",
      missing: "Строки отделений не построить · {why}",
    },
  },
  en: {
    nav: "Management summary", navShort: "Summary",
    title: "Management summary",
    intro: "The hospital at a glance, from real data only. This page only reads, and shows no patient name or id. A number whose source could not be read, is not up to date or is not yours to read is written «—» with its reason, never 0.",
    asOf: "As of {time}",
    noFullRead: "No full read yet",
    refresh: "Refresh",
    readAt: "read at {time}",
    why: {
      loading: "reading…", failed: "could not be read", stale: "board not up to date", noRight: "no right",
      chain: "data chain broken", unknown: "unknown", stripOff: "monitor strip off",
    },
    cards: {
      title: "Forgotten work",
      unansweredTitle: "Alarms left unanswered · {period}",
      unansweredWhat: "Alarm episodes never answered and at least 10 minutes old. 10 minutes is the engine's reporting boundary: twice the 5-minute escalation.",
      pendingTitle: "Handovers waiting for a countersignature",
      pendingWhat: "Handovers the outgoing nurse signed and the receiver has not countersigned yet. This state does not close by itself.",
      pendingOldest: "oldest {age}",
      lateTitle: "Overdue work",
      lateWhat: "Now, this shift: hand tasks the server marks late, and vital measurements past their time.",
      silentTitle: "Silent monitors",
      silentWhat: "Now: silent monitors and monitors not heard from, as on the Devices page.",
      silentLongest: "longest {for}",
      silentNoMonitors: "No monitor in this view",
    },
    age: { min: "{n} min ago", hour: "{n} h ago", day: "{n} d ago" },
    for: { minutes: "{n} min", underMinute: "<1 min" },
    period: {
      label: "Period", d1: "Today", d7: "7 days", d30: "30 days",
      text1: "the last 24 hours", text7: "the last 7 days", text30: "the last 30 days",
    },
    q: {
      title: "Alarm quality",
      intro: "From the audit trail, hospital-wide, {period}. Read when the page opens and when the period changes; it does not refresh by itself.",
      loading: "Reading alarm quality…",
      failed: "Alarm quality could not be read: {reason}",
      noRight: "Alarm quality needs the right to read the audit trail (audit.view) and a scope covering the whole hospital.",
      episodes: "Alarm episodes", answered: "Answered", rate: "rate {pct}%", unsettled: "none settled yet",
      median: "Response time (median)", p90: "Response time (p90)", escalated: "Escalated",
      unanswered: "Unanswered", pending: "Pending (under 10 minutes)",
      sec: "{n} s", minSec: "{m} min {s} s", noAnswered: "none answered",
      none: "No alarm episode in this period.",
      truncated: "The server's read limit was reached: only the newest records were read and older ones were not counted, so the numbers are incomplete.",
      truncatedFrom: "The server's read limit was reached: only the newest records were read; the period counted starts at {from}, older ones were not counted.",
      daily: "Daily alarm count",
      dailyNote: "Each bar is one day's alarm episodes; the days follow the UTC calendar.",
      dayCount: "{date}: episodes {n}",
      byKind: "By kind",
      colKind: "Kind", colEpisodes: "Episodes", colAnswered: "Answered", colEscalated: "Escalated", colMedian: "Median response",
    },
    units: {
      title: "Units",
      caption: "Units, now",
      colUnit: "Unit", colOccupancy: "Occupancy", colWaiting: "Alarms waiting for an answer", colLate: "Overdue work",
      colPending: "Handovers waiting for a countersignature", colSilent: "Silent monitors",
      waitingSplit: "(critical: {critical} · high: {high})",
      unplaced: "Unit not known",
      unplacedNote: "«Unit not known»: patients and monitors on no bed, or in a unit the structure does not hold.",
      missing: "Unit rows cannot be drawn · {why}",
    },
  },
};
```

- [ ] **Step 4: Register the namespace**

In `dashboard/src/live/i18n/catalog.js`, find:

```js
import cihaz from "./strings/cihaz.js";
```

Replace with:

```js
import cihaz from "./strings/cihaz.js";

// G4-02: «Yönetici özeti» — the hospital at a glance (screens/ozet).
import ozet from "./strings/ozet.js";
```

Then find:

```js
  cihaz, // G4-01
```

Replace with:

```js
  cihaz, // G4-01

  ozet, // G4-02
```

- [ ] **Step 5: List the reviewed az = tr texts**

In `dashboard/src/live/i18n/strings.test.js`, find:

```js
  "cihaz.wordOk", //         normal — the same word in Azerbaijani (a link's state word on the device page)
```

Replace with:

```js
  "cihaz.wordOk", //         normal — the same word in Azerbaijani (a link's state word on the device page)

  // G4-02 (ozet) · az = tr — «gün» (day), «saat» (hour) and «son» (last) are Azerbaijani words too
  "ozet.period.d7", "ozet.period.d30", //               7 gün · 30 gün
  "ozet.period.text1", "ozet.period.text7", "ozet.period.text30", // son 24 saat · son 7 gün · son 30 gün
```

- [ ] **Step 6: Mirror `summary.view`**

In `dashboard/src/live/screens/admin/catalogue.js`, find:

```js
  "tasks.view", "tasks.manage",
]);
```

Replace with:

```js
  "tasks.view", "tasks.manage",

  // G4-02 — Yönetici özeti (spec D2, D3): the page and GET /handovers/pending; in no default group, the system one
  // holds it by rule
  "summary.view",
]);
```

In `dashboard/src/live/screens/admin/admin.testutil.js`, find:

```js
  "tasks.manage": "Write, claim, close or skip a task; skip one vital measurement with a reason",
});
```

Replace with:

```js
  "tasks.manage": "Write, claim, close or skip a task; skip one vital measurement with a reason",
  // G4-02
  "summary.view": "Open the Yönetici özeti page and read each unit's handovers waiting for a countersignature (GET /handovers/pending), as counts and times only",
});
```

In `dashboard/src/live/i18n/strings/perms.js`, make four edits, one per language.

Find (tr):

```js
      manage_state: "Boş bir yatağı beklenen bir hasta için rezerve eder ya da kullanım dışı bırakır ve bunları geri alır — kendi birimlerinde, Doluluk ekranında" },
```

Replace with:

```js
      manage_state: "Boş bir yatağı beklenen bir hasta için rezerve eder ya da kullanım dışı bırakır ve bunları geri alır — kendi birimlerinde, Doluluk ekranında" },
    // G4-02 — Yönetici özeti
    summary: { view: "Yönetici özetini görür" },
```

Find (az):

```js
      manage_state: "Boş çarpayını gözlənilən xəstə üçün rezerv edir və ya istifadədən çıxarır və bunları geri qaytarır — öz şöbələrində, Doluluq ekranında" },
```

Replace with:

```js
      manage_state: "Boş çarpayını gözlənilən xəstə üçün rezerv edir və ya istifadədən çıxarır və bunları geri qaytarır — öz şöbələrində, Doluluq ekranında" },
    // G4-02 — Yönetici özeti
    summary: { view: "Rəhbər xülasəsini görür" },
```

Find (ru):

```js
      manage_state: "Резервирует свободную койку для ожидаемого пациента или выводит её из использования и отменяет это — в своих отделениях, на экране «Занятость коек»" },
```

Replace with:

```js
      manage_state: "Резервирует свободную койку для ожидаемого пациента или выводит её из использования и отменяет это — в своих отделениях, на экране «Занятость коек»" },
    // G4-02 — Yönetici özeti
    summary: { view: "Видит сводку для руководства" },
```

Find (en):

```js
      manage_state: "Reserve a free bed for an expected patient or take it out of service, and undo either — in their own units, on the Occupancy screen" },
```

Replace with:

```js
      manage_state: "Reserve a free bed for an expected patient or take it out of service, and undo either — in their own units, on the Occupancy screen" },
    // G4-02 — Yönetici özeti
    summary: { view: "See the management summary" },
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `cd /c/tmp/g4-ozet/dashboard && npx vitest run src/live/i18n/strings.test.js src/live/i18n/ozet.strings.test.js src/live/screens/admin/catalogue.test.js src/live/screens/admin/admin.testutil.test.js src/live/screens/admin/RolesTab.test.jsx src/live/screens/admin/RolesTab.server.test.jsx`
Expected: `Tests 89 passed (89)`.

`RolesTab.test.jsx` holds `perms.js` to the catalogue in four languages. `strings.test.js` fails here if an az text equals its tr source without a reviewed `AZ_SAME_AS_TR` line; the five listed above are the only identities.

- [ ] **Step 8: Commit**

```bash
cd /c/tmp/g4-ozet && git add dashboard/src/live/i18n/strings/ozet.js dashboard/src/live/i18n/ozet.strings.test.js dashboard/src/live/i18n/catalog.js dashboard/src/live/i18n/strings.test.js dashboard/src/live/i18n/strings/perms.js dashboard/src/live/screens/admin/catalogue.js dashboard/src/live/screens/admin/admin.testutil.js && git commit -m "feat(i18n): G4-02 the ozet namespace in four languages; summary.view in the catalogue mirror, the fixtures and perms.js" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/live/i18n/strings/ozet.js dashboard/src/live/i18n/ozet.strings.test.js dashboard/src/live/i18n/catalog.js dashboard/src/live/i18n/strings.test.js dashboard/src/live/i18n/strings/perms.js dashboard/src/live/screens/admin/catalogue.js dashboard/src/live/screens/admin/admin.testutil.js
```

---

## Task 6 (dashboard): `pendingHandovers()` in the API client

**Files:**
- Modify: `dashboard/src/backendApi.js` (after `handoverColleagues`, line 661)
- Modify: `dashboard/src/live/session/testTokens.testutil.js` (`fakeApi`, line 129)
- Test: `dashboard/src/backendApi.test.js` (before the "opens a handover" test, line 511)

- [ ] **Step 1: Write the failing test**

In `dashboard/src/backendApi.test.js`, find:

```js
  it("opens a handover of one admission to one receiver: POST /handovers {unit_id, incoming_user_id, admission_ids}", async () => {
```

Replace with:

```js
  // G4-02 (spec D4): «Yönetici özeti» — each unit's handovers waiting for a countersignature, counts and times only.
  it("reads the units' waiting handovers with an authed GET /handovers/pending, with nothing on the address", async () => {
    const answer = { units: [{ unit_id: "u-1", unit_name: "Reanimasiya", pending: 2,
      oldest_outgoing_signed_at: "2026-11-09T08:00:00+00:00" }], generated_at: "2026-11-11T08:00:00+00:00" };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(answer));
    const api = signedIn(fetchMock);
    expect(await api.pendingHandovers()).toEqual(answer);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/handovers/pending");
    expect(init.method || "GET").toBe("GET");
    expect(init.headers.Authorization).toBe("Bearer acc-1");
    expect(init.body).toBeUndefined();
  });

  it("opens a handover of one admission to one receiver: POST /handovers {unit_id, incoming_user_id, admission_ids}", async () => {
```

(`signedIn` here is the synchronous helper of the "what the work screens call" block, line 434.)

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/tmp/g4-ozet/dashboard && npx vitest run src/backendApi.test.js`
Expected: `1 failed`, with `TypeError: api.pendingHandovers is not a function`.

- [ ] **Step 3: Write the call, and the fake API's mock**

In `dashboard/src/backendApi.js`, find:

```js
    handoverColleagues() { return authed("/handovers/colleagues"); },
```

Replace with:

```js
    handoverColleagues() { return authed("/handovers/colleagues"); },
    /** G4-02 (spec D4), `summary.view`: per unit, the handovers the outgoing person signed that wait for the
     *  countersignature — {units: [{unit_id, unit_name, pending, oldest_outgoing_signed_at}], generated_at}. Units
     *  with none are left out. Counts and times only: no patient, no note, no person. Nothing goes on the address. */
    pendingHandovers() { return authed("/handovers/pending"); },
```

In `dashboard/src/live/session/testTokens.testutil.js`, find:

```js
    handoverColleagues: vi.fn(),
```

Replace with:

```js
    handoverColleagues: vi.fn(),
    // G4-02: «Yönetici özeti» (screens/ozet) — each unit's handovers waiting for a countersignature
    pendingHandovers: vi.fn(),
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd /c/tmp/g4-ozet/dashboard && npx vitest run src/backendApi.test.js src/backendApi.admin.test.js src/live/session/sessionStore.test.js`
Expected: `Tests 225 passed (225)`.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g4-ozet && git add dashboard/src/backendApi.js dashboard/src/backendApi.test.js dashboard/src/live/session/testTokens.testutil.js && git commit -m "feat(api-client): G4-02 pendingHandovers() — GET /handovers/pending, and its mock in fakeApi" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/backendApi.js dashboard/src/backendApi.test.js dashboard/src/live/session/testTokens.testutil.js
```

---

## Task 7 (dashboard): the pure `ozet.js`

**Files:**
- Create: `dashboard/src/live/screens/ozet/ozet.test.js`
- Create: `dashboard/src/live/screens/ozet/ozet.js`

From this task until Task 9 wires the route, `src/reachable.test.js` is **red by design**: `ozet.js` (and, after Task 8, the screen) is not yet reachable from `main.jsx`. Do not "fix" it here.

- [ ] **Step 1: Write the failing test**

Create `dashboard/src/live/screens/ozet/ozet.test.js` with:

```js
// ozet.test.js — G4-02 «Yönetici özeti» (spec D5), the pure half: the per-unit join of every source, the «Birimi belli
// olmayan» row, «—» with a reason for a missing, failed or stale source (never 0), the oldest handover's age, the cards,
// and the alarm-quality box's figures. A fixed clock; synthetic units, cards and monitors only.
import { describe, it, expect } from "vitest";
import { CONNECTION } from "../../../liveConnection.js";
import { SHADOW_PHASE } from "../../data/shadowStore.js";
import { bed, strip, unassigned } from "../../data/shadow.testutil.js";
import { NEO, REA, structure } from "../kabul/kabul.testutil.js";
import {
  NO_UNIT, WHY, ageOf, boardSource, durationOf, lateOf, noSource, okSource, qualityView, readSource, rightsOf,
  shadowSource, structureSource, summarise,
} from "./ozet.js";

const NOW = Date.parse("2026-11-11T10:00:00Z");
const MIN = 60_000;
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

// The live board as the adapter shapes it (liveAdapters.js): a patient's unit is `unitId`, an alarm names its patient.
const PATIENTS = [{ patient_id: "S-1", unitId: REA }, { patient_id: "S-2", unitId: NEO }, { patient_id: "S-3", unitId: null }];
const alarm = (patientId, kind, severity, over = {}) => ({
  id: `${patientId}::${kind}`, patientId, kind, severity, ack: false, status: "FIRED", downgraded: false, ...over,
});
const ALERTS = [
  alarm("S-1", "septic_shock", "critical"), alarm("S-1", "news2", "high"),
  alarm("S-1", "acute_change", "moderate", { ack: true, status: "ACKNOWLEDGED" }),     // answered: not waiting
  alarm("S-2", "news2", "moderate"), alarm("S-3", "news2", "high"),
];
const liveBoard = (over = {}) => boardSource({ connection: CONNECTION.LIVE, patients: PATIENTS, alerts: ALERTS, nowMs: NOW, ...over }, true);

// GET /tasks: S-1 a late vital and a late hand task (and one on time), S-2 a vital due (not late), S-3 on no unit.
const TASKS = { patients: [
  { patient_id: "S-1", unit_id: REA, vital: { state: "late" }, tasks: [{ id: "t1", late: true }, { id: "t2", late: false }] },
  { patient_id: "S-2", unit_id: NEO, vital: { state: "due" }, tasks: [] },
  { patient_id: "S-3", unit_id: null, vital: null, tasks: [{ id: "t3", late: true }] },
] };
// GET /handovers/pending: two waiting in Reanimasiya, the oldest signed two days and an hour before the answer.
const PENDING = { generated_at: iso(0), units: [
  { unit_id: REA, unit_name: "Reanimasiya", pending: 2, oldest_outgoing_signed_at: iso(49 * 60 * MIN) },
] };
// The shadow board with G4-01's ledger: Reanimasiya's monitor 1 silent for 7 min, its monitor 2 sending, Neonatal's
// sending, and an unassigned monitor silent for 3 min.
const ledger = (beds, devices = [], feed = {}) => ({
  ...strip({ beds, unassigned: devices, feed }), generated_at: iso(0), watching_since: iso(60 * MIN),
  stale_list_after_s: 60, stale_list_until_s: 3600, vanished: [],
});
const silentFor = (minutes) => ({ status: "silent", last_packet_at: iso(minutes * MIN), silent_for_s: minutes * 60, channels_seen: [] });
const SENDING = { status: "streaming", last_packet_at: iso(0), channels_seen: [] };
const STRIP = ledger([
  bed("REA · 1", [], { unit_id: REA, ...silentFor(7) }), bed("REA · 2", [], { unit_id: REA, ...SENDING }),
  bed("NEO · 3", [], { unit_id: NEO, ...SENDING }),
], [unassigned("192.0.2.40", "not_in_table", [], silentFor(3))]);
const fresh = (data, over = {}) => ({ phase: SHADOW_PHASE.OK, data, fetchedAtMs: NOW, nowMs: NOW + 1000, ...over });
const REPORT = {
  episodes: 12, answered: 9, unanswered: 2, escalated: 1, pending: 1, answered_rate: 0.8182,
  median_response_sec: 42.4, p90_response_sec: 185, truncated: false, window_from: iso(6 * 24 * 60 * MIN),
  per_kind: [{ kind: "news2", episodes: 8, answered: 6, escalated: 1, unanswered: 1, pending: 1, repeats: 0, median_response_sec: 40 }],
  per_day: [{ date: "2026-11-09", episodes: 4 }, { date: "2026-11-10", episodes: 8 }],
  noisiest_beds: [{ patient_id: "S-1", episodes: 5 }], per_patient_hour: [],
};
const SOURCES = {
  tree: structure(), occupancy: okSource(structure()), board: liveBoard(), tasks: okSource(TASKS, NOW),
  pending: okSource(PENDING, NOW), shadow: shadowSource(fresh(STRIP), true), quality: okSource(REPORT, NOW),
};

describe("the units table: every source joined per unit", () => {
  it("counts each unit's beds, waiting alarms, overdue work, waiting handovers and silent monitors", () => {
    const { rows } = summarise(SOURCES);
    expect(rows.map((r) => r.name)).toEqual(["Reanimasiya", "Neonatal"]);
    const [rea, neo] = rows;
    expect(rea).toEqual({
      key: REA, name: "Reanimasiya", closed: false,
      occupancy: { occupied: 1, usable: 4, free: 2, cleaning: 1, reserved: 0, outOfService: 0, maintenance: 0 },
      waiting: { value: 2, critical: 1, high: 1 }, late: { value: 2 },
      pending: { value: 2, age: { unit: "day", n: 2 } }, silent: { value: 1 },
    });
    // A closed unit is listed, said closed, with its zeros — each from a source that answered.
    expect(neo).toMatchObject({ closed: true, waiting: { value: 1, critical: 0, high: 0 }, late: { value: 0 },
      pending: { value: 0, age: null }, silent: { value: 0 } });
  });

  it("gathers what no unit of the tree claims in «Birimi belli olmayan»", () => {
    const { unplaced } = summarise(SOURCES);
    expect(unplaced).toEqual({ key: NO_UNIT, occupancy: null, waiting: { value: 1, critical: 0, high: 1 },
      late: { value: 1 }, pending: { value: 0, age: null }, silent: { value: 1 } });
  });

  it("puts an id the tree does not hold there too, and draws that row only when it counts something", () => {
    const elsewhere = { patients: [{ patient_id: "S-9", unit_id: "REA-01", vital: { state: "late" }, tasks: [] }] };
    const quiet = { ...SOURCES, board: liveBoard({ alerts: [] }), shadow: shadowSource(fresh(ledger([])), true) };
    expect(summarise({ ...quiet, tasks: okSource(elsewhere, NOW) }).unplaced.late).toEqual({ value: 1 });
    expect(summarise({ ...quiet, tasks: okSource({ patients: [] }, NOW) }).unplaced).toBeNull();
  });

  it("has no rows when no tree was ever read — it cannot say which units there are", () => {
    const summary = summarise({ ...SOURCES, tree: null, occupancy: noSource(WHY.failed) });
    expect(summary.rows).toBeNull();
    expect(summary.unplaced).toBeNull();
    expect(summary.cards.late).toEqual({ value: 3 });            // the cards do not need the tree
  });
});

describe("the «Unutulan işler» cards", () => {
  it("count from each source: unanswered for the period, waiting handovers and the oldest's age, overdue work, silent monitors", () => {
    expect(summarise(SOURCES).cards).toEqual({
      unanswered: { value: 2 },
      pending: { value: 2, age: { unit: "day", n: 2 } },
      late: { value: 3 },
      silent: { value: 2, longest: 7, noMonitors: false },
    });
  });

  it("say a view with no monitor has none silent, from a fresh answer", () => {
    const { silent } = summarise({ ...SOURCES, shadow: shadowSource(fresh(ledger([])), true) }).cards;
    expect(silent).toEqual({ value: 0, longest: null, noMonitors: true });
  });
});

describe("«—» with a reason, never an invented 0 (Decision 18)", () => {
  it("gives every card and every cell of a source that did not answer its reason, and no number", () => {
    const summary = summarise({
      tree: structure(), occupancy: noSource(WHY.failed), board: noSource(WHY.stale), tasks: noSource(WHY.loading),
      pending: noSource(WHY.failed), shadow: noSource(WHY.chain), quality: noSource(WHY.noRight),
    });
    expect(summary.cards).toEqual({ unanswered: { why: WHY.noRight }, pending: { why: WHY.failed },
      late: { why: WHY.loading }, silent: { why: WHY.chain } });
    for (const row of summary.rows) {
      expect(row).toMatchObject({ occupancy: { why: WHY.failed }, waiting: { why: WHY.stale }, late: { why: WHY.loading },
        pending: { why: WHY.failed }, silent: { why: WHY.chain } });
    }
    expect(summary.unplaced).toBeNull();
  });

  it("does not read a report that carries no `unanswered` as 0", () => {
    expect(summarise({ ...SOURCES, quality: okSource({ episodes: 3 }, NOW) }).cards.unanswered).toEqual({ why: WHY.unknown });
  });

  it("counts the live board only while it is LIVE", () => {
    expect(liveBoard().ok).toBe(true);
    expect(liveBoard({ connection: CONNECTION.DEGRADED })).toEqual(noSource(WHY.stale));
    expect(liveBoard({ connection: CONNECTION.CONNECTING })).toEqual(noSource(WHY.loading));
    expect(liveBoard({ connection: CONNECTION.UNAVAILABLE })).toEqual(noSource(WHY.failed));
    expect(boardSource({ connection: CONNECTION.LIVE, patients: [], alerts: [], nowMs: NOW }, false)).toEqual(noSource(WHY.noRight));
  });

  it("counts the shadow board only from a fresh answer whose chain works", () => {
    expect(shadowSource(fresh(STRIP), false)).toEqual(noSource(WHY.noRight));
    expect(shadowSource({ phase: SHADOW_PHASE.LOADING, data: null, fetchedAtMs: null, nowMs: NOW }, true)).toEqual(noSource(WHY.loading));
    expect(shadowSource({ phase: SHADOW_PHASE.UNREADABLE, data: null, fetchedAtMs: null, nowMs: NOW }, true)).toEqual(noSource(WHY.failed));
    expect(shadowSource(fresh({ stage: "off" }), true)).toEqual(noSource(WHY.stripOff));
    expect(shadowSource(fresh(STRIP, { nowMs: NOW + 20_000 }), true)).toEqual(noSource(WHY.stale));           // past 15 s
    expect(shadowSource(fresh(STRIP, { phase: SHADOW_PHASE.UNREADABLE }), true)).toEqual(noSource(WHY.stale)); // the last poll failed
    expect(shadowSource(fresh(ledger(STRIP.beds, [], { state: "forwarder_silent" })), true)).toEqual(noSource(WHY.chain));
    expect(shadowSource(fresh(ledger(STRIP.beds, [], { state: "some_new_state" })), true)).toEqual(noSource(WHY.unknown));
  });

  it("counts the silent monitors by status alone from an API without the ledger, with no longest silence", () => {
    const old = strip({ beds: [bed("REA · 1", [], { unit_id: REA, status: "silent" }), bed("REA · 2", [], { unit_id: REA })] });
    const source = shadowSource(fresh({ ...old, generated_at: iso(0) }), true);
    expect(summarise({ ...SOURCES, shadow: source }).cards.silent).toEqual({ value: 1, longest: null, noMonitors: false });
  });

  it("names why the page's own reads and the tree have no answer", () => {
    expect(readSource({ phase: "ok", data: TASKS, atMs: NOW }, true)).toEqual(okSource(TASKS, NOW));
    expect(readSource({ phase: "loading" }, true)).toEqual(noSource(WHY.loading));
    expect(readSource({ phase: "failed", error: Object.assign(new Error("x"), { status: 503 }) }, true)).toEqual(noSource(WHY.failed));
    expect(readSource({ phase: "failed", error: Object.assign(new Error("x"), { status: 403 }) }, true)).toEqual(noSource(WHY.noRight));
    expect(readSource({ phase: "ok", data: TASKS }, false)).toEqual(noSource(WHY.noRight));
    expect(structureSource({ phase: "known", structure: { sites: [] } }, true)).toEqual(okSource({ sites: [] }));
    expect(structureSource({ phase: "stale", structure: { sites: [] } }, true)).toEqual(noSource(WHY.failed));
    expect(structureSource({ phase: "loading", structure: null }, true)).toEqual(noSource(WHY.loading));
    expect(structureSource({ phase: "unasked", structure: null }, true)).toEqual(noSource(WHY.noRight));
  });

  it("knows which sources a session may read", () => {
    expect(rightsOf(["summary.view"])).toEqual({ structure: false, board: false, tasks: false, pending: true, shadow: false, quality: false });
    expect(rightsOf(["summary.view", "board.view", "audit.view", "tasks.view", "admissions.view"]))
      .toEqual({ structure: true, board: true, tasks: true, pending: true, shadow: true, quality: true });
  });
});

describe("what is counted", () => {
  it("overdue work: the server's late hand tasks and a late vital — not a due one, not one on time", () => {
    expect(TASKS.patients.map(lateOf)).toEqual([2, 0, 1]);
    expect(lateOf({ vital: { state: "plan" }, tasks: [{ late: false }, { state: "done" }] })).toBe(0);
  });

  it("an age in whole minutes, hours or days, floored, by the server's clock", () => {
    expect(ageOf(NOW - 59 * MIN, NOW)).toEqual({ unit: "min", n: 59 });
    expect(ageOf(NOW - 60 * MIN, NOW)).toEqual({ unit: "hour", n: 1 });
    expect(ageOf(NOW - (24 * 60 - 1) * MIN, NOW)).toEqual({ unit: "hour", n: 23 });
    expect(ageOf(NOW - 24 * 60 * MIN, NOW)).toEqual({ unit: "day", n: 1 });
    expect(ageOf(NOW + 5 * MIN, NOW)).toEqual({ unit: "min", n: 0 });     // a clock a little behind: never negative
    expect(ageOf(null, NOW)).toBeNull();
  });
});

describe("the alarm-quality box", () => {
  it("draws the report's figures, a rate only when something settled, and each day's bar against the busiest", () => {
    const view = qualityView(REPORT);
    expect(view).toMatchObject({ episodes: 12, answered: 9, answeredPct: 82, escalated: 1, unanswered: 2, pending: 1,
      median: { m: null, s: 42 }, p90: { m: 3, s: 5 }, truncated: false });
    expect(view.perDay).toEqual([{ date: "2026-11-09", episodes: 4, share: 0.5 }, { date: "2026-11-10", episodes: 8, share: 1 }]);
    expect(view.perKind).toEqual([{ kind: "news2", episodes: 8, answered: 6, escalated: 1, median: { m: null, s: 40 } }]);
    expect(JSON.stringify(view)).not.toContain("S-1");                  // no patient-level field is carried
  });

  it("keeps the engine's null rate null, and a figure the answer lacks null — never 0", () => {
    const view = qualityView({ episodes: 2, answered: 0, unanswered: 0, pending: 2, answered_rate: null, median_response_sec: null });
    expect(view.answeredPct).toBeNull();
    expect(view.median).toBeNull();
    expect(view.escalated).toBeNull();
    expect(view.perDay).toEqual([]);
  });

  it("says a truncated read is one, from when it counts", () => {
    const view = qualityView({ ...REPORT, truncated: true, window_from: "2026-11-08T06:00:00+00:00" });
    expect(view.truncated).toBe(true);
    expect(view.windowFromMs).toBe(Date.parse("2026-11-08T06:00:00+00:00"));
    expect(durationOf(59.6)).toEqual({ m: 1, s: 0 });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/tmp/g4-ozet/dashboard && npx vitest run src/live/screens/ozet/ozet.test.js`
Expected: FAIL: `Failed to resolve import "./ozet.js"` (or `Cannot find module`), with 0 tests run.

- [ ] **Step 3: Write `ozet.js`**

Create `dashboard/src/live/screens/ozet/ozet.js` with:

```js
// src/live/screens/ozet/ozet.js — G4-02 «Yönetici özeti» (spec 2026-11-11 D5), pure: what each source the page reads
// says once Decision 18 is applied, and the per-unit join. OzetScreen.jsx only words it.
//
// A SOURCE is what the page holds of one read: `{ok: true, data, atMs}` — an answer it may count from — or
// `{ok: false, why}` — none, and why (WHY): still loading, failed, not fresh (the live board not LIVE, the shadow board
// past its display limit), no right to it, the monitor chain broken, its state unknown, the strip off. A number comes
// only from an `ok` source; every other gives «—» and its reason, never 0 (Decision 18: only a fresh answer says «none»).
//
// The join is by the structure's unit ids (normId): the live board's alarms by their card's `unitId`, `/tasks` by the
// card's unit (the engine's D4 fix), `/handovers/pending` by its own, the shadow board by the card's `unit_id`. What no
// unit of the tree claims — a card on no bed, an unassigned monitor, a unit the tree does not hold — is the «Birimi
// belli olmayan» row (NO_UNIT), drawn only when it has something to count.
//
// No patient here and no clinical threshold: counts, times and the engine's own severities.
import { normId } from "../../data/structure.js";
import { STRUCTURE_PERMS } from "../../data/StructureProvider.jsx";
import { waitingAlarms } from "../../data/boardStore.js";
import { SHADOW_PHASE, mayReadShadow } from "../../data/shadowStore.js";
import { CONNECTION } from "../../../liveConnection.js";
import { readUnknown, stripOn } from "../common/MonitorStrip.jsx";
import { maxAgeOf } from "../common/monitor.js";
import { listingOf, measuredAtMs, silentRows, verdictOf } from "../devices/deviceFeed.js";
import { windowStart } from "../denetim/heat.js";
import { unitCounts } from "../doluluk/occupancy.js";

/** How often the page reads `/tasks`, `/tenant/structure` and `/handovers/pending` while it is visible (spec D5). */
export const SUMMARY_POLL_MS = 60_000;
/** The alarm-quality periods in days (`/alarm-quality?days`), and the one the page opens on: the API's default. */
export const PERIODS = Object.freeze([1, 7, 30]);
export const DEFAULT_PERIOD = 7;
/** The «Birimi belli olmayan» row's key: what a missing unit id reads as (normId). A unit's own key is its UUID. */
export const NO_UNIT = "";
/** Why a source gives no number; each has its words (`ozet.why.*`). */
export const WHY = Object.freeze({
  loading: "loading", failed: "failed", stale: "stale", noRight: "noRight", chain: "chain", unknown: "unknown",
  stripOff: "stripOff",
});

export const okSource = (data, atMs = null) => ({ ok: true, data, atMs });
export const noSource = (why) => ({ ok: false, why });

const MINUTE_MS = 60_000;
const listOf = (value) => (Array.isArray(value) ? value : []);
const countOf = (value) => (Number.isInteger(value) && value >= 0 ? value : null);
const secondsOf = (value) => (Number.isFinite(value) && value >= 0 ? value : null);
const minMs = (a, b) => (a === null ? b : b === null ? a : Math.min(a, b));

function msOf(iso) {
  const ms = typeof iso === "string" ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

/** Which sources these rights may read, by the API's own rules: the tree, the live board, the task queue, the
 *  waiting handovers (this page's own key), the shadow board, and the audit trail alarm quality is read from. */
export function rightsOf(perms) {
  const has = (key) => Array.isArray(perms) && perms.includes(key);
  return {
    structure: STRUCTURE_PERMS.some(has), board: has("board.view"), tasks: has("tasks.view"),
    pending: has("summary.view"), shadow: mayReadShadow(perms), quality: has("audit.view"),
  };
}

/** One of the page's own reads (`/tasks`, `/handovers/pending`, `/alarm-quality`) — `{phase: "loading" | "ok" |
 *  "failed", data, atMs, error}` — as a source. A refusal (403: a scoped caller, a right lost) is «yetki yok». */
export function readSource(read, mayRead) {
  if (!mayRead) return noSource(WHY.noRight);
  if (read?.phase === "ok") return okSource(read.data, read.atMs ?? null);
  if (read?.phase === "failed") return noSource(read.error?.status === 403 ? WHY.noRight : WHY.failed);
  return noSource(WHY.loading);
}

/** The tree (StructureProvider: `useStructure()`) as a source: only a read that just succeeded («known») counts. */
export function structureSource({ phase, structure }, mayRead) {
  if (!mayRead || phase === "unasked") return noSource(WHY.noRight);
  if (phase === "known") return okSource(structure);
  if (phase === "stale" || phase === "failed") return noSource(WHY.failed);
  return noSource(WHY.loading);
}

/** The alarms somebody must answer (`waitingAlarms`' items), counted by the unit of their patient's card: the total,
 *  and the critical and high among them. */
export function waitingByUnit(patients, items) {
  const unitOf = new Map(listOf(patients).map((p) => [p.patient_id, normId(p.unitId)]));
  const out = new Map();
  for (const alarm of listOf(items)) {
    const key = unitOf.get(alarm.patientId) ?? NO_UNIT;
    const row = out.get(key) ?? { total: 0, critical: 0, high: 0 };
    row.total += 1;
    if (alarm.severity === "critical") row.critical += 1;
    if (alarm.severity === "high") row.high += 1;
    out.set(key, row);
  }
  return out;
}

/** The live board (`useBoard()`, the snooze clock's `nowMs`) as a source. Decision 18: only a LIVE board counts; a
 *  DEGRADED one is not fresh, one still connecting is loading, an unavailable one failed. */
export function boardSource({ connection, patients, alerts, nowMs }, mayRead) {
  if (!mayRead) return noSource(WHY.noRight);
  const { known, stale, items } = waitingAlarms({ alerts, connection, nowMs });
  if (known) return okSource({ byUnit: waitingByUnit(patients, items) });
  if (stale) return noSource(WHY.stale);
  return noSource(connection === CONNECTION.UNAVAILABLE ? WHY.failed : WHY.loading);
}

/** The silent rows (deviceFeed `silentRows`) by the unit of their card; an unassigned monitor has none. */
export function silentByUnit(data, rows) {
  const unitOf = new Map(listOf(data?.beds).filter((card) => typeof card?.source === "string")
    .map((card) => [card.source, normId(card.unit_id)]));
  const out = new Map();
  for (const row of listOf(rows)) {
    const key = unitOf.get(row.source) ?? NO_UNIT;
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

/** The longest silence among the rows, in whole minutes — null when no row's last packet is known. */
export function longestMinutes(rows) {
  return listOf(rows).reduce((most, row) => (Number.isInteger(row?.minutes) && (most === null || row.minutes > most)
    ? row.minutes : most), null);
}

/** The shadow board (`useShadow()`) as a source, by the device page's own rules (G4-01): fresh only while the last poll
 *  answered within the display limit; a broken chain or an unknown state lists no monitor as silent; a view with no
 *  monitor has none silent. */
export function shadowSource({ phase, data, fetchedAtMs, nowMs }, mayRead) {
  if (!mayRead) return noSource(WHY.noRight);
  if (!data) return noSource(phase === SHADOW_PHASE.UNREADABLE ? WHY.failed : WHY.loading);
  if (!stripOn(data)) return noSource(WHY.stripOff);
  const fresh = phase === SHADOW_PHASE.OK && !readUnknown({ phase, fetchedAtMs }, nowMs, maxAgeOf(data));
  if (!fresh) return noSource(WHY.stale);
  const now = measuredAtMs(data, true, nowMs, fetchedAtMs);
  const listing = listingOf(data, verdictOf(data, now), now);
  if (listing === "chain") return noSource(WHY.chain);
  if (listing !== "rows" && listing !== "noLedger" && listing !== "noMonitors") return noSource(WHY.unknown);
  const rows = listing === "noMonitors" ? [] : silentRows(data, now);
  return okSource({ rows, byUnit: silentByUnit(data, rows), noMonitors: listing === "noMonitors" }, fetchedAtMs);
}

/** One patient's overdue work over the shift `/tasks` answers: the hand tasks the server marks `late`, and the vital
 *  measurement in state `late`. */
export function lateOf(patient) {
  const vital = patient?.vital?.state === "late" ? 1 : 0;
  return vital + listOf(patient?.tasks).filter((task) => task?.late === true).length;
}

/** `/tasks` counted by the card's unit. */
export function lateByUnit(answer) {
  const out = new Map();
  for (const patient of listOf(answer?.patients)) {
    const n = lateOf(patient);
    if (n > 0) out.set(normId(patient.unit_id), (out.get(normId(patient.unit_id)) ?? 0) + n);
  }
  return out;
}

/** `/handovers/pending` by unit: how many wait, and when the oldest was signed. */
export function pendingByUnit(answer) {
  const out = new Map();
  for (const unit of listOf(answer?.units)) {
    const n = countOf(unit?.pending);
    if (!n) continue;
    const key = normId(unit.unit_id);
    const row = out.get(key) ?? { pending: 0, oldestMs: null };
    out.set(key, { pending: row.pending + n, oldestMs: minMs(row.oldestMs, msOf(unit.oldest_outgoing_signed_at)) });
  }
  return out;
}

/** How long ago `fromMs` was at `toMs`: whole minutes under an hour, whole hours under a day, else whole days —
 *  floored, so «2 gün» is a true lower bound. Null when either instant is unknown. */
export function ageOf(fromMs, toMs) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
  const minutes = Math.floor(Math.max(0, toMs - fromMs) / MINUTE_MS);
  if (minutes < 60) return { unit: "min", n: minutes };
  if (minutes < 24 * 60) return { unit: "hour", n: Math.floor(minutes / 60) };
  return { unit: "day", n: Math.floor(minutes / (24 * 60)) };
}

/** The tree's units, in its order (sites, then units): the key, the name, whether it is closed, and its beds'
 *  counts (Doluluk's `unitCounts`). */
export function unitsOf(tree) {
  const out = [];
  for (const site of listOf(tree?.sites)) {
    for (const unit of listOf(site?.units)) {
      if (unit?.id == null) continue;
      out.push({ key: normId(unit.id), name: unit.name ?? "", closed: unit.is_active === false, counts: unitCounts(unit) });
    }
  }
  return out;
}

const sumOf = (map, pick) => [...map.values()].reduce((sum, value) => sum + pick(value), 0);

/** The cards and the units table. `tree`: the last tree held (rows are read from it even when its latest read failed:
 *  `occupancy`, the tree's own source, then says why); null when none was ever read — `rows` is then null and the page
 *  says why it cannot draw them. The others are sources (okSource / noSource). */
export function summarise({ tree, occupancy, board, tasks, pending, shadow, quality }) {
  const late = tasks.ok ? lateByUnit(tasks.data) : null;
  const waits = pending.ok ? pendingByUnit(pending.data) : null;
  const generatedMs = pending.ok ? msOf(pending.data?.generated_at) : null;
  const unanswered = quality.ok ? countOf(quality.data?.unanswered) : null;
  const cards = {
    unanswered: !quality.ok ? { why: quality.why } : unanswered === null ? { why: WHY.unknown } : { value: unanswered },
    pending: waits ? { value: sumOf(waits, (row) => row.pending),
      age: ageOf([...waits.values()].reduce((at, row) => minMs(at, row.oldestMs), null), generatedMs) } : { why: pending.why },
    late: late ? { value: sumOf(late, (n) => n) } : { why: tasks.why },
    silent: shadow.ok ? { value: shadow.data.rows.length, longest: longestMinutes(shadow.data.rows),
      noMonitors: shadow.data.noMonitors } : { why: shadow.why },
  };
  if (!tree) return { cards, rows: null, unplaced: null };

  const units = unitsOf(tree);
  const known = new Set(units.map((unit) => unit.key));
  // A source's map re-keyed by the tree: an id the tree does not hold joins the NO_UNIT row.
  const regroup = (map, merge) => {
    const out = new Map();
    for (const [key, value] of map ?? []) {
      const at = known.has(key) ? key : NO_UNIT;
      out.set(at, out.has(at) ? merge(out.get(at), value) : value);
    }
    return out;
  };
  const waiting = regroup(board.ok ? board.data.byUnit : null,
    (a, b) => ({ total: a.total + b.total, critical: a.critical + b.critical, high: a.high + b.high }));
  const lateBy = regroup(late, (a, b) => a + b);
  const pendingBy = regroup(waits, (a, b) => ({ pending: a.pending + b.pending, oldestMs: minMs(a.oldestMs, b.oldestMs) }));
  const silentBy = regroup(shadow.ok ? shadow.data.byUnit : null, (a, b) => a + b);
  const cellsOf = (key) => ({
    waiting: board.ok ? { value: waiting.get(key)?.total ?? 0, critical: waiting.get(key)?.critical ?? 0,
      high: waiting.get(key)?.high ?? 0 } : { why: board.why },
    late: tasks.ok ? { value: lateBy.get(key) ?? 0 } : { why: tasks.why },
    pending: pending.ok ? { value: pendingBy.get(key)?.pending ?? 0,
      age: ageOf(pendingBy.get(key)?.oldestMs ?? null, generatedMs) } : { why: pending.why },
    silent: shadow.ok ? { value: silentBy.get(key) ?? 0 } : { why: shadow.why },
  });
  const rows = units.map((unit) => ({
    key: unit.key, name: unit.name, closed: unit.closed,
    occupancy: occupancy.ok ? { ...unit.counts } : { why: occupancy.why }, ...cellsOf(unit.key),
  }));
  const rest = cellsOf(NO_UNIT);
  const any = Object.values(rest).some((cell) => (cell.value ?? 0) > 0);
  return { cards, rows, unplaced: any ? { key: NO_UNIT, occupancy: null, ...rest } : null };
}

/** A response time in seconds as whole minutes and seconds (`m` null under a minute); null for none. */
export function durationOf(seconds) {
  const s = secondsOf(seconds);
  if (s === null) return null;
  const whole = Math.round(s);
  return whole < 60 ? { m: null, s: whole } : { m: Math.floor(whole / 60), s: whole % 60 };
}

/** «2026-11-09» -> «09.11»: a day of `per_day` (a UTC calendar day, as the engine counts it). */
export const dayOf = (date) => `${date.slice(8, 10)}.${date.slice(5, 7)}`;

/** `/alarm-quality`'s answer as the box draws it: each figure, or null when the answer does not carry it — never a 0
 *  in its place. `answeredRate` is null when nothing has settled (the engine's own null). Each day's bar is its share
 *  of the busiest day; the patient-level fields of the answer (`noisiest_beds`, `per_patient_hour`) are not read. */
export function qualityView(report) {
  const days = listOf(report?.per_day).filter((d) => typeof d?.date === "string" && countOf(d?.episodes) !== null);
  const busiest = days.reduce((most, d) => Math.max(most, d.episodes), 0);
  return {
    episodes: countOf(report?.episodes), answered: countOf(report?.answered),
    answeredPct: Number.isFinite(report?.answered_rate) ? Math.round(report.answered_rate * 100) : null,
    median: durationOf(report?.median_response_sec), p90: durationOf(report?.p90_response_sec),
    escalated: countOf(report?.escalated), unanswered: countOf(report?.unanswered), pending: countOf(report?.pending),
    perDay: days.map((d) => ({ date: d.date, episodes: d.episodes, share: busiest > 0 ? d.episodes / busiest : 0 })),
    perKind: listOf(report?.per_kind).filter((k) => typeof k?.kind === "string").map((k) => ({
      kind: k.kind, episodes: countOf(k.episodes), answered: countOf(k.answered), escalated: countOf(k.escalated),
      median: durationOf(k.median_response_sec),
    })),
    truncated: report?.truncated === true,
    windowFromMs: windowStart(report),
  };
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `cd /c/tmp/g4-ozet/dashboard && npx vitest run src/live/screens/ozet/ozet.test.js`
Expected: `Tests 18 passed (18)`.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g4-ozet && git add dashboard/src/live/screens/ozet/ozet.js dashboard/src/live/screens/ozet/ozet.test.js && git commit -m "feat(ozet): G4-02 the pure ozet.js — each source under Decision 18, the per-unit join, «Birimi belli olmayan», the cards, the quality box's figures" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/live/screens/ozet/ozet.js dashboard/src/live/screens/ozet/ozet.test.js
```

---

## Task 8 (dashboard): `OzetScreen`: the header, the cards, alarm quality, the units

**Files:**
- Create: `dashboard/src/live/screens/ozet/ozet.testutil.jsx`
- Create: `dashboard/src/live/screens/ozet/OzetScreen.test.jsx`
- Create: `dashboard/src/live/screens/ozet/useSummaryReads.js`
- Create: `dashboard/src/live/screens/ozet/OzetScreen.jsx`

The page reads the live board (`useBoard`, `useSnoozeClock`), the shadow board (`useShadow`; mounting it is asking for the strip, so the strip polls while the page is open) and the tree (`useStructure`). All three are provided by the shell around every screen, and in the tests by `mount()` plus a `StructureProvider`. The default UI language is az, so the tests read Azerbaijani.

- [ ] **Step 1: Write the test utility**

Create `dashboard/src/live/screens/ozet/ozet.testutil.jsx` with:

```jsx
// Test-only: a synthetic hospital for «Yönetici özeti» (G4-02) — the kabul ward's structure (Reanimasiya open, Neonatal
// closed), a live board with a named patient and two waiting alarms, the task queue, the waiting handovers, the shadow
// board with G4-01's ledger, the alarm-quality report — and a mount of the page inside the shell's StructureProvider,
// the board LIVE and the strip started, as LiveApp nests them. Synthetic names and ids only; no screen may print the
// patient's name, its id or a UUID.
import React from "react";
import { act } from "@testing-library/react";
import { mount } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { StructureProvider } from "../../data/StructureProvider.jsx";
import { alarm, board, entry, identity } from "../../data/board.testutil.js";
import { AT, bed, strip } from "../../data/shadow.testutil.js";
import { PERMISSION_KEYS } from "../admin/catalogue.js";
import { NEO, REA, structure } from "../kabul/kabul.testutil.js";
import { OzetScreen } from "./OzetScreen.jsx";

/** The system administrator: the whole catalogue (the system group holds it by rule). */
export const ADMIN = [...PERMISSION_KEYS];
export const PATIENT_NAME = "Ayşe Sentetik";
export const PATIENT_ID = "S-001";

/** `/patients`: one card in Reanimasiya with a critical and a high alarm, both waiting. */
export const BOARD = board([
  entry(PATIENT_ID, [alarm("septic_shock", "critical"), alarm("news2", "high")],
    { identity: identity({ patient_id: PATIENT_ID, display_name: PATIENT_NAME, unit_id: REA, bed_id: null }) }),
]);
/** `/tasks`: a late vital and a late hand task in Reanimasiya. */
export const TASKS = {
  from: "2026-11-11T04:00:00Z", to: "2026-11-11T16:00:00Z", now: "2026-11-11T10:00:00Z",
  shift: { start: "2026-11-11T04:00:00Z", end: "2026-11-11T16:00:00Z" }, settings: { grace_min: 30, intervals: {} },
  patients: [{ patient_id: PATIENT_ID, bed_key: "REA^01^2", unit_id: REA, vital: { state: "late" },
    tasks: [{ id: "t1", late: true, state: "open" }] }],
};
/** `/handovers/pending`: two waiting in Reanimasiya, the oldest signed two days before the answer. */
export const PENDING = {
  generated_at: "2026-11-11T10:00:00+00:00",
  units: [{ unit_id: REA, unit_name: "Reanimasiya", pending: 2, oldest_outgoing_signed_at: "2026-11-09T09:00:00+00:00" }],
};
/** `/alarm-quality`: a week, two days of episodes, one kind; `noisiest_beds` names a patient the page must not show. */
export const REPORT = {
  episodes: 12, answered: 9, unanswered: 2, escalated: 1, pending: 1, answered_rate: 0.8182,
  median_response_sec: 42, p90_response_sec: 185, days: 7, truncated: false, window_from: "2026-11-05T08:00:00+00:00",
  per_kind: [{ kind: "news2", episodes: 8, answered: 6, escalated: 1, unanswered: 1, pending: 1, repeats: 0, median_response_sec: 40 }],
  per_day: [{ date: "2026-11-09", episodes: 4 }, { date: "2026-11-10", episodes: 8 }],
  noisiest_beds: [{ patient_id: PATIENT_ID, episodes: 5 }], per_patient_hour: [],
};
const minutesBefore = (n) => new Date(Date.parse(AT) - n * 60_000).toISOString();
/** The shadow board with the ledger: Reanimasiya's monitor 1 silent for seven minutes, its monitor 2 sending. */
export const STRIP = {
  ...strip({ beds: [
    bed("REA-01 · 1", [], { unit_id: REA, status: "silent", last_packet_at: minutesBefore(7), silent_for_s: 420, channels_seen: [] }),
    bed("REA-01 · 2", [], { unit_id: REA, last_packet_at: minutesBefore(0), channels_seen: [] }),
  ] }),
  watching_since: minutesBefore(120), stale_list_after_s: 60, stale_list_until_s: 3600, vanished: [],
};

export const settle = () => act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });

/** Mount the page for a session holding `perms`; `live: false` leaves the board connecting (its stream never opens). */
export async function mountOzet({ perms = ADMIN, setup, live = true } = {}) {
  const mounted = await mount(<StructureProvider><OzetScreen /></StructureProvider>, {
    access: token({ perms }), me: profile({ perms }),
    setup: (api) => {
      api.structure.mockResolvedValue(structure());
      api.boardPatients.mockResolvedValue(BOARD);
      api.streamTicket.mockResolvedValue({ ticket: "t-1" });
      api.tasks.mockResolvedValue(TASKS);
      api.pendingHandovers.mockResolvedValue(PENDING);
      api.alarmQuality.mockResolvedValue(REPORT);
      api.shadowBoard.mockResolvedValue(STRIP);
      setup?.(api);
    },
  });
  await settle();
  await act(async () => { await mounted.board.start(); });
  if (live) await act(async () => { mounted.stream.open(); await new Promise((resolve) => { setTimeout(resolve, 0); }); });
  await act(async () => { mounted.shadow.start(perms); await new Promise((resolve) => { setTimeout(resolve, 0); }); });
  await settle();
  return mounted;
}

export { NEO, REA };
```

(The kabul ward: Reanimasiya has beds 1 free, 2 occupied, 3 in cleaning, 4 closed and 5 free, giving «1 / 4». Neonatal is closed.)

- [ ] **Step 2: Write the failing test**

Create `dashboard/src/live/screens/ozet/OzetScreen.test.jsx` with:

```jsx
// OzetScreen.test.jsx — «Rəhbər xülasəsi» (G4-02, spec D5): one h1 and no patient anywhere; the four cards and the units
// table from their sources; the period switch driving the quality box and card 1, read on open and on a change, never
// with «Yenile»; a truncated read; a null answered_rate; «yetki yok»; Decision 18. The default language is az.
// Synthetic hospital (ozet.testutil.jsx).
import { describe, it, expect, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { ddmmhhmm } from "../../i18n/dates.js";
import { refusal } from "../../session/mount.testutil.jsx";
import { expectNoUuid } from "../kabul/kabul.testutil.js";
import { PATIENT_ID, PATIENT_NAME, REPORT, mountOzet, settle } from "./ozet.testutil.jsx";

afterEach(() => { cleanup(); });

/** A card, by its heading. */
const card = (name) => screen.getByRole("heading", { level: 3, name }).closest("li");
/** The units table's body rows, each as its cells' text. */
const unitRows = () => within(screen.getByRole("table", { name: "Şöbələr, indi" })).getAllByRole("row").slice(1)
  .map((row) => [...row.querySelectorAll("th, td")].map((c) => c.textContent));
const quality = () => document.querySelector("[data-quality]");

describe("the summary page", () => {
  it("has one h1, reads each source on open, and shows no patient's name, id or a UUID", async () => {
    const { api, board } = await mountOzet();
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["Rəhbər xülasəsi"]);
    expect(api.tasks).toHaveBeenCalledTimes(1);
    expect(api.pendingHandovers).toHaveBeenCalledTimes(1);
    expect(api.alarmQuality).toHaveBeenCalledTimes(1);
    expect(api.alarmQuality).toHaveBeenCalledWith(7);
    expect(document.querySelector("[data-as-of]").textContent).toMatch(/^\d\d:\d\d vəziyyətinə görə$/);
    expect(document.body.textContent).not.toContain(PATIENT_NAME);
    expect(document.body.textContent).not.toContain(PATIENT_ID);
    expectNoUuid();
    act(() => { board.clear(); });
  });

  it("counts the four «Unutulan işlər» from their sources", async () => {
    const { board } = await mountOzet();
    expect(card("Cavabsız qalan siqnal · son 7 gün").querySelector("[data-card-value]").textContent).toBe("2");
    expect(card("Cavabsız qalan siqnal · son 7 gün")).toHaveTextContent("10 dəqiqə sistemin hesabat həddidir");
    expect(card("Əks-imza gözləyən təhvil")).toHaveTextContent("2ən köhnəsi 2 gün əvvəl");
    expect(card("Gecikən iş").querySelector("[data-card-value]").textContent).toBe("2");
    expect(card("Səssiz monitor")).toHaveTextContent("1ən uzunu 7 dəq");
    act(() => { board.clear(); });
  });

  it("joins every source per unit, a closed unit said closed", async () => {
    const { board } = await mountOzet();
    expect(unitRows()).toEqual([
      ["Reanimasiya", "1 / 4 doludur", "2 (1 kritik · 1 yüksək)", "2", "2 · ən köhnəsi 2 gün əvvəl", "1"],
      ["Neonatal · bağlıdır", "0 / 0 doludur", "0", "0", "0", "0"],
    ]);
    act(() => { board.clear(); });
  });

  it("draws the quality box's figures, its days and its kinds — and none of the report's patients", async () => {
    const { board } = await mountOzet();
    const box = quality();
    expect(box).toHaveTextContent("Siqnal epizodu12");
    expect(box).toHaveTextContent("Cavablanan9 · nisbət 82%");
    expect(box).toHaveTextContent("Cavab müddəti (median)42 san");
    expect(box).toHaveTextContent("Cavab müddəti (p90)3 dəq 5 san");
    expect(within(box).getByText("09.11: 4 epizod")).toBeInTheDocument();
    expect(within(box).getByText("10.11: 8 epizod")).toBeInTheDocument();
    expect(within(screen.getByRole("table", { name: "Növə görə" })).getByRole("rowheader")).toHaveTextContent("news2");
    expect(box.textContent).not.toMatch(/3 dəq içində|Səhv kimi/);   // the prototype's numbers with no source
    act(() => { board.clear(); });
  });
});

describe("the period switch", () => {
  it("drives the quality box and card 1, and reads the report again only then", async () => {
    const { api, board } = await mountOzet();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "30 gün" })); });
    await settle();
    expect(api.alarmQuality).toHaveBeenLastCalledWith(30);
    expect(screen.getByRole("button", { name: "30 gün" })).toHaveAttribute("aria-pressed", "true");
    expect(card("Cavabsız qalan siqnal · son 30 gün")).toBeInTheDocument();
    expect(quality()).toHaveTextContent("son 30 gün");
    act(() => { board.clear(); });
  });

  it("«Yenile» reads the tree, the tasks and the handovers again — not the alarm quality", async () => {
    const { api, board } = await mountOzet();
    const structureReads = api.structure.mock.calls.length;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yenilə" })); });
    await settle();
    expect(api.tasks).toHaveBeenCalledTimes(2);
    expect(api.pendingHandovers).toHaveBeenCalledTimes(2);
    expect(api.structure.mock.calls.length).toBe(structureReads + 1);
    expect(api.alarmQuality).toHaveBeenCalledTimes(1);
    act(() => { board.clear(); });
  });
});

describe("the quality box says what it read", () => {
  it("says a truncated read is one, and from when it counts", async () => {
    const from = "2026-11-08T06:00:00+00:00";
    const { board } = await mountOzet({ setup: (api) => api.alarmQuality.mockResolvedValue({ ...REPORT, truncated: true, window_from: from }) });
    expect(quality()).toHaveTextContent(
      `Serverin oxuma həddi aşıldı: yalnız ən yeni qeydlər oxundu; sayılan dövr ${ddmmhhmm(Date.parse(from))} ilə başlayır`);
    act(() => { board.clear(); });
  });

  it("says nothing has settled rather than a rate of 0 %", async () => {
    const { board } = await mountOzet({ setup: (api) => api.alarmQuality.mockResolvedValue({
      ...REPORT, episodes: 2, answered: 0, unanswered: 0, pending: 2, answered_rate: null, median_response_sec: null,
      p90_response_sec: null, per_day: [{ date: "2026-11-10", episodes: 2 }], per_kind: [] }) });
    expect(quality()).toHaveTextContent("Cavablanan0 · hələ yekunlaşan yoxdur");
    expect(quality()).toHaveTextContent("Cavab müddəti (median)cavablanan yoxdur");
    expect(quality().textContent).not.toMatch(/0%/);
    act(() => { board.clear(); });
  });

  it("says a scoped refusal is no right, and a failure is a failure", async () => {
    let mounted = await mountOzet({ setup: (api) => api.alarmQuality.mockRejectedValue(refusal(403, "alarm kalitesi raporunun tamamı kapsam dışı")) });
    expect(quality()).toHaveTextContent("audit.view");
    expect(card("Cavabsız qalan siqnal · son 7 gün")).toHaveTextContent("— səlahiyyət yoxdur");
    act(() => { mounted.board.clear(); });
    cleanup();
    mounted = await mountOzet({ setup: (api) => api.alarmQuality.mockRejectedValue(refusal(503, "down")) });
    expect(within(quality()).getByRole("alert")).toHaveTextContent("Siqnal keyfiyyəti oxunmadı");
    expect(card("Cavabsız qalan siqnal · son 7 gün")).toHaveTextContent("— oxunmadı");
    act(() => { mounted.board.clear(); });
  });
});

describe("«yetki yok»: the key without a source's own right", () => {
  it("says so on each card and column the session may not read, and reads none of them", async () => {
    const { api, board } = await mountOzet({ perms: ["summary.view"] });
    expect(card("Cavabsız qalan siqnal · son 7 gün")).toHaveTextContent("— səlahiyyət yoxdur");
    expect(card("Gecikən iş")).toHaveTextContent("— səlahiyyət yoxdur");
    expect(card("Səssiz monitor")).toHaveTextContent("— səlahiyyət yoxdur");
    expect(card("Əks-imza gözləyən təhvil").querySelector("[data-card-value]").textContent).toBe("2");
    expect(document.querySelector("[data-units]")).toHaveTextContent("Şöbə sətirləri yazıla bilmir · səlahiyyət yoxdur");
    expect(quality()).toHaveTextContent("audit.view");
    for (const read of [api.structure, api.tasks, api.alarmQuality, api.shadowBoard]) expect(read).not.toHaveBeenCalled();
    act(() => { board.clear(); });
  });
});

describe("Decision 18: a zero only from a fresh answer", () => {
  it("never counts a board that is not LIVE: connecting, then dropped", async () => {
    const { board, stream } = await mountOzet({ live: false });
    expect(unitRows()[0][2]).toBe("— oxunur…");
    expect(unitRows()[1][2]).toBe("— oxunur…");
    await act(async () => { stream.open(); await new Promise((resolve) => { setTimeout(resolve, 0); }); });
    expect(unitRows()[1][2]).toBe("0");
    act(() => { stream.drop(); });
    expect(unitRows()[0][2]).toBe("— lövhə yenilənməyib");
    expect(unitRows()[1][2]).toBe("— lövhə yenilənməyib");
    act(() => { board.clear(); });
  });

  it("drops a source's last number when its read fails: «—» and why, never the old count or a 0", async () => {
    const { api, board } = await mountOzet();
    api.tasks.mockRejectedValue(refusal(503, "down"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yenilə" })); });
    await settle();
    expect(card("Gecikən iş")).toHaveTextContent("— oxunmadı");
    expect(unitRows().map((row) => row[3])).toEqual(["— oxunmadı", "— oxunmadı"]);
    act(() => { board.clear(); });
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `cd /c/tmp/g4-ozet/dashboard && npx vitest run src/live/screens/ozet/OzetScreen.test.jsx`
Expected: FAIL: `Failed to resolve import "./OzetScreen.jsx"` from `ozet.testutil.jsx`, with 0 tests run.

- [ ] **Step 4: Write the reads**

Create `dashboard/src/live/screens/ozet/useSummaryReads.js` with:

```js
// src/live/screens/ozet/useSummaryReads.js — G4-02 «Yönetici özeti» (spec D5): the page's own reads.
//
// `useSummaryReads`: the tree (through the shell's StructureProvider — every screen keeps the one tree), `/tasks` and
// `/handovers/pending`, read when the page opens, on «Yenile», and every SUMMARY_POLL_MS while the page is visible (and
// at once when it is shown again). A read that fails keeps nothing of its last answer: the page says «okunamadı», never
// an older number as today's. `fullAt`: when the last round in which every source this session may read answered came
// back — the header's «HH:MM itibarıyla».
//
// `useQuality`: `/alarm-quality` for one period, read when the page opens and when the period changes — never on a
// timer (spec D5 §3: the API rebuilds every episode of the window from the audit trail). The newest read wins.
import { useCallback, useEffect, useRef, useState } from "react";
import { SUMMARY_POLL_MS } from "./ozet.js";

export const LOADING = Object.freeze({ phase: "loading", data: null, atMs: null, error: null });
const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
const isTasks = (answer) => Array.isArray(answer?.patients);
const isPending = (answer) => Array.isArray(answer?.units);
const isReport = (answer) => Number.isInteger(answer?.episodes);

export function useSummaryReads({ store, rights, reloadStructure, everyMs = SUMMARY_POLL_MS }) {
  const [tasks, setTasks] = useState(LOADING);
  const [pending, setPending] = useState(LOADING);
  const [fullAt, setFullAt] = useState(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const seq = useRef(0);

  const read = useCallback(async () => {
    seq.current += 1;
    const mine = seq.current;
    const current = () => alive.current && mine === seq.current;
    setBusy(true);
    const one = async (may, call, valid, set) => {
      if (!may) return true;
      try {
        const data = await store.track(call);
        if (!valid(data)) throw new Error("not the answer this page reads");
        if (current()) set({ phase: "ok", data, atMs: Date.now(), error: null });
        return true;
      } catch (error) {
        if (current()) set({ phase: "failed", data: null, atMs: null, error });
        return false;
      }
    };
    const answered = await Promise.all([
      rights.structure ? reloadStructure().then((tree) => tree !== null, () => false) : true,
      one(rights.tasks, () => store.api.tasks(), isTasks, setTasks),
      one(rights.pending, () => store.api.pendingHandovers(), isPending, setPending),
    ]);
    if (current()) {
      if (answered.every(Boolean)) setFullAt(Date.now());
      setBusy(false);
    }
  }, [store, rights.structure, rights.tasks, rights.pending, reloadStructure]);

  useEffect(() => {
    alive.current = true;
    read();
    const timer = setInterval(() => { if (!hidden()) read(); }, everyMs);
    const wake = () => { if (!hidden()) read(); };
    document.addEventListener("visibilitychange", wake);
    return () => {
      alive.current = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [read, everyMs]);

  return { tasks, pending, fullAt, busy, refresh: read };
}

export function useQuality({ store, may, period }) {
  const [read, setRead] = useState(LOADING);
  const seq = useRef(0);
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
  }, [store, may, period]);
  return read;
}
```

- [ ] **Step 5: Write the screen**

Create `dashboard/src/live/screens/ozet/OzetScreen.jsx` with:

```jsx
// src/live/screens/ozet/OzetScreen.jsx — G4-02 «Yönetici özeti» (spec docs/superpowers/specs/2026-11-11-g4-yonetici-ozeti-design.md,
// D5), for `summary.view`. Read-only, and no patient name or id anywhere. Top to bottom: the header (the last full read,
// «Yenile»), the four «Unutulan işler» cards, the hospital-wide alarm quality over a period, and the units as of now.
// The rules are ozet.js's; this file words them. Every number is real or a «—» with its reason (Decision 18). Nothing
// here alarms, sounds or counts on the rail.
import React, { useMemo, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { ddmmhhmm, hhmm } from "../../i18n/dates.js";
import { useSession } from "../../session/SessionProvider.jsx";
import { useBoard } from "../../data/BoardProvider.jsx";
import { useShadow } from "../../data/ShadowProvider.jsx";
import { useStructure } from "../../data/StructureProvider.jsx";
import { useSnoozeClock } from "../../data/useSnoozeClock.js";
import { readErrorText } from "../../apiErrors.js";
import { Alert, Box, Button, Icon, KV, KVList, Note, Seg, Table } from "../../ui/index.js";
import {
  DEFAULT_PERIOD, PERIODS, WHY, boardSource, dayOf, qualityView, readSource, rightsOf, shadowSource, structureSource,
  summarise,
} from "./ozet.js";
import { useQuality, useSummaryReads } from "./useSummaryReads.js";

/** Each period's switch label and the phrase the card and the box name it by. */
const PERIOD = Object.freeze({
  1: { label: "ozet.period.d1", text: "ozet.period.text1" },
  7: { label: "ozet.period.d7", text: "ozet.period.text7" },
  30: { label: "ozet.period.d30", text: "ozet.period.text30" },
});
const OCCUPANCY_EXTRAS = Object.freeze([
  ["reserved", "doluluk.counts.reserved"], ["outOfService", "doluluk.counts.outOfService"],
  ["maintenance", "doluluk.counts.maintenance"],
]);

const ageText = (t, age) => (age ? t(`ozet.age.${age.unit}`, { n: age.n }) : null);
const forText = (t, minutes) => (minutes === 0 ? t("ozet.for.underMinute") : t("ozet.for.minutes", { n: minutes }));
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

function Card({ t, icon, title, what, cell, extra, atMs }) {
  return (
    <li className="flex min-w-[220px] flex-1 flex-col gap-1 rounded-box border border-line bg-card px-[14px] py-3">
      <h3 className="m-0 flex items-center gap-2 font-text text-13 font-semibold"><Icon name={icon} size={16} />{title}</h3>
      <p className="m-0" data-card-value>
        {"value" in cell ? <span className="font-data text-23 font-bold">{cell.value}</span> : <Missing t={t} why={cell.why} big />}
      </p>
      {extra ? <p className="m-0 text-13">{extra}</p> : null}
      <p className="m-0 text-12 text-mute">{what}</p>
      {"value" in cell && Number.isFinite(atMs) ? <p className="m-0 text-12 text-mute">{t("ozet.readAt", { time: hhmm(atMs) })}</p> : null}
    </li>
  );
}

function Cards({ t, cards, period, atMs }) {
  const { unanswered, pending, late, silent } = cards;
  const oldest = "value" in pending && pending.value > 0 ? ageText(t, pending.age) : null;
  let silentExtra = null;
  if ("value" in silent && silent.noMonitors) silentExtra = t("ozet.cards.silentNoMonitors");
  else if ("value" in silent && silent.value > 0 && silent.longest !== null) silentExtra = t("ozet.cards.silentLongest", { for: forText(t, silent.longest) });
  return (
    <section aria-labelledby="ozet-cards" className="flex flex-col gap-2">
      <h2 id="ozet-cards" className="m-0 font-display text-17 font-bold">{t("ozet.cards.title")}</h2>
      <ul className="m-0 flex list-none flex-wrap gap-2.5 p-0">
        <Card t={t} icon="bell" cell={unanswered} atMs={atMs.quality}
          title={t("ozet.cards.unansweredTitle", { period: t(PERIOD[period].text) })} what={t("ozet.cards.unansweredWhat")} />
        <Card t={t} icon="clip" cell={pending} atMs={atMs.pending} title={t("ozet.cards.pendingTitle")}
          what={t("ozet.cards.pendingWhat")} extra={oldest ? t("ozet.cards.pendingOldest", { age: oldest }) : null} />
        <Card t={t} icon="clock" cell={late} atMs={atMs.tasks} title={t("ozet.cards.lateTitle")} what={t("ozet.cards.lateWhat")} />
        <Card t={t} icon="plug" cell={silent} atMs={atMs.shadow} title={t("ozet.cards.silentTitle")}
          what={t("ozet.cards.silentWhat")} extra={silentExtra} />
      </ul>
    </section>
  );
}

function QualityFigures({ t, view, atMs }) {
  const figure = (value) => (value === null ? <Missing t={t} why={WHY.unknown} /> : value);
  const rate = view.answeredPct === null ? t("ozet.q.unsettled") : t("ozet.q.rate", { pct: view.answeredPct });
  const time = (d) => (d === null ? t("ozet.q.noAnswered") : durationText(t, d));
  return (
    <>
      {view.truncated ? (
        <Note tone="warn">
          {view.windowFromMs === null ? t("ozet.q.truncated") : t("ozet.q.truncatedFrom", { from: ddmmhhmm(view.windowFromMs) })}
        </Note>
      ) : null}
      <KVList>
        <KV label={t("ozet.q.episodes")}>{figure(view.episodes)}</KV>
        <KV label={t("ozet.q.answered")}>{view.answered === null ? figure(null) : `${view.answered} · ${rate}`}</KV>
        <KV label={t("ozet.q.median")}>{time(view.median)}</KV>
        <KV label={t("ozet.q.p90")}>{time(view.p90)}</KV>
        <KV label={t("ozet.q.escalated")}>{figure(view.escalated)}</KV>
        <KV label={t("ozet.q.unanswered")}>{figure(view.unanswered)}</KV>
        <KV label={t("ozet.q.pending")}>{figure(view.pending)}</KV>
      </KVList>
      {view.episodes === 0 && !view.truncated ? <p className="m-0 text-13 text-mute">{t("ozet.q.none")}</p> : null}
      {view.perDay.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h3 className="m-0 font-text text-13 font-semibold">{t("ozet.q.daily")}</h3>
          <ul className="m-0 flex list-none flex-col gap-1 p-0" data-daily>
            {view.perDay.map((day) => (
              <li key={day.date} className="flex items-center gap-2 text-12.5">
                <span className="w-[120px] shrink-0 font-data">{t("ozet.q.dayCount", { date: dayOf(day.date), n: day.episodes })}</span>
                <span aria-hidden="true" className="h-2 rounded-full bg-pri" style={{ width: `${Math.max(2, Math.round(day.share * 100))}%`, maxWidth: "60%" }} />
              </li>
            ))}
          </ul>
          <p className="m-0 text-12 text-mute">{t("ozet.q.dailyNote")}</p>
        </div>
      ) : null}
      {view.perKind.length > 0 ? (
        <Table caption={t("ozet.q.byKind")}>
          <thead>
            <tr>
              <th scope="col">{t("ozet.q.colKind")}</th>
              <th scope="col">{t("ozet.q.colEpisodes")}</th>
              <th scope="col">{t("ozet.q.colAnswered")}</th>
              <th scope="col">{t("ozet.q.colEscalated")}</th>
              <th scope="col">{t("ozet.q.colMedian")}</th>
            </tr>
          </thead>
          <tbody>
            {view.perKind.map((kind) => (
              <tr key={kind.kind}>
                <th scope="row" className="font-data">{kind.kind}</th>
                <td className="font-data">{figure(kind.episodes)}</td>
                <td className="font-data">{figure(kind.answered)}</td>
                <td className="font-data">{figure(kind.escalated)}</td>
                <td className="font-data">{time(kind.median)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
      {Number.isFinite(atMs) ? <p className="m-0 text-12 text-mute">{t("ozet.asOf", { time: hhmm(atMs) })}</p> : null}
    </>
  );
}

function QualityBox({ t, may, period, setPeriod, read }) {
  const source = readSource(read, may);
  let body;
  if (!may || (!source.ok && source.why === WHY.noRight)) body = <Note tone="info">{t("ozet.q.noRight")}</Note>;
  else if (read.phase === "loading") body = <p className="m-0 text-13 text-mute">{t("ozet.q.loading")}</p>;
  else if (!source.ok) {
    body = (
      <Alert tone="crit">
        <p className="m-0">{t("ozet.q.failed", { reason: read.error ? readErrorText(t, read.error) : t("ozet.why.failed") })}</p>
      </Alert>
    );
  } else body = <QualityFigures t={t} view={qualityView(read.data)} atMs={read.atMs} />;
  const options = PERIODS.map((days) => ({ value: days, label: t(PERIOD[days].label) }));
  return (
    <Box title={t("ozet.q.title")} icon="chart" level={2}
      right={may ? <Seg label={t("ozet.period.label")} options={options} value={period} onChange={setPeriod} /> : null}>
      <div className="flex flex-col gap-2" data-quality>
        <p className="m-0 text-13 text-mute">{t("ozet.q.intro", { period: t(PERIOD[period].text) })}</p>
        {body}
      </div>
    </Box>
  );
}

function occupancyText(t, counts) {
  const extras = OCCUPANCY_EXTRAS.filter(([field]) => counts[field] > 0).map(([field, key]) => t(key, { n: counts[field] }));
  return [t("doluluk.occupied", { occupied: counts.occupied, usable: counts.usable }), ...extras].join(" · ");
}

function UnitRow({ t, row, name }) {
  const cell = (c, text) => <td className="font-data">{"why" in c ? <Missing t={t} why={c.why} /> : text}</td>;
  const waiting = (c) => (c.value > 0 ? `${c.value} ${t("ozet.units.waitingSplit", { critical: c.critical, high: c.high })}` : c.value);
  const pending = (c) => (c.value > 0 && c.age ? `${c.value} · ${t("ozet.cards.pendingOldest", { age: ageText(t, c.age) })}` : c.value);
  return (
    <tr>
      <th scope="row">{name}</th>
      {row.occupancy === null ? <td /> : cell(row.occupancy, "why" in row.occupancy ? null : occupancyText(t, row.occupancy))}
      {cell(row.waiting, "value" in row.waiting ? waiting(row.waiting) : null)}
      {cell(row.late, row.late.value)}
      {cell(row.pending, "value" in row.pending ? pending(row.pending) : null)}
      {cell(row.silent, row.silent.value)}
    </tr>
  );
}

function UnitsBox({ t, summary, occupancy }) {
  let body;
  if (summary.rows === null) body = <Note tone="warn">{t("ozet.units.missing", { why: t(`ozet.why.${occupancy.why ?? WHY.failed}`) })}</Note>;
  else if (summary.rows.length === 0) body = <p className="m-0 text-13 text-mute">{t("doluluk.noUnits")}</p>;
  else {
    body = (
      <>
        <Table caption={t("ozet.units.caption")}>
          <thead>
            <tr>
              <th scope="col">{t("ozet.units.colUnit")}</th>
              <th scope="col">{t("ozet.units.colOccupancy")}</th>
              <th scope="col">{t("ozet.units.colWaiting")}</th>
              <th scope="col">{t("ozet.units.colLate")}</th>
              <th scope="col">{t("ozet.units.colPending")}</th>
              <th scope="col">{t("ozet.units.colSilent")}</th>
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((row) => (
              <UnitRow key={row.key} t={t} row={row}
                name={row.closed ? `${row.name} · ${t("doluluk.unitClosed")}` : row.name} />
            ))}
            {summary.unplaced ? <UnitRow t={t} row={summary.unplaced} name={t("ozet.units.unplaced")} /> : null}
          </tbody>
        </Table>
        {summary.unplaced ? <p className="m-0 text-12 text-mute">{t("ozet.units.unplacedNote")}</p> : null}
      </>
    );
  }
  return (
    <Box title={t("ozet.units.title")} icon="building" level={2}>
      <div className="flex flex-col gap-2" data-units>{body}</div>
    </Box>
  );
}

export function OzetScreen() {
  const { t } = useI18n();
  const { user, store } = useSession();
  const board = useBoard();
  const boardNowMs = useSnoozeClock();
  const shadow = useShadow();
  const tree = useStructure();
  const rights = useMemo(() => rightsOf(user?.perms), [user?.perms]);
  const reads = useSummaryReads({ store, rights, reloadStructure: tree.reload });
  const [period, setPeriod] = useState(DEFAULT_PERIOD);
  const quality = useQuality({ store, may: rights.quality, period });

  const sources = {
    tree: tree.known ? tree.structure : null,
    occupancy: structureSource(tree, rights.structure),
    board: boardSource({ connection: board.connection, patients: board.patients, alerts: board.alerts, nowMs: boardNowMs }, rights.board),
    tasks: readSource(reads.tasks, rights.tasks),
    pending: readSource(reads.pending, rights.pending),
    shadow: shadowSource(shadow, rights.shadow),
    quality: readSource(quality, rights.quality),
  };
  const summary = summarise(sources);
  const atMs = { quality: quality.atMs, pending: reads.pending.atMs, tasks: reads.tasks.atMs, shadow: shadow.fetchedAtMs };

  return (
    <div className="flex min-h-0 max-w-[1200px] flex-col gap-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 font-display text-23 font-bold">{t("ozet.title")}</h1>
          <p className="m-0 text-13 text-mute" data-as-of>
            {reads.fullAt ? t("ozet.asOf", { time: hhmm(reads.fullAt) }) : t("ozet.noFullRead")}
          </p>
        </div>
        <Button size="sm" icon="clock" busy={reads.busy} onClick={reads.refresh}>{t("ozet.refresh")}</Button>
      </div>
      <p className="m-0 text-13 text-mute">{t("ozet.intro")}</p>
      <Cards t={t} cards={summary.cards} period={period} atMs={atMs} />
      <QualityBox t={t} may={rights.quality} period={period} setPeriod={setPeriod} read={quality} />
      <UnitsBox t={t} summary={summary} occupancy={sources.occupancy} />
    </div>
  );
}
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `cd /c/tmp/g4-ozet/dashboard && npx vitest run src/live/screens/ozet`
Expected: `Test Files 2 passed (2)`, `Tests 30 passed (30)`. `src/reachable.test.js` stays red until Task 9.

- [ ] **Step 7: Commit**

```bash
cd /c/tmp/g4-ozet && git add dashboard/src/live/screens/ozet/useSummaryReads.js dashboard/src/live/screens/ozet/OzetScreen.jsx dashboard/src/live/screens/ozet/ozet.testutil.jsx dashboard/src/live/screens/ozet/OzetScreen.test.jsx && git commit -m "feat(ozet): G4-02 OzetScreen — the header with the last full read, «Unutulan işler», alarm quality with its period (on open and on a change only), the units table; tree, tasks and handovers every 60 s while visible" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/live/screens/ozet/useSummaryReads.js dashboard/src/live/screens/ozet/OzetScreen.jsx dashboard/src/live/screens/ozet/ozet.testutil.jsx dashboard/src/live/screens/ozet/OzetScreen.test.jsx
```

---

## Task 9 (dashboard): the `/ozet` route, one pinned tail, the rawKeys sweep

**Files:**
- Modify: `dashboard/src/live/shell/routes.js` (`lazyScreen` line 51; SCREENS line 83; ROUTES line 149)
- Test: `dashboard/src/live/shell/routes.test.js` (lines 209–211, 232–233, 264–265; a new block before line 283)
- Test: `dashboard/src/live/rawKeys.test.jsx` (after `COLLEAGUES`, line 258; the sweep's mocks, line 304; a new anchor test before line 461)

- [ ] **Step 1: Write the failing route tests: one pinned tail, relative order elsewhere**

Today three blocks pin the table's tail (lines 211, 233, 265), so every new route meant three edits and a merge conflict in each. This step makes the audit, RRT and handover blocks assert only their own relative order, and pins the tail **once**, in the new last route's block (N17).

In `dashboard/src/live/shell/routes.test.js`, find (the audit page's block):

```js
    // G2-B5: the RRT screen now comes after it (its own block below), still before settings.
    // G2-B3b: and the handover screen after that (its own block below), still before settings.
    expect(ROUTES.map((r) => r.id).slice(-3)).toEqual(["rrt", "devir", "settings"]);
```

Replace with:

```js
    // G2-B5, G2-B3b: the RRT screen and then the handover screen come right after it (their own blocks below). What
    // follows them is pinned once, in the last route's own block (G4-02).
    const ids = ROUTES.map((r) => r.id);
    expect(ids.slice(ids.indexOf("denetim"), ids.indexOf("denetim") + 3)).toEqual(["denetim", "rrt", "devir"]);
```

Then find (the RRT screen's block):

```js
    // G2-B3b: the handover screen now comes after it (its own block below), still before settings.
    expect(ROUTES.map((r) => r.id).slice(-4)).toEqual(["denetim", "rrt", "devir", "settings"]);
```

Replace with:

```js
    // G2-B3b: the handover screen comes right after it (its own block below).
    const ids = ROUTES.map((r) => r.id);
    expect(ids[ids.indexOf("rrt") + 1]).toBe("devir");
```

Then find (the handover screen's block):

```js
    expect(screenOf(devir())).not.toBeNull();
    expect(ROUTES.map((r) => r.id).slice(-4)).toEqual(["denetim", "rrt", "devir", "settings"]);
```

Replace with:

```js
    expect(screenOf(devir())).not.toBeNull();
    const ids = ROUTES.map((r) => r.id);
    expect(ids[ids.indexOf("devir") - 1]).toBe("rrt");
```

Then find:

```js
// G3-01 (D3, D14): the bedside page opens with clinical.chart, on the rail after the ward's other screens.
```

Replace with:

```js
// G4-02 (spec D3): «Yönetici özeti» — for `summary.view`, which by default only the system administrator holds (the
// system group holds every key by rule). Not a work screen; after the handover screen, so nobody's home moves.
// THE ONE PINNED TAIL of the table is here: a slice that adds a route after «devir» edits this line and no other —
// the pharmacy slice (devir → eczane → ozet → settings) makes it ["eczane", "ozet", "settings"].
describe("the management summary's route", () => {
  afterEach(() => resetScreens());
  const ozet = () => ROUTES.find((r) => r.id === "ozet");

  it("is for summary.view, on the main rail, not a work screen, with its own names", () => {
    expect(ozet()).toMatchObject({ path: "/ozet", perms: ["summary.view"], work: false, nav: "main",
      icon: "chart", labelKey: "ozet.nav", shortKey: "ozet.navShort" });
    expect(screenOf(ozet())).not.toBeNull();
    expect(ROUTES.map((r) => r.id).slice(-3)).toEqual(["devir", "ozet", "settings"]);
  });

  it("is the system administrator's by default, and moves nobody's home", () => {
    expect(navRoutes(ADMIN).main.map((r) => r.id)).toContain("ozet");
    expect(homePath(ADMIN)).toBe("/beds");
    for (const perms of [NURSE, ["board.view", "audit.view"], ["alerts.escalate"], ["handover.sign"], ["devices.manage"]]) {
      expect(canReach(ozet(), perms), perms.join(",")).toBe(false);
    }
  });

  it("is no work screen: the key alone does not pass the entry rule", () => {
    expect(hasWorkRoute(["summary.view"])).toBe(false);
  });
});

// G3-01 (D3, D14): the bedside page opens with clinical.chart, on the rail after the ward's other screens.
```

(`ADMIN` in this file is `[...PERMISSION_KEYS]`, which holds `summary.view` since Task 5.)

- [ ] **Step 2: Write the failing rawKeys anchor and the sweep's mock**

In `dashboard/src/live/rawKeys.test.jsx`, find:

```js
const COLLEAGUES = [{ id: "u-leyla", name: "Leyla Sentetik" }, { id: "u-murad", name: "Murad Sentetik" }];
```

Replace with:

```js
const COLLEAGUES = [{ id: "u-leyla", name: "Leyla Sentetik" }, { id: "u-murad", name: "Murad Sentetik" }];

/** G4-02: «Yönetici özeti» — one unit of the ward with a handover waiting since three hours before the answer, so the
 *  card's and the cell's «oldest» words are drawn. Counts and times only, as the API sends them. */
const PENDING_SWEEP = { generated_at: "2026-10-08T10:00:00+00:00", units: [{ unit_id: WARD.sites[0].units[0].id,
  unit_name: WARD.sites[0].units[0].name, pending: 1, oldest_outgoing_signed_at: "2026-10-08T07:00:00+00:00" }] };
```

Then find:

```js
      api.handoverColleagues.mockResolvedValue(COLLEAGUES);
```

Replace with:

```js
      api.handoverColleagues.mockResolvedValue(COLLEAGUES);

      // G4-02: «Yönetici özeti» (screens/ozet) — the units' waiting handovers.
      api.pendingHandovers.mockResolvedValue(PENDING_SWEEP);
```

Then find:

```js
  // G4-01 — «Cihaz & Veri Akışı»: the device page's sections on a ward with a silent, a vanished and a stale-channel
```

Replace with:

```js
  // G4-02 — «Yönetici özeti»: the sweep's report is the heatmap's (no figures, no days, no kinds); here a whole one, so
  // the quality box's figures, its daily bars and its kinds are drawn, beside the cards and the units table.
  it("the summary page's keys resolve on its cards, its quality box and its units table", async () => {
    const mounted = await openAt("/ozet", (api) => {
      api.alarmQuality.mockResolvedValue({ episodes: 3, answered: 2, unanswered: 1, escalated: 1, pending: 0,
        answered_rate: 0.6667, median_response_sec: 75, p90_response_sec: 75, days: 7, truncated: false, window_from: null,
        per_kind: [{ kind: "news2", episodes: 3, answered: 2, escalated: 1, median_response_sec: 75 }],
        per_day: [{ date: "2026-10-07", episodes: 3 }], noisiest_beds: [], per_patient_hour: [] });
    });
    expect(screen.getByRole("heading", { level: 2, name: "Unudulan işlər" })).toBeInTheDocument();     // ozet.cards.title
    expect(screen.getByRole("table", { name: "Şöbələr, indi" })).toBeInTheDocument();                 // ozet.units.caption
    expect(screen.getByText("07.10: 3 epizod")).toBeInTheDocument();                                  // ozet.q.dayCount
    expect(screen.getByText("Şöbəsi bəlli olmayan")).toBeInTheDocument();                            // ozet.units.unplaced
    expect(rawKeys(document.body)).toEqual([]);
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
    act(() => { mounted.board.clear(); });
  });

  // G4-01 — «Cihaz & Veri Akışı»: the device page's sections on a ward with a silent, a vanished and a stale-channel
```

(The sweep's board cards sit on unit `REA-01`, which the ward's tree does not hold, so the «Şöbəsi bəlli olmayan» row is drawn.)

- [ ] **Step 3: Run them to see them fail**

Run: `cd /c/tmp/g4-ozet/dashboard && npx vitest run src/live/shell/routes.test.js src/live/rawKeys.test.jsx src/reachable.test.js`
Expected: FAIL.
- `routes.test.js`: the three new tests fail (`ozet()` is undefined).
- `rawKeys.test.jsx`: «the summary page's keys resolve…» fails, because `/ozet` is «no such page» and the heading is not found.
- `reachable.test.js`: «keeps no module the page cannot reach» lists the `screens/ozet` files.

- [ ] **Step 4: Add the route**

In `dashboard/src/live/shell/routes.js`, find:

```js
const DevirScreen = lazyScreen(() => import("../screens/devir/DevirScreen.jsx"), "DevirScreen"); // G2-B3b
```

Replace with:

```js
const DevirScreen = lazyScreen(() => import("../screens/devir/DevirScreen.jsx"), "DevirScreen"); // G2-B3b

const OzetScreen = lazyScreen(() => import("../screens/ozet/OzetScreen.jsx"), "OzetScreen"); // G4-02
```

Then find:

```js
  devir: DevirScreen, // G2-B3b — «Vardiya devri»: to countersign, mine, a new handover with its D-Ö-D-Ö note
```

Replace with:

```js
  devir: DevirScreen, // G2-B3b — «Vardiya devri»: to countersign, mine, a new handover with its D-Ö-D-Ö note

  ozet: OzetScreen, // G4-02 — «Yönetici özeti»: the cards, alarm quality, the units as of now; no patient
```

Then find:

```js
    perms: ["handover.sign"], work: true, nav: "main" }),
```

Replace with:

```js
    perms: ["handover.sign"], work: true, nav: "main" }),

  // G4-02 (spec D3) — «Yönetici özeti»: for whoever holds `summary.view` — the system administrator, by rule; another
  // group only once a hospital gives it the key. Not a work screen: it is read, not worked in. After the handover
  // screen, so nobody's home moves.
  route({ id: "ozet", path: "/ozet", icon: "chart", labelKey: "ozet.nav", shortKey: "ozet.navShort",
    perms: ["summary.view"], work: false, nav: "main" }),
```

- [ ] **Step 5: Run the route, sweep and boundary tests to see them pass**

Run: `cd /c/tmp/g4-ozet/dashboard && npx vitest run src/live/shell/routes.test.js src/live/rawKeys.test.jsx src/reachable.test.js src/live/boundaries.test.js src/live/shell/Shell.test.jsx src/routing.test.js`
Expected: `Test Files 6 passed (6)`, `Tests 147 passed (147)`:
- `routes.test.js`: 41;
- `rawKeys.test.jsx`: 16, its sweep now visiting `/ozet` with exactly one h1 and no raw key;
- `reachable.test.js`: 3;
- `boundaries.test.js`: 8, because nothing in the shell, the signals or the board store imports the page;
- `Shell.test.jsx`: 55;
- `routing.test.js`: 24.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/g4-ozet && git add dashboard/src/live/shell/routes.js dashboard/src/live/shell/routes.test.js dashboard/src/live/rawKeys.test.jsx && git commit -m "feat(shell): G4-02 the /ozet route after devir (summary.view, chart, not a work screen); routes.test pins the table's tail once; the rawKeys sweep reads the page" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/live/shell/routes.js dashboard/src/live/shell/routes.test.js dashboard/src/live/rawKeys.test.jsx
```

The dashboard lane is done: report the five shas to the coordinator.

---

## Task 10 (docs, after both lanes): the guide, §3.24

**Files:**
- Modify: `docs/homunculus-rehber-TR.md` (§3 «İzin», line 356; before the `---` that precedes «## 4.», after line 2080)

- [ ] **Step 1: The permission count**

In `docs/homunculus-rehber-TR.md`, find:

```markdown
- *Homunculus'ta:* 22 sabit anahtar (`board.view`, `alerts.ack`, `users.manage`, `groups.manage`…).
```

Replace with:

```markdown
- *Homunculus'ta:* 27 sabit anahtar (`board.view`, `alerts.ack`, `users.manage`, `groups.manage`…; en yenisi
  `summary.view`, «Yönetici özeti», §3.24).
```

(The guide said 22 since G1; the catalogue had 26 before this slice and has 27 after it.)

- [ ] **Step 2: §3.24**

Find:

```markdown
- **Kaynak:** `docs/superpowers/specs/2026-11-11-g4-cihaz-veri-akisi-design.md`.

---

## 4. "Neden bunu kullanmıyoruz" köşesi
```

Replace with:

```markdown
- **Kaynak:** `docs/superpowers/specs/2026-11-11-g4-cihaz-veri-akisi-design.md`.

### 3.24 «Yönetici özeti»: hastane bir bakışta (Grup 4 · G4-02)

- **Ne:** Sol raydaki **«Yönetici özeti»** sayfası (`/ozet`; Azerbaycanca «Rəhbər xülasəsi», Rusça «Сводка для
  руководства», İngilizce «Management summary»; telefonun dar rayında «Özet»). Hastanenin şu anki durumu ve alarm
  kalitesi tek sayfada, yalnız gerçek verilerden. Sayfa yalnız okur ve hiçbir yerde hasta adı ya da kimliği göstermez.
  (§3.23 Eczane dilimine ayrıldı; bu yüzden numara atlıyor.)
- **Durum:** kodda (`feat/g4-yonetici-ozeti`); main'e ve hastane sunucusuna sahibin sözüyle çıkar.
- **Kim görür:** yeni yetki `summary.view` («Yönetici özetini görür») olan. Varsayılan gruplardan hiçbirinde yok;
  Sistem Yöneticisi her yetkiyi kural gereği taşıdığından yalnız o görür, göç (migration) gerekmedi. Başka bir gruba
  (ör. başhekim) Yönetim › Roller ve yetkiler'den kodsuz verilebilir; o grup bir kaynağın kendi yetkisini taşımıyorsa
  o sütun ya da kart sayı yerine «yetki yok» der. Rayda «Vardiya devri»nden sonra gelir; kimsenin giriş sayfası
  değişmedi (Sistem Yöneticisi yine «Yataklar»a düşer). Bir çalışma ekranı değildir: yalnız `summary.view` taşıyan
  bir hesap bununla oturum açamaz, ona bir çalışma yetkisi de (ör. pano) verilmelidir.
- **Sayfanın sırası (yukarıdan aşağı):**
  1. **Başlık:** «Yönetici özeti», son tam okumanın saati («10:42 itibarıyla»: okuyabildiği her kaynağın birlikte
     yanıt verdiği son tur) ve «Yenile» düğmesi.
  2. **«Unutulan işler»:** dört kart; her biri bir sayı, neyi saydığını söyleyen bir satır ve kaynağının okunduğu saat.
     - **«Yanıtsız kalan alarm · {dönem}»:** seçilen dönemde hiç yanıtlanmamış ve en az 10 dakikalık alarm olayları.
       10 dakika motorun rapor sınırıdır (5 dakikalık eskalasyonun iki katı); kart bunu söyler.
     - **«Karşı imzası bekleyen devir»:** devredenin imzaladığı, devralanın henüz karşı imzalamadığı devirler ve
       «en eskisi {n} dk / saat / gün önce». Bu durum kendiliğinden kapanmaz; en eskisi günler öncesi olabilir.
     - **«Geciken iş»:** şimdi, bu nöbet: sunucunun geç dediği el görevleri ve zamanı geçmiş vital ölçümler.
     - **«Sessiz monitör»:** şimdi: sessiz ya da haber alınamayan monitörler («Cihazlar» sayfasının kurallarıyla) ve
       «en uzunu {n} dk». «1 saatten uzun sessiz» gibi bir eşik yok: kaynağı yok.
  3. **«Alarm kalitesi»:** dönem seçici «Bugün» · «7 gün» · «30 gün» (açılışta 7 gün); bu kutuyu ve ilk kartı
     değiştirir. «Bugün» takvim günü değil, son 24 saattir; kutu ve kart bunu «son 24 saat» diye yazar. Hastane
     geneli, denetim kaydından: alarm olayı; yanıtlanan ve oranı (hiçbir olay yerleşmediyse «henüz yerleşen yok»);
     yanıt süresinin ortancası ve p90'ı; eskale edilen; yanıtsız kalan; bekleyen (10 dakikası dolmamış). «Günlük
     alarm sayısı»: her gün için bir çubuk ve sayısı; günler UTC takvimine göredir; «geçen haftaya göre» eğilimi yok.
     Altında türe göre küçük bir tablo. Sunucunun okuma sınırı aşılırsa kutu bunu ve sayılan dönemin başını söyler.
     Kutu yalnız sayfa açılınca ve dönem değişince okunur; kendiliğinden ya da «Yenile» ile yenilenmez (sunucu
     dönemin her olayını denetim kaydından yeniden kurar). Prototipteki «3 dk içinde yanıt» ve «Hatalı olarak
     işaretlenen» yok: kaynakları yok. Kutu, denetim kaydı yetkisi (`audit.view`) ve bütün hastaneyi kapsayan bir
     kapsam ister; yoksa bunu söyler.
  4. **«Birimler»:** yapıdaki her birim için bir satır, şimdi: doluluk («{dolu} / {kullanılabilir} dolu»; sıfırdan
     büyükse rezerve, kullanım dışı ve bakımdaki yataklar, Doluluk ekranının sözcükleriyle), yanıt bekleyen alarm
     (kritik ve yüksek ayraç içinde), geciken iş, karşı imzası bekleyen devir (en eskisinin yaşıyla), sessiz monitör.
     Kapalı bir birim «kapalı» diye yazılır. Yatağı olmayan ya da yapıda bulunmayan bir birimdeki hasta ve monitörler
     en alttaki **«Birimi belli olmayan»** satırında toplanır; sayacak bir şey yoksa bu satır yazılmaz.
- **Her sayı ya gerçektir ya da neden yok olduğunu söyler.** Henüz okunmamış, okunamamış, güncel olmayan ya da
  yetkiniz olmayan bir kaynak, kendi sütununda ya da kartında «—» ve kısa nedeniyle yazılır: «okunuyor…»,
  «okunamadı», «pano güncel değil», «yetki yok», «veri zinciri kesik», «bilinmiyor», «monitör şeridi kapalı». Asla 0
  yazılmaz. Sıfırı yalnız güncel bir yanıt söyler (Karar 18): yanıt bekleyen alarm sütunu yalnız canlı pano CANLI
  iken, sessiz monitör sütunu yalnız cihaz panosu güncelken sayar. Okuması başarısız olan bir kaynağın son sayısı da
  bugünün sayısı gibi gösterilmez.
- **Ne zaman okunur:** canlı pano ve cihaz panosu uygulamanın kendi sürekli okumalarıdır, sayfa onlara bakar. Yapı,
  görevler ve bekleyen devirler sayfa açılınca, «Yenile»de ve sayfa görünürken her 60 saniyede bir okunur.
- **Sunucuda iki küçük değişiklik:**
  - yeni `GET /handovers/pending` (`summary.view`): birim başına karşı imza bekleyen devir sayısı ve en eskisinin imza
    zamanı; yalnız sayılar ve zamanlar (hasta, not ya da kişi yok); çağıranın kurumu ve birimleriyle sınırlı;
  - `GET /tasks` her hastanın birimini ve yatak anahtarını artık kartın kendi yerinden okuyor (önceden hep boştu; bir
    düzeltme).
- **Bu dilimde olmayanlar:** birim birim alarm kalitesi; «Rapor al» ya da dışa aktarma; «Günlük özet hazır»
  bildirimi; geçmiş (sistem yeniden başlamadan önceki cihaz sessizliği, geçmiş vital ölçüm gecikmeleri); prototipin
  kaynaksız sayıları; sorumlu hemşire, denetçi ya da başhekim için varsayılan erişim (göç ister); «Kalite
  göstergeleri» ekranı.
- **Kaynak:** `docs/superpowers/specs/2026-11-11-g4-yonetici-ozeti-design.md`; plan
  `docs/superpowers/plans/2026-11-11-g4-yonetici-ozeti.md`.

---

## 4. "Neden bunu kullanmıyoruz" köşesi
```

- [ ] **Step 3: Check it**

Run: `cd /c/tmp/g4-ozet && grep -n "^### 3.2[2-4]\|^## 4\.\|27 sabit anahtar" docs/homunculus-rehber-TR.md`
Expected:
- `### 3.22 …`, then `### 3.24 «Yönetici özeti» …`, then `## 4. …`, in that order;
- one `27 sabit anahtar` line;
- no `### 3.23`.

- [ ] **Step 4: Commit**

```bash
cd /c/tmp/g4-ozet && git add docs/homunculus-rehber-TR.md && git commit -m "docs(rehber): §3.24 «Yönetici özeti» (G4-02) — who sees it, the cards, alarm quality and its period, the units, «—» with a reason; 27 permission keys" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- docs/homunculus-rehber-TR.md
```

---

## Task 11: the gates (after Tasks 1–10)

**Files:** none. A failure goes back to the owning lane as a fix commit (pathspec, Co-Authored-By line); then the failed chunk is run again.

- [ ] **Step 1: The whole no-DB engine suite, in foreground chunks**

Run from `C:\tmp\g4-ozet\homunculus-engine`. Each line is one tool call; never run `test_infinity_vm_pilot.py`.

```bash
cd /c/tmp/g4-ozet/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_[a-d]*.py -q -p no:cacheprovider
cd /c/tmp/g4-ozet/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_[e-l]*.py --ignore=tests/test_infinity_vm_pilot.py -q -p no:cacheprovider
cd /c/tmp/g4-ozet/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_[m-z]*.py tests/rules tests/scoring tests/tenant -q -p no:cacheprovider
```

Expected, no failure and no error:

| Chunk | Passed | Skipped |
|---|---|---|
| `a–d` | 1285 | 755 |
| `e–l` | 1717 | 110 |
| `m–z` and the sub-folders | 942 | 363 |
| **Total** | **3944** | **1228** |

Before this slice the totals were 3941 passed and 1222 skipped. The slice adds 3 no-DB tests and 6 DB-backed ones, which skip here. Each chunk takes up to about 2 minutes.

- [ ] **Step 2: The DB-backed tests that touch handovers, tasks, the scope and the guards, on the throwaway Postgres**

One call each:

```bash
docker run -d --rm --name ozet-pg -p 127.0.0.1:56446:5432 -e POSTGRES_PASSWORD=ozet -e POSTGRES_DB=ozet postgres:16
timeout 60 bash -c 'until docker exec ozet-pg pg_isready -U postgres -q; do :; done' && docker exec ozet-pg createdb -U postgres ozet_test
cd /c/tmp/g4-ozet/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:ozet@127.0.0.1:56446/ozet_test "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_handover_api.py tests/test_tasks_postgres.py tests/test_unit_scope.py tests/test_route_permissions.py tests/test_tenant_isolation.py -q -p no:cacheprovider
docker stop ozet-pg
```

Expected: no failure, no error. `test_handover_api.py` runs 40 tests with none skipped: 34 before the slice plus the six G4-02 ones. Report the line `N passed, M skipped` as printed. Stop the container even if a test failed.

- [ ] **Step 3: The whole dashboard suite**

Run: `cd /c/tmp/g4-ozet/dashboard && npx vitest run` (foreground, timeout 600000).
Expected: `Test Files 156 passed (156)` and `Tests 4184 passed (4184)`.
- Files: 153 before this slice, plus `ozet.strings.test.js`, `ozet.test.js` and `OzetScreen.test.jsx`.
- Tests: 4144 before, plus 40.

- [ ] **Step 4: The build**

Run: `cd /c/tmp/g4-ozet/dashboard && npx vite build`
Expected: `✓ built in …`, with no error. The page is its own chunk, `assets/OzetScreen-*.js`, about 18 kB. `dist/` is git-ignored (`dashboard/.gitignore`).

- [ ] **Step 5: Nothing stray**

Run: `cd /c/tmp/g4-ozet && git status --short && git log --oneline 1cc05c47..HEAD`
Expected: a clean tree. The log holds the plan's commit and the ten task commits (four engine, five dashboard, one docs), plus any fix commits, each named.

- [ ] **Step 6: Report** to the coordinator:
- the shas and the gate counts;
- what a reviewer should eyeball in a browser:
  - the page at 390 px: the four cards wrap, and the units table scrolls inside its frame;
  - the rail at phone width with «Özet» / «Xülasə» / «Сводка» / «Summary»;
  - the az, ru and en wording, which await a native speaker before the pilot.

Do not push, do not merge, and send nothing to the VM.

---

## Self-review

**Spec coverage.**
- §1 (what the system has):
  - `/alarm-quality`: Task 8, the box and card 1, with `qualityView` in Task 7;
  - the live board's `needsAnswer` by `identity.unit_id`: Task 7 `boardSource`/`waitingByUnit`;
  - `/tasks` `late` and the vital `late`: Task 7 `lateOf`, Task 2 for the unit;
  - the pending handovers: Task 3;
  - occupancy from `/tenant/structure`: Task 7 `unitsOf` (Doluluk's `unitCounts`), Task 8 through StructureProvider;
  - the silent monitors: Task 7 `shadowSource` (G4-01's rules).
- D1 (scope): cards, units, alarm quality over 1, 7 and 30 days, waiting handovers. No migration. No per-unit alarm quality.
- D2 and D3:
  - `summary.view` in no default group, held by the system group by rule (Task 1, test); mirrored in `catalogue.js`, `admin.testutil.js` and the four-language `perms.js` (Task 5).
  - The route after `devir`, `work: false`, `nav: "main"`, icon `chart`; `hospital_admin`'s home unchanged (Task 9; N1, N2).
- D4:
  - `GET /handovers/pending` with its shape, units with none left out, scope, counts and times only, OUTGOING_SIGNED never expiring (Task 3, six DB tests: permission, per-unit counts and oldest, OPEN/COMPLETED/EXPIRED excluded, no patient/note/person, scope, tenant isolation; N3, N4);
  - the `/tasks` fix with a test (Task 2; N16);
  - route tables 73, `test_tenant_isolation` by its own rule, nginx's `~^/handovers/pending$ $uri;` before the catch-all (Task 4).
- D5:
  - header «HH:MM itibarıyla» and «Yenile» (Task 8; N9);
  - the four cards with their words, sources and times, card 1 naming the 10 minutes and the period, card 2 the oldest's age, card 4 the longest silence and no 1-hour threshold (Tasks 5, 7, 8);
  - alarm quality: the period switch drives the box and card 1; the figures; a null `answered_rate`; `per_day` bars with dates and no trend; `per_kind`; the truncated note; no «3 dk» and no «Hatalı»; read on open and on a period change only (Tasks 7, 8; N11–N13, N15);
  - units: every column, the closed unit, «Birimi belli olmayan» (Tasks 7, 8; N5, N14);
  - «—» with a reason, never 0; Decision 18; «yetki yok» per source; the 60 s poll while visible, `SUMMARY_POLL_MS` (Tasks 7, 8; N7, N8, N10).
- D6: nothing out of scope is built: no per-unit quality, no export or notification, no history, no default access for other groups, no «Kalite göstergeleri».
- §4 Tests:
  - engine: permission, per-unit counts and oldest, exclusions, scope, no patient, tenant isolation (Task 3); the `/tasks` fix (Task 2); route tables, nginx map, redaction (Task 4); `summary.view` catalogue, rule and no group (Task 1);
  - dashboard: pure `ozet.js` with a fixed clock (join, «Birimi belli olmayan», «—» with reason, oldest age, cards) in Task 7; `OzetScreen` (period switch, truncated read, null rate, «yetki yok», Decision 18) in Task 8; `routes.test.js`, `rawKeys`, `strings`, the catalogue drift test in Tasks 5 and 9;
  - gates: Task 11.

**Dry run.**
- When the plan was written, its edits were applied in task order to a scratch copy of the tree at `1cc05c47`, outside the worktree. Every find block matched exactly once: the Edit tool refuses an anchor that is not unique.
- The failing step was checked where it can fail without a DB:
  - Task 1: 4 failed;
  - Task 2: `None == 'unit-adult'`;
  - Task 3: the `unit_clause` ImportError;
  - Task 4: 2 failed;
  - Task 5: the drift tests and the namespace;
  - Task 6: `pendingHandovers is not a function`;
  - Tasks 7–9: missing modules or route.
- On the final state:
  - the engine's guard suites gave 150 passed / 134 skipped;
  - the whole no-DB engine suite gave the totals in Task 11 Step 1. Eight tests that need a git repository or the Obsidian vault failed only because the scratch copy has neither (`test_dev_waves_bench`, `test_dev_waves_replay`, `test_docker_build_context`, `test_infinity_release` ×3, `test_infinity_transport`, `test_news2_bands`); all eight pass in the worktree and are counted as passed above;
  - the dashboard gave 156 files and 4184 tests passed;
  - `vite build` succeeded, with `OzetScreen` at 18.1 kB.
- The **DB-backed** tests of Task 3 (six) and the DB half of Task 11 were **not run** when the plan was written. Their query was compiled for Postgres (`select … FROM handovers JOIN units … JOIN sites … GROUP BY units.id, units.name`), and their collection was checked (40 collected, skipped without a DB). Task 3 Step 6 and Task 11 Step 2 are their first runs.

**Placeholder scan.** No TBD and no "similar to". Every step that changes code shows the code; every run states its command and expected result.

**Type and name consistency.**
- Engine:
  - `PERMISSIONS["summary.view"]`;
  - `unitscope.unit_clause(scope, *, unit_id) -> ColumnElement | None`;
  - `PendingUnit(unit_id, unit_name, pending, oldest_outgoing_signed_at)`, `PendingHandovers(units, generated_at)`;
  - `SUMMARY_VIEW`; `pending_handovers()` at `GET /handovers/pending`.
- Dashboard API: `api.pendingHandovers()`; the `fakeApi` mock `pendingHandovers`.
- `ozet.js` exports:
  - constants `SUMMARY_POLL_MS`, `PERIODS`, `DEFAULT_PERIOD`, `NO_UNIT`, `WHY`;
  - sources: `okSource`, `noSource`, `rightsOf`, `readSource`, `structureSource`, `boardSource`, `shadowSource`;
  - joins and counts: `waitingByUnit`, `silentByUnit`, `longestMinutes`, `lateOf`, `lateByUnit`, `pendingByUnit`, `ageOf`, `unitsOf`;
  - the page model: `summarise({tree, occupancy, board, tasks, pending, shadow, quality}) → {cards: {unanswered, pending, late, silent}, rows: [{key, name, closed, occupancy, waiting, late, pending, silent}] | null, unplaced}`;
  - the quality box: `durationOf`, `dayOf`, `qualityView`.
- `useSummaryReads({store, rights, reloadStructure, everyMs}) → {tasks, pending, fullAt, busy, refresh}`; `useQuality({store, may, period})`.
- `OzetScreen` reads `useSession`, `useBoard`, `useSnoozeClock`, `useShadow` and `useStructure`. Every `ozet.*` key it uses exists in `strings/ozet.js` in four languages; the `doluluk.*` keys it reuses already exist (`occupied`, `counts.reserved`, `counts.outOfService`, `counts.maintenance`, `unitClosed`, `noUnits`).

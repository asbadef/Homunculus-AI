# TRƏS-01 · F0 Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The infrastructure of the national e-health feed (TRƏS-01, phase F0 of seven): the install's lock `TRES_EGRESS`, each tenant's settings with its two accounts (the password encrypted at rest and write-only at the door), the delivery ledger, the platform's HTTP client, an in-process stand-in of the platform, the skeleton of the rounds, the permission `tres.manage`, migration 0020 and the Yönetim › TRƏS tab. **No FHIR resource is built in this phase**: after F0 the product behaves exactly as before unless an administrator opens Yönetim › TRƏS, and nothing is sent anywhere, because no package builder exists yet (F1–F6).

**Architecture:** Spec `docs/superpowers/specs/2026-11-11-tres-esaglik-gonderim-design.md` (9a1c3ab8). A new package `homunculus/tres/` in the admission/ORM world (async SQLAlchemy, keyed by the tenant's UUID), built on the pattern of `homunculus/protocol/`: `egress.py` (the install's lock, read once into `app.state.tres_egress`), `client.py` (the session and the six calls of spec §4 over `httpx.AsyncClient`, as `api/infinity_waves.py`'s hub client), `models.py` (`tres_settings`, `tres_deliveries`), `ledger.py` (one resource to the platform, its outcome on its row; change detection by a keyed digest), `worker.py` (a round over the tenants that are on; what is sent comes from an injected `PackageSource`, which yields nothing in F0; started by the lifespan only when the lock is open), `errors.py` / `schemas.py` / `router.py` (`GET|PUT /admin/tres/settings`, `POST /admin/tres/test`, all `tres.manage`). Tests talk to `tests/fake_tres.py`, a stand-in that enforces what spec §4 states. Dashboard: three API client methods, the `tres` i18n namespace, `screens/admin/TresTab.jsx`, its line in `AdminScreen.jsx`, and the `/admin` route opened to `tres.manage`.

**Tech Stack:** Python 3.12 (FastAPI, async SQLAlchemy 2.1 + asyncpg, Alembic, httpx 0.28, pydantic 2), pytest + pytest-asyncio (`asyncio_mode = auto`); React 18 + Vite + vitest + Testing Library; the shell's Tailwind tokens.

**Spec amendments this plan makes (recorded in Task 15):**
1. **One plan per phase** (§10 said «one plan»): F0…F6, each its own plan document and its own gate. This is F0.
2. `tres.manage` is the catalogue's **29th** key, not the 28th (D23): `pharmacy.view` (G3-04) reached main first.
3. The migration is **`0020_tres.py`**, `down_revision = "0019"` (D26 named 0019 as Eczane's; it is on main). G4-03 (`feat/g4-kalite`, not on main) also claims 0020: whoever reaches main second renames to the next number.
4. **No permission row** is written by the migration (D26, §9 «the permission rows once»): `tres.manage` is in no default group, and the system group holds every key by rule at token issuance — `summary.view`'s precedent. The migration test asserts that no row is written.
5. F0 creates **two** of D26's nine tables; the same migration file is extended by F1–F5 while the branch is unmerged.
6. `TRES_EGRESS` is read in `create_app` from `os.environ` into `app.state.tres_egress` (as the wave feed reads its settings in `register`), not in `api/prodserver.py` (§7).
7. The refusal codes live in **`tres/errors.py`**, not `admission/errors.py` (a dashboard test holds that file one-to-one to `ADMISSION_CODE_KEYS`). Codes §6 did not list: `tres_mode`, `tres_environment`, `tres_settle_hours`, `tres_types`, `tres_base_url`, `tres_field_length`, `tres_account_incomplete`.
8. The audit label of `tres.settings` (dashboard `denetim.js`) lands **in the same task as the route**: `engineTypes.test.js` reads the engine and holds the label list to it both ways. A save that changes nothing writes no audit row (D24).
9. **Worker.** A `PackageSource` yields *packages* — async callables handed a `Sender` — not resources: a reference needs the platform's id of what was sent before it (D8), so the package reads each ledger row before it builds the next resource. The 300 ms spacing is a hook on the client (`TresClient.pace`) that the worker sets, so it holds between any two HTTP requests, the token's included.
10. **Ledger.** `deliver` also takes `now` and `force`; it honours the 30-minute wait and `stuck` for an unchanged payload (D21) and starts the count again when the payload changes; in `validate` mode an unchanged payload that is already `validated` or `sent` is not validated again; a failed payload's digest is stored; `last_error` is cut to 500 characters **and** 1000 UTF-8 bytes, so its ciphertext fits `VARCHAR(1536)`.
11. **Client.** A failure with no answer (timeout, refused connection) is a `TresError` with `status` None, named by its exception class and never by its text (which may carry the URL); `validate` treats a 2xx OperationOutcome that holds an `error`/`fatal` issue as a refusal; a 429 from the token route raises like any other.
12. `POST /admin/tres/test` is allowed in the mode `off` (an administrator tests before turning the feed on) and is not audited (D24 lists no such event; it writes nothing).
13. `/admin` opens for `tres.manage` by adding the key to the route's `perms` (§8). Since `/admin` is a work screen, a session holding `tres.manage` alone can sign in, and `/admin` is its home.
14. `rawKeys.test.jsx` exempts audit event codes from its source sweep: `tres.settings` is namespace-shaped once the `tres` namespace exists (as `tres.manage` is among the permission keys, which were exempt already).
15. The Turkish guide's section is **§3.25** (3.23 and 3.24 are taken).
16. **The build.** F0's strings take the shared i18n chunk past Vite's 500 kB note (489 174 → 501 634 characters, measured on a scratch copy). It is not fixed here: splitting the catalogue is a slice of its own and the controller's decision (Task 14, Step 4).
17. Two new open items: **O13** (should a 429 or a dead line count towards `stuck`?) and **O14** (what a `validate` round can send after the Patient, when nothing is stored to refer to).

**After the final review (recorded in spec §13.2–13.3):** the review of F0 found no Critical issue and five Important ones (outages counted as attempts and re-logged per package; no single writer per ledger key; `find` trusted the search's first entry; `base_url` could redirect the stored credentials; the switches were held by the callers). They are fixed in `7d508d2c`…`de770d78`, with `TRES_HOSTS`, the guarded factory `egress.open_client`, and the index `ix_tres_deliveries_admission_id` added to 0020. A second round (`4ab325d0`…`9a306d44`) made four changes:
- `find` refuses a search answer it cannot trust;
- a 500 counts against its resource;
- a refused login parks the tenant (`session_refused_at`, added to 0020);
- it fixed nine minor findings.

O13 is closed («no»); O15–O20 are new.

**Gates (measured when the plan was carried out):**
- **Baseline** (main `331df704`): engine 4009 passed / 1318 skipped; dashboard 165 files / 4448 tests.
- **After F0** (`ad0b115c`): engine 4105 passed / 1376 skipped (no-DB); dashboard 166 files / 4475 tests.
- **After the review's fixes** (`de770d78`):
  - engine 4153 passed / 1404 skipped / 0 failed (no-DB, in chunks, `test_infinity_vm_pilot.py` excluded);
  - Postgres: `test_tres_ledger` 30, `test_tres_settings` 59, `test_tres_worker` 22, migrations 0020 + 0010 parity 8, client/fake/egress/models/compose/route permissions 130 — all passed;
  - dashboard 166 files / 4477 tests;
  - build `precache  68 entries (1536.07 KiB)`, shared i18n chunk `Toast-*.js` 502.56 kB (500 kB note: yes; accepted for F0 by the controller).
- **After the second review round** (`9a306d44`, approved):
  - engine 4199 passed / 1428 skipped / 0 failed (no-DB);
  - Postgres:
    - `test_tres_worker` 34 passed;
    - `test_tres_settings` 66 passed;
    - `test_tres_ledger` 38 passed;
    - the migrations 0020 + 0010 parity 8 passed;
    - client, fake, egress, models, compose and route permissions 173 passed;
  - dashboard 166 files / 4481 tests;
  - build `precache  68 entries (1538.41 KiB)`, shared i18n chunk `Toast-*.js` 504.06 kB (500 kB note: yes).
- **Walk on the local stack** (Task 16, Step 2): not done. This session had no browser, and the owner's local check is listed in the hand-over.

---

## Ground rules (read before Task 0)

- **Worktree:** `/c/tmp/tres` (branch `feat/tres-esaglik`; the spec commit is `9a1c3ab8`, on `main` `331df704`; this plan is the commit above it). Work ONLY here. Never touch `c:\Users\User\Desktop\Project\Homunculus AI`. Never `git stash`, never switch branches, never rebase. Commit with explicit pathspecs only — every `git add` in this plan names its files.
- **Engine commands** run from `/c/tmp/tres/homunculus-engine`; one file or a few:
  ```
  PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q <files> 2>&1 | tail -3
  ```
  - Whole no-DB suite: the same with `-p no:warnings tests --ignore=tests/test_infinity_vm_pilot.py` in place of `<files>`.
  - **Never run `tests/test_infinity_vm_pilot.py`** (it hangs). **Never set or export `DATABASE_URL`.**
  - Postgres tests: put `TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test` in front of `PYTHONPATH=…`, **on the command line only**. The container `homunculus-test-pg-56` is up. The database is shared with other sessions and serialised by an advisory lock: a run may print `waiting for another test run …` and wait — that is not a hang. A DB test takes about 4 s (the schema is rebuilt per test).
  - Without `TEST_DATABASE_URL` the DB-backed tests are **skipped**, not failed; every step says which result line to expect with and without it.
- **Dashboard commands** run from `/c/tmp/tres/dashboard` with the local binaries, never `npx`: one file or a few `./node_modules/.bin/vitest run <paths>`; the whole suite `./node_modules/.bin/vitest run`; the build `./node_modules/.bin/vite build` (expect a `precache  N entries` line and no error; about Vite's `larger than 500 kB` note see Task 14, Step 4). A `not wrapped in act(...)` warning is not a failure. The dashboard's tests run in Azerbaijani (the default language): the texts the tests look for are the `az` strings.
- **Every test command runs in the FOREGROUND.** Never background a test run and wait for it: agents that did slept for hours. If a command needs more than the tool's time limit, split it (by directory or by file) — do not background it.
- **Style:** every new Python file starts with a `# homunculus-engine/src/…` (or `# homunculus-engine/tests/…`) path comment and a docstring that says what and why (as `src/homunculus/protocol/router.py`); every new JSX/JS file starts with a `// src/live/…` path comment. **Synthetic data only** in tests and fixtures (CLAUDE.md hard rule 6): names like `Sentetik Ayşe`, ids like `hmn-p-0001`, the account `sentetik` / `gizli-parola`, hosts under `example.az` or `tres.test`. Nothing from the reference repository named in spec §2 is copied — not a line, not a fixture.
- **Merge seams** take ONE new line or block with a blank line either side, and the existing gaps stay: `shell/routes.js`, `AdminScreen.jsx` (the `lazyScreen` lines, `TABS`, `TAB_SCREENS`), `i18n/catalog.js`, `auth/permissions.py`, `admin/catalogue.js`.
- **Line endings:** this checkout has `core.autocrlf=true` (files are CRLF on disk, LF in git). Edit with the Edit tool; a new file may be written with LF. `warning: LF will be replaced by CRLF` from `git add` is not an error.
- **Edits are given as «replace this … with this».** The first block of each pair occurs exactly once in the file. If it does not match, STOP and read the file: another lane has changed it, and the plan's edit must be re-placed by hand next to the same neighbours — never guessed.
- **«Append at the end of the file»** means: after the file's last line, leave the blank lines the file's own style puts between top-level blocks (two in Python, one in JavaScript), then the block as given.
- **Migration numbering (spec D26, amended):** this slice's migration is `0020_tres.py`, `revision = "0020"`, `down_revision = "0019"` (main's head is `0019_pharmacy_view.py`). G4-03 (`feat/g4-kalite`, not on main) also claims 0020. Whoever reaches main second renames: if at merge time main already holds a 0020, rename ours to the next free number (file name, `revision`, `down_revision`, the test file's name and its revision strings) and tell the controller the same day. **This one migration file is the whole slice's** (D26): F1–F5 add their tables to it while the branch is unmerged; F0 creates only the two tables it has models for.
- **Commits** follow the repository's style — `feat(tres-01): …`, `test(tres-01): …`, `docs(tres-01): …` — and every commit ends with the trailer line `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>` (each commit command below carries it as a second `-m`).
- **The two halves.** Tasks 0–2 and 9 touch both the engine and the dashboard (a dashboard test reads the engine's permission catalogue; another reads the engine's audit event types). Tasks 3–8 and 10 are engine only; Tasks 11–14 are dashboard only and need nothing from Tasks 3–8. If the halves are run by two agents, the second starts after Task 9 is committed.

---

### Task 0: Baseline — the branch, the migration head, `node_modules`, the three numbers

**Files:**
- Create (not tracked, never committed): the junction `dashboard/node_modules`

- [ ] **Step 1: Confirm the worktree, the branch and the head**

Run: `cd /c/tmp/tres && git status -sb | head -3 && git log --oneline -3`
Expected: `## feat/tres-esaglik...origin/feat/tres-esaglik` with no file line under it (clean); the first log line is this plan's commit (`docs(tres-01): plan F0 — infrastructure …`), the second `9a1c3ab8 docs(tres-01): spec — …`, the third `331df704 docs(roadmap, rehber): G3-04 Eczane main'de …`. If the branch was rebased since (other hashes), go on, and write the hashes you see into the baseline line of Step 5.

- [ ] **Step 2: The migration head is 0019, and nothing else here is numbered 0020**

Run: `cd /c/tmp/tres && ls homunculus-engine/alembic/versions | tail -2`
Expected: `0018_care_team_transfer.py` and `0019_pharmacy_view.py`. If a `0020_*.py` is already there, STOP and tell the controller: the migration of Task 6 needs the next number (ground rules).

- [ ] **Step 3: The test database's container is up**

Run: `docker ps --filter name=homunculus-test-pg-56 --format "{{.Names}} {{.Status}}"`
Expected: `homunculus-test-pg-56 Up …`. If it prints nothing, tell the controller before Task 5 — the DB-backed steps need it; do not start a container yourself.

- [ ] **Step 4: `dashboard/node_modules` — the junction to the shared install**

This worktree has no `node_modules`. The shared install is `C:\tmp\homunculus-g1\dashboard\node_modules` (as G2-B1c's plan used it); it is valid here only while the two lock files are the same. In PowerShell:
```powershell
(Get-FileHash C:\tmp\tres\dashboard\package-lock.json).Hash -eq (Get-FileHash C:\tmp\homunculus-g1\dashboard\package-lock.json).Hash
```
Expected: `True`. Then:
```powershell
if (-not (Test-Path C:\tmp\tres\dashboard\node_modules)) { New-Item -ItemType Junction -Path C:\tmp\tres\dashboard\node_modules -Target C:\tmp\homunculus-g1\dashboard\node_modules | Out-Null }
Get-Item C:\tmp\tres\dashboard\node_modules | Select-Object LinkType, Target | Format-List
```
Expected: `LinkType : Junction`, `Target : {C:\tmp\homunculus-g1\dashboard\node_modules}`.

**This is the shared install:** never delete through it, never run `npm install` or `npm ci` while the junction exists, and before this worktree is ever removed unlink it first (`cmd /c rmdir "C:\tmp\tres\dashboard\node_modules"` removes the link only).

If the first command printed `False`, or the shared install does not exist: do NOT make the junction; run `cd /c/tmp/tres/dashboard && npm ci` instead (it reads `package-lock.json`, which is in the repository, and changes no tracked file — check with `git status --short`, which must print nothing).

Then: `cd /c/tmp/tres/dashboard && ls node_modules/.bin/vitest && git status --short`
Expected: the path is printed, and `git status` prints nothing (`node_modules` is ignored).

- [ ] **Step 5: Record the baseline gates**

Run the whole no-DB engine suite (in the foreground; it takes several minutes — if the tool's limit is shorter, run it in two halves, `tests/test_[a-m]*.py` and `tests/test_[n-z]*.py tests/test_[A-Z0-9]*.py`, and add the numbers):
```
cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -3
```
Expected: `N passed, M skipped` and **no** `failed`.

Run the whole dashboard suite:
```
cd /c/tmp/tres/dashboard && ./node_modules/.bin/vitest run 2>&1 | tail -6
```
Expected: `Test Files  F passed (F)` and `Tests  T passed (T)`, no `failed`.

Write the numbers down as one line — `baseline: engine N/M, dashboard F/T` — it goes into Task 1's commit message and is what Tasks 10 and 14 compare against. If either suite fails BEFORE any change, STOP and tell the controller: the baseline is not yours to fix.

---

### Task 1: The permission `tres.manage` — the catalogue and its mirrors

`tres.manage` is the 29th key (spec D23, amended). It is appended after `pharmacy.view`; no default group but the system one holds it, and the system group holds every key by rule, so no migration writes a row for it (as `summary.view`, G4-02). The dashboard mirrors the catalogue (`catalogue.js`), its descriptions (`admin.testutil.js`) and their translations (`perms.js`), and three dashboard tests read the engine's file — so both sides change in this one task. The change set mirrors `pharmacy.view`'s (commits `git log --oneline -3 -- homunculus-engine/src/homunculus/auth/permissions.py`), without its group rows and without its migration.

**Files:**
- Modify: `homunculus-engine/src/homunculus/auth/permissions.py` (the tail of `PERMISSIONS`, ~lines 79–83)
- Modify: `homunculus-engine/tests/test_permissions.py` (`SPEC_KEYS` ~line 32; the count test ~line 36; the order pin ~line 255; one new test at the end)
- Modify: `dashboard/src/live/screens/admin/catalogue.js` (the tail of `PERMISSION_KEYS`, ~lines 48–50)
- Modify: `dashboard/src/live/screens/admin/admin.testutil.js` (the tail of `PERMISSION_TEXTS`, ~lines 122–124)
- Modify: `dashboard/src/live/i18n/strings/perms.js` (after the `pharmacy:` line of each language: ~lines 59, 102, 145, 188)

- [ ] **Step 1: Extend the catalogue test first**

In `homunculus-engine/tests/test_permissions.py` replace
```python
    "pharmacy.view",      # G3-04 Eczane (spec D2): the page, GET /pharmacy
}


def test_the_catalogue_is_exactly_the_specified_twenty_eight_keys():
    assert len(SPEC_KEYS) == 28
```
with
```python
    "pharmacy.view",      # G3-04 Eczane (spec D2): the page, GET /pharmacy
    "tres.manage",        # TRƏS-01 (spec D23): Yönetim › TRƏS, every /admin/tres/* route
}


def test_the_catalogue_is_exactly_the_specified_twenty_nine_keys():
    assert len(SPEC_KEYS) == 29
```
The order pin of `pharmacy.view` says «the last key»; it is no longer the last. Replace
```python
    assert list(PERMISSIONS)[-1] == "pharmacy.view"          # appended after summary.view: the mirrors' order
```
with
```python
    keys = list(PERMISSIONS)
    assert keys[keys.index("summary.view") + 1] == "pharmacy.view"   # appended after summary.view: the mirrors' order
```
And append at the end of the file:
```python
def test_the_national_feed_is_the_system_administrators_alone_by_default():
    """TRƏS-01 (spec D23): `tres.manage` is in no default group; the system group holds it by rule (it
    holds the whole catalogue at token issuance), so no migration seeds it — as `summary.view`. A
    hospital can give it to another group later on the Roles screen."""
    holders = {g["slug"] for g in DEFAULT_GROUPS if "tres.manage" in g["permissions"]}
    assert holders == {"hospital_admin"}
    assert PERMISSIONS["tres.manage"].startswith("Open Yönetim › TRƏS")
    keys = list(PERMISSIONS)
    assert keys[keys.index("pharmacy.view") + 1] == "tres.manage"    # appended after pharmacy.view: the mirrors' order
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_permissions.py 2>&1 | tail -4`
Expected: FAIL — `4 failed, 18 passed`: the count test (`set(PERMISSIONS) == SPEC_KEYS` differs by `tres.manage`), `test_hospital_admin_holds_every_permission`, `test_every_default_group_matches_the_spec_table_exactly` and the new test (its `holders` is empty).

- [ ] **Step 3: Add the key**

In `homunculus-engine/src/homunculus/auth/permissions.py` replace
```python
                     "antibiotic clock, creatinine and the day's fluid balance; read-only",
}
```
with
```python
                     "antibiotic clock, creatinine and the day's fluid balance; read-only",

    # TRƏS-01 — the national e-health feed (spec D23): Yönetim › TRƏS and every /admin/tres/* route.
    # In no default group: the system group holds it by rule, so no migration writes a row for it; a
    # hospital may give it to another group on the Roles screen.
    "tres.manage": "Open Yönetim › TRƏS: the national e-health feed's settings, its account and its "
                   "delivery ledger (every /admin/tres/* route)",
}
```
Nothing else changes in that file: `hospital_admin`'s permissions are `tuple(PERMISSIONS)`, and no other group gets the key.

- [ ] **Step 4: Run the engine's permission and route tests**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_permissions.py tests/test_route_permissions.py tests/test_route_inventory.py 2>&1 | tail -3`
Expected: PASS — `35 passed, 6 skipped` (the six are DB-backed route tests).

- [ ] **Step 5: See the dashboard's mirrors fail**

Run: `cd /c/tmp/tres/dashboard && ./node_modules/.bin/vitest run src/live/screens/admin/catalogue.test.js src/live/screens/admin/admin.testutil.test.js 2>&1 | tail -8`
Expected: FAIL in both files — `PERMISSION_KEYS` no longer equals the backend's keys; the descriptions' count differs.

- [ ] **Step 6: Mirror the key, its description and its four translations**

In `dashboard/src/live/screens/admin/catalogue.js` replace
```js
  "pharmacy.view",
]);
```
with
```js
  "pharmacy.view",

  // TRƏS-01 — the national e-health feed (spec D23): Yönetim › TRƏS and every /admin/tres/* route; in no default
  // group, the system one holds it by rule
  "tres.manage",
]);
```
In `dashboard/src/live/screens/admin/admin.testutil.js` replace
```js
  "pharmacy.view": "Open the Eczane page: per patient in one's own units — vasopressors, the antibiotic clock, creatinine and the day's fluid balance; read-only",
});
```
with
```js
  "pharmacy.view": "Open the Eczane page: per patient in one's own units — vasopressors, the antibiotic clock, creatinine and the day's fluid balance; read-only",
  // TRƏS-01
  "tres.manage": "Open Yönetim › TRƏS: the national e-health feed's settings, its account and its delivery ledger (every /admin/tres/* route)",
});
```
(The description is the engine's, word for word, joined into one line: `admin.testutil.test.js` compares them.)

In `dashboard/src/live/i18n/strings/perms.js`, in each of the four languages, add two lines after the `pharmacy:` line. Turkish (`tr`) — replace
```js
    pharmacy: { view: "“Eczane” sayfasını açar: kendi birimlerindeki hastaların vazopresörlerini, antibiyotik süresini, kreatininini ve günün sıvı dengesini salt okunur görür" },
  },
```
with
```js
    pharmacy: { view: "“Eczane” sayfasını açar: kendi birimlerindeki hastaların vazopresörlerini, antibiyotik süresini, kreatininini ve günün sıvı dengesini salt okunur görür" },
    // TRƏS-01 — the national e-health feed
    tres: { manage: "Ulusal e-sağlık gönderimini (TRƏS) yönetir: ayarlar, hesap ve gönderim kayıtları" },
  },
```
Azerbaijani (`az`) — replace
```js
    pharmacy: { view: "“Aptek” səhifəsini açır: öz şöbələrindəki xəstələrin vazopressorlarını, antibiotik müddətini, kreatininini və günün maye balansını yalnız oxumaq üçün görür" },
  },
```
with
```js
    pharmacy: { view: "“Aptek” səhifəsini açır: öz şöbələrindəki xəstələrin vazopressorlarını, antibiotik müddətini, kreatininini və günün maye balansını yalnız oxumaq üçün görür" },
    // TRƏS-01 — the national e-health feed
    tres: { manage: "Milli e-səhiyyə göndərişini (TRƏS) idarə edir: ayarlar, hesab və göndəriş qeydləri" },
  },
```
Russian (`ru`) — replace
```js
    pharmacy: { view: "Открывает страницу «Аптека»: видит вазопрессоры, срок для антибиотика, креатинин и суточный баланс жидкости пациентов своих отделений — только чтение" },
  },
```
with
```js
    pharmacy: { view: "Открывает страницу «Аптека»: видит вазопрессоры, срок для антибиотика, креатинин и суточный баланс жидкости пациентов своих отделений — только чтение" },
    // TRƏS-01 — the national e-health feed
    tres: { manage: "Управляет передачей в национальную систему э-здравоохранения (TRƏS): настройки, учётная запись и журнал отправок" },
  },
```
English (`en`) — replace
```js
    pharmacy: { view: "Open the “Pharmacy” page: see the vasopressors, the antibiotic window, creatinine and the day's fluid balance of the patients in one's own units, read-only" },
  },
```
with
```js
    pharmacy: { view: "Open the “Pharmacy” page: see the vasopressors, the antibiotic window, creatinine and the day's fluid balance of the patients in one's own units, read-only" },
    // TRƏS-01 — the national e-health feed
    tres: { manage: "Manage the national e-health feed (TRƏS): its settings, its account and its delivery records" },
  },
```

- [ ] **Step 7: Run the dashboard's mirror, strings and roles tests**

Run: `cd /c/tmp/tres/dashboard && ./node_modules/.bin/vitest run src/live/screens/admin/catalogue.test.js src/live/screens/admin/admin.testutil.test.js src/live/i18n/strings.test.js src/live/screens/admin/RolesTab.test.jsx src/live/shell/routes.test.js 2>&1 | tail -6`
Expected: `Test Files  5 passed (5)`, no `failed`. (`RolesTab.test.jsx` holds every key to a translation in every language; `strings.test.js` refuses an Azerbaijani text that equals its Turkish source, and a Russian one without a Cyrillic letter.)

- [ ] **Step 8: Commit** (put Task 0's baseline line in place of `N/M` and `F/T`)

```bash
cd /c/tmp/tres && git add homunculus-engine/src/homunculus/auth/permissions.py homunculus-engine/tests/test_permissions.py dashboard/src/live/screens/admin/catalogue.js dashboard/src/live/screens/admin/admin.testutil.js dashboard/src/live/i18n/strings/perms.js && git commit -m "feat(tres-01): tres.manage — the national feed's key, the 29th, in no default group (the system group holds it by rule); the dashboard's mirrors; baseline: engine N/M, dashboard F/T" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 2: The install's lock — `TRES_EGRESS`

Spec D2 (b): unset, or anything but `on`, means the module opens no connection whatever a tenant's row says. This task gives the switch its one reader (`tres/egress.py`), puts its value on the app (`app.state.tres_egress`, read once in `create_app` from `os.environ` — the way `api/infinity_waves.py` `register` reads the wave settings), passes the variable to the API's container and explains it in `.env.example`. `tests/test_local_compose_env.py` holds the last two to the first: it reads the listed modules' sources for environment names and fails when compose does not pass one or `.env.example` does not explain it.

**Files:**
- Create: `homunculus-engine/src/homunculus/tres/__init__.py`
- Create: `homunculus-engine/src/homunculus/tres/egress.py`
- Test: `homunculus-engine/tests/test_tres_egress.py`
- Modify: `homunculus-engine/src/homunculus/api/app.py` (the import block ~line 89; the `app.state` block ~line 883)
- Modify: `homunculus-engine/tests/test_local_compose_env.py` (`_MODULES` ~line 33; `_KNOWN` ~line 37)
- Modify: `deploy/local/docker-compose.yml` (the api service's `environment:`, after `SCOPE_ENFORCE_UNASSIGNED` ~line 111)
- Modify: `deploy/local/.env.example` (a new block at the end)

- [ ] **Step 1: Write the failing test**

```python
# homunculus-engine/tests/test_tres_egress.py
"""TRƏS-01 (spec D2): the install's lock. `TRES_EGRESS` unset or anything but `on` is closed, and
the app says which it is (`app.state.tres_egress`) from the environment it was built in. No
database, no network."""
from __future__ import annotations

import pytest

from homunculus.api.app import create_app
from homunculus.tres.egress import egress_on


@pytest.mark.parametrize("value", ["on", "ON", " On ", "on\n"])
def test_on_in_any_case_and_with_stray_whitespace_opens_it(value):
    assert egress_on({"TRES_EGRESS": value}) is True


@pytest.mark.parametrize("value", ["", " ", "off", "1", "true", "yes", "open", "onn", "o n"])
def test_anything_else_is_closed(value):
    assert egress_on({"TRES_EGRESS": value}) is False


def test_unset_is_closed():
    assert egress_on({}) is False
    assert egress_on({"TRES_EGRESS_OTHER": "on"}) is False


def test_the_app_is_closed_unless_the_environment_says_on(monkeypatch):
    monkeypatch.delenv("TRES_EGRESS", raising=False)
    assert create_app({"t": "HOSP1"}, run_escalation_loop=False).state.tres_egress is False
    monkeypatch.setenv("TRES_EGRESS", "off")
    assert create_app({"t": "HOSP1"}, run_escalation_loop=False).state.tres_egress is False
    monkeypatch.setenv("TRES_EGRESS", "on")
    assert create_app({"t": "HOSP1"}, run_escalation_loop=False).state.tres_egress is True
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_tres_egress.py 2>&1 | tail -3`
Expected: FAIL — `ModuleNotFoundError: No module named 'homunculus.tres'`.

- [ ] **Step 3: The package and the switch**

`homunculus-engine/src/homunculus/tres/__init__.py`:
```python
"""TRƏS-01: the national e-health feed (Azerbaijan's FHIR platform, «TRƏS»); spec
2026-11-11-tres-esaglik-gonderim-design.md. Off by default under two locks (D2): the install's
`TRES_EGRESS` (egress.py) and each tenant's `tres_settings.mode` (models.py)."""
```
`homunculus-engine/src/homunculus/tres/egress.py`:
```python
# homunculus-engine/src/homunculus/tres/egress.py
"""The install's lock on the national e-health feed (TRƏS-01, spec D2 (b)).

Homunculus is installed on-prem with the promise «no patient data leaves the building»
(docs/EDGE-BRIDGE-LOCAL.md). The feed is the first thing that can break it, so it is closed twice:
by each tenant's own `tres_settings.mode`, and by this switch, which belongs to whoever runs the
server. `TRES_EGRESS` unset, empty or anything but `on` means the module opens NO connection,
whatever a tenant's row says: the worker is not started, a round builds no client, the connection
test answers 409 `egress_off`, and the settings tab says the feed is closed.

It is read once, at start-up (`api/app.py` → `app.state.tres_egress`): changing it is a restart."""
from __future__ import annotations

from collections.abc import Mapping


def egress_on(env: Mapping[str, str]) -> bool:
    """True only when TRES_EGRESS, stripped and lower-cased, is exactly `on`."""
    return (env.get("TRES_EGRESS", "") or "").strip().lower() == "on"
```

- [ ] **Step 4: The app reads it once**

In `homunculus-engine/src/homunculus/api/app.py` replace
```python
from homunculus.tenant.bedmap import BedMap

if TYPE_CHECKING:
```
with
```python
from homunculus.tenant.bedmap import BedMap
from homunculus.tres.egress import egress_on        # TRƏS-01 (spec D2): the install's lock

if TYPE_CHECKING:
```
and replace
```python
    app.state.tasks = tasks                         # G3-02
```
with
```python
    app.state.tasks = tasks                         # G3-02

    # TRƏS-01 (spec D2): the install's lock on the national e-health feed, read once, here. Closed
    # unless TRES_EGRESS=on: the module then opens no connection, whatever a tenant's settings say.
    app.state.tres_egress = egress_on(os.environ)
```
(`os` is already imported at the top of `app.py`. No `detail="…"` literal is added to this file: a dashboard test reads every one of them.)

- [ ] **Step 5: Run the switch's tests**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_tres_egress.py 2>&1 | tail -3`
Expected: PASS — `15 passed`.

- [ ] **Step 6: Hold compose and `.env.example` to the new reader — the pin first**

In `homunculus-engine/tests/test_local_compose_env.py` replace
```python
    _SRC / "api" / "infinity_waves.py",
]
```
with
```python
    _SRC / "api" / "infinity_waves.py",
    _SRC / "tres" / "egress.py",        # TRƏS-01 (spec D2): the install's lock on the national feed
]
```
and replace
```python
          "INFINITY_CLINICAL_STAGE", "INFINITY_RULES_PARAMETERS", "INFINITY_WAVES"}
```
with
```python
          "INFINITY_CLINICAL_STAGE", "INFINITY_RULES_PARAMETERS", "INFINITY_WAVES", "TRES_EGRESS"}
```
Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_local_compose_env.py 2>&1 | tail -3`
Expected: FAIL — `2 failed, 1 passed`: `TRES_EGRESS` is read by `tres/egress.py` but not passed by compose, and has no line in `.env.example`.

- [ ] **Step 7: Pass the variable to the API and explain it**

In `deploy/local/docker-compose.yml` replace
```yaml
      SCOPE_ENFORCE_UNASSIGNED: ${SCOPE_ENFORCE_UNASSIGNED:-}
```
with
```yaml
      SCOPE_ENFORCE_UNASSIGNED: ${SCOPE_ENFORCE_UNASSIGNED:-}
      # TRƏS-01 — the national e-health feed (spec 2026-11-11-tres-esaglik-gonderim-design.md, D2).
      # Unset, or anything but "on" = closed: the API opens no connection to the ministry's
      # platform, whatever a hospital's Yönetim › TRƏS settings say, and that tab says so.
      TRES_EGRESS: ${TRES_EGRESS:-}
```
(The line is the last of the api service's `environment:` list; keep its six-space indent.)

Append to the end of `deploy/local/.env.example`:
```
# ---------------------------------------------------------------------------------------
# TRƏS — the national e-health feed (optional; spec
# docs/superpowers/specs/2026-11-11-tres-esaglik-gonderim-design.md, D2). Unset = closed: no
# patient data leaves this server, whatever Yönetim › TRƏS says, and that tab says the feed is
# closed. "on" lets the API connect to the ministry's platform (outbound 443) for the hospitals
# whose own setting there is «Yalnız doğrula» or «Gönder». Turning it on is the hospital's
# decision, taken once its present system has stopped reporting the same stays: two senders write
# every stay twice into the national record. Apply with `docker compose up -d api` (a plain
# restart keeps the container's old environment).
#TRES_EGRESS=on
```

- [ ] **Step 8: Run the pin and the switch again**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_local_compose_env.py tests/test_tres_egress.py 2>&1 | tail -3`
Expected: PASS — `18 passed`.

- [ ] **Step 9: Commit**

```bash
cd /c/tmp/tres && git add homunculus-engine/src/homunculus/tres/__init__.py homunculus-engine/src/homunculus/tres/egress.py homunculus-engine/tests/test_tres_egress.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_local_compose_env.py deploy/local/docker-compose.yml deploy/local/.env.example && git commit -m "feat(tres-01): TRES_EGRESS — the install's lock on the national feed, closed unless «on»; app.state.tres_egress; compose and .env.example (spec D2)" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---


### Task 3: The platform's client — `tres/client.py`

The session and the six calls of spec §4 over `httpx.AsyncClient`, in the manner of `api/infinity_waves.py`'s hub client (`HubWaves._http`, ~lines 262–274 there: `trust_env=False`, no redirects, an explicit timeout, one keep-alive client built on first use). No database, no network: the tests script the platform with `httpx.MockTransport`. The contract is second-hand (spec §2) — the file's docstring says so, and F6 re-checks it.

What later tasks use from this file, by name: `TresAccount(base_url, username, password, provider_id)`; `TresError(status, message, *, retry_after=None)` with `.status`, `.message`, `.retry_after`; `read_error(body) -> str`; `TresClient(account, *, transport=None)` with `.pace`, `.requests`, `async token()`, `find(resource_type, local_id)`, `create(resource_type, resource)`, `update(resource_type, remote_id, resource)`, `validate(resource_type, resource)`, `delete(resource_type, remote_id)`, `read(resource_type, remote_id)`, `aclose()`; the constants `LOCAL_ID_PARAM`, `LOCAL_ID_EXTENSION`, `TOKEN_CONTENT_TYPE`. Here `resource_type` is the FHIR type (`Patient`, `Observation`).

**Files:**
- Create: `homunculus-engine/src/homunculus/tres/client.py`
- Test: `homunculus-engine/tests/test_tres_client.py`

- [ ] **Step 1: Write the failing test**

```python
# homunculus-engine/tests/test_tres_client.py
"""TRƏS-01 (spec §4, D21): the platform's client over `httpx.MockTransport` — the session, the
Bearer token, one new token on a 401, find → create / update with the two `id` rules, validate,
delete, read, the three error shapes, 429 with `Retry-After`, a failure with no answer, the
spacing hook. The platform is never contacted. Synthetic account, synthetic people."""
from __future__ import annotations

import base64
import json

import httpx
import pytest

from homunculus.tres.client import (
    LOCAL_ID_EXTENSION, TOKEN_CONTENT_TYPE, TresAccount, TresClient, TresError, read_error,
)

ACCOUNT = TresAccount("https://tres.test", "sentetik", "gizli-parola", "PRV-0001")
PATIENT = {"resourceType": "Patient", "meta": {"profile": ["http://fhir.az/StructureDefinition/az-patient"]},
           "extension": [{"url": LOCAL_ID_EXTENSION, "valueString": "hmn-p-0001"}],
           "name": [{"family": "Sentetik", "given": ["Ayşe"]}]}


class Script:
    """A scripted platform. The token route always opens a session (`S-1`, `S-2`, …); every other
    request takes the next scripted answer — a Response, or a function of the request."""

    def __init__(self, *answers) -> None:
        self.answers = list(answers)
        self.calls: list[httpx.Request] = []
        self.sessions = 0

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        if request.url.path == "/auth/token":
            self.sessions += 1
            return httpx.Response(200, json={"payload": {"sessionId": f"S-{self.sessions}"}})
        answer = self.answers.pop(0)
        return answer(request) if callable(answer) else answer

    @property
    def fhir(self) -> list[httpx.Request]:
        return [r for r in self.calls if r.url.path != "/auth/token"]

    @property
    def lines(self) -> list[tuple[str, str]]:
        return [(r.method, r.url.path) for r in self.calls]


def client_on(script) -> TresClient:
    return TresClient(ACCOUNT, transport=httpx.MockTransport(script))


def outcome(status: int, text: str) -> httpx.Response:
    return httpx.Response(status, json={"resourceType": "OperationOutcome",
                                        "issue": [{"severity": "error", "diagnostics": text}]})


# ---------------------------------------------------------------- the account and the address
def test_only_https_is_accepted_and_nothing_is_built_before_the_first_request():
    for url in ("http://tres.test", "tres.test", "", "ftp://tres.test"):
        with pytest.raises(ValueError):
            TresClient(TresAccount(url, "u", "p", "PRV"))
    client = client_on(Script())
    assert client._client is None and client.requests == 0


def test_the_password_is_not_in_the_accounts_repr():
    assert "gizli-parola" not in repr(ACCOUNT)
    assert "sentetik" in repr(ACCOUNT)


# ---------------------------------------------------------------- the session (§4.1)
async def test_the_token_request_is_basic_with_the_provider_id_and_is_asked_once():
    script = Script()
    client = client_on(script)
    assert await client.token() == "S-1"
    assert await client.token() == "S-1"
    (request,) = script.calls
    assert (request.method, str(request.url)) == ("POST", "https://tres.test/auth/token")
    basic = base64.b64encode(b"sentetik:gizli-parola").decode()
    assert request.headers["Authorization"] == f"Basic {basic}"
    assert request.headers["Content-Type"] == TOKEN_CONTENT_TYPE
    assert json.loads(request.content) == {"healthcareProviderId": "PRV-0001"}
    await client.aclose()


@pytest.mark.parametrize("response, status, words", [
    (httpx.Response(401, json={"message": "Invalid credentials"}), 401, "Invalid credentials"),
    (httpx.Response(200, json={"payload": {}}), 200, "the platform's answer carries no session id"),
    (httpx.Response(200, text="<html>"), 200, "the platform's answer carries no session id"),
    (httpx.Response(503, text=""), 503, "HTTP 503"),
])
async def test_a_refused_or_empty_token_answer_is_an_error(response, status, words):
    client = TresClient(ACCOUNT, transport=httpx.MockTransport(lambda request: response))
    with pytest.raises(TresError) as raised:
        await client.token()
    assert (raised.value.status, raised.value.message) == (status, words)
    await client.aclose()


async def test_every_fhir_request_carries_the_session_as_a_bearer_token():
    script = Script(httpx.Response(200, json={"resourceType": "Bundle", "entry": []}))
    client = client_on(script)
    await client.find("Patient", "hmn-p-0001")
    assert script.fhir[0].headers["Authorization"] == "Bearer S-1"
    assert script.lines == [("POST", "/auth/token"), ("GET", "/fhir/Patient")]
    await client.aclose()


async def test_a_401_asks_one_new_token_and_sends_the_request_once_more():
    script = Script(httpx.Response(401, json={"error": "Session expired"}),
                    httpx.Response(200, json={"resourceType": "Bundle", "entry": []}))
    client = client_on(script)
    assert await client.find("Patient", "hmn-p-0001") is None
    assert script.lines == [("POST", "/auth/token"), ("GET", "/fhir/Patient"),
                            ("POST", "/auth/token"), ("GET", "/fhir/Patient")]
    assert [r.headers["Authorization"] for r in script.fhir] == ["Bearer S-1", "Bearer S-2"]
    await client.aclose()


async def test_a_second_401_is_the_error_and_the_next_call_asks_a_token_again():
    script = Script(httpx.Response(401, json={"error": "Session expired"}),
                    httpx.Response(401, json={"error": "Session expired"}),
                    httpx.Response(200, json={"resourceType": "Bundle", "entry": []}))
    client = client_on(script)
    with pytest.raises(TresError) as raised:
        await client.find("Patient", "hmn-p-0001")
    assert (raised.value.status, raised.value.message) == (401, "Session expired")
    assert len(script.fhir) == 2 and script.sessions == 2
    assert await client.find("Patient", "hmn-p-0001") is None
    assert script.sessions == 3
    await client.aclose()


# ---------------------------------------------------------------- the six calls (§4.2, §4.3)
async def test_find_searches_by_the_local_id_and_answers_the_servers_id_or_none():
    script = Script(
        httpx.Response(200, json={"resourceType": "Bundle", "entry": [{"resource": {**PATIENT, "id": "7001"}}]}),
        httpx.Response(200, json={"resourceType": "Bundle", "total": 0}))
    client = client_on(script)
    assert await client.find("Patient", "hmn-p-0001") == "7001"
    assert await client.find("Patient", "hmn-p-0002") is None
    assert [dict(r.url.params) for r in script.fhir] == [{"local-system-unique-id": "hmn-p-0001"},
                                                        {"local-system-unique-id": "hmn-p-0002"}]
    await client.aclose()


async def test_create_posts_the_placeholder_id_and_answers_the_servers_own():
    script = Script(httpx.Response(201, json={**PATIENT, "id": "7001"}))
    client = client_on(script)
    assert await client.create("Patient", {**PATIENT, "id": "hmn-p-0001"}) == "7001"
    (request,) = script.fhir
    assert (request.method, request.url.path) == ("POST", "/fhir/Patient")
    assert request.headers["Content-Type"] == "application/json"
    sent = json.loads(request.content)
    assert sent["id"] == "hmn-p-0001" and sent["name"] == [{"family": "Sentetik", "given": ["Ayşe"]}]
    assert "Ayşe".encode() in request.content          # UTF-8, not \u escapes
    await client.aclose()


async def test_create_without_an_id_is_refused_here_and_nothing_is_sent():
    script = Script()
    client = client_on(script)
    with pytest.raises(ValueError):
        await client.create("Patient", PATIENT)
    assert script.calls == []
    await client.aclose()


async def test_create_whose_answer_carries_no_id_is_an_error():
    client = client_on(Script(httpx.Response(201, json={"resourceType": "Patient"})))
    with pytest.raises(TresError) as raised:
        await client.create("Patient", {**PATIENT, "id": "hmn-p-0001"})
    assert raised.value.message == "the platform's answer carries no resource id"
    await client.aclose()


async def test_update_puts_the_servers_id_in_the_url_and_in_the_body():
    script = Script(httpx.Response(200, json={**PATIENT, "id": "7001"}))
    client = client_on(script)
    await client.update("Patient", "7001", {**PATIENT, "id": "hmn-p-0001"})
    (request,) = script.fhir
    assert (request.method, request.url.path) == ("PUT", "/fhir/Patient/7001")
    assert json.loads(request.content)["id"] == "7001"
    await client.aclose()


async def test_validate_posts_to_the_validate_operation_and_reads_an_error_issue_in_a_200():
    script = Script(
        httpx.Response(200, json={"resourceType": "OperationOutcome",
                                  "issue": [{"severity": "information", "diagnostics": "No issues"}]}),
        httpx.Response(200, json={"resourceType": "OperationOutcome", "issue": [
            {"severity": "warning", "diagnostics": "a display differs"},
            {"severity": "error", "diagnostics": "Patient.name: minimum required = 1"}]}))
    client = client_on(script)
    await client.validate("Patient", {**PATIENT, "id": "hmn-p-0001"})
    with pytest.raises(TresError) as raised:
        await client.validate("Patient", {**PATIENT, "id": "hmn-p-0001"})
    assert raised.value.message == "Patient.name: minimum required = 1"
    assert [r.url.path for r in script.fhir] == ["/fhir/Patient/$validate"] * 2
    await client.aclose()


async def test_delete_and_read():
    script = Script(httpx.Response(204), outcome(409, "There are other resources referencing this resource"),
                    httpx.Response(200, json={**PATIENT, "id": "7001"}), outcome(404, "Resource not found"))
    client = client_on(script)
    await client.delete("Patient", "7001")
    with pytest.raises(TresError) as raised:
        await client.delete("Patient", "7002")
    assert (raised.value.status, raised.value.message) == (
        409, "There are other resources referencing this resource")
    assert (await client.read("Patient", "7001"))["id"] == "7001"
    assert await client.read("Patient", "7002") is None
    assert [(r.method, r.url.path) for r in script.fhir] == [
        ("DELETE", "/fhir/Patient/7001"), ("DELETE", "/fhir/Patient/7002"),
        ("GET", "/fhir/Patient/7001"), ("GET", "/fhir/Patient/7002")]
    await client.aclose()


# ---------------------------------------------------------------- the three error shapes (§4.5)
@pytest.mark.parametrize("body, words", [
    ({"resourceType": "OperationOutcome", "issue": [{"severity": "error", "diagnostics": "Resource ID mismatch"}]},
     "Resource ID mismatch"),
    ({"resourceType": "OperationOutcome", "issue": [{"details": {"text": {"value": "Non-existent reference"}}}]},
     "Non-existent reference"),
    ({"resourceType": "OperationOutcome", "issue": [{"details": {"text": "Yanlış kod"}}]}, "Yanlış kod"),
    ({"error": "Bad request"}, "Bad request"),
    ({"message": "Daxili xəta"}, "Daxili xəta"),
    ({"issue": [{"diagnostics": "birinci"}, {"diagnostics": "ikinci"}]}, "birinci; ikinci"),
])
async def test_the_platforms_words_are_read_from_each_shape(body, words):
    assert read_error(json.dumps(body)) == words
    client = client_on(Script(httpx.Response(400, json=body)))
    with pytest.raises(TresError) as raised:
        await client.update("Patient", "7001", PATIENT)
    assert (raised.value.status, raised.value.message, raised.value.retry_after) == (400, words, None)
    await client.aclose()


def test_any_other_body_is_its_own_text_and_never_longer_than_500_characters():
    assert read_error("") == ""
    assert read_error("Bad Gateway") == "Bad Gateway"
    assert read_error("[1, 2]") == "[1, 2]"
    assert read_error(json.dumps({"issue": []})) == '{"issue": []}'
    assert len(read_error("x" * 2000)) == 500
    assert len(read_error(json.dumps({"message": "y" * 2000}))) == 500


# ---------------------------------------------------------------- 429 and no answer (D21)
@pytest.mark.parametrize("headers, expected", [
    ({"Retry-After": "120"}, 120.0), ({"Retry-After": " 2.5 "}, 2.5), ({}, None),
    ({"Retry-After": "Wed, 11 Nov 2026 10:00:00 GMT"}, None), ({"Retry-After": "-5"}, None),
])
async def test_a_429_is_not_retried_and_carries_what_retry_after_said(headers, expected):
    script = Script(httpx.Response(429, headers=headers, json={"message": "Too many requests"}))
    client = client_on(script)
    with pytest.raises(TresError) as raised:
        await client.find("Patient", "hmn-p-0001")
    assert (raised.value.status, raised.value.retry_after) == (429, expected)
    assert len(script.fhir) == 1
    await client.aclose()


async def test_a_failure_with_no_answer_is_an_error_named_by_its_class_never_by_the_address():
    def refuse(request):
        raise httpx.ConnectError("connection refused to https://tres.test/fhir/Patient", request=request)

    client = TresClient(ACCOUNT, transport=httpx.MockTransport(refuse))
    with pytest.raises(TresError) as raised:
        await client.token()
    assert (raised.value.status, raised.value.message) == (None, "ConnectError")
    await client.aclose()


# ---------------------------------------------------------------- the spacing hook, and the end
async def test_the_pace_hook_is_awaited_before_every_request_the_tokens_included():
    script = Script(httpx.Response(200, json={"entry": []}), httpx.Response(200, json={"entry": []}))
    client = client_on(script)
    waits = []

    async def pace():
        waits.append(len(script.calls))

    client.pace = pace
    await client.find("Patient", "a")
    await client.find("Patient", "b")
    assert waits == [0, 1, 2] and client.requests == 3
    await client.aclose()


async def test_closing_forgets_the_session_and_may_be_done_twice():
    script = Script(httpx.Response(200, json={"entry": []}))
    client = client_on(script)
    await client.token()
    await client.aclose()
    await client.aclose()
    assert client._client is None and client._session is None
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_tres_client.py 2>&1 | tail -3`
Expected: FAIL — `ModuleNotFoundError: No module named 'homunculus.tres.client'`.

- [ ] **Step 3: Write the client**

```python
# homunculus-engine/src/homunculus/tres/client.py
"""The HTTP client of the national e-health platform (TRƏS-01, spec §4, D4, D21).

The contract is SECOND-HAND (spec §2): read from a third-party sender, true of its sandbox and
live runs up to October 2026. Phase F6 re-checks every line below against the sandbox; where this
file and the server disagree, the server is right and this file changes.

* The session (§4.1). `POST {base}/auth/token` with Basic credentials, the content type
  `application/json-patch+json` and `{"healthcareProviderId": …}` answers `payload.sessionId`;
  every FHIR request carries it as a Bearer token. No expiry is published: a 401 means a new
  token, asked once, and the request once more.
* One resource per request (§4.2, D4): `find` by the local id, then `create` or `update`.
  `create` must carry an `id` although the server assigns its own (the caller's placeholder);
  `update` carries the server's id in the URL and in the body. `validate` stores nothing.
* Errors (§4.5) come in three shapes; `read_error` reads all three. Every refusal is a
  `TresError` with the HTTP status; a failure with no answer at all (a timeout, a refused
  connection) is a `TresError` with `status` None, named by its class and never by a URL.
* HTTP 429 (D21) is never retried here: the `TresError` carries `retry_after` and the round ends.

As `api/infinity_waves.py`'s hub client: `trust_env=False` (no proxy from the environment), no
redirects, https only, an explicit timeout, one keep-alive client built on first use. Nothing is
logged here: a body is PHI (D25).

`pace`, when set, is awaited before every request: the worker's 300 ms spacing (D21)."""
from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from urllib.parse import quote

import httpx

TIMEOUT_S = 20.0
#: The most characters of a platform message this module hands on.
ERROR_MAX = 500
#: The platform's one search key (§4.2), and the extension every resource carries it in (§4.4).
LOCAL_ID_PARAM = "local-system-unique-id"
LOCAL_ID_EXTENSION = "http://fhir.az/StructureDefinition/local-system-unique-id"
TOKEN_CONTENT_TYPE = "application/json-patch+json"


@dataclass(frozen=True)
class TresAccount:
    """One environment's account at the platform. The password never appears in a repr."""
    base_url: str
    username: str
    password: str = field(repr=False)
    provider_id: str


class TresError(Exception):
    """The platform refused, or did not answer. `status` is the HTTP status, None when there was
    no answer; `message` the platform's own words (at most ERROR_MAX characters), or the class of
    the transport failure; `retry_after` the seconds a 429 asked for, when it said."""

    def __init__(self, status: int | None, message: str, *, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.message = message
        self.retry_after = retry_after


def read_error(body: str) -> str:
    """The words of an error answer, whichever of the three shapes it has (§4.5): an
    OperationOutcome's `issue[].diagnostics`; one whose text is at `issue[].details.text.value`
    (or at `details.text`, as FHIR itself writes it); a plain `{"error" | "message": "…"}`.
    Anything else is the body's own text. Never longer than ERROR_MAX."""
    text = (body or "").strip()
    try:
        data = json.loads(text)
    except (ValueError, RecursionError):
        return text[:ERROR_MAX]
    if not isinstance(data, dict):
        return text[:ERROR_MAX]
    words: list[str] = []
    issues = data.get("issue")
    for issue in issues if isinstance(issues, list) else ():
        if not isinstance(issue, dict):
            continue
        said = issue.get("diagnostics")
        if not isinstance(said, str) or not said.strip():
            details = issue.get("details")
            inner = details.get("text") if isinstance(details, dict) else None
            said = inner.get("value") if isinstance(inner, dict) else inner
        if isinstance(said, str) and said.strip():
            words.append(said.strip())
    if not words:
        for key in ("error", "message"):
            said = data.get(key)
            if isinstance(said, str) and said.strip():
                words.append(said.strip())
                break
    return ("; ".join(words) or text)[:ERROR_MAX]


def _retry_after(response: httpx.Response) -> float | None:
    """`Retry-After` in seconds, or None: absent, a date, or not a number."""
    raw = (response.headers.get("Retry-After") or "").strip()
    try:
        seconds = float(raw)
    except ValueError:
        return None
    return seconds if 0 <= seconds < 86_400 else None


def _answer(response: httpx.Response) -> dict:
    """The answer's JSON object, or an empty one."""
    try:
        data = response.json()
    except (ValueError, RecursionError):
        return {}
    return data if isinstance(data, dict) else {}


def _refuse_unless_ok(response: httpx.Response) -> None:
    if not response.is_success:
        raise TresError(response.status_code,
                        read_error(response.text) or f"HTTP {response.status_code}")


class TresClient:
    """One account's session and the six calls of §4. Built without touching the network; the
    connection is made by the first request. `aclose()` when done."""

    def __init__(self, account: TresAccount, *,
                 transport: httpx.AsyncBaseTransport | None = None) -> None:
        if not account.base_url.startswith("https://"):
            # The credentials ride in a header: never over plain HTTP.
            raise ValueError("the TRƏS base URL must start with https://")
        try:
            httpx.URL(account.base_url)
        except httpx.InvalidURL:
            raise ValueError("the TRƏS base URL is not a URL") from None
        self.account = account
        self._base = account.base_url.rstrip("/")
        self._transport = transport
        self._client: httpx.AsyncClient | None = None
        self._session: str | None = None
        #: Awaited before every request when set (the worker's spacing, D21).
        self.pace: Callable[[], Awaitable[None]] | None = None
        #: Requests made, the token's included: the tests and a round's report read it.
        self.requests = 0

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            common = {"timeout": httpx.Timeout(TIMEOUT_S), "follow_redirects": False,
                      "trust_env": False}
            if self._transport is not None:
                self._client = httpx.AsyncClient(transport=self._transport, **common)
            else:
                self._client = httpx.AsyncClient(
                    **common, limits=httpx.Limits(max_connections=2, max_keepalive_connections=2,
                                                  keepalive_expiry=30.0))
        return self._client

    async def aclose(self) -> None:
        client, self._client = self._client, None
        self._session = None
        if client is not None:
            await client.aclose()

    async def _request(self, method: str, url: str, **kwargs) -> httpx.Response:
        if self.pace is not None:
            await self.pace()
        self.requests += 1
        try:
            return await self._http().request(method, url, **kwargs)
        except httpx.HTTPError as exc:
            # No answer at all. The class names the failure; str(exc) may carry the URL.
            raise TresError(None, type(exc).__name__) from None

    async def token(self) -> str:
        """The session id (§4.1), asked once and kept until a 401 or `aclose()`."""
        if self._session is None:
            response = await self._request(
                "POST", f"{self._base}/auth/token",
                auth=httpx.BasicAuth(self.account.username, self.account.password),
                headers={"Content-Type": TOKEN_CONTENT_TYPE, "Accept": "application/json"},
                content=json.dumps({"healthcareProviderId": self.account.provider_id}))
            if response.status_code == 429:
                raise TresError(429, read_error(response.text) or "Too Many Requests",
                                retry_after=_retry_after(response))
            _refuse_unless_ok(response)
            payload = _answer(response).get("payload")
            session = payload.get("sessionId") if isinstance(payload, dict) else None
            if not isinstance(session, str) or not session.strip():
                raise TresError(response.status_code, "the platform's answer carries no session id")
            self._session = session
        return self._session

    async def _fhir(self, method: str, path: str, *, params: dict | None = None,
                    resource: dict | None = None) -> httpx.Response:
        """One FHIR request with the session. A 401 asks one new token and sends it once more; a
        429 raises with what `Retry-After` said. Every other answer is the caller's to read."""
        headers = {"Accept": "application/json"}
        content = None
        if resource is not None:
            headers["Content-Type"] = "application/json"
            content = json.dumps(resource, ensure_ascii=False).encode("utf-8")
        response = None
        for attempt in (1, 2):
            session = await self.token()
            response = await self._request(
                method, f"{self._base}/fhir/{path}", params=params, content=content,
                headers={**headers, "Authorization": f"Bearer {session}"})
            if response.status_code != 401:
                break
            self._session = None            # §4.1: a 401 means a new token
        if response.status_code == 429:
            raise TresError(429, read_error(response.text) or "Too Many Requests",
                            retry_after=_retry_after(response))
        return response

    async def find(self, resource_type: str, local_id: str) -> str | None:
        """The server's id of the resource carrying this local id, or None (§4.2)."""
        response = await self._fhir("GET", resource_type, params={LOCAL_ID_PARAM: local_id})
        _refuse_unless_ok(response)
        entries = _answer(response).get("entry")
        first = entries[0] if isinstance(entries, list) and entries else None
        resource = first.get("resource") if isinstance(first, dict) else None
        found = resource.get("id") if isinstance(resource, dict) else None
        return found if isinstance(found, str) and found else None

    async def create(self, resource_type: str, resource: dict) -> str:
        """POST. The body must carry an `id` (the caller's placeholder) although the server
        assigns its own; the server's id, from the answer, is what is returned."""
        if not isinstance(resource.get("id"), str) or not resource["id"]:
            raise ValueError("a resource to create carries a placeholder id (spec §4.2)")
        response = await self._fhir("POST", resource_type, resource=resource)
        _refuse_unless_ok(response)
        remote = _answer(response).get("id")
        if not isinstance(remote, str) or not remote:
            raise TresError(response.status_code, "the platform's answer carries no resource id")
        return remote

    async def update(self, resource_type: str, remote_id: str, resource: dict) -> None:
        """PUT, the body's `id` equal to the URL's (§4.2)."""
        response = await self._fhir("PUT", f"{resource_type}/{quote(remote_id, safe='')}",
                                    resource={**resource, "id": remote_id})
        _refuse_unless_ok(response)

    async def validate(self, resource_type: str, resource: dict) -> None:
        """`$validate`: the platform checks the resource and stores nothing. A refusal, or an
        answer whose OperationOutcome holds an issue of severity error or fatal, raises. A green
        validate proves the shape, not the codes (§4.5)."""
        response = await self._fhir("POST", f"{resource_type}/$validate", resource=resource)
        _refuse_unless_ok(response)
        issues = _answer(response).get("issue")
        bad = [issue for issue in issues if isinstance(issue, dict)
               and issue.get("severity") in ("error", "fatal")] if isinstance(issues, list) else []
        if bad:
            raise TresError(response.status_code, read_error(json.dumps({"issue": bad})))

    async def delete(self, resource_type: str, remote_id: str) -> None:
        """DELETE, hard (§4.3). A resource still referred to answers 409."""
        response = await self._fhir("DELETE", f"{resource_type}/{quote(remote_id, safe='')}")
        _refuse_unless_ok(response)

    async def read(self, resource_type: str, remote_id: str) -> dict | None:
        """The resource as the platform holds it, or None when it holds none by that id."""
        response = await self._fhir("GET", f"{resource_type}/{quote(remote_id, safe='')}")
        if response.status_code == 404:
            return None
        _refuse_unless_ok(response)
        return _answer(response)
```

- [ ] **Step 4: Run it to see it pass**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_tres_client.py 2>&1 | tail -3`
Expected: PASS — `32 passed`.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/tres && git add homunculus-engine/src/homunculus/tres/client.py homunculus-engine/tests/test_tres_client.py && git commit -m "feat(tres-01): the platform's client — the session, find/create/update/validate/delete/read, the three error shapes, 429 with Retry-After, https only (spec §4, D21)" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 4: The stand-in — `tests/fake_tres.py`

An in-process stand-in of the platform (spec §9): `FakeTres().transport` is an `httpx.MockTransport` for `TresClient`. It enforces what spec §4 states and nothing more; its own test file proves each rule through the real client. The per-profile required elements of spec §5 are NOT here — each later phase adds its profile's rules to `REQUIRED` with its mapper.

What later tasks use from this file: `FakeTres()` with `.account` (a `TresAccount` on `https://tres.test`), `.transport`, `.requests` and `.fhir_requests` (lists of `(method, path)`), `.resources`, `.stored(fhir_type)`, `.seed(fhir_type, id, resource=None)`, `.expire_session()`, `.throttle(n, retry_after=None)`; the first server id it assigns is `"7001"`.

**Files:**
- Create: `homunculus-engine/tests/fake_tres.py`
- Test: `homunculus-engine/tests/test_fake_tres.py`

- [ ] **Step 1: Write the failing test**

```python
# homunculus-engine/tests/test_fake_tres.py
"""The stand-in itself (tests/fake_tres.py, spec §9): each rule of spec §4 it enforces is proved
here through the real client, so a test that passes against it passed against those rules. No
network, no database. Synthetic account, synthetic people."""
from __future__ import annotations

import httpx
import pytest

from homunculus.tres.client import LOCAL_ID_EXTENSION, TresAccount, TresClient, TresError
from tests.fake_tres import BASE_URL, ID_MISMATCH, NO_ID, NO_REFERENCE, REFERRED, FakeTres, local_id_of, references_of

PROFILE = "http://fhir.az/StructureDefinition/"


def resource(resource_type: str, local_id: str, **elements) -> dict:
    return {"resourceType": resource_type, "meta": {"profile": [PROFILE + "az-" + resource_type.lower()]},
            "extension": [{"url": LOCAL_ID_EXTENSION, "valueString": local_id}], **elements}


def patient(local_id: str = "hmn-p-0001") -> dict:
    return resource("Patient", local_id, name=[{"family": "Sentetik", "given": ["Ayşe"]}])


@pytest.fixture
async def platform():
    fake = FakeTres()
    client = TresClient(fake.account, transport=fake.transport)
    yield fake, client
    await client.aclose()


async def raw(fake: FakeTres, method: str, path: str, **kwargs) -> httpx.Response:
    """A request the client would never make (no `id`, a wrong `id`, another search), with a session."""
    async with httpx.AsyncClient(transport=fake.transport, base_url=BASE_URL) as http:
        token = TresClient(fake.account, transport=fake.transport)
        session = await token.token()
        await token.aclose()
        return await http.request(method, path, headers={"Authorization": f"Bearer {session}"}, **kwargs)


def said(response: httpx.Response) -> str:
    return response.json()["issue"][0]["diagnostics"]


# ---------------------------------------------------------------- the session
async def test_one_account_opens_a_session_and_any_other_is_refused(platform):
    fake, client = platform
    assert (await client.token()).startswith("session-")
    for wrong in (TresAccount(BASE_URL, "sentetik", "yanlis", "PRV-0001"),
                  TresAccount(BASE_URL, "baskasi", "gizli-parola", "PRV-0001"),
                  TresAccount(BASE_URL, "sentetik", "gizli-parola", "PRV-9999")):
        other = TresClient(wrong, transport=fake.transport)
        with pytest.raises(TresError) as raised:
            await other.token()
        assert (raised.value.status, raised.value.message) == (401, "Invalid credentials")
        await other.aclose()


async def test_a_fhir_request_without_an_open_session_is_a_401(platform):
    fake, _ = platform
    async with httpx.AsyncClient(transport=fake.transport, base_url=BASE_URL) as http:
        assert (await http.get("/fhir/Patient", params={"local-system-unique-id": "x"})).status_code == 401
        bad = {"Authorization": "Bearer session-999"}
        assert (await http.get("/fhir/Patient", params={"local-system-unique-id": "x"}, headers=bad)).status_code == 401


async def test_an_expired_session_is_replaced_by_the_client_without_the_caller_knowing(platform):
    fake, client = platform
    assert await client.find("Patient", "hmn-p-0001") is None
    fake.expire_session()
    assert await client.find("Patient", "hmn-p-0001") is None
    assert fake.requests == [("POST", "/auth/token"), ("GET", "/fhir/Patient"),
                             ("GET", "/fhir/Patient"), ("POST", "/auth/token"), ("GET", "/fhir/Patient")]


async def test_throttle_answers_429_for_the_next_n_requests_with_retry_after(platform):
    fake, client = platform
    fake.throttle(2, retry_after=120)
    for _ in range(2):
        with pytest.raises(TresError) as raised:
            await client.find("Patient", "hmn-p-0001")
        assert (raised.value.status, raised.value.retry_after) == (429, 120.0)
    assert await client.find("Patient", "hmn-p-0001") is None
    fake.throttle(1)
    with pytest.raises(TresError) as raised:
        await client.find("Patient", "hmn-p-0001")
    assert (raised.value.status, raised.value.retry_after) == (429, None)


# ---------------------------------------------------------------- writing (§4.2)
async def test_create_stores_under_a_server_id_and_find_answers_it(platform):
    fake, client = platform
    remote = await client.create("Patient", {**patient(), "id": "hmn-p-0001"})
    assert remote != "hmn-p-0001" and remote.isdigit()
    assert await client.find("Patient", "hmn-p-0001") == remote
    assert await client.find("Patient", "hmn-p-0002") is None
    assert await client.find("Practitioner", "hmn-p-0001") is None       # the id space is per type
    assert (await client.read("Patient", remote))["name"][0]["family"] == "Sentetik"
    assert fake.stored("Patient")[0]["id"] == remote


async def test_a_post_without_an_id_is_refused(platform):
    fake, _ = platform
    response = await raw(fake, "POST", "/fhir/Patient", json=patient())
    assert (response.status_code, said(response)) == (400, NO_ID)
    assert fake.stored("Patient") == []


async def test_a_put_whose_body_id_is_not_the_urls_is_refused(platform):
    fake, client = platform
    remote = await client.create("Patient", {**patient(), "id": "hmn-p-0001"})
    response = await raw(fake, "PUT", f"/fhir/Patient/{remote}", json={**patient(), "id": "hmn-p-0001"})
    assert (response.status_code, said(response)) == (400, ID_MISMATCH)
    await client.update("Patient", remote, {**patient(), "active": True})
    assert fake.resources["Patient"][remote]["active"] is True
    with pytest.raises(TresError) as raised:
        await client.update("Patient", "9999", patient())
    assert raised.value.status == 404


async def test_a_resource_without_a_profile_or_without_the_local_id_extension_is_refused(platform):
    fake, client = platform
    bare = {**patient(), "id": "hmn-p-0001"}
    for broken in ({k: v for k, v in bare.items() if k != "meta"}, {**bare, "meta": {"profile": []}},
                   {k: v for k, v in bare.items() if k != "extension"},
                   {**bare, "extension": [{"url": "http://example.org/other", "valueString": "x"}]}):
        with pytest.raises(TresError) as raised:
            await client.create("Patient", broken)
        assert raised.value.status == 400
    assert fake.stored("Patient") == []


async def test_only_the_local_id_search_exists(platform):
    fake, _ = platform
    for params in ({"name": "Sentetik"}, {}, {"local-system-unique-id": "x", "name": "y"}):
        response = await raw(fake, "GET", "/fhir/Patient", params=params)
        assert response.status_code == 400, params


# ---------------------------------------------------------------- references (§4.2, §4.3)
async def test_a_reference_to_a_resource_the_server_does_not_hold_is_refused(platform):
    fake, client = platform
    encounter = resource("Encounter", "hmn-e-0001", subject={"reference": "Patient/7001"},
                         serviceProvider={"reference": "Organization/ORG-1"})
    with pytest.raises(TresError) as raised:
        await client.create("Encounter", {**encounter, "id": "hmn-e-0001"})
    assert (raised.value.status, raised.value.message) == (409, NO_REFERENCE)
    remote = await client.create("Patient", {**patient(), "id": "hmn-p-0001"})
    assert remote == "7001"
    with pytest.raises(TresError):                       # the Organization is still missing
        await client.create("Encounter", {**encounter, "id": "hmn-e-0001"})
    fake.seed("Organization", "ORG-1", {"name": "Sentetik Hastane"})
    assert await client.create("Encounter", {**encounter, "id": "hmn-e-0001"}) == "7002"


async def test_a_referred_resource_is_not_deleted_until_what_refers_to_it_is_gone(platform):
    fake, client = platform
    patient_id = await client.create("Patient", {**patient(), "id": "hmn-p-0001"})
    encounter = resource("Encounter", "hmn-e-0001", subject={"reference": f"Patient/{patient_id}"})
    encounter_id = await client.create("Encounter", {**encounter, "id": "hmn-e-0001"})
    with pytest.raises(TresError) as raised:
        await client.delete("Patient", patient_id)
    assert (raised.value.status, raised.value.message) == (409, REFERRED)
    await client.delete("Encounter", encounter_id)
    await client.delete("Patient", patient_id)
    assert fake.stored("Patient") == [] and fake.stored("Encounter") == []
    with pytest.raises(TresError) as raised:
        await client.delete("Patient", patient_id)
    assert raised.value.status == 404


# ---------------------------------------------------------------- validate
async def test_validate_runs_the_same_checks_and_stores_nothing(platform):
    fake, client = platform
    await client.validate("Patient", {**patient(), "id": "hmn-p-0001"})
    with pytest.raises(TresError) as raised:
        await client.validate("Encounter", {**resource("Encounter", "hmn-e-0001",
                                                       subject={"reference": "Patient/1"}), "id": "hmn-e-0001"})
    assert (raised.value.status, raised.value.message) == (409, NO_REFERENCE)
    response = await raw(fake, "POST", "/fhir/Patient/$validate", json=patient())
    assert (response.status_code, said(response)) == (400, NO_ID)
    assert fake.resources == {}


# ---------------------------------------------------------------- the helpers and the record
def test_the_helpers_read_the_local_id_and_every_reference():
    assert local_id_of(patient("hmn-p-0009")) == "hmn-p-0009"
    assert local_id_of({"extension": [{"url": "http://example.org/other", "valueString": "x"}]}) is None
    assert local_id_of({}) is None
    nested = {"subject": {"reference": "Patient/1"}, "participant": [{"individual": {"reference": "Practitioner/2"}}],
              "text": {"reference": "not a reference"}, "contained": [{"reference": "#local"}]}
    assert references_of(nested) == {"Patient/1", "Practitioner/2"}


async def test_every_request_is_kept_as_method_and_path(platform):
    fake, client = platform
    remote = await client.create("Patient", {**patient(), "id": "hmn-p-0001"})
    await client.validate("Patient", {**patient(), "id": "hmn-p-0001"})
    assert fake.requests == [("POST", "/auth/token"), ("POST", "/fhir/Patient"),
                             ("POST", "/fhir/Patient/$validate")]
    assert fake.fhir_requests == fake.requests[1:]
    assert remote == "7001"
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_fake_tres.py 2>&1 | tail -3`
Expected: FAIL — `ModuleNotFoundError: No module named 'tests.fake_tres'`.

- [ ] **Step 3: Write the stand-in**

```python
# homunculus-engine/tests/fake_tres.py
"""An in-process stand-in for the national e-health platform (TRƏS-01, spec §9): `FakeTres().transport`
is an `httpx.MockTransport` a `TresClient` talks to, and nothing leaves the process.

It enforces what spec §4 states, and only that — every rule below is second-hand knowledge of the
real server (spec §2), so the stand-in is a statement of what the module was built against, not of
what the ministry's server does:

* one account (Basic credentials and the provider id) opens a session; every FHIR request needs the
  Bearer token of a session that is still open (`expire_session()` closes them all → 401);
* `throttle(n, retry_after=…)` makes the next n FHIR requests answer 429;
* POST: the body must carry an `id` («Resource to be added has no ID», 400); the server assigns
  its own and answers the stored resource;
* PUT: the body's `id` must equal the URL's («Resource ID mismatch», 400); 404 for an unknown id;
* every stored or validated resource carries `meta.profile` and the local-id extension (400);
* a reference to a resource the server does not hold is refused («Non-existent reference», 409);
* the only search is `?local-system-unique-id=` (any other, or none: 400);
* DELETE of a resource another stored resource refers to is refused («There are other resources
  referencing this resource», 409);
* `$validate` runs the same checks and stores nothing.

Errors are OperationOutcome JSON with `issue[].diagnostics`. `requests` keeps every request as
`(method, path)`, the token's included. `seed()` plants a resource the server already holds (an
Organization, say) without a request.

NOT here yet: the per-profile required elements of spec §5 (a Patient's FİN, an Encounter's
`serviceType`…). Each later phase adds its profile's rules to `REQUIRED` with its mapper.
Synthetic account, synthetic resources only."""
from __future__ import annotations

import base64
import json
import re

import httpx

from homunculus.tres.client import LOCAL_ID_EXTENSION, LOCAL_ID_PARAM, TOKEN_CONTENT_TYPE, TresAccount

BASE_URL = "https://tres.test"
NO_ID = "Resource to be added has no ID"
ID_MISMATCH = "Resource ID mismatch"
NO_REFERENCE = "Non-existent reference"
REFERRED = "There are other resources referencing this resource"
_REFERENCE = re.compile(r"^([A-Za-z]+)/([A-Za-z0-9\-.]+)$")

#: Per FHIR type, the elements its profile requires (spec §5) — filled in by F1–F5.
REQUIRED: dict[str, tuple[str, ...]] = {}


def local_id_of(resource: dict) -> str | None:
    """The value of the resource's local-system-unique-id extension, or None."""
    for extension in resource.get("extension") or ():
        if isinstance(extension, dict) and extension.get("url") == LOCAL_ID_EXTENSION:
            value = extension.get("valueString")
            return value if isinstance(value, str) and value else None
    return None


def references_of(node) -> set[str]:
    """Every `{"reference": "Type/id"}` anywhere in the JSON."""
    found: set[str] = set()
    if isinstance(node, dict):
        reference = node.get("reference")
        if isinstance(reference, str) and _REFERENCE.match(reference):
            found.add(reference)
        for value in node.values():
            found |= references_of(value)
    elif isinstance(node, list):
        for value in node:
            found |= references_of(value)
    return found


def _outcome(status: int, text: str, *, headers: dict | None = None) -> httpx.Response:
    return httpx.Response(status, headers=headers, json={
        "resourceType": "OperationOutcome",
        "issue": [{"severity": "error", "code": "processing", "diagnostics": text}]})


class FakeTres:
    def __init__(self, *, username: str = "sentetik", password: str = "gizli-parola",
                 provider_id: str = "PRV-0001") -> None:
        self.account = TresAccount(BASE_URL, username, password, provider_id)
        #: FHIR type → server id → the stored resource.
        self.resources: dict[str, dict[str, dict]] = {}
        #: Every request, in order: (method, path).
        self.requests: list[tuple[str, str]] = []
        self.sessions: set[str] = set()
        self._issued = 0
        self._next_id = 7000
        self._throttled = 0
        self._retry_after: float | None = None
        self.transport = httpx.MockTransport(self._handle)

    # ------------------------------------------------------------ what a test arranges
    def expire_session(self) -> None:
        """Every open session ends: the next FHIR request answers 401 until a new token is asked."""
        self.sessions.clear()

    def throttle(self, n: int, *, retry_after: float | None = None) -> None:
        """The next `n` FHIR requests answer 429, with `Retry-After` when given."""
        self._throttled, self._retry_after = n, retry_after

    def seed(self, resource_type: str, resource_id: str, resource: dict | None = None) -> None:
        """A resource the server already holds, planted without a request."""
        self.resources.setdefault(resource_type, {})[resource_id] = {
            "resourceType": resource_type, **(resource or {}), "id": resource_id}

    def stored(self, resource_type: str) -> list[dict]:
        return list(self.resources.get(resource_type, {}).values())

    @property
    def fhir_requests(self) -> list[tuple[str, str]]:
        return [line for line in self.requests if line[1].startswith("/fhir/")]

    # ------------------------------------------------------------ the server
    def _handle(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        self.requests.append((request.method, path))
        if path == "/auth/token":
            return self._token(request)
        if not path.startswith("/fhir/"):
            return _outcome(404, "Not found")
        bearer = request.headers.get("Authorization", "")
        if not bearer.startswith("Bearer ") or bearer[len("Bearer "):] not in self.sessions:
            return httpx.Response(401, json={"error": "Session expired"})
        if self._throttled > 0:
            self._throttled -= 1
            headers = {} if self._retry_after is None else {"Retry-After": f"{self._retry_after:g}"}
            return _outcome(429, "Too many requests", headers=headers)
        parts = path[len("/fhir/"):].split("/")
        resource_type, rest = parts[0], parts[1:]
        if request.method == "GET" and not rest:
            return self._search(resource_type, request)
        if request.method == "POST" and rest == ["$validate"]:
            refused = self._refusal(resource_type, self._body(request), creating=True)
            if refused is not None:
                return refused
            return httpx.Response(200, json={
                "resourceType": "OperationOutcome",
                "issue": [{"severity": "information", "diagnostics": "No issues"}]})
        if request.method == "POST" and not rest:
            return self._create(resource_type, self._body(request))
        if len(rest) == 1 and request.method in ("GET", "PUT", "DELETE"):
            held = self.resources.get(resource_type, {})
            if rest[0] not in held:
                return _outcome(404, "Resource not found")
            if request.method == "GET":
                return httpx.Response(200, json=held[rest[0]])
            if request.method == "PUT":
                return self._update(resource_type, rest[0], self._body(request))
            return self._delete(resource_type, rest[0])
        return _outcome(405, "Method not allowed")

    def _token(self, request: httpx.Request) -> httpx.Response:
        account = self.account
        basic = base64.b64encode(f"{account.username}:{account.password}".encode()).decode()
        body = self._body(request)
        if (request.method != "POST" or request.headers.get("Authorization") != f"Basic {basic}"
                or request.headers.get("Content-Type") != TOKEN_CONTENT_TYPE
                or body.get("healthcareProviderId") != account.provider_id):
            return httpx.Response(401, json={"message": "Invalid credentials"})
        self._issued += 1
        session = f"session-{self._issued}"
        self.sessions.add(session)
        return httpx.Response(200, json={"payload": {"sessionId": session}})

    @staticmethod
    def _body(request: httpx.Request) -> dict:
        try:
            body = json.loads(request.content or b"{}")
        except ValueError:
            return {}
        return body if isinstance(body, dict) else {}

    def _refusal(self, resource_type: str, body: dict, *, creating: bool,
                 url_id: str | None = None) -> httpx.Response | None:
        """Why the platform would not take this body, or None. The order is the stand-in's own."""
        if creating and not body.get("id"):
            return _outcome(400, NO_ID)
        if url_id is not None and body.get("id") != url_id:
            return _outcome(400, ID_MISMATCH)
        profiles = (body.get("meta") or {}).get("profile") if isinstance(body.get("meta"), dict) else None
        if not isinstance(profiles, list) or not profiles:
            return _outcome(400, "meta.profile is required")
        if local_id_of(body) is None:
            return _outcome(400, "The local-system-unique-id extension is required")
        for element in REQUIRED.get(resource_type, ()):
            if body.get(element) in (None, "", [], {}):
                return _outcome(400, f"{resource_type}.{element}: minimum required = 1")
        for reference in sorted(references_of(body)):
            referred_type, referred_id = reference.split("/", 1)
            if referred_id not in self.resources.get(referred_type, {}):
                return _outcome(409, NO_REFERENCE)
        return None

    def _search(self, resource_type: str, request: httpx.Request) -> httpx.Response:
        params = dict(request.url.params)
        if set(params) != {LOCAL_ID_PARAM}:
            return _outcome(400, "Only a search by local-system-unique-id is supported")
        hits = [resource for resource in self.stored(resource_type)
                if local_id_of(resource) == params[LOCAL_ID_PARAM]]
        return httpx.Response(200, json={"resourceType": "Bundle", "type": "searchset", "total": len(hits),
                                         "entry": [{"resource": resource} for resource in hits]})

    def _create(self, resource_type: str, body: dict) -> httpx.Response:
        refused = self._refusal(resource_type, body, creating=True)
        if refused is not None:
            return refused
        self._next_id += 1
        server_id = str(self._next_id)
        stored = {**body, "id": server_id}
        self.resources.setdefault(resource_type, {})[server_id] = stored
        return httpx.Response(201, json=stored)

    def _update(self, resource_type: str, server_id: str, body: dict) -> httpx.Response:
        refused = self._refusal(resource_type, body, creating=False, url_id=server_id)
        if refused is not None:
            return refused
        self.resources[resource_type][server_id] = body
        return httpx.Response(200, json=body)

    def _delete(self, resource_type: str, server_id: str) -> httpx.Response:
        target = f"{resource_type}/{server_id}"
        for other_type, held in self.resources.items():
            for other_id, resource in held.items():
                if (other_type, other_id) != (resource_type, server_id) and target in references_of(resource):
                    return _outcome(409, REFERRED)
        del self.resources[resource_type][server_id]
        return httpx.Response(204)
```

- [ ] **Step 4: Run it to see it pass**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_fake_tres.py tests/test_tres_client.py 2>&1 | tail -3`
Expected: PASS — `46 passed`.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/tres && git add homunculus-engine/tests/fake_tres.py homunculus-engine/tests/test_fake_tres.py && git commit -m "test(tres-01): the platform's stand-in — sessions, 401 and 429 on demand, the two id rules, the local-id search, references, \$validate (spec §4, §9)" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 5: The models — `tres_settings` and `tres_deliveries`

Spec D3 and D6, in the admission/ORM world, on the pattern of `protocol/models.py` (a per-tenant settings row, `tenant_id` the primary key, `ON DELETE CASCADE`). The two password columns and `last_error` are `EncryptedString(PHI_COLUMN_LENGTH)`, as `admission/models.py` types its PHI columns; `enabled_types` is `JSON_COLUMN` (`homunculus.db`). `tests/conftest.py` imports every `homunculus.*.models` module by walking the package, so `db_session` creates and drops the two tables without any change there.

What later tasks use from this file: `TresSettings`, `TresDelivery`, `account_of(settings, environment=None) -> TresAccount | None`, and the tuples `RESOURCE_TYPES`, `MODES`, `ENVIRONMENTS`, `STATUSES`, `OPERATIONS`, `ACCOUNT_FIELDS`, `SESSION_FIELDS`, `DEFAULT_SETTLE_HOURS`, `ALL_TYPES_JSON`.

**Files:**
- Create: `homunculus-engine/src/homunculus/tres/models.py`
- Test: `homunculus-engine/tests/test_tres_models.py`

- [ ] **Step 1: Write the failing test**

```python
# homunculus-engine/tests/test_tres_models.py
"""TRƏS-01 (spec D3, D6): the two tables as the models map them — the defaults (mode `off`,
environment `test`, every type on, 24 hours), the CHECKs, the ledger's key with the environment in
it, the password and the platform's message encrypted at rest, both gone with their tenant — and
`account_of`, which needs no database. The DB part runs on Postgres. Synthetic tenant only."""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from homunculus.tenant.models import Tenant
from homunculus.tres.client import TresAccount
from homunculus.tres.models import (
    ACCOUNT_FIELDS, ENVIRONMENTS, MODES, OPERATIONS, RESOURCE_TYPES, SESSION_FIELDS, STATUSES,
    TresDelivery, TresSettings, account_of,
)
from tests.conftest import requires_db


# ---------------------------------------------------------------- no database
def test_the_vocabulary_is_the_specs():
    assert RESOURCE_TYPES == ("patient", "practitioner", "encounter", "condition", "procedure",
                              "vital", "lab", "composition")
    assert MODES == ("off", "validate", "send") and ENVIRONMENTS == ("test", "live")
    assert STATUSES == ("pending", "sent", "validated", "failed", "skipped", "stuck", "deleted")
    assert OPERATIONS == ("create", "update", "validate", "delete")
    assert set(SESSION_FIELDS) < set(ACCOUNT_FIELDS)
    for prefix in ENVIRONMENTS:
        for name in ACCOUNT_FIELDS:
            assert hasattr(TresSettings, f"{prefix}_{name}")


def _settings(**values) -> TresSettings:
    return TresSettings(tenant_id=uuid.uuid4(), mode="send", environment="test", **values)


def test_the_account_is_the_selected_environments_and_only_when_whole():
    whole = _settings(test_base_url="https://tres.test", test_username="sentetik",
                      test_password="gizli-parola", test_provider_id="PRV-0001")
    assert account_of(whole) == TresAccount("https://tres.test", "sentetik", "gizli-parola", "PRV-0001")
    assert account_of(whole, "live") is None            # the other environment has nothing
    whole.environment = "live"
    assert account_of(whole) is None
    assert account_of(whole, "test") is not None
    for missing in ("test_base_url", "test_username", "test_password", "test_provider_id"):
        partial = _settings(test_base_url="https://tres.test", test_username="sentetik",
                            test_password="gizli-parola", test_provider_id="PRV-0001")
        setattr(partial, missing, None)
        assert account_of(partial) is None, missing
        setattr(partial, missing, "  ")
        assert account_of(partial) is None, missing


# ---------------------------------------------------------------- Postgres
async def _tenant(db, slug: str = "tres-hastane") -> Tenant:
    tenant = Tenant(name="Sentetik TRƏS Hastanesi", slug=slug, country_code="AZ", timezone="Asia/Baku")
    db.add(tenant)
    await db.commit()
    return tenant


@requires_db
async def test_a_settings_row_defaults_to_off_test_every_type_and_24_hours(db_session):
    tenant = await _tenant(db_session)
    db_session.add(TresSettings(tenant_id=tenant.id))
    await db_session.commit()
    db_session.expire_all()
    row = (await db_session.execute(select(TresSettings))).scalar_one()
    assert (row.mode, row.environment, row.settle_hours) == ("off", "test", 24)
    assert row.enabled_types == list(RESOURCE_TYPES)
    assert row.test_password is None and row.live_base_url is None
    assert row.updated_at is not None and row.updated_by is None
    # …and the database's own defaults say the same, for a row written without the model.
    other = await _tenant(db_session, "tres-hastane-2")
    await db_session.execute(text("INSERT INTO tres_settings (tenant_id) VALUES (:t)"), {"t": other.id})
    await db_session.commit()
    raw = (await db_session.execute(text(
        "SELECT mode, environment, settle_hours, enabled_types::text FROM tres_settings WHERE tenant_id = :t"),
        {"t": other.id})).one()
    assert tuple(raw[:3]) == ("off", "test", 24)
    assert raw[3].replace(" ", "") == '["patient","practitioner","encounter","condition","procedure","vital","lab","composition"]'


@requires_db
@pytest.mark.parametrize("values", [{"mode": "on"}, {"environment": "prod"}, {"settle_hours": -1},
                                    {"settle_hours": 169}])
async def test_the_settings_checks_refuse(db_session, values):
    tenant = await _tenant(db_session)
    db_session.add(TresSettings(tenant_id=tenant.id, **values))
    with pytest.raises(IntegrityError):
        await db_session.commit()


@requires_db
async def test_the_password_is_ciphertext_at_rest_and_plain_to_the_model(db_session):
    tenant = await _tenant(db_session)
    db_session.add(TresSettings(tenant_id=tenant.id, test_password="gizli-parola", live_password="canlı-parola"))
    await db_session.commit()
    stored = (await db_session.execute(text("SELECT test_password, live_password FROM tres_settings"))).one()
    for value, plain in zip(stored, ("gizli-parola", "canlı-parola")):
        assert value.startswith("enc::v1::") and plain not in value
    db_session.expire_all()
    row = (await db_session.execute(select(TresSettings))).scalar_one()
    assert (row.test_password, row.live_password) == ("gizli-parola", "canlı-parola")


def _delivery(tenant: Tenant, **values) -> TresDelivery:
    return TresDelivery(**{"tenant_id": tenant.id, "environment": "test", "resource_type": "patient",
                           "local_id": "hmn-p-0001", **values})


@requires_db
async def test_a_delivery_starts_pending_and_its_message_is_ciphertext_at_rest(db_session):
    tenant = await _tenant(db_session)
    db_session.add(_delivery(tenant, last_error="Patient.name: Sentetik Ayşe"))
    await db_session.commit()
    stored = (await db_session.execute(text("SELECT last_error FROM tres_deliveries"))).scalar_one()
    assert stored.startswith("enc::v1::") and "Sentetik" not in stored
    db_session.expire_all()
    row = (await db_session.execute(select(TresDelivery))).scalar_one()
    assert (row.status, row.attempts, row.operation, row.remote_id, row.payload_digest) == (
        "pending", 0, None, None, None)
    assert row.last_error == "Patient.name: Sentetik Ayşe"
    assert row.created_at is not None and row.updated_at is not None


@requires_db
async def test_one_row_per_tenant_environment_type_and_local_id(db_session):
    tenant = await _tenant(db_session)
    db_session.add_all([_delivery(tenant), _delivery(tenant, environment="live"),
                        _delivery(tenant, resource_type="practitioner"),
                        _delivery(tenant, local_id="hmn-p-0002")])
    await db_session.commit()                             # four different keys
    db_session.add(_delivery(tenant))
    with pytest.raises(IntegrityError, match="uq_tres_deliveries_key"):
        await db_session.commit()


@requires_db
@pytest.mark.parametrize("values", [{"status": "done"}, {"operation": "patch"}, {"environment": "prod"}])
async def test_the_delivery_checks_refuse(db_session, values):
    tenant = await _tenant(db_session)
    db_session.add(_delivery(tenant, **values))
    with pytest.raises(IntegrityError):
        await db_session.commit()


@requires_db
async def test_both_tables_go_with_their_tenant(db_session):
    tenant = await _tenant(db_session)
    db_session.add_all([TresSettings(tenant_id=tenant.id), _delivery(tenant)])
    await db_session.commit()
    await db_session.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tenant.id})
    await db_session.commit()
    for table in ("tres_settings", "tres_deliveries"):
        assert (await db_session.execute(text(f"SELECT count(*) FROM {table}"))).scalar_one() == 0
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_tres_models.py 2>&1 | tail -3`
Expected: FAIL — `ModuleNotFoundError: No module named 'homunculus.tres.models'`.

- [ ] **Step 3: Write the models**

```python
# homunculus-engine/src/homunculus/tres/models.py
"""`tres_settings` and `tres_deliveries` (migration 0019; TRƏS-01 spec D3, D6).

`tres_settings` — one row per tenant, none until the administrator saves the tab (no row reads as
the defaults: mode `off`, environment `test`):
* `mode`         the tenant's lock (D2 (a)): `off` · `validate` (the platform checks, stores
                 nothing) · `send`. The install's lock is `TRES_EGRESS` (egress.py).
* `environment`  which of the two accounts is in use: `test` (the sandbox) or `live`.
* `test_*`, `live_*`  each environment's account: the base URL (https only), the username, the
                 password, the provider id the session is opened for, and the hospital's
                 Organization id and name (an Encounter's `serviceProvider`, a Composition's
                 `custodian`). THE PASSWORD IS THE FIRST SECRET KEPT IN A TABLE rather than in the
                 environment: an `EncryptedString` (Fernet, the PHI key), and no route ever returns
                 it — only whether one is set (router.py).
* `enabled_types`  the resource types this tenant sends, as the ledger's keys (RESOURCE_TYPES).
* `settle_hours`   how long after a discharge a stay waits before it is sent (D9), 0–168.

`tres_deliveries` — the ledger (D6): one row per (tenant, environment, resource type, local id).
A sandbox success never counts for live: the environment is in the key. NO REQUEST OR RESPONSE
BODY IS STORED — a body is PHI and can be rebuilt on demand; `payload_digest` (a keyed digest,
`crypto.phi_digest`) is what tells a changed resource from an unchanged one (D7). `last_error` is
the platform's own message, which may echo a value, so it is encrypted too. `reason` is a
catalogue code for a skip (`fin_missing`, `unit_unmapped`…), never free text.

`resource_type` is the LEDGER's key (`vital`, `lab`, `patient`…), not the FHIR type: two of them
are both `Observation` on the platform."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    CheckConstraint, DateTime, ForeignKey, Index, Integer, SmallInteger, String, UniqueConstraint,
    func, text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from homunculus.admission.models import PHI_COLUMN_LENGTH
from homunculus.crypto import EncryptedString
from homunculus.db import Base, JSON_COLUMN
from homunculus.tres.client import TresAccount

#: The resource types a tenant switches on or off, in the order of the package (spec D1, D8).
RESOURCE_TYPES: tuple[str, ...] = (
    "patient", "practitioner", "encounter", "condition", "procedure", "vital", "lab", "composition")
MODES: tuple[str, ...] = ("off", "validate", "send")
ENVIRONMENTS: tuple[str, ...] = ("test", "live")
STATUSES: tuple[str, ...] = ("pending", "sent", "validated", "failed", "skipped", "stuck", "deleted")
OPERATIONS: tuple[str, ...] = ("create", "update", "validate", "delete")
#: The parts of one environment's account, as the columns are named after the `test_` / `live_` prefix.
ACCOUNT_FIELDS: tuple[str, ...] = (
    "base_url", "username", "password", "provider_id", "organization_id", "organization_name")
#: The four a session cannot be opened without.
SESSION_FIELDS: tuple[str, ...] = ("base_url", "username", "password", "provider_id")
DEFAULT_SETTLE_HOURS = 24
#: `enabled_types`' default as the column's own: every type on.
ALL_TYPES_JSON = json.dumps(list(RESOURCE_TYPES))


def _now() -> datetime:
    return datetime.now(timezone.utc)


class TresSettings(Base):
    __tablename__ = "tres_settings"
    __table_args__ = (
        CheckConstraint("mode IN ('off', 'validate', 'send')", name="ck_tres_settings_mode"),
        CheckConstraint("environment IN ('test', 'live')", name="ck_tres_settings_environment"),
        CheckConstraint("settle_hours BETWEEN 0 AND 168", name="ck_tres_settings_settle"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True)
    mode: Mapped[str] = mapped_column(String(16), nullable=False, default="off",
                                      server_default=text("'off'"))
    environment: Mapped[str] = mapped_column(String(8), nullable=False, default="test",
                                             server_default=text("'test'"))

    test_base_url: Mapped[str | None] = mapped_column(String(200), nullable=True)
    test_username: Mapped[str | None] = mapped_column(String(120), nullable=True)
    test_password: Mapped[str | None] = mapped_column(EncryptedString(PHI_COLUMN_LENGTH), nullable=True)
    test_provider_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    test_organization_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    test_organization_name: Mapped[str | None] = mapped_column(String(200), nullable=True)

    live_base_url: Mapped[str | None] = mapped_column(String(200), nullable=True)
    live_username: Mapped[str | None] = mapped_column(String(120), nullable=True)
    live_password: Mapped[str | None] = mapped_column(EncryptedString(PHI_COLUMN_LENGTH), nullable=True)
    live_provider_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    live_organization_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    live_organization_name: Mapped[str | None] = mapped_column(String(200), nullable=True)

    enabled_types: Mapped[list] = mapped_column(
        JSON_COLUMN, nullable=False, default=lambda: list(RESOURCE_TYPES),
        server_default=text(f"'{ALL_TYPES_JSON}'"))
    settle_hours: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, default=DEFAULT_SETTLE_HOURS,
        server_default=text(str(DEFAULT_SETTLE_HOURS)))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, server_default=func.now())
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)


class TresDelivery(Base):
    __tablename__ = "tres_deliveries"
    __table_args__ = (
        UniqueConstraint("tenant_id", "environment", "resource_type", "local_id",
                         name="uq_tres_deliveries_key"),
        Index("ix_tres_deliveries_tenant_status", "tenant_id", "status"),
        CheckConstraint("environment IN ('test', 'live')", name="ck_tres_deliveries_environment"),
        CheckConstraint("status IN ('pending', 'sent', 'validated', 'failed', 'skipped', 'stuck', "
                        "'deleted')", name="ck_tres_deliveries_status"),
        CheckConstraint("operation IS NULL OR operation IN ('create', 'update', 'validate', 'delete')",
                        name="ck_tres_deliveries_operation"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    environment: Mapped[str] = mapped_column(String(8), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(32), nullable=False)
    local_id: Mapped[str] = mapped_column(String(96), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending",
                                        server_default=text("'pending'"))
    operation: Mapped[str | None] = mapped_column(String(16), nullable=True)
    remote_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    payload_digest: Mapped[str | None] = mapped_column(String(64), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reason: Mapped[str | None] = mapped_column(String(48), nullable=True)
    last_error: Mapped[str | None] = mapped_column(EncryptedString(PHI_COLUMN_LENGTH), nullable=True)
    admission_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("admissions.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now, server_default=func.now())


def account_of(settings: TresSettings, environment: str | None = None) -> TresAccount | None:
    """The account a session is opened with in `environment` (the row's own by default), or None
    while any of its four parts is missing: such a tenant is not worked, and its connection test
    answers `tres_account_incomplete`."""
    prefix = environment or settings.environment
    parts = [getattr(settings, f"{prefix}_{name}") for name in SESSION_FIELDS]
    if not all(isinstance(part, str) and part.strip() for part in parts):
        return None
    return TresAccount(*parts)
```

- [ ] **Step 4: Run without the database, then with it**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_tres_models.py tests/test_conftest_tables.py 2>&1 | tail -3`
Expected: PASS — `6 passed, 12 skipped`.

Run: `cd /c/tmp/tres/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_tres_models.py 2>&1 | tail -3`
Expected: PASS — `14 passed` (about a minute).

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/tres && git add homunculus-engine/src/homunculus/tres/models.py homunculus-engine/tests/test_tres_models.py && git commit -m "feat(tres-01): tres_settings and tres_deliveries — the tenant's mode, its two accounts with the password encrypted, the ledger keyed by environment (spec D3, D6)" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 6: Migration 0020 — the two tables

`0020_tres.py`, `revision = "0020"`, `down_revision = "0019"` (ground rules: the number may have to move at merge). It creates exactly the two tables Task 5 modelled, with their CHECKs, the ledger's unique key and its index. **It writes no permission row**: `tres.manage` is in no default group and the system group holds it by rule — `0019_pharmacy_view.py`'s own docstring says the same of `hospital_admin`, and `summary.view` had no migration at all. The downgrade drops exactly these two tables. No `op.execute` is needed (when a later phase adds one: ONE STATEMENT PER `op.execute`, asyncpg).

The test runs on the real chain (`clean_db`, `tests/conftest.py` ~lines 152–176), on the pattern of `tests/test_migration_0015_protocol.py` and `tests/test_migration_0019_pharmacy_view.py`. The migration imports no model, so its copies of two constants are held to the models' by a test that needs no database.

**Files:**
- Create: `homunculus-engine/alembic/versions/0020_tres.py`
- Test: `homunculus-engine/tests/test_migration_0020_tres.py`

- [ ] **Step 1: Write the failing test**

```python
# homunculus-engine/tests/test_migration_0020_tres.py
"""Migration 0020 (TRƏS-01, spec D3, D6, D23, D26) on the real chain (`clean_db`, never
`create_all`): purely additive — `tres_settings` (one row per tenant, none written: no row reads
as "off") and `tres_deliveries` (the ledger). The defaults, the CHECKs, the ledger's key with the
environment in it, the settings and the ledger gone with their tenant, a ledger row outliving its
admission; NO permission row for `tres.manage` (the system group holds it by rule); the model
agrees with the migration; 0019 → 0020 → 0019 → 0020 runs and the downgrade drops exactly the two
tables. The migration's two constants are the models' (no database for that one). Synthetic rows
only. F1–F5 extend this file with their tables (D26)."""
from __future__ import annotations

import importlib.util
import uuid
from pathlib import Path

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

import homunculus.admission.models  # noqa: F401  (register every table on Base.metadata)
import homunculus.auth.models  # noqa: F401
import homunculus.escalation.models  # noqa: F401
import homunculus.tenant.models  # noqa: F401
import homunculus.tres.models  # noqa: F401
from homunculus.admission.models import PHI_COLUMN_LENGTH
from homunculus.db import Base
from homunculus.tres.models import ALL_TYPES_JSON, RESOURCE_TYPES
from tests.conftest import requires_db

SETTINGS, DELIVERIES = "tres_settings", "tres_deliveries"
KEY, INDEX = "uq_tres_deliveries_key", "ix_tres_deliveries_tenant_status"
CHECKS = {"ck_tres_settings_mode", "ck_tres_settings_environment", "ck_tres_settings_settle",
          "ck_tres_deliveries_environment", "ck_tres_deliveries_status", "ck_tres_deliveries_operation"}


def _migration():
    """The migration module, loaded by its path (its name starts with a digit)."""
    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0020_tres.py"
    spec = importlib.util.spec_from_file_location("migration_0020_tres", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_migrations_constants_are_the_models():
    """No database. The migration imports no model, so its copy of the default and of the
    ciphertext width is held to the models' here."""
    migration = _migration()
    assert migration.ALL_TYPES == ALL_TYPES_JSON
    assert migration.CIPHERTEXT == PHI_COLUMN_LENGTH
    assert (migration.revision, migration.down_revision) == ("0020", "0019")


def _tenant(conn, slug: str) -> uuid.UUID:
    tid = uuid.uuid4()
    conn.execute(text("INSERT INTO tenants (id, name, slug, country_code) VALUES (:id, :n, :s, 'AZ')"),
                 {"id": tid, "n": f"Sentetik {slug}", "s": slug})
    return tid


def _admission(conn, tenant: uuid.UUID) -> uuid.UUID:
    """A patient and one DISCHARGED admission on a bed of the tenant (as test_migration_0015)."""
    site, unit, room, bed, patient, admission = (uuid.uuid4() for _ in range(6))
    conn.execute(text("INSERT INTO sites (id, tenant_id, name) VALUES (:id, :t, 'Ana bina')"),
                 {"id": site, "t": tenant})
    conn.execute(text("INSERT INTO units (id, site_id, name, unit_type) "
                      "VALUES (:id, :s, 'Reanimasiya', 'ADULT_ICU')"), {"id": unit, "s": site})
    conn.execute(text("INSERT INTO rooms (id, unit_id, name) VALUES (:id, :u, 'Otaq 1')"),
                 {"id": room, "u": unit})
    conn.execute(text("INSERT INTO beds (id, room_id, label) VALUES (:id, :r, '1')"),
                 {"id": bed, "r": room})
    conn.execute(text("INSERT INTO patients (id, tenant_id, display_name, date_of_birth, sex, "
                      "patient_number, created_at) VALUES (:id, :t, 'x', 'x', 'x', 'H2600001', now())"),
                 {"id": patient, "t": tenant})
    conn.execute(text(
        "INSERT INTO admissions (id, patient_id, tenant_id, state, admission_datetime, "
        "admitting_unit_id, bed_id, admission_diagnosis_free_text) "
        "VALUES (:id, :p, :t, 'DISCHARGED', now(), :u, :b, 'Sentetik tanı')"),
        {"id": admission, "p": patient, "t": tenant, "u": unit, "b": bed})
    return admission


def _delivery(conn, tenant: uuid.UUID, **columns) -> uuid.UUID:
    did = uuid.uuid4()
    values = {"id": did, "tenant_id": tenant, "environment": "test", "resource_type": "patient",
              "local_id": "hmn-p-0001", **columns}
    names = ", ".join(values)
    binds = ", ".join(f":{name}" for name in values)
    conn.execute(text(f"INSERT INTO {DELIVERIES} ({names}) VALUES ({binds})"), values)
    return did


@requires_db
def test_0020_adds_the_two_tables_and_writes_no_row_and_no_permission(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "0019")
    before = set(inspect(engine).get_table_names())
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        conn.execute(text(
            "INSERT INTO groups (id, tenant_id, slug, name, description, mfa_required, is_system, "
            "created_at, updated_at) VALUES (gen_random_uuid(), :t, 'hospital_admin', 'Sistem Yöneticisi', "
            "'', true, true, now(), now())"), {"t": tenant})
    command.upgrade(cfg, "0020")
    assert set(inspect(engine).get_table_names()) - before == {SETTINGS, DELIVERIES}
    with engine.connect() as conn:
        assert conn.execute(text(f"SELECT count(*) FROM {SETTINGS}")).scalar_one() == 0
        assert conn.execute(text(f"SELECT count(*) FROM {DELIVERIES}")).scalar_one() == 0
        # D23: the system group holds `tres.manage` by rule; no row is seeded for it.
        assert conn.execute(text(
            "SELECT count(*) FROM group_permissions WHERE permission = 'tres.manage'")).scalar_one() == 0
    command.downgrade(cfg, "0019")
    assert set(inspect(engine).get_table_names()) == before
    with engine.connect() as conn:
        assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0019"
        assert conn.execute(text("SELECT count(*) FROM tenants")).scalar_one() == 1


@requires_db
def test_settings_default_to_off_test_every_type_and_24_hours_and_the_checks_hold(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        conn.execute(text(f"INSERT INTO {SETTINGS} (tenant_id) VALUES (:t)"), {"t": tenant})
        row = conn.execute(text(
            f"SELECT mode, environment, settle_hours, enabled_types, test_password, live_base_url, "
            f"updated_at IS NOT NULL, updated_by FROM {SETTINGS}")).one()
    assert tuple(row) == ("off", "test", 24, list(RESOURCE_TYPES), None, None, True, None)
    for bad in ("mode = 'on'", "environment = 'prod'", "settle_hours = -1", "settle_hours = 169"):
        with pytest.raises(IntegrityError, match="ck_tres_settings_"), engine.begin() as conn:
            conn.execute(text(f"UPDATE {SETTINGS} SET {bad}"))
    with engine.begin() as conn:
        conn.execute(text(f"UPDATE {SETTINGS} SET mode = 'send', environment = 'live', settle_hours = 168"))
        conn.execute(text(f"UPDATE {SETTINGS} SET mode = 'validate', settle_hours = 0"))


@requires_db
def test_the_ledgers_key_holds_the_environment_and_its_checks_hold(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        a, b = _tenant(conn, "hastane-a"), _tenant(conn, "hastane-b")
        first = _delivery(conn, a)
        _delivery(conn, a, environment="live")            # a sandbox row never stands for live
        _delivery(conn, a, resource_type="practitioner")
        _delivery(conn, a, local_id="hmn-p-0002")
        _delivery(conn, b)                                # another tenant
        row = conn.execute(text(f"SELECT status, attempts, operation, remote_id, created_at IS NOT NULL, "
                                f"updated_at IS NOT NULL FROM {DELIVERIES} WHERE id = :id"), {"id": first}).one()
    assert tuple(row) == ("pending", 0, None, None, True, True)
    with pytest.raises(IntegrityError, match=KEY), engine.begin() as conn:
        _delivery(conn, a)
    for bad in ({"status": "done"}, {"operation": "patch"}, {"environment": "prod"}):
        with pytest.raises(IntegrityError, match="ck_tres_deliveries_"), engine.begin() as conn:
            _delivery(conn, a, local_id="hmn-p-0009", **bad)
    with engine.begin() as conn:
        for status in ("sent", "validated", "failed", "skipped", "stuck", "deleted", "pending"):
            conn.execute(text(f"UPDATE {DELIVERIES} SET status = :s WHERE id = :id"), {"s": status, "id": first})
        for operation in ("create", "update", "validate", "delete"):
            conn.execute(text(f"UPDATE {DELIVERIES} SET operation = :o WHERE id = :id"), {"o": operation, "id": first})


@requires_db
def test_a_ledger_row_outlives_its_admission_and_both_tables_go_with_the_tenant(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        admission = _admission(conn, tenant)
        delivery = _delivery(conn, tenant, admission_id=admission)
        conn.execute(text(f"INSERT INTO {SETTINGS} (tenant_id) VALUES (:t)"), {"t": tenant})
        conn.execute(text("DELETE FROM admissions WHERE id = :id"), {"id": admission})
        assert conn.execute(text(f"SELECT admission_id FROM {DELIVERIES} WHERE id = :id"),
                            {"id": delivery}).scalar_one() is None                 # SET NULL
        conn.execute(text("DELETE FROM patients WHERE tenant_id = :t"), {"t": tenant})
        conn.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tenant})
        assert conn.execute(text(f"SELECT count(*) FROM {DELIVERIES}")).scalar_one() == 0   # CASCADE
        assert conn.execute(text(f"SELECT count(*) FROM {SETTINGS}")).scalar_one() == 0


@requires_db
def test_the_model_and_the_migration_agree_and_the_round_trip_runs(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    command.downgrade(cfg, "0019")
    command.upgrade(cfg, "0020")

    def only_0020(object_, name, type_, reflected, compare_to):
        if type_ == "table":
            return name in {SETTINGS, DELIVERIES}
        if type_ == "column":
            return (object_.table.name if object_ is not None else None) in {SETTINGS, DELIVERIES}
        if type_ in ("index", "unique_constraint"):
            return name in {INDEX, KEY}
        return False

    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn, opts={
            "compare_type": True, "compare_server_default": False, "include_object": only_0020})
        assert compare_metadata(ctx, Base.metadata) == []
        # compare_metadata reads no CHECK: they are read here, by name.
        checks = set(conn.execute(text(
            "SELECT conname FROM pg_constraint WHERE contype = 'c' AND conname LIKE 'ck_tres_%'")).scalars())
        indexes = set(conn.execute(text(
            "SELECT indexname FROM pg_indexes WHERE tablename = :t"), {"t": DELIVERIES}).scalars())
    assert checks == CHECKS
    assert {INDEX, KEY} <= indexes
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_migration_0020_tres.py 2>&1 | tail -3`
Expected: FAIL — `1 failed, 5 skipped`: `FileNotFoundError` for `alembic/versions/0020_tres.py`.

- [ ] **Step 3: Write the migration**

```python
# homunculus-engine/alembic/versions/0020_tres.py
"""TRƏS-01 (spec 2026-11-11, D3, D6, D26): `tres_settings` and `tres_deliveries`

Revision 0020, follows G3-04's 0019 (pharmacy_view). THIS ONE FILE IS THE WHOLE SLICE'S
MIGRATION (D26): while the branch is unmerged, each later phase adds its tables here (F1 the
practitioner identities and the department map, F2 the code lists and the diagnoses, F3 the
procedures, F4 the laboratory code map, F5 the discharge summaries) and extends the downgrade and
the test with them. Phase F0 creates the two tables it has models for:

* `tres_settings`: one row per tenant (FK tenants ON DELETE CASCADE) — `mode` off|validate|send
  (default off), `environment` test|live (default test), each environment's account (`test_*`,
  `live_*`: base URL, username, password, provider id, Organization id and name), `enabled_types`
  (JSONB, default all eight), `settle_hours` (0–168, default 24), `updated_at`, `updated_by`. The
  two password columns hold Fernet ciphertext (`EncryptedString`). NO ROW is written: a tenant with
  no row reads as the defaults, and the feed is off.
* `tres_deliveries`: the ledger, one row per (tenant, environment, resource type, local id) —
  status, operation, the platform's id, the payload's keyed digest, the attempt count and the next
  attempt's time, a skip's reason code, the platform's last message (Fernet ciphertext) and the
  admission it belongs to (FK admissions ON DELETE SET NULL). No request or response body.

NO PERMISSION ROW is written for `tres.manage` (D23): it is in no default group, and the system
group holds every key by rule at token issuance (auth/permissions.py) — as `summary.view` before it.

PURELY ADDITIVE: an image from before this revision serves against it (it never reads the new
tables); only its start command's `alembic upgrade head` refuses the unknown revision. Downgrade
drops exactly these two tables — and with them every tenant's account and the whole ledger.
ONE STATEMENT PER op.execute (asyncpg; see 0004, 0010, 0013) — this revision needs none.

Revision ID: 0020
Revises: 0019
Create Date: 2026-11-11
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "0020"
down_revision: Union[str, None] = "0019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SETTINGS = "tres_settings"
DELIVERIES = "tres_deliveries"
STATUS_INDEX = "ix_tres_deliveries_tenant_status"
#: homunculus.tres.models.ALL_TYPES_JSON — written out: a migration does not import the models.
ALL_TYPES = ('["patient", "practitioner", "encounter", "condition", "procedure", "vital", "lab", '
             '"composition"]')
#: admission/models.py PHI_COLUMN_LENGTH: the width of an `EncryptedString` column.
CIPHERTEXT = 1536


def _account(prefix: str) -> list[sa.Column]:
    return [
        sa.Column(f"{prefix}_base_url", sa.String(200), nullable=True),
        sa.Column(f"{prefix}_username", sa.String(120), nullable=True),
        sa.Column(f"{prefix}_password", sa.String(CIPHERTEXT), nullable=True),
        sa.Column(f"{prefix}_provider_id", sa.String(64), nullable=True),
        sa.Column(f"{prefix}_organization_id", sa.String(64), nullable=True),
        sa.Column(f"{prefix}_organization_name", sa.String(200), nullable=True),
    ]


def upgrade() -> None:
    op.create_table(
        SETTINGS,
        sa.Column("tenant_id", UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("mode", sa.String(16), nullable=False, server_default=sa.text("'off'")),
        sa.Column("environment", sa.String(8), nullable=False, server_default=sa.text("'test'")),
        *_account("test"),
        *_account("live"),
        sa.Column("enabled_types", JSONB(), nullable=False, server_default=sa.text(f"'{ALL_TYPES}'")),
        sa.Column("settle_hours", sa.SmallInteger(), nullable=False, server_default=sa.text("24")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_by", UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint("mode IN ('off', 'validate', 'send')", name="ck_tres_settings_mode"),
        sa.CheckConstraint("environment IN ('test', 'live')", name="ck_tres_settings_environment"),
        sa.CheckConstraint("settle_hours BETWEEN 0 AND 168", name="ck_tres_settings_settle"),
    )
    op.create_table(
        DELIVERIES,
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("environment", sa.String(8), nullable=False),
        sa.Column("resource_type", sa.String(32), nullable=False),
        sa.Column("local_id", sa.String(96), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("operation", sa.String(16), nullable=True),
        sa.Column("remote_id", sa.String(64), nullable=True),
        sa.Column("payload_digest", sa.String(64), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reason", sa.String(48), nullable=True),
        sa.Column("last_error", sa.String(CIPHERTEXT), nullable=True),
        sa.Column("admission_id", UUID(as_uuid=True),
                  sa.ForeignKey("admissions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "environment", "resource_type", "local_id",
                            name="uq_tres_deliveries_key"),
        sa.CheckConstraint("environment IN ('test', 'live')", name="ck_tres_deliveries_environment"),
        sa.CheckConstraint("status IN ('pending', 'sent', 'validated', 'failed', 'skipped', 'stuck', "
                           "'deleted')", name="ck_tres_deliveries_status"),
        sa.CheckConstraint("operation IS NULL OR operation IN ('create', 'update', 'validate', "
                           "'delete')", name="ck_tres_deliveries_operation"),
    )
    op.create_index(STATUS_INDEX, DELIVERIES, ["tenant_id", "status"])


def downgrade() -> None:
    op.drop_index(STATUS_INDEX, table_name=DELIVERIES)
    op.drop_table(DELIVERIES)
    op.drop_table(SETTINGS)
```

- [ ] **Step 4: Run without the database, then on the real chain**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_migration_0020_tres.py 2>&1 | tail -3`
Expected: PASS — `1 passed, 5 skipped`.

Run: `cd /c/tmp/tres/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_migration_0020_tres.py tests/test_migration_0019_pharmacy_view.py tests/test_migration_0010_schema_parity.py 2>&1 | tail -3`
Expected: PASS, no `failed` (the first file's six tests; 0019's own tests still pass with 0020 above it; the whole-schema type test agrees for the two new tables). If `compare_metadata` reports a difference for `tres_settings` or `tres_deliveries`, the model and the migration disagree: fix the MIGRATION to say what the model says, never the test.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/tres && git add homunculus-engine/alembic/versions/0020_tres.py homunculus-engine/tests/test_migration_0020_tres.py && git commit -m "feat(tres-01): migration 0020 — tres_settings and tres_deliveries; no permission row (the system group holds tres.manage by rule) (spec D3, D6, D23, D26)" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---


### Task 7: The ledger — `tres/ledger.py`

Spec D4, D6, D7, D21: one resource to the platform, its outcome on its row. `payload_digest` is `crypto.phi_digest` (a keyed HMAC; in tests the key is the development one `crypto._resolve_key` derives — no setup, only a logged warning) of the canonical JSON of the resource **without its `id`**. `deliver` commits every outcome before it returns. Note the two type words: `resource_type` is the ledger's key (`patient`, `vital`, `lab`…), `fhir_type` the platform's (`Patient`, `Observation`…).

What later tasks use from this file: `payload_digest(resource) -> str`; `async deliver(db, client, *, tenant_id, environment, mode, resource_type, fhir_type, local_id, resource, admission_id=None, now=None, force=False) -> TresDelivery`; `async record_skip(db, *, tenant_id, environment, resource_type, local_id, reason, admission_id=None) -> TresDelivery`; `due(row, now) -> bool`; `MAX_ATTEMPTS`, `RETRY_AFTER`.

**Files:**
- Create: `homunculus-engine/src/homunculus/tres/ledger.py`
- Test: `homunculus-engine/tests/test_tres_ledger.py`

- [ ] **Step 1: Write the failing test**

```python
# homunculus-engine/tests/test_tres_ledger.py
"""TRƏS-01 (spec D4, D6, D7, D21): the ledger against the stand-in (tests/fake_tres.py) — find,
then POST with the local id as the placeholder or PUT; the same payload never sent twice; a stale
platform id falling back to the search; `validate` storing nothing; a refusal counted, kept
(encrypted) and left alone for 30 minutes, `stuck` at the fifth; a 429 and a dead line recorded
and raised again; the environment in the key; a skip with its reason. The digest, the clip and
`due` need no database; the rest runs on Postgres. Synthetic tenant, synthetic people."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import func, select, text

from homunculus.admission.models import Admission, Patient
from homunculus.tenant.models import Bed, Room, Site, Tenant, Unit, UnitType
from homunculus.tres.client import LOCAL_ID_EXTENSION, TresClient, TresError
from homunculus.tres.ledger import (
    ERROR_MAX_BYTES, ERROR_MAX_CHARS, MAX_ATTEMPTS, RETRY_AFTER, clip_error, deliver, due,
    payload_digest, record_skip,
)
from homunculus.tres.models import TresDelivery
from tests.conftest import requires_db
from tests.fake_tres import FakeTres

T0 = datetime(2026, 11, 11, 8, 0, tzinfo=timezone.utc)
LOCAL = "hmn-p-0001"


def patient(given: str = "Ayşe", local_id: str = LOCAL) -> dict:
    return {"resourceType": "Patient", "meta": {"profile": ["http://fhir.az/StructureDefinition/az-patient"]},
            "extension": [{"url": LOCAL_ID_EXTENSION, "valueString": local_id}],
            "name": [{"family": "Sentetik", "given": [given]}]}


# ---------------------------------------------------------------- no database
def test_the_digest_ignores_the_id_and_the_key_order_and_sees_every_other_change():
    base = patient()
    assert payload_digest(base) == payload_digest({**base, "id": "7001"}) == payload_digest({**base, "id": LOCAL})
    assert payload_digest(base) == payload_digest(dict(reversed(list(base.items()))))
    assert payload_digest(base) != payload_digest(patient("Leyla"))
    assert payload_digest(base) != payload_digest({**base, "active": True})
    assert len(payload_digest(base)) == 64 and "Sentetik" not in payload_digest(base)


def test_a_message_is_clipped_to_500_characters_and_1000_bytes():
    assert clip_error("kısa") == "kısa" and clip_error("") == "" and clip_error(None) == ""
    assert len(clip_error("x" * 2000)) == ERROR_MAX_CHARS == 500
    wide = clip_error("ə" * 2000)                      # two bytes each
    assert len(wide) == 500 and len(wide.encode("utf-8")) == ERROR_MAX_BYTES == 1000
    emoji = clip_error("🩺" * 2000)                     # four bytes each: cut on a character boundary
    assert len(emoji.encode("utf-8")) == 1000 and emoji == "🩺" * 250


def test_an_unchanged_payload_is_due_unless_stuck_or_still_waiting():
    def row(status, wait=None):
        return TresDelivery(tenant_id=uuid.uuid4(), environment="test", resource_type="patient",
                            local_id=LOCAL, status=status, next_attempt_at=wait)

    assert due(row("pending"), T0) and due(row("sent"), T0) and due(row("skipped"), T0)
    assert not due(row("stuck"), T0)
    assert not due(row("failed", T0 + timedelta(minutes=1)), T0)
    assert due(row("failed", T0), T0) and due(row("failed", T0 - timedelta(minutes=1)), T0)
    assert due(row("failed"), T0)


# ---------------------------------------------------------------- Postgres
@pytest_asyncio.fixture
async def world(db_session):
    """A tenant, the stand-in and a client on it; `send(resource, **over)` delivers the patient."""
    tenant = Tenant(name="Sentetik TRƏS Hastanesi", slug="tres-hastane", country_code="AZ")
    db_session.add(tenant)
    await db_session.commit()
    fake = FakeTres()
    client = TresClient(fake.account, transport=fake.transport)

    async def send(resource: dict | None = None, **over) -> TresDelivery:
        values = {"tenant_id": tenant.id, "environment": "test", "mode": "send", "resource_type": "patient",
                  "fhir_type": "Patient", "local_id": LOCAL, "resource": resource or patient(), "now": T0, **over}
        return await deliver(db_session, client, **values)

    yield fake, send, tenant
    await client.aclose()


async def _rows(db_session) -> int:
    return (await db_session.execute(select(func.count()).select_from(TresDelivery))).scalar_one()


@requires_db
async def test_the_first_send_looks_the_local_id_up_and_posts_it_as_the_placeholder(world, db_session):
    fake, send, tenant = world
    row = await send()
    assert fake.fhir_requests == [("GET", "/fhir/Patient"), ("POST", "/fhir/Patient")]
    (stored,) = fake.stored("Patient")
    assert stored["id"] == row.remote_id == "7001" and stored["name"][0]["given"] == ["Ayşe"]
    assert (row.status, row.operation, row.attempts, row.last_error, row.next_attempt_at) == (
        "sent", "create", 0, None, None)
    assert row.payload_digest == payload_digest(patient())
    assert (row.tenant_id, row.environment, row.resource_type, row.local_id) == (tenant.id, "test", "patient", LOCAL)
    db_session.expire_all()
    (saved,) = (await db_session.execute(select(TresDelivery))).scalars()        # committed
    assert (saved.status, saved.remote_id) == ("sent", "7001")


@requires_db
async def test_the_same_payload_is_never_sent_twice_and_a_changed_one_is_put(world, db_session):
    fake, send, _ = world
    first = await send()
    again = await send()
    assert again.id == first.id and len(fake.fhir_requests) == 2          # nothing asked
    changed = await send(patient("Ayşe Nur"))
    assert fake.fhir_requests[2:] == [("PUT", "/fhir/Patient/7001")]      # the ledger's id is trusted
    assert (changed.status, changed.operation, changed.remote_id) == ("sent", "update", "7001")
    assert fake.resources["Patient"]["7001"]["name"][0]["given"] == ["Ayşe Nur"]
    assert await _rows(db_session) == 1


@requires_db
async def test_a_resource_the_platform_already_holds_is_found_and_put_never_posted_again(world):
    fake, send, _ = world
    fake.seed("Patient", "5005", patient("Eski"))          # the ledger was lost; the platform was not
    row = await send()
    assert fake.fhir_requests == [("GET", "/fhir/Patient"), ("PUT", "/fhir/Patient/5005")]
    assert (row.operation, row.remote_id) == ("update", "5005") and len(fake.stored("Patient")) == 1


@requires_db
async def test_a_stale_platform_id_falls_back_to_the_search_and_then_to_a_post(world):
    fake, send, _ = world
    await send()
    del fake.resources["Patient"]["7001"]                  # gone from the platform
    row = await send(patient("Ayşe Nur"))
    assert fake.fhir_requests[2:] == [("PUT", "/fhir/Patient/7001"), ("GET", "/fhir/Patient"),
                                      ("POST", "/fhir/Patient")]
    assert (row.status, row.operation, row.remote_id) == ("sent", "create", "7002")


@requires_db
async def test_validate_checks_and_stores_nothing_and_is_not_repeated_for_the_same_payload(world):
    fake, send, _ = world
    row = await send(mode="validate")
    assert fake.fhir_requests == [("POST", "/fhir/Patient/$validate")] and fake.stored("Patient") == []
    assert (row.status, row.operation, row.remote_id) == ("validated", "validate", None)
    await send(mode="validate")
    assert len(fake.fhir_requests) == 1
    sent = await send()                                    # the tenant moves to `send`
    assert (sent.status, sent.operation, sent.remote_id) == ("sent", "create", "7001")
    await send(mode="validate")                            # a sent payload is not validated again
    assert len(fake.fhir_requests) == 3 and sent.status == "sent"


@requires_db
async def test_a_refusal_is_counted_kept_encrypted_and_left_alone_for_thirty_minutes(world, db_session):
    fake, send, _ = world
    broken = {k: v for k, v in patient().items() if k != "meta"}
    row = await send(broken)
    assert (row.status, row.attempts, row.remote_id) == ("failed", 1, None)
    assert row.last_error == "meta.profile is required" and row.next_attempt_at == T0 + RETRY_AFTER
    stored = (await db_session.execute(text("SELECT last_error FROM tres_deliveries"))).scalar_one()
    assert stored.startswith("enc::v1::") and "profile" not in stored
    asked = len(fake.fhir_requests)
    await send(broken, now=T0 + timedelta(minutes=29))
    assert len(fake.fhir_requests) == asked                # still waiting
    row = await send(broken, now=T0 + timedelta(minutes=30))
    assert row.attempts == 2 and len(fake.fhir_requests) > asked


@requires_db
async def test_the_fifth_failure_is_stuck_until_forced_or_until_the_record_changes(world):
    fake, send, _ = world
    broken = {k: v for k, v in patient().items() if k != "meta"}
    for n in range(MAX_ATTEMPTS):
        row = await send(broken, now=T0 + n * RETRY_AFTER)
    assert (row.status, row.attempts) == ("stuck", 5)
    asked = len(fake.fhir_requests)
    await send(broken, now=T0 + timedelta(days=30))
    assert len(fake.fhir_requests) == asked                # stuck: not tried by a round
    row = await send(broken, now=T0 + timedelta(days=30), force=True)
    assert (row.status, row.attempts) == ("stuck", 6) and len(fake.fhir_requests) > asked
    row = await send(now=T0 + timedelta(days=30))          # the record was corrected
    assert (row.status, row.attempts, row.last_error, row.next_attempt_at) == ("sent", 0, None, None)


@requires_db
async def test_a_changed_record_is_tried_at_once_and_its_count_starts_again(world):
    fake, send, _ = world
    broken = {k: v for k, v in patient().items() if k != "meta"}
    await send(broken)
    await send(broken, now=T0 + RETRY_AFTER)
    other = {k: v for k, v in patient("Leyla").items() if k != "meta"}
    row = await send(other, now=T0 + RETRY_AFTER)          # no wait: the payload is another
    assert (row.status, row.attempts) == ("failed", 1)


@requires_db
async def test_a_429_is_recorded_and_raised_again_so_the_round_can_end(world):
    fake, send, _ = world
    fake.throttle(1, retry_after=120)
    with pytest.raises(TresError) as raised:
        await send()
    assert (raised.value.status, raised.value.retry_after) == (429, 120.0)
    row = await send(now=T0)                               # waiting: nothing asked
    assert (row.status, row.attempts, row.last_error) == ("failed", 1, "Too many requests")
    assert len(fake.fhir_requests) == 1


@requires_db
async def test_a_dead_line_is_recorded_and_raised_again(db_session):
    tenant = Tenant(name="Sentetik TRƏS Hastanesi", slug="tres-hastane", country_code="AZ")
    db_session.add(tenant)
    await db_session.commit()

    def refuse(request):
        raise httpx.ConnectError("connection refused", request=request)

    client = TresClient(FakeTres().account, transport=httpx.MockTransport(refuse))
    with pytest.raises(TresError) as raised:
        await deliver(db_session, client, tenant_id=tenant.id, environment="test", mode="send",
                      resource_type="patient", fhir_type="Patient", local_id=LOCAL, resource=patient(), now=T0)
    assert raised.value.status is None
    (row,) = (await db_session.execute(select(TresDelivery))).scalars()
    assert (row.status, row.attempts, row.last_error) == ("failed", 1, "ConnectError")
    await client.aclose()


@requires_db
async def test_a_sandbox_row_never_stands_for_live(world, db_session):
    fake, send, _ = world
    test_row = await send()
    live_row = await send(environment="live")              # (the stand-in plays both)
    assert test_row.id != live_row.id and await _rows(db_session) == 2
    assert {test_row.environment, live_row.environment} == {"test", "live"}


@requires_db
async def test_a_skip_is_a_row_with_its_reason_and_ends_when_the_resource_is_sent(world, db_session):
    fake, send, tenant = world
    key = {"tenant_id": tenant.id, "environment": "test", "resource_type": "patient", "local_id": LOCAL}
    row = await record_skip(db_session, **key, reason="fin_missing")
    assert (row.status, row.reason, row.attempts, row.remote_id) == ("skipped", "fin_missing", 0, None)
    again = await record_skip(db_session, **key, reason="fin_missing")
    assert again.id == row.id and await _rows(db_session) == 1 and fake.requests == []
    renamed = await record_skip(db_session, **key, reason="name_single")
    assert renamed.reason == "name_single"
    sent = await send()
    assert (sent.id, sent.status, sent.reason) == (row.id, "sent", None)


async def _admission(db_session, tenant: Tenant, label: str) -> uuid.UUID:
    """One synthetic stay on its own bed; only its id matters here."""
    site = Site(tenant_id=tenant.id, name=f"Bina {label}")
    db_session.add(site)
    await db_session.flush()
    unit = Unit(site_id=site.id, name="Reanimasiya", unit_type=UnitType.ADULT_ICU)
    db_session.add(unit)
    await db_session.flush()
    room = Room(unit_id=unit.id, name="Otaq 1")
    db_session.add(room)
    await db_session.flush()
    bed = Bed(room_id=room.id, label=label)
    person = Patient(tenant_id=tenant.id, display_name="Sentetik Ayşe", date_of_birth="1980-01-01",
                     sex="female", patient_number=f"H260000{label}")
    db_session.add_all([bed, person])
    await db_session.flush()
    admission = Admission(patient_id=person.id, tenant_id=tenant.id, admission_datetime=T0,
                          admitting_unit_id=unit.id, bed_id=bed.id,
                          admission_diagnosis_free_text="Sentetik tanı")
    db_session.add(admission)
    await db_session.commit()
    return admission.id


@requires_db
async def test_the_row_carries_the_admission_it_was_last_sent_for(world, db_session):
    fake, send, tenant = world
    first, second = await _admission(db_session, tenant, "1"), await _admission(db_session, tenant, "2")
    row = await send(admission_id=first)
    assert row.admission_id == first
    row = await send(admission_id=second)                  # the same person, a later stay: nothing asked
    assert row.admission_id == second and len(fake.fhir_requests) == 2
    row = await send()                                     # a caller that names no stay changes nothing
    assert row.admission_id == second
    db_session.expire_all()
    (saved,) = (await db_session.execute(select(TresDelivery))).scalars()
    assert saved.admission_id == second


@requires_db
async def test_the_mode_off_never_reaches_the_ledger(world):
    fake, send, _ = world
    with pytest.raises(ValueError):
        await send(mode="off")
    assert fake.requests == []
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_tres_ledger.py 2>&1 | tail -3`
Expected: FAIL — `ModuleNotFoundError: No module named 'homunculus.tres.ledger'`.

- [ ] **Step 3: Write the ledger**

```python
# homunculus-engine/src/homunculus/tres/ledger.py
"""The delivery ledger's rules (TRƏS-01, spec D4, D6, D7, D21): what one resource's row says, and
what is asked of the platform because of it.

`deliver` takes ONE resource to the platform and writes the outcome on its row — the row of
(tenant, environment, resource type, local id), made on first use:

* mode `validate` — the platform checks the resource and stores nothing; the row reads `validated`.
* mode `send`, the same payload as the last `sent` — nothing is asked (D7: the digest is exact).
* mode `send`, a platform id on the row — PUT to it; a 404 or «Non-existent reference» means the
  id went stale, and falls back to the search (§4.2).
* mode `send`, no platform id — find by the local id, then PUT, or POST with the local id as the
  placeholder `id` (D4). Another sender never collides: the local ids carry `hmn-` (D5).
* a refusal — the row reads `failed`, the attempt is counted, the platform's words are kept
  (encrypted: they may echo a value), and the same payload is not tried again for 30 minutes; the
  fifth failure in a row makes it `stuck`, which only `force` (the nightly retry, «Yeniden dene»)
  or a changed payload tries again (D21). A 429 and a failure with no answer are recorded the same
  way AND RE-RAISED, so the caller ends its round.

`record_skip` writes why a resource was not built (`fin_missing`, `unit_unmapped`… — a catalogue
code, never text).

EVERY OUTCOME IS COMMITTED BEFORE THIS RETURNS: a POST the platform took must not be forgotten by
a crash a moment later, or the next round would look it up again for nothing — and a ledger that
forgot a failure would hammer the platform. No body is stored and none is logged (D6, D25)."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.crypto import phi_digest
from homunculus.tres.client import TresClient, TresError
from homunculus.tres.models import TresDelivery

#: The failures in a row after which a resource is `stuck` (D21).
MAX_ATTEMPTS = 5
#: How long a failed payload waits before it is tried again.
RETRY_AFTER = timedelta(minutes=30)
#: The platform's words for a reference to a resource it does not hold (§4.2), as a PUT to a stale
#: id may answer.
NO_REFERENCE = "Non-existent reference"
#: `last_error` is at most this long in characters AND in UTF-8 bytes, so that its Fernet
#: ciphertext (≈1430 characters for 1000 bytes) fits the column (PHI_COLUMN_LENGTH, 1536).
ERROR_MAX_CHARS = 500
ERROR_MAX_BYTES = 1000


def payload_digest(resource: dict) -> str:
    """A keyed digest of the resource WITHOUT its `id` (D7): the canonical JSON — sorted keys,
    compact separators, no ASCII escapes — through `crypto.phi_digest`. The `id` is left out
    because it differs between a POST (the placeholder) and a PUT (the platform's)."""
    body = {key: value for key, value in resource.items() if key != "id"}
    return phi_digest(json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False))


def clip_error(message: str) -> str:
    """The platform's words, cut to what the column can hold once encrypted."""
    text = (message or "")[:ERROR_MAX_CHARS]
    return text.encode("utf-8")[:ERROR_MAX_BYTES].decode("utf-8", errors="ignore")


def due(row: TresDelivery, now: datetime) -> bool:
    """May an UNCHANGED payload be tried now? Not while `stuck`, and not while a `failed` row's
    wait has not run out. Every other row may."""
    if row.status == "stuck":
        return False
    if row.status == "failed" and row.next_attempt_at is not None:
        return now >= row.next_attempt_at
    return True


async def _row(db: AsyncSession, *, tenant_id: uuid.UUID, environment: str, resource_type: str,
               local_id: str, admission_id: uuid.UUID | None) -> TresDelivery:
    row = (await db.execute(select(TresDelivery).where(
        TresDelivery.tenant_id == tenant_id, TresDelivery.environment == environment,
        TresDelivery.resource_type == resource_type,
        TresDelivery.local_id == local_id))).scalar_one_or_none()
    if row is None:
        row = TresDelivery(tenant_id=tenant_id, environment=environment, resource_type=resource_type,
                           local_id=local_id, admission_id=admission_id, status="pending", attempts=0)
        db.add(row)
        await db.flush()
    elif admission_id is not None and row.admission_id != admission_id:
        row.admission_id = admission_id        # a person's row follows their latest stay
    return row


async def _write(client: TresClient, fhir_type: str, local_id: str, resource: dict,
                 remote_id: str | None) -> tuple[str, str]:
    """PUT or POST (§4.2); answers the platform's id and which of the two it was."""
    if remote_id:
        try:
            await client.update(fhir_type, remote_id, resource)
            return remote_id, "update"
        except TresError as exc:
            if exc.status != 404 and NO_REFERENCE not in exc.message:
                raise
    found = await client.find(fhir_type, local_id)
    if found:
        await client.update(fhir_type, found, resource)
        return found, "update"
    return await client.create(fhir_type, {**resource, "id": local_id}), "create"


async def deliver(db: AsyncSession, client: TresClient, *, tenant_id: uuid.UUID, environment: str,
                  mode: str, resource_type: str, fhir_type: str, local_id: str, resource: dict,
                  admission_id: uuid.UUID | None = None, now: datetime | None = None,
                  force: bool = False) -> TresDelivery:
    """One resource to the platform, its outcome on its ledger row (the module's docstring).
    `resource_type` is the ledger's key (`vital`, `lab`, `patient`…); `fhir_type` the platform's
    (`Observation`, `Patient`…). Returns the row; raises `TresError` again for a 429 and for a
    failure with no answer, after recording it."""
    if mode not in ("validate", "send"):
        raise ValueError(f"deliver() is for the modes validate and send, not {mode!r}")
    now = now or datetime.now(timezone.utc)
    digest = payload_digest(resource)
    row = await _row(db, tenant_id=tenant_id, environment=environment, resource_type=resource_type,
                     local_id=local_id, admission_id=admission_id)
    same = row.payload_digest == digest
    done = ("sent", "validated") if mode == "validate" else ("sent",)
    if same and (row.status in done or (not force and not due(row, now))):
        await db.commit()
        return row
    if not same:
        row.attempts = 0                       # a corrected record starts its count again
    try:
        if mode == "validate":
            await client.validate(fhir_type, {**resource, "id": local_id})
            remote_id, operation = row.remote_id, "validate"
        else:
            remote_id, operation = await _write(client, fhir_type, local_id, resource, row.remote_id)
    except TresError as exc:
        row.attempts += 1
        row.status = "stuck" if row.attempts >= MAX_ATTEMPTS else "failed"
        row.payload_digest = digest
        row.last_error = clip_error(exc.message)
        row.next_attempt_at = now + RETRY_AFTER
        await db.commit()
        if exc.status is None or exc.status == 429:
            raise
        return row
    row.status = "validated" if mode == "validate" else "sent"
    row.operation, row.remote_id, row.payload_digest = operation, remote_id, digest
    row.attempts, row.last_error, row.next_attempt_at, row.reason = 0, None, None, None
    await db.commit()
    return row


async def record_skip(db: AsyncSession, *, tenant_id: uuid.UUID, environment: str,
                      resource_type: str, local_id: str, reason: str,
                      admission_id: uuid.UUID | None = None) -> TresDelivery:
    """The resource was not built: its row reads `skipped` with the catalogue's reason code."""
    row = await _row(db, tenant_id=tenant_id, environment=environment, resource_type=resource_type,
                     local_id=local_id, admission_id=admission_id)
    if row.status != "skipped" or row.reason != reason:
        row.status, row.reason = "skipped", reason
        row.attempts, row.last_error, row.next_attempt_at = 0, None, None
    await db.commit()
    return row
```

- [ ] **Step 4: Run without the database, then with it**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_tres_ledger.py 2>&1 | tail -3`
Expected: PASS — `3 passed, 14 skipped`.

Run: `cd /c/tmp/tres/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_tres_ledger.py 2>&1 | tail -3`
Expected: PASS — `17 passed` (about a minute).

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/tres && git add homunculus-engine/src/homunculus/tres/ledger.py homunculus-engine/tests/test_tres_ledger.py && git commit -m "feat(tres-01): the delivery ledger — find then POST or PUT, the same payload never twice, a refusal counted and left for 30 minutes, stuck at the fifth; skips with their reason (spec D4, D6, D7, D21)" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 8: The rounds' skeleton — `tres/worker.py`, and the lifespan

Spec D2 (b) and D21. `run_round` works every tenant whose mode is not `off` and whose selected environment's account is whole; with `egress` false it returns at once and touches nothing. WHAT is sent comes from an injected `PackageSource`; phase F0's (`no_packages`) yields nothing, so a round asks the platform nothing — F1 replaces it on `app.state.tres_source`. `tres_loop` is `_escalation_loop`'s shape (`api/app.py` ~lines 726–732: sleep, one cycle, a bad cycle never kills the loop) and is started in the lifespan (`api/app.py` ~lines 765–810) **only** when `app.state.tres_egress` is true, and cancelled at shutdown beside the two tasks already there.

What F1 uses from this file: `Sender` (`.send(*, resource_type, fhir_type, local_id, resource, admission_id=None, force=False)` and `.skip(*, resource_type, local_id, reason, admission_id=None)`, both answering the ledger row; `.tenant_id`, `.environment`, `.mode`, `.now`), the types `Package` and `PackageSource`, `RoundReport`, `run_round`, and the constants `ROUND_S`, `PACE_S`, `THROTTLED_S`, `MAX_CONSECUTIVE`.

**Files:**
- Create: `homunculus-engine/src/homunculus/tres/worker.py`
- Test: `homunculus-engine/tests/test_tres_worker.py`
- Modify: `homunculus-engine/src/homunculus/api/app.py` (the import Task 2 added, ~line 90; the `app.state` block Task 2 added, ~line 887; the lifespan ~lines 778–787)

- [ ] **Step 1: Write the failing test**

```python
# homunculus-engine/tests/test_tres_worker.py
"""TRƏS-01 (spec D2, D21): the rounds — with the install's lock closed nothing at all is touched
and no client is ever built; the loop is started by the lifespan only when the lock is open, waits
five minutes between rounds, survives a bad one and backs off after a 429; a round works only the
tenants whose mode is not `off` and whose account is whole, hands each package a `Sender`, spaces
the requests 300 ms apart, ends a tenant's round on a 429 and after five failures in a row. The
lock, the loop and the lifespan need no database; the rounds run on Postgres against the stand-in
(tests/fake_tres.py). Synthetic tenants, synthetic people."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import httpx
import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from homunculus.api.app import create_app
from homunculus.tenant.models import Tenant
from homunculus.tres import worker
from homunculus.tres.client import LOCAL_ID_EXTENSION, TresClient
from homunculus.tres.models import TresDelivery, TresSettings
from homunculus.tres.worker import (
    MAX_CONSECUTIVE, PACE_S, ROUND_S, THROTTLED_S, RoundReport, no_packages, run_round, tres_loop,
)
from tests.conftest import requires_db
from tests.fake_tres import FakeTres

T0 = datetime(2026, 11, 11, 8, 0, tzinfo=timezone.utc)


def patient(local_id: str, given: str = "Ayşe") -> dict:
    return {"resourceType": "Patient", "meta": {"profile": ["http://fhir.az/StructureDefinition/az-patient"]},
            "extension": [{"url": LOCAL_ID_EXTENSION, "valueString": local_id}],
            "name": [{"family": "Sentetik", "given": [given]}]}


def sends(local_id: str):
    """A package of one resource."""
    async def package(sender) -> None:
        await sender.send(resource_type="patient", fhir_type="Patient", local_id=local_id,
                          resource=patient(local_id))
    return package


async def breaks(sender) -> None:
    raise RuntimeError("Sentetik Ayşe")          # a message that must never reach a log line


def source_of(*packages):
    async def source(db, settings):
        for package in packages:
            yield package
    return source


def never(*_args, **_kwargs):
    raise AssertionError("touched with the install's lock closed")


# ---------------------------------------------------------------- the lock (no database)
async def test_with_the_lock_closed_a_round_touches_nothing_and_builds_no_client(monkeypatch):
    built = []
    monkeypatch.setattr(httpx.AsyncClient, "__init__", lambda self, *a, **k: built.append(1))
    report = await run_round(never, egress=False, source=never, now=T0, client_factory=never, sleep=never)
    assert report == RoundReport() and built == []
    assert (report.tenants, report.incomplete, report.packages, report.failed, report.retry_after) == (
        0, 0, 0, 0, None)


async def test_phase_f0s_source_yields_nothing():
    assert [package async for package in no_packages(None, None)] == []


def test_the_lifespan_starts_the_rounds_only_when_the_lock_is_open(monkeypatch):
    monkeypatch.delenv("TRES_EGRESS", raising=False)
    closed = create_app({"t": "HOSP1"}, run_escalation_loop=False)
    with TestClient(closed):
        assert closed.state.tres_task is None
    monkeypatch.setenv("TRES_EGRESS", "on")
    opened = create_app({"t": "HOSP1"}, run_escalation_loop=False)
    assert opened.state.tres_source is no_packages and opened.state.tres_client_factory is TresClient
    with TestClient(opened):
        task = opened.state.tres_task
        assert task is not None and not task.done()      # asleep until the first round, 5 minutes on
    assert task.done()                                   # cancelled at shutdown


# ---------------------------------------------------------------- the loop (no database)
class Clock:
    """A sleep that only records, and ends the loop after `rounds` sleeps."""

    def __init__(self, rounds: int) -> None:
        self.sleeps: list[float] = []
        self._rounds = rounds

    async def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        if len(self.sleeps) > self._rounds:
            raise asyncio.CancelledError


async def test_the_loop_waits_five_minutes_survives_a_bad_round_and_backs_off_after_a_429(monkeypatch, caplog):
    answers = [RoundReport(tenants=1), RuntimeError("Sentetik Ayşe"), RoundReport(retry_after=1200.0),
               RoundReport(retry_after=30.0), RoundReport()]
    seen = []

    async def fake_round(session_factory, **kwargs):
        seen.append(kwargs)
        answer = answers[len(seen) - 1]
        if isinstance(answer, Exception):
            raise answer
        return answer

    monkeypatch.setattr(worker, "run_round", fake_round)
    clock = Clock(rounds=5)
    with pytest.raises(asyncio.CancelledError), caplog.at_level("ERROR"):
        await tres_loop(never, source=no_packages, client_factory=never, sleep=clock.sleep, clock=lambda: T0)
    # before the first round; after a good one; after the bad one; after 429 + 1200 s; after 429 + 30 s
    # (never less than a round); after a quiet one.
    assert clock.sleeps == [ROUND_S, ROUND_S, ROUND_S, 1200.0, ROUND_S, ROUND_S]
    assert len(seen) == 5 and all(k["egress"] is True and k["now"] == T0 for k in seen)
    assert "RuntimeError" in caplog.text and "Sentetik" not in caplog.text


# ---------------------------------------------------------------- the rounds (Postgres)
@pytest_asyncio.fixture
async def feed(db_session):
    """Three tenants — `off`, `validate` with half an account, `send` with a whole one — the
    stand-in, and `round_(source)`, which runs one round and answers (report, sleeps, clients)."""
    fake = FakeTres()
    whole = {"test_base_url": fake.account.base_url, "test_username": fake.account.username,
             "test_password": fake.account.password, "test_provider_id": fake.account.provider_id}
    tenants = {}
    for slug, mode, account in (("kapali", "off", whole), ("yarim", "validate", {**whole, "test_password": None}),
                                ("acik", "send", whole)):
        tenant = Tenant(name=f"Sentetik {slug}", slug=slug, country_code="AZ")
        db_session.add(tenant)
        await db_session.flush()
        db_session.add(TresSettings(tenant_id=tenant.id, mode=mode, environment="test", **account))
        tenants[slug] = tenant
    await db_session.commit()
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)

    async def round_(source):
        sleeps, clients = [], []

        async def sleep(seconds: float) -> None:
            sleeps.append(seconds)

        def factory(account):
            clients.append(TresClient(account, transport=fake.transport))
            return clients[-1]

        report = await run_round(maker, egress=True, source=source, now=T0, client_factory=factory, sleep=sleep)
        return report, sleeps, clients

    return fake, tenants, round_


@requires_db
async def test_a_round_works_only_the_tenants_that_are_on_and_whose_account_is_whole(feed, db_session):
    fake, tenants, round_ = feed
    asked = []

    async def source(db, settings):
        asked.append((settings.tenant_id, settings.mode))
        return
        yield

    report, sleeps, clients = await round_(source)
    assert (report.tenants, report.incomplete, report.packages, report.failed) == (1, 1, 0, 0)
    assert asked == [(tenants["acik"].id, "send")]
    assert [c.account for c in clients] == [fake.account]
    assert clients[0]._client is None                      # closed; and it never connected
    assert fake.requests == [] and sleeps == []


@requires_db
async def test_each_package_is_handed_a_sender_and_the_requests_are_spaced(feed, db_session):
    fake, tenants, round_ = feed
    report, sleeps, clients = await round_(source_of(sends("hmn-p-0001"), sends("hmn-p-0002")))
    assert (report.packages, report.failed, report.retry_after) == (2, 0, None)
    # token, then find + create for each of the two: five requests, four gaps.
    assert fake.requests == [("POST", "/auth/token"), ("GET", "/fhir/Patient"), ("POST", "/fhir/Patient"),
                             ("GET", "/fhir/Patient"), ("POST", "/fhir/Patient")]
    assert sleeps == [PACE_S] * 4 and PACE_S >= 0.3
    rows = (await db_session.execute(select(TresDelivery).order_by(TresDelivery.local_id))).scalars().all()
    assert [(r.tenant_id, r.environment, r.local_id, r.status, r.remote_id) for r in rows] == [
        (tenants["acik"].id, "test", "hmn-p-0001", "sent", "7001"),
        (tenants["acik"].id, "test", "hmn-p-0002", "sent", "7002")]
    assert clients[0]._client is None                      # closed at the end of the tenant's round


@requires_db
async def test_a_tenant_in_validate_mode_asks_only_for_validation(feed, db_session):
    fake, tenants, round_ = feed
    row = (await db_session.execute(select(TresSettings).where(
        TresSettings.tenant_id == tenants["acik"].id))).scalar_one()
    row.mode = "validate"
    await db_session.commit()
    report, _, _ = await round_(source_of(sends("hmn-p-0001")))
    assert report.packages == 1 and fake.fhir_requests == [("POST", "/fhir/Patient/$validate")]
    assert fake.stored("Patient") == []
    (saved,) = (await db_session.execute(select(TresDelivery))).scalars()
    assert (saved.status, saved.operation) == ("validated", "validate")


@requires_db
@pytest.mark.parametrize("said, waits", [(120, 120.0), (None, THROTTLED_S)])
async def test_a_429_ends_the_tenants_round_and_says_how_long_to_wait(feed, db_session, said, waits):
    fake, _, round_ = feed
    fake.throttle(1, retry_after=said)
    report, _, clients = await round_(source_of(sends("hmn-p-0001"), sends("hmn-p-0002")))
    assert (report.packages, report.failed, report.retry_after) == (0, 1, waits)
    assert fake.fhir_requests == [("GET", "/fhir/Patient")]          # the second package never ran
    (row,) = (await db_session.execute(select(TresDelivery))).scalars()
    assert (row.local_id, row.status, row.attempts) == ("hmn-p-0001", "failed", 1)
    assert clients[0]._client is None


@requires_db
async def test_five_failures_in_a_row_end_the_round_and_a_success_starts_the_count_again(feed, caplog):
    fake, _, round_ = feed
    with caplog.at_level("WARNING"):
        report, _, _ = await round_(source_of(*[breaks] * 4, sends("hmn-p-0001"), *[breaks] * 7))
    assert MAX_CONSECUTIVE == 5
    assert (report.packages, report.failed) == (1, 4 + 5)            # the last two were never run
    assert "RuntimeError" in caplog.text and "Sentetik" not in caplog.text


@requires_db
async def test_a_sender_records_a_skip_and_a_refusal_is_a_row_not_an_exception(feed, db_session):
    fake, tenants, round_ = feed

    async def package(sender) -> None:
        await sender.skip(resource_type="patient", local_id="hmn-p-0001", reason="fin_missing")
        broken = {k: v for k, v in patient("hmn-p-0002").items() if k != "meta"}
        row = await sender.send(resource_type="patient", fhir_type="Patient", local_id="hmn-p-0002", resource=broken)
        assert (row.status, row.attempts) == ("failed", 1)           # the package goes on, or stops, as it likes

    report, _, _ = await round_(source_of(package))
    assert (report.packages, report.failed) == (1, 0)
    rows = (await db_session.execute(select(TresDelivery).order_by(TresDelivery.local_id))).scalars().all()
    assert [(r.local_id, r.status, r.reason) for r in rows] == [
        ("hmn-p-0001", "skipped", "fin_missing"), ("hmn-p-0002", "failed", None)]


@requires_db
async def test_a_dead_line_counts_as_a_failure_and_five_of_them_end_the_round(db_session):
    tenant = Tenant(name="Sentetik acik", slug="acik", country_code="AZ")
    db_session.add(tenant)
    await db_session.flush()
    db_session.add(TresSettings(tenant_id=tenant.id, mode="send", environment="test",
                                test_base_url="https://tres.test", test_username="sentetik",
                                test_password="gizli-parola", test_provider_id="PRV-0001"))
    await db_session.commit()

    def refuse(request):
        raise httpx.ConnectError("connection refused", request=request)

    async def quiet(seconds: float) -> None:
        return None

    report = await run_round(
        async_sessionmaker(db_session.bind, expire_on_commit=False), egress=True, now=T0, sleep=quiet,
        source=source_of(*[sends(f"hmn-p-{n:04d}") for n in range(8)]),
        client_factory=lambda account: TresClient(account, transport=httpx.MockTransport(refuse)))
    assert (report.packages, report.failed, report.retry_after) == (0, 5, None)
    rows = (await db_session.execute(select(TresDelivery))).scalars().all()
    assert len(rows) == 5 and {r.last_error for r in rows} == {"ConnectError"}
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_tres_worker.py 2>&1 | tail -3`
Expected: FAIL — `ModuleNotFoundError: No module named 'homunculus.tres.worker'`.

- [ ] **Step 3: Write the worker**

```python
# homunculus-engine/src/homunculus/tres/worker.py
"""The rounds of the national e-health feed (TRƏS-01, spec D2, D21) — phase F0: the skeleton.

A ROUND works every tenant whose `mode` is not `off` and whose selected environment's account is
whole, one after the other, each on its own client:

* WHAT is sent is not decided here. A `PackageSource` yields the stays' PACKAGES; a package is
  handed a `Sender` and takes its resources to the platform in its own order (spec D8: Patient →
  Practitioner → Encounter → …), reading each row's `remote_id` for the references of the next.
  Phase F0 has no package builder: `no_packages` yields nothing, so a round asks the platform
  nothing. F1 supplies the source (`app.state.tres_source`).
* requests are sequential and at least PACE_S apart (the client's `pace` hook);
* HTTP 429 ends the tenant's round; the report carries how long to wait (`Retry-After`, or
  THROTTLED_S);
* MAX_CONSECUTIVE packages failing in a row end the tenant's round too — the platform, or the
  line to it, is not well, and the next round will find out.

THE INSTALL'S LOCK (D2 (b)): with `egress` false `run_round` returns at once — no session is
opened, no client is built, no connection is made, whatever a tenant's row says. `tres_loop` is
started by the app's lifespan only when the lock is open, and a bad round never ends it.

Log lines carry tenant ids, counts and exception classes — never a message, which may echo a
value (D25).

The session factory must not expire its objects on commit (`homunculus.db.AsyncSessionLocal` does
not): the ledger commits after every resource, and the settings rows are read after it."""
from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.tres.client import TresAccount, TresClient, TresError
from homunculus.tres.ledger import deliver, record_skip
from homunculus.tres.models import TresDelivery, TresSettings, account_of

log = logging.getLogger(__name__)

#: Seconds between two rounds (D21: every 5 minutes).
ROUND_S = 300.0
#: The least seconds between two requests to the platform (D21).
PACE_S = 0.3
#: Seconds to wait after a 429 that names no `Retry-After` (D21: 15 minutes).
THROTTLED_S = 900.0
#: The packages failing in a row after which a tenant's round ends (D21).
MAX_CONSECUTIVE = 5


class Sender:
    """What a package is handed: `send` takes one built resource to the platform through the
    ledger (its row comes back, `remote_id` on it), `skip` records why one was not built. Bound to
    one tenant, its selected environment and its mode, for one round."""

    def __init__(self, db: AsyncSession, client: TresClient, *, tenant_id: uuid.UUID,
                 environment: str, mode: str, now: datetime) -> None:
        self._db, self._client = db, client
        self.tenant_id, self.environment, self.mode, self.now = tenant_id, environment, mode, now

    async def send(self, *, resource_type: str, fhir_type: str, local_id: str, resource: dict,
                   admission_id: uuid.UUID | None = None, force: bool = False) -> TresDelivery:
        return await deliver(self._db, self._client, tenant_id=self.tenant_id,
                             environment=self.environment, mode=self.mode,
                             resource_type=resource_type, fhir_type=fhir_type, local_id=local_id,
                             resource=resource, admission_id=admission_id, now=self.now, force=force)

    async def skip(self, *, resource_type: str, local_id: str, reason: str,
                   admission_id: uuid.UUID | None = None) -> TresDelivery:
        return await record_skip(self._db, tenant_id=self.tenant_id, environment=self.environment,
                                 resource_type=resource_type, local_id=local_id, reason=reason,
                                 admission_id=admission_id)


#: One stay's resources, taken to the platform in order through the `Sender` it is handed. It lets
#: a `TresError` the ledger raised again (a 429, a dead line) pass: the round reads it.
Package = Callable[[Sender], Awaitable[None]]
#: The packages a tenant has to send this round, by its settings (F1: the stays that are due).
PackageSource = Callable[[AsyncSession, TresSettings], AsyncIterator[Package]]


async def no_packages(db: AsyncSession, settings: TresSettings) -> AsyncIterator[Package]:
    """Phase F0's source: nothing to send. F1 replaces it on `app.state.tres_source`."""
    return
    yield  # (never reached: it makes this function an async generator)


@dataclass
class RoundReport:
    tenants: int = 0                    # worked: mode not off, the account whole
    incomplete: int = 0                 # passed over: the selected environment's account is not whole
    packages: int = 0                   # packages that ran to their end
    failed: int = 0                     # packages that raised
    retry_after: float | None = None    # the longest wait a 429 asked for; None when none came


class _Pacer:
    """The spacing of one client's requests: nothing before the first, PACE_S before each next."""

    def __init__(self, sleep: Callable[[float], Awaitable[None]]) -> None:
        self._sleep, self._started = sleep, False

    async def wait(self) -> None:
        if self._started:
            await self._sleep(PACE_S)
        self._started = True


async def _work(db: AsyncSession, client: TresClient, sender: Sender, settings: TresSettings,
                source: PackageSource, report: RoundReport) -> None:
    """One tenant's packages, until they end, a 429 comes, or MAX_CONSECUTIVE fail in a row."""
    consecutive = 0
    async for package in source(db, settings):
        try:
            await package(sender)
        except TresError as exc:
            report.failed += 1
            if exc.status == 429:
                wait = exc.retry_after if exc.retry_after is not None else THROTTLED_S
                report.retry_after = max(report.retry_after or 0.0, wait)
                log.warning("TRƏS: 429 for tenant %s; its round ends, the next waits %.0f s",
                            sender.tenant_id, report.retry_after)
                return
            consecutive += 1
        except Exception as exc:  # noqa: BLE001 — one bad package must not end the round
            report.failed += 1
            consecutive += 1
            log.error("TRƏS: a package failed for tenant %s (%s)", sender.tenant_id, type(exc).__name__)
            await db.rollback()
        else:
            report.packages += 1
            consecutive = 0
        if consecutive >= MAX_CONSECUTIVE:
            log.warning("TRƏS: %d packages failed in a row for tenant %s; its round ends",
                        consecutive, sender.tenant_id)
            return


async def run_round(session_factory: Callable[[], AsyncSession], *, egress: bool,
                    source: PackageSource, now: datetime,
                    client_factory: Callable[[TresAccount], TresClient],
                    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep) -> RoundReport:
    """One round over every tenant (the module's docstring). With `egress` false nothing at all is
    touched: not the database, not the client factory."""
    report = RoundReport()
    if not egress:
        return report
    async with session_factory() as db:
        rows = (await db.execute(select(TresSettings).where(TresSettings.mode != "off")
                                 .order_by(TresSettings.tenant_id))).scalars().all()
        # Read before the first commit: (settings, account, tenant, environment, mode).
        work = [(row, account_of(row), row.tenant_id, row.environment, row.mode) for row in rows]
        for settings, account, tenant_id, environment, mode in work:
            if account is None:
                report.incomplete += 1
                continue
            try:
                client = client_factory(account)
            except ValueError:          # a base URL that is not https (a row written past the route)
                report.incomplete += 1
                continue
            report.tenants += 1
            client.pace = _Pacer(sleep).wait
            sender = Sender(db, client, tenant_id=tenant_id, environment=environment, mode=mode, now=now)
            try:
                await _work(db, client, sender, settings, source, report)
            finally:
                await client.aclose()
    return report


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


async def tres_loop(session_factory: Callable[[], AsyncSession], *, source: PackageSource,
                    client_factory: Callable[[TresAccount], TresClient],
                    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
                    clock: Callable[[], datetime] = _utcnow) -> None:
    """A round every ROUND_S, for as long as the app runs — started by the lifespan ONLY when the
    install's lock is open, so every round here runs with `egress=True`. After a 429 the next
    round waits what the platform asked (never less than ROUND_S). A round that raises is logged
    by its class and the loop goes on (`_escalation_loop`'s rule: a bad cycle never kills it)."""
    wait = ROUND_S
    while True:
        await sleep(wait)
        wait = ROUND_S
        try:
            report = await run_round(session_factory, egress=True, source=source, now=clock(),
                                     client_factory=client_factory, sleep=sleep)
        except Exception as exc:  # noqa: BLE001 — a bad round must never kill the loop
            log.error("TRƏS round failed (%s); the next one runs in %.0f s", type(exc).__name__, ROUND_S)
            continue
        if report.retry_after is not None:
            wait = max(ROUND_S, report.retry_after)
```

- [ ] **Step 4: Start the loop in the lifespan — only when the lock is open**

In `homunculus-engine/src/homunculus/api/app.py` replace
```python
from homunculus.tres.egress import egress_on        # TRƏS-01 (spec D2): the install's lock
```
with
```python
from homunculus.tres.client import TresClient       # TRƏS-01: the platform's client (the default factory)
from homunculus.tres.egress import egress_on        # TRƏS-01 (spec D2): the install's lock
from homunculus.tres.worker import no_packages, tres_loop   # TRƏS-01 (spec D21): the rounds
```
replace
```python
    app.state.tres_egress = egress_on(os.environ)
```
with
```python
    app.state.tres_egress = egress_on(os.environ)
    # The feed's rounds (tres/worker.py, D21). WHAT is sent: phase F0 has no package builder, so
    # the source yields nothing and a round asks the platform nothing; F1 puts the stays here. The
    # client: `TresClient`, unless a test stands a stand-in's transport in.
    app.state.tres_source = no_packages
    app.state.tres_client_factory = TresClient
```
and, in the lifespan, replace
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
with
```python
        prune = (asyncio.create_task(_prune_loop())                           # Aşama B (D8)
                 if samples.durable or shadow.rules else None)
        # TRƏS-01 (spec D2, D21): the national feed's rounds — ONLY when the install's lock is
        # open. Closed, no task exists and nothing in this process connects to the platform.
        tres = None
        if app.state.tres_egress:
            from homunculus.db import AsyncSessionLocal
            tres = asyncio.create_task(tres_loop(AsyncSessionLocal, source=app.state.tres_source,
                                                 client_factory=app.state.tres_client_factory))
        app.state.tres_task = tres
        try:
            yield
        finally:
            if task is not None:
                task.cancel()
            if prune is not None:
                prune.cancel()
            if tres is not None:
                tres.cancel()
```
(`AsyncSessionLocal` is imported inside the branch, as `prodserver.py` and `scope/resolver.py` import it: an app built for a test never needs it. It does not expire objects on commit, which the worker relies on.)

- [ ] **Step 5: Run without the database, then with it**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_tres_worker.py tests/test_tres_egress.py 2>&1 | tail -3`
Expected: PASS — `19 passed, 8 skipped`.

Run: `cd /c/tmp/tres/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_tres_worker.py 2>&1 | tail -3`
Expected: PASS — `12 passed`.

- [ ] **Step 6: The app still starts and stops cleanly everywhere else**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_route_inventory.py tests/test_board_permissions.py tests/test_api_stream.py 2>&1 | tail -3`
Expected: PASS, no `failed`.

- [ ] **Step 7: Commit**

```bash
cd /c/tmp/tres && git add homunculus-engine/src/homunculus/tres/worker.py homunculus-engine/tests/test_tres_worker.py homunculus-engine/src/homunculus/api/app.py && git commit -m "feat(tres-01): the rounds' skeleton — nothing touched with the lock closed, tenants that are on and whole, packages through a Sender, 300 ms spacing, 429 and five failures end a round; the loop in the lifespan only when TRES_EGRESS=on (spec D2, D21)" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 9: The routes — `GET|PUT /admin/tres/settings`, `POST /admin/tres/test`, and the audit label

Spec §6, D3, D23, D24, on the pattern of `protocol/router.py` (the body's rules first, then `INSERT … ON CONFLICT DO NOTHING`, the row locked `FOR UPDATE`, the audit row after the commit through `admission/trail.record`) and `tests/test_protocol_settings.py` (the ward of `tests/kabul_world.py`: `build_ward(db_session)` → `w.auth["admin"]`, `w.tenant`, `w.users`; `ward_client(db_session)` → `(client, app)`; the audit read back from `app.state.audit.records(tenant=SLUG, event_type=…)`).

Three things hold this task together and must land in ONE commit:
1. the routes, guarded by `tres.manage` — `tests/test_route_permissions.py` is a hand-written table of every guarded route (`EXPECTED`, `GUARDED_MODULES`, a count);
2. every route depends on `caller_tenant_id` — `tests/test_tenant_isolation.py` fails for one that does not;
3. the audit event `tres.settings` — the dashboard's `screens/denetim/engineTypes.test.js` reads the engine's sources and holds `denetim.js` `EVENT_TYPES` to them BOTH ways, so the label is added here, with the route that writes the event.

The refusal codes are in their own module, `tres/errors.py`: `admission/errors.py`'s `CODES` is held one-to-one to the dashboard's `ADMISSION_CODE_KEYS` by `apiErrors.test.js`, and adding codes there would break the dashboard until Task 12.

**Files:**
- Create: `homunculus-engine/src/homunculus/tres/errors.py`
- Create: `homunculus-engine/src/homunculus/tres/schemas.py`
- Create: `homunculus-engine/src/homunculus/tres/router.py`
- Test: `homunculus-engine/tests/test_tres_settings.py`
- Modify: `homunculus-engine/src/homunculus/api/app.py` (after the protocol router's include, ~line 861)
- Modify: `homunculus-engine/tests/test_route_permissions.py` (`GUARDED_MODULES` ~line 41; `EXPECTED`'s tail ~line 154; the count ~line 240)
- Modify: `dashboard/src/live/screens/denetim/denetim.js` (`EVENT_TYPES`' tail, ~line 98)
- Modify: `dashboard/src/live/screens/denetim/denetim.test.js` (the count, ~line 165)
- Modify: `dashboard/src/live/i18n/strings/denetim.js` (the `type:` block of each language, after its `careTeamEnd` line: ~lines 68, 140, 212, 284)

- [ ] **Step 1: Write the failing test**

```python
# homunculus-engine/tests/test_tres_settings.py
"""Yönetim › TRƏS (TRƏS-01, spec §6, D2, D3, D23, D24): GET|PUT /admin/tres/settings and
POST /admin/tres/test — `tres.manage` in the caller's tenant; a tenant with no row reads as off;
the answer says whether the install's lock is open and never carries a password; a password
omitted keeps the stored one and an empty one clears it; the password is ciphertext at rest; a bad
value is refused with its code and writes nothing; a change is audited with the NAMES of the
fields and no value; the connection test is refused while the install's lock is closed, and then
asks the platform for one session and tells its words, never the session id. The body's rules need
no database; the routes run on Postgres (tests/kabul_world.py) against the stand-in
(tests/fake_tres.py). Synthetic ward, synthetic account."""
from __future__ import annotations

import json

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import func, select, text

from homunculus.tenant.models import Tenant
from homunculus.tres.client import TresClient
from homunculus.tres.errors import CODES, WORDS
from homunculus.tres.models import RESOURCE_TYPES, TresSettings
from homunculus.tres.schemas import TresSettingsIn, base_url_ok, settings_refusal
from tests.conftest import requires_db
from tests.fake_tres import FakeTres
from tests.kabul_world import SLUG, build_ward, ward_client

URL = "/admin/tres/settings"
TEST_URL = "/admin/tres/test"
EMPTY = {"base_url": None, "username": None, "provider_id": None, "organization_id": None,
         "organization_name": None}
SANDBOX = {"base_url": "https://ehr-sandbox.example.az", "username": "sentetik", "password": "gizli-parola",
           "provider_id": "PRV-0001", "organization_id": "ORG-0001", "organization_name": "Sentetik Kabul Hastanesi"}


def body(**over) -> dict:
    return {"mode": "off", "environment": "test", "settle_hours": 24, "enabled_types": list(RESOURCE_TYPES),
            "test": dict(EMPTY), "live": dict(EMPTY), **over}


# ---------------------------------------------------------------- the rules (no database)
@pytest.mark.parametrize("sent, code", [
    (body(mode="on"), "tres_mode"),
    (body(mode=""), "tres_mode"),
    (body(environment="prod"), "tres_environment"),
    (body(settle_hours=-1), "tres_settle_hours"),
    (body(settle_hours=169), "tres_settle_hours"),
    (body(enabled_types=["patient", "imaging"]), "tres_types"),
    (body(enabled_types=["patient", "patient"]), "tres_types"),
    (body(test={**EMPTY, "base_url": "http://ehr-sandbox.example.az"}), "tres_base_url"),
    (body(live={**EMPTY, "base_url": "ehr.example.az"}), "tres_base_url"),
    (body(live={**EMPTY, "base_url": "https://"}), "tres_base_url"),
    (body(live={**EMPTY, "base_url": "https://sentetik:parola@ehr.example.az"}), "tres_base_url"),
    (body(live={**EMPTY, "base_url": "https://ehr.example.az/" + "x" * 200}), "tres_base_url"),
    (body(test={**EMPTY, "username": "u" * 121}), "tres_field_length"),
    (body(test={**EMPTY, "password": "p" * 201}), "tres_field_length"),
    (body(live={**EMPTY, "provider_id": "x" * 65}), "tres_field_length"),
    (body(live={**EMPTY, "organization_id": "x" * 65}), "tres_field_length"),
    (body(live={**EMPTY, "organization_name": "x" * 201}), "tres_field_length"),
    (body(mode="on", settle_hours=999), "tres_mode"),                # the first wrong value, in the form's order
])
def test_a_bad_body_has_its_code(sent, code):
    assert settings_refusal(TresSettingsIn(**sent)) == code


@pytest.mark.parametrize("sent", [
    body(), body(mode="validate", environment="live", settle_hours=0, enabled_types=[]),
    body(mode="send", settle_hours=168, enabled_types=["lab", "patient"], test=SANDBOX),
    body(test={**EMPTY, "base_url": "  "}),                           # blank: cleared, not judged
])
def test_a_good_body_has_none(sent):
    assert settings_refusal(TresSettingsIn(**sent)) is None


def test_a_base_url_is_https_with_a_host_and_no_credentials():
    assert base_url_ok("https://ehr.e-health.example.az") and base_url_ok("https://10.0.0.5:8443/api")
    for bad in ("http://ehr.example.az", "https://", "https:///fhir", "https://u:p@ehr.example.az", "ftp://x"):
        assert not base_url_ok(bad), bad


def test_every_code_has_its_words():
    assert set(WORDS) == CODES and all(text_.strip() for text_ in WORDS.values())


# ---------------------------------------------------------------- the routes
@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    monkeypatch.delenv("TRES_EGRESS", raising=False)
    built = await build_ward(db_session)
    async with ward_client(db_session) as (client, app):
        yield built, client, app


def _audit(app) -> list:
    return app.state.audit.records(tenant=SLUG, event_type="tres.settings", limit=50)


async def _count(db_session) -> int:
    return (await db_session.execute(select(func.count()).select_from(TresSettings))).scalar_one()


@requires_db
async def test_a_tenant_starts_off_with_no_account_and_the_lock_closed(ward, db_session):
    w, client, _ = ward
    r = await client.get(URL, headers=w.auth["admin"])
    assert r.status_code == 200, r.text
    account = {**EMPTY, "password_set": False}
    assert r.json() == {"mode": "off", "environment": "test", "settle_hours": 24,
                        "enabled_types": list(RESOURCE_TYPES), "test": account, "live": account,
                        "egress": False, "updated_at": None}
    assert await _count(db_session) == 0                    # a read writes no row


@requires_db
async def test_the_answer_says_when_the_installs_lock_is_open(ward):
    w, client, app = ward
    app.state.tres_egress = True
    assert (await client.get(URL, headers=w.auth["admin"])).json()["egress"] is True
    r = await client.put(URL, json=body(), headers=w.auth["admin"])
    assert (r.status_code, r.json()["egress"]) == (200, True)


@requires_db
async def test_the_administrator_saves_and_the_password_never_comes_back(ward, db_session):
    w, client, app = ward
    sent = body(mode="validate", settle_hours=48, enabled_types=["lab", "patient", "encounter"], test=SANDBOX)
    r = await client.put(URL, json=sent, headers=w.auth["admin"])
    assert r.status_code == 200, r.text
    answer = r.json()
    assert (answer["mode"], answer["environment"], answer["settle_hours"]) == ("validate", "test", 48)
    assert answer["enabled_types"] == ["patient", "encounter", "lab"]          # the catalogue's order
    assert answer["test"] == {**{k: v for k, v in SANDBOX.items() if k != "password"}, "password_set": True}
    assert answer["live"] == {**EMPTY, "password_set": False}
    assert answer["updated_at"] is not None
    read = await client.get(URL, headers=w.auth["admin"])
    assert read.json() == answer
    assert "gizli-parola" not in r.text + read.text and "password\"" not in r.text.replace("password_set\"", "")
    # at rest: ciphertext; to the model: the password
    stored = (await db_session.execute(text("SELECT test_password FROM tres_settings"))).scalar_one()
    assert stored.startswith("enc::v1::") and "gizli" not in stored
    (row,) = (await db_session.execute(select(TresSettings))).scalars()
    assert (row.tenant_id, row.test_password, row.updated_by) == (w.tenant.id, "gizli-parola", w.users["admin"].id)
    # audited: who, and the NAMES of what changed — no value, no password
    (audit,) = _audit(app)
    assert audit.patient_id == ""
    assert audit.payload == {"actor": "admin@kabul.example.com", "changed": [
        "mode", "settle_hours", "enabled_types", "test.base_url", "test.username", "test.password",
        "test.provider_id", "test.organization_id", "test.organization_name"]}
    assert "gizli" not in json.dumps(audit.payload) and "sandbox" not in json.dumps(audit.payload)


@requires_db
async def test_a_password_left_out_stays_and_an_empty_one_clears_it(ward, db_session):
    w, client, app = ward
    assert (await client.put(URL, json=body(test=SANDBOX), headers=w.auth["admin"])).status_code == 200
    kept = {k: v for k, v in SANDBOX.items() if k != "password"}
    for unchanged in (kept, {**kept, "password": None}):
        r = await client.put(URL, json=body(test=unchanged, settle_hours=12), headers=w.auth["admin"])
        assert (r.status_code, r.json()["test"]["password_set"]) == (200, True), r.text
    db_session.expire_all()
    (row,) = (await db_session.execute(select(TresSettings))).scalars()
    assert row.test_password == "gizli-parola"
    r = await client.put(URL, json=body(test={**kept, "password": ""}, settle_hours=12), headers=w.auth["admin"])
    assert (r.status_code, r.json()["test"]["password_set"]) == (200, False)
    db_session.expire_all()
    (row,) = (await db_session.execute(select(TresSettings))).scalars()
    assert row.test_password is None
    assert [a.payload["changed"] for a in _audit(app)][1:] == [["settle_hours"], ["test.password"]]


@requires_db
async def test_an_empty_field_clears_and_a_save_that_changes_nothing_is_not_audited(ward, db_session):
    w, client, app = ward
    assert (await client.put(URL, json=body(test=SANDBOX), headers=w.auth["admin"])).status_code == 200
    first = (await client.get(URL, headers=w.auth["admin"])).json()["updated_at"]
    again = await client.put(URL, json=body(test={**SANDBOX, "base_url": "  https://ehr-sandbox.example.az "}),
                             headers=w.auth["admin"])
    assert (again.status_code, again.json()["updated_at"]) == (200, first)      # trimmed: the same
    assert len(_audit(app)) == 1
    cleared = await client.put(URL, json=body(test={**SANDBOX, "organization_name": "", "username": None}),
                               headers=w.auth["admin"])
    assert (cleared.json()["test"]["organization_name"], cleared.json()["test"]["username"]) == (None, None)
    assert _audit(app)[-1].payload["changed"] == ["test.username", "test.organization_name"]


@requires_db
@pytest.mark.parametrize("sent, code", [
    (body(mode="on"), "tres_mode"),
    (body(environment="prod"), "tres_environment"),
    (body(settle_hours=169), "tres_settle_hours"),
    (body(enabled_types=["imaging"]), "tres_types"),
    (body(live={**EMPTY, "base_url": "http://ehr.example.az"}), "tres_base_url"),
    (body(test={**EMPTY, "username": "u" * 121}), "tres_field_length"),
])
async def test_a_bad_value_is_refused_with_its_code_and_writes_nothing(ward, db_session, sent, code):
    w, client, app = ward
    r = await client.put(URL, json=sent, headers=w.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (422, code), r.text
    assert r.json()["detail"]["message"] == WORDS[code]
    assert await _count(db_session) == 0 and _audit(app) == []


@requires_db
async def test_a_field_too_many_or_of_the_wrong_type_is_refused(ward):
    w, client, _ = ward
    for sent in ({**body(), "egress": True}, body(settle_hours="24"), body(settle_hours=True),
                 body(test={**EMPTY, "password_set": True}), body(enabled_types="patient"),
                 {k: v for k, v in body().items() if k != "live"}):
        assert (await client.put(URL, json=sent, headers=w.auth["admin"])).status_code == 422


@requires_db
async def test_only_tres_manage_reads_writes_or_tests(ward):
    w, client, app = ward
    app.state.tres_egress = True
    for who in ("nurse", "nurse_b", "charge", "doctor", "auditor"):
        assert (await client.get(URL, headers=w.auth[who])).status_code == 403, who
        assert (await client.put(URL, json=body(), headers=w.auth[who])).status_code == 403, who
        assert (await client.post(TEST_URL, headers=w.auth[who])).status_code == 403, who
    assert (await client.get(URL)).status_code == 401


@requires_db
async def test_the_settings_are_the_callers_tenants_alone(ward, db_session):
    w, client, _ = ward
    other = Tenant(name="Sentetik Başka Hastane", slug="baska-hastane", country_code="AZ")
    db_session.add(other)
    await db_session.flush()
    db_session.add(TresSettings(tenant_id=other.id, mode="send", environment="live",
                                live_base_url="https://ehr.example.az", live_password="baska-parola"))
    await db_session.commit()
    own_id, other_id = w.tenant.id, other.id               # read before expire_all()
    assert (await client.get(URL, headers=w.auth["admin"])).json()["mode"] == "off"
    assert (await client.put(URL, json=body(mode="validate"), headers=w.auth["admin"])).status_code == 200
    db_session.expire_all()
    rows = {r.tenant_id: r for r in (await db_session.execute(select(TresSettings))).scalars()}
    assert (rows[other_id].mode, rows[other_id].live_password) == ("send", "baska-parola")
    assert rows[own_id].mode == "validate"


# ---------------------------------------------------------------- the connection test
async def _stand_in(app, client, w, **account) -> FakeTres:
    """The stand-in behind the app's client factory, and its account saved as the tenant's sandbox."""
    fake = FakeTres()
    app.state.tres_client_factory = lambda acc: TresClient(acc, transport=fake.transport)
    saved = {"base_url": fake.account.base_url, "username": fake.account.username,
             "password": fake.account.password, "provider_id": fake.account.provider_id, **account}
    r = await client.put(URL, json=body(test={**EMPTY, **saved}), headers=w.auth["admin"])
    assert r.status_code == 200, r.text
    return fake


@requires_db
async def test_with_the_lock_closed_the_test_is_refused_and_no_client_is_built(ward):
    w, client, app = ward
    built = []
    app.state.tres_client_factory = lambda account: built.append(account)
    await client.put(URL, json=body(test=SANDBOX), headers=w.auth["admin"])
    r = await client.post(TEST_URL, headers=w.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "egress_off"), r.text
    assert built == []


@requires_db
async def test_an_incomplete_account_is_refused_before_anything_is_asked(ward):
    w, client, app = ward
    app.state.tres_egress = True
    r = await client.post(TEST_URL, headers=w.auth["admin"])                      # no row at all
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "tres_account_incomplete")
    fake = await _stand_in(app, client, w, provider_id=None)
    r = await client.post(TEST_URL, headers=w.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "tres_account_incomplete")
    assert fake.requests == []
    # the account is the SELECTED environment's: the sandbox one does not stand for live
    await _stand_in(app, client, w)
    await client.put(URL, json=body(environment="live", test={k: v for k, v in EMPTY.items()}),
                     headers=w.auth["admin"])
    r = await client.post(TEST_URL, headers=w.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "tres_account_incomplete")


@requires_db
async def test_the_test_opens_one_session_and_never_tells_its_id(ward):
    w, client, app = ward
    app.state.tres_egress = True
    fake = await _stand_in(app, client, w)
    r = await client.post(TEST_URL, headers=w.auth["admin"])
    assert (r.status_code, r.json()) == (200, {"ok": True, "message": None}), r.text
    assert fake.requests == [("POST", "/auth/token")]
    assert "session" not in r.text
    assert app.state.audit.records(tenant=SLUG, event_type="tres.test", limit=5) == []     # it writes nothing


@requires_db
async def test_the_platforms_refusal_is_told_in_its_own_words(ward):
    w, client, app = ward
    app.state.tres_egress = True
    await _stand_in(app, client, w, password="yanlis-parola")
    r = await client.post(TEST_URL, headers=w.auth["admin"])
    assert (r.status_code, r.json()) == (200, {"ok": False, "message": "Invalid credentials"})
    assert "yanlis-parola" not in r.text


@requires_db
async def test_a_dead_line_is_an_answer_too_never_a_500(ward):
    w, client, app = ward
    app.state.tres_egress = True
    await _stand_in(app, client, w)

    def refuse(request):
        raise httpx.ConnectError("connection refused", request=request)

    app.state.tres_client_factory = lambda acc: TresClient(acc, transport=httpx.MockTransport(refuse))
    r = await client.post(TEST_URL, headers=w.auth["admin"])
    assert (r.status_code, r.json()) == (200, {"ok": False, "message": "ConnectError"})
```

- [ ] **Step 2: Put the three routes in the guard table**

In `homunculus-engine/tests/test_route_permissions.py` replace
```python
    "homunculus.protocol.router",       # G2-B1d
}
```
with
```python
    "homunculus.protocol.router",       # G2-B1d
    "homunculus.tres.router",           # TRƏS-01
}
```
replace
```python
    ("GET", "/admin/protocol-settings"): ANY(_S),
    ("PUT", "/admin/protocol-settings"): ANY(_S),
}
```
with
```python
    ("GET", "/admin/protocol-settings"): ANY(_S),
    ("PUT", "/admin/protocol-settings"): ANY(_S),
    # tres/router.py — TRƏS-01 (spec D23): Yönetim › TRƏS
    ("GET", "/admin/tres/settings"): ANY("tres.manage"),
    ("PUT", "/admin/tres/settings"): ANY("tres.manage"),
    ("POST", "/admin/tres/test"): ANY("tres.manage"),
}
```
and replace
```python
    assert len(EXPECTED) == 75      # G2-B3a: +5 (the bed moves, the occupancy read); G2-B3b: +2 (my handovers, colleagues); G2-B1c: +2, the picker, the end; G4-02: +1, GET /handovers/pending
```
with
```python
    assert len(EXPECTED) == 78      # G2-B3a: +5 (the bed moves, the occupancy read); G2-B3b: +2 (my handovers, colleagues); G2-B1c: +2, the picker, the end; G4-02: +1, GET /handovers/pending; TRƏS-01 F0: +3, the settings read and write, the connection test
```

- [ ] **Step 3: Run both to see them fail**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_tres_settings.py tests/test_route_permissions.py 2>&1 | tail -4`
Expected: FAIL — `ModuleNotFoundError: No module named 'homunculus.tres.errors'` for the first file; in the second, `test_no_table_entry_lacks_a_route` lists the three `/admin/tres/…` entries.

- [ ] **Step 4: The refusal codes**

```python
# homunculus-engine/src/homunculus/tres/errors.py
"""The refusals of the `/admin/tres/*` routes, each with a stable code (TRƏS-01, spec §6).

A refusal answers `{"detail": {"code": "<code>", "message": "<words>"}}`, as the admission routes'
do (`admission/errors.py` `Refusal`, which this module uses). The dashboard maps the CODE to the
reader's language (`dashboard/src/live/apiErrors.js`, `TRES_CODE_KEYS`) and never the words, which
are English and for a support call.

Its own module, not `admission/errors.py`: that file's `CODES` is held one-to-one to the dashboard's
`ADMISSION_CODE_KEYS` by a test, and the two halves of this slice are built apart.

The codes are part of the API: renaming one is a change to the tab that reads it."""
from __future__ import annotations

from homunculus.admission.errors import Refusal

TRES_MODE = "tres_mode"                              # not off, validate or send
TRES_ENVIRONMENT = "tres_environment"                # not test or live
TRES_SETTLE_HOURS = "tres_settle_hours"              # not 0–168
TRES_TYPES = "tres_types"                            # an unknown resource type, or one twice
TRES_BASE_URL = "tres_base_url"                      # not an https:// address of at most 200 characters
TRES_FIELD_LENGTH = "tres_field_length"              # an account field longer than its column
EGRESS_OFF = "egress_off"                            # the install's lock is closed (D2 (b))
TRES_ACCOUNT_INCOMPLETE = "tres_account_incomplete"  # the selected environment's account lacks a part

CODES = frozenset({TRES_MODE, TRES_ENVIRONMENT, TRES_SETTLE_HOURS, TRES_TYPES, TRES_BASE_URL,
                   TRES_FIELD_LENGTH, EGRESS_OFF, TRES_ACCOUNT_INCOMPLETE})

WORDS = {
    TRES_MODE: "The mode is off, validate or send.",
    TRES_ENVIRONMENT: "The environment is test or live.",
    TRES_SETTLE_HOURS: "The wait after a discharge is 0–168 hours.",
    TRES_TYPES: "The resource types are a list of the eight known types, each at most once.",
    TRES_BASE_URL: "A base URL starts with https://, names a host, carries no credentials and is "
                   "at most 200 characters.",
    TRES_FIELD_LENGTH: "An account field is longer than it may be.",
    EGRESS_OFF: "Outbound sending is closed on this installation (TRES_EGRESS is not on).",
    TRES_ACCOUNT_INCOMPLETE: "The selected environment's account is incomplete: the base URL, the "
                             "username, the password and the provider id are all needed.",
}


def refusal(status: int, code: str) -> Refusal:
    """The refusal of `code`, with its words."""
    return Refusal(status, code, WORDS[code])
```

- [ ] **Step 5: The schemas and the body's rules**

```python
# homunculus-engine/src/homunculus/tres/schemas.py
"""GET|PUT /admin/tres/settings and POST /admin/tres/test (TRƏS-01, spec §6, D3).

The screen sends whole bodies. A field too many, or of the wrong type, is FastAPI's own 422; a
value of the right type that the rules refuse is a coded 422 (`settings_refusal`, tres/errors.py).

THE PASSWORD IS WRITE-ONLY. `TresAccountIn.password`: omitted or null keeps the stored one, an
empty string clears it, anything else replaces it. `TresAccountOut` has no password field at all —
only `password_set`. Every other account field is cleared by null or an empty string."""
from __future__ import annotations

from datetime import datetime

import httpx
from pydantic import BaseModel, ConfigDict, StrictInt, StrictStr

from homunculus.tres.errors import (
    TRES_BASE_URL, TRES_ENVIRONMENT, TRES_FIELD_LENGTH, TRES_MODE, TRES_SETTLE_HOURS, TRES_TYPES,
)
from homunculus.tres.models import ACCOUNT_FIELDS, ENVIRONMENTS, MODES, RESOURCE_TYPES

#: The most characters each account field takes (the columns' widths; a password's is its own).
FIELD_MAX = {"base_url": 200, "username": 120, "password": 200, "provider_id": 64,
             "organization_id": 64, "organization_name": 200}
SETTLE_MAX = 168


class TresAccountIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    base_url: StrictStr | None = None
    username: StrictStr | None = None
    password: StrictStr | None = None
    provider_id: StrictStr | None = None
    organization_id: StrictStr | None = None
    organization_name: StrictStr | None = None


class TresSettingsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: StrictStr
    environment: StrictStr
    settle_hours: StrictInt
    enabled_types: list[StrictStr]
    test: TresAccountIn
    live: TresAccountIn


class TresAccountOut(BaseModel):
    base_url: str | None
    username: str | None
    password_set: bool               # never the password itself (D3)
    provider_id: str | None
    organization_id: str | None
    organization_name: str | None


class TresSettingsOut(BaseModel):
    mode: str
    environment: str
    settle_hours: int
    enabled_types: list[str]
    test: TresAccountOut
    live: TresAccountOut
    egress: bool                     # the install's lock (D2 (b)): false = nothing leaves the server
    updated_at: datetime | None      # None: the tenant has never saved the tab


class TresTestOut(BaseModel):
    ok: bool
    message: str | None              # the platform's words when it refused; never a session id


def base_url_ok(value: str) -> bool:
    """https only (the credentials ride in a header), a host, no credentials in the address."""
    if not value.startswith("https://") or len(value) > FIELD_MAX["base_url"]:
        return False
    try:
        url = httpx.URL(value)
    except httpx.InvalidURL:
        return False
    return bool(url.host) and not url.userinfo


def settings_refusal(payload: TresSettingsIn) -> str | None:
    """The code the body is refused with, or None. In the form's order: the first wrong value."""
    if payload.mode not in MODES:
        return TRES_MODE
    if payload.environment not in ENVIRONMENTS:
        return TRES_ENVIRONMENT
    if not 0 <= payload.settle_hours <= SETTLE_MAX:
        return TRES_SETTLE_HOURS
    types = payload.enabled_types
    if len(set(types)) != len(types) or not set(types) <= set(RESOURCE_TYPES):
        return TRES_TYPES
    for prefix in ENVIRONMENTS:
        account = getattr(payload, prefix)
        base_url = (account.base_url or "").strip()
        if base_url and not base_url_ok(base_url):
            return TRES_BASE_URL
        for name in ACCOUNT_FIELDS:
            value = getattr(account, name)
            if value is not None and len(value) > FIELD_MAX[name]:
                return TRES_FIELD_LENGTH
    return None
```

- [ ] **Step 6: The router**

```python
# homunculus-engine/src/homunculus/tres/router.py
"""Yönetim › TRƏS (TRƏS-01, spec §6, D2, D3, D23, D24): the tenant's settings for the national
e-health feed, and a test of the connection. `tres.manage`, the caller's tenant only.

GET /admin/tres/settings — the tenant's row, or the defaults while it has none (mode `off`). The
answer carries `egress`, the install's lock (D2 (b)), so the tab can say that nothing leaves the
server whatever is set here — and NEVER a password: `password_set` only.

PUT /admin/tres/settings — reads the body first (mode, environment, the wait, the types, each
base URL https, the lengths: a coded 422, nothing written). Then it makes the tenant's row if
there is none, locks it and writes what differs. A password omitted or null keeps the stored one;
an empty string clears it. The change is audited `tres.settings` AFTER the commit with the NAMES
of the fields that changed (`mode`, `test.password`…) and never a value (D24; A-26: never a 500
for a committed change). A save that changes nothing writes no audit row.

POST /admin/tres/test — one sign-in at the platform with the stored account of the selected
environment: `{"ok": true}` or `{"ok": false, "message": <the platform's words>}`, never the
session id. 409 `egress_off` while the install's lock is closed — the route then builds no client
at all; 409 `tres_account_incomplete` while the account lacks a part. It is allowed in the mode
`off`: an administrator tests before turning the feed on. Not audited: it writes nothing.

No patient data anywhere in this file."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission import trail
from homunculus.auth.dependencies import caller_tenant_id, require_permission
from homunculus.auth.models import User
from homunculus.db import get_db
from homunculus.tres.client import TresClient, TresError
from homunculus.tres.errors import EGRESS_OFF, TRES_ACCOUNT_INCOMPLETE, refusal
from homunculus.tres.models import (
    ACCOUNT_FIELDS, DEFAULT_SETTLE_HOURS, ENVIRONMENTS, RESOURCE_TYPES, TresSettings, account_of,
)
from homunculus.tres.schemas import (
    TresAccountOut, TresSettingsIn, TresSettingsOut, TresTestOut, settings_refusal,
)

router = APIRouter(prefix="/admin/tres", tags=["tres"])


def _egress(request: Request) -> bool:
    """The install's lock as the app read it at start-up; closed for an app that never read it."""
    return bool(getattr(request.app.state, "tres_egress", False))


def _account_out(row: TresSettings | None, prefix: str) -> TresAccountOut:
    def value(name: str) -> str | None:
        return getattr(row, f"{prefix}_{name}") if row is not None else None

    return TresAccountOut(base_url=value("base_url"), username=value("username"),
                          password_set=bool(value("password")), provider_id=value("provider_id"),
                          organization_id=value("organization_id"),
                          organization_name=value("organization_name"))


def _out(row: TresSettings | None, egress: bool) -> TresSettingsOut:
    return TresSettingsOut(
        mode=row.mode if row is not None else "off",
        environment=row.environment if row is not None else "test",
        settle_hours=row.settle_hours if row is not None else DEFAULT_SETTLE_HOURS,
        enabled_types=list(row.enabled_types) if row is not None else list(RESOURCE_TYPES),
        test=_account_out(row, "test"), live=_account_out(row, "live"), egress=egress,
        updated_at=row.updated_at if row is not None else None)


def _apply(row: TresSettings, payload: TresSettingsIn) -> list[str]:
    """Writes what differs onto the row; answers the NAMES of the fields that changed."""
    changed: list[str] = []

    def put(column: str, value, name: str) -> None:
        if getattr(row, column) != value:
            setattr(row, column, value)
            changed.append(name)

    put("mode", payload.mode, "mode")
    put("environment", payload.environment, "environment")
    put("settle_hours", payload.settle_hours, "settle_hours")
    # In the catalogue's order, whatever order the body listed them in.
    put("enabled_types", [key for key in RESOURCE_TYPES if key in payload.enabled_types], "enabled_types")
    for prefix in ENVIRONMENTS:
        account = getattr(payload, prefix)
        for name in ACCOUNT_FIELDS:
            value = getattr(account, name)
            if name == "password":
                if value is None:
                    continue                    # omitted or null: the stored one stays
                value = value or None           # an empty string clears it
            else:
                value = (value or "").strip() or None
            put(f"{prefix}_{name}", value, f"{prefix}.{name}")
    return changed


@router.get("/settings", response_model=TresSettingsOut)
async def read_settings(
    request: Request,
    db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = Depends(caller_tenant_id),
    _user: User = Depends(require_permission("tres.manage")),
) -> TresSettingsOut:
    return _out(await db.get(TresSettings, caller_tenant), _egress(request))


@router.put("/settings", response_model=TresSettingsOut)
async def write_settings(
    payload: TresSettingsIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = Depends(caller_tenant_id),
    user: User = Depends(require_permission("tres.manage")),
) -> TresSettingsOut:
    refused = settings_refusal(payload)
    if refused is not None:
        raise refusal(422, refused).http()

    actor, user_id = user.username, user.id
    await db.execute(insert(TresSettings).values(tenant_id=caller_tenant)
                     .on_conflict_do_nothing(index_elements=["tenant_id"]))
    row = (await db.execute(
        select(TresSettings).where(TresSettings.tenant_id == caller_tenant)
        .with_for_update().execution_options(populate_existing=True))).scalar_one()
    changed = _apply(row, payload)
    if changed:
        row.updated_at, row.updated_by = datetime.now(timezone.utc), user_id
    answer = _out(row, _egress(request))
    hospital = await trail.hospital_of(db, caller_tenant)
    await db.commit()
    if changed:
        trail.record(request, hospital, "tres.settings", payload={"actor": actor, "changed": changed})
    return answer


@router.post("/test", response_model=TresTestOut)
async def test_connection(
    request: Request,
    db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = Depends(caller_tenant_id),
    _user: User = Depends(require_permission("tres.manage")),
) -> TresTestOut:
    if not _egress(request):
        raise refusal(409, EGRESS_OFF).http()
    row = await db.get(TresSettings, caller_tenant)
    account = account_of(row) if row is not None else None
    if account is None:
        raise refusal(409, TRES_ACCOUNT_INCOMPLETE).http()
    factory = getattr(request.app.state, "tres_client_factory", TresClient)
    try:
        client = factory(account)
    except ValueError:                  # a base URL that is not https, written past this route
        raise refusal(409, TRES_ACCOUNT_INCOMPLETE).http() from None
    try:
        await client.token()
    except TresError as exc:
        return TresTestOut(ok=False, message=exc.message)
    finally:
        await client.aclose()
    return TresTestOut(ok=True, message=None)
```

- [ ] **Step 7: Include it in the app**

In `homunculus-engine/src/homunculus/api/app.py` replace
```python
    from homunculus.protocol.router import router as protocol_router
    app.include_router(protocol_router)
```
with
```python
    from homunculus.protocol.router import router as protocol_router
    app.include_router(protocol_router)
    # TRƏS-01: Yönetim › TRƏS (`tres.manage`, the caller's tenant) — the national e-health feed's
    # settings and its connection test (tres/router.py). nginx already proxies /admin.
    from homunculus.tres.router import router as tres_router
    app.include_router(tres_router)
```
(`deploy/local/web/nginx.conf` already proxies every `/admin/…` path, and `dashboard/vite.config.js` lists `/admin`: no proxy change.)

- [ ] **Step 8: Run the engine side without the database, then with it**

Run: `cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_tres_settings.py tests/test_route_permissions.py tests/test_route_inventory.py tests/test_tenant_isolation.py 2>&1 | tail -3`
Expected: PASS — `38 passed, 158 skipped`.

Run: `cd /c/tmp/tres/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_tres_settings.py tests/test_route_permissions.py 2>&1 | tail -3`
Expected: PASS — `58 passed` (43 + 15; about three minutes).

- [ ] **Step 9: See the dashboard's audit-type test fail**

Run: `cd /c/tmp/tres/dashboard && ./node_modules/.bin/vitest run src/live/screens/denetim/engineTypes.test.js 2>&1 | tail -8`
Expected: FAIL — «names every type the engine writes»: `tres.settings` is written by `tres/router.py` and `EVENT_TYPES` does not name it.

- [ ] **Step 10: Name the event on «Denetim bütünlüğü»**

In `dashboard/src/live/screens/denetim/denetim.js` replace
```js
  ["care_team.attending", "careTeamAttending"], ["care_team.add", "careTeamAdd"], ["care_team.end", "careTeamEnd"],
].map(
```
with
```js
  ["care_team.attending", "careTeamAttending"], ["care_team.add", "careTeamAdd"], ["care_team.end", "careTeamEnd"],
  // TRƏS-01 (spec D24): the national feed's settings changed (tres/router.py) — who, and which fields.
  ["tres.settings", "tresSettings"],
].map(
```
In `dashboard/src/live/screens/denetim/denetim.test.js` replace
```js
    expect(EVENT_TYPES).toHaveLength(55);   // … + G2-B5b's alert_snooze + G2-B1c's three care-team events; + the follow-up's 14 (D3, engineTypes.test.js)
    expect(new Set(EVENT_TYPES.map((e) => e.code)).size).toBe(55);
```
with
```js
    expect(EVENT_TYPES).toHaveLength(56);   // … + G2-B5b's alert_snooze + G2-B1c's three care-team events; + the follow-up's 14 (D3, engineTypes.test.js); + TRƏS-01's tres.settings
    expect(new Set(EVENT_TYPES.map((e) => e.code)).size).toBe(56);
    expect(typeKey("tres.settings")).toBe("denetim.type.tresSettings");   // TRƏS-01 (spec D24)
```
In `dashboard/src/live/i18n/strings/denetim.js`, in each language's `type:` block, add two lines after the care-team line. Turkish — replace
```js
      careTeamAttending: "Sorumlu hekim atandı", careTeamAdd: "Bakım ekibine eklendi", careTeamEnd: "Bakım ekibinden çıkış",
```
with
```js
      careTeamAttending: "Sorumlu hekim atandı", careTeamAdd: "Bakım ekibine eklendi", careTeamEnd: "Bakım ekibinden çıkış",
      // TRƏS-01 (spec D24): the national feed's settings
      tresSettings: "TRƏS ayarları değişti",
```
Azerbaijani — replace
```js
      careTeamAttending: "Məsul həkim təyin edildi", careTeamAdd: "Baxım komandasına əlavə edildi", careTeamEnd: "Baxım komandasından çıxış",
```
with
```js
      careTeamAttending: "Məsul həkim təyin edildi", careTeamAdd: "Baxım komandasına əlavə edildi", careTeamEnd: "Baxım komandasından çıxış",
      // TRƏS-01 (spec D24): the national feed's settings
      tresSettings: "TRƏS ayarları dəyişdirildi",
```
Russian — replace
```js
      careTeamAttending: "Назначен лечащий врач", careTeamAdd: "Добавление в лечебную команду", careTeamEnd: "Выход из лечебной команды",
```
with
```js
      careTeamAttending: "Назначен лечащий врач", careTeamAdd: "Добавление в лечебную команду", careTeamEnd: "Выход из лечебной команды",
      // TRƏS-01 (spec D24): the national feed's settings
      tresSettings: "Изменены настройки TRƏS",
```
English — replace
```js
      careTeamAttending: "Attending physician assigned", careTeamAdd: "Added to the care team", careTeamEnd: "Care-team membership ended",
```
with
```js
      careTeamAttending: "Attending physician assigned", careTeamAdd: "Added to the care team", careTeamEnd: "Care-team membership ended",
      // TRƏS-01 (spec D24): the national feed's settings
      tresSettings: "TRƏS settings changed",
```

- [ ] **Step 11: Run the audit page's tests, the strings and the key sweep**

Run: `cd /c/tmp/tres/dashboard && ./node_modules/.bin/vitest run src/live/screens/denetim src/live/i18n/strings.test.js src/live/rawKeys.test.jsx 2>&1 | tail -6`
Expected: all files pass, no `failed`. (`rawKeys.test.jsx` still passes here: `"tres.settings"` in `denetim.js` is not key-shaped to it until the `tres` namespace exists — Task 12 handles that.)

- [ ] **Step 12: Commit — the engine's routes and the dashboard's label together**

```bash
cd /c/tmp/tres && git add homunculus-engine/src/homunculus/tres/errors.py homunculus-engine/src/homunculus/tres/schemas.py homunculus-engine/src/homunculus/tres/router.py homunculus-engine/tests/test_tres_settings.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_route_permissions.py dashboard/src/live/screens/denetim/denetim.js dashboard/src/live/screens/denetim/denetim.test.js dashboard/src/live/i18n/strings/denetim.js && git commit -m "feat(tres-01): GET|PUT /admin/tres/settings and POST /admin/tres/test — tres.manage, the password write-only, changes audited by field name, the connection test refused while the install's lock is closed; the audit page names tres.settings (spec §6, D3, D23, D24)" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 10: Engine gates

No new code. Everything runs in the foreground.

- [ ] **Step 1: The whole no-DB suite**

Run (in two halves if the tool's time limit is shorter than the run, as in Task 0):
```
cd /c/tmp/tres/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -3
```
Expected: no `failed`; against Task 0's baseline **+96 passed and +58 skipped** (egress 15, client 32, stand-in 14, models 2 + 12 skipped, migration 1 + 5, ledger 3 + 14, worker 4 + 8, settings 24 + 19, permissions 1).

- [ ] **Step 2: The Postgres part — this slice's files and their neighbours**

Run, one command at a time (each a few minutes; the shared database may make a run wait):
```
cd /c/tmp/tres/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_migration_0020_tres.py tests/test_tres_models.py tests/test_tres_ledger.py tests/test_tres_worker.py 2>&1 | tail -3
```
Expected: `49 passed`.
```
cd /c/tmp/tres/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_tres_settings.py tests/test_route_permissions.py tests/test_protocol_settings.py 2>&1 | tail -3
```
Expected: no `failed` (the first two are 58).
```
cd /c/tmp/tres/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_migration_0019_pharmacy_view.py tests/test_migration_0018_care_team_transfer.py tests/test_migration_0010_schema_parity.py tests/test_conftest_tables.py 2>&1 | tail -3
```
Expected: no `failed` — the older migrations' tests still pass with 0020 above them, and the whole-schema type test agrees.

- [ ] **Step 3: Nothing in the engine sends anything by itself**

Run: `cd /c/tmp/tres && grep -rn "tres_source\|no_packages" homunculus-engine/src/homunculus --include=*.py | grep -v "^homunculus-engine/src/homunculus/tres/worker.py"`
Expected: exactly the lines of `api/app.py` — its import of `no_packages`, the assignment `app.state.tres_source = no_packages` and the use `source=app.state.tres_source` in the lifespan. No other module supplies a source: with any setting, phase F0 asks the platform for nothing but the connection test's one session.

- [ ] **Step 4:** No commit unless a fix was needed (a fix is its own commit, with the suites green again). Write the numbers down for Task 15: engine `passed/skipped`, the three Postgres results.

---


## Dashboard (Tasks 11–14 need Tasks 0, 1 and 9, and nothing from Tasks 3–8)

### Task 11: The API client's three calls, and the test stand-in's

`dashboard/src/backendApi.js` is the framework-free client of the real API; `fakeApi` (`src/live/session/testTokens.testutil.js`) is its stand-in in every component test and lists every call the live UI makes, so a screen that reaches for a missing one fails with «not a function».

**Files:**
- Modify: `dashboard/src/backendApi.js` (after `saveProtocolSettings`, ~line 1022)
- Modify: `dashboard/src/live/session/testTokens.testutil.js` (after `admissionLabel: vi.fn(),`, ~line 116)
- Test: `dashboard/src/backendApi.test.js` (a new `describe` at the end of the file)

- [ ] **Step 1: Write the failing test**

Append at the end of `dashboard/src/backendApi.test.js` (it uses the file's own top-level `store`, `jsonResponse` and `createBackendApi`):
```js
// TRƏS-01 — Yönetim › TRƏS: the settings and the connection test (homunculus-engine tres/router.py)
describe("TRƏS-01 calls", () => {
  it("reads and saves the settings and tests the connection, each with the session's token", async () => {
    store.set("homunculus-access-token", "acc-1");
    store.set("homunculus-refresh-token", "ref-1");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, message: null }));
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
    const account = { base_url: "https://ehr-sandbox.example.az", username: "sentetik", password: "gizli-parola",
      provider_id: "PRV-0001", organization_id: null, organization_name: null };
    const empty = { base_url: null, username: null, provider_id: null, organization_id: null, organization_name: null };
    const body = { mode: "validate", environment: "test", settle_hours: 24, enabled_types: ["patient"], test: account, live: empty };
    await api.tresSettings();
    await api.saveTresSettings(body);
    expect(await api.testTres()).toEqual({ ok: true, message: null });
    expect(fetchMock.mock.calls.map(([url, init]) => [String(url), init.method])).toEqual([
      ["/admin/tres/settings", "GET"], ["/admin/tres/settings", "PUT"], ["/admin/tres/test", "POST"],
    ]);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(body);
    for (const [, init] of fetchMock.mock.calls) expect(init.headers.Authorization).toBe("Bearer acc-1");
  });

  it("a coded refusal carries its code", async () => {
    store.set("homunculus-access-token", "acc-1");
    store.set("homunculus-refresh-token", "ref-1");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ detail: {
      code: "egress_off", message: "Outbound sending is closed on this installation (TRES_EGRESS is not on).",
    } }, { ok: false, status: 409 }));
    const err = await createBackendApi({ baseUrl: "", fetchImpl: fetchMock }).testTres().catch((e) => e);
    expect(err).toMatchObject({ status: 409, apiCode: "egress_off" });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/tmp/tres/dashboard && ./node_modules/.bin/vitest run src/backendApi.test.js 2>&1 | tail -6`
Expected: FAIL — `api.tresSettings is not a function` and `….testTres is not a function`.

- [ ] **Step 3: Add the calls and their stand-ins**

In `dashboard/src/backendApi.js` replace
```js
    saveProtocolSettings(body) { return authed("/admin/protocol-settings", { method: "PUT", body }); },
```
with
```js
    saveProtocolSettings(body) { return authed("/admin/protocol-settings", { method: "PUT", body }); },
    // TRƏS-01 — Yönetim › TRƏS (homunculus-engine tres/router.py), `tres.manage`. The password is write-only: an
    // account's `password` left out (or null) keeps the stored one, "" clears it; the answer says `password_set`.
    // Refusals carry `err.apiCode` (tres/errors.py): `tres_mode`, `tres_base_url`, `egress_off` …
    /** {mode, environment, settle_hours, enabled_types, test: {base_url, username, password_set, provider_id,
     *  organization_id, organization_name}, live: {…}, egress, updated_at} — never a password. */
    tresSettings() { return authed("/admin/tres/settings"); },
    /** {mode, environment, settle_hours, enabled_types, test: {…, password?}, live: {…, password?}} → as tresSettings() */
    saveTresSettings(body) { return authed("/admin/tres/settings", { method: "PUT", body }); },
    /** One sign-in at the platform with the stored account of the selected environment:
     *  {ok: true, message: null} | {ok: false, message}. 409 `egress_off`, 409 `tres_account_incomplete`. */
    testTres() { return authed("/admin/tres/test", { method: "POST" }); },
```
In `dashboard/src/live/session/testTokens.testutil.js` replace
```js
    admissionLabel: vi.fn(),
```
with
```js
    admissionLabel: vi.fn(),
    // TRƏS-01: Yönetim › TRƏS — the settings and the connection test (screens/admin/TresTab.jsx)
    tresSettings: vi.fn(),
    saveTresSettings: vi.fn(),
    testTres: vi.fn(),
```

- [ ] **Step 4: Run the client's tests and the wave panel's boundary test**

Run: `cd /c/tmp/tres/dashboard && ./node_modules/.bin/vitest run src/backendApi.test.js src/live/waveBoundaries.test.js 2>&1 | tail -5`
Expected: `Test Files  2 passed (2)`. (`waveBoundaries.test.js` reads the client's method names: the wave panel's sources may name none of them.)

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/tres && git add dashboard/src/backendApi.js dashboard/src/backendApi.test.js dashboard/src/live/session/testTokens.testutil.js && git commit -m "feat(tres-01): the API client's TRƏS calls — the settings read and write, the connection test; their test stand-ins (spec §6)" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 12: The `tres` strings, the refusals' map, and the audit codes' exemption

Three things that belong to one commit:
1. the namespace `strings/tres.js` in four languages (Turkish is the source; the tests run in Azerbaijani), registered in `i18n/catalog.js`. `i18n/strings.test.js` holds every namespace to the same keys in the four languages, refuses an Azerbaijani text equal to its Turkish source unless it is listed as reviewed, and a Russian text without a Cyrillic letter — the texts below pass all three as they are, with no listing;
2. `TRES_CODE_KEYS` in `apiErrors.js` — the routes' refusal codes to their texts, consulted where the task queue's map is;
3. `rawKeys.test.jsx`: once `tres` is a namespace, the audit event code `"tres.settings"` that Task 9 wrote into `screens/denetim/denetim.js` LOOKS like a translation key to the source sweep (first word a namespace). It is not one — exactly as the permission key `tres.manage` is not, and permission keys are exempt already. The sweep gets the same exemption for the audit page's event codes.

**Files:**
- Create: `dashboard/src/live/i18n/strings/tres.js`
- Modify: `dashboard/src/live/i18n/catalog.js` (the import block's end ~line 94; `NAMESPACES`' end ~line 152)
- Modify: `dashboard/src/live/apiErrors.js` (after `TASK_CODE_KEYS` ~line 267; in `admissionCodeKey` ~line 363)
- Modify: `dashboard/src/live/apiErrors.test.js` (the import ~line 11; a new `describe` at the end)
- Modify: `dashboard/src/live/rawKeys.test.jsx` (the imports ~line 51; after `PERMISSION_KEY` ~line 101; `keyProblems` ~line 799; the detector's sample ~line 841)

- [ ] **Step 1: Write the refusals' failing test**

In `dashboard/src/live/apiErrors.test.js` replace
```js
  ADMISSION_CODE_KEYS, API_MESSAGE_KEYS, INVALID_FIELD_KEYS, WITH_NUMBER, WITH_PROTOCOL,
```
with
```js
  ADMISSION_CODE_KEYS, API_MESSAGE_KEYS, INVALID_FIELD_KEYS, TRES_CODE_KEYS, WITH_NUMBER, WITH_PROTOCOL,
```
and append at the end of the file:
```js
// TRƏS-01 — Yönetim › TRƏS: the routes' refusals, by code (err.apiCode; homunculus-engine tres/errors.py).
describe("the national feed's refusals (TRƏS-01)", () => {
  const CODES = ["tres_mode", "tres_environment", "tres_settle_hours", "tres_types", "tres_base_url",
    "tres_field_length", "egress_off", "tres_account_incomplete"];

  it("maps each by its code, whatever the server's words", () => {
    expect([...TRES_CODE_KEYS.keys()].sort()).toEqual([...CODES].sort());
    const closed = Object.assign(new Error("Outbound sending is closed on this installation (TRES_EGRESS is not on)."),
      { status: 409, apiCode: "egress_off" });
    expect(apiErrorKey(closed)).toEqual({ key: "tres.err.egressOff", vars: {} });
    expect(apiErrorKey(Object.assign(new Error("x"), { status: 422, apiCode: "tres_base_url" })).key).toBe("tres.err.baseUrl");
  });

  it("every coded refusal has its text in the four languages, and is said in the reader's", () => {
    for (const code of CODES) {
      const hit = apiErrorKey(Object.assign(new Error("x"), { status: 422, apiCode: code }));
      expect(hit?.key, code).toMatch(/^tres\.err\./);
      for (const lang of LANG_CODES) expect(DICTIONARIES[lang][hit.key], `${lang} ${hit.key}`).toBeTruthy();
    }
    const t = createTranslator("az", DICTIONARIES);
    expect(apiErrorText(t, Object.assign(new Error("x"), { status: 409, apiCode: "egress_off" })))
      .toBe("Bu quraşdırmada xaricə göndəriş bağlıdır; bağlantı yoxlanılmadı.");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/tmp/tres/dashboard && ./node_modules/.bin/vitest run src/live/apiErrors.test.js 2>&1 | tail -8`
Expected: FAIL — the two new tests: `TRES_CODE_KEYS` is `undefined` (`Cannot read properties of undefined (reading 'keys')`), and `egress_off` has no key.

- [ ] **Step 3: The namespace**

Create `dashboard/src/live/i18n/strings/tres.js`:
```js
// src/live/i18n/strings/tres.js — TRƏS-01: the national e-health feed. Phase F0: Yönetim › TRƏS
// (screens/admin/TresTab.jsx) — the two locks, the mode, the environment, the two accounts, the
// record types — and the words of the routes' coded refusals (apiErrors.js `TRES_CODE_KEYS`). Later
// phases add their panels' words here (deliveries, the department map, the practitioner identities).
//
// TR is the source; AZ is the default. AZ, RU and EN are the planner's and await a native reading
// before the first hospital opens the feed. No text here is clinical advice.
//
// «TRƏS» is the platform's own name and is written the same in every language.
export default {
  tr: {
    tab: "TRƏS (e-Sağlık)",
    title: "Ulusal e-sağlık gönderimi (TRƏS)",
    sub: "Yatış kayıtlarının bakanlığın e-sağlık platformuna gönderimi. Varsayılan olarak kapalıdır: iki kilit birlikte açılmadan hiçbir şey gönderilmez.",
    loading: "Yükleniyor…",
    readFailed: "Ayarlar okunamadı: {reason}",
    egressOff: "Bu kurulumda dışarıya gönderim kapalı: buradaki ayar ne olursa olsun sunucudan hiçbir veri çıkmaz. Açmak için kurulumun ortam değişkeni TRES_EGRESS=on yapılır.",
    egressOn: "Bu kurulumda dışarıya gönderim açık: aşağıdaki kip ve hesap geçerlidir.",
    mode: "Kip",
    modeOff: "Kapalı",
    modeValidate: "Yalnız doğrula (platforma kayıt yazılmaz)",
    modeSend: "Gönder",
    modeHint: "«Yalnız doğrula» platformun denetimini çalıştırır, kayıt bırakmaz. Bir kurumda ilk açılışta önce bu kip kullanılır.",
    environment: "Ortam",
    envTest: "Sınama ortamı (sandbox)",
    envLive: "Canlı ortam",
    incomplete: "Seçili ortamın hesabı eksik: adres, kullanıcı adı, parola ve sağlık kuruluşu kimliği girilmeden hiçbir şey gönderilmez.",
    settleHours: "Taburcudan sonra bekleme (saat)",
    settleHint: "0–168 saat. Taburcudan sonraki düzeltmeler için beklenir; varsayılan 24.",
    types: "Gönderilecek kayıt türleri",
    type: {
      patient: "Hasta",
      practitioner: "Hekim",
      encounter: "Hastane yatışı",
      condition: "Tanı",
      procedure: "İşlem",
      vital: "Vital bulgular",
      lab: "Laboratuvar sonuçları",
      composition: "Taburcu epikrizi",
    },
    accountTest: "Sınama ortamı hesabı",
    accountLive: "Canlı ortam hesabı",
    baseUrl: "Sunucu adresi",
    baseUrlHint: "https:// ile başlamalıdır.",
    username: "Kullanıcı adı",
    password: "Parola",
    passwordStored: "kayıtlı",
    passwordSet: "Parola kayıtlı. Değiştirmek için yenisini yazın; boş bırakırsanız aynı kalır.",
    passwordUnset: "Parola girilmedi.",
    passwordClear: "Kayıtlı parolayı sil",
    providerId: "Sağlık kuruluşu kimliği (healthcareProviderId)",
    organizationId: "Kurum kimliği (Organization)",
    organizationName: "Kurum adı",
    updated: "Son değişiklik: {time}",
    save: "Kaydet",
    saved: "TRƏS ayarları kaydedildi.",
    test: "Bağlantıyı sına",
    testHint: "Sınama kayıtlı hesapla yapılır; hesabı değiştirdiyseniz önce kaydedin.",
    testEgressOff: "Dışarıya gönderim kapalıyken bağlantı sınanamaz.",
    testOk: "Bağlantı kuruldu: platform oturum açtı.",
    testFailed: "Bağlantı kurulamadı: {reason}",
    testNoWords: "platform açıklama vermedi",
    invalid: {
      settle: "0 ile 168 arasında tam sayı girin.",
      baseUrl: "Adres https:// ile başlamalı.",
    },
    err: {
      mode: "Kip geçersiz.",
      environment: "Ortam geçersiz.",
      settleHours: "Bekleme süresi 0–168 saat olmalı.",
      types: "Kayıt türleri listesi geçersiz.",
      baseUrl: "Sunucu adresi https:// ile başlamalı, kullanıcı adı ya da parola içermemeli ve en çok 200 karakter olmalı.",
      fieldLength: "Hesap alanlarından biri çok uzun.",
      egressOff: "Bu kurulumda dışarıya gönderim kapalı; bağlantı sınanmadı.",
      accountIncomplete: "Seçili ortamın hesabı eksik; bağlantı sınanmadı.",
    },
  },
  az: {
    tab: "TRƏS (e-Səhiyyə)",
    title: "Milli e-səhiyyə göndərişi (TRƏS)",
    sub: "Yatış qeydlərinin nazirliyin e-səhiyyə platformasına göndərilməsi. İlkin olaraq bağlıdır: iki kilid birlikdə açılmadan heç nə göndərilmir.",
    loading: "Yüklənir…",
    readFailed: "Ayarlar oxunmadı: {reason}",
    egressOff: "Bu quraşdırmada xaricə göndəriş bağlıdır: buradakı ayar nə olursa olsun, serverdən heç bir məlumat çıxmır. Açmaq üçün quraşdırmanın mühit dəyişəni TRES_EGRESS=on edilir.",
    egressOn: "Bu quraşdırmada xaricə göndəriş açıqdır: aşağıdakı rejim və hesab qüvvədədir.",
    mode: "Rejim",
    modeOff: "Bağlı",
    modeValidate: "Yalnız yoxla (platformaya qeyd yazılmır)",
    modeSend: "Göndər",
    modeHint: "«Yalnız yoxla» platformanın yoxlamasını işə salır, qeyd saxlamır. Müəssisədə ilk açılışda əvvəlcə bu rejimdən istifadə olunur.",
    environment: "Mühit",
    envTest: "Sınaq mühiti (sandbox)",
    envLive: "Canlı mühit",
    incomplete: "Seçilmiş mühitin hesabı natamamdır: ünvan, istifadəçi adı, parol və səhiyyə müəssisəsinin identifikatoru daxil edilmədən heç nə göndərilmir.",
    settleHours: "Evə yazılmadan sonra gözləmə (saat)",
    settleHint: "0–168 saat. Evə yazılmadan sonrakı düzəlişlər üçün gözlənilir; ilkin dəyər 24.",
    types: "Göndəriləcək qeyd növləri",
    type: {
      patient: "Xəstə",
      practitioner: "Həkim",
      encounter: "Xəstəxanaya yatış",
      condition: "Diaqnoz",
      procedure: "Prosedur",
      vital: "Vital göstəricilər",
      lab: "Laboratoriya nəticələri",
      composition: "Evə yazılma epikrizi",
    },
    accountTest: "Sınaq mühitinin hesabı",
    accountLive: "Canlı mühitin hesabı",
    baseUrl: "Server ünvanı",
    baseUrlHint: "https:// ilə başlamalıdır.",
    username: "İstifadəçi adı",
    password: "Parol",
    passwordStored: "qeyd olunub",
    passwordSet: "Parol qeyd olunub. Dəyişmək üçün yenisini yazın; boş saxlasanız, olduğu kimi qalır.",
    passwordUnset: "Parol daxil edilməyib.",
    passwordClear: "Qeyd olunmuş parolu sil",
    providerId: "Səhiyyə müəssisəsinin identifikatoru (healthcareProviderId)",
    organizationId: "Müəssisənin identifikatoru (Organization)",
    organizationName: "Müəssisənin adı",
    updated: "Son dəyişiklik: {time}",
    save: "Yadda saxla",
    saved: "TRƏS ayarları yadda saxlanıldı.",
    test: "Bağlantını yoxla",
    testHint: "Yoxlama qeyd olunmuş hesabla aparılır; hesabı dəyişmisinizsə, əvvəlcə yadda saxlayın.",
    testEgressOff: "Xaricə göndəriş bağlı ikən bağlantı yoxlanıla bilməz.",
    testOk: "Bağlantı quruldu: platforma sessiya açdı.",
    testFailed: "Bağlantı qurulmadı: {reason}",
    testNoWords: "platforma izahat vermədi",
    invalid: {
      settle: "0 ilə 168 arasında tam ədəd daxil edin.",
      baseUrl: "Ünvan https:// ilə başlamalıdır.",
    },
    err: {
      mode: "Rejim etibarsızdır.",
      environment: "Mühit etibarsızdır.",
      settleHours: "Gözləmə müddəti 0–168 saat olmalıdır.",
      types: "Qeyd növlərinin siyahısı etibarsızdır.",
      baseUrl: "Server ünvanı https:// ilə başlamalı, istifadəçi adı və ya parol daşımamalı və ən çoxu 200 simvol olmalıdır.",
      fieldLength: "Hesab sahələrindən biri həddən artıq uzundur.",
      egressOff: "Bu quraşdırmada xaricə göndəriş bağlıdır; bağlantı yoxlanılmadı.",
      accountIncomplete: "Seçilmiş mühitin hesabı natamamdır; bağlantı yoxlanılmadı.",
    },
  },
  ru: {
    tab: "TRƏS (э-здравоохранение)",
    title: "Передача в национальную систему э-здравоохранения (TRƏS)",
    sub: "Передача записей о госпитализации на платформу э-здравоохранения министерства. По умолчанию выключена: пока не открыты оба замка, ничего не отправляется.",
    loading: "Загрузка…",
    readFailed: "Не удалось прочитать настройки: {reason}",
    egressOff: "В этой установке отправка наружу закрыта: какими бы ни были настройки здесь, с сервера не уходят никакие данные. Чтобы открыть её, в установке задают переменную окружения TRES_EGRESS=on.",
    egressOn: "В этой установке отправка наружу открыта: действуют режим и учётная запись, указанные ниже.",
    mode: "Режим",
    modeOff: "Выключено",
    modeValidate: "Только проверка (на платформу ничего не записывается)",
    modeSend: "Отправлять",
    modeHint: "«Только проверка» запускает проверку на платформе и ничего не сохраняет. При первом включении в учреждении сначала используют этот режим.",
    environment: "Среда",
    envTest: "Тестовая среда (sandbox)",
    envLive: "Рабочая среда",
    incomplete: "Учётная запись выбранной среды неполная: без адреса, имени пользователя, пароля и идентификатора медучреждения ничего не отправляется.",
    settleHours: "Ожидание после выписки (часы)",
    settleHint: "0–168 часов. Время на исправления после выписки; по умолчанию 24.",
    types: "Какие виды записей отправлять",
    type: {
      patient: "Пациент",
      practitioner: "Врач",
      encounter: "Госпитализация",
      condition: "Диагноз",
      procedure: "Процедура",
      vital: "Витальные показатели",
      lab: "Лабораторные результаты",
      composition: "Выписной эпикриз",
    },
    accountTest: "Учётная запись тестовой среды",
    accountLive: "Учётная запись рабочей среды",
    baseUrl: "Адрес сервера",
    baseUrlHint: "Должен начинаться с https://.",
    username: "Имя пользователя",
    password: "Пароль",
    passwordStored: "сохранён",
    passwordSet: "Пароль сохранён. Чтобы изменить, введите новый; если оставить поле пустым, он не изменится.",
    passwordUnset: "Пароль не задан.",
    passwordClear: "Удалить сохранённый пароль",
    providerId: "Идентификатор медучреждения (healthcareProviderId)",
    organizationId: "Идентификатор организации (Organization)",
    organizationName: "Название организации",
    updated: "Последнее изменение: {time}",
    save: "Сохранить",
    saved: "Настройки TRƏS сохранены.",
    test: "Проверить соединение",
    testHint: "Проверка выполняется с сохранённой учётной записью; если вы её изменили, сначала сохраните.",
    testEgressOff: "Пока отправка наружу закрыта, соединение проверить нельзя.",
    testOk: "Соединение установлено: платформа открыла сессию.",
    testFailed: "Соединение не установлено: {reason}",
    testNoWords: "платформа не дала объяснения",
    invalid: {
      settle: "Введите целое число от 0 до 168.",
      baseUrl: "Адрес должен начинаться с https://.",
    },
    err: {
      mode: "Недопустимый режим.",
      environment: "Недопустимая среда.",
      settleHours: "Ожидание должно быть от 0 до 168 часов.",
      types: "Недопустимый список видов записей.",
      baseUrl: "Адрес сервера должен начинаться с https://, не содержать имени пользователя и пароля и быть не длиннее 200 символов.",
      fieldLength: "Одно из полей учётной записи слишком длинное.",
      egressOff: "В этой установке отправка наружу закрыта; соединение не проверялось.",
      accountIncomplete: "Учётная запись выбранной среды неполная; соединение не проверялось.",
    },
  },
  en: {
    tab: "TRƏS (e-health)",
    title: "National e-health feed (TRƏS)",
    sub: "Sends the records of a hospital stay to the ministry's e-health platform. Off by default: nothing is sent until both locks are open.",
    loading: "Loading…",
    readFailed: "The settings could not be read: {reason}",
    egressOff: "Outbound sending is closed on this installation: whatever is set here, no data leaves the server. To open it, the installation's environment variable TRES_EGRESS is set to on.",
    egressOn: "Outbound sending is open on this installation: the mode and the account below apply.",
    mode: "Mode",
    modeOff: "Off",
    modeValidate: "Validate only (nothing is written to the platform)",
    modeSend: "Send",
    modeHint: "«Validate only» runs the platform's check and stores nothing. A hospital opening the feed for the first time starts in this mode.",
    environment: "Environment",
    envTest: "Test environment (sandbox)",
    envLive: "Live environment",
    incomplete: "The selected environment's account is incomplete: nothing is sent until the address, the username, the password and the healthcare provider id are entered.",
    settleHours: "Wait after discharge (hours)",
    settleHint: "0–168 hours. Leaves time for corrections after a discharge; 24 by default.",
    types: "Record types to send",
    type: {
      patient: "Patient",
      practitioner: "Practitioner",
      encounter: "Hospital stay",
      condition: "Diagnosis",
      procedure: "Procedure",
      vital: "Vital signs",
      lab: "Laboratory results",
      composition: "Discharge summary",
    },
    accountTest: "Test environment account",
    accountLive: "Live environment account",
    baseUrl: "Server address",
    baseUrlHint: "Must start with https://.",
    username: "Username",
    password: "Password",
    passwordStored: "stored",
    passwordSet: "A password is stored. Type a new one to change it; left empty, it stays as it is.",
    passwordUnset: "No password is stored.",
    passwordClear: "Remove the stored password",
    providerId: "Healthcare provider id (healthcareProviderId)",
    organizationId: "Organization id",
    organizationName: "Organization name",
    updated: "Last change: {time}",
    save: "Save",
    saved: "The TRƏS settings were saved.",
    test: "Test the connection",
    testHint: "The test uses the stored account; if you changed the account, save first.",
    testEgressOff: "The connection cannot be tested while outbound sending is closed.",
    testOk: "Connected: the platform opened a session.",
    testFailed: "The connection failed: {reason}",
    testNoWords: "the platform gave no explanation",
    invalid: {
      settle: "Enter a whole number from 0 to 168.",
      baseUrl: "The address must start with https://.",
    },
    err: {
      mode: "The mode is not valid.",
      environment: "The environment is not valid.",
      settleHours: "The wait must be 0–168 hours.",
      types: "The list of record types is not valid.",
      baseUrl: "The server address must start with https://, carry no username or password and be at most 200 characters.",
      fieldLength: "One of the account fields is too long.",
      egressOff: "Outbound sending is closed on this installation; the connection was not tested.",
      accountIncomplete: "The selected environment's account is incomplete; the connection was not tested.",
    },
  },
};
```

- [ ] **Step 4: Register it**

In `dashboard/src/live/i18n/catalog.js` replace
```js
import eczane from "./strings/eczane.js";

export const NAMESPACES = {
```
with
```js
import eczane from "./strings/eczane.js";

// TRƏS-01: the national e-health feed — Yönetim › TRƏS (screens/admin/TresTab.jsx) and its refusals.
import tres from "./strings/tres.js";

export const NAMESPACES = {
```
and replace
```js
  eczane, // G3-04
};
```
with
```js
  eczane, // G3-04

  tres, // TRƏS-01
};
```

- [ ] **Step 5: The refusals' map**

In `dashboard/src/live/apiErrors.js` replace
```js
  ["vital_not_due", "gorevler.err.vitalNotDue"],
]);
```
with
```js
  ["vital_not_due", "gorevler.err.vitalNotDue"],
]);

/** TRƏS-01 — Yönetim › TRƏS (homunculus-engine tres/errors.py, spec §6): the routes' refusals by their code
 *  (`err.apiCode`). Its own map, as the task queue's: ADMISSION_CODE_KEYS is held to admission/errors.py. */
export const TRES_CODE_KEYS = new Map([
  ["tres_mode", "tres.err.mode"],
  ["tres_environment", "tres.err.environment"],
  ["tres_settle_hours", "tres.err.settleHours"],
  ["tres_types", "tres.err.types"],
  ["tres_base_url", "tres.err.baseUrl"],
  ["tres_field_length", "tres.err.fieldLength"],
  ["egress_off", "tres.err.egressOff"],
  ["tres_account_incomplete", "tres.err.accountIncomplete"],
]);
```
and replace
```js
  if (TASK_CODE_KEYS.has(code)) return { key: TASK_CODE_KEYS.get(code), vars: {} };
```
with
```js
  if (TASK_CODE_KEYS.has(code)) return { key: TASK_CODE_KEYS.get(code), vars: {} };
  if (TRES_CODE_KEYS.has(code)) return { key: TRES_CODE_KEYS.get(code), vars: {} };
```

- [ ] **Step 6: Run the strings and the refusals; see the key sweep fail**

Run: `cd /c/tmp/tres/dashboard && ./node_modules/.bin/vitest run src/live/i18n/strings.test.js src/live/apiErrors.test.js 2>&1 | tail -5`
Expected: `Test Files  2 passed (2)`.

Run: `cd /c/tmp/tres/dashboard && ./node_modules/.bin/vitest run src/live/rawKeys.test.jsx 2>&1 | grep -E "×|→|denetim|Tests " | head -6`
Expected: FAIL — one test, «names no key the dictionaries do not have…»: `screens\denetim\denetim.js → tres.settings (az, tr, ru, en)`. That is the audit event code of Task 9, now namespace-shaped.

- [ ] **Step 7: Exempt the audit page's event codes from the source sweep**

In `dashboard/src/live/rawKeys.test.jsx` replace
```js
import { answer as pharmacyAnswer } from "./screens/eczane/eczane.testutil.js"; // G3-04
```
with
```js
import { answer as pharmacyAnswer } from "./screens/eczane/eczane.testutil.js"; // G3-04
import { EVENT_TYPES } from "./screens/denetim/denetim.js"; // TRƏS-01: the audit's event codes (EVENT_CODE below)
```
replace
```js
const PERMISSION_KEY = new Set(PERMISSION_KEYS);
```
with
```js
const PERMISSION_KEY = new Set(PERMISSION_KEYS);
/** An audit EVENT CODE is not a translation key either, and one of them is namespace-shaped: `tres.settings`
 *  (TRƏS-01) shares its first word with the `tres` namespace, as `tres.manage` does among the permissions. The
 *  audit page's table (`screens/denetim/denetim.js` EVENT_TYPES) names each code on purpose, to map it to its
 *  label. Only the EXACT codes of that table are exempt, and only where a SOURCE names them: a labelled code is
 *  never shown to a reader in place of its label, so the rendered sweep (`rawKeys`) does not exempt them. */
const EVENT_CODE = new Set(EVENT_TYPES.map((e) => e.code));
```
replace
```js
    if (!NAMESPACE.has(key.split(".")[0]) || PERMISSION_KEY.has(key) || A_FILE.test(key)) continue;
```
with
```js
    if (!NAMESPACE.has(key.split(".")[0]) || PERMISSION_KEY.has(key) || EVENT_CODE.has(key) || A_FILE.test(key)) continue;
```
and, in the detector's own sample (so the exemption is itself tested: the sample's expected problems stay the same four), replace
```js
      'const store = "hmc.lock"; const perm = "board.view"; const file = "api/board.py";',
```
with
```js
      'const store = "hmc.lock"; const perm = "board.view"; const file = "api/board.py";',
      'const TYPES = [["tres.settings", "tresSettings"]];',                      // an audit event code, not a key
```

- [ ] **Step 8: Run the sweep, the strings, the refusals and the audit page**

Run: `cd /c/tmp/tres/dashboard && ./node_modules/.bin/vitest run src/live/rawKeys.test.jsx src/live/i18n/strings.test.js src/live/apiErrors.test.js src/live/screens/denetim 2>&1 | tail -6`
Expected: all files pass, no `failed`.

- [ ] **Step 9: Commit**

```bash
cd /c/tmp/tres && git add dashboard/src/live/i18n/strings/tres.js dashboard/src/live/i18n/catalog.js dashboard/src/live/apiErrors.js dashboard/src/live/apiErrors.test.js dashboard/src/live/rawKeys.test.jsx && git commit -m "feat(tres-01): the tres strings in four languages; the routes' refusals by code; the key sweep leaves the audit page's event codes alone (spec D27, §6)" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 13: The tab — `TresTab.jsx`, registered, and `/admin` opened to `tres.manage`

Yönetim › TRƏS, phase F0's one panel («Bağlantı ve ayar» of spec §8; the other four panels come with F1 and later), on the pattern of `screens/admin/ProtocolTab.jsx`: read through `store.track(() => store.api.…)`, never a form on defaults it did not read, a refusal on the toast through `refusedFor` (`screens/admin/refusal.js`). The component's test mounts it with `mount` (`session/mount.testutil.jsx`), which builds a `fakeApi` and hands it to `setup`; `settle` and `toasts` come from `screens/kabul/kabul.testutil.js`. The texts the tests look for are the Azerbaijani strings of Task 12.

The tab and its registration are ONE task and one commit: `src/reachable.test.js` fails for a module the page cannot reach, so a commit holding the tab without its line in `AdminScreen.jsx` would be red. The registration is the tab's three seam lines in `AdminScreen.jsx` (its own `lazyScreen` line, its `TABS` line with `perm: "tres.manage"`, its `TAB_SCREENS` line — each with a blank line either side), and the `/admin` route's `perms`: today `users.manage` or `groups.manage`, so a session holding `tres.manage` alone could not open the screen its one tab is on (spec §8). `AdminScreen` gates every tab by its own right and `useAdminData` asks only the reads the rights allow, so such a session sees one tab and no refused read. `rawKeys.test.jsx` sweeps every tab of every built screen; unstubbed, the new tab would only say its settings could not be read.

**Files:**
- Create: `dashboard/src/live/screens/admin/TresTab.jsx`
- Test: `dashboard/src/live/screens/admin/TresTab.test.jsx`
- Modify: `dashboard/src/live/screens/admin/AdminScreen.jsx` (the header table ~line 8; the gating note ~lines 17–19; after the `TasksTab` lazy line ~line 49; `TABS` ~line 77; `TAB_SCREENS` ~line 98)
- Modify: `dashboard/src/live/screens/admin/AdminScreen.test.jsx` (the imports ~line 13; the `TABS` pin ~line 76; after the tasks tab's test ~line 118)
- Modify: `dashboard/src/live/shell/routes.js` (the `admin` route, ~lines 114–115)
- Modify: `dashboard/src/live/shell/routes.test.js` (a new `describe` at the end)
- Modify: `dashboard/src/live/rawKeys.test.jsx` (a fixture after `PROTOCOL_SETTINGS` ~line 226; the stub in `openAt` ~line 302; an anchor test after the Protokol one ~line 628)

- [ ] **Step 1: Write the tab's failing test**

```jsx
// src/live/screens/admin/TresTab.test.jsx — Yönetim › TRƏS (TRƏS-01 · F0, spec §6, §8, D2, D3): the tab says
// which lock is closed; the form stands on what it read; the password is never shown and is left out of the body
// unless typed; a bad value is held before anything is sent; a refusal is said by its code and the form keeps what
// was typed; the connection test tells the platform's words. Synthetic account only.
import { describe, it, expect } from "vitest";
import React from "react";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { settle, toasts } from "../kabul/kabul.testutil.js";
import { TYPES, TresTab, accountBody, bodyOf, invalid } from "./TresTab.jsx";

const PERMS = ["tres.manage"];
const EMPTY = { base_url: null, username: null, password_set: false, provider_id: null, organization_id: null, organization_name: null };
const ALL = TYPES.map(([key]) => key);
const UNSET = { mode: "off", environment: "test", settle_hours: 24, enabled_types: ALL, test: EMPTY, live: EMPTY,
  egress: false, updated_at: null };
const SANDBOX = { base_url: "https://ehr-sandbox.example.az", username: "sentetik", password_set: true,
  provider_id: "PRV-0001", organization_id: "ORG-0001", organization_name: "Sentetik Hastane" };
const SET = { ...UNSET, mode: "validate", test: SANDBOX, egress: true, updated_at: "2026-11-11T08:00:00Z" };
const NO_ACCOUNT = { base_url: null, username: null, provider_id: null, organization_id: null, organization_name: null };

async function mounted(setup) {
  const m = await mount(<TresTab />, { access: token({ perms: PERMS }), me: profile({ perms: PERMS }), setup });
  await settle();
  return m;
}
const sandbox = () => within(screen.getByRole("group", { name: "Sınaq mühitinin hesabı" }));
const live = () => within(screen.getByRole("group", { name: "Canlı mühitin hesabı" }));
const save = async () => {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yadda saxla" })); });
  await settle();
};
const testButton = () => screen.getByRole("button", { name: "Bağlantını yoxla" });
const pressTest = async () => {
  await act(async () => { fireEvent.click(testButton()); });
  await settle();
};
/** The toasts on screen: the region also reads each one out in a hidden live region, so only the copies inside a
 *  toast (`data-toast`) are counted (TasksTab.test.jsx). */
const shown = (text) => toasts().getAllByText(text).filter((el) => el.closest("[data-toast]"));

describe("TresTab — the two locks", () => {
  it("says nothing leaves the server while the install's lock is closed, and offers no connection test", async () => {
    await mounted((a) => a.tresSettings.mockResolvedValue(UNSET));
    expect(screen.getByText(/^Bu quraşdırmada xaricə göndəriş bağlıdır: buradakı ayar nə olursa olsun, serverdən heç bir məlumat çıxmır\./)).toBeInTheDocument();
    expect(testButton()).toBeDisabled();
    expect(screen.getByText("Xaricə göndəriş bağlı ikən bağlantı yoxlanıla bilməz.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Rejim/).value).toBe("off");
    expect(screen.getByLabelText(/^Mühit/).value).toBe("test");
    expect(screen.getByLabelText(/^Evə yazılmadan sonra gözləmə/).value).toBe("24");
    for (const name of ["Xəstə", "Həkim", "Xəstəxanaya yatış", "Diaqnoz", "Prosedur", "Vital göstəricilər",
      "Laboratoriya nəticələri", "Evə yazılma epikrizi"]) {
      expect(screen.getByRole("checkbox", { name })).toBeChecked();
    }
  });

  it("says the lock is open when it is, and then offers the test", async () => {
    await mounted((a) => a.tresSettings.mockResolvedValue(SET));
    expect(screen.getByText("Bu quraşdırmada xaricə göndəriş açıqdır: aşağıdakı rejim və hesab qüvvədədir.")).toBeInTheDocument();
    expect(testButton()).not.toBeDisabled();
    expect(screen.getByText(/^Yoxlama qeyd olunmuş hesabla aparılır/)).toBeInTheDocument();
  });

  it("says the selected environment's account is incomplete when the feed is on without one", async () => {
    await mounted((a) => a.tresSettings.mockResolvedValue({ ...SET, environment: "live" }));
    expect(screen.getByText(/^Seçilmiş mühitin hesabı natamamdır/)).toBeInTheDocument();
  });

  it("says nothing of the account while the feed is off, or when the account is whole", async () => {
    await mounted((a) => a.tresSettings.mockResolvedValue(SET));
    expect(screen.queryByText(/^Seçilmiş mühitin hesabı natamamdır/)).toBeNull();
  });
});

describe("TresTab — the form", () => {
  it("saves a whole body and says so", async () => {
    const saved = { ...UNSET, mode: "validate", settle_hours: 48, enabled_types: ALL.filter((k) => k !== "lab"),
      test: { ...SANDBOX, organization_id: null, organization_name: null }, updated_at: "2026-11-11T08:00:00Z" };
    const { api } = await mounted((a) => {
      a.tresSettings.mockResolvedValue(UNSET);
      a.saveTresSettings.mockResolvedValue(saved);
    });
    fireEvent.change(screen.getByLabelText(/^Rejim/), { target: { value: "validate" } });
    fireEvent.change(screen.getByLabelText(/^Evə yazılmadan sonra gözləmə/), { target: { value: "48" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Laboratoriya nəticələri" }));
    fireEvent.change(sandbox().getByLabelText(/^Server ünvanı/), { target: { value: " https://ehr-sandbox.example.az " } });
    fireEvent.change(sandbox().getByLabelText(/^İstifadəçi adı/), { target: { value: "sentetik" } });
    fireEvent.change(sandbox().getByLabelText(/^Parol/), { target: { value: "gizli-parola" } });
    fireEvent.change(sandbox().getByLabelText(/^Səhiyyə müəssisəsinin identifikatoru/), { target: { value: "PRV-0001" } });
    await save();
    expect(api.saveTresSettings).toHaveBeenCalledWith({
      mode: "validate", environment: "test", settle_hours: 48, enabled_types: ALL.filter((k) => k !== "lab"),
      test: { ...NO_ACCOUNT, base_url: "https://ehr-sandbox.example.az", username: "sentetik", provider_id: "PRV-0001",
        password: "gizli-parola" },
      live: NO_ACCOUNT,
    });
    expect(shown("TRƏS ayarları yadda saxlanıldı.")).toHaveLength(1);
    // the form now stands on the answer: the password field is empty again and says one is stored
    expect(sandbox().getByLabelText(/^Parol/).value).toBe("");
    expect(sandbox().getByLabelText(/^Parol/).placeholder).toBe("qeyd olunub");
    expect(screen.getByText(/^Son dəyişiklik: /)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("gizli-parola");
  });

  it("never shows a stored password, leaves it out of the body untouched, and clears it only when asked", async () => {
    const { api } = await mounted((a) => {
      a.tresSettings.mockResolvedValue(SET);
      a.saveTresSettings.mockResolvedValue(SET);
    });
    expect(sandbox().getByLabelText(/^Parol/).value).toBe("");
    expect(sandbox().getByText(/^Parol qeyd olunub\./)).toBeInTheDocument();
    expect(live().getByText("Parol daxil edilməyib.")).toBeInTheDocument();
    expect(live().queryByRole("checkbox", { name: "Qeyd olunmuş parolu sil" })).toBeNull();
    await save();
    expect("password" in api.saveTresSettings.mock.calls[0][0].test).toBe(false);
    expect("password" in api.saveTresSettings.mock.calls[0][0].live).toBe(false);
    fireEvent.click(sandbox().getByRole("checkbox", { name: "Qeyd olunmuş parolu sil" }));
    expect(sandbox().getByLabelText(/^Parol/)).toBeDisabled();
    await save();
    expect(api.saveTresSettings.mock.calls[1][0].test.password).toBe("");
  });

  it("holds a bad wait and an address that is not https before anything is sent", async () => {
    const { api } = await mounted((a) => a.tresSettings.mockResolvedValue(UNSET));
    for (const typed of ["169", "-1", "2.5", ""]) {
      fireEvent.change(screen.getByLabelText(/^Evə yazılmadan sonra gözləmə/), { target: { value: typed } });
      await save();
    }
    expect(api.saveTresSettings).not.toHaveBeenCalled();
    expect(screen.getByText("0 ilə 168 arasında tam ədəd daxil edin.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Evə yazılmadan sonra gözləmə/), { target: { value: "0" } });
    fireEvent.change(live().getByLabelText(/^Server ünvanı/), { target: { value: "http://ehr.example.az" } });
    await save();
    expect(api.saveTresSettings).not.toHaveBeenCalled();
    expect(live().getByText("Ünvan https:// ilə başlamalıdır.")).toBeInTheDocument();
    expect(sandbox().queryByText("Ünvan https:// ilə başlamalıdır.")).toBeNull();
  });

  it("says a refusal by its code, keeps what was typed and does not read again", async () => {
    const { api } = await mounted((a) => {
      a.tresSettings.mockResolvedValue(UNSET);
      a.saveTresSettings.mockRejectedValue(refusal(422, "A base URL starts with https://, names a host, carries no "
        + "credentials and is at most 200 characters.", { apiCode: "tres_base_url" }));
    });
    fireEvent.change(sandbox().getByLabelText(/^Server ünvanı/), { target: { value: "https://u:p@ehr.example.az" } });
    await save();
    expect(shown(/Server ünvanı https:\/\/ ilə başlamalı, istifadəçi adı və ya parol daşımamalı/)).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/carries no credentials/);
    expect(sandbox().getByLabelText(/^Server ünvanı/).value).toBe("https://u:p@ehr.example.az");
    expect(api.tresSettings).toHaveBeenCalledTimes(1);
  });

  it("offers no form while no read has answered, and reads again on «Yenidən cəhd et»", async () => {
    const { api } = await mounted((a) => {
      a.tresSettings.mockRejectedValueOnce(refusal(503, "Service Unavailable")).mockResolvedValueOnce(SET);
    });
    expect(screen.getByText(/^Ayarlar oxunmadı: /).closest("[role='alert']")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Yadda saxla" })).toBeNull();
    expect(screen.queryByLabelText(/^Rejim/)).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yenidən cəhd et" })); });
    await settle();
    expect(screen.getByLabelText(/^Rejim/).value).toBe("validate");
    expect(screen.queryByText(/^Ayarlar oxunmadı: /)).toBeNull();
    expect(api.tresSettings).toHaveBeenCalledTimes(2);
  });

  it("an answer that is no settings object is a failed read, never a form on defaults", async () => {
    await mounted((a) => a.tresSettings.mockResolvedValue(undefined));
    expect(screen.getByText(/^Ayarlar oxunmadı: /)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Yadda saxla" })).toBeNull();
  });
});

describe("TresTab — «Bağlantını yoxla»", () => {
  it("says the platform opened a session", async () => {
    const { api } = await mounted((a) => {
      a.tresSettings.mockResolvedValue(SET);
      a.testTres.mockResolvedValue({ ok: true, message: null });
    });
    await pressTest();
    expect(api.testTres).toHaveBeenCalledTimes(1);
    expect(shown("Bağlantı quruldu: platforma sessiya açdı.")).toHaveLength(1);
  });

  it("tells the platform's own words when it refuses, and says so when it gave none", async () => {
    await mounted((a) => {
      a.tresSettings.mockResolvedValue(SET);
      a.testTres.mockResolvedValueOnce({ ok: false, message: "Invalid credentials" })
        .mockResolvedValueOnce({ ok: false, message: null });
    });
    await pressTest();
    expect(shown("Bağlantı qurulmadı: Invalid credentials")).toHaveLength(1);
    await pressTest();
    expect(shown("Bağlantı qurulmadı: platforma izahat vermədi")).toHaveLength(1);
  });

  it("says the server's refusal by its code", async () => {
    await mounted((a) => {
      a.tresSettings.mockResolvedValue(SET);
      a.testTres.mockRejectedValue(refusal(409, "The selected environment's account is incomplete: the base URL, the "
        + "username, the password and the provider id are all needed.", { apiCode: "tres_account_incomplete" }));
    });
    await pressTest();
    expect(shown(/Seçilmiş mühitin hesabı natamamdır; bağlantı yoxlanılmadı\./)).toHaveLength(1);
  });
});

describe("TresTab — the body's rules", () => {
  const account = { base_url: "", username: "", provider_id: "", organization_id: "", organization_name: "", password: "", clearPassword: false };

  it("an account's empty text is null, and its password is left out unless typed", () => {
    expect(accountBody(account)).toEqual(NO_ACCOUNT);
    expect(accountBody({ ...account, username: "  sentetik ", password: "x" })).toEqual({ ...NO_ACCOUNT, username: "sentetik", password: "x" });
    expect(accountBody({ ...account, password: "x", clearPassword: true })).toEqual({ ...NO_ACCOUNT, password: "" });
  });

  it("the types go in the package's order, whatever order they were ticked in", () => {
    const form = { mode: "send", environment: "live", settle: "0", types: ["lab", "patient"], test: account, live: account };
    expect(bodyOf(form)).toEqual({ mode: "send", environment: "live", settle_hours: 0, enabled_types: ["patient", "lab"],
      test: NO_ACCOUNT, live: NO_ACCOUNT });
  });

  it("the wait is a whole number from 0 to 168, and an address is https or empty", () => {
    const form = (settle, url = "") => ({ settle, test: { ...account, base_url: url }, live: account });
    for (const ok of ["0", "24", "168"]) expect(invalid(form(ok)).settle, ok).toBe(false);
    for (const no of ["", "169", "-1", "1.5", "24h", " 24"]) expect(invalid(form(no)).settle, no).toBe(true);
    expect(invalid(form("24", "https://ehr.example.az"))).toEqual({ settle: false, test: false, live: false });
    expect(invalid(form("24", "ehr.example.az")).test).toBe(true);
    expect(invalid(form("24", "   ")).test).toBe(false);
  });

  it("names the eight types of the engine, in its order", () => {
    expect(ALL).toEqual(["patient", "practitioner", "encounter", "condition", "procedure", "vital", "lab", "composition"]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/tmp/tres/dashboard && ./node_modules/.bin/vitest run src/live/screens/admin/TresTab.test.jsx 2>&1 | tail -6`
Expected: FAIL — `Failed to resolve import "./TresTab.jsx"`.

- [ ] **Step 3: Write the tab**

```jsx
// src/live/screens/admin/TresTab.jsx — Yönetim › TRƏS (TRƏS-01 · phase F0, spec §6, §8, D2, D3): the hospital's
// settings for the national e-health feed, and a test of the connection. `tres.manage`.
//
// TWO LOCKS, AND THE TAB SAYS WHICH IS CLOSED (D2). The hospital's own is the mode on this form («Kapalı» by
// default). The install's is `TRES_EGRESS`, which only whoever runs the server can set: while it is closed the tab
// says, above everything else, that nothing leaves the server whatever is set here — and «Bağlantıyı sına» is
// disabled, because the server would refuse it.
//
// THE PASSWORD IS WRITE-ONLY (D3). The server never sends one back, only `password_set`; the field is always empty
// when the form opens and shows «kayıtlı» as its placeholder when one is stored. Left empty it is left OUT of the
// body, and the server keeps what it has; «Kayıtlı parolayı sil» sends an empty string, which clears it.
//
// A FORM NEVER STANDS ON DEFAULTS IT DID NOT READ (ProtocolTab's rule): while no read has answered, the tab shows
// the refusal and a retry, not the form. A refused save keeps what was typed — an account is six fields.
//
// «Bağlantıyı sına» uses the STORED account of the selected environment, not what is on screen; the note under the
// buttons says so. The platform's own words for a refused sign-in are shown as it wrote them.
import React, { useCallback, useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { readErrorText } from "../../apiErrors.js";
import { dayStamp } from "../../i18n/dates.js";
import { Alert, Box, Button, Field, Input, Note, Select, useToast } from "../../ui/index.js";
import { refusedFor } from "./refusal.js";

/** The eight record types, in the package's order (the engine's `tres/models.py` RESOURCE_TYPES), with their labels. */
export const TYPES = Object.freeze([
  ["patient", "tres.type.patient"], ["practitioner", "tres.type.practitioner"], ["encounter", "tres.type.encounter"],
  ["condition", "tres.type.condition"], ["procedure", "tres.type.procedure"], ["vital", "tres.type.vital"],
  ["lab", "tres.type.lab"], ["composition", "tres.type.composition"],
]);
export const MODES = Object.freeze([["off", "tres.modeOff"], ["validate", "tres.modeValidate"], ["send", "tres.modeSend"]]);
/** [environment, its name in the select, its account's heading]. */
export const ENVIRONMENTS = Object.freeze([
  ["test", "tres.envTest", "tres.accountTest"], ["live", "tres.envLive", "tres.accountLive"],
]);
const TEXT_FIELDS = Object.freeze(["base_url", "username", "provider_id", "organization_id", "organization_name"]);
const SETTLE = /^\d{1,3}$/;

const accountForm = (a) => ({
  ...Object.fromEntries(TEXT_FIELDS.map((name) => [name, a?.[name] ?? ""])), password: "", clearPassword: false,
});
const formOf = (s) => ({
  mode: s?.mode ?? "off", environment: s?.environment ?? "test", settle: String(s?.settle_hours ?? 24),
  types: Array.isArray(s?.enabled_types) ? [...s.enabled_types] : TYPES.map(([key]) => key),
  test: accountForm(s?.test), live: accountForm(s?.live),
});

/** One account as the server takes it: empty text is null; the password is left out unless typed, "" to clear. */
export function accountBody(account) {
  const body = Object.fromEntries(TEXT_FIELDS.map((name) => [name, account[name].trim() === "" ? null : account[name].trim()]));
  if (account.clearPassword) body.password = "";
  else if (account.password !== "") body.password = account.password;
  return body;
}

export function bodyOf(form) {
  return {
    mode: form.mode, environment: form.environment, settle_hours: Number(form.settle),
    enabled_types: TYPES.map(([key]) => key).filter((key) => form.types.includes(key)),
    test: accountBody(form.test), live: accountBody(form.live),
  };
}

/** What the form holds that the server would refuse: the wait, and each account's address. */
export function invalid(form) {
  const badUrl = (account) => account.base_url.trim() !== "" && !account.base_url.trim().startsWith("https://");
  const settle = !SETTLE.test(form.settle) || Number(form.settle) > 168;
  return { settle, test: badUrl(form.test), live: badUrl(form.live) };
}

/** Is the stored account of the selected environment whole? (What the server needs to open a session.) */
const accountWhole = (account) => Boolean(account?.base_url && account?.username && account?.password_set && account?.provider_id);

function AccountFields({ title, account, stored, error, onChange }) {
  const { t } = useI18n();
  const set = (patch) => onChange({ ...account, ...patch });
  return (
    <fieldset className="mb-3 rounded-ctl border border-line px-3 pb-1 pt-2">
      <legend className="px-1 font-text text-13.5 font-semibold text-mute">{title}</legend>
      <Field label={t("tres.baseUrl")} hint={t("tres.baseUrlHint")} error={error ? t("tres.invalid.baseUrl") : undefined}>
        <Input value={account.base_url} maxLength={200} inputMode="url" onChange={(e) => set({ base_url: e.target.value })} />
      </Field>
      <Field label={t("tres.username")}>
        <Input value={account.username} maxLength={120} autoComplete="off" onChange={(e) => set({ username: e.target.value })} />
      </Field>
      <Field label={t("tres.password")} hint={stored ? t("tres.passwordSet") : t("tres.passwordUnset")}>
        <Input type="password" value={account.password} maxLength={200} autoComplete="new-password"
          disabled={account.clearPassword} placeholder={stored ? t("tres.passwordStored") : undefined}
          onChange={(e) => set({ password: e.target.value })} />
      </Field>
      {stored ? (
        <label className="mb-2.5 flex items-center gap-2 font-text text-13.5">
          <input type="checkbox" checked={account.clearPassword}
            onChange={(e) => set({ clearPassword: e.target.checked, password: "" })} />
          {t("tres.passwordClear")}
        </label>
      ) : null}
      <Field label={t("tres.providerId")}>
        <Input value={account.provider_id} maxLength={64} onChange={(e) => set({ provider_id: e.target.value })} />
      </Field>
      <Field label={t("tres.organizationId")}>
        <Input value={account.organization_id} maxLength={64} onChange={(e) => set({ organization_id: e.target.value })} />
      </Field>
      <Field label={t("tres.organizationName")}>
        <Input value={account.organization_name} maxLength={200} onChange={(e) => set({ organization_name: e.target.value })} />
      </Field>
    </fieldset>
  );
}

export function TresTab() {
  const { t } = useI18n();
  const { store } = useSession();
  const toast = useToast();
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(() => formOf(null));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const read = useCallback(async () => {
    try {
      const got = await store.track(() => store.api.tresSettings());
      if (!got || typeof got !== "object") throw new Error("no settings in the answer");
      setSettings(got);
      setForm(formOf(got));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [store]);
  useEffect(() => { read(); }, [read]);

  const bad = invalid(form);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const toggle = (key, on) => set({ types: on ? [...form.types, key] : form.types.filter((k) => k !== key) });

  async function retry() {
    setBusy(true);
    try {
      await read();
    } finally {
      setBusy(false);
    }
  }

  async function save(event) {
    event.preventDefault();
    if (busy) return;
    if (bad.settle || bad.test || bad.live) {
      setTried(true);
      return;
    }
    setBusy(true);
    try {
      const got = await store.track(() => store.api.saveTresSettings(bodyOf(form)));
      setSettings(got);
      setForm(formOf(got));
      setTried(false);
      toast(t("tres.saved"));
    } catch (err) {
      toast(refusedFor(t, t("tres.tab"), err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    if (testing) return;
    setTesting(true);
    try {
      const got = await store.track(() => store.api.testTres());
      if (got?.ok === true) toast(t("tres.testOk"));
      else {
        const said = typeof got?.message === "string" && got.message.trim() ? got.message.trim() : t("tres.testNoWords");
        toast(t("tres.testFailed", { reason: said }), "error");
      }
    } catch (err) {
      toast(refusedFor(t, t("tres.test"), err), "error");
    } finally {
      setTesting(false);
    }
  }

  if (settings === null && error === null) {
    return <Box><p className="m-0 text-13 text-mute">{t("tres.loading")}</p></Box>;
  }
  if (settings === null) {
    return (
      <div className="grid max-w-[760px] gap-3">
        <Alert tone="crit">
          <p className="m-0">{t("tres.readFailed", { reason: readErrorText(t, error) })}</p>
          <Button size="sm" busy={busy} onClick={retry}>{t("admin.retry")}</Button>
        </Alert>
      </div>
    );
  }
  const open = settings.egress === true;
  const incomplete = settings.mode !== "off" && !accountWhole(settings[settings.environment]);
  return (
    <div className="grid max-w-[760px] gap-3">
      {open
        ? <Note tone="info" icon="globe">{t("tres.egressOn")}</Note>
        : <Note tone="warn" icon="lock">{t("tres.egressOff")}</Note>}
      <Box title={t("tres.title")} icon="globe" level={2}>
        <p className="m-0 mb-3 text-13 text-mute">{t("tres.sub")}</p>
        <form noValidate autoComplete="off" onSubmit={save}>
          <Field label={t("tres.mode")} hint={t("tres.modeHint")}>
            <Select value={form.mode} onChange={(e) => set({ mode: e.target.value })}>
              {MODES.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
            </Select>
          </Field>
          <Field label={t("tres.environment")}>
            <Select value={form.environment} onChange={(e) => set({ environment: e.target.value })}>
              {ENVIRONMENTS.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
            </Select>
          </Field>
          {incomplete ? <Note tone="warn" icon="alert" className="mb-3">{t("tres.incomplete")}</Note> : null}
          <Field label={t("tres.settleHours")} hint={t("tres.settleHint")}
            error={tried && bad.settle ? t("tres.invalid.settle") : undefined}>
            <Input value={form.settle} inputMode="numeric" maxLength={3} onChange={(e) => set({ settle: e.target.value })} />
          </Field>
          <fieldset className="mb-3 border-0 p-0">
            <legend className="mb-1 font-text text-13.5 font-semibold text-mute">{t("tres.types")}</legend>
            {TYPES.map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 py-0.5 font-text text-13.5">
                <input type="checkbox" checked={form.types.includes(key)} onChange={(e) => toggle(key, e.target.checked)} />
                <span>{t(label)}</span>
              </label>
            ))}
          </fieldset>
          {ENVIRONMENTS.map(([env, , heading]) => (
            <AccountFields key={env} title={t(heading)} account={form[env]} stored={settings[env]?.password_set === true}
              error={tried && bad[env]} onChange={(next) => set({ [env]: next })} />
          ))}
          {settings.updated_at ? (
            <p className="m-0 mb-2 text-12 text-mute">
              {t("tres.updated", { time: dayStamp(Date.parse(settings.updated_at), Date.now()) })}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" busy={busy}>{t("tres.save")}</Button>
            <Button icon="plug" busy={testing} disabled={!open} onClick={testConnection}>{t("tres.test")}</Button>
          </div>
          <p className="m-0 mt-2 text-12 text-mute">{open ? t("tres.testHint") : t("tres.testEgressOff")}</p>
        </form>
      </Box>
    </div>
  );
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `cd /c/tmp/tres/dashboard && ./node_modules/.bin/vitest run src/live/screens/admin/TresTab.test.jsx 2>&1 | tail -5`
Expected: `Tests  17 passed (17)`. (At this point `src/reachable.test.js` fails — `live/screens/admin/TresTab.jsx` is a module the page cannot reach. The next steps wire it in; do not commit before Step 9.)

- [ ] **Step 5: Write the registration's failing tests**

In `dashboard/src/live/screens/admin/AdminScreen.test.jsx` replace
```js
import { TasksTab } from "./TasksTab.jsx"; // G3-02
```
with
```js
import { TasksTab } from "./TasksTab.jsx"; // G3-02
import { TresTab } from "./TresTab.jsx"; // TRƏS-01
```
replace
```js
      ["tasks", "structure.manage"], // G3-02
    ]);
```
with
```js
      ["tasks", "structure.manage"], // G3-02
      ["tres", "tres.manage"], // TRƏS-01
    ]);
```
and replace
```js
    expect(await tabScreenOf(openTabs(["structure.manage"])[2]).preload()).toBe(TasksTab);
    expect(openTabs(["users.manage", "groups.manage"]).map((x) => x.id)).not.toContain("tasks");
  });
```
with
```js
    expect(await tabScreenOf(openTabs(["structure.manage"])[2]).preload()).toBe(TasksTab);
    expect(openTabs(["users.manage", "groups.manage"]).map((x) => x.id)).not.toContain("tasks");
  });

  // TRƏS-01 — TRƏS is built, and `tres.manage` alone opens it (spec D23): no other right does.
  it("offers the TRƏS tab to tres.manage, and to no other right", async () => {
    expect(openTabs(["tres.manage"]).map((x) => x.id)).toEqual(["tres"]);
    expect(await tabScreenOf(openTabs(["tres.manage"])[0]).preload()).toBe(TresTab);
    expect(openTabs(["users.manage", "groups.manage", "structure.manage"]).map((x) => x.id)).not.toContain("tres");
  });

  // TRƏS-01 (spec §8): the route opens for `tres.manage` alone too. Such a session sees one tab, and none of the
  // administration's four reads is made for it — a refused read would otherwise stand above a tab that needs none.
  it("a session holding tres.manage alone opens on the TRƏS tab, and no other read is made", async () => {
    const { api } = await open({ perms: ["tres.manage"], tabs: { tres: () => <p>the feed's tab</p> } });
    expect(screen.getAllByRole("tab").map((x) => x.textContent)).toEqual(["TRƏS (e-Səhiyyə)"]);
    expect(screen.getByText("the feed's tab")).toBeInTheDocument();
    for (const read of [api.adminUsers, api.adminGroups, api.adminPermissions, api.unassignedScopes]) {
      expect(read).not.toHaveBeenCalled();
    }
    expect(document.querySelector("[role='alert'][data-tone='crit']")).toBeNull();     // no failed read above the tab
  });
```
Append at the end of `dashboard/src/live/shell/routes.test.js`:
```js
// TRƏS-01 (spec §8, D23): the administration screen also opens for `tres.manage` alone — Yönetim › TRƏS is then its
// one tab (screens/admin/AdminScreen.jsx gates each tab by its own right).
describe("the administration route and the national feed's key", () => {
  afterEach(() => resetScreens());
  const admin = () => ROUTES.find((r) => r.id === "admin");

  it("opens for users.manage, groups.manage or tres.manage, and for no other right", () => {
    expect(admin().perms).toEqual(["users.manage", "groups.manage", "tres.manage"]);
    expect(canReach(admin(), ["tres.manage"])).toBe(true);
    expect(canReach(admin(), ["structure.manage"])).toBe(false);
    expect(canReach(admin(), NURSE)).toBe(false);
  });

  it("is a tres.manage session's one work screen and its home", () => {
    expect(hasWorkRoute(["tres.manage"])).toBe(true);
    expect(navRoutes(["tres.manage"]).main.map((r) => r.id)).toEqual(["admin"]);
    expect(homePath(["tres.manage"])).toBe("/admin");
  });
});
```
In `dashboard/src/live/rawKeys.test.jsx` replace
```js
const PROTOCOL_SETTINGS = { configured: false, next_no: null, last_issued: null, label_width_mm: 50,
  label_height_mm: 30, printer_dpi: 203, updated_at: null };
```
with
```js
const PROTOCOL_SETTINGS = { configured: false, next_no: null, last_issued: null, label_width_mm: 50,
  label_height_mm: 30, printer_dpi: 203, updated_at: null };

/** TRƏS-01: GET /admin/tres/settings — the feed in «validate» with the install's lock closed and half a sandbox
 *  account, so the sweep meets the closed-lock note, the incomplete-account note and the stored-password words. */
const TRES_SETTINGS_SWEEP = { mode: "validate", environment: "test", settle_hours: 24,
  enabled_types: ["patient", "practitioner", "encounter", "condition", "procedure", "vital", "lab", "composition"],
  test: { base_url: "https://ehr-sandbox.example.az", username: "sentetik", password_set: true, provider_id: null,
    organization_id: null, organization_name: null },
  live: { base_url: null, username: null, password_set: false, provider_id: null, organization_id: null,
    organization_name: null },
  egress: false, updated_at: "2026-10-08T09:00:00Z" };
```
replace
```js
      api.protocolSettings.mockResolvedValue(PROTOCOL_SETTINGS);
```
with
```js
      api.protocolSettings.mockResolvedValue(PROTOCOL_SETTINGS);

      // TRƏS-01: Yönetim › TRƏS reads its settings — unstubbed the tab would say only that they could not be read.
      api.tresSettings.mockResolvedValue(TRES_SETTINGS_SWEEP);
```
and replace
```js
    expect(screen.getByText(/^Barkod sığır: /)).toBeInTheDocument();                       // protokol.fits
    expect(rawKeys(document.body)).toEqual([]);
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
    act(() => { mounted.board.clear(); });
  });
```
with
```js
    expect(screen.getByText(/^Barkod sığır: /)).toBeInTheDocument();                       // protokol.fits
    expect(rawKeys(document.body)).toEqual([]);
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
    act(() => { mounted.board.clear(); });
  });

  // TRƏS-01 — the same anchor for Yönetim › TRƏS: the closed-lock note, the incomplete-account note and the
  // stored-password words are drawn only for this fixture's answer.
  it("the TRƏS keys resolve on its tab", async () => {
    const mounted = await openAt("/admin");
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "TRƏS (e-Səhiyyə)" })); await settle(); });
    expect(screen.getByText(/^Bu quraşdırmada xaricə göndəriş bağlıdır/)).toBeInTheDocument();   // tres.egressOff
    expect(screen.getByText(/^Seçilmiş mühitin hesabı natamamdır/)).toBeInTheDocument();          // tres.incomplete
    expect(screen.getByText(/^Parol qeyd olunub\./)).toBeInTheDocument();                         // tres.passwordSet
    expect(screen.getByText(/^Son dəyişiklik: /)).toBeInTheDocument();                            // tres.updated
    expect(rawKeys(document.body)).toEqual([]);
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
    act(() => { mounted.board.clear(); });
  });
```

- [ ] **Step 6: Run them to see them fail**

Run: `cd /c/tmp/tres/dashboard && ./node_modules/.bin/vitest run src/live/screens/admin/AdminScreen.test.jsx src/live/shell/routes.test.js src/live/rawKeys.test.jsx 2>&1 | grep -E "×|Test Files|Tests " | head -12`
Expected: FAIL — the `TABS` pin and the two new tab tests, the two new route tests, and the sweep's «the TRƏS keys resolve on its tab» (no such tab).

- [ ] **Step 7: The tab's three seam lines, and the screen's two comments**

In `dashboard/src/live/screens/admin/AdminScreen.jsx` replace
```js
//   Protocol, label  G2-B1d  `structure.manage`                  /admin/protocol-settings
```
with
```js
//   Protocol, label  G2-B1d  `structure.manage`                  /admin/protocol-settings
//   TRƏS             TRƏS-01 `tres.manage`                       /admin/tres/*
```
replace
```js
// EVERY TAB IS GATED SEPARATELY, and the gate is the session's own rights. The route opens to
// `users.manage` OR `groups.manage` (routes.js), so a session can arrive holding one and not the
// other: the tabs it may not open are not shown, and the screen opens on the first it may. A
```
with
```js
// EVERY TAB IS GATED SEPARATELY, and the gate is the session's own rights. The route opens to
// `users.manage`, `groups.manage` OR `tres.manage` (routes.js), so a session can arrive holding one and
// not the others: the tabs it may not open are not shown, and the screen opens on the first it may. A
```
replace
```js
const TasksTab = lazyScreen(() => import("./TasksTab.jsx"), "TasksTab"); // G3-02
```
with
```js
const TasksTab = lazyScreen(() => import("./TasksTab.jsx"), "TasksTab"); // G3-02

const TresTab = lazyScreen(() => import("./TresTab.jsx"), "TresTab"); // TRƏS-01
```
replace
```js
  Object.freeze({ id: "tasks", perm: "structure.manage", labelKey: "gorevler.settingsTab" }),
```
with
```js
  Object.freeze({ id: "tasks", perm: "structure.manage", labelKey: "gorevler.settingsTab" }),

  // TRƏS-01 — Yönetim › TRƏS: the national e-health feed's settings and its connection test (spec D23)
  Object.freeze({ id: "tres", perm: "tres.manage", labelKey: "tres.tab" }),
```
and replace
```js
  tasks: TasksTab, // G3-02
```
with
```js
  tasks: TasksTab, // G3-02

  tres: TresTab, // TRƏS-01
```

- [ ] **Step 8: Open the route**

In `dashboard/src/live/shell/routes.js` replace
```js
  route({ id: "admin", path: "/admin", icon: "shield", labelKey: "nav.admin", shortKey: "nav.adminShort",
    perms: ["users.manage", "groups.manage"], work: true, nav: "main" }),
```
with
```js
  // TRƏS-01 (spec §8): + `tres.manage` — a session that holds it alone opens the screen on its one tab, Yönetim › TRƏS.
  route({ id: "admin", path: "/admin", icon: "shield", labelKey: "nav.admin", shortKey: "nav.adminShort",
    perms: ["users.manage", "groups.manage", "tres.manage"], work: true, nav: "main" }),
```

- [ ] **Step 9: Run the tab's, the registration's and the structural tests**

Run: `cd /c/tmp/tres/dashboard && ./node_modules/.bin/vitest run src/live/screens/admin src/live/shell src/live/rawKeys.test.jsx src/reachable.test.js src/live/boundaries.test.js src/routing.test.js 2>&1 | tail -6`
Expected: all files pass, no `failed` — the tab is reached from the page now, it imports nothing from outside `src/live/`, and no screen of the build prints a key.

- [ ] **Step 10: Commit**

```bash
cd /c/tmp/tres && git add dashboard/src/live/screens/admin/TresTab.jsx dashboard/src/live/screens/admin/TresTab.test.jsx dashboard/src/live/screens/admin/AdminScreen.jsx dashboard/src/live/screens/admin/AdminScreen.test.jsx dashboard/src/live/shell/routes.js dashboard/src/live/shell/routes.test.js dashboard/src/live/rawKeys.test.jsx && git commit -m "feat(tres-01): Yönetim › TRƏS — the two locks said out loud, the mode, the two accounts with a write-only password, the eight types, «Bağlantıyı sına»; /admin opens for tres.manage (spec §8, D2, D3, D23)" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 14: Dashboard gates, and the codes held to the engine

With both halves in one tree, the dashboard's map of refusal codes can be held to the engine's own list — the cross-check Task 12 could not carry (the halves may be built apart).

**Files:**
- Modify: `dashboard/src/live/apiErrors.test.js` (a new `describe` at the end; it uses the file's own `py` and `pyConstants`, defined near its top)

- [ ] **Step 1: Write the cross-check**

Append at the end of `dashboard/src/live/apiErrors.test.js`:
```js
// TRƏS-01 (the gate of phase F0, when both halves are in one tree): the map is the engine's own list — its
// tres/errors.py, read as text like every other engine source here. A code added there fails here until it is mapped.
describe("the national feed's refusal codes are the engine's (TRƏS-01)", () => {
  it("the map holds every code tres/errors.py names, and nothing else", () => {
    const codes = [...pyConstants(py("tres/errors.py")).values()];
    expect(codes.length).toBeGreaterThanOrEqual(8);
    expect([...TRES_CODE_KEYS.keys()].sort()).toEqual([...codes].sort());
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd /c/tmp/tres/dashboard && ./node_modules/.bin/vitest run src/live/apiErrors.test.js 2>&1 | tail -5`
Expected: PASS (the map and `homunculus-engine/src/homunculus/tres/errors.py` name the same eight codes). If it fails, the two lists differ: fix the MAP (and its text in `strings/tres.js`, four languages) to follow the engine.

- [ ] **Step 3: The whole dashboard suite**

Run: `cd /c/tmp/tres/dashboard && ./node_modules/.bin/vitest run 2>&1 | tail -6`
Expected: no `failed`; against Task 0's baseline **+1 test file and +27 tests** (the tab 17, the client 2, the refusals 3, the admin screen 2, the routes 2, the sweep 1).

- [ ] **Step 4: The build**

Run: `cd /c/tmp/tres/dashboard && ./node_modules/.bin/vite build 2>&1 | grep -E "precache|larger than|rror|TresTab"`
Expected: the tab is its own chunk (`assets/TresTab-*.js`, ≈7 kB); `precache  68 entries` (67 before this slice); no `error`.

**The 500 kB line — expected, measured, and NOT fixed here.** Vite's note `Some chunks are larger than 500 kB after minification` is expected to appear after this slice. It is about ONE chunk, the shared one that holds the i18n catalogue (named `Toast-*.js` by the bundler): measured on a scratch copy, **489 174 characters on main `331df704`, 501 634 with this slice** (Vite counts characters, not bytes; the file is ≈581 kB → ≈596 kB on disk). F0's strings add ≈12.5 k characters and main had ≈10.8 k of room: the next strings of ANY lane would have crossed the line. Check that it is that chunk and no other:
Run: `cd /c/tmp/tres/dashboard && ls -S dist/assets/*.js | head -2`
Expected: `Toast-*.js` first, `LiveApp-*.js` second (≈155 kB). If any OTHER chunk is over 500 kB, that is a regression of this slice: STOP and tell the controller. The catalogue's own split (per language, or per namespace) is a slice of its own and the controller's decision — write the two measured numbers into Task 15's record and say so in Task 16's hand-over. `dist/` is git-ignored.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/tres && git add dashboard/src/live/apiErrors.test.js && git commit -m "test(tres-01): the dashboard's refusal codes are the engine's — tres/errors.py read as text" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---


### Task 15: Docs — the spec's amendments, the guide's §3.25, the gates' record

**Files:**
- Modify: `docs/superpowers/specs/2026-11-11-tres-esaglik-gonderim-design.md` (a new last section, §13, after §12's last line `- O12 Radiology, pathology, ImagingStudy — with H6.`)
- Modify: `docs/homunculus-rehber-TR.md` (a new section §3.25 after §3.24, before the `---` line above `## 4. "Neden bunu kullanmıyoruz" köşesi`, ~line 2400)
- Modify: `docs/superpowers/plans/2026-11-11-tres-f0-altyapi.md` (this plan: a «Gates» block under the header)

All three files are CRLF on disk (`core.autocrlf=true`); edit them with the Edit tool and leave the line endings as they are.

- [ ] **Step 1: The spec's §13**

Append to the end of `docs/superpowers/specs/2026-11-11-tres-esaglik-gonderim-design.md` (a blank line after O12's line, then):
```markdown
## 13. Amendments (plan F0)

Made by `docs/superpowers/plans/2026-11-11-tres-f0-altyapi.md` (phase F0: infrastructure). Where a line above and a
line here disagree, this section is right.

- **§10 — one plan per phase.** F0…F6 are seven plan documents, each with its own gate; «one plan» is withdrawn.
- **D23 — the 29th key.** `pharmacy.view` (G3-04) reached main first; `tres.manage` is appended after it.
- **D26 — migration 0020.** `0019_pharmacy_view.py` is on main; this slice's file is `0020_tres.py`
  (`down_revision = "0019"`). G4-03 (`feat/g4-kalite`) also claims 0020: whoever reaches main second renames.
  F0 creates `tres_settings` and `tres_deliveries`; F1–F5 add the other seven tables to the same file while the branch
  is unmerged.
- **D26, §9 — no permission row.** `tres.manage` is in no default group and the system group holds every key by
  rule at token issuance, so the migration writes no `group_permissions` row (as `summary.view`); its test asserts so.
- **D2, §7 — where the switch is read.** `TRES_EGRESS` is read once in `create_app` (`tres/egress.py` →
  `app.state.tres_egress`), as the wave feed reads its settings; `api/prodserver.py` is not touched.
- **§6 — refusal codes.** They live in `tres/errors.py`. Besides `egress_off`: `tres_mode`, `tres_environment`,
  `tres_settle_hours`, `tres_types`, `tres_base_url`, `tres_field_length` (all 422) and `tres_account_incomplete`
  (409: the selected environment's account lacks the base URL, the username, the password or the provider id).
  `tres_off` and `summary_signed` come with the phases that need them.
- **§6 — the connection test** is allowed in the mode `off` and writes no audit row.
- **D24 — `tres.settings`** carries `{"actor", "changed": [<field names>]}` — names such as `mode`,
  `test.password`, never a value. A save that changes nothing writes no row. The event's label on «Denetim
  bütünlüğü» was added with the route (the dashboard holds its label list to the engine's event types).
- **D21, §7 — the worker's seam.** A `PackageSource` yields packages — async callables handed a `Sender`
  (`send`, `skip`) — not resources: a package reads each ledger row's `remote_id` before it builds what refers to
  it (D8). The 300 ms spacing is a hook on the client the worker sets, so it holds between any two requests.
  After a 429 the whole loop waits `Retry-After` (never less than a round), not the one tenant.
- **D6, D7, D21 — the ledger.** A failed payload's digest is stored; an unchanged failed payload waits 30 minutes,
  an unchanged `stuck` one waits for `force`; a changed payload is tried at once and its count starts again. In
  `validate` mode an unchanged payload already `validated` or `sent` is not validated again. `last_error` is cut to
  500 characters and 1000 UTF-8 bytes (its ciphertext must fit 1536). A 429 and a failure with no answer count as
  an attempt like any other refusal — whether they should is open (O13).
- **§4 — the client.** A failure with no answer is an error with no status, named by its class; `$validate`
  answering 2xx with an `error` or `fatal` issue is a refusal. Both are this module's reading, to be re-checked in F6.
- **§8 — `/admin` for `tres.manage`.** The key is added to the route's `perms`; `/admin` being a work screen, a
  session that holds `tres.manage` alone can sign in and lands there.
- **§9 — the stand-in** enforces §4 only; each profile's required elements (§5) join it with that profile's mapper.
- **§11 — the guide's section is §3.25.**
- **§8 — the build.** With F0's strings the shared i18n chunk passes Vite's 500 kB note (489 174 → 501 634
  characters, measured). Splitting the catalogue is not this slice's; it is the controller's decision.

New open items:
- O13 Should a 429 or a dead line count towards `stuck` (five in a row)? Today they do; an outage of five rounds
  would park the resources that happened to be first in each round until the nightly retry.
- O14 `mode = validate` over a whole stay: nothing is stored, so a resource that refers to another (an Encounter to
  its Patient) has no platform id to refer to. What the platform's `$validate` does with such a reference is not
  known; the stand-in refuses it. F1 decides what a validate round sends, F6 checks it on the sandbox.
```

- [ ] **Step 2: The guide's §3.25**

In `docs/homunculus-rehber-TR.md` replace
```markdown
  `docs/superpowers/plans/2026-11-11-g4-yonetici-ozeti.md`.

---

## 4. "Neden bunu kullanmıyoruz" köşesi
```
with
```markdown
  `docs/superpowers/plans/2026-11-11-g4-yonetici-ozeti.md`.

### 3.25 «TRƏS»: ulusal e-sağlık gönderimi (HBYS · TRƏS-01, aşama F0)

- **Ne:** Azerbaycan'da bir hastane bilgi sistemi klinik kayıtlarını bakanlığın e-sağlık platformuna (sahibin
  deyişiyle TRƏS; bir FHIR sunucusu) bildirir. Bu dilim Homunculus'a o gönderimi ekliyor. **Aşama F0 yalnız
  altyapıdır:** ayarlar, gönderim defteri, platformun istemcisi, turların iskeleti, yeni yetki ve Yönetim › TRƏS
  sekmesi. Hasta, yatış, tanı gibi kayıtları FHIR'e çeviren kısım (F1–F6) henüz yok; bu yüzden F0'dan sonra da
  **hiçbir yere hiçbir şey gönderilmez.**
- **Durum:** dalda (`feat/tres-esaglik`); main'e ve hastane sunucusuna sahibin sözüyle gelir. Göç 0020 iki tablo
  ekler (`tres_settings`, `tres_deliveries`).
- **İki kilit (varsayılan: ikisi de kapalı):**
  1. **Kurulumun kilidi** — ortam değişkeni `TRES_EGRESS`. `on` değilse sunucu platforma hiç bağlanmaz: tur
     görevi başlatılmaz, bağlantı sınaması reddedilir (`egress_off`), sekme en üstte «Bu kurulumda dışarıya gönderim
     kapalı» der. Değiştirmek yeniden başlatma ister. «Hasta verisi binadan çıkmaz» sözü bu kilit kapalıyken
     geçerlidir.
  2. **Hastanenin kilidi** — sekmedeki **kip**: «Kapalı» (varsayılan), «Yalnız doğrula» (platform denetler, kayıt
     yazmaz), «Gönder».
- **Kim görür:** yeni yetki `tres.manage` olan. Varsayılan gruplardan hiçbirinde yok; Sistem Yöneticisi her yetkiyi
  kural gereği taşır (göç satır yazmaz). Yönetim ekranı artık bu yetkiyle de açılır; yalnız bu yetkiyi taşıyan bir
  hesap oturum açabilir ve tek sekme olarak «TRƏS»i görür.
- **Sekmede ne var:** kip; ortam (sınama / canlı); taburcudan sonra bekleme süresi (0–168 saat, varsayılan 24);
  gönderilecek sekiz kayıt türü; her ortam için bir hesap (sunucu adresi yalnız `https://`, kullanıcı adı, parola,
  sağlık kuruluşu kimliği, kurum kimliği ve adı); «Kaydet» ve «Bağlantıyı sına».
- **Parola:** veritabanında şifreli durur (hasta verisinin anahtarıyla) ve hiçbir yanıtta geri gelmez; sekme yalnız
  «kayıtlı» der. Alan boş bırakılırsa kayıtlı parola aynı kalır; «Kayıtlı parolayı sil» onu siler.
- **«Bağlantıyı sına»:** kayıtlı hesapla platformda tek bir oturum açmayı dener; «Bağlantı kuruldu» ya da platformun
  kendi sözleriyle neden kurulamadığını söyler. Kurulumun kilidi kapalıyken düğme etkin değildir.
- **Denetim:** ayar değişikliği «TRƏS ayarları değişti» olayıdır; hangi alanların değiştiğini yazar, değerleri
  (özellikle parolayı) yazmaz.
- **Gönderim defteri:** her kaynak için bir satır — durum, platformdaki kimlik, yükün anahtarlı özeti, deneme
  sayısı, platformun son mesajı (şifreli). İstek ya da yanıt gövdesi saklanmaz. Aynı yük ikinci kez gönderilmez.
- **Bilinen sınır:** bu aşamadaki dört dil metni yerel bir okurun gözünden geçmedi; platformla ilgili her bilgi
  ikinci eldir ve F6'da sınama ortamında doğrulanacak.
- **Kaynak:** `docs/superpowers/specs/2026-11-11-tres-esaglik-gonderim-design.md`; plan
  `docs/superpowers/plans/2026-11-11-tres-f0-altyapi.md`.

---

## 4. "Neden bunu kullanmıyoruz" köşesi
```

- [ ] **Step 3: The gates' record in this plan**

In `docs/superpowers/plans/2026-11-11-tres-f0-altyapi.md`, directly under the line `**Spec amendments this plan makes (recorded in Task 15):**`'s list (before the `---` above «Ground rules»), add a block with the numbers you wrote down — every `…` below replaced by a measured value, none left:
```markdown
**Gates (measured when the plan was carried out):** baseline engine … passed / … skipped, dashboard … files / … tests · after F0 engine … passed / … skipped (no-DB), Postgres 49 + 58 + neighbours … passed · dashboard … files / … tests · build `precache  … entries`, shared i18n chunk … characters (500 kB note: yes/no) · head `<sha>`.
```

- [ ] **Step 4: Commit and push**

```bash
cd /c/tmp/tres && git add docs/superpowers/specs/2026-11-11-tres-esaglik-gonderim-design.md docs/homunculus-rehber-TR.md docs/superpowers/plans/2026-11-11-tres-f0-altyapi.md && git commit -m "docs(tres-01): F0 — the spec's amendments (§13), the guide's §3.25, the gates' record" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>" && git push origin feat/tres-esaglik
```
Expected: the push succeeds (the owner allows pushing `feat/…` branches). **Nothing goes to `main` and nothing to the hospital VM from this plan**: «main'e al» and «onay» are the owner's words.

---

### Task 16: Final review and hand-over

- [ ] **Step 1: The final code review.** Dispatch the reviewer (superpowers:requesting-code-review) over `git diff 9a1c3ab8..HEAD -- homunculus-engine dashboard deploy` with the spec and this plan. Ask it for four things by name: (1) no code path connects to the platform while `app.state.tres_egress` is false; (2) no response, audit payload or log line carries a password, a session id or a resource body; (3) every `/admin/tres/*` route is `tres.manage` and the caller's tenant only; (4) nothing was copied from the reference repository of spec §2. Each fix is its own commit, with both suites green again.
- [ ] **Step 2: What the owner can look at on the local stack** (the stack's own commands are in `docs/EDGE-BRIDGE-LOCAL.md`; synthetic accounts only, and **never a real account or a ministry host in this phase**): with `TRES_EGRESS` unset — Yönetim › TRƏS says outbound sending is closed and «Bağlantıyı sına» is disabled; a saved change appears on «Denetim bütünlüğü» as «TRƏS ayarları değişti» with the changed fields' names and no value; the password field is empty after a reload and says «kayıtlı». With `TRES_EGRESS=on` and no account — the tab says the lock is open, and the test answers that the account is incomplete. Write what was seen (date, image shas) into the plan's Gates block, or `walk: not done` and why.
- [ ] **Step 3: Hand over to the controller**, in one message: the head sha; the gate numbers; that migration 0020 may need renumbering at merge (G4-03); the build's 500 kB note and its two measured numbers (a decision is needed: split the i18n catalogue, or accept the note); the open items O13 and O14; and that F1's plan is the next document. Nothing is merged and nothing is deployed by this plan.

---

## Spec coverage — F0's share

| Spec | Where in this plan | Left to a later phase |
|---|---|---|
| D2 two locks | Task 2 (`TRES_EGRESS`, `app.state.tres_egress`), Task 8 (no round, no loop, no client while closed), Task 9 (`egress` in the answer, 409 `egress_off`), Task 13 (the tab says which lock is closed) | — |
| D3 settings per tenant, password encrypted and write-only | Task 5 (the row), Task 6 (the table), Task 9 (the routes), Task 13 (the form) | the per-type switches are stored and edited here, honoured by F1's source |
| D4 one resource per request | Task 3 (`find`, `create`, `update`), Task 7 (`_write`) | — |
| D6 the ledger, no body | Task 5, Task 6, Task 7 | the tab's «Gönderimler» panel and `GET /admin/tres/deliveries` (F1) |
| D7 change detection by digest | Task 7 (`payload_digest`, the unchanged-payload rule) | — |
| D21 rounds, limits, failures | Task 3 (401 once, 429 raised), Task 7 (attempts, 30 minutes, `stuck`, `force`), Task 8 (5-minute loop, 300 ms, 429 and five failures end a round) | the nightly 04:00 retry of `stuck` rows and «Yeniden dene» (they call `Sender.send(force=True)`); «a skipped resource is tried again only when its data changes» is the source's rule (F1) |
| D23 `tres.manage` | Task 1 (the key and its mirrors), Task 9 (the guards), Task 13 (the tab and the route) | the clinical records' rights (F2–F5) |
| D24 `tres.settings` | Task 9 (the event, its payload, its label) | the other events, each with its phase |
| D25 PHI discipline | Task 3 (nothing logged; a dead line named by class), Task 7 (no body stored; `last_error` encrypted), Task 8 (log lines carry ids and classes) | the preview route (F1) |
| D26 one migration | Task 6 (two tables; the file grows with F1–F5) | seven tables |
| D27 `strings/tres.js` | Task 12 | `tani.js`, `islem.js`, `epikriz.js` |
| §4 the contract | Task 3 (client), Task 4 (stand-in) | F6 re-checks every line on the sandbox |
| §6 first two bullets | Task 9 | every other route |
| §7 deploy variables | Task 2 (compose, `.env.example`) | `nginx.conf` gains `terminology` in F2 |
| §9 the stand-in | Task 4 | the required elements of §5, per profile |

## Notes for F1 (found while this plan was written)

- **N1 — where a round gets its data.** The worker runs on `AsyncSessionLocal` (the ORM world), but hand-entered vitals and labs are `chart` rows of the app's AUDIT LOG (`app.state.audit`, a synchronous store: `api/audit.py` `iter_records_of(log, tenant=<slug>, event_types=…, patient_id=<board key>)`), keyed by the tenant's SLUG and the admission's board key (`admission/boardkey.board_key(protocol_no, patient_number)`), with the signal code as `subject`. F1's source therefore has to be built inside `create_app`, where `audit` is in scope, and put on `app.state.tres_source` (the lifespan reads it when the loop starts); its audit reads go through `asyncio.to_thread`.
- **N2 — one stay, several admissions.** A stay's Encounter is keyed by the ROOT admission (`Admission.source_admission_id` chain), but `chart` rows are keyed by each admission's own board key. Whether a transfer keeps the protocol number (B1b, not on main when this was written) decides whether «first and last of the stay» is one read or one read per admission: check before the vitals mapper is written.
- **N3 — a person is not a row.** `patients` holds one row per admission; the FİN is `Patient.national_id`, an `EncryptedString` (not searchable). D5's Patient id (`phi_digest(FİN)`) is computed from the decrypted value of the stay's own row.
- **N4 — validate mode and references (O14).** In `validate` nothing is stored, so `Sender.send` answers a row with no `remote_id`; a package cannot build `Patient/<id>` for the Encounter. Decide in F1 what a validate round sends after the Patient.
- **N5 — audit events land with their label.** Every new `trail.record(…, "tres.<x>", …)` needs its line in `dashboard/src/live/screens/denetim/denetim.js` (and four strings, and the count in `denetim.test.js`) IN THE SAME COMMIT: `engineTypes.test.js` holds the list to the engine both ways. The source sweep's exemption (Task 12) already covers any code that table names.
- **N6 — the stand-in's `REQUIRED`.** `tests/fake_tres.py` checks only §4. Each mapper adds its profile's required elements there, with a test in `tests/test_fake_tres.py`.
- **N7 — `stuck` and outages (O13).** A 429 or a dead line counts as an attempt. If F1's rounds meet real throttling, revisit before live.
- **N8 — one wait for all tenants.** After a 429 the loop waits for every tenant, not only the throttled one. Fine for one hospital per install; per-tenant waits are a small change in `tres_loop` if an install ever hosts two.
- **N9 — the build's 500 kB note** (Task 14). Every panel F1 adds brings strings; the catalogue's split should be decided before F1's dashboard half.
- **N10 — texts.** The `az`, `ru` and `en` strings of `strings/tres.js` and `perms.js` are the planner's; they await a native reading before a hospital opens the feed.
- **N11 — local ids that are nobody's prefix** (from the F0 review). The platform's `local-system-unique-id` search matches by prefix, so `hmn-l-1` finds `hmn-l-10`…`hmn-l-1999`. `find` no longer trusts such an answer: an incomplete one is refused and counted, never answered by a POST. F1 should still shape D5's ids so that no id is a proper prefix of another, for example by ending every numeric part with a delimiter (`hmn-l-12-`). That keeps search answers to a single entry. Decide it before the first mapper, because a local id never changes once sent.
- **N12 — «Şimdi gönder» and the row lock** (from the F0 review). A delivery holds its ledger row under `FOR UPDATE` across several HTTP calls: a few minutes at worst, since the 60 s bound is per call. The F1 route that sends one stay on demand must not queue behind a round. Take the row with `NOWAIT` (or `SET LOCAL lock_timeout`) and answer «busy, try again» rather than hang the request.
- **N14 — the nightly retry ships before live** (from the second review). Since a 500 counts against its resource, a platform-wide 500 lasting two hours or more walks the whole due backlog to `stuck`. The reviewer's measurement, 40 stays due: 30 rows at their first attempt within 25 minutes, 30 `stuck` at +145 min. Only `force` (the nightly 04:00 retry, «Yeniden dene») takes a row out of `stuck`, and `force=True` has no caller yet. F1 builds both before any tenant's mode can be `send` on a live host.
- **N15 — parking: a stale login and the operator's signal** (from the second review).
  - The race: `_park`'s UPDATE has no condition, so a login that left with the old password and comes back 401 after the administrator saved the new one parks the tenant again. Make it `WHERE updated_at = <the round's version>`.
  - The signal: a parked tenant shows only on the tab and in one log line. F1's «Gönderimler» panel should show it at the top.
- **N16 — search answers to check on the sandbox (F6).**
  - An entry with `search.mode: outcome` (an OperationOutcome among the matches) carries no local id, so `find` refuses the answer. A server that always adds one would leave every new resource of that type unsendable. If the platform does this, `find` should skip `outcome` entries.
  - A `link` that is a dict rather than a list is ignored today.
- **N17 — small nits.**
  - `client.py`: an exact hit with no server `id` reports «a search entry carries no local id».
  - A `keep_held` skip still updates the row's `admission_id`.
- **N13 — migration number.** Main took `0020_quality_view.py` (G4-03, `b2fb07d0`) while F0 was built. At merge, `0020_tres.py` takes the next free number, and every «0020» in the module's docstrings and in spec §13 follows it. G3-05 (`feat/g3-cihaz-olcum-kaydi`) claims 0021, so check main's head at that moment.

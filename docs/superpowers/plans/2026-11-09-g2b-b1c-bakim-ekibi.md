# Group 2 · B1c — Bakım ekibi (care team) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Refreshed 2026-11-10 for base `ea61714a` (origin/main).** The plan was written against `6302ccd8` (G2-B3a's head, migration head `0016`). Main has since gained G2-B5 (RRT), G3-02 «Görevlerim» (migration `0017_tasks`), G3-03 «Sıvı dengesi» (the FluidsBox on the patient screen), G2-B3b «Vardiya devri» (the handover routes in `admission/router.py`) and the screens' lazy loading. What this refresh changed: `0017` is on main, so the worktree holds no untracked copy and no test waits for it (X1, Task 0 Step 4); B3a's two baseline failures are fixed on main, so the no-DB suite starts green; the pins (`EXPECTED` 72 → 73 → 74, the pinned `CODES` 30 → 33, the charge nurse's set with G3-02's `tasks.*`, Denetim's `EVENT_TYPES` 37 → 40); the text anchors that B3b and G3 moved (`_board_summary` before the sign-off, the schemas and models imports, `catalog.js`, `INVALID_FIELD_KEYS`); the guide section is §3.19; departures X11–X13. Nothing on the new base changes what a B1c step means: G3-02's tasks and B3b's handovers read neither the care team nor `attending_physician_id`, and no new permission overlaps `care_team.*`. The spec's §0 is dated `c3965ed5` and is left as it is; of its facts only F11 has moved: B3b's `GET /handovers/colleagues` now lists the tenant's `handover.sign` holders, nurses included, to a `handover.sign` holder. That is not the picker (physicians only, the team left out, `care_team.assign`), so Task 7's candidates route stands.

**Goal:** The record of who is responsible for a patient is written, shown and kept correct. A «Bakım ekibi» box on the patient screen shows the attending, the associates and the on-call physicians, and lets an authorised user add and remove them. The physician who signs the admission becomes its attending. Each member sees her patient on the board, even outside her units.

**Architecture:**
- **Server (`homunculus-engine`).**
  - Migration `0018_care_team_transfer` (after G3-02's `0017`) puts the care-team rows right, replaces the old constraint with two partial unique indexes, takes `care_team.claim` from the charge nurses, and adds B1b's two transfer columns (D9).
  - One service function, `set_attending`, makes an attending at sign-off, by a claim and by an add (T4). A physician is a member of a physician role group (T1).
  - The routes `claim`, `add` and `GET` are rewritten; `end` and `candidates` are new. Every write checks reach, takes `_locked`, checks the admission's state and is audited after its commit (T2).
- **Dashboard.**
  - `screens/patient/careTeam/`: the pure rules (`careTeam.js`), the add dialog, and the box on the patient screen.
  - A new string namespace `ekip`, in four languages.

**Tech Stack:** FastAPI, SQLAlchemy 2 (async), Alembic, Postgres 16, pytest. React 18, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-09-g2b-b1c-bakim-ekibi-design.md` (branch `docs/g2b-b1b-b1c` @ `81a8f98b`; its line numbers are dated `c3965ed5`, as it says), with the owner's decisions D1–D9 of 2026-11-09. The owner approved the design on 2026-11-09 and asked for the work. **Read §0, §2, §3 and §5 of the spec before Task 1.** The companion spec `2026-11-09-g2b-b1b-nakil-design.md` §5.9 gives B1b's part of migration `0018`.

---

## Departures: what the code says that the spec did not (read before Task 1)

| # | Departure | Why |
|---|---|---|
| X1 | **The code branch is cut from `docs/g2b-b1b-b1c`, which is `origin/main` @ `ea61714a` with only documents on top** (the two specs, B1b's plan and this plan). `0018` has `down_revision = "0017"`, and `0017` is a real file on main: G3-02's `0017_tasks.py` (commit `a4253b43`). | The spec said "cut from main"; the documents branch is main plus the documents, so the code travels with its specs and plans. Refreshed 2026-11-10: the plan was written at `6302ccd8`, when `0017` lived on `feat/g3-gorevlerim` only and the worktree held an untracked copy of it. B3a (`0016`) and G3-02 (`0017`) have both merged since, in the order G3-02's D18 asked. |
| X2 | **The model also declares B1b's part of `0018`:** `TransferReason`, `admissions.transfer_reason`, `admissions.transfer_note` and the CHECK `ck_admissions_transfer_reason`. No route reads or writes them before B1b. `AdmissionResponse` gains `transfer_reason` in B1b, not here. | Every migration here has a model that agrees with it (B3a's `0016`, the parity tests). B1b then "finds its part done" (D9). |
| X3 | **`0018` also rewrites the charge nurse's group description**, and only where it is still the default text. The downgrade puts it back. | D7 says «bakım ekibi» leaves the group's description, but the seeded description lives in the database (`groups.description`). Spec step 7 named only the permission rows. A description a hospital wrote itself is left alone. |
| X4 | **The renewal (T8) applies to any role.** A physician whose only active row is an EXPIRED on-call row has it ended and gets the new row, whatever its role. The picker therefore leaves out exactly the physicians whose active row is not expired: in force, or a window still to come. | The picker offers an expired on-call physician (she holds "no row in force"). Read literally, T8 would then refuse her as an associate (`care_team_conflict`) right after offering her. |
| X5 | **Two physicians claiming at once both succeed, one after the other.** The locks order them, and the second claim ends the first's row (D4). Exactly one ATTENDING stays. In §6, the 409 `care_team_conflict` "loser" is the same physician's second claim (a double press). It is also any writer that meets an index (T7); a test triggers that by blinding the look-up. | `_locked` serialises every write of one admission (T2), so two claims never reach the index together. D4 makes the later claimer the attending. |
| X6 | **The new-attending question is also asked before «Sorumlu hekim ol».** In the add dialog, the sentence stands above the submit, and the submit is the answer. | A claim ends the previous attending's row too. Spec §4 asks the question once for every new attending. |
| X7 | **A refusal goes on the toast alone.** A success is said on the toast and under the list. After either, the team is read again. | The house rule (`screens/admin/refusal.js`): one refusal, one announcement, outliving the screen. The spec's "says its result in the box" is the re-read list and the success line. |
| X8 | **The sign-off task (Task 6) comes before the routes (Tasks 7–8).** | Every route test can then start from a signed admission that already holds its attending's row (D3). |
| X9 | **The window rules are checked in the route, before reach and the locks, as 422 `field_invalid:window_start` or `field_invalid:window_end`.** The window's ends must carry an offset (`AwareDatetime`); a naive time is a 422. `CareTeamAdd` refuses unknown fields (`extra="forbid"`). | A naive time compared with the server's clock is a 500. B1a's request models refuse unknown fields the same way. |
| X10 | **`GET …/care-team`'s member exception reads `is_active`**, not "in force". An on-call member whose window has passed still reads the team she is on, until her row is ended. | The spec says "an active row". The list carries staff names only, no patient data. |
| X11 | **The «Denetim bütünlüğü» page names the three care-team events** (`care_team.attending`, `care_team.add`, `care_team.end`): `EVENT_TYPES` 37 → 40, a label in four languages each (Task 13, Step 4). Added by the 2026-11-10 refresh. | G2-B4's page (on main) names an engine event only through `screens/denetim/denetim.js` `EVENT_TYPES`; any other code shows as itself and is not offered in the «Tür» filter. B3a, B5 and B3b each added theirs. The spec (§5.5) names the events but not the page, which was not on its base. |
| X12 | **G3-02's `tests/test_tasks_postgres.py` runs with the migration tests** (Task 0 Step 7, Task 2 Step 5). Added by the 2026-11-10 refresh. | It upgrades to `head`, which is `0018` once Task 2 lands, and one of its tests downgrades through `0018` to `0016`: it is the one older test that runs `0018`'s downgrade. |
| X13 | **The patient-screen test of Task 16 answers the fluid box's read with an empty ledger** (`emptyFluids`, as `PatientScreen.test.jsx`'s `open` does). Added by the 2026-11-10 refresh. | G3-03 put `FluidsBox` on the patient screen; it reads `api.patientFluids`, which the fake leaves unanswered. Unanswered, the box shows its read failure beside the care team; the test asserts nothing about it either way. |

## Open items (not this slice)

- **G3-02's copy of the physician groups.** `screens/gorevler/taskModel.js` holds the same three slugs (`PHYSICIAN_SLUGS`, not exported) for «Görevlerim»'s "my role". This slice adds `careTeam.js` `PHYSICIAN_GROUPS`, held equal to the engine's `PHYSICIAN_GROUPS` by its test; the two dashboard copies are not tied to each other. A later tidy can make one import the other.
- **B1b.** It tests that a transfer copies the rows onto the arriving admission's card key (spec §6, "After a B1b transfer").
- **Native readings** of the az, ru and en texts (O48).
- **Spec §7:** a sweep for expired on-call rows; a box for a member outside the unit; telling an open board stream about a new member.

---

## Ground rules for every task

- **Your worktree.** `/c/tmp/g2b-b1c`, branch `feat/g2b-b1c-bakim-ekibi`. Task 0 creates both from the head of `docs/g2b-b1b-b1c`. That branch is `origin/main` @ `ea61714a` with documents only on top: the two spec commits, B1b's plan and this plan (X1). B1b is built after this slice, on its head (B1b's plan, Task 0).
  - **Never touch `/c/Users/User/Desktop/Project/Homunculus AI`** (the user's main checkout), and never touch another `/c/tmp` worktree.
  - Never `git push`, never deploy, never change anything on a VM.
  - **Never run `git stash`.** The stash is shared with every other worktree and session.
- **Migration `0017` is G3-02's, on main** (`homunculus-engine/alembic/versions/0017_tasks.py`, commit `a4253b43`). This slice never edits it; its `0018` follows it (X1). If main gains a migration after `ea61714a`, `0018`'s `down_revision` must follow the new head: stop and report (Task 0, Step 4).
- **Several implementers may share this worktree.** Stage and commit explicit paths only. Use `git add -- <paths>`, then `git commit -m … -m … -- <paths>`.
  - Before every commit, run `git status --short` and `git diff --cached --stat`.
  - If a staged path is not one the task lists, stop and ask.
- **The knowledge graph.** `graphify-out/` does not exist in these worktrees (checked 2026-11-09, and again on the documents branch at `ea61714a` on 2026-11-10). If it appears, the project rule applies: run `graphify query "<question>"` before the first grep or source read, and put that rule in every subagent prompt that explores code.
- **Write and Edit tools only, on repo files.** Never use `sed`, `python`, `node` or a shell heredoc to change one. There is one exception:
  - line ends. A NEW file is written with the Write tool, then converted to **CRLF** by this one-line call, which touches only that file:
    ```bash
    /c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" <file>
    ```
  - Why: the tree checks out CRLF (`core.autocrlf=true`). Every block in this plan is LF, and the Edit tool matches either way.
  - Each task ends by counting the line ends of the files it touched. CR must equal LF:
    ```bash
    for f in <files>; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
    ```
- **TDD.** Write the test, run it, and **see it red for the reason the task names**. Then write the code, then see it green. Put the red in the commit body.
- **Commit after every task that changes the repo.**
  - The message is `type(scope): what, in words (G2-B1c, Dn/Tn/Xn)`.
  - The body says what changed, why, and the red that was seen. It ends with:
    ```
    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
    ```
- **Python commands.** Always run from the engine directory, with `PYTHONPATH=src`, naming the files:
  ```bash
  cd /c/tmp/g2b-b1c/homunculus-engine
  PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q <files> 2>&1 | tail -3
  ```
  - **Postgres tests** (every file marked `requires_db`) take `TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test` **on the command line only**, prefixed to the command above. The database is the container `homunculus-test-pg-56` (Task 0 starts it).
  - **Never set or export `DATABASE_URL`**, and never export `TEST_DATABASE_URL`.
  - The whole no-DB suite: `... -m pytest -p no:cacheprovider -q -p no:warnings tests --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -3`.
  - **Never run `tests/test_infinity_vm_pilot.py`** (it hangs).
- **Postgres tests are slow: about 5 seconds a test.**
  - Run ONE file per Bash call, with `timeout: 600000`.
  - `tests/test_tenant_isolation.py` and `tests/test_admission_api.py` each take more than 10 minutes, longer than one foreground call. Run each with `run_in_background: true`, and wait for its notification. Do not poll it. Do not start another Postgres file while it runs.
  - If the harness backgrounds any other call, wait for its notification the same way.
  - One Postgres run at a time on the container: `clean_db` and `db_session` rebuild the schema, and the container is shared with other lanes. If another session is running a suite on it, wait.
  - Everything else (the no-DB suite, vitest, the build) runs in the foreground. Report before waiting on anything.
- **Async tests: read ids into locals first.** `db_session.expire_all()` expires every object of the session, including `w.users[...]`. Reading `w.users["doctor"].id` after it raises `MissingGreenlet`. Read every id you need into a local at the top of the test. Prefer `execution_options(populate_existing=True)` on a query to `expire_all()`; this plan's helpers do.
- **The synthetic ward** is `tests/kabul_world.py`. Its users are `admin` (hospital_admin), `nurse`, `nurse_b` (Neonatal), `charge` (charge_nurse), `doctor` (attending, Reanimasiya) and `auditor`. This slice needs more physicians. A test adds them with `add_physician` (Task 5, `tests/test_care_team_service.py`). It takes the tenant's groups from `ensure_default_groups` (which returns the existing groups by slug), makes the user with `tests/signed_in.py` `add_user` in the group given, grants the unit given, and signs her in. Her `full_name` is her user name's local part (`add_user`).
- **No new permission in this slice.** D7 changes only the `charge_nurse` default group. The catalogue, `screens/admin/catalogue.js`, `admin.testutil.js` and `perms.js` stay as they are. The route-permission table gains two routes (Tasks 7, 8).
- **`unitscope.reach_clause` returns None for an unrestricted caller.** Never pass it straight to `.where()`. This slice does not need it; `_reach_admission` and `unitscope.reaches` are enough.
- **Dashboard commands** run from `/c/tmp/g2b-b1c/dashboard`:
  - one file or a few: `./node_modules/.bin/vitest run <paths>`;
  - the whole suite: `./node_modules/.bin/vitest run`;
  - the build, as a separate command: `./node_modules/.bin/vite build`.

  Use the local binaries: `npx` has resolved a cached tool in these trees before. A `Warning: … not wrapped in act(...)` line is not a failure.
- **`Toast.jsx` renders each toast twice.** A test that looks for a toast's text uses `toasts().getAllByText(…).length > 0`, never `getByText`.
- **No patient data, ever** (CLAUDE.md rule 6). Patients: `Sentetik Hasta`. Staff in the engine tests: the ward's synthetic accounts and those `add_physician` adds (`doctor2`, `nobetci`, `uzak`…). Staff in the dashboard tests: `Sentetik Həkim`, `Sentetik Köməkçi`, `Sentetik Növbətçi`, and the session's own `Ayşe Sentetik`. Every value is made up.
- **Four languages for every key.** `tr` is the source; `az` is the default and the tests' language.
  - An `az` text equal to its `tr` text, or an `ru` text with no Cyrillic, fails `i18n/strings.test.js`.
  - If it does, change the wording; do not list it.
- **Comments explain why**, in the register of the file. New lines are tagged `G2-B1c` with the spec item (`D1`…`D9`, `T1`…`T8`, `F1`…`F11`, `§n`) or the departure (`X1`…`X13`).
- **Report back:**
  - DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED;
  - the commit sha;
  - the test counts;
  - any deviation.

---

## File map

**Engine (`homunculus-engine/`)**

| File | Change | Task |
|---|---|---|
| `src/homunculus/admission/models.py` | the two partial unique indexes (the constraint goes); `TransferReason`, `transfer_reason`, `transfer_note`, their CHECK (X2) | 1 |
| `alembic/versions/0018_care_team_transfer.py` | new: steps 1–8 of spec §5.1, the description (X3), the downgrade | 2 |
| `src/homunculus/auth/permissions.py` | `charge_nurse` loses `care_team.claim` and «bakım ekibi» (D7) | 3 |
| `src/homunculus/admission/errors.py` | `CARE_TEAM_CONFLICT`, `CARE_TEAM_NOT_PHYSICIAN`, `CARE_TEAM_ATTENDING_REQUIRED` | 4 |
| `src/homunculus/admission/service.py` | `PHYSICIAN_GROUPS`, `physician_ids`, `is_physician`, `active_rows`, `in_force`, `expired`, `end_care_team_member`, `set_attending` (5); `claim_attending` goes (8) | 5, 8 |
| `src/homunculus/admission/router.py` | sign-off (6); `_member_out`, `GET`, `candidates` (7); claim, add, end (8) | 6, 7, 8 |
| `src/homunculus/admission/schemas.py` | `CareTeamAdd` (forbid, aware), `CareTeamMemberResponse` (names, `in_force`, `closed_at`), `CareTeamCandidate` | 7 |
| `../deploy/local/web/nginx.conf` | the log map names the two new routes | 7, 8 |
| `tests/test_care_team_model.py` | new (no DB) | 1 |
| `tests/test_migration_0018_care_team_transfer.py` | new (DB, `clean_db`) | 2 |
| `tests/test_permissions.py` | the charge nurse's set; who claims and assigns | 3 |
| `tests/test_admission_form.py` | the pinned `CODES` | 4 |
| `tests/test_care_team_rules.py` | new (no DB) | 5 |
| `tests/test_care_team_service.py` | new (DB); `add_physician`, `physician_elsewhere`, `active_admission` | 5 |
| `tests/test_care_team_sign_off.py` | new (DB) | 6 |
| `tests/test_discharge_api.py` | the sign-off's audit payload | 6 |
| `tests/test_tenant_isolation.py` | `Side.doctor` (6); candidates (7); `Side.team_row`, the controls, end (8) | 6, 7, 8 |
| `tests/test_care_team_reads.py` | new (DB) | 7 |
| `tests/test_route_permissions.py` | 72 → 73 → 74 | 7, 8 |
| `tests/test_care_team_api.py` | new (DB) (8); the discharge (9) | 8, 9 |
| `tests/test_admission_workflow.py` | `claim_attending` → `set_attending` | 8 |
| `tests/test_care_team_scope.py` | new (DB) | 10 |

**Dashboard (`dashboard/src/`)**

| File | Change | Task |
|---|---|---|
| `backendApi.js`, `backendApi.test.js` | `careTeam`, `careTeamCandidates`, `claimAttending`, `addCareTeamMember`, `endCareTeamMember` | 12 |
| `live/session/testTokens.testutil.js` | the five in `fakeApi` | 12 |
| `live/i18n/strings/ekip.js` | new namespace, four languages | 13 |
| `live/i18n/catalog.js` | registers `ekip` | 13 |
| `live/apiErrors.js`, `live/apiErrors.test.js` | the three codes, the two window fields, 30 → 33 | 13 |
| `live/screens/denetim/denetim.js`, `denetim.test.js`, `live/i18n/strings/denetim.js` | the three `care_team.*` events named on «Denetim bütünlüğü», 37 → 40 (X11) | 13 |
| `live/screens/patient/careTeam/careTeam.js`, `careTeam.test.js` | new: the box's rules (pure) | 14 |
| `live/screens/patient/careTeam/AddMemberDialog.jsx`, `AddMemberDialog.test.jsx` | new: «Ekibe ekle» | 15 |
| `live/screens/patient/careTeam/CareTeamBox.jsx`, `CareTeamBox.test.jsx` | new: the box | 16 |
| `live/screens/patient/PatientScreen.jsx` | mounts the box | 16 |

**Docs:** the roadmap's Grup 2 table, and the Turkish guide's section 3.19 (Task 17).

---

### Task 0: The worktree, the shared install, the migration head, the test database and the baseline

**Files:** none.

- [ ] **Step 1: The documents branch sits on `ea61714a`, and main has not moved**

```bash
cd /c/tmp/g2b-b1bc && git log --oneline -1 origin/main; echo ---; git merge-base --is-ancestor ea61714a docs/g2b-b1b-b1c && echo "on ea61714a"; git log --oneline ea61714a..docs/g2b-b1b-b1c; echo ---; git diff --stat ea61714a docs/g2b-b1b-b1c | tail -1; git diff --name-only ea61714a docs/g2b-b1b-b1c | grep -v '^docs/'
```

Expected:
- above the first `---`: `ea61714a fix(shell): review — preload from LiveApp in every phase, …` (main as last fetched);
- between the two: `on ea61714a`, then documents only — the two spec commits (`2114bd09`, `81a8f98b`), B1b's plan (`e3a4b59f`), this plan's commits (`6b97abfb`, `dacb0df9`, `6407e1a2` and the 2026-11-10 refresh), and any later documents commit;
- below the second: the stat line, and no path outside `docs/`.

If `origin/main` names another commit, main has moved since this refresh. **Stop and report.** The controller rebases `docs/g2b-b1b-b1c` onto the new main (no code exists yet, so nothing conflicts) and reads this plan's pins again against it: the route table's size (Tasks 7, 8), the pinned `CODES` (Task 4), the charge nurse's default set (Task 3), Denetim's `EVENT_TYPES` (Task 13), the migration head (Step 4) and the guide's last section (Task 17). Then start again at Step 1.

- [ ] **Step 2: The worktree and the branch**

```bash
cd /c/tmp/g2b-b1bc && git worktree add -b feat/g2b-b1c-bakim-ekibi /c/tmp/g2b-b1c docs/g2b-b1b-b1c
cd /c/tmp/g2b-b1c && git status --short && git rev-parse --abbrev-ref HEAD && git log --oneline -4
```

Expected:
- `Preparing worktree (new branch 'feat/g2b-b1c-bakim-ekibi')`;
- no status output;
- the branch `feat/g2b-b1c-bakim-ekibi`;
- on top, the head of `docs/g2b-b1b-b1c` that Step 1 listed. Write its sha into the report.

- [ ] **Step 3: The `node_modules` junction to the shared install**

```powershell
if (-not (Test-Path C:\tmp\g2b-b1c\dashboard\node_modules)) { New-Item -ItemType Junction -Path C:\tmp\g2b-b1c\dashboard\node_modules -Target C:\tmp\homunculus-g1\dashboard\node_modules | Out-Null }
Get-Item C:\tmp\g2b-b1c\dashboard\node_modules | Select-Object LinkType, Target | Format-List
```

Expected: `LinkType : Junction`, `Target : {C:\tmp\homunculus-g1\dashboard\node_modules}`.

**This is the shared install:**
- never delete through it, and never reinstall into it;
- before this worktree is removed, unlink it first: `cmd /c rmdir "C:\tmp\g2b-b1c\dashboard\node_modules"` removes the link only;
- only then run `git worktree remove`.

- [ ] **Step 4: The migration head is G3-02's `0017`, on main**

```bash
cd /c/tmp/g2b-b1c && git log -1 --format='%h %s' -- homunculus-engine/alembic/versions/0017_tasks.py && grep -n '^revision\|^down_revision' homunculus-engine/alembic/versions/0017_tasks.py && cd homunculus-engine && PYTHONPATH=src /c/tmp/f7-py312/venv/Scripts/python.exe -c "from alembic.config import Config; from alembic.script import ScriptDirectory; print(ScriptDirectory.from_config(Config('alembic.ini')).get_heads())"
```

Expected:
- `a4253b43 feat(tasks): migration 0017 (tasks, task_settings, permission rows) and the Postgres task store; …`;
- `revision: str = "0017"` and `down_revision: Union[str, None] = "0016"`;
- `['0017']`.

`0017` is purely additive: it creates `tasks` and `task_settings` and grants `tasks.view` and `tasks.manage` to the six working default groups that exist when it runs. It touches neither the care team nor `admissions`. If the head is anything but `['0017']`, **stop and report**: `0018`'s `down_revision` (Task 2) must name the new head.

- [ ] **Step 5: The test database**

```bash
docker start homunculus-test-pg-56 >/dev/null && docker exec homunculus-test-pg-56 pg_isready -U homunculus
```

Expected: `… accepting connections`.

- [ ] **Step 6: The engine baseline (no DB)**

```bash
cd /c/tmp/g2b-b1c/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -5
```

Expected: everything passes, the DB tests are skipped, and nothing fails. (At `c3965ed5`, where the spec was written, two B3a tests failed; B3a fixed both before it merged: `87fe086d` put `bed_reserved` in the pinned set, `6c157630` put the bed routes in the log map.)

Record the counts (passed, skipped) in the report: every later "Task 0's count" is this one. Any failure: stop and report.

- [ ] **Step 7: The Postgres baseline of the files this slice touches, one file per call**

Run this command once for each file below, each as its own Bash call with `timeout: 600000`:

```bash
cd /c/tmp/g2b-b1c/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings <FILE> 2>&1 | tail -3
```

The files:
1. `tests/test_discharge_api.py`
2. `tests/test_route_permissions.py`
3. `tests/test_admission_workflow.py`
4. `tests/test_protocol_board_key.py`
5. `tests/test_unit_scope.py`
6. `tests/test_scope_access_reader.py`
7. `tests/test_migration_0016_bed_occupancy.py` (it runs the chain to `head`, `0017` today)
8. `tests/test_tasks_postgres.py` (G3-02's `0017`: it runs the chain to `head` and back down to `0016`; X12)
9. `tests/test_migration_0010_schema_parity.py`
10. `tests/test_tenant_isolation.py`, with `run_in_background: true`. Wait for its notification.

Expected: every file all passed, none skipped. Write the counts into the report. A failure here is the base's, not this slice's: stop and report it.

- [ ] **Step 8: The dashboard baseline and the build**

```bash
cd /c/tmp/g2b-b1c/dashboard && ./node_modules/.bin/vitest run 2>&1 | tail -5
cd /c/tmp/g2b-b1c/dashboard && ./node_modules/.bin/vite build 2>&1 | tail -6
```

Expected:
- the suite: every file and test passed. Record the counts (files, tests) in the report.
- the build: a `precache  N entries` line and no `larger than 500 kB`. Record N in the report. Since the lazy loading (`live/shell/routes.js`, `lazyScreen.js`) each screen is its own chunk; this slice's box and dialog join the patient screen's chunk, so N should not move.

---

### Task 1: The care team's indexes and B1b's two columns, in the model (spec T6, F2, D9; X2)

**Files:**
- Modify: `homunculus-engine/src/homunculus/admission/models.py`
- Create: `homunculus-engine/tests/test_care_team_model.py`

- [ ] **Step 1: Write the failing test**

Create `homunculus-engine/tests/test_care_team_model.py`:

```python
# homunculus-engine/tests/test_care_team_model.py
"""The care team's rows and the transfer's two columns as the models declare them (G2-B1c, spec
T6, F2, §5.1, D9; G2-B1b spec D8, §5.9). No database.
- One ACTIVE row per member and admission, and one active ATTENDING per admission: two PARTIAL
  unique indexes, mirrored for SQLite (scripts/dev_local.py, E10). The old constraint, which held
  `is_active` in its key and so allowed one CLOSED row per member, is gone (F2).
- B1b's `transfer_reason` (text, one of six or NULL) and `transfer_note` (encrypted, as wide as
  every encrypted column) are declared, and no route writes them before B1b (X2)."""
from __future__ import annotations

from sqlalchemy import Index, UniqueConstraint

from homunculus.admission.models import (
    CARE_TEAM_ACTIVE_INDEX, CARE_TEAM_ATTENDING_INDEX, PHI_COLUMN_LENGTH, Admission,
    CareTeamMember, TransferReason,
)


def _indexes(model) -> dict[str, Index]:
    return {index.name: index for index in model.__table__.indexes}


def test_one_active_row_per_member_and_admission_is_a_partial_unique_index():
    index = _indexes(CareTeamMember)[CARE_TEAM_ACTIVE_INDEX]
    assert index.unique and [c.name for c in index.columns] == ["admission_id", "user_id"]
    for dialect in ("postgresql", "sqlite"):
        assert str(index.dialect_options[dialect]["where"]) == "is_active"


def test_one_active_attending_per_admission_is_a_partial_unique_index():
    index = _indexes(CareTeamMember)[CARE_TEAM_ATTENDING_INDEX]
    assert index.unique and [c.name for c in index.columns] == ["admission_id"]
    for dialect in ("postgresql", "sqlite"):
        assert str(index.dialect_options[dialect]["where"]) == "is_active AND role = 'ATTENDING'"


def test_the_old_constraint_that_allowed_one_closed_row_per_member_is_gone():
    assert [c for c in CareTeamMember.__table__.constraints if isinstance(c, UniqueConstraint)] == []


def test_the_six_transfer_reasons_are_b1bs():
    assert [r.value for r in TransferReason] == [
        "CLINICAL_NEED", "TO_ICU", "ICU_TO_WARD", "ISOLATION", "PATIENT_OR_FAMILY_REQUEST", "OTHER"]


def test_the_transfer_columns_are_declared_and_the_note_is_encrypted():
    table = Admission.__table__
    assert table.c.transfer_reason.nullable and table.c.transfer_reason.type.length == 32
    note = table.c.transfer_note
    assert note.nullable and type(note.type).__name__ == "EncryptedString"
    assert note.type.impl.length == PHI_COLUMN_LENGTH
    checks = {c.name: str(c.sqltext) for c in table.constraints
              if c.name == "ck_admissions_transfer_reason"}
    assert checks == {"ck_admissions_transfer_reason":
                      "transfer_reason IS NULL OR transfer_reason IN ('CLINICAL_NEED', 'TO_ICU', "
                      "'ICU_TO_WARD', 'ISOLATION', 'PATIENT_OR_FAMILY_REQUEST', 'OTHER')"}
```

- [ ] **Step 2: Run it and see it red**

```bash
cd /c/tmp/g2b-b1c/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_care_team_model.py 2>&1 | tail -3
```

Expected: a collection error, `ImportError: cannot import name 'CARE_TEAM_ACTIVE_INDEX'`.

- [ ] **Step 3: The model**

In `homunculus-engine/src/homunculus/admission/models.py`:

1. Replace

```python
class CareTeamRole(str, enum.Enum):
    """§4.2–4.3 — care-team clinician roles scoped to an admission."""
    ATTENDING = "ATTENDING"
    ASSOCIATE_PHYSICIAN = "ASSOCIATE_PHYSICIAN"
    ONCALL_PHYSICIAN = "ONCALL_PHYSICIAN"
```

with

```python
class CareTeamRole(str, enum.Enum):
    """§4.2–4.3 — care-team clinician roles scoped to an admission."""
    ATTENDING = "ATTENDING"
    ASSOCIATE_PHYSICIAN = "ASSOCIATE_PHYSICIAN"
    ONCALL_PHYSICIAN = "ONCALL_PHYSICIAN"


class TransferReason(str, enum.Enum):
    """G2-B1b (its spec D4, D8): why a patient moved to another bed. Stored as text on the
    arriving admission and checked by `ck_admissions_transfer_reason`: a seventh reason is a
    migration. The columns come with migration 0018, which B1c writes whole (D9); no route writes
    them before B1b (G2-B1c, X2)."""
    CLINICAL_NEED = "CLINICAL_NEED"
    TO_ICU = "TO_ICU"
    ICU_TO_WARD = "ICU_TO_WARD"
    ISOLATION = "ISOLATION"
    PATIENT_OR_FAMILY_REQUEST = "PATIENT_OR_FAMILY_REQUEST"
    OTHER = "OTHER"


#: G2-B1b (§5.9): the CHECK on `admissions.transfer_reason`, the same text as migration 0018's.
TRANSFER_REASON_CHECK = "transfer_reason IS NULL OR transfer_reason IN ({})".format(
    ", ".join(f"'{reason.value}'" for reason in TransferReason))
```

2. In `class Admission`, replace

```python
    protocol_no: Mapped[str | None] = mapped_column(String(12), nullable=True)
```

with

```python
    protocol_no: Mapped[str | None] = mapped_column(String(12), nullable=True)
    # G2-B1b (its spec D8, §5.9), written into migration 0018 by B1c (D9, X2): the move that made
    # this row — its reason (`TransferReason`, CHECKed) and its note, encrypted at rest because a
    # note may name a person (≤ 200 characters of plaintext; the column holds the ciphertext). NULL
    # on every row a transfer did not write. No route writes them before B1b.
    transfer_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)
    transfer_note: Mapped[str | None] = mapped_column(EncryptedString(PHI_COLUMN_LENGTH),
                                                      nullable=True)
```

3. In `Admission.__table_args__`, replace

```python
        CheckConstraint(PROTOCOL_FORMAT_CHECK,
                        name="ck_admissions_protocol_no").ddl_if(dialect="postgresql"),
    )
```

with

```python
        CheckConstraint(PROTOCOL_FORMAT_CHECK,
                        name="ck_admissions_protocol_no").ddl_if(dialect="postgresql"),
        # G2-B1b (§5.9): plain SQL, so SQLite builds it too.
        CheckConstraint(TRANSFER_REASON_CHECK, name="ck_admissions_transfer_reason"),
    )
```

4. Replace

```python
# ---------------------------------------------------------------------------
# Care team (Dimension A — §3.1, §4.2–4.3)
# ---------------------------------------------------------------------------
class CareTeamMember(Base):
```

with

```python
# ---------------------------------------------------------------------------
# Care team (Dimension A — §3.1, §4.2–4.3)
# ---------------------------------------------------------------------------
#: G2-B1c (spec T6, T7): the care team's two partial unique indexes (migration 0018). The routes
#: tell an IntegrityError at either apart by its name: a coded 409 `care_team_conflict`, never a 500.
CARE_TEAM_ACTIVE_INDEX = "uq_care_team_active_member"
CARE_TEAM_ATTENDING_INDEX = "uq_care_team_one_attending"
_CARE_TEAM_ACTIVE = text("is_active")
_CARE_TEAM_ATTENDING = text("is_active AND role = 'ATTENDING'")


class CareTeamMember(Base):
```

5. In `class CareTeamMember`, replace

```python
    __table_args__ = (
        # A user holds at most one active care-team row per admission.
        UniqueConstraint("admission_id", "user_id", "is_active",
                         name="uq_care_team_active_member"),
    )
```

with

```python
    __table_args__ = (
        # G2-B1c (spec T6, F2): PARTIAL unique indexes, the same as migration 0018's. A member
        # holds at most one ACTIVE row per admission, and any number of closed ones: the old
        # constraint keyed `is_active` too, so ending a member twice broke it. An admission has one
        # active ATTENDING (D2). `sqlite_where` as well: scripts/dev_local.py builds these models
        # on SQLite (E10).
        Index(CARE_TEAM_ACTIVE_INDEX, "admission_id", "user_id", unique=True,
              postgresql_where=_CARE_TEAM_ACTIVE, sqlite_where=_CARE_TEAM_ACTIVE),
        Index(CARE_TEAM_ATTENDING_INDEX, "admission_id", unique=True,
              postgresql_where=_CARE_TEAM_ATTENDING, sqlite_where=_CARE_TEAM_ATTENDING),
    )
```

`Index`, `CheckConstraint`, `String`, `text` and `EncryptedString` are imported already. `UniqueConstraint` stays: `Patient` and `Admission` use it.

- [ ] **Step 4: Run it and see it green**

Same command as Step 2. Expected: `5 passed`.

- [ ] **Step 5: Nothing else moved**

```bash
cd /c/tmp/g2b-b1c/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -5
```

Expected: Task 0's count + 5, and no failure.

- [ ] **Step 6: Line ends, then commit**

```bash
cd /c/tmp/g2b-b1c && /c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" homunculus-engine/tests/test_care_team_model.py
for f in homunculus-engine/src/homunculus/admission/models.py homunculus-engine/tests/test_care_team_model.py; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- homunculus-engine/src/homunculus/admission/models.py homunculus-engine/tests/test_care_team_model.py
git status --short && git diff --cached --stat
git commit -m "feat(admission): one active row per member and one attending per admission, as partial unique indexes; B1b's transfer columns declared (G2-B1c, T6, F2, D9, X2)" -m "The constraint (admission_id, user_id, is_active) allowed one CLOSED row per member, so ending a member twice broke it. Two partial unique indexes take its place, mirrored for SQLite. TransferReason, admissions.transfer_reason (CHECKed) and admissions.transfer_note (EncryptedString) are declared so the model agrees with migration 0018. Red: ImportError CARE_TEAM_ACTIVE_INDEX." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/src/homunculus/admission/models.py homunculus-engine/tests/test_care_team_model.py
```

---

### Task 2: Migration 0018 (spec §5.1 steps 1–8, B1b §5.9, D7, D9; X3)

**Files:**
- Create: `homunculus-engine/alembic/versions/0018_care_team_transfer.py`
- Create: `homunculus-engine/tests/test_migration_0018_care_team_transfer.py`

**`0018` follows `0017`, which is on main** (G3-02's `0017_tasks.py`; Task 0, Step 4). `0017` meets nothing of `0018`: it adds two tables of its own and grants `tasks.*` only to the groups that exist when it runs. This task's tests make their groups after `upgrade(cfg, "0017")`, so `0017` grants them nothing, and a downgrade to `"0017"` never runs `0017`'s own downgrade.

- [ ] **Step 1: Write the failing test**

Create `homunculus-engine/tests/test_migration_0018_care_team_transfer.py`:

```python
# homunculus-engine/tests/test_migration_0018_care_team_transfer.py
"""Migration 0018 (G2-B1c spec §5.1 with G2-B1b spec §5.9, D9) on the real chain (`clean_db`,
never `create_all`):
- the data is put right before the indexes: the open rows of closed admissions close; of two
  active attendings the newest stays and `attending_physician_id` follows her; a signed admission
  whose attending has no row gets one (O45), and her other active row becomes it when she holds
  one; a DRAFT gets none;
- then one active row per member and admission, and one active ATTENDING per admission, hold,
  and a member ended twice keeps two closed rows (F2);
- every `charge_nurse` group loses `care_team.claim`, and no other group does (D7); the default
  description loses «bakım ekibi», and a hospital's own is kept (X3);
- B1b's two columns exist, and the CHECK refuses a seventh reason;
- the downgrade restores the old key, drops the columns, and refuses loudly over a member with two
  closed rows on one admission; 0017 → 0018 → 0017 → 0018 runs.
Synthetic rows only. The revision before is G3-02's 0017 (tasks): it grants `tasks.*` only to the
groups that exist when it runs, and every group here is made after it."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

import homunculus.admission.models  # noqa: F401  (register every table on Base.metadata)
import homunculus.auth.models  # noqa: F401
import homunculus.escalation.models  # noqa: F401
import homunculus.protocol.models  # noqa: F401
import homunculus.tenant.models  # noqa: F401
from homunculus.db import Base
from tests.conftest import requires_db

pytestmark = [requires_db]
ACTIVE, ATTENDING = "uq_care_team_active_member", "uq_care_team_one_attending"
CHECK = "ck_admissions_transfer_reason"
BEFORE = "Hasta kabul, transfer/taburcu onayı, nöbet çizelgesi, bakım ekibi."
AFTER = "Hasta kabul, transfer/taburcu onayı, nöbet çizelgesi."
REASONS = ("CLINICAL_NEED", "TO_ICU", "ICU_TO_WARD", "ISOLATION", "PATIENT_OR_FAMILY_REQUEST", "OTHER")
STATES = {"DRAFT", "ACTIVE", "PENDING_DISCHARGE", "PENDING_TRANSFER", "DISCHARGED", "TRANSFERRED"}
ROLES = {"ATTENDING", "ASSOCIATE_PHYSICIAN", "ONCALL_PHYSICIAN"}
T0 = datetime(2026, 11, 8, 20, 0, tzinfo=timezone.utc)


def _tenant(conn, slug: str) -> uuid.UUID:
    tid = uuid.uuid4()
    conn.execute(text("INSERT INTO tenants (id, name, slug, country_code) VALUES (:id, :n, :s, 'AZ')"),
                 {"id": tid, "n": f"Sentetik {slug}", "s": slug})
    return tid


def _group(conn, tenant: uuid.UUID, slug: str, *permissions: str, description: str = BEFORE) -> uuid.UUID:
    gid = uuid.uuid4()
    conn.execute(text(
        "INSERT INTO groups (id, tenant_id, slug, name, description, mfa_required, is_system, "
        "created_at, updated_at) VALUES (:id, :t, :s, :s, :d, false, false, now(), now())"),
        {"id": gid, "t": tenant, "s": slug, "d": description})
    for key in permissions:
        conn.execute(text("INSERT INTO group_permissions (group_id, permission) VALUES (:g, :p)"),
                     {"g": gid, "p": key})
    return gid


def _user(conn, name: str) -> uuid.UUID:
    uid = uuid.uuid4()
    conn.execute(text(
        "INSERT INTO users (id, username, email, full_name, hashed_password, auth_source, "
        "totp_enabled, is_active, is_platform_support) VALUES (:id, :u, :u, 'Sentetik', 'x', "
        "'local', false, true, false)"), {"id": uid, "u": f"{name}@example.com"})
    return uid


def _bed(conn, tenant: uuid.UUID) -> uuid.UUID:
    site, unit, room, bed = (uuid.uuid4() for _ in range(4))
    conn.execute(text("INSERT INTO sites (id, tenant_id, name) VALUES (:id, :t, 'Ana bina')"),
                 {"id": site, "t": tenant})
    conn.execute(text("INSERT INTO units (id, site_id, name, unit_type) "
                      "VALUES (:id, :s, 'Reanimasiya', 'ADULT_ICU')"), {"id": unit, "s": site})
    conn.execute(text("INSERT INTO rooms (id, unit_id, name) VALUES (:id, :u, 'Otaq 1')"),
                 {"id": room, "u": unit})
    conn.execute(text("INSERT INTO beds (id, room_id, label) VALUES (:id, :r, '1')"),
                 {"id": bed, "r": room})
    return bed


def _admission(conn, tenant: uuid.UUID, number: str, state: str,
               attending: uuid.UUID | None = None) -> uuid.UUID:
    """A patient and one admission in `state` on a bed of its own, naming `attending`."""
    assert state in STATES                                  # written into the statement
    patient, admission, bed = uuid.uuid4(), uuid.uuid4(), _bed(conn, tenant)
    conn.execute(text("INSERT INTO patients (id, tenant_id, display_name, date_of_birth, sex, "
                      "patient_number, created_at) VALUES (:id, :t, 'x', 'x', 'x', :n, now())"),
                 {"id": patient, "t": tenant, "n": number})
    conn.execute(text(
        "INSERT INTO admissions (id, patient_id, tenant_id, state, admission_datetime, "
        "admitting_unit_id, bed_id, admission_diagnosis_free_text, attending_physician_id) "
        f"SELECT :id, :p, :t, '{state}', now(), r.unit_id, b.id, 'Sentetik tanı', :a "
        "FROM beds b JOIN rooms r ON r.id = b.room_id WHERE b.id = :b"),
        {"id": admission, "p": patient, "t": tenant, "b": bed, "a": attending})
    return admission


def _row(conn, admission: uuid.UUID, user: uuid.UUID, role: str, *, active: bool = True,
         hours_ago: int = 0, window: tuple[datetime, datetime] | None = None) -> uuid.UUID:
    """One care-team row; a closed one is closed now."""
    assert role in ROLES                                    # written into the statement
    rid = uuid.uuid4()
    start, end = window or (None, None)
    conn.execute(text(
        "INSERT INTO care_team_members (id, admission_id, user_id, role, is_active, created_at, "
        f"closed_at, window_start, window_end) VALUES (:id, :a, :u, '{role}', :active, "
        "now() - make_interval(hours => :h), CASE WHEN :active THEN NULL ELSE now() END, :ws, :we)"),
        {"id": rid, "a": admission, "u": user, "active": active, "h": hours_ago, "ws": start,
         "we": end})
    return rid


def _rows(conn, admission: uuid.UUID) -> list[tuple]:
    """(user, role, active, closed?, granted by, window start, window end), oldest first."""
    return [tuple(r) for r in conn.execute(text(
        "SELECT user_id, role::text, is_active, closed_at IS NOT NULL, granted_by_id, window_start, "
        "window_end FROM care_team_members WHERE admission_id = :a ORDER BY created_at, id"),
        {"a": admission}).all()]


def _attending(conn, admission: uuid.UUID):
    return conn.execute(text("SELECT attending_physician_id FROM admissions WHERE id = :a"),
                        {"a": admission}).scalar_one()


def test_0018_puts_the_care_team_right_before_its_indexes(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "0017")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        d1, d2, d3 = (_user(conn, name) for name in ("d1", "d2", "d3"))
        two = _admission(conn, tenant, "H9900101", "ACTIVE", attending=d1)
        _row(conn, two, d1, "ATTENDING", hours_ago=2)
        _row(conn, two, d2, "ATTENDING", hours_ago=1)
        none = _admission(conn, tenant, "H9900102", "ACTIVE", attending=d3)
        oncall = _admission(conn, tenant, "H9900103", "PENDING_DISCHARGE", attending=d1)
        _row(conn, oncall, d1, "ONCALL_PHYSICIAN", window=(T0, T0 + timedelta(hours=12)))
        gone = _admission(conn, tenant, "H9900104", "DISCHARGED", attending=d2)
        _row(conn, gone, d2, "ASSOCIATE_PHYSICIAN")
        moved = _admission(conn, tenant, "H9900105", "TRANSFERRED", attending=d1)
        _row(conn, moved, d1, "ATTENDING")
        draft = _admission(conn, tenant, "H9900106", "DRAFT", attending=d1)
    command.upgrade(cfg, "0018")
    with engine.connect() as conn:
        # Step 3: of two attendings the newest stays, and the admission names her.
        assert [(user, role, active) for user, role, active, *_ in _rows(conn, two)] == [
            (d1, "ATTENDING", False), (d2, "ATTENDING", True)]
        assert _attending(conn, two) == d2
        # Step 4 (O45): a signed admission whose attending had no row gets one, granted by nobody.
        assert _rows(conn, none) == [(d3, "ATTENDING", True, False, None, None, None)]
        # ... and her own on-call row becomes it: one row, no window.
        assert _rows(conn, oncall) == [(d1, "ATTENDING", True, False, None, None, None)]
        # Step 2: a closed admission keeps no open row.
        assert [(user, active, closed) for user, _, active, closed, *_ in
                _rows(conn, gone) + _rows(conn, moved)] == [(d2, False, True), (d1, False, True)]
        # A DRAFT has no attending row yet (D3).
        assert _rows(conn, draft) == []


def test_then_one_active_row_per_member_and_one_attending_per_admission_hold(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "0017")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        d1, d2 = _user(conn, "d1"), _user(conn, "d2")
        admission = _admission(conn, tenant, "H9900201", "ACTIVE", attending=d1)
    command.upgrade(cfg, "0018")                     # step 4 writes d1's ATTENDING row
    with engine.begin() as conn:
        _row(conn, admission, d2, "ASSOCIATE_PHYSICIAN", active=False)
        _row(conn, admission, d2, "ASSOCIATE_PHYSICIAN", active=False)        # F2: ended twice
        _row(conn, admission, d2, "ASSOCIATE_PHYSICIAN")
    with pytest.raises(IntegrityError, match=ACTIVE), engine.begin() as conn:
        _row(conn, admission, d2, "ONCALL_PHYSICIAN", window=(T0, T0 + timedelta(hours=1)))
    with pytest.raises(IntegrityError, match=ATTENDING), engine.begin() as conn:
        _row(conn, admission, _user(conn, "d3"), "ATTENDING")
    with engine.connect() as conn:
        defs = dict(conn.execute(text("SELECT indexname, indexdef FROM pg_indexes "
                                      "WHERE tablename = 'care_team_members'")).all())
    assert "UNIQUE" in defs[ACTIVE] and "(admission_id, user_id)" in defs[ACTIVE]
    assert "WHERE is_active" in defs[ACTIVE]
    assert "UNIQUE" in defs[ATTENDING] and "(admission_id)" in defs[ATTENDING]
    assert "'ATTENDING'::careteamrole" in defs[ATTENDING]


def test_the_charge_nurses_lose_the_claim_and_nobody_else_does(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "0017")
    with engine.begin() as conn:
        a, b = _tenant(conn, "hastane-a"), _tenant(conn, "hastane-b")
        charge_a = _group(conn, a, "charge_nurse", "care_team.claim", "board.view")
        charge_b = _group(conn, b, "charge_nurse", "care_team.claim", "board.view",
                          description="Sentetik özel açıklama")
        attending = _group(conn, a, "attending", "care_team.claim", "care_team.assign",
                           description="Sentetik hekim grubu")
        own = _group(conn, a, "gece_ekibi", "care_team.claim", description="Sentetik ek görev")
    command.upgrade(cfg, "0018")
    with engine.connect() as conn:
        claim = set(conn.execute(text("SELECT group_id FROM group_permissions "
                                      "WHERE permission = 'care_team.claim'")).scalars())
        kept = set(conn.execute(text("SELECT group_id FROM group_permissions "
                                     "WHERE permission = 'board.view'")).scalars())
        described = dict(conn.execute(text("SELECT id, description FROM groups "
                                           "WHERE slug = 'charge_nurse'")).all())
    assert claim == {attending, own}
    assert kept == {charge_a, charge_b}
    assert described == {charge_a: AFTER, charge_b: "Sentetik özel açıklama"}       # X3


@pytest.mark.parametrize("reason", [*REASONS, None])
def test_a_transfer_reason_is_one_of_the_six_or_none(clean_db, reason):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        admission = _admission(conn, _tenant(conn, "hastane-a"), "H9900301", "ACTIVE")
        conn.execute(text("UPDATE admissions SET transfer_reason = :r, transfer_note = 'x' "
                          "WHERE id = :id"), {"r": reason, "id": admission})


def test_any_other_transfer_reason_is_refused(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        admission = _admission(conn, _tenant(conn, "hastane-a"), "H9900302", "ACTIVE")
    with pytest.raises(IntegrityError, match=CHECK), engine.begin() as conn:
        conn.execute(text("UPDATE admissions SET transfer_reason = 'TELEPORT' WHERE id = :id"),
                     {"id": admission})


def test_the_downgrade_restores_the_old_key_and_drops_the_columns(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "0017")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        charge = _group(conn, tenant, "charge_nurse", "care_team.claim")
        d1 = _user(conn, "d1")
        admission = _admission(conn, tenant, "H9900401", "ACTIVE", attending=d1)
    command.upgrade(cfg, "0018")
    command.downgrade(cfg, "0017")
    with engine.connect() as conn:
        claim = set(conn.execute(text("SELECT group_id FROM group_permissions "
                                      "WHERE permission = 'care_team.claim'")).scalars())
        described = conn.execute(text("SELECT description FROM groups WHERE id = :g"),
                                 {"g": charge}).scalar_one()
        version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
        kind = conn.execute(text("SELECT contype FROM pg_constraint WHERE conname = :n"),
                            {"n": ACTIVE}).scalar_one_or_none()
        partial = set(conn.execute(text(
            "SELECT indexname FROM pg_indexes WHERE tablename = 'care_team_members' "
            "AND indexdef LIKE '%WHERE%'")).scalars())
        backfilled = _rows(conn, admission)
    assert claim == {charge} and described == BEFORE and version == "0017"
    assert kind == "u" and partial == set()
    assert {"transfer_reason", "transfer_note"}.isdisjoint(
        {c["name"] for c in inspect(engine).get_columns("admissions")})
    # Rows written by steps 2–4 stay.
    assert backfilled == [(d1, "ATTENDING", True, False, None, None, None)]
    command.upgrade(cfg, "0018")


def test_the_downgrade_refuses_loudly_over_a_member_ended_twice(clean_db):
    """The old key cannot hold two closed rows of one member: the downgrade fails in its own
    transaction and leaves 0018 in place. The deploy notes' rollback block counts them first."""
    engine, cfg = clean_db
    command.upgrade(cfg, "0017")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        d1, d2 = _user(conn, "d1"), _user(conn, "d2")
        admission = _admission(conn, tenant, "H9900501", "ACTIVE", attending=d1)
    command.upgrade(cfg, "0018")
    with engine.begin() as conn:
        _row(conn, admission, d2, "ASSOCIATE_PHYSICIAN", active=False)
        _row(conn, admission, d2, "ASSOCIATE_PHYSICIAN", active=False)
    with pytest.raises(IntegrityError, match=ACTIVE):
        command.downgrade(cfg, "0017")
    with engine.connect() as conn:
        assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0018"


def test_the_model_and_the_migration_agree_on_the_transfer_columns(clean_db):
    """The care team's two indexes are held to one text in both places by Task 1's model test and
    the index test above; the columns' types are compared here."""
    engine, cfg = clean_db
    command.upgrade(cfg, "head")

    def only_0018(object_, name, type_, reflected, compare_to):
        if type_ == "table":
            return name == "admissions"
        if type_ == "column":
            table = object_.table.name if object_ is not None else None
            return table == "admissions" and name in {"transfer_reason", "transfer_note"}
        return False

    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn, opts={
            "compare_type": True, "compare_server_default": False, "include_object": only_0018})
        assert compare_metadata(ctx, Base.metadata) == []
        # compare_metadata reads no CHECK: it is read here, by name.
        assert conn.execute(text("SELECT count(*) FROM pg_constraint WHERE contype = 'c' "
                                 "AND conname = :n"), {"n": CHECK}).scalar_one() == 1
```

- [ ] **Step 2: Run it and see it red**

```bash
cd /c/tmp/g2b-b1c/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_migration_0018_care_team_transfer.py 2>&1 | tail -3
```

Expected:
- the tests that upgrade to `"0018"` fail with alembic's `Can't locate revision identified by '0018'`;
- the `head` tests fail on the missing `transfer_reason` column.

- [ ] **Step 3: The migration**

Create `homunculus-engine/alembic/versions/0018_care_team_transfer.py`:

```python
# homunculus-engine/alembic/versions/0018_care_team_transfer.py
"""G2-B1c Bakım ekibi with G2-B1b Nakil (specs 2026-11-09: B1c §5.1, B1b §5.9): one migration (D9)

Revision 0018, follows G3-02's 0017 (tasks). B1c is built first and writes all of it; B1b finds its
part (step 8) done.

Upgrade, in this order (B1c §5.1):
1. Drop the constraint `uq_care_team_active_member` (admission_id, user_id, is_active). It allowed
   one CLOSED row per member and admission, so ending a member twice broke it (F2).
2. Close the active rows of closed admissions (DISCHARGED, TRANSFERRED).
3. Per admission, keep the newest active ATTENDING row (`created_at`, then `id`) and close the
   others. `attending_physician_id` follows the kept row.
4. Backfill (O45). An open, signed admission (ACTIVE, PENDING_DISCHARGE, PENDING_TRANSFER) with an
   attending and no active ATTENDING row gets one for her (`granted_by_id` NULL). When she holds
   another active row there, that row becomes it, its window cleared.
5. `uq_care_team_active_member` ON (admission_id, user_id) WHERE is_active.
6. `uq_care_team_one_attending` ON (admission_id) WHERE is_active AND role = 'ATTENDING'.
7. `care_team.claim` leaves every `charge_nurse` group (D7). «bakım ekibi» leaves that group's
   description where it is still the default text; a hospital's own text is left alone (X3).
8. B1b: `admissions.transfer_reason` VARCHAR(32) NULL, checked against the six reasons
   (`ck_admissions_transfer_reason`), and `admissions.transfer_note` VARCHAR(1536) NULL, a Fernet
   ciphertext (`EncryptedString`, ≤ 200 characters of plaintext).

Steps 2–4 close or write rows at `now()`. An image from before this revision runs against it
with one exception: its claim route writes a second ATTENDING row without ending the first, which
the step-6 index refuses (a 500). No screen calls that route.

Downgrade: B1b's columns and CHECK go; the `charge_nurse` rows and the description come back; the
two indexes go and the old constraint returns. That last step FAILS LOUDLY when a member holds two
closed rows on one admission; the deploy notes' rollback block counts them first. Rows closed or
written by steps 2–4 stay as they are.

ONE STATEMENT PER op.execute (asyncpg; see 0004, 0010, 0013).

Revision ID: 0018
Revises: 0017
Create Date: 2026-11-09
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0018"
down_revision: Union[str, None] = "0017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ACTIVE_INDEX = "uq_care_team_active_member"
ATTENDING_INDEX = "uq_care_team_one_attending"
REASON_CHECK = "ck_admissions_transfer_reason"
REASONS = ("CLINICAL_NEED", "TO_ICU", "ICU_TO_WARD", "ISOLATION", "PATIENT_OR_FAMILY_REQUEST",
           "OTHER")
CLOSED = "('DISCHARGED', 'TRANSFERRED')"
SIGNED_OPEN = "('ACTIVE', 'PENDING_DISCHARGE', 'PENDING_TRANSFER')"
NO_ACTIVE_ATTENDING = ("NOT EXISTS (SELECT 1 FROM care_team_members AS x WHERE x.admission_id = a.id"
                       " AND x.is_active AND x.role = 'ATTENDING')")
#: D7 (X3): the charge nurse's default description, before and after.
CHARGE_BEFORE = "Hasta kabul, transfer/taburcu onayı, nöbet çizelgesi, bakım ekibi."
CHARGE_AFTER = "Hasta kabul, transfer/taburcu onayı, nöbet çizelgesi."


def upgrade() -> None:
    # 1
    op.drop_constraint(ACTIVE_INDEX, "care_team_members", type_="unique")
    # 2
    op.execute(
        "UPDATE care_team_members SET is_active = false, closed_at = now()"
        " WHERE is_active AND admission_id IN"
        f" (SELECT id FROM admissions WHERE state IN {CLOSED})")
    # 3
    op.execute(
        "UPDATE care_team_members SET is_active = false, closed_at = now() WHERE id IN"
        " (SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY admission_id"
        " ORDER BY created_at DESC NULLS LAST, id DESC) AS n"
        " FROM care_team_members WHERE is_active AND role = 'ATTENDING') AS ranked WHERE n > 1)")
    op.execute(
        "UPDATE admissions AS a SET attending_physician_id = m.user_id FROM care_team_members AS m"
        " WHERE m.admission_id = a.id AND m.is_active AND m.role = 'ATTENDING'"
        " AND a.attending_physician_id IS DISTINCT FROM m.user_id")
    # 4: her own active row first (the old constraint allowed her one), then a new row.
    op.execute(
        "UPDATE care_team_members AS m SET role = 'ATTENDING', window_start = NULL,"
        " window_end = NULL FROM admissions AS a"
        " WHERE m.admission_id = a.id AND m.is_active AND m.user_id = a.attending_physician_id"
        f" AND a.state IN {SIGNED_OPEN} AND {NO_ACTIVE_ATTENDING}")
    op.execute(
        "INSERT INTO care_team_members (id, admission_id, user_id, role, granted_by_id, is_active,"
        " created_at) SELECT gen_random_uuid(), a.id, a.attending_physician_id, 'ATTENDING', NULL,"
        " true, now() FROM admissions AS a"
        f" WHERE a.state IN {SIGNED_OPEN} AND a.attending_physician_id IS NOT NULL"
        f" AND {NO_ACTIVE_ATTENDING}")
    # 5, 6
    op.create_index(ACTIVE_INDEX, "care_team_members", ["admission_id", "user_id"], unique=True,
                    postgresql_where=sa.text("is_active"))
    op.create_index(ATTENDING_INDEX, "care_team_members", ["admission_id"], unique=True,
                    postgresql_where=sa.text("is_active AND role = 'ATTENDING'"))
    # 7
    op.execute(
        "DELETE FROM group_permissions WHERE permission = 'care_team.claim'"
        " AND group_id IN (SELECT id FROM groups WHERE slug = 'charge_nurse')")
    op.execute(sa.text(
        "UPDATE groups SET description = :after"
        " WHERE slug = 'charge_nurse' AND description = :before"
    ).bindparams(after=CHARGE_AFTER, before=CHARGE_BEFORE))
    # 8 (B1b)
    op.add_column("admissions", sa.Column("transfer_reason", sa.String(32), nullable=True))
    op.add_column("admissions", sa.Column("transfer_note", sa.String(1536), nullable=True))
    op.create_check_constraint(
        REASON_CHECK, "admissions",
        "transfer_reason IS NULL OR transfer_reason IN ({})".format(
            ", ".join(f"'{reason}'" for reason in REASONS)))


def downgrade() -> None:
    op.drop_constraint(REASON_CHECK, "admissions", type_="check")
    op.drop_column("admissions", "transfer_note")
    op.drop_column("admissions", "transfer_reason")
    op.execute(sa.text(
        "UPDATE groups SET description = :before"
        " WHERE slug = 'charge_nurse' AND description = :after"
    ).bindparams(after=CHARGE_AFTER, before=CHARGE_BEFORE))
    op.execute(
        "INSERT INTO group_permissions (group_id, permission)"
        " SELECT id, 'care_team.claim' FROM groups WHERE slug = 'charge_nurse'"
        " ON CONFLICT DO NOTHING")
    op.drop_index(ATTENDING_INDEX, table_name="care_team_members")
    op.drop_index(ACTIVE_INDEX, table_name="care_team_members")
    op.create_unique_constraint(ACTIVE_INDEX, "care_team_members",
                                ["admission_id", "user_id", "is_active"])
```

- [ ] **Step 4: Run it and see it green**

Same command as Step 2. Expected: `14 passed` (the reason test runs seven times).

- [ ] **Step 5: The chain has one head, and the older migration tests still pass**

```bash
cd /c/tmp/g2b-b1c/homunculus-engine && PYTHONPATH=src /c/tmp/f7-py312/venv/Scripts/python.exe -c "from alembic.config import Config; from alembic.script import ScriptDirectory; print(ScriptDirectory.from_config(Config('alembic.ini')).get_heads())"
```

Expected: `['0018']`.

Then run each of these as its own Bash call (`timeout: 600000`), with the Postgres command of Task 0, Step 7:
- `tests/test_migration_0016_bed_occupancy.py`
- `tests/test_migration_0015_protocol.py`
- `tests/test_tasks_postgres.py` (G3-02's: its `head` is now `0018`, and `test_downgrade_drops_only_the_new_objects` downgrades through `0018`'s downgrade to `0016`; X12)
- `tests/test_migration_0010_schema_parity.py`

Expected: all passed.

If one of them asserts that `head` is its own revision, change that line to name its revision (`command.upgrade(cfg, "0016")`). Never change what the assertion means. Name each changed line in the report, and add the file to Step 6's `git add` and `git commit` paths.

- [ ] **Step 6: Line ends, then commit**

```bash
cd /c/tmp/g2b-b1c && for f in homunculus-engine/alembic/versions/0018_care_team_transfer.py homunculus-engine/tests/test_migration_0018_care_team_transfer.py; do /c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" "$f"; printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- homunculus-engine/alembic/versions/0018_care_team_transfer.py homunculus-engine/tests/test_migration_0018_care_team_transfer.py
git status --short && git diff --cached --stat
git commit -m "feat(migration): 0018 — the care team put right under two partial unique indexes, the charge nurse's claim taken back, B1b's transfer columns (G2-B1c, §5.1, D7, D9, O45, X3)" -m "Open rows of closed admissions close; of two attendings the newest stays; a signed admission's attending gets her row. Then one active row per member and one attending per admission. The downgrade restores the old key and fails loudly over a member ended twice. It follows G3-02's 0017 (on main). Red: Can't locate revision '0018'." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/alembic/versions/0018_care_team_transfer.py homunculus-engine/tests/test_migration_0018_care_team_transfer.py
```

---

### Task 3: The charge nurse no longer claims (spec D7, T1)

**Files:**
- Modify: `homunculus-engine/src/homunculus/auth/permissions.py`
- Modify: `homunculus-engine/tests/test_permissions.py`

- [ ] **Step 1: Write the failing test**

In `homunculus-engine/tests/test_permissions.py`:

1. In `test_the_legacy_rights_are_preserved_group_by_group`, replace

```python
    assert "care_team.claim" in by_slug["charge_nurse"]
```

with

```python
    assert "care_team.claim" not in by_slug["charge_nurse"]     # G2-B1c (D7): it could only fail (T1)
```

2. In `SPEC_GROUPS`, replace the `charge_nurse` entry (G3-02 added `tasks.view` and `tasks.manage` to its last line)

```python
    "charge_nurse": (False, False, {"board.view", "alerts.ack", "alerts.escalate",
                                    "admissions.view", "admissions.admit",
                                    "admissions.transfer.confirm", "admissions.discharge.confirm",
                                    "care_team.claim", "handover.sign", "shifts.manage",
                                    "break_glass.use", "clinical.chart", "beds.release",
                                    "devices.map_beds", "beds.manage_state", "tasks.view", "tasks.manage"}),
```

with

```python
    "charge_nurse": (False, False, {"board.view", "alerts.ack", "alerts.escalate",
                                    "admissions.view", "admissions.admit",
                                    "admissions.transfer.confirm", "admissions.discharge.confirm",
                                    "handover.sign", "shifts.manage",
                                    "break_glass.use", "clinical.chart", "beds.release",
                                    "devices.map_beds", "beds.manage_state", "tasks.view", "tasks.manage"}),
```

Only `care_team.claim` leaves; G3-02's two keys stay.

3. After `test_the_charge_nurse_and_only_she_among_the_ward_groups_manages_bed_states`, add:

```python


def test_the_care_team_is_claimed_and_assigned_by_physicians_alone_by_default():
    """G2-B1c (D7, T1): the care team is physicians'. A charge nurse's claim could only be refused
    (`care_team_not_physician`), so she no longer holds the key, and her group no longer says
    «bakım ekibi». Assigning stays the attending's ("Ünite Hekimi … bakım ekibi atamaz"); the
    system group holds every key by rule."""
    by_slug = {g["slug"]: g for g in DEFAULT_GROUPS}
    claim = {slug for slug, g in by_slug.items() if "care_team.claim" in g["permissions"]}
    assign = {slug for slug, g in by_slug.items() if "care_team.assign" in g["permissions"]}
    assert claim == assign == {"hospital_admin", "attending"}
    assert "bakım ekibi" not in by_slug["charge_nurse"]["description"]
```

- [ ] **Step 2: Run it and see it red**

```bash
cd /c/tmp/g2b-b1c/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_permissions.py 2>&1 | tail -4
```

Expected: 3 failed. The legacy-rights test, the spec table (`charge_nurse`), and the new test (`charge_nurse` in `claim`).

- [ ] **Step 3: The default group**

In `homunculus-engine/src/homunculus/auth/permissions.py`, replace

```python
    {"slug": "charge_nurse", "kind": "extra", "name": "Sorumlu Hemşire",
     "description": "Hasta kabul, transfer/taburcu onayı, nöbet çizelgesi, bakım ekibi.",
     "mfa_required": False, "is_system": False,
     "permissions": ("board.view", "alerts.ack", "alerts.escalate", "admissions.view",
                     "admissions.admit", "admissions.transfer.confirm",
                     "admissions.discharge.confirm", "care_team.claim", "handover.sign",
                     "shifts.manage", "break_glass.use", "clinical.chart", "beds.release",
                     "devices.map_beds", "beds.manage_state", "tasks.view", "tasks.manage")},
```

with

```python
    # G2-B1c (D7): no `care_team.claim`. The care team is physicians' (T1), and a charge nurse's
    # claim could only be refused. Migration 0018 takes the key, and «bakım ekibi» from the default
    # description, from the tenants seeded before it.
    {"slug": "charge_nurse", "kind": "extra", "name": "Sorumlu Hemşire",
     "description": "Hasta kabul, transfer/taburcu onayı, nöbet çizelgesi.",
     "mfa_required": False, "is_system": False,
     "permissions": ("board.view", "alerts.ack", "alerts.escalate", "admissions.view",
                     "admissions.admit", "admissions.transfer.confirm",
                     "admissions.discharge.confirm", "handover.sign",
                     "shifts.manage", "break_glass.use", "clinical.chart", "beds.release",
                     "devices.map_beds", "beds.manage_state", "tasks.view", "tasks.manage")},
```

The description must equal `0018`'s `CHARGE_AFTER` exactly. G3-02's `tasks.view` and `tasks.manage` stay (its migration `0017` granted them to the charge nurses already seeded).

- [ ] **Step 4: Run it and see it green, then the suites that read the groups**

```bash
cd /c/tmp/g2b-b1c/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -5
```

Expected: no failure. `tests/test_migration_0010_defaults.py` pins 0010's frozen copy and does not move.

A test that pins the charge nurse's live rights may fail here with `care_team.claim` named. Remove the key from its list, the way this task removes it from `SPEC_GROUPS`. Name the file in the report, and add it to Step 5's paths.

- [ ] **Step 5: Line ends, then commit**

```bash
cd /c/tmp/g2b-b1c && for f in homunculus-engine/src/homunculus/auth/permissions.py homunculus-engine/tests/test_permissions.py; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- homunculus-engine/src/homunculus/auth/permissions.py homunculus-engine/tests/test_permissions.py
git status --short && git diff --cached --stat
git commit -m "feat(auth): the charge nurse no longer holds care_team.claim, and her group no longer says «bakım ekibi» (G2-B1c, D7, T1)" -m "Under D1 a charge nurse's claim is always refused; a key that can only fail misleads the administrator. Red: the legacy-rights test, the spec table and the new test named charge_nurse." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/src/homunculus/auth/permissions.py homunculus-engine/tests/test_permissions.py
```

---

### Task 4: The three care-team codes (spec §5.6)

**Files:**
- Modify: `homunculus-engine/src/homunculus/admission/errors.py`
- Modify: `homunculus-engine/tests/test_admission_form.py`

A new code must reach, in this slice: `errors.py` (this task); the pinned set in `test_admission_form.py` (this task); `apiErrors.js` `ADMISSION_CODE_KEYS`, the count pin in `apiErrors.test.js` (30 → 33), and the four languages (Task 13).

- [ ] **Step 1: Write the failing test**

In `homunculus-engine/tests/test_admission_form.py`, in `test_every_other_refusal_has_a_stable_code`, replace the end of the set. At `ea61714a` it reads (30 codes; B3a's `bed_reserved` last)

```python
                     "no_protocol",
                     # G2-B3a (spec D5, X1)
                     "bed_reserved"}
```

Replace it with

```python
                     "no_protocol",
                     # G2-B3a (spec D5, X1)
                     "bed_reserved",
                     # G2-B1c (spec §5.6)
                     "care_team_conflict", "care_team_not_physician",
                     "care_team_attending_required"}
```

The set then holds 33 codes, as `apiErrors.test.js` will (Task 13).

- [ ] **Step 2: Run it and see it red**

```bash
cd /c/tmp/g2b-b1c/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_admission_form.py -k stable_code 2>&1 | tail -4
```

Expected: 1 failed. The three `care_team_*` codes are in the test's set and not in `CODES`.

- [ ] **Step 3: The codes**

In `homunculus-engine/src/homunculus/admission/errors.py`, after the B3a block, which ends

```python
BED_RESERVED = "bed_reserved"                          # a RESERVED bed, and no confirm_reserved
CODES = CODES | frozenset({BED_RESERVED})
```

add:

```python

# G2-B1c — Bakım ekibi (spec §5.6). Its own block after B3a's, which it widens the same way.
CARE_TEAM_CONFLICT = "care_team_conflict"              # already on the team, or lost at an index (T7)
CARE_TEAM_NOT_PHYSICIAN = "care_team_not_physician"    # the member, claimer or attending made (T1)
CARE_TEAM_ATTENDING_REQUIRED = "care_team_attending_required"   # the ATTENDING row never ends alone (T5)
CODES = CODES | frozenset({CARE_TEAM_CONFLICT, CARE_TEAM_NOT_PHYSICIAN, CARE_TEAM_ATTENDING_REQUIRED})
```

- [ ] **Step 4: Run it and see it green**

```bash
cd /c/tmp/g2b-b1c/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_admission_form.py 2>&1 | tail -3
```

Expected: all passed.

- [ ] **Step 5: Line ends, then commit**

```bash
cd /c/tmp/g2b-b1c && for f in homunculus-engine/src/homunculus/admission/errors.py homunculus-engine/tests/test_admission_form.py; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- homunculus-engine/src/homunculus/admission/errors.py homunculus-engine/tests/test_admission_form.py
git status --short && git diff --cached --stat
git commit -m "feat(admission): the three care-team refusal codes (G2-B1c, §5.6)" -m "care_team_conflict, care_team_not_physician, care_team_attending_required, in their own block after B3a's; the pinned set goes from 30 to 33. Red: the pinned set held three codes errors.py lacked." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/src/homunculus/admission/errors.py homunculus-engine/tests/test_admission_form.py
```

---

### Task 5: The care team's service — who is a physician, who is the attending (spec T1, T4, T8, F9)

**Files:**
- Modify: `homunculus-engine/src/homunculus/admission/service.py`
- Create: `homunculus-engine/tests/test_care_team_rules.py`
- Create: `homunculus-engine/tests/test_care_team_service.py`

- [ ] **Step 1: Write the failing tests**

Create `homunculus-engine/tests/test_care_team_rules.py`:

```python
# homunculus-engine/tests/test_care_team_rules.py
"""The care team's rules that need no database (G2-B1c, spec T1, T8, §5.2 `in_force`):
- a physician is a member of a default ROLE group of physicians;
- a row is in force while it is active and, for an on-call row, inside its window (the board's
  own rule, scope/service.py `_window_open`);
- an on-call row whose window has passed is the one an add renews."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from homunculus.admission.models import CareTeamMember, CareTeamRole
from homunculus.admission.service import PHYSICIAN_GROUPS, expired, in_force
from homunculus.auth.permissions import DEFAULT_GROUPS

NOW = datetime(2026, 11, 9, 12, 0, tzinfo=timezone.utc)
HOUR = timedelta(hours=1)


def _row(role=CareTeamRole.ONCALL_PHYSICIAN, *, active=True, start=None, end=None):
    return CareTeamMember(role=role, is_active=active, window_start=start, window_end=end)


def test_the_physicians_are_the_three_default_role_groups_of_physicians():
    kinds = {g["slug"]: g["kind"] for g in DEFAULT_GROUPS}
    assert PHYSICIAN_GROUPS == ("attending", "unit_physician", "physician")
    assert all(kinds[slug] == "role" for slug in PHYSICIAN_GROUPS)


def test_a_row_is_in_force_while_active_and_inside_its_window():
    assert in_force(_row(CareTeamRole.ASSOCIATE_PHYSICIAN), NOW)
    assert in_force(_row(start=NOW - HOUR, end=NOW + HOUR), NOW)
    assert not in_force(_row(start=NOW - 3 * HOUR, end=NOW - HOUR), NOW)      # passed
    assert not in_force(_row(start=NOW + HOUR, end=NOW + 3 * HOUR), NOW)      # still to come
    assert not in_force(_row(CareTeamRole.ATTENDING, active=False), NOW)


def test_only_an_on_call_row_whose_window_has_passed_is_expired():
    assert expired(_row(start=NOW - 3 * HOUR, end=NOW - HOUR), NOW)
    assert not expired(_row(start=NOW - HOUR, end=NOW + HOUR), NOW)
    assert not expired(_row(start=NOW + HOUR, end=NOW + 3 * HOUR), NOW)
    assert not expired(_row(CareTeamRole.ASSOCIATE_PHYSICIAN), NOW)
```

Create `homunculus-engine/tests/test_care_team_service.py`:

```python
# homunculus-engine/tests/test_care_team_service.py
"""The care team's service (G2-B1c, spec T1, T4, D2, D4, F2), below the routes:
- `is_physician`: an active account, an active membership of THIS tenant, a group among
  `PHYSICIAN_GROUPS` — never a nurse, a charge nurse, an administrator or an auditor (T1);
- `set_attending`: the previous attending's row ends, her own other row ends (a promoted associate
  holds one row), the admission names her, her row is written (T4);
- `end_care_team_member`: a row closes and stays; a member ended twice keeps both rows (F2).
Postgres. Synthetic ward: tests/kabul_world.py.

`add_physician`, `physician_elsewhere` and `active_admission` are the slice's helpers; the other
care-team test files import them."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest_asyncio
from sqlalchemy import select, update

from homunculus.admission import service
from homunculus.admission.models import Admission, CareTeamMember, CareTeamRole, Patient
from homunculus.auth.groups import ensure_default_groups
from homunculus.auth.models import TenantMembership, User
from homunculus.scope.models import StaffScope
from homunculus.tenant.models import Tenant
from tests.conftest import requires_db
from tests.kabul_world import build_ward
from tests.signed_in import add_user, bearer

pytestmark = [requires_db]


async def add_physician(db, w, name: str, *, group: str = "physician",
                        unit: str | None = "rea") -> uuid.UUID:
    """A physician added to the synthetic ward inside a test: a member of its tenant in the default
    group `group` (`attending`, `unit_physician` or `physician`; any other slug makes a
    non-physician), granted `unit` (None: no grant at all), signed in as `w.auth[name]`. Her
    `full_name` is `name` (`add_user`). Committed. Returns her id, read before anything can
    expire the row."""
    groups = await ensure_default_groups(db, w.tenant.id)
    user = await add_user(db, username=f"{name}@kabul.example.com", tenant_id=w.tenant.id,
                          group=groups[group])
    user_id = user.id
    if unit is not None:
        db.add(StaffScope(tenant_id=w.tenant.id, user_id=user_id, unit_id=str(w.units[unit].id)))
        await db.commit()
    w.users[name] = user
    w.auth[name] = await bearer(db, user)
    return user_id


async def physician_elsewhere(db) -> uuid.UUID:
    """A physician of ANOTHER tenant, who is no physician here."""
    other = Tenant(name="Sentetik Başka Hastane", slug="baska-hastane", country_code="AZ")
    db.add(other)
    await db.flush()
    groups = await ensure_default_groups(db, other.id)
    user = await add_user(db, username="baska@kabul.example.com", tenant_id=other.id,
                          group=groups["physician"])
    return user.id


async def active_admission(db, w, bed: str = "1", number: str = "H9900101") -> Admission:
    """An ACTIVE admission made by the service, not the route: the ward's `doctor` named on it and
    signing it, and no care-team row (the service's sign-off writes none; the route's does)."""
    doctor = w.users["doctor"].id
    patient = Patient(tenant_id=w.tenant.id, display_name=f"Sentetik Hasta {bed}",
                      date_of_birth="1970-05-05", sex="female", patient_number=number)
    db.add(patient)
    await db.flush()
    admission = await service.create_draft_admission(
        db, tenant_id=w.tenant.id, patient=patient,
        note_fields={"admitting_unit_id": w.units["rea"].id, "bed_id": w.beds[bed].id,
                     "attending_physician_id": doctor,
                     "admission_diagnosis_free_text": "Sentetik tanı"})
    await service.sign_off_admission(db, admission, signing_user_id=doctor)
    await db.commit()
    return admission


async def team_of(db, admission_id) -> list[tuple]:
    """(user, role, active, closed?) of each row, oldest first, read afresh."""
    rows = (await db.execute(
        select(CareTeamMember).where(CareTeamMember.admission_id == admission_id)
        .order_by(CareTeamMember.created_at, CareTeamMember.id)
        .execution_options(populate_existing=True))).scalars().all()
    return [(m.user_id, m.role, m.is_active, m.closed_at is not None) for m in rows]


@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    return await build_ward(db_session)


async def test_a_physician_is_an_active_member_in_a_physician_group_of_this_tenant(ward, db_session):
    w = ward
    tenant = w.tenant.id
    doctor = w.users["doctor"].id
    others = {name: w.users[name].id for name in ("nurse", "nurse_b", "charge", "admin", "auditor")}
    unit = await add_physician(db_session, w, "unite", group="unit_physician")
    plain = await add_physician(db_session, w, "hekim")
    gone = await add_physician(db_session, w, "ayrilan")
    left = await add_physician(db_session, w, "uyeligi-biten")
    elsewhere = await physician_elsewhere(db_session)
    await db_session.execute(update(User).where(User.id == gone).values(is_active=False))
    await db_session.execute(update(TenantMembership).where(TenantMembership.user_id == left)
                             .values(is_active=False))
    await db_session.commit()
    for user_id in (doctor, unit, plain):
        assert await service.is_physician(db_session, tenant, user_id)
    for user_id in (*others.values(), gone, left, elsewhere, uuid.uuid4()):
        assert not await service.is_physician(db_session, tenant, user_id)


async def test_a_new_attending_ends_the_previous_ones_row_and_the_admission_names_her(ward, db_session):
    """D4, T4: one responsible physician at a time; the history stays."""
    w = ward
    doctor = w.users["doctor"].id
    second = await add_physician(db_session, w, "doctor2", group="attending")
    admission = await active_admission(db_session, w)
    first, ended = await service.set_attending(db_session, admission, user_id=doctor,
                                               granted_by_id=doctor)
    first_id = first.id
    assert ended == []
    row, ended = await service.set_attending(db_session, admission, user_id=second,
                                             granted_by_id=doctor)
    await db_session.commit()
    assert ended == [first_id]
    assert (row.role, row.granted_by_id, admission.attending_physician_id) == (
        CareTeamRole.ATTENDING, doctor, second)
    assert await team_of(db_session, admission.id) == [
        (doctor, CareTeamRole.ATTENDING, False, True), (second, CareTeamRole.ATTENDING, True, False)]


async def test_a_promoted_associate_holds_one_row(ward, db_session):
    """T4: her associate row ends with the previous attending's; she holds the ATTENDING row only."""
    w = ward
    doctor = w.users["doctor"].id
    helper = await add_physician(db_session, w, "yardimci")
    admission = await active_admission(db_session, w)
    attending, _ = await service.set_attending(db_session, admission, user_id=doctor,
                                               granted_by_id=doctor)
    associate = await service.add_care_team_member(
        db_session, admission, user_id=helper, role=CareTeamRole.ASSOCIATE_PHYSICIAN,
        granted_by_id=doctor)
    expected = {attending.id, associate.id}
    _, ended = await service.set_attending(db_session, admission, user_id=helper,
                                           granted_by_id=doctor)
    await db_session.commit()
    assert set(ended) == expected
    active = [(user, role) for user, role, is_active, _ in await team_of(db_session, admission.id)
              if is_active]
    assert active == [(helper, CareTeamRole.ATTENDING)]


async def test_a_member_ended_twice_keeps_both_closed_rows(ward, db_session):
    """F2: the old constraint broke here; the partial index does not."""
    w = ward
    doctor = w.users["doctor"].id
    helper = await add_physician(db_session, w, "yardimci")
    admission = await active_admission(db_session, w)
    now = datetime.now(timezone.utc)
    for _ in range(2):
        row = await service.add_care_team_member(
            db_session, admission, user_id=helper, role=CareTeamRole.ASSOCIATE_PHYSICIAN,
            granted_by_id=doctor)
        await service.end_care_team_member(db_session, row, now=now)
        assert (row.is_active, row.closed_at) == (False, now)
    await db_session.commit()
    assert await team_of(db_session, admission.id) == [
        (helper, CareTeamRole.ASSOCIATE_PHYSICIAN, False, True)] * 2
```

- [ ] **Step 2: Run them and see them red**

```bash
cd /c/tmp/g2b-b1c/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_care_team_rules.py 2>&1 | tail -3
```

Expected: a collection error, `ImportError: cannot import name 'PHYSICIAN_GROUPS'`.

```bash
cd /c/tmp/g2b-b1c/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_care_team_service.py 2>&1 | tail -3
```

Expected: 4 failed, each with `AttributeError: module 'homunculus.admission.service' has no attribute …` (`is_physician`, `set_attending`, `end_care_team_member`).

- [ ] **Step 3: The service**

In `homunculus-engine/src/homunculus/admission/service.py`:

1. Replace the import line

```python
from homunculus.tenant.models import Bed, BedState, Unit
```

with

```python
from homunculus.auth.models import Group, TenantMembership, User, UserGroup
from homunculus.scope.service import _window_open
from homunculus.tenant.models import Bed, BedState, Unit
```

`scope/service.py` imports only `admission/models.py`, `auth/models.py` and `scope/models.py`, so this makes no import cycle.

2. Replace

```python
    db.add(member)
    await db.flush()
    return member


# ---------------------------------------------------------------------------
# Nurse–bed shift assignment — §4.4, S-25
```

(the end of `add_care_team_member` and the next section's header) with

```python
    db.add(member)
    await db.flush()
    return member


# ---------------------------------------------------------------------------
# Care team — Group 2 · B1c (spec D1–D4, T1, T4, T8)
# ---------------------------------------------------------------------------
#: G2-B1c (T1): the default ROLE groups whose members are physicians. The role group says what a
#: person is; a permission cannot, because the system group holds every key by rule. The dashboard
#: holds a copy (screens/patient/careTeam/careTeam.js); its test holds the two equal.
PHYSICIAN_GROUPS = ("attending", "unit_physician", "physician")


def physician_ids(tenant_id: uuid.UUID):
    """SELECT the ids of the tenant's physicians (T1): an active account with an active membership
    in this tenant and a group of this tenant among `PHYSICIAN_GROUPS`. One statement for the
    checks and for the picker's candidates (D8)."""
    return (
        select(User.id)
        .join(TenantMembership, TenantMembership.user_id == User.id)
        .join(UserGroup, UserGroup.user_id == User.id)
        .join(Group, Group.id == UserGroup.group_id)
        .where(User.is_active.is_(True), TenantMembership.tenant_id == tenant_id,
               TenantMembership.is_active.is_(True), Group.tenant_id == tenant_id,
               Group.slug.in_(PHYSICIAN_GROUPS))
        .distinct()
    )


async def is_physician(db: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    """T1: whether `user_id` is a physician of this tenant. The routes refuse a member, a claimer
    or an attending a sign-off would make who is not: 409 `care_team_not_physician`."""
    found = await db.execute(physician_ids(tenant_id).where(User.id == user_id))
    return found.first() is not None


async def active_rows(db: AsyncSession, admission_id: uuid.UUID) -> list[CareTeamMember]:
    """The admission's ACTIVE care-team rows, oldest first, read afresh (`populate_existing`). The
    routes read them under `_locked`, and a row this session loaded before would otherwise come
    back as it was."""
    result = await db.execute(
        select(CareTeamMember)
        .where(CareTeamMember.admission_id == admission_id, CareTeamMember.is_active.is_(True))
        .order_by(CareTeamMember.created_at, CareTeamMember.id)
        .execution_options(populate_existing=True))
    return list(result.scalars().all())


def in_force(member: CareTeamMember, now: datetime) -> bool:
    """G2-B1c (§5.2): an active row, inside its window when it has one. This is what the board's
    own-patient rule grants on; `_window_open` is that rule's one copy (scope/service.py)."""
    return bool(member.is_active) and _window_open(member.window_start, member.window_end, now)


def expired(member: CareTeamMember, now: datetime) -> bool:
    """G2-B1c (T8): an on-call row whose window has passed. It grants nothing (F9), and an add of
    the same physician renews it instead of refusing her (X4)."""
    return (member.role == CareTeamRole.ONCALL_PHYSICIAN and member.window_end is not None
            and member.window_end < now)


async def end_care_team_member(db: AsyncSession, member: CareTeamMember, *,
                               now: datetime | None = None) -> None:
    """G2-B1c (§5.2): a row ends (`is_active` false, `closed_at` now) and is kept: the history
    stays (D4). Flushed, so a row written after it in the same transaction never meets it at an
    index."""
    member.is_active = False
    member.closed_at = now or _now()
    await db.flush()


async def set_attending(
    db: AsyncSession, admission: Admission, *, user_id: uuid.UUID,
    granted_by_id: uuid.UUID | None, now: datetime | None = None,
) -> tuple[CareTeamMember, list[uuid.UUID]]:
    """G2-B1c (T4, D2, D3, D4): `user_id` becomes the admission's attending: at sign-off, by a
    claim, or by an add with role ATTENDING. It is one function, so the three cannot differ:
      * the previous attending's row ends (one responsible physician at a time; the history stays);
      * her own other active row ends too (a promoted associate holds one row, not two);
      * `attending_physician_id` names her;
      * her ATTENDING row is written, granted by `granted_by_id`.
    The ends are flushed before the insert, so neither partial index meets the rows it replaces.
    Returns the new row and the ids of the rows it ended. The caller holds `_locked`, and has
    checked the state (T3) and that she is a physician (T1)."""
    now = now or _now()
    ended: list[uuid.UUID] = []
    for member in await active_rows(db, admission.id):
        if member.role == CareTeamRole.ATTENDING or member.user_id == user_id:
            member.is_active = False
            member.closed_at = now
            ended.append(member.id)
    if ended:
        await db.flush()
    admission.attending_physician_id = user_id
    member = CareTeamMember(admission_id=admission.id, user_id=user_id,
                            role=CareTeamRole.ATTENDING, granted_by_id=granted_by_id,
                            is_active=True, created_at=now)
    db.add(member)
    await db.flush()
    return member, ended


# ---------------------------------------------------------------------------
# Nurse–bed shift assignment — §4.4, S-25
```

`claim_attending` stays until Task 8 rewrites the claim route. The old route still calls it.

- [ ] **Step 4: Run them and see them green**

The two commands of Step 2. Expected: `3 passed`, then `4 passed`.

- [ ] **Step 5: The admission suites still pass**

Run each as its own Bash call, with the Postgres command of Task 0, Step 7:
- `tests/test_admission_workflow.py`
- `tests/test_scope_access_reader.py`

Then the whole no-DB suite (Task 1, Step 5).

Expected: all passed, and nothing fails in the no-DB suite.

- [ ] **Step 6: Line ends, then commit**

```bash
cd /c/tmp/g2b-b1c && for f in homunculus-engine/tests/test_care_team_rules.py homunculus-engine/tests/test_care_team_service.py; do /c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" "$f"; done
for f in homunculus-engine/src/homunculus/admission/service.py homunculus-engine/tests/test_care_team_rules.py homunculus-engine/tests/test_care_team_service.py; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- homunculus-engine/src/homunculus/admission/service.py homunculus-engine/tests/test_care_team_rules.py homunculus-engine/tests/test_care_team_service.py
git status --short && git diff --cached --stat
git commit -m "feat(admission): who is a physician, and one set_attending for the sign-off, the claim and the add (G2-B1c, T1, T4, T8)" -m "A physician is an active member of a physician role group of the tenant. set_attending ends the previous attending's row and the new attending's own other row, names her and writes her row. in_force and expired read the board's own window rule. Red: ImportError PHYSICIAN_GROUPS; AttributeError is_physician / set_attending / end_care_team_member." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/src/homunculus/admission/service.py homunculus-engine/tests/test_care_team_rules.py homunculus-engine/tests/test_care_team_service.py
```

---

### Task 6: The physician who signs becomes the attending (spec D3, §5.3, T1, O45; X8)

**Files:**
- Modify: `homunculus-engine/src/homunculus/admission/router.py`
- Create: `homunculus-engine/tests/test_care_team_sign_off.py`
- Modify: `homunculus-engine/tests/test_discharge_api.py`
- Modify: `homunculus-engine/tests/test_tenant_isolation.py`

- [ ] **Step 1: Write the failing tests**

Create `homunculus-engine/tests/test_care_team_sign_off.py`:

```python
# homunculus-engine/tests/test_care_team_sign_off.py
"""The sign-off makes the attending (G2-B1c, spec D3, §5.3, T1, O45):
- the signer becomes the attending, or the attending the form named; her ATTENDING row is written
  in the sign-off's own transaction, granted by the signer, and a failure writes neither;
- she must be a physician: an administrator signing a DRAFT that names nobody, or a form that
  names a nurse, is refused `care_team_not_physician`, and nothing is written;
- the role group decides, not a care-team key: a unit physician, who assigns nobody, becomes the
  attending she signs for;
- the signer then sees the patient as her own (O45 closed).
Postgres. Synthetic ward: tests/kabul_world.py."""
from __future__ import annotations

import uuid

import pytest_asyncio
from sqlalchemy import select

from homunculus.admission import service
from homunculus.admission.models import Admission, AdmissionState, CareTeamMember, CareTeamRole
from homunculus.admission.service import WorkflowError
from homunculus.scope.service import read_own_patient_ids
from tests.conftest import requires_db
from tests.kabul_world import build_ward, ward_client
from tests.test_care_team_service import add_physician
from tests.test_discharge_api import admit, audited, form, signed

pytestmark = [requires_db]


@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    built = await build_ward(db_session)
    async with ward_client(db_session) as (client, app):
        yield built, client, app


async def _rows(db, admission_id: str) -> list[CareTeamMember]:
    return list((await db.execute(
        select(CareTeamMember).where(CareTeamMember.admission_id == uuid.UUID(admission_id))
        .execution_options(populate_existing=True))).scalars().all())


async def _signature(db, admission_id: str) -> tuple:
    return tuple((await db.execute(
        select(Admission.state, Admission.signed_by, Admission.attending_physician_id)
        .where(Admission.id == uuid.UUID(admission_id)))).one())


async def _admit_naming(w, client, attending: uuid.UUID) -> dict:
    """The Kabul form sent through the API with an attending named (the screen names none)."""
    body = form(w)
    body["note"]["attending_physician_id"] = str(attending)
    r = await client.post("/admissions", json=body, headers=w.auth["nurse"])
    assert r.status_code == 201, r.text
    return r.json()


async def test_the_signer_becomes_the_attending_and_her_row_is_written(ward, db_session):
    w, client, app = ward
    doctor = w.users["doctor"].id
    admission = await admit(w, client)
    r = await client.post(f"/admissions/{admission['id']}/sign-off", headers=w.auth["doctor"])
    assert r.status_code == 200, r.text
    assert r.json()["attending_physician_id"] == r.json()["signed_by"] == str(doctor)
    (row,) = await _rows(db_session, admission["id"])
    assert (row.user_id, row.role, row.is_active, row.granted_by_id) == (
        doctor, CareTeamRole.ATTENDING, True, doctor)
    (signature,) = audited(app, "admission.sign_off")
    assert signature.payload == {"admission_id": admission["id"],
                                 "actor": "doctor@kabul.example.com",
                                 "attending": "doctor@kabul.example.com",
                                 "member_id": str(row.id)}
    (made,) = audited(app, "care_team.attending")
    assert (made.patient_id, made.payload) == (admission["board_key"], {
        "admission_id": admission["id"], "member_id": str(row.id),
        "member": "doctor@kabul.example.com", "via": "sign_off", "ended": [],
        "actor": "doctor@kabul.example.com"})


async def test_the_attending_the_form_names_gets_the_row_and_the_signer_signs(ward, db_session):
    w, client, app = ward
    doctor = w.users["doctor"].id
    named = await add_physician(db_session, w, "adli")
    admission = await _admit_naming(w, client, named)
    r = await client.post(f"/admissions/{admission['id']}/sign-off", headers=w.auth["doctor"])
    assert r.status_code == 200, r.text
    assert (r.json()["attending_physician_id"], r.json()["signed_by"]) == (str(named), str(doctor))
    assert [(m.user_id, m.granted_by_id) for m in await _rows(db_session, admission["id"])] == [
        (named, doctor)]
    assert audited(app, "admission.sign_off")[0].payload["attending"] == "adli@kabul.example.com"


async def test_an_administrator_signing_a_draft_that_names_nobody_is_refused(ward, db_session):
    """T1, §5.3: she would become the attending, and she is no physician. Nothing is written:
    not the signature, not a row, not an audit row."""
    w, client, app = ward
    admission = await admit(w, client)
    r = await client.post(f"/admissions/{admission['id']}/sign-off", headers=w.auth["admin"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "care_team_not_physician")
    assert await _signature(db_session, admission["id"]) == (AdmissionState.DRAFT, None, None)
    assert await _rows(db_session, admission["id"]) == []
    assert audited(app, "admission.sign_off") == audited(app, "care_team.attending") == []


async def test_a_form_naming_a_nurse_as_attending_is_refused_whoever_signs(ward, db_session):
    w, client, _ = ward
    nurse = w.users["nurse"].id
    admission = await _admit_naming(w, client, nurse)
    r = await client.post(f"/admissions/{admission['id']}/sign-off", headers=w.auth["doctor"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "care_team_not_physician")
    assert await _signature(db_session, admission["id"]) == (AdmissionState.DRAFT, None, nurse)
    assert await _rows(db_session, admission["id"]) == []


async def test_a_failure_writing_the_row_writes_no_signature_either(ward, db_session, monkeypatch):
    """§5.3: one transaction. The row's write fails after the signature's; neither stands."""
    w, client, app = ward
    admission = await admit(w, client)

    async def broken(*args, **kwargs):
        raise WorkflowError("Sentetik arıza")

    monkeypatch.setattr(service, "set_attending", broken)
    r = await client.post(f"/admissions/{admission['id']}/sign-off", headers=w.auth["doctor"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "invalid_transition")
    assert await _signature(db_session, admission["id"]) == (AdmissionState.DRAFT, None, None)
    assert await _rows(db_session, admission["id"]) == []
    assert audited(app, "admission.sign_off") == []


async def test_a_unit_physician_becomes_the_attending_she_signs_for(ward, db_session):
    """T1 reads the ROLE group, not a care-team key: `unit_physician` holds neither key."""
    w, client, _ = ward
    unit = await add_physician(db_session, w, "unite", group="unit_physician")
    admission = await admit(w, client)
    r = await client.post(f"/admissions/{admission['id']}/sign-off", headers=w.auth["unite"])
    assert r.status_code == 200, r.text
    assert [(m.user_id, m.role) for m in await _rows(db_session, admission["id"])] == [
        (unit, CareTeamRole.ATTENDING)]


async def test_the_signer_then_sees_the_patient_as_her_own(ward, db_session):
    """O45 closed: the row is what the board's own-patient rule reads (scope/service.py)."""
    w, client, _ = ward
    doctor, tenant = w.users["doctor"].id, w.tenant.id
    admission = await signed(w, client)
    assert admission["board_key"] in await read_own_patient_ids(db_session, doctor, tenant)
```

In `homunculus-engine/tests/test_discharge_api.py`:

1. Replace `from homunculus.admission.models import Admission, AdmissionState, DischargeDisposition` with

```python
from homunculus.admission.models import (
    Admission, AdmissionState, CareTeamMember, DischargeDisposition,
)
```

2. Replace the test

```python
async def test_the_physician_who_signs_a_draft_becomes_its_attending(ward):
    w, client, app = ward
    admission = await admit(w, client)
    r = await client.post(f"/admissions/{admission['id']}/sign-off", headers=w.auth["doctor"])
    assert r.status_code == 200, r.text
    assert r.json()["state"] == "ACTIVE"
    assert r.json()["attending_physician_id"] == r.json()["signed_by"] == str(w.users["doctor"].id)
    (row,) = audited(app, "admission.sign_off")
    assert (row.patient_id, row.payload) == (admission["board_key"],
                                             {"admission_id": admission["id"],
                                              "actor": "doctor@kabul.example.com"})
```

with

```python
async def test_the_physician_who_signs_a_draft_becomes_its_attending(ward, db_session):
    w, client, app = ward
    doctor = w.users["doctor"].id
    admission = await admit(w, client)
    r = await client.post(f"/admissions/{admission['id']}/sign-off", headers=w.auth["doctor"])
    assert r.status_code == 200, r.text
    assert r.json()["state"] == "ACTIVE"
    assert r.json()["attending_physician_id"] == r.json()["signed_by"] == str(doctor)
    # G2-B1c (D3, §5.3): the row the signature writes, named in the sign-off's audit row.
    member_id = (await db_session.execute(select(CareTeamMember.id).where(
        CareTeamMember.admission_id == uuid.UUID(admission["id"])))).scalar_one()
    (row,) = audited(app, "admission.sign_off")
    assert (row.patient_id, row.payload) == (admission["board_key"],
                                             {"admission_id": admission["id"],
                                              "actor": "doctor@kabul.example.com",
                                              "attending": "doctor@kabul.example.com",
                                              "member_id": str(member_id)})
```

In `homunculus-engine/tests/test_tenant_isolation.py`:

1. In `class Side`, replace

```python
    member: uuid.UUID     # a nurse of this tenant
```

with

```python
    member: uuid.UUID     # a nurse of this tenant
    doctor: uuid.UUID     # G2-B1c: a physician (`attending`), the admission's attending (D3, T1)
```

2. In `_hospital`, replace

```python
    nurse = await add_user(db, username=f"nurse@{slug}.example.com", tenant_id=tenant.id,
                           group=groups["nurse"])
```

with

```python
    nurse = await add_user(db, username=f"nurse@{slug}.example.com", tenant_id=tenant.id,
                           group=groups["nurse"])
    # G2-B1c (T1): an admission's attending is a physician; the administrator is not one.
    doctor = await add_user(db, username=f"doctor@{slug}.example.com", tenant_id=tenant.id,
                            group=groups["attending"])
```

then replace `                     "attending_physician_id": admin.id,` with `                     "attending_physician_id": doctor.id,`, and replace `                member=nurse.id), admin` with `                member=nurse.id, doctor=doctor.id), admin`.

3. Replace the test `test_a_draft_admission_is_signed_off_by_the_callers_own_attending`. In it:
   - rename the function to `test_a_draft_admission_is_signed_off_with_the_callers_own_physician_as_attending`;
   - replace `                     "attending_physician_id": world.caller.id,` with `                     "attending_physician_id": world.a.doctor,`;
   - replace its last line, `    assert r.json()["state"] == "ACTIVE" and r.json()["signed_by"] == str(world.caller.id)`, with

```python
    assert r.json()["state"] == "ACTIVE" and r.json()["signed_by"] == str(world.caller.id)
    # G2-B1c (T1): the administrator signs; the physician the draft names is the attending.
    assert r.json()["attending_physician_id"] == str(world.a.doctor)
```

- [ ] **Step 2: Run them and see them red**

```bash
cd /c/tmp/g2b-b1c/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_care_team_sign_off.py 2>&1 | tail -4
```

Expected: 7 failed.
- The four tests that read a row (the signer's, the form-named attending's, the unit physician's, the own patient's) find none: the old sign-off writes no row (O45).
- The two refusal tests get `200` instead of `409`.
- The rollback test gets `200`: the old sign-off never calls `set_attending`.

Then run `tests/test_discharge_api.py -k becomes_its_attending` (the Postgres command, one call). Expected: 1 failed (no `attending` key in the audit row).

- [ ] **Step 3: The sign-off**

In `homunculus-engine/src/homunculus/admission/router.py`:

1. Replace the errors import

```python
from homunculus.admission.errors import (
    BED_CLOSED, BED_RESERVED, DUPLICATE_OPEN_ADMISSION, INVALID_TRANSITION, NO_PROTOCOL,
    REQUEST_CONFLICT, TRANSFER_UNAVAILABLE, Refusal, field_invalid,
)
```

with

```python
from homunculus.admission.errors import (
    BED_CLOSED, BED_RESERVED, CARE_TEAM_NOT_PHYSICIAN, DUPLICATE_OPEN_ADMISSION,
    INVALID_TRANSITION, NO_PROTOCOL, REQUEST_CONFLICT, TRANSFER_UNAVAILABLE, Refusal,
    field_invalid,
)
```

2. Replace (the end of G2-B3b's `_board_summary`, which now stands between `_open_critical` and the sign-off, and the sign-off section's header)

```python
    return link.handover_summary(hospital, key)


# ---------------------------------------------------------------------------
# Sign-off DRAFT → ACTIVE (§4.1 steps 4–5)
```

with

```python
    return link.handover_summary(hospital, key)


async def _people(db: AsyncSession, *ids: uuid.UUID | None) -> dict[uuid.UUID, tuple[str, str]]:
    """G2-B1c (§5.2, §5.5): the users `ids` name, as (user name, full name): the audit's names and
    the answers'. Staff, never a patient."""
    wanted = {i for i in ids if i is not None}
    if not wanted:
        return {}
    rows = await db.execute(select(User.id, User.username, User.full_name)
                            .where(User.id.in_(wanted)))
    return {uid: (username, full_name) for uid, username, full_name in rows.all()}


def _not_physician() -> HTTPException:
    """G2-B1c (T1): the member, the claimer, or the attending a sign-off would make is not a
    physician."""
    return Refusal(409, CARE_TEAM_NOT_PHYSICIAN, "Only a physician is on a care team.").http()


# ---------------------------------------------------------------------------
# Sign-off DRAFT → ACTIVE (§4.1 steps 4–5)
```

3. In `sign_off`, replace everything from its docstring to its `return written`:

```python
    """G2-B1a (spec §3.2): the physician who signs a DRAFT with no attending becomes its
    attending — no physician picker in this slice (and no care-team row: O45). The bed must be in
    her units. The answer is made before the commit from what was written; after it, only the
    audit row `admission.sign_off`, which never raises (A-26)."""
    admission = await _get_admission_or_404(db, admission_id, caller_tenant)
    await _reach_admission(db, user.id, caller_tenant, admission)
    admission = await _locked(db, admission)
    if admission.state == AdmissionState.DRAFT and admission.attending_physician_id is None:
        admission.attending_physician_id = user.id
    try:
        await service.sign_off_admission(db, admission, signing_user_id=user.id)
    except WorkflowError as exc:
        raise _wf(exc)
    except ValueError as exc:
        raise _not_now(exc) from None
    key = await _key_of(db, admission)
    hospital = await trail.hospital_of(db, caller_tenant)
    written, actor = AdmissionResponse.model_validate(admission), user.username
    await db.commit()
    trail.record(request, hospital, "admission.sign_off", patient_id=key,
                 payload={"admission_id": str(written.id), "actor": actor})
    return written
```

with

```python
    """G2-B1a (spec §3.2), G2-B1c (spec D3, §5.3, O45 closed): a physician signs a DRAFT in her
    units. Its attending is the one the form named, else the signer. She must be a physician
    (T1); if not, 409 `care_team_not_physician` and nothing is written, so an administrator
    cannot sign a DRAFT that names nobody. In one transaction the admission becomes ACTIVE and the
    attending's ATTENDING row is written (`service.set_attending`, granted by the signer); a
    failure of either writes neither. The state is read under the locks first: a second signature
    is `invalid_transition` before anything else is asked. After the commit, the audit rows
    `admission.sign_off` (with the attending's user name and her row) and `care_team.attending`
    (via `sign_off`); neither raises (A-26)."""
    admission = await _get_admission_or_404(db, admission_id, caller_tenant)
    await _reach_admission(db, user.id, caller_tenant, admission)
    signer, actor = user.id, user.username
    admission = await _locked(db, admission)
    if admission.state != AdmissionState.DRAFT:
        raise _wf(WorkflowError(
            f"Only a DRAFT admission can be signed off (current: {admission.state.value})."))
    attending = admission.attending_physician_id or signer
    if not await service.is_physician(db, caller_tenant, attending):
        raise _not_physician()
    admission.attending_physician_id = attending
    try:
        await service.sign_off_admission(db, admission, signing_user_id=signer)
        member, ended = await service.set_attending(db, admission, user_id=attending,
                                                    granted_by_id=signer)
    except WorkflowError as exc:
        raise _wf(exc)
    except ValueError as exc:
        raise _not_now(exc) from None
    key = await _key_of(db, admission)
    hospital = await trail.hospital_of(db, caller_tenant)
    named = (await _people(db, attending))[attending][0]
    written, member_id = AdmissionResponse.model_validate(admission), member.id
    await db.commit()
    trail.record(request, hospital, "admission.sign_off", patient_id=key,
                 payload={"admission_id": str(written.id), "actor": actor, "attending": named,
                          "member_id": str(member_id)})
    trail.record(request, hospital, "care_team.attending", patient_id=key,
                 payload={"admission_id": str(written.id), "member_id": str(member_id),
                          "member": named, "via": "sign_off", "ended": [str(i) for i in ended],
                          "actor": actor})
    return written
```

- [ ] **Step 4: Run them and see them green**

Same command as Step 2. Expected: `7 passed`. Then each of these as its own Bash call, with the Postgres command of Task 0, Step 7:
- `tests/test_discharge_api.py`
- `tests/test_protocol_board_key.py`
- `tests/test_occupancy_read.py`
- `tests/test_tenant_isolation.py`, with `run_in_background: true`; wait for its notification.

Expected: all passed.

`test_two_signatures_at_once_sign_once` still passes: the second signer (the administrator) waits on the locks, reads ACTIVE, and is refused `invalid_transition` before anyone asks whether she is a physician.

- [ ] **Step 5: Line ends, then commit**

```bash
cd /c/tmp/g2b-b1c && /c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" homunculus-engine/tests/test_care_team_sign_off.py
for f in homunculus-engine/src/homunculus/admission/router.py homunculus-engine/tests/test_care_team_sign_off.py homunculus-engine/tests/test_discharge_api.py homunculus-engine/tests/test_tenant_isolation.py; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- homunculus-engine/src/homunculus/admission/router.py homunculus-engine/tests/test_care_team_sign_off.py homunculus-engine/tests/test_discharge_api.py homunculus-engine/tests/test_tenant_isolation.py
git status --short && git diff --cached --stat
git commit -m "feat(admission): the physician who signs becomes the attending, her row written in the same transaction (G2-B1c, D3, §5.3, T1, O45)" -m "The attending is the form's, else the signer, and must be a physician; an administrator cannot sign a DRAFT that names nobody. The state is read first under the locks. The sign-off's audit row gains the attending's user name and her row; care_team.attending (via sign_off) is written beside it. The isolation world's admission names a physician. Red: no row after a sign-off; 200 for a non-physician signer." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/src/homunculus/admission/router.py homunculus-engine/tests/test_care_team_sign_off.py homunculus-engine/tests/test_discharge_api.py homunculus-engine/tests/test_tenant_isolation.py
```

---

### Task 7: The team read by name, and the picker's candidates (spec §5.2, D8, T1; X4, X10)

**Files:**
- Modify: `homunculus-engine/src/homunculus/admission/schemas.py`
- Modify: `homunculus-engine/src/homunculus/admission/router.py`
- Modify: `deploy/local/web/nginx.conf`
- Create: `homunculus-engine/tests/test_care_team_reads.py`
- Modify: `homunculus-engine/tests/test_route_permissions.py`
- Modify: `homunculus-engine/tests/test_tenant_isolation.py`

- [ ] **Step 1: Write the failing tests**

Create `homunculus-engine/tests/test_care_team_reads.py`:

```python
# homunculus-engine/tests/test_care_team_reads.py
"""The care team read (G2-B1c, spec §5.2, D6, D8, T1; X4, X10):
- `GET …/care-team`: every row, the active ones first and each group newest first, by name, with
  who added her, when it ended, and whether it is in force; never the patient's name. For a caller
  whose units hold the bed, or who holds an active row here herself; anyone else 403
  `out_of_scope`;
- `GET …/care-team/candidates`: every physician of the tenant from every unit, active accounts and
  memberships only, by name and nothing else, sorted by name. A member whose row is in force is
  left out; an expired on-call member is offered again (T8, X4). The assigner's, in her units.
Postgres. Synthetic ward: tests/kabul_world.py."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest_asyncio
from sqlalchemy import update

from homunculus.admission import service
from homunculus.admission.models import Admission, CareTeamRole
from homunculus.auth.models import TenantMembership, User
from tests.conftest import requires_db
from tests.kabul_world import build_ward, ward_client
from tests.test_care_team_service import add_physician, physician_elsewhere
from tests.test_discharge_api import signed

pytestmark = [requires_db]
HOUR = timedelta(hours=1)


@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    built = await build_ward(db_session)
    async with ward_client(db_session) as (client, app):
        yield built, client, app


async def test_the_team_is_read_by_name_active_first_and_newest_first(ward, db_session):
    w, client, _ = ward
    doctor = w.users["doctor"].id
    helper = await add_physician(db_session, w, "yardimci")
    late = await add_physician(db_session, w, "nobetci")
    admission = await signed(w, client)                    # the doctor's ATTENDING row (Task 6)
    aid = uuid.UUID(admission["id"])
    adm = await db_session.get(Admission, aid)
    now = datetime.now(timezone.utc)
    gone = await service.add_care_team_member(db_session, adm, user_id=helper,
                                              role=CareTeamRole.ASSOCIATE_PHYSICIAN,
                                              granted_by_id=doctor)
    await service.end_care_team_member(db_session, gone, now=now)
    await service.add_care_team_member(db_session, adm, user_id=helper,
                                       role=CareTeamRole.ASSOCIATE_PHYSICIAN, granted_by_id=doctor)
    await service.add_care_team_member(db_session, adm, user_id=late,
                                       role=CareTeamRole.ONCALL_PHYSICIAN, granted_by_id=doctor,
                                       window_start=now - 10 * HOUR, window_end=now - 2 * HOUR)
    await db_session.commit()
    r = await client.get(f"/admissions/{aid}/care-team", headers=w.auth["nurse"])
    assert r.status_code == 200, r.text
    got = [(m["full_name"], m["role"], m["is_active"], m["in_force"], m["granted_by_name"],
            m["closed_at"] is not None) for m in r.json()]
    assert got == [
        ("nobetci", "ONCALL_PHYSICIAN", True, False, "doctor", False),      # expired: not in force
        ("yardimci", "ASSOCIATE_PHYSICIAN", True, True, "doctor", False),
        ("doctor", "ATTENDING", True, True, "doctor", False),
        ("yardimci", "ASSOCIATE_PHYSICIAN", False, False, "doctor", True),
    ]
    assert "Sentetik" not in r.text                                         # no patient's name


async def test_a_member_outside_her_units_reads_the_team_she_is_on_and_no_other(ward, db_session):
    """§5.2, D6, X10: an active row opens the team's read to her; her units do not."""
    w, client, _ = ward
    doctor = w.users["doctor"].id
    oncall = await add_physician(db_session, w, "nobetci", unit="neo")
    await add_physician(db_session, w, "komsu", unit="neo")
    admission = await signed(w, client)
    aid = uuid.UUID(admission["id"])
    url = f"/admissions/{aid}/care-team"
    r = await client.get(url, headers=w.auth["nobetci"])
    assert (r.status_code, r.json()["detail"]["code"]) == (403, "out_of_scope")
    adm = await db_session.get(Admission, aid)
    now = datetime.now(timezone.utc)
    await service.add_care_team_member(db_session, adm, user_id=oncall,
                                       role=CareTeamRole.ONCALL_PHYSICIAN, granted_by_id=doctor,
                                       window_start=now - HOUR, window_end=now + HOUR)
    await db_session.commit()
    assert (await client.get(url, headers=w.auth["nobetci"])).status_code == 200
    r = await client.get(url, headers=w.auth["komsu"])
    assert (r.status_code, r.json()["detail"]["code"]) == (403, "out_of_scope")


async def test_the_picker_offers_every_physician_of_the_tenant_by_name_and_nobody_else(
        ward, db_session):
    """D8, T1, X4: from every unit (and from none), physicians only, active ones, this tenant's;
    `user_id` and `full_name` and nothing else, by name. The attending and an associate in force
    are left out; the physician whose on-call window passed is offered again."""
    w, client, _ = ward
    doctor = w.users["doctor"].id
    unit = await add_physician(db_session, w, "unite", group="unit_physician")
    far = await add_physician(db_session, w, "uzak", unit="neo")
    loose = await add_physician(db_session, w, "atamasiz", unit=None)
    late = await add_physician(db_session, w, "gecmis")
    gone = await add_physician(db_session, w, "ayrilan")
    left = await add_physician(db_session, w, "uyeligi-biten")
    await physician_elsewhere(db_session)
    await db_session.execute(update(User).where(User.id == gone).values(is_active=False))
    await db_session.execute(update(TenantMembership).where(TenantMembership.user_id == left)
                             .values(is_active=False))
    await db_session.commit()
    admission = await signed(w, client)
    aid = uuid.UUID(admission["id"])
    adm = await db_session.get(Admission, aid)
    now = datetime.now(timezone.utc)
    await service.add_care_team_member(db_session, adm, user_id=late,
                                       role=CareTeamRole.ONCALL_PHYSICIAN, granted_by_id=doctor,
                                       window_start=now - 10 * HOUR, window_end=now - 2 * HOUR)
    await service.add_care_team_member(db_session, adm, user_id=unit,
                                       role=CareTeamRole.ASSOCIATE_PHYSICIAN, granted_by_id=doctor)
    await db_session.commit()
    r = await client.get(f"/admissions/{aid}/care-team/candidates", headers=w.auth["doctor"])
    assert r.status_code == 200, r.text
    assert r.json() == [{"user_id": str(loose), "full_name": "atamasiz"},
                        {"user_id": str(late), "full_name": "gecmis"},
                        {"user_id": str(far), "full_name": "uzak"}]


async def test_the_picker_is_the_assigners_and_only_in_her_units(ward, db_session):
    w, client, _ = ward
    await add_physician(db_session, w, "uzak-sorumlu", group="attending", unit="neo")
    admission = await signed(w, client)
    url = f"/admissions/{admission['id']}/care-team/candidates"
    r = await client.get(url, headers=w.auth["nurse"])
    assert (r.status_code, r.json()["detail"]) == (403, "permission required: care_team.assign")
    r = await client.get(url, headers=w.auth["uzak-sorumlu"])
    assert (r.status_code, r.json()["detail"]["code"]) == (403, "out_of_scope")
```

In `homunculus-engine/tests/test_route_permissions.py`:
- after the row `    ("POST", "/admissions/{admission_id}/care-team"): ANY("care_team.assign"),` add
  ```python
      ("GET", "/admissions/{admission_id}/care-team/candidates"): ANY("care_team.assign"),   # G2-B1c (D8)
  ```
- replace `    assert len(EXPECTED) == 72      # G2-B3a: +4, the bed moves; +1, GET /tenant/occupancy; G2-B3b: + GET /handovers, GET /handovers/colleagues` with
  ```python
      assert len(EXPECTED) == 73      # G2-B3a: +5 (the bed moves, the occupancy read); G2-B3b: +2 (my handovers, colleagues); G2-B1c: +1, the picker
  ```

In `homunculus-engine/tests/test_tenant_isolation.py`, after the `"care-team add"` entry of `BY_ID` (it ends `lambda a: {"user_id": a.member, "role": "ASSOCIATE_PHYSICIAN"}, 201),`), add:

```python
    # G2-B1c (D8): the picker's candidates; the caller's own admission is read (200).
    "care-team candidates": ById("GET", lambda s: f"/admissions/{s.admission}/care-team/candidates"),
```

- [ ] **Step 2: Run them and see them red**

```bash
cd /c/tmp/g2b-b1c/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_care_team_reads.py 2>&1 | tail -4
```

Expected: 4 failed.
- The rows carry no `full_name` (`KeyError`).
- The outsider gets `200`: the old `GET` checks the tenant only.
- The candidates route answers `404` / `405`.

Then `tests/test_route_permissions.py` (the Postgres command, one call). Expected: the size pin and `test_no_table_entry_lacks_a_route` fail.

- [ ] **Step 3: The answers' shapes**

In `homunculus-engine/src/homunculus/admission/schemas.py`:

1. Replace (G2-B3b added `model_validator`)

```python
from pydantic import (
    AfterValidator, BaseModel, ConfigDict, Field, StrictBool, ValidationInfo, field_validator,
    model_validator,
)
```

with

```python
from pydantic import (
    AfterValidator, AwareDatetime, BaseModel, ConfigDict, Field, StrictBool, ValidationInfo,
    field_validator, model_validator,
)
```

2. Replace the care-team section

```python
class CareTeamAdd(BaseModel):
    user_id: uuid.UUID
    role: CareTeamRole
    window_start: datetime | None = None   # required for ONCALL_PHYSICIAN
    window_end: datetime | None = None


class CareTeamMemberResponse(BaseModel):
    id: uuid.UUID
    admission_id: uuid.UUID
    user_id: uuid.UUID
    role: CareTeamRole
    granted_by_id: uuid.UUID | None
    window_start: datetime | None
    window_end: datetime | None
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}
```

with

```python
class CareTeamAdd(BaseModel):
    """POST …/care-team (G2-B1c, §5.2): a physician of the tenant and her role. An on-call row
    needs a window (the route's rules: its end after its start, in the future, at most 48 hours
    after it); any other role takes none. The two ends carry their offset (X9): a naive time is a
    422, never compared with the server's clock. An unknown field is refused, as B1a's forms are."""
    model_config = ConfigDict(extra="forbid")

    user_id: uuid.UUID
    role: CareTeamRole
    window_start: AwareDatetime | None = None   # required for ONCALL_PHYSICIAN
    window_end: AwareDatetime | None = None


class CareTeamMemberResponse(BaseModel):
    """One care-team row (G2-B1c, §5.2): who, as what, from and until when, who added her, and
    when it ended. People are named by `users.full_name`: staff, never a patient. `in_force`:
    active and, for an on-call row, inside its window; this is what the board's own-patient rule
    grants on."""
    id: uuid.UUID
    admission_id: uuid.UUID
    user_id: uuid.UUID
    full_name: str
    role: CareTeamRole
    granted_by_id: uuid.UUID | None
    granted_by_name: str | None
    window_start: datetime | None
    window_end: datetime | None
    is_active: bool
    in_force: bool
    created_at: datetime
    closed_at: datetime | None


class CareTeamCandidate(BaseModel):
    """GET …/care-team/candidates (G2-B1c, D8): a physician the picker offers, by her id and her
    name and nothing else."""
    user_id: uuid.UUID
    full_name: str
```

- [ ] **Step 4: The reads**

In `homunculus-engine/src/homunculus/admission/router.py`:

1. In the schemas import, replace (G2-B3b added `Colleague` and the handover shapes)

```python
    AlertRetire, CareTeamAdd, CareTeamMemberResponse, Colleague, DischargeConfirmResponse,
```

with

```python
    AlertRetire, CareTeamAdd, CareTeamCandidate, CareTeamMemberResponse, Colleague,
    DischargeConfirmResponse,
```

The next line, `    DischargeStart, EngineWrite, EngineWrites, HandoverNote, HandoverNoteOut, HandoverOpen,`, stays as it is.

2. Replace the whole care-team section, from its header to the end of `list_care_team`:

```python
# ---------------------------------------------------------------------------
# Care team (§4.2–4.3)
# ---------------------------------------------------------------------------
@router.post("/{admission_id}/care-team/claim", response_model=CareTeamMemberResponse)
async def claim_attending(
    admission_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("care_team.claim")),
    caller_tenant: uuid.UUID = _tenant,
):
    admission = await _get_admission_or_404(db, admission_id, caller_tenant)
    # The caller becomes the attending of record. There is no claiming on someone else's
    # behalf here: adding another clinician goes through POST .../care-team (care_team.assign).
    member = await service.claim_attending(
        db, admission, attending_id=user.id, granted_by_id=user.id,
    )
    await db.commit()
    await db.refresh(member)
    return member


@router.post("/{admission_id}/care-team", response_model=CareTeamMemberResponse, status_code=201)
async def add_care_team_member(
    admission_id: uuid.UUID,
    payload: CareTeamAdd,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("care_team.assign")),
    caller_tenant: uuid.UUID = _tenant,
):
    admission = await _get_admission_or_404(db, admission_id, caller_tenant)
    await scope.ensure_members(db, caller_tenant, [payload.user_id])
    try:
        member = await service.add_care_team_member(
            db, admission, user_id=payload.user_id, role=payload.role,
            granted_by_id=user.id, window_start=payload.window_start,
            window_end=payload.window_end,
        )
    except WorkflowError as exc:
        raise _wf(exc)
    await db.commit()
    await db.refresh(member)
    return member


@router.get("/{admission_id}/care-team", response_model=list[CareTeamMemberResponse],
            dependencies=[Depends(require_permission("admissions.view"))])
async def list_care_team(
    admission_id: uuid.UUID, db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = _tenant,
):
    await _get_admission_or_404(db, admission_id, caller_tenant)
    result = await db.execute(
        select(CareTeamMember).where(CareTeamMember.admission_id == admission_id)
    )
    return list(result.scalars().all())
```

with

```python
# ---------------------------------------------------------------------------
# Care team (§4.2–4.3; Group 2 · B1c, spec §5.2)
# ---------------------------------------------------------------------------
def _member_out(member: CareTeamMember, people: dict, now: datetime) -> CareTeamMemberResponse:
    """G2-B1c (§5.2): a row as the box shows it, its people by name (`_people`) and whether it is
    in force now (`service.in_force`)."""
    by = people.get(member.granted_by_id) if member.granted_by_id is not None else None
    return CareTeamMemberResponse(
        id=member.id, admission_id=member.admission_id, user_id=member.user_id,
        full_name=people[member.user_id][1], role=member.role,
        granted_by_id=member.granted_by_id, granted_by_name=by[1] if by else None,
        window_start=member.window_start, window_end=member.window_end,
        is_active=member.is_active, in_force=service.in_force(member, now),
        created_at=member.created_at, closed_at=member.closed_at)


@router.post("/{admission_id}/care-team/claim", response_model=CareTeamMemberResponse)
async def claim_attending(
    admission_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("care_team.claim")),
    caller_tenant: uuid.UUID = _tenant,
):
    admission = await _get_admission_or_404(db, admission_id, caller_tenant)
    # The caller becomes the attending of record. There is no claiming on someone else's
    # behalf here: adding another clinician goes through POST .../care-team (care_team.assign).
    member = await service.claim_attending(
        db, admission, attending_id=user.id, granted_by_id=user.id,
    )
    answer = _member_out(member, await _people(db, member.user_id), _now())
    await db.commit()
    return answer


@router.post("/{admission_id}/care-team", response_model=CareTeamMemberResponse, status_code=201)
async def add_care_team_member(
    admission_id: uuid.UUID,
    payload: CareTeamAdd,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("care_team.assign")),
    caller_tenant: uuid.UUID = _tenant,
):
    admission = await _get_admission_or_404(db, admission_id, caller_tenant)
    await scope.ensure_members(db, caller_tenant, [payload.user_id])
    try:
        member = await service.add_care_team_member(
            db, admission, user_id=payload.user_id, role=payload.role,
            granted_by_id=user.id, window_start=payload.window_start,
            window_end=payload.window_end,
        )
    except WorkflowError as exc:
        raise _wf(exc)
    answer = _member_out(member, await _people(db, member.user_id, user.id), _now())
    await db.commit()
    return answer


@router.get("/{admission_id}/care-team", response_model=list[CareTeamMemberResponse])
async def list_care_team(
    admission_id: uuid.UUID, db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("admissions.view")),
    caller_tenant: uuid.UUID = _tenant,
):
    """G2-B1c (§5.2): every row of the admission's team, the active ones first and each group
    newest first, by name. For a caller whose units hold the bed, or who holds an active row on
    this admission herself (an on-call colleague from another unit reads the team she is on: D6,
    X10); anyone else 403 `out_of_scope`."""
    admission = await _get_admission_or_404(db, admission_id, caller_tenant)
    me = user.id
    if not any(m.user_id == me for m in await service.active_rows(db, admission.id)):
        await _reach_admission(db, me, caller_tenant, admission)
    rows = list((await db.execute(
        select(CareTeamMember).where(CareTeamMember.admission_id == admission.id)
        .order_by(CareTeamMember.is_active.desc(), CareTeamMember.created_at.desc(),
                  CareTeamMember.id))).scalars().all())
    people = await _people(db, *(m.user_id for m in rows), *(m.granted_by_id for m in rows))
    now = _now()
    return [_member_out(m, people, now) for m in rows]


@router.get("/{admission_id}/care-team/candidates", response_model=list[CareTeamCandidate])
async def care_team_candidates(
    admission_id: uuid.UUID, db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("care_team.assign")),
    caller_tenant: uuid.UUID = _tenant,
):
    """G2-B1c (§5.2, D8): whom «Ekibe ekle» offers. Every physician of the tenant (T1), from every
    unit: an on-call colleague of another unit is the one the own-patient rule matters most for.
    Left out: a physician whose active row here is in force or still to come. An EXPIRED on-call
    row does not count, because the add renews it (T8, X4). Names only, sorted by name. Reach as
    for the writes."""
    admission = await _get_admission_or_404(db, admission_id, caller_tenant)
    await _reach_admission(db, user.id, caller_tenant, admission)
    now = _now()
    taken = {m.user_id for m in await service.active_rows(db, admission.id)
             if not service.expired(m, now)}
    rows = (await db.execute(
        select(User.id, User.full_name)
        .where(User.id.in_(service.physician_ids(caller_tenant)))
        .order_by(User.full_name, User.id))).all()
    return [CareTeamCandidate(user_id=uid, full_name=name) for uid, name in rows
            if uid not in taken]
```

3. In `deploy/local/web/nginx.conf`, in the `map $uri $homunculus_log_uri` block, replace `care-team|care-team/claim|` with `care-team|care-team/candidates|care-team/claim|` in the line that starts `    ~^/admissions/[^/]+/(?<act>care-team`. The line keeps its other alternatives and its value `/admissions/:id/$act;`.

- [ ] **Step 5: Run them and see them green**

Same command as Step 2. Expected: `4 passed`. Then, each as its own call:
- `tests/test_route_permissions.py` (Postgres command): all passed;
- `tests/test_tenant_isolation.py` (Postgres command, `run_in_background: true`; wait for its notification): all passed;
- the no-DB file `tests/test_access_log_redaction.py`: all passed (it would name `/admissions/{admission_id}/care-team/candidates` if the log map missed it).

- [ ] **Step 6: Line ends, then commit**

```bash
cd /c/tmp/g2b-b1c && /c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" homunculus-engine/tests/test_care_team_reads.py
for f in homunculus-engine/src/homunculus/admission/schemas.py homunculus-engine/src/homunculus/admission/router.py deploy/local/web/nginx.conf homunculus-engine/tests/test_care_team_reads.py homunculus-engine/tests/test_route_permissions.py homunculus-engine/tests/test_tenant_isolation.py; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- homunculus-engine/src/homunculus/admission/schemas.py homunculus-engine/src/homunculus/admission/router.py deploy/local/web/nginx.conf homunculus-engine/tests/test_care_team_reads.py homunculus-engine/tests/test_route_permissions.py homunculus-engine/tests/test_tenant_isolation.py
git status --short && git diff --cached --stat
git commit -m "feat(admission): the care team read by name, for her units or her own team, and the picker's candidates from every unit (G2-B1c, §5.2, D6, D8, T1, X4, X10)" -m "Every care-team answer names its people and says whether the row is in force. GET opens to the caller's units or to an active member; the candidates are the tenant's physicians, names only, without those in force here. The nginx log map names the new route. Red: no full_name; 200 for an outsider; 404 for the candidates." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/src/homunculus/admission/schemas.py homunculus-engine/src/homunculus/admission/router.py deploy/local/web/nginx.conf homunculus-engine/tests/test_care_team_reads.py homunculus-engine/tests/test_route_permissions.py homunculus-engine/tests/test_tenant_isolation.py
```

---

### Task 8: The writes — claim, add, end (spec §5.2, §5.5, T1–T5, T7, T8; X4, X5, X9)

**Files:**
- Modify: `homunculus-engine/src/homunculus/admission/router.py`
- Modify: `homunculus-engine/src/homunculus/admission/service.py`
- Modify: `deploy/local/web/nginx.conf`
- Create: `homunculus-engine/tests/test_care_team_api.py`
- Modify: `homunculus-engine/tests/test_route_permissions.py`
- Modify: `homunculus-engine/tests/test_tenant_isolation.py`
- Modify: `homunculus-engine/tests/test_admission_workflow.py`

- [ ] **Step 1: Write the failing tests**

Create `homunculus-engine/tests/test_care_team_api.py`:

```python
# homunculus-engine/tests/test_care_team_api.py
"""The care team's writes (G2-B1c, spec §5.2, §5.5, §5.6; D2, D4, D5, T1–T5, T7, T8; X4, X5, X9):
- claim: a physician of the unit becomes the attending, and the previous one steps down;
- add: a physician of the tenant, as associate, on-call (a window of at most 48 hours, ending in
  the future) or attending; an expired on-call row is renewed, never refused;
- end: an assigner ends a row in her units, a member ends her own from anywhere, and the
  attending's row never ends alone;
- each write checks reach, takes the locks, needs an ACTIVE or PENDING_DISCHARGE admission, and is
  audited after its commit: staff by user name, the patient never by name;
- a duplicate, or a writer that meets an index, is a coded 409, never a 500.
Postgres. Synthetic ward: tests/kabul_world.py, with physicians added (`add_physician`)."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy import select, update

from homunculus.admission import service
from homunculus.admission.models import Admission, AdmissionState, CareTeamMember, CareTeamRole
from tests.conftest import requires_db
from tests.kabul_world import SLUG, build_ward, ward_client
from tests.test_care_team_service import add_physician, team_of
from tests.test_discharge_api import at_once, audited, signed

pytestmark = [requires_db]
HOUR = timedelta(hours=1)
ATT, ASSOC, ONCALL = (CareTeamRole.ATTENDING, CareTeamRole.ASSOCIATE_PHYSICIAN,
                      CareTeamRole.ONCALL_PHYSICIAN)


@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    built = await build_ward(db_session)
    async with ward_client(db_session) as (client, app):
        yield built, client, app


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def _window(start: datetime, hours: float) -> dict:
    return {"window_start": start.isoformat(),
            "window_end": (start + timedelta(hours=hours)).isoformat()}


async def _row_of(db, admission_id: uuid.UUID, user_id: uuid.UUID) -> uuid.UUID:
    """The id of `user_id`'s ACTIVE row on the admission."""
    return (await db.execute(select(CareTeamMember.id).where(
        CareTeamMember.admission_id == admission_id, CareTeamMember.user_id == user_id,
        CareTeamMember.is_active.is_(True)))).scalar_one()


async def _attending(db, admission_id: uuid.UUID):
    return (await db.execute(select(Admission.attending_physician_id)
                             .where(Admission.id == admission_id))).scalar_one()


async def _expired_on_call(db, admission_id: uuid.UUID, user_id: uuid.UUID,
                           by: uuid.UUID) -> uuid.UUID:
    """An on-call row whose window passed two hours ago."""
    admission = await db.get(Admission, admission_id)
    now = _now()
    row = await service.add_care_team_member(db, admission, user_id=user_id, role=ONCALL,
                                             granted_by_id=by, window_start=now - 10 * HOUR,
                                             window_end=now - 2 * HOUR)
    row_id = row.id
    await db.commit()
    return row_id


async def _add(client, w, aid, user_id, role="ASSOCIATE_PHYSICIAN", who="doctor", **window):
    return await client.post(f"/admissions/{aid}/care-team",
                             json={"user_id": str(user_id), "role": role, **window},
                             headers=w.auth[who])


# ---------------------------------------------------------------- claim
async def test_a_physician_claims_and_the_previous_attending_steps_down(ward, db_session):
    """D4, T4: the claim ends the previous attending's row, names the claimer on the admission and
    writes her row; `care_team.attending` says so by user name (§5.5)."""
    w, client, app = ward
    doctor = w.users["doctor"].id
    second = await add_physician(db_session, w, "doctor2", group="attending")
    admission = await signed(w, client)
    aid = uuid.UUID(admission["id"])
    previous = await _row_of(db_session, aid, doctor)
    r = await client.post(f"/admissions/{aid}/care-team/claim", headers=w.auth["doctor2"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["user_id"], body["full_name"], body["role"], body["granted_by_name"],
            body["is_active"], body["in_force"], body["closed_at"]) == (
        str(second), "doctor2", "ATTENDING", "doctor2", True, True, None)
    assert await team_of(db_session, aid) == [(doctor, ATT, False, True), (second, ATT, True, False)]
    assert await _attending(db_session, aid) == second
    (row,) = [r for r in audited(app, "care_team.attending") if r.payload["via"] == "claim"]
    assert (row.patient_id, row.payload) == (admission["board_key"], {
        "admission_id": str(aid), "member_id": body["id"], "member": "doctor2@kabul.example.com",
        "via": "claim", "ended": [str(previous)], "actor": "doctor2@kabul.example.com"})


async def test_only_a_physician_of_the_unit_who_is_not_the_attending_claims(ward, db_session):
    """T1, T2, D7: an administrator holds the key and is no physician (409); a physician of
    another unit is out of scope (403); the attending herself is the attending already (409);
    the charge nurse no longer holds the key (403). None of them writes anything."""
    w, client, _ = ward
    await add_physician(db_session, w, "uzak", group="attending", unit="neo")
    admission = await signed(w, client)
    aid = uuid.UUID(admission["id"])
    url = f"/admissions/{aid}/care-team/claim"
    before = await team_of(db_session, aid)
    for who, status, code in (("admin", 409, "care_team_not_physician"),
                              ("uzak", 403, "out_of_scope"),
                              ("doctor", 409, "care_team_conflict")):
        r = await client.post(url, headers=w.auth[who])
        assert (r.status_code, r.json()["detail"]["code"]) == (status, code), (who, r.text)
    r = await client.post(url, headers=w.auth["charge"])
    assert (r.status_code, r.json()["detail"]) == (403, "permission required: care_team.claim")
    assert await team_of(db_session, aid) == before


async def test_one_physician_claiming_twice_at_once_claims_once(ward, db_session, monkeypatch):
    """T7, X5: the second claim waits for the first's locks, reads her as the attending and is
    refused `care_team_conflict`. One active ATTENDING row."""
    w, client, _ = ward
    second = await add_physician(db_session, w, "doctor2", group="attending")
    admission = await signed(w, client)
    aid = uuid.UUID(admission["id"])
    url = f"/admissions/{aid}/care-team/claim"
    one, two = await at_once(db_session, monkeypatch, "set_attending",
                             lambda: client.post(url, headers=w.auth["doctor2"]),
                             lambda: client.post(url, headers=w.auth["doctor2"]))
    assert (one.status_code, two.status_code) == (200, 409), (one.text, two.text)
    assert two.json()["detail"]["code"] == "care_team_conflict"
    assert [(u, role) for u, role, active, _ in await team_of(db_session, aid) if active] == [
        (second, ATT)]


async def test_two_physicians_claiming_at_once_take_it_in_turn(ward, db_session, monkeypatch):
    """X5, D4: the locks order the two claims, and the second ends the first's row. Both answers
    are 200; exactly one active ATTENDING stays, the later claimer's."""
    w, client, _ = ward
    second = await add_physician(db_session, w, "doctor2", group="attending")
    third = await add_physician(db_session, w, "doctor3", group="attending")
    admission = await signed(w, client)
    aid = uuid.UUID(admission["id"])
    url = f"/admissions/{aid}/care-team/claim"
    one, two = await at_once(db_session, monkeypatch, "set_attending",
                             lambda: client.post(url, headers=w.auth["doctor2"]),
                             lambda: client.post(url, headers=w.auth["doctor3"]))
    assert (one.status_code, two.status_code) == (200, 200), (one.text, two.text)
    team = await team_of(db_session, aid)
    assert [(u, role) for u, role, active, _ in team if active] == [(third, ATT)]
    assert (second, ATT, False, True) in team
    assert await _attending(db_session, aid) == third


# ---------------------------------------------------------------- add
async def test_an_assigner_adds_an_associate_by_name(ward, db_session):
    """§5.2, §5.5: 201 with the member named; `care_team.add` carries the role, no window and
    nothing renewed."""
    w, client, app = ward
    helper = await add_physician(db_session, w, "yardimci")
    admission = await signed(w, client)
    aid = uuid.UUID(admission["id"])
    r = await _add(client, w, aid, helper)
    assert r.status_code == 201, r.text
    body = r.json()
    assert (body["full_name"], body["role"], body["granted_by_name"], body["in_force"]) == (
        "yardimci", "ASSOCIATE_PHYSICIAN", "doctor", True)
    (row,) = audited(app, "care_team.add")
    assert (row.patient_id, row.payload) == (admission["board_key"], {
        "admission_id": str(aid), "member_id": body["id"], "member": "yardimci@kabul.example.com",
        "role": "ASSOCIATE_PHYSICIAN", "window_start": None, "window_end": None, "renewed": None,
        "actor": "doctor@kabul.example.com"})


async def test_an_on_call_physician_of_another_unit_is_added_for_her_window(ward, db_session):
    """D8, §5.2: any physician of the tenant; her window is kept as it was sent."""
    w, client, app = ward
    oncall = await add_physician(db_session, w, "nobetci", unit="neo")
    admission = await signed(w, client)
    start = _now()
    r = await _add(client, w, admission["id"], oncall, "ONCALL_PHYSICIAN", **_window(start, 12))
    assert r.status_code == 201, r.text
    assert r.json()["in_force"] is True
    (row,) = audited(app, "care_team.add")
    assert (row.payload["window_start"], row.payload["window_end"]) == (
        start.isoformat(), (start + 12 * HOUR).isoformat())


async def test_only_a_physician_is_added_and_a_duplicate_is_a_409_never_a_500(ward, db_session):
    """T1, T7: a nurse is a member of the tenant and no physician; a physician already on the
    team is refused by code, whatever role she is added with again."""
    w, client, app = ward
    nurse = w.users["nurse"].id
    helper = await add_physician(db_session, w, "yardimci")
    admission = await signed(w, client)
    aid = admission["id"]
    r = await _add(client, w, aid, nurse)
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "care_team_not_physician")
    assert (await _add(client, w, aid, helper)).status_code == 201
    r = await _add(client, w, aid, helper)
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "care_team_conflict")
    r = await _add(client, w, aid, helper, "ONCALL_PHYSICIAN", **_window(_now(), 8))
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "care_team_conflict")
    assert len(audited(app, "care_team.add")) == 1


async def test_adding_an_attending_promotes_her_into_one_row(ward, db_session):
    """T4: an add with role ATTENDING is `set_attending`, audited `care_team.attending` via
    `add`. Adding the attending as attending again is a conflict."""
    w, client, app = ward
    doctor = w.users["doctor"].id
    helper = await add_physician(db_session, w, "yardimci")
    admission = await signed(w, client)
    aid = uuid.UUID(admission["id"])
    assert (await _add(client, w, aid, helper)).status_code == 201
    ended = {str(await _row_of(db_session, aid, doctor)), str(await _row_of(db_session, aid, helper))}
    r = await _add(client, w, aid, helper, "ATTENDING")
    assert r.status_code == 201, r.text
    assert [(u, role) for u, role, active, _ in await team_of(db_session, aid) if active] == [
        (helper, ATT)]
    assert await _attending(db_session, aid) == helper
    (row,) = [r for r in audited(app, "care_team.attending") if r.payload["via"] == "add"]
    assert set(row.payload["ended"]) == ended
    r = await _add(client, w, aid, helper, "ATTENDING")
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "care_team_conflict")


@pytest.mark.parametrize(("role", "window", "field"), [
    ("ONCALL_PHYSICIAN", {}, "window_start"),
    ("ONCALL_PHYSICIAN", {"window_start": "S"}, "window_end"),
    ("ONCALL_PHYSICIAN", {"window_start": "S", "window_end": "S"}, "window_end"),
    ("ONCALL_PHYSICIAN", {"window_start": "S-10", "window_end": "S-2"}, "window_end"),
    ("ONCALL_PHYSICIAN", {"window_start": "S", "window_end": "S+49"}, "window_end"),
    ("ASSOCIATE_PHYSICIAN", {"window_start": "S", "window_end": "S+8"}, "window_start"),
    ("ATTENDING", {"window_end": "S+8"}, "window_end"),
], ids=["no-start", "no-end", "end-at-start", "in-the-past", "49-hours", "associate", "attending"])
async def test_the_window_rules_are_field_refusals(ward, db_session, role, window, field):
    """§5.2, X9: a window is the on-call row's alone; its end comes after its start, in the
    future, at most 48 hours later. Refused before anything is locked or written."""
    w, client, app = ward
    helper = await add_physician(db_session, w, "yardimci")
    admission = await signed(w, client)
    start = _now()
    at = {"S": start, "S-10": start - 10 * HOUR, "S-2": start - 2 * HOUR,
          "S+8": start + 8 * HOUR, "S+49": start + 49 * HOUR}
    r = await _add(client, w, admission["id"], helper, role,
                   **{key: at[value].isoformat() for key, value in window.items()})
    assert (r.status_code, r.json()["detail"]["code"]) == (422, f"field_invalid:{field}"), r.text
    assert audited(app, "care_team.add") == []


async def test_a_window_without_an_offset_is_refused(ward, db_session):
    """X9: a naive time is never compared with the server's clock."""
    w, client, _ = ward
    oncall = await add_physician(db_session, w, "nobetci")
    admission = await signed(w, client)
    r = await _add(client, w, admission["id"], oncall, "ONCALL_PHYSICIAN",
                   window_start="2026-11-09T20:00:00", window_end="2026-11-10T08:00:00")
    assert r.status_code == 422, r.text


@pytest.mark.parametrize("role", ["ONCALL_PHYSICIAN", "ASSOCIATE_PHYSICIAN"])
async def test_an_expired_on_call_row_is_renewed_never_refused(ward, db_session, role):
    """T8, X4: the expired row ends and the new one is written in one transaction, whatever the
    new role; `renewed` names the old row."""
    w, client, app = ward
    doctor = w.users["doctor"].id
    oncall = await add_physician(db_session, w, "nobetci")
    admission = await signed(w, client)
    aid = uuid.UUID(admission["id"])
    old = await _expired_on_call(db_session, aid, oncall, doctor)
    window = _window(_now(), 12) if role == "ONCALL_PHYSICIAN" else {}
    r = await _add(client, w, aid, oncall, role, **window)
    assert r.status_code == 201, r.text
    mine = [(r_, active) for u, r_, active, _ in await team_of(db_session, aid) if u == oncall]
    assert mine == [(ONCALL, False), (CareTeamRole(role), True)]
    (row,) = audited(app, "care_team.add")
    assert row.payload["renewed"] == str(old)


async def test_a_write_that_meets_an_index_is_a_coded_409_never_a_500(ward, db_session, monkeypatch):
    """T7: a writer the look-up did not warn (here the look-up is made blind) meets a partial
    unique index, and the route names the conflict by the index. Nothing is written."""
    w, client, _ = ward
    doctor = w.users["doctor"].id
    await add_physician(db_session, w, "doctor2", group="attending")
    admission = await signed(w, client)
    aid = uuid.UUID(admission["id"])
    before = await team_of(db_session, aid)

    async def blind(db, admission_id):
        return []

    monkeypatch.setattr(service, "active_rows", blind)
    r = await _add(client, w, aid, doctor)                     # uq_care_team_active_member
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "care_team_conflict")
    r = await client.post(f"/admissions/{aid}/care-team/claim", headers=w.auth["doctor2"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "care_team_conflict")
    assert await team_of(db_session, aid) == before          # uq_care_team_one_attending held


# ---------------------------------------------------------------- end
async def test_an_assigner_ends_a_members_row(ward, db_session):
    w, client, app = ward
    helper = await add_physician(db_session, w, "yardimci")
    admission = await signed(w, client)
    aid = uuid.UUID(admission["id"])
    member_id = (await _add(client, w, aid, helper)).json()["id"]
    r = await client.post(f"/admissions/{aid}/care-team/{member_id}/end", headers=w.auth["doctor"])
    assert r.status_code == 200, r.text
    assert (r.json()["is_active"], r.json()["in_force"], r.json()["closed_at"] is not None) == (
        False, False, True)
    (row,) = audited(app, "care_team.end")
    assert (row.patient_id, row.payload) == (admission["board_key"], {
        "admission_id": str(aid), "member_id": member_id, "member": "yardimci@kabul.example.com",
        "role": "ASSOCIATE_PHYSICIAN", "self": False, "actor": "doctor@kabul.example.com"})


async def test_a_member_ends_her_own_row_from_outside_her_units(ward, db_session):
    """§5.2: ending her own row only narrows what she sees, so it needs no reach and no
    `care_team.assign`."""
    w, client, app = ward
    oncall = await add_physician(db_session, w, "nobetci", unit="neo")
    admission = await signed(w, client)
    aid = admission["id"]
    member_id = (await _add(client, w, aid, oncall, "ONCALL_PHYSICIAN",
                            **_window(_now(), 12))).json()["id"]
    r = await client.post(f"/admissions/{aid}/care-team/{member_id}/end", headers=w.auth["nobetci"])
    assert r.status_code == 200, r.text
    (row,) = audited(app, "care_team.end")
    assert (row.payload["self"], row.payload["actor"]) == (True, "nobetci@kabul.example.com")


async def test_the_end_refuses_what_it_must(ward, db_session):
    """§5.2, T5: another's row without `care_team.assign` (403); an assigner outside the unit
    (403 `out_of_scope`); the attending's row (409 `care_team_attending_required`); a row of
    another admission (404); a row already ended (409 `invalid_transition`)."""
    w, client, app = ward
    doctor = w.users["doctor"].id
    helper = await add_physician(db_session, w, "yardimci")
    await add_physician(db_session, w, "komsu")                       # a physician: no assign
    await add_physician(db_session, w, "uzak", group="attending", unit="neo")
    admission = await signed(w, client)
    other = await signed(w, client, "2")
    aid = uuid.UUID(admission["id"])
    helper_row = (await _add(client, w, aid, helper)).json()["id"]
    attending_row = await _row_of(db_session, aid, doctor)
    other_row = await _row_of(db_session, uuid.UUID(other["id"]), doctor)

    def end(row):
        return f"/admissions/{aid}/care-team/{row}/end"

    r = await client.post(end(helper_row), headers=w.auth["komsu"])
    assert (r.status_code, r.json()["detail"]) == (403, "permission required: care_team.assign")
    r = await client.post(end(helper_row), headers=w.auth["uzak"])
    assert (r.status_code, r.json()["detail"]["code"]) == (403, "out_of_scope")
    r = await client.post(end(attending_row), headers=w.auth["doctor"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "care_team_attending_required")
    r = await client.post(end(other_row), headers=w.auth["doctor"])
    assert (r.status_code, r.json()["detail"]) == (404, "Care-team member not found.")
    assert (await client.post(end(helper_row), headers=w.auth["doctor"])).status_code == 200
    r = await client.post(end(helper_row), headers=w.auth["doctor"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "invalid_transition")
    assert len(audited(app, "care_team.end")) == 1


# ---------------------------------------------------------------- every write
@pytest.mark.parametrize("state", [AdmissionState.DRAFT, AdmissionState.DISCHARGED,
                                   AdmissionState.TRANSFERRED], ids=lambda s: s.value)
async def test_a_draft_or_a_closed_admission_takes_no_care_team_write(ward, db_session, state):
    """T3: the team lives from the sign-off to the end of the stay. Every write is refused
    `invalid_transition`, and nothing is written."""
    w, client, app = ward
    doctor = w.users["doctor"].id
    second = await add_physician(db_session, w, "doctor2", group="attending")
    admission = await signed(w, client)
    aid = uuid.UUID(admission["id"])
    attending_row = await _row_of(db_session, aid, doctor)
    await db_session.execute(update(Admission).where(Admission.id == aid).values(state=state))
    await db_session.commit()
    base = f"/admissions/{aid}/care-team"
    for url, body, who in ((f"{base}/claim", None, "doctor2"),
                           (base, {"user_id": str(second), "role": "ASSOCIATE_PHYSICIAN"}, "doctor"),
                           (f"{base}/{attending_row}/end", None, "doctor")):
        r = await client.post(url, json=body, headers=w.auth[who])
        assert (r.status_code, r.json()["detail"]["code"]) == (409, "invalid_transition"), (url, r.text)
    assert await team_of(db_session, aid) == [(doctor, ATT, True, False)]
    assert audited(app, "care_team.add") == audited(app, "care_team.end") == []


async def test_a_member_added_and_ended_twice_keeps_two_closed_rows(ward, db_session):
    """F2, spec §6 "the old fault": add, end, add again, end again — two closed rows, no error."""
    w, client, _ = ward
    helper = await add_physician(db_session, w, "yardimci")
    admission = await signed(w, client)
    aid = uuid.UUID(admission["id"])
    for _ in range(2):
        r = await _add(client, w, aid, helper)
        assert r.status_code == 201, r.text
        r = await client.post(f"/admissions/{aid}/care-team/{r.json()['id']}/end",
                              headers=w.auth["doctor"])
        assert r.status_code == 200, r.text
    assert [(role, active) for u, role, active, _ in await team_of(db_session, aid)
            if u == helper] == [(ASSOC, False), (ASSOC, False)]


async def test_the_care_teams_audit_rows_name_staff_and_never_the_patient(ward, db_session):
    """§5.5: ids and user names; `patient_id` is the card's key; no patient name anywhere."""
    w, client, app = ward
    helper = await add_physician(db_session, w, "yardimci")
    await add_physician(db_session, w, "doctor2", group="attending")
    admission = await signed(w, client)
    aid = admission["id"]
    member_id = (await _add(client, w, aid, helper)).json()["id"]
    assert (await client.post(f"/admissions/{aid}/care-team/{member_id}/end",
                              headers=w.auth["doctor"])).status_code == 200
    assert (await client.post(f"/admissions/{aid}/care-team/claim",
                              headers=w.auth["doctor2"])).status_code == 200
    rows = [r for r in app.state.audit.records(tenant=SLUG, limit=200)
            if r.event_type.startswith("care_team.")]
    assert {r.event_type for r in rows} == {"care_team.attending", "care_team.add", "care_team.end"}
    assert {r.patient_id for r in rows} == {admission["board_key"]}
    assert not any("Sentetik" in repr(r.payload) for r in rows)
```

In `homunculus-engine/tests/test_route_permissions.py`:
- after the `candidates` row Task 7 added, add
  ```python
      ("POST", "/admissions/{admission_id}/care-team/{member_id}/end"):
          ANY("care_team.assign", "admissions.view"),          # G2-B1c: an assigner, or the member herself
  ```
- replace the size pin's line (Task 7's `== 73`) with
  ```python
      assert len(EXPECTED) == 74      # G2-B3a: +5 (the bed moves, the occupancy read); G2-B3b: +2 (my handovers, colleagues); G2-B1c: +2, the picker, the end
  ```

In `homunculus-engine/tests/test_tenant_isolation.py`:

1. In `class Side`, after the `doctor` line Task 6 added, add:

```python
    team_row: uuid.UUID   # G2-B1c: the doctor's ATTENDING row on the admission
```

2. In `_hospital`, replace

```python
    await adm_service.sign_off_admission(db, admission, signing_user_id=admin.id)
```

with

```python
    await adm_service.sign_off_admission(db, admission, signing_user_id=admin.id)
    # G2-B1c (D3): the route writes the attending's row at sign-off; the service does not.
    team_row, _ = await adm_service.set_attending(db, admission, user_id=doctor.id,
                                                  granted_by_id=admin.id)
```

and replace `                member=nurse.id, doctor=doctor.id), admin` with `                member=nurse.id, doctor=doctor.id, team_row=team_row.id), admin`.

3. In `BY_ID`, replace

```python
    "care-team claim": ById("POST", lambda s: f"/admissions/{s.admission}/care-team/claim"),
    "care-team add": ById(
        "POST", lambda s: f"/admissions/{s.admission}/care-team",
        lambda a: {"user_id": a.member, "role": "ASSOCIATE_PHYSICIAN"}, 201),
```

with

```python
    # G2-B1c (T1, T5): the caller (an administrator) and the body's member (a nurse) are not
    # physicians, and the doctor's row is the attending's. The caller's own admission gets past the
    # tenant and unit checks to the domain's 409 (`care_team_not_physician`,
    # `care_team_attending_required`).
    "care-team claim": ById("POST", lambda s: f"/admissions/{s.admission}/care-team/claim",
                            control=409),
    "care-team add": ById(
        "POST", lambda s: f"/admissions/{s.admission}/care-team",
        lambda a: {"user_id": a.member, "role": "ASSOCIATE_PHYSICIAN"}, 409),
    "care-team end": ById(
        "POST", lambda s: f"/admissions/{s.admission}/care-team/{s.team_row}/end", control=409),
```

4. In `USERS`, replace

```python
    "care-team member": InBody(
        "POST", lambda a: f"/admissions/{a.admission}/care-team",
        lambda a, u: {"user_id": u, "role": "ASSOCIATE_PHYSICIAN"}, 201),
```

with

```python
    # G2-B1c (T1): a member of the tenant gets past the tenant check; a nurse is no physician.
    "care-team member": InBody(
        "POST", lambda a: f"/admissions/{a.admission}/care-team",
        lambda a, u: {"user_id": u, "role": "ASSOCIATE_PHYSICIAN"}, 409),
```

5. After `test_a_deactivated_account_is_no_member_though_its_membership_is_active`, add:

```python


@requires_db
async def test_another_tenants_care_team_row_under_the_callers_admission_is_a_404(world):
    """G2-B1c (§5.6): a row is found under its own admission only. Another tenant's row, named
    under the caller's admission, is the 404 a missing one is, and nothing is written."""
    before = await _snapshot(world.db)
    foreign = await _call(world, "POST",
                          f"/admissions/{world.a.admission}/care-team/{world.b.team_row}/end")
    missing = await _call(world, "POST",
                          f"/admissions/{world.a.admission}/care-team/{uuid.uuid4()}/end")
    assert foreign.status_code == 404, foreign.text
    assert foreign.json() == missing.json()
    assert await _snapshot(world.db) == before
```

In `homunculus-engine/tests/test_admission_workflow.py`, replace

```python
    await service.claim_attending(db_session, adm, attending_id=attending.id)
```

with

```python
    await service.set_attending(db_session, adm, user_id=attending.id, granted_by_id=attending.id)
```

- [ ] **Step 2: Run them and see them red**

```bash
cd /c/tmp/g2b-b1c/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_care_team_api.py 2>&1 | tail -4
```

Expected: most tests fail.
- The claim tests fail: the old claim writes a second ATTENDING row, and the index refuses it with a 500. Under `ASGITransport` that surfaces as an `IntegrityError` raised into the test.
- The add tests fail: there is no physician check, no window rule, no audit row.
- The end tests fail with `404` / `405`.
- The state tests fail with 200 / 201.

The edit to `test_admission_workflow.py` passes already: `set_attending` exists since Task 5.

- [ ] **Step 3: The routes**

In `homunculus-engine/src/homunculus/admission/router.py`:

1. Replace the errors import (Task 6's) with

```python
from homunculus.admission.errors import (
    BED_CLOSED, BED_RESERVED, CARE_TEAM_ATTENDING_REQUIRED, CARE_TEAM_CONFLICT,
    CARE_TEAM_NOT_PHYSICIAN, DUPLICATE_OPEN_ADMISSION, INVALID_TRANSITION, NO_PROTOCOL,
    REQUEST_CONFLICT, TRANSFER_UNAVAILABLE, Refusal, field_invalid,
)
```

2. Replace (G2-B3b added `HandoverStatus`)

```python
from homunculus.admission.models import (
    OPEN_ADMISSION_STATES, OPEN_IDENTITY_INDEX, Admission, AdmissionState, CareTeamMember,
    DischargeDisposition, Handover, HandoverStatus, Patient,
)
```

with

```python
from homunculus.admission.models import (
    CARE_TEAM_ACTIVE_INDEX, CARE_TEAM_ATTENDING_INDEX, OPEN_ADMISSION_STATES, OPEN_IDENTITY_INDEX,
    Admission, AdmissionState, CareTeamMember, CareTeamRole, DischargeDisposition, Handover,
    HandoverStatus, Patient,
)
```

3. Replace `from homunculus.auth.dependencies import caller_tenant_id, require_permission` with `from homunculus.auth.dependencies import Principal, caller_tenant_id, get_principal, require_permission`.

4. Replace Task 7's two write routes, from `@router.post("/{admission_id}/care-team/claim", …)` down to the `return answer` that ends `add_care_team_member`:

```python
@router.post("/{admission_id}/care-team/claim", response_model=CareTeamMemberResponse)
async def claim_attending(
    admission_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("care_team.claim")),
    caller_tenant: uuid.UUID = _tenant,
):
    admission = await _get_admission_or_404(db, admission_id, caller_tenant)
    # The caller becomes the attending of record. There is no claiming on someone else's
    # behalf here: adding another clinician goes through POST .../care-team (care_team.assign).
    member = await service.claim_attending(
        db, admission, attending_id=user.id, granted_by_id=user.id,
    )
    answer = _member_out(member, await _people(db, member.user_id), _now())
    await db.commit()
    return answer


@router.post("/{admission_id}/care-team", response_model=CareTeamMemberResponse, status_code=201)
async def add_care_team_member(
    admission_id: uuid.UUID,
    payload: CareTeamAdd,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("care_team.assign")),
    caller_tenant: uuid.UUID = _tenant,
):
    admission = await _get_admission_or_404(db, admission_id, caller_tenant)
    await scope.ensure_members(db, caller_tenant, [payload.user_id])
    try:
        member = await service.add_care_team_member(
            db, admission, user_id=payload.user_id, role=payload.role,
            granted_by_id=user.id, window_start=payload.window_start,
            window_end=payload.window_end,
        )
    except WorkflowError as exc:
        raise _wf(exc)
    answer = _member_out(member, await _people(db, member.user_id, user.id), _now())
    await db.commit()
    return answer
```

with

```python
#: G2-B1c (T3): the team lives from the sign-off to the end of the stay.
TEAM_STATES = frozenset({AdmissionState.ACTIVE, AdmissionState.PENDING_DISCHARGE})
#: A member row that is missing, or another admission's (§5.6).
MEMBER_NOT_FOUND = "Care-team member not found."


def _team_open(admission: Admission) -> None:
    """T3: a DRAFT has no team yet (D3), and a closed admission keeps the one it had."""
    if admission.state not in TEAM_STATES:
        raise Refusal(409, INVALID_TRANSITION,
                      "The care team is written from the sign-off to the end of the stay "
                      f"(the admission is {admission.state.value}).").http()


def _team_conflict() -> HTTPException:
    """T7: the physician already holds a row here that is not an expired on-call one, or a
    concurrent write took the place first."""
    return Refusal(409, CARE_TEAM_CONFLICT,
                   "This physician already holds a row on this care team.").http()


async def _lost_at_an_index(db: AsyncSession, exc: IntegrityError) -> None:
    """T7: a care-team write that met one of the two partial unique indexes (a writer the locks
    did not order) is the coded 409, told apart by the index's name as the admission route tells
    `uq_admissions_open_identity` apart. Anything else is raised as it is."""
    broken = _broken_constraint(exc)
    await db.rollback()
    if broken in (CARE_TEAM_ACTIVE_INDEX, CARE_TEAM_ATTENDING_INDEX):
        raise _team_conflict() from None
    raise exc


def _check_window(payload: CareTeamAdd, now: datetime) -> None:
    """§5.2, X9: an on-call row needs its window, ending after it starts, in the future and at
    most 48 hours after its start (`service.ONCALL_MAX_WINDOW`). Any other role takes none. A
    field refusal names the end that is wrong."""
    start, end = payload.window_start, payload.window_end
    if payload.role != CareTeamRole.ONCALL_PHYSICIAN:
        if start is not None:
            raise field_invalid("window_start", "Only an on-call physician has a window.")
        if end is not None:
            raise field_invalid("window_end", "Only an on-call physician has a window.")
        return
    if start is None:
        raise field_invalid("window_start", "An on-call physician needs the start of her window.")
    if end is None:
        raise field_invalid("window_end", "An on-call physician needs the end of her window.")
    if end <= start:
        raise field_invalid("window_end", "The window ends after it starts.")
    if end <= now:
        raise field_invalid("window_end", "The window ends in the future.")
    if end - start > service.ONCALL_MAX_WINDOW:
        raise field_invalid("window_end", "An on-call window is at most 48 hours.")


@router.post("/{admission_id}/care-team/claim", response_model=CareTeamMemberResponse)
async def claim_attending(
    admission_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("care_team.claim")),
    caller_tenant: uuid.UUID = _tenant,
):
    """G2-B1c (§5.2, T1–T4): the caller becomes the attending. She must be a physician (T1) whose
    units hold the bed; the previous attending's row ends (D4). Already the attending: 409
    `care_team_conflict`. There is no claiming on someone else's behalf: adding another clinician
    goes through POST …/care-team (`care_team.assign`). Audited `care_team.attending` (via
    `claim`) after the commit."""
    admission = await _get_admission_or_404(db, admission_id, caller_tenant)
    await _reach_admission(db, user.id, caller_tenant, admission)
    me, actor = user.id, user.username
    admission = await _locked(db, admission)
    _team_open(admission)
    if not await service.is_physician(db, caller_tenant, me):
        raise _not_physician()
    if any(m.user_id == me and m.role == CareTeamRole.ATTENDING
           for m in await service.active_rows(db, admission.id)):
        raise _team_conflict()
    now = _now()
    try:
        member, ended = await service.set_attending(db, admission, user_id=me,
                                                    granted_by_id=me, now=now)
    except IntegrityError as exc:
        await _lost_at_an_index(db, exc)
    key = await _key_of(db, admission)
    hospital = await trail.hospital_of(db, caller_tenant)
    answer = _member_out(member, await _people(db, me), now)
    await db.commit()
    trail.record(request, hospital, "care_team.attending", patient_id=key, payload={
        "admission_id": str(answer.admission_id), "member_id": str(answer.id), "member": actor,
        "via": "claim", "ended": [str(i) for i in ended], "actor": actor})
    return answer


@router.post("/{admission_id}/care-team", response_model=CareTeamMemberResponse, status_code=201)
async def add_care_team_member(
    admission_id: uuid.UUID,
    payload: CareTeamAdd,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("care_team.assign")),
    caller_tenant: uuid.UUID = _tenant,
):
    """G2-B1c (§5.2, T1–T4, T7, T8): an assigner adds a physician of the tenant.
    - `user_id` must be a member of the tenant (422, as before) and a physician (T1).
    - The window rules are `_check_window`'s (422).
    - Role ATTENDING makes her the attending (`service.set_attending`, T4).
    - A physician already holding a row here is refused `care_team_conflict`, unless that row is
      an on-call row whose window has passed: it is ended and the new row written in one
      transaction (T8, for any new role: X4).
    Audited after the commit: `care_team.attending` (via `add`), or `care_team.add`."""
    admission = await _get_admission_or_404(db, admission_id, caller_tenant)
    await scope.ensure_members(db, caller_tenant, [payload.user_id])
    now = _now()
    try:
        _check_window(payload, now)
    except Refusal as exc:
        raise exc.http() from None
    await _reach_admission(db, user.id, caller_tenant, admission)
    actor_id, actor = user.id, user.username
    admission = await _locked(db, admission)
    _team_open(admission)
    if not await service.is_physician(db, caller_tenant, payload.user_id):
        raise _not_physician()
    existing = next((m for m in await service.active_rows(db, admission.id)
                     if m.user_id == payload.user_id), None)
    renewed, ended = None, []
    try:
        if payload.role == CareTeamRole.ATTENDING:
            if existing is not None and existing.role == CareTeamRole.ATTENDING:
                raise _team_conflict()
            member, ended = await service.set_attending(
                db, admission, user_id=payload.user_id, granted_by_id=actor_id, now=now)
        else:
            if existing is not None:
                if not service.expired(existing, now):
                    raise _team_conflict()
                await service.end_care_team_member(db, existing, now=now)         # T8
                renewed = existing.id
            member = await service.add_care_team_member(
                db, admission, user_id=payload.user_id, role=payload.role,
                granted_by_id=actor_id, window_start=payload.window_start,
                window_end=payload.window_end)
    except IntegrityError as exc:
        await _lost_at_an_index(db, exc)
    except WorkflowError as exc:
        raise _wf(exc)
    key = await _key_of(db, admission)
    hospital = await trail.hospital_of(db, caller_tenant)
    people = await _people(db, member.user_id, actor_id)
    answer, name = _member_out(member, people, now), people[member.user_id][0]
    await db.commit()
    if payload.role == CareTeamRole.ATTENDING:
        trail.record(request, hospital, "care_team.attending", patient_id=key, payload={
            "admission_id": str(answer.admission_id), "member_id": str(answer.id),
            "member": name, "via": "add", "ended": [str(i) for i in ended], "actor": actor})
    else:
        trail.record(request, hospital, "care_team.add", patient_id=key, payload={
            "admission_id": str(answer.admission_id), "member_id": str(answer.id),
            "member": name, "role": answer.role.value,
            "window_start": answer.window_start.isoformat() if answer.window_start else None,
            "window_end": answer.window_end.isoformat() if answer.window_end else None,
            "renewed": str(renewed) if renewed else None, "actor": actor})
    return answer


@router.post("/{admission_id}/care-team/{member_id}/end", response_model=CareTeamMemberResponse)
async def end_care_team_member(
    admission_id: uuid.UUID,
    member_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("care_team.assign", "admissions.view")),
    principal: Principal = Depends(get_principal),
    caller_tenant: uuid.UUID = _tenant,
):
    """G2-B1c (§5.2, T2, T5): a row of the team ends (`is_active` false, `closed_at` now).
    - An assigner (`care_team.assign`) ends any row but the attending's, for a bed in her units.
    - A member ends her own row with `admissions.view` alone, and needs no reach: ending it only
      narrows what she sees (D6).
    - Another's row without `care_team.assign`: 403.
    - The ATTENDING row: 409 `care_team_attending_required` (T5).
    - A row already ended: 409 `invalid_transition`.
    - A row of another admission, or none: 404.
    Audited `care_team.end` after the commit."""
    admission = await _get_admission_or_404(db, admission_id, caller_tenant)
    member = await db.get(CareTeamMember, member_id)
    if member is None or member.admission_id != admission.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=MEMBER_NOT_FOUND)
    me, actor = user.id, user.username
    own = member.user_id == me
    if not own and "care_team.assign" not in principal.perms:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="permission required: care_team.assign")
    if not own:
        await _reach_admission(db, me, caller_tenant, admission)
    admission = await _locked(db, admission)
    _team_open(admission)
    member = (await db.execute(select(CareTeamMember).where(CareTeamMember.id == member_id)
                               .execution_options(populate_existing=True))).scalar_one()
    if not member.is_active:
        raise Refusal(409, INVALID_TRANSITION, "This care-team row has ended already.").http()
    if member.role == CareTeamRole.ATTENDING:
        raise Refusal(409, CARE_TEAM_ATTENDING_REQUIRED,
                      "The attending's row ends only when another attending is made.").http()
    now = _now()
    await service.end_care_team_member(db, member, now=now)
    key = await _key_of(db, admission)
    hospital = await trail.hospital_of(db, caller_tenant)
    people = await _people(db, member.user_id, member.granted_by_id)
    answer, name = _member_out(member, people, now), people[member.user_id][0]
    await db.commit()
    trail.record(request, hospital, "care_team.end", patient_id=key, payload={
        "admission_id": str(answer.admission_id), "member_id": str(answer.id), "member": name,
        "role": answer.role.value, "self": own, "actor": actor})
    return answer
```

`_lost_at_an_index` always raises, so `member` is bound wherever it is read.

5. In `homunculus-engine/src/homunculus/admission/service.py`, delete `claim_attending` whole: the function from `async def claim_attending(` through its `return member`, and the two blank lines after it. No caller is left.

6. In `deploy/local/web/nginx.conf`, after the line that starts `    ~^/admissions/[^/]+/(?<act>care-team`, add:

```nginx
    ~^/admissions/[^/]+/care-team/[^/]+/end$                 /admissions/:id/care-team/:id/end;
```

- [ ] **Step 4: Run them and see them green**

Same command as Step 2. Expected: `27 passed` (the window rules run seven times, the renewal twice, the state refusals three times). Then, each as its own call:
- `tests/test_care_team_reads.py`, `tests/test_care_team_sign_off.py`, `tests/test_care_team_service.py`, `tests/test_route_permissions.py`, `tests/test_admission_workflow.py` (the Postgres command, one call each): all passed;
- `tests/test_tenant_isolation.py` (`run_in_background: true`; wait for its notification): all passed;
- the whole no-DB suite (Task 1, Step 5): no failure; `tests/test_access_log_redaction.py` names neither care-team route.

- [ ] **Step 5: Line ends, then commit**

```bash
cd /c/tmp/g2b-b1c && /c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" homunculus-engine/tests/test_care_team_api.py
for f in homunculus-engine/src/homunculus/admission/router.py homunculus-engine/src/homunculus/admission/service.py deploy/local/web/nginx.conf homunculus-engine/tests/test_care_team_api.py homunculus-engine/tests/test_route_permissions.py homunculus-engine/tests/test_tenant_isolation.py homunculus-engine/tests/test_admission_workflow.py; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- homunculus-engine/src/homunculus/admission/router.py homunculus-engine/src/homunculus/admission/service.py deploy/local/web/nginx.conf homunculus-engine/tests/test_care_team_api.py homunculus-engine/tests/test_route_permissions.py homunculus-engine/tests/test_tenant_isolation.py homunculus-engine/tests/test_admission_workflow.py
git status --short && git diff --cached --stat
git commit -m "feat(admission): claim, add and end the care team — physicians only, in the caller's units, under the locks, audited (G2-B1c, §5.2, §5.5, T1–T5, T7, T8, X4, X5, X9)" -m "The claim makes the caller the attending and ends the previous row; the add takes associates, on-call windows (≤ 48 h, ending in the future) and attendings, and renews an expired on-call row; the end takes any row but the attending's, and a member ends her own from anywhere. A write that meets an index is care_team_conflict, never a 500. claim_attending goes. Red: the old claim met the one-attending index (IntegrityError); the old add had no physician check, no window rule and no audit row; the end route did not exist (404/405); a DRAFT or closed admission took every write." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/src/homunculus/admission/router.py homunculus-engine/src/homunculus/admission/service.py deploy/local/web/nginx.conf homunculus-engine/tests/test_care_team_api.py homunculus-engine/tests/test_route_permissions.py homunculus-engine/tests/test_tenant_isolation.py homunculus-engine/tests/test_admission_workflow.py
```

If Step 2's red differed from that sentence, write what it was instead.

---

### Task 9: The discharge closes the whole team (spec F6, §5.4)

**Files:**
- Modify: `homunculus-engine/tests/test_care_team_api.py`

This task adds no code. The spec keeps F6 as it is. Its test pins F6 under the new indexes: a discharge after a member was ended twice closes a third row of hers without an error.

- [ ] **Step 1: The test**

Append to `homunculus-engine/tests/test_care_team_api.py`:

```python


# ---------------------------------------------------------------- the discharge (F6, §5.4)
async def test_the_discharge_closes_the_whole_team_and_keeps_every_closed_row(ward, db_session):
    """F6, §5.4: the discharge confirmation closes every active row, the attending's included. A
    member ended twice before keeps both rows and loses a third (F2: the old constraint broke
    here)."""
    w, client, _ = ward
    doctor = w.users["doctor"].id
    helper = await add_physician(db_session, w, "yardimci")
    admission = await signed(w, client)
    aid = admission["id"]
    for _ in range(2):
        member_id = (await _add(client, w, aid, helper)).json()["id"]
        assert (await client.post(f"/admissions/{aid}/care-team/{member_id}/end",
                                  headers=w.auth["doctor"])).status_code == 200
    assert (await _add(client, w, aid, helper)).status_code == 201
    r = await client.post(f"/admissions/{aid}/discharge/initiate", json={"disposition": "HOME"},
                          headers=w.auth["doctor"])
    assert r.status_code == 200, r.text
    r = await client.post(f"/admissions/{aid}/discharge/confirm", headers=w.auth["charge"])
    assert r.status_code == 200, r.text
    assert [(u, active, closed) for u, _, active, closed in
            await team_of(db_session, uuid.UUID(aid))] == [
        (doctor, False, True), (helper, False, True), (helper, False, True), (helper, False, True)]
```

- [ ] **Step 2: Run it**

```bash
cd /c/tmp/g2b-b1c/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_care_team_api.py -k discharge 2>&1 | tail -3
```

Expected: `1 passed`. It passes at once: the behaviour it pins was kept, and the fault it would have met was Task 1's and Task 2's red. Say so in the commit body.

- [ ] **Step 3: Line ends, then commit**

```bash
cd /c/tmp/g2b-b1c && f=homunculus-engine/tests/test_care_team_api.py; printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"
git add -- homunculus-engine/tests/test_care_team_api.py
git status --short && git diff --cached --stat
git commit -m "test(admission): the discharge closes the whole care team, a member ended twice included (G2-B1c, F6, §5.4, F2)" -m "A pin: no code. F6 is unchanged by the spec; the old constraint would have failed this discharge (Task 1 and 2's red)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/tests/test_care_team_api.py
```

---

### Task 10: The own-patient rule over this slice's rows (spec D6, F9, F10)

**Files:**
- Create: `homunculus-engine/tests/test_care_team_scope.py`

The rule exists (F9) and this slice does not change it: it makes its rows right (D6). These tests pin what a member sees through the rows the routes now write. No code changes, so there is no red to see; the commit says so.

- [ ] **Step 1: The tests**

Create `homunculus-engine/tests/test_care_team_scope.py`:

```python
# homunculus-engine/tests/test_care_team_scope.py
"""A care-team member sees her patient outside her units (G2-B1c, spec D6, F9, F10), through the
rows the routes write:
- an on-call member granted another unit sees the card inside her window and not after it;
- a member whose row has ended no longer sees it;
- a member leaves her own team, and then reads it no more.
The board's scope is the resolver's (`build_scope` over the grants and `read_own_patient_ids`);
an open stream picks a new member up when it reconnects (F10), so these tests read the scope,
not a stream. Postgres. Synthetic ward: tests/kabul_world.py."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest_asyncio

from homunculus.scope import build_scope, sees_patient
from homunculus.scope.service import read_own_patient_ids
from tests.conftest import requires_db
from tests.kabul_world import BOARD, build_ward, ward_client
from tests.test_care_team_service import add_physician
from tests.test_discharge_api import signed

pytestmark = [requires_db]
HOUR = timedelta(hours=1)


@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    built = await build_ward(db_session)
    async with ward_client(db_session) as (client, app):
        yield built, client, app


async def _on_call(client, w, admission_id: str, user_id, start: datetime, hours: float) -> str:
    r = await client.post(f"/admissions/{admission_id}/care-team",
                          json={"user_id": str(user_id), "role": "ONCALL_PHYSICIAN",
                                "window_start": start.isoformat(),
                                "window_end": (start + timedelta(hours=hours)).isoformat()},
                          headers=w.auth["doctor"])
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def test_an_on_call_member_outside_the_unit_sees_the_card_inside_her_window_only(
        ward, db_session):
    w, client, _ = ward
    tenant, neo = w.tenant.id, str(w.units["neo"].id)
    oncall = await add_physician(db_session, w, "nobetci", unit="neo")
    admission = await signed(w, client)
    start = datetime.now(timezone.utc).replace(microsecond=0) - HOUR
    await _on_call(client, w, admission["id"], oncall, start, 2)
    (card,) = (await client.get("/patients", headers=BOARD)).json()["patients"]

    async def sees(at: datetime) -> bool:
        own = await read_own_patient_ids(db_session, oncall, tenant, now=at)
        return sees_patient(card, build_scope("MEMBER", unit_ids=[neo], own_patient_ids=own))

    assert not sees_patient(card, build_scope("MEMBER", unit_ids=[neo]))       # her units alone
    assert await sees(start + HOUR)                                            # inside her window
    assert not await sees(start + 2 * HOUR + timedelta(seconds=1))            # after it


async def test_a_member_whose_row_has_ended_no_longer_sees_the_card(ward, db_session):
    w, client, _ = ward
    tenant = w.tenant.id
    oncall = await add_physician(db_session, w, "nobetci", unit="neo")
    admission = await signed(w, client)
    member_id = await _on_call(client, w, admission["id"], oncall,
                               datetime.now(timezone.utc) - HOUR, 2)
    assert admission["board_key"] in await read_own_patient_ids(db_session, oncall, tenant)
    r = await client.post(f"/admissions/{admission['id']}/care-team/{member_id}/end",
                          headers=w.auth["doctor"])
    assert r.status_code == 200, r.text
    assert admission["board_key"] not in await read_own_patient_ids(db_session, oncall, tenant)


async def test_a_member_leaves_her_own_team_and_then_reads_it_no_more(ward, db_session):
    """§5.2, §7: she ends her own row from outside her units; the team's read is then her units'
    again, and the bed is not in them."""
    w, client, _ = ward
    oncall = await add_physician(db_session, w, "nobetci", unit="neo")
    admission = await signed(w, client)
    member_id = await _on_call(client, w, admission["id"], oncall,
                               datetime.now(timezone.utc) - HOUR, 2)
    url = f"/admissions/{admission['id']}/care-team"
    assert (await client.get(url, headers=w.auth["nobetci"])).status_code == 200
    r = await client.post(f"{url}/{member_id}/end", headers=w.auth["nobetci"])
    assert r.status_code == 200, r.text
    r = await client.get(url, headers=w.auth["nobetci"])
    assert (r.status_code, r.json()["detail"]["code"]) == (403, "out_of_scope")
```

- [ ] **Step 2: Run them**

```bash
cd /c/tmp/g2b-b1c/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_care_team_scope.py 2>&1 | tail -3
```

Expected: `3 passed`.

If the first test sees the card through her units alone, the card's identity has no `unit_id`. Read `sees_patient` (`scope/rules.py`, `def sees_patient`) and report it: that is a finding about the board, not a reason to change the assertion.

- [ ] **Step 3: Line ends, then commit**

```bash
cd /c/tmp/g2b-b1c && f=homunculus-engine/tests/test_care_team_scope.py; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" "$f"; printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"
git add -- homunculus-engine/tests/test_care_team_scope.py
git status --short && git diff --cached --stat
git commit -m "test(scope): a care-team member sees her patient outside her units inside her window, and not after her row ends (G2-B1c, D6, F9)" -m "A pin: no code. The own-patient rule exists (F9); these tests read it over the rows the care-team routes now write." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/tests/test_care_team_scope.py
```

---

### Task 11: The engine's gates

**Files:** none changed, unless a gate finds something.

- [ ] **Step 1: The whole no-DB suite**

```bash
cd /c/tmp/g2b-b1c/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -5
```

Expected: Task 0's passed count + 9 new tests (5 of Task 1, 1 of Task 3, 3 of Task 5), and nothing fails.

- [ ] **Step 2: The whole Postgres suite, one file per call**

List the files once:

```bash
cd /c/tmp/g2b-b1c/homunculus-engine && ls tests/test_*.py | grep -v test_infinity_vm_pilot | xargs grep -l requires_db > /c/tmp/g2b-b1c-dbfiles.txt && wc -l < /c/tmp/g2b-b1c-dbfiles.txt
```

Then:
1. `tests/test_tenant_isolation.py` and `tests/test_admission_api.py`: each in its own call with `run_in_background: true`, one after the other. Wait for each one's notification.
2. Every other file of the list, in chunks of five. Each chunk is its own Bash call (`timeout: 600000`). Set `N` to 0, 1, 2… until the chunk is empty:

```bash
cd /c/tmp/g2b-b1c/homunculus-engine && N=0 && files=$(grep -v -e test_tenant_isolation.py -e test_admission_api.py /c/tmp/g2b-b1c-dbfiles.txt | sed -n "$((N*5+1)),$((N*5+5))p") && echo $files && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings $files 2>&1 | tail -3
```

If a chunk does not finish within the call, run its five files one per call.

Expected: every call all passed. The skips are environment-only (the same kinds as Task 0 reported). Add the calls up in the report.

- [ ] **Step 3: The migration chain from empty, and its one head**

```bash
cd /c/tmp/g2b-b1c/homunculus-engine && PYTHONPATH=src /c/tmp/f7-py312/venv/Scripts/python.exe -c "from alembic.config import Config; from alembic.script import ScriptDirectory; print(ScriptDirectory.from_config(Config('alembic.ini')).get_heads())"
```

Expected: `['0018']`. Step 2 ran `test_migration_0018_care_team_transfer.py` and `test_migration_0010_schema_parity.py` (the chain from empty).

- [ ] **Step 4: Report**

Report the numbers. If a gate fails, stop. Fix the cause in the task that owns the file, as its own commit with the red named. Never weaken a test to pass a gate.

---

### Task 12: The API client — the team, its candidates, claim, add and end

**Files:**
- Modify: `dashboard/src/backendApi.js`
- Modify: `dashboard/src/backendApi.test.js`
- Modify: `dashboard/src/live/session/testTokens.testutil.js`

- [ ] **Step 1: Write the failing test**

In `dashboard/src/backendApi.test.js`, insert before the line `  it("builds the structure under its parents and renames, closes and reopens by PATCH", async () => {`:

```js
  it("reads, claims, adds to and ends the care team by its own routes (G2-B1c)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    const api = signedIn(fetchMock);
    await api.careTeam("a 1");
    await api.careTeamCandidates("a-1");
    await api.claimAttending("a-1");
    await api.addCareTeamMember("a-1", { user_id: "u-1", role: "ASSOCIATE_PHYSICIAN" });
    await api.endCareTeamMember("a-1", "m/1");
    expect(fetchMock.mock.calls.map((_, at) => [sent(fetchMock, at).method, sent(fetchMock, at).url])).toEqual([
      ["GET", "/admissions/a%201/care-team"], ["GET", "/admissions/a-1/care-team/candidates"],
      ["POST", "/admissions/a-1/care-team/claim"], ["POST", "/admissions/a-1/care-team"],
      ["POST", "/admissions/a-1/care-team/m%2F1/end"],
    ]);
    expect(sent(fetchMock, 3).body).toEqual({ user_id: "u-1", role: "ASSOCIATE_PHYSICIAN" });
  });

```

- [ ] **Step 2: Run it and see it red**

```bash
cd /c/tmp/g2b-b1c/dashboard && ./node_modules/.bin/vitest run src/backendApi.test.js 2>&1 | tail -6
```

Expected: 1 failed, `api.careTeam is not a function`.

- [ ] **Step 3: The client and the fake**

In `dashboard/src/backendApi.js`, after

```js
    admissionLabel(id, reprint = false) {
      return authed(`/admissions/${seg(id)}/label`, { method: "POST", body: { reprint: Boolean(reprint) } });
    },
```

add:

```js
    // G2-B1c — Bakım ekibi (admission/router.py). People are named by `full_name` (staff, never a
    // patient). Refusals carry `err.apiCode`: `care_team_conflict`, `care_team_not_physician`,
    // `care_team_attending_required`, `invalid_transition`, `out_of_scope`, `field_invalid:window_*`.
    /** [{id, user_id, full_name, role, window_start, window_end, granted_by_name, is_active, in_force,
     *  created_at, closed_at, …}] — the active rows first, each group newest first. */
    careTeam(admissionId) { return authed(`/admissions/${seg(admissionId)}/care-team`); },
    /** [{user_id, full_name}] — the tenant's physicians the picker offers (spec D8). */
    careTeamCandidates(admissionId) { return authed(`/admissions/${seg(admissionId)}/care-team/candidates`); },
    claimAttending(admissionId) { return authed(`/admissions/${seg(admissionId)}/care-team/claim`, { method: "POST" }); },
    /** {user_id, role, window_start?, window_end?} — the window for an on-call physician only. */
    addCareTeamMember(admissionId, body) {
      return authed(`/admissions/${seg(admissionId)}/care-team`, { method: "POST", body });
    },
    endCareTeamMember(admissionId, memberId) {
      return authed(`/admissions/${seg(admissionId)}/care-team/${seg(memberId)}/end`, { method: "POST" });
    },
```

In `dashboard/src/live/session/testTokens.testutil.js`, replace

```js
    admissionLabel: vi.fn(),
```

with

```js
    admissionLabel: vi.fn(),
    // G2-B1c: the patient screen's «Bakım ekibi» box and its dialog
    careTeam: vi.fn(),
    careTeamCandidates: vi.fn(),
    claimAttending: vi.fn(),
    addCareTeamMember: vi.fn(),
    endCareTeamMember: vi.fn(),
```

- [ ] **Step 4: Run it and see it green**

Same command as Step 2. Expected: all passed.

- [ ] **Step 5: Line ends, then commit**

```bash
cd /c/tmp/g2b-b1c && for f in dashboard/src/backendApi.js dashboard/src/backendApi.test.js dashboard/src/live/session/testTokens.testutil.js; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- dashboard/src/backendApi.js dashboard/src/backendApi.test.js dashboard/src/live/session/testTokens.testutil.js
git status --short && git diff --cached --stat
git commit -m "feat(dashboard): the API client reads, claims, adds to and ends the care team (G2-B1c, §5.2)" -m "Red: api.careTeam is not a function." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/backendApi.js dashboard/src/backendApi.test.js dashboard/src/live/session/testTokens.testutil.js
```

---

### Task 13: The words — `ekip`, the three codes, the two window fields and the three audit events (spec §4, §5.5, §5.6; X11)

**Files:**
- Create: `dashboard/src/live/i18n/strings/ekip.js`
- Modify: `dashboard/src/live/i18n/catalog.js`
- Modify: `dashboard/src/live/apiErrors.js`
- Modify: `dashboard/src/live/apiErrors.test.js`
- Modify: `dashboard/src/live/screens/denetim/denetim.js`
- Modify: `dashboard/src/live/screens/denetim/denetim.test.js`
- Modify: `dashboard/src/live/i18n/strings/denetim.js`

- [ ] **Step 1: See the guard red first**

`apiErrors.test.js` reads `errors.py` (three new codes since Task 4) and the fields `admission/router.py` refuses (`window_start`, `window_end` since Task 8). First make its two pins say what this slice adds. In `dashboard/src/live/apiErrors.test.js`:

1. Replace

```js
    // mapping_changed; bed_has_monitor for Yapı); G2-B1d's eight (its own block); G2-B3a's
    // `bed_reserved` (D5, X1).
    expect(CODES).toHaveLength(30);
```

with

```js
    // mapping_changed; bed_has_monitor for Yapı); G2-B1d's eight (its own block); G2-B3a's
    // `bed_reserved` (D5, X1); G2-B1c's three care-team codes (§5.6).
    expect(CODES).toHaveLength(33);
```

2. Replace

```js
    // G2-B1d's codes speak in `protokol`.
    expect(hit.key).toMatch(ESLEME.includes(code) ? /^esleme\.err\./ : /^(kabul|protokol)\.err\./);
```

with

```js
    // G2-B1d's codes speak in `protokol`, G2-B1c's in `ekip` (the care-team box).
    expect(hit.key).toMatch(ESLEME.includes(code) ? /^esleme\.err\./ : /^(kabul|protokol|ekip)\.err\./);
```

Then run:

```bash
cd /c/tmp/g2b-b1c/dashboard && ./node_modules/.bin/vitest run src/live/apiErrors.test.js 2>&1 | tail -8
```

Expected: failures naming `care_team_conflict`, `care_team_not_physician`, `care_team_attending_required` (not mapped), and `field_invalid:window_start` / `window_end` (they read the generic sentence).

- [ ] **Step 2: The `ekip` namespace**

Create `dashboard/src/live/i18n/strings/ekip.js`:

```js
// Group 2 · B1c — Bakım ekibi (screens/patient/careTeam/). The box on the patient screen names who is
// responsible for the patient: the attending, the associates and the on-call physicians. It adds and
// removes them, and asks once before a new attending is made. Spec 2026-11-09.
//
// TR is the source; AZ is the default. The role names in AZ, RU and EN are spec §4's table; those and
// the rest of AZ, RU and EN are the planner's and await a native reading before the pilot (O48). No text
// here is clinical advice.
export default {
  tr: {
    title: "Bakım ekibi",
    role: { ATTENDING: "Sorumlu hekim", ASSOCIATE_PHYSICIAN: "Yardımcı hekim", ONCALL_PHYSICIAN: "Nöbetçi hekim" },
    draft: "Sorumlu hekim, kabul imzalanınca atanır.",
    loading: "Bakım ekibi okunuyor…",
    readFailed: "Bakım ekibi okunamadı: {reason}",
    empty: "Ekipte kimse yok.",
    expired: "süresi doldu",
    grantedBy: "ekleyen: {name}",
    attendingStays: "Yeni sorumlu hekim atanınca biter.",
    previous: "Önceki üyeler ({n})",
    ended: "bitti: {at}",
    working: "Bakım ekibinde işlem sürüyor…",
    action: {
      claim: "Sorumlu hekim ol", add: "Ekibe ekle", promote: "Sorumlu hekim yap",
      remove: "Ekipten çıkar", leave: "Ekipten ayrıl",
    },
    done: {
      claim: "{name} sorumlu hekim oldu.", add: "{name} ekibe eklendi.", promote: "{name} sorumlu hekim oldu.",
      remove: "{name} ekipten çıkarıldı.", leave: "{name} ekipten ayrıldı.",
    },
    ask: {
      title: "Yeni sorumlu hekim",
      body: "{name} sorumlu hekim olur; {previous} ekipten çıkar.",
      alone: "{name} sorumlu hekim olur.",
      confirm: "Onayla",
    },
    dialog: {
      title: "Ekibe ekle · {bed}",
      search: "Hekim ara",
      physician: "Hekim",
      loading: "Hekimler okunuyor…",
      failed: "Hekimler okunamadı: {reason}",
      none: "Eklenebilecek hekim yok.",
      noMatch: "Bu adla hekim yok.",
      role: "Ekipteki rolü",
      start: "Başlangıç",
      end: "Bitiş",
      windowHint: "Nöbet en çok 48 saat sürer.",
      submit: "Ekle",
      need: {
        physician: "Bir hekim seçin.",
        start: "Başlangıcı seçin.",
        end: "Bitişi seçin.",
        order: "Bitiş başlangıçtan sonra olmalı.",
        future: "Bitiş gelecekte olmalı.",
        long: "Nöbet en çok 48 saat sürer.",
      },
    },
    err: {
      conflict: "Bu hekim zaten ekipte ya da ekip aynı anda değişti.",
      notPhysician: "Bakım ekibine yalnız hekimler girer.",
      attendingRequired: "Sorumlu hekim ekipten tek başına çıkarılmaz; yeni sorumlu hekim atanınca biter.",
    },
    invalid: {
      windowStart: "Nöbetin başlangıcı geçersiz.",
      windowEnd: "Nöbetin bitişi geçersiz: başlangıçtan sonra, gelecekte ve en çok 48 saat sonra olmalı.",
    },
  },
  az: {
    title: "Baxım komandası",
    role: { ATTENDING: "Məsul həkim", ASSOCIATE_PHYSICIAN: "Köməkçi həkim", ONCALL_PHYSICIAN: "Növbətçi həkim" },
    draft: "Məsul həkim qəbul imzalandıqda təyin olunur.",
    loading: "Baxım komandası oxunur…",
    readFailed: "Baxım komandası oxunmadı: {reason}",
    empty: "Komandada heç kim yoxdur.",
    expired: "müddəti bitib",
    grantedBy: "əlavə edən: {name}",
    attendingStays: "Yeni məsul həkim təyin olunanda bitir.",
    previous: "Əvvəlki üzvlər ({n})",
    ended: "bitdi: {at}",
    working: "Baxım komandasında əməliyyat gedir…",
    action: {
      claim: "Məsul həkim ol", add: "Komandaya əlavə et", promote: "Məsul həkim et",
      remove: "Komandadan çıxar", leave: "Komandadan ayrıl",
    },
    done: {
      claim: "{name} məsul həkim oldu.", add: "{name} komandaya əlavə edildi.", promote: "{name} məsul həkim oldu.",
      remove: "{name} komandadan çıxarıldı.", leave: "{name} komandadan ayrıldı.",
    },
    ask: {
      title: "Yeni məsul həkim",
      body: "{name} məsul həkim olur; {previous} komandadan çıxır.",
      alone: "{name} məsul həkim olur.",
      confirm: "Təsdiq et",
    },
    dialog: {
      title: "Komandaya əlavə et · {bed}",
      search: "Həkim axtar",
      physician: "Həkim",
      loading: "Həkimlər oxunur…",
      failed: "Həkimlər oxunmadı: {reason}",
      none: "Əlavə edilə biləcək həkim yoxdur.",
      noMatch: "Bu adla həkim yoxdur.",
      role: "Komandadakı rolu",
      start: "Başlanğıc",
      end: "Son",
      windowHint: "Növbə ən çox 48 saat davam edir.",
      submit: "Əlavə et",
      need: {
        physician: "Həkim seçin.",
        start: "Başlanğıcı seçin.",
        end: "Sonu seçin.",
        order: "Son başlanğıcdan sonra olmalıdır.",
        future: "Son gələcəkdə olmalıdır.",
        long: "Növbə ən çox 48 saat davam edir.",
      },
    },
    err: {
      conflict: "Bu həkim artıq komandadadır, ya da komanda eyni anda dəyişdi.",
      notPhysician: "Baxım komandasına yalnız həkimlər daxil olur.",
      attendingRequired: "Məsul həkim komandadan tək çıxarılmır; yeni məsul həkim təyin olunanda bitir.",
    },
    invalid: {
      windowStart: "Növbənin başlanğıcı yanlışdır.",
      windowEnd: "Növbənin sonu yanlışdır: başlanğıcdan sonra, gələcəkdə və ən çox 48 saat sonra olmalıdır.",
    },
  },
  ru: {
    title: "Лечебная команда",
    role: { ATTENDING: "Лечащий врач", ASSOCIATE_PHYSICIAN: "Врач-ассистент", ONCALL_PHYSICIAN: "Дежурный врач" },
    draft: "Лечащий врач назначается при подписании приёма.",
    loading: "Лечебная команда загружается…",
    readFailed: "Не удалось прочитать лечебную команду: {reason}",
    empty: "В команде никого нет.",
    expired: "срок истёк",
    grantedBy: "добавил(а): {name}",
    attendingStays: "Заканчивается, когда назначен новый лечащий врач.",
    previous: "Прежние участники ({n})",
    ended: "завершено: {at}",
    working: "Лечебная команда изменяется…",
    action: {
      claim: "Стать лечащим врачом", add: "Добавить в команду", promote: "Назначить лечащим врачом",
      remove: "Исключить из команды", leave: "Выйти из команды",
    },
    done: {
      claim: "{name} — лечащий врач.", add: "{name}: добавлен(а) в команду.", promote: "{name} — лечащий врач.",
      remove: "{name}: исключён(а) из команды.", leave: "{name}: вышел(вышла) из команды.",
    },
    ask: {
      title: "Новый лечащий врач",
      body: "{name} становится лечащим врачом; {previous} выходит из команды.",
      alone: "{name} становится лечащим врачом.",
      confirm: "Подтвердить",
    },
    dialog: {
      title: "Добавить в команду · {bed}",
      search: "Найти врача",
      physician: "Врач",
      loading: "Врачи загружаются…",
      failed: "Не удалось прочитать список врачей: {reason}",
      none: "Нет врачей, которых можно добавить.",
      noMatch: "Врача с таким именем нет.",
      role: "Роль в команде",
      start: "Начало",
      end: "Конец",
      windowHint: "Дежурство длится не более 48 часов.",
      submit: "Добавить",
      need: {
        physician: "Выберите врача.",
        start: "Выберите начало.",
        end: "Выберите конец.",
        order: "Конец должен быть позже начала.",
        future: "Конец должен быть в будущем.",
        long: "Дежурство длится не более 48 часов.",
      },
    },
    err: {
      conflict: "Этот врач уже в команде, или команда изменилась в тот же момент.",
      notPhysician: "В лечебную команду входят только врачи.",
      attendingRequired: "Лечащего врача нельзя исключить отдельно: его роль заканчивается, когда назначен новый.",
    },
    invalid: {
      windowStart: "Неверное начало дежурства.",
      windowEnd: "Неверный конец дежурства: позже начала, в будущем и не более чем через 48 часов.",
    },
  },
  en: {
    title: "Care team",
    role: { ATTENDING: "Attending physician", ASSOCIATE_PHYSICIAN: "Associate physician", ONCALL_PHYSICIAN: "On-call physician" },
    draft: "The attending physician is set when the admission is signed.",
    loading: "Reading the care team…",
    readFailed: "The care team could not be read: {reason}",
    empty: "Nobody is on the team.",
    expired: "expired",
    grantedBy: "added by {name}",
    attendingStays: "Ends when a new attending physician is made.",
    previous: "Earlier members ({n})",
    ended: "ended: {at}",
    working: "The care team is being changed…",
    action: {
      claim: "Become the attending", add: "Add to the team", promote: "Make attending",
      remove: "Remove from the team", leave: "Leave the team",
    },
    done: {
      claim: "{name} is the attending physician.", add: "{name} was added to the team.",
      promote: "{name} is the attending physician.", remove: "{name} was removed from the team.",
      leave: "{name} left the team.",
    },
    ask: {
      title: "New attending physician",
      body: "{name} becomes the attending physician; {previous} leaves the team.",
      alone: "{name} becomes the attending physician.",
      confirm: "Confirm",
    },
    dialog: {
      title: "Add to the team · {bed}",
      search: "Find a physician",
      physician: "Physician",
      loading: "Reading the physicians…",
      failed: "The physicians could not be read: {reason}",
      none: "No physician can be added.",
      noMatch: "No physician by that name.",
      role: "Role on the team",
      start: "Start",
      end: "End",
      windowHint: "An on-call window lasts 48 hours at most.",
      submit: "Add",
      need: {
        physician: "Choose a physician.",
        start: "Choose the start.",
        end: "Choose the end.",
        order: "The end comes after the start.",
        future: "The end is in the future.",
        long: "An on-call window lasts 48 hours at most.",
      },
    },
    err: {
      conflict: "This physician is on the team already, or the team changed at the same moment.",
      notPhysician: "Only physicians are on a care team.",
      attendingRequired: "The attending physician is not removed alone; the role ends when a new attending is made.",
    },
    invalid: {
      windowStart: "The on-call window's start is not valid.",
      windowEnd: "The on-call window's end is not valid: after the start, in the future, and at most 48 hours later.",
    },
  },
};
```

In `dashboard/src/live/i18n/catalog.js` (G2-B3b's `devir` is the last namespace at `ea61714a`; the newest slice goes after it, as B5's and B3b's did):
- after the line `import devir from "./strings/devir.js";`, add a blank line, then
  ```js
  // G2-B1c: Bakım ekibi, the care-team box on the patient screen (screens/patient/careTeam).
  import ekip from "./strings/ekip.js";
  ```
- in `NAMESPACES`, after the line `  devir, // G2-B3b`, add a blank line and `  ekip, // G2-B1c`.

Keep the blank lines on either side, as the file's comments ask.

- [ ] **Step 3: The codes and the fields**

In `dashboard/src/live/apiErrors.js`:

1. Replace

```js
  ["bed_reserved", "kabul.err.bedReserved"],
]);
```

with

```js
  ["bed_reserved", "kabul.err.bedReserved"],

  // G2-B1c — Bakım ekibi (spec §5.6): the care-team box and its dialog say them, in `ekip`.
  ["care_team_conflict", "ekip.err.conflict"],
  ["care_team_not_physician", "ekip.err.notPhysician"],
  ["care_team_attending_required", "ekip.err.attendingRequired"],
]);
```

2. In `INVALID_FIELD_KEYS`, after G2-B3b's last field, the line `  ["narrative_note", NOT_ON_SCREEN],`, add:

```js
  // G2-B1c: the on-call window (admission/router.py `_check_window`).
  ["window_start", "ekip.invalid.windowStart"],
  ["window_end", "ekip.invalid.windowEnd"],
```

- [ ] **Step 4: The «Denetim bütünlüğü» page names the three events (X11)**

G2-B4's page names an engine event only through `EVENT_TYPES`; any other code shows as itself and is not offered in the «Tür» filter. B3a, B5 and B3b each added theirs (37 at `ea61714a`).

1. In `dashboard/src/live/screens/denetim/denetim.test.js`, in `names the engine's codes and leaves every other code to show as itself`, replace

```js
    expect(EVENT_TYPES).toHaveLength(37);   // G2-B3a's four bed moves + G2-B5's rrt_call + G2-B3b's three handover events
    expect(new Set(EVENT_TYPES.map((e) => e.code)).size).toBe(37);
```

with

```js
    expect(EVENT_TYPES).toHaveLength(40);   // G2-B3a's four bed moves + G2-B5's rrt_call + G2-B3b's three handover events + G2-B1c's three care-team events
    expect(new Set(EVENT_TYPES.map((e) => e.code)).size).toBe(40);
    expect(typeKey("care_team.attending")).toBe("denetim.type.careTeamAttending");   // G2-B1c (spec §5.5)
    expect(typeKey("care_team.add")).toBe("denetim.type.careTeamAdd");
    expect(typeKey("care_team.end")).toBe("denetim.type.careTeamEnd");
```

2. Run it and see it red:

```bash
cd /c/tmp/g2b-b1c/dashboard && ./node_modules/.bin/vitest run src/live/screens/denetim/denetim.test.js 2>&1 | tail -6
```

Expected: 1 failed, `expected [ … ] to have a length of 40 but got 37`.

3. In `dashboard/src/live/screens/denetim/denetim.js`, after the line

```js
  ["handover.open", "handoverOpen"], ["handover.sign_outgoing", "handoverSign"], ["handover.countersign", "handoverCountersign"],
```

add:

```js
  // G2-B1c (spec §5.5): the care team — an attending made (at sign-off, by a claim or an add), a member added, a row ended.
  ["care_team.attending", "careTeamAttending"], ["care_team.add", "careTeamAdd"], ["care_team.end", "careTeamEnd"],
```

4. In `dashboard/src/live/i18n/strings/denetim.js`, in `type` of each language, after that language's handover line, add the language's line below. The handover lines are, in order: `      handoverOpen: "Devir açıldı", handoverSign: "Devir imzalandı", handoverCountersign: "Devir karşı imzalandı",` (tr); `      handoverOpen: "Təhvil açıldı", handoverSign: "Təhvil imzalandı", handoverCountersign: "Təhvilə əks-imza atıldı",` (az); `      handoverOpen: "Передача открыта", handoverSign: "Передача подписана", handoverCountersign: "Передача подписана принимающим",` (ru); `      handoverOpen: "Handover opened", handoverSign: "Handover signed", handoverCountersign: "Handover countersigned",` (en).

```js
      // G2-B1c (spec §5.5): the care team's three events
      careTeamAttending: "Sorumlu hekim atandı", careTeamAdd: "Bakım ekibine eklendi", careTeamEnd: "Bakım ekibinden çıkış",
```

```js
      // G2-B1c (spec §5.5): the care team's three events
      careTeamAttending: "Məsul həkim təyin edildi", careTeamAdd: "Baxım komandasına əlavə edildi", careTeamEnd: "Baxım komandasından çıxış",
```

```js
      // G2-B1c (spec §5.5): the care team's three events
      careTeamAttending: "Назначен лечащий врач", careTeamAdd: "Добавление в лечебную команду", careTeamEnd: "Выход из лечебной команды",
```

```js
      // G2-B1c (spec §5.5): the care team's three events
      careTeamAttending: "Attending physician made", careTeamAdd: "Added to the care team", careTeamEnd: "Left the care team",
```

`care_team.end` is both an assigner's removal and a member's own leaving (its payload's `self`); the label names the leaving, not who did it. These az, ru and en texts await a native reading with the rest (O48).

5. Same command as item 2. Expected: all passed.

- [ ] **Step 5: Run the guards and every string test, and see them green**

```bash
cd /c/tmp/g2b-b1c/dashboard && ./node_modules/.bin/vitest run src/live/apiErrors.test.js src/live/i18n src/live/screens/denetim src/live/rawKeys.test.jsx 2>&1 | tail -8
```

Expected: all passed.

If `strings.test.js` reports an `az` text equal to `tr`, or an `ru` text with no Cyrillic, change the wording. Do not list it.

- [ ] **Step 6: Line ends, then commit**

```bash
cd /c/tmp/g2b-b1c && /c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" dashboard/src/live/i18n/strings/ekip.js
for f in dashboard/src/live/i18n/strings/ekip.js dashboard/src/live/i18n/catalog.js dashboard/src/live/apiErrors.js dashboard/src/live/apiErrors.test.js dashboard/src/live/screens/denetim/denetim.js dashboard/src/live/screens/denetim/denetim.test.js dashboard/src/live/i18n/strings/denetim.js; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- dashboard/src/live/i18n/strings/ekip.js dashboard/src/live/i18n/catalog.js dashboard/src/live/apiErrors.js dashboard/src/live/apiErrors.test.js dashboard/src/live/screens/denetim/denetim.js dashboard/src/live/screens/denetim/denetim.test.js dashboard/src/live/i18n/strings/denetim.js
git status --short && git diff --cached --stat
git commit -m "feat(dashboard): the care team's words in four languages, its three refusal codes, its two window fields, and its three audit events named on «Denetim bütünlüğü» (G2-B1c, §4, §5.5, §5.6, X11)" -m "Red: apiErrors.test (care_team_* unmapped; field_invalid:window_start/end read the generic sentence; 33 codes); denetim.test (EVENT_TYPES 37, not 40)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/live/i18n/strings/ekip.js dashboard/src/live/i18n/catalog.js dashboard/src/live/apiErrors.js dashboard/src/live/apiErrors.test.js dashboard/src/live/screens/denetim/denetim.js dashboard/src/live/screens/denetim/denetim.test.js dashboard/src/live/i18n/strings/denetim.js
```

---

### Task 14: What the box knows — `careTeam.js` (spec §4, T1, T5, T8; X4)

**Files:**
- Create: `dashboard/src/live/screens/patient/careTeam/careTeam.js`
- Create: `dashboard/src/live/screens/patient/careTeam/careTeam.test.js`

- [ ] **Step 1: Write the failing test**

Create `dashboard/src/live/screens/patient/careTeam/careTeam.test.js`:

```js
// The «Bakım ekibi» box's rules (G2-B1c, spec §4, T1, T5, T8, X4). Pure.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ONCALL_MAX_MS, PHYSICIAN_GROUPS, actionsFor, activeRows, attendingOf, canClaim, closedRows,
  expired, isPhysician, matchesName, windowProblem,
} from "./careTeam.js";

const NOW = Date.parse("2026-11-09T12:00:00Z");
const HOUR = 3_600_000;
const row = (over = {}) => ({
  id: "r-1", user_id: "u-1", full_name: "Sentetik Həkim", role: "ASSOCIATE_PHYSICIAN",
  window_start: null, window_end: null, is_active: true, ...over,
});
const user = (slugs, id = "u-ayse") => ({ id, groups: slugs.map((slug) => ({ slug, name: slug })) });
const ASSIGN = ["admissions.view", "care_team.assign"];
const NONE = { promote: false, remove: false, leave: false };

describe("who is a physician (T1)", () => {
  it("is a member of a physician role group, and nobody else", () => {
    for (const slug of ["attending", "unit_physician", "physician"]) expect(isPhysician(user([slug]))).toBe(true);
    for (const slugs of [["nurse"], ["nurse", "charge_nurse"], ["hospital_admin"], []]) {
      expect(isPhysician(user(slugs))).toBe(false);
    }
    expect(isPhysician(null)).toBe(false);
  });

  it("holds the server's physician groups and on-call bound (admission/service.py)", () => {
    const py = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),
      "../../../../../../homunculus-engine/src/homunculus/admission/service.py"), "utf8");
    const groups = /^PHYSICIAN_GROUPS = \(([^)]*)\)/m.exec(py)[1];
    expect([...groups.matchAll(/"(\w+)"/g)].map((m) => m[1])).toEqual([...PHYSICIAN_GROUPS]);
    expect(Number(/^ONCALL_MAX_WINDOW = timedelta\(hours=(\d+)\)/m.exec(py)[1]) * HOUR).toBe(ONCALL_MAX_MS);
  });
});

describe("the team and its history", () => {
  const rows = [row({ id: "a", role: "ATTENDING" }), row({ id: "b" }), row({ id: "c", is_active: false })];

  it("splits the active rows from the closed ones, in the server's order, and finds the attending", () => {
    expect(activeRows(rows).map((r) => r.id)).toEqual(["a", "b"]);
    expect(closedRows(rows).map((r) => r.id)).toEqual(["c"]);
    expect(attendingOf(rows).id).toBe("a");
    expect(attendingOf([row()])).toBeNull();
    expect(activeRows(undefined)).toEqual([]);
  });

  it("says an on-call window has passed, and only an on-call one", () => {
    const oncall = (endMs) => row({
      role: "ONCALL_PHYSICIAN", window_start: new Date(endMs - 8 * HOUR).toISOString(), window_end: new Date(endMs).toISOString(),
    });
    expect(expired(oncall(NOW - HOUR), NOW)).toBe(true);
    expect(expired(oncall(NOW + HOUR), NOW)).toBe(false);
    expect(expired(row({ window_end: new Date(NOW - HOUR).toISOString() }), NOW)).toBe(false);
  });
});

describe("the buttons (§4)", () => {
  it("offers nothing on the attending's row (T5)", () => {
    expect(actionsFor(row({ role: "ATTENDING" }), { user: user(["attending"]), perms: ASSIGN })).toEqual(NONE);
  });

  it("lets an assigner make another's row the attending, or remove it", () => {
    expect(actionsFor(row(), { user: user(["attending"]), perms: ASSIGN })).toEqual({ promote: true, remove: true, leave: false });
  });

  it("lets a member leave her own row, with or without care_team.assign", () => {
    const own = row({ user_id: "u-ayse" });
    expect(actionsFor(own, { user: user(["physician"]), perms: ["admissions.view"] })).toEqual({ promote: false, remove: false, leave: true });
    expect(actionsFor(own, { user: user(["attending"]), perms: ASSIGN })).toEqual({ promote: true, remove: false, leave: true });
  });

  it("offers nothing on a closed row, nor to a reader without a right", () => {
    expect(actionsFor(row({ is_active: false }), { user: user(["attending"]), perms: ASSIGN })).toEqual(NONE);
    expect(actionsFor(row(), { user: user(["nurse"]), perms: ["admissions.view"] })).toEqual(NONE);
  });

  it("offers «Sorumlu hekim ol» to a physician holding care_team.claim who is not the attending", () => {
    const claim = ["admissions.view", "care_team.claim"];
    const attending = row({ role: "ATTENDING", user_id: "u-other" });
    expect(canClaim({ user: user(["attending"]), perms: claim, attending })).toBe(true);
    expect(canClaim({ user: user(["attending"]), perms: claim, attending: { ...attending, user_id: "u-ayse" } })).toBe(false);
    expect(canClaim({ user: user(["nurse", "charge_nurse"]), perms: claim, attending })).toBe(false);    // D7, T1
    expect(canClaim({ user: user(["physician"]), perms: ["admissions.view"], attending })).toBe(false);
  });
});

describe("the on-call window (§5.2)", () => {
  it("names what is wrong with it, in the dialog's order", () => {
    expect(windowProblem(Number.NaN, NOW + HOUR, NOW)).toBe("start");
    expect(windowProblem(NOW, Number.NaN, NOW)).toBe("end");
    expect(windowProblem(NOW, NOW, NOW)).toBe("order");
    expect(windowProblem(NOW - 10 * HOUR, NOW - 2 * HOUR, NOW)).toBe("future");
    expect(windowProblem(NOW, NOW + 49 * HOUR, NOW)).toBe("long");
    expect(windowProblem(NOW, NOW + 48 * HOUR, NOW)).toBeNull();
  });
});

describe("the picker's search", () => {
  it("finds a name by any part of it, whatever its case and its dotted or dotless i", () => {
    expect(matchesName("Sentetik Növbətçi", "növ")).toBe(true);
    expect(matchesName("İlkin Qasımov", "ilkin")).toBe(true);
    expect(matchesName("Ilkin Qasımov", "qasim")).toBe(true);
    expect(matchesName("Sentetik Həkim", "  ")).toBe(true);
    expect(matchesName("Sentetik Həkim", "köm")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and see it red**

```bash
cd /c/tmp/g2b-b1c/dashboard && ./node_modules/.bin/vitest run src/live/screens/patient/careTeam/careTeam.test.js 2>&1 | tail -6
```

Expected: the file fails to load, `Failed to resolve import "./careTeam.js"`.

- [ ] **Step 3: Write `careTeam.js`**

Create `dashboard/src/live/screens/patient/careTeam/careTeam.js`:

```js
// src/live/screens/patient/careTeam/careTeam.js — what the «Bakım ekibi» box knows without React
// (Group 2 · B1c, spec §4, T1, T5, T8). Pure.
//
// - Who a physician is: the session's role groups (T1). This is a display hint only: the server checks
//   again (admission/service.py PHYSICIAN_GROUPS, held equal by careTeam.test.js) and refuses
//   `care_team_not_physician`.
// - Which rows are the team now, which are its history, and which one is the attending's.
// - Which buttons a row offers this session (§4's table).
// - Whether an on-call window is one the server takes: an end after the start, in the future, and at
//   most 48 hours after the start (`ONCALL_MAX_MS`).

/** The default ROLE groups whose members are physicians (admission/service.py PHYSICIAN_GROUPS). */
export const PHYSICIAN_GROUPS = Object.freeze(["attending", "unit_physician", "physician"]);
/** The longest on-call window the server takes (admission/service.py ONCALL_MAX_WINDOW). */
export const ONCALL_MAX_MS = 48 * 3_600_000;
/** The roles, in the add dialog's order (spec §4: Yardımcı hekim / Nöbetçi hekim / Sorumlu hekim). */
export const ROLES = Object.freeze(["ASSOCIATE_PHYSICIAN", "ONCALL_PHYSICIAN", "ATTENDING"]);
/** The admissions the box looks among. A DRAFT says the attending comes with the signature (D3). */
export const OPEN = Object.freeze(["DRAFT", "ACTIVE", "PENDING_DISCHARGE"]);

/** Whether the session is a physician's (T1). */
export const isPhysician = (user) =>
  (Array.isArray(user?.groups) ? user.groups : []).some((g) => PHYSICIAN_GROUPS.includes(g?.slug));

const rowsOf = (rows) => (Array.isArray(rows) ? rows : []);
/** The team now: the active rows, in the server's order (the newest first). */
export const activeRows = (rows) => rowsOf(rows).filter((r) => r.is_active);
/** The history: the closed rows, newest first. */
export const closedRows = (rows) => rowsOf(rows).filter((r) => !r.is_active);
/** The attending's row (D2: exactly one while the team lives), or null. */
export const attendingOf = (rows) => activeRows(rows).find((r) => r.role === "ATTENDING") ?? null;

/** An on-call row whose window has passed. It grants nothing (F9), and the screen says so. */
export function expired(row, nowMs) {
  if (row?.role !== "ONCALL_PHYSICIAN" || !row.window_end) return false;
  const end = Date.parse(row.window_end);
  return Number.isFinite(end) && end < nowMs;
}

const same = (a, b) => a != null && b != null && String(a) === String(b);

/** §4's buttons on one row, for this session. The attending's row has none (T5): it ends when another
 *  attending is made. A member's own row offers «Ekipten ayrıl» instead of «Ekipten çıkar». */
export function actionsFor(row, { user, perms }) {
  const assign = (perms ?? []).includes("care_team.assign");
  const open = Boolean(row?.is_active) && row.role !== "ATTENDING";
  const own = same(row?.user_id, user?.id);
  return { promote: open && assign, remove: open && assign && !own, leave: open && own };
}

/** «Sorumlu hekim ol»: a `care_team.claim` holder who is a physician and not the attending. */
export function canClaim({ user, perms, attending }) {
  return (perms ?? []).includes("care_team.claim") && isPhysician(user) && !same(attending?.user_id, user?.id);
}

/** What is wrong with an on-call window, as the last part of its `ekip.dialog.need.*` key, or null. */
export function windowProblem(startMs, endMs, nowMs) {
  if (!Number.isFinite(startMs)) return "start";
  if (!Number.isFinite(endMs)) return "end";
  if (endMs <= startMs) return "order";
  if (endMs <= nowMs) return "future";
  if (endMs - startMs > ONCALL_MAX_MS) return "long";
  return null;
}

/** A name folded for the picker's search: lower case, accents off, and the dotless ı read as i, so
 *  «ilkin» finds «İlkin» and «qasim» finds «Qasımov». */
const fold = (text) => String(text ?? "").toLowerCase().normalize("NFD")
  .replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");

/** Whether a name holds what was typed in the picker's search. An empty search holds every name. */
export function matchesName(name, query) {
  const wanted = fold(query).trim();
  return wanted === "" || fold(name).includes(wanted);
}
```

- [ ] **Step 4: Run it and see it green**

Same command as Step 2. Expected: `11 passed`.

- [ ] **Step 5: Line ends, then commit**

```bash
cd /c/tmp/g2b-b1c && for f in dashboard/src/live/screens/patient/careTeam/careTeam.js dashboard/src/live/screens/patient/careTeam/careTeam.test.js; do /c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" "$f"; printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- dashboard/src/live/screens/patient/careTeam/careTeam.js dashboard/src/live/screens/patient/careTeam/careTeam.test.js
git status --short && git diff --cached --stat
git commit -m "feat(dashboard): what the care-team box knows — who is a physician, the team and its history, each row's buttons, the on-call window (G2-B1c, §4, T1, T5, T8)" -m "The physician groups and the 48-hour bound are held equal to admission/service.py by the test. Red: the module did not exist." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/live/screens/patient/careTeam/careTeam.js dashboard/src/live/screens/patient/careTeam/careTeam.test.js
```

---

### Task 15: «Ekibe ekle» — the add dialog (spec §4, D8, T8; X6, X9)

**Files:**
- Create: `dashboard/src/live/screens/patient/careTeam/AddMemberDialog.jsx`
- Create: `dashboard/src/live/screens/patient/careTeam/AddMemberDialog.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `dashboard/src/live/screens/patient/careTeam/AddMemberDialog.test.jsx`:

```jsx
// «Ekibe ekle» (G2-B1c, spec §4, D8, T8, X6, X9): the candidates by name, a search over them, the role,
// and for an on-call physician her window — an end after the start, in the future, at most 48 hours
// later. Making a new attending says who leaves. The server checks it all again; a refusal goes on the
// toast, named after the bed, and the box reads the team again.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { mount, refusal } from "../../../session/mount.testutil.jsx";
import { profile, token } from "../../../session/testTokens.testutil.js";
import { expectNoUuid, settle, toasts } from "../../kabul/kabul.testutil.js";
import { fromLocalInput, localInput } from "../../kabul/DischargeDialog.jsx";
import { AddMemberDialog } from "./AddMemberDialog.jsx";

const ADM = "77777777-7777-4777-8777-777777777701";
const ONC = "66666666-6666-4666-8666-666666666602";
const ASC = "66666666-6666-4666-8666-666666666603";
const SUBJECT = "2 · Otaq 1 · Reanimasiya";
const HOUR = 3_600_000;
const ASSIGN = ["board.view", "admissions.view", "care_team.assign"];
const CANDIDATES = [{ user_id: ASC, full_name: "Sentetik Köməkçi" }, { user_id: ONC, full_name: "Sentetik Növbətçi" }];
const ATTENDING = { user_id: "66666666-6666-4666-8666-666666666601", full_name: "Sentetik Həkim" };

const dialog = () => screen.getByRole("dialog");
const submit = () => act(async () => { fireEvent.click(within(dialog()).getByRole("button", { name: "Əlavə et" })); });
const pick = (name) => fireEvent.click(within(dialog()).getByRole("radio", { name }));

async function open({ candidates = CANDIDATES, setup } = {}) {
  const done = vi.fn(async () => {});
  const refused = vi.fn();
  const mounted = await mount(
    <AddMemberDialog admissionId={ADM} subject={SUBJECT} attending={ATTENDING} onClose={() => {}} onDone={done}
      onRefused={refused} />,
    {
      access: token({ perms: ASSIGN }), me: profile({ perms: ASSIGN }),
      setup: (api) => {
        if (candidates instanceof Error) api.careTeamCandidates.mockRejectedValue(candidates);
        else api.careTeamCandidates.mockResolvedValue(candidates);
        setup?.(api);
      },
    });
  await settle();
  return { ...mounted, done, refused };
}

describe("AddMemberDialog", () => {
  it("lists the candidates by name, narrows them as the search is typed, and shows no id", async () => {
    const { api } = await open();
    expect(api.careTeamCandidates).toHaveBeenCalledWith(ADM);
    expect(within(dialog()).getByRole("radio", { name: "Sentetik Köməkçi" })).toBeTruthy();
    fireEvent.change(within(dialog()).getByLabelText("Həkim axtar"), { target: { value: "növ" } });
    expect(within(dialog()).queryByRole("radio", { name: "Sentetik Köməkçi" })).toBeNull();
    expect(within(dialog()).getByRole("radio", { name: "Sentetik Növbətçi" })).toBeTruthy();
    fireEvent.change(within(dialog()).getByLabelText("Həkim axtar"), { target: { value: "xyz" } });
    expect(within(dialog()).getByText("Bu adla həkim yoxdur.")).toBeTruthy();
    expectNoUuid();
  });

  it("adds an associate by default, says so, and hands the words back to the box", async () => {
    const { api, done } = await open({ setup: (a) => a.addCareTeamMember.mockResolvedValue({}) });
    pick("Sentetik Köməkçi");
    expect(within(dialog()).getByRole("radio", { name: "Köməkçi həkim" })).toBeChecked();
    await submit();
    await settle();
    expect(api.addCareTeamMember).toHaveBeenCalledWith(ADM, { user_id: ASC, role: "ASSOCIATE_PHYSICIAN" });
    expect(toasts().getAllByText(`${SUBJECT} · Sentetik Köməkçi komandaya əlavə edildi.`).length).toBeGreaterThan(0);
    expect(done).toHaveBeenCalledWith("Sentetik Köməkçi komandaya əlavə edildi.");
  });

  it("asks for a physician before it sends anything", async () => {
    const { api } = await open();
    await submit();
    expect(within(dialog()).getByText("Həkim seçin.")).toBeTruthy();
    expect(api.addCareTeamMember).not.toHaveBeenCalled();
  });

  it("asks an on-call window for an end after its start, in the future and within 48 hours", async () => {
    const { api } = await open({ setup: (a) => a.addCareTeamMember.mockResolvedValue({}) });
    pick("Sentetik Növbətçi");
    pick("Növbətçi həkim");
    const set = (label, ms) => fireEvent.change(within(dialog()).getByLabelText(label), { target: { value: localInput(ms) } });
    const START = /^Başlanğıc/;
    const END = /^Son/;
    const now = Date.now();
    await submit();
    expect(within(dialog()).getByText("Sonu seçin.")).toBeTruthy();
    set(START, now);
    set(END, now - HOUR);
    await submit();
    expect(within(dialog()).getByText("Son başlanğıcdan sonra olmalıdır.")).toBeTruthy();
    set(START, now - 10 * HOUR);
    set(END, now - 2 * HOUR);
    await submit();
    expect(within(dialog()).getByText("Son gələcəkdə olmalıdır.")).toBeTruthy();
    set(START, now);
    set(END, now + 49 * HOUR);
    await submit();
    // The hint under the end says it, and so does the refusal.
    expect(within(dialog()).getAllByText("Növbə ən çox 48 saat davam edir.")).toHaveLength(2);
    expect(api.addCareTeamMember).not.toHaveBeenCalled();
    set(END, now + 12 * HOUR);
    await submit();
    await settle();
    expect(api.addCareTeamMember).toHaveBeenCalledWith(ADM, {
      user_id: ONC, role: "ONCALL_PHYSICIAN",
      window_start: new Date(fromLocalInput(localInput(now))).toISOString(),
      window_end: new Date(fromLocalInput(localInput(now + 12 * HOUR))).toISOString(),
    });
  });

  it("says who leaves before a new attending is made, and sends the role", async () => {
    const { api, done } = await open({ setup: (a) => a.addCareTeamMember.mockResolvedValue({}) });
    pick("Sentetik Köməkçi");
    pick("Məsul həkim");
    expect(within(dialog()).getByText("Sentetik Köməkçi məsul həkim olur; Sentetik Həkim komandadan çıxır.")).toBeTruthy();
    await submit();
    await settle();
    expect(api.addCareTeamMember).toHaveBeenCalledWith(ADM, { user_id: ASC, role: "ATTENDING" });
    expect(done).toHaveBeenCalledWith("Sentetik Köməkçi məsul həkim oldu.");
  });

  it("puts a refusal on the toast by its code, named after the bed, and tells the box", async () => {
    const { done, refused } = await open({ setup: (a) => a.addCareTeamMember.mockRejectedValue(
      refusal(409, "English words", { apiCode: "care_team_not_physician" })) });
    pick("Sentetik Köməkçi");
    await submit();
    await settle();
    expect(toasts().getAllByText(`${SUBJECT}: Baxım komandasına yalnız həkimlər daxil olur.`).length).toBeGreaterThan(0);
    expect(refused).toHaveBeenCalledTimes(1);
    expect(done).not.toHaveBeenCalled();
  });

  it("says when the physicians cannot be read", async () => {
    await open({ candidates: refusal(503, "down") });
    expect(within(dialog()).getByText(/^Həkimlər oxunmadı: /)).toBeTruthy();
  });

  it("says when nobody can be added", async () => {
    await open({ candidates: [] });
    expect(within(dialog()).getByText("Əlavə edilə biləcək həkim yoxdur.")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it and see it red**

```bash
cd /c/tmp/g2b-b1c/dashboard && ./node_modules/.bin/vitest run src/live/screens/patient/careTeam/AddMemberDialog.test.jsx 2>&1 | tail -6
```

Expected: the file fails to load, `Failed to resolve import "./AddMemberDialog.jsx"`.

- [ ] **Step 3: Write the dialog**

Create `dashboard/src/live/screens/patient/careTeam/AddMemberDialog.jsx`:

```jsx
// src/live/screens/patient/careTeam/AddMemberDialog.jsx — «Ekibe ekle» (Group 2 · B1c, spec §4, D8, T8).
//
// - The physician is picked by NAME from the candidates route: every physician of the tenant, from every
//   unit, who is not already on the team (D8). No id is shown; the radio holds none.
// - The role: Yardımcı hekim, Nöbetçi hekim or Sorumlu hekim. An on-call physician needs her window: a
//   start (now by default) and an end, at most 48 hours later and in the future (`windowProblem`). The
//   two ends go out as instants with their offset (X9).
// - Making a new attending says, above the button, who leaves: «<ad> sorumlu hekim olur; <önceki> ekipten
//   çıkar.» The button is the answer to that one question (X6).
// The server checks all of it again. A refusal goes on the toast, named after the bed, and the box reads
// the team again (`onRefused`). A success is said on the toast and handed to the box (`onDone`), which
// reads the team before the dialog lets go of its buttons.
import React, { useEffect, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { useSession } from "../../../session/SessionProvider.jsx";
import { readErrorText } from "../../../apiErrors.js";
import { Button, Field, Input, Modal, Note, useToast } from "../../../ui/index.js";
import { FOCUS_RING } from "../../../ui/focus.js";
import { doneFor, reasonOf, refusedFor } from "../../admin/refusal.js";
import { fromLocalInput, localInput } from "../../kabul/DischargeDialog.jsx";
import { ROLES, matchesName, windowProblem } from "./careTeam.js";

const FORM_ID = "ekip-add";

/** `subject`: the bed, "label · room · unit". `attending`: the attending's row, or null. `onDone(text)`
 *  is awaited; `onRefused` is not. */
export function AddMemberDialog({ admissionId, subject, attending, onClose, onDone, onRefused }) {
  const { t } = useI18n();
  const { store } = useSession();
  const toast = useToast();
  const [candidates, setCandidates] = useState({ rows: null, error: null });
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState(null);
  const [role, setRole] = useState("ASSOCIATE_PHYSICIAN");
  const [start, setStart] = useState(() => localInput(Date.now()));
  const [end, setEnd] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const rows = await store.track(() => store.api.careTeamCandidates(admissionId));
        if (live) setCandidates({ rows: Array.isArray(rows) ? rows : [], error: null });
      } catch (error) {
        if (live) setCandidates({ rows: [], error });
      }
    })();
    return () => { live = false; };
  }, [store, admissionId]);

  const all = candidates.rows ?? [];
  const shown = all.filter((c) => matchesName(c.full_name, query));
  const person = all.find((c) => c.user_id === chosen) ?? null;
  const oncall = role === "ONCALL_PHYSICIAN";
  const startMs = fromLocalInput(start);
  const endMs = fromLocalInput(end);
  const problem = oncall ? windowProblem(startMs, endMs, Date.now()) : null;
  const errors = {
    physician: person ? null : t("ekip.dialog.need.physician"),
    start: problem === "start" ? t("ekip.dialog.need.start") : null,
    end: problem && problem !== "start" ? t(`ekip.dialog.need.${problem}`) : null,
  };
  const physicianError = `${FORM_ID}-physician-error`;

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (errors.physician || errors.start || errors.end) {
      setTried(true);
      return;
    }
    setBusy(true);
    const body = oncall
      ? { user_id: person.user_id, role, window_start: new Date(startMs).toISOString(), window_end: new Date(endMs).toISOString() }
      : { user_id: person.user_id, role };
    try {
      await store.track(() => store.api.addCareTeamMember(admissionId, body));
      const said = t(role === "ATTENDING" ? "ekip.done.promote" : "ekip.done.add", { name: person.full_name });
      toast(doneFor(t, subject, said));
      await onDone(said);
    } catch (err) {
      toast(refusedFor(t, subject, reasonOf(t, err)), "error");
      onRefused?.();
    } finally {
      setBusy(false);
    }
  }

  let list;
  if (candidates.rows === null) list = <p className="m-0 text-13 text-mute">{t("ekip.dialog.loading")}</p>;
  else if (candidates.error) {
    list = <p className="m-0 text-13 text-crit-ink">{t("ekip.dialog.failed", { reason: readErrorText(t, candidates.error) })}</p>;
  } else if (all.length === 0) list = <p className="m-0 text-13 text-mute">{t("ekip.dialog.none")}</p>;
  else if (shown.length === 0) list = <p className="m-0 text-13 text-mute">{t("ekip.dialog.noMatch")}</p>;
  else {
    list = (
      <ul className="m-0 grid max-h-[220px] list-none gap-1 overflow-y-auto p-0">
        {shown.map((c) => (
          <li key={c.user_id}>
            <label className="inline-flex items-center gap-1.5 text-13.5">
              <input type="radio" name={`${FORM_ID}-physician`} checked={chosen === c.user_id} disabled={busy}
                onChange={() => setChosen(c.user_id)} className={FOCUS_RING} />
              {c.full_name}
            </label>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Modal open title={t("ekip.dialog.title", { bed: subject })} onClose={onClose} busy={busy}
      actions={(
        <>
          <Button onClick={onClose} busy={busy}>{t("common.cancel")}</Button>
          <Button type="submit" form={FORM_ID} variant="primary" icon="userPlus" busy={busy}>{t("ekip.dialog.submit")}</Button>
        </>
      )}>
      <form id={FORM_ID} noValidate onSubmit={submit}>
        <Field label={t("ekip.dialog.search")}>
          <Input type="search" value={query} readOnly={busy} onChange={(e) => setQuery(e.target.value)} />
        </Field>
        <fieldset className="mb-2.5 min-w-0 border-0 p-0"
          aria-describedby={tried && errors.physician ? physicianError : undefined}>
          <legend className="mb-1.5 text-13.5 font-semibold text-mute">{t("ekip.dialog.physician")}</legend>
          {list}
          {tried && errors.physician
            ? <p id={physicianError} role="alert" className="m-0 mt-1 text-12.5 text-crit-ink">{errors.physician}</p>
            : null}
        </fieldset>
        <fieldset className="mb-2.5 min-w-0 border-0 p-0">
          <legend className="mb-1.5 text-13.5 font-semibold text-mute">{t("ekip.dialog.role")}</legend>
          <div className="flex flex-wrap gap-3">
            {ROLES.map((value) => (
              <label key={value} className="inline-flex items-center gap-1.5 text-13.5">
                <input type="radio" name={`${FORM_ID}-role`} checked={role === value} disabled={busy}
                  onChange={() => setRole(value)} className={FOCUS_RING} />
                {t(`ekip.role.${value}`)}
              </label>
            ))}
          </div>
        </fieldset>
        {oncall ? (
          <>
            <Field label={t("ekip.dialog.start")} required error={tried ? errors.start ?? undefined : undefined}>
              <Input type="datetime-local" value={start} readOnly={busy} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label={t("ekip.dialog.end")} required hint={t("ekip.dialog.windowHint")}
              error={tried ? errors.end ?? undefined : undefined}>
              <Input type="datetime-local" value={end} readOnly={busy} onChange={(e) => setEnd(e.target.value)} />
            </Field>
          </>
        ) : null}
        {role === "ATTENDING" && person ? (
          <Note tone="warn" icon="alert">
            {attending
              ? t("ekip.ask.body", { name: person.full_name, previous: attending.full_name })
              : t("ekip.ask.alone", { name: person.full_name })}
          </Note>
        ) : null}
      </form>
    </Modal>
  );
}
```

- [ ] **Step 4: Run it and see it green**

Same command as Step 2. Expected: `8 passed`.

`Field` labels its child through the child's id. If `getByLabelText(/^Başlanğıc/)` does not find the input, read `ui/Field.jsx` and give the input the id `Field` expects, as `DischargeDialog.jsx` does. Name the change in the report.

- [ ] **Step 5: Line ends, then commit**

```bash
cd /c/tmp/g2b-b1c && for f in dashboard/src/live/screens/patient/careTeam/AddMemberDialog.jsx dashboard/src/live/screens/patient/careTeam/AddMemberDialog.test.jsx; do /c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" "$f"; printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- dashboard/src/live/screens/patient/careTeam/AddMemberDialog.jsx dashboard/src/live/screens/patient/careTeam/AddMemberDialog.test.jsx
git status --short && git diff --cached --stat
git commit -m "feat(dashboard): «Ekibe ekle» — a physician by name from every unit, her role, an on-call window of at most 48 hours, and who leaves before a new attending (G2-B1c, §4, D8, X6, X9)" -m "Red: the component did not exist." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/live/screens/patient/careTeam/AddMemberDialog.jsx dashboard/src/live/screens/patient/careTeam/AddMemberDialog.test.jsx
```

---

### Task 16: The «Bakım ekibi» box on the patient screen (spec §4, D1–D8; X6, X7)

**Files:**
- Create: `dashboard/src/live/screens/patient/careTeam/CareTeamBox.jsx`
- Create: `dashboard/src/live/screens/patient/careTeam/CareTeamBox.test.jsx`
- Modify: `dashboard/src/live/screens/patient/PatientScreen.jsx`

- [ ] **Step 1: Write the failing tests**

Create `dashboard/src/live/screens/patient/careTeam/CareTeamBox.test.jsx`:

```jsx
// «Bakım ekibi» on the patient screen (G2-B1c, spec §4, D1–D8, X6, X7): the team by name, with roles,
// windows, «müddəti bitib» and who added each member; the history folded; each action behind its gate;
// one write at a time, held until its re-read is in; the focus kept when a row leaves; no id on screen.
import { describe, it, expect } from "vitest";
import React from "react";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { mount, refusal } from "../../../session/mount.testutil.jsx";
import { profile, token } from "../../../session/testTokens.testutil.js";
import { ddmmhhmm } from "../../../i18n/dates.js";
import { board, entry, identity, measured } from "../../../data/board.testutil.js";
import { answering } from "../trends/trends.testutil.js";
import { emptyFluids } from "../fluids/fluids.testutil.js";
import { BED, REA, expectNoUuid, mountKabul, row as admissionRow, settle, toasts } from "../../kabul/kabul.testutil.js";
import { PatientScreen } from "../PatientScreen.jsx";
import { CareTeamBox } from "./CareTeamBox.jsx";

const NOW = Date.parse("2026-11-09T12:00:00Z");
const KEY = "202600000001";
const ADM = "77777777-7777-4777-8777-777777777701";
const DOC = "66666666-6666-4666-8666-666666666601";
const ONC = "66666666-6666-4666-8666-666666666602";
const ASC = "66666666-6666-4666-8666-666666666603";
const ROW = (n) => `88888888-8888-4888-8888-8888888888${String(n).padStart(2, "0")}`;
const BED_2 = "2 · Otaq 1 · Reanimasiya";
const W0 = "2026-11-09T00:00:00Z";
const W1 = "2026-11-09T08:00:00Z";
const ENDED = "2026-11-08T08:00:00Z";
const ACTIVE = admissionRow({ id: ADM, state: "ACTIVE", board_key: KEY, protocol_no: KEY });
const member = (over) => ({
  id: ROW(1), admission_id: ADM, user_id: DOC, full_name: "Sentetik Həkim", role: "ATTENDING",
  granted_by_id: DOC, granted_by_name: "Sentetik Həkim", window_start: null, window_end: null,
  is_active: true, in_force: true, created_at: "2026-11-09T06:00:00Z", closed_at: null, ...over,
});
const ATTENDING = member();
const ONCALL = member({ id: ROW(2), user_id: ONC, full_name: "Sentetik Növbətçi", role: "ONCALL_PHYSICIAN",
  window_start: W0, window_end: W1, in_force: false });
const ASSOCIATE = member({ id: ROW(3), user_id: ASC, full_name: "Sentetik Köməkçi", role: "ASSOCIATE_PHYSICIAN" });
const CLOSED = member({ id: ROW(4), user_id: ASC, full_name: "Sentetik Köməkçi", role: "ONCALL_PHYSICIAN",
  is_active: false, in_force: false, closed_at: ENDED });
const TEAM = [ONCALL, ASSOCIATE, ATTENDING, CLOSED];

const ASSIGNER = ["board.view", "admissions.view", "care_team.claim", "care_team.assign"];
const READER = ["board.view", "admissions.view"];
const ATTENDING_GROUP = [{ slug: "attending", name: "Sorumlu Hekim" }];
const PHYSICIAN_GROUP = [{ slug: "physician", name: "Hekim" }];
const CHARGE_GROUP = [{ slug: "nurse", name: "Hemşire" }, { slug: "charge_nurse", name: "Sorumlu Hemşire" }];

async function open({ perms = ASSIGNER, groups = ATTENDING_GROUP, admissions = [ACTIVE], team = TEAM, setup } = {}) {
  const mounted = await mount(<CareTeamBox patientId={KEY} nowMs={NOW} />, {
    access: token({ perms }), me: profile({ perms, groups }),
    setup: (api) => {
      api.admissions.mockResolvedValue(admissions);
      api.careTeam.mockResolvedValue(team);
      setup?.(api);
    },
  });
  await settle();
  return mounted;
}

const heading = () => screen.getByRole("heading", { name: "Baxım komandası" });
/** The active row of `name` (its name is the row's `<b>`). */
const item = (name) => screen.getAllByRole("listitem").find((li) => within(li).queryByText(name, { selector: "b" }));

describe("CareTeamBox", () => {
  it("reads nothing and shows nothing without admissions.view", async () => {
    const { api } = await open({ perms: ["board.view"] });
    expect(api.admissions).not.toHaveBeenCalled();
    expect(api.careTeam).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Baxım komandası" })).toBeNull();
  });

  it("shows nothing for a patient whose admission the list does not hold", async () => {
    const { api } = await open({ admissions: [] });
    expect(api.careTeam).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Baxım komandası" })).toBeNull();
  });

  it("says on a DRAFT that the attending comes with the signature, and reads no team", async () => {
    const { api } = await open({ admissions: [{ ...ACTIVE, state: "DRAFT" }] });
    expect(heading()).toBeTruthy();
    expect(screen.getByText("Məsul həkim qəbul imzalandıqda təyin olunur.")).toBeTruthy();
    expect(api.careTeam).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Komandaya əlavə et" })).toBeNull();
  });

  it("names each member with her role, her window, its expiry and who added her, and folds the history", async () => {
    const { api } = await open();
    expect(api.careTeam).toHaveBeenCalledWith(ADM);
    expect(item("Sentetik Növbətçi")).toHaveTextContent(
      `Növbətçi həkim · ${ddmmhhmm(Date.parse(W0))} – ${ddmmhhmm(Date.parse(W1))} · müddəti bitib · əlavə edən: Sentetik Həkim`);
    expect(item("Sentetik Köməkçi")).toHaveTextContent("Köməkçi həkim · əlavə edən: Sentetik Həkim");
    expect(item("Sentetik Həkim")).toHaveTextContent("Məsul həkim");
    expect(item("Sentetik Həkim")).toHaveTextContent("Yeni məsul həkim təyin olunanda bitir.");
    const history = screen.getByRole("button", { name: "Əvvəlki üzvlər (1)" });
    expect(history).toHaveAttribute("aria-expanded", "false");
    const ended = `bitdi: ${ddmmhhmm(Date.parse(ENDED))}`;
    expect(screen.queryByText(ended, { exact: false })).toBeNull();
    fireEvent.click(history);
    expect(history).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(ended, { exact: false })).toBeTruthy();
    expectNoUuid();
  });

  it("offers an assigner «Komandaya əlavə et», and «Məsul həkim et» and «Komandadan çıxar» on another's row — never on the attending's", async () => {
    await open();
    expect(screen.getByRole("button", { name: "Komandaya əlavə et" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Komandadan çıxar: Sentetik Köməkçi" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Məsul həkim et: Sentetik Köməkçi" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Komandadan çıxar: Sentetik Həkim" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Məsul həkim et: Sentetik Həkim" })).toBeNull();
  });

  it("lets a member without care_team.assign leave her own row, and do nothing else", async () => {
    const own = member({ id: ROW(5), user_id: "u-ayse", full_name: "Ayşe Sentetik", role: "ASSOCIATE_PHYSICIAN" });
    await open({ perms: READER, groups: PHYSICIAN_GROUP, team: [own, ASSOCIATE, ATTENDING] });
    expect(screen.getByRole("button", { name: "Komandadan ayrıl: Ayşe Sentetik" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Komandadan çıxar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Məsul həkim et/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Komandaya əlavə et" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Məsul həkim ol" })).toBeNull();
  });

  it("offers «Məsul həkim ol» to a physician holding the claim who is not the attending", async () => {
    await open();
    expect(screen.getByRole("button", { name: "Məsul həkim ol" })).toBeTruthy();
  });

  it("offers no claim to the attending herself", async () => {
    await open({ team: [member({ user_id: "u-ayse", full_name: "Ayşe Sentetik" })] });
    expect(screen.queryByRole("button", { name: "Məsul həkim ol" })).toBeNull();
  });

  it("offers no claim to a charge nurse whose token still carries the key (D7, T1)", async () => {
    await open({ perms: ["board.view", "admissions.view", "care_team.claim"], groups: CHARGE_GROUP });
    expect(screen.queryByRole("button", { name: "Məsul həkim ol" })).toBeNull();
  });

  it("claims after one question that names who leaves, says it, and reads the team again", async () => {
    const { api } = await open({ setup: (a) => a.claimAttending.mockResolvedValue(member({ user_id: "u-ayse", full_name: "Ayşe Sentetik" })) });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Məsul həkim ol" })); });
    const ask = screen.getByRole("dialog", { name: "Yeni məsul həkim" });
    expect(within(ask).getByText("Ayşe Sentetik məsul həkim olur; Sentetik Həkim komandadan çıxır.")).toBeTruthy();
    expect(api.claimAttending).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(ask).getByRole("button", { name: "Təsdiq et" })); });
    await settle();
    expect(api.claimAttending).toHaveBeenCalledWith(ADM);
    expect(toasts().getAllByText(`${BED_2} · Ayşe Sentetik məsul həkim oldu.`).length).toBeGreaterThan(0);
    expect(api.careTeam).toHaveBeenCalledTimes(2);
  });

  it("makes an associate the attending after the same question", async () => {
    const { api } = await open({ setup: (a) => a.addCareTeamMember.mockResolvedValue({}) });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Məsul həkim et: Sentetik Köməkçi" })); });
    const ask = screen.getByRole("dialog", { name: "Yeni məsul həkim" });
    expect(within(ask).getByText("Sentetik Köməkçi məsul həkim olur; Sentetik Həkim komandadan çıxır.")).toBeTruthy();
    await act(async () => { fireEvent.click(within(ask).getByRole("button", { name: "Təsdiq et" })); });
    await settle();
    expect(api.addCareTeamMember).toHaveBeenCalledWith(ADM, { user_id: ASC, role: "ATTENDING" });
  });

  it("holds the pressed button until the write and the re-read are in, and gives the heading the focus when the row leaves", async () => {
    let answer;
    let reread;
    const { api } = await open({
      setup: (a) => {
        a.careTeam.mockResolvedValueOnce(TEAM).mockImplementation(() => new Promise((resolve) => { reread = resolve; }));
        a.endCareTeamMember.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
      },
    });
    const name = "Komandadan çıxar: Sentetik Köməkçi";
    screen.getByRole("button", { name }).focus();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name })); });
    expect(api.endCareTeamMember).toHaveBeenCalledTimes(1);
    expect(api.endCareTeamMember).toHaveBeenCalledWith(ADM, ROW(3));
    expect(screen.getByRole("button", { name })).toHaveAttribute("aria-busy", "true");
    await act(async () => { answer({ ...ASSOCIATE, is_active: false }); });
    await settle();
    // Ended, but the list on screen is still the old one: a press now would end it twice.
    expect(screen.getByRole("button", { name })).toHaveAttribute("aria-busy", "true");
    await act(async () => { reread([ONCALL, ATTENDING, { ...ASSOCIATE, is_active: false, closed_at: ENDED }, CLOSED]); });
    await settle();
    expect(screen.queryByRole("button", { name })).toBeNull();
    expect(document.activeElement).toBe(heading());
    expect(toasts().getAllByText(`${BED_2} · Sentetik Köməkçi komandadan çıxarıldı.`).length).toBeGreaterThan(0);
  });

  it("says a refusal on the toast by its code, and reads the team again", async () => {
    const { api } = await open({ setup: (a) => a.endCareTeamMember.mockRejectedValue(
      refusal(409, "English words", { apiCode: "care_team_conflict" })) });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Komandadan çıxar: Sentetik Köməkçi" })); });
    await settle();
    expect(toasts().getAllByText(`${BED_2}: Bu həkim artıq komandadadır, ya da komanda eyni anda dəyişdi.`).length).toBeGreaterThan(0);
    expect(api.careTeam).toHaveBeenCalledTimes(2);
  });

  it("says when the team cannot be read", async () => {
    await open({ setup: (a) => a.careTeam.mockRejectedValue(refusal(503, "down")) });
    expect(screen.getByText(/^Baxım komandası oxunmadı: /)).toBeTruthy();
  });

  it("adds through the dialog, reads the team again, and says it under the list", async () => {
    const { api } = await open({
      setup: (a) => {
        a.careTeamCandidates.mockResolvedValue([{ user_id: ONC, full_name: "Sentetik Növbətçi" }]);
        a.addCareTeamMember.mockResolvedValue({});
      },
    });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Komandaya əlavə et" })); });
    await settle();
    const dialog = screen.getByRole("dialog", { name: `Komandaya əlavə et · ${BED_2}` });
    fireEvent.click(within(dialog).getByRole("radio", { name: "Sentetik Növbətçi" }));
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Əlavə et" })); });
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.careTeam).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Sentetik Növbətçi komandaya əlavə edildi.")).toBeTruthy();
  });
});

describe("the patient screen", () => {
  it("holds the care team of the patient it shows", async () => {
    const card = entry(KEY, [], {
      identity: identity({ patient_id: KEY, display_name: "Sentetik Hasta", bed_label: "2", source: "kabul",
        bed_id: BED(2), unit_id: REA, bed_key: null }),
      at: measured(30),
    });
    const mounted = await mountKabul(<PatientScreen params={{ id: KEY }} />, {
      perms: READER,
      setup: (api) => {
        api.boardPatients.mockResolvedValue(board([card]));
        api.streamTicket.mockResolvedValue({ ticket: "t-1" });
        api.view.mockResolvedValue({ ok: true });
        api.patientTrends.mockImplementation(answering());
        api.patientFluids.mockImplementation((pid) => Promise.resolve(emptyFluids(pid)));   // G3-03's box, an empty ledger (X13)
        api.admissions.mockResolvedValue([ACTIVE]);
        api.careTeam.mockResolvedValue([ATTENDING]);
      },
    });
    await act(async () => { await mounted.board.start(); mounted.stream.open(); });
    await settle();
    expect(screen.getByRole("heading", { level: 2, name: "Baxım komandası" })).toBeTruthy();
    expect(screen.getByText("Sentetik Həkim", { selector: "b" })).toBeTruthy();
    expect(mounted.api.careTeam).toHaveBeenCalledWith(ADM);
    expectNoUuid();
  });
});
```

- [ ] **Step 2: Run them and see them red**

```bash
cd /c/tmp/g2b-b1c/dashboard && ./node_modules/.bin/vitest run src/live/screens/patient/careTeam/CareTeamBox.test.jsx 2>&1 | tail -6
```

Expected: the file fails to load, `Failed to resolve import "./CareTeamBox.jsx"`.

- [ ] **Step 3: Write the box**

Create `dashboard/src/live/screens/patient/careTeam/CareTeamBox.jsx`:

```jsx
// src/live/screens/patient/careTeam/CareTeamBox.jsx — «Bakım ekibi» on the patient screen (Group 2 · B1c,
// spec §4, D1–D8).
//
// Who is responsible for this patient: the attending (one, D2), the associates and the on-call
// physicians, by name and never by id.
//
// - A session without `admissions.view` reads nothing and shows nothing. The box finds the admission as
//   SignOffStrip does: the open admission of the caller's units whose board key is this card's. Another
//   unit's patient, whom the board may show a member from outside her units, has no box (spec §7).
// - A DRAFT says the attending comes with the signature (D3).
// - Each active member: her name, her role, an on-call window with «süresi doldu» once it has passed,
//   and who added her. The attending's row has no remove: it ends when another attending is made (T5).
// - «Önceki üyeler (n)», folded: the closed rows, each with when it ended.
// - The buttons are §4's table (`careTeam.js`). Making a new attending asks once who leaves (X6).
//   «Ekibe ekle» opens AddMemberDialog.jsx.
// - One write at a time. The pressed button is held until its write AND the re-read after it are in
//   (A-17); a second press does nothing. A success is said on the toast and under the list; a refusal
//   on the toast alone (screens/admin/refusal.js, X7). The team is read again after either.
// - When a write takes the pressed button away (its row left the team), the focus that fell to <body>
//   goes to the box's heading. A focus the reader has moved since is left where it is.
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { useSession } from "../../../session/SessionProvider.jsx";
import { readErrorText } from "../../../apiErrors.js";
import { ddmmhhmm } from "../../../i18n/dates.js";
import { Announce, Button, Icon, Modal, useToast } from "../../../ui/index.js";
import { FOCUS_RING } from "../../../ui/focus.js";
import { doneFor, reasonOf, refusedFor } from "../../admin/refusal.js";
import { useAdmissions } from "../../kabul/useAdmissions.js";
import { boardKeyOf } from "../../kabul/boardKey.js";
import { AddMemberDialog } from "./AddMemberDialog.jsx";
import { OPEN, actionsFor, activeRows, attendingOf, canClaim, closedRows, expired } from "./careTeam.js";

/** The admissions are read again every minute, as the sign-off strip reads them: a signature given on
 *  another screen turns the DRAFT's line into the team within the minute. */
const EVERY_MS = 60_000;
/** The bed as the slice names it (SignOffStrip's `bedOf`). */
const bedOf = (row) => `${row.bed_label} · ${row.room_name} · ${row.unit_name}`;
const stamp = (iso) => {
  const ms = Date.parse(iso ?? "");
  return Number.isFinite(ms) ? ddmmhhmm(ms) : "—";
};

/** `patientId`: the board's key of the card shown. `nowMs`: the screen's clock («süresi doldu»). */
export function CareTeamBox({ patientId, nowMs }) {
  const { user } = useSession();
  if (!(user?.perms?.includes("admissions.view") ?? false)) return null;
  return <Finder patientId={patientId} nowMs={nowMs} />;
}

function Finder({ patientId, nowMs }) {
  const { rows } = useAdmissions(OPEN, { every: EVERY_MS });
  const admission = rows?.find((r) => boardKeyOf(r) === patientId) ?? null;
  return admission ? <Team key={admission.id} admission={admission} nowMs={nowMs ?? Date.now()} /> : null;
}

/** One active member: her name, her role, her window, who added her, and the row's buttons. */
function Member({ row, nowMs, acts, busy, onPromote, onEnd }) {
  const { t } = useI18n();
  const hours = row.role === "ONCALL_PHYSICIAN" && row.window_start && row.window_end
    ? `${stamp(row.window_start)} – ${stamp(row.window_end)}` : null;
  const late = expired(row, nowMs);
  const named = (key) => `${t(key)}: ${row.full_name}`;
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-ctl border border-line px-3 py-2">
      <div className="min-w-0 flex-1">
        <b className="block text-14 text-ink">{row.full_name}</b>
        <span className="block text-12.5 text-mute">
          {t(`ekip.role.${row.role}`)}
          {hours ? ` · ${hours}` : null}
          {late ? <> · <b className="text-att-ink">{t("ekip.expired")}</b></> : null}
          {row.granted_by_name ? ` · ${t("ekip.grantedBy", { name: row.granted_by_name })}` : null}
        </span>
        {row.role === "ATTENDING" ? <span className="block text-12 text-mute">{t("ekip.attendingStays")}</span> : null}
      </div>
      {acts.promote ? (
        <Button size="sm" icon="star" busy={busy === `promote:${row.id}`} onClick={onPromote}
          aria-label={named("ekip.action.promote")}>
          {t("ekip.action.promote")}
        </Button>
      ) : null}
      {acts.remove ? (
        <Button size="sm" icon="x" busy={busy === `remove:${row.id}`} onClick={() => onEnd("remove")}
          aria-label={named("ekip.action.remove")}>
          {t("ekip.action.remove")}
        </Button>
      ) : null}
      {acts.leave ? (
        <Button size="sm" icon="out" busy={busy === `leave:${row.id}`} onClick={() => onEnd("leave")}
          aria-label={named("ekip.action.leave")}>
          {t("ekip.action.leave")}
        </Button>
      ) : null}
    </li>
  );
}

function Team({ admission, nowMs }) {
  const { t } = useI18n();
  const { user, store } = useSession();
  const toast = useToast();
  const headingId = useId();
  const heading = useRef(null);
  const seq = useRef(0);
  const [team, setTeam] = useState({ rows: null, error: null });
  const [busy, setBusy] = useState(null);       // the write in flight: "claim", or "<kind>:<row id>"
  const [asking, setAsking] = useState(null);   // the new-attending question: {kind: "claim"} | {kind: "promote", row}
  const [adding, setAdding] = useState(false);
  const [said, setSaid] = useState("");
  const [landed, setLanded] = useState(0);
  const [history, setHistory] = useState(false);
  const draft = admission.state === "DRAFT";
  const subject = bedOf(admission);
  const perms = user?.perms ?? [];

  // A read answered after a newer one began is dropped.
  const reload = useCallback(async () => {
    const mine = seq.current + 1;
    seq.current = mine;
    try {
      const rows = await store.track(() => store.api.careTeam(admission.id));
      if (seq.current === mine) setTeam({ rows: Array.isArray(rows) ? rows : [], error: null });
    } catch (error) {
      if (seq.current === mine) setTeam((prev) => ({ rows: prev.rows, error }));
    }
  }, [store, admission.id]);

  useEffect(() => { if (!draft) reload(); }, [draft, reload]);

  useEffect(() => {
    if (landed === 0) return;
    const focused = document.activeElement;
    if (!focused || focused === document.body) heading.current?.focus();
  }, [landed]);

  const active = activeRows(team.rows);
  const closed = closedRows(team.rows);
  const attending = attendingOf(team.rows);

  async function run(key, write, text) {
    if (busy !== null) return;
    setBusy(key);
    let ok = false;
    try {
      await store.track(write);
      toast(doneFor(t, subject, text));
      setSaid(text);
      ok = true;
    } catch (err) {
      toast(refusedFor(t, subject, reasonOf(t, err)), "error");
    } finally {
      await reload();
      if (ok) setLanded((n) => n + 1);
      setBusy(null);
    }
  }

  function answer() {
    const what = asking;
    setAsking(null);
    if (what?.kind === "claim") {
      run("claim", () => store.api.claimAttending(admission.id), t("ekip.done.claim", { name: user?.fullName }));
    } else if (what?.kind === "promote") {
      run(`promote:${what.row.id}`,
        () => store.api.addCareTeamMember(admission.id, { user_id: what.row.user_id, role: "ATTENDING" }),
        t("ekip.done.promote", { name: what.row.full_name }));
    }
  }

  const end = (row, kind) => run(`${kind}:${row.id}`, () => store.api.endCareTeamMember(admission.id, row.id),
    t(`ekip.done.${kind}`, { name: row.full_name }));
  const ask = (what) => { if (busy === null) setAsking(what); };
  const claimable = !draft && team.rows !== null && canClaim({ user, perms, attending });
  const mayAdd = !draft && perms.includes("care_team.assign");
  const askName = asking?.kind === "claim" ? user?.fullName : asking?.row?.full_name;

  return (
    <section aria-labelledby={headingId} className="rounded-box border border-line bg-card px-[14px] py-3">
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <h2 id={headingId} ref={heading} tabIndex={-1}
          className={`m-0 flex items-center gap-2 rounded-md font-text text-11 font-bold uppercase leading-[normal] tracking-[.08em] text-mute ${FOCUS_RING}`}>
          <Icon name="users" size={15} />
          {t("ekip.title")}
        </h2>
        <div className="ml-auto flex flex-wrap gap-2">
          {claimable ? (
            <Button size="sm" icon="star" busy={busy === "claim"} onClick={() => ask({ kind: "claim" })}>
              {t("ekip.action.claim")}
            </Button>
          ) : null}
          {mayAdd ? (
            <Button size="sm" icon="userPlus" onClick={() => { if (busy === null) setAdding(true); }}>
              {t("ekip.action.add")}
            </Button>
          ) : null}
        </div>
      </div>
      {draft ? <p className="m-0 text-13 text-mute">{t("ekip.draft")}</p> : (
        <>
          {team.error ? (
            <p className="m-0 mb-2 text-13 text-crit-ink">{t("ekip.readFailed", { reason: readErrorText(t, team.error) })}</p>
          ) : null}
          {team.rows === null && !team.error ? <p className="m-0 text-13 text-mute">{t("ekip.loading")}</p> : null}
          {team.rows !== null && active.length === 0 ? <p className="m-0 text-13 text-mute">{t("ekip.empty")}</p> : null}
          {active.length > 0 ? (
            <ul className="m-0 grid list-none gap-2 p-0">
              {active.map((row) => (
                <Member key={row.id} row={row} nowMs={nowMs} acts={actionsFor(row, { user, perms })} busy={busy}
                  onPromote={() => ask({ kind: "promote", row })} onEnd={(kind) => end(row, kind)} />
              ))}
            </ul>
          ) : null}
          {closed.length > 0 ? (
            <div className="mt-2.5">
              <button type="button" aria-expanded={history} onClick={() => setHistory((open) => !open)}
                className={`inline-flex items-center gap-1 rounded-md text-12.5 font-semibold text-pri ${FOCUS_RING}`}>
                <Icon name={history ? "chevD" : "chevR"} size={14} />
                {t("ekip.previous", { n: closed.length })}
              </button>
              {history ? (
                <ul className="m-0 mt-1.5 grid list-none gap-1 p-0">
                  {closed.map((row) => (
                    <li key={row.id} className="text-12.5 text-mute">
                      <b className="text-ink">{row.full_name}</b> · {t(`ekip.role.${row.role}`)} · {t("ekip.ended", { at: stamp(row.closed_at) })}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {said ? <p className="m-0 mt-2 text-12.5 text-mute">{said}</p> : null}
        </>
      )}
      {/* A busy Button reads only "unavailable" to a screen reader; the words come from here. */}
      <Announce text={busy !== null ? t("ekip.working") : ""} />
      {asking ? (
        <Modal open title={t("ekip.ask.title")} onClose={() => setAsking(null)}
          actions={(
            <>
              <Button onClick={() => setAsking(null)}>{t("common.cancel")}</Button>
              <Button variant="primary" icon="ok" onClick={answer}>{t("ekip.ask.confirm")}</Button>
            </>
          )}>
          <p className="m-0 text-14">
            {attending
              ? t("ekip.ask.body", { name: askName, previous: attending.full_name })
              : t("ekip.ask.alone", { name: askName })}
          </p>
        </Modal>
      ) : null}
      {adding ? (
        <AddMemberDialog admissionId={admission.id} subject={subject} attending={attending}
          onClose={() => setAdding(false)}
          onDone={async (text) => { setSaid(text); await reload(); setAdding(false); }}
          onRefused={() => { reload(); }} />
      ) : null}
    </section>
  );
}
```

- [ ] **Step 4: On the patient screen**

In `dashboard/src/live/screens/patient/PatientScreen.jsx`:

1. After the line `import { LabelReprint } from "../kabul/label/LabelReprint.jsx"; // G2-B1d: the protocol label, again`, add:

```jsx
import { CareTeamBox } from "./careTeam/CareTeamBox.jsx"; // G2-B1c: who is responsible for the patient
```

2. Replace

```jsx
          <LabelReprint key={`label-${id}`} patientId={id} />{/* G2-B1d (spec §6): an open admission's protocol label, again */}
```

with

```jsx
          <LabelReprint key={`label-${id}`} patientId={id} />{/* G2-B1d (spec §6): an open admission's protocol label, again */}
          {/* G2-B1c (spec §4): the care team. Like the sign-off strip, it writes the admission's workflow, not the
              clinical record, so `patient.onlyWrite` does not count it. Keyed: a write in flight stays with its patient. */}
          <CareTeamBox key={`team-${id}`} patientId={id} nowMs={nowMs} />
```

- [ ] **Step 5: Run them and see them green, then every patient and Kabul test**

```bash
cd /c/tmp/g2b-b1c/dashboard && ./node_modules/.bin/vitest run src/live/screens/patient/careTeam/CareTeamBox.test.jsx 2>&1 | tail -6
cd /c/tmp/g2b-b1c/dashboard && ./node_modules/.bin/vitest run src/live/screens/patient src/live/screens/kabul src/live/rawKeys.test.jsx 2>&1 | tail -6
```

Expected: `16 passed`, then all passed.

The patient screen now reads `GET /admissions` once more for a session with `admissions.view` (the box's own read). A test that counts `api.admissions` calls, or gives the first call its answer with `mockResolvedValueOnce`, may now see the box take a read. Give the box's read its own answer (`a.admissions.mockImplementation(...)`) or count it. Never weaken what the test asserts. Name each file in the report, and add it to Step 6's paths.

- [ ] **Step 6: Line ends, then commit**

```bash
cd /c/tmp/g2b-b1c && for f in dashboard/src/live/screens/patient/careTeam/CareTeamBox.jsx dashboard/src/live/screens/patient/careTeam/CareTeamBox.test.jsx; do /c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" "$f"; done
for f in dashboard/src/live/screens/patient/careTeam/CareTeamBox.jsx dashboard/src/live/screens/patient/careTeam/CareTeamBox.test.jsx dashboard/src/live/screens/patient/PatientScreen.jsx; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- dashboard/src/live/screens/patient/careTeam/CareTeamBox.jsx dashboard/src/live/screens/patient/careTeam/CareTeamBox.test.jsx dashboard/src/live/screens/patient/PatientScreen.jsx
git status --short && git diff --cached --stat
git commit -m "feat(dashboard): the «Bakım ekibi» box on the patient screen — the team by name, its history, and each action behind its gate (G2-B1c, §4, D1–D8, X6, X7)" -m "One write at a time, held until its re-read is in; a new attending asks once who leaves; the focus goes to the heading when a row leaves; refusals on the toast. Red: the component did not exist." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/live/screens/patient/careTeam/CareTeamBox.jsx dashboard/src/live/screens/patient/careTeam/CareTeamBox.test.jsx dashboard/src/live/screens/patient/PatientScreen.jsx
```

---

### Task 17: The roadmap row and the Turkish guide

**Files:**
- Modify: `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`
- Modify: `docs/homunculus-rehber-TR.md`

- [ ] **Step 1: Where the two documents end**

```bash
cd /c/tmp/g2b-b1c && grep -n '^| G2-\|^\*\*Grup 3' docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md | cut -c1-40; grep -n '^### 3\.1[0-9] \|^### 3\.2[0-9] \|^---$\|^## 4\. ' docs/homunculus-rehber-TR.md | tail -8
```

At `ea61714a`:
- the «Grup 2 · durum» table's last row is `| G2-B3a |`, followed by a blank line and `**Grup 3 · durum**`;
- the guide's last section of part 3 is `### 3.18 Vardiya devri (Grup 2 · B3b)`, ending with the line ``- **Kaynak:** `docs/superpowers/specs/2026-11-10-g2b-b3b-devir-design.md`.``, then a blank line, `---`, a blank line and `## 4. "Neden bunu kullanmıyoruz" köşesi`.

The row goes after the table's last row, and the section after §3.18's last line, before that `---`, numbered **3.19**. If main has gained a row or a section since (a later documents merge), insert after the last one and number the section one past the last; B1b's §3.20 then follows this one. Say so in the report.

- [ ] **Step 2: The roadmap row**

In the roadmap's «Grup 2 · durum» table, insert this row (Step 1 says where). Read the neighbouring line first, because it is long:

```markdown
| G2-B1c | Bakım ekibi (Lane B): hasta ekranında «Bakım ekibi» kutusu — sorumlu hekim (her an tek), yardımcı hekimler, nöbetçi hekimler (pencere en çok 48 saat, geçince «süresi doldu»), adla, kimlik numarası olmadan; «Önceki üyeler» katlı; «Sorumlu hekim ol» (`care_team.claim`, yalnız hekim), «Ekibe ekle» / «Sorumlu hekim yap» / «Ekipten çıkar» (`care_team.assign`), «Ekipten ayrıl» (üyenin kendisi); kabulü imzalayan hekim sorumlu hekim olur ve satırı aynı işlemde yazılır (O45 kapandı); yeni sorumlu hekim öncekinin satırını bitirir; seçici kurumun bütün hekimlerini adla sunar (D8); üye hastasını kendi birimlerinin dışında da görür; sorumlu hemşire `care_team.claim`'i kaybetti (D7); her değişiklik adsız denetim satırı; göç `0018` (G3-02'nin `0017`'sinin ardından; B1b'nin iki nakil sütunu dahil) · spec: [2026-11-09](../specs/2026-11-09-g2b-b1c-bakim-ekibi-design.md) · plan: [2026-11-09](2026-11-09-g2b-b1c-bakim-ekibi.md) | Kodda `feat/g2b-b1c-bakim-ekibi` (main `ea61714a` üzerinde) · göç `0018` · **main'e alınmadı · VM'de değil** |
```

- [ ] **Step 3: The guide**

In `docs/homunculus-rehber-TR.md`:

1. Replace the line

```markdown
- İmza, imzalayan hekimi bakım ekibine eklemez (B1c).
```

with

```markdown
- İmza, imzalayan hekimi bakım ekibine eklemez (B1c). *B1c'de kapandı: imzalayan hekim sorumlu
  hekim olur ve ekip satırı yazılır (3.19).*
```

2. Insert this section where Step 1 says: after §3.18's last line, before the `---` that precedes `## 4. "Neden bunu kullanmıyoruz" köşesi`, with one blank line before it and one after it:

```markdown
### 3.19 Bakım ekibi: sorumlu hekim, yardımcı ve nöbetçi hekimler (Grup 2 · B1c)

Bir hastadan hangi hekimlerin sorumlu olduğu artık kayıtlı, görünür ve doğru tutuluyor. **Durum:**
kodda (`feat/g2b-b1c-bakim-ekibi`); main'e ve hastane sunucusuna sahibin sözüyle çıkar. Örneklerdeki
adlar uydurmadır.

- **Yalnız hekimler.** Ekipte üç rol var: **sorumlu hekim** (her an tek kişi), **yardımcı hekim** ve
  **nöbetçi hekim** (başlangıcı ve bitişi olan, en çok 48 saatlik bir pencereyle). Hemşireler ekipte
  değildir; hemşirenin yatakla bağı ayrı bir kayıttır. Kimin hekim olduğunu kişinin rol grubu söyler:
  Sorumlu Hekim, Ünite Hekimi ya da Hekim.
- **İmzalayan sorumlu hekim olur.** Kabulü imzalayan hekim, formda başka bir sorumlu hekim adı yoksa,
  aynı işlemde sorumlu hekim olur ve ekipteki satırı yazılır. Hekim olmayan biri (örneğin yönetici)
  sorumlu hekimi olmayan bir kabulü imzalayamaz.
- **Kutu.** Hasta ekranında «Bakım ekibi»: her üyenin adı, rolü, nöbetçinin penceresi (geçtiyse
  «süresi doldu») ve onu kimin eklediği. Eski üyeler «Önceki üyeler» altında katlıdır, ne zaman
  çıktıklarıyla. Kimlik numarası gösterilmez. Kabul henüz imzalanmadıysa kutu yalnız «Sorumlu hekim,
  kabul imzalanınca atanır.» der.
- **Düğmeler.**
  - «Sorumlu hekim ol»: `care_team.claim` sahibi bir hekim, sorumlu hekim değilse.
  - «Ekibe ekle»: `care_team.assign` sahibi. Seçici kurumdaki bütün hekimleri adla sunar; başka
    birimden bir nöbetçi meslektaş da çıkar.
  - «Sorumlu hekim yap» ve «Ekipten çıkar»: `care_team.assign` sahibi, sorumlu hekimin satırı dışında.
  - «Ekipten ayrıl»: üyenin kendisi, kendi satırında; kendi birimlerinin dışından da.

  Yeni bir sorumlu hekim atanırken ekran bir kez sorar: «X sorumlu hekim olur; Y ekipten çıkar.»
  Sorumlu hekimin satırı tek başına kaldırılmaz; yeni sorumlu hekim atanınca, taburcuda ya da nakilde
  biter. Süresi dolmuş bir nöbetçi yeniden eklenebilir: eski satırı kapanır, yenisi yazılır.
- **Kendi hastası.** Ekipteki hekim hastasını panoda kendi birimlerinin dışında da görür; nöbetçi
  yalnız penceresi içinde. Ekipten çıkan artık görmez. Açık bir pano bağlantısı yeni üyeyi yeniden
  bağlanınca alır; diğer okumalar hemen.
- **Sorumlu hemşire.** Sorumlu hemşire grubu `care_team.claim` yetkisini kaybetti: ekip hekimlerindir,
  hemşirenin bu düğmesi her zaman reddedilirdi. Grubun açıklamasından da «bakım ekibi» çıktı.
- **Denetim.** Her değişiklik denetim kaydına yazılır: kim, kimi, hangi rolle, hangi satırı bitirerek;
  hastanın adı yazılmaz. «Denetim bütünlüğü» sayfası (3.13) bu üç olayı adıyla gösterir ve «Tür»
  süzgecinde sunar: sorumlu hekim atandı, bakım ekibine eklendi, bakım ekibinden çıkış.
- **Göç `0018`.** Eski kısıt, bir üyenin aynı kabulden ikinci kez çıkarılmasını engelliyordu. Yerine
  iki kısmi tekil dizin gelir: kabul başına üye için bir etkin satır, kabul başına bir sorumlu hekim.
  Göç önce veriyi düzeltir: kapanmış kabullerin açık satırlarını kapatır, iki sorumlu hekimden en
  yenisini bırakır, imzalı kabulün eksik sorumlu hekim satırını yazar. B1b'nin (nakil) iki sütunu da
  bu göçle gelir.
```

- [ ] **Step 4: Commit**

```bash
cd /c/tmp/g2b-b1c && for f in docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md docs/homunculus-rehber-TR.md; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md docs/homunculus-rehber-TR.md
git status --short && git diff --cached --stat
git commit -m "docs: the roadmap's G2-B1c row and the guide's Bakım ekibi section (G2-B1c)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md docs/homunculus-rehber-TR.md
```

---

### Task 18: The gates, the final review and the local walk

**Files:** none changed, unless a gate or the review finds something. Each fix is its own commit, in the task that owns the file, with the red named.

- [ ] **Step 1: The engine.** Run Task 11's Steps 1–3 again on the final head. Report the numbers.

- [ ] **Step 2: The dashboard and the build**

```bash
cd /c/tmp/g2b-b1c/dashboard && ./node_modules/.bin/vitest run 2>&1 | tail -5
cd /c/tmp/g2b-b1c/dashboard && ./node_modules/.bin/vite build 2>&1 | tail -6
```

Expected:
- the suite: all passed. The count is Task 0's plus the new tests: 1 (Task 12), 11 (Task 14), 8 (Task 15), 16 (Task 16). And 5 cases of Task 13: `apiErrors.test.js`'s `it.each(CODES)` runs for the three new codes and its `it.each(FIELDS)` for the two window fields. Its Denetim change widens one existing test and adds none. In all, Task 0's count + 41.
- the build: no `larger than 500 kB`. The precache count is Task 0's N, or a different number with its reason named.

- [ ] **Step 3: The final review (the controller dispatches it)**

One reviewer, the most capable model, reads the whole diff `git diff ea61714a..HEAD -- . ':!docs/superpowers/specs'` against the spec (§0–§7) and this plan's departures (X1–X13). It looks hardest at six things:
- the order in every write: tenant, reach, lock, state, then the physician check and the conflict. In sign-off, the state comes first under the locks;
- T1 everywhere: the sign-off, the claim and the add, and the candidates;
- migration `0018`'s data steps against real shapes: two attendings, an attending with no row, an on-call row turned attending. Also its downgrade, and its description step (X3);
- patient data: the audit rows carry staff user names and ids only; the candidates carry `user_id` and `full_name` only; the answers carry no patient name;
- the index answer (T7) and the renewal (T8, X4);
- the box: the holds, the focus, the four languages, and no UUID; and the three events on «Denetim bütünlüğü» (X11).

Fix what it finds and re-review until it approves.

- [ ] **Step 4: The local walk (the controller runs it)**

Run it on a local stack of this branch (migrated to `0018`), synthetic accounts and synthetic patients. The accounts: a nurse and a charge nurse of Reanimasiya; two physicians of Reanimasiya (`attending` group); one physician of Neonatal only (`physician` group); an administrator. Use a headless Chrome at 390 px and 1440 px, in the Gece and Gün themes, and in all four languages.

1. The nurse admits; before the signature the box says «Məsul həkim qəbul imzalandıqda təyin olunur.». The first physician signs: the box shows her as «Məsul həkim», «əlavə edən: <her>».
2. She opens «Komandaya əlavə et». The picker lists the Neonatal physician by name, beside the second Reanimasiya physician, and no nurse. She adds the Neonatal physician as «Növbətçi həkim» for 12 hours.
3. The Neonatal physician signs in. The patient's card is on her board (after the stream reconnects, F10). She ends her own row with «Komandadan ayrıl» from her own screen. Her REST read is refused at once, and the card leaves her board on the next reconnect.
4. «Məsul həkim et» on an associate asks once. The previous attending moves to «Əvvəlki üzvlər».
5. The charge nurse sees no «Məsul həkim ol».
6. The administrator signs a DRAFT that names nobody. The refusal is said in her language.
7. Keyboard only, through the add dialog and the question. No UUID and no raw key anywhere.
8. The administrator (`audit.view`, the system group's by rule) opens «Denetim bütünlüğü»: the sign-off's `care_team.attending`, the add and the leave are named in her language, and the «Tür» filter offers the three (X11).

Record the walk in the plan's record section, and in the roadmap row's status cell.

- [ ] **Step 5: Report to the user.** Report:
- the commit range;
- the gates' numbers;
- the review's verdict;
- the walk;
- the base the branch sits on (`ea61714a`, or the main it was rebased onto).

The slice then waits for the owner's «main'e al» and, separately, the VM decision.

Before the worktree is removed, unlink the `node_modules` junction (Task 0, Step 3).

---

## Deploy notes (for the VM step — not part of this plan's tasks)

- **What ships:** api and web. The web image carries the box and `nginx.conf`'s two new log-map lines. The hub, the bridge and nce are untouched.
- **Migrations:** `0016` (B3a) and `0017` (G3-02), both on main since before `ea61714a`, must be on the VM first, or in the same `alembic upgrade head`. Then `0018`.
- **Before the deploy, count what `0018` will change** (one `psql` per line; read-only):
  ```sql
  SELECT count(*) FROM care_team_members m JOIN admissions a ON a.id = m.admission_id WHERE m.is_active AND a.state IN ('DISCHARGED','TRANSFERRED');
  SELECT count(*) FROM (SELECT admission_id FROM care_team_members WHERE is_active AND role = 'ATTENDING' GROUP BY admission_id HAVING count(*) > 1) AS x;
  SELECT count(*) FROM admissions a WHERE a.state IN ('ACTIVE','PENDING_DISCHARGE','PENDING_TRANSFER') AND a.attending_physician_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM care_team_members m WHERE m.admission_id = a.id AND m.is_active AND m.role = 'ATTENDING');
  SELECT count(*) FROM group_permissions gp JOIN groups g ON g.id = gp.group_id WHERE g.slug = 'charge_nurse' AND gp.permission = 'care_team.claim';
  ```
  The third count is every admission signed before this slice (O45). Each of these rows gets its attending's row.
- **Order:** api first, then web.
  - An old web against the new api works: it never calls the care-team routes.
  - A new web against the old api would show the box with unnamed rows and a picker that cannot read. Hence api first.
- **The old image against `0018`:** its claim route would write a second ATTENDING row and get a 500 from the index. No screen calls it.
- **Rollback:**
  - First, count the members with two closed rows on one admission: `SELECT admission_id, user_id, count(*) FROM care_team_members WHERE NOT is_active GROUP BY 1, 2 HAVING count(*) > 1;`
  - If that is empty: `alembic downgrade 0017`, then the previous images. The rows steps 2–4 closed or wrote stay; the charge nurses get `care_team.claim` back.
  - If it is not empty: the downgrade would fail (spec §5.1). Roll back the images only and keep `0018`.
- **Tokens:** a charge nurse signed in before the deploy keeps `care_team.claim` in her token until it is refreshed. It does her no good: T1 refuses her claim, and the box offers her no button.
- **Tell the ward:** the physician who signs a kabul becomes its sorumlu hekim; the «Bakım ekibi» box is on the patient screen; the charge nurse no longer claims the care team.

## Record

*(filled in by Task 18: the final review, the walk, the numbers)*

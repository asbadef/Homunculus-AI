# G3-07 Kabul zamanı Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The admission form may say when the stay began — «Kabul zamanı», at most six hours back, never before the bed was free nor before the same person's last discharge — so a round measured on arrival, before the form was saved, can be linked to the patient it belongs to.

**Architecture:** Spec `docs/superpowers/specs/2026-11-12-g3-kabul-zamani-design.md` (`3f22b487`, the owner's «evet» `9929145b`; D1–D9 and §3.1–§3.3 are final) — read it whole before your first task. No migration, no route, no permission: `admissions.admission_datetime` exists and the server already takes it. The route gains three bounds after its look-up of an earlier send (§3.1 steps 5, 8, 9) and the audit row names the time; every reader of the stay's start already reads the column (§4), so they are pinned by tests, not changed. The dashboard keeps each bed's `state_since` in its structure index and draws one field, first in the «Kabul» box, which sends nothing untouched and the chosen minute — always the same string — once touched.

**Tech Stack:** Python 3.12 / FastAPI / SQLAlchemy (async ORM, sync `text()` stores) / pytest + pytest-asyncio; React 18 / Vite / vitest / Testing Library; i18n tr · az · ru · en.

---

## Ground rules

Read these before Task 0. They are `docs/superpowers/plans/2026-11-11-g3-cihaz-olcum-kaydi.md` «Ground rules», restated for this worktree.

- **Worktree:** `C:\tmp\g3-kabul-zamani` (Git Bash `/c/tmp/g3-kabul-zamani`), branch `feat/g3-kabul-zamani`, head `9929145b` plus this plan's commit. Work ONLY here. Never touch `c:\Users\User\Desktop\Project\Homunculus AI` (the main checkout) or any other worktree under `/c/tmp`. Pushing this feature branch is allowed (`git push origin feat/g3-kabul-zamani`). **Nothing in this plan pushes to `main` or touches the hospital VM:** both are the owner's word, through Lane A.
- **Do not change** `admission/schemas.py`, `admission/service.py`, `admission/transfer.py`, any store in `api/` (spec §3.4), nor `admission/boardkey.py`. If a step seems to need one of them, stop and report.
- **Code exploration:** there is no `graphify-out/` in this worktree: read the files with Grep and Read. If you do find `graphify-out/graph.json` inside `/c/tmp/g3-kabul-zamani`, run `graphify query "<question>"` before your first grep.
- **Engine tests** run in the FOREGROUND, on a bounded selection (the files or the `-k` a step names), written out in full each time (shell variables do not persist between tool calls):
  ```
  cd /c/tmp/g3-kabul-zamani/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings <files> 2>&1 | tail -3
  ```
  An implementer never runs the whole suite and never a command longer than 180 s: the controller runs whole suites (Task G1). **Never run `tests/test_infinity_vm_pilot.py`** (it hangs). **Never background a test run and wait on it**; if something must wait, report first.
- **Never export or set `DATABASE_URL`.** A DB-backed test runs only with `TEST_DATABASE_URL=…` written on the command line itself, against a database whose name contains `test` (`tests/conftest.py` refuses any other), and only on this slice's throwaway Postgres (below). **Never the shared `56432`.**
- **The throwaway Postgres** (`kabulz-pg`, port 56452; the DB tests drop every table). Each line is one foreground call:
  ```bash
  docker run -d --rm --name kabulz-pg -p 127.0.0.1:56452:5432 -e POSTGRES_PASSWORD=kabulz -e POSTGRES_DB=kabulz postgres:16
  timeout 90 bash -c 'until docker exec kabulz-pg pg_isready -h 127.0.0.1 -U postgres -q; do sleep 1; done' && docker exec kabulz-pg createdb -U postgres kabulz_test
  cd /c/tmp/g3-kabul-zamani/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:kabulz@127.0.0.1:56452/kabulz_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings <files> 2>&1 | tail -3
  docker stop kabulz-pg
  ```
  `pg_isready -h 127.0.0.1` on purpose: the image's first start runs a temporary server on the socket only, and a check without `-h` answers «ready» before that server is shut down again. One pytest at a time against it (the suite takes an advisory lock; a second run waits). If `docker ps` already lists `kabulz-pg`, use it; at the end of your last DB task, `docker stop kabulz-pg` (`--rm` then deletes it).
- **Dashboard tests** run from `/c/tmp/g3-kabul-zamani/dashboard` — **an upper-case drive path** (`/c/tmp/…` in Git Bash, `C:\tmp\…` in PowerShell). From a lower-case `c:\` working directory vitest fails every file with «failed to find the current suite». Command: `npx vitest run <files>`. `node_modules` there is a junction to `C:\tmp\g3-cihaz-olcum\dashboard\node_modules` (Task 0 makes it; the two `package-lock.json` are byte-identical): **never `npm install`, never `npm uninstall`, never delete it, never `rm -rf` the `dashboard` folder.** A `not wrapped in act(...)` warning is not a failure.
- **Python scripts** that print Turkish run with `python -I -X utf8` (`-I` ignores `PYTHONIOENCODING`, and cp1252 cannot print «ğ»).
- **Git:** never `git stash`; never `git add -A`, never `git commit -a`. Every commit names its paths and carries the trailer — each task's last step gives the exact command, in this shape:
  ```
  cd /c/tmp/g3-kabul-zamani && git add -- <paths> && git commit -m "<subject>" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- <paths>
  ```
  If `.git/index.lock` exists, another process is committing: wait a few seconds and retry; never delete it.
- **Line endings.** `core.autocrlf=true` here: every tracked text file is CRLF in the working tree and LF in the repository. Every block in this plan is LF; the Edit tool matches either way and keeps the file's endings. Edit existing files with the **Edit** tool; create new files with the **Write** tool. **Never write code with a Bash heredoc** — the Bash tool collapses backslashes inside heredocs. After editing an existing file, `git diff --stat -- <file>` must show only the lines you meant (a whole-file diff means the endings were rewritten: restore the file with `git checkout -- <file>` and redo the edit).
- **Find blocks.** Every «find» block below occurs **exactly once** in its file at that point of the plan, and the line numbers printed beside it are the file's at that point: each was applied, in order, to a scratch copy of the tree at `9929145b` when the plan was written, and every «Expected» line was seen there (Task G2 excepted, as it says). If a block does not match, stop and report; do not guess.
- **Style.** Every new Python file starts with its `# homunculus-engine/…` path comment and a docstring that says what and why. Merge seams (`errors.py`'s `CODES` blocks, `apiErrors.js`'s map, `kabul.js`) take one block where the plan puts it: other lanes add theirs beside it.
- **No patient data anywhere** (CLAUDE.md rule 6): synthetic names only («Sentetik Hasta», «Sentetik Başqa», «Test Hasta»), synthetic protocol numbers (`202600000001`, the typo `202600000010`), made-up device names (`CONNEX-3A`).
- **Clinical register (hard rules 1 and 5).** This slice adds **no clinical threshold, no score and no colour**. Its numbers are engineering bounds the spec fixes: 6 hours (the owner's «6 saat», D2), a minute of browser skew (as the bedside form's), the bed's free time and the person's last discharge (two stays never overlap). The screen records when the stay began; it judges nothing. If a step seems to need a threshold, a judgement on a value or an instruction to a clinician, stop and report.

### Order and file ownership

1. **Task 0** (each implementer): preflight. The controller records the baseline.
2. **Engine:** E1 → E2 → E3 → E4. E2 also maps its two codes in the dashboard (`apiErrors.js`, their words in `kabul.js`), so no commit leaves `apiErrors.test.js` red: that test reads `admission/errors.py`.
3. **Dashboard:** W1 → W2 → W3. They may start once E2 is committed (W1–W3 touch no engine file; E3–E4 touch no dashboard file).
4. **Closing (controller):** G1 (gates) → G2 (the local walk) → D1 (docs).

Nothing may be red at a commit.

| Task | Files (only these) |
|---|---|
| E1 | `homunculus-engine/src/homunculus/admission/form.py`; `homunculus-engine/tests/test_admission_form.py` |
| E2 | `homunculus-engine/src/homunculus/admission/errors.py`; `homunculus-engine/tests/test_admission_form.py`; `dashboard/src/live/apiErrors.js`, `apiErrors.test.js`; `dashboard/src/live/i18n/strings/kabul.js` |
| E3 | `homunculus-engine/src/homunculus/admission/router.py`, `models.py` (a comment); `homunculus-engine/tests/test_admission_time.py` (new), `test_admission_api.py`, `test_protocol_admission.py` |
| E4 | `homunculus-engine/tests/test_admission_time.py`, `kabul_world.py` |
| W1 | `dashboard/src/live/data/structure.js`, `structure.test.js`; `dashboard/src/live/screens/kabul/kabul.testutil.js` |
| W2 | `dashboard/src/live/screens/kabul/admitForm.js`, `admitForm.test.js`; `dashboard/src/live/i18n/strings/kabul.js` |
| W3 | `dashboard/src/live/screens/kabul/AdmitTab.jsx`, `AdmitTab.test.jsx`; `dashboard/src/live/i18n/strings/kabul.js` |
| D1 | `docs/homunculus-rehber-TR.md`, `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`, the spec's «As built», this plan's «As run» |

### The pins, as read at `9929145b` (re-read at Task 0: other lanes move them)

| Pin | Where | At `9929145b` | After this slice | Task |
|---|---|---|---|---|
| `errors.CODES` | `admission/errors.py`; `tests/test_admission_form.py` `test_every_other_refusal_has_a_stable_code`; `dashboard/src/live/apiErrors.test.js` `toHaveLength` | **34** | **36** (`admitted_before_bed_free`, `admitted_before_discharge`) | E2 |
| `ADMISSION_CODE_KEYS` | `dashboard/src/live/apiErrors.js` 206–259 | 34 codes | 36 | E2 |
| `EXPECTED` (guarded routes) | `tests/test_route_permissions.py` | unchanged | unchanged — no route | — |
| `BOARD_EXPECTED` | `tests/test_board_permissions.py` | unchanged | unchanged | — |
| `SPEC_KEYS` (permissions) | `tests/test_permissions.py` | unchanged | unchanged — no permission | — |
| `UNSCOPED_BY_DESIGN` | `tests/test_tenant_isolation.py` | unchanged | unchanged | — |
| nginx `API_PATHS` | `tests/test_nginx_routes.py` | unchanged | unchanged | — |
| `EVENT_TYPES` | `dashboard/src/live/screens/denetim/denetim.js` | unchanged | unchanged — no event type | — |
| alembic head | `homunculus-engine/alembic/versions/` | `0021` | `0021` — no migration | — |
| precache (`vite build`) | the build's `precache N entries` line | **73** | **74** (departure E-6) | G1 |

### Interfaces (the names every task uses — defined once, here)

**Engine — `homunculus.admission.form`:**

```python
BACKDATE_MAX = timedelta(hours=6)
def check_admission_time(at: datetime | None, *, now: datetime) -> None   # 422 field_invalid:admission_datetime when at < now − BACKDATE_MAX; None passes; naive now → ValueError("`now` must carry its time zone …")
```

`check_admission` is unchanged (a zone; not more than `CLOCK_SLACK` ahead).

**Engine — `homunculus.admission.errors`:** `ADMITTED_BEFORE_BED_FREE = "admitted_before_bed_free"`, `ADMITTED_BEFORE_DISCHARGE = "admitted_before_discharge"`, both in `CODES`. Words: «The admission time is before the bed became free.» / «The admission time is before this person's last discharge.» No extra key beside `code` and `message`.

**Engine — `homunculus.admission.router`:**

```python
async def _last_discharge_of(db: AsyncSession, tenant_id: uuid.UUID, identity: str) -> datetime | None   # max(discharge_at) of the tenant's DISCHARGED admissions with that identity_digest
```

`create_admission` keeps its signature. Its order (spec §3.1): `form.check_admission` → `_bed_of` (locked) → unit, scope → `_earlier` (A-19) → attending (422) → **`form.check_admission_time`** (422) → `duplicate_open_admission` (409) → `bed_closed` → `bed_reserved` → **the bed bound** (409 `admitted_before_bed_free`: only a bed AVAILABLE or RESERVED, `sent_at < bed.state_updated_at`) → **the person bound** (409 `admitted_before_discharge`) → protocol → H-number. The local `sent_at = payload.note.admission_datetime`.

**Audit row `admission.admit`** (payload):

```python
{"admission_id", "bed_id", "unit_id", "actor", "protocol_no", "patient_number",
 "admission_datetime": "<the row's time, ISO, UTC: …+00:00>",      # always
 "backdated": True,                                              # only when the form sent a time
 "bed_was_reserved": True}                                       # only when true (G2-B3a X9)
```

**HTTP:** `POST /admissions` — the body's `note.admission_datetime` is optional, as today. New answers: 422 `field_invalid:admission_datetime` (more than 6 h back), 409 `admitted_before_bed_free`, 409 `admitted_before_discharge` (`{"detail": {"code", "message"}}`). A resend under the same `request_id` is answered 200 with its admission before any of the three.

**Dashboard — `screens/kabul/admitForm.js`:**

```js
emptyForm()                       // gains admittedAt: "" (a datetime-local text), admittedAtTouched: false
BACKDATE_MS = 6 * 60 * 60 * 1000
SKEW_MS = 60_000
admittedBounds(nowMs, freeSince) -> { minMs, maxMs }
admittedAtOf(form, freeSince) -> string | null
missing(form, today, { now = Date.now(), freeSince = null } = {})   // may name { field: "admittedAt", key: "kabul.miss.admittedAt" }, after "fin" and before "type"
toBody(form, requestId, { confirmReserved = false, freeSince = null } = {})   // note.admission_datetime only when admittedAtOf gives a string
```

`freeSince` is the chosen bed's `stateSince`: the server's string, never rebuilt. `fromLocalInput` and `localInput` are `screens/kabul/DischargeDialog.jsx`'s (unchanged).

**Dashboard — `data/structure.js`:** `indexStructure(...).beds` entries gain `stateSince` (`bed.state_since ?? null`).

**Dashboard — `screens/kabul/AdmitTab.jsx`:** module constants `TIME_REFUSALS` (the three codes) and `CLOCK_EVERY_MS = 30_000`; the field's id is `${uid}-admittedAt` (`idOf("admittedAt")`); the clock is `useBoardNow(CLOCK_EVERY_MS)` (`screens/common/BoardState.jsx`). **The Kabul screen is under the shell's `BoardProvider`:** `LiveApp.jsx` 158 wraps every phase (the shell included) in it, and `session/mount.testutil.jsx` nests one in every test mount — so `useBoardNow` is the server-corrected clock here, as on the bedside form.

**i18n keys (namespace `kabul`, four languages):** `f.admittedAt`, `admittedAtHint`, `admittedAtBedSince` (`{time}`), `miss.admittedAt`, `err.admittedBeforeBedFree`, `err.admittedBeforeDischarge`; `invalid.admissionDatetime` widened.

### Departures from the spec (E-n: what the spec says · what the code is · what the plan does)

- **E-1 · the audit row's time is written in UTC.** Spec §3.3 writes `written.admission_datetime.isoformat()`. A form may send a time with any offset (`+04:00`), and pydantic keeps it, so the payload would carry that offset while the row reads back in UTC. The plan writes `written.admission_datetime.astimezone(timezone.utc).isoformat()`: the same instant, one spelling, equal to the row's own `isoformat()`.
- **E-2 · a bed with no recorded state time binds nothing.** Spec D3 compares with `bed.state_updated_at`. The model declares it NOT NULL, but migration 0001 created the column nullable, so a row written outside the ORM may hold NULL. The plan guards `bed.state_updated_at is not None`: such a bed has no bound (and the structure answers `state_since: null`, which the form reads as «no bed bound» too).
- **E-3 · the end-to-end test builds `vital_readings` from migration 0021 itself.** Spec §6 asks for «the ward of `kabul_world` with a `PostgresReadingStore` on the same database». `db_session` builds the schema from the models (`create_all`), and `vital_readings` has no model. The test's fixture runs `0021_vital_readings.upgrade()` through alembic's `Operations` on that schema, leaving out the migration's index on `audit` (the ward's trail is in memory), and drops the table before `db_session` drops the rest. `kabul_world.ward_app`/`ward_client` gain `**extra` for `create_app` (readings store, policy, a person's credential); every existing caller is unchanged.
- **E-4 · the ward's beds are «free since a day» in the new test file.** `build_ward` stamps each bed's state at its creation, a moment before each test; a back-dated kabul would meet that bound in every test that is not about it. The new file's fixture moves every bed's `state_updated_at` a day back (`_free_since`); the bed tests set their own.
- **E-5 · the hint's time format.** Spec §5 names `kabul.admittedAtBedSince` «(the time from `stateSince`)». The plan formats it with `i18n/dates.js` `dayStamp(freeMs, nowMs)`: `11:30` on the same local day, `11.11 23:00` otherwise; the hint is one line, `admittedAtHint` then `admittedAtBedSince`.
- **E-6 · the bedside page's chunk now imports `DischargeDialog`'s chunk, and the precache counts one more file.** `admitForm.js` imports `fromLocalInput` from `DischargeDialog.jsx` (spec §5). `screens/bedside/PickSteps.jsx` imports `ageOf` from `admitForm.js`, so the bedside page now loads the 4 kB `DischargeDialog-*.js` chunk, and Rollup moves `PrintLabelButton` out of that chunk into its own: `precache 73 → 74 entries` (1641.41 → 1645.80 KiB on the scratch copy). Nothing else moves. Recorded for the controller; no action.
- **E-7 · a resend near the six-hour edge.** A nurse who chose the earliest allowed minute and pressed «Kabul et» again a minute after a send that got no answer finds the field named by the panel (`missing` judges by the clock now). She moves the time; the send that follows looks for the first send's admission first (A-19's `findLanded`, unchanged), so a landed admission is found and shown. The server side is the spec's (a resend under the same form is answered whatever the clock). Stated in `AdmitTab.jsx`'s header; nothing more is built.

---

## The tasks

### Task 0: Preflight — the baseline is green before anything changes (each implementer, once; the controller records the numbers)

**Files:** none.

- [ ] **Step 1: The worktree**

Run: `cd /c/tmp/g3-kabul-zamani && git status --short && git log --oneline -3 && git rev-parse --abbrev-ref HEAD`
Expected: no changes listed; the head is this plan's commit, then `9929145b docs(spec): G3-07 — the owner's evet on the written spec (2026-11-12)`, then `3f22b487`; branch `feat/g3-kabul-zamani`.

- [ ] **Step 2 (engine): pytest imports the worktree's code, and the pins are what the plan read**

Run: `cd /c/tmp/g3-kabul-zamani/homunculus-engine && PYTHONPATH=src /c/tmp/f7-py312/venv/Scripts/python.exe -c "import homunculus; print(homunculus.__file__)"`
Expected: a path under `C:\tmp\g3-kabul-zamani\homunculus-engine\src`. Anything else: stop and report.

Run: `cd /c/tmp/g3-kabul-zamani/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_admission_form.py tests/test_permissions.py tests/test_device_beds_wiring.py 2>&1 | tail -3`
Expected: `176 passed` — measured per file at `9929145b`: `test_admission_form.py` 148, `test_permissions.py` 23, `test_device_beds_wiring.py` 5. **If a number differs, another lane has merged since:** re-read `CODES` in `admission/errors.py` and the count in `dashboard/src/live/apiErrors.test.js` («`toHaveLength`»), tell the controller the new values, and shift this plan's counts by the difference — the edits themselves do not change.

The other engine files this plan touches, measured at `9929145b` on the throwaway Postgres: `test_admission_api.py` 50 passed / 1 skipped, `test_protocol_admission.py` 10, `test_reserved_admission.py` 7.

- [ ] **Step 3 (dashboard): the toolchain**

`dashboard/node_modules` does not exist in a fresh worktree. Check that the installed tree is the one this branch locks, then make the junction (never `npm install`):

```bash
cd /c/tmp && sha1sum g3-cihaz-olcum/dashboard/package-lock.json g3-kabul-zamani/dashboard/package-lock.json
cd /c/tmp/g3-kabul-zamani/dashboard && (ls node_modules/.bin/vitest >/dev/null 2>&1 || cmd //c "mklink /J node_modules C:\tmp\g3-cihaz-olcum\dashboard\node_modules")
```

Expected: the two sums are equal (`7440b2655e4b165115e5d57bced32a7239ac6062` when the plan was written); `Junction created …` or nothing (it exists). If the sums differ, stop and report.

Run: `cd /c/tmp/g3-kabul-zamani/dashboard && git status --short . && npx vitest run src/live/apiErrors.test.js src/live/data/structure.test.js src/live/screens/kabul/admitForm.test.js src/live/screens/kabul/AdmitTab.test.jsx 2>&1 | tail -5`
Expected: nothing listed by `git status` (`node_modules` is ignored); `Test Files  4 passed (4)`, `Tests  415 passed (415)` — `apiErrors.test.js` 300, `structure.test.js` 27, `admitForm.test.js` 16, `AdmitTab.test.jsx` 72.

- [ ] **Step 4 (controller only): the baseline of the whole suites**

Run the whole no-DB engine suite and the whole dashboard suite as Task G1 Steps 1 and 4 run them, at this plan's commit, and keep the numbers; G1's expected totals are these plus the deltas it states. Measured when the plan was written, at `9929145b` (the junction in place):

- engine, no database (in the worktree itself, read-only): `1369 passed, 827 skipped` · `1733 passed, 114 skipped` · `1382 passed, 586 skipped` for the three chunks — **4484 passed, 1527 skipped**, no failure;
- dashboard: `Test Files  178 passed (178)`, `Tests  4760 passed (4760)`;
- `npx vite build`: `precache  73 entries (1641.41 KiB)`, no `larger than 500 kB` line.

---

## Engine

### Task E1: The form's six hours — `BACKDATE_MAX` and `check_admission_time` (D2)

**Files:**
- Test: `homunculus-engine/tests/test_admission_form.py` — lines 22–24, lines 576–580 (as each step finds the file)
- Modify: `homunculus-engine/src/homunculus/admission/form.py` — lines 55–56, lines 135–139 (as each step finds the file)

A rule on the value and the clock alone, apart from `check_admission` on purpose: the route runs it after its look-up of an earlier send (Task E3), so a resend is answered with its admission whatever the clock says now.

- [ ] **Step 1: Write the failing tests**

In `homunculus-engine/tests/test_admission_form.py`, find (lines 22–24):

```python
from homunculus.admission.form import (
    CLOCK_SLACK, COMORBIDITY_CODES, check_admission, check_discharge, identity_digest, person_name,
)
```

Replace with:

```python
from homunculus.admission.form import (
    BACKDATE_MAX, CLOCK_SLACK, COMORBIDITY_CODES, check_admission, check_admission_time, check_discharge,
    identity_digest, person_name,
)
```

In the same file, find (lines 576–580):

```python
    late = (NOW + CLOCK_SLACK + timedelta(microseconds=1)).isoformat()
    assert refused(body(note={"admission_datetime": late})) == "field_invalid:admission_datetime"


@pytest.mark.parametrize(("now", "admitted_at"), [
```

Replace with:

```python
    late = (NOW + CLOCK_SLACK + timedelta(microseconds=1)).isoformat()
    assert refused(body(note={"admission_datetime": late})) == "field_invalid:admission_datetime"


# ---------------------------------------------------------------- the admission time (G3-07)
def test_the_admission_time_reaches_back_exactly_six_hours():
    """G3-07 (spec D2, the owner's «6 saat»): the edge itself passes — in any offset — and a
    microsecond older is refused as the field."""
    assert BACKDATE_MAX == timedelta(hours=6)
    check_admission_time(NOW - BACKDATE_MAX, now=NOW)
    check_admission_time((NOW - BACKDATE_MAX).astimezone(timezone(timedelta(hours=4))), now=NOW)
    check_admission_time(NOW, now=NOW)
    with pytest.raises(Refusal) as caught:
        check_admission_time(NOW - BACKDATE_MAX - timedelta(microseconds=1), now=NOW)
    assert (caught.value.status, caught.value.code) == (422, "field_invalid:admission_datetime")


def test_a_form_that_sent_no_time_passes_the_six_hours():
    check_admission_time(None, now=NOW)


def test_the_six_hours_are_judged_by_a_server_clock_that_carries_its_zone():
    with pytest.raises(ValueError, match="time zone"):
        check_admission_time(None, now=datetime(2026, 10, 25, 12, 0))


def test_the_six_hours_are_not_check_admissions_rule():
    """`check_admission` keeps its own two rules on the time — a zone, and not ahead of the clock:
    the six hours run in the route, after the look-up of an earlier send (spec §3.1), so a time seven
    hours back passes the form's rules."""
    check_admission(body(note={"admission_datetime": (NOW - timedelta(hours=7)).isoformat()}),
                    today=TODAY, now=NOW)


@pytest.mark.parametrize(("now", "admitted_at"), [
```

- [ ] **Step 2: Run to see them fail**

Run: `cd /c/tmp/g3-kabul-zamani/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_admission_form.py 2>&1 | tail -3`
Expected: `1 error` — `ImportError: cannot import name 'BACKDATE_MAX' from 'homunculus.admission.form'` (collection stops).

- [ ] **Step 3: The constant and the rule**

In `homunculus-engine/src/homunculus/admission/form.py`, find (lines 55–56):

```python
CLOCK_SLACK = timedelta(minutes=2)
#: Letters (category Lo) that show nothing: the Hangul fillers. A name of them is a blank name.
```

Replace with:

```python
CLOCK_SLACK = timedelta(minutes=2)
#: G3-07 (spec D2, the owner's «6 saat»): how far back the form may say the stay began. A patient
#: measured on arrival and admitted after the paperwork is inside it; a slipped day or month is not.
#: An engineering bound on a typed time, as CLOCK_SLACK is — not a clinical one.
BACKDATE_MAX = timedelta(hours=6)
#: Letters (category Lo) that show nothing: the Hangul fillers. A name of them is a blank name.
```

In the same file, find (lines 135–139):

```python
    if p.consent is None:
        raise field_invalid("consent", "The consent answer is required.")


def check_discharge(
```

Replace with:

```python
    if p.consent is None:
        raise field_invalid("consent", "The consent answer is required.")


def check_admission_time(at: datetime | None, *, now: datetime) -> None:
    """G3-07 (spec D2, §3.1 step 5): a time the form sent is at most `BACKDATE_MAX` before `now` —
    else 422 `field_invalid:admission_datetime`. None, a form that sent no time (the save is
    stamped), passes. `now` is the server's and carries its time zone; `at` has passed
    `check_admission`, which refused a time without one.

    Apart from `check_admission` on purpose: the route runs it after the look-up of an earlier send
    under the form's id (A-19), so a resend whose first send was admitted is answered with that
    admission, never refused because the clock has moved past the six hours since."""
    _server_clock("now", now)
    if at is not None and at < now - BACKDATE_MAX:
        raise field_invalid("admission_datetime",
                            "The admission time is more than six hours before now.")


def check_discharge(
```

- [ ] **Step 4: Run to see them pass**

Run: `cd /c/tmp/g3-kabul-zamani/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_admission_form.py 2>&1 | tail -3`
Expected: `152 passed` (148 + 4).

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g3-kabul-zamani && git add -- homunculus-engine/src/homunculus/admission/form.py homunculus-engine/tests/test_admission_form.py && git commit -m "feat(admission): the admission time reaches back six hours at most — BACKDATE_MAX, check_admission_time (G3-07 D2)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- homunculus-engine/src/homunculus/admission/form.py homunculus-engine/tests/test_admission_form.py
```

---

### Task E2: The two refusal codes, on both sides — `errors.py`, the dashboard's map and their words (spec §3.2)

**Files:**
- Test: `homunculus-engine/tests/test_admission_form.py` — lines 439–440 (as each step finds the file)
- Test: `dashboard/src/live/apiErrors.test.js` — lines 614–615, lines 664–666 (as each step finds the file)
- Modify: `homunculus-engine/src/homunculus/admission/errors.py` — line 85 (as each step finds the file)
- Modify: `dashboard/src/live/apiErrors.js` — lines 257–259 (as each step finds the file)
- Modify: `dashboard/src/live/i18n/strings/kabul.js` — the `err` block of each language (as each step finds the file)

`apiErrors.test.js` reads `admission/errors.py` as text and fails while a code there is unmapped, so the code, its map entry and its words land in one commit. The dashboard maps a code, never words: each bound gets its own sentence, in four languages (az, ru, en await a native reader — spec O5).

- [ ] **Step 1: Write the failing tests**

In `homunculus-engine/tests/test_admission_form.py`, find (lines 439–440):

```python
                     # G4-04 (spec §5 A1, A7)
                     "shift_changed", "assignment_conflict"}
```

Replace with:

```python
                     # G4-04 (spec §5 A1, A7)
                     "shift_changed", "assignment_conflict",
                     # G3-07 (spec D3, D4)
                     "admitted_before_bed_free", "admitted_before_discharge"}
```

In `dashboard/src/live/apiErrors.test.js`, find (lines 614–615):

```js
    // `bed_reserved` (D5, X1); G2-B1c's three care-team codes (§5.6); G4-04's two (spec §5 A1, A7).
    expect(CODES).toHaveLength(34);   // G2-B1b: transfer_unavailable went; G4-04: +2
```

Replace with:

```js
    // `bed_reserved` (D5, X1); G2-B1c's three care-team codes (§5.6); G4-04's two (spec §5 A1, A7);
    // G3-07's two (spec §3.2: admitted_before_bed_free, admitted_before_discharge).
    expect(CODES).toHaveLength(36);   // G2-B1b: transfer_unavailable went; G4-04: +2; G3-07: +2
    expect(CODES).toEqual(expect.arrayContaining(["admitted_before_bed_free", "admitted_before_discharge"]));
```

In the same file, find (lines 664–666):

```js
  it("the map holds every code errors.py raises, and nothing else", () => {
    expect([...ADMISSION_CODE_KEYS.keys()].sort()).toEqual([...CODES].sort());
  });
```

Replace with:

```js
  it("the map holds every code errors.py raises, and nothing else", () => {
    expect([...ADMISSION_CODE_KEYS.keys()].sort()).toEqual([...CODES].sort());
  });

  // G3-07 (spec §3.2): «Kabul zamanı»'s three refusals each say their own sentence — each tells the nurse
  // something else to change: too old, before the bed was free, before the person's last discharge.
  it("the admission time's three refusals say three sentences, in the four languages", () => {
    for (const lang of LANG_CODES) {
      const t = createTranslator(lang, DICTIONARIES);
      const said = ["field_invalid:admission_datetime", "admitted_before_bed_free", "admitted_before_discharge"]
        .map((code) => apiErrorText(t, coded(code)));
      expect(new Set(said).size, lang).toBe(3);
    }
    const tr = createTranslator("tr", DICTIONARIES);
    expect(apiErrorText(tr, coded("admitted_before_bed_free"))).toBe("Kabul zamanı, yatağın boşaldığı andan önce olamaz.");
    expect(apiErrorText(tr, coded("admitted_before_discharge"))).toBe("Kabul zamanı, bu hastanın son taburcusundan önce olamaz.");
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `cd /c/tmp/g3-kabul-zamani/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_admission_form.py 2>&1 | tail -3`
Expected: `1 failed, 151 passed` — `test_every_other_refusal_has_a_stable_code`.

Run: `cd /c/tmp/g3-kabul-zamani/dashboard && npx vitest run src/live/apiErrors.test.js 2>&1 | tail -5`
Expected: `Tests  2 failed | 299 passed (301)` — «the readers found the codes…» (`expected … to have a length of 36 but got 34`) and «the admission time's three refusals…».

- [ ] **Step 3: The codes, their map and their words**

In `homunculus-engine/src/homunculus/admission/errors.py`, find (line 85):

```python
CODES = CODES | frozenset({SHIFT_CHANGED, ASSIGNMENT_CONFLICT})
```

Replace with:

```python
CODES = CODES | frozenset({SHIFT_CHANGED, ASSIGNMENT_CONFLICT})

# G3-07 — Kabul zamanı (spec D3, D4). Its own block after G4-04's, which it widens the same way.
ADMITTED_BEFORE_BED_FREE = "admitted_before_bed_free"    # the time is before the bed's current free state began
ADMITTED_BEFORE_DISCHARGE = "admitted_before_discharge"  # the time is before this person's last discharge
CODES = CODES | frozenset({ADMITTED_BEFORE_BED_FREE, ADMITTED_BEFORE_DISCHARGE})
```

In `dashboard/src/live/apiErrors.js`, find (lines 257–259):

```js
  ["shift_changed", "isyuku.err.shiftChanged"],
  ["assignment_conflict", "isyuku.err.conflict"],
]);
```

Replace with:

```js
  ["shift_changed", "isyuku.err.shiftChanged"],
  ["assignment_conflict", "isyuku.err.conflict"],

  // G3-07 — Kabul zamanı (spec §3.2): the form's time is before the bed became free, or before this
  // person's last discharge. The Kabul form says them on its toast, after the bed.
  ["admitted_before_bed_free", "kabul.err.admittedBeforeBedFree"],
  ["admitted_before_discharge", "kabul.err.admittedBeforeDischarge"],
]);
```

In `dashboard/src/live/i18n/strings/kabul.js`, find (lines 188–189):

```js
      duplicateOpenAdmissionNumber: "Bu hastanın açık bir kabulü zaten var (hasta no {number}); önce taburcu edilmeli. Form gönderilmedi.",
    },
```

Replace with:

```js
      duplicateOpenAdmissionNumber: "Bu hastanın açık bir kabulü zaten var (hasta no {number}); önce taburcu edilmeli. Form gönderilmedi.",
      // G3-07 (spec §3.2): the form's time before the bed became free, or before this person's last discharge.
      admittedBeforeBedFree: "Kabul zamanı, yatağın boşaldığı andan önce olamaz.",
      admittedBeforeDischarge: "Kabul zamanı, bu hastanın son taburcusundan önce olamaz.",
    },
```

In the same file, find (lines 379–380):

```js
      duplicateOpenAdmissionNumber: "Bu xəstənin artıq açıq qəbulu var (xəstə nömrəsi {number}); əvvəlcə evə yazılmalıdır. Forma göndərilmədi.",
    },
```

Replace with:

```js
      duplicateOpenAdmissionNumber: "Bu xəstənin artıq açıq qəbulu var (xəstə nömrəsi {number}); əvvəlcə evə yazılmalıdır. Forma göndərilmədi.",
      admittedBeforeBedFree: "Qəbul vaxtı çarpayının boşaldığı andan əvvəl ola bilməz.",
      admittedBeforeDischarge: "Qəbul vaxtı bu xəstənin son evə yazılmasından əvvəl ola bilməz.",
    },
```

In the same file, find (lines 569–570):

```js
      duplicateOpenAdmissionNumber: "У этого пациента уже есть открытый приём (номер пациента {number}); сначала его нужно выписать. Форма не отправлена.",
    },
```

Replace with:

```js
      duplicateOpenAdmissionNumber: "У этого пациента уже есть открытый приём (номер пациента {number}); сначала его нужно выписать. Форма не отправлена.",
      admittedBeforeBedFree: "Время приёма не может быть раньше, чем освободилась койка.",
      admittedBeforeDischarge: "Время приёма не может быть раньше последней выписки этого пациента.",
    },
```

In the same file, find (lines 758–759):

```js
      duplicateOpenAdmissionNumber: "This patient already has an open admission (patient number {number}); discharge it first. The form was not sent.",
    },
```

Replace with:

```js
      duplicateOpenAdmissionNumber: "This patient already has an open admission (patient number {number}); discharge it first. The form was not sent.",
      admittedBeforeBedFree: "The admission time cannot be before the bed became free.",
      admittedBeforeDischarge: "The admission time cannot be before this patient's last discharge.",
    },
```

- [ ] **Step 4: Run to see them pass**

Run: `cd /c/tmp/g3-kabul-zamani/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_admission_form.py tests/test_device_beds_wiring.py 2>&1 | tail -3`
Expected: `157 passed` (152 + 5).

Run: `cd /c/tmp/g3-kabul-zamani/dashboard && npx vitest run src/live/apiErrors.test.js src/live/i18n/strings.test.js 2>&1 | tail -5`
Expected: `Test Files  2 passed (2)`, `Tests  313 passed (313)` — `apiErrors.test.js` 303 (300 + the new test + `it.each(CODES)`'s two new codes), `strings.test.js` 10.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g3-kabul-zamani && git add -- homunculus-engine/src/homunculus/admission/errors.py homunculus-engine/tests/test_admission_form.py dashboard/src/live/apiErrors.js dashboard/src/live/apiErrors.test.js dashboard/src/live/i18n/strings/kabul.js && git commit -m "feat(admission): admitted_before_bed_free and admitted_before_discharge, mapped and worded in four languages (G3-07 §3.2)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- homunculus-engine/src/homunculus/admission/errors.py homunculus-engine/tests/test_admission_form.py dashboard/src/live/apiErrors.js dashboard/src/live/apiErrors.test.js dashboard/src/live/i18n/strings/kabul.js
```

---

### Task E3: The route — the three bounds after the look-up, and the audit row (D2–D4, D6, §3.1, §3.3)

**Files:**
- Test: `homunculus-engine/tests/test_admission_time.py` (new)
- Test: `homunculus-engine/tests/test_admission_api.py` — lines 102–103 (as each step finds the file)
- Test: `homunculus-engine/tests/test_protocol_admission.py` — lines 11–13, line 147 (as each step finds the file)
- Modify: `homunculus-engine/src/homunculus/admission/router.py` — lines 72–73, lines 285–290, lines 501–503, lines 522–523, lines 550–552, lines 568–569, lines 645–648 (as each step finds the file)
- Modify: `homunculus-engine/src/homunculus/admission/models.py` — lines 344–345 (a comment only)

Every new step runs only when the form sent `admission_datetime`; with none sent, the route behaves exactly as before. The DB tests need `kabulz-pg` («Ground rules»).

- [ ] **Step 1: Write the failing tests**

Create `homunculus-engine/tests/test_admission_time.py`:

```python
# homunculus-engine/tests/test_admission_time.py
"""G3-07 Kabul zamanı (spec 2026-11-12 §3, §4, §6): the admission form may say when the stay began.

- Sent nothing, the row's time is the save, as before; the audit row names that time and says nothing
  of a back-dating (D1, D6).
- Sent, the time is the row's and the answer's, and the audit row says `backdated`; the card's identity
  stamp stays the save's (D6, §4.2).
- Six hours back at most (D2): 422 `field_invalid:admission_datetime`, nothing spent.
- Not before the bed became free (D3): 409 `admitted_before_bed_free`, for a bed AVAILABLE or RESERVED.
- Not before this person's last discharge (D4): 409 `admitted_before_discharge`; a moved stay binds by its
  last row; another person and a row without a digest bind nothing.
- The new bounds run after the look-up of an earlier send (§3.1): a resend whose first send was admitted
  is answered with its admission, whatever the clock and the bed say now. The refusals keep their order.
- The readers of the stay's start take the back-dated time (§4, D7, D8); a device set measured in the
  window links to the stay end to end, one measured before it does not (G3-05).
Postgres (`db_session`). Synthetic ward: tests/kabul_world.py."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest_asyncio
from sqlalchemy import func, select, update

from homunculus.admission import router as admission_router
from homunculus.admission.models import Admission
from homunculus.tenant.models import Bed
from tests.conftest import requires_db
from tests.kabul_world import BOARD, FIRST_PROTOCOL, SLUG, build_ward, ward_client
from tests.test_admission_api import form, person

pytestmark = [requires_db]


def _ago(**span) -> datetime:
    return datetime.now(timezone.utc) - timedelta(**span)


async def _free_since(db, at: datetime, *beds: uuid.UUID) -> None:
    """The beds — every bed of the ward when none is named — free since `at`: `build_ward` stamps each
    bed's state at its creation, a moment before the test, and a back-dated kabul would meet that bound
    in every test that is not about it."""
    stmt = update(Bed).values(state_updated_at=at)
    if beds:
        stmt = stmt.where(Bed.id.in_(beds))
    await db.execute(stmt.execution_options(synchronize_session=False))
    await db.commit()


@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    built = await build_ward(db_session)
    await _free_since(db_session, _ago(days=1))
    async with ward_client(db_session) as (client, app):
        yield built, client, app


async def _admit(w, client, bed: str = "1", *, at: datetime | None = None, patient: dict | None = None,
                 note: dict | None = None, request_id: uuid.UUID | None = None, who: str = "nurse"):
    """POST /admissions with the Kabul tab's body for `bed`, «Kabul zamanı» `at` when given."""
    sent = {**({} if at is None else {"admission_datetime": at.isoformat()}), **(note or {})}
    return await client.post("/admissions", json=form(w, bed, patient=patient, note=sent, request_id=request_id),
                             headers=w.auth[who])


async def _admitted(w, client, bed: str = "1", **kw) -> dict:
    r = await _admit(w, client, bed, **kw)
    assert r.status_code == 201, r.text
    return r.json()


def _refusal(r) -> tuple[int, str]:
    return r.status_code, r.json()["detail"]["code"]


async def _row_time(db, admission_id: str) -> datetime:
    return (await db.execute(select(Admission.admission_datetime)
                             .where(Admission.id == uuid.UUID(admission_id)))).scalar_one()


async def _state_time(db, bed_id: uuid.UUID) -> datetime:
    return (await db.execute(select(Bed.state_updated_at).where(Bed.id == bed_id))).scalar_one()


def _admit_rows(app) -> list:
    return [r for r in app.state.audit.records(tenant=SLUG, limit=100) if r.event_type == "admission.admit"]


async def _signed(w, client, admission: dict) -> None:
    r = await client.post(f"/admissions/{admission['id']}/sign-off", headers=w.auth["doctor"])
    assert r.status_code == 200, r.text


async def _moved(w, client, admission: dict, bed: str) -> dict:
    r = await client.post(f"/admissions/{admission['id']}/transfer",
                          json={"target_bed_id": str(w.beds[bed].id), "reason": "CLINICAL_NEED"},
                          headers=w.auth["doctor"])
    assert r.status_code == 201, r.text
    return r.json()


async def _discharged(w, client, bed: str, *, admitted_at: datetime, discharge_at: datetime,
                      move_to: str | None = None) -> dict:
    """The person of `bed` admitted there at `admitted_at` (back-dated, so a discharge before now is after
    it), signed, moved to `move_to` when named, discharged at `discharge_at` and the discharge confirmed:
    the stay's last row DISCHARGED with that `discharge_at`, its bed in cleaning."""
    admission = await _admitted(w, client, bed, at=admitted_at)
    await _signed(w, client, admission)
    if move_to is not None:
        admission = await _moved(w, client, admission, move_to)
    r = await client.post(f"/admissions/{admission['id']}/discharge/initiate",
                          json={"disposition": "HOME", "discharge_at": discharge_at.isoformat()},
                          headers=w.auth["doctor"])
    assert r.status_code == 200, r.text
    r = await client.post(f"/admissions/{admission['id']}/discharge/confirm", headers=w.auth["charge"])
    assert r.status_code == 200, r.text
    return admission


# ---------------------------------------------------------------- the time, sent or not (D1, D6)
async def test_an_untouched_form_is_stamped_at_the_save_and_its_audit_row_names_that_time(ward, db_session):
    w, client, app = ward
    before = datetime.now(timezone.utc)
    admission = await _admitted(w, client)
    began = await _row_time(db_session, admission["id"])
    assert before <= began <= datetime.now(timezone.utc)
    (audit,) = _admit_rows(app)
    assert audit.payload["admission_datetime"] == began.isoformat()
    assert "backdated" not in audit.payload


async def test_a_time_two_hours_back_is_the_rows_and_the_answers_and_the_audit_row_says_so(ward, db_session):
    w, client, app = ward
    began = _ago(hours=2)
    before = datetime.now(timezone.utc)
    admission = await _admitted(w, client, at=began)
    assert datetime.fromisoformat(admission["admission_datetime"]) == began
    assert await _row_time(db_session, admission["id"]) == began
    (audit,) = _admit_rows(app)
    assert (audit.payload["admission_datetime"], audit.payload["backdated"]) == (began.isoformat(), True)
    (card,) = (await client.get("/patients", headers=BOARD)).json()["patients"]
    assert datetime.fromisoformat(card["identity"]["updated_at"]) >= before     # the card's stamp: the save


# ---------------------------------------------------------------- six hours (D2)
async def test_six_hours_less_a_minute_is_taken_and_a_minute_more_is_refused_spending_nothing(ward, db_session):
    w, client, _ = ward
    r = await _admit(w, client, at=_ago(hours=6, minutes=1))
    assert _refusal(r) == (422, "field_invalid:admission_datetime"), r.text
    assert (await db_session.execute(select(func.count()).select_from(Admission))).scalar_one() == 0
    admission = await _admitted(w, client, at=_ago(hours=5, minutes=59))
    assert (admission["protocol_no"], admission["patient_number"][-5:]) == (FIRST_PROTOCOL, "00001")


# ---------------------------------------------------------------- the bed (D3)
async def test_a_time_before_the_beds_release_is_refused_and_the_release_itself_is_taken(ward, db_session):
    w, client, _ = ward
    await _discharged(w, client, "1", admitted_at=_ago(hours=3), discharge_at=_ago(hours=1))
    r = await client.post(f"/tenant/beds/{w.beds['1'].id}/release", headers=w.auth["nurse"])
    assert r.status_code == 200, r.text
    released = await _state_time(db_session, w.beds["1"].id)
    other = {"display_name": "Sentetik Başqa"}
    r = await _admit(w, client, "1", at=released - timedelta(minutes=1), patient=other)
    assert _refusal(r) == (409, "admitted_before_bed_free"), r.text
    assert set(r.json()["detail"]) == {"code", "message"}                    # no time, no number, no bed
    admission = await _admitted(w, client, "1", at=released, patient=other)
    assert datetime.fromisoformat(admission["admission_datetime"]) == released


async def test_a_reserved_bed_is_bound_by_the_reservations_start(ward, db_session):
    w, client, _ = ward
    r = await client.post(f"/tenant/beds/{w.beds['3'].id}/reserve", json={"note": "Sentetik planlı kabul"},
                          headers=w.auth["charge"])
    assert r.status_code == 200, r.text
    reserved = await _state_time(db_session, w.beds["3"].id)
    for at, expected in ((reserved - timedelta(minutes=1), 409), (reserved, 201)):
        body = {**form(w, "3", note={"admission_datetime": at.isoformat()}), "confirm_reserved": True}
        r = await client.post("/admissions", json=body, headers=w.auth["charge"])
        assert r.status_code == expected, r.text
    assert r.json()["state"] == "DRAFT"


async def test_an_occupied_bed_is_refused_as_not_available_never_by_its_time(ward):
    w, client, _ = ward
    await _admitted(w, client, "1")
    r = await _admit(w, client, "1", at=_ago(hours=1), patient={"display_name": "Sentetik Başqa"})
    assert _refusal(r) == (409, "bed_not_available"), r.text


# ---------------------------------------------------------------- the person (D4)
async def test_a_time_before_her_last_discharge_is_refused_and_the_discharge_itself_is_taken(ward):
    w, client, _ = ward
    left = _ago(hours=1)
    await _discharged(w, client, "1", admitted_at=_ago(hours=3), discharge_at=left)
    she = {"display_name": person("1")}
    r = await _admit(w, client, "2", at=left - timedelta(minutes=1), patient=she)
    assert _refusal(r) == (409, "admitted_before_discharge"), r.text
    assert set(r.json()["detail"]) == {"code", "message"}                    # her other stay is not shown
    await _admitted(w, client, "2", at=left, patient=she)


async def test_a_moved_stay_binds_by_its_last_row(ward):
    w, client, _ = ward
    left = _ago(hours=1)
    await _discharged(w, client, "1", admitted_at=_ago(hours=3), discharge_at=left, move_to="3")
    r = await _admit(w, client, "2", at=left - timedelta(minutes=1), patient={"display_name": person("1")})
    assert _refusal(r) == (409, "admitted_before_discharge"), r.text


async def test_another_persons_discharge_binds_nothing(ward):
    w, client, _ = ward
    left = _ago(hours=1)
    await _discharged(w, client, "1", admitted_at=_ago(hours=3), discharge_at=left)
    await _admitted(w, client, "2", at=left - timedelta(minutes=1))           # bed 2's own person


async def test_a_row_without_a_digest_binds_nothing(ward, db_session):
    w, client, _ = ward
    left = _ago(hours=1)
    await _discharged(w, client, "1", admitted_at=_ago(hours=3), discharge_at=left)
    await db_session.execute(update(Admission).values(identity_digest=None)
                             .execution_options(synchronize_session=False))  # as written before 0012
    await db_session.commit()
    await _admitted(w, client, "2", at=left - timedelta(minutes=1), patient={"display_name": person("1")})


# ---------------------------------------------------------------- after the look-up (§3.1)
async def test_a_resend_after_the_six_hours_is_answered_with_its_admission(ward, monkeypatch):
    """The first send, 5 h 59 min back, admitted; its answer was lost. Ten minutes on, the same form is
    answered with that admission (200): the six hours and the bed — OCCUPIED since that send — are read
    after the look-up. Another form under the id is still `request_conflict` (A-19)."""
    w, client, _ = ward
    request_id = uuid.uuid4()
    began = _ago(hours=5, minutes=59)
    first = await _admit(w, client, at=began, request_id=request_id)
    assert first.status_code == 201, first.text
    later = datetime.now(timezone.utc) + timedelta(minutes=10)
    monkeypatch.setattr(admission_router, "_now", lambda: later)
    again = await _admit(w, client, at=began, request_id=request_id)
    assert again.status_code == 200, again.text
    assert again.json()["id"] == first.json()["id"]
    other = await _admit(w, client, at=began, request_id=request_id,
                         note={"admission_diagnosis_free_text": "Sentetik tanı, düzeltilmiş"})
    assert _refusal(other) == (409, "request_conflict"), other.text


async def test_a_non_physician_attending_is_said_before_a_time_seven_hours_back(ward):
    w, client, _ = ward
    r = await _admit(w, client, at=_ago(hours=7), note={"attending_physician_id": str(w.users["nurse"].id)})
    assert _refusal(r) == (422, "field_invalid:attending_physician_id"), r.text


async def test_her_open_admission_is_said_before_her_last_discharge(ward):
    w, client, _ = ward
    left = _ago(hours=1)
    await _discharged(w, client, "1", admitted_at=_ago(hours=3), discharge_at=left)
    she = {"display_name": person("1")}
    await _admitted(w, client, "2", patient=she)                              # open again
    r = await _admit(w, client, "10", at=left - timedelta(minutes=1), patient=she)
    assert _refusal(r) == (409, "duplicate_open_admission"), r.text


async def test_a_closed_bed_is_said_before_its_time(ward, db_session):
    w, client, _ = ward
    ten = w.beds["10"].id
    await _free_since(db_session, _ago(hours=1), ten)
    await db_session.execute(update(Bed).where(Bed.id == ten).values(is_active=False)
                             .execution_options(synchronize_session=False))
    await db_session.commit()
    r = await _admit(w, client, "10", at=_ago(hours=2))
    assert _refusal(r) == (409, "bed_closed"), r.text
```

The audit row's whole payload is compared in two existing tests; it gains the time (no `backdated`: they send none).

In `homunculus-engine/tests/test_admission_api.py`, find (lines 102–103):

```python
                               "protocol_no": body["protocol_no"],
                               "patient_number": body["patient_number"]}
```

Replace with:

```python
                               "protocol_no": body["protocol_no"],
                               "patient_number": body["patient_number"],
                               # G3-07 (D6): the row's time, in UTC; no `backdated` — the form sent none.
                               "admission_datetime": datetime.fromisoformat(body["admission_datetime"]).isoformat()}
```

In `homunculus-engine/tests/test_protocol_admission.py`, find (lines 11–13):

```python
import uuid

import pytest
```

Replace with:

```python
import uuid
from datetime import datetime

import pytest
```

In the same file, find (line 147):

```python
                           "protocol_no": FIRST_PROTOCOL, "patient_number": body["patient_number"]}
```

Replace with:

```python
                           "protocol_no": FIRST_PROTOCOL, "patient_number": body["patient_number"],
                           "admission_datetime": datetime.fromisoformat(body["admission_datetime"]).isoformat()}
```

(Unchanged, checked: `test_reserved_admission.py` reads `bed_was_reserved` by key; `test_care_team_sign_off.py` and `test_protocol_admission.py`'s refusal test check that no `admission.admit` row exists; `test_discharge_api.py` lists event types; `test_admission_trail.py` reads the trail's log line. The dashboard shows no payload.)

- [ ] **Step 2: Run to see them fail** (`kabulz-pg` up)

Run: `cd /c/tmp/g3-kabul-zamani/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:kabulz@127.0.0.1:56452/kabulz_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_admission_time.py 2>&1 | tail -3`
Expected: `7 failed, 7 passed` — the failing seven: `test_an_untouched_form…`, `test_a_time_two_hours_back…` (`KeyError: 'admission_datetime'`), `test_six_hours_less_a_minute…`, `test_a_time_before_the_beds_release…`, `test_a_reserved_bed…`, `test_a_time_before_her_last_discharge…`, `test_a_moved_stay…` (each answered 201 where a refusal is expected). The seven passing ones hold what the route does today (an occupied bed, another person, a row without a digest, a resend, the attending, an open admission, a closed bed).

Run: `cd /c/tmp/g3-kabul-zamani/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:kabulz@127.0.0.1:56452/kabulz_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_admission_api.py tests/test_protocol_admission.py -k "written_numbered or audit_row_is_the_cards" 2>&1 | tail -3`
Expected: `2 failed, 59 deselected`.

- [ ] **Step 3: The route**

In `homunculus-engine/src/homunculus/admission/router.py`, find (lines 72–73):

```python
from homunculus.admission.errors import (
    BED_CLOSED, BED_RESERVED, CARE_TEAM_ATTENDING_REQUIRED, CARE_TEAM_CONFLICT,
```

Replace with:

```python
from homunculus.admission.errors import (
    ADMITTED_BEFORE_BED_FREE, ADMITTED_BEFORE_DISCHARGE,
    BED_CLOSED, BED_RESERVED, CARE_TEAM_ATTENDING_REQUIRED, CARE_TEAM_CONFLICT,
```

In the same file, find (lines 285–290):

```python
        .where(Admission.tenant_id == tenant_id, Admission.identity_digest == identity,
               Admission.state.in_(list(OPEN_ADMISSION_STATES)))
        .limit(1))).first()


def _duplicate(found, reach: Scope) -> Refusal:
```

Replace with:

```python
        .where(Admission.tenant_id == tenant_id, Admission.identity_digest == identity,
               Admission.state.in_(list(OPEN_ADMISSION_STATES)))
        .limit(1))).first()


async def _last_discharge_of(db: AsyncSession, tenant_id: uuid.UUID,
                             identity: str) -> datetime | None:
    """G3-07 (spec D4, §3.1 step 9): the newest discharge time of the person `identity` names
    (`form.identity_digest`) in the tenant — `max(discharge_at)` over her DISCHARGED admissions;
    None when she has none, or none with a time. A moved stay is discharged on its last row, which
    carries the source's digest (G2-B1b T6). A row written before 0012 has no digest and is not
    read. No lock: her previous admission reached DISCHARGED through PENDING_DISCHARGE, whose start
    wrote `discharge_at` (service.py `initiate_discharge`), and an open one is refused before this
    (`duplicate_open_admission`)."""
    return (await db.execute(
        select(func.max(Admission.discharge_at))
        .where(Admission.tenant_id == tenant_id, Admission.identity_digest == identity,
               Admission.state == AdmissionState.DISCHARGED))).scalar_one()


def _duplicate(found, reach: Scope) -> Refusal:
```

In the same file, find (lines 501–503):

```python
    by one bed lock, and the open-identity index stops the second at its flush — the same refusal,
    told apart from the request id's constraint by the index's name."""
    # The admitting unit and the bed belong to the caller's tenant and the attending is a member
```

Replace with:

```python
    by one bed lock, and the open-identity index stops the second at its flush — the same refusal,
    told apart from the request id's constraint by the index's name.

    G3-07 (Kabul zamanı, spec §3.1): the form may say when the stay began (`admission_datetime`);
    sent nothing, the save is stamped, as before. A time sent is checked where the form is (a zone,
    not ahead of the clock), then — after the look-up of an earlier send, so a resend is answered
    whatever the clock and the bed say now — at most six hours back (422, `form.BACKDATE_MAX`), not
    before the bed became free (409 `admitted_before_bed_free`: a bed AVAILABLE or RESERVED, its
    state's own time, read under the bed's lock) and not before this person's last discharge (409
    `admitted_before_discharge`, `_last_discharge_of`). Each before the protocol is issued. The audit
    row names the row's time, and says `backdated` when the form sent one."""
    # The admitting unit and the bed belong to the caller's tenant and the attending is a member
```

In the same file, find (lines 522–523):

```python
    identity = form.identity_digest(payload.patient.display_name, payload.patient.date_of_birth)
    # The caller as plain values: a rollback below expires every object of this session, the
```

Replace with:

```python
    identity = form.identity_digest(payload.patient.display_name, payload.patient.date_of_birth)
    # G3-07: the stay's start as the form said it; None when the form sent none (the save is stamped).
    sent_at = payload.note.admission_datetime
    # The caller as plain values: a rollback below expires every object of this session, the
```

In the same file, find (lines 550–552):

```python
        if named is not None and not await service.is_physician(db, caller_tenant, named):
            raise field_invalid("attending_physician_id", "The attending must be a physician.")
        if identity is not None and \
```

Replace with:

```python
        if named is not None and not await service.is_physician(db, caller_tenant, named):
            raise field_invalid("attending_physician_id", "The attending must be a physician.")
        # G3-07 (spec D2, §3.1 step 5): at most six hours back. After the look-up above, as the
        # attending's check: a resend of a form that was admitted is answered, never refused
        # because the clock moved on.
        form.check_admission_time(sent_at, now=now)
        if identity is not None and \
```

In the same file, find (lines 568–569):

```python
        was_reserved = bed.state == BedState.RESERVED
        # G2-B1d (spec §3, D1, D5): the protocol first, then the H-number — one lock order for
```

Replace with:

```python
        was_reserved = bed.state == BedState.RESERVED
        # G3-07 (spec D3, §3.1 step 8): not before the bed became free — its state's own time,
        # read under the bed's lock (`_bed_of`), so a release or a reservation of it waits for this
        # transaction. Only for a bed AVAILABLE or RESERVED (a reserved one has its confirmation by
        # here); any other is the service's `bed_not_available`, as before. A bed whose state time
        # is not recorded binds nothing.
        if sent_at is not None and bed.state in (BedState.AVAILABLE, BedState.RESERVED) \
                and bed.state_updated_at is not None and sent_at < bed.state_updated_at:
            raise Refusal(409, ADMITTED_BEFORE_BED_FREE,
                          "The admission time is before the bed became free.")
        # G3-07 (spec D4, §3.1 step 9): not before this person's last discharge. After her open
        # admission's refusal above: this one concerns closed stays only.
        if sent_at is not None and identity is not None and \
                (last := await _last_discharge_of(db, caller_tenant, identity)) is not None \
                and sent_at < last:
            raise Refusal(409, ADMITTED_BEFORE_DISCHARGE,
                          "The admission time is before this person's last discharge.")
        # G2-B1d (spec §3, D1, D5): the protocol first, then the H-number — one lock order for
```

In the same file, find (lines 645–648):

```python
                     payload={"admission_id": str(admission_id), "bed_id": str(card["bed_id"]),
                              "unit_id": str(card["unit_id"]), "actor": actor,
                              "protocol_no": protocol_no, "patient_number": number,
                              **({"bed_was_reserved": True} if was_reserved else {})})   # X9
```

Replace with:

```python
                     payload={"admission_id": str(admission_id), "bed_id": str(card["bed_id"]),
                              "unit_id": str(card["unit_id"]), "actor": actor,
                              "protocol_no": protocol_no, "patient_number": number,
                              # G3-07 (D6): when the stay began, always — the row's own, in UTC —
                              # and `backdated` only when the form sent the time.
                              "admission_datetime":
                                  written.admission_datetime.astimezone(timezone.utc).isoformat(),
                              **({"backdated": True} if sent_at is not None else {}),
                              **({"bed_was_reserved": True} if was_reserved else {})})   # X9
```

The stale comment D4 relies on (spec §3.4, O6): since B1b T6 the arriving row carries its source's digest.

In `homunculus-engine/src/homunculus/admission/models.py`, find (lines 344–345):

```python
    # (`OPEN_IDENTITY_INDEX`). NULL on a row written before 0012 or without the form (the service
    # alone, a transfer's arrival) — NULLs never collide, and the refusal does not see them.
```

Replace with:

```python
    # (`OPEN_IDENTITY_INDEX`). A transfer's arriving row carries its source's (G2-B1b T6: the digest
    # is not in service.py `_OWN_TO_EACH_ROW`), so a moved stay's last row — the one discharged —
    # names the person too (G3-07 D4 reads it there). NULL on a row written before 0012 or without
    # the form (the service alone) — NULLs never collide, and neither refusal sees them.
```

- [ ] **Step 4: Run to see them pass**

Run: `cd /c/tmp/g3-kabul-zamani/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:kabulz@127.0.0.1:56452/kabulz_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_admission_time.py 2>&1 | tail -3`
Expected: `14 passed` (30–60 s).

Run: `cd /c/tmp/g3-kabul-zamani/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:kabulz@127.0.0.1:56452/kabulz_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_protocol_admission.py tests/test_reserved_admission.py tests/test_admission_trail.py tests/test_care_team_sign_off.py 2>&1 | tail -3`
Expected: `31 passed` (10 + 7 + 14 for the last two; 50 s on a quiet machine — if this machine is loaded and the call nears 180 s, run the four files as two calls of two).

Run: `cd /c/tmp/g3-kabul-zamani/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:kabulz@127.0.0.1:56452/kabulz_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_admission_api.py 2>&1 | tail -3`
Expected: `50 passed, 1 skipped` (95 s on a quiet machine, 170 s on a loaded one).

Run: `cd /c/tmp/g3-kabul-zamani && git diff --stat -- homunculus-engine/src/homunculus/admission/router.py homunculus-engine/src/homunculus/admission/models.py`
Expected: `router.py | 54` (53 insertions, 1 deletion) and `models.py | 6`.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g3-kabul-zamani && git add -- homunculus-engine/src/homunculus/admission/router.py homunculus-engine/src/homunculus/admission/models.py homunculus-engine/tests/test_admission_time.py homunculus-engine/tests/test_admission_api.py homunculus-engine/tests/test_protocol_admission.py && git commit -m "feat(admission): the kabul's time is bounded after the look-up — six hours, the bed's free time, the person's last discharge — and audited (G3-07 D2–D4, D6)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- homunculus-engine/src/homunculus/admission/router.py homunculus-engine/src/homunculus/admission/models.py homunculus-engine/tests/test_admission_time.py homunculus-engine/tests/test_admission_api.py homunculus-engine/tests/test_protocol_admission.py
```

---

### Task E4: The readers of the stay's start, and a device set end to end (D7, D8, D9, §4, §6)

**Files:**
- Test: `homunculus-engine/tests/test_admission_time.py` — lines 17–30, lines 281–282 (as each step finds the file)
- Test: `homunculus-engine/tests/kabul_world.py` — lines 95–102 (as each step finds the file)

Spec §4: «None of this needs code. Each reader takes the column as it is.» These tests pin it: they pass once E3 is in (and would pass against the route before E3 too, which took any past time — they guard the readers, not the bounds). Departures E-3 and E-4 say how the test builds its world.

- [ ] **Step 1: The ward's app takes the readings store, its policy and a person's credential**

In `homunculus-engine/tests/kabul_world.py`, find (lines 95–102):

```python
def ward_app() -> FastAPI:
    """The app with a device token for the ward's tenant: `BOARD` reads its board."""
    return create_app({DEVICE: SLUG}, run_escalation_loop=False)


@asynccontextmanager
async def ward_client(db: AsyncSession) -> AsyncIterator[tuple[AsyncClient, FastAPI]]:
    app = ward_app()
```

Replace with:

```python
def ward_app(**extra) -> FastAPI:
    """The app with a device token for the ward's tenant: `BOARD` reads its board. `extra` goes to
    `create_app` as it is (G3-07's end-to-end test gives the app a readings store, its policy and a
    person's credential)."""
    return create_app({DEVICE: SLUG}, run_escalation_loop=False, **extra)


@asynccontextmanager
async def ward_client(db: AsyncSession, **extra) -> AsyncIterator[tuple[AsyncClient, FastAPI]]:
    app = ward_app(**extra)
```

- [ ] **Step 2: The tests**

In `homunculus-engine/tests/test_admission_time.py`, find (lines 17–30):

```python
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest_asyncio
from sqlalchemy import func, select, update

from homunculus.admission import router as admission_router
from homunculus.admission.models import Admission
from homunculus.tenant.models import Bed
from tests.conftest import requires_db
from tests.kabul_world import BOARD, FIRST_PROTOCOL, SLUG, build_ward, ward_client
from tests.test_admission_api import form, person
```

Replace with:

```python
from __future__ import annotations

import importlib.util
import uuid
from datetime import datetime, timedelta, timezone

import pytest_asyncio
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from sqlalchemy import func, select, text, update

from homunculus.admission import router as admission_router
from homunculus.admission import transfer
from homunculus.admission.models import Admission
from homunculus.api.audit import AuditEvent, InMemoryAuditLog
from homunculus.api.identity import Caller
from homunculus.api.readings import POLICY_UNMATCHED, reconcile
from homunculus.api.readings_postgres import PostgresReadingStore
from homunculus.api.tasks_postgres import PostgresTaskStore
from homunculus.tenant.models import Bed
from tests.conftest import ENGINE_ROOT, TEST_DATABASE_URL, requires_db
from tests.kabul_world import BOARD, FIRST_PROTOCOL, SLUG, build_ward, ward_client
from tests.test_admission_api import form, person
from tests.test_ingest_apply import obs
```

In the same file, find (lines 281–282):

```python
    r = await _admit(w, client, "10", at=_ago(hours=2))
    assert _refusal(r) == (409, "bed_closed"), r.text
```

Replace with:

```python
    r = await _admit(w, client, "10", at=_ago(hours=2))
    assert _refusal(r) == (409, "bed_closed"), r.text


# ---------------------------------------------------------------- the readers of the start (§4, D7, D8)
async def test_the_stay_start_readers_answer_the_back_dated_time(ward):
    w, client, _ = ward
    began = _ago(hours=2)
    await _admitted(w, client, at=began)
    readings, tasks = PostgresReadingStore(TEST_DATABASE_URL), PostgresTaskStore(TEST_DATABASE_URL)
    try:
        assert readings.stay_start(SLUG, FIRST_PROTOCOL) == began
        assert readings.open_stays(SLUG) == {FIRST_PROTOCOL: began}
        assert readings.open_admissions(SLUG) == {FIRST_PROTOCOL: began}
        assert tasks.admitted_at(SLUG, FIRST_PROTOCOL) == began
    finally:
        readings.close()
        tasks.close()


async def test_after_a_move_the_stay_still_began_at_the_back_dated_time(ward, db_session):
    """D7: the arriving row is the move's record, stamped at the move; every reader of the stay's start
    walks back to the back-dated kabul. `open_admissions` answers the open ROW: the move (T6)."""
    w, client, _ = ward
    began = _ago(hours=2)
    admission = await _admitted(w, client, at=began)
    await _signed(w, client, admission)
    before_move = datetime.now(timezone.utc)
    arriving = await _moved(w, client, admission, "3")
    readings, tasks = PostgresReadingStore(TEST_DATABASE_URL), PostgresTaskStore(TEST_DATABASE_URL)
    try:
        assert readings.stay_start(SLUG, FIRST_PROTOCOL) == began
        assert tasks.admitted_at(SLUG, FIRST_PROTOCOL) == began
        assert readings.open_admissions(SLUG)[FIRST_PROTOCOL] >= before_move
    finally:
        readings.close()
        tasks.close()
    assert await transfer.stay_began(db_session, uuid.UUID(arriving["id"]), tenant_id=w.tenant.id) == began


async def test_a_discharge_between_the_back_dated_start_and_the_save_is_taken(ward):
    w, client, _ = ward
    began = _ago(hours=2)
    admission = await _admitted(w, client, at=began)
    await _signed(w, client, admission)
    left = began + timedelta(minutes=30)
    r = await client.post(f"/admissions/{admission['id']}/discharge/initiate",
                          json={"disposition": "HOME", "discharge_at": left.isoformat()}, headers=w.auth["doctor"])
    assert r.status_code == 200, r.text
    assert datetime.fromisoformat(r.json()["discharge_at"]) == left


def _migration_0021():
    spec = importlib.util.spec_from_file_location(
        "g307_migration_0021", ENGINE_ROOT / "alembic" / "versions" / "0021_vital_readings.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest_asyncio.fixture
async def readings_table(db_session):
    """`vital_readings` as migration 0021 builds it, beside the models' tables `db_session` made (the table
    has no model). The ward's trail is in memory (`app.state.audit`): there is no `audit` table here, so
    the migration's audit index is not built. Dropped before `db_session` drops the rest: its foreign key
    points at `admissions`. The test's session ends its transaction first — a read of the table holds a
    lock the DROP would wait for, for ever."""
    migration = _migration_0021()
    migration._CREATE_AUDIT_INDEX = "SELECT 1"

    def build(conn) -> None:
        with Operations.context(MigrationContext.configure(conn)):
            migration.upgrade()

    async with db_session.bind.begin() as conn:
        await conn.run_sync(build)
    yield
    await db_session.rollback()
    async with db_session.bind.begin() as conn:
        await conn.exec_driver_sql("DROP TABLE IF EXISTS vital_readings")


async def test_reconcile_stamps_a_reading_measured_in_the_back_dated_window(ward, readings_table, db_session):
    w, client, _ = ward
    began = _ago(hours=2)
    admission = await _admitted(w, client, at=began)
    audit = InMemoryAuditLog()
    for when in (began - timedelta(minutes=30), began + timedelta(minutes=30)):
        audit.append(AuditEvent(SLUG, "ingest", FIRST_PROTOCOL, "spo2",
                                {"value": 96.0, "unit": "%", "obs_ts": when.isoformat(), "device": "CONNEX-3A"}))
    store = PostgresReadingStore(TEST_DATABASE_URL)
    try:
        assert reconcile(store, audit, tenant=SLUG, now=datetime.now(timezone.utc))["recorded"] == 2
    finally:
        store.close()
    rows = (await db_session.execute(text(
        "SELECT observed_at, CAST(admission_id AS text) FROM vital_readings ORDER BY observed_at"))).all()
    assert [tuple(row) for row in rows] == [(began - timedelta(minutes=30), None),
                                           (began + timedelta(minutes=30), admission["id"])]


# ---------------------------------------------------------------- end to end (G3-05's link, §4.1)
#: The number a round was typed under before the patient's protocol existed: nobody holds it (G3-05).
TYPO = "202600000010"
#: The end-to-end test's one person, a nurse who may chart — the unmatched list's right (G3-05 D10).
PERSON = {"Authorization": "Bearer kabulz-hem-jwt"}
CHART = frozenset({"board.view", "clinical.chart"})


async def _person(credential: str) -> Caller | None:
    if credential == PERSON["Authorization"].removeprefix("Bearer "):
        return Caller(hospital=SLUG, actor="hem.sentetik", groups=("nurse",), perms=CHART)
    return None


@pytest_asyncio.fixture
async def readings_world(db_session, readings_table, monkeypatch):
    """The ward's app as the hospital runs it for device readings: the Postgres readings store on the same
    database, a number nobody holds listed (`unmatched`), and a nurse who may link a set."""
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    built = await build_ward(db_session)
    await _free_since(db_session, _ago(days=1))
    store = PostgresReadingStore(TEST_DATABASE_URL)
    try:
        async with ward_client(db_session, readings=store, unknown_readings=POLICY_UNMATCHED,
                               resolve_jwt=_person) as (client, app):
            yield built, client, app
    finally:
        store.close()


async def _listed(client, when: datetime) -> list[int]:
    """The ids of the waiting set under TYPO measured at `when`."""
    r = await client.get("/readings/unmatched", headers=PERSON)
    assert r.status_code == 200, r.text
    return [x["id"] for s in r.json()["sets"]
            if s["received_key"] == TYPO and datetime.fromisoformat(s["observed_at"]) == when
            for x in s["readings"]]


async def _link(client, ids: list[int]):
    return await client.post("/readings/unmatched/assign", json={"readings": ids, "patient_id": FIRST_PROTOCOL},
                             headers=PERSON)


async def test_a_set_measured_before_the_save_links_to_a_back_dated_stay(readings_world, db_session):
    """Two rounds typed under a number nobody holds: A an hour before the kabul is saved, B seven hours
    before. The kabul says the stay began two hours before the save: A is hers — linked, filed with the
    admission at its own time — and B, measured before the stay, is refused `reading_before_stay`."""
    w, client, _ = readings_world
    a_at, b_at = _ago(hours=1), _ago(hours=7)
    for when in (a_at, b_at):
        r = await client.post("/ingest", json=obs("heart_rate", 88, TYPO, when), headers=BOARD)
        assert r.json() == {"patient_id": TYPO, "dropped": "unmatched"}, r.text
    admission = await _admitted(w, client, at=_ago(hours=2))
    a_ids, b_ids = await _listed(client, a_at), await _listed(client, b_at)
    assert len(a_ids) == len(b_ids) == 1
    r = await _link(client, a_ids)
    assert r.status_code == 200, r.text
    row = (await db_session.execute(text(
        "SELECT state, patient_key, CAST(admission_id AS text), observed_at FROM vital_readings WHERE id = :id"),
        {"id": a_ids[0]})).one()
    assert tuple(row) == ("assigned", FIRST_PROTOCOL, admission["id"], a_at)
    r = await _link(client, b_ids)
    assert _refusal(r) == (409, "reading_before_stay"), r.text


async def test_the_same_set_against_an_untouched_kabul_is_refused(readings_world):
    """The control: saved with no time, the stay begins at the save, and the round an hour before it is
    not hers — G3-05's guard, as before this slice."""
    w, client, _ = readings_world
    a_at = _ago(hours=1)
    r = await client.post("/ingest", json=obs("heart_rate", 88, TYPO, a_at), headers=BOARD)
    assert r.json() == {"patient_id": TYPO, "dropped": "unmatched"}, r.text
    await _admitted(w, client)
    r = await _link(client, await _listed(client, a_at))
    assert _refusal(r) == (409, "reading_before_stay"), r.text
```

- [ ] **Step 3: Run them**

Run: `cd /c/tmp/g3-kabul-zamani/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:kabulz@127.0.0.1:56452/kabulz_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_admission_time.py 2>&1 | tail -3`
Expected: `20 passed` (about 45 s). **If it hangs** past a minute: a session «idle in transaction» on `vital_readings` holds the DROP of the fixture's teardown — `docker exec kabulz-pg psql -U postgres -d kabulz_test -Atc "select pid, state, left(query, 80) from pg_stat_activity where datname = 'kabulz_test'" </dev/null` shows it; that is what the `await db_session.rollback()` in `readings_table` is for. Stop and report.

Run: `cd /c/tmp/g3-kabul-zamani/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:kabulz@127.0.0.1:56452/kabulz_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_protocol_admission.py tests/test_reserved_admission.py 2>&1 | tail -3`
Expected: `17 passed` — `kabul_world`'s other callers are unchanged.

Run: `cd /c/tmp/g3-kabul-zamani/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_admission_time.py 2>&1 | tail -3`
Expected: `20 skipped` — without a database the file is skipped, never an error.

- [ ] **Step 4: Commit**

```bash
cd /c/tmp/g3-kabul-zamani && git add -- homunculus-engine/tests/test_admission_time.py homunculus-engine/tests/kabul_world.py && git commit -m "test(admission): the stay's start readers, reconcile and G3-05's link follow a back-dated kabul (G3-07 D7–D9, §4)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- homunculus-engine/tests/test_admission_time.py homunculus-engine/tests/kabul_world.py
```

When this is the last DB task you run: `docker stop kabulz-pg`.

---

## Dashboard

### Task W1: The structure index keeps each bed's `state_since` (spec §5)

**Files:**
- Test: `dashboard/src/live/data/structure.test.js` — lines 43–46 (as each step finds the file)
- Test: `dashboard/src/live/screens/kabul/kabul.testutil.js` — line 35 (as each step finds the file)
- Modify: `dashboard/src/live/data/structure.js` — lines 20–22, line 38 (as each step finds the file)

The engine sends `state_since` on every bed (`tenant/router.py` 461); the index drops it today. It is kept as the server wrote it — microseconds and all — because the form sends it back as it is (W2).

- [ ] **Step 1: Write the failing test**

In `dashboard/src/live/data/structure.test.js`, find (lines 43–46):

```js
  it("is empty for an answer that is not a tree", () => {
    for (const answer of [null, undefined, {}, { sites: "x" }]) expect(indexStructure(answer).beds.size).toBe(0);
  });
});
```

Replace with:

```js
  it("is empty for an answer that is not a tree", () => {
    for (const answer of [null, undefined, {}, { sites: "x" }]) expect(indexStructure(answer).beds.size).toBe(0);
  });

  // G3-07: the admission form bounds «Kabul zamanı» by the bed's free time and sends it back as written.
  it("keeps each bed's state time as the server wrote it, never parsed and rebuilt", () => {
    const written = "2026-11-12T07:30:40.123456Z";
    const tree = structure();
    tree.sites[0].units[0].rooms[0].beds[0].state_since = written;
    const beds = indexStructure(tree).beds;
    expect(beds.get(BED(1)).stateSince).toBe(written);
    expect(beds.get(BED(5)).stateSince).toBeNull();
    expect(indexStructure({ sites: [{ units: [{ id: REA, rooms: [{ id: "r", beds: [{ id: BED(9), label: "9" }] }] }] }] })
      .beds.get(BED(9)).stateSince).toBeNull();                      // an answer without the key
  });
});
```

In `dashboard/src/live/screens/kabul/kabul.testutil.js`, find (line 35):

```js
const bed = (n, label, state = "AVAILABLE", is_active = true) => ({ id: BED(n), label, state, is_active });
```

Replace with:

```js
/** A bed as GET /tenant/structure answers it; `state_since` is when it entered its state (the server's
 *  string — microseconds and all — or null, as the engine sends for a bed with no recorded time). */
const bed = (n, label, state = "AVAILABLE", is_active = true, state_since = null) =>
  ({ id: BED(n), label, state, is_active, state_since });
```

- [ ] **Step 2: Run to see it fail**

Run: `cd /c/tmp/g3-kabul-zamani/dashboard && npx vitest run src/live/data/structure.test.js 2>&1 | tail -5`
Expected: `Tests  1 failed | 27 passed (28)` — `expected undefined to be '2026-11-12T07:30:40.123456Z'`.

- [ ] **Step 3: Keep it**

In `dashboard/src/live/data/structure.js`, find (lines 20–22):

```js
 *    beds:  Map(id -> {id, label, state, isActive, roomId, roomName, unitId, unitName, open}) }.
 *  `open`: the bed, its room and its unit are all open — only an open, AVAILABLE bed is offered to
 *  an admission. An answer that is not a tree is an empty index. */
```

Replace with:

```js
 *    beds:  Map(id -> {id, label, state, stateSince, isActive, roomId, roomName, unitId, unitName, open}) }.
 *  `open`: the bed, its room and its unit are all open — only an open, AVAILABLE bed is offered to
 *  an admission. `stateSince` (G3-07): when the bed entered its state — the server's string as it
 *  wrote it, never parsed and rebuilt (the admission form sends it back as it is); null when the
 *  answer has none. An answer that is not a tree is an empty index. */
```

In the same file, find (line 38):

```js
            id: bed.id, label: bed.label, state: bed.state, isActive: bed.is_active !== false,
```

Replace with:

```js
            id: bed.id, label: bed.label, state: bed.state, stateSince: bed.state_since ?? null,
            isActive: bed.is_active !== false,
```

- [ ] **Step 4: Run to see it pass, with every reader of the structure**

Run: `cd /c/tmp/g3-kabul-zamani/dashboard && npx vitest run src/live/data src/live/screens/kabul src/live/screens/doluluk 2>&1 | tail -5`
Expected: `Test Files  26 passed (26)`, `Tests  643 passed (643)` — `structure.test.js` 28.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g3-kabul-zamani && git add -- dashboard/src/live/data/structure.js dashboard/src/live/data/structure.test.js dashboard/src/live/screens/kabul/kabul.testutil.js && git commit -m "feat(dashboard): the structure index keeps each bed's state_since as written (G3-07 §5)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- dashboard/src/live/data/structure.js dashboard/src/live/data/structure.test.js dashboard/src/live/screens/kabul/kabul.testutil.js
```

---

### Task W2: The form's rules for «Kabul zamanı» — bounds, the string sent, what is missing (D1, §5)

**Files:**
- Test: `dashboard/src/live/screens/kabul/admitForm.test.js` — line 7, lines 156–159 (as each step finds the file)
- Modify: `dashboard/src/live/screens/kabul/admitForm.js` — lines 7–9, lines 55–57, lines 143–153, lines 177–179, lines 193–194 (as each step finds the file)
- Modify: `dashboard/src/live/i18n/strings/kabul.js` — the `miss` block of each language (as each step finds the file)

Pure functions; no React. `missing` names the field only once it is touched; `toBody` sends a time only then, the same string on every send of the form (the A-19 digest holds). The minute that holds the bed's free time sends that time as the server wrote it — `DischargeDialog`'s A-34 I-1 rule: the minute's start would fall before the microseconds the server keeps, and be refused. The words of the panel's line come with it (the raw-key sweep, `rawKeys.test.jsx`, holds every key a source names to the four dictionaries).

- [ ] **Step 1: Write the failing tests**

In `dashboard/src/live/screens/kabul/admitForm.test.js`, find (line 7):

```js
import { COMORBIDITIES, CONSENTS, ageOf, emptyForm, missing, positive, toBody } from "./admitForm.js";
```

Replace with:

```js
import {
  BACKDATE_MS, COMORBIDITIES, CONSENTS, admittedAtOf, admittedBounds, ageOf, emptyForm, missing, positive, toBody,
} from "./admitForm.js";
import { localInput } from "./DischargeDialog.jsx";
```

In the same file, find (lines 156–159):

```js
    const server = /COMORBIDITY_CODES = \(([^)]*)\)/.exec(form)[1].match(/"(\w+)"/g).map((s) => s.slice(1, -1));
    for (const { value } of COMORBIDITIES) expect(server, value).toContain(value);
  });
});
```

Replace with:

```js
    const server = /COMORBIDITY_CODES = \(([^)]*)\)/.exec(form)[1].match(/"(\w+)"/g).map((s) => s.slice(1, -1));
    for (const { value } of COMORBIDITIES) expect(server, value).toContain(value);
  });
});

// G3-07 «Kabul zamanı» (spec D1, §5): untouched, nothing is sent; touched, the minute in ISO UTC — the same
// string on every send — bounded by six hours, the bed's free time and the clock.
describe("«Kabul zamanı»", () => {
  // The clock (the server's, as the screen holds it) at 14:00:30 local, so the bounds are minutes one can name.
  const NOW = new Date(2026, 10, 12, 14, 0, 30).getTime();
  const at = (h, m) => localInput(new Date(2026, 10, 12, h, m).getTime());
  /** Bed free since 11:30:40.123456 — the server's string, microseconds and all (Date.parse keeps milliseconds). */
  const FREE = new Date(2026, 10, 12, 11, 30, 40, 123).toISOString().replace(/Z$/, "456Z");
  const touched = (text) => ({ ...complete(), admittedAt: text, admittedAtTouched: true });
  const missingAt = (form, freeSince = null) => missing(form, TODAY, { now: NOW, freeSince }).map((m) => m.field);

  it("starts untouched and empty, so «Yeni qəbul» clears it", () => {
    expect(emptyForm()).toMatchObject({ admittedAt: "", admittedAtTouched: false });
  });

  it("reaches back as far as the server's BACKDATE_MAX (admission/form.py)", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const form = fs.readFileSync(path.resolve(here, "../../../../../homunculus-engine/src/homunculus/admission/form.py"), "utf8");
    const hours = Number(/^BACKDATE_MAX = timedelta\(hours=(\d+)\)/m.exec(form)[1]);
    expect(BACKDATE_MS).toBe(hours * 3_600_000);
    expect(hours).toBe(6);
  });

  it("is bounded a minute inside six hours, rounded up — or by the bed's minute when later — and a minute ahead", () => {
    const sixHours = new Date(2026, 10, 12, 8, 2).getTime();             // 14:00:30 − 6 h + 1 min = 08:01:30, up
    expect(admittedBounds(NOW, null)).toEqual({ minMs: sixHours, maxMs: NOW + 60_000 });
    expect(admittedBounds(NOW, FREE).minMs).toBe(new Date(2026, 10, 12, 11, 30).getTime());
    expect(admittedBounds(NOW, new Date(2026, 10, 11, 23, 0).toISOString()).minMs).toBe(sixHours);
    expect(admittedBounds(NOW, "not a time").minMs).toBe(sixHours);
  });

  it("sends nothing untouched: the note holds no time, whatever the bed", () => {
    expect("admission_datetime" in toBody(complete()).note).toBe(false);
    expect("admission_datetime" in toBody(complete(), null, { freeSince: FREE }).note).toBe(false);
    expect(admittedAtOf({ ...complete(), admittedAt: at(12, 0) }, FREE)).toBeNull();
  });

  it("sends a touched minute as its start in ISO UTC, the same string on every send", () => {
    const form = touched(at(12, 15));
    const first = toBody(form, "11111111-1111-4111-8111-111111111111", { freeSince: FREE }).note.admission_datetime;
    expect(first).toBe(new Date(2026, 10, 12, 12, 15).toISOString());
    expect(toBody(form, "11111111-1111-4111-8111-111111111111", { freeSince: FREE }).note.admission_datetime).toBe(first);
  });

  it("sends the bed's free time as the server wrote it for the minute that holds it", () => {
    expect(admittedAtOf(touched(at(11, 30)), FREE)).toBe(FREE);
    expect(toBody(touched(at(11, 30)), null, { freeSince: FREE }).note.admission_datetime).toBe(FREE);
    expect(admittedAtOf(touched(at(11, 31)), FREE)).toBe(new Date(2026, 10, 12, 11, 31).toISOString());
  });

  it("names the field past either bound, ahead of the clock or unreadable — and never untouched", () => {
    expect(missingAt(touched(at(8, 2)))).toEqual([]);
    expect(missingAt(touched(at(8, 1)))).toEqual(["admittedAt"]);
    expect(missingAt(touched(at(14, 1)))).toEqual([]);
    expect(missingAt(touched(at(14, 2)))).toEqual(["admittedAt"]);
    expect(missingAt(touched(at(11, 30)), FREE)).toEqual([]);
    expect(missingAt(touched(at(11, 29)), FREE)).toEqual(["admittedAt"]);
    expect(missingAt(touched(""))).toEqual(["admittedAt"]);
    expect(missingAt(touched("2026-02-30T10:00"))).toEqual(["admittedAt"]);
    expect(missingAt({ ...complete(), admittedAt: at(1, 0) })).toEqual([]);
    expect(missing(touched(at(8, 1)), TODAY, { now: NOW })).toEqual([{ field: "admittedAt", key: "kabul.miss.admittedAt" }]);
    // In the form's order: after the identity, first in the «Kabul» box.
    expect(missing({ ...touched(at(8, 1)), fin: "5AB12C", type: "" }, TODAY, { now: NOW }).map((m) => m.field))
      .toEqual(["fin", "admittedAt", "type"]);
  });
});
```

(The existing test «carries the form as the API names it…» compares the untouched form's whole `body.note` with `toEqual` and stays as it is: no `admission_datetime` key.)

- [ ] **Step 2: Run to see them fail**

Run: `cd /c/tmp/g3-kabul-zamani/dashboard && npx vitest run src/live/screens/kabul/admitForm.test.js 2>&1 | tail -6`
Expected: `Tests  7 failed | 16 passed (23)` — the seven new tests (`admittedBounds is not a function`, `admittedAtOf is not a function`, …; vite gives a missing named export as `undefined`, so the file still loads).

- [ ] **Step 3: The rules**

In `dashboard/src/live/screens/kabul/admitForm.js`, find (lines 7–9):

```js
// clinical bound: a weight the engine will not chart is the server's refusal, said on the toast.

// Every choice with the key of its words, written out: a key assembled at run time is one no
```

Replace with:

```js
// clinical bound: a weight the engine will not chart is the server's refusal, said on the toast.
//
// G3-07 «Kabul zamanı» (spec D1, §5): when the stay began. Untouched, nothing is sent and the server
// stamps the save, as before; touched, the chosen minute goes out as ISO UTC — the same string on
// every send of the form (`admittedAtOf`), so a resend is the same form to the server (A-19). The
// bounds mirror the server's (admission/form.py BACKDATE_MAX, router.py's bed bound), the browser the
// stricter one; the person's last discharge is the server's alone to know.
import { fromLocalInput } from "./DischargeDialog.jsx";

// Every choice with the key of its words, written out: a key assembled at run time is one no
```

In the same file, find (lines 55–57):

```js
    consent: "", sms: false, bedId: null, unitId: null, bedLabel: null,
  };
}
```

Replace with:

```js
    consent: "", sms: false, bedId: null, unitId: null, bedLabel: null,
    // G3-07: «Kabul zamanı» as typed (a datetime-local text), and whether the nurse touched it.
    admittedAt: "", admittedAtTouched: false,
  };
}

/** G3-07 (spec D2): how far back «Kabul zamanı» reaches — the server's `BACKDATE_MAX` (6 h). */
export const BACKDATE_MS = 6 * 60 * 60 * 1000;
/** A minute of skew between this browser's clock and the server's: not «ahead» on the future side, and
 *  kept inside the six hours on the past side, so the browser is the stricter one (the bedside form's). */
export const SKEW_MS = 60_000;
const MINUTE_MS = 60_000;

/** The first and the last instant «Kabul zamanı» takes at `nowMs` (the server-corrected clock), for a bed
 *  free since `freeSince` (the structure's `state_since`, the server's string; null when unknown):
 *  `{ minMs, maxMs }`, each on a whole minute or the edge itself. The six-hour side is a minute inside the
 *  server's and rounded UP to a whole minute (vitalsFields.oldestInput's rule); the bed side is the start
 *  of the minute that holds `freeSince` — that minute sends `freeSince` itself (`admittedAtOf`). */
export function admittedBounds(nowMs, freeSince) {
  const sixHours = Math.ceil((nowMs - BACKDATE_MS + SKEW_MS) / MINUTE_MS) * MINUTE_MS;
  const freeMs = Date.parse(freeSince ?? "");
  const bedMinute = Number.isFinite(freeMs) ? Math.floor(freeMs / MINUTE_MS) * MINUTE_MS : -Infinity;
  return { minMs: Math.max(sixHours, bedMinute), maxMs: nowMs + SKEW_MS };
}

/** The string «Kabul zamanı» goes out as, or null: untouched (the server stamps the save), or a text that
 *  is not a time (`missing` names it). The minute that holds the bed's `freeSince` sends `freeSince` as the
 *  server wrote it — the minute's start would fall before the microseconds the server keeps
 *  (DischargeDialog's A-34 I-1 rule). Any other minute goes out as its start, in ISO UTC. The same text and
 *  the same bed give the same string on every send. */
export function admittedAtOf(form, freeSince) {
  if (!form.admittedAtTouched) return null;
  const ms = fromLocalInput(form.admittedAt);
  if (!Number.isFinite(ms)) return null;
  const freeMs = Date.parse(freeSince ?? "");
  if (Number.isFinite(freeMs) && ms <= freeMs && freeMs < ms + MINUTE_MS) return freeSince;
  return new Date(ms).toISOString();
}
```

In the same file, find (lines 143–153):

```js
/** Each field the form still lacks or holds wrong, in the form's order: [{field, key}] — `key` is
 *  the panel's sentence for it. Empty when "Kabul et" may be pressed. */
export function missing(form, today) {
  const out = [];
  const add = (field, key) => out.push({ field, key });
  if (blank(form.name)) add("name", "kabul.miss.name");
  if (!form.sex) add("sex", "kabul.miss.sex");
  if (blank(form.dob)) add("dob", "kabul.miss.dob");
  else if (!ageOf(form.dob, today)) add("dob", "kabul.miss.dobWrong");     // not a date, future, before 1900
  if (!blank(form.fin) && !FIN.test(form.fin.trim())) add("fin", "kabul.miss.fin");
  if (!form.type) add("type", "kabul.miss.type");
```

Replace with:

```js
/** Each field the form still lacks or holds wrong, in the form's order: [{field, key}] — `key` is
 *  the panel's sentence for it. Empty when "Kabul et" may be pressed. `now` (ms, the server-corrected
 *  clock) and `freeSince` (the chosen bed's `state_since`) bound «Kabul zamanı» (G3-07). */
export function missing(form, today, { now = Date.now(), freeSince = null } = {}) {
  const out = [];
  const add = (field, key) => out.push({ field, key });
  if (blank(form.name)) add("name", "kabul.miss.name");
  if (!form.sex) add("sex", "kabul.miss.sex");
  if (blank(form.dob)) add("dob", "kabul.miss.dob");
  else if (!ageOf(form.dob, today)) add("dob", "kabul.miss.dobWrong");     // not a date, future, before 1900
  if (!blank(form.fin) && !FIN.test(form.fin.trim())) add("fin", "kabul.miss.fin");
  if (form.admittedAtTouched) {
    // G3-07: touched, it must be a time, at most six hours back, not before the bed was free, not ahead.
    const ms = fromLocalInput(form.admittedAt);
    const { minMs, maxMs } = admittedBounds(now, freeSince);
    if (!Number.isFinite(ms) || ms < minMs || ms > maxMs) add("admittedAt", "kabul.miss.admittedAt");
  }
  if (!form.type) add("type", "kabul.miss.type");
```

In the same file, find (lines 177–179):

```js
 *  digest on the server, so the send before her answer and the one after are one form. */
export function toBody(form, requestId, { confirmReserved = false } = {}) {
  return {
```

Replace with:

```js
 *  digest on the server, so the send before her answer and the one after are one form. `freeSince`
 *  (G3-07): the chosen bed's `state_since`, which `admittedAtOf` may send as it is; `note` carries
 *  `admission_datetime` only when the nurse set «Kabul zamanı». */
export function toBody(form, requestId, { confirmReserved = false, freeSince = null } = {}) {
  const admittedAt = admittedAtOf(form, freeSince);
  return {
```

In the same file, find (lines 193–194):

```js
    note: {
      admitting_unit_id: form.unitId, bed_id: form.bedId, admission_type: form.type,
```

Replace with:

```js
    note: {
      ...(admittedAt === null ? null : { admission_datetime: admittedAt }),
      admitting_unit_id: form.unitId, bed_id: form.bedId, admission_type: form.type,
```

The panel's line, in four languages.

In `dashboard/src/live/i18n/strings/kabul.js`, find (lines 55–56):

```js
      allergy: "Alerji ya da «bilinen alerjisi yok» — ikisinden biri", consent: "Onam", bed: "Yatak",
    },
```

Replace with:

```js
      allergy: "Alerji ya da «bilinen alerjisi yok» — ikisinden biri", consent: "Onam", bed: "Yatak",
      admittedAt: "Kabul zamanı: en çok 6 saat geriye, yatağın boşaldığı andan önce ve ileri bir saat olamaz.",
    },
```

In the same file, find (lines 261–262):

```js
      allergy: "Allergiya və ya «məlum allergiyası yoxdur» — ikisindən biri", consent: "Razılıq", bed: "Çarpayı",
    },
```

Replace with:

```js
      allergy: "Allergiya və ya «məlum allergiyası yoxdur» — ikisindən biri", consent: "Razılıq", bed: "Çarpayı",
      admittedAt: "Qəbul vaxtı: ən çox 6 saat geriyə, çarpayının boşaldığı andan əvvəl və irəli vaxt ola bilməz.",
    },
```

In the same file, find (lines 452–453):

```js
      allergy: "Аллергия или «известной аллергии нет» — одно из двух", consent: "Согласие", bed: "Койка",
    },
```

Replace with:

```js
      allergy: "Аллергия или «известной аллергии нет» — одно из двух", consent: "Согласие", bed: "Койка",
      admittedAt: "Время приёма: не более 6 часов назад, не раньше освобождения койки и не в будущем.",
    },
```

In the same file, find (lines 643–644):

```js
      allergy: "An allergy, or «no known allergy» — one of the two", consent: "Consent", bed: "Bed",
    },
```

Replace with:

```js
      allergy: "An allergy, or «no known allergy» — one of the two", consent: "Consent", bed: "Bed",
      admittedAt: "Admission time: at most 6 hours back, not before the bed became free, and not ahead.",
    },
```

- [ ] **Step 4: Run to see them pass**

Run: `cd /c/tmp/g3-kabul-zamani/dashboard && npx vitest run src/live/screens/kabul src/live/apiErrors.test.js src/live/i18n/strings.test.js 2>&1 | tail -5`
Expected: `Test Files  16 passed (16)`, `Tests  707 passed (707)` — `admitForm.test.js` 23 (16 + 7).

The bedside page's picker (`screens/bedside/PickSteps.jsx`) imports `ageOf` from this module, and the raw-key sweep holds the panel's new key to the four dictionaries:

Run: `cd /c/tmp/g3-kabul-zamani/dashboard && npx vitest run src/live/rawKeys.test.jsx src/live/screens/bedside 2>&1 | tail -5`
Expected: `Test Files  6 passed (6)`, `Tests  142 passed (142)` (about 30 s).

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g3-kabul-zamani && git add -- dashboard/src/live/screens/kabul/admitForm.js dashboard/src/live/screens/kabul/admitForm.test.js dashboard/src/live/i18n/strings/kabul.js && git commit -m "feat(dashboard): the admission form's rules for «Kabul zamanı» — bounds, the string sent, the panel's line (G3-07 D1, §5)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- dashboard/src/live/screens/kabul/admitForm.js dashboard/src/live/screens/kabul/admitForm.test.js dashboard/src/live/i18n/strings/kabul.js
```

---

### Task W3: «Kabul zamanı» on the Kabul tab — the field, its bounds, the send, the three refusals (D1, §5)

**Files:**
- Test: `dashboard/src/live/screens/kabul/AdmitTab.test.jsx` — line 22, lines 1579–1581 (as each step finds the file)
- Modify: `dashboard/src/live/screens/kabul/AdmitTab.jsx` — lines 60–61, lines 77–85, lines 103–104, lines 247–248, lines 310–312, lines 442–447, line 513, lines 589–590 (as each step finds the file)
- Modify: `dashboard/src/live/i18n/strings/kabul.js` — the `f` block, the hints and the `invalid` block of each language (as each step finds the file)

The field comes first in the «Kabul» box. Its clock is `useBoardNow` — the Kabul screen sits under the shell's `BoardProvider` («Interfaces») — re-read every 30 s, as the bedside form judges its time by the server's clock. The tests pin `Date` only (`vi.useFakeTimers({ toFake: ["Date"] })`, `DischargeTab.test.jsx`'s recipe): the screen's own timers run as ever.

- [ ] **Step 1: Write the failing tests**

In `dashboard/src/live/screens/kabul/AdmitTab.test.jsx`, find (line 22):

```js
import { KabulScreen } from "./KabulScreen.jsx";
```

Replace with:

```js
import { KabulScreen } from "./KabulScreen.jsx";
import { localInput } from "./DischargeDialog.jsx";
```

In the same file, find (lines 1579–1581):

```js
    expect(api.admit.mock.calls[0][0]).toMatchObject({ note: { bed_id: BED(5) }, confirm_reserved: true });
  });
});
```

Replace with:

```js
    expect(api.admit.mock.calls[0][0]).toMatchObject({ note: { bed_id: BED(5) }, confirm_reserved: true });
  });
});

// G3-07 «Kabul zamanı» (spec D1, §5): first in the «Kabul» box; untouched it shows the current minute and sends
// nothing; touched, the chosen minute — the same string on every send of the form — bounded by six hours, the
// chosen bed's free time and the clock. Its three refusals are said, the beds read again, the field focused.
describe("AdmitTab · «Kabul zamanı» (G3-07)", () => {
  // The clock pinned at 14:00:30 local (Date only: the screen's own timers run as ever).
  const NOW = new Date(2026, 10, 12, 14, 0, 30).getTime();
  const at = (h, m) => localInput(new Date(2026, 10, 12, h, m).getTime());
  /** Bed 1 free since 11:30:40.123456 — the server's string, microseconds and all. */
  const FREE = new Date(2026, 10, 12, 11, 30, 40, 123).toISOString().replace(/Z$/, "456Z");
  const field = () => screen.getByLabelText(/^Qəbul vaxtı/);
  const choose = (text) => fireEvent.change(field(), { target: { value: text } });
  const sentAt = (api, call = 0) => api.admit.mock.calls[call][0].note.admission_datetime;
  const TOO_FAR = "Qəbul vaxtı: ən çox 6 saat geriyə, çarpayının boşaldığı andan əvvəl və irəli vaxt ola bilməz.";

  async function open(setup) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    return mountKabul(<AdmitTab />, { perms: NURSE, setup: (a) => {
      a.structure.mockResolvedValue(withBed(1, { state_since: FREE }));
      setup?.(a);
    } });
  }
  afterEach(() => { vi.useRealTimers(); });

  it("shows the current minute, bounded by six hours and the clock; a chosen bed moves the bound to its free time and says it", async () => {
    await open();
    expect(field().getAttribute("type")).toBe("datetime-local");
    expect(field().value).toBe(at(14, 0));
    expect(field().getAttribute("min")).toBe(at(8, 2));                      // a minute inside six hours, rounded up
    expect(field().getAttribute("max")).toBe(at(14, 1));
    expect(screen.getByText("Dəyişdirilməsə, qeydin anı yazılır. Ən çox 6 saat geriyə.")).toBeTruthy();
    fillRequired();                                                           // bed 1
    expect(field().getAttribute("min")).toBe(at(11, 30));
    expect(screen.getByText(/Çarpayı 11:30-dən boşdur: qəbul vaxtı bundan əvvəl ola bilməz\./)).toBeTruthy();
    expect(missingNow()).toEqual([]);
  });

  it("sends no time untouched, and the chosen minute in ISO UTC once touched", async () => {
    const { api } = await open((a) => a.admit.mockResolvedValue(admitted()));
    fillRequired();
    await press();
    expect("admission_datetime" in api.admit.mock.calls[0][0].note).toBe(false);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yeni qəbul" })); });
    fillRequired();
    choose(at(12, 15));
    await press();
    expect(sentAt(api, 1)).toBe(new Date(2026, 10, 12, 12, 15).toISOString());
  });

  it("sends the bed's free time as the server wrote it for the minute that holds it", async () => {
    const { api } = await open((a) => a.admit.mockResolvedValue(admitted()));
    fillRequired();
    choose(at(11, 30));
    await press();
    expect(sentAt(api)).toBe(FREE);
  });

  it("resends a send that got no answer under the same id with the same time", async () => {
    const { api } = await open((a) => a.admit.mockRejectedValueOnce(timedOut()).mockResolvedValueOnce(admitted()));
    fillRequired();
    choose(at(11, 30));
    await press();                                                           // no answer; bed 1 still free
    await press();
    const [first, second] = api.admit.mock.calls.map(([body]) => body);
    expect(second.request_id).toBe(first.request_id);
    expect(second.note.admission_datetime).toBe(first.note.admission_datetime);
    expect(first.note.admission_datetime).toBe(FREE);
    expect(screen.getByText("H2600042")).toBeTruthy();
  });

  it("holds «Qəbul et» on a time outside its bounds, names it, and takes the focus there", async () => {
    const { api } = await open();
    fillRequired();
    for (const text of [at(8, 1), at(11, 29), at(14, 2)]) {
      choose(text);
      expect(missingNow()).toEqual([TOO_FAR]);
    }
    await press();
    expect(api.admit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(field());
    expect(errorOf(field())).toBe(TOO_FAR);
  });

  it("keeps the chosen minute in the session's draft, and «Yeni qəbul» clears it", async () => {
    const { store } = await open((a) => a.admit.mockResolvedValue(admitted()));
    fillRequired();
    choose(at(12, 15));
    expect(admitDraftOf(store).get().form).toMatchObject({ admittedAt: at(12, 15), admittedAtTouched: true });
    await press();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yeni qəbul" })); });
    expect(admitDraftOf(store).get().form).toMatchObject({ admittedAt: "", admittedAtTouched: false });
    expect(field().value).toBe(at(14, 0));
  });

  it.each([
    ["field_invalid:admission_datetime", 422, "Qəbul vaxtı düzgün deyil (gələcəkdə və ya 6 saatdan köhnə ola bilməz)."],
    ["admitted_before_bed_free", 409, "Qəbul vaxtı çarpayının boşaldığı andan əvvəl ola bilməz."],
    ["admitted_before_discharge", 409, "Qəbul vaxtı bu xəstənin son evə yazılmasından əvvəl ola bilməz."],
  ])("%s: said on the toast after the bed, the beds read again, the field focused — and nothing held", async (code, status, words) => {
    const { api } = await open((a) => a.admit
      .mockRejectedValueOnce(refusal(status, "English words a screen must not show", { apiCode: code }))
      .mockResolvedValueOnce(admitted()));
    fillRequired();
    choose(at(12, 0));
    const reads = api.structure.mock.calls.length;
    await press();
    expect(toasts().getAllByText(`${BED1}: ${words}`).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/English words/);
    expect(api.structure.mock.calls.length).toBeGreaterThan(reads);
    expect(document.activeElement).toBe(field());
    expect(admitButton().getAttribute("aria-disabled")).toBeNull();
    choose(at(12, 30));
    await press();
    expect(api.admit).toHaveBeenCalledTimes(2);
    expect(sentAt(api, 1)).toBe(new Date(2026, 10, 12, 12, 30).toISOString());
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `cd /c/tmp/g3-kabul-zamani/dashboard && npx vitest run src/live/screens/kabul/AdmitTab.test.jsx 2>&1 | tail -5`
Expected: `Tests  9 failed | 72 passed (81)` — each new test: `Unable to find a label with the text of: /^Qəbul vaxtı/`.

- [ ] **Step 3: The field, its clock, its send and its refusals**

In `dashboard/src/live/screens/kabul/AdmitTab.jsx`, find (lines 60–61):

```js
// qəbul» leaves the hold. The open admission is discharged first.
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
```

Replace with:

```js
// qəbul» leaves the hold. The open admission is discharged first.
//
// «KABUL ZAMANI» (G3-07, spec D1, §5). First in the «Kabul» box; untouched it shows the current minute
// of the server-corrected clock and sends nothing — the server stamps the save. Touched, the chosen
// minute goes out (admitForm.js `admittedAtOf`), bounded by six hours, the chosen bed's free time and
// the clock. A refusal of the time — too old, before the bed was free, before the person's last
// discharge — is said on the toast after the bed, the beds are read again (the bed's new time moves
// the bound) and the focus goes to the field from where a press leaves it. Nothing is held. A send with
// no answer near the six-hour edge may find its minute named by the panel a minute later: she moves it,
// and the send that follows looks for the first send's admission first, as every send does (A-19).
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
```

In the same file, find (lines 77–85):

```js
import { FOCUS_RING } from "../../ui/focus.js";
import { doneFor, mayHaveLanded, reasonOf, refusedFor } from "../admin/refusal.js";
import {
  ADMISSION_TYPES, BLOOD_GROUPS, COMORBIDITIES, CONSENTS, EARLIEST_BIRTH, ENGINE_FAILED, NATIONALITIES,
  RELATIONS, SEXES, SOURCES, ageOf, missing, toBody,
} from "./admitForm.js";
import { freshForm, newRequestId, sameName, useAdmitDraft } from "./admitDraft.js";
import { BedPicker } from "./BedPicker.jsx";
import { boardKeyOf } from "./boardKey.js"; //                    G2-B1d: the card key (E12)
```

Replace with:

```js
import { FOCUS_RING } from "../../ui/focus.js";
import { dayStamp } from "../../i18n/dates.js";
import { doneFor, mayHaveLanded, reasonOf, refusedFor } from "../admin/refusal.js";
import { useBoardNow } from "../common/BoardState.jsx";
import {
  ADMISSION_TYPES, BLOOD_GROUPS, COMORBIDITIES, CONSENTS, EARLIEST_BIRTH, ENGINE_FAILED, NATIONALITIES,
  RELATIONS, SEXES, SOURCES, admittedBounds, ageOf, missing, toBody,
} from "./admitForm.js";
import { freshForm, newRequestId, sameName, useAdmitDraft } from "./admitDraft.js";
import { BedPicker } from "./BedPicker.jsx";
import { boardKeyOf } from "./boardKey.js"; //                    G2-B1d: the card key (E12)
import { localInput } from "./DischargeDialog.jsx";
```

In the same file, find (lines 103–104):

```js
/** The engine parts the number box names when they did not land, in the order it names them. */
const PARTS = ["board", "weight", "profile"];
```

Replace with:

```js
/** The engine parts the number box names when they did not land, in the order it names them. */
const PARTS = ["board", "weight", "profile"];

/** G3-07: the refusals of «Kabul zamanı» — older than six hours, before the bed was free, before the
 *  person's last discharge. Each is said, the beds read again and the field focused; nothing is held. */
const TIME_REFUSALS = new Set(["field_invalid:admission_datetime", "admitted_before_bed_free",
  "admitted_before_discharge"]);
/** How often the field's «now» and its bounds are read again: the bedside form's cadence. */
const CLOCK_EVERY_MS = 30_000;
```

In the same file, find (lines 247–248):

```js
  const today = localToday();
  const gaps = useMemo(() => missing(form, today), [form, today]);
```

Replace with:

```js
  const today = localToday();
  // G3-07: the server-corrected clock (the shell's BoardProvider, as the bedside form's), and the
  // chosen bed's free time — the server's string, as the structure answered it.
  const nowMs = useBoardNow(CLOCK_EVERY_MS);
  const freeSince = index.beds.get(normId(form.bedId))?.stateSince ?? null;
  const gaps = useMemo(() => missing(form, today, { now: nowMs, freeSince }), [form, today, nowMs, freeSince]);
```

In the same file, find (lines 310–312):

```js
  const bedText = form.bedLabel ?? "";

  /** The form's patient admitted
```

Replace with:

```js
  const bedText = form.bedLabel ?? "";
  // G3-07: «Kabul zamanı»'s bounds, and its hint — with the chosen bed's free time once one is chosen.
  const bounds = admittedBounds(nowMs, freeSince);
  const freeMs = Date.parse(freeSince ?? "");
  const admittedHint = Number.isFinite(freeMs)
    ? `${t("kabul.admittedAtHint")} ${t("kabul.admittedAtBedSince", { time: dayStamp(freeMs, nowMs) })}`
    : t("kabul.admittedAtHint");

  /** The form's patient admitted
```

In the same file, find (lines 442–447):

```js
      draft.update({ held: { bed: null, duplicate: apiErrorKey(err) } });
      toast(refusedFor(t, "", err), "error");
      await reload();
      return;
    }
    if (mayHaveLanded(err)) {
```

Replace with:

```js
      draft.update({ held: { bed: null, duplicate: apiErrorKey(err) } });
      toast(refusedFor(t, "", err), "error");
      await reload();
      return;
    }
    if (TIME_REFUSALS.has(err?.apiCode)) {
      // G3-07 (spec §5): the time was refused and nothing was written. Said after the bed; the beds
      // are read again (a bed's new `state_since` moves the field's min); the field is marked and
      // takes the focus from where a press leaves it. Nothing is held: she changes the time and sends.
      toast(refusedFor(t, sent.bed, reasonOf(t, err)), "error");
      draft.update({ tried: true });
      await reload();
      if (!draft.live) return;
      if (focusIsIdle(submitRef.current)) setFocusTo({ field: "admittedAt" });
      return;
    }
    if (mayHaveLanded(err)) {
```

In the same file, find (line 513):

```js
    const body = toBody(form, sent.requestId, { confirmReserved: saidYes });
```

Replace with:

```js
    const body = toBody(form, sent.requestId, { confirmReserved: saidYes, freeSince });
```

In the same file, find (lines 589–590):

```js
        <Box title={t("kabul.groupAdmission")} icon="clip" level={2}>
          <Field label={t("kabul.f.type")} required error={errorOf("type")}>
```

Replace with:

```js
        <Box title={t("kabul.groupAdmission")} icon="clip" level={2}>
          {/* G3-07: untouched it shows the current minute and sends nothing; touched, the minute chosen. */}
          <Field label={t("kabul.f.admittedAt")} error={errorOf("admittedAt")} hint={admittedHint}>
            <Input id={idOf("admittedAt")} type="datetime-local"
              value={form.admittedAtTouched ? form.admittedAt : localInput(nowMs)}
              min={localInput(bounds.minMs)} max={localInput(bounds.maxMs)}
              onChange={(e) => set({ admittedAt: e.target.value, admittedAtTouched: true })} />
          </Field>
          <Field label={t("kabul.f.type")} required error={errorOf("type")}>
```

The field's words, its hints and the widened refusal of the time, in four languages.

In `dashboard/src/live/i18n/strings/kabul.js`, find (lines 29–30):

```js
      reportedBy: "Bildiren hekim", dischargeAt: "Çıkış zamanı", note: "Not",
    },
```

Replace with:

```js
      reportedBy: "Bildiren hekim", dischargeAt: "Çıkış zamanı", note: "Not",
      admittedAt: "Kabul zamanı",   // G3-07
    },
```

In the same file, find (line 36):

```js
    comorbiditiesTextHint: "Kaydedilir; motora kod olarak gönderilmez.",
```

Replace with:

```js
    comorbiditiesTextHint: "Kaydedilir; motora kod olarak gönderilmez.",
    // G3-07 (spec §5): «Kabul zamanı»'s hint, and the chosen bed's free time beside it.
    admittedAtHint: "Değiştirilmezse kaydın anı yazılır. En çok 6 saat geriye.",
    admittedAtBedSince: "Yatak {time}'den beri boş: kabul zamanı bundan önce olamaz.",
```

In the same file, find (line 212):

```js
      admissionDatetime: "Kabul zamanı geçerli değil (gelecekte olamaz).",
```

Replace with:

```js
      admissionDatetime: "Kabul zamanı geçerli değil (gelecekte ya da 6 saatten eski olamaz).",
```

In the same file, find (lines 241–242):

```js
      reportedBy: "Bildirən həkim", dischargeAt: "Çıxış vaxtı", note: "Qeyd",
    },
```

Replace with:

```js
      reportedBy: "Bildirən həkim", dischargeAt: "Çıxış vaxtı", note: "Qeyd",
      admittedAt: "Qəbul vaxtı",   // G3-07
    },
```

In the same file, find (line 248):

```js
    comorbiditiesTextHint: "Yadda saxlanılır; mühərrikə kod kimi göndərilmir.",
```

Replace with:

```js
    comorbiditiesTextHint: "Yadda saxlanılır; mühərrikə kod kimi göndərilmir.",
    admittedAtHint: "Dəyişdirilməsə, qeydin anı yazılır. Ən çox 6 saat geriyə.",
    admittedAtBedSince: "Çarpayı {time}-dən boşdur: qəbul vaxtı bundan əvvəl ola bilməz.",
```

In the same file, find (line 406):

```js
      admissionDatetime: "Qəbul vaxtı düzgün deyil (gələcəkdə ola bilməz).",
```

Replace with:

```js
      admissionDatetime: "Qəbul vaxtı düzgün deyil (gələcəkdə və ya 6 saatdan köhnə ola bilməz).",
```

In the same file, find (lines 435–436):

```js
      reportedBy: "Сообщивший врач", dischargeAt: "Время выписки", note: "Примечание",
    },
```

Replace with:

```js
      reportedBy: "Сообщивший врач", dischargeAt: "Время выписки", note: "Примечание",
      admittedAt: "Время приёма",   // G3-07
    },
```

In the same file, find (line 442):

```js
    comorbiditiesTextHint: "Сохраняется; системе как код не передаётся.",
```

Replace with:

```js
    comorbiditiesTextHint: "Сохраняется; системе как код не передаётся.",
    admittedAtHint: "Если не менять, записывается момент сохранения. Не более 6 часов назад.",
    admittedAtBedSince: "Койка свободна с {time}: время приёма не может быть раньше.",
```

In the same file, find (line 600):

```js
      admissionDatetime: "Время приёма неверно (не может быть в будущем).",
```

Replace with:

```js
      admissionDatetime: "Время приёма неверно (не в будущем и не более 6 часов назад).",
```

In the same file, find (lines 629–630):

```js
      reportedBy: "Reporting physician", dischargeAt: "Discharge time", note: "Note",
    },
```

Replace with:

```js
      reportedBy: "Reporting physician", dischargeAt: "Discharge time", note: "Note",
      admittedAt: "Admission time",   // G3-07
    },
```

In the same file, find (line 636):

```js
    comorbiditiesTextHint: "Stored; not sent to the engine as a code.",
```

Replace with:

```js
    comorbiditiesTextHint: "Stored; not sent to the engine as a code.",
    admittedAtHint: "Left unchanged, the moment of saving is recorded. At most 6 hours back.",
    admittedAtBedSince: "The bed has been free since {time}: the admission time cannot be earlier.",
```

In the same file, find (line 794):

```js
      admissionDatetime: "The admission time is not valid (it cannot be in the future).",
```

Replace with:

```js
      admissionDatetime: "The admission time is not valid (not in the future, not more than 6 hours back).",
```

- [ ] **Step 4: Run to see them pass**

Run: `cd /c/tmp/g3-kabul-zamani/dashboard && npx vitest run src/live/screens/kabul src/live/apiErrors.test.js src/live/i18n/strings.test.js 2>&1 | tail -5`
Expected: `Test Files  16 passed (16)`, `Tests  716 passed (716)` — `AdmitTab.test.jsx` 81 (72 + 9).

Run: `cd /c/tmp/g3-kabul-zamani/dashboard && npx vitest run src/live/rawKeys.test.jsx src/live/screens/doluluk src/live/shell 2>&1 | tail -5`
Expected: `Test Files  8 passed (8)`, `Tests  192 passed (192)` — the raw-key sweep opens `/kabul` and finds every key of the field resolved.

Run: `cd /c/tmp/g3-kabul-zamani && git diff --stat HEAD -- dashboard/src/live/screens/kabul/AdmitTab.jsx dashboard/src/live/i18n/strings/kabul.js`
Expected: `AdmitTab.jsx | 53` (+50 −3) and `kabul.js | 21` (this task's lines only: the commits of E2 and W2 hold theirs) — never a whole-file diff.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g3-kabul-zamani && git add -- dashboard/src/live/screens/kabul/AdmitTab.jsx dashboard/src/live/screens/kabul/AdmitTab.test.jsx dashboard/src/live/i18n/strings/kabul.js && git commit -m "feat(dashboard): «Kabul zamanı» first in the Kabul box — untouched sends nothing, its bounds, its three refusals (G3-07 D1, §5)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- dashboard/src/live/screens/kabul/AdmitTab.jsx dashboard/src/live/screens/kabul/AdmitTab.test.jsx dashboard/src/live/i18n/strings/kabul.js
```

---

## Closing (controller)

### Task G1: The gates

**Files:** none. A gate failure goes back to the owning task as a fix commit (pathspec, trailer); then the failed chunk is run again. Every command is one foreground call.

- [ ] **Step 1: The whole no-DB engine suite, in three foreground chunks**

Never `test_infinity_vm_pilot.py`:

```bash
cd /c/tmp/g3-kabul-zamani/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_[a-d]*.py 2>&1 | tail -3
cd /c/tmp/g3-kabul-zamani/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_[e-l]*.py --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -3
cd /c/tmp/g3-kabul-zamani/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_[m-z]*.py tests/rules tests/scoring tests/tenant 2>&1 | tail -3
```

Expected: no failure, no error. Against Task 0's baseline (4484 passed, 1527 skipped) the slice adds **4 passed** and **20 skipped** — **4488 passed, 1547 skipped**:

| Chunk | Baseline | After the slice | What was added |
|---|---|---|---|
| `test_[a-d]*` | 1369 / 827 | 1373 / 847 | `test_admission_form.py` +4; `test_admission_time.py` (20 skipped: no database) |
| `test_[e-l]*` | 1733 / 114 | 1733 / 114 | — |
| `test_[m-z]*` + `rules`, `scoring`, `tenant` | 1382 / 586 | 1382 / 586 | — |

A chunk takes three to seven minutes on a loaded machine (the first was 4 min at baseline).

- [ ] **Step 2: The Postgres part, on the throwaway database**

Start `kabulz-pg` («Ground rules»), then, one foreground call each:

```bash
cd /c/tmp/g3-kabul-zamani/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:kabulz@127.0.0.1:56452/kabulz_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_admission_time.py 2>&1 | tail -3
cd /c/tmp/g3-kabul-zamani/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:kabulz@127.0.0.1:56452/kabulz_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_protocol_admission.py tests/test_reserved_admission.py tests/test_admission_trail.py tests/test_care_team_sign_off.py 2>&1 | tail -3
cd /c/tmp/g3-kabul-zamani/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:kabulz@127.0.0.1:56452/kabulz_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_admission_api.py 2>&1 | tail -3
cd /c/tmp/g3-kabul-zamani/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:kabulz@127.0.0.1:56452/kabulz_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_transfer_api.py 2>&1 | tail -3
cd /c/tmp/g3-kabul-zamani/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:kabulz@127.0.0.1:56452/kabulz_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_discharge_api.py 2>&1 | tail -3
cd /c/tmp/g3-kabul-zamani/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:kabulz@127.0.0.1:56452/kabulz_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_readings_postgres.py tests/test_tasks_postgres.py tests/test_migration_0021_vital_readings.py 2>&1 | tail -3
```

Expected, in order — seen on the scratch copy, with the time each took there: `20 passed` (70 s); `31 passed` (50–190 s: split it in two calls if the machine is loaded); `50 passed, 1 skipped` (60–170 s); `72 passed` (`test_transfer_api.py`, 140 s); `30 passed` (`test_discharge_api.py`, 45 s); `71 passed` (the readings and task stores and migration 0021, 95 s). The last three files are not changed by this slice: they pin that a move, a discharge and G3-05's stores still behave with `kabul_world`'s `**extra`. No failure, nothing skipped beyond the one of `test_admission_api.py`. Stop the container: `docker stop kabulz-pg`.

- [ ] **Step 3: One alembic head**

Run: `cd /c/tmp/g3-kabul-zamani/homunculus-engine && PYTHONPATH=src /c/tmp/f7-py312/venv/Scripts/python.exe -m alembic heads 2>&1 | tail -2`
Expected: one line, `0021 (head)` — no migration in this slice.

- [ ] **Step 4: The whole dashboard suite**

Run: `cd /c/tmp/g3-kabul-zamani/dashboard && npx vitest run 2>&1 | tail -6` (foreground, timeout 600000; from this upper-case path).
Expected: no failure. Against Task 0's baseline (178 files, 4760 tests): **no new file** and **20 more tests** (`admitForm.test.js` +7, `AdmitTab.test.jsx` +9, `apiErrors.test.js` +3, `structure.test.js` +1) — `Test Files  178 passed (178)`, `Tests  4780 passed (4780)` on the scratch copy (about 3½ minutes).

- [ ] **Step 5: The build and the precache**

Run: `cd /c/tmp/g3-kabul-zamani/dashboard && npx vite build 2>&1 | tail -12`
Expected: `✓ built in …`, no error, no `larger than 500 kB` line, `precache  74 entries` — one more than Task 0's 73: departure E-6 (`PrintLabelButton-*.js` is its own chunk now). On the scratch copy the line read `precache  74 entries (1645.80 KiB)`; `KabulScreen-*.js` 36.00 → 36.91 kB. `dist/` is git-ignored.

- [ ] **Step 6: The slice's no-DB files under Python 3.14**

Run: `cd /c/tmp/g3-kabul-zamani/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/g115-py314/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests/test_admission_form.py tests/test_admission_time.py tests/test_device_beds_wiring.py 2>&1 | tail -3`
Expected: `157 passed, 20 skipped`.

- [ ] **Step 7: Record the gates**

Write the results (the lines as printed, the date, the head's sha) into the «As run» block at the end of this file and into the spec's «As built» section (Task D1 Step 3). Commit with Task D1.

---

### Task G2: The local walk — spec §6 «Local walk», five items

**Where:** `/c/tmp/g3-kabul-zamani`, after Task G1. The agent drives the dashboard in headless Chrome, as G3-05's walk did; **synthetic data only** — the tenant `kabulz-yuruyus`, the patients «Test Hasta» (1970-05-05) and «Test Hasta İki» (1971-06-06), the protocol `202600000001`, the typo `202600000010`. Nothing is committed by this task: its outcome is `/c/tmp/homunculus-plans/g3-kabulz/walk/notes.md` (each item: what was done, what the screen or the probe said, pass or finding) and the screenshots beside it (1440 px and 390 px of the Kabul form with the field, in both themes).

**Unlike every other task of this plan, these commands were not run when the plan was written** (another lane's stack was up on the fixed container names `homunculus-*`, port 18100): they are composed from G3-05's walk (`docs/superpowers/plans/2026-11-11-g3-cihaz-olcum-kaydi.md` Task G2). Where a line does not behave as written, write down what it did, adapt it, and go on — the five items and their expected pictures are what is binding.

- [ ] **Step 1: No other stack, and the MLLP port free.**

```bash
docker ps -a --format '{{.Names}} {{.Ports}} {{.Label "com.docker.compose.project"}}' | grep -E '^homunculus-(postgres|api|web|bridge|nce) ' || echo "no stack containers"
netstat -ano | grep -E "[:.]2575 .*LISTEN" || echo "2575 free"
```

If a container is listed or 2575 is taken: **stop and ask the controller** whose it is and whether it may go down. Never `down -v` a stack this task did not start.

- [ ] **Step 2: The images, from the slice's head** (api + web: spec §8; the bridge is G3-05's, unchanged).

```bash
cd /c/tmp/g3-kabul-zamani
docker build -q -t g3-kabulz-api:new -f homunculus-engine/Dockerfile.api homunculus-engine
docker build -q -t g3-kabulz-web:new --build-arg BUILD_SHA=$(git rev-parse --short HEAD) -f deploy/local/web/Dockerfile .
docker build -q -t g3-kabulz-bridge:new -f homunculus-engine/Dockerfile homunculus-engine
docker run --rm --entrypoint python g3-kabulz-api:new -c "from homunculus.admission.form import BACKDATE_MAX; from homunculus.admission.errors import ADMITTED_BEFORE_BED_FREE; print(BACKDATE_MAX, ADMITTED_BEFORE_BED_FREE)"
```

Expected: three image ids; `6:00:00 admitted_before_bed_free`.

- [ ] **Step 3: The stack's scratch** (outside the repo):

```bash
S=/c/tmp/homunculus-plans/g3-kabulz/stack
mkdir -p $S /c/tmp/homunculus-plans/g3-kabulz/walk
grep -vE '^(WEB_PORT|WEB_TLS_PORT|TENANT_SLUG)=' /c/tmp/g115plan/stack/local.env > $S/local.env
printf 'WEB_PORT=18206\nWEB_TLS_PORT=18569\nTENANT_SLUG=kabulz-yuruyus\n' >> $S/local.env
```

**Write** `/c/tmp/homunculus-plans/g3-kabulz/stack/compose.kabulz.yml` (with the Write tool):

```yaml
# G3-07's walk: the three services run the slice's images, never a build or a pull. Used with
# deploy/local/docker-compose.yml and G1-15's compose.g115.yml (the bind mounts in scratch).
services:
  api:
    image: g3-kabulz-api:new
    pull_policy: never
  web:
    image: g3-kabulz-web:new
    pull_policy: never
  bridge:
    image: g3-kabulz-bridge:new
    pull_policy: never
```

In every command below, `C` is (set it again in each tool call):

```bash
C="docker compose -p g3kabulz -f deploy/local/docker-compose.yml -f /c/tmp/g115plan/stack/compose.g115.yml -f /c/tmp/homunculus-plans/g3-kabulz/stack/compose.kabulz.yml --env-file /c/tmp/homunculus-plans/g3-kabulz/stack/local.env"
```

- [ ] **Step 4: Up.**

```bash
cd /c/tmp/g3-kabul-zamani
$C up -d --no-build postgres api web bridge 2>&1 | tail -4
docker exec homunculus-postgres psql -U homunculus -d homunculus -Atc "select version_num from alembic_version" </dev/null
```

Expected: `0021`. Wait for `curl -s http://127.0.0.1:18206/health` before the browser.

- [ ] **Step 5: The walk.** Sign in as the seed admin (`SEED_ADMIN_EMAIL` of `local.env`). Yönetim › Yapı: unit «Reanimasiya», room «Otaq 1», beds «1» and «2»; Yönetim › Protokol ve etiket: start number `202600000001`. For each item, write the expected line and what was seen into `notes.md`.

  1. **A set under a typo, measured 1 h ago, is listed; admit with «Kabul zamanı» 90 min ago; link it.** Post one device round by hand under the typo, measured an hour ago (the device token of `local.env`, a synthetic device name):

     ```bash
     TOKEN=$(grep '^TENANT_TOKEN=' /c/tmp/homunculus-plans/g3-kabulz/stack/local.env | cut -d= -f2)
     AT=$(date -u -d '-1 hour' +%Y-%m-%dT%H:%M:%S+00:00)
     for pair in spo2:96 heart_rate:84 temperature:36.9; do
       curl -s -X POST http://127.0.0.1:18206/ingest -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
         -d "{\"resourceType\":\"Observation\",\"code\":{\"coding\":[{\"system\":\"x\",\"code\":\"${pair%%:*}\"}]},\"subject\":{\"reference\":\"Patient/202600000010\"},\"effectiveDateTime\":\"$AT\",\"valueQuantity\":{\"value\":${pair##*:},\"unit\":\"\"},\"device\":{\"display\":\"CONNEX-3A\"}}"; echo
     done
     ```

     Expected: three `{"patient_id":"202600000010","dropped":"unmatched"}`. Hasta Kabul › Kabul: «Test Hasta», 1970-05-05, bed 1, and «Kabul zamanı» set 90 minutes back — the field shows the current minute until touched; its hint reads «Değiştirilmezse kaydın anı yazılır. En çok 6 saat geriye.» and, once bed 1 is chosen, «Yatak … beri boş …». «Kabul et» → the box shows `202600000001`. On `/olcum` › «Eşleşmeyen ölçümler»: the set under `202600000010` → «Hastaya bağla» → bed 1 → «Evet, bağla»: the toast names the bed; the patient's «Ölçüm kaydı» shows the set at its own time, «cihaz · CONNEX-3A»; Görevlerim's vital task anchors on it. `select payload->>'admission_datetime', payload->>'backdated' from audit where event_type = 'admission.admit'` prints the chosen minute (UTC) and `true`.
  2. **A set measured 7 h ago, under the same typo: the link is refused.** The same `curl` with `AT=$(date -u -d '-7 hours' …)`; link it to bed 1's patient. Expected: the toast «Ölçüm, hastanın bu yatışı başlamadan önce alınmış: bu yatışa bağlanamaz.» (in the session's language); the set stays listed.
  3. **A bed released 30 min ago: the field's min is the release; an earlier time through the API is 409.** Discharge «Test Hasta İki» from bed 2 (admit, sign, start, confirm), then «Temizlik bitti · boş» on Doluluk; wait or note the release time. On the Kabul form choose bed 2: the field's `min` (DevTools) is the release's minute and the hint names it. Through the API, a form for bed 2 with `admission_datetime` a minute before the release answers 409 `{"detail": {"code": "admitted_before_bed_free", …}}`; on the screen, the same refusal (forced with the API's answer, or by a bed released after the form read the structure) says «Kabul zamanı, yatağın boşaldığı andan önce olamaz.» after the bed, and the field takes the focus.
  4. **Discharge a patient, readmit her to another bed with a time before that discharge: 409 `admitted_before_discharge`.** «Test Hasta» (bed 1) signed, discharged at a time 20 minutes back, confirmed; a new kabul of «Test Hasta», 1970-05-05, to bed 2 with «Kabul zamanı» 30 minutes back. Expected: the toast «Kabul zamanı, bu hastanın son taburcusundan önce olamaz.»; nothing is held — the time moved to after the discharge admits her.
  5. **An untouched form: the row's time is the save; Denetim lists the kabul as before.** Admit a third synthetic patient without touching the field. `select admission_datetime, created_at from admissions order by created_at desc limit 1` prints two times within a second; the `admission.admit` row's payload has `admission_datetime` and no `backdated`; «Denetim» lists the kabul with its actor, as before.

  Screenshots: the Kabul form with the field and a bed chosen, at 1440 px and 390 px, light and dark.

- [ ] **Step 6: Down, and the notes.** `$C down -v 2>&1 | tail -2` (this task's own stack and volumes only). Write `notes.md`: the date, the head's sha, the three image ids, each item's pass or finding. A finding goes back to its task as a fix commit, and the item is walked again. Do not commit the notes or the screenshots.

---

### Task D1: The guide, the roadmap, the spec's «As built», the plan's «As run»

**Files:**
- Modify: `docs/homunculus-rehber-TR.md` — lines 1175–1176, lines 1184–1185, line 1916, lines 2832–2835 (as each step finds the file)
- Modify: `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` — line 58 (as each step finds the file)
- Modify: `docs/superpowers/specs/2026-11-12-g3-kabul-zamani-design.md` — after line 409 (the end of the file)
- Modify: this plan's «As run» block

Docs are the controller's. `docs/homunculus-rehber-TR.md` is the owner's living guide: plain Turkish. The edits below were applied to a scratch copy at `9929145b`; if another lane's merge moved a find block, the text is the same and only its place changed. Section numbers (3.8, 3.16, 3.27) are the guide's at `9929145b`.

- [ ] **Step 1: The guide (spec §7)**

§3.8, the form's list.

In `docs/homunculus-rehber-TR.md`, find (lines 1175–1176):

```markdown
  *Kabul:* kabul türü\*, kaynak, kabul tanısı\*, kilo, boy, kan grubu, bilinen alerji ya da
  "Bilinen alerjisi yok"\* (ikisinden biri), eşlik eden hastalıklar, HBYS protokol no. *İletişim ve
```

Replace with:

```markdown
  *Kabul:* kabul zamanı (değiştirilmezse kaydın anı yazılır; hasta daha önce geldiyse geldiği dakikaya
  çekilir — en çok 6 saat geriye; yatağın boşaldığı andan ve hastanın son taburcusundan önce olamaz;
  kaydedildikten sonra değiştirilemez, bkz. 3.27), kabul türü\*, kaynak, kabul tanısı\*, kilo, boy, kan
  grubu, bilinen alerji ya da
  "Bilinen alerjisi yok"\* (ikisinden biri), eşlik eden hastalıklar, HBYS protokol no. *İletişim ve
```

In the same file, find (lines 1184–1185):

```markdown
  Form yarıda bırakılıp başka bir sekmeye ya da ekrana geçilse de kaybolmaz; onu "Yeni kabul" ya
  da oturumun kapanması temizler.
```

Replace with:

```markdown
  Form yarıda bırakılıp başka bir sekmeye ya da ekrana geçilse de kaybolmaz; onu "Yeni kabul" ya
  da oturumun kapanması temizler. Kabul zamanı yatağın boşaldığı andan önce olamadığı için
  "Temizlik bitti · boş" temizlik bittiği anda basılır: geç basılırsa o yatağa yapılan kabul, düğmeye
  basıldığı andan geriye çekilemez.
```

§3.16, the vital task's anchor.

In the same file, find (line 1916):

```markdown
  göndermediği için cihaz turundan sonra NEWS2 «eksik» kalır. Son 48 saatte ölçüm yoksa dayanak kabul zamanıdır; o da
```

Replace with:

```markdown
  göndermediği için cihaz turundan sonra NEWS2 «eksik» kalır. Son 48 saatte ölçüm yoksa dayanak kabul zamanıdır
  (formda girilen kabul zamanı, 3.8); o da
```

§3.27, «Yatıştan önce ölçülen set».

In the same file, find (lines 2832–2835):

```markdown
    reddedebilir. Ölçüm gerçekten o hastanınsa (örneğin hasta ölçüldükten sonra kabul edildiyse) yine bağlanamaz:
    kabul formunda kabul saati girilecek bir alan yoktur, yatış kabulün kaydedildiği an başlar. Değerler istenirse
    hasta ekranındaki «Ölçüm gir» ile ölçüm saatine elle girilir (en çok 24 saat geriye; kaynağı «elle» olur) ve set
    gerekçesiyle reddedilir.
```

Replace with:

```markdown
    reddedebilir. Ölçüm gerçekten o hastanınsa — hasta ölçüldükten sonra kabul edildiyse — kabul formunda «Kabul
    zamanı» hastanın geldiği dakikaya çekilir (en çok 6 saat geriye; yatağın boşaldığı andan ve hastanın son
    taburcusundan önce olamaz; G3-07). Yatış o andan başlar ve o andan (2 dakika payıyla) sonra ölçülen set
    bağlanabilir. Bu pencerede hastanın kendi numarasıyla ölçülmüş bir seti yalnız o hastayı görenler görür. Bedeli:
    başka bir servisin bir sonraki numarayla yanlış girdiği ve bu pencerede ölçülmüş bir tur da bu hastaya
    bağlanabilir hâle gelir; bağlamadan önceki kimlik sorusu ve cihazın gösterdiği ad buna karşı korumadır. Kabul
    kaydedildikten sonra kabul zamanı değiştirilemez; o durumda ya da 6 saatten eski bir ölçümde değerler hasta
    ekranındaki «Ölçüm gir» ile ölçüm saatine elle girilir (en çok 24 saat geriye; kaynağı «elle» olur) ve set
    gerekçesiyle reddedilir.
```

- [ ] **Step 2: The roadmap — the row of G3-07**

The find block is the end of the G3-05 row (it begins with «; »: it is the tail of a long line). Fill the `…` of the status cell from Task G1's and G2's records before committing.

In `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`, find (line 58):

```markdown
; NCE akışı (B1d O1–O6) — yalnız yerel kurulumda denendi |
```

Replace with:

```markdown
; NCE akışı (B1d O1–O6) — yalnız yerel kurulumda denendi |
| G3-07 | Kabul zamanı (kontrolcü hattı): kabul formu yatışın ne zaman başladığını söyler — «Kabul» kutusunda ilk alan «Kabul zamanı»; değiştirilmezse hiçbir şey gönderilmez ve sunucu kaydın anını yazar (eskisi gibi), değiştirilirse seçilen dakika gider. Sunucu sınırları, önceki gönderimin aranmasından sonra (A-19 yeniden gönderim yanıtlanır) ve protokol verilmeden önce: en çok 6 saat geriye (422 `field_invalid:admission_datetime`), yatağın boşaldığı andan önce değil (409 `admitted_before_bed_free`, yatak kilidi altında), aynı kişinin son taburcusundan önce değil (409 `admitted_before_discharge`). Denetim satırı `admission_datetime` taşır, yalnız zaman gönderildiyse `backdated: true`. Göç yok, yetki yok, rota yok; nakil değişmez; kabulden sonra değiştirilemez. G3-05'in bağlama penceresi, görünürlüğü ve reconcile damgası geriye tarihli başlangıcı izler (D9: bir sonraki protokolün yazım hatasına karşı koruma o pencerede zayıflar — kabul edilen bedel) · spec: [2026-11-12](../specs/2026-11-12-g3-kabul-zamani-design.md) · plan: [2026-11-12](2026-11-12-g3-kabul-zamani.md) | Kod ✅ … · dal `feat/g3-kabul-zamani` @ `…` · kapılar: motor veritabanısız … geçti / … atlandı; Postgres dilimi …; pano … dosya / … test, precache 74 · yerel yürüyüş: … · **main'de değil, VM'de değil** (sahibin sözü; kurulum notları planın sonunda) · AZ/RU/EN metinler ana dili okumasını bekliyor |
```

- [ ] **Step 3: The spec — «As built»**

Fill each `…` from Tasks G1 and G2.

Append to the end of `docs/superpowers/specs/2026-11-12-g3-kabul-zamani-design.md` (after line 409):

```markdown

## 11. As built

Plan: `docs/superpowers/plans/2026-11-12-g3-kabul-zamani.md`. Built on `feat/g3-kabul-zamani`; head `…`; gates run … (the lines are in the plan's «As run» block).

What differs from the design above (the plan's departures, E-1 … E-7):

- **§3.3.** The audit row's `admission_datetime` is written in UTC (`astimezone(timezone.utc).isoformat()`): the row's own instant, one spelling, whatever offset the form sent (E-1).
- **D3.** A bed whose `state_updated_at` is NULL (the column is nullable since 0001) binds nothing (E-2).
- **§6.** The end-to-end test builds `vital_readings` from migration 0021's own `upgrade()` on the models' schema, without the `audit` index; `kabul_world.ward_app`/`ward_client` pass `**extra` to `create_app` (E-3). The new test file's beds are free since a day unless a test sets their time (E-4).
- **§5.** The hint's time is `dayStamp` (`11:30`, or `11.11 23:00` on another day) (E-5). `admitForm.js` imports `DischargeDialog`'s `fromLocalInput`; the bedside picker imports `admitForm.js`, so the bedside page loads that 4 kB chunk and `PrintLabelButton` became its own: precache 73 → 74 (E-6). A resend near the six-hour edge is handled by the form's existing look-up (E-7).

The open item of §5 is settled: the Kabul screen is under the shell's `BoardProvider` (`LiveApp.jsx` wraps every phase in it), so the field's clock is `useBoardNow`, the server-corrected one.

Local walk (§6): … (date, head, the five items: pass or finding).
```

- [ ] **Step 4: The plan's «As run» block, and the commit**

Fill the «As run» block at the end of this plan with Task G1's results and Task G2's outcome, then:

```bash
cd /c/tmp/g3-kabul-zamani && git add -- docs/homunculus-rehber-TR.md docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md docs/superpowers/specs/2026-11-12-g3-kabul-zamani-design.md docs/superpowers/plans/2026-11-12-g3-kabul-zamani.md && git commit -m "docs(rehber, roadmap, spec): G3-07 Kabul zamanı — the guide's three places, the roadmap row, as built, the gates as run" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- docs/homunculus-rehber-TR.md docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md docs/superpowers/specs/2026-11-12-g3-kabul-zamani-design.md docs/superpowers/plans/2026-11-12-g3-kabul-zamani.md
git push origin feat/g3-kabul-zamani
```

Then report to Lane A that the branch is ready for the owner's «main'e al», with the deploy notes below. **Do not merge and do not touch the VM.**

---

## Deploy notes for Lane A (spec §8 — what the blocks must say; Lane A writes them, the owner's «onay» runs them)

- **Images: api + web.** No migration, no environment variable; the bridge, the hub and the workers are untouched. **Order: api first, then web.** The new api answers the old form as today (no time is sent); a new form on the old api would send times the old api takes with no lower bound.
- **Rollback: web first, then api.** Back-dated rows stay back-dated; under the old images every reader takes the column as it is. The old api has no lower bound, but no screen of the old web sends a time.
- **The ward is told beforehand:** the field «Kabul zamanı» and its six hours; that it is set at the kabul or never (D5: no later change); that «Temizlik bitti · boş» is pressed when the cleaning ends, because a bed released late caps the time (O2); that a round measured on arrival is linked once the kabul says when the patient came.
- **Checks after the start:** the web asset grep finds the new key (`admittedBeforeBedFree`); an untouched kabul on the VM writes an `admission.admit` row whose payload has `admission_datetime` and no `backdated` (`select payload from audit where event_type = 'admission.admit' order by id desc limit 1` — the payload holds no name).
- **Open:** az/ru/en strings await a native reading (O5); Doluluk's tile and the bed card still show the bed's state time, the save (O1).

---

## As run (filled by the controller in Tasks G1, G2 and D1)

- Head: … · date: …
- G1 Step 1 (engine, no database): … / … / …
- G1 Step 2 (Postgres): … ; … ; … ; … ; … ; …
- G1 Step 3 (`alembic heads`): …
- G1 Step 4 (dashboard): …
- G1 Step 5 (build): …
- G1 Step 6 (Python 3.14): …
- G2 (the walk): … — notes at `/c/tmp/homunculus-plans/g3-kabulz/walk/notes.md`

---

## Spec coverage

**Decisions (spec §2):**

| # | Decision | Task(s) |
|---|---|---|
| D1 | the field, first in «Kabul»; untouched sends nothing; touched sends the minute as ISO UTC, the same string on every send; bounds max(now − 6 h, `state_since`) … now + 1 min | W2 (`admittedBounds`, `admittedAtOf`, `missing`, `toBody`), W3 (the field, `useBoardNow`), W1 (`stateSince`) |
| D2 | server: zone and +2 min stay in `check_admission`; new `at < now − 6 h` → 422, after `_earlier` | E1 (`BACKDATE_MAX`, `check_admission_time`), E3 (step 5 after the look-up; the resend test) |
| D3 | not before the bed was free: under the lock, AVAILABLE/RESERVED only → 409 `admitted_before_bed_free` | E2 (the code), E3 (step 8; release, reservation, occupied tests) |
| D4 | not before the same person's last discharge → 409 `admitted_before_discharge`; rows without a digest not checked | E2 (the code), E3 (`_last_discharge_of`, step 9; four person tests), E3 (the `models.py` comment) |
| D5 | not editable later: no route, no PATCH | nothing built; the pins of §6 «Pins that stay» unchanged (G1); the guide says it (D1) |
| D6 | audit `admission_datetime` always, `backdated: true` only when sent; the row's `ts` stays the save's | E3 (the payload; two payload pins; the untouched and 2-hour tests) |
| D7 | transfers unchanged; the stay start is the first row, walked back | E4 (the after-a-move test: `stay_start`, `admitted_at`, `open_admissions`, `transfer.stay_began`) |
| D8 | the effects of an earlier start are stated, not engineered | E4 (readers, discharge bound, reconcile, end to end); the card's stamp stays now (E3, the 2-hour test) |
| D9 | the next-protocol typo guard is weakened inside the window only — accepted | E4 (end to end: set A links, set B refused, the untouched control); the guide (D1 Step 1) |

**§3 (server):** §3.1 order → E3 Step 3 and the three order tests; §3.2 codes → E2; §3.3 audit → E3; §3.4 files → E1–E3 (`schemas.py`, `service.py`, `transfer.py` and the stores untouched — «Ground rules»).

**Testing (spec §6), bullet by bullet:**

| Spec §6 | Where |
|---|---|
| `check_admission_time`: exactly now − 6 h passes, 1 µs older 422, None passes, naive `now` ValueError; `BACKDATE_MAX` pinned; the future-bound cases stay on `check_admission` | E1 (`test_admission_form.py`: four tests; `:108–109` and the clock-slack test untouched) |
| untouched: no field, the row's time is the save, payload `admission_datetime` = the row's, no `backdated` | E3 `test_an_untouched_form…` |
| 2 h back: 201, the row and the answer carry it, `backdated: true`, the card identity's `updated_at` is the save | E3 `test_a_time_two_hours_back…` |
| 6 h: 5 h 59 min accepted, 6 h 1 min 422, nothing spent | E3 `test_six_hours_less_a_minute…` |
| the bed: released at T (before → 409, at → 201); RESERVED bound by the reservation's start; OCCUPIED → `bed_not_available` | E3 three bed tests |
| the person: before D → 409, at D → 201; moved-then-discharged binds by its last row; another person binds nothing; a legacy row without a digest binds nothing | E3 four person tests |
| resend after the window: 200 with the same admission; another form under the id `request_conflict` | E3 `test_a_resend_after_the_six_hours…` |
| order: attending before the 7-hour time; open admission before her last discharge; closed bed before its time | E3 three order tests |
| audit payload pins `test_admission_api.py:100–103`, `test_protocol_admission.py:144–146`; the unchanged readers | E3 Step 1 (the two pins; the others listed as checked) |
| stay-start readers on Postgres: `stay_start`, `open_stays`, `open_admissions`, `admitted_at`; after a transfer; `transfer.stay_began` and a discharge between the start and the save; `reconcile` stamps a reading in the window | E4 four tests |
| end to end: set A (1 h) links and is filed with the admission at its time; set B (7 h) `reading_before_stay`; the untouched control | E4 two tests |
| pins that stay (routes, board, tenant isolation, permissions, `EVENT_TYPES`, nginx); `CODES` +2 | «The pins»; E2; G1 |
| dashboard `admitForm.test.js`: the untouched body; touched ISO UTC, twice the same; `freeSince` as written; `missing` past either bound, ahead, never untouched | W2 (seven tests) |
| `AdmitTab.test.jsx`: untouched/touched body; a send with no answer and its resend — same id, same string; `min`/`max`, a bed moves `min`; each of the three refusals: toast, re-read, focus | W3 (nine tests; plus the bounds hold and the draft) |
| `kabul.testutil.js` `bed()` takes `state_since`; `structure.test.js` keeps it; `apiErrors.test.js` the two codes | W1; E2 |
| strings in four languages, the raw-key sweep, 390 and 1440 px, two themes | E2, W2, W3 (`strings.test.js`, `rawKeys.test.jsx`); G2 (the screenshots) |
| gates: engine no-DB, the Postgres subset, dashboard vitest, `vite build` | G1 |
| local walk, five items | G2 |

**Spec §7 (docs)** → D1. **Spec §8 (deploy)** → «Deploy notes for Lane A». **§10 O1** → not built (the guide and the deploy notes say it); **O2** → the guide's «Temizlik bitti» line (D1 Step 1) and the ward note; **O3** → E3 `test_a_reserved_bed…`; **O4** → not built (the person bound reads `discharge_at`); **O5** → «Deploy notes», the roadmap row; **O6** → E3 (the `models.py` comment).

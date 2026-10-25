# Group 2 · G2-A2 — engine debt: a NEWS2 reading counts only inside its window and an assumption is said out loud; audit reads say which end; an unreadable scope is 503; one patient-id rule at /ingest — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The board's NEWS2 and the NEWS2 alert are one score, judged at one instant, and honest about their inputs. A vital older than its window (RR, SpO2, SBP, HR 1 h; temperature 2 h) leaves the total, the score is partial, and the card names the input and its age — "eski veri: SpO2 · 2 sa önce" (az "köhnə məlumat: SpO2 · 2 saat əvvəl"); when a window closes with no new reading, the board is pushed again within one escalation cycle. Uncharted oxygen and consciousness are still scored as room air and Alert, but with a visible «varsayıldı» (az «fərz edildi») mark, not counted partial; a charted value speaks for 8 h. The audit reads say which end they read: `/audit` and `/alarm-quality` the newest rows (the latter says `truncated`), a restart every row, a page at a time. A scope that cannot be read answers 503 «kapsam şu anda okunamıyor» everywhere it used to answer "not found" or "out of scope", and writes no false `scope_denied` row. `/ingest` keys readings and identity by one patient-id rule — stripped, non-blank, at most 128 characters — and answers 400, never 500.

**Architecture:** `rules/news2.py` `score(state, now=None)` gives a vital past its `_NEWS2_FRESHNESS` window 0 points and lists it in `stale` (`partial = missing or stale`), assumes an uncharted or 8 h-old (`_CHARTED_FRESHNESS`) air-or-oxygen or ACVPU and lists it in `assumed`, and returns each of the seven inputs' `measured_at` and `fresh_until`; without `now` nothing ages (the trend charts). `evaluate(state, now)` and `patient_relative.apply(…, now)` score at the reading's own `now` (D6). `api/board.py` judges the card at the wall clock (`patient_board`/`board_snapshot(now=None)`, one instant for the whole card), publishes `stale`, `assumed` and the stamps — never an age — and `freshness_turned(state, since, until)` lets the escalation cycle republish, at its own `now`, a patient one of whose windows closed since the previous cycle. The dashboard's `News2` prints each stale input's age from the stamp against the screen's corrected clock and draws the «varsayıldı» pill. The three audit backends take `newest=` and `after_id=`; `audit.iter_records` pages every row; `/audit` reads newest N (≤ 1000), `/alarm-quality` hands its window to the backend (≤ 20 000, `truncated`), the replay pages every row by 5000. `api/app.py` `_readable(scope)` answers 503 for `UNKNOWN` in `_require_patient`, `/patients`, `/audit` and `/alarm-quality`. `gateway/fhir.py` `patient_id_from` is the id rule, `PATIENT_ID_MAX` moves there, and the Observation, Patient and Encounter parsers use it. No migration; deploy the API and the dashboard in one release (O8).

**Tech Stack:** Python 3.12 (and a 3.14 check), FastAPI, pytest, SQLite and Postgres (SQLAlchemy, psycopg2) audit logs; React 18, Vite, Vitest + Testing Library (`render`, `screen`, `within`, `fireEvent`).

**Spec (authoritative):** `docs/superpowers/specs/2026-10-25-g2a-motor-borcu-design.md` (D1–D15, §3–§8; the clinician-owner's decisions of 2026-10-25: **Q1** — a stale input leaves the total and the card says which input is how old; **Q2** — air and Alert are still assumed, with a visible mark, not partial; a charted O2/ACVPU expires after 8 h; D6 and D8 adopted on the controller's recommendation, the owner shown the consequence — to be confirmed before the VM, O2). Where the code made the spec's letter impossible, unsafe or merely unspecified, this plan departs from it; every departure is in the table below with its reason and its test.

**How the numbers in this plan were obtained.** The plan was written by implementing every task in a scratch worktree from `e1d23d8` (the spec's commit) and replaying its own blocks there. The branch then moved to **`f5b3a8b`** — a merge of main (the deployed NBP slice and G2-A1, `312b1f9`): no file of this slice's code or tests changed (`api/app.py` is byte-identical between the two), but the guide and the roadmap did, and the dashboard gained 21 tests. So the plan was **replayed onto `f5b3a8b`** in a second scratch worktree (`scratch/g2a-a2-replay`, its own `node_modules` junction): every Edit and Write applied in order by a script that asserts each old text occurs exactly once (`CR`/`LF` kept), every command of Tasks 0–8 run as written except the commit blocks (the replay committed each task as `scratch: task N` so the next task starts from it), and every red, green, count and line-end figure below is what that replay printed. The full no-DB engine suite after Tasks 1, 2, 4 and 5 ran in detached worktrees of those commits, beside the replay; the snapshots of Tasks 1 and 2 had no `node_modules` junction, so `tests/test_infinity_transport.py:149` skipped there (`Node and dashboard jsdom required`) — their figures below are a checkout's: the snapshot's passed + 1, skipped − 1 (2292 / 651 and 2303 / 651 as printed). The Postgres baseline ran from a `git archive` export of `f5b3a8b` while the shared database was locked by another lane's run. Task 7's roadmap row was first replayed with its figures as placeholders (it is one line either way, so its line-end count stands) and then written with the measured figures. Finally this document itself — and, separately, the per-task files in order — were replayed whole onto fresh `git archive` exports of `f5b3a8b` (84 blocks, the roadmap's `<range>` filled as Task 7 Step 3 says): both trees are byte-identical to the replay's head `12125c6` in all 32 files the slice touches. Task 8's acceptance ran against the engine's dev server from an export of the replay's head (X7). The code is kept beside the per-task files as `/c/tmp/homunculus-plans/g2a-a2/reference.patch` (`git diff f5b3a8b 12125c6`, 32 files, 1164 insertions, 98 deletions) — a cross-check, not the authority: build from the tasks.

---

## What the code says that the spec did not — departures (read before Task 1)

| # | Spec | Code at `f5b3a8b` / what was found | This plan |
|---|---|---|---|
| X1 | D6: "The labels in `stale_inputs` and the reasoning note stay as they are" | `evaluate`'s partial note names `result.missing` only (`news2.py:212–217`). With D1 a score can be partial for a stale vital alone, and the note would read "This is a partial NEWS2:  not recently recorded". | The partial note names the missing **and** the stale inputs, in breakdown order ("partial NEWS2: spo2, systolic_bp, pulse, temperature not recently recorded"); `stale_inputs` and the "Data recency" note are unchanged. Task 1, `test_the_partial_note_names_a_stale_vital_with_the_missing_ones`, and `test_staleness_structured.py`'s extended assertion. |
| X2 | D3: `patient_board`/`board_snapshot` take `now` for NEWS2; D5: the freshness republish is "built at the cycle's `now`" | `patient_board` also builds the antibiotic clock (`_meds`, `board.py:83`, which already took `now` and defaulted to the wall clock), and the escalation cycle publishes a second kind of board — an escalation change (`app.py:280–283`) — at the wall clock. Two clocks on one card, and two on one cycle. | One instant for the whole card: `patient_board` hands its `now` to `_meds` too (identical for every caller that names no `now`), and the escalation-change publish is judged at the cycle's `now` like the freshness republish; a patient sent for an escalation change is not sent twice. Task 2, `test_a_patient_escalated_in_the_same_cycle_is_published_once_judged_at_the_cycle` (killed both mutants while planning: the board built at the wall clock, the second frame). |
| X3 | D10: seven new strings — `staleMark`, `staleHint`, `assumedMark`, `assumedHint`, `assumedNever`, `assumed.air_or_oxygen`, `assumed.consciousness`; "An expired chart shows 'son kayıt {age}'" | None of the seven names carries the spec's own text "son kayıt {age}"; `assumedNever` is its never-charted counterpart. | **Eight** keys ×4: the seven, and `assumedLast` = tr "son kayıt {age}" (az "son qeyd {age}", ru "последняя запись {age}", en "last charted {age}"). `strings.test.js` is not touched: no new az text equals its tr source, every ru text has Cyrillic. Task 3. |
| X4 | D10: "The card prints `ageText(t, measured_at[name], useBoardNow())`"; §4 lists `BoardState.jsx`, `strings/news2.js`, `board.testutil.js` | `BedCard` is rendered without a `BoardProvider` (its tests, and the board screen, hand it `nowMs`); `useBoardNow` throws without one (`BoardProvider.jsx:17–19`). The bed list's row has no clock at all. | `News2` takes a `nowMs` prop; the bed card, the bed list (`BedList` gains `nowMs`) and the patient screen pass the clock each already reads with `useBoardNow`. Outside §4: `BedCard.jsx`, `BedsScreen.jsx`, `PatientScreen.jsx` (one line each, lane-marked) and a `BedsScreen.test.jsx` test for the list. Task 3. |
| X5 | D14: in the shared `api/patient_identity.py` "A2 touches only the two parse functions (Patient, Encounter), each by one helper call" | The module imports from `gateway/fhir.py` on one line (`:27`); the helper has to be named there. | Three hunks in that file: the import line and the two blank checks, each replaced by one `patient_id_from` call (Task 6 Step 5 and Task 8 Step 5 count them). |
| X6 | §4 Docs: the guide's NEWS2 note and the roadmap row | The guide's patient-screen passage says the screen cannot tell "no such record" from "out of scope" (`docs/homunculus-rehber-TR.md`, "Panoda olmayan bir hasta"); D13 adds a third answer the ward will see. | One sentence there: a scope that cannot be read is "kapsam şu anda okunamıyor", not "not found", and writes no violation (the living-guide rule). Task 7. |
| X7 | §6: the acceptance on the local stack, §6.4 by renaming `staff_scopes` on it | The local Docker stack's container names (`homunculus-postgres`, `-api`, `-web`) were held by another stack (up two days), and only that stack has the Postgres scope reader and a clinician sign-in. | §6.1, 6.2, 6.3 and 6.5 ran on the engine's dev server from an export of the replay's head, with a real stop and start (Task 8 Steps 6–8, the record); §6.4 and the browser walk are written as commands (Steps 9–12) and were **not run** — for the walk with the user. |
| X8 | D11: memory `hits[-limit:]`; D12: `/alarm-quality` "clamps `limit` to 20 000" | `hits[-0:]` is every row, so a newest read of 0 rows would return the whole log; a `limit` of 0 or less on `/alarm-quality` would read nothing (SQLite `LIMIT -1` is no limit at all). | Memory cuts the newest by count (`hits[max(len(hits) - limit, 0):]`, pinned by `test_a_newest_read_of_no_rows_is_empty_not_everything`); both routes clamp from 1 (`/audit` 1…1000, `/alarm-quality` 1…20 000; `test_the_trail_is_capped_and_a_request_cannot_empty_it`). Task 4. |

Departures found while implementing go below X8 (X9 …), each with its file and line.

## Open items

Numbered for this slice (G2-A2 O1 …); G2-A1's O1–O15 and the G2-01 plan's are other items.

| # | Item | Owner | When |
|---|---|---|---|
| O1 | The az, ru and en texts of the eight new strings (`news2.staleMark` … `news2.assumed.*`) are the planner's and await a native reading; tr is the owner's wording («varsayıldı», "son kayıt"). | User | Before deploy |
| O2 | **Q2, D6 and D8 are to be confirmed by the owner before the VM deploy** (spec §7): air and Alert assumed with a mark and not partial; a stale reading can no longer lift NEWS2 into an alert band; an expired "on oxygen" takes 2 points off, an expired V/P/U 3. If the owner declines D6, the recorded alternative is the alert unchanged and the divergence an open item. | Owner | Before the VM |
| O3 | The windows (1 h; temperature 2 h) and the 8 h are operational defaults, not clinical claims; a clinical review may change them (constants in `rules/news2.py`; no vault change). | Clinical review | — |
| O4 | **No `(tenant, patient_id, id)` index.** Measured on a 1 000 000-row SQLite log (Task 4 Step 7): a patient with rows throughout, and the whole trail, answer in milliseconds; a patient with fewer rows than the limit, all old, walks the whole key in ~0.46 s — exactly as today's oldest-first read of that patient does. Revisit if a per-patient read on the VM's Postgres log is slow. | Engine | When measured on the VM |
| O5 | `/ingest` still answers 500 for other malformed Observation fields: a non-object `device` (`fhir.py`'s `.get` on it), a `valueQuantity` that is a string, a non-numeric `value` (`float("abc")` is a `ValueError` the door does not catch). Outside D14, which is about patient ids. | Engine (Lane A) | Next slice |
| O6 | **Rules run only on ingest** (G2-A1's O3): D5 republishes the board, not the rules. An alert raised while a reading was fresh stays until the next reading re-evaluates — then, with D6, the stale reading no longer counts. | — | — |
| O7 | An unreadable scope elsewhere: `/infinity-shadow/board` (shows an empty strip) and `/notifications`' token path; the ticket path is already 503. Spec §8. | — | — |
| O8 | **Deploy the API and the dashboard in one release** (spec §7). An old dashboard on the new API shows «kısmi» for a stale input but no ages and no «varsayıldı»; a new dashboard on an old API finds no `stale`/`assumed` and draws neither. No migration. | Controller | At deploy |
| O9 | **Tell Lane B:** the D11 read contract for its B6 heat map — `records(tenant=, event_type=, since=, newest=True, limit=)` is "the newest N rows of the window, oldest first", no other order promised; and the shared seams this slice touched — `api/patient_identity.py` (three hunks, X5), `api/app.py`'s escalation cycle (`_republish_turned` and its two call lines sit before the retention block B1a edits; the merge rule is the spec's §8). | Controller | Before either lane merges |

---

## Baseline at `f5b3a8b` (measured 2026-10-25)

- **Engine, no database** (`--ignore=tests/test_infinity_vm_pilot.py`, `PYTHONPATH=src`): **2272 passed, 650 skipped, 3 warnings** in ≈ 2 min 20 s in a checkout with the `node_modules` junction.
- **Postgres** (`TEST_DATABASE_URL` on the command line): `test_audit_since.py`, `test_audit_postgres.py`, `test_patient_identity_postgres.py` → **34 passed**.
- **Dashboard:** `npx vitest run` → **89 files / 2432 tests**, all passing. `npx vite build` clean, `precache  20 entries (843.54 KiB)`.
- **Python 3.14:** `/c/tmp/g115-py314/Scripts/python.exe` (3.14.5) runs this worktree's tests with `PYTHONPATH=src`.

## Counts after each task (in plan order)

| After | Engine, no DB (passed / skipped) | Dashboard (files / tests) | This task's test files |
|---|---|---|---|
| base | 2272 / 650 | 89 / 2432 | — |
| 1 | 2293 / 650 | — | `rules/test_news2.py` 65 → **84**, `rules/test_staleness_structured.py` 4 → **4**, `test_pipeline.py` 17 → **19** |
| 2 | 2304 / 650 | — | `test_api_board_news2.py` 11 → **16**; `test_board_freshness.py` new, **6** |
| 3 | — | 89 / 2437 | `BedCard.test.jsx` 34 → **37**, `BedsScreen.test.jsx` 36 → **37**, `PatientScreen.test.jsx` 71 → **72**, `strings.test.js` 7 → **7** |
| 4 | 2325 / 654 | — | `test_audit_newest.py` new, **20** (4 need the database); `test_api_audit.py` 5 → **9**; `test_rehydrate.py` 12 → **13**; Postgres 34 → **52** for its three files (Step 6) |
| 5 | 2339 / 654 | — | `test_api_scope.py` 42 → **56** |
| 6 | 2354 / 654 | — | `test_gateway_fhir.py` 10 → **24**, `test_api_patient_identity.py` 43 → **44** |
| 7 | docs only | — | — |
| 8 | 2354 / 654 (gate) | 89 / 2437 (gate), build 20 | Postgres **54**; Python 3.14, the eleven engine files: **291 passed, 4 skipped** |

Engine arithmetic: 21 + 11 + 21 + 14 + 15 = **82** over the base; the 4 new skips are `test_audit_newest.py`'s Postgres tests. Dashboard: **5** tests, no new file. Measured in the replay onto `f5b3a8b`, 2026-10-25.

---

## Ground rules for every task

- **Your worktree.** `/c/tmp/g2a-a2`, branch `feat/g2a-a2` (at `f5b3a8b` + this plan as its next commit). If the controller gives you a parallel worktree branched from this one, every path below reads that worktree instead. **Never touch `/c/Users/User/Desktop/Project/Homunculus AI`** (the user's main checkout) or another `/c/tmp` worktree. Never `git push`, never deploy, never change anything on a VM. **Never run `git stash`** — the stash is shared with every other worktree and session. If you remove a worktree, unlink its `node_modules` junction first (`cmd //c "rmdir C:\\tmp\\<worktree>\\dashboard\\node_modules"`), then `git worktree remove --force`: a recursive delete that follows the junction empties the shared install. Never reinstall `node_modules`.
- **Write and Edit tools only on repo files — never `sed`, `python`, `node` or a shell heredoc** — with one exception: the two new test files (Tasks 2 and 4) are written with the Write tool and converted to **CRLF** by a one-line Python call that touches only that file (`python -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" <file>`). The tree checks out CRLF (`core.autocrlf=true`); every block here is LF; the Edit tool matches either way. Every Edit's old text is unique in its file at that moment (the replay asserted it). Each task ends by counting the line ends of the files it touched — `CR` must equal `LF`, and both must be the numbers the task gives (a mismatch means a line end was rewritten or an edit landed twice). After editing `strings/*.js` run `npx vitest run src/live/i18n/strings.test.js`: it fails if the Cyrillic or the `ə` was mangled.
- **TDD.** Write the test, run it and **see it red for the reason the task names**, then the code, then green. Put the red in the commit body.
- **Stage explicit paths only** (the task's `git add` line). Before every commit run `git status --short` and `git diff --cached --stat`; if a staged path is not one the task lists, stop and ask.
- **Commit after every task that changes the repo.** Messages are `type(scope): what, in words` and end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```
  (the trailer the controller set for this session; if the controller records a newer one by the time you commit, use that).
- **Foreground gates.** Run every suite and build in the foreground; never background a gate and wait on it. One Bash call runs at most 10 minutes: the whole no-DB suite fits (≈ 2 min 20 s quiet; up to 4 min 40 s while other sessions run their suites). **If a gate runs past 8 minutes**, look for another session's pytest on the machine (`ps -ef | grep pytest`) before suspecting the code: the planner's one stalled run coincided with another session's suite. Stop only your own process.
- **Python commands** (always from the engine directory, always `PYTHONPATH=src`, always name files):
  ```bash
  cd /c/tmp/g2a-a2/homunculus-engine
  PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q <files> 2>&1 | tail -1
  ```
  **Never run `tests/test_infinity_vm_pilot.py`** (it hangs), alone or in a bare `pytest tests/`. The whole no-DB suite: the same command with `--ignore=tests/test_infinity_vm_pilot.py` and no file list. **Never set or export `DATABASE_URL`.** `TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test` goes on the command line of the steps that name it, and only there (Task 0 Step 4, Task 4 Step 6, Task 8 Step 2): the database is shared with Lane B and its conftest serialises runs with an advisory lock — a wait is the lock, not a hang. Never print a token, a key or an env file's values.
- **Dashboard commands** run from `/c/tmp/g2a-a2/dashboard`. The suite and the build are **two separate commands**. The build must print `built in` and `precache  20 entries`, and no `larger than 500 kB`. A test run may print `Warning: An update to … inside a test was not wrapped in act(...)`; it is not a failure.
- **Line-end count:** each task gives its command (`tr -cd '\r' | wc -c` against `tr -cd '\n' | wc -c` per file).
- **No patient data, ever** (CLAUDE.md rule 6). Beds `bed-1`, `bed-3`, `p-a1`, `G2A-1`, `G2A2-1` …; every value is made up and says nothing about anyone.
- **The clinical rule lives in the engine.** Which input is stale, which is assumed, and for how long a charted value speaks are `rules/news2.py`'s (`_NEWS2_FRESHNESS`, `_CHARTED_FRESHNESS`); the dashboard decides nothing clinical — it prints the engine's `stale` and `assumed` and states an age (`freshness.js`'s rule). The 8 h figure is never on the screen.
- **Lane B's seams are not touched:** `dashboard/src/live/i18n/catalog.js`, `routes.js` SCREENS, `strings.test.js`, the permissions catalogue; `admission/`, `escalation/router.py`, `scope/`, `tenant/`, `auth/` (Task 8 Step 5 checks). In the shared `api/patient_identity.py` only the import line and the two parse functions change (X5, D14). Every A2 block in a shared file is lane-marked — `# G2-A2` in Python, `// G2-A2` or `{/* G2-A2 … */}` in the dashboard (D15). If a review forces another seam, add a blank-separated block marked the same way and tidy nothing around it.
- **Four languages for every key** (`tr` is the source; `az` the default). An `az` text equal to `tr`, or an `ru` text with no Cyrillic, needs a reviewed entry in `strings.test.js` — none of this slice's does. Russian calls the engine "система", never "движок".
- **Test names:** `describe` names the thing, `it` is a sentence about its behaviour in the reader's terms.

---

## File map

**Create — engine:** `homunculus-engine/tests/test_board_freshness.py` (Task 2) · `homunculus-engine/tests/test_audit_newest.py` (Task 4).

**Modify — engine** (`homunculus-engine/`)

| File | Change | Task |
|---|---|---|
| `src/homunculus/rules/news2.py` | the `datetime` import moved up; `_INPUT_SIGNAL`; `News2Result.stale/assumed/measured_at/fresh_until`, `partial = missing or stale`; `score(state, now=None)`; `_CHARTED_FRESHNESS`; `_ASSUMED_AS`; `evaluate` scores at `now`, the partial note (X1) and the assumed note; `_val` removed (`score` was its only caller) | 1 |
| `src/homunculus/rules/patient_relative.py`, `src/homunculus/pipeline.py` | `apply(…, now=None)`; the engine passes its `now` (D6) | 1 |
| `tests/rules/test_news2.py`, `tests/rules/test_staleness_structured.py`, `tests/test_pipeline.py` | freshness, assumed, the alert's same score | 1 |
| `src/homunculus/api/board.py` | `_iso`; `_news2(state, now)` with `stale`, `assumed`, `measured_at`, `fresh_until`; `freshness_turned`; `patient_board`/`board_snapshot(now=None)`, `_meds` at the same `now` (X2) | 2 |
| `src/homunculus/api/app.py` | the cycle's `freshness_since`, `_republish_turned`, the escalation publish at the cycle's `now` (Task 2); `iter_records`, `AUDIT_LIMIT_MAX`, `ALARM_QUALITY_LIMIT_MAX`, `REHYDRATE_PAGE`, `_ensure`, `/audit`, `/alarm-quality` (Task 4); `_readable`, `_require_patient`, `/patients`, trends, the whole-trail routes (Task 5); `PATIENT_ID_MAX` imported (Task 6) | 2, 4, 5, 6 |
| `tests/test_api_board_news2.py` | `_board(now=WHEN)`; five tests | 2 |
| `src/homunculus/api/audit.py`, `src/homunculus/api/audit_postgres.py`, `src/homunculus/api/rehydrate.py` | `newest=`, `after_id=`, `_one_order`, `iter_records`; any iterable replayed | 4 |
| `tests/test_api_audit.py`, `tests/test_rehydrate.py` | the newest trail and its cap, the alarm report's window and `truncated`; the paged restart | 4 |
| `tests/test_api_scope.py` | the class `TestJAnUnreadableScopeIsUnavailableNotNotFound` | 5 |
| `src/homunculus/gateway/fhir.py`, `src/homunculus/api/patient_identity.py` | `PATIENT_ID_MAX`, `patient_id_from`, the Observation's subject; the two identity parsers (X5) | 6 |
| `tests/test_gateway_fhir.py`, `tests/test_api_patient_identity.py` | the id rule, the door's 400, the protocol number's cap | 6 |

**Modify — dashboard** (`dashboard/src/`)

| File | Change | Task |
|---|---|---|
| `live/screens/common/BoardState.jsx` | `News2({ news2, nowMs })`: the stale line with ages, the «varsayıldı» pill (D10) | 3 |
| `live/i18n/strings/news2.js` | eight keys ×4 (X3) | 3 |
| `live/screens/beds/BedCard.jsx`, `live/screens/beds/BedsScreen.jsx`, `live/screens/patient/PatientScreen.jsx` | each passes its `nowMs` (X4) | 3 |
| `live/data/board.testutil.js` | the `news2` fixture's new keys | 3 |
| `live/screens/beds/BedCard.test.jsx`, `live/screens/beds/BedsScreen.test.jsx`, `live/screens/patient/PatientScreen.test.jsx` | five tests | 3 |

**Modify — docs** (Task 7): `docs/homunculus-rehber-TR.md` (the NEWS2 note; one sentence in "Panoda olmayan bir hasta", X6), `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` (the row G2-A2). `Homunculus/wiki` is untouched (no clinical claim changes).

**Outside the repo:** `/c/tmp/homunculus-plans/g2a-a2/acceptance.py` (Task 8), `reference.patch`.

**How an edit reads in this plan:** a bold **Edit** with the file's path and "replace:", a fenced block with the exact old text, "with:", and a fenced block with the new text. Use the Edit tool with those two texts, in the order given. A bold **Write** gives a new file's whole text.

---

### Task 0: The worktree, the shared install and the baseline

Nothing is changed in the repo. The point is to know, before Task 1, that the tree is the plan's and that every gate is green with the numbers the counts table starts from.

**Files:** none in the repo; the junction `dashboard/node_modules` → `C:\tmp\homunculus-g1\dashboard\node_modules` (ignored by `dashboard/.gitignore`; already in place in `/c/tmp/g2a-a2` when this plan was written).

- [ ] **Step 1: The tree is the plan's**

```bash
cd /c/tmp/g2a-a2
git branch --show-current
git status --short
git log --oneline -3
```

Expected: `feat/g2a-a2`; no status line; the top commit is this plan (`docs(plan): G2-A2 — …`), then `f5b3a8b Merge branch 'main' into feat/g2a-a2`, then `312b1f9 merge: G2-A1 (alerts end with their rule; critical latch; escalation chain) into main, on top of the deployed NBP slice`. Anything else: stop and ask.

- [ ] **Step 2: The shared install, by junction (never reinstall)**

```bash
cd /c/tmp/g2a-a2
test -e dashboard/node_modules || cmd //c "mklink /J C:\\tmp\\g2a-a2\\dashboard\\node_modules C:\\tmp\\homunculus-g1\\dashboard\\node_modules"
ls dashboard/node_modules/.bin/vitest && git status --short
```

Expected: nothing from the first line (the junction is there) — or `Junction created for …`; then the `vitest` path, and still no status line. The junction also matters to the engine suite: `tests/test_infinity_transport.py:149` runs the dashboard under Node and skips without it (`Node and dashboard jsdom required`), which moves one test from passed to skipped.

- [ ] **Step 3: The engine, no database**

```bash
cd /c/tmp/g2a-a2/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -1
```

Expected (≈ 2 min 20 s on a quiet machine): `2272 passed, 650 skipped, 3 warnings in …`.

- [ ] **Step 4: The Postgres-backed tests this slice touches** — the audit log's and the identity store's. The URL is set on this command line only, never exported; the database is `homunculus_test` in the container `homunculus-test-pg-56` (port 56432), shared with Lane B.

```bash
docker ps --format '{{.Names}} {{.Status}}' | grep homunculus-test-pg-56
cd /c/tmp/g2a-a2/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_audit_since.py tests/test_audit_postgres.py tests/test_patient_identity_postgres.py 2>&1 | tail -1
```

Expected: `homunculus-test-pg-56 Up …`; then `34 passed in …` (21 + 11 + 2). `tests/conftest.py` holds a session advisory lock on that database: if Lane B is running its own database tests the run first prints `waiting for another test run on database 'homunculus_test' to finish (advisory lock 0x486f6d756e63)` and waits — that is the lock working, not a hang (the planner's run waited about ten minutes). If the container is not up, stop and ask; do not start one.

- [ ] **Step 5: The dashboard suite**

```bash
cd /c/tmp/g2a-a2/dashboard
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
```

Expected: ` Test Files  89 passed (89)` and `      Tests  2432 passed (2432)`.

- [ ] **Step 6: The build**

```bash
cd /c/tmp/g2a-a2/dashboard
npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
```

Expected: `✓ built in …` and `precache  20 entries (843.54 KiB)` (the replay's figure); no `larger than`. (`dist/` is ignored.)

- [ ] **Step 7: The test files this slice touches, and which of them need a database**

```bash
cd /c/tmp/g2a-a2/homunculus-engine
for f in rules/test_news2 rules/test_staleness_structured test_pipeline test_api_board_news2 test_api_audit test_rehydrate test_api_scope test_gateway_fhir test_api_patient_identity; do printf "%s " $f; PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q --co tests/$f.py 2>&1 | tail -1; done
grep -ln "TEST_DATABASE_URL\|requires_db" tests/rules/test_news2.py tests/rules/test_staleness_structured.py tests/test_pipeline.py tests/test_api_board_news2.py tests/test_api_audit.py tests/test_rehydrate.py tests/test_api_scope.py tests/test_gateway_fhir.py tests/test_api_patient_identity.py; echo "grep exit $?"
cd /c/tmp/g2a-a2/dashboard
npx vitest run src/live/screens/beds/BedCard.test.jsx src/live/screens/beds/BedsScreen.test.jsx src/live/screens/patient/PatientScreen.test.jsx src/live/i18n/strings.test.js 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "✓ |^ +Tests "
```

Expected: `rules/test_news2 65`, `rules/test_staleness_structured 4`, `test_pipeline 17`, `test_api_board_news2 11`, `test_api_audit 5`, `test_rehydrate 12`, `test_api_scope 42`, `test_gateway_fhir 10`, `test_api_patient_identity 43` (`… tests collected in …`); `grep exit 1` (of the slice's two new engine files, only `test_audit_newest.py` reads the database, and it skips without it); then `strings.test.js (7 tests)`, `BedCard.test.jsx (34 tests)`, `BedsScreen.test.jsx (36 tests)`, `PatientScreen.test.jsx (71 tests)`, `Tests  148 passed (148)`.

No commit: Task 0 changes nothing in the repo.

---

### Task 1: The engine — a reading counts only inside its window; an uncharted input is assumed, out loud

Spec D1, D2, D6, D7, D8, D9. `score(state, now=None)` judges each input's age at `now`: a vital older than its `_NEWS2_FRESHNESS` window (RR, SpO2, SBP, HR 1 h; temperature 2 h) scores 0 and is listed in `stale`, and the score is partial (`partial = missing or stale`); an air-or-oxygen or ACVPU value charted more than `_CHARTED_FRESHNESS` (8 h) ago is assumed again, and every assumption — uncharted or expired — is listed in `assumed`, which does **not** make the score partial. An age equal to the window is fresh (`age > window`, as `_stale_vital_labels`); a reading stamped after `now` never ages. Without `now` nothing ages (D2: `api/trends.py:154` keeps calling it so). `measured_at` and `fresh_until` name all seven inputs either way. `evaluate(state, now)` scores at its `now` (D6) — a stale vital can no longer lift NEWS2 into an alert band — names a stale vital in its partial note with the missing ones (X1), and gains one line naming the assumed inputs (D7); `stale_inputs` and the recency note are unchanged. `patient_relative.apply` gets the same `now` from `pipeline.py` (D6), so a stale vital is no "acute contributor" either. "New confusion" is not modelled (D9): any ACVPU ≥ 1 still scores 3 (`test_score_new_confusion_scores_three` is unchanged).

The rules, each held by a test below:
- SBP 88 measured 61 min before `now` scores 0, is `stale`, makes the score partial; a vital never measured stays in `missing`;
- 60:00 is fresh and 60:01 stale (RR, HR); the temperature is fresh at 2:00:00 and stale at 2:00:01; a reading three hours in the future is not stale;
- without `now` nothing ages, and a charted oxygen still scores 2 after 9 h;
- `measured_at`/`fresh_until` carry the breakdown's seven names in its order; `fresh_until` is the reading's time plus its window, None when never measured;
- charted oxygen scores 2 at 7 h 59 min and at 8 h 00 min, and is assumed air (0) at 8 h 01 min; ACVPU 3 charted 9 h ago is assumed Alert (0); `partial` stays false when only `assumed` is set;
- the alert no longer fires on a four-hour-old SBP 88 (D6), still fires without `now`; its partial note lists a stale vital with the missing ones in breakdown order (X1); its reasoning names the assumptions (D7);
- through the engine: SBP 88 raises NEWS2 at T0 and no longer at +4 h; with a charted RR baseline, a four-hour-old SBP 88 is no acute contributor, so the alert is downgraded (D6 in `patient_relative`).

Scenario cadence (spec §5, measured): `news2_deterioration.yaml` and `news2_partial_nce_only.yaml` read every vital each hour, so at each hourly evaluation the previous hour's readings are exactly 60:00 old — fresh by D1's own boundary — and `test_scenario_news2.py` scores without `now`; the sepsis scenarios (`septic_shock.yaml`, `under_resuscitated.yaml`, `stable_control.yaml`) assert sepsis-branch kinds. No scenario's timestamps change: Step 5 runs the three scenario files unchanged and green.

**Files:**
- Modify: `homunculus-engine/tests/rules/test_news2.py` (an import, one assertion pair, a section appended)
- Modify: `homunculus-engine/tests/rules/test_staleness_structured.py` (one test's assertions)
- Modify: `homunculus-engine/tests/test_pipeline.py` (two tests appended)
- Modify: `homunculus-engine/src/homunculus/rules/news2.py` (the import moved up, `_INPUT_SIGNAL`, `News2Result`, `score`, `_CHARTED_FRESHNESS`, `_ASSUMED_AS`, `evaluate`; `_val` removed — `score` was its only caller)
- Modify: `homunculus-engine/src/homunculus/rules/patient_relative.py` (an import, `apply`'s `now`)
- Modify: `homunculus-engine/src/homunculus/pipeline.py` (one call)

- [ ] **Step 1: Write the failing tests**

**Edit** `homunculus-engine/tests/rules/test_news2.py` — replace:
```python
from datetime import datetime, timezone

import pytest
```
with:
```python
from datetime import datetime, timedelta, timezone

import pytest
```

**Edit** `homunculus-engine/tests/rules/test_news2.py` — replace:
```python
    assert "air_or_oxygen" not in r.missing
    assert "consciousness" not in r.missing
```
with:
```python
    assert "air_or_oxygen" not in r.missing
    assert "consciousness" not in r.missing
    # G2-A2 (D7): assumed, and said so — but not partial.
    assert r.assumed == ["air_or_oxygen", "consciousness"]
    assert r.partial is False
```

**Edit** `homunculus-engine/tests/rules/test_news2.py` — replace:
```python
def test_evaluate_partial_score_is_flagged_in_reasoning():
    # only RR present but it alone hits a red 3 (RR 28) -> fires, reasoning notes partial
    findings = news2.evaluate(_state(RESP_RATE=28))
    assert len(findings) == 1
    assert "partial" in findings[0].reasoning.lower()
```
with:
```python
def test_evaluate_partial_score_is_flagged_in_reasoning():
    # only RR present but it alone hits a red 3 (RR 28) -> fires, reasoning notes partial
    findings = news2.evaluate(_state(RESP_RATE=28))
    assert len(findings) == 1
    assert "partial" in findings[0].reasoning.lower()


# --- G2-A2: a reading counts only inside its window; an uncharted input is assumed, out loud ----
#
# score(state, now) judges each input's age at `now` (D1): a vital older than its window (1 h; the
# temperature 2 h) scores 0 and is `stale`, and the score is partial. An air-or-oxygen or ACVPU
# value speaks for 8 h after it was charted (D8); uncharted or expired it is assumed — air, Alert —
# and listed in `assumed`, which does not make the score partial (D7). Without `now` nothing ages.

FIVE = dict(RESP_RATE=16, SPO2=98, SBP=120, HEART_RATE=70, TEMPERATURE=37.0)


def _aged(ages: dict, **values):
    """A state measured at T0, except each signal in `ages` ({code: how long before T0})."""
    st = PatientState("bed-9")
    for code, value in values.items():
        at = T0 - ages.get(code, timedelta(0))
        st.ingest(Observation("bed-9", SignalCode[code], value, "u", at, "dev"))
    return st


def test_a_stale_vital_scores_nothing_and_makes_the_score_partial():
    # SBP 88 would score 3; measured 61 min before `now` it is outside its 1 h window.
    r = news2.score(_aged({"SBP": timedelta(minutes=61)}, **{**FIVE, "SBP": 88}), T0)
    assert r.breakdown["systolic_bp"] == 0
    assert r.stale == ["systolic_bp"]
    assert r.missing == []
    assert r.partial is True
    assert (r.total, r.red_param) == (0, False)


def test_a_vital_never_measured_stays_missing_not_stale():
    r = news2.score(_aged({"SBP": timedelta(minutes=61)}, RESP_RATE=16, SBP=120), T0)
    assert r.missing == ["spo2", "pulse", "temperature"]
    assert r.stale == ["systolic_bp"]


@pytest.mark.parametrize("code,name,age,stale", [
    ("RESP_RATE", "respiration_rate", timedelta(minutes=60), False),
    ("RESP_RATE", "respiration_rate", timedelta(minutes=60, seconds=1), True),
    ("HEART_RATE", "pulse", timedelta(minutes=60), False),
    ("HEART_RATE", "pulse", timedelta(minutes=60, seconds=1), True),
    ("TEMPERATURE", "temperature", timedelta(hours=1, minutes=59), False),
    ("TEMPERATURE", "temperature", timedelta(hours=2), False),
    ("TEMPERATURE", "temperature", timedelta(hours=2, seconds=1), True),
])
def test_an_age_equal_to_the_window_is_still_fresh(code, name, age, stale):
    r = news2.score(_aged({code: age}, **FIVE), T0)
    assert (name in r.stale) is stale
    assert r.stale == ([name] if stale else [])


def test_a_reading_stamped_after_now_is_never_stale():
    r = news2.score(_aged({"SBP": -timedelta(hours=3)}, **{**FIVE, "SBP": 88}), T0)
    assert r.stale == [] and r.breakdown["systolic_bp"] == 3


def test_without_now_nothing_ages():
    st = _aged({"SBP": timedelta(hours=4), "SUPPLEMENTAL_OXYGEN": timedelta(hours=9)},
               **{**FIVE, "SBP": 88}, SUPPLEMENTAL_OXYGEN=1.0)
    r = news2.score(st)
    assert r.stale == [] and r.breakdown["systolic_bp"] == 3
    assert r.breakdown["air_or_oxygen"] == 2 and r.assumed == ["consciousness"]


def test_measured_at_and_fresh_until_name_all_seven_inputs():
    st = _aged({"TEMPERATURE": timedelta(minutes=30)}, **FIVE, SUPPLEMENTAL_OXYGEN=1.0)
    r = news2.score(st, T0)
    assert list(r.measured_at) == list(r.breakdown) == list(r.fresh_until)
    assert r.measured_at["temperature"] == T0 - timedelta(minutes=30)
    assert r.fresh_until["temperature"] == T0 + timedelta(minutes=90)     # its 2 h window
    assert r.fresh_until["pulse"] == T0 + timedelta(hours=1)
    assert r.fresh_until["air_or_oxygen"] == T0 + timedelta(hours=8)
    assert (r.measured_at["consciousness"], r.fresh_until["consciousness"]) == (None, None)


@pytest.mark.parametrize("age,points,assumed", [
    (timedelta(hours=7, minutes=59), 2, []),
    (timedelta(hours=8), 2, []),
    (timedelta(hours=8, minutes=1), 0, ["air_or_oxygen"]),
])
def test_charted_oxygen_speaks_for_eight_hours_then_air_is_assumed_again(age, points, assumed):
    st = _aged({"SUPPLEMENTAL_OXYGEN": age}, **FIVE, SUPPLEMENTAL_OXYGEN=1.0, ACVPU=0)
    r = news2.score(st, T0)
    assert r.breakdown["air_or_oxygen"] == points
    assert r.assumed == assumed
    assert r.partial is False


def test_an_acvpu_charted_nine_hours_ago_is_assumed_alert():
    st = _aged({"ACVPU": timedelta(hours=9)}, **FIVE, ACVPU=3, SUPPLEMENTAL_OXYGEN=0)
    r = news2.score(st, T0)
    assert r.breakdown["consciousness"] == 0
    assert r.assumed == ["consciousness"]
    assert (r.partial, r.red_param) == (False, False)


def test_the_alert_scores_what_the_board_scores():
    # D6: SBP 88 four hours old would be a single red parameter; judged at `now` it is out.
    st = _aged({"SBP": timedelta(hours=4)}, **{**FIVE, "SBP": 88})
    assert news2.evaluate(st, T0) == []
    assert [f.kind for f in news2.evaluate(st)] == ["news2"]     # without `now`, as before


def test_the_partial_note_names_a_stale_vital_with_the_missing_ones():
    [f] = news2.evaluate(_aged({"SBP": timedelta(hours=4)}, RESP_RATE=28, SBP=120), T0)
    assert "partial NEWS2: spo2, systolic_bp, pulse, temperature not recently recorded" in f.reasoning


def test_the_alert_says_what_it_assumed_and_is_not_partial_for_it():
    [f] = news2.evaluate(_state(**{**FIVE, "RESP_RATE": 28}), T0)
    assert f.reasoning.endswith(
        " Assumed, nothing current charted: air_or_oxygen as room air, consciousness as Alert.")
    assert "partial" not in f.reasoning.lower()
```

**Edit** `homunculus-engine/tests/rules/test_staleness_structured.py` — replace:
```python
    n = next(f for f in findings if f.kind == "news2")
    assert any("systolic" in s.lower() for s in n.stale_inputs)
    assert "recency" in n.reasoning.lower()
```
with:
```python
    n = next(f for f in findings if f.kind == "news2")
    assert any("systolic" in s.lower() for s in n.stale_inputs)
    assert "recency" in n.reasoning.lower()
    # G2-A2 (D6): the four-hour-old pressure is out of the total — RR's 3 alone still fires it (a
    # single parameter at the maximum) — and the score says it is partial for it.
    assert n.summary.startswith("NEWS2 3 ")
    assert "partial NEWS2: spo2, systolic_bp, pulse, temperature" in n.reasoning
```

**Edit** `homunculus-engine/tests/test_pipeline.py` — replace:
```python
    assert "sepsis" not in _kinds(eng), "SOFA 4 over a charted baseline of 4 is no rise"
    assert {"septic_shock", "antibiotic_overdue"} <= _kinds(eng)
    assert eng.recognized_at("bed-3") == T0
```
with:
```python
    assert "sepsis" not in _kinds(eng), "SOFA 4 over a charted baseline of 4 is no rise"
    assert {"septic_shock", "antibiotic_overdue"} <= _kinds(eng)
    assert eng.recognized_at("bed-3") == T0


# --- G2-A2 (D6): the alert judges NEWS2 at the reading's own `now`, as the board does -------------

def test_a_pressure_four_hours_old_no_longer_raises_news2():
    eng = Engine()
    o = _obs(SignalCode.SBP, 88)                 # 3 points, a single red parameter, at T0
    assert {a.kind for a in eng.ingest(o, now=o.timestamp)} == {"news2"}
    o = _obs(SignalCode.HEART_RATE, 72, minute=240)
    assert eng.ingest(o, now=o.timestamp) == [], "at +4 h the pressure is out of the total"


def test_the_patient_relative_layer_judges_the_same_instant():
    # RR 26 inside the patient's charted 24-28 is chronic; the four-hour-old SBP 88 is no
    # contributor at `now`, so every point left is explained and the alert is downgraded. Judged
    # without `now`, the old pressure read as an acute contributor and kept the alert alarming.
    from homunculus.state.profile import BaselineRange, PatientProfile
    eng = Engine()
    eng.set_profile(PatientProfile("bed-3", baselines={SignalCode.RESP_RATE: BaselineRange(24, 28)}))
    for o in [_obs(SignalCode.SBP, 88), _obs(SignalCode.RESP_RATE, 26, minute=240)]:
        eng.ingest(o, now=o.timestamp)
    [alert] = eng.active_alerts("bed-3")
    assert (alert.kind, alert.severity, alert.downgraded) == ("news2", "low", True)
```

- [ ] **Step 2: Run them, and see them fail for the reasons named**

```bash
cd /c/tmp/g2a-a2/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/rules/test_news2.py tests/rules/test_staleness_structured.py tests/test_pipeline.py 2>&1 | tail -1
```

Expected: `23 failed, 84 passed in …` — `score()` takes no `now` (`TypeError: score() takes 1 positional argument but 2 were given`), `News2Result` has no `assumed`/`stale`/`measured_at`, the alert still fires on the old pressure ("NEWS2 6 — medium risk"), and the downgrade test sees `("news2", "moderate", False)`.

- [ ] **Step 3: The score**

**Edit** `homunculus-engine/src/homunculus/rules/news2.py` — replace:
```python
from dataclasses import dataclass, field

from homunculus.canonical import SignalCode
```
with:
```python
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from homunculus.canonical import SignalCode
```

**Edit** `homunculus-engine/src/homunculus/rules/news2.py` — replace:
```python
_CORE_VITALS = ("respiration_rate", "spo2", "systolic_bp", "pulse", "temperature")


@dataclass(frozen=True)
class News2Result:
    total: int
    breakdown: dict[str, int]      # parameter name -> points
    missing: list[str] = field(default_factory=list)   # core vitals with no observation
    red_param: bool = False        # any single parameter scored the maximum 3

    @property
    def partial(self) -> bool:
        return bool(self.missing)


def _val(state: PatientState, code: SignalCode) -> float | None:
    obs = state.latest(code)
    return None if obs is None else obs.value


def score(state: PatientState) -> News2Result:
    """Aggregate NEWS2 (Scale 1) from current state.

    Air-or-oxygen defaults to air (0) and consciousness to Alert (0) when not
    recorded — the benign, overwhelmingly-common case, and neither is derivable
    from monitor telemetry. Only the five continuous vitals are treated as
    'missing' when absent, so a partial aggregate is never shown as complete.
    """
    breakdown: dict[str, int] = {}
    missing: list[str] = []

    def core(name: str, code: SignalCode, fn) -> None:
        v = _val(state, code)
        if v is None:
            breakdown[name] = 0
            missing.append(name)
        else:
            breakdown[name] = fn(v)

    core("respiration_rate", SignalCode.RESP_RATE, resp_rate_points)
    core("spo2", SignalCode.SPO2, spo2_scale1_points)
    core("systolic_bp", SignalCode.SBP, systolic_bp_points)
    core("pulse", SignalCode.HEART_RATE, pulse_points)
    core("temperature", SignalCode.TEMPERATURE, temperature_points)

    breakdown["air_or_oxygen"] = air_or_oxygen_points(
        on_oxygen=(_val(state, SignalCode.SUPPLEMENTAL_OXYGEN) or 0.0) >= 1.0
    )
    breakdown["consciousness"] = consciousness_points(_val(state, SignalCode.ACVPU) or 0.0)

    total = sum(breakdown.values())
    red_param = any(p >= 3 for p in breakdown.values())
    return News2Result(total=total, breakdown=breakdown, missing=missing, red_param=red_param)
```
with:
```python
_CORE_VITALS = ("respiration_rate", "spo2", "systolic_bp", "pulse", "temperature")

# The seven inputs by the names score() puts in its breakdown, and the signal each reads (G2-A2):
# the five vitals, then the two a clinician charts.
_INPUT_SIGNAL: dict[str, SignalCode] = {
    "respiration_rate": SignalCode.RESP_RATE, "spo2": SignalCode.SPO2,
    "systolic_bp": SignalCode.SBP, "pulse": SignalCode.HEART_RATE,
    "temperature": SignalCode.TEMPERATURE,
    "air_or_oxygen": SignalCode.SUPPLEMENTAL_OXYGEN, "consciousness": SignalCode.ACVPU,
}


@dataclass(frozen=True)
class News2Result:
    total: int
    breakdown: dict[str, int]      # parameter name -> points
    missing: list[str] = field(default_factory=list)   # core vitals with no observation
    red_param: bool = False        # any single parameter scored the maximum 3
    # G2-A2 (D1, D4, D7). `stale`: core vitals whose last reading is older than its window at
    # `now`, scored 0 like a missing one. `assumed`: air-or-oxygen and consciousness scored as air
    # and Alert because nothing current is charted — not partial. `measured_at`: when each of the
    # seven inputs was last read, None if never; `fresh_until`: that instant plus the input's
    # window, None if never — in the past for a stale or expired input.
    stale: list[str] = field(default_factory=list)
    assumed: list[str] = field(default_factory=list)
    measured_at: dict[str, datetime | None] = field(default_factory=dict)
    fresh_until: dict[str, datetime | None] = field(default_factory=dict)

    @property
    def partial(self) -> bool:
        # A stale vital is as absent from the total as a missing one (G2-A2, D1): either way the
        # aggregate can only understate.
        return bool(self.missing or self.stale)


def score(state: PatientState, now: datetime | None = None) -> News2Result:
    """Aggregate NEWS2 (Scale 1) from current state.

    Air-or-oxygen defaults to air (0) and consciousness to Alert (0) when not
    recorded — the benign, overwhelmingly-common case, and neither is derivable
    from monitor telemetry. Only the five continuous vitals are treated as
    'missing' when absent, so a partial aggregate is never shown as complete.

    G2-A2. With `now`, a reading speaks for the patient only inside its window (D1): a vital older
    than its `_NEWS2_FRESHNESS` window scores 0 and is listed in `stale`, so the score is partial;
    an air-or-oxygen or ACVPU value charted more than `_CHARTED_FRESHNESS` ago is assumed again
    (D8). Every default is listed in `assumed` and does not make the score partial (D7). An age
    equal to the window is still fresh, and a reading stamped after `now` never ages. Without
    `now` nothing ages (D2): the trend charts read what each value scores, not its share of the
    total. `measured_at` and `fresh_until` name all seven inputs either way (D4).
    """
    breakdown: dict[str, int] = {}
    missing: list[str] = []
    stale: list[str] = []
    assumed: list[str] = []
    measured_at: dict[str, datetime | None] = {}
    fresh_until: dict[str, datetime | None] = {}

    def latest(name: str, window: timedelta) -> tuple[float | None, bool]:
        """The input's last value (None if never), and whether it is older than `window` at `now`."""
        obs = state.latest(_INPUT_SIGNAL[name])
        measured_at[name] = None if obs is None else obs.timestamp
        fresh_until[name] = None if obs is None else obs.timestamp + window
        if obs is None:
            return None, False
        return obs.value, now is not None and now - obs.timestamp > window

    def core(name: str, fn) -> None:
        v, aged = latest(name, _NEWS2_FRESHNESS[_INPUT_SIGNAL[name]])
        if v is None:
            breakdown[name] = 0
            missing.append(name)
        elif aged:
            breakdown[name] = 0
            stale.append(name)
        else:
            breakdown[name] = fn(v)

    def charted(name: str) -> float:
        v, aged = latest(name, _CHARTED_FRESHNESS[_INPUT_SIGNAL[name]])
        if v is None or aged:
            assumed.append(name)
            return 0.0
        return v

    core("respiration_rate", resp_rate_points)
    core("spo2", spo2_scale1_points)
    core("systolic_bp", systolic_bp_points)
    core("pulse", pulse_points)
    core("temperature", temperature_points)

    breakdown["air_or_oxygen"] = air_or_oxygen_points(on_oxygen=charted("air_or_oxygen") >= 1.0)
    breakdown["consciousness"] = consciousness_points(charted("consciousness"))

    total = sum(breakdown.values())
    red_param = any(p >= 3 for p in breakdown.values())
    return News2Result(total=total, breakdown=breakdown, missing=missing, red_param=red_param,
                       stale=stale, assumed=assumed, measured_at=measured_at,
                       fresh_until=fresh_until)
```

**Edit** `homunculus-engine/src/homunculus/rules/news2.py` — replace:
```python
# NEWS2 inputs are all continuous vitals — they go stale in minutes, not hours. Operational
# data-recency defaults (configurable), not clinical claims (mirrors the SOFA staleness approach).
from datetime import datetime, timedelta  # noqa: E402

_NEWS2_FRESHNESS: dict[SignalCode, timedelta] = {
    SignalCode.RESP_RATE: timedelta(hours=1), SignalCode.SPO2: timedelta(hours=1),
    SignalCode.SBP: timedelta(hours=1), SignalCode.HEART_RATE: timedelta(hours=1),
    SignalCode.TEMPERATURE: timedelta(hours=2),
}
_VITAL_LABEL: dict[SignalCode, str] = {
    SignalCode.RESP_RATE: "resp rate", SignalCode.SPO2: "SpO2", SignalCode.SBP: "systolic BP",
    SignalCode.HEART_RATE: "pulse", SignalCode.TEMPERATURE: "temperature",
}
```
with:
```python
# NEWS2 inputs are all continuous vitals — they go stale in minutes, not hours. Operational
# data-recency defaults (configurable), not clinical claims (mirrors the SOFA staleness approach).
# Since G2-A2 (D1) a vital older than its window leaves the total (`score(state, now)`).
_NEWS2_FRESHNESS: dict[SignalCode, timedelta] = {
    SignalCode.RESP_RATE: timedelta(hours=1), SignalCode.SPO2: timedelta(hours=1),
    SignalCode.SBP: timedelta(hours=1), SignalCode.HEART_RATE: timedelta(hours=1),
    SignalCode.TEMPERATURE: timedelta(hours=2),
}
# The two inputs a clinician charts and no monitor sends (G2-A2, D8): a charted oxygen or ACVPU
# speaks for one nursing shift, then the input is assumed again (air, Alert) and says so.
# Operational defaults like the windows above, not clinical claims. The clock runs from the
# observation's own time — the chart's `recorded_at`.
_CHARTED_FRESHNESS: dict[SignalCode, timedelta] = {
    SignalCode.SUPPLEMENTAL_OXYGEN: timedelta(hours=8), SignalCode.ACVPU: timedelta(hours=8),
}
_VITAL_LABEL: dict[SignalCode, str] = {
    SignalCode.RESP_RATE: "resp rate", SignalCode.SPO2: "SpO2", SignalCode.SBP: "systolic BP",
    SignalCode.HEART_RATE: "pulse", SignalCode.TEMPERATURE: "temperature",
}
# What an assumed input was scored as, in the alert's reasoning (G2-A2, D7).
_ASSUMED_AS: dict[str, str] = {
    "air_or_oxygen": "air_or_oxygen as room air", "consciousness": "consciousness as Alert",
}
```

**Edit** `homunculus-engine/src/homunculus/rules/news2.py` — replace:
```python
def evaluate(state: PatientState, now: datetime | None = None) -> list[Finding]:
    result = score(state)
    band = _band(result)
```
with:
```python
def evaluate(state: PatientState, now: datetime | None = None) -> list[Finding]:
    # The board's score, judged at the same instant (G2-A2, D6): a stale vital can no longer lift
    # the alert into a band the card's total does not reach — one NEWS2, one number.
    result = score(state, now)
    band = _band(result)
```

**Edit** `homunculus-engine/src/homunculus/rules/news2.py` — replace:
```python
    partial_note = ""
    if result.partial:
        partial_note = (
            f" This is a partial NEWS2: {', '.join(result.missing)} not recently recorded, "
            f"so the true aggregate can only be higher."
        )
```
with:
```python
    partial_note = ""
    if result.partial:
        # Missing and stale alike, in breakdown order (G2-A2, X1): neither is in the total.
        absent = [name for name in result.breakdown
                  if name in result.missing or name in result.stale]
        partial_note = (
            f" This is a partial NEWS2: {', '.join(absent)} not recently recorded, "
            f"so the true aggregate can only be higher."
        )
```

**Edit** `homunculus-engine/src/homunculus/rules/news2.py` — replace:
```python
    reasoning = (
        f"NEWS2 {result.total} ({response}). Contributing: {contributing}. "
        f"Screen for deterioration, not a diagnosis; the response is review, not an order."
        f"{partial_note}{stale_note}"
    )
```
with:
```python
    assumed_note = ""
    if result.assumed:
        # G2-A2 (D7): an assumption is said out loud, and is not counted as partial.
        assumed_note = (" Assumed, nothing current charted: "
                        + ", ".join(_ASSUMED_AS[name] for name in result.assumed) + ".")
    reasoning = (
        f"NEWS2 {result.total} ({response}). Contributing: {contributing}. "
        f"Screen for deterioration, not a diagnosis; the response is review, not an order."
        f"{partial_note}{stale_note}{assumed_note}"
    )
```

- [ ] **Step 4: The patient-relative layer at the same instant (D6)**

**Edit** `homunculus-engine/src/homunculus/rules/patient_relative.py` — replace:
```python
from dataclasses import replace

from homunculus.canonical import SignalCode
```
with:
```python
from dataclasses import replace
from datetime import datetime

from homunculus.canonical import SignalCode
```

**Edit** `homunculus-engine/src/homunculus/rules/patient_relative.py` — replace:
```python
def apply(findings: list[Finding], state: PatientState,
          profile: PatientProfile | None) -> list[Finding]:
    """Adjust population findings against the patient's baseline and append acute-change findings.
    A patient with no profile is left exactly as the population rules produced them."""
    if profile is None:
        return findings

    result = news2.score(state)
```
with:
```python
def apply(findings: list[Finding], state: PatientState,
          profile: PatientProfile | None, now: datetime | None = None) -> list[Finding]:
    """Adjust population findings against the patient's baseline and append acute-change findings.
    A patient with no profile is left exactly as the population rules produced them.

    `now` is the instant `news2.evaluate` judged the score at (G2-A2, D6): a vital that has gone
    stale is no contributor here either, as it is none in the total the finding reports."""
    if profile is None:
        return findings

    result = news2.score(state, now)
```

**Edit** `homunculus-engine/src/homunculus/pipeline.py` — replace:
```python
        # Patient-relative layer: downgrade chronic-normal, surface acute deviation.
        findings = patient_relative.apply(findings, state, profile)
```
with:
```python
        # Patient-relative layer: downgrade chronic-normal, surface acute deviation. At the same
        # `now` NEWS2 was judged at (G2-A2, D6).
        findings = patient_relative.apply(findings, state, profile, now)
```

- [ ] **Step 5: Green, the neighbours, and the scenarios**

```bash
cd /c/tmp/g2a-a2/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/rules/test_news2.py tests/rules/test_staleness_structured.py tests/test_pipeline.py 2>&1 | tail -1
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/rules tests/test_news2_bands.py tests/test_trends.py tests/test_trends_api.py tests/test_scenario_news2.py tests/test_scenarios_e2e.py tests/test_scenarios_hl7_parity.py tests/test_api_patient_profile.py tests/test_api_board_news2.py 2>&1 | tail -1
```

Expected: `107 passed in …`; then `303 passed, 3 warnings in …` (the scenarios among them, unchanged — see the cadence note above). The whole no-DB suite after this task: `2293 passed, 650 skipped`.

- [ ] **Step 6: Line ends**

```bash
cd /c/tmp/g2a-a2
for f in homunculus-engine/src/homunculus/rules/news2.py homunculus-engine/src/homunculus/rules/patient_relative.py homunculus-engine/src/homunculus/pipeline.py homunculus-engine/tests/rules/test_news2.py homunculus-engine/tests/rules/test_staleness_structured.py homunculus-engine/tests/test_pipeline.py; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected: `news2.py CR=303 LF=303`, `patient_relative.py CR=146 LF=146`, `pipeline.py CR=151 LF=151`, `test_news2.py CR=281 LF=281`, `test_staleness_structured.py CR=56 LF=56`, `test_pipeline.py CR=362 LF=362`.

- [ ] **Step 7: Commit**

```bash
cd /c/tmp/g2a-a2
git add homunculus-engine/src/homunculus/rules/news2.py homunculus-engine/src/homunculus/rules/patient_relative.py homunculus-engine/src/homunculus/pipeline.py homunculus-engine/tests/rules/test_news2.py homunculus-engine/tests/rules/test_staleness_structured.py homunculus-engine/tests/test_pipeline.py
git status --short && git diff --cached --stat
git commit -q -F - <<'MSG'
feat(engine): NEWS2 counts a reading only inside its window, and says what it assumed (G2-A2)

score(state, now) gives a vital older than its window (1 h; temperature 2 h)
0 points and lists it in `stale`; the score is then partial (D1). An
air-or-oxygen or ACVPU value speaks for 8 h after it was charted (D8);
uncharted or expired it is assumed — air, Alert — and listed in `assumed`,
which does not make the score partial (D7). measured_at and fresh_until name
all seven inputs (D4). Without `now` nothing ages (D2). The NEWS2 alert and the
patient-relative layer judge the score at the reading's own `now`, so a stale
vital can no longer lift the alert into a band the card does not show (D6);
the partial note names a stale vital with the missing ones (X1), and the
reasoning names the assumptions.

red: 23 failed, 84 passed (score() took no `now`; News2Result had no
stale/assumed/measured_at; the alert still fired on a four-hour-old SBP 88;
the downgrade test saw ('news2', 'moderate', False))

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
git log --oneline -1
```

---

### Task 2: The board — judged at the wall clock, it names what is stale and assumed; a closing window is pushed

Spec D3, D4, D5 (and X2). `patient_board(…, now=None)` and `board_snapshot(…, now=None)` judge the card at `now`, the wall clock unless the caller names one — never `obs.timestamp`, the rule's own time at ingest, at which a board would never age (D3). One instant serves the whole card: `_meds` gets the same `now`, which is what it already defaulted to (X2). `latest.news2` gains `stale`, `assumed`, `measured_at` and `fresh_until` — the stamps, never an age (D4). `board.freshness_turned(state, since, until)` is the pure test: did one of the patient's seven `fresh_until` instants fall in (since, until]? The escalation cycle (every 20 s) remembers its previous `now` and republishes, judged at its own `now`, each measured patient whose answer is yes; the first cycle after a start has no previous `now` and republishes nothing; a patient the cycle already published for an escalation change is not sent twice, and that publish is judged at the cycle's `now` too (X2). The helper and its two call lines are marked `# G2-A2` (D15); they sit before the retention block Lane B's B1a edits (spec §8).

**Files:**
- Modify: `homunculus-engine/tests/test_api_board_news2.py` (`_board` passes `now`; five tests appended)
- Create: `homunculus-engine/tests/test_board_freshness.py`
- Modify: `homunculus-engine/src/homunculus/api/board.py` (`_iso`, `_news2`, `freshness_turned`, `patient_board`, `board_snapshot`)
- Modify: `homunculus-engine/src/homunculus/api/app.py` (an import; `freshness_since`, `_republish_turned`; the cycle)

- [ ] **Step 1: Write the failing tests**

**Edit** `homunculus-engine/tests/test_api_board_news2.py` — replace:
```python
def _board(engine: Engine) -> dict:
    return patient_board(engine, "bed-1", AckStore())
```
with:
```python
def _board(engine: Engine, now: datetime = WHEN) -> dict:
    # G2-A2 (D3): the board judges freshness at `now`, the wall clock unless named; these
    # readings are stamped WHEN.
    return patient_board(engine, "bed-1", AckStore(), now=now)
```

**Edit** `homunculus-engine/tests/test_api_board_news2.py` — replace:
```python
    engine = _engine(chemistry, at=later)
    state = engine.state("bed-1")
    for code, (value, _unit) in chemistry.items():
        assert state.latest(code).value == value
```
with:
```python
    engine = _engine(chemistry, at=later)
    state = engine.state("bed-1")
    for code, (value, _unit) in chemistry.items():
        assert state.latest(code).value == value


# --- G2-A2: what the card is told about each input's age, and what was assumed -------------------

STALE_AT_61_MIN = ["respiration_rate", "spo2", "systolic_bp", "pulse"]


def test_a_vital_past_its_window_leaves_the_boards_total_and_is_named():
    news2 = _board(_engine(DETERIORATING), now=WHEN + timedelta(minutes=61))["latest"]["news2"]
    assert news2["stale"] == STALE_AT_61_MIN
    assert news2["total"] == 2                 # the temperature's 2 h window is still open
    assert (news2["partial"], news2["missing"]) == (True, [])
    assert sum(news2["breakdown"].values()) == news2["total"]


def test_the_board_sends_each_inputs_stamp_and_window_end_never_an_age():
    news2 = _board(_engine(DETERIORATING))["latest"]["news2"]
    names = ["respiration_rate", "spo2", "systolic_bp", "pulse", "temperature",
             "air_or_oxygen", "consciousness"]
    assert list(news2["measured_at"]) == list(news2["fresh_until"]) == names
    assert news2["measured_at"]["spo2"] == WHEN.isoformat()
    assert news2["fresh_until"]["spo2"] == (WHEN + timedelta(hours=1)).isoformat()
    assert news2["fresh_until"]["temperature"] == (WHEN + timedelta(hours=2)).isoformat()
    assert (news2["measured_at"]["air_or_oxygen"], news2["fresh_until"]["consciousness"]) == (None, None)
    assert news2["stale"] == []


def test_air_and_alert_are_assumed_on_the_board_and_the_breakdown_still_sums():
    news2 = _board(_engine(DETERIORATING))["latest"]["news2"]
    assert news2["assumed"] == ["air_or_oxygen", "consciousness"]
    assert news2["partial"] is False
    assert sum(news2["breakdown"].values()) == news2["total"] == 14


def test_a_board_built_without_now_judges_at_the_wall_clock(monkeypatch):
    """D3: `obs.timestamp` is the rule's own time at ingest; a board judged at it never ages."""
    import homunculus.api.board as board_module

    class Frozen(datetime):
        at = WHEN

        @classmethod
        def now(cls, tz=None):
            return cls.at

    engine = _engine(DETERIORATING)
    monkeypatch.setattr(board_module, "datetime", Frozen)
    Frozen.at = WHEN + timedelta(minutes=30)
    assert patient_board(engine, "bed-1", AckStore())["latest"]["news2"]["stale"] == []
    Frozen.at = WHEN + timedelta(minutes=61)
    assert patient_board(engine, "bed-1", AckStore())["latest"]["news2"]["stale"] == STALE_AT_61_MIN


def test_the_snapshot_judges_every_card_at_one_instant():
    from homunculus.api.board import board_snapshot
    [card] = board_snapshot(_engine(DETERIORATING), AckStore(), now=WHEN + timedelta(minutes=61))
    assert card["latest"]["news2"]["stale"] == STALE_AT_61_MIN
```

**Write** `homunculus-engine/tests/test_board_freshness.py` (new file):
```python
"""G2-A2 (D5): when a NEWS2 input stops counting, the board is pushed again.

A reading's window closes with no frame to say so — a feed that stops is exactly when nothing else
arrives — so without a push the card would read fresh until a reload. `board.freshness_turned` is
the pure test the escalation cycle (every 20 s) asks of each measured patient: did one of its
`fresh_until` instants fall in (the previous cycle, this one]? The board it then publishes is
judged at the cycle's own instant. The first cycle after a start has nothing to compare with and
republishes nothing: `/patients` on (re)connect is judged at its own moment.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.board import freshness_turned
from homunculus.canonical import Observation, SignalCode
from homunculus.state.timeline import PatientState

WHEN = datetime(2026, 10, 25, 9, 0, tzinfo=timezone.utc)
TOKEN = {"Authorization": "Bearer tok"}
PATIENT = "G2A-1"   # synthetic


def _state(code: SignalCode, at: datetime) -> PatientState:
    st = PatientState(PATIENT)
    st.ingest(Observation(PATIENT, code, 1.0, "", at, "dev"))
    return st


def test_a_window_that_closes_inside_the_interval_has_turned():
    st = _state(SignalCode.SPO2, WHEN)                   # SpO2's window closes at WHEN + 1 h
    closes = WHEN + timedelta(hours=1)
    assert freshness_turned(st, closes - timedelta(seconds=20), closes) is True     # until is in
    assert freshness_turned(st, closes, closes + timedelta(seconds=20)) is False    # since is not
    assert freshness_turned(st, WHEN, closes - timedelta(seconds=1)) is False


def test_a_charted_oxygen_turns_at_eight_hours():
    st = _state(SignalCode.SUPPLEMENTAL_OXYGEN, WHEN)
    expires = WHEN + timedelta(hours=8)
    assert freshness_turned(st, expires - timedelta(seconds=20), expires) is True
    assert freshness_turned(st, WHEN + timedelta(hours=1), WHEN + timedelta(hours=7)) is False


def test_a_patient_with_nothing_measured_never_turns():
    assert freshness_turned(PatientState(PATIENT), WHEN, WHEN + timedelta(days=1)) is False


def _ingest(client: TestClient, code: str, value: float, at: datetime) -> None:
    r = client.post("/ingest", headers=TOKEN, json={
        "resourceType": "Observation", "code": {"coding": [{"code": code}]},
        "subject": {"reference": f"Patient/{PATIENT}"}, "effectiveDateTime": at.isoformat(),
        "valueQuantity": {"value": value, "unit": ""}})
    assert r.status_code == 200, r.text


def test_the_cycle_republishes_a_board_once_when_a_window_closes():
    app = create_app({"tok": "h1"}, run_escalation_loop=False)
    with TestClient(app) as client:
        _ingest(client, "spo2", 97, WHEN)
        queue = app.state.broadcaster.subscribe("h1")

        def cycle(at: datetime) -> None:
            client.portal.call(app.state.escalation_cycle, at)

        cycle(WHEN + timedelta(minutes=59, seconds=30))
        cycle(WHEN + timedelta(minutes=59, seconds=50))      # the window is still open
        assert queue.empty()
        cycle(WHEN + timedelta(hours=1, seconds=10))         # it closed at +1 h, in this interval
        board = queue.get_nowait()
        assert board["patient_id"] == PATIENT
        assert board["latest"]["news2"]["stale"] == ["spo2"]    # judged at the cycle's instant
        assert queue.empty()
        cycle(WHEN + timedelta(hours=1, seconds=30))         # nothing else closed
        assert queue.empty()


def test_the_first_cycle_after_a_start_republishes_nothing():
    app = create_app({"tok": "h1"}, run_escalation_loop=False)
    with TestClient(app) as client:
        _ingest(client, "spo2", 97, WHEN)
        queue = app.state.broadcaster.subscribe("h1")
        client.portal.call(app.state.escalation_cycle, WHEN + timedelta(hours=1, seconds=10))
        assert queue.empty()


def test_a_patient_escalated_in_the_same_cycle_is_published_once_judged_at_the_cycle():
    # NEWS2 9 is HIGH and immediate; it escalates an hour after it was first seen (the wall clock),
    # in the cycle in which its readings' windows close. One frame, not two — and that frame is
    # judged at the cycle's instant too, so it already says the readings are stale (X2).
    start = datetime.now(timezone.utc)
    app = create_app({"tok": "h1"}, run_escalation_loop=False, escalate_after=timedelta(hours=1))
    with TestClient(app) as client:
        for code, value in (("resp_rate", 26), ("spo2", 91), ("sbp", 88)):
            _ingest(client, code, value, start)
        queue = app.state.broadcaster.subscribe("h1")
        client.portal.call(app.state.escalation_cycle, start + timedelta(minutes=59, seconds=30))
        assert queue.empty()
        client.portal.call(app.state.escalation_cycle, start + timedelta(hours=1, seconds=10))
        board = queue.get_nowait()
        assert queue.empty(), "escalated and turned in one cycle: one frame"
        assert next(a for a in board["alerts"] if a["kind"] == "news2")["escalated"] is True
        assert board["latest"]["news2"]["stale"] == ["respiration_rate", "spo2", "systolic_bp"]
```

Then convert it to CRLF — the ground rules' one exception, touching only this file:

```bash
cd /c/tmp/g2a-a2
/c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" homunculus-engine/tests/test_board_freshness.py
```

- [ ] **Step 2: Run them, and see them fail for the reasons named**

```bash
cd /c/tmp/g2a-a2/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_api_board_news2.py 2>&1 | tail -1
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_board_freshness.py 2>&1 | tail -1
```

Expected: `15 failed, 1 passed in …` — `patient_board()` and `board_snapshot()` take no `now` (`TypeError: … got an unexpected keyword argument 'now'`, 14 tests: `_board` passes it now), and the wall-clock test finds no `stale` (`KeyError: 'stale'`); then `1 warning, 1 error in …` — the new file stops at its import (`ImportError: cannot import name 'freshness_turned' from 'homunculus.api.board'`). Run separately because a collection error stops the whole run.

- [ ] **Step 3: The board**

**Edit** `homunculus-engine/src/homunculus/api/board.py` — replace:
```python
def _news2(state) -> dict:
    """The engine's NEWS2, in the shape the board carries it.

    `total` is always a number — NEWS2 scores a missing parameter as 0 — so `partial` and
    `missing` are what tell a reader whether that number is the whole story.
    """
    result = news2_score(state)
    return {
        "total": result.total,
        "partial": result.partial,
        "missing": list(result.missing),
        "red_param": result.red_param,
        "breakdown": dict(result.breakdown),
    }
```
with:
```python
def _iso(at: datetime | None) -> str | None:
    return None if at is None else at.isoformat()


def _news2(state, now: datetime) -> dict:
    """The engine's NEWS2, in the shape the board carries it.

    `total` is always a number — NEWS2 scores a missing parameter as 0 — so `partial` and
    `missing` are what tell a reader whether that number is the whole story.

    G2-A2. Judged at `now` (D3): a vital past its window is out of the total and named in `stale`
    (D1); `assumed` names the inputs scored as air and Alert because nothing current is charted
    (D7). `measured_at` and `fresh_until` carry each of the seven inputs' last reading and the end
    of its window, ISO-8601 or None (D4). The API sends the stamp, never an age — an age baked into
    a payload is wrong a minute after it was published — and "too old" is `stale`, never a
    comparison the screen makes with `fresh_until`.
    """
    result = news2_score(state, now)
    return {
        "total": result.total,
        "partial": result.partial,
        "missing": list(result.missing),
        "red_param": result.red_param,
        "breakdown": dict(result.breakdown),
        "stale": list(result.stale),
        "assumed": list(result.assumed),
        "measured_at": {name: _iso(at) for name, at in result.measured_at.items()},
        "fresh_until": {name: _iso(at) for name, at in result.fresh_until.items()},
    }


def freshness_turned(state, since: datetime, until: datetime) -> bool:
    """Whether one of this patient's NEWS2 inputs stopped counting in (since, until] — a reading's
    window closed, or a charted value expired (G2-A2, D5). Pure: the escalation cycle asks it of
    every measured patient and republishes the board when the answer is yes, because nothing else
    would — a feed that stops is exactly when no further frame arrives."""
    return any(at is not None and since < at <= until
               for at in news2_score(state).fresh_until.values())
```

**Edit** `homunculus-engine/src/homunculus/api/board.py` — replace:
```python
                  bedmap: BedMap | None = None) -> dict:
    alerts = engine.active_alerts(patient_id)
    state = engine.state(patient_id)
    return {
```
with:
```python
                  bedmap: BedMap | None = None, now: datetime | None = None) -> dict:
    alerts = engine.active_alerts(patient_id)
    state = engine.state(patient_id)
    # One instant for the whole card (G2-A2, D3, X2): NEWS2's freshness and the antibiotic clock
    # are judged at the wall clock unless the caller names a moment (the escalation cycle, tests).
    # Never `obs.timestamp`: that is the rule's own time at ingest, and a board judged at it would
    # never age.
    now = now or datetime.now(timezone.utc)
    return {
```

**Edit** `homunculus-engine/src/homunculus/api/board.py` — replace:
```python
            "news2": _news2(state),
```
with:
```python
            "news2": _news2(state, now),
```

**Edit** `homunculus-engine/src/homunculus/api/board.py` — replace:
```python
        "meds": _meds(engine, state, patient_id),
```
with:
```python
        "meds": _meds(engine, state, patient_id, now),
```

**Edit** `homunculus-engine/src/homunculus/api/board.py` — replace:
```python
                   bedmap: BedMap | None = None) -> list[dict]:
    measured = engine.patient_ids()
    boards = [patient_board(engine, pid, store,
                            identity=identities.get(hospital, pid) if identities else None,
                            bedmap=bedmap)
              for pid in measured]
```
with:
```python
                   bedmap: BedMap | None = None, now: datetime | None = None) -> list[dict]:
    measured = engine.patient_ids()
    now = now or datetime.now(timezone.utc)      # every card judged at one instant (G2-A2, D3)
    boards = [patient_board(engine, pid, store,
                            identity=identities.get(hospital, pid) if identities else None,
                            bedmap=bedmap, now=now)
              for pid in measured]
```

- [ ] **Step 4: The cycle republishes what turned**

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
from homunculus.api.board import board_snapshot, identity_only_board, patient_board
```
with:
```python
from homunculus.api.board import (
    board_snapshot, freshness_turned, identity_only_board, patient_board,
)
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
    async def _escalation_cycle(now: datetime) -> None:
        for hospital, engine in list(engines.items()):
```
with:
```python
    # G2-A2 (D5): the previous escalation cycle's `now`; None until a cycle has run.
    freshness_since: list[datetime | None] = [None]

    async def _republish_turned(hospital: str, engine: Engine, store: AckStore, now: datetime,
                                published: set[str]) -> None:
        """G2-A2 (D5): republish, judged at `now`, each measured patient one of whose NEWS2 inputs
        stopped counting since the previous cycle (`board.freshness_turned`). A reading's window
        closes with no frame to say so — a feed that stops is exactly when no further frame
        arrives — and without this the card would read fresh until a reload. The first cycle after
        a start has nothing to compare with and republishes nothing: `/patients` on (re)connect is
        judged at its own moment. `published` are the patients this cycle has already sent."""
        since = freshness_since[0]
        if since is None:
            return
        for pid in engine.patient_ids():
            if pid not in published and freshness_turned(engine.state(pid), since, now):
                await broadcaster.publish(hospital, patient_board(
                    engine, pid, store, identity=identities.get(hospital, pid), bedmap=bedmap,
                    now=now))

    async def _escalation_cycle(now: datetime) -> None:
        for hospital, engine in list(engines.items()):
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
            newly = escalate(alerts, store.acks, store.clock_from, now, escalate_after)
            if newly != store.escalated:
                added = newly - store.escalated
                changed = {pid for (pid, _k) in (newly ^ store.escalated)}
                store.escalated = newly
                for pid in changed:
                    await broadcaster.publish(hospital, patient_board(
                        engine, pid, store, identity=identities.get(hospital, pid),
                        bedmap=bedmap))
```
with:
```python
            newly = escalate(alerts, store.acks, store.clock_from, now, escalate_after)
            changed: set[str] = set()
            if newly != store.escalated:
                added = newly - store.escalated
                changed = {pid for (pid, _k) in (newly ^ store.escalated)}
                store.escalated = newly
                for pid in changed:
                    # Judged at the cycle's instant, as the freshness republish below (G2-A2, X2).
                    await broadcaster.publish(hospital, patient_board(
                        engine, pid, store, identity=identities.get(hospital, pid),
                        bedmap=bedmap, now=now))
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
                    for note in notifier.for_escalation(hospital, to_page, alert_by_key):
                        await hub.publish(hospital, note)
                        audit.append(AuditEvent(hospital, "notification", note.patient_id, note.kind,
                                                {"audience": note.audience, "trigger": note.trigger}))

        # Retention: a card discharged more than DISCHARGED_TTL ago leaves the board (or keeps its
```
with:
```python
                    for note in notifier.for_escalation(hospital, to_page, alert_by_key):
                        await hub.publish(hospital, note)
                        audit.append(AuditEvent(hospital, "notification", note.patient_id, note.kind,
                                                {"audience": note.audience, "trigger": note.trigger}))
            await _republish_turned(hospital, engine, store, now, changed)   # G2-A2 (D5)
        freshness_since[0] = now                                             # G2-A2 (D5)

        # Retention: a card discharged more than DISCHARGED_TTL ago leaves the board (or keeps its
```

- [ ] **Step 5: Green, and the neighbours**

```bash
cd /c/tmp/g2a-a2/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_api_board_news2.py tests/test_board_freshness.py 2>&1 | tail -1
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_board.py tests/test_api_ack.py tests/test_escalation_workflow.py tests/test_api_identity_ingest.py tests/test_api_notifications.py tests/test_first_seen_persistence.py tests/test_infinity_shadow_equivalence.py tests/test_infinity_shadow_isolation.py tests/test_api_board_bedmap.py tests/test_api_board_identity.py tests/test_rehydrate.py tests/test_api_audit.py 2>&1 | tail -1
```

Expected: `22 passed, 3 warnings in …`; then `103 passed, 14 skipped, 3 warnings in …`. The whole no-DB suite after this task: `2304 passed, 650 skipped`.

- [ ] **Step 6: Line ends**

```bash
cd /c/tmp/g2a-a2
for f in homunculus-engine/src/homunculus/api/board.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_api_board_news2.py homunculus-engine/tests/test_board_freshness.py; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected: `board.py CR=330 LF=330`, `app.py CR=1208 LF=1208`, `test_api_board_news2.py CR=174 LF=174`, `test_board_freshness.py CR=105 LF=105`.

- [ ] **Step 7: Commit**

```bash
cd /c/tmp/g2a-a2
git add homunculus-engine/src/homunculus/api/board.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_api_board_news2.py homunculus-engine/tests/test_board_freshness.py
git status --short && git diff --cached --stat
git commit -q -F - <<'MSG'
feat(api): the board judges NEWS2 at the wall clock, names what is stale and assumed, and is pushed when a window closes (G2-A2)

patient_board and board_snapshot take `now` and default to the wall clock,
never the reading's own time, at which a board never ages (D3); one instant
serves the whole card, the antibiotic clock included (X2). latest.news2 gains
stale, assumed, and each input's measured_at and fresh_until — the stamps,
never an age (D4). The escalation cycle republishes, judged at its own now, a
measured patient one of whose windows closed since the previous cycle
(board.freshness_turned); the first cycle after a start republishes nothing,
and a patient already sent for an escalation change is sent once (D5).

red: 15 failed, 1 passed (patient_board() and board_snapshot() took no `now`;
no `stale` on the board); test_board_freshness.py: ImportError, no freshness_turned

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
git log --oneline -1
```

---

### Task 3: The dashboard — the card names each stale input with its age, and marks what was assumed

Spec D10 (with X3, X4). `News2` (`live/screens/common/BoardState.jsx`) keeps the total, the partial pill and the red-parameter pill, and adds two things, both drawn only from what the engine sent: a visible line naming each `stale` input with its age — "köhnə məlumat: SpO2 · 2 saat əvvəl" (tr "eski veri: SpO2 · 2 sa önce") — and a neutral «fərz edildi» pill (tr «varsayıldı») naming the `assumed` inputs, where an expired chart adds "son qeyd {age}" (tr "son kayıt {age}") and a never-charted one says so to a screen reader. The age is `ageText(t, measured_at[name], nowMs)`: the server's stamp against the screen's corrected clock. `nowMs` is a prop, passed by the three screens that draw `News2` from the clock each already reads with `useBoardNow` — the bed card is rendered without a `BoardProvider` (its tests, and the card itself, take `nowMs` from the board screen), so `News2` cannot call the hook itself (X4). The screen never compares `fresh_until` with a clock: "too old" is the engine's `stale` (`freshness.js:3–9`). The 8 h figure is not on the screen. Eight strings ×4 in `strings/news2.js` — the spec's seven and `assumedLast`, which carries the spec's own "son kayıt {age}" (X3); the az, ru and en texts await a native reading (O1). `liveAdapters.js:67` passes `news2` through unchanged, so it is not touched. `strings.test.js` is not touched: no new az text equals its tr source, and every ru text has Cyrillic.

**Files:**
- Modify: `dashboard/src/live/i18n/strings/news2.js` (its header; eight keys ×4)
- Modify: `dashboard/src/live/data/board.testutil.js` (the `news2` fixture's new keys)
- Modify: `dashboard/src/live/screens/common/BoardState.jsx` (an import; `News2`)
- Modify: `dashboard/src/live/screens/beds/BedCard.jsx`, `dashboard/src/live/screens/beds/BedsScreen.jsx`, `dashboard/src/live/screens/patient/PatientScreen.jsx` (each passes its `nowMs`)
- Modify: `dashboard/src/live/screens/beds/BedCard.test.jsx`, `dashboard/src/live/screens/beds/BedsScreen.test.jsx`, `dashboard/src/live/screens/patient/PatientScreen.test.jsx` (tests appended)

- [ ] **Step 1: Write the failing tests**

**Edit** `dashboard/src/live/screens/beds/BedCard.test.jsx` — replace:
```jsx
      expect(screen.getByText("Bir parametr 3 bal alıb")).toBeInTheDocument();
      expect(screen.getByText("Aşağı")).toBeInTheDocument();
      expect(container.querySelector("[data-rail]")).toHaveAttribute("data-rail", "low");
    });
  });
```
with:
```jsx
      expect(screen.getByText("Bir parametr 3 bal alıb")).toBeInTheDocument();
      expect(screen.getByText("Aşağı")).toBeInTheDocument();
      expect(container.querySelector("[data-rail]")).toHaveAttribute("data-rail", "low");
    });

    // G2-A2 (D10): the engine names what it left out of the total (`stale`) and what it scored as
    // room air and Alert (`assumed`). The card prints each stale input's age from the engine's
    // stamp (`measured_at`) and judges nothing itself.
    it("names a stale input with its age, from the engine's stamp", () => {
      card(entry("S-001", [], {
        at: measured(30),
        score: news2({ total: 4, partial: true, stale: ["spo2", "temperature"],
          measured_at: { spo2: ago(7200), temperature: ago(7500) } }),
      }));
      expect(screen.getByText("köhnə məlumat: SpO2 · 2 saat əvvəl, temperatur · 3 saat əvvəl")).toBeInTheDocument();
      expect(screen.getByText(/Pəncərəsini keçmiş ölçmə bala daxil edilmir/)).toBeInTheDocument();
    });

    it("marks the assumed inputs, and says when an expired chart was last made", () => {
      card(entry("S-001", [], {
        at: measured(30),
        score: news2({ assumed: ["air_or_oxygen", "consciousness"], measured_at: { air_or_oxygen: ago(9 * 3600) } }),
      }));
      expect(screen.getByText("fərz edildi: otaq havası (son qeyd 9 saat əvvəl), oyaq")).toBeInTheDocument();
      expect(screen.getByText("(heç qeyd edilməyib)")).toBeInTheDocument();   // consciousness, read out
      expect(screen.queryByText("qismən")).toBeNull();                         // an assumption is not partial
    });

    it("says nothing more when nothing is stale or assumed", () => {
      card(entry("S-001", [], { at: measured(30), score: news2({ total: 2 }) }));
      expect(screen.queryByText(/köhnə məlumat/)).toBeNull();
      expect(screen.queryByText(/fərz edildi/)).toBeNull();
    });
  });
```

**Edit** `dashboard/src/live/screens/beds/BedsScreen.test.jsx` — replace:
```jsx
    it("keeps the chosen view in this browser", async () => {
```
with:
```jsx
    // G2-A2 (D10): the list's NEWS2 cell says what the card says, against the same clock.
    it("the list names a stale NEWS2 input with its age", async () => {
      await open({ payload: board([entry("S-001", [], {
        ...CARD, score: news2({ total: 3, partial: true, stale: ["pulse"], measured_at: { pulse: ago(4000) } }),
      })]) });
      fireEvent.click(screen.getByRole("button", { name: "Siyahı" }));
      const row = screen.getByRole("table").querySelector("tbody tr");
      expect(within(row).getByText("köhnə məlumat: nəbz · 67 dəq əvvəl")).toBeInTheDocument();
    });

    it("keeps the chosen view in this browser", async () => {
```

**Edit** `dashboard/src/live/screens/patient/PatientScreen.test.jsx` — replace:
```jsx
    it("says nobody has charted a suspected infection — the sepsis rule then never runs", async () => {
```
with:
```jsx
    // G2-A2 (D10): the heading's NEWS2 says what the card says, against the screen's clock.
    it("names a stale NEWS2 input with its age and marks what the engine assumed", async () => {
      await open({ payload: board([entry("S-001", [], {
        ...FULL,
        score: news2({ total: 6, partial: true, stale: ["systolic_bp"], assumed: ["consciousness"],
          measured_at: { systolic_bp: ago(5400) } }),
      })]) });
      expect(screen.getByText("köhnə məlumat: sistolik AT · 90 dəq əvvəl")).toBeInTheDocument();
      expect(screen.getByText("fərz edildi: oyaq")).toBeInTheDocument();
    });

    it("says nobody has charted a suspected infection — the sepsis rule then never runs", async () => {
```

- [ ] **Step 2: Run them, and see them fail for the reasons named**

```bash
cd /c/tmp/g2a-a2/dashboard
npx vitest run src/live/screens/beds/BedCard.test.jsx src/live/screens/beds/BedsScreen.test.jsx src/live/screens/patient/PatientScreen.test.jsx 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ +Tests "
```

Expected: `      Tests  4 failed | 142 passed (146)` — the card draws neither the line nor the pill (`Unable to find an element with the text: köhnə məlumat: …` / `fərz edildi: …`); "says nothing more" passes already.

- [ ] **Step 3: The strings, ×4**

**Edit** `dashboard/src/live/i18n/strings/news2.js` — replace:
```js
// rest is new and awaits review by a native-speaking clinician. missing.* keys are the engine's
// parameter names (news2.missing[]).
```
with:
```js
// rest is new and awaits review by a native-speaking clinician. missing.* keys are the engine's
// parameter names (news2.missing[]).
// G2-A2 (D10): staleMark … assumed.* say what the engine left out of the total (news2.stale[],
// named with missing.*) and what it scored as room air and Alert (news2.assumed[]). TR is the
// owner's wording («varsayıldı», "son kayıt {age}"); AZ/RU/EN await a native reading.
```

**Edit** `dashboard/src/live/i18n/strings/news2.js` — replace:
```js
    missing: { respiration_rate: "solunum hızı", spo2: "SpO2", systolic_bp: "sistolik TA", pulse: "nabız", temperature: "ateş" },
```
with:
```js
    missing: { respiration_rate: "solunum hızı", spo2: "SpO2", systolic_bp: "sistolik TA", pulse: "nabız", temperature: "ateş" },
    staleMark: "eski veri",
    staleHint: "Penceresini aşan ölçüm skora girmez; gerçek toplam daha yüksek olabilir.",
    assumedMark: "varsayıldı",
    assumedHint: "Güncel kayıt yok; skor bu girdiyi varsayılan değerle hesapladı ve bunu kısmi saymaz.",
    assumedNever: "hiç kaydedilmedi",
    assumedLast: "son kayıt {age}",
    assumed: { air_or_oxygen: "oda havası", consciousness: "uyanık" },
```

**Edit** `dashboard/src/live/i18n/strings/news2.js` — replace:
```js
    missing: { respiration_rate: "tənəffüs tezliyi", spo2: "SpO2", systolic_bp: "sistolik AT", pulse: "nəbz", temperature: "temperatur" },
```
with:
```js
    missing: { respiration_rate: "tənəffüs tezliyi", spo2: "SpO2", systolic_bp: "sistolik AT", pulse: "nəbz", temperature: "temperatur" },
    staleMark: "köhnə məlumat",
    staleHint: "Pəncərəsini keçmiş ölçmə bala daxil edilmir; həqiqi cəm daha yüksək ola bilər.",
    assumedMark: "fərz edildi",
    assumedHint: "Cari qeyd yoxdur; bal bu girişi standart dəyərlə hesabladı və bunu qismən saymır.",
    assumedNever: "heç qeyd edilməyib",
    assumedLast: "son qeyd {age}",
    assumed: { air_or_oxygen: "otaq havası", consciousness: "oyaq" },
```

**Edit** `dashboard/src/live/i18n/strings/news2.js` — replace:
```js
    missing: { respiration_rate: "частота дыхания", spo2: "SpO2", systolic_bp: "систолическое АД", pulse: "пульс", temperature: "температура" },
```
with:
```js
    missing: { respiration_rate: "частота дыхания", spo2: "SpO2", systolic_bp: "систолическое АД", pulse: "пульс", temperature: "температура" },
    staleMark: "устаревшие данные",
    staleHint: "Измерение старше своего окна в балл не входит; истинная сумма может быть выше.",
    assumedMark: "по умолчанию",
    assumedHint: "Текущей записи нет; балл учёл значение по умолчанию и не считает себя из-за этого неполным.",
    assumedNever: "не записывалось",
    assumedLast: "последняя запись {age}",
    assumed: { air_or_oxygen: "комнатный воздух", consciousness: "в сознании" },
```

**Edit** `dashboard/src/live/i18n/strings/news2.js` — replace:
```js
    missing: { respiration_rate: "respiratory rate", spo2: "SpO2", systolic_bp: "systolic BP", pulse: "pulse", temperature: "temperature" },
```
with:
```js
    missing: { respiration_rate: "respiratory rate", spo2: "SpO2", systolic_bp: "systolic BP", pulse: "pulse", temperature: "temperature" },
    staleMark: "stale",
    staleHint: "A reading older than its window is left out of the score; the true total may be higher.",
    assumedMark: "assumed",
    assumedHint: "Nothing current is charted; the score used the default and does not count that as partial.",
    assumedNever: "never charted",
    assumedLast: "last charted {age}",
    assumed: { air_or_oxygen: "room air", consciousness: "alert" },
```

**Edit** `dashboard/src/live/data/board.testutil.js` — replace:
```js
/** The engine's NEWS2, in the shape the board carries it (`_news2`). `total` is always a number —
 *  NEWS2 scores a missing parameter as 0 — so `partial` and `missing` are what say whether that
 *  number is the whole story. */
export const news2 = (over = {}) => ({
  total: 6, partial: false, missing: [], red_param: false, breakdown: {}, ...over,
});
```
with:
```js
/** The engine's NEWS2, in the shape the board carries it (`_news2`). `total` is always a number —
 *  NEWS2 scores a missing parameter as 0 — so `partial` and `missing` are what say whether that
 *  number is the whole story. G2-A2: `stale`, `assumed` and the stamps default to empty — a test
 *  that is about them states them. */
export const news2 = (over = {}) => ({
  total: 6, partial: false, missing: [], red_param: false, breakdown: {},
  stale: [], assumed: [], measured_at: {}, fresh_until: {}, ...over,
});
```

- [ ] **Step 4: The component, and the clock its three screens hand it**

**Edit** `dashboard/src/live/screens/common/BoardState.jsx` — replace:
```jsx
import { neverMeasured, oldestMeasurement } from "./freshness.js";
```
with:
```jsx
import { neverMeasured, oldestMeasurement } from "./freshness.js";
import { ageText } from "../patient/ageText.js";
```

**Edit** `dashboard/src/live/screens/common/BoardState.jsx` — replace:
```jsx
 *  It lives here, with the shared board components, because the bed card, the list row and the
 *  patient screen all draw it, and those are built on separate branches. */
export function News2({ news2, className = "" }) {
  const { t } = useI18n();
  const missing = Array.isArray(news2?.missing) ? news2.missing : [];
```
with:
```jsx
 *  It lives here, with the shared board components, because the bed card, the list row and the
 *  patient screen all draw it, and those are built on separate branches.
 *
 *  G2-A2 (D10). The engine also says which inputs it left out of the total because they are older
 *  than their window (`stale`), and which it scored as room air and Alert because nothing current
 *  is charted (`assumed` — not partial, so not drawn as a warning). Each stale input is printed
 *  with its age: the server's stamp (`measured_at`) against `nowMs`, the clock the screen read with
 *  `useBoardNow`. The age is the screen's to state; "too old" is the engine's (freshness.js), and
 *  `fresh_until` is never compared with a clock here. */
export function News2({ news2, nowMs, className = "" }) {
  const { t } = useI18n();
  const missing = Array.isArray(news2?.missing) ? news2.missing : [];
```

**Edit** `dashboard/src/live/screens/common/BoardState.jsx` — replace:
```jsx
  const names = missing.map((m) => t(`news2.missing.${m}`)).join(", ");
  return (
```
with:
```jsx
  const names = missing.map((m) => t(`news2.missing.${m}`)).join(", ");
  // G2-A2 (D10): what the engine left out of the total, and what it assumed.
  const stale = Array.isArray(news2.stale) ? news2.stale : [];
  const assumed = Array.isArray(news2.assumed) ? news2.assumed : [];
  const at = news2.measured_at && typeof news2.measured_at === "object" ? news2.measured_at : {};
  const ageOfInput = (name) => ageText(t, at[name], nowMs);
  return (
```

**Edit** `dashboard/src/live/screens/common/BoardState.jsx` — replace:
```jsx
      {news2.red_param ? <StatusPill tone="att" icon="alert">{t("board.news2Red")}</StatusPill> : null}
    </span>
  );
}
```
with:
```jsx
      {news2.red_param ? <StatusPill tone="att" icon="alert">{t("board.news2Red")}</StatusPill> : null}
      {/* G2-A2 (D10): each input the total left out, with how old its last reading is. */}
      {stale.length > 0 ? (
        <span className="basis-full text-11 font-semibold text-att-ink">
          {`${t("news2.staleMark")}: `}
          {stale.map((name) => [t(`news2.missing.${name}`), ageOfInput(name)].filter(Boolean).join(" · ")).join(", ")}
          <span className="sr-only">{` · ${t("news2.staleHint")}`}</span>
        </span>
      ) : null}
      {/* G2-A2 (D10): what was scored as room air and Alert; an expired chart says when it was made. */}
      {assumed.length > 0 ? (
        <StatusPill tone="neutral" icon="edit">
          {`${t("news2.assumedMark")}: `}
          {assumed.map((name, i) => {
            const age = at[name] ? ageOfInput(name) : null;
            return (
              <React.Fragment key={name}>
                {i > 0 ? ", " : null}
                {t(`news2.assumed.${name}`)}
                {age ? ` (${t("news2.assumedLast", { age })})` : null}
                {at[name] ? null : <span className="sr-only">{` (${t("news2.assumedNever")})`}</span>}
              </React.Fragment>
            );
          })}
          <span className="sr-only">{` · ${t("news2.assumedHint")}`}</span>
        </StatusPill>
      ) : null}
    </span>
  );
}
```

**Edit** `dashboard/src/live/screens/beds/BedCard.jsx` — replace:
```jsx
          <News2 news2={patient?.news2} />
```
with:
```jsx
          {/* G2-A2 (D10): the card's clock, so a stale input's age is the server's. */}
          <News2 news2={patient?.news2} nowMs={nowMs} />
```

**Edit** `dashboard/src/live/screens/beds/BedsScreen.jsx` — replace:
```jsx
 *  `--v-spo` fall under 4.5:1 in daylight (Wave 1B's contrast table). */
function BedList({ patients, alertsOf, monitored }) {
```
with:
```jsx
 *  `--v-spo` fall under 4.5:1 in daylight (Wave 1B's contrast table).
 *  `nowMs` (G2-A2, D10): the screen's clock, for the NEWS2 cell's ages. */
function BedList({ patients, alertsOf, monitored, nowMs }) {
```

**Edit** `dashboard/src/live/screens/beds/BedsScreen.jsx` — replace:
```jsx
              <td><News2 news2={p.news2} /></td>
```
with:
```jsx
              <td><News2 news2={p.news2} nowMs={nowMs} /></td>
```

**Edit** `dashboard/src/live/screens/beds/BedsScreen.jsx` — replace:
```jsx
        <BedList patients={shown} alertsOf={alertsOf} monitored={linked} />
```
with:
```jsx
        <BedList patients={shown} alertsOf={alertsOf} monitored={linked} nowMs={nowMs} />
```

**Edit** `dashboard/src/live/screens/patient/PatientScreen.jsx` — replace:
```jsx
              <News2 news2={patient.news2} />
```
with:
```jsx
              {/* G2-A2 (D10): the screen's clock, so a stale input's age is the server's. */}
              <News2 news2={patient.news2} nowMs={nowMs} />
```

- [ ] **Step 5: Green, the dictionaries, and the neighbours**

```bash
cd /c/tmp/g2a-a2/dashboard
npx vitest run src/live/screens/beds/BedCard.test.jsx src/live/screens/beds/BedsScreen.test.jsx src/live/screens/patient/PatientScreen.test.jsx 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ +Tests "
npx vitest run src/live/i18n/strings.test.js 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ +Tests "
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
```

Expected: `      Tests  146 passed (146)`; then `      Tests  7 passed (7)`; then ` Test Files  89 passed (89)` and `      Tests  2437 passed (2437)`; then `✓ built in …` and `precache  20 entries (846.14 KiB)` (the replay's; a checkout's differs by its commit's characters), no `larger than`.

- [ ] **Step 6: Line ends**

```bash
cd /c/tmp/g2a-a2
for f in dashboard/src/live/i18n/strings/news2.js dashboard/src/live/data/board.testutil.js dashboard/src/live/screens/common/BoardState.jsx dashboard/src/live/screens/beds/BedCard.jsx dashboard/src/live/screens/beds/BedsScreen.jsx dashboard/src/live/screens/patient/PatientScreen.jsx dashboard/src/live/screens/beds/BedCard.test.jsx dashboard/src/live/screens/beds/BedsScreen.test.jsx dashboard/src/live/screens/patient/PatientScreen.test.jsx; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected: `news2.js CR=63 LF=63`, `board.testutil.js CR=166 LF=166`, `BoardState.jsx CR=342 LF=342`, `BedCard.jsx CR=172 LF=172`, `BedsScreen.jsx CR=364 LF=364`, `PatientScreen.jsx CR=424 LF=424`, `BedCard.test.jsx CR=331 LF=331`, `BedsScreen.test.jsx CR=424 LF=424`, `PatientScreen.test.jsx CR=913 LF=913`.

- [ ] **Step 7: Commit**

```bash
cd /c/tmp/g2a-a2
git add dashboard/src/live/i18n/strings/news2.js dashboard/src/live/data/board.testutil.js dashboard/src/live/screens/common/BoardState.jsx dashboard/src/live/screens/beds/BedCard.jsx dashboard/src/live/screens/beds/BedsScreen.jsx dashboard/src/live/screens/patient/PatientScreen.jsx dashboard/src/live/screens/beds/BedCard.test.jsx dashboard/src/live/screens/beds/BedsScreen.test.jsx dashboard/src/live/screens/patient/PatientScreen.test.jsx
git status --short && git diff --cached --stat
git commit -q -F - <<'MSG'
feat(dashboard): the NEWS2 card names each stale input with its age and marks what was assumed (G2-A2)

News2 keeps the total and its two pills and adds a line naming each input the
engine left out of the total, with its age from the server's stamp against the
screen's corrected clock ("eski veri: SpO2 · 2 sa önce"), and a neutral
«varsayıldı» pill naming what was scored as room air and Alert — an expired
chart adds "son kayıt {age}" (D10). The bed card, the bed list and the patient
screen hand it the clock each reads with useBoardNow (X4). Eight strings ×4 in
strings/news2.js (X3); az/ru/en await a native reading.

red: Tests 4 failed | 142 passed (146) — no stale line, no «varsayıldı» pill

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
git log --oneline -1
```

---

### Task 4: The audit reads — the newest N, and every row a page at a time

Spec D11, D12. One read surface, three backends: `records(…, newest=False, after_id=None)`. `newest=True` is the newest `limit` matching rows, handed back in ascending id order (SQL `ORDER BY id DESC LIMIT n`, reversed; memory sliced from the end by count, so a limit of 0 is empty, not everything); `after_id=n` is the rows with `id > n`, oldest first; both at once is a `ValueError`; neither keeps today's oldest-first. **The contract for Lane B's heat map (B6):** `records(tenant=, event_type=, since=, newest=True, limit=)` means "the newest N rows of the window, oldest first" — no other order is promised. `audit.iter_records(log, tenant=, page=)` reads every row by `after_id`, a page at a time, the next page when the last is consumed. The callers: `/audit` reads the newest N, `limit` clamped to 1…`AUDIT_LIMIT_MAX` (1000); `/alarm-quality` hands `since=` to the backend instead of filtering in Python, reads newest, clamps `limit` to 1…`ALARM_QUALITY_LIMIT_MAX` (20 000), and says `truncated` from a limit + 1 read (the trends pattern, `trends.py:122–124`); the replay (`_ensure`) pages every row with `REHYDRATE_PAGE` (5000) and never reads newest N — the 1 000 000 cap goes; `rehydrate()` accepts any iterable. `/audit/verify` stays oldest-first: a hash chain is verified from genesis. No migration: the reads walk the `id` primary key (measured in Step 7).

**Files:**
- Create: `homunculus-engine/tests/test_audit_newest.py`
- Modify: `homunculus-engine/tests/test_api_audit.py` (an import; four tests appended), `homunculus-engine/tests/test_rehydrate.py` (one test appended)
- Modify: `homunculus-engine/src/homunculus/api/audit.py` (an import; the Protocol; `_one_order`; `iter_records`; memory and SQLite `records`)
- Modify: `homunculus-engine/src/homunculus/api/audit_postgres.py` (an import; `records`)
- Modify: `homunculus-engine/src/homunculus/api/rehydrate.py` (an import; the signature)
- Modify: `homunculus-engine/src/homunculus/api/app.py` (an import; three constants; `_ensure`; `/audit`; `/alarm-quality`)

- [ ] **Step 1: Write the failing tests**

**Write** `homunculus-engine/tests/test_audit_newest.py` (new file):
```python
"""`records(…, newest=, after_id=)`: the newest N, and every row a page at a time (G2-A2, D11, D12).

Without either, a read is the OLDEST `limit` rows (`ORDER BY id ASC LIMIT n`). `/audit` asked that
and answered with the first 200 rows ever written; `/alarm-quality` read the first 20 000 and then
filtered by time in Python; a restart replayed the first million. `newest=True` is the newest N
matching rows, handed back oldest first; `after_id=n` is the rows after id n, oldest first — one
page of a read that must see every row (`iter_records`). Both at once is refused. Modelled on
test_audit_since.py: memory and SQLite here, Postgres when TEST_DATABASE_URL is set.
"""
from __future__ import annotations

import inspect
import time
from datetime import datetime, timezone

import pytest
from sqlalchemy import text

from homunculus.api.audit import (
    AuditEvent, AuditLog, InMemoryAuditLog, SqliteAuditLog, iter_records,
)
from homunculus.api.audit_postgres import PostgresAuditLog
from tests.conftest import TEST_DATABASE_URL, requires_db
from tests.test_audit_postgres import _load_migration


def _event(n: int, **over) -> AuditEvent:
    base = dict(tenant="HOSP1", event_type="ingest", patient_id="S-001", subject="heart_rate",
                payload={"n": n})
    return AuditEvent(**{**base, **over})


def _fill(log, count: int = 7) -> list:
    return [log.append(_event(n)) for n in range(count)]


def _after_last(log) -> datetime:
    """An instant strictly after every row written so far: on Windows the clock can tick at
    ~15.6 ms, and two rows a moment apart may share one `ts`."""
    last = max(datetime.fromisoformat(r.ts) for r in log.records(limit=10_000))
    while datetime.now(timezone.utc) <= last:
        time.sleep(0.001)
    return datetime.now(timezone.utc)


# --- the contract -------------------------------------------------------------------------------

@pytest.mark.parametrize("cls", [AuditLog, InMemoryAuditLog, SqliteAuditLog, PostgresAuditLog],
                         ids=lambda c: c.__name__)
def test_every_audit_log_takes_newest_and_after_id_as_keywords(cls):
    params = inspect.signature(cls.records).parameters
    assert params["newest"].kind is inspect.Parameter.KEYWORD_ONLY and params["newest"].default is False
    assert params["after_id"].kind is inspect.Parameter.KEYWORD_ONLY and params["after_id"].default is None


# --- in memory and SQLite -----------------------------------------------------------------------

@pytest.fixture(params=["memory", "sqlite"])
def log(request):
    return InMemoryAuditLog() if request.param == "memory" else SqliteAuditLog(":memory:")


def test_newest_is_the_last_rows_oldest_first(log):
    rows = _fill(log)
    assert [r.id for r in log.records(newest=True, limit=3)] == [r.id for r in rows[-3:]]
    assert [r.id for r in log.records(newest=True, limit=100)] == [r.id for r in rows]
    assert [r.id for r in log.records(limit=3)] == [r.id for r in rows[:3]]   # without it: as before


def test_newest_keeps_to_the_window_and_the_filters(log):
    _fill(log, 3)
    bound = _after_last(log)
    kept = [log.append(_event(n)) for n in (10, 11, 12)]
    log.append(_event(13, patient_id="S-002"))
    log.append(_event(14, tenant="HOSP2"))
    rows = log.records(tenant="HOSP1", patient_id="S-001", since=bound, newest=True, limit=2)
    assert [r.id for r in rows] == [r.id for r in kept[-2:]]
    rows = log.records(tenant="HOSP1", patient_id="S-001", since=bound, newest=True, limit=10)
    assert [r.id for r in rows] == [r.id for r in kept]          # the window's rows, none older


def test_a_newest_read_of_no_rows_is_empty_not_everything(log):
    _fill(log, 3)
    assert log.records(newest=True, limit=0) == []


def test_after_id_reads_the_rows_after_it_oldest_first(log):
    rows = _fill(log)
    assert [r.id for r in log.records(after_id=rows[2].id, limit=2)] == [rows[3].id, rows[4].id]
    assert log.records(after_id=rows[-1].id) == []


def test_newest_and_after_id_together_are_refused(log):
    _fill(log, 1)
    with pytest.raises(ValueError, match="newest and after_id"):
        log.records(newest=True, after_id=0)


def test_iter_records_reads_every_row_a_page_at_a_time(log):
    rows = _fill(log, 7)
    log.append(_event(99, tenant="HOSP2"))
    assert [r.id for r in iter_records(log, tenant="HOSP1", page=3)] == [r.id for r in rows]
    assert [r.id for r in iter_records(log, tenant="HOSP1", page=7)] == [r.id for r in rows]
    with pytest.raises(ValueError, match="page"):
        list(iter_records(log, page=0))


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
def test_postgres_reads_the_newest_rows_oldest_first(pg_log):
    rows = _fill(pg_log)
    assert [r.id for r in pg_log.records(newest=True, limit=3)] == [r.id for r in rows[-3:]]
    assert [r.id for r in pg_log.records(limit=3)] == [r.id for r in rows[:3]]
    assert pg_log.records(newest=True, limit=0) == []


@requires_db
def test_postgres_keeps_newest_to_the_window_and_the_filters(pg_log):
    _fill(pg_log, 3)
    bound = _after_last(pg_log)
    kept = [pg_log.append(_event(n)) for n in (10, 11, 12)]
    pg_log.append(_event(13, patient_id="S-002"))
    rows = pg_log.records(tenant="HOSP1", patient_id="S-001", since=bound, newest=True, limit=2)
    assert [r.id for r in rows] == [r.id for r in kept[-2:]]


@requires_db
def test_postgres_pages_by_id(pg_log):
    rows = _fill(pg_log, 7)
    assert [r.id for r in pg_log.records(after_id=rows[2].id, limit=2)] == [rows[3].id, rows[4].id]
    assert [r.id for r in iter_records(pg_log, tenant="HOSP1", page=3)] == [r.id for r in rows]


@requires_db
def test_postgres_refuses_newest_with_after_id(pg_log):
    with pytest.raises(ValueError, match="newest and after_id"):
        pg_log.records(newest=True, after_id=0)
```

Then convert it to CRLF — the ground rules' one exception, touching only this file:

```bash
cd /c/tmp/g2a-a2
/c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" homunculus-engine/tests/test_audit_newest.py
```

**Edit** `homunculus-engine/tests/test_api_audit.py` — replace:
```python
from homunculus.api.audit import InMemoryAuditLog
```
with:
```python
from homunculus.api.audit import AuditEvent, InMemoryAuditLog
```

**Edit** `homunculus-engine/tests/test_api_audit.py` — replace:
```python
    views = audit.records(tenant="HOSP1", event_type="view")
    assert len(views) == 1
    assert views[0].patient_id == "bed-3" and views[0].payload["role"] == "doctor"
```
with:
```python
    views = audit.records(tenant="HOSP1", event_type="view")
    assert len(views) == 1
    assert views[0].patient_id == "bed-3" and views[0].payload["role"] == "doctor"


# --- G2-A2 (D12): the newest rows, at most AUDIT_LIMIT_MAX; the alarm report reads its window ----

HDR = {"Authorization": "Bearer tok"}


def _views(audit, count):
    for n in range(count):
        audit.append(AuditEvent("HOSP1", "view", f"bed-{n}", "", {"n": n}))


def test_the_trail_is_the_newest_rows_oldest_first():
    audit = InMemoryAuditLog()
    _views(audit, 250)
    client = TestClient(create_app(TENANTS, run_escalation_loop=False, audit=audit))
    body = client.get("/audit", headers=HDR).json()["records"]
    assert [r["payload"]["n"] for r in body] == list(range(50, 250))


def test_the_trail_is_capped_and_a_request_cannot_empty_it():
    from homunculus.api.app import AUDIT_LIMIT_MAX
    audit = InMemoryAuditLog()
    _views(audit, AUDIT_LIMIT_MAX + 5)
    client = TestClient(create_app(TENANTS, run_escalation_loop=False, audit=audit))
    capped = client.get("/audit", params={"limit": 100000}, headers=HDR).json()["records"]
    assert len(capped) == AUDIT_LIMIT_MAX
    assert capped[-1]["payload"]["n"] == AUDIT_LIMIT_MAX + 4
    one = client.get("/audit", params={"limit": 0}, headers=HDR).json()["records"]
    assert [r["payload"]["n"] for r in one] == [AUDIT_LIMIT_MAX + 4]


class _Spy(InMemoryAuditLog):
    def __init__(self):
        super().__init__()
        self.reads: list[dict] = []

    def records(self, **kw):
        self.reads.append(kw)
        return super().records(**kw)


def test_the_alarm_report_asks_the_backend_for_its_window_and_says_when_it_was_cut():
    audit = _Spy()
    for n in range(5):
        audit.append(AuditEvent("HOSP1", "first_seen", f"bed-{n}", "news2",
                                {"at": datetime.now(timezone.utc).isoformat()}))
    client = TestClient(create_app(TENANTS, run_escalation_loop=False, audit=audit))
    body = client.get("/alarm-quality", params={"limit": 3}, headers=HDR).json()
    [read] = [r for r in audit.reads if "since" in r]
    assert (read["newest"], read["limit"]) == (True, 4)       # the cap, and one more to know
    assert read["since"].tzinfo is not None
    assert (body["truncated"], body["episodes"]) == (True, 3)
    body = client.get("/alarm-quality", params={"limit": 5}, headers=HDR).json()
    assert (body["truncated"], body["episodes"]) == (False, 5)


def test_the_alarm_reports_read_is_capped():
    from homunculus.api.app import ALARM_QUALITY_LIMIT_MAX
    audit = _Spy()
    client = TestClient(create_app(TENANTS, run_escalation_loop=False, audit=audit))
    client.get("/alarm-quality", params={"limit": 10**9}, headers=HDR)
    [read] = [r for r in audit.reads if "since" in r]
    assert read["limit"] == ALARM_QUALITY_LIMIT_MAX + 1
```

**Edit** `homunculus-engine/tests/test_rehydrate.py` — replace:
```python
    shock = next(a for a in live["alerts"] if a["kind"] == "septic_shock")
    assert (shock["first_seen_at"], shock["acknowledged"]) == (stamps[-1], False), \
        "the latch is episode 3's: its own stamp, and no answer inherited from episode 2"
```
with:
```python
    shock = next(a for a in live["alerts"] if a["kind"] == "septic_shock")
    assert (shock["first_seen_at"], shock["acknowledged"]) == (stamps[-1], False), \
        "the latch is episode 3's: its own stamp, and no answer inherited from episode 2"


def test_a_restart_replays_every_row_a_page_at_a_time(monkeypatch):
    """G2-A2 (D12): the replay read the first 1 000 000 rows in one go, and on a large tenant the rows
    it dropped were the newest — the current state. It reads every row by id now, a page at a time;
    a page of 5 here stands for the real 5000."""
    import homunculus.api.app as app_module
    monkeypatch.setattr(app_module, "REHYDRATE_PAGE", 5)
    reads: list[dict] = []

    class Counting(InMemoryAuditLog):
        def records(self, **kw):
            reads.append(kw)
            return super().records(**kw)

    audit = Counting()
    for minute, rate in enumerate([80, 82, 84, 86, 88, 90, 92, 94, 96, 98, 100, 140]):
        audit.append(AuditEvent("HOSP1", "ingest", "bed-3", "heart_rate", {
            "value": rate, "unit": "/min", "obs_ts": f"2026-07-14T10:{minute:02d}:00+00:00",
            "device": "mon"}))
    client = TestClient(create_app({"tok": "HOSP1"}, run_escalation_loop=False, audit=audit))
    [card] = client.get("/patients", headers={"Authorization": "Bearer tok"}).json()["patients"]
    assert card["latest"]["heart_rate"] == 140, "the newest row is the board's"
    assert {a["kind"] for a in card["alerts"]} == {"news2"}
    replay = [r for r in reads if r.get("tenant") == "HOSP1" and "after_id" in r]
    assert [(r["after_id"], r["limit"]) for r in replay] == [(None, 5), (5, 5), (10, 5)]
```

- [ ] **Step 2: Run them, and see them fail for the reasons named**

```bash
cd /c/tmp/g2a-a2/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_audit_newest.py 2>&1 | tail -1
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_api_audit.py tests/test_rehydrate.py 2>&1 | tail -1
```

Expected: `1 error in …` — the new file stops at its import (`ImportError: cannot import name 'iter_records'`); then `5 failed, 17 passed, 3 warnings in …` — `/audit` answers the first 200 rows (`[0, 1, …]` against `[50, 51, …]`), `AUDIT_LIMIT_MAX`/`ALARM_QUALITY_LIMIT_MAX` do not exist, `/alarm-quality` reads with no `since` (`ValueError: not enough values to unpack`), and the module has no `REHYDRATE_PAGE` (`AttributeError`).

- [ ] **Step 3: The three backends and the pager**

**Edit** `homunculus-engine/src/homunculus/api/audit.py` — replace:
```python
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Protocol
```
with:
```python
import sqlite3
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Protocol
```

**Edit** `homunculus-engine/src/homunculus/api/audit.py` — replace:
```python
class AuditLog(Protocol):
    def append(self, event: AuditEvent) -> AuditRecord: ...
    # `since` (zone-aware) keeps the rows written at or after it. Without it a read is the OLDEST
    # `limit` rows — the right end for a replay, the wrong one for "what happened in this window".
    def records(self, *, tenant: str | None = None, patient_id: str | None = None,
                event_type: str | None = None, since: datetime | None = None,
                limit: int = 200) -> list[AuditRecord]: ...
```
with:
```python
def _one_order(newest: bool, after_id: int | None) -> None:
    """Refuse `newest` with `after_id` (G2-A2, D11): the newest N rows and the rows after an id are
    different questions, and a read asked both would have to drop one of them silently."""
    if newest and after_id is not None:
        raise ValueError("newest and after_id are different reads: pass one")


class AuditLog(Protocol):
    def append(self, event: AuditEvent) -> AuditRecord: ...
    # `since` (zone-aware) keeps the rows written at or after it. Without `newest` or `after_id` a
    # read is the OLDEST `limit` rows. G2-A2 (D11): `newest=True` is the NEWEST `limit` matching
    # rows, still in ascending id order — "what happened lately" (/audit, /alarm-quality, the heat
    # map); `after_id=n` is the rows with `id > n`, oldest first — one page of "every row"
    # (`iter_records`, the replay). Both at once is a ValueError. No other order is promised.
    def records(self, *, tenant: str | None = None, patient_id: str | None = None,
                event_type: str | None = None, since: datetime | None = None,
                limit: int = 200, newest: bool = False,
                after_id: int | None = None) -> list[AuditRecord]: ...


def iter_records(log: AuditLog, *, tenant: str | None = None,
                 page: int) -> Iterator[AuditRecord]:
    """Every row, oldest first, read `page` rows at a time by id (G2-A2, D12) — the replay's read.

    A replay needs every row: one read capped at N drops the rows past N, and on a large tenant
    those are the newest — the current state. The next page is read when the last one has been
    consumed; a page shorter than `page` is the end."""
    if page < 1:
        raise ValueError("page must be at least 1")
    after: int | None = None
    while True:
        rows = log.records(tenant=tenant, limit=page, after_id=after)
        yield from rows
        if len(rows) < page:
            return
        after = rows[-1].id
```

**Edit** `homunculus-engine/src/homunculus/api/audit.py` — replace:
```python
    def records(self, *, tenant=None, patient_id=None, event_type=None, since=None, limit=200):
        bound = since_utc(since)
        hits = [r for r in self._rows if _matches(r, tenant, patient_id, event_type, bound)]
        return hits[:limit]
```
with:
```python
    def records(self, *, tenant=None, patient_id=None, event_type=None, since=None, limit=200,
                newest=False, after_id=None):
        _one_order(newest, after_id)
        bound = since_utc(since)
        hits = [r for r in self._rows if (after_id is None or r.id > after_id)
                and _matches(r, tenant, patient_id, event_type, bound)]
        # The newest `limit`, still oldest first (D11) — cut from the end by count: `hits[-0:]`
        # would be every row.
        return hits[max(len(hits) - limit, 0):] if newest else hits[:limit]
```

**Edit** `homunculus-engine/src/homunculus/api/audit.py` — replace:
```python
    def records(self, *, tenant=None, patient_id=None, event_type=None, since=None, limit=200):
        clauses, params = [], []
```
with:
```python
    def records(self, *, tenant=None, patient_id=None, event_type=None, since=None, limit=200,
                newest=False, after_id=None):
        _one_order(newest, after_id)
        clauses, params = [], []
```

**Edit** `homunculus-engine/src/homunculus/api/audit.py` — replace:
```python
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(limit)
        rows = self.connection.execute(
            f"SELECT * FROM audit {where} ORDER BY id ASC LIMIT ?", params
        ).fetchall()
```
with:
```python
        if after_id is not None:
            clauses.append("id > ?")
            params.append(after_id)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(limit)
        # The newest N are read from the id end and handed back oldest first (G2-A2, D11): the
        # INTEGER PRIMARY KEY, walked backwards — no index of its own.
        order = "DESC" if newest else "ASC"
        rows = self.connection.execute(
            f"SELECT * FROM audit {where} ORDER BY id {order} LIMIT ?", params
        ).fetchall()
        if newest:
            rows.reverse()
```

**Edit** `homunculus-engine/src/homunculus/api/audit_postgres.py` — replace:
```python
from homunculus.api.audit import (
    GENESIS_HASH, AuditEvent, AuditRecord, _now_iso, chain_hash, since_utc)
```
with:
```python
from homunculus.api.audit import (
    GENESIS_HASH, AuditEvent, AuditRecord, _now_iso, _one_order, chain_hash, since_utc)
```

**Edit** `homunculus-engine/src/homunculus/api/audit_postgres.py` — replace:
```python
                limit: int = 200) -> list[AuditRecord]:
        clauses, params = [], {"limit": limit}
```
with:
```python
                limit: int = 200, newest: bool = False,
                after_id: int | None = None) -> list[AuditRecord]:
        _one_order(newest, after_id)
        clauses, params = [], {"limit": limit}
```

**Edit** `homunculus-engine/src/homunculus/api/audit_postgres.py` — replace:
```python
            params["since"] = bound.isoformat()
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""

        with self._engine.connect() as conn:
            rows = conn.execute(
                text(f"SELECT id, ts, tenant, event_type, patient_id, subject, payload,"
                     f" prev_hash, hash FROM audit {where} ORDER BY id ASC LIMIT :limit"),
                params,
            ).mappings().all()
```
with:
```python
            params["since"] = bound.isoformat()
        if after_id is not None:
            clauses.append("id > :after_id")
            params["after_id"] = after_id
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        # The newest N from the id end, handed back oldest first (G2-A2, D11): `id` is the BIGSERIAL
        # primary key (migration 0004), walked backwards — no new index, no migration.
        order = "DESC" if newest else "ASC"

        with self._engine.connect() as conn:
            rows = conn.execute(
                text(f"SELECT id, ts, tenant, event_type, patient_id, subject, payload,"
                     f" prev_hash, hash FROM audit {where} ORDER BY id {order} LIMIT :limit"),
                params,
            ).mappings().all()
        if newest:
            rows = list(reversed(rows))
```

**Edit** `homunculus-engine/src/homunculus/api/rehydrate.py` — replace:
```python
from datetime import datetime

from homunculus.api.ackstore import AckStore
```
with:
```python
from collections.abc import Iterable
from datetime import datetime

from homunculus.api.ackstore import AckStore
```

**Edit** `homunculus-engine/src/homunculus/api/rehydrate.py` — replace:
```python
def rehydrate(engine: Engine, store: AckStore, records: list[AuditRecord]) -> None:
    for rec in records:
```
with:
```python
def rehydrate(engine: Engine, store: AckStore, records: Iterable[AuditRecord]) -> None:
    # Any iterable, read once, in id order (G2-A2, D12): the API hands it `audit.iter_records`,
    # which reads the log a page at a time, so no cap can drop the newest rows.
    for rec in records:
```

- [ ] **Step 4: The callers**

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
from homunculus.api.audit import AuditEvent, AuditLog, InMemoryAuditLog, verify_chain
```
with:
```python
from homunculus.api.audit import AuditEvent, AuditLog, InMemoryAuditLog, iter_records, verify_chain
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
TREND_WINDOWS_TEXT = frozenset(str(h) for h in TRENDS_HOURS)
```
with:
```python
TREND_WINDOWS_TEXT = frozenset(str(h) for h in TRENDS_HOURS)

#: G2-A2 (D12): the most rows one `/audit` answer carries — the newest; the most `/alarm-quality`
#: reads for its window (it says `truncated` when the window held more); and the rows a restart
#: replays per read — every row is replayed, a page at a time.
AUDIT_LIMIT_MAX = 1000
ALARM_QUALITY_LIMIT_MAX = 20000
REHYDRATE_PAGE = 5000
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
        rehydrate(engine, store, audit.records(tenant=hospital, limit=1_000_000))
```
with:
```python
        # Every row, oldest first, a page at a time (G2-A2, D12) — never the newest N, and no cap.
        rehydrate(engine, store, iter_records(audit, tenant=hospital, page=REHYDRATE_PAGE))
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
        recs = audit.records(tenant=hospital, patient_id=patient_id,
                             event_type=event_type, limit=limit)
        return {"records": [asdict(r) for r in recs]}
```
with:
```python
        # The NEWEST rows, oldest first, at most AUDIT_LIMIT_MAX (G2-A2, D12): an auditor asking
        # about recent activity gets recent rows, not the first ones ever written.
        recs = audit.records(tenant=hospital, patient_id=patient_id, event_type=event_type,
                             limit=max(1, min(limit, AUDIT_LIMIT_MAX)), newest=True)
        return {"records": [asdict(r) for r in recs]}
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
        since = now - timedelta(days=max(1, days))
        recs = [r for r in audit.records(tenant=hospital, limit=limit)
                if (r.ts or "") >= since.isoformat()]
        report = alarm_quality(recs, now)
        return {**report.as_dict(), "days": days}
```
with:
```python
        since = now - timedelta(days=max(1, days))
        # The window is the backend's to read (G2-A2, D12): its newest rows, at most `cap`, and one
        # more to know whether it held more — then the report says `truncated` rather than reading
        # as the whole window (the trends pattern, api/trends.py `_markers`).
        cap = max(1, min(limit, ALARM_QUALITY_LIMIT_MAX))
        recs = audit.records(tenant=hospital, since=since, limit=cap + 1, newest=True)
        truncated = len(recs) > cap
        report = alarm_quality(recs[1:] if truncated else recs, now)
        return {**report.as_dict(), "days": days, "truncated": truncated}
```

- [ ] **Step 5: Green, and the neighbours**

```bash
cd /c/tmp/g2a-a2/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_audit_newest.py tests/test_api_audit.py tests/test_rehydrate.py 2>&1 | tail -1
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_audit_since.py tests/test_audit_memory.py tests/test_audit_sqlite.py tests/test_audit_chain.py tests/test_alarm_quality.py tests/test_board_permissions.py tests/test_api_ack.py tests/test_api_clinical.py tests/test_api_ingest.py tests/test_trends_api.py tests/test_tenant_isolation.py tests/test_first_seen_persistence.py 2>&1 | tail -1
```

Expected: `38 passed, 4 skipped, 3 warnings in …` (the four Postgres tests skip without the database: Step 6 runs them); then `209 passed, 114 skipped, 3 warnings in …` (`test_board_permissions.py`'s `[-1]` is the newest ack, as it reads; `/audit/verify` and the chain tests are unchanged). The whole no-DB suite after this task: `2325 passed, 654 skipped` (the four new Postgres tests among the skipped).

- [ ] **Step 6: The Postgres backend, against the test database**

```bash
cd /c/tmp/g2a-a2/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_audit_newest.py tests/test_audit_since.py tests/test_audit_postgres.py 2>&1 | tail -1
```

The variable is set on this one command line only — never exported. The container is `homunculus-test-pg-56` (port 56432), shared with Lane B; `tests/conftest.py` takes a session advisory lock, so a run of the other lane's waits rather than colliding. Expected: `52 passed in …` — this file's 20 and the two neighbours' 32. If it prints `waiting for another test run on database 'homunculus_test' to finish`, the other lane holds the lock: it waits, then runs.

- [ ] **Step 7: A newest read on a large log — measured, not assumed** (spec §7). A throwaway SQLite file of 1 000 000 rows in the scratchpad, written straight into the table (no chain: the read does not look at it), then the two per-patient reads the routes make. Nothing of the repo; the file is deleted at the end.

```bash
cd /c/tmp/g2a-a2/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe - <<'PY'
import os, tempfile, time
from homunculus.api.audit import SqliteAuditLog
path = os.path.join(tempfile.mkdtemp(), "audit-1m.db")
log = SqliteAuditLog(path)
rows = (("2026-10-25T09:00:00+00:00", "HOSP1", "ingest", "rare" if n < 100 else f"bed-{n % 40}",
         "heart_rate", "{}") for n in range(1_000_000))
log.connection.executemany("INSERT INTO audit (ts, tenant, event_type, patient_id, subject, payload)"
                           " VALUES (?, ?, ?, ?, ?, ?)", rows)
log.connection.commit()
for who, newest in (("bed-7", True), ("rare", True), ("bed-7", False), ("rare", False), (None, True)):
    t = time.perf_counter(); got = log.records(tenant="HOSP1", patient_id=who, newest=newest, limit=200)
    print(f"{who} newest={newest}: {len(got)} rows in {(time.perf_counter() - t) * 1000:.0f} ms")
log.connection.close(); os.remove(path)
PY
```

Expected (the planner's run, 2026-10-25; the milliseconds are this machine's):
```
bed-7 newest=True: 200 rows in 6 ms
rare newest=True: 100 rows in 462 ms
bed-7 newest=False: 200 rows in 7 ms
rare newest=False: 100 rows in 452 ms
None newest=True: 200 rows in 5 ms
```
A patient with rows throughout the log, and the whole trail, are answered in milliseconds. The worst case — a patient with fewer rows than the limit, all of them old (`rare`: the first 100 of a million) — walks the whole key, **and today's oldest-first read of that patient walks it too**, for the same reason (it looks for a 101st row): the newest read adds no cost. No `(tenant, patient_id, id)` index in this slice (O4).

- [ ] **Step 8: Line ends**

```bash
cd /c/tmp/g2a-a2
for f in homunculus-engine/src/homunculus/api/audit.py homunculus-engine/src/homunculus/api/audit_postgres.py homunculus-engine/src/homunculus/api/rehydrate.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_audit_newest.py homunculus-engine/tests/test_api_audit.py homunculus-engine/tests/test_rehydrate.py; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected: `audit.py CR=333 LF=333`, `audit_postgres.py CR=143 LF=143`, `rehydrate.py CR=117 LF=117`, `app.py CR=1222 LF=1222`, `test_audit_newest.py CR=155 LF=155`, `test_api_audit.py CR=153 LF=153`, `test_rehydrate.py CR=262 LF=262`.

- [ ] **Step 9: Commit**

```bash
cd /c/tmp/g2a-a2
git add homunculus-engine/src/homunculus/api/audit.py homunculus-engine/src/homunculus/api/audit_postgres.py homunculus-engine/src/homunculus/api/rehydrate.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_audit_newest.py homunculus-engine/tests/test_api_audit.py homunculus-engine/tests/test_rehydrate.py
git status --short && git diff --cached --stat
git commit -q -F - <<'MSG'
feat(audit): reads say which end — the newest N for /audit and the alarm report, every row a page at a time for the replay (G2-A2)

records(…, newest=, after_id=) in the memory, SQLite and Postgres logs:
newest=True is the newest `limit` matching rows, oldest first; after_id=n the
rows after id n, oldest first; both at once is a ValueError (D11).
iter_records pages every row by id. /audit reads the newest N, capped at
AUDIT_LIMIT_MAX; /alarm-quality hands its window to the backend, reads newest
and says `truncated`; a restart replays every row, REHYDRATE_PAGE at a time,
with no cap (D12). /audit/verify stays oldest-first. No migration: the reads
walk the id primary key.

red: test_audit_newest.py: ImportError, no iter_records; test_api_audit.py +
test_rehydrate.py: 5 failed, 17 passed (/audit answered rows 0… not 50…; no
AUDIT_LIMIT_MAX / ALARM_QUALITY_LIMIT_MAX; /alarm-quality read with no `since`;
no REHYDRATE_PAGE)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
git log --oneline -1
```

---

### Task 5: An unreadable scope — 503, not "not found", and no false denial on the record

Spec D13, D13b. `scope/resolver.py` returns `UNKNOWN` when it could not find out what a caller may see (a token it cannot decode, a database that did not answer, no membership). Every single-patient route goes through `_require_patient`, which read that as out of scope: 404 «hasta bulunamadı» and a `scope_denied` row nobody committed; `/patients` answered 200 with an empty board and the blind note blamed the assignment; the two whole-trail routes called it «kapsam dışı». One helper, `_readable(scope)` (lane-marked `# G2-A2`), answers 503 «kapsam şu anda okunamıyor» — the stream ticket's own answer, already mapped by the dashboard (`apiErrors.js:80`) — and it is called: in `_require_patient` right after the scope is resolved, before `sees_patient` and the audit row; in `/patients` before `apply_scope`; and in `/audit` (no patient id) and `/alarm-quality` before their restricted-scope 403 (D13b), which a readable restricted scope keeps. The routes whose answer changes for `UNKNOWN`: POST `/clinical/{id}`, PUT `/clinical/{id}/profile`, `/ack`, `/view`, `/alerts/{id}`, `/audit?patient_id`, GET and POST `/scores/sofa/{id}` (from 404 and a false row), `/audit` and `/alarm-quality` (from 403), `/patients` (from 200 empty). Trends' own two-line check becomes redundant and goes; it still resolves the scope once and hands it over, so its answers are unchanged (`test_trends_api.py:189–194`, `:237–245`). The order is unchanged: the 403 for a missing permission and the 400 for a malformed body come first. The device token is unscoped and gets its answer. `scope/` is Lane B's and is not touched; the blind note (`scope/rules.py:210–213`) stays right for a readable scope that matches nothing (`test_api_scope.py:120–127`). The dashboard needs nothing: a failed `/patients` load is already UNAVAILABLE (`boardStore.js:129–159`).

**Files:**
- Modify: `homunculus-engine/tests/test_api_scope.py` (a class appended)
- Modify: `homunculus-engine/src/homunculus/api/app.py` (`_readable`; `_require_patient`; `/patients`; trends; `/audit`; `/alarm-quality`)

- [ ] **Step 1: Write the failing tests**

**Edit** `homunculus-engine/tests/test_api_scope.py` — replace:
```python
    def test_a_128_character_id_is_still_an_id(self, adult_nurse):
        _app, client = adult_nurse
        assert client.post("/view", headers=TOKEN,
                           json={"patient_id": "p" * 128}).status_code == 200
```
with:
```python
    def test_a_128_character_id_is_still_an_id(self, adult_nurse):
        _app, client = adult_nurse
        assert client.post("/view", headers=TOKEN,
                           json={"patient_id": "p" * 128}).status_code == 200


class TestJAnUnreadableScopeIsUnavailableNotNotFound:
    """G2-A2 (D13, D13b). A scope the resolver could not read — a database blip, no membership it
    could find — answered 404 «hasta bulunamadı» on every single-patient route and wrote a
    `scope_denied` row nobody committed; the whole-trail routes called it «kapsam dışı». It is 503
    now, the stream ticket's own answer, with no row; the device token, which is unscoped, still
    gets its answer."""

    PERMS = NURSE_PERMS | {"audit.view", "scores.sign"}
    ROUTES = [
        ("POST", "/clinical/p-a1", {"entries": [{"code": "suspected_infection", "value": 1}]}, 200),
        ("PUT", "/clinical/p-a1/profile", {"comorbidities": ["copd"]}, 200),
        ("POST", "/ack", {"patient_id": "p-a1", "kind": "news2"}, 200),
        ("POST", "/view", {"patient_id": "p-a1"}, 200),
        ("GET", "/alerts/p-a1", None, 200),
        ("GET", "/audit?patient_id=p-a1", None, 200),
        ("GET", "/scores/sofa/p-a1", None, 200),
        ("POST", "/scores/sofa/p-a1", {}, 403),          # a device never signs: its own refusal
        ("GET", "/audit", None, 200),                    # D13b: the whole trail
        ("GET", "/alarm-quality", None, 200),            # D13b
    ]

    @pytest.mark.parametrize("method,path,body,device", ROUTES,
                             ids=[f"{m} {p}" for m, p, _b, _d in ROUTES])
    def test_an_unreadable_scope_is_503_and_writes_no_denial(self, method, path, body, device):
        from homunculus.scope.resolver import UNKNOWN
        app = app_with(UNKNOWN, perms=self.PERMS)
        with TestClient(app) as client:
            _admit_everyone(client)
            _reading(client, "p-a1", spo2=85.0)          # a live NEWS2 alert, for the ack
            r = client.request(method, path, headers=NURSE, json=body)
            assert (r.status_code, r.json()["detail"]) == (503, "kapsam şu anda okunamıyor")
            assert not _rows(app, "scope_denied")
            answered = client.request(method, path, headers=TOKEN, json=body)
        assert answered.status_code == device, answered.text

    def test_the_board_is_503_before_it_is_narrowed(self):
        from homunculus.scope.resolver import UNKNOWN
        app = app_with(UNKNOWN)
        with TestClient(app) as client:
            _admit_everyone(client)
            r = client.get("/patients", headers=NURSE)
            device = client.get("/patients", headers=TOKEN)
        assert (r.status_code, r.json()["detail"]) == (503, "kapsam şu anda okunamıyor")
        assert device.status_code == 200 and len(device.json()["patients"]) == 3

    @pytest.mark.parametrize("path,detail", [
        ("/audit", "denetim kaydının tamamı kapsam dışı; bir patient_id verin"),
        ("/alarm-quality", "alarm kalitesi raporunun tamamı kapsam dışı"),
    ])
    def test_a_readable_restricted_scope_keeps_its_403_on_the_whole_trail(self, path, detail):
        app = app_with(ADULT, perms=self.PERMS)
        with TestClient(app) as client:
            r = client.get(path, headers=NURSE)
        assert (r.status_code, r.json()["detail"]) == (403, detail)

    def test_a_missing_permission_and_a_malformed_body_still_come_first(self):
        from homunculus.scope.resolver import UNKNOWN
        with TestClient(app_with(UNKNOWN, perms=frozenset())) as client:
            r = client.get("/alerts/p-a1", headers=NURSE)
        assert (r.status_code, r.json()["detail"]) == (403, "permission required: board.view")
        with TestClient(app_with(UNKNOWN)) as client:
            r = client.post("/ack", headers=NURSE, json={"patient_id": {"x": 1}, "kind": "news2"})
        assert (r.status_code, r.json()["detail"]) == (400, "geçersiz patient_id")
```

- [ ] **Step 2: Run them, and see them fail for the reasons named**

```bash
cd /c/tmp/g2a-a2/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_api_scope.py 2>&1 | tail -1
```

Expected: `11 failed, 45 passed, 3 warnings in …` — the eight single-patient routes answer `(404, 'hasta bulunamadı')`, `/audit` and `/alarm-quality` `(403, … kapsam dışı …)`, `/patients` 200; the 403-keeps test and the order test pass already.

- [ ] **Step 3: One helper, called where the scope is first read**

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
    async def _require_patient(caller: Caller, authorization: str | None,
                               patient_id: str, *, scope: Scope | None = None) -> None:
```
with:
```python
    def _readable(scope: Scope) -> Scope:   # G2-A2 (D13)
        """Refuse a scope that could not be read, before anything takes it for an answer: 503, the
        stream ticket's own answer (G2-A2, D13). A look-up that failed — a database blip, no
        membership the resolver could find — is not "out of scope": a 404 would tell a ward its
        patient is gone, a `scope_denied` row would record an access violation nobody committed,
        and an empty board would read as a quiet ward. The dashboard maps the detail
        (`apiErrors.js`), and a failed `/patients` load already shows UNAVAILABLE."""
        if scope.reason == UNKNOWN_SCOPE.reason:
            raise HTTPException(status_code=503, detail="kapsam şu anda okunamıyor")
        return scope

    async def _require_patient(caller: Caller, authorization: str | None,
                               patient_id: str, *, scope: Scope | None = None) -> None:
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
        `scope` is the caller's scope when the route has already resolved it (the trends route
        needs it first, to answer 503 for one that cannot be read). Passing it spares a second
        look-up, and a second chance for a blip to turn a readable scope into "not found". Every
        other route leaves it out and the scope is resolved here.
```
with:
```python
        A scope that cannot be read is 503 here, right after it is resolved and before the check
        and the audit row (`_readable`, G2-A2, D13): "we could not find out" is not "not yours".

        `scope` is the caller's scope when the route has already resolved it (the trends route,
        which polls every minute). Passing it spares a second look-up, and a second chance for a
        blip to turn a readable scope into an unreadable one. Every other route leaves it out and
        the scope is resolved here.
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
        scope = scope if scope is not None else await _scope(authorization)
```
with:
```python
        scope = _readable(scope if scope is not None else await _scope(authorization))
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
        scope = await _scope(authorization)
        result = apply_scope(
```
with:
```python
        # 503 before the board is narrowed (G2-A2, D13): an unreadable scope is not an empty one.
        scope = _readable(await _scope(authorization))
        result = apply_scope(
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
        reader's words, rather than FastAPI's 422. A scope that cannot be read is 503, as the stream
        ticket answers it: `_require_patient` would call it "not found", which tells a screen the
        patient is gone when only the look-up failed. Out of scope and unknown stay one 404.
```
with:
```python
        reader's words, rather than FastAPI's 422. A scope that cannot be read is 503, as the stream
        ticket answers it — `_require_patient` answers so for every single-patient route since
        G2-A2 (D13). Out of scope and unknown stay one 404.
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
        scope = await _scope(authorization)
        if scope.reason == UNKNOWN_SCOPE.reason:
            raise HTTPException(status_code=503, detail="kapsam şu anda okunamıyor")
        await _require_patient(caller, authorization, patient_id, scope=scope)
```
with:
```python
        scope = await _scope(authorization)
        await _require_patient(caller, authorization, patient_id, scope=scope)
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
        elif not (await _scope(authorization)).unrestricted:
```
with:
```python
        elif not _readable(await _scope(authorization)).unrestricted:   # G2-A2 (D13b): 503 first
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
        _require(caller, AUDIT_VIEW)
        if not (await _scope(authorization)).unrestricted:
```
with:
```python
        _require(caller, AUDIT_VIEW)
        if not _readable(await _scope(authorization)).unrestricted:   # G2-A2 (D13b): 503 first
```

- [ ] **Step 4: Green, and the neighbours**

```bash
cd /c/tmp/g2a-a2/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_api_scope.py 2>&1 | tail -1
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_trends_api.py tests/test_scope_resolver.py tests/test_scope_rules.py tests/test_board_permissions.py tests/test_dual_credentials.py tests/test_tenant_isolation.py tests/test_api_patient_profile.py tests/test_alarm_quality.py 2>&1 | tail -1
```

Expected: `56 passed, 3 warnings in …`; then `230 passed, 108 skipped, 3 warnings in …`. The whole no-DB suite after this task: `2339 passed, 654 skipped`.

- [ ] **Step 5: Line ends**

```bash
cd /c/tmp/g2a-a2
for f in homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_api_scope.py; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected: `app.py CR=1235 LF=1235`, `test_api_scope.py CR=479 LF=479`.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/g2a-a2
git add homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_api_scope.py
git status --short && git diff --cached --stat
git commit -q -F - <<'MSG'
fix(api): a scope that cannot be read is 503 — not "not found", and no false scope_denied row (G2-A2)

_readable(scope) answers 503 «kapsam şu anda okunamıyor», the stream ticket's
own answer, when the resolver could not find out what a caller may see. It runs
in _require_patient right after the scope is resolved, before the check and the
audit row (D13), in /patients before the board is narrowed, and in /audit and
/alarm-quality before their restricted-scope 403, which a readable restricted
scope keeps (D13b). Trends' own check goes; its answers are unchanged. The 403
for a missing permission and the 400 for a malformed body still come first;
the device token is unscoped and gets its answer.

red: 11 failed, 45 passed (the eight single-patient routes answered 404 «hasta
bulunamadı» and wrote scope_denied; /audit and /alarm-quality 403; /patients 200)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
git log --oneline -1
```

---

### Task 6: `/ingest` patient ids — one rule for readings and identity

Spec D14 (with X5). `patient_id_from(value, *, what)` in `gateway/fhir.py`: the value must be a string; it is stripped; it must be non-blank and at most `PATIENT_ID_MAX` (128) characters; anything else is a `GatewayError` naming `what`, which `/ingest` already turns into a 400. `PATIENT_ID_MAX` moves here from `api/app.py:81`, which imports it for `_body_patient_id` (request bodies, unchanged: they are not stripped). The callers: the Observation parser — where a non-object `subject` or a non-string `reference` is now a `GatewayError` too, not an `AttributeError` that `/ingest` answered with 500 (it catches only `GatewayError`) — and the Patient and Encounter parsers in `api/patient_identity.py`, each by one helper call in place of its own blank check; their messages keep naming the protocol number (`test_api_patient_identity.py:104`), and a protocol number past the cap is now refused by name. Observation ids are now stripped, as Patient and Encounter ids already were. **Shared ground with Lane B (B1a):** in `api/patient_identity.py` A2 changes only the two parse functions, one helper call each — and the module's import line, which has to name the helper (X5). History is not rewritten: old audit rows with padded ids replay as written. Path parameters are out of scope (spec §8). If Lane B asks A2 to cap only the Observation path (D14's fallback), drop the two `patient_identity.py` edits and the identity test; nothing else in this task depends on them.

**Files:**
- Modify: `homunculus-engine/tests/test_gateway_fhir.py` (tests appended), `homunculus-engine/tests/test_api_patient_identity.py` (one test)
- Modify: `homunculus-engine/src/homunculus/gateway/fhir.py` (`PATIENT_ID_MAX`, `patient_id_from`; the Observation's subject)
- Modify: `homunculus-engine/src/homunculus/api/patient_identity.py` (the import line; `parse_fhir_patient`'s and `parse_fhir_encounter`'s blank checks)
- Modify: `homunculus-engine/src/homunculus/api/app.py` (the import; the constant leaves)

- [ ] **Step 1: Write the failing tests**

**Edit** `homunculus-engine/tests/test_gateway_fhir.py` — replace:
```python
        r = client.post("/ingest", content=body, headers=auth)
        assert r.status_code == 400 and "finite" in r.json()["detail"]
        records = client.get("/audit", headers=auth).json()["records"]
        assert [x for x in records if x["event_type"] == "ingest"] == []
```
with:
```python
        r = client.post("/ingest", content=body, headers=auth)
        assert r.status_code == 400 and "finite" in r.json()["detail"]
        records = client.get("/audit", headers=auth).json()["records"]
        assert [x for x in records if x["event_type"] == "ingest"] == []


# --- G2-A2 (D14): one patient-id rule for every resource /ingest takes ------------------------
#
# A blank id merged every reading that carried one into one pseudo-patient; a 129-character id is a
# feed error; a subject that is not an object raised AttributeError, which /ingest answered with
# 500. Each is a GatewayError now, and so a 400.

BAD_SUBJECTS = {
    "blank": {"reference": "Patient/"},
    "whitespace": {"reference": "Patient/   "},
    "129 characters": {"reference": "Patient/" + "p" * 129},
    "a number": {"reference": 7},
    "a null reference": {"reference": None},
    "a string subject": "x",
    "a list subject": ["Patient/bed-3"],
    "a null subject": None,
}


@pytest.mark.parametrize("subject", list(BAD_SUBJECTS.values()), ids=list(BAD_SUBJECTS))
def test_a_patient_id_that_is_not_one_raises_gateway_error(subject):
    bad = {**_fhir("lactate", 3.1), "subject": subject}
    with pytest.raises(GatewayError):
        parse_fhir_observation(bad)


def test_a_128_character_id_is_still_an_id_and_an_id_is_stripped():
    assert parse_fhir_observation(_fhir("lactate", 3.1, patient="p" * 128)).patient_id == "p" * 128
    assert parse_fhir_observation(_fhir("lactate", 3.1, patient="  bed-3 ")).patient_id == "bed-3"


def test_patient_id_from_is_the_one_rule():
    from homunculus.gateway.fhir import PATIENT_ID_MAX, patient_id_from
    assert PATIENT_ID_MAX == 128
    assert patient_id_from("  p-1 ", what="the id") == "p-1"
    with pytest.raises(GatewayError, match="missing the id"):
        patient_id_from("   ", what="the id")
    with pytest.raises(GatewayError, match="the id is longer than 128 characters"):
        patient_id_from("p" * 129, what="the id")
    with pytest.raises(GatewayError, match="the id is not a string"):
        patient_id_from(7, what="the id")


@pytest.mark.parametrize("name", ["blank", "129 characters", "a string subject", "a number"])
def test_the_ingest_door_answers_400_not_500_and_records_nothing(name):
    from fastapi.testclient import TestClient
    from homunculus.api.app import create_app

    auth = {"Authorization": "Bearer tok"}
    bad = {**_fhir("lactate", 3.1), "subject": BAD_SUBJECTS[name]}
    app = create_app({"tok": "h1"}, run_escalation_loop=False)
    with TestClient(app, raise_server_exceptions=False) as client:
        r = client.post("/ingest", json=bad, headers=auth)
        assert r.status_code == 400, r.text
        records = client.get("/audit", headers=auth).json()["records"]
        assert [x for x in records if x["event_type"] == "ingest"] == []
        assert client.get("/patients", headers=auth).json()["patients"] == []
```

**Edit** `homunculus-engine/tests/test_api_patient_identity.py` — replace:
```python
def test_a_resource_of_the_wrong_type_is_refused():
```
with:
```python
def test_a_protocol_number_past_the_cap_is_refused_by_name():
    """G2-A2 (D14): readings and identity key alike — the Observation's cap is the identity's."""
    long = [{"system": "http://homunculus.local/protocol-no", "value": "9" * 129}]
    with pytest.raises(GatewayError, match=r"protocol number .* longer than 128"):
        parse_fhir_patient({**PATIENT, "identifier": long})
    with pytest.raises(GatewayError, match=r"protocol number .* longer than 128"):
        parse_fhir_encounter({**ENCOUNTER, "subject": {"reference": "Patient/" + "9" * 129}})
    longest = [{"system": "http://homunculus.local/protocol-no", "value": "9" * 128}]
    assert parse_fhir_patient({**PATIENT, "identifier": longest}).patient_id == "9" * 128


def test_a_resource_of_the_wrong_type_is_refused():
```

- [ ] **Step 2: Run them, and see them fail for the reasons named**

```bash
cd /c/tmp/g2a-a2/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_gateway_fhir.py tests/test_api_patient_identity.py 2>&1 | tail -1
```

Expected: `15 failed, 53 passed, 3 warnings in …` — the blank, whitespace and 129-character ids parse (`DID NOT RAISE`), the number, null, string, list and null subjects raise `AttributeError`, the padded id is kept padded, `patient_id_from` does not exist, `/ingest` answers 200 to `"Patient/"` and 500 to a string subject, and a 129-digit protocol number is accepted.

- [ ] **Step 3: The rule, and its three callers**

**Edit** `homunculus-engine/src/homunculus/gateway/fhir.py` — replace:
```python
class GatewayError(ValueError):
    """Raised when an incoming message cannot be normalized. Caller logs and drops it."""
```
with:
```python
class GatewayError(ValueError):
    """Raised when an incoming message cannot be normalized. Caller logs and drops it."""


#: The longest patient id a door accepts (G2-A2, D14) — a device's id or the protocol number the
#: HIS keys a patient by. Here since G2-A2 so readings and identity key alike; `api/app.py` applies
#: it to request bodies too (`_body_patient_id`).
PATIENT_ID_MAX = 128


def patient_id_from(value: object, *, what: str) -> str:
    """The patient id `value` carries, stripped: a non-blank string of at most PATIENT_ID_MAX
    characters, else a GatewayError naming `what` (G2-A2, D14). A blank id merges every reading
    that carries one into one pseudo-patient, and an id past the cap is a feed error: neither may
    reach the engine, and neither may surface as a 500."""
    if not isinstance(value, str):
        raise GatewayError(f"{what} is not a string")
    patient_id = value.strip()
    if not patient_id:
        raise GatewayError(f"missing {what}")
    if len(patient_id) > PATIENT_ID_MAX:
        raise GatewayError(f"{what} is longer than {PATIENT_ID_MAX} characters")
    return patient_id
```

**Edit** `homunculus-engine/src/homunculus/gateway/fhir.py` — replace:
```python
    subject = resource.get("subject", {}).get("reference", "")
    if not subject.startswith("Patient/"):
        raise GatewayError(f"missing or malformed subject.reference: {subject!r}")
    patient_id = subject.split("/", 1)[1]
```
with:
```python
    # G2-A2 (D14): a subject that is not an object, or a reference that is not a string, is the
    # feed's error (400), not an AttributeError (500); the id itself is `patient_id_from`'s.
    subject = resource.get("subject")
    if subject is not None and not isinstance(subject, dict):
        raise GatewayError(f"malformed subject: {subject!r}")
    reference = (subject or {}).get("reference", "")
    if not isinstance(reference, str) or not reference.startswith("Patient/"):
        raise GatewayError(f"missing or malformed subject.reference: {reference!r}")
    patient_id = patient_id_from(reference.split("/", 1)[1], what="patient id in subject.reference")
```

**Edit** `homunculus-engine/src/homunculus/api/patient_identity.py` — replace:
```python
from homunculus.gateway.fhir import GatewayError, to_utc
```
with:
```python
from homunculus.gateway.fhir import GatewayError, patient_id_from, to_utc
```

**Edit** `homunculus-engine/src/homunculus/api/patient_identity.py` — replace:
```python
    if not patient_id:
        raise GatewayError(f"missing protocol number (identifier with system {PROTOCOL_SYSTEM})")
```
with:
```python
    patient_id = patient_id_from(   # G2-A2 (D14): the one rule /ingest keys by
        patient_id, what=f"protocol number (identifier with system {PROTOCOL_SYSTEM})")
```

**Edit** `homunculus-engine/src/homunculus/api/patient_identity.py` — replace:
```python
    if not patient_id:
        raise GatewayError("missing protocol number (subject.reference)")
```
with:
```python
    patient_id = patient_id_from(   # G2-A2 (D14): the one rule /ingest keys by
        patient_id, what="protocol number (subject.reference)")
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
from homunculus.gateway.fhir import GatewayError, parse_fhir_observation
```
with:
```python
from homunculus.gateway.fhir import PATIENT_ID_MAX, GatewayError, parse_fhir_observation
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
DEVICE_ROLE_MAX = 64
PATIENT_ID_MAX = 128
```
with:
```python
DEVICE_ROLE_MAX = 64
# PATIENT_ID_MAX is the gateway's since G2-A2 (D14): a body's id and an ingested one are capped alike.
```

- [ ] **Step 4: Green, and the neighbours**

```bash
cd /c/tmp/g2a-a2/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_gateway_fhir.py tests/test_api_patient_identity.py 2>&1 | tail -1
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_api_identity_ingest.py tests/test_api_ingest.py tests/test_api_scope.py tests/test_gateway_hl7.py tests/test_scenarios_e2e.py tests/test_scenarios_hl7_parity.py tests/test_scenario_news2.py tests/test_patient_identity_postgres.py 2>&1 | tail -1
```

Expected: `68 passed, 3 warnings in …`; then `131 passed, 1 skipped, 3 warnings in …`. The whole no-DB suite after this task: `2354 passed, 654 skipped`.

- [ ] **Step 5: Line ends**

```bash
cd /c/tmp/g2a-a2
for f in homunculus-engine/src/homunculus/gateway/fhir.py homunculus-engine/src/homunculus/api/patient_identity.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_gateway_fhir.py homunculus-engine/tests/test_api_patient_identity.py; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
git diff -U0 -- homunculus-engine/src/homunculus/api/patient_identity.py | grep -c '^@@'
```

Expected: `fhir.py CR=96 LF=96`, `patient_identity.py CR=436 LF=436`, `app.py CR=1235 LF=1235`, `test_gateway_fhir.py CR=136 LF=136`, `test_api_patient_identity.py CR=271 LF=271`; and `3` hunks in `patient_identity.py` — the import line and the two parse functions, nothing else of Lane B's shared file (D14).

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/g2a-a2
git add homunculus-engine/src/homunculus/gateway/fhir.py homunculus-engine/src/homunculus/api/patient_identity.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_gateway_fhir.py homunculus-engine/tests/test_api_patient_identity.py
git status --short && git diff --cached --stat
git commit -q -F - <<'MSG'
fix(ingest): one patient-id rule for readings and identity — stripped, non-blank, at most 128 characters, a 400 otherwise (G2-A2)

gateway/fhir.py patient_id_from(value, what=) is the rule and PATIENT_ID_MAX
moves there from api/app.py, which imports it for request bodies (D14). The
Observation parser uses it — a subject that is not an object or a reference
that is not a string is a GatewayError too, so /ingest answers 400 where it
answered 500 — and the Patient and Encounter parsers use it in place of their
own blank checks, keeping the protocol number in their messages. Observation
ids are now stripped, as identity ids were. In Lane B's shared
patient_identity.py only the import line and the two parse functions change.

red: 15 failed, 53 passed (blank, whitespace and 129-character ids parsed; a
non-object subject or non-string reference raised AttributeError; a padded id
stayed padded; /ingest answered 200 to "Patient/" and 500 to subject "x"; a
129-digit protocol number was accepted)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
git log --oneline -1
```

---

### Task 7: The docs — the guide's NEWS2 note and unreadable scope, the roadmap row G2-A2

Spec §4 "Docs" (with X6). The guide is Turkish, so it quotes the tr texts («varsayıldı», "eski veri: SpO2 · 2 sa önce"); the board's default language says «fərz edildi» and "köhnə məlumat". The NEWS2 note (`docs/homunculus-rehber-TR.md`, "NEWS2 motorun") gains "eski veri skora girmez", the push, the alert's same score, «varsayıldı» and the 8 h; the patient-screen passage "Panoda olmayan bir hasta" gains one sentence for D13 — a scope that cannot be read is said so, not "not found" — which §4 did not list (X6). The roadmap's Group 2 table gains the row G2-A2 after G2-A1, with the slice's code range filled in Step 3. `Homunculus/wiki` is untouched: the windows and the 8 h are operational defaults, not clinical claims (spec §4, adopted).

**Files:**
- Modify: `docs/homunculus-rehber-TR.md` (two passages)
- Modify: `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` (the row G2-A2)

- [ ] **Step 1: The guide**

**Edit** `docs/homunculus-rehber-TR.md` — replace:
```markdown
  - **NEWS2 motorun.** Tek NEWS2 vardır, motorunki. Motor göndermediyse "NEWS2: —"; eksik vitalle
    hesaplanmışsa yanında "kısmi" hapı (ekran okuyucu ölçülmeyen parametreleri de okur). "Bir
    parametre 3 puan aldı" hapı motorun bildirdiği bir olgudur ve düzeyi değiştirmez.
```
with:
```markdown
  - **NEWS2 motorun.** Tek NEWS2 vardır, motorunki. Motor göndermediyse "NEWS2: —"; eksik vitalle
    hesaplanmışsa yanında "kısmi" hapı (ekran okuyucu ölçülmeyen parametreleri de okur). "Bir
    parametre 3 puan aldı" hapı motorun bildirdiği bir olgudur ve düzeyi değiştirmez.
    **Eski veri skora girmez** (G2-A2): penceresini aşmış bir ölçüm — solunum, SpO2, sistolik
    basınç ve nabız için 1 saat, ateş için 2 saat — toplama girmez, skor "kısmi" olur ve kartta
    hangi girdinin ne kadar eski olduğu yazar ("eski veri: SpO2 · 2 sa önce"; yaşı ekran söyler,
    "eski"ye motor karar verir). Yeni ölçüm gelmese de kart güncellenir: pencere kapanınca pano en
    geç ~20 saniye içinde yeniden gönderilir. Alarm da aynı skoru kullanır: eski bir ölçüm artık
    NEWS2'yi alarm bandına çıkaramaz. **Oksijen ve bilinç kaydedilmemişse varsayılır, söylenerek:**
    oda havası ve uyanık sayılır, kartta «varsayıldı: oda havası, uyanık» hapı çıkar; skor bunun
    için "kısmi" sayılmaz. Kaydedilmiş bir oksijen ya da ACVPU değeri 8 saat (bir vardiya) geçerlidir;
    sonra yeniden varsayılır ve hap "son kayıt …" der — süresi dolan "oksijen alıyor" toplamdan 2
    puan, V/P/U 3 puan düşürür. Pencereler ve 8 saat işletme varsayılanıdır, klinik iddia değildir;
    bir klinik değerlendirme değiştirene kadar böyledir. "Yeni konfüzyon" ayrıca modellenmez:
    ACVPU'da uyanık dışındaki her değer 3 puandır.
```

**Edit** `docs/homunculus-rehber-TR.md` — replace:
```markdown
  de bilerek aynı yanıtı veriyor (farklı bir yanıt hastanın orada yattığını ele verirdi). Pano
  okunamadıysa bunu söyler. Açılan her hasta denetim kaydına bir "görüntüleme" satırı bırakır;
  gösterilemeyen bir hasta için hiçbir şey yazılmaz.
```
with:
```markdown
  de bilerek aynı yanıtı veriyor (farklı bir yanıt hastanın orada yattığını ele verirdi). Pano
  okunamadıysa bunu söyler. Kapsamınız o an okunamıyorsa (veritabanı yanıt vermiyor) sunucu
  "bulunamadı" demez, "kapsam şu anda okunamıyor" der ve denetim kaydına bir kapsam ihlali yazmaz
  (G2-A2); pano da "Sunucuya bağlantı yok" şeridini gösterir. Açılan her hasta denetim kaydına bir
  "görüntüleme" satırı bırakır; gösterilemeyen bir hasta için hiçbir şey yazılmaz.
```

- [ ] **Step 2: The roadmap row**

**Edit** `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` — replace:
```markdown
X14: doktor zincir başına bir kez çağrılır) ve O1–O15 (O15: saatlerce yanıtsız kalan bir alarm için yinelenen çağrı yok — sonraki dilimde kullanıcı kararı); az/ru/en metinleri yerel okuma bekliyor |
```
with:
```markdown
X14: doktor zincir başına bir kez çağrılır) ve O1–O15 (O15: saatlerce yanıtsız kalan bir alarm için yinelenen çağrı yok — sonraki dilimde kullanıcı kararı); az/ru/en metinleri yerel okuma bekliyor |
| G2-A2 | Motor borcu: NEWS2 tazeliği — penceresini aşan ölçüm (vital 1 sa, ateş 2 sa) skora girmez, skor kısmi olur, kart hangi girdinin ne kadar eski olduğunu yazar, pencere kapanınca pano yeniden gönderilir; kaydedilmemiş oksijen ve bilinç «varsayıldı» diye işaretlenir (kısmi sayılmaz; kayıt 8 sa geçerli); alarm da aynı skoru kullanır; denetim okumaları en yeni satırlardan (`/audit` en çok 1000, `/alarm-quality` penceresini veritabanına sorar ve `truncated` der), yeniden başlatma her satırı sayfa sayfa okur; okunamayan kapsam 503 (sahte `scope_denied` satırı yok); `/ingest` hasta kimliği tek kural (kırpılır, boş olamaz, en çok 128, aksi 400) · spec: [2026-10-25](../specs/2026-10-25-g2a-motor-borcu-design.md) · plan: [G2-A2](2026-10-25-g2a-motor-borcu.md) | Kod ✅ 2026-10-25 · <range> · **VM'de değil** (spec §7: grubun kapısı ve sahibin Q2/D6/D8 onayı; api ve web aynı sürümde; göç yok). Backend 2354 / 654 (DB'siz), Postgres denetim ve kimlik testleri 54; Python 3.14 dilimi 291; dashboard 89 dosya / 2437 test; derleme 20 öğe. Kabul (spec §6.1, 6.2, 6.3, 6.5) geliştirme sunucusunda geçti — SQLite denetim, gerçek yeniden başlatma, sentetik yataklar; §6.4 (okunamayan kapsam) Docker yığınında kullanıcıyla. **Açık:** plandaki X1–X8 (X1: kısmi notu eski girdiyi de sayar; X2: kartın tamamı tek anda, antibiyotik saati ve eskalasyon yayını dahil; X3: sekizinci metin `assumedLast`; X4: kart saati üç ekrandan alır; X5: `patient_identity.py`'de içe aktarma satırı da; X6: rehberde kapsam cümlesi; X7: kabulün §6.4'ü Docker yığınında kullanıcıyla; X8: en yeni N bellekte sayıyla kesilir, sınırlar 1'den) ve O1–O9 (O2: Q2/D6/D8 VM'den önce sahibin onayı; O5: `/ingest`'in hasta kimliği dışındaki bozuk alanları hâlâ 500); az/ru/en metinleri yerel okuma bekliyor |
```

- [ ] **Step 3: The range**

```bash
cd /c/tmp/g2a-a2
git log --reverse --format=%h e1d23d8..HEAD -- homunculus-engine dashboard | sed -n '1p;$p'
```

It prints two short hashes, Task 1's and Task 6's. **Edit** the roadmap: replace `<range>` with `<first>..<last>`. If a review changed the counts, write the counts Task 8 measures instead of the ones in the row.

- [ ] **Step 4: Line ends**

```bash
cd /c/tmp/g2a-a2
for f in docs/homunculus-rehber-TR.md docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
grep -c "^| G2-A2 " docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md; grep -c "<range>" docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md
```

Expected: `homunculus-rehber-TR.md CR=1190 LF=1190`, `2026-10-01-tasarim-entegrasyonu-yol-haritasi.md CR=1295 LF=1295`; then `1` and `0`.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g2a-a2
git add docs/homunculus-rehber-TR.md docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md
git status --short && git diff --cached --stat
git commit -q -F - <<'MSG'
docs(guide): old data stays out of NEWS2, what was assumed is marked, an unreadable scope is said so; the roadmap row G2-A2

The guide's NEWS2 note: a reading past its window is out of the total and the
card says how old it is; the board is pushed when a window closes; the alert
uses the same score; room air and Alert are assumed with a «varsayıldı» mark,
not counted partial, and a charted value speaks for 8 h. The patient-screen
passage: a scope that cannot be read is "kapsam şu anda okunamıyor", not "not
found", and writes no violation (X6). The roadmap's Group 2 table gains G2-A2.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
git log --oneline -1
```

---

### Task 8: The gates, and the acceptance

Everything runs once more, in full, at the branch head; then the spec's §6 acceptance. **As proven by the planner (X7):** §6.1, 6.2, 6.3 and 6.5 on the engine's own dev server, from an export of the replay's head, with a real stop and start between the two phases — Steps 6–8 below, their output the record. §6.4 forces an unreadable scope by renaming the `staff_scopes` table, which needs the Postgres scope reader and a signed-in clinician: only the local synthetic Docker stack has both, and its container names (`homunculus-postgres`, `-api`, `-web`) were held by another stack — Steps 9–12 stay for the walk with the user and were **not run**. Never on the VM: the deploy and the VM acceptance with the user are a later, separate step (spec §7, O2, O8). No repo file changes in this task.

- [ ] **Step 1: The engine, no database**

```bash
cd /c/tmp/g2a-a2/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -1
```

Expected: `2354 passed, 654 skipped, 3 warnings in …` — the base's 2272 plus this slice's 82; the 4 new skips are `test_audit_newest.py`'s Postgres tests (Step 2 runs them).

- [ ] **Step 2: The Postgres-backed tests** (the command line only — never export the variable; the lock may make it wait, Task 0 Step 4)

```bash
cd /c/tmp/g2a-a2/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_audit_newest.py tests/test_audit_since.py tests/test_audit_postgres.py tests/test_patient_identity_postgres.py 2>&1 | tail -1
ls alembic/versions | tail -1
```

Expected: `54 passed in …` (the base's 34 and `test_audit_newest.py`'s 20); then `0011_users_must_change_password.py`, the base's newest migration — this slice adds none (spec §7).

- [ ] **Step 3: Python 3.14, the eleven touched engine test files**

```bash
cd /c/tmp/g2a-a2/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/g115-py314/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/rules/test_news2.py tests/rules/test_staleness_structured.py tests/test_pipeline.py tests/test_api_board_news2.py tests/test_board_freshness.py tests/test_audit_newest.py tests/test_api_audit.py tests/test_rehydrate.py tests/test_api_scope.py tests/test_gateway_fhir.py tests/test_api_patient_identity.py 2>&1 | tail -1
```

Expected: `291 passed, 4 skipped, 3 warnings in …`.

- [ ] **Step 4: The dashboard suite and build**

```bash
cd /c/tmp/g2a-a2/dashboard
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
```

Expected: ` Test Files  89 passed (89)` and `      Tests  2437 passed (2437)`; then `✓ built in …`, `precache  20 entries (…)`, no `larger than`.

- [ ] **Step 5: The slice's size, and Lane B's seams untouched**

```bash
cd /c/tmp/g2a-a2
git diff --stat f5b3a8b HEAD | tail -1
S="homunculus-engine/src/homunculus/admission homunculus-engine/src/homunculus/escalation homunculus-engine/src/homunculus/scope homunculus-engine/src/homunculus/tenant homunculus-engine/src/homunculus/auth dashboard/src/live/i18n/catalog.js dashboard/src/live/shell/routes.js dashboard/src/live/i18n/strings.test.js"
echo "lane B seams touched: $(git diff --name-only f5b3a8b HEAD -- $S | wc -l)"
echo "patient_identity.py hunks: $(git diff -U0 f5b3a8b HEAD -- homunculus-engine/src/homunculus/api/patient_identity.py | grep -c '^@@')"
git status --short
```

Expected: `33 files changed, …` — the replay's 32 code, test and doc files (`32 files changed, 1164 insertions(+), 98 deletions(-)`, with the roadmap row as Task 7 writes it) plus this plan; then `lane B seams touched: 0`, `patient_identity.py hunks: 3`, and no status line.

- [ ] **Step 6: The acceptance script** — `/c/tmp/homunculus-plans/g2a-a2/acceptance.py` (outside the repo, standard library only; read it before running it). It writes made-up readings for four synthetic beds through `/ingest` — `G2A2-1` (five fresh readings and a temperature 2 h 05 min old), `G2A2-2` (an SpO2 59 min old), `G2A2-3` (fresh vitals, then oxygen charted through `/clinical` 7 h 55 min ago), `G2A2-4` (2600 readings: more audit rows than one replay page) — plus three `/ingest` bodies whose patient id is not one; it listens to `/stream` for the two pushes and reads `/patients` and `/audit`. The token comes from `HOMUNCULUS_TOKEN` and is printed nowhere. **Never point it at the VM or any stack holding a real patient.** The first phase takes about five and a half minutes: it waits for the oxygen's 8 h boundary.

- [ ] **Step 7: The dev server, from an export of the head, and the first phase** (X7). The export keeps the worktree untouched; the dev server's SQLite audit lives in its own folder, synthetic, deleted afterwards.

```bash
EXP=/c/tmp/g2a-a2-accept && mkdir -p $EXP/srv
git -C /c/tmp/g2a-a2 archive HEAD homunculus-engine | tar -x -C $EXP
cd $EXP/srv
PYTHONPATH=$EXP/homunculus-engine/src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m uvicorn homunculus.api.devserver:app --port 18282 --log-level warning
```

(in the background: it is a server, not a gate; its token is the dev server's own `dev-token`; its escalation cycle runs every 20 s, which is what pushes). When `curl -s http://127.0.0.1:18282/health` answers `{"status":"ok"}`:

```bash
cd /c/tmp/homunculus-plans/g2a-a2
HOMUNCULUS_TOKEN=dev-token PYTHONIOENCODING=utf-8 /c/tmp/f7-py312/venv/Scripts/python.exe acceptance.py http://127.0.0.1:18282 before-restart
```

Expected — the record, from the replay's head (2026-10-25):
```
1 stale: total=2 partial=True stale=['temperature'] temperature points=0 measured 2 h 05 min ago
1 fresh at ingest: total=2 stale=[] fresh_until in 60 s
2 assumed: total=0 assumed=['air_or_oxygen', 'consciousness']; oxygen charted 7 h 55 min ago -> total=2 assumed=['consciousness']
5 ingest ids: 'Patient/' -> 400, 129 characters -> 400, subject "x" -> 400
3 audit: 200 rows, the tail of the newest 1000: True; the newest ingest row is the last reading: True
1 pushed: stale=['spo2'] total=0 15 s after its window closed
2 pushed: assumed=['air_or_oxygen', 'consciousness'] total=0 15 s after the 8 h boundary
3 digest of 4 beds written; readings posted for G2A2-4: 2600 (an ingest and an alert row each)
```
— §6.1: the temperature's point is out of the total, the score partial, the input named with its age; the 59-minute reading turned stale on the stream with no reading of ours to carry it, within one cycle (≤ 20 s) of its window closing (D5); §6.2: room air and Alert assumed and named; oxygen charted 7 h 55 min ago adds 2 and the mark goes; at 8 h it is pushed back, the 2 points gone (D8); §6.5: each bad id is a 400; §6.3's first half: `/audit` answers the newest rows. The seconds after a boundary vary between 0 and 20 with where the cycle falls.

- [ ] **Step 8: Stop the server, start it again in the same folder, the second phase.** Stop it (the background task), confirm the log holds more than one replay page, start the same command again from `$EXP/srv` (the SQLite audit is the restart's event log), and when `/health` answers:

```bash
/c/tmp/f7-py312/venv/Scripts/python.exe -c "import sqlite3; c = sqlite3.connect('C:/tmp/g2a-a2-accept/srv/homunculus-audit.db'); print('audit rows:', c.execute('select count(*) from audit').fetchone()[0])"
cd /c/tmp/homunculus-plans/g2a-a2
HOMUNCULUS_TOKEN=dev-token PYTHONIOENCODING=utf-8 /c/tmp/f7-py312/venv/Scripts/python.exe acceptance.py http://127.0.0.1:18282 after-restart
```

Expected — the record: `audit rows: 5214` (more than `REHYDRATE_PAGE`, 5000: the restart read two pages), then `3 after restart: the board is identical: True` — §6.3's second half. Stop the server; delete `/c/tmp/g2a-a2-accept` (an export and a synthetic audit — nothing of the repo) and `/c/tmp/homunculus-plans/g2a-a2/acceptance-digest.json`.

- [ ] **Step 9: With the Docker stack, when its names are free — not run (X7).** G1-15's synthetic stack files, as the G2-01 walk used them (`/c/tmp/g115plan/stack/{local.env, compose.g115.yml}`). The containers are named by the compose file, so no other such stack may be up:

```bash
cd /c/tmp/g2a-a2
ls /c/tmp/g115plan/stack/local.env /c/tmp/g115plan/stack/compose.g115.yml
docker ps -a --format '{{.Names}}' | grep -E '^homunculus-(postgres|api|web)$' || echo "no stack containers"
```

Expected: both files; `no stack containers`. **If a container is listed, stop and ask** — it is another session's. Then:

```bash
cd /c/tmp/g2a-a2
C="docker compose -p g2a2 -f deploy/local/docker-compose.yml -f /c/tmp/g115plan/stack/compose.g115.yml --env-file /c/tmp/g115plan/stack/local.env"
$C build api web 2>&1 | grep -E "Built|ERROR|precache"
$C up -d postgres api web 2>&1 | tail -3
docker exec -e TEST_USER_PASSWORD='G115-Sentetik-Parola-1' -e SEED_TENANT_SLUG=demo-hastanesi homunculus-api python scripts/seed_test_users.py
```

Expected: `Image g2a2-api Built`, `precache  20 entries …`, `Image g2a2-web Built`; three containers started; `docker inspect -f '{{.State.Health.Status}}' homunculus-api` → `healthy`; the seed prints its synthetic accounts (none of them a person). Steps 7 and 8's two phases run against `http://127.0.0.1:18080` with `HOMUNCULUS_TOKEN=$(grep '^TENANT_TOKEN=' /c/tmp/g115plan/stack/local.env | cut -d= -f2-)` and `$C restart api` between them; they print the same lines.

- [ ] **Step 10: §6.4, an unreadable scope — the Docker stack only, never the VM — not run (X7).** Rename the table only the scope reader reads (`read_scope_for_user` → `read_grants`), so the clinician's token still resolves but the scope does not; the resolver then logs `scope lookup failed … refusing rather than widening` and returns UNKNOWN (`scope/resolver.py:64–73`). The clinician's token goes into a shell variable and is printed nowhere.

```bash
docker exec homunculus-postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "ALTER TABLE staff_scopes RENAME TO staff_scopes_off"'
CLIN=$(/c/tmp/f7-py312/venv/Scripts/python.exe -c "import json, urllib.request; r = urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:18080/auth/login', data=json.dumps({'login': 'test.hemsire', 'password': 'G115-Sentetik-Parola-1'}).encode(), headers={'Content-Type': 'application/json'})); print(json.load(r)['access_token'])")
cd /c/tmp/homunculus-plans/g2a-a2
HOMUNCULUS_TOKEN=$(grep '^TENANT_TOKEN=' /c/tmp/g115plan/stack/local.env | cut -d= -f2-) HOMUNCULUS_CLINICIAN_TOKEN=$CLIN PYTHONIOENCODING=utf-8 /c/tmp/f7-py312/venv/Scripts/python.exe acceptance.py http://127.0.0.1:18080 unreadable-scope
docker logs homunculus-api 2>&1 | grep -c "refusing rather than widening"
docker exec homunculus-postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "ALTER TABLE staff_scopes_off RENAME TO staff_scopes"'
```

Expected: `ALTER TABLE`; then `4 unreadable scope: /patients -> 503 'kapsam şu anda okunamıyor'; /alerts/G2A2-1 -> 503 'kapsam şu anda okunamıyor'; device /patients -> 200; scope_denied rows: 0`; a count of at least 1; `ALTER TABLE`. **Rename it back even if a line fails.** An undecodable token does not reach this path on the real stack — it is a 401 earlier, in the caller's own resolver — which is why the table is renamed rather than the token spoiled (spec §6.4).

- [ ] **Step 11: By eye, in a browser — not run (X7).** Open `http://127.0.0.1:18080`, sign in as `test.hemsire` (the seed's password). **Çarpayılar**: `G2A2-1`'s card reads `NEWS2: 2` with «QISMƏN» and the line "köhnə məlumat: temperatur · 2 saat əvvəl" (the age goes on counting); `G2A2-3`'s pill «FƏRZ EDİLDİ: OTAQ HAVASI (SON QEYD 8 SAAT ƏVVƏL), OYAQ» (the pill writes upper case). Run Step 7's first phase again and watch `G2A2-2` turn stale with no reload, about a minute after the post. With Step 10's table renamed, reload: the strip says "Serverlə bağlantı yoxdur — xəstə siyahısı göstərilmir …" (UNAVAILABLE), not an empty ward. Dil: tr, ru, en — «varsayıldı: oda havası, uyanık», «по умолчанию: комнатный воздух, в сознании», «assumed: room air, alert».

- [ ] **Step 12: Tear it down.** `$C down -v` → the three containers and the `g2a2` volumes removed; `docker ps -a --format '{{.Names}}' | grep -E '^homunculus-(postgres|api|web)$' || echo "no stack containers"` → `no stack containers`.

No commit: nothing in the repo changed.

---

## Task order and parallel work

| Task | Needs | May run beside (own worktree) | Files it shares with a later task |
|---|---|---|---|
| 0 worktree, junction, baseline | — | — | — |
| 1 the engine: NEWS2 counts a reading only inside its window, says what it assumed; the alert scores the same (D1, D2, D6–D9, X1) | 0 | 3 | — |
| 2 the board: judged at the wall clock, `stale`/`assumed`/stamps, the cycle's push (D3–D5, X2) | 1 (`score(state, now)`, `fresh_until`) | 3 | `api/app.py` (4, 5, 6) |
| 3 the dashboard: the stale line with ages, the «varsayıldı» pill (D10, X3, X4) | 0 (it reads only the payload's shape: `stale`, `assumed`, `measured_at`) | 1, 2, 4, 5, 6 | — |
| 4 the audit reads: newest N, every row a page at a time (D11, D12, X8) | 2 (`api/app.py`, serially) | 3 | `api/app.py` (5, 6) |
| 5 an unreadable scope is 503 (D13, D13b) | 4 (`api/app.py`, serially) | 3 | `api/app.py` (6) |
| 6 `/ingest` patient ids (D14, X5) | 5 (`api/app.py`, serially) | 3 | — |
| 7 docs: the guide, the roadmap row (X6) | 1–6 (the range and the counts it quotes) | — | — |
| 8 gates, the acceptance (X7) | 1–7 | — | — |

**Why this order.** The engine before the board: the board publishes what `score(state, now)` returns, and Task 2's tests read `stale` and `fresh_until`. The dashboard depends on the payload's shape only, so it can be built beside the engine tasks. Tasks 2, 4, 5 and 6 all edit `api/app.py`, each in its own functions (the escalation cycle; the audit routes and `_ensure`; `_require_patient`, `/patients`, trends and the whole-trail routes; the import and the constant) — but Tasks 2 and 4 change neighbouring import lines (`api.board`, `api.audit`), which a merge of two parallel branches would have to resolve by hand, and every block's old text was asserted unique against the file **as the earlier tasks left it**. So they run serially; the engine's other files are not shared between tasks.

**Waves, if run in parallel:** A = {1 → 2 → 4 → 5 → 6} beside B = {3}; then 7, 8. The plan was measured in the serial order 0 → 8; a parallel merge must re-run Task 8's gates on the merged head.

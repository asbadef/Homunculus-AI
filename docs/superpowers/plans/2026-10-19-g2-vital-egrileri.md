# Vital trend charts (Group 2 · slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The patient screen's dashed "Vital eğrileri" placeholder becomes six engine-backed trend cards, a big chart per card (6 h / 24 h / 3 days, a readout, the alarm and antibiotic marks, an accessible table) and a "Hastanın normali" form — all served by one new read endpoint that carries the thresholds as data.

**Architecture:** The engine composes, the browser draws (spec D1). `rules/news2.py` turns its five if-chains into one table, `NEWS2_BANDS`, that the score and the charts both read; `state/timeline.thin()` caps a series for drawing; the three audit logs gain `records(since=)`; `api/trends.py` builds the answer (every reading with the engine's NEWS2 points for it, the latest value's delta / points / own-normal verdict, the bands, the alarm-episode and antibiotic marks) and `api/app.py` mounts `GET /patients/{patient_id}/trends` behind the board's own permission and scope checks. The dashboard reads it through `useTrends` (inside the session's `track`, polling only while READY and visible, keeping the last answer when a read fails), draws it with a pure `trendGeometry.js` and an SVG `TrendChart`, and writes the patient's normal through `PUT /clinical/{id}/profile` with a body of `{baselines}` alone.

**Tech Stack:** Python 3.12 and 3.14, FastAPI, SQLAlchemy/psycopg2 (Postgres) and sqlite3, pytest; React 18, Vite, Vitest + Testing Library (`fireEvent`; no user-event), Tailwind on the live token classes, inline SVG (no chart library).

**Spec (authoritative):** `docs/superpowers/specs/2026-10-19-g2-vital-egrileri-design.md`. Where the code made the spec's letter impossible or unsafe, this plan departs from it; every departure is in the table below with its file and line, and is an open item for the user. **2026-10-20:** the user approved X1–X19 and chose explicit clearing for O4 — Task 14a and Task 14's clear; X21 was found while amending (X20 is kept for the thinning departure the Task 2 review found, which Task 17 adds from the controller's open-items list). **Second amendment, 2026-10-20:** Task 3b (the gateways refuse NaN/±inf), Task 4's two changes (non-finite readings skipped; the marks' read bounded by the window and flagged — X22), and Task 8's strings as the Task 8 quality review corrected them (lane commit `f082251`), mirrored in every later task that quotes them. **Third, 2026-10-20:** for the tasks the lanes have done, the plan now IS their code — Tasks 1–4 and 3b as `feat/g2v-be` has them (head `bd8afda`), Tasks 6–10 as `feat/g2v-dash` has them (head `339c3f2`), review follow-ups included (X23, X24); Task 11's card edits are rebased on the reviewed card and Task 12's box carries the lane's `Note`; Task 12's legend says MAP has no NEWS2 band, that ▲ is a first detection (O17) and when the marks' read stopped at its limit; Task 14a refuses non-finite bounds. **Fourth, 2026-10-20:** the backend lane's last commits mirrored (Tasks 4, 5 and 14a as `e933ca1` has them — X25) and the dashboard lane's Task 11 (`4ecbc11` — X26); Tasks 12–15 rebased on it; Task 12 settles the review's chart items — value labels at the nearest round step (d3's thresholds), no finer than the data is measured and never past the data, time labels anchored to the edge they would cross, MAP's hollow dots filled with the dialog's own ground, and every mark at an instant named in the readout. **Fifth, 2026-10-20:** Task 12 mirrored to the dashboard lane's `a877057` (X27; its geometry, chart and their tests now written whole); Task 13 rebuilt on it — the keyboard steps over instants (two readings at one instant are one stop), the axis, the readout and the table share `trendText.js`, a mark beside a reading carries its own time when that reads differently, and the dialog opens with focus on the pressed window option; Tasks 14–15 re-checked on it. **Sixth, 2026-10-20:** Task 13 mirrored to the dashboard lane's `372e781` (X28 — the keyboard chart an application — X29 — the table carries the legend's notes — X30 — a MAP read at another minute keeps its own time — and the review's minors); its files written whole; Tasks 14–17 re-checked against it, their anchors unchanged.

**How the numbers in this plan were obtained.** All seventeen tasks were implemented, in this order, in the worktree while the plan was written, and every red, every green and every count below is what was printed; the tree was then restored to `b6ed65d` and only this file was committed. The O4 amendment (Task 14a, Task 14's clear) and then the second amendment (Task 3b, Task 4, the review's strings) were implemented the same way on top of all seventeen on 2026-10-20, and every suite re-run; the third pass (the lanes' code mirrored into Tasks 1–4, 3b and 6–10, Tasks 11–17 rebased on it) was verified by replaying the whole plan into the worktree and running every suite on that replay; a count marked *derived* is the measured one minus a later task's measured delta. The verified implementation is kept beside the per-task files as `/c/tmp/homunculus-plans/g2v/reference.patch` — a cross-check, not the authority: build from the tasks.

---

## What the code says that the spec did not (read before Task 1)

| # | Spec | Code at `b6ed65d` | This plan |
|---|---|---|---|
| X1 | §4: `_require_patient` gives "403 out of scope, 404 unknown patient, 503 scope unreadable (the same three the board gives)" | `_require_patient` (api/app.py:476–514) answers **404** for out of scope *and* for an unreadable scope (`UNKNOWN = Scope(False, "unknown")`, scope/resolver.py:23, sees nothing); 403 is the missing permission (`_require`, app.py:436–440); 503 exists only at `/stream-ticket` (app.py:889–894); `/patients` answers 200 with an empty board. The roadmap already records "her yerde 503 olmalı" (roadmap l. 659). | 401 no credential · 403 without `board.view` (before the scope is asked) · 400 bad `hours` · **503 when the scope is UNKNOWN**, checked before `_require_patient` · 404 out of scope (audited `scope_denied`) or unknown id (nothing created). |
| X2 | §4 example bands `{"low": 41, "high": 50}` | The rules score real numbers with `<=` chains (rules/news2.py:23–84); whole-number rows leave `40 < v < 41` in no row. | Rows are `low < value <= high`: `{"low": 40, "high": 50, "points": 1}` — contiguous, and exactly the old boundaries. |
| X3 | §4: "`markers.alarm` are the patient's audited `alert` events" | The engine re-emits every active alert on every reading (pipeline.py:91–96) and `/ingest` appends an `alert` row for each (app.py:684–687); api/alarm_quality.py:14–18: "The unit is the episode, not the alert row … `first_seen` is stamped exactly once per episode". | Alarm marks are `first_seen` rows (one per episode — and today, because the engine never clears an active alert's kind, one per patient and kind ever: O17; the legend calls ▲ the first detection), at the escalation clock's own instant (`payload["at"]`, else `ts`). |
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
| X15 | §3.3: "the engine refuses an empty profile" | Only when no comorbidity and no baseline SOFA is charted either (api/clinical.py:249–259); with either, `{"baselines": {}}` is accepted and clears every baseline. | **Amended 2026-10-20 (O4, the user chose explicit clearing):** Task 14a — the engine takes `{"baselines": {}}` over a charted profile as "clear every range", even with nothing else charted (still refused from nothing, or without a `baselines` key), and the replay reads each profile row over the one before (api/rehydrate.py:61 read it from nothing, so the clearing row was refused on replay and the cleared range came back after a restart). Task 14's form sends it when every row is emptied over a charted set and says so before and after; with nothing charted, Save stays `aria-disabled` (X14). |
| X16 | §5 | Two route registries the spec does not name must list the route: tests/test_board_permissions.py `BOARD_EXPECTED` and tests/test_tenant_isolation.py `UNSCOPED_BY_DESIGN`; and the dashboard's apiErrors.test.js reads every `detail="…"` literal of api/app.py, so the route's new 400 needs an `errors.*` key in the same task. | Task 5 does all three. |
| X17 | §6 the form "on the kit's Modal, Field, Button"; prefill "from `bands.own_normal` of the current response" | The engine REPLACES the whole set with what is sent. | The button is offered only once the trends have answered and while they are readable: the form must open on the set it replaces. |
| X18 | — | `refusal.js` is `src/live/screens/admin/refusal.js`, not `src/live/refusal.js`. | The form imports `mayHaveLanded` from there (the one rule). |
| X19 | — | `src/reachable.test.js` fails on any module `main.jsx` cannot reach. | The dashboard is built top-down: each task wires the module it creates (Task 9 wires the box before any card exists). |
| X21 | §3.3: the save's toast "Hastanın normali kaydedildi; motor yeniden değerlendirdi" | `PUT /clinical/{id}/profile` (api/app.py:608–640) sets the profile, audits it and republishes the board; it re-scores nothing — the standing alerts are the last reading's until the next one (`Engine.ingest`, pipeline.py:51). The trends answer does re-read the profile (the own-normal band and pill). Found while amending for O4, 2026-10-20. | A save keeps the spec's sentence (Task 8, unchanged — open item O12). A clear, new with the amendment, says only what is true: the ranges are deleted and the next reading is judged without them (Task 14). |
| X22 | §4 the response shape; §4 "markers.alarm are the patient's audited alert events" | `records(…, since=, limit=)` returns the OLDEST rows at or after `since` (ORDER BY id); `AckStore.prune` (api/ackstore.py:28–33) drops the `first_seen` stamp when an alert clears, so a flapping alert writes a row each time it comes back — ≈ 30/h at one reading a minute, ≈ 2 160 in 72 h. Readings replayed from the audit (`rehydrate`) pass no gateway, so a NaN/±inf from before Task 3b can sit in `PatientState`. Found by the Task 2 and Task 3 quality reviews, 2026-10-20. | Task 4: the marks' read takes up to 5000 rows and the answer gains `markers_truncated` (additive); a non-finite reading is never in `points`, `total_points` or `latest`. Task 3b closes the two gateways. |
| X23 | §6 `useTrends`: "on a new measurement … every 60 s while READY and visible" | The plan's hook superseded every read in flight on any trigger — a new measurement, the tick, a wake, a reload — so at Stage B's rates a chart could never fill. Found by the Task 9 quality review, 2026-10-20. | The lane's hook (Task 9, commit `dac5051`): a read is discarded only on a patient, window or key change, on leaving READY and on unmount; a same-key trigger during a read queues ONE more read when it settles; the timer sleeps while the page is hidden; `reload()` reads only while READY; the unreadable line is a warn `Note`. Return shape unchanged. |
| X24 | §3.1: the card's values "in the channel's identity colour"; the own-normal pill beside the frame | Daylight `--v-map` is exactly `--crit`: a calm pressure card showed critical-red numbers, and a 3-point pulse showed green numbers in a red frame. A NEWS2 channel whose latest value came with no finite points read as calm. In Russian "САД" reads as systolic, where a vasopressor target is a MAP. Found by the Task 10 quality review, 2026-10-20. | The lane's card (Task 10, commits `4cdb563` and `339c3f2`): values in `text-ink`, the identity colour on the title and (Task 11) the line; the badge and the pill on the first channel's reading row; "NEWS2: —" in attention tone, with its reason for a screen reader, for an unscored NEWS2 channel; the delta's direction in words for a screen reader; no age without a finite clock; `border-2` in every tone; ru `board.chMap` "СрАД". Task 12's legend says MAP is not scored by NEWS2. **User eye-check in Task 16:** say if the prototype's coloured numbers should come back. |
| X25 | §4: the route checks the scope "the same way the board does" | `_require_patient` resolved the caller's scope itself, and the trends route resolved it first too (to answer 503 for one that cannot be read): two look-ups on every minute's poll, and a blip between them could answer 404 for a patient in scope. Found by the Task 5 quality review, 2026-10-20. | `_require_patient(caller, authorization, patient_id, *, scope=None)` takes a scope already resolved; the trends route passes the one it read; every other route leaves it out (Task 5, commit `1b91f81`). `TREND_WINDOWS_TEXT` names the windows once. |
| X26 | §3.1: every card's 46 px mini chart "with the NEWS2 bands and the patient's normal" | A calm patient's pressure card carried a permanent red stripe — the systolic ≤ 90 row scores 3 — behind MAP dots NEWS2 never scores, and the mini chart is `aria-hidden` with no legend to explain it. The controller's decision from the Task 11 quality review, 2026-10-20. | A card with more than one series draws NO NEWS2 tints and no own-normal band in its mini chart (the card passes `bands=null`); single-series cards keep theirs; the big chart keeps everything, with its legend (Task 11, commit `4ecbc11`). The frame and the badge still carry the points. |
| X27 | §3.2: the readout "HH:MM · value unit" of the measurement under the cursor | On the pressure card the readout named only the systolic reading; MAP — the vasopressor target — was drawn at the same instant and not read. Found by the Task 12 quality review, 2026-10-20. | The readout reads EVERY series of the card at the cursor's instant — "Sistolik AT 118 · MAP 80 mmHg", one unit when they share it, "—" where a series has no reading then (Task 12, commit `a877057`). The cursor is an instant, not an index (`indexAtTime`), so a poll that slides the window does not move it to another reading. |
| X28 | §6 `TrendChart`: "`role="img"` with a summarising `aria-label`"; §7: the keyboard moves the cursor and the reader hears the readout | NVDA and JAWS stay in browse mode over an `img`: ← → move the virtual caret, Home / End the line, and the page never sees the key — §7's promise was unreachable by default on Windows (VoiceOver was fine). Found by the Task 13 quality review, 2026-10-20. | A chart that takes ← → Home End is `role="application"` with a localised `aria-roledescription` (`patient.trendsChartRole`, four languages); its name and `aria-describedby` are unchanged. With no drawable reading in its first series (the cursor's) it is no tab stop — no `tabindex`, no hint, no keys. The card's mini chart stays `aria-hidden` with no role (Task 13, commit `50589dd`). |
| X29 | §3.2: the table view "the same numbers"; the legend under the graph | The legend's honesty notes — thinned "N nöqtədən M", the marks' read cut short, MAP not scored, ▲ a first detection — showed only under the graph: a thinned table looked like the complete list, and a newest-first table without the truncation sentence invites "no antibiotic mark lately" = "no antibiotic given". Task 13 quality review. | `TrendNotes`, split out of `TrendLegend`, renders the notes under BOTH views; the table says `trendsNoData` when the channel has no readings (Task 13, commit `50589dd`). |
| X30 | §3.2: the readout of the measurement under the cursor | X27's "MAP beside systolic" read the MAP at the systolic's instant within one pixel column — about 80 s at 24 h on the 1180 px dialog, 4 min at 72 h, 16 min at 72 h on a 390 px phone — and printed it with the systolic's time. Task 13 quality review. | `valueBeside` in `trendText.js`: a MAP read at another minute prints its own time, and then each number carries its unit ("Sistolik AT 95 mmHg · MAP 70 mmHg (10:17)") — the rule `markBeside` gives marks (Task 13, commit `50589dd`). |

---

## Baseline at `b6ed65d` (measured 2026-10-19)

- **Dashboard:** `npx vitest run` → **81 files / 1912 tests**, all passing. `npx vite build` clean, precache 20 entries.
- **Backend, the brief's command** (`--ignore=tests/test_infinity_vm_pilot.py`, no `PYTHONPATH`, no database): **1979 passed, 644 skipped, 2 failed** — `test_infinity_research.py::test_schema_validation_remains_active_under_optimized_python` and `test_jwt_caller.py::test_the_refusals_run_when_prodserver_is_imported`. Both spawn a child `python` that cannot `import homunculus` (`ModuleNotFoundError: No module named 'homunculus'`): the f7-py312 venv does not have this worktree installed. **With `PYTHONPATH=src` both pass: 1981 passed, 644 skipped, 0 failed.** Every Python command below sets `PYTHONPATH=src`.
- **Backend with Postgres** (`TEST_DATABASE_URL=…/homunculus_test_g2v`, `PYTHONPATH=src`): **2617 passed, 8 skipped** in 25 min 41 s — longer than one Bash call may run (10 min), so Task 15 runs it in five parts.
- **Python 3.14:** `/c/tmp/g115-py314/Scripts/python.exe` (3.14.5) runs this worktree's tests with `PYTHONPATH=src`.

## Counts after each task (merged in plan order)

If tasks are merged in another order, a total is the base plus the deltas of the tasks merged; each task also states its own files' counts, so a wrong total can be traced to a file.

| After | Backend, no DB (passed / skipped) | Dashboard (files / tests) | This task's test files |
|---|---|---|---|
| base | 1981 / 644 | 81 / 1912 | — |
| 1 | 1995 / 644 | — | `test_news2_bands.py` **14** (new) |
| 2 | 2012 / 644 | — | `test_timeline_thin.py` **17** (new) |
| 3 | 2027 / 650 | — | `test_audit_since.py` **15 + 6 skipped** without the DB, **21** with it (new) |
| 3b | 2036 / 650 | — | `test_gateway_hl7.py` 14 → **18**, `test_gateway_fhir.py` 5 → **10** |
| 4 | 2065 / 650 | — | `test_trends.py` **29** (new) |
| 5 | 2096 / 650 | 81 / 1915 | `test_trends_api.py` **21** (new); isolation 15 → **18**; board_permissions 55 → **57**; tenant_isolation 109 (a registry row, no new test); dashboard `apiErrors.test.js` 141 → **144** |
| 6 | — | 81 / 1922 | `backendApi.test.js` 104 → **111** |
| 7 | — | 81 / 2130 | `tokens.test.js` 192 → **400** |
| 8 | — | 81 / 2130 | `strings.test.js` 6 → **6** (it loops; no count moves) |
| 9 | — | 82 / 2152 | `useTrends.test.jsx` **17** (new); `PatientScreen.test.jsx` 50 → **55** |
| 10 | — | 84 / 2177 | `news2Tone.test.js` **2**, `TrendCard.test.jsx` **21** (new); PatientScreen 55 → **57** |
| 11 | — | 86 / 2262 | `trendGeometry.test.js` **22**, `TrendChart.test.jsx` **19** (new); TrendCard 21 → **25**; `tokens.test.js` 400 → **440** |
| 12 | — | 87 / 2298 | `TrendModal.test.jsx` **26** (new); trendGeometry 22 → **30**; TrendChart 19 → **20**; PatientScreen 57 → **58** |
| 13 | — | 88 / 2333 | TrendModal 26 → **53**; `trendText.test.js` **4** (new); TrendChart 20 → **22**; trendGeometry 30 → **31**; TrendCard 25 → **26** |
| 14a | 2126 / 650 | — | `test_api_patient_profile.py` 27 → **56**; `test_trends.py` 29 → **30** |
| 14 | — | 89 / 2350 | `BaselineForm.test.jsx` **15** (new); PatientScreen 58 → **60** |
| 15 | — | 89 / 2351 | `rawKeys.test.jsx` 6 → **7** |
| 16 | 2130 / 650 | — | `test_scenario_rebase.py` **4** (new) |
| 17 | — | — | docs only |

Measured: the base; backend after 16 and dashboard after 15 (the whole replay, 2026-10-20); the dashboard after 6, 7, 8, 9, 10, 11, 12 and 13 at the lane's commits (`950176d`, `e2afede`, `f082251`, `dac5051`, `339c3f2`, `4ecbc11`, `a877057`, `372e781` — each the row minus 3, Task 5's `apiErrors` tests, which the dashboard lane does not carry). The other rows are the per-file counts summed. Tasks 1–5, 3b, 14a and 6–13 are the lanes' code as reviewed (their follow-up commits included), so these are the counts the lanes have.

Backend arithmetic: 14 + 17 + 15 + 9 + 29 + (26 + 3 + 2) + 30 + 4 = **149** passed and **6** skipped over the base. Dashboard: 3 + 7 + 208 + 0 + 22 + 25 + 85 + 36 + 35 + 17 + 1 = **439** tests and 8 files.

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
- **Foreground gates.** Run every suite and build in the foreground; never background a gate and wait on it (an agent that did sat silent for hours). One Bash call runs at most 10 minutes: name the files; the whole Postgres-backed suite runs in five parts (Task 15).
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
| `src/homunculus/api/trends.py` | Builds the trends answer: series with per-reading NEWS2 points, latest facts, bands, marks (`markers_truncated` when the episode read stops at its limit). Skips a non-finite reading. Never creates a patient, writes no audit row, imports nothing of Aşama A. | 4 |
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
| `src/homunculus/gateway/hl7.py`, `src/homunculus/gateway/fhir.py` | a non-finite value: HL7 drops the field, FHIR raises `GatewayError`. | 3b |
| `tests/test_gateway_hl7.py`, `tests/test_gateway_fhir.py` | the sentinels, and `/ingest`'s 400 to a NaN token. | 3b |
| `src/homunculus/api/app.py` | `GET /patients/{patient_id}/trends`. | 5 |
| `src/homunculus/api/clinical.py` | `profile_from_payload`: `{"baselines": {}}` over a charted profile clears every range. | 14a |
| `src/homunculus/api/rehydrate.py` | `_replay_profile` reads each row over what the replay restored so far. | 14a |
| `tests/test_api_patient_profile.py` | twelve tests: the clear, what stays refused, the door, the next reading, the restart; five non-finite bounds. | 14a |
| `tests/test_trends.py` | a replayed profile row with a NaN bound never reaches the answer. | 4, 14a |
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
| `src/live/i18n/strings/patient.js` | 49 keys × 4 languages; `onlyWrite` and `formsSoon` reworded (8); `trendsSoon` removed (9); `trendsDeltaUp/Down/Same`, `trendsPointsUnknown[Sr]` (10); `trendsLegendNoBand`, `trendsLegendAlarm`, `trendsLegendMarksTruncated` (12); `baselineClearsAll`, `baselineClearedAll` (14). | 8, 9, 10, 12, 14 |
| `src/live/i18n/strings/board.js` | ru `chMap` "СрАД" ("САД" reads as systolic). | 10 |
| `src/live/i18n/strings.test.js` | one `NEUTRAL` and five `AZ_SAME_AS_TR` entries (8); `trendsPointsUnknown` in both (10). | 8, 10 |
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
| 3b the gateways refuse non-finite values | — | any task (its four files are touched by no other) | — |
| 4 the builder | 1, 2, 3 | 9 → 14, 3b | — |
| 5 the route | 4 | 9 → 14 (its two dashboard files, `apiErrors.js` and `errors.js`, are touched by no other task) | — |
| 6 the API client | — | 1, 2, 3, 7, 8 | `testTokens.testutil.js` |
| 7 the tokens | — | 1, 2, 3, 6, 8 | — |
| 8 the strings | — | 1, 2, 3, 6, 7 | `strings/patient.js` (9, 14) |
| 9 the box reads the endpoint | 6, 8 | 4, 5 | `TrendsBox.jsx`, `PatientScreen.jsx` + test |
| 10 the six cards | 9 | 4, 5 | `TrendsBox.jsx`, `PatientScreen.*` |
| 11 the mini chart | 10 (and 7 for the colours to render) | 4, 5 | `TrendCard.jsx`, `TrendsBox.jsx` |
| 12 the big chart | 11 | 4, 5 | `TrendChart.jsx`, `trendGeometry.*`, `TrendsBox.jsx` |
| 13 keyboard and table | 12 | 4, 5 | `TrendModal.*`, `TrendChart.jsx` |
| 14a the engine clears the last range | 4 (Steps 6–8 edit `test_trends.py`) | any task after 4 (its other files are touched by no other) | — |
| 14 the patient's normal | 13, 6 (14a for a real engine to take the clear; the tests stub the API) | 4, 5, 14a | `TrendsBox.jsx`, `PatientScreen.test.jsx` |
| 15 sweeps and the full gates | 1–14, 3b, 14a | — | `rawKeys.test.jsx` |
| 16 replay and the local walk | 15 | — | — |
| 17 docs | 16 | — | — |

**Waves:** A = {1, 2, 3, 6, 7, 8} in six worktrees; B = {4} beside {9}; C = {5} beside the chain 10 → 11 → 12 → 13 → 14 (sequential: each edits `TrendsBox.jsx`); then 15, 16, 17. **3b** and **14a** (the amendments of 2026-10-20) join whichever wave is running when they are picked up — 3b needs nothing and shares no file; 14a needs Task 4 (its Steps 6–8 edit `test_trends.py`) — and both must be merged before 15. (The controller runs 3b in the backend lane before Task 4.)

---

# Part 1 · The engine (Tasks 1–5)

### Task 1: NEWS2's rows as data — one table the score and the charts both read

**Done in the backend lane** (`feat/g2v-be`, commits `de0085f` and `dfbc69e`, the Task 1 quality review); the blocks below are that code.

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
from homunculus.state.timeline import PatientState

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
    # `_CORE_VITALS` is a constant score() never reads, so pin the scorer's own breakdown names and
    # their order too: an empty state lists every core vital as missing, in the order score() walks.
    assert news2.score(PatientState("p-a1")).missing == list(NEWS2_BANDS)
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
    # Both rows give a value the real table never gives there (100 scores 1, 201 scores 3), so each
    # assertion can only hold if the function reads the patched table.
    monkeypatch.setitem(NEWS2_BANDS, "pulse", (Band(None, 200, 2), Band(200, None, 0)))
    assert news2.pulse_points(100) == 2
    assert news2.pulse_points(201) == 0


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
#: That note is `capture: extract`: the Scale 1 rows come from its secondary renderings, and the
#: primary RCP chart is not captured in full.
#: Served with the rows by the trends endpoint, so a chart's legend names it.
BANDS_SOURCE = "news2-rcp-2017"


@dataclass(frozen=True)
class Band:
    """One row of a NEWS2 parameter's chart: a value with `low < value <= high` scores `points`.

    `None` is an open side. The vault writes the chart at the chart's own resolution (whole
    numbers; tenths for temperature), e.g. 41–50 → 1, but the engine scores real numbers, and rows
    written that way leave 40 < value < 41 belonging to none of them. So each row's lower edge is
    the previous row's upper edge, exclusive: the rows tile the line with no gap and no overlap,
    and every boundary sits where the if-chains these replaced had it.
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

**Done in the backend lane** (commits `7a33576` and `cd5fb9a`, the Task 2 quality review: two more tests, the preconditions in words); the blocks below are that code.

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


def _micros(moment: datetime) -> int:
    """A moment as whole microseconds since T0 — exact integer arithmetic, no floats."""
    return (moment - T0) // timedelta(microseconds=1)


def _slices(series: list[Observation], buckets: int) -> list[list[Observation]]:
    """The series cut into `buckets` equal slices of its time span, as the docstring defines them.

    The slice of a reading is `(its offset) * buckets // span`, in integer microseconds, so the
    edges are checked against exact arithmetic and not against the float expression `thin()` uses.
    """
    t0_us = _micros(series[0].timestamp)
    span_us = _micros(series[-1].timestamp) - t0_us
    out: list[list[Observation]] = [[] for _ in range(buckets)]
    for obs in series:
        at = 0 if span_us <= 0 else min(buckets - 1,
                                        (_micros(obs.timestamp) - t0_us) * buckets // span_us)
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


def test_a_cap_of_exactly_four_keeps_the_first_last_lowest_and_highest():
    values = [95.0, 91.0, 97.0, 93.0, 85.0, 99.0, 94.0, 92.0, 96.0, 90.0]
    series = [_obs(i * 60, value) for i, value in enumerate(values)]

    kept = thin(series, 4)                    # the smallest cap: one slice, up to four readings

    assert len(kept) <= 4
    held = {id(o) for o in kept}
    assert id(series[0]) in held and id(series[-1]) in held
    assert id(min(series, key=lambda o: o.value)) in held
    assert id(max(series, key=lambda o: o.value)) in held


def test_a_cap_that_is_not_a_multiple_of_four_is_rounded_down_to_whole_slices():
    rng = random.Random(2003)
    series = [_obs(i * 10, round(rng.uniform(80, 100), 1)) for i in range(6000)]

    kept = thin(series, 2003)

    assert len(kept) <= 4 * (2003 // 4)       # 2 000: whole slices of four, never 2 003


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

    Preconditions: `series` in time order, as `window()` returns it; values are finite (the
    gateways' contract).

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

And the module says what it now holds (the Task 2 quality review, lane commit `cd5fb9a`) — replace:

```python
"""Per-patient current values, history, and staleness."""
```

with:

```python
"""Per-patient current values, history, and staleness — and `thin()`, a pure helper that caps an
observation series for drawing."""
```

- [ ] **Step 4: Green.**

```bash
cd /c/tmp/g2-vital/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_timeline_thin.py tests/test_state_timeline.py 2>&1 | tail -1
```
Expected: `25 passed` — 17 new (the Task 2 quality review, lane commit `cd5fb9a`, added the cap's lower boundary and a non-multiple of 4), `test_state_timeline.py` 8 unchanged.

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

**Done in the backend lane** (commits `9f5aae5` and `5571cfb`, the Task 3 quality review: the Postgres cast pinned by a row the text would order wrongly, one `_now_iso` for every backend); the blocks below are that code.

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
import re
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
# What `_now_iso()` writes: UTC, six fraction digits or none, always "+00:00" (never "Z").
TS_SHAPE = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{6})?\+00:00")


def _event(**over) -> AuditEvent:
    base = dict(tenant="HOSP1", event_type="first_seen", patient_id="S-001", subject="news2",
                payload={"at": "2026-10-19T09:00:00+00:00"})
    return AuditEvent(**{**base, **over})


def _two(log):
    """Two appends with a clear instant between them; returns their records."""
    first = log.append(_event())
    stamped = datetime.fromisoformat(first.ts)
    # Wait until the clock has strictly passed the first stamp rather than sleeping a fixed time:
    # on Windows the clock can tick at ~15.6 ms, and a short sleep may give both rows one `ts`.
    while datetime.now(timezone.utc) <= stamped:
        time.sleep(0.001)
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


def test_append_stamps_ts_in_the_shape_the_sqlite_comparison_needs(log):
    # SQLite compares `ts` as text against `bound.isoformat()` (UTC, "+00:00"); a "Z" suffix or a
    # local offset written by `append` would silently break `since` there.
    record = log.append(_event())
    assert TS_SHAPE.fullmatch(record.ts), record.ts
    assert [TS_SHAPE.fullmatch(r.ts) is not None for r in log.records()] == [True]


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
def test_postgres_stamps_ts_in_the_same_shape(pg_log):
    record = pg_log.append(_event())
    assert TS_SHAPE.fullmatch(record.ts), record.ts
    assert [TS_SHAPE.fullmatch(r.ts) is not None for r in pg_log.records()] == [True]


@requires_db
def test_postgres_compares_instants_where_the_text_would_say_otherwise(pg_log):
    """Pins the `timestamptz` cast, not a real row: no writer stores a non-UTC `ts`
    (`_now_iso`, `PostgresAuditLog.append`).

    "2026-10-20T12:30:00+04:00" is 08:30 UTC, before the 09:00 UTC bound, yet as text it sorts
    AFTER "2026-10-20T09:00:00+00:00" (the hour's "1" > "0", in every collation). Only comparing
    instants leaves it out.
    """
    stamps = ["2026-10-20T12:30:00+04:00", "2026-10-20T09:00:00+00:00"]
    with pg_log._engine.begin() as conn:                   # noqa: SLF001
        for ts in stamps:
            conn.execute(text("INSERT INTO audit (ts, tenant, event_type, patient_id, subject, payload)"
                              " VALUES (:ts, 'HOSP1', 'first_seen', 'S-001', 'news2', '{}'::jsonb)"),
                         {"ts": ts})
    bound = datetime(2026, 10, 20, 9, 0, tzinfo=timezone.utc)
    assert [r.ts for r in pg_log.records(since=bound)] == ["2026-10-20T09:00:00+00:00"]


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
Expected: `18 failed, 3 passed` (`13 failed, 2 passed, 6 skipped` without the database; three cases pin what holds already) — `TypeError: InMemoryAuditLog.records() got an unexpected keyword argument 'since'` (and the same for `SqliteAuditLog`, and Postgres' `PostgresAuditLog.records()`), and `KeyError: 'since'` from the four signature cases. Without the database: `13 failed, 4 skipped`.

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
from homunculus.api.audit import (
    GENESIS_HASH, AuditEvent, AuditRecord, _now_iso, chain_hash, since_utc)
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

(c) and (d) — the Task 3 quality review (lane commit `5571cfb`): Postgres stamps `ts` with the same `_now_iso()` the other two logs use, so every backend writes one shape. Replace:

```python
from datetime import datetime, timezone
```

with:

```python
from datetime import datetime
```

and replace:

```python
            ts = datetime.now(timezone.utc).isoformat()
```

with:

```python
            ts = _now_iso()
```

- [ ] **Step 5: Green, with and without the database.**

```bash
cd /c/tmp/g2-vital/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:55432/homunculus_test_g2v PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_audit_since.py tests/test_audit_postgres.py tests/test_audit_memory.py tests/test_audit_sqlite.py tests/test_audit_chain.py tests/test_api_audit.py tests/test_rehydrate.py 2>&1 | tail -1
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_audit_since.py 2>&1 | tail -1
```
Expected: `73 passed` (21 + 11 + 4 + 5 + 21 + 5 + 6), then `15 passed, 6 skipped`.

- [ ] **Step 6: Commit.**

```bash
cd /c/tmp/g2-vital
git add homunculus-engine/src/homunculus/api/audit.py homunculus-engine/src/homunculus/api/audit_postgres.py homunculus-engine/tests/test_audit_since.py
git status --short && git diff --cached --stat
git commit -m "feat(engine): audit records(since=) in memory, SQLite and Postgres — instants, not text" -m "A zone-aware lower bound on ts (since_utc refuses a naive one). SQLite compares the isoformat text byte by byte (every ts is _now_iso); Postgres casts both sides to timestamptz, because TEXT follows the collation. /audit is unchanged; only the trends endpoint passes since.

red: 18 failed, 3 passed (13 failed, 2 passed, 6 skipped without the DB) — TypeError: ...records() got an unexpected keyword argument 'since'; KeyError: 'since'" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3b: The gateways refuse non-finite values

**Done in the backend lane** (commit `b2ea2e5`); the blocks below are that code.

**Added 2026-10-20 (the Task 2 quality review; the controller's decision).** `float()` reads "NaN", "nan", "inf", "-Infinity" without complaint, and so does JSON as Python reads it: the edge bridge's `json.dumps` writes a bare `NaN` token and Starlette's `request.json()` reads it back. Two doors let them in: `gateway/hl7.py:121` (`float(_at(f, 5))`) and `gateway/fhir.py:59` (`float(vq["value"])`). Inside `PatientState` a NaN (a) poisons `thin()` — a NaN first in a slice becomes that slice's minimum and maximum and the real extreme is dropped (measured: an 85 % desaturation lost) — and (b) makes the trends answer 500, because Starlette's `JSONResponse` has `allow_nan=False`. `edge/ncefiles.py:264` and `api/clinical.py:137` already refuse non-finite values. This task mirrors each gateway's own way with a bad value: HL7 drops the field (as it drops a non-numeric one), FHIR raises its `GatewayError` (which `/ingest` turns into a 400, app.py:675–676). Nothing else is validated here. `thin()` stays NaN-intolerant on purpose; Task 4's builder skips a non-finite reading as well, for rows already in the audit.

An engine task that shares no file with any other: it may run beside anything, in its own worktree, and must be merged before Task 15 (Task 4's test names it, but does not need it).

**Files:**
- Modify: `homunculus-engine/src/homunculus/gateway/hl7.py`, `homunculus-engine/src/homunculus/gateway/fhir.py`
- Test: `homunculus-engine/tests/test_gateway_hl7.py` (14 → 18), `homunculus-engine/tests/test_gateway_fhir.py` (5 → 10)

- [ ] **Step 1: The tests.** Edit `homunculus-engine/tests/test_gateway_hl7.py` — replace:

```python
def test_non_numeric_value_is_dropped_not_fabricated():
    msg = _msg(_MSH, _PID, _OBR, "OBX|1|NM|lactate||ERROR|mmol/L|||||F|||20260716143000")
    assert parse_hl7_oru(msg) == []
```

with:

```python
def test_non_numeric_value_is_dropped_not_fabricated():
    msg = _msg(_MSH, _PID, _OBR, "OBX|1|NM|lactate||ERROR|mmol/L|||||F|||20260716143000")
    assert parse_hl7_oru(msg) == []


@pytest.mark.parametrize("sentinel", ["NaN", "nan", "inf", "-Infinity"])
def test_a_non_finite_value_is_dropped_like_a_non_numeric_one(sentinel):
    """float() reads "NaN" and "inf" without complaint, but neither is a measurement. Inside a
    patient's history a NaN takes a thinning slice's minimum and maximum (the real extreme is
    dropped) and makes the trends answer unserialisable; edge/ncefiles.py and api/clinical.py
    already refuse them. The rest of the message still parses."""
    msg = _msg(_MSH, _PID, _OBR,
               f"OBX|1|NM|lactate||{sentinel}|mmol/L|||||F|||20260716143000",
               "OBX|2|NM|heart_rate||118|bpm|||||F|||20260716143000")
    assert [(o.code, o.value) for o in parse_hl7_oru(msg)] == [(SignalCode.HEART_RATE, 118.0)]
```

Edit `homunculus-engine/tests/test_gateway_fhir.py` — replace:

```python
def test_wrong_resource_type_raises_gateway_error():
    with pytest.raises(GatewayError, match="resourceType"):
        parse_fhir_observation({"resourceType": "Patient"})
```

with:

```python
def test_wrong_resource_type_raises_gateway_error():
    with pytest.raises(GatewayError, match="resourceType"):
        parse_fhir_observation({"resourceType": "Patient"})


@pytest.mark.parametrize("sentinel", [float("nan"), float("inf"), float("-inf"), "NaN"])
def test_a_non_finite_value_raises_gateway_error(sentinel):
    """float() takes NaN and ±inf, and so does JSON as Python reads it: the edge bridge's
    json.dumps writes a bare NaN token and Starlette's request.json() reads it back. Neither is a
    measurement — edge/ncefiles.py and api/clinical.py already refuse them."""
    with pytest.raises(GatewayError, match="finite"):
        parse_fhir_observation(_fhir("lactate", sentinel))


def test_the_ingest_door_answers_400_to_a_nan_token_and_records_nothing():
    import json
    from fastapi.testclient import TestClient
    from homunculus.api.app import create_app

    body = json.dumps(_fhir("lactate", float("nan")))      # what the bridge's json.dumps sends
    assert '"value": NaN' in body
    auth = {"Authorization": "Bearer tok", "Content-Type": "application/json"}
    with TestClient(create_app({"tok": "h1"}, run_escalation_loop=False)) as client:
        r = client.post("/ingest", content=body, headers=auth)
        assert r.status_code == 400 and "finite" in r.json()["detail"]
        records = client.get("/audit", headers=auth).json()["records"]
        assert [x for x in records if x["event_type"] == "ingest"] == []
```

- [ ] **Step 2: Run them — red.**

```bash
cd /c/tmp/g2-vital/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_gateway_hl7.py tests/test_gateway_fhir.py 2>&1 | grep -E "^FAILED|^E  .*(Error|assert)|passed|failed"
```
Expected: `9 failed, 19 passed` — the four HL7 cases keep the lactate (`assert [(…heart_rate…, 118.0)] == [(…, 118.0)]` with a NaN/inf lactate in front), the four FHIR cases `Failed: DID NOT RAISE GatewayError`, and the door `assert (200 == 400)`: today a NaN is ingested, audited and scored.

- [ ] **Step 3: The two gateways.** Edit `homunculus-engine/src/homunculus/gateway/hl7.py` — replace:

```python
import re
from datetime import datetime, timedelta, timezone
```

with:

```python
import math
import re
from datetime import datetime, timedelta, timezone
```

and replace:

```python
        except ValueError:
            continue  # non-numeric / errored result — drop, never fabricate
```

with:

```python
        except ValueError:
            continue  # non-numeric / errored result — drop, never fabricate
        if not math.isfinite(value):
            continue  # "NaN" / "inf" parse as floats but are not measurements — dropped the same way
```

Edit `homunculus-engine/src/homunculus/gateway/fhir.py` — replace:

```python
from datetime import datetime, timezone
```

with:

```python
import math
from datetime import datetime, timezone
```

and replace:

```python
    patient_id = subject.split("/", 1)[1]

    return Observation(
        patient_id=patient_id,
        code=code,
        value=float(vq["value"]),
```

with:

```python
    patient_id = subject.split("/", 1)[1]

    value = float(vq["value"])
    if not math.isfinite(value):
        # NaN / ±inf parse as floats — and JSON as Python reads it carries a bare NaN token — but
        # are not measurements; edge/ncefiles.py and api/clinical.py refuse them too.
        raise GatewayError(f"valueQuantity.value is not a finite number: {vq['value']!r}")

    return Observation(
        patient_id=patient_id,
        code=code,
        value=value,
```

(The finite check sits where the conversion already was, after every shape check: a resource that is wrong in two ways is still refused for the same reason as today. A non-numeric value still raises what `float()` raises — no other validation here.)

- [ ] **Step 4: Green, and everything that goes through a gateway.**

```bash
cd /c/tmp/g2-vital/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_gateway_hl7.py tests/test_gateway_fhir.py 2>&1 | tail -1
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_gateway_hl7.py tests/test_gateway_fhir.py tests/test_api_ingest.py tests/test_edge_bridge.py tests/test_edge_ncebridge.py tests/test_integration_e2e.py tests/test_scenarios_e2e.py tests/test_scenarios_hl7_parity.py tests/test_scenario_news2.py tests/test_pipeline.py 2>&1 | tail -1
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -1
```
Expected: `28 passed`; `95 passed` (18 + 10 + `test_api_ingest.py` 7 + `test_edge_bridge.py` 5 + `test_edge_ncebridge.py` 16 + `test_integration_e2e.py` 2 + `test_scenarios_e2e.py` 4 + `test_scenarios_hl7_parity.py` 4 + `test_scenario_news2.py` 23 + `test_pipeline.py` 6); the no-DB suite **2036 passed, 650 skipped** in plan order after Task 3 (*derived* — measured 2130 / 650 with every task in place) — in any other order, the base plus the merged tasks' deltas, this one's being 9.

- [ ] **Step 5: Commit.**

```bash
cd /c/tmp/g2-vital
git add homunculus-engine/src/homunculus/gateway/hl7.py homunculus-engine/src/homunculus/gateway/fhir.py homunculus-engine/tests/test_gateway_hl7.py homunculus-engine/tests/test_gateway_fhir.py
git status --short && git diff --cached --stat
git commit -m "fix(gateway): NaN and ±inf are not measurements — HL7 drops the field, FHIR refuses the resource" -m "float() reads NaN/inf, and the bridge's json.dumps writes a bare NaN token that Starlette's request.json() reads back. In PatientState a NaN takes a thinning slice's min and max (the real extreme lost) and makes the trends answer 500 (JSONResponse allow_nan=False). Mirrors edge/ncefiles.py and api/clinical.py, each gateway its own way: parse_hl7_oru skips the field as it skips a non-numeric one; parse_fhir_observation raises GatewayError (/ingest: 400). No other validation.

red: 9 failed — four HL7 sentinels kept, four FHIR not raised, /ingest 200 to a NaN token" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 4: `api/trends.py` — the answer, built by the engine

**Done in the backend lane** (commit `bd8afda`); the blocks below are that code.

Spec §4 and §5.4, with X1–X5 above. `patient_trends(engine, audit, *, hospital, patient_id, hours, now)` returns the response: the board's seven channels in its order, even empty; each reading as `[iso, value, the engine's NEWS2 points]`; `latest` with the delta over the whole history (rounded to 2 places), the breakdown's points and the own-normal verdict; `bands.news2` from `NEWS2_BANDS` on the five NEWS2 channels, `bands.own_normal` from the charted profile, `bands.device` reserved as `None`; thinning above `TRENDS_MAX_POINTS = 2000`; marks from `first_seen` audit rows and charted doses, in time order. It never creates a patient (an unmeasured id is read from an empty `PatientState`), writes nothing to the audit, and imports nothing of Aşama A.

**Amended 2026-10-20 (the Task 2 and Task 3 quality reviews).** (1) *Belt and braces after Task 3b:* a reading whose value is not finite is left out of `points`, never becomes `latest`, and is not counted in `total_points` — rows from before 3b still replay from the audit through `rehydrate`, which passes no gateway; when the newest reading is the non-finite one, `latest.news2_points` is `None`, because the engine's breakdown scored that reading, not the one printed. `thin()` stays NaN-intolerant on purpose; this is where they stop. (2) *The marks' read:* `records(…, since=, limit=)` returns the OLDEST rows at or after `since`, and `AckStore.prune` (api/ackstore.py:28–33) drops the `first_seen` stamp when an alert clears, so a flapping alert writes a row each time it comes back — about 30 an hour at one reading a minute, about 2 160 in 72 hours. `TRENDS_MARKER_LIMIT` is 5000, above that bound, and the answer carries `markers_truncated` (the read stopped at the limit, so the newest marks may be missing) — option (a) of the review; a newest-first read would have changed Task 3's `records()` on three logs. Two tests. **And the Task 4 quality review's follow-up** (the backend lane's commit `2b050bc`): the window is cut and stamped in UTC whatever zone the caller's clock wore; the own-normal verdict is given only on the reading the engine scored; `markers_truncated` is true only when something was actually cut; the comments say honestly what a ▲ is (O17); edge, profile-only and limit tests — `test_trends.py` has 29.

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
from homunculus.api.trends import TRENDS_HOURS, TRENDS_MARKER_LIMIT, TRENDS_MAX_POINTS, patient_trends
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
    json.dumps(answer, allow_nan=False)        # nothing in it a JSON response cannot carry


# --- points -------------------------------------------------------------------------------------

def test_points_are_the_window_oldest_first_with_the_engines_points():
    engine = _engine((SignalCode.HEART_RATE, 80, 30 * 60), (SignalCode.HEART_RATE, 84, 120),
                     (SignalCode.HEART_RATE, 132, 60))
    hr = _channel(_trends(engine), "heart_rate")
    assert hr["points"] == [[_at(120).isoformat(), 84.0, 0], [_at(60).isoformat(), 132.0, 3]]
    assert (hr["thinned"], hr["total_points"]) == (False, 2)
    assert len(_channel(_trends(engine, hours=72), "heart_rate")["points"]) == 3


def test_a_reading_exactly_on_the_start_of_the_window_is_drawn():
    engine = _engine((SignalCode.HEART_RATE, 84, 6 * 60 + 1), (SignalCode.HEART_RATE, 86, 6 * 60),
                     (SignalCode.HEART_RATE, 88, 30))
    answer = _trends(engine, hours=6)
    hr = _channel(answer, "heart_rate")
    assert [value for _ts, value, _points in hr["points"]] == [86.0, 88.0]     # the minute before is out
    assert hr["points"][0][0] == answer["since"]


def test_a_reading_exactly_on_the_end_of_the_window_is_drawn():
    engine = _engine((SignalCode.HEART_RATE, 84, 30), (SignalCode.HEART_RATE, 86, 0))
    answer = _trends(engine, hours=6)
    hr = _channel(answer, "heart_rate")
    assert [value for _ts, value, _points in hr["points"]] == [84.0, 86.0]
    assert hr["points"][-1][0] == answer["until"] == hr["latest"]["ts"]


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


def test_more_episodes_than_the_read_takes_are_flagged_not_cut_quietly():
    """Today the engine never drops an alert kind from `active_alerts` (pipeline.py:93–96), so
    `first_seen` is stamped once per (patient, kind) and a ▲ means "the first time this finding was
    raised for this patient"; a window holds a handful. IF alert episodes are ever cleared and
    re-raised, `AckStore.prune` would drop the stamp each time and a flapping alert would write a row
    each time it came back — about 30 an hour at one reading a minute, about 2 160 in the 72-hour
    window. The read is oldest-first, so past its limit the NEWEST marks — the end a clinician looks
    at — would be the missing ones; the answer says so instead of drawing a quiet end."""
    assert TRENDS_MARKER_LIMIT >= 72 * 30
    engine = _engine((SignalCode.SPO2, 85, 60))
    few = InMemoryAuditLog()
    _first_seen(few, "news2", 60)
    assert _trends(engine, few)["markers_truncated"] is False

    many = InMemoryAuditLog()
    for i in range(TRENDS_MARKER_LIMIT + 1):
        _first_seen(many, "news2", 600 - i * 0.1)
    answer = _trends(engine, many)
    assert answer["markers_truncated"] is True
    assert len(answer["markers"]) == TRENDS_MARKER_LIMIT
    assert answer["markers"][-1]["ts"] == _at(600 - (TRENDS_MARKER_LIMIT - 1) * 0.1).isoformat()


def test_exactly_the_limit_of_episodes_is_not_a_truncation():
    """Nothing was cut, so nothing is flagged: the flag means "the read stopped short", not "the
    read came back full"."""
    engine = _engine((SignalCode.SPO2, 85, 60))
    exact = InMemoryAuditLog()
    for i in range(TRENDS_MARKER_LIMIT):
        _first_seen(exact, "news2", 600 - i * 0.1)
    answer = _trends(engine, exact)
    assert answer["markers_truncated"] is False
    assert len(answer["markers"]) == TRENDS_MARKER_LIMIT
    assert answer["markers"][-1]["ts"] == _at(600 - (TRENDS_MARKER_LIMIT - 1) * 0.1).isoformat()


# --- readings that are not numbers ---------------------------------------------------------------

def test_a_reading_that_is_not_a_number_is_never_drawn_counted_or_latest():
    """Rows from before the gateways refused NaN and ±inf (Task 3b) still replay from the audit into
    PatientState, and `rehydrate` passes no gateway. Left in, a NaN would make this answer
    unserialisable — Starlette's JSONResponse refuses it, so the read would answer 500 — and a NaN
    first in a thinning slice would take that slice's minimum and maximum."""
    engine = _engine((SignalCode.HEART_RATE, 80, 120), (SignalCode.HEART_RATE, 84, 90),
                     (SignalCode.HEART_RATE, float("nan"), 60), (SignalCode.HEART_RATE, float("inf"), 30))
    engine.set_profile(PatientProfile("S-001", baselines={
        SignalCode.HEART_RATE: BaselineRange(70, 90)}))
    answer = _trends(engine)
    json.dumps(answer, allow_nan=False)          # what Starlette's JSONResponse does
    hr = _channel(answer, "heart_rate")
    assert hr["points"] == [[_at(120).isoformat(), 80.0, 0], [_at(90).isoformat(), 84.0, 0]]
    assert (hr["thinned"], hr["total_points"]) == (False, 2)
    assert (hr["latest"]["ts"], hr["latest"]["value"], hr["latest"]["delta"]) == (_at(90).isoformat(), 84.0, 4.0)
    # The engine's breakdown scored the newest reading — the inf — so its points are not 84's to print.
    # Nor is a verdict: 84 sits inside the charted 70–90, but the engine judges the newest reading,
    # and "within normal" printed beside that could contradict what it says.
    assert hr["latest"]["news2_points"] is None
    assert hr["latest"]["within_own_normal"] is None
    assert hr["bands"]["own_normal"] == {"low": 70, "high": 90}


def test_a_gap_of_not_a_number_mid_window_leaves_the_finite_newest_reading_scored_and_judged():
    """The `scored` guard must not over-reach: with a NaN in the MIDDLE of the history the newest
    reading is the engine's scored one, so its points and its own-normal verdict are served, and the
    delta is measured from the last finite reading before it."""
    engine = _engine((SignalCode.HEART_RATE, 80, 120), (SignalCode.HEART_RATE, float("nan"), 90),
                     (SignalCode.HEART_RATE, 132, 60))
    engine.set_profile(PatientProfile("S-001", baselines={
        SignalCode.HEART_RATE: BaselineRange(120, 140)}))
    hr = _channel(_trends(engine), "heart_rate")
    assert hr["points"] == [[_at(120).isoformat(), 80.0, 0], [_at(60).isoformat(), 132.0, 3]]
    assert (hr["thinned"], hr["total_points"]) == (False, 2)
    assert hr["latest"] == {"ts": _at(60).isoformat(), "value": 132.0, "delta": 52.0,
                            "news2_points": 3, "within_own_normal": True}


# --- what it refuses, and what it never does ----------------------------------------------------

def test_an_unmeasured_patient_is_read_without_being_created():
    engine = _engine((SignalCode.HEART_RATE, 84, 30))
    answer = _trends(engine, patient="S-009")
    assert {c["key"]: c["points"] for c in answer["channels"]} == {k: [] for k in _PUBLISHED_SIGNALS}
    assert "S-009" not in engine.patient_ids()


def test_a_charted_normal_with_no_readings_is_served_without_creating_the_patient():
    engine = _engine((SignalCode.HEART_RATE, 84, 30))
    engine.set_profile(PatientProfile("S-002", baselines={
        SignalCode.HEART_RATE: BaselineRange(100, 115)}))
    answer = _trends(engine, patient="S-002")
    hr = _channel(answer, "heart_rate")
    assert hr["bands"]["own_normal"] == {"low": 100, "high": 115}
    assert hr["points"] == [] and hr["latest"] is None
    assert answer["markers"] == []
    assert "S-002" not in engine.patient_ids()


def test_a_now_in_another_zone_is_answered_in_utc():
    audit = InMemoryAuditLog()
    audit.append(AuditEvent(HOSPITAL, "first_seen", "S-001", "news2",
                            {"at": "2026-10-19T12:00:00+04:00"}))      # 08:00 UTC
    engine = _engine((SignalCode.HEART_RATE, 84, 30))
    baku = timezone(timedelta(hours=4))
    answer = patient_trends(engine, audit, hospital=HOSPITAL, patient_id="S-001", hours=6,
                            now=NOW.astimezone(baku))                  # 13:00+04:00, the same instant
    assert (answer["since"], answer["until"], answer["generated_at"]) == (
        "2026-10-19T03:00:00+00:00", "2026-10-19T09:00:00+00:00", "2026-10-19T09:00:00+00:00")
    assert answer["markers"] == [{"ts": "2026-10-19T08:00:00+00:00", "kind": "alarm", "label": "news2"}]
    assert answer == _trends(engine, audit, hours=6)                   # nothing depends on the zone


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

import math
from datetime import datetime, timedelta, timezone

from homunculus.api.alarm_quality import _event_time
from homunculus.api.audit import AuditLog
from homunculus.api.board import _PUBLISHED_SIGNALS
from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine
from homunculus.rules.news2 import BANDS_SOURCE, NEWS2_BANDS, points_for, score as news2_score
from homunculus.state.profile import BaselineRange
from homunculus.state.timeline import PatientState, thin

#: The windows the screen offers: 6 hours, 24 hours, 3 days. Any other is refused.
TRENDS_HOURS = (6, 24, 72)
#: Above this many readings in a window a channel is thinned (`state/timeline.py` `thin`), D8.
TRENDS_MAX_POINTS = 2000
#: The most alarm-episode rows kept for one patient's window. An episode is a `first_seen` row.
#: Today the engine never drops an alert kind from `active_alerts` (pipeline.py:93–96 only ever sets
#: `bucket[kind]`), so `AckStore.prune` has nothing to drop and `first_seen` is stamped once per
#: (patient, kind): a ▲ on a chart means "the first time this finding was raised for this patient",
#: and a window holds a handful. IF alert episodes are ever cleared and re-raised, a flapping alert
#: would write a `first_seen` row each time it came back — about 30 an hour at one reading a minute,
#: about 2 160 in the 72-hour window — and this bound sits above that. The read is oldest-first
#: (`records` orders by id), so a window that ever held more would lose its NEWEST marks; the read
#: asks for one row more than the limit, and `markers_truncated` is true only when that extra row
#: came back, i.e. when something was actually cut.
TRENDS_MARKER_LIMIT = 5000

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


def _finite(series: list[Observation]) -> list[Observation]:
    """The readings whose value is a number. NaN and ±inf are not measurements: the gateways refuse
    them now, but rows from before that still replay from the audit into PatientState (`rehydrate`
    passes no gateway), and one left in would break the JSON answer (Starlette's JSONResponse
    refuses NaN, so the read would answer 500) and `thin()` (a NaN first in a slice takes its
    minimum and maximum — `thin` stays NaN-intolerant on purpose; this is where they stop)."""
    return [o for o in series if math.isfinite(o.value)]


def _latest(state: PatientState, key: str, code: SignalCode, breakdown: dict[str, int],
            baseline: BaselineRange | None) -> dict | None:
    recorded = state.history(code)
    history = _finite(recorded)
    if not history:
        return None
    last = history[-1]
    previous = history[-2] if len(history) > 1 else None
    parameter = _NEWS2_PARAMETER.get(key)
    # The engine's breakdown scores the newest reading. When that one is not a number it is not
    # `last`: its points are not this value's to print, and neither is a verdict on the patient's own
    # normal — the engine's `acute_change` finding (`patient_relative`) is judged on the newest
    # reading, and an older finite value called "within normal" beside it could tell the clinician
    # the opposite of what the engine is saying.
    scored = recorded[-1] is last
    return {
        "ts": last.timestamp.isoformat(),
        "value": last.value,
        # Over the whole history, not the window: "since the previous measurement" is a fact about
        # the patient, and a 6-hour window must not turn a change into "no previous one". Rounded,
        # because 37.2 − 36.9 is 0.30000000000000426 in binary and 0.3 at the bedside.
        "delta": None if previous is None else round(last.value - previous.value, 2),
        # The engine's own NEWS2 breakdown — the same number the board's score is built from.
        "news2_points": breakdown.get(parameter) if parameter is not None and scored else None,
        # Judged here, against the range a clinician charted; None when nobody charted one, and None
        # when the newest reading is not a number (see `scored` above).
        "within_own_normal": (None if baseline is None or not scored
                              else baseline.contains(last.value)),
    }


def _markers(state: PatientState, audit: AuditLog, hospital: str, patient_id: str,
             since: datetime, until: datetime) -> tuple[list[dict], bool]:
    """When an alarm episode began, and when an antibiotic dose was charted, in time order — and
    whether the episode read had to cut rows off at its limit.

    An alarm is its `first_seen` row, not its `alert` rows: the engine re-emits an active alert on
    every reading, so the `alert` rows count how often the monitor sampled, not how often the ward
    was asked to look (`api/alarm_quality.py` makes the same choice for the same reason). Its instant
    is the escalation clock's own (`payload["at"]`, else the row's `ts`), written in UTC like every
    other instant in the answer.

    The read asks for one row more than `TRENDS_MARKER_LIMIT` and keeps the limit: the extra row is
    the proof that something was cut, so exactly the limit is not "truncated".
    """
    found: list[tuple[datetime, dict]] = []
    fetched = audit.records(tenant=hospital, patient_id=patient_id, event_type="first_seen",
                            since=since, limit=TRENDS_MARKER_LIMIT + 1)
    truncated = len(fetched) > TRENDS_MARKER_LIMIT
    for rec in fetched[:TRENDS_MARKER_LIMIT]:
        at = _event_time(rec)
        if at is not None and since <= at <= until:
            at = at.astimezone(timezone.utc)
            found.append((at, {"ts": at.isoformat(), "kind": "alarm", "label": rec.subject}))
    for obs in state.window(SignalCode.ANTIBIOTIC_ADMINISTERED, since, until):
        # A charted 0 is "not given" (api/board.py `_meds`), never a dose on the time axis.
        if obs.value >= 1.0:
            at = obs.timestamp.astimezone(timezone.utc)
            found.append((at, {"ts": at.isoformat(), "kind": "antibiotic",
                               "label": SignalCode.ANTIBIOTIC_ADMINISTERED.value}))
    found.sort(key=lambda pair: pair[0])
    return [marker for _at, marker in found], truncated


def patient_trends(engine: Engine, audit: AuditLog, *, hospital: str, patient_id: str,
                   hours: int, now: datetime) -> dict:
    """The trends response for `patient_id` over the `hours` before `now` (spec §4)."""
    if hours not in TRENDS_HOURS:
        raise ValueError(f"hours must be one of {TRENDS_HOURS}, not {hours!r}")
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("now must carry a time zone")
    # The window is cut in UTC and `since`/`until`/`generated_at` are written `+00:00`, whatever zone
    # the caller's clock wore; the marks are written in UTC too.
    now = now.astimezone(timezone.utc)
    state =(engine.state(patient_id) if patient_id in set(engine.patient_ids())
             else PatientState(patient_id))
    profile = engine.profile(patient_id)
    breakdown = news2_score(state).breakdown
    since, until = now - timedelta(hours=hours), now

    channels = []
    for key, code in _PUBLISHED_SIGNALS.items():
        window = _finite(state.window(code, since, until))
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

    markers, markers_truncated = _markers(state, audit, hospital, patient_id, since, until)
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
        "markers": markers,
        "markers_truncated": markers_truncated,
    }
```

- [ ] **Step 4: Green.**

```bash
cd /c/tmp/g2-vital/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_trends.py tests/test_news2_bands.py tests/test_timeline_thin.py tests/test_audit_since.py 2>&1 | tail -1
```
Expected: `75 passed, 6 skipped` (29 + 14 + 17 + 15, the six Postgres cases skipped without the database) on Tasks 1–3 as merged; the three earlier files count what their tasks left after review (the backend lane's follow-ups added tests), `test_trends.py` is **23**.

- [ ] **Step 5: Commit.**

```bash
cd /c/tmp/g2-vital
git add homunculus-engine/src/homunculus/api/trends.py homunculus-engine/tests/test_trends.py
git status --short && git diff --cached --stat
git commit -m "feat(engine): api/trends.py builds the trend charts' answer — series, latest facts, bands, marks" -m "The board's seven channels in its order; each reading with the engine's NEWS2 points; latest delta over the whole history, the breakdown's points, the own-normal verdict; NEWS2_BANDS as bands on the five NEWS2 channels; thinning above 2000; alarm marks from first_seen (one per episode, not every re-emitted alert row), read up to 5000 with markers_truncated when the read stopped at the limit (a flapping alert writes a first_seen row each time it comes back), antibiotic marks from charted doses >= 1. A non-finite reading (an audit row from before Task 3b, replayed) is never drawn, counted or latest. Creates no patient, writes no audit row.

red: ModuleNotFoundError: No module named 'homunculus.api.trends'" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `GET /patients/{patient_id}/trends` — the door, and everything that lists doors

**Done in the backend lane** (commits `1aad52c` and `1b91f81`, the Task 5 quality review — X25); the blocks below are that code.

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
BIOMED_PERMS = frozenset(next(g["permissions"] for g in DEFAULT_GROUPS if g["slug"] == "biomedical"))
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


def _app(scope: Scope = WHOLE, perms: frozenset[str] = NURSE_PERMS,
         looked_up: list[str] | None = None):
    """`looked_up`, when given, collects the credential of every scope look-up the app makes."""
    async def resolve_scope(credential: str) -> Scope:
        if looked_up is not None:
            looked_up.append(credential)
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

    def test_the_window_ends_at_the_servers_utc_now(self, ward):
        _app, client = ward
        before = datetime.now(timezone.utc)
        answer = client.get("/patients/p-a1/trends", headers=NURSE).json()
        after = datetime.now(timezone.utc)
        slack = timedelta(seconds=5)
        for key in ("since", "until", "generated_at"):
            assert answer[key].endswith("+00:00"), (key, answer[key])
        for key in ("until", "generated_at"):
            assert before - slack <= datetime.fromisoformat(answer[key]) <= after + slack, key
        assert (datetime.fromisoformat(answer["until"]) - datetime.fromisoformat(answer["since"])
                == timedelta(hours=24))

    def test_the_hours_reach_the_builder_a_ten_hour_old_reading_is_in_24_and_72_only(self, ward):
        _app, client = ward
        _reading(client, "p-a1", "spo2", 96, minutes_ago=600)
        seen = {h: len(_channel(client.get(f"/patients/p-a1/trends?hours={h}", headers=NURSE).json(),
                                "spo2")["points"])
                for h in (6, 24, 72)}
        assert seen == {6: 0, 24: 1, 72: 1}

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
        # p-n1 is OUT of ADULT's scope: were the scope asked first, this would be 404 and a
        # scope_denied row. A patient in scope could not tell the two orders apart.
        app = _app(ADULT, perms=frozenset())
        with TestClient(app) as client:
            _reading(client, "p-n1", "heart_rate", 84)
            r = client.get("/patients/p-n1/trends", headers=NURSE)
        assert (r.status_code, r.json()["detail"]) == (403, "permission required: board.view")
        assert not _rows(app, "scope_denied")

    def test_without_board_view_an_unreadable_scope_is_still_403_not_503(self):
        app = _app(UNKNOWN, perms=frozenset())
        with TestClient(app) as client:
            _reading(client, "p-a1", "heart_rate", 84)
            r = client.get("/patients/p-a1/trends", headers=NURSE)
        assert (r.status_code, r.json()["detail"]) == (403, "permission required: board.view")
        assert not _rows(app, "scope_denied")

    def test_a_biomedical_caller_is_403_and_the_scope_is_never_looked_up(self):
        # devices.manage is a right of its own: it opens no patient, and the refusal comes before
        # any look-up of what the caller may see.
        looked_up: list[str] = []
        app = _app(WHOLE, perms=BIOMED_PERMS, looked_up=looked_up)
        with TestClient(app) as client:
            _reading(client, "p-a1", "heart_rate", 84)
            r = client.get("/patients/p-a1/trends", headers=NURSE)
        assert (r.status_code, r.json()["detail"]) == (403, "permission required: board.view")
        assert looked_up == []

    def test_the_scope_is_looked_up_once_per_read(self):
        # The chart polls every minute: a second look-up is doubled work, and a blip between the
        # two would turn a readable scope into a 404 for a patient who is in it.
        looked_up: list[str] = []
        app = _app(ADULT, looked_up=looked_up)
        with TestClient(app) as client:
            _reading(client, "p-a1", "heart_rate", 84)
            _reading(client, "p-n1", "heart_rate", 84)
            assert client.get("/patients/p-a1/trends", headers=NURSE).status_code == 200
            assert looked_up == ["nurse-jwt"]
            assert client.get("/patients/p-n1/trends", headers=NURSE).status_code == 404
            assert looked_up == ["nurse-jwt", "nurse-jwt"]

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
    """The lane holds a heart rate of 180 for p1's bed and the clinical chart holds 72; the trends of
    p1 must show the 72 and nothing of the lane, and must not even ask the shadow store."""
    identities = InMemoryIdentityStore()
    identities.apply(HOSPITAL, IdentityRecord(patient_id="p1", unit="YB", room="1", bed="1", source="test"))
    client, clock = _app(tmp_path, identities=identities)
    assert client.post("/infinity-shadow/readings", json=_body(clock.t), headers=_hdr(SHADOW)).status_code == 200
    # The clinical lane's own reading, stamped against the real clock: the route cuts its window at
    # the server's now. Without it "no points" would be trivially true of an empty patient.
    clinical = {"resourceType": "Observation", "status": "final",
                "code": {"coding": [{"code": "heart_rate"}]}, "subject": {"reference": "Patient/p1"},
                "effectiveDateTime": (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat(),
                "valueQuantity": {"value": 72, "unit": "/min"}}
    assert client.post("/ingest", json=clinical, headers=_hdr(DEVICE)).status_code == 200
    calls: list[str] = []
    store = client.app.state.shadow_store
    for name in ("devices", "feed"):
        original = getattr(store, name)
        monkeypatch.setattr(store, name, lambda *a, _n=name, _o=original, **k: (calls.append(_n), _o(*a, **k))[1])

    answer = client.get("/patients/p1/trends", headers=_hdr(DEVICE))

    assert answer.status_code == 200, answer.text
    channels = {channel["key"]: channel for channel in answer.json()["channels"]}
    assert [point[1] for point in channels["heart_rate"]["points"]] == [72.0]   # the clinical lane, not 180
    assert all(channel["points"] == [] for key, channel in channels.items() if key != "heart_rate")
    assert calls == []
    # Control: the spies are wired. The shadow board's own read does reach both store reads.
    assert client.get("/infinity-shadow/board", headers=_hdr(DEVICE)).status_code == 200
    assert {"devices", "feed"} <= set(calls)
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
`test_trends_api.py: 26 failed` · `test_infinity_shadow_isolation.py: 2 failed, 16 passed` (`test_a_trends_read_never_reaches_the_shadow_store`, `test_the_shadow_token_opens_no_clinical_route[/patients/p1/trends]`; the import test passes already — trends.py exists since Task 4) · `test_board_permissions.py: 2 failed, 55 passed` (`test_the_table_names_every_board_route_and_only_those`, `test_a_jwt_without_permissions_gets_nothing_but_the_open_routes[GET /patients/{patient_id}/trends]`) · `test_tenant_isolation.py: 1 failed, 108 skipped`.

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

        The scope is resolved once, here, and handed to `_require_patient`: the chart polls every
        minute, and a second look-up would double that work and give a blip between the two a way
        to answer 404 for a patient who is in scope.
        """
        caller = await _caller(authorization)
        _require(caller, BOARD_VIEW)
        if hours not in TREND_WINDOWS_TEXT:
            raise HTTPException(status_code=400, detail="geçersiz hours: 6, 24 veya 72 olmalı")
        scope = await _scope(authorization)
        if scope.reason == UNKNOWN_SCOPE.reason:
            raise HTTPException(status_code=503, detail="kapsam şu anda okunamıyor")
        await _require_patient(caller, authorization, patient_id, scope=scope)
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
Expected: `26 passed` · `18 passed` · `57 passed` · `1 passed, 108 skipped` · `43 passed` (`/patients` is already in nginx's API prefix list, deploy/local/web/nginx.conf:143) · `42 passed` · `27 passed`. With the database, `test_tenant_isolation.py` is `109 passed` (≈ 85 s).

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
Expected: `2096 passed, 650 skipped` (*derived*, plan order).

- [ ] **Step 9: The Task 5 quality review's follow-ups** (the backend lane's commit `1b91f81`; X25). The route resolves the caller's scope ONCE and hands it to `_require_patient`, which takes it as a keyword (`scope=None` for every other route): the chart polls every minute, and a second look-up doubled the work and gave a blip between the two a way to answer 404 for a patient in scope. The windows are one name, `TREND_WINDOWS_TEXT`. A 503 that says the scope could not be read stays `errors.scopeUnreadable` on the screen (its text still names the live stream — O9). The shadow-isolation test now has a clinical reading the trends must show and a control proving its spies are wired. Eight Edits (the route's own block above already reads as the lane wrote it).

app.py — the windows as text, named once — in `homunculus-engine/src/homunculus/api/app.py` replace:

```python
DEVICE_ROLE_MAX = 64
PATIENT_ID_MAX = 128
```

with:

```python
DEVICE_ROLE_MAX = 64
PATIENT_ID_MAX = 128

#: The windows GET /patients/{id}/trends accepts, as the text the query string carries. The route
#: reads `hours` as text so that any other value is its own 400 rather than FastAPI's 422.
TREND_WINDOWS_TEXT = frozenset(str(h) for h in TRENDS_HOURS)
```

app.py — `_require_patient` takes a scope already resolved (X25) — in `homunculus-engine/src/homunculus/api/app.py` replace:

```python
    async def _require_patient(caller: Caller, authorization: str | None,
                               patient_id: str) -> None:
```

with:

```python
    async def _require_patient(caller: Caller, authorization: str | None,
                               patient_id: str, *, scope: Scope | None = None) -> None:
```

app.py — its docstring says when — in `homunculus-engine/src/homunculus/api/app.py` replace:

```python
        scope says to whom, and both must hold.

        The card it checks carries only what `sees_patient` reads — the id, and the bed and unit
```

with:

```python
        scope says to whom, and both must hold.

        `scope` is the caller's scope when the route has already resolved it (the trends route
        needs it first, to answer 503 for one that cannot be read). Passing it spares a second
        look-up, and a second chance for a blip to turn a readable scope into "not found". Every
        other route leaves it out and the scope is resolved here.

        The card it checks carries only what `sees_patient` reads — the id, and the bed and unit
```

app.py — and uses it — in `homunculus-engine/src/homunculus/api/app.py` replace:

```python
        hospital = caller.hospital
        scope = await _scope(authorization)
        if scope.unrestricted:
```

with:

```python
        hospital = caller.hospital
        scope = scope if scope is not None else await _scope(authorization)
        if scope.unrestricted:
```

apiErrors.js — a 503 that says the scope could not be read stays that answer — in `dashboard/src/live/apiErrors.js` replace:

```js
/** What a 5xx may say that is more exact than "the server cannot be reached". */
const SERVER_ANSWERS = new Set(["errors.directoryUnreachable", "errors.directoryNotConfigured", "errors.sessionUnreachable"]);
```

with:

```js
/** What a 5xx may say that is more exact than "the server cannot be reached". `scopeUnreadable` is
 *  the 503 of POST /stream-ticket and GET /patients/{id}/trends: the server answered, only the
 *  look-up of what the caller may see failed. NOTE: the `scopeUnreadable` text currently names the
 *  live stream ("…so the live stream did not start"); the server sends the one sentence for both
 *  routes, and no screen prints it for the trends route today. */
const SERVER_ANSWERS = new Set(["errors.directoryUnreachable", "errors.directoryNotConfigured", "errors.sessionUnreachable", "errors.scopeUnreadable"]);
```

test_infinity_shadow_isolation.py — the clinical reading's clock — in `homunculus-engine/tests/test_infinity_shadow_isolation.py` replace:

```python
import subprocess
import sys
from pathlib import Path
```

with:

```python
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
```

trends.py — a space — in `homunculus-engine/src/homunculus/api/trends.py` replace:

```python
    state =(engine.state(patient_id) if patient_id in set(engine.patient_ids())
```

with:

```python
    state = (engine.state(patient_id) if patient_id in set(engine.patient_ids())
```

apiErrors.test.js — pinned — in `dashboard/src/live/apiErrors.test.js` replace:

```js
  it("the lock and the password's throttle do not claim the account is the hospital's", () => {
```

with:

```js
  it("a 503 that says the scope could not be read stays that answer, not 'the server cannot be reached'", () => {
    // /stream-ticket and GET /patients/{id}/trends answer 503 "kapsam şu anda okunamıyor": the
    // server IS reachable, only the look-up of what the caller may see failed.
    const err = Object.assign(new Error("kapsam şu anda okunamıyor"), { status: 503 });
    expect(apiErrorKey(err)).toEqual({ key: "errors.scopeUnreadable", vars: {} });
    for (const lang of LANG_CODES) {
      const t = createTranslator(lang, DICTIONARIES);
      expect(apiErrorText(t, err), lang).toBe(t("errors.scopeUnreadable"));
      expect(apiErrorText(t, err), lang).not.toBe(t("errors.serverUnreachable"));
    }
    // and a 5xx that says nothing of the scope is still the generic one
    expect(apiErrorKey(Object.assign(new Error("Beklenmeyen"), { status: 503 })))
      .toEqual({ key: "errors.serverUnreachable", vars: {} });
  });

  it("the lock and the password's throttle do not claim the account is the hospital's", () => {
```

Run Step 5's and Step 8's commands again. Expected: Step 5's as there; Step 8's `Tests  185 passed (185)` (apiErrors 144, the pinned 503), the dashboard suite `81 files / 1915 tests`, and the backend suite without the database `2096 passed, 650 skipped` (*derived*, plan order).

- [ ] **Step 10: Commit.**

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

**Done in the dashboard lane** (`feat/g2v-dash`, commits `db87711` and `950176d`, the Task 6 quality review: `setProfile` marked a hazard, a 12-hour window sent as named); the blocks below are that code.

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

  it("sends a window the server does not offer as it was named — refusing it (400) is the server's job", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    await signedIn(fetchMock).patientTrends("S-001", 12);
    expect(fetchMock.mock.calls[0][0]).toBe("/patients/S-001/trends?hours=12");
  });

  it("setProfile sends comorbidities: [] and baselines: {} even when given only a baseline SOFA — why nothing new calls it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    await signedIn(fetchMock).setProfile("S-001", { baselineSofa: 3 });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.comorbidities).toEqual([]);
    expect(sent.baselines).toEqual({});
    expect(sent.baseline_sofa).toBe(3);
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
Expected: five `×` in the new describe (`…patientTrends is not a function` / `…putPatientProfile is not a function`) and `Tests  6 failed | 105 passed (111)` (the sixth: the 12-hour window is sent as named) — the `setProfile` case passes already: it pins today's behaviour.

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
     * Not `setProfile` above: that always sends `comorbidities` and `baselines` (an empty list
     * and an empty object unless given), and the engine reads a present-but-empty key as "clear
     * it" (api/clinical.py `profile_from_payload`) — so a form that only means to write the
     * baselines would erase every charted comorbidity, and one that only means to write a baseline
     * SOFA would erase the baselines too. The baseline form sends `{baselines}` alone, and the
     * engine keeps whatever the body does not mention.
     */
    putPatientProfile(patientId, body) {
      return authed(`/clinical/${seg(patientId)}/profile`, { method: "PUT", body });
    },

    /** Escape hatch for endpoints not yet wrapped (admissions, alerts, tenant…). */
    request: authed,
```

And mark `setProfile` a hazard where a caller reads it (the Task 6 quality review, lane commit `950176d`) — replace:

```js
     * Without it every patient is judged against the population threshold, so someone whose
     * atrial fibrillation lives at 105 bpm alarms on every measurement. The boundary is always
     * the clinician's — the system never mints one.
     */
    setProfile(patientId, { comorbidities = [], baselines = {}, baselineSofa = null } = {}) {
```

with:

```js
     * Without it every patient is judged against the population threshold, so someone whose
     * atrial fibrillation lives at 105 bpm alarms on every measurement. The boundary is always
     * the clinician's — the system never mints one.
     *
     * @deprecated Do not call this from anything new. It ALWAYS sends `comorbidities: []` AND
     * `baselines: {}` (unless given others), and the engine reads a present-but-empty key as
     * "clear" (api/clinical.py `profile_from_payload`) — so a partial call such as
     * `setProfile(id, { baselineSofa: 3 })` erases both the charted comorbidities and every
     * baseline range on the server. Use `putPatientProfile` with only the keys to change.
     */
    setProfile(patientId, { comorbidities = [], baselines = {}, baselineSofa = null } = {}) {
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
Expected: `Tests  111 passed (111)`. Then the suite — **81 files / 1922 tests** in plan order (base + 3 from Task 5 + 7 here; the lane alone, `950176d`: 81 / 1919) — and the build.

- [ ] **Step 5: Commit.**

```bash
cd /c/tmp/g2-vital
git add dashboard/src/backendApi.js dashboard/src/backendApi.test.js dashboard/src/live/session/testTokens.testutil.js
git status --short && git diff --cached --stat
git commit -m "feat(dashboard): backendApi.patientTrends and putPatientProfile" -m "patientTrends is an authed GET like boardPatients (same refusal mapping, same 15 s limit). putPatientProfile sends the body as given: setProfile always sends comorbidities, which the engine reads as 'clear them' (a test pins that, so nobody moves the form onto it). fakeApi gains both.

red: 6 failed — patientTrends / putPatientProfile is not a function" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Tokens — `--band-n`, `--band-mid`, `--band-crit`, `--grid`, held to contrast

**Done in the dashboard lane** (commits `35ba65d` and `e2afede`, the Task 7 quality review: every line measured on the four grounds and over stacked tints, the lists read from `COLOR_TOKENS`); the blocks below are that code.

Spec §6 with X6. `--band-mid` and `--band-crit` tint a NEWS2 row the engine scores 1–2 and 3 points (D2's amber and red); `--band-n` the patient's own normal (the prototype's own `--band-n`); `--grid` the value lines. The prototype's single `--band-al` (`rgba(239,68,68,.12)` / `rgba(220,38,38,.08)`) becomes two. Every `--v-*` line must clear **3:1** over each tint on a card (measured lowest: Gün `--v-map` over `--band-n`, 4.21:1); the ▲/◆ marks sit on the card in their own lane (`crit` 3.57 / 4.83, `pri` 7.31 / 5.36).

**Files:**
- Modify: `dashboard/src/live/theme/tokens.css`, `dashboard/src/live/theme/tokens.js`, `dashboard/src/live/theme/tokens.test.js`

- [ ] **Step 1: The tests** — Write `dashboard/src/live/theme/tokens.test.js` (whole: the Task 7 quality review, lane commit `e2afede`, reworked its helpers — `over()` takes a list of translucent layers; `VITALS` and `BANDS` are read from `COLOR_TOKENS`; every line is measured over every band tint on `card`, `card2`, `page` and `app`, the big chart's ground, and over `band-n` stacked on a scored row):

```js
// WCAG AA for the live UI's palette, enforced as arithmetic rather than a review note (the mobile
// app's precedent: homunculus-mobile/__tests__/contrast.test.ts). Each pair below is one that
// actually renders as text — or, at 3:1, a focus outline or severity stripe — and says where.
// Body text needs 4.5:1. Every text pair is held to 4.5:1, large or not: the pills and badges
// that carry severity are 10–12 px.
//
// Not measured on purpose: --line/--line2 (borders; the input border is ~1.4-1.6:1 on a card in
// both themes — an open user decision in the roadmap's "Kullanıcı kararları"), --attLine, the
// shadows, --scrim (a dimmed backdrop, not a ground for text).
import { describe, it, expect } from "vitest";
import { COLOR_TOKENS } from "./tokens.js";
import { rule, THEMES } from "./tokensCss.testutil.js";

function parse(value) {
  let m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (m) return { rgb: [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255), a: 1 };
  m = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/i.exec(value);
  if (m) return { rgb: [m[1], m[2], m[3]].map((n) => Number(n) / 255), a: Number(m[4]) };
  throw new Error(`not a colour this test reads: ${value}`);
}

/** An opaque token. A translucent one must say what it sits on (over/tint). */
function solid(theme, name) {
  const c = parse(THEMES[theme][name]);
  if (c.a !== 1) throw new Error(`--${name} is translucent in ${theme}: measure it over a surface`);
  return c.rgb;
}

/**
 * A token as it renders over an opaque surface token (alpha compositing). Several translucent
 * layers may be given — a name or a list, bottom first: ["band-mid", "band-n"] is the patient's
 * own normal laid over a NEWS2 row, both over the ground.
 */
function over(theme, layers, ground) {
  return [].concat(layers).reduce((under, name) => {
    const c = parse(THEMES[theme][name]);
    return c.rgb.map((v, i) => v * c.a + under[i] * (1 - c.a));
  }, solid(theme, ground));
}

/** color-mix(in srgb, var(--name) <share>, transparent) — the pill tint — over a surface. */
function tint(theme, name, share, ground) {
  const c = solid(theme, name);
  const g = solid(theme, ground);
  return c.map((v, i) => v * share + g[i] * (1 - share));
}

const luminance = (rgb) => {
  const f = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const BODY = 4.5;
const UI = 3;
const SURFACES = ["page", "app", "rail", "card", "card2"];
const SEVERITY = ["crit", "high", "mid", "low", "ok"];
// Read from the registry, so a new vital channel or a new band tint is measured without anyone
// remembering to add it here.
const VITALS = COLOR_TOKENS.filter((name) => name.startsWith("v-"));
const BANDS = COLOR_TOKENS.filter((name) => name.startsWith("band-"));
// The patient's own normal (band-n) can lie inside a scored NEWS2 row: it is then composited over
// that row's tint (bottom first), the thinnest ground a line is ever drawn on.
const STACKED = BANDS.filter((name) => name !== "band-n").map((name) => `${name} + band-n`);
// The mini chart sits on a card; the big chart in the kit Modal, whose panel is bg-app (Modal.jsx).
// card2 and page are measured too, as the severity fills are: a chart may be moved there.
const CHART_GROUNDS = ["card", "card2", "page", "app"];

describe.each(["gece", "gun"])("%s theme: contrast", (theme) => {
  const s = (name) => solid(theme, name);

  it.each(SURFACES)("ink and mute text clear 4.5:1 on %s", (bg) => {
    expect(ratio(s("ink"), s(bg))).toBeGreaterThanOrEqual(BODY);
    expect(ratio(s("mute"), s(bg))).toBeGreaterThanOrEqual(BODY);
  });

  it.each(["page", "app", "card", "card2"])("primary text (links, info notes) clears 4.5:1 on %s", (bg) => {
    expect(ratio(s("pri"), s(bg))).toBeGreaterThanOrEqual(BODY);
  });

  it("info note: pri text on priSoft over a card clears 4.5:1", () => {
    expect(ratio(s("pri"), over(theme, "priSoft", "card"))).toBeGreaterThanOrEqual(BODY);
  });

  it.each([
    ["onpri", "pri", "primary button, chosen segment"],
    ["oncrit", "crit", "danger button"],
    ["onmid", "mid", "tab count badge"],
  ])("%s on %s (%s) clears 4.5:1", (fg, bg) => {
    expect(ratio(s(fg), s(bg))).toBeGreaterThanOrEqual(BODY);
  });

  it.each(["card", "card2", "page", "app"])(
    "warning note, tag and attention pill: attInk on att over %s clears 4.5:1",
    (ground) => {
      expect(ratio(s("attInk"), over(theme, "att", ground))).toBeGreaterThanOrEqual(BODY);
    },
  );

  it("critical tag: critInk on critSoft over a card clears 4.5:1", () => {
    expect(ratio(s("critInk"), over(theme, "critSoft", "card"))).toBeGreaterThanOrEqual(BODY);
  });

  it.each(SEVERITY.flatMap((sev) => ["page", "app", "card", "card2"].map((bg) => [sev, bg])))(
    "%s ink (timers, bed numbers) clears 4.5:1 on %s",
    (sev, bg) => {
      expect(ratio(s(`${sev}Ink`), s(bg))).toBeGreaterThanOrEqual(BODY);
    },
  );

  // The tint is translucent, so the pill's ground counts: a card, a card2 row, and — in a page
  // header or a dialog — the page or the app frame.
  it.each(SEVERITY.flatMap((sev) => ["card", "card2", "page", "app"].map((bg) => [sev, bg])))(
    "%s status pill: ink on its 14%% tint over %s clears 4.5:1",
    (sev, bg) => {
      expect(ratio(s(`${sev}Ink`), tint(theme, sev, 0.14, bg))).toBeGreaterThanOrEqual(BODY);
    },
  );

  // On a card only. On card2 Gun's v-map (4.38) and v-spo (4.46) fall under 4.5:1: recorded in the
  // roadmap for G1-09/G1-11, which decide where vitals sit.
  it.each(VITALS)("vital %s clears 4.5:1 on a card", (v) => {
    expect(ratio(s(v), s("card"))).toBeGreaterThanOrEqual(BODY);
  });

  // The focus outline (ui/focus.js) sits 2 px outside a control, on whatever ground surrounds it:
  // any surface — the rail holds the G1-07 sidebar's links, card2 input rows and table headers,
  // the app frame dialogs — and the tinted grounds a control can sit in, measured over a card: a
  // warning note or attention card (att), a critical tag's ground (critSoft), an info note
  // (priSoft).
  it.each(SURFACES)("focus outline (pri) clears 3:1 against %s", (bg) => {
    expect(ratio(s("pri"), s(bg))).toBeGreaterThanOrEqual(UI);
  });

  it.each(["att", "critSoft", "priSoft"])("focus outline (pri) clears 3:1 against %s over a card", (tinted) => {
    expect(ratio(s("pri"), over(theme, tinted, "card"))).toBeGreaterThanOrEqual(UI);
  });

  // The top bar's "may be out of date" marks (G1-07): the bell's and the unit chip's amber ring
  // and dot (mid), and the grey dot that means "cannot know" (mute). They sit on the RAIL, which
  // the severity fills below are not measured against — and they are the only thing that says, at
  // a glance, that what the bell shows may be stale.
  it.each(["mid", "mute"])("the top bar's %s ring and dot clear 3:1 against the rail", (name) => {
    expect(ratio(s(name), s("rail"))).toBeGreaterThanOrEqual(UI);
  });

  // Group 2's trend charts (screens/patient/trends/): a vital's dots and dashed connectors are drawn
  // over a band tint — a NEWS2 row scoring 1–2 (band-mid) or 3 (band-crit), or the patient's own
  // normal (band-n) — on a card (the mini chart) or on the dialog's app background (the big chart).
  // A line is a graphic, held to 3:1, over every tint it can cross, on every ground it is drawn on.
  // (The prototype drew MAP at reduced opacity; at .55–.70 that measured 2.17–3.20:1 over the
  // tints, so the charts draw MAP at full colour with hollow dots instead.)
  it.each(VITALS.flatMap((v) => BANDS.flatMap((b) => CHART_GROUNDS.map((g) => [v, b, g]))))(
    "chart: the %s line clears 3:1 over the %s tint on %s",
    (vital, band, ground) => {
      expect(ratio(s(vital), over(theme, band, ground))).toBeGreaterThanOrEqual(UI);
    },
  );

  // Where the patient's own normal lies inside a scored row, band-n is laid over band-mid or
  // band-crit: two translucent layers on the ground, the thinnest margins in this set.
  it.each(VITALS.flatMap((v) => STACKED.flatMap((b) => CHART_GROUNDS.map((g) => [v, b, g]))))(
    "chart: the %s line clears 3:1 over the stacked %s tints on %s",
    (vital, stack, ground) => {
      expect(ratio(s(vital), over(theme, stack.split(" + "), ground))).toBeGreaterThanOrEqual(UI);
    },
  );

  // The ▲ alarm and ◆ antibiotic marks sit in their own lane under the plot — on the card in the
  // mini chart, on the dialog's app background in the big one — never over a band.
  it.each(["crit", "pri"].flatMap((name) => ["card", "app"].map((g) => [name, g])))(
    "chart: the %s marker clears 3:1 on %s",
    (name, ground) => {
      expect(ratio(s(name), s(ground))).toBeGreaterThanOrEqual(UI);
    },
  );

  // A bed card's stripe sits on the card, a dot or bar in a card2 row (G1-09), a stripe on the
  // page or the app frame (G1-07): each ground is held to 3:1.
  it.each(SEVERITY.flatMap((sev) => ["card", "card2", "page", "app"].map((bg) => [sev, bg])))(
    "%s fill (stripe, bar, dot) clears 3:1 against %s",
    (sev, bg) => {
      expect(ratio(s(sev), s(bg))).toBeGreaterThanOrEqual(UI);
    },
  );
});

// The sign-in hero and the lock screen are always dark (data-theme="gece" on their roots) and lie
// on a radial gradient from color-mix(in srgb, var(--pri) 25%, var(--page)) to the page colour:
// their text is held to 4.5:1 at the gradient's lightest point, and the primary icons to 3:1.
describe("the dark gradient of the sign-in hero and the lock screen (Gece)", () => {
  const glow = tint("gece", "pri", 0.25, "page");
  it.each(["ink", "mute"])("%s clears 4.5:1 on the gradient's lightest point", (name) => {
    expect(ratio(solid("gece", name), glow)).toBeGreaterThanOrEqual(BODY);
  });
  // The hero's pill is ink on priSoft: pri text there would be 4.09:1.
  it("pri (icons) clears 3:1 there, and the pill's ink 4.5:1 on priSoft over it", () => {
    expect(ratio(solid("gece", "pri"), glow)).toBeGreaterThanOrEqual(UI);
    const pill = parse(THEMES.gece.priSoft);
    const ground = pill.rgb.map((v, i) => v * pill.a + glow[i] * (1 - pill.a));
    expect(ratio(solid("gece", "ink"), ground)).toBeGreaterThanOrEqual(BODY);
  });
});

describe("token registry", () => {
  it.each(["gece", "gun"])("%s declares every named colour, and only those", (theme) => {
    const declared = Object.keys(THEMES[theme]).filter((name) => name !== "shadow").sort();
    expect(declared).toEqual([...COLOR_TOKENS].sort());
    for (const name of COLOR_TOKENS) expect(() => parse(THEMES[theme][name]), name).not.toThrow();
  });

  it("text size: --fs is 1, and 1.12 under data-size=buyuk", () => {
    expect(rule(":root").fs).toBe("1");
    expect(rule('[data-size="buyuk"]').fs).toBe("1.12");
  });
});
```

- [ ] **Step 2: Run it — no red yet, by design.**

```bash
cd /c/tmp/g2-vital/dashboard
npx vitest run src/live/theme/tokens.test.js 2>&1 | grep -E "Tests |not a colour" | sort -u
```
Expected: `Tests  200 passed (200)`. The line-over-tint cases are generated from `COLOR_TOKENS`, which lists no band token yet, so there is nothing to fail; the red comes in Step 3, between its two files.

- [ ] **Step 3: The tokens — the registry first, then the stylesheet.** Edit `dashboard/src/live/theme/tokens.js` — replace:

```js
  // vital-sign channels
  "v-hr", "v-map", "v-spo", "v-rr", "v-t",
```

with:

```js
  // vital-sign channels
  "v-hr", "v-map", "v-spo", "v-rr", "v-t",
  // the trend charts: the patient's own normal, NEWS2 rows scoring 1–2 and 3 points, value lines
  "band-n", "band-mid", "band-crit", "grid",
```

(Tailwind reaches them as `fill-band-mid`, `fill-band-crit`, `fill-band-n`, `stroke-grid` through `tailwindColors()`; `tailwind.test.js` checks the mapping and that no name shadows a Tailwind default.)

Run Step 2's command. Expected: `Error: not a colour this test reads: undefined` and `Tests  202 failed | 198 passed (400)` — the registry now names the four tokens and no stylesheet defines them.

Then Edit `dashboard/src/live/theme/tokens.css` three times.

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
 *   normal (the prototype's --band-n meant a reference range; here it is the patient's charted
 *   normal), --grid the value lines. The prototype's single --band-al became two, because D2 frames
 *   1–2 points amber and 3 red. The mini chart sits on a card, the big chart on the dialog's --app
 *   background; every --v-* line holds 3:1 over each tint, and over --band-n stacked on a scored
 *   row, on card, card2, page and app (tokens.test.js).
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

- [ ] **Step 4: Green, then the gate.**

```bash
cd /c/tmp/g2-vital/dashboard
npx vitest run src/live/theme/ 2>&1 | grep -E "Test Files|Tests "
```
Expected: `Test Files  4 passed (4)`, `Tests  436 passed (436)` (tokens.test.js 400). Then the suite — **81 / 2130** in plan order (the lane alone: 81 / 2127) — and the build.

- [ ] **Step 5: Commit.**

```bash
cd /c/tmp/g2-vital
git add dashboard/src/live/theme/tokens.css dashboard/src/live/theme/tokens.js dashboard/src/live/theme/tokens.test.js
git status --short && git diff --cached --stat
git commit -m "feat(theme): the trend charts' band and grid tokens, every vital line held to 3:1 over them on every ground" -m "--band-mid / --band-crit tint the NEWS2 rows the engine scores 1–2 and 3, --band-n the patient's own normal, --grid the value lines, in Gece and Gün. Every v-* line clears 3:1 over every band tint on card, card2, page and app, and over band-n stacked on a scored row; the alarm and antibiotic marks on card and app. VITALS and BANDS are read from COLOR_TOKENS. Lowest held (Gece / Gün): single tint card 4.56 / 4.21, app 5.16 / 3.90; stacked card 3.69 / 3.74, app 4.17 / 3.48.

red: 202 failed — not a colour this test reads: undefined (the registry before the stylesheet)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: The strings — 49 keys in four languages, and two sentences that would become false

**Done in the dashboard lane** (commits `886cb12` and `f082251`); the blocks below are that code.

Spec §9 (its 31 new keys; `trends` exists), plus what the table, the dialog's controls and the form need (18 more: `trendsLoading`, `trendsChartLabel`, `trendsBandPoints12`, `trendsBandPoints3`, `trendsHoursLabel`, `trendsViewLabel`, `trendsKeysHint`, `trendsCaption`, `trendsCol*` ×6, `baselineNotDeviceAlarm`, `baselineNotNumber`, `baselineNothingToSend`, `baselineSaving`), and two placeholders the spec's list does not carry: `trendsBandNews2` takes `{source}` (the legend names the source the SERVER sent), `baselineMayHaveLanded` takes `{subject}` (amendments (f)). Per X9, `onlyWrite` and `formsSoon` are reworded in four languages (the old texts stay recognisable to the existing tests). `trendsSoon` stays until Task 9 removes the placeholder that reads it. Nothing renders these yet; `rawKeys.test.jsx`'s static net checks only that a key a source NAMES exists.

**Amended 2026-10-20 — the texts below are the Task 8 quality review's** (the dashboard lane's commit `f082251` on `feat/g2v-dash`, after its Task 8 commit `886cb12`, which was this task verbatim): no "hekim" in who entered the normal (nurses, charge nurses and rapid response hold `clinical.chart` too — O15); `baselineNotDeviceAlarm` says what the ranges do to alarms; `trendsLegendPoints` says the dashed line is not a measurement; `trendsKeysHint` says ← goes back; `trendsChartLabel` counts the points drawn; `trendsThinned` takes `{channel}` (Task 12's legend passes it); `baselineClearsNote` names the baseline SOFA; `trendsColTime` "Zaman"/"Vaxt" (so it leaves `AZ_SAME_AS_TR`, five entries now) and `trendsColMarker` "Olay"/"Hadisə"/"Событие"/"Event"; az `baselineNotNumber` "ədəd daxil edin", "oxunmur" → "oxuna bilmir"; en/ru nits. Every later task's test that quotes one of them quotes the corrected text.

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
    onlyWrite: "Bu ekran hasta kaydına iki şey yazar, ikisi de yalnız clinical.chart yetkisiyle: şüpheli enfeksiyon işareti ve hastanın normali; başka hiçbir şey buradan yazılmaz.",
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
    trendsNote: "NEWS2 · yetişkin bantları; hastanın normali, girildiyse",
    trendsLoading: "Vital eğrileri okunuyor…",
    trendsUnreadable: "Vital eğrileri okunamıyor (son: {time})",
    trendsNoData: "Bu kanal için ölçüm yok",
    trendsSingle: "tek ölçüm",
    trendsDelta: "{delta} (öncekine göre)",
    trendsFrameBadge: "NEWS2 +{points}",
    trendsOwnNormalPill: "Hastanın normalinde",
    trendsOpen: "{channel}: büyük grafiği aç",
    trendsChartLabel: "{channel}: son {hours} saat, çizilen nokta {count}",
    trendsThinned: "{channel} seyreltildi: {total} noktadan {kept}",
    trendsBandNews2: "NEWS2 bandı (yetişkin) · kaynak {source}",
    trendsBandPoints12: "1–2 puan",
    trendsBandPoints3: "3 puan",
    trendsBandOwn: "hastanın normali",
    trendsMarkerAlarm: "alarm",
    trendsMarkerAntibiotic: "antibiyotik",
    trendsLegendPoints: "noktalar ölçüm; aralarındaki kesikli çizgi ölçüm değil",
    trendsHoursLabel: "Zaman aralığı",
    trendsHours6: "6 sa",
    trendsHours24: "24 sa",
    trendsHours72: "3 gün",
    trendsViewLabel: "Görünüm",
    trendsGraph: "Grafik",
    trendsTable: "Tablo",
    trendsReadoutIdle: "Bir ölçümü okumak için grafiğin üzerine gelin ya da ← → tuşlarını kullanın.",
    trendsKeysHint: "Grafik seçiliyken ← → önceki / sonraki ölçüm, Home/End ilk / son ölçüm.",
    trendsCaption: "{channel} — ölçümler, en yeni üstte",
    trendsColTime: "Zaman",
    trendsColChannel: "Kanal",
    trendsColValue: "Değer",
    trendsColUnit: "Birim",
    trendsColBand: "NEWS2 puanı",
    trendsColMarker: "Olay",
    baselineOpen: "Hastanın normali…",
    baselineTitle: "Hastanın normali",
    baselineNotDeviceAlarm: "Bu aralıklar monitörün alarm sınırı değildir. Motor bunları kullanır: NEWS2 puanı alan bütün değerler bu aralıklardaysa bulgu gösterilir ama alarm vermez; aralığın dışına çıkan değeri ayrıca bildirir.",
    baselineLow: "alt",
    baselineHigh: "üst",
    baselineBothOrNeither: "iki sınır da gerekli",
    baselineLowAboveHigh: "alt sınır üst sınırdan büyük",
    baselineNotNumber: "sayı girin",
    baselineClearsNote: "Boş bırakılan aralık silinir. Komorbiditeler ve bazal SOFA değişmez.",
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
    onlyWrite: "Bu ekran xəstə qeydinə iki şey yazır, hər ikisi yalnız clinical.chart səlahiyyəti ilə: şübhəli infeksiya işarəsi və xəstənin norması; buradan başqa heç nə yazılmır.",
```

(b) Replace:

```js
    formsSoon: "SOFA formasının doldurulması/imzalanması və xəstənin öz normasının daxil edilməsi bu ekrana növbəti qrupda əlavə olunacaq.",
```

with:

```js
    formsSoon: "SOFA formasının doldurulması və imzalanması bu ekrana növbəti qrupda əlavə olunacaq.",
    trendsNote: "NEWS2 · yetkin zolaqları; xəstənin norması, daxil edilibsə",
    trendsLoading: "Vital qrafikləri oxunur…",
    trendsUnreadable: "Vital qrafikləri oxuna bilmir (son: {time})",
    trendsNoData: "Bu kanal üçün ölçmə yoxdur",
    trendsSingle: "tək ölçmə",
    trendsDelta: "{delta} (əvvəlkinə görə)",
    trendsFrameBadge: "NEWS2 +{points}",
    trendsOwnNormalPill: "Xəstənin normasında",
    trendsOpen: "{channel}: böyük qrafiki aç",
    trendsChartLabel: "{channel}: son {hours} saat, çəkilən nöqtə {count}",
    trendsThinned: "{channel} seyrəldildi: {total} nöqtədən {kept}",
    trendsBandNews2: "NEWS2 zolağı (yetkin) · mənbə {source}",
    trendsBandPoints12: "1–2 bal",
    trendsBandPoints3: "3 bal",
    trendsBandOwn: "xəstənin norması",
    trendsMarkerAlarm: "siqnal",
    trendsMarkerAntibiotic: "antibiotik",
    trendsLegendPoints: "nöqtələr ölçmədir; aralarındakı qırıq xətt ölçmə deyil",
    trendsHoursLabel: "Vaxt aralığı",
    trendsHours6: "6 saat",
    trendsHours24: "24 saat",
    trendsHours72: "3 gün",
    trendsViewLabel: "Görünüş",
    trendsGraph: "Qrafik",
    trendsTable: "Cədvəl",
    trendsReadoutIdle: "Ölçməni oxumaq üçün qrafikin üzərinə gəlin və ya ← → düymələrindən istifadə edin.",
    trendsKeysHint: "Qrafik seçiləndə ← → əvvəlki / növbəti ölçmə, Home/End ilk / son ölçmə.",
    trendsCaption: "{channel} — ölçmələr, ən yenisi yuxarıda",
    trendsColTime: "Vaxt",
    trendsColChannel: "Kanal",
    trendsColValue: "Dəyər",
    trendsColUnit: "Vahid",
    trendsColBand: "NEWS2 balı",
    trendsColMarker: "Hadisə",
    baselineOpen: "Xəstənin norması…",
    baselineTitle: "Xəstənin norması",
    baselineNotDeviceAlarm: "Bu aralıqlar monitorun siqnal həddi deyil. Mühərrik onlardan istifadə edir: NEWS2 balı verən bütün dəyərlər bu aralıqlardadırsa, tapıntı göstərilir, lakin siqnal verilmir; aralıqdan çıxan dəyər ayrıca bildirilir.",
    baselineLow: "alt",
    baselineHigh: "üst",
    baselineBothOrNeither: "hər iki hədd lazımdır",
    baselineLowAboveHigh: "alt hədd üst həddən böyükdür",
    baselineNotNumber: "ədəd daxil edin",
    baselineClearsNote: "Boş saxlanılan aralıq silinir. Yanaşı xəstəliklər və bazal SOFA dəyişmir.",
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
    onlyWrite: "Этот экран записывает в карту пациента две вещи, обе только с правом clinical.chart: отметку о подозрении на инфекцию и норму пациента; больше отсюда ничего не записывается.",
```

(b) Replace:

```js
    formsSoon: "Заполнение и подпись формы SOFA и ввод собственной нормы пациента будут добавлены на этот экран в следующей группе.",
```

with:

```js
    formsSoon: "Заполнение и подпись формы SOFA будут добавлены на этот экран в следующей группе.",
    trendsNote: "Полосы NEWS2 · для взрослых; норма пациента — если введена",
    trendsLoading: "Графики показателей загружаются…",
    trendsUnreadable: "Графики показателей не загружаются (последнее чтение: {time})",
    trendsNoData: "Для этого канала измерений нет",
    trendsSingle: "одно измерение",
    trendsDelta: "{delta} (к предыдущему)",
    trendsFrameBadge: "NEWS2 +{points}",
    trendsOwnNormalPill: "В пределах нормы пациента",
    trendsOpen: "{channel}: открыть большой график",
    trendsChartLabel: "{channel}: последние {hours} ч, точек на графике — {count}",
    trendsThinned: "{channel}: прорежено, показано {kept} из {total}",
    trendsBandNews2: "Полоса NEWS2 (взрослые) · источник {source}",
    trendsBandPoints12: "1–2 балла",
    trendsBandPoints3: "3 балла",
    trendsBandOwn: "норма пациента",
    trendsMarkerAlarm: "тревога",
    trendsMarkerAntibiotic: "антибиотик",
    trendsLegendPoints: "точки — измерения; пунктир между ними — не измерение",
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
    trendsColUnit: "Ед. изм.",
    trendsColBand: "Баллы NEWS2",
    trendsColMarker: "Событие",
    baselineOpen: "Норма пациента…",
    baselineTitle: "Норма пациента",
    baselineNotDeviceAlarm: "Эти диапазоны — не пределы тревог монитора. Система их использует: если все значения, дающие баллы NEWS2, лежат внутри своих диапазонов, находка показывается, но тревогу не вызывает; значение, вышедшее за диапазон, сообщается отдельно.",
    baselineLow: "нижняя",
    baselineHigh: "верхняя",
    baselineBothOrNeither: "нужны обе границы",
    baselineLowAboveHigh: "нижняя граница больше верхней",
    baselineNotNumber: "введите число",
    baselineClearsNote: "Пустой диапазон удаляется. Сопутствующие заболевания и базовый SOFA не меняются.",
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
    onlyWrite: "This screen writes two things to the patient's record, both only with clinical.chart: the suspected-infection charting and the patient's normal; nothing else is written from here.",
```

(b) Replace:

```js
    formsSoon: "Filling in and signing the SOFA form and entering the patient's own normal come to this screen in the next group.",
```

with:

```js
    formsSoon: "Filling in and signing the SOFA form comes to this screen in the next group.",
    trendsNote: "NEWS2 · adult bands; the patient's normal, if one was entered",
    trendsLoading: "Loading vital trends…",
    trendsUnreadable: "Vital trends cannot be loaded (last read {time})",
    trendsNoData: "No measurement for this channel",
    trendsSingle: "one measurement",
    trendsDelta: "{delta} (vs the previous)",
    trendsFrameBadge: "NEWS2 +{points}",
    trendsOwnNormalPill: "Within the patient's normal",
    trendsOpen: "{channel}: open the large chart",
    trendsChartLabel: "{channel}: last {hours} h, {count} points drawn",
    trendsThinned: "{channel} thinned: {kept} of {total} points shown",
    trendsBandNews2: "NEWS2 band (adult) · source {source}",
    trendsBandPoints12: "1–2 points",
    trendsBandPoints3: "3 points",
    trendsBandOwn: "the patient's normal",
    trendsMarkerAlarm: "alarm",
    trendsMarkerAntibiotic: "antibiotic",
    trendsLegendPoints: "dots are measurements; the dashed line between them is not one",
    trendsHoursLabel: "Window",
    trendsHours6: "6 h",
    trendsHours24: "24 h",
    trendsHours72: "3 days",
    trendsViewLabel: "View",
    trendsGraph: "Chart",
    trendsTable: "Table",
    trendsReadoutIdle: "Hover over the chart or use ← → to read a measurement.",
    trendsKeysHint: "With the chart focused: ← → previous / next measurement, Home/End the first / the last.",
    trendsCaption: "{channel} — measurements, newest first",
    trendsColTime: "Time",
    trendsColChannel: "Channel",
    trendsColValue: "Value",
    trendsColUnit: "Unit",
    trendsColBand: "NEWS2 points",
    trendsColMarker: "Event",
    baselineOpen: "The patient's normal…",
    baselineTitle: "The patient's normal",
    baselineNotDeviceAlarm: "These ranges are not the monitor's alarm limits. The engine uses them: when every value that scores NEWS2 points sits inside its range, the finding is shown but does not alarm; a value that leaves its range is reported on its own.",
    baselineLow: "low",
    baselineHigh: "high",
    baselineBothOrNeither: "both limits are needed",
    baselineLowAboveHigh: "the low limit is above the high one",
    baselineNotNumber: "enter a number",
    baselineClearsNote: "A range left empty is deleted. Comorbidities and the baseline SOFA are not changed.",
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
  "patient.trendsColChannel", // Kanal — the same word (beds.staleChannels: az "Gecikmiş kanal", beds.js:81)
  "patient.baselineLow", //    alt — "lower" in Azerbaijani too
  "patient.baselineHigh", //   üst — "upper" in Azerbaijani too
```

- [ ] **Step 7: Green, then the gate.**

```bash
cd /c/tmp/g2-vital/dashboard
npx vitest run src/live/i18n/ src/live/rawKeys.test.jsx src/live/screens/patient/ 2>&1 | grep -E "Test Files|Tests "
```
Expected: `Test Files  6 passed (6)`, `Tests  97 passed (97)` — the patient screen's own test still passes: its `heç nə yazılmır` and `növbəti qrupda əlavə olunacaq` match the new sentences. Then the suite — **81 / 2130** in plan order (the lane alone, `f082251`: 81 / 2127) — and the build.

- [ ] **Step 8: Commit.**

```bash
cd /c/tmp/g2-vital
git add dashboard/src/live/i18n/strings/patient.js dashboard/src/live/i18n/strings.test.js
git status --short && git diff --cached --stat
git commit -m "feat(i18n): the trend charts' and the patient's normal's words, in four languages" -m "Spec §9's 31 new keys and 18 the table, the dialog's controls and the form need. onlyWrite now names the two writes and formsSoon only the SOFA form (the patient's normal arrives in this slice). One neutral key, five reviewed az = tr. AZ and RU await a native reading.

red: 2 failed — az patient.trendsFrameBadge = tr; ru patient.trendsFrameBadge has no Cyrillic" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

# Part 3 · The patient screen (Tasks 9–14, one chain: each edits `TrendsBox.jsx`)

### Task 9: The box where the placeholder stood, and the read behind it

Spec §3.1 (the box, its header, its unreadable state) and §6 (`useTrends`). The box is wired into the patient screen in this task — `reachable.test.js` refuses a module the page cannot reach — so for one commit it holds only its header and its states; the cards come in Task 10.

`useTrends(patientId, hours, measuredKey)` reads through `store.track(() => store.api.patientTrends(…))`: on mount, on a new patient or window (what is shown is cleared first, so another patient's answer is never on screen), when the board's `measuredAt` for the patient changes (`measuredKeyOf`), and every `TRENDS_POLL_MS = 60 000` while the page is visible and the session READY; nothing while LOCKED, and an answer landing after the lock, a sign-out (`store.epoch()`) or an unmount is dropped. A failed or malformed read keeps the last answer and reports `unreadable` with `lastOkAt`. The forms seam keeps its sentence, as a `Note` under the Sepsis/Meds row; `trendsSoon` goes.

**As the dashboard lane built it (commits `620d4ed` and `dac5051`, the Task 9 quality review — X23); the blocks below are that code.** Reads for the same patient and window no longer supersede each other: only a move to another patient or window, leaving READY and an unmount discard a read in flight. A new measurement, the timer, a return to the page or `reload()` that arrives while a read is out sets one queued flag, and ONE more read follows when it settles (success or failure) — so measurements arriving faster than the endpoint answers still fill the box, and a `reload()` after a save is a read made after the save. The minute timer is not armed while the page is hidden; `reload()` reads only while READY. The unreadable line is a warn `Note` (`role="note"`, not a live region), the first line of the box's body, as the monitor strip says the same state. The return shape is unchanged.

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

  it("a poll in flight does not bring the loading state back: the last answer stays, no blink", async () => {
    let late;
    const { api } = await start();
    api.patientTrends.mockImplementationOnce((pid, hours) => new Promise((resolve) => { late = () => resolve(withHr(90)(pid, hours)); }));
    await act(async () => { await vi.advanceTimersByTimeAsync(TRENDS_POLL_MS); });
    expect(api.patientTrends).toHaveBeenCalledTimes(2);
    expect(probe().dataset).toMatchObject({ loading: "false", unreadable: "false", patient: "S-001" });
    expect(probe()).toHaveTextContent("84");
    await act(async () => { late(); });
    await flush();
    expect(probe()).toHaveTextContent("90");
  });

  it("a new measurement during a read in flight does not discard it: it lands, and ONE more read follows", async () => {
    const lands = [];
    const answer = (pid, hours) => new Promise((resolve) => { lands.push((value) => resolve(withHr(value)(pid, hours))); });
    const { api } = await start({ answer });
    expect(api.patientTrends).toHaveBeenCalledTimes(1);
    for (const next of ["k2", "k3", "k4"]) act(() => setProps((p) => ({ ...p, measuredKey: next })));
    await flush();
    expect(api.patientTrends).toHaveBeenCalledTimes(1);          // joined the read in flight, not started over
    expect(probe().dataset.loading).toBe("true");
    await act(async () => { lands[0](84); });
    await flush();
    expect(probe()).toHaveTextContent("84");                      // the first read was not thrown away
    expect(probe().dataset.loading).toBe("false");
    expect(api.patientTrends).toHaveBeenCalledTimes(2);          // three keys asked for one more read, not three
    await act(async () => { lands[1](91); });
    await flush();
    expect(probe()).toHaveTextContent("91");
    expect(api.patientTrends).toHaveBeenCalledTimes(2);
  });

  it("fills the box when measurements arrive faster than the endpoint answers", async () => {
    const slow = (pid, hours) => new Promise((resolve) => { setTimeout(() => resolve(withHr(84)(pid, hours)), 6_000); });
    const { api } = await start({ answer: slow });
    for (let i = 1; i <= 4; i += 1) {
      act(() => setProps((p) => ({ ...p, measuredKey: `k${i}` })));          // a measurement every 5 s,
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });  // an answer every 6 s
    }
    expect(probe().dataset).toMatchObject({ loading: "false", unreadable: "false", patient: "S-001" });
    expect(probe()).toHaveTextContent("84");
    expect(api.patientTrends).toHaveBeenCalledTimes(4);          // one read at a time, each as soon as the last landed
  });

  it("a read asked for while one is in flight is made even when that one fails, and reload() after a save is that read", async () => {
    let fail;
    const pending = () => new Promise((_resolve, reject) => { fail = () => reject(Object.assign(new Error("down"), { status: 503 })); });
    const { api } = await start({ answer: pending });
    api.patientTrends.mockImplementation(answering(withHr(77)));
    fireEvent.click(screen.getByRole("button", { name: "again" }));       // the save landed while the old read was out
    await flush();
    expect(api.patientTrends).toHaveBeenCalledTimes(1);
    await act(async () => { fail(); });
    await flush();
    expect(api.patientTrends).toHaveBeenCalledTimes(2);
    expect(probe()).toHaveTextContent("77");
    expect(probe().dataset).toMatchObject({ loading: "false", unreadable: "false" });
  });

  it("arms no timer while the page is hidden, ignores a measurement then, reads once on the return, and the minute starts from there", async () => {
    const { api } = await start();
    const armed = vi.getTimerCount();
    act(() => visibility("hidden"));
    expect(vi.getTimerCount()).toBe(armed - 1);
    act(() => setProps((p) => ({ ...p, measuredKey: "k2" })));
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * TRENDS_POLL_MS); });
    expect(api.patientTrends).toHaveBeenCalledTimes(1);           // the wake covers the measurement
    act(() => visibility("visible"));
    await flush();
    expect(api.patientTrends).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(armed);
    await act(async () => { await vi.advanceTimersByTimeAsync(TRENDS_POLL_MS - 1_000); });
    expect(api.patientTrends).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(api.patientTrends).toHaveBeenCalledTimes(3);
  });

  it("a move to another window clears what is shown, as a move to another patient does, and reads that window", async () => {
    let late;
    const answer = (pid, hours) => (hours === 24
      ? Promise.resolve(withHr(84)(pid, hours))
      : new Promise((resolve) => { late = () => resolve(withHr(70)(pid, hours)); }));
    const { api } = await start({ answer });
    expect(probe()).toHaveTextContent("84");
    act(() => setProps((p) => ({ ...p, hours: 6 })));
    expect(probe().dataset).toMatchObject({ patient: "", loading: "true" });
    expect(probe().textContent).toBe("");
    expect(api.patientTrends).toHaveBeenLastCalledWith("S-001", 6);
    await act(async () => { late(); });
    await flush();
    expect(probe().dataset).toMatchObject({ patient: "S-001", loading: "false" });
    expect(probe()).toHaveTextContent("70");
  });

  it("takes the listener away at the lock, reads nothing while locked, and reads exactly once after the unlock", async () => {
    const { api, store } = await start();
    const removed = vi.spyOn(document, "removeEventListener");
    try {
      act(() => { store.lock(); });
      expect(removed.mock.calls.filter(([type]) => type === "visibilitychange")).toHaveLength(1);
    } finally {
      removed.mockRestore();
    }
    act(() => visibility("hidden"));
    act(() => visibility("visible"));
    fireEvent.click(screen.getByRole("button", { name: "again" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(3 * TRENDS_POLL_MS); });
    expect(api.patientTrends).toHaveBeenCalledTimes(1);           // not the page returning, not reload(), not the clock
    api.reauth.mockResolvedValue({ ok: true });
    await act(async () => { await store.unlock("Gizli-Sifre-1"); });
    await flush();
    expect(api.patientTrends).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(TRENDS_POLL_MS); });
    expect(api.patientTrends).toHaveBeenCalledTimes(3);           // and the minute is running again
  });

  it("takes a window that reached it as a string: the engine's number still answers it", async () => {
    const { api } = await start({ hours: "24", answer: answering((pid) => withHr(84)(pid, 24)) });
    expect(api.patientTrends.mock.calls).toEqual([["S-001", "24"]]);
    expect(probe().dataset).toMatchObject({ loading: "false", unreadable: "false", patient: "S-001" });
    expect(probe()).toHaveTextContent("84");
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
// Six rules, each held by useTrends.test.jsx:
//   * READ ONLY WHILE THE SESSION IS READY. A locked screen shows nothing of a patient, so nothing
//     is read for one — not by the timer, not by `reload()`; an answer that lands after the lock, a
//     sign-out or another sign-in is dropped. (The shell also unmounts at the lock, which clears the
//     timers; this does not rely on it.)
//   * A FAILED READ KEEPS THE LAST ANSWER and says the trends are unreadable, with the time the last
//     answer came — the monitor strip's rule. A chart that went blank on one dropped request would
//     read as "no measurements", which is a claim about the patient, and a false one.
//   * NEVER ANOTHER PATIENT'S ANSWER. A move to another patient or window shows nothing until that
//     one answers, and a late answer for the one left behind is dropped. That move — and leaving
//     READY, and unmounting — are the ONLY things that discard a read in flight.
//   * READS FOR THE SAME PATIENT AND WINDOW DO NOT SUPERSEDE EACH OTHER (the shadow store's
//     `inFlight` guard). A new measurement, the timer, a return to the page or `reload()` that
//     arrives while a read is in flight sets one `queued` flag; when that read settles, success or
//     failure, ONE more is made. Measurements arriving faster than the endpoint answers (a burst
//     from one HL7 message, a 72 h window) therefore still fill the box, and a `reload()` after a
//     save still yields data read after the save.
//   * READ AGAIN when the board says something was measured (`measuredKey`), and once a minute while
//     the page is visible — an antibiotic charted elsewhere moves no `measuredAt`.
//   * A HIDDEN PAGE READS NOTHING. The minute timer is not armed while the page is hidden (no
//     no-op ticks), a new measurement does not read, and the return to visible reads once and
//     starts the minute again — the shadow store's cadence.
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

/** This patient's trends for this window — or not an answer at all. The window is compared as a
 *  number: a `hours` that reached us as "24" must not turn every answer into an unreadable one. */
const isTrends = (answer, patientId, hours) => Boolean(answer) && typeof answer === "object"
  && answer.patient_id === patientId && Number(answer.hours) === Number(hours) && Array.isArray(answer.channels);

// Either says hidden, it is hidden (the shadow store's rule).
const hidden = () => typeof document !== "undefined"
  && (document.visibilityState === "hidden" || document.hidden === true);

export function useTrends(patientId, hours, measuredKey = "") {
  const { phase, store } = useSession();
  const ready = phase === PHASE.READY;
  const key = `${patientId}|${hours}`;
  const [state, setState] = useState({ ...NOTHING, key });
  const generation = useRef(0);   // bumped when a read in flight may no longer land
  const inFlight = useRef(false);
  const queued = useRef(false);   // a read was asked for while one was in flight: one more, after it
  const readFor = useRef(null);   // the key the last pass read for; null while not READY

  /** Ask for a read of this patient and window — the one way every trigger gets one. */
  const request = useCallback(() => {
    if (store.getState().phase !== PHASE.READY) return;
    if (inFlight.current) {
      queued.current = true;
      return;
    }
    inFlight.current = true;
    queued.current = false;
    const mine = generation.current;
    const epoch = store.epoch();
    const stale = () => mine !== generation.current || epoch !== store.epoch()
      || store.getState().phase !== PHASE.READY;
    (async () => {
      let again = true;
      try {
        const answer = await store.track(() => store.api.patientTrends(patientId, hours));
        if (stale()) return;
        if (!isTrends(answer, patientId, hours)) throw new Error("not a trends answer");
        setState({ data: answer, loading: false, unreadable: false, lastOkAt: Date.now(), key });
      } catch (err) {
        if (err?.superseded) {
          again = false;
          return;
        }
        if (stale()) return;
        setState((s) => (s.key === key ? { ...s, loading: false, unreadable: true }
          : { ...NOTHING, loading: false, unreadable: true, key }));
      } finally {
        // Only the read that still counts frees the slot; one that was discarded left it to whoever
        // discarded it. A page that was hidden meanwhile reads when it comes back, not now.
        if (mine === generation.current) {
          inFlight.current = false;
          const next = again && queued.current && epoch === store.epoch() && !hidden();
          queued.current = false;
          if (next) request();
        }
      }
    })();
  }, [store, patientId, hours, key]);

  // Mount, a new patient or window, READY again: whatever is in flight is discarded and the read
  // starts afresh. Leaving READY: whatever is in flight will not land. The same patient and window
  // with a new measurement: a request (which joins the one in flight), unless the page is hidden.
  useEffect(() => {
    if (!ready) {
      generation.current += 1;
      inFlight.current = false;
      queued.current = false;
      readFor.current = null;
      return;
    }
    if (readFor.current !== key) {
      readFor.current = key;
      generation.current += 1;
      inFlight.current = false;
      queued.current = false;
      request();
    } else if (!hidden()) {
      request();
    }
  }, [ready, key, measuredKey, request]);

  // Once a minute while the page is visible. Hidden: no timer at all. Back: one read now, and the
  // minute starts from then.
  useEffect(() => {
    if (!ready) return undefined;
    let timer = 0;
    const stop = () => {
      clearTimeout(timer);
      timer = 0;
    };
    const arm = () => {
      stop();
      if (!hidden()) timer = setTimeout(tick, TRENDS_POLL_MS);
    };
    const tick = () => {
      timer = 0;
      request();
      arm();
    };
    const onVisibility = () => {
      if (hidden()) {
        stop();
        return;
      }
      request();
      arm();
    };
    arm();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ready, request]);

  // Gone: nothing late may land.
  useEffect(() => () => {
    generation.current += 1;
    inFlight.current = false;
    queued.current = false;
    readFor.current = null;
  }, []);

  const shown = state.key === key ? state : { ...NOTHING, key };
  return { data: shown.data, loading: shown.loading, unreadable: shown.unreadable, lastOkAt: shown.lastOkAt, reload: request };
}
```

- [ ] **Step 5: Green.** `npx vitest run src/live/screens/patient/trends/useTrends.test.jsx 2>&1 | grep -E "Tests "` → `Tests  17 passed (17)`.

- [ ] **Step 6: The screen's tests — red.** Four Edits in `dashboard/src/live/screens/patient/PatientScreen.test.jsx`.

(a) Replace:

```jsx
import { STAGE_OFF, bed as monitorBed, param as monitorParam, strip } from "../../data/shadow.testutil.js";
import { PatientScreen } from "./PatientScreen.jsx";
```

with:

```jsx
import { STAGE_OFF, bed as monitorBed, param as monitorParam, strip } from "../../data/shadow.testutil.js";
import { hhmm } from "../../i18n/dates.js";
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
      const said = screen.getByText("Vital qrafikləri oxuna bilmir (son: —)");
      expect(said.closest("[role='note']")).not.toBeNull();          // a note, as the monitor strip says it; not a live region
      expect(screen.queryAllByRole("alert").map((a) => a.textContent).join(" ")).not.toMatch(/Vital qrafikləri/);
    });

    it("say since when once a later read fails, after one that worked", async () => {
      const { api, stream } = await open({ payload: board([entry("S-001", [], FULL)]) });
      expect(screen.queryByText(/oxuna bilmir/)).toBeNull();
      api.patientTrends.mockRejectedValue(Object.assign(new Error("down"), { status: 503 }));
      await act(async () => { stream.frame(entry("S-001", [], { ...FULL, at: measured(10) })); await settle(); });
      // The time of the last read that worked (the browser's clock, pinned to NOW), not "—" and not the failure's.
      expect(screen.getByText(`Vital qrafikləri oxuna bilmir (son: ${hhmm(NOW)})`)).toBeInTheDocument();
      expect(screen.queryAllByRole("alert").map((a) => a.textContent).join(" ")).not.toMatch(/Vital qrafikləri/);
    });
  });
```

Run `npx vitest run src/live/screens/patient/PatientScreen.test.jsx 2>&1 | grep -E "×|Tests "`. Expected: `Tests  5 failed | 50 passed (55)` — "stand where…" (the placeholder's text is still there), "keep the forms seam…" (no note), "read the 24-hour trends…" (nothing reads), "say they cannot be read…" and "say since when once a later read fails…" (the Task 9 quality review's, lane commit `dac5051`).

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
// in a warn `Note` — the first line of the box's body, as the monitor strip says the same state —
// with the time that answer came. A `Note` is `role="note"`, not a live region, and not an alert:
// nothing the clinician did was refused, and a poll that fails once a minute must not interrupt.
import React from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { hhmm } from "../../../i18n/dates.js";
import { Box, Note } from "../../../ui/index.js";
import { measuredKeyOf, useTrends } from "./useTrends.js";

export function TrendsBox({ patient }) {
  const { t } = useI18n();
  const trends = useTrends(patient.patient_id, 24, measuredKeyOf(patient.measuredAt));
  return (
    <Box title={t("patient.trends")} icon="chart" level={2} right={t("patient.trendsNote")}>
      <div data-trends-box="">
        {trends.unreadable ? (
          <Note tone="warn" icon="alert" className="mb-2">
            {t("patient.trendsUnreadable", { time: trends.lastOkAt ? hhmm(trends.lastOkAt) : "—" })}
          </Note>
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
Expected: no `×`; `Test Files  9 passed (9)`, `Tests  130 passed (130)` — `PatientScreen.test.jsx` 55, `useTrends.test.jsx` 17 (`reachable.test.js` passes because PatientScreen imports the box, which imports the hook). Then the suite — **82 / 2152** in plan order (the lane alone, `dac5051`: 82 / 2149) — and the build.

- [ ] **Step 10: Commit.**

```bash
cd /c/tmp/g2-vital
git add dashboard/src/live/screens/patient/trends/trends.testutil.js dashboard/src/live/screens/patient/trends/useTrends.js dashboard/src/live/screens/patient/trends/useTrends.test.jsx dashboard/src/live/screens/patient/trends/TrendsBox.jsx dashboard/src/live/screens/patient/PatientScreen.jsx dashboard/src/live/screens/patient/PatientScreen.test.jsx dashboard/src/live/i18n/strings/patient.js
git status --short && git diff --cached --stat
git commit -m "feat(patient): the trends box where the placeholder stood, and the read behind it" -m "useTrends reads GET /patients/{id}/trends through the session's track: on mount, on a new patient or window (cleared first), on a new measurement (measuredKeyOf), every 60 s while READY and visible; nothing while locked, nothing late after a lock, a sign-out or an unmount; a failed read keeps the last answer and says since when. The forms seam keeps its sentence as a Note; trendsSoon goes.

red: useTrends — Failed to resolve import ./useTrends.js; PatientScreen 5 failed" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: The six cards — the engine's facts, printed and judged by nobody here

Spec §3.1 and D2, D3 with X7. `news2Tone(points)` is the ONE mapping from the engine's points to a tone (0 → none, 1–2 → `mid`, 3 → `crit`), shared by the card's frame here and the chart's bands in Task 11. `cards.js` lists the six cards in the bed card's order — pulse, respiration, SpO₂, systolic + MAP, temperature, lactate — with names, units and identity colours from `vitals.js`. A card prints each channel's latest value, the engine's delta with an arrow for its sign ("↑ +6", "↓ −3", "→ 0") or "tek ölçüm" when there was no previous one, and its age against the screen's `useBoardNow` instant; it is framed and badged ("NEWS2 +3") from the first channel's `news2_points` (systolic on the pressure card); the own-normal pill shows when `within_own_normal === true`. `ageText` moves out of PatientScreen.jsx so the two say an age the same way.

**As the dashboard lane built it (commits `004e9c3`, `4cdb563` and `339c3f2`, the Task 10 quality review — X24); the blocks below are that code.** Values print in `text-ink`; the identity colour stays on the title (and, from Task 11, on the line) — daylight `--v-map` equals `--crit`, and a calm pressure card must not show critical-red numbers. The badge and the own-normal pill belong to a reading: both sit on the first channel's row (systolic's on the pressure card), after the age; MAP's row never carries either, and the title row holds the title (`[data-title]`) and nothing else. A NEWS2 channel (the engine sent it bands) whose latest value came with no finite points wears an attention-tone "NEWS2: —" with its reason for a screen reader, and frames nothing — a card must not read as calm because the engine's answer was missing; MAP and lactate say nothing. "tek ölçüm" only for a delta of `null` — any other non-number prints no delta; the arrow is a glyph, so a screen reader hears the direction in words (`trendsDeltaUp/Down/Same`). `ageText` returns null unless `nowMs` is a finite number — never `Date.now()` (X7). The frame is `border-2` in every tone. In Russian MAP is "СрАД" ("САД" reads as systolic).

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

// `nowMs` is the screen's `useBoardNow` instant; a test about a card handed no clock passes `nowMs: undefined`.
function show(card, channels, { onOpen, ...clock } = {}) {
  render(
    <I18nProvider>
      <ul>
        <TrendCard card={card} channels={channelsOf(trends("S-001", channels))}
          nowMs={"nowMs" in clock ? clock.nowMs : NOW} onOpen={onOpen} />
      </ul>
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
    document.body.innerHTML = "";
    show(HR, [channel("heart_rate", [point(5, 108, 1)], { latest: latest({ value: 108, within_own_normal: null }) })]);
    expect(screen.queryByText("Xəstənin normasında")).toBeNull();
  });

  it("prints the engine's delta — not the difference of the points it was given", () => {
    show(HR, [channel("heart_rate", [point(60, 84, 0), point(5, 90, 0)], { latest: latest({ value: 90, delta: 2 }) })]);
    expect(screen.getByText("↑ +2 (əvvəlkinə görə)")).toBeInTheDocument();
    expect(screen.queryByText(/\+6/)).toBeNull();
  });

  it("says rose, fell or unchanged to a screen reader, and hides the arrow it is drawn with", () => {
    const cases = [
      [2, "↑ +2 (əvvəlkinə görə)", "yüksəldi +2 (əvvəlkinə görə)"],
      [-3, "↓ −3 (əvvəlkinə görə)", "düşdü −3 (əvvəlkinə görə)"],
      [0, "→ 0 (əvvəlkinə görə)", "eyni (əvvəlkinə görə)"],
    ];
    for (const [delta, drawn, spoken] of cases) {
      document.body.innerHTML = "";
      show(HR, [channel("heart_rate", [point(5, 90, 0)], { latest: latest({ value: 90, delta }) })]);
      expect(screen.getByText(drawn), String(delta)).toHaveAttribute("aria-hidden", "true");
      expect(screen.getByText(spoken), String(delta)).toHaveClass("sr-only");
    }
  });

  it("says when there was no previous measurement, and when there is none at all", () => {
    show(HR, [channel("heart_rate", [point(5, 84, 0)])]);
    expect(screen.getByText("tək ölçmə")).toBeInTheDocument();
    document.body.innerHTML = "";
    show(HR, []);
    expect(screen.getByText("Bu kanal üçün ölçmə yoxdur")).toBeInTheDocument();
  });

  it("says 'one measurement' only for a delta of null — any other non-number prints no delta at all", () => {
    for (const nothing of [undefined, Number.NaN, "2"]) {
      document.body.innerHTML = "";
      show(HR, [channel("heart_rate", [point(5, 84, 0)], { latest: latest({ value: 84, delta: nothing }) })]);
      expect(screen.queryByText("tək ölçmə"), String(nothing)).toBeNull();
      expect(screen.queryByText(/əvvəlkinə/), String(nothing)).toBeNull();
      expect(screen.getByText("84"), String(nothing)).toBeInTheDocument();
    }
  });

  it("says how long ago, against the clock it is handed", () => {
    show(HR, [channel("heart_rate", [point(5, 84, 0)])]);
    expect(screen.getByText("5 dəq əvvəl")).toBeInTheDocument();
  });

  it("prints no age at all when it is handed no clock — never the browser's own", () => {
    for (const none of [undefined, Number.NaN, null]) {
      document.body.innerHTML = "";
      const card = show(HR, [channel("heart_rate", [point(5, 84, 0)])], { nowMs: none });
      expect(card, String(none)).not.toHaveTextContent(/əvvəl/);
      expect(card, String(none)).toHaveTextContent("84");
    }
  });

  it("keeps the parts of a reading apart, so a reader does not hear '84/dəq↑ +2' as one word", () => {
    const card = show(HR, [channel("heart_rate", [point(5, 84, 0)], { latest: latest({ value: 84, delta: 2 }) })]);
    const text = card.querySelector("[data-series='heart_rate']").textContent;
    expect(text).toMatch(/84 \/dəq ↑ \+2 /);
    expect(text).toMatch(/ 5 dəq əvvəl$/);
  });

  it("prints the value in ink and keeps the channel's identity colour on the title", () => {
    const card = show(HR, [channel("heart_rate", [point(5, 84, 0)])]);
    expect(card.querySelector("[data-series='heart_rate'] b")).toHaveClass("text-ink");
    expect(card.querySelector("[data-series='heart_rate'] b")).not.toHaveClass("text-v-hr");
    expect(card.querySelector("[data-title]")).toHaveClass("text-v-hr");
  });

  it("keeps the frame the same width in every tone, so nothing moves when the tone does", () => {
    for (const points of [0, 2, 3]) {
      document.body.innerHTML = "";
      const card = show(HR, [channel("heart_rate", [point(5, 72, points)], { latest: latest({ news2_points: points }) })]);
      expect(card, String(points)).toHaveClass("border-2");
    }
  });

  it("says out loud that a NEWS2 channel was not scored — and frames nothing", () => {
    for (const points of [null, undefined, "3"]) {
      document.body.innerHTML = "";
      const card = show(HR, [channel("heart_rate", [point(5, 132, null)], { latest: latest({ value: 132, news2_points: points }) })]);
      expect(card.dataset.frame, String(points)).toBe("none");
      expect(screen.getByText("NEWS2: —"), String(points)).toHaveAttribute("aria-hidden", "true");
      expect(screen.getByText("NEWS2: —").closest("[data-tone]"), String(points)).toHaveAttribute("data-tone", "warn");
      expect(screen.getByText("NEWS2 balı yoxdur: son ölçmə qiymətləndirilməyib"), String(points)).toHaveClass("sr-only");
      expect(screen.queryByText(/NEWS2 \+/), String(points)).toBeNull();
    }
  });

  it("says nothing about points where the engine has none to give (MAP, lactate)", () => {
    const card = show(PRESSURE, [
      channel("sbp", [point(5, 120, 0)], { latest: latest({ value: 120, news2_points: 0 }) }),
      channel("map", [point(5, 90)], { latest: latest({ value: 90, news2_points: null }) }),
    ]);
    expect(card.dataset.frame).toBe("none");
    expect(screen.queryByText(/NEWS2/)).toBeNull();
    document.body.innerHTML = "";
    show(LACTATE, [channel("lactate", [point(5, 2.1)], { latest: latest({ value: 2.1, news2_points: undefined }) })]);
    expect(screen.queryByText(/NEWS2/)).toBeNull();
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

  it("carries the badge on systolic's row, so the reader sees whose points they are — MAP's row has none", () => {
    const card = show(PRESSURE, [
      channel("sbp", [point(5, 88, 3)], { latest: latest({ value: 88, news2_points: 3 }) }),
      channel("map", [point(5, 58)], { latest: latest({ value: 58, news2_points: null }) }),
    ]);
    expect(card.querySelector("[data-series='sbp']")).toHaveTextContent("NEWS2 +3");
    expect(card.querySelector("[data-series='map']")).not.toHaveTextContent(/NEWS2/);
    expect(card.querySelector("[data-title]")).not.toHaveTextContent(/NEWS2/);
    document.body.innerHTML = "";
    const unscored = show(PRESSURE, [
      channel("sbp", [point(5, 88, null)], { latest: latest({ value: 88, news2_points: null }) }),
      channel("map", [point(5, 58)], { latest: latest({ value: 58, news2_points: null }) }),
    ]);
    expect(unscored.querySelector("[data-series='sbp']")).toHaveTextContent("NEWS2: —");
    expect(unscored.querySelector("[data-series='map']")).not.toHaveTextContent(/NEWS2/);
    expect(screen.getAllByText("NEWS2: —")).toHaveLength(1);
  });

  it("puts the own-normal pill on the reading it judges: systolic's, beside the badge — never MAP's or the title's", () => {
    const card = show(PRESSURE, [
      channel("sbp", [point(5, 108, 1)], { latest: latest({ value: 108, news2_points: 1, within_own_normal: true }) }),
      channel("map", [point(5, 58)], { latest: latest({ value: 58, news2_points: null, within_own_normal: true }) }),
    ]);
    const pill = screen.getByText("Xəstənin normasında");
    expect(card.querySelector("[data-series='sbp']")).toContainElement(pill);
    expect(card.querySelector("[data-series='sbp']")).toHaveTextContent(/NEWS2 \+1.*Xəstənin normasında/);
    expect(card.querySelector("[data-series='map']")).not.toHaveTextContent("Xəstənin normasında");
    expect(card.querySelector("[data-title]")).not.toHaveTextContent("Xəstənin normasında");
    expect(screen.getAllByText("Xəstənin normasında")).toHaveLength(1);
    expect(card.dataset.frame).toBe("mid");
  });

  it("never frames a card from MAP — whatever points it is handed", () => {
    const card = show(PRESSURE, [
      channel("sbp", [point(5, 120, 0)], { latest: latest({ value: 120, news2_points: 0 }) }),
      channel("map", [point(5, 58)], { latest: latest({ value: 58, news2_points: 3 }) }),
    ]);
    expect(card.dataset.frame).toBe("none");
    expect(card).not.toHaveClass("border-crit");
    expect(screen.queryByText(/NEWS2/)).toBeNull();
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
//
// NO CLOCK, NO AGE. `ageOf` falls back to the browser's own `Date.now()` for a missing instant —
// which is the one clock a ward tablet cannot be trusted to have right (X7) — so a caller that was
// not handed the server's instant gets `null` here, and prints no age rather than a wrong one.
import { ageOf } from "../common/freshness.js";
import { ageParts } from "../common/feedHealth.js";

export function ageText(t, iso, nowMs) {
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) return null;
  const ms = ageOf(iso, nowMs);
  if (ms === null) return null;
  const parts = ageParts(ms / 1000);
  const key = parts.unit === "s" ? "board.ageS" : parts.unit === "m" ? "board.ageM" : "board.ageH";
  return t("patient.vitalAge", { age: t(key, { count: parts.value }) });
}
```

(The one difference from PatientScreen.jsx's copy: no instant → `null` up front. The old one computed `ageParts(NaN)` = "NaN sa" and relied on its caller not printing it.)

Then the card's words that Task 8 did not have (the Task 10 quality review, lane commits `4cdb563` and `339c3f2`; X24): the attention tag "NEWS2: —" for a NEWS2 channel the engine sent no finite points for, with its reason for a screen reader, and the delta's direction in words (the arrow is a glyph). Four Edits in `dashboard/src/live/i18n/strings/patient.js`. In `tr`, replace:

```js
    trendsDelta: "{delta} (öncekine göre)",
    trendsFrameBadge: "NEWS2 +{points}",
```

with:

```js
    trendsDelta: "{delta} (öncekine göre)",
    trendsFrameBadge: "NEWS2 +{points}",
    trendsDeltaUp: "yükseldi",
    trendsDeltaDown: "düştü",
    trendsDeltaSame: "aynı",
    trendsPointsUnknown: "NEWS2: —",
    trendsPointsUnknownSr: "NEWS2 puanı yok: son ölçüm puanlanmadı",
```

In `az`, replace:

```js
    trendsDelta: "{delta} (əvvəlkinə görə)",
    trendsFrameBadge: "NEWS2 +{points}",
```

with:

```js
    trendsDelta: "{delta} (əvvəlkinə görə)",
    trendsFrameBadge: "NEWS2 +{points}",
    trendsDeltaUp: "yüksəldi",
    trendsDeltaDown: "düşdü",
    trendsDeltaSame: "eyni",
    trendsPointsUnknown: "NEWS2: —",
    trendsPointsUnknownSr: "NEWS2 balı yoxdur: son ölçmə qiymətləndirilməyib",
```

In `ru`, replace:

```js
    trendsDelta: "{delta} (к предыдущему)",
    trendsFrameBadge: "NEWS2 +{points}",
```

with:

```js
    trendsDelta: "{delta} (к предыдущему)",
    trendsFrameBadge: "NEWS2 +{points}",
    trendsDeltaUp: "выросло",
    trendsDeltaDown: "снизилось",
    trendsDeltaSame: "без изменений",
    trendsPointsUnknown: "NEWS2: —",
    trendsPointsUnknownSr: "Нет баллов NEWS2: последнее измерение не оценено",
```

In `en`, replace:

```js
    trendsDelta: "{delta} (vs the previous)",
    trendsFrameBadge: "NEWS2 +{points}",
```

with:

```js
    trendsDelta: "{delta} (vs the previous)",
    trendsFrameBadge: "NEWS2 +{points}",
    trendsDeltaUp: "rose",
    trendsDeltaDown: "fell",
    trendsDeltaSame: "unchanged",
    trendsPointsUnknown: "NEWS2: —",
    trendsPointsUnknownSr: "No NEWS2 points: the last reading was not scored",
```

"NEWS2: —" is the score's name and a dash in every language: two Edits in `dashboard/src/live/i18n/strings.test.js` register it. Replace:

```js
  "patient.trendsFrameBadge", //  "NEWS2 +{points}" — the score's own name and a number (Group 2)
```

with:

```js
  "patient.trendsFrameBadge", //  "NEWS2 +{points}" — the score's own name and a number (Group 2)
  "patient.trendsPointsUnknown", // "NEWS2: —" — the score's own name and a dash (Group 2)
```

and replace:

```js
  "patient.trendsFrameBadge", // "NEWS2 +{points}" — the score's name and a number
```

with:

```js
  "patient.trendsFrameBadge", // "NEWS2 +{points}" — the score's name and a number
  "patient.trendsPointsUnknown", // "NEWS2: —" — the score's name and a dash
```

And in Russian the MAP label "САД" reads as systolic (систолическое АД), where a vasopressor target is a MAP: Edit `dashboard/src/live/i18n/strings/board.js` — replace:

```js
    chMap: "САД",
```

with:

```js
    chMap: "СрАД",
```

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
// The badge and the own-normal pill belong to a READING, not to the card: both sit on the first
// channel's row (systolic's, on the pressure card), so the reader sees whose points and whose
// verdict they are; MAP's row never carries either (the engine keeps no baseline for MAP) and MAP
// never frames the card. The title row holds the title and nothing else. A NEWS2 channel (the engine sent it bands) whose latest value arrived
// with no points says so — "NEWS2: —", in attention tone, with the reason for a screen reader — and
// frames nothing: a card must not read as calm because the engine's answer was missing.
//
// VALUES ARE PRINTED IN INK. The channel's identity colour stays on the title (and, from Task 11,
// on the line); daylight's `--v-map` equals `--crit`, and a calm pressure card must not show
// critical-red numbers (the bed card and the measured-values box print in ink for the same reason).
//
// `nowMs` is required: the patient screen's `useBoardNow` instant. Without a finite one no age is
// printed — never the browser's clock (X7; `ageText`).
//
// The frame is `border-2` in every tone, so nothing moves by a pixel when the tone changes.
//
// A button only when it can open the big chart (`onOpen`).
import React from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { Pill, Tag } from "../../../ui/index.js";
import { FOCUS_RING } from "../../../ui/focus.js";
import { ageText } from "../ageText.js";
import { cardTitle } from "./cards.js";
import { news2Tone } from "./news2Tone.js";

const FRAME = { none: "border-2 border-line", mid: "border-2 border-mid", crit: "border-2 border-crit" };
const BADGE = { mid: "warn", crit: "crit" };

/** The engine's delta in its parts — the arrow it is drawn with, the signed number, and the word a
 *  screen reader gets in place of the arrow; null for no number. Formatting only: the sign picks the
 *  arrow, nothing is computed from the value. */
function deltaParts(delta) {
  if (typeof delta !== "number" || !Number.isFinite(delta)) return null;
  if (delta > 0) return { arrow: "↑", number: `+${delta}`, word: "patient.trendsDeltaUp" };
  if (delta < 0) return { arrow: "↓", number: `−${Math.abs(delta)}`, word: "patient.trendsDeltaDown" };
  return { arrow: "→", number: "0", word: "patient.trendsDeltaSame" };
}

/** The engine's delta as the card prints it: "↑ +6", "↓ −3", "→ 0"; null for no number. */
export function deltaText(delta) {
  const parts = deltaParts(delta);
  return parts ? `${parts.arrow} ${parts.number}` : null;
}

/** The delta as a screen reader gets it: "rose +6 (vs the previous)", "unchanged (vs the previous)". */
function Delta({ delta }) {
  const { t } = useI18n();
  const parts = deltaParts(delta);
  if (!parts) return null;
  const spoken = parts.word === "patient.trendsDeltaSame" ? t(parts.word) : `${t(parts.word)} ${parts.number}`;
  return (
    <span className="ml-1 font-data text-12 font-semibold text-ink">
      <span aria-hidden="true">{t("patient.trendsDelta", { delta: deltaText(delta) })}</span>
      <span className="sr-only">{t("patient.trendsDelta", { delta: spoken })}</span>
    </span>
  );
}

/** "NEWS2 +3" for the engine's points, "NEWS2: —" for a NEWS2 channel it sent none for. */
function Badge({ tone, points, unscored }) {
  const { t } = useI18n();
  if (tone) return <Tag tone={BADGE[tone]}>{t("patient.trendsFrameBadge", { points })}</Tag>;
  if (!unscored) return null;
  return (
    <Tag tone="warn">
      <span aria-hidden="true">{t("patient.trendsPointsUnknown")}</span>
      <span className="sr-only">{t("patient.trendsPointsUnknownSr")}</span>
    </Tag>
  );
}

function Reading({ series, channel, nowMs, named, badge, pill }) {
  const { t } = useI18n();
  const latest = channel?.latest ?? null;
  if (!latest) return null;
  const age = ageText(t, latest.ts, nowMs);
  return (
    <span className="mt-1 block" data-series={series.key}>
      {named ? <><span className="text-11 font-semibold text-mute">{t(series.labelKey)}</span>{" "}</> : null}
      <b className="font-data text-20 font-bold text-ink">{latest.value}</b>{" "}
      <small className="text-11 font-semibold text-mute">{t(series.unitKey)}</small>
      {/* No previous measurement is `null`; any other non-number is printed as nothing at all. */}
      {latest.delta === null ? (
        <>{" "}<span className="ml-1 font-data text-12 font-semibold text-ink">{t("patient.trendsSingle")}</span></>
      ) : <>{" "}<Delta delta={latest.delta} /></>}
      {age ? <>{" "}<span className="ml-1 text-11 text-mute">{age}</span></> : null}
      {badge ? <>{" "}{badge}</> : null}
      {pill ? <>{" "}{pill}</> : null}
    </span>
  );
}

export function TrendCard({ card, channels, nowMs, onOpen }) {
  const { t } = useI18n();
  const primary = channels?.[card.series[0].key] ?? null;
  const latest = primary?.latest ?? null;
  const points = latest?.news2_points ?? null;
  const tone = news2Tone(points);
  // A NEWS2 channel is one the engine sent bands for; "scored" is a number it sent, whatever it is.
  const scored = typeof points === "number" && Number.isFinite(points);
  const unscored = Boolean(latest) && Array.isArray(primary.bands?.news2) && !scored;
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
        <span data-title="" className={`block text-10.5 font-bold uppercase leading-[normal] tracking-[.06em] ${card.series[0].color}`}>{title}</span>
        {measured ? (
          card.series.map((s, i) => (
            <Reading key={s.key} series={s} channel={channels?.[s.key]} nowMs={nowMs} named={card.series.length > 1}
              badge={i === 0 && (tone || unscored) ? <Badge tone={tone} points={points} unscored={unscored} /> : null}
              pill={i === 0 && latest?.within_own_normal === true ? <Pill icon="user">{t("patient.trendsOwnNormalPill")}</Pill> : null} />
          ))
        ) : (
          <span className="mt-1 block text-12.5 text-mute">{t("patient.trendsNoData")}</span>
        )}
        {onOpen ? <>{" "}<span className="sr-only">{t("patient.trendsOpen", { channel: title })}</span></> : null}
      </Wrapper>
    </li>
  );
}
```

`npx vitest run src/live/screens/patient/trends/TrendCard.test.jsx 2>&1 | grep -E "Tests "` → `Tests  21 passed (21)`.

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
      expect([...list.children].map((li) => li.querySelector("[data-title]").textContent))
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

Run it: `npx vitest run src/live/screens/patient/PatientScreen.test.jsx 2>&1 | grep -E "Tests "` → `Tests  2 failed | 55 passed (57)` — the two new tests (the box holds no list yet). (b) and (c) pass now and keep passing once the cards render; without them three measured-values tests would fail then with `Found multiple elements with the text: Nəbz` / `Laktat` — measured while this plan was written.

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
// in a warn `Note` — the first line of the box's body, as the monitor strip says the same state —
// with the time that answer came. A `Note` is `role="note"`, not a live region, and not an alert:
// nothing the clinician did was refused, and a poll that fails once a minute must not interrupt.
//
// `nowMs` is REQUIRED: the patient screen's `useBoardNow` instant (the server's clock), which the
// cards age their values against. Without a finite one a card prints no age — never the browser's.
import React from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { hhmm } from "../../../i18n/dates.js";
import { Box, Note } from "../../../ui/index.js";
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
          <Note tone="warn" icon="alert" className="mb-2">
            {t("patient.trendsUnreadable", { time: trends.lastOkAt ? hhmm(trends.lastOkAt) : "—" })}
          </Note>
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
Expected: no `×`; `Test Files  11 passed (11)`, `Tests  155 passed (155)` — PatientScreen 57, TrendCard 21, news2Tone 2, useTrends 17. Then the suite — **84 / 2177** in plan order (the lane alone, `339c3f2`: 84 / 2174) — and the build.

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

**Done in the dashboard lane** (commits `6d8b777` and `4ecbc11`, the Task 11 quality review: a window that is not a window draws nothing, dots and marks keyed by position, no tints on a two-series mini chart — X26 — crisp 1-px lines, the magic numbers named, `valueScale`'s midline on a zero range, the `--pri` dashed edge held to 3:1); the blocks below are that code.

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
  bandRects, crisp, linePath, markerMarks, markerNear, nearestIndex, ownNormalRect, parseMarkers, parsePoints,
  plotFrame, timeScale, timeTicks, validWindow, valueDomain, valueScale, valueTicks,
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

  it("puts a range of no height on the plot's midline instead of dividing by it", () => {
    expect(valueScale({ lo: 5, hi: 5 }, 0, 20)(5)).toBe(10);
    expect(valueScale({ lo: 0, hi: Number.NaN }, 0, 20)(3)).toBe(10);
    expect(valueScale({ lo: 9, hi: 1 }, 0, 20)(3)).toBe(10);
  });

  it("places a time outside the window by the same scale — past the plot's edge, never clamped onto it", () => {
    const x = timeScale(0, 100, 10, 110);
    expect([x(-50), x(150)]).toEqual([-40, 160]);
  });

  it("calls a window drawable only when both ends are numbers and it does not run backwards", () => {
    expect(validWindow(0, 100)).toBe(true);
    expect(validWindow(5, 5)).toBe(true);
    expect(validWindow(100, 0)).toBe(false);
    expect(validWindow(Number.NaN, 100)).toBe(false);
    expect(validWindow(0, Number.NaN)).toBe(false);
    expect(validWindow(0, Infinity)).toBe(false);
    expect(validWindow(undefined, 100)).toBe(false);
  });

  it("snaps a 1-px line to the centre of the pixel row it falls in, so it is not smeared over two", () => {
    expect([crisp(9.92), crisp(19.05), crisp(10.5), crisp(10)]).toEqual([9.5, 19.5, 10.5, 10.5]);
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

  it("keeps a wide range to a handful of round labels inside it (systolic 60–220 spans 36–244)", () => {
    const domain = valueDomain([60, 220]);
    const ticks = valueTicks(domain);
    expect(domain).toEqual({ lo: 36, hi: 244 });
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks.length).toBeLessThanOrEqual(6);
    expect(ticks.every((v) => v >= domain.lo && v <= domain.hi && v % 10 === 0)).toBe(true);
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
  });

  it("labels no time at all — and does not hang — for a window that is not a window", () => {
    expect(timeTicks(Number.NaN, 5, 24)).toEqual([]);
    expect(timeTicks(0, Number.NaN, 24)).toEqual([]);
    expect(timeTicks(0, Infinity, 24)).toEqual([]);
    expect(timeTicks(undefined, undefined, 24)).toEqual([]);
    expect(timeTicks(10, 5, 24)).toEqual([]);                          // until before since
    expect(timeTicks(0, 5, Number.NaN)).toEqual([]);                   // nor a step it cannot work out
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

// The plot's margins, in pixels. The viewBox is the measured width, so a unit is a pixel.
const LABEL_PAD = 34;       // room for the value labels on the left, big chart only
const LABEL_RIGHT_PAD = 8;  // the big chart's right margin, so its last time label is not cut off
const EDGE_PAD = 2;         // the mini chart's side margins, so an edge dot is not cut off
const TOP_PAD = 6;
const BOTTOM_PAD = 6;
const AXIS_BASELINE = 4;    // the time labels' baseline above the chart's bottom edge
export const MARKER_LANE = 14;
export const AXIS_LANE = 16;
// The time-label step per window: hourly over 6 h, every 4 h over 24 h, every 12 h over 3 days.
const TICK_HOURS = { 6: 1, 24: 4, 72: 12 };
const NICE_STEPS = [1, 2, 2.5, 5];

/** The plot area of a `width` × `height` chart. The big chart has value labels on the left, a lane
 *  under the plot for the ▲/◆ marks, and one under that for the time labels. */
export function plotFrame(width, height, { labels = false, markers = false, axis = false } = {}) {
  const left = labels ? LABEL_PAD : EDGE_PAD;
  const right = Math.max(left + 1, width - (labels ? LABEL_RIGHT_PAD : EDGE_PAD));
  const top = TOP_PAD;
  const bottom = Math.max(top + 1, height - BOTTOM_PAD - (markers ? MARKER_LANE : 0) - (axis ? AXIS_LANE : 0));
  return { left, right, top, bottom, laneY: bottom + BOTTOM_PAD + MARKER_LANE / 2, axisY: height - AXIS_BASELINE };
}

/** Whether a window can be drawn: both ends are numbers and it does not run backwards. A window of no
 *  length is drawable (everything lands on its left edge); one with an end that is not a number is
 *  not — every x would be NaN, or, worse, every dot would pile up on the left edge. */
export function validWindow(sinceMs, untilMs) {
  return Number.isFinite(sinceMs) && Number.isFinite(untilMs) && untilMs >= sinceMs;
}

/** The centre of the pixel row (or column) a coordinate falls in. A 1-px line drawn on a whole number
 *  straddles two rows and renders as two blurred ones; drawn on the centre it is one crisp one. */
export const crisp = (v) => Math.floor(v) + 0.5;

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

/** The domain onto [bottom, top] (larger values higher). A range with no height — `valueDomain` never
 *  gives one, but a caller's own might — is drawn on the midline instead of dividing by zero. */
export function valueScale(domain, top, bottom) {
  const span = domain.hi - domain.lo;
  if (!(span > 0)) return () => (top + bottom) / 2;
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

/** The time labels: whole local hours on the window's step (the browser's zone is the ward's). None
 *  for a window that is not a window — `new Date(NaN).getHours()` is NaN, and the search below would
 *  never end. */
export function timeTicks(sinceMs, untilMs, hours) {
  if (!validWindow(sinceMs, untilMs)) return [];
  const step = TICK_HOURS[hours] ?? Math.max(1, Math.round(hours / 6));
  if (!Number.isFinite(step)) return [];
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

`npx vitest run src/live/screens/patient/trends/trendGeometry.test.js 2>&1 | grep -E "Tests "` → `Tests  22 passed (22)`. (The time labels follow the browser's zone, which on the ward PCs is the hospital's — `i18n/dates.js` says so; the test builds its instant in local time for the same reason.)

- [ ] **Step 3: The chart's test** — Write `dashboard/src/live/screens/patient/trends/TrendChart.test.jsx`:

```jsx
// What the chart draws, read off the SVG. jsdom has no layout, so the chart runs on its fallback
// width (320 small, 640 big) and every x below is worked out from `plotFrame` + `timeScale`.
import { afterEach, describe, it, expect, vi } from "vitest";
import React from "react";
import { act, fireEvent, render } from "@testing-library/react";
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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

  it("widens its range to take in the patient's normal, so a band just entered is always on the chart", () => {
    // 72 alone would span 68.4–75.6 and leave a normal of 100–115 off the chart. With it the range is
    // 72–115 ± 15 % = 65.55–121.45 on y 40 (bottom) to 6 (top): y(115) = 9.92, y(100) = 19.05.
    const svg = draw({ series: [hr([point(60, 72, 0)])], bands: { news2: null, own_normal: { low: 100, high: 115 } } });
    const own = svg.querySelector("[data-own-normal]");
    const rect = own.querySelector("rect");
    expect(Number(rect.getAttribute("y"))).toBeCloseTo(9.923, 2);
    expect(Number(rect.getAttribute("height"))).toBeCloseTo(9.123, 2);
    // The dashed edges are 1-px lines: each sits on the centre of the pixel row its edge falls in.
    expect(all(own, "line").map((l) => [l.getAttribute("y1"), l.getAttribute("y2")])).toEqual([["9.5", "9.5"], ["19.5", "19.5"]]);
  });

  it("snaps the big chart's grid lines onto the centre of a pixel row too", () => {
    const svg = draw({ series: [hr([point(120, 84, 0), point(60, 132, 3)])], big: true, height: 280 });
    const ys = all(svg, "[data-tick='value'] line").map((l) => Number(l.getAttribute("y1")));
    expect(ys.length).toBeGreaterThan(1);
    expect(ys.every((v) => v % 1 === 0.5)).toBe(true);
  });

  it("draws nothing for a window it cannot place — an end that is missing, or an end before the start", () => {
    const series = [hr([point(60, 84, 0), point(30, 90, 0)])];
    expect(draw({ series, sinceMs: Number.NaN })).toBeNull();
    expect(draw({ series, untilMs: undefined })).toBeNull();
    expect(draw({ series, sinceMs: NOW, untilMs: SINCE })).toBeNull();
    expect(draw({ series, sinceMs: Number.NaN, big: true, height: 280, label: "Nəbz" })).toBeNull();
  });

  it("places a measurement stamped after the window's end by the same scale, and drops a mark there", () => {
    const frame = plotFrame(640, 280, { labels: true, markers: true, axis: true });
    const x = timeScale(SINCE, NOW, frame.left, frame.right);
    const svg = draw({
      series: [hr([point(60, 84, 0), point(-30, 90, 0)])],            // the second is 30 minutes AFTER `until`
      markers: parseMarkers([marker(-30, "alarm")]), big: true, height: 280,
    });
    const [, late] = all(svg, "circle");
    expect(Number(late.getAttribute("cx"))).toBeCloseTo(x(NOW + 30 * 60_000));
    expect(Number(late.getAttribute("cx"))).toBeGreaterThan(frame.right);   // past the edge, never clamped onto it
    expect(all(svg, "[data-marker]")).toHaveLength(0);
  });

  it("draws two readings at one instant, and two alerts first seen on one reading, each under a key of its own", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const markers = parseMarkers([marker(60, "alarm", "news2"), marker(60, "alarm", "lactate"), marker(60, "antibiotic")]);
    const svg = draw({ series: [hr([point(60, 84, 0), point(60, 90, 1)])], markers, big: true, height: 280 });
    expect(all(svg, "circle").map((c) => c.dataset.value)).toEqual(["84", "90"]);
    expect(all(svg, "[data-marker]").map((m) => m.dataset.marker)).toEqual(["alarm", "alarm", "antibiotic"]);
    expect(error.mock.calls.flat().join(" ")).not.toMatch(/same key/);
  });
});

describe("the trend chart's width", () => {
  // jsdom has no layout: clientWidth is 0 and there is no ResizeObserver. Both are stood in for here.
  function measured(initial) {
    const state = { width: initial, notify: null, disconnect: vi.fn() };
    vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(() => state.width);
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback) { state.notify = callback; }
      observe() {}
      disconnect() { state.disconnect(); }
    });
    return state;
  }

  it("measures the box it sits in, so a unit is a pixel, follows it as it resizes and lets go on unmount", () => {
    const box = measured(480);
    const { container, unmount } = render(<TrendChart series={[hr([point(60, 84, 0)])]} sinceMs={SINCE} untilMs={NOW} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("viewBox", "0 0 480 46");
    const x480 = timeScale(SINCE, NOW, 2, 478);
    expect(Number(svg.querySelector("circle").getAttribute("cx"))).toBeCloseTo(x480(NOW - 60 * 60_000));
    box.width = 300;
    act(() => box.notify());
    expect(svg).toHaveAttribute("viewBox", "0 0 300 46");
    unmount();
    expect(box.disconnect).toHaveBeenCalled();
  });

  it("keeps its fallback width while the box has none (hidden, not laid out yet)", () => {
    measured(0);
    const { container } = render(<TrendChart series={[hr([point(60, 84, 0)])]} sinceMs={SINCE} untilMs={NOW} />);
    expect(container.querySelector("svg")).toHaveAttribute("viewBox", "0 0 320 46");
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
//
// A window that is not a window (an end that is not a number, an end before the start) draws NOTHING:
// there is nowhere to put a measurement, and a chart that piles every dot on its left edge would say
// something false. The card's text is the equivalent either way.
import React, { useLayoutEffect, useRef, useState } from "react";
import { ddmm, hhmm } from "../../../i18n/dates.js";
import {
  bandRects, crisp, linePath, markerMarks, nearestIndex, ownNormalRect, plotFrame, timeScale, timeTicks,
  validWindow, valueDomain, valueScale, valueTicks,
} from "./trendGeometry.js";

const BAND_FILL = { mid: "fill-band-mid", crit: "fill-band-crit" };
const drawable = (p) => Number.isFinite(p.ms) && Number.isFinite(p.value);

// How things are drawn, in pixels (the viewBox is the measured width, so a unit is a pixel). Sizes and
// dashes only: no clinical number, and no colour, lives here.
const DOT_RADIUS = { small: 2.5, big: 3.5 };
const LINE_WIDTH = 1.5;             // a series' connector, and the ring of a hollow dot
const HAIRLINE = 1;
const CONNECTOR_DASH = "4 3";       // between two measurements: an interval, never a measurement
const OWN_NORMAL_DASH = "2 3";      // the patient's normal's edges; finer, so the two never read alike
const VALUE_LABEL_GAP = 5;          // between a value label and the plot's left edge
const VALUE_LABEL_BASELINE = 3.5;   // a value label's baseline below the gridline it names
const ALARM_HALF_WIDTH = 6;         // ▲ is 12 px wide and 10 px high
const ALARM_HALF_HEIGHT = 5;
const DIAMOND_HALF = 4;             // ◆ is an 8-px square turned 45°
const CURSOR_RADIUS = 6;
const CURSOR_LINE_OPACITY = 0.5;

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
  if (!validWindow(sinceMs, untilMs)) return null;
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
            {[["top", ownRect.y], ["bottom", ownRect.y + ownRect.h]].map(([side, edge]) => (
              <line
                key={side} x1={ownRect.x} x2={ownRect.x + ownRect.w} y1={crisp(edge)} y2={crisp(edge)}
                className="stroke-pri" strokeDasharray={OWN_NORMAL_DASH}
              />
            ))}
          </g>
        ) : null}
        {big && y ? valueTicks(domain).map((v) => (
          <g key={`v${v}`} data-tick="value">
            <line x1={frame.left} x2={frame.right} y1={crisp(y(v))} y2={crisp(y(v))} className="stroke-grid" />
            <text x={frame.left - VALUE_LABEL_GAP} y={y(v) + VALUE_LABEL_BASELINE} textAnchor="end" className="fill-mute text-10">{v}</text>
          </g>
        )) : null}
        {y ? series.map((s) => {
          const path = linePath(s.points, x, y);
          return (
            <g key={s.key} data-series={s.key} className={s.color}>
              {path ? <path d={path} fill="none" stroke="currentColor" strokeWidth={LINE_WIDTH} strokeDasharray={CONNECTOR_DASH} /> : null}
              {s.points.filter(drawable).map((p, i) => (
                <circle
                  key={`${p.iso}#${i}`} data-ts={p.iso} data-value={p.value} cx={x(p.ms)} cy={y(p.value)}
                  r={big ? DOT_RADIUS.big : DOT_RADIUS.small}
                  fill={s.hollow ? undefined : "currentColor"} className={s.hollow ? "fill-card" : undefined}
                  stroke="currentColor" strokeWidth={s.hollow ? LINE_WIDTH : 0}
                />
              ))}
            </g>
          );
        }) : null}
        {marks.map((m, i) => {
          // Keyed by position as well: two alert kinds can first be seen on one reading.
          const key = `${m.kind}:${m.label}:${m.iso}:${i}`;
          return m.kind === "alarm" ? (
            <path
              key={key} data-marker="alarm" className="fill-crit"
              d={`M${m.x - ALARM_HALF_WIDTH},${frame.laneY + ALARM_HALF_HEIGHT}L${m.x},${frame.laneY - ALARM_HALF_HEIGHT}L${m.x + ALARM_HALF_WIDTH},${frame.laneY + ALARM_HALF_HEIGHT}Z`}
            />
          ) : (
            <rect
              key={key} data-marker={m.kind} x={m.x - DIAMOND_HALF} y={frame.laneY - DIAMOND_HALF}
              width={DIAMOND_HALF * 2} height={DIAMOND_HALF * 2} transform={`rotate(45 ${m.x} ${frame.laneY})`} className="fill-pri"
            />
          );
        })}
        {big ? timeTicks(sinceMs, untilMs, hours).map((ms) => (
          <text key={`t${ms}`} data-tick="time" x={x(ms)} y={frame.axisY} textAnchor="middle" className="fill-mute text-10">
            {hours === 72 ? `${ddmm(ms)} ${hhmm(ms)}` : hhmm(ms)}
          </text>
        )) : null}
        {at && y && drawable(at) ? (
          <g data-cursor="">
            <line x1={x(at.ms)} x2={x(at.ms)} y1={frame.top} y2={frame.bottom} className="stroke-ink" strokeWidth={HAIRLINE} opacity={CURSOR_LINE_OPACITY} />
            <circle cx={x(at.ms)} cy={y(at.value)} r={CURSOR_RADIUS} fill="none" className="stroke-ink" strokeWidth={LINE_WIDTH} />
          </g>
        ) : null}
      </svg>
    </span>
  );
}
```

`npx vitest run src/live/screens/patient/trends/TrendChart.test.jsx 2>&1 | grep -E "Tests "` → `Tests  19 passed (19)`.

- [ ] **Step 5: The card draws it — its test first.** Two Edits in `trends/TrendCard.test.jsx`.

(a) Replace:

```jsx
        <TrendCard card={card} channels={channelsOf(trends("S-001", channels))}
          nowMs={"nowMs" in clock ? clock.nowMs : NOW} onOpen={onOpen} />
```

with:

```jsx
        <TrendCard card={card} channels={channelsOf(trends("S-001", channels))}
          nowMs={"nowMs" in clock ? clock.nowMs : NOW}
          sinceMs={"sinceMs" in clock ? clock.sinceMs : NOW - 24 * 3_600_000}
          untilMs={"untilMs" in clock ? clock.untilMs : NOW} onOpen={onOpen} />
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

  it("draws no NEWS2 tint and no own-normal band behind the pressure card's two series (X26)", () => {
    // Measured: a calm patient's pressure card carried a permanent red stripe (systolic ≤ 90 scores 3)
    // behind MAP dots that NEWS2 never scores, and the mini chart is aria-hidden, so nothing explained
    // it. The frame and the badge already carry the points; the big chart keeps the tints and its legend.
    const own = { news2: BANDS.sbp, own_normal: { low: 100, high: 130 }, device: null };
    const card = show(PRESSURE, [
      channel("sbp", [point(90, 118, 0), point(30, 112, 0)], { bands: own }),
      channel("map", [point(90, 80), point(30, 76)]),
    ]);
    const svg = card.querySelector("svg");
    expect(svg.querySelectorAll("circle")).toHaveLength(4);
    expect(svg.querySelectorAll("[data-band]")).toHaveLength(0);
    expect(svg.querySelector("[data-own-normal]")).toBeNull();
  });

  it("keeps the tints and the own-normal band on a single-series card's mini chart", () => {
    const bands = { news2: BANDS.heart_rate, own_normal: { low: 95, high: 105 }, device: null };
    const card = show(HR, [channel("heart_rate", [point(90, 100, 1), point(30, 120, 2)], { bands })]);
    const svg = card.querySelector("svg");
    expect([...svg.querySelectorAll("[data-band]")].map((r) => r.dataset.band)).toEqual(["mid", "mid"]);   // 90–110 and 110–130
    expect(svg.querySelector("[data-own-normal]")).not.toBeNull();
  });

  it("draws no mini chart — and leaves no gap where it would be — when the answer's window cannot be read", () => {
    const card = show(HR, [channel("heart_rate", [point(60, 84, 0)])], { sinceMs: Number.NaN, untilMs: Number.NaN });
    expect(card.querySelector("svg")).toBeNull();
    expect(card.querySelector(".mt-1\\.5")).toBeNull();
    expect(card).toHaveTextContent("84");                              // the card still says what it was told
  });

  it("is a button naming the chart it opens only when it can open one", () => {
```

And the card's test reads the bands table — replace:

```jsx
import { channel, point, trends } from "./trends.testutil.js";
```

with:

```jsx
import { BANDS, channel, point, trends } from "./trends.testutil.js";
```

The own-normal band is edged with a dashed 1-px `--pri` line (the cue that does not rest on colour alone); half of it lies over the band, half outside, so `dashboard/src/live/theme/tokens.test.js` holds it to 3:1 over every tint it can cross, on every ground (the Task 11 quality review) — replace:

```js
  // The ▲ alarm and ◆ antibiotic marks sit in their own lane under the plot — on the card in the
```

with:

```js
  // The patient's own normal is edged with a dashed 1-px line in --pri — the cue that does not rest on
  // colour alone (TrendChart.jsx). Half of that line lies inside the band and half outside it, so it is
  // held to 3:1 over every tint it can cross: band-n, the NEWS2 row tints, and band-n stacked on them,
  // on every ground a chart is drawn on.
  it.each([...BANDS, ...STACKED].flatMap((b) => CHART_GROUNDS.map((g) => [b, g])))(
    "chart: the patient's-normal dashed edge (pri) clears 3:1 over the %s tint on %s",
    (stack, ground) => {
      expect(ratio(s("pri"), over(theme, stack.split(" + "), ground))).toBeGreaterThanOrEqual(UI);
    },
  );

  // The ▲ alarm and ◆ antibiotic marks sit in their own lane under the plot — on the card in the
```

Run it: `Tests  3 failed | 22 passed (25)` (no `svg` in the card yet: the mini chart, X26's pressure card and the single-series tints; the no-window test passes already).

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
// X26 (a sanctioned departure from the spec): a card with MORE THAN ONE series — the pressure card —
// draws NO NEWS2 tints and no own-normal band in its mini chart. Measured: a calm patient's pressure
// card carried a permanent red stripe (the systolic ≤ 90 row) behind MAP dots that NEWS2 never scores,
// and the mini chart is `aria-hidden`, so no legend could say why. The frame and the badge already
// carry the points; the big chart keeps the tints, with its legend. A single-series card keeps them.
//
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
import { parsePoints, validWindow } from "./trendGeometry.js";
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
          card.series.map((s, i) => (
            <Reading key={s.key} series={s} channel={channels?.[s.key]} nowMs={nowMs} named={card.series.length > 1}
              badge={i === 0 && (tone || unscored) ? <Badge tone={tone} points={points} unscored={unscored} /> : null}
              pill={i === 0 && latest?.within_own_normal === true ? <Pill icon="user">{t("patient.trendsOwnNormalPill")}</Pill> : null} />
          ))
        ) : (
```

with:

```jsx
        {measured ? (
          <>
            {card.series.map((s, i) => (
              <Reading key={s.key} series={s} channel={channels?.[s.key]} nowMs={nowMs} named={card.series.length > 1}
                badge={i === 0 && (tone || unscored) ? <Badge tone={tone} points={points} unscored={unscored} /> : null}
                pill={i === 0 && latest?.within_own_normal === true ? <Pill icon="user">{t("patient.trendsOwnNormalPill")}</Pill> : null} />
            ))}
            {validWindow(sinceMs, untilMs) ? (
              <span className="mt-1.5 block">
                <TrendChart
                  series={drawn} bands={card.series.length > 1 ? null : primary?.bands ?? null}
                  sinceMs={sinceMs} untilMs={untilMs} hours={24} height={46} />
              </span>
            ) : null}
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
Expected: no `×`; TrendCard 25, TrendChart 19, trendGeometry 22, PatientScreen 57. Then the suite — **86 / 2262** in plan order (the lane alone, `4ecbc11`: 86 / 2259) — and the build.

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

**Done in the dashboard lane** (commits `c235dfe` and `a877057`, the Task 12 quality review: an empty window says so, the dialog keeps its height while reading, a lone reading is labelled with its own value, the cursor follows an instant not an index, MAP read beside systolic — X27 — the card grid and the legend `role="list"`, `useMemo` over the answer); the blocks below are that code.

Spec §3.2 (graph view) and §7. A card is now a button; it opens `TrendModal` on the kit `Modal` (wide; focus in, Escape closes, focus back to the card). The dialog reads its own window through `useTrends` — 24 h on open, 6 h / 3 days on the `Seg` — and draws the big chart (280 px, value and time labels, ▲/◆ lane) with a readout above it: "HH:MM · value unit", the channel named on the two-series card, and every mark within one pixel column (`marksAtTime`, given the plot width the chart reports through `onPlot`). The readout is `aria-hidden`: a screen reader hears it only after a keyboard move (Task 13), never on a hover. `TrendLegend` names everything in words: the NEWS2 rows (with the source the SERVER sent, and the two tones' point totals), the patient's normal when charted, what a dot and a dashed line are, the two series of the pressure card, both marks, and "‹channel› seyrəldildi: N nöqtədən M" for a thinned channel (`trendsThinned` takes `{channel}` since the Task 8 review: the legend passes the series' own label).

**Files:**
- Create: `trends/TrendLegend.jsx`, `trends/TrendModal.jsx`, `trends/TrendModal.test.jsx`
- Modify: `trends/trendGeometry.js` (+ test), `trends/TrendChart.jsx`, `trends/TrendsBox.jsx` (Write, whole — the lane's box after Task 10, with its warn `Note`, plus this task's dialog), `PatientScreen.jsx`, `PatientScreen.test.jsx`, `src/live/i18n/strings/patient.js` (three keys)

- [ ] **Step 1: The geometry's answers — tests first.** The Task 11 quality review (2026-10-20) found what the big chart needs from its geometry: value labels at the NEAREST round step (rounding up gave systolic 60–220 only 100 and 200), no finer than the data is measured, never past the data (the 15 % margin labelled SpO₂ 105 and lactate −0.5), and a lone reading labelled with its own value; time labels that are not cut off at the chart's edge (72 h "dd.mm HH:MM", and at `--fs` 1.12); EVERY mark at an instant, not the first (two alert kinds first detected on one reading); and, from the Task 12 quality review, a cursor that follows an INSTANT, not an index (`indexAtTime`). `valueTicks` returns `{ step, ticks }`, so a caller computes the step once. Write `dashboard/src/live/screens/patient/trends/trendGeometry.test.js` (whole; the dashboard lane's commits `c235dfe` and `a877057`):

```js
// The trend charts' geometry, without React: every number below is worked out by hand in the
// comment beside it, so a change to the arithmetic shows up as a change to a number someone wrote.
import { describe, it, expect } from "vitest";
import {
  bandRects, crisp, indexAtTime, linePath, markerMarks, marksAtTime, nearestIndex, ownNormalRect, parseMarkers,
  parsePoints, plotFrame, tickLabel, timeLabelPlace, timeScale, timeTicks, validWindow, valueDomain, valueExtent,
  valueResolution, valueScale, valueTickStep, valueTicks,
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

  it("puts a range of no height on the plot's midline instead of dividing by it", () => {
    expect(valueScale({ lo: 5, hi: 5 }, 0, 20)(5)).toBe(10);
    expect(valueScale({ lo: 0, hi: Number.NaN }, 0, 20)(3)).toBe(10);
    expect(valueScale({ lo: 9, hi: 1 }, 0, 20)(3)).toBe(10);
  });

  it("places a time outside the window by the same scale — past the plot's edge, never clamped onto it", () => {
    const x = timeScale(0, 100, 10, 110);
    expect([x(-50), x(150)]).toEqual([-40, 160]);
  });

  it("calls a window drawable only when both ends are numbers and it does not run backwards", () => {
    expect(validWindow(0, 100)).toBe(true);
    expect(validWindow(5, 5)).toBe(true);
    expect(validWindow(100, 0)).toBe(false);
    expect(validWindow(Number.NaN, 100)).toBe(false);
    expect(validWindow(0, Number.NaN)).toBe(false);
    expect(validWindow(0, Infinity)).toBe(false);
    expect(validWindow(undefined, 100)).toBe(false);
  });

  it("snaps a 1-px line to the centre of the pixel row it falls in, so it is not smeared over two", () => {
    expect([crisp(9.92), crisp(19.05), crisp(10.5), crisp(10)]).toEqual([9.5, 19.5, 10.5, 10.5]);
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

  it("labels values at round steps inside the domain: 1, 2, 5 or 10 × 10ⁿ, the nearest (d3's rule)", () => {
    const ticksOf = (domain) => valueTicks(domain).ticks;
    expect(ticksOf({ lo: 0, hi: 100 })).toEqual([0, 20, 40, 60, 80, 100]);         // raw 25 → 20, not 25
    expect(ticksOf({ lo: 57, hi: 83 })).toEqual([60, 65, 70, 75, 80]);             // raw 6.5 → 5
    expect(ticksOf({ lo: 36.1, hi: 37.9 })).toEqual([36.5, 37, 37.5]);             // raw 0.45 → 0.5
    expect(valueTicks(null)).toEqual({ step: null, ticks: [] });
    expect(valueTicks({ lo: 5, hi: 5 }, 4, { extent: { lo: 5, hi: 5 } })).toEqual({ step: null, ticks: [] });   // a range of no height
    expect(valueTickStep({ lo: 0, hi: 0 })).toBeNull();
  });

  it("returns the step it labelled at with the labels, so a caller computes it once", () => {
    expect(valueTicks({ lo: 57, hi: 83 }).step).toBe(5);
    expect(valueTicks({ lo: 57, hi: 83 }).step).toBe(valueTickStep({ lo: 57, hi: 83 }));
  });

  it("labels systolic 60–220 every 50 — not only 100 and 200 — and only inside the data", () => {
    const domain = valueDomain([60, 220]);                                          // 36–244
    expect(valueTickStep(domain)).toBe(50);
    expect(valueTicks(domain).ticks).toEqual([50, 100, 150, 200]);
    expect(valueTicks(domain, 4, { extent: valueExtent([60, 220]) }).ticks).toEqual([100, 150, 200]);
  });

  it("never labels a value past the data: no SpO₂ 105, no lactate −0.5 in the chart's margin", () => {
    const spo2 = [92, 99, 100];
    expect(Math.max(...valueTicks(valueDomain(spo2), 4, { extent: valueExtent(spo2) }).ticks)).toBeLessThanOrEqual(100);
    const lactate = [0.5, 1, 4.1];
    expect(Math.min(...valueTicks(valueDomain(lactate), 4, { extent: valueExtent(lactate) }).ticks)).toBeGreaterThanOrEqual(0.5);
  });

  it("labels a single reading with its own value, written at the DATA's resolution — not at a step it fell between", () => {
    const label = (values) => {
      const { ticks, step } = valueTicks(valueDomain(values), 4, { extent: valueExtent(values), resolution: valueResolution(values) });
      return ticks.map((v) => tickLabel(v, step));
    };
    // The round steps (2, 0.5, 0.2) all fall to one side of the value: without this the chart has no number on it.
    expect(label([85])).toEqual(["85"]);
    expect(label([4.1])).toEqual(["4.1"]);
    expect(label([37.4])).toEqual(["37.4"]);
    expect(label([100])).toEqual(["100"]);                                          // SpO₂ 100: a step lands on it, and not past it
    expect(label([0])).toEqual(["0"]);                                              // lactate 0: the margin is −1…1, the label is 0
    expect(label([84, 84, 84])).toEqual(["84"]);                                    // repeated, still one value
  });

  it("labels both ends of an extent that no round step falls inside, written at the data's resolution", () => {
    // 80–90 asks for steps of 2 (raw 2.5); 82.6–83.4 holds no multiple of 2. (A range of two or more
    // measured values always holds a step: the margin makes the domain wider than the step.)
    const gap = valueTicks({ lo: 80, hi: 90 }, 4, { extent: { lo: 82.6, hi: 83.4 }, resolution: 0.1 });
    expect(gap.ticks).toEqual([82.6, 83.4]);
    expect(gap.step).toBe(0.1);
    // Where a step does fall inside, only the steps are labelled.
    expect(valueTicks({ lo: 80, hi: 90 }, 4, { extent: { lo: 81, hi: 87 }, resolution: 0.1 }).ticks).toEqual([82, 84, 86]);
  });

  it("labels no finer than the data is measured, with as many decimals as the step and no more", () => {
    const temps = [36.9, 37, 37.1];
    expect(valueResolution(temps)).toBeCloseTo(0.1);
    expect(valueResolution([84, 90])).toBe(1);
    const domain = valueDomain(temps);                                              // 36.87–37.13: raw 0.065
    expect(valueTickStep(domain)).toBeCloseTo(0.05);                                // what the range alone asks for
    expect(valueTickStep(domain, 4, valueResolution(temps))).toBeCloseTo(0.1);      // what a tenth-measured value allows
    expect(tickLabel(37, 0.1)).toBe("37.0");
    expect(tickLabel(36.5, 0.5)).toBe("36.5");
    expect(tickLabel(150, 50)).toBe("150");
  });

  it("keeps a wide range to a handful of round labels inside it (systolic 60–220 spans 36–244)", () => {
    const domain = valueDomain([60, 220]);
    const { ticks } = valueTicks(domain);
    expect(domain).toEqual({ lo: 36, hi: 244 });
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks.length).toBeLessThanOrEqual(6);
    expect(ticks.every((v) => v >= domain.lo && v <= domain.hi && v % 10 === 0)).toBe(true);
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
  });

  it("labels no time at all — and does not hang — for a window that is not a window", () => {
    expect(timeTicks(Number.NaN, 5, 24)).toEqual([]);
    expect(timeTicks(0, Number.NaN, 24)).toEqual([]);
    expect(timeTicks(0, Infinity, 24)).toEqual([]);
    expect(timeTicks(undefined, undefined, 24)).toEqual([]);
    expect(timeTicks(10, 5, 24)).toEqual([]);                          // until before since
    expect(timeTicks(0, 5, Number.NaN)).toEqual([]);                   // nor a step it cannot work out
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

  it("names EVERY mark within one pixel's worth of milliseconds of an instant, and never on a chart of no width", () => {
    // Two alert kinds first detected on one reading share an instant: the readout must name both.
    const marks = [{ ms: 1_000, kind: "alarm", label: "news2" }, { ms: 1_000, kind: "alarm", label: "sepsis" }];
    expect(marksAtTime(marks, 1_090, 100)).toEqual(marks);
    expect(marksAtTime(marks, 1_200, 100)).toEqual([]);
    expect(marksAtTime(marks, 1_000, 0)).toEqual([]);
  });

  it("finds a reading by its exact instant — the later one when two share it — and none when it slid out", () => {
    const points = [p(10, 1), p(20, 2), p(20, 3), p(30, Number.NaN)];
    expect(indexAtTime(points, 20)).toBe(2);
    expect(indexAtTime(points, 10)).toBe(0);
    expect(indexAtTime(points, 30)).toBe(3);                            // a missing value is still that instant
    expect(indexAtTime(points, 15)).toBe(-1);
    expect(indexAtTime([], 10)).toBe(-1);
    expect(indexAtTime(undefined, 10)).toBe(-1);
  });

  it("places a time label centred on its instant, unless that would run it past an edge", () => {
    expect(timeLabelPlace(300, "12:00", 640)).toEqual({ x: 300, anchor: "middle" });
    expect(timeLabelPlace(630, "12:00", 640)).toEqual({ x: 640, anchor: "end" });              // 5 × 6.5 / 2 = 16.25 px
    expect(timeLabelPlace(600, "20.10 12:00", 640)).toEqual({ x: 600, anchor: "middle" });     // 72 h: 11 × 6.5 / 2 = 35.75 px
    expect(timeLabelPlace(610, "20.10 12:00", 640)).toEqual({ x: 640, anchor: "end" });
    expect(timeLabelPlace(4, "12:00", 640)).toEqual({ x: 0, anchor: "start" });
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

Run it: `Tests  11 failed | 19 passed (30)` — `indexAtTime`, `marksAtTime`, `timeLabelPlace` … `is not a function`, and the step and label tests (Task 11 still rounds up and returns a bare array).

- [ ] **Step 2: The geometry** — Write `dashboard/src/live/screens/patient/trends/trendGeometry.js` (whole; Task 11's `markerNear`, read only by its test, gives way to `marksAtTime`, the one rule):

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

// The plot's margins, in pixels. The viewBox is the measured width, so a unit is a pixel.
const LABEL_PAD = 34;       // room for the value labels on the left, big chart only
const LABEL_RIGHT_PAD = 8;  // the big chart's right margin, so its last time label is not cut off
const EDGE_PAD = 2;         // the mini chart's side margins, so an edge dot is not cut off
const TOP_PAD = 6;
const BOTTOM_PAD = 6;
const AXIS_BASELINE = 4;    // the time labels' baseline above the chart's bottom edge
export const MARKER_LANE = 14;
export const AXIS_LANE = 16;
// The time-label step per window: hourly over 6 h, every 4 h over 24 h, every 12 h over 3 days.
const TICK_HOURS = { 6: 1, 24: 4, 72: 12 };
// A value label's step is 1, 2, 5 or 10 × 10ⁿ — the one NEAREST the raw step on a log scale, by d3's
// thresholds (√50, √10, √2). Rounding up to the next nice step instead could double it: systolic
// 60–220 then got only two labels, 100 and 200.
const STEP_E10 = Math.sqrt(50);
const STEP_E5 = Math.sqrt(10);
const STEP_E2 = Math.sqrt(2);
// A time label's width, estimated: 10-px digits at up to 1.12× (the --fs setting) are ≈ 6.5 px each.
const TIME_LABEL_CHAR_PX = 6.5;

/** The plot area of a `width` × `height` chart. The big chart has value labels on the left, a lane
 *  under the plot for the ▲/◆ marks, and one under that for the time labels. */
export function plotFrame(width, height, { labels = false, markers = false, axis = false } = {}) {
  const left = labels ? LABEL_PAD : EDGE_PAD;
  const right = Math.max(left + 1, width - (labels ? LABEL_RIGHT_PAD : EDGE_PAD));
  const top = TOP_PAD;
  const bottom = Math.max(top + 1, height - BOTTOM_PAD - (markers ? MARKER_LANE : 0) - (axis ? AXIS_LANE : 0));
  return { left, right, top, bottom, laneY: bottom + BOTTOM_PAD + MARKER_LANE / 2, axisY: height - AXIS_BASELINE };
}

/** Whether a window can be drawn: both ends are numbers and it does not run backwards. A window of no
 *  length is drawable (everything lands on its left edge); one with an end that is not a number is
 *  not — every x would be NaN, or, worse, every dot would pile up on the left edge. */
export function validWindow(sinceMs, untilMs) {
  return Number.isFinite(sinceMs) && Number.isFinite(untilMs) && untilMs >= sinceMs;
}

/** The centre of the pixel row (or column) a coordinate falls in. A 1-px line drawn on a whole number
 *  straddles two rows and renders as two blurred ones; drawn on the centre it is one crisp one. */
export const crisp = (v) => Math.floor(v) + 0.5;

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

/** The domain onto [bottom, top] (larger values higher). A range with no height — `valueDomain` never
 *  gives one, but a caller's own might — is drawn on the midline instead of dividing by zero. */
export function valueScale(domain, top, bottom) {
  const span = domain.hi - domain.lo;
  if (!(span > 0)) return () => (top + bottom) / 2;
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

/** The finite values' own range, `{ lo, hi }`, or null. */
export function valueExtent(values) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values ?? []) {
    if (Number.isFinite(v)) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return lo > hi ? null : { lo, hi };
}

/** The data's resolution: the coarsest power of ten every finite value is a multiple of (to three
 *  decimals) — 1 for a pulse, 0.1 for a temperature measured to a tenth. */
export function valueResolution(values) {
  let decimals = 0;
  for (const v of values ?? []) {
    if (!Number.isFinite(v)) continue;
    while (decimals < 3 && Math.abs(Number(v.toFixed(decimals)) - v) > 1e-9) decimals += 1;
  }
  return 10 ** -decimals;
}

/** The step of the value labels: about `count` of them over the domain, at 1, 2, 5 or 10 × 10ⁿ —
 *  the nearest (d3's rule) — and never finer than the data's own `resolution`: a temperature measured
 *  to 0.1 is not labelled to 0.05. Null for no domain, or one of no height. */
export function valueTickStep(domain, count = 4, resolution = 0) {
  if (!domain || !(domain.hi > domain.lo)) return null;
  const raw = (domain.hi - domain.lo) / count;
  const power = Math.floor(Math.log10(raw));
  const error = raw / 10 ** power;
  const factor = error >= STEP_E10 ? 10 : error >= STEP_E5 ? 5 : error >= STEP_E2 ? 2 : 1;
  return Math.max(factor * 10 ** power, resolution);
}

/** The value labels: `{ step, ticks }` — `ticks` the values to label, `step` what to write them at
 *  (`tickLabel(v, step)`), so the caller never works the step out a second time.
 *
 *  The ticks are round values at `valueTickStep`. With `extent` — the data's own range — only those
 *  inside it: the domain's margin is the chart's, not the patient's, and a label past the data names a
 *  value nobody measured (SpO₂ 105, lactate −0.5). Clamping to a "possible" range instead would be a
 *  range the browser holds; there is none here.
 *
 *  When no round value falls inside the extent — a lone reading between two steps — the extent's own
 *  value(s) are labelled instead (both ends when they differ), written at the DATA's `resolution`,
 *  so a chart with one measurement still has a number on it: "85", "4.1", "37.4". */
export function valueTicks(domain, count = 4, { extent = null, resolution = 0 } = {}) {
  const step = valueTickStep(domain, count, resolution);
  if (!step) return { step: null, ticks: [] };
  const lo = extent ? Math.max(domain.lo, extent.lo) : domain.lo;
  const hi = extent ? Math.min(domain.hi, extent.hi) : domain.hi;
  const ticks = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) ticks.push(Number(v.toFixed(6)));
  if (ticks.length > 0 || !extent) return { step, ticks };
  return { step: resolution > 0 ? resolution : step, ticks: extent.hi > extent.lo ? [extent.lo, extent.hi] : [extent.lo] };
}

/** A value label: as many decimals as its step has, and no more ("37.5", never "37.50"). */
export function tickLabel(v, step) {
  const decimals = step > 0 ? Math.min(3, Math.max(0, -Math.floor(Math.log10(step) + 1e-9))) : 0;
  return v.toFixed(decimals);
}

/** The time labels: whole local hours on the window's step (the browser's zone is the ward's). None
 *  for a window that is not a window — `new Date(NaN).getHours()` is NaN, and the search below would
 *  never end. */
export function timeTicks(sinceMs, untilMs, hours) {
  if (!validWindow(sinceMs, untilMs)) return [];
  const step = TICK_HOURS[hours] ?? Math.max(1, Math.round(hours / 6));
  if (!Number.isFinite(step)) return [];
  const at = new Date(sinceMs);
  at.setMinutes(0, 0, 0);
  while (at.getTime() < sinceMs || at.getHours() % step !== 0) at.setHours(at.getHours() + 1);
  const out = [];
  for (; at.getTime() <= untilMs; at.setHours(at.getHours() + step)) out.push(at.getTime());
  return out;
}

/** Where a time label goes on a chart `width` wide: centred on its instant, unless that runs it past
 *  an edge — then anchored to that edge, so "dd.mm HH:MM" at 72 h is never cut off. */
export function timeLabelPlace(x, text, width) {
  const half = (String(text).length * TIME_LABEL_CHAR_PX) / 2;
  if (x + half > width) return { x: width, anchor: "end" };
  if (x - half < 0) return { x: 0, anchor: "start" };
  return { x, anchor: "middle" };
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

/** EVERY mark within one pixel of an instant, in their order — two alert kinds can be first detected on
 *  one reading, and the readout must name both. The caller holds the instant (the dialog's cursor) and
 *  the chart's milliseconds per pixel. None on a chart of no width. */
export function marksAtTime(markers, ms, msPerPx) {
  if (!(msPerPx > 0) || !Number.isFinite(ms)) return [];
  return (markers ?? []).filter((m) => Math.abs(m.ms - ms) <= msPerPx);
}

/** The index of the reading stamped exactly `ms` — the later one when two share the instant, as
 *  `nearestIndex` picks on a tie — or -1. A reading is found by WHEN it was taken, not by its place in
 *  the list: a poll that slides the window moves every index. */
export function indexAtTime(points, ms) {
  const list = points ?? [];
  for (let i = list.length - 1; i >= 0; i -= 1) if (list[i].ms === ms) return i;
  return -1;
}
```

→ `Tests  30 passed (30)`.

- [ ] **Step 3: The chart — its plot width, its labels, its hollow dots, its width observer.** Write `dashboard/src/live/screens/patient/trends/TrendChart.test.jsx` (whole):

```jsx
// What the chart draws, read off the SVG. jsdom has no layout, so the chart runs on its fallback
// width (320 small, 640 big) and every x below is worked out from `plotFrame` + `timeScale`.
import { afterEach, describe, it, expect, vi } from "vitest";
import React from "react";
import { act, fireEvent, render } from "@testing-library/react";
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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

  it("widens its range to take in the patient's normal, so a band just entered is always on the chart", () => {
    // 72 alone would span 68.4–75.6 and leave a normal of 100–115 off the chart. With it the range is
    // 72–115 ± 15 % = 65.55–121.45 on y 40 (bottom) to 6 (top): y(115) = 9.92, y(100) = 19.05.
    const svg = draw({ series: [hr([point(60, 72, 0)])], bands: { news2: null, own_normal: { low: 100, high: 115 } } });
    const own = svg.querySelector("[data-own-normal]");
    const rect = own.querySelector("rect");
    expect(Number(rect.getAttribute("y"))).toBeCloseTo(9.923, 2);
    expect(Number(rect.getAttribute("height"))).toBeCloseTo(9.123, 2);
    // The dashed edges are 1-px lines: each sits on the centre of the pixel row its edge falls in.
    expect(all(own, "line").map((l) => [l.getAttribute("y1"), l.getAttribute("y2")])).toEqual([["9.5", "9.5"], ["19.5", "19.5"]]);
  });

  it("snaps the big chart's grid lines onto the centre of a pixel row too", () => {
    const svg = draw({ series: [hr([point(120, 84, 0), point(60, 132, 3)])], big: true, height: 280 });
    const ys = all(svg, "[data-tick='value'] line").map((l) => Number(l.getAttribute("y1")));
    expect(ys.length).toBeGreaterThan(1);
    expect(ys.every((v) => v % 1 === 0.5)).toBe(true);
  });

  it("draws nothing for a window it cannot place — an end that is missing, or an end before the start", () => {
    const series = [hr([point(60, 84, 0), point(30, 90, 0)])];
    expect(draw({ series, sinceMs: Number.NaN })).toBeNull();
    expect(draw({ series, untilMs: undefined })).toBeNull();
    expect(draw({ series, sinceMs: NOW, untilMs: SINCE })).toBeNull();
    expect(draw({ series, sinceMs: Number.NaN, big: true, height: 280, label: "Nəbz" })).toBeNull();
  });

  it("places a measurement stamped after the window's end by the same scale, and drops a mark there", () => {
    const frame = plotFrame(640, 280, { labels: true, markers: true, axis: true });
    const x = timeScale(SINCE, NOW, frame.left, frame.right);
    const svg = draw({
      series: [hr([point(60, 84, 0), point(-30, 90, 0)])],            // the second is 30 minutes AFTER `until`
      markers: parseMarkers([marker(-30, "alarm")]), big: true, height: 280,
    });
    const [, late] = all(svg, "circle");
    expect(Number(late.getAttribute("cx"))).toBeCloseTo(x(NOW + 30 * 60_000));
    expect(Number(late.getAttribute("cx"))).toBeGreaterThan(frame.right);   // past the edge, never clamped onto it
    expect(all(svg, "[data-marker]")).toHaveLength(0);
  });

  it("draws two readings at one instant, and two alerts first seen on one reading, each under a key of its own", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const markers = parseMarkers([marker(60, "alarm", "news2"), marker(60, "alarm", "lactate"), marker(60, "antibiotic")]);
    const svg = draw({ series: [hr([point(60, 84, 0), point(60, 90, 1)])], markers, big: true, height: 280 });
    expect(all(svg, "circle").map((c) => c.dataset.value)).toEqual(["84", "90"]);
    expect(all(svg, "[data-marker]").map((m) => m.dataset.marker)).toEqual(["alarm", "alarm", "antibiotic"]);
    expect(error.mock.calls.flat().join(" ")).not.toMatch(/same key/);
  });
});

describe("the trend chart's width", () => {
  // jsdom has no layout: clientWidth is 0 and there is no ResizeObserver. Both are stood in for here.
  function measured(initial) {
    const state = { width: initial, notify: null, disconnect: vi.fn() };
    vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(() => state.width);
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback) { state.notify = callback; }
      observe() {}
      disconnect() { state.disconnect(); }
    });
    return state;
  }

  it("measures the box it sits in, so a unit is a pixel, follows it as it resizes and lets go on unmount", () => {
    const box = measured(480);
    const { container, unmount } = render(<TrendChart series={[hr([point(60, 84, 0)])]} sinceMs={SINCE} untilMs={NOW} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("viewBox", "0 0 480 46");
    const x480 = timeScale(SINCE, NOW, 2, 478);
    expect(Number(svg.querySelector("circle").getAttribute("cx"))).toBeCloseTo(x480(NOW - 60 * 60_000));
    box.width = 300;
    act(() => box.notify());
    expect(svg).toHaveAttribute("viewBox", "0 0 300 46");
    unmount();
    expect(box.disconnect).toHaveBeenCalled();
  });

  it("attaches its observer when a window it could not draw becomes one, and lets go when it stops being one", () => {
    // An answer whose since / until cannot be read draws nothing, so there is no box to measure; the
    // valid answer after it must find one.
    const box = measured(480);
    const series = [hr([point(60, 84, 0)])];
    const { container, rerender } = render(<TrendChart series={series} sinceMs={Number.NaN} untilMs={Number.NaN} />);
    expect(container.querySelector("svg")).toBeNull();
    rerender(<TrendChart series={series} sinceMs={SINCE} untilMs={NOW} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("viewBox", "0 0 480 46");
    box.width = 300;
    act(() => box.notify());
    expect(svg).toHaveAttribute("viewBox", "0 0 300 46");
    rerender(<TrendChart series={series} sinceMs={Number.NaN} untilMs={Number.NaN} />);
    expect(box.disconnect).toHaveBeenCalled();
  });

  it("keeps its fallback width while the box has none (hidden, not laid out yet)", () => {
    measured(0);
    const { container } = render(<TrendChart series={[hr([point(60, 84, 0)])]} sinceMs={SINCE} untilMs={NOW} />);
    expect(container.querySelector("svg")).toHaveAttribute("viewBox", "0 0 320 46");
  });
});
```

Run it: `Tests  7 failed | 13 passed (20)` (the labels, the cursor, the crisp grid, the late reading, two readings and two marks at one instant, the width observer). Then Write `dashboard/src/live/screens/patient/trends/TrendChart.jsx` (whole). The `onPlot` effect runs before the early return a hook may never skip; `useWidth` re-attaches its observer when a window it could not draw becomes one; a hollow dot on the big chart is filled with the dialog's own ground (`bg-app`):

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
//
// A window that is not a window (an end that is not a number, an end before the start) draws NOTHING:
// there is nowhere to put a measurement, and a chart that piles every dot on its left edge would say
// something false. The card's text is the equivalent either way.
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ddmm, hhmm } from "../../../i18n/dates.js";
import {
  bandRects, crisp, linePath, markerMarks, nearestIndex, ownNormalRect, plotFrame, tickLabel, timeLabelPlace,
  timeScale, timeTicks, validWindow, valueDomain, valueExtent, valueResolution, valueScale, valueTicks,
} from "./trendGeometry.js";

const BAND_FILL = { mid: "fill-band-mid", crit: "fill-band-crit" };
const drawable = (p) => Number.isFinite(p.ms) && Number.isFinite(p.value);

// How things are drawn, in pixels (the viewBox is the measured width, so a unit is a pixel). Sizes and
// dashes only: no clinical number, and no colour, lives here.
const DOT_RADIUS = { small: 2.5, big: 3.5 };
const LINE_WIDTH = 1.5;             // a series' connector, and the ring of a hollow dot
const HAIRLINE = 1;
const CONNECTOR_DASH = "4 3";       // between two measurements: an interval, never a measurement
const OWN_NORMAL_DASH = "2 3";      // the patient's normal's edges; finer, so the two never read alike
const VALUE_LABEL_GAP = 5;          // between a value label and the plot's left edge
const VALUE_LABEL_BASELINE = 3.5;   // a value label's baseline below the gridline it names
const ALARM_HALF_WIDTH = 6;         // ▲ is 12 px wide and 10 px high
const ALARM_HALF_HEIGHT = 5;
const DIAMOND_HALF = 4;             // ◆ is an 8-px square turned 45°
const CURSOR_RADIUS = 6;
const CURSOR_LINE_OPACITY = 0.5;

/** The element's width in CSS pixels, followed as it changes; `fallback` where nothing can measure
 *  it (no ResizeObserver: jsdom, an old browser). The viewBox is that width, so one unit is one pixel
 *  and a dot stays round at any size.
 *
 *  `mounted` says whether the element exists at all: the chart renders nothing for a window it cannot
 *  place, so an answer whose `since` / `until` cannot be read leaves no box to measure, and a valid
 *  answer after it brings one. The effect therefore depends on it — run once on `[ref]`, it would
 *  find no element, return, and never attach the observer to the box that appears later. */
function useWidth(ref, fallback, mounted) {
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!mounted || !el || typeof ResizeObserver !== "function") return undefined;
    const measure = () => {
      if (el.clientWidth > 0) setWidth(Math.round(el.clientWidth));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, mounted]);
  return width;
}

export function TrendChart({
  series, bands = null, markers = [], sinceMs, untilMs, hours = 24, height = 46, big = false,
  label, cursor = null, onCursor, onPlot,
}) {
  const box = useRef(null);
  const placeable = validWindow(sinceMs, untilMs);
  const width = useWidth(box, big ? 640 : 320, placeable);
  const frame = plotFrame(width, height, { labels: big, markers: big, axis: big });
  const plotWidth = frame.right - frame.left;
  // The plot's width in pixels, for a caller that names a mark "within one pixel column" of a
  // cursor it moved itself (the dialog's keyboard). Before the early return: a hook runs on every render.
  useEffect(() => { onPlot?.(plotWidth); }, [onPlot, plotWidth]);
  if (!placeable) return null;
  const x = timeScale(sinceMs, untilMs, frame.left, frame.right);
  const own = bands?.own_normal ?? null;
  const values = series.flatMap((s) => s.points.map((p) => p.value));
  if (own) values.push(own.low, own.high);
  const domain = valueDomain(values);
  const y = domain ? valueScale(domain, frame.top, frame.bottom) : null;
  // The value labels: at the nearest round step, no finer than the data is measured, and only inside
  // the data — the domain's margin is the chart's, and a label there names a value nobody measured.
  // A lone reading between two steps is labelled with its own value.
  const { step: tickStep, ticks } = big && domain
    ? valueTicks(domain, 4, { extent: valueExtent(values), resolution: valueResolution(values) })
    : { step: null, ticks: [] };
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
            {[["top", ownRect.y], ["bottom", ownRect.y + ownRect.h]].map(([side, edge]) => (
              <line
                key={side} x1={ownRect.x} x2={ownRect.x + ownRect.w} y1={crisp(edge)} y2={crisp(edge)}
                className="stroke-pri" strokeDasharray={OWN_NORMAL_DASH}
              />
            ))}
          </g>
        ) : null}
        {big && y ? ticks.map((v) => (
          <g key={`v${v}`} data-tick="value">
            <line x1={frame.left} x2={frame.right} y1={crisp(y(v))} y2={crisp(y(v))} className="stroke-grid" />
            <text x={frame.left - VALUE_LABEL_GAP} y={y(v) + VALUE_LABEL_BASELINE} textAnchor="end" className="fill-mute text-10">{tickLabel(v, tickStep)}</text>
          </g>
        )) : null}
        {y ? series.map((s) => {
          const path = linePath(s.points, x, y);
          return (
            <g key={s.key} data-series={s.key} className={s.color}>
              {path ? <path d={path} fill="none" stroke="currentColor" strokeWidth={LINE_WIDTH} strokeDasharray={CONNECTOR_DASH} /> : null}
              {s.points.filter(drawable).map((p, i) => (
                // A hollow dot is filled with the chart's OWN ground: the card under the mini chart, the
                // dialog's app background under the big one.
                <circle
                  key={`${p.iso}#${i}`} data-ts={p.iso} data-value={p.value} cx={x(p.ms)} cy={y(p.value)}
                  r={big ? DOT_RADIUS.big : DOT_RADIUS.small}
                  fill={s.hollow ? undefined : "currentColor"} className={s.hollow ? (big ? "fill-app" : "fill-card") : undefined}
                  stroke="currentColor" strokeWidth={s.hollow ? LINE_WIDTH : 0}
                />
              ))}
            </g>
          );
        }) : null}
        {marks.map((m, i) => {
          // Keyed by position as well: two alert kinds can first be seen on one reading.
          const key = `${m.kind}:${m.label}:${m.iso}:${i}`;
          return m.kind === "alarm" ? (
            <path
              key={key} data-marker="alarm" className="fill-crit"
              d={`M${m.x - ALARM_HALF_WIDTH},${frame.laneY + ALARM_HALF_HEIGHT}L${m.x},${frame.laneY - ALARM_HALF_HEIGHT}L${m.x + ALARM_HALF_WIDTH},${frame.laneY + ALARM_HALF_HEIGHT}Z`}
            />
          ) : (
            <rect
              key={key} data-marker={m.kind} x={m.x - DIAMOND_HALF} y={frame.laneY - DIAMOND_HALF}
              width={DIAMOND_HALF * 2} height={DIAMOND_HALF * 2} transform={`rotate(45 ${m.x} ${frame.laneY})`} className="fill-pri"
            />
          );
        })}
        {big ? timeTicks(sinceMs, untilMs, hours).map((ms) => {
          const text = hours === 72 ? `${ddmm(ms)} ${hhmm(ms)}` : hhmm(ms);
          const place = timeLabelPlace(x(ms), text, width);   // anchored to an edge it would cross
          return (
            <text key={`t${ms}`} data-tick="time" x={place.x} y={frame.axisY} textAnchor={place.anchor} className="fill-mute text-10">
              {text}
            </text>
          );
        }) : null}
        {at && y && drawable(at) ? (
          <g data-cursor="">
            <line x1={x(at.ms)} x2={x(at.ms)} y1={frame.top} y2={frame.bottom} className="stroke-ink" strokeWidth={HAIRLINE} opacity={CURSOR_LINE_OPACITY} />
            <circle cx={x(at.ms)} cy={y(at.value)} r={CURSOR_RADIUS} fill="none" className="stroke-ink" strokeWidth={LINE_WIDTH} />
          </g>
        ) : null}
      </svg>
    </span>
  );
}
```

`npx vitest run src/live/screens/patient/trends/TrendChart.test.jsx src/live/screens/patient/trends/TrendCard.test.jsx 2>&1 | grep -E "Tests "` → `Tests  45 passed (45)`.

- [ ] **Step 4: The dialog's tests** — Write `dashboard/src/live/screens/patient/trends/TrendModal.test.jsx`:

```jsx
// The big chart: its window, its readout, its legend — read as the clinician reads them.
import { describe, it, expect, afterEach, vi } from "vitest";
import React, { useState } from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount } from "../../../session/mount.testutil.jsx";
import { profile, token } from "../../../session/testTokens.testutil.js";
import { NOW } from "../../../data/board.testutil.js";
import { ddmm, hhmm } from "../../../i18n/dates.js";
import { CARDS } from "./cards.js";
import { TrendModal } from "./TrendModal.jsx";
import { plotFrame, timeScale } from "./trendGeometry.js";
import { answering, channel, marker, point, trends } from "./trends.testutil.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const PATIENT = { patient_id: "S-001", display_name: "Ayşe Sentetik", measuredAt: {} };
const card = (id) => CARDS.find((c) => c.id === id);
const HR_ANSWER = answering((pid, hours) => trends(pid, [channel("heart_rate", [point(120, 84, 0), point(60, 132, 3)])],
  { hours, markers: [marker(60, "alarm", "news2")] }));
const down = () => Promise.reject(Object.assign(new Error("down"), { status: 503 }));
const HOUR = 3_600_000;

// The host stands in for the patient screen: a new measurement of the patient changes `measuredAt`,
// and the dialog re-reads the SAME window (useTrends' own rule).
let bump;
function Host({ id, bed }) {
  const [n, setN] = useState(0);
  bump = () => setN((v) => v + 1);
  return <TrendModal card={card(id)} patient={{ ...PATIENT, measuredAt: { heart_rate: `r${n}` } }} bed={bed} onClose={() => {}} />;
}
const reread = () => act(async () => { bump(); await settle(); });

async function open(id = "heart_rate", answer = HR_ANSWER, { bed = "REA-01 · 2" } = {}) {
  vi.setSystemTime(NOW);
  const mounted = await mount(<Host id={id} bed={bed} />, {
    access: token(), me: profile(), setup: (api) => api.patientTrends.mockImplementation(answer),
  });
  await act(async () => { await settle(); });
  return mounted;
}
const dialog = () => screen.getByRole("dialog");
const readout = () => dialog().querySelector("[data-readout]");
const legend = () => dialog().querySelector("[data-legend]");
const choose = (name) => act(async () => { fireEvent.click(within(dialog()).getByRole("button", { name })); await settle(); });
const xOf = (minutesAgo, hours = 24) => {
  const frame = plotFrame(640, 280, { labels: true, markers: true, axis: true });
  return timeScale(NOW - hours * HOUR, NOW, frame.left, frame.right)(NOW - minutesAgo * 60_000);
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

  it("is titled without a leading separator when the bed's label is missing", async () => {
    await open("heart_rate", HR_ANSWER, { bed: "" });
    expect(screen.getByRole("dialog", { name: "Ayşe Sentetik · Nəbz" })).toBeInTheDocument();
  });

  it("reads 24 hours on open, and each window it is switched to", async () => {
    const { api } = await open();
    await choose("6 saat");
    await choose("3 gün");
    expect(api.patientTrends.mock.calls).toEqual([["S-001", 24], ["S-001", 6], ["S-001", 72]]);
    expect(within(dialog()).getByRole("button", { name: "3 gün" })).toHaveAttribute("aria-pressed", "true");
  });

  it("names the chart for a reader: what it shows and how many points it draws", async () => {
    await open();
    expect(within(dialog()).getByRole("img")).toHaveAttribute("aria-label", "Nəbz: son 24 saat, çəkilən nöqtə 2");
  });
});

describe("the big chart while it reads", () => {
  it("keeps its height while a window is read — an empty frame with the loading line in it, no chart", async () => {
    // Without the frame the dialog shrinks, the window buttons jump, and a second click lands on the backdrop.
    let release;
    await open("heart_rate", (pid, hours) => (hours === 6
      ? new Promise((resolve) => { release = () => resolve(trends(pid, [channel("heart_rate", [point(30, 90, 0)])], { hours })); })
      : HR_ANSWER(pid, hours)));
    await choose("6 saat");
    const frame = dialog().querySelector("[data-chart-frame]");
    expect(frame).not.toBeNull();
    expect(frame).toHaveClass("h-[280px]");                              // the plot's own height
    expect(frame).toHaveTextContent("Vital qrafikləri oxunur…");
    expect(within(dialog()).queryByRole("img")).toBeNull();
    expect(within(dialog()).getByRole("button", { name: "6 saat" })).toHaveAttribute("aria-pressed", "true");
    await act(async () => { release(); await settle(); });
    expect(within(dialog()).getByRole("img")).toHaveAttribute("aria-label", "Nəbz: son 6 saat, çəkilən nöqtə 1");
    expect(dialog().querySelector("[data-chart-frame]")).toBeNull();
  });

  it("keeps the chart, and says since when, when a re-read of the same window fails", async () => {
    let fail = false;
    await open("heart_rate", (pid, hours) => (fail ? down() : HR_ANSWER(pid, hours)));
    fail = true;
    await reread();
    expect(dialog()).toHaveTextContent(`Vital qrafikləri oxuna bilmir (son: ${hhmm(NOW)})`);
    expect(within(dialog()).getByRole("img")).toHaveAttribute("aria-label", "Nəbz: son 24 saat, çəkilən nöqtə 2");
  });

  it("says it cannot read a window it never read — 'son: —' — and draws no chart, but keeps its height", async () => {
    await open("heart_rate", (pid, hours) => (hours === 6 ? down() : HR_ANSWER(pid, hours)));
    await choose("6 saat");
    expect(dialog()).toHaveTextContent("Vital qrafikləri oxuna bilmir (son: —)");
    expect(within(dialog()).queryByRole("img")).toBeNull();
    expect(dialog().querySelector("[data-chart-frame]")).toHaveClass("h-[280px]");
    expect(dialog()).not.toHaveTextContent("Vital qrafikləri oxunur…");
  });
});

describe("the big chart's readout", () => {
  it("reads out the measurement under the mouse — its time, value and unit, and a mark in the same pixel column", async () => {
    await open();
    const svg = within(dialog()).getByRole("img");
    expect(readout()).toHaveAttribute("aria-hidden", "true");
    expect(readout()).toHaveTextContent("Ölçməni oxumaq üçün qrafikin üzərinə gəlin");
    fireEvent.mouseMove(svg, { clientX: xOf(60) });
    expect(readout()).toHaveTextContent(`${hhmm(NOW - HOUR)} · 132 /dəq · siqnal: news2`);
    fireEvent.mouseMove(svg, { clientX: xOf(120) });
    expect(readout().textContent).toBe(`${hhmm(NOW - 2 * HOUR)} · 84 /dəq`);
    fireEvent.mouseLeave(svg);
    expect(readout()).toHaveTextContent("Ölçməni oxumaq üçün qrafikin üzərinə gəlin");
  });

  it("names every mark at the instant under the cursor — two kinds first detected on one reading", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate", [point(120, 84, 0), point(60, 132, 3)])],
      { hours, markers: [marker(60, "alarm", "news2"), marker(60, "alarm", "sepsis")] })));
    fireEvent.mouseMove(within(dialog()).getByRole("img"), { clientX: xOf(60) });
    expect(readout().textContent).toBe(`${hhmm(NOW - HOUR)} · 132 /dəq · siqnal: news2 · siqnal: sepsis`);
  });

  it("writes the date as well over three days, as the chart's own time labels do", async () => {
    await open();
    await choose("3 gün");
    fireEvent.mouseMove(within(dialog()).getByRole("img"), { clientX: xOf(60, 72) });
    expect(readout().textContent).toBe(`${ddmm(NOW - HOUR)} ${hhmm(NOW - HOUR)} · 132 /dəq · siqnal: news2`);
  });

  it("reads MAP beside the systolic at the same instant on the pressure card — the vasopressor target", async () => {
    await open("pressure", answering((pid, hours) => trends(pid, [
      channel("sbp", [point(120, 118, 0), point(60, 95, 2)]), channel("map", [point(120, 80), point(60, 64)])], { hours })));
    fireEvent.mouseMove(within(dialog()).getByRole("img"), { clientX: xOf(60) });
    expect(readout().textContent).toBe(`${hhmm(NOW - HOUR)} · Sistolik AT 95 · MAP 64 mmHg`);
    fireEvent.mouseMove(within(dialog()).getByRole("img"), { clientX: xOf(120) });
    expect(readout().textContent).toBe(`${hhmm(NOW - 2 * HOUR)} · Sistolik AT 118 · MAP 80 mmHg`);
  });

  it("says MAP was not measured at that instant instead of leaving it out", async () => {
    await open("pressure", answering((pid, hours) => trends(pid, [
      channel("sbp", [point(120, 118, 0), point(60, 95, 2)]), channel("map", [point(120, 80)])], { hours })));
    fireEvent.mouseMove(within(dialog()).getByRole("img"), { clientX: xOf(60) });
    expect(readout().textContent).toBe(`${hhmm(NOW - HOUR)} · Sistolik AT 95 · MAP — mmHg`);
  });

  it("stays on the instant it was reading when a re-read slides the window — not on the reading that took its index", async () => {
    let slid = false;
    const shift = 10 * 60_000;
    await open("heart_rate", answering((pid, hours) => (slid
      ? trends(pid, [channel("heart_rate", [point(120, 84, 0), point(60, 132, 3), point(10, 90, 0)])],
        { hours, since: new Date(NOW - 24 * HOUR + shift).toISOString(), until: new Date(NOW + shift).toISOString() })
      : trends(pid, [channel("heart_rate", [point(180, 70, 0), point(120, 84, 0), point(60, 132, 3)])], { hours }))));
    fireEvent.mouseMove(within(dialog()).getByRole("img"), { clientX: xOf(120) });
    expect(readout().textContent).toBe(`${hhmm(NOW - 2 * HOUR)} · 84 /dəq`);
    slid = true;                                    // the 70 slid out of the front: index 1 is now the 132
    await reread();
    expect(readout().textContent).toBe(`${hhmm(NOW - 2 * HOUR)} · 84 /dəq`);
    const frame = plotFrame(640, 280, { labels: true, markers: true, axis: true });
    const x = timeScale(NOW - 24 * HOUR + shift, NOW + shift, frame.left, frame.right);
    expect(Number(dialog().querySelector("[data-cursor] line").getAttribute("x1"))).toBeCloseTo(x(NOW - 2 * HOUR));
  });

  it("lets the cursor go when the reading it was on slid out of the window", async () => {
    let slid = false;
    await open("heart_rate", answering((pid, hours) => (slid
      ? trends(pid, [channel("heart_rate", [point(120, 84, 0), point(60, 132, 3)])], { hours })
      : trends(pid, [channel("heart_rate", [point(180, 70, 0), point(120, 84, 0), point(60, 132, 3)])], { hours }))));
    fireEvent.mouseMove(within(dialog()).getByRole("img"), { clientX: xOf(180) });
    expect(readout().textContent).toBe(`${hhmm(NOW - 3 * HOUR)} · 70 /dəq`);
    slid = true;
    await reread();
    expect(readout()).toHaveTextContent("Ölçməni oxumaq üçün qrafikin üzərinə gəlin");
    expect(dialog().querySelector("[data-cursor]")).toBeNull();
  });

  it("prints no value for a reading that arrives without one — never 'NaN'", async () => {
    let blank = false;
    await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate",
      [point(120, 84, 0), blank ? point(60, null) : point(60, 132, 3)])], { hours })));
    fireEvent.mouseMove(within(dialog()).getByRole("img"), { clientX: xOf(60) });
    expect(readout().textContent).toBe(`${hhmm(NOW - HOUR)} · 132 /dəq`);
    blank = true;
    await reread();
    expect(readout().textContent).toBe(`${hhmm(NOW - HOUR)} · —`);
    expect(readout().textContent).not.toMatch(/NaN/);
  });

  it("says so — and gives no prompt to hover — when the window holds no reading to read", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [], { hours })));
    expect(readout()).toBeNull();
    expect(dialog().querySelector("[data-no-data]")).toHaveTextContent("Bu kanal üçün ölçmə yoxdur");
    expect(dialog()).not.toHaveTextContent("Ölçməni oxumaq üçün");
    expect(within(dialog()).getByRole("img")).toHaveAttribute("aria-label", "Nəbz: son 24 saat, çəkilən nöqtə 0");
    expect(legend()).not.toBeNull();                                      // what the chart's marks mean still stands
  });

  it("counts a reading with no value as no reading", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate", [point(60, null), point(30, null)])], { hours })));
    expect(dialog().querySelector("[data-no-data]")).toHaveTextContent("Bu kanal üçün ölçmə yoxdur");
    expect(within(dialog()).getByRole("img")).toHaveAttribute("aria-label", "Nəbz: son 24 saat, çəkilən nöqtə 0");
  });
});

describe("the big chart's legend", () => {
  it("is a list, so a screen reader that drops a bare list-style still counts its items", async () => {
    await open();
    expect(legend()).toHaveAttribute("role", "list");
  });

  it("explains every mark in words: the server's NEWS2 source, both band tones, both marks, the dashed line", async () => {
    await open();
    expect(legend()).toHaveTextContent("NEWS2 zolağı (yetkin) · mənbə news2-rcp-2017");
    // ▲ is the finding's first detection for this patient, not every episode (O17).
    for (const words of ["1–2 bal", "3 bal", "siqnalın ilk aşkarlanması", "antibiotik", "nöqtələr ölçmədir; aralarındakı qırıq xətt ölçmə deyil"]) {
      expect(legend()).toHaveTextContent(words);
    }
    expect(legend()).not.toHaveTextContent("xəstənin norması");            // none charted
    expect(legend()).not.toHaveTextContent("işarələrin hamısı");           // the server read every mark
  });

  it("leaves out what does not apply: nothing thinned, and no 'MAP is not scored' line without a second series", async () => {
    await open();
    expect(legend()).not.toHaveTextContent("seyrəldildi");
    expect(legend()).not.toHaveTextContent("qiymətləndirilmir");
  });

  it("says a channel was thinned, and from how many", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate",
      [point(90, 84, 0), point(60, 90, 0), point(30, 96, 1)], { thinned: true, total_points: 2500 })], { hours })));
    expect(legend()).toHaveTextContent("Nəbz seyrəldildi: 2500 nöqtədən 3");
  });

  it("draws systolic and MAP as two series of one chart, named in the legend", async () => {
    await open("pressure", answering((pid, hours) => trends(pid, [
      channel("sbp", [point(60, 118, 0)]), channel("map", [point(60, 80)])], { hours })));
    const svg = within(dialog()).getByRole("img");
    expect(svg.querySelector("[data-series='sbp']")).not.toBeNull();
    // Hollow on the dialog's own ground (bg-app), not a card's: a card-coloured disc would show on it.
    expect(svg.querySelector("[data-series='map'] circle")).toHaveClass("fill-app");
    expect(legend().querySelector("circle.fill-app")).not.toBeNull();
    expect(legend()).toHaveTextContent(/Sistolik AT.*MAP/);
    // MAP is drawn over the systolic rows but is not a NEWS2 parameter: the legend says so in words.
    expect(legend()).toHaveTextContent("MAP NEWS2-də qiymətləndirilmir; zolaqlar Sistolik AT üçündür");
    expect(legend()).not.toHaveTextContent("seyrəldildi");
  });

  it("says when the server's read of the marks stopped at its limit", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate", [point(60, 84, 0)])],
      { hours, markers_truncated: true })));
    expect(legend()).toHaveTextContent("işarələrin hamısı oxunmadı: ən yeniləri çatışmaya bilər");
  });

  it("shows no NEWS2 band in the legend of a channel the engine scores none for", async () => {
    await open("lactate", answering((pid, hours) => trends(pid, [channel("lactate", [point(60, 4.1)])], { hours })));
    expect(legend()).not.toHaveTextContent("NEWS2");
  });
});

describe("the big chart's value labels", () => {
  it("label a lone reading with its own value, so the chart has a number on it", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate", [point(60, 85, 0)])], { hours })));
    const labels = [...within(dialog()).getByRole("img").querySelectorAll("[data-tick='value'] text")].map((t) => t.textContent);
    expect(labels).toEqual(["85"]);
  });

  it("write a lactate to the tenth, not to the step", async () => {
    await open("lactate", answering((pid, hours) => trends(pid, [channel("lactate", [point(60, 4.1)])], { hours })));
    const labels = [...within(dialog()).getByRole("img").querySelectorAll("[data-tick='value'] text")].map((t) => t.textContent);
    expect(labels).toEqual(["4.1"]);
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

And the card grid is a list a screen reader announces (the Task 12 quality review) — Edit `PatientScreen.test.jsx`, replace:

```jsx
        .toEqual(["Nəbz", "Tənəffüs", "SpO2", "Sistolik AT · MAP", "Bədən hərarəti", "Laktat"]);
    });
```

with:

```jsx
        .toEqual(["Nəbz", "Tənəffüs", "SpO2", "Sistolik AT · MAP", "Bədən hərarəti", "Laktat"]);
      // `list-none` drops the list for VoiceOver unless the role is written out.
      expect(list).toHaveAttribute("role", "list");
    });
```

Run both: `TrendModal.test.jsx` → `Error: Failed to resolve import "./TrendModal.jsx" …`; `PatientScreen.test.jsx` → `Tests  2 failed | 56 passed (58)` (the card is not a button yet; the card grid is not yet a `role="list"`).

- [ ] **Step 5: The legend.** First its three sentences Task 8 did not have (the Task 10 and Task 4 quality reviews, 2026-10-20): on the pressure card MAP is drawn over the systolic NEWS2 rows and is not a NEWS2 parameter (the ENGINE's `bands.news2: null`), so the legend says so (X24); ▲ is a finding's FIRST DETECTION for this patient — the engine's active alerts never clear a kind today, so a `first_seen` stamp is written once per patient and kind, not once per episode (O17) — and the legend says exactly that; and when the server's read of the marks stopped at its limit (`markers_truncated`, Task 4) the legend says the newest may be missing. Four Edits in `dashboard/src/live/i18n/strings/patient.js`. In `tr`, replace:

```js
    trendsLegendPoints: "noktalar ölçüm; aralarındaki kesikli çizgi ölçüm değil",
```

with:

```js
    trendsLegendPoints: "noktalar ölçüm; aralarındaki kesikli çizgi ölçüm değil",
    trendsLegendNoBand: "{channel} NEWS2'de puanlanmaz; bantlar {scored} içindir",
    trendsLegendAlarm: "alarmın ilk tespiti",
    trendsLegendMarksTruncated: "işaretlerin hepsi okunamadı: en yenileri eksik olabilir",
```

In `az`, replace:

```js
    trendsLegendPoints: "nöqtələr ölçmədir; aralarındakı qırıq xətt ölçmə deyil",
```

with:

```js
    trendsLegendPoints: "nöqtələr ölçmədir; aralarındakı qırıq xətt ölçmə deyil",
    trendsLegendNoBand: "{channel} NEWS2-də qiymətləndirilmir; zolaqlar {scored} üçündür",
    trendsLegendAlarm: "siqnalın ilk aşkarlanması",
    trendsLegendMarksTruncated: "işarələrin hamısı oxunmadı: ən yeniləri çatışmaya bilər",
```

In `ru`, replace:

```js
    trendsLegendPoints: "точки — измерения; пунктир между ними — не измерение",
```

with:

```js
    trendsLegendPoints: "точки — измерения; пунктир между ними — не измерение",
    trendsLegendNoBand: "{channel} не оценивается по NEWS2; полосы — для показателя «{scored}»",
    trendsLegendAlarm: "первое обнаружение тревоги",
    trendsLegendMarksTruncated: "прочитаны не все отметки: самых новых может не быть",
```

In `en`, replace:

```js
    trendsLegendPoints: "dots are measurements; the dashed line between them is not one",
```

with:

```js
    trendsLegendPoints: "dots are measurements; the dashed line between them is not one",
    trendsLegendNoBand: "{channel} is not scored by NEWS2; the bands belong to {scored}",
    trendsLegendAlarm: "an alarm's first detection",
    trendsLegendMarksTruncated: "not every mark could be read: the newest may be missing",
```

(`trendsMarkerAlarm` stays: the readout and the table print "siqnal: news2" beside the mark's own time.) Then Write `dashboard/src/live/screens/patient/trends/TrendLegend.jsx`:

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
        <circle cx="9" cy="5" r="3" fill={hollow ? undefined : "currentColor"} className={hollow ? "fill-app" : undefined}
          stroke="currentColor" strokeWidth={hollow ? 1.5 : 0} />
      ) : null}
    </svg>
  );
}

const Item = ({ children }) => <li className="flex items-center gap-1.5">{children}</li>;

export function TrendLegend({ card, channels, source, truncated = false }) {
  const { t } = useI18n();
  const primary = channels[card.series[0].key] ?? null;
  const thinned = card.series.filter((s) => channels[s.key]?.thinned);
  // A series drawn over another's NEWS2 bands (MAP on the pressure card) is not scored by NEWS2:
  // said in words, so nobody reads the systolic rows as MAP's thresholds. The ENGINE decides which
  // channel has bands (`bands.news2` null for MAP and lactate); this only notices the difference.
  const scored = Array.isArray(primary?.bands?.news2);
  const unbanded = scored ? card.series.slice(1).filter((s) => channels[s.key] && !Array.isArray(channels[s.key].bands?.news2)) : [];
  return (
    // role="list": a list with its bullets removed (`list-none`) stops being one for VoiceOver.
    <ul role="list" data-legend="" className="m-0 mt-2 flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0 text-11.5 text-mute">
      {scored ? (
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
      {/* ▲ is a finding's FIRST DETECTION for this patient (its `first_seen` stamp), not every
          alarm episode: the engine's active alerts never clear a kind today (O17). */}
      <Item><Glyph kind="alarm" /> {t("patient.trendsLegendAlarm")}</Item>
      <Item><Glyph kind="antibiotic" /> {t("patient.trendsMarkerAntibiotic")}</Item>
      {unbanded.map((s) => (
        <Item key={`unbanded-${s.key}`}>
          {t("patient.trendsLegendNoBand", { channel: t(s.labelKey), scored: t(card.series[0].labelKey) })}
        </Item>
      ))}
      {/* The server's own flag: its read of the marks stopped at its limit (api/trends.py). */}
      {truncated ? <Item>{t("patient.trendsLegendMarksTruncated")}</Item> : null}
      {thinned.map((s) => (
        <Item key={s.key}>
          {t("patient.trendsThinned", { channel: t(s.labelKey), kept: channels[s.key].points.length, total: channels[s.key].total_points })}
        </Item>
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
//
// THE CURSOR IS AN INSTANT, NOT AN INDEX. The state is `{ ms, how }`: the instant of the reading the
// cursor is on, and who moved it ("mouse" | "key"). It is turned into an index at render, by
// `indexAtTime` over the series as it is NOW — a poll that slides the window drops readings off the
// front and moves every index, and a cursor held as an index would silently jump to a later reading
// while the clinician reads. If the reading has slid out of the window the cursor is gone with it.
import React, { useMemo, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { ddmm, hhmm } from "../../../i18n/dates.js";
import { Modal, Seg } from "../../../ui/index.js";
import { nameOf } from "../../common/BoardState.jsx";
import { cardTitle, channelsOf } from "./cards.js";
import { TrendChart } from "./TrendChart.jsx";
import { TrendLegend } from "./TrendLegend.jsx";
import { indexAtTime, marksAtTime, parseMarkers, parsePoints } from "./trendGeometry.js";
import { measuredKeyOf, useTrends } from "./useTrends.js";

const WINDOWS = [
  { value: 6, key: "patient.trendsHours6" },
  { value: 24, key: "patient.trendsHours24" },
  { value: 72, key: "patient.trendsHours72" },
];

// The chart's height in pixels. While a window is being read the dialog holds an empty frame of the
// same height (`h-[280px]` — a literal, for Tailwind): without it the dialog shrinks, the window buttons
// jump, and a second click lands on the backdrop and closes the dialog.
const CHART_HEIGHT = 280;
const NO_VALUE = "—";

/** When, as the chart's own time labels write it: with the date over three days. */
export const whenText = (ms, hours) => (hours === 72 ? `${ddmm(ms)} ${hhmm(ms)}` : hhmm(ms));

/** What a mark says in the readout and the table: an alarm with the engine's kind, a dose by name. */
export function markText(t, mark) {
  return mark.kind === "alarm" ? `${t("patient.trendsMarkerAlarm")}: ${mark.label}` : t("patient.trendsMarkerAntibiotic");
}

/** "HH:MM · 132 /dəq", EVERY mark within a pixel after it — two alert kinds first detected on one
 *  reading are both named. A card with two series (pressure) names each and reads the other one at the
 *  SAME instant — "Sistolik AT 118 · MAP 80 mmHg", MAP being the vasopressor target — and says "—"
 *  where it has no reading then; the unit is written once when the series share it. A reading that
 *  arrived without a value prints "—", never "NaN". Everything printed is the engine's number. */
function readoutOf(t, card, series, at, marks, hours) {
  const named = card.series.length > 1;
  const shared = card.series.every((s) => s.unitKey === card.series[0].unitKey);
  const values = card.series.map((s, i) => {
    const points = series[i].points;
    const reading = i === 0 ? at : points[indexAtTime(points, at.ms)];
    return Number.isFinite(reading?.value) ? String(reading.value) : null;
  });
  const parts = card.series.map((s, i) => [
    named ? t(s.labelKey) : null,
    values[i] ?? NO_VALUE,
    !shared && values[i] !== null ? t(s.unitKey) : null,
  ].filter(Boolean).join(" "));
  const unit = shared && values.some((v) => v !== null) ? ` ${t(card.series[0].unitKey)}` : "";
  return [whenText(at.ms, hours), `${parts.join(" · ")}${unit}`, ...marks.map((m) => markText(t, m))].join(" · ");
}

export function TrendModal({ card, patient, bed, onClose }) {
  const { t } = useI18n();
  const [hours, setHours] = useState(24);
  const [cursor, setCursor] = useState(null);   // { ms, how: "mouse" | "key" } — an instant, see the header
  const [plotWidth, setPlotWidth] = useState(0);
  const trends = useTrends(patient.patient_id, hours, measuredKeyOf(patient.measuredAt));
  // Parsed once per answer, not on every render of a mouse move.
  const { channels, series, markers } = useMemo(() => {
    const byKey = channelsOf(trends.data);
    return {
      channels: byKey,
      series: card.series.map((s) => ({ key: s.key, color: s.color, hollow: s.hollow, points: parsePoints(byKey[s.key]?.points) })),
      markers: parseMarkers(trends.data?.markers),
    };
  }, [card, trends.data]);
  const primary = channels[card.series[0].key] ?? null;
  const sinceMs = Date.parse(trends.data?.since);
  const untilMs = Date.parse(trends.data?.until);
  const title = cardTitle(t, card);
  const index = cursor ? indexAtTime(series[0].points, cursor.ms) : -1;
  const at = index >= 0 ? series[0].points[index] : null;
  const marks = at ? marksAtTime(markers, at.ms, plotWidth > 0 ? (untilMs - sinceMs) / plotWidth : 0) : [];
  const readout = at ? readoutOf(t, card, series, at, marks, hours) : null;
  // The readings the chart draws — a reading that arrived without a value is not one.
  const count = series.reduce((n, s) => n + s.points.filter((p) => Number.isFinite(p.value)).length, 0);

  const choose = (value) => {
    setHours(value);
    setCursor(null);
  };
  // The chart reports an index into the series it drew; the dialog keeps the instant. Nothing changed
  // → the same state back, so a mouse move over one reading re-renders nothing.
  const moveCursor = (picked, how) => {
    const ms = picked === null ? null : series[0].points[picked]?.ms ?? null;
    setCursor((c) => {
      if (ms === null) return c === null ? c : null;
      return c !== null && c.ms === ms && c.how === how ? c : { ms, how };
    });
  };

  return (
    <Modal open wide title={[bed, nameOf(patient, t), title].filter(Boolean).join(" · ")} onClose={onClose}>
      <Seg label={t("patient.trendsHoursLabel")} value={hours} onChange={choose}
        options={WINDOWS.map((w) => ({ value: w.value, label: t(w.key) }))} />
      {trends.unreadable ? (
        <p className="m-0 mt-2 text-12 font-semibold text-att-ink">
          {t("patient.trendsUnreadable", { time: trends.lastOkAt ? hhmm(trends.lastOkAt) : "—" })}
        </p>
      ) : null}
      {trends.data ? (
        <>
          {count === 0 ? (
            <p data-no-data="" className="m-0 mt-3 min-h-[1.5em] text-13 text-mute">{t("patient.trendsNoData")}</p>
          ) : (
            <p data-readout="" aria-hidden="true" className="m-0 mt-3 min-h-[1.5em] font-data text-13 font-semibold text-ink">
              {readout ?? t("patient.trendsReadoutIdle")}
            </p>
          )}
          <TrendChart
            series={series} bands={primary?.bands ?? null} markers={markers} sinceMs={sinceMs} untilMs={untilMs}
            hours={hours} height={CHART_HEIGHT} big label={t("patient.trendsChartLabel", { channel: title, hours, count })}
            cursor={index >= 0 ? index : null} onPlot={setPlotWidth} onCursor={moveCursor}
          />
          <TrendLegend card={card} channels={channels} source={trends.data.bands_source} truncated={trends.data.markers_truncated === true} />
        </>
      ) : (
        <>
          <p aria-hidden="true" className="m-0 mt-3 min-h-[1.5em] font-data text-13" />
          <div data-chart-frame="" className="mt-3 flex h-[280px] items-center justify-center">
            {trends.loading ? <p className="m-0 text-12.5 text-mute">{t("patient.trendsLoading")}</p> : null}
          </div>
        </>
      )}
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
// in a warn `Note` — the first line of the box's body, as the monitor strip says the same state —
// with the time that answer came. A `Note` is `role="note"`, not a live region, and not an alert:
// nothing the clinician did was refused, and a poll that fails once a minute must not interrupt.
//
// `nowMs` is REQUIRED: the patient screen's `useBoardNow` instant (the server's clock), which the
// cards age their values against. Without a finite one a card prints no age — never the browser's.
import React, { useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { hhmm } from "../../../i18n/dates.js";
import { Box, Note } from "../../../ui/index.js";
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
          <Note tone="warn" icon="alert" className="mb-2">
            {t("patient.trendsUnreadable", { time: trends.lastOkAt ? hhmm(trends.lastOkAt) : "—" })}
          </Note>
        ) : null}
        {trends.loading ? <p className="m-0 text-12.5 text-mute">{t("patient.trendsLoading")}</p> : null}
        {trends.data ? (
          // role="list": a list with its bullets removed (`list-none`) stops being one for VoiceOver.
          <ul role="list" className="m-0 grid list-none grid-cols-1 gap-2 p-0 min-[861px]:grid-cols-2 min-[1200px]:grid-cols-3">
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
Expected: no `×`; TrendModal 26, trendGeometry 30, TrendChart 20, PatientScreen 58. Then the suite — **87 / 2298** in plan order (the lane alone, `a877057`: 87 / 2295) — and the build.

- [ ] **Step 9: Commit.**

```bash
cd /c/tmp/g2-vital
git add dashboard/src/live/screens/patient/trends/trendGeometry.js dashboard/src/live/screens/patient/trends/trendGeometry.test.js dashboard/src/live/screens/patient/trends/TrendChart.jsx dashboard/src/live/screens/patient/trends/TrendLegend.jsx dashboard/src/live/screens/patient/trends/TrendModal.jsx dashboard/src/live/screens/patient/trends/TrendModal.test.jsx dashboard/src/live/screens/patient/trends/TrendsBox.jsx dashboard/src/live/screens/patient/PatientScreen.jsx dashboard/src/live/screens/patient/PatientScreen.test.jsx dashboard/src/live/i18n/strings/patient.js
git status --short && git diff --cached --stat
git commit -m "feat(patient): the big chart — 6 h / 24 h / 3 days, a readout under the mouse, the legend in words" -m "A card opens TrendModal (kit Modal: focus in, Escape out, focus back). Each window is a read of its own. The readout says time, value, unit and EVERY mark within one pixel column (marksAtTime, from the plot width the chart reports) and is aria-hidden. The legend names the server's NEWS2 source, both tones' points, the charted normal, dots vs dashed intervals, both series of the pressure card and that MAP is not scored by NEWS2, ▲ as a first detection, ◆, a thinned channel's counts and a cut-short read of the marks. The chart's value labels sit at the nearest round step (d3's thresholds), no finer than the data is measured and never past the data; its time labels are anchored to an edge they would cross; MAP's hollow dots are filled with the dialog's own ground.

red: TrendModal import unresolved; trendGeometry 11 failed (the new geometry not there yet; the old step set); TrendChart 7 failed; PatientScreen 2 failed (the card was not a button; the grid not a list)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: The keyboard, the one announcement, and the table view

**Done in the dashboard lane** (commits `d5260a4`, `50589dd` and `372e781`, the Task 13 quality review — X28, X29, X30 — and its minors: the table fed the dialog's own parsed series and markers, valueless rows dropped, `indexAtTime` preferring the last drawable reading, stable row keys, the later reading first at one instant, an empty NEWS2 cell for a channel NEWS2 does not score and "—" with `trendsPointsUnknownRowSr` for a NEWS2 reading the engine sent none for, Alt/Ctrl/Meta left to the browser, the cursor cleared on the switch to the table); the blocks below are that code.

Spec §3.2 (keyboard cursor, Grafik | Tablo, the table) and §7. The big chart becomes one tab stop (`tabIndex=0`, `role="application"` with a localised `aria-roledescription` — X28 — its keys described by a visible hint through `aria-describedby`); ← → move the cursor one measurement, Home / End to the first and last, staying put at either end; the readout follows, and **only a keyboard move** is said, once, through `Announce` (a hover empties the region). The `Seg` "Qrafik | Cədvəl" swaps in `TrendTable`: the kit `Table` with a caption, a `th scope="row"` time per row, newest first, every reading the chart draws with **the engine's NEWS2 points for that reading** (the endpoint's third column, printed — "+3", "0", "—"), and each mark as a row of its own. `trendText.js` holds how the axis, the readout and the table word a time, a mark and a point total — a mark beside a reading with its OWN time when that reads differently. The keyboard steps over drawable readings only, and two readings at one instant are one stop (the cursor is an instant, after Task 12). The dialog opens with focus on the pressed window option, after the kit `Modal` has put it on the first control.

**Files:**
- Create: `trends/trendText.js`, `trends/trendText.test.js`, `trends/TrendTable.jsx`
- Modify (Write, whole): `trends/TrendModal.jsx`, `trends/TrendModal.test.jsx`, `trends/TrendChart.jsx`, `trends/TrendChart.test.jsx`, `trends/trendGeometry.js`, `trends/trendGeometry.test.js`, `trends/TrendLegend.jsx`
- Modify (Edit): `trends/TrendCard.test.jsx`, `src/live/i18n/strings/patient.js` (two keys)

- [ ] **Step 1: The tests.** Write `dashboard/src/live/screens/patient/trends/TrendModal.test.jsx` (whole; the dashboard lane's commits `d5260a4`, `50589dd` and `372e781`):

```jsx
// The big chart: its window, its readout, its legend — read as the clinician reads them.
import { describe, it, expect, afterEach, vi } from "vitest";
import React, { useState } from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount } from "../../../session/mount.testutil.jsx";
import { profile, token } from "../../../session/testTokens.testutil.js";
import { NOW } from "../../../data/board.testutil.js";
import { ddmm, hhmm } from "../../../i18n/dates.js";
import { CARDS } from "./cards.js";
import { TrendModal } from "./TrendModal.jsx";
import { plotFrame, timeScale } from "./trendGeometry.js";
import { answering, channel, marker, point, trends } from "./trends.testutil.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const PATIENT = { patient_id: "S-001", display_name: "Ayşe Sentetik", measuredAt: {} };
const card = (id) => CARDS.find((c) => c.id === id);
const HR_ANSWER = answering((pid, hours) => trends(pid, [channel("heart_rate", [point(120, 84, 0), point(60, 132, 3)])],
  { hours, markers: [marker(60, "alarm", "news2")] }));
const down = () => Promise.reject(Object.assign(new Error("down"), { status: 503 }));
const HOUR = 3_600_000;

// The host stands in for the patient screen: a new measurement of the patient changes `measuredAt`,
// and the dialog re-reads the SAME window (useTrends' own rule).
let bump;
function Host({ id, bed, onClose }) {
  const [n, setN] = useState(0);
  bump = () => setN((v) => v + 1);
  return <TrendModal card={card(id)} patient={{ ...PATIENT, measuredAt: { heart_rate: `r${n}` } }} bed={bed} onClose={onClose} />;
}
const reread = () => act(async () => { bump(); await settle(); });

async function open(id = "heart_rate", answer = HR_ANSWER, { bed = "REA-01 · 2", onClose = () => {} } = {}) {
  vi.setSystemTime(NOW);
  const mounted = await mount(<Host id={id} bed={bed} onClose={onClose} />, {
    access: token(), me: profile(), setup: (api) => api.patientTrends.mockImplementation(answer),
  });
  await act(async () => { await settle(); });
  return mounted;
}
const dialog = () => screen.getByRole("dialog");
// The big chart takes the arrow keys, so it is an application to a screen reader, not an image (an
// image keeps NVDA and JAWS in browse mode, where the keys never reach the page). With nothing to step
// over it takes no keys and is the image it looks like.
const chart = () => within(dialog()).getByRole("application");
const quietChart = () => within(dialog()).getByRole("img");
const readout = () => dialog().querySelector("[data-readout]");
const legend = () => dialog().querySelector("[data-legend]");
const choose = (name) => act(async () => { fireEvent.click(within(dialog()).getByRole("button", { name })); await settle(); });
const xOf = (minutesAgo, hours = 24) => {
  const frame = plotFrame(640, 280, { labels: true, markers: true, axis: true });
  return timeScale(NOW - hours * HOUR, NOW, frame.left, frame.right)(NOW - minutesAgo * 60_000);
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

  it("is titled without a leading separator when the bed's label is missing", async () => {
    await open("heart_rate", HR_ANSWER, { bed: "" });
    expect(screen.getByRole("dialog", { name: "Ayşe Sentetik · Nəbz" })).toBeInTheDocument();
  });

  it("reads 24 hours on open, and each window it is switched to", async () => {
    const { api } = await open();
    await choose("6 saat");
    await choose("3 gün");
    expect(api.patientTrends.mock.calls).toEqual([["S-001", 24], ["S-001", 6], ["S-001", 72]]);
    expect(within(dialog()).getByRole("button", { name: "3 gün" })).toHaveAttribute("aria-pressed", "true");
  });

  it("names the chart for a reader: what it shows and how many points it draws", async () => {
    await open();
    expect(chart()).toHaveAttribute("aria-label", "Nəbz: son 24 saat, çəkilən nöqtə 2");
  });

  it("is an application to a screen reader, not an image — an image keeps NVDA and JAWS in browse mode, where ← → never arrive — and says what it is", async () => {
    await open();
    expect(chart()).toHaveAttribute("role", "application");
    expect(chart()).toHaveAttribute("aria-roledescription", "qrafik");
    expect(chart()).toHaveAttribute("aria-label", "Nəbz: son 24 saat, çəkilən nöqtə 2");     // the name stays
    expect(within(dialog()).queryByRole("img")).toBeNull();
    expect(chart()).toHaveClass("rounded-ctl");                                           // the ring has a shape to follow
  });

  it("is a tab stop only while there is something to step over — no tabindex, no key hint, no keys described", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [], { hours })));
    expect(quietChart()).not.toHaveAttribute("tabindex");
    expect(quietChart()).not.toHaveAttribute("aria-describedby");
    expect(quietChart()).not.toHaveAttribute("aria-roledescription");
    expect(quietChart()).not.toHaveClass("rounded-ctl");                                  // no ring, no shape for it
    expect(dialog()).not.toHaveTextContent("← → əvvəlki / növbəti ölçmə");
  });

  it("is no tab stop on a pressure card with only MAP readings either — the cursor follows the first series, so there is no stop", async () => {
    await open("pressure", answering((pid, hours) => trends(pid, [channel("map", [point(60, 64)])], { hours })));
    expect(quietChart()).not.toHaveAttribute("tabindex");
    expect(quietChart()).not.toHaveAttribute("aria-describedby");
    expect(dialog()).not.toHaveTextContent("← → əvvəlki / növbəti ölçmə");
  });
});

describe("the big chart while it reads", () => {
  it("keeps its height while a window is read — an empty frame with the loading line in it, no chart", async () => {
    // Without the frame the dialog shrinks, the window buttons jump, and a second click lands on the backdrop.
    let release;
    await open("heart_rate", (pid, hours) => (hours === 6
      ? new Promise((resolve) => { release = () => resolve(trends(pid, [channel("heart_rate", [point(30, 90, 0)])], { hours })); })
      : HR_ANSWER(pid, hours)));
    await choose("6 saat");
    const frame = dialog().querySelector("[data-chart-frame]");
    expect(frame).not.toBeNull();
    expect(frame).toHaveClass("h-[280px]");                              // the plot's own height
    expect(frame).toHaveTextContent("Vital qrafikləri oxunur…");
    expect(within(dialog()).queryByRole("application")).toBeNull();
    expect(within(dialog()).queryByRole("img")).toBeNull();
    expect(within(dialog()).getByRole("button", { name: "6 saat" })).toHaveAttribute("aria-pressed", "true");
    await act(async () => { release(); await settle(); });
    expect(chart()).toHaveAttribute("aria-label", "Nəbz: son 6 saat, çəkilən nöqtə 1");
    expect(dialog().querySelector("[data-chart-frame]")).toBeNull();
  });

  it("keeps the chart, and says since when, when a re-read of the same window fails", async () => {
    let fail = false;
    await open("heart_rate", (pid, hours) => (fail ? down() : HR_ANSWER(pid, hours)));
    fail = true;
    await reread();
    expect(dialog()).toHaveTextContent(`Vital qrafikləri oxuna bilmir (son: ${hhmm(NOW)})`);
    expect(chart()).toHaveAttribute("aria-label", "Nəbz: son 24 saat, çəkilən nöqtə 2");
  });

  it("says it cannot read a window it never read — 'son: —' — and draws no chart, but keeps its height", async () => {
    await open("heart_rate", (pid, hours) => (hours === 6 ? down() : HR_ANSWER(pid, hours)));
    await choose("6 saat");
    expect(dialog()).toHaveTextContent("Vital qrafikləri oxuna bilmir (son: —)");
    expect(within(dialog()).queryByRole("application")).toBeNull();
    expect(within(dialog()).queryByRole("img")).toBeNull();
    expect(dialog().querySelector("[data-chart-frame]")).toHaveClass("h-[280px]");
    expect(dialog()).not.toHaveTextContent("Vital qrafikləri oxunur…");
  });
});

describe("the big chart's readout", () => {
  it("reads out the measurement under the mouse — its time, value and unit, and a mark in the same pixel column", async () => {
    await open();
    const svg = chart();
    expect(readout()).toHaveAttribute("aria-hidden", "true");
    expect(readout()).toHaveTextContent("Ölçməni oxumaq üçün qrafikin üzərinə gəlin");
    fireEvent.mouseMove(svg, { clientX: xOf(60) });
    expect(readout()).toHaveTextContent(`${hhmm(NOW - HOUR)} · 132 /dəq · siqnal: news2`);
    fireEvent.mouseMove(svg, { clientX: xOf(120) });
    expect(readout().textContent).toBe(`${hhmm(NOW - 2 * HOUR)} · 84 /dəq`);
    fireEvent.mouseLeave(svg);
    expect(readout()).toHaveTextContent("Ölçməni oxumaq üçün qrafikin üzərinə gəlin");
  });

  it("names every mark at the instant under the cursor — two kinds first detected on one reading", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate", [point(120, 84, 0), point(60, 132, 3)])],
      { hours, markers: [marker(60, "alarm", "news2"), marker(60, "alarm", "sepsis")] })));
    fireEvent.mouseMove(chart(), { clientX: xOf(60) });
    expect(readout().textContent).toBe(`${hhmm(NOW - HOUR)} · 132 /dəq · siqnal: news2 · siqnal: sepsis`);
  });

  it("writes the date as well over three days, as the chart's own time labels do", async () => {
    await open();
    await choose("3 gün");
    fireEvent.mouseMove(chart(), { clientX: xOf(60, 72) });
    expect(readout().textContent).toBe(`${ddmm(NOW - HOUR)} ${hhmm(NOW - HOUR)} · 132 /dəq · siqnal: news2`);
  });

  it("reads MAP beside the systolic at the same instant on the pressure card — the vasopressor target", async () => {
    await open("pressure", answering((pid, hours) => trends(pid, [
      channel("sbp", [point(120, 118, 0), point(60, 95, 2)]), channel("map", [point(120, 80), point(60, 64)])], { hours })));
    fireEvent.mouseMove(chart(), { clientX: xOf(60) });
    expect(readout().textContent).toBe(`${hhmm(NOW - HOUR)} · Sistolik AT 95 · MAP 64 mmHg`);
    fireEvent.mouseMove(chart(), { clientX: xOf(120) });
    expect(readout().textContent).toBe(`${hhmm(NOW - 2 * HOUR)} · Sistolik AT 118 · MAP 80 mmHg`);
  });

  it("says MAP was not measured at that instant instead of leaving it out", async () => {
    await open("pressure", answering((pid, hours) => trends(pid, [
      channel("sbp", [point(120, 118, 0), point(60, 95, 2)]), channel("map", [point(120, 80)])], { hours })));
    fireEvent.mouseMove(chart(), { clientX: xOf(60) });
    expect(readout().textContent).toBe(`${hhmm(NOW - HOUR)} · Sistolik AT 95 · MAP — mmHg`);
  });

  it("reads a MAP stamped seconds from the systolic beside it — the same pixel column — and takes the nearer one", async () => {
    // A 24-hour chart is about 150 s to a pixel: a MAP half a minute from the systolic is, on the
    // chart, the same moment, and "MAP —" beside a MAP the chart draws there would say it was not measured.
    await open("pressure", answering((pid, hours) => trends(pid, [
      channel("sbp", [point(120, 118, 0), point(60, 95, 2)]),
      channel("map", [point(119.8, 78), point(60.5, 70), point(59.8, 64)])], { hours })));
    fireEvent.mouseMove(chart(), { clientX: xOf(60) });
    expect(readout().textContent).toBe(`${hhmm(NOW - HOUR)} · Sistolik AT 95 · MAP 64 mmHg`);
    fireEvent.mouseMove(chart(), { clientX: xOf(120) });
    expect(readout().textContent).toBe(`${hhmm(NOW - 2 * HOUR)} · Sistolik AT 118 · MAP 78 mmHg`);
  });

  it("gives a MAP read beside the systolic its own time when that reads differently — it does not borrow the systolic's", async () => {
    // 75 s before the systolic: inside the chart's pixel column (so it is read beside it), but another minute.
    await open("pressure", answering((pid, hours) => trends(pid, [
      channel("sbp", [point(120, 118, 0), point(60, 95, 2)]), channel("map", [point(120, 80), point(61.25, 70)])], { hours })));
    fireEvent.mouseMove(chart(), { clientX: xOf(60) });
    expect(readout().textContent).toBe(`${hhmm(NOW - HOUR)} · Sistolik AT 95 mmHg · MAP 70 mmHg (${hhmm(NOW - 61.25 * 60_000)})`);
    fireEvent.mouseMove(chart(), { clientX: xOf(120) });                        // the same minute: no time of its own
    expect(readout().textContent).toBe(`${hhmm(NOW - 2 * HOUR)} · Sistolik AT 118 · MAP 80 mmHg`);
  });

  it("stays on the instant it was reading when a re-read slides the window — not on the reading that took its index", async () => {
    let slid = false;
    const shift = 10 * 60_000;
    await open("heart_rate", answering((pid, hours) => (slid
      ? trends(pid, [channel("heart_rate", [point(120, 84, 0), point(60, 132, 3), point(10, 90, 0)])],
        { hours, since: new Date(NOW - 24 * HOUR + shift).toISOString(), until: new Date(NOW + shift).toISOString() })
      : trends(pid, [channel("heart_rate", [point(180, 70, 0), point(120, 84, 0), point(60, 132, 3)])], { hours }))));
    fireEvent.mouseMove(chart(), { clientX: xOf(120) });
    expect(readout().textContent).toBe(`${hhmm(NOW - 2 * HOUR)} · 84 /dəq`);
    slid = true;                                    // the 70 slid out of the front: index 1 is now the 132
    await reread();
    expect(readout().textContent).toBe(`${hhmm(NOW - 2 * HOUR)} · 84 /dəq`);
    const frame = plotFrame(640, 280, { labels: true, markers: true, axis: true });
    const x = timeScale(NOW - 24 * HOUR + shift, NOW + shift, frame.left, frame.right);
    expect(Number(dialog().querySelector("[data-cursor] line").getAttribute("x1"))).toBeCloseTo(x(NOW - 2 * HOUR));
  });

  it("lets the cursor go when the reading it was on slid out of the window", async () => {
    let slid = false;
    await open("heart_rate", answering((pid, hours) => (slid
      ? trends(pid, [channel("heart_rate", [point(120, 84, 0), point(60, 132, 3)])], { hours })
      : trends(pid, [channel("heart_rate", [point(180, 70, 0), point(120, 84, 0), point(60, 132, 3)])], { hours }))));
    fireEvent.mouseMove(chart(), { clientX: xOf(180) });
    expect(readout().textContent).toBe(`${hhmm(NOW - 3 * HOUR)} · 70 /dəq`);
    slid = true;
    await reread();
    expect(readout()).toHaveTextContent("Ölçməni oxumaq üçün qrafikin üzərinə gəlin");
    expect(dialog().querySelector("[data-cursor]")).toBeNull();
  });

  it("prints no value for a reading that arrives without one — never 'NaN'", async () => {
    let blank = false;
    await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate",
      [point(120, 84, 0), blank ? point(60, null) : point(60, 132, 3)])], { hours })));
    fireEvent.mouseMove(chart(), { clientX: xOf(60) });
    expect(readout().textContent).toBe(`${hhmm(NOW - HOUR)} · 132 /dəq`);
    blank = true;
    await reread();
    expect(readout().textContent).toBe(`${hhmm(NOW - HOUR)} · —`);
    expect(readout().textContent).not.toMatch(/NaN/);
  });

  it("says so — and gives no prompt to hover — when the window holds no reading to read", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [], { hours })));
    expect(readout()).toBeNull();
    expect(dialog().querySelector("[data-no-data]")).toHaveTextContent("Bu kanal üçün ölçmə yoxdur");
    expect(dialog()).not.toHaveTextContent("Ölçməni oxumaq üçün");
    expect(quietChart()).toHaveAttribute("aria-label", "Nəbz: son 24 saat, çəkilən nöqtə 0");
    expect(legend()).not.toBeNull();                                      // what the chart's marks mean still stands
  });

  it("counts a reading with no value as no reading", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate", [point(60, null), point(30, null)])], { hours })));
    expect(dialog().querySelector("[data-no-data]")).toHaveTextContent("Bu kanal üçün ölçmə yoxdur");
    expect(quietChart()).toHaveAttribute("aria-label", "Nəbz: son 24 saat, çəkilən nöqtə 0");
  });
});

describe("the big chart's legend", () => {
  it("is a list, so a screen reader that drops a bare list-style still counts its items", async () => {
    await open();
    expect(legend()).toHaveAttribute("role", "list");
  });

  it("explains every mark in words: the server's NEWS2 source, both band tones, both marks, the dashed line", async () => {
    await open();
    expect(legend()).toHaveTextContent("NEWS2 zolağı (yetkin) · mənbə news2-rcp-2017");
    // ▲ is the finding's first detection for this patient, not every episode (O17).
    for (const words of ["1–2 bal", "3 bal", "siqnalın ilk aşkarlanması", "antibiotik", "nöqtələr ölçmədir; aralarındakı qırıq xətt ölçmə deyil"]) {
      expect(legend()).toHaveTextContent(words);
    }
    expect(legend()).not.toHaveTextContent("xəstənin norması");            // none charted
    expect(legend()).not.toHaveTextContent("işarələrin hamısı");           // the server read every mark
  });

  it("leaves out what does not apply: nothing thinned, and no 'MAP is not scored' line without a second series", async () => {
    await open();
    expect(legend()).not.toHaveTextContent("seyrəldildi");
    expect(legend()).not.toHaveTextContent("qiymətləndirilmir");
  });

  it("says a channel was thinned, and from how many", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate",
      [point(90, 84, 0), point(60, 90, 0), point(30, 96, 1)], { thinned: true, total_points: 2500 })], { hours })));
    expect(legend()).toHaveTextContent("Nəbz seyrəldildi: 2500 nöqtədən 3");
  });

  it("draws systolic and MAP as two series of one chart, named in the legend", async () => {
    await open("pressure", answering((pid, hours) => trends(pid, [
      channel("sbp", [point(60, 118, 0)]), channel("map", [point(60, 80)])], { hours })));
    const svg = chart();
    expect(svg.querySelector("[data-series='sbp']")).not.toBeNull();
    // Hollow on the dialog's own ground (bg-app), not a card's: a card-coloured disc would show on it.
    expect(svg.querySelector("[data-series='map'] circle")).toHaveClass("fill-app");
    expect(legend().querySelector("circle.fill-app")).not.toBeNull();
    expect(legend()).toHaveTextContent(/Sistolik AT.*MAP/);
    // MAP is drawn over the systolic rows but is not a NEWS2 parameter: the legend says so in words.
    expect(legend()).toHaveTextContent("MAP NEWS2-də qiymətləndirilmir; zolaqlar Sistolik AT üçündür");
    expect(legend()).not.toHaveTextContent("seyrəldildi");
  });

  it("says when the server's read of the marks stopped at its limit", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate", [point(60, 84, 0)])],
      { hours, markers_truncated: true })));
    expect(legend()).toHaveTextContent("işarələrin hamısı oxunmadı: ən yeniləri çatışmaya bilər");
  });

  it("shows no NEWS2 band in the legend of a channel the engine scores none for", async () => {
    await open("lactate", answering((pid, hours) => trends(pid, [channel("lactate", [point(60, 4.1)])], { hours })));
    expect(legend()).not.toHaveTextContent("NEWS2");
  });
});

describe("the big chart's value labels", () => {
  it("label a lone reading with its own value, so the chart has a number on it", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate", [point(60, 85, 0)])], { hours })));
    const labels = [...chart().querySelectorAll("[data-tick='value'] text")].map((t) => t.textContent);
    expect(labels).toEqual(["85"]);
  });

  it("write a lactate to the tenth, not to the step", async () => {
    await open("lactate", answering((pid, hours) => trends(pid, [channel("lactate", [point(60, 4.1)])], { hours })));
    const labels = [...chart().querySelectorAll("[data-tick='value'] text")].map((t) => t.textContent);
    expect(labels).toEqual(["4.1"]);
  });
});

describe("the big chart by keyboard", () => {
  const THREE = answering((pid, hours) => trends(pid, [channel("heart_rate",
    [point(180, 80, 0), point(120, 84, 0), point(60, 132, 3)])], { hours }));
  const wait = (ms) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

  it("is one tab stop, its keys described in words", async () => {
    await open("heart_rate", THREE);
    const svg = chart();
    expect(svg).toHaveAttribute("tabindex", "0");
    expect(document.getElementById(svg.getAttribute("aria-describedby")))
      .toHaveTextContent("Qrafik seçiləndə ← → əvvəlki / növbəti ölçmə, Home/End ilk / son ölçmə.");
  });

  it("walks the measurements with ← → Home End, and the readout follows", async () => {
    await open("heart_rate", THREE);
    const svg = chart();
    svg.focus();                                                        // keys go to the focused chart, as for a user
    expect(document.activeElement).toBe(svg);
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
    const svg = chart();
    svg.focus();
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

  it("says nothing for a chart nobody can see: switching to the table lets the cursor go, and the announcement with it", async () => {
    await open("heart_rate", THREE);
    const region = within(dialog()).getByRole("status");
    chart().focus();
    fireEvent.keyDown(chart(), { key: "End" });
    await wait(200);
    expect(region).toHaveTextContent(`${hhmm(NOW - 3_600_000)} · 132 /dəq`);
    await act(async () => { fireEvent.click(within(dialog()).getByRole("button", { name: "Cədvəl" })); await settle(); });
    expect(region.textContent).toBe("");                                // emptied at once, not said again
    await act(async () => { fireEvent.click(within(dialog()).getByRole("button", { name: "Qrafik" })); await settle(); });
    await wait(200);
    expect(region.textContent).toBe("");                                // back on the chart: no cursor, nothing to say
    expect(chart().querySelector("[data-cursor]")).toBeNull();
    expect(readout()).toHaveTextContent("Ölçməni oxumaq üçün qrafikin üzərinə gəlin");
  });

  it("closes on Escape pressed on the focused chart — the keys it takes do not swallow that one", async () => {
    const onClose = vi.fn();
    await open("heart_rate", THREE, { onClose });
    chart().focus();
    fireEvent.keyDown(chart(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("leaves a key pressed with Alt, Ctrl or Meta to the browser — Alt+← is Back, Ctrl+Home is the top of the page", async () => {
    await open("heart_rate", THREE);
    const svg = chart();
    svg.focus();
    for (const modifier of ["altKey", "ctrlKey", "metaKey"]) {
      for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) {
        // fireEvent returns false when the handler called preventDefault.
        expect(fireEvent.keyDown(svg, { key, [modifier]: true }), `${modifier} ${key}`).toBe(true);
      }
    }
    expect(svg.querySelector("[data-cursor]")).toBeNull();
    expect(readout()).toHaveTextContent("Ölçməni oxumaq üçün qrafikin üzərinə gəlin");
    expect(fireEvent.keyDown(svg, { key: "End" })).toBe(false);          // the plain key is the chart's
  });
});

describe("the big chart as a table", () => {
  const MIXED = answering((pid, hours) => trends(pid, [channel("heart_rate",
    [point(180, 80, 0), point(120, 72, 3), point(60, 132, 3)])], { hours, markers: [marker(90, "antibiotic")] }));
  const toTable = () => act(async () => { fireEvent.click(within(dialog()).getByRole("button", { name: "Cədvəl" })); await settle(); });
  const table = async (title = "Nəbz") => {
    await toTable();
    return within(dialog()).getByRole("table", { name: `${title} — ölçmələr, ən yenisi yuxarıda` });
  };
  const PRESSURE = answering((pid, hours) => trends(pid, [
    channel("sbp", [point(180, 118, 0), point(120, 95, null), point(60, 101, 1)]),
    channel("map", [point(180, 80), point(120, 64), point(60, 70)])], { hours }));

  it("holds exactly what the chart draws, newest first", async () => {
    await open("heart_rate", MIXED);
    const drawn = [...chart().querySelectorAll("circle[data-value]")]
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

  it("lists two readings at one instant as two rows — each its own, not two under one repeated key", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate",
        [point(120, 84, 0), point(60, 130, 2), point(60, 132, 3)])], { hours })));
      const values = [...(await table()).querySelectorAll("tr[data-value]")].map((r) => r.dataset.value);
      // Newest first: at one instant the later reading — the one the chart and the readout take — is on top.
      expect(values).toEqual(["132", "130", "84"]);
      expect(error.mock.calls.filter(([message]) => /same key/.test(String(message)))).toEqual([]);
    } finally {
      error.mockRestore();
    }
  });

  it("adds a row for a newer reading and leaves the rows already there alone — the same elements, not a body rebuilt at each poll", async () => {
    let newer = false;
    await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate",
      [point(180, 80, 0), point(120, 84, 0), ...(newer ? [point(30, 90, 1)] : [])])], { hours })));
    await table();
    const oldest = dialog().querySelector("tr[data-value='80']");
    const middle = dialog().querySelector("tr[data-value='84']");
    newer = true;
    await reread();
    expect(dialog().querySelectorAll("tbody tr")).toHaveLength(3);
    expect(dialog().querySelector("tr[data-value='90']")).not.toBeNull();
    // Newest first, so the new row is added at the top: a key by position would hand every row its
    // neighbour's element instead.
    expect(dialog().querySelector("tr[data-value='80']")).toBe(oldest);
    expect(dialog().querySelector("tr[data-value='84']")).toBe(middle);
  });

  it("has no row for a reading that arrived without a value — the chart draws no dot for it, so the table lists none", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate", [point(120, 84, 0), point(60, null)])], { hours })));
    const rows = [...(await table()).querySelectorAll("tbody tr")];
    expect(rows.map((r) => r.dataset.value)).toEqual(["84"]);
    expect(dialog().querySelector("[data-value='NaN']")).toBeNull();
  });

  it("holds what the chart draws on the pressure card too — both series, every reading once, newest first", async () => {
    await open("pressure", PRESSURE);
    const drawn = [...chart().querySelectorAll("circle[data-value]")]
      .map((c) => [c.closest("[data-series]").dataset.series, c.dataset.ts, c.dataset.value]);
    const listed = [...(await table("Sistolik AT · MAP")).querySelectorAll("tr[data-value]")]
      .map((r) => [r.dataset.series, r.dataset.ts, r.dataset.value]);
    const keyed = (rows) => rows.map((row) => row.join("|")).sort();
    expect(drawn).toHaveLength(6);
    expect(keyed(listed)).toEqual(keyed(drawn));
    const instants = listed.map(([, ts]) => Date.parse(ts));
    expect(instants).toEqual([...instants].sort((a, b) => b - a));
  });

  it("prints the engine's points for a NEWS2 channel, a reason for one it sent none for, and nothing for MAP", async () => {
    await open("pressure", PRESSURE);
    const grid = await table("Sistolik AT · MAP");
    const cells = (series, value) => within(grid.querySelector(`tr[data-series='${series}'][data-value='${value}']`)).getAllByRole("cell");
    expect(cells("sbp", 118).map((c) => c.textContent)).toEqual(["Sistolik AT", "118", "mmHg", "0", ""]);
    expect(cells("sbp", 101)[3]).toHaveTextContent("+1");
    // The engine sent no points for this systolic reading: a dash, and the reason for a screen reader.
    const unscored = cells("sbp", 95)[3];
    expect(within(unscored).getByText("—")).toHaveAttribute("aria-hidden", "true");
    // Worded for the row it is in: this reading, not "the last one" (that is the card's sentence).
    expect(unscored).toHaveTextContent("NEWS2 balı yoxdur: bu ölçmə qiymətləndirilməyib");
    expect(unscored).not.toHaveTextContent("son ölçmə");
    // MAP is not a NEWS2 parameter: its cell is empty — not a dash that reads as a missing score.
    for (const value of [80, 64, 70]) expect(cells("map", value)[3].textContent).toBe("");
  });

  it("carries the legend's notes into the table — thinned, marks cut short, an alarm's first detection — but not the chart's swatches", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate",
      [point(90, 84, 0), point(60, 90, 0), point(30, 96, 1)], { thinned: true, total_points: 2500 })], { hours, markers_truncated: true })));
    await table();
    const notes = dialog().querySelector("[data-notes]");
    expect(notes).toHaveAttribute("role", "list");
    expect(notes).toHaveTextContent("Nəbz seyrəldildi: 2500 nöqtədən 3");
    expect(notes).toHaveTextContent("işarələrin hamısı oxunmadı: ən yeniləri çatışmaya bilər");
    expect(notes).toHaveTextContent("siqnalın ilk aşkarlanması");
    expect(dialog().querySelector("[data-legend]")).toBeNull();
  });

  it("says MAP is not scored by NEWS2 under the pressure table too, and leaves out what does not apply", async () => {
    await open("pressure", PRESSURE);
    await table("Sistolik AT · MAP");
    const notes = dialog().querySelector("[data-notes]");
    expect(notes).toHaveTextContent("MAP NEWS2-də qiymətləndirilmir; zolaqlar Sistolik AT üçündür");
    expect(notes).not.toHaveTextContent("seyrəldildi");
    expect(notes).not.toHaveTextContent("işarələrin hamısı");
  });

  it("says there is no measurement instead of showing an empty captioned table", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [], { hours })));
    await toTable();
    expect(dialog().querySelector("[data-no-data]")).toHaveTextContent("Bu kanal üçün ölçmə yoxdur");
    expect(within(dialog()).queryByRole("table")).toBeNull();
    expect(dialog().querySelector("[data-notes]")).not.toBeNull();         // what the marks mean still stands
  });

  it("lists the marks when there is no reading, under the same no-measurement line", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [], { hours, markers: [marker(90, "antibiotic")] })));
    await toTable();
    expect(dialog().querySelector("[data-no-data]")).toHaveTextContent("Bu kanal üçün ölçmə yoxdur");
    const rows = [...within(dialog()).getByRole("table").querySelectorAll("tbody tr")];
    expect(rows.map((r) => r.dataset.mark)).toEqual(["antibiotic"]);
  });

  it("is a real table: a caption, column headers, and the time heading each row", async () => {
    await open("heart_rate", MIXED);
    const grid = await table();
    expect(within(grid).getAllByRole("columnheader").map((h) => h.textContent))
      .toEqual(["Vaxt", "Dəyər", "Vahid", "NEWS2 balı", "Hadisə"]);
    expect(within(grid).getAllByRole("rowheader")).toHaveLength(4);
  });
});

describe("the big chart, opening and reading", () => {
  it("opens with focus on the pressed window option — what the dialog shows — not on the first control", async () => {
    await open();
    expect(document.activeElement).toHaveAttribute("aria-pressed", "true");
    expect(document.activeElement).toHaveTextContent("24 saat");
  });

  it("names a mark beside a reading with its own time when that reads differently", async () => {
    // 61 minutes ago is within one pixel column of the 60-minute reading on a 24-hour chart, but not
    // its minute: the readout must not give the mark the reading's time.
    await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate", [point(120, 84, 0), point(60, 132, 3)])],
      { hours, markers: [marker(61, "alarm", "news2")] })));
    fireEvent.mouseMove(chart(), { clientX: xOf(60) });
    expect(dialog().querySelector("[data-readout]").textContent)
      .toBe(`${hhmm(NOW - 3_600_000)} · 132 /dəq · siqnal: news2 (${hhmm(NOW - 61 * 60_000)})`);
  });

  it("takes two readings at one instant as one keyboard stop, read as the later one", async () => {
    await open("heart_rate", answering((pid, hours) => trends(pid, [channel("heart_rate",
      [point(120, 84, 0), point(60, 130, 2), point(60, 132, 3)])], { hours })));
    const svg = chart();
    const readout = () => dialog().querySelector("[data-readout]").textContent;
    fireEvent.keyDown(svg, { key: "Home" });
    expect(readout()).toBe(`${hhmm(NOW - 7_200_000)} · 84 /dəq`);
    fireEvent.keyDown(svg, { key: "ArrowRight" });
    expect(readout()).toBe(`${hhmm(NOW - 3_600_000)} · 132 /dəq`);
    fireEvent.keyDown(svg, { key: "ArrowRight" });                     // no third stop
    expect(readout()).toBe(`${hhmm(NOW - 3_600_000)} · 132 /dəq`);
  });
});
```

Write `dashboard/src/live/screens/patient/trends/trendText.test.js`:

```js
// How an instant, a mark and a value beside a reading are worded. The time labels are the chart's own
// (whenText), so a value or a mark that carries its own time says it the way the axis does.
import { describe, it, expect } from "vitest";
import { NOW } from "../../../data/board.testutil.js";
import { ddmm, hhmm } from "../../../i18n/dates.js";
import { markBeside, pointsText, valueBeside, whenText } from "./trendText.js";

const MINUTE = 60_000;
const t = (key) => ({ "patient.trendsMarkerAlarm": "siqnal", "patient.trendsMarkerAntibiotic": "antibiotik" })[key];

describe("trendText", () => {
  it("writes an instant as the chart's axis does — the date as well over three days", () => {
    expect(whenText(NOW, 24)).toBe(hhmm(NOW));
    expect(whenText(NOW, 6)).toBe(hhmm(NOW));
    expect(whenText(NOW, 72)).toBe(`${ddmm(NOW)} ${hhmm(NOW)}`);
  });

  it("gives a value its own time in parentheses when it reads differently from the reading it is beside", () => {
    const at = NOW - 60 * MINUTE;
    expect(valueBeside("64 mmHg", at - 75_000, at, 24)).toBe(`64 mmHg (${hhmm(at - 75_000)})`);
    expect(valueBeside("64 mmHg", at + 12_000, at, 24)).toBe("64 mmHg");            // the same minute: nothing added
    expect(valueBeside("64", at, at, 24)).toBe("64");
    // Over three days the date is part of the reading — a value a day away is not "the same time".
    expect(valueBeside("64", at - 24 * 60 * MINUTE, at, 72)).toBe(`64 (${whenText(at - 24 * 60 * MINUTE, 72)})`);
  });

  it("gives a mark its own time in the same way", () => {
    const at = NOW - 60 * MINUTE;
    const mark = { kind: "alarm", label: "news2", ms: at - 90_000 };
    expect(markBeside(t, mark, at, 24)).toBe(`siqnal: news2 (${hhmm(at - 90_000)})`);
    expect(markBeside(t, { ...mark, ms: at }, at, 24)).toBe("siqnal: news2");
    expect(markBeside(t, { kind: "antibiotic", ms: at }, at, 24)).toBe("antibiotik");
  });

  it("prints the engine's points as a column does: +n, 0, or a dash for none", () => {
    expect(pointsText(3)).toBe("+3");
    expect(pointsText(0)).toBe("0");
    expect(pointsText(null)).toBe("—");
    expect(pointsText(Number.NaN)).toBe("—");
    expect(pointsText(2.5)).toBe("—");
  });
});
```

Write `dashboard/src/live/screens/patient/trends/TrendChart.test.jsx` (whole):

```jsx
// What the chart draws, read off the SVG. jsdom has no layout, so the chart runs on its fallback
// width (320 small, 640 big) and every x below is worked out from `plotFrame` + `timeScale`.
import { afterEach, describe, it, expect, vi } from "vitest";
import React from "react";
import { act, fireEvent, render } from "@testing-library/react";
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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
    expect(named).not.toHaveAttribute("tabindex");                       // an image with no keys is no tab stop
    expect(named).not.toHaveAttribute("aria-roledescription");
    document.body.innerHTML = "";
    const quiet = draw({ series: [hr([point(60, 72, 0)])] });
    expect(quiet).toHaveAttribute("aria-hidden", "true");
    expect(quiet).not.toHaveAttribute("role");
    expect(quiet).not.toHaveAttribute("tabindex");
  });

  it("takes the keys as an application, not an image: one tab stop with a name, a spoken kind and its keys described", () => {
    // An image keeps NVDA and JAWS in browse mode, where the arrow keys never reach the page.
    const onKeyDown = vi.fn();
    const svg = draw({
      series: [hr([point(60, 72, 0)])], label: "Nəbz: 1", big: true, height: 280, onKeyDown, describedBy: "hint-1", roleDescription: "qrafik",
    });
    expect(svg).toHaveAttribute("role", "application");
    expect(svg).toHaveAttribute("aria-roledescription", "qrafik");
    expect(svg).toHaveAttribute("aria-label", "Nəbz: 1");
    expect(svg).toHaveAttribute("aria-describedby", "hint-1");
    expect(svg).toHaveAttribute("tabindex", "0");
    expect(svg).toHaveClass("rounded-ctl");
    fireEvent.keyDown(svg, { key: "Home" });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it("gives the ring a shape only where there is a ring: the chart that takes no keys is a plain block", () => {
    const svg = draw({ series: [hr([point(60, 72, 0)])], label: "Nəbz: 1", big: true, height: 280 });
    expect(svg).toHaveClass("block");
    expect(svg).not.toHaveClass("rounded-ctl");
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

  it("widens its range to take in the patient's normal, so a band just entered is always on the chart", () => {
    // 72 alone would span 68.4–75.6 and leave a normal of 100–115 off the chart. With it the range is
    // 72–115 ± 15 % = 65.55–121.45 on y 40 (bottom) to 6 (top): y(115) = 9.92, y(100) = 19.05.
    const svg = draw({ series: [hr([point(60, 72, 0)])], bands: { news2: null, own_normal: { low: 100, high: 115 } } });
    const own = svg.querySelector("[data-own-normal]");
    const rect = own.querySelector("rect");
    expect(Number(rect.getAttribute("y"))).toBeCloseTo(9.923, 2);
    expect(Number(rect.getAttribute("height"))).toBeCloseTo(9.123, 2);
    // The dashed edges are 1-px lines: each sits on the centre of the pixel row its edge falls in.
    expect(all(own, "line").map((l) => [l.getAttribute("y1"), l.getAttribute("y2")])).toEqual([["9.5", "9.5"], ["19.5", "19.5"]]);
  });

  it("snaps the big chart's grid lines onto the centre of a pixel row too", () => {
    const svg = draw({ series: [hr([point(120, 84, 0), point(60, 132, 3)])], big: true, height: 280 });
    const ys = all(svg, "[data-tick='value'] line").map((l) => Number(l.getAttribute("y1")));
    expect(ys.length).toBeGreaterThan(1);
    expect(ys.every((v) => v % 1 === 0.5)).toBe(true);
  });

  it("draws nothing for a window it cannot place — an end that is missing, or an end before the start", () => {
    const series = [hr([point(60, 84, 0), point(30, 90, 0)])];
    expect(draw({ series, sinceMs: Number.NaN })).toBeNull();
    expect(draw({ series, untilMs: undefined })).toBeNull();
    expect(draw({ series, sinceMs: NOW, untilMs: SINCE })).toBeNull();
    expect(draw({ series, sinceMs: Number.NaN, big: true, height: 280, label: "Nəbz" })).toBeNull();
  });

  it("places a measurement stamped after the window's end by the same scale, and drops a mark there", () => {
    const frame = plotFrame(640, 280, { labels: true, markers: true, axis: true });
    const x = timeScale(SINCE, NOW, frame.left, frame.right);
    const svg = draw({
      series: [hr([point(60, 84, 0), point(-30, 90, 0)])],            // the second is 30 minutes AFTER `until`
      markers: parseMarkers([marker(-30, "alarm")]), big: true, height: 280,
    });
    const [, late] = all(svg, "circle");
    expect(Number(late.getAttribute("cx"))).toBeCloseTo(x(NOW + 30 * 60_000));
    expect(Number(late.getAttribute("cx"))).toBeGreaterThan(frame.right);   // past the edge, never clamped onto it
    expect(all(svg, "[data-marker]")).toHaveLength(0);
  });

  it("draws two readings at one instant, and two alerts first seen on one reading, each under a key of its own", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const markers = parseMarkers([marker(60, "alarm", "news2"), marker(60, "alarm", "lactate"), marker(60, "antibiotic")]);
    const svg = draw({ series: [hr([point(60, 84, 0), point(60, 90, 1)])], markers, big: true, height: 280 });
    expect(all(svg, "circle").map((c) => c.dataset.value)).toEqual(["84", "90"]);
    expect(all(svg, "[data-marker]").map((m) => m.dataset.marker)).toEqual(["alarm", "alarm", "antibiotic"]);
    expect(error.mock.calls.flat().join(" ")).not.toMatch(/same key/);
  });
});

describe("the trend chart's width", () => {
  // jsdom has no layout: clientWidth is 0 and there is no ResizeObserver. Both are stood in for here.
  function measured(initial) {
    const state = { width: initial, notify: null, disconnect: vi.fn() };
    vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(() => state.width);
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback) { state.notify = callback; }
      observe() {}
      disconnect() { state.disconnect(); }
    });
    return state;
  }

  it("measures the box it sits in, so a unit is a pixel, follows it as it resizes and lets go on unmount", () => {
    const box = measured(480);
    const { container, unmount } = render(<TrendChart series={[hr([point(60, 84, 0)])]} sinceMs={SINCE} untilMs={NOW} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("viewBox", "0 0 480 46");
    const x480 = timeScale(SINCE, NOW, 2, 478);
    expect(Number(svg.querySelector("circle").getAttribute("cx"))).toBeCloseTo(x480(NOW - 60 * 60_000));
    box.width = 300;
    act(() => box.notify());
    expect(svg).toHaveAttribute("viewBox", "0 0 300 46");
    unmount();
    expect(box.disconnect).toHaveBeenCalled();
  });

  it("attaches its observer when a window it could not draw becomes one, and lets go when it stops being one", () => {
    // An answer whose since / until cannot be read draws nothing, so there is no box to measure; the
    // valid answer after it must find one.
    const box = measured(480);
    const series = [hr([point(60, 84, 0)])];
    const { container, rerender } = render(<TrendChart series={series} sinceMs={Number.NaN} untilMs={Number.NaN} />);
    expect(container.querySelector("svg")).toBeNull();
    rerender(<TrendChart series={series} sinceMs={SINCE} untilMs={NOW} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("viewBox", "0 0 480 46");
    box.width = 300;
    act(() => box.notify());
    expect(svg).toHaveAttribute("viewBox", "0 0 300 46");
    rerender(<TrendChart series={series} sinceMs={Number.NaN} untilMs={Number.NaN} />);
    expect(box.disconnect).toHaveBeenCalled();
  });

  it("keeps its fallback width while the box has none (hidden, not laid out yet)", () => {
    measured(0);
    const { container } = render(<TrendChart series={[hr([point(60, 84, 0)])]} sinceMs={SINCE} untilMs={NOW} />);
    expect(container.querySelector("svg")).toHaveAttribute("viewBox", "0 0 320 46");
  });
});
```

Write `dashboard/src/live/screens/patient/trends/trendGeometry.test.js` (whole):

```js
// The trend charts' geometry, without React: every number below is worked out by hand in the
// comment beside it, so a change to the arithmetic shows up as a change to a number someone wrote.
import { describe, it, expect } from "vitest";
import {
  bandRects, crisp, indexAtTime, linePath, markerMarks, marksAtTime, nearestIndex, ownNormalRect, parseMarkers,
  parsePoints, plotFrame, tickLabel, timeLabelPlace, timeScale, timeTicks, validWindow, valueDomain, valueExtent,
  valueResolution, valueScale, valueTickStep, valueTicks,
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

  it("puts a range of no height on the plot's midline instead of dividing by it", () => {
    expect(valueScale({ lo: 5, hi: 5 }, 0, 20)(5)).toBe(10);
    expect(valueScale({ lo: 0, hi: Number.NaN }, 0, 20)(3)).toBe(10);
    expect(valueScale({ lo: 9, hi: 1 }, 0, 20)(3)).toBe(10);
  });

  it("places a time outside the window by the same scale — past the plot's edge, never clamped onto it", () => {
    const x = timeScale(0, 100, 10, 110);
    expect([x(-50), x(150)]).toEqual([-40, 160]);
  });

  it("calls a window drawable only when both ends are numbers and it does not run backwards", () => {
    expect(validWindow(0, 100)).toBe(true);
    expect(validWindow(5, 5)).toBe(true);
    expect(validWindow(100, 0)).toBe(false);
    expect(validWindow(Number.NaN, 100)).toBe(false);
    expect(validWindow(0, Number.NaN)).toBe(false);
    expect(validWindow(0, Infinity)).toBe(false);
    expect(validWindow(undefined, 100)).toBe(false);
  });

  it("snaps a 1-px line to the centre of the pixel row it falls in, so it is not smeared over two", () => {
    expect([crisp(9.92), crisp(19.05), crisp(10.5), crisp(10)]).toEqual([9.5, 19.5, 10.5, 10.5]);
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

  it("labels values at round steps inside the domain: 1, 2, 5 or 10 × 10ⁿ, the nearest (d3's rule)", () => {
    const ticksOf = (domain) => valueTicks(domain).ticks;
    expect(ticksOf({ lo: 0, hi: 100 })).toEqual([0, 20, 40, 60, 80, 100]);         // raw 25 → 20, not 25
    expect(ticksOf({ lo: 57, hi: 83 })).toEqual([60, 65, 70, 75, 80]);             // raw 6.5 → 5
    expect(ticksOf({ lo: 36.1, hi: 37.9 })).toEqual([36.5, 37, 37.5]);             // raw 0.45 → 0.5
    expect(valueTicks(null)).toEqual({ step: null, ticks: [] });
    expect(valueTicks({ lo: 5, hi: 5 }, 4, { extent: { lo: 5, hi: 5 } })).toEqual({ step: null, ticks: [] });   // a range of no height
    expect(valueTickStep({ lo: 0, hi: 0 })).toBeNull();
  });

  it("returns the step it labelled at with the labels, so a caller computes it once", () => {
    expect(valueTicks({ lo: 57, hi: 83 }).step).toBe(5);
    expect(valueTicks({ lo: 57, hi: 83 }).step).toBe(valueTickStep({ lo: 57, hi: 83 }));
  });

  it("labels systolic 60–220 every 50 — not only 100 and 200 — and only inside the data", () => {
    const domain = valueDomain([60, 220]);                                          // 36–244
    expect(valueTickStep(domain)).toBe(50);
    expect(valueTicks(domain).ticks).toEqual([50, 100, 150, 200]);
    expect(valueTicks(domain, 4, { extent: valueExtent([60, 220]) }).ticks).toEqual([100, 150, 200]);
  });

  it("never labels a value past the data: no SpO₂ 105, no lactate −0.5 in the chart's margin", () => {
    const spo2 = [92, 99, 100];
    expect(Math.max(...valueTicks(valueDomain(spo2), 4, { extent: valueExtent(spo2) }).ticks)).toBeLessThanOrEqual(100);
    const lactate = [0.5, 1, 4.1];
    expect(Math.min(...valueTicks(valueDomain(lactate), 4, { extent: valueExtent(lactate) }).ticks)).toBeGreaterThanOrEqual(0.5);
  });

  it("labels a single reading with its own value, written at the DATA's resolution — not at a step it fell between", () => {
    const label = (values) => {
      const { ticks, step } = valueTicks(valueDomain(values), 4, { extent: valueExtent(values), resolution: valueResolution(values) });
      return ticks.map((v) => tickLabel(v, step));
    };
    // The round steps (2, 0.5, 0.2) all fall to one side of the value: without this the chart has no number on it.
    expect(label([85])).toEqual(["85"]);
    expect(label([4.1])).toEqual(["4.1"]);
    expect(label([37.4])).toEqual(["37.4"]);
    expect(label([100])).toEqual(["100"]);                                          // SpO₂ 100: a step lands on it, and not past it
    expect(label([0])).toEqual(["0"]);                                              // lactate 0: the margin is −1…1, the label is 0
    expect(label([84, 84, 84])).toEqual(["84"]);                                    // repeated, still one value
  });

  it("labels both ends of an extent that no round step falls inside, written at the data's resolution", () => {
    // 80–90 asks for steps of 2 (raw 2.5); 82.6–83.4 holds no multiple of 2. (A range of two or more
    // measured values always holds a step: the margin makes the domain wider than the step.)
    const gap = valueTicks({ lo: 80, hi: 90 }, 4, { extent: { lo: 82.6, hi: 83.4 }, resolution: 0.1 });
    expect(gap.ticks).toEqual([82.6, 83.4]);
    expect(gap.step).toBe(0.1);
    // Where a step does fall inside, only the steps are labelled.
    expect(valueTicks({ lo: 80, hi: 90 }, 4, { extent: { lo: 81, hi: 87 }, resolution: 0.1 }).ticks).toEqual([82, 84, 86]);
  });

  it("labels no finer than the data is measured, with as many decimals as the step and no more", () => {
    const temps = [36.9, 37, 37.1];
    expect(valueResolution(temps)).toBeCloseTo(0.1);
    expect(valueResolution([84, 90])).toBe(1);
    const domain = valueDomain(temps);                                              // 36.87–37.13: raw 0.065
    expect(valueTickStep(domain)).toBeCloseTo(0.05);                                // what the range alone asks for
    expect(valueTickStep(domain, 4, valueResolution(temps))).toBeCloseTo(0.1);      // what a tenth-measured value allows
    expect(tickLabel(37, 0.1)).toBe("37.0");
    expect(tickLabel(36.5, 0.5)).toBe("36.5");
    expect(tickLabel(150, 50)).toBe("150");
  });

  it("keeps a wide range to a handful of round labels inside it (systolic 60–220 spans 36–244)", () => {
    const domain = valueDomain([60, 220]);
    const { ticks } = valueTicks(domain);
    expect(domain).toEqual({ lo: 36, hi: 244 });
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks.length).toBeLessThanOrEqual(6);
    expect(ticks.every((v) => v >= domain.lo && v <= domain.hi && v % 10 === 0)).toBe(true);
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
  });

  it("labels no time at all — and does not hang — for a window that is not a window", () => {
    expect(timeTicks(Number.NaN, 5, 24)).toEqual([]);
    expect(timeTicks(0, Number.NaN, 24)).toEqual([]);
    expect(timeTicks(0, Infinity, 24)).toEqual([]);
    expect(timeTicks(undefined, undefined, 24)).toEqual([]);
    expect(timeTicks(10, 5, 24)).toEqual([]);                          // until before since
    expect(timeTicks(0, 5, Number.NaN)).toEqual([]);                   // nor a step it cannot work out
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

  it("names EVERY mark within one pixel's worth of milliseconds of an instant, and never on a chart of no width", () => {
    // Two alert kinds first detected on one reading share an instant: the readout must name both.
    const marks = [{ ms: 1_000, kind: "alarm", label: "news2" }, { ms: 1_000, kind: "alarm", label: "sepsis" }];
    expect(marksAtTime(marks, 1_090, 100)).toEqual(marks);
    expect(marksAtTime(marks, 1_200, 100)).toEqual([]);
    expect(marksAtTime(marks, 1_000, 0)).toEqual([]);
  });

  it("finds a reading by its exact instant — the later one when two share it — and none when it slid out", () => {
    const points = [p(10, 1), p(20, 2), p(20, 3), p(30, Number.NaN)];
    expect(indexAtTime(points, 20)).toBe(2);
    expect(indexAtTime(points, 10)).toBe(0);
    expect(indexAtTime(points, 30)).toBe(3);                            // a missing value is still that instant
    expect(indexAtTime(points, 15)).toBe(-1);
    expect(indexAtTime([], 10)).toBe(-1);
    expect(indexAtTime(undefined, 10)).toBe(-1);
  });

  it("prefers the last DRAWABLE reading when two share an instant — not a valueless twin stamped after it", () => {
    const NaN_ = Number.NaN;
    expect(indexAtTime([p(10, 1), p(20, 2), p(20, NaN_)], 20)).toBe(1);
    expect(indexAtTime([p(20, 2), p(20, 3), p(20, NaN_)], 20)).toBe(1);   // the last of the drawable ones
    expect(indexAtTime([p(20, NaN_), p(20, 3)], 20)).toBe(1);
    expect(indexAtTime([p(20, NaN_), p(20, NaN_)], 20)).toBe(1);          // none drawable: still that instant, the later
  });

  it("places a time label centred on its instant, unless that would run it past an edge", () => {
    expect(timeLabelPlace(300, "12:00", 640)).toEqual({ x: 300, anchor: "middle" });
    expect(timeLabelPlace(630, "12:00", 640)).toEqual({ x: 640, anchor: "end" });              // 5 × 6.5 / 2 = 16.25 px
    expect(timeLabelPlace(600, "20.10 12:00", 640)).toEqual({ x: 600, anchor: "middle" });     // 72 h: 11 × 6.5 / 2 = 35.75 px
    expect(timeLabelPlace(610, "20.10 12:00", 640)).toEqual({ x: 640, anchor: "end" });
    expect(timeLabelPlace(4, "12:00", 640)).toEqual({ x: 0, anchor: "start" });
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

And in `trends/TrendCard.test.jsx` the mini chart stays decoration inside the card's button (X28) — replace:

```jsx
  it("draws no NEWS2 tint and no own-normal band behind the pressure card's two series (X26)", () => {
```

with:

```jsx
  it("adds no tab stop and no role of its own inside the card's button — the button is the one control", () => {
    // The big chart is an application with a tab stop; the mini chart in the card must stay hidden decoration.
    const card = show(PRESSURE, [
      channel("sbp", [point(90, 118, 0), point(30, 112, 0)]),
      channel("map", [point(90, 80), point(30, 76)]),
    ], { onOpen: () => {} });
    expect(card.tagName).toBe("BUTTON");
    const svg = card.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
    expect(svg).not.toHaveAttribute("role");
    expect(svg).not.toHaveAttribute("aria-roledescription");
    expect(card.querySelectorAll("[tabindex]")).toHaveLength(0);
    expect(card.querySelectorAll("[role='application']")).toHaveLength(0);
  });

  it("draws no NEWS2 tint and no own-normal band behind the pressure card's two series (X26)", () => {
```

Run them: `TrendModal.test.jsx` → `Tests  39 failed | 14 passed (53)` (`Unable to find an accessible element with the role "application"` — the chart is an `img`, no keys, no table, no notes, no own times); `trendText.test.js` → `Failed to resolve import "./trendText.js"`; `TrendChart.test.jsx` → `Tests  1 failed | 21 passed (22)`; `trendGeometry.test.js` → `Tests  1 failed | 30 passed (31)` (`indexAtTime` takes a valueless twin); `TrendCard.test.jsx` → `Tests  26 passed (26)` (the guard holds already).

- [ ] **Step 2: The words.** Two keys in four languages — the chart's role description (X28) and the table row's own reason for a reading NEWS2 did not score — four Edits in `dashboard/src/live/i18n/strings/patient.js`:

In `tr`, replace:

```js
    trendsPointsUnknownSr: "NEWS2 puanı yok: son ölçüm puanlanmadı",
    trendsOwnNormalPill: "Hastanın normalinde",
    trendsOpen: "{channel}: büyük grafiği aç",
    trendsChartLabel: "{channel}: son {hours} saat, çizilen nokta {count}",
    trendsThinned: "{channel} seyreltildi: {total} noktadan {kept}",
```

with:

```js
    trendsPointsUnknownSr: "NEWS2 puanı yok: son ölçüm puanlanmadı",
    trendsPointsUnknownRowSr: "NEWS2 puanı yok: bu ölçüm puanlanmadı",
    trendsOwnNormalPill: "Hastanın normalinde",
    trendsOpen: "{channel}: büyük grafiği aç",
    trendsChartLabel: "{channel}: son {hours} saat, çizilen nokta {count}",
    trendsChartRole: "grafik",
    trendsThinned: "{channel} seyreltildi: {total} noktadan {kept}",
```

In `az`, replace:

```js
    trendsPointsUnknownSr: "NEWS2 balı yoxdur: son ölçmə qiymətləndirilməyib",
    trendsOwnNormalPill: "Xəstənin normasında",
    trendsOpen: "{channel}: böyük qrafiki aç",
    trendsChartLabel: "{channel}: son {hours} saat, çəkilən nöqtə {count}",
    trendsThinned: "{channel} seyrəldildi: {total} nöqtədən {kept}",
```

with:

```js
    trendsPointsUnknownSr: "NEWS2 balı yoxdur: son ölçmə qiymətləndirilməyib",
    trendsPointsUnknownRowSr: "NEWS2 balı yoxdur: bu ölçmə qiymətləndirilməyib",
    trendsOwnNormalPill: "Xəstənin normasında",
    trendsOpen: "{channel}: böyük qrafiki aç",
    trendsChartLabel: "{channel}: son {hours} saat, çəkilən nöqtə {count}",
    trendsChartRole: "qrafik",
    trendsThinned: "{channel} seyrəldildi: {total} nöqtədən {kept}",
```

In `ru`, replace:

```js
    trendsPointsUnknownSr: "Нет баллов NEWS2: последнее измерение не оценено",
    trendsOwnNormalPill: "В пределах нормы пациента",
    trendsOpen: "{channel}: открыть большой график",
    trendsChartLabel: "{channel}: последние {hours} ч, точек на графике — {count}",
    trendsThinned: "{channel}: прорежено, показано {kept} из {total}",
```

with:

```js
    trendsPointsUnknownSr: "Нет баллов NEWS2: последнее измерение не оценено",
    trendsPointsUnknownRowSr: "Нет баллов NEWS2: это измерение не оценено",
    trendsOwnNormalPill: "В пределах нормы пациента",
    trendsOpen: "{channel}: открыть большой график",
    trendsChartLabel: "{channel}: последние {hours} ч, точек на графике — {count}",
    trendsChartRole: "график",
    trendsThinned: "{channel}: прорежено, показано {kept} из {total}",
```

In `en`, replace:

```js
    trendsPointsUnknownSr: "No NEWS2 points: the last reading was not scored",
    trendsOwnNormalPill: "Within the patient's normal",
    trendsOpen: "{channel}: open the large chart",
    trendsChartLabel: "{channel}: last {hours} h, {count} points drawn",
    trendsThinned: "{channel} thinned: {kept} of {total} points shown",
```

with:

```js
    trendsPointsUnknownSr: "No NEWS2 points: the last reading was not scored",
    trendsPointsUnknownRowSr: "No NEWS2 points: this reading was not scored",
    trendsOwnNormalPill: "Within the patient's normal",
    trendsOpen: "{channel}: open the large chart",
    trendsChartLabel: "{channel}: last {hours} h, {count} points drawn",
    trendsChartRole: "chart",
    trendsThinned: "{channel} thinned: {kept} of {total} points shown",
```

Then Write `dashboard/src/live/screens/patient/trends/trendText.js` (Task 12's `whenText` and `markText` move here from `TrendModal.jsx`, beside `markBeside`, `valueBeside` — a MAP read at another minute prints its own time, each number with its unit (X30) — and `pointsText`):

```js
// src/live/screens/patient/trends/trendText.js — how the big chart's axis, its readout and its table
// word an instant and a mark, so the three never say one thing three ways.
import { ddmm, hhmm } from "../../../i18n/dates.js";

/** When, as the chart's own time labels write it: with the date over three days. */
export const whenText = (ms, hours) => (hours === 72 ? `${ddmm(ms)} ${hhmm(ms)}` : hhmm(ms));

/** What a mark says: an alarm with the engine's own kind (data, not translated), a dose by name. */
export function markText(t, mark) {
  return mark.kind === "alarm" ? `${t("patient.trendsMarkerAlarm")}: ${mark.label}` : t("patient.trendsMarkerAntibiotic");
}

/** A mark as the readout names it beside a reading: with its OWN time when that reads differently —
 *  a mark within one pixel column of a reading need not be at the reading's instant, and the readout
 *  must not give it the reading's time. */
export function markBeside(t, mark, readingMs, hours) {
  const own = whenText(mark.ms, hours);
  return own === whenText(readingMs, hours) ? markText(t, mark) : `${markText(t, mark)} (${own})`;
}

/** A value as the readout names it beside the reading under the cursor ("64 mmHg", the text already
 *  written): followed by its OWN time in parentheses when that reads differently. The second series of a
 *  card (MAP) is read at the nearest reading within one pixel column of the first — seconds, perhaps a
 *  minute, apart — and the readout must not give it the first one's time. */
export function valueBeside(text, readingMs, atMs, hours) {
  const own = whenText(readingMs, hours);
  return own === whenText(atMs, hours) ? text : `${text} (${own})`;
}

/** The engine's NEWS2 points for one reading, as a column prints them: "+3", "0", or "—" for none. */
export const pointsText = (points) => (Number.isInteger(points) ? (points > 0 ? `+${points}` : "0") : "—");
```

- [ ] **Step 3: The geometry and the chart.** Write `dashboard/src/live/screens/patient/trends/trendGeometry.js` (whole; `indexAtTime` prefers the last DRAWABLE reading at an instant):

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

// The plot's margins, in pixels. The viewBox is the measured width, so a unit is a pixel.
const LABEL_PAD = 34;       // room for the value labels on the left, big chart only
const LABEL_RIGHT_PAD = 8;  // the big chart's right margin, so its last time label is not cut off
const EDGE_PAD = 2;         // the mini chart's side margins, so an edge dot is not cut off
const TOP_PAD = 6;
const BOTTOM_PAD = 6;
const AXIS_BASELINE = 4;    // the time labels' baseline above the chart's bottom edge
export const MARKER_LANE = 14;
export const AXIS_LANE = 16;
// The time-label step per window: hourly over 6 h, every 4 h over 24 h, every 12 h over 3 days.
const TICK_HOURS = { 6: 1, 24: 4, 72: 12 };
// A value label's step is 1, 2, 5 or 10 × 10ⁿ — the one NEAREST the raw step on a log scale, by d3's
// thresholds (√50, √10, √2). Rounding up to the next nice step instead could double it: systolic
// 60–220 then got only two labels, 100 and 200.
const STEP_E10 = Math.sqrt(50);
const STEP_E5 = Math.sqrt(10);
const STEP_E2 = Math.sqrt(2);
// A time label's width, estimated: 10-px digits at up to 1.12× (the --fs setting) are ≈ 6.5 px each.
const TIME_LABEL_CHAR_PX = 6.5;

/** The plot area of a `width` × `height` chart. The big chart has value labels on the left, a lane
 *  under the plot for the ▲/◆ marks, and one under that for the time labels. */
export function plotFrame(width, height, { labels = false, markers = false, axis = false } = {}) {
  const left = labels ? LABEL_PAD : EDGE_PAD;
  const right = Math.max(left + 1, width - (labels ? LABEL_RIGHT_PAD : EDGE_PAD));
  const top = TOP_PAD;
  const bottom = Math.max(top + 1, height - BOTTOM_PAD - (markers ? MARKER_LANE : 0) - (axis ? AXIS_LANE : 0));
  return { left, right, top, bottom, laneY: bottom + BOTTOM_PAD + MARKER_LANE / 2, axisY: height - AXIS_BASELINE };
}

/** Whether a window can be drawn: both ends are numbers and it does not run backwards. A window of no
 *  length is drawable (everything lands on its left edge); one with an end that is not a number is
 *  not — every x would be NaN, or, worse, every dot would pile up on the left edge. */
export function validWindow(sinceMs, untilMs) {
  return Number.isFinite(sinceMs) && Number.isFinite(untilMs) && untilMs >= sinceMs;
}

/** The centre of the pixel row (or column) a coordinate falls in. A 1-px line drawn on a whole number
 *  straddles two rows and renders as two blurred ones; drawn on the centre it is one crisp one. */
export const crisp = (v) => Math.floor(v) + 0.5;

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

/** The domain onto [bottom, top] (larger values higher). A range with no height — `valueDomain` never
 *  gives one, but a caller's own might — is drawn on the midline instead of dividing by zero. */
export function valueScale(domain, top, bottom) {
  const span = domain.hi - domain.lo;
  if (!(span > 0)) return () => (top + bottom) / 2;
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

/** The finite values' own range, `{ lo, hi }`, or null. */
export function valueExtent(values) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values ?? []) {
    if (Number.isFinite(v)) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return lo > hi ? null : { lo, hi };
}

/** The data's resolution: the coarsest power of ten every finite value is a multiple of (to three
 *  decimals) — 1 for a pulse, 0.1 for a temperature measured to a tenth. */
export function valueResolution(values) {
  let decimals = 0;
  for (const v of values ?? []) {
    if (!Number.isFinite(v)) continue;
    while (decimals < 3 && Math.abs(Number(v.toFixed(decimals)) - v) > 1e-9) decimals += 1;
  }
  return 10 ** -decimals;
}

/** The step of the value labels: about `count` of them over the domain, at 1, 2, 5 or 10 × 10ⁿ —
 *  the nearest (d3's rule) — and never finer than the data's own `resolution`: a temperature measured
 *  to 0.1 is not labelled to 0.05. Null for no domain, or one of no height. */
export function valueTickStep(domain, count = 4, resolution = 0) {
  if (!domain || !(domain.hi > domain.lo)) return null;
  const raw = (domain.hi - domain.lo) / count;
  const power = Math.floor(Math.log10(raw));
  const error = raw / 10 ** power;
  const factor = error >= STEP_E10 ? 10 : error >= STEP_E5 ? 5 : error >= STEP_E2 ? 2 : 1;
  return Math.max(factor * 10 ** power, resolution);
}

/** The value labels: `{ step, ticks }` — `ticks` the values to label, `step` what to write them at
 *  (`tickLabel(v, step)`), so the caller never works the step out a second time.
 *
 *  The ticks are round values at `valueTickStep`. With `extent` — the data's own range — only those
 *  inside it: the domain's margin is the chart's, not the patient's, and a label past the data names a
 *  value nobody measured (SpO₂ 105, lactate −0.5). Clamping to a "possible" range instead would be a
 *  range the browser holds; there is none here.
 *
 *  When no round value falls inside the extent — a lone reading between two steps — the extent's own
 *  value(s) are labelled instead (both ends when they differ), written at the DATA's `resolution`,
 *  so a chart with one measurement still has a number on it: "85", "4.1", "37.4". */
export function valueTicks(domain, count = 4, { extent = null, resolution = 0 } = {}) {
  const step = valueTickStep(domain, count, resolution);
  if (!step) return { step: null, ticks: [] };
  const lo = extent ? Math.max(domain.lo, extent.lo) : domain.lo;
  const hi = extent ? Math.min(domain.hi, extent.hi) : domain.hi;
  const ticks = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) ticks.push(Number(v.toFixed(6)));
  if (ticks.length > 0 || !extent) return { step, ticks };
  return { step: resolution > 0 ? resolution : step, ticks: extent.hi > extent.lo ? [extent.lo, extent.hi] : [extent.lo] };
}

/** A value label: as many decimals as its step has, and no more ("37.5", never "37.50"). */
export function tickLabel(v, step) {
  const decimals = step > 0 ? Math.min(3, Math.max(0, -Math.floor(Math.log10(step) + 1e-9))) : 0;
  return v.toFixed(decimals);
}

/** The time labels: whole local hours on the window's step (the browser's zone is the ward's). None
 *  for a window that is not a window — `new Date(NaN).getHours()` is NaN, and the search below would
 *  never end. */
export function timeTicks(sinceMs, untilMs, hours) {
  if (!validWindow(sinceMs, untilMs)) return [];
  const step = TICK_HOURS[hours] ?? Math.max(1, Math.round(hours / 6));
  if (!Number.isFinite(step)) return [];
  const at = new Date(sinceMs);
  at.setMinutes(0, 0, 0);
  while (at.getTime() < sinceMs || at.getHours() % step !== 0) at.setHours(at.getHours() + 1);
  const out = [];
  for (; at.getTime() <= untilMs; at.setHours(at.getHours() + step)) out.push(at.getTime());
  return out;
}

/** Where a time label goes on a chart `width` wide: centred on its instant, unless that runs it past
 *  an edge — then anchored to that edge, so "dd.mm HH:MM" at 72 h is never cut off. */
export function timeLabelPlace(x, text, width) {
  const half = (String(text).length * TIME_LABEL_CHAR_PX) / 2;
  if (x + half > width) return { x: width, anchor: "end" };
  if (x - half < 0) return { x: 0, anchor: "start" };
  return { x, anchor: "middle" };
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

/** EVERY mark within one pixel of an instant, in their order — two alert kinds can be first detected on
 *  one reading, and the readout must name both. The caller holds the instant (the dialog's cursor) and
 *  the chart's milliseconds per pixel. None on a chart of no width. */
export function marksAtTime(markers, ms, msPerPx) {
  if (!(msPerPx > 0) || !Number.isFinite(ms)) return [];
  return (markers ?? []).filter((m) => Math.abs(m.ms - ms) <= msPerPx);
}

/** The index of the reading stamped exactly `ms` — the later one when two share the instant, as
 *  `nearestIndex` picks on a tie, and the last one that HAS a value (a valueless twin stamped after it
 *  is not "the" reading; the chart draws no dot for it) — or -1. When none at that instant has a value
 *  the later one still is that instant. A reading is found by WHEN it was taken, not by its place in
 *  the list: a poll that slides the window moves every index. */
export function indexAtTime(points, ms) {
  const list = points ?? [];
  let valueless = -1;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i].ms !== ms) continue;
    if (Number.isFinite(list[i].value)) return i;
    if (valueless < 0) valueless = i;
  }
  return valueless;
}
```

Write `dashboard/src/live/screens/patient/trends/TrendChart.jsx` (whole; a chart that takes ← → Home End is `role="application"` with `aria-roledescription` (X28) — NVDA and JAWS stay in browse mode over an `img` and the keys never arrive — and is no tab stop when its first series has nothing to step to; the mini chart stays `aria-hidden`; its time labels read `whenText` from `trendText.js`):

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
//
// A window that is not a window (an end that is not a number, an end before the start) draws NOTHING:
// there is nowhere to put a measurement, and a chart that piles every dot on its left edge would say
// something false. The card's text is the equivalent either way.
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FOCUS_RING } from "../../../ui/focus.js";
import {
  bandRects, crisp, linePath, markerMarks, nearestIndex, ownNormalRect, plotFrame, tickLabel, timeLabelPlace,
  timeScale, timeTicks, validWindow, valueDomain, valueExtent, valueResolution, valueScale, valueTicks,
} from "./trendGeometry.js";
import { whenText } from "./trendText.js";

const BAND_FILL = { mid: "fill-band-mid", crit: "fill-band-crit" };
const drawable = (p) => Number.isFinite(p.ms) && Number.isFinite(p.value);

// How things are drawn, in pixels (the viewBox is the measured width, so a unit is a pixel). Sizes and
// dashes only: no clinical number, and no colour, lives here.
const DOT_RADIUS = { small: 2.5, big: 3.5 };
const LINE_WIDTH = 1.5;             // a series' connector, and the ring of a hollow dot
const HAIRLINE = 1;
const CONNECTOR_DASH = "4 3";       // between two measurements: an interval, never a measurement
const OWN_NORMAL_DASH = "2 3";      // the patient's normal's edges; finer, so the two never read alike
const VALUE_LABEL_GAP = 5;          // between a value label and the plot's left edge
const VALUE_LABEL_BASELINE = 3.5;   // a value label's baseline below the gridline it names
const ALARM_HALF_WIDTH = 6;         // ▲ is 12 px wide and 10 px high
const ALARM_HALF_HEIGHT = 5;
const DIAMOND_HALF = 4;             // ◆ is an 8-px square turned 45°
const CURSOR_RADIUS = 6;
const CURSOR_LINE_OPACITY = 0.5;

/** The element's width in CSS pixels, followed as it changes; `fallback` where nothing can measure
 *  it (no ResizeObserver: jsdom, an old browser). The viewBox is that width, so one unit is one pixel
 *  and a dot stays round at any size.
 *
 *  `mounted` says whether the element exists at all: the chart renders nothing for a window it cannot
 *  place, so an answer whose `since` / `until` cannot be read leaves no box to measure, and a valid
 *  answer after it brings one. The effect therefore depends on it — run once on `[ref]`, it would
 *  find no element, return, and never attach the observer to the box that appears later. */
function useWidth(ref, fallback, mounted) {
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!mounted || !el || typeof ResizeObserver !== "function") return undefined;
    const measure = () => {
      if (el.clientWidth > 0) setWidth(Math.round(el.clientWidth));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, mounted]);
  return width;
}

export function TrendChart({
  series, bands = null, markers = [], sinceMs, untilMs, hours = 24, height = 46, big = false,
  label, cursor = null, onCursor, onPlot, onKeyDown, describedBy, roleDescription,
}) {
  const box = useRef(null);
  const placeable = validWindow(sinceMs, untilMs);
  const width = useWidth(box, big ? 640 : 320, placeable);
  const frame = plotFrame(width, height, { labels: big, markers: big, axis: big });
  const plotWidth = frame.right - frame.left;
  // The plot's width in pixels, for a caller that names a mark "within one pixel column" of a
  // cursor it moved itself (the dialog's keyboard). Before the early return: a hook runs on every render.
  useEffect(() => { onPlot?.(plotWidth); }, [onPlot, plotWidth]);
  if (!placeable) return null;
  const x = timeScale(sinceMs, untilMs, frame.left, frame.right);
  const own = bands?.own_normal ?? null;
  const values = series.flatMap((s) => s.points.map((p) => p.value));
  if (own) values.push(own.low, own.high);
  const domain = valueDomain(values);
  const y = domain ? valueScale(domain, frame.top, frame.bottom) : null;
  // The value labels: at the nearest round step, no finer than the data is measured, and only inside
  // the data — the domain's margin is the chart's, and a label there names a value nobody measured.
  // A lone reading between two steps is labelled with its own value.
  const { step: tickStep, ticks } = big && domain
    ? valueTicks(domain, 4, { extent: valueExtent(values), resolution: valueResolution(values) })
    : { step: null, ticks: [] };
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
  // The big chart is one tab stop whose arrow keys move the cursor (the dialog's `onKeyDown`). A chart
  // that takes keys is an APPLICATION, not an image: a screen reader stays in browse mode over an `img`
  // and keeps the arrow keys for itself, so ← → Home End would never reach the page. `aria-roledescription`
  // says in words what it is ("chart"); the name, and the hint the keys are described by, stay as they were.
  const keys = onKeyDown ? { tabIndex: 0, onKeyDown, "aria-describedby": describedBy } : {};
  let named = { "aria-hidden": "true", focusable: "false" };
  if (label) named = onKeyDown ? { role: "application", "aria-roledescription": roleDescription, "aria-label": label } : { role: "img", "aria-label": label };

  // A <span>, not a <div>: the small chart sits inside the card's <button>, which takes phrasing
  // content only.
  return (
    <span ref={box} className="block w-full min-w-0">
      <svg
        width="100%" height={height} viewBox={`0 0 ${width} ${height}`}
        className={onKeyDown ? `block rounded-ctl ${FOCUS_RING}` : "block"} {...named} {...keys}
        onMouseMove={onCursor ? move : undefined}
        onMouseLeave={onCursor ? () => onCursor(null, "mouse") : undefined}
      >
        {rects.map((r) => (
          <rect key={`${r.y}-${r.tone}`} data-band={r.tone} x={r.x} y={r.y} width={r.w} height={r.h} className={BAND_FILL[r.tone]} />
        ))}
        {ownRect ? (
          <g data-own-normal="">
            <rect x={ownRect.x} y={ownRect.y} width={ownRect.w} height={ownRect.h} className="fill-band-n" />
            {[["top", ownRect.y], ["bottom", ownRect.y + ownRect.h]].map(([side, edge]) => (
              <line
                key={side} x1={ownRect.x} x2={ownRect.x + ownRect.w} y1={crisp(edge)} y2={crisp(edge)}
                className="stroke-pri" strokeDasharray={OWN_NORMAL_DASH}
              />
            ))}
          </g>
        ) : null}
        {big && y ? ticks.map((v) => (
          <g key={`v${v}`} data-tick="value">
            <line x1={frame.left} x2={frame.right} y1={crisp(y(v))} y2={crisp(y(v))} className="stroke-grid" />
            <text x={frame.left - VALUE_LABEL_GAP} y={y(v) + VALUE_LABEL_BASELINE} textAnchor="end" className="fill-mute text-10">{tickLabel(v, tickStep)}</text>
          </g>
        )) : null}
        {y ? series.map((s) => {
          const path = linePath(s.points, x, y);
          return (
            <g key={s.key} data-series={s.key} className={s.color}>
              {path ? <path d={path} fill="none" stroke="currentColor" strokeWidth={LINE_WIDTH} strokeDasharray={CONNECTOR_DASH} /> : null}
              {s.points.filter(drawable).map((p, i) => (
                // A hollow dot is filled with the chart's OWN ground: the card under the mini chart, the
                // dialog's app background under the big one.
                <circle
                  key={`${p.iso}#${i}`} data-ts={p.iso} data-value={p.value} cx={x(p.ms)} cy={y(p.value)}
                  r={big ? DOT_RADIUS.big : DOT_RADIUS.small}
                  fill={s.hollow ? undefined : "currentColor"} className={s.hollow ? (big ? "fill-app" : "fill-card") : undefined}
                  stroke="currentColor" strokeWidth={s.hollow ? LINE_WIDTH : 0}
                />
              ))}
            </g>
          );
        }) : null}
        {marks.map((m, i) => {
          // Keyed by position as well: two alert kinds can first be seen on one reading.
          const key = `${m.kind}:${m.label}:${m.iso}:${i}`;
          return m.kind === "alarm" ? (
            <path
              key={key} data-marker="alarm" className="fill-crit"
              d={`M${m.x - ALARM_HALF_WIDTH},${frame.laneY + ALARM_HALF_HEIGHT}L${m.x},${frame.laneY - ALARM_HALF_HEIGHT}L${m.x + ALARM_HALF_WIDTH},${frame.laneY + ALARM_HALF_HEIGHT}Z`}
            />
          ) : (
            <rect
              key={key} data-marker={m.kind} x={m.x - DIAMOND_HALF} y={frame.laneY - DIAMOND_HALF}
              width={DIAMOND_HALF * 2} height={DIAMOND_HALF * 2} transform={`rotate(45 ${m.x} ${frame.laneY})`} className="fill-pri"
            />
          );
        })}
        {big ? timeTicks(sinceMs, untilMs, hours).map((ms) => {
          const text = whenText(ms, hours);   // the readout's and the table's words for an instant
          const place = timeLabelPlace(x(ms), text, width);   // anchored to an edge it would cross
          return (
            <text key={`t${ms}`} data-tick="time" x={place.x} y={frame.axisY} textAnchor={place.anchor} className="fill-mute text-10">
              {text}
            </text>
          );
        }) : null}
        {at && y && drawable(at) ? (
          <g data-cursor="">
            <line x1={x(at.ms)} x2={x(at.ms)} y1={frame.top} y2={frame.bottom} className="stroke-ink" strokeWidth={HAIRLINE} opacity={CURSOR_LINE_OPACITY} />
            <circle cx={x(at.ms)} cy={y(at.value)} r={CURSOR_RADIUS} fill="none" className="stroke-ink" strokeWidth={LINE_WIDTH} />
          </g>
        ) : null}
      </svg>
    </span>
  );
}
```

- [ ] **Step 4: The legend and its notes.** Write `dashboard/src/live/screens/patient/trends/TrendLegend.jsx` (whole; `TrendNotes` — thinned, the marks' read cut short, MAP not scored, ▲ a first detection — split out so the table carries them too, X29):

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
        <circle cx="9" cy="5" r="3" fill={hollow ? undefined : "currentColor"} className={hollow ? "fill-app" : undefined}
          stroke="currentColor" strokeWidth={hollow ? 1.5 : 0} />
      ) : null}
    </svg>
  );
}

const Item = ({ children }) => <li className="flex items-center gap-1.5">{children}</li>;
const LIST = "m-0 mt-2 flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0 text-11.5 text-mute";

/** The notes that qualify what is drawn or listed, in words — shared by the chart's legend and by the
 *  table (which has no swatches, but the same numbers and the same caveats):
 *    * a series drawn over another's NEWS2 bands (MAP on the pressure card) is not scored by NEWS2 —
 *      said in words, so nobody reads the systolic rows as MAP's thresholds. The ENGINE decides which
 *      channel has bands (`bands.news2` null for MAP and lactate); this only notices the difference;
 *    * the server's own flag: its read of the marks stopped at its limit (api/trends.py);
 *    * a channel the server thinned for drawing, and from how many. */
function NoteItems({ card, channels, truncated }) {
  const { t } = useI18n();
  const primary = channels[card.series[0].key] ?? null;
  const scored = Array.isArray(primary?.bands?.news2);
  const unbanded = scored ? card.series.slice(1).filter((s) => channels[s.key] && !Array.isArray(channels[s.key].bands?.news2)) : [];
  const thinned = card.series.filter((s) => channels[s.key]?.thinned);
  return (
    <>
      {unbanded.map((s) => (
        <Item key={`unbanded-${s.key}`}>
          {t("patient.trendsLegendNoBand", { channel: t(s.labelKey), scored: t(card.series[0].labelKey) })}
        </Item>
      ))}
      {truncated ? <Item>{t("patient.trendsLegendMarksTruncated")}</Item> : null}
      {thinned.map((s) => (
        <Item key={s.key}>
          {t("patient.trendsThinned", { channel: t(s.labelKey), kept: channels[s.key].points.length, total: channels[s.key].total_points })}
        </Item>
      ))}
    </>
  );
}

/** What the table view keeps of the legend: no swatches (the table has no bands or glyphs), but every
 *  note that says how far to trust the numbers — and what a mark row is: an alarm's FIRST detection. */
export function TrendNotes({ card, channels, truncated = false }) {
  const { t } = useI18n();
  return (
    <ul role="list" data-notes="" className={LIST}>
      <Item>{t("patient.trendsLegendAlarm")}</Item>
      <NoteItems card={card} channels={channels} truncated={truncated} />
    </ul>
  );
}

export function TrendLegend({ card, channels, source, truncated = false }) {
  const { t } = useI18n();
  const primary = channels[card.series[0].key] ?? null;
  const scored = Array.isArray(primary?.bands?.news2);
  return (
    // role="list": a list with its bullets removed (`list-none`) stops being one for VoiceOver.
    <ul role="list" data-legend="" className={LIST}>
      {scored ? (
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
      {/* ▲ is a finding's FIRST DETECTION for this patient (its `first_seen` stamp), not every
          alarm episode: the engine's active alerts never clear a kind today (O17). */}
      <Item><Glyph kind="alarm" /> {t("patient.trendsLegendAlarm")}</Item>
      <Item><Glyph kind="antibiotic" /> {t("patient.trendsMarkerAntibiotic")}</Item>
      <NoteItems card={card} channels={channels} truncated={truncated} />
    </ul>
  );
}
```

- [ ] **Step 5: The table** — Write `dashboard/src/live/screens/patient/trends/TrendTable.jsx` (fed the dialog's own parsed series and markers; valueless rows dropped; stable row keys; newest first, at one instant the later reading first; the engine's NEWS2 points, an empty cell for a channel NEWS2 does not score, "—" with `trendsPointsUnknownRowSr` for a NEWS2 reading the engine sent none for; `trendsNoData` when empty):

```jsx
// src/live/screens/patient/trends/TrendTable.jsx — the big chart as a table (spec §3.2, §7): every
// measurement the chart draws, newest first, with the ENGINE'S NEWS2 points for that reading (the
// endpoint's third column — printed, never looked up here), and each mark as a row of its own. It is
// handed the dialog's own parsed series and markers — the very arrays the SVG draws — so the two views
// hold the same numbers by construction; TrendModal.test.jsx holds them equal.
import React from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { Table } from "../../../ui/index.js";
import { cardTitle } from "./cards.js";
import { markText, pointsText, whenText } from "./trendText.js";

/** The table's rows, newest first. A reading with no value is not one (the chart draws no dot for it).
 *  At one instant a series' LATER reading comes first — it is the one the chart and the readout take —
 *  then the card's series in their order, then the marks.
 *
 *  A row's key is what it is — its series (or kind and label) and its instant — with a counter for the
 *  second and later row of the same: it does not move when a newer reading is added, so a poll adds a
 *  row instead of re-mounting the body (a position key would). */
function rowsOf(card, series, markers) {
  const seen = new Map();
  const keyed = (base) => {
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}#${n}`;
  };
  const rows = [
    ...card.series.flatMap((s, i) => (series[i]?.points ?? []).flatMap((p, j) => (
      Number.isFinite(p.value) && Number.isFinite(p.ms)
        ? [{ ms: p.ms, rank: i, order: j, key: keyed(`${s.key}-${p.iso}`), series: s, p }]
        : []
    ))),
    ...(markers ?? []).map((m, j) => ({ ms: m.ms, rank: card.series.length, order: j, key: keyed(`${m.kind}:${m.label}-${m.iso}`), mark: m })),
  ];
  return rows.sort((a, b) => b.ms - a.ms || a.rank - b.rank || b.order - a.order);
}

/** The NEWS2 cell. The engine's points where it sent them; for a NEWS2 channel it sent none for, a dash
 *  and — for a screen reader — the reason (the card's own split, X24, but worded for THIS reading: the
 *  card's sentence says "the last reading", which is true there and false in a row); for a channel NEWS2 does not
 *  score (MAP, lactate: the engine sent no bands), nothing at all — a dash there would read as a
 *  missing score. Never a comparison with a band edge. */
function PointsCell({ points, news2 }) {
  const { t } = useI18n();
  if (Number.isInteger(points)) return <td className="font-data">{pointsText(points)}</td>;
  if (!news2) return <td />;
  return (
    <td className="font-data">
      <span aria-hidden="true">{pointsText(points)}</span>
      <span className="sr-only">{t("patient.trendsPointsUnknownRowSr")}</span>
    </td>
  );
}

export function TrendTable({ card, channels, series, markers, hours }) {
  const { t } = useI18n();
  const two = card.series.length > 1;
  const rows = rowsOf(card, series, markers);
  if (rows.length === 0) return null;      // nothing to list: the dialog says so, not an empty captioned table
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
            <td className="font-data font-bold">{row.p.value}</td>
            <td>{t(row.series.unitKey)}</td>
            <PointsCell points={row.p.points} news2={Array.isArray(channels[row.series.key]?.bands?.news2)} />
            <td />
          </tr>
        )))}
      </tbody>
    </Table>
  );
}
```

- [ ] **Step 6: The dialog, whole** — Write `dashboard/src/live/screens/patient/trends/TrendModal.jsx` (Task 12's dialog as the lane built it, with the keyboard — the instants of drawable readings, one stop per instant, Alt/Ctrl/Meta left to the browser — the table view, which the cursor does not survive, the one announcement, and the opening focus on the pressed window option):

```jsx
// src/live/screens/patient/trends/TrendModal.jsx — one card's chart, large (spec §3.2): the window
// (6 h / 24 h / 3 days, each a read of its own), a readout of the measurement under the cursor, the
// marks and the legend — and the same numbers as a table (Grafik | Tablo).
//
// The cursor follows the mouse, and the arrow keys, Home and End when the chart has focus (the chart
// is an application to a screen reader, not an image — see TrendChart — and only a chart with a
// reading to step to takes the keys at all). The readout is drawn for the eye and HIDDEN from assistive
// technology; a screen reader hears it (`Announce`) when a KEYBOARD move changes what it says — never on
// a mouse hover, which would drown everything else the dialog says. The live region is keyed on its
// text, so a move to a stop that reads the same (the same minute and value), or → at the last stop,
// says nothing again.
//
// THE CURSOR IS AN INSTANT, NOT AN INDEX. The state is `{ ms, how }`: the instant of the reading the
// cursor is on, and who moved it ("mouse" | "key"). It is turned into an index at render, by
// `indexAtTime` over the series as it is NOW — a poll that slides the window drops readings off the
// front and moves every index, and a cursor held as an index would silently jump to a later reading
// while the clinician reads. If the reading has slid out of the window the cursor is gone with it.
// Switching to the table lets it go too: the chart is not on screen, and its readout is not for saying.
//
// It opens with focus on the pressed window option — what the dialog is showing — not on whichever
// control happens to come first.
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { hhmm } from "../../../i18n/dates.js";
import { Announce, Modal, Seg } from "../../../ui/index.js";
import { nameOf } from "../../common/BoardState.jsx";
import { cardTitle, channelsOf } from "./cards.js";
import { TrendChart } from "./TrendChart.jsx";
import { TrendLegend, TrendNotes } from "./TrendLegend.jsx";
import { TrendTable } from "./TrendTable.jsx";
import { indexAtTime, marksAtTime, parseMarkers, parsePoints, validWindow } from "./trendGeometry.js";
import { markBeside, valueBeside, whenText } from "./trendText.js";
import { measuredKeyOf, useTrends } from "./useTrends.js";

const WINDOWS = [
  { value: 6, key: "patient.trendsHours6" },
  { value: 24, key: "patient.trendsHours24" },
  { value: 72, key: "patient.trendsHours72" },
];

// The chart's height in pixels. While a window is being read the dialog holds an empty frame of the
// same height (`h-[280px]` — a literal, for Tailwind): without it the dialog shrinks, the window buttons
// jump, and a second click lands on the backdrop and closes the dialog.
const CHART_HEIGHT = 280;
const NO_VALUE = "—";

/** The drawable reading of a series nearest an instant, within `tolerance` milliseconds — the later one
 *  on a tie — or null. */
function readingNear(points, ms, tolerance) {
  let best = null;
  let distance = Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.value) || !Number.isFinite(p.ms)) continue;
    const d = Math.abs(p.ms - ms);
    if (d <= tolerance && d <= distance) {
      best = p;
      distance = d;
    }
  }
  return best;
}

/** "HH:MM · 132 /dəq", EVERY mark within a pixel after it — two alert kinds first detected on one
 *  reading are both named, each with its own time when that reads differently. A card with two series
 *  (pressure) names each and reads the other one AT that instant — "Sistolik AT 118 · MAP 80 mmHg",
 *  MAP being the vasopressor target — meaning the nearest reading within one pixel column (`msPerPx`,
 *  the tolerance the marks use): a MAP stamped seconds from the systolic is, on the chart, the same
 *  moment. When it reads at another minute it says so ("MAP 64 mmHg (10:17)") rather than borrow the
 *  systolic's time, and each number then keeps its own unit; otherwise the unit is written once when the
 *  series share it. "—" where a series has no reading then. A reading that arrived without a value
 *  prints "—", never "NaN". Everything printed is the engine's number. */
function readoutOf(t, card, series, at, marks, hours, msPerPx) {
  const named = card.series.length > 1;
  const shared = card.series.every((s) => s.unitKey === card.series[0].unitKey);
  const readings = card.series.map((s, i) => {
    const reading = i === 0 ? at : readingNear(series[i].points, at.ms, msPerPx);
    return Number.isFinite(reading?.value) ? reading : null;
  });
  const apart = readings.map((r) => r !== null && whenText(r.ms, hours) !== whenText(at.ms, hours));
  const unitEach = !shared || apart.some(Boolean);
  const parts = card.series.map((s, i) => {
    const reading = readings[i];
    if (reading === null) return [named ? t(s.labelKey) : null, NO_VALUE].filter(Boolean).join(" ");
    const value = [String(reading.value), unitEach ? t(s.unitKey) : null].filter(Boolean).join(" ");
    return [named ? t(s.labelKey) : null, valueBeside(value, reading.ms, at.ms, hours)].filter(Boolean).join(" ");
  });
  const unit = !unitEach && readings.some((r) => r !== null) ? ` ${t(card.series[0].unitKey)}` : "";
  return [whenText(at.ms, hours), `${parts.join(" · ")}${unit}`, ...marks.map((m) => markBeside(t, m, at.ms, hours))].join(" · ");
}

/** The keyboard's stops: the instants of the readings that can be drawn, in time order — two readings
 *  at one instant are ONE stop (the chart draws them in one column). */
function stopsOf(points) {
  const out = [];
  for (const p of points) {
    if (Number.isFinite(p.value) && Number.isFinite(p.ms) && out[out.length - 1] !== p.ms) out.push(p.ms);
  }
  return out;
}

/** The instant a key moves the cursor to, or null for any other key. From no cursor (or one whose
 *  reading has slid out of the window) → the first stop, ← the last. */
function step(key, stops, ms) {
  if (stops.length === 0) return null;
  const at = ms === null ? -1 : stops.indexOf(ms);
  if (key === "Home") return stops[0];
  if (key === "End") return stops[stops.length - 1];
  if (key === "ArrowRight") return at < 0 ? stops[0] : stops[Math.min(at + 1, stops.length - 1)];
  if (key === "ArrowLeft") return at < 0 ? stops[stops.length - 1] : stops[Math.max(at - 1, 0)];
  return null;
}

export function TrendModal({ card, patient, bed, onClose }) {
  const { t } = useI18n();
  const hintId = useId();
  const controls = useRef(null);
  const [hours, setHours] = useState(24);
  const [view, setView] = useState("graph");
  const [cursor, setCursor] = useState(null);   // { ms, how: "mouse" | "key" } — an instant, see the header
  const [plotWidth, setPlotWidth] = useState(0);
  const trends = useTrends(patient.patient_id, hours, measuredKeyOf(patient.measuredAt));
  // Parsed once per answer, not on every render of a mouse move. The table is handed these very arrays.
  const { channels, series, markers, stops } = useMemo(() => {
    const byKey = channelsOf(trends.data);
    const drawn = card.series.map((s) => ({ key: s.key, color: s.color, hollow: s.hollow, points: parsePoints(byKey[s.key]?.points) }));
    return { channels: byKey, series: drawn, markers: parseMarkers(trends.data?.markers), stops: stopsOf(drawn[0].points) };
  }, [card, trends.data]);
  const primary = channels[card.series[0].key] ?? null;
  const sinceMs = Date.parse(trends.data?.since);
  const untilMs = Date.parse(trends.data?.until);
  const title = cardTitle(t, card);
  const index = cursor ? indexAtTime(series[0].points, cursor.ms) : -1;
  const at = index >= 0 ? series[0].points[index] : null;
  const msPerPx = plotWidth > 0 ? (untilMs - sinceMs) / plotWidth : 0;   // one pixel column of the plot
  const marks = at ? marksAtTime(markers, at.ms, msPerPx) : [];
  const readout = at ? readoutOf(t, card, series, at, marks, hours, msPerPx) : null;
  // The readings the chart draws — a reading that arrived without a value is not one.
  const count = series.reduce((n, s) => n + s.points.filter((p) => Number.isFinite(p.value)).length, 0);
  // The chart takes the keys (and is a tab stop) only while there is a stop to step to, on a chart that
  // is drawn: keys that do nothing are a trap, not a control. The cursor follows the card's FIRST series.
  const keyed = stops.length > 0 && validWindow(sinceMs, untilMs);
  const truncated = trends.data?.markers_truncated === true;

  // After the kit Modal's own effect (a child's runs first) put focus on the body's first control.
  useEffect(() => { controls.current?.querySelector("[aria-pressed='true']")?.focus(); }, []);

  const choose = (value) => {
    setHours(value);
    setCursor(null);
  };
  // The table has no cursor, and `Announce` must not speak a readout for a chart nobody can see.
  const chooseView = (value) => {
    setView(value);
    setCursor(null);
  };
  // The chart reports an index into the series it drew; the dialog keeps the instant. Nothing changed
  // → the same state back, so a mouse move over one reading re-renders nothing.
  const moveCursor = (picked, how) => {
    const ms = picked === null ? null : series[0].points[picked]?.ms ?? null;
    setCursor((c) => {
      if (ms === null) return c === null ? c : null;
      return c !== null && c.ms === ms && c.how === how ? c : { ms, how };
    });
  };
  const onKeyDown = (event) => {
    // Alt+← is the browser's Back and Ctrl+Home the top of the page: not the chart's to take.
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const next = step(event.key, stops, at ? at.ms : null);
    if (next === null) return;
    event.preventDefault();
    setCursor({ ms: next, how: "key" });
  };

  return (
    <Modal open wide title={[bed, nameOf(patient, t), title].filter(Boolean).join(" · ")} onClose={onClose}>
      <div ref={controls} className="flex flex-wrap items-center gap-2">
        <Seg label={t("patient.trendsHoursLabel")} value={hours} onChange={choose}
          options={WINDOWS.map((w) => ({ value: w.value, label: t(w.key) }))} />
        <Seg label={t("patient.trendsViewLabel")} value={view} onChange={chooseView}
          options={[{ value: "graph", label: t("patient.trendsGraph") }, { value: "table", label: t("patient.trendsTable") }]} />
      </div>
      {trends.unreadable ? (
        <p className="m-0 mt-2 text-12 font-semibold text-att-ink">
          {t("patient.trendsUnreadable", { time: trends.lastOkAt ? hhmm(trends.lastOkAt) : "—" })}
        </p>
      ) : null}
      {trends.data && view === "graph" ? (
        <>
          {count === 0 ? (
            <p data-no-data="" className="m-0 mt-3 min-h-[1.5em] text-13 text-mute">{t("patient.trendsNoData")}</p>
          ) : (
            <p data-readout="" aria-hidden="true" className="m-0 mt-3 min-h-[1.5em] font-data text-13 font-semibold text-ink">
              {readout ?? t("patient.trendsReadoutIdle")}
            </p>
          )}
          <TrendChart
            series={series} bands={primary?.bands ?? null} markers={markers} sinceMs={sinceMs} untilMs={untilMs}
            hours={hours} height={CHART_HEIGHT} big label={t("patient.trendsChartLabel", { channel: title, hours, count })}
            cursor={index >= 0 ? index : null} onPlot={setPlotWidth} onCursor={moveCursor}
            onKeyDown={keyed ? onKeyDown : undefined} describedBy={keyed ? hintId : undefined}
            roleDescription={t("patient.trendsChartRole")}
          />
          {keyed ? <p id={hintId} className="m-0 mt-1 text-11 text-mute">{t("patient.trendsKeysHint")}</p> : null}
          <TrendLegend card={card} channels={channels} source={trends.data.bands_source} truncated={truncated} />
        </>
      ) : null}
      {trends.data && view === "table" ? (
        <>
          {count === 0 ? <p data-no-data="" className="m-0 mt-3 text-13 text-mute">{t("patient.trendsNoData")}</p> : null}
          <TrendTable card={card} channels={channels} series={series} markers={markers} hours={hours} />
          <TrendNotes card={card} channels={channels} truncated={truncated} />
        </>
      ) : null}
      {!trends.data ? (
        <>
          <p aria-hidden="true" className="m-0 mt-3 min-h-[1.5em] font-data text-13" />
          <div data-chart-frame="" className="mt-3 flex h-[280px] items-center justify-center">
            {trends.loading ? <p className="m-0 text-12.5 text-mute">{t("patient.trendsLoading")}</p> : null}
          </div>
        </>
      ) : null}
      <Announce text={cursor?.how === "key" && readout ? readout : ""} />
    </Modal>
  );
}
```

- [ ] **Step 7: Green, then the gate.**

```bash
cd /c/tmp/g2-vital/dashboard
npx vitest run src/live/screens/patient/trends/ src/reachable.test.js 2>&1 | grep -E "Test Files|Tests |×"
```
Expected: no `×`; `Test Files  8 passed (8)` (the folder's seven + reachable), `Tests  158 passed (158)` (155 in the folder: useTrends 17, news2Tone 2, TrendCard 26, trendGeometry 31, TrendChart 22, TrendModal 53, trendText 4; reachable 3). Then the suite — **88 / 2333** in plan order (the lane alone, `372e781`: 88 / 2330) — and the build.

- [ ] **Step 8: Commit.**

```bash
cd /c/tmp/g2-vital
git add dashboard/src/live/screens/patient/trends/trendText.js dashboard/src/live/screens/patient/trends/TrendTable.jsx dashboard/src/live/screens/patient/trends/TrendModal.jsx dashboard/src/live/screens/patient/trends/TrendModal.test.jsx dashboard/src/live/screens/patient/trends/TrendChart.jsx
git status --short && git diff --cached --stat
git commit -m "feat(patient): the big chart by keyboard, said once, and as a table" -m "The keyboard chart is an application with a role description (X28), one tab stop with its keys described; arrows, Home and End walk the instants of the drawable readings, one stop per instant, Alt/Ctrl/Meta left to the browser; a keyboard move is announced once, a hover never. Grafik | Tablo: the kit Table fed the same parsed series and markers the SVG draws, newest first, the engine's NEWS2 points per reading, each mark a row of its own, the legend's notes under both views (X29). trendText.js shared by the axis, the readout and the table: a mark, and a MAP read beside systolic, carry their own time when it reads differently (X30). The dialog opens with focus on the pressed window option.

red: TrendModal 39 failed | 14 passed (53); trendText import unresolved; TrendChart 1 failed; trendGeometry 1 failed (a valueless twin)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14a: The engine clears the last range — `{"baselines": {}}` over a charted profile

**Done in the backend lane** (commits `31b6790`, `a487450` and `e933ca1`); the blocks below are that code.

**Amendment of 2026-10-20 (O4, the user's choice: explicit clearing).** An engine task. Its Steps 1–5 touch no file another task touches; its Steps 6–8 edit Task 4's `test_trends.py`, so it runs after Task 4, in its own worktree, and must land before Task 15. Task 14's form sends `{"baselines": {}}` when every row is emptied over a charted set; today the engine refuses that unless a comorbidity or a baseline SOFA is also charted (api/clinical.py:257–259, X15), so a range charted in error could never be taken away when it is the last thing charted — and it would keep quietening this patient's alarms.

The rule: a payload whose `baselines` key is present and is an empty object, sent while a profile exists (`base is not None`), clears every range and is accepted even when nothing else is charted; the comorbidities and the baseline SOFA come from `base` as before (the door merges). "profil boş olamaz" stays for an empty profile made from nothing and for a payload with no `baselines` key.

What planning found on the way: the replay. `rehydrate._replay_profile` (api/rehydrate.py:61) reads each `profile` row with no `base`. The clearing row's audit payload is an empty profile (`{"comorbidities": [], "baselines": {}, "baseline_sofa": null}`), so read from nothing it is refused, skipped silently — and the profile before it, ranges and all, survives the restart. The replay now reads each row over what it has restored so far, as the live door reads over what is charted; the payloads are written whole (`profile_to_payload` names all three keys), so for every row ever written this reads exactly as before.

The door itself (api/app.py:608–640) is unchanged and on this path does what it always did: sets the profile, appends the `profile` audit row with `charted_by`, republishes the board. It re-scores nothing: the alerts standing are the last reading's until the next one (`Engine.ingest`, pipeline.py:51). A test pins that the next reading is judged without the range; the wording that claims more is open item O12.

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/clinical.py`, `homunculus-engine/src/homunculus/api/rehydrate.py`
- Test: `homunculus-engine/tests/test_api_patient_profile.py` (27 → 39), `homunculus-engine/tests/test_trends.py` (23 → 24; Steps 6–8 need Task 4)

- [ ] **Step 1: The tests.** Edit `homunculus-engine/tests/test_api_patient_profile.py` — replace its last three lines:

```python
    r = client.put("/clinical/bed-7/profile",
                   json={"comorbidities": [], "baseline_sofa": 1}, headers=AUTH)
    assert r.json()["comorbidities"] == []
```

with:

```python
    r = client.put("/clinical/bed-7/profile",
                   json={"comorbidities": [], "baseline_sofa": 1}, headers=AUTH)
    assert r.json()["comorbidities"] == []


# --- Clearing the patient's own normal (G2 slice 1, O4) -------------------------------------------
# The trend screen's form writes the whole baseline set. A range charted in error keeps quietening
# this patient's alarms until someone takes it away — so it must be removable even when it is the
# last thing charted: `{"baselines": {}}` over a charted profile clears every range. From nothing
# there is nothing to clear, and an empty profile is still refused.

BASELINES_ONLY = {"baselines": {"heart_rate": {"low": 125, "high": 140}}}


def test_an_empty_baseline_set_over_a_charted_profile_clears_every_range():
    base = profile_from_payload("bed-7", BASELINES_ONLY)
    cleared = profile_from_payload("bed-7", {"baselines": {}}, base)
    assert cleared.baselines == {}
    assert cleared.comorbidities == frozenset() and cleared.baseline_sofa is None


def test_clearing_the_ranges_keeps_the_comorbidities_and_the_baseline_sofa():
    base = profile_from_payload("bed-7", {**CHRONIC_AF, "baseline_sofa": 2})
    cleared = profile_from_payload("bed-7", {"baselines": {}}, base)
    assert cleared.baselines == {}
    assert cleared.comorbidities == frozenset({"chronic_af"})
    assert cleared.baseline_sofa == 2


def test_from_nothing_an_empty_baseline_set_is_still_refused():
    with pytest.raises(Exception, match="boş olamaz"):
        profile_from_payload("bed-7", {"baselines": {}})


def test_without_a_baselines_key_a_payload_still_cannot_empty_a_profile():
    base = profile_from_payload("bed-7", {"comorbidities": ["copd"]})
    with pytest.raises(Exception, match="boş olamaz"):
        profile_from_payload("bed-7", {"comorbidities": []}, base)


def test_the_door_clears_the_last_range_and_audits_it(client):
    assert _profile(client, "bed-7", BASELINES_ONLY).status_code == 200
    r = _profile(client, "bed-7", {"baselines": {}})
    assert r.status_code == 200, r.text
    assert r.json() == {"patient_id": "bed-7", "comorbidities": [], "baselines": {}, "baseline_sofa": None}
    rows = [x for x in client.get("/audit", headers=AUTH).json()["records"] if x["event_type"] == "profile"]
    assert [row["payload"]["baselines"] for row in rows] == [{"heart_rate": {"low": 125.0, "high": 140.0}}, {}]
    assert rows[-1]["payload"]["charted_by"] == "tenant-token"


def test_once_cleared_the_next_pulse_is_judged_like_anyone_elses():
    """The point of clearing: the range stops quietening the alarm. The PUT itself re-scores
    nothing — the alerts standing are the last reading's — so it is the NEXT reading that the
    engine judges without the range."""
    from datetime import timedelta
    from homunculus.canonical import Observation
    from homunculus.pipeline import Engine

    engine = Engine()
    engine.set_profile(profile_from_payload("bed-7", BASELINES_ONLY))
    first = Observation("bed-7", SignalCode.HEART_RATE, 132, "/min", WHEN, "dev")
    assert {a.kind: a for a in engine.ingest(first, now=WHEN)}["news2"].downgraded is True

    engine.set_profile(profile_from_payload("bed-7", {"baselines": {}}, engine.profile("bed-7")))
    later = WHEN + timedelta(minutes=5)
    second = Observation("bed-7", SignalCode.HEART_RATE, 132, "/min", later, "dev")
    news2 = {a.kind: a for a in engine.ingest(second, now=later)}["news2"]
    assert news2.downgraded is False
    assert news2.urgency == "soon"


def test_a_cleared_set_stays_cleared_after_a_restart(client):
    """The replay reads the profile rows in order. The clearing row is an empty profile: read
    from nothing it would be refused and skipped — and the range the clinician removed would
    come back with the next deploy, quietening alarms nobody asked to quieten."""
    from homunculus.api.ackstore import AckStore
    from homunculus.api.audit import AuditRecord
    from homunculus.api.rehydrate import rehydrate
    from homunculus.pipeline import Engine

    _profile(client, "bed-7", BASELINES_ONLY)
    assert _profile(client, "bed-7", {"baselines": {}}).status_code == 200
    records = client.get("/audit", headers=AUTH).json()["records"]
    fresh = Engine()
    rehydrate(fresh, AckStore(), [AuditRecord(**r) for r in records])
    assert fresh.profile("bed-7") is not None
    assert fresh.profile("bed-7").baselines == {}
```

(A pulse of 132 scores 3 — a single red parameter — so NEWS2 raises a finding on its own; inside a charted 125–140 the patient-relative layer downgrades it, `rules/patient_relative.py` `_adjust_news2`.)

- [ ] **Step 2: Run them — red.**

```bash
cd /c/tmp/g2-vital/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_api_patient_profile.py 2>&1 | grep -E "^FAILED|passed|failed"
```
Expected: `4 failed, 30 passed` — `test_an_empty_baseline_set_over_a_charted_profile_clears_every_range` and `test_once_cleared_the_next_pulse_is_judged_like_anyone_elses` (`ClinicalEntryError: profil boş olamaz …`), `test_the_door_clears_the_last_range_and_audits_it` and `test_a_cleared_set_stays_cleared_after_a_restart` (`assert 400 == 200`). The three that pass are the refusals that must stay, and the merge that already keeps the comorbidities.

- [ ] **Step 3: The parser.** Edit `homunculus-engine/src/homunculus/api/clinical.py` — replace:

```python
    if not comorbidities and not baselines and baseline_sofa is None:
        raise ClinicalEntryError(
```

with:

```python
    # An empty set sent over a charted profile is a clinician taking every range away: the trend
    # screen's form writes the whole set, and a range charted in error must be removable even when
    # it is the last thing charted. From nothing there is nothing to clear, and an empty profile is
    # still refused — as is one emptied by a payload that does not name the baselines at all. A
    # present key that is null or {} is a clear (the merge above reads it so): absent keeps,
    # null/{} clears, anything else that is not an object was refused above.
    clearing = base is not None and "baselines" in payload and not raw_baselines
    if not comorbidities and not baselines and baseline_sofa is None and not clearing:
        raise ClinicalEntryError(
```

Run Step 2's command again. Expected: `1 failed, 33 passed` — the restart test, with `assert {<SignalCode.HEART_RATE: 'heart_rate'>: BaselineRange(low=125.0, high=140.0)} == {}`: the live door clears, and the replay brings the range back.

- [ ] **Step 4: The replay.** Edit `homunculus-engine/src/homunculus/api/rehydrate.py` — replace:

```python
    try:
        engine.set_profile(profile_from_payload(rec.patient_id, rec.payload))
    except (ValueError, TypeError, KeyError):
```

with:

```python
    # Read over what the replay has restored so far, as the live door read it over what was
    # charted. A row that cleared the last range is an empty profile, refused when read from
    # nothing — and the range the clinician removed would come back with the next deploy.
    try:
        engine.set_profile(profile_from_payload(rec.patient_id, rec.payload,
                                                engine.profile(rec.patient_id)))
    except (ValueError, TypeError, KeyError):
```

- [ ] **Step 5: Green, and everything that replays a profile.**

```bash
cd /c/tmp/g2-vital/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_api_patient_profile.py 2>&1 | tail -1
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_api_patient_profile.py tests/test_rehydrate.py tests/test_alarm_quality.py tests/test_api_persistence.py tests/test_first_seen_persistence.py tests/test_pipeline.py 2>&1 | tail -1
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -1
```
Expected: `34 passed`; `69 passed` (34 + `test_rehydrate.py` 6 + `test_alarm_quality.py` 18 + `test_api_persistence.py` 2 + `test_first_seen_persistence.py` 3 + `test_pipeline.py` 6); the no-DB suite **2103 passed, 650 skipped** when merged in plan order after Task 13 (*derived*) — in any other order, the base plus the merged tasks' deltas, these steps' being 7. Task 15 runs these files against Postgres and on Python 3.14.

- [ ] **Step 6: A bound that is not a finite number — tests first** (the Task 4 quality review, 2026-10-20). `float(span["low"])` reads `"nan"` and `"inf"`, and `low > high` is False with a NaN, so a NaN bound passes both checks: `bands.own_normal` then carries NaN, `json.dumps(allow_nan=False)` refuses every trends read for that patient (a 500), and the replay brings it back after every restart. Edit `homunculus-engine/tests/test_api_patient_profile.py` — replace:

```python
    assert fresh.profile("bed-7") is not None
    assert fresh.profile("bed-7").baselines == {}
```

with:

```python
    assert fresh.profile("bed-7") is not None
    assert fresh.profile("bed-7").baselines == {}


@pytest.mark.parametrize("bad", ["nan", "inf", "-inf", float("nan"), float("inf")])
def test_a_bound_that_is_not_a_finite_number_is_refused(bad):
    """float() reads "nan" and "inf", and `low > high` is False with a NaN — so a NaN bound slipped
    past both checks, reached every trends read for this patient (JSON refuses NaN: a 500) and came
    back with every replay of the audit. Refused as `_value` refuses a charted one."""
    with pytest.raises(Exception, match="geçersiz sayı"):
        profile_from_payload("bed-7", {"baselines": {"heart_rate": {"low": bad, "high": 115}}})
    with pytest.raises(Exception, match="geçersiz sayı"):
        profile_from_payload("bed-7", {"baselines": {"heart_rate": {"low": 100, "high": bad}}})
```

And one trends test — Edit `homunculus-engine/tests/test_trends.py` (Task 4's file; this step needs it) — replace:

```python
def test_a_now_without_a_zone_is_refused():
    with pytest.raises(ValueError, match="time zone"):
        patient_trends(Engine(), InMemoryAuditLog(), hospital=HOSPITAL, patient_id="S-001",
                       hours=24, now=datetime(2026, 10, 19, 9, 0))
```

with:

```python
def test_a_now_without_a_zone_is_refused():
    with pytest.raises(ValueError, match="time zone"):
        patient_trends(Engine(), InMemoryAuditLog(), hospital=HOSPITAL, patient_id="S-001",
                       hours=24, now=datetime(2026, 10, 19, 9, 0))


def test_a_profile_row_with_a_bound_that_is_not_a_number_never_reaches_the_answer():
    """An audit row written before the profile door refused non-finite bounds replays through
    `rehydrate`. Refused there now, the row is skipped: the patient has no own normal from it (with
    an earlier profile row, the replay keeps that earlier profile) — not a NaN band that JSON
    cannot carry (Starlette's JSONResponse has allow_nan=False)."""
    from homunculus.api.ackstore import AckStore
    from homunculus.api.audit import AuditRecord
    from homunculus.api.rehydrate import rehydrate

    engine = _engine((SignalCode.HEART_RATE, 84, 30))
    row = AuditRecord(id=1, ts=NOW.isoformat(), tenant=HOSPITAL, event_type="profile", patient_id="S-001",
                      subject="", payload={"baselines": {"heart_rate": {"low": "nan", "high": 115}}})
    rehydrate(engine, AckStore(), [row])
    answer = _trends(engine)
    json.dumps(answer, allow_nan=False)
    assert _channel(answer, "heart_rate")["bands"]["own_normal"] is None
```

```bash
cd /c/tmp/g2-vital/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_api_patient_profile.py tests/test_trends.py 2>&1 | grep -E "^FAILED|passed|failed"
```
Expected: `6 failed, 57 passed` — the five `test_a_bound_that_is_not_a_finite_number_is_refused[…]` (`DID NOT RAISE`) and the trends test (`ValueError: Out of range float values are not JSON compliant`).

- [ ] **Step 7: The check, as `_value` makes it.** Edit `homunculus-engine/src/homunculus/api/clinical.py` — replace:

```python
        except (KeyError, TypeError, ValueError):
            raise ClinicalEntryError(f"{name}: low ve high sayı olmalı") from None
        if low > high:
```

with:

```python
        except (KeyError, TypeError, ValueError):
            raise ClinicalEntryError(f"{name}: low ve high sayı olmalı") from None
        if any(v != v or v in (float("inf"), float("-inf")) for v in (low, high)):   # NaN / inf
            # "nan" and "inf" parse as floats, and `low > high` is False with a NaN: a NaN bound would
            # reach every trends read for this patient (JSON refuses it) and replay with the audit.
            raise ClinicalEntryError(f"{name}: geçersiz sayı")
        if low > high:
```

- [ ] **Step 8: Green, again.** Run Step 6's command, then Step 5's three. Expected: `63 passed`; then `39 passed`; `74 passed` (39 + 6 + 18 + 2 + 3 + 6); the no-DB suite **2109 passed, 650 skipped** in plan order after Task 13 (*derived*); these steps' delta is 6.

- [ ] **Step 9: The Task 14a quality review's follow-ups** (the backend lane's commits `a487450` and `e933ca1`). A bool is an int in Python, so `{"low": true, "high": 140}` charted a 1–140 range nobody typed — refused, as `_baseline_sofa` refuses a bool. Only `null` and `{}` read as "no ranges": `[]`, `""`, `0` and `false` are refused with "baselines bir nesne olmalı" rather than read as empty, because a clinical range must not be cleared by junk. The explicit clear is pinned: `null` clears like `{}`, a clear over a profile with no ranges changes nothing, and with `comorbidities: []` it may empty the profile. Four Edits; Step 3's `clearing` line above already reads as the lane wrote it.

The docstring names the one way to take ranges away — in `homunculus-engine/src/homunculus/api/clinical.py` replace:

```python
    the kind of quiet harm this system must not do.
```

with:

```python
    the kind of quiet harm this system must not do. The one way to take ranges away is to name
    them: `{"baselines": {}}` (or null) over an existing profile is an explicit clear of every
    range — and, combined with `comorbidities: []`, it may empty the profile entirely.
```

Only null and {} read as no ranges — in `homunculus-engine/src/homunculus/api/clinical.py` replace:

```python
    raw_baselines = payload.get("baselines") or {}
```

with:

```python
    # Only null and {} are "no ranges". Anything else that is not an object (`[]`, `""`, `0`, `false`)
    # is refused rather than read as empty: a clinical range must not be cleared by junk.
    raw_baselines = payload.get("baselines")
    if raw_baselines is None:
        raw_baselines = {}
```

A boolean bound is refused — in `homunculus-engine/src/homunculus/api/clinical.py` replace:

```python
            raise ClinicalEntryError(f"{name}: aralık {{low, high}} biçiminde olmalı")
        try:
```

with:

```python
            raise ClinicalEntryError(f"{name}: aralık {{low, high}} biçiminde olmalı")
        if isinstance(span.get("low"), bool) or isinstance(span.get("high"), bool):
            # A bool is an int in Python, as `_baseline_sofa` notes: `true` would chart a bound of 1 —
            # a range nobody typed, inside which the layer would downgrade this patient's findings.
            raise ClinicalEntryError(f"{name}: low ve high sayı olmalı")
        try:
```

And the tests that pin them, at the end of the file — in `homunculus-engine/tests/test_api_patient_profile.py` replace:

```python
        profile_from_payload("bed-7", {"baselines": {"heart_rate": {"low": 100, "high": bad}}})
```

with:

```python
        profile_from_payload("bed-7", {"baselines": {"heart_rate": {"low": 100, "high": bad}}})


@pytest.mark.parametrize("side", ["low", "high"])
@pytest.mark.parametrize("bad", [True, False])
def test_a_boolean_bound_is_refused(side, bad):
    """A bool is an int in Python, so `{"low": true, "high": 140}` charted a 1–140 range nobody
    typed — inside which the patient-relative layer would downgrade heart-rate findings. Refused as
    `_baseline_sofa` refuses a bool."""
    span = {"low": 100, "high": 140, side: bad}
    with pytest.raises(Exception, match="low ve high sayı olmalı"):
        profile_from_payload("bed-7", {"baselines": {"heart_rate": span}})


def test_the_door_refuses_a_boolean_bound_and_charts_nothing(client):
    r = _profile(client, "bed-7", {"baselines": {"heart_rate": {"low": True, "high": 140}}})
    assert r.status_code == 400
    assert "sayı olmalı" in r.json()["detail"]
    rows = [x for x in client.get("/audit", headers=AUTH).json()["records"] if x["event_type"] == "profile"]
    assert rows == []


def test_clearing_the_ranges_and_the_comorbidities_together_may_empty_the_profile():
    """The clear is explicit, and nothing says it may not be the whole profile: a COPD-only profile
    with no range, sent `comorbidities: []` and `baselines: {}`, is accepted and comes out empty."""
    base = profile_from_payload("bed-7", {"comorbidities": ["copd"]})
    emptied = profile_from_payload("bed-7", {"comorbidities": [], "baselines": {}}, base)
    assert emptied.comorbidities == frozenset()
    assert emptied.baselines == {}
    assert emptied.baseline_sofa is None


def test_clearing_a_profile_that_has_no_ranges_is_accepted_and_changes_nothing(client):
    """A repeated PUT is idempotent: the result is the same, and each PUT is one more audit row."""
    assert _profile(client, "bed-7", {"comorbidities": ["copd"]}).status_code == 200
    first = _profile(client, "bed-7", {"baselines": {}})
    second = _profile(client, "bed-7", {"baselines": {}})
    assert first.status_code == second.status_code == 200
    expected = {"patient_id": "bed-7", "comorbidities": ["copd"], "baselines": {}, "baseline_sofa": None}
    assert first.json() == second.json() == expected
    rows = [x for x in client.get("/audit", headers=AUTH).json()["records"] if x["event_type"] == "profile"]
    assert [row["payload"]["comorbidities"] for row in rows] == [["copd"], ["copd"], ["copd"]]
    assert [row["payload"]["baselines"] for row in rows] == [{}, {}, {}]


def test_a_null_baseline_set_over_a_charted_profile_clears_like_an_empty_one():
    """The contract is: an absent `baselines` key keeps the ranges, a null or empty one clears them
    (the merge already read null as empty, so it cleared whenever anything else was charted — and was
    refused as 'empty' only when the ranges were the last thing charted)."""
    base = profile_from_payload("bed-7", BASELINES_ONLY)
    cleared = profile_from_payload("bed-7", {"baselines": None}, base)
    assert cleared.baselines == {}
    assert cleared.comorbidities == frozenset() and cleared.baseline_sofa is None


def test_from_nothing_a_null_baseline_set_is_still_refused():
    with pytest.raises(Exception, match="boş olamaz"):
        profile_from_payload("bed-7", {"baselines": None})


def test_the_door_reads_a_null_baseline_set_as_a_clear(client):
    assert _profile(client, "bed-7", BASELINES_ONLY).status_code == 200
    r = _profile(client, "bed-7", {"baselines": None})
    assert r.status_code == 200, r.text
    assert r.json() == {"patient_id": "bed-7", "comorbidities": [], "baselines": {}, "baseline_sofa": None}


# Only null and {} clear. A clinical range must not be taken away by junk: any other value that is
# not an object — `[]`, `""`, `0`, `false` — used to read as "empty" through `or {}`, and so cleared.

@pytest.mark.parametrize("junk", [[], "", 0, False])
def test_a_baseline_set_that_is_not_an_object_is_refused_and_clears_nothing(junk):
    base = profile_from_payload("bed-7", {**CHRONIC_AF, "baseline_sofa": 2})
    with pytest.raises(Exception, match="baselines bir nesne olmalı"):
        profile_from_payload("bed-7", {"baselines": junk}, base)
    with pytest.raises(Exception, match="baselines bir nesne olmalı"):
        profile_from_payload("bed-7", {"baselines": junk})


@pytest.mark.parametrize("empty", [None, {}])
def test_null_and_an_empty_object_still_clear(empty):
    base = profile_from_payload("bed-7", BASELINES_ONLY)
    assert profile_from_payload("bed-7", {"baselines": empty}, base).baselines == {}


def test_the_door_refuses_a_baseline_set_that_is_not_an_object_and_keeps_the_ranges(client):
    assert _profile(client, "bed-7", BASELINES_ONLY).status_code == 200
    r = _profile(client, "bed-7", {"baselines": []})
    assert r.status_code == 400
    assert "baselines bir nesne olmalı" in r.json()["detail"]
    rows = [x for x in client.get("/audit", headers=AUTH).json()["records"] if x["event_type"] == "profile"]
    assert [row["payload"]["baselines"] for row in rows] == [{"heart_rate": {"low": 125.0, "high": 140.0}}]
```

Run Step 6's command again and Step 5's three. Expected: `86 passed` (56 + 30); `56 passed`; `91 passed` (56 + 6 + 18 + 2 + 3 + 6); the no-DB suite **2126 passed, 650 skipped** in plan order after Task 13 (*derived* — measured 2130 / 650 with Task 16 in place too); this task's delta is 30.

- [ ] **Step 10: Commit.**

```bash
cd /c/tmp/g2-vital
git add homunculus-engine/src/homunculus/api/clinical.py homunculus-engine/src/homunculus/api/rehydrate.py homunculus-engine/tests/test_api_patient_profile.py homunculus-engine/tests/test_trends.py
git status --short && git diff --cached --stat
git commit -m "fix(engine): an empty baseline set over a charted profile clears every range — and stays cleared after a restart; a bound that is not a finite number is refused" -m "profile_from_payload: {\"baselines\": {}} with a profile already charted is a clinician taking every range away, accepted even when nothing else is charted; comorbidities and baseline SOFA kept from the charted profile. Still refused: an empty profile from nothing, and one emptied by a payload without a baselines key. rehydrate reads each profile row over what it has restored so far, as the live door does: the clearing row is an empty profile, and read from nothing it was refused and skipped, so the cleared range came back with the next deploy. The PUT re-scores nothing; the next reading is judged without the range (pinned).

A NaN/inf bound (float() reads "nan", and low > high is False with a NaN) is refused as _value refuses a charted value: it would have reached every trends read (JSON refuses NaN: a 500) and replayed with the audit.

red: test_api_patient_profile 4 failed (profil boş olamaz / 400); then 1 (the replay brought the range back); then 6 (five NaN/inf bounds accepted; the trends answer not JSON)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 14: The patient's own normal — the form

Spec §3.3, §3.4 and D4, with X8, X14, X15, X17. For a `clinical.chart` holder the box's header offers "Xəstənin norması…" — once the trends have answered and while they are readable, because the engine replaces the whole baseline set with what is sent and the form must open on the set it replaces. Five rows (pulse, respiration, SpO₂, systolic, temperature — `BASELINE_KEYS`, held equal to api/clinical.py `BASELINE_SIGNALS` by a test that reads that file), each "alt" / "üst", prefilled from `bands.own_normal`. Held inline before anything is sent: one side without the other, a bound that is not a number (a decimal comma is read as a point), low above high. Every filled pair is sent as `{baselines}` alone; an emptied pair is not sent and the engine deletes it — the form says so, and says the comorbidities are not touched. All pairs empty over a charted set (an `own_normal` band on any of the five): Save is offered, the text under the fields says it deletes every charted range, `{"baselines": {}}` is sent — which Task 14a's engine takes as "clear every range" — and the toast says the ranges are deleted and the next reading is judged without them (the user's choice for O4, 2026-10-20). All pairs empty with nothing charted: Save is `aria-disabled` and says why; nothing is sent. 200 → toast "…yadda saxlanıldı…", the trends read again, the form closes, no alert anywhere. 400 → the engine's reason on the toast named after the bed, the form stays open. 403 → the toast says the right is gone, the form closes. No answer → `mayHaveLanded`: the trends read again, the clinician is told to look at the band, the form closes. While in flight: Save `busy`, the fields `readOnly`, the dialog will not close, "…yadda saxlanılır…" said once.

**Files:**
- Create: `trends/BaselineForm.jsx`, `trends/BaselineForm.test.jsx`
- Modify: `trends/TrendsBox.jsx`, `PatientScreen.test.jsx`, `src/live/i18n/strings/patient.js` (two keys)
- The tests stub the API, so this task builds without Task 14a; a real engine refuses the clear until 14a has landed.

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
    expect(dialog()).toHaveTextContent("Boş saxlanılan aralıq silinir. Yanaşı xəstəliklər və bazal SOFA dəyişmir.");
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
    expect(within(row("temperature")).getByText("ədəd daxil edin")).toBeInTheDocument();
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

  it("every row emptied over a charted set: Save is offered, says it deletes every range, and sends an empty set", async () => {
    const { api } = await open({ own: { heart_rate: { low: 100, high: 115 } } });
    type("heart_rate", "low", "");
    type("heart_rate", "high", "");
    const button = within(dialog()).getByRole("button", { name: "Yadda saxla" });
    expect(button).not.toHaveAttribute("aria-disabled");
    expect(dialog()).toHaveTextContent("Bütün sətirlər boşdur: «Yadda saxla» bu xəstənin daxil edilmiş bütün aralıqlarını silir.");
    expect(dialog()).not.toHaveTextContent("Göndəriləcək aralıq yoxdur");
    await save();
    expect(api.putPatientProfile).toHaveBeenCalledWith("S-001", { baselines: {} });
  });

  it("a clear the engine took: the confirmation says every range is deleted, the trends are read again, the form closes", async () => {
    const { onClose, onSaved } = await open({ own: { heart_rate: { low: 100, high: 115 } } });
    type("heart_rate", "low", "");
    type("heart_rate", "high", "");
    await save();
    expect(screen.getAllByText("Xəstənin bütün aralıqları silindi; növbəti ölçmə onlarsız qiymətləndiriləcək.").length).toBeGreaterThan(0);
    expect(screen.queryByText("Xəstənin norması yadda saxlanıldı; mühərrik yenidən qiymətləndirdi.")).toBeNull();
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("with nothing charted, a row typed and emptied again leaves nothing to clear: Save stays aria-disabled", async () => {
    const { api } = await open({ own: { heart_rate: null, spo2: null } });
    type("spo2", "low", "88");
    type("spo2", "low", "");
    const button = within(dialog()).getByRole("button", { name: "Yadda saxla" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(dialog()).toHaveTextContent("Göndəriləcək aralıq yoxdur");
    expect(dialog()).not.toHaveTextContent("bütün aralıqlarını silir");
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

- [ ] **Step 2: The two sentences of a clear, in four languages.** Every row empty over a charted set is a clear — Task 14a's engine reads `{"baselines": {}}` over a charted profile as "delete every range" — and the form says so before it sends and after it landed. The confirmation says only what is true: the PUT re-scores nothing (Task 14a's `test_once_cleared_the_next_pulse_is_judged_like_anyone_elses`), so it is the next reading that is judged without the ranges. Four Edits in `dashboard/src/live/i18n/strings/patient.js`. In `tr`, replace:

```js
    baselineNothingToSend: "Gönderilecek aralık yok: en az bir satırın iki sınırını da girin.",
```

with:

```js
    baselineNothingToSend: "Gönderilecek aralık yok: en az bir satırın iki sınırını da girin.",
    baselineClearsAll: "Bütün satırlar boş: «Kaydet» bu hastanın girilmiş bütün aralıklarını siler.",
    baselineClearedAll: "Hastanın bütün aralıkları silindi; sonraki ölçüm onlarsız değerlendirilecek.",
```

In `az`, replace:

```js
    baselineNothingToSend: "Göndəriləcək aralıq yoxdur: ən azı bir sətrin hər iki həddini daxil edin.",
```

with:

```js
    baselineNothingToSend: "Göndəriləcək aralıq yoxdur: ən azı bir sətrin hər iki həddini daxil edin.",
    baselineClearsAll: "Bütün sətirlər boşdur: «Yadda saxla» bu xəstənin daxil edilmiş bütün aralıqlarını silir.",
    baselineClearedAll: "Xəstənin bütün aralıqları silindi; növbəti ölçmə onlarsız qiymətləndiriləcək.",
```

In `ru`, replace:

```js
    baselineNothingToSend: "Нечего отправлять: введите обе границы хотя бы в одной строке.",
```

with:

```js
    baselineNothingToSend: "Нечего отправлять: введите обе границы хотя бы в одной строке.",
    baselineClearsAll: "Все строки пусты: «Сохранить» удалит все введённые диапазоны этого пациента.",
    baselineClearedAll: "Все диапазоны пациента удалены; следующее измерение будет оценено без них.",
```

In `en`, replace:

```js
    baselineNothingToSend: "Nothing to send: enter both limits of at least one row.",
```

with:

```js
    baselineNothingToSend: "Nothing to send: enter both limits of at least one row.",
    baselineClearsAll: "Every row is empty: Save deletes all of this patient's charted ranges.",
    baselineClearedAll: "All of the patient's ranges are deleted; the next reading will be judged without them.",
```

`npx vitest run src/live/i18n/strings.test.js 2>&1 | grep -E "Tests "` → `Tests  6 passed (6)` (it loops over every key: the four languages agree, az differs from tr, ru is Cyrillic).

- [ ] **Step 3: The form** — Write `dashboard/src/live/screens/patient/trends/BaselineForm.jsx`:

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
  const empty = Object.keys(baselines).length === 0 && Object.keys(errors).length === 0;
  // Every row empty over a set that IS charted is a clear: the engine reads `{baselines: {}}` over a
  // charted profile as "delete every range" (api/clinical.py). Over nothing there is nothing to clear.
  const clearing = empty && BASELINE_KEYS.some((key) => own?.[key]);
  const nothing = empty && !clearing;
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
      toast(t(clearing ? "patient.baselineClearedAll" : "patient.baselineSaved"));
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
      {clearing ? <p className="m-0 mt-1 text-12 font-semibold text-att-ink">{t("patient.baselineClearsAll")}</p> : null}
      <Announce text={busy ? t("patient.baselineSaving") : ""} />
    </Modal>
  );
}
```

`npx vitest run src/live/screens/patient/trends/BaselineForm.test.jsx 2>&1 | grep -E "Tests "` → `Tests  15 passed (15)`. (Each row is a `<fieldset>` whose `<legend>` names the vital, so a reader hears "Nəbz (/dəq), alt" rather than five identical "alt" fields.)

- [ ] **Step 4: The screen offers it — tests first.** Edit `PatientScreen.test.jsx` — replace:

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

Run it: `Tests  1 failed | 59 passed (60)` (no button yet).

- [ ] **Step 5: The button and the form in the box.** Two Edits in `trends/TrendsBox.jsx`.

(a) Replace:

```jsx
import React, { useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { hhmm } from "../../../i18n/dates.js";
import { Box, Note } from "../../../ui/index.js";
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
import { Box, Button, Note } from "../../../ui/index.js";
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

- [ ] **Step 6: Green, then the gate.**

```bash
cd /c/tmp/g2-vital/dashboard
npx vitest run src/live/screens/patient/ src/reachable.test.js src/live/boundaries.test.js src/live/rawKeys.test.jsx src/live/i18n/ 2>&1 | grep -E "Test Files|Tests |×"
```
Expected: no `×`; PatientScreen 60, BaselineForm 15. Then the suite — **89 / 2350** — and the build.

- [ ] **Step 7: Commit.**

```bash
cd /c/tmp/g2-vital
git add dashboard/src/live/screens/patient/trends/BaselineForm.jsx dashboard/src/live/screens/patient/trends/BaselineForm.test.jsx dashboard/src/live/screens/patient/trends/TrendsBox.jsx dashboard/src/live/screens/patient/PatientScreen.test.jsx dashboard/src/live/i18n/strings/patient.js
git status --short && git diff --cached --stat
git commit -m "feat(patient): the patient's own normal — five ranges, the whole set, written through the engine's profile door" -m "Offered to clinical.chart once the trends answered (the engine replaces the whole set, so the form opens on the set it replaces). Held inline: both bounds, a number, low <= high. Sends {baselines} alone; an emptied pair is deleted and the form says so. Every row emptied over a charted set sends {baselines: {}} and clears them all (Task 14a), said under the fields and on the toast (the next reading is judged without them); with nothing charted, nothing to send is aria-disabled with the reason. 200: toast, trends re-read, closed, no alert. 400: the engine's reason on the toast, named after the bed. 403: toast, closed. No answer: may have landed, re-read, told to look at the band.

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
    expect(screen.getByRole("dialog")).toHaveTextContent("Bədən hərarəti seyrəldildi: 2400 nöqtədən 2");
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

- [ ] **Step 4: The dashboard gate.** The suite: **89 files / 2351 tests** (measured); the build: `built in`, `precache  20 entries`, no `larger than 500 kB`. Then, by hand, read the dashboard part of `git diff b6ed65d --stat`: every new file under `src/live/screens/patient/trends/` is near the ~250-line guide or under it — `TrendModal.jsx` 225, `trendGeometry.js` 277 (one pure module, a little over) — while three tests are larger: `TrendModal.test.jsx` 607, `trendGeometry.test.js` 260, `TrendChart.test.jsx` 237 (the dialog's test is a candidate to split by view — O23).

- [ ] **Step 5: The backend, without the database.**

```bash
cd /c/tmp/g2-vital/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -1
```
Expected: `2126 passed, 650 skipped` (≈ 100–145 s; *derived*). (2130 once Task 16 has landed — measured.)

- [ ] **Step 6: The backend with Postgres, in five parts** (each under the 10-minute call limit; one at a time — they share `homunculus_test_g2v` and its advisory lock):

```bash
cd /c/tmp/g2-vital/homunculus-engine
DB=postgresql+asyncpg://homunculus:homunculus@localhost:55432/homunculus_test_g2v
TEST_DATABASE_URL=$DB PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q $(ls tests/test_ad*.py) 2>&1 | tail -1
```
```bash
cd /c/tmp/g2-vital/homunculus-engine
DB=postgresql+asyncpg://homunculus:homunculus@localhost:55432/homunculus_test_g2v
TEST_DATABASE_URL=$DB PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q $(ls tests/test_a*.py | grep -v "tests/test_ad") 2>&1 | tail -1
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
Expected (measured with the whole slice, every amendment and both lanes' review follow-ups in place, 2026-10-20): `205 passed` (4–6 min); `674 passed` (5–9 min — Task 14a's 29 and `test_audit_since.py`'s 21 are here; together the two were one 846-test part that ran 8 min 44 s on 2026-10-19 and 14–15 min on 2026-10-20, hence the split); `517 passed, 1 skipped` (1 min — Task 3b's 9 are here); `1028 passed, 7 skipped` (1 min 34 s – 2 min 12 s); `344 passed` before Task 16, `348 passed` after it (`test_trends.py`'s 30, `test_trends_api.py`'s 26, `test_timeline_thin.py`'s 17; 2 min 20 s – 3 min 48 s). Total **2768 passed, 8 skipped** at this task (base 2617 / 8 + 151; *derived*), **2772 / 8** after Task 16 (measured). `grep -v` keeps `test_infinity_vm_pilot.py` out of the third part: never let a glob pick it up.

- [ ] **Step 7: The slice's files on Python 3.14.**

```bash
cd /c/tmp/g2-vital/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:55432/homunculus_test_g2v PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/g115-py314/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_news2_bands.py tests/rules/test_news2.py tests/test_timeline_thin.py tests/test_audit_since.py tests/test_audit_postgres.py tests/test_gateway_hl7.py tests/test_gateway_fhir.py tests/test_trends.py tests/test_trends_api.py tests/test_infinity_shadow_isolation.py tests/test_board_permissions.py tests/test_api_patient_profile.py tests/test_rehydrate.py 2>&1 | tail -1
```
Expected: `349 passed` (14 + 65 + 17 + 21 + 11 + 18 + 10 + 30 + 26 + 18 + 57 + 56 + 6; Task 16 adds `test_scenario_rebase.py`'s 4 → 353, measured with it in the list).

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
Expected: `9 passed` (4 + 1 + 4); `usage: replay.py [-h] [--url URL] [--token-env TOKEN_ENV] [--now]` / `[scenario] [delay]`. The whole no-DB suite: `2130 passed, 650 skipped` (measured, with every task, amendment and lane follow-up in place).

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
  6a. **The O4 amendment.** **Xəstənin norması…** again; empty Nəbz's two fields: under the fields "Bütün sətirlər boşdur: «Yadda saxla» bu xəstənin daxil edilmiş bütün aralıqlarını silir.", and Yadda saxla is offered (no `aria-disabled`). Save → the toast "Xəstənin bütün aralıqları silindi; növbəti ölçmə onlarsız qiymətləndiriləcək.", and the "Xəstənin normasında" pill and the dashed band are gone. Then `$C restart api` (`C` as in Step 5), wait for `healthy` as in Step 5, reload: still no pill, no band — the clear survived the replay from Postgres. The form once more: every row empty, Save `aria-disabled` with "Göndəriləcək aralıq yoxdur …". **Acceptance 3b — the last range can be removed, and stays removed.**
  7. Sign out; sign in as `test.denetci@homunculus.health`: the cards are there, the **Xəstənin norması…** button is not.
  8. **Acceptance 4:** at 390 px (devtools device toolbar, 390 × 844) and at 1440 px — no horizontal page scroll on the patient screen, in the big chart, in its table (it scrolls inside its own frame) and in the form; one column at 390, three at 1440. Ayarlar → Tema: Gece and Gün. Dil: az, tr, ru, en — no raw `patient.…` key anywhere. With NVDA and Chrome (X28): Tab to the big chart — NVDA must switch to focus mode, and ← → must move the cursor and say the readout once per move; the table must read in browse mode while a poll inserts rows at its top (if NVDA's reading position jumps a row per reading, say so — holding the table still while it is shown is the fix); note whether NVDA re-speaks the chart's name when its count changes. And by eye, on a 1× monitor: MAP's hollow ring (r 2.5, stroke 1.5) leaves a hole of about 3.5 px — say if it still reads as a dot; and whether the 72 h time labels, anchored to the right edge, read cleanly at `--fs` 1.12.

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
- **"Hastanın normalinde" hapı:** son değer bu hasta için girilmiş aralığın içindeyse. Hap çerçeveyi
  susturmaz, çerçeve de hapı gizlemez — iki olgu birlikte gösterilir.
- Karta basınca büyük grafik: 6 saat / 24 saat / 3 gün; imlecin altındaki ölçümün saati, değeri
  ve birimi; ▲ bulgunun bu hasta için ilk tespit edildiği an (bugün aynı türden bir bulgu kapanıp
  yeniden açılsa da yeni ▲ çıkmaz — plandaki O17), ◆ kaydedilmiş antibiyotik dozu; aynı sayıların tablosu,
  her ölçümün motorun verdiği NEWS2 puanıyla. Klavyeyle de gezilir; ekran okuyucu okumayı yalnız
  klavye hareketinde duyar.
- Noktalar ölçümdür; aralarındaki kesikli çizgi yalnız aradaki zamandır, ölçüm değildir.

**Bantlar nereden gelir**
- NEWS2 bantları motorun puanlamada kullandığı tablonun kendisidir (`rules/news2.py`
  `NEWS2_BANDS`); kaynağı kasadaki `news2-rcp-2017` notu. Yalnız yetişkin, SpO₂ için yalnız
  Ölçek 1. Yenidoğan için bant yoktur — bu boşluk kasada kayıtlı, ekranda kapatılmaz.
- "Hastanın normali", `clinical.chart` yetkisi olan birinin bu hasta için girdiği aralıktır. NEWS2
  puanı alan bütün değerler bu aralıklardaysa bulgu gösterilir ama alarm vermez; aralığın dışına
  çıkan değer ayrıca bildirilir. Cihazın kendi alarm sınırları Aşama B'de
  doğrulanınca eklenecek; şimdilik yoktur.

**Ne göstermez:** dalga formu (ECG vb.) — prototiptekiler sentetikti; Aşama A'nın monitör
değerleri (geçmiş tutulmuyor, doğrulanmadı, hastaya bağlanmadı); MAP ve laktat için kişisel normal
(motor tutmuyor).

**Çok veri olunca:** bir kanalda pencerede 2 000'den çok ölçüm varsa grafik seyreltilir — eşit
zaman dilimlerinin her birinde ilk, son, en düşük ve en yüksek ölçüm kalır, yani en kötü değer
kaybolmaz — ve gösterge "‹kanal› seyreltildi: N noktadan M" der. Bugünkü aralıklı ölçümler bu sınıra
yaklaşmaz.

**Hastanın normali (form):** `clinical.chart` yetkisi olan klinisyen kutunun başlığındaki
"Hastanın normali…" ile beş vital için alt ve üst sınır girer. İki sınır da gerekir; alt üstten
büyük olamaz. Motor gönderilen kümeyi bütünüyle yeniler: boş bırakılan aralık silinir,
komorbiditeler ve bazal SOFA değişmez. Kayıtlı bir aralık varken bütün satırlar boşaltılırsa form bunu
söyler ve Kaydet hepsini siler; silme denetim kaydına yazılır ve sunucu yeniden başlasa da geri
gelmez. Kayıt anlık alarmları yeniden hesaplamaz: sonraki ölçüm yeni normale (ya da normalsiz)
göre değerlendirilir. Bu aralık monitörün alarm sınırı değildir; motor bu hastanın
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
| G2-01 | Vital eğrileri (hasta ekranı): altı kart, büyük grafik (6 sa / 24 sa / 3 gün, tablo), hastanın normali formu; `GET /patients/{id}/trends` · spec: [2026-10-19](../specs/2026-10-19-g2-vital-egrileri-design.md) · plan: [G2 dilim 1](2026-10-19-g2-vital-egrileri.md) | Kod ✅ <date> · <range>. Backend 2130 / 650 (DB'siz), 2772 / 8 (Postgres); dashboard 89 dosya / 2351 test. Yerel yürüyüş: <walk>. **Açık:** az/ru yerel okuma; VM'de kullanıcının bakışı (gerçek bir hasta, 390 ve 1440 px, değerler yazılmaz); plandaki X20 (Task 2 incelemesi), X21–X30 ve O1–O3, O6–O12, O14, O15, O17–O23 (X1–X19 onaylandı, O4 çözüldü: 2026-10-20) |
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
  "What the code says", X1–X30; X1–X19 approved by the user on 2026-10-20):** the plan departs from this spec where the code made its letter
  impossible or unsafe — 503 for an unreadable scope, checked before `_require_patient` (X1); bands
  as `low < v <= high` (X2); alarm marks from `first_seen`, one per episode, not from `alert` rows
  (X3); antibiotic marks only for doses ≥ 1 (X4); each point carries the engine's NEWS2 points
  (X5); MAP at full colour with hollow dots, because reduced opacity measured 2.17–3.34:1 (X6);
  ages through `useBoardNow` (X7); a 400 only on the toast (X8); `onlyWrite` and `formsSoon`
  reworded (X9); 390 px checked in a browser (X10); `replay.py --now` (X11); alarm marks read up
  to 5000 episodes with `markers_truncated`, and a non-finite reading never drawn (X22, with the
  gateways refusing NaN/±inf — plan Task 3b).
- The last baseline can be removed (the user's choice for O4, 2026-10-20): every row emptied over
  a charted set sends `{"baselines": {}}`, which the engine takes as clearing every range even when
  nothing else is charted, and the audit replay reads each profile row over the one before, so the
  clear survives a restart (plan X15, Task 14a).
- §3.3's save toast says the engine re-evaluated; the profile PUT re-scores nothing — the standing
  alerts are re-judged at the next reading (plan X21, O12).
- `PUT /clinical/{id}/profile` replaces the set with no lost-update check: two clinicians saving one
  patient's normal at once — the second wins silently (plan O3).
- ▲ on the charts is a finding's first detection for this patient, not every episode: the engine's
  active alerts never clear a kind today (plan O17 — an engine fix, the user's choice of slice).
- The keyboard-driven big chart is `role="application"` with a role description, not §6's
  `role="img"` (plan X28): NVDA and JAWS stay in browse mode over an image, and the arrow keys
  that §7 promises would move the cursor never reach it. The table carries the legend's notes
  (X29); a MAP read beside systolic at another minute prints its own time (X30).
- Additive ideas not taken in this slice: `previous_ts` beside `delta` ("since when"), and a
  severity on the alarm marks.
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
| O1 | **Native reading of the Azerbaijani and Russian texts:** the 49 `patient.trends*` / `patient.baseline*` keys of Task 8 and Task 14's two (`baselineClearsAll`, `baselineClearedAll`), the two reworded sentences (`onlyWrite`, `formsSoon`) and `errors.badTrendHours` were written by the planner; the Task 8 quality review corrected several in all four languages (lane commit `f082251`, mirrored here), but no native speaker has read them yet. | A native-speaking clinician | Before the VM |
| O2 | **Stage B retention cap** on `PatientState._history` (unbounded per signal, spec §11). The trends endpoint scans a window linearly per request — 864 readings in ≈ 4 ms today — and thins only what it serves; 51 840 readings per channel per 72 h is Stage B's to bound. | Stage B's plan | Stage B |
| O3 | **Lost update on the profile.** `PUT /clinical/{id}/profile` replaces the baseline set with no expected-set check (Wave 3B's 14e closed this for the three `/admin` whole-set writes only). Two clinicians saving one patient's normal at once: the second wins, silently. | User decision; engine | Group 2 |
| O4 | **Resolved 2026-10-20 — the user chose explicit clearing.** Task 14a: the engine takes `{"baselines": {}}` over a charted profile as "clear every range", even with nothing else charted (still refused from nothing and without a `baselines` key); the replay reads each profile row over the one before, so the clear survives a restart (it did not: the clearing row, an empty profile, was refused on replay). Task 14: every row emptied over a charted set sends it, said under the fields and on the toast; with nothing charted, Save stays `aria-disabled`. | — | Done in the plan |
| O5 | **Approved 2026-10-20:** the user approved every departure X1–X19. X21, found while amending for O4, waits on O12. | — | — |
| O6 | UNKNOWN scope → 503 only on the trends route; every other single-patient route still answers 404 and writes `scope_denied` (roadmap l. 659). | Group 2 | — |
| O7 | `/audit`, `/alarm-quality` and `rehydrate` still read the oldest N (roadmap l. 658); `since` now exists for them to use. | Group 2 | Before the alarm-quality panel |
| O8 | `backendApi.setProfile` (backendApi.js:778–787) sends `comorbidities: []` by default and so clears every charted comorbidity when called with only baselines. No live screen calls it; the admission form (Group 2/3) must not, or must be fixed first. | Whoever builds the admission form | — |
| O9 | `errors.scopeUnreadable` speaks of the live stream ("canlı akış başlatılamadı"); a trends 503 maps to the same key. The trends screens print their own "okunamıyor" line and never that text, but a later screen that prints `apiErrorText` for a trends 503 would say "live stream". | i18n | Minor |
| O10 | **A mark's instant is the escalation clock's** (when the server first raised the episode); a reading's is its own measured instant. Live they are minutes apart; a replayed, back-filled or late-arriving reading can sit hours before its ▲ (seen in Task 16 with `--now`). Honest, but worth a sentence in the legend if the ward finds it confusing. | User, after the VM look | — |
| O11 | The brief's backend command fails 2 tests without `PYTHONPATH=src` (`ModuleNotFoundError` in a child process; the f7-py312 venv has no install of this worktree). This plan always sets it; installing the worktree editable into a venv is the other fix. | Environment | — |
| O12 | **The save's toast says more than the engine does** (X21): "Hastanın normali kaydedildi; motor yeniden değerlendirdi" (spec §3.3, Task 8's `baselineSaved`) — but the PUT re-scores nothing: an alert a range downgraded stays downgraded, or an alert a new range would quieten stays loud, until the next reading (minutes on a monitor; the next spot check otherwise). Either reword it in four languages (e.g. "…kaydedildi; sonraki ölçüm bu normale göre değerlendirilecek") or make the door re-judge the patient's latest state when the profile changes (an engine change, with its own tests). The clear's new toast already says only what is true. | User decision | Before the VM |
| O13 | **Resolved 2026-10-20 — the Task 2 quality review's two findings.** A NaN in `PatientState` (a) took a thinning slice's minimum and maximum, dropping the real extreme (an 85 % desaturation, measured), and (b) made the trends answer 500 (Starlette's `JSONResponse` has `allow_nan=False`). Task 3b closes the doors (`gateway/hl7.py` drops the field, `gateway/fhir.py` raises `GatewayError`); Task 4's builder skips a non-finite reading for rows already in the audit, which replay through `rehydrate` and no gateway. `thin()` stays NaN-intolerant **on purpose** — a documented precondition, filtered by its caller — and other doors into `PatientState` (Aşama A's lane, a future one) must keep refusing non-finite values the way `edge/ncefiles.py` and `api/clinical.py` do. | — | Done in the plan |
| O14 | **The audit table has no index beyond its key and `(tenant, prev_hash)`**, so every trends read (and `/audit`, `/alarm-quality`) scans the whole table for one patient's `first_seen` rows. The fix is an index on `(tenant, patient_id, event_type, id)`; an expression index on the `CAST(ts AS timestamptz)` the `since` filter uses is impossible (`timestamptz_in` is STABLE, not IMMUTABLE). A migration, not this slice (from the Task 3 quality review). | Stage B's plan | Before Stage B |
| O15 | **Who may enter the patient's normal.** Today every `clinical.chart` holder — nurses, charge nurses and rapid response included — can; the engine's own words call the ranges "clinician-charted", and the Task 8 review's wording ("hastanın normali, girildiyse", no "hekim") assumes that stays. Physician-only would be a permission change (a new permission or a role split), not a text. The older `patient.suspectedYes/No` "(hekim işaretledi)" (Group 1) has the same who-entered problem. | User decision | Before the VM |
| O16 | **Resolved in the plan (2026-10-20):** Task 12's legend prints `markers_truncated` (`trendsLegendMarksTruncated`, four languages). Today the flag cannot be set (O17): with the alerts sticky, a patient writes at most one `first_seen` row per kind. | — | Done in the plan |
| O17 | **The engine's active alerts are sticky.** `pipeline.py:93–96` sets `bucket[a.kind] = a` and never removes a kind, so `active_alerts` keeps a finding whose rule stopped firing until a replacement of the same kind: `_live_keys` never shrinks, `AckStore.prune` never drops a stamp, `first_seen` is written once per (patient, kind) ever, escalation clocks never reset, and `alarm_quality`'s episode counts are off. For this slice: a ▲ means "the first time this finding was ever raised for this patient", not an episode — the legend says "first detection" (Task 12) — and `markers_truncated` is unreachable. The fix (rebuild the bucket from each evaluation's kinds, so a kind that stops firing clears; tests across the board, acks, escalation, notifications, `alarm_quality` and `rehydrate`) is an engine change with clinical effect. **Two options:** a separate engine task 4b in this slice, or a later slice; Task 12's legend and Task 17's guide follow whichever is true at ship time (found by the Task 4 quality review). | User decision | Before the VM |
| O18 | **Two tones for one fact.** The header's `News2` pill shows a 3-point parameter in attention amber; the card frames it red (D2). The kit `Tag` has no `mid` tone, so the 1–2-point badge borrows the attention look. One vocabulary for NEWS2 tones across the header, the card and the kit is a kit-level decision (Task 10 quality review). | User / kit | Later |
| O19 | **Stage B's performance, before Stage B** (next to O14): the builder takes ≈ 2.1 s for 72 h of 5 s data, mostly `thin()`, and the route runs it synchronously inside an `async def`, holding the event loop for that time (Task 4 quality review). Options: thin per request in a worker thread (`run_in_threadpool`), cache per (patient, window, last reading), or bound the history (O2). | Stage B's plan | Before Stage B |
| O20 | **Before Stage B, too: memoise the chart's parsing and drawing.** `parsePoints` runs on every render for every series (the dialog re-renders on each cursor move), and `TrendChart` re-renders with it: memoise `parsePoints` per points array and wrap `TrendChart` in `React.memo` before 5 s data arrives (Task 11 quality review; a note, not this slice). | Stage B's plan | Before Stage B |
| O21 | **NEWS2 points in the spoken readout?** A sighted reader reads a reading's points from the band colour behind its dot; a screen-reader user hears only the value (the table has the points). Adding " · 2 bal" to the readout is a small change to spec §3.3's readout — the user's decision (the Task 13 quality review; the controller's list calls it O18). | User decision | Before the VM |
| O22 | **Two stops in one minute with the same value say the same words**, and `useAnnounced` dedupes by text, so the second keypress is silent (≈ 1 reading a minute today). At Stage B rates: seconds in the readout when two stops share a minute, or a live region re-mounted per stop. Accepted for this slice. | Stage B's plan | Stage B |
| O23 | **`TrendModal.test.jsx` is 607 lines**, well past the ~250-line guide (with `trendGeometry.js` 277, `trendGeometry.test.js` 260, `TrendChart.test.jsx` 237 a little past it). Split the dialog's test by view (graph, keyboard, table) when it next changes. | Group 2 | — |

**Commit trailer.** The controller's brief set `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` for this plan's tasks; amendments.md's latest recorded trailer is `Claude Opus 5.5`. Use the one the controller gives when the tasks run.

---

## Self-review

**Spec coverage, section by section.**

| Spec | Where |
|---|---|
| §1 the four deliverables | cards T10–T11; big chart T12–T13; the form T14; the endpoint T4–T5 |
| §2 D1 server composes, browser draws | T4 (everything computed there); every dashboard test hands the browser a contradicting fact (T10, T11, T13) |
| D2 frame from the engine's points + badge | T10 (`news2Tone`, frame, "NEWS2 +3" on the first channel's row; "NEWS2: —" when the engine sent no points — X24), reused for bands T11 |
| D3 own-normal pill beside the frame | T4 (`within_own_normal`), T10 (pill, frame kept) |
| D4 the form, five channels, `clinical.chart` | T14 (`BASELINE_KEYS` held to `api/clinical.py`), T6 (`putPatientProfile`) |
| D5 no waveforms | nothing drawn; T17 guide says so |
| D6 adult NEWS2, Scale 1 only | T1 (no Scale 2 row; test), T4 (`news2_scale: 1`), T8 (labels "yetişkin") |
| D7 Stage A not charted | T4 (imports nothing of it), T5 (isolation tests both ways) |
| D8 thinning 2 000 / 500 buckets, flagged | T2, T4 (`thinned`, `total_points`), T12 (legend) |
| D9 device limits reserved | T4 (`bands.device: None`, test) |
| §3.1 the box, header note, button, grid 1/2/3, card contents, 46 px mini chart, states, unreadable header, systolic + MAP, card is a button | T9 (box, note, unreadable), T10 (grid, values, delta, age, frame, pill, no data, single), T11 (mini chart), T12 (button), T14 (the header's button) |
| §3.2 the big chart: Modal, title, Seg hours (refetch), Grafik | Tablo, 280 px, time labels in the ward's zone, bands, points, connectors, ▲ ◆, readout with the nearest mark, mouse, keyboard, legend incl. thinned; table with caption and columns | T12 (dialog, hours, readout, mouse, legend), T13 (keyboard, Grafik | Tablo, table), T11 (labels, marks) |
| §3.3 the form: prefill, both-or-neither, low > high, full set, the note, all-empty, 200 / 400 / timeout / 403, button only with `clinical.chart` | T14 (+ X8, X14, X15, X17, X21); all-empty over a charted set clears every range — T14a (engine, replay), T14 (form), T16 step 8.6a |
| §3.4 who sees what | T5 (`board.view`), T14 (`clinical.chart`; the auditor has no button, T16 step 8.7) |
| §4 the endpoint and its rules | T4 (shape, order, points, latest, bands, markers, thinning; non-finite readings skipped, `markers_truncated` — X22), T5 (hours, 400/401/403/404/503, no audit row) with X1–X5; T3b (the gateways refuse NaN/±inf) |
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
| §8 tests | engine T1–T5, T3b and T14a (named files), dashboard T6–T15, end to end T16 |
| §9 keys | T8 (all 31 new + 18); T10 adds five (the unscored tag, the delta's words — X24), T12 three (the legend), T14 the clear's two |
| §10 not in this slice | nothing built for it |
| §11 risks | T17 updates it; O2 |
| §12 acceptance 1 | T15 steps 4–7 (3.12, 3.14, dashboard; counts here) |
| acceptance 2 | T15 step 8 (≈ 4–15 ms by the day's load), T2 (5 s series ≤ 2 000, flagged in T4) |
| acceptance 3 | T16 steps 7–8 |
| acceptance 4 | T15 (rawKeys sweep, contrast via T7), T16 step 8.8 (390/1440, four languages, both themes) |
| acceptance 5 (the VM look) | after merge, the user's; recorded as open in T17's roadmap row |

**Placeholder scan.** No "TBD", no "similar to Task N", no "add appropriate error handling". The only fill-ins are runtime facts that cannot exist before the work does — T17's roadmap row takes the date, the commit range and the walk's outcome, each with the command or step that produces it.

**Names and types across tasks.** Engine: `Band`, `NEWS2_BANDS`, `BANDS_SOURCE`, `points_for` (T1) are what T4 imports; `thin(series, max_points)` (T2) is called with `TRENDS_MAX_POINTS`; `since_utc` (T3) is shared by `audit.py` and `audit_postgres.py`; `records(…, since=…)` is keyword-only everywhere (T3's signature test); `patient_trends(engine, audit, *, hospital, patient_id, hours, now)` (T4) is what T5's route calls with `int(hours)` after the text check against `TRENDS_HOURS`; the route is listed in `BOARD_EXPECTED` and `UNSCOPED_BY_DESIGN` under the path FastAPI reports, `/patients/{patient_id}/trends`. Dashboard: `patientTrends(patientId, hours)` / `putPatientProfile(patientId, body)` (T6) are the names `useTrends` (T9) and `BaselineForm` (T14) call, and `fakeApi` carries both; `useTrends(patientId, hours, measuredKey)` → `{data, loading, unreadable, lastOkAt, reload}` is read the same way by `TrendsBox` and `TrendModal`; `measuredKeyOf(patient.measuredAt)`; the fixtures `trends(patientId, channels, over)`, `channel(key, points, over)`, `point(minutesAgo, value, points)`, `marker(minutesAgo, kind, label)`, `answering(build)`, `BANDS`, `KEYS` (T9) are what every later test uses; `news2Tone(points)` (T10) is used by `TrendCard` and `bandRects`; `CARDS` / `cardTitle` / `channelsOf` (T10) by the box, the dialog, the legend and the table; `TrendCard({card, channels, nowMs, sinceMs, untilMs, onOpen})` gains `sinceMs`/`untilMs` in T11 and `onOpen` is passed from T12; `TrendChart`'s props grow `onPlot` (T12) and `onKeyDown`, `describedBy` (T13) by Edit, never renamed; `whenText`/`markText` live in `TrendModal.jsx` in T12 and move to `trendText.js` (with `pointsText`) in T13, where `TrendModal` and `TrendTable` both import them and nothing else imported them from the dialog; `TrendsBox({patient, bed, nowMs})` gains `nowMs` in T10 and `bed` in T12, matching PatientScreen's edits in those tasks. The sixth pass follows the lane's Task 13: `TrendLegend.jsx` exports `TrendNotes` beside `TrendLegend`; `trendText.js` gains `valueBeside`; `TrendTable` takes the dialog's parsed `series` and `markers`; two keys, `patient.trendsChartRole` and `patient.trendsPointsUnknownRowSr`. The fifth pass follows the lane's Task 12: `valueTicks` returns `{ step, ticks }`; `indexAtTime(points, ms)` resolves the cursor (an instant) to an index at render; `marksNear` is gone (`marksAtTime` is the one rule); Task 13 moves `whenText` and `markText` from `TrendModal.jsx` to `trendText.js`, beside `markBeside` and `pointsText`, and `TrendChart` reads `whenText` from there; `readoutOf` stays private to the dialog (the announcement reads the same `readout` value). The fourth pass renames two exports and adds six: Task 12 replaces Task 11's `markerNear` (read only by its test) with `marksNear`, and its own `markerAtTime` with `marksAtTime` — both return EVERY mark at an x or an instant, and both dialogs (Tasks 12 and 13) read `marksAtTime`; `valueTicks(domain, count, { extent, resolution })` keeps Task 11's two-argument call working, beside `valueTickStep`, `valueExtent`, `valueResolution`, `tickLabel` and `timeLabelPlace`. The third pass renames nothing in the plan's own tasks: Tasks 1–4, 3b and 6–10 are the lanes' code, and Tasks 11–17 are written against it — `TrendCard` keeps its props and gains `sinceMs`/`untilMs` in Task 11 on the lane's `Reading` (`badge`, `pill`); `TrendLegend` gains `truncated`, which both dialogs (Tasks 12 and 13) pass from `markers_truncated`; the legend's ▲ reads `trendsLegendAlarm` while the readout and the table keep `trendsMarkerAlarm`. The second amendment renames nothing either: `TRENDS_MARKER_LIMIT` keeps its name (5000 now); `_markers` returns `(marks, truncated)` and only `patient_trends` calls it; `_finite` is private to `api/trends.py`; `markers_truncated` is a new key no dashboard module reads yet (O16); Task 12's `TrendLegend` passes `channel: t(s.labelKey)` to `trendsThinned`, which takes `{channel}` since the Task 8 review. The O4 amendment renames nothing: `profile_from_payload(patient_id, payload, base=None)` keeps its signature (T14a) and `_replay_profile` now passes `engine.profile(rec.patient_id)` as `base`; `BaselineForm`'s `own` is the box's `{key: bands.own_normal | null}` map it already received, read once more to tell a clear (`clearing`) from nothing to send (`nothing`). Every `t("patient.…")` the code names is one T8 (or, for `baselineClearsAll` / `baselineClearedAll`, T14) defines in four languages (checked by `rawKeys.test.jsx`'s static net, T15 step 3 proves it bites).


# G3-01 Yatak başı ölçüm — hand-entered bedside vitals into the real engine, previewed, withdrawable — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A nurse enters the bedside set by hand into the real engine: solunum, SpO₂, ek oksijen, sistolik, MAP, nabız, bilinç and ateş. She can do it from a new «Yatak başı ölçüm» page (`/olcum`) or from an «Ölçüm gir» button on the patient screen. Before saving she sees the engine's NEWS2 preview. After saving, a wrong value can be withdrawn as «hatalı giriş». The withdrawal takes the value out of every score, alert and restart, and the trend table keeps it struck through with its reason.

**Architecture:**
- **Engine door.** The chart door (`api/clinical.py`, `POST /clinical/{id}`) opens to the six vitals. It applies slip bounds, whole numbers, MAP < sistolik and a 24-hour time bound, answers the audit id of each `chart` row, and now notifies the nurse of a new immediate alert, as `/ingest` already does.
- **Preview.** `POST /clinical/{id}/preview` scores a COPY of the patient's state with the board's own NEWS2 function. It writes nothing.
- **Withdrawal.** `POST /clinical/{id}/entries/{entry}/retract`:
  1. reads the patient's rows from the trail;
  2. replays them, without every withdrawn entry, into a scratch engine with the restart's own helpers;
  3. appends a `chart_retract` row;
  4. hands the scratch patient to the real engine (`Engine.adopt`);
  5. runs the lifecycle hook once, then mirrors the removal to the shadow lane.
  A restart skips withdrawn entries. Trends read each channel's hand entries and withdrawals from the trail.
- **Dashboard.** A small API and store layer, an `olcum` strings namespace in four languages, the door's new refusals translated, and a new folder `live/screens/bedside/`:
  - `vitalsFields.js`: the eight inputs, their bounds and the number and time rules;
  - `VitalsForm.jsx`: the form; `PreviewPanel.jsx`: the engine's NEWS2 for it;
  - `SavedStep.jsx`: «Kaydedildi», with a «hatalı giriş» per value;
  - `BedsideScreen.jsx`: the page.
  `RetractDialog.jsx` sits in `live/screens/common/`, because two screens open it (X15). The patient screen gets the «Ölçüm gir» button. The trend card, the big chart and its table get «elle», the withdraw button, struck-through rows and crossed dots.

**Tech Stack:** Python 3.12 / FastAPI / SQLAlchemy / pytest (engine); React 18, Vite, Vitest + Testing Library (dashboard).

**Spec (authoritative):** `docs/superpowers/specs/2026-11-02-g3-yatak-basi-olcum-design.md` (D1–D16, O1–O5; commit `03c365a`, merged with main `c72cbe5` as `a0e3f3b`). This plan departs from the spec where the code made its letter impossible or unsafe, or left it unspecified. Every departure is numbered X1–X17 below and tagged in the code.

---

## What the code says that the spec did not — departures (read before Task 1)

| # | Departure | Why |
|---|---|---|
| X1 | **Trends read hand entries from the trail, not from an in-memory index** (spec D13 said an index). `GET /patients/{id}/trends` reads this patient's `chart` and `chart_retract` rows since the window start, in one bounded read, beside the read `_markers` already makes for `first_seen`. | One source for the live door, the admission form's charting (`BoardLink`, which calls `chart_observations` by reference and would never feed an index) and a restart. An index fed by the door alone would show a withdrawal button on some hand entries and not on others. The trends route already reads the trail on every poll, and a `chart` row's `ts` is never before its `obs_ts`, so `since` bounds both reads. |
| X2 | **The chart door now notifies the nurse of a new immediate alert** (`notifier.for_new`, the `/ingest` code path), for every charted entry. | Spec D9 says a hand-entered NEWS2 "notifies the nurse". The door did not. Only `/ingest` calls `for_new` (`api/app.py` around `:1162`), so a NEWS2 above a band from hand vitals reached the board and the escalation cycle but no nurse. This is the device-vitals behaviour D9 promises, for every value through the door. |
| X3 | **A withdrawal can notify, for an alert that becomes active because of it.** For example, a wrong normal RR hid an earlier abnormal one; the withdrawal brings the earlier reading back as the latest. | Spec D10 says "sends no notification". That holds for every alert already on the board. An alert newly active after the rebuild is a new alert, and a nurse who was never told of it must be told. Same `for_new` path; its dedup sends nothing for an alert already notified. |
| X4 | **Order of the withdrawal: read, rebuild into a scratch `Engine`, append the `chart_retract` row, then `engine.adopt(scratch, patient)`.** | "The trail row first, then memory" (`1f36903`, A-25). A trail read or an append that fails changes nothing, because the scratch engine is dropped. `adopt` is in-memory and replaces everything the real engine holds for that patient: readings, alerts of the last evaluation, the antibiotic anchor and its dropped-anchor memory, the NEWS2 hold and judge-at, and the profile (`pipeline.py` `_PER_PATIENT`). |
| X5 | **The shadow lane removes the observation and re-judges it at its next sample**, not at once. | Spec D10 (4) said "re-judge". The shadow engine judges only on ingest (`api/infinity_rules.py` `mirror_observation`), and a linked patient gets a sample every minute. The lane is not clinical (Aşama B, D1), so a minute's lag is the spec's own "approximate". |
| X6 | **Units are the trend endpoint's** (`api/trends.py` `_UNITS`): `/min`, `/min`, `%`, `mmHg`, `mmHg`, `°C`. A test pins `CHARTABLE` against `_UNITS`. **O2 is closed.** | The HL7 adapter carries the vendor's OBX-6 unit through (`gateway/hl7.py:136`) and no rule reads a unit. `_UNITS` already claims to be "what `api/clinical.py` CHARTABLE fixes for a charted value". |
| X7 | **`CORRECTION_BOUNDS` becomes `PLAUSIBLE`.** | MAP joins `PLAUSIBLE` with the same 0–300 mmHg the SOFA correction bound added for it (`api/app.py:115`). The two tables would now be equal, so one name is kept and nothing is duplicated. |
| X8 | **Two existing tests change meaning.** `tests/test_api_clinical.py::TestWhatMayNotBeCharted::test_a_device_channel_cannot_be_typed_in_by_hand` becomes a test of the refusal branch with a code removed from `CHARTABLE` (monkeypatch). After this slice no `SignalCode` is device-only, so the branch stays for the next one. `tests/scoring/test_signing.py::…::test_a_slipped_map_correction_is_refused_for_a_preview_and_for_a_signature` ends with the door ACCEPTING MAP 65. | Spec D5: MAP and the five vitals become chartable. The SOFA form itself still offers no MAP editor (A4 D9; `sofaFields.js`): MAP is entered at the bedside form. |
| X9 | **Identity on the page is `display_name` + the year of `birthDate`.** The board carries no family/given split (`liveAdapters.js` `patientFromBoard`). A patient with no birth date says «doğum tarihi kayıtlı değil». The confirmation is still asked. | Spec D3 «ad soyad ve doğum yılı». Inventing a year would break the screen's own header rule: no age the prototype made up. |
| X10 | **The preview answers the card's NEWS2 object**, `api/board.py` `_news2(copy, now)`: `total`, `partial`, `missing`, `red_param`, `breakdown`, `stale`, `assumed`, `measured_at`, `fresh_until`, `last_charted`. | Parity with the card by construction (spec D8's test still runs). The spec's example names were a sketch, and it said the plan aligns them. |
| X11 | **A device credential cannot withdraw** (403 «geri alma bir kişinin işidir»). | The bridge's token passes every permission check (`Caller.is_device`). A withdrawal names who made it, and a machine cannot be asked why. Same reason a SOFA signature refuses an unnamed signer. |
| X12 | **The time bound (D7) is checked only when `recorded_at` is sent.** An untouched time is sent as none, and the server stamps its own clock. | `ChartEntry`'s rule (review 2, `SofaEditors.jsx:90-93`): a browser clock ahead of the server's must not chart in the future. |
| X13 | **«elle» is printed where the trends answer is read**: the trend card, the big chart's readout and its table. It is not printed in the patient screen's «Ölçülen değerler» box or in the page's list. The page's list shows the last NEWS2 measurement of any source. | Spec D1 also named the vital cards, and D3 "the time of the last hand entry". The board card carries no source per value (`api/board.py` `_latest_at`); only the trends answer lists hand entries (Task 6). Adding provenance to the board would widen its hottest payload for one word. |
| X14 | **Names.** The API's `previewChart` and `retractEntry`; the store's existing `chart` and new `chartPreview` and `retract`; the route's label `olcum.nav`, in the slice's own namespace. | Spec §5 sketched `chartVitals`, `previewVitals`, `retractEntry` and `nav.bedside`. The door is the existing chart door (D5), so its call stays `chart`; one namespace per slice is the house rule (`kabul.nav`). |
| X15 | **`RetractDialog.jsx` lives in `screens/common/`** (spec §5: `screens/patient/`). | Two screens open it: the bedside saved step and the trend dialog's table. `common/` is where the screens' shared pieces live (`BoardState.jsx`, `MonitorStrip.jsx`). |
| X16 | **A withdrawn value is drawn on the big chart only**, dimmed and crossed where it was typed, and the big chart's value axis holds it. The card's mini chart draws the engine's points only. | A slipped digit is exactly the value that stretches an axis. On the mini chart, which has no legend and is hidden from assistive technology, it would flatten the real readings with no word of why. The big chart says what the cross means. |
| X17 | **The door's fixed refusals are translated** (`errors.*`): MAP < sistolik, the two time bounds, and the withdrawal's five. The whole-number refusal ("{code}: tam sayı olmalı") stays as the engine wrote it. | The door's sentences are Turkish (D6), and an Azerbaijani nurse reads the screen in Azerbaijani. A template carries its code, and the form holds it back before it is sent. |
| X18 | **`dashboard/src/reachable.test.js` was red from Task 10 until Task 14 routed `/olcum`.** Accepted. | The test names every module under `src/` that the page cannot import. The bedside files (Tasks 10–13) land before the page that imports them (Task 14), so the sweep is red in between and goes green with the route. |
| X19 | **A withdrawal that leaves the patient no reading ends the patient's latches** with an `alert_cleared` row of reason `entered_in_error` (`ENTERED_IN_ERROR`; `entered_in_error_latches` lists them, `_publish_current` writes the rows first, then calls `store.forget_patient`). Restart == live (O4). Since X22 this cannot be reached from the screens and stays as a guard. | Kept, a latch would sit in the store with no card to show it, unacknowledgeable, and come back as «resolved, unacknowledged» with the next real reading; a restart, which skips the withdrawn rows, never builds it. Rows first, then memory, as X4: an append that fails leaves the latch for the retry to end. |
| X20 | **A withdrawal drops the escalation chain (`store.recent`) of every alert it clears,** so a real alert soon after gets its own clock and its own page to the doctor. This differs from X13 on purpose. Its reach also covers a real episode that a wrong value kept alive. | An episode the withdrawal ended stood on a value that was never real, so its chain is not remembered. A restart forgets every chain anyway (`rehydrate`). |
| X21 | **A 409 «already» finishes what a failed withdrawal left:** it repairs memory with no second append when the engine holds more copies of the withdrawn reading than a rebuild does; it always republishes the current card; and it stamps (row first) and tells an uncovered alert. | A withdrawal whose `chart_retract` row committed and whose later step raised answered 500 and left memory, the card or the nurse's notification behind. The retry finds the row, so its «already» answer is the one place that can finish the tail; every step is idempotent. |
| X22 | **Only `RETRACTABLE_CODES` can be withdrawn:** the bedside form's eight (the six `BEDSIDE_VITALS`, supplemental oxygen and ACVPU). Any other chart row is 409 `RETRACT_NOT_BEDSIDE` («yalnız yatak başı ölçümü hatalı giriş olarak işaretlenebilir»). The trend table offers the button only on bedside hand rows. | Found in the local walk. The physician's suspected-infection mark, the SOFA form's labs and the meds chart are chart rows too, but they are corrected by a new entry; the sepsis panel already says its mark cannot be taken back. |

## Open items

- **O1** (spec): NEWS2's age and pregnancy limits have no vault source. Not in this slice.
- **O3** (spec): the rebuild and the trends read scan one patient's rows with no `audit.patient_id` index. Trivial today (1 166 rows on the VM); an index comes in its own migration when the HIS feed returns.
- **O4** (spec): a latch created by a withdrawn value does not survive a restart.
- **O5** (spec): the az/ru/en strings are read by a native reader after the deploy.
- **O6 (new):** a withdrawal of a value whose rebuild would take longer than the audit read bound (30 s, `SET LOCAL`) answers 500. Nothing is written in that case (X4). Not reachable at today's sizes; O3's index removes it.
- **O7 (new):** notification ordering — at-least-once against at-most-once — on `/ingest` and the door. `for_new` marks a key as told before the publish and the audit row, so a failure between them loses the notification; and a restart re-tells and re-pages the live immediate alerts (seen in the walk). Also: with row-first stamping (X21), an X3-uncovered alert whose `first_seen` append failed is neither escalated nor told until a retry, and the trend table offers no retry button.
- **O8 (new):** after a restart, an alert a withdrawal uncovered keeps its original `first_seen` (the replay's T1), while live it is the withdrawal's time (T3). Next to O4.
- **O9 (new):** the rebuild replays the patient's whole stay on the event loop, and every 409 «already» now rebuilds too (X21). The cost grows with the stay. Next to O3 and O6.
- **O10 (new):** `alarm_quality` counts an `entered_in_error` episode as unanswered. Whether withdrawn episodes leave the figures is the owner's policy call.
- **O11 (new):** the decimal comma is used in the saved step only; the trend table, the card, the board and the trend dialog still print a dot.
- **O12 (new):** walk notes, all for later slices:
  - (d) the alarm-start marks of alerts that rested only on a withdrawn value stay in the trend tables;
  - (i) «RİSK: ÖLÇÜLMEDİ» shows beside a KRİTİK latch;
  - (f) the sepsis panel says «hekim işaretledi» when a nurse marked;
  - (g) engine texts carry UTC times («Sepsis recognized at 15:53»).
- **O13 (new):** `SofaEditors.jsx` and `MedsChartForm.jsx` have the same time-box `min` against check gap that Task 12 fixed for the bedside form.

## Record (final review and local walk)

- Task 1's review, item 6 (RR ≤ 80 for a NICU, temperature ≥ 25 °C, and the SOFA form's MAP 69.5 correction against a door that takes whole numbers only) was told to the owner. The recommendation is to keep the bounds as they are.
- The SOFA correction's reason is also free text, as the withdrawal's is (the G2-A4 precedent).
- The walk scored RR 26 / SpO₂ 91 / on oxygen as NEWS2 **8**, not 7: the plan's arithmetic was off.
- The guide's section became **§3.12** after the dalga-2 merge took §3.11; Task 17's block below keeps the number it was written with.
- The plan's code blocks keep their original strings and names. The code is the authority.

## Deploy notes

- api + web only, after B1d's deploy (one at a time). No migration. The hub is untouched. Blocks on the model of `G2B-ESLEME-bloklari.txt`:
  - rollback tags `:pre-g3vitals`;
  - C-0/C-1 shadow checks;
  - B-3's probes:
    - the preview route answers 401 without auth with a JSON body (`-d '{}'`);
    - the retract route answers 401 likewise;
    - `CHARTABLE` holds the six;
  - the web asset grep for `olcum`.
- **The ward is told beforehand:** a hand-entered NEWS2 now alerts, notifies the nurse and escalates (D9, X2).
- **Rollback:** the previous images. The block first prints `select count(*) from audit where event_type = 'chart_retract'`. Under the old images a withdrawn value counts again (D16).

---

## Baseline at `a0e3f3b` (measured 2026-11-02)

- **Engine, no database:** **3152 passed, 1110 skipped** (2 min 58 s).
- **Dashboard:** `npx vitest run` → **118 files / 3314 tests**, all passing. The build's precache count is measured in Task 0.

The gates' own numbers are the record. Each task names the test files it changes, and the counts it states are the plan's arithmetic.

---

## Ground rules for every task

- **Your worktree.** `/c/tmp/g3-vitals`, branch `feat/g3-yatak-basi-olcum`: the spec `03c365a`, then the main merge `a0e3f3b`, then this plan's commit.
  - **Never touch `/c/Users/User/Desktop/Project/Homunculus AI`** (the user's main checkout) or another `/c/tmp` worktree.
  - Never `git push`, never deploy, never change anything on a VM.
  - **Never run `git stash`.** The stash is shared with every other worktree and session.
- **The knowledge graph.** `graphify-out/` does not exist in this worktree (checked 2026-11-02). If it appears, the project rule applies: `graphify query "<question>"` before the first grep or source read.
- **Write and Edit tools only on repo files.** Never use `sed`, `python`, `node` or a shell heredoc to change one. The single exception: a NEW file is written with the Write tool and converted to **CRLF** by this one-line call, which touches only that file:
  ```bash
  /c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" <file>
  ```
  The tree checks out CRLF (`core.autocrlf=true`). Every block in this plan is LF, and the Edit tool matches either way. Each task ends by counting the line ends of the files it touched; CR must equal LF:
  ```bash
  for f in <files>; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
  ```
- **TDD.** Write the test, run it and **see it red for the reason the task names**, then write the code, then see it green. Put the red in the commit body.
- **Stage explicit paths only** (the task's `git add --` line). Before every commit run `git status --short` and `git diff --cached --stat`. If a staged path is not one the task lists, stop and ask.
- **Commit after every task that changes the repo.** The message is `type(scope): what, in words (G3-01, Dn/Xn)`. The body says what and why and the red that was seen. It ends with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```
- **Foreground gates.** Run every suite and build in the foreground, and report before waiting on anything. Never background a gate and wait on it. One Bash call runs at most 10 minutes; the whole no-DB suite fits (≈ 3 min).
- **Python commands** (always from the engine directory, always `PYTHONPATH=src`, always name files):
  ```bash
  cd /c/tmp/g3-vitals/homunculus-engine
  PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q <files> 2>&1 | tail -3
  ```
  - The whole no-DB suite: `... -m pytest -p no:cacheprovider -q -p no:warnings tests --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -3`.
  - **Never run `tests/test_infinity_vm_pilot.py`** (it hangs).
  - **Never set or export `DATABASE_URL`.** The Postgres tests take `TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test` on the command line only, against the container `homunculus-test-pg-56` (Tasks 7 and 18).
- **Dashboard commands** run from `/c/tmp/g3-vitals/dashboard`:
  - one file or a few: `./node_modules/.bin/vitest run <paths>`;
  - the whole suite: `./node_modules/.bin/vitest run`;
  - the build, as a separate command: `./node_modules/.bin/vite build`.
  Use the local binaries: `npx` has resolved a cached tool in this tree before. A `Warning: … not wrapped in act(...)` line is not a failure.
- **No patient data, ever** (CLAUDE.md rule 6). Use patients `S-001`, `S-002`, `yatak-1`, `bed-3`, names `Ayşe Sentetik` and `Vüsal Sınaq`, accounts `dr.elif` and `hem.ayse`. Every value is made up.
- **The clinical rule lives in the engine.** The browser prints the engine's NEWS2 (its total, its points per parameter, what is missing) and decides nothing clinical. It mirrors the door's slip bounds only to hold a slipped digit back.
- **Four languages for every key** (`tr` is the source; `az` is the default and the tests' language). An `az` text equal to `tr`, or an `ru` text with no Cyrillic, needs a reviewed entry in `strings.test.js`. If the test reports one, change the wording; do not list it. Russian calls the engine «система», never «движок».
- **Comments explain why**, in the register of the file. New lines are tagged `G3-01` with the decision (`D1`…`D16`) or the departure (`X1`…`X17`).
- **Report back:** DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED, the commit sha, the test counts, any deviation.

---

## File map

| File | Change | Task |
|---|---|---|
| `homunculus-engine/src/homunculus/api/clinical.py` | the six in `CHARTABLE` and `PLAUSIBLE`; `WHOLE_VITALS`, `BEDSIDE_VITALS`, the time bound and MAP < sistolik in `build_entries(..., now=)`; the module's rule 1 reworded (D5–D7, X6, X8, X12) | 1 |
| | `chart_observations(..., entry_ids=)` (D10) | 2 |
| | `RETRACT` and the withdrawal's constants (D10, D11, X11) | 5 |
| `homunculus-engine/src/homunculus/api/app.py` | `_recorded_at`; the door passes `now`; `CORRECTION_BOUNDS = PLAUSIBLE` (X7) | 1 |
| | the door's `entries` and its nurse notification (X2) | 2 |
| | `POST /clinical/{id}/preview` (D8, X10) | 3 |
| | `POST /clinical/{id}/entries/{entry}/retract`; `_ensure` skips withdrawn rows (D10–D12, X3, X4, X11) | 5 |
| `homunculus-engine/src/homunculus/api/audit.py` | `iter_records_of` (D10, D12) | 4 |
| `homunculus-engine/src/homunculus/api/rehydrate.py` | `REBUILD_EVENTS`, `observation_of`, `retracted_entries`, `rebuild_patient`, `rehydrate(..., skip=)` (D10, D12) | 4 |
| `homunculus-engine/src/homunculus/state/timeline.py` | `PatientState.remove` (X5) | 4 |
| `homunculus-engine/src/homunculus/api/infinity_rules.py` | `ShadowLane.retract_observation` (X5) | 5 |
| `homunculus-engine/src/homunculus/api/trends.py` | `manual` per channel, `manual_truncated` (D13, X1) | 6 |
| `homunculus-engine/tests/test_bedside_door.py` (new) | the door's bedside set | 1, 2 |
| `homunculus-engine/tests/test_api_clinical.py`, `tests/scoring/test_signing.py` | X8 | 1 |
| `homunculus-engine/tests/test_bedside_preview.py` (new) | the preview | 3 |
| `homunculus-engine/tests/test_bedside_rebuild.py` (new) | the trail helpers | 4 |
| `homunculus-engine/tests/test_bedside_retract.py` (new), `tests/test_api_shadow_findings.py` | the withdrawal, the restart, the shadow lane | 5 |
| `homunculus-engine/tests/test_trends_manual.py` (new) | trends | 6 |
| `homunculus-engine/tests/test_bedside_trail_stores.py` (new) | memory, SQLite and Postgres stores alike | 7 |
| `dashboard/src/backendApi.js`, `backendApi.test.js`, `live/session/testTokens.testutil.js`, `live/data/boardStore.js`, `boardStore.test.js` | `previewChart`, `retractEntry`; the store's `chartPreview`, `retract` | 8 |
| `dashboard/src/live/i18n/strings/olcum.js` (new), `live/i18n/catalog.js` | the `olcum` namespace | 9 |
| `dashboard/src/live/screens/bedside/vitalsFields.js` (new), `vitalsFields.test.js` (new) | the eight inputs and the rules | 10 |
| `dashboard/src/live/apiErrors.js`, `apiErrors.test.js`, `live/i18n/strings/errors.js` | the door's new refusals in the reader's words (X17) | 11 |
| `dashboard/src/live/screens/bedside/PreviewPanel.jsx`, `VitalsForm.jsx`, `VitalsForm.test.jsx` (new) | the form and its preview | 12 |
| `dashboard/src/live/screens/common/RetractDialog.jsx`, `RetractDialog.test.jsx`, `screens/bedside/SavedStep.jsx`, `SavedStep.test.jsx` (new) | «hatalı giriş», the saved step (X15) | 13 |
| `dashboard/src/live/screens/bedside/BedsideScreen.jsx`, `BedsideScreen.test.jsx` (new), `live/shell/routes.js`, `routes.test.js` | the page and its route | 14 |
| `dashboard/src/live/screens/patient/VitalsEntry.jsx` (new), `PatientScreen.jsx`, `PatientScreen.test.jsx`, `i18n/strings/patient.js` | «Ölçüm gir»; `onlyWrite` | 15 |
| `dashboard/src/live/screens/patient/trends/trendGeometry.js`, `trendGeometry.test.js`, `trends.testutil.js`, `TrendCard.jsx`, `TrendCard.test.jsx`, `TrendChart.jsx`, `TrendTable.jsx`, `TrendModal.jsx`, `TrendModal.test.jsx`, `TrendsBox.jsx` | «elle», the withdraw button, struck rows, crossed dots (X13, X16) | 16 |
| `docs/homunculus-rehber-TR.md`, the roadmap | the guide's §3.11, the row | 17 |
| — | the gates, the final review, the local walk | 18 |

---

### Task 0: The worktree, the shared install and the baseline

**Files:** none changed.

- [ ] **Step 1: The worktree and the branch**

```bash
cd /c/tmp/g3-vitals && git status --short && git rev-parse --abbrev-ref HEAD && git log --oneline -4
```

Expected: no status output except the `dashboard/node_modules` junction (untracked and ignored, so not listed); `feat/g3-yatak-basi-olcum`; this plan's commit on top of `a0e3f3b`.

- [ ] **Step 2: The `node_modules` junction**

```powershell
Get-Item C:\tmp\g3-vitals\dashboard\node_modules | Select-Object LinkType, Target | Format-List
```

Expected: `LinkType : Junction`, `Target : {C:\tmp\homunculus-g1\dashboard\node_modules}`. The controller created it on 2026-11-02. **It is the shared install:**
- never delete through it, and never reinstall into it;
- before this worktree is removed, unlink it first: `cmd /c rmdir "C:\tmp\g3-vitals\dashboard\node_modules"` from PowerShell removes the link only;
- only then run `git worktree remove`.

- [ ] **Step 3: The engine baseline**

```bash
cd /c/tmp/g3-vitals/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -3
```

Expected: `3152 passed, 1110 skipped`.

- [ ] **Step 4: The dashboard baseline and the build**

```bash
cd /c/tmp/g3-vitals/dashboard && ./node_modules/.bin/vitest run 2>&1 | tail -5
cd /c/tmp/g3-vitals/dashboard && ./node_modules/.bin/vite build 2>&1 | tail -6
```

Expected:
- the tests: `Test Files  118 passed (118)`, `Tests  3314 passed (3314)`;
- the build: a `precache  N entries` line and no `larger than 500 kB`. Write N into the report; Task 18's build must print the same N.

---

### Task 1: The door takes the bedside set — units, slip bounds, whole numbers, MAP below the systolic, the time bound (D5–D7, X6–X8, X12)

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/clinical.py`
- Modify: `homunculus-engine/src/homunculus/api/app.py`
- Modify: `homunculus-engine/tests/test_api_clinical.py:155-159`, `homunculus-engine/tests/scoring/test_signing.py:719-736`
- Create: `homunculus-engine/tests/test_bedside_door.py`

- [ ] **Step 1: Write the failing tests**

Create `homunculus-engine/tests/test_bedside_door.py`:

```python
"""G3-01 (D5–D7, X6, X12): the chart door takes the bedside set — the five vitals and MAP — in the trend
endpoint's units, held to slip bounds, whole numbers where a monitor counts, MAP below the systolic within one
request, and a measurement time at most a day back and never ahead. Synthetic patients and values only
(CLAUDE.md rule 6)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api import trends
from homunculus.api.app import create_app
from homunculus.api.clinical import (
    AT_FUTURE, AT_TOO_OLD, BEDSIDE_VITALS, CHARTABLE, MAP_NOT_BELOW_SBP, ClinicalEntryError, build_entries,
)
from homunculus.canonical import SignalCode
from homunculus.rules.news2 import points_for

TOKEN = "tok"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
# A full bedside set, every value inside its bound (synthetic).
SET = [{"code": "resp_rate", "value": 22}, {"code": "spo2", "value": 95}, {"code": "sbp", "value": 104},
       {"code": "map", "value": 72}, {"code": "heart_rate", "value": 96}, {"code": "temperature", "value": 37.9}]


@pytest.fixture()
def client():
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False)
    with TestClient(app) as c:
        yield c


def _ago(minutes: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()


def _chart(client, entries, at=None, pid="bed-3"):
    body = {"entries": entries}
    if at is not None:
        body["recorded_at"] = at
    return client.post(f"/clinical/{pid}", json=body, headers=AUTH)


def _card(client, pid="bed-3"):
    return next(p for p in client.get("/patients", headers=AUTH).json()["patients"] if p["patient_id"] == pid)


class TestTheSixAreChartable:
    def test_the_bedside_set_is_the_six_codes_the_door_opened(self):
        assert BEDSIDE_VITALS == {SignalCode.RESP_RATE, SignalCode.SPO2, SignalCode.SBP, SignalCode.MAP,
                                  SignalCode.HEART_RATE, SignalCode.TEMPERATURE}
        assert BEDSIDE_VITALS <= set(CHARTABLE)

    def test_each_unit_is_the_trend_endpoints(self):
        """X6: one unit per channel for the door and the charts; no rule reads it."""
        for code in BEDSIDE_VITALS:
            assert CHARTABLE[code] == trends._UNITS[code.value], code

    def test_a_full_set_charts_in_one_request(self, client):
        r = _chart(client, SET, at=_ago(5))
        assert r.status_code == 200, r.text
        assert r.json()["charted"] == 6

    def test_the_card_scores_hand_entered_vitals_with_the_engines_points(self, client):
        assert _chart(client, SET, at=_ago(5)).status_code == 200
        breakdown = _card(client)["latest"]["news2"]["breakdown"]
        assert breakdown["respiration_rate"] == points_for("respiration_rate", 22)
        assert breakdown["spo2"] == points_for("spo2", 95)
        assert breakdown["systolic_bp"] == points_for("systolic_bp", 104)
        assert breakdown["pulse"] == points_for("pulse", 96)
        assert breakdown["temperature"] == points_for("temperature", 37.9)


class TestTheSlipBounds:
    @pytest.mark.parametrize("code,value", [("resp_rate", 81), ("spo2", 101), ("sbp", 301), ("map", 301),
                                            ("heart_rate", 301), ("temperature", 24.9), ("temperature", 45.1)])
    def test_a_slipped_digit_is_refused(self, client, code, value):
        r = _chart(client, [{"code": code, "value": value}])
        assert r.status_code == 400
        assert "aralığın" in r.json()["detail"]

    @pytest.mark.parametrize("code,value", [("resp_rate", 0), ("spo2", 100), ("sbp", 300), ("heart_rate", 0),
                                            ("temperature", 25), ("temperature", 45)])
    def test_the_bounds_are_inclusive(self, client, code, value):
        assert _chart(client, [{"code": code, "value": value}]).status_code == 200

    @pytest.mark.parametrize("code", ["resp_rate", "spo2", "sbp", "map", "heart_rate"])
    def test_a_counted_vital_is_a_whole_number(self, client, code):
        r = _chart(client, [{"code": code, "value": 88.5}])
        assert (r.status_code, r.json()["detail"]) == (400, f"{code}: tam sayı olmalı")

    def test_a_temperature_takes_a_decimal(self, client):
        assert _chart(client, [{"code": "temperature", "value": 36.8}]).status_code == 200


class TestMapBelowTheSystolic:
    @pytest.mark.parametrize("map_value", [90, 95])
    def test_map_at_or_above_the_systolic_in_one_request_is_refused(self, client, map_value):
        r = _chart(client, [{"code": "sbp", "value": 90}, {"code": "map", "value": map_value}])
        assert (r.status_code, r.json()["detail"]) == (400, MAP_NOT_BELOW_SBP)

    def test_map_below_the_systolic_is_charted(self, client):
        assert _chart(client, [{"code": "sbp", "value": 90}, {"code": "map", "value": 65}]).status_code == 200

    def test_a_map_alone_is_not_compared_with_an_older_systolic(self, client):
        """The rule is about one form's two numbers; a MAP charted on its own is a reading of its own."""
        assert _chart(client, [{"code": "sbp", "value": 90}]).status_code == 200
        assert _chart(client, [{"code": "map", "value": 95}]).status_code == 200


class TestTheMeasurementTime:
    def test_a_bedside_time_more_than_a_day_back_is_refused(self, client):
        r = _chart(client, [{"code": "heart_rate", "value": 80}], at=_ago(25 * 60))
        assert (r.status_code, r.json()["detail"]) == (400, AT_TOO_OLD)

    def test_a_bedside_time_within_the_day_is_charted(self, client):
        assert _chart(client, [{"code": "heart_rate", "value": 80}], at=_ago(23 * 60)).status_code == 200

    def test_a_bedside_time_ahead_of_the_clock_is_refused(self, client):
        r = _chart(client, [{"code": "heart_rate", "value": 80}], at=_ago(-10))
        assert (r.status_code, r.json()["detail"]) == (400, AT_FUTURE)

    def test_two_minutes_of_clock_skew_are_not_ahead(self, client):
        assert _chart(client, [{"code": "heart_rate", "value": 80}], at=_ago(-1)).status_code == 200

    def test_no_time_is_the_servers_clock(self, client):
        """X12: an untouched time is sent as none; nothing to bound."""
        assert _chart(client, [{"code": "heart_rate", "value": 80}]).status_code == 200

    def test_the_other_codes_keep_todays_rule(self, client):
        """D7: ACVPU, oxygen and the labs are charted at fixed past times by today's callers and tests."""
        old = datetime(2026, 9, 8, 9, 0, tzinfo=timezone.utc).isoformat()
        r = _chart(client, [{"code": "lactate", "value": 3.4}, {"code": "acvpu", "value": 0}], at=old)
        assert r.status_code == 200, r.text

    def test_build_entries_holds_the_rule_without_the_api(self):
        now = datetime(2026, 11, 2, 9, 0, tzinfo=timezone.utc)
        with pytest.raises(ClinicalEntryError, match="24 saat"):
            build_entries("bed-3", [{"code": "spo2", "value": 95}], charted_by="hem.ayse",
                          recorded_at=now - timedelta(hours=25), now=now)
```

Then change the two existing tests (X8). In `homunculus-engine/tests/test_api_clinical.py` replace:

```python
    def test_a_device_channel_cannot_be_typed_in_by_hand(self, client):
        """A hand-typed heart rate would be indistinguishable from a monitored one."""
        r = _chart(client, "bed-3", [{"code": "heart_rate", "value": 88}])
        assert r.status_code == 400
        assert "cihazdan" in r.json()["detail"]
```

with:

```python
    def test_a_code_outside_the_chartable_set_says_it_comes_from_a_device(self, client, monkeypatch):
        """G3-01 (X8): since the bedside set opened, every signal is chartable. A typed value is told from a
        monitored one by its source («elle» on the board), and the refusal stays for the next device-only code."""
        from homunculus.api import clinical
        monkeypatch.delitem(clinical.CHARTABLE, SignalCode.HEART_RATE)
        r = _chart(client, "bed-3", [{"code": "heart_rate", "value": 88}])
        assert r.status_code == 400
        assert "cihazdan" in r.json()["detail"]
```

In `homunculus-engine/tests/scoring/test_signing.py` replace:

```python
        bound the signing helper adds for it (0–300 mmHg). The door still refuses MAP; the MAP corrected here
        is a monitor's reading (review 3, M-2: only a measured value is corrected)."""
```

with:

```python
        bound the signing helper adds for it (0–300 mmHg). Since G3-01 the door takes MAP too, inside the same
        bound (X8); the MAP corrected here is a monitor's reading (review 3, M-2: only a measured value is corrected)."""
```

and replace:

```python
        door = client.post("/clinical/yatak-1", headers=AUTH, json={"entries": [{"code": "map", "value": 65}]})
        assert door.status_code == 400 and "elle girilemez" in door.json()["detail"]
```

with:

```python
        # G3-01 (X8): MAP is charted at the bedside form now; the door takes it, held to the same bound.
        door = client.post("/clinical/yatak-1", headers=AUTH, json={"entries": [{"code": "map", "value": 65}]})
        assert door.status_code == 200, door.text
```

- [ ] **Step 2: Run them and see them red**

```bash
cd /c/tmp/g3-vitals/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_bedside_door.py tests/test_api_clinical.py tests/scoring/test_signing.py 2>&1 | tail -5
```

Expected: `test_bedside_door.py` fails at collection with `ImportError: cannot import name 'AT_FUTURE'`. Then `test_signing.py::…map_correction…` fails on `assert 400 == 200`. The changed `test_api_clinical.py` test passes already: the refusal branch exists.

- [ ] **Step 3: The door**

In `homunculus-engine/src/homunculus/api/clinical.py` replace the module docstring's first rule:

```python
1. **A clinician may chart only what a clinician observes.** Device channels are not writable
   here. A hand-typed heart rate would be indistinguishable from a monitored one the moment it
   landed, and the board would have no way to tell a reading from a typo. One device-derived flag
   is the exception: `ON_RESP_SUPPORT` (G2-A4, X16 — see its `CHARTABLE` entry for why).
```

with:

```python
1. **A typed value is always told from a measured one.** Every observation this door builds is
   stamped `source_device` "clinician", and the board prints it «elle». Until G3-01 the device
   channels were not writable here at all. Since then the bedside set — the five vitals and MAP — is
   (G3-01, D5): the ward's HIS feed that carried a nurse's vitals is silent, and the monitors feed
   only the shadow engine. A wrong hand entry is withdrawn as «hatalı giriş», never edited
   (`api/app.py`, the retract route, which rebuilds the patient without it). One device-derived flag
   was chartable before them: `ON_RESP_SUPPORT` (G2-A4, X16 — see its `CHARTABLE` entry for why).
```

In `CHARTABLE` replace:

```python
    SignalCode.WHITE_CELL_COUNT: "10^3/mm3",
}
```

with:

```python
    SignalCode.WHITE_CELL_COUNT: "10^3/mm3",
    # G3-01 (D5, X6): the bedside set a nurse measures and types — the five vitals and MAP. Each keeps the
    # provenance `build_entries` stamps ("clinician"), which the board prints as «elle». The units are the
    # trend endpoint's (`api/trends.py` `_UNITS`), pinned equal by tests/test_bedside_door.py; no rule reads one.
    SignalCode.RESP_RATE: "/min",
    SignalCode.SPO2: "%",
    SignalCode.SBP: "mmHg",
    SignalCode.MAP: "mmHg",
    SignalCode.HEART_RATE: "/min",
    SignalCode.TEMPERATURE: "°C",
}
```

In `PLAUSIBLE` replace:

```python
    SignalCode.PAO2_FIO2: (20.0, 700.0),          # mmHg (CHARTABLE: "ratio")
}
```

with:

```python
    SignalCode.PAO2_FIO2: (20.0, 700.0),          # mmHg (CHARTABLE: "ratio")
    # G3-01 (D6): the bedside set's slip bounds — a slipped digit or a unit, never a clinical threshold: NEWS2's
    # bands live in rules/news2.py alone. MAP's is the SOFA correction's (X7).
    SignalCode.RESP_RATE: (0.0, 80.0),            # /min
    SignalCode.SPO2: (0.0, 100.0),                # %
    SignalCode.SBP: (0.0, 300.0),                 # mmHg
    SignalCode.MAP: (0.0, 300.0),                 # mmHg
    SignalCode.HEART_RATE: (0.0, 300.0),          # /min
    SignalCode.TEMPERATURE: (25.0, 45.0),         # °C
}
```

After `GCS_NOT_WHOLE = "GCS tam sayı olmalı"` add:

```python

#: G3-01 (D6): the bedside values counted in whole units, as a monitor shows them and the form asks for them.
WHOLE_VITALS = frozenset({SignalCode.RESP_RATE, SignalCode.SPO2, SignalCode.SBP, SignalCode.MAP,
                          SignalCode.HEART_RATE})
NOT_WHOLE = "{code}: tam sayı olmalı"
#: G3-01 (D6): within one request — one form — the mean pressure is below the systolic.
MAP_NOT_BELOW_SBP = "MAP sistolik basınçtan küçük olmalı"
#: G3-01 (D7, X12): the six codes this slice opened, held to the measurement-time rule when a time is sent:
#: at most a day back, never ahead (two minutes of clock skew allowed). The other codes keep today's rule.
BEDSIDE_VITALS = frozenset({SignalCode.RESP_RATE, SignalCode.SPO2, SignalCode.SBP, SignalCode.MAP,
                            SignalCode.HEART_RATE, SignalCode.TEMPERATURE})
BEDSIDE_BACKDATE = timedelta(hours=24)
BEDSIDE_SKEW = timedelta(minutes=2)
AT_TOO_OLD = "ölçüm saati en çok 24 saat geriye alınabilir"
AT_FUTURE = "ölçüm saati ileri olamaz"
```

In `_value` replace:

```python
        raise ClinicalEntryError(GCS_NOT_WHOLE)
    low, high = PLAUSIBLE.get(code, (float("-inf"), float("inf")))
```

with:

```python
        raise ClinicalEntryError(GCS_NOT_WHOLE)
    if code in WHOLE_VITALS and not value.is_integer():
        # G3-01 (D6): 88.5 beats a minute is a slip, not a reading.
        raise ClinicalEntryError(NOT_WHOLE.format(code=code.value))
    low, high = PLAUSIBLE.get(code, (float("-inf"), float("inf")))
```

Replace the head of `build_entries`:

```python
def build_entries(patient_id: str, entries: list[dict], *, charted_by: str,
                  recorded_at: datetime | None = None) -> list[ChartedEntry]:
```

with:

```python
def build_entries(patient_id: str, entries: list[dict], *, charted_by: str,
                  recorded_at: datetime | None = None,
                  now: datetime | None = None) -> list[ChartedEntry]:
```

and its end:

```python
            charted_by=charted_by,
        ))
    return built
```

with:

```python
            charted_by=charted_by,
        ))
    _check_bedside(built, recorded_at, now or datetime.now(timezone.utc))
    return built


def _check_bedside(built: list[ChartedEntry], recorded_at: datetime | None, now: datetime) -> None:
    """G3-01 (D6, D7, X12): the bedside set's two rules that read more than one value. The time is bounded
    only when one was sent (an untouched time is the server's clock), and only for a request that charts one
    of the six; MAP is compared with a systolic in the SAME request — one form's two numbers, not an older
    reading's. Raises with the clinician's sentence; all-or-nothing, as the loop above."""
    codes = {item.observation.code for item in built}
    if recorded_at is not None and codes & BEDSIDE_VITALS:
        if recorded_at < now - BEDSIDE_BACKDATE:
            raise ClinicalEntryError(AT_TOO_OLD)
        if recorded_at > now + BEDSIDE_SKEW:
            raise ClinicalEntryError(AT_FUTURE)
    values = {item.observation.code: item.observation.value for item in built}
    if SignalCode.MAP in values and SignalCode.SBP in values and values[SignalCode.MAP] >= values[SignalCode.SBP]:
        raise ClinicalEntryError(MAP_NOT_BELOW_SBP)
```

In `homunculus-engine/src/homunculus/api/app.py`:

1. Replace the correction bounds (X7):

```python
#: G2-A4 review: the slip bounds a SOFA correction is held to — the charting door's PLAUSIBLE, and one for
#: MAP, which the door does not need (MAP is not chartable there) but the cardiovascular row's MAP can be
#: corrected. An engineering slip bound against a slipped digit (9000 for 90) or a unit, far outside any
#: pressure a monitor reports; never a clinical threshold — the SOFA table stays the only judge of a value.
CORRECTION_BOUNDS = {**PLAUSIBLE, SignalCode.MAP: (0.0, 300.0)}
```

with:

```python
#: G2-A4 review: the slip bounds a SOFA correction is held to — the charting door's PLAUSIBLE. G3-01 (X7): MAP,
#: once an extra bound here (the door did not take it), is in PLAUSIBLE now with the same 0–300 mmHg. An
#: engineering slip bound against a slipped digit (9000 for 90) or a unit, never a clinical threshold — the
#: SOFA table stays the only judge of a value.
CORRECTION_BOUNDS = PLAUSIBLE
```

2. Before `@dataclass(frozen=True)` / `class _SofaToSign:` add:

```python
def _recorded_at(body: dict) -> datetime | None:
    """A charting request's measurement time, or None for the server's clock (G3-01: the door and its
    preview read it alike)."""
    stamp = body.get("recorded_at")
    try:
        return datetime.fromisoformat(stamp) if stamp else None
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="geçersiz recorded_at") from None


```

3. In the chart route replace:

```python
        stamp = body.get("recorded_at")
        try:
            recorded_at = datetime.fromisoformat(stamp) if stamp else None
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="geçersiz recorded_at") from None

        try:
            charted = build_entries(patient_id, body.get("entries") or [],
                                    charted_by=_charted_by(caller),
                                    recorded_at=recorded_at)
        except ClinicalEntryError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from None
```

with:

```python
        recorded_at = _recorded_at(body)
        # One wall-clock instant per request, as in /ingest (G2-A2, X10) — taken before the entries are
        # built, because the bedside set's time bound is judged at it (G3-01, D7); the loop below runs at it.
        now = datetime.now(timezone.utc)
        try:
            charted = build_entries(patient_id, body.get("entries") or [],
                                    charted_by=_charted_by(caller),
                                    recorded_at=recorded_at, now=now)
        except ClinicalEntryError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from None
```

and further down replace:

```python
        # One wall-clock instant per request, as in /ingest (G2-A2, X10); the loop itself is
        # `chart_observations` (G2-A11, D8 — X62), shared with the admission form.
        now = datetime.now(timezone.utc)
        alerts = chart_observations(
```

with:

```python
        # The loop itself is `chart_observations` (G2-A11, D8 — X62), shared with the admission form, run at
        # the request's one instant (`now`, above).
        alerts = chart_observations(
```

- [ ] **Step 4: Run them and see them green**

```bash
cd /c/tmp/g3-vitals/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_bedside_door.py tests/test_api_clinical.py tests/scoring/test_signing.py tests/test_board_freshness.py 2>&1 | tail -3
```

Expected: all pass. `test_bedside_door.py` contributes 34 tests (the parametrised cases count one each).

- [ ] **Step 5: The whole no-DB suite, line ends, commit**

```bash
cd /c/tmp/g3-vitals/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -3
```

Expected: `3186 passed, 1110 skipped` (3152 + 34). If another test charted a vital expecting a refusal, it shows here: it is X8's kind. Change it as Step 1 changed the two, and name it in the report.

```bash
cd /c/tmp/g3-vitals && /c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" homunculus-engine/tests/test_bedside_door.py
for f in homunculus-engine/src/homunculus/api/clinical.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_bedside_door.py homunculus-engine/tests/test_api_clinical.py homunculus-engine/tests/scoring/test_signing.py; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- homunculus-engine/src/homunculus/api/clinical.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_bedside_door.py homunculus-engine/tests/test_api_clinical.py homunculus-engine/tests/scoring/test_signing.py
git status --short && git diff --cached --stat
git commit -m "feat(clinical): the door takes the bedside set — five vitals and MAP, slip bounds, whole numbers, MAP below the systolic, a day back at most (G3-01, D5–D7, X6–X8, X12)" -m "<the red you saw, and the body>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The door names its rows and tells the nurse (D10, X2)

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/clinical.py` (`chart_observations`)
- Modify: `homunculus-engine/src/homunculus/api/app.py` (the chart route)
- Modify: `homunculus-engine/tests/test_bedside_door.py` (two classes appended)

- [ ] **Step 1: Write the failing tests**

Append to `homunculus-engine/tests/test_bedside_door.py`:

```python


# RR 26, SpO₂ 91, systolic 88: three parameters scoring 3 — NEWS2 9, the engine's immediate band.
RISKY = [{"code": "resp_rate", "value": 26}, {"code": "spo2", "value": 91}, {"code": "sbp", "value": 88}]


def _rows(client, kind):
    return client.app.state.audit.records(tenant="h1", event_type=kind, limit=100)


class TestTheDoorNamesItsRows:
    def test_the_answer_names_each_values_chart_row_in_request_order(self, client):
        """D10: the withdrawal is addressed by the `chart` row; the door says which rows it wrote."""
        r = _chart(client, SET[:2], at=_ago(5))
        assert r.status_code == 200, r.text
        entries = r.json()["entries"]
        assert [e["code"] for e in entries] == ["resp_rate", "spo2"]
        assert [e["entry"] for e in entries] == [row.id for row in _rows(client, "chart")]

    def test_a_discharged_number_names_no_row(self):
        """A tombstone's charts are dropped, not written (G2-A11, D3): there is no row to name."""
        from homunculus.api.patient_identity import KABUL, IdentityRecord, InMemoryIdentityStore
        store = InMemoryIdentityStore()
        store.apply("h1", IdentityRecord(patient_id="bed-9", state="discharged", source=KABUL,
                                         updated_at=datetime.now(timezone.utc)))
        app = create_app({TOKEN: "h1"}, run_escalation_loop=False, identities=store)
        with TestClient(app) as c:
            r = _chart(c, [{"code": "heart_rate", "value": 80}], pid="bed-9")
            assert r.status_code == 200, r.text
            assert r.json().get("entries") in (None, [])


class TestTheNurseIsTold:
    def test_an_immediate_alert_from_hand_vitals_notifies_the_nurse(self, client):
        """X2: as /ingest does for a device's reading."""
        r = _chart(client, RISKY, at=_ago(5))
        assert "news2" in r.json()["alerts"]
        notes = _rows(client, "notification")
        assert [(n.patient_id, n.subject, n.payload["audience"], n.payload["trigger"]) for n in notes] == [
            ("bed-3", "news2", "nurse", "new")]

    def test_the_same_alert_is_not_told_twice(self, client):
        for _ in range(2):
            _chart(client, RISKY, at=_ago(5))
        assert len(_rows(client, "notification")) == 1

    def test_a_routine_entry_tells_nobody(self, client):
        _chart(client, [{"code": "temperature", "value": 37.0}])
        assert _rows(client, "notification") == []
```

(The discharged case builds its own app with an `InMemoryIdentityStore`: `app.state` holds no identity store — checked 2026-11-02.)

- [ ] **Step 2: Run them and see them red**

```bash
cd /c/tmp/g3-vitals/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_bedside_door.py 2>&1 | tail -5
```

Expected:
- `KeyError: 'entries'` in the first test;
- `assert [] == [('bed-3', 'news2', 'nurse', 'new')]` and `assert 0 == 1` in the notification tests;
- the routine and discharged tests pass already.

- [ ] **Step 3: The rows and the notification**

In `homunculus-engine/src/homunculus/api/clinical.py` replace the head of `chart_observations`:

```python
def chart_observations(engine: Engine, store: AckStore, audit: AuditLog, notifier: Notifier,
                       hospital: str, patient_id: str, charted: list[ChartedEntry],
                       now: datetime, escalate_after: timedelta,
                       mirror: Callable[[Observation], None] | None = None) -> list[Alert]:
```

with:

```python
def chart_observations(engine: Engine, store: AckStore, audit: AuditLog, notifier: Notifier,
                       hospital: str, patient_id: str, charted: list[ChartedEntry],
                       now: datetime, escalate_after: timedelta,
                       mirror: Callable[[Observation], None] | None = None,
                       entry_ids: list[tuple[str, int]] | None = None) -> list[Alert]:
```

At the end of the docstring, before the closing `"""`, add the sentence:

```
    `entry_ids`, when given, receives `(code, id)` of each `chart` row as it is written, in request order —
    the door answers them, and a withdrawal (G3-01, D10) is addressed by that id.
```

Replace the row's append:

```python
        audit.append(AuditEvent(hospital, "chart", obs.patient_id, obs.code.value,
                                {"value": obs.value, "unit": obs.unit,
                                 "obs_ts": obs.timestamp.isoformat(),
                                 "charted_by": item.charted_by}))
```

with:

```python
        written = audit.append(AuditEvent(hospital, "chart", obs.patient_id, obs.code.value,
                                          {"value": obs.value, "unit": obs.unit,
                                           "obs_ts": obs.timestamp.isoformat(),
                                           "charted_by": item.charted_by}))
        if entry_ids is not None:
            entry_ids.append((obs.code.value, written.id))
```

In `homunculus-engine/src/homunculus/api/app.py`, in the chart route, replace:

```python
        alerts = chart_observations(engine, store, audit, notifier, hospital, patient_id, charted,
                                    now, escalate_after,
                                    mirror=lambda o: app.state.shadow_mirror(hospital, o, now))
        # A kind charting ended has left the live keys: a nurse is told again if it returns (D5).
        notifier.prune(hospital, live_keys(engine, store))

        board = _card(hospital, patient_id, record)
        await broadcaster.publish(hospital, board)
        return {"patient_id": patient_id, "charted": len(charted),
                "alerts": [a.kind for a in alerts]}
```

with:

```python
        written: list[tuple[str, int]] = []
        alerts = chart_observations(engine, store, audit, notifier, hospital, patient_id, charted,
                                    now, escalate_after,
                                    mirror=lambda o: app.state.shadow_mirror(hospital, o, now),
                                    entry_ids=written)
        # A kind charting ended has left the live keys: a nurse is told again if it returns (D5).
        notifier.prune(hospital, live_keys(engine, store))

        board = _card(hospital, patient_id, record)
        await broadcaster.publish(hospital, board)
        # G3-01 (X2): a newly immediate alert from a charted value tells the nurse, as /ingest's reading does —
        # the hand-entered NEWS2 was designed to alert like a device's (D9). The notifier's dedup sends nothing
        # for an alert already told.
        for note in notifier.for_new(hospital, engine.active_alerts(patient_id)):
            await hub.publish(hospital, note)
            audit.append(AuditEvent(hospital, "notification", note.patient_id, note.kind,
                                    {"audience": note.audience, "trigger": note.trigger}))
        notifier.prune(hospital, live_keys(engine, store))
        return {"patient_id": patient_id, "charted": len(charted),
                "alerts": [a.kind for a in alerts],
                # G3-01 (D10): each value's `chart` row, the id a «hatalı giriş» names.
                "entries": [{"code": code, "entry": entry} for code, entry in written]}
```

If the old block is not found word for word, read the route (`grep -n '@app.post("/clinical/{patient_id}")' …/app.py`) and make the same three changes in place:
- pass `entry_ids=written`;
- add the `for_new` loop after the publish;
- add `entries` to the answer.

The route's other lines stay as they are.

- [ ] **Step 4: Green, then the suites around the door**

```bash
cd /c/tmp/g3-vitals/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_bedside_door.py tests/test_api_clinical.py tests/test_kabul_boardlink.py tests/test_alert_lifecycle.py tests/test_api_audit.py 2>&1 | tail -3
```

Expected: all pass (`test_bedside_door.py` now 39).

- [ ] **Step 5: Line ends and commit**

```bash
cd /c/tmp/g3-vitals && for f in homunculus-engine/src/homunculus/api/clinical.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_bedside_door.py; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- homunculus-engine/src/homunculus/api/clinical.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_bedside_door.py
git status --short && git diff --cached --stat
git commit -m "feat(clinical): the door names each value's chart row and tells the nurse of a new immediate alert (G3-01, D10, X2)" -m "<the red you saw, and the body>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The preview — the card's NEWS2 of a copy, nothing written (D8, X10)

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/app.py` (imports; a route after the chart route)
- Create: `homunculus-engine/tests/test_bedside_preview.py`

- [ ] **Step 1: Write the failing tests**

Create `homunculus-engine/tests/test_bedside_preview.py`:

```python
"""G3-01 (D8, X10): the preview scores what the chart door would chart — the card's own NEWS2 of a copy of
the patient's state with the entries added — and writes nothing. Synthetic patients and values only."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.clinical import MAP_NOT_BELOW_SBP
from homunculus.api.identity import Caller
from homunculus.rules.news2 import points_for

TOKEN = "tok"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
NURSE = {"Authorization": "Bearer nurse-jwt"}
VIEWER = {"Authorization": "Bearer viewer-jwt"}
RISKY = [{"code": "resp_rate", "value": 26}, {"code": "spo2", "value": 91}, {"code": "sbp", "value": 88}]
PEOPLE = {
    "nurse-jwt": Caller(hospital="h1", actor="hem.ayse", groups=("nurse",),
                        perms=frozenset({"board.view", "clinical.chart"})),
    "viewer-jwt": Caller(hospital="h1", actor="dr.elif", groups=("physician",), perms=frozenset({"board.view"})),
}


async def _resolve(credential: str):
    return PEOPLE.get(credential)


@pytest.fixture()
def client():
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve)
    with TestClient(app) as c:
        yield c


def _ago(minutes: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()


def _preview(client, entries, at=None, headers=AUTH, pid="bed-3"):
    body = {"entries": entries} | ({"recorded_at": at} if at else {})
    return client.post(f"/clinical/{pid}/preview", json=body, headers=headers)


def _chart(client, entries, at=None, pid="bed-3"):
    body = {"entries": entries} | ({"recorded_at": at} if at else {})
    return client.post(f"/clinical/{pid}", json=body, headers=AUTH)


def _patients(client):
    return client.get("/patients", headers=AUTH).json()["patients"]


def _card(client, pid="bed-3"):
    return next(p for p in _patients(client) if p["patient_id"] == pid)


class TestThePreview:
    def test_it_answers_the_cards_news2_for_the_entries(self, client):
        r = _preview(client, RISKY, at=_ago(5))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["preview"] is True
        news2 = body["news2"]
        assert news2["breakdown"]["respiration_rate"] == points_for("respiration_rate", 26)
        assert news2["partial"] is True and "pulse" in news2["missing"]

    def test_it_writes_nothing_and_creates_no_patient(self, client):
        before = len(client.app.state.audit.records(tenant="h1", limit=10_000))
        assert _preview(client, RISKY, at=_ago(5)).status_code == 200
        assert len(client.app.state.audit.records(tenant="h1", limit=10_000)) == before
        assert all(p["patient_id"] != "bed-3" for p in _patients(client))

    def test_it_leaves_a_measured_patient_as_it_was(self, client):
        assert _chart(client, [{"code": "heart_rate", "value": 80}], at=_ago(10)).status_code == 200
        card = _card(client)
        assert _preview(client, RISKY, at=_ago(5)).status_code == 200
        after = _card(client)
        assert after["latest"]["news2"]["breakdown"] == card["latest"]["news2"]["breakdown"]
        assert after["alerts"] == card["alerts"]

    def test_its_news2_is_the_cards_after_the_same_entries_are_saved(self, client):
        """D8's parity, by construction (X10): one function, one state, the same values at the same time."""
        at = _ago(5)
        preview = _preview(client, RISKY, at=at).json()["news2"]
        assert _chart(client, RISKY, at=at).status_code == 200
        card = _card(client)["latest"]["news2"]
        for key in ("total", "partial", "missing", "red_param", "breakdown", "stale", "assumed",
                    "measured_at", "fresh_until", "last_charted"):
            assert preview[key] == card[key], key

    def test_it_refuses_what_the_door_refuses(self, client):
        assert _preview(client, [{"code": "heart_rate", "value": 301}]).status_code == 400
        r = _preview(client, [{"code": "sbp", "value": 90}, {"code": "map", "value": 95}])
        assert (r.status_code, r.json()["detail"]) == (400, MAP_NOT_BELOW_SBP)
        assert _preview(client, []).status_code == 400

    def test_it_needs_a_credential_and_the_chart_permission(self, client):
        assert client.post("/clinical/bed-3/preview", json={"entries": RISKY}).status_code == 401
        assert _preview(client, RISKY, headers=VIEWER).status_code == 403
        assert _preview(client, RISKY, headers=NURSE).status_code == 200

    def test_a_discharged_number_is_dropped_as_the_door_drops_it(self):
        from homunculus.api.patient_identity import KABUL, IdentityRecord, InMemoryIdentityStore
        store = InMemoryIdentityStore()
        store.apply("h1", IdentityRecord(patient_id="bed-9", state="discharged", source=KABUL,
                                         updated_at=datetime.now(timezone.utc)))
        app = create_app({TOKEN: "h1"}, run_escalation_loop=False, identities=store)
        with TestClient(app) as c:
            r = c.post("/clinical/bed-9/preview", json={"entries": RISKY}, headers=AUTH)
            assert r.status_code == 200, r.text
            assert r.json()["dropped"] == "discharged" and "news2" not in r.json()
```

- [ ] **Step 2: Run them and see them red**

```bash
cd /c/tmp/g3-vitals/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_bedside_preview.py 2>&1 | tail -5
```

Expected: 404 or 405 for every POST to `/clinical/bed-3/preview`. The route does not exist, so `/clinical/{patient_id}` with `bed-3/preview` does not match. The 401 test fails on `404 == 401`.

- [ ] **Step 3: The route**

In `homunculus-engine/src/homunculus/api/app.py` extend the board import:

```python
from homunculus.api.board import (
    board_snapshot, freshness_turned, identity_only_board, patient_board, tombstone_board,
)
```

to:

```python
from homunculus.api.board import (
    _news2, board_snapshot, freshness_turned, identity_only_board, patient_board, tombstone_board,
)
```

Before `    @app.put("/clinical/{patient_id}/profile")` add:

```python
    @app.post("/clinical/{patient_id}/preview")
    async def chart_preview(patient_id: str, body: dict = Body(...),
                            authorization: str | None = Header(default=None)):
        """G3-01 (D8, X10): what the chart door would score for these entries — the card's own NEWS2
        (`api/board.py` `_news2`) of a COPY of the patient's state with the entries added, judged at the
        request's instant. Parsed by the door's own `build_entries`: the same refusals and the same time
        bound. Nothing is written: no audit row, no engine change, no frame. A discharged number answers as
        the door drops it (`dropped`), with nothing scored."""
        caller = await _caller(authorization)
        _require(caller, CLINICAL_CHART)
        hospital = caller.hospital
        await _require_patient(caller, authorization, patient_id)
        recorded_at = _recorded_at(body)
        now = datetime.now(timezone.utc)
        try:
            charted = build_entries(patient_id, body.get("entries") or [],
                                    charted_by=_charted_by(caller),
                                    recorded_at=recorded_at, now=now)
        except ClinicalEntryError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from None
        if is_tombstone(identities.get(hospital, patient_id)):
            return {"patient_id": patient_id, "preview": True, "dropped": DISCHARGED}
        engine = _engine(hospital)
        # `engine.state()` creates the id it is asked about: a patient the engine has not measured is read from
        # an empty state, as the trends route reads one — a preview must not put a number on every board.
        state = (engine.state(patient_id).copy() if patient_id in set(engine.patient_ids())
                 else PatientState(patient_id))
        for item in charted:
            state.ingest(item.observation)
        return {"patient_id": patient_id, "preview": True, "at": now.isoformat(), "news2": _news2(state, now)}

```

`DISCHARGED`, `is_tombstone`, `PatientState`, `ClinicalEntryError`, `build_entries`, `CLINICAL_CHART` and `_charted_by` are already in `app.py`. If one is missing, add its import from the module the chart route uses.

- [ ] **Step 4: Green**

```bash
cd /c/tmp/g3-vitals/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_bedside_preview.py tests/test_bedside_door.py tests/test_route_permissions.py 2>&1 | tail -3
```

Expected: all pass (`test_bedside_preview.py` 7). `tests/test_route_permissions.py` may list every route with its permission. If it fails naming `/clinical/{patient_id}/preview`, add the route to its table with `clinical.chart`, in the table's own form, and say so in the report.

- [ ] **Step 5: Line ends and commit**

```bash
cd /c/tmp/g3-vitals && /c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" homunculus-engine/tests/test_bedside_preview.py
for f in homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_bedside_preview.py; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_bedside_preview.py
git status --short && git diff --cached --stat
git commit -m "feat(clinical): POST /clinical/{id}/preview — the card's NEWS2 of a copy, nothing written (G3-01, D8, X10)" -m "<the red you saw, and the body>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(If `tests/test_route_permissions.py` changed, add it to the `git add` line.)

---

### Task 4: The trail helpers — one patient's rows, the withdrawn entries, the rebuild, the restart's skip (D10, D12, X5)

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/audit.py` (`iter_records_of` after `iter_records`)
- Modify: `homunculus-engine/src/homunculus/api/clinical.py` (`RETRACT`)
- Modify: `homunculus-engine/src/homunculus/api/rehydrate.py`
- Modify: `homunculus-engine/src/homunculus/state/timeline.py` (`PatientState.remove`)
- Create: `homunculus-engine/tests/test_bedside_rebuild.py`

- [ ] **Step 1: Write the failing tests**

Create `homunculus-engine/tests/test_bedside_rebuild.py`:

```python
"""G3-01 (D10, D12, X5): the trail helpers the withdrawal and the restart stand on — one patient's rows of
the asked kinds a page at a time, the `chart` rows a `chart_retract` row withdrew, a patient rebuilt from the
trail without them (engine only), the restart's skip, and a reading removed from a state. Synthetic values."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from homunculus.api.ackstore import AckStore
from homunculus.api.audit import AuditEvent, InMemoryAuditLog, iter_records_of
from homunculus.api.clinical import CHARTABLE, RETRACT
from homunculus.api.rehydrate import REBUILD_EVENTS, rebuild_patient, rehydrate, retracted_entries
from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine
from homunculus.state.timeline import PatientState

T0 = datetime.now(timezone.utc) - timedelta(minutes=30)
H = "h1"


def _charted(log, pid, code, value, at, by="hem.ayse"):
    return log.append(AuditEvent(H, "chart", pid, code, {
        "value": value, "unit": CHARTABLE[SignalCode(code)], "obs_ts": at.isoformat(), "charted_by": by}))


def _withdrawn(log, pid, row, reason="yazım hatası — 89 değil 98"):
    return log.append(AuditEvent(H, RETRACT, pid, row.subject, {
        "entry": row.id, "value": row.payload["value"], "obs_ts": row.payload["obs_ts"],
        "reason": reason, "retracted_by": "hem.ayse"}))


def _picture(engine: Engine, pid: str):
    """What a rebuilt patient must equal: every series, the alerts of the last evaluation, the antibiotic
    anchor and the profile."""
    if pid not in engine.patient_ids():
        return None
    state = engine.state(pid)
    series = {code.value: [(o.timestamp, o.value, o.source_device) for o in state.history(code)]
              for code in SignalCode if state.history(code)}
    return (series, sorted(a.kind for a in engine.active_alerts(pid)), engine.recognized_at(pid),
            engine.profile(pid))


class TestIterRecordsOf:
    def test_it_pages_one_patients_rows_of_the_asked_kinds_oldest_first(self):
        log = InMemoryAuditLog()
        mine = [_charted(log, "bed-3", "heart_rate", 80 + n, T0 + timedelta(minutes=n)) for n in range(5)]
        _charted(log, "bed-4", "heart_rate", 99, T0)
        log.append(AuditEvent(H, "alert", "bed-3", "news2", {}))
        got = list(iter_records_of(log, tenant=H, patient_id="bed-3", event_types={"chart"}, page=2))
        assert [r.id for r in got] == [r.id for r in mine]

    def test_without_a_patient_it_reads_the_kind_across_the_tenant(self):
        log = InMemoryAuditLog()
        a = _charted(log, "bed-3", "spo2", 95, T0)
        b = _charted(log, "bed-4", "spo2", 96, T0)
        assert [r.id for r in iter_records_of(log, tenant=H, event_types={"chart"}, page=1)] == [a.id, b.id]

    def test_a_page_below_one_is_refused(self):
        with pytest.raises(ValueError):
            list(iter_records_of(InMemoryAuditLog(), tenant=H, event_types={"chart"}, page=0))


class TestRetractedEntries:
    def test_it_collects_the_withdrawn_chart_rows(self):
        log = InMemoryAuditLog()
        wrong = _charted(log, "bed-3", "spo2", 89, T0)
        _charted(log, "bed-3", "spo2", 98, T0 + timedelta(minutes=1))
        _withdrawn(log, "bed-3", wrong)
        assert retracted_entries(log.records(tenant=H, limit=100)) == {wrong.id}

    def test_a_payload_without_an_integer_entry_withdraws_nothing(self):
        log = InMemoryAuditLog()
        for payload in ({"entry": "7"}, {"entry": True}, {"entry": None}, {}):
            log.append(AuditEvent(H, RETRACT, "bed-3", "spo2", payload))
        assert retracted_entries(log.records(tenant=H, limit=100)) == frozenset()


class TestRebuildPatient:
    def test_it_is_the_state_of_never_having_charted_the_withdrawn_row(self):
        log, clean = InMemoryAuditLog(), InMemoryAuditLog()
        rows = [("spo2", 91, 0), ("resp_rate", 26, 1), ("sbp", 88, 2)]
        written = [_charted(log, "bed-3", code, value, T0 + timedelta(minutes=m)) for code, value, m in rows]
        for code, value, m in rows:
            if code != "resp_rate":
                _charted(clean, "bed-3", code, value, T0 + timedelta(minutes=m))
        rebuilt = Engine()
        rebuild_patient(rebuilt, "bed-3", log.records(tenant=H, limit=100), skip=frozenset({written[1].id}))
        never = Engine()
        rehydrate(never, AckStore(), clean.records(tenant=H, limit=100))
        assert _picture(rebuilt, "bed-3") == _picture(never, "bed-3")

    def test_it_drops_what_the_engine_held_for_the_patient_first(self):
        engine = Engine()
        engine.ingest(Observation("bed-3", SignalCode.HEART_RATE, 150, "/min", T0, "clinician"), now=T0)
        rebuild_patient(engine, "bed-3", [], skip=frozenset())
        assert "bed-3" not in engine.patient_ids()

    def test_another_patients_rows_are_not_read_into_it(self):
        log = InMemoryAuditLog()
        _charted(log, "bed-4", "heart_rate", 99, T0)
        _charted(log, "bed-3", "heart_rate", 80, T0)
        engine = Engine()
        rebuild_patient(engine, "bed-3", log.records(tenant=H, limit=100), skip=frozenset())
        assert engine.patient_ids() == ["bed-3"]

    def test_a_profile_row_is_replayed(self):
        log = InMemoryAuditLog()
        _charted(log, "bed-3", "heart_rate", 80, T0)
        log.append(AuditEvent(H, "profile", "bed-3", "", {"comorbidities": ["copd"], "charted_by": "dr.elif"}))
        engine = Engine()
        rebuild_patient(engine, "bed-3", log.records(tenant=H, limit=100), skip=frozenset())
        assert "copd" in engine.profile("bed-3").comorbidities

    def test_the_rebuild_reads_only_the_engines_kinds(self):
        assert REBUILD_EVENTS == {"ingest", "chart", "profile"}


class TestRehydrateSkips:
    def test_a_withdrawn_chart_row_is_not_replayed(self):
        log = InMemoryAuditLog()
        wrong = _charted(log, "bed-3", "resp_rate", 26, T0)
        _charted(log, "bed-3", "spo2", 95, T0 + timedelta(minutes=1))
        _withdrawn(log, "bed-3", wrong)
        engine = Engine()
        rehydrate(engine, AckStore(), log.records(tenant=H, limit=100), skip=frozenset({wrong.id}))
        assert engine.state("bed-3").latest(SignalCode.RESP_RATE) is None
        assert engine.state("bed-3").latest(SignalCode.SPO2).value == 95


class TestPatientStateRemove:
    def test_it_removes_one_equal_reading(self):
        state = PatientState("bed-3")
        obs = Observation("bed-3", SignalCode.HEART_RATE, 150, "/min", T0, "clinician")
        state.ingest(obs)
        state.ingest(Observation("bed-3", SignalCode.HEART_RATE, 80, "/min", T0 + timedelta(minutes=1), "clinician"))
        assert state.remove(obs) is True
        assert [o.value for o in state.history(SignalCode.HEART_RATE)] == [80]

    def test_a_reading_it_does_not_hold_is_a_false(self):
        state = PatientState("bed-3")
        assert state.remove(Observation("bed-3", SignalCode.SPO2, 95, "%", T0, "clinician")) is False

    def test_the_last_reading_of_a_code_leaves_no_series(self):
        state = PatientState("bed-3")
        obs = Observation("bed-3", SignalCode.SPO2, 95, "%", T0, "clinician")
        state.ingest(obs)
        state.remove(obs)
        assert state.latest(SignalCode.SPO2) is None
```

- [ ] **Step 2: Run them and see them red**

```bash
cd /c/tmp/g3-vitals/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_bedside_rebuild.py 2>&1 | tail -5
```

Expected: collection fails with `ImportError: cannot import name 'iter_records_of'`.

- [ ] **Step 3: The helpers**

In `homunculus-engine/src/homunculus/api/audit.py`, after the whole `iter_records` function, add:

```python


def iter_records_of(log: AuditLog, *, tenant: str, event_types: Iterable[str], page: int,
                    patient_id: str | None = None) -> Iterator[AuditRecord]:
    """The rows of `event_types` — one patient's when `patient_id` is given — oldest first, read `page`
    rows at a time by id (G3-01, D10, D12): the withdrawal's rebuild read, and the restart's read of the
    withdrawals. Every matching row, as `iter_records` reads every row: one read capped at N would drop
    the newest, which are the current state. The kinds are read by the backend (`event_types`), so a row
    of another kind never takes a place in a page."""
    if page < 1:
        raise ValueError("page must be at least 1")
    kinds = frozenset(event_types)
    after: int | None = None
    while True:
        rows = log.records(tenant=tenant, patient_id=patient_id, event_types=kinds, limit=page,
                           after_id=after)
        yield from rows
        if len(rows) < page:
            return
        after = rows[-1].id
```

`Iterable` and `Iterator` are already imported at the head of `audit.py` (both appear in `records` and `iter_records`). If either is missing, add it to the existing `collections.abc` import.

In `homunculus-engine/src/homunculus/api/clinical.py`, after the `AT_FUTURE` line from Task 1, add:

```python
#: G3-01 (D10, D12): the audit row a «hatalı giriş» writes — `{entry, value, obs_ts, reason, retracted_by}`,
#: subject the code; `entry` is the withdrawn `chart` row's id. The replay and the rebuild skip that row.
RETRACT = "chart_retract"
```

In `homunculus-engine/src/homunculus/state/timeline.py`, after `drop_source` add:

```python

    def remove(self, obs: Observation) -> bool:
        """Drop ONE reading equal to `obs` — False when there is none (G3-01, X5: the shadow engine
        forgets a withdrawn hand entry; the real engine is rebuilt instead). An `Observation` is frozen, so
        equality is the whole reading: code, value, unit, time and source. A code left with no reading is
        removed, as `drop_source` leaves it."""
        series = self._history.get(obs.code)
        if not series:
            return False
        try:
            series.remove(obs)
        except ValueError:
            return False
        if not series:
            del self._history[obs.code]
        return True
```

In `homunculus-engine/src/homunculus/api/rehydrate.py`:

1. Extend the clinical import:

```python
from homunculus.api.clinical import profile_from_payload
```

to:

```python
from homunculus.api.clinical import RETRACT, profile_from_payload
```

2. Replace the head of `rehydrate`:

```python
def rehydrate(engine: Engine, store: AckStore, records: Iterable[AuditRecord]) -> None:
    # Any iterable, read once, in id order (G2-A2, D12): the API hands it `audit.iter_records`,
    # which reads the log a page at a time, so no cap can drop the newest rows.
    for rec in records:
        if rec.event_type in ("ingest", "chart"):
```

with:

```python
def rehydrate(engine: Engine, store: AckStore, records: Iterable[AuditRecord], *,
              skip: frozenset[int] = frozenset()) -> None:
    # Any iterable, read once, in id order (G2-A2, D12): the API hands it `audit.iter_records`,
    # which reads the log a page at a time, so no cap can drop the newest rows.
    # G3-01 (D12): `skip` is the `chart` rows a «hatalı giriş» withdrew (`retracted_entries`, read first by
    # the API): they are not replayed, so a restart scores the patient as the live rebuild did.
    for rec in records:
        if rec.event_type == "chart" and rec.id in skip:
            continue
        if rec.event_type in ("ingest", "chart"):
```

3. Replace the observation building inside `_replay_ingest`:

```python
    try:
        code = SignalCode(rec.subject)
    except ValueError:
        return False  # unknown signal slug — skip rather than fail the whole replay
    p = rec.payload
    ts = datetime.fromisoformat(p["obs_ts"])
    # G2-A4 review (S1, X22): a `chart` row carries `charted_by`, never a `device` — the door stamps the
    # observation "clinician" (api/clinical.py `build_entries`), and the replay must too, or after a restart
    # every hand-charted value reads as coming from "replay" (the SOFA form prints the source).
    source = p.get("device") or ("clinician" if rec.event_type == "chart" else "replay")
    obs = Observation(patient_id=rec.patient_id, code=code, value=float(p["value"]),
                      unit=p.get("unit", ""), timestamp=ts, source_device=source)
    engine.ingest(obs, now=min(ts, written))
    return True
```

with:

```python
    obs = observation_of(rec)
    if obs is None:
        return False  # unknown signal slug — skip rather than fail the whole replay
    engine.ingest(obs, now=min(obs.timestamp, written))
    return True


def observation_of(rec: AuditRecord) -> Observation | None:
    """The observation an `ingest` or `chart` row recorded, or None for a signal this build does not know.
    G3-01: the replay builds it so, and so does the withdrawal for the shadow lane (X5) — one reading equals
    the other, field for field."""
    try:
        code = SignalCode(rec.subject)
    except ValueError:
        return None
    p = rec.payload
    # G2-A4 review (S1, X22): a `chart` row carries `charted_by`, never a `device` — the door stamps the
    # observation "clinician" (api/clinical.py `build_entries`), and the replay must too, or after a restart
    # every hand-charted value reads as coming from "replay" (the SOFA form prints the source).
    source = p.get("device") or ("clinician" if rec.event_type == "chart" else "replay")
    return Observation(patient_id=rec.patient_id, code=code, value=float(p["value"]),
                       unit=p.get("unit", ""), timestamp=datetime.fromisoformat(p["obs_ts"]),
                       source_device=source)
```

4. At the end of the module add:

```python


#: G3-01 (D10): the kinds a patient's ENGINE state is rebuilt from — what `rehydrate` replays into the engine
#: for one patient. The ack, first-seen and clear rows are the store's, and the store is not rebuilt: an
#: alert the ward saw stays seen, and the lifecycle hook, run once after the rebuild, ends what no longer fires.
REBUILD_EVENTS = frozenset({"ingest", "chart", "profile"})


def retracted_entries(records: Iterable[AuditRecord]) -> frozenset[int]:
    """The `chart` rows a `chart_retract` row withdrew (G3-01, D12), from any rows: the others are ignored, and
    a payload whose `entry` is not an integer withdraws nothing."""
    out: set[int] = set()
    for rec in records:
        if rec.event_type != RETRACT:
            continue
        entry = rec.payload.get("entry")
        if isinstance(entry, int) and not isinstance(entry, bool):
            out.add(entry)
    return frozenset(out)


def rebuild_patient(engine: Engine, patient_id: str, records: Iterable[AuditRecord], *,
                    skip: frozenset[int]) -> None:
    """One patient's engine state from the trail, without the `chart` rows in `skip` (G3-01, D10, X4): first
    everything the engine holds for the patient is dropped (`Engine.forget`), then that patient's `ingest`,
    `chart` and `profile` rows are replayed in id order with the restart's own helpers — each reading judged
    where the door judged it. Engine only: no store and no lifecycle hook; the caller runs the hook once, at its
    own instant. Rows of another patient or kind are passed over, so the caller may hand it a wider read."""
    engine.forget(patient_id)
    for rec in records:
        if rec.patient_id != patient_id or rec.event_type not in REBUILD_EVENTS:
            continue
        if rec.event_type == "profile":
            _replay_profile(engine, rec)
        elif not (rec.event_type == "chart" and rec.id in skip):
            _replay_ingest(engine, rec, _written_at(rec))
```

- [ ] **Step 4: Green, then the replay's own suites**

```bash
cd /c/tmp/g3-vitals/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_bedside_rebuild.py tests/test_rehydrate.py tests/test_audit_event_types.py tests/test_state_timeline.py tests/test_timeline_thin.py 2>&1 | tail -3
```

Expected: all pass (`test_bedside_rebuild.py` 14).

- [ ] **Step 5: Line ends and commit**

```bash
cd /c/tmp/g3-vitals && /c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" homunculus-engine/tests/test_bedside_rebuild.py
for f in homunculus-engine/src/homunculus/api/audit.py homunculus-engine/src/homunculus/api/clinical.py homunculus-engine/src/homunculus/api/rehydrate.py homunculus-engine/src/homunculus/state/timeline.py homunculus-engine/tests/test_bedside_rebuild.py; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- homunculus-engine/src/homunculus/api/audit.py homunculus-engine/src/homunculus/api/clinical.py homunculus-engine/src/homunculus/api/rehydrate.py homunculus-engine/src/homunculus/state/timeline.py homunculus-engine/tests/test_bedside_rebuild.py
git status --short && git diff --cached --stat
git commit -m "feat(rehydrate): one patient rebuilt from the trail without withdrawn rows; the restart skips them; a reading removed from a state (G3-01, D10, D12, X5)" -m "<the red you saw, and the body>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: «Hatalı giriş» — the withdrawal route, the restart's skip and the shadow lane (D10–D12, X3–X5, X11)

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/clinical.py` (the withdrawal's constants)
- Modify: `homunculus-engine/src/homunculus/api/app.py` (imports; `_ensure`; the route after the preview)
- Modify: `homunculus-engine/src/homunculus/api/infinity_rules.py` (`ShadowLane.retract_observation`)
- Create: `homunculus-engine/tests/test_bedside_retract.py`
- Modify: `homunculus-engine/tests/test_api_shadow_findings.py` (one caller, one test)

- [ ] **Step 1: Write the failing tests**

Create `homunculus-engine/tests/test_bedside_retract.py`:

```python
"""G3-01 (D10–D12, X3, X4, X11): «hatalı giriş» through the API. A withdrawn hand entry leaves every score
as if it had never been charted; the trail keeps both rows; a restart agrees; an alert the withdrawal
uncovers is told; the refusals hold and write nothing. Synthetic patients and values only (CLAUDE.md rule 6)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.audit import InMemoryAuditLog
from homunculus.api.clinical import (
    RETRACT, RETRACT_ALREADY, RETRACT_DISCHARGED, RETRACT_NEEDS_PERSON, RETRACT_REASON_SHORT, RETRACT_UNKNOWN,
)
from homunculus.api.identity import Caller
from homunculus.api.patient_identity import KABUL, IdentityRecord, InMemoryIdentityStore

TOKEN = "tok"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
NURSE = {"Authorization": "Bearer nurse-jwt"}
VIEWER = {"Authorization": "Bearer viewer-jwt"}
PEOPLE = {
    "nurse-jwt": Caller(hospital="h1", actor="hem.ayse", groups=("nurse",),
                        perms=frozenset({"board.view", "clinical.chart"})),
    "viewer-jwt": Caller(hospital="h1", actor="dr.elif", groups=("physician",), perms=frozenset({"board.view"})),
}
WHY = "yazım hatası — 26 değil 16"
# RR 26, SpO₂ 91, systolic 88: NEWS2 9, the immediate band.
RISKY = [{"code": "resp_rate", "value": 26}, {"code": "spo2", "value": 91}, {"code": "sbp", "value": 88}]


async def _resolve(credential: str):
    return PEOPLE.get(credential)


def _app(audit=None, identities=None) -> TestClient:
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve,
                     audit=audit if audit is not None else InMemoryAuditLog(), identities=identities)
    return TestClient(app)


@pytest.fixture()
def client():
    with _app() as c:
        yield c


def _ago(minutes: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()


def _chart(c, entries, at, pid="bed-3") -> dict[str, int]:
    """Chart as the nurse; the answer's `entries` by code (one value per code per call here)."""
    r = c.post(f"/clinical/{pid}", json={"entries": entries, "recorded_at": at}, headers=NURSE)
    assert r.status_code == 200, r.text
    return {e["code"]: e["entry"] for e in r.json()["entries"]}


def _retract(c, entry, reason=WHY, headers=NURSE, pid="bed-3"):
    return c.post(f"/clinical/{pid}/entries/{entry}/retract", json={"reason": reason}, headers=headers)


def _card(c, pid="bed-3"):
    return next(p for p in c.get("/patients", headers=AUTH).json()["patients"] if p["patient_id"] == pid)


def _firing(card):
    """The alerts firing now — a latched one carries `resolved_at` (api/board.py `_latched_alerts`)."""
    return sorted(a["kind"] for a in card["alerts"] if "resolved_at" not in a)


def _news2(card):
    n = card["latest"]["news2"]
    return {k: n[k] for k in ("total", "partial", "missing", "red_param", "breakdown", "stale", "measured_at")}


def _rows(c, kind):
    return c.app.state.audit.records(tenant="h1", event_type=kind, limit=100)


class TestTheWithdrawalScoresAsIfNeverCharted:
    def test_withdrawing_the_value_that_raised_news2(self, client):
        at = _ago(5)
        ids = _chart(client, RISKY, at)
        assert "news2" in _firing(_card(client))
        r = _retract(client, ids["resp_rate"])
        assert r.status_code == 200, r.text
        assert (r.json()["retracted"], r.json()["code"]) == (ids["resp_rate"], "resp_rate")
        with _app() as fresh:
            _chart(fresh, [e for e in RISKY if e["code"] != "resp_rate"], at)
            assert _news2(_card(client)) == _news2(_card(fresh))
            assert _firing(_card(client)) == _firing(_card(fresh))

    def test_withdrawing_a_map_that_turned_sepsis_on_leaves_no_antibiotic_clock(self, client):
        """X4: removing the value alone would not stop the hour the recognition started (pipeline.py)."""
        at = _ago(5)
        base = [{"code": "suspected_infection", "value": 1}, {"code": "platelets", "value": 120}]
        _chart(client, base, at)
        ids = _chart(client, [{"code": "map", "value": 60}], at)
        assert _card(client)["meds"]["antibiotic_clock"] is not None     # SOFA 2 with the MAP: the hour runs
        assert _retract(client, ids["map"]).status_code == 200
        after = _card(client)
        assert after["meds"]["antibiotic_clock"] is None
        assert all(a["severity"] == "critical" for a in after["alerts"] if "resolved_at" in a)  # only a critical latches
        with _app() as fresh:
            _chart(fresh, base, at)
            assert _firing(after) == _firing(_card(fresh))
            assert after["sepsis"] == _card(fresh)["sepsis"]


class TestTheTrailKeepsBoth:
    def test_the_chart_row_stays_and_the_withdrawal_names_it(self, client):
        at = _ago(5)
        ids = _chart(client, RISKY, at)
        assert _retract(client, ids["resp_rate"], reason=f"  {WHY}  ").status_code == 200
        assert ids["resp_rate"] in [r.id for r in _rows(client, "chart")]
        (row,) = _rows(client, RETRACT)
        assert (row.patient_id, row.subject) == ("bed-3", "resp_rate")
        assert row.payload == {"entry": ids["resp_rate"], "value": 26, "obs_ts": at, "reason": WHY,
                               "retracted_by": "hem.ayse"}


class TestTheRestartAgrees:
    def test_a_restart_skips_the_withdrawn_entry(self):
        """D12: the replay reads the withdrawals first and scores as the live rebuild did."""
        log, at = InMemoryAuditLog(), _ago(5)
        with _app(audit=log) as first:
            ids = _chart(first, RISKY, at)
            assert _retract(first, ids["resp_rate"]).status_code == 200
            live = _card(first)
        with _app(audit=log) as second:
            again = _card(second)
            assert _news2(again) == _news2(live)
            assert _firing(again) == _firing(live)


class TestTheNurseIsToldOfWhatItUncovers:
    def test_a_withdrawal_that_brings_an_immediate_alert_back_tells_the_nurse(self, client):
        """X3: three wrong normal values hid an immediate NEWS2; withdrawn one by one, the last brings it back."""
        _chart(client, RISKY, _ago(10))                                      # NEWS2 9: told once
        ids = _chart(client, [{"code": "resp_rate", "value": 16}, {"code": "spo2", "value": 97},
                              {"code": "sbp", "value": 120}], _ago(5))       # NEWS2 0: the alert ended
        assert "news2" not in _firing(_card(client))
        assert len(_rows(client, "notification")) == 1
        for code in ("resp_rate", "spo2"):
            assert _retract(client, ids[code]).status_code == 200            # NEWS2 6: soon, not immediate
        assert len(_rows(client, "notification")) == 1
        assert _retract(client, ids["sbp"]).status_code == 200               # the 88 again: NEWS2 9
        assert len(_rows(client, "notification")) == 2


class TestTheRefusals:
    def test_a_short_reason_is_refused(self, client):
        ids = _chart(client, RISKY, _ago(5))
        r = _retract(client, ids["resp_rate"], reason="   kısa   ")
        assert (r.status_code, r.json()["detail"]) == (400, RETRACT_REASON_SHORT)

    @pytest.mark.parametrize("entry", ["999999", "abc", "-1"])
    def test_an_unknown_entry_is_404(self, client, entry):
        _chart(client, RISKY, _ago(5))
        r = _retract(client, entry)
        assert (r.status_code, r.json()["detail"]) == (404, RETRACT_UNKNOWN)

    def test_another_patients_entry_is_404(self, client):
        ids = _chart(client, RISKY, _ago(5), pid="bed-4")
        _chart(client, RISKY, _ago(5))
        assert _retract(client, ids["spo2"], pid="bed-3").status_code == 404

    def test_a_row_that_is_not_a_chart_row_is_404(self, client):
        """A device's reading is an `ingest` row, an alert an `alert` row: neither is a hand entry."""
        _chart(client, RISKY, _ago(5))
        alert = _rows(client, "alert")[0]
        assert _retract(client, alert.id).status_code == 404

    def test_a_second_withdrawal_is_409(self, client):
        ids = _chart(client, RISKY, _ago(5))
        assert _retract(client, ids["resp_rate"]).status_code == 200
        r = _retract(client, ids["resp_rate"])
        assert (r.status_code, r.json()["detail"]) == (409, RETRACT_ALREADY)

    def test_a_device_credential_cannot_withdraw(self, client):
        """X11: a withdrawal names who made it."""
        ids = _chart(client, RISKY, _ago(5))
        r = _retract(client, ids["resp_rate"], headers=AUTH)
        assert (r.status_code, r.json()["detail"]) == (403, RETRACT_NEEDS_PERSON)

    def test_it_needs_a_credential_and_the_chart_permission(self, client):
        ids = _chart(client, RISKY, _ago(5))
        assert client.post(f"/clinical/bed-3/entries/{ids['spo2']}/retract", json={"reason": WHY}).status_code == 401
        assert _retract(client, ids["spo2"], headers=VIEWER).status_code == 403

    def test_a_discharged_number_is_409(self):
        store = InMemoryIdentityStore()
        with _app(identities=store) as c:
            ids = _chart(c, RISKY, _ago(5))
            store.apply("h1", IdentityRecord(patient_id="bed-3", state="discharged", source=KABUL,
                                             updated_at=datetime.now(timezone.utc)))
            r = _retract(c, ids["resp_rate"])
            assert (r.status_code, r.json()["detail"]) == (409, RETRACT_DISCHARGED)

    def test_no_refusal_writes_a_row(self, client):
        ids = _chart(client, RISKY, _ago(5))
        for entry, reason, headers in ((ids["spo2"], "kısa", NURSE), ("999999", WHY, NURSE),
                                       (ids["spo2"], WHY, AUTH), (ids["spo2"], WHY, VIEWER)):
            assert _retract(client, entry, reason=reason, headers=headers).status_code >= 400
        assert _rows(client, RETRACT) == []
```

In `homunculus-engine/tests/test_api_shadow_findings.py` add a caller to `JWTS` — replace:

```python
    "h2-jwt": Caller(hospital="h2", actor="leyla", groups=("nurse",), perms=frozenset({"board.view"})),
}
```

with:

```python
    "h2-jwt": Caller(hospital="h2", actor="leyla", groups=("nurse",), perms=frozenset({"board.view"})),
    # G3-01: a named chartist — a withdrawal is a person's (X11).
    "chart-jwt": Caller(hospital=HOSPITAL, actor="hem.ayse", groups=("nurse",),
                        perms=frozenset({"board.view", "clinical.chart"})),
}
CHART = {"Authorization": "Bearer chart-jwt"}
```

and append at the end of the file:

```python


def test_a_withdrawn_hand_entry_leaves_the_shadow_engine_too(tmp_path):
    """G3-01 (X5): the real engine is rebuilt without it; the shadow one has it removed, and judges again at
    its next sample. A temperature, which no monitor body here carries."""
    identities = InMemoryIdentityStore()
    _kabul(identities, "bed-1")
    client, _, _, _ = _app(tmp_path, identities=identities)
    with client:
        _linked(client)
        shadow_engine = client.app.state.shadow_lane.engines[HOSPITAL]
        charted = client.post("/clinical/bed-1", json={"entries": [{"code": "temperature", "value": 39.4}]},
                              headers=HDR)
        assert charted.status_code == 200, charted.text
        entry = charted.json()["entries"][0]["entry"]
        assert shadow_engine.state("bed-1").latest(SignalCode.TEMPERATURE).value == 39.4
        r = client.post(f"/clinical/bed-1/entries/{entry}/retract",
                        json={"reason": "yanlış hasta seçilmişti"}, headers=CHART)
        assert r.status_code == 200, r.text
        assert shadow_engine.state("bed-1").latest(SignalCode.TEMPERATURE) is None
```

- [ ] **Step 2: Run them and see them red**

```bash
cd /c/tmp/g3-vitals/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_bedside_retract.py tests/test_api_shadow_findings.py 2>&1 | tail -5
```

Expected:
- `test_bedside_retract.py` fails at collection: `ImportError: cannot import name 'RETRACT_ALREADY'`;
- the new shadow test fails: 404 or 405 on the retract path.

- [ ] **Step 3: The constants, the lane, the route, the restart**

In `homunculus-engine/src/homunculus/api/clinical.py`, after `RETRACT = "chart_retract"` add:

```python
#: G3-01 (D10, D11, X11): the withdrawal's reason, after trim, and its refusals in the clinician's words.
RETRACT_MIN_REASON_CHARS = 10
RETRACT_REASON_SHORT = "gerekçe en az 10 karakter olmalı"
RETRACT_NEEDS_PERSON = "geri alma bir kişinin işidir — cihaz kimliğiyle yapılamaz"
RETRACT_UNKNOWN = "bu hastada böyle bir elle girilmiş değer yok"
RETRACT_ALREADY = "bu değer zaten hatalı giriş olarak işaretlenmiş"
RETRACT_DISCHARGED = "taburcu edilmiş bir hastada değer geri alınamaz"
```

In `homunculus-engine/src/homunculus/api/infinity_rules.py`, after `mirror_profile`, add:

```python

    def retract_observation(self, hospital: str, obs: Observation) -> None:
        """G3-01 (X5): a hand entry withdrawn from the real engine leaves the shadow one too. It is removed from
        the shadow patient's state, and the lane judges again at its next sample (a linked patient's comes every
        minute), not here: this lane is not clinical (D1), and its engine judges only on ingest. With the install
        pending this does nothing (`_installed`): the install, when the next pass runs it, copies a real engine
        already rebuilt without the entry."""
        engine = self._installed(hospital)
        if engine is None or obs.patient_id not in engine.patient_ids():
            return
        engine.state(obs.patient_id).remove(obs)
```

`Observation` is imported in `infinity_rules.py` already (its `Candidate.observation` returns one). If not, add it to the `homunculus.canonical` import.

In `homunculus-engine/src/homunculus/api/app.py`:

1. The imports — replace:

```python
from homunculus.api.audit import AuditEvent, AuditLog, InMemoryAuditLog, iter_records, verify_chain
```

with:

```python
from homunculus.api.audit import (
    AuditEvent, AuditLog, InMemoryAuditLog, iter_records, iter_records_of, verify_chain,
)
```

replace:

```python
from homunculus.api.clinical import (
    GCS_NOT_WHOLE, PLAUSIBLE, ClinicalEntryError, build_entries, chart_observations, profile_from_payload,
    profile_to_payload,
)
```

with:

```python
from homunculus.api.clinical import (
    GCS_NOT_WHOLE, PLAUSIBLE, RETRACT, RETRACT_ALREADY, RETRACT_DISCHARGED, RETRACT_MIN_REASON_CHARS,
    RETRACT_NEEDS_PERSON, RETRACT_REASON_SHORT, RETRACT_UNKNOWN, ClinicalEntryError, build_entries,
    chart_observations, profile_from_payload, profile_to_payload,
)
```

and replace:

```python
from homunculus.api.rehydrate import rehydrate
```

with:

```python
from homunculus.api.rehydrate import (
    REBUILD_EVENTS, observation_of, rebuild_patient, rehydrate, retracted_entries,
)
```

2. In `_ensure` replace:

```python
        # Every row, oldest first, a page at a time (G2-A2, D12) — never the newest N, and no cap.
        rehydrate(engine, store, iter_records(audit, tenant=hospital, page=REHYDRATE_PAGE))
```

with:

```python
        # G3-01 (D12): the withdrawn hand entries first — one read of the `chart_retract` rows — so the replay
        # below scores each patient as the live withdrawal's rebuild did.
        withdrawn = retracted_entries(iter_records_of(audit, tenant=hospital, event_types={RETRACT},
                                                      page=REHYDRATE_PAGE))
        # Every row, oldest first, a page at a time (G2-A2, D12) — never the newest N, and no cap.
        rehydrate(engine, store, iter_records(audit, tenant=hospital, page=REHYDRATE_PAGE), skip=withdrawn)
```

3. After the preview route (Task 3), before `    @app.put("/clinical/{patient_id}/profile")`, add:

```python
    @app.post("/clinical/{patient_id}/entries/{entry}/retract")
    async def retract_entry(patient_id: str, entry: str, body: dict = Body(...),
                            authorization: str | None = Header(default=None)):
        """G3-01 (D10, D11, X3, X4, X11): «hatalı giriş» — a hand entry withdrawn from every score.

        `entry` is the value's `chart` row (the door answered it). The patient's rows are read from the trail,
        then replayed without every withdrawn entry into a SCRATCH engine, with the restart's own helpers
        (`rebuild_patient`). Only then is the `chart_retract` row appended, and the scratch patient handed to the
        real engine (`Engine.adopt`). The trail row comes first, then memory, and a read or an append that fails
        changes nothing (X4).

        Then the lifecycle hook runs once, at the request's instant. An alert that no longer fires ends — or,
        critical and unacknowledged, latches (G2-A1, D3). An alert the withdrawal uncovers is a new one, so it
        is stamped and, if immediate, told to the nurse (X3). The notifier's dedup tells nothing already told.
        The shadow lane drops the reading, guarded (X5), and the card is republished.

        Refusals:
        - 403 for a device credential (X11): a withdrawal names a person;
        - 400 for a reason shorter than 10 characters after trim;
        - 409 for a discharged number;
        - 404 for an id that is not this patient's `chart` row (a device's reading is an `ingest` row);
        - 409 for an entry already withdrawn.
        A refusal writes nothing. The chart row itself is never changed: the trail keeps both."""
        caller = await _caller(authorization)
        _require(caller, CLINICAL_CHART)
        if caller.is_device:
            raise HTTPException(status_code=403, detail=RETRACT_NEEDS_PERSON)
        hospital = caller.hospital
        await _require_patient(caller, authorization, patient_id)
        raw_reason = body.get("reason")
        reason = raw_reason.strip() if isinstance(raw_reason, str) else ""
        if len(reason) < RETRACT_MIN_REASON_CHARS:
            raise HTTPException(status_code=400, detail=RETRACT_REASON_SHORT)
        record = identities.get(hospital, patient_id)
        if is_tombstone(record):
            raise HTTPException(status_code=409, detail=RETRACT_DISCHARGED)
        engine = _engine(hospital)             # rehydrated before anything is read or written
        store = _store(hospital)
        wanted = int(entry) if entry.isdigit() else None
        rows = list(iter_records_of(audit, tenant=hospital, patient_id=patient_id,
                                    event_types=REBUILD_EVENTS | {RETRACT}, page=REHYDRATE_PAGE))
        target = next((r for r in rows if r.id == wanted and r.event_type == "chart"), None)
        if target is None:
            raise HTTPException(status_code=404, detail=RETRACT_UNKNOWN)
        withdrawn = retracted_entries(rows)
        if target.id in withdrawn:
            raise HTTPException(status_code=409, detail=RETRACT_ALREADY)
        scratch = Engine()
        rebuild_patient(scratch, patient_id, rows, skip=withdrawn | {target.id})
        now = datetime.now(timezone.utc)
        audit.append(AuditEvent(hospital, RETRACT, patient_id, target.subject, {
            "entry": target.id, "value": target.payload.get("value"), "obs_ts": target.payload.get("obs_ts"),
            "reason": reason, "retracted_by": caller.actor}))
        engine.adopt(scratch, patient_id)
        cleared = sync_alerts(engine, store, patient_id, now)
        _audit_cleared(hospital, cleared, now)
        for a in engine.active_alerts(patient_id):
            if store.stamp_first_seen(patient_id, a.kind, now, chain_gap=escalate_after):
                audit.append(AuditEvent(hospital, "first_seen", patient_id, a.kind, {"at": now.isoformat()}))
        observation = observation_of(target)
        if observation is not None:
            lane.guard("mirror", lambda: lane.retract_observation(hospital, observation))
        await broadcaster.publish(hospital, _card(hospital, patient_id, record))
        for note in notifier.for_new(hospital, engine.active_alerts(patient_id)):
            await hub.publish(hospital, note)
            audit.append(AuditEvent(hospital, "notification", note.patient_id, note.kind,
                                    {"audience": note.audience, "trigger": note.trigger}))
        notifier.prune(hospital, live_keys(engine, store))
        return {"retracted": target.id, "code": target.subject,
                "alerts": [a.kind for a in engine.active_alerts(patient_id)]}

```

These names are already in `app.py` scope: `Engine`, `sync_alerts`, `live_keys`, `escalate_after`, `lane`, `hub`, `broadcaster`, `notifier`, `identities`, `_card`, `_audit_cleared`, `_engine`, `_store`, `_require_patient`, `is_tombstone`. Find any that is missing with `grep -n "<name>" src/homunculus/api/app.py`, and import it from where the chart route or `/ingest` takes it.

- [ ] **Step 4: Green, then the suites the replay and the doors share**

```bash
cd /c/tmp/g3-vitals/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_bedside_retract.py tests/test_api_shadow_findings.py tests/test_bedside_rebuild.py tests/test_rehydrate.py tests/test_route_permissions.py tests/test_kabul_boardlink.py 2>&1 | tail -3
```

Expected: all pass (`test_bedside_retract.py` 16, plus one in the shadow file). If `tests/test_route_permissions.py` names the new route, add it with `clinical.chart` as in Task 3.

- [ ] **Step 5: The whole no-DB suite, line ends, commit**

```bash
cd /c/tmp/g3-vitals/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -3
```

Expected: `3229 passed, 1110 skipped` (3152 + 39 + 7 + 14 + 16 + 1).

```bash
cd /c/tmp/g3-vitals && /c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" homunculus-engine/tests/test_bedside_retract.py
for f in homunculus-engine/src/homunculus/api/clinical.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/src/homunculus/api/infinity_rules.py homunculus-engine/tests/test_bedside_retract.py homunculus-engine/tests/test_api_shadow_findings.py; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- homunculus-engine/src/homunculus/api/clinical.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/src/homunculus/api/infinity_rules.py homunculus-engine/tests/test_bedside_retract.py homunculus-engine/tests/test_api_shadow_findings.py
git status --short && git diff --cached --stat
git commit -m "feat(clinical): «hatalı giriş» — a hand entry withdrawn by rebuilding the patient from the trail; the restart skips it; the shadow lane drops it (G3-01, D10–D12, X3–X5, X11)" -m "<the red you saw, and the body>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Trends list each channel's hand entries and withdrawals (D13, X1)

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/trends.py`
- Create: `homunculus-engine/tests/test_trends_manual.py`

- [ ] **Step 1: Write the failing tests**

Create `homunculus-engine/tests/test_trends_manual.py`:

```python
"""G3-01 (D13, X1): the trends answer lists each channel's hand entries measured in the window, a withdrawn one
with its reason, who and when — read from the trail — while the drawn points lose the withdrawn value.
Synthetic patients and values only (CLAUDE.md rule 6)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api import trends
from homunculus.api.app import create_app
from homunculus.api.identity import Caller

TOKEN = "tok"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
NURSE = {"Authorization": "Bearer nurse-jwt"}
PEOPLE = {"nurse-jwt": Caller(hospital="h1", actor="hem.ayse", groups=("nurse",),
                              perms=frozenset({"board.view", "clinical.chart"}))}
WHY = "yanlış hasta seçilmişti"


async def _resolve(credential: str):
    return PEOPLE.get(credential)


@pytest.fixture()
def client():
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve)
    with TestClient(app) as c:
        yield c


def _ago(minutes: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()


def _chart(c, code, value, minutes_ago) -> int:
    r = c.post("/clinical/bed-3", json={"entries": [{"code": code, "value": value}],
                                        "recorded_at": _ago(minutes_ago)}, headers=NURSE)
    assert r.status_code == 200, r.text
    return r.json()["entries"][0]["entry"]


def _trends(c, hours=6):
    r = c.get(f"/patients/bed-3/trends?hours={hours}", headers=AUTH)
    assert r.status_code == 200, r.text
    return r.json()


def _channel(body, key):
    return next(ch for ch in body["channels"] if ch["key"] == key)


def test_a_hand_entry_and_its_withdrawal_are_listed_and_the_points_lose_it(client):
    keep = _chart(client, "heart_rate", 82, 30)
    wrong = _chart(client, "heart_rate", 182, 20)
    r = client.post(f"/clinical/bed-3/entries/{wrong}/retract", json={"reason": WHY}, headers=NURSE)
    assert r.status_code == 200, r.text
    body = _trends(client)
    hr = _channel(body, "heart_rate")
    assert [p[1] for p in hr["points"]] == [82]
    assert [(m["entry"], m["value"], m["by"]) for m in hr["manual"]] == [(keep, 82, "hem.ayse"), (wrong, 182, "hem.ayse")]
    assert hr["manual"][0]["retracted"] is None
    assert (hr["manual"][1]["retracted"]["reason"], hr["manual"][1]["retracted"]["by"]) == (WHY, "hem.ayse")
    assert hr["manual"][1]["retracted"]["at"]
    assert body["manual_truncated"] is False


def test_the_other_channels_list_no_hand_entry(client):
    _chart(client, "heart_rate", 82, 30)
    body = _trends(client)
    assert all(ch["manual"] == [] for ch in body["channels"] if ch["key"] != "heart_rate")


def test_an_entry_measured_before_the_window_is_not_listed(client):
    _chart(client, "heart_rate", 82, 7 * 60)
    assert _channel(_trends(client, hours=6), "heart_rate")["manual"] == []
    assert len(_channel(_trends(client, hours=24), "heart_rate")["manual"]) == 1


def test_a_charted_code_with_no_channel_is_not_listed(client):
    r = client.post("/clinical/bed-3", json={"entries": [{"code": "platelets", "value": 120}]}, headers=NURSE)
    assert r.status_code == 200, r.text
    assert all(ch["manual"] == [] for ch in _trends(client)["channels"])


def test_a_read_that_had_to_cut_says_so(client, monkeypatch):
    monkeypatch.setattr(trends, "TRENDS_MANUAL_LIMIT", 1)
    _chart(client, "heart_rate", 82, 30)
    _chart(client, "heart_rate", 84, 20)
    assert _trends(client)["manual_truncated"] is True
```

- [ ] **Step 2: Run them and see them red**

```bash
cd /c/tmp/g3-vitals/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_trends_manual.py 2>&1 | tail -5
```

Expected: `KeyError: 'manual'` in each test, and `AttributeError: … has no attribute 'TRENDS_MANUAL_LIMIT'` in the last.

- [ ] **Step 3: The list**

In `homunculus-engine/src/homunculus/api/trends.py`:

1. Extend the header's "What it deliberately does not do" list with nothing. In the paragraph above it, after the sentence that ends `…an antibiotic dose was charted.`, add:

```
Since G3-01 (D13, X1) it also lists each channel's HAND entries in the window — the bedside form's and every
other door's — with their withdrawal («hatalı giriş») when there is one, read from the trail like the marks:
the drawn `points` are the engine's, a withdrawn value gone from them; `manual` is what was typed, and by whom.
```

2. Add to the imports:

```python
from homunculus.api.clinical import RETRACT
```

3. After `TRENDS_MARKER_LIMIT = 5000` add:

```python
#: G3-01 (D13, X1): the most hand-entry rows (charted and withdrawn together) one trends read keeps. A ward
#: charting the bedside set every hour writes about 6 × 72 = 432 `chart` rows in the 3-day window; this sits
#: far above it, and `manual_truncated` says when a read had to cut.
TRENDS_MANUAL_LIMIT = 5000
```

4. After the whole `_markers` function add:

```python


def _instant(text) -> datetime | None:
    """An ISO instant that carries a zone, or None."""
    try:
        at = datetime.fromisoformat(text)
    except (TypeError, ValueError):
        return None
    return at if at.tzinfo is not None else None


def _manual(audit: AuditLog, hospital: str, patient_id: str, since: datetime,
            until: datetime) -> tuple[dict[str, list[dict]], bool]:
    """Each published channel's hand entries measured in [since, until], in the order they were written, each
    with its withdrawal when there is one (G3-01, D13, X1).

    Read from the trail, as the marks are, so the live door, the admission form's charting and a restart all
    show one list. One bounded read of the patient's `chart` and `chart_retract` rows written since `since` is
    enough: a row is written at or after the time it records, and a withdrawal after the row it withdraws.
    A value the trail cannot read is left out, never shown as 0: not a finite number, or a time with no zone.
    Who: the `charted_by` the door wrote, the `retracted_by` the withdrawal wrote."""
    fetched = audit.records(tenant=hospital, patient_id=patient_id, event_types={"chart", RETRACT},
                            since=since, limit=TRENDS_MANUAL_LIMIT + 1)
    truncated = len(fetched) > TRENDS_MANUAL_LIMIT
    rows = fetched[:TRENDS_MANUAL_LIMIT]
    withdrawn: dict[int, dict] = {}
    for rec in rows:
        entry = rec.payload.get("entry")
        if rec.event_type == RETRACT and isinstance(entry, int) and not isinstance(entry, bool):
            at = _instant(rec.ts)
            withdrawn[entry] = {"reason": str(rec.payload.get("reason") or ""),
                                "by": str(rec.payload.get("retracted_by") or ""),
                                "at": at.astimezone(timezone.utc).isoformat() if at is not None else None}
    out: dict[str, list[dict]] = {key: [] for key in _PUBLISHED_SIGNALS}
    for rec in rows:
        if rec.event_type != "chart" or rec.subject not in out:
            continue
        at = _instant(rec.payload.get("obs_ts"))
        value = rec.payload.get("value")
        if (at is None or not since <= at <= until or isinstance(value, bool)
                or not isinstance(value, (int, float)) or not math.isfinite(value)):
            continue
        out[rec.subject].append({
            "entry": rec.id, "at": at.astimezone(timezone.utc).isoformat(), "value": value,
            "by": str(rec.payload.get("charted_by") or ""), "retracted": withdrawn.get(rec.id),
        })
    return out, truncated
```

5. In `patient_trends`, replace:

```python
    channels = []
    for key, code in _PUBLISHED_SIGNALS.items():
```

with:

```python
    manual, manual_truncated = _manual(audit, hospital, patient_id, since, until)   # G3-01 (D13, X1)
    channels = []
    for key, code in _PUBLISHED_SIGNALS.items():
```

replace:

```python
            "thinned": len(window) > TRENDS_MAX_POINTS,
```

with:

```python
            "thinned": len(window) > TRENDS_MAX_POINTS,
            # G3-01 (D13): what was typed into this channel in the window, a withdrawn value included and marked.
            "manual": manual[key],
```

and replace:

```python
        "markers_truncated": markers_truncated,
    }
```

with:

```python
        "markers_truncated": markers_truncated,
        "manual_truncated": manual_truncated,
    }
```

The `_PUBLISHED_SIGNALS` keys are the signal codes' own values: `heart_rate`, `resp_rate`, `spo2`, `sbp`, `map`, `temperature`, `lactate`. A `chart` row's `subject` therefore names its channel.

- [ ] **Step 4: Green, then the trends suites**

```bash
cd /c/tmp/g3-vitals/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_trends_manual.py $(ls tests/test_*trend*.py | grep -v manual) 2>&1 | tail -3
```

Expected: all pass (`test_trends_manual.py` 5). A trends test that pins the whole answer with `==` breaks on the two new keys. Add `"manual": []` to each channel it builds, and `"manual_truncated": False` to the answer, in that test's own fixture form. Name it in the report.

- [ ] **Step 5: Line ends and commit**

```bash
cd /c/tmp/g3-vitals && /c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" homunculus-engine/tests/test_trends_manual.py
for f in homunculus-engine/src/homunculus/api/trends.py homunculus-engine/tests/test_trends_manual.py; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- homunculus-engine/src/homunculus/api/trends.py homunculus-engine/tests/test_trends_manual.py
git status --short && git diff --cached --stat
git commit -m "feat(trends): each channel lists its hand entries in the window, a withdrawn one with its reason, read from the trail (G3-01, D13, X1)" -m "<the red you saw, and the body>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Add any trends test you changed in Step 4 to the `git add` line.)

---

### Task 7: The two trail reads, alike from memory, SQLite and Postgres (D10, D12)

**Files:**
- Create: `homunculus-engine/tests/test_bedside_trail_stores.py`

- [ ] **Step 1: Write the test**

Create `homunculus-engine/tests/test_bedside_trail_stores.py`:

```python
"""G3-01 (D10, D12): the withdrawal's two trail reads — one patient's rows of the rebuild's kinds and its
withdrawals, and the tenant's `chart_retract` rows — read alike from memory, SQLite and Postgres (Postgres
when TEST_DATABASE_URL is set). An `entry` survives the store as an integer. Synthetic values only."""
from __future__ import annotations

import pytest
from sqlalchemy import text

from homunculus.api.audit import AuditEvent, InMemoryAuditLog, SqliteAuditLog, iter_records_of
from homunculus.api.audit_postgres import PostgresAuditLog
from homunculus.api.clinical import RETRACT
from homunculus.api.rehydrate import REBUILD_EVENTS, retracted_entries
from tests.conftest import TEST_DATABASE_URL, requires_db
from tests.test_audit_postgres import _load_migration

AT = "2026-11-02T08:00:00+00:00"


def _exercise(log):
    chart = log.append(AuditEvent("h1", "chart", "bed-3", "heart_rate",
                                  {"value": 80, "unit": "/min", "obs_ts": AT, "charted_by": "hem.ayse"}))
    log.append(AuditEvent("h1", "alert", "bed-3", "news2", {}))
    log.append(AuditEvent("h1", "chart", "bed-4", "heart_rate",
                          {"value": 90, "unit": "/min", "obs_ts": AT, "charted_by": "hem.ayse"}))
    profile = log.append(AuditEvent("h1", "profile", "bed-3", "", {"comorbidities": ["copd"]}))
    withdrawal = log.append(AuditEvent("h1", RETRACT, "bed-3", "heart_rate",
                                       {"entry": chart.id, "value": 80, "obs_ts": AT,
                                        "reason": "yazım hatası", "retracted_by": "hem.ayse"}))
    rows = list(iter_records_of(log, tenant="h1", patient_id="bed-3", event_types=REBUILD_EVENTS | {RETRACT},
                                page=1))
    assert [r.id for r in rows] == [chart.id, profile.id, withdrawal.id]
    assert retracted_entries(iter_records_of(log, tenant="h1", event_types={RETRACT}, page=2)) == {chart.id}
    assert list(iter_records_of(log, tenant="h2", event_types={RETRACT}, page=2)) == []


def test_in_memory():
    _exercise(InMemoryAuditLog())


def test_sqlite():
    _exercise(SqliteAuditLog(":memory:"))


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
def test_postgres(pg_log):
    _exercise(pg_log)
```

- [ ] **Step 2: Run it without and with the database**

```bash
cd /c/tmp/g3-vitals/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_bedside_trail_stores.py 2>&1 | tail -3
docker ps --format '{{.Names}} {{.Status}}' | grep homunculus-test-pg-56
cd /c/tmp/g3-vitals/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_bedside_trail_stores.py tests/test_audit_event_types.py 2>&1 | tail -3
```

Expected:
- without the database: `2 passed, 1 skipped`;
- the container is `Up`;
- with the database: all pass, none skipped.

If the container is not up, report it. Do not start or reconfigure a shared container. These tests take the shared lock the database tests use (`tests/conftest.py`), so another session's run may make them wait: wait, do not kill anything.

- [ ] **Step 3: Line ends and commit**

```bash
cd /c/tmp/g3-vitals && /c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" homunculus-engine/tests/test_bedside_trail_stores.py
printf '%s ' homunculus-engine/tests/test_bedside_trail_stores.py; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" homunculus-engine/tests/test_bedside_trail_stores.py
git add -- homunculus-engine/tests/test_bedside_trail_stores.py
git status --short && git diff --cached --stat
git commit -m "test(audit): the withdrawal's two trail reads, alike from memory, SQLite and Postgres (G3-01, D10, D12)" -m "<the runs: 2 passed 1 skipped; with the database, all passed>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The API client and the store — preview a chart, withdraw an entry (D8, D10)

**Files:**
- Modify: `dashboard/src/backendApi.js`, `dashboard/src/backendApi.test.js`
- Modify: `dashboard/src/live/data/boardStore.js`, `dashboard/src/live/data/boardStore.test.js`
- Modify: `dashboard/src/live/session/testTokens.testutil.js`

- [ ] **Step 1: Write the failing tests**

In `dashboard/src/backendApi.test.js`, after the test that starts `it("reads the SOFA form, previews the corrections on the preview route and signs them with its expect"`, add:

```js

  // G3-01 (D8, D10): the preview takes the chart's own body on a route of its own; the withdrawal names the
  // entry the chart answered, and carries the reason.
  it("previews a chart on its own route and withdraws an entry with its reason", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ preview: true }));
    const api = signedIn(fetchMock);
    const entries = [{ code: "resp_rate", value: 26 }];
    await api.previewChart("S-001", entries, "2026-11-02T08:00:00.000Z");
    await api.previewChart("S-001", entries);
    await api.retractEntry("S-001", 41, "yazım hatası — 26 değil 16");
    const [[previewUrl, previewInit], [, untimedInit], [retractUrl, retractInit]] = fetchMock.mock.calls;
    expect(previewUrl).toBe("/clinical/S-001/preview");
    expect(previewInit.method).toBe("POST");
    expect(JSON.parse(previewInit.body)).toEqual({ entries, recorded_at: "2026-11-02T08:00:00.000Z" });
    expect(JSON.parse(untimedInit.body)).toEqual({ entries });
    expect(retractUrl).toBe("/clinical/S-001/entries/41/retract");
    expect(retractInit.method).toBe("POST");
    expect(JSON.parse(retractInit.body)).toEqual({ reason: "yazım hatası — 26 değil 16" });
  });
```

In `dashboard/src/live/data/boardStore.test.js`, after the test that starts `it("reads the SOFA form, previews corrections and signs them, and drops an answer that lands after clear()"`, add:

```js

  // G3-01: a preview changes no card, so nothing reloads; a withdrawal rebuilt the patient, so the board does.
  it("previews a chart without reloading, withdraws an entry and reloads, and drops an answer after clear()", async () => {
    const { api, store } = setup();
    api.previewChart = vi.fn().mockResolvedValue({ preview: true, news2: { total: 9 } });
    api.retractEntry = vi.fn().mockResolvedValue({ retracted: 41, code: "resp_rate", alerts: [] });
    const entries = [{ code: "resp_rate", value: 26 }];
    expect(await store.chartPreview("S-001", entries, null)).toMatchObject({ preview: true });
    expect(api.previewChart).toHaveBeenLastCalledWith("S-001", entries, null);
    expect(api.boardPatients).not.toHaveBeenCalled();
    expect(await store.retract("S-001", 41, "yazım hatası — 26 değil 16")).toMatchObject({ retracted: 41 });
    expect(api.retractEntry).toHaveBeenLastCalledWith("S-001", 41, "yazım hatası — 26 değil 16");
    expect(api.boardPatients).toHaveBeenCalledTimes(1);
    let answer;
    api.previewChart.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    const late = store.chartPreview("S-001", entries, null);
    store.clear();
    answer({ preview: true });
    expect(await late).toBeNull();
  });
```

- [ ] **Step 2: Run them and see them red**

```bash
cd /c/tmp/g3-vitals/dashboard && ./node_modules/.bin/vitest run src/backendApi.test.js src/live/data/boardStore.test.js 2>&1 | tail -8
```

Expected: `api.previewChart is not a function` and `store.chartPreview is not a function`.

- [ ] **Step 3: The calls**

In `dashboard/src/backendApi.js`, after the `chart(patientId, entries, recordedAt = null) { … },` method, add:

```js

      /**
       * G3-01 (D8): what `chart` would score for these entries — the engine's NEWS2 of a copy of the patient,
       * in the card's own shape (`news2`), or `dropped` for a discharged number. Nothing is written. The
       * chart's own body; an untouched time is sent as none, as `chart` sends it.
       */
      previewChart(patientId, entries, recordedAt = null) {
        return authed(`/clinical/${seg(patientId)}/preview`, {
          method: "POST",
          body: { entries, ...(recordedAt ? { recorded_at: recordedAt } : {}) },
        });
      },

      /** G3-01 (D10): «hatalı giriş» — withdraw one hand entry (`entry`, the id `chart` answered) with a reason. */
      retractEntry(patientId, entry, reason) {
        return authed(`/clinical/${seg(patientId)}/entries/${seg(entry)}/retract`, {
          method: "POST", body: { reason },
        });
      },
```

In `dashboard/src/live/data/boardStore.js`, after the `chart(patientId, entries, recordedAt = null)` method's closing `},`, add:

```js
    // G3-01 (D8): what a chart would score — nothing is written, so nothing reloads. Late answers drop.
    async chartPreview(patientId, entries, recordedAt = null) {
      const mine = generation;
      const answer = await track(() => api.previewChart(patientId, entries, recordedAt));
      return mine === generation ? answer : null;
    },
    // G3-01 (D10): «hatalı giriş». The engine rebuilt the patient without the entry: the card changed, so the
    // board reloads, as after a chart. A refusal rejects with the API's own error; nothing is changed locally.
    async retract(patientId, entry, reason) {
      const mine = generation;
      const answer = await track(() => api.retractEntry(patientId, entry, reason));
      if (mine !== generation) return null;
      await refresh();
      return answer;
    },
```

In `dashboard/src/live/session/testTokens.testutil.js`, after `      signSeverityForm: vi.fn(),` add:

```js
      // G3-01: the bedside form's preview and the «hatalı giriş» withdrawal (screens/bedside, trends)
      previewChart: vi.fn(),
      retractEntry: vi.fn(),
```

- [ ] **Step 4: Green**

```bash
cd /c/tmp/g3-vitals/dashboard && ./node_modules/.bin/vitest run src/backendApi.test.js src/live/data/boardStore.test.js 2>&1 | tail -5
```

Expected: both files pass, one new test each.

- [ ] **Step 5: Line ends and commit**

```bash
cd /c/tmp/g3-vitals && for f in dashboard/src/backendApi.js dashboard/src/backendApi.test.js dashboard/src/live/data/boardStore.js dashboard/src/live/data/boardStore.test.js dashboard/src/live/session/testTokens.testutil.js; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- dashboard/src/backendApi.js dashboard/src/backendApi.test.js dashboard/src/live/data/boardStore.js dashboard/src/live/data/boardStore.test.js dashboard/src/live/session/testTokens.testutil.js
git status --short && git diff --cached --stat
git commit -m "feat(api): previewChart and retractEntry; the store's chartPreview and retract (G3-01, D8, D10)" -m "<the red you saw, and the body>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The `olcum` strings, four languages (D3, D4, D8, D10, D13)

**Files:**
- Create: `dashboard/src/live/i18n/strings/olcum.js`
- Modify: `dashboard/src/live/i18n/catalog.js`

The form reuses names that already exist, so a channel has one name across the product:
- the board's channel names and units: `board.chRr`, `board.chSpo2`, `board.chSbp`, `board.chMap`, `board.chHr`, `board.chTemp`, `board.unitBpm`, `board.unitPct`, `board.unitMmhg`, `board.unitC`;
- NEWS2's parameter names: `news2.missing.*`;
- the house buttons: `common.save`, `common.cancel`, `common.close`.

This also keeps `%`, `°C` and `mmHg` out of the namespace. They are the same in TR and AZ, and the strings test would flag them.

- [ ] **Step 1: The namespace**

Create `dashboard/src/live/i18n/strings/olcum.js`:

```js
// src/live/i18n/strings/olcum.js — the bedside measurement (G3-01): the «Yatak başı ölçüm» page
// (screens/bedside/), its form in the patient screen's «Ölçüm gir» dialog, the preview, the saved step and
// «hatalı giriş» (screens/common/RetractDialog.jsx, the trend dialog's table and chart).
// What every language must keep:
//   - an empty box is «not measured», never 0 (D4);
//   - the NEWS2 shown is the engine's, and the decision is the physician's (D8);
//   - «hatalı giriş» takes a value out of every score and alert, keeps it struck through with its reason, and
//     is written to the audit trail (D10, D13);
//   - a refusal and a toast name their subject first ({subject}: the bed, never a name).
// Channel names and units are the board's (board.ch*, board.unit*), NEWS2's parameters news2.missing.*.
// TR is the source. AZ, RU and EN await a native reading (O5). Russian calls the engine «система».
export default {
  tr: {
    nav: "Yatak başı ölçüm", navShort: "Ölçüm",
    title: "Yatak başı ölçüm",
    intro: "Tablet ve telefon için: hastayı seçin, kimliğini doğrulayın, ölçümü girin. Girilen değer motora gider; NEWS2'yi motor hesaplar.",
    gone: "Seçilen hasta artık listede değil (taburcu ya da kapsam dışı). Yeniden seçin.",
    pickTitle: "Hastayı seçin",
    pickEmpty: "Birimlerinizde yatan hasta yok.",
    pickAge: "{years} yaş",
    pickLast: "son ölçüm {time}",
    pickNone: "ölçüm yok",
    identityTitle: "Kimlik doğrulama",
    identityName: "Ad soyad",
    identityYear: "Doğum yılı",
    identityBed: "Yatak",
    identityNoBirth: "doğum tarihi kayıtlı değil",
    identityAsk: "Ad soyad ve doğum yılı hastayla eşleşiyor mu?",
    identityYes: "Evet, eşleşiyor",
    identityNo: "Hayır, eşleşmiyor",
    identityRefused: "{subject}: kimlik eşleşmedi, seçim iptal edildi. Sorumlu hemşireye bildirin.",
    formTitle: "Ölçüm · {bed}",
    at: "Ölçüm saati",
    atHint: "Değiştirmezseniz kaydedildiği an yazılır; en çok 24 saat geriye.",
    atInvalid: "Saati tam girin.",
    atFuture: "Ölçüm saati ileri olamaz.",
    atTooOld: "Ölçüm saati en çok 24 saat geriye alınabilir.",
    o2: "Ek oksijen",
    o2Air: "Oda havası",
    o2On: "Ek oksijen alıyor",
    acvpu: "Bilinç (ACVPU)",
    acvpuA: "A — uyanık",
    acvpuC: "C — yeni konfüzyon",
    acvpuV: "V — sese yanıt",
    acvpuP: "P — ağrıya yanıt",
    acvpuU: "U — yanıtsız",
    notMeasured: "ölçülmedi",
    mapHint: "İsteğe bağlı.",
    notNumber: "Sayı girin.",
    notWhole: "Tam sayı girin.",
    oneDecimal: "En çok bir ondalık basamak.",
    outOfRange: "{low}–{high} aralığında olmalı.",
    mapAboveSbp: "MAP sistolik basınçtan küçük olmalı.",
    nothing: "En az bir değer girin.",
    minus: "{label} azalt",
    plus: "{label} artır",
    preview: "Önizle",
    previewing: "Önizleniyor…",
    saving: "Kaydediliyor…",
    back: "Geri",
    previewFirst: "Kaydetmeden önce önizleyin: NEWS2'yi motor hesaplar.",
    previewTitle: "Erken uyarı · NEWS2 önizlemesi",
    previewLabel: "Önizlenen NEWS2",
    previewPartial: "Kısmi skor: {missing} girilmedi ya da güncel değil.",
    previewComplete: "Tam skor: eksik ölçüm yok.",
    previewPoints: "{name}: +{points} puan",
    previewNoPoints: "Hiçbir değer puan getirmiyor.",
    previewNote: "Puanı motor hesaplar; karar hekimindir.",
    previewed: "Önizleme hazır: NEWS2 {total}. Kaydetmek için «Kaydet».",
    previewOld: "Değerler değişti — yeniden önizleyin.",
    previewRefused: "{subject}: önizlenemedi — {reason}",
    previewNotPreview: "motorun yanıtı bir önizleme değildi",
    previewDropped: "Bu hasta taburcu edilmiş; ölçüm girilmez.",
    noRight: "ölçüm girme yetkiniz yok",
    saved: "Kaydedildi · {time}",
    savedToast: "{subject}: ölçüm kaydedildi.",
    savedRefused: "{subject}: ölçüm kaydedilmedi — {reason}",
    savedDropped: "{subject}: hasta taburcu edilmiş; ölçüm kaydedilmedi.",
    savedMayHaveLanded: "{subject}: yanıt gelmedi — ölçüm kaydedilmiş olabilir. Tekrar girmeden önce hasta ekranına bakın.",
    savedList: "Kaydedilen değerler",
    savedNext: "Sıradaki hasta",
    savedOpen: "Hasta ekranı",
    retract: "Hatalı giriş",
    retractTitle: "Hatalı giriş · {bed}",
    retractWhat: "{label}: {value} · ölçüm {time}",
    retractIntro: "Değer bütün skorlardan ve uyarılardan çıkar; grafikte üstü çizili, gerekçesiyle kalır. İşlem denetim kaydına yazılır.",
    retractReason: "Gerekçe",
    retractCount: "{count} / {min} karakter",
    retractConfirm: "Hatalı giriş olarak işaretle",
    retractDone: "{subject}: {label} hatalı giriş olarak işaretlendi.",
    retractRefused: "{subject}: işaretlenmedi — {reason}",
    retractMayHaveLanded: "{subject}: yanıt gelmedi — işaretlenmiş olabilir. Grafiğe bakın.",
    retracted: "hatalı giriş — {reason} · {who} · {time}",
    retractedShort: "hatalı giriş olarak işaretlendi",
    hand: "elle",
    legendWithdrawn: "Üstü çizili nokta: hatalı giriş — skora girmez; gerekçesi tabloda.",
    entryButton: "Ölçüm gir",
    entryTitle: "Ölçüm gir · {bed}",
  },
  az: {
    nav: "Çarpayı başında ölçmə", navShort: "Ölçmə",
    title: "Çarpayı başında ölçmə",
    intro: "Planşet və telefon üçün: xəstəni seçin, şəxsiyyətini təsdiqləyin, ölçməni daxil edin. Daxil edilən dəyər mühərrikə gedir; NEWS2-ni mühərrik hesablayır.",
    gone: "Seçilmiş xəstə artıq siyahıda deyil (evə yazılıb və ya əhatə xaricindədir). Yenidən seçin.",
    pickTitle: "Xəstəni seçin",
    pickEmpty: "Bölmələrinizdə yatan xəstə yoxdur.",
    pickAge: "{years} yaşında",
    pickLast: "son ölçmə {time}",
    pickNone: "ölçmə yoxdur",
    identityTitle: "Şəxsiyyətin təsdiqi",
    identityName: "Ad, soyad",
    identityYear: "Doğum ili",
    identityBed: "Çarpayı",
    identityNoBirth: "doğum tarixi qeyd edilməyib",
    identityAsk: "Ad, soyad və doğum ili xəstəyə uyğundurmu?",
    identityYes: "Bəli, uyğundur",
    identityNo: "Xeyr, uyğun deyil",
    identityRefused: "{subject}: şəxsiyyət uyğun gəlmədi, seçim ləğv edildi. Məsul tibb bacısına bildirin.",
    formTitle: "Ölçmə · {bed}",
    at: "Ölçmə vaxtı",
    atHint: "Dəyişməsəniz, yadda saxlandığı an yazılır; ən çox 24 saat geriyə.",
    atInvalid: "Vaxtı tam daxil edin.",
    atFuture: "Ölçmə vaxtı irəlidə ola bilməz.",
    atTooOld: "Ölçmə vaxtı ən çox 24 saat geriyə çəkilə bilər.",
    o2: "Əlavə oksigen",
    o2Air: "Otaq havası",
    o2On: "Əlavə oksigen alır",
    acvpu: "Şüur (ACVPU)",
    acvpuA: "A — oyaqdır",
    acvpuC: "C — yeni çaşqınlıq",
    acvpuV: "V — səsə cavab",
    acvpuP: "P — ağrıya cavab",
    acvpuU: "U — cavabsız",
    notMeasured: "ölçülməyib",
    mapHint: "İstəyə bağlı.",
    notNumber: "Rəqəm daxil edin.",
    notWhole: "Tam ədəd daxil edin.",
    oneDecimal: "Ən çox bir onluq rəqəm.",
    outOfRange: "{low}–{high} aralığında olmalıdır.",
    mapAboveSbp: "MAP sistolik təzyiqdən kiçik olmalıdır.",
    nothing: "Ən azı bir dəyər daxil edin.",
    minus: "{label}: azalt",
    plus: "{label}: artır",
    preview: "Öncədən baxın",
    previewing: "Öncədən baxış hazırlanır…",
    saving: "Yadda saxlanılır…",
    back: "Geriyə",
    previewFirst: "Yadda saxlamazdan əvvəl öncədən baxın: NEWS2-ni mühərrik hesablayır.",
    previewTitle: "Erkən xəbərdarlıq · NEWS2-yə öncədən baxış",
    previewLabel: "NEWS2 (öncədən baxış)",
    previewPartial: "Qismən bal: {missing} daxil edilməyib və ya cari deyil.",
    previewComplete: "Tam bal: çatışmayan ölçmə yoxdur.",
    previewPoints: "{name}: +{points} bal",
    previewNoPoints: "Heç bir dəyər bal gətirmir.",
    previewNote: "Balı mühərrik hesablayır; qərar həkimindir.",
    previewed: "Öncədən baxış hazırdır: NEWS2 {total}. Yadda saxlamaq üçün «Yadda saxla».",
    previewOld: "Dəyərlər dəyişdi — yenidən öncədən baxın.",
    previewRefused: "{subject}: öncədən baxış alınmadı — {reason}",
    previewNotPreview: "mühərrikin cavabı öncədən baxış deyildi",
    previewDropped: "Bu xəstə evə yazılıb; ölçmə daxil edilmir.",
    noRight: "ölçmə daxil etmək hüququnuz yoxdur",
    saved: "Yadda saxlanıldı · {time}",
    savedToast: "{subject}: ölçmə yadda saxlanıldı.",
    savedRefused: "{subject}: ölçmə yadda saxlanılmadı — {reason}",
    savedDropped: "{subject}: xəstə evə yazılıb; ölçmə yadda saxlanılmadı.",
    savedMayHaveLanded: "{subject}: cavab gəlmədi — ölçmə yadda saxlanılmış ola bilər. Yenidən daxil etməzdən əvvəl xəstə ekranına baxın.",
    savedList: "Yadda saxlanılan dəyərlər",
    savedNext: "Növbəti xəstə",
    savedOpen: "Xəstə ekranı",
    retract: "Səhv qeyd",
    retractTitle: "Səhv qeyd · {bed}",
    retractWhat: "{label}: {value} · ölçmə {time}",
    retractIntro: "Dəyər bütün ballardan və xəbərdarlıqlardan çıxarılır; qrafikdə üstüxətli, səbəbi ilə qalır. Əməliyyat audit jurnalına yazılır.",
    retractReason: "Səbəb",
    retractCount: "{count} / {min} simvol",
    retractConfirm: "Səhv qeyd kimi işarələ",
    retractDone: "{subject}: {label} səhv qeyd kimi işarələndi.",
    retractRefused: "{subject}: işarələnmədi — {reason}",
    retractMayHaveLanded: "{subject}: cavab gəlmədi — işarələnmiş ola bilər. Qrafikə baxın.",
    retracted: "səhv qeyd — {reason} · {who} · {time}",
    retractedShort: "səhv qeyd kimi işarələndi",
    hand: "əl ilə",
    legendWithdrawn: "Üstüxətli nöqtə: səhv qeyd — bala daxil edilmir; səbəbi cədvəldədir.",
    entryButton: "Ölçmə daxil et",
    entryTitle: "Ölçmə daxil et · {bed}",
  },
  ru: {
    nav: "Измерение у постели", navShort: "Измерение",
    title: "Измерение у постели",
    intro: "Для планшета и телефона: выберите пациента, подтвердите личность, введите измерение. Значение уходит в систему; NEWS2 считает система.",
    gone: "Выбранного пациента больше нет в списке (выписан или вне области видимости). Выберите снова.",
    pickTitle: "Выберите пациента",
    pickEmpty: "В ваших отделениях нет госпитализированных пациентов.",
    pickAge: "возраст {years}",
    pickLast: "последнее измерение {time}",
    pickNone: "измерений нет",
    identityTitle: "Подтверждение личности",
    identityName: "Имя и фамилия",
    identityYear: "Год рождения",
    identityBed: "Койка",
    identityNoBirth: "дата рождения не записана",
    identityAsk: "Имя, фамилия и год рождения совпадают с пациентом?",
    identityYes: "Да, совпадают",
    identityNo: "Нет, не совпадают",
    identityRefused: "{subject}: личность не совпала, выбор отменён. Сообщите старшей медсестре.",
    formTitle: "Измерение · {bed}",
    at: "Время измерения",
    atHint: "Если не менять, записывается момент сохранения; не более 24 часов назад.",
    atInvalid: "Введите время полностью.",
    atFuture: "Время измерения не может быть в будущем.",
    atTooOld: "Время измерения — не более 24 часов назад.",
    o2: "Дополнительный кислород",
    o2Air: "Комнатный воздух",
    o2On: "Получает кислород",
    acvpu: "Сознание (ACVPU)",
    acvpuA: "A — в ясном сознании",
    acvpuC: "C — новая спутанность",
    acvpuV: "V — реакция на голос",
    acvpuP: "P — реакция на боль",
    acvpuU: "U — нет реакции",
    notMeasured: "не измерено",
    mapHint: "Необязательно.",
    notNumber: "Введите число.",
    notWhole: "Введите целое число.",
    oneDecimal: "Не более одного знака после запятой.",
    outOfRange: "Должно быть в пределах {low}–{high}.",
    mapAboveSbp: "СрАД должно быть меньше систолического давления.",
    nothing: "Введите хотя бы одно значение.",
    minus: "{label}: уменьшить",
    plus: "{label}: увеличить",
    preview: "Предпросмотр",
    previewing: "Расчёт…",
    saving: "Сохранение…",
    back: "Назад",
    previewFirst: "Перед сохранением выполните предпросмотр: NEWS2 считает система.",
    previewTitle: "Раннее предупреждение · предпросмотр NEWS2",
    previewLabel: "NEWS2 в предпросмотре",
    previewPartial: "Неполная оценка: не введено или устарело — {missing}.",
    previewComplete: "Полная оценка: все измерения есть.",
    previewPoints: "{name}: +{points} балл.",
    previewNoPoints: "Ни одно значение не даёт баллов.",
    previewNote: "Баллы считает система; решение принимает врач.",
    previewed: "Предпросмотр готов: NEWS2 {total}. Чтобы сохранить, нажмите «Сохранить».",
    previewOld: "Значения изменились — повторите предпросмотр.",
    previewRefused: "{subject}: предпросмотр не выполнен — {reason}",
    previewNotPreview: "ответ системы не был предпросмотром",
    previewDropped: "Пациент выписан; измерения не вводятся.",
    noRight: "у вас нет права вводить измерения",
    saved: "Сохранено · {time}",
    savedToast: "{subject}: измерение сохранено.",
    savedRefused: "{subject}: измерение не сохранено — {reason}",
    savedDropped: "{subject}: пациент выписан; измерение не сохранено.",
    savedMayHaveLanded: "{subject}: ответа нет — измерение могло сохраниться. Прежде чем вводить снова, проверьте экран пациента.",
    savedList: "Сохранённые значения",
    savedNext: "Следующий пациент",
    savedOpen: "Экран пациента",
    retract: "Ошибочная запись",
    retractTitle: "Ошибочная запись · {bed}",
    retractWhat: "{label}: {value} · измерено {time}",
    retractIntro: "Значение исключается из всех оценок и предупреждений; на графике остаётся зачёркнутым, с причиной. Действие записывается в журнал аудита.",
    retractReason: "Причина",
    retractCount: "{count} / {min} символов",
    retractConfirm: "Отметить как ошибочную запись",
    retractDone: "{subject}: {label} — отмечено как ошибочная запись.",
    retractRefused: "{subject}: не отмечено — {reason}",
    retractMayHaveLanded: "{subject}: ответа нет — отметка могла сохраниться. Проверьте график.",
    retracted: "ошибочная запись — {reason} · {who} · {time}",
    retractedShort: "отмечено как ошибочная запись",
    hand: "вручную",
    legendWithdrawn: "Зачёркнутая точка: ошибочная запись — в оценку не входит; причина в таблице.",
    entryButton: "Ввести измерение",
    entryTitle: "Ввести измерение · {bed}",
  },
  en: {
    nav: "Bedside measurement", navShort: "Measure",
    title: "Bedside measurement",
    intro: "For tablet and phone: choose the patient, confirm their identity, enter the measurement. The value goes to the engine; the engine scores NEWS2.",
    gone: "The chosen patient is no longer on the list (discharged or out of scope). Choose again.",
    pickTitle: "Choose the patient",
    pickEmpty: "No admitted patient in your units.",
    pickAge: "age {years}",
    pickLast: "last measured {time}",
    pickNone: "no measurement",
    identityTitle: "Identity check",
    identityName: "Full name",
    identityYear: "Year of birth",
    identityBed: "Bed",
    identityNoBirth: "no birth date on record",
    identityAsk: "Do the name and year of birth match the patient?",
    identityYes: "Yes, they match",
    identityNo: "No, they don't match",
    identityRefused: "{subject}: the identity did not match; the choice was cancelled. Tell the charge nurse.",
    formTitle: "Measurement · {bed}",
    at: "Measured at",
    atHint: "Left as it is, the moment of saving is written; at most 24 hours back.",
    atInvalid: "Enter the full time.",
    atFuture: "The time cannot be in the future.",
    atTooOld: "At most 24 hours back.",
    o2: "Supplemental oxygen",
    o2Air: "Room air",
    o2On: "On oxygen",
    acvpu: "Consciousness (ACVPU)",
    acvpuA: "A — alert",
    acvpuC: "C — new confusion",
    acvpuV: "V — responds to voice",
    acvpuP: "P — responds to pain",
    acvpuU: "U — unresponsive",
    notMeasured: "not measured",
    mapHint: "Optional.",
    notNumber: "Enter a number.",
    notWhole: "Enter a whole number.",
    oneDecimal: "At most one decimal place.",
    outOfRange: "Must be within {low}–{high}.",
    mapAboveSbp: "MAP must be below the systolic pressure.",
    nothing: "Enter at least one value.",
    minus: "{label}: decrease",
    plus: "{label}: increase",
    preview: "Preview",
    previewing: "Previewing…",
    saving: "Saving…",
    back: "Back",
    previewFirst: "Preview before saving: the engine scores NEWS2.",
    previewTitle: "Early warning · NEWS2 preview",
    previewLabel: "Previewed NEWS2",
    previewPartial: "Partial score: {missing} not entered or not current.",
    previewComplete: "Full score: no measurement missing.",
    previewPoints: "{name}: +{points}",
    previewNoPoints: "No value scores points.",
    previewNote: "The engine scores; the decision is the physician's.",
    previewed: "Preview ready: NEWS2 {total}. Press «Save» to save.",
    previewOld: "The values changed — preview again.",
    previewRefused: "{subject}: preview failed — {reason}",
    previewNotPreview: "the engine's answer was not a preview",
    previewDropped: "This patient was discharged; no measurement is entered.",
    noRight: "you may not enter measurements",
    saved: "Saved · {time}",
    savedToast: "{subject}: measurement saved.",
    savedRefused: "{subject}: measurement not saved — {reason}",
    savedDropped: "{subject}: the patient was discharged; nothing was saved.",
    savedMayHaveLanded: "{subject}: no answer — the measurement may have been saved. Check the patient screen before entering it again.",
    savedList: "Values saved",
    savedNext: "Next patient",
    savedOpen: "Patient screen",
    retract: "Entered in error",
    retractTitle: "Entered in error · {bed}",
    retractWhat: "{label}: {value} · measured {time}",
    retractIntro: "The value leaves every score and alert; the chart keeps it struck through, with the reason. This is written to the audit trail.",
    retractReason: "Reason",
    retractCount: "{count} / {min} characters",
    retractConfirm: "Mark as entered in error",
    retractDone: "{subject}: {label} marked as entered in error.",
    retractRefused: "{subject}: not marked — {reason}",
    retractMayHaveLanded: "{subject}: no answer — it may have been marked. Check the chart.",
    retracted: "entered in error — {reason} · {who} · {time}",
    retractedShort: "marked as entered in error",
    hand: "by hand",
    legendWithdrawn: "Crossed dot: entered in error — not scored; the reason is in the table.",
    entryButton: "Enter measurement",
    entryTitle: "Enter measurement · {bed}",
  },
};
```

- [ ] **Step 2: Register it**

In `dashboard/src/live/i18n/catalog.js`, after:

```js
// G2-B1d: Protokol — the protocol number, its label, Yönetim › Protokol ve etiket.
import protokol from "./strings/protokol.js";
```

add:

```js

// G3-01: the bedside measurement — the «Yatak başı ölçüm» page, «Ölçüm gir», «hatalı giriş».
import olcum from "./strings/olcum.js";
```

and in `NAMESPACES` replace:

```js
  protokol, // G2-B1d
};
```

with:

```js
  protokol, // G2-B1d

  olcum, // G3-01
};
```

The blank line before `olcum` is the file's rule: one entry per arm, with untouched context between them.

- [ ] **Step 3: The strings test**

```bash
cd /c/tmp/g3-vitals/dashboard && ./node_modules/.bin/vitest run src/live/i18n 2>&1 | tail -8
```

Expected: `strings.test.js` passes. That means:
- the same keys in all four languages;
- the same placeholders as TR;
- no AZ text equal to its TR;
- every RU value has Cyrillic;
- no «движок».

If the test names a key, change that language's wording. Do not list the key in `AZ_SAME_AS_TR`.

- [ ] **Step 4: Line ends and commit**

```bash
cd /c/tmp/g3-vitals && /c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" dashboard/src/live/i18n/strings/olcum.js
for f in dashboard/src/live/i18n/strings/olcum.js dashboard/src/live/i18n/catalog.js; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- dashboard/src/live/i18n/strings/olcum.js dashboard/src/live/i18n/catalog.js
git status --short && git diff --cached --stat
git commit -m "feat(i18n): the olcum namespace — the bedside page, its form, preview, saved step and «hatalı giriş», four languages (G3-01)" -m "<the body>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


---

### Task 10: `vitalsFields.js` — the eight inputs, their bounds, the number and time rules (D2, D4, D6, D7, X9, X12)

**Files:**
- Create: `dashboard/src/live/screens/bedside/vitalsFields.js`, `dashboard/src/live/screens/bedside/vitalsFields.test.js`

- [ ] **Step 1: Write the failing test**

Create `dashboard/src/live/screens/bedside/vitalsFields.test.js`:

```js
// The bedside form's inputs and rules, without a screen (G3-01, D2, D4, D6, D7, X9, X12).
import { describe, it, expect } from "vitest";
import { DICTIONARIES } from "../../i18n/catalog.js";
import { LANG_CODES } from "../../i18n/langs.js";
import {
  BACKDATE_MS, NEWS2_PARAMETERS, VITALS, birthYearOf, checkDraft, checkVital, draftKey, hasErrors, lastMeasuredMs,
  specOf, stepValue, toLocalInput,
} from "./vitalsFields.js";

const NOW = Date.parse("2026-11-02T10:00:00Z");

describe("the inputs", () => {
  it("are the prototype's eight, in its order, each label and unit in every language", () => {
    expect(VITALS.map((s) => s.code)).toEqual(
      ["resp_rate", "spo2", "supplemental_oxygen", "sbp", "map", "heart_rate", "acvpu", "temperature"]);
    for (const spec of VITALS) {
      const keys = [spec.labelKey, spec.unitKey, ...(spec.options ?? []).map((o) => o.labelKey)].filter(Boolean);
      for (const key of keys) for (const lang of LANG_CODES) expect(DICTIONARIES[lang][key], `${lang} ${key}`).toBeTruthy();
    }
    for (const p of NEWS2_PARAMETERS) {
      expect(DICTIONARIES.az[p.labelKey], p.name).toBeTruthy();
      if (p.missingKey) expect(DICTIONARIES.az[p.missingKey], p.name).toBeTruthy();
    }
    expect(NEWS2_PARAMETERS.filter((p) => p.missingKey).map((p) => p.name))
      .toEqual(["respiration_rate", "spo2", "systolic_bp", "pulse", "temperature"]);
  });

  it("mirror the door's slip bounds", () => {
    expect([specOf("resp_rate").min, specOf("resp_rate").max]).toEqual([0, 80]);
    expect([specOf("spo2").min, specOf("spo2").max]).toEqual([0, 100]);
    expect([specOf("sbp").max, specOf("map").max, specOf("heart_rate").max]).toEqual([300, 300, 300]);
    expect([specOf("temperature").min, specOf("temperature").max]).toEqual([25, 45]);
    expect(specOf("constructor")).toBeNull();
  });
});

describe("one value", () => {
  it("an empty box is not measured and is not sent (D4)", () => {
    expect(checkVital(specOf("resp_rate"), "")).toEqual({ skip: true });
    expect(checkVital(specOf("acvpu"), "")).toEqual({ skip: true });
  });

  it("a counted vital is whole; a temperature takes one decimal, with a comma too", () => {
    expect(checkVital(specOf("resp_rate"), "26")).toEqual({ value: 26 });
    expect(checkVital(specOf("resp_rate"), "26,5").error.key).toBe("olcum.notWhole");
    expect(checkVital(specOf("temperature"), "36,8")).toEqual({ value: 36.8 });
    expect(checkVital(specOf("temperature"), "36,85").error.key).toBe("olcum.oneDecimal");
    expect(checkVital(specOf("spo2"), "abc").error.key).toBe("olcum.notNumber");
  });

  it("a slipped digit is held back with the bounds in the sentence", () => {
    expect(checkVital(specOf("heart_rate"), "800").error).toEqual({ key: "olcum.outOfRange", params: { low: 0, high: 300 } });
  });

  it("a choice takes one of its values", () => {
    expect(checkVital(specOf("supplemental_oxygen"), "1")).toEqual({ value: 1 });
    expect(checkVital(specOf("acvpu"), "4")).toEqual({ value: 4 });
    expect(checkVital(specOf("acvpu"), "9").error.key).toBe("olcum.notNumber");
  });
});

describe("the draft", () => {
  it("sends only what was entered, in the inputs' order, with no time when it was not touched (X12)", () => {
    const checked = checkDraft({ values: { spo2: "91", resp_rate: "26", acvpu: "" } }, NOW);
    expect(checked).toEqual({ entries: [{ code: "resp_rate", value: 26 }, { code: "spo2", value: 91 }], recordedAt: null, errors: {} });
    expect(hasErrors(checked)).toBe(false);
  });

  it("asks for at least one value", () => {
    expect(checkDraft({ values: {} }, NOW).errors).toEqual({ form: { key: "olcum.nothing" } });
  });

  it("holds MAP below the systolic in one form (D6)", () => {
    expect(checkDraft({ values: { sbp: "90", map: "95" } }, NOW).errors.map).toEqual({ key: "olcum.mapAboveSbp" });
    expect(checkDraft({ values: { sbp: "90", map: "65" } }, NOW).errors).toEqual({});
  });

  it("takes a typed time up to a day back and never ahead (D7)", () => {
    const at = (ms) => ({ values: { spo2: "95" }, at: toLocalInput(ms), atTouched: true });
    expect(checkDraft(at(NOW - 60 * 60_000), NOW).recordedAt).toBe(new Date(Math.floor((NOW - 60 * 60_000) / 60_000) * 60_000).toISOString());
    expect(checkDraft(at(NOW + 10 * 60_000), NOW).errors.at).toEqual({ key: "olcum.atFuture" });
    expect(checkDraft(at(NOW - BACKDATE_MS - 2 * 60_000), NOW).errors.at).toEqual({ key: "olcum.atTooOld" });
    expect(checkDraft({ values: { spo2: "95" }, at: "", atTouched: true }, NOW).errors.at).toEqual({ key: "olcum.atInvalid" });
  });

  it("keys a draft by what it would send", () => {
    const a = checkDraft({ values: { spo2: "95" } }, NOW);
    const b = checkDraft({ values: { spo2: "95,0" } }, NOW);
    expect(draftKey(a)).toBe(draftKey(b));
    expect(draftKey(a)).not.toBe(draftKey(checkDraft({ values: { spo2: "96" } }, NOW)));
  });
});

describe("the helpers", () => {
  it("step a value inside its bounds, and nothing from an empty box", () => {
    expect(stepValue(specOf("resp_rate"), "26", 1)).toBe("27");
    expect(stepValue(specOf("spo2"), "100", 1)).toBe("100");
    expect(stepValue(specOf("temperature"), "36,8", 1)).toBe("36.9");
    expect(stepValue(specOf("heart_rate"), "", 1)).toBeNull();
  });

  it("read the year of a birth date and the last NEWS2 measurement (X9)", () => {
    expect(birthYearOf("1970-05-05")).toBe("1970");
    expect(birthYearOf(null)).toBeNull();
    expect(lastMeasuredMs({ news2: { measured_at: { spo2: "2026-11-02T08:00:00Z", pulse: "2026-11-02T09:00:00Z", temperature: null } } }))
      .toBe(Date.parse("2026-11-02T09:00:00Z"));
    expect(lastMeasuredMs({ news2: null })).toBeNull();
  });
});
```

- [ ] **Step 2: Red**

```bash
cd /c/tmp/g3-vitals/dashboard && ./node_modules/.bin/vitest run src/live/screens/bedside/vitalsFields.test.js 2>&1 | tail -5
```

Expected: `Failed to resolve import "./vitalsFields.js"`.

- [ ] **Step 3: The module**

Create `dashboard/src/live/screens/bedside/vitalsFields.js`:

```js
// src/live/screens/bedside/vitalsFields.js — the bedside form's eight inputs and its rules (G3-01, D2, D4, D6, D7,
// X9, X12). Pure: no React and no request.
//
// THE INPUTS in the prototype's order (tasarim-taslaklari/app/nursing.js `bedside`): solunum, SpO₂, ek oksijen,
// sistolik, MAP, nabız, bilinç, ateş. Each has the engine's code and the board's own label and unit keys (one name
// for a channel across the product). A number has the door's slip bounds (api/clinical.py PLAUSIBLE), mirrored only
// to hold a slipped digit back; the server stays authoritative. No band and no point lives here: the browser scores
// nothing (Decision 1).
//
// THE RULES: an empty box is «ölçülmedi» and is not sent (D4), and at least one value is asked for. MAP sits below
// the systolic within one form (D6). A typed time goes up to 24 h back and never ahead; an untouched one is not sent
// at all, and the server stamps its own clock (X12). The number rule is the Meds form's, imported: one "plain
// decimal" (a comma read as a point) for every chart the patient screen writes.
import { BACKDATE_MS, fromLocalInput, number } from "../patient/meds/medsFields.js";

export { BACKDATE_MS, toLocalInput } from "../patient/meds/medsFields.js";

/** A minute of skew between this browser's clock and the server's is not "ahead" (the Meds form's minute). */
const SKEW_MS = 60_000;

export const VITALS = Object.freeze([
  Object.freeze({ code: "resp_rate", kind: "number", labelKey: "board.chRr", unitKey: "board.unitBpm",
    min: 0, max: 80, whole: true, step: 1 }),
  Object.freeze({ code: "spo2", kind: "number", labelKey: "board.chSpo2", unitKey: "board.unitPct",
    min: 0, max: 100, whole: true, step: 1 }),
  Object.freeze({ code: "supplemental_oxygen", kind: "choice", labelKey: "olcum.o2",
    options: Object.freeze([{ value: "0", labelKey: "olcum.o2Air" }, { value: "1", labelKey: "olcum.o2On" }]) }),
  Object.freeze({ code: "sbp", kind: "number", labelKey: "board.chSbp", unitKey: "board.unitMmhg",
    min: 0, max: 300, whole: true, step: 1 }),
  Object.freeze({ code: "map", kind: "number", labelKey: "board.chMap", unitKey: "board.unitMmhg",
    min: 0, max: 300, whole: true, step: 1, hintKey: "olcum.mapHint" }),
  Object.freeze({ code: "heart_rate", kind: "number", labelKey: "board.chHr", unitKey: "board.unitBpm",
    min: 0, max: 300, whole: true, step: 1 }),
  // ACVPU as the engine records it (canonical.py): 0 = Alert … 4 = Unresponsive. The keys are written out, never
  // built: a key made at run time is out of the raw-key sweep's reach (rawKeys.test.jsx).
  Object.freeze({ code: "acvpu", kind: "choice", labelKey: "olcum.acvpu",
    options: Object.freeze([{ value: "0", labelKey: "olcum.acvpuA" }, { value: "1", labelKey: "olcum.acvpuC" },
      { value: "2", labelKey: "olcum.acvpuV" }, { value: "3", labelKey: "olcum.acvpuP" },
      { value: "4", labelKey: "olcum.acvpuU" }]) }),
  Object.freeze({ code: "temperature", kind: "number", labelKey: "board.chTemp", unitKey: "board.unitC",
    min: 25, max: 45, whole: false, step: 0.1 }),
]);

const SPECS = Object.freeze(Object.fromEntries(VITALS.map((s) => [s.code, s])));

/** The input for an engine code, or null — own properties only ("constructor" is not an input). */
export const specOf = (code) => (Object.prototype.hasOwnProperty.call(SPECS, code) ? SPECS[code] : null);

/** One box: `{ skip: true }` when empty (D4), `{ value }`, or `{ error: { key, params? } }`. */
export function checkVital(spec, raw) {
  const text = String(raw ?? "").trim();
  if (spec.kind === "choice") {
    if (text === "") return { skip: true };
    return spec.options.some((o) => o.value === text) ? { value: Number(text) } : { error: { key: "olcum.notNumber" } };
  }
  const n = number(text);
  if (n === "") return { skip: true };
  if (Number.isNaN(n)) return { error: { key: "olcum.notNumber" } };
  if (spec.whole && !Number.isInteger(n)) return { error: { key: "olcum.notWhole" } };
  if (!spec.whole && /[.,]\d{2,}$/.test(text)) return { error: { key: "olcum.oneDecimal" } };
  if (n < spec.min || n > spec.max) {
    return { error: { key: "olcum.outOfRange", params: { low: spec.min, high: spec.max } } };
  }
  return { value: n };
}

/** The whole draft: `{ entries, recordedAt, errors }`. `draft` is `{ values: {code: raw}, at, atTouched }`, `at`
 *  the `datetime-local` value in the browser's zone; `now` the browser's clock in ms. `errors` is by code, plus
 *  `form` (nothing entered) and `at`. `recordedAt` is a UTC instant, or null for an untouched time (X12). */
export function checkDraft({ values = {}, at = "", atTouched = false } = {}, now) {
  const errors = {};
  const entries = [];
  for (const spec of VITALS) {
    const checked = checkVital(spec, values[spec.code]);
    if (checked.error) errors[spec.code] = checked.error;
    else if (!checked.skip) entries.push({ code: spec.code, value: checked.value });
  }
  const sbp = entries.find((e) => e.code === "sbp");
  const map = entries.find((e) => e.code === "map");
  if (sbp && map && map.value >= sbp.value && !errors.map) errors.map = { key: "olcum.mapAboveSbp" };
  if (entries.length === 0 && Object.keys(errors).length === 0) errors.form = { key: "olcum.nothing" };
  let recordedAt = null;
  if (atTouched) {
    const ms = fromLocalInput(at);
    if (!Number.isFinite(ms)) errors.at = { key: "olcum.atInvalid" };
    else if (ms > now + SKEW_MS) errors.at = { key: "olcum.atFuture" };
    else if (ms < now - BACKDATE_MS) errors.at = { key: "olcum.atTooOld" };
    else recordedAt = new Date(ms).toISOString();
  }
  return { entries, recordedAt, errors };
}

export const hasErrors = (checked) => Object.keys(checked.errors).length > 0;

/** What a draft would send, as one string: a preview is of THIS key, and a changed box makes it old. */
export const draftKey = (checked) => JSON.stringify([checked.entries, checked.recordedAt]);

/** The value one step up (`direction` 1) or down (-1), inside the bounds, as the box shows it; null from an empty
 *  or unreadable box — a stepper never invents a first value. */
export function stepValue(spec, raw, direction) {
  const n = number(String(raw ?? "").trim());
  if (n === "" || Number.isNaN(n)) return null;
  const next = Math.min(spec.max, Math.max(spec.min, n + direction * spec.step));
  return spec.whole ? String(Math.round(next)) : (Math.round(next * 10) / 10).toFixed(1);
}

/** A sent value as the clinician reads it: the option's words for a choice, the number and its unit otherwise. */
export function valueText(t, code, value) {
  const spec = specOf(code);
  if (!spec) return String(value);
  if (spec.kind === "choice") {
    const option = spec.options.find((o) => Number(o.value) === value);
    return option ? t(option.labelKey) : String(value);
  }
  return `${value} ${t(spec.unitKey)}`;
}

/** NEWS2's seven parameters in the score's order (rules/news2.py), with the label the preview names each
 *  by. `missingKey` is NEWS2's own word for a missing one (news2.missing.*), written out, never built: only
 *  the five measured vitals can be missing; oxygen and consciousness are scored as air and Alert when
 *  nothing current is charted, which the engine calls `assumed`, not missing. */
export const NEWS2_PARAMETERS = Object.freeze([
  Object.freeze({ name: "respiration_rate", labelKey: "board.chRr", missingKey: "news2.missing.respiration_rate" }),
  Object.freeze({ name: "spo2", labelKey: "board.chSpo2", missingKey: "news2.missing.spo2" }),
  Object.freeze({ name: "air_or_oxygen", labelKey: "olcum.o2", missingKey: null }),
  Object.freeze({ name: "systolic_bp", labelKey: "board.chSbp", missingKey: "news2.missing.systolic_bp" }),
  Object.freeze({ name: "pulse", labelKey: "board.chHr", missingKey: "news2.missing.pulse" }),
  Object.freeze({ name: "consciousness", labelKey: "olcum.acvpu", missingKey: null }),
  Object.freeze({ name: "temperature", labelKey: "board.chTemp", missingKey: "news2.missing.temperature" }),
]);

/** The year of an ISO birth date, or null (X9: the board carries `birth_date`, never a year it made up). */
export function birthYearOf(iso) {
  const match = /^(\d{4})-\d{2}-\d{2}/.exec(String(iso ?? ""));
  return match ? match[1] : null;
}

/** The latest NEWS2 input's measurement instant (ms) on a card, whatever its source, or null. The board does not
 *  carry provenance, so the page's list says "son ölçüm" — of any source (X13). */
export function lastMeasuredMs(patient) {
  const at = patient?.news2?.measured_at;
  if (!at || typeof at !== "object") return null;
  const stamps = Object.values(at).map((v) => (typeof v === "string" ? Date.parse(v) : Number.NaN)).filter(Number.isFinite);
  return stamps.length ? Math.max(...stamps) : null;
}
```

- [ ] **Step 4: Green**

```bash
cd /c/tmp/g3-vitals/dashboard && ./node_modules/.bin/vitest run src/live/screens/bedside/vitalsFields.test.js 2>&1 | tail -5
```

Expected: 13 tests pass. The time test builds its expected instant from the minute `toLocalInput` keeps, because a `datetime-local` value carries no seconds.

- [ ] **Step 5: Line ends and commit**

```bash
cd /c/tmp/g3-vitals && for f in dashboard/src/live/screens/bedside/vitalsFields.js dashboard/src/live/screens/bedside/vitalsFields.test.js; do /c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" "$f"; printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- dashboard/src/live/screens/bedside/vitalsFields.js dashboard/src/live/screens/bedside/vitalsFields.test.js
git status --short && git diff --cached --stat
git commit -m "feat(bedside): vitalsFields — the eight inputs, the door's slip bounds, the number and time rules (G3-01, D2, D4, D6, D7, X9, X12)" -m "<the red you saw, and the body>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


---

### Task 11: The door's new refusals in the reader's words (D6, D7, D11, X17)

**Files:**
- Modify: `dashboard/src/live/apiErrors.js`, `dashboard/src/live/apiErrors.test.js`
- Modify: `dashboard/src/live/i18n/strings/errors.js`

The door raises the bedside set's refusals through `str(exc)`, and the withdrawal route raises its own by name. Both are fixed Turkish sentences in `api/clinical.py` (Tasks 1 and 5). Unmapped, an Azerbaijani nurse would read them in Turkish. `apiErrors.test.js` already reads one constant of that file by name (`GCS_NOT_WHOLE`); this task names eight more. The whole-number refusal is a template (`"{code}: tam sayı olmalı"`) and stays as the engine wrote it: the form holds a «26,5» back before it is sent.

- [ ] **Step 1: Write the failing tests**

In `dashboard/src/live/apiErrors.test.js` replace:

```js
// G2-A4: the charting door's one message the SOFA routes also send by name (`detail=GCS_NOT_WHOLE`).
// Only that constant: clinical.py's other strings are units and codes, not messages.
const CLINICAL_MESSAGES = new Map([...pyConstants(py("api/clinical.py"))].filter(([name]) => name === "GCS_NOT_WHOLE"));
```

with:

```js
// G2-A4: the charting door's one message the SOFA routes also send by name (`detail=GCS_NOT_WHOLE`). G3-01:
// the bedside set's fixed refusals, which the door raises through `str(exc)`, and «hatalı giriş»'s, which the
// withdrawal route raises by name. Named one by one: clinical.py's other strings are units, codes and one
// template (NOT_WHOLE, "{code}: tam sayı olmalı", shown as the engine wrote it), not messages.
const CLINICAL_MESSAGE_NAMES = new Set(["GCS_NOT_WHOLE", "MAP_NOT_BELOW_SBP", "AT_TOO_OLD", "AT_FUTURE",
  "RETRACT_REASON_SHORT", "RETRACT_NEEDS_PERSON", "RETRACT_UNKNOWN", "RETRACT_ALREADY", "RETRACT_DISCHARGED"]);
const CLINICAL_MESSAGES = new Map([...pyConstants(py("api/clinical.py"))].filter(([name]) => CLINICAL_MESSAGE_NAMES.has(name)));
```

and after the test that starts `it("says the charting door's refusal of a GCS that is not a whole number"` add:

```js

  // G3-01 (D6, D7, D11): the bedside door's and «hatalı giriş»'s refusals, read from api/clinical.py by name
  // (the sweep above holds every one mapped); a template is shown as the engine wrote it.
  it("says the bedside door's and the withdrawal's refusals in the reader's words", () => {
    expect(CLINICAL_MESSAGES.size).toBe(CLINICAL_MESSAGE_NAMES.size);
    expect(apiErrorText(az, new Error("MAP sistolik basınçtan küçük olmalı"))).toBe("MAP sistolik təzyiqdən kiçik olmalıdır.");
    expect(apiErrorText(en, Object.assign(new Error("bu değer zaten hatalı giriş olarak işaretlenmiş"), { status: 409 })))
      .toBe("This value is already marked as entered in error.");
    expect(apiErrorText(az, new Error("resp_rate: tam sayı olmalı"))).toBe("resp_rate: tam sayı olmalı");
  });
```

- [ ] **Step 2: Red**

```bash
cd /c/tmp/g3-vitals/dashboard && ./node_modules/.bin/vitest run src/live/apiErrors.test.js 2>&1 | tail -15
```

Expected: eight `api/clinical.py MAP_NOT_BELOW_SBP: …`-style cases of the `it.each` fail with `expected null not to be null`, and the new test fails on its second line. If `CLINICAL_MESSAGES.size` is below 9, a constant is missing from `api/clinical.py`. Then Tasks 1 or 5 are not in this tree: stop and report.

- [ ] **Step 3: The map and the texts**

In `dashboard/src/live/apiErrors.js`, after the line `  ["GCS tam sayı olmalı", "gcsNotWhole"],` add:

```js
  // POST /clinical/{id} and its preview (G3-01, D6, D7): the bedside set's fixed refusals. The form holds each
  // back before it is sent (bedside/vitalsFields.js); another client's is said in the reader's words. The
  // whole-number refusal names its code ("resp_rate: tam sayı olmalı") and stays as the engine wrote it.
  ["MAP sistolik basınçtan küçük olmalı", "vitalsMapAboveSbp"],
  ["ölçüm saati en çok 24 saat geriye alınabilir", "vitalsAtTooOld"],
  ["ölçüm saati ileri olamaz", "vitalsAtFuture"],
  // POST /clinical/{id}/entries/{entry}/retract (G3-01, D11, X11): «hatalı giriş»'s refusals.
  ["gerekçe en az 10 karakter olmalı", "retractReasonShort"],
  ["geri alma bir kişinin işidir — cihaz kimliğiyle yapılamaz", "retractNeedsPerson"],
  ["bu hastada böyle bir elle girilmiş değer yok", "retractUnknown"],
  ["bu değer zaten hatalı giriş olarak işaretlenmiş", "retractAlready"],
  ["taburcu edilmiş bir hastada değer geri alınamaz", "retractDischarged"],
```

In `dashboard/src/live/i18n/strings/errors.js`, after each language's `gcsNotWhole` line, add that language's block.

After `    gcsNotWhole: "GCS tam sayı olmalı.",` (tr):

```js
    // G3-01: the bedside door's fixed refusals and «hatalı giriş»'s (api/clinical.py).
    vitalsMapAboveSbp: "MAP sistolik basınçtan küçük olmalı.",
    vitalsAtTooOld: "Ölçüm saati en çok 24 saat geriye alınabilir.",
    vitalsAtFuture: "Ölçüm saati ileri olamaz.",
    retractReasonShort: "Gerekçe en az 10 karakter olmalı.",
    retractNeedsPerson: "Hatalı giriş işaretini bir kişi koyar; cihaz kimliğiyle yapılamaz.",
    retractUnknown: "Bu hastada böyle bir elle girilmiş değer yok.",
    retractAlready: "Bu değer zaten hatalı giriş olarak işaretlenmiş.",
    retractDischarged: "Taburcu edilmiş bir hastada değer geri alınamaz.",
```

After `    gcsNotWhole: "GCS tam ədəd olmalıdır.",` (az):

```js
    vitalsMapAboveSbp: "MAP sistolik təzyiqdən kiçik olmalıdır.",
    vitalsAtTooOld: "Ölçmə vaxtı ən çox 24 saat geriyə çəkilə bilər.",
    vitalsAtFuture: "Ölçmə vaxtı irəlidə ola bilməz.",
    retractReasonShort: "Səbəb ən azı 10 simvol olmalıdır.",
    retractNeedsPerson: "Səhv qeyd işarəsini bir şəxs qoyur; cihaz kimliyi ilə edilə bilməz.",
    retractUnknown: "Bu xəstədə belə bir əl ilə daxil edilmiş dəyər yoxdur.",
    retractAlready: "Bu dəyər artıq səhv qeyd kimi işarələnib.",
    retractDischarged: "Evə yazılmış xəstədə dəyər geri götürülə bilməz.",
```

After `    gcsNotWhole: "GCS должна быть целым числом.",` (ru):

```js
    vitalsMapAboveSbp: "СрАД должно быть меньше систолического давления.",
    vitalsAtTooOld: "Время измерения — не более 24 часов назад.",
    vitalsAtFuture: "Время измерения не может быть в будущем.",
    retractReasonShort: "Причина должна содержать не менее 10 символов.",
    retractNeedsPerson: "Ошибочную запись отмечает человек; с идентификатором устройства это невозможно.",
    retractUnknown: "У этого пациента нет такого значения, введённого вручную.",
    retractAlready: "Это значение уже отмечено как ошибочная запись.",
    retractDischarged: "У выписанного пациента значение нельзя отозвать.",
```

After `    gcsNotWhole: "The GCS must be a whole number.",` (en):

```js
    vitalsMapAboveSbp: "MAP must be below the systolic pressure.",
    vitalsAtTooOld: "The measurement time can be at most 24 hours back.",
    vitalsAtFuture: "The measurement time cannot be in the future.",
    retractReasonShort: "The reason must be at least 10 characters.",
    retractNeedsPerson: "A person marks an entry in error; a device credential cannot.",
    retractUnknown: "This patient has no such hand-entered value.",
    retractAlready: "This value is already marked as entered in error.",
    retractDischarged: "A value cannot be withdrawn for a discharged patient.",
```

- [ ] **Step 4: Green, and the strings**

```bash
cd /c/tmp/g3-vitals/dashboard && ./node_modules/.bin/vitest run src/live/apiErrors.test.js src/live/i18n 2>&1 | tail -5
```

Expected: both pass; `apiErrors.test.js` has nine tests more (eight sweep cases and the new one).

- [ ] **Step 5: Line ends and commit**

```bash
cd /c/tmp/g3-vitals && for f in dashboard/src/live/apiErrors.js dashboard/src/live/apiErrors.test.js dashboard/src/live/i18n/strings/errors.js; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- dashboard/src/live/apiErrors.js dashboard/src/live/apiErrors.test.js dashboard/src/live/i18n/strings/errors.js
git status --short && git diff --cached --stat
git commit -m "feat(errors): the bedside door's and «hatalı giriş»'s refusals in the reader's words (G3-01, D6, D7, D11, X17)" -m "<the red you saw, and the body>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The form and its preview — `VitalsForm.jsx`, `PreviewPanel.jsx` (D3, D4, D6–D8, X10, X12)

**Files:**
- Create: `dashboard/src/live/screens/bedside/PreviewPanel.jsx`
- Create: `dashboard/src/live/screens/bedside/VitalsForm.jsx`, `dashboard/src/live/screens/bedside/VitalsForm.test.jsx`

One form serves both doors (D3): the page (Task 14) and the patient screen's dialog (Task 15). It is not a dialog itself. Its host passes the writes, already bound to the patient (`onPreview`, `onSave`). It reports `onSaved(saved)` with each value and its `chart` row, and `onCancel()` when it is left. `onBusy(busy)` lets a host dialog hold its ✕ while a request is in flight.

- [ ] **Step 1: Write the failing test**

Create `dashboard/src/live/screens/bedside/VitalsForm.test.jsx`:

```jsx
// VitalsForm.test.jsx — the bedside form sends what was entered and only that, previews before it saves, holds a
// slipped digit back under its box, and says what happened on the toast, named after the bed (G3-01).
// Synthetic values only.
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { news2 } from "../../data/board.testutil.js";
import { SAVE_ARM_MS, VitalsForm, savedOf } from "./VitalsForm.jsx";
import { toLocalInput } from "./vitalsFields.js";

const NOW = Date.parse("2026-11-02T10:00:00Z");
const BED = "REA-01 · 2";
const CHARTABLE = ["board.view", "clinical.chart"];
// The fake-timer recipe of the SOFA and Meds forms: installed BEFORE the mount, `Date` faked with them, nothing
// advancing on its own — so «Yadda saxla»'s arming window is crossed only when a test says so.
const realSetTimeout = globalThis.setTimeout;
const FAKE_TIMERS = { toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] };
const settle = () => new Promise((resolve) => realSetTimeout(resolve, 0));
const PREVIEW = {
  patient_id: "S-001", preview: true, at: new Date(NOW).toISOString(),
  news2: news2({ total: 5, partial: true, missing: ["systolic_bp", "pulse", "temperature"],
    breakdown: { respiration_rate: 3, spo2: 2, air_or_oxygen: 0 } }),
};
const SAVED = { patient_id: "S-001", charted: 2, alerts: [],
  entries: [{ code: "resp_rate", entry: 41 }, { code: "spo2", entry: 42 }] };

async function open({ preview = () => Promise.resolve(PREVIEW), save = () => Promise.resolve(SAVED) } = {}) {
  vi.useFakeTimers(FAKE_TIMERS);
  vi.setSystemTime(NOW);
  const onPreview = vi.fn(preview);
  const onSave = vi.fn(save);
  const onSaved = vi.fn();
  const onCancel = vi.fn();
  await act(async () => {
    await mount(
      <VitalsForm bed={BED} nowMs={NOW} onPreview={onPreview} onSave={onSave} onSaved={onSaved} onCancel={onCancel} />,
      { access: token({ perms: CHARTABLE }), me: profile({ perms: CHARTABLE }) });
    await settle();
  });
  return { onPreview, onSave, onSaved, onCancel };
}
// A box by its label: the label carries the unit after the name ("Nəbz (/dəq)"); its − and + are buttons.
const box = (name) => screen.getByRole("textbox", { name: new RegExp(`^${name}`) });
const type = (name, value) => fireEvent.change(box(name), { target: { value } });
const press = (el) => act(async () => { fireEvent.click(el); await settle(); });
const button = (name) => screen.getByRole("button", { name });
const preview = () => press(button("Öncədən baxın"));
const armed = () => act(() => { vi.advanceTimersByTime(SAVE_ARM_MS); });
const toasted = (text) => within(screen.getByRole("region", { name: "Bildirişlər" })).queryAllByText(text);
const panel = () => document.querySelector("[data-preview]");

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the bedside form", () => {
  it("sends nothing from an empty form, and says why", async () => {
    const { onPreview } = await open();
    await preview();
    expect(onPreview).not.toHaveBeenCalled();
    expect(screen.getByText("Ən azı bir dəyər daxil edin.")).toBeInTheDocument();
  });

  it("holds a slipped digit under its box, with the bounds, and takes the focus there", async () => {
    const { onPreview } = await open();
    type("Tənəffüs", "22");
    type("Nəbz", "800");
    await preview();
    expect(onPreview).not.toHaveBeenCalled();
    expect(screen.getByText("0–300 aralığında olmalıdır.")).toBeInTheDocument();
    expect(document.activeElement).toBe(box("Nəbz"));
  });

  it("steps a value inside its bounds, and never invents a first one", async () => {
    await open();
    type("Tənəffüs", "26");
    await press(button("Tənəffüs: artır"));
    expect(box("Tənəffüs")).toHaveValue("27");
    type("SpO2", "100");
    await press(button("SpO2: artır"));
    expect(box("SpO2")).toHaveValue("100");
    await press(button("Nəbz: azalt"));
    expect(box("Nəbz")).toHaveValue("");
  });

  it("previews exactly what was entered, with no time, and draws the engine's answer", async () => {
    const { onPreview } = await open();
    type("Tənəffüs", "26");
    type("SpO2", "91");
    await press(button("Əlavə oksigen alır"));
    await preview();
    expect(onPreview).toHaveBeenCalledWith(
      [{ code: "resp_rate", value: 26 }, { code: "spo2", value: 91 }, { code: "supplemental_oxygen", value: 1 }], null);
    expect(panel()).toHaveTextContent("NEWS2 (öncədən baxış):");
    expect(panel()).toHaveTextContent("Qismən bal: sistolik AT, nəbz, temperatur daxil edilməyib və ya cari deyil.");
    expect(within(panel()).getByText("Tənəffüs: +3 bal")).toBeInTheDocument();
    expect(within(panel()).getByText("SpO2: +2 bal")).toBeInTheDocument();
    expect(within(panel()).queryByText(/Əlavə oksigen: \+/)).toBeNull();      // 0 points is not listed
    expect(screen.queryByRole("button", { name: "Öncədən baxın" })).toBeNull();
    expect(button("Yadda saxla")).toBeInTheDocument();
  });

  it("holds «Yadda saxla» for SAVE_ARM_MS, then saves what was previewed and hands over its rows", async () => {
    const { onSave, onSaved } = await open();
    type("Tənəffüs", "26");
    type("SpO2", "91");
    await preview();
    await press(button("Yadda saxla"));           // a double click's second press on «Öncədən baxın»
    expect(onSave).not.toHaveBeenCalled();
    armed();
    await press(button("Yadda saxla"));
    expect(onSave).toHaveBeenCalledWith([{ code: "resp_rate", value: 26 }, { code: "spo2", value: 91 }], null);
    // An untouched time is the press's instant: the faked clock moved on with the arming window.
    expect(onSaved).toHaveBeenCalledWith({ atMs: NOW + SAVE_ARM_MS, rows: [
      { code: "resp_rate", value: 26, entry: 41 }, { code: "spo2", value: 91, entry: 42 }] });
    expect(toasted("REA-01 · 2: ölçmə yadda saxlanıldı.").length).toBeGreaterThan(0);
  });

  it("a change after the preview makes it old: «Yadda saxla» goes until it is previewed again", async () => {
    const { onPreview } = await open();
    type("SpO2", "91");
    await preview();
    type("SpO2", "92");
    expect(screen.queryByRole("button", { name: "Yadda saxla" })).toBeNull();
    expect(screen.getByText("Dəyərlər dəyişdi — yenidən öncədən baxın.")).toBeInTheDocument();
    expect(panel()).toBeNull();
    await preview();
    expect(onPreview).toHaveBeenCalledTimes(2);
  });

  it("sends a typed time as a UTC instant, and holds one ahead of the clock", async () => {
    const { onPreview } = await open();
    type("SpO2", "95");
    fireEvent.change(screen.getByLabelText("Ölçmə vaxtı"), { target: { value: toLocalInput(NOW + 10 * 60_000) } });
    await preview();
    expect(onPreview).not.toHaveBeenCalled();
    expect(screen.getByText("Ölçmə vaxtı irəlidə ola bilməz.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Ölçmə vaxtı"), { target: { value: toLocalInput(NOW - 60 * 60_000) } });
    await preview();
    expect(onPreview).toHaveBeenCalledWith([{ code: "spo2", value: 95 }], new Date(NOW - 60 * 60_000).toISOString());
  });

  it("a discharged patient previews as dropped, and nothing is offered to save", async () => {
    await open({ preview: () => Promise.resolve({ patient_id: "S-001", preview: true, dropped: "discharged" }) });
    type("SpO2", "95");
    await preview();
    expect(screen.getByText("Bu xəstə evə yazılıb; ölçmə daxil edilmir.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Yadda saxla" })).toBeNull();
  });

  it("the engine's refusal of a save is on the toast, named after the bed, and the form stays", async () => {
    const { onSaved, onCancel } = await open({ save: () => Promise.reject(refusal(400, "entries[0]: bilinmeyen kod")) });
    type("SpO2", "95");
    await preview();
    armed();
    await press(button("Yadda saxla"));
    expect(toasted("REA-01 · 2: ölçmə yadda saxlanılmadı — entries[0]: bilinmeyen kod").length).toBeGreaterThan(0);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(box("SpO2")).toHaveValue("95");
  });

  it("a save that got no answer may have landed: she is told to check, and the form is left", async () => {
    const { onSaved, onCancel } = await open({ save: () => Promise.reject(refusal(503, "down")) });
    type("SpO2", "95");
    await preview();
    armed();
    await press(button("Yadda saxla"));
    expect(toasted(/^REA-01 · 2: cavab gəlmədi/).length).toBeGreaterThan(0);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it("pairs each saved value with the row the door answered, and with none when an older engine answers none", () => {
    const asked = { entries: [{ code: "resp_rate", value: 26 }, { code: "spo2", value: 91 }], recordedAt: "2026-11-02T09:00:00.000Z" };
    expect(savedOf(asked, SAVED, NOW)).toEqual({ atMs: Date.parse("2026-11-02T09:00:00.000Z"),
      rows: [{ code: "resp_rate", value: 26, entry: 41 }, { code: "spo2", value: 91, entry: 42 }] });
    expect(savedOf({ ...asked, recordedAt: null }, { charted: 2 }, NOW))
      .toEqual({ atMs: NOW, rows: [{ code: "resp_rate", value: 26, entry: null }, { code: "spo2", value: 91, entry: null }] });
  });
});
```

- [ ] **Step 2: Red**

```bash
cd /c/tmp/g3-vitals/dashboard && ./node_modules/.bin/vitest run src/live/screens/bedside/VitalsForm.test.jsx 2>&1 | tail -5
```

Expected: `Failed to resolve import "./VitalsForm.jsx"`.

- [ ] **Step 3: The preview panel**

Create `dashboard/src/live/screens/bedside/PreviewPanel.jsx`:

```jsx
// src/live/screens/bedside/PreviewPanel.jsx — what the engine would score for the values in the form (G3-01, D4,
// D8, X10). The preview route answers the card's own NEWS2 shape, and the panel draws it with the card's own
// component (`News2`: the total, «partial», the red parameter, what is past its window, what was assumed). Under
// it, in words, two things that component says only to a screen reader or not at all: what is missing or not
// current (D4: «NEWS2 kısmi: … girilmedi»), and the points each parameter brought. Every number is the engine's
// (Decision 1); the panel adds no threshold, no band and no response — the decision is the physician's.
import React from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { Box, Note } from "../../ui/index.js";
import { News2 } from "../common/BoardState.jsx";
import { NEWS2_PARAMETERS } from "./vitalsFields.js";

/** `answer` is the preview route's (`{preview, news2}`), or `{dropped}` for a discharged number; `nowMs` the
 *  screen's clock (the server's), which ages what is past its window. */
export function PreviewPanel({ answer, nowMs }) {
  const { t } = useI18n();
  if (answer?.dropped) return <Note tone="warn" icon="alert" className="mt-3">{t("olcum.previewDropped")}</Note>;
  const news2 = answer.news2;
  // Missing, or past its window: both leave the total, and the sentence names both.
  const absent = new Set([...(Array.isArray(news2.missing) ? news2.missing : []), ...(Array.isArray(news2.stale) ? news2.stale : [])]);
  const names = NEWS2_PARAMETERS.filter((p) => p.missingKey && absent.has(p.name)).map((p) => t(p.missingKey));
  const breakdown = news2.breakdown && typeof news2.breakdown === "object" ? news2.breakdown : {};
  const scored = NEWS2_PARAMETERS.filter((p) => Number.isInteger(breakdown[p.name]) && breakdown[p.name] > 0);
  return (
    <Box title={t("olcum.previewTitle")} icon="activity" className="mt-3">
      <div data-preview="">
        <News2 news2={news2} nowMs={nowMs} label={t("olcum.previewLabel")} />
        {names.length ? (
          <p className="m-0 mt-2 text-13 font-semibold text-att-ink">{t("olcum.previewPartial", { missing: names.join(", ") })}</p>
        ) : !news2.partial ? (
          <p className="m-0 mt-2 text-13 text-mute">{t("olcum.previewComplete")}</p>
        ) : null}
        {scored.length ? (
          // role="list": a list with its bullets removed (`list-none`) stops being one for VoiceOver.
          <ul role="list" className="m-0 mt-1.5 list-none p-0 text-13">
            {scored.map((p) => <li key={p.name}>{t("olcum.previewPoints", { name: t(p.labelKey), points: breakdown[p.name] })}</li>)}
          </ul>
        ) : (
          <p className="m-0 mt-1.5 text-13 text-mute">{t("olcum.previewNoPoints")}</p>
        )}
        <p className="m-0 mt-2 text-11.5 text-mute">{t("olcum.previewNote")}</p>
      </div>
    </Box>
  );
}
```

- [ ] **Step 4: The form**

Create `dashboard/src/live/screens/bedside/VitalsForm.jsx`:

```jsx
// src/live/screens/bedside/VitalsForm.jsx — the bedside set's form (G3-01, D2–D8): eight boxes in the prototype's
// order, the time, «Önizle» and, on a fresh preview, «Kaydet». One form for both doors (D3): the «Yatak başı
// ölçüm» page (BedsideScreen.jsx) and the patient screen's «Ölçüm gir» dialog (patient/VitalsEntry.jsx). It is
// not a dialog itself; its host binds the writes to the patient.
//
// WHAT IT SENDS. Only what was entered (D4): an empty box is «ölçülmedi», never 0, and is not sent. The time is
// the clock's until she types one, and an untouched time is not sent at all (X12): the server stamps its own
// clock, so a tablet whose clock runs ahead never charts in the future. A typed time goes up to 24 h back and
// never ahead (D7). Everything in ONE request with one time (D5), through `onSave` — the board store's `chart`.
//
// THE PREVIEW FIRST (D8). «Kaydet» is offered only on a preview of exactly what would be sent now: change a box
// and the preview is old until it is asked again. «Kaydet» appears where «Önizle» stood, so for SAVE_ARM_MS after
// a preview it ignores a press, and it always ignores a double click's second one (the SOFA form's rule,
// SIGN_ARM_MS). The preview is the engine's (PreviewPanel.jsx); nothing is scored here (Decision 1). A
// discharged number previews as `dropped`, and nothing is offered to save.
//
// THE SERVER IS AUTHORITATIVE (D6). The browser mirrors the door's slip bounds only to hold a slipped digit back,
// under its box, with the focus taken to the first one. What it lets through is the engine's to refuse, and the
// engine's sentence is what she reads: on the toast, named after the bed. A write with no answer may have landed
// (`mayHaveLanded`): she is told to look before entering it again, and the form is left (`onCancel`), so a second
// press cannot chart it twice. A 403 leaves the form too. A store that dropped its answer (null: the session
// ended) says nothing. `busy` holds the buttons (never `disabled`); `sending` ignores a press that beats the
// re-render.
import React, { useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { apiErrorText, readErrorText } from "../../apiErrors.js";
import { Announce, Button, Field, Icon, Input, Seg, useToast } from "../../ui/index.js";
import { mayHaveLanded } from "../admin/refusal.js";
import { useNow } from "../common/useNow.js";
import { PreviewPanel } from "./PreviewPanel.jsx";
import { BACKDATE_MS, VITALS, checkDraft, draftKey, hasErrors, stepValue, toLocalInput } from "./vitalsFields.js";

/** How long «Kaydet» ignores a press after it appeared where «Önizle» stood (the SOFA form's 600 ms). */
export const SAVE_ARM_MS = 600;
/** How often an untouched time follows the clock: the field shows minutes. */
const CLOCK_MS = 60_000;
/** The order a held press takes the focus in: the counted boxes, then the time. */
const ORDER = [...VITALS.filter((s) => s.kind === "number").map((s) => s.code), "at"];

/** Is this answer to «Önizle» really a preview? It says so and carries a NEWS2 with a total. */
const isPreview = (answer) => answer?.preview === true && typeof answer?.news2?.total === "number";

/** What was saved, for the saved step: each sent value with the `chart` row the door answered for it, in request
 *  order (D10: the id a «hatalı giriş» names). A row the answer does not pair with its code has none to name —
 *  an engine older than G3-01 answers no `entries`. The time is the one sent, or the press's for an untouched one. */
export function savedOf(asked, answer, pressMs) {
  const ids = Array.isArray(answer?.entries) ? answer.entries : [];
  return {
    atMs: asked.recordedAt ? Date.parse(asked.recordedAt) : pressMs,
    rows: asked.entries.map((e, i) => {
      const id = ids[i];
      return { ...e, entry: id?.code === e.code && Number.isInteger(id?.entry) ? id.entry : null };
    }),
  };
}

/** The problem under a box, as Field draws it: critical ink, an icon, the reader's sentence. */
function Problem({ id, text }) {
  return (
    <p id={id} className="m-0 mt-1 flex items-start gap-1.5 text-12 font-semibold text-crit-ink">
      <Icon name="alert" size={14} className="mt-px" />
      <span>{text}</span>
    </p>
  );
}

/** One counted value: its label and unit, a − and a + beside the box (D3: tablet first, the prototype's large
 *  buttons), the problem under it. Labelled here rather than with <Field>, which labels its ONE child: the
 *  steppers share the input's row. A stepper never invents a first value (stepValue). */
function NumberBox({ spec, value, error, busy, onChange, inputRef }) {
  const { t } = useI18n();
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;
  const hintId = spec.hintKey ? `${id}-hint` : undefined;
  const label = t(spec.labelKey);
  const step = (direction) => {
    const next = stepValue(spec, value, direction);
    if (next !== null) onChange(next);
  };
  return (
    <div className="mb-3" data-vital={spec.code}>
      <label htmlFor={id} className="mb-1.5 block font-text text-13.5 font-semibold text-mute">
        {label} <span className="font-normal">({t(spec.unitKey)})</span>
      </label>
      <div className="flex items-center gap-2">
        <Button size="lg" icon="minus" label={t("olcum.minus", { label })} onClick={() => step(-1)} busy={busy} />
        <Input
          ref={inputRef} id={id} inputMode={spec.whole ? "numeric" : "decimal"} autoComplete="off"
          className="text-center font-data text-17" value={value} placeholder={t("olcum.notMeasured")}
          onChange={(event) => onChange(event.target.value)} readOnly={busy}
          aria-invalid={error ? "true" : undefined} aria-describedby={[errorId, hintId].filter(Boolean).join(" ") || undefined}
        />
        <Button size="lg" icon="plus" label={t("olcum.plus", { label })} onClick={() => step(1)} busy={busy} />
      </div>
      {error ? <Problem id={errorId} text={error} /> : null}
      {spec.hintKey ? <p id={hintId} className="m-0 mt-1 text-12 text-mute">{t(spec.hintKey)}</p> : null}
    </div>
  );
}

/** One charted choice (ek oksijen, bilinç) as the house Seg, «ölçülmedi» its first option: pressing the chosen
 *  option does nothing (Seg), so «not measured» has to be an option to go back to. A choice is always one of
 *  its values, so it has no problem to show. */
function ChoiceBox({ spec, value, busy, onChange }) {
  const { t } = useI18n();
  const options = [{ value: "", label: t("olcum.notMeasured") },
    ...spec.options.map((o) => ({ value: o.value, label: t(o.labelKey) }))];
  return (
    <div className="mb-3" data-vital={spec.code}>
      <p className="m-0 mb-1.5 font-text text-13.5 font-semibold text-mute">{t(spec.labelKey)}</p>
      <Seg label={t(spec.labelKey)} value={value} options={options} className="flex-wrap"
        onChange={(next) => { if (!busy) onChange(next); }} />
    </div>
  );
}

/** `bed` names the patient on every toast. `onPreview(entries, recordedAt)` and `onSave(entries, recordedAt)`
 *  are the writes, bound to the patient by the host; each resolves to the API's answer, or null when the store
 *  dropped it. `onSaved(saved)` gets `savedOf`'s rows; `onCancel()` leaves the form (also after a write that may
 *  have landed, and after a 403). `onBusy(busy)` tells a host dialog a request is in flight. `nowMs` is the
 *  screen's clock (the server's), for the preview's ages. */
export function VitalsForm({ bed, nowMs, onPreview, onSave, onSaved, onCancel, onBusy }) {
  const { t } = useI18n();
  const toast = useToast();
  const [values, setValues] = useState({});            // code -> what is in the box, as typed
  const [at, setAt] = useState("");                    // the typed time, once she has typed one
  const [atTouched, setAtTouched] = useState(false);
  const [tried, setTried] = useState(false);           // a press was held: problems are shown from now on
  const [busy, setBusy] = useState(null);              // "preview" | "save": the request in flight
  const [preview, setPreview] = useState(null);        // { key, answer }: the preview's answer, keyed by what it was asked
  const [said, setSaid] = useState("");                // spoken once: a preview landed, and «Kaydet» appeared
  const [arming, setArming] = useState(false);         // «Kaydet» just appeared: held for SAVE_ARM_MS
  const armed = useRef(true);                          // false inside the arming window, read by the press itself
  const armTimer = useRef(null);
  const sending = useRef(false);
  const mounted = useRef(false);
  const inputs = useRef({});
  const noteId = useId();
  // True inside the effect (the house pattern), so StrictMode's rehearsal does not leave it false.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(armTimer.current);
    };
  }, []);
  useEffect(() => { onBusy?.(busy !== null); }, [busy, onBusy]);
  // Re-rendered on the clock while the form is open, so an untouched time shows the minute it is.
  useNow(CLOCK_MS);
  const now = Date.now();
  const draftAt = (ms) => ({ values, at: atTouched ? at : toLocalInput(ms), atTouched });
  const checked = checkDraft(draftAt(now), now);
  const fresh = preview !== null && preview.key === draftKey(checked);
  const dropped = fresh && preview.answer.dropped === true;
  const offerSave = fresh && !dropped;
  const errorOf = (code) => (tried && checked.errors[code] ? t(checked.errors[code].key, checked.errors[code].params) : undefined);
  const formError = tried && checked.errors.form ? t(checked.errors.form.key) : "";
  let say = formError;
  if (!say && preview !== null && !fresh) say = t("olcum.previewOld");
  else if (!say && !fresh) say = t("olcum.previewFirst");
  const keep = (code) => (el) => { inputs.current[code] = el; };
  const set = (code) => (value) => setValues((current) => ({ ...current, [code]: value }));

  /** Hold «Kaydet» for SAVE_ARM_MS: it has just appeared where «Önizle» stood. */
  function arm() {
    clearTimeout(armTimer.current);
    armed.current = false;
    setArming(true);
    armTimer.current = setTimeout(() => {
      armed.current = true;
      if (mounted.current) setArming(false);
    }, SAVE_ARM_MS);
  }

  /** The draft as of the press: an untouched time is the press's own. A held one shows its problems under their
   *  boxes and takes the focus to the first (flushSync: the problem must be in the DOM, tied to its box, when
   *  the focus arrives). Returns the checked draft, or null. */
  function pressed() {
    const ms = Date.now();
    const result = checkDraft(draftAt(ms), ms);
    if (hasErrors(result)) {
      flushSync(() => setTried(true));
      const first = ORDER.find((code) => result.errors[code]);
      if (first) inputs.current[first]?.focus();
      return null;
    }
    setTried(true);
    return result;
  }

  /** «Önizle» (D8): the preview route, which writes nothing. Its failure is a read's (`readErrorText`): nothing
   *  was written, so nothing "may have landed". Any outcome that is not a preview lets the earlier one go. */
  async function previewIt() {
    if (sending.current || busy) return;
    const asked = pressed();
    if (!asked) return;
    sending.current = true;
    setBusy("preview");
    let done = null;   // { say: [text, tone], leave } once the request is settled
    try {
      const answer = await onPreview(asked.entries, asked.recordedAt);
      if (answer === null || !mounted.current) return;   // the store dropped it: the session ended
      if (answer?.dropped) {
        setPreview({ key: draftKey(asked), answer: { dropped: true } });
      } else if (isPreview(answer)) {
        setPreview({ key: draftKey(asked), answer });
        setSaid(t("olcum.previewed", { total: answer.news2.total }));
        arm();
      } else {
        setPreview(null);
        done = { say: [t("olcum.previewRefused", { subject: bed, reason: t("olcum.previewNotPreview") }), "error"], leave: false };
      }
    } catch (err) {
      if (err?.superseded) return;   // a superseded session: nothing is said into the one that replaced it
      if (mounted.current) setPreview(null);
      const forbidden = err?.status === 403;
      const reason = forbidden ? t("olcum.noRight") : readErrorText(t, err);
      done = { say: [t("olcum.previewRefused", { subject: bed, reason }), "error"], leave: forbidden };
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(null);
    }
    if (!done) return;
    toast(...done.say);
    if (done.leave) onCancel();
  }

  /** «Kaydet»: the same values the fresh preview was asked with, in one request (D5). Not inside the arming
   *  window, and never a double click's second press. */
  async function saveIt(event) {
    if ((event?.detail ?? 0) > 1 || !armed.current) return;
    if (sending.current || busy || !offerSave) return;
    const asked = pressed();
    if (!asked || draftKey(asked) !== preview.key) return;
    sending.current = true;
    setBusy("save");
    const pressMs = Date.now();
    let done;          // { say: [text, tone], saved?, leave? } once the write is settled
    try {
      const answer = await onSave(asked.entries, asked.recordedAt);
      if (answer === null) return;   // the store dropped it: the session ended
      done = answer?.dropped
        ? { say: [t("olcum.savedDropped", { subject: bed }), "warn"], leave: true }
        : { say: [t("olcum.savedToast", { subject: bed })], saved: savedOf(asked, answer, pressMs) };
    } catch (err) {
      if (err?.superseded) return;
      if (mayHaveLanded(err)) {
        done = { say: [t("olcum.savedMayHaveLanded", { subject: bed }), "warn"], leave: true };
      } else {
        const forbidden = err?.status === 403;
        const reason = forbidden ? t("olcum.noRight") : apiErrorText(t, err);
        done = { say: [t("olcum.savedRefused", { subject: bed, reason }), "error"], leave: forbidden };
      }
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(null);
    }
    // Out of the `try`: a host callback that throws must never turn a write the engine took into "not saved".
    toast(...done.say);
    if (done.saved) onSaved(done.saved);
    else if (done.leave) onCancel();
  }

  return (
    <form noValidate onSubmit={(event) => { event.preventDefault(); if (offerSave) saveIt(); else previewIt(); }}>
      <div className="grid gap-x-4 min-[640px]:grid-cols-2">
        {VITALS.map((spec) => (spec.kind === "number" ? (
          <NumberBox key={spec.code} spec={spec} value={values[spec.code] ?? ""} error={errorOf(spec.code)}
            busy={busy !== null} onChange={set(spec.code)} inputRef={keep(spec.code)} />
        ) : (
          <ChoiceBox key={spec.code} spec={spec} value={values[spec.code] ?? ""} busy={busy !== null} onChange={set(spec.code)} />
        )))}
      </div>
      <Field label={t("olcum.at")} hint={t("olcum.atHint")} layout="col" error={errorOf("at")}>
        <Input
          ref={keep("at")} type="datetime-local" min={toLocalInput(now - BACKDATE_MS)} max={toLocalInput(now)}
          value={atTouched ? at : toLocalInput(now)} readOnly={busy !== null}
          onChange={(event) => { setAtTouched(true); setAt(event.target.value); }}
        />
      </Field>
      {fresh ? <PreviewPanel answer={preview.answer} nowMs={nowMs} /> : null}
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {say ? (
          <p id={noteId} className={`m-0 mr-auto min-w-0 flex-[1_1_14rem] text-12 font-semibold ${formError ? "text-att-ink" : "text-mute"}`}>{say}</p>
        ) : null}
        {/* The two buttons are one flex item: on a phone the pair wraps as a pair, under the sentence. */}
        <div className="ml-auto flex shrink-0 gap-2">
          <Button size="lg" variant="ghost" onClick={onCancel} busy={busy !== null}>{t("olcum.back")}</Button>
          {offerSave ? (
            <Button size="lg" variant="primary" onClick={saveIt} busy={busy !== null} aria-disabled={arming ? "true" : undefined}>
              {t("common.save")}
            </Button>
          ) : (
            <Button size="lg" type="submit" variant="primary" busy={busy !== null}
              aria-disabled={dropped ? "true" : undefined} aria-describedby={say ? noteId : undefined}>
              {t("olcum.preview")}
            </Button>
          )}
        </div>
      </div>
      <Announce text={busy === "preview" ? t("olcum.previewing") : busy === "save" ? t("olcum.saving") : said} />
    </form>
  );
}
```

- [ ] **Step 5: Green**

```bash
cd /c/tmp/g3-vitals/dashboard && ./node_modules/.bin/vitest run src/live/screens/bedside 2>&1 | tail -5
```

Expected: `VitalsForm.test.jsx` 11 passed, `vitalsFields.test.js` 13 passed.

If «sends a typed time» fails on the second call's instant, the box kept seconds: `toLocalInput` writes minutes only, and `NOW - 60 min` is a whole minute, so the two must agree. Read the failure before changing the test.

- [ ] **Step 6: Line ends and commit**

```bash
cd /c/tmp/g3-vitals && for f in dashboard/src/live/screens/bedside/PreviewPanel.jsx dashboard/src/live/screens/bedside/VitalsForm.jsx dashboard/src/live/screens/bedside/VitalsForm.test.jsx; do /c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" "$f"; printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- dashboard/src/live/screens/bedside/PreviewPanel.jsx dashboard/src/live/screens/bedside/VitalsForm.jsx dashboard/src/live/screens/bedside/VitalsForm.test.jsx
git status --short && git diff --cached --stat
git commit -m "feat(bedside): the bedside form and its NEWS2 preview — only what was entered, preview before save (G3-01, D3, D4, D6–D8, X10, X12)" -m "<the red you saw, and the body>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: «Hatalı giriş» — `RetractDialog.jsx` and the saved step (D10, D11, D13, X15)

**Files:**
- Create: `dashboard/src/live/screens/common/RetractDialog.jsx`, `dashboard/src/live/screens/common/RetractDialog.test.jsx`
- Create: `dashboard/src/live/screens/bedside/SavedStep.jsx`, `dashboard/src/live/screens/bedside/SavedStep.test.jsx`

Two screens open the dialog: the bedside saved step (here) and the trend dialog's table (Task 16). It therefore lives in `screens/common/` with the other shared pieces (X15). It tells its host how the withdrawal ended through `onDone(outcome)`:
- `"retracted"`: the engine took it;
- `"already"`: another desk withdrew it first;
- `"uncertain"`: no answer, so it may have landed.

The host reads again or marks the row on that word.

- [ ] **Step 1: Write the failing tests**

Create `dashboard/src/live/screens/common/RetractDialog.test.jsx`:

```jsx
// RetractDialog.test.jsx — «hatalı giriş»: it says which value and what a withdrawal does, waits for a reason of
// ten characters and for its arming window, sends the trimmed reason, and says the engine's answer on the toast,
// named after the bed (G3-01, D10, D11). Synthetic values only.
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { RETRACT_ARM_MS, RetractDialog } from "./RetractDialog.jsx";

const NOW = Date.parse("2026-11-02T10:00:00Z");
const BED = "REA-01 · 2";
const CHARTABLE = ["board.view", "clinical.chart"];
const realSetTimeout = globalThis.setTimeout;
const FAKE_TIMERS = { toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] };
const settle = () => new Promise((resolve) => realSetTimeout(resolve, 0));
const WHAT = { label: "Tənəffüs", value: "26 /dəq", time: "10:00" };
const REASON = "  yazım hatası, 16 idi  ";

async function open(answer = () => Promise.resolve({ retracted: 41, code: "resp_rate", alerts: [] })) {
  vi.useFakeTimers(FAKE_TIMERS);
  vi.setSystemTime(NOW);
  const onRetract = vi.fn(answer);
  const onDone = vi.fn();
  const onClose = vi.fn();
  await act(async () => {
    await mount(<RetractDialog bed={BED} what={WHAT} onRetract={onRetract} onDone={onDone} onClose={onClose} />,
      { access: token({ perms: CHARTABLE }), me: profile({ perms: CHARTABLE }) });
    await settle();
  });
  return { onRetract, onDone, onClose };
}
const dialog = () => screen.getByRole("dialog", { name: `Səhv qeyd · ${BED}` });
const reason = (text) => fireEvent.change(within(dialog()).getByRole("textbox"), { target: { value: text } });
const confirm = () => act(async () => {
  fireEvent.click(within(dialog()).getByRole("button", { name: "Səhv qeyd kimi işarələ" }));
  await settle();
});
const armed = () => act(() => { vi.advanceTimersByTime(RETRACT_ARM_MS); });
const toasted = (text) => within(screen.getByRole("region", { name: "Bildirişlər" })).queryAllByText(text);

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("«hatalı giriş»", () => {
  it("says which value and what a withdrawal does, and waits for a reason of ten characters", async () => {
    const { onRetract } = await open();
    expect(dialog()).toHaveTextContent("Tənəffüs: 26 /dəq · ölçmə 10:00");
    expect(dialog()).toHaveTextContent("audit jurnalına yazılır");
    expect(dialog()).toHaveTextContent("0 / 10 simvol");
    armed();
    reason("  səhv  ");
    expect(dialog()).toHaveTextContent("4 / 10 simvol");
    await confirm();
    expect(onRetract).not.toHaveBeenCalled();
  });

  it("ignores a press in its first RETRACT_ARM_MS, then withdraws with the trimmed reason", async () => {
    const { onRetract, onDone, onClose } = await open();
    reason(REASON);
    await confirm();                                   // the opening double click's second press
    expect(onRetract).not.toHaveBeenCalled();
    armed();
    await confirm();
    expect(onRetract).toHaveBeenCalledWith("yazım hatası, 16 idi");
    expect(toasted("REA-01 · 2: Tənəffüs səhv qeyd kimi işarələndi.").length).toBeGreaterThan(0);
    expect(onDone).toHaveBeenCalledWith("retracted");
    expect(onClose).toHaveBeenCalled();
  });

  it("an entry another desk withdrew first is said in the reader's words, and the host reads again", async () => {
    const { onDone, onClose } = await open(() => Promise.reject(refusal(409, "bu değer zaten hatalı giriş olarak işaretlenmiş")));
    armed();
    reason(REASON);
    await confirm();
    expect(toasted("REA-01 · 2: işarələnmədi — Bu dəyər artıq səhv qeyd kimi işarələnib.").length).toBeGreaterThan(0);
    expect(onDone).toHaveBeenCalledWith("already");
    expect(onClose).toHaveBeenCalled();
  });

  it("a reason the engine finds short keeps the dialog open, and nothing is read again", async () => {
    const { onDone, onClose } = await open(() => Promise.reject(refusal(400, "gerekçe en az 10 karakter olmalı")));
    armed();
    reason(REASON);
    await confirm();
    expect(toasted("REA-01 · 2: işarələnmədi — Səbəb ən azı 10 simvol olmalıdır.").length).toBeGreaterThan(0);
    expect(onDone).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a withdrawal that got no answer may have landed: she is told to look, and the host reads again", async () => {
    const { onDone, onClose } = await open(() => Promise.reject(refusal(503, "down")));
    armed();
    reason(REASON);
    await confirm();
    expect(toasted(/^REA-01 · 2: cavab gəlmədi/).length).toBeGreaterThan(0);
    expect(onDone).toHaveBeenCalledWith("uncertain");
    expect(onClose).toHaveBeenCalled();
  });
});
```

Create `dashboard/src/live/screens/bedside/SavedStep.test.jsx`:

```jsx
// SavedStep.test.jsx — «Kaydedildi»: what was saved, each value with a «hatalı giriş», and a withdrawn row kept,
// struck through and said as such (G3-01, D13). Synthetic values only.
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { hhmm } from "../../i18n/dates.js";
import { RETRACT_ARM_MS } from "../common/RetractDialog.jsx";
import { SavedStep } from "./SavedStep.jsx";

const NOW = Date.parse("2026-11-02T10:00:00Z");
const CHARTABLE = ["board.view", "clinical.chart"];
const realSetTimeout = globalThis.setTimeout;
const FAKE_TIMERS = { toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] };
const settle = () => new Promise((resolve) => realSetTimeout(resolve, 0));
const SAVED = { atMs: NOW, rows: [
  { code: "resp_rate", value: 26, entry: 41 },
  { code: "supplemental_oxygen", value: 1, entry: 42 },
  { code: "spo2", value: 91, entry: null },          // an older engine answered no id for it
] };

async function open() {
  vi.useFakeTimers(FAKE_TIMERS);
  vi.setSystemTime(NOW);
  const onRetract = vi.fn(() => Promise.resolve({ retracted: 41, code: "resp_rate", alerts: [] }));
  await act(async () => {
    await mount(<SavedStep bed="REA-01 · 2" saved={SAVED} nowMs={NOW} onRetract={onRetract}><button type="button">next</button></SavedStep>,
      { access: token({ perms: CHARTABLE }), me: profile({ perms: CHARTABLE }) });
    await settle();
  });
  return { onRetract };
}
const row = (code) => document.querySelector(`[data-row="${code}"]`);
const press = (el) => act(async () => { fireEvent.click(el); await settle(); });

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the saved step", () => {
  it("lists what was saved with its time, and a «Səhv qeyd» for each value that has a row", async () => {
    await open();
    expect(screen.getByRole("heading", { level: 2, name: `Yadda saxlanıldı · ${hhmm(NOW)}` })).toBeInTheDocument();
    expect(row("resp_rate")).toHaveTextContent("Tənəffüs 26 /dəq");
    expect(row("supplemental_oxygen")).toHaveTextContent("Əlavə oksigen Əlavə oksigen alır");
    expect(within(row("resp_rate")).getByRole("button", { name: "Səhv qeyd" })).toBeInTheDocument();
    expect(within(row("spo2")).queryByRole("button")).toBeNull();
    expect(screen.getByRole("button", { name: "next" })).toBeInTheDocument();
  });

  it("keeps a withdrawn row, struck through and said as such, with no second button", async () => {
    const { onRetract } = await open();
    await press(within(row("resp_rate")).getByRole("button", { name: "Səhv qeyd" }));
    const dialog = screen.getByRole("dialog", { name: "Səhv qeyd · REA-01 · 2" });
    expect(dialog).toHaveTextContent(`Tənəffüs: 26 /dəq · ölçmə ${hhmm(NOW)}`);
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "yazım hatası, 16 idi" } });
    act(() => { vi.advanceTimersByTime(RETRACT_ARM_MS); });
    await press(within(dialog).getByRole("button", { name: "Səhv qeyd kimi işarələ" }));
    expect(onRetract).toHaveBeenCalledWith(41, "yazım hatası, 16 idi");
    expect(row("resp_rate").querySelector("s")).toHaveTextContent("26 /dəq");
    expect(row("resp_rate")).toHaveTextContent("səhv qeyd kimi işarələndi");
    expect(within(row("resp_rate")).queryByRole("button")).toBeNull();
    expect(within(row("supplemental_oxygen")).getByRole("button", { name: "Səhv qeyd" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Red**

```bash
cd /c/tmp/g3-vitals/dashboard && ./node_modules/.bin/vitest run src/live/screens/common/RetractDialog.test.jsx src/live/screens/bedside/SavedStep.test.jsx 2>&1 | tail -6
```

Expected: `Failed to resolve import "./RetractDialog.jsx"` and `Failed to resolve import "./SavedStep.jsx"`.

- [ ] **Step 3: The dialog**

Create `dashboard/src/live/screens/common/RetractDialog.jsx`:

```jsx
// src/live/screens/common/RetractDialog.jsx — «hatalı giriş» (G3-01, D10, D11): withdraw one hand-entered value,
// with a reason. Two screens open it — the bedside saved step (bedside/SavedStep.jsx) and the trend dialog's
// table (patient/trends/TrendModal.jsx) — so it lives here, with the other shared pieces (X15).
//
// WHAT IT SAYS before anything is sent: which value (its name, the number as entered, when it was measured) and
// what the withdrawal does — the value leaves every score and alert, the chart keeps it struck through with the
// reason, the act is written to the audit trail. The reason is the clinician's: at least
// RETRACT_MIN_REASON_CHARS characters once trimmed — the server's rule (api/clinical.py), mirrored only so the
// button can say why it waits. The button ignores a press for RETRACT_ARM_MS after the dialog opens (the second
// press of the double click that opened it must not withdraw — A4's and ESLEME's rule), and always ignores a
// double click's second press.
//
// THE ENGINE DECIDES (D11), and its refusal is said on the toast, named after the bed, in its own words. «Already
// withdrawn» (another desk got there first) closes the dialog and the host reads again; «no such hand entry» and
// «discharged» close it; a reason the engine finds short keeps it open. A 403 closes it. A withdrawal with no
// answer may have landed (`mayHaveLanded`): she is told to look at the chart, the host reads again, the dialog
// closes. A store that dropped its answer (null: the session ended) says nothing. `onDone(outcome)` tells the
// host how it ended: "retracted" | "already" | "uncertain".
import React, { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { apiErrorText } from "../../apiErrors.js";
import { Announce, Button, Field, Input, Modal, Note, useToast } from "../../ui/index.js";
import { mayHaveLanded } from "../admin/refusal.js";

/** The reason's least length once trimmed — api/clinical.py RETRACT_MIN_REASON_CHARS. */
export const RETRACT_MIN_REASON_CHARS = 10;
/** How long the confirm button ignores a press after the dialog opened. */
export const RETRACT_ARM_MS = 600;

/** `bed` names the patient in the title and on the toast; `what` is `{ label, value, time }` as the clinician
 *  reads them (the value with its unit, the time with its day when it is not today's). `onRetract(reason)` is
 *  the write, bound to the patient and the entry by the host; it resolves to the API's answer, or null when the
 *  store dropped it. */
export function RetractDialog({ bed, what, onRetract, onDone, onClose }) {
  const { t } = useI18n();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [arming, setArming] = useState(true);
  const armed = useRef(false);                 // false inside the arming window, read by the press itself
  const sending = useRef(false);
  const mounted = useRef(false);
  const formId = useId();
  const countId = useId();
  // The arming window starts when the dialog does. True inside the effect (the house pattern), so StrictMode's
  // rehearsal does not leave it false; the rehearsal's timer is cleared with it.
  useEffect(() => {
    mounted.current = true;
    const timer = setTimeout(() => {
      armed.current = true;
      if (mounted.current) setArming(false);
    }, RETRACT_ARM_MS);
    return () => {
      mounted.current = false;
      clearTimeout(timer);
    };
  }, []);
  const count = reason.trim().length;
  const short = count < RETRACT_MIN_REASON_CHARS;

  async function confirm(event) {
    if ((event?.detail ?? 0) > 1 || !armed.current || short || sending.current || busy) return;
    sending.current = true;
    setBusy(true);
    let done;   // { say: [text, tone], outcome: string | null, close } once the write is settled
    try {
      const answer = await onRetract(reason.trim());
      if (answer === null) return;   // the store dropped it: the session ended
      done = { say: [t("olcum.retractDone", { subject: bed, label: what.label })], outcome: "retracted", close: true };
    } catch (err) {
      if (err?.superseded) return;
      if (mayHaveLanded(err)) {
        done = { say: [t("olcum.retractMayHaveLanded", { subject: bed }), "warn"], outcome: "uncertain", close: true };
      } else {
        const forbidden = err?.status === 403;
        const said = forbidden ? t("olcum.noRight") : apiErrorText(t, err);
        done = {
          say: [t("olcum.retractRefused", { subject: bed, reason: said }), "error"],
          outcome: err?.status === 409 && !forbidden ? "already" : null,
          close: err?.status !== 400,
        };
      }
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
    // Out of the `try`: a host callback that throws must never turn a withdrawal the engine took into "not marked".
    toast(...done.say);
    try {
      if (done.outcome) onDone(done.outcome);
    } finally {
      if (done.close) onClose();
    }
  }

  return (
    <Modal
      open title={t("olcum.retractTitle", { bed })} onClose={onClose} busy={busy}
      actions={(
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          <p id={countId} className="m-0 mr-auto text-12 font-semibold text-mute">
            {t("olcum.retractCount", { count, min: RETRACT_MIN_REASON_CHARS })}
          </p>
          <div className="ml-auto flex shrink-0 gap-2">
            <Button variant="ghost" onClick={onClose} busy={busy}>{t("common.cancel")}</Button>
            <Button variant="danger" onClick={confirm} busy={busy}
              aria-disabled={short || arming ? "true" : undefined} aria-describedby={countId}>
              {t("olcum.retractConfirm")}
            </Button>
          </div>
        </div>
      )}
    >
      {/* Enter in the reason box presses the button: the same checks, and no `detail`. */}
      <form id={formId} noValidate onSubmit={(event) => { event.preventDefault(); confirm(); }}>
        <p className="m-0 font-data text-14.5 font-semibold">{t("olcum.retractWhat", what)}</p>
        <Note tone="warn" icon="alert" className="mt-2">{t("olcum.retractIntro")}</Note>
        <div className="mt-3">
          <Field label={t("olcum.retractReason")} layout="col" required>
            <Input autoFocus autoComplete="off" value={reason} onChange={(event) => setReason(event.target.value)} readOnly={busy} />
          </Field>
        </div>
      </form>
      <Announce text={busy ? t("olcum.saving") : ""} />
    </Modal>
  );
}
```

- [ ] **Step 4: The saved step**

Create `dashboard/src/live/screens/bedside/SavedStep.jsx`:

```jsx
// src/live/screens/bedside/SavedStep.jsx — «Kaydedildi» (G3-01, D3, D13): what was just saved and when it was
// measured, and a «Hatalı giriş» for each value. A slipped value is most likely to be seen right after it was
// typed. A withdrawn row stays, struck through and said as such, as the chart keeps it. A row's id is the
// door's answer (`entries`, VitalsForm `savedOf`); a row with none (an older engine) offers no button. The
// host's actions are the children: the page's «Sıradaki hasta» and «Hasta ekranı», the dialog's «Kapat».
import React, { useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { dayStamp } from "../../i18n/dates.js";
import { Box, Button } from "../../ui/index.js";
import { RetractDialog } from "../common/RetractDialog.jsx";
import { specOf, valueText } from "./vitalsFields.js";

/** `saved` is `{ atMs, rows: [{ code, value, entry }] }`; `onRetract(entry, reason)` is the withdrawal, bound to
 *  the patient by the host; `nowMs` says which day «today» is for the time. */
export function SavedStep({ bed, saved, nowMs, onRetract, children }) {
  const { t } = useI18n();
  const [withdrawn, setWithdrawn] = useState(() => new Set());
  const [open, setOpen] = useState(null);   // the row whose «Hatalı giriş» is open
  const time = dayStamp(saved.atMs, nowMs);
  const labelOf = (code) => {
    const spec = specOf(code);
    return spec ? t(spec.labelKey) : code;
  };
  return (
    <Box title={t("olcum.saved", { time })} icon="ok" level={2}>
      <h3 className="m-0 font-text text-11 font-bold uppercase tracking-[.08em] text-mute">{t("olcum.savedList")}</h3>
      {/* role="list": a list with its bullets removed (`list-none`) stops being one for VoiceOver. */}
      <ul role="list" className="m-0 mt-1 list-none p-0">
        {saved.rows.map((row) => {
          const struck = row.entry !== null && withdrawn.has(row.entry);
          const value = valueText(t, row.code, row.value);
          return (
            <li key={row.code} data-row={row.code} className="flex flex-wrap items-center gap-2 border-b border-line py-2 last:border-b-0">
              <span className="min-w-0 flex-1 text-14.5">
                <span className="font-semibold text-mute">{labelOf(row.code)}</span>{" "}
                {struck ? <s className="font-data">{value}</s> : <b className="font-data">{value}</b>}
                {struck ? <span className="ml-2 text-12 font-semibold text-att-ink">{t("olcum.retractedShort")}</span> : null}
              </span>
              {row.entry !== null && !struck ? (
                <Button size="sm" variant="ghost" icon="x" onClick={() => setOpen(row)}>{t("olcum.retract")}</Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex flex-wrap justify-end gap-2">{children}</div>
      {open ? (
        <RetractDialog
          bed={bed} what={{ label: labelOf(open.code), value: valueText(t, open.code, open.value), time }}
          onRetract={(reason) => onRetract(open.entry, reason)}
          // «Already» is withdrawn too; an uncertain one keeps its button — a second try is answered «already».
          onDone={(outcome) => {
            if (outcome !== "uncertain") setWithdrawn((current) => new Set(current).add(open.entry));
          }}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </Box>
  );
}
```

- [ ] **Step 5: Green**

```bash
cd /c/tmp/g3-vitals/dashboard && ./node_modules/.bin/vitest run src/live/screens/common/RetractDialog.test.jsx src/live/screens/bedside 2>&1 | tail -6
```

Expected: `RetractDialog.test.jsx` 5 passed, `SavedStep.test.jsx` 2 passed, and the bedside files of Tasks 10 and 12 still green.

- [ ] **Step 6: Line ends and commit**

```bash
cd /c/tmp/g3-vitals && for f in dashboard/src/live/screens/common/RetractDialog.jsx dashboard/src/live/screens/common/RetractDialog.test.jsx dashboard/src/live/screens/bedside/SavedStep.jsx dashboard/src/live/screens/bedside/SavedStep.test.jsx; do /c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" "$f"; printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- dashboard/src/live/screens/common/RetractDialog.jsx dashboard/src/live/screens/common/RetractDialog.test.jsx dashboard/src/live/screens/bedside/SavedStep.jsx dashboard/src/live/screens/bedside/SavedStep.test.jsx
git status --short && git diff --cached --stat
git commit -m "feat(bedside): «hatalı giriş» — the withdrawal dialog and the saved step (G3-01, D10, D11, D13, X15)" -m "<the red you saw, and the body>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: The page «Yatak başı ölçüm» and its route (D3, D14, X9, X13)

**Files:**
- Create: `dashboard/src/live/screens/bedside/BedsideScreen.jsx`, `dashboard/src/live/screens/bedside/BedsideScreen.test.jsx`
- Modify: `dashboard/src/live/shell/routes.js`, `dashboard/src/live/shell/routes.test.js`

The page reads the board this session already has: the engine's scope filter decides who is on it, as on the beds screen. It sits after Hasta Kabul in the route table, so nobody's home screen moves. A session whose only work right is `clinical.chart` lands on it. The raw-key sweep (`rawKeys.test.jsx`) opens every built screen at its address, so the list step is swept without editing that file.

- [ ] **Step 1: Write the failing tests**

Create `dashboard/src/live/screens/bedside/BedsideScreen.test.jsx`:

```jsx
// BedsideScreen.test.jsx — «Çarpayı başında ölçmə»: the board's patients by bed, who it is before the form, the
// form bound to the chosen patient through the board store, and the saved step (G3-01, D3, X9, X13). Synthetic
// cards only (board.testutil.js).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { NOW, ago, board, entry, identity, news2 } from "../../data/board.testutil.js";
import { dayStamp, hhmm } from "../../i18n/dates.js";
import { BedsideScreen } from "./BedsideScreen.jsx";
import { SAVE_ARM_MS } from "./VitalsForm.jsx";

const CHARTABLE = ["board.view", "clinical.chart"];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const AYSE = entry("S-001", [], { identity: identity({ birth_date: "1970-05-05" }), score: news2({ measured_at: { spo2: ago(600), pulse: null } }) });
const VUSAL = entry("S-002", [], { identity: identity({ patient_id: "S-002", display_name: "Vüsal Sınaq", bed_label: "REA-01 · 1",
  bed_id: "REA-01-1", bed_key: "REA^01^1" }) });
const PREVIEW = { patient_id: "S-001", preview: true, at: new Date(NOW).toISOString(), news2: news2({ total: 1, breakdown: { spo2: 1 } }) };
const SAVED = { patient_id: "S-001", charted: 1, alerts: [], entries: [{ code: "spo2", entry: 51 }] };

/** The page inside a real session and board store, the board LIVE with its first reload landed. */
async function open(cards = [AYSE, VUSAL]) {
  const mounted = await mount(<BedsideScreen />, {
    access: token({ perms: CHARTABLE }), me: profile({ perms: CHARTABLE }),
    setup: (api) => {
      api.boardPatients.mockResolvedValue(board(cards));
      api.streamTicket.mockResolvedValue({ ticket: "t-1" });
      api.previewChart.mockResolvedValue(PREVIEW);
      api.chart.mockResolvedValue(SAVED);
    },
  });
  await act(async () => { await mounted.board.start(); });
  await act(async () => { mounted.stream.open(); await settle(); });
  return mounted;
}
const press = (el) => act(async () => { fireEvent.click(el); await settle(); });
const pick = (id) => press(document.querySelector(`[data-pick="${id}"]`));
const picks = () => [...document.querySelectorAll("[data-pick]")];
const button = (name) => screen.getByRole("button", { name });
const toasted = (text) => within(screen.getByRole("region", { name: "Bildirişlər" })).queryAllByText(text);

beforeEach(() => { vi.setSystemTime(NOW); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the bedside page", () => {
  it("lists the board's patients by bed, each with name, age and when it was last measured", async () => {
    await open();
    expect(screen.getByRole("heading", { level: 1, name: "Çarpayı başında ölçmə" })).toBeInTheDocument();
    expect(picks().map((b) => b.getAttribute("data-pick"))).toEqual(["S-002", "S-001"]);
    expect(picks()[1]).toHaveTextContent("REA-01 · 2");
    expect(picks()[1]).toHaveTextContent("Ayşe Sentetik");
    expect(picks()[1]).toHaveTextContent(`56 yaşında · son ölçmə ${dayStamp(NOW - 600_000, NOW)}`);
    expect(picks()[0]).toHaveTextContent("ölçmə yoxdur");
  });

  it("asks who it is before the form; «Xeyr» cancels the choice and says to tell the charge nurse", async () => {
    const { api } = await open();
    await pick("S-001");
    expect(screen.getByRole("heading", { level: 2, name: "Şəxsiyyətin təsdiqi" })).toBeInTheDocument();
    expect(screen.getByText("Ayşe Sentetik")).toBeInTheDocument();
    expect(screen.getByText("1970")).toBeInTheDocument();
    await press(button("Xeyr, uyğun deyil"));
    expect(toasted("REA-01 · 2: şəxsiyyət uyğun gəlmədi, seçim ləğv edildi. Məsul tibb bacısına bildirin.").length).toBeGreaterThan(0);
    expect(picks()).toHaveLength(2);
    expect(api.previewChart).not.toHaveBeenCalled();
  });

  it("a patient with no birth date says so, and «Bəli» opens the form for that bed", async () => {
    await open();
    await pick("S-002");
    expect(screen.getByText("doğum tarixi qeyd edilməyib")).toBeInTheDocument();
    await press(button("Bəli, uyğundur"));
    expect(screen.getByRole("heading", { level: 2, name: "Ölçmə · REA-01 · 1" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /^Tənəffüs/ })).toBeInTheDocument();
  });

  it("previews and saves through the board store for the chosen patient, then shows what was saved", async () => {
    const { api } = await open();
    await pick("S-001");
    await press(button("Bəli, uyğundur"));
    fireEvent.change(screen.getByRole("textbox", { name: /^SpO2/ }), { target: { value: "95" } });
    await press(button("Öncədən baxın"));
    expect(api.previewChart).toHaveBeenCalledWith("S-001", [{ code: "spo2", value: 95 }], null);
    // «Yadda saxla» ignores a press in its arming window; real timers here (the board store's own), so wait it out.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, SAVE_ARM_MS + 50)); });
    await press(button("Yadda saxla"));
    expect(api.chart).toHaveBeenCalledWith("S-001", [{ code: "spo2", value: 95 }], null);
    expect(screen.getByRole("heading", { level: 2, name: `Yadda saxlanıldı · ${hhmm(NOW)}` })).toBeInTheDocument();
    expect(document.querySelector('[data-row="spo2"]')).toHaveTextContent("SpO2 95 %");
    expect(screen.getByRole("link", { name: "Xəstə ekranı" })).toHaveAttribute("href", "#/patients/S-001");
    await press(button("Növbəti xəstə"));
    expect(picks()).toHaveLength(2);
  });

  it("a patient who leaves the board while chosen is said, and the page goes back to the list", async () => {
    const { stream } = await open();
    await pick("S-001");
    await press(button("Bəli, uyğundur"));
    await act(async () => { stream.frame({ patient_id: "S-001", removed: true }); await settle(); });
    expect(screen.getByText("Seçilmiş xəstə artıq siyahıda deyil (evə yazılıb və ya əhatə xaricindədir). Yenidən seçin.")).toBeInTheDocument();
    expect(picks().map((b) => b.getAttribute("data-pick"))).toEqual(["S-002"]);
  });
});
```

In `dashboard/src/live/shell/routes.test.js`, before the line `describe("matching an address", () => {` add:

```js
// G3-01 (D3, D14): the bedside page opens with clinical.chart, on the rail after the ward's other screens.
describe("«Yatak başı ölçüm»", () => {
  it("is on the rail for a clinical.chart holder, and the home of one who holds nothing else", () => {
    expect(navRoutes(["clinical.chart"]).main.map((r) => r.id)).toEqual(["olcum"]);
    expect(homePath(["clinical.chart"])).toBe("/olcum");
    expect(hasWorkRoute(["clinical.chart"])).toBe(true);
  });

  it("moves nobody's home, and is not offered without clinical.chart", () => {
    expect(homePath(["board.view", "clinical.chart"])).toBe("/beds");
    expect(navRoutes(NURSE).main.map((r) => r.id)).not.toContain("olcum");
  });
});

```

- [ ] **Step 2: Red**

```bash
cd /c/tmp/g3-vitals/dashboard && ./node_modules/.bin/vitest run src/live/screens/bedside/BedsideScreen.test.jsx src/live/shell/routes.test.js 2>&1 | tail -8
```

Expected: `Failed to resolve import "./BedsideScreen.jsx"`, and the two route tests fail (`[]` is not `["olcum"]`).

- [ ] **Step 3: The page**

Create `dashboard/src/live/screens/bedside/BedsideScreen.jsx`:

```jsx
// src/live/screens/bedside/BedsideScreen.jsx — «Yatak başı ölçüm» (G3-01, D3): the tablet and phone page for the
// round. Choose the patient, confirm who it is, enter the set, see what was saved.
//
// THE LIST is the board this session already has — the engine's scope filter decides who is on it, as on the
// beds screen — each patient by bed, name, age and when a NEWS2 input was last measured. Last measured by
// anything, not by hand: the board carries no source per value (X13), and «son ölçüm» is still what a nurse on
// a round needs. Sorted by bed, the way she walks the ward.
//
// WHO IT IS (D3, X9): the name and the year of birth the HIS sent, and the bed. «Hayır» cancels the choice and
// says to tell the charge nurse — on the toast, named after the bed — and nothing is charted. A patient with no
// birth date says so; the question is asked all the same. The year is the HIS's, never one made up.
//
// THE FORM is VitalsForm, bound to the chosen patient through the board store (`chartPreview`, `chart`); the
// saved step offers «hatalı giriş» per value (`retract`). The choice is held by id: should the card leave a LIVE
// board while she is on it (discharged, out of scope), the page says so and goes back to the list — a form for a
// patient who is no longer here is not left open. A board that is reconnecting is not "gone": its list is old,
// not empty. Each step takes the focus when it opens, so a keyboard and a screen reader follow the page.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { dayStamp } from "../../i18n/dates.js";
import { useBoard } from "../../data/BoardProvider.jsx";
import { Box, Button, Note, useToast } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { BoardStrip, ScopeNote, boardKnown, nameOf, useBoardNow } from "../common/BoardState.jsx";
import { SavedStep } from "./SavedStep.jsx";
import { VitalsForm } from "./VitalsForm.jsx";
import { birthYearOf, lastMeasuredMs } from "./vitalsFields.js";

const TICK_MS = 30_000;
const bedOf = (patient) => patient.bedLabel || patient.patient_id;
const byBed = (a, b) => String(bedOf(a)).localeCompare(String(bedOf(b)), "tr", { numeric: true });

function PickList({ patients, nowMs, onPick }) {
  const { t } = useI18n();
  if (patients.length === 0) return <Note tone="info" icon="bed">{t("olcum.pickEmpty")}</Note>;
  return (
    // role="list": a list with its bullets removed (`list-none`) stops being one for VoiceOver.
    <ul role="list" className="m-0 grid list-none gap-2 p-0 min-[640px]:grid-cols-2">
      {patients.map((p) => {
        const last = lastMeasuredMs(p);
        const facts = [
          Number.isInteger(p.age) ? t("olcum.pickAge", { years: p.age }) : null,
          last !== null ? t("olcum.pickLast", { time: dayStamp(last, nowMs) }) : t("olcum.pickNone"),
        ].filter(Boolean);
        return (
          <li key={p.patient_id}>
            <button
              type="button" data-pick={p.patient_id} onClick={() => onPick(p)}
              className={`block w-full rounded-box border border-line bg-card px-4 py-3 text-left ${FOCUS_RING}`}
            >
              <b className="block font-data text-17 font-bold text-ink">{bedOf(p)}</b>
              <span className={`block text-14.5 ${p.display_name ? "text-ink" : "italic text-mute"}`}>{nameOf(p, t)}</span>
              <span className="mt-1 block text-12 text-mute">{facts.join(" · ")}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function IdentityStep({ patient, onYes, onNo }) {
  const { t } = useI18n();
  const year = birthYearOf(patient.birthDate);
  const term = "font-semibold text-mute";
  return (
    <Box title={t("olcum.identityTitle")} icon="user" level={2}>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-14.5">
        <dt className={term}>{t("olcum.identityName")}</dt>
        <dd className={`m-0 font-bold ${patient.display_name ? "" : "italic text-mute"}`}>{nameOf(patient, t)}</dd>
        <dt className={term}>{t("olcum.identityYear")}</dt>
        <dd className="m-0">
          {year ? <b className="font-data">{year}</b> : <span className="italic text-mute">{t("olcum.identityNoBirth")}</span>}
        </dd>
        <dt className={term}>{t("olcum.identityBed")}</dt>
        <dd className="m-0 font-data font-bold">{bedOf(patient)}</dd>
      </dl>
      <p className="m-0 mt-3 text-14.5 font-semibold">{t("olcum.identityAsk")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="lg" variant="primary" icon="ok" onClick={onYes}>{t("olcum.identityYes")}</Button>
        <Button size="lg" icon="x" onClick={onNo}>{t("olcum.identityNo")}</Button>
      </div>
    </Box>
  );
}

export function BedsideScreen() {
  const { t } = useI18n();
  const board = useBoard();
  const toast = useToast();
  const nowMs = useBoardNow(TICK_MS);
  // { name: "pick" | "identity" | "form" | "saved", id?, bed?, saved? }: the step, and the patient it is for.
  const [step, setStep] = useState({ name: "pick" });
  const [gone, setGone] = useState(false);
  const stepRef = useRef(null);
  const moved = useRef(false);
  const patients = useMemo(() => [...board.patients].sort(byBed), [board.patients]);
  const patient = step.id ? board.patients.find((p) => p.patient_id === step.id) ?? null : null;
  const known = boardKnown(board.connection);
  useEffect(() => {
    if ((step.name === "identity" || step.name === "form") && known && !patient) {
      setGone(true);
      setStep({ name: "pick" });
    }
  }, [step.name, known, patient]);
  // Not on the first render: the page opening is not a step the focus has to follow.
  useEffect(() => {
    if (moved.current) stepRef.current?.focus();
    moved.current = true;
  }, [step.name]);
  const { id, bed } = step;
  const choose = (p) => {
    setGone(false);
    setStep({ name: "identity", id: p.patient_id, bed: bedOf(p) });
  };
  const refuse = () => {
    toast(t("olcum.identityRefused", { subject: bed }), "warn");
    setStep({ name: "pick" });
  };
  return (
    <div className="flex min-h-0 max-w-[900px] flex-col gap-3">
      <h1 className="m-0 font-display text-23 font-bold">{t("olcum.title")}</h1>
      <p className="m-0 text-13 text-mute">{t("olcum.intro")}</p>
      <BoardStrip connection={board.connection} />
      <ScopeNote scope={board.scope} scopeNote={board.scopeNote} />
      {gone ? <Note tone="warn" icon="alert">{t("olcum.gone")}</Note> : null}
      <section ref={stepRef} tabIndex={-1} data-step={step.name} className="outline-none">
        {step.name === "pick" ? (
          <>
            <h2 className="m-0 mb-2 font-text text-11 font-bold uppercase tracking-[.08em] text-mute">{t("olcum.pickTitle")}</h2>
            <PickList patients={patients} nowMs={nowMs} onPick={choose} />
          </>
        ) : null}
        {step.name === "identity" && patient ? (
          <IdentityStep patient={patient} onYes={() => setStep({ name: "form", id, bed })} onNo={refuse} />
        ) : null}
        {step.name === "form" && patient ? (
          <Box title={t("olcum.formTitle", { bed })} icon="activity" level={2}>
            <VitalsForm
              key={id} bed={bed} nowMs={nowMs}
              onPreview={(entries, at) => board.store.chartPreview(id, entries, at)}
              onSave={(entries, at) => board.store.chart(id, entries, at)}
              onSaved={(saved) => setStep({ name: "saved", id, bed, saved })}
              onCancel={() => setStep({ name: "pick" })}
            />
          </Box>
        ) : null}
        {step.name === "saved" ? (
          <SavedStep bed={bed} saved={step.saved} nowMs={nowMs} onRetract={(entry, reason) => board.store.retract(id, entry, reason)}>
            <a href={`#/patients/${encodeURIComponent(id)}`}
              className={`inline-flex items-center gap-1.5 rounded-ctl border border-line px-4 py-2.5 text-14.5 font-semibold text-pri ${FOCUS_RING}`}>
              {t("olcum.savedOpen")}
            </a>
            <Button size="lg" variant="primary" icon="chevR" onClick={() => setStep({ name: "pick" })}>{t("olcum.savedNext")}</Button>
          </SavedStep>
        ) : null}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: The route**

In `dashboard/src/live/shell/routes.js`, after:

```js
import { KabulScreen } from "../screens/kabul/KabulScreen.jsx"; // G2-B1a
```

add:

```js

import { BedsideScreen } from "../screens/bedside/BedsideScreen.jsx"; // G3-01
```

In `SCREENS` replace:

```js
  kabul: KabulScreen, // G2-B1a — Hasta Kabul: admission, discharge, beds

  settings: SettingsScreen,
```

with:

```js
  kabul: KabulScreen, // G2-B1a — Hasta Kabul: admission, discharge, beds

  olcum: BedsideScreen, // G3-01 — Yatak başı ölçüm: the bedside set by hand

  settings: SettingsScreen,
```

In `ROUTES` replace:

```js
    perms: ["admissions.view", "admissions.admit", "admissions.discharge.confirm", "beds.release"], work: true, nav: "main" }),

  route({ id: "settings", path: "/settings", icon: "gear", labelKey: "nav.settings", shortKey: "nav.settingsShort",
```

with:

```js
    perms: ["admissions.view", "admissions.admit", "admissions.discharge.confirm", "beds.release"], work: true, nav: "main" }),

  // G3-01 (D3, D14) — Yatak başı ölçüm: for whoever charts (`clinical.chart`). After the ward's other screens,
  // so nobody's home moves; a session that only charts lands here.
  route({ id: "olcum", path: "/olcum", icon: "heart", labelKey: "olcum.nav", shortKey: "olcum.navShort",
    perms: ["clinical.chart"], work: true, nav: "main" }),

  route({ id: "settings", path: "/settings", icon: "gear", labelKey: "nav.settings", shortKey: "nav.settingsShort",
```

- [ ] **Step 5: Green, then the shell, the sweep and the strings**

```bash
cd /c/tmp/g3-vitals/dashboard && ./node_modules/.bin/vitest run src/live/screens/bedside src/live/shell src/live/rawKeys.test.jsx src/live/i18n 2>&1 | tail -8
```

Expected:
- `BedsideScreen.test.jsx` 5 passed;
- `routes.test.js` passes with two tests more;
- `rawKeys.test.jsx` passes: the sweep opens `/olcum` and finds no raw key;
- the shell's other tests pass.

A shell test that pins the whole rail of a session holding every right may list one entry more. Add `olcum` after `kabul` in that list and name the test in the report.

- [ ] **Step 6: Line ends and commit**

```bash
cd /c/tmp/g3-vitals && for f in dashboard/src/live/screens/bedside/BedsideScreen.jsx dashboard/src/live/screens/bedside/BedsideScreen.test.jsx; do /c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" "$f"; done
for f in dashboard/src/live/screens/bedside/BedsideScreen.jsx dashboard/src/live/screens/bedside/BedsideScreen.test.jsx dashboard/src/live/shell/routes.js dashboard/src/live/shell/routes.test.js; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- dashboard/src/live/screens/bedside/BedsideScreen.jsx dashboard/src/live/screens/bedside/BedsideScreen.test.jsx dashboard/src/live/shell/routes.js dashboard/src/live/shell/routes.test.js
git status --short && git diff --cached --stat
git commit -m "feat(bedside): the «Yatak başı ölçüm» page — choose, confirm, enter, saved — and its route (G3-01, D3, D14, X9, X13)" -m "<the red you saw, and the body>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: «Ölçüm gir» on the patient screen (D3b, D14)

**Files:**
- Create: `dashboard/src/live/screens/patient/VitalsEntry.jsx`
- Modify: `dashboard/src/live/screens/patient/PatientScreen.jsx`, `dashboard/src/live/screens/patient/PatientScreen.test.jsx`
- Modify: `dashboard/src/live/i18n/strings/patient.js`

The same form opens in a dialog, with no identity step: the screen's header already names the patient. After a save the dialog shows the saved step, with «hatalı giriş» per value and «Kapat». The screen's sentence on what it writes (`patient.onlyWrite`) now lists five things.

- [ ] **Step 1: Write the failing tests**

In `dashboard/src/live/screens/patient/PatientScreen.test.jsx` replace:

```js
  it("names the bed and the patient, and says the four things it writes and that the SOFA form is signed too", async () => {
```

with:

```js
  it("names the bed and the patient, and says the five things it writes and that the SOFA form is signed too", async () => {
```

and replace:

```js
    expect(screen.getByText(/heç nə yazılmır/)).toHaveTextContent(/dörd şey yazır/);
    expect(screen.getByText(/heç nə yazılmır/)).toHaveTextContent(/şübhəli infeksiya işarəsi, xəstənin norması, dərman \/ maye qeydi və SOFA formasından daxil edilən ölçmələr/);
```

with:

```js
    expect(screen.getByText(/heç nə yazılmır/)).toHaveTextContent(/beş şey yazır/);
    // G3-01 (D3b): the bedside set, entered with «Ölçmə daxil et», and that a value can be withdrawn.
    expect(screen.getByText(/heç nə yazılmır/)).toHaveTextContent(/şübhəli infeksiya işarəsi, xəstənin norması, dərman \/ maye qeydi, SOFA formasından daxil edilən ölçmələr və «Ölçmə daxil et» ilə daxil edilən çarpayı başı ölçmələri/);
    expect(screen.getByText(/heç nə yazılmır/)).toHaveTextContent(/«səhv qeyd» kimi geri götürülə bilər/);
```

Then, before the line `  it("offers the way back to the board it was opened from", async () => {`, add:

```js
  // G3-01 (D3b, D14): the bedside form, from the patient shown, for a clinical.chart holder only.
  it("does not offer «Ölçmə daxil et» without clinical.chart", async () => {
    await open({ payload: board([entry("S-001", [], FULL)]) });
    expect(screen.queryByRole("button", { name: "Ölçmə daxil et" })).toBeNull();
  });

  it("opens the bedside form for the patient shown, with no identity step, and previews through the store", async () => {
    const { api } = await open({
      payload: board([entry("S-001", [], FULL)]), perms: ["board.view", "clinical.chart"],
      setup: (a) => { a.previewChart.mockResolvedValue({ patient_id: "S-001", preview: true, news2: news2({ total: 3 }) }); },
    });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Ölçmə daxil et" })); await settle(); });
    const dialog = screen.getByRole("dialog", { name: "Ölçmə daxil et · REA-01 · 2" });
    expect(within(dialog).queryByText("Ad, soyad və doğum ili xəstəyə uyğundurmu?")).toBeNull();
    fireEvent.change(within(dialog).getByRole("textbox", { name: /^Nəbz/ }), { target: { value: "88" } });
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Öncədən baxın" })); await settle(); });
    expect(api.previewChart).toHaveBeenCalledWith("S-001", [{ code: "heart_rate", value: 88 }], null);
    expect(within(dialog).getByText("NEWS2 (öncədən baxış):")).toBeInTheDocument();
  });

```

- [ ] **Step 2: Red**

```bash
cd /c/tmp/g3-vitals/dashboard && ./node_modules/.bin/vitest run src/live/screens/patient/PatientScreen.test.jsx 2>&1 | tail -8
```

Expected: the renamed test fails on `/beş şey yazır/`, and the dialog test fails (`Unable to find role="button" and name "Ölçmə daxil et"`). The test without the right passes already.

- [ ] **Step 3: The button and its dialog**

Create `dashboard/src/live/screens/patient/VitalsEntry.jsx`:

```jsx
// src/live/screens/patient/VitalsEntry.jsx — «Ölçüm gir» beside the patient screen's measured values (G3-01, D3b):
// the bedside form (bedside/VitalsForm.jsx) in a dialog, for whoever is already on the patient. No identity step:
// the screen's header names the patient. After a save the dialog shows the saved step — «hatalı giriş» per value
// — and «Kapat». The writes go through the board store, bound to the patient shown; the store reloads the board
// after a chart and after a withdrawal.
//
// The screen offers it only to a `clinical.chart` holder (MedsBox's rule: ABSENT, never disabled). The shell keeps
// this screen mounted across a move to another patient (no `key`), so the button remembers WHOSE dialog it opened:
// one opened on one patient is never shown on the next, and a late close from an earlier opening closes nothing
// of a new one. The dialog holds its ✕ while the form has a request in flight (`onBusy`).
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useBoard } from "../../data/BoardProvider.jsx";
import { Button, Modal } from "../../ui/index.js";
import { useBoardNow } from "../common/BoardState.jsx";
import { SavedStep } from "../bedside/SavedStep.jsx";
import { VitalsForm } from "../bedside/VitalsForm.jsx";

const TICK_MS = 30_000;

/** `patientId` is the patient shown; `bed` names them in the title and on every toast. */
export function VitalsEntry({ patientId, bed }) {
  const { t } = useI18n();
  const board = useBoard();
  const nowMs = useBoardNow(TICK_MS);
  const [open, setOpen] = useState(null);      // { id, opening, saved? }: whose dialog, which opening, what was saved
  const [busy, setBusy] = useState(false);
  const openings = useRef(0);
  useEffect(() => { setOpen(null); }, [patientId]);
  const onBusy = useCallback((value) => setBusy(value), []);
  const mine = open && open.id === patientId ? open : null;
  const opening = mine?.opening;
  const close = () => setOpen((current) => (current?.opening === opening ? null : current));
  function start() {
    openings.current += 1;
    setBusy(false);
    setOpen({ id: patientId, opening: openings.current });
  }
  return (
    <>
      <Button size="sm" icon="plus" onClick={start}>{t("olcum.entryButton")}</Button>
      {mine ? (
        <Modal open title={t("olcum.entryTitle", { bed })} onClose={close} busy={busy}>
          {mine.saved ? (
            <SavedStep bed={bed} saved={mine.saved} nowMs={nowMs}
              onRetract={(entry, reason) => board.store.retract(patientId, entry, reason)}>
              <Button variant="primary" onClick={close}>{t("common.close")}</Button>
            </SavedStep>
          ) : (
            <VitalsForm
              key={mine.opening} bed={bed} nowMs={nowMs} onBusy={onBusy}
              onPreview={(entries, at) => board.store.chartPreview(patientId, entries, at)}
              onSave={(entries, at) => board.store.chart(patientId, entries, at)}
              onSaved={(saved) => setOpen((current) => (current?.opening === opening ? { ...current, saved } : current))}
              onCancel={close}
            />
          )}
        </Modal>
      ) : null}
    </>
  );
}
```

In `dashboard/src/live/screens/patient/PatientScreen.jsx`:

1. After `import { MedsBox } from "./meds/MedsBox.jsx";` add:

```js
import { VitalsEntry } from "./VitalsEntry.jsx"; // G3-01 (D3b)
```

2. Replace:

```jsx
          <Box title={t("patient.vitals")} icon="activity" level={2}>
            <Vitals patient={patient} shadow={patient.shadow} nowMs={nowMs} />
          </Box>
```

with:

```jsx
          {/* G3-01 (D3b): «Ölçüm gir» — the bedside form in a dialog, beside the values it adds to. Absent without
              clinical.chart. */}
          <Box title={t("patient.vitals")} icon="activity" level={2}
            right={canChart ? <VitalsEntry patientId={id} bed={bed} /> : null}>
            <Vitals patient={patient} shadow={patient.shadow} nowMs={nowMs} />
          </Box>
```

3. In the header comment replace:

```
// It writes FOUR things, and says so in as many words (`patient.onlyWrite`), each only for a
// `clinical.chart` holder: whether an infection is suspected (Task 15B, Decision 27); since Group 2 ·
// slice 1, from the trends box, the patient's own normal ranges; since G2-A3, from the Meds box
// (`meds/MedsBox.jsx`, D4), the medication and fluid entries — a pressor rate, a bolus, the weight,
// "antibiotic given"; and since G2-A4, from the SOFA form (`sofa/SofaBox.jsx`, D3), the measurements that
// complete its organ rows. A `scores.sign` holder also SIGNS that form there (D6) — a sealed row in the
// audit chain, not an observation — and the sentence says so (X6). Nothing else here reaches the record.
```

with:

```
// It writes FIVE things, and says so in as many words (`patient.onlyWrite`), each only for a
// `clinical.chart` holder: whether an infection is suspected (Task 15B, Decision 27); since Group 2 ·
// slice 1, from the trends box, the patient's own normal ranges; since G2-A3, from the Meds box
// (`meds/MedsBox.jsx`, D4), the medication and fluid entries — a pressor rate, a bolus, the weight,
// "antibiotic given"; since G2-A4, from the SOFA form (`sofa/SofaBox.jsx`, D3), the measurements that
// complete its organ rows; and since G3-01, from «Ölçüm gir» (`VitalsEntry.jsx`, D3b), the bedside set — a
// value of which can be withdrawn as «hatalı giriş» there or in the trend table (D10). A `scores.sign` holder
// also SIGNS the SOFA form (D6) — a sealed row in the audit chain, not an observation — and the sentence says
// so (X6). Nothing else here reaches the record.
```

- [ ] **Step 4: The sentence, four languages**

In `dashboard/src/live/i18n/strings/patient.js` replace each language's `onlyWrite` line.

tr:

```js
    onlyWrite: "Bu ekran hasta kaydına beş şey yazar, beşi de yalnız clinical.chart yetkisiyle: şüpheli enfeksiyon işareti, hastanın normali, ilaç / sıvı kaydı, SOFA formundan girilen ölçümler ve «Ölçüm gir» ile girilen yatak başı ölçümleri (bir değer «hatalı giriş» olarak geri alınabilir). SOFA formunun imzası ayrıca scores.sign yetkisi ister ve denetim kaydına geçer; başka hiçbir şey buradan yazılmaz.",
```

az:

```js
    onlyWrite: "Bu ekran xəstə qeydinə beş şey yazır, hər beşi yalnız clinical.chart səlahiyyəti ilə: şübhəli infeksiya işarəsi, xəstənin norması, dərman / maye qeydi, SOFA formasından daxil edilən ölçmələr və «Ölçmə daxil et» ilə daxil edilən çarpayı başı ölçmələri (bir dəyər «səhv qeyd» kimi geri götürülə bilər). SOFA formasının imzası ayrıca scores.sign səlahiyyəti tələb edir və audit qeydinə düşür; buradan başqa heç nə yazılmır.",
```

ru:

```js
    onlyWrite: "Этот экран записывает в карту пациента пять вещей, все только с правом clinical.chart: отметку о подозрении на инфекцию, норму пациента, запись о препарате / жидкости, измерения, введённые в форме SOFA, и измерения у постели через «Ввести измерение» (значение можно отозвать как «ошибочную запись»). Подпись формы SOFA требует отдельного права scores.sign и попадает в журнал аудита; больше отсюда ничего не записывается.",
```

en:

```js
    onlyWrite: "This screen writes five things to the patient's record, all only with clinical.chart: the suspected-infection charting, the patient's normal, the medication / fluid entry, the measurements entered on the SOFA form and the bedside measurements entered with «Enter measurement» (a value can be withdrawn as «entered in error»). Signing the SOFA form needs scores.sign, separately, and goes into the audit trail; nothing else is written from here.",
```

- [ ] **Step 5: Green**

```bash
cd /c/tmp/g3-vitals/dashboard && ./node_modules/.bin/vitest run src/live/screens/patient src/live/i18n src/live/rawKeys.test.jsx 2>&1 | tail -6
```

Expected: all pass; `PatientScreen.test.jsx` has two tests more. The sweep's patient screen holds every right, so it now draws the «Ölçmə daxil et» button too, and finds no raw key.

- [ ] **Step 6: Line ends and commit**

```bash
cd /c/tmp/g3-vitals && /c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))" dashboard/src/live/screens/patient/VitalsEntry.jsx
for f in dashboard/src/live/screens/patient/VitalsEntry.jsx dashboard/src/live/screens/patient/PatientScreen.jsx dashboard/src/live/screens/patient/PatientScreen.test.jsx dashboard/src/live/i18n/strings/patient.js; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- dashboard/src/live/screens/patient/VitalsEntry.jsx dashboard/src/live/screens/patient/PatientScreen.jsx dashboard/src/live/screens/patient/PatientScreen.test.jsx dashboard/src/live/i18n/strings/patient.js
git status --short && git diff --cached --stat
git commit -m "feat(patient): «Ölçüm gir» — the bedside form in a dialog on the patient screen; the screen writes five things (G3-01, D3b, D14)" -m "<the red you saw, and the body>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: The trends show what was typed and what was withdrawn (D1, D13, X13, X16)

**Files:**
- Modify: `dashboard/src/live/screens/patient/trends/trendGeometry.js`, `trendGeometry.test.js`, `trends.testutil.js`
- Modify: `dashboard/src/live/screens/patient/trends/TrendCard.jsx`, `TrendCard.test.jsx`
- Modify: `dashboard/src/live/screens/patient/trends/TrendChart.jsx`, `TrendTable.jsx`, `TrendModal.jsx`, `TrendModal.test.jsx`, `TrendsBox.jsx`

The trends answer lists each channel's hand entries in `manual` (Task 6). A drawn reading is a hand entry when an entry that is not withdrawn has its instant and its value. The points carry no other link to the trail. A device reading at the very same millisecond with the very same number would be taken for one; the door stamps a hand entry with its own instant (the server's clock, or the typed minute).

What changes:
- **The card** says «elle» beside a latest value typed by hand.
- **The big chart** says it in the readout, and draws a withdrawn value dimmed and crossed where it was typed. Its value axis holds that value too, and a line under the chart says what the cross means.
- **The mini chart** in the card draws the engine's points only (X16).
- **The table** says «elle» on a hand row and offers «Hatalı giriş» there to a `clinical.chart` holder. A withdrawn value is a row of its own, struck through, with its reason, who and when.

- [ ] **Step 1: Write the failing tests**

In `dashboard/src/live/screens/patient/trends/trends.testutil.js`:

1. In `channel()` replace:

```js
    bands: { news2: BANDS[key], own_normal: null, device: null },
    ...over,
```

with:

```js
    bands: { news2: BANDS[key], own_normal: null, device: null },
    manual: [],               // G3-01 (D13): the channel's hand entries in the window
    ...over,
```

2. In `trends()` replace:

```js
    markers: [],
    ...over,
```

with:

```js
    markers: [],
    manual_truncated: false,  // G3-01 (D13)
    ...over,
```

3. After the `marker` helper add:

```js

/** G3-01 (D13): one hand entry of a channel's `manual`, `minutesAgo` before NOW. `retracted` is
 *  `{ reason, by?, minutesAgo }` for a withdrawn one. */
export function hand(entry, minutesAgo, value, { by = "hem.ayse", retracted = null } = {}) {
  return {
    entry, at: ago(minutesAgo * 60), value, by,
    retracted: retracted ? { reason: retracted.reason, by: retracted.by ?? by, at: ago(retracted.minutesAgo * 60) } : null,
  };
}
```

In `trendGeometry.test.js`, in the import from `./trendGeometry.js`, replace `bandRects, crisp, indexAtTime,` with `bandRects, crisp, handEntryOf, indexAtTime,` and `parsePoints, plotFrame,` with `parseManual, parsePoints, plotFrame,`. Then replace the file's last lines:

```js
    expect(parseMarkers([{ ts: "2026-10-19T09:00:00Z", kind: "alarm", label: "news2" }, { ts: "x", kind: "alarm" }])).toEqual([
      { ms: Date.parse("2026-10-19T09:00:00Z"), iso: "2026-10-19T09:00:00Z", kind: "alarm", label: "news2" },
    ]);
  });
});
```

with:

```js
    expect(parseMarkers([{ ts: "2026-10-19T09:00:00Z", kind: "alarm", label: "news2" }, { ts: "x", kind: "alarm" }])).toEqual([
      { ms: Date.parse("2026-10-19T09:00:00Z"), iso: "2026-10-19T09:00:00Z", kind: "alarm", label: "news2" },
    ]);
  });
});

// G3-01 (D13): a channel's hand entries, and which drawn reading is one.
describe("the hand entries", () => {
  it("are read with their withdrawal, the unreadable dropped, and found by instant and value", () => {
    const manual = parseManual([
      { entry: 41, at: "2026-10-08T09:00:00+00:00", value: 132, by: "hem.ayse", retracted: null },
      { entry: 42, at: "2026-10-08T09:30:00+00:00", value: 182, by: "hem.ayse",
        retracted: { reason: "yanlış hasta seçilmişti", by: "hem.ayse", at: "2026-10-08T09:40:00+00:00" } },
      { entry: 43, at: "not a time", value: 1, by: "", retracted: null },
      { entry: 44, at: "2026-10-08T09:00:00+00:00", value: "x", by: "", retracted: null },
    ]);
    expect(manual.map((m) => m.entry)).toEqual([41, 42]);
    expect(manual[1].retracted).toEqual({ reason: "yanlış hasta seçilmişti", by: "hem.ayse", ms: Date.parse("2026-10-08T09:40:00Z") });
    expect(handEntryOf(manual, { ms: Date.parse("2026-10-08T09:00:00Z"), value: 132 })?.entry).toBe(41);
    expect(handEntryOf(manual, { ms: Date.parse("2026-10-08T09:00:00Z"), value: 131 })).toBeNull();
    expect(handEntryOf(manual, { ms: Date.parse("2026-10-08T09:30:00Z"), value: 182 })).toBeNull();   // withdrawn
    expect(parseManual(undefined)).toEqual([]);
  });
});
```

In `TrendCard.test.jsx` replace `import { fireEvent, render, screen } from "@testing-library/react";` with `import { cleanup, fireEvent, render, screen } from "@testing-library/react";` and `import { BANDS, channel, point, trends } from "./trends.testutil.js";` with `import { BANDS, channel, hand, point, trends } from "./trends.testutil.js";`. Then replace its last lines:

```js
    expect([null, undefined, Number.NaN].map(deltaText)).toEqual([null, null, null]);
  });
});
```

with:

```js
    expect([null, undefined, Number.NaN].map(deltaText)).toEqual([null, null, null]);
  });

  // G3-01 (D1, X13): a latest value typed in by hand says so, from the trends answer's own `manual`.
  it("says «əl ilə» beside a latest value entered by hand, and nothing beside a device's", () => {
    show(HR, [channel("heart_rate", [point(5, 72, 0)], { latest: latest({ value: 72 }), manual: [hand(41, 5, 72)] })]);
    expect(screen.getByText("əl ilə")).toBeInTheDocument();
    cleanup();
    show(HR, [channel("heart_rate", [point(5, 72, 0)], { latest: latest({ value: 72 }), manual: [hand(41, 5, 73)] })]);
    expect(screen.queryByText("əl ilə")).toBeNull();
  });
});
```

In `TrendModal.test.jsx`:

1. Replace `import { answering, channel, marker, point, trends } from "./trends.testutil.js";` with `import { answering, channel, hand, marker, point, trends } from "./trends.testutil.js";`.
2. Replace:

```js
function Host({ id, bed, onClose }) {
  const [n, setN] = useState(0);
  bump = () => setN((v) => v + 1);
  return <TrendModal card={card(id)} patient={{ ...PATIENT, measuredAt: { heart_rate: `r${n}` } }} bed={bed} onClose={onClose} />;
}
```

with:

```js
function Host({ id, bed, onClose, ...rest }) {
  const [n, setN] = useState(0);
  bump = () => setN((v) => v + 1);
  return <TrendModal card={card(id)} patient={{ ...PATIENT, measuredAt: { heart_rate: `r${n}` } }} bed={bed} onClose={onClose} {...rest} />;
}
```

3. Replace:

```js
async function open(id = "heart_rate", answer = HR_ANSWER, { bed = "REA-01 · 2", onClose = () => {} } = {}) {
  vi.setSystemTime(NOW);
  const mounted = await mount(<Host id={id} bed={bed} onClose={onClose} />, {
```

with:

```js
async function open(id = "heart_rate", answer = HR_ANSWER, { bed = "REA-01 · 2", onClose = () => {}, ...rest } = {}) {
  vi.setSystemTime(NOW);
  const mounted = await mount(<Host id={id} bed={bed} onClose={onClose} {...rest} />, {
```

4. At the end of the file add:

```js

// G3-01 (D1, D13, X13): what was typed by hand, and what was withdrawn as «hatalı giriş».
const BY_HAND = answering((pid, hours) => trends(pid, [channel("heart_rate", [point(120, 84, 0), point(60, 132, 3)], {
  manual: [hand(41, 60, 132), hand(42, 30, 182, { retracted: { reason: "yanlış hasta seçilmişti", minutesAgo: 20 } })],
})], { hours }));
const named = (name) => screen.getByRole("dialog", { name });

describe("the big chart, by hand", () => {
  it("says «əl ilə» on a hand reading in the readout and the table, and lists a withdrawn one struck through", async () => {
    await open("heart_rate", BY_HAND);
    fireEvent.mouseMove(chart(), { clientX: xOf(60) });
    expect(readout().textContent).toBe(`${hhmm(NOW - 3_600_000)} · 132 /dəq · əl ilə · NEWS2 +3`);
    await choose("Cədvəl");
    const typed = dialog().querySelector(`tr[data-ts="${point(60, 0)[0]}"]`);
    expect(typed).toHaveTextContent("əl ilə");
    expect(within(typed).queryByRole("button")).toBeNull();          // no withdrawal without the right
    const withdrawn = dialog().querySelector('tr[data-withdrawn="42"]');
    expect(withdrawn.querySelector("s")).toHaveTextContent("182");
    expect(withdrawn).toHaveTextContent(`səhv qeyd — yanlış hasta seçilmişti · hem.ayse · ${hhmm(NOW - 20 * 60_000)}`);
  });

  it("draws a withdrawn value dimmed and crossed, and says what the cross means", async () => {
    await open("heart_rate", BY_HAND);
    expect(dialog().querySelector('[data-withdrawn="42"]')).not.toBeNull();
    expect(dialog()).toHaveTextContent("Üstüxətli nöqtə: səhv qeyd — bala daxil edilmir; səbəbi cədvəldədir.");
  });

  it("offers «Səhv qeyd» on a hand row to a clinical.chart holder, withdraws through the host and reads again", async () => {
    const onRetract = vi.fn(() => Promise.resolve({ retracted: 41, code: "heart_rate", alerts: [] }));
    const { api } = await open("heart_rate", BY_HAND, { canRetract: true, onRetract });
    await choose("Cədvəl");
    const reads = api.patientTrends.mock.calls.length;
    const typed = named("REA-01 · 2 · Ayşe Sentetik · Nəbz").querySelector(`tr[data-ts="${point(60, 0)[0]}"]`);
    await act(async () => { fireEvent.click(within(typed).getByRole("button", { name: "Səhv qeyd" })); await settle(); });
    const retract = named("Səhv qeyd · REA-01 · 2");
    expect(retract).toHaveTextContent("Nəbz: 132 /dəq · ölçmə");
    fireEvent.change(within(retract).getByRole("textbox"), { target: { value: "monitör başka hastadaydı" } });
    // The dialog ignores a press for its first RETRACT_ARM_MS (real timers in this file): wait it out.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 650)); });
    await act(async () => { fireEvent.click(within(retract).getByRole("button", { name: "Səhv qeyd kimi işarələ" })); await settle(); });
    expect(onRetract).toHaveBeenCalledWith(41, "monitör başka hastadaydı");
    expect(api.patientTrends.mock.calls.length).toBeGreaterThan(reads);
  });
});
```

- [ ] **Step 2: Red**

```bash
cd /c/tmp/g3-vitals/dashboard && ./node_modules/.bin/vitest run src/live/screens/patient/trends 2>&1 | tail -10
```

Expected:
- `trendGeometry.test.js`: `parseManual is not a function`;
- `TrendCard.test.jsx`: the new test (`Unable to find … «əl ilə»`);
- `TrendModal.test.jsx`: the three new tests.
The rest stays green: `manual: []` and `manual_truncated: false` change nothing an existing test reads.

- [ ] **Step 3: The reading of `manual`**

In `trendGeometry.js`, after the whole `parseMarkers` function add:

```js

/** G3-01 (D13): a channel's hand entries (`manual`) as `{ entry, ms, iso, value, by, retracted }`, in their order;
 *  `retracted` is null or `{ reason, by, ms }` (ms null when its instant cannot be read). An entry whose instant,
 *  value or id cannot be read is dropped: it could be drawn nowhere and listed as nothing true. */
export function parseManual(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((m) => {
    const ms = Date.parse(m?.at);
    if (!Number.isFinite(ms) || typeof m?.value !== "number" || !Number.isFinite(m.value) || !Number.isInteger(m?.entry)) return [];
    const r = m.retracted && typeof m.retracted === "object" ? m.retracted : null;
    const rms = r ? Date.parse(r.at) : Number.NaN;
    return [{
      entry: m.entry, ms, iso: m.at, value: m.value, by: String(m.by ?? ""),
      retracted: r ? { reason: String(r.reason ?? ""), by: String(r.by ?? ""), ms: Number.isFinite(rms) ? rms : null } : null,
    }];
  });
}

/** The hand entry a drawn reading is — not withdrawn, at its instant, with its value — or null. The points carry
 *  no other link to the trail: a device reading at the very same millisecond with the very same number would be
 *  taken for one, and the door stamps a hand entry with its own instant (the server's clock, or the typed minute). */
export function handEntryOf(manual, point) {
  if (!point || !Array.isArray(manual)) return null;
  return manual.find((m) => m.retracted === null && m.ms === point.ms && m.value === point.value) ?? null;
}
```

- [ ] **Step 4: The card**

In `TrendCard.jsx` replace `import { parsePoints, validWindow } from "./trendGeometry.js";` with `import { handEntryOf, parseManual, parsePoints, validWindow } from "./trendGeometry.js";`. In `Reading` replace:

```jsx
  const age = ageText(t, latest.ts, nowMs);
```

with:

```jsx
  const age = ageText(t, latest.ts, nowMs);
  // G3-01 (D1, X13): a latest value typed in by hand says so — found in the trends answer's own `manual`.
  const byHand = handEntryOf(parseManual(channel?.manual), { ms: Date.parse(latest.ts), value: latest.value });
```

and replace:

```jsx
      <small className="text-11 font-semibold text-mute">{t(series.unitKey)}</small>
```

with:

```jsx
      <small className="text-11 font-semibold text-mute">{t(series.unitKey)}</small>
      {byHand ? <>{" "}<Tag>{t("olcum.hand")}</Tag></> : null}
```

- [ ] **Step 5: The big chart's crossed value**

In `TrendChart.jsx`:

1. In the header comment, after the line `//   * on the big chart, the value and time labels, and ▲ (alarm, \`--crit\`) and ◆ (antibiotic,` and the line after it, add:

```
//   * on the big chart, a hand entry withdrawn as «hatalı giriş» where it was typed, dimmed and crossed — in no
//     score and on no line, and the value axis holds it (G3-01, D13, X16). The mini chart draws the engine's only.
```

2. After `const HAIRLINE = 1;` add:

```js
// G3-01 (D13): a withdrawn hand entry, on the big chart only — dimmed, a ring with a cross through it.
const WITHDRAWN_OPACITY = 0.45;
const CROSS_HALF = 4.5;
```

3. Replace:

```js
  const values = series.flatMap((s) => s.points.map((p) => p.value));
```

with:

```js
  // G3-01 (D13): the big chart draws a withdrawn value where it was typed, so its axis holds it too.
  const values = series.flatMap((s) => [...s.points.map((p) => p.value), ...(big ? (s.withdrawn ?? []).map((m) => m.value) : [])]);
```

4. Replace:

```jsx
                  stroke="currentColor" strokeWidth={s.hollow ? LINE_WIDTH : 0}
                />
              ))}
            </g>
```

with:

```jsx
                  stroke="currentColor" strokeWidth={s.hollow ? LINE_WIDTH : 0}
                />
              ))}
              {big ? (s.withdrawn ?? []).map((m) => {
                const cx = x(m.ms);
                const cy = y(m.value);
                return (
                  <g key={`withdrawn-${m.entry}`} data-withdrawn={m.entry} opacity={WITHDRAWN_OPACITY}>
                    <circle cx={cx} cy={cy} r={DOT_RADIUS.big} fill="none" stroke="currentColor" strokeWidth={LINE_WIDTH} />
                    <path
                      d={`M${cx - CROSS_HALF},${cy - CROSS_HALF}L${cx + CROSS_HALF},${cy + CROSS_HALF}M${cx - CROSS_HALF},${cy + CROSS_HALF}L${cx + CROSS_HALF},${cy - CROSS_HALF}`}
                      stroke="currentColor" strokeWidth={LINE_WIDTH}
                    />
                  </g>
                );
              }) : null}
            </g>
```

- [ ] **Step 6: The table**

In `TrendTable.jsx`:

1. At the end of the header comment add:

```
//
// G3-01 (D13): a reading typed in by hand says «elle», and to a `clinical.chart` holder offers «Hatalı giriş»
// (the dialog's host opens it, `onWithdraw`). A withdrawn hand entry is a row of its own, struck through, with its
// reason, who and when — it is in no score, so it has no points and is on no line.
```

2. Replace `import { Table } from "../../../ui/index.js";` with `import { Button, Table } from "../../../ui/index.js";`, and after `import { cardTitle } from "./cards.js";` add `import { handEntryOf } from "./trendGeometry.js";`.

3. In `rowsOf` replace:

```js
        ? [{ ms: p.ms, rank: i, order: j, key: keyed(`${s.key}-${p.iso}`), series: s, p }]
        : []
    ))),
```

with:

```js
        ? [{ ms: p.ms, rank: i, order: j, key: keyed(`${s.key}-${p.iso}`), series: s, p, hand: handEntryOf(series[i]?.manual, p) }]
        : []
    ))),
    // G3-01 (D13): after the readings of its instant, each withdrawn hand entry of the series.
    ...card.series.flatMap((s, i) => (series[i]?.withdrawn ?? []).map((m) => (
      { ms: m.ms, rank: i, order: -1, key: keyed(`${s.key}-withdrawn-${m.entry}`), series: s, withdrawn: m }))),
```

4. Replace `export function TrendTable({ card, channels, series, markers, hours }) {` with `export function TrendTable({ card, channels, series, markers, hours, canRetract = false, onWithdraw }) {`.

5. Replace:

```jsx
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
```

with:

```jsx
        ) : row.withdrawn ? (
          <tr key={row.key} data-withdrawn={row.withdrawn.entry} data-series={row.series.key} className="text-mute">
            <th scope="row" className="font-data font-semibold">{whenText(row.ms, hours)}</th>
            {two ? <td>{t(row.series.labelKey)}</td> : null}
            <td className="font-data"><s>{row.withdrawn.value}</s></td>
            <td>{t(row.series.unitKey)}</td>
            <td />
            <td>
              {t("olcum.retracted", {
                reason: row.withdrawn.retracted.reason, who: row.withdrawn.retracted.by,
                time: row.withdrawn.retracted.ms === null ? "—" : whenText(row.withdrawn.retracted.ms, hours),
              })}
            </td>
          </tr>
        ) : (
          <tr key={row.key} data-ts={row.p.iso} data-value={row.p.value} data-series={row.series.key}>
            <th scope="row" className="font-data font-semibold">{whenText(row.ms, hours)}</th>
            {two ? <td>{t(row.series.labelKey)}</td> : null}
            <td className="font-data font-bold">{row.p.value}</td>
            <td>{t(row.series.unitKey)}</td>
            <PointsCell points={row.p.points} news2={Array.isArray(channels[row.series.key]?.bands?.news2)} />
            <td>
              {row.hand ? <span className="font-semibold">{t("olcum.hand")}</span> : null}
              {row.hand && canRetract ? (
                <Button size="sm" variant="ghost" icon="x" className="ml-2" onClick={() => onWithdraw(row.series, row.hand)}>
                  {t("olcum.retract")}
                </Button>
              ) : null}
            </td>
          </tr>
        )))}
```

- [ ] **Step 7: The dialog**

In `TrendModal.jsx`:

1. At the end of the header comment add:

```
//
// G3-01 (D1, D13): a reading typed in by hand says «elle» in the readout and the table; a withdrawn one is drawn
// crossed (TrendChart) and listed struck through (TrendTable), with a line under the chart saying what the cross
// means. A `clinical.chart` holder (`canRetract`, the box's) withdraws a hand reading from the table: the shared
// dialog (common/RetractDialog.jsx) over this one, the write through the box's `onRetract`, then this window is
// read again — the withdrawal changed the record the chart draws.
```

2. Replace `import { hhmm } from "../../../i18n/dates.js";` with `import { dayStamp, hhmm } from "../../../i18n/dates.js";`. After `import { nameOf } from "../../common/BoardState.jsx";` add `import { RetractDialog } from "../../common/RetractDialog.jsx";`. Replace `import { indexAtTime, marksAtTime, parseMarkers, parsePoints, validWindow } from "./trendGeometry.js";` with `import { handEntryOf, indexAtTime, marksAtTime, parseManual, parseMarkers, parsePoints, validWindow } from "./trendGeometry.js";`.

3. In `readoutOf` replace:

```js
  const points = readings[0] === null ? null : pointsBeside(t, at.points);   // no value, no score
  return [whenText(at.ms, hours), `${parts.join(" · ")}${unit}`, ...(points ? [points] : []), ...marks.map((m) => markBeside(t, m, at.ms, hours))].join(" · ");
```

with:

```js
  const points = readings[0] === null ? null : pointsBeside(t, at.points);   // no value, no score
  // G3-01 (D1, X13): a reading typed in by hand says so, after its value.
  const byHand = readings[0] !== null && handEntryOf(series[0].manual, at) ? [t("olcum.hand")] : [];
  return [whenText(at.ms, hours), `${parts.join(" · ")}${unit}`, ...byHand, ...(points ? [points] : []),
    ...marks.map((m) => markBeside(t, m, at.ms, hours))].join(" · ");
```

4. Replace `export function TrendModal({ card, patient, bed, onClose }) {` with `export function TrendModal({ card, patient, bed, onClose, canRetract = false, onRetract }) {`.

5. Replace:

```js
  const [plotWidth, setPlotWidth] = useState(0);
```

with:

```js
  const [plotWidth, setPlotWidth] = useState(0);
  const [withdrawing, setWithdrawing] = useState(null);   // G3-01: { series, entry } whose «hatalı giriş» is open
```

6. Replace:

```js
    const drawn = card.series.map((s) => ({ key: s.key, color: s.color, hollow: s.hollow, points: parsePoints(byKey[s.key]?.points) }));
```

with:

```js
    // G3-01 (D13): each series' hand entries, and the withdrawn ones the big chart draws crossed.
    const drawn = card.series.map((s) => {
      const manual = parseManual(byKey[s.key]?.manual);
      return {
        key: s.key, color: s.color, hollow: s.hollow, points: parsePoints(byKey[s.key]?.points),
        manual, withdrawn: manual.filter((m) => m.retracted !== null),
      };
    });
```

7. Replace:

```js
  const truncated = trends.data?.markers_truncated === true;
```

with:

```js
  const truncated = trends.data?.markers_truncated === true;
  const anyWithdrawn = series.some((s) => s.withdrawn.length > 0);
```

8. Replace:

```jsx
          <TrendLegend card={card} channels={channels} source={trends.data.bands_source} truncated={truncated} />
```

with:

```jsx
          <TrendLegend card={card} channels={channels} source={trends.data.bands_source} truncated={truncated} />
          {anyWithdrawn ? <p data-withdrawn-legend="" className="m-0 mt-1 text-11 text-mute">{t("olcum.legendWithdrawn")}</p> : null}
```

9. Replace:

```jsx
          <TrendTable card={card} channels={channels} series={series} markers={markers} hours={hours} />
```

with:

```jsx
          <TrendTable card={card} channels={channels} series={series} markers={markers} hours={hours}
            canRetract={canRetract && typeof onRetract === "function"}
            onWithdraw={(s, entry) => setWithdrawing({ series: s, entry })} />
```

10. Replace:

```jsx
      <Announce text={cursor?.how === "key" && readout ? readout : ""} />
    </Modal>
```

with:

```jsx
      <Announce text={cursor?.how === "key" && readout ? readout : ""} />
      {withdrawing ? (
        <RetractDialog
          bed={bed}
          what={{
            label: t(withdrawing.series.labelKey), value: `${withdrawing.entry.value} ${t(withdrawing.series.unitKey)}`,
            time: dayStamp(withdrawing.entry.ms, Date.now()),
          }}
          onRetract={(reason) => onRetract(withdrawing.entry.entry, reason)}
          onDone={() => trends.reload()}
          onClose={() => setWithdrawing(null)}
        />
      ) : null}
    </Modal>
```

In `TrendsBox.jsx`:

1. After `import { useSession } from "../../../session/SessionProvider.jsx";` add `import { useBoard } from "../../../data/BoardProvider.jsx"; // G3-01: «hatalı giriş» from the big chart's table`.
2. Replace:

```js
  const { user } = useSession();
```

with:

```js
  const { user } = useSession();
  const board = useBoard();
  // G3-01 (D13, D14): a clinical.chart holder withdraws a hand entry from the big chart's table.
  const canRetract = user?.perms?.includes("clinical.chart") ?? false;
```

3. Replace:

```jsx
      {card ? <TrendModal card={card} patient={patient} bed={bed} onClose={() => setOpen(null)} /> : null}
```

with:

```jsx
      {card ? (
        <TrendModal card={card} patient={patient} bed={bed} onClose={() => setOpen(null)} canRetract={canRetract}
          onRetract={(entry, reason) => board.store.retract(patient.patient_id, entry, reason)} />
      ) : null}
```

- [ ] **Step 8: Green, then the patient screen and the sweep**

```bash
cd /c/tmp/g3-vitals/dashboard && ./node_modules/.bin/vitest run src/live/screens/patient src/live/rawKeys.test.jsx 2>&1 | tail -8
```

Expected:
- every trends file passes: `trendGeometry.test.js` +1, `TrendCard.test.jsx` +1, `TrendModal.test.jsx` +3;
- `PatientScreen.test.jsx` and `rawKeys.test.jsx` stay green.

The sweep's trend fixture carries no `manual`, so it draws none of the new strings. Its key scan still reads them in the sources.

- [ ] **Step 9: Line ends and commit**

```bash
cd /c/tmp/g3-vitals/dashboard/src/live/screens/patient/trends && for f in trendGeometry.js trendGeometry.test.js trends.testutil.js TrendCard.jsx TrendCard.test.jsx TrendChart.jsx TrendTable.jsx TrendModal.jsx TrendModal.test.jsx TrendsBox.jsx; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
cd /c/tmp/g3-vitals && T=dashboard/src/live/screens/patient/trends && git add -- $T/trendGeometry.js $T/trendGeometry.test.js $T/trends.testutil.js $T/TrendCard.jsx $T/TrendCard.test.jsx $T/TrendChart.jsx $T/TrendTable.jsx $T/TrendModal.jsx $T/TrendModal.test.jsx $T/TrendsBox.jsx
git status --short && git diff --cached --stat
git commit -m "feat(trends): «elle» on a hand reading, a withdrawn one crossed and struck through, «hatalı giriş» from the table (G3-01, D1, D13, X13, X16)" -m "<the red you saw, and the body>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: The Turkish guide and the roadmap row

**Files:**
- Modify: `docs/homunculus-rehber-TR.md`
- Modify: `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`

The guide is the user's living reference (memory: «living Turkish guide»), written in Turkish for the team. It names no patient and holds no value from a real ward.

- [ ] **Step 1: The guide's section**

In `docs/homunculus-rehber-TR.md`, replace:

```
- **Geri dönüş** yalnız ilk protokollü kabulden önce temizdir: sonrasında açık kabullerin kartları
  protokolle anahtarlıdır ve eski API onları eşleştiremez — geri dönüş ileri bir düzeltme demektir.

---

## 4. "Neden bunu kullanmıyoruz" köşesi
```

with:

```
- **Geri dönüş** yalnız ilk protokollü kabulden önce temizdir: sonrasında açık kabullerin kartları
  protokolle anahtarlıdır ve eski API onları eşleştiremez — geri dönüş ileri bir düzeltme demektir.

### 3.11 Yatak başı ölçüm ve «hatalı giriş» (Grup 3 · G3-01)

Hemşirenin yatak başında ölçtüğü vitaller artık elle girilir ve **gerçek motora** gider; eskiden
bunları HBYS akışı taşıyordu. Değer motora girdiği için NEWS2'yi motor hesaplar ve uyarı, cihazdan
gelen bir değerdeki gibi davranır: Alarmlar ekranı, hemşire bildirimi, onaylanmazsa hekime
yükseltme. Bu, servis için yenidir; ilk kurulumdan önce söylenir. Örneklerdeki değerler uydurmadır.

- **Ne girilir.** NEWS2'nin yedisi: solunum sayısı, SpO₂, ek oksijen, sistolik tansiyon, nabız,
  bilinç (ACVPU), ateş. Bir de isteğe bağlı MAP. Diyastolik yok: MAP okunduğu gibi girilir (arter
  hattı ya da monitörün NBP ortalaması).
- **İki giriş, tek form.**
  - «Yatak başı ölçüm» sayfası (`/olcum`, `clinical.chart` yetkisi; tablet ve telefon için): hasta
    seçilir, ad soyad ve doğum yılıyla kimlik onaylanır, form doldurulur. «Hayır» seçimi iptal eder
    ve sorumlu hemşireye bildirmeyi söyler.
  - Hasta ekranındaki «Ölçüm gir» aynı formu bir pencerede açar. Orada kimlik adımı yoktur, çünkü
    ekranın başlığı hastayı zaten söyler.
- **Boş kutu = ölçülmedi**, asla 0. En az bir değer yeter; eksikleri önizleme söyler («Kısmi skor:
  … girilmedi ya da güncel değil»). Yedisini birden zorlamak hemşireyi eski değeri yeniden yazmaya
  iterdi, motor da onu taze sanırdı.
- **Önce önizleme.** «Önizle», motorun NEWS2'sini hastanın bir kopyası üzerinde hesaplar ve hiçbir
  şey yazmaz (`POST /clinical/{id}/preview`). «Kaydet» yalnız tam olarak gönderilecek değerlerin
  önizlemesinde çıkar: bir kutu değişirse önizleme eskir. Puanı motor hesaplar, karar hekimindir.
- **Sınırlar klinik eşik değildir**, kayan bir haneyi yakalamak içindir:
  - solunum 0–80, SpO₂ 0–100, sistolik ve MAP 0–300, nabız 0–300 (tam sayı);
  - ateş 25–45 °C, bir ondalık («36,8» olur);
  - aynı formda MAP sistolikten küçük olmalı.

  Saat değiştirilmezse sunucunun saati yazılır. Değiştirilirse en çok 24 saat geriye gider, ileriye
  asla.
- **«Hatalı giriş».** Elle girilmiş bir değer «Kaydedildi» adımından ya da vital eğrisinin
  tablosundan, en az 10 karakterlik bir gerekçeyle geri alınır
  (`POST /clinical/{id}/entries/{entry}/retract`). Değer silinmez:
  - denetim kaydına bir `chart_retract` satırı düşer;
  - hastanın motor durumu kayıttan, o değer **hiç girilmemiş gibi** yeniden kurulur (NEWS2, SOFA,
    sepsis, antibiyotik saati, uyarılar), ve yeniden başlatmada da geri gelmez;
  - grafikte üstü çizili kalır; tabloda gerekçesiyle, kimin ve ne zaman geri aldığıyla durur.

  Onaylanmamış kritik bir uyarı kilitli kalır (G2-A1). Cihazdan gelen bir değer ve cihaz kimliği
  geri alma yapamaz.
- **«elle».** Elle girilen değeri «elle» diye işaretleyenler:
  - trend kartı;
  - büyük grafiğin okuması;
  - tablo.

  Hasta ekranının «Ölçülen değerler» kutusu ve sayfanın listesi işaretlemez: pano değerin
  kaynağını taşımaz. Listedeki «son ölçüm» hangi kaynaktan olursa olsun son NEWS2 girdisidir.
- **Geri dönüş**: eski imajlara dönülür, göç yoktur. Ama eski API `chart_retract`'ı bilmez:
  geri alınmış değerler eski sürümde yeniden sayılır. Geri dönüş bloğu bu yüzden önce kaç geri
  alma olduğunu basar.

---

## 4. "Neden bunu kullanmıyoruz" köşesi
```

- [ ] **Step 2: The roadmap row**

In `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`, in the G3-01 row of «Grup 3 · durum», replace the Durum cell. It begins `Tasarım onaylandı (2026-11-02` and ends `O5 az/ru/en okuma |`. Replace it with:

```
Tasarım onaylandı (2026-11-02) · plan: [2026-11-02](2026-11-02-g3-yatak-basi-olcum.md) · uygulandı, dal `feat/g3-yatak-basi-olcum` · kapılar ve yerel yürüyüş: Task 18 · **VM'de değil** — B1d'nin çıkışından sonra, göç yok. **Açık:** O1 NEWS2'nin yaş ve gebelik sınırı (kasada kaynak yok) · O3 `audit.patient_id` dizini · O4 geri alınan değerin kilidi yeniden başlatmada · O5 az/ru/en okuma · O6 çok büyük bir hastada geri almanın okuma sınırı. O2 kapandı (birimler trendlerin `_UNITS`'i, X6) |
```

- [ ] **Step 3: Commit**

```bash
cd /c/tmp/g3-vitals && for f in docs/homunculus-rehber-TR.md docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md; do printf '%s ' "$f"; /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys;b=open(sys.argv[1],'rb').read();print(b.count(b'\r\n'), b.count(b'\n'))" "$f"; done
git add -- docs/homunculus-rehber-TR.md docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md
git status --short && git diff --cached --stat
git commit -m "docs: the guide's §3.11 bedside measurement and «hatalı giriş»; the G3-01 roadmap row (G3-01)" -m "<the body>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: The gates, the final review and the local walk

**Files:** none changed, unless a gate or the walk finds something. A fix is its own commit, with the red that showed it.

- [ ] **Step 1: The engine, no database**

```bash
cd /c/tmp/g3-vitals/homunculus-engine && PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q -p no:warnings tests --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -3
```

Expected: **3236 passed, 1111 skipped**. That is the plan's arithmetic from the baseline (3152 / 1110):
- the door +39;
- the preview +7;
- the rebuild +14;
- the withdrawal +16, and the shadow test +1;
- trends +5;
- the stores +2, with 1 skipped without the database.

The gate's own number is the record. A difference is explained in the report.

- [ ] **Step 2: The trail reads on Postgres**

```bash
docker ps --format '{{.Names}}' | grep -x homunculus-test-pg-56
cd /c/tmp/g3-vitals/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_bedside_trail_stores.py tests/test_bedside_retract.py tests/test_trends_manual.py 2>&1 | tail -3
```

Expected: the container is listed, and all pass with none skipped. If the container is missing, say so and stop: do not start one without the controller.

- [ ] **Step 3: The dashboard and the build**

```bash
cd /c/tmp/g3-vitals/dashboard && ./node_modules/.bin/vitest run 2>&1 | tail -5
cd /c/tmp/g3-vitals/dashboard && ./node_modules/.bin/vite build 2>&1 | tail -6
```

Expected:
- the tests: **123 files, 3370 tests**, all passing. That is the plan's arithmetic from the baseline (118 / 3314): five new files with 36 tests (13 + 11 + 5 + 2 + 5), and 20 tests more in existing files (1 + 1 + 9 + 2 + 2 + 1 + 1 + 3).
- the build: the `precache  N entries` line with Task 0's N, and no `larger than 500 kB`.

- [ ] **Step 4: The final review (controller)**

The controller dispatches one reviewer over the whole branch (`git diff a0e3f3b..HEAD`). It gets this plan's departures X1–X17 and the spec. It checks three things:
1. **Spec coverage**: every D1–D16 is either done or a named departure.
2. **The clinical rule**: no score, band or threshold in the browser; the slip bounds only.
3. **The trail and the record**: the withdrawal's order (X4), the restart's skip, no patient data in the tree.

Its findings are fixed in their own commits, and Steps 1–3 run again.

- [ ] **Step 5: The local walk (controller)**

The local stack's container names are fixed (`homunculus-*`, `deploy/local/docker-compose.yml`), so one stack runs on this machine at a time. Steps:
1. **Check for another stack.** If `docker ps` lists `homunculus-api`, another session's stack is up. Find its owner (ListAgents) and wait for it.
2. **Bring up the stack.** Build this branch with the walk override of earlier slices: `/c/tmp/g115plan/stack/compose.g115.yml` and a copy of its `local.env` with `WEB_PORT=18100`, project `-p g3v`.
3. **Use only synthetic data:** one patient admitted through Hasta Kabul, the accounts `hem.ayse` and `dr.elif`.

The walk is the spec's §6, in a headless Chrome in both themes, at 390 px and 1440 px:
1. On `/olcum`, enter a set that scores NEWS2 ≥ 5: RR 26, SpO₂ 91, on oxygen, the others normal. The preview says the score; save. The alert appears on Alarmlar, and the nurse's notification fires.
2. Withdraw the value that drove it, from the saved step. The alert clears. An unacknowledged critical one stays latched. The trend table shows the value struck through, with its reason.
3. Restart the API (`docker compose -p g3v restart api`). The withdrawn value stays out; the trends still show it struck through.
4. Chart a suspected infection, enter a MAP that turns sepsis on, then withdraw the MAP. No antibiotic clock remains.

Each step is one line of the report: what was seen, and a screenshot kept in the scratchpad, never in the repo. Bring the stack down without `-v`; the user may ask to see it.

- [ ] **Step 6: The record**

Fold the gates' and the walk's results into this plan's «Open items» and the roadmap row: replace «kapılar ve yerel yürüyüş: Task 18» with the counts and «yerel yürüyüş geçti (tarih)». Commit both with a pathspec. Then hand the branch to the user for «main'e al». The VM blocks are written after B1d's deploy is accepted (Deploy notes).

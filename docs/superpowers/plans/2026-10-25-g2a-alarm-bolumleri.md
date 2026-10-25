# Group 2 · G2-A1 — an alert ends when its rule stops firing; a critical nobody acknowledged latches (O17) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An alert lives exactly as long as its rule fires. The engine's active alerts are the kinds the last evaluation produced; a kind it did not produce ends its episode on that reading — no quiet time, no hysteresis. A **critical** alert nobody acknowledged is the one exception: it stays on every surface as «keçdi · təsdiqlənməyib» (tr «geçti · onaylanmadı»), silent and unescalated, until a clinician acknowledges it, which removes it. A kind that fires again is a new episode — a new first-seen, no inherited acknowledgement, a new nurse notification, a new ▲ on the trend charts — live, after a restart, and in the alarm-quality report alike; its escalation clock goes on if it returns within the escalation delay of an unanswered end, and the doctor is paged once per such chain (X13, X14).

**Architecture:** The engine (`pipeline.py`) replaces each patient's bucket with every evaluation. The antibiotic clock's anchor is set at the first recognition (sepsis or septic shock), kept through a sepsis that merely stops, dropped only when suspected infection is charted absent, and restored if the absence is corrected within `ANCHOR_RESTORE_S`; its findings are emitted only while a recognition kind fires (X1, X9, X12). The API gains one lifecycle hook, `api/alert_lifecycle.py` `sync_alerts(engine, store, patient_id, now)`, run right after every `engine.ingest` — at `/ingest`, at `/clinical` after each entry, and in `rehydrate` after each `ingest`/`chart` row: it latches an unacknowledged critical that stopped firing in `AckStore.resolved` (with its first-seen), prunes the ended episodes' ack, first-seen, escalation flag, page and clock from the store's own firing ∪ latched keys, remembers an unanswered episode's escalation chain for the escalation delay, and returns `Cleared` records that the doors audit as the new event `alert_cleared`; `/ack` on a latched alert removes it (`acknowledge_latched`). The escalation cycle measures the chain's clock (`AckStore.clock_from`) and pages once per chain (`AckStore.paged`). The board lists latched alerts after the firing ones with `resolved_at` and computes `risk` from the firing ones only; `alarm_quality` closes an episode at its end. The dashboard maps `resolved_at` to status `RESOLVED`, shows the badge on the alarms row, the bed card, the bed list, the bell and the patient screen, sorts a firing alarm before a RESOLVED one, stops the sound and raises no new notification at resolve (`signals.js`), and keys and tags each notification by episode. Deploy order: web no later than api (O14).

**Tech Stack:** Python 3.12 (and a 3.14 check), FastAPI, pytest; React 18, Vite, Vitest + Testing Library (`render`, `screen`, `within`; no user-event).

**Spec (authoritative):** `docs/superpowers/specs/2026-10-25-g2a-alarm-bolumleri-design.md` (D1–D13, §3–§7; decided with the user 2026-10-25: (1) critical alerts latch until acknowledged, every other severity clears with its rule; (2) clearing is immediate). Where the code made the spec's letter unsafe, impossible or merely unspecified, this plan departs from it; every departure is in the table below with its reason and its test. **X1–X8 are the planner's (the plan's first version, `e840d71`). X9 is the user's decision of 2026-10-25 after the Task 1 review; X10 is the Task 5 review's; X11 is the controller's (Task 7); X12–X14 are the final whole-branch review's, adopted by the controller (2026-10-25).** X9 and X12 together replace X1's anchor rule.

**How the numbers in this plan were obtained.** The plan's first version (`e840d71`) was written by implementing every task in a scratch worktree from `c66a615` and replaying its own blocks onto `c66a615` in a second one. The branch then implemented it task by task — Tasks 1–6 landed byte for byte as written — and the reviews added commits; **this version is the branch**. Each task names the commits it is and folds its review commits into its own blocks (a review commit that changed another task's file is folded into the task whose behaviour it changed, and that task edits the file again). This version was replayed onto `c66a615` in a `git archive` export (no worktree, no git writes): every Edit and Write applied in order, every command of Tasks 0–7 run as written except the commit blocks (the commits are the branch's own), every red, green, count and line-end figure below is what that replay printed. The export's tree equals the branch at `9240dc2` in all 46 files the slice touches — the roadmap row's `<range>` filled as Task 6 says. **In the export the four tests that need a git checkout fail** (`test_infinity_release.py` ×3, `test_infinity_transport.py` ×1: they build a release from git); every engine count below is a checkout's — the export's passed + 4 — and Task 0's baseline is the checkout's own. The reds recorded in the branch's commit bodies are quoted in each task's "Done on the branch" paragraph; the reds in the steps are the replay's, against the state the step is in. Task 7's acceptance ran against the engine's dev server from the export at `9240dc2` (X11). The code is kept beside the per-task files as `/c/tmp/homunculus-plans/g2a-o17/reference.patch` (`git diff c66a615 9240dc2`, the plan file excluded) — a cross-check, not the authority: build from the tasks.

---

## What the code says that the spec did not — departures (read before Task 1)

| # | Spec | Code at `c66a615` / what was found | This plan |
|---|---|---|---|
| X1 | D9: "When `"sepsis"` leaves the firing set, `Engine._recognized_at[pid]` is deleted"; §4: "`_recognized_at` reset when `"sepsis"` is absent … and was present before" | The anchor is set by **either** recognition kind: `_RECOGNITION_KINDS = {"sepsis", "septic_shock"}` (`pipeline.py:17`, `:64–67`). `sepsis` is a SOFA **rise** of ≥ 2 over the charted baseline (`rules/septic_shock.py:100–139`); `septic_shock` is a pressor + lactate > 2 + adequate fluid (`:59–75`) and does not need it. A baseline SOFA charted during shock takes `sepsis` away while `septic_shock` still fires. The letter deletes the anchor there, and the same evaluation re-anchors it at *now*: an `antibiotic_overdue` (critical) turns into "antibiotic_due — 60 min remaining" in the middle of septic shock. **Unsafe as written.** | Both recognition kinds count: while either fires the anchor stays. Task 1, `test_the_antibiotic_clock_keeps_its_anchor_while_septic_shock_fires_without_the_sepsis_criterion` — fails under the letter (`1 failed, 9 passed` by a mutant while planning). **The first version's drop rule ("dropped when no recognition kind fires") is superseded by X9 and X12.** |
| X2 | D3: `AckStore.resolved`; D4: "the hook … computes the firing set, moves unacked criticals that dropped out into `resolved` …"; §4: "`prune(live_keys)` also prunes `resolved` keys that are firing again"; D7: "`sync_alerts(…, audit=False)`" | When the hook runs, the engine has already replaced its bucket (D1): which kinds dropped, and what a dropped alert said (the latch must show it), are gone from the engine. And `prune(live_keys)` with live = firing ∪ latched cannot tell a latched key that fires again from one that does not, nor keep a latched key's first-seen while dropping its escalation flag (D8). | `AckStore.firing` — what the hook last saw firing per (patient, kind) — is how it knows what dropped and with what text; `AckStore.prune(live_keys, firing_keys=None, now=None)` keeps acks, first-seen, the page and the clock for live keys, escalation for firing keys only, and drops a latch whose kind fires again. Since the Task 2 review (`5ea2df0`) and X14 (`46a282d`) the hook prunes from the store's own firing ∪ latched keys, so a skipped hook cannot make another patient's sync drop an ack early, and a row no longer walks the ward. The hook never writes audit: it returns `Cleared` records, the doors audit them, the replay ignores them — D7's `audit=False` by construction. Tasks 2, 4. |
| X3 | §5 lists the tests by file (`test_notify.py`, `test_escalation*`); the brief's order is engine → hook → doors → board/rehydrate/alarm_quality → dashboard | `Notifier` and `escalate()` do not change their contract: what changes is what the doors hand them. A re-fire's second notification and a latched alert that never escalates are reachable only through the doors. And the replay must agree with the doors at every commit, or a restart between two tasks rebuilds a different board. | **1 engine · 2 hook + store · 3 the readers (board payload, alarm-quality closes) · 4 the writers (doors) with the replay, in one commit · 5 dashboard · 6 docs · 7 gates.** The notifier tests are in `test_alert_lifecycle.py` and the API files; the escalation tests are in `test_api_ack.py`; `test_notify.py` and `test_escalation.py` are unchanged and still run (Task 2's neighbours). |
| X4 | D12: "`alarm_quality.build_episodes` closes an episode at its `alert_cleared` row" | A latched critical writes **two** `alert_cleared` rows: `resolved` when its rule stops, then `acked_after_resolve` with the `ack` that removes it. Closed at the first, the acknowledgement finds no open episode: an answered alarm counts as ignored. | An episode ends at its `alert_cleared` row unless that row is `resolved` for a `critical` the episode has no answer for — then it stays open, and ends at `acked_after_resolve`. Since the Task 3 review (`4982a5e`) the `acked_after_resolve` row is itself the answer (the report does not hang on which of the two rows lands first), and every `resolved` row moves `resolved_at`, so a critical that fired again while latched reports its last stop, as the board does. `Episode` gains `resolved_at` and `ended_at`; the rates are unchanged (O11). Task 3. |
| X5 | D12: the legend "▲ ilk tespit" becomes "▲ uyarının başladığı an" ×4 | The legend's text is `patient.trendsLegendAlarm` = tr "alarmın ilk tespiti", az "siqnalın ilk aşkarlanması"; the ▲ itself is labelled `trendsMarkerAlarm` = tr "alarm", az "siqnal" in the same legend. "uyarı" would put a second word for the same thing beside the mark. | tr «alarmın başladığı an», az «siqnalın başladığı an», ru «момент начала тревоги», en «when an alarm began». `TrendModal.test.jsx` pins the az text twice (Task 5). |
| X6 | D11: "`AlarmSignals.jsx` (`:32`, `:245–247`): sound stops at resolve, tag per episode"; "the notification tag becomes `pid::kind::firstSeenAt`"; §4 "four strings ×4 languages (`alarmResolvedUnacked`, legend rewording)" | Which waiting alarm sounds and which raises a notification is decided in **one** place, `signals/signals.js` ("the ONE copy of this mapping"). The alarm's `id` (`pid::kind`) is also the React key, the busy-button state and the `/ack` subject. A RESOLVED alarm still waits (`needsAnswer`), so its open notification would be closed if it left `notifyFor`'s items. | `signals.js` `rings()`: `soundFor` and `notifyFor(...).ringing` skip RESOLVED; `AlarmSignals.jsx` raises only for `ringing`, keeps an already-raised notification while the alarm waits, and keys and tags by the adapter's new **`episode`** field; `id` is unchanged. The strings ×4: `alarms.resolvedUnacked` (the badge), `alarms.resolvedAt`, one sentence added to `alarms.closedGone`, `patient.trendsLegendAlarm` (X5) — and, since X10, `alarms.ackLabel`. `strings.test.js` is not touched. Task 5. |
| X7 | §4's file list | Comments and tests the change makes false, and fixtures the board's new shape needs, outside §4's list: `api/trends.py:39–48`, `tests/test_trends.py:239–245`, `TrendLegend.jsx:100–101`, `TrendModal.test.jsx:322–323`, `:591`, `:599`, `data/board.testutil.js`, `boardStore.js` `needsAnswer`, the guide's sound paragraph, the G2-01 plan's open-items row O17. Since X10–X14 also `BedCard.jsx`, `BedsScreen.jsx`, `PatientScreen.jsx`, `TopBar.jsx` and their tests, `api/escalation.py` (its docstring), the guide's medication passage. | Each changed in the task whose code makes it false: Task 1 (trends comments), Task 4 (`escalation.py`), Task 5 (dashboard), Task 6 (docs). |
| X8 | D4: "`/clinical` (`:585–616`) … call the hook and audit its result" | `/clinical` ingests several entries in one request and stamps first-seen afterwards for **every** live key of **every** patient; the replay runs once per `chart` row. A latched key must not be stamped again (it would open an episode after its end). | The hook runs after **each** entry, as the replay runs it after each `chart` row; first-seen is stamped after the loop for **this patient's firing** alerts only; the notifier's dedup is pruned after each entry (X14). Cost: a critical that fires at one entry and stops at a later entry of the same request — never on any board — latches with no first-seen (O6, pinned by a test since the Task 4 review). Task 4. |
| X9 | D9 as X1 read it (the anchor dropped when no recognition kind fires) | **Found by the Task 1 review; the user's decision, 2026-10-25.** SOFA reads the latest MAP: platelets 140 with MAP 69 is a rise of 2, MAP 71 is not, so a single MAP reading at 70 or above stopped `sepsis` for one evaluation and dropped the anchor. An untreated sepsis whose MAP flapped never went overdue; a treated one got a false overdue when it came back (the dose was charted before the new anchor). | The anchor is dropped only when **suspected infection is charted absent** (< 1) while no recognition kind fires; the antibiotic findings are emitted only while a recognition kind fires in this evaluation, so they leave the board with the sepsis alert (D9) while the clock counts underneath, and a sepsis that returns shows the true elapsed time (`71cefee`, its comment made exact by `ecef8ae`). Tests: a MAP flap still overdue at +61; a treated patient gets no false overdue; sepsis back at +90 reads "OVERDUE by 30 min"; charting infection absent ends the episode. **Cost:** while infection stays charted the anchor persists — a recurrence days later with no antibiotic since goes straight to overdue; and the pharmacist panel (`_meds`, `board.py:96`) shows the clock while the sepsis alert is off the board. Task 1. |
| X10 | D11: "the alarm row shows the badge … and keeps the acknowledge action" | **Found by the Task 5 review.** The engine computes `risk` from the firing alarms (D10), so a bed whose only alarm is a latched critical is drawn calm while its card, its list row, the bell and the patient screen still list the critical line — bare, it reads as a live one. Same severity and age gave no order between a firing alarm and a RESOLVED one, and every row's «Gördüm» had the same accessible name. | The badge on `BedCard.jsx`, the bed list (`BedsScreen.jsx`), the bell (`TopBar.jsx`) and the patient screen's finding (`PatientScreen.jsx`); after severity, a firing alarm before a RESOLVED one in the waiting queue (the bell, the rail, the sound's order) and on the alarms screen; `alarms.ackLabel` ×4 («{bed} · {kind} siqnalı: gördüm») is the acknowledge button's accessible name, keeping the visible word; the acknowledged-wins mapping and the lock-screen path pinned (`a99d36a`). Resolves O9. Task 5. |
| X11 | §6 and Task 7: the acceptance walked on the local synthetic Docker stack (`-p g2a`) | **The controller's decision (Task 7).** The compose file names its containers (`homunculus-postgres`, `-api`, `-web`), and the controller's G2-01 stack held those names. | The acceptance ran against the engine's own dev server (`homunculus.api.devserver`, its SQLite audit, a real stop and start between the two phases) — the controller's first run on port 18181 at `ecef8ae`, the record from an export at `9240dc2`: the same `acceptance.py`, the same four checks, all PASS. Task 7's Docker steps (the stack, the browser walk, the tear-down) were **not run**; they stay in the plan for the walk with the user. |
| X12 | D9: "a later sepsis episode starts its own antibiotic clock" (with X9: when infection is charted absent) | **Found by the final review.** X9 dropped the anchor when infection was charted absent and the next recognition set a new one: the reviewer's toggle — overdue by 10 min at +70, infection 0 at +71 and 1 at +72 — read "Antibiotic window: 60 min remaining" on a patient whose antibiotic was overdue. | A dropped anchor is remembered with the time of its drop (`_dropped_anchor`, the same lifetime as `_recognized_at`); a recognition with no anchor running restores it when the drop is at most `ANCHOR_RESTORE_S` old — a correction of the toggle is the same episode, and a dose charted in the gap counts against the restored hour; past it a new recognition is a second episode with its own hour, and does not inherit the old anchor or its doses. `ANCHOR_RESTORE_S` is 900 s (15 min) (the size of a correction; it was 3600 s at `71b566c`), the window running from the drop. The clock is the observations' own, so a restart in the gap restores as live (`71b566c`, 7251540). Task 1. |
| X13 | D5: "the next firing … starts a new escalation clock" | **Found by the final review.** A return after a clear is a new episode, and its escalation clock restarted with it: a HIGH immediate alert flapping every two minutes (NEWS2 7 / 4) was never on the board for five minutes and never reached the doctor. | Consecutive **unanswered** episodes of one (patient, kind) whose gap — from the clear to the next first sight — is at most `escalate_after` form one escalation chain: `AckStore.clock_from` is the chain's start and what `escalate()` measures (its signature unchanged; the board's `first_seen_at` stays the episode's); the prune remembers each unanswered episode leaving the board in `AckStore.recent` as `Chain(clock_from, cleared_at, paged)`; `stamp_first_seen(…, chain_gap=escalate_after)` continues it — its clock and its page — within the gap (exactly 5:00 continues, 5:01 restarts) and forgets older chains. **An acknowledgement ends the chain** (8fbcff1): no chain is remembered for an acknowledged key nor by `acknowledge_latched`, so a return after an ack starts a new clock and can page anew. A return is still a new episode (D5). **A critical kind never leaves a chain:** unanswered, it latches; answered, it leaves none — so the chain matters only for kinds that do not latch, such as a HIGH `news2`. The replay sets `clock_from` from the `first_seen` rows and keeps no chain. The review's 11 mutants are killed by the tests (`6debbe7`, 8fbcff1). Task 4. |
| X14 | D8: a latched alert's "`escalated` flag is dropped by the prune" | **Found by the final review.** `escalated` follows the clock — a latch drops it, a return raises it — so a never-acknowledged critical whose lactate swung 3.4 / 1.5 paged the doctor at each swing (nine returns, nine pages). The hook's prune walked every patient's evaluation, so each row cost the ward's size. And `/clinical` pruned the nurse's dedup only after the last entry, so a shock ended and restarted in one request (`[norepinephrine 0, dopamine 5]`) kept the old episode's dedup. | One doctor page per episode — per chain under X13 — via `AckStore.paged` (kept for live keys, carried by a chain, forgotten with the episode); the hook prunes from the store's own firing ∪ latched keys; `/clinical` re-arms the nurse's dedup after each entry (the notification itself goes out on the next `/ingest`: this door notifies nobody). **Not replayed:** `paged`, `escalated`, `clock_from` beyond the `first_seen` rows, and `recent` — after a restart the first cycle pages once for anything past its threshold (`46a282d`). Task 4. |

Departures found while implementing go below X14 (X15 …), each with its file and line.

## Open items

Numbered for this slice (G2-A1 O1 …); the G2-01 plan's O1–O26 and the NBP plan's O27–O37 are other items.

| # | Item | Owner | When |
|---|---|---|---|
| O1 | **No cool-down for a flapping value** (D13, the user's choice): HR 140 → 80 → 140 is two episodes; an `immediate` kind (NEWS2 ≥ 7, septic shock, an overdue antibiotic) tells the nurse again on each return. NEWS2 by a single red parameter is `soon` and notifies nobody. | User (accepted, D13) | Revisit after the pilot's first week |
| O2 | No alert-level SSE `cleared` frame (D13; Lane B asked): the whole-board replace already drops a cleared alert (`boardStore.js:58–64`). | Lane B | When the RRT page needs it |
| O3 | **Rules run only on ingest** (D13): an alert whose rule would stop purely by time passing clears on the next observation; `antibiotic_due` becomes `antibiotic_overdue` only on the next reading. | — | — |
| O4 | **An older reading is evaluated at its own time** (`now=obs.timestamp`). A delayed or out-of-order delivery evaluates the time-dependent rules at that older instant, and with D1 its result replaces the bucket: an `antibiotic_overdue` can clear (and latch, if unanswered) on a late reading and fire again on the next. Pre-existing; clearing makes it visible. Measured nowhere on the pilot ward. | Engine (Lane A, next slice) | Before > 1 ward |
| O5 | **A re-fire while latched continues its episode** (no `alert_cleared`, no new first-seen, no new nurse notification — the spec's §4; pinned by a test since the Task 4 review). Since X14 the doctor is not paged again for it, and since X13 its clock is the chain's: a fresh clock follows only an acknowledgement. | — | Done (X13, X14) |
| O6 | A critical that fires at one entry of a `/clinical` request and stops at a later entry of the same request — never on any board — latches with `first_seen` null; the row then shows no age (X8; pinned since the Task 4 review). | — | — |
| O7 | **Charting the antibiotic ends `antibiotic_overdue` (critical):** if nobody had acknowledged it, it latches, and the nurse who charted the dose must also press «Gördüm». D2 as decided; the user may want charted resolution to count as the answer. | User | At the walk |
| O8 | `GET /alerts/{patient_id}` lists the engine's firing alerts only; the latch travels on the board (`/patients`, `/stream`). No screen of this build reads that route. | — | — |
| O9 | ~~Only the alarms screen shows the badge.~~ **Resolved by X10** (the Task 5 review): the bed card, the bed list, the bell and the patient screen show it too. | — | Done (X10) |
| O10 | After a restart a latched alert's `resolved_at` is its row's write time (`rehydrate._written_at`), microseconds before the live value. | — | — |
| O11 | `alarm_quality`: an episode that resolved by itself before anyone answered still counts as **unanswered** once settled. Whether self-resolved episodes should be reported apart is a reporting decision; `Episode.resolved_at`/`ended_at` make it possible. | User / medical director | — |
| O12 | The az, ru and en texts (`alarms.resolvedUnacked`, `alarms.resolvedAt`, `alarms.ackLabel`, `closedGone`'s new sentence, `patient.trendsLegendAlarm`) are the planner's and the reviews' and await a native reading. | User | Before deploy |
| O13 | The Postgres-backed tests (the 650 skipped) were not run: no touched test file reads the test database, no SQL and no migration changes (Task 7 Step 2). Run them before the deploy if the controller wants. | Controller | Before deploy |
| O14 | **Deploy web no later than api.** An old web on a new api maps a latched critical to FIRED and **sounds it**; a new web on an old api never sees `resolved_at`. The VM blocks are a later, separate step. | Controller | At deploy |
| O15 | **An alarm that flaps or stays unanswered for hours pages the doctor once per chain** (X13, X14): there is no repeat page every N minutes, as there was none before this slice. A repeat-page policy is the user's, for a later slice. | User | Later slice |

---

## Baseline at `c66a615` (measured 2026-10-25)

- **Engine, no database** (`--ignore=tests/test_infinity_vm_pilot.py`, `PYTHONPATH=src`): **2143 passed, 650 skipped, 3 warnings** in ≈ 1 min 40 s in a checkout (in a `git archive` export: `4 failed, 2139 passed` — the four tests that build a release from git).
- **Dashboard:** `npx vitest run` → **89 files / 2392 tests**, all passing. `npx vite build` clean, `precache  20 entries`.
- **Postgres:** not needed (O13; Task 7 Step 2).
- **Python 3.14:** `/c/tmp/g115-py314/Scripts/python.exe` (3.14.5) runs this worktree's tests with `PYTHONPATH=src`.

## Counts after each task (in plan order)

| After | Engine, no DB (passed / skipped) | Dashboard (files / tests) | This task's test files |
|---|---|---|---|
| base | 2143 / 650 | 89 / 2392 | — |
| 1 | 2154 / 650 | — | `test_pipeline.py` 6 → **17**; `test_trends.py` 32 → **32** (a docstring) |
| 2 | 2167 / 650 | — | `test_alert_lifecycle.py` new, **12**; `test_ackstore.py` 3 → **4** |
| 3 | 2176 / 650 | — | `test_board.py` 4 → **8**; `test_alarm_quality.py` 18 → **23** |
| 4 | 2220 / 650 | — | `test_api_ack.py` 6 → **18**, `test_api_ingest.py` 7 → **10**, `test_api_clinical.py` 20 → **26**, `test_rehydrate.py` 6 → **12**, `test_alert_lifecycle.py` 12 → **20**, `test_ackstore.py` 4 → **13** |
| 5 | — | 89 / 2411 | `liveAdapters.test.js` 50 → **53**, `boardStore.test.js` 40 → **42**, `signals.test.js` 10 → **12**, `AlarmSignals.test.jsx` 25 → **29**, `AlarmsScreen.test.jsx` 24 → **28**, `TrendModal.test.jsx` 58 → **58**, `BedCard.test.jsx` 33 → **34**, `BedsScreen.test.jsx` 35 → **36**, `PatientScreen.test.jsx` 70 → **71**, `Shell.test.jsx` 40 → **41**, `strings.test.js` 6 → **6** |
| 6 | docs only | — | — |
| 7 | 2220 / 650 (gate) | 89 / 2411 (gate), build 20 | Python 3.14, the ten engine files: **179** |

Engine arithmetic: 11 + 13 + 9 + 44 = **77** over the base. Dashboard: **19** tests, no new file. Measured in the replay, 2026-10-25, at `9240dc2`; every engine count is a checkout's (the export's passed + the 4 tests that need git).

---

## Ground rules for every task

- **Your worktree.** `/c/tmp/g2a-o17`, branch `feat/g2a-o17` (from `origin/main` `03daac4` + the spec `c66a615`; this plan is its next commit). If the controller gives you a parallel worktree branched from this one, every path below reads that worktree instead. **Never touch `/c/Users/User/Desktop/Project/Homunculus AI`** (the user's main checkout) or another `/c/tmp` worktree. Never `git push`, never deploy, never change anything on a VM. **Never run `git stash`** — the stash is shared with every other worktree and session. If you remove a worktree, unlink its `node_modules` junction first (`cmd //c "rmdir C:\\tmp\\g2a-o17\\dashboard\\node_modules"`), then `git worktree remove --force`: a recursive delete that follows the junction empties the shared install. Never reinstall `node_modules`.
- **Write and Edit tools only on repo files — never `sed`, `python`, `node` or a shell heredoc** — with one exception, given as a command where it is needed: a file written with the Write tool — the two new files of Task 2, and the two test files Tasks 4 and 5 write whole — is converted to CRLF by a one-line Python call that touches only that file. The tree checks out **CRLF** (`core.autocrlf=true`); every block here is LF. The Edit tool matches either way. Every Edit's old text is unique in its file at that moment (the replay asserted it). Each task ends by counting the line ends of the files it touched — `CR` must equal `LF`, and both must be the numbers the task gives (a mismatch means a line end was rewritten or an edit landed twice). After editing `strings/*.js` run `npx vitest run src/live/i18n/strings.test.js`: it fails if the Cyrillic or the `ə` was mangled.
- **TDD.** Write the test, run it and **see it red for the reason the task names**, then the code, then green. Put the red in the commit body.
- **Stage explicit paths only** (the task's `git add` line). Before every commit run `git status --short` and `git diff --cached --stat`; if a staged path is not one the task lists, stop and ask.
- **Commit after every task that changes the repo.** Messages are `type(scope): what, in words` and end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```
  (the trailer the controller set for this session; if the controller records a newer one by the time you commit, use that). The branch's own commits carry the trailers their sessions set (Opus 5.5, Sonnet 5.5, Fable 5.1); they are recorded as they are.
- **Foreground gates.** Run every suite and build in the foreground; never background a gate and wait on it. One Bash call runs at most 10 minutes: the whole no-DB suite fits (≈ 1 min 40 s).
- **Python commands** (always from the engine directory, always `PYTHONPATH=src`, always name files):
  ```bash
  cd /c/tmp/g2a-o17/homunculus-engine
  PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q <files> 2>&1 | tail -1
  ```
  **Never run `tests/test_infinity_vm_pilot.py`** (it hangs), alone or in a bare `pytest tests/`. The whole no-DB suite: the same command with `--ignore=tests/test_infinity_vm_pilot.py` and no file list. **Never set or export `DATABASE_URL`**; this slice needs no `TEST_DATABASE_URL` either. Never print a token, a key or an env file's values.
- **Dashboard commands** run from `/c/tmp/g2a-o17/dashboard`. The suite and the build are **two separate commands** (Task 0 Steps 4 and 5). The build must print `built in` and `precache  20 entries`, and no `larger than 500 kB`. A test run may print `Warning: An update to … inside a test was not wrapped in act(...)`; it is not a failure.
- **Line-end count:** each task gives its command (`tr -cd '\r' | wc -c` against `tr -cd '\n' | wc -c` per file).
- **No patient data, ever** (CLAUDE.md rule 6). Beds `bed-3`, `bed-4`, `S-001`, `G2A-1` …; every value is made up and says nothing about anyone.
- **The clinical rule lives in the API.** Which severity latches is `alert_lifecycle.LATCHING_SEVERITY` ("critical", the user's decision); the dashboard decides nothing clinical — it draws `resolved_at` as the server sent it and stops the sound for status RESOLVED.
- **Lane B's seams are not touched:** `dashboard/src/live/i18n/catalog.js`, `routes.js` SCREENS, `strings.test.js`, the permissions catalogue; `admission/`, `escalation/router.py`, `scope/`, `tenant/` (Task 7 Step 6 checks). If a review forces one, add a blank-separated block marked `// G2-A1 …` and tidy nothing around it.
- **Four languages for every key** (`tr` is the source; `az` the default). An `az` text equal to `tr`, or an `ru` text with no Cyrillic, needs a reviewed entry in `strings.test.js` — none of this slice's does. Russian calls the engine "система", never "движок".
- **Test names:** `describe` names the thing, `it` is a sentence about its behaviour in the reader's terms.

---

## File map

**Create — engine:** `homunculus-engine/src/homunculus/api/alert_lifecycle.py` (Task 2) · `homunculus-engine/tests/test_alert_lifecycle.py` (Task 2).

**Modify — engine** (`homunculus-engine/`)

| File | Change | Task |
|---|---|---|
| `src/homunculus/pipeline.py` | the bucket is the evaluation (D1); the antibiotic anchor: both recognition kinds (X1), dropped only when infection is charted absent, findings only while a kind fires (X9), restored within `ANCHOR_RESTORE_S` (X12) | 1 |
| `tests/test_pipeline.py` | the bucket, the flap, the toggle, the anchor through shock | 1 |
| `src/homunculus/api/trends.py`, `tests/test_trends.py` | the marker limit's comment and its test's docstring (X7) | 1 |
| `src/homunculus/api/ackstore.py` | `resolved`, `firing`; `prune(live_keys, firing_keys=None)` (X2) — then (Task 4) the latch's `first_seen`, `paged` (X14), `clock_from`, `recent`, `Chain`, `stamp_first_seen(…, chain_gap=)`, `remember_chain`, `prune(…, now=)` (X13) | 2, 4 |
| `src/homunculus/api/alert_lifecycle.py` | the hook (Task 2); the latch's first-seen, the prune from the store's own keys, the chain, the page (Task 4) | 2, 4 |
| `tests/test_alert_lifecycle.py`, `tests/test_ackstore.py` | the hook and the store (Task 2); the latch's first-seen, the O5 pin, the page, the chain (Task 4) | 2, 4 |
| `src/homunculus/api/board.py` | `resolved_at`; `_latched_alerts` after the firing ones; risk from firing (D10) | 3 |
| `src/homunculus/api/alarm_quality.py` | `alert_cleared` closes; a latch stays open for its ack, which answers it; the last stop (D12, X4) | 3 |
| `tests/test_board.py`, `tests/test_alarm_quality.py` | four and five tests | 3 |
| `src/homunculus/api/app.py` | `_audit_cleared`; the hook right after `engine.ingest` in both doors; `/clinical` per entry, stamps for the patient's firing alerts, the notifier per entry (X8, X14); `/ack` removes a latch; the escalation cycle on the chain's clock, one page per chain (D4, D6, D8, X13, X14) | 4 |
| `src/homunculus/api/rehydrate.py` | every `ingest`/`chart` row through the hook; an `ack` row removes a latch, or answers nothing if the key is not live; the chain starts over (D7, X13) | 4 |
| `src/homunculus/api/escalation.py`, `src/homunculus/api/audit.py` | a docstring (X13), a comment (D6) | 4 |
| `tests/test_api_ack.py` (whole), `tests/test_api_ingest.py`, `tests/test_api_clinical.py`, `tests/test_rehydrate.py` | the doors, the page, the chain, the replay | 4 |

**Modify — dashboard** (`dashboard/src/`)

| File | Change | Task |
|---|---|---|
| `liveAdapters.js` | status `RESOLVED`, `resolvedAtMs`, `episode` (D11, X6) | 5 |
| `live/signals/signals.js`, `live/signals/AlarmSignals.jsx` | `rings()`; notifications keyed and tagged by episode, raised for `ringing` only | 5 |
| `live/screens/alarms/AlarmsScreen.jsx` | the badge and the time it passed; a firing alarm first; the button's accessible name (X10) | 5 |
| `live/screens/beds/BedCard.jsx`, `live/screens/beds/BedsScreen.jsx`, `live/screens/patient/PatientScreen.jsx`, `live/shell/TopBar.jsx` | the badge on every surface (X10) | 5 |
| `live/data/boardStore.js` | firing before RESOLVED in the queue (X10); a comment at `needsAnswer` | 5 |
| `live/i18n/strings/alarms.js`, `live/i18n/strings/patient.js` | `resolvedUnacked`, `resolvedAt`, `ackLabel`, `closedGone` + one sentence, `trendsLegendAlarm` (X5), ×4 | 5 |
| `live/screens/patient/trends/TrendLegend.jsx` | its comment (X7) | 5 |
| the tests: `liveAdapters.test.js`, `live/data/boardStore.test.js`, `live/data/board.testutil.js`, `live/signals/signals.test.js`, `live/signals/AlarmSignals.test.jsx`, `live/screens/alarms/AlarmsScreen.test.jsx` (whole), `live/screens/patient/trends/TrendModal.test.jsx`, `live/screens/beds/BedCard.test.jsx`, `live/screens/beds/BedsScreen.test.jsx`, `live/screens/patient/PatientScreen.test.jsx`, `live/shell/Shell.test.jsx` | 19 tests | 5 |

**Modify — docs** (Task 6): `docs/homunculus-rehber-TR.md` (five passages), `docs/superpowers/plans/2026-10-19-g2-vital-egrileri.md` (three O17 notes), `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` (the row G2-A1). `Homunculus/wiki` is untouched (no clinical claim changes).

**Outside the repo:** `/c/tmp/homunculus-plans/g2a-o17/acceptance.py` (Task 7), `reference.patch`.

**How an edit reads in this plan:** a bold **Edit** with the file's path and "replace:", a fenced block with the exact old text, "with:", and a fenced block with the new text. Use the Edit tool with those two texts, in the order given. A bold **Write** gives a new file's whole text, or — "the whole file, replacing it" — an existing file's.

---

### Task 0: The worktree, the shared install and the baseline

Nothing is changed in the repo. The point is to know, before Task 1, that the tree is the plan's and that both suites are green with the numbers the counts table starts from.

**Files:** none in the repo; a junction `dashboard/node_modules` → `C:\tmp\homunculus-g1\dashboard\node_modules` (ignored by `dashboard/.gitignore`).

- [ ] **Step 1: The tree is the plan's**

```bash
cd /c/tmp/g2a-o17
git branch --show-current
git status --short
git log --oneline -3
```

Expected: `feat/g2a-o17`; no status line; the top commit is this plan (`docs(plan): G2-A1 — …`), then `c66a615 docs(spec): G2-A1 — alerts clear when their rule stops firing; critical ones latch until acknowledged (O17)`, then `03daac4 docs(plan): Group 2 slice 1 — …`. Anything else: stop and ask.

- [ ] **Step 2: The shared install, by junction (never reinstall)**

```bash
cd /c/tmp/g2a-o17
test -e dashboard/node_modules || cmd //c "mklink /J C:\\tmp\\g2a-o17\\dashboard\\node_modules C:\\tmp\\homunculus-g1\\dashboard\\node_modules"
ls dashboard/node_modules/.bin/vitest && git status --short
```

Expected: `Junction created for C:\tmp\g2a-o17\dashboard\node_modules <<===>> C:\tmp\homunculus-g1\dashboard\node_modules` (or nothing, if it was already there), then the `vitest` path, and still no status line. From PowerShell the same is `cmd /c mklink /J C:\tmp\g2a-o17\dashboard\node_modules C:\tmp\homunculus-g1\dashboard\node_modules`.

- [ ] **Step 3: The engine, no database**

```bash
cd /c/tmp/g2a-o17/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -1
```

Expected (≈ 1 min 40 s): `2143 passed, 650 skipped, 3 warnings in …`.

- [ ] **Step 4: The dashboard suite**

```bash
cd /c/tmp/g2a-o17/dashboard
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
```

Expected: ` Test Files  89 passed (89)` and `      Tests  2392 passed (2392)`.

- [ ] **Step 5: The build**

```bash
cd /c/tmp/g2a-o17/dashboard
npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
```

Expected: `✓ built in …` and `precache  20 entries (… KiB)`; no `larger than`. (`dist/` is ignored.)

- [ ] **Step 6: The test files this slice touches, and that none needs a database**

```bash
cd /c/tmp/g2a-o17/homunculus-engine
for f in test_pipeline test_trends test_ackstore test_board test_alarm_quality test_api_ack test_api_ingest test_api_clinical test_rehydrate; do printf "%s " $f; PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q --co tests/$f.py 2>&1 | tail -1; done
grep -ln "TEST_DATABASE_URL\|postgres" tests/test_pipeline.py tests/test_trends.py tests/test_ackstore.py tests/test_board.py tests/test_alarm_quality.py tests/test_api_ack.py tests/test_api_ingest.py tests/test_api_clinical.py tests/test_rehydrate.py; echo "grep exit $?"
```

Expected: `test_pipeline 6`, `test_trends 32`, `test_ackstore 3`, `test_board 4`, `test_alarm_quality 18`, `test_api_ack 6`, `test_api_ingest 7`, `test_api_clinical 20`, `test_rehydrate 6` (`… tests collected in …`); then `grep exit 1`.

No commit: Task 0 changes nothing in the repo.

---

### Task 1: The engine — an alert lasts exactly as long as its rule fires; the antibiotic clock survives a flap and a corrected toggle

**Done on the branch** as `39812b6` (the first version's Task 1, byte for byte), `71cefee` (X9, the Task 1 review — the user's decision; its body's red: "the MAP flap showed no antibiotic_overdue at 61 min; the treated patient showed a false one at +152"), `ecef8ae` (its re-review: the anchor comment says exactly when it drops; the tests keep their line continuations), `71b566c` (X12, the final review; its body's red: `test_a_corrected_infection_toggle_keeps_the_antibiotic_hour` — "re-recognised a minute after the drop: the old anchor", `assert 2026-07-14 11:12 == 2026-07-14 10:00` — and `test_an_antibiotic_charted_while_infection_was_charted_absent_counts_against_the_restored_hour` — `assert 2026-07-14 10:40 == 2026-07-14 10:00`; the horizon test held before) and 7251540 (X12's review: `ANCHOR_RESTORE_S` 3600 → 900 s: a rule-out followed by a new recognition within the hour no longer inherits the old anchor and the doses given since; the window runs from the drop). The blocks below are that code: replayed onto `c66a615` they give the branch's `pipeline.py`, `test_pipeline.py`, `trends.py` and `test_trends.py` byte for byte. (`71cefee` also changed one comment line of `ackstore.py`; it names the latch's first-seen, which Task 4 adds, so Task 4 carries it.)

Spec D1 and D9, with X1, X9 and X12. The per-patient bucket (`pipeline.py:91–96`) becomes exactly the kinds this evaluation produced; a kind it did not produce is gone at once. The antibiotic clock's anchor is set at the first recognition (`sepsis` or `septic_shock`), kept while infection stays charted, dropped when suspected infection is charted absent while no recognition kind fires, and restored when that absence is corrected within `ANCHOR_RESTORE_S`; the clock's findings are emitted only while a recognition kind fires.

The rules, each held by a test below:
- a kind the rules did not produce for this reading leaves `active_alerts` on that reading (HR 140 raises a MODERATE `news2` — one red parameter —; HR 80 clears it);
- a kind that fires again is back, and another patient's bucket is not touched by this one's evaluation;
- when `sepsis` stops (SOFA back to 0) its antibiotic alerts leave the board with it, but the anchor stays while infection is charted, and a sepsis back at +90 reads "Antibiotic OVERDUE by 30 min" — the hour that ran from +0 (X9);
- charting infection absent ends the episode and its anchor; a recognition after the restore window starts its own hour (D9, X9, X12);
- a corrected toggle — infection charted absent at +71 and present again at +72 — restores the old anchor ("Antibiotic OVERDUE by 12 min"), and a dose charted inside the gap counts against the restored hour; a recognition 19 min after the drop has its own hour, and a new infection recognised 50 min after a rule-out does not inherit the old anchor or the dose given before it (X12);
- a MAP flapping across 70 (one reading in ten at 71) does not reset the clock: overdue at +61, the anchor the first recognition's throughout, and "OVERDUE by 60 min" when sepsis is back at +121; a treated patient gets no false overdue after a flap (X9);
- while `septic_shock` fires the anchor stays even if `sepsis` stops (a charted baseline SOFA of 4 against a SOFA of 4): `antibiotic_overdue` stays overdue (X1).

The spec's §5 asks that the presence-after-replay assertions be re-read (`test_scenarios_e2e.py:25,35,43,55`, `test_scenarios_hl7_parity.py:36,57`, `test_pipeline_model.py:31,41`, `test_api_patient_profile.py:159`, `test_rehydrate.py:23–27`, `test_alarm_quality.py:175–181`). Re-read: **every one still holds, unchanged** — in each the kind it asserts fires at the scenario's last reading, and the `not in` assertions can only get truer. Step 6's neighbours run them all (`test_pipeline_model.py` skips without `homunculus_ml`).

Two comments the change makes false are corrected here (X7): the trend marker limit's (`api/trends.py:39–48`) and its test's docstring (`tests/test_trends.py:239–245`).

**Files:**
- Modify: `homunculus-engine/tests/test_pipeline.py` (appended after the last test)
- Modify: `homunculus-engine/src/homunculus/pipeline.py` (an import, the restore constant, the dropped-anchor field, the anchor, the bucket, `_new_anchor`)
- Modify: `homunculus-engine/src/homunculus/api/trends.py` (a comment), `homunculus-engine/tests/test_trends.py` (a docstring)

- [ ] **Step 1: Write the failing tests**

**Edit** `homunculus-engine/tests/test_pipeline.py` — replace:
```python
    alerts = {a.kind: a for a in eng.active_alerts("bed-3")}
    assert "acute_change" in alerts
    assert alerts["acute_change"].supporting_evidence == ["news2-rcp-2017"]
    assert alerts["acute_change"].recommended_actions
```
with:
```python
    alerts = {a.kind: a for a in eng.active_alerts("bed-3")}
    assert "acute_change" in alerts
    assert alerts["acute_change"].supporting_evidence == ["news2-rcp-2017"]
    assert alerts["acute_change"].recommended_actions


# --- G2-A1 (O17): an alert lasts exactly as long as its rule fires -------------------------------
#
# The bucket is rebuilt from every evaluation: a kind the rules did not produce for this reading is
# gone at once — no quiet time, no hysteresis (the user's decision, 2026-10-25). A heart rate of
# 140/min alone is enough to raise one: 3 NEWS2 points, a single red parameter, a MODERATE `news2`.

def _kinds(eng, patient="bed-3"):
    return {a.kind for a in eng.active_alerts(patient)}


def test_an_alert_whose_rule_stops_firing_leaves_on_the_first_reading_that_does_not_produce_it():
    eng = Engine()
    fast = _obs(SignalCode.HEART_RATE, 140)
    assert {a.kind for a in eng.ingest(fast, now=fast.timestamp)} == {"news2"}
    calm = _obs(SignalCode.HEART_RATE, 80, minute=1)
    assert eng.ingest(calm, now=calm.timestamp) == []
    assert eng.active_alerts("bed-3") == [], "HR 80 scores 0: the single red parameter has resolved"


def test_an_alert_that_fires_again_is_back_and_another_patient_is_untouched():
    eng = Engine()
    for minute, (patient, rate) in enumerate([("bed-3", 140), ("bed-4", 140), ("bed-3", 80), ("bed-3", 140)]):
        o = _obs(SignalCode.HEART_RATE, rate, minute=minute, patient=patient)
        eng.ingest(o, now=o.timestamp)
    assert _kinds(eng) == {"news2"}, "140 → 80 → 140: the second 140 fires again"
    assert _kinds(eng, "bed-4") == {"news2"}, "bed-4 was not evaluated again: its alert stands"


def _sepsis_charted(eng, infection, minute):
    """Platelets 80 and creatinine 3.5 with suspected infection charted `infection`: SOFA 5 over an
    assumed baseline of 0, so `sepsis` fires while infection is 1, and `septic_shock.evaluate`
    returns nothing at its first line once the physician charts it 0."""
    for code, value in [(SignalCode.PLATELETS, 80), (SignalCode.CREATININE, 3.5),
                        (SignalCode.SUSPECTED_INFECTION, infection)]:
        o = _obs(code, value, minute=minute)
        eng.ingest(o, now=o.timestamp)


def test_when_sepsis_stops_the_antibiotic_alerts_leave_the_board_but_the_clock_keeps_counting():
    # X9 (Task 1 review): the antibiotic findings are emitted only while a recognition kind fires,
    # so they leave the board with the sepsis alert (D9) — but the anchor is NOT dropped, because
    # suspected infection is still charted. Sepsis that comes back finds the true elapsed time.
    eng = Engine()
    _sepsis_charted(eng, 1.0, minute=0)
    assert _kinds(eng) == {"sepsis", "antibiotic_due"}
    assert eng.recognized_at("bed-3") == T0
    for code, value in [(SignalCode.PLATELETS, 200), (SignalCode.CREATININE, 0.8)]:   # SOFA back to 0
        o = _obs(code, value, minute=20)
        eng.ingest(o, now=o.timestamp)
    assert _kinds(eng) == set(), "sepsis has stopped: it and its antibiotic clock are off the board"
    assert eng.recognized_at("bed-3") == T0, "infection is still charted: the clock keeps counting underneath"
    o = _obs(SignalCode.PLATELETS, 80, minute=90)
    eng.ingest(o, now=o.timestamp)
    o = _obs(SignalCode.CREATININE, 3.5, minute=90)
    eng.ingest(o, now=o.timestamp)
    assert {"sepsis", "antibiotic_overdue"} <= _kinds(eng)
    overdue = next(a for a in eng.active_alerts("bed-3") if a.kind == "antibiotic_overdue")
    assert overdue.summary == "Antibiotic OVERDUE by 30 min", \
        "sepsis back at +90: the hour that ran from +0 closed at +60, not an hour restarted at +90"
    assert eng.recognized_at("bed-3") == T0


def test_charting_infection_absent_ends_the_episode_and_its_clock():
    eng = Engine()
    _sepsis_charted(eng, 1.0, minute=0)
    assert _kinds(eng) == {"sepsis", "antibiotic_due"}
    assert eng.recognized_at("bed-3") == T0
    _sepsis_charted(eng, 0.0, minute=20)          # the physician charts: no infection after all
    assert _kinds(eng) == set(), "no recognition kind fires: sepsis and its antibiotic clock are gone"
    assert eng.recognized_at("bed-3") is None, "infection charted absent: the episode and its anchor end"
    _sepsis_charted(eng, 1.0, minute=90)          # a second episode, seventy minutes later
    assert eng.recognized_at("bed-3") == T0 + timedelta(minutes=90)
    due = next(a for a in eng.active_alerts("bed-3") if a.kind == "antibiotic_due")
    assert due.summary == "Antibiotic window: 60 min remaining", \
        "the second recognition has its own hour, not the first episode's overdue clock"


def _chart(eng, code, value, minute):
    o = _obs(code, value, minute=minute)
    eng.ingest(o, now=o.timestamp)


def _summary(eng, kind, patient="bed-3"):
    return next(a.summary for a in eng.active_alerts(patient) if a.kind == kind)


def test_a_corrected_infection_toggle_keeps_the_antibiotic_hour():
    # X12 (the reviewer's toggle): overdue by 10 min at +70, infection charted absent at +71 and
    # present again at +72. That is a correction, the same episode: before X12 the anchor dropped at
    # +71 was gone and +72 started a new hour — "Antibiotic window: 60 min remaining", on a patient
    # whose antibiotic was overdue.
    eng = Engine()
    _sepsis_charted(eng, 1.0, minute=0)
    _chart(eng, SignalCode.PLATELETS, 80, minute=70)
    assert _summary(eng, "antibiotic_overdue") == "Antibiotic OVERDUE by 10 min"
    _chart(eng, SignalCode.SUSPECTED_INFECTION, 0.0, minute=71)
    assert _kinds(eng) == set()
    assert eng.recognized_at("bed-3") is None, "charted absent: the anchor is dropped (X9)"
    _chart(eng, SignalCode.SUSPECTED_INFECTION, 1.0, minute=72)
    assert eng.recognized_at("bed-3") == T0, "re-recognised a minute after the drop: the old anchor"
    assert "antibiotic_due" not in _kinds(eng)
    assert _summary(eng, "antibiotic_overdue") == "Antibiotic OVERDUE by 12 min", \
        "the hour that ran from +0 is still the one that is overdue"


def test_a_recognition_more_than_15_minutes_after_infection_was_charted_absent_has_its_own_hour():
    eng = Engine()
    _sepsis_charted(eng, 1.0, minute=0)
    _chart(eng, SignalCode.PLATELETS, 80, minute=70)
    assert _summary(eng, "antibiotic_overdue") == "Antibiotic OVERDUE by 10 min"
    _chart(eng, SignalCode.SUSPECTED_INFECTION, 0.0, minute=71)
    _chart(eng, SignalCode.HEART_RATE, 80, minute=80)             # an evaluation in the gap
    _chart(eng, SignalCode.SUSPECTED_INFECTION, 1.0, minute=90)   # 19 min after the drop
    assert eng.recognized_at("bed-3") == T0 + timedelta(minutes=90), "past the restore window: a new anchor"
    assert "antibiotic_overdue" not in _kinds(eng)
    assert _summary(eng, "antibiotic_due") == "Antibiotic window: 60 min remaining"


def test_a_new_infection_recognised_within_the_hour_of_a_rule_out_does_not_inherit_its_doses():
    # X12 review: sepsis at +0, the antibiotic given at +20, infection ruled out at +40 and a new one
    # recognised at +90. With an hour's restore window the +90 recognition inherited the anchor of +0
    # and the dose of +20 with it: no antibiotic alert at all for the new infection. Fifty minutes is
    # no corrected toggle; the new episode has its own hour, and the old dose does not count.
    eng = Engine()
    _sepsis_charted(eng, 1.0, minute=0)
    _chart(eng, SignalCode.ANTIBIOTIC_ADMINISTERED, 1.0, minute=20)
    assert not _kinds(eng) & {"antibiotic_due", "antibiotic_overdue"}, "the first episode is treated"
    _chart(eng, SignalCode.SUSPECTED_INFECTION, 0.0, minute=40)   # ruled out
    assert eng.recognized_at("bed-3") is None
    _chart(eng, SignalCode.SUSPECTED_INFECTION, 1.0, minute=90)   # a new infection, 50 min later
    assert "sepsis" in _kinds(eng)
    assert eng.recognized_at("bed-3") == T0 + timedelta(minutes=90), "its own anchor"
    assert _summary(eng, "antibiotic_due") == "Antibiotic window: 60 min remaining", \
        "the dose of +20 was for the ruled-out episode"


def test_an_antibiotic_charted_while_infection_was_charted_absent_counts_against_the_restored_hour():
    eng = Engine()
    _sepsis_charted(eng, 1.0, minute=0)
    _chart(eng, SignalCode.SUSPECTED_INFECTION, 0.0, minute=30)
    _chart(eng, SignalCode.ANTIBIOTIC_ADMINISTERED, 1.0, minute=35)   # given during the gap
    _chart(eng, SignalCode.SUSPECTED_INFECTION, 1.0, minute=40)
    assert "sepsis" in _kinds(eng)
    assert eng.recognized_at("bed-3") == T0, "the toggle was corrected: the anchor of +0, restored"
    assert not _kinds(eng) & {"antibiotic_due", "antibiotic_overdue"}, \
        "the dose at +35 is after the restored anchor: the clock is satisfied"
    _chart(eng, SignalCode.PLATELETS, 80, minute=100)
    assert not _kinds(eng) & {"antibiotic_due", "antibiotic_overdue"}


def _flapping_map(eng, minute, value):
    o = _obs(SignalCode.MAP, value, minute=minute)
    eng.ingest(o, now=o.timestamp)


def test_a_map_flap_does_not_reset_the_antibiotic_clock():
    # SOFA reads the latest MAP: platelets 140 (1 point) plus MAP 69 (1 point) is a rise of 2, MAP 71
    # is not. One reading in ten at 71 stops sepsis for one evaluation each time; the untreated
    # patient's hour must run on regardless (X9). Before it, each flap dropped the anchor and
    # `antibiotic_overdue` never fired.
    eng = Engine()
    for code, value in [(SignalCode.SUSPECTED_INFECTION, 1.0), (SignalCode.PLATELETS, 140)]:
        o = _obs(code, value)
        eng.ingest(o, now=o.timestamp)
    first_overdue = None
    anchors = []                       # the engine's anchor after every reading from the first recognition on
    for minute in range(0, 121):
        _flapping_map(eng, minute, 69 if minute % 10 else 71)
        if minute == 0:
            assert "sepsis" not in _kinds(eng), "MAP 71 and platelets 140 are SOFA 1: no rise of 2"
        else:
            anchors.append(eng.recognized_at("bed-3"))
        if minute % 10 == 0:
            assert not _kinds(eng) & {"antibiotic_due", "antibiotic_overdue"}, \
                f"sepsis is not firing at +{minute} min: the antibiotic alerts are off the board"
        if first_overdue is None and "antibiotic_overdue" in _kinds(eng):
            first_overdue = minute
    assert first_overdue == 61, f"overdue one hour after the first recognition (+1 min), saw {first_overdue}"
    assert set(anchors) == {T0 + timedelta(minutes=1)}, "the anchor stayed at the first recognition throughout"
    assert _kinds(eng) == set(), "+120 min is a MAP-71 reading: sepsis and its overdue are off the board"
    _flapping_map(eng, 121, 69)
    overdue = next(a for a in eng.active_alerts("bed-3") if a.kind == "antibiotic_overdue")
    assert overdue.summary == "Antibiotic OVERDUE by 60 min", "sepsis back at +121: the true elapsed time"


def test_a_treated_patient_does_not_get_a_false_overdue_after_a_map_flap():
    eng = Engine()
    for o in [
        _obs(SignalCode.SUSPECTED_INFECTION, 1.0),
        _obs(SignalCode.PLATELETS, 140),
        _obs(SignalCode.MAP, 69),
        _obs(SignalCode.ANTIBIOTIC_ADMINISTERED, 1.0, minute=20),
        _obs(SignalCode.MAP, 71, minute=90),          # one off-reading: sepsis stops for an evaluation
        _obs(SignalCode.MAP, 69, minute=91),          # sepsis is back
        _obs(SignalCode.MAP, 69, minute=152),
    ]:
        eng.ingest(o, now=o.timestamp)
        if o.timestamp >= T0 + timedelta(minutes=20):
            assert not _kinds(eng) & {"antibiotic_due", "antibiotic_overdue"}, \
                "the antibiotic was given at +20 min: " \
                f"no clock finding at +{(o.timestamp - T0).seconds // 60}"
    assert "sepsis" in _kinds(eng)
    assert eng.recognized_at("bed-3") == T0, "the first recognition's anchor, not a restart at +91"


def test_the_antibiotic_clock_keeps_its_anchor_while_septic_shock_fires_without_the_sepsis_criterion():
    # Recognition is `sepsis` OR `septic_shock` (_RECOGNITION_KINDS). A baseline SOFA charted during
    # shock can take `sepsis` (a RISE of 2) away while the shock criterion still holds; resetting
    # the anchor then would restart an overdue antibiotic's hour in the middle of septic shock (X1).
    from homunculus.state.profile import PatientProfile
    eng = Engine()
    for o in [
        _obs(SignalCode.SUSPECTED_INFECTION, 1.0),
        _obs(SignalCode.WEIGHT_KG, 100),
        _obs(SignalCode.CRYSTALLOID_BOLUS_ML, 3000, minute=-30),
        _obs(SignalCode.MAP, 60),
        _obs(SignalCode.NOREPINEPHRINE_RATE, 0.12),
        _obs(SignalCode.LACTATE, 3.1),
    ]:
        eng.ingest(o, now=o.timestamp)
    assert {"septic_shock", "sepsis"} <= _kinds(eng)
    eng.set_profile(PatientProfile("bed-3", baseline_sofa=4))
    later = _obs(SignalCode.HEART_RATE, 110, minute=75)
    eng.ingest(later, now=later.timestamp)
    assert "sepsis" not in _kinds(eng), "SOFA 4 over a charted baseline of 4 is no rise"
    assert {"septic_shock", "antibiotic_overdue"} <= _kinds(eng)
    assert eng.recognized_at("bed-3") == T0
```

- [ ] **Step 2: Run them and see them fail for the right reason**

```bash
cd /c/tmp/g2a-o17/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_pipeline.py 2>&1 | grep -E "^(FAILED|ERROR)|^E +ModuleNotFoundError|passed|failed|error"
```

Expected:
```
FAILED tests/test_pipeline.py::test_an_alert_whose_rule_stops_firing_leaves_on_the_first_reading_that_does_not_produce_it
FAILED tests/test_pipeline.py::test_when_sepsis_stops_the_antibiotic_alerts_leave_the_board_but_the_clock_keeps_counting
FAILED tests/test_pipeline.py::test_charting_infection_absent_ends_the_episode_and_its_clock
FAILED tests/test_pipeline.py::test_a_corrected_infection_toggle_keeps_the_antibiotic_hour
FAILED tests/test_pipeline.py::test_a_recognition_more_than_15_minutes_after_infection_was_charted_absent_has_its_own_hour
FAILED tests/test_pipeline.py::test_a_new_infection_recognised_within_the_hour_of_a_rule_out_does_not_inherit_its_doses
FAILED tests/test_pipeline.py::test_an_antibiotic_charted_while_infection_was_charted_absent_counts_against_the_restored_hour
FAILED tests/test_pipeline.py::test_a_map_flap_does_not_reset_the_antibiotic_clock
FAILED tests/test_pipeline.py::test_a_treated_patient_does_not_get_a_false_overdue_after_a_map_flap
FAILED tests/test_pipeline.py::test_the_antibiotic_clock_keeps_its_anchor_while_septic_shock_fires_without_the_sepsis_criterion
10 failed, 7 passed in …
```
The reasons: against the base's bucket and anchor — `assert [Alert(… kind='news2' …)] == []` (the bucket kept it), `sepsis` still in the bucket, the anchor neither dropped when infection is charted absent nor restored after a corrected toggle, `antibiotic_overdue` missing at +61 under a MAP flap. `test_an_alert_that_fires_again_is_back_and_another_patient_is_untouched` passes already: the old bucket never let a kind go; it guards the return and the other patient. (Under the first version's rule, before X9, the two flap tests are the reds `71cefee` records.)

- [ ] **Step 3: The anchor — kept through a flap, dropped when infection is charted absent (X9); the clock's findings only while a recognition kind fires**

**Edit** `homunculus-engine/src/homunculus/pipeline.py` — replace:
```python
from homunculus.canonical import Observation
```
with:
```python
from homunculus.canonical import Observation, SignalCode
```

**Edit** `homunculus-engine/src/homunculus/pipeline.py` — replace:
```python
_RECOGNITION_KINDS = {"sepsis", "septic_shock"}
```
with:
```python
_RECOGNITION_KINDS = {"sepsis", "septic_shock"}

#: How long after its drop an antibiotic-clock anchor can still be restored (G2-A1, X12). Charting
#: suspected infection absent and then present again inside this is a correction of the toggle —
#: the same episode, whose hour is still running or already overdue; restarting it turned an
#: antibiotic 10 min overdue into "60 min remaining". The window runs from the drop, not from the
#: anchor, and is a correction's size: a mis-click is put right within minutes. A recognition after
#: it is a second episode with its own hour (D9) — a new infection after a rule-out must not
#: inherit the old anchor, and with it the doses given since (X12 review).
ANCHOR_RESTORE_S = 900
```

**Edit** `homunculus-engine/src/homunculus/pipeline.py` — replace:
```python
        self._recognized_at: dict[str, datetime] = {}
```
with:
```python
        self._recognized_at: dict[str, datetime] = {}
        # X12: an anchor dropped by infection charted absent -> (anchor, when it was dropped).
        self._dropped_anchor: dict[str, tuple[datetime, datetime]] = {}
```

**Edit** `homunculus-engine/src/homunculus/pipeline.py` — replace:
```python
        # Anchor the antibiotic clock the first time sepsis/shock is recognized.
        if obs.patient_id not in self._recognized_at:
            if any(f.kind in _RECOGNITION_KINDS for f in findings):
                self._recognized_at[obs.patient_id] = now

        findings += antibiotic_clock.evaluate(
            state, self._recognized_at.get(obs.patient_id), now
        )
```
with:
```python
        # The antibiotic clock (G2-A1, D9, X1, X9). Recognition is `sepsis` OR `septic_shock`: a
        # baseline SOFA charted during shock can take `sepsis` away while `septic_shock` still
        # holds, and restarting an overdue antibiotic's hour then would hide that it is overdue.
        #  - The anchor is set the first time a recognition kind fires in an episode.
        #  - It is dropped only when suspected infection is charted absent (< 1) while no
        #    recognition kind fires — the episode is over and a later one is a second recognition
        #    with its own hour. (The `None` branch below is defensive only: an anchor can exist
        #    only after infection was charted >= 1.) Sepsis merely stopping is not that: SOFA
        #    reads the latest MAP, so a single reading at 70 or above (MAP 70 scores 0) stops
        #    `sepsis` for one evaluation, and an anchor dropped then would let an untreated sepsis
        #    never go overdue, or give a treated one a false overdue when it came back.
        #  - A dropped anchor is remembered with the time of its drop (X12). A recognition within
        #    ANCHOR_RESTORE_S (15 min) of the drop restores the old anchor: infection charted absent
        #    and present again is a corrected toggle, the same episode, and an antibiotic charted in
        #    the gap counts against the restored hour. A later recognition gets its own anchor,
        #    `now`.
        #  - The antibiotic findings are emitted only while a recognition kind fires in THIS
        #    evaluation, so they leave the board with the sepsis alert (D9); the clock keeps
        #    counting underneath, and a sepsis that fires again shows the true elapsed time.
        recognizing = any(f.kind in _RECOGNITION_KINDS for f in findings)
        infection = state.latest(SignalCode.SUSPECTED_INFECTION)
        if recognizing:
            if obs.patient_id not in self._recognized_at:
                self._recognized_at[obs.patient_id] = self._new_anchor(obs.patient_id, now)
        elif infection is None or infection.value < 1.0:
            dropped = self._recognized_at.pop(obs.patient_id, None)
            if dropped is not None:      # an evaluation with no anchor to drop keeps the first drop's time
                self._dropped_anchor[obs.patient_id] = (dropped, now)

        findings += antibiotic_clock.evaluate(
            state, self._recognized_at.get(obs.patient_id) if recognizing else None, now
        )
```

- [ ] **Step 4: The bucket is the evaluation**

**Edit** `homunculus-engine/src/homunculus/pipeline.py` — replace:
```python
        bucket = self._alerts.setdefault(obs.patient_id, {})
        for a in alerts:
            bucket[a.kind] = a   # latest alert per kind
        return alerts
```
with:
```python
        # The bucket IS this evaluation (G2-A1, D1): exactly the kinds the rules produced for this
        # reading. A kind they did not produce has stopped firing and is gone — no quiet time, no
        # hysteresis. What the API keeps of one (a critical nobody acknowledged) is the API's
        # business (api/alert_lifecycle.py), not the engine's.
        self._alerts[obs.patient_id] = {a.kind: a for a in alerts}
        return alerts

    def _new_anchor(self, patient_id: str, now: datetime) -> datetime:
        """The anchor of a recognition with none running (X12): the anchor dropped at most
        ANCHOR_RESTORE_S ago, restored, or else `now`. Either way the remembered drop is spent."""
        dropped = self._dropped_anchor.pop(patient_id, None)
        if dropped is not None and (now - dropped[1]).total_seconds() <= ANCHOR_RESTORE_S:
            return dropped[0]
        return now
```

- [ ] **Step 5: The two comments that are no longer true**

**Edit** `homunculus-engine/src/homunculus/api/trends.py` — replace:
```python
#: The most alarm-episode rows kept for one patient's window. An episode is a `first_seen` row.
#: Today the engine never drops an alert kind from `active_alerts` (pipeline.py:93–96 only ever sets
#: `bucket[kind]`), so `AckStore.prune` has nothing to drop and `first_seen` is stamped once per
#: (patient, kind): a ▲ on a chart means "the first time this finding was raised for this patient",
#: and a window holds a handful. IF alert episodes are ever cleared and re-raised, a flapping alert
#: would write a `first_seen` row each time it came back — about 30 an hour at one reading a minute,
#: about 2 160 in the 72-hour window — and this bound sits above that. The read is oldest-first
```
with:
```python
#: The most alarm-episode rows kept for one patient's window. An episode is a `first_seen` row.
#: Since G2-A1 (O17) the engine drops a kind from `active_alerts` on the first reading that does not
#: produce it (pipeline.py), the stamp is pruned with it and stamped again when the kind returns: a ▲
#: on a chart means "an alert began here", once per episode. A flapping alert therefore writes a
#: `first_seen` row each time it comes back — about 30 an hour at one reading a minute, about 2 160
#: in the 72-hour window — and this bound sits above that. The read is oldest-first
```

**Edit** `homunculus-engine/tests/test_trends.py` — replace:
```python
    """Today the engine never drops an alert kind from `active_alerts` (pipeline.py:93–96), so
    `first_seen` is stamped once per (patient, kind) and a ▲ means "the first time this finding was
    raised for this patient"; a window holds a handful. IF alert episodes are ever cleared and
    re-raised, `AckStore.prune` would drop the stamp each time and a flapping alert would write a row
    each time it came back — about 30 an hour at one reading a minute, about 2 160 in the 72-hour
    window. The read is oldest-first, so past its limit the NEWEST marks — the end a clinician looks
    at — would be the missing ones; the answer says so instead of drawing a quiet end."""
```
with:
```python
    """Since G2-A1 (O17) an alert clears on the first reading that does not produce it and its
    `first_seen` stamp is pruned with it, so a ▲ means "an alert began here", once per episode, and a
    flapping alert writes a row each time it comes back — about 30 an hour at one reading a minute,
    about 2 160 in the 72-hour window. The read is oldest-first, so past its limit the NEWEST marks —
    the end a clinician looks at — would be the missing ones; the answer says so instead of drawing a
    quiet end."""
```

- [ ] **Step 6: Green, and the neighbours**

```bash
cd /c/tmp/g2a-o17/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_pipeline.py 2>&1 | tail -1
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_pipeline.py tests/test_trends.py tests/test_trends_api.py tests/test_scenarios_e2e.py tests/test_scenarios_hl7_parity.py tests/test_pipeline_model.py tests/test_api_patient_profile.py tests/test_rehydrate.py tests/test_alarm_quality.py 2>&1 | tail -1
```

Expected: `17 passed in …`; then `163 passed, 1 skipped, 3 warnings in …` (`test_pipeline_model.py` skips without `homunculus_ml`). The whole no-DB suite after this task: `2154 passed, 650 skipped`.

- [ ] **Step 7: Line ends**

```bash
cd /c/tmp/g2a-o17
for f in homunculus-engine/src/homunculus/pipeline.py homunculus-engine/tests/test_pipeline.py homunculus-engine/src/homunculus/api/trends.py homunculus-engine/tests/test_trends.py; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected: `pipeline.py CR=150 LF=150`, `test_pipeline.py CR=339 LF=339`, `trends.py CR=196 LF=196`, `test_trends.py CR=376 LF=376`.

- [ ] **Step 8: Commit**

```bash
cd /c/tmp/g2a-o17
git add homunculus-engine/src/homunculus/pipeline.py homunculus-engine/tests/test_pipeline.py homunculus-engine/src/homunculus/api/trends.py homunculus-engine/tests/test_trends.py
git status --short && git diff --cached --stat
git commit -q -F - <<'MSG'
feat(engine): an alert lasts exactly as long as its rule fires; the antibiotic clock survives a flap and a corrected toggle (G2-A1, O17)

The per-patient bucket is rebuilt from every evaluation: active_alerts is
exactly the kinds the rules produced for the last reading (D1). The antibiotic
clock's anchor is set at the first recognition (sepsis or septic_shock, X1),
kept while infection stays charted — a single MAP reading over 70 no longer
resets it (X9) — dropped when suspected infection is charted absent, and
restored when that absence is corrected within ANCHOR_RESTORE_S (X12); its
findings are emitted only while a recognition kind fires (D9). The trend
markers' comments now say a ▲ is the start of an episode.
On the branch: 39812b6, 71cefee, ecef8ae, 71b566c, 7251540.

red: 10 failed, 7 passed in … (the base's bucket kept news2 and sepsis; the anchor was neither dropped on infection charted absent nor restored after a corrected toggle)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
git log --oneline -1
```

---

### Task 2: The lifecycle hook and the latch — `api/alert_lifecycle.py`, `AckStore.resolved`

**Done on the branch** as `4e689a8` (the first version's Task 2, byte for byte) and `5ea2df0` (the Task 2 review: two mutant guards — removing the firing-key deletion re-latched an acknowledged alert on the next normal reading; dropping the patient filter let one bed's reading unlatch another bed's critical; both pass on the code as it was, guards verified by mutation — and the prune keeps every key the store last saw firing, so a skipped hook cannot make another patient's sync drop an ack early). The blocks below are that code. Task 4 edits these files again for its own review (`d268b63`), X14 (`46a282d`) and X13 (`6debbe7`, 8fbcff1): the latch's first-seen, the page, the escalation chain.

Spec D2–D5 and D8, with X2. One function runs after every evaluation and brings the tenant's `AckStore` in line with what fires now; no door calls it yet (Task 4).

The rules, each held by a test below:
- a **critical** whose rule stopped while nobody had acknowledged it latches: `store.resolved[(pid, kind)] = {"alert": asdict(alert), "resolved_at": now}`; it stays a live key and keeps its first-seen;
- HIGH, MODERATE and LOW never latch; their ack, first-seen and escalation flag are pruned (a re-fire is a new episode, D5);
- an **acknowledged** critical leaves with its rule, and an acknowledged latch does not come back on the next normal reading;
- a latched alert loses its escalation flag (only a firing alert escalates, D8); `acknowledge_latched` removes it, pops its first-seen and returns its `Cleared` (`acked_after_resolve`); it returns None for a key that is not latched;
- a latched kind that fires again replaces its latch, with no `Cleared` row, and keeps its first-seen — its episode goes on (§4);
- another patient's state is untouched, and another patient's reading neither clears nor unlatches a critical;
- the notifier pruned with `live_keys` tells a nurse again only for a new episode;
- `Cleared.payload(at)` is exactly D6's `{"first_seen", "at", "reason", "severity"}`.

The hook writes no audit row and takes no notifier: it returns what ended; the doors audit it and prune the notifier with `live_keys` (X2).

**Files:**
- Create: `homunculus-engine/tests/test_alert_lifecycle.py`, `homunculus-engine/src/homunculus/api/alert_lifecycle.py`
- Modify: `homunculus-engine/tests/test_ackstore.py` (appended), `homunculus-engine/src/homunculus/api/ackstore.py`

- [ ] **Step 1: Write the failing tests** — the new file, then make it CRLF like the tree:

**Write** `homunculus-engine/tests/test_alert_lifecycle.py` with exactly this text:
```python
# tests/test_alert_lifecycle.py
"""G2-A1 (O17): what happens to an alert when its rule stops firing (api/alert_lifecycle.py).

A critical alert nobody acknowledged latches until someone does; every other alert, and an
acknowledged critical, leaves with its rule and takes its episode's state with it. Synthetic beds
and made-up values only (CLAUDE.md rule 6)."""
from datetime import datetime, timedelta, timezone

from homunculus.api.ackstore import AckStore
from homunculus.api.alert_lifecycle import (
    ACKED_AFTER_RESOLVE, RESOLVED, Cleared, acknowledge_latched, live_keys, sync_alerts,
)
from homunculus.api.notify import Notifier
from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine

T0 = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)      # the readings' own time
WALL = datetime(2026, 10, 25, 9, 0, tzinfo=timezone.utc)    # the API's wall clock
SHOCK_KEY = ("bed-3", "septic_shock")

# Suspected infection, 100 kg, 30 mL/kg given, MAP 60 on noradrenaline 0.12, lactate 3.1: septic
# shock (CRITICAL), sepsis (HIGH) and the antibiotic clock (antibiotic_due, HIGH).
SHOCK = [(SignalCode.SUSPECTED_INFECTION, 1.0), (SignalCode.WEIGHT_KG, 100),
         (SignalCode.CRYSTALLOID_BOLUS_ML, 3000), (SignalCode.MAP, 60),
         (SignalCode.NOREPINEPHRINE_RATE, 0.12), (SignalCode.LACTATE, 3.1)]


def _evaluate(engine, store, code, value, minute, patient="bed-3"):
    """One reading through the engine and the hook, as the doors run them."""
    o = Observation(patient, code, value, "u", T0 + timedelta(minutes=minute), "dev")
    engine.ingest(o, now=o.timestamp)
    return sync_alerts(engine, store, patient, WALL + timedelta(minutes=minute))


def _stamp(engine, store, minute=0, patient="bed-3"):
    """What the doors do after the hook: a first-seen stamp for every firing kind."""
    for a in engine.active_alerts(patient):
        store.stamp_first_seen(patient, a.kind, WALL + timedelta(minutes=minute))


def _shock():
    engine, store = Engine(), AckStore()
    for code, value in SHOCK:
        assert _evaluate(engine, store, code, value, minute=0) == []
    _stamp(engine, store)
    assert {a.kind for a in engine.active_alerts("bed-3")} == {"septic_shock", "sepsis", "antibiotic_due"}
    return engine, store


def test_a_critical_alert_nobody_acknowledged_latches_when_its_rule_stops():
    engine, store = _shock()
    cleared = _evaluate(engine, store, SignalCode.LACTATE, 1.5, minute=1)    # lactate back under 2
    assert cleared == [Cleared("bed-3", "septic_shock", "critical", WALL, RESOLVED)]
    assert "septic_shock" not in {a.kind for a in engine.active_alerts("bed-3")}
    latched = store.resolved[SHOCK_KEY]
    assert latched["resolved_at"] == WALL + timedelta(minutes=1)
    assert latched["alert"]["summary"] == "Septic shock criteria met"
    assert SHOCK_KEY in live_keys(engine, store), "still on the board, as resolved and unacknowledged"
    assert store.first_seen[SHOCK_KEY] == WALL, "the latch keeps its episode's first-seen"


def test_high_alerts_do_not_latch_and_their_episode_state_is_pruned():
    engine, store = _shock()
    store.acknowledge("bed-3", "sepsis", "ayse", WALL)
    store.escalated.add(("bed-3", "antibiotic_due"))
    cleared = _evaluate(engine, store, SignalCode.SUSPECTED_INFECTION, 0.0, minute=2)  # "no infection"
    assert {(c.kind, c.severity, c.reason) for c in cleared} == {
        ("septic_shock", "critical", RESOLVED), ("sepsis", "high", RESOLVED),
        ("antibiotic_due", "high", RESOLVED)}
    assert set(store.resolved) == {SHOCK_KEY}, "only the unacknowledged critical latches"
    assert store.acks == {} and store.escalated == set()
    assert set(store.first_seen) == {SHOCK_KEY}


def test_a_moderate_alert_leaves_on_the_first_normal_reading():
    engine, store = Engine(), AckStore()
    _evaluate(engine, store, SignalCode.HEART_RATE, 140, minute=0)
    _stamp(engine, store)
    cleared = _evaluate(engine, store, SignalCode.HEART_RATE, 80, minute=1)
    assert cleared == [Cleared("bed-3", "news2", "moderate", WALL, RESOLVED)]
    assert store.resolved == {} and store.first_seen == {} and live_keys(engine, store) == set()


def test_an_acknowledged_critical_leaves_with_its_rule():
    engine, store = _shock()
    store.acknowledge("bed-3", "septic_shock", "ayse", WALL + timedelta(seconds=30))
    cleared = _evaluate(engine, store, SignalCode.LACTATE, 1.5, minute=1)
    assert cleared == [Cleared("bed-3", "septic_shock", "critical", WALL, RESOLVED)]
    assert store.resolved == {}
    assert SHOCK_KEY not in store.acks and SHOCK_KEY not in store.first_seen
    assert SHOCK_KEY not in live_keys(engine, store)


def test_acknowledging_a_latched_alert_removes_it_and_ends_its_episode():
    engine, store = _shock()
    store.escalated.add(SHOCK_KEY)
    _evaluate(engine, store, SignalCode.LACTATE, 1.5, minute=1)
    assert SHOCK_KEY not in store.escalated, "a latched alert is no longer escalated (D8)"
    assert acknowledge_latched(store, "bed-3", "septic_shock") == Cleared(
        "bed-3", "septic_shock", "critical", WALL, ACKED_AFTER_RESOLVE)
    assert store.resolved == {} and SHOCK_KEY not in store.first_seen
    assert SHOCK_KEY not in live_keys(engine, store)
    assert acknowledge_latched(store, "bed-3", "septic_shock") is None, "gone: nothing to remove twice"
    assert acknowledge_latched(store, "bed-3", "sepsis") is None, "a firing alert is not latched"


def test_a_kind_that_fires_again_after_clearing_is_a_new_episode():
    engine, store = Engine(), AckStore()
    _evaluate(engine, store, SignalCode.HEART_RATE, 140, minute=0)
    _stamp(engine, store, minute=0)
    store.acknowledge("bed-3", "news2", "ayse", WALL)
    _evaluate(engine, store, SignalCode.HEART_RATE, 80, minute=1)
    assert _evaluate(engine, store, SignalCode.HEART_RATE, 140, minute=2) == []
    _stamp(engine, store, minute=2)
    assert store.first_seen[("bed-3", "news2")] == WALL + timedelta(minutes=2), "its own first-seen"
    assert ("bed-3", "news2") not in store.acks, "the old answer belongs to the old episode"


def test_a_latched_kind_that_fires_again_replaces_the_latch_without_a_cleared_row():
    engine, store = _shock()
    _evaluate(engine, store, SignalCode.LACTATE, 1.5, minute=1)
    assert _evaluate(engine, store, SignalCode.LACTATE, 3.4, minute=2) == []
    assert store.resolved == {}
    assert "septic_shock" in {a.kind for a in engine.active_alerts("bed-3")}
    assert store.first_seen[SHOCK_KEY] == WALL, "the episode goes on: its first-seen is still its own"


def test_an_acknowledged_latch_does_not_come_back_on_the_next_normal_reading():
    engine, store = _shock()
    _evaluate(engine, store, SignalCode.LACTATE, 1.5, minute=1)
    acknowledge_latched(store, "bed-3", "septic_shock")
    assert _evaluate(engine, store, SignalCode.LACTATE, 1.4, minute=2) == []
    assert store.resolved == {}


def test_the_hook_leaves_another_patient_alone():
    engine, store = Engine(), AckStore()
    _evaluate(engine, store, SignalCode.HEART_RATE, 140, minute=0, patient="bed-4")
    _stamp(engine, store, patient="bed-4")
    store.acknowledge("bed-4", "news2", "ayse", WALL)
    _evaluate(engine, store, SignalCode.HEART_RATE, 140, minute=1)
    _evaluate(engine, store, SignalCode.HEART_RATE, 80, minute=2)
    assert ("bed-4", "news2") in store.acks and ("bed-4", "news2") in store.first_seen


def test_another_patients_reading_neither_clears_nor_unlatches_a_critical():
    engine, store = Engine(), AckStore()
    for code, value in SHOCK:
        _evaluate(engine, store, code, value, minute=0, patient="bed-4")
    _stamp(engine, store, patient="bed-4")
    assert _evaluate(engine, store, SignalCode.HEART_RATE, 80, minute=1) == []
    _evaluate(engine, store, SignalCode.LACTATE, 1.5, minute=2, patient="bed-4")
    assert ("bed-4", "septic_shock") in store.resolved


def test_the_notifier_pruned_with_the_live_keys_tells_a_nurse_again_only_for_a_new_episode():
    engine, store, notifier = Engine(), AckStore(), Notifier()
    for code, value in SHOCK:
        _evaluate(engine, store, code, value, minute=0)
    assert [n.kind for n in notifier.for_new("H", engine.active_alerts("bed-3"))] == ["septic_shock"]
    _evaluate(engine, store, SignalCode.LACTATE, 1.5, minute=1)      # latched: still live
    notifier.prune("H", live_keys(engine, store))
    _evaluate(engine, store, SignalCode.LACTATE, 3.4, minute=2)      # the same episode, firing again
    assert notifier.for_new("H", engine.active_alerts("bed-3")) == []
    store.acknowledge("bed-3", "septic_shock", "ayse", WALL)
    _evaluate(engine, store, SignalCode.LACTATE, 1.5, minute=3)      # acknowledged: it leaves
    notifier.prune("H", live_keys(engine, store))
    _evaluate(engine, store, SignalCode.LACTATE, 3.4, minute=4)      # a new episode
    assert [n.kind for n in notifier.for_new("H", engine.active_alerts("bed-3"))] == ["septic_shock"]


def test_a_cleared_row_says_when_the_episode_began_and_why_it_ended():
    at = WALL + timedelta(minutes=5)
    assert Cleared("bed-3", "news2", "moderate", WALL, RESOLVED).payload(at) == {
        "first_seen": WALL.isoformat(), "at": at.isoformat(), "reason": "resolved",
        "severity": "moderate"}
    assert Cleared("bed-3", "septic_shock", "critical", None, ACKED_AFTER_RESOLVE).payload(at)[
        "first_seen"] is None
```

```bash
cd /c/tmp/g2a-o17
/c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib, sys; [pathlib.Path(p).write_bytes(pathlib.Path(p).read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')) for p in sys.argv[1:]]" homunculus-engine/tests/test_alert_lifecycle.py
```

- [ ] **Step 2: See it fail for the right reason**

```bash
cd /c/tmp/g2a-o17/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_alert_lifecycle.py 2>&1 | grep -E "^(FAILED|ERROR)|^E +ModuleNotFoundError|passed|failed|error"
```

Expected:
```
E   ModuleNotFoundError: No module named 'homunculus.api.alert_lifecycle'
ERROR tests/test_alert_lifecycle.py
!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!
1 error in …
```

- [ ] **Step 3: The store's test**

**Edit** `homunculus-engine/tests/test_ackstore.py` — replace:
```python
    s.escalated.add(("bed-3", "septic_shock"))
    s.prune(live_keys=set())
    assert s.first_seen == {} and s.acks == {} and s.escalated == set()
```
with:
```python
    s.escalated.add(("bed-3", "septic_shock"))
    s.prune(live_keys=set())
    assert s.first_seen == {} and s.acks == {} and s.escalated == set()


def test_prune_with_the_firing_keys_unlatches_a_refired_alert_and_keeps_only_firing_escalations():
    # G2-A1: a latched (resolved) key is live but not firing — it keeps its first-seen and loses
    # its escalation; a latched key that fires again is no longer latched.
    s = AckStore()
    latched, refired = ("bed-3", "septic_shock"), ("bed-4", "septic_shock")
    for key in (latched, refired):
        s.first_seen[key] = T0
        s.escalated.add(key)
        s.resolved[key] = {"alert": {"severity": "critical"}, "resolved_at": T0}
    s.prune(live_keys={latched, refired}, firing_keys={refired})
    assert set(s.first_seen) == {latched, refired}
    assert s.escalated == {refired}
    assert set(s.resolved) == {latched}
```

```bash
cd /c/tmp/g2a-o17/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_ackstore.py 2>&1 | grep -E "^(FAILED|ERROR)|^E +ModuleNotFoundError|passed|failed|error"
```

Expected:
```
FAILED tests/test_ackstore.py::test_prune_with_the_firing_keys_unlatches_a_refired_alert_and_keeps_only_firing_escalations
1 failed, 3 passed in …
```
The reason: `AttributeError: 'AckStore' object has no attribute 'resolved'`.

- [ ] **Step 4: The store keeps the latch and what last fired**

**Edit** `homunculus-engine/src/homunculus/api/ackstore.py` — replace:
```python
# src/homunculus/api/ackstore.py
"""Per-tenant acknowledgement + escalation state, kept OUTSIDE the frozen Alert (which the engine
regenerates on every ingest). Keyed by (patient_id, kind)."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class AckStore:
    acks: dict[tuple[str, str], dict] = field(default_factory=dict)
    first_seen: dict[tuple[str, str], datetime] = field(default_factory=dict)
    escalated: set[tuple[str, str]] = field(default_factory=set)
```
with:
```python
# src/homunculus/api/ackstore.py
"""Per-tenant acknowledgement + escalation state, kept OUTSIDE the frozen Alert (which the engine
regenerates on every ingest). Keyed by (patient_id, kind).

Since G2-A1 (O17) it also keeps what the engine does not: the alerts the lifecycle hook last saw
firing, and the critical ones whose rule stopped before anyone acknowledged them (the latch).
`api/alert_lifecycle.py` maintains both."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from homunculus.reco.engine import Alert


@dataclass
class AckStore:
    acks: dict[tuple[str, str], dict] = field(default_factory=dict)
    first_seen: dict[tuple[str, str], datetime] = field(default_factory=dict)
    escalated: set[tuple[str, str]] = field(default_factory=set)
    # G2-A1, D3: a critical alert whose rule stopped firing while nobody had acknowledged it, kept
    # until someone does — {"alert": the alert as it last fired (asdict), "resolved_at": when}.
    resolved: dict[tuple[str, str], dict] = field(default_factory=dict)
    # G2-A1, X2: what the lifecycle hook last saw firing. The engine's bucket is already replaced
    # when the hook runs, so this is how it knows which kinds an evaluation dropped, and what a
    # latched one said.
    firing: dict[tuple[str, str], Alert] = field(default_factory=dict)
```

**Edit** `homunculus-engine/src/homunculus/api/ackstore.py` — replace:
```python
    def prune(self, live_keys: set[tuple[str, str]]) -> None:
        """Drop state for alert kinds that are no longer active, so a re-raised alert starts fresh."""
        for mapping in (self.acks, self.first_seen):
            for key in [k for k in mapping if k not in live_keys]:
                del mapping[key]
        self.escalated &= live_keys
```
with:
```python
    def prune(self, live_keys: set[tuple[str, str]],
              firing_keys: set[tuple[str, str]] | None = None) -> None:
        """Drop state for alert kinds that are no longer active, so a re-raised alert starts fresh.

        `live_keys` are the kinds still on the board: firing, or latched. With `firing_keys`, the
        ones firing now (G2-A1): only a firing alert can be escalated (D8), and a latched alert
        that fires again is no longer latched — its episode goes on (X2)."""
        for mapping in (self.acks, self.first_seen):
            for key in [k for k in mapping if k not in live_keys]:
                del mapping[key]
        if firing_keys is None:
            self.escalated &= live_keys
            return
        self.escalated &= firing_keys
        for key in [k for k in self.resolved if k in firing_keys]:
            del self.resolved[key]
```

- [ ] **Step 5: The hook** — Write the new module, then make it CRLF:

**Write** `homunculus-engine/src/homunculus/api/alert_lifecycle.py` with exactly this text:
```python
# src/homunculus/api/alert_lifecycle.py
"""What happens to an alert when its rule stops firing (G2-A1, O17).

The engine answers one question — what fires now (pipeline.py rebuilds its bucket from every
evaluation). Everything the ward attached to an alert lives in the tenant's AckStore, keyed by
(patient, kind): its acknowledgement, the instant it was first seen, whether it escalated; the
notifier keeps whether a nurse was told. `sync_alerts` runs after every evaluation — `/ingest`,
`/clinical` and the replay in `rehydrate` — so the three behave alike (D4):

* A kind that stopped firing ends its episode. Its ack, first-seen stamp and escalation flag are
  pruned (the door prunes the notifier's dedup with `live_keys`), so if it fires again it is a NEW
  episode: a new first-seen, a new escalation clock, a new nurse notification (D5).
* Except a critical one nobody acknowledged: it latches (D2). It stays on the board as resolved,
  unacknowledged — its first-seen kept, its escalation flag dropped, for only a firing alert
  escalates (D8) — until a clinician acknowledges it, which removes it (`acknowledge_latched`). A
  transient critical event must not vanish before anyone saw it. HIGH, MODERATE and LOW never
  latch, and an acknowledged critical leaves with its rule.
* A latched kind that fires again is active again: the latch is replaced and its episode goes on —
  no `alert_cleared` row, and the first-seen stamp it kept is still its own.

The hook writes no audit row: it returns what it cleared, the door audits it (`alert_cleared`,
D6), and the replay, which must write nothing, ignores it (D7).
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime

from homunculus.api.ackstore import AckStore
from homunculus.pipeline import Engine

#: The one severity that latches (D2, the user's decision of 2026-10-25).
LATCHING_SEVERITY = "critical"

#: Why an `alert_cleared` row was written (D6).
RESOLVED = "resolved"                         # the rule stopped firing (also as a critical latches)
ACKED_AFTER_RESOLVE = "acked_after_resolve"   # a latched alert was acknowledged, and so removed

Key = tuple[str, str]


@dataclass(frozen=True)
class Cleared:
    """An episode's end, as the `alert_cleared` audit row records it."""
    patient_id: str
    kind: str
    severity: str
    first_seen: datetime | None
    reason: str

    def payload(self, at: datetime) -> dict:
        return {"first_seen": self.first_seen.isoformat() if self.first_seen is not None else None,
                "at": at.isoformat(), "reason": self.reason, "severity": self.severity}


def firing_keys(engine: Engine) -> set[Key]:
    """Every (patient, kind) the last evaluation of each patient produced."""
    return {(pid, a.kind) for pid in engine.patient_ids() for a in engine.active_alerts(pid)}


def live_keys(engine: Engine, store: AckStore) -> set[Key]:
    """The alerts on the board: the firing ones and the latched ones (D4)."""
    return firing_keys(engine) | set(store.resolved)


def sync_alerts(engine: Engine, store: AckStore, patient_id: str, now: datetime) -> list[Cleared]:
    """Bring the store in line with the engine's last evaluation of `patient_id`, and say what
    ended. `now` is the wall clock (the API's; a replay passes the row's own time): a latched
    alert's `resolved_at`."""
    firing_now = {a.kind: a for a in engine.active_alerts(patient_id)}
    cleared: list[Cleared] = []
    dropped = [(key, alert) for key, alert in store.firing.items()
               if key[0] == patient_id and key[1] not in firing_now]
    for key, alert in dropped:
        del store.firing[key]
        cleared.append(Cleared(patient_id, key[1], alert.severity, store.first_seen.get(key), RESOLVED))
        if alert.severity == LATCHING_SEVERITY and key not in store.acks:
            store.resolved[key] = {"alert": asdict(alert), "resolved_at": now}
    for kind, alert in firing_now.items():
        store.firing[(patient_id, kind)] = alert
    # If an evaluation is ever not followed by its hook, another patient's sync must not prune the
    # skipped patient's ack and first-seen before their drop is processed; with every hook run this
    # changes nothing.
    store.prune(live_keys(engine, store) | set(store.firing), firing_keys(engine))
    return cleared


def acknowledge_latched(store: AckStore, patient_id: str, kind: str) -> Cleared | None:
    """A clinician acknowledged a latched alert: it is removed, and its episode ends (D8). None
    when (patient, kind) is not latched — a firing alert is acknowledged the ordinary way."""
    key = (patient_id, kind)
    entry = store.resolved.pop(key, None)
    if entry is None:
        return None
    seen = store.first_seen.pop(key, None)
    store.escalated.discard(key)
    return Cleared(patient_id, kind, entry["alert"]["severity"], seen, ACKED_AFTER_RESOLVE)
```

```bash
cd /c/tmp/g2a-o17
/c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib, sys; [pathlib.Path(p).write_bytes(pathlib.Path(p).read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')) for p in sys.argv[1:]]" homunculus-engine/src/homunculus/api/alert_lifecycle.py
```

- [ ] **Step 6: Green, and the neighbours**

```bash
cd /c/tmp/g2a-o17/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_alert_lifecycle.py tests/test_ackstore.py 2>&1 | tail -1
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_alert_lifecycle.py tests/test_ackstore.py tests/test_board.py tests/test_api_ack.py tests/test_rehydrate.py tests/test_notify.py tests/test_escalation.py tests/test_api_ingest.py tests/test_api_clinical.py 2>&1 | tail -1
```

Expected: `16 passed in …`; then `69 passed, 3 warnings in …`. The whole no-DB suite after this task: `2167 passed, 650 skipped`.

- [ ] **Step 7: Line ends**

```bash
cd /c/tmp/g2a-o17
for f in homunculus-engine/src/homunculus/api/ackstore.py homunculus-engine/src/homunculus/api/alert_lifecycle.py homunculus-engine/tests/test_alert_lifecycle.py homunculus-engine/tests/test_ackstore.py; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected: `ackstore.py CR=56 LF=56`, `alert_lifecycle.py CR=97 LF=97`, `test_alert_lifecycle.py CR=178 LF=178`, `test_ackstore.py CR=43 LF=43`.

- [ ] **Step 8: Commit**

```bash
cd /c/tmp/g2a-o17
git add homunculus-engine/src/homunculus/api/ackstore.py homunculus-engine/src/homunculus/api/alert_lifecycle.py homunculus-engine/tests/test_alert_lifecycle.py homunculus-engine/tests/test_ackstore.py
git status --short && git diff --cached --stat
git commit -q -F - <<'MSG'
feat(api): the alert lifecycle hook — a critical nobody acknowledged latches (G2-A1)

api/alert_lifecycle.py: sync_alerts(engine, store, patient, now) runs after
every evaluation and brings the tenant's AckStore in line with what fires
now. A kind that stopped firing ends its episode — its ack, first-seen stamp
and escalation flag are pruned, so a re-fire is a new episode (D4, D5) —
except a critical nobody acknowledged, which latches as resolved,
unacknowledged until a clinician acknowledges it (D2, D3); a latched kind
that fires again replaces its latch and its episode goes on. The hook writes
no audit row: it returns the Cleared records the doors will audit as
alert_cleared (D6). acknowledge_latched removes a latched alert (D8). The
store keeps what the hook last saw firing (AckStore.firing, X2) and the
prune keeps those keys too. No door calls the hook yet (Task 4).
On the branch: 4e689a8, 5ea2df0.

red: ModuleNotFoundError: homunculus.api.alert_lifecycle (tests/test_alert_lifecycle.py); 1 failed, 3 passed — AttributeError: 'AckStore' object has no attribute 'resolved' (tests/test_ackstore.py)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
git log --oneline -1
```

---

### Task 3: The readers — the board lists a latched critical; the alarm report closes episodes

**Done on the branch** as `83b4c46` (the first version's Task 3, byte for byte) and `4982a5e` (the Task 3 review: two mutant guards — another patient's latch never shows on this card; the older resolution is listed first — and two report fixes: an `acked_after_resolve` row answers an unanswered episode before closing it, and every `resolved` row updates `resolved_at`, so a critical that fired again while latched reports its last stop, as the board does). The blocks below are that code.

Spec D10 and D12, with X4. Readers before writers (X3): nothing latches yet — the doors come in Task 4 — so on a live board `resolved_at` is `null` everywhere after this task.

The rules, each held by a test below:
- every alert dict on the board gains `resolved_at` (`null` while it fires);
- a latched critical is listed **after** the firing alerts, oldest resolution first (not the kinds' alphabet), `acknowledged: false`, `escalated: false`, with its episode's `first_seen_at`, and with the text it last fired with; a card lists only its own patient's latch;
- `risk` is the firing alerts' only: a bed whose only critical is latched is not "critical";
- a kind both firing and latched is listed once, as firing;
- `build_episodes` ends an episode at its `alert_cleared` row; an `alert` row after the end is no repeat of it; a critical that latched stays open for the acknowledgement that removes it and counts as answered, whichever of the acknowledgement's two rows lands first; a latched critical that fires again and stops again reports its last stop; an answered critical ends at `resolved`, and an `escalation` after that finds no episode (X4).

**Files:**
- Modify: `homunculus-engine/tests/test_board.py` (an import, a line in the merge test, the latch helpers and four tests appended), `homunculus-engine/tests/test_alarm_quality.py` (five tests after `test_an_alert_that_clears_and_returns_is_two_episodes`)
- Modify: `homunculus-engine/src/homunculus/api/board.py` (`_merge_alert`, a new `_latched_alerts`, `patient_board`), `homunculus-engine/src/homunculus/api/alarm_quality.py` (the docstring, `Episode`, `build_episodes`)

- [ ] **Step 1: Write the failing tests**

**Edit** `homunculus-engine/tests/test_board.py` — replace:
```python
from datetime import datetime, timezone
```
with:
```python
from datetime import datetime, timedelta, timezone
```

**Edit** `homunculus-engine/tests/test_board.py` — replace:
```python
    d = _merge_alert("bed-3", a, store)
    assert d["acknowledged"] is True
    assert d["acknowledged_by"] == "nurse"
    assert d["escalated"] is True
    assert d["first_seen_at"] == T0.isoformat()
    assert d["kind"] == "septic_shock" and d["supporting_evidence"] == ["sepsis-3-jama-2016"]
```
with:
```python
    d = _merge_alert("bed-3", a, store)
    assert d["acknowledged"] is True
    assert d["acknowledged_by"] == "nurse"
    assert d["escalated"] is True
    assert d["first_seen_at"] == T0.isoformat()
    assert d["kind"] == "septic_shock" and d["supporting_evidence"] == ["sepsis-3-jama-2016"]
    assert d["resolved_at"] is None, "a firing alert has not resolved"


# --- G2-A1 (O17): a latched critical on the board ------------------------------------------------

_SHOCK = [(SignalCode.SUSPECTED_INFECTION, 1.0), (SignalCode.WEIGHT_KG, 100),
          (SignalCode.CRYSTALLOID_BOLUS_ML, 3000), (SignalCode.MAP, 60),
          (SignalCode.NOREPINEPHRINE_RATE, 0.12), (SignalCode.LACTATE, 3.1)]


def _latch_shock(eng, store, patient_id, minutes):
    """`patient_id` in septic shock, first seen at T0; `minutes` later the lactate is back under 2.
    The shock latches — nobody acknowledged it — while sepsis and the antibiotic clock still fire."""
    from homunculus.api.alert_lifecycle import sync_alerts
    for code, value in _SHOCK:
        eng.ingest(Observation(patient_id, code, value, "u", T0, "mon"), now=T0)
        sync_alerts(eng, store, patient_id, T0)
    for a in eng.active_alerts(patient_id):
        store.stamp_first_seen(patient_id, a.kind, T0)
    eng.ingest(Observation(patient_id, SignalCode.LACTATE, 1.5, "u", T0, "lab"), now=T0)
    sync_alerts(eng, store, patient_id, T0 + timedelta(minutes=minutes))


def _latched():
    """bed-3's shock latches two minutes in. bed-4's latches too, three minutes later: another
    patient's latch is in the store the whole time, and no board but bed-4's may list it."""
    eng, store = Engine(), AckStore()
    _latch_shock(eng, store, "bed-3", 2)
    _latch_shock(eng, store, "bed-4", 5)
    return eng, store


def test_a_latched_critical_is_listed_after_the_firing_alerts_and_is_no_part_of_the_risk():
    eng, store = _latched()
    board = patient_board(eng, "bed-3", store)
    kinds = [a["kind"] for a in board["alerts"]]
    assert kinds[-1] == "septic_shock" and set(kinds[:-1]) == {"sepsis", "antibiotic_due"}
    shock = board["alerts"][-1]
    assert shock["resolved_at"] == (T0 + timedelta(minutes=2)).isoformat()
    assert (shock["acknowledged"], shock["acknowledged_by"], shock["escalated"]) == (False, None, False)
    assert shock["first_seen_at"] == T0.isoformat()
    assert (shock["severity"], shock["summary"]) == ("critical", "Septic shock criteria met")
    assert all(a["resolved_at"] is None for a in board["alerts"][:-1])
    assert board["risk"] == "high", "the risk is what fires now (D10): sepsis and the antibiotic clock"


def test_an_alert_both_firing_and_latched_is_listed_once_as_firing():
    # The hook replaces a latch the moment its kind fires again; the board does not rely on it.
    eng, store = _latched()
    eng.ingest(Observation("bed-3", SignalCode.LACTATE, 3.4, "u", T0, "lab"), now=T0)
    shocks = [a for a in patient_board(eng, "bed-3", store)["alerts"] if a["kind"] == "septic_shock"]
    assert len(shocks) == 1 and shocks[0]["resolved_at"] is None


def test_a_card_lists_only_its_own_patients_latched_critical():
    eng, store = _latched()
    assert {("bed-3", "septic_shock"), ("bed-4", "septic_shock")} <= set(store.resolved)
    board = patient_board(eng, "bed-3", store)
    assert all(a["patient_id"] == "bed-3" for a in board["alerts"]), "bed-4's latch is not on bed-3"
    assert [a["kind"] for a in board["alerts"]].count("septic_shock") == 1
    assert len(board["alerts"]) == 3
    # The other way round: bed-4's own card still carries its own latch, resolved when it resolved.
    theirs = [a for a in patient_board(eng, "bed-4", store)["alerts"] if a["resolved_at"] is not None]
    assert [(a["patient_id"], a["kind"], a["resolved_at"]) for a in theirs] == [
        ("bed-4", "septic_shock", (T0 + timedelta(minutes=5)).isoformat())]


def test_latched_criticals_are_listed_oldest_resolution_first():
    """Two criticals latched on bed-3, the shock first and the antibiotic clock an hour later. The
    order is the resolution's, not the kinds' alphabet (antibiotic_overdue sorts before septic_shock)."""
    from homunculus.api.alert_lifecycle import sync_alerts
    eng, store = _latched()
    late = T0 + timedelta(minutes=61)       # the hour is up with no antibiotic charted: overdue, critical
    eng.ingest(Observation("bed-3", SignalCode.HEART_RATE, 90.0, "bpm", late, "mon"), now=late)
    sync_alerts(eng, store, "bed-3", late)
    given = T0 + timedelta(minutes=64)      # then it is given, and the overdue clock stops
    eng.ingest(Observation("bed-3", SignalCode.ANTIBIOTIC_ADMINISTERED, 1.0, "u", given, "mon"), now=given)
    sync_alerts(eng, store, "bed-3", given)
    latched = [(a["kind"], a["resolved_at"]) for a in patient_board(eng, "bed-3", store)["alerts"]
               if a["resolved_at"] is not None]
    assert latched == [("septic_shock", (T0 + timedelta(minutes=2)).isoformat()),
                       ("antibiotic_overdue", given.isoformat())]
```

**Edit** `homunculus-engine/tests/test_alarm_quality.py` — replace:
```python
    def test_an_alert_that_clears_and_returns_is_two_episodes(self):
        records = [rec("first_seen", "bed-1", "sepsis", 0), rec("ack", "bed-1", "sepsis", 2),
                   rec("first_seen", "bed-1", "sepsis", 90), rec("ack", "bed-1", "sepsis", 93)]
        assert alarm_quality(records, _now(200)).episodes == 2
```
with:
```python
    def test_an_alert_that_clears_and_returns_is_two_episodes(self):
        records = [rec("first_seen", "bed-1", "sepsis", 0), rec("ack", "bed-1", "sepsis", 2),
                   rec("first_seen", "bed-1", "sepsis", 90), rec("ack", "bed-1", "sepsis", 93)]
        assert alarm_quality(records, _now(200)).episodes == 2

    def test_two_episodes_of_one_kind_each_end_at_their_alert_cleared_row(self):
        """G2-A1 (O17): a heart rate of 140 → 80 → 140 → 80 is two NEWS2 episodes, each closed when
        its rule stopped. The `alert` row that opens the second one (the door writes it before the
        `first_seen`) is no repeat of the first: that one had ended."""
        records = [rec("alert", "bed-1", "news2", 0), rec("first_seen", "bed-1", "news2", 0),
                   rec("alert_cleared", "bed-1", "news2", 1, reason="resolved", severity="moderate"),
                   rec("alert", "bed-1", "news2", 2), rec("first_seen", "bed-1", "news2", 2),
                   rec("ack", "bed-1", "news2", 2.5, role="ayse"),
                   rec("alert_cleared", "bed-1", "news2", 3, reason="resolved", severity="moderate")]
        episodes = build_episodes(records)
        assert [(e.started, e.resolved_at, e.ended_at) for e in episodes] == [
            (_now(0), _now(1), _now(1)), (_now(2), _now(3), _now(3))]
        report = alarm_quality(records, _now(60))
        assert (report.episodes, report.repeats, report.answered) == (2, 0, 1)

    def test_a_latched_critical_stays_open_until_the_acknowledgement_that_removes_it(self):
        """A critical nobody answered latches when its rule stops (`alert_cleared`, resolved); the
        acknowledgement that removes it — `ack`, then `alert_cleared`, acked_after_resolve — answers
        it. Closed at the first row, that answer would be dropped and the alarm counted as ignored."""
        records = [rec("first_seen", "bed-1", "septic_shock", 0),
                   rec("alert_cleared", "bed-1", "septic_shock", 2, reason="resolved", severity="critical"),
                   rec("ack", "bed-1", "septic_shock", 4, role="ayse"),
                   rec("alert_cleared", "bed-1", "septic_shock", 4, reason="acked_after_resolve",
                       severity="critical")]
        (episode,) = build_episodes(records)
        assert (episode.resolved_at, episode.answered_at, episode.ended_at) == (_now(2), _now(4), _now(4))
        report = alarm_quality(records, _now(60))
        assert (report.answered, report.unanswered, report.median_response_sec) == (1, 0, 240.0)

    def test_a_latched_critical_is_answered_whichever_row_the_acknowledgement_writes_first(self):
        """`/ack` writes two rows for one act, an `ack` and an `alert_cleared` (acked_after_resolve),
        and the report must not hang on their order: the cleared row alone is the acknowledgement."""
        records = [rec("first_seen", "bed-1", "septic_shock", 0),
                   rec("alert_cleared", "bed-1", "septic_shock", 2, reason="resolved", severity="critical"),
                   rec("alert_cleared", "bed-1", "septic_shock", 4, reason="acked_after_resolve",
                       severity="critical"),
                   rec("ack", "bed-1", "septic_shock", 4, role="ayse")]   # lands after the close
        (episode,) = build_episodes(records)
        assert (episode.resolved_at, episode.answered_at, episode.ended_at) == (_now(2), _now(4), _now(4))
        report = alarm_quality(records, _now(60))
        assert (report.answered, report.unanswered, report.median_response_sec) == (1, 0, 240.0)

    def test_a_latched_critical_that_fires_again_and_stops_again_reports_its_last_stop(self):
        """The latch replaces itself when its kind fires again, with no row for the return; the stop
        that follows writes a second `resolved` row, and the board shows that one."""
        records = [rec("first_seen", "bed-1", "septic_shock", 0),
                   rec("alert_cleared", "bed-1", "septic_shock", 2, reason="resolved", severity="critical"),
                   rec("alert_cleared", "bed-1", "septic_shock", 5, reason="resolved", severity="critical"),
                   rec("ack", "bed-1", "septic_shock", 7, role="ayse"),
                   rec("alert_cleared", "bed-1", "septic_shock", 7, reason="acked_after_resolve",
                       severity="critical")]
        (episode,) = build_episodes(records)
        assert (episode.resolved_at, episode.answered_at, episode.ended_at) == (_now(5), _now(7), _now(7))

    def test_an_answered_critical_ends_when_its_rule_stops(self):
        records = [rec("first_seen", "bed-1", "septic_shock", 0),
                   rec("ack", "bed-1", "septic_shock", 1, role="ayse"),
                   rec("alert_cleared", "bed-1", "septic_shock", 2, reason="resolved", severity="critical"),
                   rec("escalation", "bed-1", "septic_shock", 7)]       # no episode is open any more
        (episode,) = build_episodes(records)
        assert (episode.ended_at, episode.escalated) == (_now(2), False)
```

- [ ] **Step 2: Run them and see them fail for the right reason**

```bash
cd /c/tmp/g2a-o17/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_board.py tests/test_alarm_quality.py 2>&1 | grep -E "^(FAILED|ERROR)|^E +ModuleNotFoundError|passed|failed|error"
```

Expected:
```
FAILED tests/test_board.py::test_merge_alert_carries_ack_and_escalation_fields
FAILED tests/test_board.py::test_a_latched_critical_is_listed_after_the_firing_alerts_and_is_no_part_of_the_risk
FAILED tests/test_board.py::test_an_alert_both_firing_and_latched_is_listed_once_as_firing
FAILED tests/test_board.py::test_a_card_lists_only_its_own_patients_latched_critical
FAILED tests/test_board.py::test_latched_criticals_are_listed_oldest_resolution_first
FAILED tests/test_alarm_quality.py::TestTheUnitIsTheEpisode::test_two_episodes_of_one_kind_each_end_at_their_alert_cleared_row
FAILED tests/test_alarm_quality.py::TestTheUnitIsTheEpisode::test_a_latched_critical_stays_open_until_the_acknowledgement_that_removes_it
FAILED tests/test_alarm_quality.py::TestTheUnitIsTheEpisode::test_a_latched_critical_is_answered_whichever_row_the_acknowledgement_writes_first
FAILED tests/test_alarm_quality.py::TestTheUnitIsTheEpisode::test_a_latched_critical_that_fires_again_and_stops_again_reports_its_last_stop
FAILED tests/test_alarm_quality.py::TestTheUnitIsTheEpisode::test_an_answered_critical_ends_when_its_rule_stops
10 failed, 21 passed, 3 warnings in …
```
The reasons: `KeyError: 'resolved_at'` (the merge test and the double-listing test); the latched shock is not on the board (`'antibiotic_due' == 'septic_shock'`); `AttributeError: 'Episode' object has no attribute 'resolved_at'` / `'ended_at'`.

- [ ] **Step 3: The board**

**Edit** `homunculus-engine/src/homunculus/api/board.py` — replace:
```python
        "first_seen_at": seen.isoformat() if seen is not None else None,
        "escalated": key in store.escalated,
    }
```
with:
```python
        "first_seen_at": seen.isoformat() if seen is not None else None,
        "escalated": key in store.escalated,
        # G2-A1 (D10): when its rule stopped firing; None while it fires.
        "resolved_at": None,
    }


def _latched_alerts(patient_id: str, firing: list[Alert], store: AckStore) -> list[dict]:
    """G2-A1 (O17), D2 and D10: this patient's critical alerts whose rule stopped firing while
    nobody had acknowledged them, oldest resolution first, in the firing alerts' shape. Never
    acknowledged and never escalated, by construction: an acknowledgement removes one (`/ack`), and
    only a firing alert escalates. A kind that fires again is listed once, as firing."""
    kinds = {a.kind for a in firing}
    latched = sorted(((key, entry) for key, entry in store.resolved.items()
                      if key[0] == patient_id and key[1] not in kinds),
                     key=lambda item: (item[1]["resolved_at"], item[0][1]))
    out = []
    for key, entry in latched:
        seen = store.first_seen.get(key)
        out.append({
            **entry["alert"],
            "acknowledged": False,
            "acknowledged_by": None,
            "acknowledged_at": None,
            "first_seen_at": seen.isoformat() if seen is not None else None,
            "escalated": False,
            "resolved_at": entry["resolved_at"].isoformat(),
        })
    return out
```

**Edit** `homunculus-engine/src/homunculus/api/board.py` — replace:
```python
        "risk": _risk(alerts),
        "alerts": [_merge_alert(patient_id, a, store) for a in alerts],
```
with:
```python
        # What is happening NOW (G2-A1, D10): the firing alerts only. A latched one — listed after
        # them — is a to-do, not a risk.
        "risk": _risk(alerts),
        "alerts": ([_merge_alert(patient_id, a, store) for a in alerts]
                   + _latched_alerts(patient_id, alerts, store)),
```

- [ ] **Step 4: The alarm-quality report**

**Edit** `homunculus-engine/src/homunculus/api/alarm_quality.py` — replace:
```python
on every ingest, so counting `alert` rows would measure how often the monitor sampled, not how
often the ward was disturbed. `first_seen` is stamped exactly once per episode and re-stamped when
the alert clears and returns, so consecutive `first_seen` events for one (patient, kind) delimit
episodes. Their count is the number of times a person was actually asked to look.
```
with:
```python
on every ingest, so counting `alert` rows would measure how often the monitor sampled, not how
often the ward was disturbed. `first_seen` is stamped exactly once per episode and re-stamped when
the alert clears and returns, so consecutive `first_seen` events for one (patient, kind) delimit
episodes. Their count is the number of times a person was actually asked to look. Since G2-A1
(O17) an episode also ends: at its `alert_cleared` row — or, for a critical nobody had answered,
which latches, at the acknowledgement that removes it.
```

**Edit** `homunculus-engine/src/homunculus/api/alarm_quality.py` — replace:
```python
    escalated: bool = False
    repeats: int = 0          # `alert` rows emitted while this episode was open
```
with:
```python
    escalated: bool = False
    repeats: int = 0          # `alert` rows emitted while this episode was open
    resolved_at: datetime | None = None   # G2-A1: when its rule stopped firing (`alert_cleared`)
    ended_at: datetime | None = None      # when it closed: then, or at the ack that removed a latch
```

**Edit** `homunculus-engine/src/homunculus/api/alarm_quality.py` — replace:
```python
        elif rec.event_type == "escalation":
            episode = open_episode.get(key)
            if episode is not None:
                episode.escalated = True
    return episodes
```
with:
```python
        elif rec.event_type == "escalation":
            episode = open_episode.get(key)
            if episode is not None:
                episode.escalated = True
        elif rec.event_type == "alert_cleared":
            # G2-A1 (O17), D12 with X4: the episode ends here — unless it is a critical nobody had
            # answered, which latched (api/alert_lifecycle.py): it stays open for the ack that
            # removes it, and that ack is its answer. The reasons and the severity are the ones
            # alert_lifecycle writes ("resolved", "acked_after_resolve", "critical").
            episode = open_episode.get(key)
            if episode is None:
                continue
            reason = rec.payload.get("reason")
            # Every stop moves resolved_at: a latched critical that fires again and stops again
            # writes a second `resolved` row, and the board shows that last stop.
            if reason == "resolved" or episode.resolved_at is None:
                episode.resolved_at = when
            # `/ack` writes an `ack` row and this row for one act; the report must not depend on
            # which lands first, so the row that removes a latch is itself the answer.
            if reason == "acked_after_resolve" and episode.answered_at is None:
                episode.answered_at = when or episode.started
            latched = (reason == "resolved"
                       and rec.payload.get("severity") == "critical"
                       and episode.answered_at is None)
            if not latched:
                episode.ended_at = when
                del open_episode[key]
    return episodes
```

- [ ] **Step 5: Green, and the neighbours**

```bash
cd /c/tmp/g2a-o17/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_board.py tests/test_alarm_quality.py 2>&1 | tail -1
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_board.py tests/test_alarm_quality.py tests/test_board_permissions.py tests/test_board_vitals.py tests/test_api_board_bedmap.py tests/test_api_board_identity.py tests/test_api_board_meds.py tests/test_api_board_news2.py tests/test_api_board_sepsis.py tests/test_scope_me_agrees_with_board.py tests/test_trends.py tests/test_trends_api.py 2>&1 | tail -1
```

Expected: `31 passed, 3 warnings in …`; then `189 passed, 10 skipped, 3 warnings in …`. The whole no-DB suite after this task: `2176 passed, 650 skipped`.

- [ ] **Step 6: Line ends**

```bash
cd /c/tmp/g2a-o17
for f in homunculus-engine/src/homunculus/api/board.py homunculus-engine/src/homunculus/api/alarm_quality.py homunculus-engine/tests/test_board.py homunculus-engine/tests/test_alarm_quality.py; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected: `board.py CR=300 LF=300`, `alarm_quality.py CR=248 LF=248`, `test_board.py CR=141 LF=141`, `test_alarm_quality.py CR=272 LF=272`.

- [ ] **Step 7: Commit**

```bash
cd /c/tmp/g2a-o17
git add homunculus-engine/src/homunculus/api/board.py homunculus-engine/src/homunculus/api/alarm_quality.py homunculus-engine/tests/test_board.py homunculus-engine/tests/test_alarm_quality.py
git status --short && git diff --cached --stat
git commit -q -F - <<'MSG'
feat(api): the board lists a latched critical, and the alarm report closes episodes (G2-A1)

Each alert on the board carries resolved_at (null while it fires). A critical
whose rule stopped while nobody had acknowledged it is listed after the
firing alerts, unacknowledged and not escalated, oldest resolution first, on
its own patient's card only; the card's risk is the firing alerts' only
(D10). alarm_quality.build_episodes ends an episode at its alert_cleared row,
except a critical nobody had answered, which stays open for the
acknowledgement that removes it — the acked_after_resolve row is itself the
answer — and every resolved row moves resolved_at (D12, X4). Nothing writes
alert_cleared or a latch yet: the doors come with the replay in Task 4.
On the branch: 83b4c46, 4982a5e.

red: 10 failed, 21 passed, 3 warnings in … (KeyError: 'resolved_at'; AttributeError: 'Episode' object has no attribute 'resolved_at' / 'ended_at')

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
git log --oneline -1
```

---

### Task 4: The writers and the replay — both doors end an episode with its rule; the doctor is paged once per chain; a restart rebuilds it

**Done on the branch** as `23fc805` (the first version's Task 4, byte for byte), `d268b63` (the Task 4 review: the hook runs right after `engine.ingest` in both doors, before any audit write, so an audit failure can no longer leave an unacknowledged critical off the board; the replay ignores an `ack` row for a key that is neither firing nor latched; the latch carries its episode's first-seen; four mutant guards and the O5 pin — its body: "the new tests for the ordering (both doors), the replay guard and the latch's first-seen were seen red first; the four mutant guards and the O5 pin pass on the unchanged code by design"), `46a282d` (X14, the final review), `6debbe7` (X13, the final review; its body's red: `test_a_high_alert_flapping_faster_than_the_escalation_delay_still_reaches_the_doctor_once` — "five minutes after the chain's first sight, saw None"; `test_an_acknowledged_alert_that_returns_within_the_delay_is_unanswered_on_its_chains_clock` — "unanswered, on a clock that started five minutes ago"; `test_a_return_after_a_gap_longer_than_the_escalation_delay_starts_the_clock_over` and `test_a_replay_starts_every_escalation_chain_over_at_its_episodes_first_seen` — `AttributeError: 'AckStore' object has no attribute 'clock_from'`; `test_ackstore.py`, `test_alert_lifecycle.py` — `ImportError: cannot import name 'Chain'`) and 8fbcff1 (X13's review: an acknowledgement ends the chain — the prune remembers no chain for an acknowledged key and `acknowledge_latched` remembers none, so a return after an acknowledgement gets a new clock and a new page (the API's pages: [5, 14] for an acknowledged HIGH that returns unanswered, [5, 15] for an acknowledged latch, [5] for an unanswered chain); `remember_chain` lost its unused `first_seen` parameter and `acknowledge_latched` its `now`; its body's red: 1 page where 2 were due). Also the one comment line of `ackstore.py` that `71cefee` changed (the latch's `first_seen`). The blocks below are that code: replayed onto Tasks 1–3 they give the branch's files byte for byte. One test file is written whole: `test_api_ack.py`, whose escalation tests X13 moved onto an injected wall clock.

Spec D4–D8, with X2, X3, X8, X13 and X14. `/ingest` and `/clinical` run the hook right after every evaluation and audit what it cleared; `/ack` removes a latch; the escalation cycle measures the chain's clock and pages once per chain; `rehydrate` replays every `ingest` and `chart` row through the same hook — in one commit, so that live and restart never disagree.

The rules, each held by a test below (`START` is `septic_shock.yaml`'s 10:00; the shock criterion holds from 11:00):
- a critical that resolves unacknowledged stays on the board with `resolved_at` and `acknowledged: false`; `/ack` → 200 and removes it; the trail reads `first_seen`, `alert_cleared (resolved)`, `ack`, `alert_cleared (acked_after_resolve)` — spec §6.2's order;
- an alert that ended and did not latch is 404 to acknowledge; an acknowledged critical leaves with its rule;
- a latched alert never escalates; a re-fire while latched keeps its episode and its page (O5, X14); the doctor is paged once per episode however often a latched critical returns, and a new episode after an acknowledgement pages anew (X14);
- consecutive unanswered episodes within the escalation delay share one escalation clock and one page — a HIGH immediate alert flapping every two minutes reaches the doctor once, five minutes after the chain's first sight; exactly 5:00 continues the chain, 5:01 restarts it; an acknowledgement ends the chain, so a return after an ack starts a new clock and can page anew (X13);
- `/ingest`: a moderate alert leaves on the first normal reading; a kind that returns after it ended is a new episode and the nurse is told again; an ingest row whose audit fails does not take a critical off the board;
- `/clinical`: charting the antibiotic ends `antibiotic_due`; a critical that charting ends latches, the HIGH `sepsis` does not, and later charting does not stamp it again; a critical that fired and ended inside one request is never stamped; a kind charting ended tells the nurse again when it returns; a shock ended and restarted in one request (`[norepinephrine 0, dopamine 5]`) tells the nurse again (X14); a chart row whose audit fails does not take a critical off the board;
- the store: the page goes with its episode; a chain is remembered, continued within the gap and forgotten after it (X13, X14);
- replay: a critical that resolved unacknowledged is latched again; an `ack` row for a latched alert removes it and leaves no acknowledgement behind; an `ack` row for a kind that is not live answers nothing; a latch made by `/clinical` survives a restart; every escalation chain starts over at its episode's first-seen after a restart (X13, X14); fire, latch, ack, fire, ack, leave, fire, latch, and a NEWS2 that fires, ends and fires again — the restart's board equals the live one alert for alert.

**Files:**
- Write (whole): `homunculus-engine/tests/test_api_ack.py`
- Modify: `homunculus-engine/tests/test_api_ingest.py`, `homunculus-engine/tests/test_api_clinical.py`, `homunculus-engine/tests/test_rehydrate.py`, `homunculus-engine/tests/test_alert_lifecycle.py`, `homunculus-engine/tests/test_ackstore.py`
- Modify: `homunculus-engine/src/homunculus/api/app.py` (the import, `_live_keys` → `_audit_cleared`, the escalation cycle, `/clinical`, `/ingest`, `/ack`), `homunculus-engine/src/homunculus/api/rehydrate.py`, `homunculus-engine/src/homunculus/api/alert_lifecycle.py`, `homunculus-engine/src/homunculus/api/ackstore.py`, `homunculus-engine/src/homunculus/api/escalation.py` (its docstring), `homunculus-engine/src/homunculus/api/audit.py` (a comment)

- [ ] **Step 1: Write the failing tests**

**Write** `homunculus-engine/tests/test_api_ack.py` — the whole file, replacing it — with exactly this text:
```python
# tests/test_api_ack.py
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import homunculus.api.app as app_module
import homunculus.scenarios
from homunculus.api.app import create_app
from homunculus.scenarios.loader import load_scenario

SCEN = Path(homunculus.scenarios.__file__).parent
WALL0 = datetime(2026, 10, 25, 9, 0, tzinfo=timezone.utc)


@pytest.fixture
def anyio_backend():
    return "asyncio"


class _Wall(datetime):
    """The doors' wall clock, set by the test. The escalation clock is wall time, and since X13 the
    gap between an alert's clear and its return decides whether its clock goes on — a gap the real
    clock would make a test wait for."""
    at = WALL0

    @classmethod
    def now(cls, tz=None):
        return cls.at


@pytest.fixture
def wall(monkeypatch):
    _Wall.at = WALL0                  # a test that failed half-way must not leak its time
    monkeypatch.setattr(app_module, "datetime", _Wall)
    return _Wall


def _client():
    return TestClient(create_app({"tok": "HOSP1", "tok2": "HOSP2"}, run_escalation_loop=False))


def _hdr(t):
    return {"Authorization": f"Bearer {t}"}


def _drive_shock(client, token="tok"):
    for _ts, fhir in load_scenario(SCEN / "septic_shock.yaml"):
        client.post("/ingest", json=fhir, headers=_hdr(token))
    return "bed-3"


def test_ack_marks_the_alert_acknowledged_in_the_board():
    c = _client()
    p = _drive_shock(c)
    r = c.post("/ack", json={"patient_id": p, "kind": "septic_shock", "role": "nurse"}, headers=_hdr("tok"))
    assert r.status_code == 200
    board = c.get("/patients", headers=_hdr("tok")).json()["patients"]
    shock = next(a for b in board if b["patient_id"] == p for a in b["alerts"] if a["kind"] == "septic_shock")
    assert shock["acknowledged"] is True
    assert shock["acknowledged_by"] == "nurse"


def test_ack_of_unknown_alert_is_404():
    c = _client()
    _drive_shock(c)
    r = c.post("/ack", json={"patient_id": "bed-3", "kind": "no_such_kind", "role": "nurse"}, headers=_hdr("tok"))
    assert r.status_code == 404


def test_ack_requires_a_tenant_token():
    c = _client()
    assert c.post("/ack", json={"patient_id": "bed-3", "kind": "septic_shock", "role": "nurse"}).status_code == 401


def test_ack_is_tenant_isolated():
    c = _client()
    _drive_shock(c, "tok")
    r = c.post("/ack", json={"patient_id": "bed-3", "kind": "septic_shock", "role": "nurse"}, headers=_hdr("tok2"))
    assert r.status_code == 404


@pytest.mark.anyio
async def test_escalation_cycle_flips_unacked_immediate_alert(wall):
    app = create_app({"tok": "HOSP1"}, escalate_after=timedelta(minutes=5), run_escalation_loop=False)
    client = TestClient(app)
    for _ts, fhir in load_scenario(SCEN / "septic_shock.yaml"):
        client.post("/ingest", json=fhir, headers=_hdr("tok"))     # first seen at WALL0
    store = app.state.ack_stores["HOSP1"]
    key = ("bed-3", "septic_shock")
    await app.state.escalation_cycle(WALL0 + timedelta(minutes=6))
    assert key in store.escalated
    board = client.get("/patients", headers=_hdr("tok")).json()["patients"]
    shock = next(a for b in board if b["patient_id"] == "bed-3" for a in b["alerts"] if a["kind"] == "septic_shock")
    assert shock["escalated"] is True


@pytest.mark.anyio
async def test_ack_clears_escalation(wall):
    app = create_app({"tok": "HOSP1"}, escalate_after=timedelta(minutes=5), run_escalation_loop=False)
    client = TestClient(app)
    for _ts, fhir in load_scenario(SCEN / "septic_shock.yaml"):
        client.post("/ingest", json=fhir, headers=_hdr("tok"))     # first seen at WALL0
    store = app.state.ack_stores["HOSP1"]
    key = ("bed-3", "septic_shock")
    await app.state.escalation_cycle(WALL0 + timedelta(minutes=6))
    assert key in store.escalated
    client.post("/ack", json={"patient_id": "bed-3", "kind": "septic_shock", "role": "doctor"}, headers=_hdr("tok"))
    assert key not in store.escalated


# --- G2-A1 (O17): an alert ends with its rule; a critical nobody acknowledged latches -------------
#
# septic_shock.yaml starts at 10:00 and meets the shock criterion at 11:00 (lactate 3.4). Minutes
# below are from its start; the readings after it are made up, as every value in it is.

START = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)
SHOCK = ("bed-3", "septic_shock")


def _reading(client, code, value, minute, token="tok"):
    fhir = {"resourceType": "Observation", "code": {"coding": [{"system": "x", "code": code}]},
            "subject": {"reference": "Patient/bed-3"},
            "effectiveDateTime": (START + timedelta(minutes=minute)).isoformat(),
            "valueQuantity": {"value": value, "unit": ""}}
    assert client.post("/ingest", json=fhir, headers=_hdr(token)).status_code == 200


def _ack(client, kind="septic_shock"):
    return client.post("/ack", json={"patient_id": "bed-3", "kind": kind, "role": "nurse"},
                       headers=_hdr("tok"))


def _on_board(client, kind="septic_shock"):
    board = client.get("/patients", headers=_hdr("tok")).json()["patients"]
    return next((a for b in board if b["patient_id"] == "bed-3" for a in b["alerts"]
                 if a["kind"] == kind), None)


def _trail(client, kind="septic_shock"):
    rows = client.get("/audit", params={"patient_id": "bed-3", "limit": 10000},
                      headers=_hdr("tok")).json()["records"]
    return [(r["event_type"], r["payload"].get("reason")) for r in rows
            if r["subject"] == kind and r["event_type"] in ("first_seen", "ack", "alert_cleared")]


def test_a_critical_that_resolves_unacknowledged_stays_until_acknowledged_and_the_ack_removes_it():
    c = _client()
    _drive_shock(c)
    _reading(c, "lactate", 1.5, minute=61)              # back under 2: the criterion stops
    shock = _on_board(c)
    assert shock is not None, "a critical nobody saw must not vanish (D2)"
    assert shock["resolved_at"] is not None and shock["acknowledged"] is False
    r = _ack(c)
    assert r.status_code == 200
    assert all(a["kind"] != "septic_shock" for a in r.json()["alerts"])
    assert _on_board(c) is None
    assert _trail(c) == [("first_seen", None), ("alert_cleared", "resolved"), ("ack", None),
                         ("alert_cleared", "acked_after_resolve")]


def test_an_alert_that_ended_and_did_not_latch_is_not_found_to_acknowledge():
    c = _client()
    _drive_shock(c)
    _reading(c, "suspected_infection", 0, minute=61)    # the physician: no infection after all
    assert _on_board(c, "sepsis") is None, "HIGH does not latch"
    assert _ack(c, "sepsis").status_code == 404
    assert _on_board(c)["resolved_at"] is not None, "the unacknowledged shock latched"


def test_an_acknowledged_critical_leaves_with_its_rule():
    c = _client()
    _drive_shock(c)
    assert _ack(c).status_code == 200
    _reading(c, "lactate", 1.5, minute=61)
    assert _on_board(c) is None
    assert _trail(c) == [("first_seen", None), ("ack", None), ("alert_cleared", "resolved")]
    assert _ack(c).status_code == 404


@pytest.mark.anyio
async def test_a_latched_alert_never_escalates_and_its_next_episode_has_its_own_clock(wall):
    app = create_app({"tok": "HOSP1"}, escalate_after=timedelta(minutes=5), run_escalation_loop=False)
    client = TestClient(app)
    _drive_shock(client)                                            # first seen at WALL0
    store = app.state.ack_stores["HOSP1"]
    await app.state.escalation_cycle(WALL0 + timedelta(minutes=6))  # long unanswered
    assert SHOCK in store.escalated
    wall.at = WALL0 + timedelta(minutes=7)
    _reading(client, "lactate", 1.5, minute=61)                     # latched
    assert SHOCK not in store.escalated
    await app.state.escalation_cycle(WALL0 + timedelta(minutes=9))
    assert SHOCK not in store.escalated, "a latched alert is a to-do, not an unanswered active finding"
    assert _on_board(client)["escalated"] is False
    wall.at = WALL0 + timedelta(minutes=10)
    _ack(client)                                                    # removes the latch
    wall.at = WALL0 + timedelta(minutes=16)                         # more than the delay later (X13)
    _reading(client, "lactate", 3.4, minute=62)                     # a new episode, a new chain
    fresh = store.first_seen[SHOCK]
    assert fresh == WALL0 + timedelta(minutes=16)
    await app.state.escalation_cycle(fresh + timedelta(minutes=4))
    assert SHOCK not in store.escalated, "the new episode's clock started at its own first sight"
    await app.state.escalation_cycle(fresh + timedelta(minutes=5))
    assert SHOCK in store.escalated


def _told(client, kind="septic_shock"):
    """What the nurse was told about `kind`: the trigger of each notification, oldest first."""
    rows = client.get("/audit", params={"patient_id": "bed-3", "limit": 10000},
                      headers=_hdr("tok")).json()["records"]
    return [r["payload"]["trigger"] for r in rows
            if r["subject"] == kind and r["event_type"] == "notification"]


def test_a_new_episode_after_an_acknowledged_latch_tells_the_nurse_again():
    """Pins the notifier prune on the latched /ack path (D5): the acknowledgement removes the latch,
    so the kind leaves the live keys, and a critical that comes back is told as a new one."""
    c = _client()
    _drive_shock(c)
    _reading(c, "lactate", 1.5, minute=61)              # latched: the same episode, still told
    assert _ack(c).status_code == 200                   # removed
    _reading(c, "lactate", 3.4, minute=62)              # a new episode
    assert _told(c) == ["new", "new"]


def _pages(client, kind="septic_shock"):
    """How often the doctor was paged about `kind`: the `escalation` audit rows, and the doctor
    notifications that went out with them."""
    rows = client.get("/audit", params={"patient_id": "bed-3", "limit": 10000},
                      headers=_hdr("tok")).json()["records"]
    mine = [r for r in rows if r["subject"] == kind]
    return (sum(r["event_type"] == "escalation" for r in mine),
            sum(r["event_type"] == "notification" and r["payload"]["trigger"] == "escalation"
                for r in mine))


@pytest.mark.anyio
async def test_a_latched_critical_that_returns_pages_the_doctor_once_per_episode(wall):
    """G2-A1 final review: the latch drops `escalated` and each return raises it again, so every
    flap used to read as a fresh escalation — a never-acknowledged shock whose lactate swung 3.4 / 1.5
    every two minutes paged the doctor on each swing. One episode is one page; the board's
    `escalated` flag still follows the clock; an acknowledgement ends the episode, and the next
    one — more than the escalation delay later, so a new chain (X13) — pages anew."""
    app = create_app({"tok": "HOSP1"}, escalate_after=timedelta(minutes=5), run_escalation_loop=False)
    client = TestClient(app)
    _drive_shock(client)
    store = app.state.ack_stores["HOSP1"]
    first = WALL0                                                    # the door's first sight
    cycle_at = first + timedelta(minutes=6)                          # long unanswered
    await app.state.escalation_cycle(cycle_at)
    assert SHOCK in store.escalated and _pages(client) == (1, 1)
    for flap in range(3):
        _reading(client, "lactate", 1.5, minute=61 + 2 * flap)       # latched: off the clock
        await app.state.escalation_cycle(cycle_at)
        assert SHOCK not in store.escalated
        _reading(client, "lactate", 3.4, minute=62 + 2 * flap)       # the same episode, back
        await app.state.escalation_cycle(cycle_at)
        assert SHOCK in store.escalated, "the board's flag follows the clock"
    assert store.first_seen[SHOCK] == first, "never acknowledged: still the first episode"
    assert _pages(client) == (1, 1), "one episode, one page"
    wall.at = first + timedelta(minutes=7)
    _reading(client, "lactate", 1.5, minute=67)                      # latched once more
    assert _ack(client).status_code == 200                           # answered: the episode ends
    assert SHOCK not in store.paged
    wall.at = first + timedelta(minutes=13)                          # more than the delay later
    _reading(client, "lactate", 3.4, minute=68)                      # a new episode, a new chain
    fresh = store.first_seen[SHOCK]
    await app.state.escalation_cycle(fresh + timedelta(minutes=4))
    assert _pages(client) == (1, 1), "the new episode's clock has not run out"
    await app.state.escalation_cycle(fresh + timedelta(minutes=5))
    assert _pages(client) == (2, 2), "a new episode pages the doctor again"


# --- G2-A1, X13: the escalation clock survives a gap of at most the escalation delay -------------
#
# Heart rate 115 and temperature 39.5 score 2 NEWS2 points each. A respiratory rate of 26 adds 3:
# NEWS2 7, a HIGH and immediate `news2`. One of 16 adds none: NEWS2 4 with no single parameter at 3
# raises nothing, so the alert clears. Made-up values on a synthetic bed.

NEWS2 = ("bed-3", "news2")


def _news2_base(client):
    _reading(client, "heart_rate", 115, minute=0)
    _reading(client, "temperature", 39.5, minute=0)


@pytest.mark.anyio
async def test_a_high_alert_flapping_faster_than_the_escalation_delay_still_reaches_the_doctor_once(wall):
    """NEWS2 7 / 4 every two minutes for twenty, never acknowledged. Each return is a new episode — its
    own first sight and a nurse told again (D5) — but none was off the board for longer than the
    escalation delay, so they are one chain on one clock. Before X13 each return restarted the clock,
    no episode lasted five minutes, and the doctor was never paged."""
    app = create_app({"tok": "HOSP1"}, escalate_after=timedelta(minutes=5), run_escalation_loop=False)
    client = TestClient(app)
    _news2_base(client)
    store = app.state.ack_stores["HOSP1"]
    paged_at = None
    for minute in range(21):
        wall.at = WALL0 + timedelta(minutes=minute)
        if minute % 2 == 0:
            _reading(client, "resp_rate", 26 if minute % 4 == 0 else 16, minute=minute)
        await app.state.escalation_cycle(wall.at)
        if paged_at is None and _pages(client, "news2") != (0, 0):
            paged_at = minute
    assert paged_at == 5, f"five minutes after the chain's first sight, saw {paged_at}"
    assert _pages(client, "news2") == (1, 1), "one chain, one page"
    trail = [event for event, _reason in _trail(client, "news2")]
    assert trail.count("first_seen") == 6 and trail.count("alert_cleared") == 5, "six episodes"
    assert _told(client, "news2").count("new") == 6, "the nurse is told of every return (D5)"
    assert store.first_seen[NEWS2] == WALL0 + timedelta(minutes=20), "the board's ▲ is the episode's"
    assert store.clock_from[NEWS2] == WALL0, "the escalation clock is the chain's"
    assert _on_board(client, "news2")["escalated"] is True


@pytest.mark.anyio
async def test_a_return_after_a_gap_longer_than_the_escalation_delay_starts_the_clock_over(wall):
    app = create_app({"tok": "HOSP1"}, escalate_after=timedelta(minutes=5), run_escalation_loop=False)
    client = TestClient(app)
    _news2_base(client)
    store = app.state.ack_stores["HOSP1"]
    _reading(client, "resp_rate", 26, minute=0)                      # first seen at WALL0
    wall.at = WALL0 + timedelta(minutes=2)
    _reading(client, "resp_rate", 16, minute=2)                      # cleared
    wall.at = WALL0 + timedelta(minutes=8)
    _reading(client, "resp_rate", 26, minute=8)                      # back six minutes later
    assert store.clock_from[NEWS2] == store.first_seen[NEWS2] == WALL0 + timedelta(minutes=8)
    await app.state.escalation_cycle(WALL0 + timedelta(minutes=12))
    assert NEWS2 not in store.escalated and _pages(client, "news2") == (0, 0), \
        "a new chain: its clock started at the return, four minutes ago"
    await app.state.escalation_cycle(WALL0 + timedelta(minutes=13))
    assert NEWS2 in store.escalated and _pages(client, "news2") == (1, 1)


@pytest.mark.anyio
async def test_an_acknowledged_alert_that_returns_within_the_delay_starts_a_new_clock(wall):
    """The acknowledgement belongs to the episode it answered (D5): the return is unacknowledged. And
    an answer ends the chain (X13 review): only an episode that ended unanswered leaves one, so the
    return's clock starts at its own first sight, though it came two minutes after the clear."""
    app = create_app({"tok": "HOSP1"}, escalate_after=timedelta(minutes=5), run_escalation_loop=False)
    client = TestClient(app)
    _news2_base(client)
    store = app.state.ack_stores["HOSP1"]
    _reading(client, "resp_rate", 26, minute=0)                      # first seen at WALL0
    wall.at = WALL0 + timedelta(minutes=1)
    assert _ack(client, "news2").status_code == 200
    wall.at = WALL0 + timedelta(minutes=2)
    _reading(client, "resp_rate", 16, minute=2)                      # cleared, answered
    wall.at = WALL0 + timedelta(minutes=4)
    _reading(client, "resp_rate", 26, minute=4)                      # back two minutes later
    news2 = _on_board(client, "news2")
    assert news2["acknowledged"] is False, "the old answer belongs to the old episode"
    assert news2["first_seen_at"] == (WALL0 + timedelta(minutes=4)).isoformat()
    assert store.clock_from[NEWS2] == WALL0 + timedelta(minutes=4), "answered: no chain to continue"
    await app.state.escalation_cycle(WALL0 + timedelta(minutes=5))
    assert NEWS2 not in store.escalated and _pages(client, "news2") == (0, 0), \
        "the answered episode's minutes are not the return's: its clock started a minute ago"
    await app.state.escalation_cycle(WALL0 + timedelta(minutes=9))
    assert NEWS2 in store.escalated and _pages(client, "news2") == (1, 1)


# --- G2-A1, X13 review: an answer ends the chain --------------------------------------------------
#
# The ward minute by minute on the injected wall clock: each minute's readings and acknowledgements,
# then the escalation cycle, as the loop runs it. What is measured is the minute the doctor is paged.


def _answered(client, kind="septic_shock"):
    assert _ack(client, kind).status_code == 200


async def _page_minutes(app, client, wall, script, last, kind):
    """Run minutes 0..`last` of `script` ({minute: [step, ...]}), and say in which minutes the doctor
    was paged about `kind` — each page an `escalation` row and its doctor notification."""
    minutes, seen = [], (0, 0)
    for minute in range(last + 1):
        wall.at = WALL0 + timedelta(minutes=minute)
        for step in script.get(minute, ()):
            step()
        await app.state.escalation_cycle(wall.at)
        pages = _pages(client, kind)
        assert pages[0] == pages[1], "every escalation row has its doctor notification"
        if pages != seen:
            minutes.append(minute)
            seen = pages
    return minutes


@pytest.mark.anyio
async def test_an_acknowledged_high_alert_that_returns_unanswered_within_the_delay_pages_the_doctor_anew(wall):
    """The reviewer's case: NEWS2 7 at 0, the doctor paged at 5, the nurse acknowledges at 6, it clears
    at 7 and is back at 9, and this time nobody answers. Before the review the acknowledged episode
    left its chain — its clock and its page — and the return two minutes later continued it: escalated
    on the board, but never paged. Five minutes unanswered after the return, the doctor is paged."""
    app = create_app({"tok": "HOSP1"}, escalate_after=timedelta(minutes=5), run_escalation_loop=False)
    client = TestClient(app)
    _news2_base(client)
    store = app.state.ack_stores["HOSP1"]
    script = {0: [lambda: _reading(client, "resp_rate", 26, minute=0)],
              6: [lambda: _answered(client, "news2")],
              7: [lambda: _reading(client, "resp_rate", 16, minute=7)],      # cleared, answered
              9: [lambda: _reading(client, "resp_rate", 26, minute=9)]}      # back, unanswered
    assert await _page_minutes(app, client, wall, script, 20, "news2") == [5, 14], \
        "paged five minutes after the first sight, and again five minutes after the return"
    assert store.clock_from[NEWS2] == store.first_seen[NEWS2] == WALL0 + timedelta(minutes=9)


@pytest.mark.anyio
async def test_an_acknowledged_latch_whose_critical_returns_unanswered_within_the_delay_pages_the_doctor_anew(wall):
    """A septic shock paged at 5 latches at 6 and is acknowledged at 8, which removes it; it is back at
    10, unanswered. The acknowledgement ended the episode and its chain, so the return pages anew."""
    app = create_app({"tok": "HOSP1"}, escalate_after=timedelta(minutes=5), run_escalation_loop=False)
    client = TestClient(app)
    _drive_shock(client)                                             # first seen at WALL0
    store = app.state.ack_stores["HOSP1"]
    script = {6: [lambda: _reading(client, "lactate", 1.5, minute=61)],     # latched
              8: [lambda: _answered(client)],                               # the latch removed
              10: [lambda: _reading(client, "lactate", 3.4, minute=62)]}    # back, unanswered
    assert await _page_minutes(app, client, wall, script, 20, "septic_shock") == [5, 15]
    assert store.first_seen[SHOCK] == store.clock_from[SHOCK] == WALL0 + timedelta(minutes=10)


@pytest.mark.anyio
async def test_an_unanswered_high_alert_that_returns_within_the_delay_keeps_its_chain_and_its_one_page(wall):
    """X13, pinned beside the review's rule: nobody answered, so the clear at 3 leaves the chain behind,
    the return at 5 continues it, and the doctor is paged at 5 — five minutes after the first sight —
    and once."""
    app = create_app({"tok": "HOSP1"}, escalate_after=timedelta(minutes=5), run_escalation_loop=False)
    client = TestClient(app)
    _news2_base(client)
    store = app.state.ack_stores["HOSP1"]
    script = {0: [lambda: _reading(client, "resp_rate", 26, minute=0)],
              3: [lambda: _reading(client, "resp_rate", 16, minute=3)],      # cleared, unanswered
              5: [lambda: _reading(client, "resp_rate", 26, minute=5)]}      # back two minutes later
    assert await _page_minutes(app, client, wall, script, 20, "news2") == [5]
    assert store.first_seen[NEWS2] == WALL0 + timedelta(minutes=5), "a new episode (D5)"
    assert store.clock_from[NEWS2] == WALL0, "on its chain's clock"
```

```bash
cd /c/tmp/g2a-o17
/c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib, sys; [pathlib.Path(p).write_bytes(pathlib.Path(p).read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')) for p in sys.argv[1:]]" homunculus-engine/tests/test_api_ack.py
```

**Edit** `homunculus-engine/tests/test_api_ingest.py` — replace:
```python
from homunculus.api.app import create_app
from homunculus.scenarios.loader import load_scenario
```
with:
```python
from homunculus.api.app import create_app
from homunculus.api.audit import InMemoryAuditLog
from homunculus.scenarios.loader import load_scenario
```

**Edit** `homunculus-engine/tests/test_api_ingest.py` — replace:
```python
def test_patients_requires_a_tenant_token():
    c = _client()
    assert c.get("/patients").status_code == 401
```
with:
```python
def test_patients_requires_a_tenant_token():
    c = _client()
    assert c.get("/patients").status_code == 401


# --- G2-A1 (O17): an alert ends on the first reading that does not produce it ---------------------

def _alerts_of(c, patient="bed-3"):
    board = c.get("/patients", headers=_hdr("tok-hosp1")).json()["patients"]
    return [a["kind"] for b in board if b["patient_id"] == patient for a in b["alerts"]]


def _rows(c, kind, *types):
    rows = c.get("/audit", params={"patient_id": "bed-3", "limit": 10000},
                 headers=_hdr("tok-hosp1")).json()["records"]
    return [r for r in rows if r["subject"] == kind and r["event_type"] in types]


def test_a_moderate_alert_leaves_the_board_on_the_first_normal_reading():
    c = _client()
    c.post("/ingest", json=_fhir("heart_rate", 140, "/min"), headers=_hdr("tok-hosp1"))
    assert _alerts_of(c) == ["news2"], "140/min alone: a single red parameter, NEWS2 moderate"
    c.post("/ingest", json=_fhir("heart_rate", 80, "/min", when="2026-07-14T10:01:00+00:00"),
           headers=_hdr("tok-hosp1"))
    assert _alerts_of(c) == []
    (opened,) = _rows(c, "news2", "first_seen")
    (closed,) = _rows(c, "news2", "alert_cleared")
    assert (closed["payload"]["reason"], closed["payload"]["severity"]) == ("resolved", "moderate")
    assert closed["payload"]["first_seen"] == opened["payload"]["at"]


def test_a_kind_that_returns_after_it_ended_is_a_new_episode_and_a_nurse_is_told_again():
    c = _client()
    for _ts, fhir in load_scenario(SCEN / "septic_shock.yaml"):
        c.post("/ingest", json=fhir, headers=_hdr("tok-hosp1"))
    c.post("/ack", json={"patient_id": "bed-3", "kind": "septic_shock", "role": "nurse"},
           headers=_hdr("tok-hosp1"))
    for value, when in [(1.5, "2026-07-14T11:01:00+00:00"), (3.4, "2026-07-14T11:02:00+00:00")]:
        c.post("/ingest", json=_fhir("lactate", value, "mmol/L", when=when), headers=_hdr("tok-hosp1"))
    trail = [r["event_type"] for r in _rows(c, "septic_shock", "first_seen", "notification", "alert_cleared")]
    assert trail == ["first_seen", "notification", "alert_cleared", "first_seen", "notification"]
    shock = next(a for b in c.get("/patients", headers=_hdr("tok-hosp1")).json()["patients"]
                 for a in b["alerts"] if a["kind"] == "septic_shock")
    assert shock["acknowledged"] is False, "the old answer belongs to the old episode (D5)"


class _FailsOnce(InMemoryAuditLog):
    """An audit log whose next append of `fail_on` raises once — the database going away
    mid-request."""

    def __init__(self):
        super().__init__()
        self.fail_on = None

    def append(self, event):
        if event.event_type == self.fail_on:
            self.fail_on = None
            raise RuntimeError("audit down")
        return super().append(event)


def test_an_ingest_row_that_fails_to_audit_does_not_take_a_critical_off_the_board():
    """The lifecycle hook follows the evaluation directly, before any audit write: the engine has
    already moved on when the audit fails, and an unacknowledged critical that cleared on that
    request must still be on the next read, latched — not missing until some later reading."""
    audit = _FailsOnce()
    c = TestClient(create_app(TENANTS, run_escalation_loop=False, audit=audit),
                   raise_server_exceptions=False)
    for _ts, fhir in load_scenario(SCEN / "septic_shock.yaml"):
        assert c.post("/ingest", json=fhir, headers=_hdr("tok-hosp1")).status_code == 200
    audit.fail_on = "ingest"
    r = c.post("/ingest", json=_fhir("lactate", 1.5, "mmol/L", when="2026-07-14T11:01:00+00:00"),
               headers=_hdr("tok-hosp1"))
    assert r.status_code == 500
    shock = next((a for b in c.get("/patients", headers=_hdr("tok-hosp1")).json()["patients"]
                  for a in b["alerts"] if a["kind"] == "septic_shock"), None)
    assert shock is not None, "an unacknowledged critical must not vanish (D2)"
    assert shock["resolved_at"] is not None and shock["acknowledged"] is False
```

**Edit** `homunculus-engine/tests/test_api_clinical.py` — replace:
```python
from homunculus.api.app import create_app
from homunculus.api.clinical import ClinicalEntryError, build_entries
```
with:
```python
from homunculus.api.app import create_app
from homunculus.api.audit import InMemoryAuditLog
from homunculus.api.clinical import ClinicalEntryError, build_entries
```

**Edit** `homunculus-engine/tests/test_api_clinical.py` — replace:
```python
def _chart(client, patient_id: str, entries: list[dict], at: datetime = WHEN):
```
with:
```python
class _FailsOnce(InMemoryAuditLog):
    """An audit log whose next append of `fail_on` raises once — the database going away
    mid-request."""

    def __init__(self):
        super().__init__()
        self.fail_on = None

    def append(self, event):
        if event.event_type == self.fail_on:
            self.fail_on = None
            raise RuntimeError("audit down")
        return super().append(event)


def _chart(client, patient_id: str, entries: list[dict], at: datetime = WHEN):
```

**Edit** `homunculus-engine/tests/test_api_clinical.py` — replace:
```python
        built = build_entries("bed-1", codes, charted_by="u", recorded_at=WHEN)
        assert {e.observation.code for e in built} == {
            SignalCode.ARTERIAL_PH, SignalCode.BICARBONATE, SignalCode.SODIUM,
            SignalCode.POTASSIUM, SignalCode.HAEMATOCRIT, SignalCode.WHITE_CELL_COUNT}
```
with:
```python
        built = build_entries("bed-1", codes, charted_by="u", recorded_at=WHEN)
        assert {e.observation.code for e in built} == {
            SignalCode.ARTERIAL_PH, SignalCode.BICARBONATE, SignalCode.SODIUM,
            SignalCode.POTASSIUM, SignalCode.HAEMATOCRIT, SignalCode.WHITE_CELL_COUNT}


class TestChartingEndsAnAlert:
    """G2-A1 (O17): charting is often what ends an alert — the antibiotic given, the infection
    ruled out — and this door ends it exactly as /ingest does."""

    def _rows(self, client, kind, event_type):
        rows = client.get("/audit", params={"patient_id": "bed-3", "limit": 10000},
                          headers=AUTH).json()["records"]
        return [r for r in rows if r["subject"] == kind and r["event_type"] == event_type]

    def _alert(self, client, kind):
        board = client.get("/patients", headers=AUTH).json()["patients"]
        return next((a for b in board for a in b["alerts"] if a["kind"] == kind), None)

    def _ingest(self, client, code, value, minute):
        fhir = {"resourceType": "Observation", "code": {"coding": [{"system": "x", "code": code}]},
                "subject": {"reference": "Patient/bed-3"},
                "effectiveDateTime": (WHEN + timedelta(minutes=minute)).isoformat(),
                "valueQuantity": {"value": value, "unit": ""}}
        assert client.post("/ingest", json=fhir, headers=AUTH).status_code == 200

    def test_charting_the_antibiotic_ends_the_clock_and_its_episode(self, client):
        _chart(client, "bed-3", [
            {"code": "suspected_infection", "value": 1}, {"code": "platelets", "value": 80}])
        _chart(client, "bed-3", [{"code": "creatinine", "value": 2.4}])
        assert self._alert(client, "antibiotic_due") is not None
        _chart(client, "bed-3", [{"code": "antibiotic_administered", "value": 1}],
               at=WHEN + timedelta(minutes=20))
        assert self._alert(client, "antibiotic_due") is None
        (closed,) = self._rows(client, "antibiotic_due", "alert_cleared")
        assert (closed["payload"]["reason"], closed["payload"]["severity"]) == ("resolved", "high")

    def test_a_critical_that_charting_ends_latches_until_it_is_acknowledged(self, client):
        _chart(client, "bed-3", [
            {"code": "suspected_infection", "value": 1}, {"code": "lactate", "value": 3.4},
            {"code": "norepinephrine_rate", "value": 0.08}, {"code": "weight_kg", "value": 50}])
        _chart(client, "bed-3", [{"code": "crystalloid_bolus_ml", "value": 1600}])
        assert self._alert(client, "septic_shock")["resolved_at"] is None
        _chart(client, "bed-3", [{"code": "suspected_infection", "value": 0}],
               at=WHEN + timedelta(minutes=10))
        shock = self._alert(client, "septic_shock")
        assert shock["resolved_at"] is not None and shock["acknowledged"] is False
        assert self._alert(client, "sepsis") is None, "HIGH does not latch"
        _chart(client, "bed-3", [{"code": "lactate", "value": 3.0}], at=WHEN + timedelta(minutes=15))
        assert len(self._rows(client, "septic_shock", "first_seen")) == 1, \
            "a latched alert keeps its episode's stamp: charting does not open another"

    def test_a_critical_that_fired_and_ended_in_one_request_is_never_stamped(self, client):
        """Charting stamps this patient's FIRING alerts only: a latched one was never seen firing
        here, and a stamp now would open an episode after its end."""
        _chart(client, "bed-3", [
            {"code": "suspected_infection", "value": 1}, {"code": "lactate", "value": 3.4},
            {"code": "norepinephrine_rate", "value": 0.08}, {"code": "weight_kg", "value": 50},
            {"code": "crystalloid_bolus_ml", "value": 1600},
            {"code": "suspected_infection", "value": 0}])
        assert self._alert(client, "septic_shock")["resolved_at"] is not None, "it latched"
        _chart(client, "bed-3", [{"code": "lactate", "value": 3.0}], at=WHEN + timedelta(minutes=5))
        assert self._rows(client, "septic_shock", "first_seen") == []

    def test_a_kind_charting_ended_tells_the_nurse_again_when_it_returns(self, client):
        """Pins the notifier prune on this door (D5): charting that ends an acknowledged alert takes
        the kind out of the live keys, so a later reading that brings it back is a new episode."""
        for code, value in [("suspected_infection", 1.0), ("weight_kg", 100.0),
                            ("crystalloid_bolus_ml", 3000.0), ("map", 60.0),
                            ("norepinephrine_rate", 0.12), ("lactate", 3.1)]:
            self._ingest(client, code, value, minute=0)
        r = client.post("/ack", json={"patient_id": "bed-3", "kind": "septic_shock", "role": "nurse"},
                        headers=AUTH)
        assert r.status_code == 200
        _chart(client, "bed-3", [{"code": "suspected_infection", "value": 0}],
               at=WHEN + timedelta(minutes=1))
        assert self._alert(client, "septic_shock") is None, "answered, so it left with its rule"
        self._ingest(client, "suspected_infection", 1.0, minute=2)
        assert [r["payload"]["trigger"] for r in self._rows(client, "septic_shock", "notification")] \
            == ["new", "new"]

    def test_a_shock_ended_and_restarted_in_one_request_tells_the_nurse_again(self, client):
        """Pins the notifier prune after EACH entry (D5): `[norepinephrine 0, dopamine 5]` ends an
        acknowledged shock and starts a new one inside one request. The acknowledgement is lost, as
        a new episode's should be; the nurse's dedup has to be re-armed between the two entries, or
        the end-of-request prune finds the shock live again and the new episode goes untold. This
        door tells nobody itself — the next reading of the bed does."""
        for code, value in [("suspected_infection", 1.0), ("weight_kg", 100.0),
                            ("crystalloid_bolus_ml", 3000.0), ("map", 60.0),
                            ("norepinephrine_rate", 0.12), ("lactate", 3.1)]:
            self._ingest(client, code, value, minute=0)
        r = client.post("/ack", json={"patient_id": "bed-3", "kind": "septic_shock", "role": "nurse"},
                        headers=AUTH)
        assert r.status_code == 200
        _chart(client, "bed-3", [{"code": "norepinephrine_rate", "value": 0},
                                 {"code": "dopamine_rate", "value": 5}],
               at=WHEN + timedelta(minutes=1))
        shock = self._alert(client, "septic_shock")
        assert shock is not None and shock["acknowledged"] is False, "a new episode: not answered"
        self._ingest(client, "map", 60.0, minute=2)
        assert [r["payload"]["trigger"] for r in self._rows(client, "septic_shock", "notification")] \
            == ["new", "new"]

    def test_a_chart_row_that_fails_to_audit_does_not_take_a_critical_off_the_board(self):
        """The lifecycle hook follows the evaluation directly, before any audit write: an audit
        that fails mid-request cannot leave an unacknowledged critical off the board."""
        audit = _FailsOnce()
        app = create_app({TOKEN: "h1"}, run_escalation_loop=False, audit=audit)
        with TestClient(app, raise_server_exceptions=False) as c:
            _chart(c, "bed-3", [
                {"code": "suspected_infection", "value": 1}, {"code": "lactate", "value": 3.4},
                {"code": "norepinephrine_rate", "value": 0.08}, {"code": "weight_kg", "value": 50},
                {"code": "crystalloid_bolus_ml", "value": 1600}])
            assert self._alert(c, "septic_shock")["resolved_at"] is None
            audit.fail_on = "chart"
            ended = _chart(c, "bed-3", [{"code": "suspected_infection", "value": 0}],
                           at=WHEN + timedelta(minutes=10))
            assert ended.status_code == 500
            shock = self._alert(c, "septic_shock")
            assert shock is not None, "an unacknowledged critical must not vanish (D2)"
            assert shock["resolved_at"] is not None and shock["acknowledged"] is False
```

**Edit** `homunculus-engine/tests/test_rehydrate.py` — replace:
```python
# tests/test_rehydrate.py
from datetime import datetime, timezone

from homunculus.api.ackstore import AckStore
from homunculus.api.audit import AuditEvent, InMemoryAuditLog
```
with:
```python
# tests/test_rehydrate.py
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from homunculus.api.ackstore import AckStore
from homunculus.api.app import create_app
from homunculus.api.audit import AuditEvent, InMemoryAuditLog
```

**Edit** `homunculus-engine/tests/test_rehydrate.py` — replace:
```python
def test_a_replayed_username_survives_whole():
    """128, not the device path's 64: a signed-in user's username may be that long."""
    assert _replayed_by("ayse") == "ayse"
    assert _replayed_by("u" * 128) == "u" * 128
    assert _replayed_by("r" * 64) == "r" * 64
```
with:
```python
def test_a_replayed_username_survives_whole():
    """128, not the device path's 64: a signed-in user's username may be that long."""
    assert _replayed_by("ayse") == "ayse"
    assert _replayed_by("u" * 128) == "u" * 128
    assert _replayed_by("r" * 64) == "r" * 64


# --- G2-A1 (O17): the replay runs the lifecycle hook the doors run --------------------------------

SHOCK = ("bed-3", "septic_shock")


def _latched_audit():
    """The shock fires and is first seen; then the lactate is back under 2 and nobody had
    acknowledged it — live, it latched."""
    audit = _audit_with_shock()
    audit.append(AuditEvent("HOSP1", "first_seen", "bed-3", "septic_shock", {"at": T0}))
    audit.append(AuditEvent("HOSP1", "ingest", "bed-3", "lactate",
                            {"value": 1.5, "unit": "", "obs_ts": T0, "device": "lab"}))
    return audit


def test_a_critical_that_resolved_unacknowledged_is_latched_again_by_the_replay():
    audit = _latched_audit()
    engine, store = Engine(), AckStore()
    rehydrate(engine, store, audit.records(tenant="HOSP1"))
    assert "septic_shock" not in {a.kind for a in engine.active_alerts("bed-3")}
    assert set(store.resolved) == {SHOCK}
    assert store.resolved[SHOCK]["resolved_at"] == datetime.fromisoformat(audit.records(tenant="HOSP1")[-1].ts)
    assert store.first_seen[SHOCK] == datetime.fromisoformat(T0)


def test_an_ack_row_for_a_latched_alert_removes_it_on_replay_and_is_no_acknowledgement():
    audit = _latched_audit()
    audit.append(AuditEvent("HOSP1", "ack", "bed-3", "septic_shock", {"role": "ayse", "at": T0}))
    engine, store = Engine(), AckStore()
    rehydrate(engine, store, audit.records(tenant="HOSP1"))
    assert store.resolved == {}
    assert SHOCK not in store.first_seen and SHOCK not in store.acks


def test_a_replay_starts_every_escalation_chain_over_at_its_episodes_first_seen():
    """G2-A1, X13: the escalation chain is not in the audit log. Replayed, an episode's clock is its
    own `first_seen` row and no cleared chain is remembered: after a restart a chain starts over, as
    `paged` and `escalated` do."""
    audit = _audit_with_shock()
    for kind in ("septic_shock", "sepsis"):
        audit.append(AuditEvent("HOSP1", "first_seen", "bed-3", kind, {"at": T0}))
    audit.append(AuditEvent("HOSP1", "ingest", "bed-3", "suspected_infection",
                            {"value": 0.0, "unit": "", "obs_ts": T0, "device": "lab"}))
    engine, store = Engine(), AckStore()
    rehydrate(engine, store, audit.records(tenant="HOSP1"))
    assert set(store.resolved) == {SHOCK}, "the shock latched; sepsis (HIGH) ended"
    assert store.clock_from == store.first_seen == {SHOCK: datetime.fromisoformat(T0)}
    assert store.recent == {}, "sepsis ended inside the replay: its chain is not carried past the restart"


def test_an_ack_row_for_a_kind_that_is_not_live_does_not_answer_a_later_episode():
    """The live door answers 404 to an ack for an alert that is neither firing nor latched, so such
    a row is not an acknowledgement of anything — and recorded, a later episode of the same kind
    would inherit it."""
    audit = _audit_with_shock()
    audit.append(AuditEvent("HOSP1", "ingest", "bed-3", "suspected_infection",
                            {"value": 0.0, "unit": "", "obs_ts": T0, "device": "lab"}))   # sepsis ends
    audit.append(AuditEvent("HOSP1", "ack", "bed-3", "sepsis", {"role": "ayse", "at": T0}))
    audit.append(AuditEvent("HOSP1", "ingest", "bed-3", "suspected_infection",
                            {"value": 1.0, "unit": "", "obs_ts": T0, "device": "lab"}))   # and returns
    engine, store = Engine(), AckStore()
    rehydrate(engine, store, audit.records(tenant="HOSP1"))
    assert "sepsis" in {a.kind for a in engine.active_alerts("bed-3")}
    assert ("bed-3", "sepsis") not in store.acks, "a new episode: nobody has answered it"


def test_a_latch_made_by_clinical_requests_survives_a_restart():
    """`chart` rows run through the same hook as `ingest` rows. Without it the replay would drop a
    critical that charting ended — the antibiotic given, the infection ruled out — while the ward
    still has it on its board, unacknowledged."""
    audit = InMemoryAuditLog()
    hdr = {"Authorization": "Bearer tok"}
    start = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)

    def boot():
        app = create_app({"tok": "HOSP1"}, run_escalation_loop=False, audit=audit)
        client = TestClient(app)
        client.get("/patients", headers=hdr)          # builds the tenant: rehydrated from the audit
        return app, client

    def chart(client, entries, minute):
        r = client.post("/clinical/bed-3", headers=hdr, json={
            "entries": entries, "recorded_at": (start + timedelta(minutes=minute)).isoformat()})
        assert r.status_code == 200, r.text

    live_app, live = boot()
    chart(live, [{"code": "suspected_infection", "value": 1}, {"code": "lactate", "value": 3.4},
                 {"code": "norepinephrine_rate", "value": 0.08}, {"code": "weight_kg", "value": 50}], 0)
    chart(live, [{"code": "crystalloid_bolus_ml", "value": 1600}], 1)
    chart(live, [{"code": "suspected_infection", "value": 0}], 10)       # the shock's rule stops
    live_store = live_app.state.ack_stores["HOSP1"]
    assert set(live_store.resolved) == {SHOCK}

    restarted_app, _ = boot()
    again = restarted_app.state.ack_stores["HOSP1"]
    assert set(again.resolved) == set(live_store.resolved)
    assert again.resolved[SHOCK]["alert"] == live_store.resolved[SHOCK]["alert"]


def test_a_restart_rebuilds_the_board_the_ward_had_episode_by_episode():
    """Fire, clear, re-fire, acknowledge — through the API, then a fresh engine and store from its
    audit trail. The replay must hand each episode its own stamp and its own answer: the one a
    restart got wrong before (the code map's question 1)."""
    import json
    from datetime import timedelta
    from fastapi.testclient import TestClient
    from homunculus.api.app import create_app
    from homunculus.api.audit import AuditRecord
    from homunculus.api.board import patient_board

    start = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)
    client = TestClient(create_app({"tok": "HOSP1"}, run_escalation_loop=False))
    hdr = {"Authorization": "Bearer tok"}

    def reading(code, value, minute):
        fhir = {"resourceType": "Observation", "code": {"coding": [{"system": "x", "code": code}]},
                "subject": {"reference": "Patient/bed-3"},
                "effectiveDateTime": (start + timedelta(minutes=minute)).isoformat(),
                "valueQuantity": {"value": value, "unit": ""}}
        assert client.post("/ingest", json=fhir, headers=hdr).status_code == 200

    def ack(kind):
        assert client.post("/ack", json={"patient_id": "bed-3", "kind": kind, "role": "nurse"},
                           headers=hdr).status_code == 200

    for code, value in _SHOCK:
        reading(code, value, 0)                   # episode 1 of the shock, unanswered
    reading("lactate", 1.5, 1)                    # it latches
    ack("septic_shock")                           # and the ack removes it
    reading("lactate", 3.4, 2)                    # episode 2
    ack("septic_shock")
    reading("lactate", 1.5, 3)                    # it leaves, answered
    reading("lactate", 3.6, 4)                    # episode 3, unanswered
    reading("lactate", 1.4, 5)                    # it latches
    reading("heart_rate", 140, 6)                 # NEWS2: fires,
    reading("heart_rate", 80, 7)                  # ends,
    reading("heart_rate", 140, 8)                 # and fires again

    def alerts(board):
        board = json.loads(json.dumps(board))
        return [{**a, "resolved_at": a["resolved_at"] is not None} for a in board["alerts"]], board["risk"]

    live = next(b for b in client.get("/patients", headers=hdr).json()["patients"]
                if b["patient_id"] == "bed-3")
    records = [AuditRecord(**r) for r in client.get(
        "/audit", params={"limit": 100000}, headers=hdr).json()["records"]]
    engine, store = Engine(), AckStore()
    rehydrate(engine, store, records)
    assert alerts(patient_board(engine, "bed-3", store)) == alerts(live)
    stamps = [r.payload["at"] for r in records if r.event_type == "first_seen" and r.subject == "septic_shock"]
    assert len(stamps) == 3
    shock = next(a for a in live["alerts"] if a["kind"] == "septic_shock")
    assert (shock["first_seen_at"], shock["acknowledged"]) == (stamps[-1], False), \
        "the latch is episode 3's: its own stamp, and no answer inherited from episode 2"
```

**Edit** `homunculus-engine/tests/test_alert_lifecycle.py` — replace:
```python
from homunculus.api.ackstore import AckStore
```
with:
```python
from homunculus.api.ackstore import AckStore, Chain
```

**Edit** `homunculus-engine/tests/test_alert_lifecycle.py` — replace:
```python
def test_an_acknowledged_latch_does_not_come_back_on_the_next_normal_reading():
```
with:
```python
def test_a_critical_that_fires_again_while_latched_keeps_its_episode_and_a_fresh_clock_follows_only_an_acknowledgement():
    """O5: nobody has answered the first firing, so the second is the same episode — the clock that
    escalates it keeps running from the first sight. Only an acknowledgement ends the episode."""
    engine, store = _shock()                                                      # first seen at WALL
    _evaluate(engine, store, SignalCode.LACTATE, 1.5, minute=1)                   # latched
    assert _evaluate(engine, store, SignalCode.LACTATE, 3.4, minute=2) == []      # firing again
    _stamp(engine, store, minute=2)                                               # the door's stamp
    assert store.first_seen[SHOCK_KEY] == WALL, "unacknowledged: still the first episode"
    _evaluate(engine, store, SignalCode.LACTATE, 1.5, minute=3)                   # latched again
    assert store.first_seen[SHOCK_KEY] == WALL
    acknowledge_latched(store, "bed-3", "septic_shock")                           # answered: it ends
    _evaluate(engine, store, SignalCode.LACTATE, 3.4, minute=4)
    _stamp(engine, store, minute=4)
    assert store.first_seen[SHOCK_KEY] == WALL + timedelta(minutes=4), "now a new episode, a new clock"


def test_the_page_belongs_to_the_episode_a_latch_keeps_it_and_an_ending_takes_it():
    """The doctor is paged once per episode (final review): the record of it lives and dies with the
    episode's first-seen — kept through a latch and a return, gone with an acknowledgement or with
    a rule that ended for good."""
    engine, store = _shock()
    store.paged.update({SHOCK_KEY, ("bed-3", "sepsis")})
    _evaluate(engine, store, SignalCode.LACTATE, 1.5, minute=1)                   # latched
    assert SHOCK_KEY in store.paged and ("bed-3", "sepsis") in store.paged
    _evaluate(engine, store, SignalCode.LACTATE, 3.4, minute=2)                   # the same episode
    assert SHOCK_KEY in store.paged, "a return is not a new episode: it is not paged again"
    _evaluate(engine, store, SignalCode.LACTATE, 1.5, minute=3)                   # latched again
    _evaluate(engine, store, SignalCode.SUSPECTED_INFECTION, 0.0, minute=4)       # sepsis ends for good
    assert ("bed-3", "sepsis") not in store.paged
    assert SHOCK_KEY in store.paged, "a latch is still the episode"
    acknowledge_latched(store, "bed-3", "septic_shock")
    assert SHOCK_KEY not in store.paged, "answered: the next episode can page"


def test_a_latch_carries_its_episodes_first_seen_to_the_cleared_record_of_its_acknowledgement():
    engine, store = _shock()
    _evaluate(engine, store, SignalCode.LACTATE, 1.5, minute=1)
    assert store.resolved[SHOCK_KEY]["first_seen"] == WALL
    del store.first_seen[SHOCK_KEY]                       # the stamp is gone, the latch still has it
    assert acknowledge_latched(store, "bed-3", "septic_shock") == Cleared(
        "bed-3", "septic_shock", "critical", WALL, ACKED_AFTER_RESOLVE)


def test_a_latch_of_an_alert_that_was_never_stamped_has_no_first_seen_to_carry():
    """Fired and ended inside one /clinical request: no door stamped it."""
    engine, store = Engine(), AckStore()
    for code, value in SHOCK:
        _evaluate(engine, store, code, value, minute=0)
    _evaluate(engine, store, SignalCode.LACTATE, 1.5, minute=1)
    assert store.resolved[SHOCK_KEY]["first_seen"] is None
    assert acknowledge_latched(store, "bed-3", "septic_shock") == Cleared(
        "bed-3", "septic_shock", "critical", None, ACKED_AFTER_RESOLVE)


def test_an_acknowledged_latch_does_not_come_back_on_the_next_normal_reading():
```

**Edit** `homunculus-engine/tests/test_alert_lifecycle.py` — replace:
```python
    assert Cleared("bed-3", "septic_shock", "critical", None, ACKED_AFTER_RESOLVE).payload(at)[
        "first_seen"] is None
```
with:
```python
    assert Cleared("bed-3", "septic_shock", "critical", None, ACKED_AFTER_RESOLVE).payload(at)[
        "first_seen"] is None


# --- G2-A1, X13: an episode that returns within the escalation delay continues its chain ---------

GAP = timedelta(minutes=5)
NEWS2_KEY = ("bed-3", "news2")


def _stamp_chained(engine, store, minute, patient="bed-3"):
    """The doors' stamp since X13: told the escalation delay, so a return can continue its chain."""
    for a in engine.active_alerts(patient):
        store.stamp_first_seen(patient, a.kind, WALL + timedelta(minutes=minute), chain_gap=GAP)


def test_the_hook_remembers_a_cleared_episodes_chain_at_the_time_it_ran():
    engine, store = Engine(), AckStore()
    _evaluate(engine, store, SignalCode.HEART_RATE, 140, minute=0)
    _stamp_chained(engine, store, minute=0)
    _evaluate(engine, store, SignalCode.HEART_RATE, 80, minute=1)
    assert store.recent[NEWS2_KEY] == Chain(clock_from=WALL, cleared_at=WALL + timedelta(minutes=1),
                                            paged=False)
    assert NEWS2_KEY not in store.clock_from


def test_a_return_within_the_delay_is_a_new_episode_on_its_chains_escalation_clock():
    engine, store = Engine(), AckStore()
    _evaluate(engine, store, SignalCode.HEART_RATE, 140, minute=0)
    _stamp_chained(engine, store, minute=0)
    _evaluate(engine, store, SignalCode.HEART_RATE, 80, minute=1)                 # cleared, unanswered
    _evaluate(engine, store, SignalCode.HEART_RATE, 140, minute=3)
    _stamp_chained(engine, store, minute=3)
    assert store.first_seen[NEWS2_KEY] == WALL + timedelta(minutes=3), "a new episode (D5)"
    assert store.clock_from[NEWS2_KEY] == WALL, "two minutes off the board: the chain's clock goes on"


def test_an_acknowledged_episode_that_clears_leaves_no_chain_and_its_return_starts_a_new_clock():
    """An answer ends the chain (X13 review): only an episode that ended unanswered leaves one. Its
    answered minutes are not a return's unanswered ones, and a return's page is its own."""
    engine, store = Engine(), AckStore()
    _evaluate(engine, store, SignalCode.HEART_RATE, 140, minute=0)
    _stamp_chained(engine, store, minute=0)
    store.paged.add(NEWS2_KEY)
    store.acknowledge("bed-3", "news2", "ayse", WALL + timedelta(minutes=1))
    _evaluate(engine, store, SignalCode.HEART_RATE, 80, minute=2)                 # cleared, answered
    assert store.recent == {}, "an answered episode leaves no chain"
    _evaluate(engine, store, SignalCode.HEART_RATE, 140, minute=3)
    _stamp_chained(engine, store, minute=3)
    assert store.first_seen[NEWS2_KEY] == store.clock_from[NEWS2_KEY] == WALL + timedelta(minutes=3)
    assert NEWS2_KEY not in store.acks, "the old answer belongs to the old episode"
    assert NEWS2_KEY not in store.paged, "a new chain: the doctor can be paged for it"


def test_an_acknowledged_latch_leaves_no_chain_and_its_return_starts_a_new_clock():
    """The acknowledgement that removes a latch ends its episode, and — an answer — its chain too. The
    replay's call (api/rehydrate.py) is the same one: a restart rebuilds no chain."""
    engine, store = _shock()
    store.paged.add(SHOCK_KEY)
    _evaluate(engine, store, SignalCode.LACTATE, 1.5, minute=1)                   # latched
    assert SHOCK_KEY not in store.recent, "still on the board: the chain is live"
    assert store.clock_from[SHOCK_KEY] == WALL
    acknowledge_latched(store, "bed-3", "septic_shock")
    assert store.recent == {}, "answered: no chain is left behind"
    assert SHOCK_KEY not in store.clock_from and SHOCK_KEY not in store.paged
    _evaluate(engine, store, SignalCode.LACTATE, 3.4, minute=4)
    _stamp_chained(engine, store, minute=4)
    assert store.first_seen[SHOCK_KEY] == WALL + timedelta(minutes=4), "a new episode"
    assert store.clock_from[SHOCK_KEY] == WALL + timedelta(minutes=4) and SHOCK_KEY not in store.paged, \
        "two minutes after the acknowledgement, and a new chain: its own clock, its own page"
```

**Edit** `homunculus-engine/tests/test_ackstore.py` — replace:
```python
from datetime import datetime, timezone

from homunculus.api.ackstore import AckStore
```
with:
```python
from datetime import datetime, timedelta, timezone

from homunculus.api.ackstore import AckStore, Chain
```

**Edit** `homunculus-engine/tests/test_ackstore.py` — replace:
```python
    assert set(s.first_seen) == {latched, refired}
    assert s.escalated == {refired}
    assert set(s.resolved) == {latched}
```
with:
```python
    assert set(s.first_seen) == {latched, refired}
    assert s.escalated == {refired}
    assert set(s.resolved) == {latched}


def test_prune_forgets_a_page_with_its_episode_and_keeps_it_while_the_alert_is_live():
    # G2-A1 final review: `paged` is scoped to the episode like first_seen. A key still on the board
    # (firing, or latched) keeps it — a flap inside one episode must not page twice — and a key that
    # left the board loses it, so the next episode can page.
    s = AckStore()
    latched, gone = ("bed-3", "septic_shock"), ("bed-4", "septic_shock")
    s.paged |= {latched, gone}
    s.prune(live_keys={latched}, firing_keys=set())
    assert s.paged == {latched}
    s.prune(live_keys=set())
    assert s.paged == set()


# --- G2-A1, X13: the escalation chain ------------------------------------------------------------
#
# Consecutive episodes of one (patient, kind) whose gap — from the clear to the next first sight —
# is at most the escalation delay share one escalation clock and one page to the doctor.

GAP = timedelta(minutes=5)
NEWS2 = ("bed-3", "news2")


def _minutes(m):
    return T0 + timedelta(minutes=m)


def test_a_first_stamp_starts_the_escalation_chain_at_the_first_sight():
    s = AckStore()
    assert s.stamp_first_seen("bed-3", "news2", T0, chain_gap=GAP) is True
    assert s.first_seen[NEWS2] == s.clock_from[NEWS2] == T0
    assert s.stamp_first_seen("bed-3", "news2", _minutes(1), chain_gap=GAP) is False
    assert s.clock_from[NEWS2] == T0


def test_a_cleared_episode_is_remembered_as_its_chain_and_its_state_is_pruned():
    s = AckStore()
    s.stamp_first_seen("bed-3", "news2", T0, chain_gap=GAP)
    s.paged.add(NEWS2)
    s.prune(live_keys=set(), firing_keys=set(), now=_minutes(2))
    assert NEWS2 not in s.first_seen and NEWS2 not in s.clock_from and NEWS2 not in s.paged
    assert s.recent[NEWS2] == Chain(clock_from=T0, cleared_at=_minutes(2), paged=True)


def test_an_acknowledged_episode_that_leaves_the_board_leaves_no_chain():
    # X13 review: an answer ends the chain. Only an episode that ended unanswered is remembered.
    s = AckStore()
    s.stamp_first_seen("bed-3", "news2", T0, chain_gap=GAP)
    s.paged.add(NEWS2)
    s.acknowledge("bed-3", "news2", "nurse", _minutes(1))
    s.prune(live_keys=set(), firing_keys=set(), now=_minutes(2))
    assert s.recent == {}
    assert NEWS2 not in s.acks and NEWS2 not in s.clock_from and NEWS2 not in s.paged
    s.stamp_first_seen("bed-3", "news2", _minutes(3), chain_gap=GAP)
    assert s.clock_from[NEWS2] == _minutes(3) and NEWS2 not in s.paged


def test_a_live_key_keeps_its_chain_clock_and_is_not_remembered():
    s = AckStore()
    s.stamp_first_seen("bed-3", "news2", T0, chain_gap=GAP)
    s.prune(live_keys={NEWS2}, firing_keys=set(), now=_minutes(2))   # latched: still on the board
    assert s.clock_from[NEWS2] == T0 and s.recent == {}


def test_an_episode_that_returns_within_the_gap_continues_its_chain_and_its_page():
    s = AckStore()
    s.stamp_first_seen("bed-3", "news2", T0, chain_gap=GAP)
    s.paged.add(NEWS2)
    s.prune(live_keys=set(), firing_keys=set(), now=_minutes(2))
    assert s.stamp_first_seen("bed-3", "news2", _minutes(7), chain_gap=GAP) is True   # a gap of exactly 5
    assert s.first_seen[NEWS2] == _minutes(7), "a new episode: its own first sight"
    assert s.clock_from[NEWS2] == T0, "the chain's escalation clock goes on"
    assert NEWS2 in s.paged, "the doctor was paged for this chain already"
    assert s.recent == {}


def test_a_return_after_more_than_the_gap_starts_a_new_chain():
    s = AckStore()
    s.stamp_first_seen("bed-3", "news2", T0, chain_gap=GAP)
    s.paged.add(NEWS2)
    s.prune(live_keys=set(), firing_keys=set(), now=_minutes(2))
    late = _minutes(7) + timedelta(seconds=1)
    s.stamp_first_seen("bed-3", "news2", late, chain_gap=GAP)
    assert s.clock_from[NEWS2] == late and NEWS2 not in s.paged and s.recent == {}


def test_a_remembered_chain_is_forgotten_once_its_gap_has_passed():
    s = AckStore()
    s.stamp_first_seen("bed-3", "news2", T0, chain_gap=GAP)
    s.prune(live_keys=set(), firing_keys=set(), now=_minutes(1))
    s.stamp_first_seen("bed-4", "news2", _minutes(5), chain_gap=GAP)    # 4 min after the clear
    assert NEWS2 in s.recent
    s.stamp_first_seen("bed-5", "news2", _minutes(7), chain_gap=GAP)    # 6 min after it
    assert NEWS2 not in s.recent, "past the gap: dropped on the next stamp, not kept forever"


def test_without_a_gap_or_a_clear_time_every_episode_has_its_own_clock():
    """The pre-X13 calls: a prune that is not told when it ran remembers nothing, and a stamp that is
    not told the gap continues no chain."""
    s = AckStore()
    s.stamp_first_seen("bed-3", "news2", T0)
    s.prune(live_keys=set())
    assert s.recent == {} and s.clock_from == {}
    s.stamp_first_seen("bed-3", "news2", _minutes(1), chain_gap=GAP)
    s.prune(live_keys=set(), now=_minutes(2))
    s.stamp_first_seen("bed-3", "news2", _minutes(3))
    assert s.clock_from[NEWS2] == _minutes(3)
```

- [ ] **Step 2: Run them and see them fail for the right reason**

```bash
cd /c/tmp/g2a-o17/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_api_ack.py tests/test_api_ingest.py tests/test_api_clinical.py tests/test_rehydrate.py 2>&1 | grep -E "^(FAILED|ERROR)|^E +ModuleNotFoundError|passed|failed|error"
```

Expected:
```
FAILED tests/test_api_ack.py::test_a_critical_that_resolves_unacknowledged_stays_until_acknowledged_and_the_ack_removes_it
FAILED tests/test_api_ack.py::test_an_alert_that_ended_and_did_not_latch_is_not_found_to_acknowledge
FAILED tests/test_api_ack.py::test_an_acknowledged_critical_leaves_with_its_rule
FAILED tests/test_api_ack.py::test_a_latched_alert_never_escalates_and_its_next_episode_has_its_own_clock
FAILED tests/test_api_ack.py::test_a_new_episode_after_an_acknowledged_latch_tells_the_nurse_again
FAILED tests/test_api_ack.py::test_a_latched_critical_that_returns_pages_the_doctor_once_per_episode
FAILED tests/test_api_ack.py::test_a_high_alert_flapping_faster_than_the_escalation_delay_still_reaches_the_doctor_once
FAILED tests/test_api_ack.py::test_a_return_after_a_gap_longer_than_the_escalation_delay_starts_the_clock_over
FAILED tests/test_api_ack.py::test_an_acknowledged_alert_that_returns_within_the_delay_starts_a_new_clock
FAILED tests/test_api_ack.py::test_an_acknowledged_high_alert_that_returns_unanswered_within_the_delay_pages_the_doctor_anew
FAILED tests/test_api_ack.py::test_an_acknowledged_latch_whose_critical_returns_unanswered_within_the_delay_pages_the_doctor_anew
FAILED tests/test_api_ack.py::test_an_unanswered_high_alert_that_returns_within_the_delay_keeps_its_chain_and_its_one_page
FAILED tests/test_api_ingest.py::test_a_moderate_alert_leaves_the_board_on_the_first_normal_reading
FAILED tests/test_api_ingest.py::test_a_kind_that_returns_after_it_ended_is_a_new_episode_and_a_nurse_is_told_again
FAILED tests/test_api_ingest.py::test_an_ingest_row_that_fails_to_audit_does_not_take_a_critical_off_the_board
FAILED tests/test_api_clinical.py::TestChartingEndsAnAlert::test_charting_the_antibiotic_ends_the_clock_and_its_episode
FAILED tests/test_api_clinical.py::TestChartingEndsAnAlert::test_a_critical_that_charting_ends_latches_until_it_is_acknowledged
FAILED tests/test_api_clinical.py::TestChartingEndsAnAlert::test_a_critical_that_fired_and_ended_in_one_request_is_never_stamped
FAILED tests/test_api_clinical.py::TestChartingEndsAnAlert::test_a_kind_charting_ended_tells_the_nurse_again_when_it_returns
FAILED tests/test_api_clinical.py::TestChartingEndsAnAlert::test_a_shock_ended_and_restarted_in_one_request_tells_the_nurse_again
FAILED tests/test_api_clinical.py::TestChartingEndsAnAlert::test_a_chart_row_that_fails_to_audit_does_not_take_a_critical_off_the_board
FAILED tests/test_rehydrate.py::test_a_critical_that_resolved_unacknowledged_is_latched_again_by_the_replay
FAILED tests/test_rehydrate.py::test_an_ack_row_for_a_latched_alert_removes_it_on_replay_and_is_no_acknowledgement
FAILED tests/test_rehydrate.py::test_a_replay_starts_every_escalation_chain_over_at_its_episodes_first_seen
FAILED tests/test_rehydrate.py::test_an_ack_row_for_a_kind_that_is_not_live_does_not_answer_a_later_episode
FAILED tests/test_rehydrate.py::test_a_latch_made_by_clinical_requests_survives_a_restart
FAILED tests/test_rehydrate.py::test_a_restart_rebuilds_the_board_the_ward_had_episode_by_episode
27 failed, 39 passed, 3 warnings in …
```

And the two unit files, which import what Task 4 adds (`Chain`, X13), stop at collection:

```bash
cd /c/tmp/g2a-o17/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_alert_lifecycle.py tests/test_ackstore.py 2>&1 | grep -E "^E +ImportError|^ERROR|error"
```

Expected:
```
E   ImportError: cannot import name 'Chain' from 'homunculus.api.ackstore' (…\homunculus-engine\src\homunculus\api\ackstore.py)
E   ImportError: cannot import name 'Chain' from 'homunculus.api.ackstore' (…\homunculus-engine\src\homunculus\api\ackstore.py)
ERROR tests/test_alert_lifecycle.py
ERROR tests/test_ackstore.py
!!!!!!!!!!!!!!!!!!! Interrupted: 2 errors during collection !!!!!!!!!!!!!!!!!!!
2 errors in …
```
The reasons: the latched shock vanished (`a critical nobody saw must not vanish (D2)`); no `alert_cleared` rows; the replay did not latch and left the old episode's stamp; acknowledging a latch is 404 (`assert 404 == 200`); `AttributeError: 'AckStore' object has no attribute 'clock_from'` / `'paged'` in the escalation tests.

- [ ] **Step 3: The doors** — eight Edits in `app.py`, in this order.

The import:

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
from homunculus.api.ackstore import AckStore
from homunculus.api.alarm_quality import alarm_quality
```
with:
```python
from homunculus.api.ackstore import AckStore
from homunculus.api.alarm_quality import alarm_quality
from homunculus.api.alert_lifecycle import Cleared, acknowledge_latched, live_keys, sync_alerts
```

`_live_keys` goes (its callers use `live_keys(engine, store)`, firing ∪ latched); `_audit_cleared` comes; the escalation cycle sees the firing alerts only (it already did — D1 — and now says why):

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
    def _live_keys(engine: Engine) -> set[tuple[str, str]]:
        return {(pid, a.kind) for pid in engine.patient_ids() for a in engine.active_alerts(pid)}

    async def _escalation_cycle(now: datetime) -> None:
        for hospital, engine in list(engines.items()):
            store = _store(hospital)
            alerts = [(pid, a) for pid in engine.patient_ids() for a in engine.active_alerts(pid)]
            newly = escalate(alerts, store.acks, store.first_seen, now, escalate_after)
```
with:
```python
    def _audit_cleared(hospital: str, cleared: list[Cleared], at: datetime) -> None:
        """G2-A1, D6: an episode's end is audited as its start (`first_seen`) is — the alarm-quality
        report reads both. A restart does not replay these: they follow from the rows it does."""
        for item in cleared:
            audit.append(AuditEvent(hospital, "alert_cleared", item.patient_id, item.kind,
                                    item.payload(at)))

    async def _escalation_cycle(now: datetime) -> None:
        for hospital, engine in list(engines.items()):
            store = _store(hospital)
            # The firing alerts only (G2-A1, D8): a latched one is a to-do, not an unanswered
            # active finding, and does not escalate.
            alerts = [(pid, a) for pid in engine.patient_ids() for a in engine.active_alerts(pid)]
            # The chain's clock, not the episode's first sight (X13): an alert that clears
            # unanswered and returns within `escalate_after` is still unanswered on the clock it
            # started.
            newly = escalate(alerts, store.acks, store.clock_from, now, escalate_after)
```

The escalation cycle pages the doctor once per episode (X12, the final review `46a282d`):

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
                if added:
                    alert_by_key = {(pid, a.kind): a for (pid, a) in alerts}
                    for key in added:
                        audit.append(AuditEvent(hospital, "escalation", key[0], key[1],
                                                {"at": now.isoformat()}))
                    for note in notifier.for_escalation(hospital, added, alert_by_key):
```
with:
```python
                # One page per chain (G2-A1 final review, X13): `escalated` follows the clock, so a
                # critical that latches and returns, or an alert that clears and returns within the
                # delay, is "added" again — but the doctor was told about this chain already. A new
                # chain pages anew.
                to_page = added - store.paged
                if to_page:
                    store.paged |= to_page
                    alert_by_key = {(pid, a.kind): a for (pid, a) in alerts}
                    for key in to_page:
                        audit.append(AuditEvent(hospital, "escalation", key[0], key[1],
                                                {"at": now.isoformat()}))
                    for note in notifier.for_escalation(hospital, to_page, alert_by_key):
```

`/clinical` runs the hook after each entry (X8):

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
        engine = _engine(hospital)
        store = _store(hospital)
        alerts: list = []
        for item in charted:
            obs = item.observation
            alerts = engine.ingest(obs, now=obs.timestamp)
            audit.append(AuditEvent(hospital, "chart", obs.patient_id, obs.code.value,
                                    {"value": obs.value, "unit": obs.unit,
                                     "obs_ts": obs.timestamp.isoformat(),
                                     "charted_by": item.charted_by}))
        for a in alerts:
```
with:
```python
        engine = _engine(hospital)
        store = _store(hospital)
        alerts: list = []
        for item in charted:
            obs = item.observation
            alerts = engine.ingest(obs, now=obs.timestamp)
            # G2-A1: the lifecycle hook after every evaluation, as /ingest runs it and as the
            # replay runs it after every `chart` row, so a restart rebuilds exactly this (D4, D7).
            # Charting is often what ends an alert: the antibiotic given, the fluid that was due.
            # Right after the evaluation and before any audit write, as in /ingest: if the audit
            # fails from here on, an unacknowledged critical is still on the board. `charted` is
            # never empty (build_entries refuses that), so `now` is set for the stamps below.
            now = datetime.now(timezone.utc)
            cleared = sync_alerts(engine, store, obs.patient_id, now)
            # Re-arm the nurse's dedup after EACH entry, not only after the last: `[norepinephrine 0,
            # dopamine 5]` ends an acknowledged shock and starts a new one inside this loop, and the
            # end-of-request prune would find it live again and keep the old episode's dedup (D5).
            notifier.prune(hospital, live_keys(engine, store))
            audit.append(AuditEvent(hospital, "chart", obs.patient_id, obs.code.value,
                                    {"value": obs.value, "unit": obs.unit,
                                     "obs_ts": obs.timestamp.isoformat(),
                                     "charted_by": item.charted_by}))
            _audit_cleared(hospital, cleared, now)
        for a in alerts:
```

`/clinical` stamps this patient's firing alerts only, and prunes the notifier:

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
        # five-minute grace over again after a deploy, and nothing looked broken.
        now = datetime.now(timezone.utc)
        for pid, kind in _live_keys(engine):
            if store.stamp_first_seen(pid, kind, now):
                audit.append(AuditEvent(hospital, "first_seen", pid, kind,
                                        {"at": now.isoformat()}))

```
with:
```python
        # five-minute grace over again after a deploy, and nothing looked broken.
        # This patient's FIRING alerts only (G2-A1): a latched one keeps its episode's stamp, and
        # stamping it now would open an episode after its end.
        for a in engine.active_alerts(patient_id):
            if store.stamp_first_seen(patient_id, a.kind, now, chain_gap=escalate_after):
                audit.append(AuditEvent(hospital, "first_seen", patient_id, a.kind,
                                        {"at": now.isoformat()}))
        # A kind charting ended has left the live keys: a nurse is told again if it returns (D5).
        notifier.prune(hospital, live_keys(engine, store))

```

`/ingest` runs the hook before its stamps; `store.prune` goes (the hook prunes):

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
        alerts = engine.ingest(obs, now=obs.timestamp)
        audit.append(AuditEvent(hospital, "ingest", obs.patient_id, obs.code.value,
                                {"value": obs.value, "unit": obs.unit,
                                 "obs_ts": obs.timestamp.isoformat(), "device": obs.source_device}))
        for a in alerts:
            audit.append(AuditEvent(hospital, "alert", a.patient_id, a.kind,
                                    {"severity": a.severity, "urgency": a.urgency, "summary": a.summary,
                                     "source": a.source, "evidence": a.supporting_evidence}))
        # First-seen uses WALL-CLOCK time (escalation measures real elapsed time, not observation time).
        wall_now = datetime.now(timezone.utc)
        for a in engine.active_alerts(obs.patient_id):
            if store.stamp_first_seen(obs.patient_id, a.kind, wall_now):
                audit.append(AuditEvent(hospital, "first_seen", obs.patient_id, a.kind,
                                        {"at": wall_now.isoformat()}))
        store.prune(_live_keys(engine))
        await broadcaster.publish(hospital, patient_board(
```
with:
```python
        alerts = engine.ingest(obs, now=obs.timestamp)
        # G2-A1: what stopped firing ends its episode or — a critical nobody acknowledged —
        # latches (api/alert_lifecycle.py). Right after the evaluation and before any audit write:
        # if the audit fails from here on, an unacknowledged critical is still on the board.
        # Before the stamps too: a kind that came back after clearing has had its old stamp pruned,
        # so it is stamped anew, a new episode (D5).
        # First-seen uses WALL-CLOCK time (escalation measures real elapsed time, not observation time).
        wall_now = datetime.now(timezone.utc)
        cleared = sync_alerts(engine, store, obs.patient_id, wall_now)
        audit.append(AuditEvent(hospital, "ingest", obs.patient_id, obs.code.value,
                                {"value": obs.value, "unit": obs.unit,
                                 "obs_ts": obs.timestamp.isoformat(), "device": obs.source_device}))
        for a in alerts:
            audit.append(AuditEvent(hospital, "alert", a.patient_id, a.kind,
                                    {"severity": a.severity, "urgency": a.urgency, "summary": a.summary,
                                     "source": a.source, "evidence": a.supporting_evidence}))
        _audit_cleared(hospital, cleared, wall_now)
        # A return within `escalate_after` of an unanswered clear continues its escalation chain
        # (X13); a return after an acknowledgement starts a new one.
        for a in engine.active_alerts(obs.patient_id):
            if store.stamp_first_seen(obs.patient_id, a.kind, wall_now, chain_gap=escalate_after):
                audit.append(AuditEvent(hospital, "first_seen", obs.patient_id, a.kind,
                                        {"at": wall_now.isoformat()}))
        await broadcaster.publish(hospital, patient_board(
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
                                    {"audience": note.audience, "trigger": note.trigger}))
        notifier.prune(hospital, _live_keys(engine))
        return {"patient_id": obs.patient_id, "alerts": [asdict(a) for a in alerts]}
```
with:
```python
                                    {"audience": note.audience, "trigger": note.trigger}))
        notifier.prune(hospital, live_keys(engine, store))
        return {"patient_id": obs.patient_id, "alerts": [asdict(a) for a in alerts]}
```

`/ack` removes a latch (D8; the 404 for an unknown key is unchanged):

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
        await _require_patient(caller, authorization, patient_id)
        if (patient_id, kind) not in _live_keys(engine):
            raise HTTPException(status_code=404, detail="no such active alert")
        store.acknowledge(patient_id, kind, who["role"], datetime.now(timezone.utc))
        store.escalated.discard((patient_id, kind))  # ack immediately stops escalation
        audit.append(AuditEvent(hospital, "ack", patient_id, kind,
                                {**who, "at": datetime.now(timezone.utc).isoformat()}))
        board = patient_board(engine, patient_id, store,
```
with:
```python
        await _require_patient(caller, authorization, patient_id)
        now = datetime.now(timezone.utc)
        # G2-A1, D8: a latched alert — a critical whose rule stopped while nobody had acknowledged
        # it — is removed by the acknowledgement: there is nothing left to answer, only to close.
        latched = acknowledge_latched(store, patient_id, kind)
        if latched is None:
            if (patient_id, kind) not in live_keys(engine, store):
                raise HTTPException(status_code=404, detail="no such active alert")
            store.acknowledge(patient_id, kind, who["role"], now)
            store.escalated.discard((patient_id, kind))  # ack immediately stops escalation
        audit.append(AuditEvent(hospital, "ack", patient_id, kind, {**who, "at": now.isoformat()}))
        if latched is not None:
            _audit_cleared(hospital, [latched], now)
            notifier.prune(hospital, live_keys(engine, store))   # a return is told again (D5)
        board = patient_board(engine, patient_id, store,
```

- [ ] **Step 4: The hook and the store** — four Edits in `alert_lifecycle.py` (the latch's first-seen, `d268b63`; the prune from the store's own keys and the page, `46a282d`; the chain, `6debbe7` and 8fbcff1) and four in `ackstore.py` (the docstring and `Chain`, the latch's comment of `71cefee`, the page and the chain's fields with `stamp_first_seen` and `remember_chain`, the prune)

**Edit** `homunculus-engine/src/homunculus/api/alert_lifecycle.py` — replace:
```python
`/clinical` and the replay in `rehydrate` — so the three behave alike (D4):

* A kind that stopped firing ends its episode. Its ack, first-seen stamp and escalation flag are
  pruned (the door prunes the notifier's dedup with `live_keys`), so if it fires again it is a NEW
  episode: a new first-seen, a new escalation clock, a new nurse notification (D5).
* Except a critical one nobody acknowledged: it latches (D2). It stays on the board as resolved,
  unacknowledged — its first-seen kept, its escalation flag dropped, for only a firing alert
  escalates (D8) — until a clinician acknowledges it, which removes it (`acknowledge_latched`). A
  transient critical event must not vanish before anyone saw it. HIGH, MODERATE and LOW never
  latch, and an acknowledged critical leaves with its rule.
* A latched kind that fires again is active again: the latch is replaced and its episode goes on —
  no `alert_cleared` row, and the first-seen stamp it kept is still its own.
```
with:
```python
`/clinical` and the replay in `rehydrate` — so the three behave alike (D4). The doors run it right
after `engine.ingest`, before their first audit write: an audit that fails mid-request must not
leave an evaluation without its hook, or an unacknowledged critical would be off the board until
some later reading:

* A kind that stopped firing ends its episode. Its ack, first-seen stamp, escalation clock and flag
  and record of the doctor's page are pruned (the door prunes the notifier's dedup with
  `live_keys`), so if it fires again it is a NEW episode: a new first-seen, a new nurse
  notification (D5). If it ended unanswered, its escalation chain is remembered first (X13): a
  return within the escalation delay of the end continues the chain — its clock, and no second page
  to the doctor — and a later one starts a new chain, with a new clock and a new page. An answer
  ends the chain (X13 review): after an acknowledgement any return starts a new one.
* Except a critical one nobody acknowledged: it latches (D2). It stays on the board as resolved,
  unacknowledged — its first-seen kept (and carried in the latch), its escalation flag dropped, for
  only a firing alert escalates (D8) — until a clinician acknowledges it, which removes it
  (`acknowledge_latched`). A
  transient critical event must not vanish before anyone saw it. HIGH, MODERATE and LOW never
  latch, and an acknowledged critical leaves with its rule. The acknowledgement that removes a
  latch is its episode's end and, an answer, its chain's: nothing is left behind.
* A latched kind that fires again is active again: the latch is replaced and its episode goes on —
  no `alert_cleared` row, and the first-seen stamp it kept is still its own. Nor is the doctor
  paged for it again if the episode had been (`AckStore.paged`).
```

**Edit** `homunculus-engine/src/homunculus/api/alert_lifecycle.py` — replace:
```python
        cleared.append(Cleared(patient_id, key[1], alert.severity, store.first_seen.get(key), RESOLVED))
        if alert.severity == LATCHING_SEVERITY and key not in store.acks:
            store.resolved[key] = {"alert": asdict(alert), "resolved_at": now}
```
with:
```python
        seen = store.first_seen.get(key)
        cleared.append(Cleared(patient_id, key[1], alert.severity, seen, RESOLVED))
        if alert.severity == LATCHING_SEVERITY and key not in store.acks:
            # The latch carries its episode's first-seen, so the record of its end can say when the
            # episode began even if the stamp itself is gone by then (None: never stamped).
            store.resolved[key] = {"alert": asdict(alert), "resolved_at": now, "first_seen": seen}
```

**Edit** `homunculus-engine/src/homunculus/api/alert_lifecycle.py` — replace:
```python
    # If an evaluation is ever not followed by its hook, another patient's sync must not prune the
    # skipped patient's ack and first-seen before their drop is processed; with every hook run this
    # changes nothing.
    store.prune(live_keys(engine, store) | set(store.firing), firing_keys(engine))
```
with:
```python
    # Pruned from the store's own view — what the hooks last saw firing, and what is latched — not
    # from a walk over every patient's evaluation: that walk made each row cost the ward's size.
    # With every hook run the store's view is the engine's. If an evaluation is ever not followed by
    # its hook, the skipped patient's keys are still in `store.firing`, so another patient's sync
    # cannot prune their ack and first-seen before their drop is processed.
    firing = set(store.firing)
    store.prune(firing | set(store.resolved), firing, now=now)
```

**Edit** `homunculus-engine/src/homunculus/api/alert_lifecycle.py` — replace:
```python
def acknowledge_latched(store: AckStore, patient_id: str, kind: str) -> Cleared | None:
    """A clinician acknowledged a latched alert: it is removed, and its episode ends (D8). None
    when (patient, kind) is not latched — a firing alert is acknowledged the ordinary way."""
    key = (patient_id, kind)
    entry = store.resolved.pop(key, None)
    if entry is None:
        return None
    seen = store.first_seen.pop(key, None)
    store.escalated.discard(key)
```
with:
```python
def acknowledge_latched(store: AckStore, patient_id: str, kind: str) -> Cleared | None:
    """A clinician acknowledged a latched alert: it is removed, and its episode ends (D8). None
    when (patient, kind) is not latched — a firing alert is acknowledged the ordinary way.

    An acknowledgement is an answer, and an answer ends the escalation chain as well as the
    episode (X13 review): no chain is remembered, so a return — however soon — starts a new
    clock and can page the doctor anew."""
    key = (patient_id, kind)
    entry = store.resolved.pop(key, None)
    if entry is None:
        return None
    seen = store.first_seen.pop(key, None)
    store.clock_from.pop(key, None)
    if seen is None:
        seen = entry.get("first_seen")
    store.escalated.discard(key)
    store.paged.discard(key)       # the episode and its chain are over: the next one pages anew
```

**Edit** `homunculus-engine/src/homunculus/api/ackstore.py` — replace:
```python
`api/alert_lifecycle.py` maintains both."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from homunculus.reco.engine import Alert
```
with:
```python
`api/alert_lifecycle.py` maintains both.

Since X13 it keeps the escalation chain: consecutive episodes of one (patient, kind) whose gap — from
the clear to the next first sight — is at most the escalation delay share one escalation clock
(`clock_from`) and one page to the doctor (`paged`). A return is still a new episode (D5): its own
first-seen (the board's ▲), no inherited acknowledgement, a nurse told again. Without the chain an
alert flapping faster than the delay — NEWS2 7 / 4 every two minutes — never reached the doctor.
An answer ends the chain (X13 review): only an episode that ended unanswered leaves one, so a return
after an acknowledgement starts a new clock and can page the doctor anew."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import NamedTuple

from homunculus.reco.engine import Alert


class Chain(NamedTuple):
    """An escalation chain whose episode has left the board (X13), kept for the escalation delay in
    case the alert returns: its clock, when its episode ended, and whether its doctor was paged."""
    clock_from: datetime
    cleared_at: datetime
    paged: bool
```

**Edit** `homunculus-engine/src/homunculus/api/ackstore.py` — replace:
```python
    # until someone does — {"alert": the alert as it last fired (asdict), "resolved_at": when}.
```
with:
```python
    # until someone does — {"alert": as last fired (asdict), "resolved_at": when, "first_seen": stamp|None}.
```

**Edit** `homunculus-engine/src/homunculus/api/ackstore.py` — replace:
```python
    firing: dict[tuple[str, str], Alert] = field(default_factory=dict)

    def stamp_first_seen(self, patient_id: str, kind: str, now: datetime) -> bool:
        """Record when an alert was first seen. Returns True only if this is a NEW stamp
        (so the caller can audit it exactly once for restart persistence)."""
        key = (patient_id, kind)
        if key in self.first_seen:
            return False
        self.first_seen[key] = now
        return True
```
with:
```python
    firing: dict[tuple[str, str], Alert] = field(default_factory=dict)
    # G2-A1, final review: the escalations the doctor was already PAGED for. `escalated` follows
    # the clock — a latch drops it and a return raises it again — so on its own a critical that
    # flaps (lactate 3.4 / 1.5 every two minutes) would page the doctor on each swing. It goes with
    # the episode like `first_seen` — a return inside the same episode is not paged again — and
    # since X13 a return that continues its chain gets it back from `recent`: one page per chain.
    paged: set[tuple[str, str]] = field(default_factory=set)
    # X13: when each live key's escalation clock started — its chain's first sight, at or before its
    # episode's `first_seen`. What `escalate()` measures; the board shows `first_seen`.
    clock_from: dict[tuple[str, str], datetime] = field(default_factory=dict)
    # X13: the chains of episodes that left the board unanswered, kept for the escalation delay.
    # Written by the prune; read, and spent, by the next stamp of the key.
    recent: dict[tuple[str, str], Chain] = field(default_factory=dict)

    def stamp_first_seen(self, patient_id: str, kind: str, now: datetime,
                         chain_gap: timedelta | None = None) -> bool:
        """Record when an alert was first seen. Returns True only if this is a NEW stamp
        (so the caller can audit it exactly once for restart persistence).

        A new stamp also sets the escalation clock (X13). If the key's last episode left the board
        unanswered at most `chain_gap` (the escalation delay) ago, this one continues its chain: the
        chain's clock, and its page if the doctor was paged. Otherwise — or with no `chain_gap` —
        the clock starts now. Chains older than the gap are forgotten here."""
        key = (patient_id, kind)
        if key in self.first_seen:
            return False
        self.first_seen[key] = now
        chain = self.recent.pop(key, None)
        if chain is not None and chain_gap is not None and now - chain.cleared_at <= chain_gap:
            self.clock_from[key] = chain.clock_from
            if chain.paged:
                self.paged.add(key)
        else:
            self.clock_from[key] = now
        if chain_gap is not None:
            for old in [k for k, c in self.recent.items() if now - c.cleared_at > chain_gap]:
                del self.recent[old]
        return True

    def remember_chain(self, key: tuple[str, str], cleared_at: datetime) -> None:
        """Keep the chain of an episode that is leaving the board unanswered at `cleared_at` (X13),
        before its state is dropped. A key never stamped has no clock, and nothing is kept."""
        clock = self.clock_from.get(key, self.first_seen.get(key))
        if clock is not None:
            self.recent[key] = Chain(clock, cleared_at, key in self.paged)
```

**Edit** `homunculus-engine/src/homunculus/api/ackstore.py` — replace:
```python
    def prune(self, live_keys: set[tuple[str, str]],
              firing_keys: set[tuple[str, str]] | None = None) -> None:
        """Drop state for alert kinds that are no longer active, so a re-raised alert starts fresh.

        `live_keys` are the kinds still on the board: firing, or latched. With `firing_keys`, the
        ones firing now (G2-A1): only a firing alert can be escalated (D8), and a latched alert
        that fires again is no longer latched — its episode goes on (X2)."""
        for mapping in (self.acks, self.first_seen):
            for key in [k for k in mapping if k not in live_keys]:
                del mapping[key]
```
with:
```python
    def prune(self, live_keys: set[tuple[str, str]],
              firing_keys: set[tuple[str, str]] | None = None,
              now: datetime | None = None) -> None:
        """Drop state for alert kinds that are no longer active, so a re-raised alert starts fresh.

        `live_keys` are the kinds still on the board: firing, or latched. With `firing_keys`, the
        ones firing now (G2-A1): only a firing alert can be escalated (D8), and a latched alert
        that fires again is no longer latched — its episode goes on (X2). The page record goes
        with the episode's first-seen: it is kept for every live key, firing or latched, and so is
        the escalation clock. With `now`, when the prune runs, each episode that leaves the board
        unanswered is remembered as its chain first (X13). An acknowledged one is not: an answer
        ends the chain (X13 review), and its answered minutes are no return's unanswered ones."""
        if now is not None:
            for key in [k for k in self.first_seen if k not in live_keys and k not in self.acks]:
                self.remember_chain(key, now)
        for mapping in (self.acks, self.first_seen, self.clock_from):
            for key in [k for k in mapping if k not in live_keys]:
                del mapping[key]
        self.paged &= live_keys
```

- [ ] **Step 4b: The escalation clock is the chain's (X13)** — `escalation.py`'s docstring (its signature is unchanged)

**Edit** `homunculus-engine/src/homunculus/api/escalation.py` — replace:
```python
Clock-injected so it is unit-tested without waiting on a real timer."""
```
with:
```python
Clock-injected so it is unit-tested without waiting on a real timer.

`first_seen` is when each alert's escalation clock started. Since G2-A1 X13 the API passes the
escalation chain's start (`AckStore.clock_from`), not the episode's first sight."""
```

- [ ] **Step 4c: The new event's name**

**Edit** `homunculus-engine/src/homunculus/api/audit.py` — replace:
```python
    event_type: str          # "ingest" | "alert" | "ack" | "escalation" | "notification"
```
with:
```python
    event_type: str          # "ingest" | "alert" | "ack" | "escalation" | "notification"
    #                          | "alert_cleared" (G2-A1: an episode's end — api/alert_lifecycle.py)
```

- [ ] **Step 5: The replay** — three Edits in `rehydrate.py`.

**Edit** `homunculus-engine/src/homunculus/api/rehydrate.py` — replace:
```python
The append-only audit is the event log: replaying its `ingest`, `chart`, `profile`, `ack` and
`first_seen` records in id order into a fresh Engine + AckStore reconstructs the runtime state a
restart would otherwise lose. `first_seen` keeps the earliest stamp per (patient, kind), so an
alert's escalation clock runs on across a restart instead of starting over. Replay calls the
engine/store directly, so it writes NO new audit records. Deliberately NOT replayed: the derived
`escalated` set and the `alert`, `escalation` and `notification` records (derived or transient)."""
from __future__ import annotations

from datetime import datetime

from homunculus.api.ackstore import AckStore
```
with:
```python
The append-only audit is the event log: replaying its `ingest`, `chart`, `profile`, `ack` and
`first_seen` records in id order into a fresh Engine + AckStore reconstructs the runtime state a
restart would otherwise lose. `first_seen` keeps the earliest stamp per (patient, kind), so an
alert's escalation clock runs on across a restart instead of starting over. Replay calls the
engine/store directly, so it writes NO new audit records. Deliberately NOT replayed: the derived
`escalated` set and the `alert`, `escalation` and `notification` records (derived or transient).

Since G2-A1 (O17, D7) every replayed `ingest` and `chart` runs through the lifecycle hook the doors
run (api/alert_lifecycle.py): a closed episode's stamp and ack are pruned as they were live — so
the `first_seen` row of the next episode sets that episode's own stamp —, a critical nobody
acknowledged latches again, and an `ack` row for a latched alert removes it. The `alert_cleared`
rows follow from those and are not replayed.

The escalation chain (X13) is not in the log: a replayed episode's clock (`clock_from`) is its own
`first_seen` row, and no chain of an episode that ended is remembered (`recent`). After a restart a
chain starts over — the same limitation as `paged` and `escalated`, which are not replayed either."""
from __future__ import annotations

from datetime import datetime

from homunculus.api.ackstore import AckStore
from homunculus.api.alert_lifecycle import acknowledge_latched, live_keys, sync_alerts
```

**Edit** `homunculus-engine/src/homunculus/api/rehydrate.py` — replace:
```python
            # septic-shock and antibiotic-clock alerts down with it, silently, on a patient the
            # ward believes is being watched for exactly those.
            _replay_ingest(engine, rec)
        elif rec.event_type == "profile":
            _replay_profile(engine, rec)
        elif rec.event_type == "ack":
            _replay_ack(store, rec)
        elif rec.event_type == "first_seen":
            store.first_seen.setdefault((rec.patient_id, rec.subject),
                                        datetime.fromisoformat(rec.payload["at"]))
        # alert / escalation / notification are derived or transient — nothing to replay.


def _replay_ingest(engine: Engine, rec: AuditRecord) -> None:
    try:
        code = SignalCode(rec.subject)
    except ValueError:
        return  # unknown signal slug — skip rather than fail the whole replay
    p = rec.payload
    ts = datetime.fromisoformat(p["obs_ts"])
    obs = Observation(patient_id=rec.patient_id, code=code, value=float(p["value"]),
                      unit=p.get("unit", ""), timestamp=ts, source_device=p.get("device", "replay"))
    engine.ingest(obs, now=ts)
```
with:
```python
            # septic-shock and antibiotic-clock alerts down with it, silently, on a patient the
            # ward believes is being watched for exactly those.
            if _replay_ingest(engine, rec):
                # G2-A1 (D7): through the hook, as the door ran it. What it clears was audited
                # live (`alert_cleared`) and is not written again.
                sync_alerts(engine, store, rec.patient_id, _written_at(rec))
        elif rec.event_type == "profile":
            _replay_profile(engine, rec)
        elif rec.event_type == "ack":
            _replay_ack(engine, store, rec)
        elif rec.event_type == "first_seen":
            key = (rec.patient_id, rec.subject)
            store.first_seen.setdefault(key, datetime.fromisoformat(rec.payload["at"]))
            store.clock_from.setdefault(key, store.first_seen[key])
        # alert / escalation / notification are derived or transient — nothing to replay.
    # The hook's prunes remembered the chains of the episodes the replay saw end, but nothing replayed
    # continues one (the `first_seen` rows set their stamps directly). Carried past the restart, they
    # would continue a chain from its middle: the last replayed episode's first sight as its clock.
    store.recent.clear()


def _replay_ingest(engine: Engine, rec: AuditRecord) -> bool:
    """Replay one observation; False when its signal is unknown and it was skipped."""
    try:
        code = SignalCode(rec.subject)
    except ValueError:
        return False  # unknown signal slug — skip rather than fail the whole replay
    p = rec.payload
    ts = datetime.fromisoformat(p["obs_ts"])
    obs = Observation(patient_id=rec.patient_id, code=code, value=float(p["value"]),
                      unit=p.get("unit", ""), timestamp=ts, source_device=p.get("device", "replay"))
    engine.ingest(obs, now=ts)
    return True


def _written_at(rec: AuditRecord) -> datetime:
    """When the row was written — the wall clock the door's hook ran at, to within the request: a
    latched alert's `resolved_at`. A row whose time cannot be read gives its observation's."""
    try:
        return datetime.fromisoformat(rec.ts)
    except (TypeError, ValueError):
        return datetime.fromisoformat(rec.payload["obs_ts"])
```

**Edit** `homunculus-engine/src/homunculus/api/rehydrate.py` — replace:
```python
def _replay_ack(store: AckStore, rec: AuditRecord) -> None:
    """`role` is replayed as `acknowledged_by`, bounded like the live path: rows written before
    the device role was bounded may hold anything the body sent (a dict, a page of text)."""
    at = datetime.fromisoformat(rec.payload["at"])
```
with:
```python
def _replay_ack(engine: Engine, store: AckStore, rec: AuditRecord) -> None:
    """`role` is replayed as `acknowledged_by`, bounded like the live path: rows written before
    the device role was bounded may hold anything the body sent (a dict, a page of text).

    G2-A1 (D7, D8): an `ack` row for a latched alert removed it live, and removes it here — it is
    not recorded as an acknowledgement, which a later episode of the same kind would inherit. For
    the same reason a row for a kind that is neither firing nor latched at this point of the replay
    is ignored: the live door answers 404 to it, so it acknowledges nothing, and kept, it would
    answer the next episode of that kind."""
    if (rec.patient_id, rec.subject) not in live_keys(engine, store):
        return
    if acknowledge_latched(store, rec.patient_id, rec.subject) is not None:
        return
    at = datetime.fromisoformat(rec.payload["at"])
```

- [ ] **Step 6: Green, and the neighbours**

```bash
cd /c/tmp/g2a-o17/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_api_ack.py tests/test_api_ingest.py tests/test_api_clinical.py tests/test_rehydrate.py tests/test_alert_lifecycle.py tests/test_ackstore.py 2>&1 | tail -1
grep -n "_live_keys" src/homunculus/api/app.py; echo "grep exit $?"
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_api_ack.py tests/test_api_ingest.py tests/test_api_clinical.py tests/test_rehydrate.py tests/test_alarm_quality.py tests/test_api_patient_profile.py tests/test_infinity_shadow_equivalence.py tests/test_infinity_shadow_isolation.py tests/test_notify.py tests/test_notify_hub.py tests/test_api_audit.py tests/test_trends_api.py tests/test_alert_lifecycle.py tests/test_board.py 2>&1 | tail -1
```

Expected: `99 passed, 3 warnings in …`; then `grep exit 1`; then `233 passed, 3 warnings in …` (`grep exit 1`: no `_live_keys` is left).

- [ ] **Step 7: The whole no-DB suite** (the doors are under every API test)

```bash
cd /c/tmp/g2a-o17/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -1
```

Expected: `2220 passed, 650 skipped, 3 warnings in …`.

- [ ] **Step 8: Line ends**

```bash
cd /c/tmp/g2a-o17
for f in homunculus-engine/src/homunculus/api/app.py homunculus-engine/src/homunculus/api/rehydrate.py homunculus-engine/src/homunculus/api/audit.py homunculus-engine/src/homunculus/api/alert_lifecycle.py homunculus-engine/src/homunculus/api/ackstore.py homunculus-engine/src/homunculus/api/escalation.py homunculus-engine/tests/test_alert_lifecycle.py homunculus-engine/tests/test_ackstore.py homunculus-engine/tests/test_api_ack.py homunculus-engine/tests/test_api_ingest.py homunculus-engine/tests/test_api_clinical.py homunculus-engine/tests/test_rehydrate.py; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected: `app.py CR=1182 LF=1182`, `rehydrate.py CR=114 LF=114`, `audit.py CR=288 LF=288`, `alert_lifecycle.py CR=121 LF=121`, `ackstore.py CR=117 LF=117`, `escalation.py CR=31 LF=31`, `test_alert_lifecycle.py CR=300 LF=300`, `test_ackstore.py CR=151 LF=151`, `test_api_ack.py CR=438 LF=438`, `test_api_ingest.py CR=167 LF=167`, `test_api_clinical.py CR=316 LF=316`, `test_rehydrate.py CR=236 LF=236`.

- [ ] **Step 9: Commit**

```bash
cd /c/tmp/g2a-o17
git add homunculus-engine/src/homunculus/api/app.py homunculus-engine/src/homunculus/api/rehydrate.py homunculus-engine/src/homunculus/api/audit.py homunculus-engine/src/homunculus/api/alert_lifecycle.py homunculus-engine/src/homunculus/api/ackstore.py homunculus-engine/src/homunculus/api/escalation.py homunculus-engine/tests/test_api_ack.py homunculus-engine/tests/test_api_ingest.py homunculus-engine/tests/test_api_clinical.py homunculus-engine/tests/test_rehydrate.py homunculus-engine/tests/test_alert_lifecycle.py homunculus-engine/tests/test_ackstore.py
git status --short && git diff --cached --stat
git commit -q -F - <<'MSG'
feat(api): both doors and the replay end an alert's episode with its rule; one page per escalation chain (G2-A1, O17)

/ingest and /clinical run the lifecycle hook right after every evaluation,
before any audit write, and audit what it cleared as alert_cleared (D4, D6);
/clinical stamps first-seen for the patient's firing alerts only and re-arms
the notifier's dedup after each entry (X8, X14). /ack on a latched critical
removes it — an ack row, then alert_cleared acked_after_resolve; a cleared
alert that did not latch is 404 (D8). The latch carries its first-seen.
Consecutive unanswered episodes within the escalation delay share one clock
(AckStore.clock_from, recent chains) and the doctor is paged once per chain
(AckStore.paged); an acknowledgement ends the chain (X13, X14). rehydrate
replays every ingest and chart row through the same hook, ignores an ack row
for a key that is not live, and starts every chain over (D7).
On the branch: 23fc805, d268b63, 46a282d, 6debbe7, 8fbcff1.

red: 27 failed, 39 passed, 3 warnings in … (the latched shock vanished, no alert_cleared rows, the replay did not latch, 404 acknowledging a latch, no clock_from/paged; tests/test_alert_lifecycle.py and tests/test_ackstore.py stop at ImportError: Chain)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
git log --oneline -1
```

---

### Task 5: The dashboard — a critical whose condition passed waits, silently, for its acknowledgement

**Done on the branch** as `54e1ea5` (the first version's Task 5, byte for byte) and `a99d36a` (X10, the Task 5 review: the badge on the bed card, the bed list, the bell and the patient screen; a firing alarm before a RESOLVED one; the acknowledge button's accessible name; the lock-screen path and the acknowledged-wins mapping pinned). The blocks below are that code. `AlarmsScreen.test.jsx` is written whole: the review renamed every lookup of the acknowledge button (its accessible name now carries the bed and the kind).

Spec D11 and D12's legend, with X5, X6, X7 and X10. No SSE change: the board replace already drops a cleared alert (`boardStore.js:58–64`).

The rules, each held by a test below:
- the adapter maps `resolved_at` to status **RESOLVED** (ACKNOWLEDGED wins over it, whatever `resolved_at` says; FIRED is the rest), `resolvedAtMs`, and the alarm's `episode` = `<patient>::<kind>::<first_seen_at>`; a new first-seen is a new episode of the same `id`;
- a RESOLVED alarm is in the waiting queue and in the counts; after severity, a firing alarm comes before a RESOLVED one, whatever their ages — in the bell, the rail, the sound's queue and on the alarms screen (X10);
- the sound is silent for a RESOLVED alarm and plays what still fires; `notifyFor` keeps it among the waiting `items` but not among `ringing`;
- on the page: the sound stops when a critical's condition passes; its notification stays; one that passed before it was raised raises none; a locked ward whose only alarm passed raises no locked-screen notification; a new episode is a new notification under a tag of its own; the tag is the episode's hash;
- the alarms row of a RESOLVED alarm shows «keçdi · təsdiqlənməyib» and «keçdiyi saat: HH:MM», sits in "Cavab gözləyir", keeps «Gördüm» — whose accessible name names the bed and the kind — and the acknowledgement removes it; a firing alarm shows no badge;
- the bed card, the bed list, the bell and the patient screen mark the RESOLVED line with the same badge, and no other line (X10);
- the trend legend's ▲ reads «siqnalın başladığı an» (X5), in the legend and in the table's notes.

**Files:**
- Modify (tests and fixture): `dashboard/src/liveAdapters.test.js`, `dashboard/src/live/data/board.testutil.js`, `dashboard/src/live/data/boardStore.test.js`, `dashboard/src/live/signals/signals.test.js`, `dashboard/src/live/signals/AlarmSignals.test.jsx`, `dashboard/src/live/screens/patient/trends/TrendModal.test.jsx`, `dashboard/src/live/screens/beds/BedCard.test.jsx`, `dashboard/src/live/screens/beds/BedsScreen.test.jsx`, `dashboard/src/live/screens/patient/PatientScreen.test.jsx`, `dashboard/src/live/shell/Shell.test.jsx`; Write (whole): `dashboard/src/live/screens/alarms/AlarmsScreen.test.jsx`
- Modify (code and texts): `dashboard/src/live/i18n/strings/alarms.js`, `dashboard/src/live/i18n/strings/patient.js`, `dashboard/src/liveAdapters.js`, `dashboard/src/live/signals/signals.js`, `dashboard/src/live/signals/AlarmSignals.jsx`, `dashboard/src/live/screens/alarms/AlarmsScreen.jsx`, `dashboard/src/live/data/boardStore.js`, `dashboard/src/live/screens/patient/trends/TrendLegend.jsx`, `dashboard/src/live/screens/beds/BedCard.jsx`, `dashboard/src/live/screens/beds/BedsScreen.jsx`, `dashboard/src/live/screens/patient/PatientScreen.jsx`, `dashboard/src/live/shell/TopBar.jsx`

- [ ] **Step 1: The adapter's tests**

**Edit** `dashboard/src/liveAdapters.test.js` — replace:
```js
  it("switches to ACKNOWLEDGED and carries who acknowledged it, once the engine says so", () => {
```
with:
```js
  // G2-A1 (O17): a critical whose rule stopped before anyone acknowledged it stays on the board,
  // `resolved_at` set, until someone does.
  it("is RESOLVED when its rule stopped before anyone acknowledged it, with the instant it stopped", () => {
    const latched = { ...entry, alerts: [{ ...entry.alerts[0], severity: "critical",
      resolved_at: "2026-08-27T10:04:00Z" }] };
    const alert = alertsFromPatients([patientFromBoard(latched)])[0];
    expect(alert.status).toBe("RESOLVED");
    expect(alert.resolvedAtMs).toBe(Date.parse("2026-08-27T10:04:00Z"));
    expect(alert.ack).toBeNull();
    const firing = alertsFromPatients([patientFromBoard(entry)])[0];
    expect([firing.status, firing.resolvedAtMs]).toEqual(["FIRED", null]);
  });

  // A latched alarm that someone then acknowledged is ACKNOWLEDGED, not RESOLVED: the answer wins,
  // so it leaves the waiting queue whether or not the engine still sends `resolved_at`.
  it("is ACKNOWLEDGED, not RESOLVED, once someone acknowledged it — whatever `resolved_at` says", () => {
    const answered = { ...entry, alerts: [{ ...entry.alerts[0], severity: "critical",
      resolved_at: "2026-08-27T10:04:00Z", acknowledged: true, acknowledged_by: "ayse",
      acknowledged_at: "2026-08-27T10:06:00Z" }] };
    const alert = alertsFromPatients([patientFromBoard(answered)])[0];
    expect(alert.status).toBe("ACKNOWLEDGED");
    expect(alert.ackBy).toBe("ayse");
  });

  it("names the episode by its first-seen instant: an alarm that cleared and came back is a new one", () => {
    const again = { ...entry, alerts: [{ ...entry.alerts[0], first_seen_at: "2026-08-27T11:30:00Z" }] };
    const [first] = alertsFromPatients([patientFromBoard(entry)]);
    const [second] = alertsFromPatients([patientFromBoard(again)]);
    expect(first.episode).toBe("bed-3::sepsis::2026-08-27T10:00:00Z");
    expect(second.episode).not.toBe(first.episode);
    expect(second.id).toBe(first.id);                 // the alarm itself is the same one
  });

  it("switches to ACKNOWLEDGED and carries who acknowledged it, once the engine says so", () => {
```

- [ ] **Step 2: The fixture carries `resolved_at`, and a latch is no risk** (`board.testutil.js`)

**Edit** `dashboard/src/live/data/board.testutil.js` — replace:
```js
    acknowledged: false, acknowledged_by: null, acknowledged_at: null,
    first_seen_at: ago(247), escalated: false, ...over,
  };
}
```
with:
```js
    acknowledged: false, acknowledged_by: null, acknowledged_at: null,
    first_seen_at: ago(247), escalated: false, resolved_at: null, ...over,
  };
}
```

**Edit** `dashboard/src/live/data/board.testutil.js` — replace:
```js
export function riskOf(alarms) {
  const list = Array.isArray(alarms) ? alarms : [];
```
with:
```js
export function riskOf(alarms) {
  // A latched alarm (`resolved_at` set, G2-A1) is a to-do, not a risk: the engine computes `risk`
  // from the firing alarms only (api/board.py, D10), and so does this.
  const list = (Array.isArray(alarms) ? alarms : []).filter((a) => a?.resolved_at == null);
```

- [ ] **Step 3: The waiting queue's test**

**Edit** `dashboard/src/live/data/boardStore.test.js` — replace:
```js
    expect(waitingAlarms({ alerts: escalated, connection: CONNECTION.LIVE }).items).toEqual(escalated);
    expect(alarmCounts({ alerts: escalated, connection: CONNECTION.LIVE }).waiting).toBe(1);
  });
```
with:
```js
    expect(waitingAlarms({ alerts: escalated, connection: CONNECTION.LIVE }).items).toEqual(escalated);
    expect(alarmCounts({ alerts: escalated, connection: CONNECTION.LIVE }).waiting).toBe(1);
  });

  // G2-A1 (O17): a critical whose condition passed before anyone acknowledged it is still a to-do.
  it("keeps a RESOLVED alarm in the queue until somebody acknowledges it", () => {
    const passed = alertsFromPatients(patientsFromBoard(board([
      entry("P-001", [alert("septic_shock", "critical", { resolved_at: "2026-10-08T09:59:00Z" })]),
    ])));
    expect(passed[0].status).toBe("RESOLVED");
    expect(waitingAlarms({ alerts: passed, connection: CONNECTION.LIVE }).items).toEqual(passed);
    expect(alarmCounts({ alerts: passed, connection: CONNECTION.LIVE }).waiting).toBe(1);
  });

  // After severity, an alarm that still fires comes before one that passed: the bell lists the
  // first ones a nurse should look at, and a critical whose condition is gone is the lesser claim
  // on her eyes than one that is still happening — even when it is the older one.
  it("lists a firing alarm above a RESOLVED one of the same severity, whatever their ages", () => {
    const queue = alertsFromPatients(patientsFromBoard(board([
      entry("P-001", [alert("septic_shock", "critical", { first_seen_at: "2026-10-08T09:00:00Z", resolved_at: "2026-10-08T09:30:00Z" })]),
      entry("P-002", [alert("septic_shock", "critical", { first_seen_at: "2026-10-08T09:40:00Z" })]),
      entry("P-003", [alert("news2", "high", { first_seen_at: "2026-10-08T08:00:00Z" })]),
    ])));
    const order = ["P-002", "P-001", "P-003"];          // severity first, then firing before passed
    expect(waitingAlarms({ alerts: queue, connection: CONNECTION.LIVE }).items.map((a) => a.patientId)).toEqual(order);
    expect(alarmsToSignal({ alerts: queue, connection: CONNECTION.LIVE, loaded: true }).items.map((a) => a.patientId)).toEqual(order);
  });
```

- [ ] **Step 4: The mapping's tests** (`signals.test.js`: one `toEqual` gains `ringing`; two tests)

**Edit** `dashboard/src/live/signals/signals.test.js` — replace:
```js
    expect(soundFor(escalated)).toBe("critical");
    expect(notifyFor(escalated).items.map((a) => a.id)).toEqual(["S-001::a"]);
  });
});
```
with:
```js
    expect(soundFor(escalated)).toBe("critical");
    expect(notifyFor(escalated).items.map((a) => a.id)).toEqual(["S-001::a"]);
  });

  // G2-A1 (O17): a critical whose rule stopped before anyone acknowledged it still waits for its
  // answer, but it rings no more — the sound and the vibration stop at resolve (D11).
  it("is silent for a RESOLVED alarm that still waits, and plays what still fires", () => {
    const passed = alarm("a", "critical", { resolved_at: "2026-10-08T09:59:00Z" });
    expect(soundFor(ward([passed]))).toBeNull();
    expect(soundFor(ward([passed, alarm("b", "moderate")]))).toBe("moderate");
  });
});
```

**Edit** `dashboard/src/live/signals/signals.test.js` — replace:
```js
    expect(notifyFor(ward([alarm("a", "critical")], CONNECTION.UNAVAILABLE, false))).toEqual({ known: false, items: [] });
    const stale = notifyFor(ward([alarm("a", "critical")], CONNECTION.DEGRADED));
    expect(stale.known).toBe(false);
    expect(stale.items).toHaveLength(1);
  });
});
```
with:
```js
    expect(notifyFor(ward([alarm("a", "critical")], CONNECTION.UNAVAILABLE, false))).toEqual({ known: false, items: [], ringing: [] });
    const stale = notifyFor(ward([alarm("a", "critical")], CONNECTION.DEGRADED));
    expect(stale.known).toBe(false);
    expect(stale.items).toHaveLength(1);
  });

  it("keeps a RESOLVED alarm among those that wait, but raises no new notification for it", () => {
    const { items, ringing } = notifyFor(ward([
      alarm("a", "critical", { resolved_at: "2026-10-08T09:59:00Z" }), alarm("b", "critical"),
    ]));
    // Same severity and age: the one that still fires comes first (boardStore `queue`).
    expect(items.map((a) => a.id)).toEqual(["S-002::b", "S-001::a"]);
    expect(ringing.map((a) => a.id)).toEqual(["S-002::b"]);
  });
});
```

- [ ] **Step 5: The page's tests** (`AlarmSignals.test.jsx`: an import, one test, the tag's key, two tests)

**Edit** `dashboard/src/live/signals/AlarmSignals.test.jsx` — replace:
```jsx
import { alarm, board, entry, identity } from "../data/board.testutil.js";
```
with:
```jsx
import { ago, alarm, board, entry, identity } from "../data/board.testutil.js";
```

**Edit** `dashboard/src/live/signals/AlarmSignals.test.jsx` — replace:
```jsx
    act(() => { stream.frame(reaBed("S-001", [alarm("septic_shock", "critical", { acknowledged: true, acknowledged_by: "ayse" })])); });
    tick(10000);
    expect(audio.pulses()).toHaveLength(10);
  });
```
with:
```jsx
    act(() => { stream.frame(reaBed("S-001", [alarm("septic_shock", "critical", { acknowledged: true, acknowledged_by: "ayse" })])); });
    tick(10000);
    expect(audio.pulses()).toHaveLength(10);
  });

  // G2-A1 (O17): the condition passed, nobody has acknowledged it yet — the screens keep it, the
  // speaker does not.
  it("stops when the alarm's condition passes, though it still waits for an answer", async () => {
    const { audio, stream } = await ward([reaBed("S-001", [alarm("septic_shock", "critical")])]);
    fireEvent.click(document.body);
    await flush();
    act(() => { stream.frame(reaBed("S-001", [alarm("septic_shock", "critical", { resolved_at: ago(1) })])); });
    tick(10000);
    expect(audio.pulses()).toHaveLength(10);
  });
```

**Edit** `dashboard/src/live/signals/AlarmSignals.test.jsx` — replace:
```jsx
    expect(notes.shown[0].options.tag).toBe(alarmTag("S-001::septic_shock"));
```
with:
```jsx
    expect(notes.shown[0].options.tag).toBe(alarmTag(`S-001::septic_shock::${ago(247)}`));   // its episode (G2-A1)
```

**Edit** `dashboard/src/live/signals/AlarmSignals.test.jsx` — replace:
```jsx
  // Closed from outside — the user, the operating system, another tab closing the same tag as it
```
with:
```jsx
  // G2-A1 (O17): a critical whose condition passed still waits for its answer — the notification it
  // has stays — but it vibrates no more, so it raises none of its own.
  it("keeps the notification of an alarm whose condition passed, and raises none for one that passed unseen", async () => {
    const { notes, stream } = await ward([reaBed("S-001", [alarm("septic_shock", "critical")])], { sound: false });
    act(() => { page.setHidden(true); });
    expect(notes.open()).toHaveLength(1);
    act(() => { stream.frame(reaBed("S-001", [alarm("septic_shock", "critical", { resolved_at: ago(1) })])); });
    expect(notes.open()).toHaveLength(1);
    act(() => { stream.frame(reaBed("S-002", [alarm("septic_shock", "critical", { resolved_at: ago(1) })])); });
    expect(notes.shown).toHaveLength(1);
  });

  // The lock screen's one generic notification is raised for what still rings, not for what merely
  // waits: a locked ward whose only alarm passed unacknowledged says nothing — and goes on to say it
  // the moment a critical fires.
  it("raises no locked-screen notification for a ward whose only alarm passed unacknowledged", async () => {
    const { notes, store, stream } = await ward([reaBed("S-001", [alarm("septic_shock", "critical", { resolved_at: ago(1) })])], { sound: false });
    act(() => { page.setHidden(true); });
    await act(async () => { store.lock(); });
    expect(notes.shown).toHaveLength(0);
    act(() => { stream.frame(reaBed("S-002", [alarm("septic_shock", "critical")])); });
    expect(notes.open().map((n) => n.options.tag)).toEqual(["homunculus-alarm:locked"]);
  });

  // A critical that cleared and fired again is a new episode: a new notification under a tag of its
  // own, so the browser shows it again instead of replacing the old one without a sound.
  it("raises a new notification, under a tag of its own, when an alarm fires again as a new episode", async () => {
    const { notes, stream } = await ward([reaBed("S-001", [alarm("septic_shock", "critical")])], { sound: false });
    act(() => { page.setHidden(true); });
    act(() => { stream.frame(reaBed("S-001", [alarm("septic_shock", "critical", { first_seen_at: ago(5) })])); });
    expect(notes.shown).toHaveLength(2);
    expect(notes.shown[0].closed).toBe(true);
    expect(notes.shown[1].options.tag).not.toBe(notes.shown[0].options.tag);
  });

  // Closed from outside — the user, the operating system, another tab closing the same tag as it
```

- [ ] **Step 6: The alarms screen's tests** — the whole file, then make it CRLF

**Write** `dashboard/src/live/screens/alarms/AlarmsScreen.test.jsx` — the whole file, replacing it — with exactly this text:
```jsx
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { resetScreens } from "../../shell/routes.js";
import { NOW, ago, alarm, board, entry, identity, measured } from "../../data/board.testutil.js";
import { hhmm } from "../../i18n/dates.js";
import { AlarmsScreen } from "./AlarmsScreen.jsx";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The acknowledge button. Its accessible name is "<bed> · <kind> siqnalı: gördüm" (it names the
 *  alarm it answers), so it is found by the word and not by the whole name. */
const SEEN = /gördüm/i;

/** The screen inside a real session and board store. `connection`: "live" | "degraded" |
 *  "unavailable"; `perms` decides whether the acknowledge button exists at all. */
async function open({ payload = board(), connection = "live", perms = ["board.view", "alerts.ack"], setup } = {}) {
  const mounted = await mount(<AlarmsScreen />, {
    access: token({ perms }),
    me: profile({ perms }),
    setup: (api) => {
      if (connection === "unavailable") api.boardPatients.mockRejectedValue(new Error("down"));
      else api.boardPatients.mockResolvedValue(payload);
      api.streamTicket.mockResolvedValue({ ticket: "t-1" });
      setup?.(api);
    },
  });
  const { board: store, stream } = mounted;
  await act(async () => { await store.start(); });
  if (connection !== "unavailable") {
    await act(async () => { stream.open(); await settle(); });
    if (connection === "degraded") act(() => { stream.drop(); });
  }
  return mounted;
}

const CARD = { identity: identity(), at: measured(30) };
const withAlarms = (...alarms) => board([entry("S-001", alarms, { ...CARD, risk: "high" })]);

beforeEach(() => vi.setSystemTime(NOW));
afterEach(() => {
  resetScreens();
  vi.useRealTimers();
});

describe("the alarms screen", () => {
  it("names itself and shows the two sections the board can answer for", async () => {
    await open({ payload: withAlarms(alarm("news2", "high", { summary: "NEWS2 7" })) });
    expect(screen.getByRole("heading", { level: 1, name: "Siqnallar" })).toBeInTheDocument();
    // One h1 and no more: the shell moves focus to <main> after every move, and the screen's own
    // heading is what a reader lands on.
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 2, name: /Cavab gözləyir/ })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2, name: /Qiymətləndirilir/ }).length).toBeGreaterThan(0);
  });

  it("says where a closed alarm went, instead of an empty \"closed today\" section", async () => {
    // The board carries the engine's ACTIVE alarms only: an empty third section would read as
    // "nothing was closed today", which is a different and false statement.
    await open({ payload: withAlarms(alarm("news2")) });
    expect(screen.getByText(/Bağlanan siqnal paneldən düşür/)).toBeInTheDocument();
  });

  it("says whose business escalation is, and shows only the flag the engine sent", async () => {
    await open({ payload: withAlarms(alarm("news2", "high", { escalated: true })) });
    expect(screen.getByText("Eskalasiya edilib")).toBeInTheDocument();
    expect(screen.getByText(/Eskalasiyanı mühərrik yürüdür/)).toBeInTheDocument();
    // No 3 / 5 / 10-minute ladder: nothing behind the live API has that shape.
    expect(screen.queryByText(/3\. dəq|5\. dəq|10\. dəq/)).toBeNull();
  });

  describe("how long an alarm has been open", () => {
    it("writes minutes and seconds under an hour", async () => {
      await open({ payload: withAlarms(alarm("news2", "high", { first_seen_at: ago(247) })) });
      expect(screen.getByText("4:07")).toBeInTheDocument();
    });

    it("opens the hour field past an hour — never \"318:30\"", async () => {
      await open({ payload: withAlarms(alarm("news2", "high", { first_seen_at: ago(19_110) })) });
      expect(screen.getByText("5:18:30")).toBeInTheDocument();
      expect(screen.queryByText("318:30")).toBeNull();
    });

    it("shows NO duration when the engine sent no first-seen time", async () => {
      await open({ payload: withAlarms(alarm("news2", "high", { first_seen_at: null })) });
      expect(screen.getByText("Mühərrik ilk görülmə vaxtını göndərməyib; müddət göstərilmir.")).toBeInTheDocument();
    });

    it("counts from the server's instant against this browser's clock", async () => {
      // How often it is re-read is useNow's business (screens/common/useNow.test.jsx).
      await open({ payload: withAlarms(alarm("news2", "high", { first_seen_at: ago(60) })) });
      expect(screen.getByText("1:00")).toBeInTheDocument();
    });

    it("an instant that has not arrived yet reads 0:00, not a negative age", async () => {
      await open({ payload: withAlarms(alarm("news2", "high", { first_seen_at: ago(-90) })) });
      expect(screen.getByText("0:00")).toBeInTheDocument();
    });
  });

  describe("the order", () => {
    it("worst first, then oldest, among the alarms awaiting a response", async () => {
      await open({
        payload: board([
          entry("S-001", [alarm("a", "moderate", { first_seen_at: ago(900) })], { ...CARD }),
          entry("S-002", [alarm("b", "critical", { first_seen_at: ago(60) })], { ...CARD }),
          entry("S-003", [alarm("c", "critical", { first_seen_at: ago(600) })], { ...CARD }),
        ]),
      });
      const waiting = screen.getByRole("heading", { level: 2, name: /Cavab gözləyir/ }).parentElement;
      expect(within(waiting).getAllByRole("link").map((a) => a.textContent))
        .toEqual(["REA-01 · 2", "REA-01 · 2", "REA-01 · 2"]);
      expect(within(waiting).getAllByText(/ölçütü karşılandı/).map((p) => p.textContent))
        .toEqual(["c ölçütü karşılandı", "b ölçütü karşılandı", "a ölçütü karşılandı"]);
    });

    it("the critical filter narrows both sections", async () => {
      await open({
        payload: board([
          entry("S-001", [alarm("a", "moderate")], { ...CARD }),
          entry("S-002", [alarm("b", "critical")], { ...CARD }),
        ]),
      });
      fireEvent.click(screen.getByRole("button", { name: "Yalnız kritik" }));
      expect(screen.getByText("b ölçütü karşılandı")).toBeInTheDocument();
      expect(screen.queryByText("a ölçütü karşılandı")).toBeNull();
    });

    it("the filter says how much it is hiding, and the count still speaks for the ward", async () => {
      // The count was computed from the FILTERED list, so turning the filter on made the group's
      // accessible name understate the ward — while the rail badge and the bell went on reporting
      // the truth from the same board. One page contradicting itself about how many alarms are
      // open is worse than either number alone. And a silent filter is the bed board's own
      // lesson: it says how many cards it hides, every time.
      await open({
        payload: board([
          entry("S-001", [alarm("a", "moderate")], { ...CARD }),
          entry("S-002", [alarm("b", "critical")], { ...CARD }),
        ]),
      });
      fireEvent.click(screen.getByRole("button", { name: "Yalnız kritik" }));
      expect(screen.getByText("Süzgəc 1 siqnalı gizlədir.")).toBeInTheDocument();
      expect(screen.getByRole("group", { name: "Açıq · 2" })).toBeInTheDocument();
    });

    it("the section headings carry no number the board cannot know either", async () => {
      // The same defect one level down, on the two LARGEST numbers on the screen. The group
      // label was gated and these were not, so an unreadable board — where refresh() has
      // emptied it — printed a bold 0 beside "Cavab gözləyir" and "Qiymətləndirilir", inches
      // from a group label correctly saying "Açıq · bilinmir". A stale number is defensible, as
      // the bell already shows one; a zero the board cannot know is not.
      await open({ connection: "unavailable" });
      for (const name of [/Cavab gözləyir/, /Qiymətləndirilir/]) {
        expect(screen.getByRole("heading", { name })).toHaveTextContent(/^[^0-9]*$/);
      }
    });

    it("a board that cannot be read offers no number at all", async () => {
      // The one count on this screen that was not behind a `known` guard: it read "Açıq · 0" on a
      // board that could not be loaded, directly beside the crit alert saying so. Zero is the most
      // reassuring thing this screen can print, and it was printing it for a ward it knew nothing
      // about. Plan-verbatim, which is why it survived three arms and two reviews.
      await open({ connection: "unavailable" });
      expect(screen.queryByRole("group", { name: /Açıq · 0/ })).toBeNull();
      expect(screen.getByRole("group", { name: "Açıq · bilinmir" })).toBeInTheDocument();
    });
  });

  describe("acknowledging", () => {
    it("sends patient and kind, and shows the board the server answered with", async () => {
      const acked = entry("S-001", [alarm("news2", "high", { summary: "NEWS2 7", acknowledged: true, acknowledged_by: "ayse", acknowledged_at: ago(1) })], { ...CARD, risk: "high" });
      const { api } = await open({
        payload: withAlarms(alarm("news2", "high", { summary: "NEWS2 7" })),
        setup: (fake) => fake.acknowledge.mockResolvedValue(acked),
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: SEEN }));
        await settle();
      });
      expect(api.acknowledge).toHaveBeenCalledWith("S-001", "news2");
      expect(screen.getByText("Gördü: ayse")).toBeInTheDocument();
      // It moved to the second section: the button for it is gone.
      expect(screen.queryByRole("button", { name: SEEN })).toBeNull();
    });

    // G2-A1 (O17): a critical whose condition passed before anyone acknowledged it.
    it("keeps a critical whose condition passed waiting, with its badge, and still asks for the acknowledgement", async () => {
      const passed = alarm("septic_shock", "critical", { summary: "Septic shock criteria met", resolved_at: ago(60) });
      const { api } = await open({
        payload: withAlarms(passed),
        setup: (fake) => fake.acknowledge.mockResolvedValue(entry("S-001", [], { ...CARD })),
      });
      const waiting = screen.getByRole("heading", { level: 2, name: /Cavab gözləyir/ }).parentElement;
      const row = within(waiting).getByText("Septic shock criteria met").closest("li");
      expect(within(row).getByText("keçdi · təsdiqlənməyib")).toBeInTheDocument();
      expect(row).toHaveTextContent(`keçdiyi saat: ${hhmm(NOW - 60_000)}`);
      await act(async () => {
        fireEvent.click(within(row).getByRole("button", { name: SEEN }));
        await settle();
      });
      expect(api.acknowledge).toHaveBeenCalledWith("S-001", "septic_shock");
      expect(screen.queryByText("Septic shock criteria met")).toBeNull();     // the ack removed it
    });

    // After severity, an alarm that still fires comes first — even when the one that passed is older.
    it("lists a critical that still fires above one that passed, though the latter is older", async () => {
      await open({
        payload: withAlarms(
          alarm("septic_shock", "critical", { summary: "Passed critical", first_seen_at: ago(900), resolved_at: ago(60) }),
          alarm("sepsis", "critical", { summary: "Firing critical", first_seen_at: ago(120) }),
        ),
      });
      const waiting = screen.getByRole("heading", { level: 2, name: /Cavab gözləyir/ }).parentElement;
      const rows = within(waiting).getAllByRole("listitem");
      expect(rows[0]).toHaveTextContent("Firing critical");
      expect(rows[1]).toHaveTextContent("Passed critical");
    });

    it("shows no such badge on an alarm that still fires", async () => {
      await open({ payload: withAlarms(alarm("septic_shock", "critical")) });
      expect(screen.queryByText("keçdi · təsdiqlənməyib")).toBeNull();
    });

    // Several rows carry the same button; read alone, "Gördüm" says nothing about WHICH alarm it
    // answers. The name carries the bed and the kind (the words the refusal toast uses), and still
    // contains the visible word, so a voice-control user who says it is understood.
    it("names the alarm its acknowledge button answers — the bed and the kind — and keeps the visible word", async () => {
      await open({ payload: withAlarms(alarm("news2", "high", { summary: "NEWS2 7" })) });
      const button = screen.getByRole("button", { name: /gördüm/i });
      expect(button).toHaveAccessibleName(/REA-01 · 2/);
      expect(button).toHaveAccessibleName(/news2/);
      expect(button).toHaveTextContent("Gördüm");
    });

    it("a refusal is shown and the list is NOT changed — nothing was acknowledged", async () => {
      const { api } = await open({
        payload: withAlarms(alarm("news2", "high", { summary: "NEWS2 7" })),
        setup: (fake) => fake.acknowledge.mockRejectedValue(refusal(403, "permission required: alerts.ack")),
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: SEEN }));
        await settle();
      });
      expect(api.acknowledge).toHaveBeenCalled();
      const alerts = screen.getAllByRole("alert").map((a) => a.textContent).join(" ");
      expect(alerts).toContain("səlahiyyətiniz yoxdur (alerts.ack)");
      expect(screen.getByRole("button", { name: SEEN })).toBeInTheDocument();
    });

    it("an alarm somebody else answered says so", async () => {
      await open({
        payload: withAlarms(alarm("news2")),
        setup: (fake) => fake.acknowledge.mockRejectedValue(refusal(404, "no such active alert")),
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: SEEN }));
        await settle();
      });
      expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" "))
        .toContain("Bu siqnal artıq açıq deyil");
    });

    it("names the alarm a refused acknowledgement was for", async () => {
      // Same rule as the charting's refusal, and for the same reason: a nurse who reads only
      // "you do not have permission" cannot tell which alarm is still unanswered. The bed and
      // the kind, in the vocabulary the row itself uses.
      await open({
        payload: withAlarms(alarm("news2")),
        setup: (fake) => fake.acknowledge.mockRejectedValue(refusal(403, "permission required: alerts.ack")),
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: SEEN }));
        await settle();
      });
      const said = within(screen.getByRole("region", { name: "Bildirişlər" })).getAllByText(/REA-01 · 2 · news2/);
      expect(said.length).toBeGreaterThan(0);
      expect(said.map((n) => n.textContent).join(" ")).toContain("səlahiyyətiniz yoxdur");
    });

    it("a refusal survives the clinician leaving the screen", async () => {
      // The same rule as the patient screen's charting, and the consistency is the point: the two
      // clinical writes this build has must behave alike when the server says no. A refusal held
      // in the screen's own state is lost the moment she moves, and a nurse who saw no error
      // believes the alarm is answered when nobody has answered it.
      let leave;
      function Away() {
        const [here, setHere] = React.useState(true);
        leave = () => setHere(false);
        return here ? <AlarmsScreen /> : null;
      }
      const mounted = await mount(<Away />, {
        access: token({ perms: ["board.view", "alerts.ack"] }),
        me: profile({ perms: ["board.view", "alerts.ack"] }),
        setup: (fake) => {
          fake.boardPatients.mockResolvedValue(withAlarms(alarm("news2")));
          fake.streamTicket.mockResolvedValue({ ticket: "t-1" });
          fake.acknowledge.mockRejectedValue(refusal(403, "permission required: alerts.ack"));
        },
      });
      await act(async () => { await mounted.board.start(); });
      await act(async () => { mounted.stream.open(); await settle(); });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: SEEN }));
        await settle();
      });
      const said = () => within(screen.getByRole("region", { name: "Bildirişlər" })).queryAllByText(/səlahiyyətiniz yoxdur/);
      expect(said().length).toBeGreaterThan(0);
      await act(async () => { leave(); await settle(); });
      expect(screen.queryByRole("button", { name: SEEN })).toBeNull();   // the screen is gone
      expect(said().length).toBeGreaterThan(0);                              // the refusal is not
    });

    it("says it is saving, in words a screen reader hears", async () => {
      let release;
      await open({
        payload: withAlarms(alarm("news2")),
        setup: (fake) => fake.acknowledge.mockImplementation(() => new Promise((resolve) => { release = resolve; })),
      });
      const button = screen.getByRole("button", { name: SEEN });
      await act(async () => { fireEvent.click(button); await settle(); });
      expect(button).toHaveAttribute("aria-busy", "true");
      await waitFor(
        () => expect(screen.getAllByRole("status").map((s) => s.textContent)).toContain("Yadda saxlanılır…"),
        // ANNOUNCE_DELAY_MS is 150 ms of REAL time; the default 1 s wait can be missed when the
        // whole suite runs its files in parallel on a loaded machine.
        { timeout: 4000 },
      );
      await act(async () => { release(entry("S-001", [], CARD)); await settle(); });
    });

    it("no button at all without the right, and the reason is on the screen", async () => {
      await open({ payload: withAlarms(alarm("news2")), perms: ["board.view"] });
      expect(screen.queryByRole("button", { name: SEEN })).toBeNull();
      expect(screen.getByText(/«alerts.ack» səlahiyyəti lazımdır/)).toBeInTheDocument();
    });
  });

  describe("what it refuses to imply", () => {
    it("a board that could not be loaded does not read as \"no alarms\"", async () => {
      await open({ connection: "unavailable" });
      const said = screen.getAllByRole("alert").map((a) => a.textContent).join(" ");
      expect(said).toContain("GƏLMİR");
      expect(screen.queryByText("Cavab gözləyən həyəcan siqnalı yoxdur.")).toBeNull();
    });

    it("a board that may be out of date says so, and warns before an acknowledgement", async () => {
      await open({ payload: withAlarms(alarm("news2")), connection: "degraded" });
      const notes = screen.getAllByRole("note").map((n) => n.textContent).join(" ");
      expect(notes).toContain("açıq siqnalların hamısı göstərilməyə bilər");
      expect(notes).toContain("siyahı köhnə ola bilər");
    });

    it("only a LIVE board says nothing is waiting", async () => {
      await open({ payload: board([entry("S-001", [], CARD)]) });
      expect(screen.getByText("Cavab gözləyən həyəcan siqnalı yoxdur.")).toBeInTheDocument();
    });

    it("an alarm whose severity is \"none\" can never read \"no finding\"", async () => {
      await open({ payload: withAlarms(alarm("other", "none")) });
      expect(screen.queryByText("Tapıntı yoxdur")).toBeNull();
      expect(screen.getByText("Risk bildirilməyib")).toBeInTheDocument();
    });
  });
});
```

```bash
cd /c/tmp/g2a-o17
/c/tmp/f7-py312/venv/Scripts/python.exe -c "import pathlib, sys; [pathlib.Path(p).write_bytes(pathlib.Path(p).read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')) for p in sys.argv[1:]]" dashboard/src/live/screens/alarms/AlarmsScreen.test.jsx
```

- [ ] **Step 7: The legend's pinned text** (`TrendModal.test.jsx`)

**Edit** `dashboard/src/live/screens/patient/trends/TrendModal.test.jsx` — replace:
```jsx
    // ▲ is the finding's first detection for this patient, not every episode (O17).
    for (const words of ["1–2 bal", "3 bal", "siqnalın ilk aşkarlanması", "antibiotik", "nöqtələr ölçmədir; aralarındakı qırıq xətt ölçmə deyil"]) {
```
with:
```jsx
    // ▲ is where an alarm episode began (G2-A1, O17): one mark per episode.
    for (const words of ["1–2 bal", "3 bal", "siqnalın başladığı an", "antibiotik", "nöqtələr ölçmədir; aralarındakı qırıq xətt ölçmə deyil"]) {
```

**Edit** `dashboard/src/live/screens/patient/trends/TrendModal.test.jsx` — replace:
```jsx
  it("carries the legend's notes into the table — thinned, marks cut short, an alarm's first detection — but not the chart's swatches", async () => {
```
with:
```jsx
  it("carries the legend's notes into the table — thinned, marks cut short, when an alarm began — but not the chart's swatches", async () => {
```

**Edit** `dashboard/src/live/screens/patient/trends/TrendModal.test.jsx` — replace:
```jsx
    expect(notes).toHaveTextContent("siqnalın ilk aşkarlanması");
```
with:
```jsx
    expect(notes).toHaveTextContent("siqnalın başladığı an");
```

- [ ] **Step 7b: The other surfaces' tests** — the bed card, the bed list, the patient screen, the bell (X10)

**Edit** `dashboard/src/live/screens/beds/BedCard.test.jsx` — replace:
```jsx
import { render, screen } from "@testing-library/react";
```
with:
```jsx
import { render, screen, within } from "@testing-library/react";
```

**Edit** `dashboard/src/live/screens/beds/BedCard.test.jsx` — replace:
```jsx
    it("an alarm with severity \"none\" can never read \"no finding\"", () => {
```
with:
```jsx
    // G2-A1 (O17): the engine computes `risk` from the alarms that still FIRE, so a bed whose only
    // alarm is a critical that passed unacknowledged is drawn calm — and its card still lists the
    // critical line. The badge is what says why; without it the card contradicts itself.
    it("keeps a critical that passed unacknowledged on the card, with the badge the alarms screen gives it", () => {
      card(entry("S-001", [
        alarm("news2", "high", { summary: "NEWS2 7" }),
        alarm("septic_shock", "critical", { summary: "Septic shock criteria met", resolved_at: ago(60) }),
      ], { at: measured(30) }));
      const line = screen.getByText("Septic shock criteria met").closest("li");
      expect(within(line).getByText("keçdi · təsdiqlənməyib")).toBeInTheDocument();
      // Only the latched line carries it: the one that still fires does not.
      expect(screen.getAllByText("keçdi · təsdiqlənməyib")).toHaveLength(1);
      expect(within(screen.getByText("NEWS2 7").closest("li")).queryByText("keçdi · təsdiqlənməyib")).toBeNull();
    });

    it("an alarm with severity \"none\" can never read \"no finding\"", () => {
```

**Edit** `dashboard/src/live/screens/beds/BedsScreen.test.jsx` — replace:
```jsx
    it("keeps the chosen view in this browser", async () => {
```
with:
```jsx
    // G2-A1 (O17): the list shows one alarm line under the name; a critical that passed
    // unacknowledged is drawn on a calm row, so the line carries the badge that says why.
    it("the list marks a critical that passed unacknowledged beside its line", async () => {
      await open({
        payload: board([entry("S-001", [alarm("septic_shock", "critical", { summary: "Septic shock criteria met", resolved_at: ago(60) })], CARD)]),
      });
      fireEvent.click(screen.getByRole("button", { name: "Siyahı" }));
      const row = screen.getByText("Septic shock criteria met").closest("tr");
      expect(within(row).getByText("keçdi · təsdiqlənməyib")).toBeInTheDocument();
    });

    it("keeps the chosen view in this browser", async () => {
```

**Edit** `dashboard/src/live/screens/patient/PatientScreen.test.jsx` — replace:
```jsx
    it("says when the patient's own charted normal lowered a finding, and why", async () => {
```
with:
```jsx
    // G2-A1 (O17): the same badge the alarms screen gives a critical whose condition passed before
    // anyone acknowledged it — the finding is still listed, and it must not read as a live one.
    it("marks a finding whose condition passed unacknowledged, and not one that still fires", async () => {
      await open({
        payload: board([entry("S-001", [
          alarm("septic_shock", "critical", { summary: "Septic shock criteria met", resolved_at: ago(60) }),
          alarm("news2", "high", { summary: "NEWS2 7" }),
        ], { ...FULL })]),
      });
      const passed = screen.getByRole("heading", { level: 3, name: /Septic shock/ }).closest("li");
      expect(within(passed).getByText("keçdi · təsdiqlənməyib")).toBeInTheDocument();
      const firing = screen.getByRole("heading", { level: 3, name: /NEWS2 7/ }).closest("li");
      expect(within(firing).queryByText("keçdi · təsdiqlənməyib")).toBeNull();
    });

    it("says when the patient's own charted normal lowered a finding, and why", async () => {
```

**Edit** `dashboard/src/live/shell/Shell.test.jsx` — replace:
```jsx
  it("lists the worst alarms and says how many more are waiting", async () => {
```
with:
```jsx
  // G2-A1 (O17): a critical whose condition passed still waits for its acknowledgement, so the bell
  // lists it — and says so on the row, because the card behind it is drawn calm.
  it("marks a critical that passed unacknowledged on its row, and no other row", async () => {
    const patients = [
      { patient_id: "P-001", risk: "high", vitals: {}, identity: { bed_label: "REA-01" },
        alerts: [{ kind: "news2", severity: "high", summary: "NEWS2 7", acknowledged: false }] },
      { patient_id: "P-002", risk: "none", vitals: {}, identity: { bed_label: "REA-02" },
        alerts: [{ kind: "septic_shock", severity: "critical", summary: "Septic shock criteria met",
          acknowledged: false, resolved_at: "2026-10-07T08:00:00Z" }] },
    ];
    const { stream } = await renderShell({ patients });
    await act(async () => { stream.open(); await settle(); });
    fireEvent.click(screen.getByRole("button", { name: /2 siqnal cavab gözləyir/ }));
    const panel = screen.getByRole("region", { name: /Cavab gözləyən siqnallar/ });
    const passed = within(panel).getByText("Septic shock criteria met").closest("li");
    expect(within(passed).getByText("keçdi · təsdiqlənməyib")).toBeInTheDocument();
    expect(within(panel).getAllByText("keçdi · təsdiqlənməyib")).toHaveLength(1);
  });

  it("lists the worst alarms and says how many more are waiting", async () => {
```

- [ ] **Step 8: Run them and see them fail for the right reason**

```bash
cd /c/tmp/g2a-o17/dashboard
npx vitest run src/liveAdapters.test.js src/live/data/boardStore.test.js src/live/signals/signals.test.js src/live/signals/AlarmSignals.test.jsx src/live/screens/alarms/AlarmsScreen.test.jsx src/live/screens/patient/trends/TrendModal.test.jsx src/live/screens/beds/BedCard.test.jsx src/live/screens/beds/BedsScreen.test.jsx src/live/screens/patient/PatientScreen.test.jsx src/live/shell/Shell.test.jsx 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
```

Expected:
```
 FAIL  src/liveAdapters.test.js > alertsFromPatients > is RESOLVED when its rule stopped before anyone acknowledged it, with the instant it stopped
 FAIL  src/liveAdapters.test.js > alertsFromPatients > names the episode by its first-seen instant: an alarm that cleared and came back is a new one
 FAIL  src/live/data/boardStore.test.js > alarm counts and lists > keeps a RESOLVED alarm in the queue until somebody acknowledges it
 FAIL  src/live/data/boardStore.test.js > alarm counts and lists > lists a firing alarm above a RESOLVED one of the same severity, whatever their ages
 FAIL  src/live/signals/AlarmSignals.test.jsx > the alarm sound > stops when the alarm's condition passes, though it still waits for an answer
 FAIL  src/live/signals/AlarmSignals.test.jsx > the critical-alarm notification > tags each notification so the browser replaces it rather than repeating it
 FAIL  src/live/signals/AlarmSignals.test.jsx > the critical-alarm notification > keeps the notification of an alarm whose condition passed, and raises none for one that passed unseen
 FAIL  src/live/signals/AlarmSignals.test.jsx > the critical-alarm notification > raises no locked-screen notification for a ward whose only alarm passed unacknowledged
 FAIL  src/live/signals/AlarmSignals.test.jsx > the critical-alarm notification > raises a new notification, under a tag of its own, when an alarm fires again as a new episode
 FAIL  src/live/signals/signals.test.js > what the page plays > is silent for a RESOLVED alarm that still waits, and plays what still fires
 FAIL  src/live/signals/signals.test.js > what raises a notification > names nothing it cannot know, and says whether the board is LIVE
 FAIL  src/live/signals/signals.test.js > what raises a notification > keeps a RESOLVED alarm among those that wait, but raises no new notification for it
 FAIL  src/live/shell/Shell.test.jsx > the top bar > marks a critical that passed unacknowledged on its row, and no other row
 FAIL  src/live/screens/alarms/AlarmsScreen.test.jsx > the alarms screen > acknowledging > keeps a critical whose condition passed waiting, with its badge, and still asks for the acknowledgement
 FAIL  src/live/screens/alarms/AlarmsScreen.test.jsx > the alarms screen > acknowledging > lists a critical that still fires above one that passed, though the latter is older
 FAIL  src/live/screens/alarms/AlarmsScreen.test.jsx > the alarms screen > acknowledging > names the alarm its acknowledge button answers — the bed and the kind — and keeps the visible word
 FAIL  src/live/screens/beds/BedCard.test.jsx > the bed card — what it says, and what it refuses to > the open alarms > keeps a critical that passed unacknowledged on the card, with the badge the alarms screen gives it
 FAIL  src/live/screens/beds/BedsScreen.test.jsx > the bed board > the view and the order > the list marks a critical that passed unacknowledged beside its line
 FAIL  src/live/screens/patient/PatientScreen.test.jsx > the patient screen > what the engine found > marks a finding whose condition passed unacknowledged, and not one that still fires
 FAIL  src/live/screens/patient/trends/TrendModal.test.jsx > the big chart's legend > explains every mark in words: the server's NEWS2 source, both band tones, both marks, the dashed line
 FAIL  src/live/screens/patient/trends/TrendModal.test.jsx > the big chart as a table > carries the legend's notes into the table — thinned, marks cut short, when an alarm began — but not the chart's swatches
 Test Files  10 failed (10)
      Tests  21 failed | 383 passed (404)
```
The reasons: no `status` RESOLVED, no `resolvedAtMs`, no `episode`; `notifyFor` has no `ringing`; the sound goes on for a resolved alarm, a new notification is raised for one, and a new episode under the old key raises none; the tag's key has no first-seen; the badge's words are missing on every surface; no firing-first order; the button has no accessible name of its own; the legend still says «siqnalın ilk aşkarlanması». `shows no such badge on an alarm that still fires` passes already: it guards the badge's condition.

- [ ] **Step 9: The texts** — `strings/alarms.js`, four Edits (tr, az, ru, en):

**Edit** `dashboard/src/live/i18n/strings/alarms.js` — replace:
```js
    closedGone: "Kapanan bir alarm panodan düşer: motor yalnız açık alarmları gönderiyor, geçmiş için henüz bir uç nokta yok. Kapanma kayıtları denetim kaydında.",
    seen: "Gördüm",
    seeing: "Kaydediliyor…",
```
with:
```js
    closedGone: "Kapanan bir alarm panodan düşer: motor yalnız açık alarmları gönderiyor, geçmiş için henüz bir uç nokta yok. Kapanma kayıtları denetim kaydında. Kritik bir alarm ise durumu geçse de biri onaylayana kadar «geçti · onaylanmadı» olarak burada kalır; sesi durur.",
    // G2-A1 (O17): a critical whose condition passed before anyone acknowledged it.
    resolvedUnacked: "geçti · onaylanmadı",
    resolvedAt: "geçtiği saat",
    seen: "Gördüm",
    seeing: "Kaydediliyor…",
    // The acknowledge button's accessible name (a11y): every row carries the same word, so the name
    // says WHICH alarm — the bed and the kind — and still contains the visible word.
    ackLabel: "{bed} · {kind} alarmı: gördüm",
```

**Edit** `dashboard/src/live/i18n/strings/alarms.js` — replace:
```js
    closedGone: "Bağlanan siqnal paneldən düşür: mühərrik yalnız açıq siqnalları göndərir, tarix üçün hələ uç nöqtə yoxdur. Bağlanma qeydləri audit jurnalındadır.",
    seen: "Gördüm",
    seeing: "Yadda saxlanılır…",
```
with:
```js
    closedGone: "Bağlanan siqnal paneldən düşür: mühərrik yalnız açıq siqnalları göndərir, tarix üçün hələ uç nöqtə yoxdur. Bağlanma qeydləri audit jurnalındadır. Kritik siqnal isə vəziyyət keçsə də, kimsə təsdiqləyənə qədər «keçdi · təsdiqlənməyib» kimi burada qalır; səsi dayanır.",
    resolvedUnacked: "keçdi · təsdiqlənməyib",
    resolvedAt: "keçdiyi saat",
    seen: "Gördüm",
    seeing: "Yadda saxlanılır…",
    ackLabel: "{bed} · {kind} siqnalı: gördüm",
```

**Edit** `dashboard/src/live/i18n/strings/alarms.js` — replace:
```js
    closedGone: "Закрытая тревога уходит с панели: система передаёт только открытые, конечной точки для истории пока нет. Записи о закрытии — в журнале аудита.",
    seen: "Принято",
    seeing: "Сохраняется…",
```
with:
```js
    closedGone: "Закрытая тревога уходит с панели: система передаёт только открытые, конечной точки для истории пока нет. Записи о закрытии — в журнале аудита. Критическая тревога остаётся здесь с пометкой «прошло · не подтверждено», пока её не подтвердят, даже если состояние прошло; звук прекращается.",
    resolvedUnacked: "прошло · не подтверждено",
    resolvedAt: "время, когда прошло",
    seen: "Принято",
    seeing: "Сохраняется…",
    ackLabel: "{bed} · {kind}, тревога: принято",
```

**Edit** `dashboard/src/live/i18n/strings/alarms.js` — replace:
```js
    closedGone: "A closed alarm leaves the board: the engine sends the open ones only, and there is no endpoint for the history yet. The closures are in the audit trail.",
    seen: "Seen",
    seeing: "Saving…",
```
with:
```js
    closedGone: "A closed alarm leaves the board: the engine sends the open ones only, and there is no endpoint for the history yet. The closures are in the audit trail. A critical alarm stays here, marked \"resolved · unacknowledged\", until someone acknowledges it, even after its condition has passed; its sound stops.",
    resolvedUnacked: "resolved · unacknowledged",
    resolvedAt: "resolved at",
    seen: "Seen",
    seeing: "Saving…",
    ackLabel: "{bed} · {kind} alarm: seen",
```

`strings/patient.js`, four Edits (X5):

**Edit** `dashboard/src/live/i18n/strings/patient.js` — replace:
```js
    trendsLegendAlarm: "alarmın ilk tespiti",
```
with:
```js
    trendsLegendAlarm: "alarmın başladığı an",
```

**Edit** `dashboard/src/live/i18n/strings/patient.js` — replace:
```js
    trendsLegendAlarm: "siqnalın ilk aşkarlanması",
```
with:
```js
    trendsLegendAlarm: "siqnalın başladığı an",
```

**Edit** `dashboard/src/live/i18n/strings/patient.js` — replace:
```js
    trendsLegendAlarm: "первое обнаружение тревоги",
```
with:
```js
    trendsLegendAlarm: "момент начала тревоги",
```

**Edit** `dashboard/src/live/i18n/strings/patient.js` — replace:
```js
    trendsLegendAlarm: "an alarm's first detection",
```
with:
```js
    trendsLegendAlarm: "when an alarm began",
```

- [ ] **Step 10: The adapter**

**Edit** `dashboard/src/liveAdapters.js` — replace:
```js
        status: a.acknowledged ? "ACKNOWLEDGED" : "FIRED",
```
with:
```js
        // RESOLVED (G2-A1, O17): a critical whose rule stopped firing before anyone acknowledged
        // it. The engine keeps it on the board until someone does; it still waits for an answer,
        // but its sound has stopped (signals.js).
        status: a.acknowledged ? "ACKNOWLEDGED" : a.resolved_at ? "RESOLVED" : "FIRED",
```

**Edit** `dashboard/src/liveAdapters.js` — replace:
```js
        firstSeenAtMs: msFromTimestamp(a.first_seen_at),
        firedAtSec: null,
```
with:
```js
        firstSeenAtMs: msFromTimestamp(a.first_seen_at),
        // When its rule stopped firing (status RESOLVED), on the wall clock; null while it fires.
        resolvedAtMs: msFromTimestamp(a.resolved_at),
        // This alarm's EPISODE: a kind that cleared and fired again is a new one, with a first-seen
        // instant of its own. The notification is keyed and tagged by it (AlarmSignals.jsx), so a
        // new episode is a new notification rather than a silent replacement of the old one.
        episode: `${p.patient_id}::${a.kind}::${a.first_seen_at ?? ""}`,
        firedAtSec: null,
```

- [ ] **Step 11: The mapping — what rings**

**Edit** `dashboard/src/live/signals/signals.js` — replace:
```js
/** What the page plays now: the worst pattern among the alarms somebody must answer, or null. */
export function soundFor(board) {
  const { items } = alarmsToSignal(board ?? {});
  let worst = null;
  for (const alarm of items) {
    const pattern = patternOf(alarm);
    if (pattern && (worst === null || PATTERNS.indexOf(pattern) < PATTERNS.indexOf(worst))) worst = pattern;
  }
  return worst;
}

/** The alarms a notification is raised for — the waiting ones whose pattern is critical, as the
 *  previous workspace raised them for its CRITICAL tier only — and whether the board is LIVE
 *  (`known`): only a LIVE board may say an alarm is no longer waiting. */
export function notifyFor(board) {
  const { known, items } = alarmsToSignal(board ?? {});
  return { known, items: items.filter((alarm) => patternOf(alarm) === "critical") };
}
```
with:
```js
/** A RESOLVED alarm (G2-A1, O17) — a critical whose rule stopped before anyone acknowledged it —
 *  still waits for its answer, and the screens keep it; but the sound and the vibration stop at
 *  resolve (D11). What is happening now rings; the to-do does not. */
const rings = (alarm) => alarm.status !== "RESOLVED";

/** What the page plays now: the worst pattern among the alarms somebody must answer, or null. */
export function soundFor(board) {
  const { items } = alarmsToSignal(board ?? {});
  let worst = null;
  for (const alarm of items.filter(rings)) {
    const pattern = patternOf(alarm);
    if (pattern && (worst === null || PATTERNS.indexOf(pattern) < PATTERNS.indexOf(worst))) worst = pattern;
  }
  return worst;
}

/** The alarms a notification is raised for — the waiting ones whose pattern is critical, as the
 *  previous workspace raised them for its CRITICAL tier only — and whether the board is LIVE
 *  (`known`): only a LIVE board may say an alarm is no longer waiting. `ringing` are those a NEW
 *  notification may be raised for: not a RESOLVED one, whose vibration stopped with its sound —
 *  a notification already raised for it stays while it waits. */
export function notifyFor(board) {
  const { known, items } = alarmsToSignal(board ?? {});
  const critical = items.filter((alarm) => patternOf(alarm) === "critical");
  return { known, items: critical, ringing: critical.filter(rings) };
}
```

- [ ] **Step 12: The page — notifications by episode, raised only for what rings**

**Edit** `dashboard/src/live/signals/AlarmSignals.jsx` — replace:
```jsx
//   * A notification is raised for each critical alarm while the page is in the background
//     (`document.hidden`), once per alarm, staying until dismissed (`requireInteraction`), with the
//     old vibration pattern and, as the old one, a `tag` per alarm, so that two tabs of the same
//     browser replace each other's rather than stack. Its text names the alarm's bed — the HIS bed
//     label, else the patient id (liveAdapters.js `bedLabel`), exactly as the old one did (the
//     user's decision, 13.10).
```
with:
```jsx
//   * A notification is raised for each critical alarm while the page is in the background
//     (`document.hidden`), once per alarm episode, staying until dismissed (`requireInteraction`),
//     with the old vibration pattern and, as the old one, a `tag` per alarm — per EPISODE since
//     G2-A1, so a critical that cleared and came back is a new notification, not a silent
//     replacement under the old tag —, so that two tabs of the same browser replace each other's
//     rather than stack. Its text names the alarm's bed — the HIS bed label, else the patient id
//     (liveAdapters.js `bedLabel`), exactly as the old one did (the user's decision, 13.10).
//   * A RESOLVED alarm (G2-A1: a critical whose rule stopped before anyone acknowledged it) still
//     waits, so a notification already raised for it stays; but it sounds nothing and raises no
//     new notification — the sound and the vibration stop at resolve (signals.js `rings`).
```

**Edit** `dashboard/src/live/signals/AlarmSignals.jsx` — replace:
```jsx
/** The tag of one alarm's notification: a hash of its key, never the key — the key is
 *  `<patient_id>::<kind>`, and the patient id stays out of what the page hands the operating
 *  system (Decision 21). Two different alarms sharing a 32-bit hash would replace each other's
 *  notification; with a ward's handful of open alarms that is about one in a hundred million. */
```
with:
```jsx
/** The tag of one alarm's notification: a hash of its key, never the key — the key is the
 *  alarm's episode, `<patient_id>::<kind>::<first seen>` (liveAdapters.js `episode`, G2-A1), and
 *  the patient id stays out of what the page hands the operating system (Decision 21). Two
 *  different alarms sharing a 32-bit hash would replace each other's notification; with a ward's
 *  handful of open alarms that is about one in a hundred million. */
```

**Edit** `dashboard/src/live/signals/AlarmSignals.jsx` — replace:
```jsx
  // The notifications. Keyed by alarm id — or LOCKED, the one raised while locked.
```
with:
```jsx
  // The notifications. Keyed by alarm EPISODE (G2-A1) — or LOCKED, the one raised while locked.
```

**Edit** `dashboard/src/live/signals/AlarmSignals.jsx` — replace:
```jsx
    const { known, items } = notifyFor({ alerts, connection, loaded });
    const keys = locked ? (items.length ? [LOCKED] : []) : items.map((a) => a.id);
    for (const key of [...open.keys()]) {
      const lockChanged = locked !== (key === LOCKED);
      // Only a LIVE board may say an alarm stopped waiting; a lock or an unlock retires the other kind.
      if (lockChanged || (known && !keys.includes(key))) close(key);
    }
    if (!hidden) return;
    if (locked) {
      if (keys.length && !open.has(LOCKED)) {
        keep(LOCKED, raise(t("signals.notifyTitle"), t("signals.notifyBodyLocked"), { tag: TAG_PREFIX + LOCKED }));
      }
      return;
    }
    for (const alarm of items) {
      if (open.has(alarm.id)) continue;
      keep(alarm.id, raise(t("signals.notifyTitle"), t("signals.notifyBody", { bed: alarm.bedLabel || "—" }),
        { tag: alarmTag(alarm.id) }));
    }
```
with:
```jsx
    const { known, items, ringing } = notifyFor({ alerts, connection, loaded });
    const keys = locked ? (items.length ? [LOCKED] : []) : items.map((a) => a.episode);
    for (const key of [...open.keys()]) {
      const lockChanged = locked !== (key === LOCKED);
      // Only a LIVE board may say an alarm stopped waiting; a lock or an unlock retires the other kind.
      if (lockChanged || (known && !keys.includes(key))) close(key);
    }
    if (!hidden) return;
    // Raised only for what still rings: a RESOLVED alarm keeps a notification it already has, and
    // gets no new one (signals.js `notifyFor`, G2-A1).
    if (locked) {
      if (ringing.length && !open.has(LOCKED)) {
        keep(LOCKED, raise(t("signals.notifyTitle"), t("signals.notifyBodyLocked"), { tag: TAG_PREFIX + LOCKED }));
      }
      return;
    }
    for (const alarm of ringing) {
      if (open.has(alarm.episode)) continue;
      keep(alarm.episode, raise(t("signals.notifyTitle"), t("signals.notifyBody", { bed: alarm.bedLabel || "—" }),
        { tag: alarmTag(alarm.episode) }));
    }
```

- [ ] **Step 13: The alarms screen**

**Edit** `dashboard/src/live/screens/alarms/AlarmsScreen.jsx` — replace:
```jsx
// as "nothing was closed today", which is a different and false statement. So the screen says in
// one sentence where a closed alarm went, and shows two sections.
```
with:
```jsx
// as "nothing was closed today", which is a different and false statement. So the screen says in
// one sentence where a closed alarm went, and shows two sections. Since G2-A1 one kind of alarm
// stays although its condition passed: a critical nobody acknowledged (status RESOLVED). It waits
// in the first section, with a badge, until someone acknowledges it — which removes it.
```

**Edit** `dashboard/src/live/screens/alarms/AlarmsScreen.jsx` — replace:
```jsx
  return SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || oldestFirst(a, b);
```
with:
```jsx
  // After severity, an alarm that still fires before a critical that passed unacknowledged
  // (G2-A1): the latter waits for an answer, but the former is what is happening now.
  return SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
    || (a.status === "RESOLVED") - (b.status === "RESOLVED")
    || oldestFirst(a, b);
```

**Edit** `dashboard/src/live/screens/alarms/AlarmsScreen.jsx` — replace:
```jsx
          {alarm.escalated ? <StatusPill tone="att" icon="alert">{t("board.escalated")}</StatusPill> : null}
```
with:
```jsx
          {alarm.escalated ? <StatusPill tone="att" icon="alert">{t("board.escalated")}</StatusPill> : null}
          {/* G2-A1 (O17): a critical whose condition passed before anyone acknowledged it stays
              here, waiting, until someone does. Its sound has stopped (signals.js); the badge and
              the instant it passed say why it is still on the list. */}
          {alarm.status === "RESOLVED" ? <StatusPill tone="att">{t("alarms.resolvedUnacked")}</StatusPill> : null}
          {alarm.status === "RESOLVED" && Number.isFinite(alarm.resolvedAtMs) ? (
            <span>
              <span className="sr-only">{`${t("alarms.resolvedAt")}: `}</span>
              <span className="font-data">{hhmm(alarm.resolvedAtMs)}</span>
            </span>
          ) : null}
```

**Edit** `dashboard/src/live/screens/alarms/AlarmsScreen.jsx` — replace:
```jsx
          <Button variant="primary" size="sm" icon="ok" busy={busy} onClick={() => onAck(alarm)}>
```
with:
```jsx
          <Button variant="primary" size="sm" icon="ok" busy={busy} onClick={() => onAck(alarm)}
            aria-label={t("alarms.ackLabel", { bed, kind: alarm.kind })}>
```

- [ ] **Step 14: The waiting queue — a firing alarm before a RESOLVED one; and two comments** (`boardStore.js`, `TrendLegend.jsx`)

**Edit** `dashboard/src/live/data/boardStore.js` — replace:
```js
const needsAnswer = (a) => !a.ack && !isChronicExpected(a);
```
with:
```js
// A RESOLVED alarm (G2-A1: a critical whose rule stopped before anyone acknowledged it) is never
// acknowledged — an acknowledgement removes it — so it needs an answer, and the bell, the rail and
// the lock screen count it. Only the sound and the notification's vibration stop (signals.js).
const needsAnswer = (a) => !a.ack && !isChronicExpected(a);
```

**Edit** `dashboard/src/live/data/boardStore.js` — replace:
```js
 *  build does not know first — it may be the worst —, then the most severe, then the oldest first.
```
with:
```js
 *  build does not know first — it may be the worst —, then the most severe, an alarm that still
 *  fires before one that passed unacknowledged (RESOLVED), then the oldest first.
```

**Edit** `dashboard/src/live/data/boardStore.js` — replace:
```js
 *  then the oldest. The one ordering `waitingAlarms` and `alarmsToSignal` share. */
function queue(alerts) {
  const rank = (a) => SEVERITY_ORDER.indexOf(a.severity);   // -1: unknown, first
  return alerts.filter(needsAnswer).sort((a, b) => rank(a) - rank(b)
    || (a.firstSeenAtMs ?? Infinity) - (b.firstSeenAtMs ?? Infinity));
```
with:
```js
 *  firing before RESOLVED, then the oldest. The one ordering `waitingAlarms` and `alarmsToSignal` share. */
function queue(alerts) {
  const rank = (a) => SEVERITY_ORDER.indexOf(a.severity);   // -1: unknown, first
  // After severity, one that still fires before one that passed unacknowledged (RESOLVED, G2-A1).
  return alerts.filter(needsAnswer).sort((a, b) => rank(a) - rank(b)
    || (a.status === "RESOLVED") - (b.status === "RESOLVED")
    || (a.firstSeenAtMs ?? Infinity) - (b.firstSeenAtMs ?? Infinity));
```

**Edit** `dashboard/src/live/screens/patient/trends/TrendLegend.jsx` — replace:
```jsx
      {/* ▲ is a finding's FIRST DETECTION for this patient (its `first_seen` stamp), not every
          alarm episode: the engine's active alerts never clear a kind today (O17). */}
```
with:
```jsx
      {/* ▲ is where an alarm EPISODE began (its `first_seen` stamp): since G2-A1 (O17) an alert
          clears when its rule stops firing, and a return is a new episode with a mark of its own. */}
```

- [ ] **Step 14b: The badge on every surface (X10)** — the bed card, the bed list, the patient screen's finding, the bell

**Edit** `dashboard/src/live/screens/beds/BedCard.jsx` — replace:
```jsx
import { Icon, RiskPill, riskStyle } from "../../ui/index.js";
```
with:
```jsx
import { Icon, RiskPill, StatusPill, riskStyle } from "../../ui/index.js";
```

**Edit** `dashboard/src/live/screens/beds/BedCard.jsx` — replace:
```jsx
                <span lang="en" className="min-w-0 flex-1 text-12.5 text-ink">{summaryOf(a) ?? t("board.findingUnnamed")}</span>
```
with:
```jsx
                <span lang="en" className="min-w-0 flex-1 text-12.5 text-ink">{summaryOf(a) ?? t("board.findingUnnamed")}</span>
                {/* G2-A1 (O17): a critical whose condition passed waits here, but the card's risk
                    (computed from the alarms that still fire) is calm — the badge, the alarms
                    screen's own, says why this line is still red. */}
                {a.status === "RESOLVED" ? <StatusPill tone="att">{t("alarms.resolvedUnacked")}</StatusPill> : null}
```

**Edit** `dashboard/src/live/screens/beds/BedsScreen.jsx` — replace:
```jsx
import { Box, Empty, Field, Icon, Input, RiskPill, Seg, Table } from "../../ui/index.js";
```
with:
```jsx
import { Box, Empty, Field, Icon, Input, RiskPill, Seg, StatusPill, Table } from "../../ui/index.js";
```

**Edit** `dashboard/src/live/screens/beds/BedsScreen.jsx` — replace:
```jsx
                {open.length ? <small lang="en" className="block text-11 text-mute">{summaryOf(open[0]) ?? t("board.findingUnnamed")}</small> : null}
```
with:
```jsx
                {open.length ? <small lang="en" className="block text-11 text-mute">{summaryOf(open[0]) ?? t("board.findingUnnamed")}</small> : null}
                {/* G2-A1 (O17): outside the `lang="en"` line — the badge is the interface's own words. */}
                {open[0]?.status === "RESOLVED" ? <StatusPill tone="att">{t("alarms.resolvedUnacked")}</StatusPill> : null}
```

**Edit** `dashboard/src/live/screens/patient/PatientScreen.jsx` — replace:
```jsx
        {alarm.escalated ? <StatusPill tone="att" icon="alert">{t("board.escalated")}</StatusPill> : null}
```
with:
```jsx
        {alarm.escalated ? <StatusPill tone="att" icon="alert">{t("board.escalated")}</StatusPill> : null}
        {/* G2-A1 (O17): the alarms screen's own badge — this finding's condition passed before anyone acknowledged it. */}
        {alarm.status === "RESOLVED" ? <StatusPill tone="att">{t("alarms.resolvedUnacked")}</StatusPill> : null}
```

**Edit** `dashboard/src/live/shell/TopBar.jsx` — replace:
```jsx
import { Icon, RiskPill } from "../ui/index.js";
```
with:
```jsx
import { Icon, RiskPill, StatusPill } from "../ui/index.js";
```

**Edit** `dashboard/src/live/shell/TopBar.jsx` — replace:
```jsx
                      <span lang="en" className="block text-12 text-mute">{summaryOf(a) ?? t("board.findingUnnamed")}</span>
```
with:
```jsx
                      <span lang="en" className="block text-12 text-mute">{summaryOf(a) ?? t("board.findingUnnamed")}</span>
                      {/* G2-A1 (O17): a critical whose condition passed still waits for its answer;
                          the badge is the alarms screen's own, outside the `lang="en"` line. */}
                      {a.status === "RESOLVED" ? <StatusPill tone="att">{t("alarms.resolvedUnacked")}</StatusPill> : null}
```

- [ ] **Step 15: Green — the touched files and the dictionaries' test**

```bash
cd /c/tmp/g2a-o17/dashboard
npx vitest run src/liveAdapters.test.js src/live/data/boardStore.test.js src/live/signals/signals.test.js src/live/signals/AlarmSignals.test.jsx src/live/screens/alarms/AlarmsScreen.test.jsx src/live/screens/patient/trends/TrendModal.test.jsx src/live/screens/beds/BedCard.test.jsx src/live/screens/beds/BedsScreen.test.jsx src/live/screens/patient/PatientScreen.test.jsx src/live/shell/Shell.test.jsx src/live/i18n/strings.test.js 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
```

Expected: ` Test Files  11 passed (11)` and `      Tests  410 passed (410)`.

- [ ] **Step 16: The dashboard gate — the whole suite, then the build**

```bash
cd /c/tmp/g2a-o17/dashboard
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
```

Expected: ` Test Files  89 passed (89)` and `      Tests  2411 passed (2411)`.

```bash
cd /c/tmp/g2a-o17/dashboard
npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
```

Expected: `✓ built in …`, `precache  20 entries (…)`, no `larger than`.

- [ ] **Step 17: Line ends**

```bash
cd /c/tmp/g2a-o17
for f in dashboard/src/liveAdapters.js dashboard/src/liveAdapters.test.js dashboard/src/live/data/board.testutil.js dashboard/src/live/data/boardStore.js dashboard/src/live/data/boardStore.test.js dashboard/src/live/signals/signals.js dashboard/src/live/signals/signals.test.js dashboard/src/live/signals/AlarmSignals.jsx dashboard/src/live/signals/AlarmSignals.test.jsx dashboard/src/live/screens/alarms/AlarmsScreen.jsx dashboard/src/live/screens/alarms/AlarmsScreen.test.jsx dashboard/src/live/i18n/strings/alarms.js dashboard/src/live/i18n/strings/patient.js dashboard/src/live/screens/patient/trends/TrendLegend.jsx dashboard/src/live/screens/patient/trends/TrendModal.test.jsx dashboard/src/live/screens/beds/BedCard.jsx dashboard/src/live/screens/beds/BedCard.test.jsx dashboard/src/live/screens/beds/BedsScreen.jsx dashboard/src/live/screens/beds/BedsScreen.test.jsx dashboard/src/live/screens/patient/PatientScreen.jsx dashboard/src/live/screens/patient/PatientScreen.test.jsx dashboard/src/live/shell/TopBar.jsx dashboard/src/live/shell/Shell.test.jsx; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected: `liveAdapters.js CR=239 LF=239`, `liveAdapters.test.js CR=519 LF=519`, `board.testutil.js CR=164 LF=164`, `boardStore.js CR=534 LF=534`, `boardStore.test.js CR=641 LF=641`, `signals.js CR=57 LF=57`, `signals.test.js CR=119 LF=119`, `AlarmSignals.jsx CR=292 LF=292`, `AlarmSignals.test.jsx CR=381 LF=381`, `AlarmsScreen.jsx CR=268 LF=268`, `AlarmsScreen.test.jsx CR=366 LF=366`, `alarms.js CR=138 LF=138`, `patient.js CR=470 LF=470`, `TrendLegend.jsx CR=107 LF=107`, `TrendModal.test.jsx CR=666 LF=666`, `BedCard.jsx CR=171 LF=171`, `BedCard.test.jsx CR=302 LF=302`, `BedsScreen.jsx CR=363 LF=363`, `BedsScreen.test.jsx CR=414 LF=414`, `PatientScreen.jsx CR=423 LF=423`, `PatientScreen.test.jsx CR=902 LF=902`, `TopBar.jsx CR=297 LF=297`, `Shell.test.jsx CR=536 LF=536`.

- [ ] **Step 18: Commit**

```bash
cd /c/tmp/g2a-o17
git add dashboard/src/liveAdapters.js dashboard/src/liveAdapters.test.js dashboard/src/live/data/board.testutil.js dashboard/src/live/data/boardStore.js dashboard/src/live/data/boardStore.test.js dashboard/src/live/signals/signals.js dashboard/src/live/signals/signals.test.js dashboard/src/live/signals/AlarmSignals.jsx dashboard/src/live/signals/AlarmSignals.test.jsx dashboard/src/live/screens/alarms/AlarmsScreen.jsx dashboard/src/live/screens/alarms/AlarmsScreen.test.jsx dashboard/src/live/i18n/strings/alarms.js dashboard/src/live/i18n/strings/patient.js dashboard/src/live/screens/patient/trends/TrendLegend.jsx dashboard/src/live/screens/patient/trends/TrendModal.test.jsx dashboard/src/live/screens/beds/BedCard.jsx dashboard/src/live/screens/beds/BedCard.test.jsx dashboard/src/live/screens/beds/BedsScreen.jsx dashboard/src/live/screens/beds/BedsScreen.test.jsx dashboard/src/live/screens/patient/PatientScreen.jsx dashboard/src/live/screens/patient/PatientScreen.test.jsx dashboard/src/live/shell/TopBar.jsx dashboard/src/live/shell/Shell.test.jsx
git status --short && git diff --cached --stat
git commit -q -F - <<'MSG'
feat(dashboard): a critical whose condition passed waits silently for its acknowledgement, on every surface (G2-A1)

The adapter maps resolved_at to status RESOLVED (acknowledged wins),
resolvedAtMs, and the alarm's episode (<patient>::<kind>::<first seen>). The
alarms row, the bed card, the bed list, the bell and the patient screen show
the badge «keçdi · təsdiqlənməyib» (X10); the alarms row adds the time it
passed and keeps the acknowledge button, whose accessible name names the bed
and the kind (alarms.ackLabel ×4). After severity a firing alarm comes
before a RESOLVED one. signals.js stops the sound at resolve and raises no
new notification for a resolved alarm, while one already raised stays; the
notification is keyed and tagged by episode (D11). The trend legend's ▲
reads «siqnalın başladığı an» (×4, X5).
On the branch: 54e1ea5, a99d36a.

red: Test Files  10 failed (10) Tests  21 failed | 383 passed (404) (no status RESOLVED or episode, no ringing, the sound and a new notification for a resolved alarm, the episode tag, the badge on every surface, the firing-first order, the button's name, the legend)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
git log --oneline -1
```

---

### Task 6: The docs — the guide, the G2-01 plan's O17, the roadmap row

**Done on the branch** as `7fe980b` (the first version's Task 6, with the roadmap row's figures and X1–X10 written in by the implementer) `55e6a08` (the guide follows X9, X10, X12 and X13: the antibiotic window, the badge on every surface, the escalation chain) and `9240dc2` (the guide follows the X12 and X13 reviews: the window is restored within 15 minutes; only an unanswered alarm keeps its escalation chain); the roadmap row was brought up to date at the end of the slice (its range, the final counts, X1–X14, O1–O15, the acceptance on the dev server, X11), in the commit that carries this plan's second version. The blocks below give the three documents byte for byte, the row's range left as `<range>`.

Spec §4 "Docs" and D12's legend, with X7. The guide is Turkish, so it quotes the tr texts («geçti · onaylanmadı», «alarmın başladığı an»); the board's default language says «keçdi · təsdiqlənməyib». History is kept: the G2-01 plan's O17 lines get a "resolved by G2-A1" note, nothing in them is rewritten. `Homunculus/wiki` is untouched — no clinical claim changes.

**Files:**
- Modify: `docs/homunculus-rehber-TR.md` (§2's sound and tag, §3's medication passage, §3.6's second question, §3.7's ▲), `docs/superpowers/plans/2026-10-19-g2-vital-egrileri.md` (X3 row, the Task 4 amendment, the O17 row), `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` (the row G2-A1 after G2-01)

- [ ] **Step 1: The guide** — five Edits in `docs/homunculus-rehber-TR.md`.

"Kapanan alarm nereye gitti?" becomes the rule:

**Edit** `docs/homunculus-rehber-TR.md` — replace:
```markdown
2. **"Kapanan alarm nereye gitti?"** Panodan düştü (bugün motor bir bulguyu kapatmıyor; alarm
   panoda kalır — plandaki O17, kullanıcı kararı bekliyor). Motor yalnız açık alarmları gönderiyor ve
   alarm geçmişi için henüz bir uç yok; kapanma kaydı denetim kaydında (`audit.view` ister).
```
with:
```markdown
2. **"Kapanan alarm nereye gitti?"** Panodan düştü. Bir alarm, kuralı onu üretmeyi bıraktığı ilk
   ölçümde kapanır — bekleme süresi yok (G2-A1, O17'nin kararı, 25.10.2026). Tek istisna:
   **kimsenin onaylamadığı kritik bir alarm** durumu geçince de her yüzeyde (alarm listesi, yatak
   kartı, yatak listesi, zil, hasta ekranı) «geçti · onaylanmadı» olarak kalır, sesi durur; biri
   onaylayınca kalkar. Onaylanmış bir kritik alarm ile yüksek, orta ve düşük alarmlar kuralla
   birlikte gider. Aynı alarm yeniden çıkarsa yeni bir bölümdür: yeni ilk görülme anı (eğride yeni
   ▲) ve — aciliyeti «anında» olan alarmlarda — hemşireye yeni bildirim; gidip gelen bir değer
   (nabız 140 → 80 → 140) her dönüşünde yeniden bildirir, bunun için bilerek bir bekleme yok.
   Kimsenin onaylamadığı bir kritik alarm «geçti · onaylanmadı» durumundayken yeniden çıkarsa
   aynı bölümdür, yeni bildirim getirmez (O5). Kimsenin cevaplamadığı bir alarmın eskalasyon saati
   kapanmayla sıfırlanmaz: dönüş eskalasyon süresi (5 dk) içindeyse önceki bölümün saati sürer ve
   doktor yeniden çağrılmaz; daha uzun bir aradan sonraki dönüş, ya da onaylanmış bir bölümden
   sonraki her dönüş, yeni bir saat başlatır (G2-A1 X13). Motor yalnız açık alarmları
   gönderiyor ve alarm geçmişi için henüz bir uç yok; kapanma kaydı denetim kaydında
   (`alert_cleared`; `audit.view` ister).
```

The ▲ is an episode's start:

**Edit** `docs/homunculus-rehber-TR.md` — replace:
```markdown
  ve birimi; ▲ bulgunun bu hasta için ilk tespit edildiği an (motor bugün bir bulguyu kuralı
  sustuktan sonra da açık tutuyor, bu yüzden aynı türden bir bulgu için ikinci ▲ çıkmaz — plandaki
  O17), ◆ kaydedilmiş antibiyotik dozu; aynı sayıların tablosu,
```
with:
```markdown
  ve birimi; ▲ bir alarm bölümünün başladığı an (G2-A1'den beri bir alarm kuralı susunca kapanır;
  yeniden çıkarsa kendi ▲'sı olan yeni bir bölümdür — lejant «alarmın başladığı an» der),
  ◆ kaydedilmiş antibiyotik dozu; aynı sayıların tablosu,
```

The sound stops at resolve:

**Edit** `docs/homunculus-rehber-TR.md` — replace:
```markdown
  bilgi sessizdir; önem derecesi bilinmeyen bir alarm kritik gibi çalar. Alarm onaylanınca susar.
```
with:
```markdown
  bilgi sessizdir; önem derecesi bilinmeyen bir alarm kritik gibi çalar. Alarm onaylanınca susar;
  durumu geçince de susar — kimsenin onaylamadığı kritik bir alarm durumu geçince «geçti ·
  onaylanmadı» olarak yanıt beklemeye devam eder ama çalmaz, yeni bildirim de getirmez (G2-A1).
```

The notification's tag is the episode's:

**Edit** `docs/homunculus-rehber-TR.md` — replace:
```markdown
  alarm için bildirimi üst üste yığmasın diye her bildirim alarmına göre etiketlenir; etiket
  alarmın kimliğinin bir özetidir (hash), hasta kimliğini taşımaz. Sayfa kapanınca ya da yenilenince açık bildirimler kapanır; sayfa
```
with:
```markdown
  alarm için bildirimi üst üste yığmasın diye her bildirim alarmın bölümüne göre etiketlenir
  (G2-A1: kapanıp yeniden çıkan bir alarm yeni bir bildirimdir, eskisinin yerine sessizce geçmez);
  etiket bölümün kimliğinin bir özetidir (hash), hasta kimliğini taşımaz. Sayfa kapanınca ya da yenilenince açık bildirimler kapanır; sayfa
```

The antibiotic window, as X9 and X12 left it (`55e6a08`):

**Edit** `docs/homunculus-rehber-TR.md` — replace:
```markdown
    verilmediği anlamına gelmez".
```
with:
```markdown
    verilmediği anlamına gelmez". Antibiyotik penceresi (1 saat) sepsisin ya da septik şokun fark
    edildiği anda başlar; antibiyotik uyarıları yalnız sepsis ya da septik şok sürerken görünür,
    ama pencere altta saymaya devam eder (sepsis geri gelirse geçen gerçek süre görünür) ve yalnız
    klinisyen şüpheli enfeksiyonu "yok" olarak işaretleyince biter. Bu işaret 15 dakika içinde
    düzeltilirse (enfeksiyon yeniden "var" işaretlenirse) eski pencere geri gelir — düzeltme aynı
    olaydır; 15 dakikadan sonrası yeni bir pencere başlatır (yeni bir enfeksiyon eski pencereyi ve
    o sırada verilmiş dozları devralmaz).
```

- [ ] **Step 2: The G2-01 plan's O17** — three Edits in `docs/superpowers/plans/2026-10-19-g2-vital-egrileri.md` (the X3 row at `:23`, the Task 4 amendment at `:1442`, and the open item itself at `:12979`, which §4 did not list — X7).

**Edit** `docs/superpowers/plans/2026-10-19-g2-vital-egrileri.md` — replace:
```markdown
one per patient and kind ever: O17; the legend calls ▲ the first detection), at the escalation clock's own instant (`payload["at"]`, else `ts`). |
```
with:
```markdown
one per patient and kind ever: O17; the legend calls ▲ the first detection), at the escalation clock's own instant (`payload["at"]`, else `ts`). **Resolved by G2-A1 (2026-10-25):** an alert now clears when its rule stops firing, so the rows are one per episode and the legend says «siqnalın başladığı an» (plan `2026-10-25-g2a-alarm-bolumleri.md`). |
```

**Edit** `docs/superpowers/plans/2026-10-19-g2-vital-egrileri.md` — replace:
```markdown
the comments say honestly what a ▲ is (O17);
```
with:
```markdown
the comments say honestly what a ▲ is (O17 — since G2-A1, 2026-10-25, the start of an episode, and the comments say so);
```

**Edit** `docs/superpowers/plans/2026-10-19-g2-vital-egrileri.md` — replace:
```markdown
until then the legend's "first detection" is the truth. | User decision; engine | After the deploy |
```
with:
```markdown
until then the legend's "first detection" is the truth. **Resolved by G2-A1 (2026-10-25,** spec `2026-10-25-g2a-alarm-bolumleri-design.md`, plan `2026-10-25-g2a-alarm-bolumleri.md`**):** the bucket is rebuilt from every evaluation, a critical nobody acknowledged latches until someone does, a return is a new episode, and the legend reads «siqnalın başladığı an». | User decision; engine | Done in G2-A1 |
```

- [ ] **Step 3: The roadmap row** — after the G2-01 row of "Grup 2 · durum" (if Lane B's row is already there when you rebase, keep both: G2-01, G2-A1, then B's):

**Edit** `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` — replace:
```markdown
(X1–X19 onaylandı, O4 çözüldü: 2026-10-20) |

---
```
with:
```markdown
(X1–X19 onaylandı, O4 çözüldü: 2026-10-20) |
| G2-A1 | Alarm bölümleri (O17): bir alarm, kuralı onu üretmeyi bıraktığı ilk ölçümde kapanır; kimsenin onaylamadığı kritik alarm «geçti · onaylanmadı» olarak onaylanana kadar kalır, sesi durur; yeniden çıkan alarm yeni bir bölümdür (yeni ilk görülme, eskalasyon saati, hemşire bildirimi ve ▲); `alert_cleared` denetim olayı; yeniden başlatma panoyu bölüm bölüm kurar · spec: [2026-10-25](../specs/2026-10-25-g2a-alarm-bolumleri-design.md) · plan: [G2-A1](2026-10-25-g2a-alarm-bolumleri.md) | Kod ✅ 2026-10-25 · <range> · **VM'de değil** (kabul kullanıcıyla, ayrı adım: spec §6; web api'den sonra değil — eski web, kilitli kalan bir kritiği hâlâ çalıyormuş gibi seslendirir). Backend 2220 / 650 (DB'siz), Python 3.14 dilimi 179; dashboard 89 dosya / 2411 test; derleme 20 öğe. Kabul (spec §6'nın dört adımı) geliştirme sunucusunda (X11) geçti — SQLite denetim, gerçek yeniden başlatma, sentetik yataklar; Docker yığını çalıştırılmadı. **Açık:** plandaki X1–X14 (X9: antibiyotik saatinin başlangıç anı yalnız şüpheli enfeksiyon «yok» diye kaydedilince bırakılır, antibiyotik alarmları yalnız sepsis ya da septik şok sürerken görünür — kullanıcı kararı 25.10; X10: «geçti · onaylanmadı» rozeti yalnız alarm ekranında değil, yatak kartında, yatak listesinde, zilde ve hasta ekranında da; X11: kabul geliştirme sunucusunda; X12: «yok» işareti 15 dakika içinde düzeltilirse eski antibiyotik penceresi geri gelir; X13: kimsenin yanıtlamadığı bir alarm eskalasyon süresi içinde dönerse aynı eskalasyon zinciridir, onay zinciri bitirir; X14: doktor zincir başına bir kez çağrılır) ve O1–O15 (O15: saatlerce yanıtsız kalan bir alarm için yinelenen çağrı yok — sonraki dilimde kullanıcı kararı); az/ru/en metinleri yerel okuma bekliyor |

---
```

Then fill `<range>` with the slice's first and last code commits:

```bash
cd /c/tmp/g2a-o17
git log --format=%h --reverse c66a615..HEAD -- homunculus-engine dashboard | sed -n '1p;$p' | paste -sd' '
```

It prints two short hashes, Task 1's and Task 5's (with review fixes, the last code commit). **Edit** the roadmap: replace `<range>` with `<first>..<last>`. If a review changed the counts, write the counts Task 7 measures instead of the ones in the block.

- [ ] **Step 4: Line ends**

```bash
cd /c/tmp/g2a-o17
for f in docs/homunculus-rehber-TR.md docs/superpowers/plans/2026-10-19-g2-vital-egrileri.md docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected: `homunculus-rehber-TR.md CR=1162 LF=1162`, `2026-10-19-g2-vital-egrileri.md CR=13040 LF=13040`, `2026-10-01-tasarim-entegrasyonu-yol-haritasi.md CR=1293 LF=1293`.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g2a-o17
git add docs/homunculus-rehber-TR.md docs/superpowers/plans/2026-10-19-g2-vital-egrileri.md docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md
git status --short && git diff --cached --stat
git commit -q -F - <<'MSG'
docs: alerts end with their rule — the guide, the G2-01 plan's O17 and the roadmap row G2-A1

The Turkish guide's "where did the closed alarm go" answer becomes the rule
(an alert ends on the first reading that does not produce it; a critical
nobody acknowledged stays as «geçti · onaylanmadı» on every surface, silent,
until someone does; a return is a new episode, and its escalation chain goes
on within the delay unless it was answered), the antibiotic window as X9 and X12 left it, the trend
marks are episodes, and the sound and the notification's tag say what
changed. The G2-01 plan's O17 is marked resolved by G2-A1, history kept. The
roadmap gains the G2-A1 row.
On the branch: 7fe980b, 55e6a08, 9240dc2, and the row's final state with this plan.

red: none (docs)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
git log --oneline -1
```

---

### Task 7: The gates, and the acceptance

Everything runs once more, in full, at the branch head; then the spec's §6 acceptance. **As run (X11):** on the engine's own dev server, from a `git archive` export of the branch head, with a real stop and start between the two phases — the controller's G2-01 stack held the Docker container names. The Docker walk (Steps 9–11) stays for the walk with the user; it was not run. Never on the VM: the deploy and the VM acceptance with the user are a later, separate step (O14). No repo file changes in this task.

- [ ] **Step 1: The engine, no database**

```bash
cd /c/tmp/g2a-o17/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -1
```

Expected: `2220 passed, 650 skipped, 3 warnings in …` — the base's 2143 plus this slice's 77 (in a `git archive` export: `4 failed, 2216 passed` — the four tests that build a release from git).

- [ ] **Step 2: Postgres is not needed — say so with evidence** (O13)

```bash
cd /c/tmp/g2a-o17
grep -ln "TEST_DATABASE_URL\|postgres" $(git diff --name-only c66a615 HEAD -- homunculus-engine/tests); echo "grep exit $?"
ls homunculus-engine/alembic/versions | tail -1
```

Expected: no file name, `grep exit 1` — none of the touched test files reads the test database; and `0011_users_must_change_password.py`: no migration in this slice.

- [ ] **Step 3: Python 3.14, the ten touched engine test files**

```bash
cd /c/tmp/g2a-o17/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/g115-py314/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_pipeline.py tests/test_trends.py tests/test_alert_lifecycle.py tests/test_ackstore.py tests/test_board.py tests/test_alarm_quality.py tests/test_api_ack.py tests/test_api_ingest.py tests/test_api_clinical.py tests/test_rehydrate.py 2>&1 | tail -1
```

Expected: `179 passed, 3 warnings in …`.

- [ ] **Step 4: The dashboard suite and build**

```bash
cd /c/tmp/g2a-o17/dashboard
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
```

Expected: ` Test Files  89 passed (89)` and `      Tests  2411 passed (2411)`.

```bash
cd /c/tmp/g2a-o17/dashboard
npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
```

Expected: `✓ built in …`, `precache  20 entries (…)`, no `larger than` (precache  20 entries (839.17 KiB) in the export, whose build has no commit to name; a checkout's differs by the commit's characters).

- [ ] **Step 5: The slice's size, and Lane B's seams untouched**

```bash
cd /c/tmp/g2a-o17
git diff --stat c66a615 HEAD | tail -1
git diff --name-only c66a615 HEAD -- homunculus-engine/src/homunculus/admission homunculus-engine/src/homunculus/escalation homunculus-engine/src/homunculus/scope homunculus-engine/src/homunculus/tenant dashboard/src/live/i18n/catalog.js dashboard/src/live/shell/routes.js dashboard/src/live/i18n/strings.test.js homunculus-engine/src/homunculus/auth; echo "lane B seams touched: $(git diff --name-only c66a615 HEAD -- homunculus-engine/src/homunculus/admission homunculus-engine/src/homunculus/escalation homunculus-engine/src/homunculus/scope homunculus-engine/src/homunculus/tenant dashboard/src/live/i18n/catalog.js dashboard/src/live/shell/routes.js dashboard/src/live/i18n/strings.test.js homunculus-engine/src/homunculus/auth | wc -l)"
git status --short
```

Expected: `47 files changed, 5443 insertions(+), 147 deletions(-)` at `9240dc2` — counted from `c66a615`, so this plan's first version is one of the files (the commit that carries this version adds its new lines); then `lane B seams touched: 0` and no status line.

- [ ] **Step 6: The acceptance script** — `/c/tmp/homunculus-plans/g2a-o17/acceptance.py` (outside the repo, standard library only; read it before running it). It writes made-up readings for three synthetic beds — `G2A-1` (a moderate alert), `G2A-2` (a critical that latches), `G2A-3` (140 → 80 → 140 → 80) — through `/ingest`, one `/ack`, and reads `/patients`, `/audit`, `/alarm-quality` and `/patients/{id}/trends`; the token comes from `HOMUNCULUS_TOKEN` and is printed nowhere. **Never point it at the VM or any stack holding a real patient.**

- [ ] **Step 7: The dev server, from an export of the head, and the first phase** (X11). The export keeps the worktree untouched; the dev server's SQLite audit lives in its own folder, synthetic, deleted afterwards.

```bash
EXP=/c/tmp/g2a-accept && mkdir -p $EXP/srv
git -C /c/tmp/g2a-o17 archive HEAD | tar -x -C $EXP
cd $EXP/srv
PYTHONPATH=$EXP/homunculus-engine/src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m uvicorn homunculus.api.devserver:app --port 18181 --log-level warning
```

(in the background: it is a server, not a gate; its token is the dev server's own `dev-token`). When `curl -s http://127.0.0.1:18181/health` answers `{"status":"ok"}`:

```bash
cd /c/tmp/homunculus-plans/g2a-o17
HOMUNCULUS_TOKEN=dev-token PYTHONIOENCODING=utf-8 /c/tmp/f7-py312/venv/Scripts/python.exe acceptance.py http://127.0.0.1:18181 before-restart
```

Expected — the record, from the export at `9240dc2` (2026-10-25):
```
1 moderate: HR 140 -> news2; HR 80 -> -
2 critical: firing antibiotic_due,sepsis,septic_shock (risk critical); after lactate 1.5 shock resolved_at set=True acknowledged=False escalated=False risk high
4 alarm-quality: G2A-3 episodes=2; trail ['first_seen', 'alert_cleared(resolved)', 'first_seen', 'alert_cleared(resolved)']
```
— §6.1: the moderate alert is gone on the first normal reading; §6.2's first half: the shock latched — resolved, unacknowledged, not escalated — and the card's risk is the firing alerts' (D10); §6.4: two episodes, each closed. (The controller's first run, at `ecef8ae` on port 18181, printed the same three lines.)

- [ ] **Step 8: Stop the server, start it again in the same folder, the second phase.** Stop it (the background task), start the same command again from `$EXP/srv` (the SQLite audit is the restart's event log), and when `/health` answers:

```bash
cd /c/tmp/homunculus-plans/g2a-o17
HOMUNCULUS_TOKEN=dev-token PYTHONIOENCODING=utf-8 /c/tmp/f7-py312/venv/Scripts/python.exe acceptance.py http://127.0.0.1:18181 after-restart
```

Expected — the record:
```
3 after restart: shock latched=True acknowledged=False
  ack -> 200; shock on the board: False
2 trail: ['first_seen', 'alert_cleared(resolved)', 'ack', 'alert_cleared(acked_after_resolve)']
3 new episode: firing=True acknowledged=False escalated=False first_seen newer=True; ▲ septic_shock marks=2
```
— §6.3: the latch survived the restart; the ack removed it; §6.2: the trail in the spec's order; the new episode fires unacknowledged with a newer first-seen and its own ▲ (two marks: episodes 1 and 3 of this bed's shock). (The controller's first run at `ecef8ae` printed the same four lines.) Stop the server; delete `/c/tmp/g2a-accept` (an export and a synthetic audit — nothing of the repo).

- [ ] **Step 9: With the Docker stack, when its names are free — not run (X11).** G1-15's synthetic stack files, as the G2-01 walk used them (`/c/tmp/g115plan/stack/{local.env, compose.g115.yml}`). The containers are named by the compose file (`homunculus-postgres`, `homunculus-api`, `homunculus-web`), so no other such stack may be up:

```bash
cd /c/tmp/g2a-o17
ls /c/tmp/g115plan/stack/local.env /c/tmp/g115plan/stack/compose.g115.yml
docker ps -a --format '{{.Names}}' | grep -E '^homunculus-(postgres|api|web)$' || echo "no stack containers"
```

Expected: both files; `no stack containers`. **If a container is listed, stop and ask** — it is another session's.

```bash
cd /c/tmp/g2a-o17
C="docker compose -p g2a -f deploy/local/docker-compose.yml -f /c/tmp/g115plan/stack/compose.g115.yml --env-file /c/tmp/g115plan/stack/local.env"
$C build api web 2>&1 | grep -E "Built|ERROR|precache"
$C up -d postgres api web 2>&1 | tail -3
```

Expected: `Image g2a-api Built`, `precache  20 entries …`, `Image g2a-web Built`; three containers started; `docker inspect -f '{{.State.Health.Status}}' homunculus-api` → `healthy`, then `curl -s -o /dev/null -w "http %{http_code}\n" http://127.0.0.1:18080/health` → `http 200`. Then Steps 7 and 8's two phases against `http://127.0.0.1:18080` with `HOMUNCULUS_TOKEN=$(grep '^TENANT_TOKEN=' /c/tmp/g115plan/stack/local.env | cut -d= -f2-)` and `$C restart api` between them; they print the same lines.

- [ ] **Step 10: By eye, in a browser — not run (X11).** Open `http://127.0.0.1:18080`, sign in as a synthetic nurse (seed as the G2-01 walk's Step 6 did: `docker exec -e TEST_USER_PASSWORD='G115-Sentetik-Parola-1' -e SEED_TENANT_SLUG=demo-hastanesi homunculus-api python scripts/seed_test_users.py`; `test.hemsire@homunculus.health`). Run the first phase again for a fresh latch (the beds keep their ids and their history, so its printed counts are then larger — only the latch matters here), then **Siqnallar**: under "Cavab gözləyir" the `G2A-2` row "Septic shock criteria met" with «KEÇDİ · TƏSDİQLƏNMƏYİB» (the pill writes upper case) and the time it passed, below the bed's firing alarms (X10). With the alarm sound turned on in Ayarlar: the critical pattern (10 pulses every 2.5 s) is gone, and the high one (3 pulses every 12 s) goes on for the bed's firing sepsis and antibiotic clock. The same badge on the bed card, the bed list, the bell and the patient screen (X10). «Gördüm» removes the row. The box "Bağlanan siqnallar" says the new sentence. Patient `G2A-3` → Vital qrafikləri → Nəbz: two ▲, the legend «siqnalın başladığı an». Dil: tr, ru, en — the badge's words in each.

- [ ] **Step 11: Tear it down.** `$C down -v` → the three containers and the `g2a` volumes removed; `docker ps -a --format '{{.Names}}' | grep -E '^homunculus-(postgres|api|web)$' || echo "no stack containers"` → `no stack containers`.

No commit: nothing in the repo changed.

---

## Task order and parallel work

| Task | Needs | May run beside (own worktree) | Files it shares with a later task |
|---|---|---|---|
| 0 worktree, junction, baseline | — | — | — |
| 1 the engine: the bucket is the evaluation; the antibiotic anchor (X1, X9, X12) — **done** (`39812b6`, `71cefee`, `ecef8ae`, `71b566c`, 7251540) | 0 | 5 | — |
| 2 the hook and the latch — **done** (`4e689a8`, `5ea2df0`) | 1 (a dropped kind to latch) | 5 | `ackstore.py`, `alert_lifecycle.py` and their tests (4) |
| 3 the readers: board, alarm quality — **done** (`83b4c46`, `4982a5e`) | 2 (`AckStore.resolved`) | 5 | — |
| 4 the writers, the replay, the escalation chain and the page (X13, X14) — **done** (`23fc805`, `d268b63`, `46a282d`, `6debbe7`, 8fbcff1) | 2, 3 (its tests read the board's `resolved_at`) | 5 | — |
| 5 the dashboard (X10) — **done** (`54e1ea5`, `a99d36a`) | 0 (it reads only the payload's shape: `resolved_at`) | 1–4 | — |
| 6 docs — **done** (`7fe980b`, `55e6a08`, `9240dc2`; the roadmap row's final state with this plan) | 1–5 (the range and the counts it quotes) | — | — |
| 7 gates, the acceptance (X11) — **done** at `9240dc2` | 1–6 | — | — |

**Why not the brief's order** (doors in Task 3, board and rehydrate in Task 4): X3. Readers before writers, and the doors with their replay in one commit, so that at no commit does a restart rebuild a different board from the live one; the door tests can then assert on the board.

**Waves, if run in parallel:** A = {1 → 2 → 3 → 4} beside B = {5}; then 6, 7. The plan was measured in the serial order 1 → 7; a parallel merge must re-run Task 7's gates on the merged head.

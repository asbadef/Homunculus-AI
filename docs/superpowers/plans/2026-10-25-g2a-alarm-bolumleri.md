# Group 2 · G2-A1 — an alert ends when its rule stops firing; a critical nobody acknowledged latches (O17) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An alert lives exactly as long as its rule fires. The engine's active alerts are the kinds the last evaluation produced; a kind it did not produce ends its episode on that reading — no quiet time, no hysteresis. A **critical** alert nobody acknowledged is the one exception: it stays on the board as «keçdi · təsdiqlənməyib» (tr «geçti · onaylanmadı»), silent and unescalated, until a clinician acknowledges it, which removes it. A kind that fires again is a new episode — a new first-seen, a new escalation clock, a new nurse notification, a new ▲ on the trend charts — live, after a restart, and in the alarm-quality report alike.

**Architecture:** The engine (`pipeline.py`) replaces each patient's bucket with every evaluation and drops the antibiotic clock's anchor when no recognition kind fires (X1). The API gains one lifecycle hook, `api/alert_lifecycle.py` `sync_alerts(engine, store, patient_id, now)`, run after every evaluation — at `/ingest`, at `/clinical` after each entry, and in `rehydrate` after each `ingest`/`chart` row: it latches an unacknowledged critical that stopped firing in `AckStore.resolved`, prunes the ended episodes' ack, first-seen stamp and escalation flag, and returns `Cleared` records that the doors audit as the new event `alert_cleared`; `/ack` on a latched alert removes it (`acknowledge_latched`). The board lists latched alerts after the firing ones with `resolved_at` and computes `risk` from the firing ones only; `alarm_quality` closes an episode at its end. The dashboard maps `resolved_at` to status `RESOLVED`, shows the badge on the alarms row, stops the sound and raises no new notification at resolve (`signals.js`), and keys and tags each notification by episode. Deploy order: web no later than api (O14).

**Tech Stack:** Python 3.12 (and a 3.14 check), FastAPI, pytest; React 18, Vite, Vitest + Testing Library (`render`, `screen`, `within`; no user-event).

**Spec (authoritative):** `docs/superpowers/specs/2026-10-25-g2a-alarm-bolumleri-design.md` (D1–D13, §3–§7; decided with the user 2026-10-25: (1) critical alerts latch until acknowledged, every other severity clears with its rule; (2) clearing is immediate). Where the code made the spec's letter unsafe, impossible or merely unspecified, this plan departs from it; every departure is in the table below with its reason and its test. **X1–X8 are the planner's, for the controller's review — none is approved yet.** X1 is the one that matters: the spec's letter would restart an overdue antibiotic's hour in the middle of septic shock.

**How the numbers in this plan were obtained.** Every task was implemented, in this order, in a scratch worktree from `c66a615` (branch `scratch/g2a-plan`) while the plan was written, and each red and each green was run there. Then the plan itself was replayed: a script applied this file's Edit and Write blocks onto `c66a615` in a second scratch worktree, task by task and step by step — the tests first, then the code — and ran every command of Tasks 0–7 as written, the commit blocks included (2026-10-25). Every red, green, count and line-end figure below is what that replay printed; the replay's tree is identical to the implementation's (`git diff` empty over all 37 files). Task 7's acceptance script was run against the engine's own dev server from the replayed tree (`homunculus.api.devserver`, its SQLite audit, a real stop and start in between) and printed the four answers the spec's §6 asks for; the Docker stack walk is not run here (another session's `homunculus-*` containers were up). Both scratch worktrees were removed afterwards. The code is kept beside the per-task files as `/c/tmp/homunculus-plans/g2a-o17/reference.patch` (`git diff c66a615 <replay head>`) — a cross-check, not the authority: build from the tasks.

---

## What the code says that the spec did not — departures (read before Task 1)

| # | Spec | Code at `c66a615` / what was found | This plan |
|---|---|---|---|
| X1 | D9: "When `"sepsis"` leaves the firing set, `Engine._recognized_at[pid]` is deleted"; §4: "`_recognized_at` reset when `"sepsis"` is absent … and was present before" | The anchor is set by **either** recognition kind: `_RECOGNITION_KINDS = {"sepsis", "septic_shock"}` (`pipeline.py:17`, `:64–67`). `sepsis` is a SOFA **rise** of ≥ 2 over the charted baseline (`rules/septic_shock.py:100–139`); `septic_shock` is a pressor + lactate > 2 + adequate fluid (`:59–75`) and does not need it. A baseline SOFA charted during shock takes `sepsis` away while `septic_shock` still fires. The letter deletes the anchor there, and the same evaluation re-anchors it at *now* (shock is a recognition kind): an `antibiotic_overdue` (critical) turns into "antibiotic_due — 60 min remaining" in the middle of septic shock. **Unsafe as written.** | The anchor is dropped only when **no** recognition kind fires (`setdefault` while one does, `pop` when none does). Task 1, `test_the_antibiotic_clock_keeps_its_anchor_while_septic_shock_fires_without_the_sepsis_criterion` — fails under the letter (checked by a mutant while planning: `1 failed, 9 passed`). D9's intent (a second episode is a second recognition) is kept: `test_when_sepsis_stops_its_antibiotic_clock_stops_and_a_later_episode_starts_its_own`. |
| X2 | D3: `AckStore.resolved`; D4: "the hook … computes the firing set, moves unacked criticals that dropped out into `resolved` …"; §4: "`prune(live_keys)` also prunes `resolved` keys that are firing again"; D7: "`sync_alerts(…, audit=False)`" | When the hook runs, the engine has already replaced its bucket (D1): which kinds dropped, and what a dropped alert said (the latch must show it), are gone from the engine. And `prune(live_keys)` with live = firing ∪ latched cannot tell a latched key that fires again from one that does not, nor keep a latched key's first-seen while dropping its escalation flag (D8). | `AckStore.firing` — what the hook last saw firing per (patient, kind) — is how it knows what dropped and with what text; `AckStore.prune(live_keys, firing_keys=None)` keeps acks/first-seen for live keys, escalation for firing keys only, and drops a latch whose kind fires again (the old one-argument call behaves as before). The hook never writes audit: it returns `Cleared` records, the doors audit them, the replay ignores them — D7's `audit=False` by construction. Tasks 2, 4. |
| X3 | §5 lists the tests by file (`test_notify.py`, `test_escalation*`); the brief's order is engine → hook → doors → board/rehydrate/alarm_quality → dashboard | `Notifier` and `escalate()` do not change: what changes is what the doors hand them. A re-fire's second notification and a latched alert that never escalates are reachable only through the doors. And the replay must agree with the doors at every commit, or a restart between two tasks rebuilds a different board. | **1 engine · 2 hook + store · 3 the readers (board payload, alarm-quality closes) · 4 the writers (doors) with the replay, in one commit · 5 dashboard · 6 docs · 7 gates.** Readers before writers (the board shows `resolved_at: null` until a door latches anything), and doors + replay together, so live and restart never disagree. The notifier test is in `test_alert_lifecycle.py` (dedup pruned with `live_keys`) and `test_api_ingest.py` (a second nurse notification through `/ingest`); the escalation tests are in `test_api_ack.py` (a latched alert never escalates; the next episode's clock is its own). `test_notify.py` and `test_escalation.py` are unchanged and still run (Task 2's neighbours). |
| X4 | D12: "`alarm_quality.build_episodes` closes an episode at its `alert_cleared` row" | A latched critical writes **two** `alert_cleared` rows: `resolved` when its rule stops (D6: "also for a critical entering the latch"), then `ack` and `acked_after_resolve` when a clinician acknowledges it (§6.2's order). Closed at the first, the `ack` that follows finds no open episode and is dropped (`alarm_quality.py:141–147`): an answered alarm counts as ignored. | An episode ends at its `alert_cleared` row unless that row is `resolved` for a `critical` the episode has no answer for — then it stays open for the acknowledgement, and ends at `acked_after_resolve`. `Episode` gains `resolved_at` and `ended_at`; the rates are unchanged (O11). Task 3, three tests; a mutant that closes at every row fails the latched one. |
| X5 | D12: the legend "▲ ilk tespit" becomes "▲ uyarının başladığı an" ×4 | The legend's text is `patient.trendsLegendAlarm` = tr "alarmın ilk tespiti", az "siqnalın ilk aşkarlanması" (`strings/patient.js:91`, `:205`, `:319`, `:433`); the ▲ itself is labelled `trendsMarkerAlarm` = tr "alarm", az "siqnal" in the same legend, and the whole trends block says "alarm"/"siqnal". "uyarı" would put a second word for the same thing beside the mark. | tr «alarmın başladığı an», az «siqnalın başladığı an», ru «момент начала тревоги», en «when an alarm began» — the spec's meaning in the screen's own words. `TrendModal.test.jsx` pins the az text twice (Task 5). |
| X6 | D11: "`AlarmSignals.jsx` (`:32`, `:245–247`): sound stops at resolve, tag per episode"; "the notification tag becomes `pid::kind::firstSeenAt`"; §4 "four strings ×4 languages (`alarmResolvedUnacked`, legend rewording)" | Which waiting alarm sounds and which raises a notification is decided in **one** place, `signals/signals.js` ("the ONE copy of this mapping", `:1–3`), not in `AlarmSignals.jsx`. The alarm's `id` (`pid::kind`, `liveAdapters.js:180`) is also the React key, the busy-button state and the `/ack` subject. A RESOLVED alarm still waits (`needsAnswer`), so its open notification would be closed if it left `notifyFor`'s items. | `signals.js` `rings()`: `soundFor` and a new `notifyFor(...).ringing` skip RESOLVED; `AlarmSignals.jsx` raises only for `ringing`, keeps an already-raised notification while the alarm waits, and keys and tags by the adapter's new **`episode`** field (`<patient>::<kind>::<first_seen_at>`); `id` is unchanged. The four strings ×4 are `alarms.resolvedUnacked` (the badge, the spec's words), `alarms.resolvedAt` (the screen reader's label for the time it passed), one sentence added to `alarms.closedGone` (a critical stays until acknowledged — the box said "a closed alarm leaves the board"), and `patient.trendsLegendAlarm` (X5). `strings.test.js` is not touched: its loops hold the new keys (no az = tr, Cyrillic ru, the same placeholders). Task 5. |
| X7 | §4's file list | Comments and tests the change makes false, and fixtures the board's new shape needs, outside §4's list: `api/trends.py:39–48` and `tests/test_trends.py:239–245` ("Today the engine never drops an alert kind …"); `TrendLegend.jsx:100–101` ("never clear a kind today (O17)"); `TrendModal.test.jsx:322–323`, `:591`, `:599` (the old legend text); `data/board.testutil.js` (`alarm()` has no `resolved_at`; `riskOf` would count a latched alarm as risk, which the API no longer does); `boardStore.js` `needsAnswer` (already counts RESOLVED: an acknowledgement removes a latch, so it is never acked — a comment and a test, no code); the guide's sound paragraph (§2, "Alarm onaylanınca susar", the notification tag); the G2-01 plan's open-items row O17 (`:12979`), besides the two lines §4 names. | Each changed in the task whose code makes it false: Task 1 (trends comments), Task 5 (dashboard), Task 6 (docs). |
| X8 | D4: "`/clinical` (`:585–616`) … call the hook and audit its result" | `/clinical` ingests several entries in one request (`app.py:589–595`) and stamps first-seen afterwards for **every** live key of **every** patient (`:607–611`); the replay runs once per `chart` row. A latched key must not be stamped again (it would open an episode after its end). | The hook runs after **each** entry, as the replay runs it after each `chart` row; first-seen is stamped after the loop, as before, for **this patient's firing** alerts only; `/clinical` now also prunes the notifier's dedup, as `/ingest` does. Cost: a critical that fires at one entry and stops at a later entry of the **same** request — never on any board — latches with no first-seen (O6). Task 4. |

Departures found while implementing go below X8 (X9 …), each with its file and line.

## Open items

Numbered for this slice (G2-A1 O1 …); the G2-01 plan's O1–O26 and the NBP plan's O27–O37 are other items.

| # | Item | Owner | When |
|---|---|---|---|
| O1 | **No cool-down for a flapping value** (D13, the user's choice): HR 140 → 80 → 140 is two episodes; an `immediate` kind (NEWS2 ≥ 7, septic shock, an overdue antibiotic) tells the nurse again on each return. NEWS2 by a single red parameter is `soon` and notifies nobody. | User (accepted, D13) | Revisit after the pilot's first week |
| O2 | No alert-level SSE `cleared` frame (D13; Lane B asked): the whole-board replace already drops a cleared alert (`boardStore.js:58–64`). | Lane B | When the RRT page needs it |
| O3 | **Rules run only on ingest** (D13): an alert whose rule would stop purely by time passing clears on the next observation; `antibiotic_due` becomes `antibiotic_overdue` only on the next reading. | — | — |
| O4 | **An older reading is evaluated at its own time** (`app.py:691`, `rehydrate.py:49`: `now=obs.timestamp`). A delayed or out-of-order delivery evaluates the time-dependent rules (the antibiotic clock, NEWS2 staleness) at that older instant, and with D1 its result replaces the bucket: an `antibiotic_overdue` can clear (and latch, if unanswered) on a late reading and fire again on the next. Pre-existing; clearing makes it visible. Whether the bridge delivers out of order on the pilot ward is measured nowhere. | Engine (Lane A, next slice) | Before > 1 ward |
| O5 | **A re-fire while latched continues its episode** (no `alert_cleared`, no new first-seen, no new nurse notification — the spec's §4). Its escalation flag was dropped at the latch (D8), so if its first sight is past the threshold it escalates again at the next cycle: a second doctor notification for the same, still unanswered, episode. | User (to know) | — |
| O6 | A critical that fires at one entry of a `/clinical` request and stops at a later entry of the same request — never on any board — latches with `first_seen` null; the row then shows no age ("Mühərrik ilk görülmə vaxtını göndərməyib"). Needs an entry order like "lactate 3.4, …, lactate 1.5" in one form (X8). | — | — |
| O7 | **Charting the antibiotic ends `antibiotic_overdue` (critical):** if nobody had acknowledged it, it latches, and the nurse who charted the dose must also press «Gördüm». D2 as decided; the user may want charted resolution to count as the answer. | User | At the walk |
| O8 | `GET /alerts/{patient_id}` (`app.py:908–915`) lists the engine's firing alerts only; the latch travels on the board (`/patients`, `/stream`). No screen of this build reads that route. | — | — |
| O9 | Only the alarms screen shows «keçdi · təsdiqlənməyib»: the bed card and the patient screen list a latched alert as an open alarm without the badge (D11 named the alarms row); the card's risk pill is the firing alerts' (D10). | User (to look) | At the walk |
| O10 | After a restart a latched alert's `resolved_at` is its row's write time (`rehydrate._written_at`), microseconds before the live value — the hook runs just after the door writes the row. | — | — |
| O11 | `alarm_quality`: an episode that resolved by itself before anyone answered still counts as **unanswered** once settled (pending before). Whether self-resolved episodes should be reported apart is a reporting decision; `Episode.resolved_at`/`ended_at` now make it possible. | User / medical director | — |
| O12 | The az, ru and en texts (`alarms.resolvedUnacked`, `alarms.resolvedAt`, `closedGone`'s new sentence, `patient.trendsLegendAlarm`) are the planner's and await a native reading, as every text of these namespaces (`strings/alarms.js:11`). | User | Before deploy |
| O13 | The Postgres-backed tests (the 650 skipped) were not run: no touched test file reads the test database, no SQL and no migration changes (`alert_cleared` is a new value of a free-text column; Task 7 Step 2 shows the evidence). Run them before the deploy if the controller wants (the G2-01 plan's Task 15 Step 6). | Controller | Before deploy |
| O14 | **Deploy web no later than api.** An old web on a new api maps a latched critical (`resolved_at` set, `acknowledged: false`) to FIRED and **sounds it**; a new web on an old api never sees `resolved_at` and shows today's board. The VM blocks are a later, separate step (spec §6: "on the VM, later, with the user"). | Controller | At deploy |

---

## Baseline at `c66a615` (measured 2026-10-25)

- **Engine, no database** (`--ignore=tests/test_infinity_vm_pilot.py`, `PYTHONPATH=src`): **2143 passed, 650 skipped, 3 warnings** in ≈ 1 min 40 s (the same as the NBP slice's base `14c208d`: none of its tests is on this base).
- **Dashboard:** `npx vitest run` → **89 files / 2392 tests**, all passing. `npx vite build` clean, `precache  20 entries`.
- **Postgres:** not needed (O13; Task 7 Step 2).
- **Python 3.14:** `/c/tmp/g115-py314/Scripts/python.exe` (3.14.5) runs this worktree's tests with `PYTHONPATH=src`.

## Counts after each task (in plan order)

| After | Engine, no DB (passed / skipped) | Dashboard (files / tests) | This task's test files |
|---|---|---|---|
| base | 2143 / 650 | 89 / 2392 | — |
| 1 | 2147 / 650 | — | `test_pipeline.py` 6 → **10**; `test_trends.py` 32 → **32** (a docstring) |
| 2 | 2158 / 650 | — | `test_alert_lifecycle.py` new, **10**; `test_ackstore.py` 3 → **4** |
| 3 | 2163 / 650 | — | `test_board.py` 4 → **6**; `test_alarm_quality.py` 18 → **21** |
| 4 | 2174 / 650 | — | `test_api_ack.py` 6 → **10**, `test_api_ingest.py` 7 → **9**, `test_api_clinical.py` 20 → **22**, `test_rehydrate.py` 6 → **9** |
| 5 | — | 89 / 2402 | `liveAdapters.test.js` 50 → **52**, `boardStore.test.js` 40 → **41**, `signals.test.js` 10 → **12**, `AlarmSignals.test.jsx` 25 → **28**, `AlarmsScreen.test.jsx` 24 → **26**, `TrendModal.test.jsx` 58 → **58** (texts), `strings.test.js` 6 → **6** (it loops) |
| 6 | docs only | — | — |
| 7 | 2174 / 650 (gate) | 89 / 2402 (gate), build 20 | Python 3.14, the ten engine files: **133** |

Engine arithmetic: 4 + 11 + 5 + 11 = **31** over the base. Dashboard: 2 + 1 + 2 + 3 + 2 = **10** tests, no new file.

---

## Ground rules for every task

- **Your worktree.** `/c/tmp/g2a-o17`, branch `feat/g2a-o17` (from `origin/main` `03daac4` + the spec `c66a615`; this plan is its next commit). If the controller gives you a parallel worktree branched from this one, every path below reads that worktree instead. **Never touch `/c/Users/User/Desktop/Project/Homunculus AI`** (the user's main checkout) or another `/c/tmp` worktree. Never `git push`, never deploy, never change anything on a VM. **Never run `git stash`** — the stash is shared with every other worktree and session. If you remove a worktree, unlink its `node_modules` junction first (`cmd //c "rmdir C:\\tmp\\g2a-o17\\dashboard\\node_modules"`), then `git worktree remove --force`: a recursive delete that follows the junction empties the shared install. Never reinstall `node_modules`.
- **Write and Edit tools only on repo files — never `sed`, `python`, `node` or a shell heredoc** — with one exception, given as a command in Task 2: the two new files, written with the Write tool, are converted to CRLF by a one-line Python call that touches only them. The tree checks out **CRLF** (`core.autocrlf=true`); every block here is LF. The Edit tool matches either way. Every Edit's old text is unique in its file at that moment (the replay asserted it). Each task ends by counting the line ends of the files it touched — `CR` must equal `LF`, and both must be the numbers the task gives (a mismatch means a line end was rewritten or an edit landed twice). After editing `strings/*.js` run `npx vitest run src/live/i18n/strings.test.js`: it fails if the Cyrillic or the `ə` was mangled.
- **TDD.** Write the test, run it and **see it red for the reason the task names**, then the code, then green. Put the red in the commit body.
- **Stage explicit paths only** (the task's `git add` line). Before every commit run `git status --short` and `git diff --cached --stat`; if a staged path is not one the task lists, stop and ask.
- **Commit after every task that changes the repo.** Messages are `type(scope): what, in words` and end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```
  (the trailer the controller set for this session; if the controller records a newer one by the time you commit, use that).
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
| `src/homunculus/pipeline.py` | the bucket is the evaluation (D1); the anchor drops when no recognition kind fires (D9, X1) | 1 |
| `tests/test_pipeline.py` | four tests: leaves on the first normal reading, fires again, sepsis stops and a later episode has its own hour, the anchor kept through shock (X1) | 1 |
| `src/homunculus/api/trends.py`, `tests/test_trends.py` | the marker limit's comment and its test's docstring: a ▲ is an episode's start (X7) | 1 |
| `src/homunculus/api/ackstore.py` | `resolved`, `firing`; `prune(live_keys, firing_keys=None)` (X2) | 2 |
| `tests/test_ackstore.py` | prune with the firing keys | 2 |
| `src/homunculus/api/board.py` | `resolved_at`; `_latched_alerts` after the firing ones; risk from firing (D10) | 3 |
| `src/homunculus/api/alarm_quality.py` | `alert_cleared` closes; a latch stays open for its ack (D12, X4); `Episode.resolved_at`, `ended_at` | 3 |
| `tests/test_board.py`, `tests/test_alarm_quality.py` | two and three tests | 3 |
| `src/homunculus/api/app.py` | `_audit_cleared`; `/clinical` hook per entry, stamps for the patient's firing alerts, prunes the notifier (X8); `/ingest` hook before the stamps; `/ack` removes a latch; `live_keys` = firing ∪ latched (D4, D6, D8) | 4 |
| `src/homunculus/api/rehydrate.py` | every `ingest`/`chart` row through the hook; an `ack` row removes a latch (D7) | 4 |
| `src/homunculus/api/audit.py` | `alert_cleared` named in `event_type`'s comment (D6) | 4 |
| `tests/test_api_ack.py`, `tests/test_api_ingest.py`, `tests/test_api_clinical.py`, `tests/test_rehydrate.py` | four, two, two and three tests (X3) | 4 |

**Modify — dashboard** (`dashboard/src/`)

| File | Change | Task |
|---|---|---|
| `liveAdapters.js` | status `RESOLVED`, `resolvedAtMs`, `episode` (D11, X6) | 5 |
| `live/signals/signals.js` | `rings()`: the sound and new notifications skip RESOLVED; `notifyFor().ringing` (X6) | 5 |
| `live/signals/AlarmSignals.jsx` | notifications keyed and tagged by episode, raised for `ringing` only | 5 |
| `live/screens/alarms/AlarmsScreen.jsx` | the badge and the time it passed; the acknowledge button stays | 5 |
| `live/data/boardStore.js` | a comment at `needsAnswer` (X7) | 5 |
| `live/i18n/strings/alarms.js` | `resolvedUnacked`, `resolvedAt`, `closedGone` + one sentence, ×4 | 5 |
| `live/i18n/strings/patient.js` | `trendsLegendAlarm` ×4 (X5) | 5 |
| `live/screens/patient/trends/TrendLegend.jsx` | its comment (X7) | 5 |
| `liveAdapters.test.js`, `live/data/boardStore.test.js`, `live/signals/signals.test.js`, `live/signals/AlarmSignals.test.jsx`, `live/screens/alarms/AlarmsScreen.test.jsx`, `live/screens/patient/trends/TrendModal.test.jsx`, `live/data/board.testutil.js` | ten tests; one `toEqual` and one tag that the new shape changes; the legend's pinned text; the fixture's `resolved_at` and `riskOf` | 5 |

**Modify — docs** (Task 6): `docs/homunculus-rehber-TR.md` (four passages), `docs/superpowers/plans/2026-10-19-g2-vital-egrileri.md` (three O17 notes), `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` (the row G2-A1). `Homunculus/wiki` is untouched (no clinical claim changes).

**Outside the repo:** `/c/tmp/homunculus-plans/g2a-o17/acceptance.py` (Task 7), `reference.patch`.

**How an edit reads in this plan:** a bold **Edit** with the file's path and "replace:", a fenced block with the exact old text, "with:", and a fenced block with the new text. Use the Edit tool with those two texts, in the order given. A bold **Write** gives a new file's whole text.

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

### Task 1: The engine — an alert lasts exactly as long as its rule fires

Spec D1 and D9, with X1. The per-patient bucket (`pipeline.py:91–96`) becomes exactly the kinds this evaluation produced; a kind it did not produce is gone at once. The antibiotic clock's anchor is dropped when no recognition kind fires, and kept while either does.

The rules, each held by a test below:
- a kind the rules did not produce for this reading leaves `active_alerts` on that reading (HR 140 raises a MODERATE `news2` — one red parameter —; HR 80 clears it);
- a kind that fires again is back, and another patient's bucket is not touched by this one's evaluation;
- when suspected infection is charted 0, `sepsis` and the antibiotic clock stop, the anchor is gone, and a later recognition starts its own hour ("60 min remaining", not the old overdue clock);
- while `septic_shock` fires, the anchor stays even if `sepsis` stops (a charted baseline SOFA of 4 against a SOFA of 4): `antibiotic_overdue` stays overdue (X1).

The spec's §5 asks that the presence-after-replay assertions be re-read (`test_scenarios_e2e.py:25,35,43,55`, `test_scenarios_hl7_parity.py:36,57`, `test_pipeline_model.py:31,41`, `test_api_patient_profile.py:159`, `test_rehydrate.py:23–27`, `test_alarm_quality.py:175–181`). Re-read: **every one still holds, unchanged** — in each the kind it asserts fires at the scenario's last reading (septic shock at minute 60 of `septic_shock.yaml`, under-resuscitation at the last reading of its scenario, sepsis after the last charted organ value), and the `not in` assertions can only get truer. Step 6's neighbours run them all (`test_pipeline_model.py` skips without `homunculus_ml`).

Two comments the change makes false are corrected here (X7): the trend marker limit's (`api/trends.py:39–48`) and its test's docstring (`tests/test_trends.py:239–245`) — since this task `/ingest`'s existing `store.prune` really drops a cleared kind's stamp, so a ▲ is an episode's start.

**Files:**
- Modify: `homunculus-engine/tests/test_pipeline.py` (appended after the last test)
- Modify: `homunculus-engine/src/homunculus/pipeline.py` (the anchor, the bucket)
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


def test_when_sepsis_stops_its_antibiotic_clock_stops_and_a_later_episode_starts_its_own():
    eng = Engine()
    _sepsis_charted(eng, 1.0, minute=0)
    assert _kinds(eng) == {"sepsis", "antibiotic_due"}
    assert eng.recognized_at("bed-3") == T0
    _sepsis_charted(eng, 0.0, minute=20)          # the physician charts: no infection after all
    assert _kinds(eng) == set(), "no recognition kind fires: sepsis and its antibiotic clock are gone"
    assert eng.recognized_at("bed-3") is None
    _sepsis_charted(eng, 1.0, minute=90)          # a second episode, seventy minutes later
    assert eng.recognized_at("bed-3") == T0 + timedelta(minutes=90)
    due = next(a for a in eng.active_alerts("bed-3") if a.kind == "antibiotic_due")
    assert due.summary == "Antibiotic window: 60 min remaining", \
        "the second recognition has its own hour, not the first episode's overdue clock"


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
FAILED tests/test_pipeline.py::test_when_sepsis_stops_its_antibiotic_clock_stops_and_a_later_episode_starts_its_own
FAILED tests/test_pipeline.py::test_the_antibiotic_clock_keeps_its_anchor_while_septic_shock_fires_without_the_sepsis_criterion
3 failed, 7 passed in …
```
The reasons (`--tb=short`): the first fails on `assert [Alert(… kind='news2' …)] == []` — the bucket kept it; the second on `assert {'antibiotic_due', 'sepsis'} == set()`; the third on `assert 'sepsis' not in {…}` — the bucket kept `sepsis`. Run against the spec's literal D9 instead of the old code, the third fails on `antibiotic_overdue` (X1: `1 failed, 9 passed`). `test_an_alert_that_fires_again_is_back_and_another_patient_is_untouched` passes already: the old bucket never let a kind go; it guards the return and the other patient.

- [ ] **Step 3: The anchor — dropped when no recognition kind fires**

**Edit** `homunculus-engine/src/homunculus/pipeline.py` — replace:
```python
        # Anchor the antibiotic clock the first time sepsis/shock is recognized.
        if obs.patient_id not in self._recognized_at:
            if any(f.kind in _RECOGNITION_KINDS for f in findings):
                self._recognized_at[obs.patient_id] = now
```
with:
```python
        # Anchor the antibiotic clock the first time sepsis/shock is recognized in an episode, and
        # drop the anchor once no recognition kind fires (G2-A1, D9): a later episode is a second
        # recognition with its own hour. Both kinds count, as for the anchor (X1) — a baseline SOFA
        # charted during shock can take `sepsis` away while `septic_shock` still holds, and
        # restarting an overdue antibiotic's hour then would hide that it is overdue.
        if any(f.kind in _RECOGNITION_KINDS for f in findings):
            self._recognized_at.setdefault(obs.patient_id, now)
        else:
            self._recognized_at.pop(obs.patient_id, None)
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

Expected: `10 passed in …`; then `156 passed, 1 skipped, 3 warnings in …` (`test_pipeline_model.py` skips without `homunculus_ml`). The whole no-DB suite after this task: `2147 passed, 650 skipped`.

- [ ] **Step 7: Line ends**

```bash
cd /c/tmp/g2a-o17
for f in homunculus-engine/src/homunculus/pipeline.py homunculus-engine/tests/test_pipeline.py homunculus-engine/src/homunculus/api/trends.py homunculus-engine/tests/test_trends.py; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected: `pipeline.py CR=112 LF=112`, `test_pipeline.py CR=187 LF=187`, `trends.py CR=196 LF=196`, `test_trends.py CR=376 LF=376`.

- [ ] **Step 8: Commit**

```bash
cd /c/tmp/g2a-o17
git add homunculus-engine/src/homunculus/pipeline.py homunculus-engine/tests/test_pipeline.py homunculus-engine/src/homunculus/api/trends.py homunculus-engine/tests/test_trends.py
git status --short && git diff --cached --stat
git commit -q -F - <<'MSG'
feat(engine): an alert lasts exactly as long as its rule fires (G2-A1, O17)

The per-patient bucket is rebuilt from every evaluation: active_alerts is
exactly the kinds the rules produced for the last reading, and a kind they
did not produce is gone at once — no quiet time, no hysteresis (D1). The
antibiotic clock's anchor is dropped when no recognition kind (sepsis or
septic_shock) fires, so a later episode is a second recognition with its own
hour (D9); both kinds count, because a baseline SOFA charted during shock can
take sepsis away while septic_shock holds, and restarting an overdue
antibiotic's hour then would hide that it is overdue (X1). The trend
markers' comments now say a ▲ is the start of an episode.

red: 3 failed, 7 passed — the bucket kept news2 and sepsis (tests/test_pipeline.py)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
git log --oneline -1
```

---

### Task 2: The lifecycle hook and the latch — `api/alert_lifecycle.py`, `AckStore.resolved`

Spec D2–D5 and D8, with X2. One function runs after every evaluation and brings the tenant's `AckStore` in line with what fires now; no door calls it yet (Task 4).

The rules, each held by a test below:
- a **critical** whose rule stopped while nobody had acknowledged it latches: `store.resolved[(pid, kind)] = {"alert": asdict(alert), "resolved_at": now}`; it stays a live key and keeps its first-seen;
- HIGH, MODERATE and LOW never latch; their ack, first-seen and escalation flag are pruned (a re-fire is a new episode, D5);
- an **acknowledged** critical leaves with its rule;
- a latched alert loses its escalation flag (only a firing alert escalates, D8); `acknowledge_latched` removes it, pops its first-seen and returns its `Cleared` (`acked_after_resolve`); it returns None for a key that is not latched;
- a latched kind that fires again replaces its latch, with no `Cleared` row, and keeps its first-seen — its episode goes on (§4);
- another patient's state is untouched;
- the notifier pruned with `live_keys` tells a nurse again only for a new episode (a latched key stays live, so a re-fire while latched notifies nobody);
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


def test_the_hook_leaves_another_patient_alone():
    engine, store = Engine(), AckStore()
    _evaluate(engine, store, SignalCode.HEART_RATE, 140, minute=0, patient="bed-4")
    _stamp(engine, store, patient="bed-4")
    store.acknowledge("bed-4", "news2", "ayse", WALL)
    _evaluate(engine, store, SignalCode.HEART_RATE, 140, minute=1)
    _evaluate(engine, store, SignalCode.HEART_RATE, 80, minute=2)
    assert ("bed-4", "news2") in store.acks and ("bed-4", "news2") in store.first_seen


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
    store.prune(live_keys(engine, store), firing_keys(engine))
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

Expected: `14 passed in …`; then `67 passed, 3 warnings in …`. The whole no-DB suite after this task: `2158 passed, 650 skipped`.

- [ ] **Step 7: Line ends**

```bash
cd /c/tmp/g2a-o17
for f in homunculus-engine/src/homunculus/api/ackstore.py homunculus-engine/src/homunculus/api/alert_lifecycle.py homunculus-engine/tests/test_alert_lifecycle.py homunculus-engine/tests/test_ackstore.py; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected: `ackstore.py CR=56 LF=56`, `alert_lifecycle.py CR=94 LF=94`, `test_alert_lifecycle.py CR=160 LF=160`, `test_ackstore.py CR=43 LF=43`.

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
store keeps what the hook last saw firing (AckStore.firing, X2), and
prune() takes the firing keys: only a firing alert stays escalated.
No door calls the hook yet (Task 3).

red: ModuleNotFoundError: homunculus.api.alert_lifecycle (tests/test_alert_lifecycle.py);
1 failed, 3 passed — AttributeError: 'AckStore' object has no attribute 'resolved' (tests/test_ackstore.py)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
git log --oneline -1
```

---

### Task 3: The readers — the board lists a latched critical; the alarm report closes episodes

Spec D10 and D12, with X4. Readers before writers (X3): nothing latches yet — the doors come in Task 4 — so on a live board `resolved_at` is `null` everywhere after this task.

The rules, each held by a test below:
- every alert dict on the board gains `resolved_at` (`null` while it fires);
- a latched critical is listed **after** the firing alerts, oldest resolution first, `acknowledged: false`, `escalated: false`, with its episode's `first_seen_at`, and with the text it last fired with;
- `risk` is the firing alerts' only: a bed whose only critical is latched is not "critical";
- a kind both firing and latched (which the hook never leaves, but the board does not rely on it) is listed once, as firing;
- `build_episodes` ends an episode at its `alert_cleared` row; an `alert` row after the end is no repeat of it; a critical that latched (no answer at `resolved`) stays open for the `ack` that removes it and counts as answered; an answered critical ends at `resolved`, and an `escalation` after that finds no episode (X4).

**Files:**
- Modify: `homunculus-engine/tests/test_board.py` (an import, a line in the merge test, two tests appended), `homunculus-engine/tests/test_alarm_quality.py` (three tests after `test_an_alert_that_clears_and_returns_is_two_episodes`)
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


def _latched():
    """bed-3 in septic shock, first seen at T0; two minutes later the lactate is back under 2. The
    shock latches — nobody acknowledged it — while sepsis and the antibiotic clock still fire."""
    from homunculus.api.alert_lifecycle import sync_alerts
    eng, store = Engine(), AckStore()
    for code, value in _SHOCK:
        eng.ingest(Observation("bed-3", code, value, "u", T0, "mon"), now=T0)
        sync_alerts(eng, store, "bed-3", T0)
    for a in eng.active_alerts("bed-3"):
        store.stamp_first_seen("bed-3", a.kind, T0)
    eng.ingest(Observation("bed-3", SignalCode.LACTATE, 1.5, "u", T0, "lab"), now=T0)
    sync_alerts(eng, store, "bed-3", T0 + timedelta(minutes=2))
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
FAILED tests/test_alarm_quality.py::TestTheUnitIsTheEpisode::test_two_episodes_of_one_kind_each_end_at_their_alert_cleared_row
FAILED tests/test_alarm_quality.py::TestTheUnitIsTheEpisode::test_a_latched_critical_stays_open_until_the_acknowledgement_that_removes_it
FAILED tests/test_alarm_quality.py::TestTheUnitIsTheEpisode::test_an_answered_critical_ends_when_its_rule_stops
6 failed, 21 passed, 3 warnings in …
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
            if episode.resolved_at is None:
                episode.resolved_at = when
            latched = (rec.payload.get("reason") == "resolved"
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

Expected: `27 passed, 3 warnings in …`; then `185 passed, 10 skipped, 3 warnings in …`. The whole no-DB suite after this task: `2163 passed, 650 skipped`.

- [ ] **Step 6: Line ends**

```bash
cd /c/tmp/g2a-o17
for f in homunculus-engine/src/homunculus/api/board.py homunculus-engine/src/homunculus/api/alarm_quality.py homunculus-engine/tests/test_board.py homunculus-engine/tests/test_alarm_quality.py; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected: `board.py CR=300 LF=300`, `alarm_quality.py CR=241 LF=241`, `test_board.py CR=104 LF=104`, `test_alarm_quality.py CR=247 LF=247`.

- [ ] **Step 7: Commit**

```bash
cd /c/tmp/g2a-o17
git add homunculus-engine/src/homunculus/api/board.py homunculus-engine/src/homunculus/api/alarm_quality.py homunculus-engine/tests/test_board.py homunculus-engine/tests/test_alarm_quality.py
git status --short && git diff --cached --stat
git commit -q -F - <<'MSG'
feat(api): the board lists a latched critical, and the alarm report closes episodes (G2-A1)

Each alert on the board carries resolved_at (null while it fires). A critical
whose rule stopped while nobody had acknowledged it (AckStore.resolved) is
listed after the firing alerts, unacknowledged and not escalated, oldest
resolution first; the card's risk is the firing alerts' only — the latch is a
to-do, not a risk (D10). alarm_quality.build_episodes ends an episode at its
alert_cleared row, except a critical nobody had answered, which stays open for
the acknowledgement that removes it so that answer is counted (D12, X4);
Episode gains resolved_at and ended_at. Nothing writes alert_cleared or a
latch yet: the doors come with the replay in Task 4.

red: 6 failed, 21 passed — KeyError: 'resolved_at'; AttributeError: 'Episode' object has no attribute 'resolved_at' / 'ended_at'

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
git log --oneline -1
```

---

### Task 4: The writers and the replay — both doors end an episode with its rule; a restart rebuilds it

Spec D4–D8, with X2, X3 and X8. `/ingest` and `/clinical` run the hook after every evaluation and audit what it cleared; `/ack` removes a latch; `rehydrate` replays every `ingest` and `chart` row through the same hook — in one commit, so that live and restart never disagree.

The rules, each held by a test below (`START` is `septic_shock.yaml`'s 10:00; the shock criterion holds from 11:00):
- a critical that resolves unacknowledged (lactate back to 1.5) stays on the board with `resolved_at` and `acknowledged: false`; `/ack` → 200 and removes it; the trail for that kind reads `first_seen`, `alert_cleared (resolved)`, `ack`, `alert_cleared (acked_after_resolve)` — spec §6.2's order;
- an alert that ended and did not latch (`sepsis` after "no infection") is 404 to acknowledge, and the unacknowledged shock beside it latched;
- an acknowledged critical leaves with its rule (`first_seen`, `ack`, `alert_cleared (resolved)`), and is then 404;
- a latched alert never escalates (its flag drops at the latch, and a cycle past the threshold does not raise it); after its ack, its next episode's clock starts at its own first sight (not at 4 min, at 5);
- `/ingest`: a moderate alert leaves on the first normal reading, its `alert_cleared` naming the first-seen instant; a kind that returns after it ended is a new episode — trail `first_seen`, `notification`, `alert_cleared`, `first_seen`, `notification` — and the old acknowledgement is not inherited;
- `/clinical`: charting the antibiotic ends `antibiotic_due` (`alert_cleared`, resolved, high); a critical that charting ends ("no infection") latches, the HIGH `sepsis` does not, and later charting does not stamp the latched kind again (X8);
- replay: a critical that resolved unacknowledged is latched again, `resolved_at` = its row's time (O10); an `ack` row for a latched alert removes it and leaves no acknowledgement behind; fire, latch, ack, fire, ack, leave, fire, latch, and a NEWS2 that fires, ends and fires again — the restart's board equals the live one alert for alert, and the latch is episode 3's (its own first-seen, no inherited answer).

**Files:**
- Modify: `homunculus-engine/tests/test_api_ack.py`, `homunculus-engine/tests/test_api_ingest.py`, `homunculus-engine/tests/test_api_clinical.py`, `homunculus-engine/tests/test_rehydrate.py` (appended at their ends)
- Modify: `homunculus-engine/src/homunculus/api/app.py` (the import, `_live_keys` → `_audit_cleared`, the escalation cycle's comment, `/clinical`, `/ingest`, `/ack`), `homunculus-engine/src/homunculus/api/rehydrate.py` (the docstring, the loop, `_replay_ingest`, `_written_at`, `_replay_ack`), `homunculus-engine/src/homunculus/api/audit.py` (a comment)

- [ ] **Step 1: Write the failing tests**

**Edit** `homunculus-engine/tests/test_api_ack.py` — replace:
```python
    client.post("/ack", json={"patient_id": "bed-3", "kind": "septic_shock", "role": "doctor"}, headers=_hdr("tok"))
    assert key not in store.escalated
```
with:
```python
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
async def test_a_latched_alert_never_escalates_and_its_next_episode_has_its_own_clock():
    app = create_app({"tok": "HOSP1"}, escalate_after=timedelta(minutes=5), run_escalation_loop=False)
    client = TestClient(app)
    _drive_shock(client)
    store = app.state.ack_stores["HOSP1"]
    store.first_seen[SHOCK] = datetime(2026, 7, 19, 10, 0, tzinfo=timezone.utc)   # long unanswered
    await app.state.escalation_cycle(datetime(2026, 7, 19, 10, 6, tzinfo=timezone.utc))
    assert SHOCK in store.escalated
    _reading(client, "lactate", 1.5, minute=61)                     # latched
    assert SHOCK not in store.escalated
    await app.state.escalation_cycle(datetime(2026, 7, 19, 10, 9, tzinfo=timezone.utc))
    assert SHOCK not in store.escalated, "a latched alert is a to-do, not an unanswered active finding"
    assert _on_board(client)["escalated"] is False
    _ack(client)                                                    # removes the latch
    _reading(client, "lactate", 3.4, minute=62)                     # a new episode
    fresh = store.first_seen[SHOCK]
    assert fresh != datetime(2026, 7, 19, 10, 0, tzinfo=timezone.utc)
    await app.state.escalation_cycle(fresh + timedelta(minutes=4))
    assert SHOCK not in store.escalated, "the new episode's clock started at its own first sight"
    await app.state.escalation_cycle(fresh + timedelta(minutes=5))
    assert SHOCK in store.escalated
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
FAILED tests/test_api_ingest.py::test_a_moderate_alert_leaves_the_board_on_the_first_normal_reading
FAILED tests/test_api_ingest.py::test_a_kind_that_returns_after_it_ended_is_a_new_episode_and_a_nurse_is_told_again
FAILED tests/test_api_clinical.py::TestChartingEndsAnAlert::test_charting_the_antibiotic_ends_the_clock_and_its_episode
FAILED tests/test_api_clinical.py::TestChartingEndsAnAlert::test_a_critical_that_charting_ends_latches_until_it_is_acknowledged
FAILED tests/test_rehydrate.py::test_a_critical_that_resolved_unacknowledged_is_latched_again_by_the_replay
FAILED tests/test_rehydrate.py::test_an_ack_row_for_a_latched_alert_removes_it_on_replay_and_is_no_acknowledgement
FAILED tests/test_rehydrate.py::test_a_restart_rebuilds_the_board_the_ward_had_episode_by_episode
11 failed, 39 passed, 3 warnings in …
```
The reasons: the latched shock vanished (`a critical nobody saw must not vanish (D2)`); no `alert_cleared` rows (`not enough values to unpack`, the trails without them); the replay did not latch (`assert set() == {('bed-3', 'septic_shock')}`) and left the old episode's stamp; acknowledging a latch is 404 (`assert 404 == 200`).

- [ ] **Step 3: The doors** — seven Edits in `app.py`, in this order.

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
        now = datetime.now(timezone.utc)
        for item in charted:
            obs = item.observation
            alerts = engine.ingest(obs, now=obs.timestamp)
            audit.append(AuditEvent(hospital, "chart", obs.patient_id, obs.code.value,
                                    {"value": obs.value, "unit": obs.unit,
                                     "obs_ts": obs.timestamp.isoformat(),
                                     "charted_by": item.charted_by}))
            # G2-A1: the lifecycle hook after every evaluation, as /ingest runs it and as the
            # replay runs it after every `chart` row, so a restart rebuilds exactly this (D4, D7).
            # Charting is often what ends an alert: the antibiotic given, the fluid that was due.
            _audit_cleared(hospital, sync_alerts(engine, store, obs.patient_id, now), now)
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
            if store.stamp_first_seen(patient_id, a.kind, now):
                audit.append(AuditEvent(hospital, "first_seen", patient_id, a.kind,
                                        {"at": now.isoformat()}))
        # A kind charting ended has left the live keys: a nurse is told again if it returns (D5).
        notifier.prune(hospital, live_keys(engine, store))

```

`/ingest` runs the hook before its stamps; `store.prune` goes (the hook prunes):

**Edit** `homunculus-engine/src/homunculus/api/app.py` — replace:
```python
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
        # First-seen uses WALL-CLOCK time (escalation measures real elapsed time, not observation time).
        wall_now = datetime.now(timezone.utc)
        # G2-A1: what stopped firing ends its episode or — a critical nobody acknowledged —
        # latches (api/alert_lifecycle.py). Before the stamps: a kind that came back after
        # clearing has had its old stamp pruned, so it is stamped anew, a new episode (D5).
        _audit_cleared(hospital, sync_alerts(engine, store, obs.patient_id, wall_now), wall_now)
        for a in engine.active_alerts(obs.patient_id):
            if store.stamp_first_seen(obs.patient_id, a.kind, wall_now):
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

- [ ] **Step 4: The new event's name**

**Edit** `homunculus-engine/src/homunculus/api/audit.py` — replace:
```python
    event_type: str          # "ingest" | "alert" | "ack" | "escalation" | "notification"
```
with:
```python
    event_type: str          # "ingest" | "alert" | "ack" | "escalation" | "notification"
    #                          | "alert_cleared" (G2-A1: an episode's end — api/alert_lifecycle.py)
```

- [ ] **Step 5: The replay** — four Edits in `rehydrate.py`.

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
rows follow from those and are not replayed."""
from __future__ import annotations

from datetime import datetime

from homunculus.api.ackstore import AckStore
from homunculus.api.alert_lifecycle import acknowledge_latched, sync_alerts
```

**Edit** `homunculus-engine/src/homunculus/api/rehydrate.py` — replace:
```python
            # septic-shock and antibiotic-clock alerts down with it, silently, on a patient the
            # ward believes is being watched for exactly those.
            _replay_ingest(engine, rec)
```
with:
```python
            # septic-shock and antibiotic-clock alerts down with it, silently, on a patient the
            # ward believes is being watched for exactly those.
            if _replay_ingest(engine, rec):
                # G2-A1 (D7): through the hook, as the door ran it. What it clears was audited
                # live (`alert_cleared`) and is not written again.
                sync_alerts(engine, store, rec.patient_id, _written_at(rec))
```

**Edit** `homunculus-engine/src/homunculus/api/rehydrate.py` — replace:
```python
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
def _replay_ack(store: AckStore, rec: AuditRecord) -> None:
    """`role` is replayed as `acknowledged_by`, bounded like the live path: rows written before
    the device role was bounded may hold anything the body sent (a dict, a page of text).

    G2-A1 (D7, D8): an `ack` row for a latched alert removed it live, and removes it here — it is
    not recorded as an acknowledgement, which a later episode of the same kind would inherit."""
    if acknowledge_latched(store, rec.patient_id, rec.subject) is not None:
        return
    at = datetime.fromisoformat(rec.payload["at"])
```

- [ ] **Step 6: Green, and the neighbours**

```bash
cd /c/tmp/g2a-o17/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_api_ack.py tests/test_api_ingest.py tests/test_api_clinical.py tests/test_rehydrate.py 2>&1 | tail -1
grep -n "_live_keys" src/homunculus/api/app.py; echo "grep exit $?"
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_api_ack.py tests/test_api_ingest.py tests/test_api_clinical.py tests/test_rehydrate.py tests/test_alarm_quality.py tests/test_api_patient_profile.py tests/test_infinity_shadow_equivalence.py tests/test_infinity_shadow_isolation.py tests/test_notify.py tests/test_notify_hub.py tests/test_api_audit.py tests/test_trends_api.py tests/test_alert_lifecycle.py tests/test_board.py 2>&1 | tail -1
```

Expected: `50 passed, 3 warnings in …`; `grep exit 1` (no `_live_keys` is left); then `203 passed, 3 warnings in …`.

- [ ] **Step 7: The whole no-DB suite** (the doors are under every API test)

```bash
cd /c/tmp/g2a-o17/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -1
```

Expected: `2174 passed, 650 skipped, 3 warnings in …`.

- [ ] **Step 8: Line ends**

```bash
cd /c/tmp/g2a-o17
for f in homunculus-engine/src/homunculus/api/app.py homunculus-engine/src/homunculus/api/rehydrate.py homunculus-engine/src/homunculus/api/audit.py homunculus-engine/tests/test_api_ack.py homunculus-engine/tests/test_api_ingest.py homunculus-engine/tests/test_api_clinical.py homunculus-engine/tests/test_rehydrate.py; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected: `app.py CR=1160 LF=1160`, `rehydrate.py CR=100 LF=100`, `audit.py CR=288 LF=288`, `test_api_ack.py CR=185 LF=185`, `test_api_ingest.py CR=132 LF=132`, `test_api_clinical.py CR=223 LF=223`, `test_rehydrate.py CR=168 LF=168`.

- [ ] **Step 9: Commit**

```bash
cd /c/tmp/g2a-o17
git add homunculus-engine/src/homunculus/api/app.py homunculus-engine/src/homunculus/api/rehydrate.py homunculus-engine/src/homunculus/api/audit.py homunculus-engine/tests/test_api_ack.py homunculus-engine/tests/test_api_ingest.py homunculus-engine/tests/test_api_clinical.py homunculus-engine/tests/test_rehydrate.py
git status --short && git diff --cached --stat
git commit -q -F - <<'MSG'
feat(api): both doors and the replay end an alert's episode with its rule (G2-A1, O17)

/ingest and /clinical run the lifecycle hook after every evaluation and audit
what it cleared as alert_cleared {first_seen, at, reason, severity} (D4, D6);
/clinical stamps first-seen for the patient's firing alerts only and prunes
the notifier's dedup as /ingest does, so a kind that returns is told again
(D5). /ack on a latched critical removes it — an ack row, then alert_cleared
acked_after_resolve; a cleared alert that did not latch is 404 (D8). The live
keys are firing + latched; the escalation cycle sees the firing alerts only.
rehydrate replays every ingest and chart row through the same hook, and an
ack row for a latched alert removes it rather than becoming an
acknowledgement a later episode would inherit (D7): a restart rebuilds the
board episode by episode. alert_cleared is a new audit event type.

red: 11 failed, 39 passed — the latched shock vanished, no alert_cleared rows, the replay did not latch, 404 acknowledging a latch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
git log --oneline -1
```

---

### Task 5: The dashboard — a critical whose condition passed waits, silently, for its acknowledgement

Spec D11 and D12's legend, with X5, X6 and X7. No SSE change: the board replace already drops a cleared alert (`boardStore.js:58–64`).

The rules, each held by a test below:
- the adapter maps `resolved_at` to status **RESOLVED** (ACKNOWLEDGED wins over it, FIRED is the rest), `resolvedAtMs`, and the alarm's `episode` = `<patient>::<kind>::<first_seen_at>`; a new first-seen is a new episode of the same `id`;
- a RESOLVED alarm is in the waiting queue and in the counts (`needsAnswer`: an acknowledgement removes a latch, so it is never acknowledged);
- the sound is silent for a RESOLVED alarm and plays what still fires; `notifyFor` keeps it among the waiting `items` but not among `ringing`;
- on the page: the sound stops when a critical's condition passes; its notification stays; one that passed before it was raised raises none; a new episode is a new notification under a tag of its own (the old one closed); the tag is the episode's hash (the existing tag test's key gains the first-seen);
- the alarms row of a RESOLVED alarm shows «keçdi · təsdiqlənməyib» and, for the screen reader, «keçdiyi saat: HH:MM», sits in "Cavab gözləyir", and keeps «Gördüm», which removes it; a firing alarm shows no badge;
- the trend legend's ▲ reads «siqnalın başladığı an» (X5), in the legend and in the table's notes.

**Files:**
- Modify (tests and fixture): `dashboard/src/liveAdapters.test.js`, `dashboard/src/live/data/board.testutil.js`, `dashboard/src/live/data/boardStore.test.js`, `dashboard/src/live/signals/signals.test.js`, `dashboard/src/live/signals/AlarmSignals.test.jsx`, `dashboard/src/live/screens/alarms/AlarmsScreen.test.jsx`, `dashboard/src/live/screens/patient/trends/TrendModal.test.jsx`
- Modify (code and texts): `dashboard/src/live/i18n/strings/alarms.js`, `dashboard/src/live/i18n/strings/patient.js`, `dashboard/src/liveAdapters.js`, `dashboard/src/live/signals/signals.js`, `dashboard/src/live/signals/AlarmSignals.jsx`, `dashboard/src/live/screens/alarms/AlarmsScreen.jsx`, `dashboard/src/live/data/boardStore.js`, `dashboard/src/live/screens/patient/trends/TrendLegend.jsx`

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
```

- [ ] **Step 4: The mapping's tests** (`signals.test.js`: one `toEqual` gains `ringing`; two tests)

**Edit** `dashboard/src/live/signals/signals.test.js` — replace:
```js
    expect(notifyFor(ward([alarm("a", "critical")], CONNECTION.UNAVAILABLE, false))).toEqual({ known: false, items: [] });
```
with:
```js
    expect(notifyFor(ward([alarm("a", "critical")], CONNECTION.UNAVAILABLE, false))).toEqual({ known: false, items: [], ringing: [] });
```

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
    const stale = notifyFor(ward([alarm("a", "critical")], CONNECTION.DEGRADED));
    expect(stale.known).toBe(false);
    expect(stale.items).toHaveLength(1);
  });
});
```
with:
```js
    const stale = notifyFor(ward([alarm("a", "critical")], CONNECTION.DEGRADED));
    expect(stale.known).toBe(false);
    expect(stale.items).toHaveLength(1);
  });

  it("keeps a RESOLVED alarm among those that wait, but raises no new notification for it", () => {
    const { items, ringing } = notifyFor(ward([
      alarm("a", "critical", { resolved_at: "2026-10-08T09:59:00Z" }), alarm("b", "critical"),
    ]));
    expect(items.map((a) => a.id)).toEqual(["S-001::a", "S-002::b"]);
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

- [ ] **Step 6: The alarms screen's tests**

**Edit** `dashboard/src/live/screens/alarms/AlarmsScreen.test.jsx` — replace:
```jsx
import { NOW, ago, alarm, board, entry, identity, measured } from "../../data/board.testutil.js";
import { AlarmsScreen } from "./AlarmsScreen.jsx";
```
with:
```jsx
import { NOW, ago, alarm, board, entry, identity, measured } from "../../data/board.testutil.js";
import { hhmm } from "../../i18n/dates.js";
import { AlarmsScreen } from "./AlarmsScreen.jsx";
```

**Edit** `dashboard/src/live/screens/alarms/AlarmsScreen.test.jsx` — replace:
```jsx
    it("a refusal is shown and the list is NOT changed — nothing was acknowledged", async () => {
```
with:
```jsx
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
        fireEvent.click(within(row).getByRole("button", { name: "Gördüm" }));
        await settle();
      });
      expect(api.acknowledge).toHaveBeenCalledWith("S-001", "septic_shock");
      expect(screen.queryByText("Septic shock criteria met")).toBeNull();     // the ack removed it
    });

    it("shows no such badge on an alarm that still fires", async () => {
      await open({ payload: withAlarms(alarm("septic_shock", "critical")) });
      expect(screen.queryByText("keçdi · təsdiqlənməyib")).toBeNull();
    });

    it("a refusal is shown and the list is NOT changed — nothing was acknowledged", async () => {
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

- [ ] **Step 8: Run them and see them fail for the right reason**

```bash
cd /c/tmp/g2a-o17/dashboard
npx vitest run src/liveAdapters.test.js src/live/data/boardStore.test.js src/live/signals/signals.test.js src/live/signals/AlarmSignals.test.jsx src/live/screens/alarms/AlarmsScreen.test.jsx src/live/screens/patient/trends/TrendModal.test.jsx 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
```

Expected:
```
 FAIL  src/liveAdapters.test.js > alertsFromPatients > is RESOLVED when its rule stopped before anyone acknowledged it, with the instant it stopped
 FAIL  src/liveAdapters.test.js > alertsFromPatients > names the episode by its first-seen instant: an alarm that cleared and came back is a new one
 FAIL  src/live/signals/AlarmSignals.test.jsx > the alarm sound > stops when the alarm's condition passes, though it still waits for an answer
 FAIL  src/live/signals/AlarmSignals.test.jsx > the critical-alarm notification > tags each notification so the browser replaces it rather than repeating it
 FAIL  src/live/signals/AlarmSignals.test.jsx > the critical-alarm notification > keeps the notification of an alarm whose condition passed, and raises none for one that passed unseen
 FAIL  src/live/signals/AlarmSignals.test.jsx > the critical-alarm notification > raises a new notification, under a tag of its own, when an alarm fires again as a new episode
 FAIL  src/live/signals/signals.test.js > what the page plays > is silent for a RESOLVED alarm that still waits, and plays what still fires
 FAIL  src/live/signals/signals.test.js > what raises a notification > names nothing it cannot know, and says whether the board is LIVE
 FAIL  src/live/signals/signals.test.js > what raises a notification > keeps a RESOLVED alarm among those that wait, but raises no new notification for it
 FAIL  src/live/data/boardStore.test.js > alarm counts and lists > keeps a RESOLVED alarm in the queue until somebody acknowledges it
 FAIL  src/live/screens/alarms/AlarmsScreen.test.jsx > the alarms screen > acknowledging > keeps a critical whose condition passed waiting, with its badge, and still asks for the acknowledgement
 FAIL  src/live/screens/patient/trends/TrendModal.test.jsx > the big chart's legend > explains every mark in words: the server's NEWS2 source, both band tones, both marks, the dashed line
 FAIL  src/live/screens/patient/trends/TrendModal.test.jsx > the big chart as a table > carries the legend's notes into the table — thinned, marks cut short, when an alarm began — but not the chart's swatches
 Test Files  6 failed (6)
      Tests  13 failed | 204 passed (217)
```
The reasons: no `status` RESOLVED, no `resolvedAtMs`, no `episode`; `notifyFor` has no `ringing`; the sound goes on for a resolved alarm, a new notification is raised for one, and a new episode under the old key raises none; the tag's key has no first-seen; the badge's words are missing; the legend still says «siqnalın ilk aşkarlanması». `shows no such badge on an alarm that still fires` passes already: it guards the badge's condition.

- [ ] **Step 9: The texts** — `strings/alarms.js`, four Edits (tr, az, ru, en):

**Edit** `dashboard/src/live/i18n/strings/alarms.js` — replace:
```js
    closedGone: "Kapanan bir alarm panodan düşer: motor yalnız açık alarmları gönderiyor, geçmiş için henüz bir uç nokta yok. Kapanma kayıtları denetim kaydında.",
```
with:
```js
    closedGone: "Kapanan bir alarm panodan düşer: motor yalnız açık alarmları gönderiyor, geçmiş için henüz bir uç nokta yok. Kapanma kayıtları denetim kaydında. Kritik bir alarm ise durumu geçse de biri onaylayana kadar «geçti · onaylanmadı» olarak burada kalır; sesi durur.",
    // G2-A1 (O17): a critical whose condition passed before anyone acknowledged it.
    resolvedUnacked: "geçti · onaylanmadı",
    resolvedAt: "geçtiği saat",
```

**Edit** `dashboard/src/live/i18n/strings/alarms.js` — replace:
```js
    closedGone: "Bağlanan siqnal paneldən düşür: mühərrik yalnız açıq siqnalları göndərir, tarix üçün hələ uç nöqtə yoxdur. Bağlanma qeydləri audit jurnalındadır.",
```
with:
```js
    closedGone: "Bağlanan siqnal paneldən düşür: mühərrik yalnız açıq siqnalları göndərir, tarix üçün hələ uç nöqtə yoxdur. Bağlanma qeydləri audit jurnalındadır. Kritik siqnal isə vəziyyət keçsə də, kimsə təsdiqləyənə qədər «keçdi · təsdiqlənməyib» kimi burada qalır; səsi dayanır.",
    resolvedUnacked: "keçdi · təsdiqlənməyib",
    resolvedAt: "keçdiyi saat",
```

**Edit** `dashboard/src/live/i18n/strings/alarms.js` — replace:
```js
    closedGone: "Закрытая тревога уходит с панели: система передаёт только открытые, конечной точки для истории пока нет. Записи о закрытии — в журнале аудита.",
```
with:
```js
    closedGone: "Закрытая тревога уходит с панели: система передаёт только открытые, конечной точки для истории пока нет. Записи о закрытии — в журнале аудита. Критическая тревога остаётся здесь с пометкой «прошло · не подтверждено», пока её не подтвердят, даже если состояние прошло; звук прекращается.",
    resolvedUnacked: "прошло · не подтверждено",
    resolvedAt: "время, когда прошло",
```

**Edit** `dashboard/src/live/i18n/strings/alarms.js` — replace:
```js
    closedGone: "A closed alarm leaves the board: the engine sends the open ones only, and there is no endpoint for the history yet. The closures are in the audit trail.",
```
with:
```js
    closedGone: "A closed alarm leaves the board: the engine sends the open ones only, and there is no endpoint for the history yet. The closures are in the audit trail. A critical alarm stays here, marked \"resolved · unacknowledged\", until someone acknowledges it, even after its condition has passed; its sound stops.",
    resolvedUnacked: "resolved · unacknowledged",
    resolvedAt: "resolved at",
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

- [ ] **Step 14: Two comments** (`boardStore.js`, `TrendLegend.jsx`)

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

- [ ] **Step 15: Green — the touched files and the dictionaries' test**

```bash
cd /c/tmp/g2a-o17/dashboard
npx vitest run src/liveAdapters.test.js src/live/data/boardStore.test.js src/live/signals/signals.test.js src/live/signals/AlarmSignals.test.jsx src/live/screens/alarms/AlarmsScreen.test.jsx src/live/screens/patient/trends/TrendModal.test.jsx src/live/i18n/strings.test.js 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
```

Expected: ` Test Files  7 passed (7)` and `      Tests  223 passed (223)`.

- [ ] **Step 16: The dashboard gate — the whole suite, then the build**

```bash
cd /c/tmp/g2a-o17/dashboard
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
```

Expected: ` Test Files  89 passed (89)` and `      Tests  2402 passed (2402)`.

```bash
cd /c/tmp/g2a-o17/dashboard
npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
```

Expected: `✓ built in …`, `precache  20 entries (…)`, no `larger than`.

- [ ] **Step 17: Line ends**

```bash
cd /c/tmp/g2a-o17
for f in dashboard/src/liveAdapters.js dashboard/src/liveAdapters.test.js dashboard/src/live/data/board.testutil.js dashboard/src/live/data/boardStore.js dashboard/src/live/data/boardStore.test.js dashboard/src/live/signals/signals.js dashboard/src/live/signals/signals.test.js dashboard/src/live/signals/AlarmSignals.jsx dashboard/src/live/signals/AlarmSignals.test.jsx dashboard/src/live/screens/alarms/AlarmsScreen.jsx dashboard/src/live/screens/alarms/AlarmsScreen.test.jsx dashboard/src/live/i18n/strings/alarms.js dashboard/src/live/i18n/strings/patient.js dashboard/src/live/screens/patient/trends/TrendLegend.jsx dashboard/src/live/screens/patient/trends/TrendModal.test.jsx; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected: `liveAdapters.js CR=239 LF=239`, `liveAdapters.test.js CR=508 LF=508`, `board.testutil.js CR=164 LF=164`, `boardStore.js CR=531 LF=531`, `boardStore.test.js CR=627 LF=627`, `signals.js CR=57 LF=57`, `signals.test.js CR=118 LF=118`, `AlarmSignals.jsx CR=292 LF=292`, `AlarmSignals.test.jsx CR=369 LF=369`, `AlarmsScreen.jsx CR=263 LF=263`, `AlarmsScreen.test.jsx CR=337 LF=337`, `alarms.js CR=132 LF=132`, `patient.js CR=470 LF=470`, `TrendLegend.jsx CR=107 LF=107`, `TrendModal.test.jsx CR=666 LF=666`.

- [ ] **Step 18: Commit**

```bash
cd /c/tmp/g2a-o17
git add dashboard/src/liveAdapters.js dashboard/src/liveAdapters.test.js dashboard/src/live/data/board.testutil.js dashboard/src/live/data/boardStore.js dashboard/src/live/data/boardStore.test.js dashboard/src/live/signals/signals.js dashboard/src/live/signals/signals.test.js dashboard/src/live/signals/AlarmSignals.jsx dashboard/src/live/signals/AlarmSignals.test.jsx dashboard/src/live/screens/alarms/AlarmsScreen.jsx dashboard/src/live/screens/alarms/AlarmsScreen.test.jsx dashboard/src/live/i18n/strings/alarms.js dashboard/src/live/i18n/strings/patient.js dashboard/src/live/screens/patient/trends/TrendLegend.jsx dashboard/src/live/screens/patient/trends/TrendModal.test.jsx
git status --short && git diff --cached --stat
git commit -q -F - <<'MSG'
feat(dashboard): a critical whose condition passed waits silently for its acknowledgement (G2-A1)

The adapter maps resolved_at to status RESOLVED (between FIRED and
ACKNOWLEDGED), resolvedAtMs, and the alarm's episode
(<patient>::<kind>::<first seen>). The alarms row shows the badge «keçdi ·
təsdiqlənməyib» (×4) with the time it passed, and keeps the acknowledge
button; needsAnswer still counts it, so the bell, the rail and the lock
screen do. signals.js stops the sound at resolve and raises no new
notification for a resolved alarm, while one already raised stays; the
notification is keyed and tagged by episode, so a critical that cleared and
came back is a new notification (D11). The Alarms box says a critical stays
until acknowledged, and the trend legend's ▲ reads «siqnalın başladığı an»
(×4, X5) — one mark per episode (D12).

red: 13 failed, 204 passed — no status RESOLVED or episode, the sound and a new notification for a resolved alarm, the episode tag, the badge, the legend

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
git log --oneline -1
```

---

### Task 6: The docs — the guide, the G2-01 plan's O17, the roadmap row

Spec §4 "Docs" and D12's legend, with X7. The guide is Turkish, so it quotes the tr texts («geçti · onaylanmadı», «alarmın başladığı an»); the board's default language says «keçdi · təsdiqlənməyib». History is kept: the G2-01 plan's O17 lines get a "resolved by G2-A1" note, nothing in them is rewritten. `Homunculus/wiki` is untouched — no clinical claim changes.

**Files:**
- Modify: `docs/homunculus-rehber-TR.md` (§3.6's second question, §3.7's ▲, §2's sound and tag), `docs/superpowers/plans/2026-10-19-g2-vital-egrileri.md` (X3 row, the Task 4 amendment, the O17 row), `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` (the row G2-A1 after G2-01)

- [ ] **Step 1: The guide** — four Edits in `docs/homunculus-rehber-TR.md`.

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
   **kimsenin onaylamadığı kritik bir alarm** durumu geçince de listede «geçti · onaylanmadı»
   olarak kalır, sesi durur; biri onaylayınca kalkar. Onaylanmış bir kritik alarm ile yüksek, orta
   ve düşük alarmlar kuralla birlikte gider. Aynı alarm yeniden çıkarsa yeni bir bölümdür: yeni ilk
   görülme anı, yeni eskalasyon saati, hemşireye yeni bildirim — gidip gelen bir değer (nabız
   140 → 80 → 140) her dönüşünde yeniden bildirir; bunun için bilerek bir bekleme yok. Motor yalnız
   açık alarmları gönderiyor ve alarm geçmişi için henüz bir uç yok; kapanma kaydı denetim
   kaydında (`alert_cleared`; `audit.view` ister).
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
| G2-A1 | Alarm bölümleri (O17): bir alarm, kuralı onu üretmeyi bıraktığı ilk ölçümde kapanır; kimsenin onaylamadığı kritik alarm «geçti · onaylanmadı» olarak onaylanana kadar kalır, sesi durur; yeniden çıkan alarm yeni bir bölümdür (yeni ilk görülme, eskalasyon saati, hemşire bildirimi ve ▲); `alert_cleared` denetim olayı; yeniden başlatma panoyu bölüm bölüm kurar · spec: [2026-10-25](../specs/2026-10-25-g2a-alarm-bolumleri-design.md) · plan: [G2-A1](2026-10-25-g2a-alarm-bolumleri.md) | Kod ✅ 2026-10-25 · <range> · **VM'de değil** (kabul kullanıcıyla, ayrı adım: spec §6; web api'den sonra değil — eski web, kilitli kalan bir kritiği hâlâ çalıyormuş gibi seslendirir). Backend 2174 / 650 (DB'siz); dashboard 89 dosya / 2402 test; derleme 20 öğe. Plan yazılırken geliştirme sunucusunda (SQLite denetim, gerçek yeniden başlatma, sentetik yataklar) §6'nın dört adımı geçti; yerel Docker yığınında yürüyüş planın 7. görevi. **Açık:** plandaki X1–X8 ve O1–O14; az/ru/en metinleri yerel okuma bekliyor |

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

Expected: `homunculus-rehber-TR.md CR=1150 LF=1150`, `2026-10-19-g2-vital-egrileri.md CR=13040 LF=13040`, `2026-10-01-tasarim-entegrasyonu-yol-haritasi.md CR=1293 LF=1293`.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g2a-o17
git add docs/homunculus-rehber-TR.md docs/superpowers/plans/2026-10-19-g2-vital-egrileri.md docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md
git status --short && git diff --cached --stat
git commit -q -F - <<'MSG'
docs: alerts end with their rule — the guide, the G2-01 plan's O17 and the roadmap row G2-A1

The Turkish guide's "where did the closed alarm go" answer becomes the rule
(an alert ends on the first reading that does not produce it; a critical
nobody acknowledged stays as «geçti · onaylanmadı», silent, until someone
does; a return is a new episode, and a flapping value notifies each time),
the trend marks are episodes, and the sound and the notification's tag say
what changed. The G2-01 plan's O17 (X3, the Task 4 amendment, the open item)
is marked resolved by G2-A1, history kept. The roadmap gains the G2-A1 row.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
git log --oneline -1
```

---

### Task 7: The gates, and the acceptance on a local synthetic stack

Everything runs once more, in full, at the branch head; then the spec's §6 acceptance is walked on a **local synthetic stack** — never on the VM (the deploy and the VM acceptance with the user are a later, separate step, O14). No repo file changes in this task.

- [ ] **Step 1: The engine, no database**

```bash
cd /c/tmp/g2a-o17/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -1
```

Expected: `2174 passed, 650 skipped, 3 warnings in …` — the base's 2143 plus this slice's 31.

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

Expected: `133 passed, 3 warnings in …`.

- [ ] **Step 4: The dashboard suite and build**

```bash
cd /c/tmp/g2a-o17/dashboard
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
```

Expected: ` Test Files  89 passed (89)` and `      Tests  2402 passed (2402)`.

```bash
cd /c/tmp/g2a-o17/dashboard
npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
```

Expected: `✓ built in …`, `precache  20 entries (…)`, no `larger than`.

- [ ] **Step 5: The slice's size, and Lane B's seams untouched**

```bash
cd /c/tmp/g2a-o17
git diff --stat c66a615 HEAD | tail -1
git diff --name-only c66a615 HEAD -- homunculus-engine/src/homunculus/admission homunculus-engine/src/homunculus/escalation homunculus-engine/src/homunculus/scope homunculus-engine/src/homunculus/tenant dashboard/src/live/i18n/catalog.js dashboard/src/live/shell/routes.js dashboard/src/live/i18n/strings.test.js homunculus-engine/src/homunculus/auth; echo "lane B seams touched: $(git diff --name-only c66a615 HEAD -- homunculus-engine/src/homunculus/admission homunculus-engine/src/homunculus/escalation homunculus-engine/src/homunculus/scope homunculus-engine/src/homunculus/tenant dashboard/src/live/i18n/catalog.js dashboard/src/live/shell/routes.js dashboard/src/live/i18n/strings.test.js homunculus-engine/src/homunculus/auth | wc -l)"
git status --short
```

Expected: the replay (no plan commit) printed ` 37 files changed, 1088 insertions(+), 99 deletions(-)`; on the branch, where this plan is a commit after `c66a615`, it counts 38 files and this plan's lines too. Then `lane B seams touched: 0` and no status line.

- [ ] **Step 6: The acceptance script** — `/c/tmp/homunculus-plans/g2a-o17/acceptance.py` (outside the repo, standard library only; read it before running it). It writes made-up readings for three synthetic beds — `G2A-1` (a moderate alert), `G2A-2` (a critical that latches), `G2A-3` (140 → 80 → 140 → 80) — through `/ingest`, one `/ack`, and reads `/patients`, `/audit`, `/alarm-quality` and `/patients/{id}/trends`; the token comes from `HOMUNCULUS_TOKEN` and is printed nowhere. **Never point it at the VM or any stack holding a real patient.**

- [ ] **Step 7: The local stack** — G1-15's synthetic stack files, as the G2-01 walk used them (`/c/tmp/g115plan/stack/{local.env, compose.g115.yml}`). The containers are named by the compose file (`homunculus-postgres`, `homunculus-api`, `homunculus-web`), so no other such stack may be up:

```bash
cd /c/tmp/g2a-o17
ls /c/tmp/g115plan/stack/local.env /c/tmp/g115plan/stack/compose.g115.yml
docker ps -a --format '{{.Names}}' | grep -E '^homunculus-(postgres|api|web)$' || echo "no stack containers"
```

Expected: both files; `no stack containers`. **If a container is listed, stop and ask** — it is another session's (on 2026-10-25, while this plan was written, the G2-01 stack was up: the controller decides when it may go).

```bash
cd /c/tmp/g2a-o17
C="docker compose -p g2a -f deploy/local/docker-compose.yml -f /c/tmp/g115plan/stack/compose.g115.yml --env-file /c/tmp/g115plan/stack/local.env"
$C build api web 2>&1 | grep -E "Built|ERROR|precache"
$C up -d postgres api web 2>&1 | tail -3
```

Expected: `Image g2a-api Built`, `precache  20 entries …`, `Image g2a-web Built`; three containers started. Re-run `docker inspect -f '{{.State.Health.Status}}' homunculus-api` until it prints `healthy` (≈ 30–60 s; do not loop on `sleep`), then `curl -s -o /dev/null -w "http %{http_code}\n" http://127.0.0.1:18080/health` → `http 200`. Always name the three services.

- [ ] **Step 8: Acceptance 1, 2 (its first half) and 4, before a restart**

```bash
cd /c/tmp/homunculus-plans/g2a-o17
HOMUNCULUS_TOKEN=$(grep '^TENANT_TOKEN=' /c/tmp/g115plan/stack/local.env | cut -d= -f2-) PYTHONIOENCODING=utf-8 /c/tmp/f7-py312/venv/Scripts/python.exe acceptance.py http://127.0.0.1:18080 before-restart
```

Expected (what the replayed tree's dev server printed, 2026-10-25):
```
1 moderate: HR 140 -> news2; HR 80 -> -
2 critical: firing antibiotic_due,sepsis,septic_shock (risk critical); after lactate 1.5 shock resolved_at set=True acknowledged=False escalated=False risk high
4 alarm-quality: G2A-3 episodes=2; trail ['first_seen', 'alert_cleared(resolved)', 'first_seen', 'alert_cleared(resolved)']
```
— §6.1: the moderate alert is gone on the first normal reading; §6.2's first half: the shock latched — resolved, unacknowledged, not escalated — and the card's risk is the firing alerts' (D10); §6.4: two episodes, each closed.

- [ ] **Step 9: Restart the api, then acceptance 3 and 2 (its second half)**

```bash
cd /c/tmp/g2a-o17
C="docker compose -p g2a -f deploy/local/docker-compose.yml -f /c/tmp/g115plan/stack/compose.g115.yml --env-file /c/tmp/g115plan/stack/local.env"
$C restart api
```

Wait for `healthy` as in Step 7, then:

```bash
cd /c/tmp/homunculus-plans/g2a-o17
HOMUNCULUS_TOKEN=$(grep '^TENANT_TOKEN=' /c/tmp/g115plan/stack/local.env | cut -d= -f2-) PYTHONIOENCODING=utf-8 /c/tmp/f7-py312/venv/Scripts/python.exe acceptance.py http://127.0.0.1:18080 after-restart
```

Expected:
```
3 after restart: shock latched=True acknowledged=False
  ack -> 200; shock on the board: False
2 trail: ['first_seen', 'alert_cleared(resolved)', 'ack', 'alert_cleared(acked_after_resolve)']
3 new episode: firing=True acknowledged=False escalated=False first_seen newer=True; ▲ septic_shock marks=2
```
— §6.3: the latch survived the restart; the ack removed it; §6.2: the trail in the spec's order; the new episode fires unacknowledged with a newer first-seen and its own ▲ (two marks: episodes 1 and 3 of this bed's shock).

- [ ] **Step 10: By eye, in a browser** (a person, or an agent driving one). Open `http://127.0.0.1:18080`, sign in as a synthetic nurse (seed as the G2-01 walk's Step 6 did: `docker exec -e TEST_USER_PASSWORD='G115-Sentetik-Parola-1' -e SEED_TENANT_SLUG=demo-hastanesi homunculus-api python scripts/seed_test_users.py`; `test.hemsire@homunculus.health`). Run Step 8 again for a fresh latch (the beds keep their ids and their history, so its printed counts are then larger — only the latch matters here), then **Siqnallar**: under "Cavab gözləyir" the `G2A-2` row "Septic shock criteria met" with «KEÇDİ · TƏSDİQLƏNMƏYİB» (the pill writes upper case) and the time it passed. With the alarm sound turned on in Ayarlar: the critical pattern (10 pulses every 2.5 s) is gone, and the high one (3 pulses every 12 s) goes on for the bed's firing sepsis and antibiotic clock. «Gördüm» removes the row. The box "Bağlanan siqnallar" says the new sentence. Patient `G2A-3` → Vital qrafikləri → Nəbz: two ▲, the legend «siqnalın başladığı an». The bed card shows the latched alarm without the badge (O9) — note it for the user. Dil: tr, ru, en — the badge's words in each.

- [ ] **Step 11: Tear it down.** `$C down -v` (with `C` set as in Step 7) → the three containers and the `g2a` volumes removed; `docker ps -a --format '{{.Names}}' | grep -E '^homunculus-(postgres|api|web)$' || echo "no stack containers"` → `no stack containers`. Nothing to commit: the walk's outcome goes to the controller (and, with the deploy, into the roadmap row).

**Without Docker** (how the plan proved Steps 8–9): the engine's dev server from the branch's tree, its SQLite audit in a scratch folder, stopped and started in between:

```bash
mkdir -p /c/tmp/g2a-devsrv && cd /c/tmp/g2a-devsrv
PYTHONPATH=/c/tmp/g2a-o17/homunculus-engine/src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m uvicorn homunculus.api.devserver:app --port 18097 --log-level warning
```

(in the background — it is a server, not a gate; its token is the dev server's own `dev-token`). Then `HOMUNCULUS_TOKEN=dev-token … acceptance.py http://127.0.0.1:18097 before-restart`, stop the server, start it again in the same folder, `… after-restart`. It prints exactly Step 8's and Step 9's expected lines. The folder's `homunculus-audit.db` and `homunculus-identity.db` are synthetic; delete the folder when done.

No commit: nothing in the repo changed.

---

## Task order and parallel work

| Task | Needs | May run beside (own worktree) | Files it shares with a later task |
|---|---|---|---|
| 0 worktree, junction, baseline | — | — | — |
| 1 the engine: the bucket is the evaluation; the anchor (X1) | 0 | 5 | `test_trends.py`'s neighbours only |
| 2 the hook and the latch | 1 (a dropped kind to latch) | 5 | `ackstore.py` is read by 3 and 4 |
| 3 the readers: board, alarm quality | 2 (`AckStore.resolved`) | 5 | — |
| 4 the writers and the replay | 2, 3 (its tests read the board's `resolved_at`) | 5 | — |
| 5 the dashboard | 0 (it reads only the payload's shape: `resolved_at`) | 1–4 | — |
| 6 docs | 1–5 (the range and the counts it quotes) | — | — |
| 7 gates, the acceptance | 1–6 | — | — |

**Why not the brief's order** (doors in Task 3, board and rehydrate in Task 4): X3. Readers before writers, and the doors with their replay in one commit, so that at no commit does a restart rebuild a different board from the live one; the door tests can then assert on the board.

**Waves, if run in parallel:** A = {1 → 2 → 3 → 4} beside B = {5} (the dashboard needs only the payload's new field, which Task 3 defines and Task 5's fixtures carry); then 6, 7. The plan was measured in the serial order 1 → 7; a parallel merge must re-run Task 7's gates on the merged head.

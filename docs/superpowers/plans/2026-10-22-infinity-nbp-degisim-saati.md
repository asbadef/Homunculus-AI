# Infinity shadow lane · NBP on the monitor strip, with the time its value last changed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Aşama A monitor strip shows NBP as one cell, `NBP S/D (M) mmHg · ölçmə ≤ HH:MM (N dəq)`, where the time is when the hub saw the (systolic, diastolic, mean) triple change: an upper bound of the measurement. Before a change has been seen it says "— · ölçmə gözlənilir"; two hours after the change it is withheld.

**Architecture:** The hub (.72) tracks the change in memory (`edge/infinity_live.py`): per device, the last complete valid triple and the receipt time of the packet in which it changed, kept only when the device's NBP was heard within 3 s before (X37). The forwarder (`edge/infinity_shadow.py`) speaks schema v2: NBP's three readings with `changed_at`, sent only once a change has been seen. The API (`api/infinity_shadow.py`) takes v1 and v2, folds the three held readings into one board entry `nbp` and withholds it 2 h after the change; `deploy/infinity/shadow_check.py` prints one `nbp:` line. The dashboard draws the entry (`monitor.js` `cellOf` → `MonitorStrip.jsx`), with no threshold in the browser. The worker (.74) does not change. Deploy order: API + web first, then the hub's release R4 with drop-in `94-nbp.conf`.

**Tech Stack:** Python 3.12 and 3.14, FastAPI, pytest; React 18, Vite, Vitest + Testing Library (`render`, `screen`, `within`; no user-event); the hub's release builder (`deploy/infinity/build_transport_release.py`); systemd drop-ins on the hub VM.

**Spec (authoritative):** `docs/superpowers/specs/2026-10-22-infinity-nbp-degisim-saati-design.md` (D1–D9, §3–§9). Where the code made the spec's letter unsafe, impossible or merely unspecified, this plan departs from it; every departure is in the table below with its reason. **All of X37–X45 are proposed (planning review, 2026-10-24) and await the user's yes.** X37 is the one that matters: the spec's letter would show an NBP measured during an outage as minutes old.

**How the numbers in this plan were obtained.** Every task was implemented in the worktree while the plan was written (a scratch branch from `14c208d`). Then the plan itself was replayed: a script applied this file's Edit blocks onto `14c208d`, task by task and step by step (the tests first, then the code), on a second scratch branch, and every command of Tasks 0–9 was run as written — every red, every green, every count and every line-end figure below is what that replay printed, the commit blocks included (2026-10-24/25). The replay's tree is identical to the implementation's (`git diff` empty, all 25 files); both scratch branches were deleted afterwards. The code is kept beside the per-task files as `/c/tmp/homunculus-plans/nbp/reference.patch` (`git diff 14c208d <replay head>`) — a cross-check, not the authority: build from the tasks. The release name in Task 8 (`transport-c1f619bf4e1df375`) is the hash of the release's files, so the same two edge files always give it (the replay built it from a different commit than the implementation and got the same name). Task 10's VM blocks were checked with `bash -n` and D-1's drop-in generation against a synthetic `92` file; they have not run on the VM.

---

## What the code says that the spec did not — proposed departures (read before Task 1)

| # | Spec | Code at `14c208d` / what was found | This plan |
|---|---|---|---|
| X37 | §1 "never fresher than reality"; §4.1 test "a change after a backlog/outage is seen on the first live packet" (stamped with that packet's time); D3 | The bound is on the TIME: the cuff measured at `m ≤ c`, `c` the packet that showed the change. The AGE the strip prints, `now − c`, is then a LOWER bound of the true age — fresher than reality by `c − m`. While the hub hears the device continuously that is under a second; after an outage (the worker's outbox delivers the backlog, which `_consume_one` drops as ≥ 3 s old, `infinity_live.py:64`) or a monitor off the network, the first live packet carries a change that may have happened at any moment of the gap, and the spec's letter would stamp it "ölçüm ≤ now (0 dəq)" for a measurement as old as the outage — the exact failure that kept NBP off the strip (spec §1). **Unsafe as written.** | A change keeps its time only when the device's NBP was heard (any NBP record, valid or flagged) within `NBP_CONTINUITY_S` = 3 s (`STALE_AFTER_MS`, the window in which any strip value counts as live) before the change packet. After a longer gap the new triple is held with **no** time: hidden until the next change seen as it happens — the same rule as after a hub restart (D4). A flagged spell (`***` while the cuff inflates) keeps continuity, because the records keep coming. Task 1: `_track_nbp`, `nbp_heard_at`, three tests (`test_a_change_seen_only_after_an_outage_has_no_time`, the 3.0 / 3.1 s boundary, the flagged spell). If the Kappa sends NBP records less often than every 3 s, NBP would stay "gözlənilir" on that bed: open item O30, checked in the walk (Task 10, E-2). The spec's letter is one line (`state.nbp_changed_at = epoch`) and one test if the user prefers it. |
| X38 | §4.1 "the snapshot's `nbp_*` entries carry `changed_at`"; §4.3 folding | A partial packet updates one component's value in the research view (`infinity_live.py:87–94`) but not the triple; lending the triple's time to that newer value would print a newer measurement with an older time. And three held readings can come from two posts with two different change times. | Hub: an `nbp_*` entry carries the change time only while its value IS the held triple's component (`_nbp_changed_at`); otherwise `None`, and the forwarder does not send it. API: the three readings fold into a number only when all three are held **with one `changed_at`**; anything else is "awaiting". Tests in Tasks 1, 3, 4. |
| X39 | §4.3 "`devices()` emits `nbp` after `respiration`"; §5 "dash + nbpWaiting when `last_at` is null" | Silent on when the entry exists. Emitted for every device, a monitor holding nothing would lose its "göstəriləcək dəyər yoxdur" sentence, and — worse — with the API deployed first (D8) or the hub rolled back to R3, every bed would say "ölçmə gözlənilir" for a hub that cannot send NBP at all. | `nbp` is emitted for a device that holds at least one reading, and only while the last body was v2 (`_nbp_lane`) or NBP readings from before are still held. Under an R3 hub the strip looks exactly as today. Tests: `test_a_v1_body_is_still_taken_and_shows_no_nbp_at_all`, `test_after_a_hub_rolled_back_to_v1_…`, `test_a_device_holding_readings_but_no_nbp_shows_it_awaiting_a_change`, the API's v1 test. |
| X40 | §4.3 the v2 reading rules | "`changed_at` iff `parameter` starts with `nbp_`"; "not more than 2 s in the future"; silent on v1's NBP, on a flagged component and on what `age_s`/`last_at` mean for the folded entry. | Exact names (`NBP_PARTS`), so `nbp_foo` is just an unknown parameter; `0 < changed_at <= captured_at` in `_validate` — with `_judge`'s existing clock rule on `captured_at` that is "never more than 2 s ahead", without a second clock check; an NBP in a v1 body stays `unknown_parameter`, as v1 always had it; a component the device flags gives `state: "invalid"` (the monitor's `***`); a shown entry's `age_s`/`last_at` are the packet's (the 15 s rule), a withheld one's are the change's (so the strip's "köhnə · N" is the measurement's age). `SCHEMAS` and `NBP_PARTS` are tuples so a fuzzed list or dict compares instead of raising (the store's fuzzer test holds it). |
| X41 | — | `lastSeenMs` (the silent monitor's "son məlumat HH:MM") takes the newest `last_at` of every parameter; a withheld NBP's `last_at` is its change time, not when the monitor sent. | `lastSeenMs` leaves the `nbp` entry out (Task 5, one test). |
| X42 | §5 strings: az `nbpMeasured` "ölçüm ≤ {time} ({age})", `nbpWaiting` "ölçüm gözlənilir"; §6.2 "— · ölçüm gözlənilir" | "ölçüm" is the Turkish word; the az namespace says "ölçmə" everywhere (`short`, `legendNbp`, `ev.screen_match_site_unknown`, patient.js). Taken literally, `nbpMeasured` would equal tr and need an `AZ_SAME_AS_TR` entry that a reviewer could not justify. | az "ölçmə ≤ {time} ({age})", "ölçmə gözlənilir"; tr keeps "ölçüm". The walk's words follow (Task 10, E-2). Awaiting the native reading (O32) like every az/ru text. |
| X43 | The brief's task order: hub → forwarder v2 → API → strings → … | The forwarder's end-to-end tests post through the real API (`test_infinity_shadow_forwarder.py:400–432`, the TLS test at 458): a v2 forwarder before a v2 API is red. `monitor.test.js:126–137` holds the dashboard's `EVIDENCE` to the API's and to `PARAM_ORDER`, and `SettingsScreen.test.jsx` lists the legend's rows: the API's `nbp` row and the dashboard's copy must land in one commit, and that row needs its label (`monitor.p.nbp`) first. | **1 hub · 2 strings · 3 API with the dashboard's mirrored tables · 4 forwarder · 5 `monitor.js` · 6 strip · 7 legend · 8 gates · 9 docs · 10 deploy.** Every commit is green in both suites, and the receiver comes before the sender, as D8 deploys them. |
| X44 | Docs: "the roadmap's Stage A row" | `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` has no Aşama A row (checked 2026-10-24: its "Grup 2 · durum" table holds G2-01 only). | Task 9 adds a row `A-NBP` under G2-01. |
| X45 | §6.1 "'ölçüm ≤ HH:MM' is **not later** than the cuff time"; §6.3 "eski · 2 sa" | "≤ HH:MM" says the cuff measured at or before HH:MM, so a correct strip shows a time **equal to or (by the minute's rounding) one minute later than** the monitor's cuff time — never earlier. "Not later" would fail exactly when the strip is right. And ages round UP (`feedHealth.js` `ageParts`, the project's rule), so just past 2 h the dash reads "köhnə · 3 saat" / "eski · 3 sa". | The walk (Task 10, E-1, E-3) checks "equal, or one minute later; never earlier — if earlier, compare the monitor's clock with the board's first", and "köhnə · 3 saat". |

Departures found while implementing go below X45 (X46 …), each with its file and line.

## Open items

Numbered after the G2 slice's O26, so a number names one item across the roadmap.

| # | Item | Owner | When |
|---|---|---|---|
| O27 | An identical re-measurement is not detected: the shown time stays older than the truth (the safe direction). Only decoding the device's own timestamp (spec §7) would see it. | — | Research |
| O28 | After a hub restart, or an outage (X37), NBP is hidden until the bed's next cuff cycle — minutes to an hour. The legend says so. | User (accepted, spec D4) | — |
| O29 | Device→patient links (D9) and the reset on a link change are deferred to Stage B. Until then a bed whose patient changed can show the previous patient's NBP, with its age, until a new measurement or the 2 h limit; whether a Kappa clears NBP on discharge is unknown (Aşama A plan, "It may not be this patient's"). | Stage B | — |
| O30 | The 3 s continuity window (X37) assumes the Kappa sends NBP records — valid or flagged — at least every 3 s (spec §1: "repeats the last NBP in every packet"). Measured nowhere yet; the walk checks it (E-2: a bed that just measured must show its time). If it fails, the window is widened in one constant (`NBP_CONTINUITY_S`) and the bound's slack grows with it. | User + agent (walk) | Deploy |
| O31 | The forwarder's body grows with NBP: 20 064 B for 13 fully reporting devices (measured with the trial's code); the API's 64 KiB cap (`MAX_BODY`) now holds 42 such devices, 59 without NBP. The 100-device design needs the cap raised or the body split — not this slice. | — | Before > 40 devices |
| O32 | The az, ru and en texts (`nbpMeasured`, `nbpWaiting`, `nbpSaid`, `legendNbp`) are the planner's and await a native reading, as every text of this namespace (strings/monitor.js:6–8). | User | Before deploy |
| O33 | A flagged NBP (`***`) never travels: a flagged component carries no change time (X38), so the strip shows the cell old after 15 s, never `***`. The API's `invalid` state for NBP is reachable only from a body this forwarder does not send. | — | — |
| O34 | The research window (`/infinity-research/state`, `api/infinity_research.py:28–30`) allow-lists the hub's keys and drops `changed_at`; the Monitörler screen reads the board, which carries it. No change needed. | — | — |
| O35 | `shadow_check.py`'s `nbp:` line is information, not a criterion: acceptance 4 reads it by eye. | — | — |

---

## Baseline at `14c208d` (measured 2026-10-24)

- **Engine, no database** (`--ignore=tests/test_infinity_vm_pilot.py`, `PYTHONPATH=src`): **2143 passed, 650 skipped, 3 warnings** in 2 min 26 s – 4 min 6 s.
- **Dashboard:** `npx vitest run` → **89 files / 2392 tests**, all passing. `npx vite build` clean, `precache  20 entries`.
- **Postgres:** not needed for this slice — none of its test files reads `TEST_DATABASE_URL` (Task 8, Step 2 checks it again).
- **Python 3.14:** `/c/tmp/g115-py314/Scripts/python.exe` (3.14.5) runs this worktree's tests with `PYTHONPATH=src`.
- **The hub's release at the base** rebuilds as `transport-3940346adc66ca7b` — R3, the release the hub runs: only the two edge files of this slice change it.

## Counts after each task (merged in plan order)

| After | Engine, no DB (passed / skipped) | Dashboard (files / tests) | This task's test files |
|---|---|---|---|
| base | 2143 / 650 | 89 / 2392 | — |
| 1 | 2153 / 650 | — | `test_infinity_live.py` 15 → **25** |
| 2 | — | 89 / 2392 | `strings.test.js` 6 → **6** (it loops; no count moves) |
| 3 | 2176 / 650 | 89 / 2392 | `test_infinity_shadow_store.py` 46 → **65**, `test_infinity_shadow_api.py` 36 → **39**, `test_infinity_shadow_check.py` 17 → **18**, equivalence 3 → **3**, isolation 18 → **18**; `monitor.test.js` 16 → **16**, `SettingsScreen.test.jsx` 12 → **12** |
| 4 | 2178 / 650 | — | `test_infinity_shadow_forwarder.py` 52 → **54** |
| 5 | — | 89 / 2399 | `monitor.test.js` 16 → **23** |
| 6 | — | 89 / 2406 | `MonitorStrip.test.jsx` 28 → **35**; `rawKeys.test.jsx` 7 → **7** |
| 7 | — | 89 / 2406 | `SettingsScreen.test.jsx` 12 → **12** |
| 8 | 2178 / 650 (gate) | 89 / 2406 (gate) | Python 3.14 slice **256** |
| 9 | docs only | — | — |
| 10 | no code | — | — |

Engine arithmetic: 10 + 19 + 3 + 1 + 2 = **35** over the base. Dashboard: 7 + 7 = **14** tests, no new file.

---

## Ground rules for every task

- **Your worktree.** `/c/tmp/inf-nbp`, branch `feat/infinity-nbp` (from `14c208d` = main `03daac4` + the spec; this plan is its next commit). If the controller gives you a parallel worktree branched from this one, every path below reads that worktree instead. **Never touch `/c/Users/User/Desktop/Project/Homunculus AI`** (the user's main checkout) or another `/c/tmp` worktree. Never `git push`, never deploy, never change anything on a VM: Task 10's VM blocks are pasted by the user; the agent runs only the read-only checks that block file marks "ajan". **Never run `git stash`** — the stash is shared with every other worktree and session. If you remove a worktree, unlink its `node_modules` junction first (`cmd //c "rmdir C:\\tmp\\inf-nbp\\dashboard\\node_modules"`), then `git worktree remove --force`: a recursive delete that follows the junction empties the shared install. Never reinstall `node_modules`.
- **Write and Edit tools only — never `sed`, `python`, `node` or a shell heredoc on a repo file.** The tree checks out **CRLF** (`core.autocrlf=true`); every block here is LF. The Edit tool matches either way; a shell replacement fails or rewrites every line end. This slice creates **no** repo file: every change is an **Edit**, and its old text must match exactly once. Each task ends by counting the line ends of the files it touched — `CR` must equal `LF`, and both must be the numbers the task gives (a mismatch means a line end was rewritten or an edit landed twice). For `strings/*.js` (Azerbaijani, Russian, Turkish) run `npx vitest run src/live/i18n/strings.test.js` after editing: it fails if the Cyrillic or the `ə` was mangled. (Files outside the repo — the block file in Task 10 — may be made with any tool.)
- **TDD.** Write the test, run it and **see it red for the reason the task names**, then the code, then green. Put the red in the commit body (`red: 10 failed, 15 passed — KeyError: 'changed_at'`).
- **Stage explicit paths only** (the task's `git add` line). Before every commit run `git status --short` and `git diff --cached --stat`; if a staged path is not one the task lists, or a file you stage holds hunks that are not yours, stop and ask.
- **Commit after every task that changes the repo.** Messages are `type(scope): what, in words` (`feat(edge): …`, `feat(api): …`, `feat(dashboard): …`, `docs(…): …`) and end with:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  ```
  (the trailer the controller set for this plan; if the controller records a newer one by the time you commit, use that.)
- **Foreground gates.** Run every suite and build in the foreground; never background a gate and wait on it (an agent that did sat silent for hours). One Bash call runs at most 10 minutes: name the files; the whole no-DB suite fits (≈ 2½–4 min).
- **Python commands** (always from the engine directory, always `PYTHONPATH=src`, always name files):
  ```bash
  cd /c/tmp/inf-nbp/homunculus-engine
  PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q <files> 2>&1 | tail -3
  ```
  **Never run `tests/test_infinity_vm_pilot.py`** (it hangs), alone or in a bare `pytest tests/`. The whole no-DB suite: the same command with `--ignore=tests/test_infinity_vm_pilot.py` and no file list. **Never set or export `DATABASE_URL`**; this slice needs no `TEST_DATABASE_URL` either. Never print a token, a key or an env file's values.
- **Dashboard commands** run from `/c/tmp/inf-nbp/dashboard`. Filter by file. The suite and the build are **two separate commands**:
  ```bash
  cd /c/tmp/inf-nbp/dashboard
  npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
  ```
  ```bash
  cd /c/tmp/inf-nbp/dashboard
  npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
  ```
  The build must print `built in` and `precache  20 entries`, and no `larger than 500 kB`. A test run may print `Warning: An update to … inside a test was not wrapped in act(...)`; it is not a failure.
- **The dashboard gate** at the end of every dashboard task is the whole suite and the build. **The engine gate** is the task's named files plus its neighbours (each task lists them); Task 8 runs everything.
- **Line-end count** (the files the task names):
  ```bash
  cd /c/tmp/inf-nbp
  for f in <files>; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
  ```
- **No patient data, ever** (CLAUDE.md rule 6). Monitors are 192.0.2.x / 239.20.1.x (TEST-NET-1), beds "B-1", "REA-01 · 2", patients "S-001" / `p1`; every NBP in a test is made up (118/79 (92), 70/40 (50), 201/119 (146) …) and says nothing about anyone. The deploy checks print counts and ages, never a pressure (`shadow_check.py`).
- **Thresholds live only in the API.** The 2-hour limit is `NBP_MAX_MEASURED_AGE_S` in `api/infinity_shadow.py`; the 3 s continuity is the hub's (`infinity_live.py`); the browser compares no value and no age with a number of its own (`monitor.test.js:139–143` forbids `value <`/`>` and risk colours in `monitor.js`). A dashboard test of a withholding hands the browser the server's verdict and asserts it is drawn as given — including one that contradicts what the browser could have worked out (Task 5: "value" three hours after the change is drawn).
- **The strip stays what it is** (`MonitorStrip.jsx:3–13`): dashed, labelled unvalidated, values in `text-ink`, no vital-identity or risk colour, no live region, no focusable element; every number with its age; `sr-only` text inside the positioned `<section>` (X36).
- **Four languages for every key** (`tr` is the source; `az` the default). An `az` text equal to `tr`, and an `ru` text with no Cyrillic, need a reviewed entry in `strings.test.js` (`AZ_SAME_AS_TR`, `NEUTRAL`). Russian calls the engine "система", never "движок".
- **Test names:** `describe` names the thing, `it` is a sentence about its behaviour in the reader's terms.

---

## File map

**Modify — engine** (`homunculus-engine/`)

| File | Change | Task |
|---|---|---|
| `src/homunculus/edge/infinity_live.py` | `NBP`, `NBP_CONTINUITY_S`; `DeviceState.nbp_triple / nbp_changed_at / nbp_heard_at`; `_track_nbp`, `_nbp_changed_at`; the snapshot's `nbp_*` entries carry `changed_at`. | 1 |
| `tests/test_infinity_live.py` | ten tests: first sight, change, repeat, partial, flagged, a lone newer value, outage, the 3.0/3.1 s boundary, a flagged spell. | 1 |
| `src/homunculus/api/infinity_shadow.py` | `SCHEMA_V1`, `SCHEMA` v2, `SCHEMAS`; NBP in `PARAMETERS`; `NBP`, `NBP_PARTS`, `NBP_MAX_MEASURED_AGE_S`; `EVIDENCE["nbp"]`; `_NBP_READING`; `_Held.changed_at`; `_validate` v1/v2; `_judge`; `_nbp_lane`; `devices()` folds; `_nbp_view`. | 3 |
| `tests/test_infinity_shadow_store.py`, `tests/test_infinity_shadow_api.py`, `tests/test_infinity_shadow_check.py`, `tests/test_infinity_shadow_equivalence.py`, `tests/test_infinity_shadow_isolation.py` | v1 still taken; v2 rules; folding; 2 h; the bound 100 × 12; the board's entry; the `nbp:` line; NBP in the equivalence and isolation bodies. | 3 |
| `src/homunculus/edge/infinity_shadow.py` | `SCHEMA` v2; `FORWARDED` + NBP; `thin()` sends NBP only with `changed_at`. | 4 |
| `tests/test_infinity_shadow_forwarder.py` | three NBP tests replace "never NBP"; the end-to-end board carries `nbp`. | 4 |

**Modify — deploy:** `deploy/infinity/shadow_check.py` — `nbp_line()` in `details()` (Task 3); `deploy/infinity/README.md` — R4 (Task 9).

**Modify — dashboard** (`dashboard/src/live/`)

| File | Change | Task |
|---|---|---|
| `i18n/strings/monitor.js` | `p.nbp`; `nbpMeasured`, `nbpWaiting`, `nbpSaid` ×4 (2); `legendNbp` ×4 reworded (7). | 2, 7 |
| `i18n/strings.test.js` | `monitor.p.nbp` in `NEUTRAL` and `AZ_SAME_AS_TR`. | 2 |
| `screens/common/monitor.js` | `PARAM_ORDER` + `nbp`, `EVIDENCE.nbp` (3); `cellOf` → `nbpCellOf`, `lastSeenMs` without NBP (5). | 3, 5 |
| `screens/common/monitor.test.js` | the order (3); NBP's cell, seven tests (5). | 3, 5 |
| `screens/settings/SettingsScreen.test.jsx` | the NBP row (3); the legend's words and the row's evidence (7). | 3, 7 |
| `data/shadow.testutil.js` | `param("nbp", [s, d, m] \| null)`, `NBP_CHANGED_AT`. | 5 |
| `screens/common/MonitorStrip.jsx` | `NbpValue`; the cell spans two columns; "ölçmə gözlənilir". | 6 |
| `screens/common/MonitorStrip.test.jsx` | seven NBP tests; NBP in the colour sweep. | 6 |
| `rawKeys.test.jsx` | NBP in the strip fixture; three anchors. | 6 |

**Modify — docs** (Task 9): `docs/INFINITY-PARAMETER-RECORDS.md`, `deploy/infinity/README.md`, `docs/superpowers/plans/2026-10-15-infinity-asama-a-golge.md`, `docs/homunculus-rehber-TR.md`, `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`.

**Outside the repo** (Tasks 8, 10): `/c/tmp/infinity-a-releases/transport-c1f619bf4e1df375.tar.gz`, `nbp-<short>.bundle`, `NBP-bloklari.template.txt`, `NBP-bloklari.txt`.

**How an edit reads in this plan:** a bold **Edit** with the file's path and "replace:", a fenced block with the exact old text, "with:", and a fenced block with the new text. Use the Edit tool with those two texts, in the order given; each old text is unique in its file at that moment (the replay checked it). Task 10's two record edits say "(its new text from the run)": their new text is the deploy's own output.

---

### Task 0: The worktree, the shared install and the baseline

Nothing is changed in the repo. The point is to know, before Task 1, that the tree is the plan's and that both suites are green with the numbers the counts table starts from.

**Files:** none in the repo; a junction `dashboard/node_modules` → `C:\tmp\homunculus-g1\dashboard\node_modules` (ignored by `dashboard/.gitignore`).

- [ ] **Step 1: The tree is the plan's**

```bash
cd /c/tmp/inf-nbp
git branch --show-current
git status --short
git log --oneline -3
```

Expected: `feat/infinity-nbp`; no status line; the top commit is this plan (`docs(plan): Infinity shadow lane — NBP …`), then `14c208d docs(spec): Infinity shadow lane — NBP on the monitor strip with the time its value last changed (design, for review)`, then `03daac4 docs(plan): Group 2 slice 1 — …`. Anything else: stop and ask.

- [ ] **Step 2: The shared install, by junction (never reinstall)**

```bash
cd /c/tmp/inf-nbp
test -e dashboard/node_modules || cmd //c "mklink /J C:\\tmp\\inf-nbp\\dashboard\\node_modules C:\\tmp\\homunculus-g1\\dashboard\\node_modules"
ls dashboard/node_modules/.bin/vitest && git status --short
```

Expected: `Junction created for C:\tmp\inf-nbp\dashboard\node_modules <<===>> C:\tmp\homunculus-g1\dashboard\node_modules` (or nothing, if it was already there), then the `vitest` path, and still no status line. In Git Bash `cmd` needs `//c` and doubled backslashes; from PowerShell the same is `cmd /c mklink /J C:\tmp\inf-nbp\dashboard\node_modules C:\tmp\homunculus-g1\dashboard\node_modules`.

- [ ] **Step 3: The engine, no database**

```bash
cd /c/tmp/inf-nbp/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -1
```

Expected (≈ 2½–4 min): `2143 passed, 650 skipped, 3 warnings in …`.

- [ ] **Step 4: The dashboard suite and build**

```bash
cd /c/tmp/inf-nbp/dashboard
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
```

Expected: ` Test Files  89 passed (89)` and `      Tests  2392 passed (2392)`.

```bash
cd /c/tmp/inf-nbp/dashboard
npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
```

Expected: `✓ built in …` and `precache  20 entries (… KiB)`; no `larger than`. (`dist/` is ignored.)

- [ ] **Step 5: The test files this slice touches, and that none needs a database**

```bash
cd /c/tmp/inf-nbp/homunculus-engine
for f in test_infinity_live test_infinity_shadow_forwarder test_infinity_shadow_store test_infinity_shadow_api test_infinity_shadow_check test_infinity_shadow_equivalence test_infinity_shadow_isolation; do printf "%s " $f; PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q --co tests/$f.py 2>&1 | tail -1; done
grep -ln "TEST_DATABASE_URL\|postgres" tests/test_infinity_live.py tests/test_infinity_shadow_*.py
```

Expected: `15`, `52`, `46`, `36`, `17`, `3`, `18` `tests collected`; the `grep` prints nothing.

No commit: Task 0 changes nothing in the repo.

---

### Task 1: The hub keeps the time each device's NBP last changed

Spec D1–D4, §4.1, with X37 and X38. Everything happens in the hub's live view, in memory: per device, the last complete valid NBP triple, the receipt time of the packet in which it **changed** (`nbp_changed_at`), and the last packet that carried any NBP record at all (`nbp_heard_at`). The snapshot's three `nbp_*` entries gain `changed_at` (a float, or `None` for "not known"); nothing else in the snapshot changes, and the forwarder does not read it yet (Task 4).

The rules, each held by a test below:
- the first triple seen after a start is held with **no** time (it may be hours old);
- a different complete valid triple in one packet is a change, stamped with that packet's `received_at` — **if** the device's NBP was heard within 3 s before (X37); after a longer gap the new triple is held with no time;
- the same triple repeated is nothing (an identical re-measurement is not detected: the time stays older than the truth);
- a packet missing a component, or carrying one the device flags, neither counts nor clears the triple held;
- an entry whose value is not the held triple's component (a partial packet's newer value) carries no time (X38);
- a packet dropped as old (≥ 3 s) or already delivered changes nothing (it never reaches `_track_nbp`).

**Files:**
- Modify: `homunculus-engine/tests/test_infinity_live.py` (appended after the last test)
- Modify: `homunculus-engine/src/homunculus/edge/infinity_live.py` (constants after `HISTORY_INTERVAL`, `DeviceState`, after the loop in `_consume_one`, the snapshot's parameter entry)

- [ ] **Step 1: Write the failing tests**

**Edit** `homunculus-engine/tests/test_infinity_live.py` — replace:
```python
    entry = device(view.snapshot())["parameters"]["hr"]
    assert entry["value"] is None and entry["status"] == "stale"
    assert entry["history"] == [[1000., 70]]
```
with:
```python
    entry = device(view.snapshot())["parameters"]["hr"]
    assert entry["value"] is None and entry["status"] == "stale"
    assert entry["history"] == [[1000., 70]]


# --- NBP: the time its value last changed ----------------------------------------------------------
#
# The monitor repeats its last NBP in every packet as a valid record, so a packet's age says nothing
# about the cuff. The hub keeps, per device, the last complete valid (systolic, diastolic, mean) and
# the receipt time of the packet in which it CHANGED: a measurement happened at or before then. A
# triple seen first after a start has no time at all — it may be hours old.

NBP_SYS, NBP_DIA, NBP_MEAN = 0x1E08, 0x1E07, 0x1E09
NBP_NAMES = ("nbp_systolic", "nbp_diastolic", "nbp_mean")


def nbp(systolic, diastolic, mean, *, valid=(True, True, True)):
    return (record(NBP_SYS, systolic, valid=valid[0]) + record(NBP_DIA, diastolic, valid=valid[1])
            + record(NBP_MEAN, mean, valid=valid[2]))


def changed_at(view, index=0):
    parameters = device(view.snapshot(), index)["parameters"]
    return {name: parameters[name]["changed_at"] for name in NBP_NAMES if name in parameters}


def test_an_nbp_seen_first_after_a_start_has_no_change_time():
    now = [1000.]
    view = LiveResearchView(inventory(), clock=lambda: now[0], monotonic=lambda: now[0])
    view.consume([event(1000., PAYLOAD + nbp(120, 80, 93))])
    parameters = device(view.snapshot())["parameters"]
    assert (parameters["nbp_systolic"]["value"], parameters["nbp_systolic"]["status"]) == (120, "candidate")
    assert changed_at(view) == dict.fromkeys(NBP_NAMES)          # unknown, never "now"
    assert "changed_at" not in parameters["hr"] and "changed_at" not in parameters["spo2"]


def test_a_changed_triple_is_stamped_with_the_packet_that_showed_it():
    now = [1000.]
    view = LiveResearchView(inventory(), clock=lambda: now[0], monotonic=lambda: now[0])
    view.consume([event(1000., nbp(120, 80, 93))])
    now[0] = 1001.5
    view.consume([event(1001.5, nbp(118, 79, 92))])
    assert changed_at(view) == dict.fromkeys(NBP_NAMES, 1001.5)
    assert device(view.snapshot())["parameters"]["nbp_systolic"]["value"] == 118


def test_the_same_triple_repeated_keeps_the_older_time():
    # Every packet repeats the last NBP. An identical re-measurement looks the same and is not
    # detected either: the time stays older than the truth, never newer.
    now = [1000.]
    view = LiveResearchView(inventory(), clock=lambda: now[0], monotonic=lambda: now[0])
    view.consume([event(1000., nbp(120, 80, 93))])
    now[0] = 1001.
    view.consume([event(1001., nbp(118, 79, 92))])
    for stamp in (1002., 1003., 1004.):
        now[0] = stamp
        view.consume([event(stamp, nbp(118, 79, 92))])
    assert changed_at(view) == dict.fromkeys(NBP_NAMES, 1001.)
    assert device(view.snapshot())["parameters"]["nbp_mean"]["capture_epoch"] == 1004.


def test_a_packet_with_two_of_the_three_neither_counts_nor_replaces_the_triple():
    now = [1000.]
    view = LiveResearchView(inventory(), clock=lambda: now[0], monotonic=lambda: now[0])
    view.consume([event(1000., nbp(120, 80, 93))])
    now[0] = 1001.
    view.consume([event(1001., record(NBP_DIA, 70) + record(NBP_MEAN, 85))])     # no systolic
    assert changed_at(view) == dict.fromkeys(NBP_NAMES)
    now[0] = 1002.
    view.consume([event(1002., nbp(120, 80, 93))])       # the triple held is still the first one
    assert changed_at(view) == dict.fromkeys(NBP_NAMES)


def test_an_invalid_component_neither_counts_nor_clears():
    now = [1000.]
    view = LiveResearchView(inventory(), clock=lambda: now[0], monotonic=lambda: now[0])
    view.consume([event(1000., nbp(120, 80, 93))])
    now[0] = 1001.
    view.consume([event(1001., nbp(118, 79, 92))])
    now[0] = 1002.
    view.consume([event(1002., nbp(118, 4, 92, valid=(True, False, True)))])     # the monitor shows *** once
    assert changed_at(view) == dict.fromkeys(NBP_NAMES, 1001.)
    now[0] = 1003.
    view.consume([event(1003., nbp(118, 79, 92))])
    assert changed_at(view) == dict.fromkeys(NBP_NAMES, 1001.)


def test_a_newer_value_carried_without_its_triple_has_no_change_time():
    # A partial packet updates the research view's value; the time of the triple it is not part
    # of must not be lent to it, or a newer value would read as measured at the older time.
    now = [1000.]
    view = LiveResearchView(inventory(), clock=lambda: now[0], monotonic=lambda: now[0])
    view.consume([event(1000., nbp(120, 80, 93))])
    now[0] = 1001.
    view.consume([event(1001., nbp(118, 79, 92))])
    now[0] = 1002.
    view.consume([event(1002., record(NBP_SYS, 105))])
    assert device(view.snapshot())["parameters"]["nbp_systolic"]["value"] == 105
    assert changed_at(view) == {"nbp_systolic": None, "nbp_diastolic": 1001., "nbp_mean": 1001.}


def test_a_change_seen_only_after_an_outage_has_no_time():
    # It may have happened at any moment of the outage. Stamped with the first packet after it, a
    # measurement as old as the outage would read as minutes old: hidden instead until the next
    # change seen as it happens, as after a hub restart.
    now, tick = [1000.], [0.]
    view = LiveResearchView(inventory(), clock=lambda: now[0], monotonic=lambda: tick[0])
    view.consume([event(1000., nbp(120, 80, 93))])
    now[0], tick[0] = 1001., 1.
    view.consume([event(1001., nbp(118, 79, 92))])
    now[0], tick[0] = 1600., 600.
    view.consume([event(1300., nbp(140, 90, 107)), event(1597., nbp(140, 90, 107))])   # the outbox's backlog
    view.consume([event(1001., nbp(150, 95, 113))])                                   # one already delivered
    assert changed_at(view) == dict.fromkeys(NBP_NAMES, 1001.)       # a packet 3 s old or older changes nothing
    assert view.snapshot()["old_or_duplicate_packets"] == 3
    view.consume([event(1599.2, nbp(140, 90, 107))])                 # the first live packet: changed, but when?
    assert changed_at(view) == dict.fromkeys(NBP_NAMES)
    now[0], tick[0] = 1601., 601.
    view.consume([event(1600.4, nbp(141, 90, 107))])                 # the next change, seen as it happens
    assert changed_at(view) == dict.fromkeys(NBP_NAMES, 1600.4)


@pytest.mark.parametrize(("gap", "stamped"), [(3.0, True), (3.1, False)])
def test_a_change_keeps_its_time_only_if_the_monitor_sent_nbp_within_the_last_3_s(gap, stamped):
    now = [1000.]
    view = LiveResearchView(inventory(), clock=lambda: now[0], monotonic=lambda: now[0])
    view.consume([event(1000., PAYLOAD + nbp(120, 80, 93))])
    now[0] = 1001.
    view.consume([event(1001., PAYLOAD + nbp(118, 79, 92))])
    now[0] = 1002.
    view.consume([event(1002., PAYLOAD)])                            # HR and SpO₂ go on; no NBP record
    now[0] = 1001. + gap
    view.consume([event(1001. + gap, PAYLOAD + nbp(131, 85, 100))])
    assert changed_at(view) == dict.fromkeys(NBP_NAMES, 1001. + gap if stamped else None)


def test_a_result_after_a_spell_of_stars_keeps_its_time_while_the_monitor_kept_sending_nbp():
    # The monitor may flag its NBP while the cuff inflates; it keeps sending the records, so the
    # result is seen as it appears.
    now = [1000.]
    view = LiveResearchView(inventory(), clock=lambda: now[0], monotonic=lambda: now[0])
    view.consume([event(1000., nbp(120, 80, 93))])
    for second in range(1, 40):
        now[0] = 1000. + second
        view.consume([event(now[0], nbp(1, 1, 1, valid=(False, False, False)))])
    now[0] = 1040.
    view.consume([event(1040., nbp(131, 85, 100))])
    assert changed_at(view) == dict.fromkeys(NBP_NAMES, 1040.)
```

The records are the decoder's own test builder (`tests/test_infinity_records.py:12–21`); `0x1E07/08/09` are `nbp_diastolic/systolic/mean` in `edge/infinity_records.py:47–49`. A 3.0 s gap is exactly representable (`1004.0 − 1001.0`), so the boundary is `<=`.

- [ ] **Step 2: Run them and see them fail for the right reason**

```bash
cd /c/tmp/inf-nbp/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_infinity_live.py 2>&1 | grep -E "^E  |passed|failed" | sort | uniq -c
```

Expected:
```
      1 10 failed, 15 passed, 1 warning in …
     10 E       KeyError: 'changed_at'
```

- [ ] **Step 3: The constants and the device's NBP state**

**Edit** `homunculus-engine/src/homunculus/edge/infinity_live.py` — replace:
```python
HISTORY_SECONDS = 180.0
HISTORY_INTERVAL = 1.0


class DeviceState:
    def __init__(self):
        self.parameters = {}
        self.history = {}
        self.last_epoch = None
        self.last_arrival = None
        self.unsupported = False
        self.packets = 0
```
with:
```python
HISTORY_SECONDS = 180.0
HISTORY_INTERVAL = 1.0
# The monitor repeats its last NBP in every packet as a valid record, and the device's own
# timestamp is not decoded, so a packet's age says nothing about when the cuff measured. What the
# hub can know is when the (systolic, diastolic, mean) triple last CHANGED: a measurement happened
# at or before that packet. That time is an upper bound of the measurement; an identical
# re-measurement is not seen and leaves it older, the safe direction. A change keeps its time only
# when the device's NBP was heard within NBP_CONTINUITY_S before it: after a gap (an outage, a
# monitor off the network) it may have happened at any moment of the gap, and stamping it with the
# first packet after the gap would make an old measurement read as fresh.
NBP = ("nbp_systolic", "nbp_diastolic", "nbp_mean")
NBP_CONTINUITY_S = STALE_AFTER_MS / 1000.0


class DeviceState:
    def __init__(self):
        self.parameters = {}
        self.history = {}
        self.last_epoch = None
        self.last_arrival = None
        self.unsupported = False
        self.packets = 0
        # The last complete valid NBP triple, and the receipt time of the packet in which it
        # changed. None until a change has been seen since this process started: a triple first
        # seen after a start may be hours old (or another patient's), so its time is unknown.
        # `nbp_heard_at` is the last packet that carried any NBP record, valid or flagged.
        self.nbp_triple = None
        self.nbp_changed_at = None
        self.nbp_heard_at = None
```

- [ ] **Step 4: Track the change in every accepted packet**

`_consume_one` has already dropped an old or duplicate packet (`infinity_live.py:64`) and a replay or undecodable one before this point, so only live, decoded packets reach `_track_nbp`.

**Edit** `homunculus-engine/src/homunculus/edge/infinity_live.py` — replace:
```python
            state.parameters[name] = dict(record, epoch=epoch, arrival=state.last_arrival,
                                          delay=now - epoch)
            if record["valid"]:
                self._remember(state, name, epoch, record["value"])
```
with:
```python
            state.parameters[name] = dict(record, epoch=epoch, arrival=state.last_arrival,
                                          delay=now - epoch)
            if record["valid"]:
                self._remember(state, name, epoch, record["value"])
        self._track_nbp(state, decoded, epoch)

    @staticmethod
    def _track_nbp(state, decoded, epoch):
        """A change of this packet's own complete, valid NBP triple stamps it with the packet's
        receipt time — if the device's NBP was heard within NBP_CONTINUITY_S before it; after a gap
        the change has no time. A packet missing a component, or carrying one the device flags
        invalid, neither counts as a change nor clears the triple held; the first triple seen is
        held with no time."""
        if not any(name in decoded for name in NBP):
            return
        heard, state.nbp_heard_at = state.nbp_heard_at, epoch
        records = [decoded.get(name) for name in NBP]
        if not all(record is not None and record["valid"] for record in records):
            return
        triple = tuple(record["value"] for record in records)
        if state.nbp_triple is not None and triple != state.nbp_triple:
            seen_as_it_happened = heard is not None and epoch - heard <= NBP_CONTINUITY_S
            state.nbp_changed_at = epoch if seen_as_it_happened else None
        state.nbp_triple = triple

    @staticmethod
    def _nbp_changed_at(state, name, record):
        """The change time an NBP entry may carry: the triple's, and only while the entry still
        holds that triple's component. A newer value a partial packet brought alone has none."""
        if state.nbp_changed_at is None or not record["valid"]:
            return None
        return state.nbp_changed_at if record["value"] == state.nbp_triple[NBP.index(name)] else None
```

- [ ] **Step 5: The snapshot's NBP entries carry the time**

**Edit** `homunculus-engine/src/homunculus/edge/infinity_live.py` — replace:
```python
                        "history": [[stamp, sample] for stamp, sample
                                    in state.history.get(name, ())],
                    }
```
with:
```python
                        "history": [[stamp, sample] for stamp, sample
                                    in state.history.get(name, ())],
                    }
                    if name in NBP:
                        # When the value last changed (receipt time), or None: not known.
                        parameters[name]["changed_at"] = self._nbp_changed_at(state, name, record)
```

- [ ] **Step 6: Green, and the neighbours**

```bash
cd /c/tmp/inf-nbp/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_infinity_live.py 2>&1 | tail -1
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_infinity_live.py tests/test_infinity_records.py tests/test_infinity_shadow_forwarder.py tests/test_infinity_research_api.py tests/test_infinity_preview.py 2>&1 | tail -1
```

Expected: `25 passed, 1 warning in …`; then `109 passed, 3 warnings in …` (the forwarder still sends no NBP: it reads `changed_at` from Task 4 on).

- [ ] **Step 7: Line ends**

```bash
cd /c/tmp/inf-nbp
for f in homunculus-engine/src/homunculus/edge/infinity_live.py homunculus-engine/tests/test_infinity_live.py; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected: `infinity_live.py CR=215 LF=215`, `test_infinity_live.py CR=379 LF=379`.

- [ ] **Step 8: Commit**

```bash
cd /c/tmp/inf-nbp
git add homunculus-engine/src/homunculus/edge/infinity_live.py homunculus-engine/tests/test_infinity_live.py
git status --short && git diff --cached --stat
git commit -q -F - <<'MSG'
feat(edge): the live view keeps the time each device's NBP last changed

The monitor repeats its last NBP in every packet, so a packet's age says
nothing about the cuff. Per device the hub now holds the last complete valid
(systolic, diastolic, mean) and the receipt time of the packet in which it
changed: an upper bound of the measurement. The first triple after a start has
no time, and neither has a change seen only after the device's NBP went unheard
for more than 3 s — it may have happened at any moment of the gap (X37). A
partial or flagged packet neither counts nor clears; an entry whose value is
not the held triple's carries no time (X38). The snapshot's nbp_* entries carry
changed_at; the forwarder does not read it yet.

red: 10 failed, 15 passed — KeyError: 'changed_at' (tests/test_infinity_live.py)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
git log --oneline -1
```

---

### Task 2: The strip's NBP words, in four languages

Spec §5 (strings), with X42. Additive only: the monitor's own label `p.nbp` and three keys a later task draws — `nbpMeasured` (the visible "ölçmə ≤ {time} ({age})"), `nbpWaiting` ("ölçmə gözlənilir") and `nbpSaid` (the screen reader's sentence). Nothing renders them yet, and nothing else changes; `legendNbp` is reworded in Task 7, together with the test that quotes it. Before anything renders, the reviewed lists in `strings.test.js` learn that `NBP` is the monitor's label in every language (neutral, and the same in az and tr).

The az texts say "ölçmə", as the rest of the az namespace does (X42); all az/ru/en texts await a native reading (O32).

**Files:**
- Modify: `dashboard/src/live/i18n/strings.test.js` (`NEUTRAL` at 44–46, `AZ_SAME_AS_TR` at 137–139)
- Modify: `dashboard/src/live/i18n/strings/monitor.js` (the header's last lines and `p`, 18–23; one block after `age:` in each language, 52–53, 118–119, 184–185, 250–251)

- [ ] **Step 1: The reviewed lists name the new label**

**Edit** `dashboard/src/live/i18n/strings.test.js` — replace:
```js
  // Aşama A (monitor) · neutral — the bedside monitor's own labels, so the strip reads against its screen
  "monitor.p.hr", "monitor.p.pls", "monitor.p.spo2", "monitor.p.etco2", "monitor.p.temperature",
  "monitor.p.art_systolic", "monitor.p.art_diastolic", "monitor.p.art_mean", "monitor.p.respiration",
```
with:
```js
  // Aşama A (monitor) · neutral — the bedside monitor's own labels, so the strip reads against its screen
  "monitor.p.hr", "monitor.p.pls", "monitor.p.spo2", "monitor.p.etco2", "monitor.p.temperature",
  "monitor.p.art_systolic", "monitor.p.art_diastolic", "monitor.p.art_mean", "monitor.p.respiration",
  "monitor.p.nbp", //              NBP — the Kappa's own label for the cuff pressure
```

**Edit** `dashboard/src/live/i18n/strings.test.js` — replace:
```js
  // Aşama A (monitor) · az = tr — the bedside monitor's own labels (HR, PLS, SpO₂, ART S…), not words
  "monitor.p.hr", "monitor.p.pls", "monitor.p.spo2", "monitor.p.etco2", "monitor.p.temperature",
  "monitor.p.art_systolic", "monitor.p.art_diastolic", "monitor.p.art_mean", "monitor.p.respiration",
```
with:
```js
  // Aşama A (monitor) · az = tr — the bedside monitor's own labels (HR, PLS, SpO₂, ART S…), not words
  "monitor.p.hr", "monitor.p.pls", "monitor.p.spo2", "monitor.p.etco2", "monitor.p.temperature",
  "monitor.p.art_systolic", "monitor.p.art_diastolic", "monitor.p.art_mean", "monitor.p.respiration",
  "monitor.p.nbp", //        NBP — the monitor's label, not a word
```

- [ ] **Step 2: See it fail — the list names a key that does not exist yet**

```bash
cd /c/tmp/inf-nbp/dashboard
npx vitest run src/live/i18n/strings.test.js 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ +Tests |^ +→ "
```

Expected:
```
     → monitor.p.nbp is listed but no longer exists: expected false to be true // Object.is equality
      Tests  1 failed | 5 passed (6)
```

- [ ] **Step 3: The label and the three keys, four languages**

**Edit** `dashboard/src/live/i18n/strings/monitor.js` — replace:
```js
// docs/INFINITY-PARAMETER-RECORDS.md:36-50 — no sample count is recorded for any, and `legendN`
// says so.
const p = {
  hr: "HR", pls: "PLS", spo2: "SpO₂", etco2: "etCO₂", temperature: "Ta",
  art_systolic: "ART S", art_diastolic: "ART D", art_mean: "ART M", respiration: "RESP",
};
```
with:
```js
// docs/INFINITY-PARAMETER-RECORDS.md:36-50 — no sample count is recorded for any, and `legendN`
// says so. NBP is shown with the time its value last CHANGED, an upper bound of the measurement
// (`nbpMeasured`: "≤", never "at"); before a change has been seen it says it awaits one
// (`nbpWaiting`).
const p = {
  hr: "HR", pls: "PLS", spo2: "SpO₂", etco2: "etCO₂", temperature: "Ta",
  art_systolic: "ART S", art_diastolic: "ART D", art_mean: "ART M", respiration: "RESP", nbp: "NBP",
};
```

**Edit** `dashboard/src/live/i18n/strings/monitor.js` — replace:
```js
    old: "eski · {age}",
    age: "{age} önce",
```
with:
```js
    old: "eski · {age}",
    age: "{age} önce",
    nbpMeasured: "ölçüm ≤ {time} ({age})",
    nbpWaiting: "ölçüm bekleniyor",
    nbpSaid: "{systolic} bölü {diastolic}, ortalama {mean} {unit}; ölçüm {time} ya da daha önce, {age} önce",
```

**Edit** `dashboard/src/live/i18n/strings/monitor.js` — replace:
```js
    old: "köhnə · {age}",
    age: "{age} əvvəl",
```
with:
```js
    old: "köhnə · {age}",
    age: "{age} əvvəl",
    nbpMeasured: "ölçmə ≤ {time} ({age})",
    nbpWaiting: "ölçmə gözlənilir",
    nbpSaid: "{systolic} bölü {diastolic}, orta {mean} {unit}; ölçmə {time} və ya daha əvvəl, {age} əvvəl",
```

**Edit** `dashboard/src/live/i18n/strings/monitor.js` — replace:
```js
    old: "устарело · {age}",
    age: "{age} назад",
```
with:
```js
    old: "устарело · {age}",
    age: "{age} назад",
    nbpMeasured: "измерение ≤ {time} ({age})",
    nbpWaiting: "ожидается измерение",
    nbpSaid: "{systolic} на {diastolic}, среднее {mean} {unit}; измерено в {time} или раньше, {age} назад",
```

**Edit** `dashboard/src/live/i18n/strings/monitor.js` — replace:
```js
    old: "old · {age}",
    age: "{age} ago",
```
with:
```js
    old: "old · {age}",
    age: "{age} ago",
    nbpMeasured: "measured ≤ {time} ({age})",
    nbpWaiting: "awaiting a measurement",
    nbpSaid: "{systolic} over {diastolic}, mean {mean} {unit}; measured at or before {time}, {age} ago",
```

`{time}` is `hhmm` of the change, `{age}` the board's own age words (`board.ageS/M/H`, rounded up), `{unit}` the board's unit text (`board.unitMmhg`: "mmHg", ru "мм рт. ст."). The placeholders are the same in all four languages (the strings test checks it).

- [ ] **Step 4: Green, then the dashboard gate**

```bash
cd /c/tmp/inf-nbp/dashboard
npx vitest run src/live/i18n/strings.test.js 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ +Tests "
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
```

Expected: `Tests  6 passed (6)`; then ` Test Files  89 passed (89)` and `      Tests  2392 passed (2392)`.

```bash
cd /c/tmp/inf-nbp/dashboard
npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
```

Expected: `✓ built in …`, `precache  20 entries (…)`.

- [ ] **Step 5: Line ends**

```bash
cd /c/tmp/inf-nbp
for f in dashboard/src/live/i18n/strings.test.js dashboard/src/live/i18n/strings/monitor.js; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected: `strings.test.js CR=203 LF=203`, `strings/monitor.js CR=304 LF=304`.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/inf-nbp
git add dashboard/src/live/i18n/strings.test.js dashboard/src/live/i18n/strings/monitor.js
git status --short && git diff --cached --stat
git commit -q -F - <<'MSG'
feat(dashboard): the strip's NBP words in four languages

The monitor's own label (NBP, neutral and az = tr, reviewed in both lists) and
the three texts the NBP cell will draw: "ölçmə ≤ {time} ({age})" — a bound,
never "at" —, "ölçmə gözlənilir" before a change has been seen, and the screen
reader's sentence. az says "ölçmə" as the rest of its namespace does (X42); the
az, ru and en texts await a native reading (O32). Nothing renders them yet.

red: 1 failed, 5 passed — "monitor.p.nbp is listed but no longer exists" (src/live/i18n/strings.test.js)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
git log --oneline -1
```

---

### Task 3: The API takes v1 and v2, shows NBP as one entry and withholds it two hours after it changed

Spec D5–D7, §4.3, with X38–X40, and X43 for why the dashboard's two tables land here. The store learns schema v2 (v1 is still taken: the hub keeps sending it until Task 4's code reaches the VM); an NBP reading must carry `changed_at` and nothing else may; the three held NBP readings fold into one board entry `nbp`, a number only when all three are held with one change time, fresh and valid, and the change is at most 2 h old. The entry exists for a device that holds a reading, while the hub speaks v2 or NBP readings are still held (X39). `shadow_check.py` prints one `nbp:` line. The dashboard's copy of the API's tables gains `nbp` in the same commit, because `monitor.test.js:126–137` holds the two equal; the Settings legend's table then shows an NBP row by itself (it iterates `PARAM_ORDER`), and its test lists it.

The folded entry, as `GET /infinity-shadow/board` carries it in `parameters` (after every other parameter):

```json
{"parameter": "nbp", "state": "value", "systolic": 118, "diastolic": 79, "mean": 92, "unit": "mmHg",
 "age_s": 2.4, "last_at": "<the packet, ISO>", "changed_at": "<the change, ISO>", "measured_age_s": 756.0,
 "evidence": "screen_match", "partial": false}
```

`state` is `"value"`, `"invalid"` (a component flagged: the monitor's `***`) or `"old"`; `"old"` with `changed_at: null` is "no change seen yet". While shown, `age_s`/`last_at` are the packet's (the 15 s rule); once withheld they are the change's, so the strip's "köhnə · N" is the measurement's age (X40).

**Files:**
- Modify: `homunculus-engine/tests/test_infinity_shadow_store.py`, `tests/test_infinity_shadow_api.py`, `tests/test_infinity_shadow_check.py`, `tests/test_infinity_shadow_equivalence.py`, `tests/test_infinity_shadow_isolation.py`
- Modify: `homunculus-engine/src/homunculus/api/infinity_shadow.py` (the wire tables 88–105 and 118–122, `DeviceView`, `_Held`, `_validate`, `ShadowStore.__init__`/`ingest`/`devices`/`_judge`, a new `_nbp_view`, `board_view`'s docstring)
- Modify: `deploy/infinity/shadow_check.py` (`import math`; `nbp_line()` and `details()`)
- Modify: `dashboard/src/live/screens/common/monitor.test.js` (116–119), `dashboard/src/live/screens/settings/SettingsScreen.test.jsx` (164–165), `dashboard/src/live/screens/common/monitor.js` (13–15, 23)

`api/app.py` does not change: both routes hand the body to the store and return `board_view` as it is. `MAX_READINGS` stays 16 (9 + 3 = 12 per device; the bound test sends 12), `MAX_BODY` stays 64 KiB (O31).

- [ ] **Step 1: The store's tests**

**Edit** `homunculus-engine/tests/test_infinity_shadow_store.py` — replace:
```python
The wire format is `homunculus.infinity-shadow.v1` (the hub forwarder's body). A body that breaks
the schema is refused whole; a reading that is well-formed but cannot be shown (too old, from the
future, the wrong unit, outside the record's integrity bounds, an unknown or excluded parameter,
not newer than the one held) is rejected and counted. Synthetic sources only (192.0.2.x).
"""
from __future__ import annotations

import copy
import inspect
import math

import pytest

from homunculus.api.infinity_shadow import (
    DISPLAY_MAX_AGE_S, EVIDENCE, FORGET_AFTER_S, LAG_BUCKETS_MS, PARAMETERS, PARTIAL, SCHEMA,
    ShadowRejected, ShadowStore, TooSoon,
)

T0 = 1_800_000_000.0


class Clock:
    def __init__(self, t=T0):
        self.t = t

    def __call__(self):
        return self.t


def reading(parameter="hr", value=72, unit="bpm", *, valid=True, captured_at=T0 - 0.5):
    return {"parameter": parameter, "value": value if valid else None, "unit": unit, "valid": valid,
            "captured_at": captured_at}


def device(source="192.0.2.10", *readings, status="streaming", packet_age_ms=100.0, group=None):
    last = source.rsplit(".", 1)[1]
    return {"source": source, "group": group or f"239.20.1.{last}", "port": 2050, "status": status,
            "packet_age_ms": packet_age_ms, "readings": list(readings)}


def body(*devices, sent_at=T0, collector_age_s=1.0, sent=10, failed=0):
    return {"schema": SCHEMA, "sent_at": sent_at,
            "forwarder": {"interval_s": 5, "sent": sent, "failed": failed,
                          "decoder": "homunculus.infinity-preview.v3"},
            "hub": {"collector_age_s": collector_age_s, "accepted_packets": 100,
                    "old_or_duplicate_packets": 2},
            "devices": list(devices)}


def _params(store, source="192.0.2.10", now=None):
    return {p["parameter"]: p for p in store.devices(now)[source].parameters}


# --- the parameter table -------------------------------------------------------------------------

def test_the_parameter_table_excludes_nbp_and_airway_respiration():
    assert not any(name.startswith("nbp_") for name in PARAMETERS)
    assert "respiration_airway" not in PARAMETERS
    assert set(EVIDENCE) == set(PARAMETERS) and PARTIAL < set(PARAMETERS)
    assert all(low == 0 for _, low, _ in PARAMETERS.values())          # 0 is inside every bound
```
with:
```python
The wire format is `homunculus.infinity-shadow.v2` (the hub forwarder's body; v1, the R3 hub's, is
still taken). A body that breaks the schema is refused whole; a reading that is well-formed but
cannot be shown (too old, from the future, the wrong unit, outside the record's integrity bounds, an
unknown or excluded parameter, not newer than the one held) is rejected and counted. NBP travels as
three readings with the time their value last changed and is shown as one entry. Synthetic sources
only (192.0.2.x).
"""
from __future__ import annotations

import copy
import inspect
import math
from datetime import datetime, timezone

import pytest

from homunculus.api.infinity_shadow import (
    DISPLAY_MAX_AGE_S, EVIDENCE, FORGET_AFTER_S, LAG_BUCKETS_MS, NBP, NBP_MAX_MEASURED_AGE_S, NBP_PARTS,
    PARAMETERS, PARTIAL, SCHEMA, SCHEMA_V1, ShadowRejected, ShadowStore, TooSoon,
)

T0 = 1_800_000_000.0


class Clock:
    def __init__(self, t=T0):
        self.t = t

    def __call__(self):
        return self.t


def reading(parameter="hr", value=72, unit="bpm", *, valid=True, captured_at=T0 - 0.5, changed_at=None):
    out = {"parameter": parameter, "value": value if valid else None, "unit": unit, "valid": valid,
           "captured_at": captured_at}
    if changed_at is not None:
        out["changed_at"] = changed_at
    return out


def nbp(systolic=118, diastolic=79, mean=92, *, captured_at=T0 - 0.5, changed_at=T0 - 600.0):
    """The forwarder's three NBP readings: one packet, one change time."""
    return [reading(name, value, "mmHg", captured_at=captured_at, changed_at=changed_at)
            for name, value in zip(NBP_PARTS, (systolic, diastolic, mean))]


def device(source="192.0.2.10", *readings, status="streaming", packet_age_ms=100.0, group=None):
    last = source.rsplit(".", 1)[1]
    return {"source": source, "group": group or f"239.20.1.{last}", "port": 2050, "status": status,
            "packet_age_ms": packet_age_ms, "readings": list(readings)}


def body(*devices, sent_at=T0, collector_age_s=1.0, sent=10, failed=0, schema=SCHEMA):
    return {"schema": schema, "sent_at": sent_at,
            "forwarder": {"interval_s": 5, "sent": sent, "failed": failed,
                          "decoder": "homunculus.infinity-preview.v3"},
            "hub": {"collector_age_s": collector_age_s, "accepted_packets": 100,
                    "old_or_duplicate_packets": 2},
            "devices": list(devices)}


def _params(store, source="192.0.2.10", now=None):
    return {p["parameter"]: p for p in store.devices(now)[source].parameters}


def _iso(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat()


# --- the parameter table -------------------------------------------------------------------------

def test_the_parameter_table_takes_nbp_with_its_change_time_and_still_excludes_airway_respiration():
    assert NBP_PARTS == ("nbp_systolic", "nbp_diastolic", "nbp_mean")
    assert all(PARAMETERS[name] == ("mmHg", 0, 400) for name in NBP_PARTS)
    assert "respiration_airway" not in PARAMETERS
    # The board shows the three as ONE entry, `nbp`; the evidence table names what the board shows.
    assert set(EVIDENCE) == (set(PARAMETERS) - set(NBP_PARTS)) | {NBP}
    assert EVIDENCE[NBP] == "screen_match" and NBP not in PARTIAL and PARTIAL < set(EVIDENCE)
    assert all(low == 0 for _, low, _ in PARAMETERS.values())          # 0 is inside every bound
    assert NBP_MAX_MEASURED_AGE_S == 7200.0
    assert (SCHEMA_V1, SCHEMA) == ("homunculus.infinity-shadow.v1", "homunculus.infinity-shadow.v2")
```

An NBP reading with no `changed_at` is now a schema violation in a v2 body (Step 1's violations below), so the ingest test that used `nbp_systolic` as its example of an unknown parameter drops it — the v1 test after it keeps that case, where it belongs.

**Edit** `homunculus-engine/tests/test_infinity_shadow_store.py` — replace:
```python
        reading("art_mean", 401, "mmHg"),                               # range
        reading("nbp_systolic", 120, "mmHg"),                           # unknown_parameter
        reading("respiration_airway", 14, "/min"),                      # unknown_parameter
        reading("foo", 1, "x"),                                         # unknown_parameter
        reading("hr", 75, captured_at=T0 - 1.0),                        # duplicate (not newer)
        reading("temperature", 0, "C"),                                 # 0 is ACCEPTED
        reading("respiration", 12, "/min", captured_at=T0 + 2.0 + 1.9),  # 1.9 s ahead is accepted
    )))
    assert answer["accepted"] == 2
    assert answer["rejected"] == {"too_old": 1, "clock": 1, "unit": 1, "range": 1,
                                  "unknown_parameter": 3, "duplicate": 1}
    params = _params(store)
    assert params["hr"]["value"] == 70                                  # the held one stays
    assert params["temperature"]["value"] == 0
    assert "nbp_systolic" not in params and "spo2" not in params and "etco2" not in params
    assert store.feed(T0 + 2.0)["rejected"] == answer["rejected"]       # cumulative
```
with:
```python
        reading("art_mean", 401, "mmHg"),                               # range
        reading("respiration_airway", 14, "/min"),                      # unknown_parameter
        reading("foo", 1, "x"),                                         # unknown_parameter
        reading("hr", 75, captured_at=T0 - 1.0),                        # duplicate (not newer)
        reading("temperature", 0, "C"),                                 # 0 is ACCEPTED
        reading("respiration", 12, "/min", captured_at=T0 + 2.0 + 1.9),  # 1.9 s ahead is accepted
    )))
    assert answer["accepted"] == 2
    assert answer["rejected"] == {"too_old": 1, "clock": 1, "unit": 1, "range": 1,
                                  "unknown_parameter": 2, "duplicate": 1}
    params = _params(store)
    assert params["hr"]["value"] == 70                                  # the held one stays
    assert params["temperature"]["value"] == 0
    assert "spo2" not in params and "etco2" not in params
    assert store.feed(T0 + 2.0)["rejected"] == answer["rejected"]       # cumulative


def test_a_v1_body_is_still_taken_and_shows_no_nbp_at_all():
    # The R3 hub keeps posting v1 until its own release changes (the API goes first), and v1 never
    # carried NBP's change time: an NBP in a v1 body stays an unknown parameter, as it always was,
    # and the board says nothing of NBP — "awaiting a measurement" would be untrue of a hub that
    # cannot send one.
    store = ShadowStore(Clock())
    answer = store.ingest(body(device("192.0.2.10", reading(), reading("nbp_systolic", 120, "mmHg")),
                               schema=SCHEMA_V1))
    assert answer["accepted"] == 1 and answer["rejected"]["unknown_parameter"] == 1
    params = _params(store)
    assert params["hr"]["value"] == 72 and NBP not in params


def test_after_a_hub_rolled_back_to_v1_its_held_nbp_ages_out_and_then_nbp_is_not_shown():
    clock = Clock()
    store = ShadowStore(clock)
    store.ingest(body(device("192.0.2.10", reading(captured_at=T0 - 0.5), *nbp(captured_at=T0 - 0.5))))
    clock.t = T0 + 20.0                                               # the hub restarted on R3
    store.ingest(body(device("192.0.2.10", reading(captured_at=clock.t - 0.5)), schema=SCHEMA_V1))
    held = _params(store)[NBP]
    assert (held["state"], held["systolic"], held["changed_at"]) == ("old", None, _iso(T0 - 600.0))
    clock.t = T0 + FORGET_AFTER_S + 5.0
    store.ingest(body(device("192.0.2.10", reading(captured_at=clock.t - 0.5)), schema=SCHEMA_V1))
    assert NBP not in _params(store)


def test_nbp_is_judged_by_its_packet_time_like_any_reading():
    clock = Clock()
    store = ShadowStore(clock)
    answer = store.ingest(body(device("192.0.2.10", *nbp(captured_at=T0 - 10.5, changed_at=T0 - 11.0))))
    assert (answer["accepted"], answer["rejected"]["too_old"]) == (0, 3)
    clock.t += 1.5
    # 401 is past the record's integrity bound, as for ART; a change seen in the packet itself is taken.
    answer = store.ingest(body(device("192.0.2.10", *nbp(401, 79, 92, captured_at=clock.t - 0.5,
                                                         changed_at=clock.t - 0.5))))
    assert (answer["accepted"], answer["rejected"]["range"]) == (2, 1)
```

**Edit** `homunculus-engine/tests/test_infinity_shadow_store.py` — replace:
```python
    "wrong schema": lambda b: b.update(schema="homunculus.infinity-shadow.v2"),
```
with:
```python
    "wrong schema": lambda b: b.update(schema="homunculus.infinity-shadow.v3"),
    "changed_at on hr": lambda b: b["devices"][0]["readings"][0].update(changed_at=T0 - 60.0),
    "nbp without changed_at": lambda b: b["devices"][0]["readings"].append(reading("nbp_mean", 92, "mmHg")),
    "changed_at after captured_at": lambda b: b["devices"][0]["readings"].extend(nbp(changed_at=T0 - 0.4)),
    "changed_at zero": lambda b: b["devices"][0]["readings"].extend(nbp(changed_at=0)),
    "changed_at nan": lambda b: b["devices"][0]["readings"].extend(nbp(changed_at=float("nan"))),
    "changed_at text": lambda b: b["devices"][0]["readings"].extend(nbp(changed_at="12:00")),
    "changed_at in a v1 body": lambda b: (b.update(schema=SCHEMA_V1), b["devices"][0]["readings"].extend(nbp())),
```

**Edit** `homunculus-engine/tests/test_infinity_shadow_store.py` — replace:
```python
    params = store.devices(T0)["192.0.2.10"].parameters
    assert [p["parameter"] for p in params] == ["hr", "temperature", "respiration"]
    by = {p["parameter"]: p for p in params}
    assert by["hr"]["evidence"] == "screen_match_two_devices" and by["hr"]["partial"] is False
    assert by["temperature"]["unit"] == "C" and by["temperature"]["partial"] is True
```
with:
```python
    params = store.devices(T0)["192.0.2.10"].parameters
    assert [p["parameter"] for p in params] == ["hr", "temperature", "respiration", "nbp"]
    by = {p["parameter"]: p for p in params}
    assert by["hr"]["evidence"] == "screen_match_two_devices" and by["hr"]["partial"] is False
    assert by["temperature"]["unit"] == "C" and by["temperature"]["partial"] is True


# --- NBP: three readings, one entry, shown with the time its value last changed ------------------

def _waiting():
    return {"parameter": "nbp", "state": "old", "systolic": None, "diastolic": None, "mean": None,
            "unit": "mmHg", "age_s": None, "last_at": None, "changed_at": None, "measured_age_s": None,
            "evidence": "screen_match", "partial": False}


def test_three_nbp_readings_are_one_entry_with_the_time_their_value_changed():
    store = ShadowStore(Clock())
    answer = store.ingest(body(device("192.0.2.10", reading(), *nbp(captured_at=T0 - 0.5, changed_at=T0 - 600.0))))
    assert answer["accepted"] == 4
    params = store.devices(T0)["192.0.2.10"].parameters
    assert [p["parameter"] for p in params] == ["hr", "nbp"]           # after every other parameter
    assert params[1] == {"parameter": "nbp", "state": "value", "systolic": 118, "diastolic": 79, "mean": 92,
                         "unit": "mmHg", "age_s": 0.5, "last_at": _iso(T0 - 0.5),
                         "changed_at": _iso(T0 - 600.0), "measured_age_s": 600.0,
                         "evidence": "screen_match", "partial": False}


def test_nbp_is_withheld_once_its_value_last_changed_more_than_two_hours_ago():
    store = ShadowStore(Clock())
    store.ingest(body(device("192.0.2.10", *nbp(captured_at=T0 - 0.5, changed_at=T0 - 7199.5))))
    shown = _params(store, now=T0)[NBP]
    assert (shown["state"], shown["systolic"], shown["measured_age_s"]) == ("value", 118, 7199.5)
    withheld = _params(store, now=T0 + 1.0)[NBP]          # the packet is 1.5 s old: only the change is too old
    assert withheld == {**_waiting(), "age_s": 7200.5, "last_at": _iso(T0 - 7199.5),
                        "changed_at": _iso(T0 - 7199.5), "measured_age_s": 7200.5}


def test_a_silent_monitors_nbp_goes_old_like_any_value_and_is_aged_by_its_change():
    store = ShadowStore(Clock())
    store.ingest(body(device("192.0.2.10", *nbp(captured_at=T0, changed_at=T0 - 300.0))))
    assert _params(store, now=T0 + 14.9)[NBP]["state"] == "value"
    old = _params(store, now=T0 + 15.1)[NBP]
    assert (old["state"], old["systolic"], old["age_s"], old["last_at"]) == ("old", None, 315.1, _iso(T0 - 300.0))


def test_a_device_holding_readings_but_no_nbp_shows_it_awaiting_a_change():
    store = ShadowStore(Clock())
    store.ingest(body(device("192.0.2.10", reading()), device("192.0.2.11")))
    assert _params(store)[NBP] == _waiting()
    assert store.devices(T0)["192.0.2.11"].parameters == ()            # nothing held: no entry at all


@pytest.mark.parametrize("parts", [NBP_PARTS[:2], NBP_PARTS[1:], NBP_PARTS[:1]])
def test_fewer_than_three_nbp_readings_show_no_number(parts):
    store = ShadowStore(Clock())
    store.ingest(body(device("192.0.2.10", *[r for r in nbp() if r["parameter"] in parts])))
    assert _params(store)[NBP] == _waiting()


def test_three_readings_from_two_changes_are_never_shown_as_one_measurement():
    clock = Clock()
    store = ShadowStore(clock)
    store.ingest(body(device("192.0.2.10", *nbp(118, 79, 92, captured_at=T0 - 0.5, changed_at=T0 - 600.0))))
    clock.t += 5
    later = nbp(131, 85, 100, captured_at=clock.t - 0.5, changed_at=clock.t - 1.0)
    store.ingest(body(device("192.0.2.10", *later[1:])))               # the systolic did not come this time
    assert _params(store)[NBP] == _waiting()


def test_an_nbp_the_device_flags_invalid_is_stars_and_no_number():
    store = ShadowStore(Clock())
    parts = nbp()
    parts[1] = reading("nbp_diastolic", None, "mmHg", valid=False, changed_at=T0 - 600.0)
    store.ingest(body(device("192.0.2.10", *parts)))
    entry = _params(store)[NBP]
    assert (entry["state"], entry["systolic"], entry["diastolic"], entry["changed_at"]) == (
        "invalid", None, None, _iso(T0 - 600.0))
```

**Edit** `homunculus-engine/tests/test_infinity_shadow_store.py` — replace:
```python
def test_the_store_stays_bounded_at_100_devices_by_9_parameters():
    clock = Clock()
    store = ShadowStore(clock)
    units = {name: unit for name, (unit, _, _) in PARAMETERS.items()}
    sizes = []
    for cycle in range(30):
        clock.t = T0 + cycle * 5
        devices = [device(f"192.0.2.{i + 1}" if i < 50 else f"198.51.100.{i - 49}",
                          *(reading(name, 1, unit, captured_at=clock.t - 0.1) for name, unit in units.items()))
                   for i in range(100)]
        store.ingest(body(*devices))
        views = store.devices(clock.t)
        sizes.append((len(views), sum(len(v.parameters) for v in views.values())))
    assert set(sizes) == {(100, 900)}
```
with:
```python
def test_the_store_stays_bounded_at_100_devices_by_12_readings():
    clock = Clock()
    store = ShadowStore(clock)
    units = {name: unit for name, (unit, _, _) in PARAMETERS.items()}
    assert len(units) == 12
    sizes = []
    for cycle in range(30):
        clock.t = T0 + cycle * 5
        devices = [device(f"192.0.2.{i + 1}" if i < 50 else f"198.51.100.{i - 49}",
                          *(reading(name, 1, unit, captured_at=clock.t - 0.1,
                                    changed_at=clock.t - 60.0 if name in NBP_PARTS else None)
                            for name, unit in units.items()))
                   for i in range(100)]
        store.ingest(body(*devices))
        views = store.devices(clock.t)
        sizes.append((len(views), sum(len(v.parameters) for v in views.values())))
    assert set(sizes) == {(100, 1000)}             # nine entries, and the one the three NBP readings make
```

- [ ] **Step 2: The routes' tests**

**Edit** `homunculus-engine/tests/test_infinity_shadow_api.py` — replace:
```python
from homunculus.api.infinity_shadow import SCHEMA, ShadowSettings, shadow_settings_from_env
```
with:
```python
from homunculus.api.infinity_shadow import SCHEMA, SCHEMA_V1, ShadowSettings, shadow_settings_from_env
```

**Edit** `homunculus-engine/tests/test_infinity_shadow_api.py` — replace:
```python
    assert response.json() == {"accepted": 10, "rejected": {"too_old": 0, "clock": 0, "unit": 0, "range": 0,
                                                            "unknown_parameter": 0, "duplicate": 0}}

```
with:
```python
    assert response.json() == {"accepted": 10, "rejected": {"too_old": 0, "clock": 0, "unit": 0, "range": 0,
                                                            "unknown_parameter": 0, "duplicate": 0}}


def _with_nbp(body, source="192.0.2.10", *, changed_at):
    """The body with the forwarder's three NBP readings added to one device (v2)."""
    for device in body["devices"]:
        if device["source"] == source:
            captured = device["readings"][0]["captured_at"]
            device["readings"] += [{"parameter": name, "value": value, "unit": "mmHg", "valid": True,
                                    "captured_at": captured, "changed_at": changed_at}
                                   for name, value in (("nbp_systolic", 118), ("nbp_diastolic", 79),
                                                       ("nbp_mean", 92))]
    return body


def test_a_v1_body_from_the_r3_hub_is_still_200(tmp_path):
    # The API is deployed first; until drop-in 94 the hub keeps sending v1.
    client, clock, _ = _app(tmp_path)
    response = _post(client, clock, body={**_body(clock.t), "schema": SCHEMA_V1})
    assert response.status_code == 200 and response.json()["accepted"] == 10
    board = _board(client)                                           # and the strip is as it was: no NBP
    assert [p["parameter"] for p in board["beds"][0]["parameters"]] == ["hr", "spo2"]


def test_a_v2_body_puts_nbp_on_the_board_as_one_entry_with_the_time_it_changed(tmp_path):
    client, clock, _ = _app(tmp_path)
    assert SCHEMA == "homunculus.infinity-shadow.v2"
    assert _post(client, clock, body=_with_nbp(_body(clock.t), changed_at=clock.t - 754.0)).json()["accepted"] == 13
    clock.t += 2.0
    board = _board(client)
    one = next(b for b in board["beds"] if b["source"] == "192.0.2.10")
    entry = one["parameters"][-1]
    assert [p["parameter"] for p in one["parameters"]] == ["hr", "spo2", "nbp"]
    assert (entry["state"], entry["systolic"], entry["diastolic"], entry["mean"], entry["unit"]) == (
        "value", 118, 79, 92, "mmHg")
    assert entry["changed_at"].startswith("2027-01-15T07:47:26") and entry["measured_age_s"] == 756.0
    assert (entry["age_s"], entry["evidence"], entry["partial"]) == (2.4, "screen_match", False)
    assert "nbp_systolic" not in json.dumps(board)                   # the wire's names stop at the API


def test_a_change_time_on_anything_but_nbp_refuses_the_body(tmp_path):
    client, clock, _ = _app(tmp_path)
    body = _body(clock.t)
    body["devices"][0]["readings"][0]["changed_at"] = clock.t - 60.0
    response = _post(client, clock, body=body)
    assert response.status_code == 400 and response.json()["detail"] == {"reason": "rejected"}
    assert _board(client)["feed"]["state"] == "never"

```

**Edit** `homunculus-engine/tests/test_infinity_shadow_api.py` — replace:
```python
    hr, spo2 = board["beds"][0]["parameters"]
    assert (hr["parameter"], hr["state"], hr["value"], hr["unit"], hr["age_s"], hr["evidence"]) == (
        "hr", "value", 72, "bpm", 2.4, "screen_match_two_devices")
    assert (spo2["state"], spo2["value"]) == ("invalid", None)
```
with:
```python
    hr, spo2, nbp = board["beds"][0]["parameters"]
    assert (hr["parameter"], hr["state"], hr["value"], hr["unit"], hr["age_s"], hr["evidence"]) == (
        "hr", "value", 72, "bpm", 2.4, "screen_match_two_devices")
    assert (spo2["state"], spo2["value"]) == ("invalid", None)
    assert (nbp["parameter"], nbp["state"], nbp["systolic"], nbp["last_at"], nbp["changed_at"]) == (
        "nbp", "old", None, None, None)                              # no NBP came: awaiting a change
```

(`T0` = 1 800 000 000 is 2027-01-15 08:00:00 UTC, so a change 754 s before it is 07:47:26; read 2 s later it is 756 s old.)

- [ ] **Step 3: The acceptance check's test**

**Edit** `homunculus-engine/tests/test_infinity_shadow_check.py` — replace:
```python
def test_a_missing_endpoint_is_stage_yok_and_the_board_hash_is_still_printed(tmp_path, capsys):
```
with:
```python
def nbp(state, *, measured=None, changed=None):
    shown = state == "value"
    return {"parameter": "nbp", "state": state, "systolic": 211 if shown else None,
            "diastolic": 37 if shown else None, "mean": 95 if shown else None, "unit": "mmHg",
            "age_s": 2.0 if shown else measured, "last_at": changed, "changed_at": changed,
            "measured_age_s": measured, "evidence": "screen_match", "partial": False}


def test_the_nbp_line_counts_devices_and_the_oldest_change_and_never_prints_a_pressure():
    after = board()
    after["beds"][0]["parameters"].append(nbp("value", measured=2821.0, changed="2026-10-20T08:13:00+00:00"))
    after["beds"][1]["parameters"].append(nbp("old"))                                   # no change seen yet
    after["unassigned"][0]["parameters"].append(nbp("old", measured=9000.0, changed="2026-10-20T06:30:00+00:00"))
    lines = check.report(BEFORE, (after, PATIENTS), window_s=300, **EXPECT)
    readable = "\n".join(lines[:-1])
    assert ("nbp: 1 cihazda ölçüm saati ≤ ile gösteriliyor (en eski 48 dk önce), 1 cihazda ölçüm bekleniyor, "
            "1 cihazda gizli (eski)") in readable
    assert "3 taze değer" in readable                       # a shown NBP is a fresh cell like any other
    for secret in ("211", "37", "95"):
        assert secret not in readable, secret
    assert "nbp: 0 cihazda" in "\n".join(check.report(BEFORE, AFTER, window_s=300, **EXPECT))


def test_a_missing_endpoint_is_stage_yok_and_the_board_hash_is_still_printed(tmp_path, capsys):
```

- [ ] **Step 4: NBP in the equivalence run — values that would alarm, were they clinical**

**Edit** `homunculus-engine/tests/test_infinity_shadow_equivalence.py` — replace:
```python
def _shadow_body(now):
    readings = [("hr", 180, "bpm"), ("spo2", 70, "%"), ("respiration", 40, "/min"), ("art_systolic", 70, "mmHg")]
    return {"schema": "homunculus.infinity-shadow.v1", "sent_at": now,
            "forwarder": {"interval_s": 5, "sent": 1, "failed": 0, "decoder": "homunculus.infinity-preview.v3"},
            "hub": {"collector_age_s": 1.0, "accepted_packets": 1, "old_or_duplicate_packets": 0},
            "devices": [{"source": "192.0.2.10", "group": "239.20.1.10", "port": 2050, "status": "streaming",
                         "packet_age_ms": 100,
                         "readings": [{"parameter": p, "value": v, "unit": u, "valid": True, "captured_at": now - 0.5}
                                      for p, v, u in readings]}]}
```
with:
```python
def _shadow_body(now):
    readings = [("hr", 180, "bpm"), ("spo2", 70, "%"), ("respiration", 40, "/min"), ("art_systolic", 70, "mmHg")]
    # NBP 70/40 (50), with the time its value changed: hypotension, were it clinical.
    nbp = [("nbp_systolic", 70), ("nbp_diastolic", 40), ("nbp_mean", 50)]
    return {"schema": "homunculus.infinity-shadow.v2", "sent_at": now,
            "forwarder": {"interval_s": 5, "sent": 1, "failed": 0, "decoder": "homunculus.infinity-preview.v3"},
            "hub": {"collector_age_s": 1.0, "accepted_packets": 1, "old_or_duplicate_packets": 0},
            "devices": [{"source": "192.0.2.10", "group": "239.20.1.10", "port": 2050, "status": "streaming",
                         "packet_age_ms": 100,
                         "readings": [{"parameter": p, "value": v, "unit": u, "valid": True, "captured_at": now - 0.5}
                                      for p, v, u in readings]
                                     + [{"parameter": p, "value": v, "unit": "mmHg", "valid": True,
                                         "captured_at": now - 0.5, "changed_at": now - 30.0} for p, v in nbp]}]}
```

**Edit** `homunculus-engine/tests/test_infinity_shadow_equivalence.py` — replace:
```python
    values = {p["parameter"]: (p["state"], p["value"]) for p in bed["parameters"]}
    assert values["hr"] == ("value", 180) and values["spo2"] == ("value", 70)
```
with:
```python
    values = {p["parameter"]: (p["state"], p.get("value")) for p in bed["parameters"]}
    assert values["hr"] == ("value", 180) and values["spo2"] == ("value", 70)
    nbp = bed["parameters"][-1]
    assert (nbp["parameter"], nbp["state"], nbp["systolic"], nbp["diastolic"], nbp["mean"]) == ("nbp", "value", 70, 40, 50)
```

- [ ] **Step 5: NBP in the isolation body — the spies and the trends read see it too**

**Edit** `homunculus-engine/tests/test_infinity_shadow_isolation.py` — replace:
```python
                         "readings": [{"parameter": "hr", "value": 180, "unit": "bpm", "valid": True,
                                       "captured_at": now - 0.5}]}]}


def _hdr(token):
```
with:
```python
                         "readings": [{"parameter": "hr", "value": 180, "unit": "bpm", "valid": True,
                                       "captured_at": now - 0.5}]
                         + [{"parameter": name, "value": value, "unit": "mmHg", "valid": True,
                             "captured_at": now - 0.5, "changed_at": now - 120.0}
                            for name, value in (("nbp_systolic", 201), ("nbp_diastolic", 119), ("nbp_mean", 146))]}]}


def _hdr(token):
```

**Edit** `homunculus-engine/tests/test_infinity_shadow_isolation.py` — replace:
```python
    assert posted.status_code == 200 and posted.json()["accepted"] == 1
    assert board.status_code == 200 and board.json()["beds"][0]["link"] == "one"   # the lane really ran
```
with:
```python
    assert posted.status_code == 200 and posted.json()["accepted"] == 4
    assert board.status_code == 200 and board.json()["beds"][0]["link"] == "one"   # the lane really ran
    assert board.json()["beds"][0]["parameters"][-1]["systolic"] == 201              # NBP with it
```

**Edit** `homunculus-engine/tests/test_infinity_shadow_isolation.py` — replace:
```python
    """The lane holds a heart rate of 180 for p1's bed and the clinical chart holds 72; the trends of
    p1 must show the 72 and nothing of the lane, and must not even ask the shadow store."""
```
with:
```python
    """The lane holds a heart rate of 180 and an NBP of 201/119 for p1's bed and the clinical chart
    holds 72; the trends of p1 must show the 72 and nothing of the lane — no pressure point at all —
    and must not even ask the shadow store."""
```

The trends test already asserts every channel but `heart_rate` is empty (`test_infinity_shadow_isolation.py:204–205`), so with NBP in the lane it now also proves no shadow NBP reaches `sbp` or `map`.

- [ ] **Step 6: See them fail for the right reasons**

```bash
cd /c/tmp/inf-nbp/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_infinity_shadow_store.py tests/test_infinity_shadow_api.py 2>&1 | grep -E "^E   ImportError|errors? in"
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_infinity_shadow_check.py tests/test_infinity_shadow_equivalence.py tests/test_infinity_shadow_isolation.py 2>&1 | grep -E "^FAILED|^[0-9]+ failed" | sed 's/ - .*//'
```

Expected — the store and the routes cannot import what does not exist yet:
```
E   ImportError: cannot import name 'NBP' from 'homunculus.api.infinity_shadow' (…)
E   ImportError: cannot import name 'SCHEMA_V1' from 'homunculus.api.infinity_shadow' (…)
1 warning, 2 errors in …
```
and the three others — no `nbp:` line yet; a v2 body is refused (400) by a v1 store:
```
FAILED tests/test_infinity_shadow_check.py::test_the_nbp_line_counts_devices_and_the_oldest_change_and_never_prints_a_pressure
FAILED tests/test_infinity_shadow_equivalence.py::test_the_shadow_lane_actually_ran_in_the_on_app
FAILED tests/test_infinity_shadow_isolation.py::test_a_shadow_post_and_get_call_no_clinical_writer
FAILED tests/test_infinity_shadow_isolation.py::test_a_trends_read_never_reaches_the_shadow_store
4 failed, 35 passed, 3 warnings in …
```

- [ ] **Step 7: The wire's tables — v1 and v2, NBP, the board's `nbp`**

`SCHEMAS` and `NBP_PARTS` are tuples, not sets: `_validate` asks `x in …` of whatever the body holds, and a fuzzed list or dict compares against a tuple but raises `TypeError` against a set (`test_any_mangled_body_is_refused_or_taken_never_an_error` holds it).

**Edit** `homunculus-engine/src/homunculus/api/infinity_shadow.py` — replace:
```python
SCHEMA = "homunculus.infinity-shadow.v1"
# parameter -> (wire unit, integrity bounds). Integrity, NOT clinical: a value outside what the
# record can mean is a decoding fault, rejected and counted; 0 is inside every bound.
PARAMETERS = {
    "hr": ("bpm", 0, 350), "pls": ("bpm", 0, 350), "spo2": ("%", 0, 100),
    "etco2": ("mmHg", 0, 150), "temperature": ("C", 0, 50),
    "art_systolic": ("mmHg", 0, 400), "art_diastolic": ("mmHg", 0, 400), "art_mean": ("mmHg", 0, 400),
    "respiration": ("/min", 0, 200),
}
# Design §4.1 / docs/INFINITY-PARAMETER-RECORDS.md:36-50. NBP and airway RESP are absent on purpose:
# NBP's measurement time is not decoded, airway RESP is not verified. N is recorded for none.
EVIDENCE = {
    "hr": "screen_match_two_devices", "pls": "screen_match_two_devices",
    "spo2": "screen_match_two_devices", "etco2": "screen_match_two_devices",
    "art_systolic": "screen_match", "temperature": "screen_match_site_unknown",
    "art_mean": "structural", "art_diastolic": "structural_trend", "respiration": "range_overlap",
}
```
with:
```python
SCHEMA_V1 = "homunculus.infinity-shadow.v1"     # the R3 hub's: no NBP
SCHEMA = "homunculus.infinity-shadow.v2"        # v1, and NBP's three readings with `changed_at`
SCHEMAS = (SCHEMA_V1, SCHEMA)                   # a tuple: a fuzzed list or dict compares, never hashes
# parameter -> (wire unit, integrity bounds). Integrity, NOT clinical: a value outside what the
# record can mean is a decoding fault, rejected and counted; 0 is inside every bound.
PARAMETERS = {
    "hr": ("bpm", 0, 350), "pls": ("bpm", 0, 350), "spo2": ("%", 0, 100),
    "etco2": ("mmHg", 0, 150), "temperature": ("C", 0, 50),
    "art_systolic": ("mmHg", 0, 400), "art_diastolic": ("mmHg", 0, 400), "art_mean": ("mmHg", 0, 400),
    "respiration": ("/min", 0, 200),
    "nbp_systolic": ("mmHg", 0, 400), "nbp_diastolic": ("mmHg", 0, 400), "nbp_mean": ("mmHg", 0, 400),
}
# NBP: the monitor repeats its last NBP in every packet, so the packet's time says nothing about the
# cuff. The hub sends the time the triple last CHANGED (`changed_at`, an upper bound of the
# measurement); the board shows the three as ONE entry, `nbp`, and withholds it once that time is
# more than NBP_MAX_MEASURED_AGE_S old. A tuple, for the same reason as SCHEMAS.
NBP = "nbp"
NBP_PARTS = ("nbp_systolic", "nbp_diastolic", "nbp_mean")
NBP_MAX_MEASURED_AGE_S = 7200.0
# Design §4.1 / docs/INFINITY-PARAMETER-RECORDS.md:36-50, by the name the board shows. Airway RESP
# is absent on purpose (not verified). N is recorded for none.
EVIDENCE = {
    "hr": "screen_match_two_devices", "pls": "screen_match_two_devices",
    "spo2": "screen_match_two_devices", "etco2": "screen_match_two_devices",
    "art_systolic": "screen_match", "temperature": "screen_match_site_unknown",
    "art_mean": "structural", "art_diastolic": "structural_trend", "respiration": "range_overlap",
    "nbp": "screen_match",
}
```

(`EVIDENCE` stays one flat `{"name": "word", …}` literal: `monitor.test.js:131` reads it with a regex.)

**Edit** `homunculus-engine/src/homunculus/api/infinity_shadow.py` — replace:
```python
_READING = frozenset({"parameter", "value", "unit", "valid", "captured_at"})
```
with:
```python
_READING = frozenset({"parameter", "value", "unit", "valid", "captured_at"})
_NBP_READING = _READING | {"changed_at"}            # v2, and only for NBP_PARTS
```

**Edit** `homunculus-engine/src/homunculus/api/infinity_shadow.py` — replace:
```python
    parameters: tuple[dict, ...]  # in PARAMETERS order


@dataclass
class _Held:
    value: float | int | None
    valid: bool
    unit: str
    captured_at: float
    received_at: float
```
with:
```python
    parameters: tuple[dict, ...]  # in PARAMETERS order; NBP's three folded into `nbp`, last


@dataclass
class _Held:
    value: float | int | None
    valid: bool
    unit: str
    captured_at: float
    received_at: float
    changed_at: float | None = None      # NBP only: when its value last changed, as the hub saw it
```

- [ ] **Step 8: `_validate` takes v1 or v2, and `changed_at` only where it belongs**

**Edit** `homunculus-engine/src/homunculus/api/infinity_shadow.py` — replace:
```python
    _closed(body, _TOP)
    if body["schema"] != SCHEMA or not _number(body["sent_at"]):
        raise ShadowRejected("schema")
```
with:
```python
    _closed(body, _TOP)
    if body["schema"] not in SCHEMAS or not _number(body["sent_at"]):
        raise ShadowRejected("schema")
    v2 = body["schema"] == SCHEMA
```

**Edit** `homunculus-engine/src/homunculus/api/infinity_shadow.py` — replace:
```python
        for reading in readings:
            _closed(reading, _READING)
```
with:
```python
        for reading in readings:
            # v2: an NBP reading carries the time its value last changed, and nothing else does.
            nbp = v2 and isinstance(reading, dict) and reading.get("parameter") in NBP_PARTS
            _closed(reading, _NBP_READING if nbp else _READING)
```

**Edit** `homunculus-engine/src/homunculus/api/infinity_shadow.py` — replace:
```python
            if (valid and not _number(reading["value"])) or (not valid and reading["value"] is not None):
                raise ShadowRejected("value")
            names.add(name)
```
with:
```python
            if (valid and not _number(reading["value"])) or (not valid and reading["value"] is not None):
                raise ShadowRejected("value")
            # A change is seen in a packet, so it is never after that packet; with `_judge`'s clock
            # rule on `captured_at` it is never more than 2 s ahead of the API either.
            if nbp and not (_number(reading["changed_at"]) and 0 < reading["changed_at"] <= reading["captured_at"]):
                raise ShadowRejected("changed_at")
            names.add(name)
```

- [ ] **Step 9: The store keeps `changed_at`, knows whether the hub speaks v2, and folds**

**Edit** `homunculus-engine/src/homunculus/api/infinity_shadow.py` — replace:
```python
        self._lag = [0] * (2 + len(LAG_BUCKETS_MS) + 1)        # count, total, buckets (0a layout)
```
with:
```python
        self._lag = [0] * (2 + len(LAG_BUCKETS_MS) + 1)        # count, total, buckets (0a layout)
        self._nbp_lane = False                 # the last body was v2: the hub can send NBP at all
```

**Edit** `homunculus-engine/src/homunculus/api/infinity_shadow.py` — replace:
```python
                held.readings[reading["parameter"]] = _Held(reading["value"], reading["valid"], reading["unit"],
                                                            float(reading["captured_at"]), now)
```
with:
```python
                changed = reading.get("changed_at")
                held.readings[reading["parameter"]] = _Held(reading["value"], reading["valid"], reading["unit"],
                                                            float(reading["captured_at"]), now,
                                                            None if changed is None else float(changed))
```

**Edit** `homunculus-engine/src/homunculus/api/infinity_shadow.py` — replace:
```python
        self._forwarder = dict(body["forwarder"])
```
with:
```python
        self._forwarder = dict(body["forwarder"])
        self._nbp_lane = body["schema"] == SCHEMA
```

**Edit** `homunculus-engine/src/homunculus/api/infinity_shadow.py` — replace:
```python
            parameters = tuple(self._view(name, held.readings[name], now)
                               for name in PARAMETERS if name in held.readings)
```
with:
```python
            parameters = tuple(self._view(name, held.readings[name], now)
                               for name in PARAMETERS if name in held.readings and name not in NBP_PARTS)
            # A device showing anything says what its NBP is doing — while the hub speaks v2, or
            # while NBP readings from before are still held. An R3 hub cannot send NBP: nothing is
            # said of it then, rather than "awaiting a measurement".
            if held.readings and (self._nbp_lane or any(name in held.readings for name in NBP_PARTS)):
                parameters += (self._nbp_view(held.readings, now),)
```

**Edit** `homunculus-engine/src/homunculus/api/infinity_shadow.py` — replace:
```python
        spec = PARAMETERS.get(reading["parameter"])
        if spec is None:
            return "unknown_parameter"
```
with:
```python
        spec = PARAMETERS.get(reading["parameter"])
        # A v1 body never carried NBP's change time, so its NBP stays unknown, as v1 always had it.
        if spec is None or (reading["parameter"] in NBP_PARTS and "changed_at" not in reading):
            return "unknown_parameter"
```

**Edit** `homunculus-engine/src/homunculus/api/infinity_shadow.py` — replace:
```python
                "age_s": round(max(0.0, age), 1), "last_at": _iso(held.captured_at),
                "evidence": EVIDENCE[name], "partial": name in PARTIAL}
```
with:
```python
                "age_s": round(max(0.0, age), 1), "last_at": _iso(held.captured_at),
                "evidence": EVIDENCE[name], "partial": name in PARTIAL}

    @staticmethod
    def _nbp_view(readings: Mapping[str, _Held], now: float) -> dict:
        """NBP's three held readings as ONE entry. A number only when all three are held, came with
        one change time, are fresh and valid, and that change is at most NBP_MAX_MEASURED_AGE_S old.
        `age_s`/`last_at` are the packet's while it is shown and the change's once it is withheld;
        with no complete triple of one change there is no time at all: "awaiting a measurement"."""
        entry = {"parameter": NBP, "state": "old", "systolic": None, "diastolic": None, "mean": None,
                 "unit": PARAMETERS[NBP_PARTS[0]][0], "age_s": None, "last_at": None, "changed_at": None,
                 "measured_age_s": None, "evidence": EVIDENCE[NBP], "partial": NBP in PARTIAL}
        parts = [readings.get(name) for name in NBP_PARTS]
        if any(part is None for part in parts) or len({part.changed_at for part in parts}) != 1:
            return entry
        changed = parts[0].changed_at
        captured = min(part.captured_at for part in parts)
        age, measured = now - captured, now - changed
        entry.update(changed_at=_iso(changed), measured_age_s=round(max(0.0, measured), 1))
        if not (0 <= age <= DISPLAY_MAX_AGE_S and 0 <= measured <= NBP_MAX_MEASURED_AGE_S):
            entry.update(age_s=round(max(0.0, measured), 1), last_at=_iso(changed))
        elif not all(part.valid for part in parts):
            entry.update(state="invalid", age_s=round(age, 1), last_at=_iso(captured))      # the monitor shows ***
        else:
            entry.update(state="value", systolic=parts[0].value, diastolic=parts[1].value, mean=parts[2].value,
                         age_s=round(age, 1), last_at=_iso(captured))
        return entry
```

**Edit** `homunculus-engine/src/homunculus/api/infinity_shadow.py` — replace:
```python
    Parameters are in PARAMETERS order, beds by label, unassigned devices by address."""
```
with:
```python
    Parameters are in PARAMETERS order with NBP's three as one `nbp` entry last, beds by label,
    unassigned devices by address."""
```

- [ ] **Step 10: The acceptance check's `nbp:` line — counts and an age, never a pressure**

**Edit** `deploy/infinity/shadow_check.py` — replace:
```python
import argparse
import hashlib
import json
import time
```
with:
```python
import argparse
import hashlib
import json
import math
import time
```

**Edit** `deploy/infinity/shadow_check.py` — replace:
```python
def details(board):
    """What each device is doing — statuses, counts, ages; never a value or a patient."""
    if not board or board.get("stage") != "shadow":
        return []
    devices = (board.get("feed") or {}).get("devices") or {}
    lines = ["cihazlar: " + ", ".join(f"{k} {devices.get(k, 0)}" for k in
                                      ("total", "streaming", "standby", "silent", "waiting", "unsupported", "unknown"))]
```
with:
```python
def nbp_line(board):
    """NBP on the strip, by device: shown (with the oldest change time among them), awaiting a change
    since the hub started, or withheld — counts and an age, never a pressure."""
    entries = [p for card in (board.get("beds") or []) + (board.get("unassigned") or [])
               for p in card.get("parameters") or [] if p.get("parameter") == "nbp"]
    shown = [p for p in entries if p.get("state") == "value"]
    ages = [p.get("measured_age_s") for p in shown if isinstance(p.get("measured_age_s"), (int, float))]
    oldest = f" (en eski {math.ceil(max(ages) / 60)} dk önce)" if ages else ""
    waiting = sum(1 for p in entries if p.get("state") != "value" and p.get("changed_at") is None)
    withheld = len(entries) - len(shown) - waiting
    return (f"nbp: {len(shown)} cihazda ölçüm saati ≤ ile gösteriliyor{oldest}, {waiting} cihazda ölçüm bekleniyor, "
            f"{withheld} cihazda gizli (eski)")


def details(board):
    """What each device is doing — statuses, counts, ages; never a value or a patient."""
    if not board or board.get("stage") != "shadow":
        return []
    devices = (board.get("feed") or {}).get("devices") or {}
    lines = ["cihazlar: " + ", ".join(f"{k} {devices.get(k, 0)}" for k in
                                      ("total", "streaming", "standby", "silent", "waiting", "unsupported", "unknown")),
             nbp_line(board)]
```

The minutes are rounded up, as every age is. A shown NBP is a `value` cell, so the per-bed "N taze değer" counts it already (`shadow_check.py:144`); its `age_s` is the packet's, so "en eski … sn" still means freshness.

- [ ] **Step 11: Green, and the neighbours**

```bash
cd /c/tmp/inf-nbp/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_infinity_shadow_store.py tests/test_infinity_shadow_api.py tests/test_infinity_shadow_check.py tests/test_infinity_shadow_equivalence.py tests/test_infinity_shadow_isolation.py 2>&1 | tail -1
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_infinity_shadow_forwarder.py tests/test_infinity_shadow_config.py tests/test_infinity_live.py tests/test_infinity_records.py tests/test_infinity_device_beds.py 2>&1 | tail -1
```

Expected: `143 passed, 3 warnings in …` (65 + 39 + 18 + 3 + 18); then `168 passed, 3 warnings in …` — the forwarder still sends v1 and the API still takes it.

- [ ] **Step 12: The dashboard's copy of the API's tables — tests first**

`monitor.test.js:126–137` reads `EVIDENCE` and `PARTIAL` out of `api/infinity_shadow.py`; since Step 7 the API's `EVIDENCE` has `nbp`, so that test is already red. The order test and the legend's rows are told first:

**Edit** `dashboard/src/live/screens/common/monitor.test.js` — replace:
```js
  it("orders the parameters as the API does", () => {
    expect(PARAM_ORDER).toEqual(["hr", "pls", "spo2", "etco2", "temperature", "art_systolic", "art_diastolic",
      "art_mean", "respiration"]);
  });
```
with:
```js
  it("orders the parameters as the API does, NBP's one entry last", () => {
    expect(PARAM_ORDER).toEqual(["hr", "pls", "spo2", "etco2", "temperature", "art_systolic", "art_diastolic",
      "art_mean", "respiration", "nbp"]);
  });
```

**Edit** `dashboard/src/live/screens/settings/SettingsScreen.test.jsx` — replace:
```js
    expect(labels).toEqual(["HR", "PLS", "SpO₂", "etCO₂", "Ta", "ART S", "ART D", "ART M", "RESP"]
      .map((p) => expect.stringContaining(p)));
```
with:
```js
    expect(labels).toEqual(["HR", "PLS", "SpO₂", "etCO₂", "Ta", "ART S", "ART D", "ART M", "RESP", "NBP"]
      .map((p) => expect.stringContaining(p)));
```

```bash
cd /c/tmp/inf-nbp/dashboard
npx vitest run src/live/screens/common/monitor.test.js src/live/screens/settings/SettingsScreen.test.jsx 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ +Tests |^ +× "
```

Expected:
```
   × the tables > orders the parameters as the API does, NBP's one entry last …
   × the tables > knows each parameter's evidence and partial mark as the API states them …
   × SettingsScreen — the monitor strip's legend > with the stage on explains it: the note, never a sound, the ages, NIBP, the evidence, no sample count …
      Tests  3 failed | 25 passed (28)
```

- [ ] **Step 13: The copy**

**Edit** `dashboard/src/live/screens/common/monitor.js` — replace:
```js
/** The parameters in the API's own order (api/infinity_shadow.py PARAMETERS). */
export const PARAM_ORDER = Object.freeze(["hr", "pls", "spo2", "etco2", "temperature", "art_systolic",
  "art_diastolic", "art_mean", "respiration"]);
```
with:
```js
/** The parameters in the API's own order (api/infinity_shadow.py PARAMETERS), NBP's three readings
 *  being the one `nbp` entry the board sends last. */
export const PARAM_ORDER = Object.freeze(["hr", "pls", "spo2", "etco2", "temperature", "art_systolic",
  "art_diastolic", "art_mean", "respiration", "nbp"]);
```

**Edit** `dashboard/src/live/screens/common/monitor.js` — replace:
```js
  art_mean: "structural", art_diastolic: "structural_trend", respiration: "range_overlap",
});
```
with:
```js
  art_mean: "structural", art_diastolic: "structural_trend", respiration: "range_overlap", nbp: "screen_match",
});
```

The strip now admits an `nbp` entry (`KNOWN`, `MonitorStrip.jsx:23`) and would draw it with the generic cell; no fixture carries one until Task 5, and Task 6 gives it its own cell. The legend's table shows the NBP row (label from Task 2, evidence "Monitor ekranı ilə eynidir").

- [ ] **Step 14: The dashboard gate**

```bash
cd /c/tmp/inf-nbp/dashboard
npx vitest run src/live/screens/common/monitor.test.js src/live/screens/settings/SettingsScreen.test.jsx 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ +Tests "
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
```

Expected: `Tests  28 passed (28)`; then ` Test Files  89 passed (89)` and `      Tests  2392 passed (2392)`.

```bash
cd /c/tmp/inf-nbp/dashboard
npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
```

Expected: `✓ built in …`, `precache  20 entries (…)`.

- [ ] **Step 15: Line ends**

```bash
cd /c/tmp/inf-nbp
for f in homunculus-engine/src/homunculus/api/infinity_shadow.py deploy/infinity/shadow_check.py homunculus-engine/tests/test_infinity_shadow_store.py homunculus-engine/tests/test_infinity_shadow_api.py homunculus-engine/tests/test_infinity_shadow_check.py homunculus-engine/tests/test_infinity_shadow_equivalence.py homunculus-engine/tests/test_infinity_shadow_isolation.py dashboard/src/live/screens/common/monitor.js dashboard/src/live/screens/common/monitor.test.js dashboard/src/live/screens/settings/SettingsScreen.test.jsx; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected, in that order: 518, 233, 552, 456, 154, 257, 270, 135, 144, 176 — each `CR=` equal to its `LF=`.

- [ ] **Step 16: Commit**

```bash
cd /c/tmp/inf-nbp
git add homunculus-engine/src/homunculus/api/infinity_shadow.py deploy/infinity/shadow_check.py homunculus-engine/tests/test_infinity_shadow_store.py homunculus-engine/tests/test_infinity_shadow_api.py homunculus-engine/tests/test_infinity_shadow_check.py homunculus-engine/tests/test_infinity_shadow_equivalence.py homunculus-engine/tests/test_infinity_shadow_isolation.py dashboard/src/live/screens/common/monitor.js dashboard/src/live/screens/common/monitor.test.js dashboard/src/live/screens/settings/SettingsScreen.test.jsx
git status --short && git diff --cached --stat
git commit -q -F - <<'MSG'
feat(api): the shadow lane takes v1 and v2 and shows NBP as one entry with the time it changed

Schema v2 is v1 plus `changed_at` on NBP's three readings — required there,
refused anywhere else, never after the packet's own time (X40). v1 is still
taken; an NBP in a v1 body stays an unknown parameter. The three held readings
fold into one board entry `nbp`: a number only when all three are held with one
change time (X38), fresh and valid, and the change is at most 2 h old
(NBP_MAX_MEASURED_AGE_S); withheld, its age is the change's. The entry exists
for a device that holds a reading, while the hub speaks v2 or NBP is still held
(X39), so an R3 hub's strip is unchanged. shadow_check.py prints an `nbp:` line
of counts and an age. The dashboard's copy of the tables (PARAM_ORDER, EVIDENCE)
lands in the same commit, because monitor.test.js holds the two equal (X43).

red: tests/test_infinity_shadow_store.py and _api.py — 2 errors during collection (ImportError: cannot import name 'NBP' / 'SCHEMA_V1'); _check.py, _equivalence.py, _isolation.py — 4 failed, 35 passed (no nbp line; a v2 body refused 400); monitor.test.js + SettingsScreen.test.jsx — 3 failed, 25 passed

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
git log --oneline -1
```

---

### Task 4: The forwarder speaks v2 — NBP with the time it changed, and not before a change was seen

Spec D4, D5, §4.2, with X38. `SCHEMA` becomes `homunculus.infinity-shadow.v2`; `FORWARDED` gains the three `nbp_*` names (from the live view's `NBP`, so the two cannot drift); `thin()` sends an `nbp_*` reading only when its snapshot entry is fresh (as every reading) **and** carries a `changed_at`, and then sends it with that time. Since Task 1 an entry has a `changed_at` only after a change seen as it happened, and only while it holds the changed triple's component — so nothing is sent after a hub start, after an outage, or for a partial packet's newer value. The release still packs only `edge/` (Task 8 checks it): the new import is `.infinity_live`, an edge module.

**Files:**
- Modify: `homunculus-engine/tests/test_infinity_shadow_forwarder.py` (the docstring; the "never NBP" test 64–70; the body test 147; `_run_cycles` and the end-to-end test 383–410)
- Modify: `homunculus-engine/src/homunculus/edge/infinity_shadow.py` (docstring 8–10, `SCHEMA` 27, `FORWARDED` 34–36, `thin()` 65–80)

- [ ] **Step 1: Write the failing tests**

**Edit** `homunculus-engine/tests/test_infinity_shadow_forwarder.py` — replace:
```python
"""Aşama A's hub forwarder: thinned, fresh, no NBP, display only, off unless its environment is set.
```
with:
```python
"""Aşama A's hub forwarder: thinned, fresh, NBP only with the time it changed, display only, off unless
its environment is set.
```

**Edit** `homunculus-engine/tests/test_infinity_shadow_forwarder.py` — replace:
```python
def test_thin_sends_hr_and_spo2_and_never_nbp():
    view, now = _view()
    view.consume([event(T - 0.2, PAYLOAD + record(NBP_SYS, 120) + record(NBP_DIA, 80) + record(NBP_MEAN, 93))])
    body = _thin(view, now)
    assert _names(body) == ["hr", "spo2"]
    assert not [n for n in FORWARDED if n.startswith("nbp_")]
    assert "nbp" not in json.dumps(body)
```
with:
```python
def _nbp(systolic, diastolic, mean):
    return record(NBP_SYS, systolic) + record(NBP_DIA, diastolic) + record(NBP_MEAN, mean)


def test_thin_sends_nbp_with_its_change_time_and_not_before_a_change_was_seen():
    view, now = _view()
    view.consume([event(T - 2.2, PAYLOAD + _nbp(120, 80, 93))])     # first seen after a start: time unknown
    body = _thin(view, now)
    assert _names(body) == ["hr", "spo2"] and "nbp" not in json.dumps(body)
    view.consume([event(T - 1.2, PAYLOAD + _nbp(118, 79, 92))])     # the triple changed: measured at or before
    view.consume([event(T - 0.2, PAYLOAD + _nbp(118, 79, 92))])     # and repeated in every packet
    readings = _thin(view, now)["devices"][0]["readings"]
    assert [r["parameter"] for r in readings] == ["hr", "spo2", "nbp_systolic", "nbp_diastolic", "nbp_mean"]
    assert readings[2] == {"parameter": "nbp_systolic", "value": 118, "unit": "mmHg", "valid": True,
                           "captured_at": T - 0.2, "changed_at": T - 1.2}
    assert {r["changed_at"] for r in readings[2:]} == {T - 1.2}
    assert not any("changed_at" in r for r in readings[:2])
    assert [n for n in FORWARDED if n.startswith("nbp_")] == ["nbp_systolic", "nbp_diastolic", "nbp_mean"]


def test_a_newer_nbp_value_without_its_triple_is_not_sent_with_the_older_time():
    view, now = _view()
    view.consume([event(T - 2.2, _nbp(120, 80, 93)), event(T - 1.2, _nbp(118, 79, 92))])
    view.consume([event(T - 0.2, record(NBP_SYS, 105))])           # a packet carrying the systolic alone
    assert _names(_thin(view, now)) == ["nbp_diastolic", "nbp_mean"]


def test_an_nbp_three_seconds_old_never_leaves_the_hub():
    view, now = _view()
    view.consume([event(T - 1.0, _nbp(120, 80, 93)), event(T - 0.5, _nbp(118, 79, 92))])
    now[0] = T + 2.4                                               # the packet is 2.9 s old
    assert _names(_thin(view, now)) == ["nbp_systolic", "nbp_diastolic", "nbp_mean"]
    now[0] = T + 2.5                                               # 3.0 s: no older value leaves the hub
    assert _names(_thin(view, now)) == []
```

**Edit** `homunculus-engine/tests/test_infinity_shadow_forwarder.py` — replace:
```python
    assert (body["schema"], body["sent_at"]) == (SCHEMA, T)
```
with:
```python
    assert (body["schema"], body["sent_at"]) == (SCHEMA, T) and SCHEMA == "homunculus.infinity-shadow.v2"
```

The end-to-end test runs the real loop and the real sender into the real API (one clock for both). The monitor first shows 120/80 (93), then 118/79 (92) — the change, at `T − 0.3` — and keeps repeating it every cycle:

**Edit** `homunculus-engine/tests/test_infinity_shadow_forwarder.py` — replace:
```python
def _run_cycles(view, now, client, cycles, collector_age=lambda: 1.0):
    """The real loop, the real sender; the live view and the API on one clock."""
    stop, pauses = threading.Event(), []
    sender = ShadowSender("https://api.test/infinity-shadow/readings", TOKEN, "unused", opener=ClientOpener(client))
    inv = inventory(2)

    def wait(pause):
        pauses.append(pause)
        now[0] += pause
        view.consume([event(now[0] - 0.3, PAYLOAD, index=0, inv=inv)])       # the monitor keeps sending
        if len(pauses) >= cycles:
            stop.set()

    forward_loop(view, sender, stop, collector_age=collector_age, clock=lambda: now[0], wait=wait)
    return pauses


def test_a_thinned_body_lands_in_the_api_lane_and_on_the_board(tmp_path):
    view, now = _view(2)
    view.consume([event(T - 0.3, PAYLOAD, index=0, inv=inventory(2))])
    client = _api(tmp_path, lambda: now[0])
    assert _run_cycles(view, now, client, 3) == [INTERVAL_S] * 3
    board = client.get("/infinity-shadow/board", headers={"Authorization": f"Bearer {DEVICE}"}).json()
    (bed,) = board["beds"]
    assert (bed["bed_label"], bed["source"], bed["status"]) == ("B-1", "192.0.2.1", "streaming")
    params = {p["parameter"]: p for p in bed["parameters"]}
    assert (params["hr"]["state"], params["hr"]["value"], params["hr"]["unit"]) == ("value", 70, "bpm")
    assert params["spo2"]["value"] == 97
```
with:
```python
def _run_cycles(view, now, client, cycles, collector_age=lambda: 1.0, payload=PAYLOAD):
    """The real loop, the real sender; the live view and the API on one clock."""
    stop, pauses = threading.Event(), []
    sender = ShadowSender("https://api.test/infinity-shadow/readings", TOKEN, "unused", opener=ClientOpener(client))
    inv = inventory(2)

    def wait(pause):
        pauses.append(pause)
        now[0] += pause
        view.consume([event(now[0] - 0.3, payload, index=0, inv=inv)])       # the monitor keeps sending
        if len(pauses) >= cycles:
            stop.set()

    forward_loop(view, sender, stop, collector_age=collector_age, clock=lambda: now[0], wait=wait)
    return pauses


def test_a_thinned_body_lands_in_the_api_lane_and_on_the_board(tmp_path):
    view, now = _view(2)
    view.consume([event(T - 0.5, PAYLOAD + _nbp(120, 80, 93), index=0, inv=inventory(2)),
                  event(T - 0.3, PAYLOAD + _nbp(118, 79, 92), index=0, inv=inventory(2))])   # NBP changed at T - 0.3
    client = _api(tmp_path, lambda: now[0])
    assert _run_cycles(view, now, client, 3, payload=PAYLOAD + _nbp(118, 79, 92)) == [INTERVAL_S] * 3
    board = client.get("/infinity-shadow/board", headers={"Authorization": f"Bearer {DEVICE}"}).json()
    (bed,) = board["beds"]
    assert (bed["bed_label"], bed["source"], bed["status"]) == ("B-1", "192.0.2.1", "streaming")
    params = {p["parameter"]: p for p in bed["parameters"]}
    assert (params["hr"]["state"], params["hr"]["value"], params["hr"]["unit"]) == ("value", 70, "bpm")
    assert params["spo2"]["value"] == 97
    nbp = params["nbp"]
    assert (nbp["state"], nbp["systolic"], nbp["diastolic"], nbp["mean"], nbp["unit"]) == ("value", 118, 79, 92, "mmHg")
    assert nbp["changed_at"] == datetime.datetime.fromtimestamp(T - 0.3, datetime.timezone.utc).isoformat()
    assert nbp["measured_age_s"] == 15.3                           # at T + 15, the third cycle's end
    assert not [p for p in params if p.startswith("nbp_")]
```

The feed's `rejected` counters in the same test stay all zero: the API takes every NBP reading (Task 3).

- [ ] **Step 2: See them fail for the right reasons**

```bash
cd /c/tmp/inf-nbp/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_infinity_shadow_forwarder.py 2>&1 | grep -E "^FAILED|^[0-9]+ failed" | sed 's/ - .*//'
```

Expected:
```
FAILED tests/test_infinity_shadow_forwarder.py::test_thin_sends_nbp_with_its_change_time_and_not_before_a_change_was_seen
FAILED tests/test_infinity_shadow_forwarder.py::test_a_newer_nbp_value_without_its_triple_is_not_sent_with_the_older_time
FAILED tests/test_infinity_shadow_forwarder.py::test_an_nbp_three_seconds_old_never_leaves_the_hub
FAILED tests/test_infinity_shadow_forwarder.py::test_the_body_names_the_forwarder_the_hub_and_the_decoder
FAILED tests/test_infinity_shadow_forwarder.py::test_a_thinned_body_lands_in_the_api_lane_and_on_the_board
5 failed, 49 passed, 3 warnings in …
```
(No NBP is sent; the body says v1; with a v1 body the board carries no `nbp` entry — X39 — so the end-to-end test meets `KeyError: 'nbp'`.)

- [ ] **Step 3: The forwarder**

**Edit** `homunculus-engine/src/homunculus/edge/infinity_shadow.py` — replace:
```python
One body per cycle: for each device, its status and, for each forwarded parameter, the value the
live view holds now — at most one value per parameter per device per INTERVAL_S. A device is
named by its address only; a bed comes from the API's approved table, never from here.
```
with:
```python
One body per cycle: for each device, its status and, for each forwarded parameter, the value the
live view holds now — at most one value per parameter per device per INTERVAL_S; NBP also carries
the time its value last changed. A device is named by its address only; a bed comes from the API's
approved table, never from here.
```

**Edit** `homunculus-engine/src/homunculus/edge/infinity_shadow.py` — replace:
```python
from urllib.parse import urlsplit

SCHEMA = "homunculus.infinity-shadow.v1"
```
with:
```python
from urllib.parse import urlsplit

from .infinity_live import NBP

SCHEMA = "homunculus.infinity-shadow.v2"
```

**Edit** `homunculus-engine/src/homunculus/edge/infinity_shadow.py` — replace:
```python
# NBP is absent on purpose (measurement time not decoded); so is airway RESP (layout unverified).
FORWARDED = ("hr", "pls", "spo2", "etco2", "temperature",
             "art_systolic", "art_diastolic", "art_mean", "respiration")
```
with:
```python
# NBP travels with `changed_at`, the time its triple last changed as the live view saw it: the
# monitor repeats the last NBP in every packet and its own clock is not decoded, so that time is an
# upper bound of the measurement: the cuff measured then or earlier. No change seen since the hub
# started: no time, and no NBP is sent. Airway RESP is absent on purpose (layout unverified).
FORWARDED = ("hr", "pls", "spo2", "etco2", "temperature",
             "art_systolic", "art_diastolic", "art_mean", "respiration") + NBP
```

**Edit** `homunculus-engine/src/homunculus/edge/infinity_shadow.py` — replace:
```python
    than MAX_FORWARD_AGE_MS. A device's "***" travels as `valid: false, value: null`; a stale
    parameter does not travel. No device id or inventory name leaves the hub."""
    devices = []
    for device in snapshot["devices"]:
        readings = []
        for name in FORWARDED:
            entry = device["parameters"].get(name)
            if entry is None or entry["status"] == "stale" or entry["age_ms"] >= MAX_FORWARD_AGE_MS:
                continue
            valid = entry["status"] == "candidate"
            readings.append({"parameter": name, "value": entry["value"] if valid else None,
                             "unit": entry["unit"], "valid": valid,
                             "captured_at": float(entry["capture_epoch"])})
```
with:
```python
    than MAX_FORWARD_AGE_MS. A device's "***" travels as `valid: false, value: null`; a stale
    parameter does not travel; an NBP reading travels only with its `changed_at`. No device id or
    inventory name leaves the hub."""
    devices = []
    for device in snapshot["devices"]:
        readings = []
        for name in FORWARDED:
            entry = device["parameters"].get(name)
            if entry is None or entry["status"] == "stale" or entry["age_ms"] >= MAX_FORWARD_AGE_MS:
                continue
            if name in NBP and entry.get("changed_at") is None:
                continue                                    # its measurement time is not known
            valid = entry["status"] == "candidate"
            reading = {"parameter": name, "value": entry["value"] if valid else None,
                       "unit": entry["unit"], "valid": valid,
                       "captured_at": float(entry["capture_epoch"])}
            if name in NBP:
                reading["changed_at"] = float(entry["changed_at"])
            readings.append(reading)
```

The bound is on the time; the age the strip prints from it is younger than the truth by at most the few seconds between the cuff's result and the packet that showed it — which is why a change seen only after a gap has no time at all (X37).

- [ ] **Step 4: Green, and the whole lane**

```bash
cd /c/tmp/inf-nbp/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_infinity_shadow_forwarder.py 2>&1 | tail -1
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_infinity_live.py tests/test_infinity_records.py tests/test_infinity_shadow_forwarder.py tests/test_infinity_shadow_store.py tests/test_infinity_shadow_api.py tests/test_infinity_shadow_check.py tests/test_infinity_shadow_equivalence.py tests/test_infinity_shadow_isolation.py tests/test_infinity_shadow_config.py tests/test_infinity_release.py 2>&1 | tail -1
```

Expected: `54 passed, 3 warnings in …`; then `256 passed, 3 warnings in …` (the isolation test's import check covers `edge/infinity_shadow.py`'s new import: an edge module, nothing clinical).

- [ ] **Step 5: Line ends**

```bash
cd /c/tmp/inf-nbp
for f in homunculus-engine/src/homunculus/edge/infinity_shadow.py homunculus-engine/tests/test_infinity_shadow_forwarder.py; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected: `edge/infinity_shadow.py CR=177 LF=177`, `test_infinity_shadow_forwarder.py CR=607 LF=607`.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/inf-nbp
git add homunculus-engine/src/homunculus/edge/infinity_shadow.py homunculus-engine/tests/test_infinity_shadow_forwarder.py
git status --short && git diff --cached --stat
git commit -q -F - <<'MSG'
feat(edge): the forwarder sends NBP with the time it changed (shadow schema v2)

FORWARDED gains the live view's three NBP names; thin() sends an nbp_* reading
only when it is fresh and the live view has a change time for it, and sends
that time as changed_at. Nothing is sent after a hub start, after an outage
(X37) or for a partial packet's newer value (X38). The body is
homunculus.infinity-shadow.v2, which the API takes since the previous commit.
The new import is an edge module: the release still packs only edge/.

red: 5 failed, 49 passed — no NBP sent; the body said v1; the board had no nbp (tests/test_infinity_shadow_forwarder.py)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
git log --oneline -1
```

---

### Task 5: `monitor.js` decides what the NBP cell may show — and judges no age itself

Spec §5 (`cellOf`), with X41. `cellOf` returns, for the `nbp` entry, `{kind: "nbp", systolic, diastolic, mean, changedAtMs, measuredAgeS, ageS}` when the server says `value` and the packet is fresh on this browser's clock; otherwise the existing `invalid` or `old` kinds — `old` aged by the **change** (`measured_age_s` plus the time since the answer), or with no age and no time at all when no change has been seen ("awaiting"). The 2-hour limit stays the API's: an answer that says `value` three hours after the change is drawn, one that says `old` ten minutes after it is not. `lastSeenMs` leaves NBP out: a withheld NBP's `last_at` is its change time, not when the monitor last sent (X41). The test util learns to build the API's `nbp` entry; a wire name (`nbp_systolic`) is refused there, as it never reaches the board.

**Files:**
- Modify: `dashboard/src/live/data/shadow.testutil.js` (the header's examples, `UNIT`, `EVIDENCE`, `param()`; a new `NBP_CHANGED_AT`)
- Modify: `dashboard/src/live/screens/common/monitor.test.js` (the import; a new `describe` after "ages and cells")
- Modify: `dashboard/src/live/screens/common/monitor.js` (`cellOf` 68–80 and a new `nbpCellOf`; `lastSeenMs`)

- [ ] **Step 1: The test util builds the API's `nbp` entry**

**Edit** `dashboard/src/live/data/shadow.testutil.js` — replace:
```js
//     param("hr", 72)                       a fresh value, 2 s old
//     param("spo2", null, { state: "invalid" })
//     bed("REA-01 · 2", [param("hr", 72)], { link: "one", patient_id: "S-001" })
//     unassigned("192.0.2.28", "table_unassigned")
//     strip({ beds: [...], unassigned: [...] })

export const UNIT = Object.freeze({
  hr: "bpm", pls: "bpm", spo2: "%", etco2: "mmHg", temperature: "C",
  art_systolic: "mmHg", art_diastolic: "mmHg", art_mean: "mmHg", respiration: "/min",
});
const EVIDENCE = Object.freeze({
  hr: "screen_match_two_devices", pls: "screen_match_two_devices", spo2: "screen_match_two_devices",
  etco2: "screen_match_two_devices", art_systolic: "screen_match", temperature: "screen_match_site_unknown",
  art_mean: "structural", art_diastolic: "structural_trend", respiration: "range_overlap",
});
const PARTIAL = new Set(["temperature", "art_mean", "art_diastolic", "respiration"]);

/** When a strip answer was generated in these fixtures. */
export const AT = "2026-10-08T10:00:00+00:00";

/** One parameter as the API sends it. `value` null with no `state` override means "invalid". */
export function param(name, value, over = {}) {
  if (!(name in UNIT)) throw new TypeError(`param(name, value, over): no such forwarded parameter ${name}`);
  return {
    parameter: name, state: value === null ? "invalid" : "value", value, unit: UNIT[name], age_s: 2,
    last_at: AT, evidence: EVIDENCE[name], partial: PARTIAL.has(name), ...over,
  };
}
```
with:
```js
//     param("hr", 72)                       a fresh value, 2 s old
//     param("spo2", null, { state: "invalid" })
//     param("nbp", [118, 79, 92])           NBP, its value changed ten minutes before AT
//     param("nbp", null)                    NBP awaiting a change (none seen since the hub started)
//     bed("REA-01 · 2", [param("hr", 72)], { link: "one", patient_id: "S-001" })
//     unassigned("192.0.2.28", "table_unassigned")
//     strip({ beds: [...], unassigned: [...] })

export const UNIT = Object.freeze({
  hr: "bpm", pls: "bpm", spo2: "%", etco2: "mmHg", temperature: "C",
  art_systolic: "mmHg", art_diastolic: "mmHg", art_mean: "mmHg", respiration: "/min", nbp: "mmHg",
});
const EVIDENCE = Object.freeze({
  hr: "screen_match_two_devices", pls: "screen_match_two_devices", spo2: "screen_match_two_devices",
  etco2: "screen_match_two_devices", art_systolic: "screen_match", temperature: "screen_match_site_unknown",
  art_mean: "structural", art_diastolic: "structural_trend", respiration: "range_overlap", nbp: "screen_match",
});
const PARTIAL = new Set(["temperature", "art_mean", "art_diastolic", "respiration"]);

/** When a strip answer was generated in these fixtures. */
export const AT = "2026-10-08T10:00:00+00:00";

/** When the fixtures' NBP last changed: ten minutes before AT. */
export const NBP_CHANGED_AT = "2026-10-08T09:50:00+00:00";

/** One parameter as the API sends it. `value` null with no `state` override means "invalid". NBP is
 *  the API's ONE entry for its three readings (`param("nbp", [s, d, m])`, or `null` for "no change
 *  seen yet"); a wire name such as `nbp_systolic` never reaches the board and is refused here. */
export function param(name, value, over = {}) {
  if (!(name in UNIT)) throw new TypeError(`param(name, value, over): no such forwarded parameter ${name}`);
  if (name === "nbp") return nbpParam(value, over);
  return {
    parameter: name, state: value === null ? "invalid" : "value", value, unit: UNIT[name], age_s: 2,
    last_at: AT, evidence: EVIDENCE[name], partial: PARTIAL.has(name), ...over,
  };
}

function nbpParam(triple, over) {
  if (triple !== null && !(Array.isArray(triple) && triple.length === 3)) {
    throw new TypeError('param("nbp", [systolic, diastolic, mean] | null, over)');
  }
  const shown = triple !== null;
  return {
    parameter: "nbp", state: shown ? "value" : "old",
    systolic: shown ? triple[0] : null, diastolic: shown ? triple[1] : null, mean: shown ? triple[2] : null,
    unit: "mmHg", age_s: shown ? 2 : null, last_at: shown ? AT : null,
    changed_at: shown ? NBP_CHANGED_AT : null, measured_age_s: shown ? 600 : null,
    evidence: EVIDENCE.nbp, partial: false, ...over,
  };
}
```

The shape is `api/infinity_shadow.py`'s `_nbp_view` (Task 3). A withheld NBP is `param("nbp", null, { changed_at, last_at, age_s, measured_age_s })`: no numbers, the change's time and age.

- [ ] **Step 2: Write the failing tests**

**Edit** `dashboard/src/live/screens/common/monitor.test.js` — replace:
```js
import {
  EVIDENCE, PARAM_ORDER, PARTIAL, STATUS_KEY, UNIT_KEY, ageText, cellOf, chipCounts, displayAge, feedSentenceKey,
  linkSentenceKey, maxAgeOf, readAgeS, reasonKey,
} from "./monitor.js";
import { param, strip, bed, unassigned } from "../../data/shadow.testutil.js";
```
with:
```js
import {
  EVIDENCE, PARAM_ORDER, PARTIAL, STATUS_KEY, UNIT_KEY, ageText, cellOf, chipCounts, displayAge, feedSentenceKey,
  lastSeenMs, linkSentenceKey, maxAgeOf, readAgeS, reasonKey,
} from "./monitor.js";
import { NBP_CHANGED_AT, param, strip, bed, unassigned } from "../../data/shadow.testutil.js";
```

**Edit** `dashboard/src/live/screens/common/monitor.test.js` — replace:
```js
  it("writes an age in the board's own units, rounded up", () => {
    const az = createTranslator("az", DICTIONARIES);
    expect(ageText(az, 2.1)).toBe("3 san");
    expect(ageText(az, 120)).toBe("2 dəq");
    expect(ageText(az, null)).toBeNull();
  });
});
```
with:
```js
  it("writes an age in the board's own units, rounded up", () => {
    const az = createTranslator("az", DICTIONARIES);
    expect(ageText(az, 2.1)).toBe("3 san");
    expect(ageText(az, 120)).toBe("2 dəq");
    expect(ageText(az, null)).toBeNull();
  });
});

describe("NBP's cell: the time its value last changed", () => {
  const NBP = param("nbp", [118, 79, 92]);
  const at = (p, over = {}) => cellOf(p, { nowMs: FETCHED, fetchedAtMs: FETCHED, ...over });

  it("shows the three numbers with the time the value changed and how long ago that was", () => {
    expect(at(NBP)).toEqual({ kind: "nbp", systolic: 118, diastolic: 79, mean: 92,
      changedAtMs: Date.parse(NBP_CHANGED_AT), measuredAgeS: 600, ageS: 2 });
  });

  it("ages the change between polls, and goes old with its packet like any value", () => {
    expect(at(NBP, { nowMs: FETCHED + 3000 })).toMatchObject({ kind: "nbp", measuredAgeS: 603, ageS: 5 });
    expect(at(NBP, { nowMs: FETCHED + 14_000 })).toEqual({ kind: "old", ageS: 614, lastAt: NBP_CHANGED_AT });
    expect(at(NBP, { feedOk: false })).toEqual({ kind: "old", ageS: 600, lastAt: NBP_CHANGED_AT });
  });

  it("takes the server's withholding as it comes and judges no age itself", () => {
    // The 2-hour limit is the API's: an answer that says "value" three hours after the change is
    // drawn, and one that says "old" ten minutes after it is not.
    expect(at(param("nbp", [118, 79, 92], { measured_age_s: 10_800 })).kind).toBe("nbp");
    const withheld = param("nbp", null, { changed_at: NBP_CHANGED_AT, last_at: NBP_CHANGED_AT, age_s: 600, measured_age_s: 600 });
    expect(at(withheld)).toEqual({ kind: "old", ageS: 600, lastAt: NBP_CHANGED_AT });
  });

  it("awaits a measurement when no change was seen: no number, no age, no time", () => {
    expect(at(param("nbp", null))).toEqual({ kind: "old", ageS: null, lastAt: null });
    expect(at(param("nbp", null), { nowMs: FETCHED - 500 })).toEqual({ kind: "old", ageS: null, lastAt: null });
  });

  it("shows the monitor's *** when it flags a component", () => {
    expect(at(param("nbp", null, { state: "invalid", age_s: 2, last_at: NBP_CHANGED_AT, changed_at: NBP_CHANGED_AT,
      measured_age_s: 600 }))).toEqual({ kind: "invalid", ageS: 2 });
  });

  it("is never built from a wire name", () => {
    expect(() => param("nbp_systolic", 118)).toThrow(TypeError);
  });

  it("does not lend its change time to a silent monitor's last-sent time", () => {
    const hr = param("hr", 72, { last_at: "2026-10-08T09:59:00+00:00" });
    const nbpNewer = param("nbp", [118, 79, 92], { last_at: "2026-10-08T09:59:30+00:00" });
    expect(lastSeenMs(bed("REA-01 · 2", [hr, nbpNewer], { status: "silent" }))).toBe(Date.parse("2026-10-08T09:59:00+00:00"));
    expect(lastSeenMs(bed("REA-01 · 2", [nbpNewer], { status: "silent" }))).toBeNull();
  });
});
```

- [ ] **Step 3: See them fail**

```bash
cd /c/tmp/inf-nbp/dashboard
npx vitest run src/live/screens/common/monitor.test.js 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ +Tests |^ +× "
```

Expected:
```
   × NBP's cell: the time its value last changed > shows the three numbers with the time the value changed and how long ago that was …
   × NBP's cell: the time its value last changed > ages the change between polls, and goes old with its packet like any value …
   × NBP's cell: the time its value last changed > takes the server's withholding as it comes and judges no age itself …
   × NBP's cell: the time its value last changed > does not lend its change time to a silent monitor's last-sent time …
      Tests  4 failed | 19 passed (23)
```
Three of the new tests pass before the code: the generic rules already give "awaiting" (`age_s` and `last_at` are null), `***` and the util's refusal — they hold the NBP path to those same answers.

- [ ] **Step 4: The NBP cell, and the silent monitor's time without NBP**

**Edit** `dashboard/src/live/screens/common/monitor.js` — replace:
```js
/**
 * What one parameter's cell may show:
 *   {kind: "value", value, ageS}   a number, fresh (<= maxAgeS) and valid, from a working feed
 *   {kind: "invalid", ageS}        the monitor itself shows "***"
 *   {kind: "old", ageS, lastAt}    anything else — the number is never drawn
 */
export function cellOf(param, { nowMs, fetchedAtMs, maxAgeS = DISPLAY_MAX_AGE_S, feedOk = true } = {}) {
  const ageS = displayAge(param, nowMs, fetchedAtMs);
  const fresh = feedOk && ageS !== null && ageS <= maxAgeS;
  if (fresh && param.state === "value" && Number.isFinite(param.value)) return { kind: "value", value: param.value, ageS };
  if (fresh && param.state === "invalid") return { kind: "invalid", ageS };
  return { kind: "old", ageS, lastAt: param?.last_at ?? null };
}
```
with:
```js
/**
 * What one parameter's cell may show:
 *   {kind: "value", value, ageS}   a number, fresh (<= maxAgeS) and valid, from a working feed
 *   {kind: "nbp", systolic, diastolic, mean, changedAtMs, measuredAgeS, ageS}
 *                                  NBP, fresh and valid, with the time its value last changed — an
 *                                  upper bound of the measurement — and how long ago that was
 *   {kind: "invalid", ageS}        the monitor itself shows "***"
 *   {kind: "old", ageS, lastAt}    anything else — the number is never drawn. For NBP the age is the
 *                                  change's, and `lastAt` null means no change has been seen yet
 */
export function cellOf(param, { nowMs, fetchedAtMs, maxAgeS = DISPLAY_MAX_AGE_S, feedOk = true } = {}) {
  const ageS = displayAge(param, nowMs, fetchedAtMs);
  const fresh = feedOk && ageS !== null && ageS <= maxAgeS;
  if (param?.parameter === "nbp") return nbpCellOf(param, { ageS, fresh, nowMs, fetchedAtMs });
  if (fresh && param.state === "value" && Number.isFinite(param.value)) return { kind: "value", value: param.value, ageS };
  if (fresh && param.state === "invalid") return { kind: "invalid", ageS };
  return { kind: "old", ageS, lastAt: param?.last_at ?? null };
}

/** NBP's cell. The time since its value changed is the server's `measured_age_s`, aged like any
 *  other age; the two-hour limit is the API's (past it the answer says `state: "old"`) and is never
 *  decided here. */
function nbpCellOf(param, { ageS, fresh, nowMs, fetchedAtMs }) {
  const changedAtMs = Date.parse(param.changed_at ?? "");
  if (!Number.isFinite(changedAtMs)) return { kind: "old", ageS: null, lastAt: null };
  const measuredAgeS = displayAge({ age_s: param.measured_age_s }, nowMs, fetchedAtMs);
  const { systolic, diastolic, mean } = param;
  if (fresh && measuredAgeS !== null && param.state === "value" && [systolic, diastolic, mean].every(Number.isFinite)) {
    return { kind: "nbp", systolic, diastolic, mean, changedAtMs, measuredAgeS, ageS };
  }
  if (fresh && param.state === "invalid") return { kind: "invalid", ageS };
  return { kind: "old", ageS: measuredAgeS, lastAt: param.changed_at };
}
```

**Edit** `dashboard/src/live/screens/common/monitor.js` — replace:
```js
/** The newest instant a device's parameters were captured, in ms; null when it holds none. */
export function lastSeenMs(entry) {
  const stamps = (entry?.parameters ?? []).map((p) => Date.parse(p.last_at)).filter(Number.isFinite);
```
with:
```js
/** The newest instant a device's parameters were captured, in ms; null when it holds none. NBP's
 *  entry is left out: withheld, its `last_at` is when its value changed, not when the monitor sent. */
export function lastSeenMs(entry) {
  const stamps = (entry?.parameters ?? []).filter((p) => p.parameter !== "nbp")
    .map((p) => Date.parse(p.last_at)).filter(Number.isFinite);
```

`monitor.test.js:139–143` still holds: no `value <`/`>` against a number and no risk colour anywhere in `monitor.js`.

- [ ] **Step 5: Green, and the dashboard gate**

```bash
cd /c/tmp/inf-nbp/dashboard
npx vitest run src/live/screens/common/monitor.test.js 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ +Tests "
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
```

Expected: `Tests  23 passed (23)`; then ` Test Files  89 passed (89)` and `      Tests  2399 passed (2399)`.

```bash
cd /c/tmp/inf-nbp/dashboard
npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
```

Expected: `✓ built in …`, `precache  20 entries (…)`.

- [ ] **Step 6: Line ends**

```bash
cd /c/tmp/inf-nbp
for f in dashboard/src/live/data/shadow.testutil.js dashboard/src/live/screens/common/monitor.js dashboard/src/live/screens/common/monitor.test.js; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected: `shadow.testutil.js CR=102 LF=102`, `monitor.js CR=157 LF=157`, `monitor.test.js CR=189 LF=189`.

- [ ] **Step 7: Commit**

```bash
cd /c/tmp/inf-nbp
git add dashboard/src/live/data/shadow.testutil.js dashboard/src/live/screens/common/monitor.js dashboard/src/live/screens/common/monitor.test.js
git status --short && git diff --cached --stat
git commit -q -F - <<'MSG'
feat(dashboard): monitor.js decides what the NBP cell may show

cellOf gives the API's nbp entry its own kind — the three numbers, the time
the value changed and how long ago — while the server says value and the
packet is fresh; otherwise ***, or old aged by the change, or old with no time
at all when no change was seen yet. The two-hour limit stays the API's: the
browser draws the server's verdict as it comes. lastSeenMs leaves NBP out
(X41). The test util builds the nbp entry and refuses a wire name.

red: 4 failed, 19 passed (src/live/screens/common/monitor.test.js)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
git log --oneline -1
```

---

### Task 6: The strip draws one NBP cell — `S/D (M) mmHg · ölçmə ≤ HH:MM (N dəq)`

Spec D7, §5 (`MonitorStrip.jsx`). The `nbp` kind renders the three numbers, the unit and `monitor.nbpMeasured` — the change's `hhmm` and its age in the board's words — all `aria-hidden`, with one `sr-only` sentence (`monitor.nbpSaid`: "118 bölü 79, orta 92 mmHg; ölçmə 09:50 və ya daha əvvəl, 10 dəq əvvəl"). The cell spans two columns of the strip's grid (both variants share it). "Awaiting" is a dash and `monitor.nbpWaiting` in `text-mute` — not "köhnə", because nothing went old: nothing was seen. A withheld NBP is the existing old cell, aged by the change ("köhnə · 3 saat"). The full variant's evidence line reads `ev.screen_match` ("Monitor ekranı ilə eynidir"). Nothing is coloured by a value; no live region, no focusable element; the `sr-only` text sits inside the positioned `<section>` (X36).

The sweep (`rawKeys.test.jsx`) gets an NBP with its time on the fixture's card and one awaiting a change on a bed without a patient, and anchors the three new keys on the beds screen.

**Files:**
- Modify: `dashboard/src/live/screens/common/MonitorStrip.test.jsx` (the import; a new `describe` before "nothing on it can be taken for an alarm", whose colour sweep gains an NBP)
- Modify: `dashboard/src/live/rawKeys.test.jsx` (the `STRIP` fixture 151–165; the monitor strip's anchor 344–358)
- Modify: `dashboard/src/live/screens/common/MonitorStrip.jsx` (the header's note; a new `NbpValue`; `Cell`)

- [ ] **Step 1: Write the failing tests**

**Edit** `dashboard/src/live/screens/common/MonitorStrip.test.jsx` — replace:
```jsx
import { AT, STAGE_OFF, bed, param, strip, unassigned } from "../../data/shadow.testutil.js";
```
with:
```jsx
import { AT, NBP_CHANGED_AT, STAGE_OFF, bed, param, strip, unassigned } from "../../data/shadow.testutil.js";
```

**Edit** `dashboard/src/live/screens/common/MonitorStrip.test.jsx` — replace:
```jsx
describe("nothing on it can be taken for an alarm", () => {
  const RISKY = ["bg-crit", "text-crit", "bg-high", "text-high", "bg-mid", "bg-low", "bg-ok", "text-ok",
    "text-v-hr", "text-v-map", "text-v-spo", "text-v-rr", "text-v-t"];

  it("carries no risk or vital-identity colour, no live region and no alert", () => {
    const { container } = show(
      <>
        <Strip entry={card([HR, param("spo2", null), param("art_mean", 84), param("hr", 72, { age_s: 40 })])} variant="full" />
```
with:
```jsx
describe("NBP, with the time its value last changed", () => {
  const NBP = param("nbp", [118, 79, 92]);                 // changed ten minutes before AT
  const TIME = hhmm(Date.parse(NBP_CHANGED_AT));

  it("shows S/D (M), the unit, and «ölçmə ≤ HH:MM» with how long ago", () => {
    show(<Strip entry={card([HR, NBP])} />);
    const [, nbp] = within(region()).getAllByRole("definition");
    expect(within(region()).getAllByRole("term")[1]).toHaveTextContent("NBP");
    expect(nbp).toHaveTextContent("118/79 (92)");
    expect(nbp).toHaveTextContent("mmHg");
    expect(nbp).toHaveTextContent(`ölçmə ≤ ${TIME} (10 dəq)`);
  });

  it("tells a screen reader the numbers and that the cuff measured at or before that time", () => {
    const { unmount } = show(<Strip entry={card([NBP])} />);
    expect(within(region()).getByText(`118 bölü 79, orta 92 mmHg; ölçmə ${TIME} və ya daha əvvəl, 10 dəq əvvəl`))
      .toHaveClass("sr-only");
    unmount();
    show(<Strip entry={card([NBP])} />, "en");
    expect(screen.getByText(`118 over 79, mean 92 mmHg; measured at or before ${TIME}, 10 min ago`)).toHaveClass("sr-only");
    expect(screen.getByRole("definition")).toHaveTextContent(`measured ≤ ${TIME} (10 min)`);
  });

  it("takes two columns of the strip's grid, and nothing else does", () => {
    show(<Strip entry={card([HR, NBP])} />);
    const [hr, nbp] = within(region()).getAllByRole("term").map((term) => term.parentElement);
    expect(nbp.className.split(/\s+/)).toContain("col-span-2");
    expect(hr.className.split(/\s+/)).not.toContain("col-span-2");
  });

  it("awaits a measurement when no change was seen since the hub started: a dash, no number, no age", () => {
    show(<Strip entry={card([HR, param("nbp", null)])} />);
    const [, nbp] = within(region()).getAllByRole("definition");
    expect(nbp).toHaveTextContent("—");
    expect(nbp).toHaveTextContent("ölçmə gözlənilir");
    expect(nbp).not.toHaveTextContent("köhnə");
    expect(nbp).not.toHaveTextContent(/\d/);
  });

  it("withholds the numbers when the server does, and says how long ago the value changed", () => {
    const withheld = param("nbp", null, { changed_at: NBP_CHANGED_AT, last_at: NBP_CHANGED_AT, age_s: 7300, measured_age_s: 7300 });
    show(<Strip entry={card([withheld])} />);
    const nbp = within(region()).getByRole("definition");
    expect(nbp).toHaveTextContent("—");
    expect(nbp).toHaveTextContent("köhnə · 3 saat");                // 2 h 1 min 40 s, rounded up
    expect(nbp).not.toHaveTextContent("ölçmə");
  });

  it("draws no NBP number off a dead feed, and still says how long ago it changed", () => {
    show(<Strip entry={card([NBP])} feedOk={false} />);
    const nbp = within(region()).getByRole("definition");
    expect(nbp).not.toHaveTextContent("118");
    expect(nbp).toHaveTextContent("köhnə · 10 dəq");
  });

  it("names its evidence in the full variant", () => {
    show(<Strip variant="full" entry={card([NBP])} />);
    expect(within(region()).getByText("Monitor ekranı ilə eynidir")).toBeInTheDocument();
  });
});

describe("nothing on it can be taken for an alarm", () => {
  const RISKY = ["bg-crit", "text-crit", "bg-high", "text-high", "bg-mid", "bg-low", "bg-ok", "text-ok",
    "text-v-hr", "text-v-map", "text-v-spo", "text-v-rr", "text-v-t"];

  it("carries no risk or vital-identity colour, no live region and no alert", () => {
    const { container } = show(
      <>
        <Strip entry={card([HR, param("spo2", null), param("art_mean", 84), param("hr", 72, { age_s: 40 }),
          param("nbp", [118, 79, 92])])} variant="full" />
```

(The strip's `NOW` is `AT` + 5 s and the answer was read at `NOW`, so the change is 600 s old: "10 dəq". `hhmm` is the browser's local time, which the tests compute the same way.)

**Edit** `dashboard/src/live/rawKeys.test.jsx` — replace:
```jsx
/** Aşama A's monitor strip, on: a monitor on the fixture's card (a value, a `***`, a partly checked
 *  parameter, an old one), a bed with no patient, a bed with two monitors, a silent one, a device
 *  the table leaves unplaced and one it does not list. The beds, patient, devices and settings
 *  screens draw it; without it every `monitor.*` string was outside the sweep. Synthetic devices
 *  only (shadow.testutil.js). */
const STRIP = strip({
  beds: [
    bed("REA-01 · 1", [param("hr", 96), param("spo2", null), param("art_mean", 84), param("respiration", 18, { age_s: 40 })],
      { link: "one", patient_id: FIXTURE_ID }),
    bed("REA-01 · 3", [param("temperature", 37.1)]),
```
with:
```jsx
/** Aşama A's monitor strip, on: a monitor on the fixture's card (a value, a `***`, a partly checked
 *  parameter, an old one, an NBP with the time it changed), a bed with no patient (its NBP awaiting a
 *  change), a bed with two monitors, a silent one, a device the table leaves unplaced and one it does
 *  not list. The beds, patient, devices and settings screens draw it; without it every `monitor.*`
 *  string was outside the sweep. Synthetic devices only (shadow.testutil.js). */
const STRIP = strip({
  beds: [
    bed("REA-01 · 1", [param("hr", 96), param("spo2", null), param("art_mean", 84), param("respiration", 18, { age_s: 40 }),
      param("nbp", [118, 79, 92])], { link: "one", patient_id: FIXTURE_ID }),
    bed("REA-01 · 3", [param("temperature", 37.1), param("nbp", null)]),
```

**Edit** `dashboard/src/live/rawKeys.test.jsx` — replace:
```jsx
    expect(screen.getByText("Monitor məlumat göndərir; göstəriləcək dəyər yoxdur")).toBeInTheDocument(); // monitor.noValues
    act(() => { mounted.board.clear(); mounted.shadow.clear(); });
```
with:
```jsx
    expect(screen.getByText("Monitor məlumat göndərir; göstəriləcək dəyər yoxdur")).toBeInTheDocument(); // monitor.noValues
    expect(screen.getByText(/^ölçmə ≤ \d\d:\d\d \(10 dəq\)$/)).toBeInTheDocument();                   // monitor.nbpMeasured
    expect(screen.getByText(/^118 bölü 79, orta 92 mmHg; ölçmə \d\d:\d\d/)).toHaveClass("sr-only"); // monitor.nbpSaid
    expect(screen.getByText("ölçmə gözlənilir")).toBeInTheDocument();                                 // monitor.nbpWaiting
    act(() => { mounted.board.clear(); mounted.shadow.clear(); });
```

- [ ] **Step 2: See them fail**

```bash
cd /c/tmp/inf-nbp/dashboard
npx vitest run src/live/screens/common/MonitorStrip.test.jsx src/live/rawKeys.test.jsx 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ +Tests |^ +× |^TestingLibraryElementError" | cut -c1-150
```

Expected:
```
   × NBP, with the time its value last changed > shows S/D (M), the unit, and «ölçmə ≤ HH:MM» with how long ago …
   × NBP, with the time its value last changed > tells a screen reader the numbers and that the cuff measured at or before that time …
   × NBP, with the time its value last changed > takes two columns of the strip's grid, and nothing else does …
   × NBP, with the time its value last changed > awaits a measurement when no change was seen since the hub started: a dash, no number, no age …
   × no screen shows a reader a translation key > the monitor strip's keys resolve on the beds screen, on a card, in the section and in the chip …
TestingLibraryElementError: Found multiple elements with the text: /^köhnə · /
TestingLibraryElementError: Unable to find an element with the text: 118 bölü 79, orta 92 mmHg; ölçmə …
      Tests  5 failed | 37 passed (42)
```
Today's `Cell` draws the `nbp` kind as an old cell, so the sweep finds a second "köhnə ·". The withheld, dead-feed and evidence tests pass already: the old cell and the evidence line are the generic ones, aged by the change since Task 5.

- [ ] **Step 3: The NBP cell**

**Edit** `dashboard/src/live/screens/common/MonitorStrip.jsx` — replace:
```jsx
//   * every value with its age; an old one is a dash and "eski", never a number;
```
with:
```jsx
//   * every value with its age; an old one is a dash and "eski", never a number; NBP with the time
//     its value last changed, written "≤" because the cuff measured then or earlier;
```

**Edit** `dashboard/src/live/screens/common/MonitorStrip.jsx` — replace:
```jsx
const KNOWN = new Set(PARAM_ORDER);

function Cell({ param, nowMs, fetchedAtMs, maxAgeS, feedOk, full }) {
  const { t } = useI18n();
  const cell = cellOf(param, { nowMs, fetchedAtMs, maxAgeS, feedOk });
  const label = t(`monitor.p.${param.parameter}`);
  const unit = UNIT_KEY[param.unit] ? t(UNIT_KEY[param.unit]) : param.unit;
  const age = ageText(t, cell.ageS);
  const said = age ? <span className="sr-only">{` ${t("monitor.age", { age })}`}</span> : null;
  return (
    <div className="min-w-0">
      <dt className="flex flex-wrap items-center gap-1 font-text text-10 font-bold uppercase leading-[normal] tracking-[.06em] text-mute">
        {label}
        {param.partial ? <StatusPill tone="neutral">{t("monitor.partial")}</StatusPill> : null}
      </dt>
      <dd className="m-0 font-data text-14 font-bold text-ink">
        {cell.kind === "value" ? (
```
with:
```jsx
const KNOWN = new Set(PARAM_ORDER);

/** NBP's numbers and the time its value last changed — an upper bound of the measurement ("≤"). */
function NbpValue({ cell, unit }) {
  const { t } = useI18n();
  const { systolic, diastolic, mean } = cell;
  const time = hhmm(cell.changedAtMs);
  const age = ageText(t, cell.measuredAgeS);
  return (
    <>
      <span aria-hidden="true">{`${systolic}/${diastolic} (${mean})`}</span>
      <small aria-hidden="true" className="ml-0.5 font-text text-10.5 font-semibold text-mute">{unit}</small>
      <small aria-hidden="true" className="ml-1 font-text text-10.5 font-semibold text-mute">
        {t("monitor.nbpMeasured", { time, age })}
      </small>
      <span className="sr-only">{t("monitor.nbpSaid", { systolic, diastolic, mean, unit, time, age })}</span>
    </>
  );
}

function Cell({ param, nowMs, fetchedAtMs, maxAgeS, feedOk, full }) {
  const { t } = useI18n();
  const cell = cellOf(param, { nowMs, fetchedAtMs, maxAgeS, feedOk });
  const label = t(`monitor.p.${param.parameter}`);
  const unit = UNIT_KEY[param.unit] ? t(UNIT_KEY[param.unit]) : param.unit;
  const age = ageText(t, cell.ageS);
  const said = age ? <span className="sr-only">{` ${t("monitor.age", { age })}`}</span> : null;
  const nbp = param.parameter === "nbp";
  return (
    // NBP's line is two cells wide: three numbers, a unit and the time they changed.
    <div className={nbp ? "col-span-2 min-w-0" : "min-w-0"}>
      <dt className="flex flex-wrap items-center gap-1 font-text text-10 font-bold uppercase leading-[normal] tracking-[.06em] text-mute">
        {label}
        {param.partial ? <StatusPill tone="neutral">{t("monitor.partial")}</StatusPill> : null}
      </dt>
      <dd className="m-0 font-data text-14 font-bold text-ink">
        {cell.kind === "nbp" ? (
          <NbpValue cell={cell} unit={unit} />
        ) : cell.kind === "value" ? (
```

**Edit** `dashboard/src/live/screens/common/MonitorStrip.jsx` — replace:
```jsx
            {age ? <small aria-hidden="true" className="ml-1 font-text text-10.5 font-semibold text-mute">{age}</small> : null}
            {said}
          </>
        ) : (
          <>
            <span aria-hidden="true">—</span>
            <small className="ml-1 font-text text-10.5 font-semibold text-att-ink">{t("monitor.old", { age: age ?? "—" })}</small>
          </>
        )}
```
with:
```jsx
            {age ? <small aria-hidden="true" className="ml-1 font-text text-10.5 font-semibold text-mute">{age}</small> : null}
            {said}
          </>
        ) : nbp && cell.lastAt === null ? (
          <>
            <span aria-hidden="true">—</span>
            <small className="ml-1 font-text text-10.5 font-semibold text-mute">{t("monitor.nbpWaiting")}</small>
          </>
        ) : (
          <>
            <span aria-hidden="true">—</span>
            <small className="ml-1 font-text text-10.5 font-semibold text-att-ink">{t("monitor.old", { age: age ?? "—" })}</small>
          </>
        )}
```

(The first of those `age ?` lines is the `invalid` branch's; the old text is unique because it runs on into the old cell.)

- [ ] **Step 4: Green, and the dashboard gate**

```bash
cd /c/tmp/inf-nbp/dashboard
npx vitest run src/live/screens/common/MonitorStrip.test.jsx src/live/rawKeys.test.jsx 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ +Tests "
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
```

Expected: `Tests  42 passed (42)`; then ` Test Files  89 passed (89)` and `      Tests  2406 passed (2406)`.

```bash
cd /c/tmp/inf-nbp/dashboard
npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
```

Expected: `✓ built in …`, `precache  20 entries (…)`, no `larger than`.

- [ ] **Step 5: Line ends**

```bash
cd /c/tmp/inf-nbp
for f in dashboard/src/live/screens/common/MonitorStrip.jsx dashboard/src/live/screens/common/MonitorStrip.test.jsx dashboard/src/live/rawKeys.test.jsx; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected: `MonitorStrip.jsx CR=207 LF=207`, `MonitorStrip.test.jsx CR=288 LF=288`, `rawKeys.test.jsx CR=527 LF=527`.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/inf-nbp
git add dashboard/src/live/screens/common/MonitorStrip.jsx dashboard/src/live/screens/common/MonitorStrip.test.jsx dashboard/src/live/rawKeys.test.jsx
git status --short && git diff --cached --stat
git commit -q -F - <<'MSG'
feat(dashboard): the strip draws one NBP cell with the time its value changed

"NBP 118/79 (92) mmHg · ölçmə ≤ 09:50 (10 dəq)", two columns wide, with one
screen-reader sentence ("… ölçmə 09:50 və ya daha əvvəl, 10 dəq əvvəl").
Before a change is seen: a dash and "ölçmə gözlənilir" (muted: nothing went
old); withheld by the server: the old cell, aged by the change. No colour from
a value, no live region. The sweep reaches the three new keys.

red: 5 failed, 37 passed — the nbp kind drawn as an old cell; rawKeys found two «köhnə ·» (MonitorStrip.test.jsx, rawKeys.test.jsx)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
git log --oneline -1
```

---

### Task 7: The Settings legend says how NBP is shown — and when it is not

Spec §5 (`SettingsScreen.jsx` legend). Since Task 3 the legend's evidence table has an NBP row ("Monitor ekranı ilə eynidir"), because it iterates the API's `PARAM_ORDER`; `SettingsScreen.jsx` itself does not change. What changes is `legendNbp`, in four languages: it no longer says NIBP is not shown, it says what the time means (an upper bound: the cuff measured then or earlier, an identical re-measurement is not seen), that an NBP whose value has not changed for more than 2 hours is not shown, and that after the hub restarts NBP waits for the next measurement. The test that quoted the old sentence (`SettingsScreen.test.jsx:157`) quotes the new one and checks the NBP row's evidence.

**Files:**
- Modify: `dashboard/src/live/screens/settings/SettingsScreen.test.jsx` (the legend test 151–169)
- Modify: `dashboard/src/live/i18n/strings/monitor.js` (the header's NBP sentence; `legendNbp` in tr, az, ru, en)

- [ ] **Step 1: The legend's test quotes what it will say**

**Edit** `dashboard/src/live/screens/settings/SettingsScreen.test.jsx` — replace:
```jsx
  it("with the stage on explains it: the note, never a sound, the ages, NIBP, the evidence, no sample count", async () => {
```
with:
```jsx
  it("with the stage on explains it: the note, never a sound, the ages, NBP's time, the evidence, no sample count", async () => {
```

**Edit** `dashboard/src/live/screens/settings/SettingsScreen.test.jsx` — replace:
```jsx
    expect(box).toHaveTextContent(/NIBP bu mərhələdə göstərilmir/);
```
with:
```jsx
    expect(box).toHaveTextContent(/NBP dəyərinin son dəyişdiyi vaxtla göstərilir/);
    expect(box).toHaveTextContent(/ölçmə daha əvvəl olmuş ola bilər, heç vaxt daha sonra yox/);   // the time is a bound
    expect(box).toHaveTextContent(/Dəyəri 2 saatdan çox dəyişməyən NBP göstərilmir/);
    expect(box).toHaveTextContent(/növbəti ölçməyə qədər göstərilmir \(«ölçmə gözlənilir»\)/);   // after a hub restart
    expect(box).not.toHaveTextContent(/bu mərhələdə göstərilmir/);
```

**Edit** `dashboard/src/live/screens/settings/SettingsScreen.test.jsx` — replace:
```jsx
    expect(within(rows[0]).getByText("İki cihazda monitor ekranı ilə eynidir")).toBeInTheDocument();
```
with:
```jsx
    expect(within(rows[0]).getByText("İki cihazda monitor ekranı ilə eynidir")).toBeInTheDocument();
    expect(within(rows[9]).getByText("Monitor ekranı ilə eynidir")).toBeInTheDocument();          // NBP
```

- [ ] **Step 2: See it fail**

```bash
cd /c/tmp/inf-nbp/dashboard
npx vitest run src/live/screens/settings/SettingsScreen.test.jsx 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ +Tests |^ +× "
```

Expected:
```
   × SettingsScreen — the monitor strip's legend > with the stage on explains it: the note, never a sound, the ages, NBP's time, the evidence, no sample count …
      Tests  1 failed | 11 passed (12)
```

- [ ] **Step 3: The legend, four languages**

**Edit** `dashboard/src/live/i18n/strings/monitor.js` — replace:
```js
// (`nbpMeasured`: "≤", never "at"); before a change has been seen it says it awaits one
// (`nbpWaiting`).
```
with:
```js
// (`nbpMeasured`: "≤", never "at"); before a change has been seen it says it awaits one
// (`nbpWaiting`); `legendNbp` says both, the 2-hour limit and the hub restart.
```

**Edit** `dashboard/src/live/i18n/strings/monitor.js` — replace:
```js
    legendNbp: "NIBP bu aşamada gösterilmez: ölçüm zamanı çözülmedi, değer saatler önceki bir ölçüm olabilir. Kan basıncını başucu monitöründen okuyun.",
```
with:
```js
    legendNbp: "NBP, değerinin son değiştiği saatle gösterilir. «ölçüm ≤ 10:42», manşonun en geç 10:42'de ölçtüğü demektir: ölçüm daha önce olmuş olabilir, hiçbir zaman daha sonra değil (aynı değerle yinelenen bir ölçüm fark edilmez). Değeri 2 saatten uzun süredir değişmemiş bir NBP gösterilmez. Infinity sunucusu yeniden başladıktan sonra NBP, bir sonraki ölçüme kadar gösterilmez («ölçüm bekleniyor»).",
```

**Edit** `dashboard/src/live/i18n/strings/monitor.js` — replace:
```js
    legendNbp: "NIBP bu mərhələdə göstərilmir: ölçmə vaxtı deşifrə olunmayıb, dəyər saatlar əvvəlki ölçmə ola bilər. Qan təzyiqini çarpayı yanındakı monitordan oxuyun.",
```
with:
```js
    legendNbp: "NBP dəyərinin son dəyişdiyi vaxtla göstərilir. «ölçmə ≤ 10:42» manjetin ən gec 10:42-də ölçdüyü deməkdir: ölçmə daha əvvəl olmuş ola bilər, heç vaxt daha sonra yox (eyni dəyərlə təkrarlanan ölçmə fərq edilmir). Dəyəri 2 saatdan çox dəyişməyən NBP göstərilmir. Infinity serveri yenidən başladıqdan sonra NBP növbəti ölçməyə qədər göstərilmir («ölçmə gözlənilir»).",
```

**Edit** `dashboard/src/live/i18n/strings/monitor.js` — replace:
```js
    legendNbp: "НИАД на этом этапе не показывается: время измерения не декодировано, значение может быть многочасовой давности. Смотрите давление на прикроватном мониторе.",
```
with:
```js
    legendNbp: "НИАД (NBP) показывается со временем последнего изменения значения. «измерение ≤ 10:42» значит, что манжета измерила не позже 10:42: измерение могло быть раньше, но никогда не позже (повторное измерение с тем же значением не распознаётся). НИАД, значение которого не менялось больше 2 часов, не показывается. После перезапуска сервера Infinity НИАД не показывается до следующего измерения («ожидается измерение»).",
```

**Edit** `dashboard/src/live/i18n/strings/monitor.js` — replace:
```js
    legendNbp: "NIBP is not shown at this stage: its measurement time is not decoded, so the value may be hours old. Read blood pressure on the bedside monitor.",
```
with:
```js
    legendNbp: "NBP is shown with the time its value last changed. «measured ≤ 10:42» means the cuff measured at 10:42 at the latest: the measurement may have been earlier, never later (a re-measurement with the same values is not detected). An NBP whose value has not changed for more than 2 hours is not shown. After the Infinity server restarts, NBP is not shown until the next measurement («awaiting a measurement»).",
```

"10:42" is an example in the sentence, not a placeholder; the placeholders of `legendNbp` (none) are the same in all four.

- [ ] **Step 4: Green, and the dashboard gate**

```bash
cd /c/tmp/inf-nbp/dashboard
npx vitest run src/live/screens/settings/SettingsScreen.test.jsx src/live/i18n/strings.test.js 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ +Tests "
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
```

Expected: `Tests  18 passed (18)`; then ` Test Files  89 passed (89)` and `      Tests  2406 passed (2406)`.

```bash
cd /c/tmp/inf-nbp/dashboard
npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
```

Expected: `✓ built in …`, `precache  20 entries (…)`.

- [ ] **Step 5: Line ends**

```bash
cd /c/tmp/inf-nbp
for f in dashboard/src/live/i18n/strings/monitor.js dashboard/src/live/screens/settings/SettingsScreen.test.jsx; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected: `strings/monitor.js CR=304 LF=304`, `SettingsScreen.test.jsx CR=181 LF=181`.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/inf-nbp
git add dashboard/src/live/i18n/strings/monitor.js dashboard/src/live/screens/settings/SettingsScreen.test.jsx
git status --short && git diff --cached --stat
git commit -q -F - <<'MSG'
feat(dashboard): the legend says how NBP is shown, and when it is not

legendNbp, four languages: NBP with the time its value last changed — the cuff
measured then or earlier, an identical re-measurement is not seen —, withheld
once the value has not changed for 2 hours, and waiting for the next
measurement after the hub restarts. The legend's table has carried the NBP row
since the API commit; its test now checks the row's evidence.

red: 1 failed, 11 passed — the legend still said NIBP is not shown (SettingsScreen.test.jsx)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
git log --oneline -1
```

---

### Task 8: The gates, and the hub's release R4

Everything runs once more, in full, and the hub's release is built from the branch head. No repo file changes in this task.

**What the release is** (`deploy/infinity/build_transport_release.py`, read whole): one tarball holding `app/run_infinity_transport.py`, nine modules of `homunculus/edge/` (`__init__`, `infinity_stream`, `infinity_journal`, `infinity_collector`, `infinity_hub`, `infinity_live`, `infinity_records`, `infinity_timing`, `infinity_shadow`), its own stub `homunculus/__init__.py` (the repo's would import the clinical engine), `SHA256SUMS` and `RELEASE.json`. Files are read **from git at a commit** (`HEAD` by default), never from the working copy, so only committed code goes out, with git's LF line ends. The release is **named after its files' hash** (`transport-` + 16 hex of the sums): the same files always give the same name, whatever the commit; the tarball's own sha256 differs per commit (`RELEASE.json` names the commit, and the tar's mtimes are the commit's time).

**Why `edge/` is enough for this slice:** the hub's whole change is in `edge/infinity_live.py` (Task 1) and `edge/infinity_shadow.py` (Task 4); the forwarder's one new import is `.infinity_live`; nothing outside `edge/` and the standard library is imported by either (the isolation test's import check, Task 3/4, holds `edge/infinity_shadow.py` to it). The API and web change goes out as images built on the VM (Task 10), not in this release; the worker does not change.

- [ ] **Step 1: The engine, no database**

```bash
cd /c/tmp/inf-nbp/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -1
```

Expected: `2178 passed, 650 skipped, 3 warnings in …` — the base's 2143 plus this slice's 35.

- [ ] **Step 2: Postgres is not needed — say so with evidence**

```bash
cd /c/tmp/inf-nbp
grep -ln "TEST_DATABASE_URL\|postgres" $(git diff --name-only 14c208d HEAD -- homunculus-engine/tests); echo "grep exit $?"
ls homunculus-engine/alembic/versions | tail -1
```

Expected: no file name, `grep exit 1` — none of the touched test files reads the test database (the shadow store is memory only); and `0011_users_must_change_password.py`: no migration in this slice.

- [ ] **Step 3: Python 3.14, the touched files and their neighbours**

```bash
cd /c/tmp/inf-nbp/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/g115-py314/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_infinity_live.py tests/test_infinity_records.py tests/test_infinity_shadow_forwarder.py tests/test_infinity_shadow_store.py tests/test_infinity_shadow_api.py tests/test_infinity_shadow_check.py tests/test_infinity_shadow_equivalence.py tests/test_infinity_shadow_isolation.py tests/test_infinity_shadow_config.py tests/test_infinity_release.py 2>&1 | tail -1
```

Expected: `256 passed, 3 warnings in …`.

- [ ] **Step 4: The dashboard suite and build**

```bash
cd /c/tmp/inf-nbp/dashboard
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
```

Expected: ` Test Files  89 passed (89)` and `      Tests  2406 passed (2406)`.

```bash
cd /c/tmp/inf-nbp/dashboard
npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
```

Expected: `✓ built in …`, `precache  20 entries (…)`, no `larger than`.

- [ ] **Step 5: The hub's code changed in exactly two edge files**

```bash
cd /c/tmp/inf-nbp
git diff --stat 14c208d HEAD -- homunculus-engine/src/homunculus/edge homunculus-engine/scripts/run_infinity_transport.py
git status --short
```

Expected: `.../src/homunculus/edge/infinity_live.py | 48 +++…`, `.../src/homunculus/edge/infinity_shadow.py | 30 ++…`, `2 files changed, …`; no status line (everything committed — the builder reads git).

- [ ] **Step 6: Build R4, and the base for comparison**

```bash
cd /c/tmp/inf-nbp
/c/tmp/f7-py312/venv/Scripts/python.exe deploy/infinity/build_transport_release.py --output /c/tmp/infinity-a-releases
BASE=$(mktemp -d) && /c/tmp/f7-py312/venv/Scripts/python.exe deploy/infinity/build_transport_release.py --output "$BASE" --commit 14c208d | cut -c1-48
```

Expected: one JSON line `{"release": "transport-c1f619bf4e1df375", "tarball": "C:\\tmp\\infinity-a-releases\\transport-c1f619bf4e1df375.tar.gz", "sha256": "<64 hex>"}` — **write the sha256 down: Task 10 needs it** (R4_SHA). Then `{"release": "transport-3940346adc66ca7b", …` — the base rebuilds R3, the release the hub runs today, so the two edge files are the whole difference. Any other R4 name means an edge file is not byte-for-byte the plan's: stop and compare with `/c/tmp/homunculus-plans/nbp/reference.patch`.

- [ ] **Step 7: Inspect the release before it leaves**

```bash
cd /c/tmp/infinity-a-releases
REL=transport-c1f619bf4e1df375
tar -tzf $REL.tar.gz | wc -l
D=$(mktemp -d) && tar -xzf $REL.tar.gz -C "$D" && cd "$D/$REL" && sha256sum -c --quiet SHA256SUMS && echo "SUMS OK"
/c/tmp/f7-py312/venv/Scripts/python.exe -I -c "import sys; sys.path.insert(0, 'app/src'); import homunculus, homunculus.edge.infinity_shadow as s, homunculus.edge.infinity_live as l; print(homunculus.__doc__, s.SCHEMA, s.FORWARDED[-3:], l.NBP_CONTINUITY_S)"
cat RELEASE.json
```

Expected: `13`; `SUMS OK`; `Isolated Infinity research package. homunculus.infinity-shadow.v2 ('nbp_systolic', 'nbp_diastolic', 'nbp_mean') 3.0` (the stub package, not the repo's: the release imports nothing of the clinical engine); `RELEASE.json` names `transport-c1f619bf4e1df375` and this branch's head commit (`git rev-parse HEAD`).

No commit: nothing in the repo changed. (`dist/` and the temp folders are outside git.)

---

### Task 9: The docs say how NBP is shown now, and why its time is a bound

Five documents, each where a reader already looks: the records doc (the paragraph that said "NBP şeritte yoktur"), the deploy README (R3 said "never NBP"; R4 and its drop-in, order and rollback are new), the Aşama A plan (three places that recommended excluding NBP get a "superseded" note — history is kept, not rewritten), the Turkish guide (the strip's paragraph), and the design-integration roadmap (it has no Aşama A row — X44 — so one is added under G2-01). The guide is Turkish, so it quotes the tr text ("ölçüm ≤"); the strip's default language says "ölçmə ≤" (X42).

**Files:**
- Modify: `docs/INFINITY-PARAMETER-RECORDS.md` (134–140)
- Modify: `deploy/infinity/README.md` (353–356; after 362)
- Modify: `docs/superpowers/plans/2026-10-15-infinity-asama-a-golge.md` (after 188; 304; 529)
- Modify: `docs/homunculus-rehber-TR.md` (after 1106)
- Modify: `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` (after the G2-01 row, 31)

- [ ] **Step 1: The records doc**

**Edit** `docs/INFINITY-PARAMETER-RECORDS.md` — replace:
```markdown
  işaretlediği değer sayı olarak değil `***` olarak çizilir. **NBP şeritte yoktur, bilerek:** son
  NBP her pakette geçerli kayıt olarak yinelenir (yukarıda "Geçerlilik bayrağı") ve cihaz zaman
  damgası çözülmediği için manşonun ne zaman ölçtüğü bilinemez. Şeritte yaşı anlamsız tek değer
  olurdu; hastanın değiştiği bir yatakta önceki hastanın NBP'si de olabilirdi. NBP başucu
  monitöründen okunur.
```
with:
```markdown
  işaretlediği değer sayı olarak değil `***` olarak çizilir.
- **NBP şeritte, değerinin son değiştiği saatle (NBP dilimi, hub sürümü R4).** Son NBP her pakette
  geçerli kayıt olarak yinelenir (yukarıda "Geçerlilik bayrağı") ve cihaz zaman damgası
  çözülmediği için paketin yaşı manşonun ne zaman ölçtüğünü söylemez. Hub bunun yerine, cihaz
  başına (sistolik, diyastolik, ortalama) üçlüsünün **değiştiği** paketin alınış saatini tutar:
  ölçüm o anda ya da daha önce olmuştur, saat bir **üst sınırdır** ve şerit "ölçüm ≤ SS:DD (N dk)"
  yazar. Üçlü, ancak cihazın NBP kaydı son 3 saniye içinde duyulmuşken değişirse saatini alır; bir
  kesintiden (ağ, cihaz) sonra görülen değişikliğin saati bilinmez, çünkü kesintinin herhangi bir
  anında olmuş olabilir. Hub yeniden başladıktan sonra, ya da böyle bir kesintiden sonra, NBP bir
  sonraki ölçüme kadar gösterilmez ("ölçüm bekleniyor"); değeri 2 saatten uzun süredir
  değişmemiş NBP gösterilmez (API). Aynı değerle yinelenen bir ölçüm fark edilmez: saat
  gerçeğinden eski kalır, hiçbir zaman yeni değil. Üç bileşen tek bir pakette, geçerli ve tam
  gelmelidir; eksik ya da `***` bileşenli paket ne değişiklik sayılır ne de tutulan üçlüyü siler.
  Hastanın değiştiği bir yatakta önceki hastanın NBP'si, yeni ölçüme ya da 2 saate kadar
  görünebilir; cihaz→hasta bağı geldiğinde (Aşama B) bağ değişince NBP sıfırlanacak.
```

- [ ] **Step 2: The deploy README — R3 is what it was, R4 is new**

**Edit** `deploy/infinity/README.md` — replace:
```markdown
  reads the live view every 5 s and posts at most one value per parameter per device, only
  values younger than 3 s, never NBP.
```
with:
```markdown
  reads the live view every 5 s and posts at most one value per parameter per device, only
  values younger than 3 s, never NBP (R4, below, adds NBP).
```

**Edit** `deploy/infinity/README.md` — replace:
```markdown
  the forwarder ON (journal line `Shadow display forwarding ENABLED`). Created 2026-10-19
  09:00:13 UTC.
```
with:
```markdown
  the forwarder ON (journal line `Shadow display forwarding ENABLED`). Created 2026-10-19
  09:00:13 UTC.

**R4 — NBP on the strip** (spec `docs/superpowers/specs/2026-10-22-infinity-nbp-degisim-saati-design.md`,
plan `docs/superpowers/plans/2026-10-22-infinity-nbp-degisim-saati.md`):

- Release R4 `/opt/homunculus-infinity/transport-c1f619bf4e1df375`: R3 plus, in the live view, the
  time each device's NBP triple last changed (kept only when the device's NBP was heard within 3 s
  before the change), and the forwarder's schema `homunculus.infinity-shadow.v2` — NBP's three
  readings with `changed_at`, sent only once a change has been seen since the hub started. The
  name is the files' hash: the same two edge files always give it.
- `94-nbp.conf` — `92-asama-a-kod.conf` with the release path changed to R4, checked by `diff`
  before it is installed. 93 stays (the forwarder stays on).
- **Order: the API and web first** (they take v1 and v2 and draw `nbp`), **then the hub.** An R4
  hub posting v2 to an older API is refused whole (400), which the forwarder's `failed` counter and
  `shadow_check.py` show. The worker (.74) does not change.
- **Rollback:** delete `94-nbp.conf`, `systemctl daemon-reload`, restart the hub: R3, v1, no NBP;
  the API keeps taking v1. API and web go back by image tag, as for every release.
- `shadow_check.py` prints one more line, `nbp: N cihazda ölçüm saati ≤ ile gösteriliyor (en eski
  M dk önce), W cihazda ölçüm bekleniyor, O cihazda gizli (eski)` — counts and an age, never a
  pressure.
- Deploy record: the blocks are `C:\tmp\infinity-a-releases\NBP-bloklari.txt`; not yet on the VM
  when this was written.
```

- [ ] **Step 3: The Aşama A plan — three notes, the history kept**

**Edit** `docs/superpowers/plans/2026-10-15-infinity-asama-a-golge.md` — replace:
```markdown
- *The cost:* a bed without an arterial line shows no blood pressure on the strip. The legend says that NIBP is withheld on purpose and that the monitor is the place to read it.
```
with:
```markdown
- *The cost:* a bed without an arterial line shows no blood pressure on the strip. The legend says that NIBP is withheld on purpose and that the monitor is the place to read it.

> **Superseded by the NBP slice (user decision 2026-10-22).** NBP is now shown, with the time its value last *changed* as the hub saw it — an upper bound of the measurement ("ölçüm ≤ SS:DD"), kept only for a change seen while the device's NBP was being heard; hidden after a hub start or an outage until the next change, and withheld by the API 2 h after the change. The first reason above is answered by the bound; the third stays open until device→patient links exist (Stage B resets NBP on a link change). Hub release R4 (drop-in `94-nbp.conf`), wire schema `homunculus.infinity-shadow.v2`. Spec `docs/superpowers/specs/2026-10-22-infinity-nbp-degisim-saati-design.md`, plan `docs/superpowers/plans/2026-10-22-infinity-nbp-degisim-saati.md`.
```

**Edit** `docs/superpowers/plans/2026-10-15-infinity-asama-a-golge.md` — replace:
```markdown
| `nbp_*` | — | identical to the screen, but the measurement time is not decoded | **not shown** |
```
with:
```markdown
| `nbp_*` | — | identical to the screen, but the measurement time is not decoded | **not shown** (since the NBP slice: shown as one `nbp` entry, `screen_match`, with the time its value last changed) |
```

**Edit** `docs/superpowers/plans/2026-10-15-infinity-asama-a-golge.md` — replace:
```markdown
3. **NBP is not shown in Stage A.** *Rejected:* **showing it with a "measurement time unknown" mark** (Forwarder, NBP).
```
with:
```markdown
3. **NBP is not shown in Stage A.** *Rejected:* **showing it with a "measurement time unknown" mark** (Forwarder, NBP). *Superseded 2026-10-22:* shown with the time its value last changed, an upper bound, not a mark (the NBP slice's plan, `2026-10-22-infinity-nbp-degisim-saati.md`).
```

- [ ] **Step 4: The Turkish guide — the strip's paragraph**

**Edit** `docs/homunculus-rehber-TR.md` — replace:
```markdown
    sürüm olarak aynı yolla onaylanır. Ayrıntı ve kabul ölçümleri: `deploy/infinity/README.md`,
    "Aşama A" bölümü.
```
with:
```markdown
    sürüm olarak aynı yolla onaylanır. Ayrıntı ve kabul ölçümleri: `deploy/infinity/README.md`,
    "Aşama A" bölümü.
  - **Şeritte NBP (NBP dilimi):** cihaz NBP'nin ne zaman ölçüldüğünü pakette söylemiyor (son
    değeri her pakette yineliyor), bu yüzden şerit NBP'yi **değerinin son değiştiği saatle**
    gösterir: "NBP 118/79 (92) mmHg · ölçüm ≤ 10:42 (12 dk)". "≤" bir **üst sınırdır**: manşon en
    geç o saatte ölçmüştür, daha önce ölçmüş olabilir. Değişiklik ancak hub cihazın NBP'sini son
    3 saniyede duymuşken görülürse saat alır; hub yeniden başladıktan ya da bir kesintiden sonra
    NBP bir sonraki ölçüme kadar "— · ölçüm bekleniyor" yazar. Değeri 2 saatten uzun süredir
    değişmemiş NBP gösterilmez ("— · eski · 3 sa"). Aynı değerle yinelenen ölçüm fark edilmez
    (saat gerçeğinden eski kalır, yeni değil). Hub sürümü R4, drop-in 94; geri alma: 94 silinir
    (hub R3'e, NBP'siz şeride döner). Önce API ve web, sonra hub dağıtılır.
```

- [ ] **Step 5: The roadmap — a row for this slice (X44)**

**Edit** `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` — replace:
```markdown
O4 çözüldü: 2026-10-20) |
```
with:
```markdown
O4 çözüldü: 2026-10-20) |
| A-NBP | Aşama A şeridinde NBP, değerinin son değiştiği saatle ("ölçüm ≤ SS:DD (N dk)"; üst sınır; kesintiden ya da hub başlangıcından sonra bir sonraki ölçüme kadar gizli; değişimden 2 sa sonra gizli) · hub R4 `transport-c1f619bf4e1df375` + drop-in 94, şema `homunculus.infinity-shadow.v2` · spec: [2026-10-22](../specs/2026-10-22-infinity-nbp-degisim-saati-design.md) · plan: [NBP](2026-10-22-infinity-nbp-degisim-saati.md) | Kod ✅ `feat/infinity-nbp` · backend 2178 / 650 (DB'siz), dashboard 89 dosya / 2406 test · **VM: bekliyor** (önce api+web, sonra hub R4; işçi değişmez) · **Açık:** önerilen X37–X45 (kullanıcı onayı), O27–O35 |
```

(The old text is the end of the G2-01 row, which is one long line; it occurs once.)

- [ ] **Step 6: Line ends**

```bash
cd /c/tmp/inf-nbp
for f in docs/INFINITY-PARAMETER-RECORDS.md deploy/infinity/README.md docs/superpowers/plans/2026-10-15-infinity-asama-a-golge.md docs/homunculus-rehber-TR.md docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected, in that order: 234, 442, 2490, 1150, 1293 — each `CR=` equal to its `LF=`.

- [ ] **Step 7: Commit**

```bash
cd /c/tmp/inf-nbp
git add docs/INFINITY-PARAMETER-RECORDS.md deploy/infinity/README.md docs/superpowers/plans/2026-10-15-infinity-asama-a-golge.md docs/homunculus-rehber-TR.md docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md
git status --short && git diff --cached --stat
git commit -q -F - <<'MSG'
docs(infinity): NBP on the strip with the time its value last changed — records, R4, guide, roadmap

The records doc says how NBP is shown and why its time is an upper bound; the
deploy README keeps R3 as it was and adds R4 (release, drop-in 94, API-first
order, rollback, the shadow_check line); the Aşama A plan's three NBP
exclusions get a "superseded" note; the Turkish guide's strip paragraph and a
new roadmap row (there was no Aşama A row: X44) record the slice.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
git log --oneline -1
```

---

### Task 10: The deploy blocks, and the acceptance walk with the user

Spec D8, §6, §9, with X39, X42, X45 and O30. The agent prepares two files outside the repo — a full git bundle of the branch and the block file `C:\tmp\infinity-a-releases\NBP-bloklari.txt` — and then **does not touch the VM**: the user pastes every VM block; the agent runs only the read-only checks marked "ajan" (`shadow_check.py`, `transport_check.py`, over SSH from the workstation, printing counts, ages and hashes, never a value or a token). Order, as D8 says: **API and web first** (they take v1 and v2; with the hub still on R3 the strip looks as before — X39), **then the hub** (R4, drop-in `94-nbp.conf` made from `92-asama-a-kod.conf` and checked by `diff`); the worker is not deployed. Rollback: delete 94 (hub back to R3, v1); API and web by image tag.

What the VM runs today (the G2 slice's record, `docs/superpowers/plans/2026-10-19-g2-vital-egrileri.md`): `/opt/homunculus` on `feat/g2-vital-egrileri` at `0ea1d0551f8bd9420ab415263ddf14081d244a30` (api built at `6407492`, web at `0ea1d05`); the hub on R3 `transport-3940346adc66ca7b` through drop-ins 90 → 92, with 93 turning the forwarder on; the device→bed table version 1, sha `ac5ce1c9549c…`. Block B-1 checks each of these before anything changes and stops if one is not so.

**Files (outside the repo):** `/c/tmp/infinity-a-releases/nbp-<short>.bundle`, `NBP-bloklari.template.txt`, `NBP-bloklari.txt` (the R4 tarball is Task 8's).

- [ ] **Step 1: The bundle**

```bash
cd /c/tmp/inf-nbp
git status --short
SHORT=$(git rev-parse --short=7 HEAD)
git bundle create /c/tmp/infinity-a-releases/nbp-$SHORT.bundle feat/infinity-nbp
git bundle verify /c/tmp/infinity-a-releases/nbp-$SHORT.bundle
sha256sum /c/tmp/infinity-a-releases/nbp-$SHORT.bundle /c/tmp/infinity-a-releases/transport-c1f619bf4e1df375.tar.gz
```

Expected: no status line; `The bundle contains this ref: … refs/heads/feat/infinity-nbp`, `The bundle records a complete history.`, `… is okay`; two sha256 lines (the tarball's is the one Task 8 printed).

- [ ] **Step 2: The block template** — Write `/c/tmp/infinity-a-releases/NBP-bloklari.template.txt` with exactly this text (the `@…@` tokens are filled in Step 3):

```text
=====================================================================================================
 Infinity gölge hattı · NBP (değerinin son değiştiği saatle) — VM'YE ÇIKIŞ BLOKLARI
 Kod ucu @SHORT@ · hub R4 @REL@ · plan: docs/superpowers/plans/2026-10-22-infinity-nbp-degisim-saati.md
=====================================================================================================
Her VM bloğunu kullanıcı yapıştırır. "İş istasyonu" blokları Git Bash'te, "VM" blokları
  ssh -i ~/.ssh/homunculus_vm sysadmin@172.100.101.72
içinde koşar. Ajan yalnız "ajan" yazan salt okunur kontrolleri kendisi koşar.
`bash -eu -o pipefail <<'BLOK'` ile başlayan bloklar ilk hatada durur; "durdum" diyen bir satır =
hiçbir şey değişmedi (aksi yazmıyorsa). Hiçbir token ve hiçbir fizyolojik değer ekrana basılmaz.

DEĞERLER
  Kod ucu (feat/infinity-nbp)       : @HEAD@  (@SHORT@)
  Bundle                            : nbp-@SHORT@.bundle · sha256 @BUNDLE_SHA@
  Hub R4                            : @REL@ · tarball sha256 @REL_SHA@
  Hub R3 (bugün, drop-in 92)        : transport-3940346adc66ca7b
  VM'de beklenen uç (api/web)       : 0ea1d0551f8bd9420ab415263ddf14081d244a30 (feat/g2-vital-egrileri)
  Cihaz→yatak tablosu               : sürüm 1 · sha ac5ce1c9549c (19.10'dan beri; değiştiyse kontrol
                                      satırlarındaki --table-version/--table-sha onunkiyle yazılır)

NE DEĞİŞİYOR
- api + web: şerit NBP'yi tek hücrede, değerinin son değiştiği saatle gösterir ("NBP 118/79 (92)
  mmHg · ölçmə ≤ 10:42 (12 dəq)"); hub v1 konuştukça şerit bugünkü gibidir (NBP hücresi yok).
- hub (yalnız .72): R4 — NBP üçlüsünün değişim saati; forwarder şeması v2. İşçi (.74) DEĞİŞMEZ.
- Göç YOK (alembic 0011'de kalır). Köprü imajı DEĞİŞMEZ.
- SIRA: önce C (api+web), sonra D (hub). Tersi olursa R4'ün v2 gövdesini eski API 400 ile reddeder.

=====================================================================================================
 A) İŞ İSTASYONU
=====================================================================================================
--- A-1 (iş istasyonu, Git Bash, kullanıcı): doğrula ve VM'ye kopyala ------------------------------
cd /c/tmp/infinity-a-releases
echo "@BUNDLE_SHA@  nbp-@SHORT@.bundle" | sha256sum -c -
git -C /c/tmp/inf-nbp bundle verify /c/tmp/infinity-a-releases/nbp-@SHORT@.bundle
echo "@REL_SHA@  @REL@.tar.gz" | sha256sum -c -
ssh -i ~/.ssh/homunculus_vm sysadmin@172.100.101.72 'mkdir -p ~/nbp'
scp -i ~/.ssh/homunculus_vm nbp-@SHORT@.bundle @REL@.tar.gz sysadmin@172.100.101.72:/home/sysadmin/nbp/

Beklenen: iki "OK", "… is okay"; scp sessiz. İşçiye kopya YOK.

--- A-2 (iş istasyonu, ajan — salt okunur): P-önce ---------------------------------------------------
ssh -i ~/.ssh/homunculus_vm sysadmin@172.100.101.72 'python3 - --window 10 --table-version 1 --table-sha ac5ce1c9549c' < /c/tmp/inf-nbp/deploy/infinity/shadow_check.py | grep -E "^(KABUL|RED)|^nbp:|^SONUÇ|^PANO_OZET"

Beklenen: altı KABUL satırı; "nbp: 0 cihazda ölçüm saati ≤ ile gösteriliyor, 0 cihazda ölçüm
bekleniyor, 0 cihazda gizli (eski)" (eski API NBP göstermez); "SONUÇ: KABUL"; PANO_OZET → P-önce
olarak saklanır.

=====================================================================================================
 B) VM — ÖN KONTROL VE GERİ DÖNÜŞ ETİKETLERİ
=====================================================================================================
--- B-1 (VM): ön kontrol; yalnız ~/nbp altına "önce" kayıtları yazar ----------------------------------
bash -eu -o pipefail <<'BLOK'
cd /opt/homunculus/deploy/local
A=$HOME/nbp
UNIT=homunculus-infinity-pilot-hub
D=/etc/systemd/system/$UNIT.service.d
test ! -e $A/image-ids-before.txt || { echo "ÖNCE KAYDI ZATEN VAR (B-1 daha önce koşmuş): üzerine yazmadan durdum, ajana sorun"; exit 1; }
git -C /opt/homunculus log -1 --oneline
test "$(git -C /opt/homunculus rev-parse HEAD)" = 0ea1d0551f8bd9420ab415263ddf14081d244a30 || { echo "VM 0ea1d05'te DEĞİL: durdum, ajana sorun"; exit 1; }
git -C /opt/homunculus status --porcelain
echo "@BUNDLE_SHA@  $A/nbp-@SHORT@.bundle" | sha256sum -c -
git -C /opt/homunculus bundle verify $A/nbp-@SHORT@.bundle
echo "@REL_SHA@  $A/@REL@.tar.gz" | sha256sum -c -
for c in homunculus-api homunculus-web; do echo "$c $(sudo docker inspect -f '{{.Image}} {{.Config.Image}}' $c)"; done | tee $A/image-ids-before.txt
grep -oE '^[A-Z_]+=' .env | sort | tee $A/env-keys-before.txt
grep -q '^INFINITY_CLINICAL_STAGE=shadow$' .env || { echo "AŞAMA shadow DEĞİL: durdum, ajana sorun"; exit 1; }
echo "aşama: shadow"
ls $D
awk '!/^#/ && index($0, "transport-3940346adc66ca7b") {f=1} END {exit !f}' $D/92-asama-a-kod.conf || { echo "92 R3'ü anmıyor: durdum, ajana sorun"; exit 1; }
sudo test -e $D/93-asama-a-golge.conf || { echo "93 YOK (forwarder kapalı): durdum, ajana sorun"; exit 1; }
sudo test ! -e $D/94-nbp.conf || { echo "94 ZATEN VAR: durdum, ajana sorun"; exit 1; }
sudo test ! -e /opt/homunculus-infinity/@REL@ || { echo "R4 ZATEN KURULU: durdum, ajana sorun"; exit 1; }
systemctl is-active $UNIT
systemctl show -p ExecStart $UNIT | grep -o "transport-[0-9a-f]*" | sort -u
df -h / /var/lib/docker
BLOK

Beklenen: "0ea1d05 test(strip): the monitor strip's section is a positioned box …"; status'ta
yalnız .bak dosyaları; iki "OK" ve "is okay"; image-ids-before.txt'te İKİ satır ("sha256:… <imaj
adı>"); "aşama: shadow"; ls'te 90-…, 92-asama-a-kod.conf, 93-asama-a-golge.conf (94 yok); "active";
"transport-3940346adc66ca7b"; diskte en az 3 GiB boş.

--- B-2 (VM): geri dönüş için çalışan api ve web imajlarını etiketle -----------------------------------
bash -eu -o pipefail <<'BLOK'
A=$HOME/nbp
for s in api web; do
  if sudo docker image inspect homunculus-rollback/$s:pre-nbp >/dev/null 2>&1; then
    echo "homunculus-rollback/$s:pre-nbp ZATEN VAR: üzerine yazmadan durdum, ajana sorun"; exit 1
  fi
done
for c in homunculus-api homunculus-web; do
  test "$(sudo docker inspect -f '{{.Image}}' $c)" = "$(awk -v c=$c '$1==c {print $2}' $A/image-ids-before.txt)" \
    || { echo "$c B-1'deki imajda DEĞİL: durdum"; exit 1; }
done
sudo docker tag "$(sudo docker inspect -f '{{.Image}}' homunculus-api)" homunculus-rollback/api:pre-nbp
sudo docker tag "$(sudo docker inspect -f '{{.Image}}' homunculus-web)" homunculus-rollback/web:pre-nbp
sudo docker images | grep homunculus-rollback
BLOK

Beklenen: listede homunculus-rollback/api pre-nbp ve homunculus-rollback/web pre-nbp (eskiler de durur).

=====================================================================================================
 C) VM — ÖNCE API + WEB  (birkaç dakika; derleme sırasında pano çalışır, açılışta kısa bir kesinti)
=====================================================================================================
--- C-1 (VM): kodu al (çalışan konteynerler değişmez) ---------------------------------------------------
bash -eu -o pipefail <<'BLOK'
cd /opt/homunculus
test "$(git rev-parse HEAD)" = 0ea1d0551f8bd9420ab415263ddf14081d244a30 || { echo "HEAD 0ea1d05 DEĞİL: durdum"; exit 1; }
if git rev-parse --verify -q refs/heads/feat/infinity-nbp >/dev/null; then echo "feat/infinity-nbp ZATEN VAR: durdum, ajana sorun"; exit 1; fi
git fetch ~/nbp/nbp-@SHORT@.bundle feat/infinity-nbp:feat/infinity-nbp
git checkout feat/infinity-nbp
test "$(git rev-parse HEAD)" = @HEAD@ || { echo "UÇ @SHORT@ DEĞİL: durdum"; exit 1; }
git log -1 --oneline
git status --porcelain
ls homunculus-engine/alembic/versions | tail -1
BLOK

Beklenen: "@SHORT@ docs(infinity): NBP on the strip …"; status'ta yine yalnız .bak dosyaları;
0011_users_must_change_password.py (göç yok).

--- C-2 (VM): api ve web'i kur ve başlat ----------------------------------------------------------------
bash -eu -o pipefail <<'BLOK'
cd /opt/homunculus/deploy/local
A=$HOME/nbp
sudo docker compose config >/dev/null && echo "compose config OK"
if sudo env BUILD_SHA=$(git -C /opt/homunculus rev-parse --short HEAD) docker compose build api web > $A/build-c2.log 2>&1; then
  echo "build exit=0"
else
  echo "DERLEME BAŞARISIZ: durdum (çalışan konteynerler değişmedi); günlük $A/build-c2.log"; tail -20 $A/build-c2.log; exit 1
fi
tail -3 $A/build-c2.log
sudo docker compose up -d --no-build api web 2>&1 | tail -2
for i in $(seq 1 24); do s=$(sudo docker inspect -f '{{.State.Health.Status}}' homunculus-api); [ "$s" = healthy ] && break; sleep 5; done; echo "api health: $s"
curl -s -o /dev/null -w "health %{http_code}\n" http://172.100.101.72:8080/health
curl -s http://172.100.101.72:8080/ | grep -oE "index-[A-Za-z0-9_-]+\.js" | head -1
sudo docker compose exec -T postgres psql -U homunculus -d homunculus -Atc "select version_num from alembic_version"
systemctl is-active homunculus-infinity-pilot-hub
BLOK

Beklenen: "compose config OK"; "build exit=0"; "api health: healthy"; "health 200"; yeni bir
index-….js adı; 0011; active (hub'a dokunulmadı).

--- C-3 (iş istasyonu, ajan — salt okunur): API v1'i alıyor, şerit bugünkü gibi -------------------------
ssh -i ~/.ssh/homunculus_vm sysadmin@172.100.101.72 'python3 - --window 60 --table-version 1 --table-sha ac5ce1c9549c' < /c/tmp/inf-nbp/deploy/infinity/shadow_check.py | grep -E "^(KABUL|RED)|^nbp:|^SONUÇ|^PANO_OZET"

Beklenen: altı KABUL; "nbp: 0 cihazda … gösteriliyor, 0 cihazda ölçüm bekleniyor, 0 cihazda gizli
(eski)" (hub hâlâ v1: NBP hücresi yok — X39); "SONUÇ: KABUL"; PANO_OZET'in sha256'sı P-önce ile AYNI.
Tarayıcıda (kullanıcı): şerit eskisi gibi; Ayarlar › Səs və bildiriş açıklamasında NBP satırı ve yeni
NBP cümlesi.

=====================================================================================================
 D) VM — SONRA HUB R4  (~1 dk; klinik etkisi yok; araştırma görünümünde ~10 sn boşluk)
=====================================================================================================
--- D-1 (VM): R4'ü kur, 94'ü 92'den üret ve karşılaştır, yalnız hub'ı yeniden başlat -------------------
bash -eu -o pipefail <<'BLOK'
REL=@REL@
SHA=@REL_SHA@
ESKI=92-asama-a-kod.conf
ESKI_REL=transport-3940346adc66ca7b
YENI=94-nbp.conf
UNIT=homunculus-infinity-pilot-hub
D=/etc/systemd/system/$UNIT.service.d
# 0) Ön koşullar: API @SHORT@'te; 92 R3'ü anıyor; 93 var; 94 yok; R4 kurulmamış
test "$(git -C /opt/homunculus rev-parse HEAD)" = @HEAD@ || { echo "API henüz @SHORT@'te DEĞİL (önce C-1, C-2): durdum, hiçbir şey değişmedi"; exit 1; }
awk -v r="$ESKI_REL" '!/^#/ && index($0, r) {f=1} END {exit !f}' $D/$ESKI || { echo "92 R3'ü anmıyor: durdum, hiçbir şey değişmedi"; exit 1; }
sudo test -e $D/93-asama-a-golge.conf || { echo "93 YOK (forwarder kapalı): durdum, hiçbir şey değişmedi"; exit 1; }
sudo test ! -e $D/$YENI || { echo "94 ZATEN VAR: durdum, hiçbir şey değişmedi"; exit 1; }
sudo test ! -e /opt/homunculus-infinity/$REL || { echo "BU RELEASE ZATEN KURULU: durdum, hiçbir şey değişmedi"; exit 1; }
# 1) Arşiv doğru mu?
echo "$SHA  $HOME/nbp/$REL.tar.gz" | sha256sum -c -
# 2) Aç, her dosyayı doğrula, sahipliği öncekilerle aynı yap
sudo tar -xzf "$HOME/nbp/$REL.tar.gz" -C /opt/homunculus-infinity --no-same-owner
sudo sh -c "cd /opt/homunculus-infinity/$REL && sha256sum -c --quiet SHA256SUMS"
echo "DOSYALAR TAMAM"
sudo grep -q '"homunculus.infinity-shadow.v2"' /opt/homunculus-infinity/$REL/app/src/homunculus/edge/infinity_shadow.py
echo "R4: şema v2"
sudo chown -R root:homunculus-infinity-pilot /opt/homunculus-infinity/$REL
sudo chmod -R u=rwX,g=rX,o= /opt/homunculus-infinity/$REL
# 3) 94 = 92'nin aynısı, yalnız release yolu R4: geçici dosyaya yazılır, karşılaştırılır, ancak aynıysa kurulur
TMP=$(mktemp)
{ printf '# Homunculus NBP (R4, değerinin son değiştiği saatle): %s\n' "$REL"; grep -v '^#' $D/$ESKI | sed "s#$ESKI_REL#$REL#g"; } > "$TMP"
diff <(sed "s#$ESKI_REL#R#g" $D/$ESKI | grep -v '^#') <(sed "s#$REL#R#g" "$TMP" | grep -v '^#')
grep -q "$REL" "$TMP"
if grep -q "$ESKI_REL" "$TMP"; then echo "94 HÂLÂ R3'Ü ANIYOR: durdum (94 kurulmadı)"; rm -f "$TMP"; exit 1; fi
echo "AYNI: yalnız release yolu değişti"
sudo install -m 0644 "$TMP" $D/$YENI
rm -f "$TMP"
# 4) Yalnız hub'ı yeniden başlat
sudo systemctl daemon-reload
sudo systemctl restart $UNIT
sleep 8
systemctl is-active $UNIT
systemctl show -p ExecStart $UNIT | grep -o "transport-[0-9a-f]*" | sort -u
sudo journalctl -u $UNIT -n 8 --no-pager
BLOK

Beklenen: "…tar.gz: OK", "DOSYALAR TAMAM", "R4: şema v2", "AYNI: yalnız release yolu değişti",
"active", "@REL@" (yalnız o); günlükte "Infinity research transport; clinical forwarding DISABLED.",
"Shadow display forwarding ENABLED (Stage A, unvalidated; not clinical ingest) every 5 s." ve
"Uvicorn running on https://172.100.101.72:8766". Not: SHA256SUMS tutmazsa blok durur ve klasör
kalır; yeniden denemeden önce ajana sorun.

--- D-2 (iş istasyonu, ajan — salt okunur): hub ve şerit -------------------------------------------------
ssh -i ~/.ssh/homunculus_vm sysadmin@172.100.101.72 'python3 - --window 60' < /c/tmp/inf-nbp/deploy/infinity/transport_check.py | tail -3
ssh -i ~/.ssh/homunculus_vm sysadmin@172.100.101.72 'python3 - --window 300 --table-version 1 --table-sha ac5ce1c9549c' < /c/tmp/inf-nbp/deploy/infinity/shadow_check.py | grep -E "^(KABUL|RED)|^nbp:|^SONUÇ|^PANO_OZET"

Beklenen: transport_check "SONUÇ: KABUL" (hub CPU önceki gibi); shadow_check altı KABUL (gönderim
sayacı artıyor: R4'ün v2 gövdeleri kabul ediliyor); "nbp: 0 cihazda … gösteriliyor, N cihazda ölçüm
bekleniyor, 0 cihazda gizli (eski)" — N, veri gönderen cihaz sayısı: hub yeni başladı, hiçbir yatakta
değişiklik görülmedi (D4); manşon döngüleri geldikçe "gösteriliyor" sayısı artar; "SONUÇ: KABUL";
PANO_OZET'in sha256'sı P-önce ile AYNI (motor NBP'yi hiç okumaz).

=====================================================================================================
 E) KABUL YÜRÜYÜŞÜ (kullanıcı, merkezi istasyon ve başucu; DEĞER YAZILMAZ — yalnız aynı/farklı)
=====================================================================================================
E-1 bed05, bir sonraki manşon ölçümünden sonra: şeritteki NBP S/D (M) merkezi istasyondakiyle AYNI;
    "ölçmə ≤ SS:DD" monitörün NBP saatiyle AYNI ya da EN ÇOK BİR DAKİKA SONRA — asla ÖNCE değil
    (≤ bir üst sınırdır: X45). Önceyse önce monitörün saatini panonun saatiyle karşılaştırın (cihaz
    saati farkı şeridin hatası değildir); farkı ajana yazın. Sonraki döngüde saat ilerler.
E-2 D-1'den hemen sonra veri gönderen her yatak "NBP — ölçmə gözlənilir" der (sayı yok), kendi
    manşon döngüsüne kadar. Monitörde yeni sonuç göründükten sonra 1 dakikada hâlâ "gözlənilir"
    diyen bir yatak varsa DURUN ve ajana söyleyin (O30: cihaz NBP kaydını 3 sn'den seyrek gönderiyor
    olabilir).
E-3 Son değişimden 2 saatten fazla geçmiş bir yatakta (elle NBP ölçülen bir yatak): "— köhnə · 3 saat"
    (2 saati geçince yukarı yuvarlanır: X45); merkezi istasyon değeri göstermeye devam eder — pano
    bilerek daha katıdır. Yürüyüşte böyle bir yatak yoksa "bekliyor" diye yazılır.
E-4 D-2: shadow_check KABUL ve nbp satırı; PANO_OZET P-önce ile aynı.
E-5 Yalıtım: Görev 8'de test_infinity_shadow_isolation.py yeşil; E-4'ün aynı PANO_OZET'i VM'deki kanıt.
E-6 390 px ve 1440 px: NBP hücresi iki sütun, yatay kaydırma yok; dört dil; ekran okuyucu (istersen)
    "118 bölü 79, orta 92 mmHg; ölçmə … və ya daha əvvəl, … əvvəl" der.

=====================================================================================================
 G) GERİ DÖNÜŞ
=====================================================================================================
--- G-1 (VM): hub R3'e (saniyeler; API v1'i almaya devam eder) ------------------------------------------
bash -eu -o pipefail <<'BLOK'
UNIT=homunculus-infinity-pilot-hub
D=/etc/systemd/system/$UNIT.service.d
sudo test -e $D/94-nbp.conf || { echo "94 yok: geri alınacak bir şey yok, durdum"; exit 1; }
sudo rm -f $D/94-nbp.conf
sudo systemctl daemon-reload
sudo systemctl restart $UNIT
sleep 8
systemctl is-active $UNIT
systemctl show -p ExecStart $UNIT | grep -o "transport-[0-9a-f]*" | sort -u
BLOK
Beklenen: active; "transport-3940346adc66ca7b". Şeritteki NBP 15 sn içinde "köhnə", 2 dk içinde
hücre tamamen kalkar (v1: X39). R4 klasörü durur (sonra yeniden 94 ile açılabilir).

--- G-2 (VM): api ve web eski imajlara — YALNIZ G-1'den sonra (eski API v2'yi reddeder) ------------------
bash -eu -o pipefail <<'BLOK'
UNIT=homunculus-infinity-pilot-hub
D=/etc/systemd/system/$UNIT.service.d
sudo test ! -e $D/94-nbp.conf || { echo "94 HÂLÂ VAR: önce G-1: durdum"; exit 1; }
cd /opt/homunculus && git checkout feat/g2-vital-egrileri && test "$(git rev-parse --short=7 HEAD)" = 0ea1d05
cd /opt/homunculus/deploy/local
A=$HOME/nbp
sudo docker tag homunculus-rollback/api:pre-nbp "$(awk '$1=="homunculus-api" {print $3}' $A/image-ids-before.txt)"
sudo docker tag homunculus-rollback/web:pre-nbp "$(awk '$1=="homunculus-web" {print $3}' $A/image-ids-before.txt)"
sudo docker compose up -d --no-build api web 2>&1 | tail -2
curl -s -o /dev/null -w "health %{http_code}\n" http://172.100.101.72:8080/health
BLOK
Beklenen: health 200. Göç yok, veri kaybı yok.
```

- [ ] **Step 3: Fill the template and check it**

```bash
cd /c/tmp/infinity-a-releases
HEAD=$(git -C /c/tmp/inf-nbp rev-parse HEAD); SHORT=$(git -C /c/tmp/inf-nbp rev-parse --short=7 HEAD)
REL=transport-c1f619bf4e1df375
BUNDLE_SHA=$(sha256sum nbp-$SHORT.bundle | cut -d' ' -f1); REL_SHA=$(sha256sum $REL.tar.gz | cut -d' ' -f1)
sed -e "s/@HEAD@/$HEAD/g" -e "s/@SHORT@/$SHORT/g" -e "s/@BUNDLE_SHA@/$BUNDLE_SHA/g" -e "s/@REL@/$REL/g" \
    -e "s/@REL_SHA@/$REL_SHA/g" NBP-bloklari.template.txt > NBP-bloklari.txt
grep -c "@[A-Z_]*@" NBP-bloklari.txt
grep -c "^bash -eu -o pipefail <<'BLOK'$" NBP-bloklari.txt; grep -c "^BLOK$" NBP-bloklari.txt
sed -n '10,15p' NBP-bloklari.txt
```

Expected: `0` (no token left); `7` and `7` (B-1, B-2, C-1, C-2, D-1, G-1, G-2 — each opened and closed); the DEĞERLER lines with this branch's head, the bundle's and the tarball's sha256. Tell the controller the file is ready; nothing goes to the VM from the agent.

- [ ] **Step 4: With the user, in order** — the user pastes A-1, then the agent runs A-2 and keeps the `PANO_OZET` line (P-önce); the user pastes B-1, B-2, C-1, C-2 and shows the output; the agent runs C-3; the user pastes D-1; the agent runs D-2. Each step starts only after the previous one printed what the file says it should; a "durdum" line or any other output goes to the controller before anything else is pasted.

- [ ] **Step 5: The walk (E-1 … E-6) with the user.** Record each as "aynı / farklı / bekliyor" — never a pressure, never a patient. E-2's outcome closes or keeps O30; E-1's says whether X45's direction holds on the ward's clocks.

- [ ] **Step 6: Record the deploy** — after D-2 and the walk, two Edits whose new text is the run's own output (dates and times from the blocks, never estimated):

**Edit (its new text from the run)** `deploy/infinity/README.md` — replace:
```markdown
- Deploy record: the blocks are `C:\tmp\infinity-a-releases\NBP-bloklari.txt`; not yet on the VM
  when this was written.
```
with the same bullet saying when C-2 and D-1 ran (UTC), the API/web commit, that 94 was installed and the hub restarted on R4, D-2's results (transport and shadow KABUL, the `nbp:` line's counts, PANO_OZET equal to P-önce) and the walk's outcomes (E-1 … E-6, each "aynı / farklı / bekliyor").

**Edit (its new text from the run)** `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` — replace:
```markdown
· **VM: bekliyor** (önce api+web, sonra hub R4; işçi değişmez) ·
```
with `· **VM'de ✅ <tarih>** (api+web <short>, hub R4 + drop-in 94; geri dönüş etiketleri `:pre-nbp`; gölge ve taşıma kontrolleri KABUL; PANO_OZET değişmedi) ·`, the date and the short sha from the run.

```bash
cd /c/tmp/inf-nbp
git add deploy/infinity/README.md docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md
git status --short && git diff --cached --stat
git commit -q -F - <<'MSG'
docs(infinity): NBP on the VM — the deploy and the walk recorded

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
git log --oneline -1
```

(This commit follows the deployed one; the VM runs the code of Task 9's commit, and nothing in this one is code.)

---

## Task order and parallel work

| Task | Needs | May run beside (own worktree) | Files it shares with a later task |
|---|---|---|---|
| 0 worktree, junction, baseline | — | — | — |
| 1 the hub keeps NBP's change time | 0 | 2 | — |
| 2 the strings | 0 | 1 | `strings/monitor.js` (7) |
| 3 the API v1/v2, folding, 2 h; the dashboard's copy of the tables | 2 (the NBP row's label) | 1 | `monitor.js`, `monitor.test.js` (5); `SettingsScreen.test.jsx` (7) |
| 4 the forwarder v2 | 1 (`NBP`, `changed_at` in the snapshot), 3 (its end-to-end tests post v2 into the real API) | 5, 6, 7 | — |
| 5 `monitor.js` NBP cell | 3 | 4 | `shadow.testutil.js` is read by 6 |
| 6 the strip's NBP cell | 5 | 4 | — |
| 7 the legend | 3 (the NBP row), 2 | 4, 5, 6 if it rebases `strings/monitor.js` cleanly (different lines) | — |
| 8 gates and R4 | 1–7 | — | — |
| 9 docs | 8 (the release name it quotes) | — | `README.md`, the roadmap (10, Step 6) |
| 10 deploy blocks, the walk | 9 (the bundle is the branch head) | — | — |

**Why not the brief's order** (hub → forwarder → API → strings): X43. A v2 forwarder before a v2 API turns the forwarder's end-to-end and TLS tests red; the API's `EVIDENCE["nbp"]` and the dashboard's copy must land together (`monitor.test.js:126–137`), and that copy puts an NBP row in the Settings legend, which needs its label from the strings. In this order every commit is green in both suites, and the receiver precedes the sender exactly as D8 deploys them.

**Waves, if run in parallel:** A = {1, 2}; B = {3}; C = {4} beside the chain 5 → 6 → 7 (7 may also follow 3 directly; it touches only the legend's strings and its test); then 8, 9, 10 in order. The plan was measured in the serial order 1 → 10; a parallel merge must re-run Task 8's gates on the merged head.
